// wk.js — widget kit and shared browser infrastructure for the Serum panel, the FX rack and the editors
// (SPEC-serum §8.7.1, §9.1, §9.4). Browser ES module with no imports; nothing touches document / window /
// navigator at module top level, so node can import it (pure tests, §10.6).
//
// Exports: setPrefs/getPrefs, injectStyles, knob, numBox, menu, toggle, seg, slider, contextMenu, tooltip, loadDSP,
// plus shared infrastructure for graph.js / fx-ui.js / serum-ui.js: menuSource, fireContext, theme, fitCanvas, frame,
// wheelGate, saveFile, pickFile, ask. The injected CSS covers the widgets, the FX rack (.fxr-*) and the curve editors (.gx-*).
// `steps` and `detents` may be numbers/arrays or functions (re-read at every gesture, e.g. a BPM-synced RATE knob).
//
// Conventions shared by every widget:
//   · values are normalised n ∈ [0,1] unless the widget says otherwise (menu items carry their own `v`);
//   · `set(value, phase)` phases: 'start' (pointerdown), 'move' (dragging), 'end' (release), 'set' (discrete);
//   · a widget with `dest` renders `data-dest`; `el.wk` is the widget instance;
//   · `setMod({ arcs: [{ from, to, kind: 'sel' | 'neg' | 'other' }], live: n | null })` draws modulation
//     (knob: halo arcs + live dot, menu: underline bar, toggle: ring segment); `setMod(null)` clears it; the live
//     marker shows only while |live − base| > 0.002 (base = the control's own n, or an optional `base` field);
//   · ContextMenu / Shift+F10 and a 500 ms touch long-press dispatch a `contextmenu` MouseEvent on the
//     focusable element (bubbles), so one `contextmenu` listener serves mouse, keyboard and touch.

const SVG = 'http://www.w3.org/2000/svg';
const prefs = { tooltips: 1, dblClick: 'type', wheel: 1 };
const KIND_ORDER = { other: 0, neg: 1, sel: 2 }; // draw order: the selected source's arc ends up on top
let uid = 0;
let active = null; // close() of the open popup list or context menu (one at a time)
let lastInput = 'pointer'; // modality of the last input: 'key' → menus focus their first item, tooltips show on focus

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const call = v => typeof v === 'function' ? v() : v;
const D = () => globalThis.document || null;
const nid = p => 'wk-' + p + (++uid);
const num01 = v => clamp(+v || 0, 0, 1); // NaN / undefined → 0
const snap = (n, steps) => steps > 0 ? Math.round(num01(n) * steps) / steps : num01(n);
const isMac = () => { const n = globalThis.navigator; return !!n && /Mac|iPhone|iPad|iPod/.test(n.platform || ''); };
const ctxKey = e => e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);

function h(tag, cls, text) {
  const e = D().createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function sv(tag, a) {
  const e = D().createElementNS(SVG, tag);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
}
function attr(e, k, v) { v = String(v); if (e.getAttribute(k) !== v) e.setAttribute(k, v); } // no-op writes skipped (30 fps halos)
function listen(t, type, fn, opt) { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); }
function setDest(el, dest) {
  if (dest != null && dest !== '') attr(el, 'data-dest', dest);
  else if (el.hasAttribute('data-dest')) el.removeAttribute('data-dest');
}
function setDis(el, dis) {
  el.classList.toggle('wk-dis', dis);
  if (dis) attr(el, 'aria-disabled', 'true'); else if (el.hasAttribute('aria-disabled')) el.removeAttribute('aria-disabled');
}
function takeOver(close) { if (active && active !== close) active(false); active = close; }

/* ------------------------------------------------------------------ prefs */
export function setPrefs(p) {
  if (!p) return;
  if ('tooltips' in p) prefs.tooltips = p.tooltips ? 1 : 0;
  if ('dblClick' in p) prefs.dblClick = p.dblClick === 'reset' ? 'reset' : 'type';
  if ('wheel' in p) prefs.wheel = p.wheel ? 1 : 0;
  if (!prefs.tooltips) hideTip();
}
export function getPrefs() { return { tooltips: prefs.tooltips, dblClick: prefs.dblClick, wheel: prefs.wheel }; }

/* -------------------------------------------------------- arc geometry */
// Knob sweep: n = 0 at −135° (7:30), n = 1 at +135° (4:30), clockwise; c = centre (x = y), r = radius.
function pt(n, r, c) { const a = (-135 + 270 * n) * Math.PI / 180; return [c + r * Math.sin(a), c - r * Math.cos(a)]; }
function arc(n0, n1, r, c) {
  if (n1 < n0) { const t = n0; n0 = n1; n1 = t; }
  n0 = num01(n0); n1 = num01(n1);
  if (n1 - n0 < 1e-4) return '';
  const p0 = pt(n0, r, c), p1 = pt(n1, r, c);
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${r} ${r} 0 ${270 * (n1 - n0) > 180 ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}
// Halo arcs on an SVG group: a pool of paths (classes `wk-arc k-<kind>`) plus one live dot (`wk-live`), last.
function haloPainter(g, r, c, extra) {
  const pool = [], live = sv('circle', Object.assign({ class: 'wk-live', r: c > 20 ? 2.4 : 1.8, display: 'none' }, extra));
  g.appendChild(live);
  return (arcs, liveN) => {
    const list = (arcs || []).filter(a => a && isFinite(a.from) && isFinite(a.to))
      .sort((a, b) => (KIND_ORDER[a.kind] || 0) - (KIND_ORDER[b.kind] || 0));
    for (let i = 0; i < Math.max(list.length, pool.length); i++) {
      if (i >= list.length) { attr(pool[i], 'display', 'none'); continue; }
      if (!pool[i]) { pool[i] = sv('path', Object.assign({ class: 'wk-arc' }, extra)); g.insertBefore(pool[i], live); }
      const a = list[i], k = KIND_ORDER[a.kind] != null ? a.kind : 'other';
      attr(pool[i], 'class', 'wk-arc k-' + k);
      attr(pool[i], 'd', arc(a.from, a.to, r, c));
      if (pool[i].hasAttribute('display')) pool[i].removeAttribute('display');
    }
    if (liveN == null || !isFinite(liveN)) attr(live, 'display', 'none');
    else {
      const p = pt(num01(liveN), r, c);
      attr(live, 'cx', p[0].toFixed(2)); attr(live, 'cy', p[1].toFixed(2));
      live.removeAttribute('display');
    }
    return list.length;
  };
}
// Live marker rule (§9.4): shown only when the live value differs from the base by more than 0.002. `base` = the
// control's own n (null when unknown → shown whenever finite); `m.base` (optional) overrides it.
function liveOf(m, base) {
  const ln = m && m.live;
  if (ln == null || !isFinite(ln)) return null;
  const b = m && m.base != null && isFinite(m.base) ? +m.base : base;
  return b != null && isFinite(b) && Math.abs(ln - b) <= 0.002 ? null : ln;
}
// Underline bar (menus, numBoxes, segs, sliders): one segment per arc, x = n (vertical sliders: y = n, from the
// bottom). paint(m, base): base = the control's current n for the live-marker rule. The returned painter carries
// the bar element as `.el` (callers insert content before it).
function modBar(host, vertical) {
  const bar = h('span', 'wk-modbar' + (vertical ? ' wk-vbar' : '')), live = h('b', 'wk-mlive'), segs = [];
  const P0 = vertical ? 'bottom' : 'left', P1 = vertical ? 'height' : 'width';
  bar.setAttribute('aria-hidden', 'true');
  live.style.display = 'none';
  bar.appendChild(live);
  host.appendChild(bar);
  const paint = (m, base) => {
    const list = (m && m.arcs || []).filter(a => a && isFinite(a.from) && isFinite(a.to))
      .sort((a, b) => (KIND_ORDER[a.kind] || 0) - (KIND_ORDER[b.kind] || 0));
    for (let i = 0; i < Math.max(list.length, segs.length); i++) {
      if (i >= list.length) { segs[i].style.display = 'none'; continue; }
      if (!segs[i]) { segs[i] = h('i'); bar.insertBefore(segs[i], live); }
      const a = list[i], lo = num01(Math.min(a.from, a.to)), hi = num01(Math.max(a.from, a.to));
      segs[i].className = 'wk-mseg k-' + (KIND_ORDER[a.kind] != null ? a.kind : 'other');
      segs[i].style.display = '';
      segs[i].style[P0] = (lo * 100).toFixed(2) + '%';
      segs[i].style[P1] = (Math.max(hi - lo, 0.01) * 100).toFixed(2) + '%';
    }
    const ln = liveOf(m, base);
    if (ln == null) live.style.display = 'none';
    else { live.style.display = ''; live.style[P0] = (num01(ln) * 100).toFixed(2) + '%'; }
    host.classList.toggle('wk-modded', list.length > 0);
    return list.length;
  };
  paint.el = bar;
  return paint;
}

/* ------------------------------------------- contextmenu from keys / touch */
const synthT = new WeakMap(); // el → timeStamp of the last contextmenu the kit dispatched
const nativeT = new WeakMap(); // el → timeStamp of the last trusted contextmenu
function ctxGuard(el) {
  // A trusted contextmenu right after one the kit synthesised (ContextMenu key, Shift+F10, long-press) is the
  // browser's duplicate: swallow it so listeners see exactly one.
  el.addEventListener('contextmenu', e => {
    if (!e.isTrusted) return;
    const t = synthT.get(el);
    if (t != null && Math.abs(e.timeStamp - t) < 700) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    nativeT.set(el, e.timeStamp);
  }, true);
}
function fireCtx(el, x, y) { // no x/y = from the keyboard (menu opens with its first item focused)
  lastInput = x == null ? 'key' : 'pointer';
  if (x == null) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  const E = globalThis.MouseEvent || globalThis.Event;
  const ev = new E('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 2, buttons: 0 });
  synthT.set(el, ev.timeStamp);
  el.dispatchEvent(ev);
}
// Touch long-press (500 ms, ≤ 8 px travel) → contextmenu at the touch point; `fire` runs first.
function longPress(el, e, fire) {
  if (e.pointerType !== 'touch') return null;
  const x = e.clientX, y = e.clientY, t0 = e.timeStamp;
  let id = setTimeout(() => {
    id = 0;
    const n = nativeT.get(el);
    if (n != null && n >= t0) return; // the browser already opened it (Android)
    if (fire) fire();
    fireCtx(el, x, y);
  }, 500);
  return {
    move(ev) { if (id && Math.hypot(ev.clientX - x, ev.clientY - y) > 8) { clearTimeout(id); id = 0; } },
    cancel() { if (id) clearTimeout(id); id = 0; },
  };
}

/* --------------------------------------------------------------- wheel */
function wheelIn(focusEl, e, hoverT) {
  // only taken when the control has focus or the pointer has rested on it (not while the page scrolls past)
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0); // Shift+wheel arrives as deltaX in Chromium/macOS
  if (!d) return null;
  if (D().activeElement !== focusEl && e.timeStamp - hoverT < 300) return null;
  return { px: d * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), notch: e.deltaMode > 0 || Math.abs(d) >= 50 };
}
function wheelSteps(acc, w, t) { // whole steps (+ = up): one per notch, one per 40 px of trackpad travel
  if (w.notch) return -Math.sign(w.px);
  if (t - acc.t > 200) acc.v = 0;
  acc.t = t; acc.v += w.px;
  const n = Math.trunc(acc.v / 40);
  acc.v -= n * 40;
  return -n;
}
// The widgets' wheel rules for custom controls (fx-ui displays): take(e) → whole steps (+ = up; 0 = taken, no full
// step yet) when prefs.wheel is on and `focusEl` (default el) has focus or the pointer has rested on `el` for
// ≥ 300 ms; otherwise null — the caller must then leave the event alone (no preventDefault) so the page scrolls.
// Trackpad deltas accumulate (one step per 40 px), mouse / line / page deltas give one step per notch.
export function wheelGate(el, focusEl) {
  let hoverT = -1e9;
  const acc = { v: 0, t: -1e9 }, enter = e => { hoverT = e.timeStamp; };
  el.addEventListener('pointerenter', enter);
  const take = e => {
    if (!prefs.wheel) return null;
    const w = wheelIn(focusEl || el, e, hoverT);
    return w ? wheelSteps(acc, w, e.timeStamp) : null;
  };
  take.destroy = () => el.removeEventListener('pointerenter', enter);
  return take;
}

/* ---------------------------------------------------------------- knob */
export function knob(o) {
  ensureCSS(D());
  const stepsOf = () => { const s = call(o.steps); return s > 0 ? Math.round(s) : 0; };
  const size = o.size === 'sm' || o.size === 'lg' ? o.size : 'md';
  const el = h('div', 'wk-knob wk-' + size);
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  const svg = sv('svg', { class: 'wk-svg', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' });
  const halo = sv('g', { class: 'wk-halo' });
  const track = sv('circle', { class: 'wk-track', cx: 32, cy: 32, r: 23, 'stroke-dasharray': '108.38 144.51', transform: 'rotate(135 32 32)' });
  const face = sv('circle', { class: 'wk-face', cx: 32, cy: 32, r: 17 });
  const val = sv('path', { class: 'wk-val', d: '' });
  const ptr = sv('line', { class: 'wk-ptr', x1: 32, y1: 32, x2: 32, y2: 32 });
  svg.append(halo, track, face, val, ptr);
  const lab = h('span', 'wk-lab'), out = h('span', 'wk-num'), dh = h('span', 'wk-dh');
  dh.setAttribute('aria-hidden', 'true');
  el.append(svg, lab, out, dh);
  const paint = haloPainter(halo, 29, 32);
  const fmt = o.fmt || (n => Math.round(n * 100) + '%');
  const W = { el, update, setMod, focus, edit, reset, destroy };
  el.wk = W;
  ctxGuard(el);

  let cur = NaN, curBip = null, text = null, dis = false, mod = null, g = null, inp = null, lastTap = null, lastType = 'mouse', hoverT = -1e9;
  const wacc = { v: 0, t: -1e9 };

  function update() {
    const n = num01(o.get()), bip = !!call(o.bipolar);
    setDest(el, call(o.dest));
    const L = String(o.labelToggle && o.labelToggle.get() ? call(o.labelToggle.alt) : call(o.label));
    if (lab.textContent !== L) lab.textContent = L;
    attr(el, 'aria-label', L);
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    if (n !== cur || bip !== curBip) { // the value arc also follows a change of the bipolar flag (RULINGS, E6)
      cur = n; curBip = bip;
      attr(val, 'd', arc(bip ? 0.5 : 0, n, 23, 32));
      const a = pt(n, 6, 32), b = pt(n, 15.5, 32);
      ptr.setAttribute('x1', a[0].toFixed(2)); ptr.setAttribute('y1', a[1].toFixed(2));
      ptr.setAttribute('x2', b[0].toFixed(2)); ptr.setAttribute('y2', b[1].toFixed(2));
      attr(el, 'aria-valuenow', Math.round(n * 1000) / 10);
    }
    const t = String(fmt(n));
    if (t !== text) { text = t; out.textContent = t; el.setAttribute('aria-valuetext', t); }
    if (mod) setMod(mod);
    refreshTip(el);
  }
  function setMod(m) {
    mod = m && ((m.arcs && m.arcs.length) || m.live != null) ? m : null;
    const live = liveOf(mod, cur);
    el.classList.toggle('wk-modded', paint(mod && mod.arcs, live) > 0);
  }
  function put(n, ph) {
    n = snap(n, stepsOf());
    if (ph === 'set' && n === cur && n === num01(o.get())) return;
    o.set(n, ph);
    update();
  }
  function reset() { const d = call(o.def); if (d != null && !dis) put(d, 'set'); }
  function focus() { el.focus({ preventScroll: true }); }

  /* pointer */
  el.addEventListener('pointerdown', e => {
    if (e.target === inp || e.button !== 0 || g) return;
    lastType = e.pointerType || 'mouse';
    if (e.ctrlKey && isMac()) return; // macOS Ctrl-click is a right-click: the contextmenu event follows
    if (dis) return;
    e.preventDefault();
    focus();
    if (e.metaKey || e.ctrlKey) { reset(); return; } // Cmd/Ctrl-click = reset to def
    const n0 = num01(o.get()), steps = stepsOf();
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, n: n0, k0: 0, p: n0, moved: false, touch: lastType === 'touch', lp: null, steps };
    if (steps) g.p = g.k0 = Math.round(n0 * steps);
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    el.classList.add('wk-drag');
    o.set(n0, 'start');
    g.lp = longPress(el, e, finish);
  });
  el.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { finish(); return; } // a swallowed pointerup never leaves a drag running
    let d = (g.y - e.clientY) + (e.clientX - g.x); // up and right both increase
    g.x = e.clientX; g.y = e.clientY;
    if (g.lp) g.lp.move(e);
    if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 6) g.moved = true;
    if (e.shiftKey) d *= 0.1;
    const steps = g.steps;
    let n;
    if (steps) { // 1 step per 8 px
      g.p = clamp(g.p + d / 8, 0, steps);
      n = (g.p >= g.k0 ? Math.floor(g.p + 1e-9) : Math.ceil(g.p - 1e-9)) / steps;
    } else { // 200 px = full range
      g.p = clamp(g.p + d / 200, 0, 1);
      n = detent(g.p, e.shiftKey);
    }
    if (n !== g.n) { g.n = n; o.set(n, 'move'); update(); }
  });
  // Snap windows: ±4 px of drag (Shift: ±0.4 px of the ×0.1 travel), but never more than 0.4 × the distance to the
  // nearest other detent, so free travel always remains between close detents (Compressor RATIO above 4:1).
  let detW = null;
  function detent(p, fine) {
    const dets = call(o.detents);
    if (!dets || !dets.length) return p;
    if (!detW || detW.src !== dets) {
      detW = { src: dets, w: dets.map((v, i) => {
        let near = Infinity;
        dets.forEach((u, j) => { if (j !== i && u !== v) near = Math.min(near, Math.abs(u - v)); });
        return near * 0.4;
      }) };
    }
    const r = (fine ? 0.4 : 4) / 200;
    let best = p, bd = Infinity;
    dets.forEach((v, i) => { const d = Math.abs(p - v); if (d <= Math.min(r, detW.w[i]) && d < bd) { bd = d; best = v; } });
    return best;
  }
  function finish() {
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { el.releasePointerCapture(G.id); } catch (err) { /* already released */ }
    el.classList.remove('wk-drag');
    o.set(G.n, 'end');
    update();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('contextmenu', () => { if (g) { lastTap = null; finish(); } });
  el.addEventListener('dblclick', e => {
    if (dis || e.target === inp || lastType === 'touch') return;
    e.preventDefault();
    if (prefs.dblClick === 'reset') reset(); else edit();
  });
  el.addEventListener('pointerenter', e => { hoverT = e.timeStamp; });
  el.addEventListener('wheel', e => {
    if (!prefs.wheel || dis || g || inp) return;
    const w = wheelIn(el, e, hoverT);
    if (!w) return;
    e.preventDefault();
    const cur = num01(o.get()), steps = stepsOf();
    if (steps) {
      const k = wheelSteps(wacc, w, e.timeStamp);
      if (k) put((Math.round(cur * steps) + k) / steps, 'set');
    } else put(cur + (w.notch ? -Math.sign(w.px) * 0.01 : clamp(-w.px / 4000, -0.02, 0.02)) * (e.shiftKey ? 0.1 : 1), 'set');
  }, { passive: false });

  /* keys */
  el.addEventListener('keydown', e => {
    if (e.target !== el) return;
    if (ctxKey(e)) { e.preventDefault(); fireCtx(el); return; }
    if (dis) return;
    const steps = stepsOf(), k = e.key, sm = steps ? 1 / steps : e.shiftKey ? 0.001 : 0.01, cur = num01(o.get());
    let n = null;
    if (k === 'ArrowUp' || k === 'ArrowRight') n = cur + sm;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') n = cur - sm;
    else if (k === 'PageUp' || k === 'PageDown') n = cur + (k === 'PageUp' ? 1 : -1) * (steps ? Math.max(1, Math.round(steps / 10)) / steps : 0.1);
    else if (k === 'Home') n = 0;
    else if (k === 'End') n = 1;
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); reset(); return; }
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    if (n === null) return;
    e.preventDefault();
    put(n, 'set');
  });

  /* typed entry */
  function edit() {
    if (inp || dis) return;
    inp = h('input', 'wk-in');
    inp.type = 'text';
    inp.value = out.textContent;
    inp.setAttribute('aria-label', lab.textContent + ' value');
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('spellcheck', 'false');
    el.classList.add('wk-editing');
    el.appendChild(inp);
    let done = false;
    const end = (ok, refocus) => {
      if (done) return;
      done = true;
      const t = inp.value, i = inp;
      inp = null;
      if (refocus) focus();
      i.remove();
      el.classList.remove('wk-editing');
      if (!ok) return;
      const v = o.parse ? o.parse(t) : parsePct(t);
      if (v != null && isFinite(v)) put(v, 'set');
      else { el.classList.add('wk-bad'); setTimeout(() => el.classList.remove('wk-bad'), 700); }
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); end(true, true); }
      else if (e.key === 'Escape') { e.preventDefault(); end(false, true); }
    });
    inp.addEventListener('blur', () => end(true, false));
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    inp.focus();
    inp.select();
  }

  /* MIX ↔ LEVEL style label flip */
  if (o.labelToggle) {
    lab.classList.add('wk-lt');
    lab.setAttribute('role', 'button');
    lab.tabIndex = 0;
    const flip = e => {
      e.preventDefault(); e.stopPropagation();
      o.labelToggle.set(o.labelToggle.get() ? 0 : 1);
      update();
    };
    lab.addEventListener('pointerdown', e => e.stopPropagation()); // not a knob drag
    lab.addEventListener('click', flip);
    lab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') flip(e); });
  }
  if (o.title) tooltip(el, () => o.title);

  function destroy() {
    if (g) finish();
    if (inp) { inp.remove(); inp = null; }
    hideTip(el);
    el.remove();
    el.wk = null;
  }
  update();
  return W;
}
// Default typed-entry parser: a number is a percentage of the range ("50", "50 %", "12.5%").
function parsePct(t) {
  const m = /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*%?\s*$/.exec(String(t));
  return m ? clamp(parseFloat(m[1].replace(',', '.')) / 100, 0, 1) : null;
}

/* ---------------------------------------------------------------- menu */
const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
function indexOfV(list, v) { for (let i = 0; i < list.length; i++) if (same(list[i].v, v)) return i; return -1; }

export function menu(o) {
  ensureCSS(D());
  const arrows = o.arrows !== false, wheelOn = o.wheel !== false;
  const el = h('div', 'wk-menu');
  const lab = o.label ? h('span', 'wk-lab', o.label) : null;
  const row = h('div', 'wk-mrow');
  const btn = h('button', 'wk-mbtn');
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const txt = h('span', 'wk-mtxt'), caret = h('span', 'wk-caret', '▾');
  caret.setAttribute('aria-hidden', 'true');
  btn.append(txt, caret);
  let prev = null, next = null;
  if (arrows) {
    prev = h('button', 'wk-arr wk-prev', '◀'); next = h('button', 'wk-arr wk-next', '▶');
    for (const [b, t] of [[prev, 'Previous'], [next, 'Next']]) {
      b.type = 'button';
      b.tabIndex = -1; // one tab stop: ←/→ on the button step too
      b.setAttribute('aria-label', t + (o.label ? ' ' + o.label : ''));
    }
    prev.addEventListener('click', () => step(-1, true));
    next.addEventListener('click', () => step(1, true));
    row.append(prev, btn, next);
  } else row.append(btn);
  if (lab) el.append(lab);
  el.append(row);
  const bar = modBar(el);
  const W = { el, update, setMod, focus, open, close, destroy };
  el.wk = W;
  ctxGuard(btn);
  let P = null, hoverT = -1e9, lp = null, noClick = false, mod = null;
  const wacc = { v: 0, t: -1e9 };

  function update() {
    const list = o.items(), i = indexOfV(list, o.get());
    const t = i >= 0 ? list[i].label : '—';
    if (txt.textContent !== t) txt.textContent = t;
    attr(btn, 'aria-label', (o.label ? o.label + ': ' : '') + t);
    setDest(el, call(o.dest));
    if (mod) setMod(mod);
    refreshTip(btn);
  }
  // base n of a menu = position of the current item in the list (items enumerate the dest's grid in order:
  // fx-ui's v = index, serum-ui's v = k / hi); o.n() overrides it
  function baseN() {
    if (o.n) return num01(o.n());
    const list = o.items(), i = indexOfV(list, o.get());
    return i >= 0 && list.length > 1 ? i / (list.length - 1) : null;
  }
  function setMod(m) { mod = m || null; bar(mod, mod ? baseN() : null); }
  function focus() { btn.focus({ preventScroll: true }); }
  function choose(it) {
    if (!same(it.v, o.get())) o.set(it.v, 'set');
    update();
  }
  // o.stepGroup: the arrows / wheel / ←→ stay inside the current item's group (a folder), wrapping there; a group
  // of one item (or an ungrouped item) steps through the whole list
  function step(dir, wrap) {
    let list = o.items();
    if (o.stepGroup) {
      const c = indexOfV(list, o.get()), g = c >= 0 ? list[c].group : undefined;
      if (g !== undefined && g !== null) { const sub = list.filter(it => it.group === g); if (sub.length > 1) list = sub; }
    }
    const n = list.length;
    let i = indexOfV(list, o.get());
    if (i < 0) i = dir > 0 ? -1 : n;
    for (let c = 0; c < n; c++) {
      i += dir;
      if (i < 0 || i >= n) { if (!wrap) return; i = (i + n) % n; }
      if (!list[i].disabled) { choose(list[i]); return; }
    }
  }

  btn.addEventListener('click', () => {
    if (noClick) { noClick = false; return; }
    if (P) close(true); else open();
  });
  btn.addEventListener('keydown', e => {
    noClick = false;
    if (ctxKey(e)) { e.preventDefault(); fireCtx(btn); return; }
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); open(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); step(k === 'ArrowLeft' ? -1 : 1, true); }
  });
  btn.addEventListener('pointerdown', e => {
    noClick = false;
    if (lp) lp.cancel();
    lp = longPress(btn, e, () => { noClick = true; close(false); });
  });
  btn.addEventListener('pointermove', e => { if (lp) lp.move(e); });
  for (const t of ['pointerup', 'pointercancel']) btn.addEventListener(t, () => { if (lp) lp.cancel(); lp = null; });
  btn.addEventListener('contextmenu', () => { if (lp) { noClick = true; close(false); } });
  el.addEventListener('pointerenter', e => { hoverT = e.timeStamp; });
  if (wheelOn) el.addEventListener('wheel', e => {
    if (!prefs.wheel || P) return;
    const w = wheelIn(btn, e, hoverT);
    if (!w) return;
    e.preventDefault();
    const k = wheelSteps(wacc, w, e.timeStamp);
    if (k) step(-k, false); // wheel up = previous entry (list order), no wrap
  }, { passive: false });

  /* popup list */
  function open() {
    if (P) return;
    const d = D(), list = o.items();
    if (!list.length) return;
    takeOver(close);
    const cur = indexOfV(list, o.get()), grouped = list.some(it => it.group);
    const root = h('div', 'wk-pop' + (grouped ? ' wk-grouped' : ''));
    root.id = nid('lb');
    root.setAttribute('role', 'listbox');
    root.setAttribute('aria-label', o.label || 'Options');
    root.tabIndex = -1;
    const opts = [];
    let box = root, gname, gi = -1;
    list.forEach((it, i) => {
      if (grouped && (gi < 0 || it.group !== gname)) {
        gname = it.group; gi++;
        box = h('div', 'wk-grp');
        box.setAttribute('role', 'group');
        if (gname) { box.setAttribute('aria-label', gname); const gh = h('div', 'wk-gh', gname); gh.setAttribute('aria-hidden', 'true'); box.append(gh); }
        root.append(box);
      }
      const oe = h('div', 'wk-opt', it.label);
      oe.id = root.id + '-' + i;
      oe.setAttribute('role', 'option');
      oe.setAttribute('aria-selected', i === cur ? 'true' : 'false');
      if (it.disabled) oe.setAttribute('aria-disabled', 'true');
      oe.addEventListener('pointermove', () => setAct(i, false));
      oe.addEventListener('click', e => { e.stopPropagation(); if (!it.disabled) { choose(it); close(true); } });
      box.append(oe);
      opts.push({ el: oe, it, g: gi });
    });
    d.body.appendChild(root);
    P = { root, opts, act: -1, buf: '', bufT: -1e9, offs: [] };
    placeBelow(root, btn);
    attr(btn, 'aria-expanded', 'true');
    btn.setAttribute('aria-controls', root.id);
    root.addEventListener('keydown', popKey);
    const win = d.defaultView || globalThis;
    P.offs.push(
      listen(d, 'pointerdown', e => { if (!root.contains(e.target) && !btn.contains(e.target)) close(false); }, true),
      listen(win, 'scroll', e => { if (!(e.target && e.target.nodeType && root.contains(e.target))) close(false); }, true),
      listen(win, 'resize', () => close(false)),
    );
    setAct(cur >= 0 && !list[cur].disabled ? cur : firstEnabled(0, 1), true);
    root.focus();
  }
  function firstEnabled(from, dir) {
    const n = P.opts.length;
    for (let c = 0, i = from; c < n; c++, i += dir) if (i >= 0 && i < n && !P.opts[i].it.disabled) return i;
    return -1;
  }
  function setAct(i, scroll) {
    if (!P || i < 0 || i === P.act) return;
    if (P.act >= 0) P.opts[P.act].el.classList.remove('wk-act');
    P.act = i;
    const oe = P.opts[i].el;
    oe.classList.add('wk-act');
    P.root.setAttribute('aria-activedescendant', oe.id);
    if (scroll && oe.scrollIntoView) oe.scrollIntoView({ block: 'nearest' });
  }
  function moveAct(dir, by) { // by = how many enabled options to skip over
    const n = P.opts.length;
    let i = P.act, last = P.act;
    for (let left = by; left > 0;) {
      i += dir;
      if (i < 0 || i >= n) break;
      if (!P.opts[i].it.disabled) { last = i; left--; }
    }
    if (last < 0) last = firstEnabled(dir > 0 ? 0 : n - 1, dir);
    setAct(last, true);
  }
  function popKey(e) {
    const k = e.key, n = P.opts.length;
    e.stopPropagation();
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); moveAct(k === 'ArrowDown' ? 1 : -1, 1); }
    else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); moveAct(k === 'PageDown' ? 1 : -1, 10); }
    else if (k === 'Home') { e.preventDefault(); setAct(firstEnabled(0, 1), true); }
    else if (k === 'End') { e.preventDefault(); setAct(firstEnabled(n - 1, -1), true); }
    else if (k === 'ArrowRight' || k === 'ArrowLeft') { // jump between groups (columns)
      e.preventDefault();
      const g0 = P.act >= 0 ? P.opts[P.act].g : 0, dir = k === 'ArrowRight' ? 1 : -1;
      for (let i = 0; i < n; i++) if (P.opts[i].g === g0 + dir && !P.opts[i].it.disabled) { setAct(i, true); break; }
    }
    else if (k === 'Enter' || (k === ' ' && !(P.buf && e.timeStamp - P.bufT < 700))) {
      e.preventDefault();
      if (P.act >= 0) { choose(P.opts[P.act].it); close(true); }
    }
    else if (k === 'Escape') { e.preventDefault(); close(true); }
    else if (k === 'Tab') { e.preventDefault(); close(true); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { // type-ahead
      P.buf = e.timeStamp - P.bufT > 700 ? k : P.buf + k;
      P.bufT = e.timeStamp;
      const q = (/^(.)\1+$/.test(P.buf) ? P.buf[0] : P.buf).toLowerCase(); // 'rrr' cycles through the r… entries
      const s = q.length === 1 ? P.act + 1 : Math.max(P.act, 0);
      for (let c = 0; c < n; c++) {
        const j = (s + c) % n, it = P.opts[j].it;
        if (!it.disabled && String(it.label).toLowerCase().startsWith(q)) { setAct(j, true); break; }
      }
    }
  }
  function close(refocus) {
    if (!P) return;
    const p = P;
    P = null;
    for (const f of p.offs) f();
    p.root.remove();
    attr(btn, 'aria-expanded', 'false');
    btn.removeAttribute('aria-controls');
    if (active === close) active = null;
    if (refocus) focus();
  }
  function destroy() { close(false); if (lp) lp.cancel(); hideTip(btn); el.remove(); el.wk = null; }
  update();
  return W;
}
function placeBelow(pop, anchor) {
  const win = D().defaultView || globalThis, vw = win.innerWidth || 1e4, vh = win.innerHeight || 1e4;
  const a = anchor.getBoundingClientRect();
  pop.style.minWidth = Math.round(a.width) + 'px';
  pop.style.left = '0px'; pop.style.top = '0px';
  const r = pop.getBoundingClientRect();
  let top = a.bottom + 2;
  if (top + r.height > vh - 4 && a.top - 2 - r.height >= 4) top = a.top - 2 - r.height; // flip above
  else if (top + r.height > vh - 4) top = Math.max(4, vh - 4 - r.height);
  pop.style.left = Math.round(clamp(a.left, 4, Math.max(4, vw - 4 - r.width))) + 'px';
  pop.style.top = Math.round(top) + 'px';
}

/* -------------------------------------------------------------- toggle */
export function toggle(o) {
  ensureCSS(D());
  const kind = o.kind === 'btn' || o.kind === 'power' ? o.kind : 'led';
  const el = h('button', 'wk-tog wk-' + kind);
  el.type = 'button';
  if (kind === 'power') {
    const ic = sv('svg', { class: 'wk-pic', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
    ic.append(sv('path', { d: 'M5.2 3.6a5.5 5.5 0 1 0 5.6 0' }), sv('line', { x1: 8, y1: 1.5, x2: 8, y2: 7.5 }));
    el.append(ic);
  } else {
    if (kind === 'led') { const dot = h('span', 'wk-dot'); dot.setAttribute('aria-hidden', 'true'); el.append(dot); }
    const shown = o.text !== undefined ? o.text : o.label; // o.text = '' → an LED without visible text
    if (shown !== '') el.append(h('span', 'wk-tl', shown));
  }
  const ring = sv('svg', { class: 'wk-ring', viewBox: '0 0 40 40', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const paint = haloPainter(ring, 18, 20, { 'vector-effect': 'non-scaling-stroke' });
  el.append(ring);
  const W = { el, update, setMod, focus, destroy };
  el.wk = W;
  ctxGuard(el);
  let dis = false, lp = null, noClick = false, mod = null;

  function on() { return +o.get() >= 0.5; }
  function update() {
    const v = on();
    el.classList.toggle('wk-on', v);
    attr(el, 'aria-pressed', v ? 'true' : 'false');
    attr(el, 'aria-label', o.label);
    setDest(el, call(o.dest));
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    if (mod) setMod(mod);
    refreshTip(el);
  }
  function setMod(m) { mod = m || null; el.classList.toggle('wk-modded', paint(mod && mod.arcs, liveOf(mod, on() ? 1 : 0)) > 0); }
  function focus() { el.focus({ preventScroll: true }); }
  el.addEventListener('click', e => {
    if (noClick) { noClick = false; e.preventDefault(); return; }
    if (dis) return;
    o.set(on() ? 0 : 1, 'set');
    update();
  });
  el.addEventListener('keydown', e => { noClick = false; if (ctxKey(e)) { e.preventDefault(); fireCtx(el); } });
  el.addEventListener('pointerdown', e => {
    noClick = false;
    if (lp) lp.cancel();
    lp = longPress(el, e, () => { noClick = true; });
  });
  el.addEventListener('pointermove', e => { if (lp) lp.move(e); });
  for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, () => { if (lp) lp.cancel(); lp = null; });
  el.addEventListener('contextmenu', () => { if (lp) noClick = true; }); // a menu opened mid-press (long-press) eats its click
  function destroy() { if (lp) lp.cancel(); hideTip(el); el.remove(); el.wk = null; }
  update();
  return W;
}

/* ----------------------------------------------------- typed entry (shared) */
// Inline text entry over a widget: Enter / blur commit, Escape cancels. commit(text) → false flashes `wk-bad`.
function typeIn(host, el, label, text, commit, onEnd) {
  const inp = h('input', 'wk-in');
  inp.type = 'text';
  inp.value = text;
  inp.setAttribute('aria-label', label + ' value');
  inp.setAttribute('autocomplete', 'off');
  inp.setAttribute('spellcheck', 'false');
  el.classList.add('wk-editing');
  host.appendChild(inp);
  let done = false;
  const end = (ok, refocus) => {
    if (done) return;
    done = true;
    const t = inp.value;
    onEnd();
    if (refocus) el.focus({ preventScroll: true });
    inp.remove();
    el.classList.remove('wk-editing');
    if (ok && !commit(t)) { el.classList.add('wk-bad'); setTimeout(() => el.classList.remove('wk-bad'), 700); }
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); end(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); end(false, true); }
  });
  inp.addEventListener('blur', () => end(true, false));
  inp.addEventListener('pointerdown', e => e.stopPropagation());
  inp.focus();
  inp.select();
  return { inp, cancel: () => end(false, false) };
}
const NUM_RE = /[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)/;
// Inverse of a stepped display format: the grid value whose text equals the typed text, else the one whose
// leading number is nearest to the typed number (numBox default parser).
function invertFmt(text, st, fmt) {
  const t = String(text).trim().toLowerCase();
  if (!t) return null;
  const m = NUM_RE.exec(t), want = m ? parseFloat(m[0].replace(',', '.')) : NaN;
  let best = -1, bd = Infinity;
  for (let k = 0; k <= st; k++) {
    const s = String(fmt(k / st)).trim().toLowerCase();
    if (s === t) return k / st;
    if (!m) continue;
    const q = NUM_RE.exec(s);
    if (q) { const d = Math.abs(parseFloat(q[0].replace(',', '.')) - want); if (d < bd - 1e-12) { bd = d; best = k; } }
  }
  return best >= 0 ? best / st : null;
}

/* -------------------------------------------------------------- numBox */
// { dest?, label, get, set, def, fmt, parse?, steps, min?, max?, disabled? } — value in n, `steps` = grid count,
// min/max = n bounds. Vertical drag 8 px per step (grids of more than 100 steps: a full sweep is 800 px), Shift
// ×0.25, wheel 1 step per notch, keys like the knob, double-click / Enter typed entry (or reset, per prefs).
export function numBox(o) {
  ensureCSS(D());
  const el = h('div', 'wk-nb');
  el.setAttribute('role', 'spinbutton');
  el.tabIndex = 0;
  const lab = h('span', 'wk-lab'), box = h('span', 'wk-nbv'), txt = h('span', 'wk-nbt');
  box.append(txt);
  el.append(lab, box);
  const bar = modBar(box);
  const W = { el, update, setMod, focus, edit, reset, destroy };
  el.wk = W;
  ctxGuard(el);
  const stepsOf = () => { const s = call(o.steps); return s > 0 ? Math.round(s) : 100; };
  const kLims = st => [Math.ceil((o.min != null ? num01(call(o.min)) : 0) * st - 1e-9), Math.floor((o.max != null ? num01(call(o.max)) : 1) * st + 1e-9)];
  const fmt = n => String(o.fmt ? o.fmt(n) : Math.round(n * stepsOf()));
  let cur = NaN, text = null, dis = false, g = null, ti = null, lastTap = null, lastType = 'mouse', hoverT = -1e9, mod = null;
  const wacc = { v: 0, t: -1e9 };

  function update() {
    const st = stepsOf(), n = num01(o.get()), L = String(call(o.label) || ''), lim = kLims(st);
    setDest(el, call(o.dest));
    if (lab.textContent !== L) lab.textContent = L;
    lab.style.display = L ? '' : 'none';
    attr(el, 'aria-label', L || 'Value');
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    attr(el, 'aria-valuemin', lim[0]); attr(el, 'aria-valuemax', lim[1]);
    if (n !== cur) { cur = n; attr(el, 'aria-valuenow', Math.round(n * st)); }
    const t = fmt(n);
    if (t !== text) { text = t; txt.textContent = t; el.setAttribute('aria-valuetext', t); }
    if (mod) setMod(mod);
    refreshTip(el);
  }
  function setMod(m) { mod = m || null; el.classList.toggle('wk-modded', bar(mod, num01(o.get())) > 0); }
  function put(k, ph) { // k = grid index
    const st = stepsOf(), lim = kLims(st), n = clamp(Math.round(k), lim[0], lim[1]) / st + 0; // + 0: never -0
    if (ph === 'set' && n === num01(o.get())) { update(); return; }
    o.set(n, ph);
    update();
  }
  function reset() { const d = call(o.def); if (d != null && !dis) put(num01(d) * stepsOf(), 'set'); }
  function focus() { el.focus({ preventScroll: true }); }
  const kNow = () => Math.round(num01(o.get()) * stepsOf());

  el.addEventListener('pointerdown', e => {
    if ((ti && e.target === ti.inp) || e.button !== 0 || g) return;
    lastType = e.pointerType || 'mouse';
    if (e.ctrlKey && isMac()) return;
    if (dis) return;
    e.preventDefault();
    focus();
    if (e.metaKey || e.ctrlKey) { reset(); return; }
    const st = stepsOf(), n0 = num01(o.get()), k0 = Math.round(n0 * st);
    g = { id: e.pointerId, y: e.clientY, x0: e.clientX, y0: e.clientY, st, k0, p: k0, k: k0, px: st > 100 ? 800 / st : 8, moved: false, touch: lastType === 'touch', lp: null };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    el.classList.add('wk-drag');
    o.set(n0, 'start');
    g.lp = longPress(el, e, finish);
  });
  el.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { finish(); return; }
    if (g.lp) g.lp.move(e);
    if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 6) g.moved = true;
    const lim = kLims(g.st);
    g.p = clamp(g.p + (g.y - e.clientY) * (e.shiftKey ? 0.25 : 1) / g.px, lim[0], lim[1]);
    g.y = e.clientY;
    const k = g.p >= g.k0 ? Math.floor(g.p + 1e-9) : Math.ceil(g.p - 1e-9);
    if (k !== g.k) { g.k = k; o.set(k / g.st + 0, 'move'); update(); }
  });
  function finish() {
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { el.releasePointerCapture(G.id); } catch (err) { /* already released */ }
    el.classList.remove('wk-drag');
    o.set(G.k / G.st + 0, 'end');
    update();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('contextmenu', () => { if (g) { lastTap = null; finish(); } });
  el.addEventListener('dblclick', e => {
    if (dis || (ti && e.target === ti.inp) || lastType === 'touch') return;
    e.preventDefault();
    if (prefs.dblClick === 'reset') reset(); else edit();
  });
  el.addEventListener('pointerenter', e => { hoverT = e.timeStamp; });
  el.addEventListener('wheel', e => {
    if (!prefs.wheel || dis || g || ti) return;
    const w = wheelIn(el, e, hoverT);
    if (!w) return;
    e.preventDefault();
    const k = wheelSteps(wacc, w, e.timeStamp);
    if (k) put(kNow() + k, 'set');
  }, { passive: false });
  el.addEventListener('keydown', e => {
    if (e.target !== el) return;
    if (ctxKey(e)) { e.preventDefault(); fireCtx(el); return; }
    if (dis) return;
    const k = e.key, st = stepsOf(), big = Math.max(1, Math.round(st / 10));
    let to = null;
    if (k === 'ArrowUp' || k === 'ArrowRight') to = kNow() + 1;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') to = kNow() - 1;
    else if (k === 'PageUp' || k === 'PageDown') to = kNow() + (k === 'PageUp' ? big : -big);
    else if (k === 'Home') to = kLims(st)[0];
    else if (k === 'End') to = kLims(st)[1];
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); reset(); return; }
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    if (to === null) return;
    e.preventDefault();
    put(to, 'set');
  });
  function edit() {
    if (ti || dis) return;
    ti = typeIn(box, el, lab.textContent || 'Value', txt.textContent, t => {
      const st = stepsOf(), v = o.parse ? o.parse(t) : invertFmt(t, st, n => fmt(n));
      if (v == null || !isFinite(v)) return false;
      put(num01(v) * st, 'set');
      return true;
    }, () => { ti = null; });
  }
  function destroy() { if (g) finish(); if (ti) ti.cancel(); hideTip(el); el.remove(); el.wk = null; }
  update();
  return W;
}

/* ----------------------------------------------------------------- seg */
// { dest?, label?, items: [labels] | () => [labels], get: () => idx, set: (idx, 'set') => void, disabled? } —
// segmented switch with radio semantics (one tab stop; arrows move and select; Home / End).
export function seg(o) {
  ensureCSS(D());
  const el = h('div', 'wk-seg');
  el.setAttribute('role', 'radiogroup');
  const lab = h('span', 'wk-lab'), row = h('div', 'wk-segs');
  el.append(lab, row);
  const bar = modBar(row);
  const W = { el, update, setMod, focus, destroy };
  el.wk = W;
  let btns = [], key = null, dis = false, lp = null, noClick = false, mod = null;

  function build() {
    const items = (call(o.items) || []).map(String), k = items.join('\u0001');
    if (k === key) return;
    key = k;
    for (const b of btns) b.remove();
    btns = items.map((t, i) => {
      const b = h('button', 'wk-sb', t);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      ctxGuard(b);
      b.addEventListener('click', e => { if (noClick) { noClick = false; e.preventDefault(); return; } choose(i, false); });
      b.addEventListener('keydown', e => onKey(e, i));
      b.addEventListener('pointerdown', e => { noClick = false; if (lp) lp.cancel(); lp = longPress(b, e, () => { noClick = true; }); });
      b.addEventListener('pointermove', e => { if (lp) lp.move(e); });
      for (const t2 of ['pointerup', 'pointercancel']) b.addEventListener(t2, () => { if (lp) lp.cancel(); lp = null; });
      b.addEventListener('contextmenu', () => { if (lp) noClick = true; });
      row.insertBefore(b, bar.el);
      return b;
    });
  }
  function idx() { const v = +o.get(); return Number.isInteger(v) && v >= 0 && v < btns.length ? v : -1; }
  function update() {
    build();
    const i0 = idx(), L = String(call(o.label) || '');
    if (lab.textContent !== L) lab.textContent = L;
    lab.style.display = L ? '' : 'none';
    attr(el, 'aria-label', L || 'Options');
    setDest(el, call(o.dest));
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    btns.forEach((b, i) => {
      b.classList.toggle('wk-on', i === i0);
      attr(b, 'aria-checked', i === i0 ? 'true' : 'false');
      b.tabIndex = i === i0 || (i0 < 0 && i === 0) ? 0 : -1;
    });
    if (mod) setMod(mod);
    refreshTip(el);
  }
  function choose(i, keyFocus) {
    if (dis || i < 0 || i >= btns.length) return;
    if (i !== idx()) o.set(i, 'set');
    update();
    if (keyFocus) btns[i].focus({ preventScroll: true });
  }
  function onKey(e, i) {
    if (ctxKey(e)) { e.preventDefault(); fireCtx(btns[i]); return; }
    const k = e.key, n = btns.length;
    let j = -1;
    if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % n;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + n) % n;
    else if (k === 'Home') j = 0;
    else if (k === 'End') j = n - 1;
    if (j < 0) return;
    e.preventDefault();
    choose(j, true);
  }
  // base n = selected index over the grid (the items enumerate the dest's values in order)
  function setMod(m) { mod = m || null; const i = idx(); el.classList.toggle('wk-modded', bar(mod, i >= 0 && btns.length > 1 ? i / (btns.length - 1) : null) > 0); }
  function focus() { const i = idx(); const b = btns[i >= 0 ? i : 0]; if (b) b.focus({ preventScroll: true }); }
  function destroy() { if (lp) lp.cancel(); hideTip(el); el.remove(); el.wk = null; }
  update();
  return W;
}

/* -------------------------------------------------------------- slider */
// { get, set, def, fmt, parse?, bipolar, orient: 'h' | 'v', dest?, label?, steps?, disabled? } — value in n
// (callers map n to their own range, e.g. matrix amount = 2n − 1). Grab the thumb for a relative drag; pressing
// elsewhere on the track jumps there first. Full track length = full range, Shift ×0.1; wheel / keys / typed
// entry / reset like the knob.
export function slider(o) {
  ensureCSS(D());
  const vert = o.orient === 'v';
  const el = h('div', 'wk-sl ' + (vert ? 'wk-v' : 'wk-h'));
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  el.setAttribute('aria-orientation', vert ? 'vertical' : 'horizontal');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  const lab = h('span', 'wk-lab'), trk = h('div', 'wk-slt'), fill = h('div', 'wk-slf'), thumb = h('div', 'wk-slk'), out = h('span', 'wk-num');
  trk.append(fill, thumb);
  el.append(lab, trk, out);
  const bar = modBar(trk, vert);
  const W = { el, update, setMod, focus, edit, reset, destroy };
  el.wk = W;
  ctxGuard(el);
  const stepsOf = () => { const s = call(o.steps); return s > 0 ? Math.round(s) : 0; };
  const fmt = n => String(o.fmt ? o.fmt(n) : Math.round(n * 100) + '%');
  const P0 = vert ? 'bottom' : 'left', P1 = vert ? 'height' : 'width';
  let cur = NaN, text = null, dis = false, g = null, ti = null, lastTap = null, lastType = 'mouse', hoverT = -1e9, mod = null;
  const wacc = { v: 0, t: -1e9 };

  function update() {
    const n = num01(o.get()), L = String(call(o.label) || '');
    setDest(el, call(o.dest));
    if (lab.textContent !== L) lab.textContent = L;
    lab.style.display = L ? '' : 'none';
    attr(el, 'aria-label', L || 'Value');
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    if (n !== cur) {
      cur = n;
      const a = o.bipolar ? Math.min(0.5, n) : 0, b = o.bipolar ? Math.max(0.5, n) : n;
      fill.style[P0] = (a * 100).toFixed(2) + '%';
      fill.style[P1] = ((b - a) * 100).toFixed(2) + '%';
      thumb.style[P0] = (n * 100).toFixed(2) + '%';
      attr(el, 'aria-valuenow', Math.round(n * 1000) / 10);
    }
    const t = fmt(n);
    if (t !== text) { text = t; out.textContent = t; el.setAttribute('aria-valuetext', t); }
    if (mod) setMod(mod);
    refreshTip(el);
  }
  function setMod(m) { mod = m || null; el.classList.toggle('wk-modded', bar(mod, num01(o.get())) > 0); }
  function put(n, ph) {
    n = snap(n, stepsOf());
    if (ph === 'set' && n === num01(o.get())) { update(); return; }
    o.set(n, ph);
    update();
  }
  function reset() { const d = call(o.def); if (d != null && !dis) put(+d, 'set'); }
  function focus() { el.focus({ preventScroll: true }); }
  function posOf(e) { // pointer position on the track as n, and the track length in px
    const r = trk.getBoundingClientRect(), len = Math.max(1, vert ? r.height : r.width);
    return { n: vert ? (r.bottom - e.clientY) / len : (e.clientX - r.left) / len, len };
  }

  el.addEventListener('pointerdown', e => {
    if ((ti && e.target === ti.inp) || e.button !== 0 || g) return;
    lastType = e.pointerType || 'mouse';
    if (e.ctrlKey && isMac()) return;
    if (dis) return;
    e.preventDefault();
    focus();
    if (e.metaKey || e.ctrlKey) { reset(); return; }
    const n0 = num01(o.get()), pos = posOf(e);
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, len: pos.len, p: n0, n: n0, moved: false, touch: lastType === 'touch', lp: null };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    el.classList.add('wk-drag');
    o.set(n0, 'start');
    const grab = (lastType === 'touch' ? 16 : 8) / pos.len;
    if (e.target !== thumb && pos.n >= -grab && pos.n <= 1 + grab && Math.abs(pos.n - n0) > grab) { // jump
      g.p = clamp(pos.n, 0, 1);
      const n = snap(g.p, stepsOf());
      if (n !== g.n) { g.n = n; o.set(n, 'move'); update(); }
    }
    g.lp = longPress(el, e, finish);
  });
  el.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { finish(); return; }
    if (g.lp) g.lp.move(e);
    if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 6) g.moved = true;
    const d = vert ? g.y - e.clientY : e.clientX - g.x;
    g.x = e.clientX; g.y = e.clientY;
    g.p = clamp(g.p + d / g.len * (e.shiftKey ? 0.1 : 1), 0, 1);
    const n = snap(g.p, stepsOf());
    if (n !== g.n) { g.n = n; o.set(n, 'move'); update(); }
  });
  function finish() {
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { el.releasePointerCapture(G.id); } catch (err) { /* already released */ }
    el.classList.remove('wk-drag');
    o.set(G.n, 'end');
    update();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('contextmenu', () => { if (g) { lastTap = null; finish(); } });
  el.addEventListener('dblclick', e => {
    if (dis || (ti && e.target === ti.inp) || lastType === 'touch') return;
    e.preventDefault();
    if (prefs.dblClick === 'reset') reset(); else edit();
  });
  el.addEventListener('pointerenter', e => { hoverT = e.timeStamp; });
  el.addEventListener('wheel', e => {
    if (!prefs.wheel || dis || g || ti) return;
    const w = wheelIn(el, e, hoverT);
    if (!w) return;
    e.preventDefault();
    const cur0 = num01(o.get()), steps = stepsOf();
    if (steps) { const k = wheelSteps(wacc, w, e.timeStamp); if (k) put((Math.round(cur0 * steps) + k) / steps, 'set'); }
    else put(cur0 + (w.notch ? -Math.sign(w.px) * 0.01 : clamp(-w.px / 4000, -0.02, 0.02)) * (e.shiftKey ? 0.1 : 1), 'set');
  }, { passive: false });
  el.addEventListener('keydown', e => {
    if (e.target !== el) return;
    if (ctxKey(e)) { e.preventDefault(); fireCtx(el); return; }
    if (dis) return;
    const steps = stepsOf(), k = e.key, sm = steps ? 1 / steps : e.shiftKey ? 0.001 : 0.01, c = num01(o.get());
    let n = null;
    if (k === 'ArrowUp' || k === 'ArrowRight') n = c + sm;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') n = c - sm;
    else if (k === 'PageUp' || k === 'PageDown') n = c + (k === 'PageUp' ? 1 : -1) * (steps ? Math.max(1, Math.round(steps / 10)) / steps : 0.1);
    else if (k === 'Home') n = 0;
    else if (k === 'End') n = 1;
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); reset(); return; }
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    if (n === null) return;
    e.preventDefault();
    put(clamp(n, 0, 1), 'set');
  });
  function edit() {
    if (ti || dis) return;
    ti = typeIn(el, el, lab.textContent || 'Value', out.textContent, t => {
      const v = o.parse ? o.parse(t) : parsePct(t);
      if (v == null || !isFinite(v)) return false;
      put(clamp(v, 0, 1), 'set');
      return true;
    }, () => { ti = null; });
  }
  function destroy() { if (g) finish(); if (ti) ti.cancel(); hideTip(el); el.remove(); el.wk = null; }
  update();
  return W;
}

/* ------------------------------------------- shared browser infrastructure */
// Dispatch the kit's `contextmenu` on `el` (no x/y = keyboard origin: the menu focuses its first item).
export function fireContext(el, x, y) { fireCtx(el, x, y); }
// Makes a custom element a context-menu source like the widgets: ContextMenu / Shift+F10 (unless keys = false)
// and a 500 ms touch long-press dispatch one `contextmenu`. Returns a remover.
export function menuSource(el, opts) {
  const keys = !opts || opts.keys !== false;
  ctxGuard(el);
  let lp = null;
  const offs = [
    listen(el, 'keydown', e => { if (keys && e.target === el && ctxKey(e)) { e.preventDefault(); fireCtx(el); } }),
    listen(el, 'pointerdown', e => { if (lp) lp.cancel(); lp = longPress(el, e, null); }),
    listen(el, 'pointermove', e => { if (lp) lp.move(e); }),
    listen(el, 'pointerup', () => { if (lp) lp.cancel(); lp = null; }),
    listen(el, 'pointercancel', () => { if (lp) lp.cancel(); lp = null; }),
  ];
  return () => { for (const f of offs) f(); if (lp) lp.cancel(); };
}
// Theme tokens (§9.1) as resolved on `el` (custom properties), with the spec defaults as fallbacks.
const TOKENS = { bg: ['--sx-bg', '#0f1216'], panel: ['--sx-panel', '#161b21'], panel2: ['--sx-panel2', '#1c232b'], line: ['--sx-line', '#2a333d'],
  ink: ['--sx-ink', '#dfe6ee'], mute: ['--sx-mute', '#7f8b98'], accent: ['--sx-accent', '#4fb3ff'], neg: ['--sx-neg', '#ffb347'],
  on: ['--sx-on', '#6fe3a1'], warn: ['--sx-warn', '#ff6a4a'], graph: ['--sx-graph', '#59c2ff'], ui: ['--ui', 'system-ui, sans-serif'],
  mono: ['--mono', 'ui-monospace, monospace'] };
export function theme(el) {
  const d = D(), win = d && d.defaultView || globalThis;
  let cs = null;
  try { cs = el && win.getComputedStyle ? win.getComputedStyle(el) : null; } catch (err) { cs = null; }
  const out = {};
  for (const k in TOKENS) {
    const v = cs && cs.getPropertyValue ? String(cs.getPropertyValue(TOKENS[k][0]) || '').trim() : '';
    out[k] = v || TOKENS[k][1];
  }
  return out;
}
// Size a canvas for its CSS box at the device pixel ratio; returns the 2D context in CSS px (or null).
export function fitCanvas(cv, w, hgt) {
  const d = D(), win = d && d.defaultView || globalThis, dpr = Math.min(3, Math.max(1, +win.devicePixelRatio || 1));
  const Wd = Math.max(1, Math.round(w * dpr)), Hd = Math.max(1, Math.round(hgt * dpr));
  if (cv.width !== Wd) cv.width = Wd;
  if (cv.height !== Hd) cv.height = Hd;
  const ctx = cv.getContext ? cv.getContext('2d') : null;
  if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
// One animation frame (setTimeout fallback); returns a cancel function.
export function frame(fn) {
  const r = globalThis.requestAnimationFrame, c = globalThis.cancelAnimationFrame;
  if (typeof r === 'function') { const id = r(fn); return () => { if (c) c(id); }; }
  const id = setTimeout(() => fn(Date.now()), 16);
  if (id && typeof id.unref === 'function') id.unref(); // node: never keeps the process alive
  return () => clearTimeout(id);
}
export function reducedMotion() {
  try { const m = globalThis.matchMedia; return !!(m && m('(prefers-reduced-motion: reduce)').matches); } catch (err) { return false; }
}
// Text file download (JSON exports).
export function saveFile(name, text, type) {
  const d = D();
  try {
    if (!d || typeof Blob === 'undefined' || !globalThis.URL || !URL.createObjectURL) return false;
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    const a = d.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    d.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (err) {
    console.warn('wk.saveFile failed', err);
    return false;
  }
}
// File picker → Promise<File | null> (resolves null when cancelled where the browser reports it).
export function pickFile(accept) {
  const d = D();
  if (!d) return Promise.resolve(null);
  return new Promise(res => {
    try {
      const inp = d.createElement('input');
      inp.type = 'file';
      if (accept) inp.accept = accept;
      inp.style.display = 'none';
      const done = f => { inp.remove(); res(f || null); };
      inp.addEventListener('change', () => done(inp.files && inp.files[0]));
      inp.addEventListener('cancel', () => done(null));
      d.body.appendChild(inp);
      inp.click();
    } catch (err) { res(null); }
  });
}
// Text prompt (null when unavailable or cancelled).
export function ask(msg, def) {
  try { const p = globalThis.prompt; return typeof p === 'function' ? p(msg, def == null ? '' : def) : null; } catch (err) { return null; }
}

/* --------------------------------------------------------- context menu */
// items: [{ label, action?, checked?, disabled?, sub?: items, sep? }]. Escape closes the innermost level
// (the root level closes the menu); outside pointerdown, scroll, resize and window blur close everything.
export function contextMenu(x, y, items, opts) {
  const d = D();
  if (!d) return { el: null, close() {} };
  ensureCSS(d);
  const anchor = opts && opts.anchor || null, prevFocus = d.activeElement;
  const win = d.defaultView || globalThis, kb = lastInput === 'key';
  const levels = [];
  let closed = false, armed = false, offs = [];
  takeOver(close);

  function level(list, px, py, parent) {
    const m = h('div', 'wk-ctx');
    m.setAttribute('role', 'menu');
    m.tabIndex = -1;
    const L = { el: m, list, nodes: [], act: -1, parent, sub: null };
    list.forEach((it, i) => {
      if (!it || it.sep) {
        const s = h('div', 'wk-sep');
        s.setAttribute('role', 'separator');
        m.append(s); L.nodes.push(null);
        return;
      }
      const e = h('div', 'wk-ci');
      e.tabIndex = -1;
      e.setAttribute('role', it.checked != null ? 'menuitemcheckbox' : 'menuitem');
      if (it.checked != null) e.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if (it.disabled) e.setAttribute('aria-disabled', 'true');
      if (it.sub) { e.setAttribute('aria-haspopup', 'menu'); e.setAttribute('aria-expanded', 'false'); }
      const ck = h('span', 'wk-ck', it.checked ? '✓' : '');
      ck.setAttribute('aria-hidden', 'true');
      e.append(ck, h('span', 'wk-cl', it.label));
      if (it.sub) { const ar = h('span', 'wk-cs', '▸'); ar.setAttribute('aria-hidden', 'true'); e.append(ar); }
      e.addEventListener('pointerenter', () => hover(L, i));
      e.addEventListener('click', ev => { ev.stopPropagation(); if (armed) pick(L, i, false); });
      m.append(e); L.nodes.push(e);
    });
    m.addEventListener('keydown', ev => key(L, ev));
    m.addEventListener('contextmenu', ev => ev.preventDefault()); // no browser menu over ours
    d.body.appendChild(m);
    place(m, px, py, parent);
    levels.push(L);
    return L;
  }
  function place(m, px, py, parent) {
    const vw = win.innerWidth || 1e4, vh = win.innerHeight || 1e4;
    m.style.left = '0px'; m.style.top = '0px';
    const r = m.getBoundingClientRect();
    let l = px, t = py;
    if (l + r.width > vw - 4) l = parent ? parent.r.left - r.width + 2 : px - r.width; // flip left of the pointer / parent item
    if (t + r.height > vh - 4) t = !parent && py - r.height >= 4 ? py - r.height : vh - 4 - r.height;
    m.style.left = Math.round(clamp(l, 4, Math.max(4, vw - 4 - r.width))) + 'px';
    m.style.top = Math.round(Math.max(4, t)) + 'px';
  }
  const usable = (L, i) => !!L.nodes[i] && !L.list[i].disabled;
  function setAct(L, i) {
    if (L.act >= 0 && L.nodes[L.act]) L.nodes[L.act].classList.remove('wk-act');
    L.act = i;
    if (i >= 0 && L.nodes[i]) { L.nodes[i].classList.add('wk-act'); L.nodes[i].focus(); }
    else L.el.focus();
  }
  function move(L, dir, from) {
    const n = L.list.length;
    let i = from != null ? from : L.act;
    for (let c = 0; c < n; c++) {
      i = i < 0 && dir < 0 ? n - 1 : (i + dir + n) % n;
      if (usable(L, i)) { setAct(L, i); return; }
    }
  }
  function hover(L, i) {
    if (closed) return;
    if (L.sub && L.sub.idx !== i) closeSub(L);
    if (!usable(L, i)) return;
    setAct(L, i);
    if (L.list[i].sub && !L.list[i].disabled) openSub(L, i, false);
  }
  function openSub(L, i, focusFirst) {
    if (!(L.sub && L.sub.idx === i)) {
      closeSub(L);
      const node = L.nodes[i], r = node.getBoundingClientRect();
      L.sub = { idx: i, L: level(L.list[i].sub, r.right - 2, r.top - 4, { L, i, r }) };
      node.setAttribute('aria-expanded', 'true');
    }
    if (focusFirst) move(L.sub.L, 1, -1);
  }
  function closeSub(L) {
    if (!L.sub) return;
    const S = L.sub.L;
    closeSub(S);
    S.el.remove();
    levels.splice(levels.indexOf(S), 1);
    L.nodes[L.sub.idx].setAttribute('aria-expanded', 'false');
    L.sub = null;
  }
  function pick(L, i) {
    const it = L.list[i];
    if (!usable(L, i)) return;
    if (it.sub) { openSub(L, i, true); return; }
    close(true);
    if (it.action) it.action();
  }
  function key(L, e) {
    const k = e.key;
    e.stopPropagation();
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); move(L, k === 'ArrowDown' ? 1 : -1); }
    else if (k === 'Home') { e.preventDefault(); move(L, 1, -1); }
    else if (k === 'End') { e.preventDefault(); move(L, -1, L.list.length); }
    else if (k === 'ArrowRight') { e.preventDefault(); if (L.act >= 0 && L.list[L.act].sub && usable(L, L.act)) openSub(L, L.act, true); }
    else if ((k === 'ArrowLeft' || k === 'Escape') && L.parent) { e.preventDefault(); const Pl = L.parent.L; closeSub(Pl); setAct(Pl, Pl.act); }
    else if (k === 'Escape' || k === 'Tab') { e.preventDefault(); close(true); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (L.act >= 0) pick(L, L.act); }
    else if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) { // first-letter jump
      const n = L.list.length, q = k.toLowerCase();
      for (let c = 1; c <= n; c++) {
        const i = (Math.max(L.act, -1) + c + n) % n;
        if (usable(L, i) && String(L.list[i].label).toLowerCase().startsWith(q)) { setAct(L, i); break; }
      }
    }
  }
  function inside(t) { return !!(t && t.nodeType) && levels.some(L => L.el.contains(t)); }
  function close(restore) {
    if (closed) return;
    closed = true;
    for (const f of offs) f();
    for (const L of levels) L.el.remove();
    levels.length = 0;
    if (active === close) active = null;
    if (restore) {
      const t = anchor || prevFocus;
      if (t && t.focus && t.parentNode && t !== d.body) t.focus({ preventScroll: true });
    }
  }

  const root = level(items || [], x, y, null);
  offs = [
    listen(d, 'pointerdown', e => { if (inside(e.target)) armed = true; else close(false); }, true),
    listen(win, 'scroll', e => { if (!inside(e.target)) close(false); }, true),
    listen(win, 'resize', () => close(false)),
    listen(win, 'blur', () => close(false)),
  ];
  if (kb) move(root, 1, -1); else root.el.focus({ preventScroll: true });
  return { el: root.el, close: () => close(false) };
}

/* -------------------------------------------------------------- tooltip */
const tips = new WeakMap(); // el → textFn
let tipEl = null, tipOwner = null, tipTimer = 0, tipPending = null;
export function tooltip(el, textFn) {
  ensureCSS(D());
  const had = tips.has(el);
  tips.set(el, textFn);
  if (!had) {
    el.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch' || !tips.has(el)) return;
      clearTimeout(tipTimer);
      tipPending = el;
      tipTimer = setTimeout(() => { tipPending = null; showTip(el); }, 450);
    });
    el.addEventListener('pointerleave', () => hideTip(el));
    el.addEventListener('focus', () => { if (lastInput === 'key') showTip(el); });
    el.addEventListener('blur', () => hideTip(el));
    el.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(el); });
  }
  return { update: () => refreshTip(el), hide: () => hideTip(el), destroy() { tips.delete(el); hideTip(el); } };
}
function showTip(el) {
  const d = D(), fn = tips.get(el);
  if (!d || !fn || !prefs.tooltips || !el.parentNode) return;
  const t = fn();
  if (!t) { hideTip(el); return; }
  if (!tipEl) {
    tipEl = h('div', 'wk-tip');
    tipEl.id = 'wk-tip';
    tipEl.setAttribute('role', 'tooltip');
  }
  if (tipEl.parentNode !== d.body) d.body.appendChild(tipEl);
  if (tipOwner && tipOwner !== el) tipOwner.removeAttribute('aria-describedby');
  tipOwner = el;
  tipEl.textContent = String(t);
  el.setAttribute('aria-describedby', 'wk-tip');
  const win = d.defaultView || globalThis, a = el.getBoundingClientRect(), r = tipEl.getBoundingClientRect();
  const vw = win.innerWidth || 1e4;
  let top = a.top - 6 - r.height;
  if (top < 4) top = a.bottom + 6;
  tipEl.style.left = Math.round(clamp(a.left + a.width / 2 - r.width / 2, 4, Math.max(4, vw - 4 - r.width))) + 'px';
  tipEl.style.top = Math.round(top) + 'px';
  tipEl.classList.add('wk-show');
}
function hideTip(el) {
  if (!el || tipPending === el) { clearTimeout(tipTimer); tipPending = null; }
  if (!tipEl || (el && tipOwner !== el)) return;
  tipEl.classList.remove('wk-show');
  if (tipOwner) tipOwner.removeAttribute('aria-describedby');
  tipOwner = null;
}
function refreshTip(el) { if (tipOwner === el && tipEl && tipEl.classList.contains('wk-show')) showTip(el); }

/* ------------------------------------------------------------ DSP loader */
// Injects each classic DSP script once per document (keyed by path, so 'serum-dsp.js?v=5' and 'serum-dsp.js'
// are the same script), in order (async = false). Resolves when every script has loaded, failed or timed out;
// never rejects. A missing, broken or failed script yields null for its global.
const DSP_GLOBALS = { 'serum-dsp.js': 'SerumDSP', 'fx-dsp.js': 'FXDSP' };
const dspLoads = new WeakMap(); // document → Map(path → Promise)
export function loadDSP(urls = ['serum-dsp.js', 'fx-dsp.js']) {
  const d = D();
  const result = () => ({ SerumDSP: globalThis.SerumDSP || null, FXDSP: globalThis.FXDSP || null });
  if (!d || typeof d.createElement !== 'function') return Promise.resolve(result());
  let m = dspLoads.get(d);
  if (!m) { m = new Map(); dspLoads.set(d, m); }
  const ps = [];
  for (const u of urls || []) {
    const key = scriptPath(d, u);
    let p = m.get(key);
    if (!p) { p = inject(d, String(u), DSP_GLOBALS[key.split('/').pop()]); m.set(key, p); }
    ps.push(p);
  }
  return Promise.all(ps).then(result, result);
}
function scriptPath(d, u) {
  try { return new URL(String(u), d.baseURI || 'http://localhost/').pathname; } catch (err) { return String(u).split(/[?#]/)[0]; }
}
function inject(d, url, g) {
  if (g && globalThis[g] !== undefined) return Promise.resolve(); // already evaluated (static <script> or an earlier loader)
  return new Promise(res => {
    let t = 0, done = false;
    try {
      const s = d.createElement('script');
      const fin = ok => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (!ok) console.warn('wk.loadDSP: could not load ' + url);
        res();
      };
      s.addEventListener('load', () => fin(true));
      s.addEventListener('error', () => fin(false));
      t = setTimeout(() => fin(false), 20000);
      s.async = false;
      s.src = url;
      (d.head || d.documentElement || d.body).appendChild(s);
    } catch (err) {
      clearTimeout(t);
      console.warn('wk.loadDSP: could not load ' + url, err);
      res();
    }
  });
}

/* ------------------------------------------------------------------ CSS */
const CSS = `
.wk-knob, .wk-menu, .wk-tog, .wk-pop, .wk-ctx, .wk-tip { box-sizing: border-box; }
.wk-knob { position: relative; display: inline-flex; flex-direction: column; align-items: center; min-width: 32px; padding: 2px 1px; border-radius: 6px; color: var(--sx-ink, #dfe6ee); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; cursor: ns-resize; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; }
.wk-knob .wk-svg { display: block; width: var(--wk-d, 40px); height: var(--wk-d, 40px); overflow: visible; }
.wk-sm { --wk-d: 28px; } .wk-md { --wk-d: 40px; } .wk-lg { --wk-d: 52px; }
.wk-track { fill: none; stroke: var(--sx-line, #2a333d); stroke-width: 4; stroke-linecap: round; }
.wk-face { fill: var(--sx-panel2, #1c232b); stroke: rgba(0, 0, 0, 0.55); stroke-width: 1; }
.wk-val { fill: none; stroke: var(--sx-graph, #59c2ff); stroke-width: 4; stroke-linecap: round; }
.wk-ptr { stroke: var(--sx-ink, #dfe6ee); stroke-width: 3; stroke-linecap: round; }
.wk-arc { fill: none; stroke-width: 3; }
.wk-ring .wk-arc { stroke-width: 2; }
.k-sel { stroke: var(--sx-accent, #4fb3ff); } .k-neg { stroke: var(--sx-neg, #ffb347); } .k-other { stroke: var(--sx-mute, #7f8b98); }
.wk-live { fill: #fff; stroke: var(--sx-bg, #0f1216); stroke-width: 1; }
.wk-knob .wk-lab { margin-top: 1px; color: var(--sx-mute, #7f8b98); white-space: nowrap; }
.wk-knob .wk-lt { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
.wk-knob .wk-lt:hover, .wk-knob .wk-lt:focus-visible { color: var(--sx-ink, #dfe6ee); outline: none; }
.wk-num { min-height: 12px; color: var(--sx-ink, #dfe6ee); font: 500 10px/1.2 var(--mono, ui-monospace, monospace); letter-spacing: 0; text-transform: none; white-space: nowrap; }
.wk-sm .wk-lab, .wk-sm .wk-num { font-size: 8px; }
.wk-knob:hover .wk-track { stroke: var(--sx-mute, #7f8b98); }
.wk-knob:focus-visible { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.wk-knob.wk-drag .wk-val { stroke: var(--sx-accent, #4fb3ff); }
.wk-knob.wk-dis { opacity: 0.4; cursor: default; }
.wk-bad .wk-num { color: var(--sx-warn, #ff6a4a); }
.wk-editing .wk-num { visibility: hidden; }
.wk-in { position: absolute; left: 50%; bottom: 1px; width: 72px; transform: translateX(-50%); padding: 1px 3px; color: var(--sx-ink, #dfe6ee); background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-accent, #4fb3ff); border-radius: 3px; font: 500 11px/1.2 var(--mono, ui-monospace, monospace); text-align: center; outline: none; z-index: 2; }
.wk-dh { display: none; position: absolute; left: 0; top: 0; width: 9px; height: 9px; border-top: 2px solid var(--sx-accent, #4fb3ff); border-left: 2px solid var(--sx-accent, #4fb3ff); border-radius: 2px 0 0 0; cursor: ns-resize; }
.wk-modded > .wk-dh { display: block; }
.wk-menu { position: relative; display: inline-flex; flex-direction: column; gap: 2px; min-width: 0; color: var(--sx-ink, #dfe6ee); font: 500 11px/1.2 var(--ui, system-ui, sans-serif); }
.wk-menu > .wk-lab { color: var(--sx-mute, #7f8b98); font-size: 9px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
.wk-mrow { display: flex; align-items: stretch; min-width: 0; }
.wk-mbtn, .wk-arr { min-height: 24px; margin: 0; color: inherit; background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); font: inherit; cursor: pointer; }
.wk-mbtn { flex: 1 1 auto; display: flex; align-items: center; gap: 4px; min-width: 0; padding: 2px 6px; text-align: left; border-radius: 0; }
.wk-mbtn:only-child { border-radius: 4px; }
.wk-mtxt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wk-caret { color: var(--sx-mute, #7f8b98); font-size: 9px; }
.wk-arr { width: 20px; padding: 0; color: var(--sx-mute, #7f8b98); font-size: 8px; }
.wk-prev { border-radius: 4px 0 0 4px; border-right: 0; } .wk-next { border-radius: 0 4px 4px 0; border-left: 0; }
.wk-mbtn:hover, .wk-arr:hover { border-color: var(--sx-mute, #7f8b98); color: var(--sx-ink, #dfe6ee); }
.wk-mbtn:focus-visible, .wk-tog:focus-visible { outline: 2px solid var(--sx-accent, #4fb3ff); outline-offset: 1px; }
.wk-mbtn[aria-expanded="true"] { border-color: var(--sx-accent, #4fb3ff); }
.wk-modbar { position: absolute; left: 0; right: 0; bottom: -4px; height: 3px; pointer-events: none; }
.wk-mseg { position: absolute; top: 0; bottom: 0; border-radius: 2px; }
.wk-mseg.k-sel { background: var(--sx-accent, #4fb3ff); } .wk-mseg.k-neg { background: var(--sx-neg, #ffb347); } .wk-mseg.k-other { background: var(--sx-mute, #7f8b98); }
.wk-mlive { position: absolute; top: -1px; width: 3px; height: 5px; margin-left: -1.5px; background: #fff; border-radius: 1px; }
.wk-pop, .wk-ctx { position: fixed; z-index: 1000; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); overflow: auto; padding: 4px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55); font: 500 12px/1.25 var(--ui, system-ui, sans-serif); outline: none; overscroll-behavior: contain; }
.wk-ctx { z-index: 1001; min-width: 180px; }
.wk-pop.wk-grouped { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 2px 10px; }
.wk-grp { min-width: 120px; }
.wk-gh { padding: 4px 8px 2px; color: var(--sx-mute, #7f8b98); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.wk-opt, .wk-ci { padding: 4px 8px; border-radius: 4px; white-space: nowrap; cursor: pointer; outline: none; }
.wk-opt[aria-selected="true"] { color: var(--sx-accent, #4fb3ff); }
.wk-opt.wk-act, .wk-ci.wk-act, .wk-ci[aria-expanded="true"] { background: var(--sx-panel2, #1c232b); box-shadow: inset 0 0 0 1px var(--sx-line, #2a333d); }
.wk-opt[aria-disabled="true"], .wk-ci[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.wk-ci { display: flex; align-items: center; gap: 6px; padding-left: 4px; }
.wk-ck { flex: 0 0 14px; color: var(--sx-accent, #4fb3ff); text-align: center; }
.wk-cl { flex: 1 1 auto; }
.wk-cs { color: var(--sx-mute, #7f8b98); font-size: 10px; }
.wk-sep { height: 1px; margin: 4px 6px; background: var(--sx-line, #2a333d); }
.wk-tog { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 22px; margin: 0; padding: 2px 7px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 600 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.wk-tog:hover { color: var(--sx-ink, #dfe6ee); }
.wk-tog.wk-on { color: var(--sx-ink, #dfe6ee); }
.wk-dot { width: 7px; height: 7px; border-radius: 50%; background: #2b3540; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.45); }
.wk-on .wk-dot { background: var(--sx-on, #6fe3a1); box-shadow: 0 0 6px var(--sx-on, #6fe3a1); }
.wk-btn.wk-on { color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); border-color: var(--sx-accent, #4fb3ff); }
.wk-power { width: 22px; height: 22px; padding: 0; border-radius: 50%; }
.wk-pic { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.wk-power.wk-on { color: var(--sx-on, #6fe3a1); border-color: var(--sx-on, #6fe3a1); }
.wk-tog.wk-dis { opacity: 0.4; cursor: default; }
.wk-ring { position: absolute; left: -4px; top: -4px; width: calc(100% + 8px); height: calc(100% + 8px); overflow: visible; pointer-events: none; }
.wk-tip { position: fixed; z-index: 1002; left: 0; top: 0; max-width: 300px; padding: 5px 8px; color: var(--sx-ink, #dfe6ee); background: rgba(10, 13, 17, 0.96); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; font: 500 11px/1.35 var(--ui, system-ui, sans-serif); white-space: pre-line; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.12s; }
.wk-tip.wk-show { opacity: 1; visibility: visible; }
.sx-root, .fxr-root:not(.fxr-embedded), .wte-root { --sx-bg: #0f1216; --sx-panel: #161b21; --sx-panel2: #1c232b; --sx-line: #2a333d; --sx-ink: #dfe6ee; --sx-mute: #7f8b98; --sx-accent: #4fb3ff; --sx-neg: #ffb347; --sx-on: #6fe3a1; --sx-warn: #ff6a4a; --sx-graph: #59c2ff; }
.wk-nb, .wk-seg, .wk-sl, .gx-root, .fxr-root, .fxr-root * { box-sizing: border-box; }
.wk-nb { position: relative; display: inline-flex; flex-direction: column; align-items: center; gap: 2px; min-width: 40px; color: var(--sx-ink, #dfe6ee); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; cursor: ns-resize; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; }
.wk-nb > .wk-lab, .wk-seg > .wk-lab, .wk-sl > .wk-lab { color: var(--sx-mute, #7f8b98); white-space: nowrap; }
.wk-nbv { position: relative; display: flex; align-items: center; justify-content: center; min-width: 40px; min-height: 22px; padding: 2px 6px; color: var(--sx-ink, #dfe6ee); background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 500 11px/1.2 var(--mono, ui-monospace, monospace); letter-spacing: 0; text-transform: none; }
.wk-nb:hover .wk-nbv { border-color: var(--sx-mute, #7f8b98); }
.wk-nb:focus-visible .wk-nbv, .wk-nb.wk-drag .wk-nbv { border-color: var(--sx-accent, #4fb3ff); box-shadow: 0 0 0 1px var(--sx-accent, #4fb3ff); }
.wk-nb.wk-dis, .wk-seg.wk-dis, .wk-sl.wk-dis { opacity: 0.4; cursor: default; }
.wk-editing .wk-nbt { visibility: hidden; }
.wk-bad .wk-nbt { color: var(--sx-warn, #ff6a4a); }
.wk-nbv .wk-in { bottom: auto; top: 50%; width: 64px; transform: translate(-50%, -50%); }
.wk-seg { position: relative; display: inline-flex; flex-direction: column; gap: 2px; font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; }
.wk-segs { position: relative; display: inline-flex; }
.wk-sb { min-height: 22px; margin: 0; padding: 2px 8px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-left-width: 0; border-radius: 0; font: 600 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; cursor: pointer; -webkit-touch-callout: none; }
.wk-sb:first-child { border-left-width: 1px; border-radius: 4px 0 0 4px; }
.wk-sb:nth-last-child(2) { border-radius: 0 4px 4px 0; }
.wk-sb:first-child:nth-last-child(2) { border-radius: 4px; }
.wk-sb:hover { color: var(--sx-ink, #dfe6ee); }
.wk-sb.wk-on { color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); border-color: var(--sx-accent, #4fb3ff); }
.wk-sb:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--sx-accent, #4fb3ff); outline-offset: 1px; }
.wk-sl { position: relative; display: inline-flex; align-items: center; gap: 6px; color: var(--sx-ink, #dfe6ee); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; cursor: ew-resize; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; }
.wk-sl.wk-v { flex-direction: column; gap: 3px; cursor: ns-resize; }
.wk-slt { position: relative; flex: 1 1 auto; background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 3px; }
.wk-h .wk-slt { min-width: 72px; height: 10px; }
.wk-v .wk-slt { width: 12px; min-height: 64px; flex: 1 1 64px; }
.wk-slf { position: absolute; background: var(--sx-graph, #59c2ff); border-radius: 2px; }
.wk-h .wk-slf { top: 0; bottom: 0; } .wk-v .wk-slf { left: 0; right: 0; }
.wk-slk { position: absolute; background: var(--sx-ink, #dfe6ee); border-radius: 2px; }
.wk-h .wk-slk { top: -4px; bottom: -4px; width: 4px; margin-left: -2px; }
.wk-v .wk-slk { left: -4px; right: -4px; height: 4px; margin-bottom: -2px; }
.wk-sl .wk-num { min-width: 34px; text-align: right; }
.wk-sl:hover .wk-slt { border-color: var(--sx-mute, #7f8b98); }
.wk-sl:focus-visible .wk-slt { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.wk-sl.wk-drag .wk-slf { background: var(--sx-accent, #4fb3ff); }
.wk-sl .wk-in { bottom: auto; top: 50%; transform: translate(-50%, -50%); }
.wk-vbar { left: auto; right: -6px; top: 0; bottom: 0; width: 3px; height: auto; }
.wk-vbar .wk-mseg { left: 0; right: 0; top: auto; }
.wk-vbar .wk-mlive { left: -1px; top: auto; width: 5px; height: 3px; margin: 0 0 -1.5px 0; }
.gx-root { position: relative; display: block; width: 100%; min-width: 0; overflow: hidden; background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; cursor: crosshair; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; }
.gx-root:focus-visible { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.gx-root canvas { position: absolute; left: 0; top: 0; display: block; width: 100%; height: 100%; }
.gx-ov { pointer-events: none; }
.gx-ro { cursor: default; }
.gx-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.fxr-root { display: grid; grid-template-columns: 176px minmax(0, 1fr); gap: 10px; min-width: 0; padding: 10px; color: var(--sx-ink, #dfe6ee); background: var(--sx-bg, #0f1216); border-radius: 8px; font: 500 11px/1.3 var(--ui, system-ui, sans-serif); }
.fxr-embedded { padding: 0; background: transparent; }
.fxr-root [hidden] { display: none !important; }
.fxr-side { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fxr-shead { display: flex; align-items: center; justify-content: space-between; padding: 0 2px; }
.fxr-stitle, .fxr-gt, .fxr-xtitle { color: var(--sx-mute, #7f8b98); font: 700 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.12em; }
.fxr-more, .fxr-pre, .fxr-xs, .fxr-x { min-width: 24px; min-height: 24px; margin: 0; padding: 2px 7px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 600 11px/1 var(--ui, system-ui, sans-serif); cursor: pointer; }
.fxr-more:hover, .fxr-pre:hover, .fxr-xs:hover, .fxr-x:hover { color: var(--sx-ink, #dfe6ee); border-color: var(--sx-mute, #7f8b98); }
.fxr-more:focus-visible, .fxr-pre:focus-visible, .fxr-xs:focus-visible, .fxr-x:focus-visible, .fxr-tname:focus-visible { outline: 2px solid var(--sx-accent, #4fb3ff); outline-offset: 1px; }
.fxr-xs:disabled { opacity: 0.4; cursor: default; }
.fxr-tiles { position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.fxr-tile { display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 2px 2px 2px 5px; background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; }
.fxr-tile.fxr-sel { box-shadow: inset 3px 0 0 var(--sx-accent, #4fb3ff); }
.fxr-tile.fxr-dragging { opacity: 0.5; }
.fxr-led { width: 24px; min-width: 24px; min-height: 24px; padding: 0; border-radius: 50%; }
.fxr-tname { flex: 1 1 auto; min-width: 0; margin: 0; padding: 5px 2px; overflow: hidden; color: var(--sx-mute, #7f8b98); background: none; border: 0; border-radius: 3px; font: 600 11px/1.2 var(--ui, system-ui, sans-serif); text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.fxr-on .fxr-tname { color: var(--sx-ink, #dfe6ee); }
.fxr-tile.fxr-byp .fxr-tname { text-decoration: line-through; }
.fxr-grip { flex: 0 0 auto; width: 22px; padding: 5px 0; color: var(--sx-mute, #7f8b98); font-size: 14px; line-height: 1; text-align: center; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.fxr-grip:active { cursor: grabbing; }
.fxr-ins { position: absolute; left: 0; right: 0; z-index: 2; height: 2px; background: #ffd23f; border-radius: 1px; pointer-events: none; }
.fxr-ins.fxr-ins-v { right: auto; width: 2px; height: 30px; }
.fxr-rack { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; max-height: var(--fxr-h, 72vh); overflow-y: auto; overscroll-behavior: contain; }
.fxr-empty { padding: 24px 12px; color: var(--sx-mute, #7f8b98); text-align: center; border: 1px dashed var(--sx-line, #2a333d); border-radius: 6px; }
.fxr-mod { position: relative; flex: 0 0 auto; background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; }
.fxr-mod.fxr-byp .fxr-mbody { opacity: 0.45; }
.fxr-mhead { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 10px; border-bottom: 1px solid var(--sx-line, #2a333d); }
.fxr-mtitle { flex: 1 1 auto; margin: 0; color: var(--sx-ink, #dfe6ee); font: 700 10px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.12em; text-transform: uppercase; }
.fxr-mbody { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; }
.fxr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; min-width: 0; }
.fxr-col { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
.fxr-grp { display: flex; flex-direction: column; gap: 5px; padding: 6px 8px; border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; }
.fxr-disp { position: relative; flex: 1 1 160px; min-width: 120px; overflow: hidden; background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; cursor: crosshair; touch-action: none; }
.fxr-disp canvas { position: absolute; left: 0; top: 0; display: block; width: 100%; height: 100%; }
.fxr-xfer { flex: 0 0 78px; min-width: 78px; cursor: default; }
.fxr-eqd { flex-basis: 100%; }
.fxr-mb { display: flex; flex: 1 1 170px; flex-direction: column; gap: 6px; }
.fxr-mb .wk-sl { width: 100%; }
.fxr-gr { flex: 1 1 140px; min-width: 120px; height: 64px; background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; }
.fxr-xpop { position: absolute; z-index: 5; left: 8px; right: 8px; top: 34px; padding: 6px; background: var(--sx-panel, #161b21); border: 1px solid var(--sx-accent, #4fb3ff); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55); }
.fxr-xhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.fxr-flash { animation: fxr-flash 0.6s ease-out; }
@keyframes fxr-flash { from { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); } to { box-shadow: 0 0 0 0 transparent; } }
@media (max-width: 899px) { .fxr-root .wk-md { --wk-d: 34px; } }
@media (max-width: 700px) {
  .fxr-root { grid-template-columns: minmax(0, 1fr); }
  .fxr-tiles { flex-direction: row; overflow-x: auto; padding-bottom: 4px; }
  .fxr-tile { flex: 0 0 auto; }
  .fxr-tname { max-width: 120px; }
  .fxr-rack { max-height: none; }
}
@media (pointer: coarse) {
  .wk-sb, .wk-nbv, .fxr-more, .fxr-pre, .fxr-xs, .fxr-x { min-height: 32px; }
  .wk-h .wk-slt { height: 14px; }
  .fxr-tile { min-height: 40px; }
  .fxr-led { width: 32px; min-width: 32px; min-height: 32px; }
  .fxr-grip { width: 32px; padding: 10px 0; }
}
@media (prefers-reduced-motion: reduce) { .fxr-flash { animation: none; } }
@media (pointer: coarse) {
  .wk-mbtn, .wk-arr, .wk-tog { min-height: 32px; }
  .wk-arr { width: 28px; }
  .wk-tog { min-width: 32px; }
  .wk-power { width: 32px; height: 32px; }
  .wk-opt, .wk-ci { padding-top: 8px; padding-bottom: 8px; }
}
@media (prefers-reduced-motion: reduce) { .wk-tip { transition: none; } }
`;
const styled = new WeakSet();
export function injectStyles(doc = globalThis.document) {
  if (!doc) return null;
  let s = doc.getElementById('wk-css');
  if (!s) {
    s = doc.createElement('style');
    s.id = 'wk-css';
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  if (!styled.has(doc)) { // input-modality tracking (keyboard vs pointer), once per document
    styled.add(doc);
    doc.addEventListener('keydown', () => { lastInput = 'key'; }, true);
    doc.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
  }
  return s;
}
function ensureCSS(d) { if (d && (!styled.has(d) || !d.getElementById('wk-css'))) injectStyles(d); }
