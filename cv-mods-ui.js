// cv-mods-ui.js — the bodies of the modulator modules (contract: docs/canvas/IMPL-2a.md §3, IMPL-2b §6.1; SPEC-canvas
// §2.10, §7.10): the project Mod Wheel (a vertical wheel in the look of the perf tray's #modw: a drag or the keys set it;
// the "+N on other tracks" chip by its jack), Velocity (the last velocity on the default curve), Aftertouch and Bend
// (meters; Bend bipolar); (2b) LFO, ENV, Macro, CC, Chaos and Note. Each returns {el, update(v), destroy()} (the wheel also
// setOthers(n); the 2b bodies sync() too); the host mounts el into the module's body (cv-module host.bodies.mount) and
// pushes live values through update — nothing here polls. Values: the wheel, velocity and aftertouch 0…1, bend −1…1
// (main.js ctl's). Owner: WIDGETS lane (2a B, 2b C).
// (2b) The editing bodies take o = { doc?, get: () => the device's state (track.dev[id], plain data), edit(fields): the
// host writes the fields given (device-level keys; a nested lfo / env / chaos object is given whole, the host replaces it)
// as ONE History step (the 2a modPre / modStep glue) — called once per gesture at its end (a wk 'end' / 'set' phase, an
// input's change), never per move; set?(k, v): a macro knob's live value per move (the host posts {t:'mval'}: no History,
// no patch); learn?(on): the CC body's Learn button arms / disarms MIDI learn; bpm?: () => the project tempo (ladder
// labels in BPM mode) }. A body reads the state through o.get() on every redraw: after an undo / redo / external edit the
// host calls sync(). State shapes (IMPL-2b §1.1, mirroring Serum's: the object serum-core normalises plus the p values):
//   lfo    { kind: 'lfo', lfo: <normLfo shape: mode, mono, bpm, dot, trip, pts, …>, rate: n }  rate = Serum's l<k>.rate n
//          (pow4 0…100 Hz; BPM-synced: the ladder index over its length − 1, as Serum's p holds it)
//   env    { kind: 'env', env: <serum-core env: bpm, legInv, stealRe>, att, hold, dec, sus, rel: n (Serum's e<k>.* laws:
//          pow5 0…32 s, sus lin), crv: [a, d, r] (0…1, 0.5 linear: Serum's e<k>.ca / cd / cr, the attack / decay / release curvature bent by 10 · (2c − 1)) }
//   macro  { kind: 'macro', v: [8 × 0…1], names: [8 × ≤ 16 chars] }
//   cc     { kind: 'cc', cc: 0…127, ch: 0 (omni) | 1…16, v: 0…1 }
//   chaos  { kind: 'chaos', chaos: <serum-core chaos: mono, sh>, rate: n (Serum's c<k>.rate: pow5 0…1000 Hz; BPM-synced:
//          the LFO_LADDER index over 14), bpm: 0 | 1, smooth: 0…1 }
//   note   { kind: 'note' }
// Live values (update): lfo / env / chaos / cc a value 0…1 (the lfo also {v, ph} — ph 0…1 puts a dot on the shape);
// macro an array of 8 (the knobs' live dots); note the last MIDI note (0…127, null = none).
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9.
// iPad: the wheel (.cv-mw) is touch-action: none (style.css) and ends its drag on a pointercancel (a second finger:
// gesture.js) or a lost capture; listeners are passive where they never prevent.
import * as wk from './wk.js?v=9';
import { evalPts, lawValue, fmtHz, fmtTime, bend, fmtCore, parseCore } from './laws.js?v=9';
import { lfoLadder, LFO_LADDER, LFO_MODES2 } from './serum-core.js?v=9';
import { pts as GPTS } from './graph.js?v=9';

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
 * "+N on other tracks" chip (button.cv-mothers, hidden at 0) — a tap: o.onJump(chip) (the host lists them at it).
 * A press on the slot moves the thumb under the pointer and o.set(v) follows the drag (each move; a two-finger cancel puts
 * the value from before the press back); arrows ±1/127, Page
 * Up / Down ±16/127, Home 0, End 1. update(v) from the host (a MIDI wheel, the other on-screen wheel, the selected track's
 * lane in playback) redraws without calling set — ignored while a drag runs.
 * @param {{get?: () => number, set?: (v: number) => void, onJump?: (chip: HTMLElement) => void, doc?: Document, label?: string}} o
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
      drag = { id: e.pointerId, type: e.pointerType || 'mouse', offs: [], v0: v };
      const mv = ev => { if (!drag || ev.pointerId !== drag.id) return; if (drag.type === 'mouse' && ev.buttons === 0) { end(); return; } put(at(ev)); };
      // (U3) two fingers win: their cancel (gesture.js, flagged) takes the press's jump and the drag back
      const fin2 = ev => { if (!drag || ev.pointerId !== drag.id) return; const v0 = drag.v0, back = ev.type === 'pointercancel' && ev.gesture === 'two-finger'; end(); if (back && v0 !== v) put(v0); };
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
    listen(oth, 'click', e => { if (e.stopPropagation) e.stopPropagation(); if (typeof O.onJump === 'function') O.onJump(oth); }), // (U14: the list at the chip)
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

/* ================================================================ (2b) the editing bodies */
/** (2b) Serum's LFO shape presets (graph.js pts.SHAPES: name, pts) — the shape menu; 'Custom' when the points match none. */
export const LFO_SHAPES = GPTS.SHAPES;
/** (2b) A macro module's rows and the LFO point editor's box (CSS px; cv-module MACRO_ROW agrees). */
export const MACRO_ROW = 28, ED_W = 190, ED_H = 72;
const NAME_MAX = 16;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
const stateOf = o => { const v = call(o.get); return isObj(v) ? v : {}; };
const n01 = (v, d) => (fin(v) ? clamp(v, 0, 1) : d);
const r4 = v => Math.round(v * 1e4) / 1e4;
const r1x = v => Math.round(v * 10) / 10;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const okLfoPts = p => Array.isArray(p) && p.length >= 2 && p.every(q => Array.isArray(q) && fin(q[0]) && fin(q[1]));
const stop = e => { if (e.stopPropagation) e.stopPropagation(); };
const row = (d, cls) => mk(d, 'div', 'cv-mrow' + (cls ? ' ' + cls : ''));
const lab = (d, t) => mk(d, 'span', 'cv-mtag', t);
// the editing bodies' common frame: pending values override the state until the gesture ends (one o.edit per gesture)
function editor(o) {
  const O = o || {}, d = docOf(O), pend = new Map();
  const st = () => stateOf(O);
  const val = (k, def) => (pend.has(k) ? pend.get(k) : st()[k] === undefined ? def : st()[k]);
  const live = (k, v) => pend.set(k, v); // a move: shown, not written
  const E = { after: null }; // after: the body's sync (its widgets follow its own edit at once, before the host's sync)
  const commit = fields => { for (const k of Object.keys(fields)) pend.delete(k); call(O.edit, fields); call(E.after); };
  const widgets = [];
  const keep = w => { widgets.push(w); return w; };
  const syncAll = () => { for (const w of widgets) if (w && typeof w.update === 'function') w.update(); };
  return Object.assign(E, { O, d, st, val, live, commit, keep, widgets, syncAll, pend,
    destroyAll(el) { for (const w of widgets) if (w && typeof w.destroy === 'function') try { w.destroy(); } catch (err) { /* gone */ } widgets.length = 0; el.remove(); } });
}
// a numBox / slider that lives in n and writes field k at the gesture's end (a 'set' phase: at once)
function nField(E, k, def, opts) {
  const W = wk[opts.widget || 'numBox'](Object.assign({
    get: () => n01(E.val(k, def), def),
    set: (n, ph) => { if (ph === 'end' || ph === 'set') E.commit({ [k]: r4(n01(n, def)) }); else E.live(k, n01(n, def)); },
    def,
  }, opts.o || {}));
  return E.keep(W);
}
const LFO_MODES = LFO_MODES2.map(m => m.id), LFO_MODE_LABELS = ['RETRIG', 'ENV', 'FREE'];
const lfoHz = n => lawValue('pow4', 0, 100, n);
const ladLabel = (L, n) => L[Math.round(n01(n, 0) * (L.length - 1))].label;
/**
 * (2b) The LFO body: the GLOBAL / PER NOTE badge (button.cv-mbadge2: lfo.mono), the mode (RETRIG / ENV / FREE: lfo.mode),
 * the rate (a numBox in Hz, or a ladder label with BPM on — Serum's lfoLadder(dot, trip); the '·' and 'T' toggles), the
 * shape (a menu of LFO_SHAPES, 'Custom' otherwise) and a compact point editor (svg.cv-mshape: a tap adds a point, a drag
 * moves one — the ends stay at x 0 / 1 —, a double-tap removes one (never an end), a vertical drag on a segment curves
 * it). The large editor stays milestone 3's. update(v | {v, ph}): the live value bar (and a dot on the shape at ph).
 * @param {{get: () => object, edit: (fields: object) => void, bpm?: () => number, doc?: Document}} o
 * @returns {{el: HTMLElement, update: (v: number | {v: number, ph?: number}) => void, sync: () => void, pts: () => Array, destroy: () => void}}
 */
export function lfoBody(o) {
  const E = editor(o), d = E.d, el = mk(d, 'div', 'cv-mbody cv-mlfo cv-medit');
  const L = () => (isObj(E.val('lfo', null)) ? E.val('lfo') : {});
  const editLfo = patch => E.commit({ lfo: Object.assign({}, L(), patch) });
  const ladder = () => lfoLadder(!!L().dot, !!L().trip);
  // row 1: the badge and the mode
  const r1 = row(d, 'cv-mhead');
  const badge = mk(d, 'button', 'cv-mbadge2'); badge.type = 'button';
  const drawBadge = () => { const g = !!L().mono; text1(badge, g ? 'GLOBAL' : 'PER NOTE'); set1(badge, 'aria-pressed', g ? 'true' : 'false'); badge.title = g ? 'One wave for everything (a processor LFO) — tap for PER NOTE' : 'Restarts per note — tap for GLOBAL'; };
  badge.addEventListener('click', () => editLfo({ mono: L().mono ? 0 : 1 }));
  badge.addEventListener('pointerdown', stop);
  const mode = E.keep(wk.seg({ label: 'Mode', items: LFO_MODE_LABELS, get: () => Math.max(0, LFO_MODES.indexOf(L().mode)), set: i => editLfo({ mode: LFO_MODES[i] || 'retrig' }) }));
  r1.append(badge, mode.el);
  // row 2: the rate, BPM, dotted, triplet
  const r2 = row(d, 'cv-mrate');
  const rate = nField(E, 'rate', 0.5, { o: { label: 'Rate', fmt: n => (L().bpm ? ladLabel(ladder(), n) : fmtHz(lfoHz(n) * (L().x10 ? 10 : 1))), steps: () => (L().bpm ? ladder().length - 1 : 0) } });
  const bpm = E.keep(wk.toggle({ kind: 'btn', label: 'BPM', get: () => (L().bpm ? 1 : 0), set: v => editLfo({ bpm: v ? 1 : 0 }) }));
  const dot = E.keep(wk.toggle({ kind: 'btn', label: 'Dotted', text: '·', get: () => (L().dot ? 1 : 0), set: v => editLfo({ dot: v ? 1 : 0 }) }));
  const trip = E.keep(wk.toggle({ kind: 'btn', label: 'Triplet', text: 'T', get: () => (L().trip ? 1 : 0), set: v => editLfo({ trip: v ? 1 : 0 }) }));
  r2.append(rate.el, bpm.el, dot.el, trip.el);
  let P = null; // the points while a gesture runs (null: the state's)
  const pts = () => P || (okLfoPts(L().pts) ? L().pts : LFO_SHAPES[0].pts);
  // row 3: the shape menu
  const r3 = row(d, 'cv-mshp');
  const items = () => LFO_SHAPES.map((S, i) => ({ v: i, label: S.name })).concat([{ v: -1, label: 'Custom' }]);
  const shapeIdx = () => { const P0 = pts(); for (let i = 0; i < LFO_SHAPES.length; i++) if (same(LFO_SHAPES[i].pts, P0)) return i; return -1; };
  const shape = E.keep(wk.menu({ label: 'Shape', arrows: false, items, get: shapeIdx, set: i => { if (i >= 0) editLfo({ pts: LFO_SHAPES[i].pts.map(q => q.slice()) }); } }));
  r3.append(shape.el);
  // the point editor
  const sv = svgEl(d, 'svg', { class: 'cv-mshape', viewBox: `0 0 ${ED_W} ${ED_H}`, 'aria-label': 'LFO shape: tap to add a point, drag to move, double-tap to remove', role: 'img' });
  const frame = svgEl(d, 'rect', { class: 'cv-mframe', x: '0', y: '0', width: String(ED_W), height: String(ED_H) });
  const mid = svgEl(d, 'path', { class: 'cv-mgrid', d: `M0 ${ED_H / 2}H${ED_W}` });
  const path = svgEl(d, 'path', { class: 'cv-mcrv', d: '' }), g = svgEl(d, 'g', { class: 'cv-mpts' });
  const dotL = svgEl(d, 'circle', { class: 'cv-mdot', r: '3', display: 'none' });
  sv.append(frame, mid, path, g, dotL);
  const bar = mk(d, 'div', 'cv-mbar cv-mlive'), fill = mk(d, 'div', 'cv-mfill');
  bar.append(fill);
  el.append(r1, r2, r3, sv, bar);
  const X = x => r1x(x * ED_W), Y = y => r1x((1 - y) * ED_H);
  const dots = [];
  function draw() {
    const Q = pts();
    let dd = '';
    for (let i = 0; i <= 96; i++) { const x = i / 96; dd += (i ? 'L' : 'M') + X(x) + ' ' + Y(evalPts(Q, x)); }
    set1(path, 'd', dd);
    for (let i = 0; i < Math.max(Q.length, dots.length); i++) {
      if (i >= Q.length) { dots[i].setAttribute('display', 'none'); continue; }
      if (!dots[i]) { const c = svgEl(d, 'circle', { class: 'cv-mpt', r: '3.5' }); g.append(c); dots[i] = c; }
      const c = dots[i];
      if (c.hasAttribute('display')) c.removeAttribute('display');
      set1(c, 'data-i', String(i));
      set1(c, 'cx', String(X(Q[i][0]))); set1(c, 'cy', String(Y(Q[i][1])));
    }
    drawBadge();
  }
  // the editor's gestures (one pointer): on a point → move it; elsewhere → a tap adds a point, a vertical drag bends the
  // segment under the press; a double-tap on a point removes it
  let G = null, lastTap = null;
  const at = e => { const r = sv.getBoundingClientRect(), w = r.width || ED_W, h = r.height || ED_H; return { x: clamp((e.clientX - r.left) / w, 0, 1), y: clamp(1 - (e.clientY - r.top) / h, 0, 1), px: r.width ? ED_W / r.width : 1 }; };
  const idxOf = t => { for (let n = t; n && n !== sv; n = n.parentNode) { const i = n.getAttribute && n.getAttribute('data-i'); if (i != null && n.classList && n.classList.contains('cv-mpt')) return +i; } return -1; };
  const segOf = x => { const Q = pts(); let j = 0; while (j < Q.length - 2 && Q[j + 1][0] <= x) j++; return j; };
  function end(write) {
    if (!G) return;
    const was = G;
    G = null;
    sv.classList.remove('cv-on');
    try { sv.releasePointerCapture(was.id); } catch (err) { /* released */ }
    const Q = P; P = null;
    if (write && Q) editLfo({ pts: Q }); else draw();
  }
  sv.addEventListener('pointerdown', e => {
    if (G || (e.button != null && e.button !== 0) || e.ctrlKey) return;
    if (e.preventDefault) e.preventDefault();
    stop(e);
    const q = at(e), i = idxOf(e.target), Q = pts().map(p => p.slice());
    G = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, q0: q, moved: false, seg: i < 0 ? segOf(q.x) : -1, c0: 0 };
    if (G.seg >= 0) G.c0 = Q[G.seg][2] || 0;
    P = Q;
    try { sv.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    sv.classList.add('cv-on');
  });
  sv.addEventListener('pointermove', e => {
    if (!G || e.pointerId !== G.id) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { end(G.moved); return; }
    if (!G.moved && Math.hypot(e.clientX - G.x0, e.clientY - G.y0) <= 6) return;
    G.moved = true;
    const q = at(e), Q = P;
    if (G.i >= 0) { // move a point: x between its neighbours, the ends pinned
      const p = Q[G.i], lo = G.i > 0 ? Q[G.i - 1][0] : 0, hi = G.i < Q.length - 1 ? Q[G.i + 1][0] : 1;
      p[0] = G.i === 0 ? 0 : G.i === Q.length - 1 ? 1 : r4(clamp(q.x, lo, hi)); p[1] = r4(q.y);
    } else { // bend the segment: 60 px of vertical travel = the full curvature (towards the drag)
      const p = Q[G.seg], up = Q[G.seg + 1] && Q[G.seg + 1][1] >= p[1] ? 1 : -1;
      p[2] = r4(clamp(G.c0 + up * (G.y0 - e.clientY) * q.px / 60, -1, 1));
    }
    draw();
  }, { passive: true });
  const lift = e => {
    if (!G || e.pointerId !== G.id) return;
    if (e.type === 'pointercancel') { end(false); lastTap = null; return; }
    const was = G;
    if (was.moved) { end(true); lastTap = null; return; }
    if (was.i >= 0) { // a tap on a point: the second within 350 ms removes it (never an end)
      const Q = P;
      if (lastTap && lastTap.i === was.i && e.timeStamp - lastTap.t < 350 && was.i > 0 && was.i < Q.length - 1) { Q.splice(was.i, 1); lastTap = null; end(true); return; }
      lastTap = { i: was.i, t: e.timeStamp };
      end(false);
      return;
    }
    const Q = P, q = was.q0, j = segOf(q.x) + 1; // a tap elsewhere: a point there (after the segment's first point)
    Q.splice(j, 0, [r4(q.x), r4(q.y), 0]);
    lastTap = null;
    end(true);
  };
  sv.addEventListener('pointerup', lift); sv.addEventListener('pointercancel', lift);
  sv.addEventListener('lostpointercapture', e => { if (G && e.pointerId === G.id) end(G.moved); });
  sv.addEventListener('contextmenu', e => { if (e.preventDefault) e.preventDefault(); });
  let v = NaN;
  function update(nv) {
    const x = isObj(nv) ? nv.v : nv, ph = isObj(nv) && fin(nv.ph) ? clamp(nv.ph, 0, 1) : null;
    if (fin(x)) { const c = clamp(x, 0, 1); if (c !== v) { v = c; fill.style.width = Math.round(c * 1000) / 10 + '%'; } }
    if (ph == null) { if (!dotL.hasAttribute('display')) dotL.setAttribute('display', 'none'); return; }
    set1(dotL, 'cx', String(X(ph))); set1(dotL, 'cy', String(Y(evalPts(pts(), ph))));
    if (dotL.hasAttribute('display')) dotL.removeAttribute('display');
  }
  function sync() { if (!G) { E.syncAll(); draw(); } }
  E.after = sync;
  sync();
  return { el, update, sync, pts: () => pts().map(p => p.slice()), value: () => v, destroy() { end(false); E.destroyAll(el); } };
}

const ENV_T = n => lawValue('pow5', 0, 32, n);
const ENV_DEF = { att: 0.11, hold: 0, dec: 0.5, sus: 1, rel: 0.215 };
const ENV_SEGS = [['att', 'A'], ['hold', 'H'], ['dec', 'D'], ['sus', 'S'], ['rel', 'R']];
// the curves are Serum's e<k>.ca / cd / cr: 0…1 with 0.5 = linear, defaults 0.5 / 0.666 / 0.666 (the engine bends the segment by
// laws.bend(q, 10 · (2c − 1))); shown and typed as Serum's ENV panel does (the 'pct' format of the 0…1 value). Stage 2b read them as
// −1…1 (the default showed +50 / +67 / +67 and a typed "0" stored an extreme curve): stored values were always the engine's, so kept
const ENV_CRV_DEF = [0.5, 0.666, 0.666], PCT_CTX = { law: 'lin', lo: 0, hi: 1 };
/**
 * (2b) The ENV body: A / H / D / S / R vertical sliders (n of Serum's e<k>.* laws), a curve numBox per shaped segment
 * (crv: [a, d, r], 0…1, 0.5 linear — Serum's own values and % format) and an AHDSR display (svg.cv-menvd, the segments bent
 * by laws.bend(t, 10 · (2c − 1)), as the engine); update(v): the live level.
 * @param {{get: () => object, edit: (fields: object) => void, doc?: Document}} o
 */
export function envBody(o) {
  const E = editor(o), d = E.d, el = mk(d, 'div', 'cv-mbody cv-menv cv-medit');
  const W = 190, H = 56;
  const sv = svgEl(d, 'svg', { class: 'cv-menvd', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  const frame = svgEl(d, 'rect', { class: 'cv-mframe', x: '0', y: '0', width: String(W), height: String(H) });
  const path = svgEl(d, 'path', { class: 'cv-mcrv', d: '' }), lvl = svgEl(d, 'path', { class: 'cv-mdrop', d: '' });
  sv.append(frame, path, lvl);
  const crvOf = () => { const c = E.val('crv', null); return [0, 1, 2].map(i => n01(Array.isArray(c) ? c[i] : null, ENV_CRV_DEF[i])); };
  const r1 = row(d, 'cv-mslds'), sl = {};
  for (const [k, t] of ENV_SEGS) {
    sl[k] = nField(E, k, ENV_DEF[k], { widget: 'slider', o: { label: t, orient: 'v', fmt: n => (k === 'sus' ? Math.round(n * 100) + '%' : fmtTime(ENV_T(n))) } });
    const box = mk(d, 'div', 'cv-msld'); box.append(sl[k].el, lab(d, t));
    r1.append(box);
  }
  const r2 = row(d, 'cv-mcrvs'), cv = [];
  [['A', 0], ['D', 1], ['R', 2]].forEach(([t, i]) => {
    // (1000 steps: 0.666 is on the grid, so a reset is exactly Serum's default; a drag still moves 1 % per 8 px)
    cv[i] = E.keep(wk.numBox({ label: t + ' curve', get: () => crvOf()[i], def: ENV_CRV_DEF[i], steps: 1000, fmt: n => fmtCore('pct', n, n, PCT_CTX), parse: x => parseCore('pct', x, PCT_CTX),
      set: (n, ph) => { const c = crvOf(); c[i] = r4(n01(n, ENV_CRV_DEF[i])); if (ph === 'end' || ph === 'set') E.commit({ crv: c }); else E.live('crv', c); } }));
    const box = mk(d, 'div', 'cv-mcrv1'); box.append(cv[i].el, lab(d, t + '∿'));
    r2.append(box);
  });
  el.append(sv, r1, r2);
  let v = NaN;
  function draw() {
    const T = {}; for (const [k] of ENV_SEGS) T[k] = n01(E.val(k, ENV_DEF[k]), ENV_DEF[k]);
    const a = ENV_T(T.att), h = ENV_T(T.hold), dc = ENV_T(T.dec), r = ENV_T(T.rel), s = T.sus, c = crvOf();
    const tot = Math.max(0.02, a + h + dc + r), sw = 0.18 * tot; // a sustain stretch of 18 % of the time span
    const sx = W / (tot + sw), y = lv => r1x(H - 2 - lv * (H - 4));
    let x = 0, dd = 'M0 ' + y(0);
    const seg = (len, y0, y1, k) => { for (let i = 1; i <= 12; i++) { const t = i / 12; dd += 'L' + r1x((x + len * t) * sx) + ' ' + y(y0 + (y1 - y0) * bend(t, 10 * (2 * k - 1))); } x += len; };
    seg(a, 0, 1, c[0]); seg(h, 1, 1, 0.5); seg(dc, 1, s, c[1]); seg(sw, s, s, 0.5); seg(r, s, 0, c[2]); // (0.5: straight)
    set1(path, 'd', dd);
  }
  function update(nv) { if (!fin(nv)) return; const c = clamp(nv, 0, 1); if (c === v) return; v = c; set1(lvl, 'd', `M0 ${r1x(H - 2 - c * (H - 4))}H${W}`); }
  function sync() { E.syncAll(); draw(); }
  E.after = sync;
  sync();
  return { el, update, sync, value: () => v, destroy() { E.destroyAll(el); } };
}

/**
 * (2b) The Macro body: 8 rows (MACRO_ROW px each: a wk knob, an editable name ≤ 16 chars, the value) — the module's
 * jacks k1…k8 sit at the rows' right (cv-module modJackY). A knob turn calls o.set(k, v) per move (the live value: the
 * host posts {t:'mval'}) and o.edit({v}) once at the gesture's end; a name's change o.edit({names}). update([8 × 0…1]):
 * the knobs' live dots (the host's value table as it sounds; null hides them).
 * @param {{get: () => object, edit: (fields: object) => void, set?: (k: number, v: number) => void, doc?: Document}} o
 */
export function macroBody(o) {
  const E = editor(o), d = E.d, el = mk(d, 'div', 'cv-mbody cv-mmacro cv-medit');
  const V = () => { const a = E.val('v', null); return Array.from({ length: 8 }, (_, k) => n01(Array.isArray(a) ? a[k] : 0, 0)); };
  const N = () => { const a = E.val('names', null); return Array.from({ length: 8 }, (_, k) => String(Array.isArray(a) && a[k] != null && a[k] !== '' ? a[k] : 'Macro ' + (k + 1)).slice(0, NAME_MAX)); }; // ((U8) a blank name reads as the default)
  const NS = () => { const a = E.val('names', null); return Array.from({ length: 8 }, (_, k) => String(Array.isArray(a) && a[k] != null ? a[k] : '').slice(0, NAME_MAX)); }; // (the boxes: '' shows the placeholder)
  const knobs = [], names = [], vals = [];
  for (let k = 0; k < 8; k++) {
    const r = row(d, 'cv-mmrow');
    r.setAttribute('data-k', String(k + 1));
    const K = E.keep(wk.knob({ size: 'sm', label: () => N()[k], fmt: n => Math.round(n * 100) + '%', def: 0,
      get: () => V()[k],
      set: (n, ph) => {
        const a = V();
        a[k] = r4(n01(n, 0));
        call(E.O.set, k, a[k]);
        if (ph === 'end' || ph === 'set') E.commit({ v: a }); else E.live('v', a);
        text1(vals[k], Math.round(a[k] * 100) + '%');
      } }));
    knobs.push(K);
    const nm = mk(d, 'input', 'cv-mname');
    nm.type = 'text'; nm.maxLength = NAME_MAX; nm.setAttribute('maxlength', String(NAME_MAX)); nm.setAttribute('aria-label', 'Macro ' + (k + 1) + ' name');
    nm.placeholder = 'Macro ' + (k + 1); nm.setAttribute('placeholder', 'Macro ' + (k + 1));
    nm.spellcheck = false;
    nm.addEventListener('pointerdown', stop); nm.addEventListener('keydown', stop); // (its own keys and press: never the world's)
    nm.addEventListener('change', () => { const a = N(), t = String(nm.value || '').trim().slice(0, NAME_MAX) || 'Macro ' + (k + 1); nm.value = t; if (t === a[k] && NS()[k] === t) return; a[k] = t; E.commit({ names: a }); });
    nm.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === 'Escape') nm.blur(); });
    names.push(nm);
    const vl = mk(d, 'span', 'cv-mmv', '0%');
    vals.push(vl);
    r.append(K.el, nm, vl);
    el.append(r);
  }
  function sync() {
    const vv = V(), nn = NS();
    for (let k = 0; k < 8; k++) { knobs[k].update(); text1(vals[k], Math.round(vv[k] * 100) + '%'); if (names[k].value !== nn[k] && d.activeElement !== names[k]) names[k].value = nn[k]; }
  }
  function update(live) {
    const Lv = Array.isArray(live) ? live : null;
    for (let k = 0; k < 8; k++) knobs[k].setMod(Lv && fin(Lv[k]) ? { arcs: [], live: clamp(Lv[k], 0, 1) } : null);
  }
  E.after = sync;
  sync();
  return { el, update, sync, knobs: () => knobs.map(K => K.el), destroy() { E.destroyAll(el); } };
}

/**
 * (2b) The CC body: the controller number (a numBox 0…127), the channel (Omni / 1…16), Learn (button.cv-mlearn: o.learn(on)
 * arms the host's MIDI learn; setLearn(on) from the host when it lands or is cancelled) and a value meter (update(v) 0…1).
 * @param {{get: () => object, edit: (fields: object) => void, learn?: (on: boolean) => void, doc?: Document}} o
 */
export function ccBody(o) {
  const E = editor(o), d = E.d, el = mk(d, 'div', 'cv-mbody cv-mcc cv-medit');
  const ccOf = () => { const c = E.val('cc', 1); return fin(c) ? clamp(Math.round(c), 0, 127) : 1; };
  const chOf = () => { const c = E.val('ch', 0); return fin(c) ? clamp(Math.round(c), 0, 16) : 0; };
  const r1 = row(d, 'cv-mccrow');
  const num = E.keep(wk.numBox({ label: 'CC', get: () => ccOf() / 127, def: 1 / 127, steps: 127, fmt: n => 'CC ' + Math.round(n * 127),
    set: (n, ph) => { const c = Math.round(n01(n, 0) * 127); if (ph === 'end' || ph === 'set') E.commit({ cc: c }); else E.live('cc', c); } }));
  const ch = E.keep(wk.menu({ label: 'Channel', arrows: false, items: () => [{ v: 0, label: 'Omni' }].concat(Array.from({ length: 16 }, (_, i) => ({ v: i + 1, label: 'Ch ' + (i + 1) }))),
    get: chOf, set: v => E.commit({ ch: clamp(Math.round(v), 0, 16) }) }));
  r1.append(num.el, ch.el);
  const r2 = row(d, 'cv-mccval');
  const learn = mk(d, 'button', 'cv-mlearn', 'Learn'); learn.type = 'button'; learn.setAttribute('aria-pressed', 'false');
  learn.title = 'Arm MIDI learn: the next controller received becomes this module’s';
  let armed = false;
  const setLearn = on => { armed = !!on; set1(learn, 'aria-pressed', armed ? 'true' : 'false'); learn.classList.toggle('cv-on', armed); text1(learn, armed ? 'Listening…' : 'Learn'); };
  learn.addEventListener('pointerdown', stop);
  learn.addEventListener('click', () => { setLearn(!armed); call(E.O.learn, armed); });
  const bar = mk(d, 'div', 'cv-mbar'), fill = mk(d, 'div', 'cv-mfill');
  bar.append(fill);
  const rd = mk(d, 'div', 'cv-mread'), val = mk(d, 'span', 'cv-mval'), lb = mk(d, 'span', 'cv-mlab', 'Val');
  rd.append(val, lb);
  r2.append(learn, bar, rd);
  el.append(r1, r2);
  el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'MIDI CC');
  let v = NaN;
  function update(nv) { if (!fin(nv)) return; const c = clamp(nv, 0, 1); if (c === v) return; v = c; fill.style.width = Math.round(c * 1000) / 10 + '%'; text1(val, String(Math.round(c * 127))); }
  function sync() { E.syncAll(); const s = E.st(); if (fin(s.v) && !fin(v)) update(s.v); }
  E.after = sync;
  sync();
  if (!fin(v)) update(0);
  return { el, update, sync, setLearn, armed: () => armed, value: () => v, destroy() { E.destroyAll(el); } };
}

const CHAOS_HZ = n => lawValue('pow5', 0, 1000, n);
const SCOPE_N = 64;
/**
 * (2b) The Chaos body: the rate (a numBox in Hz, the LFO_LADDER label with BPM on), smoothing (0…100 %) and a scope of the
 * live value (svg.cv-mscope: the last 64 updates, update(v) 0…1).
 * @param {{get: () => object, edit: (fields: object) => void, doc?: Document}} o
 */
export function chaosBody(o) {
  const E = editor(o), d = E.d, el = mk(d, 'div', 'cv-mbody cv-mchaos cv-medit');
  const r1 = row(d, 'cv-mrate');
  const rate = nField(E, 'rate', 0.2512, { o: { label: 'Rate', fmt: n => (E.val('bpm', 0) ? ladLabel(LFO_LADDER, n) : fmtHz(CHAOS_HZ(n))), steps: () => (E.val('bpm', 0) ? LFO_LADDER.length - 1 : 0) } });
  const bpm = E.keep(wk.toggle({ kind: 'btn', label: 'BPM', get: () => (E.val('bpm', 0) ? 1 : 0), set: v => E.commit({ bpm: v ? 1 : 0 }) }));
  r1.append(rate.el, bpm.el);
  const r2 = row(d, 'cv-msmooth');
  const sm = nField(E, 'smooth', 0, { o: { label: 'Smooth', fmt: n => Math.round(n * 100) + '%' } });
  r2.append(sm.el);
  const W = 190, H = 48;
  const sv = svgEl(d, 'svg', { class: 'cv-mscope', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  const frame = svgEl(d, 'rect', { class: 'cv-mframe', x: '0', y: '0', width: String(W), height: String(H) });
  const mid = svgEl(d, 'path', { class: 'cv-mgrid', d: `M0 ${H / 2}H${W}` }), line = svgEl(d, 'path', { class: 'cv-mcrv cv-mline', d: '' });
  sv.append(frame, mid, line);
  el.append(r1, r2, sv);
  const buf = new Float32Array(SCOPE_N).fill(0.5);
  let head = 0, v = NaN;
  function update(nv) {
    if (!fin(nv)) return;
    v = clamp(nv, 0, 1);
    buf[head] = v; head = (head + 1) % SCOPE_N;
    let dd = '';
    for (let i = 0; i < SCOPE_N; i++) { const q = buf[(head + i) % SCOPE_N]; dd += (i ? 'L' : 'M') + r1x(i * W / (SCOPE_N - 1)) + ' ' + r1x(H - 2 - q * (H - 4)); }
    set1(line, 'd', dd);
  }
  function sync() { E.syncAll(); }
  E.after = sync;
  sync();
  return { el, update, sync, value: () => v, destroy() { E.destroyAll(el); } };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
/**
 * (2b) The Note body: a keyboard meter of the last note (svg.cv-mkeys: 128 keys, the last one lit) and its name;
 * update(n): a MIDI note 0…127 (null / NaN: none).
 * @param {{get?: () => object, doc?: Document}} o
 */
export function noteBody(o) {
  const O = o || {}, d = docOf(O), el = mk(d, 'div', 'cv-mbody cv-mnote');
  el.setAttribute('role', 'meter'); el.setAttribute('aria-label', 'Last note'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '127');
  const W = 192, H = 40, kw = W / 128;
  const sv = svgEl(d, 'svg', { class: 'cv-mkeys', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  for (let n = 0; n < 128; n++) {
    const b = BLACK.has(n % 12);
    sv.append(svgEl(d, 'rect', { class: 'cv-mkey' + (b ? ' cv-mblk' : ''), x: String(r1x(n * kw)), y: '0', width: String(r1x(kw)), height: String(b ? H * 0.6 : H) }));
  }
  const mark = svgEl(d, 'rect', { class: 'cv-mkeyon', x: '0', y: '0', width: String(r1x(kw)), height: String(H), display: 'none' });
  sv.append(mark);
  const rd = mk(d, 'div', 'cv-mread'), val = mk(d, 'span', 'cv-mval', '—'), lb = mk(d, 'span', 'cv-mlab', 'Note');
  rd.append(val, lb);
  el.append(sv, rd);
  let v = null;
  function update(n) {
    if (n == null || !fin(n)) { if (v !== null) { v = null; mark.setAttribute('display', 'none'); text1(val, '—'); el.removeAttribute('aria-valuenow'); } return; }
    const k = clamp(Math.round(n), 0, 127);
    if (k === v) return;
    v = k;
    set1(mark, 'x', String(r1x(k * kw))); set1(mark, 'height', String(BLACK.has(k % 12) ? H * 0.6 : H));
    if (mark.hasAttribute('display')) mark.removeAttribute('display');
    text1(val, NOTE_NAMES[k % 12] + (Math.floor(k / 12) - 1));
    set1(el, 'aria-valuenow', String(k));
  }
  return { el, update, sync() {}, value: () => v, destroy() { el.remove(); } };
}
/** The body for a mod kind ('wheel' | 'velo' | 'at' | 'bend' | (2b) 'lfo' | 'env' | 'macro' | 'cc' | 'chaos' | 'note'; null for anything else). */
export function bodyFor(kind, o) {
  switch (kind) {
    case 'wheel': return wheelBody(o);
    case 'velo': return veloBody(o);
    case 'at': return atBody(o);
    case 'bend': return bendBody(o);
    case 'lfo': return lfoBody(o);
    case 'env': return envBody(o);
    case 'macro': return macroBody(o);
    case 'cc': return ccBody(o);
    case 'chaos': return chaosBody(o);
    case 'note': return noteBody(o);
    default: return null;
  }
}
