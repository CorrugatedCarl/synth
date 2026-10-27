// cv-cables.js — patch cables drawn in world coordinates (SPEC-canvas §2.9; contract: docs/canvas/IMPL-1b.md §4.5).
// Stage 1b: DERIVED, READ-ONLY audio cables (instrument → FX module → OUT; a Serum's route label). Two SVG layers in
// #world: `svg.cv-cables` under the modules (z-index 0: audio cables, mod-cable bodies) and `svg.cv-cable-ends` above
// them (z-index 10000: mod-cable ends and amount badges, empty until 2a). Stroke widths come from --ik (CSS), never
// from vector-effect. Owner: MODULES lane.
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9.
//   cablePath(x1, y1, x2, y2)   the cubic of one cable (horizontal tangents)
//   wrapPath(A, B, src, dst, o) (WC) a line routed round its source module (a portrait rig's Amplifier → Effects; o.route: the host's)
//   deriveCables(track)         the stage-1b track's cables (pure)
//   routeLabel(s, fx)           a Serum's own-FX route label (pure: reads state only)
//   cablesOf(track)             (1e) a v2 track's cables: its wires (editable) + each Serum's own-FX route (read-only) (pure)
//   jackPort / portJack         (1e) canvas jack id ↔ model port ('i2/fx.out' ↔ 'i2.out' for a Serum; inner jacks: null)
//   createCables(worldEl, o)    the two layers; set / layout / highlight / select / live / destroy; (1e) editable cables:
//                               tap selects (a floating × Disconnect at the midpoint), long-press / right-click menu,
//                               Escape clears, Delete / Backspace disconnects
//   createCableDrag(world, o)   (1e) patching from a jack: live bézier, compatible jacks glow (cv-ok) / others dim with
//                               the reason (cv-no), 32 px snap, a module body's first compatible jack, re-patch by
//                               dragging a cable's end off its input, tap = "Connect to…" (also Enter / Space on a jack)
// Stage 2a (IMPL-2a §3): modulation cables. cablesOf(track, {project, presetRows}) adds one cable per track.mods row
// (kind 'mod', a '<module>.out' → b '<dev>:<param>') and, given presetRows, one per performance row of a Serum's own matrix
// (preset: true) whose module exists. A mod cable's body sits in the under layer; its last END_PX screen px in the over
// layer and its amount badge (button.cv-mbadge in the world: the only part taking a press) above the modules. Visibility
// Always / On select / Never (setModsVisible), the MOD_FADE_N+ fade and its one-time hint. A press on a mod-out jack
// ([data-kind="mod"]) drags onto KNOBS: elementFromPoint → closest [data-dest] → closest [data-dev].
// Each SVG sits at its cables' bounding box (+ PAD) with overflow visible: hit testing outside an SVG's own box is not
// reliable across engines, and a box per layer keeps the painted area small. No viewBox: one user unit = one world px.
// Milestone 3 (IMPL-3 §2.5, lane C): a Serum in parts view (track.lay[iN].ui === 'parts'; opts.parts may say otherwise)
// draws its INTERNAL cables, views of its state through sx-edges (the pasted STRIPS / routeOf are gone; routeLabel is
// sx-edges'): cables {id: 'x:<dev>:<edge id>', kind: 'audio', int: 'audio' | 'note' | 'warp', dev, edge: {a, b} (sx-edges
// ENDs), a / b canvas jacks (sx-edges jackOf), share?, fork?, stub?, readonly? (VOICE → own FX: drawn as before), tap?
// ('open': a warp / pitch source — a tap is onAction(id, 'tap'), no Disconnect)}; a stub (b null) is STUB_PX long from its
// out jack, dashed, with its tag; one BALANCE badge (button.cv-fork) per forked source → onAction(id, 'balance'). Its own
// LFO / ENV / macro rows (s.matrix, the performance sources aside) are mod cables {id: 'o:<dev>:<slot>', own: true, dev,
// slot} from their module's jack (modSrcJack: 'iN/lfo3.out', VOICE's 'iN.env1', MACROS' inline 'iN/macros.k2') in the
// Serum's colour. A track.mods link row from 'iN/lfo3.out' / 'iN/env1.out' is drawn from the same jacks (no module in
// bundled view: no cable, as before). A knob end the host marks hidden (cv-module ports(): {hid, tag}) is dashed and its
// badge carries the tag ('OSC B · LEVEL · hidden'). [data-twin] controls are never a drag's target.
// Stage 7d + 8 (IMPL-8 §5.4, §9; lane U): the Pads module ('pd1' … 'pd64' since IMPL-P, keyKind 'pads') — a mod pad's row src 'pd<n>.p<i>'
// (modSrcPort: ports p0…p63) leaves from the pad's inline jack in the PAD's colour (opts.project.pads); note cables (kind
// 'note', derived, a tap cable: no Disconnect) from the module's 'notes' jack to each instrument of this track a visible pad
// plays, ending at a fixed point of the instrument's left edge (b '<dev>.' + NOTE_END: no jack there, review #13 —
// cv-module's ports() computes it), dashed (cv-pads' CSS), in the module's first such pad's colour.
import { DESTS, DEST_INDEX, moduleOf } from './serum-core.js?v=9';
import * as wk from './wk.js?v=9';
import { routeLabel, serumEdges, jackOf, partLabel, partOn } from './sx-edges.js?v=9';
import { COLORS as PAD_COLORS, visibleSlots, targetNotes, drumNote, PAD_ID, padOfSrc } from './pads-core.js?v=9';
import { PERS, normDrum } from './drum-core.js?v=9';
import { isSxId } from './models.js?v=9'; // ((WC) a Serum-engine device — the Serum and the rig — has the own-FX cable, the internal cables and the preset rows)
import { HIT_PX } from './cv-cords.js?v=9'; // ((WC) a cord body's tap target, screen px)
export { HIT_PX };
// ((WC) the cords-mode target chip beside the finger: cv-patch's offsets, screen px — (fixer K, review P3-9) its bottom CHIP_UP over the
// finger (cv-patch's top at −54 with one 27 px line; no room above: its top CHIP_UP under it), as wide as CHIP_W (style.css [data-wrap])
// before it wraps; unmeasured, a line CHIP_LH tall plus CHIP_PAD (5 + 5 padding, 1 + 1 border); (round 1) flipped under a finger or a
// pen, CHIP_CLEAR px clear of it sideways (a fingertip's half-width and a margin)
const CHIP_DX = 26, CHIP_UP = 27, CHIP_W = 360, CHIP_LH = 17, CHIP_PAD = 12, CHIP_CLEAR = 44;
/** (milestone 3) a stub's length (world px) */
export const STUB_PX = 56;
/** (review 2 P1-5) below k = 1 a stub keeps STUB_PX screen px (its out jack's touch circle is 22 screen px at any zoom), at
 * most STUB_MAX world px (inside Tidy's GAP 160 to the next column) */
export const STUB_MAX = 136;
const stubLen = k => Math.min(STUB_MAX, Math.max(STUB_PX, STUB_PX / (k > 0 ? k : 1)));

/** Minimum horizontal tangent length of a cable's cubic (world px). */
export const TANGENT_MIN = 40;
/** Margin of a layer's box around its cables (world px): strokes, labels and the hit path's half width. */
export const PAD = 48;
/** (1e) A cable drag snaps to a compatible jack this close (screen px, SPEC §2.9 / §4.5); a press that moves less than
 * TAP_PX (screen px) before it lifts is a tap ("Connect to…" on a jack, select on a cable). */
export const SNAP_PX = 32, TAP_PX = 8;

/** (2a) A mod cable's end drawn above the modules (screen px); past MOD_FADE_N visible mod cables (Always) the ones not
 * touching the selection fade and the hint shows once. */
export const END_PX = 24, MOD_FADE_N = 24;
/** (review 2 P1-7) Hidden-end badges at one end stack this many screen px apart (the badge's 18 + 4). */
export const HID_STEP = 22;
/** (2a) The modulator modules' colours (their cables' and their classic halos' too, SPEC §2.9 / §7.11): by mod kind;
 * (2b) the six stage-2b kinds. */
export const MOD_COLOR = Object.freeze({ wheel: '#4fb3d9', velo: '#e8a33d', at: '#b98ae6', bend: '#63c98a',
  lfo: '#ff7f5a', env: '#d9c84a', macro: '#5b8cff', cc: '#9aa4b2', chaos: '#e05fb4', note: '#7fe0d6' });
/** (2a) A singleton mod device kind (track.dev) → its fixed module key; a Serum matrix performance source → that
 * module's key (perfRows). The multi-instance kinds are keyed by prefix: MOD_PREFIX / keyKind. */
export const MOD_KEY = Object.freeze({ wheel: 'wheel', velo: 've', at: 'at', bend: 'bd' });
/** (2b, IMPL-2b §1.1) Every mod kind → its device-id prefix: the singletons their key, the multi-instance kinds a
 * letter followed by a number ('l1', 'e2', 'm1', 'c3', 'h1'). */
export const MOD_PREFIX = Object.freeze({ wheel: 'wheel', velo: 've', at: 'at', bend: 'bd', note: 'nt', lfo: 'l', env: 'e', macro: 'm', cc: 'c', chaos: 'h' });
const PREFIX_KIND = Object.freeze(Object.keys(MOD_PREFIX).reduce((o, k) => { o[MOD_PREFIX[k]] = k; return o; }, {}));
/** (2b) The mod kind of a module key ('wheel' → 'wheel', 've' → 'velo', 'nt' → 'note', 'l3' → 'lfo', 'm1' → 'macro', 'c2'
 * → 'cc', 'h1' → 'chaos', 'e1' → 'env'; anything else null). Pure. */
export function keyKind(key) {
  if (typeof key !== 'string' || !key) return null;
  if (PAD_ID.test(key)) return 'pads'; // ((8) a project Pads module: no track device, no MOD_PREFIX entry)
  if (PREFIX_KIND[key] && MOD_PREFIX[PREFIX_KIND[key]] === key && !/^[lemch]$/.test(key)) return PREFIX_KIND[key];
  const m = /^([lemch])([1-9]\d*)$/.exec(key);
  return m ? PREFIX_KIND[m[1]] : null;
}
/** (2b) A macro module's jack ports (its knob rows). */
export const MACRO_PORTS = Object.freeze(['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
/** (2a) The visibility modes of the mod cables (the toolbar ∿ cycle). */
export const MOD_MODES = Object.freeze(['always', 'select', 'never']);
/** (2a) The hint shown once when more than MOD_FADE_N mod cables are visible. */
export const MOD_HINT = MOD_FADE_N + '+ mod cables, tap ∿ to filter';
/** (WC, IMPL-WC §4.5) A claimed per-note row's badge tag (a rope cannot dash; the inspector's wording) and a claimed record's label
 * (a dry source's "dry") above its b plug (world px). */
export const NOTE_TAG = '∿ last note', CORD_TAG_DY = 22;
/** (WC, §4.4) A long-press (touch, ms) on a cords-mode input holding several cords: "Which cord?". */
export const WHICH_MS = 500;

const SVG = 'http://www.w3.org/2000/svg';
const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const r2 = v => Math.round(v * 100) / 100;
const text1 = (el, t) => { if (el.textContent !== t) el.textContent = t; };

/**
 * @typedef {{
 *   id: string, a: string, b: string, kind: 'audio' | 'mod',
 *   label?: string, dim?: boolean, readonly?: boolean, color?: string,
 *   wire?: string, from?: string, src?: string[], g?: number,
 * }} Cable  a / b: '<moduleId>.<jackId>' (e.g. 'i1.out', 'fx1.in', 'out.in'; a Serum: 'i1.out' → 'i1/fx.in');
 *   color (addition): the source instrument's colour (§2.9 table), CSS var --cc on the cable's group;
 *   (1e) wire: the track.wires id of an editable cable (= its id); from: the wire's model end a (a Serum's 'i2.out' is
 *   drawn from 'i2/fx.out'); src: the instruments it carries; dim: every one of them silent (powered off or not the
 *   soloed one) → .cv-off (grey); g: the wire's level when ≠ 1 (its label: dB)
 */

/** (2b) A track.mods row's src → its module key and jack port: 'wheel' → {key: 'wheel', port: 'out'}, '<dev>.out' →
 * {key: dev, port: 'out'}, a macro's '<dev>.k3' → {key: dev, port: 'k3'}; (milestone 3) a part key: 'i1/lfo3.out' →
 * {key: 'i1/lfo3', port: 'out'}; (8) a mod pad 'pd1.p12' → {key: 'pd1', port: 'p12'} (p0…p63) (else null). Pure. */
export function modSrcPort(src) {
  if (src === 'wheel') return { key: 'wheel', port: 'out' };
  const q = padOfSrc(src); // ((8) a mod pad: its slot's inline jack, p0…p63)
  if (q) return { key: q.id, port: 'p' + q.i };
  const m = typeof src === 'string' ? /^([a-z][a-z0-9]*(?:\/[a-z][a-zA-Z0-9]*)?)\.(out|k[1-8])$/.exec(src) : null;
  return m ? { key: m[1], port: m[2] } : null;
}
/** (milestone 3, §2.5) The jack a row's src leaves from: a part key resolved as the parts view lays them out — 'iN/env1.out'
 * → VOICE's 'iN.env1', 'iN/lfo3.out' / 'iN/env2.out' → that module's 'out', 'iN/macros.k2' → MACROS' inline 'k2'; any other
 * '<key>.<port>' as it is, the wheel 'wheel.out' (null: not a source). In bundled view no such module exists: no cable. */
export function modSrcJack(src) {
  const p = modSrcPort(src);
  if (!p) return null;
  const m = /^([a-z][a-z0-9]*)\/env1$/.exec(p.key);
  return m && p.port === 'out' ? m[1] + '.env1' : p.key + '.' + p.port;
}
// (milestone 3) a Serum matrix source → its parts-view jack on Serum `dev` ('lfo3' / 'lfo3y' → 'dev/lfo3.out', 'env1' →
// VOICE 'dev.env1', 'env2' → 'dev/env2.out', 'macro4' → 'dev/macros.k4'; anything else null: the Mod list lists it)
function ownJack(dev, src) {
  if (typeof src !== 'string') return null;
  let m = /^(lfo(?:10|[1-9]))y?$/.exec(src);
  if (m) return dev + '/' + m[1] + '.out';
  if (src === 'env1') return dev + '.env1';
  if ((m = /^(env[2-4])$/.exec(src))) return dev + '/' + m[1] + '.out';
  if ((m = /^macro([1-8])$/.exec(src))) return dev + '/macros.k' + m[1];
  return null;
}
/** (milestone 3, §2.4) A knob end's tag where no mounted view shows it: 'OSC B · LEVEL · hidden' (its part from serum-core
 * moduleOf, its label without the group's words); a destination outside a part: its label alone. Pure. */
export function hiddenTag(id) {
  const i = DEST_INDEX[id], d = i === undefined ? null : DESTS[i];
  if (!d) return String(id || '') + ' · hidden';
  const g = typeof d.group === 'string' ? d.group : '', part = moduleOf(id), L = part && g && d.label.startsWith(g + ' ') ? d.label.slice(g.length + 1) : d.label;
  return (part ? partLabel(part) + ' · ' : '') + L.toUpperCase() + ' · hidden';
}
/** (2a) A track.mods row's src → its module key: 'wheel' → 'wheel', '<dev>.out' → '<dev>', (2b) '<dev>.k3' → '<dev>' (else null). */
export function modSrcKey(src) { const p = modSrcPort(src); return p ? p.key : null; }
/** (2b) The mod kind of a row's source: 'wheel' → 'wheel', 've.out' → 'velo', 'l2.out' → 'lfo', 'm1.k3' → 'macro' (else null). */
export function srcKind(src) { return keyKind(modSrcKey(src)); }
/** (2a) A mod-out jack → the row's src it starts: 'wheel.out' → 'wheel', 've.out' → 've.out', (2b) 'm1.k3' → 'm1.k3'. */
export function modSrcOf(jack) { return jack === 'wheel.out' ? 'wheel' : String(jack || ''); }
/** (2a) A mod cable's amount badge: '+50%', '−25%', bipolar '±50%' / '∓50%' (amt −1…1) — also the Mod list's and the
 * inspector's (cv-modlayer: one format, U11). */
export function amtText(amt, bi) {
  const a = fin(amt) ? Math.max(-1, Math.min(1, amt)) : 0, p = Math.round(Math.abs(a) * 100);
  return (bi ? (a < 0 && p ? '∓' : '±') : a < 0 ? '−' : '+') + p + '%'; // (U11: a bipolar amount keeps its sign)
}
// (U2) inside a mod cable's amount badge (button.cv-mbadge or its spans)?
const inBadge = n => { for (; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (/(^|\s)cv-mbadge(\s|$)/.test(n.getAttribute('class') || (typeof n.className === 'string' ? n.className : '') || '')) return true; return false; };
// (2b U1) a synthetic contextmenu at e's point, for the control beneath a badge (an event class where there is one —
// MouseEvent, a test DOM's —, a plain copy where the event is a plain object)
function ctxEv(e) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, button: 2, buttons: 0 };
  const E = typeof globalThis.MouseEvent === 'function' ? globalThis.MouseEvent : e && e.constructor !== Object && typeof e.constructor === 'function' ? e.constructor : null;
  if (E) { try { return new E('contextmenu', init); } catch (err) { /* a plain copy */ } }
  return Object.assign({}, e, init, { type: 'contextmenu', isTrusted: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
}
// ((MM UI fixer) a control's device: its closest [data-dev], else its module's data-cv-mod device (createCableDrag devAt's rule)
function devUp(n) {
  for (let q = n; q && typeof q.getAttribute === 'function'; q = q.parentNode) { const d = q.getAttribute('data-dev'); if (d != null) return d; }
  for (let q = n; q && typeof q.getAttribute === 'function'; q = q.parentNode) { const m = q.getAttribute('data-cv-mod'); if (m != null) return m.split('/')[0]; }
  return null;
}
// (U2) the topmost element at a client point that is no badge (document.elementsFromPoint; null without it)
function beneath(doc, x, y, skip) {
  let L = null;
  try { L = doc && typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : null; } catch (err) { L = null; }
  for (const n of L || []) if (!inBadge(n) && !(skip && skip(n))) return n;
  return null;
}
/** (2a) A Serum's performance rows (its own s.matrix rows whose src is wheel / velo / at / bend): [{slot, src, dst, amt,
 * bi, byp}] — cablesOf's presetRows: true. Pure. */
export function perfRows(dev) {
  const M = isObj(dev) && isObj(dev.vals) && isObj(dev.vals.s) && Array.isArray(dev.vals.s.matrix) ? dev.vals.s.matrix : [];
  const out = [];
  M.forEach((r, slot) => { if (isObj(r) && MOD_KEY[r.src] && typeof r.dst === 'string' && r.dst) out.push({ slot, src: r.src, dst: r.dst, amt: r.amt, bi: r.bi, byp: r.byp }); });
  return out;
}

/** Cubic bézier with horizontal tangents d = max(TANGENT_MIN, |x2 − x1| / 2): 'M x1 y1 C x1+d y1, x2−d y2, x2 y2'.
 * @returns {string} an SVG path `d` */
export function cablePath(x1, y1, x2, y2) {
  const d = Math.max(TANGENT_MIN, Math.abs(x2 - x1) / 2);
  return `M ${r2(x1)} ${r2(y1)} C ${r2(x1 + d)} ${r2(y1)}, ${r2(x2 - d)} ${r2(y2)}, ${r2(x2)} ${r2(y2)}`;
}
/** (WC, integration fixer L — review WC-int P3-11) the corner radius of a routed line (world px; less where its runs are short) */
export const WRAP_R = 24;
/** (WC, integration fixer L — review WC-int P3-11) A line from A (an out jack on module src's right edge) to B (an in jack on the left edge of
 * module dst, on a row under src, B left of src's right edge — a portrait rig's Amplifier → Effects, Tidy's wrap) ROUTED round src: out
 * rightward, down beside it, along the gap between the rows, into B from the left — cablePath's horizontal tangents would loop it back
 * across src's face. Its run down `out` right of src's right edge (default TANGENT_MIN; a rig's beyond Envelope 1's cord), into B TANGENT_MIN
 * from the left, the corners rounded (WRAP_R); obst: every other module's rect (world px). null when B is not under src, not left of its
 * right edge, or a module stands in a run or the gap (the plain line stands). Pure.
 * @returns {{d: string, x: number, y: number, x0: number, x1: number} | null} the path, its label point (the gap run's middle), its x span */
export function wrapPath(A, B, src, dst, obst, out) {
  const box = r => !!r && fin(r.x) && fin(r.y) && fin(r.w) && fin(r.h), pt = p => !!p && fin(p.x) && fin(p.y);
  if (!pt(A) || !pt(B) || !box(src) || !box(dst)) return null;
  const sr = src.x + src.w, sb = src.y + src.h, xr = Math.max(A.x, sr) + (fin(out) && out > WRAP_R ? out : TANGENT_MIN), xl = B.x - TANGENT_MIN, g = (sb + dst.y) / 2;
  if (!(B.x < sr) || !(dst.y >= sb + 2 * WRAP_R) || !(B.y > g) || !(A.y < g)) return null;
  const hits = (x0, y0, x1, y1) => (obst || []).some(r => box(r) && r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0); // (a module over a run: a thin box)
  if (hits(A.x, A.y - 1, xr + 1, A.y + 1) || hits(xr - 1, A.y, xr + 1, g) || hits(xl, sb, xr, dst.y) || hits(xl - 1, g, xl + 1, B.y) || hits(xl - 1, B.y - 1, B.x, B.y + 1)) return null;
  const R = Math.min(WRAP_R, xr - A.x, (g - A.y) / 2, (xr - xl) / 2, (B.y - g) / 2, B.x - xl), K = R * 0.5523, P = (x, y) => r2(x) + ' ' + r2(y);
  const d = 'M ' + P(A.x, A.y) + ' L ' + P(xr - R, A.y) + ' C ' + P(xr - R + K, A.y) + ', ' + P(xr, A.y + R - K) + ', ' + P(xr, A.y + R)
    + ' L ' + P(xr, g - R) + ' C ' + P(xr, g - R + K) + ', ' + P(xr - R + K, g) + ', ' + P(xr - R, g)
    + ' L ' + P(xl + R, g) + ' C ' + P(xl + R - K, g) + ', ' + P(xl, g + R - K) + ', ' + P(xl, g + R)
    + ' L ' + P(xl, B.y - R) + ' C ' + P(xl, B.y - R + K) + ', ' + P(xl + R - K, B.y) + ', ' + P(xl + R, B.y) + ' L ' + P(B.x, B.y);
  return { d, x: r2((xl + xr) / 2), y: r2(g), x0: xl, x1: xr };
}

/** The derived cables of a stage-1b track: classic i1.out → fx1.in → out.in; Serum i1.out → i1/fx.in (label: the
 * Serum's routes, routeLabel) → out.in. @param {{model: string, vals?: object, fx?: object}} track @returns {Cable[]} */
export function deriveCables(track) {
  const t = isObj(track) ? track : {}, color = typeof t.color === 'string' ? t.color : undefined;
  const sx = isSxId(t.model), fx = sx ? 'i1/fx' : 'fx1';
  const c = (a, b, label) => {
    const o = { id: a + '>' + b, a, b, kind: 'audio', readonly: true };
    if (label) o.label = label;
    if (color) o.color = color;
    return o;
  };
  return [c('i1.out', fx + '.in', sx ? routeLabel(isObj(t.vals) ? t.vals.s : null, t.fx) : ''), c(fx + '.out', 'out.in')];
}

const isSx = (D, id) => isObj(D[id]) && D[id].kind === 'synth' && isSxId(D[id].model);
const serumDev = isSx; // ((3) the parts code's name for it: a device-record read, never a track accessor — isSx( is the ratchet's v1 name)
const devOf = p => (typeof p === 'string' ? p.slice(0, p.lastIndexOf('.')) : '');
/** (1e) The model port behind a canvas jack of a v2 track: a Serum's own-FX out ('i2/fx.out') is the Serum's 'i2.out'; the
 * jacks inside a Serum (its 'out' → its own FX's 'in') are not patchable (null); a jack of an unknown device: null.
 * @param {{dev?: object}} track @param {string} jack @returns {string | null} */
export function jackPort(track, jack) {
  const D = isObj(track) && isObj(track.dev) ? track.dev : null;
  if (!D || typeof jack !== 'string' || jack.lastIndexOf('.') < 1) return null;
  const d = devOf(jack), j = jack.slice(d.length + 1), sl = d.indexOf('/');
  if (sl > 0) return d.slice(sl + 1) === 'fx' && isSx(D, d.slice(0, sl)) && j === 'out' ? d.slice(0, sl) + '.out' : null;
  if (!isObj(D[d])) return null;
  return isSx(D, d) ? null : jack;
}
/** (1e) The canvas jack a model port is drawn at (a Serum's 'i2.out' → 'i2/fx.out'). @returns {string} */
export function portJack(track, port) {
  const D = isObj(track) && isObj(track.dev) ? track.dev : null, d = devOf(port);
  return D && isSx(D, d) && port === d + '.out' ? d + '/fx.out' : port;
}
// the instruments that sound (cv-graph powered: on, and the soloed ones when any is)
function sounding(D) {
  const ins = Object.keys(D).filter(id => isObj(D[id]) && D[id].kind === 'synth' && D[id].on !== false);
  return new Set(ins.some(id => D[id].solo) ? ins.filter(id => D[id].solo) : ins);
}
const dB = g => (g > 0 ? (Math.round(20 * Math.log10(g) * 10) / 10).toFixed(1).replace('-', '−') + ' dB' : '−∞ dB');
/**
 * (1e) The audio cables of a v2 track (SPEC §2.9): one per track.wires entry (editable: id = the wire id; a Serum's wire
 * leaves from its own FX module, 'iN/fx.out'), plus the read-only 'iN.out → iN/fx.in' inside every Serum (route label).
 * Colour: the source instrument's (dev.color), else the track's. dim: every instrument the cable carries is silent
 * (powered off, or another instrument is soloed) — a panel's output carries what reaches the panel. A track without
 * dev (v1): deriveCables. (WC) opts.edges(id, dev) → records: a device shown as its modules takes its internal records from the
 * host (a rig: rig-core's edges()), else sx-edges'. Pure. @param {{dev?: object, wires?: Array, color?: string}} track @returns {Cable[]}
 */
export function cablesOf(track, opts) {
  const t = isObj(track) ? track : {}, D = isObj(t.dev) ? t.dev : null;
  if (!D) return deriveCables(t);
  const tc = typeof t.color === 'string' ? t.color : undefined, on = sounding(D);
  const wires = (Array.isArray(t.wires) ? t.wires : []).filter(w => isObj(w) && typeof w.id === 'string' && typeof w.a === 'string' && typeof w.b === 'string');
  const srcs = new Map(); // device id → the instruments reaching its output (panels: their inputs; one level, panel → panel is stage 4)
  for (const id of Object.keys(D)) if (isObj(D[id]) && D[id].kind === 'synth') srcs.set(id, [id]);
  for (let pass = 0; pass < 4; pass++) {
    for (const w of wires) {
      const a = devOf(w.a), b = devOf(w.b);
      if (!isObj(D[b]) || D[b].kind === 'synth' || D[b].kind === 'out' || !srcs.has(a)) continue;
      const L = srcs.get(b) || [];
      for (const s of srcs.get(a)) if (!L.includes(s)) L.push(s);
      srcs.set(b, L);
    }
  }
  const colorOf = S => { const d = S.length === 1 && D[S[0]]; return (d && typeof d.color === 'string' && d.color) || tc; };
  const mk = (o, S) => {
    o.kind = 'audio'; o.src = S.slice();
    const c = colorOf(S);
    if (c) o.color = c;
    if (S.length && S.every(id => !on.has(id))) o.dim = true;
    return o;
  };
  const out = [];
  for (const id of Object.keys(D)) {
    if (!isSx(D, id)) continue;
    const lab = routeLabel(isObj(D[id].vals) ? D[id].vals.s : null, D[id].fx), o = { id: id + '.out>' + id + '/fx.in', a: id + '.out', b: id + '/fx.in', readonly: true };
    if (lab) o.label = lab;
    out.push(mk(o, [id]));
  }
  for (const w of wires) {
    const o = { id: w.id, wire: w.id, a: portJack(t, w.a), b: w.b, from: w.a };
    if (typeof w.g === 'number' && isFinite(w.g) && w.g !== 1) { o.g = w.g; o.label = dB(w.g); }
    out.push(mk(o, srcs.get(devOf(w.a)) || []));
  }
  for (const id of Object.keys(D)) if (serumDev(D, id) && partsView(t, id, opts)) out.push(...internalOf(t, id, D[id], tc, on, opts));
  return out.concat(modCables(t, D, opts), noteCables(t, D, opts));
}
// (WC, IMPL-WC §4.1) a device's internal records: the host's opts.edges(id, dev) when it answers an array (a rig: rig-core's edges(),
// cv-cables' record shape + the cord fields), else sx-edges' (internal below) — a null or a throw: sx-edges'
function internalOf(t, id, dev, tc, on, opts) {
  const f = isObj(opts) && typeof opts.edges === 'function' ? opts.edges : null;
  if (f) {
    let L = null;
    try { L = f(id, dev); } catch (err) { L = null; }
    if (Array.isArray(L)) return L.filter(c => isObj(c) && typeof c.id === 'string');
  }
  return internal(id, dev, tc, on, isObj(t.lay) ? t.lay : {});
}
/** (milestone 3) Is Serum `id` of this track shown as parts? opts.parts: false (never), a function (id) → bool, else the
 * view flag track.lay[id].ui === 'parts'. Pure. */
export function partsView(track, id, opts) {
  const P = isObj(opts) ? opts.parts : undefined;
  if (P === false) return false;
  if (typeof P === 'function') { try { return !!P(id); } catch (err) { return false; } }
  const L = isObj(track) && isObj(track.lay) ? track.lay[id] : null;
  return isObj(L) && L.ui === 'parts';
}
// (milestone 3) a Serum's internal cables in parts view (sx-edges: views of its state); VOICE → own FX is the read-only
// cable above already (VOICE keeps the device key: 'iN.out → iN/fx.in'). (review 2 P1-6, the lead's decision) a source
// routed into a filter that is off and has no module (I1: no lay entry) is a dimmed stub "→ Filter 1 (off)" — the default
// Serum's OSC A, else drawn to nothing; its edge stays (a tap: the routing, the filter's offer; Disconnect as before)
function internal(id, dev, tc, on, lay) {
  const s = isObj(dev.vals) ? dev.vals.s : null, color = typeof dev.color === 'string' && dev.color ? dev.color : tc, out = [];
  for (const e of serumEdges(s, dev.fx)) {
    if (e.kind === 'fx') continue;
    const o = { id: 'x:' + id + ':' + e.id, kind: 'audio', int: e.kind, dev: id, edge: { a: e.a, b: e.b }, a: jackOf(id, e.a), b: e.b ? jackOf(id, e.b) : null, src: [id] };
    const fb = e.kind === 'audio' && /^filter2?\.in$/.test(e.b || '') && /^(osc[ABC]|sub|noise)\.out$/.test(e.a) ? e.b.split('.')[0] : null;
    if (fb && !partOn(s, fb) && !lay[id + '/' + fb]) { o.b = null; o.stub = true; o.off = fb; o.label = '→ Filter ' + (fb === 'filter2' ? 2 : 1) + ' (off)'; o.dim = true; }
    if (e.stub) { o.stub = true; o.label = e.label; }
    if (e.fork) o.fork = true;
    if (fin(e.share)) o.share = e.share;
    if (e.kind === 'warp') { o.tap = 'open'; o.label = e.what; o.field = e.field; }
    if (e.dim || !on.has(id)) o.dim = true;
    if (color) o.color = color;
    out.push(o);
  }
  return out;
}
/**
 * (2a) The mod cables of a v2 track (IMPL-2a §3): one per track.mods row — {id: row id, kind: 'mod', a: '<module>.<port>' (the
 * wheel's 'wheel.out', '<dev>.out', (2b) a macro knob's '<dev>.k<n>'), b: '<dev>:<param>', amt, bi, byp, preset: false, dashed, badge (amtText), color
 * (the source module's: its dev.color, else MOD_COLOR)}; then, with opts.presetRows (true: perfRows of each Serum; or
 * (devId, dev) → rows), one per performance row of a Serum's own matrix whose module exists (the wheel: opts.project
 * .perf.wheel; Velocity / Aftertouch / Bend: that device on the track) — {id: 'p:<dev>:<slot>', preset: true, dev, slot}.
 * opts.dashed(row) → true draws a row dashed (.cv-dash: a per-note source on a target following the last note, IMPL-2b
 * §1.3 — derived by the host, never stored). Colour by the source module's kind (MOD_COLOR, any 2b kind by prefix). Pure.
 */
function modCables(t, D, opts) {
  const o = isObj(opts) ? opts : {}, out = [], tc = typeof t.color === 'string' ? t.color : undefined;
  const P = isObj(o.project) ? o.project : null, PJ = P, wheel = !!(P && isObj(P.perf) && P.perf.wheel);
  const mdev = k => (isObj(D[k]) && keyKind(k) === D[k].kind ? D[k] : null); // ((2b) any mod kind: key ↔ kind by prefix)
  const colorOf = k => { if (k === 'wheel') return MOD_COLOR.wheel; const d = mdev(k); return (d && typeof d.color === 'string' && d.color) || (d && MOD_COLOR[d.kind]) || tc; };
  const mk = (id, a, b, r, key, extra) => {
    const c = Object.assign({ id, kind: 'mod', a, b, amt: fin(r.amt) ? r.amt : 0, bi: !!r.bi, byp: !!r.byp, preset: false, dashed: false }, extra);
    if (typeof o.dashed === 'function') { try { c.dashed = !!o.dashed(r); } catch (err) { /* host */ } }
    c.badge = amtText(c.amt, c.bi);
    const col = colorOf(key);
    if (col) c.color = col;
    return c;
  };
  const sxColor = k => { const d = D[k.split('/')[0]]; return serumDev(D, k.split('/')[0]) && typeof d.color === 'string' && d.color ? d.color : null; };
  for (const r of Array.isArray(t.mods) ? t.mods : []) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.dst !== 'string' || r.dst.indexOf(':') < 1) continue;
    const P = modSrcPort(r.src); // ((2b) a macro's cable leaves at its knob's jack: 'm1.k3'; (3) a linked Serum LFO / ENV its part's)
    if (!P) continue;
    const c = mk(r.id, modSrcJack(r.src), r.dst, r, P.key, { src: r.src });
    if (P.key.indexOf('/') > 0) { const k = sxColor(P.key); if (k) c.color = k; }
    else if (keyKind(P.key) === 'pads') { const k = padColor(PJ, P.key, P.port); if (k) c.color = k; } // ((8) the pad's colour, §6.4)
    out.push(c);
  }
  // (milestone 3) a Serum in parts view: its own LFO / ENV / macro rows from their modules' jacks (the Serum's colour)
  if (o.ownRows !== false) {
    for (const id of Object.keys(D)) {
      if (!serumDev(D, id) || !partsView(t, id, o)) continue;
      const M = isObj(D[id].vals) && isObj(D[id].vals.s) && Array.isArray(D[id].vals.s.matrix) ? D[id].vals.s.matrix : [];
      M.forEach((r, slot) => {
        const a = isObj(r) ? ownJack(id, r.src) : null;
        if (!a || typeof r.dst !== 'string' || !r.dst || /^bus\d+$/.test(r.dst)) return; // (a point-modulation bus: no knob)
        const c = mk('o:' + id + ':' + slot, a, id + ':' + r.dst, r, id, { own: true, dev: id, slot, src: r.src });
        const k = sxColor(id);
        c.color = k || MOD_COLOR[/^lfo/.test(r.src) ? 'lfo' : /^env/.test(r.src) ? 'env' : 'macro'];
        out.push(c);
      });
    }
  }
  const PR = o.presetRows;
  if (PR) {
    for (const id of Object.keys(D)) {
      if (!isSx(D, id)) continue;
      let rows = null;
      try { rows = typeof PR === 'function' ? PR(id, D[id]) : perfRows(D[id]); } catch (err) { rows = null; }
      for (const r of Array.isArray(rows) ? rows : []) {
        const key = isObj(r) ? MOD_KEY[r.src] : null;
        if (!key || typeof r.dst !== 'string' || !r.dst || !(key === 'wheel' ? wheel : mdev(key))) continue;
        out.push(mk('p:' + id + ':' + r.slot, key + '.out', id + ':' + r.dst, r, key, { preset: true, dev: id, slot: r.slot, src: r.src }));
      }
    }
  }
  return out;
}
// (8) the colour of slot `port` ('p12') of Pads module `key` (opts.project.pads): its pad's lit tone; null without the pad
function padColor(P, key, port) {
  const M = P && Array.isArray(P.pads) ? P.pads.find(m => isObj(m) && m.id === key) : null, p = M && Array.isArray(M.pads) ? M.pads[+String(port).slice(1)] : null;
  const c = isObj(p) && Number.isInteger(p.c) ? PAD_COLORS[p.c] : null;
  return c ? c.lit : null;
}
/** (8) A note cable's end on an instrument: '<dev>.' + NOTE_END — no jack there (review #13): cv-module's ports() places it on
 * the instrument module's left edge at BAR_H + JACK_Y (folded: outside the bar, as a jack). */
export const NOTE_END = '@notes';
// (8, IMPL-8 §9) the note cables of a v2 track: per Pads module of opts.project (one on every track's canvas) and per instrument
// of THIS track a visible pad plays — a note / chord / list target by the instrument's key zone (lo…hi), a drum target the
// track's first machine with that sound (pads-core drumNote on the device's record) —: {id: 'n:<pd>><dev>', kind: 'note', a:
// '<pd>.notes', b: '<dev>.' + NOTE_END, tap: 'pads' (a tap → onAction(id, 'tap'): the host lists its pads; never selected,
// no Disconnect), pads: [slots], mod, dev, color: the first such pad's}. Derived, never stored. Pure.
function noteCables(t, D, opts) {
  const P = isObj(opts) && isObj(opts.project) ? opts.project : null, out = [], own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  if (!P || !Array.isArray(P.pads) || !P.pads.length) return out;
  const syn = Object.keys(D).filter(k => isObj(D[k]) && D[k].kind === 'synth');
  const zone = k => { const z = isObj(D[k].zone) ? D[k].zone : {}, lo = fin(z.lo) ? z.lo : 0, hi = fin(z.hi) ? z.hi : 127; return [Math.min(lo, hi), Math.max(lo, hi)]; };
  // a drum machine plays a note only through its map (the record's, normalised as drum-core does)
  const dmap = new Map(), maps = k => { if (!dmap.has(k)) { const S = new Set(); if (own(PERS, D[k].model)) { const R = normDrum(D[k].drum, D[k].model); for (const v of Object.values(isObj(R.map) ? R.map : {})) if (Array.isArray(v)) for (const n of v) S.add(n); } dmap.set(k, own(PERS, D[k].model) ? S : null); } return dmap.get(k); };
  const plays = (k, ns) => { const [lo, hi] = zone(k), S = maps(k); return ns.some(n => n >= lo && n <= hi && (!S || S.has(n))); };
  for (const M of P.pads) {
    if (!isObj(M) || typeof M.id !== 'string' || !Array.isArray(M.pads) || !fin(M.rows) || !fin(M.cols)) continue;
    const by = new Map(); // instrument → the slots playing it
    for (const i of visibleSlots(M)) {
      const p = M.pads[i];
      if (!isObj(p) || !Array.isArray(p.t)) continue;
      const hit = new Set();
      for (const x of p.t) {
        if (!isObj(x) || x.tr !== t.id) continue;
        if (x.k === 'drum') { const r = drumNote(t, x.s); if (r.n >= 0 && r.dev) hit.add(r.dev); continue; }
        const ns = targetNotes(x);
        for (const k of syn) if (plays(k, ns)) hit.add(k);
      }
      for (const k of hit) { let L = by.get(k); if (!L) by.set(k, (L = [])); L.push(i); }
    }
    for (const k of syn) {
      const L = by.get(k);
      if (!L) continue;
      const c = PAD_COLORS[M.pads[L[0]].c];
      out.push({ id: 'n:' + M.id + '>' + k, kind: 'note', a: M.id + '.notes', b: k + '.' + NOTE_END, tap: 'pads', pads: L.slice(), mod: M.id, dev: k, color: c ? c.lit : undefined });
    }
  }
  return out;
}
// (2a) the last `L` world px of cablePath(x1, y1, x2, y2) as its own cubic (de Casteljau at the parameter where the arc
// length from the end reaches L; the arc sampled in 24 chords): {d, x, y} — x, y its start (the badge's place)
function tail(x1, y1, x2, y2, L) {
  const t0 = Math.max(TANGENT_MIN, Math.abs(x2 - x1) / 2), P = [x1, y1, x1 + t0, y1, x2 - t0, y2, x2, y2];
  const at = t => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t; return [a * P[0] + b * P[2] + c * P[4] + e * P[6], a * P[1] + b * P[3] + c * P[5] + e * P[7]]; };
  let t = 0, acc = 0, prev = at(1);
  for (let i = 23; i >= 0; i--) {
    const ti = i / 24, q = at(ti), d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    if (acc + d >= L) { t = ti + (1 / 24) * ((acc + d - L) / (d || 1)); break; }
    acc += d; prev = q;
  }
  const l = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const p0 = [P[0], P[1]], p1 = [P[2], P[3]], p2 = [P[4], P[5]], p3 = [P[6], P[7]];
  const a1 = l(p0, p1), b1 = l(p1, p2), c1 = l(p2, p3), a2 = l(a1, b1), b2 = l(b1, c1), s = l(a2, b2);
  return { d: `M ${r2(s[0])} ${r2(s[1])} C ${r2(b2[0])} ${r2(b2[1])}, ${r2(c1[0])} ${r2(c1[1])}, ${r2(p3[0])} ${r2(p3[1])}`, x: r2(s[0]), y: r2(s[1]) };
}

/** A Serum's own-FX route label: its non-empty racks and Direct, e.g. 'Main · Bus 1 · Direct' ('' for a classic track) —
 * (milestone 3) sx-edges routeLabel, re-exported (one table of the routes: the pasted STRIPS / routeOf are gone). */
export { routeLabel };

/**
 * The two SVG layers in `worldEl` and their paths (a visible path plus a wider transparent hit path per cable;
 * stroke widths calc(… * var(--ik)) from the cv-module CSS section). Read-only cables take no pointer events (CSS:
 * [data-ro]), so a press on one pans the camera like the empty canvas around it.
 * (1e) Editable cables (no readonly): a tap selects (.cv-sel; o.onSelect(id | null)) and shows a floating × at its
 * midpoint (button.cv-cable-x in worldEl: o.onAction(id, 'disconnect')); a long-press (wk.menuSource) or right-click opens
 * a wk menu (Disconnect, then o.menu(id)'s items); while one is selected Escape clears it and Delete / Backspace
 * disconnects it (document keydown, capture phase: consumed). A cable's dim (its source silent) → .cv-off (grey).
 * live(spec) draws the cable being patched in the upper layer; hide(id, on) fades the one being re-patched (.cv-lift).
 * (2a) Mod cables (kind 'mod'): g.cv-cable-g[data-kind="mod"] (+ .cv-preset, .cv-dash; bypassed → .cv-off) whose body is in
 * the under layer (no hit: CSS) and whose last END_PX screen px (o.k(): the world's zoom; rezoom() after a zoom) are a
 * twin g in the over layer; the amount badge button.cv-mbadge[data-cable] (+ span.cv-ptag "preset") in worldEl is the only
 * part taking a press: a tap selects (o.onSelect(id), again on a selected one: the inspector), long-press / right-click
 * the menu — unless the cable's OWN destination control lies beneath the badge (elementsFromPoint; its [data-dest] under the
 * [data-dev] — else data-cv-mod — of its b end): then the press AND the contextmenu are handed to that control (2b U1: a
 * long-press / right-click on a cabled knob always opens the KNOB's menu; the badge's own long-press never arms); over any
 * other control (an FX-look rack's next knob: MM UI fixer, review MM-2 P1-1) the badge keeps both. No floating × for them. setModsVisible('always' | 'select' | 'never'): On select shows the mod cables touching
 * the selection (highlight ids, the selected cable), Never none; Always all, and past MOD_FADE_N visible ones those not
 * touching the selection fade (.cv-fade) and o.onHint(MOD_HINT) runs once.
 * (review 2) A selection a pointer tap made calls o.onSelect(id, pointerType) (none otherwise): the tap's click is still to
 * come — what the host opens waits for it. A touch tap's own click never reaches the × that appeared under the finger.
 * (WC, IMPL-WC §4.1 / §4.4; lane C) Cords mode — o.cords(record) → true CLAIMS a record for the host's cord layer (a rig
 * canvas: its own connections; a stub — no b end — is never claimed): it gets NO path element (its group, without paths, sits in
 * the over layer and carries its label as a tag at its b end — a dry source's "dry"), and keeps everything else — its badge (a
 * claimed mod row's sits where the host's onRecords answer puts it — (fixer B2) on the cord just outside the knob's rim, off every
 * control and every other badge, centred: data-at "c" —, else END_PX screen px past the knob's rim, ports' b.r, toward the source:
 * data-to "l" / "r"; a per-note row's badge says NOTE_TAG, a rope cannot dash), the hidden-end tag, selection (o.cordSel(id | null)
 * mirrors it to the layer), the × (at the tap point, else o.cordPoint(id, 0.5), else the chord's middle), the menus, Escape / Delete.
 * tap(id, p, by): a tap on a claimed cord's body (the world's cord hook, through createCableDrag) — a line's tap. o.onRecords(records,
 * ports, k) after every set / layout / zoom (rezoom) and when the visibility changes: the claimed records shown (∿ Never: no mod
 * ones; On select: those touching the selection; past MOD_FADE_N a copy with fade: true) and the ports the host turns into the
 * layer's anchors; it may answer { badges: Map id → {x, y}, forks: Map jack → {x, y} } (world px: the claimed badges' and BAL's
 * places) and (the user, 2026-10-26: "a discreet number of how many outs on the socket") counts: Map jack → {x, y, n, to} — a jack
 * holding n ≥ 2 cords: a small span.cv-jn (its number, aria-hidden, no press) at (x, y), growing to its to side ('r' | 'l'), in the
 * world's skin (data-cv-skin copied: the top layer is outside #world); none answered: none shown. (fixer B2; review 2 P2-3) o.top() →
 * the layer above the cords (cv-cords top()): a claimed mod row's badge, a claimed cord's ×, a claimed fork's BAL, a count go there —
 * never under a rope — its --ik the world's (copied at each layout / zoom). A claimed mod
 * badge's drag is the knob end's (setBadgeDrag: createCableDrag's re-patch / pull) — never a pan. o.cords absent: today's DOM
 * byte for byte (W7).
 * @param {HTMLElement} worldEl  #world
 * @param {{doc?: Document, onSelect?: (id: string | null, by?: string) => void, onAction?: (id: string, action: string) => void,
 *   menu?: (id: string) => Array<object>, k?: () => number, onHint?: (text: string) => void, mods?: string,
 *   ignore?: (target: Element) => boolean, cords?: ((c: Cable) => boolean) | null,
 *   onRecords?: (records: Cable[], ports: Map<string, {x: number, y: number}> | null, k: number) => void | {badges?: Map<string, {x: number, y: number}>, forks?: Map<string, {x: number, y: number}>, counts?: Map<string, {x: number, y: number, n: number, to?: string}>},
 *   cordSel?: (id: string | null) => void, cordPoint?: (id: string, t: number) => {x: number, y: number} | null,
 *   top?: () => HTMLElement | null}} [o]  (top: the layer above the cords — the claimed badges, ×, BAL)
 *   ignore (U5): a press / key there is not "elsewhere" (the host's overlays)
 */
export function createCables(worldEl, o) {
  const O0 = o || {}, doc = O0.doc || (worldEl && worldEl.ownerDocument) || globalThis.document;
  const svg = (cls, z) => {
    const e = doc.createElementNS(SVG, 'svg');
    e.setAttribute('class', cls);
    e.setAttribute('aria-hidden', 'true');
    e.setAttribute('width', '0'); e.setAttribute('height', '0');
    e.style.zIndex = String(z);
    const g = doc.createElementNS(SVG, 'g');
    e.append(g);
    return { e, g, box: '' };
  };
  const U = svg('cv-cables', 0), O = svg('cv-cable-ends', 10000);
  if (worldEl) { worldEl.append(U.e); worldEl.append(O.e); }
  let list = [], ports = null, hl = null, sel = null, xb = null, press = null, keyOff = null, liveP = null, dead = false;
  let ghost = false; // (review 2 P1-1) a touch tap just selected: its compatibility click (no press of its own) may land on the × under the finger
  let tapBy; // (P1-5) the pointer type of the tap being handled: onSelect(id, tapBy) — the host acts after that tap's click
  let mode = MOD_MODES.includes(O0.mods) ? O0.mods : 'always', hinted = false;
  const items = new Map(); // id → {c, g, vis, hit, lab, d, lx, ly, mx, my, kd, mod, cord}; (2a) a mod cable: og (over twin), end, badge, amt, ptag; (3) htag; (WC) a claimed one: no paths, no twin, ntag, xp (the ×'s tap point)
  const forks = new Map(); // (milestone 3) a forked source's jack → its BALANCE badge {id, b, x, y, off}
  const nums = new Map(); // ((the user, 2026-10-26) a stacked jack → its count {e, x, y, n, to} (the host's counts)
  const isMod = it => !!it && !!it.mod;
  const kOf = () => { let k = 1; try { k = typeof O0.k === 'function' ? +O0.k() : 1; } catch (err) { k = 1; } return k > 0 && isFinite(k) ? k : 1; };
  let kNow = kOf();
  // a class on a cable's group and, for a mod cable, its over twin and badge
  const tog = (it, c, on) => { it.g.classList.toggle(c, on); if (it.og) it.og.classList.toggle(c, on); if (it.badge) it.badge.classList.toggle(c, on); };
  const node = (tag, cls) => { const e = doc.createElementNS(SVG, tag); if (cls) e.setAttribute('class', cls); return e; };
  const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
  const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
  const editable = id => { const it = items.get(id); return !!it && !it.c.readonly; };
  const drop = it => { it.g.remove(); if (it.og) it.og.remove(); if (it.badge) { it.bOff(); it.badge.remove(); } };
  // (WC) the host's cords predicate: a record it claims is drawn by the cord layer (never a stub: no b end to plug)
  const CL = typeof O0.cords === 'function' ? O0.cords : null;
  const claims = c => !!CL && c.b != null && !c.stub && !!call(CL, c);
  let recSig = null, inLay = false, bdrag = null, cordAt = null; // (WC) the last onRecords' visible set; inside layout (it reports once); the badge-drag handler; the cord-body test
  let took = null; // ((WC pre-deploy [badge-hold]) the pointer whose badge press became a drag, until its lift: its late long-press opens no menu
  // ((WC, fixer B2; review 2 P2-3) the layer above the cords (o.top: cv-cords top()) — what must never lie under a rope: a claimed mod row's
  // badge, a claimed cord's ×, a claimed fork's BAL; asked when one is first made (never on a canvas without them), its --ik the world's.
  // hostPl: the host places the claimed badges (onRecords' answer; else the rim rule)
  let topEl = null, topIk = null;
  const topOf = () => { if (!topEl && typeof O0.top === 'function') { const t = call(O0.top); if (t && typeof t.append === 'function') topEl = t; } return topEl; };
  const hostFor = cord => (cord ? topOf() || worldEl : worldEl);
  const hostPl = !!CL && typeof O0.onRecords === 'function';
  function syncTop() {
    if (!topEl || !worldEl || !worldEl.style || typeof worldEl.style.getPropertyValue !== 'function') return;
    const v = worldEl.style.getPropertyValue('--ik') || '';
    if (v === topIk) return;
    topIk = v;
    try { if (v) topEl.style.setProperty('--ik', v); else if (typeof topEl.style.removeProperty === 'function') topEl.style.removeProperty('--ik'); } catch (err) { /* inert */ }
  }
  // (2a) a mod cable's over-layer twin (its end) and its amount badge; (WC) a claimed one: the badge alone (+ its "last note" tag)
  function modParts(it) {
    if (!it.cord) {
      const og = node('g', 'cv-cable-g'), end = node('path', 'cv-cable cv-mend');
      og.append(end);
      O.g.append(og);
      Object.assign(it, { og, end });
    }
    const b = doc.createElement('button'), amt = doc.createElement('span'), ptag = doc.createElement('span'), htag = doc.createElement('span');
    b.className = 'cv-mbadge'; b.type = 'button';
    amt.className = 'cv-mamt'; ptag.className = 'cv-ptag'; ptag.hidden = true;
    htag.className = 'cv-htag'; htag.hidden = true; // ((3) a hidden knob's tag: 'OSC B · LEVEL · hidden')
    b.append(amt, ptag, htag);
    if (it.cord) { const ntag = doc.createElement('span'); ntag.className = 'cv-ntag'; ntag.hidden = true; b.append(ntag); b.setAttribute('data-cord', ''); it.ntag = ntag; }
    const id = () => it.c.id;
    // (U2) a knob beneath the badge wins: the press is handed to it (the badge's own stops here); (U4) else it is the
    // canvas's press (cv-module isBackground: a pan) and a tap — its lift followed on the document — selects
    // ((MM UI fixer, review MM-2 P1-1) only the cable's OWN destination: its [data-dest] under the [data-dev] (else the module's
    // data-cv-mod device) of its b end — an FX-look rack's badge lies over the NEXT knob, which must never take its tap / menu)
    const knob = e => {
      const n = beneath(doc, e.clientX, e.clientY, x => x === U.e || x === O.e);
      let q = n;
      for (; q && q !== worldEl && typeof q.getAttribute === 'function'; q = q.parentNode) if (q.getAttribute('data-dest') != null) break;
      if (!q || q === worldEl || typeof q.getAttribute !== 'function') return null;
      const dv = devUp(q);
      return dv && dv + ':' + q.getAttribute('data-dest') === it.c.b ? n : null;
    };
    // (2b U1) the menu too: a right-click's contextmenu on the badge goes to the control beneath as a synthetic one (its
    // own listeners open ITS menu: the control's, never the cable's); a touch press handed to the control arms the
    // control's long-press alone (stopImmediatePropagation: the badge's menuSource never sees it), so the browser's own
    // late contextmenu on the badge (Android) is dropped while that press is held
    let handed = null; // { pid, touch }: the press handed to a control beneath (cleared at its lift, wherever it lands)
    const lift = e => { if (handed && e.pointerId === handed.pid) handed = null; };
    const offs = [
      listen(doc, 'pointerup', lift, true), listen(doc, 'pointercancel', lift, true),
      listen(b, 'pointerdown', e => {
        handed = null;
        if (e.button != null && e.button !== 0) return;
        const k = knob(e);
        if (k) {
          const ev = new e.constructor(e.type, e);
          handed = { pid: e.pointerId, touch: e.pointerType === 'touch' };
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          if (!k.dispatchEvent(ev) && e.preventDefault) e.preventDefault();
          return;
        }
        press = { id: id(), pid: e.pointerId, x: e.clientX, y: e.clientY, ctx: false, moved: false, badge: true };
        // ((WC) a claimed row's badge is its knob end's handle: never the canvas's pan — past TAP_PX the drag takes it (setBadgeDrag))
        if (it.cord && bdrag && !it.c.readonly) { press.own = true; press.type = e.pointerType || 'mouse'; press.el = b; e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } }
      }),
      listen(b, 'click', e => { e.stopPropagation(); if (!(e.detail >= 1)) tapped(id(), true); }), // (Enter / Space / VoiceOver: a pointer's tap is the lift's)
      listen(b, 'contextmenu', e => {
        if (e.preventDefault) e.preventDefault();
        e.stopPropagation();
        if (handed && handed.touch && e.isTrusted) return; // (the control's long-press already opened its menu)
        if (took != null) return; // ((WC pre-deploy [badge-hold]) a drag took the press first: never the menu too)
        const k = knob(e);
        if (k) { k.dispatchEvent(ctxEv(e)); return; }
        if (press && press.moved) return; // (a pan's long-press timer: no menu)
        if (press) press.ctx = true;
        select(id()); openMenu(id(), e.clientX, e.clientY);
      }),
      wk.menuSource(b, { keys: false }),
    ];
    const H = hostFor(it.cord); // ((fixer B2) a claimed one: above the cords
    if (H) H.append(b);
    Object.assign(it, { badge: b, amt, ptag, htag, ed: '', bx: NaN, by: NaN, bOff: () => { for (const f of offs) f(); } });
  }
  function set(cables) {
    list = Array.isArray(cables) ? cables.filter(c => isObj(c) && typeof c.id === 'string') : [];
    // what each record is made as: mod or not, (WC) claimed or not — a change of either makes it again
    const want = new Map(list.map(c => [c.id, (c.kind === 'mod' ? 1 : 0) + (claims(c) ? 2 : 0)]));
    for (const [id, it] of items) if (!want.has(id) || want.get(id) !== it.kd) { drop(it); items.delete(id); } // (a kind change: made again)
    for (const c of list) {
      let it = items.get(c.id);
      if (!it) {
        const kd = want.get(c.id), g = node('g', 'cv-cable-g');
        if (kd >= 2) { g.setAttribute('data-cord', ''); O.g.append(g); it = { c, g, vis: null, hit: null }; } // ((WC) claimed: no path — its tag only, above the modules
        else { const hit = node('path', 'cv-cable-hit'), vis = node('path', 'cv-cable'); g.append(hit, vis); U.g.append(g); it = { c, g, vis, hit }; }
        Object.assign(it, { lab: null, d: '', lx: NaN, ly: NaN, mx: NaN, my: NaN, kd, mod: c.kind === 'mod', cord: kd >= 2, xp: null });
        items.set(c.id, it);
        if (c.kind === 'mod') modParts(it);
      }
      it.c = c;
      it.g.setAttribute('data-cable', c.id);
      it.g.setAttribute('data-kind', c.kind || 'audio');
      if (c.readonly) it.g.setAttribute('data-ro', ''); else it.g.removeAttribute('data-ro');
      // (milestone 3) a Serum's internal cable: its kind (audio / note / warp), a stub, a fork's branch
      for (const [k, v] of [['data-int', c.int], ['data-stub', c.stub ? '' : null], ['data-fork', c.fork ? '' : null], ['data-tap', c.tap]]) { if (v != null) it.g.setAttribute(k, v); else it.g.removeAttribute(k); }
      if (c.color) it.g.style.setProperty('--cc', c.color); else if (it.g.style.removeProperty) it.g.style.removeProperty('--cc');
      tog(it, 'cv-off', !!(c.dim || (it.mod && c.byp)));
      if (it.mod) {
        if (it.og) { it.og.setAttribute('data-cable', c.id); it.og.setAttribute('data-kind', 'mod'); }
        it.badge.setAttribute('data-cable', c.id);
        for (const n of [it.og, it.badge]) { if (!n) continue; if (c.color) n.style.setProperty('--cc', c.color); else if (n.style.removeProperty) n.style.removeProperty('--cc'); }
        tog(it, 'cv-preset', !!c.preset); tog(it, 'cv-dash', !!c.dashed);
        const t = c.badge || amtText(c.amt, c.bi);
        if (it.amt.textContent !== t) it.amt.textContent = t;
        it.ptag.hidden = !c.preset; text1(it.ptag, c.preset ? 'preset' : ''); // (the tag's text only on a preset row: the badge reads as its amount)
        if (it.ntag) { it.ntag.hidden = !c.dashed; text1(it.ntag, c.dashed ? NOTE_TAG : ''); } // ((WC) a rope cannot dash: a per-note row's badge says so)
        const L = 'Modulation ' + t + (c.preset ? ' (saved with the preset)' : '') + (c.byp ? ', bypassed' : '') + (it.ntag && c.dashed ? ', ' + NOTE_TAG : '') + ' — tap to edit';
        it.badge.setAttribute('aria-label', L); it.badge.title = L;
      }
      if (c.label) {
        if (!it.lab) { it.lab = node('text', 'cv-cable-lab'); it.lab.setAttribute('text-anchor', 'middle'); it.g.append(it.lab); }
        if (it.lab.textContent !== c.label) it.lab.textContent = c.label;
      } else if (it.lab) { it.lab.remove(); it.lab = null; }
    }
    // (milestone 3) one BALANCE badge per forked source jack (the first branch's id answers)
    const fk = new Map();
    for (const c of list) if (c.fork && c.kind !== 'mod' && !fk.has(c.a)) fk.set(c.a, c.id);
    for (const [a, F] of forks) if (fk.get(a) !== F.id) { F.off(); F.b.remove(); forks.delete(a); }
    for (const [a, id] of fk) if (!forks.has(a) && worldEl) forks.set(a, forkBtn(a, id));
    for (const F of forks.values()) { const it = items.get(F.id), H = hostFor(!!it && it.cord); if (H && F.b.parentNode !== H) H.append(F.b); } // ((fixer B2) a claimed fork's BAL above the cords
    paintHl();
    if (sel && !editable(sel)) select(null); // (disconnected, or now read-only)
    else if (sel) syncSel(); // ((WC) made again as a cord or a line: the layer's selection follows)
    if (ports) layout(ports);
    else { inLay = true; try { vis(); } finally { inLay = false; } records(true); } // ((WC) one onRecords)
  }
  // (milestone 3) a fork's BALANCE badge: a tap is onAction(id, 'balance') (the host opens the source's routing popover)
  function forkBtn(a, id) {
    const b = doc.createElement('button');
    b.className = 'cv-fork'; b.type = 'button'; b.textContent = 'BAL';
    b.setAttribute('aria-label', 'Filter balance of this source'); b.title = 'Filter balance — tap to set it';
    b.setAttribute('data-cable', id);
    const offs = [listen(b, 'pointerdown', e => e.stopPropagation()), listen(b, 'click', e => { e.stopPropagation(); act(id, 'balance'); })];
    worldEl.append(b);
    return { id, b, x: NaN, y: NaN, off: () => { for (const f of offs) f(); } };
  }
  // ports: Map | object 'mod.jack' → {x, y} (world px); (milestone 3) a knob end with hid: true is hidden from every mounted
  // view (its tag: the cable's badge)
  function layout(p) {
    ports = p || null;
    const at = k => (k == null || !ports ? null : typeof ports.get === 'function' ? ports.get(k) : ports[k]) || null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const hidN = new Map(); // ((P1-7) hidden ends: the badges at each end point, counted)
    for (const it of items.values()) {
      const A = at(it.c.a), B = it.c.stub ? (A ? { x: A.x + stubLen(kNow), y: A.y } : null) : at(it.c.b), show = !!(A && B && fin(A.x) && fin(A.y) && fin(B.x) && fin(B.y));
      it.g.style.display = show ? '' : 'none';
      if (it.og) it.og.style.display = show ? '' : 'none';
      if (!show) { it.mx = NaN; continue; }
      const rt = !it.cord && typeof O0.route === 'function' ? call(O0.route, it.c, A, B) : null; // ((WC, integration fixer L — P3-11) the host's routed line (a rig's upright wrap: wrapPath)
      it.rt = rt && typeof rt.d === 'string' && fin(rt.x) && fin(rt.y) ? rt : null;
      if (!it.cord) {
        const d = it.rt ? it.rt.d : cablePath(A.x, A.y, B.x, B.y);
        if (d !== it.d) { it.d = d; it.vis.setAttribute('d', d); it.hit.setAttribute('d', d); }
      } else { // ((WC) a cord: its ends moved → the ×'s tap point is no longer on it)
        const e = A.x + ',' + A.y + ',' + B.x + ',' + B.y;
        if (e !== it.d) { if (it.d) it.xp = null; it.d = e; }
      }
      if (it.mod) {
        const hid = !!B.hid, tg = hid ? String(B.tag || '') : '';
        tog(it, 'cv-hid', hid);
        if (it.htag.textContent !== tg) it.htag.textContent = tg;
        it.htag.hidden = !tg;
        if (hid) { const q = B.x + ',' + B.y; it.hn = hidN.get(q) || 0; hidN.set(q, it.hn + 1); } else it.hn = 0;
      }
      if (it.mod) { if (it.cord && hostPl) { it.A = A; it.B = B; } else ends(it, A, B); } // ((fixer B2) a claimed one: the host's place (records), else the rim rule
      // the cubic's midpoint (t = ½) is the chord's midpoint for these symmetric tangents: the label sits above it, the × on it;
      // ((WC) a cord's label is a tag above its b plug — a dry source's "dry" at the filter's IN)
      it.mx = it.rt ? r2(it.rt.x) : r2((A.x + B.x) / 2); it.my = it.rt ? r2(it.rt.y) : r2((A.y + B.y) / 2); // ((P3-11) a routed one: its gap run's middle
      if (it.lab) {
        const lx = it.cord ? r2(B.x) : it.mx, ly = it.cord ? r2(B.y - CORD_TAG_DY) : r2(it.my - 10);
        if (lx !== it.lx || ly !== it.ly) { it.lx = lx; it.ly = ly; it.lab.setAttribute('x', lx); it.lab.setAttribute('y', ly); }
      }
      x0 = Math.min(x0, A.x, B.x); y0 = Math.min(y0, A.y, B.y); x1 = Math.max(x1, A.x, B.x); y1 = Math.max(y1, A.y, B.y);
      if (it.rt && fin(it.rt.x0) && fin(it.rt.x1)) { x0 = Math.min(x0, it.rt.x0); x1 = Math.max(x1, it.rt.x1); }
    }
    for (const [a, F] of forks) { // (3) the BALANCE badge just right of the forked source's jack ((fixer B2) a claimed one: the host's place, records)
      const A = at(a), show = !!(A && fin(A.x) && fin(A.y));
      F.b.hidden = !show;
      if (show) forkAt(F, A.x + 22, A.y);
    }
    place(U, x0, y0, x1, y1);
    place(O, x0, y0, x1, y1);
    syncTop();
    placeX();
    inLay = true;
    try { vis(); } finally { inLay = false; }
    records(true);
  }
  // (2a) a mod cable's last END_PX screen px (the over layer) and its badge at their start (world px)
  // ((review 2 P1-7) a hidden knob's end — VOICE's corner —: its tagged badge at the end itself, right of it and above
  // (CSS .cv-hid), the n-th one at that end HID_STEP screen px higher: never left of the end, where FILTER 1's bar stands)
  // ((WC) a claimed row — a rope, no tail — the host does not place: END_PX screen px past the knob's rim (ports' B.r, the knob's radius)
  // on the line to its source, placed once a relayout (never per frame); data-to says which side of the tip it sits (CSS: the badge
  // grows away from it))
  function ends(it, A, B) {
    let bx, by;
    if (it.og) {
      const T = tail(A.x, A.y, B.x, B.y, END_PX / kNow);
      if (T.d !== it.ed) { it.ed = T.d; it.end.setAttribute('d', T.d); }
      bx = B.hid ? B.x : T.x; by = B.hid ? r2(B.y - (it.hn || 0) * HID_STEP / kNow) : T.y;
    } else if (B.hid) { bx = B.x; by = r2(B.y - (it.hn || 0) * HID_STEP / kNow); }
    else {
      const dx = A.x - B.x, dy = A.y - B.y, L = Math.hypot(dx, dy) || 1, R = (fin(B.r) && B.r > 0 ? B.r : 0) + END_PX / kNow, to = dx > 0 ? 'r' : 'l';
      bx = r2(B.x + dx / L * R); by = r2(B.y + dy / L * R);
      if (it.badge.getAttribute('data-to') !== to) it.badge.setAttribute('data-to', to);
    }
    if (it.cord && it.badge.hasAttribute('data-at')) it.badge.removeAttribute('data-at');
    if (bx !== it.bx || by !== it.by) { it.bx = bx; it.by = by; it.badge.style.left = bx + 'px'; it.badge.style.top = by + 'px'; }
  }
  // ((WC, fixer B2) a claimed mod row's badge at the host's place (world px), centred on it (data-at "c"; no data-to)
  function badgeAt(it, x, y) {
    const bx = r2(x), by = r2(y);
    if (it.badge.getAttribute('data-at') !== 'c') it.badge.setAttribute('data-at', 'c');
    if (it.badge.hasAttribute('data-to')) it.badge.removeAttribute('data-to');
    if (bx !== it.bx || by !== it.by) { it.bx = bx; it.by = by; it.badge.style.left = bx + 'px'; it.badge.style.top = by + 'px'; }
  }
  // a fork's BAL at (x, y) — its left edge there (CSS) — unless the host placed it (a claimed fork: F.hp)
  function forkAt(F, x, y) {
    if (F.hp) return;
    const fx = r2(x), fy = y;
    if (fx !== F.x || fy !== F.y) { F.x = fx; F.y = fy; F.b.style.left = fx + 'px'; F.b.style.top = fy + 'px'; }
  }
  // (2a) after a zoom: the ends are END_PX screen px again (nothing else moves); ((fixer B2) the claimed badges: the host's places at
  // the new zoom — records asked again; the layer above the cords takes the world's --ik)
  function rezoom() {
    const k = kOf();
    syncTop();
    if (k === kNow) return false;
    const re = stubLen(k) !== stubLen(kNow);
    kNow = k;
    if (re && [...items.values()].some(it => it.c.stub)) { layout(ports); return true; } // ((3) P1-5: a stub's length follows the zoom below 1)
    const at = q => (!ports ? null : typeof ports.get === 'function' ? ports.get(q) : ports[q]) || null;
    let cl = false;
    for (const it of items.values()) {
      if (it.cord) cl = true;
      if (it.mod && fin(it.mx) && !(it.cord && hostPl)) { const A = at(it.c.a), B = at(it.c.b); if (A && B) ends(it, A, B); }
    }
    if (cl && hostPl) records(true);
    return true;
  }
  // (2a) the mod cables' visibility (setModsVisible) and the MOD_FADE_N+ fade; the badge follows its cable
  const touching = id => id === sel || (!!hl && hl.has(id));
  function vis() {
    const M = [...items.values()].filter(isMod);
    const many = mode === 'always' && M.filter(it => fin(it.mx)).length > MOD_FADE_N;
    for (const it of M) {
      const t = touching(it.c.id), hide = mode === 'never' || (mode === 'select' && !t);
      tog(it, 'cv-hide', hide);
      tog(it, 'cv-fade', many && !t);
      it.badge.hidden = hide || !fin(it.mx);
      it.hide = hide; it.fade = many && !t; // ((WC) a claimed one's: the records the layer gets)
    }
    if (many && !hinted) { hinted = true; if (typeof O0.onHint === 'function') { try { O0.onHint(MOD_HINT); } catch (err) { console.error(err); } } }
    if (!inLay) records(false);
  }
  // (WC) o.onRecords(records, ports): the claimed records the visibility shows (a faded one a copy with fade: true) — after each set /
  // layout (force), and from vis() when that set changed (a selection, a highlight, the ∿ mode)
  function records(force) {
    if (typeof O0.onRecords !== 'function' || !CL) return;
    const out = [];
    let sig = '';
    for (const it of items.values()) {
      if (!it.cord || (it.mod && it.hide)) continue;
      const f = !!(it.mod && it.fade);
      out.push(f ? Object.assign({}, it.c, { fade: true }) : it.c);
      sig += it.c.id + (f ? '~|' : '|');
    }
    if (!force && sig === recSig) return;
    recSig = sig;
    places(call(O0.onRecords, out, ports, kNow));
  }
  // ((WC, fixer B2) the host's answer: { badges, forks } (Maps or objects, world px) — a claimed mod row's badge at its place, else the rim
  // rule (ends, from its last layout's ends); a claimed fork's BAL at its place, else beside its jack as a line's)
  function places(R) {
    const get = (M, k) => (!M || typeof M !== 'object' ? null : typeof M.get === 'function' ? M.get(k) : M[k]) || null;
    const B = R && typeof R === 'object' ? R.badges : null, F = R && typeof R === 'object' ? R.forks : null, EN = R && typeof R === 'object' ? R.ends : null;
    for (const it of items.values()) { // ((fixer K, review P3-6) a claimed cord's tag ("dry") above its own plug (the user, 2026-10-26: a stack's on its jack)
      if (!it.cord || !it.lab) continue;
      const q = get(EN, it.c.id), b = q && q.b;
      if (!b || !fin(b.x) || !fin(b.y)) continue;
      const lx = r2(b.x), ly = r2(b.y - CORD_TAG_DY);
      if (lx !== it.lx || ly !== it.ly) { it.lx = lx; it.ly = ly; it.lab.setAttribute('x', lx); it.lab.setAttribute('y', ly); }
    }
    for (const it of items.values()) {
      if (!it.cord || !it.mod || !it.badge || !fin(it.mx)) continue;
      const q = get(B, it.c.id);
      if (q && fin(q.x) && fin(q.y) && !(it.B && it.B.hid)) badgeAt(it, q.x, q.y);
      else if (it.A && it.B) ends(it, it.A, it.B);
    }
    for (const [a, Fb] of forks) {
      const it = items.get(Fb.id), q = it && it.cord ? get(F, a) : null;
      if (q && fin(q.x) && fin(q.y)) { Fb.hp = false; forkAt(Fb, q.x, q.y); Fb.hp = true; } else if (Fb.hp) { Fb.hp = false; const A = ports ? (typeof ports.get === 'function' ? ports.get(a) : ports[a]) : null; if (A && fin(A.x)) forkAt(Fb, A.x + 22, A.y); }
    }
    counted(R && typeof R === 'object' ? R.counts : null);
  }
  // ((the user, 2026-10-26: "on a socket with multiple outs lets just put a discreet number of how many outs on the socket") the host's
  // counts (Map | object: jack → {x, y, n, to}, world px): a span.cv-jn each in the layer above the cords (made / moved / renumbered only
  // when they change), the world's skin on it; the rest removed — no answer (lines mode, another canvas): none
  function counted(N) {
    const want = new Map(), H = N && typeof N === 'object' ? topOf() : null;
    if (H) for (const [j, q] of typeof N.entries === 'function' && typeof N.get === 'function' ? N.entries() : Object.entries(N)) if (q && fin(q.x) && fin(q.y) && q.n >= 2) want.set(String(j), q);
    for (const [j, M] of nums) if (!want.has(j)) { M.e.remove(); nums.delete(j); }
    if (!want.size) return;
    const sk = worldEl && typeof worldEl.getAttribute === 'function' ? worldEl.getAttribute('data-cv-skin') : null;
    for (const [j, q] of want) {
      let M = nums.get(j);
      if (!M) {
        const e = doc.createElement('span');
        e.className = 'cv-jn';
        e.setAttribute('aria-hidden', 'true'); e.setAttribute('data-of', j);
        M = { e, x: NaN, y: NaN, n: 0, to: '' };
        nums.set(j, M);
      }
      if (M.e.parentNode !== H) H.append(M.e);
      if (sk) { if (M.e.getAttribute('data-cv-skin') !== sk) M.e.setAttribute('data-cv-skin', sk); } else if (M.e.hasAttribute('data-cv-skin')) M.e.removeAttribute('data-cv-skin');
      const n = Math.floor(q.n), to = q.to === 'l' ? 'l' : 'r', x = r2(q.x), y = r2(q.y);
      if (n !== M.n) { M.n = n; M.e.textContent = String(n); }
      if (to !== M.to) { M.to = to; M.e.setAttribute('data-to', to); }
      if (x !== M.x || y !== M.y) { M.x = x; M.y = y; M.e.style.left = x + 'px'; M.e.style.top = y + 'px'; }
    }
  }
  function setModsVisible(m) {
    if (!MOD_MODES.includes(m)) return mode;
    mode = m;
    if (sel && mode === 'never' && isMod(items.get(sel))) select(null);
    vis();
    return mode;
  }
  function place(L, x0, y0, x1, y1) {
    const ok = x1 >= x0 && y1 >= y0;
    const x = ok ? Math.floor(x0 - PAD) : 0, y = ok ? Math.floor(y0 - PAD) : 0;
    const w = ok ? Math.ceil(x1 + PAD) - x : 0, h = ok ? Math.ceil(y1 + PAD) - y : 0, key = x + ',' + y + ',' + w + ',' + h;
    if (key === L.box) return;
    L.box = key;
    L.e.style.left = x + 'px'; L.e.style.top = y + 'px';
    L.e.setAttribute('width', String(w)); L.e.setAttribute('height', String(h));
    L.g.setAttribute('transform', `translate(${-x} ${-y})`);
  }
  function paintHl() {
    for (const [id, it] of items) {
      const on = !!hl && hl.has(id);
      tog(it, 'cv-hl', on);
      tog(it, 'cv-dim', !!hl && !on);
    }
  }
  /* ---- (1e) selection, the floating ×, the menu */
  const act = (id, a) => { if (id && typeof O0.onAction === 'function') O0.onAction(id, a); };
  // ((WC) a claimed cable's ×: at the tap point, else on its drawn rope's middle (o.cordPoint), else the chord's middle)
  const xAt = it => {
    if (!it.cord) return { x: it.mx, y: it.my };
    if (it.xp) return it.xp;
    const q = call(O0.cordPoint, it.c.id, 0.5);
    return q && fin(q.x) && fin(q.y) ? { x: r2(q.x), y: r2(q.y) } : { x: it.mx, y: it.my };
  };
  function placeX() {
    const it = sel ? items.get(sel) : null;
    if (!xb) return;
    const show = !!it && !isMod(it) && fin(it.mx) && fin(it.my); // (a mod cable: its badge and the inspector, no ×)
    xb.hidden = !show;
    if (show) { const H = hostFor(it.cord); if (H && xb.parentNode !== H) H.append(xb); const p = xAt(it); xb.style.left = p.x + 'px'; xb.style.top = p.y + 'px'; } // ((fixer B2) a cord's ×: above the cords
  }
  // ((WC) the selection's class on a cable made again, and the cord layer's outline: the claimed selected one's id, else none)
  function syncSel() {
    const it = sel ? items.get(sel) : null;
    if (it) tog(it, 'cv-sel', true);
    if (CL) call(O0.cordSel, it && it.cord ? sel : null);
  }
  function select(id) {
    const want = id && editable(id) && !items.get(id).c.tap ? id : null; // ((3) a tap cable — a warp source — is never selected)
    if (want === sel) return;
    if (sel && items.get(sel)) { tog(items.get(sel), 'cv-sel', false); items.get(sel).xp = null; }
    sel = want;
    syncSel();
    if (sel) {
      tog(items.get(sel), 'cv-sel', true);
      if (!xb && worldEl) {
        xb = doc.createElement('button');
        xb.className = 'cv-cable-x'; xb.type = 'button'; xb.textContent = '×';
        xb.setAttribute('aria-label', 'Disconnect cable'); xb.title = 'Disconnect (Delete)';
        xb.addEventListener('pointerdown', e => e.stopPropagation()); // (never the world's press)
        xb.addEventListener('click', e => { e.stopPropagation(); if (ghost) { ghost = false; return; } act(sel, 'disconnect'); }); // (the selecting tap's click: dropped)
        worldEl.append(xb);
      }
      if (!keyOff) {
        // a tap anywhere else (the canvas, a module, a tray) clears it: document capture phase, so nothing can swallow it
        let tp = null;
        const offK = listen(doc, 'keydown', onKey, true);
        const offD = listen(doc, 'pointerdown', e => { const t = e.target; tp = cableAt(t) || (xb && xb.contains(t)) || aside(t) || (cordAt && call(cordAt, e)) ? null : { pid: e.pointerId, x: e.clientX, y: e.clientY }; }, true); // ((WC) a cord's body: no "elsewhere")
        const offU = listen(doc, 'pointerup', e => { const P = tp; tp = null; if (P && e.pointerId === P.pid && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= TAP_PX) select(null); }, true);
        keyOff = () => { offK(); offD(); offU(); };
      }
    } else if (keyOff) { keyOff(); keyOff = null; }
    placeX();
    vis();
    if (typeof O0.onSelect === 'function') O0.onSelect(sel, tapBy);
  }
  // (U4) a tap on a badge: selects it; on the selected one, onSelect again (the host's inspector)
  // ((3) a tap cable — a Serum's warp / pitch source — answers onAction(id, 'tap'): the host opens the oscillator's menu)
  function tapped(id, again) {
    const it = items.get(id);
    if (it && it.c.tap) { act(id, 'tap'); return; }
    if (again && id === sel) { if (typeof O0.onSelect === 'function') O0.onSelect(sel, tapBy); } else select(id);
  }
  const typing = t => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable === true);
  // (U5, U6) what edits the selected cable is not "elsewhere": the inspector (.cv-ml-pop), any dialog, a wk popup list,
  // o.ignore(t) — a tap there keeps the selection, its keys are its own
  const POP = /(^|\s)(cv-ml-pop|wk-pop|wk-ctx)(\s|$)/;
  function aside(t) {
    for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (POP.test(n.getAttribute('class') || '') || n.getAttribute('role') === 'dialog') return true;
    try { return typeof O0.ignore === 'function' && !!O0.ignore(t); } catch (err) { return false; }
  }
  function onKey(e) { // while a cable is selected: Escape clears it, Delete / Backspace disconnects it (one thing per key)
    if (!sel || aside(e.target)) return;
    if (e.key === 'Escape') select(null);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing(e.target)) act(sel, 'disconnect');
    else return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }
  function openMenu(id, x, y) {
    const extra = typeof O0.menu === 'function' ? O0.menu(id) || [] : [];
    const it = items.get(id);
    if (it && it.c.tap) return wk.contextMenu(x, y, extra.length ? extra : [{ label: 'Open…', action: () => act(id, 'tap') }]); // ((3) read-only: no Disconnect)
    const L = [{ label: 'Disconnect', action: () => act(id, 'disconnect') }];
    if (extra.length) L.push({ sep: true }, ...extra);
    return wk.contextMenu(x, y, L);
  }
  const cableAt = t => { // (2a: a mod cable's badge too — it sits in worldEl)
    for (let n = t; n && n !== U.e && n !== worldEl && typeof n.getAttribute === 'function'; n = n.parentNode) {
      const id = n.getAttribute('data-cable');
      if (id != null) return editable(id) ? id : null;
    }
    return null;
  };
  // (U13) a press on a cable is the canvas's pan (cv-module isBackground: the world captures the pointer) unless it is a
  // tap: no capture here, its moves and lift followed on the document (capture phase: retargeted to the viewport too)
  const offs = [
    listen(U.e, 'pointerdown', e => {
      const id = cableAt(e.target);
      if (!id || (e.button != null && e.button !== 0)) return;
      press = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, ctx: false, moved: false };
    }),
    listen(doc, 'pointerdown', () => { ghost = false; }, true), // (P1-1: a new press — the × answers its click)
    listen(doc, 'pointermove', e => {
      if (!press || e.pointerId !== press.pid || Math.hypot(e.clientX - press.x, e.clientY - press.y) <= TAP_PX) return;
      press.moved = true;
      // ((WC) a claimed badge dragged: the knob end's drag — (pre-deploy [badge-hold]) never after its long-press opened the menu (the menu
      // ends the gesture, as the jack's "Which cord?"); once it runs, the long-press still pending opens nothing (took)
      if (press.own) { if (press.ctx) return; const P = press; press = null; took = P.pid; if (!bdrag || !call(bdrag, P.id, e, P)) { try { P.el.releasePointerCapture(P.pid); } catch (err) { /* released */ } } }
    }, { capture: true, passive: true }),
    listen(doc, 'pointerup', e => {
      if (took === e.pointerId) took = null;
      const P = press;
      if (!P || e.pointerId !== P.pid) return;
      press = null;
      if (P.own) { try { P.el.releasePointerCapture(P.pid); } catch (err) { /* released */ } }
      if (!P.ctx && !P.moved && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= TAP_PX) {
        ghost = e.pointerType === 'touch' || e.pointerType === 'pen';
        tapBy = String(e.pointerType || 'mouse');
        try { tapped(P.id, P.badge); } finally { tapBy = undefined; }
      }
    }, true),
    listen(doc, 'pointercancel', e => { if (took === e.pointerId) took = null; if (press && e.pointerId === press.pid) { if (press.own) { try { press.el.releasePointerCapture(press.pid); } catch (err) { /* released */ } } press = null; } }, true),
    listen(U.e, 'contextmenu', e => { // right-click, a touch long-press (wk.menuSource)
      if (press && press.moved) { if (e.preventDefault) e.preventDefault(); return; } // (a pan's long-press timer: no menu)
      const id = cableAt(e.target) || (press && press.id);
      if (!id) return;
      if (e.preventDefault) e.preventDefault();
      if (press) press.ctx = true;
      select(id);
      openMenu(id, e.clientX, e.clientY);
    }),
  ];
  const menuOff = wk.menuSource(U.e, { keys: false });
  function hide(id, on) { const it = items.get(id); if (it) it.g.classList.toggle('cv-lift', !!on); }
  // the cable being patched (world px; always out → in), drawn above the modules; null removes it
  function live(sp) {
    if (!sp || ![sp.x1, sp.y1, sp.x2, sp.y2].every(fin)) { if (liveP) { liveP.remove(); liveP = null; } return; }
    if (!liveP) { liveP = node('path', 'cv-cable cv-cable-live'); O.g.append(liveP); }
    liveP.setAttribute('d', cablePath(sp.x1, sp.y1, sp.x2, sp.y2));
    if (sp.color) liveP.style.setProperty('--cc', sp.color);
    liveP.setAttribute('class', 'cv-cable cv-cable-live' + (sp.mod ? ' cv-mlive' : '') + (sp.snap ? ' cv-snap' : '')); // (2a) sp.mod: the mod look
  }
  return {
    under: U.e, over: O.e,
    set,
    layout,
    highlight(ids) { hl = Array.isArray(ids) ? new Set(ids) : null; paintHl(); vis(); },
    /** (addition) the current cables and the box of the under layer 'x,y,w,h' — for tests and the world's fit */
    list: () => list.slice(),
    box: () => U.box,
    /** (1e) select an editable cable (null clears); the selected id; Escape for a caller's chain → was one selected */
    select, selected: () => sel,
    escape: () => { if (!sel) return false; select(null); return true; },
    openMenu, hide, live,
    /** (2a) the mod cables' visibility: 'always' | 'select' | 'never' (anything else: unchanged) → the mode; rezoom() after a
     * zoom (o.k changed: the ends cut again) → whether it changed; badge(id): a mod cable's badge (the inspector's anchor) */
    setModsVisible, modsVisible: () => mode, rezoom, badge: id => { const it = items.get(id); return it && it.badge ? it.badge : null; },
    /** (milestone 3) a forked source's BALANCE badge by its jack ('i1/oscB.out'), null without one */
    forkBadge: a => { const F = forks.get(a); return F ? F.b : null; },
    /** ((the user, 2026-10-26) a stacked jack's count by its jack ('i1/lfo1.out'): its span.cv-jn, null without one */
    count: a => { const M = nums.get(a); return M ? M.e : null; },
    /** (WC) is cable `id` claimed by the cords predicate (drawn by the cord layer)? The claimed records, in the list's order (all of
     * them, whatever the visibility shows: the drag's "the most recent cord at this input") */
    claimed: id => { const it = items.get(id); return !!it && !!it.cord; },
    cordList: () => list.filter(c => { const it = items.get(c.id); return !!it && it.cord; }),
    /** (WC, §4.4) a tap on claimed cable `id`'s body at world point p (the world's cord hook): a line's tap — an editable one selected
     * (its × at p; again: onSelect again — a mod row's inspector), a tap cable's onAction(id, 'tap'); by: the pointer type (the
     * host's afterTap). → whether it was claimed */
    tap(id, p, by) {
      const it = dead ? null : items.get(id);
      if (!it || !it.cord) return false;
      it.xp = p && fin(p.x) && fin(p.y) ? { x: r2(p.x), y: r2(p.y) } : null;
      ghost = by === 'touch' || by === 'pen';
      tapBy = by ? String(by) : undefined;
      try { tapped(id, it.mod); } finally { tapBy = undefined; }
      if (sel === id) placeX(); // (already selected: the × to the new tap point)
      return true;
    },
    /** (WC) the claimed badges' drag: fn(id, pointermove event, {pid, x, y, type, el}) → truthy when it took the press (createCableDrag's
     * knob-end re-patch / pull); null removes it. Returns a remover */
    setBadgeDrag(fn) { const f = typeof fn === 'function' ? fn : null; bdrag = f; return () => { if (bdrag === f) bdrag = null; }; },
    /** (WC) fn(pointer event) → the claimed cord whose body lies under it (createCableDrag: the world's cord hit), or null: a press
     * there is no tap "elsewhere" (the selection stays; the world's tap then answers through tap()). Returns a remover */
    setCordAt(fn) { const f = typeof fn === 'function' ? fn : null; cordAt = f; return () => { if (cordAt === f) cordAt = null; }; },
    destroy() {
      if (dead) return;
      dead = true;
      if (keyOff) keyOff();
      keyOff = null; sel = null;
      for (const f of offs) f();
      menuOff();
      if (xb) xb.remove();
      if (liveP) liveP.remove();
      for (const it of items.values()) if (it.badge) { it.bOff(); it.badge.remove(); }
      for (const F of forks.values()) { F.off(); F.b.remove(); }
      forks.clear();
      for (const M of nums.values()) M.e.remove();
      nums.clear();
      U.e.remove(); O.e.remove(); items.clear(); list = []; ports = null;
    },
  };
}

/**
 * (1e) Patching from the jacks (SPEC §2.9, §4.1, §4.6): installed as the world's jack hook (cv-world setJackHook), so a
 * press on a [data-cv-jack] is never a pan and a second finger cancels it. Jacks are canvas ids ('i1.out', 'fx1.in',
 * 'i2/fx.out'); o.port maps one to its model port (cv-cables jackPort; null = not patchable: the press is not taken).
 *   A press on an out, or on a free in: a new cable; a press on an in that a cable arrives at: that cable's end lifts off
 *   (re-patch — its source stays); past TAP_PX (screen) the live bézier follows (edge auto-pan: world.dragPointer;
 *   re-projected on camera frames), compatible jacks get .cv-ok, the others .cv-no with the reason as their title, the
 *   fixed one .cv-from; within SNAP_PX of a compatible jack the end snaps to it (.cv-hot), over a module body its first
 *   compatible jack is the target. Release on a target: o.onConnect(outPort, inPort) / o.onRepatch(wireId, outPort,
 *   inPort) (callbacks get model ports); elsewhere nothing (a lifted end goes back: Disconnect is the cable's ×; near an
 *   incompatible jack: o.onRefuse(a, b, why)). A tap, Enter / Space or a right-click on a jack opens "Connect to…"
 *   (o.onDisconnect(wireId) adds Disconnect items). Escape, a pointercancel, a second finger (the world) cancel.
 * (2a) A press on a mod-out jack ([data-kind="mod"]; patchable whatever o.port says) drags a mod cable onto a KNOB: under
 *   the pointer (o.hit(x, y), default document.elementFromPoint) closest [data-dest] → closest [data-dev] (else its
 *   module's device) → dst '<dev>:<param>', checked by o.canMod(src, dst) (default o.canConnect; [data-nomod] refused)
 *   with src = modSrcOf(jack) ('wheel' | '<dev>.out'). While dragging #world has [data-cv-patching="mod"], the knobs
 *   o.markDests(src) names ([{dev, ids}] | ['<dev>:<param>'] | (dev, id) → bool) carry .cv-ok, the modules without one
 *   .cv-nodest (CSS dims the rest), every jack .cv-no (audio jacks are never its targets, nor mod jacks an audio drag's);
 *   the knob under the pointer .cv-hot (refused: .cv-no), a module's top bar .cv-hot. Release on an accepted knob:
 *   o.onMod(src, dst) (default o.onConnect); on a refused one o.onRefuse(src, dst, why); on a module's top bar
 *   o.onBarDrop(src, key); a tap, Enter / Space or a right-click on the jack: o.onJackTap(src, jackEl). Two fingers,
 *   Escape, a pointercancel cancel as for audio cables; the live bézier has the mod look (live({mod: true})).
 * (9, IMPL-9 §4.4, D9) A press on a patch cord's jack ([data-kind="cord"], whatever its data-ro) is the host's: o.cordPress(e,
 *   jackEl) → false | {cancel} (cv-patch's plug drag); an audio / mod drag never marks a cord jack, its keys and right-click are
 *   cv-patch's too.
 * (WC, IMPL-WC §4.4; lane C) Cords mode — o.live (the cord layer's live(spec)) given: a rig's jacks are cord jacks with a
 *   role (cv-module data-cord: audio / note / mod / warp); a press o.cordPress leaves (it answers the 900 Series' only) is this
 *   drag's, by the rules of the skeptic's P1-3: an OUTPUT always starts a NEW cord (the rope in the finger: o.live({a: the jack, b:
 *   the finger, c, s, o}) — o.cordLook(jack) → {c, s, o}, default cream, a mod output's tip); an INPUT holding claimed cords GRABS
 *   THE MOST RECENT (the last at it in the list's order: o.grab — the layer or () => it, its grab / move / drop — its b end in the
 *   finger), a touch long-press on one holding several offers "Which cord?" (the list by source: a pick selects it and opens its
 *   menu); a free input a new cord backwards. The target: the jack under the finger decides first (its hit circle, cv-patch's
 *   rule), else the nearest compatible within SNAP_PX, else a module body's first; the chip (#overlay .cv-plugchip) names it or
 *   the refusal. Release: a new cord → o.onConnect(outPort, inPort); a grabbed one on another compatible input →
 *   o.onRepatch(id, outPort, inPort), back on its own jack or its source → nothing, AWAY FROM ANY JACK → o.onPull(id) (the host:
 *   "Cord pulled · tap to undo"), near a refused jack → o.onRefuse; a second finger / Escape → it springs back. A mod output's
 *   rope lands on a knob (as the mod drag: o.onMod) or on a compatible cord input (an Envelope onto the Amplifier's LEVEL:
 *   o.onConnect). A WARP jack is a target only. A tap / Enter / Space / right-click on a cord jack → o.jackMenu(jack, el, x, y)
 *   (the host's Connect to… / plug menu, rig-ui's), else a mod output's o.onJackTap, else "Connect to…" with Pull items. A claimed
 *   mod row's BADGE dragged (cv-cables setBadgeDrag) grabs its knob-end tip: onto another accepted knob → o.onRepatchMod(id, dst),
 *   away from any knob → o.onPull(id), onto its own / a refused one → nothing. o.cordHit(p, r, ok) (the layer's hit) given: the
 *   world's cord hook (setCordHook) — a tap on a claimed cord's body is the cables' tap(id, p) — and the cables' "not elsewhere"
 *   test. Without o.live nothing of this runs: today's drags byte for byte.
 * @param {object} world  cv-world World (toClient, toWorld, dragPointer, on, setJackHook, el; (WC) setCordHook, overlay, k)
 * @param {{
 *   ports: () => Map<string, {x: number, y: number}>,
 *   jacks?: () => Array<{id: string, el?: Element, dir?: 'in' | 'out', mod?: string, label?: string}>,
 *   rects?: () => Object<string, {x: number, y: number, w: number, h: number}>,
 *   port?: (jack: string) => string | null,
 *   wires?: () => Array<{wire: string, a: string, b: string}>,
 *   canConnect: (a: string, b: string) => {ok: boolean, why?: string},
 *   onConnect: (a: string, b: string) => void, onRepatch: (wireId: string, a: string, b: string) => void,
 *   onDisconnect?: (wireId: string) => void, onRefuse?: (a: string, b: string, why: string) => void,
 *   cables?: object, label?: (jack: string) => string, color?: string | (() => string), doc?: Document,
 *   canMod?: (src: string, dst: string) => {ok: boolean, why?: string}, onMod?: (src: string, dst: string) => void,
 *   markDests?: (src: string) => Array<{dev: string, ids: string[]} | string> | ((dev: string, id: string) => boolean),
 *   onBarDrop?: (src: string, key: string) => void, onJackTap?: (src: string, jackEl: Element) => void,
 *   hit?: (x: number, y: number) => Element | null, cordPress?: (e: PointerEvent, jackEl: Element) => false | {cancel: () => void},
 *   live?: (spec: object | null) => void, grab?: object | (() => object), cordLook?: (jack: string) => {c?: number, s?: number, o?: number},
 *   onPull?: (id: string) => void, onRepatchMod?: (id: string, dst: string) => void,
 *   jackMenu?: (jack: string, el: Element, x?: number, y?: number) => any, cordHit?: (p: {x: number, y: number}, r: number, ok: Function) => string | null,
 *   later?: (f: Function, ms: number) => any, unlater?: (id: any) => void,
 * }} o
 * @returns {{press: (e: PointerEvent, jackEl: Element) => false | {cancel: () => void},
 *   menu: (jack: string, x?: number, y?: number) => object | null, cancel: () => void, active: () => boolean, destroy: () => void}}
 */
export function createCableDrag(world, o) {
  const W = world || null, Op = o || {};
  const doc = Op.doc || (W && W.el && W.el.ownerDocument) || globalThis.document;
  const own = Op.cables ? null : W && W.el ? createCables(W.el, { doc }) : null, C = Op.cables || own;
  const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
  const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
  const portOf = j => (typeof Op.port === 'function' ? call(Op.port, j) || null : j || null);
  // (U12) a read-only jack (data-ro: inside a Serum) takes no press and opens no menu, whatever its model port; it stays a
  // drop target (its own FX input stands for the Serum: an output dropped there meets the own-FX refusal and its fix)
  const ro = el => !!el && typeof el.hasAttribute === 'function' && el.hasAttribute('data-ro');
  const dirOf = j => (/\.in$/.test(j) ? 'in' : /\.out$/.test(j) ? 'out' : null);
  // ((3) a jack element's own direction — cv-module data-dir: VOICE's main / direct / note are inputs — else by its id)
  const dirEl = (j, el) => { const d = el && typeof el.getAttribute === 'function' ? el.getAttribute('data-dir') : null; return d === 'in' || d === 'out' ? d : dirOf(j || ''); };
  const modOf = j => j.slice(0, j.lastIndexOf('.'));
  const at = (p, k) => (p && (typeof p.get === 'function' ? p.get(k) : p[k])) || null;
  const toClient = (x, y) => (W && typeof W.toClient === 'function' ? W.toClient(x, y) : { x, y });
  const toWorld = (x, y) => (W && typeof W.toWorld === 'function' ? W.toWorld(x, y) : { x, y });
  const isModJack = el => !!el && typeof el.getAttribute === 'function' && el.getAttribute('data-kind') === 'mod';
  function jacks() { // [{id, el, dir, mod, label, kind}]: o.jacks, else every [data-cv-jack] in the world
    let L = call(Op.jacks);
    if (!Array.isArray(L)) {
      L = [];
      const walk = n => { for (const c of n.children || []) { const id = c.getAttribute && c.getAttribute('data-cv-jack'); if (id) L.push({ id, el: c }); else walk(c); } };
      if (W && W.el) walk(W.el);
    }
    return L.filter(j => j && typeof j.id === 'string').map(j => {
      const k0 = j.kind || (j.el && typeof j.el.getAttribute === 'function' && j.el.getAttribute('data-kind')) || 'audio';
      const role = k0 === 'cord' && j.el && typeof j.el.getAttribute === 'function' ? j.el.getAttribute('data-cord') : null; // ((WC) a rig's cord jack: its role)
      return { id: j.id, el: j.el || null, dir: j.dir || dirEl(j.id, j.el), mod: j.mod || modOf(j.id), label: j.label, kind: role || k0, cord: !!role };
    }).filter(j => j.kind !== 'cord'); // ((9) the 900 Series' cord jacks: never marked here)
  }
  const labelOf = (j, d) => {
    const L = call(Op.label, j);
    if (L) return String(L);
    if (d && d.label) return d.label;
    const el = d && d.el;
    return (el && (el.getAttribute('aria-label') || el.title)) || j;
  };
  const wires = () => { const L = Op.wires ? call(Op.wires) : C ? C.list() : []; return (Array.isArray(L) ? L : []).filter(c => isObj(c) && typeof c.wire === 'string' && !c.readonly); };
  const colorOf = () => (typeof Op.color === 'function' ? call(Op.color) : Op.color) || undefined;
  // ((WC, fixer B2; review 2 P2-4: the regret path) a rig's internal lines arriving at input j (unclaimed: lines mode) as wires — a press
  // there grabs the most recent one's end (re-patch by drag, as a cord's): its id, its source jack)
  const lines = j => (C ? C.list() : []).filter(c => isObj(c) && c.int && c.b === j && typeof c.a === 'string' && !c.readonly && !c.tap && !c.stub && c.kind !== 'mod'
    && !(typeof C.claimed === 'function' && C.claimed(c.id))).map(c => ({ wire: c.id, a: c.a, b: c.b }));
  // can out-jack a feed in-jack b? → {ok, why} (model ports through o.canConnect)
  function check(a, b) {
    const pa = portOf(a), pb = portOf(b);
    if (!pa || !pb) return { ok: false, why: 'Inside its instrument: not patchable' };
    const r = call(Op.canConnect, pa, pb);
    if (r && typeof r === 'object') return { ok: !!r.ok, why: r.why ? String(r.why) : '' };
    return { ok: r !== false, why: '' };
  }
  // ((WC, fixer B2; review 2 P1-2) a rig cord jack's port: the host's, else the jack itself — its port() answers null for a mod output (an
  // Envelope's OUT: no sx-edges end), yet o.canConnect / o.onConnect take the canvas jacks of a rig (the host resolves them))
  const cordPort = j => portOf(j) || j;
  function checkCord(a, b) {
    const r = call(Op.canConnect, cordPort(a), cordPort(b));
    if (r && typeof r === 'object') return { ok: !!r.ok, why: r.why ? String(r.why) : '' };
    return { ok: r !== false && r !== undefined, why: '' };
  }
  let D = null, dead = false, unhook = null;
  /* ---- (WC) cords mode: the layer's live rope / grabbed plug, the cords at a jack, the target chip */
  const cordsOn = () => typeof Op.live === 'function';
  const rigJack = el => cordsOn() && !!el && typeof el.getAttribute === 'function' && el.getAttribute('data-kind') === 'cord' && el.getAttribute('data-cord') != null;
  const LIVE = x => call(Op.live, x);
  const layerG = () => { const g = typeof Op.grab === 'function' ? call(Op.grab) : Op.grab; return g && typeof g.grab === 'function' ? g : null; };
  const GR = (name, ...a) => { const g = layerG(); if (g && typeof g[name] === 'function') { try { g[name](...a); } catch (err) { console.error(err); } } };
  const cordsAt = (j, end) => (C && typeof C.cordList === 'function' ? C.cordList() : []).filter(c => c[end] === j && !c.readonly && !c.tap);
  const lookOf = (j, mod) => { const L = call(Op.cordLook, j) || {}; return { c: fin(L.c) ? L.c : 4, s: L.s === 0 || L.s === 1 || L.s === 2 ? L.s : mod ? 2 : 0, o: fin(L.o) ? L.o : 1 }; };
  const later = (f, ms) => (typeof Op.later === 'function' ? Op.later(f, ms) : setTimeout(f, ms));
  const unlater = id => { if (id == null) return; if (typeof Op.unlater === 'function') Op.unlater(id); else clearTimeout(id); };
  const kNow = () => (W && W.k > 0 ? W.k : 1);
  // a jack's hit circle on the glass (screen px radius): the CSS clamp(28px, 44px · --ik, --jp) at zoom k (cv-patch's hitR)
  const jpOf = el => { const v = el && el.style && typeof el.style.getPropertyValue === 'function' ? parseFloat(el.style.getPropertyValue('--jp')) : NaN; return v > 0 ? v : 44; };
  const hitR = (el, k) => Math.max(28 * k, Math.min(44, jpOf(el) * k)) / 2;
  let chipEl = null, ovR = null, chipSz = null; // (chipSz: the chip's box as read once per text and overlay width, { w, h, ow })
  function chip(text, no) { // (cv-patch's chip: the target's name beside the finger, a refusal muted; #overlay)
    if (!text) { if (chipEl) chipEl.hidden = true; return; }
    if (!chipEl) {
      if (!doc || typeof doc.createElement !== 'function') return;
      chipEl = doc.createElement('div');
      chipEl.className = 'cv-plugchip';
      chipEl.setAttribute('aria-hidden', 'true');
      chipEl.setAttribute('data-wrap', ''); // ((fixer K, review P3-9) a long refusal wraps (style.css), never cut
      (W && W.overlay ? W.overlay : doc.body).append(chipEl);
    }
    if (chipEl.textContent !== text) { chipEl.textContent = text; chipSz = null; }
    if (!!no !== chipEl.hasAttribute('data-no')) { if (no) chipEl.setAttribute('data-no', ''); else chipEl.removeAttribute('data-no'); chipSz = null; }
    chipEl.hidden = false;
    // ((fixer K, P3-9 and its skeptics) its box read once per text and overlay width (a wrapped refusal's lines; one layout read, not
    // a frame's; round 1: Slide Over narrows the screen between drags), else estimated: it stands CHIP_UP px over the finger by its
    // height; no room above (its top past the overlay's 4 px: near the canvas top, under the top bar) → it flips CHIP_UP px below the
    // finger (never slid over it) — a mouse's right of the cursor, a finger's or a pen's LEFT of it, CHIP_CLEAR px clear (round 1: a
    // right hand rests below and right), right only where the left has no room — where neither has (round 2: an overlay under ~816 px,
    // the iPad mini's portrait, Split View) as far LEFT as it goes, never pinned to the right edge under the hand; to the finger's left
    // where the right has no room; whole inside the overlay either way (a canvas too short for both: its top 4 px down)
    const o2 = ovR || { left: 0, top: 0, width: 1e4, height: 1e4 }, oh = fin(o2.height) && o2.height > 0 ? o2.height : 1e4;
    if (!chipSz || chipSz.ow !== o2.width) { const w = +chipEl.offsetWidth, h = +chipEl.offsetHeight; chipSz = w > 0 && h > 0 ? { w, h, ow: o2.width } : null; }
    const wE = chipSz ? chipSz.w : Math.min(CHIP_W, Math.max(0, o2.width - 16), 20 + 7.6 * text.length);
    const hE = chipSz ? chipSz.h : CHIP_PAD + CHIP_LH * Math.max(1, Math.ceil(7.6 * text.length / Math.max(1, wE - 20) - 1e-6));
    let cx = D.x - o2.left + CHIP_DX, cy = D.y - o2.top - CHIP_UP - hE;
    if (cx + wE > o2.width - 4) cx = D.x - o2.left - CHIP_DX - wE;
    if (cy < 4) {
      cy = D.y - o2.top + CHIP_UP;
      if (D.type !== 'mouse') { cx = D.x - o2.left - CHIP_CLEAR - wE; if (cx < 4) { const r = D.x - o2.left + CHIP_CLEAR; cx = r + wE <= o2.width - 4 ? r : 4; } }
    }
    cy = Math.max(4, Math.min(cy, oh - 4 - hE));
    chipEl.style.transform = 'translate(' + Math.round(Math.max(4, Math.min(cx, o2.width - 4 - wE))) + 'px, ' + Math.round(cy) + 'px)';
  }
  /* ---- the press (the world's jack hook) */
  function press(e, el) {
    if (D || dead || !el || typeof el.getAttribute !== 'function' || (e.button != null && e.button !== 0)) return false;
    if (el.getAttribute('data-kind') === 'cord') { // ((9) a patch cord's jack: cv-patch's drag; (WC) a rig's that it leaves: this one's
      const r = call(Op.cordPress, e, el);
      if (r) return r;
      if (!rigJack(el)) return false;
      // ((WC, fixer K; review B5 / P2-3) the host names what the press is on: the nearest jack centre and, on a stacked input (the user,
      // 2026-10-26: its plugs on the one socket), its top cord — at Fit zoom a jack's 44-screen-px target overlaps its neighbours'
      const q = typeof Op.jackAt === 'function' && fin(e.clientX) && fin(e.clientY) ? call(Op.jackAt, el, toWorld(e.clientX, e.clientY), kNow()) : null;
      return pressCord(e, q && rigJack(q.el) ? q.el : el, q && typeof q.rec === 'string' ? q.rec : null);
    }
    if (ro(el)) return false;
    if (isModJack(el)) return pressMod(e, el);
    const j = el.getAttribute('data-cv-jack'), dir = j && dirEl(j, el);
    if (!dir || !portOf(j)) return false;
    const ws = dir === 'in' ? wires().filter(c => c.b === j) : [], ls = dir === 'in' && !ws.length ? lines(j) : [];
    const w = ws.length ? ws[ws.length - 1] : ls.length ? ls[ls.length - 1] : null;
    D = { pid: e.pointerId, type: e.pointerType || 'mouse', el, grab: j, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false,
      mode: w ? 'repatch' : 'new', wire: w ? w.wire : null, fixed: w ? w.a : j, want: w || dir === 'out' ? 'in' : 'out',
      lift: w ? [w.wire] : dir === 'out' ? wires().filter(c => c.a === j).map(c => c.wire) : [],
      marks: new Map(), tgt: null, body: false, near: null, offs: [], camOff: null };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    D.offs.push(listen(doc, 'pointermove', move, { passive: true }), listen(doc, 'pointerup', up), listen(doc, 'pointercancel', pcancel),
      listen(doc, 'keydown', key, true), listen(el, 'lostpointercapture', lost));
    return { cancel };
  }
  // (2a) a press on a mod-out jack: a mod cable (its targets are knobs)
  function pressMod(e, el) {
    const j = el.getAttribute('data-cv-jack');
    if (!j) return false;
    D = { pid: e.pointerId, type: e.pointerType || 'mouse', el, grab: j, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false,
      mod: true, src: modSrcOf(j), fixed: j, marks: new Map(), knobs: [], dimmed: [], memo: new Map(), tgt: null, offs: [], camOff: null };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    D.offs.push(listen(doc, 'pointermove', move, { passive: true }), listen(doc, 'pointerup', up), listen(doc, 'pointercancel', pcancel),
      listen(doc, 'keydown', key, true), listen(el, 'lostpointercapture', lost));
    return { cancel };
  }
  // (WC) a press on a rig's cord jack (cords mode): an output a new cord (a mod output's onto a knob or a cord input), an input
  // holding cords its most recent one grabbed (a touch long-press with several: "Which cord?"), a free input a new one backwards,
  // a warp jack a tap only
  function pressCord(e, el, rec) {
    const j = el.getAttribute('data-cv-jack'), role = el.getAttribute('data-cord') || 'audio', dir = j && dirEl(j, el);
    if (!j || !dir || ro(el)) return false;
    const base = { pid: e.pointerId, type: e.pointerType || 'mouse', el, grab: j, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false,
      cord: true, role, marks: new Map(), tgt: null, offs: [], camOff: null };
    if (role === 'warp') D = Object.assign(base, { tapOnly: true, fixed: j });
    else if (role === 'mod' && dir === 'out') D = Object.assign(base, { mod: true, src: modSrcOf(j), fixed: j, want: 'in', knobs: [], dimmed: [], memo: new Map(), look: lookOf(j, true) });
    else {
      if (!portOf(j)) return false;
      const recs = dir === 'in' ? cordsAt(j, 'b') : [], w = (rec && recs.find(c => c.id === rec)) || (recs.length ? recs[recs.length - 1] : null); // ((fixer K, B5) the record the host names: a stack's top
      D = Object.assign(base, { mode: w ? 'grab' : 'new', wire: w ? w.id : null, fixed: w ? w.a : j, want: w || dir === 'out' ? 'in' : 'out', recs, body: false, near: null, held: false });
      D.look = lookOf(D.fixed, false);
      if (recs.length > 1 && D.type !== 'mouse') {
        const d0 = D;
        D.which = later(() => { if (D !== d0 || D.on) return; D.which = null; const d = finish(); whichCord(d.grab, d.el, d.x0, d.y0, d.recs); }, WHICH_MS);
      }
    }
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    D.offs.push(listen(doc, 'pointermove', move, { passive: true }), listen(doc, 'pointerup', up), listen(doc, 'pointercancel', pcancel),
      listen(doc, 'keydown', key, true), listen(el, 'lostpointercapture', lost));
    return { cancel };
  }
  // (WC) a claimed mod row's badge dragged past TAP_PX (cv-cables setBadgeDrag): its knob-end tip in the finger — another knob
  // re-targets the row, away from any knob pulls it
  function badgeDrag(id, e, P) {
    if (D || dead || !cordsOn() || !layerG() || !P) return false;
    const c = C ? C.list().find(x => x.id === id) : null;
    if (!c || c.kind !== 'mod' || c.readonly || typeof c.a !== 'string') return false;
    D = { pid: P.pid, type: P.type || e.pointerType || 'mouse', el: P.el, grab: null, x0: P.x, y0: P.y, x: e.clientX, y: e.clientY, on: false,
      cord: true, mod: true, badge: id, mode: 'grab', wire: id, src: modSrcOf(c.a), fixed: c.a, cur: c.b, marks: new Map(), knobs: [], dimmed: [], memo: new Map(), tgt: null, offs: [], camOff: null };
    try { P.el.setPointerCapture(P.pid); } catch (err) { /* gone */ }
    D.offs.push(listen(doc, 'pointermove', move, { passive: true }), listen(doc, 'pointerup', up), listen(doc, 'pointercancel', pcancel),
      listen(doc, 'keydown', key, true));
    begin();
    follow();
    if (W && typeof W.dragPointer === 'function') W.dragPointer({ x: D.x, y: D.y, pointerType: D.type });
    return true;
  }
  function move(e) {
    if (!D || e.pointerId !== D.pid) return;
    if (D.type === 'mouse' && e.buttons === 0) { up(e); return; } // (a swallowed pointerup)
    D.x = e.clientX; D.y = e.clientY;
    if (!D.on) {
      if (Math.hypot(D.x - D.x0, D.y - D.y0) <= (D.type === 'mouse' ? 4 : TAP_PX)) return;
      if (D.tapOnly) return; // ((WC) a warp jack: a target only — no drag from it)
      begin();
    }
    follow();
    if (W && typeof W.dragPointer === 'function') W.dragPointer({ x: D.x, y: D.y, pointerType: D.type });
  }
  function begin() {
    D.on = true;
    if (D.which != null) { unlater(D.which); D.which = null; }
    if (D.cord) { beginCord(); return; }
    if (D.mod) { beginMod(); return; }
    for (const J of jacks()) {
      if (!J.el) continue;
      let cls = 'cv-no', why = '';
      if (J.id === D.fixed) cls = 'cv-from';
      else if (J.kind === 'mod') why = 'A modulation output: drag it onto a knob';
      else if (J.dir !== D.want) why = D.want === 'in' ? 'Connect an output to an input' : 'Connect an input to an output';
      else if (D.mode === 'repatch' && J.id === D.grab) cls = 'cv-ok';
      else { const r = D.want === 'in' ? check(D.fixed, J.id) : check(J.id, D.fixed); if (r.ok) cls = 'cv-ok'; else why = r.why || 'Not compatible'; }
      D.marks.set(J.id, { J, cls, why, title: J.el.getAttribute('title') });
      J.el.classList.add(cls);
      if (cls === 'cv-no' && why) J.el.setAttribute('title', why);
    }
    if (W && W.el) W.el.setAttribute('data-cv-patching', '');
    if (C) for (const id of D.lift) C.hide(id, true);
    D.rects = call(Op.rects) || {}; // (world rects: read once — the camera moves, the modules do not)
    if (W && typeof W.on === 'function') D.camOff = W.on('camera', () => { if (D && D.on) follow(); }); // (an edge pan under a still pointer)
  }
  /* ---- (2a) the mod drag: knobs are its targets */
  const attrUp = (n, a) => { for (; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (n.getAttribute(a) != null) return n; return null; };
  const devAt = el => { const d = attrUp(el, 'data-dev'); if (d) return d.getAttribute('data-dev'); const m = attrUp(el, 'data-cv-mod'); return m ? m.getAttribute('data-cv-mod').split('/')[0] : null; };
  const hitAt0 = (x, y) => { if (typeof Op.hit === 'function') return call(Op.hit, x, y) || null; try { return typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null; } catch (err) { return null; } };
  const hitAt = (x, y) => { const t = hitAt0(x, y); return t && inBadge(t) ? beneath(doc, x, y) : t; }; // (U2) through a badge (CSS: none while patching)
  function checkMod(dst, el) { // → {ok, why}, memoised per drag
    let r = D.memo.get(dst);
    if (r) return r;
    if (el && el.getAttribute('data-nomod') != null && el.getAttribute('data-nomod') !== '0') r = { ok: false, why: 'This knob can\u2019t be modulated' };
    else {
      const q = call(Op.canMod || Op.canConnect, D.src, dst);
      r = q && typeof q === 'object' ? { ok: !!q.ok, why: q.why ? String(q.why) : '' } : { ok: q !== false && q !== undefined, why: '' };
      if (!r.ok && !r.why) r.why = 'This knob can\u2019t be modulated';
    }
    D.memo.set(dst, r);
    return r;
  }
  function destTest() { // o.markDests(src) → (dev, id) → bool, or null (no knob marked)
    const r = call(Op.markDests, D.src);
    if (typeof r === 'function') return (dv, id) => { try { return !!r(dv, id); } catch (err) { return false; } };
    if (!Array.isArray(r)) return null;
    const S = new Set();
    for (const x of r) { if (typeof x === 'string') S.add(x); else if (isObj(x) && typeof x.dev === 'string' && Array.isArray(x.ids)) for (const id of x.ids) S.add(x.dev + ':' + id); }
    return (dv, id) => S.has(dv + ':' + id);
  }
  function beginMod() {
    for (const J of jacks()) { // every jack: never a target (the source: .cv-from)
      if (!J.el) continue;
      const cls = J.id === D.fixed ? 'cv-from' : 'cv-no', why = cls === 'cv-no' ? 'Drag a modulation cable onto a knob' : '';
      D.marks.set(J.id, { J, cls, why, title: J.el.getAttribute('title') });
      J.el.classList.add(cls);
      if (why) J.el.setAttribute('title', why);
    }
    const test = destTest(), srcMod = modOf(D.fixed), roots = new Map(), okMods = new Set();
    if (W && W.el) { // one walk of the world: [data-dest] under [data-dev] (else the module's device), the module roots
      const st = [[W.el, null, null]];
      while (st.length) {
        const [n, dv0, mk0] = st.pop();
        for (const c of n.children || []) {
          if (!c || typeof c.getAttribute !== 'function' || c.getAttribute('data-twin') != null) continue; // ((3) a twin — CLIP's MACROS pane — is never a target)
          const mk = c.getAttribute('data-cv-mod'), mkey = mk != null ? mk : mk0, dv = c.getAttribute('data-dev') || dv0 || (mk != null ? mk.split('/')[0] : null);
          if (mk != null) roots.set(mk, c);
          const id = c.getAttribute('data-dest');
          if (id && test && dv && c.getAttribute('data-nomod') == null && test(dv, id)) { c.classList.add('cv-ok'); D.knobs.push(c); if (mkey != null) okMods.add(mkey); }
          st.push([c, dv, mkey]);
        }
      }
      W.el.setAttribute('data-cv-patching', 'mod');
    }
    for (const [k, el] of roots) if (k !== srcMod && !okMods.has(k)) { el.classList.add('cv-nodest'); D.dimmed.push(el); }
    const mr = attrUp(D.el, 'data-cv-mod'); // (the live cable: the source module's colour)
    D.color = (mr && mr.style && typeof mr.style.getPropertyValue === 'function' && mr.style.getPropertyValue('--mc')) || colorOf();
    if (W && typeof W.on === 'function') D.camOff = W.on('camera', () => { if (D && D.on) follow(); });
  }
  function followMod() {
    const t = hitAt(D.x, D.y);
    let tg = null;
    const de = attrUp(t, 'data-dest');
    if (de && de !== D.el && !attrUp(de, 'data-twin')) { // ((3) a twin control: no cable end, no drop target)
      const dv = devAt(de), id = de.getAttribute('data-dest');
      if (dv && id) { const r = checkMod(dv + ':' + id, de); tg = { kind: 'knob', el: de, dst: dv + ':' + id, ok: r.ok, why: r.why }; }
    }
    if (!tg) {
      const b = attrUp(t, 'data-cv-bar'), m = b && attrUp(b, 'data-cv-mod'), k = m && m.getAttribute('data-cv-mod');
      if (k && k !== modOf(D.fixed)) tg = { kind: 'bar', el: b, key: k };
    }
    const o1 = D.tgt, same = o1 && tg && o1.el === tg.el;
    if (!same) {
      if (o1) o1.el.classList.remove(o1.ok === false ? 'cv-no' : 'cv-hot');
      if (tg) tg.el.classList.add(tg.ok === false ? 'cv-no' : 'cv-hot');
      D.tgt = tg;
    }
    const P = call(Op.ports), F = at(P, D.fixed);
    let T = toWorld(D.x, D.y);
    if (tg && tg.kind === 'knob' && tg.ok) { const r = tg.el.getBoundingClientRect ? tg.el.getBoundingClientRect() : null; if (r) T = toWorld(r.left + r.width / 2, r.top + r.height / 2); }
    if (C && F && T) C.live({ x1: F.x, y1: F.y, x2: T.x, y2: T.y, color: D.color || undefined, snap: !!(tg && tg.ok !== false), mod: true });
  }
  /* ---- (WC) cords mode: the marks, the targets, the rope */
  function beginCord() {
    if (D.mod) {
      beginMod(); // (the knobs markDests names, every jack cv-no, the modules without one dimmed, #world[data-cv-patching="mod"])
      if (!D.badge) for (const [id, m] of D.marks) { // a cord input that takes this output (an Envelope onto the Amplifier's LEVEL): a target too
        if (!m.J.cord || m.J.dir !== 'in' || id === D.fixed) continue;
        const r = checkCord(D.fixed, id); // ((fixer B2, P1-2) asked with the jacks; refused: the host's reason, not the knob hint
        if (!r.ok) { if (r.why) { m.why = r.why; m.J.el.setAttribute('title', r.why); } continue; }
        m.J.el.classList.remove(m.cls); m.cls = 'cv-ok'; m.why = ''; m.J.el.classList.add('cv-ok');
        if (m.title == null) m.J.el.removeAttribute('title'); else m.J.el.setAttribute('title', m.title);
      }
    } else {
      for (const J of jacks()) {
        if (!J.el) continue;
        let cls = 'cv-no', why = '';
        if (J.id === D.fixed) cls = 'cv-from';
        else if (J.dir !== D.want) why = D.want === 'in' ? 'Connect an output to an input' : 'Connect an input to an output';
        else if (D.mode === 'grab' && J.id === D.grab) cls = 'cv-ok';
        else { const r = D.want === 'in' ? check(D.fixed, J.id) : check(J.id, D.fixed); if (r.ok) cls = 'cv-ok'; else why = r.why || 'Not compatible'; }
        D.marks.set(J.id, { J, cls, why, title: J.el.getAttribute('title') });
        J.el.classList.add(cls);
        if (cls === 'cv-no' && why) J.el.setAttribute('title', why);
      }
      if (W && W.el) W.el.setAttribute('data-cv-patching', 'cord');
      D.rects = call(Op.rects) || {};
      if (W && typeof W.on === 'function') D.camOff = W.on('camera', () => { if (D && D.on) follow(); });
    }
    let r = null;
    try { r = W && W.overlay && typeof W.overlay.getBoundingClientRect === 'function' ? W.overlay.getBoundingClientRect() : null; } catch (err) { r = null; } // (one layout read: the chip's frame)
    ovR = r && fin(r.left) ? r : null;
    if (D.mode === 'grab') GR('grab', D.wire, 'b', toWorld(D.x, D.y));
  }
  // the jack under the finger decides first (inside its hit circle: compatible → the target, refused → its reason, the cord's own
  // source → held), else the nearest compatible within SNAP_PX (else the nearest refused one's reason) — cv-patch's rule
  function pickJack(P) {
    const k = kNow();
    let best = null, bd = SNAP_PX + 1e-9, near = null, nd = SNAP_PX + 1e-9, under = null, ud = Infinity;
    for (const [id, m] of D.marks) {
      const p = at(P, id);
      if (!p) continue;
      const c = toClient(p.x, p.y), d = Math.hypot(c.x - D.x, c.y - D.y);
      if (d <= hitR(m.J.el, k) && d < ud) { ud = d; under = id; } // ((fixer B2, P3-3) a jack of the wrong direction under the finger too: refused there
      if (m.cls === 'cv-from' || m.J.dir !== D.want) continue;
      if (m.cls === 'cv-ok') { if (d < bd) { bd = d; best = id; } } else if (d < nd) { nd = d; near = id; }
    }
    if (under) { const m = D.marks.get(under); return { best: m.cls === 'cv-ok' ? under : null, near: m.cls === 'cv-no' ? under : null, held: m.cls === 'cv-from' }; }
    return { best, near, held: false };
  }
  // ((fixer B2, P3-3) why a near jack refuses: the host's words (check, as the release's notice says it — "Two outputs — connect an output
  // to an input"), once a drag; the mark's own reason without them
  function nearWhy(id) {
    const m = D.marks.get(id);
    if (!m) return '';
    if (m.hw == null) { const a = D.want === 'in' ? D.fixed : id, b = D.want === 'in' ? id : D.fixed, r = m.J.dir !== D.want ? check(a, b) : null; m.hw = (r && r.why) || m.why || ''; }
    return m.hw;
  }
  function followCord() {
    const P = call(Op.ports);
    let { best, near, held } = pickJack(P), body = false;
    if (!best && !near && !held) { // over a module body: its first compatible jack
      const w = toWorld(D.x, D.y), R = D.rects || {};
      for (const k of Object.keys(R)) {
        const r = R[k];
        if (!r || !(w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h)) continue;
        for (const [id, m] of D.marks) if (m.cls === 'cv-ok' && m.J.mod === k && id !== D.grab) { best = id; body = true; break; }
        break;
      }
    }
    if (best !== D.tgt) {
      const o1 = D.tgt && D.marks.get(D.tgt), o2 = best && D.marks.get(best);
      if (o1) o1.J.el.classList.remove('cv-hot');
      if (o2) o2.J.el.classList.add('cv-hot');
      D.tgt = best;
    }
    D.body = body; D.near = best ? null : near; D.held = held;
    if (best && best !== D.grab) chip(labelOf(best, D.marks.get(best).J), false);
    else if (D.near) chip(labelOf(D.near, D.marks.get(D.near).J) + ' — ' + (nearWhy(D.near) || 'Not compatible'), true);
    else chip(null);
    const F = at(P, D.fixed), T = best && !body ? at(P, best) : toWorld(D.x, D.y);
    if (!T) return;
    if (D.mode === 'grab') GR('move', { x: T.x, y: T.y });
    else if (F) LIVE({ a: { x: F.x, y: F.y }, b: { x: T.x, y: T.y }, c: D.look.c, s: D.look.s, o: D.look.o });
  }
  function followCordMod() {
    const t = hitAt(D.x, D.y);
    let tg = null;
    const de = attrUp(t, 'data-dest');
    if (de && de !== D.el && !attrUp(de, 'data-twin')) {
      const dv = devAt(de), id = de.getAttribute('data-dest');
      if (dv && id) { const r = checkMod(dv + ':' + id, de); tg = { kind: 'knob', el: de, dst: dv + ':' + id, ok: r.ok, why: r.why }; }
    }
    const P = call(Op.ports);
    if (!tg && !D.badge) { const q = pickJack(P); if (q.best || q.near) { const id = q.best || q.near, m = D.marks.get(id); tg = { kind: 'jack', el: m.J.el, id, ok: !!q.best, why: m.why }; } }
    if (!tg && !D.badge) {
      const b = attrUp(t, 'data-cv-bar'), m = b && attrUp(b, 'data-cv-mod'), k = m && m.getAttribute('data-cv-mod');
      if (k && k !== modOf(D.fixed)) tg = { kind: 'bar', el: b, key: k };
    }
    const o1 = D.tgt, same = o1 && tg && o1.el === tg.el;
    // (a jack target lights only when it takes the cord: a refused one keeps its mark's cv-no)
    const lit = (x, on) => { if (!x) return; if (x.kind === 'jack') { if (x.ok) x.el.classList.toggle('cv-hot', on); } else x.el.classList[on ? 'add' : 'remove'](x.ok === false ? 'cv-no' : 'cv-hot'); };
    if (!same) { lit(o1, false); lit(tg, true); D.tgt = tg; }
    const lab = tg && tg.kind === 'knob' ? (tg.el.getAttribute('aria-label') || tg.el.title || tg.dst) : tg && tg.kind === 'jack' ? labelOf(tg.id, D.marks.get(tg.id).J) : null;
    if (tg && tg.kind !== 'bar' && !(D.badge && tg.dst === D.cur)) chip(tg.ok === false ? lab + ' — ' + (tg.why || 'Not compatible') : lab, tg.ok === false); else chip(null);
    let T = toWorld(D.x, D.y);
    if (tg && tg.ok && tg.kind === 'knob') { const r = wk.discBox(tg.el) || (tg.el.getBoundingClientRect ? tg.el.getBoundingClientRect() : null); if (r) T = toWorld(r.left + r.width / 2, r.top + r.height / 2); } // ((fixer B2) its disc's centre (wk.discBox: the kit's one measure — the cord's rim and the ring read the same, review WC-int P3-18), else the control's
    else if (tg && tg.ok && tg.kind === 'jack') { const q = at(P, tg.id); if (q) T = q; }
    if (D.badge) { GR('move', { x: T.x, y: T.y }); return; }
    const F = at(P, D.fixed);
    if (F && T) LIVE({ a: { x: F.x, y: F.y }, b: { x: T.x, y: T.y }, c: D.look.c, s: D.look.s, o: D.look.o });
  }
  function follow() { // the target under the pointer (snap, else a module body's first compatible jack) and the live cable
    if (D.cord) { if (D.mod) followCordMod(); else followCord(); return; }
    if (D.mod) { followMod(); return; }
    const P = call(Op.ports);
    let best = null, bd = Infinity, near = null, nd = Infinity;
    for (const [id, m] of D.marks) {
      if (m.cls === 'cv-from' || m.J.dir !== D.want || m.J.kind === 'mod') continue;
      const p = at(P, id);
      if (!p) continue;
      const c = toClient(p.x, p.y), d = Math.hypot(c.x - D.x, c.y - D.y);
      if (d > SNAP_PX) continue;
      if (m.cls === 'cv-ok') { if (d < bd) { bd = d; best = id; } } else if (d < nd) { nd = d; near = id; }
    }
    let body = false;
    if (!best) {
      const w = toWorld(D.x, D.y), R = D.rects;
      for (const k of Object.keys(R)) {
        const r = R[k];
        if (!r || !(w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h)) continue;
        for (const [id, m] of D.marks) if (m.cls === 'cv-ok' && m.J.mod === k && id !== D.grab) { best = id; body = true; break; }
        if (!best && !near && k !== modOf(D.fixed)) for (const [id, m] of D.marks) if (m.J.mod === k && m.J.dir === D.want && m.cls === 'cv-no' && m.J.kind !== 'mod') { near = id; break; }
        break;
      }
    }
    if (best !== D.tgt) {
      const o1 = D.tgt && D.marks.get(D.tgt), o2 = best && D.marks.get(best);
      if (o1) o1.J.el.classList.remove('cv-hot');
      if (o2) o2.J.el.classList.add('cv-hot');
      D.tgt = best;
    }
    D.body = body; D.near = best ? null : near;
    const F = at(P, D.fixed), T = best && !body ? at(P, best) : toWorld(D.x, D.y);
    if (!C || !F || !T) return;
    const a = D.want === 'in' ? F : T, b = D.want === 'in' ? T : F;
    C.live({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: colorOf(), snap: !!best });
  }
  function finish() { // every trace of the drag goes; D → null
    const d = D;
    if (!d) return null;
    D = null;
    for (const f of d.offs) f();
    if (d.camOff) d.camOff();
    for (const m of d.marks.values()) {
      m.J.el.classList.remove(m.cls, 'cv-hot');
      if (m.cls === 'cv-no' && m.why) { if (m.title == null) m.J.el.removeAttribute('title'); else m.J.el.setAttribute('title', m.title); }
    }
    if (d.mod) { // (2a) the knob marks, the dimmed modules, the target's mark
      for (const k of d.knobs) k.classList.remove('cv-ok');
      for (const m of d.dimmed) m.classList.remove('cv-nodest');
      if (d.tgt) d.tgt.el.classList.remove('cv-hot', 'cv-no');
    }
    if (d.on) {
      if (W && W.el) W.el.removeAttribute('data-cv-patching');
      if (C) { for (const id of d.lift || []) C.hide(id, false); C.live(null); }
      if (W && typeof W.dragPointer === 'function') W.dragPointer(null);
    }
    if (d.cord) { if (d.which != null) unlater(d.which); chip(null); } // ((WC) the long-press, the chip)
    try { d.el.releasePointerCapture(d.pid); } catch (err) { /* released */ }
    return d;
  }
  // (WC) the cord layer after a cords-mode drag (after its callbacks: a commit's set came first): the live rope goes, a grabbed end
  // is let go — it springs to its anchor (a re-patch's new jack, its own after a cancel; a pulled cord is gone already)
  function done(d) { if (!d || !d.cord || !d.on) return; if (d.mode === 'grab') GR('drop'); else LIVE(null); }
  function abandon() { done(finish()); } // (Escape, a pointercancel, a second finger: nothing written)
  // (WC) a cords-mode release
  function upCord(e) {
    if (!D.on) { // a tap: the host's jack menu (Connect to… / the plug menu), else a mod output's list, a warp's own menu, Connect to…
      const d = finish();
      if (!d.badge && Math.hypot(d.x - d.x0, d.y - d.y0) <= TAP_PX) cordTap(d.grab, d.el, e.clientX, e.clientY);
      return;
    }
    follow();
    const d = finish(), t = d.tgt;
    try {
      if (d.mod && d.badge) { // a row's knob end: another knob re-targets it, none pulls it, its own / a refused one leaves it
        if (!t) call(Op.onPull, d.wire);
        else if (t.kind === 'knob') { if (!t.ok) call(Op.onRefuse, d.src, t.dst, t.why); else if (t.dst !== d.cur) call(Op.onRepatchMod, d.wire, t.dst); }
        return;
      }
      if (d.mod) {
        if (!t) return;
        if (t.kind === 'bar') call(Op.onBarDrop, d.src, t.key);
        else if (t.kind === 'jack') { if (t.ok) call(Op.onConnect, cordPort(d.fixed), cordPort(t.id)); else call(Op.onRefuse, cordPort(d.fixed), cordPort(t.id), t.why); }
        else if (t.ok) call(Op.onMod || Op.onConnect, d.src, t.dst);
        else call(Op.onRefuse, d.src, t.dst, t.why);
        return;
      }
      if (t) {
        if (d.mode === 'grab') { if (t !== d.grab) call(Op.onRepatch, d.wire, portOf(d.fixed), portOf(t)); }
        else if (d.want === 'in') call(Op.onConnect, portOf(d.fixed), portOf(t)); else call(Op.onConnect, portOf(t), portOf(d.fixed));
      } else if (d.near) {
        const a = d.want === 'in' ? d.fixed : d.near, b = d.want === 'in' ? d.near : d.fixed, m = d.marks.get(d.near);
        call(Op.onRefuse, portOf(a), portOf(b), check(a, b).why || (m && m.why) || 'Not compatible');
      } else if (d.mode === 'grab' && !d.held) call(Op.onPull, d.wire); // (let go away from any jack: pulled — the host's "Cord pulled · tap to undo")
    } finally { done(d); }
  }
  // (WC) a tap (Enter / Space) on a rig's cord jack: the host's menu first (rig-ui's Connect to… / plug menu with the swatches)
  function cordTap(j, el, x, y) {
    if (dead || !j) return null;
    const r = call(Op.jackMenu, j, el, x, y);
    if (r) return r;
    const role = el && typeof el.getAttribute === 'function' ? el.getAttribute('data-cord') : null, dir = dirEl(j, el);
    if (role === 'mod' && dir === 'out') return call(Op.onJackTap, modSrcOf(j), el);
    if (role === 'warp') { const w = C && typeof C.cordList === 'function' ? C.cordList().filter(c => c.b === j).pop() : null; return w && C.tap ? C.tap(w.id, null) : null; } // (its warp / FM menu: the host's tap action)
    return menu(j, x, y);
  }
  // (WC) "Which cord?" — a long-press (a right-click) on an input holding several: the host's jack menu, as a tap ((fixer K) its "Which
  // cord?" ▸ each cord's Pull · Re-patch to ▸ · Colour ▸); without one its cords by source, the most recent first — a pick selects it
  // and opens its menu (Disconnect, the host's items)
  function whichCord(j, el, x, y, recs) {
    if (dead) return null;
    const h = call(Op.jackMenu, j, el, x, y); // ((fixer K, review P3-7) what a tap offers: the host's plug menu (Which cord? ▸ Pull · Re-patch to ▸ · Colour ▸)
    if (h) return h;
    const L = jacks(), items = [{ label: 'Which cord?', disabled: true }];
    for (const c of recs.slice().reverse()) {
      const J = L.find(q => q.id === c.a);
      items.push({ label: labelOf(c.a, J), action: () => { if (C) { C.select(c.id); if (typeof C.openMenu === 'function') C.openMenu(c.id, x, y); } } });
    }
    return wk.contextMenu(x, y, items, el ? { anchor: el } : undefined);
  }
  function up(e) {
    if (!D || e.pointerId !== D.pid) return;
    D.x = e.clientX; D.y = e.clientY;
    if (D.cord) { upCord(e); return; }
    if (!D.on) { // a tap: "Connect to…" ((2a) a mod jack's: the host's list)
      const d = finish();
      if (Math.hypot(d.x - d.x0, d.y - d.y0) <= TAP_PX) { if (d.mod) call(Op.onJackTap, d.src, d.el); else menu(d.grab, e.clientX, e.clientY); }
      return;
    }
    if (D.mod) {
      followMod();
      const d = finish(), t = d.tgt;
      if (!t) return;
      if (t.kind === 'bar') call(Op.onBarDrop, d.src, t.key);
      else if (t.ok) call(Op.onMod || Op.onConnect, d.src, t.dst);
      else call(Op.onRefuse, d.src, t.dst, t.why);
      return;
    }
    follow();
    const d = finish(), t = d.tgt;
    if (!t) {
      if (d.near) {
        const a = d.want === 'in' ? d.fixed : d.near, b = d.want === 'in' ? d.near : d.fixed;
        call(Op.onRefuse, portOf(a), portOf(b), check(a, b).why);
      }
      return;
    }
    if (d.mode === 'repatch') { if (t !== d.grab) call(Op.onRepatch, d.wire, portOf(d.fixed), portOf(t)); return; }
    if (d.want === 'in') call(Op.onConnect, portOf(d.fixed), portOf(t)); else call(Op.onConnect, portOf(t), portOf(d.fixed));
  }
  function pcancel(e) { if (D && e.pointerId === D.pid) abandon(); } // (a second finger's flagged cancel, the browser's)
  function lost(e) { if (D && e.pointerId === D.pid && !D.on) finish(); } // (the jack went: a sync rebuilt its module)
  function key(e) {
    if (!D || e.key !== 'Escape') return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    abandon();
  }
  function cancel() { abandon(); }
  /* ---- "Connect to…": a tap, Enter / Space or a right-click on a jack; (WC) a rig cord jack's lists the outputs that may feed it
   * (an Envelope's too, onto LEVEL) and Pull items for the cords at it (o.onPull) */
  function menu(j, x, y) {
    const L0 = dead ? [] : jacks(), me0 = L0.find(J => J.id === j), dir = me0 ? me0.dir : dirOf(j || '');
    if (!dir || !portOf(j) || dead) return null;
    const L = L0, me = me0 || { id: j, el: null };
    if (ro(me.el)) return null;
    const items = [{ label: 'Connect ' + labelOf(j, me) + ' to…', disabled: true }];
    let n = 0;
    for (const J of L) {
      if (J.dir === dir || J.id === j || (J.kind === 'mod' && !(me.cord && J.cord)) || !portOf(J.id)) continue;
      const r = dir === 'out' ? check(j, J.id) : check(J.id, j);
      if (!r.ok) continue;
      n++;
      items.push({ label: labelOf(J.id, J), action: () => { if (dir === 'out') call(Op.onConnect, portOf(j), portOf(J.id)); else call(Op.onConnect, portOf(J.id), portOf(j)); } });
    }
    if (!n) items.push({ label: 'Nothing to connect to', disabled: true });
    if (typeof Op.onDisconnect === 'function') {
      const ws = wires().filter(c => (dir === 'in' ? c.b === j : c.a === j));
      if (ws.length) items.push({ sep: true });
      for (const c of ws) {
        const other = dir === 'in' ? c.a : c.b, OJ = L.find(J => J.id === other);
        items.push({ label: 'Disconnect ' + labelOf(other, OJ), action: () => call(Op.onDisconnect, c.wire) });
      }
    }
    if (me.cord && typeof Op.onPull === 'function') { // ((WC) the cords at a rig jack: Pull each)
      const rs = cordsAt(j, dir === 'in' ? 'b' : 'a');
      if (rs.length) items.push({ sep: true });
      for (const c of rs) {
        const other = dir === 'in' ? c.a : c.b, OJ = L.find(J => J.id === other);
        items.push({ label: 'Pull ' + labelOf(other, OJ), action: () => call(Op.onPull, c.id) });
      }
    }
    if (x == null || y == null) { const r = me.el && me.el.getBoundingClientRect ? me.el.getBoundingClientRect() : null; x = r ? r.left + r.width / 2 : 0; y = r ? r.bottom + 4 : 0; }
    return wk.contextMenu(x, y, items, me.el ? { anchor: me.el } : undefined);
  }
  // ((9) a cord jack's keys / right-click are cv-patch's: none here; (WC) a rig's cord jack in cords mode: cordEl, this drag's)
  const jackEl = t => { for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) { if (n.getAttribute('data-cv-jack') != null) return n.getAttribute('data-kind') === 'cord' ? null : n; if (n.getAttribute('data-cv-mod') != null) return null; } return null; };
  const cordEl = t => { for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) { if (n.getAttribute('data-cv-jack') != null) return rigJack(n) && !ro(n) ? n : null; if (n.getAttribute('data-cv-mod') != null) return null; } return null; };
  const offs = [];
  if (W && W.el) {
    offs.push(listen(W.el, 'keydown', e => {
      const ok = e.key === 'Enter' || e.key === ' ', je = ok && jackEl(e.target);
      if (!je) { const ce = ok && cordEl(e.target); if (ce && ce === e.target) { if (e.preventDefault) e.preventDefault(); cordTap(ce.getAttribute('data-cv-jack'), ce); } return; }
      if (je !== e.target) return;
      if (e.preventDefault) e.preventDefault();
      if (isModJack(je)) { if (!dead) call(Op.onJackTap, modSrcOf(je.getAttribute('data-cv-jack')), je); return; }
      menu(je.getAttribute('data-cv-jack'));
    }));
    offs.push(listen(W.el, 'contextmenu', e => {
      const je = jackEl(e.target);
      if (!je) { // ((WC) a rig cord jack: "Which cord?" on an input holding several, else its tap's menu)
        const ce = cordEl(e.target);
        if (!ce) return;
        if (e.preventDefault) e.preventDefault();
        const j = ce.getAttribute('data-cv-jack'), rs = dirEl(j, ce) === 'in' ? cordsAt(j, 'b') : [];
        if (rs.length > 1) whichCord(j, ce, e.clientX, e.clientY, rs); else cordTap(j, ce, e.clientX, e.clientY);
        return;
      }
      if (e.preventDefault) e.preventDefault();
      if (isModJack(je)) { if (!dead) call(Op.onJackTap, modSrcOf(je.getAttribute('data-cv-jack')), je); return; }
      menu(je.getAttribute('data-cv-jack'), e.clientX, e.clientY);
    }));
  }
  if (W && typeof W.setJackHook === 'function') unhook = W.setJackHook(press, cancel);
  else if (W && W.hooks) { W.hooks.jack = press; W.hooks.jackCancel = cancel; unhook = () => { if (W.hooks.jack === press) { W.hooks.jack = null; W.hooks.jackCancel = null; } }; }
  // (WC) cords mode: the claimed badges' drag; o.cordHit — the world's tap on a claimed cord's body (cv-world setCordHook) and the
  // cables' "not elsewhere" (a press on the selected cord's body keeps it)
  const unhooks = [];
  if (C && cordsOn() && typeof C.setBadgeDrag === 'function') unhooks.push(C.setBadgeDrag(badgeDrag));
  if (typeof Op.cordHit === 'function') {
    const mine = id => !!C && typeof C.claimed === 'function' && C.claimed(id);
    const hitAtP = (p, r) => (p && fin(p.x) && fin(p.y) ? call(Op.cordHit, p, r, mine) || null : null);
    if (W && typeof W.setCordHook === 'function') unhooks.push(W.setCordHook((p, r) => hitAtP(p, r), (id, e, p) => { if (!dead && C && typeof C.tap === 'function') C.tap(id, p, e && e.pointerType); }));
    if (C && typeof C.setCordAt === 'function') unhooks.push(C.setCordAt(e => (dead ? null : hitAtP(toWorld(e.clientX, e.clientY), HIT_PX / kNow()))));
  }
  return {
    press, menu, cancel,
    active: () => !!(D && D.on),
    destroy() {
      if (dead) return;
      abandon();
      dead = true;
      for (const f of offs) f();
      if (unhook) unhook();
      for (const f of unhooks) { try { if (typeof f === 'function') f(); } catch (err) { /* gone */ } }
      if (chipEl) { chipEl.remove(); chipEl = null; }
      if (own) own.destroy();
    },
  };
}
