// fx-ui.js — FX rack UI v2 (SPEC-serum2 §2.5, §3.16, §11.14, §11.15, §13.5; inv B14) used by every track's FX tab
// and, embedded, by Serum's FX page. Owner U3.
//
// The v2 FX state (§2.5) holds three racks (MAIN, BUS 1, BUS 2) of effect *instances* (any type, any order, several of
// a type; splitters hold 2–3 branch lists). The rack UI shows:
//   · a bar: rack tabs MAIN · BUS 1 · BUS 2 (racks: 3 — Serum; classic tracks show MAIN only, no tabs), the expand
//     toggle (Alt/Option+F) and the rack menu ⋯ (also on a right-click / long-press of the rack background);
//   · the list view (left): the rack's instances in processing order — enable LED (`on`), label, S1 badge (Phase-1
//     variant instances), drag handle; splitters show their branches as indented groups (LOWS/HIGHS · LOWS/MIDS/HIGHS ·
//     MID/SIDE) with their own "+" and bypass. Drag to reorder (yellow insertion line; dropping into a branch moves the
//     instance there; splitters never enter branches), Alt-drag duplicates without mods, Shift-Alt-drag with mods;
//     touch: long-press menu (Duplicate, Move to ▸ …); Alt+↑/↓ moves the focused row; "+" opens the add menu
//     (13 effects + 3 splitters; inside a branch the effects only);
//   · the rack view (right): one panel per instance of the rack, a splitter followed by the panels of its selected
//     branch. Panel header: title, S1 badge, "bypassed" chip (v1 temporary bypass `inst.byp`; a click clears it),
//     ▾ module menu (Factory ▸, user presets, Save FX Preset…, Save as / Clear Default Preset, Duplicate, Remove,
//     Move to ▸, Convert to Serum 2 Module (S1 instances), Init Module), power = the `on` parameter (Alt-click: every
//     module of the rack). Every parameter control carries data-dest = `fx.<instance id>.<pid>` (§3.16.4); Convolve's
//     six IR-shaping controls also carry data-nomod="1" (deviation 20: not drop targets, no halo; the mod layer must
//     refuse drops there) and a "reshapes the IR — not modulatable" tooltip.
// Displays use the real DSP code (FXDSP v2 via wk.loadDSP): distortion filter + transfer curve (distCurve 0–17, drag =
// DRIVE), delay filter, EQ response (eqResponse per instance), FX filter (filterImpulse 0–107; view menu Frequency /
// Phase Response, Alt-click cycles), splitter band responses (splitResponse), compressor GR (host.gr() per FXP instance:
// the instance's index in the fxLayout of the host's own state — a v1 state compiles all ten modules, §4.3), Convolve IR
// overview (host.irs). Display drags are relative (no jump on the press) and edit nothing before 3 px of travel.
//
// Host (Phase-1 members + §11.15): fx(), editFx(fn, opts) (fn mutates the live FX state; opts {label, phase, ui?, seed?}),
// bpm(), gr() → Float32Array(4·48) | null, locked(destId) → bool, storage {get, set}, notify(text), tip(destId)?,
// [+] tap() → Float32Array(1024) | null and setTap(instId | '') (the rack's monitor tap, FXRack.setTap / smon ftap: the
// Delay filter display's realtime spectrum overlay, §13.5 — double-tap / double-click the display; one instance at a
// time; without them the overlay is unavailable),
// racks() → 1 | 3, irs (= host.smp: list / import / overview, Convolve), v2Fx (true or () → bool: the host keeps a v2
// FX state the rack writes into its v1 object, see below; a host whose fx() already is v2 needs no flag). Optional (the
// Serum side of instance operations): s() (serum-ui's adapter) or state() → the Serum state, and edit(fn, opts)
// (Serum-state edit) — without them Duplicate (w/mods) and Shift-Alt-drag are unavailable and a removed instance's
// modulation rows stay (inactive, red in the matrix, §2.3).
// Options: { embedded, dsp, racks: 1 | 3, mod, v2Fx } (mod: the controls are modulation destinations of the host's mod
// layer, which then owns their context menus and drops — default = embedded; without it the rack's own control menu
// (Reset Control, Enter Value…, the control's own items: ctlExtras) answers a right-click / long-press on a control;
// v2Fx: as the host member, the option wins).
//
// State version: the rack edits v2 states. A host that still holds a v1 state (transition) sees its migration
// (normalizeFx2); edits the v1 shape can hold are written back into the v1 object (writeV1), and the first edit it
// cannot hold (an S2 module, a second instance of a type, splitters, buses, rack bypass, S1 → S2 conversion) converts
// the state to v2 in place (migrateFx1 with the Serum state as refs) — only when the host declares v2Fx (it then keeps
// the v2 object). Without v2Fx such an edit is refused with a notice and nothing changes: a host that replaces states it
// cannot read (main.js M1a fxOf: any state without `p` → the v1 default) would otherwise lose the whole rack.
// Instance operations are fx-core's (§2.5, §11.2: newInstance, removeInstance, moveInstance, duplicateInstance,
// copyRack / clearRack / applyRackPreset, rackPresetPayload, upgradeInstance, modulePresetPayload / applyModulePreset,
// migrateChains1, FACTORY_FX_PRESETS / FACTORY_RACKS / FACTORY_CHAINS2); their Serum-state side (rows, locks, MIDI
// entries) is the same fx-core call with the Serum state, replayed on a copy of the FX state taken before the edit.
//
// Pure helpers (node-testable): listRows(fx, rack?), addMenuItems(fx, rack, branch), moveTarget(fx, dragId, dropRow,
// rack?) and the Phase-1 helpers moveModule, ladderLabel, moduleTitle, modulePresetPayload / applyModulePreset (v1 module
// presets), svfDb, impulseDb. Nothing touches the DOM at module top level.
import { knob, numBox, menu, toggle, seg, slider, contextMenu, tooltip, injectStyles, loadDSP, menuSource, theme, fitCanvas, frame,
  saveFile, pickFile, ask, wheelGate, dragSource, modifierBar, ticker } from './wk.js?v=10';
import { CurveEditor, shapeLib } from './graph.js?v=10';
import * as core from './serum-core.js?v=10';

const { DESTS, DEST_INDEX, FX_MODULES, FX_ORDER_DEFAULT, MODFX_LADDER, DLY_LADDER, DIST_MODES, DLY_MODES, REV_LABELS,
  EQ_TYPES_L, EQ_TYPES_H, CMP_RATIO_DETENTS, FILTERS, fmtParam, lawValue, lawNorm, varLabel } = core;

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const fin = x => typeof x === 'number' && isFinite(x);
const arr = x => (Array.isArray(x) ? x : []);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const Doc = () => globalThis.document || null;
const MODS = FX_ORDER_DEFAULT.slice();
const SUBS = { dist: 1, cho: 1, rev: 1 }; // modules with structured (non-DEST) state saved in module presets
const FS = 48000; // display sample rate
// the Delay display's spectrum overlay (§13.5): the rack tap's length and an in-place radix-2 FFT (scratch reused)
const SPEC_N = 1024, SPEC_RE = new Float64Array(SPEC_N), SPEC_IM = new Float64Array(SPEC_N);
function fft1(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const p = i + k, q = p + h, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const deep = v => JSON.parse(JSON.stringify(v));
const warned = new Set();
const warnOnce = (k, ...a) => { if (!warned.has(k)) { warned.add(k); console.warn(...a); } };

/* ================================================================ Phase-1 pure helpers (§8.7.2) */

// New order with module `id` moved so that it ends up at index `toIndex` (clamped). Unknown id → a copy.
export function moveModule(order, id, toIndex) {
  const a = Array.isArray(order) ? order.slice() : [];
  const i = a.indexOf(id);
  if (i < 0) return a;
  a.splice(i, 1);
  a.splice(clamp(Math.round(+toIndex || 0), 0, a.length), 0, id);
  return a;
}

// Ladder label at normalised n: 'modfx' = Flanger/Phaser/Chorus RATE with BPM on (§3.10, 31 entries),
// 'dly' = Delay TIME with BPM on (12 entries).
export function ladderLabel(kind, n) {
  const L = kind === 'dly' ? DLY_LADDER : MODFX_LADDER;
  return L[clamp(Math.round(clamp(+n || 0, 0, 1) * (L.length - 1)), 0, L.length - 1)].label;
}

// Title of a v1 module id (Phase-1 labels), else of a v2 type id (FXTYPES label), else the id itself.
export function moduleTitle(id) {
  const m = FX_MODULES.find(x => x.id === id);
  if (m) return m.label;
  const t = typeOf(id);
  return t ? t.label : String(id);
}

// DEST ids a v1 module preset carries: every FX dest of the module except its enable (Hyper also Dimension).
const PRESET_IDS = {};
for (const m of MODS) {
  PRESET_IDS[m] = DESTS.filter(d => (d.id.startsWith('fx.' + m + '.') || (m === 'hyper' && d.id.startsWith('fx.dim.'))) && d.id !== 'fx.' + m + '.on').map(d => d.id);
}
const defOf = id => DESTS[DEST_INDEX[id]].def;
function modOf(payload) {
  if (payload && MODS.includes(payload.m)) return payload.m;
  const P = payload && payload.p && typeof payload.p === 'object' ? payload.p : {};
  for (const k of Object.keys(P)) {
    const x = /^fx\.([a-z]+)\./.exec(k);
    if (x) return x[1] === 'dim' ? 'hyper' : MODS.includes(x[1]) ? x[1] : null;
  }
  return null;
}
function lockTest(locked) {
  if (typeof locked === 'function') return id => !!locked(id);
  if (locked instanceof Set) return id => locked.has(id);
  if (Array.isArray(locked)) return id => locked.includes(id);
  return () => false;
}
const normV1 = fx => (typeof core.normalizeFxV1 === 'function' ? core.normalizeFxV1(fx) : core.normalizeFx(fx));

// v1 module preset payload (Phase-1 §9.6): { name, m, p: { fx.<m>.* except .on (Hyper: + fx.dim.*) }, sub? }.
export function modulePresetPayload(fx, m, name) {
  const P = fx && fx.p && typeof fx.p === 'object' ? fx.p : {};
  const p = {};
  for (const id of PRESET_IDS[m] || []) p[id] = fin(P[id]) ? P[id] : defOf(id);
  const out = { name: String(name == null ? '' : name), m, p };
  if (SUBS[m] && fx && fx[m] && typeof fx[m] === 'object') out.sub = deep(fx[m]);
  return out;
}

// Applies a v1 module preset to a v1 FX state and returns a NEW normalised v1 state: the module's values and
// structured state from the payload, except locked dest ids; enable, bypass, order and every other module unchanged.
export function applyModulePreset(fx, payload, lockedIds) {
  const out = normV1(fx);
  const m = modOf(payload);
  if (!m) return out;
  const locked = lockTest(lockedIds), P = payload.p && typeof payload.p === 'object' ? payload.p : {};
  for (const id of PRESET_IDS[m]) if (!locked(id) && fin(P[id])) out.p[id] = P[id];
  const sub = payload.sub && typeof payload.sub === 'object' ? payload.sub : null;
  if (sub && m === 'dist') { if (Array.isArray(sub.xa)) out.dist.xa = sub.xa; if (Array.isArray(sub.xb)) out.dist.xb = sub.xb; }
  if (sub && m === 'cho' && sub.mono != null) out.cho.mono = sub.mono;
  if (sub && m === 'rev' && sub.type != null) out.rev.type = sub.type;
  return normV1(out);
}

// Magnitude (dB) of the distortion module's TPT SVF at f: bilinear analog prototype with the LP/BP/HP morph of
// §8.5.3 (band-pass normalised to unity peak). Display helper.
export function svfDb(F, Q, lbh, f, fs) {
  const g = Math.tan(Math.PI * Math.min(F, 0.49 * fs) / fs), W = Math.tan(Math.PI * Math.min(f, 0.4999 * fs) / fs) / g;
  const dr = 1 - W * W, di = W / Q, den = dr * dr + di * di;
  let nr, ni;
  if (lbh <= 0.5) { const a = 2 * lbh; nr = 1 - a; ni = a * W / Q; } else { const b = 2 * lbh - 1; nr = -b * W * W; ni = (1 - b) * W / Q; }
  return 10 * Math.log10((nr * nr + ni * ni) / den + 1e-30);
}

// Magnitude (dB) of an impulse response at the given frequencies (direct DFT; display helper for filterImpulse).
export function impulseDb(imp, fs, freqs) {
  const out = new Float64Array(freqs.length), n = imp.length;
  for (let k = 0; k < freqs.length; k++) {
    const w = 2 * Math.PI * freqs[k] / fs, c = Math.cos(w), s = Math.sin(w);
    let re = 0, im = 0, cr = 1, ci = 0;
    for (let i = 0; i < n; i++) {
      const v = imp[i];
      re += v * cr; im -= v * ci;
      const t = cr * c - ci * s; ci = cr * s + ci * c; cr = t;
      if ((i & 255) === 255) { const m = Math.hypot(cr, ci); cr /= m; ci /= m; } // keep the rotator on the unit circle
    }
    out[k] = 10 * Math.log10(re * re + im * im + 1e-30);
  }
  return out;
}

// Phase (degrees, −180…180) of an impulse response at the given frequencies (direct DFT; the FX filter's phase view)
function impulsePhase(imp, fs, freqs) {
  const out = new Float64Array(freqs.length), n = imp.length;
  for (let k = 0; k < freqs.length; k++) {
    const w = 2 * Math.PI * freqs[k] / fs, c = Math.cos(w), s = Math.sin(w);
    let re = 0, im = 0, cr = 1, ci = 0;
    for (let i = 0; i < n; i++) {
      const v = imp[i];
      re += v * cr; im -= v * ci;
      const t = cr * c - ci * s; ci = cr * s + ci * c; cr = t;
      if ((i & 255) === 255) { const m = Math.hypot(cr, ci); cr /= m; ci /= m; }
    }
    out[k] = re === 0 && im === 0 ? 0 : Math.atan2(im, re) * 180 / Math.PI;
  }
  return out;
}

/* ================================================================ v2 model helpers (§2.5, §3.16) */

const TYPES = arr(core.FXTYPES);
function typeOf(id) { for (const t of TYPES) if (t.id === id) return t; return null; }
const tabOf = (type, v) => (core.FXP_TAB && core.FXP_TAB[type] && Array.isArray(core.FXP_TAB[type][v]) ? core.FXP_TAB[type][v] : []);
function rowIn(type, v, pid) { for (const r of tabOf(type, v)) if (r.pid === pid) return r; return null; }
const stepsOfRow = r => (r && (r.law === 'int' || r.law === 'enum' || r.law === 'bool') ? r.hi - r.lo : 0);
const snapRow = (r, n) => { const g = stepsOfRow(r), x = clamp(fin(n) ? n : r.def, 0, 1); return g ? Math.round(x * g) / g : x; };
const isSplit = type => { const t = typeOf(type); return !!(t && t.split); };
const hasS2 = type => { const t = typeOf(type); return !!(t && Array.isArray(t.variants) && t.variants.indexOf(2) >= 0); };
// the S1 badge's tooltip: the conversion is offered only for types with an S2 variant (Hyper / Flanger have none, §2.5)
const s1Tip = type => (hasS2(type) ? 'Serum 1 variant (Convert to Serum 2 Module in its menu)' : 'Serum 1 module (it has no Serum 2 variant)');
// splitter branch labels (§13.5)
const BRANCH_LABELS = { split2: ['LOWS', 'HIGHS'], split3: ['LOWS', 'MIDS', 'HIGHS'], splitms: ['MID', 'SIDE'] };
// add menu order (inv B14.1 list): the 13 effects alphabetically, then the 3 splitters
const ADD_EFFECTS = ['bode', 'cho', 'cmp', 'conv', 'dly', 'dist', 'eq', 'fil', 'flg', 'hyper', 'phs', 'rev', 'util'];
const ADD_SPLITTERS = ['split2', 'split3', 'splitms'];
const MAX_TOP = 16, MAX_BR = 8, MAX_ALL = fin(core.MAX_INST) ? core.MAX_INST : 48;
const RACK_NAMES = ['MAIN', 'BUS 1', 'BUS 2'];
const isV2 = fx => isObj(fx) && fin(fx.v) && fx.v >= 2 && Array.isArray(fx.racks);
const DIAG = () => [[0, 0, 0], [1, 1, 0]];
const emptyRack = () => ({ mods: [], byp: 0, lock: 0, route: 0 });
const defaultV2 = () => core.defaultFx2();
// the v2 state of any FX state (v1 → its migration; nothing → the default)
function viewOf(fx, refs) {
  if (isV2(fx)) return fx;
  return isObj(fx) ? core.normalizeFx2(fx, refs) : defaultV2();
}

// Visits the instances of a v2 state in processing order (fx-core walk = fxLayout order): racks 0, 1, 2; list order;
// a splitter followed depth-first by its branch lists. fn(inst, {rack, parent, branch, list, index, n}); false stops.
function walk(fx, fn) {
  let n = 0;
  const R = isObj(fx) ? arr(fx.racks) : [];
  for (let k = 0; k < R.length && k < 3; k++) {
    const mods = isObj(R[k]) ? arr(R[k].mods) : [];
    for (let j = 0; j < mods.length; j++) {
      const I = mods[j];
      if (!isObj(I)) continue;
      if (fn(I, { rack: k, parent: null, branch: -1, list: mods, index: j, n: n++ }) === false) return;
      if (isSplit(I.type) && Array.isArray(I.br)) {
        for (let b = 0; b < I.br.length; b++) {
          const L = arr(I.br[b]);
          for (let q = 0; q < L.length; q++) if (isObj(L[q]) && fn(L[q], { rack: k, parent: I, branch: b, list: L, index: q, n: n++ }) === false) return;
        }
      }
    }
  }
}
function findInst(fx, id) {
  let out = null;
  walk(fx, (I, w) => { if (I.id === id) { out = Object.assign({ inst: I }, w); return false; } return true; });
  return out;
}
function countInst(fx) { let n = 0; walk(fx, () => { n++; }); return n; }
// structured data of a fresh instance (Init Module; fx-core's normalisation defaults)
function subDefault(type, v) {
  if (type === 'dist') return { xa: DIAG(), xb: DIAG() };
  if (type === 'cho') return { mono: 0 };
  if (type === 'rev') return v === 1 ? { type: 1 } : {};
  if (type === 'conv') return { ir: core.CONV_IR_DEFAULT || 'fir:Medium/Chamber' };
  return {};
}
function makeInst(id, type, v) {
  const p = {};
  for (const r of tabOf(type, v)) p[r.pid] = r.def;
  const I = { id, type, v, byp: 0, p, sub: subDefault(type, v), ph: 0, ui: { lvl: 0, lvl2: 0 } };
  const T = typeOf(type);
  if (T && T.split) { I.br = Array.from({ length: T.split }, () => []); I.bb = new Array(T.split).fill(0); }
  return I;
}
// the list a target {rack, splitter, branch} names (null when it does not exist)
function listAt(fx, to) {
  if (!to) return null;
  if (to.splitter) { const f = findInst(fx, to.splitter); return f && Array.isArray(f.inst.br) && Array.isArray(f.inst.br[to.branch | 0]) ? f.inst.br[to.branch | 0] : null; }
  const R = arr(fx.racks)[clamp(to.rack | 0, 0, 2)];
  return isObj(R) && Array.isArray(R.mods) ? R.mods : null;
}
// v2 module preset payload ({type: 'synth.fxmod', v: 2, name, ftype, fv, p, sub}); a v1 payload ({name, m, p: {fx.<m>.*},
// sub}) is read as its v2 form (S1 variant, Dimension rows renamed). fx-core applies either (an S1 payload on an S2
// instance through upgradeInstance, §11.2)
function payloadV2(x) {
  if (!isObj(x)) return null;
  if (x.type === 'synth.fxmod' || typeof x.ftype === 'string') {
    if (!typeOf(x.ftype) || !isObj(x.p)) return null;
    return { type: 'synth.fxmod', v: 2, name: String(x.name || ''), ftype: x.ftype, fv: x.fv === 1 ? 1 : 2, p: x.p, sub: isObj(x.sub) ? x.sub : {} };
  }
  const m = modOf(x);
  if (!m || !isObj(x.p)) return null;
  const p = {}, R = core.RENAME1 || {};
  for (const k of Object.keys(x.p)) {
    const id = R[k] || k, mm = /^fx\.[a-z]+\.([A-Za-z0-9]+)$/.exec(id);
    if (mm) p[mm[1]] = x.p[k];
  }
  return { type: 'synth.fxmod', v: 2, name: String(x.name || ''), ftype: m, fv: 1, p, sub: isObj(x.sub) ? x.sub : {} };
}

/* ---------------------------------------------------------------- instance operations: fx-core (§11.2) */
// The instance rules (ids, caps 16 / 8 / 48, no splitter in a branch, default module presets, S1 → S2 conversion, rack
// presets and clipboard, module presets) are fx-core's; the rack UI only calls them. Their Serum-state side (matrix rows,
// locked controls and MIDI entries addressing instances, incl. a splitter's branch instances and Hyper's v1 Dimension
// ids) is the same fx-core operation replayed with the Serum state on a copy of the FX state as it was before the edit,
// through the host's Serum edit (FXRackUI.refs).

// v1 host state (transition): the edited v2 view V written back into the host's v1 object `fx` (in place) when V still
// has the v1 shape — BUS 1 / BUS 2 empty, unrouted, unbypassed, unlocked; no MAIN rack bypass; every instance a
// top-level S1 instance whose id is its Phase-1 module. Modules absent from V (the pristine ones migrateFx1 leaves out,
// removed ones) are written at their v1 defaults, disabled, and keep their slots in the order and their MIX / LEVEL
// labels; the present ones take the slots of the present ones in V's order (an edit that moves nothing keeps the v1
// order exactly, so a disabled module later switched on outside the rack — MIDI learn, a v1 edit — runs where it did).
// ui.rack / expand / br have no v1 field (FXRackUI keeps them for the session). → false (nothing written) when V needs
// the v2 shape
const PH_SLOT = { hyper: 0, flg: 1, phs: 2, cho: 3 };
const DIM_V1 = { dsize: 'fx.dim.size', dmix: 'fx.dim.mix', dlevel: 'fx.dim.level' };
function writeV1(V, fx) {
  const R = arr(V.racks);
  if (R.length !== 3 || !isObj(R[0]) || R[0].byp) return false;
  for (let k = 1; k < 3; k++) if (!isObj(R[k]) || arr(R[k].mods).length || R[k].byp || R[k].lock || R[k].route) return false;
  const present = new Map();
  for (const I of arr(R[0].mods)) {
    if (!isObj(I) || I.v !== 1 || I.id !== I.type || MODS.indexOf(I.type) < 0 || present.has(I.id)) return false;
    present.set(I.id, I);
  }
  const old = normV1(fx), d = typeof core.defaultFxV1 === 'function' ? core.defaultFxV1() : normV1({});
  const queue = [...present.keys()];
  const out = { v: 1, order: old.order.map(m => (present.has(m) ? queue.shift() : m)), byp: {}, p: Object.assign({}, old.p),
    dist: deep(d.dist), cho: deep(d.cho), rev: deep(d.rev), phase: old.phase.slice(), lock: R[0].lock ? 1 : 0,
    ui: { lvl: Object.assign({}, old.ui.lvl), sel: '' } };
  for (const m of MODS) {
    const I = present.get(m) || null, P = I && isObj(I.p) ? I.p : {};
    for (const r of tabOf(m, 1)) {
      const id = m === 'hyper' && DIM_V1[r.pid] ? DIM_V1[r.pid] : 'fx.' + m + '.' + r.pid;
      out.p[id] = I && fin(P[r.pid]) ? P[r.pid] : d.p[id];
    }
    out.byp[m] = I && I.byp ? 1 : 0;
    if (I) {
      const U = isObj(I.ui) ? I.ui : {};
      out.ui.lvl[m] = U.lvl ? 1 : 0;
      if (m === 'hyper') out.ui.lvl.dim = U.lvl2 ? 1 : 0;
    }
    if (I && PH_SLOT[m] !== undefined && fin(I.ph)) out.phase[PH_SLOT[m]] = I.ph;
    const S = I && isObj(I.sub) ? I.sub : null;
    if (S && m === 'dist') { if (Array.isArray(S.xa)) out.dist.xa = deep(S.xa); if (Array.isArray(S.xb)) out.dist.xb = deep(S.xb); }
    if (S && m === 'cho') out.cho.mono = S.mono ? 1 : 0;
    if (S && m === 'rev') out.rev.type = S.type === 0 ? 0 : 1;
  }
  if (isObj(V.ui) && present.has(V.ui.sel)) out.ui.sel = V.ui.sel;
  const n = normV1(out);
  for (const k of Object.keys(fx)) delete fx[k];
  Object.assign(fx, n);
  return true;
}

// laws of a (type, variant) row without the static v1 table (a one-instance state whose id 'q' is no v1 module):
// engine value ↔ n through serum-core's dynamic-id path
const VIEWS = new Map();
function lawView(type, v) {
  const k = type + v;
  let f = VIEWS.get(k);
  if (!f) {
    const I = makeInst('q', type, v);
    f = { v: 2, racks: [{ mods: [I], byp: 0, lock: 0, route: 0 }, emptyRack(), emptyRack()], ui: { rack: 0, sel: '', expand: 0, br: {} } };
    VIEWS.set(k, f);
  }
  return f;
}
const lawV = (type, v, pid, n) => lawValue('fx.q.' + pid, n, lawView(type, v));
const lawN = (type, v, pid, x) => lawNorm('fx.q.' + pid, x, lawView(type, v));
// relative drag of a frequency parameter along a display's log axis (1000 : 1 over the plot width): the start value n0
// moved by `ax` plot widths, held inside the law's own range (8.18 Hz–22.05 kHz for the cutoffs — not the display's
// 20 Hz–20 kHz, so a drag without horizontal travel never changes the value); → {n, ax} (ax clamped to that range)
function relFreq(type, v, pid, n0, ax) {
  const f0 = lawV(type, v, pid, n0), lo = lawV(type, v, pid, 0), hi = lawV(type, v, pid, 1);
  if (!(f0 > 0 && lo > 0 && hi > lo)) { const a = clamp(ax, -n0, 1 - n0); return { n: clamp(n0 + a, 0, 1), ax: a }; }
  const L = Math.log(1000), a = clamp(ax, Math.log(lo / f0) / L, Math.log(hi / f0) / L);
  return { n: a === 0 ? n0 : clamp(lawN(type, v, pid, f0 * Math.pow(1000, a)), 0, 1), ax: a };
}
// enum label of a row at n (FXTYPES enum formats: DIST_MODES2, FILTERS, REV_TYPES2, NITROUS_MODES, DLY_LADDER, …)
function enumLabel(r, n) {
  const g = stepsOfRow(r), k = g ? Math.round(clamp(n, 0, 1) * g) : 0, name = typeof r.fmt === 'string' && r.fmt.slice(0, 5) === 'enum:' ? r.fmt.slice(5) : '';
  const L = name && Array.isArray(core[name]) ? core[name] : null, e = L ? L[k + (r.lo | 0)] : undefined;
  return e === undefined ? String(k) : typeof e === 'string' ? e : String(e.label || e.name || k);
}

/* ================================================================ v2 pure helpers (§11.14, §15.12) */

// Rows of the list view of rack `rack` (default fx.ui.rack) in display order:
//   {kind: 'inst', key, id, type, v, label, rack, parent (splitter id | null), branch (−1 at the top level), index (in
//    its list), depth (0 top level, 1 inside a branch), on, byp, s1, split (branch count), n (fxLayout index)}
//   {kind: 'branch', key, rack, parent, branch, label (LOWS …), byp, depth: 1, len}   a splitter's branch header
//   {kind: 'end', key, rack, parent, branch, depth: 1, at}                            the end slot of a branch
// A splitter row is followed by, for each branch, its header, its instances and its end slot.
export function listRows(fx, rack) {
  const F = viewOf(fx), U = isObj(F.ui) ? F.ui : {};
  const k = clamp(Math.round(fin(rack) ? rack : fin(U.rack) ? U.rack : 0), 0, 2);
  const out = [], at = new Map();
  walk(F, (I, w) => { if (w.rack === k) at.set(I, w.n); });
  const row = (I, parent, branch, index, depth) => {
    const T = typeOf(I.type), on = isObj(I.p) && fin(I.p.on) ? I.p.on >= 0.5 : (rowIn(I.type, I.v, 'on') || { def: 0 }).def >= 0.5;
    return { kind: 'inst', key: I.id, id: I.id, type: I.type, v: I.v, label: instTitle(F, I.id), rack: k, parent, branch, index, depth, on,
      byp: I.byp ? 1 : 0, s1: I.v === 1, split: T && T.split ? T.split : 0, n: at.has(I) ? at.get(I) : -1 };
  };
  const R = arr(F.racks)[k], mods = isObj(R) ? arr(R.mods) : [];
  mods.forEach((I, j) => {
    if (!isObj(I)) return;
    out.push(row(I, null, -1, j, 0));
    if (!isSplit(I.type) || !Array.isArray(I.br)) return;
    I.br.forEach((B, b) => {
      out.push(branchRow(I, k, b));
      arr(B).forEach((c, q) => { if (isObj(c)) out.push(row(c, I.id, b, q, 1)); });
      out.push(endRow(I, k, b));
    });
  });
  return out;
}
function branchRow(P, k, b) {
  const L = BRANCH_LABELS[P.type] || [];
  return { kind: 'branch', key: P.id + '/' + b, rack: k, parent: P.id, branch: b, label: L[b] || 'BRANCH ' + (b + 1), byp: Array.isArray(P.bb) && P.bb[b] ? 1 : 0,
    depth: 1, len: arr(P.br[b]).length };
}
function endRow(P, k, b) { return { kind: 'end', key: P.id + '/' + b + '/end', rack: k, parent: P.id, branch: b, depth: 1, at: arr(P.br[b]).length }; }

// Items of the "+" menu of rack `rack` (top level: branch null) or of a splitter branch (branch = {splitter, branch}):
// [{type, label, group: 'Effects' | 'Splitters', disabled}] — 13 effects (+ 3 splitters at the top level); disabled
// when the list (16 per rack, 8 per branch) or the track (48) is full.
export function addMenuItems(fx, rack, branch) {
  const F = viewOf(fx), U = isObj(F.ui) ? F.ui : {};
  const k = clamp(Math.round(fin(rack) ? rack : fin(U.rack) ? U.rack : 0), 0, 2);
  const inBr = isObj(branch) && typeof branch.splitter === 'string';
  const list = inBr ? listAt(F, { splitter: branch.splitter, branch: branch.branch | 0 }) : listAt(F, { rack: k });
  const full = !list || list.length >= (inBr ? MAX_BR : MAX_TOP) || countInst(F) >= MAX_ALL;
  const out = [];
  for (const t of ADD_EFFECTS) { const T = typeOf(t); if (T) out.push({ type: t, label: T.label, group: 'Effects', disabled: full }); }
  if (!inBr) for (const t of ADD_SPLITTERS) { const T = typeOf(t); if (T) out.push({ type: t, label: T.label, group: 'Splitters', disabled: full }); }
  return out;
}

// Destination of dropping instance `dragId` before row `dropRow` of listRows(fx, rack) (dropRow = rows.length: the end
// of the rack): {rack, splitter (id | null), branch, at} with `at` = the instance's final index in that list, or null
// (unknown instance, a splitter into a branch, a full list). Gaps: before an instance → its position; before a branch
// header → the end of the previous branch (branch 0: the start of branch 0); before a branch end slot → that branch's end.
// copy = true (Alt-drag duplicates): `at` is the insertion index of the copy (the original stays) and the destination
// list must have room even when it is the instance's own list.
export function moveTarget(fx, dragId, dropRow, rack, copy) {
  const F = viewOf(fx), U = isObj(F.ui) ? F.ui : {};
  const k = clamp(Math.round(fin(rack) ? rack : fin(U.rack) ? U.rack : 0), 0, 2);
  const src = findInst(F, dragId);
  if (!src) return null;
  const rows = listRows(F, k), i = clamp(Math.round(+dropRow || 0), 0, rows.length);
  let to;
  if (i >= rows.length) to = { rack: k, splitter: null, branch: 0, at: arr(F.racks[k].mods).length };
  else {
    const r = rows[i];
    if (r.kind === 'inst') to = { rack: k, splitter: r.parent, branch: r.parent ? r.branch : 0, at: r.index };
    else if (r.kind === 'branch') {
      const P = findInst(F, r.parent).inst;
      to = r.branch === 0 ? { rack: k, splitter: r.parent, branch: 0, at: 0 } : { rack: k, splitter: r.parent, branch: r.branch - 1, at: arr(P.br[r.branch - 1]).length };
    } else to = { rack: k, splitter: r.parent, branch: r.branch, at: r.at };
  }
  if (to.splitter && (isSplit(src.inst.type) || to.splitter === dragId)) return null;
  const same = src.rack === to.rack && (src.parent ? src.parent.id : null) === to.splitter && (!to.splitter || src.branch === to.branch);
  if (same && !copy && src.index < to.at) to.at -= 1;
  if (!same || copy) {
    const L = listAt(F, to);
    if (!L || L.length >= (to.splitter ? MAX_BR : MAX_TOP)) return null;
  }
  return to;
}

// instance title (§3.16.4 instance label without the bus suffix: the rack tab names the bus)
function instTitle(fx, id) {
  let t = '';
  try { t = typeof core.instLabel === 'function' ? core.instLabel(fx, id) : ''; } catch (err) { t = ''; }
  if (!t) { const f = findInst(fx, id); t = f ? moduleTitle(f.inst.type) : id; }
  return String(t).replace(/ \(Bus \d\)$/, '');
}

/* ================================================================ styles (v2 additions to wk's .fxr-* rules) */

const CSS = `
.fxr2 { grid-template-rows: auto minmax(0, 1fr); }
.fxr2-bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.fxr2-tabs { display: flex; gap: 2px; flex: 1 1 auto; min-width: 0; }
.fxr2-tab { position: relative; min-height: 26px; padding: 3px 12px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px 4px 0 0; font: 700 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.1em; cursor: pointer; }
.fxr2-tab[aria-selected="true"] { color: var(--sx-ink, #dfe6ee); border-bottom-color: var(--sx-accent, #4fb3ff); box-shadow: inset 0 -2px 0 var(--sx-accent, #4fb3ff); }
.fxr2-tab.fxr2-tbyp::after { content: ''; position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--sx-warn, #ff6a4a); }
.fxr2-tab.fxr2-tlock::before { content: '🔒'; font-size: 8px; margin-right: 4px; }
.fxr2-title { flex: 1 1 auto; color: var(--sx-mute, #7f8b98); font: 700 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.12em; }
.fxr2-exp.wk-on { color: var(--sx-accent, #4fb3ff); }
.fxr2-expand { grid-template-columns: minmax(0, 1fr); }
.fxr2-expand .fxr-side { display: none; }
.fxr2-list { gap: 2px; }
.fxr2-row { position: relative; }
.fxr2-d1 { margin-left: 16px; }
.fxr2-row.fxr2-off .fxr-tname { color: var(--sx-mute, #7f8b98); }
.fxr2-s1, .fxr2-chip { flex: 0 0 auto; padding: 1px 4px; color: var(--sx-neg, #ffb347); border: 1px solid currentColor; border-radius: 3px; font: 700 8px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.06em; }
.fxr2-chip { color: var(--sx-warn, #ff6a4a); background: none; cursor: pointer; }
.fxr2-brow { display: flex; align-items: center; gap: 4px; margin-left: 8px; padding: 2px 4px; color: var(--sx-mute, #7f8b98); border-left: 2px solid var(--sx-line, #2a333d); font: 700 9px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.1em; }
.fxr2-brow .fxr2-blab { flex: 1 1 auto; }
.fxr2-brow.fxr2-bsel { color: var(--sx-ink, #dfe6ee); border-left-color: var(--sx-accent, #4fb3ff); }
.fxr2-bend { min-height: 6px; margin-left: 16px; color: var(--sx-mute, #7f8b98); font: 500 9px/1.4 var(--ui, system-ui, sans-serif); }
.fxr2-bend:not(:empty) { padding: 2px 6px; border: 1px dashed var(--sx-line, #2a333d); border-radius: 4px; }
.fxr2-plus, .fxr2-bbyp { min-width: 22px; min-height: 22px; margin: 0; padding: 1px 6px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 700 11px/1 var(--ui, system-ui, sans-serif); cursor: pointer; }
.fxr2-bbyp[aria-pressed="true"], .fxr2-rbyp[aria-pressed="true"] { color: #fff; background: var(--sx-warn, #ff6a4a); border-color: var(--sx-warn, #ff6a4a); }
.fxr2-add { align-self: flex-start; }
.fxr2-mod.fxr2-off .fxr-mbody { opacity: 0.45; }
.fxr2-mod .fxr-mhead { gap: 5px; }
.fxr2-brbox { display: flex; flex-direction: column; gap: 8px; margin: 0 0 8px 14px; padding-left: 8px; border-left: 2px solid var(--sx-accent, #4fb3ff); }
.fxr2-brsel { display: flex; flex-wrap: wrap; gap: 6px; }
.fxr2-bpanel { display: flex; align-items: center; gap: 4px; padding: 3px 6px; background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; }
.fxr2-bpanel.fxr2-bsel { border-color: var(--sx-accent, #4fb3ff); }
.fxr2-bname { margin: 0; padding: 4px 6px; color: var(--sx-ink, #dfe6ee); background: none; border: 0; font: 700 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.1em; cursor: pointer; }
.fxr2-hide { display: none !important; }
.fxr2-irn { flex: 1 1 180px; min-width: 140px; }
.fxr2-note { color: var(--sx-mute, #7f8b98); font: 500 10px/1.3 var(--ui, system-ui, sans-serif); }
.fxr2-drop { outline: 2px dashed var(--sx-accent, #4fb3ff); outline-offset: -2px; }
[data-nomod] .wk-svg { opacity: 0.85; }
.fxr2 .fxr-gr { touch-action: none; }
.fxr2-emb { flex: 0 0 auto; align-self: center; padding: 1px 5px; color: var(--sx-on, #6fe3a1); border: 1px solid currentColor; border-radius: 3px; font: 700 8px/1.4 var(--ui, system-ui, sans-serif); letter-spacing: 0.08em; }
@media (max-width: 699px) { .fxr2 .fxr2-list { flex-direction: column; overflow-x: visible; } .fxr2-d1 { margin-left: 10px; } }
`;
// §13.1 touch rules (targets ≥ 44 px): emitted under `@media (pointer: coarse)` and again under `.wk-touch` (wk adds it to
// <html> at the first touch: an iPad with a trackpad reports a fine pointer), as wk's own rules. The bypass chips keep
// their height and get a transparent ::before that extends their hit box vertically to 44 px (wk's HIT44 pattern:
// layouts do not grow, horizontal neighbours never overlap) and a 44 px minimum width
const HIT44 = "content: ''; position: absolute; left: 0; right: 0; top: min(0px, calc(50% - 22px)); bottom: min(0px, calc(50% - 22px));";
const TOUCH = [
  ['.fxr2-tab, .fxr2-bname', 'min-height: 44px;'],
  ['.fxr2-plus, .fxr2-bbyp', 'min-height: 44px; min-width: 44px;'],
  ['.fxr2-bname', 'padding: 10px 8px;'],
  ['.fxr2-chip', 'position: relative; min-width: 44px;'],
  ['.fxr2-chip::before', HIT44],
];
function touchCSS() {
  const pre = sel => sel.split(',').map(x => '.wk-touch ' + x.trim()).join(', ');
  return '@media (pointer: coarse) {\n' + TOUCH.map(([sel, b]) => '  ' + sel + ' { ' + b + ' }').join('\n') + '\n}\n'
    + TOUCH.map(([sel, b]) => pre(sel) + ' { ' + b + ' }').join('\n') + '\n';
}
function injectFxStyles(d) {
  if (!d || !d.head || (typeof d.getElementById === 'function' && d.getElementById('fxr2-css'))) return;
  const st = d.createElement('style');
  st.id = 'fxr2-css';
  st.textContent = CSS + touchCSS();
  d.head.appendChild(st);
}

/* ================================================================ FXRackUI */
function h(tag, cls, text) {
  const e = Doc().createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, label) {
  const b = h('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
}
const show = (e, on) => { e.hidden = !on; };
const logX = (f, w, pad) => pad + Math.log(f / 20) / Math.log(1000) * (w - 2 * pad);
const fAtX = (x, w, pad) => 20 * Math.pow(1000, clamp((x - pad) / (w - 2 * pad), 0, 1));
const closest = (n, stop, test) => { for (; n && n !== stop; n = n.parentNode) if (n.getAttribute && test(n)) return n; return null; };
const keysOf = e => (modifierBar && typeof modifierBar.mods === 'function' ? modifierBar.mods(e) : { alt: !!(e && e.altKey), shift: !!(e && e.shiftKey), fine: !!(e && e.shiftKey) });
const consume = () => { if (modifierBar && typeof modifierBar.consume === 'function') modifierBar.consume(); };
// gesture.js's synthetic pointercancel: a second finger made this touch a pan / pinch — the drag is rolled back
const twoF = e => !!e && e.gesture === 'two-finger';
// §13.1 / §13.5: a touch long-press (500 ms) opens the context menu of a custom element as a right-click does
// (wk.menuSource: one `contextmenu`, the browser's duplicate swallowed); the click that ends a touch long-press is eaten
// (a long-press on a branch's BYP button must not also toggle it). → remover
function pressMenu(el) {
  const off = menuSource(el, { keys: false });
  let down = false, touch = false, eat = false;
  const L = [
    ['pointerdown', e => { down = true; touch = e.pointerType === 'touch'; eat = false; }],
    ['pointerup', () => { down = false; }],
    ['pointercancel', () => { down = false; }],
    ['contextmenu', () => { if (down && touch) eat = true; }],
    ['keydown', () => { eat = false; }],
    ['click', e => { if (!eat) return; eat = false; e.preventDefault(); e.stopPropagation(); }],
  ];
  for (const [t, f] of L) el.addEventListener(t, f, true);
  return () => { off(); for (const [t, f] of L) el.removeEventListener(t, f, true); };
}
// module-level rack clipboard (Cut / Copy / Paste FX Bus): survives preset changes and track switches in this page
let RACK_CLIP = null;

export class FXRackUI {
  constructor(root, host, opts) {
    injectStyles();
    this.host = host || {};
    this.opts = opts || {};
    this.embedded = !!this.opts.embedded;
    this.modOn = this.opts.mod !== undefined ? !!this.opts.mod : this.embedded;
    this.dsp = this.opts.dsp || null;
    injectFxStyles((root && root.ownerDocument) || Doc());
    this.knobs = new Map();       // destination id → widget (setMod for halos; the MIX / LEVEL knob under both ids)
    this.panels = new Map();      // instance id → panel
    this.rowWidgets = [];
    this.rowEls = [];             // list rows in display order: { el, row }
    this.offs = [];
    this.dead = false;
    this.specId = ''; this.specD = null; this.specTick = null;   // the Delay display's spectrum overlay (§13.5)
    this.pending = null;
    this.xs = null;
    this.sig = null;
    this.vcache = null;
    this.v1ui = null;             // a v1 host state's view ui (rack tab, expand, branches): kept for the session
    this.irData = new Map();      // IR id → Float32Array overview | null (requested)
    this.irList = null;
    this.shapes = shapeLib(this.host.storage);
    this.build(root);
    const RO = globalThis.ResizeObserver;
    if (typeof RO === 'function') {
      const ro = new RO(() => { if (!this.dead) { this.redraw(); this.drawGrs(); } });
      ro.observe(this.rack);
      this.offs.push(() => ro.disconnect());
    }
    if (!this.dsp) {
      loadDSP().then(r => { if (!this.dead && r && r.FXDSP) { this.dsp = r.FXDSP; this.redraw(true); } }, () => {});
    }
    this.refresh();
    const sel = this.fx().ui && this.fx().ui.sel;
    if (sel) this.scrollTo(sel, false);
  }

  /* ---------------------------------------------------------- state access */
  // the v2 FX state shown (a v1 host state: its migration with this view's session ui — rack tab, expand, branches —
  // memoised per object until the next refresh / edit)
  fx() {
    const raw = this.host.fx ? this.host.fx() : null;
    if (isV2(raw)) return raw;
    if (this.vcache && this.vcache.raw === raw) return this.vcache.v;
    const v = viewOf(raw, this.sState());
    if (isObj(v.ui) && this.v1ui) Object.assign(v.ui, deep(this.v1ui));
    this.vcache = { raw, v };
    return v;
  }
  // the Serum state of the track (host.state(), or host.s() as serum-ui's adapter names it), null for other models
  sState() {
    const H = this.host, f = typeof H.state === 'function' ? H.state : typeof H.s === 'function' ? H.s : null;
    try { const s = f ? f.call(H) : null; return isObj(s) ? s : null; } catch (err) { return null; }
  }
  bpm() { const b = this.host.bpm ? +this.host.bpm() : 120; return b > 0 ? b : 120; }
  racksN() {
    const r = this.opts.racks !== undefined ? this.opts.racks : typeof this.host.racks === 'function' ? this.host.racks() : 1;
    return r === 3 ? 3 : 1;
  }
  curRack() { if (this.racksN() < 3) return 0; const u = this.fx().ui; return isObj(u) && fin(u.rack) ? clamp(u.rack | 0, 0, 2) : 0; }
  inst(id) { const f = findInst(this.fx(), id); return f ? f.inst : null; }
  val(id, pid) {
    const I = this.inst(id);
    if (I && isObj(I.p) && fin(I.p[pid])) return I.p[pid];
    const r = I ? rowIn(I.type, I.v, pid) : null;
    return r ? r.def : 0;
  }
  // whether the host keeps a v2 state written into its v1 object (opts.v2Fx, else host.v2Fx: true or a function)
  v2ok() {
    const o = this.opts.v2Fx !== undefined ? this.opts.v2Fx : this.host.v2Fx;
    try { return typeof o === 'function' ? !!o.call(this.host) : !!o; } catch (err) { return false; }
  }
  // every edit goes through host.editFx. A v1 host state (transition, see the header) is edited as its v2 view; the
  // result is written back in the v1 shape while it still is one (writeV1: parameters, enables, order, bypass chips,
  // sub-states, MIX / LEVEL labels, removing / adding Phase-1 modules), so a host that still holds v1 states keeps its
  // object; an edit the v1 shape cannot hold (an S2 module, a second instance of a type, a splitter, the buses, a rack
  // bypass, a conversion) converts the state to v2 in place (§2.6.3 migrateFx1, the Serum state as refs) when the host
  // keeps v2 states (v2ok); otherwise it is refused before the host sees it (a dry run on a copy: no host edit, no undo
  // step) with a notice. → false when refused (callers then skip the Serum-state side and their follow-ups). v1Safe: the
  // edit only sets parameters of existing instances (a v1 view's instances are all v1-shaped): no dry run needed
  edit(fn, label, phase, extra, v1Safe) {
    const refs = this.sState(), raw = this.host.fx ? this.host.fx() : null;
    if (!v1Safe && isObj(raw) && !isV2(raw) && !this.v2ok()) {
      const V = deep(viewOf(raw, refs));
      if (isObj(V.ui) && this.v1ui) Object.assign(V.ui, deep(this.v1ui));
      fn(V);
      if (!writeV1(V, deep(raw))) {
        this.notify('This needs the Serum 2 FX rack, which this track does not support yet: nothing was changed');
        this.vcache = null;
        this.schedule();
        return false;
      }
    }
    if (this.host.editFx) {
      this.host.editFx(fx => {
        if (isV2(fx) || !isObj(fx)) { fn(fx); return; }
        const V = deep(viewOf(fx, refs));
        if (isObj(V.ui) && this.v1ui) Object.assign(V.ui, deep(this.v1ui));
        fn(V);
        if (writeV1(V, fx)) { this.v1ui = isObj(V.ui) ? { rack: V.ui.rack | 0, expand: V.ui.expand ? 1 : 0, br: deep(isObj(V.ui.br) ? V.ui.br : {}) } : null; return; }
        if (!this.v2ok()) return;   // (the host's state changed under the dry run) never hand it a state it would drop
        this.v1ui = null;
        for (const k of Object.keys(fx)) delete fx[k];
        Object.assign(fx, V);
      }, Object.assign({ label, phase: phase || 'set' }, extra || {}));
    }
    this.vcache = null;
    this.schedule();
    return true;
  }
  // Serum-state edit (rows / locks / MIDI of the "with mods" operations); false when the host has none
  editS(fn, label) {
    if (typeof this.host.edit !== 'function' || !this.sState()) return false;
    this.host.edit(fn, { label, phase: 'set' });
    return true;
  }
  // the Serum-state side of an fx-core instance operation (§11.2): op(fxBefore, s) = the same fx-core call with the Serum
  // state, on `before` (a copy of the FX state taken before the edit) — rows, locks and MIDI entries follow exactly as
  // fx-core rules them. false when the host has no Serum state
  refs(before, label, op) { return this.editS(s => { op(before, s); }, label); }
  snapshot() { return deep(this.fx()); }
  withInst(fx, id, fn) { const f = findInst(fx, id); if (f) fn(f.inst, f); }
  label(id, pid) {
    const I = this.inst(id), r = I ? rowIn(I.type, I.v, pid) : null;
    return instTitle(this.fx(), id) + ' ' + (r ? r.label : pid);
  }
  setP(id, pid, n, phase) {
    const I = this.inst(id), r = I ? rowIn(I.type, I.v, pid) : null;
    if (!r) return;
    const x = snapRow(r, n);
    this.edit(fx => this.withInst(fx, id, J => { if (!isObj(J.p)) J.p = {}; J.p[pid] = x; }), this.label(id, pid), phase, null, true);
  }
  // display text / typed entry of an instance parameter: through serum-core's formats on a one-instance state whose
  // instance carries its type id (format contexts such as Delay BPM, Compressor Limit, Filter type and the S1 reverb
  // type are then read from this instance); enum rows from their own lists
  fview(id) {
    const I = this.inst(id);
    if (!I) return null;
    const f = { v: 2, racks: [{ mods: [Object.assign({}, I, { id: I.type })], byp: 0, lock: 0, route: 0 }, emptyRack(), emptyRack()], ui: {} };
    if (I.type === 'rev' && I.v === 1) f.rev = { type: isObj(I.sub) && I.sub.type === 0 ? 0 : 1 };
    return f;
  }
  fmtV(id, pid, n) {
    const I = this.inst(id), r = I ? rowIn(I.type, I.v, pid) : null;
    if (!r) return String(n);
    if (r.law === 'enum' && typeof r.fmt === 'string' && r.fmt.slice(0, 5) === 'enum:') return enumLabel(r, n);
    return fmtParam('fx.' + I.type + '.' + pid, n, { fx: this.fview(id), bpm: this.bpm() });
  }
  parse(id, pid, t) {
    const I = this.inst(id), r = I ? rowIn(I.type, I.v, pid) : null;
    if (!r) return null;
    if (r.law === 'enum') {
      const g = stepsOfRow(r), want = String(t).trim().toLowerCase();
      for (let k = 0; k <= g; k++) if (enumLabel(r, k / g).toLowerCase() === want) return k / g;
    }
    const v = typeof core.parseParam === 'function' ? core.parseParam('fx.' + I.type + '.' + pid, t, { fx: this.fview(id), bpm: this.bpm() }) : null;
    return v == null ? null : v;
  }
  // locked FX parameters (dynamic ids fx.<instance>.<pid> the host reports locked; never by static index ≥ NS, §3.11.1)
  lockedIds() {
    if (typeof this.host.locked !== 'function') return [];
    const out = [];
    walk(this.fx(), I => { for (const r of tabOf(I.type, I.v)) { const id = 'fx.' + I.id + '.' + r.pid; if (core.isFxId(id) && this.host.locked(id)) out.push(id); } });
    return out;
  }
  notify(t) { if (this.host.notify) this.host.notify(t); }
  storeGet(k, d) { try { const s = this.host.storage; const v = s && s.get ? s.get(k, d) : d; return v == null ? d : v; } catch (err) { return d; } }
  storeSet(k, v) { try { const s = this.host.storage; if (s && s.set) s.set(k, v); } catch (err) { /* storage full */ } }
  noun() { return this.racksN() === 3 ? 'FX Bus' : 'FX Rack'; }

  /* ---------------------------------------------------------- DOM: frame */
  build(parent) {
    const root = this.el = h('div', 'fxr-root fxr2' + (this.embedded ? ' fxr-embedded' : ''));
    root.setAttribute('data-racks', String(this.racksN()));
    const bar = this.bar = h('div', 'fxr2-bar');
    const tabs = this.tabsEl = h('div', 'fxr2-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'FX racks');
    this.tabs = [];
    if (this.racksN() === 3) {
      RACK_NAMES.forEach((nm, k) => {
        const b = btn('fxr2-tab', nm);
        b.setAttribute('role', 'tab');
        b.addEventListener('click', () => this.setRack(k));
        b.addEventListener('keydown', e => {
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const q = (k + d + 3) % 3;
          this.setRack(q);
          this.tabs[q].focus({ preventScroll: true });
        });
        tabs.append(b);
        this.tabs.push(b);
      });
    } else tabs.append(h('span', 'fxr2-title', 'FX'));
    const exp = this.expBtn = btn('fxr-more fxr2-exp', '⤢', 'Expand the rack view (Alt+F)');
    exp.setAttribute('aria-keyshortcuts', 'Alt+F');
    exp.addEventListener('click', () => this.toggleExpand());
    const more = this.moreBtn = btn('fxr-more', '⋯', 'Rack menu');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => { const r = more.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.rackMenu(), { anchor: more }); });
    bar.append(tabs, exp, more);
    const side = this.side = h('div', 'fxr-side');
    const list = this.list = h('div', 'fxr-tiles fxr2-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'FX modules (processing order)');
    this.ins = h('div', 'fxr-ins');
    this.ins.hidden = true;
    list.append(this.ins);
    const add = this.addBtn = btn('fxr-more fxr2-add', '+ Add', 'Add an FX module');
    add.setAttribute('aria-haspopup', 'menu');
    add.addEventListener('click', () => this.openAdd(add, null));
    side.append(list, add);
    const rack = this.rack = h('div', 'fxr-rack');
    rack.setAttribute('aria-label', 'FX modules');
    this.empty = h('div', 'fxr-empty', 'This rack is empty. Add an effect with “+ Add”.');
    rack.append(this.empty);
    // rack background menu: right-click, or a touch long-press on the background (not on a panel: its controls have
    // their own menus — the background's long-press timer, which every press inside starts too, is ignored then)
    const inPanel = t => !!closest(t, rack, n => n.classList && n.classList.contains('fxr-mod'));
    let pressIn = false;
    rack.addEventListener('pointerdown', e => { pressIn = inPanel(e.target); }, true);
    this.offs.push(menuSource(rack, { keys: false }));
    rack.addEventListener('contextmenu', e => {
      if (e.defaultPrevented) return;
      if (inPanel(e.target)) return; // panels: controls / mod layer
      if (!e.isTrusted && e.target === rack && pressIn) return;
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, this.rackMenu(), { anchor: rack });
    });
    root.append(bar, side, rack);
    root.addEventListener('keydown', e => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F' || e.key === 'ƒ')) { e.preventDefault(); this.toggleExpand(); }
    });
    root.setAttribute('data-fxmod', this.modOn ? '1' : '0');
    if (!this.modOn) root.addEventListener('contextmenu', e => this.ctlMenu(e));
    if (parent) parent.appendChild(root);
  }
  setRack(k) {
    if (this.racksN() < 3) return;
    this.edit(fx => { fx.ui = isObj(fx.ui) ? fx.ui : {}; fx.ui.rack = k; }, 'FX Rack ' + RACK_NAMES[k], 'set', { ui: true });
    this.refresh();
  }
  toggleExpand() {
    const on = !(isObj(this.fx().ui) && this.fx().ui.expand);
    this.edit(fx => { fx.ui = isObj(fx.ui) ? fx.ui : {}; fx.ui.expand = on ? 1 : 0; }, 'Expand FX', 'set', { ui: true });
    this.refresh();
  }

  /* ---------------------------------------------------------- DOM: list view */
  buildRows(fx, k) {
    for (const w of this.rowWidgets) if (w.destroy) w.destroy();
    this.rowWidgets = [];
    for (const r of this.rowEls) { if (r.drag) r.drag.destroy(); if (r.off) r.off(); r.el.remove(); }
    this.rowEls = [];
    const rows = listRows(fx, k);
    for (const row of rows) {
      const el = row.kind === 'inst' ? this.instRow(row) : row.kind === 'branch' ? this.branchRowEl(row) : this.endRowEl(row);
      this.list.insertBefore(el.el, this.ins);
      this.rowEls.push(Object.assign(el, { row }));
    }
  }
  instRow(row) {
    const t = h('div', 'fxr-tile fxr2-row' + (row.depth ? ' fxr2-d1' : ''));
    t.setAttribute('role', 'listitem');
    t.setAttribute('data-inst', row.id);
    const id = row.id, onId = 'fx.' + id + '.on';
    const led = toggle({ dest: onId, label: row.label + ' on', kind: 'led', text: '', get: () => (this.val(id, 'on') >= 0.5 ? 1 : 0),
      set: v => this.setP(id, 'on', v ? 1 : 0, 'set') });
    led.el.classList.add('fxr-led');
    this.rowWidgets.push(led);
    this.tip(led, () => onId);
    const ledBox = this.altPower(led.el, id);
    const name = btn('fxr-tname', row.label);
    name.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    name.addEventListener('click', () => this.select(id));
    t.append(ledBox, name);
    if (row.s1) { const b = h('span', 'fxr2-s1', 'S1'); b.title = s1Tip(row.type); t.append(b); }
    if (row.byp) {
      const c = btn('fxr2-chip', 'BYP', 'Bypassed (click to clear)');
      c.addEventListener('click', () => this.clearByp(id));
      t.append(c);
    }
    const grip = h('span', 'fxr-grip', '≡');
    grip.setAttribute('aria-hidden', 'true');
    grip.title = 'Drag to reorder (Alt: duplicate, Shift+Alt: with mods; Alt+↑/↓)';
    t.append(grip);
    t.addEventListener('keydown', e => {
      if (!e.altKey || !/^Arrow(Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      this.nudge(id, e.key === 'ArrowUp' ? -1 : 1, e.target);
    });
    menuSource(name);
    t.addEventListener('contextmenu', e => {
      if (ledBox.contains(e.target)) return; // the LED is a DEST control: its menu belongs to the mod layer / ctlMenu
      e.preventDefault();
      e.stopPropagation();
      contextMenu(e.clientX, e.clientY, this.instMenu(id, true), { anchor: name });
    });
    // touch: the grip is touch-action: none (nothing scrolls under it), so the drag starts on the first few px of
    // travel in any direction — no 250 ms hold (wk.dragSource scrollAxis 'none'), as the Serum panel's tiles
    const drag = dragSource(grip, {
      data: id,
      scrollAxis: 'none',
      begin: () => { this.drag = { id, gap: -1 }; t.classList.add('fxr-dragging'); },
      move: info => this.dragMove(info),
      drop: info => this.dragDrop(info),
      cancel: () => this.dragEnd(),
    });
    return { el: t, led, name, grip, drag };
  }
  branchRowEl(row) {
    const el = h('div', 'fxr2-brow');
    el.setAttribute('data-branch', row.key);
    const lab = btn('fxr2-bname fxr2-blab', row.label, row.label + ' branch: show its modules');
    lab.addEventListener('click', () => this.selectBranch(row.parent, row.branch));
    const byp = btn('fxr2-bbyp', 'BYP', row.label + ' branch bypass');
    byp.setAttribute('aria-pressed', row.byp ? 'true' : 'false');
    byp.addEventListener('click', () => this.toggleBranchByp(row.parent, row.branch));
    const plus = btn('fxr2-plus', '+', 'Add an effect to ' + row.label);
    plus.setAttribute('aria-haspopup', 'menu');
    plus.addEventListener('click', () => this.openAdd(plus, { splitter: row.parent, branch: row.branch }));
    el.append(lab, byp, plus);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      contextMenu(e.clientX, e.clientY, this.addItems({ splitter: row.parent, branch: row.branch }), { anchor: plus });
    });
    return { el, byp, off: pressMenu(el) };   // right-click / long-press: the branch's add menu (inv B14.3)
  }
  endRowEl(row) { return { el: h('div', 'fxr2-bend', row.at ? null : 'empty') }; }

  /* ---------------------------------------------------------- DOM: panels */
  buildPanel(I) {
    const sec = h('section', 'fxr-mod fxr2-mod fxr-m-' + I.type);
    sec.setAttribute('data-inst', I.id);
    const P = { id: I.id, type: I.type, v: I.v, el: sec, widgets: [], displays: [], upd: [], offs: [], grCv: null, brBox: null };   // offs: the panel's own cleanups (dropPanel)
    const hd = h('div', 'fxr-mhead'), title = h('h3', 'fxr-mtitle', instTitle(this.fx(), I.id));
    P.title = title;
    const pre = btn('fxr-pre', '▾', moduleTitle(I.type) + ' module menu');
    pre.setAttribute('aria-haspopup', 'menu');
    pre.addEventListener('click', () => { const r = pre.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.instMenu(I.id, false), { anchor: pre }); });
    hd.append(title);
    if (I.v === 1) { const b = h('span', 'fxr2-s1', 'S1'); b.title = s1Tip(I.type); hd.append(b); }
    const chip = btn('fxr2-chip', 'BYPASSED', 'Bypassed (click to clear)');
    chip.addEventListener('click', () => this.clearByp(I.id));
    P.upd.push(() => { const J = this.inst(I.id); show(chip, !!(J && J.byp)); });
    hd.append(chip, pre);
    if (rowIn(I.type, I.v, 'on')) {
      const onId = 'fx.' + I.id + '.on';
      const pw = toggle({ dest: onId, label: moduleTitle(I.type) + ' on', kind: 'power', get: () => (this.val(I.id, 'on') >= 0.5 ? 1 : 0),
        set: v => this.setP(I.id, 'on', v ? 1 : 0, 'set') });
      pw.el.classList.add('fxr-pw');
      P.widgets.push(pw);
      this.knobs.set(onId, pw);
      this.tip(pw, () => onId);
      hd.append(this.altPower(pw.el, I.id));
    }
    const body = h('div', 'fxr-mbody');
    sec.append(hd, body);
    P.body = body;
    const c = this.ctxFor(P);
    const make = this['mod_' + I.type];
    try {
      if (typeof make === 'function') make.call(this, c, body);
      else body.append(h('p', 'fxr2-note', 'This module type has no panel.'));
    } catch (err) { warnOnce('panel' + I.type, 'fx-ui: panel failed', I.type, err); }
    if (isSplit(I.type)) { P.brBox = h('div', 'fxr2-brbox'); sec.append(P.brBox); }
    return P;
  }
  // a power / LED toggle wrapped so that Alt-click (or the Alt latch) toggles every module of the rack
  altPower(el, id) {
    const box = h('span', 'fxr2-pw');
    box.append(el);
    box.addEventListener('click', e => {
      if (!keysOf(e).alt) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleRackAll(id);
      consume();
    }, true);
    return box;
  }
  toggleRackAll(id) {
    const f = findInst(this.fx(), id);
    if (!f) return;
    const k = f.rack, on = !(this.val(id, 'on') >= 0.5);
    this.edit(fx => walk(fx, (I, w) => { if (w.rack === k && rowIn(I.type, I.v, 'on')) { if (!isObj(I.p)) I.p = {}; I.p.on = on ? 1 : 0; } }),
      (on ? 'Enable' : 'Disable') + ' all ' + RACK_NAMES[k] + ' modules');
    this.refresh();
  }
  clearByp(id) { this.edit(fx => this.withInst(fx, id, I => { I.byp = 0; }), 'Clear bypass ' + instTitle(this.fx(), id)); this.refresh(); }
  // the widget factories of one panel (instance id fixed; the instance object is looked up on every call)
  ctxFor(P) {
    const ui = this, id = P.id, type = P.type, v = P.v;
    const dest = pid => 'fx.' + id + '.' + pid;
    const row = pid => rowIn(type, v, pid);
    const reg = (pid, w) => {
      P.widgets.push(w);
      const r = row(pid), d = dest(pid);
      ui.knobs.set(d, w);
      if (r && r.nomod) {
        w.el.setAttribute('data-nomod', '1');
        tooltip(w.el, () => ui.label(id, pid) + ': ' + ui.fmtV(id, pid, ui.val(id, pid)) + '\nReshapes the IR — not modulatable');
      } else ui.tip(w, () => d);
      return w;
    };
    const base = (pid, o) => {
      const r = row(pid);
      return Object.assign({ dest: dest(pid), get: () => ui.val(id, pid), set: (n, ph) => ui.setP(id, pid, n, ph), def: r ? r.def : 0,
        fmt: n => ui.fmtV(id, pid, n), parse: t => ui.parse(id, pid, t) }, o || {});
    };
    const c = {
      id, type, v, P, dest, row,
      val: pid => ui.val(id, pid),
      on: pid => ui.val(id, pid) >= 0.5,
      k: pid => { const r = row(pid), g = stepsOfRow(r); return g ? Math.round(ui.val(id, pid) * g) + (r.lo | 0) : 0; },
      lv: pid => lawV(type, v, pid, ui.val(id, pid)),
      has: pid => !!row(pid),
      kn(pid, label, o) {
        const r = row(pid);
        if (!r) return null;
        return reg(pid, knob(base(pid, Object.assign({ label, steps: stepsOfRow(r), bipolar: !!r.ctr, size: 'md' }, o))));
      },
      tg(pid, label, kind, text) {
        if (!row(pid)) return null;
        return reg(pid, toggle({ dest: dest(pid), label, text, kind: kind || 'btn', get: () => (ui.val(id, pid) >= 0.5 ? 1 : 0),
          set: (x, ph) => ui.setP(id, pid, x ? 1 : 0, ph) }));
      },
      sg(pid, items, label) {
        const r = row(pid);
        if (!r) return null;
        const g = stepsOfRow(r) || 1;
        return reg(pid, seg({ dest: dest(pid), label, items, get: () => Math.round(ui.val(id, pid) * g), set: k => ui.setP(id, pid, k / g, 'set') }));
      },
      mn(pid, labels, label, groups) {
        const r = row(pid);
        if (!r) return null;
        const g = stepsOfRow(r) || 1, items = labels.map((lb, k) => ({ v: k / g, label: lb, group: groups ? groups[k] : undefined }));
        return reg(pid, menu({ dest: dest(pid), label, items: () => items, get: () => ui.val(id, pid), set: x => ui.setP(id, pid, x, 'set'), arrows: true }));
      },
      sl(pid, label, o) {
        const r = row(pid);
        if (!r) return null;
        return reg(pid, slider(base(pid, Object.assign({ label, bipolar: !!r.ctr, orient: 'h' }, o))));
      },
      nb(pid, label) {
        const r = row(pid);
        if (!r) return null;
        return reg(pid, numBox(base(pid, { label, steps: stepsOfRow(r) })));
      },
      // MIX knob whose label flips to LEVEL (inst.ui[key], inv A20.2 / B14.1); `knobs` holds both ids, each id's halo
      // kept and drawn only while that id is bound
      mix(key, mixPid, lvlPid) {
        const K = key || 'lvl', mp = mixPid || 'mix', lp = lvlPid || 'level', mixId = dest(mp), lvlId = dest(lp);
        if (!row(mp) && row(lp)) return c.kn(lp, 'LEVEL');
        if (!row(mp)) return null;
        const lvl = () => { const I = ui.inst(id); return !!(I && isObj(I.ui) && I.ui[K]); };
        const cur = () => (lvl() ? lp : mp);
        const stash = new Map();
        const w = knob({
          dest: () => dest(cur()), label: 'MIX', size: 'md',
          labelToggle: { alt: 'LEVEL', get: () => (lvl() ? 1 : 0), set: x => {
            ui.edit(fx => ui.withInst(fx, id, I => { I.ui = isObj(I.ui) ? I.ui : { lvl: 0, lvl2: 0 }; I.ui[K] = x ? 1 : 0; }), 'Mix / Level', 'set', { ui: true });
            w.setMod(stash.get(dest(cur())) || null);
          } },
          get: () => ui.val(id, cur()), set: (n, ph) => ui.setP(id, cur(), n, ph), def: () => (row(cur()) ? row(cur()).def : 0),
          fmt: n => ui.fmtV(id, cur(), n), parse: t => ui.parse(id, cur(), t),
        });
        for (const [d, pid] of [[mixId, mp], [lvlId, lp]]) {
          ui.knobs.set(d, { el: w.el, update: () => w.update(), focus: () => w.focus(), edit: () => w.edit(), destroy: () => {},
            setMod: m => { stash.set(d, m); if (cur() === pid) w.setMod(m); } });
        }
        P.widgets.push(w);
        ui.tip(w, () => dest(cur()));
        return w;
      },
      display: (cls, label, hgt, draw, key, drag) => ui.display(P, cls, label, hgt, draw, key, drag),
      upd: fn => { P.upd.push(fn); return fn; },
      vis: (el, fn) => { if (el) P.upd.push(() => el.classList.toggle('fxr2-hide', !fn())); return el; },
    };
    return c;
  }
  row(parent, cls) { const r = h('div', 'fxr-row' + (cls ? ' ' + cls : '')); parent.append(r); return r; }
  group(parent, title) {
    const g = h('div', 'fxr-grp');
    if (title) g.append(h('div', 'fxr-gt', title));
    const r = h('div', 'fxr-row');
    g.append(r);
    parent.append(g);
    return r;
  }
  col(...els) { const c = h('div', 'fxr-col'); c.append(...els.filter(Boolean)); return c; }
  els(...ws) { return ws.filter(Boolean).map(w => (w.el ? w.el : w)); }

  /* ---------------------------------------------------------- module panels (S1 variants = Phase 1; S2 per §13.5) */
  mod_hyper(c, b) {
    const hy = this.group(b, 'HYPER');
    hy.append(...this.els(c.kn('rate', 'RATE'), c.kn('detune', 'DETUNE'), this.col(...this.els(c.nb('unison', 'UNISON'), c.tg('retrig', 'RETRIG'))), c.mix('lvl', 'mix', 'level')));
    const dm = this.group(b, 'DIMENSION');
    dm.append(...this.els(c.kn('dsize', 'SIZE'), c.mix('lvl2', 'dmix', 'dlevel')));
  }
  mod_dist(c, b) {
    const r1 = this.row(b);
    const modes = c.v === 2 && Array.isArray(core.DIST_MODES2) ? core.DIST_MODES2 : DIST_MODES;
    const ea = btn('fxr-xs', 'Edit A', 'Edit X-Shaper curve A'), eb = btn('fxr-xs', 'Edit B', 'Edit X-Shaper curve B');
    ea.addEventListener('click', () => this.openXs(c.P, 'xa', ea));
    eb.addEventListener('click', () => this.openXs(c.P, 'xb', eb));
    c.upd(() => { const on = c.k('mode') === 11 || c.k('mode') === 12; for (const x of [ea, eb]) { x.disabled = !on; x.classList.toggle('wk-dis', !on); } if (!on && this.xs && this.xs.P === c.P) this.closeXs(); });
    r1.append(...this.els(c.mn('mode', modes.slice(), 'MODE'), this.col(ea, eb), c.sg('filt', ['OFF', 'PRE', 'POST'], 'FILTER')));
    const r2 = this.row(b);
    const kt = c.v === 2 ? c.tg('kt', 'KEY') : null;
    if (kt) kt.el.title = 'Key Track: FREQ follows the note';
    const stages = c.v === 2 ? c.nb('stages', 'STAGES') : null;
    if (stages) c.vis(stages.el, () => c.k('mode') === 16);
    r2.append(this.distFilterDisplay(c).el, this.col(...this.els(c.kn('freq', 'F', { size: 'sm' }), c.kn('q', 'Q', { size: 'sm' }), kt)),
      c.sl('lbh', 'LP/BP/HP', { orient: c.v === 2 ? 'h' : 'v' }).el, this.transferDisplay(c).el, ...this.els(c.kn('drive', 'DRIVE'), stages, c.mix()));
  }
  mod_flg(c, b) {
    const r = this.row(b);
    r.append(...this.els(c.tg('bpm', 'BPM'), this.rate(c), c.kn('depth', 'DEPTH'), c.kn('feed', 'FEED'), c.kn('phase', 'PHASE'), c.mix()));
  }
  mod_phs(c, b) {
    const r = this.row(b);
    r.append(...this.els(c.tg('bpm', 'BPM'), this.rate(c), c.kn('depth', 'DEPTH'), c.v === 2 ? c.kn('depth2', 'DEPTH 2') : null,
      c.v === 2 ? c.nb('poles', 'POLES') : null, c.kn('freq', 'FREQ'), c.kn('feed', 'FEED'), c.kn('phase', 'PHASE'), c.mix()));
  }
  mod_cho(c, b) {
    const r = this.row(b);
    const mono = toggle({ label: 'MONO', kind: 'btn', get: () => { const I = this.inst(c.id); return I && isObj(I.sub) && I.sub.mono ? 1 : 0; },
      set: v => this.edit(fx => this.withInst(fx, c.id, I => { I.sub = isObj(I.sub) ? I.sub : {}; I.sub.mono = v ? 1 : 0; }), instTitle(this.fx(), c.id) + ' Mono') });
    tooltip(mono.el, () => 'Mono: left and right chorus LFOs in phase');
    c.P.widgets.push(mono);
    // S2: a tap on the filter knob's label switches LPF ↔ HPF (`hp`)
    const lpf = c.v === 2 && c.has('hp')
      ? c.kn('lpf', 'LPF', { labelToggle: { alt: 'HPF', get: () => (c.on('hp') ? 1 : 0), set: x => this.setP(c.id, 'hp', x ? 1 : 0, 'set') } })
      : c.kn('lpf', 'LPF');
    r.append(this.col(...this.els(c.tg('bpm', 'BPM'), mono)), ...this.els(this.rate(c), c.kn('dly1', 'DELAY 1'), c.kn('dly2', 'DELAY 2'), c.kn('depth', 'DEPTH'),
      c.kn('feed', 'FEED'), lpf, c.mix()));
  }
  rate(c) { return c.kn('rate', 'RATE', { steps: () => (c.on('bpm') ? 30 : 0) }); }
  mod_dly(c, b) {
    const r1 = this.row(b);
    // S2: MODE menu (Normal · Ping-Pong · Tap->Delay) with its ✓ High Quality switch beside it (§13.5); S1: Phase-1 seg
    const hq = c.v === 2 ? c.tg('hq', 'HQ') : null;
    if (hq) hq.el.title = 'High Quality: full-rate lines with 4-point reads';
    const mode = c.v === 2 ? c.mn('mode', DLY_MODES.slice(), 'MODE') : c.sg('mode', DLY_MODES.slice(), 'MODE');
    r1.append(...this.els(c.kn('feed', 'FEED'), this.col(...this.els(c.tg('bpm', 'BPM'), c.tg('link', 'LINK'))), this.col(...this.els(mode, hq))));
    const r2 = this.row(b);
    const steps = () => (c.on('bpm') ? 11 : 0), dets = [0.25, 0.5, 4 / 3 - 0.5, 1], linked = () => c.on('link');
    const L = this.group(r2, 'LEFT'), R = this.group(r2, 'RIGHT');
    L.append(...this.els(c.kn('timeL', 'TIME', { steps }), c.kn('offL', 'OFFSET', { detents: dets, size: 'sm' })));
    R.append(...this.els(c.kn('timeR', 'TIME', { steps, disabled: linked }), c.kn('offR', 'OFFSET', { detents: dets, size: 'sm', disabled: linked })));
    const r3 = this.row(b);
    r3.append(this.delayDisplay(c).el, ...this.els(c.kn('freq', 'F'), c.kn('q', 'Q'), c.mix()));
  }
  mod_cmp(c, b) {
    const r0 = c.v === 2 ? this.row(b) : null;
    if (r0) r0.append(c.sg('mb', ['SINGLE', 'MULTIBAND'], 'MODE').el);
    const r1 = this.row(b);
    const dets = CMP_RATIO_DETENTS;
    r1.append(...this.els(c.kn('thr', 'THRESH'), c.kn('ratio', 'RATIO', { detents: dets }), c.kn('att', 'ATTACK'), c.kn('rel', 'RELEASE'), c.kn('gain', 'GAIN'), c.mix()));
    if (c.v === 2) {
      const mb = this.group(b, 'MULTIBAND');
      mb.append(...this.els(c.kn('xlo', 'X-LOW', { size: 'sm' }), c.kn('xhi', 'X-HIGH', { size: 'sm' }), c.kn('below', 'BELOW', { size: 'sm', detents: dets }),
        c.kn('gH', 'H', { size: 'sm' }), c.kn('gM', 'M', { size: 'sm' }), c.kn('gL', 'L', { size: 'sm' })));
      c.vis(mb.parentNode, () => c.on('mb'));
    }
    const r2 = this.row(b, 'fxr-cmp2');
    if (c.v === 1) r2.append(c.tg('mb', 'MULTIBAND').el);
    const box = h('div', 'fxr-mb');
    box.append(...this.els(c.sl('mbH', 'H'), c.sl('mbM', 'M'), c.sl('mbL', 'L')));
    c.vis(box, () => c.on('mb'));
    const gr = h('canvas', 'fxr-gr');
    gr.style.touchAction = 'none';   // a drag control (band thresholds): a finger drag must not scroll the rack (§13.1)
    gr.setAttribute('role', 'img');
    gr.setAttribute('aria-label', 'Gain reduction (multiband: drag a band row to set its threshold)');
    c.P.grCv = gr;
    this.grDrag(c, gr);
    r2.append(box, gr);
  }
  // multiband: the band threshold bars (MB High / Mid / Low, rows H · M · L of the GR display) are dragged horizontally
  // (§13.5); Shift / Fine latch = ×0.1; nothing changes before 3 px of travel
  grDrag(c, cv) {
    const PIDS = ['mbH', 'mbM', 'mbL'];
    let g = null;
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !c.on('mb') || !c.has('mbH')) return;
      const r = cv.getBoundingClientRect(), H = r.height || cv.clientHeight || 62, w = r.width || cv.clientWidth || 120;
      const j = clamp(Math.floor((e.clientY - r.top - 4) / Math.max(1, (H - 8) / 3)), 0, 2);
      e.preventDefault();
      g = { id: e.pointerId, pid: PIDS[j], x: e.clientX, n0: c.val(PIDS[j]), span: Math.max(20, w - 56), live: false, fine: !!keysOf(e).fine };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    const put = (e, ph) => {
      const dx = e.clientX - g.x;
      if (!g.live) {
        if (ph === 'end' || Math.abs(dx) < 3) return;
        g.live = true;
        this.setP(c.id, g.pid, g.n0, 'start');
      }
      this.setP(c.id, g.pid, clamp(g.n0 + dx * (g.fine || e.shiftKey ? 0.1 : 1) / g.span, 0, 1), ph);
      this.drawGr(c.P);
    };
    cv.addEventListener('pointermove', e => { if (g && e.pointerId === g.id) put(e, 'move'); });
    const end = e => {
      if (!g || e.pointerId !== g.id) return;
      if (twoF(e)) { const G = g; g = null; if (G.live) { this.setP(c.id, G.pid, G.n0, 'end'); this.drawGr(c.P); } return; }   // the threshold as it was
      if (g.live) put(e, 'end');
      g = null;
      consume();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
  mod_rev(c, b) {
    if (c.v === 1) {
      const r1 = this.row(b);
      const ty = seg({ label: 'TYPE', items: ['PLATE', 'HALL'], get: () => { const I = this.inst(c.id); return I && isObj(I.sub) && I.sub.type === 0 ? 0 : 1; },
        set: k => this.edit(fx => this.withInst(fx, c.id, I => { I.sub = isObj(I.sub) ? I.sub : {}; I.sub.type = k ? 1 : 0; }), instTitle(this.fx(), c.id) + ' Type') });
      c.P.widgets.push(ty);
      r1.append(ty.el);
      const r2 = this.row(b);
      const lab = slot => () => { const I = this.inst(c.id); return REV_LABELS[I && isObj(I.sub) && I.sub.type === 0 ? 0 : 1][slot]; };
      r2.append(...this.els(c.kn('size', lab(0)), c.kn('t', lab(1)), c.kn('locut', lab(2)), c.kn('c', lab(3)), c.kn('hicut', lab(4)), c.kn('w', lab(5)), c.mix()));
      return;
    }
    const types = Array.isArray(core.REV_TYPES2) ? core.REV_TYPES2 : ['Plate', 'Hall', 'Vintage', 'Nitrous', 'Basin'];
    const r1 = this.row(b);
    const nm = c.sg('nmode', (Array.isArray(core.NITROUS_MODES) ? core.NITROUS_MODES : []).map(x => String(x).toUpperCase()), 'MODE');
    r1.append(...this.els(c.mn('type', types.slice(), 'TYPE'), nm));
    const shown = () => { const L = arr(core.REV_LABELS2)[c.k('type')]; return Array.isArray(L) ? L : []; };
    if (nm) c.vis(nm.el, () => shown().indexOf('nmode') >= 0);
    const r2 = this.row(b);
    const K = (pid, label) => { const w = c.kn(pid, label); if (w) c.vis(w.el, () => shown().indexOf(pid) >= 0); return w; };
    const pre = c.kn('pre', 'PRE-DLY'), lad = c.kn('prelad', 'PRE-DLY'), pb = c.tg('prebpm', 'BPM');
    if (pre) c.vis(pre.el, () => !c.on('prebpm'));
    if (lad) c.vis(lad.el, () => c.on('prebpm'));
    r2.append(...this.els(K('locut', 'LO CUT'), K('hicut', 'HI CUT'), K('size', 'SIZE'), this.col(...this.els(pre, lad, pb)), K('ersize', 'ER SIZE'),
      K('decay', 'DECAY'), K('damp', 'DAMP'), K('width', 'WIDTH'), K('spinr', 'SPIN RATE'), K('spind', 'SPIN DEPTH'), K('diffa', 'DIFF A'), K('diffb', 'DIFF B'),
      K('feed', 'FEEDBACK'), K('diff', 'DIFFUSION')));
    const r3 = this.row(b), ch = this.group(r3, 'CHORUS');
    ch.append(...this.els(c.kn('chr', 'RATE', { size: 'sm' }), c.kn('chd', 'DEPTH', { size: 'sm' })));
    c.vis(ch.parentNode, () => shown().indexOf('chr') >= 0);
    r3.append(c.mix().el);
  }
  mod_eq(c, b) {
    const r1 = this.row(b);
    r1.append(this.eqDisplay(c).el);
    const r2 = this.row(b, 'fxr-eq2');
    const L = this.group(r2, 'LOW'), H = this.group(r2, 'HIGH');
    L.append(...this.els(c.sg('typeL', EQ_TYPES_L.slice(), 'TYPE'), c.kn('freqL', 'FREQ'), c.kn('qL', 'Q'), c.kn('gainL', 'GAIN', { disabled: () => c.k('typeL') === 2 })));
    H.append(...this.els(c.sg('typeH', EQ_TYPES_H.slice(), 'TYPE'), c.kn('freqH', 'FREQ'), c.kn('qH', 'Q'), c.kn('gainH', 'GAIN', { disabled: () => c.k('typeH') === 2 })));
    if (c.v === 2) r2.append(c.kn('level', 'LEVEL').el);
  }
  mod_fil(c, b) {
    const r1 = this.row(b);
    const r = c.row('type'), n = r ? r.hi - r.lo + 1 : 96, list = FILTERS.slice(0, n);
    r1.append(c.mn('type', list.map(f => f.name), 'TYPE', list.map(f => f.cat)).el);
    const r2 = this.row(b);
    const kt = c.v === 2 ? c.tg('kt', 'KEY') : null, cl = c.v === 2 ? c.tg('clean', 'CLEAN') : null;
    if (kt) kt.el.title = 'Key Track: CUTOFF follows the note';
    if (cl) cl.el.title = 'Clean Mode: no drive colouring';
    const ty = () => c.k('type');
    r2.append(this.filterDisplay(c).el, this.col(...this.els(c.kn('cutoff', 'CUTOFF', { size: 'lg' }), kt)), ...this.els(c.kn('res', 'RES')),
      this.col(...this.els(c.kn('drive', 'DRIVE'), cl)),
      ...this.els(c.kn('var', () => varLabel(ty()) || 'VAR', { disabled: () => !varLabel(ty()) }), c.kn('pan', 'PAN'), c.mix()));
  }
  // RETRIG is the SHIFT control's menu item (§13.5 "SHIFT (menu ✓ Retrig)", ctlExtras; RULINGS2 U3): no panel toggle
  mod_bode(c, b) {
    const r1 = this.row(b);
    const dly = c.kn('delay', 'DELAY'), lad = c.kn('dlad', 'DELAY');
    if (dly) c.vis(dly.el, () => !c.on('bpm'));
    if (lad) c.vis(lad.el, () => c.on('bpm'));
    const sh = c.kn('shift', 'SHIFT');
    if (sh) sh.el.title = 'SHIFT — right-click / long-press: ✓ Retrig (the shifter restarts at every note)';
    r1.append(...this.els(c.tg('mono', 'MONO INPUT'), sh, c.kn('range', 'RANGE'), c.kn('dir', 'DIR'), c.kn('width', 'WIDTH')));
    const r2 = this.row(b);
    r2.append(this.col(...this.els(dly, lad, c.tg('bpm', 'BPM'))), ...this.els(c.kn('feed', 'FEED'), c.kn('bal', 'BALANCE'), c.kn('blur', 'BLUR'), c.mix()));
  }
  mod_util(c, b) {
    const r = this.row(b);
    r.append(this.col(...this.els(c.tg('invL', 'INV L'), c.tg('invR', 'INV R'))), ...this.els(c.kn('lpf', 'LPF'), c.kn('hpf', 'HPF')),
      this.col(...this.els(c.tg('mbass', 'MONO BASS'), c.kn('mfreq', 'FREQ', { size: 'sm' }))), ...this.els(c.kn('width', 'WIDTH'), c.kn('pan', 'PAN'), c.mix()));
  }
  mod_conv(c, b) {
    const r1 = this.row(b);
    const irm = menu({ label: 'IMPULSE', arrows: true, stepGroup: true, items: () => this.irItems(c.id), get: () => { const I = this.inst(c.id); return I && isObj(I.sub) ? I.sub.ir : ''; },
      set: v => this.setIr(c.id, v) });
    irm.el.classList.add('fxr2-irn');
    c.P.widgets.push(irm);
    const load = btn('fxr-xs', 'Load IR…', 'Load an impulse response file');
    load.addEventListener('click', () => this.loadIr(c.id));
    // Embed (inv B14.3; deviation 14): user IRs are always embedded in exported presets and projects — a status badge
    const emb = h('span', 'fxr2-emb', 'EMBED');
    emb.title = 'User impulse responses are embedded in exported presets and projects';
    c.vis(emb, () => { const I = this.inst(c.id); return !!(I && isObj(I.sub) && /^ir:/.test(String(I.sub.ir || ''))); });
    r1.append(irm.el, load, emb);
    const r2 = this.row(b);
    const pre = c.kn('pre', 'PRE-DLY'), lad = c.kn('prelad', 'PRE-DLY');
    if (pre) c.vis(pre.el, () => !c.on('prebpm'));
    if (lad) c.vis(lad.el, () => c.on('prebpm'));
    r2.append(this.irDisplay(c).el, ...this.els(c.kn('size', 'SIZE'), c.kn('tone', 'TONE'), c.tg('minph', 'ϕ MIN')));
    const r3 = this.row(b);
    r3.append(this.col(...this.els(pre, lad, c.tg('prebpm', 'BPM'))), ...this.els(c.kn('att', 'ATTACK'), c.kn('dec', 'DECAY'), c.kn('damp', 'DAMP'), c.kn('irgain', 'IR GAIN'), c.mix()));
  }
  mod_split2(c, b) { this.splitPanel(c, b); }
  mod_split3(c, b) { this.splitPanel(c, b); }
  mod_splitms(c, b) { this.splitPanel(c, b); }
  splitPanel(c, b) {
    const sel = h('div', 'fxr2-brsel');
    sel.setAttribute('role', 'group');
    sel.setAttribute('aria-label', 'Branches');
    const labels = BRANCH_LABELS[c.type] || [];
    labels.forEach((lb, k) => {
      const box = h('div', 'fxr2-bpanel');
      const nm = btn('fxr2-bname', lb, lb + ': show its modules');
      nm.addEventListener('click', () => this.selectBranch(c.id, k));
      const byp = btn('fxr2-bbyp', 'BYP', lb + ' bypass');
      byp.addEventListener('click', () => this.toggleBranchByp(c.id, k));
      const plus = btn('fxr2-plus', '+', 'Add an effect to ' + lb);
      plus.addEventListener('click', () => this.openAdd(plus, { splitter: c.id, branch: k }));
      box.append(nm, byp, plus);
      box.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); contextMenu(e.clientX, e.clientY, this.addItems({ splitter: c.id, branch: k }), { anchor: plus }); });
      c.P.offs.push(pressMenu(box));
      c.upd(() => {
        const I = this.inst(c.id), on = !!(I && Array.isArray(I.bb) && I.bb[k]);
        byp.setAttribute('aria-pressed', on ? 'true' : 'false');
        box.classList.toggle('fxr2-bsel', this.branchOf(c.id) === k);
        nm.setAttribute('aria-pressed', this.branchOf(c.id) === k ? 'true' : 'false');
      });
      sel.append(box);
    });
    b.append(sel);
    const r = this.row(b);
    const f = c.type === 'split2' ? [c.kn('freq', 'SPLIT FREQ')] : c.type === 'split3' ? [c.kn('freq1', 'SPLIT 1'), c.kn('freq2', 'SPLIT 2')] : [];
    if (c.type !== 'splitms') r.append(this.splitDisplay(c).el);
    r.append(...this.els(...f, c.kn('level', 'LEVEL')));
  }

  /* ---------------------------------------------------------- displays */
  // A canvas display redrawn when key() changes; drag(P0, P, phase, e) for 2-parameter drags (phases 'start', 'move',
  // 'end', and 'cancel' = a two-finger rollback: the values from before the press).
  display(P, cls, label, hgt, draw, key, drag) {
    const wrap = h('div', 'fxr-disp ' + cls), cv = h('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', label);
    wrap.style.height = hgt + 'px';
    wrap.append(cv);
    const D = { P, el: wrap, cv, hgt, draw, key, last: null };
    if (drag) {
      let g = null;
      const pos = e => { // canvas coordinates: the canvas fills the wrapper's padding box (inside its 1 px border)
        const r = wrap.getBoundingClientRect(), b = this.box(D);
        return { x: e.clientX - r.left - (wrap.clientLeft || 0), y: e.clientY - r.top - (wrap.clientTop || 0), w: b.w, h: b.h };
      };
      wrap.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        g = { id: e.pointerId, P0: pos(e), started: false };
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
        g.started = drag(g.P0, g.P0, 'start', e) !== false;
      });
      wrap.addEventListener('pointermove', e => { if (g && e.pointerId === g.id && g.started) drag(g.P0, pos(e), 'move', e); });
      // gesture.js's two-finger cancel ends the drag with the phase 'cancel': the drag puts back what it set (no click)
      const end = e => { if (!g || e.pointerId !== g.id) return; const G = g; g = null; if (G.started) drag(G.P0, pos(e), twoF(e) ? 'cancel' : 'end', e); };
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);
    }
    P.displays.push(D);
    return D;
  }
  // CSS size of a display's canvas = the wrapper's padding box (clientWidth / clientHeight; nominal height minus the
  // 1 px borders before layout)
  box(D) {
    const el = D.el, r = el.getBoundingClientRect();
    return { w: Math.max(40, el.clientWidth || (r.width ? r.width - 2 : 200)), h: Math.max(16, el.clientHeight || D.hgt - 2) };
  }
  canvas(D) {
    const b = this.box(D), ctx = fitCanvas(D.cv, b.w, b.h);
    return ctx ? { ctx, w: b.w, h: b.h } : null;
  }
  frameAxes(c, T, dbMax, dbMin, pad, step) {
    const { ctx, w, h: H } = c, st = step > 0 ? step : 12;
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const f of [100, 1000, 10000]) { const x = Math.round(logX(f, w, pad)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    const Y = db => pad + (dbMax - db) / (dbMax - dbMin) * (H - 2 * pad);
    for (let db = Math.ceil(dbMin / st) * st; db <= dbMax; db += st) { const y = Math.round(Y(db)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    return Y;
  }
  freqs(w, pad) {
    const n = clamp(Math.round(w / 2), 32, 256), out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = fAtX(pad + (w - 2 * pad) * i / (n - 1), w, pad);
    return out;
  }
  plot(c, fr, db, Y, pad, col, fill) {
    const { ctx, w, h: H } = c;
    ctx.beginPath();
    for (let i = 0; i < fr.length; i++) { const x = logX(fr[i], w, pad), y = clamp(Y(db[i]), -2, H + 2); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    if (fill) { ctx.save(); ctx.lineTo(w - pad, H); ctx.lineTo(pad, H); ctx.closePath(); ctx.globalAlpha = 0.14; ctx.fillStyle = col; ctx.fill(); ctx.restore(); ctx.beginPath(); for (let i = 0; i < fr.length; i++) { const x = logX(fr[i], w, pad), y = clamp(Y(db[i]), -2, H + 2); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } }
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.stroke();
  }
  note(c, T, text) {
    const { ctx, w, h: H } = c;
    ctx.fillStyle = T.mute; ctx.font = '500 10px ' + T.ui; ctx.textAlign = 'center';
    if (ctx.fillText) ctx.fillText(text, w / 2, H / 2 + 3);
    ctx.textAlign = 'left';
  }
  // 2-parameter display drag, relative like a knob: x moves the frequency pid along the log axis (the plot width =
  // 1000 : 1, as the display's 20 Hz–20 kHz; the value stays inside its law's range, relFreq), y moves the second pid
  // (the plot height = full range, up = more); Shift / Fine latch = ×0.1. Nothing is edited until the pointer has moved
  // 3 px, so a plain click never changes the patch; an axis without travel keeps its start value exactly.
  // opts.click(e): a press that ends without travel (the FX filter display: Alt-click cycles its views)
  dragXY(c, xPid, yPid, label, pad, opts) {
    let st = null;
    const O = opts || {};
    return (P0, P, phase, e) => {
      if (phase === 'start') { st = { x0: c.val(xPid), y0: c.val(yPid), live: false, px: P0.x, py: P0.y, ax: 0, ay: 0, fine: !!keysOf(e).fine, e0: e }; return true; }
      if (!st) return false;
      const put = (nx, ny, ph) => this.edit(fx => this.withInst(fx, c.id, I => { I.p[xPid] = nx; I.p[yPid] = ny; }), label, ph, null, true);
      if (phase === 'cancel') { const S = st; st = null; if (S.live) { put(S.x0, S.y0, 'end'); this.redraw(); } return true; }
      if (!st.live) {
        if (phase !== 'end' && Math.hypot(P.x - P0.x, P.y - P0.y) >= 3) { st.live = true; put(st.x0, st.y0, 'start'); }
        else { if (phase === 'end') { const e0 = st.e0; st = null; if (O.click && e && e.type === 'pointerup') O.click(e0); } return true; }
      }
      const f = st.fine || (e && e.shiftKey) ? 0.1 : 1;
      const X = relFreq(c.type, c.v, xPid, st.x0, st.ax + (P.x - st.px) * f / Math.max(1, P.w - 2 * pad));
      st.ax = X.ax;
      st.ay = clamp(st.ay + (st.py - P.y) * f / Math.max(1, P.h - 2 * pad), -st.y0, 1 - st.y0);
      st.px = P.x; st.py = P.y;
      put(X.n, st.ay === 0 ? st.y0 : clamp(st.y0 + st.ay, 0, 1), phase === 'end' ? 'end' : 'move');
      if (phase === 'end') { st = null; consume(); }
      this.redraw();
      return true;
    };
  }
  distFilterDisplay(c) {
    const pad = 6;
    return c.display('fxr-dfil', 'Distortion filter response', 74, D => {
      const g = this.canvas(D); if (!g) return;
      const T = theme(this.el), Y = this.frameAxes(g, T, 24, -36, pad), fr = this.freqs(g.w, pad);
      const F = c.lv('freq'), Q = c.lv('q'), lbh = c.val('lbh');
      const db = fr.map(f => svfDb(F, Q, lbh, f, FS));
      const active = c.k('filt') > 0;
      this.plot(g, fr, db, Y, pad, active ? T.neg : T.mute, active);
    }, () => ['freq', 'q', 'lbh', 'filt'].map(p => c.val(p)).join(), this.dragXY(c, 'freq', 'q', instTitle(this.fx(), c.id) + ' Filter', pad));
  }
  xsOf(id) {
    try {
      const t = core.compileFxT(this.fx());
      const e = t && Array.isArray(t.xs) ? t.xs.find(x => x.id === id) : null;
      return e || (t && t.xsA ? { xsA: t.xsA, xsB: t.xsB } : null);
    } catch (err) { return null; }
  }
  transferDisplay(c) {
    // drag up / down on the curve = DRIVE (§13.5)
    let st = null;
    const drag = (P0, P, phase, e) => {
      if (phase === 'start') { st = { n0: c.val('drive'), live: false }; return true; }
      if (!st) return false;
      if (phase === 'cancel') { const S = st; st = null; if (S.live) { this.setP(c.id, 'drive', S.n0, 'end'); this.redraw(); } return true; }
      const dy = P0.y - P.y;
      if (!st.live) {
        if (phase !== 'end' && Math.abs(dy) >= 3) { st.live = true; this.setP(c.id, 'drive', st.n0, 'start'); } else { if (phase === 'end') st = null; return true; }
      }
      this.setP(c.id, 'drive', clamp(st.n0 + dy * (e && e.shiftKey ? 0.1 : 1) / Math.max(40, P.h * 2), 0, 1), phase === 'end' ? 'end' : 'move');
      if (phase === 'end') st = null;
      this.redraw();
      return true;
    };
    return c.display('fxr-xfer', 'Distortion transfer curve (drag: drive)', 74, D => {
      const g = this.canvas(D); if (!g) return;
      const T = theme(this.el), { ctx, w, h: H } = g, s = Math.min(w, H) - 8, x0 = (w - s) / 2, y0 = (H - s) / 2;
      ctx.clearRect(0, 0, w, H); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
      ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, s, s);
      ctx.beginPath(); ctx.moveTo(x0, y0 + s / 2); ctx.lineTo(x0 + s, y0 + s / 2); ctx.moveTo(x0 + s / 2, y0); ctx.lineTo(x0 + s / 2, y0 + s); ctx.stroke();
      const dsp = this.dsp;
      if (!dsp || typeof dsp.distCurve !== 'function') { this.note(g, T, '—'); return; }
      const xs = this.xsOf(c.id), stages = c.has('stages') ? Math.round(c.lv('stages')) : 4;
      let y = null;
      try { y = xs ? dsp.distCurve(c.k('mode'), c.lv('drive'), xs.xsA, xs.xsB, 129, stages) : null; } catch (err) { y = null; }
      if (!y || !y.length) { this.note(g, T, '—'); return; }
      ctx.beginPath();
      for (let i = 0; i < y.length; i++) {
        const px = x0 + s * i / (y.length - 1), py = y0 + s / 2 - clamp(+y[i] || 0, -1.1, 1.1) * s / 2;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.lineWidth = 2; ctx.strokeStyle = T.graph; ctx.stroke();
    }, () => { // redrawn on any change of the instance's curves (their points: what the X-Shaper tables are rendered from)
      const I = this.inst(c.id), S = I && isObj(I.sub) ? I.sub : {};
      return [c.val('mode'), c.val('drive'), c.has('stages') ? c.val('stages') : '', JSON.stringify([S.xa || null, S.xb || null]), !!this.dsp].join();
    }, drag);
  }
  delayDisplay(c) {
    const pad = 6;
    const D = c.display('fxr-dlyf', 'Delay filter response (double-tap: spectrum)', 74, D2 => {
      const g = this.canvas(D2); if (!g) return;
      const T = theme(this.el), Y = this.frameAxes(g, T, 6, -36, pad), fr = this.freqs(g.w, pad);
      if (this.specId === c.id) this.specDraw(g, T, fr, Y, pad);    // (behind the response curve)
      const dsp = this.dsp;
      if (!dsp || typeof dsp.delayFilterResponse !== 'function') { this.note(g, T, '—'); return; }
      let db = null;
      try { db = dsp.delayFilterResponse(c.lv('freq'), c.lv('q'), fr, FS); } catch (err) { db = null; }
      if (db && db.length === fr.length) this.plot(g, fr, db, Y, pad, T.graph, true); else this.note(g, T, '—');
    }, () => [c.val('freq'), c.val('q'), !!this.dsp, this.specId === c.id].join(), this.dragXY(c, 'freq', 'q', instTitle(this.fx(), c.id) + ' Filter', pad));
    // §13.5: double-tap / double-click → the realtime spectrum overlay of this Delay's output (the rack's monitor tap). A
    // tap is a press released within 3 px (a drag of F / Q is none); two taps within 350 ms and 24 px toggle it
    let px = 0, py = 0, t0 = -1e9, x0 = 0, y0 = 0;
    D.el.addEventListener('pointerdown', e => { px = e.clientX; py = e.clientY; });
    D.el.addEventListener('pointerup', e => {
      if (Math.hypot(e.clientX - px, e.clientY - py) >= 3) { t0 = -1e9; return; }
      const t = e.timeStamp > 0 ? e.timeStamp : Date.now();
      if (t - t0 < 350 && Math.hypot(e.clientX - x0, e.clientY - y0) < 24) { t0 = -1e9; this.specToggle(c.id, D); return; }
      t0 = t; x0 = e.clientX; y0 = e.clientY;
    });
    return D;
  }
  // the spectrum overlay (§13.5 Delay; one instance at a time): host.setTap(id) asks the rack to tap it, host.tap() is
  // its latest 1024 frames (smon), drawn while shown at the GR loop's rate
  specToggle(id, D) {
    if (typeof this.host.setTap !== 'function' || typeof this.host.tap !== 'function') { this.notify('Spectrum view not available here'); return; }
    this.specId = this.specId === id ? '' : id;
    this.specD = this.specId !== '' ? D : null;
    this.host.setTap(this.specId);
    this.redraw();
    this.specLoop();
  }
  specLoop() {
    const D = this.specD, want = !!(this.specId && D && D.el.isConnected && this.rendered());
    if (!want) { if (this.specTick) this.specTick.stop(); return; }
    if (!this.specTick) {
      this.specTick = ticker(this.rack, () => {
        const E = this.specD;
        if (this.dead || !this.specId || !E || !E.el.isConnected) { this.specTick.stop(); return; }
        try { E.draw(E); } catch (err) { this.specTick.stop(); }
      }, { fps: 30 });
    }
    this.specTick.start();
  }
  // magnitude spectrum of the tap (Hann window, FFT 1024; 0 dBFS → the top of the display, −90 dBFS → its bottom) at the
  // display's frequencies
  specDraw(g, T, fr, Y, pad) {
    const x = typeof this.host.tap === 'function' ? this.host.tap() : null;
    if (!x || x.length !== SPEC_N) return;
    const re = SPEC_RE, im = SPEC_IM;
    for (let i = 0; i < SPEC_N; i++) { re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / SPEC_N)); im[i] = 0; }
    fft1(re, im);
    const db = new Float64Array(fr.length), k = 4 / SPEC_N;   // Hann coherent gain ½ → a full-scale sine reads ≈ 0 dB
    for (let i = 0; i < fr.length; i++) {
      const b = Math.min(SPEC_N / 2, Math.max(1, Math.round(fr[i] / FS * SPEC_N)));
      const m = Math.hypot(re[b], im[b]) * k, dbfs = 20 * Math.log10(m > 1e-9 ? m : 1e-9);
      db[i] = -36 + (clamp(dbfs, -90, 0) + 90) * 42 / 90;
    }
    const ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = 0.55;
    this.plot(g, fr, db, Y, pad, T.accent, false);
    ctx.restore();
  }
  eqHandles(c, w, pad, Y) {
    return ['L', 'H'].map(b => {
      const type = c.k('type' + b), db = type === 2 ? 0 : c.lv('gain' + b);
      return { b, x: logX(c.lv('freq' + b), w, pad), y: Y(db), pass: type === 2 };
    });
  }
  eqDisplay(c) {
    const pad = 8, dbMax = 24, dbMin = -24;
    let grab = null;
    const D = c.display('fxr-eqd', 'EQ response', 110, D2 => {
      const g = this.canvas(D2); if (!g) return;
      const T = theme(this.el), Y = this.frameAxes(g, T, dbMax, dbMin, pad), fr = this.freqs(g.w, pad), dsp = this.dsp;
      let db = null;
      if (dsp && typeof dsp.eqResponse === 'function') {
        try {
          const fx = this.fx(), fxp = core.compileFx(fx, { bpm: this.bpm() }), f = findInst(fx, c.id);
          db = dsp.eqResponse(fxp, f ? f.n : -1, fxp.base, fr, FS);
        } catch (err) { db = null; }
      }
      if (db && db.length === fr.length) this.plot(g, fr, db, Y, pad, T.graph, true);
      else this.note(g, T, '—');
      const { ctx } = g;
      for (const hd of this.eqHandles(c, g.w, pad, Y)) {
        ctx.beginPath(); ctx.arc(hd.x, clamp(hd.y, pad, g.h - pad), 6, 0, Math.PI * 2);
        ctx.fillStyle = T.bg; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = grab && grab.b === hd.b ? T.accent : T.ink; ctx.stroke();
        ctx.fillStyle = T.ink; ctx.font = '700 8px ' + T.ui; ctx.textAlign = 'center';
        if (ctx.fillText) ctx.fillText(hd.b, hd.x, clamp(hd.y, pad, g.h - pad) + 3);
        ctx.textAlign = 'left';
      }
    }, () => ['typeL', 'freqL', 'qL', 'gainL', 'typeH', 'freqH', 'qH', 'gainH'].map(k => c.val(k)).join() + !!this.dsp,
    (P0, P, phase, e) => {
      // a handle follows the pointer (keeping the grab offset); nothing is edited before 3 px of travel, so a plain
      // click on a handle never changes the patch (no host edit, no undo step), and an axis without travel keeps its value
      const Y = db => pad + (dbMax - db) / (dbMax - dbMin) * (P.h - 2 * pad);
      if (phase === 'start') {
        let best = null, bd = Infinity;
        for (const hd of this.eqHandles(c, P.w, pad, Y)) { const d = Math.hypot(hd.x - P0.x, hd.y - P0.y); if (d < bd) { bd = d; best = hd; } }
        if (!best || bd > 40) { grab = null; return false; }
        const yp = best.pass ? 'q' + best.b : 'gain' + best.b;
        grab = { b: best.b, pass: best.pass, yPid: yp, f0: c.val('freq' + best.b), y0: c.val(yp), dy: best.y - P0.y, dx: best.x - P0.x, live: false };
        D.last = null;
        this.redraw();   // the grabbed handle is highlighted
        return true;
      }
      if (!grab) return false;
      const b = grab.b, label = instTitle(this.fx(), c.id) + ' ' + (b === 'L' ? 'Low' : 'High') + ' Band';
      const put = (nf, ny, ph) => this.edit(fx => this.withInst(fx, c.id, I => { I.p['freq' + b] = nf; I.p[grab.yPid] = ny; }), label, ph, null, true);
      if (phase === 'cancel') { if (grab.live) put(grab.f0, grab.y0, 'end'); grab = null; D.last = null; this.redraw(); return true; }
      if (!grab.live) {
        if (phase !== 'end' && Math.hypot(P.x - P0.x, P.y - P0.y) >= 3) { grab.live = true; put(grab.f0, grab.y0, 'start'); }
        else { if (phase === 'end') { grab = null; D.last = null; this.redraw(); } return true; }
      }
      const nf = P.x === P0.x ? grab.f0 : clamp(lawN(c.type, c.v, 'freq' + b, fAtX(P.x + grab.dx, P.w, pad)), 0, 1);
      const ny = P.y === P0.y ? grab.y0 : grab.pass ? clamp(grab.y0 + (P0.y - P.y) / 120 * (e && e.shiftKey ? 0.1 : 1), 0, 1)
        : clamp(lawN(c.type, c.v, 'gain' + b, dbMax - ((P.y + grab.dy) - pad) / (P.h - 2 * pad) * (dbMax - dbMin)), 0, 1);
      put(nf, ny, phase === 'end' ? 'end' : 'move');
      if (phase === 'end') grab = null;
      this.redraw();
      return true;
    });
    // wheel over the display = Q of the nearest band, with the widgets' rules (wk.wheelGate): only after the pointer
    // has rested on it ≥ 300 ms, trackpad travel accumulated (40 px per 0.02 step); otherwise the rack scrolls
    const take = wheelGate(D.el);
    c.P.offs.push(take.destroy);
    D.el.addEventListener('wheel', e => {
      if (this.dead) return;
      const k = take(e);
      if (k == null) return;
      e.preventDefault();
      if (!k) return;
      const r = D.el.getBoundingClientRect(), w = this.box(D).w, x = e.clientX - r.left - (D.el.clientLeft || 0);
      const fL = logX(c.lv('freqL'), w, pad), fH = logX(c.lv('freqH'), w, pad);
      const pid = Math.abs(x - fL) <= Math.abs(x - fH) ? 'qL' : 'qH';
      const n = clamp(c.val(pid) + k * (e.shiftKey ? 0.002 : 0.02), 0, 1);
      if (n === c.val(pid)) return;
      this.setP(c.id, pid, n, 'set');
      this.redraw();
    }, { passive: false });
    return D;
  }
  // FX filter display (§13.5 "options as the voice filter"): views Frequency Response (0) / Phase Response (1), chosen in
  // its menu (right-click / long-press) or cycled by Alt-click (Alt latch on touch); kept per instance for the session.
  // The voice filter's "& FFT" views need a spectrum tap the FX rack does not have (shown disabled)
  filtView(id) { return this.fviews && this.fviews.get(id) === 1 ? 1 : 0; }
  setFiltView(id, v) {
    (this.fviews || (this.fviews = new Map())).set(id, v ? 1 : 0);
    const P = this.panels.get(id);
    if (P) for (const D of P.displays) D.last = null;
    this.redraw();
  }
  filterDisplay(c) {
    const pad = 6;
    const D = c.display('fxr-fild', 'Filter response (right-click: views; Alt-click: next view)', 96, D2 => {
      const g = this.canvas(D2); if (!g) return;
      const view = this.filtView(c.id), T = theme(this.el), fr = this.freqs(g.w, pad), dsp = this.dsp;
      const Y = view ? this.frameAxes(g, T, 180, -180, pad, 90) : this.frameAxes(g, T, 24, -48, pad);
      const ty = c.k('type'), fam = FILTERS[ty] ? FILTERS[ty].family : '', fc = c.lv('cutoff');
      const { ctx } = g;
      const xc = logX(clamp(fc, 20, 20000), g.w, pad);
      ctx.strokeStyle = T.mute; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xc, 0); ctx.lineTo(xc, g.h); ctx.stroke();
      if (view && ctx.fillText) { ctx.fillStyle = T.mute; ctx.font = '600 9px ' + T.ui; ctx.fillText('PHASE', pad + 2, pad + 8); }
      if (fam === 'ring' || fam === 'snh') { this.note(g, T, fam === 'ring' ? 'Ring Mod' : 'Sample & Hold'); return; }
      if (!dsp || typeof dsp.filterImpulse !== 'function') { this.note(g, T, '—'); return; }
      let imp = null;
      try { imp = dsp.filterImpulse(ty, fc, c.val('res'), c.val('drive'), c.val('var'), FS, 2048); } catch (err) { imp = null; }
      if (!imp || !imp.length) { this.note(g, T, '—'); return; }
      if (view) this.plot(g, fr, impulsePhase(imp, FS, fr), Y, pad, T.graph, false);
      else this.plot(g, fr, impulseDb(imp, FS, fr), Y, pad, T.graph, true);
    }, () => ['type', 'cutoff', 'res', 'drive', 'var'].map(k => c.val(k)).join() + this.filtView(c.id) + !!this.dsp,
    this.dragXY(c, 'cutoff', 'res', instTitle(this.fx(), c.id) + ' Filter', pad, {
      click: e => { if (!keysOf(e).alt) return; this.setFiltView(c.id, 1 - this.filtView(c.id)); consume(); },
    }));
    D.el.addEventListener('contextmenu', e => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const v = this.filtView(c.id);
      contextMenu(e.clientX, e.clientY, [
        { label: 'Frequency Response', checked: v === 0, action: () => this.setFiltView(c.id, 0) },
        { label: 'Phase Response', checked: v === 1, action: () => this.setFiltView(c.id, 1) },
        { sep: true },
        { label: 'Spectrum (FFT): no FX filter tap', disabled: true },
      ], { anchor: D.el });
    });
    c.P.offs.push(pressMenu(D.el));
    return D;
  }
  splitDisplay(c) {
    const pad = 6, cols = ['#4fb3ff', '#6fe3a1', '#ffb347'];
    const f1 = c.type === 'split3' ? 'freq1' : 'freq';
    return c.display('fxr2-spl', 'Splitter band responses', 74, D => {
      const g = this.canvas(D); if (!g) return;
      const T = theme(this.el), Y = this.frameAxes(g, T, 6, -48, pad), fr = this.freqs(g.w, pad), dsp = this.dsp;
      if (!dsp || typeof dsp.splitResponse !== 'function') { this.note(g, T, '—'); return; }
      let out = null;
      try { out = dsp.splitResponse(c.type, c.lv(f1), c.type === 'split3' ? c.lv('freq2') : 0, fr, FS); } catch (err) { out = null; }
      if (!Array.isArray(out)) { this.note(g, T, '—'); return; }
      out.forEach((db, b) => this.plot(g, fr, db, Y, pad, b === this.branchOf(c.id) ? cols[b % 3] : T.mute, b === this.branchOf(c.id)));
    }, () => [c.val(f1), c.type === 'split3' ? c.val('freq2') : '', this.branchOf(c.id), !!this.dsp].join(),
    (P0, P, phase, e) => {
      // horizontal drag = a crossover (L/M/H: the nearer of SPLIT 1 / SPLIT 2 at the press), relative like a knob: it
      // moves with the pointer's travel along the log axis (no jump to the pointer on the press); Shift / Fine ×0.1;
      // nothing changes before 3 px of travel
      if (phase === 'start') {
        let pid = f1;
        if (c.type === 'split3') pid = Math.abs(P0.x - logX(c.lv('freq1'), P0.w, pad)) <= Math.abs(P0.x - logX(c.lv('freq2'), P0.w, pad)) ? 'freq1' : 'freq2';
        this.splitDrag = { pid, n0: c.val(pid), live: false, px: P0.x, ax: 0, fine: !!keysOf(e).fine };
        return true;
      }
      const st = this.splitDrag;
      if (!st) return false;
      if (phase === 'cancel') { this.splitDrag = null; if (st.live) { this.setP(c.id, st.pid, st.n0, 'end'); this.redraw(); } return true; }
      if (!st.live) { if (phase !== 'end' && Math.abs(P.x - P0.x) >= 3) { st.live = true; this.setP(c.id, st.pid, st.n0, 'start'); } else { if (phase === 'end') this.splitDrag = null; return true; } }
      const X = relFreq(c.type, c.v, st.pid, st.n0, st.ax + (P.x - st.px) * (st.fine || (e && e.shiftKey) ? 0.1 : 1) / Math.max(1, P.w - 2 * pad));
      st.ax = X.ax; st.px = P.x;
      this.setP(c.id, st.pid, X.n, phase === 'end' ? 'end' : 'move');
      if (phase === 'end') { this.splitDrag = null; consume(); }
      this.redraw();
      return true;
    });
  }
  // IR display (§13.5): the shaped impulse response (SIZE, TONE, ϕ MIN, ATTACK, DECAY, DAMP applied off the audio thread,
  // §8.4): host.irs.overview of the instance's shaped-IR entry id (compileFx iIr, `<ir>@<rate>~<shapeKey>`), requested
  // once the shaping values have rested 120 ms (a knob drag does not queue a worker job per step). Until it arrives the
  // plain IR is drawn through an approximate shaping envelope (stretch, fade-in, cut with its fade, damping)
  irDisplay(c) {
    const st = { sid: '', timer: 0 };
    c.P.offs.push(() => clearTimeout(st.timer));
    const plainOf = () => { const I = this.inst(c.id); return I && isObj(I.sub) ? String(I.sub.ir || '') : ''; };
    const D = c.display('fxr2-ird', 'Impulse response (drop a file to load an IR)', 74, D2 => {
      const g = this.canvas(D2); if (!g) return;
      const T = theme(this.el), { ctx, w, h: H } = g, id = plainOf(), sid = this.shapedIr(c.id), mid = H / 2;
      ctx.clearRect(0, 0, w, H); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
      ctx.fillStyle = T.graph;
      const shaped = sid ? this.irCached(sid) : null;
      if (shaped) {
        const n = shaped.length / 2;
        let pk = 1e-9;
        for (let i = 0; i < shaped.length; i++) pk = Math.max(pk, Math.abs(shaped[i]));
        for (let x = 0; x < w; x++) {
          const src = clamp(Math.floor(x / w * n), 0, n - 1), lo = shaped[2 * src] / pk, hi = shaped[2 * src + 1] / pk;
          ctx.fillRect(x, mid - hi * mid * 0.9, 1, Math.max(1, (hi - lo) * mid * 0.9));
        }
        return;
      }
      if (sid && sid !== st.sid) {
        st.sid = sid;
        clearTimeout(st.timer);
        st.timer = setTimeout(() => { if (!this.dead && st.sid === sid && this.shapedIr(c.id) === sid) this.irOverview(sid); }, 120);
      }
      const ov = this.irOverview(id);
      if (!ov) { this.note(g, T, id ? id.replace(/^[a-z]+:/, '') : 'No impulse'); return; }
      const size = clamp(c.lv('size'), 0.1, 10), att = c.val('att'), dec = clamp(c.val('dec'), 0.001, 1), damp = c.val('damp'), n = ov.length / 2;
      const span = Math.min(1, size) * dec;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        if (u > span) break;
        const src = clamp(Math.floor(u / Math.max(1e-6, Math.min(1, size)) * n), 0, n - 1), t = u / Math.max(1e-6, span);
        let env = att > 0 ? clamp(u / Math.max(1e-6, 0.5 * att * span), 0, 1) : 1;
        if (t > 0.7) env *= 0.5 + 0.5 * Math.cos(Math.PI * (t - 0.7) / 0.3);
        env *= Math.exp(-3 * damp * t);
        const lo = ov[2 * src] * env, hi = ov[2 * src + 1] * env;
        ctx.fillRect(x, mid - hi * mid * 0.9, 1, Math.max(1, (hi - lo) * mid * 0.9));
      }
    }, () => {
      const id = plainOf(), sid = this.shapedIr(c.id);
      return [id, sid, this.irCached(id) ? 1 : 0, sid && this.irCached(sid) ? 1 : 0, c.val('size'), c.val('att'), c.val('dec'), c.val('damp')].join();
    });
    const el = D.el;
    el.addEventListener('dragover', e => { if (e.dataTransfer) { e.preventDefault(); el.classList.add('fxr2-drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('fxr2-drop'));
    el.addEventListener('drop', e => {
      el.classList.remove('fxr2-drop');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      this.importIr(c.id, files);
    });
    return D;
  }
  // the shaped-IR entry id of Convolve instance `id` (fx-core compileFx iIr at the instance's layout index; the rate
  // part only names the entry: the display's overview is built at any rate), memoised per FX layout and shaping values
  shapedIr(id) {
    const fx = this.fx(), f = findInst(fx, id);
    if (!f || f.inst.type !== 'conv' || !isObj(f.inst.sub) || !f.inst.sub.ir) return '';
    const P = isObj(f.inst.p) ? f.inst.p : {}, k = [f.n, f.inst.sub.ir].concat(['size', 'tone', 'minph', 'att', 'dec', 'damp'].map(q => P[q])).join();
    const M = this.irIds || (this.irIds = new Map());
    if (M.has(k)) return M.get(k);
    let sid = '';
    try { const fxp = core.compileFx(fx, { bpm: this.bpm() }); sid = Array.isArray(fxp.iIr) ? String(fxp.iIr[f.n] || '') : ''; } catch (err) { sid = ''; }
    if (M.size > 64) M.clear();
    M.set(k, sid);
    return sid;
  }
  irs() { const s = this.host.irs; return isObj(s) ? s : null; }
  // the cached overview of an IR id (min / max pairs), else null (not asked yet, pending, or a miss)
  irCached(id) { const v = id && this.irData.has(id) ? this.irData.get(id) : null; return v && typeof v.length === 'number' && v.length ? v : null; }
  // IR overview (min / max pairs) of an IR or shaped-IR id through host.irs.overview, cached (≤ 24 ids: the oldest go).
  // A failed, empty or all-zero answer (a factory IR still generating or cancelled, a missing user IR: assets.js answers
  // zeros) is a miss, never cached as the overview: a later redraw asks again (at most once a second) and the display
  // retries by itself after 2, 4, … 64 s, so an IR that becomes available shows up without a user action
  irOverview(id) {
    if (!id) return null;
    const S = this.irs();
    if (!S || typeof S.overview !== 'function') return null;
    if (this.irData.has(id)) {
      const v = this.irData.get(id);
      if (v === null || (v && v.length)) return v && v.length ? v : null;   // pending / cached
      if (Date.now() - v.miss < 1000) return null;
      this.irData.delete(id);
    }
    if (this.irData.size >= 24) this.irData.delete(this.irData.keys().next().value);
    this.irData.set(id, null);
    const miss = () => { if (this.dead) return; this.irData.set(id, { miss: Date.now() }); this.irRetry(id); };
    Promise.resolve().then(() => S.overview(id, 256)).then(ov => {
      if (this.dead) return;
      let any = false;
      if (ov && ov.length) for (let i = 0; i < ov.length && !any; i++) any = ov[i] !== 0;
      if (!any) { miss(); return; }
      this.irData.set(id, ov);
      if (this.irTries) this.irTries.delete(id);
      this.redraw(true);
    }, err => { warnOnce('irov', 'fx-ui: IR overview failed', err); miss(); });
    return null;
  }
  irRetry(id) {
    const N = this.irTries || (this.irTries = new Map()), n = (N.get(id) || 0) + 1;
    if (n > 6) return;
    N.set(id, n);
    const T = this.irTimers || (this.irTimers = new Set());
    const t = setTimeout(() => { T.delete(t); if (!this.dead) this.redraw(true); }, 1000 * Math.pow(2, n));
    if (t && typeof t.unref === 'function') t.unref();   // node: never keeps the process alive
    T.add(t);
  }
  irItems(id) {
    const S = this.irs(), I = this.inst(id), cur = I && isObj(I.sub) ? I.sub.ir : '';
    let list = [];
    try { list = S && typeof S.list === 'function' ? arr(S.list('ir')) : []; } catch (err) { list = []; }
    const items = list.filter(x => isObj(x) && typeof x.id === 'string').map(x => ({ v: x.id, label: String(x.name || x.id), group: x.user ? 'User' : String(x.folder || x.cat || 'Factory') }));
    if (cur && !items.some(x => x.v === cur)) items.unshift({ v: cur, label: String(cur).replace(/^[a-z]+:(.*\/)?/, '') });
    return items.length ? items : [{ v: '', label: 'No impulse', disabled: true }];
  }
  setIr(id, ir) { this.edit(fx => this.withInst(fx, id, I => { I.sub = isObj(I.sub) ? I.sub : {}; I.sub.ir = String(ir || ''); }), instTitle(this.fx(), id) + ' Impulse'); this.refresh(); }
  loadIr(id) {
    return pickFile('.wav,.aif,.aiff,.flac,.mp3,.ogg,audio/*').then(f => (f ? this.importIr(id, [f]) : null)).catch(err => warnOnce('irpick', 'fx-ui: IR pick failed', err));
  }
  importIr(id, files) {
    const S = this.irs();
    if (!S || typeof S.import !== 'function') { this.notify('Impulse import is not available'); return Promise.resolve(null); }
    return Promise.resolve(S.import(files, { kind: 'ir' })).then(nid => { if (nid && !this.dead) this.setIr(id, nid); return nid; },
      err => { this.notify('Could not import that impulse response'); warnOnce('irimp', 'fx-ui: IR import failed', err); return null; });
  }
  redraw(force) {
    for (const P of this.panels.values()) {
      if (!P.el.isConnected && !force) continue;
      for (const D of P.displays) {
        if (D.el.hidden || (D.el.classList && D.el.classList.contains('fxr2-hide'))) continue;
        const r = D.el.getBoundingClientRect(), k = D.key() + '|' + Math.round(D.el.clientWidth || r.width || 0);
        if (!force && k === D.last) continue;
        D.last = k;
        try { D.draw(D); } catch (err) { console.warn('fx-ui: display failed', err); }
      }
    }
  }
  // compressor GR (host.gr(): Float32Array(4·48), [4·i …] = FXP instance i; Phase-1 layout per compressor: [0]
  // single-band GR, [1–3] L/M/H). i = the instance's index in the fxLayout of the host's own state — the layout the
  // engine compiled (a v1 state: all ten modules in the v1 order, compileFx → viewV1; not the migrated view, which
  // leaves the pristine modules out); −1 when the host's layout has no such instance
  grSlot(id) {
    const raw = this.host.fx ? this.host.fx() : null;
    let L = null;
    try { L = core.fxLayout(isObj(raw) ? raw : this.fx()); } catch (err) { L = null; }
    return L ? L.inst.findIndex(e => e.id === id) : -1;
  }
  // lazy (the redraw loop): nothing is painted while the GR values, the band thresholds and the size are unchanged
  drawGr(P, lazy) {
    const cv = P.grCv;
    if (!cv) return;
    const r = cv.getBoundingClientRect(), w = Math.max(40, cv.clientWidth || (r.width ? r.width - 2 : 120)), H = Math.max(16, cv.clientHeight || 62);
    const all = this.host.gr ? this.host.gr() : null, i = this.grSlot(P.id), o = 4 * i;
    const mb = this.val(P.id, 'mb') >= 0.5, gv = k => (i >= 0 && all && fin(all[o + k]) ? all[o + k] : 0);
    const sig = [w, H, mb ? 1 : 0, gv(0), gv(1), gv(2), gv(3), mb ? [this.val(P.id, 'mbH'), this.val(P.id, 'mbM'), this.val(P.id, 'mbL')].join() : ''].join('|');
    if (lazy && sig === P.grSig) return;
    P.grSig = sig;
    const ctx = fitCanvas(cv, w, H);
    if (!ctx) return;
    const T = theme(this.el);
    ctx.clearRect(0, 0, w, H); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
    const rows = mb ? [['H', 3], ['M', 2], ['L', 1]] : [['GR', 0]], rh = (H - 8) / rows.length, x0 = 22, span = w - x0 - 34;
    ctx.font = '600 9px ' + T.ui;
    rows.forEach(([lab, k], j) => {
      const y = 4 + j * rh, v = gv(k), cx = mb ? x0 + span / 2 : x0, scale = mb ? span / 2 / 24 : span / 24;
      ctx.fillStyle = T.panel2; ctx.fillRect(x0, y + 2, span, rh - 4);
      const len = clamp(v, mb ? -24 : 0, 24) * scale;
      ctx.fillStyle = v >= 0 ? T.accent : T.on; // reduction (blue) / upward gain (green)
      if (mb) ctx.fillRect(len >= 0 ? cx - len : cx, y + 2, Math.abs(len), rh - 4); else ctx.fillRect(x0, y + 2, len, rh - 4);
      if (mb) { // the band's threshold bar (MB H / M / L, draggable)
        const tx = x0 + clamp(this.val(P.id, 'mb' + lab), 0, 1) * span;
        ctx.fillStyle = T.neg; ctx.fillRect(Math.round(tx) - 1, y + 1, 2, rh - 2);
      }
      ctx.fillStyle = T.mute;
      if (ctx.fillText) { ctx.fillText(lab, 3, y + rh / 2 + 3); ctx.fillText((v > 0 ? '-' : v < 0 ? '+' : '') + Math.abs(v).toFixed(1), w - 32, y + rh / 2 + 3); }
    });
  }
  grPanels() { return [...this.panels.values()].filter(P => P.grCv && P.el.isConnected); }
  drawGrs(lazy) { for (const P of this.grPanels()) this.drawGr(P, lazy); }
  rendered() { const el = this.el; return el.isConnected && !(typeof el.getClientRects === 'function' && el.getClientRects().length === 0); }
  // the GR display loop while a compressor is shown (wk.ticker, §13.1: ≤ 30 fps, 10 fps with prefers-reduced-motion,
  // nothing painted while the page is hidden; a frame repaints only what changed); it stops when no compressor is
  // shown or the rack is hidden (refresh() restarts it)
  grLoop() {
    const want = !!(this.host.gr && this.grPanels().length && this.rendered());
    if (!want) { if (this.grTick) this.grTick.stop(); this.drawGrs(true); return; }
    if (!this.grTick) {
      this.grTick = ticker(this.rack, () => {
        if (this.dead || !this.grPanels().length) { this.grTick.stop(); return; }
        this.drawGrs(true);
      }, { fps: 30 });
    }
    this.grTick.start();
  }

  /* ---------------------------------------------------------- X-Shaper popover */
  openXs(P, key, opener) {
    this.closeXs();
    const A = key === 'xb' ? 'B' : 'A', id = P.id;
    const pop = h('div', 'fxr-xpop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'X-Shaper ' + A);
    const hd = h('div', 'fxr-xhead');
    hd.append(h('span', 'fxr-xtitle', 'X-SHAPER ' + A));
    const close = btn('fxr-x', '✕', 'Close');
    close.addEventListener('click', () => this.closeXs(true));
    hd.append(close);
    pop.append(hd);
    const ed = new CurveEditor(pop, {
      kind: 'xshape', label: 'X-Shaper ' + A, height: 180,
      get: () => { const I = this.inst(id); return I && isObj(I.sub) && Array.isArray(I.sub[key]) ? I.sub[key] : DIAG(); },
      set: (p, ph) => this.edit(fx => this.withInst(fx, id, I => { I.sub = isObj(I.sub) ? I.sub : {}; I.sub[key] = p; }), 'X-Shaper ' + A, ph),
      grid: () => ({ x: 8, y: 8 }), shapes: this.shapes,
    });
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeXs(true); } });
    P.el.append(pop);
    const d = Doc();
    const outside = e => { // a press outside the popover (and outside its menus / its opener) closes it
      for (let n = e.target; n; n = n.parentNode) if (n === pop || n === opener || (n.classList && n.classList.contains('wk-ctx'))) return;
      this.closeXs(false);
    };
    d.addEventListener('pointerdown', outside, true);
    this.xs = { P, pop, ed, key, opener, off: () => d.removeEventListener('pointerdown', outside, true) };
    ed.root.focus({ preventScroll: true });
    ed.refresh();
  }
  closeXs(refocus) {
    const x = this.xs;
    if (!x) return;
    this.xs = null;
    x.off();
    x.ed.destroy();
    x.pop.remove();
    if (refocus && x.opener && x.opener.focus) x.opener.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- list drag / order */
  dragMove(info) {
    const d = this.drag;
    if (!d) return;
    let gap = 0;
    for (const r of this.rowEls) { const b = r.el.getBoundingClientRect(); if (b.top + b.height / 2 < info.y) gap++; }
    d.gap = gap;
    const lr = this.list.getBoundingClientRect(), ins = this.ins, R = this.rowEls;
    ins.hidden = false;
    ins.classList.remove('fxr-ins-v');
    const top = gap < R.length ? R[gap].el.getBoundingClientRect().top : R.length ? R[R.length - 1].el.getBoundingClientRect().bottom : lr.top;
    ins.style.top = (top - lr.top - 1 + (this.list.scrollTop || 0)) + 'px';
    ins.style.left = '0px';
  }
  dragEnd() {
    const d = this.drag;
    this.drag = null;
    this.ins.hidden = true;
    for (const r of this.rowEls) r.el.classList.remove('fxr-dragging');
    return d;
  }
  dragDrop(info) {
    const d = this.dragEnd();
    if (!d || d.gap < 0) return;
    const fx = this.fx(), copy = !!(info && info.alt), to = moveTarget(fx, d.id, d.gap, this.curRack(), copy);
    if (!to) { this.notify(isSplit((this.inst(d.id) || {}).type) ? 'Splitters cannot go into a branch' : 'No room there'); return; }
    if (copy) { this.duplicate(d.id, !!info.shift, to); return; }
    const f = findInst(fx, d.id);
    if (f && f.rack === to.rack && (f.parent ? f.parent.id : null) === to.splitter && (!to.splitter || f.branch === to.branch) && f.index === to.at) return;
    this.edit(x => core.moveInstance(x, d.id, to), 'Move FX Module');
    this.refresh();
  }
  nudge(id, dir, focusEl) {
    const f = findInst(this.fx(), id);
    if (!f) return;
    const at = f.index + dir;
    if (at < 0 || at >= f.list.length) return;
    const to = { rack: f.rack, splitter: f.parent ? f.parent.id : null, branch: f.parent ? f.branch : 0, at };
    this.edit(x => core.moveInstance(x, id, to), 'Move FX Module');
    this.refresh();
    const r = this.rowEls.find(x => x.row.kind === 'inst' && x.row.id === id);
    const el = r ? r.name : focusEl;
    if (el && el.focus) el.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- instance actions */
  addItems(branch) {
    const k = this.curRack();
    return addMenuItems(this.fx(), k, branch).map(it => ({ label: it.label, disabled: it.disabled, group: it.group, action: () => this.addInst(it.type, branch) }))
      .reduce((out, it, i, all) => { if (i && all[i - 1].group !== it.group) out.push({ sep: true }); out.push(it); return out; }, []);
  }
  openAdd(anchor, branch) {
    const r = anchor.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 2, this.addItems(branch), { anchor });
  }
  defaultPreset(type) {
    const p = this.storeGet('synth.fxmod.default.' + type, null);
    return payloadV2(p);
  }
  addInst(type, branch) {
    const k = this.curRack(), to = branch ? { rack: k, splitter: branch.splitter, branch: branch.branch } : { rack: k };
    const pre = this.defaultPreset(type);
    let nid = null;
    if (!this.edit(fx => { nid = core.newInstance(fx, type, Object.assign({ preset: pre || undefined }, to)); if (nid) { fx.ui = isObj(fx.ui) ? fx.ui : {}; fx.ui.sel = nid; if (branch) { fx.ui.br = isObj(fx.ui.br) ? fx.ui.br : {}; fx.ui.br[branch.splitter] = branch.branch; } } },
      'Add ' + moduleTitle(type), 'set', { seed: true })) return null;
    if (!nid) { this.notify('No room for another module here'); return null; }
    this.refresh();
    this.scrollTo(nid, true);
    return nid;
  }
  // Remove FX Module: the instance (a splitter with its branches) and, in the Serum state, the rows, locked controls and
  // MIDI entries addressing it (fx-core removeInstance, §11.2)
  removeInst(id) {
    const t = instTitle(this.fx(), id), before = this.snapshot();
    let ok = false;
    if (this.edit(fx => { ok = core.removeInstance(fx, id); }, 'Remove ' + t, 'set', { seed: true }) && ok) this.refs(before, 'Remove ' + t, (f, s) => core.removeInstance(f, id, s));
    this.refresh();
  }
  // Duplicate FX Module (right after it, or at `to` = {rack, splitter, branch, at}); withMods: the rows addressing it are
  // copied onto the copy's ids (fx-core duplicateInstance {mods}, §2.5)
  duplicate(id, withMods, to) {
    const t = instTitle(this.fx(), id), before = this.snapshot(), o = to ? { to } : {};
    let nid = null;
    if (!this.edit(fx => {
      nid = core.duplicateInstance(fx, id, null, o);
      if (nid) { fx.ui = isObj(fx.ui) ? fx.ui : {}; fx.ui.sel = nid; }
    }, 'Duplicate ' + t, 'set', { seed: true })) return null;
    if (!nid) { this.notify('No room for another module here'); return null; }
    if (withMods && !this.refs(before, 'Duplicate ' + t + ' (w/mods)', (f, s) => core.duplicateInstance(f, id, s, Object.assign({ mods: true }, o)))) {
      this.notify('Modulations were not copied (no Serum state)');
    }
    this.refresh();
    return nid;
  }
  // Move to ▸ (the end of a rack or of a splitter branch); a rack move shows that rack
  moveTo(id, to) {
    this.edit(fx => {
      if (listAt(fx, to)) core.moveInstance(fx, id, Object.assign({}, to, { at: undefined }));
      fx.ui = isObj(fx.ui) ? fx.ui : {};
      if (to.rack !== undefined && !to.splitter && this.racksN() === 3) fx.ui.rack = to.rack;
    }, 'Move FX Module');
    this.refresh();
  }
  moveItems(id) {
    const fx = this.fx(), f = findInst(fx, id);
    if (!f) return [];
    const out = [], here = (k, sp, b) => f.rack === k && (f.parent ? f.parent.id : null) === sp && (!sp || f.branch === b);
    const N = this.racksN();
    for (let k = 0; k < N; k++) {
      const full = !here(k, null, 0) && arr(fx.racks[k].mods).length >= MAX_TOP;
      out.push({ label: N === 3 ? RACK_NAMES[k] : 'Rack', disabled: here(k, null, 0) || full, action: () => this.moveTo(id, { rack: k, splitter: null, branch: 0 }) });
    }
    if (!isSplit(f.inst.type)) {
      walk(fx, (I, w) => {
        if (w.parent || !isSplit(I.type) || I.id === id) return;
        const L = BRANCH_LABELS[I.type] || [];
        const sub = L.map((lb, b) => ({ label: lb, disabled: here(w.rack, I.id, b) || arr(I.br[b]).length >= MAX_BR,
          action: () => this.moveTo(id, { rack: w.rack, splitter: I.id, branch: b }) }));
        out.push({ label: instTitle(fx, I.id) + (N === 3 ? ' (' + RACK_NAMES[w.rack] + ')' : ''), sub });
      });
    }
    return out;
  }
  // module menu (▾ and the list row's long-press / right-click): presets, duplicate, remove, move, convert, init
  instMenu(id) {
    const I = this.inst(id);
    if (!I) return [];
    const items = [];
    const fac = this.factoryPresets(I.type);
    if (fac.length) items.push({ label: 'Factory', sub: fac.map(p => ({ label: p.name, action: () => this.applyModPreset(id, p) })) });
    const user = this.modPresets(I.type);
    for (const p of user) items.push({ label: p.name, action: () => this.applyModPreset(id, p) });
    if (fac.length || user.length) items.push({ sep: true });
    items.push({ label: 'Save FX Preset…', action: () => this.saveModPreset(id) });
    if (user.length) items.push({ label: 'Delete FX Preset', sub: user.map(p => ({ label: p.name, action: () => this.delModPreset(I.type, p.name) })) });
    items.push({ label: 'Save as Default Preset', action: () => this.saveDefault(id) });
    if (this.defaultPreset(I.type)) items.push({ label: 'Clear Default Preset', action: () => this.clearDefault(I.type) });
    items.push({ sep: true });
    items.push({ label: 'Duplicate FX Module', action: () => this.duplicate(id, false) });
    items.push({ label: 'Duplicate FX Module (w/mods)', disabled: typeof this.host.edit !== 'function' || !this.sState(), action: () => this.duplicate(id, true) });
    items.push({ label: 'Move to', sub: this.moveItems(id) });
    items.push({ label: 'Remove FX Module', action: () => this.removeInst(id) });
    if (I.v === 1 && hasS2(I.type)) items.push({ label: 'Convert to Serum 2 Module', action: () => this.upgrade(id) });
    // (Limiter Latency Comp lives in the RATIO control's menu, ctlExtras — RULINGS2 U3)
    items.push({ sep: true }, { label: 'Init Module', action: () => this.initInst(id) });
    return items;
  }
  upgrade(id) {
    const I = this.inst(id);
    if (!I) return;
    if (I.type === 'rev') {
      const ok = typeof globalThis.confirm === 'function' ? globalThis.confirm('Convert this reverb to the Serum 2 module? Its sound changes slightly (the parameter mapping is approximate).') : true;
      if (!ok) return;
    }
    let done = false;
    // fx-core upgradeInstance (§11.2): a new S2 object (same id), written over the instance in place
    const ok = this.edit(fx => this.withInst(fx, id, J => {
      const U = core.upgradeInstance(J);
      if (!isObj(U) || U.v !== 2) return;
      for (const k of Object.keys(J)) delete J[k];
      Object.assign(J, U);
      done = true;
    }), 'Convert ' + instTitle(this.fx(), id) + ' to Serum 2', 'set', { seed: true });
    if (ok && done) this.notify(instTitle(this.fx(), id) + ' converted to the Serum 2 module');
    this.refresh();
  }
  initInst(id) {
    this.edit(fx => this.withInst(fx, id, I => {
      const on = isObj(I.p) ? I.p.on : undefined;
      I.p = {};
      for (const r of tabOf(I.type, I.v)) I.p[r.pid] = r.def;
      if (fin(on)) I.p.on = on;
      I.sub = subDefault(I.type, I.v);
      I.byp = 0;
    }), 'Init ' + instTitle(this.fx(), id), 'set', { seed: true });
    this.refresh();
  }

  /* ---------------------------------------------------------- module presets (§2.5) */
  modPresets(type) {
    const l = this.storeGet('synth.fxmod.' + type, []);
    return arr(l).map(payloadV2).filter(p => p && p.ftype === type && p.name);
  }
  factoryPresets(type) {
    const F = core.FACTORY_FX_PRESETS;
    const list = Array.isArray(F) ? F : isObj(F) && Array.isArray(F[type]) ? F[type] : [];
    return list.map(payloadV2).filter(p => p && p.ftype === type && p.name);
  }
  payload(id, name) { return payloadV2(core.modulePresetPayload(this.fx(), id, String(name == null ? '' : name))); }
  saveModPreset(id) {
    const I = this.inst(id);
    if (!I) return;
    const name = ask('Save ' + moduleTitle(I.type) + ' preset as', '');
    if (!name || !name.trim()) return;
    const nm = name.trim().slice(0, 48), list = this.modPresets(I.type).filter(p => p.name !== nm);
    list.push(this.payload(id, nm));
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.storeSet('synth.fxmod.' + I.type, list);
    this.notify(moduleTitle(I.type) + ' preset “' + nm + '” saved');
  }
  delModPreset(type, name) {
    this.storeSet('synth.fxmod.' + type, this.modPresets(type).filter(p => p.name !== name));
    this.notify(moduleTitle(type) + ' preset “' + name + '” deleted');
  }
  saveDefault(id) {
    const I = this.inst(id);
    if (!I) return;
    this.storeSet('synth.fxmod.default.' + I.type, this.payload(id, 'Default'));
    this.notify('New ' + moduleTitle(I.type) + ' modules start from these settings');
  }
  clearDefault(type) {
    const s = this.host.storage;
    try { if (s && typeof s.del === 'function') s.del('synth.fxmod.default.' + type); else this.storeSet('synth.fxmod.default.' + type, null); } catch (err) { /* storage */ }
    this.notify(moduleTitle(type) + ' default preset cleared');
  }
  // fx-core applyModulePreset (§11.2): the preset's values and structured data (an S1 instance receiving an S2 preset
  // is converted first; an S1 preset on an S2 instance is read through the conversion); enable, bypass, position and
  // locked parameters unchanged; seed (§9.6)
  applyModPreset(id, payload) {
    const pre = payloadV2(payload), I = this.inst(id);
    if (!pre || !I || pre.ftype !== I.type) return;
    const locked = this.lockedIds();
    this.edit(fx => { core.applyModulePreset(fx, id, pre, locked); }, 'Load ' + instTitle(this.fx(), id) + ' Preset', 'set', { seed: true });
    this.refresh();
  }

  /* ---------------------------------------------------------- rack menu: bus clipboard, locks, rack presets, chains */
  rackMenu() {
    const fx = this.fx(), k = this.curRack(), R = fx.racks[k] || emptyRack(), N = this.noun(), items = [];
    items.push({ label: 'Add', sub: this.addItems(null) }, { sep: true });
    items.push({ label: 'Cut ' + N, disabled: !arr(R.mods).length, action: () => { RACK_CLIP = core.copyRack(this.fx(), k); this.clearRack(k, 'Cut ' + N); } });
    items.push({ label: 'Copy ' + N, disabled: !arr(R.mods).length, action: () => { RACK_CLIP = core.copyRack(this.fx(), k); this.notify(N + ' copied'); } });
    items.push({ label: 'Paste ' + N, disabled: !RACK_CLIP, action: () => this.putRackUI(k, RACK_CLIP, 'Paste ' + N) });
    items.push({ label: 'Clear ' + N, disabled: !arr(R.mods).length, action: () => this.clearRack(k, 'Clear ' + N) });
    items.push({ sep: true });
    items.push({ label: 'Lock ' + N, checked: !!R.lock, action: () => this.setLock(k) });
    if (this.racksN() === 3) items.push({ label: 'Lock All FX Busses', checked: fx.racks.every(x => x && x.lock), action: () => this.setLockAll() });
    items.push({ sep: true });
    items.push({ label: 'Load ' + N + '…', sub: this.rackLoadItems(k) });
    items.push({ label: 'Save ' + N + '…', disabled: !arr(R.mods).length, action: () => this.saveRack(k) });
    items.push({ label: 'Export ' + N + '…', disabled: !arr(R.mods).length, action: () => this.exportRack(k) });
    items.push({ sep: true });
    // (entries load as stored, the Phase-1 factory chains from their v1 states: a v1 chain migrates in loadChain with the
    // Serum state as refs)
    const chains = this.rawChains(), fac = this.factoryChains(), load = [];
    const facFx = c => (typeof core.factoryChainFx === 'function' ? core.factoryChainFx(c) || c.fx : c.fx);
    if (fac.length) load.push({ label: 'Factory', sub: fac.map(c => ({ label: c.name, action: () => this.loadChain(facFx(c), c.name) })) }, { sep: true });
    for (const c of chains) load.push({ label: c.name, action: () => this.loadChain(c.fx, c.name) });
    if (chains.length) load.push({ sep: true });
    load.push({ label: 'Import from File…', action: () => this.importChain() });
    if (chains.length) load.push({ label: 'Export All to File…', action: () => this.exportAll() });
    items.push({ label: 'Load Effect Chain…', sub: load }, { label: 'Save Effect Chain…', action: () => this.saveChain() },
      { label: 'Export Effect Chain…', action: () => this.exportChain() });
    if (chains.length) items.push({ label: 'Delete Effect Chain', sub: chains.map(c => ({ label: c.name, action: () => this.delChain(c.name) })) });
    items.push({ sep: true }, { label: 'Reset All Racks', action: () => this.resetRack() });
    return items;
  }
  // Clear / Cut FX Bus (fx-core clearRack): the rack's instances and, in the Serum state, what addressed them
  clearRack(k, label) {
    const before = this.snapshot();
    if (this.edit(fx => { core.clearRack(fx, k); }, label, 'set', { seed: true })) this.refs(before, label, (f, s) => core.clearRack(f, k, s));
    this.refresh();
  }
  // Paste FX Bus / Load FX Bus (fx-core applyRackPreset: the payload's instances with new ids, never a replaced
  // instance's; the rack's bypass, lock and routing stay; the replaced instances' rows / locks / MIDI entries go)
  putRackUI(k, payload, label) {
    if (!isObj(payload) || !isObj(payload.rack) || !Array.isArray(payload.rack.mods)) return false;
    const before = this.snapshot();
    const ok = this.edit(fx => { core.applyRackPreset(fx, k, payload); }, label, 'set', { seed: true });
    if (ok) this.refs(before, label, (f, s) => core.clearRack(f, k, s));
    this.refresh();
    return ok;
  }
  setLock(k) { const on = !(this.fx().racks[k] && this.fx().racks[k].lock); this.edit(fx => { fx.racks[k].lock = on ? 1 : 0; }, 'Lock ' + this.noun()); this.refresh(); }
  setLockAll() { const on = !this.fx().racks.every(x => x && x.lock); this.edit(fx => { for (const R of fx.racks) R.lock = on ? 1 : 0; }, 'Lock All FX Busses'); this.refresh(); }
  // rack presets {type: 'synth.fxrack', v: 1, name, rack} (§2.5): user library synth.fxracks, factory FACTORY_RACKS
  rackPresets() {
    const l = this.storeGet('synth.fxracks', []);
    return arr(l).filter(p => isObj(p) && typeof p.name === 'string' && isObj(p.rack) && Array.isArray(p.rack.mods));
  }
  factoryRacks() {
    const F = core.FACTORY_RACKS, list = Array.isArray(F) ? F : isObj(F) && Array.isArray(F.racks) ? F.racks : [];
    return list.filter(p => isObj(p) && typeof p.name === 'string' && isObj(p.rack) && Array.isArray(p.rack.mods));
  }
  rackLoadItems(k) {
    const fac = this.factoryRacks(), user = this.rackPresets(), out = [];
    if (fac.length) out.push({ label: 'Factory', sub: fac.map(p => ({ label: p.name, action: () => this.applyRack(k, p) })) }, { sep: true });
    for (const p of user) out.push({ label: p.name, action: () => this.applyRack(k, p) });
    if (user.length) out.push({ label: 'Delete', sub: user.map(p => ({ label: p.name, action: () => { this.storeSet('synth.fxracks', this.rackPresets().filter(q => q.name !== p.name)); this.notify('“' + p.name + '” deleted'); } })) }, { sep: true });
    out.push({ label: 'Import from File…', action: () => this.importRack(k) });
    return out;
  }
  applyRack(k, p) {
    if (this.putRackUI(k, p, 'Load ' + this.noun() + ' “' + p.name + '”')) this.notify(this.noun() + ' “' + p.name + '” loaded');
  }
  rackPayload(k, name) { return core.rackPresetPayload(this.fx(), k, name); }
  saveRack(k) {
    const name = ask('Save ' + this.noun() + ' as', '');
    if (!name || !name.trim()) return;
    const nm = name.trim().slice(0, 48), list = this.rackPresets().filter(p => p.name !== nm);
    list.push(this.rackPayload(k, nm));
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.storeSet('synth.fxracks', list);
    this.notify(this.noun() + ' “' + nm + '” saved');
  }
  exportRack(k) {
    const base = (ask('Export ' + this.noun() + ' as', 'FX Rack') || '').trim().slice(0, 48);
    if (!base) return;
    saveFile(base.replace(/[\\/:*?"<>|]+/g, '_') + '.fxrack.json', JSON.stringify(this.rackPayload(k, base), null, 1));
  }
  importRack(k) {
    return pickFile('.json,application/json').then(f => (f && typeof f.text === 'function' ? f.text() : null)).then(t => {
      if (t == null) return;
      const j = JSON.parse(t);
      if (!isObj(j) || !isObj(j.rack) || !Array.isArray(j.rack.mods)) throw new Error('no FX rack in that file');
      const p = { name: typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 48) : 'Imported', rack: j.rack };
      this.storeSet('synth.fxracks', this.rackPresets().filter(q => q.name !== p.name).concat([{ type: 'synth.fxrack', v: 1, name: p.name, rack: j.rack }]).sort((a, b) => a.name.localeCompare(b.name)));
      this.applyRack(k, p);
    }).catch(err => { this.notify('Could not import the FX rack'); warnOnce('rackimp', 'fx-ui: rack import failed', err); });
  }
  // effect chains: the whole FX state of a track (§2.5). The library synth.fxchains is the list [{name, fx}] shared with
  // serum-ui's chain menu; new entries are v2 chains (FX state v2 everywhere, RULINGS2 F1: chainCopy — without ui, racks
  // unlocked); entries are read through fx-core migrateChains1 (v1 chains written by older versions migrate, v2 chains are
  // normalised; a {chains} library object is accepted too); entries this rack does not write are kept as they are.
  // Files always carry the §2.5 v2 library object.
  chainsOf(lib) { try { return arr(core.migrateChains1(lib).chains); } catch (err) { warnOnce('chains', 'fx-ui: effect chains unreadable', err); return []; } }
  rawChains() {
    const l = this.storeGet('synth.fxchains', []), L = Array.isArray(l) ? l : isObj(l) ? arr(l.chains) : [];
    return L.filter(c => isObj(c) && typeof c.name === 'string' && c.name && isObj(c.fx));
  }
  chains() { return this.chainsOf(this.rawChains()); }
  storeChains(list) { this.storeSet('synth.fxchains', list.slice().sort((a, b) => a.name.localeCompare(b.name))); }
  // Factory ▸: fx-core's v2 factory chains (FACTORY_CHAINS2: the Phase-1 chains migrated + the Serum 2 ones)
  factoryChains() { return this.chainsOf(core.FACTORY_CHAINS2 || core.FACTORY_CHAINS || []); }
  chainCopy(fx) { const c = this.chainsOf([{ name: 'x', fx: viewOf(fx) }])[0]; return c ? c.fx : null; }
  // replaces the racks (every instance, bypass, routing) keeping `ui`, each rack's lock flag and the values of locked
  // parameters whose instance (same id and type) is in the chain; seed. In the Serum state the rows, locked controls and
  // MIDI entries addressing an instance the chain does not bring back (same id and type) go, as when it is removed
  // (fx-core removeInstance): they would otherwise bind to whatever later takes that id (§2.5). A v1 chain migrates with
  // the Serum state as refs (§2.6.3): the modules those rows, locks and MIDI entries address are kept (Phase 1 kept every
  // module and the locked values)
  loadChain(src, name) {
    const n = deep(viewOf(src, this.sState())), locked = this.lockedIds(), cur = this.fx(), keep = {}, before = this.snapshot();
    for (const id of locked) { const d = core.fxDest ? core.fxDest(id, cur) : null; if (d && d.inst) keep[id] = { type: d.inst.type, pid: d.pid, v: d.inst.p[d.pid] }; }
    const ok = this.edit(fx => {
      const locks = arr(fx.racks).map(R => (isObj(R) && R.lock ? 1 : 0));
      fx.racks = deep(n.racks);
      fx.racks.forEach((R, k) => { R.lock = locks[k] || 0; });
      for (const id of Object.keys(keep)) {
        const m = /^fx\.([a-z][a-z0-9]*)\./.exec(id), f = m ? findInst(fx, m[1]) : null;
        if (f && f.inst.type === keep[id].type && fin(keep[id].v) && isObj(f.inst.p) && f.inst.p[keep[id].pid] !== undefined) f.inst.p[keep[id].pid] = keep[id].v;
      }
      if (isObj(fx.ui) && fx.ui.sel && !findInst(fx, fx.ui.sel)) fx.ui.sel = '';
    }, 'Load Effect Chain', 'set', { seed: true });
    if (ok) {
      const inc = new Map();
      walk(n, I => { inc.set(I.id, I.type); });
      const gone = I => inc.get(I.id) !== I.type;
      this.refs(before, 'Load Effect Chain', (f, s) => {
        const ids = [];
        walk(f, I => { if (gone(I)) ids.push(I.id); });
        // an instance the chain keeps leaves a splitter that goes first, so removing the splitter keeps its refs
        walk(f, I => { if (gone(I) && Array.isArray(I.br)) I.br = I.br.map(B => arr(B).filter(c => !isObj(c) || gone(c))); });
        for (const id of ids) core.removeInstance(f, id, s);
      });
    }
    this.refresh();
    if (ok && name) this.notify('Effect chain “' + name + '” loaded');
  }
  saveChain() {
    const name = ask('Save effect chain as', '');
    if (!name || !name.trim()) return;
    const nm = name.trim().slice(0, 48), list = this.rawChains().filter(c => c.name !== nm);
    list.push({ name: nm, fx: this.chainCopy(this.fx()) });
    this.storeChains(list);
    this.notify('Effect chain “' + nm + '” saved');
  }
  delChain(name) { this.storeChains(this.rawChains().filter(c => c.name !== name)); this.notify('Effect chain “' + name + '” deleted'); }
  // effect-chain files: {type: 'synth.fxchains', v: 2, chains: [{name, fx}]}; v1 files (and single-chain / bare fx
  // files) are read too
  chainFile(chains) { return JSON.stringify({ type: 'synth.fxchains', v: 2, chains }, null, 1); }
  exportChain() {
    const base = (ask('Export effect chain as', 'Effect Chain') || '').trim().slice(0, 48);
    if (!base) return;
    saveFile(base.replace(/[\\/:*?"<>|]+/g, '_') + '.fxchains.json', this.chainFile([{ name: base, fx: this.chainCopy(this.fx()) }]));
  }
  exportAll() { saveFile('effect-chains.json', this.chainFile(this.chains())); }
  importChain() {
    return pickFile('.json,application/json').then(f => (f && typeof f.text === 'function' ? f.text().then(t => this.importText(t, f.name)) : null))
      .catch(err => { this.notify('Could not import the effect chain'); console.warn('fx-ui: import failed', err); });
  }
  // merges the chains of a file into synth.fxchains by name (never loads one: that is the Load menu's job); returns the
  // number of chains added; throws when the file has none
  importText(t, fileName) {
    const j = JSON.parse(t), ok = c => isObj(c) && isObj(c.fx) && (isObj(c.fx.p) || Array.isArray(c.fx.racks));
    const fileBase = String(fileName || '').replace(/(\.fxchains?)?\.json$/i, '').trim() || 'Imported Chain';
    let add;
    if (j && Array.isArray(j.chains)) add = j.chains.filter(c => ok(c) && typeof c.name === 'string' && c.name.trim());
    else if (ok(j)) add = [{ name: typeof j.name === 'string' && j.name.trim() ? j.name : fileBase, fx: j.fx }];
    else if (isObj(j) && (isObj(j.p) || Array.isArray(j.racks))) add = [{ name: fileBase, fx: j }];
    else add = [];
    if (!add.length) throw new Error('no effect chains in that file');
    const m = new Map(this.rawChains().map(c => [c.name, c]));
    for (const c of add) { const name = c.name.trim().slice(0, 48); m.set(name, { name, fx: this.chainCopy(c.fx) }); }
    this.storeChains([...m.values()]);
    this.notify(add.length === 1 ? 'Effect chain “' + add[0].name.trim().slice(0, 48) + '” imported' : add.length + ' effect chains imported');
    return add.length;
  }
  // the default FX state keeping only `ui` (every rack lock reset too); in the Serum state the rows, locked controls and
  // MIDI entries addressing the removed instances go (fx-core clearRack on each rack, as Clear FX Bus)
  resetRack() {
    const before = this.snapshot();
    const ok = this.edit(fx => { const ui = fx.ui; fx.racks = defaultV2().racks; if (ui !== undefined) fx.ui = ui; if (isObj(fx.ui)) fx.ui.sel = ''; }, 'Reset Rack', 'set', { seed: true });
    if (ok) this.refs(before, 'Reset All Racks', (f, s) => { for (let k = 0; k < 3; k++) core.clearRack(f, k, s); });
    this.refresh();
  }
  ctlMenu(e) { // racks without a mod layer (mod: false) only: a minimal control menu (Serum's mod layer brings the full one)
    if (e.defaultPrevented) return;
    const n = closest(e.target, this.el, x => !!x.getAttribute('data-dest'));
    const id = n ? n.getAttribute('data-dest') : null, w = id && this.knobs.get(id);
    if (!w) return;
    const m = /^fx\.([a-z][a-z0-9]*)\.([A-Za-z0-9]+)$/.exec(id), I = m ? this.inst(m[1]) : null, r = I ? rowIn(I.type, I.v, m[2]) : null;
    if (!r) return;
    e.preventDefault();
    const inst = w.el.wk;
    const items = [{ label: 'Reset Control', action: () => { this.setP(I.id, r.pid, r.def, 'set'); this.refresh(); } }];
    if (inst && typeof inst.edit === 'function') items.push({ label: 'Enter Value…', action: () => inst.edit() });
    const x = this.ctlExtras(id);
    if (x.length) items.push({ sep: true }, ...x);
    contextMenu(e.clientX, e.clientY, items, { anchor: w.el });
  }
  // the control-specific items of a parameter's context menu (§13.5): Compressor RATIO ▸ Limiter Latency Comp (disabled,
  // deviation 11), Bode SHIFT ▸ ✓ Retrig. Appended by ctlMenu; a host mod layer that owns the control menus (mod: true:
  // serum-ui's knob menu, RULINGS2 U3) puts them in front of its knob menu. [] for other ids
  ctlExtras(destId) {
    const m = /^fx\.([a-z][a-z0-9]*)\.([A-Za-z0-9]+)$/.exec(String(destId || '')), I = m ? this.inst(m[1]) : null;
    if (!I) return [];
    if (I.type === 'cmp' && m[2] === 'ratio') return [{ label: 'Limiter Latency Comp (no host latency in a browser)', disabled: true }];
    if (I.type === 'bode' && m[2] === 'shift' && rowIn(I.type, I.v, 'retrig')) {
      const on = this.val(I.id, 'retrig') >= 0.5;
      return [{ label: 'Retrig', checked: on, action: () => { this.setP(I.id, 'retrig', on ? 0 : 1, 'set'); this.refresh(); } }];
    }
    return [];
  }

  /* ---------------------------------------------------------- selection */
  select(id) {
    const f = findInst(this.fx(), id);
    this.edit(fx => {
      fx.ui = isObj(fx.ui) ? fx.ui : {};
      fx.ui.sel = id;
      if (f && f.parent) { fx.ui.br = isObj(fx.ui.br) ? fx.ui.br : {}; fx.ui.br[f.parent.id] = f.branch; }
    }, 'Select FX Module', 'set', { ui: true });
    this.refresh();
    this.scrollTo(id, true);
  }
  branchOf(sid) { const u = this.fx().ui, b = isObj(u) && isObj(u.br) ? u.br[sid] : 0; return fin(b) ? b | 0 : 0; }
  selectBranch(sid, b) {
    this.edit(fx => { fx.ui = isObj(fx.ui) ? fx.ui : {}; fx.ui.br = isObj(fx.ui.br) ? fx.ui.br : {}; fx.ui.br[sid] = b; }, 'Select Branch', 'set', { ui: true });
    this.refresh();
  }
  toggleBranchByp(sid, b) {
    const I = this.inst(sid), on = !(I && Array.isArray(I.bb) && I.bb[b]);
    this.edit(fx => this.withInst(fx, sid, J => { if (Array.isArray(J.bb)) J.bb[b] = on ? 1 : 0; }), (on ? 'Bypass ' : 'Activate ') + (BRANCH_LABELS[I ? I.type : ''] || [])[b]);
    this.refresh();
  }
  scrollTo(id, flash) {
    const P = this.panels.get(id);
    if (!P || !P.el.isConnected) {
      const r = this.rowEls.find(x => x.row.kind === 'inst' && x.row.id === id);
      if (r && flash) { r.el.classList.add('fxr-flash'); setTimeout(() => r.el.classList.remove('fxr-flash'), 600); }
      return;
    }
    const rr = this.rack.getBoundingClientRect(), pr = P.el.getBoundingClientRect();
    const top = (this.rack.scrollTop || 0) + pr.top - rr.top;
    if (fin(top)) this.rack.scrollTop = Math.max(0, top - 4);
    if (flash) { P.el.classList.add('fxr-flash'); setTimeout(() => P.el.classList.remove('fxr-flash'), 600); }
  }

  /* ---------------------------------------------------------- refresh / lifecycle */
  schedule() {
    if (this.pending || this.dead) return;
    this.pending = frame(() => { this.pending = null; this.refresh(); });
  }
  // the panels the rack view shows, in order: [{P-key: {id, type, v}, parent: splitter id | null}]
  shownInsts(fx, k) {
    const out = [];
    for (const I of arr(fx.racks[k] && fx.racks[k].mods)) {
      out.push({ I, parent: null });
      if (isSplit(I.type) && Array.isArray(I.br)) for (const c of arr(I.br[this.branchOf(I.id)])) out.push({ I: c, parent: I.id });
    }
    return out;
  }
  refresh() {
    if (this.dead) return;
    if (this.pending) { this.pending(); this.pending = null; }
    this.vcache = null;
    const fx = this.fx(), k = this.curRack(), U = isObj(fx.ui) ? fx.ui : {};
    let lk = '';
    try { lk = core.fxLayout(fx).key; } catch (err) { lk = ''; }
    const shown = this.shownInsts(fx, k);
    const sig = [lk, k, shown.map(x => x.I.id + ':' + x.I.type + ':' + x.I.v).join(','),
      listRows(fx, k).map(r => r.key + (r.kind === 'inst' ? ':' + r.label + ':' + r.byp + ':' + r.v : r.kind === 'branch' ? ':' + r.byp : ':' + r.at)).join(',')].join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.buildRows(fx, k);
      // panels: keep the ones whose instance (id, type, variant) is still shown, build the new ones, drop the rest
      const want = new Set(shown.map(x => x.I.id));
      for (const [id, P] of this.panels) {
        const I = shown.find(x => x.I.id === id);
        if (!want.has(id) || !I || I.I.type !== P.type || I.I.v !== P.v) this.dropPanel(id);
      }
      for (const x of shown) if (!this.panels.has(x.I.id)) this.panels.set(x.I.id, this.buildPanel(x.I));
      // DOM order: top-level panels after the empty notice; branch panels inside their splitter's box
      const top = shown.filter(x => !x.parent).map(x => this.panels.get(x.I.id).el), rk = this.rack.children;
      if (top.some((el, i) => rk[i + 1] !== el) || rk.length !== top.length + 1) for (const el of top) this.rack.append(el);
      for (const x of shown) {
        if (!x.parent) continue;
        const S = this.panels.get(x.parent), el = this.panels.get(x.I.id).el;
        if (S && S.brBox) S.brBox.append(el);
      }
    }
    show(this.empty, !shown.length);
    this.el.classList.toggle('fxr2-expand', !!U.expand);
    this.expBtn.classList.toggle('wk-on', !!U.expand);
    this.expBtn.setAttribute('aria-pressed', U.expand ? 'true' : 'false');
    this.tabs.forEach((b, j) => {
      const R = fx.racks[j] || {};
      b.setAttribute('aria-selected', j === k ? 'true' : 'false');
      b.tabIndex = j === k ? 0 : -1;
      b.classList.toggle('fxr2-tbyp', !!R.byp);
      b.classList.toggle('fxr2-tlock', !!R.lock);
      b.title = RACK_NAMES[j] + (R.byp ? ' (bypassed)' : '') + (R.lock ? ' (locked)' : '');
    });
    for (const r of this.rowEls) {
      if (r.row.kind !== 'inst') continue;
      const on = this.val(r.row.id, 'on') >= 0.5;
      r.el.classList.toggle('fxr-on', on);
      r.el.classList.toggle('fxr2-off', !on);
      r.el.classList.toggle('fxr-sel', U.sel === r.row.id);
    }
    for (const r of this.rowEls) if (r.row.kind === 'branch') r.el.classList.toggle('fxr2-bsel', this.branchOf(r.row.parent) === r.row.branch);
    for (const w of this.rowWidgets) w.update();
    for (const P of this.panels.values()) {
      const I = this.inst(P.id);
      P.el.classList.toggle('fxr2-off', !(this.val(P.id, 'on') >= 0.5));
      P.el.classList.toggle('fxr-byp', !!(I && I.byp));
      P.el.classList.toggle('fxr-sel', U.sel === P.id);
      const t = instTitle(fx, P.id);
      if (P.title.textContent !== t) P.title.textContent = t;
      for (const f of P.upd) { try { f(); } catch (err) { warnOnce('upd', 'fx-ui: panel update failed', err); } }
      for (const w of P.widgets) w.update();
    }
    if (this.xs) this.xs.ed.refresh();
    // the overlay's instance went (or is no longer a Delay): the tap is switched off
    if (this.specId && !(this.inst(this.specId) && this.inst(this.specId).type === 'dly')) {
      this.specId = ''; this.specD = null;
      if (typeof this.host.setTap === 'function') this.host.setTap('');
    }
    this.redraw();
    this.grLoop();
    this.specLoop();
  }
  dropPanel(id) {
    const P = this.panels.get(id);
    if (!P) return;
    if (this.xs && this.xs.P === P) this.closeXs();
    for (const f of P.offs) { try { f(); } catch (err) { /* already gone */ } }
    P.offs.length = 0;
    for (const w of P.widgets) if (w.destroy) w.destroy();
    for (const [d, w] of this.knobs) if (P.widgets.includes(w) || (w && P.el.contains(w.el))) this.knobs.delete(d);
    P.el.remove();
    this.panels.delete(id);
  }
  tip(w, idFn) {
    tooltip(w.el, () => {
      const id = idFn();
      if (!id) return '';
      if (typeof this.host.tip === 'function') { try { const t = this.host.tip(id); if (t != null && t !== '') return String(t); } catch (err) { /* host fallback */ } }
      const m = /^fx\.([a-z][a-z0-9]*)\.([A-Za-z0-9]+)$/.exec(id);
      return m ? this.label(m[1], m[2]) + ': ' + this.fmtV(m[1], m[2], this.val(m[1], m[2])) : id;
    });
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.pending) this.pending();
    if (this.grTick) this.grTick.stop();
    if (this.specTick) this.specTick.stop();
    if (this.specId && typeof this.host.setTap === 'function') this.host.setTap('');
    if (this.irTimers) for (const t of this.irTimers) clearTimeout(t);
    this.closeXs();
    for (const id of [...this.panels.keys()]) this.dropPanel(id);
    for (const w of this.rowWidgets) if (w.destroy) w.destroy();
    for (const r of this.rowEls) { if (r.drag) r.drag.destroy(); if (r.off) r.off(); }
    for (const f of this.offs) f();
    this.knobs.clear();
    this.el.remove();
  }
}
