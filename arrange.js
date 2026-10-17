import { barTicks, beatTicks, snapTick, songEnd } from './song.js?v=9';

// Arrangement overview: ruler + one lane per track, drawn on a single hi-DPI canvas.
const RULER = 24, PADY = 6, MAX_AREA = 16e6; // backing-store area cap (iOS Safari limit)
const COL = {
  bg: '#0f1013', rowA: '#13151a', rowB: '#111317', ruler: '#15171b', text: '#8d8b86', hot: '#f2a33a',
  grid: 'rgba(255,255,255,0.06)', bar: 'rgba(255,255,255,0.12)', sep: 'rgba(0,0,0,0.35)',
};
const FONT = "10px 'JetBrains Mono', monospace";
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Arrangement {
  constructor(container, host) {
    this.box = container; this.host = host;
    const el = this.el = document.createElement('canvas');
    el.className = 'arrange';
    el.tabIndex = 0;
    Object.assign(el.style, {
      display: 'block', width: '100%', height: RULER + 'px', touchAction: 'pan-y', userSelect: 'none',
      webkitUserSelect: 'none', webkitTouchCallout: 'none', webkitTapHighlightColor: 'transparent', overscrollBehaviorX: 'contain',
    });
    el.setAttribute('data-gesture', 'own'); // its own two-finger pinch: the two-finger layer (gesture.js) leaves it alone
    container.append(el);
    this.ctx = el.getContext('2d');
    this.buf = document.createElement('canvas'); this.bctx = this.buf.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.x0 = 0; this.ppt = 0.05; this.auto = true; this.follow = true; this.fb = this.fe = 0;
    this.ph = 0; this.dirty = true; this.raf = 0; this.dead = false;
    this.g = null; this.pts = new Map(); this.tap = null; this.cur = '';
    this.offs = [];
    const on = (t, f, o) => { el.addEventListener(t, f, o); this.offs.push(() => el.removeEventListener(t, f, o)); };
    on('pointerdown', e => this.down(e));
    on('pointermove', e => this.move(e));
    on('pointerup', e => this.up(e, false));
    on('pointercancel', e => this.up(e, true));
    // a capture lost without a pointerup / pointercancel (another element took it): the drag ends as a cancel
    on('lostpointercapture', e => { const g = this.g; if (g && g.kind !== 'pinch' && g.id === e.pointerId) this.up(e, true); });
    on('wheel', e => this.wheel(e), { passive: false });
    on('contextmenu', e => { if (this.g) e.preventDefault(); });
    // desktop Safari reports trackpad pinch as GestureEvents, not ctrl+wheel (iOS touch pinches arrive as pointers too: ignored here)
    if (typeof window !== 'undefined' && 'GestureEvent' in window) {
      let gs = 1;
      const gest = e => {
        e.preventDefault();
        if (e.type === 'gesturestart') { gs = 1; return; }
        if (e.type !== 'gesturechange' || this.pts.size || !(e.scale > 0)) return;
        const f = e.scale / gs; gs = e.scale;
        this.zoomX(f, Number.isFinite(e.clientX) ? e.clientX : null);
      };
      for (const t of ['gesturestart', 'gesturechange', 'gestureend']) on(t, gest, { passive: false });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { if (this.measure() !== this.w) this.resize(); });
      this.ro.observe(el);
    }
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.render()).catch(() => {});
    this.resize();
    this.render();
  }

  /* ------------------------------------------------------------ public */
  render() {
    this.dirty = true;
    const t = this.host.getPlayhead ? this.host.getPlayhead() : null;
    if (Number.isFinite(t)) this.ph = t;
    this.frame();
  }
  resize() { this.w = this.measure(); this.dirty = true; this.frame(); }
  // sync: the caller is a frame callback (main.js frame()) — draw in this frame (one requested now would run a frame late)
  setPlayhead(t, sync) {
    if (!Number.isFinite(t)) return;
    const prev = this.ph;
    this.ph = t;
    const go = () => { if (!sync || this.dead) return this.frame(); if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } this.draw(); };
    if (t === prev || !this.w) { go(); return; }
    const p = this.host.getProject();
    // auto-fit grows (in 4-bar steps) to keep a playhead that runs past the song end in view
    if (this.auto) { if (p && this.fitEnd(p, this.fb) !== this.fe) this.dirty = true; }
    // page-follow only when the playhead was on screen and has just left it (respects manual scrolling)
    else if (this.follow && !this.g && p) {
      const a = this.x0, b = this.xt(this.w);
      if (prev >= a && prev <= b && (t < a || t > b)) { this.x0 = t - (b - a) * 0.05; this.clampView(p); this.dirty = true; }
    }
    go();
  }
  setFollow(on) { this.follow = !!on; }
  fit() { this.auto = true; this.dirty = true; this.frame(); }
  zoomX(f, cx) {
    const p = this.host.getProject();
    if (!p || !this.w || !(f > 0)) return;
    let ax;
    if (cx != null) ax = clamp(cx - this.el.getBoundingClientRect().left, 0, this.w);
    else { const px = this.tx(this.ph); ax = px >= 0 && px <= this.w ? px : this.w / 2; }
    const at = this.xt(ax), [mn, mx] = this.zoomRange(p);
    this.ppt = clamp(this.ppt * f, mn, mx);
    this.x0 = at - ax / this.ppt;
    this.auto = false;
    this.clampView(p);
    this.dirty = true; this.frame();
  }
  scrollPx(dx) {
    const p = this.host.getProject();
    if (!p || !this.w || !dx) return false;
    const o = this.x0;
    this.x0 += dx / this.ppt;
    this.clampView(p);
    if (this.x0 === o) return false;
    this.auto = false; this.dirty = true; this.frame();
    return true;
  }
  tickAt(clientX) { return this.xt(clientX - this.el.getBoundingClientRect().left); }
  getView() { return { start: this.x0, end: this.xt(this.w), ppt: this.ppt }; }
  destroy() {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.tipT); this.tip = null;
    for (const f of this.offs) f();
    this.offs = [];
    if (this.ro) this.ro.disconnect();
    this.el.remove();
  }

  /* ------------------------------------------------------- view math */
  measure() { return this.el.clientWidth || this.box.clientWidth || 0; }
  rh() { return this.host.rowHeight || 56; }
  tx(t) { return (t - this.x0) * this.ppt; }
  xt(x) { return this.x0 + x / this.ppt; }
  limit(p) { return Math.max(songEnd(p), p.loop ? p.loop.end : 0, this.ph) + 4 * barTicks(p); }
  zoomRange(p) { return [this.w / this.limit(p), 400 / beatTicks(p)]; }
  clampView(p) {
    const [mn, mx] = this.zoomRange(p);
    this.ppt = clamp(this.ppt, mn, Math.max(mn, mx));
    this.x0 = clamp(this.x0, 0, Math.max(0, this.limit(p) - this.w / this.ppt));
  }
  // auto-fit: song + 1 bar (and an active loop), extended in 4-bar steps while the playhead is beyond it
  fitBase(p) { const L = p.loop; return Math.max(songEnd(p) + barTicks(p), L && L.on && L.end > L.start ? L.end : 0); }
  fitEnd(p, e) { const k = 4 * barTicks(p); return this.ph > e ? e + Math.ceil((this.ph - e) / k) * k : e; }
  fitView(p) { this.fb = this.fitBase(p); this.fe = this.fitEnd(p, this.fb); this.ppt = this.w / this.fe; this.x0 = 0; }
  // bar/beat-covering span between two ticks (always at least one grid step)
  span(a, b, g) {
    let lo = Math.max(0, Math.min(a, b)), hi = Math.max(0, a, b);
    lo = snapTick(lo, g, 'floor'); hi = snapTick(hi, g, 'ceil');
    if (hi - lo < g) hi = lo + g;
    return [lo, hi];
  }
  // dragging one edge (originally at `org`) against the fixed edge `fix`; edges may cross. The moving edge snaps to
  // the grid; when that would leave less than the minimum length (one grid step, or the span's own length if it was
  // already shorter) it sits that minimum away from `fix`, on the pointer's side, so a small nudge never jumps.
  edge(fix, t, g, org) {
    const min = Math.max(1, Math.min(g, Math.abs(org - fix)));
    let v = Math.max(0, snapTick(t, g, 'round'));
    if (Math.abs(v - fix) < min) v = t < fix && fix - min >= 0 ? fix - min : fix + min;
    return v < fix ? [v, fix] : [fix, v];
  }
  range() {
    const r = this.host.getRange ? this.host.getRange() : null;
    if (!r) return null;
    const s = Array.isArray(r) ? r[0] : r.start, e = Array.isArray(r) ? r[1] : r.end;
    return Number.isFinite(s) && Number.isFinite(e) && e > s ? [s, e] : null;
  }
  pos(e) { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  // Edges grab from outside the band with the full tolerance but from inside only over the drawn edge line, so a
  // drag that starts just inside an edge (e.g. at bar 1 when the loop starts at 0) makes a new span. The loop's
  // handle strip at the top of the ruler grabs with the full tolerance on both sides.
  hit(x, y, p, touch) {
    const tol = touch ? 12 : 6;
    const near = (s, e, strip) => {
      const xs = this.tx(s), xe = this.tx(e), inn = strip ? tol : touch ? 5 : 2;
      const hs = x <= xs ? xs - x <= tol : x - xs <= inn, he = x >= xe ? x - xe <= tol : xe - x <= inn;
      if (hs && he) { const da = Math.abs(x - xs), db = Math.abs(x - xe); return da < db || (da === db && x < (xs + xe) / 2) ? 's' : 'e'; }
      return hs ? 's' : he ? 'e' : null;
    };
    const res = (kind, s, e, ed, o) => Object.assign(o, { kind, edge: ed, fix: ed === 's' ? e : ed === 'e' ? s : null, org: ed === 's' ? s : ed === 'e' ? e : null });
    if (y < RULER) {
      const L = p.loop, ok = L && L.end > L.start;
      return res('ruler', ok ? L.start : 0, ok ? L.end : 0, ok ? near(L.start, L.end, y < 8) : null, {});
    }
    const row = Math.floor((y - RULER) / this.rh()), r = this.range();
    return res('lane', r ? r[0] : 0, r ? r[1] : 0, r ? near(r[0], r[1], false) : null, { row, track: p.tracks[row] || null });
  }

  /* ------------------------------------------------------- pointer */
  down(e) {
    if (this.dead) return;
    const p = this.host.getProject();
    if (!p || !this.w) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    if (touch) {
      // a primary touch: no other touch is on the screen — forget stale ones (a pointerup that never reached the canvas)
      if (e.isPrimary === true && this.pts.size) { this.pts.clear(); if (this.g && (this.g.kind === 'pinch' || this.g.touch)) this.g = null; }
      this.pts.set(e.pointerId, e.clientX);
      if (this.pts.size === 2) {
        if (this.g && this.g.kind !== 'pinch') this.restore(this.g); // the first finger's drag turns into the pinch: undone
        const [a, b] = [...this.pts.values()], mid = (a + b) / 2 - this.el.getBoundingClientRect().left;
        this.g = { kind: 'pinch', d: Math.max(8, Math.abs(a - b)), ppt: this.ppt, at: this.xt(mid) };
        return;
      }
      if (this.pts.size > 2) return;
    }
    if (this.g) return;
    e.preventDefault();
    try { this.el.focus({ preventScroll: true }); } catch { /* focus unsupported */ }
    try { this.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const { x, y } = this.pos(e), h = this.hit(x, y, p, touch);
    let sel = null;
    // what the drag may change, as at the press (a two-finger takeover restores it: restore())
    const L = p.loop, was = { sel0: p.selTrack, loop0: L ? { start: L.start, end: L.end, on: !!L.on } : null, rng0: this.range() };
    if (h.kind === 'lane') {
      if (!h.track) return;
      const tp = this.tap, tm = now(), dz = touch ? 24 : 10; // a finger's second tap lands farther off
      if (tp && tm - tp.time < 400 && Math.abs(x - tp.x) < dz && Math.abs(y - tp.y) < dz && tp.row === h.row) {
        this.tap = null; this.tipOff();
        this.host.openTrack(h.track.id, Math.max(0, snapTick(this.xt(tp.x), barTicks(p), 'floor'))); // the roll opens at the tapped bar
        return;
      }
      // touch/pen may turn into a vertical scroll (pointercancel) or a pinch: select on tap or horizontal drag instead
      if (h.track.id !== p.selTrack) { if (e.pointerType === 'mouse') this.host.selectTrack(h.track.id); else sel = h.track.id; }
    }
    this.g = Object.assign({ id: e.pointerId, kind: h.kind, edge: h.edge, fix: h.fix, org: h.org, row: h.row, x, y, t: this.xt(x), touch, moved: false, sel,
      lo: h.edge ? Math.min(h.fix, h.org) : null, hi: h.edge ? Math.max(h.fix, h.org) : null }, was);
    this.render();
  }
  pick(g) { const id = g.sel; g.sel = null; if (id) this.host.selectTrack(id); }
  // A two-finger gesture took the drag over (gesture.js's pointercancel flagged e.gesture === 'two-finger', or the
  // canvas's own pinch): the loop or range it dragged and the track it selected go back to how they were at the press.
  // The loop's on flag needs host.restoreLoop({ start, end, on }); without it setLoop restores the bounds (and turns it on).
  restore(g) {
    g.sel = null;
    const p = this.host.getProject();
    if (!p) return;
    if (g.moved && g.kind === 'ruler') {
      const L = g.loop0;
      if (L && this.host.restoreLoop) this.host.restoreLoop(L);
      else if (L && L.end > L.start) this.host.setLoop(L.start, L.end);
    } else if (g.moved) this.host.setRange(g.rng0 ? g.rng0[0] : null, g.rng0 ? g.rng0[1] : null);
    if (g.sel0 != null && p.selTrack !== g.sel0 && p.tracks.some(t => t.id === g.sel0)) this.host.selectTrack(g.sel0);
  }
  move(e) {
    if (this.pts.has(e.pointerId)) this.pts.set(e.pointerId, e.clientX);
    const g = this.g;
    if (g && g.kind === 'pinch') {
      if (this.pts.size < 2) return;
      const [a, b] = [...this.pts.values()], mid = (a + b) / 2 - this.el.getBoundingClientRect().left, p = this.host.getProject();
      if (!p) return;
      const [mn, mx] = this.zoomRange(p);
      this.ppt = clamp(g.ppt * Math.max(8, Math.abs(a - b)) / g.d, mn, mx);
      this.x0 = g.at - mid / this.ppt;
      this.auto = false; this.clampView(p); this.dirty = true; this.frame();
      return;
    }
    if (!g) { if (e.pointerType !== 'touch') this.hover(e); return; }
    if (g.id !== e.pointerId) return;
    const p = this.host.getProject();
    if (!p) return;
    let { x } = this.pos(e);
    if (!g.moved) {
      if (Math.abs(x - g.x) < (g.touch ? 6 : 3)) return;
      g.moved = true;
      this.pick(g);
    }
    if (this.edgeScroll(x, g)) x = this.pos(e).x;
    // whole bars (Shift: beats); a finger has no Shift: beats once a bar is 160 px or wider
    const t = this.xt(x), grid = e.shiftKey || (g.touch && barTicks(p) * this.ppt >= 160) ? beatTicks(p) : barTicks(p);
    const [lo, hi] = g.edge ? this.edge(g.fix, t, grid, g.org) : this.span(g.t, t, grid);
    if (lo === g.lo && hi === g.hi) return; // unchanged: don't re-send (setLoop re-anchors the transport while playing)
    g.lo = lo; g.hi = hi;
    if (g.kind === 'ruler') this.host.setLoop(lo, hi);
    else this.host.setRange(lo, hi);
    this.render();
  }
  up(e, cancel) {
    this.pts.delete(e.pointerId);
    const g = this.g;
    if (g && g.kind === 'pinch') { if (this.pts.size < 2) this.g = null; return; }
    if (!g || g.id !== e.pointerId) return;
    this.g = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (cancel && e.gesture === 'two-finger') this.restore(g);
    if (!cancel && !g.moved) {
      this.pick(g);
      const p = this.host.getProject();
      if (p) {
        const t = Math.max(0, e.shiftKey ? Math.round(g.t) : snapTick(g.t, beatTicks(p), 'round'));
        if (g.kind === 'lane') { this.host.setRange(null); this.tap = { time: now(), x: g.x, y: g.y, row: g.row }; if (g.touch) this.tipOn(g); }
        this.host.setPlayhead(t);
        this.ph = t;
      }
    }
    this.render();
  }
  // g: the drag — a finger gets a 32 px zone, and one that pressed inside a zone scrolls only once it moves on toward that edge
  edgeScroll(x, g) {
    const t = !!(g && g.touch), m = t ? 32 : 16;
    const R = x > this.w - m && (!t || g.x <= this.w - m || x > g.x + 4), L = x < m && this.x0 > 0 && (!t || g.x >= m || x < g.x - 4);
    const d = R ? x - (this.w - m) : L ? x - m : 0;
    return d ? this.scrollPx(d * 0.5) : false;
  }
  // touch: a tap on a lane shows, the first few times a session, that its notes are edited in the Piano Roll
  tipOn(g) {
    if ((this.tips = (this.tips || 0) + 1) > 3) return;
    this.tip = { x: g.x, row: g.row };
    clearTimeout(this.tipT);
    this.tipT = setTimeout(() => this.tipOff(), 2500);
  }
  tipOff() { clearTimeout(this.tipT); this.tipT = 0; if (this.tip) { this.tip = null; this.frame(); } }
  hover(e) {
    const p = this.host.getProject();
    if (!p || !this.w) return;
    const { x, y } = this.pos(e), h = this.hit(x, y, p, false);
    const c = h.edge ? 'ew-resize' : h.kind === 'ruler' ? 'pointer' : 'default';
    if (c !== this.cur) this.el.style.cursor = this.cur = c;
  }
  wheel(e) {
    const p = this.host.getProject();
    if (!p || !this.w) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.w : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomX(clamp(Math.exp(-dy * 0.0025), 0.5, 2), e.clientX); return; }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    if (Math.abs(dx) <= Math.abs(dy)) return; // vertical: let the surrounding container scroll
    e.preventDefault();
    this.scrollPx(dx);
  }

  /* ------------------------------------------------------- drawing */
  frame() {
    if (this.raf || this.dead) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }
  draw() {
    if (this.dead) return;
    const p = this.host.getProject();
    if (!this.w) this.w = this.measure();
    if (!p || !this.w) return;
    const w = this.w, rh = this.rh(), h = RULER + p.tracks.length * rh;
    if (h !== this.h) { this.h = h; this.el.style.height = h + 'px'; this.dirty = true; }
    let dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    if (w * h * dpr * dpr > MAX_AREA) dpr = Math.max(1, Math.sqrt(MAX_AREA / (w * h)));
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.el.width !== W || this.el.height !== H) {
      this.el.width = this.buf.width = W; this.el.height = this.buf.height = H;
      this.dirty = true;
    }
    this.dpr = dpr;
    if (this.dirty) {
      if (this.auto) this.fitView(p); else this.clampView(p);
      this.dirty = false;
      this.paint(this.bctx, p, w, h, rh);
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.buf, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // playhead: a whole number of device pixels wide, starting on a device-pixel boundary (crisp at any dpr)
    const lw = Math.max(1, Math.round(dpr)), px = Math.round(this.tx(this.ph) * dpr - lw / 2), x = (px + lw / 2) / dpr;
    if (x >= -6 && x <= w + 6) {
      c.fillStyle = COL.hot;
      c.fillRect(px / dpr, 0, lw / dpr, h);
      c.beginPath(); c.moveTo(x - 5, 0); c.lineTo(x + 5, 0); c.lineTo(x, 7); c.closePath(); c.fill();
    }
    const tip = this.tip;
    if (tip && p.tracks[tip.row]) {
      const s = 'Double-tap to edit its notes', tw = s.length * 6.2 + 14, ty = RULER + tip.row * rh + rh / 2;
      const tx = clamp(tip.x - tw / 2, 4, Math.max(4, w - tw - 4));
      c.fillStyle = 'rgba(12,13,15,0.92)'; c.fillRect(tx, ty - 10, tw, 20);
      c.fillStyle = COL.hot; c.fillRect(tx, ty - 10, 2, 20);
      c.font = FONT; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#e9e7e2'; c.fillText(s, tx + 8, ty);
    }
  }
  paint(c, p, w, h, rh) {
    const dpr = this.dpr, ppt = this.ppt, t0 = this.x0, t1 = this.xt(w);
    const bar = barTicks(p), beat = beatTicks(p), end = songEnd(p), L = p.loop, R = this.range();
    const solo = p.tracks.some(tr => tr.solo), X = t => this.tx(t);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = COL.bg; c.fillRect(0, 0, w, h);

    // lane backgrounds + selected row tint
    p.tracks.forEach((tr, i) => {
      const y = RULER + i * rh;
      c.fillStyle = i % 2 ? COL.rowB : COL.rowA; c.fillRect(0, y, w, rh);
      if (tr.id === p.selTrack) { c.globalAlpha = 0.1; c.fillStyle = tr.color; c.fillRect(0, y, w, rh); c.globalAlpha = 1; }
    });
    // past the end of the song, loop tint
    const xe = Math.max(0, X(end));
    if (xe < w) { c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(xe, RULER, w - xe, h - RULER); }
    const loopOk = L && L.end > L.start, la = loopOk ? X(L.start) : 0, lb = loopOk ? X(L.end) : 0;
    if (loopOk && L.on && lb > 0 && la < w) { c.fillStyle = 'rgba(242,163,58,0.035)'; c.fillRect(la, RULER, lb - la, h - RULER); }

    // grid: beats when roomy, bars (labels every 1/2/4/8... bars when crowded)
    const barPx = bar * ppt, beatPx = beat * ppt;
    let step = 1;
    while (barPx * step < 30 && step < 1e6) step *= 2;
    const lane = h - RULER;
    if (beatPx >= 8) {
      c.fillStyle = COL.grid;
      for (let t = Math.floor(t0 / beat) * beat; t <= t1; t += beat) if (t % bar) c.fillRect(Math.round(X(t)), RULER, 1, lane);
    }
    for (let i = Math.max(0, Math.floor(t0 / bar)); i * bar <= t1; i++) {
      const major = i % step === 0;
      if (!major && barPx < 4) continue;
      c.fillStyle = major ? COL.bar : COL.grid;
      c.fillRect(Math.round(X(i * bar)), RULER, 1, lane);
    }

    // notes
    const usable = rh - 2 * PADY;
    p.tracks.forEach((tr, i) => {
      const ns = tr.notes;
      if (!ns || !ns.length) return;
      let lo = 127, hi = 0, first = Infinity, last = 0;
      for (const n of ns) {
        if (n.n < lo) lo = n.n;
        if (n.n > hi) hi = n.n;
        if (n.t < first) first = n.t;
        if (n.t + n.d > last) last = n.t + n.d;
      }
      if (hi - lo < 11) { const m = (lo + hi) / 2; lo = m - 5.5; hi = m + 5.5; }
      const top = RULER + i * rh, nh = clamp(usable / (hi - lo + 1), 1.5, 5), span = usable - nh;
      const dim = tr.mute || (solo && !tr.solo), a = dim ? 0.35 : 1;
      c.fillStyle = tr.color;
      const ra = Math.max(-2, X(first)), rb = Math.min(w + 2, X(last));
      if (rb > ra) {
        c.globalAlpha = 0.07 * a; c.fillRect(ra, top + 3, rb - ra, rh - 6);
        c.globalAlpha = 0.35 * a; c.fillRect(ra, top + 3, rb - ra, 1);
      }
      for (const n of ns) {
        if (n.t > t1 || n.t + n.d < t0) continue;
        const nw = n.d * ppt;
        c.globalAlpha = a * (0.55 + 0.45 * clamp(n.v, 1, 127) / 127);
        c.fillRect(X(n.t), top + PADY + (hi - n.n) / (hi - lo) * span, Math.max(1.5, nw > 4 ? nw - 1 : nw), nh);
      }
      c.globalAlpha = 1;
    });

    // time-selection range
    if (R) {
      const ra = X(R[0]), rb = X(R[1]);
      if (rb > 0 && ra < w) {
        c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(ra, RULER, rb - ra, lane);
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(Math.round(ra), RULER, 1, lane); c.fillRect(Math.round(rb) - 1, RULER, 1, lane);
      }
    }
    // row separators + selected marker
    p.tracks.forEach((tr, i) => {
      const y = RULER + i * rh;
      c.fillStyle = COL.sep; c.fillRect(0, y + rh - 1, w, 1);
      if (tr.id === p.selTrack) { c.fillStyle = tr.color; c.fillRect(0, y, 3, rh - 1); }
    });

    // ruler
    c.fillStyle = COL.ruler; c.fillRect(0, 0, w, RULER);
    if (loopOk && lb > 0 && la < w) {
      c.fillStyle = L.on ? 'rgba(242,163,58,0.26)' : 'rgba(242,163,58,0.09)'; c.fillRect(la, 0, lb - la, RULER - 1);
      c.fillStyle = L.on ? COL.hot : 'rgba(242,163,58,0.45)';
      c.fillRect(la, 0, 2, RULER - 1); c.fillRect(lb - 2, 0, 2, RULER - 1);
      c.fillRect(la, 0, 6, 2); c.fillRect(lb - 6, 0, 6, 2);
    }
    if (beatPx >= 6) {
      c.fillStyle = 'rgba(255,255,255,0.14)';
      for (let t = Math.floor(t0 / beat) * beat; t <= t1; t += beat) if (t % bar) c.fillRect(Math.round(X(t)), RULER - 5, 1, 5);
    }
    c.font = FONT; c.textBaseline = 'top'; c.textAlign = 'left';
    for (let i = Math.max(0, Math.floor(t0 / bar)); i * bar <= t1; i++) {
      if (i % step) continue;
      const x = Math.round(X(i * bar));
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x, 4, 1, RULER - 4);
      c.fillStyle = loopOk && L.on && i * bar >= L.start && i * bar < L.end ? '#d9c6a6' : COL.text;
      c.fillText(String(i + 1), x + 3, 5);
    }
    if (R) {
      const ra = X(R[0]), rb = X(R[1]);
      if (rb > 0 && ra < w) { c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(ra, RULER - 3, rb - ra, 2); }
    }
    c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(0, RULER - 1, w, 1);
  }
}
