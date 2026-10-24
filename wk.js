// wk.js — widget kit and shared browser infrastructure for the Serum panel, the FX rack and the editors
// (SPEC-serum §8.7.1, §9.1, §9.4). Browser ES module; its one import, gesture.js (the WebKit 181954 move filter it
// shares with the two-finger layer), is DOM-free too: nothing touches document / window / navigator at module top
// level, so node can import it (pure tests, §10.6).
//
// Exports: setPrefs/getPrefs, injectStyles, knob, numBox, menu, toggle, seg, slider, contextMenu, tooltip, loadDSP,
// plus shared infrastructure for graph.js / fx-ui.js / serum-ui.js: menuSource, fireContext, theme, fitCanvas, frame,
// wheelGate, saveFile, pickFile, ask. The injected CSS covers the widgets, the FX rack (.fxr-*) and the curve editors (.gx-*).
// `steps` and `detents` may be numbers/arrays or functions (re-read at every gesture, e.g. a BPM-synced RATE knob).
// Phase 2 (SPEC-serum2 §11.14, §13.1): fader, meter, xyPad, rangeBar, pianoKeys, stepGrid, iconSeg, modifierBar,
// dragSource, longPress, zoomPan. Their pure maths hang off the widget functions (no extra exports): meter.pos,
// fader.nAt, rangeBar.drag / .norm / .parse, pianoKeys.layout / .hit / .velocity / .noteName, stepGrid.valueAt,
// zoomPan.zoom / .pan, modifierBar.mods / .consume (the touch modifier latches every gesture reads), dragSource.edge (the
// edge auto-scroll speed), tooltip.textOf (a touch status line's text) and loadDSP.URLS (the §0.3 list, the default).
// The canvas world (SPEC-canvas §4.4–4.7): localPoint / localScale (pointer maths under its CSS scale), closeTransient,
// setWheelVeto, setEdgeHook, visibleBand, edgePan2, setLayer / layer (the top layer), setCanvasScale / canvasScale, onRescale /
// rescaleCanvases, releaseCanvases / onRelease; (milestone 3, H5) storeDensity / storedDensity / deviceRatio, setStoreCaps /
// storeCap, CANVAS_MAX_PX / CANVAS_BUDGET.
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
import { jumpy } from './gesture.js?v=9';

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
// The two-finger layer (gesture.js) asks the first finger's owner to roll back with a synthetic pointercancel flagged
// e.gesture === 'two-finger': the widgets restore the pre-gesture value ('move' + 'end' with it) and keep the modifier
// latches for the next gesture; a plain pointercancel (a system interruption) keeps the value, as before.
const twoF = e => !!e && e.gesture === 'two-finger';

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

/* ---------------------------------------------------- modifier latches */
// Touch modifier latches (§13.1, modifierBar): 0 off · 1 latched (applies to the next gesture; released by
// consumeLatches() when that gesture ends) · 2 locked (double-tap; stays until tapped off). One set per page, shared
// by every bar and widget. Without a modifier bar every latch stays 0 and gestures read the event's own keys only.
const LATCH = { fine: 0, alt: 0, shift: 0 };
const latchSubs = new Set();
function latchChanged() { for (const f of [...latchSubs]) { try { f(); } catch (err) { console.error(err); } } }
// Effective modifiers of a gesture: the event's keys or a latch (Fine = the Shift-drag fine adjustment).
function modsOf(e) {
  const sh = !!(e && e.shiftKey);
  return { fine: sh || LATCH.fine > 0, alt: !!(e && e.altKey) || LATCH.alt > 0, shift: sh || LATCH.shift > 0 };
}
function consumeLatches() {
  let ch = false;
  for (const k in LATCH) if (LATCH[k] === 1) { LATCH[k] = 0; ch = true; }
  if (ch) latchChanged();
}
const inBar = t => { for (let n = t; n; n = n.parentNode) if (n.classList && n.classList.contains('wk-mkeys')) return true; return false; };

/* ---------------------------------------------------------- touch mode */
// §13.1: touch rules apply under `@media (pointer: coarse)` or once any touch pointer has been seen on the page
// (an iPad with a trackpad reports a fine pointer): the first touch adds `wk-touch` to <html>, whose CSS copies the
// coarse-pointer block. touchMode() → true in either case (widgets and panels choose touch layouts with it).
let touchSeen = false;
export function touchMode() {
  if (touchSeen) return true;
  try { const m = globalThis.matchMedia; return !!(m && m('(pointer: coarse)').matches); } catch (err) { return false; }
}
function markTouch(d) {
  touchSeen = true;
  const r = d && d.documentElement;
  if (r && r.classList && !r.classList.contains('wk-touch')) r.classList.add('wk-touch');
}

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
// Touch long-press (500 ms, ≤ 8 px travel) → contextmenu at the touch point; `fire` runs first. Exported (§11.14):
// call it from a pointerdown handler with that event; it returns null for non-touch pointers, else { move(ev), cancel() }
// to feed from pointermove and to call on pointerup / pointercancel.
export function longPress(el, e, fire) {
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
// the canvas camera's veto (setWheelVeto): a camera that moved < 300 ms ago slid this control under a resting pointer
let wheelVeto = null;
const vetoed = () => { if (!wheelVeto) return false; try { return !!wheelVeto(); } catch (err) { return false; } };
function wheelIn(focusEl, e, hoverT) {
  // only taken when the control has focus or the pointer has rested on it (not while the page scrolls past), and never
  // while the canvas camera is moving under the pointer (the wheel stays the camera's)
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0); // Shift+wheel arrives as deltaX in Chromium/macOS
  if (!d || vetoed()) return null;
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
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, n: n0, n0, k0: 0, p: n0, moved: false, touch: lastType === 'touch', lp: null, steps };
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
    const fine = e.shiftKey || LATCH.fine > 0; // Shift or the Fine latch (touch modifier bar)
    if (fine) d *= 0.1;
    const steps = g.steps;
    let n;
    if (steps) { // 1 step per 8 px
      g.p = clamp(g.p + d / 8, 0, steps);
      n = (g.p >= g.k0 ? Math.floor(g.p + 1e-9) : Math.ceil(g.p - 1e-9)) / steps;
    } else { // 200 px = full range
      g.p = clamp(g.p + d / 200, 0, 1);
      n = detent(g.p, fine);
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
  function finish(back) { // back: a two-finger rollback (twoF) — the value from before the press
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { el.releasePointerCapture(G.id); } catch (err) { /* already released */ }
    el.classList.remove('wk-drag');
    if (back === true) { G.n = G.n0; o.set(G.n, 'move'); lastTap = null; }
    o.set(G.n, 'end');
    update();
    if (back !== true) consumeLatches();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(twoF(e)); });
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
    inp.setAttribute('inputmode', inputModeOf(o, fmt));
    inp.setAttribute('enterkeyhint', 'done');
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
// Virtual keyboard of a typed entry (§13.1: double-tap = typed entry with inputmode="decimal"). o.inputMode (value or
// function) wins; otherwise 'decimal' when the display at both ends of the range starts with a digit, else 'text'
// (signed, named or note values: the iOS decimal pad has no minus sign, no space and no letters). rangeBar and
// stepGrid default to 'text' (ranges need a separator, steps a sign). Recorded as a deviation from §13.1's letter.
function inputModeOf(o, fmt) {
  const m = o && call(o.inputMode);
  if (m) return String(m);
  try { return /^\d/.test(String(fmt(0)).trim()) && /^\d/.test(String(fmt(1)).trim()) ? 'decimal' : 'text'; } catch (err) { return 'text'; }
}
// Inline text entry over a widget: Enter / blur commit, Escape cancels. commit(text) → false flashes `wk-bad`.
function typeIn(host, el, label, text, commit, onEnd, mode) {
  const inp = h('input', 'wk-in');
  inp.type = 'text';
  inp.value = text;
  inp.setAttribute('aria-label', label + ' value');
  inp.setAttribute('autocomplete', 'off');
  inp.setAttribute('spellcheck', 'false');
  inp.setAttribute('inputmode', mode || 'text');
  inp.setAttribute('enterkeyhint', 'done');
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
    g = { id: e.pointerId, y: e.clientY, x0: e.clientX, y0: e.clientY, st, k0, p: k0, k: k0, n0, px: st > 100 ? 800 / st : 8, moved: false, touch: lastType === 'touch', lp: null };
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
    g.p = clamp(g.p + (g.y - e.clientY) * (e.shiftKey || LATCH.fine > 0 ? 0.25 : 1) / g.px, lim[0], lim[1]);
    g.y = e.clientY;
    const k = g.p >= g.k0 ? Math.floor(g.p + 1e-9) : Math.ceil(g.p - 1e-9);
    if (k !== g.k) { g.k = k; o.set(k / g.st + 0, 'move'); update(); }
  });
  function finish(back) { // back: a two-finger rollback (twoF)
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { el.releasePointerCapture(G.id); } catch (err) { /* already released */ }
    el.classList.remove('wk-drag');
    if (back === true) { o.set(G.n0, 'move'); o.set(G.n0, 'end'); lastTap = null; }
    else o.set(G.k / G.st + 0, 'end');
    update();
    if (back !== true) consumeLatches();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(twoF(e)); });
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
    }, () => { ti = null; }, inputModeOf(o, fmt));
  }
  function destroy() { if (g) finish(); if (ti) ti.cancel(); hideTip(el); el.remove(); el.wk = null; }
  update();
  return W;
}

/* ----------------------------------------------------------------- seg */
// { dest?, label?, items: [labels] | () => [labels], get: () => idx, set: (idx, 'set') => void, disabled? } —
// segmented switch with radio semantics (one tab stop; arrows move and select; Home / End).
export function seg(o) { return segCore(o, false); }
// iconSeg(o): a seg whose items are icons (SUB shapes, granular window shapes, …): o.items = [{ icon, label }] (or a
// function returning them); `icon` = SVG path data drawn in a 16 × 16 box (stroked with currentColor) or a short text
// glyph; `label` is the button's accessible name and tooltip. Behaviour as seg (radio group, one tab stop, mod bar).
export function iconSeg(o) { return segCore(o, true); }
function iconBtn(it) {
  const b = h('button', 'wk-sb wk-isb');
  if (/^[Mm]\s*[-+.\d]/.test(it.icon)) {
    const svg = sv('svg', { class: 'wk-ico', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(sv('path', { d: it.icon }));
    b.append(svg);
  } else {
    const gl = h('span', 'wk-iglyph', it.icon);
    gl.setAttribute('aria-hidden', 'true');
    b.append(gl);
  }
  b.setAttribute('aria-label', it.label);
  tooltip(b, () => it.label);
  return b;
}
// seg and iconSeg: `icons` = items are { icon, label } objects drawn as icons (label → aria-label and tooltip).
function segCore(o, icons) {
  ensureCSS(D());
  const el = h('div', 'wk-seg' + (icons ? ' wk-iseg' : ''));
  el.setAttribute('role', 'radiogroup');
  const lab = h('span', 'wk-lab'), row = h('div', 'wk-segs');
  el.append(lab, row);
  const bar = modBar(row);
  const W = { el, update, setMod, focus, destroy };
  el.wk = W;
  let btns = [], key = null, dis = false, lp = null, noClick = false, mod = null;

  function build() {
    const raw = call(o.items) || [];
    const items = icons ? raw.map(it => ({ label: String(it && it.label != null ? it.label : ''), icon: String(it && it.icon != null ? it.icon : '') })) : raw.map(String);
    const k = icons ? items.map(it => it.label + '\u0002' + it.icon).join('\u0001') : items.join('\u0001');
    if (k === key) return;
    key = k;
    for (const b of btns) { hideTip(b); b.remove(); }
    btns = items.map((t, i) => {
      const b = icons ? iconBtn(t) : h('button', 'wk-sb', t);
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
  function destroy() { if (lp) lp.cancel(); hideTip(el); for (const b of btns) hideTip(b); el.remove(); el.wk = null; }
  update();
  return W;
}

/* -------------------------------------------------------------- slider */
// { get, set, def, fmt, parse?, bipolar, orient: 'h' | 'v', dest?, label?, steps?, disabled? } — value in n
// (callers map n to their own range, e.g. matrix amount = 2n − 1). Grab the thumb for a relative drag; pressing
// elsewhere on the track jumps there first. Full track length = full range, Shift ×0.1; wheel / keys / typed
// entry / reset like the knob.
export function slider(o) { return sliderCore(o).W; }
// The slider machinery, returning its parts for the widgets built on it (fader).
function sliderCore(o) {
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
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, len: pos.len, p: n0, n: n0, n0, moved: false, touch: lastType === 'touch', lp: null };
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
    g.p = clamp(g.p + d / g.len * (e.shiftKey || LATCH.fine > 0 ? 0.1 : 1), 0, 1);
    const n = snap(g.p, stepsOf());
    if (n !== g.n) { g.n = n; o.set(n, 'move'); update(); }
  });
  function finish(back) { // back: a two-finger rollback (twoF) — also undoes the jump of the press
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { el.releasePointerCapture(G.id); } catch (err) { /* already released */ }
    el.classList.remove('wk-drag');
    if (back === true) { G.n = G.n0; o.set(G.n, 'move'); lastTap = null; }
    o.set(G.n, 'end');
    update();
    if (back !== true) consumeLatches();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(twoF(e)); });
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
    }, () => { ti = null; }, inputModeOf(o, fmt));
  }
  function destroy() { if (g) finish(); if (ti) ti.cancel(); hideTip(el); el.remove(); el.wk = null; }
  update();
  return { W, el, trk, lab, out };
}

/* =============================================== Phase-2 widgets (§11.14) */

/* --------------------------------------------------------------- meter */
// meter(o): peak meter in dBFS (mixer strips, header output; §13.4, snapshot `mix`). o = { ch: 1 | 2, floor: −60,
// top: 6, orient: 'v' | 'h', hold: 1000 (ms peak hold), label? }. W.set(db, db2?, t?) — one value per channel in dBFS
// (−Infinity / NaN = silence; a mono value feeds both channels; t = ms timestamp for the hold, default
// performance.now()); W.reset() clears levels and holds; W.levels() → the last values. The lit part is the channel's
// gradient (green, yellow from −6 dB, red from 0 dB) uncovered from the bottom; a peak-hold line; `wk-clip` while the
// held peak is above 0 dB. The hold expires `hold` ms after the peak even when set() is not called again (callers may
// skip repeated values). meter.pos(db, floor, top) → [0,1]: the shared scale (linear in dB; ≤ floor → 0, ≥ top → 1).
function meterPos(db, floor, top) {
  const f = isFinite(floor) ? +floor : -60, t = isFinite(top) && +top > f ? +top : f + 66;
  if (!(db > f)) return 0; // NaN, −Infinity, ≤ floor
  return db >= t ? 1 : (db - f) / (t - f);
}
const nowMs = () => { const p = globalThis.performance; return p && typeof p.now === 'function' ? p.now() : Date.now(); };
export function meter(o) {
  o = o || {};
  ensureCSS(D());
  const ch = o.ch === 2 ? 2 : 1, vert = o.orient !== 'h';
  const floor = isFinite(o.floor) ? +o.floor : -60, top = isFinite(o.top) && +o.top > floor ? +o.top : 6;
  const hold = o.hold >= 0 ? +o.hold : 1000;
  const el = h('div', 'wk-meter ' + (vert ? 'wk-mv' : 'wk-mh'));
  el.setAttribute('role', 'meter');
  el.setAttribute('aria-label', o.label || 'Level');
  el.setAttribute('aria-valuemin', String(floor));
  el.setAttribute('aria-valuemax', String(top));
  el.style.setProperty('--wk-m6', (meterPos(-6, floor, top) * 100).toFixed(2) + '%');
  el.style.setProperty('--wk-m0', (meterPos(0, floor, top) * 100).toFixed(2) + '%');
  const SZ = vert ? 'height' : 'width', POS = vert ? 'bottom' : 'left';
  const chans = [];
  for (let c = 0; c < ch; c++) {
    const b = h('div', 'wk-mch'), cov = h('div', 'wk-mcov'), pk = h('div', 'wk-mpk');
    b.append(cov, pk);
    el.append(b);
    chans.push({ b, cov, pk, db: -Infinity, peak: -Infinity, pt: -1e9, t: -1e9 });
  }
  const W = { el, set, reset, levels: () => chans.map(c => c.db), destroy };
  el.wk = W;
  let timer = 0, fresh = false; // fresh: a new peak since the timer was armed
  function paint(c) {
    c.cov.style[SZ] = ((1 - meterPos(c.db, floor, top)) * 100).toFixed(2) + '%';
    const pp = meterPos(c.peak, floor, top);
    c.pk.style[POS] = (pp * 100).toFixed(2) + '%';
    c.pk.style.display = pp > 0 ? '' : 'none';
    c.b.classList.toggle('wk-clip', c.peak > 0);
  }
  // The hold also expires without further set() calls (callers skip repeated values, and silence is a constant
  // level): a timer `hold` ms after the latest new peak drops every held peak to its current level and clears the
  // clip state. While set() keeps coming, set() expires each channel's hold itself.
  function arm() {
    if (timer) clearTimeout(timer);
    fresh = false;
    timer = setTimeout(expire, hold + 4);
    if (timer && typeof timer.unref === 'function') timer.unref(); // node: never keeps the process alive
  }
  function expire() {
    timer = 0;
    for (const c of chans) if (c.peak > c.db) { c.peak = c.db; c.pt = c.t; paint(c); }
  }
  function set(a, b, t) {
    const T = t != null && isFinite(t) ? +t : nowMs();
    let held = false;
    chans.forEach((c, i) => {
      const raw = i === 1 && b != null ? b : a, v = typeof raw === 'number' && !isNaN(raw) ? raw : -Infinity;
      c.db = v;
      c.t = T;
      if (v >= c.peak || T - c.pt > hold) { c.peak = v; c.pt = T; fresh = true; }
      if (c.peak > v) held = true;
      paint(c);
    });
    if (held && (fresh || !timer)) arm();
    const v0 = chans[0].db;
    attr(el, 'aria-valuenow', isFinite(v0) ? Math.round(clamp(v0, floor, top)) : floor);
  }
  function reset() {
    if (timer) { clearTimeout(timer); timer = 0; }
    fresh = false;
    for (const c of chans) { c.db = c.peak = -Infinity; c.pt = c.t = -1e9; paint(c); }
    attr(el, 'aria-valuenow', floor);
  }
  function destroy() { if (timer) { clearTimeout(timer); timer = 0; } el.remove(); el.wk = null; }
  reset();
  return W;
}
meter.pos = meterPos;

/* --------------------------------------------------------------- fader */
// fader(o): vertical fader with a dB scale and an optional peak meter (MIX page strips: `k.level`, `f.level`,
// `g.bus1v`, `g.master`, …; §13.4). A vertical slider (its gestures, keys, typed entry, `data-dest` and mod bar) plus
// o.db(n) → dB (the destination's law; −Infinity allowed) for the scale and the default text, o.ticks (dB marks,
// default +6 0 −6 −12 −24 −48, only those inside the law's range) and o.meter (true or meter options) → W.meter(db,
// db2?, t?). fader.nAt(db, v) → the n where a monotonic (non-decreasing) law reaches v dB (bisection; 0 / 1 outside).
const FADER_TICKS = Object.freeze([6, 0, -6, -12, -24, -48]);
function faderNAt(dbFn, v) {
  if (typeof dbFn !== 'function' || isNaN(v)) return 0;
  if (!(v > dbFn(0))) return 0;
  if (v >= dbFn(1)) return 1;
  let a = 0, b = 1;
  for (let i = 0; i < 48; i++) { const m = (a + b) / 2; if (dbFn(m) < v) a = m; else b = m; }
  return (a + b) / 2;
}
const fmtDb = v => (!(v > -144) ? '-inf' : (v > 0.05 ? '+' : '') + (Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1))) + ' dB';
export function fader(o) {
  const dbFn = typeof o.db === 'function' ? o.db : null;
  const core = sliderCore(Object.assign({}, o, { orient: 'v', fmt: o.fmt || (dbFn ? n => fmtDb(dbFn(n)) : undefined) }));
  const { W, el, trk } = core;
  el.classList.add('wk-fader');
  const row = h('div', 'wk-frow'), scale = h('div', 'wk-fsc');
  scale.setAttribute('aria-hidden', 'true');
  el.insertBefore(row, trk);
  row.append(scale, trk);
  if (dbFn) {
    const lo = dbFn(0), hi = dbFn(1);
    for (const v of (Array.isArray(o.ticks) ? o.ticks : FADER_TICKS)) {
      if (!(v >= lo && v <= hi) && !(v === -Infinity && lo === -Infinity)) continue;
      const tk = h('span', 'wk-ftk', v === -Infinity ? '-inf' : (v > 0 ? '+' : '') + v);
      tk.style.bottom = (faderNAt(dbFn, v) * 100).toFixed(2) + '%';
      scale.append(tk);
    }
  }
  let m = null;
  if (o.meter) {
    m = meter(Object.assign({ ch: 1, label: (call(o.label) || 'Level') + ' meter' }, o.meter === true ? {} : o.meter));
    row.append(m.el);
  }
  W.meter = (a, b, t) => { if (m) m.set(a, b, t); };
  const destroy0 = W.destroy;
  W.destroy = () => { if (m) m.destroy(); destroy0(); };
  return W;
}
fader.nAt = faderNAt;

/* --------------------------------------------------------------- xyPad */
// xyPad(o): square pad with a dot bound to two values (Granular / Spectral manual X|Y, PZ SVF X/Y; §13.3).
// o = { label?, x: { dest?, label?, get, set, def, fmt? }, y: { … }, yDown? (Y = 0 at the top: PZ corners), disabled?,
// size? (px, default 96) }; values n ∈ [0,1], each axis gets its own set(n, phase). A press jumps the dot to the
// pointer and drags it (Shift / Fine latch: relative ×0.1 from the current position); Cmd/Ctrl-click resets both.
// Keys on the dot: ←→ X, ↑↓ Y by 0.01 (Shift 0.001), PageUp/PageDown Y ±0.1, Home/End X 0/1, Delete resets, ContextMenu.
// The X rail (under the pad) and the Y rail (left) carry the two `data-dest` (drop targets, knob menus) and the
// setMod({ x, y }) bars (each rail's own `wk.setMod(m)` sets its axis alone); the dot carries `data-xy` plus
// `data-dest-x` / `data-dest-y` (a source dropped on it offers Modulate X / Modulate Y — handled by the kit).
// Knob menus (§13.3): a contextmenu on the pad or the dot — right-click, touch long-press, ContextMenu / Shift+F10 on
// the dot — is forwarded to the rails: with both destinations a chooser (X axis / Y axis) dispatches a `contextmenu` on
// the chosen rail, with one it goes straight to that rail, with none it is left alone. The rails are long-press /
// ContextMenu sources themselves (menuSource); focusing one (a closing knob menu returns focus there) focuses the dot.
export function xyPad(o) {
  ensureCSS(D());
  const X = o.x || {}, Y = o.y || {}, down = !!o.yDown;
  const el = h('div', 'wk-xy');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-roledescription', 'X/Y pad');
  const lab = h('span', 'wk-lab'), grid = h('div', 'wk-xyg'), pad = h('div', 'wk-xyp'), dot = h('div', 'wk-xyd');
  const rx = h('div', 'wk-xyr wk-xyrx'), ry = h('div', 'wk-xyr wk-xyry'), out = h('span', 'wk-num');
  dot.tabIndex = 0;
  dot.setAttribute('role', 'slider');
  dot.setAttribute('data-xy', '1');
  dot.setAttribute('aria-valuemin', '0');
  dot.setAttribute('aria-valuemax', '100');
  pad.append(dot);
  grid.append(ry, pad, rx);
  el.append(lab, grid, out);
  if (o.size > 0) el.style.setProperty('--wk-xy', Math.round(o.size) + 'px');
  const barX = modBar(rx), barY = modBar(ry, true);
  const W = { el, update, setMod, focus, reset, destroy };
  el.wk = W;
  // Each rail is a destination element of its own (`data-dest` + `wk`), so a panel that paints halos by scanning
  // [data-dest] elements (el.wk.setMod) reaches one axis: rail.wk.setMod(m) = setMod({ …current, [axis]: m }).
  const axisMod = k => m => setMod(Object.assign({}, mod || {}, { [k]: m || null }));
  rx.wk = { el: rx, axis: 'x', pad: W, update, focus, setMod: axisMod('x') };
  ry.wk = { el: ry, axis: 'y', pad: W, update, focus, setMod: axisMod('y') };
  ctxGuard(dot);
  const railOffs = [rx, ry].map(r => { r.tabIndex = -1; r.addEventListener('focus', () => focus()); return menuSource(r); });
  let dis = false, g = null, mod = null, text = null;
  const gx = () => num01(X.get ? X.get() : 0), gy = () => num01(Y.get ? Y.get() : 0);
  const fx = n => String(X.fmt ? X.fmt(n) : Math.round(n * 100) + '%'), fy = n => String(Y.fmt ? Y.fmt(n) : Math.round(n * 100) + '%');
  const LX = () => String(call(X.label) || 'X'), LY = () => String(call(Y.label) || 'Y');

  function update() {
    const L = String(call(o.label) || '');
    if (lab.textContent !== L) lab.textContent = L;
    lab.style.display = L ? '' : 'none';
    attr(el, 'aria-label', L || 'X/Y pad');
    const dx = call(X.dest), dy = call(Y.dest);
    setDest(rx, dx); setDest(ry, dy);
    if (dx) attr(dot, 'data-dest-x', dx); else if (dot.hasAttribute('data-dest-x')) dot.removeAttribute('data-dest-x');
    if (dy) attr(dot, 'data-dest-y', dy); else if (dot.hasAttribute('data-dest-y')) dot.removeAttribute('data-dest-y');
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    const x = gx(), y = gy();
    dot.style.left = (x * 100).toFixed(2) + '%';
    dot.style.top = ((down ? y : 1 - y) * 100).toFixed(2) + '%';
    const t = LX() + ' ' + fx(x) + ', ' + LY() + ' ' + fy(y);
    if (t !== text) { text = t; out.textContent = t; attr(dot, 'aria-valuetext', t); }
    attr(dot, 'aria-valuenow', Math.round(x * 1000) / 10);
    attr(dot, 'aria-label', L ? L + ' ' + LX() + '/' + LY() : LX() + '/' + LY());
    if (mod) setMod(mod);
  }
  function setMod(m) {
    mod = m || null;
    const a = barX(mod && mod.x || null, gx()), b = barY(mod && mod.y || null, gy());
    el.classList.toggle('wk-modded', a + b > 0);
  }
  function focus() { dot.focus({ preventScroll: true }); }
  function put(x, y, ph) {
    x = num01(x); y = num01(y);
    const cx = gx(), cy = gy();
    if (ph !== 'set' || x !== cx) X.set(x, ph);
    if (ph !== 'set' || y !== cy) Y.set(y, ph);
    update();
  }
  function reset() {
    if (dis) return;
    const a = call(X.def), b = call(Y.def);
    put(a != null ? +a : gx(), b != null ? +b : gy(), 'set');
  }
  function posOf(e) {
    const r = pad.getBoundingClientRect(), w = Math.max(1, r.width), hh = Math.max(1, r.height);
    const fy0 = (e.clientY - r.top) / hh;
    return { x: (e.clientX - r.left) / w, y: down ? fy0 : 1 - fy0, w, h: hh };
  }
  pad.addEventListener('pointerdown', e => {
    if (e.button !== 0 || g || dis) return;
    if (e.ctrlKey && isMac()) return;
    e.preventDefault();
    focus();
    if (e.metaKey || e.ctrlKey) { reset(); return; }
    const p = posOf(e);
    g = { id: e.pointerId, px: e.clientX, py: e.clientY, x: gx(), y: gy(), w: p.w, h: p.h, lp: null };
    g.x0 = g.x; g.y0 = g.y;
    try { pad.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    el.classList.add('wk-drag');
    X.set(g.x, 'start'); Y.set(g.y, 'start');
    if (!modsOf(e).fine) { // jump
      const nx = num01(p.x), ny = num01(p.y);
      if (nx !== g.x) X.set(nx, 'move');
      if (ny !== g.y) Y.set(ny, 'move');
      g.x = nx; g.y = ny;
      update();
    }
    g.lp = longPress(dot, e, finish);
  });
  pad.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { finish(); return; }
    if (g.lp) g.lp.move(e);
    const f = modsOf(e).fine ? 0.1 : 1, sy = down ? 1 : -1;
    const nx = clamp(g.x + (e.clientX - g.px) / g.w * f, 0, 1), ny = clamp(g.y + sy * (e.clientY - g.py) / g.h * f, 0, 1);
    g.px = e.clientX; g.py = e.clientY;
    if (nx !== g.x) { g.x = nx; X.set(nx, 'move'); }
    if (ny !== g.y) { g.y = ny; Y.set(ny, 'move'); }
    update();
  });
  function finish(back) { // back: a two-finger rollback (twoF) — also undoes the jump of the press
    if (!g) return;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { pad.releasePointerCapture(G.id); } catch (err) { /* released */ }
    el.classList.remove('wk-drag');
    if (back === true) { G.x = G.x0; G.y = G.y0; X.set(G.x, 'move'); Y.set(G.y, 'move'); }
    X.set(G.x, 'end'); Y.set(G.y, 'end');
    update();
    if (back !== true) consumeLatches();
  }
  pad.addEventListener('pointerup', e => { if (g && e.pointerId === g.id) finish(); });
  pad.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(twoF(e)); });
  pad.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) finish(); });
  pad.addEventListener('contextmenu', e => {
    if (g) finish();
    const hx = rx.hasAttribute('data-dest'), hy = ry.hasAttribute('data-dest');
    if (!hx && !hy) return;
    e.preventDefault();
    e.stopPropagation();
    const kb = lastInput === 'key', x = kb ? undefined : e.clientX, y = kb ? undefined : e.clientY; // keyboard: menus focus their first item
    if (!(hx && hy)) { fireCtx(hx ? rx : ry, x, y); return; }
    const nm = (L, a) => (L === a ? a + ' axis' : L + ' (' + a + ')');
    contextMenu(e.clientX, e.clientY, [
      { label: nm(LX(), 'X'), action: () => fireCtx(rx, x, y) },
      { label: nm(LY(), 'Y'), action: () => fireCtx(ry, x, y) },
    ], { anchor: dot });
  });
  dot.addEventListener('keydown', e => {
    if (ctxKey(e)) { e.preventDefault(); fireCtx(dot); return; }
    if (dis) return;
    const k = e.key, s = e.shiftKey ? 0.001 : 0.01, x = gx(), y = gy(), up = down ? -1 : 1;
    let nx = x, ny = y;
    if (k === 'ArrowRight') nx = x + s; else if (k === 'ArrowLeft') nx = x - s;
    else if (k === 'ArrowUp') ny = y + s * up; else if (k === 'ArrowDown') ny = y - s * up;
    else if (k === 'PageUp') ny = y + 0.1 * up; else if (k === 'PageDown') ny = y - 0.1 * up;
    else if (k === 'Home') nx = 0; else if (k === 'End') nx = 1;
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); reset(); return; }
    else return;
    e.preventDefault();
    put(nx, ny, 'set');
  });
  function destroy() { if (g) finish(); for (const f of railOffs) f(); hideTip(dot); el.remove(); el.wk = rx.wk = ry.wk = null; }
  update();
  return W;
}

/* ------------------------------------------------------------ rangeBar */
// rangeBar(o): two-handle integer range (OSC MAPPING key 0–127 / velocity 1–127 rows, §13.9). o = { label?, min = 0,
// max = 127, get: () => [lo, hi], set: ([lo, hi], phase), fmt?: v → text (e.g. note names), parse?: text → [lo, hi] |
// null, disabled? }. Values are cells: [lo, hi] covers lo … hi inclusive. Drag a handle (an edge: 6 px reach, touch
// 22 px, inwards at most a quarter of the range so a narrow range keeps a body) or the body (moves both, width kept;
// Alt / the Alt latch drags the body from anywhere); a press outside the body moves the nearer edge there and drags
// it. Double-click / double-tap /
// Enter on a handle = typed entry ("C1–G7", "1–127", one value = both ends). Keys on a handle: ←→ ±1 (Shift ±12),
// Alt+←→ moves the whole range, Home / End; setMod(m) draws the usual underline bar. Pure maths: rangeBar.norm(r,
// min, max) (integers, swapped when reversed, clamped: min ≤ lo ≤ hi ≤ max), rangeBar.drag(r, part 'lo' | 'hi' |
// 'body', dv, min, max) and rangeBar.parse(text, min, max, fmt?) → [lo, hi] | null.
function rbLims(min, max) {
  const a = Math.round(isFinite(+min) ? +min : 0), b = Math.round(isFinite(+max) ? +max : 127);
  return a <= b ? [a, b] : [b, a];
}
function rbNorm(r, min, max) {
  const [mn, mx] = rbLims(min, max), arr = Array.isArray(r) ? r : [];
  let a = Math.round(+arr[0]), b = Math.round(+arr[1]);
  if (!isFinite(a)) a = mn;
  if (!isFinite(b)) b = mx;
  if (a > b) { const t = a; a = b; b = t; }
  return [clamp(a, mn, mx), clamp(b, mn, mx)];
}
function rbDrag(r, part, dv, min, max) {
  const [mn, mx] = rbLims(min, max), [lo, hi] = rbNorm(r, mn, mx), d = Math.round(+dv || 0);
  if (part === 'lo') return [clamp(lo + d, mn, hi), hi];
  if (part === 'hi') return [lo, clamp(hi + d, lo, mx)];
  const w = hi - lo, a = clamp(lo + d, mn, mx - w);
  return [a, a + w];
}
const dashNorm = t => String(t).replace(/[−]/g, '-');
function rbParse(text, min, max, fmt) {
  const [mn, mx] = rbLims(min, max), s = dashNorm(text).trim();
  if (!s) return null;
  const val = x => {
    const q = x.trim().toLowerCase();
    if (!q) return null;
    if (typeof fmt === 'function') for (let v = mn; v <= mx; v++) if (dashNorm(fmt(v)).trim().toLowerCase() === q) return v;
    return /^[+-]?\d+$/.test(q) ? parseInt(q, 10) : null;
  };
  const two = (a, b) => { const u = val(a), v = val(b); return u == null || v == null ? null : rbNorm([u, v], mn, mx); };
  const parts = s.split(/\s*(?:–|—|\.\.|\bto\b)\s*/i);
  if (parts.length === 2) return two(parts[0], parts[1]);
  if (parts.length !== 1) return null;
  const one = val(s);
  if (one != null) return rbNorm([one, one], mn, mx);
  for (let i = 1; i < s.length - 1; i++) if (s[i] === '-') { const r = two(s.slice(0, i), s.slice(i + 1)); if (r) return r; }
  const ws = s.split(/\s+/);
  return ws.length === 2 ? two(ws[0], ws[1]) : null;
}
export function rangeBar(o) {
  ensureCSS(D());
  const lims = () => rbLims(call(o.min != null ? o.min : 0), call(o.max != null ? o.max : 127));
  const el = h('div', 'wk-rb');
  el.setAttribute('role', 'group');
  const lab = h('span', 'wk-lab'), trk = h('div', 'wk-rbt'), body = h('div', 'wk-rbb'), out = h('span', 'wk-rbv');
  const hLo = h('div', 'wk-rbh wk-rblo'), hHi = h('div', 'wk-rbh wk-rbhi');
  for (const [hd, t] of [[hLo, 'start'], [hHi, 'end']]) {
    hd.tabIndex = 0;
    hd.setAttribute('role', 'slider');
    hd.setAttribute('data-part', t === 'start' ? 'lo' : 'hi');
    ctxGuard(hd);
  }
  trk.append(body, hLo, hHi);
  el.append(lab, trk, out);
  const bar = modBar(trk);
  const W = { el, update, setMod, focus, edit, destroy };
  el.wk = W;
  let dis = false, g = null, ti = null, lastTap = null, text = null, lastType = 'mouse', mod = null;
  const fmt = v => String(o.fmt ? o.fmt(v) : v);
  const cur = () => { const [mn, mx] = lims(); return rbNorm(o.get ? o.get() : [mn, mx], mn, mx); };

  function update() {
    const L = String(call(o.label) || ''), [mn, mx] = lims(), [lo, hi] = cur(), N = mx - mn + 1;
    if (lab.textContent !== L) lab.textContent = L;
    lab.style.display = L ? '' : 'none';
    attr(el, 'aria-label', L || 'Range');
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    const a = (lo - mn) / N, b = (hi - mn + 1) / N;
    body.style.left = (a * 100).toFixed(3) + '%';
    body.style.width = ((b - a) * 100).toFixed(3) + '%';
    hLo.style.left = (a * 100).toFixed(3) + '%';
    hHi.style.left = (b * 100).toFixed(3) + '%';
    for (const [hd, v, nm, l0, l1] of [[hLo, lo, 'start', mn, hi], [hHi, hi, 'end', lo, mx]]) {
      attr(hd, 'aria-valuemin', l0); attr(hd, 'aria-valuemax', l1); attr(hd, 'aria-valuenow', v);
      attr(hd, 'aria-valuetext', fmt(v));
      attr(hd, 'aria-label', (L ? L + ' ' : '') + nm);
    }
    const t = lo === hi ? fmt(lo) : fmt(lo) + '–' + fmt(hi);
    if (t !== text) { text = t; out.textContent = t; }
    if (mod) setMod(mod);
  }
  function setMod(m) { mod = m || null; el.classList.toggle('wk-modded', bar(mod, null) > 0); } // underline bar (n over the track)
  function focus(part) { (part === 'hi' ? hHi : hLo).focus({ preventScroll: true }); }
  function put(r, ph) {
    const [mn, mx] = lims(), v = rbNorm(r, mn, mx), c = cur();
    if (ph === 'set' && v[0] === c[0] && v[1] === c[1]) { update(); return; }
    o.set(v, ph);
    update();
  }
  function geo() { // track rect and the width of one cell
    const r = trk.getBoundingClientRect(), [mn, mx] = lims();
    return { r, cell: Math.max(1e-6, r.width) / (mx - mn + 1), mn, mx };
  }
  trk.addEventListener('pointerdown', e => {
    if ((ti && e.target === ti.inp) || e.button !== 0 || g || dis) return;
    lastType = e.pointerType || 'mouse';
    if (e.ctrlKey && isMac()) return;
    e.preventDefault();
    const G = geo(), [lo, hi] = cur(), touch = e.pointerType === 'touch', R = touch ? 22 : 6;
    const xLo = G.r.left + (lo - G.mn) * G.cell, xHi = G.r.left + (hi - G.mn + 1) * G.cell, x = e.clientX;
    const v = clamp(G.mn + Math.floor((x - G.r.left) / G.cell), G.mn, G.mx);
    let part, r0 = [lo, hi];
    const dLo = Math.abs(x - xLo), dHi = Math.abs(x - xHi), inside = x > xLo && x < xHi;
    // edges reach R px outwards but at most a quarter of the range inwards, so a narrow range keeps a body to drag;
    // Alt (or the Alt latch) drags the body from anywhere
    const Ri = inside ? Math.min(R, (xHi - xLo) / 4) : R;
    if (modsOf(e).alt) part = 'body';
    else if (dLo <= Ri || dHi <= Ri) part = dLo < dHi || (dLo === dHi && x < xLo) ? 'lo' : 'hi';
    else if (inside) part = 'body';
    else if (x <= xLo) { part = 'lo'; r0 = [v, hi]; }
    else { part = 'hi'; r0 = [lo, v]; }
    (part === 'hi' ? hHi : hLo).focus({ preventScroll: true });
    g = { id: e.pointerId, x0: x, y0: e.clientY, part, r0, r: r0, o: [lo, hi], cell: G.cell, mn: G.mn, mx: G.mx, moved: false, touch, lp: null };
    try { trk.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    el.classList.add('wk-drag');
    o.set(cur(), 'start');
    if (r0[0] !== lo || r0[1] !== hi) { o.set(r0, 'move'); update(); }
    g.lp = longPress(part === 'hi' ? hHi : hLo, e, finish);
  });
  trk.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { finish(); return; }
    if (g.lp) g.lp.move(e);
    if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 6) g.moved = true;
    const r = rbDrag(g.r0, g.part, (e.clientX - g.x0) / g.cell, g.mn, g.mx);
    if (r[0] !== g.r[0] || r[1] !== g.r[1]) { g.r = r; o.set(r, 'move'); update(); }
  });
  function finish(back) { // back: a two-finger rollback (twoF) — also undoes an edge moved by the press
    if (!g) return null;
    const G = g;
    g = null;
    if (G.lp) G.lp.cancel();
    try { trk.releasePointerCapture(G.id); } catch (err) { /* released */ }
    el.classList.remove('wk-drag');
    if (back === true) { G.r = G.o; o.set(G.r, 'move'); lastTap = null; }
    o.set(G.r, 'end');
    update();
    if (back !== true) consumeLatches();
    return G;
  }
  trk.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  trk.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(twoF(e)); });
  trk.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) finish(); });
  trk.addEventListener('contextmenu', () => { if (g) { lastTap = null; finish(); } });
  trk.addEventListener('dblclick', e => {
    if (dis || (ti && e.target === ti.inp) || lastType === 'touch') return;
    e.preventDefault();
    edit();
  });
  const onKey = part => e => {
    if (ctxKey(e)) { e.preventDefault(); fireCtx(part === 'hi' ? hHi : hLo); return; }
    if (dis) return;
    const k = e.key, [mn, mx] = lims(), r = cur(), big = e.shiftKey ? 12 : 1;
    let to = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') to = rbDrag(r, e.altKey ? 'body' : part, big, mn, mx);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') to = rbDrag(r, e.altKey ? 'body' : part, -big, mn, mx);
    else if (k === 'PageUp' || k === 'PageDown') to = rbDrag(r, part, k === 'PageUp' ? 12 : -12, mn, mx);
    else if (k === 'Home') to = part === 'lo' ? [mn, r[1]] : [r[0], r[0]];
    else if (k === 'End') to = part === 'lo' ? [r[1], r[1]] : [r[0], mx];
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    if (!to) return;
    e.preventDefault();
    put(to, 'set');
  };
  hLo.addEventListener('keydown', onKey('lo'));
  hHi.addEventListener('keydown', onKey('hi'));
  function edit() {
    if (ti || dis) return;
    ti = typeIn(el, hLo, String(call(o.label) || 'Range'), out.textContent, t => {
      const [mn, mx] = lims(), v = o.parse ? o.parse(t) : rbParse(t, mn, mx, o.fmt);
      if (!v) return false;
      put(v, 'set');
      return true;
    }, () => { ti = null; }, String(call(o.inputMode) || 'text'));
  }
  function destroy() { if (g) finish(); if (ti) ti.cancel(); el.remove(); el.wk = null; }
  update();
  return W;
}
rangeBar.norm = rbNorm;
rangeBar.drag = rbDrag;
rangeBar.parse = rbParse;

/* ----------------------------------------------------------- pianoKeys */
// pianoKeys(o): multi-touch on-screen keyboard (keyboard panel, ARP / CLIP keyboards, OSC MAPPING; §13.9).
// o = { lo = 48, hi = 84 (MIDI notes, widened to whole white keys), on: (note, vel) => void, off: (note) => void,
// vel?: 'y' (default: velocity from the vertical touch position) | 1–127 (fixed), held?: () => iterable (notes shown
// pressed: played / sounding), lit?: () => iterable (generated by the arp / clip player: second colour), scale?: () =>
// { key: −1 | 0–11, steps: [semitones] } | null (keys outside the scale shaded, the root marked), labels?: true (C
// names, C4 = 60) | (note) → text, color?: CSS colour of pressed keys (ARP purple, CLIP green; CSS `--wk-pc`),
// litColor?: CSS colour of lit keys (CSS `--wk-pc2`; default `color`, without either the --sx-arp token), glide?:
// false (no sliding between keys: a pointer keeps the key it pressed — slot keyboards), label?, disabled?,
// fit?: true | { center = 60 (or a function), min = 2, max = 7, keyW = 24 } — the range follows the element's width
// (§13.9: 2–7 octaves by width; whole octaves C … C around `center`; a ResizeObserver re-fits, W.fit() on demand) }.
// Every pointer plays its own note (glissando: sliding to another key releases the old note first); notes are
// reference-counted over the pointers, so on(n) is called when the first pointer takes n and off(n) when the last one
// leaves it (two fingers on one key, a slide over a held key); a lost or cancelled pointer releases its note;
// W.release() releases every note (blur, page switch). W = { el, update,
// setRange(lo, hi), fit(), range() → [lo, hi], notes(), release(), destroy }. Pure maths: pianoKeys.layout(lo, hi) →
// { lo, hi, white, keys: [{ note, black, x, w }] } in white-key units; pianoKeys.hit(layout, u, v) → note (u in
// white-key units, v = fraction of the height from the top; black keys cover the top 62 %); pianoKeys.velocity(y, h) →
// 1–127 (top of the key soft, front edge loud); pianoKeys.noteName(note) → 'C4' style name; pianoKeys.fitRange(width,
// fit) → [lo, hi] (octaves = clamp(floor(width / (7·keyW)), min, max), lo = the C nearest to center − 6·octaves).
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PK_BLACK_H = 0.62, PK_BLACK_W = 0.6;
const pkName = n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
function pkLayout(lo, hi) {
  let a = clamp(Math.round(+lo || 0), 0, 127), b = clamp(Math.round(isFinite(+hi) ? +hi : 127), 0, 127);
  if (a > b) { const t = a; a = b; b = t; }
  if (BLACK[a % 12]) a--; // widened to white keys (0 and 127 are white)
  if (BLACK[b % 12]) b++;
  const keys = [];
  let wi = 0;
  for (let n = a; n <= b; n++) {
    if (BLACK[n % 12]) keys.push({ note: n, black: true, x: wi - PK_BLACK_W / 2, w: PK_BLACK_W });
    else keys.push({ note: n, black: false, x: wi++, w: 1 });
  }
  return { lo: a, hi: b, white: wi, keys };
}
function pkHit(L, u, v) {
  if (!L || !L.keys.length || !(u >= 0 && u < L.white)) return -1;
  if (v < PK_BLACK_H) for (const k of L.keys) if (k.black && u >= k.x && u < k.x + k.w) return k.note;
  const wi = Math.floor(u);
  for (const k of L.keys) if (!k.black && k.x === wi) return k.note;
  return -1;
}
const pkVel = (y, hgt) => clamp(Math.round(1 + 126 * clamp((+y || 0) / Math.max(1e-9, +hgt || 1), 0, 1)), 1, 127);
function pkFit(width, f) {
  const q = f && typeof f === 'object' ? f : {}, kw = q.keyW > 0 ? +q.keyW : 24;
  const mn = clamp(Math.round(q.min > 0 ? +q.min : 2), 1, 10), mx = clamp(Math.round(q.max > 0 ? +q.max : 7), mn, 10);
  const oct = clamp(Math.floor((+width || 0) / (7 * kw)), mn, mx), c0 = +call(q.center), c = isFinite(c0) ? c0 : 60;
  const lo = clamp(12 * Math.round((c - 6 * oct) / 12), 0, 120 - 12 * oct);
  return [lo, lo + 12 * oct];
}
export function pianoKeys(o) {
  ensureCSS(D());
  const el = h('div', 'wk-piano');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-roledescription', 'keyboard');
  el.setAttribute('data-gesture', 'music'); // an instrument: the two-finger layer never pairs its touches (chords)
  if (o.color) el.style.setProperty('--wk-pc', String(o.color));
  if (o.litColor || o.color) el.style.setProperty('--wk-pc2', String(o.litColor || o.color));
  const W = { el, update, setRange, fit, range: () => [L.lo, L.hi], notes, release, destroy };
  el.wk = W;
  let L = null, nodes = new Map(), dis = false, ro = null;
  const ptrs = new Map(); // pointerId → note
  const cnt = new Map(); // note → pointers holding it
  function setRange(lo, hi) {
    L = pkLayout(lo, hi);
    for (const n of nodes.values()) n.remove();
    nodes = new Map();
    const lbl = o.labels === true ? pkName : typeof o.labels === 'function' ? o.labels : null;
    for (const k of L.keys) {
      const e = h('div', 'wk-pk ' + (k.black ? 'wk-pb' : 'wk-pw'));
      e.setAttribute('data-note', String(k.note));
      e.style.left = (k.x / L.white * 100).toFixed(3) + '%';
      e.style.width = (k.w / L.white * 100).toFixed(3) + '%';
      if (lbl && !k.black && k.note % 12 === 0) { const t = h('span', 'wk-pl', String(lbl(k.note))); t.setAttribute('aria-hidden', 'true'); e.append(t); }
      el.append(e);
      nodes.set(k.note, e);
    }
    attr(el, 'aria-label', (call(o.label) || 'Keyboard') + ' ' + pkName(L.lo) + '–' + pkName(L.hi));
    update();
  }
  function update() {
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    const held = new Set(o.held ? o.held() || [] : []), lit = new Set(o.lit ? o.lit() || [] : []);
    for (const n of ptrs.values()) held.add(n);
    const sc = o.scale ? o.scale() : null, inKey = sc && sc.key >= 0 && Array.isArray(sc.steps) ? new Set(sc.steps.map(s => ((s % 12) + 12) % 12)) : null;
    for (const [n, e] of nodes) {
      e.classList.toggle('wk-held', held.has(n));
      e.classList.toggle('wk-lit', lit.has(n) && !held.has(n));
      const rel = inKey ? (((n - sc.key) % 12) + 12) % 12 : 0;
      e.classList.toggle('wk-out', !!inKey && !inKey.has(rel));
      e.classList.toggle('wk-root', !!inKey && rel === 0);
    }
  }
  function notes() { return [...new Set(ptrs.values())]; }
  function at(e) { // note and velocity under a pointer
    const r = el.getBoundingClientRect(), wd = Math.max(1, r.width), hg = Math.max(1, r.height);
    const u = (e.clientX - r.left) / wd * L.white, v = (e.clientY - r.top) / hg;
    const n = pkHit(L, u, v);
    if (n < 0) return null;
    const k = L.keys.find(q => q.note === n), fixed = +call(o.vel);
    const vel = fixed >= 1 && fixed <= 127 ? Math.round(fixed) : pkVel(e.clientY - r.top, k.black ? hg * PK_BLACK_H : hg);
    return { n, vel };
  }
  const noteOn = (n, vel) => { const c = cnt.get(n) || 0; cnt.set(n, c + 1); if (!c && o.on) o.on(n, vel); };
  const noteOff = n => {
    const c = cnt.get(n) || 0;
    if (c > 1) { cnt.set(n, c - 1); return; }
    cnt.delete(n);
    if (c && o.off) o.off(n);
  };
  function lift(id) {
    if (!ptrs.has(id)) return;
    const n = ptrs.get(id);
    ptrs.delete(id);
    noteOff(n);
    update();
  }
  function release() { for (const id of [...ptrs.keys()]) lift(id); }
  el.addEventListener('pointerdown', e => {
    if (dis || ptrs.has(e.pointerId) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const hit = at(e);
    if (!hit) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    ptrs.set(e.pointerId, hit.n);
    noteOn(hit.n, hit.vel);
    update();
  });
  el.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { lift(e.pointerId); return; }
    if (o.glide === false) return;
    const hit = at(e), n0 = ptrs.get(e.pointerId);
    if (!hit || hit.n === n0) return;
    ptrs.set(e.pointerId, hit.n);
    noteOff(n0);
    noteOn(hit.n, hit.vel);
    update();
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, e => lift(e.pointerId));
  el.addEventListener('contextmenu', e => { e.preventDefault(); }); // a long press plays, never opens a menu
  // o.fit: the range follows the width (no-op before layout: a zero width keeps the current range)
  function fit() {
    if (!o.fit) return;
    const wd = el.clientWidth || el.getBoundingClientRect().width;
    if (!(wd > 0)) return;
    const [lo, hi] = pkFit(wd, o.fit);
    if (!L || lo !== L.lo || hi !== L.hi) setRange(lo, hi);
  }
  function destroy() { release(); if (ro) { ro.disconnect(); ro = null; } el.remove(); el.wk = null; }
  setRange(o.lo != null ? o.lo : 48, o.hi != null ? o.hi : 84);
  if (o.fit) {
    const RO = globalThis.ResizeObserver;
    if (typeof RO === 'function') { ro = new RO(() => fit()); ro.observe(el); }
    fit();
  }
  return W;
}
pianoKeys.layout = pkLayout;
pianoKeys.hit = pkHit;
pianoKeys.velocity = pkVel;
pianoKeys.noteName = pkName;
pianoKeys.fitRange = pkFit;

/* ------------------------------------------------------------ stepGrid */
// stepGrid(o): bipolar step cells (Voice Control SEQ rows Pan, Detune, Cutoff, Env, Mod 1, Mod 2; §13.10, inv B20).
// o = { rows: [label] | () => [label], steps = 8, len?: () => active steps (later cells dimmed, still editable),
// get: (r, j) → v ∈ [−1,1], set: (r, j, v, phase), fmt?: (r, v) → text, label?, disabled? }. A press sets the cell
// from the pointer height (top +1, centre 0, bottom −1; Shift / Fine latch: relative ×0.1) and dragging across the row
// paints every cell passed (each touched cell gets its own start … end phases). One tab stop (the active cell, roving): ←→ step,
// PageUp/PageDown row, ↑↓ ±0.05 (Shift ±0.01), Home/End, Delete = 0, Enter / double-click / double-tap = typed entry
// (percent: "-50" = −0.5). stepGrid.valueAt(y, h) → v (pure; 2 decimals).
const sgVal = (y, hgt) => { const v = Math.round(clamp(1 - 2 * (+y || 0) / Math.max(1e-9, +hgt || 1), -1, 1) * 100) / 100; return v + 0; };
export function stepGrid(o) {
  ensureCSS(D());
  const el = h('div', 'wk-sg');
  el.setAttribute('role', 'grid');
  const W = { el, update, focus, destroy };
  el.wk = W;
  let cells = [], heads = [], key = null, act = [0, 0], dis = false, g = null, ti = null, lastTap = null, NS = 8, lastType = 'mouse';
  const rowsOf = () => (call(o.rows) || []).map(String);
  const val = (r, j) => { const v = +o.get(r, j); return isFinite(v) ? clamp(v, -1, 1) : 0; };
  const fmt = (r, v) => String(o.fmt ? o.fmt(r, v) : Math.round(v * 100) + '%');
  function build() {
    const rows = rowsOf(), n = Math.max(1, Math.round(call(o.steps) || 8)), k = rows.join('\u0001') + '|' + n;
    if (k === key) return;
    key = k;
    NS = n;
    for (const c of cells.flat()) c.el.remove();
    for (const hd of heads) hd.remove();
    el.style.setProperty('--wk-sgn', String(n));
    heads = [];
    cells = rows.map((t, r) => {
      const hd = h('span', 'wk-sgl', t);
      el.append(hd);
      heads.push(hd);
      return Array.from({ length: n }, (_, j) => {
        const c = h('div', 'wk-sgc'), f = h('div', 'wk-sgf');
        c.append(f);
        c.setAttribute('role', 'slider');
        c.setAttribute('data-r', String(r));
        c.setAttribute('data-j', String(j));
        c.setAttribute('aria-valuemin', '-100');
        c.setAttribute('aria-valuemax', '100');
        c.tabIndex = -1;
        el.append(c);
        return { el: c, f };
      });
    });
    if (act[0] >= rows.length) act = [0, 0];
    if (act[1] >= n) act[1] = 0;
  }
  function update() {
    build();
    dis = !!(o.disabled && o.disabled());
    setDis(el, dis);
    attr(el, 'aria-label', String(call(o.label) || 'Steps'));
    const len = o.len ? clamp(Math.round(o.len()), 0, NS) : NS, rows = rowsOf();
    cells.forEach((row, r) => row.forEach((c, j) => {
      const v = val(r, j);
      c.f.style.top = ((v >= 0 ? 0.5 - v / 2 : 0.5) * 100).toFixed(2) + '%';
      c.f.style.height = (Math.abs(v) / 2 * 100).toFixed(2) + '%';
      c.el.classList.toggle('wk-off', j >= len);
      c.el.classList.toggle('wk-neg', v < 0);
      attr(c.el, 'aria-valuenow', Math.round(v * 100));
      attr(c.el, 'aria-valuetext', fmt(r, v));
      attr(c.el, 'aria-label', rows[r] + ' step ' + (j + 1));
      c.el.tabIndex = r === act[0] && j === act[1] ? 0 : -1;
    }));
  }
  function cellAt(t) { for (let n = t; n && n !== el; n = n.parentNode) if (n.getAttribute && n.hasAttribute('data-j')) return [+n.getAttribute('data-r'), +n.getAttribute('data-j')]; return null; }
  function focus() { const c = cells[act[0]] && cells[act[0]][act[1]]; if (c) c.el.focus({ preventScroll: true }); }
  function setAct(r, j, f) { act = [r, j]; update(); if (f) focus(); }
  function put(r, j, v, ph) { v = Math.round(clamp(v, -1, 1) * 100) / 100 + 0; o.set(r, j, v, ph); }
  el.addEventListener('pointerdown', e => {
    if ((ti && e.target === ti.inp) || e.button !== 0 || g || dis) return;
    lastType = e.pointerType || 'mouse';
    const rc = cellAt(e.target);
    if (!rc) return;
    e.preventDefault();
    const [r, j] = rc, cr = cells[r][j].el.getBoundingClientRect(), fine = modsOf(e).fine;
    setAct(r, j, true);
    g = { id: e.pointerId, r, j, v: val(r, j), y: e.clientY, x0: e.clientX, y0: e.clientY, fine, moved: false, touch: e.pointerType === 'touch', done: new Map(), org: new Map() };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    el.classList.add('wk-drag');
    g.org.set(j, g.v); // every touched cell's value from before the gesture (a two-finger rollback restores them)
    o.set(r, j, g.v, 'start');
    if (!fine) { g.v = sgVal(e.clientY - cr.top, cr.height); put(r, j, g.v, 'move'); }
    g.done.set(j, g.v);
    update();
  });
  el.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { finish(); return; }
    if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 6) g.moved = true;
    const row = cells[g.r];
    let j = g.j;
    for (let k = 0; k < row.length; k++) { const q = row[k].el.getBoundingClientRect(); if (e.clientX >= q.left && e.clientX < q.right) { j = k; break; } }
    if (j !== g.j) { // painting: every cell passed since the last event (a fast swipe skips some) takes a value
      const j0 = g.j, y0 = g.y, dir = j > j0 ? 1 : -1;
      for (let k = j0 + dir; k !== j; k += dir) { // cells in between: the pointer height interpolated across the jump
        const q = row[k].el.getBoundingClientRect(), y = y0 + (e.clientY - y0) * (k - j0) / (j - j0);
        const vk = g.fine ? g.v : sgVal(y - q.top, q.height);
        if (!g.done.has(k)) { g.org.set(k, val(g.r, k)); o.set(g.r, k, g.org.get(k), 'start'); }
        put(g.r, k, vk, 'move');
        g.done.set(k, Math.round(clamp(vk, -1, 1) * 100) / 100 + 0);
      }
      g.j = j;
      act = [g.r, j];
      if (!g.done.has(j)) { g.org.set(j, val(g.r, j)); o.set(g.r, j, g.org.get(j), 'start'); }
    }
    const cr = row[j].el.getBoundingClientRect();
    const v = g.fine ? clamp(g.v + (g.y - e.clientY) / Math.max(1, cr.height) * 0.2, -1, 1) : sgVal(e.clientY - cr.top, cr.height);
    g.y = e.clientY;
    g.v = v;
    put(g.r, j, v, 'move');
    g.done.set(j, Math.round(v * 100) / 100 + 0);
    update();
  });
  function finish(back) { // back: a two-finger rollback (twoF) — every cell the gesture touched gets its old value
    if (!g) return null;
    const G = g;
    g = null;
    try { el.releasePointerCapture(G.id); } catch (err) { /* released */ }
    el.classList.remove('wk-drag');
    if (back === true) { lastTap = null; for (const [j, v] of G.org) { o.set(G.r, j, v, 'move'); o.set(G.r, j, v, 'end'); } }
    else for (const [j, v] of G.done) o.set(G.r, j, v, 'end');
    update();
    if (back !== true) consumeLatches();
    return G;
  }
  el.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    const G = finish();
    if (!G.touch || G.moved) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) { lastTap = null; edit(); }
    else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointercancel', e => { if (g && e.pointerId === g.id) finish(twoF(e)); });
  el.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) finish(); });
  el.addEventListener('dblclick', e => { if (!dis && cellAt(e.target) && lastType !== 'touch' && !(ti && e.target === ti.inp)) { e.preventDefault(); edit(); } });
  el.addEventListener('keydown', e => {
    const rc = cellAt(e.target);
    if (!rc || dis) return;
    const [r, j] = rc, k = e.key, nr = cells.length;
    if (ctxKey(e)) { e.preventDefault(); fireCtx(cells[r][j].el); return; }
    let to = null, v = null;
    if (k === 'ArrowRight') to = [r, Math.min(NS - 1, j + 1)];
    else if (k === 'ArrowLeft') to = [r, Math.max(0, j - 1)];
    else if (k === 'PageDown') to = [Math.min(nr - 1, r + 1), j];
    else if (k === 'PageUp') to = [Math.max(0, r - 1), j];
    else if (k === 'Home') to = [r, 0];
    else if (k === 'End') to = [r, NS - 1];
    else if (k === 'ArrowUp') v = val(r, j) + (e.shiftKey ? 0.01 : 0.05);
    else if (k === 'ArrowDown') v = val(r, j) - (e.shiftKey ? 0.01 : 0.05);
    else if (k === 'Delete' || k === 'Backspace') v = 0;
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    else return;
    e.preventDefault();
    if (to) { setAct(to[0], to[1], true); return; }
    put(r, j, v, 'set');
    update();
  });
  function edit() {
    if (ti || dis) return;
    const [r, j] = act, c = cells[r] && cells[r][j];
    if (!c) return;
    ti = typeIn(c.el, c.el, (rowsOf()[r] || 'Step') + ' ' + (j + 1), String(Math.round(val(r, j) * 100)), t => {
      const m = /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*%?\s*$/.exec(dashNorm(t));
      if (!m) return false;
      put(r, j, parseFloat(m[1].replace(',', '.')) / 100, 'set');
      update();
      return true;
    }, () => { ti = null; }, String(call(o.inputMode) || 'text'));
  }
  function destroy() { if (g) finish(); if (ti) ti.cancel(); el.remove(); el.wk = null; }
  update();
  return W;
}
stepGrid.valueAt = sgVal;

/* --------------------------------------------------------- modifierBar */
// modifierBar(o): the touch modifier latches (header on touch devices, §13.1): Fine (= Shift-drag), Alt (copy module,
// modulation depth, snap), Shift (multi-select, step draw). Tap = latched for the next gesture (released when that
// gesture ends), double-tap = locked (until tapped again), a tap on a latched / locked key releases it. The latches
// are page-wide (every bar shows the same state). o = { keys?: ['fine', 'alt', 'shift'], labels?: { fine, alt, shift },
// onChange?: state => void }. W = { el, update, state() → { fine, alt, shift } (0 off · 1 latched · 2 locked), clear(),
// destroy }. modifierBar.mods(e) → { fine, alt, shift } booleans (the event's own keys or a latch) — every gesture
// reads it; modifierBar.consume() releases the latched (not locked) keys — every gesture end calls it.
export function modifierBar(o) {
  o = o || {};
  ensureCSS(D());
  const LBL = Object.assign({ fine: 'Fine', alt: 'Alt', shift: 'Shift' }, o.labels || {});
  const keys = (Array.isArray(o.keys) ? o.keys : ['fine', 'alt', 'shift']).filter(k => k in LATCH);
  const el = h('div', 'wk-mkeys');
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Modifiers');
  const last = {}, btns = {};
  for (const k of keys) {
    const b = h('button', 'wk-tog wk-btn wk-mk', LBL[k]);
    b.type = 'button';
    b.setAttribute('data-mod', k);
    b.addEventListener('click', e => {
      const t = e.timeStamp, st = LATCH[k];
      LATCH[k] = st === 1 && last[k] != null && t - last[k] < 350 ? 2 : st ? 0 : 1;
      last[k] = t;
      latchChanged();
    });
    el.append(b);
    btns[k] = b;
  }
  const state = () => ({ fine: LATCH.fine, alt: LATCH.alt, shift: LATCH.shift });
  let sig = '';
  function update() {
    for (const k of keys) {
      const b = btns[k], st = LATCH[k];
      b.classList.toggle('wk-on', st > 0);
      b.classList.toggle('wk-lock', st === 2);
      attr(b, 'aria-pressed', st > 0 ? 'true' : 'false');
      attr(b, 'aria-label', LBL[k] + (st === 2 ? ' (locked)' : st === 1 ? ' (next gesture)' : ''));
    }
    const s = JSON.stringify(state());
    if (s !== sig) { sig = s; if (o.onChange) o.onChange(state()); }
  }
  function clear() { let ch = false; for (const k in LATCH) if (LATCH[k]) { LATCH[k] = 0; ch = true; } if (ch) latchChanged(); }
  latchSubs.add(update);
  function destroy() { latchSubs.delete(update); el.remove(); el.wk = null; }
  const W = { el, update, state, clear, destroy };
  el.wk = W;
  sig = JSON.stringify(state());
  update();
  return W;
}
modifierBar.mods = modsOf;
modifierBar.consume = consumeLatches;

/* ---------------------------------------------------------- dragSource */
// dragSource(el, payload): the drag gesture of tiles, module labels and handles (drag-to-modulate, module copy / swap;
// §13.1). Mouse / pen: the drag starts after `slop` (4) px of travel. Touch: a `hold` (250 ms) without moving more than
// 8 px arms it (class wk-armed; page scrolling is blocked from then on) and `touchSlop` (6) px of travel from there, in
// any direction, starts it — a quicker swipe stays a scroll, finger jitter during a still hold starts nothing, and a still
// hold of 500 ms still opens the long-press menu (a contextmenu before the drag starts abandons it; one during the drag,
// from a long-press timer that outlived the start, is swallowed). payload.scrollAxis ('x' | 'y' | 'none', or a function
// returning one, read at each touch press) makes the touch start axis-aware: the axis el's container scrolls natively
// (its touch-action: pan-x / pan-y). A touch whose first `touchSlop` px run mainly ACROSS that axis starts the drag at
// once, no hold; mainly ALONG it, it is left to the browser as a scroll (abandoned); 'none' (nothing scrolls under el,
// e.g. touch-action: none) starts it on the first `touchSlop` px in any direction. Such a drag is `quick` in its info: it
// may be a flick (a habitual page-scroll swipe), so a consumer can ask the finger to settle on a target before its drop
// counts. Touch needs one finger: a non-primary touch starts nothing, and another pointer going down anywhere (watched
// in the document's capture phase) or a touchmove with two touches abandons a gesture that has not started — a pinch or
// two-finger scroll is never taken for a drag. Once a touch drag is decided, el's own non-passive touchmove listener
// (registered before any touch begins, as iOS Safari requires; touch events stay aimed at the touched node) cancels
// every move, so the page does not scroll and Safari does not pointercancel the gesture; the decision is also taken from
// a touchmove that arrives before its pointermove. payload = { data (value or () => value), begin?(info), move?(info),
// drop?(info), cancel?(info), hold?, slop?, touchSlop?, scrollAxis?, autoScroll? }; info = { data, x, y, alt, shift,
// fine (the event keys or modifier latches at the press or the start), pointerType, quick (a touch drag started without
// the hold), t (the event's timeStamp; performance.now() without one), scrolled (below), target (the element under the
// pointer: document.elementFromPoint — a drag ghost needs pointer-events: none) }. The click that ends a drag is
// swallowed; Escape cancels; the latches are consumed when a drag ends. Returns { active() → bool, cancel(), destroy() }.
// Edge auto-scroll (payload.autoScroll !== false; vertical only): while a drag is live, a pen or touch pointer in the
// AS_EDGE zone at the top / bottom of the visible part of a scroll container — the innermost one under the pointer that
// can still scroll that way (CSS overflow-y auto / scroll), else the page — scrolls it on animation frames, faster the
// deeper it is (dragSource.edge: quadratic, ramping in over AS_RAMP ms; each step clamped to the scroll range in JS — iOS
// reads back an out-of-range scrollTop as set — and none past the limits). A mouse has no zone: it scrolls only past the
// edge (over a pinned bar, outside the window), so desktop drags near the header stay put. The page's band is the visual
// viewport less the host's pinned bars, marked data-wk-inset="top" | "bottom" (a pointer over them is past the edge:
// full speed), and less the root's scroll-padding-top / -bottom (the installed app's status-bar strip). A direction
// counts once the pointer has been outside its zone since the start, or moved AS_ARM px that way (a drag that starts in
// a zone does not scroll at once). Each frame that scrolled calls move(info) again at the same x, y (targets move under
// a still finger; t = the last event's time + the frames since); info.scrolled = ms since the last auto-scroll step
// (Infinity: none), so a consumer can ask a drop to rest on a target that a scroll brought. Stops before the drop /
// cancel callbacks (a scroll would close a menu the drop opens) and while the page is hidden. Inside the canvas world
// ([data-cv-world]) with a setEdgeHook hook: what no DOM scroller takes pans the camera (hook.pan(pointer | null): both
// axes, its band; edgePan2's law), and each camera step re-fires move at the same x, y with scrolled 0.
const AS_EDGE = { mouse: 0, pen: 72, touch: 72 }, AS_MAX = { mouse: 1200, pen: 1200, touch: 1200 }; // zone depth (px), top speed (px/s)
const AS_RAMP = 240, AS_ARM = 12, AS_MAXDT = 50, AS_MINBAND = 96;
// signed speed (px/s; < 0 toward lo) of a pointer at p in the band [lo, hi]: ±max past an edge (whatever the zone), 0
// in the middle, quadratic in the depth into an edge zone (a zone is at most a quarter of the band)
function asEdge(p, lo, hi, edge, max) {
  if (!(max > 0) || !isFinite(p) || !(hi > lo)) return 0;
  if (p < lo) return -max; if (p > hi) return max; // over a pinned bar / outside the window
  const e = Math.min(+edge || 0, (hi - lo) / 4);
  if (!(e > 0)) return 0;
  const k = clamp(p < lo + e ? (p - lo - e) / e : p > hi - e ? (p - hi + e) / e : 0, -1, 1);
  return k * Math.abs(k) * max;
}
const asInsets = d => { try { const q = d && typeof d.querySelectorAll === 'function' ? d.querySelectorAll('[data-wk-inset]') : null; return q ? Array.from(q) : []; } catch (err) { return []; } };
// the root's scroll-padding-top / -bottom in px (style.css: env(safe-area-inset-top), the PWA's status-bar strip): { t, b }
function asPad(d, root) {
  const px = v => (/^-?[\d.]+px$/.test(String(v || '').trim()) ? Math.max(0, parseFloat(v)) : 0);
  try {
    const w = d && d.defaultView, cs = root && w && typeof w.getComputedStyle === 'function' ? w.getComputedStyle(root) : null;
    return cs ? { t: px(cs.scrollPaddingTop), b: px(cs.scrollPaddingBottom) } : { t: 0, b: 0 };
  } catch (err) { return { t: 0, b: 0 }; }
}
// the page's visible band in client px: the visual viewport less the pinned bars that overlap it and the root's scroll
// padding (at least AS_MINBAND each way). top / bottom bars first (dragSource reads only those: unchanged), then the
// canvas's side trays (data-wk-inset="left" | "right") against the band they leave
function asBand(d, insets, pad) {
  const w = (d && d.defaultView) || globalThis, vv = w.visualViewport || null, H = +w.innerHeight || 0, W = +w.innerWidth || 0;
  const top = vv ? +vv.offsetTop || 0 : 0, left = vv ? +vv.offsetLeft || 0 : 0;
  const B = { top, bottom: top + (vv && vv.height > 0 ? +vv.height : H), left, right: left + (vv && vv.width > 0 ? +vv.width : W) };
  const rects = [];
  for (const n of insets) {
    let r = null;
    try { r = n.isConnected === false ? null : n.getBoundingClientRect(); } catch (err) { r = null; }
    if (r && r.bottom > r.top) rects.push([n.getAttribute('data-wk-inset'), r]);
  }
  for (const [s, r] of rects) {
    if (r.bottom <= B.top || r.top >= B.bottom) continue;
    if (s === 'top') B.top = Math.max(B.top, Math.min(r.bottom, B.bottom - AS_MINBAND));
    else if (s !== 'left' && s !== 'right') B.bottom = Math.min(B.bottom, Math.max(r.top, B.top + AS_MINBAND));
  }
  if (pad && pad.t > 0) B.top = Math.max(B.top, Math.min(pad.t, B.bottom - AS_MINBAND));
  if (pad && pad.b > 0 && H > 0) B.bottom = Math.min(B.bottom, Math.max(H - pad.b, B.top + AS_MINBAND));
  for (const [s, r] of rects) {
    if ((s !== 'left' && s !== 'right') || !(r.right > r.left) || r.bottom <= B.top || r.top >= B.bottom || r.right <= B.left || r.left >= B.right) continue;
    if (s === 'left') B.left = Math.max(B.left, Math.min(r.right, B.right - AS_MINBAND));
    else B.right = Math.min(B.right, Math.max(r.left, B.left + AS_MINBAND));
  }
  return B;
}
// does n scroll vertically (computed overflow-y auto / scroll / overlay; hidden / visible / clip never here)? cached per drag
function asScrolls(d, n, cache) {
  let s = cache.get(n);
  if (s !== undefined) return s;
  s = false;
  try {
    const w = d && d.defaultView, cs = w && typeof w.getComputedStyle === 'function' ? w.getComputedStyle(n) : null;
    s = !!cs && /^(auto|scroll|overlay)$/.test(String(cs.overflowY || ''));
  } catch (err) { /* no style: not a scroller */ }
  cache.set(n, s);
  return s;
}
// n's greatest scrollTop (the page's visible height: the larger of its clientHeight and innerHeight — iOS)
const asLim = (n, root, w) => Math.max(0, (+n.scrollHeight || 0) - (n === root ? Math.max(+n.clientHeight || 0, +(w && w.innerHeight) || 0) : +n.clientHeight || 0));
// can n still scroll in direction dir (−1 up | 1 down)?
function asRoom(n, dir, lim) {
  const pos = +n.scrollTop || 0;
  return lim > 1 && (dir < 0 ? pos > 0.5 : pos < lim - 0.5);
}
export function dragSource(el, payload) {
  const P = payload || {};
  const hold = P.hold >= 0 ? +P.hold : 250, slop = P.slop > 0 ? +P.slop : 4, tslop = P.touchSlop > 0 ? +P.touchSlop : 6;
  const auto = P.autoScroll !== false;
  let g = null, keyOff = null, clickOff = null, A = null; // A: the live drag's auto-scroll state
  const under = (x, y) => { const d = D(); try { return d && typeof d.elementFromPoint === 'function' ? d.elementFromPoint(x, y) : null; } catch (err) { return null; } };
  const tOf = e => (e && typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : nowMs());
  const info = (G, x, y, e, t) => {
    const T = t != null ? t : tOf(e);
    return { data: call(P.data), x, y, alt: G.m.alt, shift: G.m.shift, fine: G.m.fine, pointerType: G.type,
      quick: !!G.quick, t: T, scrolled: G.st != null ? Math.max(0, T - G.st) : Infinity, target: under(x, y) };
  };
  const cb = (k, i) => { if (typeof P[k] === 'function') P[k](i); };
  const axisOf = () => {
    let a = P.scrollAxis;
    if (typeof a === 'function') { try { a = a(); } catch (err) { a = null; } }
    return a === 'x' || a === 'y' || a === 'none' ? a : null;
  };
  // A pending touch at (x, y): 'drag', 'scroll' (the browser's: abandoned) or null (undecided yet).
  function verdict(G, x, y) {
    if (G.armed) return Math.hypot(x - G.ax, y - G.ay) > tslop ? 'drag' : null;
    const dx = Math.abs(x - G.x0), dy = Math.abs(y - G.y0), d = Math.hypot(dx, dy);
    if (!G.axis) return d > 8 ? 'scroll' : null; // moved before the hold: a scroll
    if (d <= tslop) return null;
    if (G.axis === 'none') return 'drag';
    return (G.axis === 'x' ? dy > dx : dx > dy) ? 'drag' : 'scroll';
  }
  const unwatch = G => { if (G && G.docOff) { G.docOff(); G.docOff = null; } };
  /* ---- edge auto-scroll (asEdge above); A = { G, d, w, root, insets, pad, css, carry, cancel, prev, t0, arm, y0, rootT, off,
   * hook, camOff } */
  function asBegin(e) {
    const d = el.ownerDocument || D();
    if (!auto || !d) return;
    const root = d.scrollingElement || d.documentElement || null;
    A = { G: g, d, w: d.defaultView || null, root, insets: asInsets(d), pad: asPad(d, root), css: new Map(), carry: new Map(),
      cancel: null, prev: -1, t0: -1, arm: {}, y0: e.clientY, rootT: null, hook: null, camOff: null,
      off: listen(d, 'visibilitychange', () => { if (d.visibilityState === 'hidden') { asHalt(); asCam(true); } }) };
    // inside the canvas world (setEdgeHook: no DOM scroller there — #viewport clips) what no scroller takes pans the
    // camera; each camera step re-fires move at the same x, y (scrolled 0: targets moved under a still pointer)
    if (edgeHook && inWorld(el)) {
      const G0 = g, hk = edgeHook;
      A.hook = hk;
      try {
        A.camOff = hk.onCamera(() => {
          if (!A || A.G !== G0 || g !== G0 || !G0.on) return;
          const t = Math.max(G0.tEv, nowMs());
          G0.st = t;
          const i = info(G0, G0.x, G0.y, null, t);
          G0.over = i.target;
          cb('move', i);
        });
      } catch (err) { A.camOff = null; }
      asCam(); // (from the press point: the directions it does not ask for arm at once, as asPlan)
    }
  }
  // the camera hook gets the pointer while no DOM scroller scrolls for it (null: one does, or stop)
  function asCam(stop) {
    if (!A || !A.hook) return;
    const G = A.G;
    try { A.hook.pan(stop || A.cancel || !G.on ? null : { x: G.x, y: G.y, pointerType: G.type }); } catch (err) { /* hook gone */ }
  }
  function asHalt() { // no more scrolling until the pointer next asks for it (the drag goes on)
    if (!A) return;
    if (A.cancel) { A.cancel(); A.cancel = null; }
    A.prev = -1; A.t0 = -1;
    A.carry.clear();
  }
  function asEnd() {
    if (!A) return;
    asHalt();
    asCam(true);
    if (A.camOff) { try { A.camOff(); } catch (err) { /* gone */ } }
    A.off();
    A = null;
  }
  // what would scroll for the pointer at client y over element t: { n, v (px/s; < 0 up) } or null
  function asPlan(y, t) {
    const G = A.G, d = A.d, root = A.root, kind = G.type === 'touch' || G.type === 'pen' ? G.type : 'mouse';
    const E = AS_EDGE[kind], M = AS_MAX[kind], B = asBand(d, A.insets, A.pad);
    let h = null;
    for (let n = t; !h && n && n.nodeType === 1 && n !== root && n !== d.body; n = n.parentNode) {
      if (!asScrolls(d, n, A.css)) continue;
      const r = n.getBoundingClientRect(), v = asEdge(y, Math.max(r.top, B.top), Math.min(r.bottom, B.bottom), E, M);
      if (v && asRoom(n, Math.sign(v), asLim(n, root, A.w))) h = { n, v };
    }
    if (!h && root) { const v = asEdge(y, B.top, B.bottom, E, M); if (v && asRoom(root, Math.sign(v), asLim(root, root, A.w))) h = { n: root, v }; }
    // arming: a direction this evaluation does not ask for is armed from now on; an unarmed one needs AS_ARM px that way
    const s = h ? (h.v < 0 ? '-' : '+') : '';
    if (s !== '-') A.arm['-'] = true;
    if (s !== '+') A.arm['+'] = true;
    if (h && !A.arm[s]) { if ((y - A.y0) * Math.sign(h.v) >= AS_ARM) A.arm[s] = true; else h = null; }
    return h;
  }
  // scroll h.n by `delta` px (sub-pixel remainders carried: scroll offsets may be whole px), clamped to its range here —
  // iOS does not clamp a script scroll at once (WebKit bug 179735); true if it moved
  function asStep(h, delta) {
    const want = (A.carry.get(h.n) || 0) + delta, step = want < 0 ? Math.ceil(want) : Math.floor(want);
    if (!step) { A.carry.set(h.n, want); return false; }
    const b = +h.n.scrollTop || 0, to = clamp(b + step, 0, asLim(h.n, A.root, A.w));
    if (to === b) { A.carry.set(h.n, 0); return false; }
    h.n.scrollTop = to;
    const got = (+h.n.scrollTop || 0) - b;
    A.carry.set(h.n, got === step ? want - step : 0);
    return got !== 0;
  }
  function asTick(ts) {
    if (!A) return;
    A.cancel = null;
    const G = A.G;
    if (g !== G || !G.on) return;
    if (A.d.visibilityState === 'hidden') { asHalt(); asCam(true); return; }
    const now = +ts || 0, dt = A.prev < 0 ? 0 : clamp(now - A.prev, 0, AS_MAXDT);
    A.prev = now;
    if (G.fT < 0) G.fT = now; // the first frame since the last pointer event
    const h = asPlan(G.y, G.over !== undefined ? G.over : under(G.x, G.y));
    if (!h) { asHalt(); asCam(); return; } // (a scroller at its end: the camera takes over)
    if (A.t0 < 0) A.t0 = now;
    const k = AS_RAMP > 0 ? Math.min(1, (now - A.t0) / AS_RAMP) : 1, t = G.tEv + (now - G.fT);
    if (asStep(h, h.v * k * dt / 1000)) {
      if (h.n === A.root) A.rootT = t;
      G.st = t;
      const i = info(G, G.x, G.y, null, t);
      G.over = i.target;
      cb('move', i); // targets moved under the pointer: the consumer hit-tests again
    }
    if (A && g === G) A.cancel = frame(asTick); // (the move callback may have ended the drag)
  }
  function asKick(target) { // after a pointer move: start the frames when an edge asks for a scroll
    if (!A || A.cancel || A.G !== g) return;
    if (asPlan(g.y, target)) { A.prev = -1; A.t0 = -1; A.cancel = frame(asTick); }
  }
  // iOS WebKit may give a touch / pen move (or two) wrong clientX / clientY right after the page scrolled by script
  // (WebKit bug 181954): within JUMP_MS of a page step, a jump of more than JUMP_PX is dropped — never two in a row
  // (gesture.js jumpy, shared with the two-finger layer's pan)
  const asOutlier = (G, x, y, t) => !!A && G.type !== 'mouse' && jumpy(G, x, y, t, A.rootT);
  function abandon() { // a pending (not started) gesture
    if (g.timer) clearTimeout(g.timer);
    unwatch(g);
    el.classList.remove('wk-armed');
    g = null;
  }
  function start(e) {
    const m = modsOf(e);
    g.m = { alt: g.m.alt || m.alt, shift: g.m.shift || m.shift, fine: g.m.fine || m.fine };
    g.on = true;
    g.quick = g.type === 'touch' && !g.armed;
    unwatch(g);
    if (g.timer) { clearTimeout(g.timer); g.timer = 0; }
    el.classList.remove('wk-armed');
    el.classList.add('wk-dragging');
    try { el.setPointerCapture(g.id); } catch (err) { /* pointer gone */ }
    const d = D();
    if (d) keyOff = listen(d, 'keydown', ev => { if (ev.key === 'Escape' && g && g.on) { ev.preventDefault(); ev.stopPropagation(); end(null, true); } }, true);
    g.tEv = tOf(e); g.fT = -1;
    asBegin(e);
    cb('begin', info(g, e.clientX, e.clientY, e));
  }
  function end(e, cancelled) {
    const G = g;
    if (!G) return;
    g = null;
    // a lifted finger's position that a script scroll may have spoilt (asOutlier): the last good one
    const bad = !!e && asOutlier(G, e.clientX, e.clientY, tOf(e));
    asEnd(); // before any callback: no scroll after the drop (a scroll closes the menu a drop may open)
    if (G.timer) clearTimeout(G.timer);
    unwatch(G);
    if (keyOff) { keyOff(); keyOff = null; }
    try { el.releasePointerCapture(G.id); } catch (err) { /* released */ }
    el.classList.remove('wk-armed', 'wk-dragging');
    if (!G.on) return;
    const i = info(G, e && !bad ? e.clientX : G.x, e && !bad ? e.clientY : G.y, e);
    if (cancelled) cb('cancel', i);
    else { if (e) eatClick(e.timeStamp); cb('drop', i); }
    if (!twoF(e)) consumeLatches(); // a two-finger rollback leaves the latches for the next gesture
  }
  // The click that follows the drop is swallowed in the document's capture phase (before any listener of el, whatever
  // the order they were added in); the one-shot listener goes with the next click anywhere.
  function eatClick(t0) {
    const d = D();
    if (!d) return;
    if (clickOff) clickOff();
    const off = listen(d, 'click', ev => {
      off();
      if (clickOff === off) clickOff = null;
      if (ev.timeStamp >= t0 && ev.timeStamp - t0 < 600 && ev.target && el.contains(ev.target)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    }, true);
    clickOff = off;
  }
  // a touchmove's verdict (one finger only; the pointermove of the same move decides as well)
  const touchVerdict = e => {
    const T = e.touches;
    if (!T || T.length !== 1 || !T[0]) return null;
    return verdict(g, +T[0].clientX || 0, +T[0].clientY || 0);
  };
  const offs = [
    listen(el, 'pointerdown', e => {
      if (e.button !== 0 || g) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const touch = e.pointerType === 'touch';
      if (touch && e.isPrimary === false) return; // a second finger (a pinch, a two-finger scroll): never a drag
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, ax: e.clientX, ay: e.clientY, type: e.pointerType || 'mouse',
        on: false, armed: !touch, quick: false, timer: 0, docOff: null, m: modsOf(e), axis: touch ? axisOf() : null,
        tEv: 0, fT: -1, st: null, over: undefined, held: false }; // (auto-scroll: event time, its first frame, last step, target, a move held back)
      if (!touch) return;
      g.timer = setTimeout(() => { if (g && !g.on) { g.timer = 0; g.armed = true; g.ax = g.x; g.ay = g.y; el.classList.add('wk-armed'); } }, hold);
      // another pointer down anywhere before the drag starts (a second finger off el): abandoned
      const d = el.ownerDocument || D();
      if (d) g.docOff = listen(d, 'pointerdown', ev => { if (g && !g.on && ev.pointerId !== g.id) abandon(); }, true);
    }),
    listen(el, 'pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (g.on && !g.held && asOutlier(g, e.clientX, e.clientY, tOf(e))) { g.held = true; return; } // one move at most: the next is taken
      g.held = false;
      g.x = e.clientX; g.y = e.clientY;
      if (!g.on) {
        if (g.type === 'touch') {
          const v = verdict(g, e.clientX, e.clientY);
          if (v === 'scroll') { abandon(); return; }
          if (v !== 'drag') return;
        } else if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= slop) return;
        start(e);
      }
      g.tEv = tOf(e); g.fT = -1;
      const i = info(g, e.clientX, e.clientY, e);
      g.over = i.target;
      cb('move', i);
      asKick(i.target);
      asCam();
    }),
    listen(el, 'pointerup', e => { if (g && e.pointerId === g.id) end(e, false); }),
    listen(el, 'pointercancel', e => { if (g && e.pointerId === g.id) end(e, true); }),
    // only el's own capture counts: start() takes it from the touched child (a tile's label span holds the implicit
    // touch capture), and the browser then fires a bubbling lostpointercapture at that child
    listen(el, 'lostpointercapture', e => { if (g && g.on && e.pointerId === g.id && e.target === el) end(e, true); }),
    listen(el, 'contextmenu', e => {
      if (!g) return;
      if (g.on) { e.preventDefault(); e.stopImmediatePropagation(); return; } // a long-press that outlived the start
      abandon();
    }),
    listen(el, 'touchmove', e => {
      if (!g) return;
      if (!g.on && g.type === 'touch' && e.touches && e.touches.length > 1) { abandon(); return; } // two fingers: theirs
      if (!e.cancelable) return;
      if (g.on || (g.type === 'touch' && (g.armed || touchVerdict(e) === 'drag'))) e.preventDefault();
    }, { passive: false }),
  ];
  return {
    active: () => !!(g && g.on),
    cancel: () => end(null, true),
    destroy() { if (g) end(null, true); for (const f of offs) f(); if (clickOff) { clickOff(); clickOff = null; } },
  };
}
dragSource.edge = asEdge;

/* ------------------------------------------------------------- zoomPan */
// zoomPan(el, o): pinch zoom and two-finger pan for canvases (sample displays, spectrograms, the piano roll, the arp
// graph, the LFO editor; §13.1), plus trackpad pinch / Ctrl-Cmd-wheel zoom at the pointer and Shift-wheel /
// horizontal-wheel pan (the latter only with the mouse-wheel preference on). o = { axis: 'x' | 'y' | 'xy' (default
// 'x'), get: () => view, set: (view, phase), min = 0.001 (smallest span), max = 1 (largest span), wheel = true,
// rect?: () => { left, top, width, height } — the client rect the view is drawn into (default el's box; an editor
// whose plot is inset passes the plot, so the content under the fingers stays under them) }; view = { x0, x1, y0, y1 }:
// the visible window as fractions of the content (y from the top). Touches that go down on el are tracked through
// the document (capture phase), so a finger lifted outside el (an editor released its capture when the pinch began)
// is still forgotten, and a primary touch (no other touch on the screen) drops any stale one. While two touches are
// down it consumes their moves (the canvas's own one-finger gesture sees none) and active() is true. Returns
// { active(), destroy() }. Pure maths: zoomPan.zoom(view, f, cx, cy, o) — zoom by f (> 1 = in) keeping the content
// under viewport fraction (cx, cy) in place; zoomPan.pan(view, dx, dy, o) — move the window by dx / dy viewport
// fractions (positive = later content); both clamp to the content and return a new view.
function zpView(v) {
  const q = v || {}, n = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  let x0 = clamp(n(q.x0, 0), 0, 1), x1 = clamp(n(q.x1, 1), 0, 1), y0 = clamp(n(q.y0, 0), 0, 1), y1 = clamp(n(q.y1, 1), 0, 1);
  if (x1 <= x0) { x0 = 0; x1 = 1; }
  if (y1 <= y0) { y0 = 0; y1 = 1; }
  return { x0, x1, y0, y1 };
}
function zpLims(o) {
  const mn = o && o.min > 0 ? Math.min(1, +o.min) : 0.001, mx = o && o.max > 0 ? Math.min(1, +o.max) : 1;
  return [mn, Math.max(mn, mx)];
}
function zpAxis(a0, a1, f, c, mn, mx) {
  const span = a1 - a0, s = clamp(span / f, mn, mx), p = a0 + c * span, n0 = clamp(p - c * s, 0, 1 - s);
  return [n0, n0 + s];
}
function zpZoom(view, f, cx, cy, o) {
  const v = zpView(view), ax = (o && o.axis) || 'x', [mn, mx] = zpLims(o);
  if (!(f > 0) || !isFinite(f)) return v;
  if (ax !== 'y') [v.x0, v.x1] = zpAxis(v.x0, v.x1, f, clamp(+cx || 0, 0, 1), mn, mx);
  if (ax !== 'x') [v.y0, v.y1] = zpAxis(v.y0, v.y1, f, clamp(+cy || 0, 0, 1), mn, mx);
  return v;
}
function zpPan(view, dx, dy, o) {
  const v = zpView(view), ax = (o && o.axis) || 'x';
  if (ax !== 'y' && dx) { const s = v.x1 - v.x0, a = clamp(v.x0 + dx * s, 0, 1 - s); v.x0 = a; v.x1 = a + s; }
  if (ax !== 'x' && dy) { const s = v.y1 - v.y0, a = clamp(v.y0 + dy * s, 0, 1 - s); v.y0 = a; v.y1 = a + s; }
  return v;
}
export function zoomPan(el, o) {
  o = o || {};
  const ax = o.axis === 'y' || o.axis === 'xy' ? o.axis : 'x', O = { axis: ax, min: o.min, max: o.max };
  const pts = new Map();
  let G = null, cur = null, docOff = null;
  // el owns its two-finger gestures: the two-finger layer (gesture.js) leaves a pinch with both fingers on el alone
  const mark = !!el.setAttribute && !el.hasAttribute('data-gesture');
  if (mark) el.setAttribute('data-gesture', 'own');
  const get = () => zpView(o.get ? o.get() : null);
  const rectOf = () => { const r = o.rect ? o.rect() : null; return r && isFinite(r.left) && isFinite(r.top) ? r : el.getBoundingClientRect(); };
  function begin() {
    const [a, b] = [...pts.values()], r = rectOf();
    G = { r, v0: get(), ax: Math.abs(a.x - b.x), ay: Math.abs(a.y - b.y), d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    cur = G.v0;
    if (o.set) o.set(G.v0, 'start');
  }
  function track() {
    const [a, b] = [...pts.values()], R = G.r, w = Math.max(1, R.width), hh = Math.max(1, R.height);
    const d = Math.hypot(a.x - b.x, a.y - b.y), dxa = Math.abs(a.x - b.x), dya = Math.abs(a.y - b.y);
    let f = G.d > 1 ? d / G.d : 1;
    if (ax === 'x' && G.ax > 24) f = dxa / G.ax; // pinch along the axis when the fingers are spread along it
    else if (ax === 'y' && G.ay > 24) f = dya / G.ay;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const c0x = (G.mx - R.left) / w, c0y = (G.my - R.top) / hh, c1x = (mx - R.left) / w, c1y = (my - R.top) / hh;
    const z = zpZoom(G.v0, f > 0.01 ? f : 0.01, c0x, c0y, O);
    cur = zpPan(z, c0x - c1x, c0y - c1y, O);
    if (o.set) o.set(cur, 'move');
  }
  function end() { if (G) { G = null; if (o.set) o.set(cur, 'end'); consumeLatches(); } }
  function lift(id) {
    if (!pts.has(id)) return;
    pts.delete(id);
    if (pts.size < 2) end();
    if (!pts.size && docOff) docOff();
  }
  // tracked touches are followed through the document while any is down (their pointerup may land outside el)
  function onMove(e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!G) return;
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
    if (pts.size >= 2) track();
  }
  const onUp = e => lift(e.pointerId);
  function watch() {
    if (docOff) return;
    const d = el.ownerDocument || D();
    if (!d) return;
    const offs2 = [listen(d, 'pointermove', onMove, true), listen(d, 'pointerup', onUp, true), listen(d, 'pointercancel', onUp, true)];
    docOff = () => { for (const f of offs2) f(); docOff = null; };
  }
  const offs = [
    listen(el, 'pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary === true && pts.size) { pts.clear(); end(); } // no other touch is down: forget stale ones
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      watch();
      if (pts.size === 2 && !G) begin();
    }, true),
    listen(el, 'wheel', e => {
      if (o.wheel === false) return;
      const r = rectOf(), w = Math.max(1, r.width), hh = Math.max(1, r.height);
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      // trackpad pinch arrives as Ctrl-wheel: an explicit zoom, never left to the browser's page zoom (the camera takes
      // the ones it wants first, in its capture phase); the pan only outside the veto (a camera gliding under the pointer)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const f = Math.exp(-(e.deltaY || 0) * k * 0.002);
        cur = zpZoom(get(), f, (e.clientX - r.left) / w, (e.clientY - r.top) / hh, O);
        if (o.set) o.set(cur, 'set');
      } else if (!vetoed() && prefs.wheel && (e.shiftKey || Math.abs(e.deltaX || 0) > Math.abs(e.deltaY || 0))) {
        const px = (e.deltaX || (e.shiftKey ? e.deltaY : 0) || 0) * k;
        if (!px) return;
        e.preventDefault();
        cur = ax === 'y' ? zpPan(get(), 0, px / hh, O) : zpPan(get(), px / w, 0, O);
        if (o.set) o.set(cur, 'set');
      }
    }, { passive: false }),
  ];
  return {
    active: () => !!G,
    destroy() { for (const f of offs) f(); if (docOff) docOff(); pts.clear(); G = null; if (mark && el.getAttribute('data-gesture') === 'own') el.removeAttribute('data-gesture'); },
  };
}
zoomPan.zoom = zpZoom;
zoomPan.pan = zpPan;

/* ------------------------------------------- shared browser infrastructure */
// Dispatch the kit's `contextmenu` on `el` (no x/y = keyboard origin: the menu focuses its first item).
export function fireContext(el, x, y) { fireCtx(el, x, y); }
// Makes a custom element a context-menu source like the widgets: ContextMenu / Shift+F10 (unless keys = false)
// and a 500 ms touch long-press dispatch one `contextmenu`. A long-press needs a single finger: a second touch on el
// (a pinch, whose moves wk.zoomPan consumes before they reach el) cancels it, and a non-primary touch or one that
// lands while another is down on el arms none; a primary touch (no other touch on the screen) forgets touches whose
// pointerup landed elsewhere. Returns a remover.
export function menuSource(el, opts) {
  const keys = !opts || opts.keys !== false;
  ctxGuard(el);
  let lp = null;
  const down = new Set(); // touch pointers down on el
  const stop = () => { if (lp) lp.cancel(); lp = null; };
  const up = e => { down.delete(e.pointerId); stop(); };
  const offs = [
    listen(el, 'keydown', e => { if (keys && e.target === el && ctxKey(e)) { e.preventDefault(); fireCtx(el); } }),
    listen(el, 'pointerdown', e => {
      stop();
      if (e.pointerType === 'touch') {
        if (e.isPrimary === true) down.clear();
        down.add(e.pointerId);
        if (e.isPrimary === false || down.size > 1) return; // multi-touch: no long-press
      }
      lp = longPress(el, e, null);
    }),
    listen(el, 'pointermove', e => { if (lp) lp.move(e); }),
    listen(el, 'pointerup', up),
    listen(el, 'pointercancel', up),
  ];
  return () => { for (const f of offs) f(); stop(); down.clear(); };
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
// Size a canvas for its CSS (layout) box at storeDensity's backing scale; returns the 2D context in CSS px (or null).
// (milestone 3, IMPL-3 §1.4 H5) ONE density rule for every display canvas — fitCanvas, serum-ui paintCanvas, sx-ui-seq
// storeDpr — storeDensity(el, w?, h?) → backing px per layout px:
//   · outside the canvas world: the device pixel ratio, capped at 2 (§13.1, unchanged);
//   · inside it (an ancestor [data-cv-world], scaled by the camera's k: setCanvasScale, written at a zoom's rest only, never
//     in a burst): dpr · k — the cap of 2 lifted, so ≥ 1:1 on screen at every zoom (R3) — and at least 0.5;
//   · the total budget's cap when cv-world set one for el (setStoreCaps: past CANVAS_BUDGET bytes the off-screen canvases
//     drop to the dpr first, then the on-screen ones farthest from the viewport centre);
//   · given its layout size w × h: ≤ CANVAS_MAX_PX device px (16e6) per canvas.
// The density handed out is remembered per element (storedDensity: the budget's projection and canvasStats, no layout read).
export const CANVAS_MAX_PX = 16e6;
/** (H5) The cap on Σ every canvas store in the world, on and off screen (bytes, 4 per px; SPEC-canvas §9.3). */
export const CANVAS_BUDGET = 64 * 1024 * 1024;
let canvasK = 1, storeCaps = new WeakMap(), capped = []; // (capped: the canvases holding a cap, for the next diff)
const handed = new WeakMap(); // canvas → the density storeDensity last gave it
const inWorld = el => { for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('data-cv-world')) return true; return false; };
/** The device pixel ratio, uncapped (≥ 1). */
export function deviceRatio() { const d = D(), win = d && d.defaultView || globalThis; return Math.max(1, +win.devicePixelRatio || 1); }
export function storeDensity(el, w, hgt) {
  const raw = deviceRatio();
  let s = raw <= 2 && canvasK === 1 ? raw : inWorld(el) ? Math.max(0.5, raw * canvasK) : Math.min(2, raw); // (k 1 and dpr ≤ 2: no walk)
  const cap = el && typeof el === 'object' ? storeCaps.get(el) : undefined;
  if (cap > 0 && cap < s) s = cap;
  const area = w > 0 && hgt > 0 ? w * hgt : 0;
  if (area && area * s * s > CANVAS_MAX_PX) s = Math.sqrt(CANVAS_MAX_PX / area);
  if (el && typeof el === 'object') handed.set(el, s);
  return s;
}
/** The density storeDensity last gave el (undefined: none yet). */
export function storedDensity(el) { return el && typeof el === 'object' ? handed.get(el) : undefined; }
/** (H5) The total budget's caps: a Map canvas → density (null / empty clears them) → whether any cap changed. cv-world sets
 * them at a rest only; a capped canvas takes its cap at its next paint (rescaleCanvases for the static owners). */
export function setStoreCaps(map) {
  const next = new WeakMap(), seen = [];
  let changed = false;
  if (map && typeof map.forEach === 'function') map.forEach((v, cv) => { if (cv && typeof cv === 'object' && v > 0 && isFinite(v)) { next.set(cv, +v); seen.push(cv); if (storeCaps.get(cv) !== +v) changed = true; } });
  for (const cv of capped) if (!next.has(cv)) changed = true;
  capped = seen; storeCaps = next;
  return changed;
}
/** (H5) The cap the budget gave el (undefined: none). */
export function storeCap(el) { return el && typeof el === 'object' ? storeCaps.get(el) : undefined; }
export function fitCanvas(cv, w, hgt) {
  const s = storeDensity(cv, Math.max(1, w), Math.max(1, hgt));
  const Wd = Math.max(1, Math.ceil(w * s - 1e-6)), Hd = Math.max(1, Math.ceil(hgt * s - 1e-6)); // (rounded up: never below s px per layout px)
  if (cv.width !== Wd) cv.width = Wd;
  if (cv.height !== Hd) cv.height = Hd;
  const ctx = cv.getContext ? cv.getContext('2d') : null;
  if (ctx && ctx.setTransform) ctx.setTransform(s, 0, 0, s, 0, 0);
  return ctx;
}

/* ------------------------------------------- the canvas world (SPEC-canvas §4.4–4.7; IMPL-1b §4.3) */
// The track canvas scales one layer (#world, [data-cv-world]) with a CSS transform: getBoundingClientRect() is screen px
// there, offsetWidth / clientWidth layout px. Pointer maths of anything that can sit under it goes through localPoint.
// localScale(el): layout px per screen px of el (1/k in the world, 1 elsewhere; 1 for a zero-size box or a node without
// offsetWidth — SVG: pass the nearest HTML ancestor). localPoint(el, e): the pointer in el's layout px from its border
// box's top-left (subtract clientLeft / clientTop for the padding box) — also right under the browser's pinch-zoom.
export function localScale(el) {
  let r = null;
  try { r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (err) { r = null; }
  const ow = el ? +el.offsetWidth : 0;
  return r && r.width > 0 && ow > 0 ? ow / r.width : 1;
}
export function localPoint(el, e) {
  const r = el.getBoundingClientRect(), ow = +el.offsetWidth, oh = +el.offsetHeight;
  const sx = r.width > 0 && ow > 0 ? ow / r.width : 1, sy = r.height > 0 && oh > 0 ? oh / r.height : sx;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}
// closeTransient(): the open popup list / context menu closes and the kit tooltip hides — the camera calls it when a
// move starts (a transform pan fires no scroll, which is what closes them on a page)
const transients = new Set(); // (stage 1c) closers of popups that live in the top layer at a world element's place
export function closeTransient() {
  if (active) active(false);
  hideTip();
  for (const f of [...transients]) { try { f(); } catch (err) { console.warn(err); } }
}
// menuOpen(): a popup list or context menu of the kit is open (main.js: the canvas Delete key leaves the modules alone then)
export function menuOpen() { return !!active; }
// addTransient(fn) → off: fn closes a popup placed over a world element from the top layer (a Serum popover in #ov):
// closeTransient (the camera's move start) calls it, as it closes the kit's own menus, so nothing is stranded by a pan
export function addTransient(fn) { if (typeof fn !== 'function') return () => {}; transients.add(fn); return () => transients.delete(fn); }
// setWheelVeto(fn | null): while fn() is true no kit control takes the wheel (wheelIn: knobs, numBoxes, menus, sliders,
// wheelGate; zoomPan's wheel) — the canvas camera's 300 ms after a move
export function setWheelVeto(fn) { wheelVeto = typeof fn === 'function' ? fn : null; }
// setEdgeHook({ pan(p | null), onCamera(cb) → off } | null): the canvas camera for dragSource's edge auto-scroll inside
// [data-cv-world] (cv-world: pan = world.dragPointer, onCamera = world.on('camera')); drags with autoScroll: false (module
// bars, the Sources tray) drive dragPointer themselves
let edgeHook = null;
export function setEdgeHook(h) { edgeHook = h && typeof h.pan === 'function' && typeof h.onCamera === 'function' ? h : null; }
// visibleBand(doc): the part of the visual viewport no pinned tray covers, client px { left, top, right, bottom }: less
// [data-wk-inset=top | bottom] bars (as dragSource's edge auto-scroll), [data-wk-inset=left | right] side trays and rails,
// the root's scroll padding and — visualViewport.height — the software keyboard
export function visibleBand(doc) {
  const d = doc || D();
  if (!d) return { left: 0, top: 0, right: 0, bottom: 0 };
  const root = d.scrollingElement || d.documentElement || null;
  const B = asBand(d, asInsets(d), asPad(d, root));
  return { left: B.left, top: B.top, right: B.right, bottom: B.bottom };
}
// edgePan2(band, p, st) → { vx, vy } px/s (+ = toward right / bottom): dragSource's edge law (asEdge: AS_EDGE zones —
// mouse none, so a mouse pans only past the edge —, quadratic, AS_MAX past the edge) on each axis against `band`, ramping
// in over AS_RAMP ms; a direction counts once the pointer has been outside its zone since the drag began or moved
// AS_ARM px that way (a drag that starts in a zone does not pan at once). p = { x, y, pointerType, t? (ms) }; st = an
// object the caller keeps for one drag (start point, arming, ramp start)
export function edgePan2(band, p, st) {
  const kind = p.pointerType === 'touch' || p.pointerType === 'pen' ? p.pointerType : 'mouse';
  const E = AS_EDGE[kind], M = AS_MAX[kind], t = p.t != null && isFinite(p.t) ? +p.t : nowMs();
  if (!st.arm) { st.arm = {}; st.x0 = p.x; st.y0 = p.y; st.t0 = -1; }
  const axis = (v, a, d) => { // arming, as asPlan: a direction this evaluation does not ask for is armed from now on
    const s = a + (v < 0 ? '-' : v > 0 ? '+' : '');
    if (!(v < 0)) st.arm[a + '-'] = true;
    if (!(v > 0)) st.arm[a + '+'] = true;
    return v && !st.arm[s] ? (d * Math.sign(v) >= AS_ARM ? ((st.arm[s] = true), v) : 0) : v;
  };
  let vx = axis(asEdge(p.x, band.left, band.right, E, M), 'x', p.x - st.x0);
  let vy = axis(asEdge(p.y, band.top, band.bottom, E, M), 'y', p.y - st.y0);
  if (!vx && !vy) { st.t0 = -1; return { vx: 0, vy: 0 }; }
  if (st.t0 < 0) st.t0 = t;
  const k = AS_RAMP > 0 ? Math.min(1, Math.max(0, t - st.t0) / AS_RAMP) : 1;
  return { vx: vx * k, vy: vy * k };
}
// the top layer (#ov): pieces that must not scale or clip with the world (the large LFO editor, sheets) render there.
// layer(x) → the top layer when x lies inside [data-cv-world] (and one is set), else x
let topLayer = null;
export function setLayer(el) { topLayer = el || null; }
export function layer(fallback) { return topLayer && fallback && inWorld(fallback) ? topLayer : fallback; }
// setCanvasScale(k): the camera's zoom at its last zoom end; fitCanvas sizes in-world stores for it. canvasScale(el): the
// factor el's canvas stores take on top of the device ratio (k inside the world, else 1; no layout read) for owners that
// size their own canvases
export function setCanvasScale(k) { canvasK = k > 0 && isFinite(k) ? +k : 1; }
export function canvasScale(el) { return canvasK !== 1 && inWorld(el) ? canvasK : 1; }
// static canvas owners (drawn on change, not by a ticker) register a repaint for a zoom end: onRescale(el, fn) → off;
// rescaleCanvases(root?) calls the ones inside root (all without it; detached ones are skipped). Animated canvases pick
// the new scale up on their next tick through fitCanvas
const rescalers = new Map(); // el → Set(fn)
export function onRescale(el, fn) {
  if (!el || typeof fn !== 'function') return () => {};
  let s = rescalers.get(el);
  if (!s) rescalers.set(el, s = new Set());
  s.add(fn);
  return () => { s.delete(fn); if (!s.size && rescalers.get(el) === s) rescalers.delete(el); };
}
export function rescaleCanvases(root) {
  const list = [...rescalers];
  if (list.length > 256) for (const [el] of list) if (el.isConnected === false) rescalers.delete(el); // owners that never called off()
  for (const [el, s] of list) {
    if (el.isConnected === false || (root && root !== el && !(typeof root.contains === 'function' && root.contains(el)))) continue;
    for (const f of [...s]) { try { f(); } catch (err) { console.error(err); } }
  }
}
// releaseCanvases(root): every canvas under root to 0 × 0 (Safari frees the backing store; an unmounted body's); a canvas
// with an onRelease(cv, fn) hook calls it after (stage 1g: a hardware face's bitmap shows its SVG again)
const releasers = new WeakMap(); // canvas → fn
export function onRelease(cv, fn) {
  if (!cv || typeof fn !== 'function') return () => {};
  releasers.set(cv, fn);
  return () => { if (releasers.get(cv) === fn) releasers.delete(cv); };
}
export function releaseCanvases(root) {
  let list = [];
  try { list = root && typeof root.querySelectorAll === 'function' ? Array.from(root.querySelectorAll('canvas')) : []; } catch (err) { list = []; }
  if (root && root.tagName === 'CANVAS') list.push(root);
  for (const c of list) { c.width = 0; c.height = 0; }
  for (const c of list) { const f = releasers.get(c); if (f) { try { f(); } catch (err) { console.error(err); } } }
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
// ticker(el, fn, o): the display loop of an animated canvas (§13.1: ≤ 30 fps, 10 fps with prefers-reduced-motion, hidden
// pages are not painted). fn(t) runs on animation frames at most o.fps (default 30, ≤ 60) times per second; frames
// are skipped while the document is hidden or el is not rendered (display: none, a hidden page), and the loop ends
// by itself once el leaves the document. Returns { start(), stop(), running() → bool }; start() is idempotent.
export function ticker(el, fn, o) {
  const fps = o && o.fps > 0 ? Math.min(60, +o.fps) : 30;
  let cancel = null, last = -1e9, on = false, iv = 1000 / fps;
  // The frame-rate gate comes first (4 ms slack: every 2nd frame at 60 Hz, every 4th at 120 Hz for 30 fps); only a
  // frame that passes it reads prefers-reduced-motion (which may lengthen the interval) and the element's visibility
  // (getClientRects can force a layout). A hidden frame counts as a frame, so a hidden page is probed at the frame rate.
  const tick = t => {
    cancel = null;
    if (!on || !el || !el.isConnected) { on = false; return; }
    if (t - last >= iv - 4) {
      iv = reducedMotion() ? 100 : 1000 / fps;
      if (t - last >= iv - 4) {
        last = t;
        const d = D(), hidden = (d && d.visibilityState === 'hidden') || (typeof el.getClientRects === 'function' && el.getClientRects().length === 0);
        if (!hidden) { try { fn(t); } catch (err) { console.error(err); } }
      }
    }
    if (on) cancel = frame(tick);
  };
  return {
    start() { if (on) return; on = true; cancel = frame(tick); },
    stop() { on = false; if (cancel) cancel(); cancel = null; },
    running: () => on,
  };
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
// items: [{ label, action?, checked?, disabled?, sub?: items, sep?, hint?, title? }] (hint: a short muted note at the item's
// right end — the FX rack's "+" menu: an effect's load estimate; title: its tooltip). Escape closes the innermost level
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
      if (it.hint) e.append(h('span', 'wk-ch', String(it.hint)));
      if (it.title) e.title = String(it.title);
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
// tooltip.textOf(el) → the text of the nearest tooltip registered on el or an ancestor ('' when none or empty): touch
// has no hover, so a panel shows it in its status line while the control is touched (§13.1).
tooltip.textOf = el => {
  for (let n = el; n; n = n.parentNode) {
    const fn = tips.get(n);
    if (!fn) continue;
    try { const t = fn(); return t ? String(t) : ''; } catch (err) { return ''; }
  }
  return '';
};
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
// Injects each classic DSP script once per document (keyed by path, so 'serum-dsp.js?v=9' and 'serum-dsp.js'
// are the same script), in order (async = false). Resolves when every script has loaded, failed or timed out;
// never rejects. A missing, broken or failed script yields null for its global. DSP_GLOBALS = the SPEC-serum2 §0.3
// list (files 1–17, table order = main.js DSP_FILES; the patch family's two, IMPL-9 §3.7, then the master meters, IMPL-M §7) → their globals: a
// script whose global is already defined (a static <script> or an earlier evaluation) is not injected again; the result carries every global of the list (null when missing).
// The app passes main.js DSP_URLS (the full §0.3 list) before any panel asks, so the panels' default calls find every
// script loaded. loadDSP.URLS = files 1–17 in table order (frozen) = the default list (§0.3). The 20 s give-up timer
// does not keep a node process alive (unref where the host has it).
const DSP_GLOBALS = { 'sx-base.js': 'SxBase', 'sx-filt2.js': 'SxFilt2', 'sx-warp.js': 'SxWarp', 'sx-mod.js': 'SxMod',
  'sx-sample.js': 'SxSample', 'sx-gran.js': 'SxGran', 'sx-spec.js': 'SxSpec', 'sx-seq.js': 'SxSeq', 'serum-dsp.js': 'SerumDSP',
  'fx-mods2.js': 'FXMods2', 'fx-dsp.js': 'FXDSP', 'dr-808.js': 'Dr808', 'dr-seq.js': 'DrSeq', 'mod-core.js': 'ModCore',
  'patch-dsp.js': 'PatchDSP', 'moog-dsp.js': 'PatchMoog', 'master-dsp.js': 'MASTERDSP' };
const dspLoads = new WeakMap(); // document → Map(path → Promise)
export function loadDSP(urls = loadDSP.URLS) {
  const d = D();
  const result = () => {
    const r = {};
    for (const f in DSP_GLOBALS) r[DSP_GLOBALS[f]] = globalThis[DSP_GLOBALS[f]] || null;
    return r;
  };
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
loadDSP.URLS = Object.freeze(Object.keys(DSP_GLOBALS));
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
      if (t && typeof t.unref === 'function') t.unref();
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
// Touch rules (§13.1: targets ≥ 44 px, knobs `md` hit size minimum): emitted under `@media (pointer: coarse)` and
// again under `.wk-touch` (set on <html> by the first touch, see touchMode). Small buttons keep their visual size and
// get a transparent ::before that extends their hit box vertically to 44 px (layouts do not grow); the round power /
// FX LED buttons (32 px) get a 44 × 44 hit square (6 px into the gaps beside them); stand-alone targets (editor
// buttons, modifier keys, X/Y dot, step-cell height) grow to 44 px; a range-bar edge takes track presses within 22 px
// (inwards at most a quarter of the range) and the graph editors' points and curve handles 22 px (graph.js R_PT /
// R_HD). Narrower by design (a deviation recorded for the §13.14 QA record): menu ◀ ▶ arrows 28 px wide (the list
// itself is a 44 px target), the knob depth handle (an Alt / modifier-bar Alt drag on the knob does the same), the
// X/Y pad rails (their knob menus open from the 44 px dot), step-grid cells ≥ 18 px wide (paint-drag, typed entry).
const HIT44 = "content: ''; position: absolute; left: 0; right: 0; top: min(0px, calc(50% - 22px)); bottom: min(0px, calc(50% - 22px));";
const TOUCH = [
  ['.wk-sb, .wk-nbv, .wk-mbtn, .wk-arr, .wk-tog, .fxr-more, .fxr-pre, .fxr-xs, .fxr-x', 'min-height: 32px;'],
  ['.wk-sb::before, .wk-nbv::before, .wk-mbtn::before, .wk-arr::before, .wk-tog::before, .wk-rbt::before, .wk-sl.wk-h::before', HIT44],
  ['.wk-arr', 'width: 28px;'],
  ['.wk-tog', 'min-width: 32px;'],
  ['.wk-power', 'width: 32px; height: 32px;'],
  ['.wk-power::before, .fxr-led::before', 'left: min(0px, calc(50% - 22px)); right: min(0px, calc(50% - 22px));'],
  ['.wk-knob', 'min-width: 44px;'],
  ['.wk-dh', 'width: 14px; height: 14px;'],
  ['.wk-opt, .wk-ci', 'min-height: 44px; display: flex; align-items: center;'],
  ['.wk-h .wk-slt', 'height: 14px;'],
  ['.wk-fader .wk-slk', 'height: 20px; margin-bottom: -10px;'],
  ['.wk-xyd', 'width: 22px; height: 22px; margin: -11px 0 0 -11px;'],
  ['.wk-xyd::before', "content: ''; position: absolute; left: -11px; top: -11px; right: -11px; bottom: -11px; border-radius: 50%;"],
  ['.wk-rbt', 'height: 32px;'],
  ['.wk-rbh', 'width: 28px; margin-left: -14px;'],
  ['.wk-rbh::after', 'left: 13px;'],
  ['.wk-sgc', 'height: 44px;'],
  ['.wk-mk', 'min-width: 44px; min-height: 44px;'],
  ['.gx-btn', 'min-height: 44px; min-width: 44px;'],
  ['.fxr-tile', 'min-height: 40px;'],
  ['.fxr-led', 'width: 32px; min-width: 32px; min-height: 32px;'],
  ['.fxr-grip', 'width: 32px; padding: 10px 0;'],
];
function touchCSS() {
  const pre = sel => sel.split(',').map(x => '.wk-touch ' + x.trim()).join(', ');
  return '@media (pointer: coarse) {\n' + TOUCH.map(([sel, b]) => '  ' + sel + ' { ' + b + ' }').join('\n') + '\n}\n'
    + TOUCH.map(([sel, b]) => pre(sel) + ' { ' + b + ' }').join('\n') + '\n';
}
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
.wk-ch { padding-left: 14px; color: var(--sx-mute, #7f8b98); font: 500 10px/1.2 var(--mono, ui-monospace, monospace); }
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
/* window-width rules stay outside the canvas world: a module's width is world px, not the window's */
@media (max-width: 899px) { .fxr-root:where(:not([data-cv-world] *)) .wk-md { --wk-d: 34px; } }
@media (max-width: 700px) {
  .fxr-root:where(:not([data-cv-world] *)) { grid-template-columns: minmax(0, 1fr); }
  .fxr-tiles:where(:not([data-cv-world] *)) { flex-direction: row; overflow-x: auto; padding-bottom: 4px; }
  .fxr-tile:where(:not([data-cv-world] *)) { flex: 0 0 auto; }
  .fxr-tname:where(:not([data-cv-world] *)) { max-width: 120px; }
  .fxr-rack:where(:not([data-cv-world] *)) { max-height: none; }
}
@media (prefers-reduced-motion: reduce) { .fxr-flash { animation: none; } }
@media (prefers-reduced-motion: reduce) { .wk-tip { transition: none; } }
.wk-meter, .wk-xy, .wk-rb, .wk-piano, .wk-sg, .wk-mkeys { box-sizing: border-box; }
.wk-meter { position: relative; display: inline-flex; gap: 1px; flex: 0 0 auto; }
.wk-mv { flex-direction: row; min-height: 64px; } .wk-mh { flex-direction: column; min-width: 64px; }
.wk-mch { position: relative; flex: 1 1 auto; overflow: hidden; border-radius: 2px; background: linear-gradient(to top, var(--sx-on, #6fe3a1) 0, var(--sx-on, #6fe3a1) var(--wk-m6, 82%), #f7c948 var(--wk-m6, 82%), #f7c948 var(--wk-m0, 91%), var(--sx-warn, #ff6a4a) var(--wk-m0, 91%)); }
.wk-mh .wk-mch { background: linear-gradient(to right, var(--sx-on, #6fe3a1) 0, var(--sx-on, #6fe3a1) var(--wk-m6, 82%), #f7c948 var(--wk-m6, 82%), #f7c948 var(--wk-m0, 91%), var(--sx-warn, #ff6a4a) var(--wk-m0, 91%)); }
.wk-mv .wk-mch { width: 5px; } .wk-mh .wk-mch { height: 5px; }
.wk-mcov { position: absolute; background: var(--sx-bg, #0f1216); box-shadow: inset 0 0 0 1px var(--sx-line, #2a333d); }
.wk-mv .wk-mcov { left: 0; right: 0; top: 0; height: 100%; } .wk-mh .wk-mcov { top: 0; bottom: 0; right: 0; width: 100%; }
.wk-mpk { position: absolute; background: var(--sx-ink, #dfe6ee); }
.wk-mv .wk-mpk { left: 0; right: 0; height: 1px; } .wk-mh .wk-mpk { top: 0; bottom: 0; width: 1px; }
.wk-mch.wk-clip { box-shadow: 0 0 0 1px var(--sx-warn, #ff6a4a); }
.wk-fader { gap: 4px; }
.wk-frow { position: relative; display: flex; align-items: stretch; gap: 4px; flex: 1 1 auto; min-height: 96px; }
.wk-fader .wk-slt { width: 8px; min-height: 96px; }
.wk-fader .wk-slk { left: -8px; right: -8px; height: 12px; margin-bottom: -6px; border: 1px solid var(--sx-bg, #0f1216); border-radius: 3px; }
.wk-fsc { position: relative; width: 24px; color: var(--sx-mute, #7f8b98); font: 500 8px/1 var(--mono, ui-monospace, monospace); letter-spacing: 0; text-transform: none; }
.wk-ftk { position: absolute; right: 0; transform: translateY(50%); white-space: nowrap; }
.wk-ftk::after { content: ''; display: inline-block; width: 3px; height: 1px; margin-left: 2px; vertical-align: middle; background: var(--sx-line, #2a333d); }
.wk-xy { position: relative; display: inline-flex; flex-direction: column; align-items: center; gap: 3px; color: var(--sx-ink, #dfe6ee); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.wk-xy > .wk-lab { color: var(--sx-mute, #7f8b98); }
.wk-xyg { display: grid; grid-template-columns: 6px var(--wk-xy, 96px); grid-template-rows: var(--wk-xy, 96px) 6px; gap: 3px; }
.wk-xyp { position: relative; grid-column: 2; grid-row: 1; background-color: var(--sx-bg, #0f1216); background-image: linear-gradient(var(--sx-line, #2a333d) 1px, transparent 1px), linear-gradient(90deg, var(--sx-line, #2a333d) 1px, transparent 1px); background-size: 25% 25%; border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; cursor: crosshair; touch-action: none; }
.wk-xyry { grid-column: 1; grid-row: 1; } .wk-xyrx { grid-column: 2; grid-row: 2; }
.wk-xyr { position: relative; background: var(--sx-panel2, #1c232b); border-radius: 2px; }
.wk-xyr > .wk-modbar { top: 0; bottom: 0; height: auto; } .wk-xyr > .wk-vbar { left: 0; right: 0; width: auto; }
.wk-xyd { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; background: var(--sx-accent, #4fb3ff); border-radius: 50%; box-shadow: 0 0 0 2px var(--sx-bg, #0f1216); outline: none; }
.wk-xyd:focus-visible { box-shadow: 0 0 0 2px var(--sx-bg, #0f1216), 0 0 0 4px var(--sx-accent, #4fb3ff); }
.wk-xy.wk-drag .wk-xyd { background: var(--sx-ink, #dfe6ee); }
.wk-xy.wk-dis, .wk-rb.wk-dis, .wk-piano.wk-dis, .wk-sg.wk-dis { opacity: 0.4; }
.wk-rb { position: relative; display: inline-flex; flex-direction: column; gap: 2px; min-width: 120px; color: var(--sx-ink, #dfe6ee); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.wk-rb > .wk-lab { color: var(--sx-mute, #7f8b98); }
.wk-rbt { position: relative; height: 18px; background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 3px; cursor: pointer; touch-action: none; }
.wk-rbb { position: absolute; top: 0; bottom: 0; background: rgba(79, 179, 255, 0.3); cursor: grab; }
.wk-rbh { position: absolute; top: -3px; bottom: -3px; width: 10px; margin-left: -5px; cursor: ew-resize; outline: none; }
.wk-rbh::after { content: ''; position: absolute; left: 4px; top: 0; bottom: 0; width: 2px; background: var(--sx-accent, #4fb3ff); border-radius: 1px; }
.wk-rbh:focus-visible::after { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.wk-rbv { color: var(--sx-ink, #dfe6ee); font: 500 10px/1.2 var(--mono, ui-monospace, monospace); letter-spacing: 0; text-transform: none; }
.wk-rb .wk-in { bottom: auto; top: 50%; transform: translate(-50%, -50%); }
.wk-piano { position: relative; height: var(--wk-ph, 72px); min-width: 96px; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.wk-pk { position: absolute; top: 0; box-sizing: border-box; border: 1px solid #0b0e12; border-top: 0; border-radius: 0 0 3px 3px; }
.wk-pw { height: 100%; background: #e7ecf2; } .wk-pb { z-index: 1; height: 62%; background: #1b2128; }
.wk-pw.wk-out { background: #b6bfc9; } .wk-pb.wk-out { background: #0b0e12; }
.wk-pk.wk-root { box-shadow: inset 0 -4px 0 var(--wk-pc, var(--sx-accent, #4fb3ff)); }
.wk-pk.wk-lit { background: var(--wk-pc2, var(--sx-arp, #b07cff)); }
.wk-pk.wk-held { background: var(--wk-pc, var(--sx-accent, #4fb3ff)); }
.wk-pl { position: absolute; left: 0; right: 0; bottom: 3px; color: #50606f; font: 600 8px/1 var(--ui, system-ui, sans-serif); text-align: center; pointer-events: none; }
.wk-sg { display: grid; grid-template-columns: auto repeat(var(--wk-sgn, 8), minmax(18px, 1fr)); gap: 2px; align-items: center; color: var(--sx-ink, #dfe6ee); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.wk-sgl { padding-right: 4px; color: var(--sx-mute, #7f8b98); white-space: nowrap; }
.wk-sgc { position: relative; height: 28px; background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 2px; cursor: ns-resize; outline: none; }
.wk-sgc::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--sx-line, #2a333d); }
.wk-sgf { position: absolute; left: 1px; right: 1px; background: var(--sx-graph, #59c2ff); }
.wk-sgc.wk-neg .wk-sgf { background: var(--sx-neg, #ffb347); }
.wk-sgc.wk-off { opacity: 0.35; }
.wk-sgc:focus-visible { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.wk-sgc .wk-in { bottom: auto; top: 50%; width: 52px; transform: translate(-50%, -50%); }
.wk-isb { display: inline-flex; align-items: center; justify-content: center; padding: 2px 5px; }
.wk-ico { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.wk-iglyph { font-size: 12px; line-height: 1; }
.wk-mkeys { display: inline-flex; gap: 3px; }
.wk-mk.wk-lock { box-shadow: 0 0 0 2px var(--sx-on, #6fe3a1); }
.wk-armed { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.wk-armed, .wk-dragging { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.wk-menu, .wk-seg, .wk-tog, .wk-mkeys, .wk-pop, .wk-ctx, .wk-rb, .wk-xy, .gx-bar, .gx-btn, .gx-overlay, .gx-pz { touch-action: manipulation; }
.wk-sb, .wk-mbtn, .wk-arr, .gx-btn { position: relative; }
.wk-dragging { opacity: 0.6; }
.gx-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px 10px; padding: 6px 0 0; }
.gx-btn { min-height: 24px; margin: 0; padding: 2px 8px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 600 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; cursor: pointer; }
.gx-btn:hover { color: var(--sx-ink, #dfe6ee); border-color: var(--sx-mute, #7f8b98); }
.gx-btn:focus-visible { outline: 2px solid var(--sx-accent, #4fb3ff); outline-offset: 1px; }
.gx-pz { display: grid; grid-template-columns: auto auto auto; grid-template-areas: "tl xy tr" "bl xy br"; gap: 6px 10px; align-items: center; justify-items: center; color: var(--sx-ink, #dfe6ee); }
.gx-pz-tl { grid-area: tl; } .gx-pz-tr { grid-area: tr; } .gx-pz-bl { grid-area: bl; } .gx-pz-br { grid-area: br; } .gx-pzxy { grid-area: xy; }
.gx-pzc { position: relative; display: flex; gap: 2px; padding: 12px 4px 4px; border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; }
.gx-pzc .wk-v .wk-slt { min-height: 44px; flex-basis: 44px; }
.gx-pzl { position: absolute; left: 4px; top: 2px; color: var(--sx-mute, #7f8b98); font: 700 8px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.08em; }
.gx-overlay { position: fixed; z-index: 900; left: 4vw; right: 4vw; top: 6vh; display: flex; flex-direction: column; gap: 8px; max-height: 88vh; padding: 10px; overflow: auto; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6); outline: none; overscroll-behavior: contain; }
.gx-ovh { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 14px; }
.gx-ovt { flex: 1 1 auto; font: 700 11px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.12em; text-transform: uppercase; }
.gx-ovb { flex: 1 1 auto; min-height: 0; }
@media (max-width: 1099px) { .gx-overlay { left: 0; right: 0; top: 0; bottom: 0; max-height: none; border-radius: 0; } }
` + touchCSS();
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
  if (!styled.has(doc)) { // input-modality tracking (keyboard vs pointer, touch seen), once per document
    styled.add(doc);
    doc.addEventListener('keydown', () => { lastInput = 'key'; }, true);
    doc.addEventListener('pointerdown', e => { lastInput = 'pointer'; if (e.pointerType === 'touch' && !touchSeen) markTouch(doc); }, true);
    if (touchSeen) markTouch(doc);
    // A modifier latch applies to the next gesture only (§13.1): a click anywhere outside the modifier bars releases
    // the latched (not locked) keys once its own listeners have read them (taps on plain buttons, menu items, …;
    // drag gestures release them when they end).
    doc.addEventListener('click', e => { if (!inBar(e.target)) queueMicrotask(consumeLatches); });
  }
  return s;
}
function ensureCSS(d) { if (d && (!styled.has(d) || !d.getElementById('wk-css'))) injectStyles(d); }
