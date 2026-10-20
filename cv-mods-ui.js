// cv-mods-ui.js — the bodies of the modulator modules (contract: docs/canvas/IMPL-2a.md §3, IMPL-2b §6.1; SPEC-canvas
// §2.10, §7.10): the project Mod Wheel (a vertical wheel in the look of the perf tray's #modw: a drag or the keys set it;
// the "+N on other tracks" chip by its jack), Velocity (the last velocity on the default curve), Aftertouch and Bend
// (meters; Bend bipolar); (2b) LFO, ENV, Macro, CC, Chaos and Note. Each returns {el, update(v), destroy()} (the wheel also
// setOthers(n); the 2b bodies sync() too); the host mounts el into the module's body (cv-module host.bodies.mount) and
// pushes live values through update — nothing here polls. Values: the wheel, velocity and aftertouch 0…1, bend −1…1
// (main.js ctl's). Owner: WIDGETS lane (2a B, 2b C; milestone 3 B).
// (milestone 3, IMPL-3 §2.2–2.3) LFO, ENV, Macro and Chaos are Serum's own panels over a slot host (slotBody below): the
// same LfoPanel / EnvPanel / MacrosPanel / ChaosRow a Serum's own LFO, ENV, macros and chaos show.
// (2b) The editing bodies take o = { doc?, get: () => the device's state (track.dev[id], plain data), edit(fields): the
// host writes the fields given (device-level keys; a nested lfo / env / chaos object is given whole, the host replaces it)
// as ONE History step (the 2a modPre / modStep glue) — called once per gesture at its end (a wk 'end' / 'set' phase, an
// input's change, a menu pick); (3) live?(fields): a gesture's moves (the first opens the step, each writes and reposts);
// cancel?(): a gesture that ended where it began after live writes; set?(k, v): a macro knob's live value per move (the
// host posts {t:'mval'}: no History, no patch); learn?(on): the CC body's Learn button arms / disarms MIDI learn; bpm?:
// () => the project tempo; (3) rows?, storage?, notify?, view?, devKey? (slotBody) }. A body reads the state through
// o.get(): after an undo / redo / external edit the host calls sync(). State shapes (IMPL-2b §1.1, mirroring Serum's:
// the object serum-core normalises plus the p values):
//   lfo    { kind: 'lfo', lfo: <normLfo shape: mode, mono, bpm, dot, trip, pts, …>, rate: n }  rate = Serum's l<k>.rate n
//          (pow4 0…100 Hz; BPM-synced: the ladder index over its length − 1, as Serum's p holds it)
//   env    { kind: 'env', env: <serum-core env: bpm, legInv, stealRe>, att, hold, dec, sus, rel: n (Serum's e<k>.* laws:
//          pow5 0…32 s, sus lin), crv: [a, d, r] (0…1, 0.5 linear: Serum's e<k>.ca / cd / cr, the attack / decay / release curvature bent by 10 · (2c − 1)) }
//   macro  { kind: 'macro', v: [8 × 0…1], names: [8 × ≤ 16 chars] }
//   cc     { kind: 'cc', cc: 0…127, ch: 0 (omni) | 1…16, v: 0…1 }
//   chaos  { kind: 'chaos', chaos: <serum-core chaos: mono, sh>, rate: n (Serum's c<k>.rate: pow5 0…1000 Hz; BPM-synced:
//          the LFO_LADDER index over 14), bpm: 0 | 1, smooth: 0…1 (kept, never compiled nor shown: no Serum field) }
//   note   { kind: 'note' }
// Live values (update): lfo / env / chaos / cc a value 0…1 (the lfo also { v, ph, y, out } — the phase dot and the PATH
// playhead; the env { v, stage, t } — the playhead); note the last MIDI note (0…127, null = none).
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9 (the
// Serum panel modules are imported on demand: the app's boot graph stays without them).
// iPad: the wheel (.cv-mw) is touch-action: none (style.css) and ends its drag on a pointercancel (a second finger:
// gesture.js) or a lost capture; listeners are passive where they never prevent.
import * as wk from './wk.js?v=9';

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
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
const stateOf = o => { const v = call(o.get); return isObj(v) ? v : {}; };
const n01 = (v, d) => (fin(v) ? clamp(v, 0, 1) : d);
const r1x = v => Math.round(v * 10) / 10;
const stop = e => { if (e.stopPropagation) e.stopPropagation(); };
const row = (d, cls) => mk(d, 'div', 'cv-mrow' + (cls ? ' ' + cls : ''));
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

/* ================================================================ (milestone 3) Serum's own panels on the modulators */
// The LFO, ENV, Macro and Chaos modules are Serum's own panels (IMPL-3 §2.2–2.3, the user's requirement: identical look and
// editing): a slot host (sx-host slotHost: a SerumHost over a synthetic Serum state with the device in one slot) mounting
// sx-ui-mod's LfoPanel 0 / EnvPanel 1 (ENV 2's layout) / MacrosPanel / ChaosRow 0, bare (the module's bar has the title,
// ⋯ and fold), every control data-nomod (a modulator's knob takes no cable). Edits: one History step per gesture end
// (o.edit), o.live per move when the host gives it (the sound follows the drag), o.cancel for a rollback, o.set(k, v) per
// macro knob move; view edits (zoom, LOCK, grid, tool) stay in the module (o.view). The Serum UI modules are loaded on
// the first such body (the app loads them lazily); a body made before they arrive fills in when they do (ready()).
let SX = null, SXP = null;
/** The Serum panel modules ({ host: sx-host.js, mod: sx-ui-mod.js }), loaded once; resolves when they are there. */
export function ready() {
  if (!SXP) SXP = Promise.all([import('./sx-host.js?v=9'), import('./sx-ui-mod.js?v=9')]).then(([host, mod]) => { SX = { host, mod }; return SX; });
  return SXP;
}
/** (milestone 3) The modulator kinds whose body is Serum's own panel. */
export const SLOT_KINDS = Object.freeze(['lfo', 'env', 'macro', 'chaos']);
/**
 * The body of an LFO / ENV / Macro / Chaos module: Serum's panel over a slot host. o = { doc?, get: () => the device
 * record, edit(fields) (one History step), live?(fields), cancel?(), set?(k, v) (macro knob moves), bpm?(), rows?: { count,
 * bypassed, bypass(on), remove } (its ⋯ menu's Bypass / Remove All Destinations), storage?, notify?, view? (kept by the
 * host per module: zoom, grid, tool), devKey? }. → { el, update(v), sync(), menuItems(), host(), view(), destroy() };
 * update(v): the monitor — a level, or { v, ph, y, out } (an LFO's phase dot / PATH playhead), { v, stage, t } (an ENV's
 * playhead); a macro body ignores it (its knobs show the values).
 * @param {'lfo'|'env'|'macro'|'chaos'} kind
 */
export function slotBody(kind, o) {
  const O = o || {}, d = docOf(O), el = mk(d, 'div', 'cv-mbody cv-mslot cv-m' + kind);
  let H = null, V = null, dead = false, pend = null;
  el.setAttribute('data-slot-kind', kind);
  const build = () => {
    if (dead || H || !SX) return;
    H = SX.host.slotHost(kind, { get: O.get, live: O.live, edit: O.edit, cancel: O.cancel, set: kind === 'macro' ? O.set : undefined, bpm: O.bpm,
      rows: O.rows, storage: O.storage, notify: O.notify, view: O.view, devKey: O.devKey, doc: d });
    V = SX.mod.mountSlot(H, el);
    if (pend !== null) H.live(pend);
  };
  if (SX) build(); else ready().then(build, err => console.error('cv-mods-ui: the Serum panels', err));
  return {
    el,
    update(v) { if (kind === 'macro' || v == null) return; if (H) H.live(v); else pend = v; },
    sync() { if (H) H.sync(); },
    menuItems: () => (V ? V.menuItems() : []),
    host: () => H,
    view: () => V,
    // (the 2b body API kept) the last monitor level; a macro body's eight knob elements
    value: () => (H ? H.liveV : NaN),
    knobs: () => (V && V.panel && V.panel.panel && Array.isArray(V.panel.panel.knobs) ? V.panel.panel.knobs.slice() : []),
    destroy() { if (dead) return; dead = true; if (H) H.destroy(); el.remove(); },
  };
}
/** (2b → 3) The LFO body: Serum's LFO panel (LFO 1 of its slot host). */
export function lfoBody(o) { return slotBody('lfo', o); }
/** (2b → 3) The ENV body: Serum's ENV panel in ENV 2's layout (START / END; the curves are Serum's 0…1, 0.5 linear). */
export function envBody(o) { return slotBody('env', o); }
/** (2b → 3) The Macro body: Serum's MACROS 4 × 2 (names ≤ 16; each name tile is its jack k1…k8). */
export function macroBody(o) { return slotBody('macro', o); }
/** (2b → 3) The Chaos body: Serum's chaos row (RATE, BPM, MONO, S&H; the 2b smooth knob and scope are gone: never compiled). */
export function chaosBody(o) { return slotBody('chaos', o); }

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
