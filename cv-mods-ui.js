// cv-mods-ui.js — the bodies of the stage-2a modulator modules (contract: docs/canvas/IMPL-2a.md §3; SPEC-canvas §2.10,
// §7.10): the project Mod Wheel (a vertical wheel in the look of the perf tray's #modw: a drag or the keys set it; the
// "+N on other tracks" chip by its jack), Velocity (the last velocity on the default curve), Aftertouch and Bend (meters;
// Bend bipolar). Each returns {el, update(v), destroy()} (the wheel also setOthers(n)); the host mounts el into the
// module's body (cv-module host.bodies.mount) and pushes live values through update — nothing here polls. Values: the
// wheel, velocity and aftertouch 0…1, bend −1…1 (main.js ctl's). Owner: WIDGETS lane (2a B).
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9.
// iPad: the wheel (.cv-mw) is touch-action: none (style.css) and ends its drag on a pointercancel (a second finger:
// gesture.js) or a lost capture; listeners are passive where they never prevent.

/** The wheel's thumb height (px, as #modw's .thumb). */
export const THUMB = 26;
/** The wheel's keyboard steps (of 127): arrows, Page Up / Down. */
export const STEP = 1, PAGE = 16;

const SVG = 'http://www.w3.org/2000/svg';
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const docOf = o => (o && o.doc) || globalThis.document;
const mk = (d, tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const svgEl = (d, tag, attrs) => { const e = d.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
const read = (o, def) => { let v = def; try { v = typeof o.get === 'function' ? +o.get() : def; } catch (err) { v = def; } return fin(v) ? v : def; };
const set1 = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const text1 = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v) * 100) + '%';

/**
 * The Mod Wheel's body: a vertical wheel (div.cv-mw-slot > div.cv-mw-thumb in a role=slider, 0…127), its value, and the
 * "+N on other tracks" chip (button.cv-mothers, hidden at 0) — a tap: o.onJump() (the host lists them and jumps).
 * A press on the slot moves the thumb under the pointer and o.set(v) follows the drag (each move); arrows ±1/127, Page
 * Up / Down ±16/127, Home 0, End 1. update(v) from the host (a MIDI wheel, the other on-screen wheel, the selected track's
 * lane in playback) redraws without calling set — ignored while a drag runs.
 * @param {{get?: () => number, set?: (v: number) => void, onJump?: () => void, doc?: Document, label?: string}} o
 * @returns {{el: HTMLElement, update: (v: number) => void, setOthers: (n: number) => void, value: () => number, destroy: () => void}}
 */
export function wheelBody(o) {
  const O = o || {}, d = docOf(O);
  const el = mk(d, 'div', 'cv-mbody cv-mwheel');
  const w = mk(d, 'div', 'cv-mw'), slot = mk(d, 'div', 'cv-mw-slot'), th = mk(d, 'div', 'cv-mw-thumb');
  slot.append(th);
  w.append(slot);
  w.setAttribute('role', 'slider'); w.tabIndex = 0;
  w.setAttribute('aria-label', O.label || 'Mod Wheel'); w.setAttribute('aria-orientation', 'vertical');
  w.setAttribute('aria-valuemin', '0'); w.setAttribute('aria-valuemax', '127');
  const rd = mk(d, 'div', 'cv-mread'), val = mk(d, 'span', 'cv-mval'), lab = mk(d, 'span', 'cv-mlab', 'Mod');
  rd.append(val, lab);
  const oth = mk(d, 'button', 'cv-mothers');
  oth.type = 'button'; oth.hidden = true;
  el.append(w, rd, oth);
  let v = clamp(read(O, 0), 0, 1), drag = null, others = 0, dead = false;
  function draw() {
    const t = `calc(${(1 - v).toFixed(4)} * (100% - ${THUMB}px))`;
    if (th.style.top !== t) th.style.top = t;
    const n = String(Math.round(v * 127));
    set1(w, 'aria-valuenow', n);
    text1(val, n);
  }
  const put = nv => { nv = clamp(nv, 0, 1); if (!fin(nv)) return; v = nv; draw(); if (typeof O.set === 'function') O.set(v); };
  function at(e) { // the pointer's value: the thumb's centre under it (the slot's screen rect: any zoom)
    const r = slot.getBoundingClientRect(), lh = +slot.offsetHeight || 0, s = lh > 0 && r.height > 0 ? r.height / lh : 1, t = THUMB * s;
    return r.height > t ? 1 - (e.clientY - r.top - t / 2) / (r.height - t) : v;
  }
  function end() {
    if (!drag) return;
    const D = drag;
    drag = null;
    for (const f of D.offs) f();
    try { w.releasePointerCapture(D.id); } catch (err) { /* released */ }
    w.classList.remove('cv-on');
  }
  const offs = [
    listen(w, 'pointerdown', e => { // (the slider's whole box takes the press: wider than the slot at small zooms)
      if (drag || e.button !== 0 || e.ctrlKey) return; // (right / Ctrl-click: a menu could swallow the release)
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation(); // (a control: never the world's press)
      try { w.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      drag = { id: e.pointerId, type: e.pointerType || 'mouse', offs: [] };
      const mv = ev => { if (!drag || ev.pointerId !== drag.id) return; if (drag.type === 'mouse' && ev.buttons === 0) { end(); return; } put(at(ev)); };
      const fin2 = ev => { if (drag && ev.pointerId === drag.id) end(); };
      drag.offs.push(listen(w, 'pointermove', mv, { passive: true }), listen(w, 'pointerup', fin2), listen(w, 'pointercancel', fin2), listen(w, 'lostpointercapture', fin2));
      w.classList.add('cv-on');
      put(at(e));
      try { w.focus({ preventScroll: true }); } catch (err) { /* no focus */ }
    }),
    listen(w, 'contextmenu', e => { if (e.preventDefault) e.preventDefault(); }),
    listen(w, 'keydown', e => {
      const k = e.key, s = (k === 'ArrowUp' || k === 'ArrowRight') ? STEP : (k === 'ArrowDown' || k === 'ArrowLeft') ? -STEP : k === 'PageUp' ? PAGE : k === 'PageDown' ? -PAGE : 0;
      if (s) put(Math.round(v * 127 + s) / 127);
      else if (k === 'Home') put(0);
      else if (k === 'End') put(1);
      else return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation(); // (never a canvas nudge)
    }),
    listen(oth, 'pointerdown', e => { if (e.stopPropagation) e.stopPropagation(); }),
    listen(oth, 'click', e => { if (e.stopPropagation) e.stopPropagation(); if (typeof O.onJump === 'function') O.onJump(); }),
  ];
  draw();
  return {
    el,
    update(nv) { if (drag || !fin(nv)) return; const c = clamp(nv, 0, 1); if (c !== v) { v = c; draw(); } },
    setOthers(n) {
      others = fin(n) && n > 0 ? Math.round(n) : 0;
      oth.hidden = !others;
      const t = others ? '+' + others + ' on other track' + (others === 1 ? '' : 's') : '';
      text1(oth, t);
      oth.title = others ? t + ' — tap to list them' : '';
      if (others) oth.setAttribute('aria-label', t + ': list them'); else oth.removeAttribute('aria-label');
    },
    others: () => others,
    value: () => v,
    dragging: () => !!drag,
    destroy() { if (dead) return; dead = true; end(); for (const f of offs) f(); el.remove(); },
  };
}

// a curve [[x, y], …] (0…1, x ascending) at x; the default (no points): the diagonal (Serum's DIAG, the velocity default)
function curveAt(pts, x) {
  if (!Array.isArray(pts) || pts.length < 2) return x;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x <= x1) return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1;
  }
  return pts[pts.length - 1][1];
}
const okPts = p => Array.isArray(p) && p.length >= 2 && p.every(q => Array.isArray(q) && fin(q[0]) && fin(q[1]));
/**
 * Velocity's body: the curve (svg.cv-mcurve: the default diagonal, or o.curve [[x, y], …] 0…1) with the last velocity
 * marked on it (a dot and a drop line), a level bar and its value (1…127). update(v): v 0…1 (velocity / 127).
 * @param {{get?: () => number, curve?: Array<[number, number]>, doc?: Document}} o
 * @returns {{el: HTMLElement, update: (v: number) => void, value: () => number, destroy: () => void}}
 */
export function veloBody(o) {
  const O = o || {}, d = docOf(O), pts = okPts(O.curve) ? O.curve.map(q => [clamp(q[0], 0, 1), clamp(q[1], 0, 1)]) : null;
  const el = mk(d, 'div', 'cv-mbody cv-mvelo');
  el.setAttribute('role', 'meter'); el.setAttribute('aria-label', 'Last velocity');
  el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '127');
  const sv = svgEl(d, 'svg', { class: 'cv-mcurve', viewBox: '0 0 100 100', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const P = pts || [[0, 0], [1, 1]];
  const path = svgEl(d, 'path', { class: 'cv-mcrv', d: P.map((q, i) => (i ? 'L ' : 'M ') + Math.round(q[0] * 1000) / 10 + ' ' + Math.round((1 - q[1]) * 1000) / 10).join(' ') });
  const drop = svgEl(d, 'path', { class: 'cv-mdrop', d: 'M 0 100 V 100' }), dot = svgEl(d, 'circle', { class: 'cv-mdot', cx: '0', cy: '100', r: '4' });
  sv.append(svgEl(d, 'rect', { class: 'cv-mframe', x: '0', y: '0', width: '100', height: '100' }), path, drop, dot);
  const bar = mk(d, 'div', 'cv-mbar cv-mvbar'), fill = mk(d, 'div', 'cv-mfill');
  bar.append(fill);
  const rd = mk(d, 'div', 'cv-mread'), val = mk(d, 'span', 'cv-mval'), lab = mk(d, 'span', 'cv-mlab', 'Vel');
  rd.append(val, lab);
  el.append(sv, bar, rd);
  let v = -1;
  function update(nv) {
    if (!fin(nv)) return;
    const c = clamp(nv, 0, 1);
    if (c === v) return;
    v = c;
    const x = Math.round(v * 1000) / 10, y = Math.round((1 - curveAt(pts, v)) * 1000) / 10, n = String(Math.round(v * 127));
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y));
    drop.setAttribute('d', 'M ' + x + ' 100 V ' + y);
    fill.style.height = x + '%';
    text1(val, n);
    set1(el, 'aria-valuenow', n);
  }
  update(clamp(read(O, 0), 0, 1));
  return { el, update, value: () => v, destroy() { el.remove(); } };
}

// a level meter body (Aftertouch: 0…1 from the left; Bend: −1…1 from the centre)
function levelBody(o, cls, label, short, bi) {
  const O = o || {}, d = docOf(O);
  const el = mk(d, 'div', 'cv-mbody ' + cls);
  el.setAttribute('role', 'meter'); el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', bi ? '-100' : '0'); el.setAttribute('aria-valuemax', bi ? '100' : '127');
  const bar = mk(d, 'div', 'cv-mbar' + (bi ? ' cv-mbi' : '')), fill = mk(d, 'div', 'cv-mfill');
  bar.append(fill);
  if (bi) bar.append(mk(d, 'div', 'cv-mmid'));
  const rd = mk(d, 'div', 'cv-mread'), val = mk(d, 'span', 'cv-mval'), lab = mk(d, 'span', 'cv-mlab', short);
  rd.append(val, lab);
  el.append(bar, rd);
  let v = NaN;
  function update(nv) {
    if (!fin(nv)) return;
    const c = bi ? clamp(nv, -1, 1) : clamp(nv, 0, 1);
    if (c === v) return;
    v = c;
    if (bi) { const a = Math.round(Math.abs(c) * 500) / 10; fill.style.left = (c < 0 ? 50 - a : 50) + '%'; fill.style.width = a + '%'; }
    else fill.style.width = Math.round(c * 1000) / 10 + '%';
    const t = bi ? (c ? pct(c) : '0') : String(Math.round(c * 127));
    text1(val, t);
    set1(el, 'aria-valuenow', bi ? String(Math.round(c * 100)) : t);
  }
  update(bi ? clamp(read(O, 0), -1, 1) : clamp(read(O, 0), 0, 1));
  return { el, update, value: () => v, destroy() { el.remove(); } };
}
/** Aftertouch's body: a level bar (0…1, from the left) and its value (0…127). @param {{get?: () => number, doc?: Document}} o */
export function atBody(o) { return levelBody(o, 'cv-mat', 'Aftertouch', 'AT', false); }
/** Bend's body: a bipolar bar (−1…1, from the centre) and its value (−100 %…+100 %). @param {{get?: () => number, doc?: Document}} o */
export function bendBody(o) { return levelBody(o, 'cv-mbend', 'Pitch bend', 'Bend', true); }
/** The body for a mod kind ('wheel' | 'velo' | 'at' | 'bend'; null for anything else). */
export function bodyFor(kind, o) { return kind === 'wheel' ? wheelBody(o) : kind === 'velo' ? veloBody(o) : kind === 'at' ? atBody(o) : kind === 'bend' ? bendBody(o) : null; }
