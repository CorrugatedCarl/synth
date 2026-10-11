// PianoRoll — canvas note editor for one track. All edits go through host.edit / host.beginEdit+changed+endEdit.
// The specifier must match main.js's song import exactly: a different query string loads a second copy of song.js with its own note-id counter.
import { PPQ, barTicks, beatTicks, fmtBBT, snapTick, sortNotes, songEnd, copyNotes, pasteNotes, newId } from './song.js?v=4';

const GUT = 64, RUL = 24, VEL = 72, MAXPPT = 1.5, BW = 38;
const BG = '#0c0d0f', ACC = '#f2a33a', TEXT = '#e9e7e2', MUTE = '#8d8b86', LINE = '#24262b';
const FONT = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const AUTO_X = new Set(['marquee', 'move', 'resizeR', 'resizeL', 'create', 'erase', 'ruler', 'loopEdge', 'velpaint']);
const DBL = 6, HOLD = 90;   // double-click slop (px); touch delay (ms) before Draw/Erase act, so a pinch can start first
const AUTO_Y = new Set(['marquee', 'move', 'create', 'erase']);
const TOOLS = ['select', 'draw', 'erase'];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
const isBlk = n => BLK[((n % 12) + 12) % 12] === 1;
const rgb = s => {
  s = String(s || '').replace('#', '');
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  const v = parseInt(s, 16);
  return s.length !== 6 || isNaN(v) ? [242, 163, 58] : [v >> 16 & 255, v >> 8 & 255, v & 255];
};
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const clipList = c => (!c ? [] : Array.isArray(c.notes) ? c.notes : c.tracks ? (Object.values(c.tracks).find(v => v && Array.isArray(v.notes) && v.notes.length) || { notes: [] }).notes : []);
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function removeIds(arr, ids) { let j = 0; for (const x of arr) if (!ids.has(x.id)) arr[j++] = x; const k = arr.length - j; arr.length = j; return k; }
const uid = used => { let i = newId(); while (used.has(i)) i = newId(); used.add(i); return i; };
const svgCur = (svg, x, y, fb) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fb}`;
const PENCIL = svgCur('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M2 18l1.2-4.6L13.6 3a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L6.6 16.8z" fill="#f2a33a" stroke="#0c0d0f" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 18l1.2-4.6 3.4 3.4z" fill="#e9e7e2" stroke="#0c0d0f" stroke-width="1" stroke-linejoin="round"/></svg>', 2, 18, 'crosshair');
const ERASER = svgCur('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><g transform="rotate(-45 10 10)"><rect x="3" y="6.5" width="14" height="7" rx="1.5" fill="#e9e7e2" stroke="#0c0d0f" stroke-width="1.3"/><rect x="3" y="6.5" width="5" height="7" rx="1.5" fill="#e2402f" stroke="#0c0d0f" stroke-width="1.3"/></g></svg>', 5, 15, 'cell');

export class PianoRoll {
  constructor(container, host) {
    this.box = container; this.host = host;
    const c = this.el = document.createElement('canvas');
    c.tabIndex = 0; c.className = 'proll';
    c.setAttribute('role', 'application'); c.setAttribute('aria-label', 'Piano roll note editor');
    c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;outline:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent';
    try { if (getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch { /* no layout */ }
    container.appendChild(c);
    this.ctx = c.getContext('2d');
    this.back = document.createElement('canvas'); this.bctx = this.back.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1;
    const p = host.getProject();
    this.ppt = 220 / (p ? barTicks(p) : PPQ * 4);
    this.rowHf = 12; this.rowH = 12; this.sx = 0; this.sy = 0; this.syr = 0;
    this.tool = 'select'; this.drawLen = 0; this.lastLen = 0; this.follow = false; this.ghosts = true;
    this.sel = new Set(); this.ins = null; this.ph = +host.getPlayhead() || 0;
    this.g = null; this.hover = null; this.keys = new Set(); this.touches = new Map(); this.lastTap = null;
    this.pals = new Map(); this.raf = 0; this.autoRaf = 0; this.dirty = true; this.cur = ''; this.focused = false;
    this.want = { type: 'center', lo: 48, hi: 72 };
    for (const k of ['_down', '_move', '_up', '_cancel', '_lost', '_leave', '_wheel', '_frame', '_autoTick', '_focus', '_menu']) this[k] = this[k].bind(this);
    this._ls = [['pointerdown', this._down], ['pointermove', this._move], ['pointerup', this._up], ['pointercancel', this._cancel], ['lostpointercapture', this._lost],
      ['pointerleave', this._leave], ['wheel', this._wheel, { passive: false }], ['focus', this._focus], ['blur', this._focus], ['contextmenu', this._menu]];
    for (const [ev, fn, o] of this._ls) c.addEventListener(ev, fn, o);
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); }
    else { this.ro = null; this._wr = () => this.resize(); window.addEventListener('resize', this._wr); }
    try { document.fonts.ready.then(() => this.render()); } catch { /* no font loading API */ }
    this.resize();
  }

  /* ---------------------------------------------------------- geometry */
  get gw() { return Math.max(0, this.W - GUT); }
  get gb() { return this.H - VEL - 1; }
  get gh() { return Math.max(0, this.gb - RUL); }
  t2x(t) { return GUT + (t - this.sx) * this.ppt; }
  x2t(x) { return this.sx + (x - GUT) / this.ppt; }
  n2y(n) { return RUL + (127 - n) * this.rowH - this.syr; }
  y2n(y) { return 127 - Math.floor((y - RUL + this.syr) / this.rowH); }
  v2y(v) { return this.H - VEL + 6 + (1 - v / 127) * (VEL - 12); }
  y2v(y) { return clamp(Math.round(127 * (1 - (y - (this.H - VEL + 6)) / (VEL - 12))), 1, 127); }
  _maxTick() {
    const p = this.host.getProject(), tr = this.host.getTrack();
    if (!p) return PPQ * 64;
    let e = songEnd(p);
    if (tr) for (const x of tr.notes) if (x.t + x.d > e) e = x.t + x.d;
    return e + 4 * barTicks(p);
  }
  _minPpt() { return Math.min(MAXPPT, Math.max(1e-4, this.gw / this._maxTick())); }
  clampX() { this.sx = clamp(this.sx, 0, Math.max(0, this._maxTick() - this.gw / this.ppt)); }
  clampY() { this.sy = clamp(this.sy, 0, Math.max(0, 128 * this.rowH - this.gh)); this.syr = Math.round(this.sy); }
  _snap() { return Math.max(0, +this.host.getSnap() || 0); }
  _len() { return Math.max(1, Math.round(this.drawLen || this._snap() || this.lastLen || PPQ / 4)); }
  _ids() { const s = new Set(), p = this.host.getProject(); if (p) for (const t of p.tracks) for (const x of t.notes || []) s.add(x.id); return s; }
  _pos(e) { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _region(x, y) {
    if (y < RUL) return x < GUT ? 'corner' : 'ruler';
    if (y >= this.H - VEL) return x < GUT ? 'velg' : 'vel';
    if (y >= this.gb) return 'div';
    return x < GUT ? 'keys' : 'grid';
  }

  /* ------------------------------------------------------- public API */
  resize() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = Math.round(this.box.clientWidth), H = Math.round(this.box.clientHeight);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      for (const cv of [this.el, this.back]) { cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); }
    }
    this._applyWant(); this.clampX(); this.clampY(); this.render();
  }
  render() { this.dirty = true; this._req(); }
  _req() { if (!this.raf && !this.dead) this.raf = requestAnimationFrame(this._frame); }
  setTrack() {
    if (this.g) this._finish(false);
    this.sel.clear(); this.ins = null; this.lastTap = null; this.hover = null; this._notify();
    const tr = this.host.getTrack();
    let lo = 48, hi = 72;
    if (tr && tr.notes.length) { lo = 127; hi = 0; for (const x of tr.notes) { if (x.n < lo) lo = x.n; if (x.n > hi) hi = x.n; } }
    this.want = { type: 'center', lo, hi }; this._applyWant(); this.render();
  }
  setTool(name) { if (TOOLS.includes(name)) { this.tool = name; this.render(); } }
  setDrawLength(t) { this.drawLen = Math.max(0, Math.round(+t || 0)); this._req(); }
  zoomX(f, cx) {
    let ax;
    if (cx != null) ax = cx - this.el.getBoundingClientRect().left;
    else { const px = this.t2x(this.ph); ax = px >= GUT && px <= this.W ? px : GUT; }
    ax = clamp(ax, GUT, Math.max(GUT, this.W));
    const t = this.x2t(ax);
    this.ppt = clamp(this.ppt * (+f || 1), this._minPpt(), MAXPPT);
    this.sx = t - (ax - GUT) / this.ppt; this.clampX();
    if (this.g) this._apply();
    this.render();
  }
  zoomY(f, cy) {
    const ay = cy != null ? clamp(cy - this.el.getBoundingClientRect().top - RUL, 0, this.gh) : this.gh / 2;
    const row = (this.sy + ay) / this.rowH;
    this.rowHf = clamp(this.rowHf * (+f || 1), 5, 32); this.rowH = Math.round(this.rowHf);
    this.sy = row * this.rowH - ay; this.clampY();
    if (this.g) this._apply();
    this.render();
  }
  fit() { this.want = { type: 'fit' }; this._applyWant(); this.render(); }
  _applyWant() {
    const w = this.want;
    if (!w || this.gw < 10 || this.gh < 10) return;
    this.want = null;
    if (w.type === 'center') {
      const rows = w.hi - w.lo + 1;
      if (rows * this.rowH > this.gh) { this.rowHf = Math.max(5, Math.floor(this.gh / (rows + 1))); this.rowH = Math.round(this.rowHf); }
      this.sy = (127 - (w.lo + w.hi) / 2 + 0.5) * this.rowH - this.gh / 2; this.clampY();
      return;
    }
    const p = this.host.getProject(), tr = this.host.getTrack();
    if (!p) return;
    let t0, t1, lo, hi;
    if (tr && tr.notes.length) {
      t0 = Infinity; t1 = 0; lo = 127; hi = 0;
      for (const x of tr.notes) { t0 = Math.min(t0, x.t); t1 = Math.max(t1, x.t + x.d); lo = Math.min(lo, x.n); hi = Math.max(hi, x.n); }
    } else {
      const lp = p.loop || {};
      t0 = +lp.start || 0; t1 = lp.end > t0 ? lp.end : t0 + barTicks(p) * 4; lo = 48; hi = 72;
    }
    t1 = Math.max(t1, t0 + beatTicks(p));
    const span = t1 - t0;
    this.ppt = clamp(this.gw / (span * 1.08), this._minPpt(), MAXPPT);
    this.sx = t0 - span * 0.04; this.clampX();
    this.rowHf = clamp(Math.floor(this.gh / (hi - lo + 5)), 5, 32); this.rowH = Math.round(this.rowHf);
    this.sy = (127 - (lo + hi) / 2 + 0.5) * this.rowH - this.gh / 2; this.clampY();
  }
  setFollow(on) { this.follow = !!on; if (this.follow) this.setPlayhead(this.ph); }
  setGhosts(on) { this.ghosts = !!on; this.render(); }
  setPlayhead(t) {
    this.ph = +t || 0;
    if (this.follow && !this.g && this.gw > 0) {
      const x = this.t2x(this.ph);
      if (x > this.W - 12 || x < GUT) { const o = this.sx; this.sx = this.ph - this.gw * 0.04 / this.ppt; this.clampX(); if (this.sx !== o) this.dirty = true; }
    }
    this._req();
  }
  getInsertPoint() { return this.ins; }
  _notes() { const tr = this.host.getTrack(); return tr ? tr.notes : []; }
  _setSel(ids) { this.sel = new Set(ids); this._notify(); this.render(); }
  selectAll() { this._setSel(this._notes().map(x => x.id)); }
  selectNone() { this._setSel([]); }
  invertSelection() { this._setSel(this._notes().filter(x => !this.sel.has(x.id)).map(x => x.id)); }
  selectPitch(n) { this._setSel(this._notes().filter(x => x.n === n).map(x => x.id)); }
  getSelection() { return this.sel.size ? this._notes().filter(x => this.sel.has(x.id)) : []; }
  getTargetNotes() { const s = this.getSelection(); return s.length ? s : this._notes().slice(); }
  deleteSelected(label = 'Delete notes') {
    if (!this.host.getTrack() || !this.sel.size) return 0;
    const ids = new Set(this.sel); let k = 0;
    this.host.edit(label, () => { const tr = this.host.getTrack(); if (tr) k = removeIds(tr.notes, ids); });
    this.sel.clear(); this._notify(); this.render();
    return k;
  }
  copy() { const s = this.getSelection(); return s.length ? copyNotes(s) : null; }
  cut() { const clip = this.copy(); if (clip) this.deleteSelected('Cut notes'); return clip; }
  paste(clip, at, label = 'Paste notes') {
    const list = clipList(clip);
    if (!this.host.getTrack() || !list.length) return [];
    if (at == null) at = this.ins != null ? this.ins : this.host.getPlayhead();
    at = Math.max(0, Math.round(+at || 0));
    let ins = [];
    this.host.edit(label, () => {
      const tr = this.host.getTrack();
      if (!tr) return;
      const used = this._ids();
      ins = pasteNotes(tr, clip, at);
      for (const x of ins) { if (used.has(x.id)) x.id = uid(used); else used.add(x.id); }
      sortNotes(tr.notes);
    });
    let span = 0, ss = 0;
    for (const x of list) { span = Math.max(span, x.t + x.d); ss = Math.max(ss, x.t); }
    this.ins = at + (clip.kind === 'range' && clip.len > 0 ? clip.len : this._repLen(span, ss));
    this.sel = new Set(ins.map(x => x.id)); this._notify(); this.render();
    return ins;
  }
  duplicate() {
    const s = this.getSelection();
    if (!s.length) return [];
    let a = Infinity, b = 0, c = 0;
    for (const x of s) { a = Math.min(a, x.t); b = Math.max(b, x.t + x.d); c = Math.max(c, x.t); }
    return this.paste(copyNotes(s), a + this._repLen(b - a, c - a), 'Duplicate notes');
  }
  // musical repeat length for a phrase `len` ticks long whose last note starts `ss` after its first:
  // whole bars for phrases >= half a bar, beats for short motifs, else snap steps. A release tail of up to
  // a 16th (or a quarter unit) past the unit doesn't add a unit, but every copy starts after the last original start.
  _repLen(len, ss = 0) {
    const p = this.host.getProject();
    if (!p || len <= 0) return Math.max(1, len);
    const bar = barTicks(p), beat = beatTicks(p), u = len >= bar / 2 ? bar : len >= beat ? beat : this._snap() || 1;
    const tol = Math.min(u / 4, PPQ / 4);
    return u * Math.max(1, Math.ceil((len - tol) / u - 1e-9), Math.floor(Math.max(0, ss) / u) + 1);
  }
  nudge(dt, dn) {
    const s = this.getSelection();
    if (!s.length) return;
    let a = Infinity, lo = 127, hi = 0;
    for (const x of s) { a = Math.min(a, x.t); lo = Math.min(lo, x.n); hi = Math.max(hi, x.n); }
    dt = Math.max(Math.round(+dt || 0), -a); dn = clamp(Math.round(+dn || 0), -lo, 127 - hi);
    if (!dt && !dn) return;
    this.host.edit('Nudge notes', () => { for (const x of s) { x.t += dt; x.n += dn; } const tr = this.host.getTrack(); if (tr) sortNotes(tr.notes); });
    if (dn && s.length === 1) this._blip(s[0].n, s[0].v);
    this.render();
  }
  destroy() {
    if (this.g) this._finish(false);
    for (const n of [...this.keys]) this._audOff(n);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.autoRaf) cancelAnimationFrame(this.autoRaf);
    this.raf = this.autoRaf = 0;
    for (const [ev, fn, o] of this._ls) this.el.removeEventListener(ev, fn, o);
    if (this.ro) this.ro.disconnect(); else window.removeEventListener('resize', this._wr);
    this.el.remove();
    this.dead = true;
  }

  /* ------------------------------------------------------- internals */
  _notify() { if (this.host.onSelect) this.host.onSelect(this.sel.size); }
  _aud(n, v) { this.host.audition(n, clamp(Math.round(v) || 100, 1, 127)); this.keys.add(n); this._req(); }
  _audOff(n) { if (n == null) return; this.host.auditionOff(n); this.keys.delete(n); this._req(); }
  _blip(n, v) { this._aud(n, v); setTimeout(() => { if (!this.dead) this._audOff(n); }, 170); }
  _cursor(c) { if (c !== this.cur) { this.cur = c; this.el.style.cursor = c; } }
  _focus(e) { this.focused = e.type === 'focus'; this._req(); }
  _menu(e) { e.preventDefault(); }
  _pal(col) {
    let p = this.pals.get(col);
    if (p) return p;
    const c = rgb(col), fill = [], sel = [], edge = [], txt = [];
    for (let i = 0; i < 16; i++) {
      const b = c.map(x => x * (0.36 + 0.64 * i / 15)), s = mix(b, [255, 255, 255], 0.3);
      fill.push(css(b)); sel.push(css(s)); edge.push(css(b.map(x => x * 0.5)));
      txt.push([lum(b) < 0.42 ? 'rgba(255,255,255,0.78)' : 'rgba(10,11,13,0.78)', lum(s) < 0.42 ? 'rgba(255,255,255,0.85)' : 'rgba(10,11,13,0.82)']);
    }
    p = { c, fill, sel, edge, txt, stem: css(c.map(x => x * 0.7)), head: css(c), ghost: `rgba(${c[0]},${c[1]},${c[2]},0.22)`, line: `rgba(${c[0]},${c[1]},${c[2]},0.6)` };
    this.pals.set(col, p);
    return p;
  }
  _hit(x, y) {
    const tr = this.host.getTrack();
    if (!tr || y < RUL || y >= this.gb || x < GUT) return null;
    const n = this.y2n(y);
    let best = null, bp = -1;
    for (const nt of tr.notes) {
      if (nt.n !== n) continue;
      const x0 = this.t2x(nt.t), x1 = Math.max(x0 + 2, this.t2x(nt.t + nt.d));
      if (x < x0 - 1 || x > x1 + 2) continue;
      const pr = (x >= x0 && x <= x1 ? 2 : 0) + (this.sel.has(nt.id) ? 1 : 0);
      if (pr >= bp) { bp = pr; best = { note: nt, x0, x1 }; }
    }
    if (!best) return null;
    const w = best.x1 - best.x0;
    if (w < 10) best.part = x > best.x1 ? 'r' : 'b';
    else { const rz = w >= 18 ? 6 : 3, lz = w >= 18 ? 4 : 2; best.part = x >= best.x1 - rz ? 'r' : x <= best.x0 + lz ? 'l' : 'b'; }
    return best;
  }
  _stemAt(x, y) {
    let best = null, bs = Infinity;
    for (const nt of this._notes()) {
      const dx = Math.abs(this.t2x(nt.t) - x);
      if (dx > 5) continue;
      const s = dx + Math.abs(this.v2y(nt.v) - y) * 0.25 - (this.sel.has(nt.id) ? 1 : 0);
      if (s < bs) { bs = s; best = nt; }
    }
    return best;
  }
  _loopEdge(x) {
    const p = this.host.getProject(), lp = p && p.loop;
    if (!lp || !(lp.end > lp.start)) return null;
    const near = t => { const ex = this.t2x(t); return ex >= GUT && ex <= this.W && Math.abs(x - ex) <= 5; };
    return near(lp.end) ? 'end' : near(lp.start) ? 'start' : null;
  }
  _hover(x, y, quiet) {
    const reg = this._region(x, y), hv = { reg, x, y };
    let cur = 'default';
    if (reg === 'grid') {
      hv.n = clamp(this.y2n(y), 0, 127); hv.t = Math.max(0, this.x2t(x));
      const h = this._hit(x, y); hv.hit = h;
      cur = this.tool === 'erase' ? ERASER : h ? (h.part === 'b' ? 'move' : 'ew-resize') : this.tool === 'draw' ? PENCIL : 'crosshair';
    } else if (reg === 'keys') { hv.n = clamp(this.y2n(y), 0, 127); cur = 'pointer'; }
    else if (reg === 'ruler') { hv.t = Math.max(0, this.x2t(x)); cur = this._loopEdge(x) ? 'ew-resize' : 'pointer'; }
    else if (reg === 'vel') { hv.t = Math.max(0, this.x2t(x)); hv.stem = this._stemAt(x, y); cur = hv.stem ? 'ns-resize' : 'crosshair'; }
    this.hover = hv; this._cursor(cur);
    if (!quiet) this._req();
  }

  /* ---------------------------------------------------------- pointer */
  _down(e) {
    const [x, y] = this._pos(e);
    if (this.g && this.g.id === e.pointerId) this._finish(false, false, true); // this pointer's earlier pointerup never reached us
    if (e.pointerType === 'touch') {
      // a primary touch means no other finger is down: drop entries whose pointerup we missed
      if (e.isPrimary) { this.touches.clear(); if (this.g && (this.g.touch || this.g.type === 'pinch')) this._finish(false, false, true); }
      this.touches.set(e.pointerId, { x, y });
      if (this.touches.size === 2) {
        if (this.g) this._finish(false, true, true); // undo whatever the first finger started; keep its capture
        for (const id of this.touches.keys()) try { this.el.setPointerCapture(id); } catch { /* pointer gone */ }
        this._pinchStart(); return;
      }
      if (this.touches.size > 2) return;
    }
    if (this.g) return;
    const btn = e.button;
    if (btn !== 0 && btn !== 1 && btn !== 5) return;
    e.preventDefault();
    try { this.el.focus({ preventScroll: true }); } catch { /* older browsers */ }
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const reg = this._region(x, y), ts = e.timeStamp || Date.now(), lt = this.lastTap;
    const dbl = !!lt && btn === 0 && ts - lt.ts < 350 && Math.abs(x - lt.x) < DBL && Math.abs(y - lt.y) < DBL && lt.reg === reg;
    this.lastTap = dbl ? null : { ts, x, y, reg };
    const tool = btn === 5 ? 'erase' : this.tool, tr = this.host.getTrack();
    const g = this.g = { id: e.pointerId, type: 'none', x0: x, y0: y, x, y, dmax: 0, sh: e.shiftKey, moved: false, began: false, touch: e.pointerType === 'touch' };
    // touch gestures can turn into a pinch: keep what's needed to roll their edits back
    if (g.touch && tr && (reg === 'grid' || reg === 'vel')) g.orig = { tr, list: tr.notes.slice(), vals: tr.notes.map(o => [o.t, o.d, o.n, o.v]), sel: new Set(this.sel) };
    this.hover = null;
    if (btn === 1) return this._panStart(g);
    if (reg === 'ruler') return this._rulerDown(g, x);
    if (reg === 'keys') return this._keysDown(g, x, y, dbl);
    if (!tr) { if (g.touch && reg === 'grid') this._panStart(g); return; }
    if (reg === 'vel') return this._velDown(g, x, y, e.altKey);
    if (reg !== 'grid') return;
    const hit = tool === 'erase' ? null : this._hit(x, y);
    if (g.touch && (tool === 'erase' || (tool === 'draw' && !hit))) {
      g.type = 'hold'; g.tool = tool;
      g.timer = setTimeout(() => { if (this.g === g) { this._holdGo(); this._apply(); } }, HOLD);
      return;
    }
    if (tool === 'erase') return this._eraseStart(g, x, y);
    if (hit && dbl) { g.type = 'none'; this._delNote(hit.note); return; }
    if (hit) return this._noteDown(g, hit, e);
    if (tool === 'draw') return this._createStart(g, x, y);
    if (dbl) { g.type = 'none'; this._dblCreate(x, y, e.shiftKey); return; }
    if (g.touch) { g.tap = true; return this._panStart(g); }
    g.type = 'marquee'; g.base = e.shiftKey ? new Set(this.sel) : new Set();
    g.ct0 = this.x2t(x); g.cy0 = y - RUL + this.syr;
    if (!e.shiftKey && this.sel.size) { this.sel.clear(); this._notify(); }
    this._setIns(x);
    this._cursor('crosshair'); this.render();
  }
  _setIns(x) { const s = this._snap(), t = Math.max(0, this.x2t(x)); this.ins = Math.max(0, s ? snapTick(t, s) : Math.round(t)); }
  _move(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) { const [x, y] = this._pos(e); this.touches.set(e.pointerId, { x, y }); }
    const g = this.g;
    if (g && g.type === 'pinch') { this._pinchMove(); return; }
    if (g) { if (g.id === e.pointerId) this._dragMove(e); return; }
    if (e.pointerType !== 'touch' && !e.buttons) { const [x, y] = this._pos(e); this._hover(x, y); }
  }
  _up(e) {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') { if (this.touches.size < 2) { this.g = null; this.render(); } return; }
    if (g.id !== e.pointerId) return;
    if (g.type === 'hold') { this._holdGo(); g.late = true; } // quick tap: draw / erase at the press point now
    this._finish(true);
  }
  _cancel(e) {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') { if (this.touches.size < 2) this.g = null; return; }
    if (g.id === e.pointerId) this._finish(false, true);
  }
  _lost(e) {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') { if (this.touches.size < 2) { this.g = null; this.render(); } return; }
    if (g.id === e.pointerId) this._finish(false, false, true); // capture taken away mid-gesture: its pointerup may never come
  }
  _leave() { if (!this.g && this.hover) { this.hover = null; this._req(); } }
  _wheel(e) {
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (this.H || 400) : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomX(Math.exp(-clamp(dy || dx, -60, 60) * 0.008), e.clientX); return; }
    if (e.altKey) { e.preventDefault(); this.zoomY(Math.exp(-clamp(dy || dx, -60, 60) * 0.008), e.clientY); return; }
    if (e.shiftKey && Math.abs(dy) > Math.abs(dx)) { dx = dy; dy = 0; }
    const ox = this.sx, oy = this.sy;
    this.sx += dx / this.ppt; this.sy += dy; this.clampX(); this.clampY();
    const ch = this.sx !== ox || this.sy !== oy;
    if (ch || Math.abs(dx) >= Math.abs(dy)) e.preventDefault(); // let the page scroll once the roll hits its vertical limit
    if (ch) { if (this.g) this._apply(); this.render(); }
  }
  _dragMove(e) {
    const g = this.g, [x, y] = this._pos(e);
    g.x = x; g.y = y; g.sh = e.shiftKey;
    const d = Math.hypot(x - g.x0, y - g.y0);
    if (d > g.dmax) g.dmax = d;
    if (!g.moved && d >= (g.touch ? 6 : 3)) { g.moved = true; this._startDrag(); }
    this._apply();
    if (!this.autoRaf && this._autoDir().some(v => v)) this.autoRaf = requestAnimationFrame(this._autoTick);
  }
  _startDrag() {
    const g = this.g;
    if (g.type === 'hold') return this._holdGo();
    if (g.type !== 'move' && g.type !== 'resizeR' && g.type !== 'resizeL') return;
    const tr = this.host.getTrack();
    if (!tr) { g.type = 'none'; return; }
    const list = this.getSelection();
    if (!list.includes(g.note)) list.push(g.note);
    g.items = list.map(o => [o, o.t, o.d, o.n]); g.mt = g.note.t; g.md = g.note.d;
    let a = Infinity, lo = 127, hi = 0;
    for (const o of list) { a = Math.min(a, o.t); lo = Math.min(lo, o.n); hi = Math.max(hi, o.n); }
    g.minT = a; g.minN = lo; g.maxN = hi;
  }
  // first real change of a move/resize: only now open the undo step (and make the Alt copies), so a jittery click stays a click
  _edit0() {
    const g = this.g;
    if (g.began) return;
    this._begin(g.type === 'move' ? (g.dup ? 'Duplicate notes' : 'Move notes') : 'Resize notes');
    const tr = this.host.getTrack();
    if (!g.dup || !tr) return;
    const used = this._ids(), k = g.items.findIndex(it => it[0] === g.note);
    g.items = g.items.map(([o, t, d, n]) => { const c = { ...o, t, d, n, id: uid(used) }; tr.notes.push(c); return [c, t, d, n]; });
    g.note = g.items[k][0];
    this.sel = new Set(g.items.map(it => it[0].id)); this._notify();
  }
  _begin(label) { const g = this.g; if (g && !g.began) { g.began = true; this.host.beginEdit(label); } }
  _holdGo() {
    const g = this.g;
    if (!g || g.type !== 'hold') return;
    clearTimeout(g.timer); g.timer = 0;
    if (g.tool === 'erase') this._eraseStart(g, g.x0, g.y0); else this._createStart(g, g.x0, g.y0);
  }
  _rollback(g) {
    const o = g.orig, tr = this.host.getTrack();
    if (!o || tr !== o.tr) return;
    if (g.began) { tr.notes.length = 0; o.list.forEach((x, i) => { [x.t, x.d, x.n, x.v] = o.vals[i]; tr.notes.push(x); }); }
    this.sel = o.sel; this._notify();
  }
  _apply() {
    const g = this.g;
    if (!g) return;
    switch (g.type) {
      case 'pan': this.sx = g.sx0 - (g.x - g.x0) / this.ppt; this.sy = g.sy0 - (g.y - g.y0); this.clampX(); this.clampY(); this.render(); break;
      case 'marquee': if (g.moved) this._marquee(); break;
      case 'move': if (g.moved) this._moveApply(); break;
      case 'resizeR': case 'resizeL': if (g.moved) this._resizeApply(); break;
      case 'create': this._createApply(); break;
      case 'erase': this._eraseApply(); break;
      case 'vel': this._velApply(); break;
      case 'velpaint': this._paintApply(); break;
      case 'keys': this._keysApply(); break;
      case 'ruler': if (g.moved) this._loopApply(); break;
      case 'loopEdge': if (g.moved) this._edgeApply(); break;
    }
  }
  // click: ended by pointerup; abort: cut short (pinch / pointercancel) so a touch gesture's edits are rolled back; keep: leave pointer capture alone
  _finish(click, abort = false, keep = false) {
    const g = this.g;
    if (!g) return;
    this.g = null;
    if (g.timer) clearTimeout(g.timer);
    if (this.autoRaf) { cancelAnimationFrame(this.autoRaf); this.autoRaf = 0; }
    if (g.type === 'pinch') { this.render(); return; }
    if (!keep) try { this.el.releasePointerCapture(g.id); } catch { /* already released */ }
    if (abort) this._rollback(g);
    if (g.began || g.dmax >= DBL) this.lastTap = null; // a drag isn't the first half of a double-click
    switch (g.type) {
      case 'move': case 'resizeR': case 'resizeL':
        if (!g.began && click) {
          if (g.toggleOff) this.sel.delete(g.note.id);
          else if (g.solo) this.sel = new Set([g.note.id]);
          this._notify();
        } else if (g.began && !abort && g.type !== 'move' && g.items && g.items.length === 1) this.lastLen = g.note.d;
        this._audOff(g.aud); break;
      case 'create': {
        if (g.sized && !abort) this.lastLen = g.note.d;
        const n = g.aud;
        if (g.late && !abort) setTimeout(() => { if (!this.dead) this._audOff(n); }, 170); else this._audOff(n);
        break;
      }
      case 'keys': this._audOff(g.key); break;
      case 'pan':
        if (g.tap && !g.moved && click) { if (!g.sh && this.sel.size) { this.sel.clear(); this._notify(); } this._setIns(g.x0); }
        break;
      case 'ruler': case 'loopEdge':
        // a press that never changed the loop and barely moved is a click: set the playhead where it was pressed
        if (click && !g.looped && g.dmax < (g.touch ? 12 : 8)) {
          const s = g.sh ? 0 : this._snap(), t = Math.max(0, g.rt0);
          this.ph = Math.max(0, s ? snapTick(t, s) : Math.round(t)); this.host.setPlayhead(this.ph);
        }
        break;
    }
    if (g.began) { const tr = this.host.getTrack(); if (tr) sortNotes(tr.notes); this.host.endEdit(); }
    if (!g.touch) this._hover(g.x, g.y, true);
    this.render();
  }
  _autoDir() {
    const g = this.g;
    if (!g || !g.moved || !AUTO_X.has(g.type)) return [0, 0];
    let vx = 0, vy = 0;
    if (g.x > this.W - 6) vx = g.x - (this.W - 6) + 1; else if (g.x < GUT) vx = g.x - GUT - 1;
    if (AUTO_Y.has(g.type)) { if (g.y < RUL) vy = g.y - RUL - 1; else if (g.y > this.gb) vy = g.y - this.gb + 1; }
    return [vx, vy];
  }
  _autoTick() {
    this.autoRaf = 0;
    const [vx, vy] = this._autoDir();
    if (!vx && !vy) return;
    const sp = v => Math.sign(v) * Math.min(30, 2 + Math.abs(v) * 0.5), ox = this.sx, oy = this.sy;
    this.sx += sp(vx) / this.ppt; this.sy += sp(vy); this.clampX(); this.clampY();
    if (ox === this.sx && oy === this.sy) return;
    this._apply(); this.render();
    this.autoRaf = requestAnimationFrame(this._autoTick);
  }

  /* -------------------------------------------------------- gestures */
  _panStart(g) { g.type = 'pan'; g.sx0 = this.sx; g.sy0 = this.sy; this._cursor('grabbing'); }
  _pinchStart() {
    const [a, b] = [...this.touches.values()], mx = (a.x + b.x) / 2;
    this.g = { type: 'pinch', d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), ppt0: this.ppt, tm: this.x2t(mx), my0: (a.y + b.y) / 2, sy0: this.sy };
  }
  _pinchMove() {
    const g = this.g, [a, b] = [...this.touches.values()];
    if (!b) return;
    const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.ppt = clamp(g.ppt0 * d / g.d0, this._minPpt(), MAXPPT);
    this.sx = g.tm - (mx - GUT) / this.ppt; this.sy = g.sy0 - (my - g.my0); this.clampX(); this.clampY(); this.render();
  }
  _rulerDown(g, x) {
    const edge = this._loopEdge(x), p = this.host.getProject();
    g.rt0 = this.x2t(x);
    if (edge) { g.type = 'loopEdge'; g.edge = edge; g.et0 = p.loop[edge]; this._cursor('ew-resize'); }
    else g.type = 'ruler';
  }
  _keysDown(g, x, y, dbl) {
    g.type = 'keys'; g.key = clamp(this.y2n(y), 0, 127); g.kv = clamp(Math.round(40 + 87 * x / (GUT - 8)), 1, 127);
    this._aud(g.key, g.kv);
    if (dbl) this.selectPitch(g.key);
  }
  _keysApply() {
    const g = this.g, n = clamp(this.y2n(g.y), 0, 127);
    if (n !== g.key) { this._audOff(g.key); g.key = n; this._aud(n, g.kv); }
  }
  _noteDown(g, hit, e) {
    const nt = hit.note, was = this.sel.has(nt.id);
    if (e.shiftKey) { if (was) g.toggleOff = true; else this.sel.add(nt.id); }
    else if (!was) this.sel = new Set([nt.id]);
    else if (this.sel.size > 1) g.solo = true;
    this._notify();
    g.type = hit.part === 'r' ? 'resizeR' : hit.part === 'l' ? 'resizeL' : 'move';
    g.note = nt; g.dup = e.altKey && g.type === 'move';
    g.ct0 = this.x2t(g.x0); g.n0 = clamp(this.y2n(g.y0), 0, 127);
    g.aud = nt.n; this._aud(nt.n, nt.v);
    this._cursor(g.type === 'move' ? (g.dup ? 'copy' : 'move') : 'ew-resize');
    this.render();
  }
  _moveApply() {
    const g = this.g, snap = g.sh ? 0 : this._snap(), raw = this.x2t(g.x) - g.ct0;
    let dt = 0;
    if (g.dtOn || Math.abs(raw * this.ppt) >= 4) { g.dtOn = true; dt = snap ? snapTick(g.mt + raw, snap) - g.mt : Math.round(raw); }
    dt = Math.max(dt, -g.minT);
    const dn = clamp(this.y2n(g.y) - g.n0, -g.minN, 127 - g.maxN);
    if ((!g.began && !dt && !dn) || (dt === g.dt && dn === g.dn)) return;
    this._edit0();
    g.dt = dt; g.dn = dn;
    for (const [o, t, , n] of g.items) { o.t = t + dt; o.n = n + dn; }
    if (g.note.n !== g.aud) { this._audOff(g.aud); g.aud = g.note.n; this._aud(g.aud, g.note.v); }
    this.host.changed(); this.render();
  }
  _resizeApply() {
    const g = this.g, snap = g.sh ? 0 : this._snap(), raw = this.x2t(g.x) - g.ct0, mt = g.mt, me = g.mt + g.md;
    let dd;
    if (g.type === 'resizeR') {
      let end = snap ? snapTick(me + raw, snap) : Math.round(me + raw);
      if (end <= mt) end = snap ? snapTick(mt + 1, snap, 'ceil') : mt + 1;
      dd = end - me;
      if ((!g.began && !dd) || dd === g.dd) return;
      this._edit0();
      for (const [o, , d] of g.items) o.d = Math.max(1, Math.min(d, snap || 1), d + dd);
    } else {
      let st = snap ? snapTick(mt + raw, snap) : Math.round(mt + raw);
      if (st >= me) st = snap ? snapTick(me - 1, snap, 'floor') : me - 1;
      dd = st - mt;
      if ((!g.began && !dd) || dd === g.dd) return;
      this._edit0();
      for (const [o, t, d] of g.items) { const e = t + d, s = clamp(t + dd, 0, e - Math.max(1, Math.min(d, snap || 1))); o.t = s; o.d = e - s; }
    }
    g.dd = dd; this.host.changed(); this.render();
  }
  _createStart(g, x, y) {
    const tr = this.host.getTrack(), snap = g.sh ? 0 : this._snap(), t0 = Math.max(0, this.x2t(x));
    const t = Math.max(0, snap ? snapTick(t0, snap, 'floor') : Math.round(t0)), n = clamp(this.y2n(y), 0, 127);
    this._begin('Draw note');
    const nt = { id: uid(this._ids()), t, d: this._len(), n, v: 100 };
    tr.notes.push(nt);
    this.sel = new Set([nt.id]); this._notify();
    this.lastTap = null; // a second click on the note just drawn mustn't count as a double-click (delete)
    g.type = 'create'; g.note = nt; g.t0 = t; g.aud = n; this._aud(n, nt.v);
    this._cursor(PENCIL); this.host.changed(); this.render();
  }
  _createApply() {
    const g = this.g, nt = g.note, snap = g.sh ? 0 : this._snap();
    let ch = false;
    if (!g.sized && Math.abs(g.x - g.x0) >= 4) g.sized = true;
    if (g.sized) {
      const tt = this.x2t(g.x), end = snap ? snapTick(tt, snap, 'ceil') : Math.round(tt), d = Math.max(snap || 1, end - g.t0);
      if (d !== nt.d) { nt.d = d; ch = true; }
    }
    const n = clamp(this.y2n(g.y), 0, 127);
    if (n !== nt.n) { nt.n = n; ch = true; this._audOff(g.aud); g.aud = n; this._aud(n, nt.v); }
    if (ch) { this.host.changed(); this.render(); }
  }
  _dblCreate(x, y, noSnap) {
    const snap = noSnap ? 0 : this._snap(), t0 = Math.max(0, this.x2t(x));
    const nt = { id: uid(this._ids()), t: Math.max(0, snap ? snapTick(t0, snap, 'floor') : Math.round(t0)), d: this._len(), n: clamp(this.y2n(y), 0, 127), v: 100 };
    this.host.edit('Add note', () => { const tr = this.host.getTrack(); if (tr) { tr.notes.push(nt); sortNotes(tr.notes); } });
    this.sel = new Set([nt.id]); this._notify(); this._blip(nt.n, nt.v); this.render();
  }
  _delNote(nt) {
    this.host.edit('Delete note', () => { const tr = this.host.getTrack(), i = tr ? tr.notes.indexOf(nt) : -1; if (i >= 0) tr.notes.splice(i, 1); });
    if (this.sel.delete(nt.id)) this._notify();
    this.render();
  }
  _eraseStart(g, x, y) { g.type = 'erase'; g.lx = x; g.ly = y; this._cursor(ERASER); this._eraseAt(x, y); }
  _eraseAt(x, y) {
    const h = this._hit(x, y), tr = this.host.getTrack();
    if (!h || !tr) return;
    const i = tr.notes.indexOf(h.note);
    if (i < 0) return;
    this._begin('Erase notes');
    tr.notes.splice(i, 1);
    if (this.sel.delete(h.note.id)) this._notify();
    this.host.changed(); this.render();
  }
  _eraseApply() {
    const g = this.g, dx = g.x - g.lx, dy = g.y - g.ly, k = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3));
    for (let i = 1; i <= k; i++) this._eraseAt(g.lx + dx * i / k, g.ly + dy * i / k);
    g.lx = g.x; g.ly = g.y;
  }
  // every tool grabs the stem under the press; Alt, a press away from stems, or a sideways sweep paints a line
  _velDown(g, x, y, paint) {
    const st = paint ? null : this._stemAt(x, y);
    g.vt0 = this.x2t(x);
    if (st) {
      g.type = 'vel'; g.note = st; g.v0 = st.v;
      g.items = this.sel.has(st.id) && this.sel.size > 1 ? this.getSelection().map(o => [o, o.v]) : [[st, st.v]];
      this._cursor('ns-resize');
    } else this._paintStart(g);
    this._apply(); this._req();
  }
  _paintStart(g) { g.type = 'velpaint'; g.pt0 = g.vt0; g.py0 = g.y0; g.items = this._notes().map(o => [o, o.v]); this._cursor('crosshair'); }
  _velApply() {
    const g = this.g, ax = Math.abs(g.x - g.x0);
    if (ax >= 10 && ax > 1.5 * Math.abs(g.y - g.y0)) {
      let ch = false;
      for (const [o, ov] of g.items) if (o.v !== ov) { o.v = ov; ch = true; }
      if (ch) this.host.changed();
      this._paintStart(g); this._paintApply(); return;
    }
    const v = this.y2v(g.y), dv = v - g.v0, one = g.items.length === 1;
    let ch = false;
    for (const [o, ov] of g.items) {
      const nv = one ? v : clamp(Math.round(ov + dv), 1, 127);
      if (nv !== o.v) { this._begin('Set velocity'); o.v = nv; ch = true; }
    }
    if (ch) { this.host.changed(); this.render(); } else this._req();
  }
  _paintApply() {
    const g = this.g, t1 = this.x2t(g.x), tol = 2 / this.ppt, span = t1 - g.pt0;
    const a = Math.min(g.pt0, t1) - tol, b = Math.max(g.pt0, t1) + tol;
    let ch = false;
    for (const [o, ov] of g.items) {
      let nv = ov;
      if (o.t >= a && o.t <= b) nv = this.y2v(g.py0 + (g.y - g.py0) * (Math.abs(span) < 1e-6 ? 1 : clamp((o.t - g.pt0) / span, 0, 1)));
      if (nv !== o.v) { this._begin('Paint velocity'); o.v = nv; ch = true; }
    }
    if (ch) { this.host.changed(); this.render(); } else this._req();
  }
  _marquee() {
    const g = this.g, tr = this.host.getTrack();
    if (!tr) return;
    const t1 = this.x2t(g.x), cy1 = g.y - RUL + this.syr;
    const ta = Math.min(g.ct0, t1), tb = Math.max(g.ct0, t1);
    const nTop = 127 - Math.floor(Math.min(g.cy0, cy1) / this.rowH), nBot = 127 - Math.floor(Math.max(g.cy0, cy1) / this.rowH);
    const s = new Set(g.base);
    for (const nt of tr.notes) if (nt.n <= nTop && nt.n >= nBot && nt.t < tb && nt.t + nt.d > ta) s.add(nt.id);
    const ch = s.size !== this.sel.size;
    this.sel = s;
    if (ch) this._notify();
    this.render();
  }
  // ruler drags only touch the loop once they're clearly drags (8px mouse / 12px touch); shorter wobbles stay playhead clicks
  _loopWait(g) { return !g.looped && Math.abs(g.x - g.x0) < (g.touch ? 12 : 8); }
  _loopApply() {
    const g = this.g;
    if (this._loopWait(g)) return;
    const snap = g.sh ? 0 : this._snap(), sn = t => Math.max(0, snap ? snapTick(t, snap) : Math.round(t)), m = snap || 1;
    const a = sn(g.rt0), b = sn(this.x2t(g.x));
    if (!g.looped && a === b) return;
    let s = Math.min(a, b), e = Math.max(a, b);
    if (e - s < m) { if (b >= a) e = s + m; else { s = Math.max(0, e - m); e = s + m; } }
    if (s === g.ls && e === g.le) return;
    g.ls = s; g.le = e; g.looped = true; this.host.setLoop(s, e); this.render();
  }
  _edgeApply() {
    const g = this.g, p = this.host.getProject(), lp = p && p.loop;
    if (!lp || this._loopWait(g)) return;
    // move the edge by the pointer's travel from the grab point, then snap
    const snap = g.sh ? 0 : this._snap(), m = snap || 1, raw = Math.max(0, g.et0 + this.x2t(g.x) - g.rt0), t = snap ? snapTick(raw, snap) : Math.round(raw);
    let s = lp.start, e = lp.end;
    if (g.edge === 'start') s = clamp(t, 0, Math.max(0, e - m)); else e = Math.max(t, s + m);
    if (s !== lp.start || e !== lp.end) { g.looped = true; this.host.setLoop(s, e); this.render(); }
  }

  /* ---------------------------------------------------------- drawing */
  _frame() {
    this.raf = 0;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (dpr !== this.dpr) { this.resize(); return; }
    if (this.W < 2 || this.gh < 4) return;
    if (this.want) this._applyWant();
    if (this.dirty) {
      this.dirty = false;
      if (this.hover && !this.g) this._hover(this.hover.x, this.hover.y, true);
      this._scene(this.bctx);
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.back, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._overlay(c);
  }
  _vlines(c, y0, y1, bar, beat, snap, a) {
    const ppt = this.ppt, t0 = Math.max(0, this.x2t(GUT)), t1 = this.x2t(this.W), h = y1 - y0;
    const lines = (step, skip, style) => {
      c.beginPath();
      for (let k = Math.ceil(t0 / step - 1e-9); k * step <= t1; k++) {
        const t = k * step;
        if (skip && Math.abs(t / skip - Math.round(t / skip)) < 1e-6) continue;
        c.rect(Math.round(this.t2x(t)), y0, 1, h);
      }
      c.fillStyle = style; c.fill();
    };
    let bs = bar;
    while (bs * ppt < 8) bs *= 2;
    const sub = snap > 0 ? (snap < beat ? snap : 0) : beat / 4; // snap of a beat or more: beat & bar lines already show it
    if (sub && sub * ppt >= 6) lines(sub, beat, `rgba(255,255,255,${0.028 * a})`);
    if (beat * ppt >= 5 && beat < bar) lines(beat, bar, `rgba(255,255,255,${0.06 * a})`);
    lines(bs, 0, `rgba(255,255,255,${0.13 * a})`);
  }
  _scene(c) {
    const { W, H, dpr, ppt, rowH } = this, gb = this.gb, gw = this.gw, p = this.host.getProject(), tr = this.host.getTrack();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    if (!p) return;
    const bar = barTicks(p), beat = beatTicks(p), snap = this._snap(), lp = p.loop || {};
    const t0 = this.x2t(GUT), t1 = this.x2t(W);
    const nHi = clamp(this.y2n(RUL), 0, 127), nLo = clamp(this.y2n(gb - 1), 0, 127);
    const loopOk = lp.end > lp.start, lx0 = this.t2x(lp.start), lx1 = this.t2x(lp.end);

    // grid background, rows, loop tint, time lines
    c.save(); c.beginPath(); c.rect(GUT, RUL, gw, gb - RUL); c.clip();
    c.fillStyle = '#15161a'; c.fillRect(GUT, RUL, gw, gb - RUL);
    c.beginPath(); for (let n = nLo; n <= nHi; n++) if (isBlk(n)) c.rect(GUT, this.n2y(n), gw, rowH);
    c.fillStyle = '#0f1013'; c.fill();
    const yEnd = this.n2y(-1);
    if (yEnd < gb) { c.fillStyle = BG; c.fillRect(GUT, yEnd, gw, gb - yEnd); }
    c.beginPath(); for (let n = nLo; n <= nHi; n++) if (n % 12 === 0) c.rect(GUT, this.n2y(n) + rowH - 1, gw, 1);
    c.fillStyle = 'rgba(255,255,255,0.075)'; c.fill();
    c.beginPath(); for (let n = nLo; n <= nHi; n++) if (n % 12 === 5) c.rect(GUT, this.n2y(n) + rowH - 1, gw, 1);
    c.fillStyle = 'rgba(255,255,255,0.03)'; c.fill();
    if (loopOk && lp.on) { c.fillStyle = 'rgba(242,163,58,0.045)'; c.fillRect(lx0, RUL, lx1 - lx0, gb - RUL); }
    this._vlines(c, RUL, gb, bar, beat, snap, 1);

    // ghost notes from the other tracks
    if (this.ghosts) {
      c.beginPath();
      for (const o of p.tracks) {
        if (o === tr || !o.notes) continue;
        for (const x of o.notes) {
          if (x.t >= t1 || x.t + x.d <= t0 || x.n > nHi || x.n < nLo) continue;
          const a = Math.max(GUT - 2, this.t2x(x.t)), b = Math.min(W + 2, this.t2x(x.t + x.d));
          c.rect(Math.round(a), this.n2y(x.n) + 1, Math.max(1.5, Math.round(b) - Math.round(a)), rowH - 1);
        }
      }
      c.fillStyle = 'rgba(141,139,134,0.25)'; c.fill();
    }

    // notes, bucketed by velocity level to keep state changes low
    const sel = this.sel, un = [], se = [];
    let present = 0;
    if (tr) {
      const pal = this._pal(tr.color);
      for (let i = 0; i < 16; i++) { un.push([]); se.push([]); }
      for (const x of tr.notes) {
        const s = sel.size > 0 && sel.has(x.id);
        if (s) present++;
        if (x.t >= t1 || x.t + x.d <= t0 || x.n > nHi || x.n < nLo) continue;
        (s ? se : un)[Math.min(15, (x.v * 16 / 128) | 0)].push(x);
      }
      if (tr.mute) c.globalAlpha = 0.5;
      const rect = x => {
        const a = Math.round(Math.max(GUT - 4, this.t2x(x.t))), b = Math.max(a + 2, Math.round(Math.min(W + 4, this.t2x(x.t + x.d))));
        return [a, this.n2y(x.n), b - a];
      };
      const drawSet = (sets, fills, edge) => {
        for (let i = 0; i < 16; i++) {
          const L = sets[i];
          if (!L.length) continue;
          c.beginPath();
          for (const x of L) { const [a, y, w] = rect(x); rr(c, a + 0.5, y + 1.5, w - 1, rowH - 2, rowH >= 8 ? 2.5 : 1); }
          c.fillStyle = fills[i]; c.fill();
          c.lineWidth = 1; c.strokeStyle = edge || pal.edge[i]; c.stroke();
        }
      };
      drawSet(un, pal.fill, null);
      drawSet(se, pal.sel, '#ffffff');
      if (rowH >= 10) {
        c.font = `9px ${FONT}`; c.textBaseline = 'middle'; c.textAlign = 'left';
        for (const [sets, k] of [[un, 0], [se, 1]]) for (let i = 0; i < 16; i++) {
          if (!sets[i].length) continue;
          c.fillStyle = pal.txt[i][k];
          for (const x of sets[i]) {
            const [a, y, w] = rect(x), nm = noteName(x.n), vis = Math.min(a + w, W) - Math.max(a, GUT);
            if (vis >= nm.length * 5.6 + 8) c.fillText(nm, Math.max(a, GUT) + 4, y + rowH / 2 + 0.5);
          }
        }
      }
      c.globalAlpha = 1;
    }
    c.font = `11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#5c5a56';
    if (!tr) c.fillText('No track selected', GUT + gw / 2, RUL + (gb - RUL) / 2);
    else if (!tr.notes.length) c.fillText(this.tool === 'draw' ? 'Click and drag to draw notes' : 'Double-click to add a note, or arm the track and record', GUT + gw / 2, RUL + (gb - RUL) / 2);
    c.restore();
    if (tr && present < sel.size && !this.g) { const ids = new Set(); for (const x of tr.notes) if (sel.has(x.id)) ids.add(x.id); this.sel = ids; this._notify(); }

    // velocity lane
    const vt = H - VEL;
    c.fillStyle = '#101114'; c.fillRect(GUT, vt, gw, VEL);
    c.save(); c.beginPath(); c.rect(GUT, vt, gw, VEL); c.clip();
    if (loopOk && lp.on) { c.fillStyle = 'rgba(242,163,58,0.035)'; c.fillRect(lx0, vt, lx1 - lx0, VEL); }
    this._vlines(c, vt, H, bar, beat, snap, 0.7);
    c.fillStyle = 'rgba(255,255,255,0.045)';
    for (const v of [32, 64, 96, 127]) c.fillRect(GUT, Math.round(this.v2y(v)), gw, 1);
    if (tr) {
      const pal = this._pal(tr.color), y0 = Math.round(this.v2y(0)), us = [], ss = [];
      for (const x of tr.notes) {
        const sx = this.t2x(x.t);
        if (sx < GUT - 3 || sx > W + 3) continue;
        (sel.has(x.id) ? ss : us).push(x);
      }
      const stems = (L, line, head) => {
        if (!L.length) return;
        c.beginPath(); for (const x of L) { const sx = Math.round(this.t2x(x.t)), y = Math.round(this.v2y(x.v)); c.rect(sx, y, 1, y0 - y + 1); }
        c.fillStyle = line; c.fill();
        c.beginPath(); for (const x of L) { const sx = Math.round(this.t2x(x.t)), y = Math.round(this.v2y(x.v)); c.rect(sx - 2, y - 1, 5, 3); }
        c.fillStyle = head; c.fill();
      };
      if (tr.mute) c.globalAlpha = 0.5;
      stems(us, pal.stem, pal.head); stems(ss, 'rgba(255,255,255,0.7)', '#ffffff');
      c.globalAlpha = 1;
    }
    c.restore();
    c.fillStyle = LINE; c.fillRect(0, gb, W, 1);

    // ruler
    c.fillStyle = '#111215'; c.fillRect(GUT, 0, gw, RUL);
    c.save(); c.beginPath(); c.rect(GUT, 0, gw, RUL); c.clip();
    if (loopOk) {
      c.fillStyle = lp.on ? 'rgba(242,163,58,0.2)' : 'rgba(141,139,134,0.12)'; c.fillRect(lx0, 0, lx1 - lx0, RUL - 1);
      c.fillStyle = lp.on ? ACC : '#5b5852'; c.fillRect(lx0, 0, lx1 - lx0, 3);
      c.fillRect(Math.round(lx0), 0, 1, RUL - 1); c.fillRect(Math.round(lx1) - 1, 0, 1, RUL - 1);
    }
    const bt0 = Math.max(0, t0);
    if (beat * ppt >= 6 && beat < bar) {
      c.beginPath();
      for (let k = Math.ceil(bt0 / beat - 1e-9); k * beat <= t1; k++) if ((k * beat) % bar) c.rect(Math.round(this.t2x(k * beat)), RUL - 6, 1, 5);
      c.fillStyle = '#3a3c42'; c.fill();
    }
    let stride = 1;
    while (bar * stride * ppt < 34) stride *= 2;
    const b0 = Math.floor(bt0 / bar), b1 = Math.ceil(t1 / bar);
    if (stride > 1 && bar * ppt >= 4) {
      c.beginPath(); for (let b = b0; b <= b1; b++) if (b % stride) c.rect(Math.round(this.t2x(b * bar)), RUL - 6, 1, 5);
      c.fillStyle = '#3a3c42'; c.fill();
    }
    c.beginPath(); for (let b = b0 - (b0 % stride); b <= b1; b += stride) c.rect(Math.round(this.t2x(b * bar)), 5, 1, RUL - 6);
    c.fillStyle = '#4a4c53'; c.fill();
    c.font = `10px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#a3a09a';
    for (let b = b0 - (b0 % stride); b <= b1; b += stride) c.fillText(String(b + 1), Math.round(this.t2x(b * bar)) + 4, 13);
    if (beat * ppt >= 60 && beat < bar) {
      c.font = `9px ${FONT}`; c.fillStyle = '#5f5d58';
      for (let k = Math.ceil(bt0 / beat - 1e-9); k * beat <= t1; k++) {
        const t = k * beat, r = t % bar;
        if (r) c.fillText(`${Math.floor(t / bar) + 1}.${Math.round(r / beat) + 1}`, Math.round(this.t2x(t)) + 4, 13);
      }
    }
    c.restore();
    c.fillStyle = LINE; c.fillRect(0, RUL - 1, W, 1);

    // key gutter
    c.save(); c.beginPath(); c.rect(0, RUL, GUT, gb - RUL); c.clip();
    c.fillStyle = BG; c.fillRect(0, RUL, GUT, gb - RUL);
    const ky0 = Math.max(RUL, this.n2y(127)), ky1 = Math.min(gb, yEnd);
    c.fillStyle = '#cfccc4'; c.fillRect(0, ky0, GUT - 1, ky1 - ky0);
    c.beginPath(); for (let n = nLo; n <= nHi; n++) if (isBlk(n)) c.rect(0, this.n2y(n), BW, rowH);
    c.fillStyle = '#1d1e22'; c.fill();
    if (rowH >= 7) {
      c.beginPath(); for (let n = nLo; n <= nHi; n++) if (isBlk(n)) c.rect(BW - 5, this.n2y(n) + 1, 3, rowH - 2);
      c.fillStyle = '#35373d'; c.fill();
    }
    c.beginPath();
    for (let n = nLo; n <= nHi; n++) {
      const m = n % 12;
      if (m === 4 || m === 11) c.rect(0, this.n2y(n), GUT - 1, 1);
      else if (isBlk(n)) c.rect(BW, Math.round(this.n2y(n) + rowH / 2), GUT - 1 - BW, 1);
    }
    c.fillStyle = '#9f9c94'; c.fill();
    c.font = `9px ${FONT}`; c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let n = nLo; n <= nHi; n++) if (n % 12 === 0) { c.fillStyle = n === 60 ? '#b4721c' : '#69665f'; c.fillText(noteName(n), GUT - 5, this.n2y(n) + rowH / 2 + 0.5); }
    c.restore();
    c.fillStyle = '#050506'; c.fillRect(GUT - 1, RUL, 1, gb - RUL);

    // corners
    c.fillStyle = '#111215'; c.fillRect(0, 0, GUT, RUL - 1); c.fillRect(0, vt, GUT, VEL);
    c.fillStyle = LINE; c.fillRect(GUT - 1, 0, 1, RUL); c.fillRect(GUT - 1, vt, 1, VEL);
    c.font = `9px ${FONT}`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = MUTE; c.fillText('VEL', 8, vt + 12);
    c.textAlign = 'right'; c.fillStyle = '#4d4b47';
    c.fillText('127', GUT - 6, this.v2y(127) + 1); c.fillText('64', GUT - 6, this.v2y(64));
  }
  _info() {
    const p = this.host.getProject(), g = this.g, hv = this.hover;
    if (!p) return null;
    const bbt = t => { try { return fmtBBT(p, Math.max(0, Math.round(t))); } catch { return ''; } };
    const len = d => { const bar = barTicks(p), beat = beatTicks(p), b = Math.floor(d / bar), r = d - b * bar, k = Math.floor(r / beat); return `${b}.${k}.${String(Math.round(r - k * beat)).padStart(3, '0')}`; };
    if (g) {
      if (g.note && (g.type === 'resizeR' || (g.type === 'create' && g.sized))) return [noteName(g.note.n), 'L ' + len(g.note.d)];
      if (g.note && (g.type === 'move' || g.type === 'resizeL' || g.type === 'create')) return [noteName(g.note.n), bbt(g.note.t)];
      if (g.type === 'keys') return [noteName(g.key), ''];
      if (g.type === 'ruler' || g.type === 'loopEdge') return ['', bbt(this.x2t(g.x))];
      return null;
    }
    if (!hv) return null;
    if (hv.hit) return [noteName(hv.hit.note.n) + ' ' + hv.hit.note.v, bbt(hv.hit.note.t)];
    if (hv.reg === 'grid') return [noteName(hv.n), bbt(hv.t)];
    if (hv.reg === 'keys') return [noteName(hv.n), ''];
    if (hv.reg === 'ruler' || hv.reg === 'vel') return ['', bbt(hv.t)];
    return null;
  }
  _overlay(c) {
    const { W, H, rowH } = this, gb = this.gb, gw = this.gw, g = this.g, hv = this.hover, tr = this.host.getTrack();
    const pal = tr ? this._pal(tr.color) : this._pal(ACC);
    // grid overlays
    c.save(); c.beginPath(); c.rect(GUT, RUL, gw, gb - RUL); c.clip();
    if (hv && !g && (hv.reg === 'grid' || hv.reg === 'keys')) { c.fillStyle = 'rgba(255,255,255,0.035)'; c.fillRect(GUT, this.n2y(hv.n), gw, rowH); }
    if (this.ins != null) {
      const x = Math.round(this.t2x(this.ins));
      if (x >= GUT && x <= W) { c.fillStyle = 'rgba(233,231,226,0.28)'; for (let y = RUL; y < gb; y += 6) c.fillRect(x, y, 1, 3); }
    }
    if (hv && !g && hv.reg === 'grid') {
      if (hv.hit) {
        const h = hv.hit, a = Math.round(Math.max(GUT - 4, h.x0)), w = Math.max(2, Math.round(Math.min(W + 4, h.x1)) - a);
        c.beginPath(); rr(c, a + 0.5, this.n2y(h.note.n) + 1.5, w - 1, rowH - 2, rowH >= 8 ? 2.5 : 1);
        c.lineWidth = 1; c.strokeStyle = this.tool === 'erase' ? '#ff5a45' : 'rgba(255,255,255,0.6)'; c.stroke();
        if (this.tool === 'erase') { c.fillStyle = 'rgba(226,64,47,0.25)'; c.fill(); }
      } else if (this.tool === 'draw' && tr) {
        const s = this._snap(), t = Math.max(0, s ? snapTick(hv.t, s, 'floor') : Math.round(hv.t)), a = Math.round(this.t2x(t));
        const w = Math.max(2, Math.round(this.t2x(t + this._len())) - a);
        c.beginPath(); rr(c, a + 0.5, this.n2y(hv.n) + 1.5, w - 1, rowH - 2, rowH >= 8 ? 2.5 : 1);
        c.fillStyle = pal.ghost; c.fill(); c.strokeStyle = pal.line; c.lineWidth = 1; c.stroke();
      }
    }
    if (g && g.type === 'marquee' && g.moved) {
      const x0 = this.t2x(g.ct0), y0 = g.cy0 + RUL - this.syr, x1 = clamp(g.x, GUT, W), y1 = clamp(g.y, RUL, gb);
      const a = Math.round(Math.min(x0, x1)) + 0.5, b = Math.round(Math.min(y0, y1)) + 0.5, w = Math.round(Math.abs(x1 - x0)), h = Math.round(Math.abs(y1 - y0));
      c.fillStyle = 'rgba(242,163,58,0.08)'; c.fillRect(a, b, w, h);
      c.strokeStyle = 'rgba(242,163,58,0.8)'; c.lineWidth = 1; c.strokeRect(a, b, w, h);
    }
    c.restore();

    // pressed / hovered keys
    c.save(); c.beginPath(); c.rect(0, RUL, GUT - 1, gb - RUL); c.clip();
    const keyHi = (n, a) => { const y = this.n2y(n); c.fillStyle = `rgba(242,163,58,${a})`; if (isBlk(n)) c.fillRect(0, y, BW, rowH); else c.fillRect(0, y + 1, GUT - 1, rowH - 1); };
    if (hv && !g && (hv.reg === 'grid' || hv.reg === 'keys')) keyHi(hv.n, 0.3);
    for (const n of this.keys) keyHi(n, 0.85);
    c.restore();

    // velocity lane overlays
    const vt = H - VEL;
    c.save(); c.beginPath(); c.rect(GUT, vt, gw, VEL); c.clip();
    const stem = g && g.type === 'vel' ? g.note : hv && !g ? hv.stem : null;
    if (stem) {
      const x = Math.round(this.t2x(stem.t)), y = Math.round(this.v2y(stem.v));
      c.strokeStyle = ACC; c.lineWidth = 1; c.strokeRect(x - 3.5, y - 2.5, 8, 6);
    }
    if (g && g.type === 'velpaint') {
      c.strokeStyle = ACC; c.lineWidth = 1.5; c.beginPath(); c.moveTo(this.t2x(g.pt0), g.py0); c.lineTo(g.x, clamp(g.y, vt, H)); c.stroke();
    }
    c.restore();
    if (stem) { c.font = `600 12px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = TEXT; c.fillText(String(stem.v), 8, H - 16); }

    // insert point marker, playhead
    if (this.ins != null) {
      const x = Math.round(this.t2x(this.ins));
      if (x >= GUT && x <= W) { c.fillStyle = 'rgba(233,231,226,0.7)'; c.beginPath(); c.moveTo(x - 3.5, RUL - 1); c.lineTo(x + 4.5, RUL - 1); c.lineTo(x + 0.5, RUL - 6); c.closePath(); c.fill(); }
    }
    const px = Math.round(this.t2x(this.ph));
    if (px >= GUT && px <= W) {
      c.fillStyle = ACC; c.fillRect(px, RUL, 1, H - RUL);
      c.beginPath(); c.moveTo(px - 5, RUL - 10); c.lineTo(px + 6, RUL - 10); c.lineTo(px + 0.5, RUL - 1); c.closePath(); c.fill();
    }

    // corner readout
    const info = this._info();
    if (info) {
      c.font = `9px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
      if (info[0]) { c.fillStyle = TEXT; c.fillText(info[0], 6, 8); }
      if (info[1]) { c.fillStyle = MUTE; c.fillText(info[1], 6, 18); }
    }
    if (this.focused) { c.strokeStyle = 'rgba(242,163,58,0.35)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1); }
  }
}
