// serum-ui.js — the Serum-style instrument panel, v2 shell (SPEC-serum2 §13, §11.14; Phase 1: SPEC-serum §8.8, §9).
// SerumUI: header (render-last wave icon, logo, tabs OSC · MIX · FX · MATRIX · ARP · CLIP · GLOBAL, preset area with
// ARTIST / DESC, panel Undo / Redo, main menu, touch modifier bar, voice counter, MASTER knob + output meter), the seven
// pages, the keyboard panel at the bottom of every page, drag-and-drop modulation with halos and live dots, the knob
// right-click menus (module menus, Aux Source, Edit Custom Curve, Unlock Control), the 64-row matrix, locks, MIDI-learn
// hooks, the WT editor overlay and the LFO Editor overlay; PresetBrowser v2 (preview, ratings, tags, Hybridize, packs).
// The sub-panels live in their own modules and are bound through the kit made by makeKit (§11.14): sx-ui-osc (OSC A–C,
// SUB, NOISE, FILTER 1/2; U2), sx-ui-mix (MIX page; U3, loaded on demand), fx-ui (FX page; U3), sx-ui-seq (ARP, CLIP,
// keyboard; U4). serum-ui owns the page shell, the modulation area (tiles, MACROS 1–8, ENV 1–4, LFO 1–10 / VELO /
// NOTE, VOICING), the MATRIX and GLOBAL pages and the preset browser.
//
// Browser ES module. Nothing touches document / window / localStorage / navigator at module top level, so node
// can import it for the pure-helper tests (§0.1, §10.6). Sibling modules are imported as namespaces: a helper
// missing from a sibling degrades one feature (with a notice) instead of failing the whole panel at link time.
//
// Pure helpers (node-tested, tests/serum-ui.test.mjs): haloArcs, knobMenuItems, moduleMenuItems, dropRow,
// busMenuItems, lfoTileCount, sortPresets, filterPresets, browserList, stepPreset, presetTags, withMeta, hybridPick,
// captureDue, undoStack, clipModule / pasteModule / initModule (→ serum-core copyModule / initModule), linkPoints,
// parseGrid, parseAmount, normPrefs, normBrowser, presetCats, memTrigSet, tileDests, modTipLines, s1Diff,
// rowAlias, rowBad, destModule, virtGet / virtSet; and makeKit, the binding kit of the sub-panels (§11.14).
//
// Edits: every state change goes through host.edit / host.editFx (fn mutates the live state in place). UI-only
// changes (s.ui.*, page, editor selection) pass { ui: true }. Continuous gestures send phase start → move… → end
// with a stable label. Preset-like loads (Init Preset, effect chains, Hybridize) also pass { seed: true }. Every
// non-UI gesture ends with a panel undo snapshot (§13.2.4; undoStack(100), 600 ms coalescing, ≤ 16 MB).
//
// Optional host members used when present (all degrade gracefully; for the integrator):
//   host.wt.rename / del / users, host.sampleRate, host.editorOpen(o | null), host.prefsChanged(prefs) — Phase 1
//   host.smp, host.tracks, host.seqCmd, host.onInput, host.preview, host.renderLast, host.clipToTrack, host.download,
//   host.tuningFile, host.renderWarp, host.resample — §11.15 (passed to the sub-panels through kit.host)
//   host.presets.get(key) → the preset object {name, cat, v: {s}, fx} (Hybridize; factory keys 'f:<name>' fall back
//                                to serum-core FACTORY_PRESETS)
//   host.presets.setMeta(key, {stars, tags, comments}) — ratings / tags of user presets stored in the preset object
//                                (without it every rating lives in synth.sx.meta)
//   host.presets.rename(key, name) / move(key, cat) / exportPack(keys) — browser menu items (shown disabled without them)
//   host.presets.save({name, cat, overwrite}) — Alt-click on Save passes overwrite: true (no dialog)
//   host.previewMacros(n[8])  — the preset browser's MACROS 1–8 while a preview plays (§13.11 "macros adjustable during
//                                preview"): the preview node replays with these macro values (without it the strip is
//                                shown disabled)
//   host.renderLast(…) resolving to {name, blob} or {name, url} — the header render kept for the wave icon's desktop
//                                drag (DownloadURL, deviation 21); without it a drag renders and downloads like a click
//   host.qualityChosen(os)   — GLOBAL > QUALITY chosen (also the selected one again): reset the CPU safeguard's steps (§14.3)
//   host.smp.usage()          — {bytes, budget} (or a promise of it): the GLOBAL page's project asset meter (§14.2)
//   (presets.get / setMeta / rename / move / exportPack, previewMacros, qualityChosen, smp.usage and the renderLast
//   result are not in the §11.15 contract yet: raised with the integrator for a spec amendment)
// Storage keys: synth.sx.prefs, synth.sx.browser (incl. autoPreview), synth.sx.meta (ratings / tags / comments of
// factory presets), synth.sx.default (Save as Default Preset), synth.sx.vc (user Voice Control presets),
// synth.sx.shapes (via graph.shapeLib), synth.fxchains.
// MIDI program change: index browserList(host.presets.list(), storage[BROWSER_KEY]) (§9.10, §11.8).
import * as core from './serum-core.js?v=9';
import * as wt from './wt.js?v=9';
import * as wk from './wk.js?v=9';
import * as gx from './graph.js?v=9';
import * as fxui from './fx-ui.js?v=9';
import * as wte from './wtedit.js?v=9';
import * as osc from './sx-ui-osc.js?v=9';
import * as seq from './sx-ui-seq.js?v=9';

/* ================================================================ constants and small helpers */

const { DESTS, DEST_INDEX, SOURCES, SRC_INDEX, SRC_MENU, UNI_STACKS, UNI_MODES, MODULE_FIELDS, MC_K } = core;

export const PREFS_KEY = 'synth.sx.prefs';
export const BROWSER_KEY = 'synth.sx.browser';
export const META_KEY = 'synth.sx.meta';
export const DEFAULT_KEY = 'synth.sx.default';
export const VC_KEY = 'synth.sx.vc';
const SHAPES_KEY = 'synth.sx.shapes';
const CHAINS_KEY = 'synth.fxchains';
export const PAGES = Object.freeze(['osc', 'mix', 'fx', 'matrix', 'arp', 'clip', 'global']);
const PAGE_LABEL = { osc: 'OSC', mix: 'MIX', fx: 'FX', matrix: 'MATRIX', arp: 'ARP', clip: 'CLIP', global: 'GLOBAL' };
const N_MX = core.N_MATRIX || 64, N_LFO = core.N_LFO || 10, N_ENV = core.N_ENV || 4, N_MAC = core.N_MACRO || 8, N_OSC = 3;
const OSC_L = ['A', 'B', 'C'], OSC_P = ['a', 'b', 'c'], OSC_MOD = ['oscA', 'oscB', 'oscC'];
const ENV_ED = { a: 'att', h: 'hold', d: 'dec', s: 'sus', r: 'rel', ca: 'ca', cd: 'cd', cr: 'cr', st: 'start', en: 'end' };
const LFO_KNOBS = [['rate', 'RATE'], ['rise', 'RISE'], ['delay', 'DELAY'], ['smooth', 'SMOOTH']];
const LFO_MODES = ['free', 'retrig', 'env'];   // MODE seg FREE / RETRIG / ENVELOPE (§13.13)
const LFO_TYPES = (core.LFO_TYPES || ['normal', 'path', 'lorenz', 'rossler', 'sh']).map(t => (typeof t === 'string' ? t : t.id));
const LFO_TYPE_LABEL = { normal: 'Normal', path: 'Path', lorenz: 'Chaos: Lorenz', rossler: 'Chaos: Rossler', sh: 'S&H' };
const LFO_DIRS = ['fwd', 'rev', 'pp'], LFO_DIR_LABEL = ['Forward', 'Reverse', 'Ping Pong'];
const LFO_TOOL_IDS = ['point', 'flat', 'rampUp', 'rampDown'], LFO_TOOL_LABEL = ['Point', 'Flat', 'Ramp Up', 'Ramp Down'];
const STEAL_LABEL = ['Newest', 'Oldest', 'Highest', 'Lowest', 'Velocity'];
const MPE_XYZ_LABEL = ['Off', 'XYZ → Macro 1, 2, 3', 'YZ → Macro 1, 2', 'Y → Mod Wheel'];
const QUALITY = [[1, 'Draft'], [2, 'High'], [4, 'Ultra']];
const C = { bg: '#0f1216', panel: '#161b21', line: '#2a333d', ink: '#dfe6ee', mute: '#7f8b98', accent: '#4fb3ff',
  neg: '#ffb347', on: '#6fe3a1', warn: '#ff6a4a', graph: '#59c2ff', cur: '#ffd84a', grey: '#55606c' };
const BUILD = 'Serum v2 panel · state v' + (core.VERSION || 2) + ' · CP v' + (core.CP_VER || 2);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const fin = x => typeof x === 'number' && isFinite(x);
const fnOf = v => (typeof v === 'function' ? v : () => v);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = x => (Array.isArray(x) ? x : []);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const frac = x => x - Math.floor(x);
const sgn = v => (v > 0 ? '+' : '');
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
// gesture.js's synthetic pointercancel: a second finger made this touch a pan / pinch — roll the gesture back
const twoF = e => !!e && e.gesture === 'two-finger';
// an FX parameter (base in the FX state): FX ids other than g.master / g.bypass (their base is in s.p). SPEC-serum2
// §3.11.1: FX-ness is never derived from the static index (the SYN2 ids follow the FX block); isFxId is the only FX test.
const isFxPar = id => core.isFxId(id) && id !== 'g.master' && id !== 'g.bypass';
// the instances of a v2 FX state (racks in order, list order, a splitter's branches after it): fn(inst)
function fxWalk(fx, fn) {
  for (const R of arr(isObj(fx) ? fx.racks : null)) for (const I of arr(isObj(R) ? R.mods : null)) {
    if (!isObj(I)) continue;
    fn(I);
    for (const B of arr(I.br)) for (const c of arr(B)) if (isObj(c)) fn(c);
  }
}
const destOf = id => { const i = DEST_INDEX[id]; return i === undefined ? null : DESTS[i]; };
// the row of a destination id: static rows by id, dynamic FX ids (fx.<inst>.<pid>) through fx-core's fxDest
function rowOfDest(id, fx) {
  const d = destOf(id);
  if (d) return d;
  if (typeof id !== 'string' || !/^fx\./.test(id) || typeof core.fxDest !== 'function') return null;
  let r = null;
  try { r = core.fxDest(id, fx); } catch (err) { r = null; }
  return r && r.row ? Object.assign({ id }, r.row, { nomod: !!r.nomod }) : null;
}
// index of a destination in the snapshot's eff (§6.20): vi for voice destinations, NSV + FX-context index (§4.2) for
// g.master / g.bypass and FX parameters (dynamic ids through fxDest); −1 when the snapshot has no value for it
function effIdx(id, fx) {
  const v = core.vi(id);
  if (v >= 0) return v;
  if (id === 'g.master') return core.NSV + core.GIDX.MASTER;
  if (id === 'g.bypass') return core.NSV + core.GIDX.BYPASS;
  if (isFxPar(id) && typeof core.fxDest === 'function') {
    let d = null;
    try { d = core.fxDest(id, fx); } catch (err) { d = null; }
    if (d && fin(d.flat)) return core.NSV + 8 + d.flat;
  }
  return -1;
}
// the S1 / S2 paired fields (§2.6.4): an edit of either side is followed by core.syncS1 (C1)
const PAIRED = new Set(arr(core.S1_PAIRS).flatMap(q => arr(q.v1).concat(arr(q.s2))));
// panel undo steps that re-seed the FX rack's LFO phases when undone / redone (the preset-like loads that seeded, §4.2)
const SEED_LABEL = /^(Load preset|Init Preset|Hybridize|Load Effect Chain|Load .+ Preset|Reset Rack)$/;
// lock edits through serum-core setLock / setModuleLock (§2.2.5 rules), with the plain array edit as a fallback
function setLockOf(s, id, on) {
  if (typeof core.setLock === 'function') return core.setLock(s, id, on);
  const L = s.locks, m = destModule(id);
  if (m && arr(L.mod).includes(m)) {
    if (!Array.isArray(L.unp)) L.unp = [];
    if (on) toggleIn(L.unp, id, false); else { toggleIn(L.p, id, false); toggleIn(L.unp, id, true); }
  } else toggleIn(L.p, id, on);
  return true;
}
function setModuleLockOf(s, m, on) {
  if (typeof core.setModuleLock === 'function') return core.setModuleLock(s, m, on);
  toggleIn(s.locks.mod, m, on);
  if (!on && Array.isArray(s.locks.unp)) s.locks.unp = s.locks.unp.filter(id => destModule(id) !== m);
  return true;
}
// the FX instance layout of an FX state (fx-core fxLayout key; the rack topology), '' when unknown
function fxLayoutKey(fx) {
  if (!isObj(fx) || typeof core.fxLayout !== 'function') return '';
  try { const L = core.fxLayout(fx); return L && typeof L.key === 'string' ? L.key : ''; } catch (err) { return ''; }
}
const syncS1 = (s, id) => { if (PAIRED.has(id) && typeof core.syncS1 === 'function') core.syncS1(s, id); };
const ALIAS = { 'a.warpMode': 'a.w1', 'b.warpMode': 'b.w1', 's.shape': 's.shp', 'f.type': 'f.type2', 'g.bendup': 'g.bu2', 'g.benddn': 'g.bd2' };
const ALIAS_S2 = Object.keys(ALIAS).reduce((o, k) => { o[ALIAS[k]] = k; return o; }, {});
const PAIR_LABEL = { aWarp: 'OSC A warp', bWarp: 'OSC B warp', subShape: 'sub shape', f1Type: 'filter 1 type', bendUp: 'bend up',
  bendDown: 'bend down', aPhaseMem: 'OSC A phase memory', bPhaseMem: 'OSC B phase memory' };
const gridOf = d => (!d ? 0 : d.law === 'int' ? d.hi - d.lo : d.law === 'enum' ? d.hi : d.law === 'bool' ? 1 : 0);
const stepsOf = d => (d && (d.law === 'int' || d.law === 'enum') ? gridOf(d) : 0);
const srcPol = id => { const i = SRC_INDEX[id]; return i ? SOURCES[i].pol : 'uni'; };
const lfoNum = id => { const m = /^lfo([1-9]|10)$/.exec(id || ''); return m ? +m[1] : 0; };
const envNum = id => { const m = /^env([1-4])$/.exec(id || ''); return m ? +m[1] : 0; };
const macNum = id => { const m = /^macro([1-8])$/.exec(id || ''); return m ? +m[1] : 0; };
const EDIT_SRC = /^(lfo([1-9]|10)|velo|note)$/;
const rowActive = r => !!(r && r.src && r.dst && !r.byp && r.amt !== 0 && r.out !== 0);
const emptyRow = () => ({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1,
  acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });   // v2 row (§2.3)
const warnOnce = (() => { const seen = new Set(); return (k, ...a) => { if (!seen.has(k)) { seen.add(k); console.warn(...a); } }; })();
// a touch device (coarse pointer or touch points): its panel undo keeps at most UNDO_TOUCH_BYTES of snapshots
const UNDO_TOUCH_BYTES = 4 * 1024 * 1024;
function isTouchDev(d) {
  const w = (d && d.defaultView) || globalThis, n = w.navigator || globalThis.navigator;
  try { if (w.matchMedia && w.matchMedia('(pointer: coarse)').matches) return true; } catch (err) { /* no media queries */ }
  return !!(n && n.maxTouchPoints > 0);
}
const nowMs = () => { const p = globalThis.performance; return p && typeof p.now === 'function' ? p.now() : Date.now(); };
const s1On = s => !!(s && s.global && s.global.s1);
const s0Os = s => (s && s.global ? s.global.os : undefined);

// module of every destination (MODULE_FIELDS v2: locks, copy / paste / init, Unlock Control)
const DEST_MOD = new Map();
for (const m of Object.keys(MODULE_FIELDS || {})) for (const id of arr(MODULE_FIELDS[m].p)) if (!DEST_MOD.has(id)) DEST_MOD.set(id, m);
export function destModule(id) { return DEST_MOD.get(id) || null; }
// module kinds: copy / paste / swap across the members of a kind (§11.1 allowed pairs), every other module with itself
const modKind = m => (/^osc[ABC]$/.test(m) ? 'osc' : m === 'filter' || m === 'filter2' ? 'filter' : /^env[1-4]$/.test(m) ? 'env'
  : /^lfo([1-9]|10)$/.test(m) ? 'lfo' : m);
const KIND_MEMBERS = {
  osc: OSC_MOD, filter: ['filter', 'filter2'], env: ['env1', 'env2', 'env3', 'env4'],
  lfo: Array.from({ length: N_LFO }, (_, l) => 'lfo' + (l + 1)),
};
// module label → its audio-rate modulation source (§3.10: dragging a module label onto a control = that audio source)
const MOD_AUDIO_SRC = { oscA: 'osca', oscB: 'oscb', oscC: 'oscc', sub: 'sub', noise: 'noise', filter: 'filt1', filter2: 'filt2' };
const audioSrcOf = m => (own(MOD_AUDIO_SRC, m) && SRC_INDEX[MOD_AUDIO_SRC[m]] !== undefined ? MOD_AUDIO_SRC[m] : null);
// drop kinds an audio source can land on (hitTest): a control, a matrix source cell, an X|Y dot, an LFO point
const AUDIO_DROPS = new Set(['dest', 'msrc', 'xy', 'point']);
const MOD_TITLE = m => {
  if (/^osc[ABC]$/.test(m)) return 'OSC ' + m.slice(3);
  if (m === 'filter') return 'Filter 1';
  if (m === 'filter2') return 'Filter 2';
  if (/^env\d/.test(m)) return 'Env ' + m.slice(3);
  if (/^lfo\d/.test(m)) return 'LFO ' + m.slice(3);
  return { noise: 'Noise', sub: 'Sub', velo: 'Velocity', note: 'Note', arp: 'Arp', clip: 'Clip', vc: 'Voice Control', matrix: 'Matrix' }[m] || m;
};

// normalised n snapped to the grid of a stepped law (exactly k/(hi−lo), as normalizeSerum stores it)
function snapN(id, n, fx) {
  const m = gridOf(destOf(id) || rowOfDest(id, fx));
  return m ? Math.round(clamp01(n) * m) / m : clamp01(n);
}
// Virtual destinations (§3.11.3): their bases live outside s.p — macros m1…m8 in s.macros[k].v, arp.* in the selected
// arp slot's n (s.arp.slots[sel].n), clip.* in the selected clip's n. virtGet → n (or undefined: not virtual / missing);
// virtSet writes n (EDIT ALL: every slot / clip) and returns true when id was virtual. arp.rate is the slot's n.rate in BPM
// mode and n.hz in HZ mode (slot.bpm = 0, §2.4.1 — what the sequencer reads, §4.4; serum-core destBase / setDestBase
// map it the same way, RULINGS2 C1/U1), per slot.
const VIRT_RE = /^(m([1-8])|arp\.(\w+)|clip\.(\w+))$/;
const virtKey = (it, k, arpId) => (arpId && k === 'rate' && isObj(it) && (typeof it.bpm === 'boolean' ? !it.bpm : fin(it.bpm) && it.bpm < 0.5) ? 'hz' : k);
export function virtGet(s, id) {
  const m = VIRT_RE.exec(id || '');
  if (!m || !isObj(s) || !destOf(id) || id === 'arp.on' || id === 'clip.on') return undefined;
  if (m[2]) { const M = arr(s.macros)[+m[2] - 1]; return isObj(M) && fin(M.v) ? clamp01(M.v) : undefined; }
  const A = m[3] ? s.arp : s.clip, list = m[3] ? arr(A && A.slots) : arr(A && A.clips);
  const it = isObj(A) ? list[A.sel | 0] : null, k = virtKey(it, m[3] || m[4], !!m[3]);
  return isObj(it) && isObj(it.n) && fin(it.n[k]) ? clamp01(it.n[k]) : undefined;
}
export function virtSet(s, id, n) {
  const m = VIRT_RE.exec(id || '');
  if (!m || !isObj(s) || !destOf(id) || id === 'arp.on' || id === 'clip.on') return false;
  if (m[2]) { const M = arr(s.macros)[+m[2] - 1]; if (isObj(M)) M.v = clamp01(n); return true; }
  const A = m[3] ? s.arp : s.clip, list = m[3] ? arr(A && A.slots) : arr(A && A.clips), k = m[3] || m[4];
  if (!isObj(A)) return true;
  const sel = A.sel | 0;
  list.forEach((it, j) => { if (isObj(it) && isObj(it.n) && (j === sel || A.editAll)) it.n[virtKey(it, k, !!m[3])] = clamp01(n); });
  return true;
}
// base n of a destination: virtual ids (above), synth ids (and g.master / g.bypass) from s.p, FX ids (static v1 and
// dynamic v2) from the FX state, else the default (§5.8)
function baseN(s, fx, id) {
  const v = virtGet(s, id);
  if (v !== undefined) return v;
  if (typeof core.destBase === 'function') return core.destBase(s, fx, id);
  const i = DEST_INDEX[id];
  if (i === undefined) return 0;
  const src = isFxPar(id) ? fx : s, x = src && src.p ? src.p[id] : undefined;
  return fin(x) ? clamp01(x) : DESTS[i].def;
}
function rowsOf(s) { return s && Array.isArray(s.matrix) ? s.matrix : []; }

// Display label of a source; macros show their user names
export function srcLabel(s, id) {
  const m = macNum(id);
  if (m && s && s.macros && s.macros[m - 1] && s.macros[m - 1].name) return s.macros[m - 1].name;
  const i = SRC_INDEX[id];
  return i !== undefined ? SOURCES[i].label : '—';
}
// grouped source menu entries [{group, items: [{id, label}]}] (serum-core srcMenu, §3.10; flat SRC_MENU fallback)
function srcGroups(s) {
  if (typeof core.srcMenu === 'function') { try { return core.srcMenu(s); } catch (err) { warnOnce('srcMenu', err); } }
  return [{ group: 'Sources', items: SRC_MENU.map(id => ({ id, label: srcLabel(s, id) })) }];
}

/* ================================================================ pure helpers (§8.8, §11.14; node-tested) */

// Halo arcs of every active row on control `destId` (§5.8): normalised, clamped, from ≤ to. Static and dynamic FX
// ids (fx.<inst>.<pid>, bases through destBase). unipolar row + unipolar source [base, base + a]; unipolar row +
// bipolar source [base − |a|, base + |a|]; bipolar row [base − |a|/2, base + |a|/2]; a = amt·out. kind: 'sel' (row
// source = selSrc), 'neg' (a < 0), 'other'. Aux sources are ignored (the arc shows the maximum reach). Each arc
// carries its matrix slot.
export function haloArcs(s, fx, destId, selSrc) {
  const out = [];
  if (!rowOfDest(destId, fx)) return out;
  const base = baseN(s, fx, destId), M = rowsOf(s);
  for (let slot = 0; slot < M.length; slot++) {
    const r = M[slot];
    if (!rowActive(r) || r.dst !== destId) continue;
    const a = r.amt * r.out, m = Math.abs(a);
    let lo, hi;
    if (r.bi) { lo = base - m / 2; hi = base + m / 2; }
    else if (srcPol(r.src) === 'bi') { lo = base - m; hi = base + m; }
    else { lo = Math.min(base, base + a); hi = Math.max(base, base + a); }
    out.push({ from: clamp01(lo), to: clamp01(hi), kind: r.src === selSrc ? 'sel' : a < 0 ? 'neg' : 'other', slot });
  }
  return out;
}

// [{slot, row}] of the rows on dst that have a source (any state: bypassed / zero rows included)
function modRows(s, dst) {
  const out = [], M = rowsOf(s);
  for (let slot = 0; slot < M.length; slot++) { const r = M[slot]; if (r && r.dst === dst && r.src) out.push({ slot, row: r }); }
  return out;
}
// C1: a module is live when its power base is on or an active matrix row targets its power id (serum-core possOn):
// a live module shows its panel, an off one folds to its title row
export function powerLive(s, fx, id) { return baseN(s, fx, id) >= 0.5 || rowsOf(s).some(r => rowActive(r) && r.dst === id); }
// the row the per-control actions address (Alt-drag depth, Aux Source, Edit Custom Curve): the selected source's row
// on dst, else `recent` (when it still targets dst), else the last row; −1 without rows
export function actionSlot(s, dst, recent) {
  const rows = modRows(s, dst);
  if (!rows.length) return -1;
  const sel = rows.find(r => r.row.src === (s.ui && s.ui.mod));
  if (sel) return sel.slot;
  if (recent !== undefined && rows.some(r => r.slot === recent)) return recent;
  return rows[rows.length - 1].slot;
}
// lowest CC whose MIDI-learn target is id, or null
export function ccFor(s, id) {
  let best = null;
  const m = s && isObj(s.midi) ? s.midi : {};
  for (const k of Object.keys(m)) if (m[k] === id && (best === null || +k < best)) best = +k;
  return best;
}

// Module menu items (§13.3 module menus, inv B2): Lock Module · Init Module · Copy · Copy (w/mods) · Paste (when the
// clipboard fits: caps.paste) · Swap with ▸ (the other members of the module's kind). Returns [{label, kind, …}].
export function moduleMenuItems(s, m, caps) {
  const c = caps || {}, out = [];
  if (!MODULE_FIELDS[m]) return out;
  const locked = !!(s && s.locks && arr(s.locks.mod).includes(m));
  out.push({ label: 'Lock Module', kind: 'lockModule', checked: locked });
  out.push({ label: 'Init Module', kind: 'init' });
  out.push({ label: 'Copy', kind: 'copy' });
  out.push({ label: 'Copy (w/mods)', kind: 'copyMods' });
  if (c.paste) out.push({ label: 'Paste', kind: 'paste' });
  const others = arr(KIND_MEMBERS[modKind(m)]).filter(x => x !== m && MODULE_FIELDS[x]);
  if (others.length) out.push({ label: 'Swap with', kind: 'swap', sub: others.map(x => ({ label: MOD_TITLE(x), kind: 'swapWith', m: x })) });
  return out;
}

// Knob right-click menu (§9.4, §13.6, §13.3), exact order: [module items · sep] · Bypass Modulator: <src> (per row) ·
// Remove Modulator: <src> (per row) · Remove All Modulators · Aux Source ▸ · Edit Custom Curve · sep · Reset Control ·
// Enter Value… · [New MemTrig phase set] · sep · Mod Source ▸ · sep · MIDI Learn | MIDI Re-learn (CC n), Remove MIDI
// CC n · Lock | Unlock (inside a locked module instead: Unlock Control | Lock Control, locks.unp). Items without rows are
// omitted (never shown disabled). caps = { midi, module: 'oscA'…, paste, recent }. Aux Source / Edit Custom Curve
// address actionSlot(s, destId, caps.recent). Returns [{label, kind, slot?, checked?, sub?}]; separators are
// { label: '', kind: 'sep' }; Mod Source / Aux Source subs are grouped ([{label: group, sub: [{label, kind, src}]}]).
export function knobMenuItems(s, fx, destId, caps) {
  const c = caps || {}, out = [];
  const sep = () => { if (out.length && out[out.length - 1].kind !== 'sep') out.push({ label: '', kind: 'sep' }); };
  if (c.module && MODULE_FIELDS[c.module]) { out.push(...moduleMenuItems(s, c.module, c)); sep(); }
  const rows = modRows(s, destId);
  for (const { slot, row } of rows) out.push({ label: 'Bypass Modulator: ' + srcLabel(s, row.src), kind: 'bypass', slot, checked: !!row.byp });
  for (const { slot, row } of rows) out.push({ label: 'Remove Modulator: ' + srcLabel(s, row.src), kind: 'remove', slot });
  if (rows.length) {
    out.push({ label: 'Remove All Modulators', kind: 'removeAll' });
    const slot = actionSlot(s, destId, c.recent), cur = s.matrix[slot].aux || '';
    const sub = [{ label: 'None', kind: 'aux', src: '', checked: !cur }].concat(srcGroups(s).map(g => ({ label: g.group,
      sub: g.items.map(x => ({ label: x.label, kind: 'aux', src: x.id, checked: x.id === cur })) })));
    out.push({ label: 'Aux Source', kind: 'auxSrc', slot, sub });
    out.push({ label: 'Edit Custom Curve', kind: 'curve', slot });
    sep();
  }
  out.push({ label: 'Reset Control', kind: 'reset' });
  out.push({ label: 'Enter Value…', kind: 'enter' });
  if (/^[abc]\.phase$/.test(destId)) out.push({ label: 'New MemTrig phase set', kind: 'memtrig' });
  sep();
  out.push({ label: 'Mod Source', kind: 'modsrc', sub: srcGroups(s).map(g => ({ label: g.group,
    sub: g.items.map(x => ({ label: x.label, kind: 'src', src: x.id })) })) });
  sep();
  if (c.midi) {
    const cc = ccFor(s, destId);
    if (cc === null) out.push({ label: 'MIDI Learn', kind: 'midiLearn' });
    else {
      out.push({ label: 'MIDI Re-learn (CC ' + cc + ')', kind: 'midiLearn', cc });
      out.push({ label: 'Remove MIDI CC ' + cc, kind: 'midiForget', cc });
    }
  }
  const L = s && s.locks ? s.locks : {}, locked = arr(L.p).includes(destId), dm = destModule(destId);
  if (dm && arr(L.mod).includes(dm)) {
    // inside a locked module one item (serum-core lockState / setLock): Unlock Control for a control locked by the
    // module or by its own parameter lock, Lock Control for a control unlocked inside it (locks.unp)
    const un = arr(L.unp).includes(destId) && !locked;
    out.push({ label: un ? 'Lock Control' : 'Unlock Control', kind: un ? 'lockCtl' : 'unlockCtl' });
  } else out.push({ label: locked ? 'Unlock' : 'Lock', kind: locked ? 'unlock' : 'lock' });
  return out;
}

// Drag-and-drop row (§5.8, wraps addMod; mutates s): {slot, row} or null when the matrix is full (64 rows) / ids
// invalid. opts.limit = the "Limit mod depth on drop" preference (default on).
export function dropRow(s, fx, src, dst, opts) {
  const limit = opts && 'limit' in opts ? !!opts.limit : true;
  const slot = core.addMod(s, fx, src, dst, { limit });   // the lowest row without a source (64 rows)
  return slot >= 0 ? { slot, row: s.matrix[slot] } : null;
}

// LFO point-modulation menu (§9.4): `Bus k (<source labels>)` for every bus some point links (ascending;
// just `Bus k` when no row feeds it), then `New bus` = newBus(s) (omitted when 0). pt = point index or array;
// an item is `checked` when every listed point already links that bus on `axis` ('x' | 'y').
export function busMenuItems(s, lfo, pt, axis) {
  const items = [], map = core.linkedBuses(s), ai = axis === 'x' ? 3 : 4;
  const idxs = Array.isArray(pt) ? pt : pt === undefined || pt === null ? [] : [pt];
  const pts = s && s.lfo && s.lfo[lfo] ? arr(s.lfo[lfo].pts) : [];
  for (const bus of Array.from(map.keys()).sort((a, b) => a - b)) {
    const labels = [];
    for (const id of arr(map.get(bus).sources)) { const l = srcLabel(s, id); if (!labels.includes(l)) labels.push(l); }
    const it = { label: 'Bus ' + bus + (labels.length ? ' (' + labels.join(', ') + ')' : ''), bus };
    if (idxs.length && idxs.every(i => pts[i] && pts[i][ai] === bus)) it.checked = true;
    items.push(it);
  }
  const nb = core.newBus(s);
  if (nb) items.push({ label: 'New bus', bus: nb });
  return items;
}

// In place: links axis ('x' | 'y') of points idxs of LFO `lfo` to `bus`; with src also adds the row
// src → bus<k> (bipolar, amount 0.5). First/last points never take an X link. The rows of the buses the relinked
// points held before and that no point links any more are pruned (inv A13); rows aimed at buses no point ever
// linked (a routing prepared in the matrix) are kept. Returns the number of points linked (0 → nothing changed).
export function linkPoints(s, fx, lfo, idxs, axis, bus, src) {
  const L = s && s.lfo && s.lfo[lfo];
  if (!L || !(bus >= 1 && bus <= 16)) return 0;
  const pts = L.pts, ai = axis === 'x' ? 3 : 4, cut = [];
  let n = 0;
  for (const i of arr(idxs)) {
    const p = pts[i];
    if (!p || (ai === 3 && (i === 0 || i === pts.length - 1))) continue;
    const q = p.slice(0, 3).concat([p[3] || 0, p[4] || 0]), was = busNum(q[ai]);
    if (was && was !== bus && !cut.includes(was)) cut.push(was);
    q[ai] = bus;
    pts[i] = q;
    n++;
  }
  if (!n) return 0;
  if (src) core.addMod(s, fx, src, 'bus' + bus, { amt: 0.5, bi: 1 });
  pruneLost(s, cut);
  return n;
}
const busNum = v => (fin(v) && Math.round(v) >= 1 && Math.round(v) <= 16 ? Math.round(v) : 0);
// Menu items gathered by `group` (wk.menu starts a new group box whenever the group changes between neighbours):
// groups in the order of `order` (then of first appearance), items keep their relative order inside a group.
export function groupItems(items, order) {
  const rank = new Map();
  for (const g of arr(order)) if (!rank.has(g)) rank.set(g, rank.size);
  for (const it of arr(items)) { const g = it.group === undefined ? '' : it.group; if (!rank.has(g)) rank.set(g, rank.size); }
  const key = it => rank.get(it.group === undefined ? '' : it.group);
  return arr(items).map((it, i) => [it, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(x => x[0]);
}
// A sound nobody has edited yet: the default state apart from the view (ui) and the fields new tracks take from
// the preferences (global.os, author, global.mpe.on; §11 withPrefs). Used to apply the "Default WT view" preference.
export function isPristine(s) {
  if (!isObj(s) || typeof core.normalizeSerum !== 'function') return false;
  const strip = x => {
    const c = core.normalizeSerum(x);
    delete c.ui; c.global.os = 0; c.author = '';
    if (c.global.mpe) c.global.mpe.on = 0;
    return JSON.stringify(c);
  };
  try { return strip(s) === strip(core.defaultSerum()); } catch (err) { return false; }
}
// Layers of the 3D wavetable view (§9.3, §7.1) — sx-ui-osc's (the display moved there in M1a); kept as a serum-ui export
export function layers3d(F, R, max) { return osc.layers3d(F, R, max); }
// bus numbers (1–16) linked by the X or Y of any point of a graph
export function ptsBuses(pts) {
  const out = [];
  for (const p of arr(pts)) {
    if (!Array.isArray(p)) continue;
    for (const b of [busNum(p[3]), busNum(p[4])]) if (b && !out.includes(b)) out.push(b);
  }
  return out;
}
// In place: prunes the rows of the listed buses that no point links any more (never the sweep form, inv A13)
function pruneLost(s, buses) {
  if (buses && buses.length && typeof core.pruneBuses === 'function') core.pruneBuses(s, buses);
}

// LFO tiles shown (§9.3, §13.13, inv B16): min(10, max(6, highest LFO number used by any row as source or aux + 1)) —
// LFO 1–6 always, LFO 7–10 appear one by one once the LFO before them is used
export function lfoTileCount(s) {
  let hi = 0;
  for (const r of rowsOf(s)) if (r) hi = Math.max(hi, lfoNum(r.src), lfoNum(r.aux));
  return Math.min(N_LFO, Math.max(6, hi + 1));
}

// destinations of the rows whose source is src (slot order, as ids; rows without a destination skipped)
export function tileDests(s, src) {
  const out = [];
  for (const r of rowsOf(s)) if (r && r.src === src && r.dst) out.push(r.dst);
  return out;
}

// Tooltip lines of the modulators on a control (§9.4): `<src> <±amount%> <-> | ->`
export function modTipLines(s, destId) {
  return modRows(s, destId).map(({ row }) => srcLabel(s, row.src) + ' ' + sgn(row.amt) + Math.round(row.amt * 100) + '% '
    + (row.bi ? '<->' : '->') + (row.byp ? ' (bypassed)' : ''));
}

// Phase capture (§6.4, §6.21 item 6): the oscillators (A, B, C) whose unison start phases are captured (memSet ← the
// recent voice's relative phases, snapshot.memNow) by the change prev → next while notes sound:
//   S1 mode, OSC A / B: the Phase-1 knob-end rule — base PHASE at Mem (≥ 0.9995) while RAND crosses 0.9995 upwards;
//   S2 mode (every oscillator) and OSC C in both modes: no knob-end rule; phMem switching to 'voice' (Per Voice).
// prev / next = states ({p, osc[i].phMem, global.s1}), or plain s.p maps (then only the S1 knob-end rule of A / B).
export function captureDue(prev, next, notes) {
  const out = [];
  if (!(notes > 0)) return out;
  const st = x => (x && isObj(x.p) ? x : null), P = x => (st(x) ? x.p : x || {});
  const a = P(prev), b = P(next), A = st(prev), B = st(next), s1 = B ? s1On(B) : true;
  const mem = (x, o) => (x && Array.isArray(x.osc) && isObj(x.osc[o]) ? x.osc[o].phMem : undefined);
  OSC_P.forEach((k, o) => {
    if (o < 2 && s1) { if (b[k + '.phase'] >= 0.9995 && a[k + '.rand'] < 0.9995 && b[k + '.rand'] >= 0.9995) out.push(o); }
    else if (A && B && mem(B, o) === 'voice' && mem(A, o) !== 'voice') out.push(o);
  });
  return out;
}

// 16 unison start phases for "New MemTrig phase set" (seeded; 6 decimals like the defaults)
export function memTrigSet(seed) {
  const r = mulberry32(seed >>> 0);
  return Array.from({ length: 16 }, () => Math.round(r() * 1e6) / 1e6 % 1);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Module clipboard (module menus, §13.3, inv B2): a deep copy of the state the module was copied from, its module name
// and the "with mods" flag; pasting goes through serum-core copyModule (allowed pairs §11.1: any two oscillators,
// Filter ↔ Filter 2, any two envelopes, any two LFOs, every module with itself).
export function clipModule(s, m, mods) {
  if (!MODULE_FIELDS[m] || !isObj(s)) return null;
  return { kind: modKind(m), m, s: clone(s), mods: !!mods };
}
// In place; false when the clipboard does not fit module m (copyModule refuses the pair)
export function pasteModule(s, m, clip) {
  if (!MODULE_FIELDS[m] || !clip || !isObj(clip.s) || clip.kind !== modKind(m) || typeof core.copyModule !== 'function') return false;
  return core.copyModule(s, clip.s, m, clip.m, { mods: !!clip.mods });
}
// In place: module m back to defaultSerum()'s fields, its modulations removed (serum-core initModule)
export function initModule(s, m) {
  if (!MODULE_FIELDS[m]) return false;
  if (typeof core.initModule === 'function') return core.initModule(s, m);
  return typeof core.copyModule === 'function' ? core.copyModule(s, core.defaultSerum(), m) : false;
}

// LFO GRID text box: 'x' or 'x,y' (1–64) → {x, y} | null
export function parseGrid(text) {
  const m = /^\s*(\d{1,2})\s*(?:[,x×]\s*(\d{1,2})\s*)?$/i.exec(String(text));
  if (!m) return null;
  const x = +m[1], y = m[2] !== undefined ? +m[2] : x;
  return x >= 1 && x <= 64 && y >= 1 && y <= 64 ? { x, y } : null;
}

// Matrix AMOUNT typing (§9.5): '35', '-35 %', '0,5%' → amount ∈ [−1, 1]; '12st' / '-7 st' on semitone-linear
// destinations → semitoneAmount(dst, st, bi); anything else → null
export function parseAmount(text, dst, bi) {
  const t = String(text).trim().replace(',', '.').replace('−', '-');
  let m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:st|semi|semis|semitones?)$/i.exec(t);
  if (m) return typeof core.semitoneAmount === 'function' ? core.semitoneAmount(dst, +m[1], bi) : null;
  m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*%?$/.exec(t);
  return m ? clamp(+m[1] / 100, -1, 1) : null;
}

// Preferences (§9.7, §13.10), stored with host.storage under PREFS_KEY; app-wide, never in presets. Phase-1 set plus
// helpTips (help tooltips), keys (keyboard shortcuts), mpeDefault (MPE enabled by default), mpeBendX (MPE pitch bend
// also maps to Expr X), mpeYBi (MPE Expr Y bi-directional), midiFromPreset (Load MIDI Map from Presets, default on =
// Phase 1), ultra (Use Ultra quality when rendering).
export const PREFS_DEFAULT = Object.freeze({ tooltips: 1, helpTips: 1, dblClick: 'type', wheel: 1, keys: 1, view3d: 0, wheelWt: 0,
  limitDrop: 1, silenceTails: 1, defOs: 2, author: '', askPreset: 0, smooth: 1, mpeDefault: 0, mpeBendX: 0, mpeYBi: 0,
  midiFromPreset: 1, ultra: 0 });
export function normPrefs(p) {
  const o = isObj(p) ? p : {};
  const b = k => (o[k] === undefined || o[k] === null ? PREFS_DEFAULT[k] : o[k] ? 1 : 0);
  return {
    tooltips: b('tooltips'), helpTips: b('helpTips'), dblClick: o.dblClick === 'reset' ? 'reset' : 'type', wheel: b('wheel'),
    keys: b('keys'), view3d: b('view3d'), wheelWt: b('wheelWt'), limitDrop: b('limitDrop'), silenceTails: b('silenceTails'),
    defOs: o.defOs === 1 || o.defOs === 4 ? o.defOs : 2, author: typeof o.author === 'string' ? o.author.slice(0, 64) : '',
    askPreset: b('askPreset'), smooth: fin(o.smooth) ? clamp(Math.round(o.smooth * 100) / 100, 0.01, 8) : 1,
    mpeDefault: b('mpeDefault'), mpeBendX: b('mpeBendX'), mpeYBi: b('mpeYBi'), midiFromPreset: b('midiFromPreset'), ultra: b('ultra'),
  };
}

// Panel undo / redo (§13.2.4, deviation 16): a stack of state snapshots (strings) with the current one on top.
// push(snap, label, t) after every edit gesture: an identical snapshot is ignored; the same label within `coalesceMs`
// (600) of the previous push replaces the top entry (one step); otherwise a new entry (the redo branch is dropped).
// At most `limit` undo steps (+ the base) and `maxBytes` (16 MB, 2 bytes per character) — the oldest go first.
// base(snap) restarts the stack; undo() / redo() return the snapshot to restore (null at either end); top() is the
// current position's snapshot, retop(snap) replaces it without a new step.
export function undoStack(limit, opts) {
  const o = opts || {}, max = limit > 0 ? Math.floor(limit) : 100;
  const maxBytes = o.maxBytes > 0 ? o.maxBytes : 16 * 1024 * 1024, win = o.coalesceMs >= 0 ? o.coalesceMs : 600;
  let st = [], pos = -1, bytes = 0;
  const sz = x => 2 * x.length;
  const trim = () => {
    while (st.length > max + 1 || (bytes > maxBytes && st.length > 1)) { bytes -= sz(st[0].snap); st.shift(); pos--; }
    if (pos < 0) pos = st.length ? 0 : -1;
  };
  const U = {
    base(snap) { st = []; bytes = 0; pos = -1; if (typeof snap === 'string') { st.push({ snap, label: '', t: -1e15 }); bytes = sz(snap); pos = 0; } },
    push(snap, label, t) {
      if (typeof snap !== 'string') return false;
      const T = fin(t) ? t : nowMs(), L = label || '';
      if (pos >= 0 && st[pos].snap === snap) return false;
      while (st.length > pos + 1) bytes -= sz(st.pop().snap);
      const top = st[pos];
      if (top && pos > 0 && top.label === L && T - top.t <= win) { bytes += sz(snap) - sz(top.snap); top.snap = snap; top.t = T; }
      else { st.push({ snap, label: L, t: T }); bytes += sz(snap); pos = st.length - 1; }
      trim();
      return true;
    },
    undo() { if (pos <= 0) return null; pos--; st[pos].t = -1e15; return st[pos].snap; },
    redo() { if (pos >= st.length - 1) return null; pos++; st[pos].t = -1e15; return st[pos].snap; },
    canUndo: () => pos > 0, canRedo: () => pos >= 0 && pos < st.length - 1,
    label: () => (pos > 0 ? st[pos].label : ''), redoLabel: () => (pos >= 0 && pos < st.length - 1 ? st[pos + 1].label : ''),
    top: () => (pos >= 0 ? st[pos].snap : null),
    // the current position's snapshot replaced in place (no step; view-only changes outside s.ui / fx.ui)
    retop(snap) { if (pos < 0 || typeof snap !== 'string') return false; bytes += sz(snap) - sz(st[pos].snap); st[pos].snap = snap; trim(); return true; },
    clear() { st = []; pos = -1; bytes = 0; },
    size: () => st.length, steps: () => Math.max(0, pos), bytes: () => bytes,
  };
  return U;
}

// "S1 rendition differs" (§2.6.4, §13.10): labels of the S1 pairs whose v1 and S2 renditions differ (serum-core syncS1
// with a non-pair id writes nothing and returns the differing pairs)
export function s1Diff(s) {
  if (!isObj(s) || typeof core.syncS1 !== 'function') return [];
  const lab = id => { const q = arr(core.S1_PAIRS).find(x => x && x.id === id); return (q && q.label) || PAIR_LABEL[id] || id; };
  try { return arr(core.syncS1(s, '')).map(lab); } catch (err) { return []; }
}
// A matrix row aimed at the other mode's field of an S1 pair (shown with "≈", compiled with amt × range ratio, §2.6.4)
export function rowAlias(s, row) {
  if (!row || !row.dst) return false;
  return s1On(s) ? own(ALIAS_S2, row.dst) : own(ALIAS, row.dst);
}
// A matrix row whose destination does not resolve (deleted FX instance, unknown id) or is not modulatable (Convolve
// shaping parameters, deviation 20) — shown red (§13.6)
export function rowBad(fx, row) {
  if (!row || !row.dst) return false;
  if (destOf(row.dst) && !/^fx\./.test(row.dst)) return false;
  const r = rowOfDest(row.dst, fx);
  return !r || !!r.nomod;
}

/* ---------------------------------------------------------------- presets (§9.10, §13.11) */

const COLL = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : null;
const cmpStr = (a, b) => {
  const x = String(a == null ? '' : a), y = String(b == null ? '' : b);
  if (COLL) return COLL.compare(x, y);
  const p = x.toLowerCase(), q = y.toLowerCase();
  return p < q ? -1 : p > q ? 1 : 0;
};
const SORT_COLS = ['name', 'cat', 'author', 'stars'];
const PREVIEW_MS = 4000;   // host.preview plays a preset's preview for at most 4 s (§12.6)
const STAR_FILTERS = ['', 'any', 'none', 1, 2, 3, 4, 5];
export const BROWSER_DEFAULT = Object.freeze({ sort: 'name', sort2: 'cat', dir: 1, cat: '', q: '', tab: 'cats', tags: [], tagMode: 'all',
  excl: [], stars: '', autoPreview: 0 });
const tagList = x => arr(x).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 24)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 32);
export function normBrowser(b) {
  const o = isObj(b) ? b : {};
  return {
    sort: SORT_COLS.includes(o.sort) ? o.sort : 'name', sort2: SORT_COLS.includes(o.sort2) ? o.sort2 : 'cat',
    dir: o.dir === -1 || o.dir === 'desc' ? -1 : 1, cat: typeof o.cat === 'string' ? o.cat : '', q: typeof o.q === 'string' ? o.q : '',
    tab: o.tab === 'tags' ? 'tags' : 'cats', tags: tagList(o.tags), tagMode: o.tagMode === 'any' ? 'any' : 'all', excl: tagList(o.excl),
    stars: STAR_FILTERS.includes(o.stars) ? o.stars : '', autoPreview: o.autoPreview ? 1 : 0,
  };
}
// List rows with their metadata: stars / tags / comments of the row itself (user presets) overlaid by meta[key]
// (synth.sx.meta: {key: {stars, tags?, comments?}}) — new objects, the inputs untouched
export function withMeta(list, meta) {
  const M = isObj(meta) ? meta : {};
  return arr(list).map(p => {
    const m = p && isObj(M[p.key]) ? M[p.key] : null, q = Object.assign({}, p);
    if (m) for (const k of ['stars', 'tags', 'comments']) if (m[k] !== undefined) q[k] = m[k];
    q.stars = fin(q.stars) ? clamp(Math.round(q.stars), 0, 5) : 0;
    q.tags = tagList(q.tags);
    return q;
  });
}
// Sorted copy: primary column `sort` in direction `dir` (1 | −1 | 'asc' | 'desc'); ties fall back to the
// previously clicked column `sort2`, then Name, then key (stable). 'stars' sorts numerically.
export function sortPresets(list, opts) {
  const o = opts || {}, k1 = SORT_COLS.includes(o.sort) ? o.sort : 'name', k2 = SORT_COLS.includes(o.sort2) ? o.sort2 : null;
  const dir = o.dir === -1 || o.dir === 'desc' ? -1 : 1;
  const cmp = (k, a, b) => (k === 'stars' ? (a.stars || 0) - (b.stars || 0) : cmpStr(a[k], b[k]));
  return arr(list).map((p, i) => ({ p, i })).sort((a, b) => (cmp(k1, a.p, b.p) * dir)
    || (k2 && k2 !== k1 ? cmp(k2, a.p, b.p) : 0) || cmpStr(a.p.name, b.p.name)
    || cmpStr(a.p.key, b.p.key) || a.i - b.i).map(x => x.p);
}
// Filters (§13.11): category ('' = All), search (name / author substring, case-insensitive), tags (all | any of
// o.tags; o.excl excluded), ratings (o.stars: '' off · 'any' rated · 'none' unrated · 1–5 exact)
export function filterPresets(list, opts) {
  const o = opts || {}, cat = o.cat || '', q = String(o.q || '').trim().toLowerCase();
  const tags = tagList(o.tags), excl = tagList(o.excl), any = o.tagMode === 'any', st = o.stars;
  return arr(list).filter(p => {
    if (!p || (cat && p.cat !== cat)) return false;
    if (q && !String(p.name || '').toLowerCase().includes(q) && !String(p.author || '').toLowerCase().includes(q)) return false;
    const pt = arr(p.tags);
    if (tags.length && !(any ? tags.some(t => pt.includes(t)) : tags.every(t => pt.includes(t)))) return false;
    if (excl.length && excl.some(t => pt.includes(t))) return false;
    const n = fin(p.stars) ? p.stars : 0;
    if (st === 'any' && !(n > 0)) return false;
    if (st === 'none' && n > 0) return false;
    if (fin(st) && n !== st) return false;
    return true;
  });
}
// The browser's list (filtered, then sorted) — also what MIDI program change indexes (§9.10, §11.8)
export function browserList(list, st) { const b = normBrowser(st); return sortPresets(filterPresets(list, b), b); }
// Categories present, alphabetical
export function presetCats(list) {
  const set = new Set();
  for (const p of arr(list)) if (p && p.cat) set.add(p.cat);
  return Array.from(set).sort(cmpStr);
}
// Tags present, alphabetical
export function presetTags(list) {
  const set = new Set();
  for (const p of arr(list)) for (const t of tagList(p && p.tags)) set.add(t);
  return Array.from(set).sort(cmpStr);
}
// ◀ ▶ (§9.10): previous / next key of `list` (already sorted) within category `cat` (null/undefined = whole
// list), wrapping. A key not in that list → its first (dir > 0) or last entry. Empty → null.
export function stepPreset(list, key, dir, cat) {
  const L = arr(list).filter(p => p && (cat === null || cat === undefined || p.cat === cat));
  if (!L.length) return null;
  const i = L.findIndex(p => p.key === key), d = dir < 0 ? -1 : 1;
  if (i < 0) return (d > 0 ? L[0] : L[L.length - 1]).key;
  return L[(i + d + L.length) % L.length].key;
}
// Hybridize parents (§13.11, inv B25): up to n (4) distinct keys of `list` drawn with mulberry32(seed); with `favor`
// (a key of the list) that key comes first (index 0 = the favoured parent of serum-core hybridize). Deterministic.
export function hybridPick(list, seed, n, favor) {
  const L = arr(list).map(p => p && p.key).filter(k => k !== undefined && k !== null);
  const N = Math.min(n > 0 ? n : 4, L.length), r = mulberry32(seed >>> 0), out = [];
  if (favor !== undefined && favor !== null && L.includes(favor)) out.push(favor);
  const pool = L.filter(k => !out.includes(k));
  while (out.length < N && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

/* ================================================================ CSS (§9.1, §9.2, §13.1, §13.2; tokens on .sx-root) */

const CSS = `
.sx-root { container: sx / inline-size; position: relative; box-sizing: border-box; min-width: 0;
  --sx-bg: #0f1216; --sx-panel: #161b21; --sx-panel2: #1c232b; --sx-line: #2a333d; --sx-ink: #dfe6ee; --sx-mute: #7f8b98;
  --sx-accent: #4fb3ff; --sx-neg: #ffb347; --sx-on: #6fe3a1; --sx-warn: #ff6a4a; --sx-graph: #59c2ff;
  --sx-osc-a: #4fb3ff; --sx-osc-b: #6fe3a1; --sx-osc-c: #f7c948; --sx-sub: #a78bfa; --sx-noise: #94a3b8; --sx-f1: #ff8a5b;
  --sx-f2: #ff5b8a; --sx-bus1: #c084fc; --sx-bus2: #f472b6; --sx-arp: #b07cff; --sx-clip: #3ddc84;
  padding: 8px; color: var(--sx-ink); background: var(--sx-bg); border-radius: 10px; font: 500 12px/1.3 var(--ui, system-ui, sans-serif);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 20px 50px -24px rgba(0, 0, 0, 0.8); touch-action: manipulation; }
.sx-root *, .pb-root * { box-sizing: border-box; }
.sx-root button { font: inherit; color: inherit; }
.sx-hidden { display: none !important; }
.sx-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 2px 4px 8px; border-bottom: 1px solid var(--sx-line); }
.sx-logo { flex: 0 0 auto; width: 30px; height: 30px; color: var(--sx-accent); }
.sx-wave { color: var(--sx-graph); opacity: 0.55; }
.sx-head:hover .sx-wave, .sx-wave:focus-visible, .sx-touch .sx-wave { opacity: 1; }
.sx-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 7px; }
.sx-tab { min-height: 26px; padding: 3px 9px; color: var(--sx-mute); background: none; border: 0; border-radius: 5px; font-weight: 700; font-size: 11px; letter-spacing: 0.08em; cursor: pointer; }
.sx-tab:hover { color: var(--sx-ink); }
.sx-tab[aria-selected="true"] { color: var(--sx-bg); background: var(--sx-accent); }
.sx-tab[data-page="arp"][aria-selected="true"] { background: var(--sx-arp); }
.sx-tab[data-page="clip"][aria-selected="true"] { background: var(--sx-clip); }
.sx-tab:focus-visible, .sx-hbtn:focus-visible, .sx-tile:focus-visible, .sx-tname:focus-visible, .sx-btn:focus-visible { outline: 2px solid var(--sx-accent); outline-offset: 1px; }
.sx-preset { flex: 1 1 260px; display: flex; align-items: center; gap: 3px; min-width: 0; }
.sx-hbtn, .sx-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 26px; min-width: 26px; padding: 2px 8px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 5px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.sx-hbtn:hover, .sx-btn:hover { border-color: var(--sx-mute); }
.sx-hbtn:disabled, .sx-btn:disabled { opacity: 0.4; cursor: default; }
.sx-hbtn svg, .sx-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.sx-hbtn.sx-on, .sx-btn.sx-on { color: var(--sx-accent); border-color: var(--sx-accent); }
.sx-pname { flex: 1 1 auto; min-width: 0; justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.sx-pname .sx-pcat { color: var(--sx-mute); font-weight: 500; margin-right: 6px; }
.sx-dirty::after { content: ' *'; color: var(--sx-neg); }
.sx-undo { display: inline-flex; gap: 2px; }
.sx-mkeys { display: none; }
.sx-touch .sx-mkeys { display: inline-flex; }
.sx-vc { min-width: 64px; color: var(--sx-mute); font: 500 11px/1 var(--mono, ui-monospace, monospace); text-align: right; }
.sx-vc b { color: var(--sx-ink); font-weight: 600; }
.sx-master { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.sx-master .wk-meter { width: 10px; height: 40px; }
.sx-status { min-height: 0; padding: 0 6px; color: var(--sx-mute); font: 500 11px/1.6 var(--mono, ui-monospace, monospace); white-space: pre-line; }
.sx-status:empty { display: none; }
.sx-pages { position: relative; min-width: 0; }
.sx-page { display: grid; gap: 8px; padding-top: 8px; min-width: 0; }
.sx-row { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
.sx-col { display: grid; gap: 8px; align-content: start; min-width: 0; }
/* OSC row A: [SUB over NOISE] [OSC A] [OSC B] [OSC C] [FILTER 1 over FILTER 2] (§13.2 breakpoints) */
.sx-colO { display: grid; gap: 8px; align-content: start; min-width: 0; }
.sx-ptabs { display: flex; gap: 2px; padding: 2px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 7px; }
.sx-ptab { flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 2px 8px; color: var(--sx-mute); background: none; border: 0; border-radius: 5px; font-weight: 700; font-size: 11px; letter-spacing: 0.08em; cursor: pointer; }
.sx-ptab[aria-selected="true"] { color: var(--sx-ink); background: var(--sx-panel2); box-shadow: inset 0 -2px 0 var(--sx-dot, var(--sx-accent)); }
.sx-ptab .sx-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sx-dot, var(--sx-accent)); opacity: 0.35; }
.sx-ptab.sx-pon .sx-dot { opacity: 1; box-shadow: 0 0 6px var(--sx-dot, var(--sx-accent)); }
.sx-opan[data-o="0"], .sx-ptab[data-o="0"] { --sx-dot: var(--sx-osc-a); }
.sx-opan[data-o="1"], .sx-ptab[data-o="1"] { --sx-dot: var(--sx-osc-b); }
.sx-opan[data-o="2"], .sx-ptab[data-o="2"] { --sx-dot: var(--sx-osc-c); }
.sx-fpan[data-f="0"], .sx-ptab[data-f="0"] { --sx-dot: var(--sx-f1); }
.sx-fpan[data-f="1"], .sx-ptab[data-f="1"] { --sx-dot: var(--sx-f2); }
.sx-opan, .sx-fpan { border-top: 2px solid var(--sx-dot, var(--sx-line)); }
.sx-opan.sx-osel { box-shadow: 0 0 0 1px var(--sx-dot, var(--sx-accent)); }
/* one oscillator / one filter at a time only below the widths that show them all: the hide rules (specificity 0,5,0)
   live inside max-width queries, so no wide-layout rule has to out-rank them (container queries add no specificity).
   C1: a folded (off) panel is never hidden behind a tab: it shows as its bar, the tabs choose among the expanded ones */
@container sx (max-width: 1099px) {
  .sx-colO[data-tab="0"] > .sx-opan:not([data-o="0"]):not(.sx-coll), .sx-colO[data-tab="1"] > .sx-opan:not([data-o="1"]):not(.sx-coll), .sx-colO[data-tab="2"] > .sx-opan:not([data-o="2"]):not(.sx-coll) { display: none; }
}
@container sx (max-width: 1365px) {
  .sx-colF[data-tab="0"] > .sx-fpan:not([data-f="0"]):not(.sx-coll), .sx-colF[data-tab="1"] > .sx-fpan:not([data-f="1"]):not(.sx-coll) { display: none; }
}
/* C1: a column whose panels are all folded (row A data-rail-sn / -o / -f = "1") shrinks to vertical rails from 768 px;
   with every panel on, the var() fallbacks are the plain templates. start: auto tracks never stretch */
.sx-rowA { justify-content: start; }
@container sx (min-width: 768px) {
  .sx-rowA { grid-template-columns: var(--sx-tsn, minmax(0, 0.8fr)) var(--sx-to, minmax(0, 1.5fr)) var(--sx-tf, minmax(0, 1fr)); }
  .sx-rowC { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sx-rowA[data-rail-sn="1"] { --sx-tsn: auto; }
  .sx-rowA[data-rail-o="1"] { --sx-to: auto; }
  .sx-rowA[data-rail-f="1"] { --sx-tf: auto; }
  .sx-rowA[data-rail-sn="1"] > .sx-colSN, .sx-rowA[data-rail-o="1"] > .sx-colO, .sx-rowA[data-rail-f="1"] > .sx-colF { grid-auto-rows: minmax(0, 1fr); align-content: stretch; }
  .sx-rowA[data-rail-o="1"] > .sx-colO { grid-auto-flow: column; }
  .sx-rowA[data-rail-sn="1"] > .sx-colSN > .sx-coll, .sx-rowA[data-rail-o="1"] > .sx-colO > .sx-coll, .sx-rowA[data-rail-f="1"] > .sx-colF > .sx-coll { --sx-cfd: column; --sx-cwm: vertical-rl; --sx-cpm: 0; --sx-crot: -90deg; --sx-ctr: rotate(180deg); }
}
@container sx (min-width: 1100px) {
  .sx-rowA { grid-template-columns: var(--sx-tsn, minmax(0, 0.75fr)) var(--sx-to, minmax(0, 3.6fr)) var(--sx-tf, minmax(0, 1fr)); }
  .sx-rowC { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 1.5fr) minmax(0, 0.8fr); }
  /* the three oscillators side by side; wrap so align-content: start keeps the row at its content height (as the grid
     did); an off oscillator is a rail and the on ones share the width */
  .sx-colO { display: flex; flex-wrap: wrap; }
  .sx-colO > .sx-opan { flex: 1 1 0; }
  .sx-colO > .sx-opan.sx-coll { flex: 0 0 auto; --sx-cfd: column; --sx-cwm: vertical-rl; --sx-cpm: 0; --sx-crot: -90deg; --sx-ctr: rotate(180deg); }
  .sx-colO > .sx-ptabs { display: none; }
  .sx-root .sx-colO .wk-md, .sx-root .sx-colO .wk-lg { --wk-d: 30px; }
}
@container sx (min-width: 1366px) {
  .sx-colF > .sx-ptabs { display: none; }
  .sx-root .sx-colO .wk-md, .sx-root .sx-colO .wk-lg { --wk-d: revert; }
}
.sx-panel { position: relative; min-width: 0; padding: 6px 8px 8px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 8px; }
.sx-ptitle { display: flex; align-items: center; gap: 6px; min-height: 26px; margin-bottom: 4px; }
.sx-tname { color: var(--sx-ink); font-weight: 800; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; cursor: context-menu; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; border-radius: 3px; touch-action: none; }
.sx-ptitle .sx-grow, .sx-grow { flex: 1 1 auto; min-width: 0; }
.sx-ptitle .wk-menu > .wk-lab { display: none !important; }
.sx-lockmark { display: none; width: 12px; height: 12px; color: var(--sx-neg); }
.sx-locked > .sx-ptitle .sx-lockmark { display: inline-block; }
.sx-off > .sx-pbody { opacity: 0.45; }
/* C1: a folded (off) module: its title row only — power, title, lock mark, chevron — as a bar, or as a vertical rail
   where the rail variables are set (above; its title reads bottom to top, as the MIX page's off strips); instant (the
   chevron turns, reduced motion stops that too) */
.sx-panel.sx-coll { padding: 4px 6px; }
.sx-coll > .sx-pbody { display: none; }
.sx-panel.sx-coll > .sx-ptitle { margin-bottom: 0; flex-direction: var(--sx-cfd, row); flex-wrap: nowrap; }
.sx-coll > .sx-ptitle > :not(.wk-power):not(.sx-tname):not(.sx-lockmark):not(.sx-peek) { display: none !important; }
.sx-coll > .sx-ptitle > .sx-tname { writing-mode: var(--sx-cwm, horizontal-tb); transform: var(--sx-ctr, none); white-space: nowrap; }
.sx-peek { padding: 2px 4px; }
.sx-coll > .sx-ptitle > .sx-peek { margin: var(--sx-cpm, 0 0 0 auto); }
.sx-peek svg { transform: rotate(var(--sx-crot, 0deg)); transition: transform 0.15s; }
.sx-peek[aria-expanded="true"] svg { transform: rotate(180deg); }
.sx-pbody { display: grid; gap: 6px; min-width: 0; }
.sx-krow { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px 6px; min-width: 0; }
.sx-krow.sx-sp { justify-content: space-between; }
.sx-krow .wk-menu { flex: 1 1 120px; min-width: 0; }
.sx-disp { display: block; width: 100%; height: 120px; background: #0a0d10; border: 1px solid var(--sx-line); border-radius: 6px; cursor: pointer; touch-action: none; }
.sx-disp.sx-tall { height: 150px; }
.sx-disp.sx-short { height: 64px; }
.sx-disp.sx-dropok { border-color: var(--sx-accent); box-shadow: 0 0 0 2px var(--sx-accent) inset; }
.sx-ico { display: inline-flex; width: 26px; height: 22px; align-items: center; justify-content: center; color: var(--sx-graph); }
.sx-ico svg { width: 22px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
.sx-route { display: flex; gap: 2px; }
.sx-route .wk-tog { min-width: 24px; padding: 2px 5px; }
.sx-locked-ctl { position: relative; }
.sx-locked-ctl::after { content: ''; position: absolute; right: 0; top: 0; width: 6px; height: 6px; border-radius: 1px; background: var(--sx-neg); box-shadow: 0 0 0 1px var(--sx-bg); pointer-events: none; }
.sx-tiles { display: flex; gap: 4px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: thin; touch-action: pan-x; scroll-snap-type: x proximity; }
.sx-tile { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 10px; color: var(--sx-mute); background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 6px; font-weight: 700; font-size: 11px; letter-spacing: 0.06em; cursor: grab; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; scroll-snap-align: start; }
.sx-tile:hover { color: var(--sx-ink); }
.sx-tile[aria-pressed="true"] { color: var(--sx-ink); border-color: var(--sx-accent); box-shadow: 0 0 0 1px var(--sx-accent) inset; }
.sx-tile.wk-armed { border-color: var(--sx-neg); }
.sx-tile .sx-badge { min-width: 16px; padding: 1px 4px; color: var(--sx-bg); background: var(--sx-mute); border-radius: 8px; font: 700 9px/1.2 var(--mono, ui-monospace, monospace); text-align: center; }
.sx-tile[aria-pressed="true"] .sx-badge { background: var(--sx-accent); }
.sx-tile .sx-badge:empty { display: none; }
.sx-tile.sx-mtile { max-width: 128px; text-transform: none; letter-spacing: 0; font-weight: 600; }
.sx-tile.sx-mtile .sx-tl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-ghost { position: fixed; z-index: 1100; left: 0; top: 0; padding: 3px 8px; color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); border-radius: 5px; font: 700 11px/1.2 var(--ui, system-ui, sans-serif); pointer-events: none; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5); }
.sx-ghost.sx-ghost-touch { max-width: min(360px, calc(100vw - 16px)); padding: 6px 10px; font-size: 13px; text-align: center; overflow-wrap: anywhere; }
.sx-dragging, .sx-dragging * { cursor: grabbing !important; }
.sx-dragging.sx-candrop, .sx-dragging.sx-candrop * { cursor: copy !important; }
.sx-droptgt { outline: 2px solid var(--sx-accent) !important; outline-offset: 2px; border-radius: 6px; }
.sx-macros { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.sx-macro { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 6px; min-width: 0; }
.sx-macro .sx-tile { width: 100%; justify-content: center; min-height: 24px; padding: 2px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0; font-weight: 600; touch-action: pan-y; touch-action: pan-y pinch-zoom; }
.sx-macro input { width: 100%; padding: 2px 4px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-accent); border-radius: 4px; font: 600 11px var(--ui, system-ui, sans-serif); }
.sx-macro .wk-knob { --wk-d: 30px; }
.sx-edbox { position: relative; min-height: 120px; }
.sx-edhead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-bottom: 4px; }
.sx-edhead .sx-ttl, .sx-ttl { font-weight: 800; font-size: 11px; letter-spacing: 0.1em; }
.sx-etabs { display: inline-flex; gap: 2px; }
.sx-etabs button { min-height: 24px; padding: 2px 7px; color: var(--sx-mute); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 4px; font: 700 10px var(--ui, system-ui, sans-serif); cursor: pointer; }
.sx-etabs button[aria-selected="true"] { color: var(--sx-bg); background: var(--sx-accent); border-color: var(--sx-accent); }
.sx-zoom { width: 90px; accent-color: var(--sx-accent); }
.sx-grid { width: 52px; padding: 3px 5px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 4px; font: 500 11px var(--mono, ui-monospace, monospace); text-align: center; }
.sx-grid.sx-bad { border-color: var(--sx-warn); }
.sx-nf { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; }
.sx-nf .sx-nfl { color: var(--sx-mute); font-size: 9px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }
.sx-nfv { display: block; min-width: 44px; padding: 3px 6px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 4px; font: 600 11px/1.2 var(--mono, ui-monospace, monospace); text-align: center; cursor: ns-resize; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
.sx-nfv:focus-visible { border-color: var(--sx-accent); }
.sx-nf.sx-dis { opacity: 0.4; }
.sx-nf input { width: 64px; padding: 3px 4px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-accent); border-radius: 4px; font: 600 11px var(--mono, ui-monospace, monospace); text-align: center; }
.sx-amber .wk-num, .sx-amber .sx-nfv, .sx-amber .wk-nbv { color: var(--sx-neg) !important; }
.sx-txt { color: var(--sx-mute); font-size: 11px; }
.sx-note { color: var(--sx-neg); font-size: 11px; }
.sx-pop { position: absolute; z-index: 40; width: min(440px, calc(100% - 16px)); max-height: calc(100% - 16px); overflow: auto; padding: 8px; background: var(--sx-panel); border: 1px solid var(--sx-accent); border-radius: 8px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6); }
.sx-ov { position: absolute; inset: 0; z-index: 60; display: flex; flex-direction: column; background: rgba(9, 11, 14, 0.97); border-radius: 10px; overflow: auto; }
/* the panel's top-layer twin on the canvas (SPEC-canvas §4.7): its popovers and overlays at screen size, over everything */
.sx-root.sx-layer, .cv-ov > .sx-root.sx-layer { position: fixed; inset: 0; z-index: 0; padding: 0; background: none; border-radius: 0; box-shadow: none; pointer-events: none; overflow: visible; }
.sx-layer > * { pointer-events: auto; }
.sx-layer > .sx-ov { position: fixed; border-radius: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
.sx-layer > .sx-pop { position: fixed; max-height: calc(100dvh - 16px); }
/* overlays fill the screen below 1100 px (§13.2): at least one viewport tall, scrolled to the top of the screen when opened */
@container sx (max-width: 1099px) {
  .sx-ov { border-radius: 0; min-height: 100vh; min-height: 100dvh; }
  .sx-pop { left: 8px !important; width: calc(100% - 16px); }   /* small panes (routing, window …) span the panel */
  /* editor popovers (curve editors, PZ, OSC MAPPING …) are full-screen sheets like the overlays (§13.2 Overlays) */
  .sx-pop.sx-pop-ed { inset: 0; left: 0 !important; top: 0 !important; width: auto; max-height: none; min-height: 100vh; min-height: 100dvh; z-index: 60; border: 0; border-radius: 0; box-shadow: none; }
}
.sx-dlg-ov { align-items: center; justify-content: center; padding: 16px; background: rgba(9, 11, 14, 0.8); }
.sx-dlg { width: min(440px, 100%); max-height: 100%; overflow: auto; padding: 14px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 10px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); }
.sx-dlg h3 { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.04em; }
.sx-dlg label { display: grid; gap: 3px; margin-bottom: 10px; color: var(--sx-mute); font-size: 11px; }
.sx-dlg input, .sx-dlg textarea, .sx-gl input[type="text"], .sx-gl textarea, .pb-meta input, .pb-meta textarea { width: 100%; padding: 6px 8px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-line); border-radius: 5px; font: 500 12px var(--ui, system-ui, sans-serif); }
.sx-dlg textarea, .sx-gl textarea { min-height: 90px; resize: vertical; }
.sx-dlg input:focus, .sx-dlg textarea:focus, .sx-gl input:focus, .sx-gl textarea:focus { outline: none; border-color: var(--sx-accent); }
.sx-dlg p { margin: 0 0 10px; color: var(--sx-mute); line-height: 1.5; }
.sx-dbtns { display: flex; justify-content: flex-end; gap: 6px; }
.sx-btn.sx-pri { color: var(--sx-bg); background: var(--sx-accent); border-color: var(--sx-accent); font-weight: 700; }
.sx-wte { flex: 1 1 auto; min-height: 0; }
.sx-fxbox, .sx-mixbox, .sx-seqbox { min-width: 0; }
.sx-placeholder { padding: 16px; color: var(--sx-mute); text-align: center; border: 1px dashed var(--sx-line); border-radius: 8px; }
.sx-pagebar { display: flex; align-items: center; gap: 6px; }
/* keyboard panel under every page (its own styles: sx-ui-seq) */
.sx-foot { margin-top: 8px; min-width: 0; }
/* MATRIX (§13.6): 64 rows */
.sx-mxhead { display: flex; align-items: center; gap: 8px; }
.sx-mx { display: grid; gap: 3px; max-height: 620px; overflow: auto; padding-right: 2px; }
.sx-mxexp .sx-mx { max-height: none; }
.sx-mrow, .sx-mhd { display: grid; align-items: center; gap: 4px; min-width: 0;
  grid-template-columns: 18px 22px minmax(0, 1.1fr) var(--sx-crvw, 38px) minmax(84px, 1.3fr) 32px minmax(0, 1.5fr) 36px minmax(0, 1fr) 34px var(--sx-crvw, 38px) minmax(64px, 0.8fr) 26px 24px;
  grid-template-areas: 'h n src crv amt pol dst mo aux inv acrv out byp x'; }
.sx-mhd { position: sticky; top: 0; z-index: 1; padding: 2px 0 4px; color: var(--sx-mute); background: var(--sx-panel); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; }
.sx-mrow { padding: 2px 3px; background: var(--sx-panel2); border: 1px solid transparent; border-radius: 5px; }
.sx-mrow.sx-dim > :not(.sx-mn):not(.sx-mh):not(.sx-mx-x) { opacity: 0.45; }
.sx-mrow.sx-bad { border-color: var(--sx-warn); }
.sx-mrow.sx-bad .sx-mdst .wk-mbtn { color: var(--sx-warn); }
.sx-mrow.sx-dropline { box-shadow: 0 -2px 0 var(--sx-cur, #ffd84a); }
.sx-mrow > * { min-width: 0; }
.sx-mrow .wk-menu { width: 100%; }
.sx-mrow .wk-menu > .wk-lab, .sx-mrow .wk-sl > .wk-lab, .sx-mbyp .wk-tl { display: none !important; }
.sx-mrow .wk-sl { flex: 1 1 auto; min-width: 0; }
.sx-mh { grid-area: h; display: inline-flex; align-items: center; justify-content: center; min-height: 22px; color: var(--sx-mute); background: none; border: 0; cursor: grab; touch-action: none; font-size: 12px; }
.sx-mn { grid-area: n; color: var(--sx-mute); font: 600 10px var(--mono, ui-monospace, monospace); text-align: right; }
.sx-msrc { grid-area: src; } .sx-mcrv { grid-area: crv; } .sx-mamt { grid-area: amt; } .sx-mpol { grid-area: pol; } .sx-mdst { grid-area: dst; position: relative; }
.sx-mo { grid-area: mo; } .sx-maux { grid-area: aux; } .sx-minv { grid-area: inv; } .sx-macrv { grid-area: acrv; } .sx-mout { grid-area: out; }
.sx-mbyp { grid-area: byp; } .sx-mx-x { grid-area: x; }
.sx-alias { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); color: var(--sx-neg); font-weight: 800; pointer-events: none; }
.sx-mamt, .sx-mout { display: flex; align-items: center; gap: 3px; }
.sx-mamt > :first-child, .sx-mout > :first-child { flex: 1 1 auto; min-width: 0; }
.sx-mval { min-width: 38px; padding: 1px 2px; color: var(--sx-ink); font: 600 10px var(--mono, ui-monospace, monospace); text-align: right; cursor: text; border-radius: 3px; }
.sx-mval:focus-visible { outline: 1px solid var(--sx-accent); }
.sx-mval input { width: 52px; padding: 1px 3px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-accent); border-radius: 3px; font: 600 10px var(--mono, ui-monospace, monospace); }
.sx-crv { display: block; width: 36px; height: 22px; background: var(--sx-bg); border: 1px solid var(--sx-line); border-radius: 4px; cursor: ns-resize; touch-action: none; }
.sx-crv path { fill: none; stroke: var(--sx-graph); stroke-width: 1.6; }
.sx-crv.sx-edc path { stroke: var(--sx-cur, #ffd84a); }
.sx-crv.sx-grey path { stroke: var(--sx-mute); }
.sx-crv:focus-visible { outline: 2px solid var(--sx-accent); }
.sx-mout-g { display: block; width: 34px; height: 18px; background: var(--sx-bg); border: 1px solid var(--sx-line); border-radius: 3px; position: relative; overflow: hidden; }
.sx-mout-g i { position: absolute; top: 2px; bottom: 2px; background: var(--sx-graph); border-radius: 1px; }
.sx-mrow .sx-btn { width: 100%; min-height: 24px; padding: 1px 4px; font: 600 10px var(--mono, ui-monospace, monospace); }
.sx-mrow .sx-btn.sx-on { color: var(--sx-accent); border-color: var(--sx-accent); }
.sx-mslot.sx-droptgt { outline-offset: 0; }
@container sx (max-width: 899px) {
  .sx-mhd { display: none; }
  .sx-mrow { grid-template-columns: 18px 22px minmax(0, 1fr) var(--sx-crvw, 38px) 32px minmax(0, 1fr) 24px;
    grid-template-areas: 'h n src crv pol dst x' 'byp amt amt amt mo aux aux' 'byp out out acrv inv aux aux'; padding: 5px; }
  .sx-mn { align-self: start; }
  .sx-root .wk-md, .sx-root .wk-lg { --wk-d: 28px; }
}
/* GLOBAL (§13.10) */
.sx-gl { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); }
.sx-gl .sx-panel { display: grid; gap: 8px; align-content: start; }
.sx-pref { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px solid rgba(42, 51, 61, 0.5); }
.sx-pref > span { color: var(--sx-mute); font-size: 11px; }
.sx-pref .wk-tog { text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 11px; background: none; border-color: transparent; padding-left: 0; }
.sx-pref .wk-tog.wk-dis { opacity: 0.5; }
.sx-seg { display: inline-flex; border: 1px solid var(--sx-line); border-radius: 5px; overflow: hidden; }
.sx-seg button { min-height: 24px; padding: 2px 8px; color: var(--sx-mute); background: var(--sx-panel2); border: 0; border-right: 1px solid var(--sx-line); font-size: 11px; cursor: pointer; }
.sx-seg button:last-child { border-right: 0; }
.sx-seg button[aria-checked="true"] { color: var(--sx-bg); background: var(--sx-accent); }
.sx-seg button:disabled { opacity: 0.5; cursor: default; }
.sx-rate { color: var(--sx-mute); font: 500 11px var(--mono, ui-monospace, monospace); }
.sx-tagbox { display: flex; flex-wrap: wrap; gap: 4px; }
.sx-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 22px; padding: 1px 8px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 11px; font-size: 11px; cursor: pointer; }
.sx-chip[aria-pressed="true"] { color: var(--sx-bg); background: var(--sx-accent); border-color: var(--sx-accent); }
.sx-chip.sx-excl { color: var(--sx-warn); border-color: var(--sx-warn); text-decoration: line-through; }
.sx-vcgrid .wk-sg { width: 100%; }
.sx-notice { position: absolute; left: 50%; bottom: 10px; z-index: 70; max-width: 80%; padding: 6px 12px; color: var(--sx-bg); background: var(--sx-ink); border-radius: 6px; font-weight: 600; transform: translateX(-50%); pointer-events: none; }
/* preset browser v2 (§13.11) */
.pb-root { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 320px; padding: 12px; }
.pb-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pb-bar .wk-menu { min-width: 150px; }
.pb-q { flex: 1 1 160px; min-width: 0; padding: 5px 8px; color: var(--sx-ink, #dfe6ee); background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; font: inherit; }
.pb-q:focus { outline: none; border-color: var(--sx-accent, #4fb3ff); }
.pb-main { flex: 1 1 auto; min-height: 0; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
@container sx (min-width: 900px) { .pb-main { grid-template-columns: minmax(0, 1fr) 260px; } }
.pb-tbl { min-height: 0; overflow: auto; border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; }
.pb-hd, .pb-row { display: grid; grid-template-columns: 30px minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 84px 30px; align-items: center; gap: 6px; padding: 0 6px; }
.pb-hd { position: sticky; top: 0; z-index: 1; background: var(--sx-panel, #161b21); border-bottom: 1px solid var(--sx-line, #2a333d); }
.pb-hd button { padding: 6px 2px; color: var(--sx-mute, #7f8b98); background: none; border: 0; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-align: left; text-transform: uppercase; cursor: pointer; }
.pb-hd button[aria-sort="ascending"]::after { content: ' ▲'; } .pb-hd button[aria-sort="descending"]::after { content: ' ▼'; }
.pb-hd button[aria-sort]:not([aria-sort="none"]) { color: var(--sx-ink, #dfe6ee); }
.pb-list { outline: none; }
.pb-row { min-height: 28px; border-bottom: 1px solid rgba(42, 51, 61, 0.45); cursor: pointer; }
.pb-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-row:hover { background: var(--sx-panel2, #1c232b); }
.pb-row[aria-selected="true"] { background: rgba(79, 179, 255, 0.18); box-shadow: inset 2px 0 0 var(--sx-accent, #4fb3ff); }
.pb-row .pb-u { margin-left: 6px; padding: 0 4px; color: var(--sx-bg, #0f1216); background: var(--sx-on, #6fe3a1); border-radius: 3px; font-size: 9px; font-weight: 800; }
.pb-row .pb-more, .pb-play { padding: 2px; color: var(--sx-mute, #7f8b98); background: none; border: 0; cursor: pointer; }
.pb-play.sx-on { color: var(--sx-on, #6fe3a1); }
.pb-stars { display: inline-flex; gap: 1px; }
.pb-stars button { padding: 0 1px; color: var(--sx-line, #2a333d); background: none; border: 0; font-size: 13px; line-height: 1; cursor: pointer; }
.pb-stars button.sx-on { color: var(--sx-cur, #ffd84a); }
.pb-empty { padding: 20px; color: var(--sx-mute, #7f8b98); text-align: center; }
.pb-meta { display: grid; gap: 6px; align-content: start; min-height: 0; overflow: auto; padding: 8px; background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; }
.pb-meta label { display: grid; gap: 2px; color: var(--sx-mute, #7f8b98); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
.pb-meta .pb-v { color: var(--sx-ink, #dfe6ee); font-size: 12px; text-transform: none; letter-spacing: 0; }
.pb-macros { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 4px 8px; background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; }
.pb-macros .wk-knob { --wk-d: 28px; }
.pb-tabs { display: inline-flex; gap: 2px; }
.pb-tabs button { min-height: 26px; padding: 2px 10px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; cursor: pointer; }
.pb-tabs button[aria-selected="true"] { color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); border-color: var(--sx-accent, #4fb3ff); }
/* touch first-class (§13.1): ≥ 44 px targets, no double-tap zoom, no hover-only information */
@media (pointer: coarse) {
  .sx-tab, .sx-hbtn, .sx-btn, .sx-tile, .sx-nfv, .sx-ptab, .sx-chip { min-height: 44px; }
  .sx-etabs button, .sx-seg button, .pb-tabs button { min-height: 44px; min-width: 44px; }
  .pb-row { min-height: 44px; }
  .pb-stars button { min-width: 36px; min-height: 44px; font-size: 18px; }
  .pb-hd, .pb-row { grid-template-columns: 44px minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 184px 44px; }
  .pb-play, .pb-row .pb-more { min-width: 44px; min-height: 44px; }
  .sx-root { --sx-crvw: 46px; }
  .sx-crv { width: 44px; height: 44px; }
}
.sx-touch .sx-tab, .sx-touch .sx-hbtn, .sx-touch .sx-btn, .sx-touch .sx-tile, .sx-touch .sx-nfv, .sx-touch .sx-ptab, .sx-touch .sx-chip { min-height: 44px; }
.sx-touch .sx-hbtn, .sx-touch .sx-btn { min-width: 44px; }
/* the remaining small targets of §13.1 (≥ 44 px): ENV tabs, every seg button, browser tabs, stars, play / more, CRV cells */
.sx-touch .sx-etabs button, .sx-touch .sx-seg button, .sx-touch .pb-tabs button { min-height: 44px; min-width: 44px; }
.sx-touch .pb-row { min-height: 44px; }
.sx-touch .pb-stars button { min-width: 36px; min-height: 44px; font-size: 18px; padding: 0 3px; }
.sx-touch .pb-hd, .sx-touch .pb-row { grid-template-columns: 44px minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 184px 44px; }
.sx-touch .pb-play, .sx-touch .pb-row .pb-more { min-width: 44px; min-height: 44px; }
.sx-touch.sx-root { --sx-crvw: 46px; }
.sx-touch .sx-crv { width: 44px; height: 44px; }
.sx-touch .sx-mh { min-width: 32px; }
@media (prefers-reduced-motion: reduce) { .sx-root *, .pb-root * { transition: none !important; } }
`;

function injectSxStyles(doc) {
  if (!doc || doc.getElementById('sx-css')) return;
  const s = doc.createElement('style');
  s.id = 'sx-css';
  s.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(s);
}

/* ================================================================ DOM helpers */

const SVGNS = 'http://www.w3.org/2000/svg';
function mk(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function svgEl(doc, tag, a) {
  const e = doc.createElementNS(SVGNS, tag);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
}
const ICONS = {
  save: ['M3 2.5h8.5L14 5v8.5H3z', 'M5.5 2.5v3.5h5v-3.5', 'M5.5 13.5v-4h6v4'],
  edit: ['M10.5 2.5l3 3-8 8H2.5v-3z', 'M9 4l3 3'],
  zoom: ['M7 2.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9', 'M10.5 10.5L14 14'],
  lock: ['M4 7.5h8v6H4z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'],
  folder: ['M2 4h4.5l1.5 1.5H14V13H2z'],
  more: ['M3.5 8h.01', 'M8 8h.01', 'M12.5 8h.01'],
  info: ['M8 2a6 6 0 1 1 0 12a6 6 0 1 1 0-12', 'M8 7v4.5', 'M8 4.8v.01'],
  menu: ['M2.5 4.5h11', 'M2.5 8h11', 'M2.5 11.5h11'],
  trash: ['M2.5 4.5h11', 'M6 4.5V2.5h4v2', 'M4 4.5l.8 9h6.4l.8-9', 'M6.8 7v4', 'M9.2 7v4'],
  wave: ['M1.5 8h1.5', 'M3 8c1-5 2-5 3 0s2 5 3 0 2-5 3 0', 'M12 8h2.5'],
  undo: ['M5.5 4L2.5 7l3 3', 'M2.5 7h7a3.5 3.5 0 0 1 0 7H7'],
  redo: ['M10.5 4l3 3-3 3', 'M13.5 7h-7a3.5 3.5 0 0 0 0 7H9'],
  play: ['M5 3.5l7 4.5-7 4.5z'],
  stop: ['M4.5 4.5h7v7h-7z'],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
  chev: ['M4 6l4 4 4-4'],
  grip: ['M6 4h.01', 'M10 4h.01', 'M6 8h.01', 'M10 8h.01', 'M6 12h.01', 'M10 12h.01'],
  dice: ['M3 3h10v10H3z', 'M6 6h.01', 'M10 10h.01', 'M8 8h.01'],
};
function icon(doc, name) {
  const s = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
  for (const d of ICONS[name] || []) s.appendChild(svgEl(doc, 'path', { d }));
  return s;
}
function logo(doc) {   // original mark: a wavetable "stack" of three offset waves
  const s = svgEl(doc, 'svg', { class: 'sx-logo', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' });
  const g = svgEl(doc, 'g', { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' });
  g.appendChild(svgEl(doc, 'path', { d: 'M4 22c3-9 5-9 8 0s5 9 8 0 5-9 8 0', opacity: '0.35' }));
  g.appendChild(svgEl(doc, 'path', { d: 'M4 17c3-9 5-9 8 0s5 9 8 0 5-9 8 0', opacity: '0.65' }));
  g.appendChild(svgEl(doc, 'path', { d: 'M4 12c3-9 5-9 8 0s5 9 8 0 5-9 8 0' }));
  s.appendChild(g);
  return s;
}
function btn(doc, cls, label, title, onClick) {
  const b = mk(doc, 'button', cls);
  b.type = 'button';
  if (typeof label === 'string') b.textContent = label; else if (label) b.appendChild(label);
  if (title) { b.setAttribute('aria-label', title); b.title = title; }
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function on(t, type, fn, opt) { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); }
function closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }
function rafOf(doc) {
  const w = doc && doc.defaultView;
  const r = (w && w.requestAnimationFrame) || globalThis.requestAnimationFrame;
  return r ? f => r.call(w || globalThis, f) : f => setTimeout(f, 16);
}
// Touch long-press (500 ms, ≤ 8 px) on a plain element → fn(x, y); skipped when the browser already fired its
// own contextmenu for that press (Android) and while el is being dragged (wk.dragSource's wk-dragging: a touch drag can
// start within the 8 px).
function longPress(el, fn) {
  let t = 0, x = 0, y = 0, t0 = 0, ctxT = -1;
  el.addEventListener('contextmenu', e => { ctxT = e.timeStamp; });
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    x = e.clientX; y = e.clientY; t0 = e.timeStamp;
    clearTimeout(t);
    t = setTimeout(() => { t = 0; if (ctxT < t0 && !(el.classList && el.classList.contains('wk-dragging'))) fn(x, y); }, 500);
  });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 8) { clearTimeout(t); t = 0; } });
  for (const k of ['pointerup', 'pointercancel']) el.addEventListener(k, () => { clearTimeout(t); t = 0; });
}
// Set a drag ghost's text and position it (position: fixed at 0, 0) for a pointer at (x, y): mouse / pen beside the
// pointer; touch centred over the finger with its bottom edge 40 px above it, kept 8 px inside the viewport's sides and
// top, so neither the finger nor the hand hides it and a long "source → target" stays whole at the screen edges
// (§13.1). The box is measured after the text is set, and only when the text changes (one layout read per label).
const GHOST_LIFT = 40, GHOST_EDGE = 8;
function ghostAt(g, x, y, touch, text) {
  if (text != null && g.textContent !== text) g.textContent = text;
  if (!touch) { g.style.transform = 'translate(' + (x + 12) + 'px,' + (y + 10) + 'px)'; return; }
  const T = g.textContent;
  if (!g._sz || g._sz.t !== T) {
    let r = null;
    try { r = g.getBoundingClientRect(); } catch (err) { r = null; }
    g._sz = { t: T, w: r && r.width > 0 ? r.width : 0, h: r && r.height > 0 ? r.height : 0 };
  }
  const { w, h } = g._sz, win = g.ownerDocument && g.ownerDocument.defaultView, vw = win && win.innerWidth > 0 ? win.innerWidth : 0;
  let left = Math.round(x - w / 2);
  if (vw) left = Math.min(left, Math.round(vw - w - GHOST_EDGE));
  left = Math.max(GHOST_EDGE, left);
  const top = Math.max(GHOST_EDGE, Math.round(y - GHOST_LIFT - h));
  g.style.transform = 'translate(' + left + 'px,' + top + 'px)';
}
// a quick touch drag (wk.dragSource info.quick: started without the hold) drops only once the finger has rested on its
// target this long — a flick that merely ends over a control (a habitual page-scroll swipe from the tile strip) is a cancel
const SETTLE_MS = 100;
const sameHit = (a, b) => (a && b ? a.el === b.el && a.kind === b.kind && a.idx === b.idx && a.lfo === b.lfo : a === b);
function download(doc, name, text) {
  try {
    const U = globalThis.URL, B = globalThis.Blob;
    const url = U.createObjectURL(new B([text], { type: 'application/json' }));
    const a = mk(doc, 'a');
    a.href = url; a.download = name;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => U.revokeObjectURL(url), 4000);
  } catch (err) { console.warn('serum-ui: download failed', err); }
}
// one hidden <input type=file>; resolves the chosen file, or null when the dialog is cancelled ('cancel' event),
// and removes the input either way
function pickFile(doc, accept) {
  return new Promise(res => {
    const i = mk(doc, 'input');
    i.type = 'file'; i.accept = accept || '';
    i.style.display = 'none';
    const done = f => { i.remove(); res(f || null); };
    i.addEventListener('change', () => done(i.files && i.files[0]));
    i.addEventListener('cancel', () => done(null));
    doc.body.appendChild(i);
    i.click();
  });
}
const fileText = f => (f && f.text ? f.text() : Promise.resolve(''));
// an overlay opened in a narrow panel (< 1100 px, §13.2) is brought to the top of the screen: it is full screen there
function fullScreenOverlay(root, ov) {
  const w = panelW(root);
  if (w > 0 && w < 1100) revealIn(ov, 'start');
}
// the panel's layout width (offsetWidth: the canvas world's zoom does not narrow it), the screen width without layout
function panelW(root) {
  try { return root ? +root.offsetWidth || (root.getBoundingClientRect ? root.getBoundingClientRect().width : 0) : 0; } catch (err) { return 0; }
}
// bring an overlay on screen: on a page by scrollIntoView; inside the canvas world (no scroller: the camera pans) by a
// bubbling 'wk-reveal' event the world answers (cv-world reveal)
function revealIn(el, block) {
  try {
    let w = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('data-cv-world')) { w = true; break; }
    if (w) { const E = (el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.Event) || globalThis.Event; if (typeof E === 'function') el.dispatchEvent(new E('wk-reveal', { bubbles: true })); }
    else if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block });
  } catch (err) { /* layout unavailable */ }
}
// window.confirm must be called as a method (a detached call throws "Illegal invocation" in browsers)
function askConfirm(doc, msg) {
  const w = (doc && doc.defaultView) || globalThis;
  try { return typeof w.confirm === 'function' ? !!w.confirm(msg) : true; } catch (err) { return true; }
}

/* ---------------------------------------------------------------- numField */
// Numeric box in engine units: { label, get: () => v, set: (v, phase), min, max, step, def?, fmt?, parse?,
// disabled?, px? (drag px for the full range, default 200), dest?, cls? }. Vertical drag (Shift fine), wheel
// (1 step, honours the wheel preference), arrows ±1 step (Shift ×10), PageUp/Down ±10 steps, Home/End,
// Delete = def, Enter / double-click = typed entry. With `dest` it carries data-dest, el.wk and an underline
// halo (setMod), like wk.numBox.
function numField(doc, o) {
  const el = mk(doc, 'div', 'sx-nf' + (o.cls ? ' ' + o.cls : ''));
  el.style.position = 'relative';
  const lab = o.label ? mk(doc, 'span', 'sx-nfl', o.label) : null;
  const val = mk(doc, 'span', 'sx-nfv');
  val.tabIndex = 0;
  val.setAttribute('role', 'spinbutton');
  val.setAttribute('aria-label', o.label || o.aria || 'value');
  val.setAttribute('aria-valuemin', String(o.min));
  val.setAttribute('aria-valuemax', String(o.max));
  if (lab) el.appendChild(lab);
  el.appendChild(val);
  const bar = mk(doc, 'span', 'wk-modbar'), segs = [];
  bar.setAttribute('aria-hidden', 'true');
  el.appendChild(bar);
  const dec = Math.max(0, Math.ceil(-Math.log10(o.step) - 1e-9));
  const q = v => +clamp(o.min + Math.round((v - o.min) / o.step) * o.step, o.min, o.max).toFixed(dec);
  const fmt = o.fmt || (v => v.toFixed(dec));
  let g = null, inp = null, dis = false, hoverT = -1e9, wacc = 0, wT = 0;
  const W = { el, update, setMod, focus: () => val.focus(), edit, destroy: () => el.remove() };
  if (o.dest) { el.wk = W; el.setAttribute('data-dest', fnOf(o.dest)()); }

  function update() {
    const v = o.get(), t = fmt(v);
    if (val.textContent !== t) val.textContent = t;
    val.setAttribute('aria-valuenow', String(v));
    val.setAttribute('aria-valuetext', t);
    dis = !!(o.disabled && o.disabled());
    el.classList.toggle('sx-dis', dis);
    if (o.dest) el.setAttribute('data-dest', fnOf(o.dest)());
  }
  function setMod(m) {
    const list = (m && m.arcs) || [];
    for (let i = 0; i < Math.max(list.length, segs.length); i++) {
      if (i >= list.length) { segs[i].style.display = 'none'; continue; }
      if (!segs[i]) { segs[i] = mk(doc, 'i'); bar.appendChild(segs[i]); }
      const a = list[i], lo = clamp01(Math.min(a.from, a.to)), hi = clamp01(Math.max(a.from, a.to));
      segs[i].className = 'wk-mseg k-' + (a.kind === 'sel' || a.kind === 'neg' ? a.kind : 'other');
      segs[i].style.display = '';
      segs[i].style.left = (lo * 100).toFixed(2) + '%';
      segs[i].style.width = (Math.max(hi - lo, 0.01) * 100).toFixed(2) + '%';
    }
    el.classList.toggle('wk-modded', list.length > 0);
  }
  function put(v, ph) { v = q(v); if (ph === 'set' && v === o.get()) return; o.set(v, ph); update(); }
  let tap = null;   // touch: the previous tap {t, x, y} — a second tap within 350 ms and 12 px = typed entry (§13.1)
  val.addEventListener('pointerdown', e => {
    if (dis || e.button !== 0 || inp || g) return;
    e.preventDefault();
    if (e.pointerType === 'touch') {
      const T = tap;
      tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (T && e.timeStamp - T.t < 350 && Math.hypot(e.clientX - T.x, e.clientY - T.y) < 12) { tap = null; edit(); return; }
    }
    val.focus();
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, v0: o.get(), acc: 0, last: o.get() };
    try { val.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    o.set(g.v0, 'start');
  });
  val.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const d = (g.y - e.clientY) + (e.clientX - g.x);
    g.x = e.clientX; g.y = e.clientY;
    g.acc += d * (e.shiftKey ? 0.1 : 1);
    const v = q(g.v0 + g.acc * (o.max - o.min) / (o.px || 200));
    if (v !== g.last) { g.last = v; o.set(v, 'move'); update(); }
  });
  const end = e => {
    if (!g || (e && e.pointerId !== g.id)) return;
    const G = g;
    g = null;
    try { val.releasePointerCapture(G.id); } catch (err) { /* released */ }
    if (twoF(e)) { G.last = G.v0; o.set(G.v0, 'move'); tap = null; }   // two-finger rollback: the value from before
    o.set(G.last, 'end');
    update();
  };
  val.addEventListener('pointerup', end);
  val.addEventListener('pointercancel', end);
  val.addEventListener('dblclick', e => {
    e.preventDefault();
    if (dis) return;
    const p = wk.getPrefs ? wk.getPrefs() : { dblClick: 'type' };
    if (p.dblClick === 'reset' && o.def !== undefined) put(o.def, 'set'); else edit();
  });
  val.addEventListener('pointerenter', e => { hoverT = e.timeStamp; });
  val.addEventListener('wheel', e => {
    const p = wk.getPrefs ? wk.getPrefs() : { wheel: 1 };
    if (!p.wheel || dis || inp) return;
    if (doc.activeElement !== val && e.timeStamp - hoverT < 300) return;
    const d = e.deltaY;
    if (!d) return;
    e.preventDefault();
    if (e.deltaMode > 0 || Math.abs(d) >= 50) { put(o.get() - Math.sign(d) * o.step, 'set'); return; }
    if (e.timeStamp - wT > 200) wacc = 0;
    wT = e.timeStamp; wacc += d;
    const k = Math.trunc(wacc / 40);
    if (k) { wacc -= k * 40; put(o.get() - k * o.step, 'set'); }
  }, { passive: false });
  val.addEventListener('keydown', e => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = val.getBoundingClientRect();
      const E = globalThis.MouseEvent || globalThis.Event;
      el.dispatchEvent(new E('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return;
    }
    if (dis) return;
    const k = e.key, st = o.step * (e.shiftKey ? 10 : 1), v = o.get();
    let n = null;
    if (k === 'ArrowUp' || k === 'ArrowRight') n = v + st;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') n = v - st;
    else if (k === 'PageUp') n = v + 10 * o.step;
    else if (k === 'PageDown') n = v - 10 * o.step;
    else if (k === 'Home') n = o.min;
    else if (k === 'End') n = o.max;
    else if ((k === 'Delete' || k === 'Backspace') && o.def !== undefined) n = o.def;
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    if (n === null) return;
    e.preventDefault();
    put(n, 'set');
  });
  function edit() {
    if (inp || dis) return;
    inp = mk(doc, 'input');
    inp.type = 'text';
    inp.setAttribute('inputmode', 'decimal');   // the numeric keypad on touch devices (§13.1)
    inp.value = val.textContent;
    inp.setAttribute('aria-label', (o.label || 'value') + ' value');
    val.style.display = 'none';
    el.insertBefore(inp, bar);
    let done = false;
    const fin_ = ok => {
      if (done) return;
      done = true;
      const t = inp.value;
      inp.remove(); inp = null;
      val.style.display = '';
      if (ok) {
        const v = o.parse ? o.parse(t) : parseFloat(String(t).replace(',', '.'));
        if (v !== null && fin(v)) put(v, 'set');
      }
      val.focus();
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); fin_(true); } else if (e.key === 'Escape') { e.preventDefault(); fin_(false); }
    });
    inp.addEventListener('blur', () => fin_(true));
    inp.focus();
    if (inp.select) inp.select();
  }
  update();
  return W;
}

/* ---------------------------------------------------------------- segField */
// Radio group for structured enums: { label, items: [labels], get: () => idx, set: idx, disabled? }
// segmented radio switch (o.items labels, get() → index, set(i)); o.always: set runs on every click, also on the item
// already selected (GLOBAL > QUALITY: choosing a quality resets the CPU-safeguard steps, §14.3)
function segField(doc, o) {
  const el = mk(doc, 'div', 'sx-seg');
  el.setAttribute('role', 'radiogroup');
  if (o.label) el.setAttribute('aria-label', o.label);
  const bs = o.items.map((t, i) => {
    const b = btn(doc, '', t, null, () => { if (o.always || o.get() !== i) o.set(i); update(); });
    b.setAttribute('role', 'radio');
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const j = (o.get() + d + o.items.length) % o.items.length;
      o.set(j); update(); bs[j].focus();
    });
    el.appendChild(b);
    return b;
  });
  function update() {
    const v = o.get(), dis = !!(o.disabled && o.disabled());
    bs.forEach((b, i) => { b.setAttribute('aria-checked', i === v ? 'true' : 'false'); b.tabIndex = i === v ? 0 : -1; b.disabled = dis; });
  }
  update();
  return { el, update, destroy: () => el.remove() };
}

/* ---------------------------------------------------------------- hSlider (fallback for wk.slider) */
function hSlider(doc, o) {
  const el = mk(doc, 'div', 'sx-hs');
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.style.cssText = 'position:relative;height:18px;min-width:40px;background:var(--sx-bg);border:1px solid var(--sx-line);border-radius:4px;touch-action:none;cursor:ew-resize';
  const fill = mk(doc, 'span');
  fill.style.cssText = 'position:absolute;top:2px;bottom:2px;background:var(--sx-graph);border-radius:2px;opacity:0.85';
  el.appendChild(fill);
  if (o.dest) el.setAttribute('data-dest', fnOf(o.dest)());
  let g = null;
  const W = { el, update, setMod() {}, focus: () => el.focus(), destroy: () => el.remove() };
  if (o.dest) el.wk = W;
  function update() {
    const n = clamp01(o.get()), b = o.bipolar ? 0.5 : 0;
    fill.style.left = (Math.min(b, n) * 100).toFixed(2) + '%';
    fill.style.width = (Math.abs(n - b) * 100).toFixed(2) + '%';
    el.setAttribute('aria-valuenow', String(Math.round(n * 1000) / 10));
    el.setAttribute('aria-valuetext', o.fmt ? o.fmt(n) : String(n));
  }
  const at = e => { const r = el.getBoundingClientRect(); return clamp01((e.clientX - r.left) / Math.max(1, r.width)); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); el.focus();
    if ((e.metaKey || e.ctrlKey) && o.def !== undefined) { o.set(o.def, 'set'); update(); return; }
    g = { id: e.pointerId, n: at(e), n0: o.get() };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    o.set(g.n0, 'start'); o.set(g.n, 'move'); update();
  });
  el.addEventListener('pointermove', e => { if (g && e.pointerId === g.id) { g.n = at(e); o.set(g.n, 'move'); update(); } });
  const end = e => { // a two-finger rollback (twoF) also undoes the jump of the press
    if (!g || (twoF(e) && e.pointerId !== g.id)) return;
    const G = g;
    g = null;
    if (twoF(e)) { G.n = G.n0; o.set(G.n, 'move'); }
    o.set(G.n, 'end'); update();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => {
    const k = e.key, s = e.shiftKey ? 0.001 : 0.01, n = o.get();
    let v = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') v = n + s; else if (k === 'ArrowLeft' || k === 'ArrowDown') v = n - s;
    else if (k === 'Home') v = 0; else if (k === 'End') v = 1; else if ((k === 'Delete' || k === 'Backspace') && o.def !== undefined) v = o.def;
    if (v === null) return;
    e.preventDefault(); o.set(clamp01(v), 'set'); update();
  });
  update();
  return W;
}


/* ================================================================ SerumUI */

let CLIP = null;          // module clipboard, shared by every panel (copy on one track, paste on another)
let UID = 0;
const qsa = (root, sel) => Array.prototype.slice.call(root.querySelectorAll(sel));
const toggleIn = (list, v, want) => {
  const i = list.indexOf(v), has = i >= 0, w = want === undefined ? !has : !!want;
  if (w && !has) list.push(v); else if (!w && has) list.splice(i, 1);
};
const focusable = el => (el && (el.matches && el.matches('button, [tabindex]') ? el
  : el.querySelector && el.querySelector('button, [tabindex]'))) || el;
const mkPage = el => ({ el: el || null, binds: [], canvases: [], editors: [], lives: [] });
// the MIX page module (U3), loaded on demand: the page degrades to a notice while it is missing
const loadMix = () => import('./sx-ui-mix.js?v=9');
// wk.contextMenu items from knobMenuItems-style groups ({label, sub}) with an action per leaf
const subMenu = (items, act) => arr(items).map(it => (it.sub ? { label: it.label, sub: subMenu(it.sub, act) }
  : Object.assign({ label: it.label, action: () => act(it) }, it.checked !== undefined ? { checked: it.checked } : {})));

/* ---------------------------------------------------------------- binding kit (SPEC-serum2 §11.14, B19) */
// The U1 / U2–U4 boundary: the sub-panels (sx-ui-osc, sx-ui-mix, sx-ui-seq) receive this object, never the SerumUI or
// the main.js host's edit path; everything that touches modulation, undo or locks goes through it.
// Normative members (§11.14):
//   host                      the main.js host (host.wt, host.smp, host.tracks, host.seqCmd, host.storage …)
//   s() / fx() / snap()       the live Serum state, FX state, last engine snapshot (msg.s, §6.20) or null
//   knob(id, o)               wk knob bound to destination id: data-dest, halo, drag-to-modulate drop target, knob
//                             menu, MIDI learn, locks, typed entry, tooltip. o: { label, size, labelFn, disabled,
//                             detents, bipolarFn }. Virtual destinations (macros m1…m8, arp.*, clip.*) read and write
//                             their bases where the state keeps them (virtGet / virtSet)
//   menu(id, items, o) / toggle(id, o) / seg(id, o)   the same bindings for enum / bool destinations (o.label; toggle
//                             o.kind 'led' | 'btn' | 'power', o.module; seg o.items = labels of the steps)
//   dropTarget(el, id)        any element as a modulation drop target and knob-menu host of destination id (right-click;
//                             touch: a 500 ms long-press, iPad Safari sends no contextmenu); returns el
//   edit(fn, o) / editFx(fn, o)   state edits (fn mutates the live state) through the panel's dirty state, undo,
//                             repaint and host.edit / host.editFx; o = label string or { label, phase, ui }
//   notify(text), prefs()     notices; the panel preferences (§9.7, §13.10)
// Panel-shell members (U1):
//   doc                       the panel's document
//   num(id, o)                destination number box (o.label, o.disabled, o.cls)
//   bind(w) / custom(fn)      repaint w.update() / fn() with the panel (registered on the page being built)
//   canvas(cls, key, draw)    a display canvas of the page: drawn when key() changes, sized to its box → { el }
//   panel(title, module, powerId, cls, o)   the module panel shell (power, module menu, lock mark) → { el, head,
//                             body, name }; o.items() = extra module-menu items appended after the module items
//                             ([{label, checked?, disabled?, action?, sub?} | {sep: true}], e.g. ✓ Enable Pitch
//                             Tracking, Edit Note Ranges…); the label is a drag handle onto another module of the same
//                             kind (plain = swap incl. mods, Alt = copy, Shift-Alt = copy with mods); o.collapse =
//                             fold to the title row while the module is off (C1; its chevron shows it meanwhile)
//   live(fn)                  fn(shown) on every repaint and snapshot frame (live status, e.g. the unison voice warning;
//                             playheads; clip recording). shown = the page fn was built on is on screen: hidden pages
//                             are not painted (§13.1), so DOM work should be skipped when it is false — functional work
//                             (e.g. a recording that goes on while another page is shown) keeps running
//   getN(id) / setN(id, n, phase)   base n of a destination / set it (snapped; FX ids through editFx; S1 pairs synced)
//   dragging(id)              whether the control of id is in a drag gesture (last setN phase 'start' / 'move')
//   queue() / dead()          request a repaint (asynchronous data arrived) / the panel was destroyed
//   paintSeq() / snapSeq()    counters of repaints / snapshots (per-repaint caches, redraw on every snapshot)
//   prompt(title, label, value, ok)   text dialog; ok(text) returns false to keep it open
//   popover(key, anchor, title, make, sig)   anchored editor popover (see SerumUI.popover)
//   shapes()                  the LFO shape library (graph editors' shape menus)
//   openWtEditor(o)           the WT editor overlay for oscillator o
//   wt                        the wt.js helpers (tables, WAV / PNG import, noises), injected for sx-ui-osc (§0.2)
// tests/serum-ui-stubs/kit.js mirrors every member (export / member parity test in tests/serum-ui.test.mjs).
export function makeKit(ui) {
  const opt = o => (typeof o === 'string' ? { label: o } : Object.assign({}, o));
  return Object.freeze({
    host: ui.host,
    s: () => ui.s(),
    fx: () => ui.fx(),
    snap: () => ui.snap,
    knob: (id, o) => { const O = opt(o); return ui.dKnob(id, O.label || '', O); },
    menu: (id, items, o) => { const O = opt(o); return ui.dMenu(id, O.label || '', items, O); },
    toggle: (id, o) => { const O = opt(o); return ui.dToggle(id, O.label || '', O.kind, O); },
    seg: (id, o) => ui.dSeg(id, opt(o)),
    dropTarget: (el, id) => { if (el && el.setAttribute && typeof id === 'string') { el.setAttribute('data-dest', id); ui.touchMenu(el); } return el; },
    edit: (fn, o) => ui.edit(fn, opt(o)),
    editFx: (fn, o) => ui.editFx(fn, opt(o)),
    notify: text => ui.notify(text),
    prefs: () => ui.prefs,
    doc: ui.d,
    num: (id, o) => { const O = opt(o); return ui.dNum(id, O.label || '', O); },
    bind: w => ui.bind(w),
    custom: fn => ui.custom(fn),
    canvas: (cls, key, draw, extra) => ui.canvas(cls, key, draw, extra),
    panel: (title, module, powerId, cls, o) => ui.panel(title, module, powerId, cls, o),
    live: fn => { (ui.bp || ui.headPage).lives.push(fn); return fn; },
    getN: id => ui.getN(id),
    setN: (id, n, ph) => ui.setN(id, n, ph),
    dragging: id => ui.held.has(id),
    queue: () => { ui.fc = null; ui.queue(); },
    dead: () => ui.dead,
    paintSeq: () => ui.paintSeq || 0,
    snapSeq: () => ui.snapSeq || 0,
    prompt: (title, label, value, ok) => ui.promptText(title, label, value, ok),
    popover: (key, anchor, title, make, sig) => ui.popover(key, anchor, title, make, sig),
    shapes: () => ui.shapeLib(),
    openWtEditor: o => ui.openWtEditor(o),
    wt,
  });
}

export class SerumUI {
  constructor(root, host) {
    this.root = root;
    this.host = host || {};
    this.d = (root && root.ownerDocument) || globalThis.document;
    this.uid = 'sx' + (++UID);
    this.raf = rafOf(this.d);
    this.dead = false;
    this.pages = {};
    this.head = null;
    this.headPage = mkPage();
    this.footPage = mkPage();         // the keyboard panel under every page (§13.2)
    this.bp = null;                   // page being built (widget factories register into it)
    this.page = '';
    this.snap = null;
    this.smon = null;
    this.dirty = false;
    this.nameOverride = null;
    this.recentSlot = new Map();
    this.offs = [];
    this.queued = false;
    this.ticking = false;
    this.modEls = [];
    this.edSel = 'lfo1';
    this.peeks = new Set();           // C1: power ids of off modules shown by their chevron (view only: no state, undo or save)
    this.edDirty = true;
    this.held = new Set();            // destinations whose control is being dragged (last setN phase start / move)
    this.gest = new Set();            // destinations whose drag gesture has changed the value (its end is an undo step)
    this.ph0 = new Map();             // LFO PHASE base at a drag's 'start' (a two-finger rollback puts it back unsnapped)
    this.noteGroup = 0;               // note groups seen in the snapshots (notes 0 → > 0), for the header render cache
    this.editSeq = 0;                 // state edits made through the panel (the header render cache's patch version)
    this.lastRender = null;           // the last header render handed back by host.renderLast (drag-export, §13.2.5)
    this.plist = null;                // host.presets.list() cache (syncPreset)
    this.drag = null;
    this.overlay = null;
    this.rack = null;
    this.mixer = null;
    this.seqPages = {};
    this.macPane = { arp: false, clip: false };
    this.mxExp = false;
    this.capPrev = null;
    this.capArm = [false, false, false];   // RAND (S1) / phMem (S2) of A / B / C edited here since the last capture check (§6.4)
    this.eatClick = null;             // { el, t }: the click that ends a Shift+Alt / Alt-drag gesture on el
    this.lfoGest = null;              // buses the LFO points linked when the current graph drag started
    this.lfoTool = 'point';           // LFO drawing tool (§13.13; view state)
    this.lfoSnap = false;             // PHASE ✓ Snap to Grid (§6.15.2; view state)
    this.editorOsc = null;            // oscillator whose WT editor is open (0 | 1 | 2 | null), for the host (§9.9)
    this.fc = null;
    this.edSig = new WeakMap();       // graph editor → () => signature of what it draws
    this.edKey = new WeakMap();
    this.snapT = -1e9;
    // panel undo / redo (§13.2.4); capped at 4 MB of snapshots on a touch device (SPEC-canvas §5.7: several Serums per page)
    this.undoMax = isTouchDev(this.d) ? UNDO_TOUCH_BYTES : 16 * 1024 * 1024;
    this.undo = undoStack(100, { maxBytes: this.undoMax });
    this.undoPend = null;             // label of the edit gesture whose snapshot is taken at the next paint
    this.restoring = false;
    this.touch = false;
    this.kit = makeKit(this);         // the binding kit of the sub-panels (§11.14)
    this.oscd = osc.oscData(this.kit);   // their wavetable / noise data (table cache, imports, conversions)
    this.prefs = normPrefs(this.store('get', PREFS_KEY, null));
    if (wk.setPrefs) wk.setPrefs({ tooltips: this.prefs.tooltips, dblClick: this.prefs.dblClick, wheel: this.prefs.wheel });
    if (wk.injectStyles) wk.injectStyles(this.d);
    injectSxStyles(this.d);
    const s = this.s();
    if (s && s.ui && EDIT_SRC.test(s.ui.mod)) this.edSel = s.ui.mod;
    this.el = mk(this.d, 'div', 'sx-root');
    this.el.id = this.uid;
    // the device this panel is (SPEC-canvas §8.6): its [data-dest] ids resolve inside it — 'a.level' exists in every Serum
    this.dev = typeof this.host.dev === 'string' && this.host.dev ? this.host.dev : 'i1';
    this.el.setAttribute('data-dev', this.dev);
    this.lay = null;                  // the top-layer twin of the root (popovers, overlays) while the panel is on the canvas
    root.appendChild(this.el);
    this.detectTouch();
    const RO = this.d.defaultView && this.d.defaultView.ResizeObserver || globalThis.ResizeObserver;
    this.ro = RO ? new RO(() => { for (const P of this.allPages()) for (const cv of P.canvases) cv.sized = false; this.queue(); }) : null;
    // the canvas world's zoom ended (SPEC-canvas §4.4): the displays' stores follow k (paintCanvas), so all re-measure
    this.offs.push(wk.onRescale(this.el, () => { if (this.dead) return; for (const P of this.allPages()) for (const cv of P.canvases) cv.sized = false; this.queue(); }));
    this.buildHead();
    this.statusEl = mk(this.d, 'div', 'sx-status');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    this.el.appendChild(this.statusEl);
    this.pageBox = mk(this.d, 'div', 'sx-pages');
    this.el.appendChild(this.pageBox);
    this.buildFoot();
    this.installModLayer();
    this.browser = new PresetBrowser(this.el, this.host, {
      notify: t => this.notify(t),
      confirmLoad: () => this.confirmChange(),
      modified: () => this.dirty || !!this.nameOverride,
      onLoad: () => { this.dirty = false; this.nameOverride = null; this.edDirty = true; this.oscd.forget(); this.peeks.clear(); this.markUndo('Load preset'); this.refresh(); },
      changed: () => { this.plist = null; this.syncPreset(); this.queue(); },   // the list changed (delete, rename, import, ratings)
      current: () => this.lastKey,   // the current key as the panel knows it (syncPreset), not re-read per browser action
      hybrid: (keys, favor) => this.hybridize(keys, favor),
      storage: this.host.storage,
      layer: () => this.layerEl(),
    });
    // "Default WT view" (§9.7) for new tracks: the host creates them with withPrefs (os / author only), so a
    // sound that is still the untouched default opens in 3D when the preference says so (a view-only edit)
    if (this.prefs.view3d && s && s.ui && arr(s.ui.view3d).every(v => !v) && isPristine(s)) this.uiEdit(st => { st.ui.view3d = arr(st.ui.view3d).map(() => 1); });
    this.syncPreset();
    this.showPage(s && s.ui && PAGES.includes(s.ui.page) ? s.ui.page : 'osc');
    this.undo.base(this.snapStr());
    if (this.host.monitor) this.host.monitor(true);
    if (this.d.addEventListener) {
      this.offs.push(on(this.d, 'visibilitychange', () => { if (this.host.monitor && !this.dead) this.host.monitor(!this.d.hidden); }));
    }
    if (!globalThis.SerumDSP && wk.loadDSP) wk.loadDSP().then(() => { if (!this.dead) { this.fc = null; this.queue(); } }, () => {});
  }

  /* ---------------------------------------------------------------- state access */
  s() { return this.host.state ? this.host.state() : null; }
  fx() { return this.host.fx ? this.host.fx() : null; }
  bpm() { const b = this.host.bpm ? +this.host.bpm() : 120; return b > 0 ? b : 120; }
  dsp() { return globalThis.SerumDSP || null; }
  store(op, k, v) {
    const st = this.host.storage;
    try {
      if (op === 'get') return st && st.get ? st.get(k, v) : v;
      if (st && st.set) st.set(k, v);
    } catch (err) { console.warn('serum-ui: storage', err); }
    return v;
  }
  getN(id) { return baseN(this.s(), this.fx(), id); }
  setN(id, n, ph) {
    const fx = this.fx(), d = destOf(id) || rowOfDest(id, fx);
    if (!d) return;
    const phase = ph || 'set', label = d.label || id, cur = this.getN(id);
    let v = snapN(id, n, fx);
    const isPh = /^l([1-9]|10)\.phase$/.test(id);
    let ph0;
    if (isPh) { // the base at the drag's 'start' (per destination: two hands may drag two LFOs)
      if (phase === 'start') this.ph0.set(id, cur);
      ph0 = this.ph0.get(id);
      if (phase !== 'start' && phase !== 'move') this.ph0.delete(id);
    }
    // LFO PHASE ✓ Snap to Grid (§6.15.2, §13.13): the base phase in multiples of 360/lfoGrid.x degrees while dragging
    // only — typed, reset, wheel and keyboard values ('set'), a press without a move and a two-finger rollback (the
    // value from before the press: 'move' + 'end' with it) keep their value
    if (this.lfoSnap && isPh && (phase === 'move' || (phase === 'end' && v !== cur)) && ph0 !== v) {
      const g = this.s() && this.s().lfoGrid, x = g && g.x >= 1 ? Math.round(g.x) : 1;
      v = Math.round(clamp01(v) * x) / x;
    }
    // a value the control already has (a press, a click or a long-press without a move; a reset at the default) is no
    // edit: no host edit (compile + patch), no '*' on the preset name, no undo step. A gesture whose moves changed the
    // value still ends with its undo step. (Not for arp.* / clip.*: with EDIT ALL the value goes to every slot.)
    if (fin(cur) && v === cur && !/^(arp|clip)\./.test(id)) {
      if (phase === 'start') { this.gest.delete(id); this.held.add(id); }
      else if (phase !== 'move') {
        this.held.delete(id);
        if (phase === 'end' && this.gest.delete(id)) this.markUndo(label, 'end');
      }
      return;
    }
    if (phase === 'start' || phase === 'move') this.gest.add(id); else this.gest.delete(id);
    if (id === 'a.warpMode' || id === 'b.warpMode') {
      const o = id === 'b.warpMode' ? 1 : 0;
      this.edit(s => { if (core.warpChoice) core.warpChoice(s, o, Math.round(v * 22)); else s.p[id] = v; syncS1(s, id); }, { label, phase });
    } else if (isFxPar(id)) this.editFx(f => this.fxSet(f, id, v), { label, phase });
    else if (VIRT_RE.test(id) && id !== 'arp.on' && id !== 'clip.on') this.edit(s => { virtSet(s, id, v); }, { label, phase });
    else this.edit(s => { s.p[id] = v; syncS1(s, id); }, { label, phase });
    if (phase === 'start' || phase === 'move') this.held.add(id); else this.held.delete(id);
    const o = OSC_P.findIndex(k => id === k + '.rand');
    if (o >= 0) this.capArm[o] = true;   // phase capture, S1 knob-end rule (§6.4)
  }
  // base n of an FX parameter into the FX state: v1 states keep fx.p; v2 instances through fxDest (§3.16.4)
  fxSet(f, id, v) {
    if (f && isObj(f.p) && (DEST_INDEX[id] !== undefined || !f.racks)) { f.p[id] = v; return; }
    let r = null;
    try { r = typeof core.fxDest === 'function' ? core.fxDest(id, f) : null; } catch (err) { r = null; }
    if (r && r.inst && isObj(r.inst.p)) r.inst.p[r.pid] = v;
  }
  edit(fn, opts) {
    const o = Object.assign({ label: 'Edit' }, opts);
    const pre = o.ui || o.seed || this.restoring || o.phase === 'move' ? null : this.phMemOf();   // phase capture arming (S2)
    if (o.seed) this.peeks.clear();   // C1: preset-like loads (Init Preset, Hybridize, effect chains) fold every off module
    if (this.host.edit) this.host.edit(fn, o);
    if (pre) this.armPhMem(pre);
    if (!o.ui) { this.dirty = true; this.editSeq++; this.markUndo(o.label, o.phase); }
    // view edits that touch state outside s.ui (EDIT ALL …); a selection that only writes s.ui (o.noRebase: snapStr
    // leaves s.ui out) never re-tops — a press's selection must not fold the start of its own drag into the step before
    else if (!this.restoring && !o.noRebase) { this.uiRebase = true; this.queue(); }
    this.rackDirty = true;
    this.fc = null;
    this.queue();
  }
  editFx(fn, opts, fromRack) {
    const o = Object.assign({ label: 'Edit FX' }, opts);
    if (this.host.editFx) this.host.editFx(fn, o); else { this.notify('FX editing is not available'); return; }
    if (!o.ui) { this.dirty = true; this.editSeq++; this.markUndo(o.label, o.phase); }
    else if (!this.restoring) { this.uiRebase = true; this.queue(); }   // view edits inside the instances (MIX / LEVEL label …)
    if (!fromRack) this.rackDirty = true;
    this.fc = null;
    this.queue();
  }
  uiEdit(fn, o) { this.edit(fn, Object.assign({ label: 'View', ui: true }, o)); }
  notify(text) {
    if (this.host.notify) { this.host.notify(text); return; }
    if (!this.el) return;
    if (!this.noticeEl) { this.noticeEl = mk(this.d, 'div', 'sx-notice'); this.noticeEl.setAttribute('role', 'status'); }
    this.noticeEl.textContent = text;
    this.el.appendChild(this.noticeEl);
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => { if (this.noticeEl) this.noticeEl.remove(); }, 2200);
  }
  need(name) {
    if (typeof core[name] === 'function') return core[name];
    this.notify('Not available yet: ' + name);
    return null;
  }
  fmt(id, n) { return core.fmtParam(id, n, this.fctx()); }
  fctx() {
    if (this.fc) return this.fc;
    const s = this.s(), inf = [0, 1, 2].map(o => this.oscd.tinfo(o));
    this.fc = { s, fx: this.fx(), bpm: this.bpm(), frames: inf.map(i => i.F), interp: inf.map(i => i.interp), eff: this.snap ? this.snap.eff : undefined };
    return this.fc;
  }
  parse(id, text) {
    if (typeof core.parseParam === 'function') return core.parseParam(id, text, this.fctx());
    const t = String(text).trim().replace(',', '.'), m = /^([+-]?\d*\.?\d+)\s*(%?)/.exec(t);
    if (/^on$/i.test(t)) return 1;
    if (/^off$/i.test(t)) return 0;
    if (!m) return null;
    return m[2] ? clamp01(+m[1] / 100) : core.lawNorm(id, +m[1]);
  }

  /* ---------------------------------------------------------------- panel undo / redo (§13.2.4) */
  // the snapshot {s, fx} without the view state (ui), so a restore keeps the page, selections and zoom
  snapStr() {
    const s = this.s(), fx = this.fx();
    if (!s) return null;
    try { return JSON.stringify({ s: Object.assign({}, s, { ui: undefined }), fx: fx ? Object.assign({}, fx, { ui: undefined }) : null }); } catch (err) { return null; }
  }
  // an edit gesture ended (phase end / set): its snapshot is taken at the next paint (several edits of one action → one
  // step); start / move phases wait for the end
  markUndo(label, phase) {
    if (this.restoring || phase === 'start' || phase === 'move') return;
    this.undoPend = label || 'Edit';
    this.queue();
  }
  flushUndo() {
    if (this.dead) return;
    if (!this.undoPend) {
      // view-only edits ({ui: true}) that changed state outside s.ui / fx.ui (EDIT ALL, record mode, an FX instance's
      // MIX / LEVEL label …) are folded into the current undo position: no step of their own, and syncOutside does not
      // mistake them for an outside change
      // (not while a control is dragged: its value so far would become the position its undo returns to; the drag's
      // end pushes its own step, which takes the view edit's state along)
      if (this.uiRebase && !this.held.size) { this.uiRebase = false; const snap = this.snapStr(); if (snap && snap !== this.undo.top()) this.undo.retop(snap); }
      return;
    }
    const label = this.undoPend, snap = this.snapStr();
    this.undoPend = null;
    this.uiRebase = false;
    if (snap) this.undo.push(snap, label);
  }
  // The state was changed outside the panel (main.js: MIDI program change, MIDI CC, the app's project undo; refresh()
  // is how the host tells the panel): the preset key is read again (header, Init override, dirty state) and a state
  // that differs from the panel's undo position becomes an undo step of its own — 'Load preset' when the key changed —
  // so the next panel undo steps back over that change instead of restoring what was there before it (§13.2.4).
  // The panel's own pending edit (undoPend) is captured by its flush instead.
  syncOutside() {
    if (this.dead || this.restoring) return;
    const loaded = this.syncPreset();
    if (this.undoPend) return;
    this.uiRebase = false;
    const snap = this.snapStr();
    if (snap && snap !== this.undo.top()) this.undo.push(snap, loaded ? 'Load preset' : 'External change');
  }
  // the current preset key (host.presets.current) → this.lastKey; true when it changed. The key is read here
  // (refresh, the panel's own preset actions) and the list by presetList, both cached, never read per paint: main.js
  // parses its whole user-preset store on each list() / current() call. A key change ends the Init override and the
  // dirty state.
  syncPreset() {
    const pr = this.host.presets;
    let key = null;
    try { key = pr && pr.current ? pr.current() : null; } catch (err) { key = null; }
    if (key === undefined) key = null;
    const changed = this.lastKey !== undefined && key !== this.lastKey;
    if (changed) { this.dirty = false; this.nameOverride = null; this.peeks.clear(); }
    this.lastKey = key;
    this.plistChecked = false;
    return changed;
  }
  // the preset list changed (save, import, the browser's delete / rename / move / ratings): read it again when needed
  presetsChanged() {
    this.plist = null;
    if (this.browser) this.browser.invalidate();
  }
  undoRedo(redo) {
    this.flushUndo();
    this.syncOutside();
    // the step being undone / redone: a preset-like load re-seeds the FX rack's LFO phases like the load did (§4.2);
    // any other step restores without a re-seed (a re-seed ducks every sounding modulated FX module and restarts its
    // LFOs), unless the restored FX state has another instance layout
    const lab = redo ? this.undo.redoLabel() : this.undo.label();
    const snap = redo ? this.undo.redo() : this.undo.undo();
    if (!snap) { this.notify(redo ? 'Nothing to redo' : 'Nothing to undo'); return false; }
    let o = null;
    try { o = JSON.parse(snap); } catch (err) { o = null; }
    if (!o || !isObj(o.s)) return false;
    const fx = this.fx(), now = this.snapStr(), cur = now ? JSON.parse(now) : null;
    const sameS = !!cur && JSON.stringify(cur.s) === JSON.stringify(o.s);
    const sameFx = !o.fx || !fx || (!!cur && JSON.stringify(cur.fx) === JSON.stringify(o.fx));
    const seed = SEED_LABEL.test(lab || '') || (!sameFx && fxLayoutKey(fx) !== fxLayoutKey(o.fx));
    const opt = seed ? { label: 'Undo', seed: true } : { label: 'Undo' };
    this.restoring = true;
    try {
      if (!sameS) this.edit(s => { const ui = s.ui; this.replaceState(s, clone(o.s)); s.ui = ui; }, opt);
      if (!sameFx) this.editFx(f => { const ui = f.ui; this.replaceState(f, clone(o.fx)); if (ui !== undefined) f.ui = ui; }, opt);
      this.dirty = true;
      this.oscd.forget();
      this.refresh();
      if (this.rack && this.rack.refresh) this.rack.refresh();
    } finally { this.restoring = false; }
    return true;
  }

  /* ---------------------------------------------------------------- touch (§13.1) */
  detectTouch() {
    const w = this.d.defaultView || globalThis;
    let coarse = false;
    try { coarse = !!(w.matchMedia && w.matchMedia('(pointer: coarse)').matches); } catch (err) { coarse = false; }
    this.setTouch(coarse);
    this.offs.push(on(this.el, 'pointerdown', e => {
      if (e.pointerType === 'touch') { this.setTouch(true); this.touchTip(e.target); }
    }, true));
    this.offs.push(on(this.el, 'pointerup', e => { if (e.pointerType === 'touch') this.touchTipEnd(); }, true));
    this.offs.push(on(this.el, 'pointercancel', e => { if (e.pointerType === 'touch') this.touchTipEnd(); }, true));
  }
  setTouch(t) {
    if (this.touch === !!t && this.el.classList.contains('sx-touch') === !!t) return;
    this.touch = !!t;
    this.el.classList.toggle('sx-touch', this.touch);
    if (this.waveBtn) this.waveBtn.draggable = !this.touch;
  }
  // touch has no hover: the tooltip of the touched control shows in the status line under the header (§13.1)
  touchTip(t) {
    const host = closest(t, '[data-dest]'), tile = closest(t, '[data-src]');
    let text = '';
    if (host && this.el.contains(host)) text = this.tipText(host.getAttribute('data-dest'));
    else if (tile && this.el.contains(tile)) text = this.tileTip(tile.getAttribute('data-src'));
    if (!text) return;
    clearTimeout(this.tipT);
    this.tipFor = host || tile;
    this.statusEl.textContent = text;
  }
  touchTipEnd() {
    if (!this.tipFor) return;
    const el = this.tipFor;
    clearTimeout(this.tipT);
    this.tipT = setTimeout(() => {
      if (this.tipFor !== el || this.dead) return;
      this.tipFor = null;
      this.statusEl.textContent = '';
    }, 1500);
  }
  // while touching a control, its value line follows the drag
  updateTouchTip() {
    const el = this.tipFor;
    if (!el || !el.getAttribute) return;
    const id = el.getAttribute('data-dest'), t = id ? this.tipText(id) : '';
    if (t && this.statusEl.textContent !== t) this.statusEl.textContent = t;
  }

  // "Help tooltips" preference (§13.10): off — the help texts (title attributes) of the panel, its popovers and
  // overlays move to data-help (no native tooltip; the accessible names stay in aria-label); on — they come back.
  // Run after every full paint while off (bound widgets may write their titles again) and when the preference changes.
  applyHelp() {
    const r = this.el;
    if (!r || !r.querySelectorAll) return;
    if (this.prefs.helpTips) {
      for (const e of qsa(r, '[data-help]')) { e.setAttribute('title', e.getAttribute('data-help')); e.removeAttribute('data-help'); }
    } else for (const e of qsa(r, '[title]')) { e.setAttribute('data-help', e.getAttribute('title')); e.removeAttribute('title'); }
  }

  /* ---------------------------------------------------------------- widget factories */
  bind(w) { (this.bp || this.headPage).binds.push(w); return w; }
  decorate(w, idf, focusEl) {
    const el = focusEl || w.el;
    if (wk.tooltip && el) wk.tooltip(el, () => this.tipText(idf()));
    return w;
  }
  dRow(id) { return destOf(id) || rowOfDest(id, this.fx()) || DESTS[0]; }
  dKnob(id, label, opt) {
    const O = opt || {}, idf = fnOf(id), d0 = this.dRow(idf());
    const o = {
      dest: idf, label,
      get: () => this.getN(idf()),
      set: (n, ph) => this.setN(idf(), n, ph),
      def: () => this.dRow(idf()).def,
      fmt: n => this.fmt(idf(), n),
      parse: t => this.parse(idf(), t),
      steps: stepsOf(d0), size: O.size || 'md', bipolar: d0.ctr === 1,
      disabled: O.disabled, detents: O.detents,
    };
    if (O.labelFn) Object.defineProperty(o, 'label', { get: O.labelFn, enumerable: true });
    if (!O.bipolarFn) return this.bind(this.decorate(wk.knob(o), idf));
    // dynamic bipolar arc (WARP, §9.3): wk.knob redraws its value arc only when the value changes, so a flip of
    // the flag at an unchanged value redraws through a one-off nudged value, then the true one
    let bip = !!O.bipolarFn(), nudge = false;
    const get0 = o.get;
    o.get = () => { const n = get0(); return nudge ? (n > 0.5 ? n - 1e-6 : n + 1e-6) : n; };
    Object.defineProperty(o, 'bipolar', { get: () => bip, enumerable: true });
    const w = this.bind(this.decorate(wk.knob(o), idf));
    this.custom(() => {
      const b = !!O.bipolarFn();
      if (b === bip) return;
      bip = b;
      nudge = true; w.update();
      nudge = false; w.update();
    });
    return w;
  }
  dToggle(id, label, kind, opt) {
    const O = opt || {}, idf = fnOf(id);
    const w = wk.toggle({ dest: idf, label, kind: kind || 'led', get: () => (this.getN(idf()) >= 0.5 ? 1 : 0),
      set: v => this.setN(idf(), v ? 1 : 0, 'set'), disabled: O.disabled });
    if (O.module) w.el.setAttribute('data-module', O.module);
    return this.bind(this.decorate(w, idf));
  }
  dMenu(id, label, items, opt) {
    const O = opt || {}, idf = fnOf(id);
    const w = wk.menu({ dest: idf, label, items, get: () => this.getN(idf()), set: v => this.setN(idf(), v, 'set'),
      arrows: O.arrows !== false, wheel: true });
    return this.bind(this.decorate(w, idf, w.el.querySelector ? w.el.querySelector('.wk-mbtn') : null));
  }
  dNum(id, label, opt) {
    const O = opt || {}, idf = fnOf(id), d = this.dRow(idf());
    let w;
    if (typeof wk.numBox === 'function') {
      w = wk.numBox({ dest: idf, label, get: () => this.getN(idf()), set: (n, ph) => this.setN(idf(), n, ph), def: d.def,
        fmt: n => this.fmt(idf(), n), parse: t => this.parse(idf(), t), steps: stepsOf(d), disabled: O.disabled });
    } else {
      w = numField(this.d, { dest: idf, label, min: d.lo, max: d.hi, step: 1, def: core.lawValue(d.id, d.def), disabled: O.disabled,
        get: () => core.lawValue(idf(), this.getN(idf())), set: (v, ph) => this.setN(idf(), core.lawNorm(idf(), v), ph),
        fmt: v => this.fmt(idf(), core.lawNorm(idf(), v)), parse: t => { const n = this.parse(idf(), t); return n === null ? null : core.lawValue(idf(), n); } });
    }
    if (O.cls) w.el.classList.add(O.cls);
    return this.bind(this.decorate(w, idf, w.el.querySelector ? w.el.querySelector('.sx-nfv, [tabindex]') : null));
  }
  // segmented switch bound to an enum / int / bool destination: one button per step (labels O.items, else the
  // formatted values)
  dSeg(id, opt) {
    const O = opt || {}, idf = fnOf(id), grid = () => gridOf(this.dRow(idf()));
    const labels = () => Array.from({ length: grid() + 1 }, (_, k) => this.fmt(idf(), k / grid()));
    const w = wk.seg({ dest: idf, label: O.label || '', items: O.items || labels, disabled: O.disabled,
      get: () => Math.round(this.getN(idf()) * grid()), set: i => this.setN(idf(), grid() ? i / grid() : 0, 'set') });
    return this.bind(this.decorate(w, idf));
  }
  pKnob(o) { return this.bind(wk.knob(Object.assign({ size: 'md' }, o))); }
  pToggle(o) { return this.bind(wk.toggle(Object.assign({ kind: 'led' }, o))); }
  pNum(o) { return this.bind(numField(this.d, o)); }
  pSeg(o) { return this.bind(segField(this.d, o)); }
  slider(o) {
    const w = typeof wk.slider === 'function' ? wk.slider(o) : hSlider(this.d, o);
    return this.bind(w);
  }
  custom(update) { return this.bind({ update }); }
  enumItems(id, labels, groups) {
    const d = destOf(id), hi = gridOf(d);
    return labels.map((label, k) => ({ v: k / hi, label, group: groups ? groups[k] : undefined }));
  }
  row(...els) { const r = mk(this.d, 'div', 'sx-krow'); r.append(...els.filter(Boolean)); return r; }

  /* ---------------------------------------------------------------- tooltips */
  tipText(id) {
    const s = this.s(), fx = this.fx();
    if (!s || !rowOfDest(id, fx)) return '';
    let lab = id;
    try { lab = core.destLabel(id, s, fx); } catch (err) { lab = id; }
    const lines = [lab + ': ' + this.fmt(id, this.getN(id))];
    const r = rowOfDest(id, fx);
    if (r && r.nomod) lines.push('reshapes the IR — not modulatable');
    return lines.concat(modTipLines(s, id)).join('\n');
  }
  tileTip(src) {
    const s = this.s(), ds = tileDests(s, src), fx = this.fx();
    const lab = id => { try { return core.destLabel(id, s, fx); } catch (err) { return id; } };
    return srcLabel(s, src) + (ds.length ? '\n' + ds.map(id => '→ ' + lab(id)).join('\n') : '\nDrag onto a control to modulate it');
  }

  /* ---------------------------------------------------------------- refresh / snapshot */
  queue() {
    if (this.queued || this.dead) return;
    this.queued = true;
    this.raf(() => { this.queued = false; if (!this.dead) this.paint(true); });
  }
  refresh() {
    if (this.dead) return;
    this.syncOutside();
    this.fc = null;
    this.edDirty = true;
    this.paint(true);
    if (this.page === 'fx' && this.rack && this.rack.refresh) this.rack.refresh();
  }
  allPages() { return [this.headPage, this.footPage].concat(PAGES.map(p => this.pages[p]).filter(Boolean)); }
  shownPages() { const P = this.pages[this.page]; return [this.headPage].concat(P ? [P] : [], [this.footPage]); }
  paint(full) {
    const s = this.s();
    if (!s || this.dead) return;
    // C1: a module that went live drops its peek on any page (only the shown page's panels repaint), so powering it
    // on and off again elsewhere (MIX strip, MATRIX row) folds it again
    if (this.peeks.size) { const fx = this.fx(); for (const id of this.peeks) if (powerLive(s, fx, id)) this.peeks.delete(id); }
    this.fc = null;
    this.paintSeq = (this.paintSeq || 0) + 1;
    const shown = this.shownPages();
    for (const P of shown) for (const w of P.binds) w.update();
    if (full || this.edDirty) {   // graph editors redraw when their inputs changed (signature) or on demand
      const force = this.edDirty;
      this.edDirty = false;
      const eds = [];
      for (const P of shown) eds.push(...P.editors);
      if (this.pop && this.pop.ed) eds.push(this.pop.ed);
      if (this.big && this.big.ed) eds.push(this.big.ed);
      for (const ed of eds) {
        if (!ed || !ed.refresh) continue;
        const f = this.edSig.get(ed), k = f ? f() : null;
        if (force || k === null || k !== this.edKey.get(ed)) { this.edKey.set(ed, k); ed.refresh(); }
      }
    }
    if (full && this.rackDirty && this.page === 'fx' && this.rack && this.rack.refresh) { this.rackDirty = false; this.rack.refresh(); }
    if (full) { this.scanMods(); if (!this.prefs.helpTips) this.applyHelp(); }
    this.paintMods(full);
    this.paintCanvases();
    this.updateVoices();
    this.checkCapture();
    this.updateTouchTip();
    this.flushUndo();
  }
  setSnapshot(msg) {
    this.smon = msg || null;
    this.snap = msg && msg.s ? msg.s : null;
    const nn = this.snap && this.snap.notes > 0 ? 1 : 0;
    if (nn && !this.snapNotes) this.noteGroup++;   // a new note group starts (the header render cache is stale)
    this.snapNotes = nn;
    this.snapSeq = (this.snapSeq || 0) + 1;
    if (this.ticking || this.dead) return;
    const now = Date.now();
    if (wk.reducedMotion && wk.reducedMotion() && now - this.snapT < 100) return;   // §9.1: 10 fps under reduced motion
    this.snapT = now;
    this.ticking = true;
    this.raf(() => {
      this.ticking = false;
      if (this.dead || !this.s()) return;
      this.paintMods(false);
      this.paintCanvases();
      this.updateVoices();
      this.checkCapture();
    });
  }
  scanMods() {
    const roots = [this.head, this.footEl], P = this.pages[this.page];
    if (P) roots.push(P.el);
    if (this.pop && this.pop.box) roots.push(this.pop.box);
    const s = this.s(), fx = this.fx(), L = s && s.locks ? s.locks : {}, locked = new Set(arr(L.p));
    const lockedMod = new Set(arr(L.mod)), unp = new Set(arr(L.unp));
    // eff indices depend on the FX layout only (fxDest walks the rack): memoised per layout key
    let lk = '';
    try { lk = fx && typeof core.fxLayout === 'function' ? core.fxLayout(fx).key : ''; } catch (err) { lk = ''; }
    if (lk !== this.effKey || !this.effMemo) { this.effKey = lk; this.effMemo = new Map(); }
    const M = this.effMemo, ei = id => { if (!M.has(id)) M.set(id, effIdx(id, fx)); return M.get(id); };
    this.modEls = [];
    for (const r of roots) {
      if (!r) continue;
      for (const el of qsa(r, '[data-dest]')) {
        const id = el.getAttribute('data-dest');
        const dm = destModule(id), inLocked = !!(dm && lockedMod.has(dm) && !unp.has(id));
        el.classList.toggle('sx-locked-ctl', locked.has(id) || inLocked);
        if (!el.wk || typeof el.wk.setMod !== 'function' || !rowOfDest(id, fx)) continue;
        this.modEls.push({ el, id, i: ei(id), arcs: null, had: true });
      }
    }
  }
  paintMods(full) {
    const s = this.s(), fx = this.fx(), sel = s.ui ? s.ui.mod : '', eff = this.snap && this.snap.eff;
    for (const m of this.modEls) {
      if (full || !m.arcs) m.arcs = haloArcs(s, fx, m.id, sel);
      if (!m.arcs.length) { if (m.had) { m.el.wk.setMod(null); m.had = false; } continue; }
      m.el.wk.setMod({ arcs: m.arcs, live: eff && m.i >= 0 && fin(eff[m.i]) ? eff[m.i] : null });
      m.had = true;
    }
  }
  updateVoices() {
    if (this.vcEl) {
      const s = this.s(), sn = this.snap;
      const on = id => (this.getN(id) >= 0.5 ? 1 : 0), poly = s.voicing && s.voicing.mono ? 1 : (s.voicing ? s.voicing.poly : 8);
      const x = sn ? sn.oscVoices | 0 : 0;
      const y = sn ? sn.maxVoices | 0 : poly * (16 * (on('a.on') + on('b.on') + on('c.on')) + on('s.on') + on('n.on'));
      const t = x + ' / ' + y;
      if (this.vcText !== t) {
        this.vcText = t;
        this.vcEl.textContent = '';
        this.vcEl.append(mk(this.d, 'b', '', String(x)), ' / ' + y);
        this.vcEl.setAttribute('aria-label', 'Voices ' + x + ' of ' + y);
      }
    }
    // output meter: the Main channel peak of the snapshot (mix[9], dBFS over the last span, §6.20)
    if (this.meter) {
      const mx = this.snap && this.snap.mix, v = mx && mx.length > 9 && fin(mx[9]) ? mx[9] : -Infinity;
      if (v !== this.meterV) { this.meterV = v; this.meter.set(v); }
    }
    // live callbacks (kit.live) of every page, told whether their page is on screen (§13.1: hidden pages are not painted;
    // a callback may still carry functional work, e.g. the CLIP page's recording)
    const shown = this.shownPages();
    for (const P of this.allPages()) { const on = shown.includes(P); for (const f of P.lives) f(on); }
    if (this.pop && this.popPage) for (const f of this.popPage.lives) f(true);
  }
  // the phase-memory menus of the oscillators and their memSet arrays (before an edit; armPhMem compares after it)
  phMemOf() {
    const s = this.s();
    return s && Array.isArray(s.osc) ? s.osc.map(O => (isObj(O) ? { O, mem: O.phMem, set: O.memSet } : null)) : null;
  }
  // an edit of this panel (or a sub-panel through the kit) switched an oscillator's phase memory to Per Voice and left
  // its memSet alone (a paste / swap / init brings its own): armed for the S2 capture of checkCapture (§6.4)
  armPhMem(pre) {
    const s = this.s();
    if (!pre || !s || !Array.isArray(s.osc)) return;
    pre.forEach((q, o) => {
      const O = s.osc[o];
      if (q && o < N_OSC && O === q.O && O.phMem === 'voice' && q.mem !== 'voice' && O.memSet === q.set) this.capArm[o] = true;
    });
  }
  // phase capture (§6.4, captureDue): S1 mode, OSC A / B — base RAND crossing 0.9995 upwards while PHASE is Mem; S2
  // mode and OSC C — phase memory switched to Per Voice; both while notes sound. Only the user's own edits on this panel
  // count (capArm, set by setN for RAND and by edit for phMem): a state replaced by a preset load, a program change or
  // an undo can make the same change, and must keep the memSet it brings. The capture edit lands in the same panel
  // undo step as the edit that triggered it (one flush per paint).
  checkCapture() {
    const s = this.s(), p = s.p, cur = { p: {}, osc: arr(s.osc).map(O => ({ phMem: isObj(O) ? O.phMem : undefined })), global: { s1: s1On(s) ? 1 : 0 } };
    for (const k of OSC_P) { cur.p[k + '.phase'] = p[k + '.phase']; cur.p[k + '.rand'] = p[k + '.rand']; }
    const arm = this.capArm, due = captureDue(this.capPrev, cur, this.snap ? this.snap.notes : 0).filter(o => arm[o]);
    this.capPrev = cur;
    arm.fill(false);
    const mem = this.snap && this.snap.memNow;
    if (!due.length || !mem) return;
    const ok = due.filter(o => mem.length >= (o + 1) * 16);
    if (!ok.length) return;
    this.edit(st => {
      for (const o of ok) st.osc[o].memSet = Array.from({ length: 16 }, (_, i) => Math.round(frac(mem[o * 16 + i]) * 1e6) / 1e6 % 1);
    }, { label: 'Capture phases' });
    this.notify('Captured unison phases');
  }

  /* ---------------------------------------------------------------- canvases */
  canvas(cls, key, draw, extra) {
    const c = mk(this.d, 'canvas', 'sx-disp' + (cls ? ' ' + cls : ''));
    const cv = Object.assign({ el: c, key, draw, last: null, sized: false, w: 0, h: 0, dpr: 1 }, extra);
    (this.bp || this.headPage).canvases.push(cv);
    if (this.ro) this.ro.observe(c);
    return cv;
  }
  paintCanvases() {
    const P = this.pages[this.page];
    if (P) for (const cv of P.canvases) this.paintCanvas(cv);
    for (const cv of this.footPage.canvases) this.paintCanvas(cv);
  }
  paintCanvas(cv) {
    if (!cv.sized) {
      // device-pixel ratio capped at 2 (§13.1)
      const r = cv.el.getBoundingClientRect(), dpr = Math.min(2, (this.d.defaultView && this.d.defaultView.devicePixelRatio) || 1);
      cv.sized = true;
      // a canvas in a hidden subtree (display: none — another oscillator type's view, a panel of a narrow layout) is
      // neither drawn nor measured again until it is shown: the ResizeObserver (its box leaves 0 × 0) or showPage
      // clear `sized` (§13.1 hidden content is not painted; displays redraw only on change)
      cv.hid = !(r.width > 0 && r.height > 0);
      if (cv.hid) { if (!this.ro) cv.sized = false; return; }   // no ResizeObserver: measured on every paint instead
      // drawn for its layout box (the canvas world may scale the panel: the rect is screen px) at the device ratio × the
      // zoom, clamped to 0.5…2 and ≤ 16e6 px (SPEC-canvas §4.4): lines and text keep their size against the panel
      const ls = wk.localScale(cv.el), lw = cv.el.clientWidth || r.width * ls, lh = cv.el.clientHeight || r.height * ls;
      let q = ls === 1 ? dpr : Math.min(2, Math.max(0.5, dpr / ls));
      if (lw * lh * q * q > 16e6) q = Math.sqrt(16e6 / (lw * lh));
      const w = Math.max(1, Math.round(lw * q)), h = Math.max(1, Math.round(lh * q));
      if (cv.el.width !== w || cv.el.height !== h) { cv.el.width = w; cv.el.height = h; }
      cv.w = w; cv.h = h; cv.dpr = q; cv.last = null;
    }
    if (cv.hid) return;
    let k;
    try { k = cv.key(); } catch (err) { k = Math.random(); }
    if (k === cv.last) return;
    cv.last = k;
    const g = cv.el.getContext ? cv.el.getContext('2d') : null;
    if (!g) return;
    try {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.w, cv.h);
      cv.draw(g, cv.w, cv.h, cv.dpr);
    } catch (err) { warnOnce('draw' + cv.el.className, 'serum-ui: display draw failed', err); }
  }

  /* ---------------------------------------------------------------- header (§13.2) */
  buildHead() {
    const d = this.d, H = mk(d, 'div', 'sx-head');
    this.head = H;
    this.bp = this.headPage;
    // wave icon: render the last played note group (§13.2.5); Shift: download the preset; Alt: the Renders folder
    const wave = btn(d, 'sx-hbtn sx-wave', icon(d, 'wave'), 'Render the last played notes to a WAV file (Shift: download the preset; Alt: open Renders)', e => {
      // the click that ends a drag acted on in dragstart (below) renders nothing more
      if (Date.now() - this.waveDragT < 1000) { this.waveDragT = -1e9; return; }
      this.renderLast(e);
    });
    // drag-export (§13.2.5, deviation 21): a desktop drag hands the most recent render of the current note group and
    // patch to the drop target through the DownloadURL drag type (Chromium: into a DAW or a folder); while there is
    // none (nothing rendered yet, a newer note group, an edit since), or with Shift / Alt, the drag acts as a click.
    // Touch devices keep the plain button (long-press = menus).
    wave.draggable = !this.touch;
    wave.addEventListener('dragstart', e => {
      const m = wk.modifierBar && wk.modifierBar.mods ? wk.modifierBar.mods(e) : { alt: !!e.altKey, shift: !!e.shiftKey };
      const R = this.lastRender, dt = e.dataTransfer;
      if (R && !m.alt && !m.shift && R.notes === this.noteGroup && R.edits === this.editSeq && dt && typeof dt.setData === 'function') {
        try {
          dt.setData('DownloadURL', R.type + ':' + R.name + ':' + R.url);
          dt.setData('text/uri-list', R.url);
          dt.effectAllowed = 'copy';
          return;
        } catch (err) { /* no DownloadURL support: a click */ }
      }
      e.preventDefault();
      this.waveDragT = Date.now();
      this.renderLast(e);
    });
    this.waveBtn = wave;
    this.waveDragT = -1e9;
    const tabs = mk(d, 'div', 'sx-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Synth pages');
    this.tabBtns = {};
    PAGES.forEach((p, i) => {
      const b = btn(d, 'sx-tab', PAGE_LABEL[p], null, () => this.setPage(p));
      b.setAttribute('role', 'tab');
      b.setAttribute('data-page', p);
      b.id = this.uid + '-tab-' + p;
      b.setAttribute('aria-controls', this.uid + '-page-' + p);
      b.addEventListener('keydown', e => {
        const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        const q = PAGES[(i + k + PAGES.length) % PAGES.length];
        this.setPage(q);
        this.tabBtns[q].focus();
      });
      tabs.appendChild(b);
      this.tabBtns[p] = b;
    });
    const pa = mk(d, 'div', 'sx-preset');
    const save = btn(d, 'sx-hbtn', icon(d, 'save'), 'Save preset (Alt-click: overwrite)', e => this.savePresetUI(e));
    const prev = btn(d, 'sx-hbtn', '◀', 'Previous preset in category', () => this.stepPresetUI(-1));
    const name = btn(d, 'sx-hbtn sx-pname', '', 'Browse presets', () => this.browser.open());
    const next = btn(d, 'sx-hbtn', '▶', 'Next preset in category', () => this.stepPresetUI(1));
    const info = btn(d, 'sx-hbtn', icon(d, 'info'), 'Artist, description and tags', () => this.authorDialog());
    pa.append(save, prev, name, next, info);
    this.custom(() => {
      // the key and the list are cached (syncPreset: refresh() and the panel's own preset actions), not read per paint
      const cur = this.currentPreset(), nm = cur ? cur.name : this.nameOverride || 'Init';
      const t = (cur && cur.cat ? cur.cat + ' · ' : '') + nm + (this.dirty ? ' *' : '');
      if (name.textContent !== t) {
        name.textContent = '';
        if (cur && cur.cat) name.appendChild(mk(d, 'span', 'sx-pcat', cur.cat));
        name.appendChild(mk(d, 'span', this.dirty ? 'sx-dirty' : '', nm));
        name.setAttribute('aria-label', 'Preset ' + nm + (this.dirty ? ' (edited)' : '') + ', browse presets');
      }
    });
    // panel undo / redo (§13.2.4)
    const ur = mk(d, 'div', 'sx-undo');
    const ub = btn(d, 'sx-hbtn', icon(d, 'undo'), 'Undo (Cmd/Ctrl-Z)', () => this.undoRedo(false));
    const rb = btn(d, 'sx-hbtn', icon(d, 'redo'), 'Redo (Shift-Cmd/Ctrl-Z)', () => this.undoRedo(true));
    ur.append(ub, rb);
    this.custom(() => {
      ub.disabled = !this.undo.canUndo() && !this.undoPend;
      rb.disabled = !this.undo.canRedo();
      const ul = this.undo.label(), rl = this.undo.redoLabel();
      ub.title = 'Undo' + (ul ? ' ' + ul : '') + ' (Cmd/Ctrl-Z)';
      rb.title = 'Redo' + (rl ? ' ' + rl : '') + ' (Shift-Cmd/Ctrl-Z)';
    });
    const menuB = btn(d, 'sx-hbtn', 'Menu', 'Main menu', () => this.mainMenu(menuB));
    menuB.setAttribute('aria-haspopup', 'menu');
    // touch modifier latches (wk.modifierBar; shown on touch devices, §13.1)
    let mkeys = null;
    if (typeof wk.modifierBar === 'function') {
      try { mkeys = wk.modifierBar({}); mkeys.el.classList.add('sx-mkeys'); this.mkeys = mkeys; } catch (err) { mkeys = null; }
    }
    this.vcEl = mk(d, 'span', 'sx-vc');
    this.vcEl.title = 'Oscillator voices sounding (grains included) / maximum';
    const master = mk(d, 'div', 'sx-master');
    master.appendChild(this.dKnob('g.master', 'MASTER', { size: 'sm' }).el);
    if (typeof wk.meter === 'function') {
      try { this.meter = wk.meter({ ch: 1, label: 'Output', floor: -60, top: 6 }); master.appendChild(this.meter.el); } catch (err) { this.meter = null; }
    }
    H.append(wave, logo(d), tabs, pa, ur, menuB);
    if (mkeys) H.appendChild(mkeys.el);
    H.append(this.vcEl, master);
    this.el.appendChild(H);
    this.bp = null;
  }
  setPage(p) {
    if (!PAGES.includes(p)) p = 'osc';
    const s = this.s();
    if (s && s.ui && s.ui.page !== p) this.uiEdit(st => { st.ui.page = p; });
    this.showPage(p);
  }
  showPage(p) {
    this.page = p;
    if (!this.pages[p]) {
      const el = mk(this.d, 'div', 'sx-page sx-page-' + p);
      el.id = this.uid + '-page-' + p;
      el.setAttribute('role', 'tabpanel');
      el.setAttribute('aria-labelledby', this.uid + '-tab-' + p);
      const P = mkPage(el);
      this.pages[p] = P;
      this.pageBox.appendChild(el);
      this.bp = P;
      try {
        if (p === 'osc') this.buildOsc(el);
        else if (p === 'mix') this.buildMix(el);
        else if (p === 'fx') this.buildFx(el);
        else if (p === 'matrix') this.buildMatrix(el);
        else if (p === 'arp' || p === 'clip') this.buildSeq(el, p);
        else this.buildGlobal(el);
      } catch (err) {
        console.error('serum-ui: page ' + p, err);
        el.appendChild(mk(this.d, 'p', 'sx-placeholder', 'This page could not be built (' + (err && err.message) + ')'));
      } finally { this.bp = null; }
    }
    for (const k of PAGES) {
      const b = this.tabBtns[k], sel = k === p;
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      b.tabIndex = sel ? 0 : -1;
      if (this.pages[k]) this.pages[k].el.classList.toggle('sx-hidden', !sel);
    }
    for (const cv of this.pages[p].canvases) cv.sized = false;
    this.edDirty = true;
    this.paint(true);
    if (p === 'fx' && this.rack && this.rack.refresh) this.rack.refresh();
  }
  // the keyboard panel under every page (§13.9; sx-ui-seq KeyboardPanel), collapsible to a 40 px strip
  buildFoot() {
    this.footEl = mk(this.d, 'div', 'sx-foot');
    this.el.appendChild(this.footEl);
    this.footPage.el = this.footEl;
    if (typeof seq.KeyboardPanel !== 'function') return;
    this.bp = this.footPage;
    try { this.kbd = new seq.KeyboardPanel(this.footEl, this.kit); } catch (err) { console.error('serum-ui: keyboard panel', err); this.kbd = null; } finally { this.bp = null; }
  }

  /* ---------------------------------------------------------------- presets in the header (§9.10, §13.11) */
  // host.presets.list(), cached until presetsChanged (save, import, the browser's changes)
  presetList() {
    if (!this.plist) { const pr = this.host.presets; this.plist = pr && pr.list ? arr(pr.list()) : []; }
    return this.plist;
  }
  // the current preset's row; a key missing from the cached list (a preset saved or imported outside the panel) reads
  // the list again, once per syncPreset
  currentPreset() {
    const k = this.lastKey;
    if (this.nameOverride || k === null || k === undefined) return null;
    let r = this.presetList().find(p => p.key === k) || null;
    if (!r && !this.plistChecked) { this.plistChecked = true; this.plist = null; r = this.presetList().find(p => p.key === k) || null; }
    return r;
  }
  confirmChange() {
    if (!this.prefs.askPreset || !this.dirty) return true;
    const cur = this.currentPreset(), nm = cur ? cur.name : this.nameOverride || 'Init';
    return askConfirm(this.d, 'Discard changes to “' + nm + '”?');
  }
  loadPreset(key) {
    const pr = this.host.presets;
    if (!pr || !pr.load || key === null || key === undefined) return false;
    pr.load(key);
    this.dirty = false;
    this.nameOverride = null;
    this.oscd.forget();
    this.peeks.clear();
    this.markUndo('Load preset');
    this.refresh();
    return true;
  }
  stepPresetUI(dir) {
    const pr = this.host.presets;
    if (!pr || !pr.load) return;
    const list = sortPresets(this.browser.rows(), this.browser.state()), cur = this.currentPreset();
    const key = stepPreset(list, cur ? cur.key : null, dir, cur ? cur.cat : null);
    if (key === null || (cur && key === cur.key) || !this.confirmChange()) return;
    this.loadPreset(key);
  }
  // Save (Alt-click / Alt latch: overwrite the current user preset silently, §13.11)
  savePresetUI(e) {
    const alt = !!(e && (e.altKey || (wk.modifierBar && wk.modifierBar.mods && wk.modifierBar.mods(e).alt)));
    const pr = this.host.presets, cur = this.currentPreset();
    if (alt && pr && pr.save && cur && cur.user) {
      if (wk.modifierBar && wk.modifierBar.consume) wk.modifierBar.consume();
      pr.save({ name: cur.name, cat: cur.cat || 'User', overwrite: true });
      this.dirty = false;
      this.nameOverride = null;
      this.notify('Saved “' + cur.name + '”');
      this.presetsChanged();
      this.refresh();
      return;
    }
    this.savePresetDialog();
  }
  savePresetDialog() {
    const pr = this.host.presets;
    if (!pr || !pr.save) { this.notify('Saving presets is not available'); return; }
    const d = this.d, cur = this.currentPreset(), body = mk(d, 'div');
    const nameI = mk(d, 'input'), catI = mk(d, 'input'), dl = mk(d, 'datalist');
    nameI.type = 'text'; nameI.maxLength = 64; nameI.value = cur ? cur.name : this.nameOverride || 'Init';
    catI.type = 'text'; catI.maxLength = 32; catI.value = cur && cur.cat ? cur.cat : 'User';
    dl.id = this.uid + '-cats';
    catI.setAttribute('list', dl.id);
    for (const c of presetCats(this.presetList())) { const o = mk(d, 'option'); o.value = c; dl.appendChild(o); }
    const l1 = mk(d, 'label', '', 'Name'), l2 = mk(d, 'label', '', 'Category (pick or type a new one)');
    l1.appendChild(nameI); l2.append(catI, dl);
    body.append(l1, l2);
    this.dialog('Save Preset', body, [
      { label: 'Cancel' },
      { label: 'Save', primary: true, action: () => {
        const name = nameI.value.trim();
        if (!name) { nameI.focus(); return false; }
        const nm = name.slice(0, 64); // (the host's limit)
        if (this.presetList().some(p => p.user && p.name === nm) && !askConfirm(d, 'Replace the saved preset “' + nm + '”?')) { nameI.focus(); return false; }
        pr.save({ name, cat: catI.value.trim() || 'User' });
        this.dirty = false;
        this.nameOverride = null;
        this.presetsChanged();
        this.refresh();
        return true;
      } },
    ]);
  }
  revertPreset() {
    const pr = this.host.presets, k = pr && pr.current ? pr.current() : null;
    if (k === null || k === undefined || !pr.load) { this.notify('Nothing to revert to'); return; }
    if (!this.confirmChange()) return;
    this.loadPreset(k);
    this.notify('Reverted to the saved preset');
  }
  // ARTIST / DESC (§13.2 header, §13.11): author, description (notes) and tags of the sound
  authorDialog() {
    const d = this.d, s = this.s(), body = mk(d, 'div');
    const a = mk(d, 'input'), n = mk(d, 'textarea'), t = mk(d, 'input');
    a.type = 'text'; a.maxLength = 64; a.value = s.author || '';
    n.maxLength = 2000; n.value = s.notes || '';
    t.type = 'text'; t.maxLength = 400; t.value = arr(s.tags).join(', ');
    const l1 = mk(d, 'label', '', 'Artist'), l2 = mk(d, 'label', '', 'Description'), l3 = mk(d, 'label', '', 'Tags (comma separated)');
    l1.appendChild(a); l2.appendChild(n); l3.appendChild(t);
    body.append(l1, l2, l3);
    this.dialog('Preset Info', body, [
      { label: 'Cancel' },
      { label: 'Done', primary: true, action: () => {
        const au = a.value.slice(0, 64), no = n.value.slice(0, 2000), tg = tagList(t.value.split(',')).slice(0, 16), st = this.s();
        if (au !== st.author || no !== st.notes || JSON.stringify(tg) !== JSON.stringify(arr(st.tags))) {
          this.edit(x => { x.author = au; x.notes = no; x.tags = tg; }, { label: 'Preset info' });
        }
        return true;
      } },
    ]);
  }
  // Hybridize (§13.11, inv B25): the parents' preset objects → serum-core hybridize → applied like a preset load (locks
  // hold); the sound is named "Hybrid" until saved
  hybridize(keys, favor) {
    if (!this.need('hybridize')) return false;
    const pr = this.host.presets, get = k => {
      if (pr && typeof pr.get === 'function') { try { const p = pr.get(k); if (p) return p; } catch (err) { /* host */ } }
      const m = /^f:(.*)$/.exec(String(k));
      return m ? arr(core.FACTORY_PRESETS).find(p => p && p.name === m[1]) || null : null;
    };
    // keys[0] is the favoured preset (hybridPick). A preset the host cannot hand over (a user preset without
    // host.presets.get) is skipped with a notice — and when it is the favoured one, Hybridize Favoring refuses rather
    // than favouring another parent; favor = the favoured parent's index among the resolved ones.
    const want = arr(keys), got = want.map(k => ({ k, p: get(k) })).filter(x => x.p), parents = got.map(x => x.p);
    const skipped = want.length - parents.length;
    let fav;
    if (favor) {
      fav = got.findIndex(x => x.k === want[0]);
      if (fav < 0) { this.notify('Hybridize: the selected preset cannot be read here'); return false; }
    }
    if (parents.length < 2) { this.notify('Hybridize needs at least two presets' + (skipped ? ' (' + skipped + ' could not be read)' : '')); return false; }
    if (!this.confirmChange()) return false;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    let res = null;
    try { res = core.hybridize(parents, { seed, favor: favor ? fav : undefined }); } catch (err) { console.error(err); res = null; }
    if (!res || !res.s) { this.notify('Hybridize failed'); return false; }
    const next = core.applyPreset(this.s(), { name: 'Hybrid', v: { s: res.s }, fx: res.fx }, { midiFromPreset: this.prefs.midiFromPreset });
    // FX (v2 rule, §11.2): applyPresetFx with the new Serum state — its rows follow renamed instances (rewritten in place
    // before the state is applied), locked racks and locked parameters keep theirs
    let nf = null;
    if (this.fx() && res.fx && core.applyPresetFx) { try { nf = core.applyPresetFx(this.fx(), res.fx, next); } catch (err) { nf = null; } }
    this.edit(s => { const ui = s.ui; this.replaceState(s, next); s.ui = ui; }, { label: 'Hybridize', seed: true });
    if (nf) this.editFx(f => { const fui = f.ui; this.replaceState(f, nf); if (fui !== undefined) f.ui = fui; }, { label: 'Hybridize', seed: true });
    this.nameOverride = 'Hybrid';
    this.dirty = true;
    this.oscd.forget();
    this.refresh();
    this.notify('Hybrid of ' + parents.map(p => p.name).join(', ') + (skipped ? ' (' + skipped + ' preset' + (skipped > 1 ? 's' : '') + ' could not be read)' : ''));
    return true;
  }

  /* ---------------------------------------------------------------- render last note (§13.2.5) */
  renderLast(e) {
    const m = wk.modifierBar && wk.modifierBar.mods ? wk.modifierBar.mods(e) : { alt: !!(e && e.altKey), shift: !!(e && e.shiftKey) };
    if (wk.modifierBar && wk.modifierBar.consume) wk.modifierBar.consume();
    if (m.alt) { this.rendersMenu(e && e.currentTarget); return; }
    if (typeof this.host.renderLast !== 'function') { this.notify('Rendering is not available'); return; }
    if (!m.shift) this.notify('Rendering…');
    // a render the host hands back ({name, blob} or {name, url}; optional — §11.15 only promises the download) is kept
    // for the drag-export of the same note group and patch (deviation 21)
    const notes = this.noteGroup, edits = this.editSeq;
    Promise.resolve(this.host.renderLast({ shift: !!m.shift })).then(r => { if (!m.shift && !this.dead) this.keepRender(r, notes, edits); },
      err => this.notify((err && err.message) || 'Play a note first'));
  }
  keepRender(r, notes, edits) {
    if (!isObj(r) || typeof r.name !== 'string') return;
    const U = (this.d.defaultView && this.d.defaultView.URL) || globalThis.URL;
    let url = typeof r.url === 'string' ? r.url : null, own = false;
    if (!url && r.blob && U && typeof U.createObjectURL === 'function') { try { url = U.createObjectURL(r.blob); own = true; } catch (err) { url = null; } }
    if (!url) return;
    this.dropRender();
    const name = /\.wav$/i.test(r.name) ? r.name : r.name + '.wav';
    this.lastRender = { name: name.replace(/:/g, ' '), url, own, type: (r.blob && r.blob.type) || 'audio/wav', notes, edits };
  }
  dropRender() {
    const R = this.lastRender, U = (this.d.defaultView && this.d.defaultView.URL) || globalThis.URL;
    this.lastRender = null;
    if (R && R.own && U && typeof U.revokeObjectURL === 'function') { try { U.revokeObjectURL(R.url); } catch (err) { /* revoked */ } }
  }
  // Alt-click on the wave icon: the Renders folder of the sample store → load into the selected oscillator as a Sample
  rendersMenu(anchor) {
    const S = this.host.smp, o = this.selOsc();
    const list = S && typeof S.list === 'function' ? arr(S.list('sample')).filter(x => x && x.folder === 'Renders') : [];
    const items = list.length ? list.map(x => ({ label: x.name, action: () => this.edit(s => {
      const O = s.osc[o];
      if (!['sample', 'gran', 'spec'].includes(O.type)) O.type = 'sample';
      O.smp = x.id;
    }, { label: 'Load render' }) })) : [{ label: '(no renders yet)', disabled: true }];
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, bottom: 0 };
    wk.contextMenu(r.left, r.bottom + 2, [{ label: 'Renders → OSC ' + OSC_L[o], disabled: true }, { sep: true }].concat(items), { anchor });
  }
  selOsc() { const s = this.s(), o = s && s.ui ? s.ui.osc | 0 : 0; return o >= 0 && o < N_OSC ? o : 0; }
  // C1: 'live' | 'peek' | 'fold' of a module power id, from the patch (never from DOM classes, so the order of the
  // repaint binds does not matter); a live module drops its peek, so powering it off again folds it
  foldOf(id) {
    if (powerLive(this.s(), this.fx(), id)) { this.peeks.delete(id); return 'live'; }
    return this.peeks.has(id) ? 'peek' : 'fold';
  }
  // C1: the oscillator / filter a tabbed layout shows: the selected one (s.ui.oscTab / filtTab) unless it is folded
  // and another module of its column is not — then the one shown most recently that still is expanded (closing a
  // peek or undoing a power-on goes back to the tab that was showing), else the first expanded. Derived per paint,
  // never written back; the recent list (tabSeen) is this panel's view state only, as the peeks
  tabOf(kind) {
    const u = this.s().ui || {}, ids = kind === 'osc' ? OSC_P.map(p => p + '.on') : ['f.on', 'f2.on'];
    const sel = clamp((kind === 'osc' ? u.oscTab : u.filtTab) | 0, 0, ids.length - 1);
    const T = this.tabSeen || (this.tabSeen = {}), H = T[kind] || (T[kind] = []);
    if (this.foldOf(ids[sel]) !== 'fold') {
      if (H[0] !== sel) { const i = H.indexOf(sel); if (i >= 0) H.splice(i, 1); H.unshift(sel); }
      return sel;
    }
    const m = H.find(i => this.foldOf(ids[i]) !== 'fold');
    if (m !== undefined) return m;
    const k = ids.findIndex(id => this.foldOf(id) !== 'fold');
    return k < 0 ? sel : k;
  }

  /* ---------------------------------------------------------------- dialogs / overlays */
  // Anchored popover holding one editor (remap curves, matrix curves, OSC MAPPING …): make(box) builds the editor into
  // the box and returns it (refresh / destroy); sig() = a signature of what it draws (repaint on change). Opening the
  // popover of the same key again closes it; Escape, ✕ or a press outside close it. Returns { o: key, ed, anchor, close }
  // | null.
  // Where popovers and overlays go: the panel itself on a page; on the canvas (inside [data-cv-world], whose transform
  // would scale and clip them) a twin root in the top layer (wk.layer: #ov) — div.sx-root.sx-layer with the panel's
  // classes and data-dev, so the panel's CSS and container queries apply at screen size (SPEC-canvas §4.7, §8.6)
  layerEl() {
    const L = wk.layer ? wk.layer(this.el) : this.el;
    if (!L || L === this.el || this.dead) { if (this.lay) { this.lay.remove(); this.lay = null; } return this.el; }
    if (!this.lay) { this.lay = mk(this.d, 'div', ''); this.lay.setAttribute('data-dev', this.dev); this.lay.setAttribute('data-sx-layer', this.uid); }
    this.lay.className = String(this.el.className || 'sx-root') + ' sx-layer';
    if (this.lay.parentNode !== L) L.appendChild(this.lay);
    return this.lay;
  }
  popover(key, anchor, title, make, sig) {
    if (this.pop) { const same = this.pop.o === key; this.pop.close(); if (same) return null; }
    const d = this.d, box = mk(d, 'div', 'sx-pop');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', title);
    const hd = mk(d, 'div', 'sx-edhead');
    hd.append(mk(d, 'span', 'sx-ttl', String(title).toUpperCase()), mk(d, 'span', 'sx-grow'));
    const x = btn(d, 'sx-hbtn', '✕', 'Close', () => P.close());
    hd.appendChild(x);
    const eb = mk(d, 'div', 'sx-edbox');
    box.append(hd, eb);
    const er = this.el.getBoundingClientRect(), ar = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : er;
    const L = this.layerEl();
    if (L !== this.el) { // on the canvas: in the top layer at the anchor, screen px (unscaled at any zoom; a pan closes it)
      const win = this.d.defaultView || globalThis, vw = +win.innerWidth || 1024, vh = +win.innerHeight || 768;
      box.style.left = Math.max(8, Math.min(ar.left, vw - 456)) + 'px';
      box.style.top = Math.max(8, ar.bottom + 4) + 'px';
      L.appendChild(box);
      const bh = +box.offsetHeight || 0;
      if (bh && ar.bottom + 4 + bh > vh - 8) box.style.top = Math.max(8, Math.min(ar.top - 4 - bh, vh - 8 - bh)) + 'px';
    } else { // placed in the panel's layout px (the canvas world may scale it: the rects are screen px)
      const ls = wk.localScale(this.el), W = this.el.offsetWidth || er.width * ls;
      box.style.left = Math.max(8, Math.min((ar.left - er.left) * ls, W - 456)) + 'px';
      box.style.top = ((ar.bottom - er.top) * ls + 4) + 'px';
      this.el.appendChild(box);
    }
    const prevBp = this.bp;
    this.bp = this.popPage = mkPage(box);
    let ed;
    try { ed = make(eb); } finally { this.bp = prevBp; }
    // an editor (a class instance: CurveEditor, PZEditor, OscMapEditor …) rather than a plain pane object: full screen
    // below 1100 px (CSS .sx-pop-ed, §13.2 Overlays)
    const isEd = !!ed && typeof ed === 'object' && Object.getPrototypeOf(ed) !== Object.prototype;
    if (isEd) box.classList.add('sx-pop-ed');
    const binds = this.popPage.binds;
    const offs = [
      on(this.d, 'pointerdown', e => { if (!box.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target)) && !closest(e.target, '.wk-ctx, .wk-pop')) P.close(); }, true),
      on(box, 'keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); P.close(); if (anchor && anchor.focus) anchor.focus(); } }),
    ];
    if (ed && sig) this.edSig.set(ed, sig);
    // widgets bound inside the popover repaint with it (a custom bind on the editor's refresh)
    const ed2 = binds.length ? { refresh: () => { for (const w of binds) w.update(); if (ed && ed.refresh) ed.refresh(); }, destroy: () => { if (ed && ed.destroy) ed.destroy(); } } : ed;
    if (ed2 !== ed && sig) this.edSig.set(ed2, sig);
    if (L !== this.el && wk.addTransient) offs.push(wk.addTransient(() => P.close())); // (a camera move: never stranded)
    const P = { o: key, ed: ed2, inner: ed, box, anchor, close: () => {
      offs.forEach(f => f());
      if (ed2 && ed2.destroy) ed2.destroy();
      if (ed) { this.edSig.delete(ed); this.edKey.delete(ed); }
      if (ed2) { this.edSig.delete(ed2); this.edKey.delete(ed2); }
      box.remove();
      if (this.pop === P) this.pop = null;
    } };
    this.pop = P;
    x.focus();
    this.scanMods();
    if (L !== this.el) { /* (the top layer: placed above; below 1100 px of screen an editor is a full-screen sheet by the container rule) */ }
    else if (isEd) fullScreenOverlay(this.el, box);
    else if (panelW(this.el) < 1100) revealIn(box, 'nearest');
    return P;
  }
  // Full-panel overlay (role=dialog, Escape closes, focus restored). Returns { el, close }.
  overlayOpen(cls, label, onClose) {
    if (this.overlay) this.overlay.close();
    const d = this.d, ov = mk(d, 'div', 'sx-ov' + (cls ? ' ' + cls : ''));
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', label);
    const prev = d.activeElement;
    const O = { el: ov, closed: false };
    O.close = () => {
      if (O.closed) return;
      O.closed = true;
      ov.remove();
      if (this.overlay === O) this.overlay = null;
      if (onClose) onClose();
      if (prev && prev.focus && prev.isConnected !== false) prev.focus();
    };
    ov.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); O.close(); } });
    const L = this.layerEl(); // (on the canvas: a sheet in the top layer, whatever the zoom)
    L.appendChild(ov);
    this.overlay = O;
    if (L === this.el) fullScreenOverlay(this.el, ov);
    return O;
  }
  dialog(title, body, buttons) {
    const d = this.d, O = this.overlayOpen('sx-dlg-ov', title);
    const box = mk(d, 'div', 'sx-dlg');
    box.appendChild(mk(d, 'h3', '', title));
    box.appendChild(body);
    const row = mk(d, 'div', 'sx-dbtns');
    for (const b of buttons) {
      const e = btn(d, 'sx-btn' + (b.primary ? ' sx-pri' : ''), b.label, null, () => { if (!b.action || b.action() !== false) O.close(); });
      row.appendChild(e);
    }
    box.appendChild(row);
    O.el.appendChild(box);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const pri = buttons.find(b => b.primary);
        if (pri) { e.preventDefault(); if (!pri.action || pri.action() !== false) O.close(); }
      }
    });
    // the backdrop closes it: a mouse / pen at the press, a finger on its tap's release (≤ 10 px) — a scroll or a
    // two-finger gesture starting there (gesture.js cancels the first finger) leaves it open
    let bp = null;
    O.el.addEventListener('pointerdown', e => {
      bp = null;
      if (e.target !== O.el) return;
      if (e.pointerType === 'touch') bp = { id: e.pointerId, x: e.clientX, y: e.clientY }; else O.close();
    });
    O.el.addEventListener('pointerup', e => {
      const P = bp; bp = null;
      if (P && P.id === e.pointerId && e.target === O.el && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 10) O.close();
    });
    O.el.addEventListener('pointercancel', e => { if (bp && bp.id === e.pointerId) bp = null; });
    const f = body.querySelector ? body.querySelector('input, textarea, button') : null;
    if (f && f.focus) f.focus(); else if (row.firstChild) row.firstChild.focus();
    return O;
  }
  promptText(title, label, value, ok) {
    const d = this.d, body = mk(d, 'div'), i = mk(d, 'input'), l = mk(d, 'label', '', label);
    i.type = 'text'; i.value = value || '';
    l.appendChild(i); body.appendChild(l);
    this.dialog(title, body, [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => ok(i.value) }]);
    if (i.select) i.select();
  }
  confirmDlg(title, text, ok) {
    const body = mk(this.d, 'div');
    body.appendChild(mk(this.d, 'p', '', text));
    this.dialog(title, body, [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => { ok(); return true; } }]);
  }
  enterValue(id, el) {
    const w = el && el.wk;
    if (w && typeof w.edit === 'function') { if (w.focus) w.focus(); w.edit(); return; }
    let lab = id;
    try { lab = core.destLabel(id, this.s(), this.fx()); } catch (err) { lab = id; }
    this.promptText('Enter Value', lab, this.fmt(id, this.getN(id)), t => {
      const n = this.parse(id, t);
      if (n === null || !fin(n)) { this.notify('Could not read “' + t + '”'); return false; }
      this.setN(id, n, 'set');
      return true;
    });
  }

  /* ---------------------------------------------------------------- mod layer (§9.4, §13.6) */
  // touch long-press (500 ms, §13.1) on a plain kit.dropTarget element → a contextmenu event at the touch point, so the
  // element's own menu or the panel's knob menu (onCtx) opens as on a right-click; wk widgets have their own long-press
  touchMenu(el) {
    if (!el || el.wk || !el.addEventListener) return;
    if (!this.lpEls) this.lpEls = new WeakSet();
    if (this.lpEls.has(el)) return;
    this.lpEls.add(el);
    longPress(el, (x, y) => {
      const w = this.d.defaultView, E = (w && w.MouseEvent) || globalThis.MouseEvent || globalThis.Event;
      if (typeof E !== 'function' || this.dead) return;
      el.dispatchEvent(new E('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    });
  }
  installModLayer() {
    const el = this.el;
    this.offs.push(on(el, 'contextmenu', e => this.onCtx(e)));
    this.offs.push(on(el, 'pointerdown', e => this.onCapDown(e), true));
    this.offs.push(on(el, 'click', e => this.onCapClick(e), true));
    this.offs.push(on(el, 'keydown', e => this.onKey(e)));
  }
  // hardware keys (§13.1): Cmd/Ctrl-Z / Shift-Cmd/Ctrl-Z (panel undo / redo), Alt/Option-F (expand FX / matrix)
  onKey(e) {
    if (!this.prefs.keys || e.defaultPrevented) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable) || closest(t, '.sx-ov')) return;
    const mod = e.metaKey || e.ctrlKey, k = String(e.key || '').toLowerCase();
    if (mod && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault();
      this.undoRedo(k === 'y' || e.shiftKey);
    } else if (e.altKey && !mod && (k === 'f' || e.code === 'KeyF')) {
      e.preventDefault();
      this.toggleExpand();
    }
  }
  toggleExpand() {
    if (this.page === 'fx' && this.rack) {
      if (typeof this.rack.toggleExpand === 'function') this.rack.toggleExpand();
      else if (typeof this.rack.expand === 'function') this.rack.expand();
    } else if (this.page === 'matrix') {
      this.mxExp = !this.mxExp;
      if (this.pages.matrix) this.pages.matrix.el.classList.toggle('sx-mxexp', this.mxExp);
    }
  }
  onCtx(e) {
    const t = e.target, host = closest(t, '[data-dest]');
    if (!host || !this.el.contains(host) || closest(t, '.sx-ov')) return;
    e.preventDefault();
    this.destMenu(host.getAttribute('data-dest'), e.clientX, e.clientY, host);
  }
  destMenu(id, x, y, el) {
    const fx = this.fx();
    if (!rowOfDest(id, fx)) return;
    const s = this.s(), module = el && el.getAttribute ? el.getAttribute('data-module') : null;
    const caps = { midi: typeof this.host.midiLearn === 'function', module: module || undefined,
      paste: !!(module && CLIP && CLIP.kind === modKind(module)), recent: this.recentSlot.get(id) };
    const items = knobMenuItems(s, fx, id, caps).filter(it => !(VIRT_RE.test(id) && (it.kind === 'lock' || it.kind === 'unlock')));
    const extra = this.extraKnobItems(id);
    const acts = this.menuActions(items, id, el, module);
    wk.contextMenu(x, y, extra.length ? extra.concat([{ sep: true }], acts) : acts, { anchor: focusable(el) });
  }
  // Reset Control's value: the destination default; arp.rate in HZ mode: the n.hz default (its base there, virtGet)
  resetDef(id) {
    if (id === 'arp.rate') {
      const A = this.s().arp, sl = A && arr(A.slots)[A.sel | 0];
      if (virtKey(sl, 'rate', true) === 'hz') return core.ARP_N && fin(core.ARP_N.hz) ? core.ARP_N.hz : 0.5;
    }
    return (rowOfDest(id, this.fx()) || {}).def || 0;
  }
  // knob-specific items in front of the knob menu (§13.13): LFO RATE ✓ Swing (BPM) / ✓ 10x (Hz); LFO PHASE ✓ Snap to Grid;
  // Voice Control SCALING LFO: By Percentage · By Rate (vc.lmode, §13.10); FX controls: the rack's ctlExtras (§13.5)
  extraKnobItems(id) {
    // FX controls: the rack's control-specific items (fx-ui ctlExtras: Compressor RATIO ▸ Limiter Latency Comp, Bode SHIFT
    // ▸ ✓ Retrig, §13.5 — the rack runs with mod: true, so this menu is theirs; RULINGS2 U3)
    if (isFxPar(id)) return this.rack && typeof this.rack.ctlExtras === 'function' ? arr(this.rack.ctlExtras(id)) : [];
    if (id === 'vc.lscale') {
      const lm = !!(this.s().vc && this.s().vc.lmode), set = v => this.edit(s => { s.vc.lmode = v; }, { label: 'LFO scaling mode' });
      return [{ label: 'By Percentage', checked: !lm, action: () => set(0) }, { label: 'By Rate', checked: lm, action: () => set(1) }];
    }
    const m = /^l([1-9]|10)\.(rate|phase)$/.exec(id || '');
    if (!m) return [];
    const l = +m[1] - 1, L = this.s().lfo[l];
    if (!L) return [];
    if (m[2] === 'phase') return [{ label: 'Snap to Grid', checked: this.lfoSnap, action: () => { this.lfoSnap = !this.lfoSnap; } }];
    return L.bpm ? [{ label: 'Swing', checked: !!L.swing, action: () => this.edit(s => { s.lfo[l].swing = s.lfo[l].swing ? 0 : 1; }, { label: 'LFO swing' }) }]
      : [{ label: '10x', checked: !!L.x10, action: () => this.edit(s => { s.lfo[l].x10 = s.lfo[l].x10 ? 0 : 1; }, { label: 'LFO 10x' }) }];
  }
  moduleMenu(m, x, y, anchor, extra) {
    const items = moduleMenuItems(this.s(), m, { paste: !!(CLIP && CLIP.kind === modKind(m)) });
    let acts = this.menuActions(items, '', anchor, m);
    const more = typeof extra === 'function' ? arr(extra()) : [];
    if (more.length) acts = acts.concat([{ sep: true }], more);
    wk.contextMenu(x, y, acts, { anchor });
  }
  menuActions(items, id, el, module, midiId) {
    const noun = MOD_TITLE(module), mid = midiId || id;
    return items.map(it => {
      if (it.kind === 'sep') return { sep: true };
      const a = { label: it.label };
      if (it.checked !== undefined) a.checked = it.checked;
      switch (it.kind) {
        case 'lockModule': a.action = () => this.lockModuleUI(module); break;
        case 'copy': case 'copyMods':
          a.action = () => { CLIP = clipModule(this.s(), module, it.kind === 'copyMods'); this.notify(noun + ' copied' + (it.kind === 'copyMods' ? ' with modulations' : '')); }; break;
        case 'paste': a.action = () => this.pasteModuleUI(module); break;
        case 'init': a.action = () => { this.edit(s => initModule(s, module), { label: 'Init ' + noun }); this.edDirty = true; this.oscd.forget(); }; break;
        case 'swap': a.sub = it.sub.map(x => ({ label: x.label, action: () => this.swapModuleUI(module, x.m) })); break;
        case 'bypass': a.action = () => this.edit(s => core.toggleModBypass(s, it.slot), { label: 'Bypass Modulator' }); break;
        case 'remove': a.action = () => this.edit(s => { s.matrix[it.slot] = emptyRow(); }, { label: 'Remove Modulator' }); break;
        case 'removeAll': a.action = () => this.edit(s => core.removeMods(s, id), { label: 'Remove All Modulators' }); break;
        case 'auxSrc': a.sub = subMenu(it.sub, x => this.edit(s => { s.matrix[it.slot].aux = x.src; }, { label: 'Aux source' })); break;
        case 'curve': a.action = () => this.openCurve(it.slot, el); break;
        case 'reset': a.action = () => this.setN(id, this.resetDef(id), 'set'); break;
        case 'enter': a.action = () => this.enterValue(id, el); break;
        case 'memtrig': a.action = () => {
          const o = OSC_P.indexOf(id.charAt(0)), set = memTrigSet(Date.now());
          this.edit(s => { s.osc[o].memSet = set; }, { label: 'New MemTrig phase set' });
        }; break;
        case 'modsrc': a.sub = subMenu(it.sub, x => this.addModUI(x.src, id)); break;
        case 'midiLearn': a.action = () => this.midiLearn(mid); break;
        case 'midiForget': a.action = () => this.midiForget(mid); break;
        // serum-core setLock (§2.2.5): inside a locked module Unlock Control also drops a parameter lock (an explicit
        // lock would win) and Lock Control lets the module lock apply again; elsewhere Lock / Unlock = locks.p
        case 'lock': case 'unlock': case 'lockCtl': case 'unlockCtl':
          a.action = () => this.edit(s => setLockOf(s, id, it.kind === 'lock' || it.kind === 'lockCtl'), { label: it.label }); break;
        default: break;
      }
      return a;
    });
  }
  // Lock Module / Lock Matrix (serum-core setModuleLock: unlocking also drops the module's per-control unlocks)
  lockModuleUI(m) {
    const on = !arr(this.s().locks.mod).includes(m);
    this.edit(s => setModuleLockOf(s, m, on), { label: m === 'matrix' ? 'Lock Matrix' : 'Lock Module' });
  }
  pasteModuleUI(m) {
    let ok = false;
    this.edit(s => { ok = pasteModule(s, m, CLIP); }, { label: 'Paste ' + MOD_TITLE(m) });
    if (!ok) this.notify('The clipboard does not fit ' + MOD_TITLE(m));
    this.edDirty = true;
    this.oscd.forget();
  }
  swapModuleUI(a, b) {
    if (!this.need('swapModules')) return;
    let ok = false;
    this.edit(s => { ok = core.swapModules(s, a, b); }, { label: 'Swap ' + MOD_TITLE(a) + ' / ' + MOD_TITLE(b) });
    if (!ok) this.notify('These modules cannot be swapped');
    this.edDirty = true;
    this.oscd.forget();
  }
  // module label dragged onto another module's label (§13.3, inv B2): plain = swap incl. mods; Alt = copy; Shift-Alt =
  // copy with mods (the dragged module is the source)
  moduleDrop(from, to, alt, shift) {
    if (from === to || modKind(from) !== modKind(to)) return;
    if (!alt) { this.swapModuleUI(from, to); return; }
    let ok = false;
    this.edit(s => { ok = core.copyModule(s, clone(s), to, from, { mods: !!shift }); }, { label: 'Copy ' + MOD_TITLE(from) + ' → ' + MOD_TITLE(to) });
    if (!ok) this.notify('These modules cannot be copied onto each other');
    this.edDirty = true;
    this.oscd.forget();
  }
  applySel(s, src) {
    s.ui.mod = src;
    const e = envNum(src);
    if (e) s.ui.env = e - 1;
    if (EDIT_SRC.test(src)) this.edSel = src;
    this.edDirty = true;
  }
  selectSrc(src) { this.uiEdit(s => this.applySel(s, src)); }
  addModUI(src, dst) {
    let res = null;
    this.edit(s => { res = dropRow(s, this.fx(), src, dst, { limit: this.prefs.limitDrop }); if (res) this.applySel(s, src); },
      { label: 'Add Modulation' });
    if (!res) this.notify('Matrix full (' + N_MX + ' slots)'); else this.recentSlot.set(dst, res.slot);
    return res;
  }
  midiLearn(id) {
    const f = this.host.midiLearn;
    if (typeof f !== 'function') return;
    this.notify('MIDI Learn: move a controller…');
    Promise.resolve(f(id)).then(cc => {
      if (this.dead) return;
      if (cc !== null && cc !== undefined) {
        this.dirty = true;   // the MIDI map is saved with the preset (applyPreset)
        let lab = id;
        try { lab = macNum(id) ? srcLabel(this.s(), id) : core.destLabel(id, this.s(), this.fx()); } catch (err) { lab = id; }
        this.notify('CC ' + cc + ' → ' + lab);
      }
      this.queue();
    }, () => {});
  }
  midiForget(id) {
    if (typeof this.host.midiForget === 'function') { this.host.midiForget(id); this.dirty = true; this.queue(); return; }
    this.edit(s => { for (const k of Object.keys(s.midi)) if (s.midi[k] === id) delete s.midi[k]; }, { label: 'Remove MIDI CC' });
  }
  // destination items of the grouped menus (matrix DESTINATION, Shift+Enter picker): serum-core destMenu (§11.1; FX
  // instances by rack), else the static table without the static FX rows
  destGroups() {
    const s = this.s(), fx = this.fx();
    if (typeof core.destMenu === 'function') { try { return core.destMenu(s, fx, { matrix: true }); } catch (err) { warnOnce('destMenu', err); } }
    const groups = new Map();
    for (const d of DESTS) {
      if (isFxPar(d.id) && !(fx && isObj(fx.p))) continue;
      if (!groups.has(d.group)) groups.set(d.group, []);
      groups.get(d.group).push({ id: d.id, label: core.destLabel(d.id, s, fx) });
    }
    return Array.from(groups, ([group, items]) => ({ group, items }));
  }
  // Shift+Enter on a tile (§9.4 keyboard parity): destination picker grouped like the matrix menu
  modulatePicker(src, anchor) {
    const r = anchor.getBoundingClientRect();
    const MO = core.MATRIX_ONLY || [];
    wk.contextMenu(r.left, r.bottom, this.destGroups().map(g => ({ label: g.group,
      sub: g.items.filter(x => !MO.includes(x.id)).map(x => ({ label: x.label, action: () => this.addModUI(src, x.id) })) })).filter(g => g.sub.length), { anchor });
  }

  // Alt-drag / depth handle (§9.4): edits the row of the selected source on this control, else the most recently
  // added row; Shift+Alt-click toggles that row's TYPE
  onCapDown(e) {
    if (e.button !== 0) return;
    const t = e.target, dh = closest(t, '.wk-dh');
    const lat = wk.modifierBar && wk.modifierBar.mods ? wk.modifierBar.mods(e) : { alt: e.altKey, shift: e.shiftKey };
    const alt = !!(e.altKey || lat.alt), shift = !!(e.shiftKey || lat.shift);
    if (!dh && !alt) return;
    const host = closest(t, '[data-dest]');
    if (!host || !this.el.contains(host) || closest(t, '.sx-ov') || closest(t, '.sx-mrow')) return;
    const id = host.getAttribute('data-dest'), slot = this.depthSlot(id);
    if (slot < 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!e.altKey && lat.alt && wk.modifierBar.consume) wk.modifierBar.consume();
    // the click that follows this gesture must not reach the control (toggle flip, menu popup, seg select)
    this.eatClick = { el: host, t: Date.now() };
    if (alt && shift) { this.edit(s => core.toggleModPolarity(s, slot), { label: 'Mod polarity' }); return; }
    this.startDepth(e, id, slot);
  }
  depthSlot(id) { return actionSlot(this.s(), id, this.recentSlot.get(id)); }
  startDepth(e, id, slot) {
    const el = this.el, row = this.s().matrix[slot], D = { id: e.pointerId, x: e.clientX, y: e.clientY, a0: row.amt, acc: 0, a: row.amt };
    const ghost = mk(this.d, 'div', 'sx-ghost');
    this.d.body.appendChild(ghost);
    const show = (x, y) => {
      ghost.textContent = srcLabel(this.s(), row.src) + ' ' + sgn(D.a) + Math.round(D.a * 100) + '%';
      ghost.style.transform = 'translate(' + (x + 14) + 'px,' + (y - 24) + 'px)';
    };
    show(e.clientX, e.clientY);
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    this.edit(s => core.setModAmount(s, slot, D.a), { label: 'Mod depth', phase: 'start' });
    const move = ev => {
      if (ev.pointerId !== D.id) return;
      D.acc += ((D.y - ev.clientY) + (ev.clientX - D.x)) * (ev.shiftKey ? 0.1 : 1) / 100;   // 200 px = 2.0
      D.x = ev.clientX; D.y = ev.clientY;
      const a = Math.round(clamp(D.a0 + D.acc, -1, 1) * 1e4) / 1e4;
      if (a !== D.a) { D.a = a; this.edit(s => core.setModAmount(s, slot, a), { label: 'Mod depth', phase: 'move' }); }
      show(ev.clientX, ev.clientY);
    };
    const up = ev => {
      if (ev.pointerId !== D.id) return;
      offs.forEach(f => f());
      ghost.remove();
      try { el.releasePointerCapture(D.id); } catch (err) { /* released */ }
      if (ev.type === 'pointercancel') this.eatClick = null;   // no click follows a cancelled pointer
      else if (this.eatClick) this.eatClick.t = Date.now();   // a long depth drag: the click comes at release
      if (twoF(ev)) { D.a = D.a0; this.edit(s => core.setModAmount(s, slot, D.a), { label: 'Mod depth', phase: 'move' }); }   // two-finger rollback
      this.edit(s => core.setModAmount(s, slot, D.a), { label: 'Mod depth', phase: 'end' });
    };
    const offs = [on(el, 'pointermove', move), on(el, 'pointerup', up), on(el, 'pointercancel', up)];
  }
  // Alt-click on a matrix SOURCE menu (reassign every row with that source) or on the INV cell (bypass)
  onCapClick(e) {
    const E = this.eatClick;
    if (E) {
      this.eatClick = null;
      if (Date.now() - E.t < 1000 && E.el.contains(e.target)) { e.stopPropagation(); e.preventDefault(); return; }
    }
    if (!e.altKey) return;
    const cell = closest(e.target, '[data-malt]');
    if (!cell || !this.el.contains(cell)) return;
    e.stopPropagation();
    e.preventDefault();
    const slot = +cell.getAttribute('data-slot'), what = cell.getAttribute('data-malt'), s = this.s(), row = s.matrix[slot];
    if (what === 'mode') { this.edit(st => core.toggleModBypass(st, slot), { label: 'Bypass Modulator' }); return; }
    if (!row || !row.src) return;
    const r = cell.getBoundingClientRect(), from = row.src;
    wk.contextMenu(r.left, r.bottom, srcGroups(s).map(g => ({ label: g.group, sub: g.items.filter(x => x.id !== from).map(x => ({
      label: x.label, action: () => this.edit(st => core.reassignSource(st, from, x.id), { label: 'Reassign source' }),
    })) })).filter(g => g.sub.length), { anchor: focusable(cell) });
  }

  /* ---------------------------------------------------------------- source tiles and drag-and-drop */
  makeTile(src, labelFn, cls) {
    const d = this.d, b = mk(d, 'button', 'sx-tile' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    const lab = mk(d, 'span', 'sx-tl'), badge = mk(d, 'span', 'sx-badge');
    b.append(lab, badge);
    b.setAttribute('data-src', src);
    if (lfoNum(src)) b.setAttribute('data-lfotile', String(lfoNum(src)));
    if (macNum(src)) b.setAttribute('data-mactile', String(macNum(src)));
    if (wk.tooltip) wk.tooltip(b, () => this.tileTip(src));
    this.custom(() => {
      const s = this.s(), n = tileDests(s, src).length, L = labelFn();
      if (lab.textContent !== L) lab.textContent = L;
      const bt = n ? String(n) : '';
      if (badge.textContent !== bt) badge.textContent = bt;
      b.setAttribute('aria-pressed', s.ui.mod === src ? 'true' : 'false');
      b.setAttribute('aria-label', L + (n ? ', ' + n + ' destination' + (n > 1 ? 's' : '') : '') + '. Drag onto a control; Shift+Enter to pick a destination');
    });
    this.tileDrag(b, src);
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); this.modulatePicker(src, b); }
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); const r = b.getBoundingClientRect(); this.srcMenu(src, r.left, r.bottom + 2, b); }
    });
    // right-click / long-press (a still hold abandons the armed drag, wk.dragSource): the source's destinations (inv B15)
    b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.srcMenu(src, e.clientX, e.clientY, b); });
    this.touchMenu(b);
    return b;
  }
  // a modulation source's destinations (inv B15: right-click on an ENV / LFO / VELO tab or tile): Bypass All
  // Destinations (✓ while every row of the source is bypassed; toggles them all) · Remove All Destinations — one undo step
  // each; disabled while the source modulates nothing
  srcDestItems(src) {
    const mine = rowsOf(this.s()).filter(r => r && r.src === src && r.dst), all = mine.length > 0 && mine.every(r => r.byp);
    return [
      { label: 'Bypass All Destinations', checked: all, disabled: !mine.length,
        action: () => this.edit(s => { for (const r of rowsOf(s)) if (r && r.src === src && r.dst) r.byp = all ? 0 : 1; }, { label: 'Bypass All Destinations' }) },
      { label: 'Remove All Destinations', disabled: !mine.length,
        action: () => this.edit(s => { const M = rowsOf(s); for (let i = 0; i < M.length; i++) if (M[i] && M[i].src === src) M[i] = emptyRow(); }, { label: 'Remove All Destinations' }) },
    ];
  }
  srcMenu(src, x, y, anchor) { wk.contextMenu(x, y, this.srcDestItems(src), { anchor: focusable(anchor) }); }
  // Tile drag (§5.8): wk.dragSource where available (mouse / pen: 4 px slop; Escape cancels; the click that ends a drag
  // is swallowed); else the Phase-1 pointer gesture. Touch (§13.1) is axis-aware: the tile strip scrolls natively only
  // sideways (touch-action: pan-x), so a finger moving mainly up / down drags at once and a sideways swipe scrolls the
  // strip; a tile elsewhere (the MACROS panel; touch-action: pan-y) drags sideways and lets a vertical swipe scroll the
  // page. A 250 ms hold then drags in any direction; a still 500 ms hold opens the source menu. A drag started without the
  // hold drops only on a target the finger rested on (SETTLE_MS; a flick is a cancel). One finger only (wk.dragSource),
  // and a drag that another one replaced (dragBegin) neither moves nor drops here.
  tileDrag(b, src) {
    b.addEventListener('click', e => {
      if (e.defaultPrevented) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      if (this.tileEat && this.tileEat.el === b && Date.now() - this.tileEat.t < 1000) { this.tileEat = null; e.preventDefault(); return; }
      this.selectSrc(src);
    });
    if (typeof wk.dragSource === 'function') {
      let mine = null;   // this tile's drag (this.drag while it lasts)
      const ds = wk.dragSource(b, {
        data: src,
        scrollAxis: () => (closest(b, '.sx-tiles') ? 'x' : 'y'),
        begin: i => { this.dragBegin(src, !!i.alt, i.pointerType, !!i.quick); mine = this.drag; },
        move: i => { if (mine && this.drag === mine) this.dragMove(i.x, i.y, i.t); },
        drop: i => {
          const D = mine;
          mine = null;
          this.tileEat = { el: b, t: Date.now() };
          if (!D || this.drag !== D) return;
          const hit = this.hitTest(i.x, i.y);
          this.dragDone(hit && this.settled(hit, i.t, i.scrolled) ? hit : null, i.x, i.y);
        },
        cancel: () => { const D = mine; mine = null; if (D && this.drag === D) this.dragDone(null); },
      });
      this.offs.push(() => ds.destroy());
      return;
    }
    let g = null;
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || g) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, alt: e.altKey, on: false };
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    b.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.on) {
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 4) return;
        g.on = true;
        this.dragBegin(src, g.alt || e.altKey);
      }
      this.dragMove(e.clientX, e.clientY);
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      g = null;
      try { b.releasePointerCapture(G.id); } catch (err) { /* released */ }
      if (!G.on) return;
      if (e.type === 'pointercancel') { this.dragDone(null); return; }   // no click follows a cancelled pointer
      this.tileEat = { el: b, t: Date.now() };
      this.dragDone(this.hitTest(e.clientX, e.clientY), e.clientX, e.clientY);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
  // the drag ghost (touch: larger, above the finger, naming the target under it — the finger hides that target);
  // quick: a touch drag started without the hold (its drop needs a settled target, settled())
  dragBegin(src, alt, type, quick) {
    if (this.drag) this.dragDone(null);
    const touch = type === 'touch', label = (alt ? 'Alt · ' : '') + srcLabel(this.s(), src);
    const g = mk(this.d, 'div', 'sx-ghost' + (touch ? ' sx-ghost-touch' : ''), label);
    this.d.body.appendChild(g);
    this.el.classList.add('sx-dragging');
    this.drag = { src, alt, touch, quick: touch && !!quick, label, ghost: g, hit: null, at: 0,
      off: on(this.d, 'keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.dragDone(null); } }, true) };
  }
  // t: the event time (wk.dragSource info.t) — when the target under the pointer last changed (settled())
  dragMove(x, y, t) {
    const D = this.drag;
    if (!D) return;
    const hit = this.hitTest(x, y), el = hit ? hit.el : null;
    if (!sameHit(D.hit, hit)) D.at = +t || 0;
    let L;
    if (D.touch) { const n = hit ? this.hitName(hit) : ''; L = D.label + (n ? (hit.kind === 'swapMacro' ? ' ⇄ ' : ' → ') + n : ''); }
    ghostAt(D.ghost, x, y, D.touch, L);
    if (D.hit && D.hit.el !== el) D.hit.el.classList.remove('sx-droptgt');
    if (el) el.classList.add('sx-droptgt');
    this.el.classList.toggle('sx-candrop', !!hit);
    D.hit = hit;
  }
  // a quick touch drag's drop target counts once the finger has rested on it SETTLE_MS (by event time t); so does any
  // touch drop within SETTLE_MS of an edge auto-scroll step (wk.dragSource info.scrolled: ms since the view last
  // auto-scrolled — the target may have just scrolled under a still finger)
  settled(hit, t, scrolled) {
    const D = this.drag;
    if (!D || !(D.quick || (D.touch && scrolled < SETTLE_MS))) return true;
    return sameHit(D.hit, hit) && +t - D.at >= SETTLE_MS;
  }
  // a drop target's name for the touch ghost (the finger hides the target and its highlight); '' = none
  hitName(h) {
    const s = this.s();
    try {
      switch (h.kind) {
        case 'dest': return core.destLabel(h.id, s, this.fx());
        case 'xy': return 'X | Y';
        case 'msrc': return 'Slot ' + (h.slot + 1) + (h.field === 'aux' ? ' aux source' : ' source');
        case 'point': return 'LFO ' + (h.lfo + 1) + ' point';
        case 'copyLfo': return 'copy to LFO ' + (h.to + 1);
        case 'swapMacro': return srcLabel(s, 'macro' + h.to);
        case 'lfoWt': return 'OSC ' + (OSC_L[h.o] || '?') + ' wavetable';
        case 'lfoNoise': return 'Noise';
        case 'module': return MOD_TITLE(h.m);
        default: return '';
      }
    } catch (err) { return ''; }
  }
  dragDone(hit, x, y) {
    const D = this.drag;
    if (!D) return;
    this.drag = null;
    D.off();
    D.ghost.remove();
    if (D.hit) D.hit.el.classList.remove('sx-droptgt');
    this.el.classList.remove('sx-dragging', 'sx-candrop');
    if (hit) this.doDrop(hit, D.src, x, y);
  }
  // the drop target under (x, y) for source `src` (default: the tile drag's), Alt per the gesture
  hitTest(x, y, src, alt) {
    const D = this.drag, d = this.d;
    if (src === undefined) { if (!D) return null; src = D.src; alt = D.alt; }
    const t = typeof d.elementFromPoint === 'function' ? d.elementFromPoint(x, y) : null;
    if (!t || !this.el.contains(t) || closest(t, '.sx-ov')) return null;
    const l = lfoNum(src), mc = macNum(src);
    const ms = closest(t, '[data-msrc]');
    if (ms) return { kind: 'msrc', el: ms, slot: +ms.getAttribute('data-slot'), field: ms.getAttribute('data-msrc') };
    if (l && alt) {
      const lt = closest(t, '[data-lfotile]');
      if (lt) { const to = +lt.getAttribute('data-lfotile'); return to !== l ? { kind: 'copyLfo', el: lt, to: to - 1 } : null; }
      const od = closest(t, '[data-oscdisp]');
      if (od) return { kind: 'lfoWt', el: od, o: +od.getAttribute('data-oscdisp') };
    }
    // a macro tile dropped on another macro's label swaps the two macros (§5.6, inv B17)
    if (mc) { const mt = closest(t, '[data-mactile]'); if (mt) { const to = +mt.getAttribute('data-mactile'); return to !== mc ? { kind: 'swapMacro', el: mt, to } : null; } }
    const pt = this.lfoPointAt(x, y);
    if (pt) return pt;
    // the Granular / Spectral X|Y dot (and wk.xyPad dots): data-xy with data-dest-x / data-dest-y → "Modulate X /
    // Modulate Y" (§13.3); a dot with one usable axis acts as that plain destination
    const xy = closest(t, '[data-xy]');
    if (xy) {
      const ok = id => { const r = id ? rowOfDest(id, this.fx()) : null; return !!r && !r.nomod && !(mc && id === 'm' + mc); };
      const X = xy.getAttribute('data-dest-x') || xy.getAttribute('data-dest'), Y = xy.getAttribute('data-dest-y');
      if (ok(X) && ok(Y)) return { kind: 'xy', el: xy, x: X, y: Y };
      if (ok(X) || ok(Y)) return { kind: 'dest', el: xy, id: ok(X) ? X : Y };
    }
    const dd = closest(t, '[data-dest]');
    if (dd && rowOfDest(dd.getAttribute('data-dest'), this.fx())) {
      const id = dd.getAttribute('data-dest'), r = rowOfDest(id, this.fx());
      if (r.nomod || (mc && id === 'm' + mc)) return null;   // Convolve shaping (deviation 20); a macro on itself
      return { kind: 'dest', el: dd, id };
    }
    if (l) { const np = closest(t, '[data-noisepanel]'); if (np) return { kind: 'lfoNoise', el: np }; }
    return null;
  }
  // nearest LFO graph point within 8 px of (x, y) while an LFO is shown in the editor of the current page
  lfoPointAt(x, y) {
    const P = this.pages[this.page], box = P && P.lfoBox, l = lfoNum(this.edSel) - 1;
    if (!box || l < 0 || !box.isConnected) return null;
    const L = this.s().lfo[l];
    if (!L || (L.type && L.type !== 'normal')) return null;   // Path / Chaos / S&H ignore point links (§5.7)
    const r = box.getBoundingClientRect();
    if (x < r.left - 8 || x > r.right + 8 || y < r.top - 8 || y > r.bottom + 8 || r.width < 2) return null;
    const pts = L.pts, ed = P.lfoEd;
    if (ed && typeof ed.pos === 'function' && typeof ed.hitPoint === 'function') {   // the editor's own geometry (padding)
      const i = ed.hitPoint(pts, ed.pos({ clientX: x, clientY: y }), false);
      return i >= 0 ? { kind: 'point', el: box, lfo: l, idx: i } : null;
    }
    let best = -1, bd = 64;
    pts.forEach((p, i) => {
      const dx = r.left + p[0] * r.width - x, dy = r.top + (1 - p[1]) * r.height - y, q = dx * dx + dy * dy;
      if (q <= bd) { bd = q; best = i; }
    });
    return best < 0 ? null : { kind: 'point', el: box, lfo: l, idx: best };
  }
  doDrop(hit, src, x, y) {
    const l = lfoNum(src) - 1;
    switch (hit.kind) {
      case 'dest': this.addModUI(src, hit.id); break;
      case 'xy': wk.contextMenu(x, y, [
        { label: 'Modulate X', action: () => this.addModUI(src, hit.x) },
        { label: 'Modulate Y', action: () => this.addModUI(src, hit.y) },
      ], { anchor: hit.el }); break;
      case 'msrc': this.edit(s => { s.matrix[hit.slot][hit.field] = src; }, { label: 'Matrix source' }); break;
      case 'point': {
        const n = this.s().lfo[hit.lfo].pts.length, items = [];
        if (hit.idx > 0 && hit.idx < n - 1) items.push({ label: 'X', action: () => this.linkNew(hit.lfo, [hit.idx], 'x', src) });
        items.push({ label: 'Y', action: () => this.linkNew(hit.lfo, [hit.idx], 'y', src) });
        wk.contextMenu(x, y, items, { anchor: hit.el });
        break;
      }
      case 'copyLfo': this.edit(s => core.copyLfo(s, l, hit.to), { label: 'Copy LFO' }); this.edDirty = true; break;
      case 'swapMacro': if (this.need('swapMacros')) this.edit(s => core.swapMacros(s, macNum(src) - 1, hit.to - 1), { label: 'Swap macros' }); break;
      case 'lfoWt': this.lfoToWavetable(l, hit.o); break;
      case 'lfoNoise': this.lfoToNoise(l); break;
      default: break;
    }
  }
  linkNew(lfo, idxs, axis, src) {
    const s = this.s(), k = core.newBus ? core.newBus(s) : 0;
    if (!k) { this.notify('All 16 LFO buses in use'); return; }
    if (!rowsOf(s).slice(0, N_MX).some(r => !r.src)) { this.notify('Matrix full (' + N_MX + ' slots)'); return; }
    this.edit(st => linkPoints(st, this.fx(), lfo, idxs, axis, k, src), { label: 'Modulate point' });
    this.edDirty = true;
  }

  /* ---------------------------------------------------------------- main menu (§13.12) */
  mainMenu(anchor) {
    const fx = this.fx(), s = this.s(), r = anchor.getBoundingClientRect(), o = this.selOsc(), mpe = s.global.mpe || {};
    const mpeEdit = (fn, label) => this.edit(st => { if (!isObj(st.global.mpe)) st.global.mpe = { on: 0, bend: 48, xyz: 0 }; fn(st.global.mpe); }, { label });
    const xyz = k => ({ label: 'MPE: ' + MPE_XYZ_LABEL[k], checked: mpe.xyz === k, action: () => mpeEdit(m => { m.xyz = m.xyz === k ? 0 : k; }, 'MPE mapping') });
    const fxLocked = fx ? (Array.isArray(fx.racks) ? fx.racks.length > 0 && fx.racks.every(R => R && R.lock) : !!fx.lock) : false;
    const warpOk = this.oscd && typeof this.oscd.canRenderWarp === 'function' ? this.oscd.canRenderWarp(o) : true;
    wk.contextMenu(r.left, r.bottom + 2, [
      { label: 'About', action: () => this.about() },
      { sep: true },
      { label: 'Init Preset', action: () => this.initPreset() },
      { label: 'Init LFOs + LFO Mods', action: () => { if (this.need('initLfos')) { this.edit(st => core.initLfos(st), { label: 'Init LFOs' }); this.edDirty = true; } } },
      { label: 'Init Modulations', action: () => this.confirmDlg('Init Modulations', 'Remove every modulation row and LFO point link?', () => {
        if (this.need('initMods')) { this.edit(st => core.initMods(st), { label: 'Init Modulations' }); this.edDirty = true; }
      }) },
      { label: 'Load Preset…', action: () => this.loadPresetFile() },
      { label: 'Revert to Saved', action: () => this.revertPreset() },
      { label: 'Save as Default Preset', action: () => this.saveDefault() },
      { label: 'Import Preset Pack…', action: () => this.browser.importFile() },
      { sep: true },
      { label: 'Render OSC ' + OSC_L[o] + ' Warp', disabled: !warpOk, action: () => this.renderOscWarp(o) },
      { label: 'Resample to', sub: [
        { label: 'Selected Osc (OSC ' + OSC_L[o] + ')', action: () => this.resample(OSC_L[o]) },
        { label: 'A and B (Stereo)', action: () => this.resample('AB') },
      ] },
      { sep: true },
      { label: 'Load Tuning…', action: () => this.loadTuning() },
      { label: 'MPE Enabled', checked: !!mpe.on, action: () => mpeEdit(m => { m.on = m.on ? 0 : 1; }, 'MPE') },
      xyz(1), xyz(2), xyz(3),
      { label: 'MPE Bend Range', sub: [12, 24, 48, 96].map(b => ({ label: b + ' semitones', checked: mpe.bend === b, action: () => mpeEdit(m => { m.bend = b; }, 'MPE bend range') }))
        .concat([{ label: 'Other…', action: () => this.promptText('MPE Bend Range', 'Semitones (1–96)', String(mpe.bend || 48), t => {
          const v = Math.round(parseFloat(String(t).replace(',', '.')));
          if (!(v >= 1 && v <= 96)) return false;
          mpeEdit(m => { m.bend = v; }, 'MPE bend range');
          return true;
        }) }]) },
      { sep: true },
      { label: 'Lock FX Rack', checked: fxLocked, action: () => this.editFx(f => {
        if (Array.isArray(f.racks)) { const v = fxLocked ? 0 : 1; for (const R of f.racks) if (R) R.lock = v; } else f.lock = f.lock ? 0 : 1;
      }, { label: 'Lock FX Rack' }) },
      { label: 'Load Effect Chain…', sub: this.chainMenu() },
      { label: 'Save Effect Chain…', action: () => this.saveChainDialog() },
      { sep: true },
      { label: 'Velo->Amp', action: () => this.veloAmp() },
      { label: 'Vibrato quick-assign', action: () => this.vibrato() },
    ], { anchor });
  }
  replaceState(target, src) {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, src);
  }
  // Init Preset (§13.12, §11.1 initPreset): everything incl. every lock and FX bus lock reset; the page stays
  initPreset() {
    if (!this.confirmChange()) return;
    let next = null, nfx = null;
    if (typeof core.initPreset === 'function') {
      const r = core.initPreset(this.s(), this.prefs);
      next = r.s; nfx = r.fx;
    } else if (this.need('applyPreset')) {
      const init = core.defaultSerum();
      init.global.os = this.prefs.defOs;
      init.author = this.prefs.author;
      next = core.applyPreset(this.s(), { name: 'Init', cat: 'Init', v: { s: init }, fx: core.defaultFx() });
      nfx = core.defaultFx();
    }
    if (!next) return;
    // the new state's ui is initPreset's (Default waveform view preference, default editors and selections); only the
    // page stays (core.initPreset keeps it already; the fallback path copies it)
    const page = this.s().ui && this.s().ui.page;
    if (isObj(next.ui) && PAGES.includes(page)) next.ui.page = page;
    this.edit(s => { this.replaceState(s, next); }, { label: 'Init Preset', seed: true });
    if (this.fx() && nfx) this.editFx(f => { const fui = f.ui; this.replaceState(f, nfx); if (fui !== undefined) f.ui = fui; }, { label: 'Init Preset', seed: true });
    this.dirty = false;
    this.nameOverride = 'Init';
    this.oscd.forget();
    this.refresh();
  }
  loadPresetFile() {
    const pr = this.host.presets;
    if (!pr || !pr.importFile) { this.notify('Preset import is not available'); return Promise.resolve(); }
    return pickFile(this.d, '.json,application/json').then(f => (f ? pr.importFile(f) : null)).then(k => {
      if (k === null || k === undefined) return;
      this.presetsChanged();
      if (this.confirmChange()) this.loadPreset(k);
    }, err => { console.warn(err); this.notify('Could not load that file'); });
  }
  // Save as Default Preset (synth.sx.default): new Serum tracks start from it (main.js)
  saveDefault() {
    const s = clone(this.s()), fx = this.fx() ? clone(this.fx()) : null;
    if (!s) return;
    delete s.ui;
    this.store('set', DEFAULT_KEY, { name: 'Default', v: { s }, fx });
    this.notify('Saved as the default preset for new tracks');
  }
  loadTuning() {
    const f = this.host.tuningFile;
    if (typeof f !== 'function') { this.notify('Tuning files are not available'); return Promise.resolve(); }
    return Promise.resolve(f()).then(t => {
      if (!t || this.dead) return;
      if (t.error) { this.notify('Could not read that tuning file: ' + t.error); return; }
      this.edit(s => { s.global.tun = { name: String(t.name || '').slice(0, 64), kind: t.kind || 'scl', scl: t.scl || '', kbm: t.kbm || '', tab: t.tab ? Array.from(t.tab) : null }; }, { label: 'Load Tuning' });
      this.notify('Tuning: ' + (t.name || 'loaded'));
    }, err => { console.warn(err); this.notify('Could not load that tuning file'); });
  }
  clearTuning() { this.edit(s => { s.global.tun = { name: '', kind: 'none', scl: '', kbm: '', tab: null }; }, { label: 'Clear Tuning' }); }
  veloAmp() {
    if (!this.need('veloToAmp')) return;
    let slot = -1;
    this.edit(s => { slot = core.veloToAmp(s); }, { label: 'Velo->Amp' });
    if (slot < 0) this.notify('Matrix full (' + N_MX + ' slots)');
  }
  vibrato() {
    if (!this.need('vibratoAssign')) return;
    let slot = -1;
    this.edit(s => { slot = core.vibratoAssign(s); }, { label: 'Vibrato quick-assign' });
    if (slot < 0) this.notify('No unused LFO or matrix full');
    else { const r = this.s().matrix[slot]; this.notify(srcLabel(this.s(), r.src) + ' → Master Tune (mod wheel depth)'); this.edDirty = true; }
  }
  resample(target) {
    if (typeof this.host.resample !== 'function') { this.notify('Resampling is not available'); return; }
    this.notify('Resampling…');
    // the host selects the resampled table on the oscillator(s): an edit of the sound (§8.8 dirty)
    Promise.resolve(this.host.resample(target)).then(() => { if (!this.dead) { this.dirty = true; this.oscd.forget(); this.markUndo('Resample'); this.refresh(); } },
      err => { console.error(err); this.notify('Resample failed'); });
  }
  about() {
    const body = mk(this.d, 'div');
    body.appendChild(mk(this.d, 'p', '', 'Wavetable synthesizer modelled on the Serum workflow: three oscillators (wavetable, multisample, sample, granular, spectral) with two warp slots and unison, sub and noise oscillators, two filters, a mixer with two FX buses, 4 envelopes, 10 LFOs, a 64-slot modulation matrix, an arpeggiator, a clip player and a modular effect rack.'));
    body.appendChild(mk(this.d, 'p', '', 'All artwork, wavetables, samples, noises and presets are original. Not affiliated with Xfer Records.'));
    body.appendChild(mk(this.d, 'p', 'sx-rate', BUILD));
    this.dialog('About', body, [{ label: 'Close', primary: true }]);
  }
  /* effect chains (§9.6, §11.2): synth.fxchains = [{name, fx}] (fx = a v2 state without ui, racks unlocked; v1 entries
   * written by older versions are read through fx-core migrateChains1) + JSON file export / import. FX state v2
   * everywhere (RULINGS2 F1): the same rules as the rack's chain menu (fx-ui). A v1 chain (a v1 entry written by an older
   * version, a Phase-1 factory chain: fx-core factoryChainFx) is loaded as it is and migrates in loadChain with the Serum
   * state as refs: the modules the track's rows, locks and MIDI map address stay, as in Phase 1. Saving and importing keep
   * the other entries as stored */
  rawChains() {
    const raw = this.store('get', CHAINS_KEY, []), L = Array.isArray(raw) ? raw : isObj(raw) ? arr(raw.chains) : [];
    return L.filter(c => c && typeof c.name === 'string' && c.name && isObj(c.fx));
  }
  chains() {
    const ok = this.rawChains();
    if (typeof core.migrateChains1 !== 'function') return ok;
    try { return arr(core.migrateChains1(ok).chains); } catch (err) { console.warn('effect chains unreadable', err); return []; }
  }
  chainMenu() {
    // Factory ▸ = fx-core FACTORY_CHAINS (v2: the Phase-1 chains migrated + the Serum 2 ones; read-only, never stored; the
    // Phase-1 ones load from their v1 states), then the user's library (entries as stored)
    const fac = core.FACTORY_CHAINS ? arr(core.FACTORY_CHAINS.chains) : [];
    const facFx = c => (typeof core.factoryChainFx === 'function' ? core.factoryChainFx(c) || c.fx : c.fx);
    const head = fac.length ? [{ label: 'Factory', sub: fac.map(c => ({ label: c.name, action: () => this.loadChain(facFx(c), c.name) })) }, { sep: true }] : [];
    const list = this.rawChains().map(c => ({ label: c.name, action: () => this.loadChain(c.fx, c.name) }));
    if (!list.length) list.push({ label: '(no saved chains)', disabled: true });
    return head.concat(list, [{ sep: true }, { label: 'Import from File…', action: () => this.importChains() },
      { label: 'Export All to File…', action: () => download(this.d, 'effect-chains.json', JSON.stringify({ type: 'synth.fxchains', v: 2, chains: this.chains() }, null, 1)) }]);
  }
  // Stored chains are normalised v2 copies without ui, racks unlocked, sorted by name; loading replaces every rack (its
  // instances, bypass, routing) keeping ui, each rack's lock flag and the values of locked FX parameters whose instance
  // (same id and type) the chain brings back, and compiles with seed (§9.6); the Serum state's rows, locks and MIDI
  // entries addressing an instance the chain does not bring back go (fx-core removeInstance, as the rack's loadChain).
  // Import accepts a library file ({ chains: [{ name, fx }] }, merged by name) or a single chain ({ name, fx } as the
  // rack's Export Effect Chain… writes it, or a bare fx state: loaded).
  chainCopy(fx) {
    if (typeof core.migrateChains1 === 'function') { const c = arr(core.migrateChains1([{ name: 'x', fx }]).chains)[0]; if (c) return c.fx; }
    const c = core.normalizeFx ? core.normalizeFx(fx) : clone(fx); delete c.ui; delete c.lock; return c;
  }
  storeChains(list) { this.store('set', CHAINS_KEY, list.slice().sort((a, b) => a.name.localeCompare(b.name))); }
  loadChain(fx, name) {
    if (!core.normalizeFx || !this.fx()) return;
    // a v1 chain migrates with the Serum state as refs (§2.6.3): instances its rows, locks and MIDI entries address stay
    const n = core.normalizeFx(clone(fx), this.s()), cur = this.fx(), locked = arr(this.s().locks.p).filter(isFxPar), keep = [];
    const fd = (id, f) => (typeof core.fxDest === 'function' ? core.fxDest(id, f) : null);
    for (const id of locked) { const d = fd(id, cur); if (d && d.inst && isObj(d.inst.p)) keep.push([id, d.inst.type, d.inst.p[d.pid]]); }
    const inc = new Map();
    fxWalk(n, I => { inc.set(I.id, I.type); });
    const gone = [];
    fxWalk(cur, I => { if (inc.get(I.id) !== I.type) gone.push(I.id); });
    if (gone.length && typeof core.removeInstance === 'function') {
      const f0 = clone(cur);
      this.edit(st => { for (const id of gone) core.removeInstance(f0, id, st); }, { label: 'Load Effect Chain' });
    }
    this.editFx(f => {
      const ui = f.ui, locks = arr(f.racks).map(R => (isObj(R) && R.lock ? 1 : 0));
      this.replaceState(f, n);
      if (Array.isArray(f.racks)) f.racks.forEach((R, k) => { if (isObj(R)) R.lock = locks[k] || 0; });
      for (const [id, type, v] of keep) { const d = fd(id, f); if (d && d.inst && d.inst.type === type && fin(v)) d.inst.p[d.pid] = v; }
      if (ui !== undefined) f.ui = ui;
      if (isObj(f.ui) && f.ui.sel && !inc.has(f.ui.sel)) f.ui.sel = '';
    }, { label: 'Load Effect Chain', seed: true });
    if (this.rack && this.rack.refresh) this.rack.refresh();
    if (name) this.notify('Loaded effect chain “' + name + '”');
  }
  saveChainDialog() {
    this.promptText('Save Effect Chain', 'Name', 'Chain ' + (this.chains().length + 1), t => {
      const name = String(t).trim().slice(0, 48);
      if (!name || !this.fx()) return false;
      this.storeChains(this.rawChains().filter(c => c.name !== name).concat([{ name, fx: this.chainCopy(this.fx()) }]));
      this.notify('Saved effect chain “' + name + '”');
      return true;
    });
  }
  importChains() {
    return pickFile(this.d, '.json,application/json').then(f => fileText(f).then(t => (t ? this.importChainText(t, f && f.name) : 0)))
      .catch(err => { console.warn(err); this.notify('Could not read that file'); });
  }
  importChainText(t, fileName) {
    const j = JSON.parse(t);
    if (j && Array.isArray(j.chains)) {
      const add = j.chains.filter(c => c && typeof c.name === 'string' && c.name.trim() && isObj(c.fx) && (isObj(c.fx.p) || Array.isArray(c.fx.racks)));
      if (!add.length) { this.notify('No effect chains in that file'); return 0; }
      const m = new Map(this.rawChains().map(c => [c.name, c]));
      for (const c of add) { const nm = c.name.trim().slice(0, 48); m.set(nm, { name: nm, fx: this.chainCopy(c.fx) }); }
      this.storeChains(Array.from(m.values()));
      this.notify('Imported ' + add.length + ' effect chain' + (add.length > 1 ? 's' : ''));
      return add.length;
    }
    const fx = j && isObj(j.fx) ? j.fx : j;
    if (!isObj(fx) || !(isObj(fx.p) || Array.isArray(fx.racks))) { this.notify('No effect chains in that file'); return 0; }
    this.loadChain(fx, (j && typeof j.name === 'string' && j.name) || String(fileName || 'Effect chain').replace(/(\.fxchain)?\.json$/i, ''));
    return 1;
  }


  /* ================================================================ OSC page (§13.2, §13.3) */
  // row A: [SUB over NOISE] [OSC A] [OSC B] [OSC C] [FILTER 1 over FILTER 2] — the panels of sx-ui-osc (U2), bound
  // through the kit (§11.14). Narrow layouts (container widths, §13.2): below 1100 px one oscillator at a time (tabs
  // A · B · C with colour dots and power LEDs, s.ui.oscTab), below 1366 px one filter at a time (s.ui.filtTab).
  // Pressing an oscillator panel selects it (s.ui.osc: the Render OSC Warp / Resample target, §13.3.1).
  // C1: an off oscillator / SUB / NOISE / filter folds to a bar (kit.panel o.collapse); the tabs then choose among the
  // expanded ones (tabOf) and the folded ones always show as bars. data-rail-sn / -o / -f on row A = "1" while every
  // panel of that column is folded: from 768 px its track shrinks to vertical rails.
  buildOsc(el) {
    const d = this.d, K = this.kit;
    const rowA = mk(d, 'div', 'sx-row sx-rowA'), colSN = mk(d, 'div', 'sx-col sx-colSN');
    const colO = mk(d, 'div', 'sx-colO'), colF = mk(d, 'div', 'sx-col sx-colF');
    rowA.append(colSN, colO, colF);
    this.oscPanels = [];
    const cols = { sn: [], o: [], f: [] };   // C1: the power ids of each column's panels
    const mount = (f, box, col, id) => {
      try { const p = f(); this.oscPanels.push(p); if (p && p.el) cols[col].push(id); return p; } catch (err) { console.error('serum-ui: oscillator panel', err); box.appendChild(mk(d, 'p', 'sx-placeholder', 'Panel unavailable')); return null; }
    };
    mount(() => new osc.SubPanel(colSN, K), colSN, 'sn', 's.on');
    mount(() => new osc.NoisePanel(colSN, K), colSN, 'sn', 'n.on');
    colO.appendChild(this.panelTabs('osc'));
    for (let o = 0; o < N_OSC; o++) {
      const p = mount(() => new osc.OscPanel(colO, K, o), colO, 'o', OSC_P[o] + '.on');
      if (!p || !p.el) continue;
      p.el.classList.add('sx-opan');
      p.el.setAttribute('data-o', String(o));
      // pressing an oscillator selects it (s.ui.osc); its tab (s.ui.oscTab) only while it is expanded: a press on a
      // folded bar (its title's menu, a label drag, a two-finger gesture's first finger) never swaps the oscillator a
      // tabbed layout shows (C1). Powering it on or peeking from the bar shows it: the bubbling click, after the
      // toggle's / chevron's own (keyboard activation too). View edits of s.ui only: no undo re-top (noRebase)
      const pid = OSC_P[o] + '.on', tabIs = () => ((this.s().ui || {}).oscTab | 0) === o;
      const sel = () => {
        const live = this.foldOf(pid) !== 'fold';
        if (this.selOsc() !== o || (live && !tabIs())) this.uiEdit(s => { s.ui.osc = o; if (live) s.ui.oscTab = o; }, { noRebase: true });
      };
      p.el.addEventListener('pointerdown', sel, true);
      p.el.addEventListener('click', sel, true);
      p.el.addEventListener('click', () => { if (this.foldOf(pid) !== 'fold' && !tabIs()) this.uiEdit(s => { s.ui.oscTab = o; }, { noRebase: true }); });
    }
    colF.appendChild(this.panelTabs('filt'));
    for (let k = 0; k < 2; k++) {
      const p = mount(() => new osc.FilterPanel(colF, K, k), colF, 'f', k ? 'f2.on' : 'f.on');
      if (!p || !p.el) continue;
      p.el.classList.add('sx-fpan');
      p.el.setAttribute('data-f', String(k));
      // C1: pressing an expanded filter selects its tab; a folded bar's press leaves it (as the oscillators'); powering
      // on or peeking from the bar shows it (the bubbling click, after the toggle's / chevron's own). No undo re-top
      const pid = k ? 'f2.on' : 'f.on';
      const pick = () => { if (this.foldOf(pid) !== 'fold' && ((this.s().ui || {}).filtTab | 0) !== k) this.uiEdit(s => { s.ui.filtTab = k; }, { noRebase: true }); };
      p.el.addEventListener('pointerdown', pick, true);
      p.el.addEventListener('click', pick, true);
      p.el.addEventListener('click', pick);
    }
    this.custom(() => {
      const ot = String(this.tabOf('osc')), ft = String(this.tabOf('filt')), so = this.selOsc();
      if (colO.getAttribute('data-tab') !== ot) colO.setAttribute('data-tab', ot);
      if (colF.getAttribute('data-tab') !== ft) colF.setAttribute('data-tab', ft);
      for (const k in cols) {
        const L = cols[k], v = L.length && L.every(id => this.foldOf(id) === 'fold') ? '1' : '0', a = 'data-rail-' + k;
        if (rowA.getAttribute(a) !== v) rowA.setAttribute(a, v);
      }
      for (const p of this.oscPanels) if (p && p.el && p.el.hasAttribute('data-o')) p.el.classList.toggle('sx-osel', +p.el.getAttribute('data-o') === so);
    });
    el.append(rowA, this.tileStrip(), this.rowC());
  }
  // oscillator / filter tab pair of the narrow layouts: colour dot + power LED (lit = module on)
  panelTabs(kind) {
    const d = this.d, bar = mk(d, 'div', 'sx-ptabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', kind === 'osc' ? 'Oscillator' : 'Filter');
    const n = kind === 'osc' ? N_OSC : 2, bs = [];
    for (let k = 0; k < n; k++) {
      const label = kind === 'osc' ? 'OSC ' + OSC_L[k] : 'FILTER ' + (k + 1), power = kind === 'osc' ? OSC_P[k] + '.on' : k ? 'f2.on' : 'f.on';
      const b = btn(d, 'sx-ptab', '', label, () => this.uiEdit(s => {
        if (kind === 'osc') { s.ui.oscTab = k; s.ui.osc = k; } else s.ui.filtTab = k;
      }, { noRebase: true }));
      b.setAttribute('role', 'tab');
      b.setAttribute(kind === 'osc' ? 'data-o' : 'data-f', String(k));
      const dot = mk(d, 'span', 'sx-dot');
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot, mk(d, 'span', '', kind === 'osc' ? OSC_L[k] : String(k + 1)));
      bs.push({ b, power });
      bar.appendChild(b);
    }
    // C1: tabs choose among the expanded (live or peeked) modules: a folded module shows as its bar instead of a tab,
    // and the strip shows only while two or more are expanded
    this.custom(() => {
      const sel = this.tabOf(kind), fk = bs.findIndex(x => x.b === d.activeElement);
      let n = 0;
      bs.forEach(({ b, power }, k) => {
        const f = this.foldOf(power) === 'fold';
        if (!f) n++;
        b.setAttribute('aria-selected', k === sel ? 'true' : 'false');
        b.classList.toggle('sx-pon', destOf(power) ? this.getN(power) >= 0.5 : false);
        b.classList.toggle('sx-hidden', f);
      });
      bar.classList.toggle('sx-hidden', n < 2);
      // a focused tab that hides keeps focus near: the selected tab while the strip shows, else its module's power
      if (fk >= 0 && (n < 2 || bs[fk].b.classList.contains('sx-hidden'))) {
        const col = bar.parentNode, t = n >= 2 ? bs[sel].b : col && col.querySelector ? col.querySelector('[data-dest="' + bs[fk].power + '"]') : null;
        if (t && t.focus) t.focus({ preventScroll: true });
      }
    });
    return bar;
  }
  // row C: [MACROS 1–8] [ENV 1–4] [LFO / VELO / NOTE] [VOICING] (OSC and MIX pages, §13.2)
  rowC() {
    const r = mk(this.d, 'div', 'sx-row sx-rowC');
    r.append(this.macrosPanel(), this.envPanel(), this.lfoPanel(), this.voicingPanel());
    return r;
  }
  // panel shell: power toggle (module power = DEST + module menu), title (module menu on right-click / long-press /
  // Enter; drag onto another module's title: swap / Alt copy / Shift-Alt copy with mods), lock mark; greys out while off.
  // o.items() = extra module-menu items (sub-panels, §11.14); o.collapse = fold to the title row while the module is
  // off (C1: the oscillators, SUB, NOISE and the filters)
  panel(title, module, powerId, cls, o) {
    const d = this.d, O = o || {}, el = mk(d, 'section', 'sx-panel' + (cls ? ' ' + cls : ''));
    el.setAttribute('aria-label', title);
    const head = mk(d, 'div', 'sx-ptitle'), body = mk(d, 'div', 'sx-pbody');
    const pw = powerId ? this.dToggle(powerId, title + ' on', 'power', { module }) : null;
    if (pw) head.appendChild(pw.el);
    const name = mk(d, 'span', 'sx-tname', title);
    if (module) {
      name.tabIndex = 0;
      name.setAttribute('role', 'button');
      name.setAttribute('aria-haspopup', 'menu');
      name.setAttribute('aria-label', title + ' module menu (lock, init, copy, paste, swap)');
      name.setAttribute('data-modlabel', module);
      const open = (x, y) => this.moduleMenu(module, x, y, name, O.items);
      const below = () => { const r = name.getBoundingClientRect(); open(r.left, r.bottom + 2); };
      name.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); open(e.clientX, e.clientY); });
      name.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); below(); }
      });
      longPress(name, open);
      if (KIND_MEMBERS[modKind(module)] || audioSrcOf(module)) this.moduleDrag(name, module);
    }
    const lock = icon(d, 'lock');
    lock.setAttribute('class', 'sx-lockmark');
    head.append(name, lock);
    const fold = O.collapse && pw ? this.foldable(el, body, head, name, pw.el, powerId, title) : null;
    el.append(head, body);
    if (module || powerId) {
      this.custom(() => {
        if (powerId) el.classList.toggle('sx-off', this.getN(powerId) < 0.5);
        if (module) el.classList.toggle('sx-locked', arr(this.s().locks.mod).includes(module));
        if (fold) fold();
      });
    }
    return { el, head, body, name };
  }
  // C1: an off module folds to its title row (power, title, lock mark, chevron: a bar, or a rail beside other panels);
  // the chevron shows the controls while it stays off (a peek: view only, dropped when the module goes live). Its
  // power toggle (a drop target), title (module menu, label drags) and NOISE's LFO drop keep working while folded.
  foldable(el, body, head, name, pw, id, title) {
    const d = this.d;
    body.id = this.uid + '-pb' + (this.pbN = (this.pbN || 0) + 1);
    const peek = btn(d, 'sx-hbtn sx-peek', icon(d, 'chev'), 'Show or hide the controls while this module is off', () => {
      if (this.peeks.has(id)) this.peeks.delete(id); else this.peeks.add(id);
      if (!this.dead) this.paint(true);   // synchronous: the panel, the tabs and the row attributes flip in this frame
    });
    peek.setAttribute('aria-controls', body.id);
    head.appendChild(peek);               // DOM order = visual order (power, title, lock mark, chevron, then the panel's own)
    return () => {
      const f = this.foldOf(id), coll = f === 'fold';
      if (coll && !el.classList.contains('sx-coll')) this.folding(el, [pw, name, peek]);
      el.classList.toggle('sx-coll', coll);
      peek.classList.toggle('sx-hidden', f === 'live');
      const ex = coll ? 'false' : 'true', lab = (coll ? 'Show ' : 'Hide ') + title + ' controls (off)';
      if (peek.getAttribute('aria-expanded') !== ex) peek.setAttribute('aria-expanded', ex);
      if (peek.getAttribute('aria-label') !== lab) peek.setAttribute('aria-label', lab);
    };
  }
  // C1: a panel folds away: a popover anchored in what disappears closes first, then focus that was in what disappears
  // (or in that popover) goes to its power toggle
  folding(el, keep) {
    const a = this.d.activeElement, kept = n => keep.some(k => k && k.contains && k.contains(n));
    const P = this.pop, closes = !!(P && P.anchor && el.contains(P.anchor) && !kept(P.anchor));
    const lost = (a && a !== el && el.contains(a) && !kept(a)) || (closes && a && P.box && P.box.contains(a));
    if (closes) P.close();
    if (lost && keep[0] && keep[0].focus) keep[0].focus({ preventScroll: true });
  }
  // module label as a drag handle (§13.3, inv B2): dropped on another label of the same kind = swap (Alt: copy, Shift-Alt:
  // copy with mods); the labels of OSC A/B/C, SUB, NOISE and FILTER 1/2 dropped on a control (or a matrix source cell,
  // an X|Y dot, an LFO point) = that module's audio-rate source (§3.10 drag tiles, inv B18)
  moduleDrag(name, module) {
    if (typeof wk.dragSource !== 'function') return;
    const asrc = audioSrcOf(module), same = !!KIND_MEMBERS[modKind(module)];
    let ghost = null, over = null, at = -Infinity; // at: event time the target under the pointer last changed (the drop's rest rule)
    const find = i => {
      const t = closest(i.target, '[data-modlabel]'), m = t ? t.getAttribute('data-modlabel') : null;
      if (m && same && m !== module && modKind(m) === modKind(module)) return { kind: 'module', el: t, m };
      if (!asrc || (t && m === module)) return null;
      const h = this.hitTest(i.x, i.y, asrc, false);
      return h && AUDIO_DROPS.has(h.kind) ? h : null;
    };
    const label = (i, h) => (h && h.kind !== 'module' ? 'Modulate · ' + srcLabel(this.s(), asrc)
      : (i.alt ? (i.shift ? 'Copy w/mods · ' : 'Copy · ') : 'Swap · ') + MOD_TITLE(module));
    const clear = () => { if (ghost) { ghost.remove(); ghost = null; } if (over) { over.classList.remove('sx-droptgt'); over = null; } };
    const ds = wk.dragSource(name, {
      data: module,
      begin: i => { ghost = mk(this.d, 'div', 'sx-ghost' + (i.pointerType === 'touch' ? ' sx-ghost-touch' : ''), label(i, null)); this.d.body.appendChild(ghost); },
      move: i => {
        const h = find(i), t = h ? h.el : null, touch = i.pointerType === 'touch', n = touch && h ? this.hitName(h) : '';
        if (ghost) ghostAt(ghost, i.x, i.y, touch, label(i, h) + (n ? ' → ' + n : ''));
        if (t !== over) { if (over) over.classList.remove('sx-droptgt'); over = t; at = +i.t; if (t) t.classList.add('sx-droptgt'); }
      },
      drop: i => {
        const h = find(i), was = over;
        clear();
        if (!h) return;
        // a touch lift within SETTLE_MS of an edge auto-scroll step drops only on a target the finger rested on (settled())
        if (i.pointerType === 'touch' && i.scrolled < SETTLE_MS && (h.el !== was || +i.t - at < SETTLE_MS)) return;
        if (h.kind === 'module') this.moduleDrop(module, h.m, !!i.alt, !!i.shift);
        else this.doDrop(h, asrc, i.x, i.y);
      },
      cancel: clear,
    });
    this.offs.push(() => ds.destroy());
  }

  /* ---------------------------------------------------------------- OSC-side actions (sx-ui-osc, §11.14) */
  // serum-ui's own entry points into the oscillator data: drops on the displays (doDrop), the main menu and the LFO
  // shape menus. An LFO dropped on a non-wavetable oscillator also switches it to a wavetable one: sx-ui-osc does that in
  // the same edit as the new table, once the table is saved (§13.13, inv B16: one undo step; a failed save leaves the
  // oscillator as it was).
  lfoToWavetable(l, o) {
    let r;
    try { r = this.oscd.lfoToWavetable(l, o); } catch (err) { r = Promise.reject(err); }
    return Promise.resolve(r).catch(err => { console.warn('serum-ui: LFO to wavetable', err); if (!this.dead) this.notify('LFO → wavetable failed' + (err && err.message ? ': ' + err.message : '')); });
  }
  lfoToNoise(l) {
    let r;
    try { r = this.oscd.lfoToNoise(l); } catch (err) { r = Promise.reject(err); }
    return Promise.resolve(r).catch(err => { console.warn('serum-ui: LFO to noise', err); if (!this.dead) this.notify('LFO → noise failed' + (err && err.message ? ': ' + err.message : '')); });
  }
  renderOscWarp(o) { return this.oscd.renderOscWarp(o); }
  // Wavetable to LFO Shape (§9.3): the oscillator's frame at its base WT POS → ≤ 64 points into the edited LFO
  wtToLfo(o) {
    const l = Math.max(0, lfoNum(this.edSel) - 1), pts = this.oscd.lfoShape(o);
    if (!pts) return;
    this.edit(s => { const cut = ptsBuses(s.lfo[l].pts); s.lfo[l].pts = pts; s.lfo[l].loop = -1; s.lfo[l].start = 0; pruneLost(s, cut); }, { label: 'Wavetable to LFO Shape' });
    this.edDirty = true;
  }
  // the WT editor overlay of oscillator o (§9.9; the OSC panel's edit button, kit.openWtEditor)
  openWtEditor(o) {
    const W = wte.WTEditor;
    if (typeof W !== 'function') { this.notify('Wavetable editor not available'); return; }
    if (this.pop) this.pop.close();
    const O = this.overlayOpen('sx-wte-ov', 'Wavetable editor, OSC ' + (OSC_L[o] || 'A'), () => {
      const ed = this.wtEd;
      this.wtEd = null;
      if (ed && ed.close) { try { ed.close(); } catch (err) { /* closed */ } }
      this.editorOsc = null;
      if (typeof this.host.editorOpen === 'function') this.host.editorOpen(null);
      this.oscd.forget();
      if (!this.dead) this.refresh();
    });
    const box = mk(this.d, 'div', 'sx-wte');
    O.el.appendChild(box);
    this.wtEd = new W(box, { host: this.editorHost(), osc: o, onClose: () => O.close() });
    if (this.wtEd.open) this.wtEd.open();
    this.editorOsc = o;
    if (typeof this.host.editorOpen === 'function') this.host.editorOpen(o);
  }
  // The SerumUI host as the WT editor sees it: state edits (copy-on-write repoint, Send to Noise Oscillator) go
  // through SerumUI.edit, so they mark the preset edited (§8.8 dirty) and repaint the panel; every other member
  // is the host's own (methods bound to it).
  editorHost() {
    const H = this.host, ui = this;
    if (typeof Proxy !== 'function') return Object.assign({}, H, { edit: (fn, o) => ui.edit(fn, o) });
    return new Proxy(H, {
      get(t, k) {
        if (k === 'edit') return (fn, o) => ui.edit(fn, o);
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  /* ---------------------------------------------------------------- tile strip (row B, §13.13) */
  tileStrip() {
    const d = this.d, el = mk(d, 'div', 'sx-tiles'), lfo = [];
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Modulation sources (drag onto a control)');
    for (let e = 1; e <= N_ENV; e++) el.appendChild(this.makeTile('env' + e, () => 'ENV ' + e));
    for (let l = 1; l <= N_LFO; l++) { const t = this.makeTile('lfo' + l, () => 'LFO ' + l); lfo.push(t); el.appendChild(t); }
    el.append(this.makeTile('velo', () => 'VELO'), this.makeTile('note', () => 'NOTE'), this.makeTile('wheel', () => 'WHEEL'));
    // Macro tiles 1–8 (labels = the macro names; §13.13, §3.10): drag onto a control, the matrix or another macro tile
    // (swap) — on every page with the strip, the MATRIX page included
    for (let m = 1; m <= N_MAC; m++) {
      el.appendChild(this.makeTile('macro' + m, () => { const M = this.s().macros[m - 1]; return (M && M.name) || 'Macro ' + m; }, 'sx-mtile'));
    }
    this.custom(() => {
      const s = this.s(), n = Math.max(lfoTileCount(s), lfoNum(s.ui.mod), lfoNum(this.edSel));
      lfo.forEach((t, l) => t.classList.toggle('sx-hidden', l + 1 > n));
    });
    return el;
  }

  /* ---------------------------------------------------------------- MACROS 1–8 (inv B17) */
  // knob = destination m1…m8 (a macro tile dropped on it adds macroA → mB; its base is s.macros[k].v), tile = source
  // (drag; dropped on another macro's label swaps the two macros); the knob menu adds Rename… and the Phase-1 MIDI
  // learn target `macroN`
  macrosPanel() {
    const d = this.d, { el, body } = this.panel('MACROS'), grid = mk(d, 'div', 'sx-macros');
    for (let m = 0; m < N_MAC; m++) {
      const box = mk(d, 'div', 'sx-macro'), id = 'macro' + (m + 1), did = 'm' + (m + 1);
      const name = () => (this.s().macros[m] && this.s().macros[m].name) || 'Macro ' + (m + 1);
      const k = this.dKnob(did, '', { size: 'md', labelFn: name });
      const lab = k.el.querySelector ? k.el.querySelector('.wk-lab') : null;
      if (lab) lab.style.display = 'none';
      k.el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.macroMenu(m, e.clientX, e.clientY, k); });
      const tile = this.makeTile(id, name);
      tile.addEventListener('dblclick', e => { e.preventDefault(); this.renameMacro(m, box, tile); });
      tile.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); this.renameMacro(m, box, tile); } });
      box.append(k.el, tile);
      grid.appendChild(box);
    }
    body.appendChild(grid);
    return el;
  }
  macroMenu(m, x, y, k) {
    const did = 'm' + (m + 1), id = 'macro' + (m + 1), s = this.s();
    const items = knobMenuItems(s, this.fx(), did, { midi: typeof this.host.midiLearn === 'function', recent: this.recentSlot.get(did) })
      .filter(it => it.kind !== 'lock' && it.kind !== 'unlock');
    const acts = [{ label: 'Rename…', action: () => this.promptText('Rename Macro', 'Name', s.macros[m].name, t => {
      const v = String(t).trim().slice(0, 24) || 'Macro ' + (m + 1);
      this.edit(st => { st.macros[m].name = v; }, { label: 'Rename macro' });
      return true;
    }) }, { sep: true }].concat(this.menuActions(items, did, k.el, null, id));
    wk.contextMenu(x, y, acts, { anchor: k.el });
  }
  renameMacro(m, box, tile) {
    const d = this.d, i = mk(d, 'input');
    i.type = 'text'; i.maxLength = 24; i.value = this.s().macros[m].name;
    i.setAttribute('aria-label', 'Macro ' + (m + 1) + ' name');
    tile.classList.add('sx-hidden');
    box.appendChild(i);
    let done = false;
    const end = ok => {
      if (done) return;
      done = true;
      const v = i.value.trim().slice(0, 24);
      i.remove();
      tile.classList.remove('sx-hidden');
      if (ok) this.edit(s => { s.macros[m].name = v || 'Macro ' + (m + 1); }, { label: 'Rename macro' });
      tile.focus();
    };
    i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
    i.addEventListener('blur', () => end(true));
    i.focus();
    if (i.select) i.select();
  }

  /* ---------------------------------------------------------------- ENV 1–4 editor (inv B15, §13.13) */
  envPanel() {
    const d = this.d, { el, head, body, name } = this.panel('ENV');
    const E = () => clamp(this.s().ui.env | 0, 0, N_ENV - 1), id = k => () => 'e' + (E() + 1) + '.' + k;
    name.textContent = 'ENV';
    const tabs = mk(d, 'div', 'sx-etabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Envelope');
    const tb = [];
    for (let e = 0; e < N_ENV; e++) {
      const b = btn(d, '', String(e + 1), 'ENV ' + (e + 1), () => this.selectSrc('env' + (e + 1)));
      b.setAttribute('role', 'tab');
      // right-click / long-press: Bypass / Remove All Destinations of this envelope (inv B15)
      b.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); this.srcMenu('env' + (e + 1), ev.clientX, ev.clientY, b); });
      this.touchMenu(b);
      tb.push(b);
      tabs.appendChild(b);
    }
    this.custom(() => { const k = E(); tb.forEach((b, e) => b.setAttribute('aria-selected', e === k ? 'true' : 'false')); });
    const bpm = this.pToggle({ label: 'BPM', kind: 'btn', get: () => (this.s().env[E()] || {}).bpm ? 1 : 0, set: v => this.setEnvBpm(E(), v) });
    bpm.el.title = 'Time units: milliseconds or beats (BPM)';
    const lock = this.pToggle({ label: 'LOCK', kind: 'btn', get: () => this.s().ui.envLock, set: v => this.uiEdit(s => { s.ui.envLock = v ? 1 : 0; }) });
    lock.el.title = 'Lock: fit the whole envelope';
    const zoom = mk(d, 'input', 'sx-zoom');
    zoom.type = 'range'; zoom.min = '0'; zoom.max = '1'; zoom.step = '0.001';
    zoom.setAttribute('aria-label', 'Envelope zoom');
    const zOf = u => 0.01 * Math.pow(6400, u), uOf = z => Math.log(clamp(z, 0.01, 64) / 0.01) / Math.log(6400);
    zoom.addEventListener('input', () => this.uiEdit(s => { s.ui.envZoom = Math.round(zOf(+zoom.value) * 1000) / 1000; }));
    this.custom(() => { const s = this.s(); zoom.disabled = !!s.ui.envLock; if (d.activeElement !== zoom) zoom.value = String(uOf(s.ui.envZoom)); });
    const more = btn(d, 'sx-hbtn', icon(d, 'more'), 'Envelope menu', () => this.envMenu(E(), more));
    more.setAttribute('aria-haspopup', 'menu');
    head.append(tabs, mk(d, 'span', 'sx-grow'), bpm.el, lock.el, zoom, more);
    const box = mk(d, 'div', 'sx-edbox');
    body.appendChild(box);
    if (typeof gx.EnvEditor === 'function') {
      const ed = new gx.EnvEditor(box, {
        env: () => this.envVals(E()),
        set: (patch, ph) => this.setEnv(E(), patch, ph),
        ghosts: () => [0, 1, 2, 3].filter(k => k !== E() && (k === 0 || this.srcUsed('env' + (k + 1)))).map(k => this.envVals(k)),
        lock: () => !!this.s().ui.envLock,
        zoom: () => this.s().ui.envZoom,
        startEnd: () => E() > 0,
        grid: () => ({ beats: this.s().ui.envGrid ? 1 : 0, spb: 60 / this.bpm() }),
        steps: () => ((this.s().env[E()] || {}).bpm ? this.envLadderSec() : null),
        playhead: () => { const sn = this.snap, k = E(); return sn && sn.envStage && sn.envStage[k] ? { stage: sn.envStage[k], t: sn.envT ? sn.envT[k] : 0 } : null; },
      });
      this.bp.editors.push(ed);
      this.edSig.set(ed, () => {
        const s = this.s();
        return JSON.stringify([E(), [0, 1, 2, 3].map(k => this.envVals(k)), s.ui.envLock, s.ui.envZoom, s.ui.envGrid, arr(s.env).map(x => x && x.bpm), this.bpm(),
          this.srcUsed('env2'), this.srcUsed('env3'), this.srcUsed('env4')]);
      });
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'Envelope editor unavailable'));
    body.appendChild(this.row(this.dKnob(id('att'), 'ATTACK', { size: 'sm' }).el, this.dKnob(id('hold'), 'HOLD', { size: 'sm' }).el,
      this.dKnob(id('dec'), 'DECAY', { size: 'sm' }).el, this.dKnob(id('sus'), 'SUSTAIN', { size: 'sm' }).el,
      this.dKnob(id('rel'), 'RELEASE', { size: 'sm' }).el));
    // the curve handles are destinations too (§3.13): small knobs give them data-dest (lock, MIDI learn, drops);
    // ENV 2–4 add the Start / End levels (§6.14)
    const se = k => () => 'e' + Math.max(2, E() + 1) + '.' + k;
    const st = this.dKnob(se('start'), 'START', { size: 'sm' }), en = this.dKnob(se('end'), 'END', { size: 'sm' });
    this.custom(() => { const on1 = E() === 0; st.el.classList.toggle('sx-hidden', on1); en.el.classList.toggle('sx-hidden', on1); });
    const cur = this.row(this.dKnob(id('ca'), 'A CURVE', { size: 'sm' }).el, this.dKnob(id('cd'), 'D CURVE', { size: 'sm' }).el,
      this.dKnob(id('cr'), 'R CURVE', { size: 'sm' }).el, st.el, en.el);
    cur.classList.add('sx-envcurves');
    body.appendChild(cur);
    return el;
  }
  envMenu(k, anchor) {
    const s = this.s(), E = s.env[k] || {}, r = anchor.getBoundingClientRect(), m = 'env' + (k + 1);
    const sw = (label, key) => ({ label, checked: !!E[key], action: () => this.edit(st => { st.env[k][key] = st.env[k][key] ? 0 : 1; }, { label: 'Env ' + (k + 1) + ' ' + label }) });
    wk.contextMenu(r.left, r.bottom + 2, [
      sw('Legato Inverted', 'legInv'),
      { label: 'Grid', sub: [{ label: 'Time', checked: !s.ui.envGrid, action: () => this.uiEdit(st => { st.ui.envGrid = 0; }) },
        { label: 'Beats', checked: !!s.ui.envGrid, action: () => this.uiEdit(st => { st.ui.envGrid = 1; }) }] },
      sw('Voice Steal Retrigger', 'stealRe'),
      { sep: true },
      { label: 'Lock Module', checked: arr(s.locks.mod).includes(m), action: () => this.lockModuleUI(m) },
    ], { anchor });
  }
  // ENV_LADDER at the current tempo (seconds), for the BPM-unit editor steps (§6.14)
  envLadderSec() {
    const spb = 60 / this.bpm();
    return arr(core.ENV_LADDER).map(e => (isObj(e) ? e.beats : +e) * spb).filter(fin);
  }
  // seconds of an envelope time destination: BPM units read the ladder (ENV_LADDER[round(n·15)] beats at the tempo)
  envSec(k, key) {
    const id = 'e' + (k + 1) + '.' + key, n = this.getN(id), E = this.s().env[k] || {};
    if (E.bpm && (key === 'att' || key === 'hold' || key === 'dec' || key === 'rel')) {
      const L = this.envLadderSec();
      return L.length ? L[clamp(Math.round(n * (L.length - 1)), 0, L.length - 1)] : 0;
    }
    return core.lawValue(id, n);
  }
  envVals(k) {
    const P = 'e' + (k + 1) + '.', g = x => this.getN(P + x);
    const v = { a: this.envSec(k, 'att'), h: this.envSec(k, 'hold'), d: this.envSec(k, 'dec'), s: core.lawValue(P + 'sus', g('sus')),
      r: this.envSec(k, 'rel'), ca: g('ca'), cd: g('cd'), cr: g('cr') };
    if (k > 0 && destOf(P + 'start')) { v.st = g('start'); v.en = g('end'); }
    return v;
  }
  // n of a time in seconds: BPM units → the nearest ladder entry (log distance), else the time law
  envN(k, key, sec) {
    const id = 'e' + (k + 1) + '.' + key, E = this.s().env[k] || {};
    if (E.bpm && (key === 'att' || key === 'hold' || key === 'dec' || key === 'rel')) {
      const L = this.envLadderSec();
      let best = 0, bd = Infinity;
      L.forEach((t, i) => { const dd = sec > 0 && t > 0 ? Math.abs(Math.log(t / sec)) : Math.abs(t - sec) * 1e3; if (dd < bd) { bd = dd; best = i; } });
      return L.length > 1 ? best / (L.length - 1) : 0;
    }
    return core.lawNorm(id, sec);
  }
  setEnv(k, patch, ph) {
    const P = 'e' + (k + 1) + '.';
    this.edit(s => {
      for (const key of Object.keys(patch || {})) {
        const f = ENV_ED[key], v = patch[key];
        if (!f || !fin(v)) continue;
        const id = P + f;
        if (!destOf(id)) continue;
        const n = f === 'ca' || f === 'cd' || f === 'cr' || f === 'start' || f === 'end' ? clamp01(v) : f === 'sus' ? core.lawNorm(id, v) : this.envN(k, f, v);
        s.p[id] = snapN(id, n);
      }
    }, { label: 'Env ' + (k + 1), phase: ph || 'set' });
  }
  // MS ↔ BPM units: the times convert to the nearest entry at the current tempo (§6.14, inv B15)
  setEnvBpm(k, on) {
    const keys = ['att', 'hold', 'dec', 'rel'], secs = keys.map(x => this.envSec(k, x));
    this.edit(s => {
      s.env[k].bpm = on ? 1 : 0;
      keys.forEach((x, i) => { const id = 'e' + (k + 1) + '.' + x; s.p[id] = snapN(id, this.envN(k, x, secs[i])); });
    }, { label: 'Env ' + (k + 1) + ' units' });
  }
  srcUsed(src) { return rowsOf(this.s()).some(r => r && (r.src === src || r.aux === src)); }

  /* ---------------------------------------------------------------- LFO 1–10 / VELO / NOTE editor (inv B16, §13.13) */
  lfoIdx() { const l = lfoNum(this.edSel); if (l) this.lastLfo = l - 1; return this.lastLfo || 0; }
  lfoPanel() {
    const d = this.d, P = this.bp, { el, head, body, name } = this.panel('LFO 1'), L = () => this.lfoIdx(), lf = () => this.s().lfo[L()];
    const isCurve = () => this.edSel === 'velo' || this.edSel === 'note', isPath = () => !isCurve() && lf().type === 'path';
    // the title is the module menu of the module shown (LFO n / VELO / NOTE; inv B16, B17): Lock Module, Init Module,
    // Copy, Copy (w/mods), Paste, Swap with ▸ — right-click, long-press or Enter; Copy / Paste between LFOs are the
    // menu equivalent of the LFO tiles' Alt-drag (§13.1)
    const modOf = () => (isCurve() ? this.edSel : 'lfo' + (L() + 1));
    name.tabIndex = 0;
    name.setAttribute('role', 'button');
    name.setAttribute('aria-haspopup', 'menu');
    const openMenu = (x, y) => this.moduleMenu(modOf(), x, y, name, () => this.srcDestItems(modOf()));
    name.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); });
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const r = name.getBoundingClientRect();
        openMenu(r.left, r.bottom + 2);
      }
    });
    longPress(name, openMenu);
    this.custom(() => {
      const t = isCurve() ? this.edSel.toUpperCase() : 'LFO ' + (L() + 1);
      if (name.textContent !== t) name.textContent = t;
      const al = t + ' module menu (lock, init, copy, paste' + (isCurve() ? ')' : ', swap)');
      if (name.getAttribute('aria-label') !== al) name.setAttribute('aria-label', al);
      el.classList.toggle('sx-locked', arr(this.s().locks.mod).includes(modOf()));
    });
    const lfoEd = (fn, label) => this.edit(s => fn(s.lfo[L()]), { label: 'LFO ' + (L() + 1) + ' ' + label });
    // LFO controls
    const lfoHead = mk(d, 'div', 'sx-edhead'), lfoHead2 = mk(d, 'div', 'sx-edhead'), lfoArea = mk(d, 'div', 'sx-pbody');
    const type = this.bind(wk.menu({ label: 'TYPE', arrows: true, items: () => LFO_TYPES.map(t => ({ v: t, label: LFO_TYPE_LABEL[t] || t })),
      get: () => lf().type || 'normal', set: v => { lfoEd(o => { o.type = v; }, 'type'); this.edDirty = true; } }));
    const mode = this.pSeg({ label: 'LFO mode', items: ['FREE', 'RETRIG', 'ENV'], get: () => Math.max(0, LFO_MODES.indexOf(lf().mode)),
      set: i => lfoEd(o => { o.mode = LFO_MODES[i]; }, 'mode') });
    const sw = (label, k, dis, title) => {
      const w = this.pToggle({ label, kind: 'btn', get: () => lf()[k], disabled: dis, set: v => lfoEd(o => { o[k] = v ? 1 : 0; }, label.toLowerCase()) });
      if (title) w.el.title = title;
      return w.el;
    };
    const noBpm = () => !lf().bpm;
    const dir = this.bind(wk.menu({ label: 'DIRECTION', arrows: true, items: () => LFO_DIRS.map((x, i) => ({ v: x, label: LFO_DIR_LABEL[i] })),
      get: () => lf().dir || 'fwd', set: v => lfoEd(o => { o.dir = v; }, 'direction') }));
    const grid = mk(d, 'input', 'sx-grid');
    grid.type = 'text';
    grid.setAttribute('aria-label', 'LFO grid: x or x,y (1–64)');
    grid.title = 'Grid (x or x,y), global to all LFOs';
    const commit = () => {
      const gg = parseGrid(grid.value);
      grid.classList.toggle('sx-bad', !gg);
      if (gg) { const c = this.s().lfoGrid; if (gg.x !== c.x || gg.y !== c.y) this.edit(s => { s.lfoGrid = gg; }, { label: 'LFO grid' }); this.edDirty = true; }
    };
    grid.addEventListener('change', commit);
    grid.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    this.custom(() => { if (d.activeElement !== grid) { const g = this.s().lfoGrid; grid.value = g.x === g.y ? String(g.x) : g.x + ',' + g.y; grid.classList.remove('sx-bad'); } });
    const folder = btn(d, 'sx-hbtn', icon(d, 'folder'), 'LFO shapes', () => this.lfoFolderMenu(folder));
    const big = btn(d, 'sx-hbtn', icon(d, 'zoom'), 'LFO Editor (large)', () => this.openLfoEditor());
    const tools = this.pSeg({ label: 'Drawing tool', items: LFO_TOOL_LABEL, get: () => Math.max(0, LFO_TOOL_IDS.indexOf(this.lfoTool)),
      disabled: isPath, set: i => this.setLfoTool(LFO_TOOL_IDS[i]) });
    lfoHead.append(type.el, mode.el, sw('MONO', 'mono', null, 'MONO: one LFO for every voice'), dir.el);
    lfoHead2.append(sw('BPM', 'bpm'), sw('DOT', 'dot', noBpm), sw('TRIP', 'trip', noBpm), sw('HOST', 'anchor', null, 'HOST: follow the song position'),
      grid, tools.el, folder, big);
    const box = mk(d, 'div', 'sx-edbox'), pbox = mk(d, 'div', 'sx-edbox');
    P.lfoBox = box;
    lfoArea.append(lfoHead, lfoHead2, box, pbox);
    if (typeof gx.CurveEditor === 'function') {
      const ed = new gx.CurveEditor(box, this.lfoEditorOpts(L, 160));
      P.lfoEd = ed;
      if (typeof ed.setTool === 'function') ed.setTool(this.lfoTool);
      this.bp.editors.push(ed);
      this.edSig.set(ed, () => { const o = lf(), g = this.s().lfoGrid; return JSON.stringify([L(), o.pts, o.loop, o.start, o.mode, o.type, g.x, g.y, this.lfoTool]); });
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'LFO editor unavailable'));
    if (typeof gx.PathEditor === 'function') {
      const ped = new gx.PathEditor(pbox, {
        get: () => lf().path,
        set: (path, ph) => this.edit(s => { s.lfo[L()].path = path; }, { label: 'LFO ' + (L() + 1) + ' path', phase: ph || 'set' }),
        grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
        height: 160,
        playhead: () => { const sn = this.snap, l = L(); return sn && sn.lfoOut && sn.lfoY && fin(sn.lfoOut[l]) ? [sn.lfoOut[l], sn.lfoY[l]] : null; },
      });
      this.bp.editors.push(ped);
      this.edSig.set(ped, () => JSON.stringify([L(), lf().path, this.s().lfoGrid]));
    }
    const lid = k => () => 'l' + (L() + 1) + '.' + k;
    const knobs = LFO_KNOBS.map(([k, t]) => this.dKnob(lid(k), t, { size: 'sm' }).el);
    if (destOf('l1.phase')) knobs.push(this.dKnob(lid('phase'), 'PHASE', { size: 'sm' }).el);
    lfoArea.appendChild(this.row(...knobs));
    // VELO / NOTE curve
    const curveArea = mk(d, 'div', 'sx-pbody'), cb = mk(d, 'div', 'sx-edbox'), cv = () => (this.edSel === 'note' ? 'note' : 'velo');
    if (typeof gx.CurveEditor === 'function') {
      const ed2 = new gx.CurveEditor(cb, {
        get: () => this.s()[cv()].pts,
        set: (pts, ph) => this.edit(s => { s[cv()].pts = pts; }, { label: cv() === 'note' ? 'Note curve' : 'Velocity curve', phase: ph || 'set' }),
        grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
        kind: 'curve', shapes: this.shapeLib(), height: 160,
      });
      this.bp.editors.push(ed2);
      this.edSig.set(ed2, () => JSON.stringify([cv(), this.s()[cv()].pts, this.s().lfoGrid]));
    }
    const follow = this.pToggle({ label: 'FOLLOW PORTAMENTO / LEGATO', kind: 'btn', get: () => this.s()[cv()].porta,
      set: v => this.edit(s => { s[cv()].porta = v ? 1 : 0; }, { label: 'Follow portamento' }) });
    curveArea.append(cb, this.row(follow.el));
    let shown = null;
    this.custom(() => {
      const c = isCurve(), pth = isPath();
      lfoArea.classList.toggle('sx-hidden', c);
      curveArea.classList.toggle('sx-hidden', !c);
      box.classList.toggle('sx-hidden', pth);
      pbox.classList.toggle('sx-hidden', !pth);
      const k = c ? this.edSel : 'lfo' + L() + (pth ? 'p' : '');
      if (k !== shown) { shown = k; this.edDirty = true; }
    });
    body.append(lfoArea, curveArea);
    void head;
    return el;
  }
  // the options of an LFO graph editor (panel editor and the LFO Editor overlay share them)
  lfoEditorOpts(L, height) {
    const lf = () => this.s().lfo[L()];
    return {
      get: () => lf().pts,
      set: (pts, ph) => this.edit(s => {
        // buses the points held before this edit (and at the start of a drag): those no point links any
        // more lose their rows once the gesture ends; other bus rows are never touched (inv A13)
        const o = s.lfo[L()], had = ptsBuses(o.pts);
        if (ph === 'start') this.lfoGest = had;
        else if (ph === 'move' && this.lfoGest) { for (const b of had) if (!this.lfoGest.includes(b)) this.lfoGest.push(b); }
        o.pts = pts;
        if (o.loop >= pts.length) o.loop = pts.length - 1;
        if (o.start >= pts.length) o.start = 0;
        if (ph !== 'move' && ph !== 'start') {
          const cut = had.concat((this.lfoGest || []).filter(b => !had.includes(b)));
          this.lfoGest = null;
          pruneLost(s, cut);
        }
      }, { label: 'LFO ' + (L() + 1) + ' shape', phase: ph || 'set' }),
      grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
      kind: 'lfo',
      tool: () => this.lfoTool,
      loop: () => lf().loop, setLoop: i => this.edit(s => { s.lfo[L()].loop = i; }, { label: 'LFO loop point' }),
      start: () => lf().start, setStart: i => this.edit(s => { s.lfo[L()].start = i; }, { label: 'LFO start point' }),
      playhead: () => (this.snap && this.snap.lfoPh && fin(this.snap.lfoPh[L()]) ? this.snap.lfoPh[L()] : null),
      pointMenu: (idxs, axis) => busMenuItems(this.s(), L(), idxs, axis).map(it => ({ label: it.label, checked: it.checked,
        action: () => (it.label === 'New bus' ? this.linkNew(L(), idxs, axis, this.s().ui.mod)
          : this.edit(s => linkPoints(s, this.fx(), L(), idxs, axis, it.bus, null), { label: 'Modulate point' })) })),
      removePointMods: idxs => this.edit(s => core.clearPointMods(s, L(), idxs), { label: 'Remove Point Modulations' }),
      fromWavetable: () => OSC_L.map((x, o) => ({ label: 'From OSC ' + x, action: () => this.wtToLfo(o) })),
      shapes: this.shapeLib(),
      bipolar: false, readOnly: false, height,
    };
  }
  setLfoTool(t) {
    this.lfoTool = LFO_TOOL_IDS.includes(t) ? t : 'point';
    for (const P of this.allPages()) if (P.lfoEd && typeof P.lfoEd.setTool === 'function') P.lfoEd.setTool(this.lfoTool);
    if (this.big && typeof this.big.setTool === 'function') this.big.setTool(this.lfoTool);
    this.queue();
  }
  // the LFO Editor overlay (§13.13): the same editor at full size with the drawing tools; Path-type LFOs use PathEditor
  openLfoEditor() {
    if (typeof gx.lfoEditorLarge !== 'function') { this.notify('LFO Editor not available'); return null; }
    if (this.big) this.big.close();
    const l = this.lfoIdx(), L = () => l, lf = this.s().lfo[l], path = lf && lf.type === 'path';
    const o = path ? {
      path: true, get: () => this.s().lfo[l].path, set: (p, ph) => this.edit(s => { s.lfo[l].path = p; }, { label: 'LFO ' + (l + 1) + ' path', phase: ph || 'set' }),
      grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
    } : this.lfoEditorOpts(L);
    o.title = 'LFO ' + (l + 1) + ' Editor';
    o.tool = { get: () => this.lfoTool, set: t => this.setLfoTool(t) };
    o.onClose = () => { this.big = null; };
    const B = gx.lfoEditorLarge(this.el, o);
    if (!B) return null;
    this.big = { ed: B.editor, setTool: B.setTool, close: () => B.close() };
    this.edSig.set(B.editor, () => JSON.stringify([l, this.s().lfo[l].pts, this.s().lfo[l].path, this.s().lfoGrid, this.lfoTool]));
    return B;
  }
  lfoFolderMenu(anchor) {
    const lib = this.shapeLib(), L = this.lfoIdx(), r = anchor.getBoundingClientRect();
    const apply = (pts, name) => this.edit(s => {
      const cut = ptsBuses(s.lfo[L].pts);
      s.lfo[L].pts = clone(pts); s.lfo[L].loop = -1; s.lfo[L].start = 0;
      pruneLost(s, cut);
    }, { label: 'Load shape ' + name });
    const list = lib.list(), fac = list.filter(x => x.factory), user = list.filter(x => !x.factory);
    const load = fac.map(x => ({ label: x.name, action: () => { apply(x.pts, x.name); this.edDirty = true; } }));
    if (user.length) load.push({ sep: true }, ...user.map(x => ({ label: x.name, action: () => { apply(x.pts, x.name); this.edDirty = true; } })));
    const items = [
      { label: 'Load Shape', sub: load.length ? load : [{ label: '(none)', disabled: true }] },
      { label: 'Save Shape…', action: () => this.promptText('Save Shape', 'Name', 'Shape ' + (user.length + 1), t => {
        const n = String(t).trim();
        if (!n) return false;
        lib.save(n, this.s().lfo[L].pts);
        this.notify('Saved shape “' + n + '”');
        return true;
      }) },
    ];
    if (user.length) items.push({ label: 'Delete Shape', sub: user.map(x => ({ label: x.name, action: () => lib.del(x.name) })) });
    items.push({ sep: true },
      { label: 'Import Library…', action: () => pickFile(this.d, '.json,application/json').then(f => f && lib.importFile(f)).then(n => { if (n) this.notify('Imported ' + n + ' shape' + (n > 1 ? 's' : '')); }, () => this.notify('Could not read that file')) },
      { label: 'Export Library…', action: () => lib.exportFile() },
      { sep: true },
      { label: 'Wavetable to LFO Shape', sub: OSC_L.map((x, o) => ({ label: 'From OSC ' + x, action: () => this.wtToLfo(o) })) });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }
  // shape library (deviation 10: JSON, no .shp): factory pts.SHAPES + synth.sx.shapes [{name, pts}]
  shapeLib() {
    if (this.shapes) return this.shapes;
    if (typeof gx.shapeLib === 'function') return (this.shapes = gx.shapeLib(this.host.storage, SHAPES_KEY));
    const okPts = p => Array.isArray(p) && p.length >= 2 && p.length <= 480 && p.every(q => Array.isArray(q) && fin(q[0]) && fin(q[1]));
    const fac = () => {
      const S = gx.pts && gx.pts.SHAPES;
      if (Array.isArray(S)) return S.filter(x => x && okPts(x.pts)).map(x => ({ name: x.name, pts: x.pts, factory: true }));
      if (isObj(S)) return Object.keys(S).filter(k => okPts(S[k])).map(k => ({ name: k, pts: S[k], factory: true }));
      return [];
    };
    const user = () => arr(this.store('get', SHAPES_KEY, [])).filter(x => x && typeof x.name === 'string' && okPts(x.pts));
    this.shapes = {
      list: () => fac().concat(user().map(x => ({ name: x.name, pts: x.pts, factory: false }))),
      save: (name, pts) => {
        const n = String(name).trim().slice(0, 48);
        if (!n || !okPts(pts)) return;
        this.store('set', SHAPES_KEY, user().filter(x => x.name !== n).concat([{ name: n, pts: clone(pts) }]));
      },
      del: name => this.store('set', SHAPES_KEY, user().filter(x => x.name !== name)),
      exportFile: () => download(this.d, 'shapes.json', JSON.stringify({ type: 'synth.sx.shapes', v: 1, shapes: user() }, null, 1)),
      importFile: file => fileText(file).then(t => {
        const o = JSON.parse(t), add = arr(Array.isArray(o) ? o : o && o.shapes).filter(x => x && typeof x.name === 'string' && okPts(x.pts));
        const keep = user().filter(x => !add.some(a => a.name === x.name));
        this.store('set', SHAPES_KEY, keep.concat(add.map(x => ({ name: x.name.slice(0, 48), pts: x.pts }))));
        return add.length;
      }),
    };
    return this.shapes;
  }

  /* ---------------------------------------------------------------- VOICING (inv A17, B19; §13.13) */
  voicingPanel() {
    const d = this.d, { el, body } = this.panel('VOICING'), v = () => this.s().voicing;
    const tg = (label, k, title) => {
      const w = this.pToggle({ label, kind: 'btn', get: () => v()[k], set: x => this.edit(s => { s.voicing[k] = x ? 1 : 0; }, { label: 'Voicing ' + label.toLowerCase() }) });
      if (title) w.el.title = title;
      return w.el;
    };
    const poly = this.pNum({ label: 'POLY', min: 1, max: 32, step: 1, def: 8, px: 160, get: () => v().poly, disabled: () => !!v().mono,
      set: (x, ph) => this.edit(s => { s.voicing.poly = x; }, { label: 'Polyphony', phase: ph }) });
    const polyMenu = (x, y) => {
      const s = this.s();
      wk.contextMenu(x, y, [
        { label: 'Limit Same Note Poly to 1', checked: !!s.voicing.oneNote, action: () => this.edit(st => { st.voicing.oneNote = st.voicing.oneNote ? 0 : 1; }, { label: 'One voice per note' }) },
        { label: 'Voice Steal Priority', sub: STEAL_LABEL.map((t, i) => ({ label: t, checked: (s.voicing.steal | 0) === i,
          action: () => this.edit(st => { st.voicing.steal = i; }, { label: 'Voice steal priority' }) })) },
        { sep: true },
        { label: 'Lock Polyphony', checked: !!s.locks.misc.poly, action: () => this.edit(st => { st.locks.misc.poly = st.locks.misc.poly ? 0 : 1; }, { label: 'Lock Polyphony' }) },
      ], { anchor: poly.el.querySelector('.sx-nfv') });
    };
    poly.el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); polyMenu(e.clientX, e.clientY); });
    longPress(poly.el, polyMenu);
    this.custom(() => poly.el.classList.toggle('sx-locked-ctl', !!this.s().locks.misc.poly));
    // BEND UP / DOWN: g.bu2 / g.bd2 (0…48 / −48…0), in S1 mode the v1 g.bendup / g.benddn (±24), kept in sync by syncS1
    const bends = [];
    const bend = (s2, v1, label) => {
      const a = destOf(s2) ? this.dNum(s2, label) : null, b = this.dNum(v1, label);
      if (a) bends.push([a.el, false]);
      bends.push([b.el, true]);
      return [a && a.el, b.el];
    };
    const bu = bend('g.bu2', 'g.bendup', 'BEND UP'), bd = bend('g.bd2', 'g.benddn', 'BEND DOWN');
    this.custom(() => { const s1 = s1On(this.s()) || !destOf('g.bu2'); for (const [e, isV1] of bends) e.classList.toggle('sx-hidden', isV1 !== s1); });
    const vc = mk(d, 'span', 'sx-rate');
    this.custom(() => { const t = this.vcText ? this.vcText + ' voices' : ''; if (vc.textContent !== t) vc.textContent = t; });
    body.append(this.row(tg('MONO', 'mono'), tg('LEGATO', 'legato', 'Legato (with Mono off: poly legato)'), poly.el),
      this.row(this.dKnob('g.porta', 'PORTA').el, this.dKnob('g.curve', 'CURVE', { size: 'sm' }).el),
      this.row(tg('ALWAYS', 'always', 'Glide even without overlapping notes'), tg('SCALED', 'scaled', 'Glide time scales with the interval (1 octave = PORTA)')),
      this.row(...bu.filter(Boolean), ...bd.filter(Boolean)),
      this.row(vc));
    return el;
  }

  /* ================================================================ MIX page (§13.4; sx-ui-mix MixerPage, U3) */
  buildMix(el) {
    const d = this.d, box = mk(d, 'div', 'sx-mixbox'), P = this.bp;
    box.appendChild(mk(d, 'p', 'sx-placeholder', 'Loading the mixer…'));
    el.append(box, this.tileStrip(), this.rowC());
    const fail = msg => { if (!this.dead) { box.textContent = ''; box.appendChild(mk(d, 'p', 'sx-placeholder', msg)); } };
    this.mixReady = loadMix().then(M => {
      if (this.dead) return;
      if (!M || typeof M.MixerPage !== 'function') { fail('Mixer unavailable'); return; }
      box.textContent = '';
      const prev = this.bp;
      this.bp = P;
      try { this.mixer = new M.MixerPage(box, this.kit); } catch (err) { console.error('serum-ui: mixer', err); fail('The mixer could not be shown'); } finally { this.bp = prev; }
      if (this.page === 'mix') { this.edDirty = true; this.paint(true); }
    }, err => { warnOnce('mix', 'serum-ui: sx-ui-mix.js not available', err); fail('Mixer unavailable'); });
  }

  /* ================================================================ FX page (§13.5; fx-ui FXRackUI v2, U3) */
  buildFx(el) {
    const d = this.d, box = mk(d, 'div', 'sx-fxbox'), R = fxui.FXRackUI;
    if (typeof R === 'function') {
      const adapter = {
        fx: () => this.fx(),
        editFx: (fn, o) => this.editFx(fn, o, true),
        bpm: () => this.bpm(),
        gr: () => (this.smon && this.smon.gr ? this.smon.gr : null),
        tap: () => (this.smon && this.smon.ftap ? this.smon.ftap : null),   // the rack's monitor tap (§13.5 Delay overlay)
        setTap: inst => { if (typeof this.host.fxTap === 'function') this.host.fxTap(inst); },
        locked: id => arr(this.s().locks.p).includes(id),
        storage: this.host.storage,
        notify: t => this.notify(t),
        tip: id => this.tipText(id) || null, // FX knob tooltips with Serum's modulator lines (RULINGS host additions)
        racks: () => 3,                      // MAIN · BUS 1 · BUS 2 (§11.15)
        irs: this.host.smp || null,          // Convolve impulse responses
        s: () => this.s(),                   // rows / locks of the Serum state (instance removal, §11.2)
        edit: (fn, o) => this.edit(fn, o),
      };
      try { this.rack = new R(box, adapter, { embedded: true, dsp: globalThis.FXDSP || null, racks: 3, mod: true }); }
      catch (err) { console.error('serum-ui: FX rack', err); box.appendChild(mk(d, 'p', 'sx-placeholder', 'FX rack unavailable')); }
    } else box.appendChild(mk(d, 'p', 'sx-placeholder', 'FX rack unavailable'));
    el.append(box, this.tileStrip(), this.rowC());
  }

  /* ================================================================ ARP / CLIP pages (§13.7, §13.8; sx-ui-seq, U4) */
  buildSeq(el, kind) {
    const d = this.d, bar = mk(d, 'div', 'sx-pagebar'), box = mk(d, 'div', 'sx-seqbox');
    const C = kind === 'arp' ? seq.ArpPage : seq.ClipPage;
    if (typeof C === 'function') {
      try { this.seqPages[kind] = new C(box, this.kit); } catch (err) { console.error('serum-ui: ' + kind, err); box.appendChild(mk(d, 'p', 'sx-placeholder', 'Page unavailable')); }
    } else box.appendChild(mk(d, 'p', 'sx-placeholder', 'Page unavailable'));
    // macros pane toggle (§13.2: own lower layout; the macros pane shows on demand) — unless the page brings its own
    // (the CLIP page's macro knobs write their clip lanes while recording, §13.8)
    const own = box.querySelector && box.querySelector('[data-sec="macros"]');
    if (own) { el.append(box); return; }
    const mac = this.macrosPanel();
    const tg = this.pToggle({ label: 'MACROS', kind: 'btn', get: () => (this.macPane[kind] ? 1 : 0),
      set: v => { this.macPane[kind] = !!v; this.queue(); } });
    tg.el.title = 'Show the macros pane';
    this.custom(() => mac.classList.toggle('sx-hidden', !this.macPane[kind]));
    bar.append(mk(d, 'span', 'sx-grow'), tg.el);
    el.append(bar, box, mac);
  }


  /* ================================================================ MATRIX page (§13.6, inv B18): 64 rows */
  buildMatrix(el) {
    const d = this.d, { el: pan, head, body } = this.panel('MATRIX', 'matrix');
    const mb = btn(d, 'sx-hbtn', icon(d, 'more'), 'Matrix menu', () => this.matrixMenu(mb));
    mb.setAttribute('aria-haspopup', 'menu');
    const exp = this.pToggle({ label: 'EXPAND', kind: 'btn', get: () => (this.mxExp ? 1 : 0), set: () => this.toggleExpand() });
    exp.el.title = 'Expand the matrix (Alt/Option-F)';
    head.append(mk(d, 'span', 'sx-grow'), exp.el, mb);
    const hd = mk(d, 'div', 'sx-mhd');
    hd.setAttribute('aria-hidden', 'true');
    for (const t of ['', '#', 'SOURCE', 'CRV', 'AMOUNT', 'POL', 'DESTINATION', 'OUT', 'AUX SOURCE', 'INV', 'CRV', 'OUTPUT', 'BYP', '']) hd.appendChild(mk(d, 'span', '', t));
    const list = mk(d, 'div', 'sx-mx');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Modulation matrix, ' + N_MX + ' slots');
    for (let slot = 0; slot < N_MX; slot++) list.appendChild(this.matrixRow(slot));
    this.mxList = list;
    body.append(hd, list);
    el.append(pan, this.tileStrip());
  }
  matrixMenu(anchor) {
    const r = anchor.getBoundingClientRect(), s = this.s(), locked = arr(s.locks.mod).includes('matrix');
    wk.contextMenu(r.left, r.bottom + 2, [
      { label: 'Sort by Source', action: () => { if (this.need('sortMatrix')) this.edit(st => core.sortMatrix(st, 'src'), { label: 'Sort matrix' }); } },
      // destination-menu order: FX rows follow the rack / instance order of the track's FX state (§5.8)
      { label: 'Sort by Destination', action: () => { if (this.need('sortMatrix')) { const fx = this.fx(); this.edit(st => core.sortMatrix(st, 'dst', fx), { label: 'Sort matrix' }); } } },
      { label: 'Lock Matrix', checked: locked, action: () => this.lockModuleUI('matrix') },
      { sep: true },
      { label: 'Create Vibrato', action: () => this.vibrato() },
      { label: 'Create Velo->Amp', action: () => this.veloAmp() },
      { sep: true },
      { label: 'Apply and Delete Macros', action: () => this.confirmDlg('Apply and Delete Macros', 'Add every macro modulation at the macros\' current values to the controls, then delete the macro rows?', () => {
        if (!this.need('applyMacros')) return;
        const fx = this.fx();
        let n = 0;
        this.edit(st => { n = core.applyMacros(st, fx); }, { label: 'Apply and Delete Macros' });
        if (fx) this.editFx(() => {}, { label: 'Apply and Delete Macros' });   // the FX bases applyMacros wrote
        this.notify(n ? 'Applied ' + n + ' macro row' + (n > 1 ? 's' : '') : 'No macro rows');
      }) },
      { label: 'Init Modulations', action: () => this.confirmDlg('Init Modulations', 'Remove every modulation row and LFO point link?', () => {
        if (this.need('initMods')) { this.edit(st => core.initMods(st), { label: 'Init Modulations' }); this.edDirty = true; }
      }) },
    ], { anchor });
  }
  destItems() {
    if (this.dstT !== this.paintSeq || !this.dstC) {
      const items = [{ v: '', label: '—', group: '' }];
      for (const g of this.destGroups()) for (const x of g.items) items.push({ v: x.id, label: x.label, group: g.group });
      this.dstC = items;
      this.dstT = this.paintSeq;
    }
    return this.dstC;
  }
  srcItems() {
    if (this.srcT !== this.paintSeq || !this.srcC) {
      const items = [{ v: '', label: '—', group: '' }];
      for (const g of srcGroups(this.s())) for (const x of g.items) items.push({ v: x.id, label: x.label, group: g.group });
      this.srcC = items;
      this.srcT = this.paintSeq;
    }
    return this.srcC;
  }
  // one row (§13.6): handle (drag = reorder; click = row menu) · # · SOURCE · CRV · AMOUNT · POL · DESTINATION (≈ for
  // aliased S1-pair rows; red for deleted FX instances / not modulatable) · OUT (live mAmt·x, snapshot.mOut) · AUX
  // SOURCE · INV · aux CRV · OUTPUT · bypass · remove
  matrixRow(slot) {
    const d = this.d, R = () => this.s().matrix[slot];
    const row = mk(d, 'div', 'sx-mrow');
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', 'Slot ' + (slot + 1));
    row.setAttribute('data-mslot', String(slot));
    const mmenu = (label, field) => {
      const w = this.bind(wk.menu({ label, items: () => (field === 'dst' ? this.destItems() : this.srcItems()), get: () => R()[field], arrows: false,
        set: v => this.edit(s => { s.matrix[slot][field] = v; }, { label: 'Matrix ' + label.toLowerCase() }) }));
      return w.el;
    };
    const cell = (cls, child, attrs) => {
      const c = mk(d, 'div', cls);
      for (const k in attrs || {}) c.setAttribute(k, attrs[k]);
      if (child) c.appendChild(child);
      return c;
    };
    const pct = a => sgn(a) + Math.round(a * 100) + '%';
    const amt = this.slider({ label: 'Amount', get: () => (R().amt + 1) / 2, def: 0.5, bipolar: true, orient: 'h', fmt: n => pct(2 * n - 1),
      parse: t => { const a = parseAmount(t, R().dst, R().bi); return a === null ? null : (a + 1) / 2; },
      set: (n, ph) => this.edit(s => core.setModAmount(s, slot, Math.round((2 * n - 1) * 1e4) / 1e4), { label: 'Matrix amount', phase: ph || 'set' }) });
    if (wk.tooltip) wk.tooltip(amt.el, () => 'Amount ' + pct(R().amt) + ' (type a percentage, or 12st on pitch destinations; Cmd/Ctrl-click resets)');
    const native = typeof wk.slider === 'function';   // wk.slider shows its value and takes typed entry itself
    const amtV = native ? null : this.valBox(() => pct(R().amt), t => parseAmount(t, R().dst, R().bi),
      a => this.edit(s => core.setModAmount(s, slot, a), { label: 'Matrix amount' }), 'Amount: percent, or semitones (12st) on pitch destinations');
    const out = this.slider({ label: 'Output', get: () => R().out, def: 1, bipolar: false, orient: 'h', fmt: n => Math.round(n * 100) + '%',
      parse: t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t)); return m ? clamp01(parseFloat(m[1].replace(',', '.')) / 100) : null; },
      set: (n, ph) => this.edit(s => { s.matrix[slot].out = Math.round(clamp01(n) * 1e4) / 1e4; }, { label: 'Matrix output', phase: ph || 'set' }) });
    const outV = native ? null : this.valBox(() => Math.round(R().out * 100) + '%', t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t)); return m ? clamp01(parseFloat(m[1].replace(',', '.')) / 100) : null; },
      v => this.edit(s => { s.matrix[slot].out = v; }, { label: 'Matrix output' }), 'Output (percent)');
    const pol = this.mBtn(() => (R().bi ? '↔' : '→'), () => this.edit(s => { const r = s.matrix[slot]; r.bi = r.bi ? 0 : 1; }, { label: 'Matrix polarity' }),
      () => 'Polarity: ' + (R().bi ? 'bipolar' : 'unipolar'));
    const inv = this.mBtn(() => (R().inv ? 'INV' : 'inv'), () => this.edit(s => { const r = s.matrix[slot]; r.inv = r.inv ? 0 : 1; }, { label: 'Aux invert' }),
      () => 'Aux invert ' + (R().inv ? 'on' : 'off') + '; Alt-click toggles bypass');
    this.custom(() => inv.classList.toggle('sx-on', !!R().inv));
    const byp = this.pToggle({ label: 'Bypass', kind: 'led', get: () => R().byp, set: v => this.edit(s => { s.matrix[slot].byp = v ? 1 : 0; }, { label: 'Matrix bypass' }) });
    const del = btn(d, 'sx-hbtn', icon(d, 'close'), 'Remove slot ' + (slot + 1), () => this.edit(s => { s.matrix[slot] = emptyRow(); }, { label: 'Remove modulation' }));
    const handle = btn(d, 'sx-mh', icon(d, 'grip'), 'Slot ' + (slot + 1) + ': drag to reorder, click for the row menu', () => this.rowMenu(slot, handle));
    this.rowDrag(handle, slot);
    const ac = mk(d, 'div', 'sx-mamt'), oc = mk(d, 'div', 'sx-mout');
    ac.append(amt.el); oc.append(out.el);
    if (amtV) ac.appendChild(amtV);
    if (outV) oc.appendChild(outV);
    const dst = cell('sx-mdst', mmenu('Destination', 'dst')), alias = mk(d, 'span', 'sx-alias', '≈');
    alias.title = 'Aliased: this row targets the other mode\'s field of an S1 pair (compiled against the active field)';
    dst.appendChild(alias);
    // OUT: the row's live output of the recent voice (snapshot.mOut, §6.20)
    const og = mk(d, 'span', 'sx-mout-g'), ob = mk(d, 'i');
    og.appendChild(ob);
    og.setAttribute('role', 'img');
    og.setAttribute('aria-label', 'Live output');
    const live = () => {
      const mo = this.snap && this.snap.mOut, v = mo && mo.length > slot && fin(mo[slot]) ? clamp(mo[slot], -1, 1) : 0;
      const k = Math.round(v * 100);
      if (og.lastK === k) return;
      og.lastK = k;
      ob.style.left = (50 + Math.min(0, k) / 2) + '%';
      ob.style.width = (Math.abs(k) / 2) + '%';
    };
    (this.bp || this.headPage).lives.push(on => { if (on) live(); });   // no DOM writes while the MATRIX page is hidden
    row.append(handle, mk(d, 'span', 'sx-mn', String(slot + 1)),
      cell('sx-msrc sx-mslot', mmenu('Source', 'src'), { 'data-msrc': 'src', 'data-slot': slot, 'data-malt': 'src' }),
      cell('sx-mcrv', this.curveCell(slot, 'curve')), ac, cell('sx-mpol', pol), dst, cell('sx-mo', og),
      cell('sx-maux sx-mslot', mmenu('Aux source', 'aux'), { 'data-msrc': 'aux', 'data-slot': slot }),
      cell('sx-minv', inv, { 'data-malt': 'mode', 'data-slot': slot }), cell('sx-macrv', this.curveCell(slot, 'acurve')),
      oc, cell('sx-mbyp', byp.el), cell('sx-mx-x', del));
    this.custom(() => {
      const r = R(), s = this.s();
      row.classList.toggle('sx-dim', !rowActive(r));
      row.classList.toggle('sx-bad', rowBad(this.fx(), r));
      alias.classList.toggle('sx-hidden', !rowAlias(s, r));
      del.classList.toggle('sx-hidden', !r.src && !r.dst);
      live();
    });
    return row;
  }
  // drag the handle onto another row: the row moves there (the rows between shift by one, §13.6). A finger keeps the
  // 250 ms hold (wk.dragSource without scrollAxis): the handles line the scrolling matrix list, so a swipe over them
  // reorders nothing
  rowDrag(handle, slot) {
    if (typeof wk.dragSource !== 'function') return;
    let line = null;
    const target = i => { const t = closest(i.target, '[data-mslot]'); return t && this.mxList && this.mxList.contains(t) ? t : null; };
    const clear = () => { if (line) { line.classList.remove('sx-dropline'); line = null; } };
    const ds = wk.dragSource(handle, {
      data: slot,
      move: i => { const t = target(i); if (t !== line) { clear(); line = t; if (t) t.classList.add('sx-dropline'); } },
      drop: i => {
        const t = target(i);
        clear();
        if (!t) return;
        const to = +t.getAttribute('data-mslot');
        if (to === slot) return;
        if (i.alt) { this.edit(s => { s.matrix[to] = clone(s.matrix[slot]); }, { label: 'Copy modulation' }); return; }
        this.edit(s => { const M = s.matrix, r = M.splice(slot, 1)[0]; M.splice(to, 0, r); }, { label: 'Move modulation' });
      },
      cancel: clear,
    });
    this.offs.push(() => ds.destroy());
  }
  mBtn(text, click, title) {
    const b = btn(this.d, 'sx-btn', '', null, click);
    this.custom(() => {
      const t = text(), ti = title();
      if (b.textContent !== t) b.textContent = t;
      b.setAttribute('aria-label', ti);
      b.title = ti;
    });
    return b;
  }
  // clickable value text with typed entry (Enter / click → input; Enter commits through parse)
  valBox(text, parse, commit, label) {
    const d = this.d, v = mk(d, 'span', 'sx-mval');
    v.tabIndex = 0;
    v.setAttribute('role', 'button');
    v.title = label;
    this.custom(() => { if (!v.firstChild || v.firstChild.nodeType === 3 || !v.querySelector('input')) { const t = text(); if (v.textContent !== t) v.textContent = t; v.setAttribute('aria-label', label + ': ' + t); } });
    const edit = () => {
      if (v.querySelector && v.querySelector('input')) return;
      const i = mk(d, 'input');
      i.type = 'text'; i.value = text();
      i.setAttribute('aria-label', label);
      v.textContent = '';
      v.appendChild(i);
      let done = false;
      const end = ok => {
        if (done) return;
        done = true;
        const t = i.value;
        i.remove();
        v.textContent = text();
        if (ok) { const x = parse(t); if (x !== null && fin(x)) commit(x); else this.notify('Could not read “' + t + '”'); }
        v.focus();
      };
      i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
      i.addEventListener('blur', () => end(true));
      i.addEventListener('pointerdown', e => e.stopPropagation());
      i.focus();
      if (i.select) i.select();
    };
    v.addEventListener('click', edit);
    v.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
    return v;
  }
  // CRV / aux CRV columns: thumbnail of the curve (bend(·, MC_K·c), or the Editable Curve of the row); drag vertically
  // (200 px = −1…+1; on an editable curve the drag is off), double-click / double-tap opens the editor (CRV) or resets
  // (aux CRV); grey while the row is bypassed
  curveCell(slot, field) {
    const d = this.d, aux = field === 'acurve', sv = svgEl(d, 'svg', { class: 'sx-crv', viewBox: '0 0 36 22', tabindex: '0', role: 'slider',
      'aria-label': aux ? 'Aux curve' : 'Curve', 'aria-valuemin': '-100', 'aria-valuemax': '100' });
    const path = svgEl(d, 'path', { d: '' });
    sv.appendChild(path);
    const R = () => this.s().matrix[slot];
    let last = null, g = null;
    this.custom(() => {
      const r = R(), c = r[field] || 0, crv = !aux && Array.isArray(r.crv) && r.crv.length >= 2 ? r.crv : null;
      const k = (crv ? JSON.stringify(crv) : c) + '|' + (r.byp ? 1 : 0);
      if (k === last) return;
      last = k;
      let dd = '';
      for (let j = 0; j <= 18; j++) {
        const t = j / 18, y = crv && typeof core.evalPts === 'function' ? core.evalPts(crv, t) : core.bend(t, MC_K * c);
        dd += (j ? 'L' : 'M') + (2 + 32 * t).toFixed(2) + ' ' + (20 - 18 * clamp01(y)).toFixed(2);
      }
      path.setAttribute('d', dd);
      sv.setAttribute('aria-valuenow', String(Math.round(c * 100)));
      sv.classList.toggle('sx-edc', !!crv);
      sv.classList.toggle('sx-grey', !!r.byp);
    });
    const put = (c, ph) => this.edit(s => { s.matrix[slot][field] = Math.round(clamp(c, -1, 1) * 1e4) / 1e4; }, { label: aux ? 'Aux curve' : 'Matrix curve', phase: ph });
    sv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (!aux && Array.isArray(R().crv)) return;
      e.preventDefault();
      g = { id: e.pointerId, y: e.clientY, c0: R()[field] || 0, acc: 0, moved: false };
      try { sv.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    sv.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      g.acc += (g.y - e.clientY) * (e.shiftKey ? 0.1 : 1) / 100;
      g.y = e.clientY;
      if (!g.moved && Math.abs(g.acc) > 0.02) { g.moved = true; put(g.c0, 'start'); }
      if (g.moved) put(g.c0 + g.acc, 'move');
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      g = null;
      if (!G.moved) return;
      if (twoF(e)) { G.acc = 0; put(G.c0, 'move'); }   // two-finger rollback: the curve from before
      put(G.c0 + G.acc, 'end');
    };
    sv.addEventListener('pointerup', up);
    sv.addEventListener('pointercancel', up);
    sv.addEventListener('dblclick', e => { e.preventDefault(); if (aux) put(0, 'set'); else this.openCurve(slot, sv); });
    sv.addEventListener('keydown', e => {
      const k = e.key, c = R()[field] || 0;
      if (k === 'ArrowUp' || k === 'ArrowRight') { e.preventDefault(); put(c + (e.shiftKey ? 0.01 : 0.05), 'set'); }
      else if (k === 'ArrowDown' || k === 'ArrowLeft') { e.preventDefault(); put(c - (e.shiftKey ? 0.01 : 0.05), 'set'); }
      else if (k === 'Delete' || k === 'Backspace' || k === 'Home') { e.preventDefault(); put(0, 'set'); }
      else if (k === 'Enter' && !aux) { e.preventDefault(); this.openCurve(slot, sv); }
    });
    return sv;
  }
  // Editable Curve (§13.6; graph CurveEditor kind 'mcurve' with RISE / FALL and SmoothLink) of a row, in a popover
  openCurve(slot, anchor) {
    if (typeof gx.CurveEditor !== 'function') { this.notify('Curve editor not available'); return null; }
    const R = () => this.s().matrix[slot], c0 = R().curve || 0;
    const init = () => { const pts = []; for (let j = 0; j <= 4; j++) { const t = j / 4; pts.push([t, Math.round(core.bend(t, MC_K * c0) * 1e5) / 1e5, 0]); } return pts; };
    return this.popover('crv' + slot, anchor || this.el, 'Slot ' + (slot + 1) + ' curve', box => new gx.CurveEditor(box, {
      kind: 'mcurve', height: 160,
      get: () => (Array.isArray(R().crv) && R().crv.length >= 2 ? R().crv : init()),
      set: (pts, ph) => this.edit(s => { s.matrix[slot].crv = pts; }, { label: 'Matrix curve', phase: ph || 'set' }),
      slew: {
        get: () => ({ rise: R().rise || 0, fall: R().fall || 0, slink: R().slink || 0 }),
        set: (p, ph) => this.edit(s => {
          const r = s.matrix[slot];
          for (const k of ['rise', 'fall', 'slink']) if (p && p[k] !== undefined) r[k] = k === 'slink' ? (p[k] ? 1 : 0) : clamp01(p[k]);
          if (r.slink) r.fall = r.rise;
        }, { label: 'Matrix slew', phase: ph || 'set' }),
      },
      init: () => this.edit(s => { s.matrix[slot].crv = null; }, { label: 'Init curve' }),
      grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
    }), () => JSON.stringify([R().crv, R().rise, R().fall, R().slink, R().curve]));
  }
  rowMenu(slot, anchor) {
    const r = anchor.getBoundingClientRect(), s = this.s();
    const swap = (a, b) => this.edit(st => { const t = st.matrix[a]; st.matrix[a] = st.matrix[b]; st.matrix[b] = t; }, { label: 'Move modulation' });
    const items = [
      { label: 'Edit Custom Curve', action: () => this.openCurve(slot, anchor) },
      { label: 'Clear', action: () => this.edit(st => { st.matrix[slot] = emptyRow(); }, { label: 'Clear modulation' }) },
      { label: 'Duplicate', action: () => {
        const free = this.s().matrix.findIndex(x => !x.src);
        if (free < 0) { this.notify('Matrix full (' + N_MX + ' slots)'); return; }
        this.edit(st => { st.matrix[free] = clone(st.matrix[slot]); }, { label: 'Duplicate modulation' });
      } },
    ];
    if (slot > 0) items.push({ label: 'Move Up', action: () => swap(slot, slot - 1) });
    if (slot < s.matrix.length - 1) items.push({ label: 'Move Down', action: () => swap(slot, slot + 1) });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }


  /* ================================================================ GLOBAL page (§13.10, inv B24, B20) */
  buildGlobal(el) {
    const grid = mk(this.d, 'div', 'sx-gl');
    grid.append(this.qualityPanel(), this.tuningPanel(), this.mpePanel(), this.vcPanel());
    for (let o = 0; o < N_OSC; o++) grid.appendChild(this.unisonPanel(o));
    grid.append(this.chaosPanel(), this.prefsPanel(), this.infoPanel());
    el.appendChild(grid);
  }
  // QUALITY: Draft / High / Ultra (global.os 1 / 2 / 4) + lock, effective rate; ✓ S1 Compatibility Mode (setS1,
  // reversible, §2.6.4) with the "S1 rendition differs" note; ✓ Disable Smoothing
  qualityPanel() {
    const d = this.d, p = this.panel('QUALITY'), s0 = () => this.s();
    // choosing a quality — also the one already selected — resets the CPU safeguard's quality-reduction steps
    // (§14.3; host.qualityChosen, optional: the integrator clears the session's qr steps)
    const q = this.pSeg({ label: 'Quality', items: QUALITY.map(x => x[1]), get: () => Math.max(0, QUALITY.findIndex(x => x[0] === s0().global.os)),
      always: true, set: i => this.chooseQuality(QUALITY[i][0]) });
    const lock = this.pToggle({ label: 'LOCK', kind: 'btn', get: () => s0().locks.misc.os,
      set: v => this.edit(s => { s.locks.misc.os = v ? 1 : 0; }, { label: 'Lock quality' }) });
    lock.el.title = 'Keep this quality when presets load';
    const rate = mk(d, 'span', 'sx-rate');
    this.custom(() => { const t = this.osText(); if (rate.textContent !== t) rate.textContent = t; });
    // project asset meter (§14.2): the project's referenced user + factory assets against this device's worklet budget,
    // from host.smp.usage() (optional: {bytes, budget} or a promise of it; read at most once a second); hidden without it
    const assets = mk(d, 'span', 'sx-rate sx-assets'), assetsRow = this.row(assets);
    assets.setAttribute('role', 'status');
    let usageT = -1e9, usageTxt = '';
    const mb = b => (b / 1048576).toFixed(b < 104857600 ? 1 : 0) + ' MB';
    const usageText = u => (isObj(u) && fin(u.bytes) ? 'Assets: ' + mb(u.bytes) + (fin(u.budget) && u.budget > 0 ? ' of ' + mb(u.budget) : '') : '');
    this.custom(() => {
      const S = this.host.smp, f = S && typeof S.usage === 'function' ? S.usage : null;
      if (f && nowMs() - usageT >= 1000) {
        usageT = nowMs();
        let u = null;
        try { u = f.call(S); } catch (err) { u = null; }
        if (u && typeof u.then === 'function') u.then(v => { usageTxt = usageText(v); if (!this.dead) this.queue(); }, () => {});
        else usageTxt = usageText(u);
      }
      const t = f ? usageTxt : '';
      if (assets.textContent !== t) assets.textContent = t;
      assetsRow.classList.toggle('sx-hidden', !t);
    });
    const s1 = this.pToggle({ label: 'S1 Compatibility Mode', kind: 'led', get: () => (s1On(s0()) ? 1 : 0), set: v => this.setS1(v) });
    s1.el.title = 'Serum 1 renditions: OSC A/B warp slot 1 uses the 23 legacy warps, the sub its 5 shapes and level law, Filter 1 its 96 types and the gliding key-track reference, Hz LFOs ignore HOST, PHASE/RAND knob ends set the phase memory, and the bend ranges are ±24. Every other feature works in both modes. Switching back restores the S1 sound exactly.';
    const diff = mk(d, 'p', 'sx-note');
    this.custom(() => {
      const L = s1Diff(s0()), t = L.length ? 'S1 rendition differs: ' + L.join(', ') : '';
      if (diff.textContent !== t) diff.textContent = t;
      diff.classList.toggle('sx-hidden', !t);
    });
    const ns = this.pToggle({ label: 'Disable Smoothing', kind: 'led', get: () => s0().global.nosmooth,
      set: v => this.edit(s => { s.global.nosmooth = v ? 1 : 0; }, { label: 'Disable smoothing' }) });
    p.body.append(this.row(mk(d, 'span', 'sx-txt', 'QUALITY'), q.el, lock.el), this.row(rate), assetsRow, this.prefLine(s1.el), diff, this.prefLine(ns.el));
    return p.el;
  }
  chooseQuality(os) {
    if (s0Os(this.s()) !== os) this.edit(s => { s.global.os = os; }, { label: 'Quality' });
    if (typeof this.host.qualityChosen === 'function') { try { this.host.qualityChosen(os); } catch (err) { console.warn(err); } }
  }
  setS1(on) {
    const want = on ? 1 : 0;
    if (s1On(this.s()) === !!want) return;
    // only global.s1 changes (setS1 returns such a state); every other field stays, so switching back is exact
    this.edit(s => { s.global.s1 = want; }, { label: 'S1 Compatibility Mode' });
    this.notify(want ? 'S1 Compatibility Mode on' : 'S1 Compatibility Mode off');
  }
  // TUNING: concert pitch A4 (400–480 Hz) + lock (A4 and the tuning file across preset loads); TUN FILE menu;
  // MTS-ESP disabled (deviation 1)
  tuningPanel() {
    const d = this.d, p = this.panel('TUNING'), s0 = () => this.s();
    const R = core.A4_RANGE || [400, 480];
    const a4 = this.pNum({ label: 'A4 (Hz)', min: R[0], max: R[1], step: 0.1, def: 440, px: 400, get: () => s0().global.a4, fmt: v => v.toFixed(1),
      set: (v, ph) => this.edit(s => { s.global.a4 = v; }, { label: 'A4 reference', phase: ph }) });
    const lock = this.pToggle({ label: 'LOCK', kind: 'btn', get: () => s0().locks.misc.tuning,
      set: v => this.edit(s => { s.locks.misc.tuning = v ? 1 : 0; }, { label: 'Lock tuning' }) });
    lock.el.title = 'Keep the concert pitch and the tuning file when presets load';
    const tun = btn(d, 'sx-hbtn sx-grow', '', 'Tuning file', () => {
      const r = tun.getBoundingClientRect(), t = s0().global.tun || {};
      wk.contextMenu(r.left, r.bottom + 2, [
        { label: 'Load .scl / .kbm / .tun…', action: () => this.loadTuning() },
        { label: 'Clear Tuning', disabled: !t.kind || t.kind === 'none', action: () => this.clearTuning() },
      ], { anchor: tun });
    });
    tun.setAttribute('aria-haspopup', 'menu');
    this.custom(() => {
      const t = s0().global.tun || {}, txt = 'TUN FILE: ' + (t.kind && t.kind !== 'none' ? t.name || t.kind : '12-TET (none)');
      if (tun.textContent !== txt) tun.textContent = txt;
    });
    const mts = this.pToggle({ label: 'MTS-ESP', kind: 'led', get: () => 0, set: () => {}, disabled: () => true });
    mts.el.title = 'Not available in the browser';
    p.body.append(this.row(a4.el, lock.el), this.row(tun), this.prefLine(mts.el, 'Not available in the browser'));
    return p.el;
  }
  // MPE: enabled, bend range (1–96, default 48), XYZ→Macro 1,2,3 / YZ→Macro 1,2 / Y→Mod Wheel (radio + off)
  mpePanel() {
    const d = this.d, p = this.panel('MPE'), m0 = () => this.s().global.mpe || { on: 0, bend: 48, xyz: 0 };
    const mEdit = (fn, label) => this.edit(s => { if (!isObj(s.global.mpe)) s.global.mpe = { on: 0, bend: 48, xyz: 0 }; fn(s.global.mpe); }, { label });
    const onT = this.pToggle({ label: 'MPE Enabled', kind: 'led', get: () => (m0().on ? 1 : 0), set: v => mEdit(m => { m.on = v ? 1 : 0; }, 'MPE') });
    const bend = this.pNum({ label: 'BEND RANGE', min: 1, max: 96, step: 1, def: core.MPE_BEND_DEF || 48, px: 300, get: () => m0().bend || 48,
      fmt: v => v + ' st', set: (v, ph) => mEdit(m => { m.bend = v; }, 'MPE bend range'), parse: t => { const v = parseFloat(String(t).replace(',', '.')); return fin(v) ? v : null; } });
    const xyz = this.pSeg({ label: 'MPE expression mapping', items: ['Off', 'XYZ→M1,2,3', 'YZ→M1,2', 'Y→Wheel'], get: () => clamp(m0().xyz | 0, 0, 3),
      set: i => mEdit(m => { m.xyz = i; }, 'MPE mapping') });
    p.body.append(this.prefLine(onT.el), this.row(bend.el), this.row(xyz.el));
    return p.el;
  }
  // VOICE CONTROL (inv B20, §2.2.6): preset menu, osc selection A B C N S, sequence length, step rows, RANDOM, SCALING
  vcPanel() {
    const d = this.d, p = this.panel('VOICE CONTROL', MODULE_FIELDS.vc ? 'vc' : null), v0 = () => this.s().vc;
    const pre = btn(d, 'sx-hbtn sx-grow', '', 'Voice Control presets', () => this.vcMenu(pre));
    pre.setAttribute('aria-haspopup', 'menu');
    this.custom(() => { const t = 'PRESET: ' + (v0().name || 'Init'); if (pre.textContent !== t) pre.textContent = t; });
    const sel = mk(d, 'div', 'sx-route');
    ['A', 'B', 'C', 'N', 'S'].forEach((x, i) => {
      const w = this.pToggle({ label: x, kind: 'btn', get: () => (arr(v0().sel)[i] ? 1 : 0),
        set: on1 => this.edit(s => { s.vc.sel[i] = on1 ? 1 : 0; }, { label: 'Voice Control oscillators' }) });
      w.el.title = ['OSC A', 'OSC B', 'OSC C', 'Noise', 'Sub'][i];
      sel.appendChild(w.el);
    });
    const len = this.pNum({ label: 'LENGTH', min: 1, max: 8, step: 1, def: 1, px: 120, get: () => v0().len || 1,
      set: (v, ph) => this.edit(s => { s.vc.len = v; }, { label: 'Voice Control length', phase: ph }) });
    const rows = ['Pan', 'Detune', 'Cutoff', 'Env', 'Mod 1', 'Mod 2'], box = mk(d, 'div', 'sx-vcgrid');
    if (typeof wk.stepGrid === 'function') {
      const g = this.bind(wk.stepGrid({ label: 'Voice Control steps', rows, steps: 8, len: () => v0().len || 1,
        get: (r, j) => { const st = arr(v0().steps)[j]; return st && fin(st[r]) ? st[r] : 0; },
        set: (r, j, v, ph) => this.edit(s => { s.vc.steps[j][r] = Math.round(clamp(v, -1, 1) * 100) / 100; }, { label: 'Voice Control step', phase: ph || 'set' }),
        fmt: (r, v) => Math.round(v * 100) + '%' }));
      box.appendChild(g.el);
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'Step editor unavailable'));
    const kn = (id, label) => (destOf(id) ? this.dKnob(id, label, { size: 'sm' }).el : null);
    const lscale = kn('vc.lscale', 'LFO');   // knob menu: By Percentage · By Rate first (extraKnobItems)
    p.body.append(this.row(pre), this.row(mk(d, 'span', 'sx-txt', 'OSC'), sel, len.el), box,
      this.row(mk(d, 'span', 'sx-txt', 'RANDOM'), kn('vc.pan', 'PAN'), kn('vc.det', 'DETUNE'), kn('vc.cut', 'CUTOFF'), kn('vc.env', 'ENVS')),
      this.row(mk(d, 'span', 'sx-txt', 'SCALING'), kn('vc.escale', 'ENV'), lscale));
    return p.el;
  }
  vcPresets() { return arr(this.store('get', VC_KEY, [])).filter(x => x && typeof x.name === 'string' && isObj(x.vc)); }
  // Voice Control presets (§10.9 FACTORY_VC {name, vc, p}; user presets in synth.sx.vc): a preset is the vc state plus the
  // bases of the Voice Control destinations (RANDOM, SCALING: vc.* in s.p); ids a preset leaves out take their defaults
  vcMenu(anchor) {
    const r = anchor.getBoundingClientRect(), fac = arr(core.FACTORY_VC), user = this.vcPresets();
    const ids = DESTS.filter(d => /^vc\./.test(d.id)).map(d => d.id);
    const load = (x, name) => this.edit(s => {
      const vc = isObj(x.vc) ? x.vc : x;
      s.vc = Object.assign({}, s.vc, clone(vc), { name: String(name || vc.name || 'Preset').slice(0, 24) });
      if (isObj(x.p)) for (const id of ids) s.p[id] = fin(x.p[id]) ? clamp01(x.p[id]) : DESTS[DEST_INDEX[id]].def;
      if (typeof core.normalizeSerum === 'function') { const n = core.normalizeSerum(s); s.vc = n.vc; }
    }, { label: 'Voice Control preset' });
    const init = () => { const d0 = core.defaultSerum(); return { vc: d0.vc, p: Object.fromEntries(ids.map(id => [id, d0.p[id]])) }; };
    const items = [];
    if (fac.length) items.push({ label: 'Factory', sub: fac.map(x => ({ label: x.name, action: () => load(x, x.name) })) });
    items.push({ label: 'User', sub: user.length ? user.map(x => ({ label: x.name, action: () => load(x, x.name) })) : [{ label: '(none)', disabled: true }] });
    items.push({ label: 'Init', action: () => load(init(), 'Init') });
    items.push({ sep: true }, { label: 'Save…', action: () => this.promptText('Save Voice Control Preset', 'Name', this.s().vc.name || 'VC ' + (user.length + 1), t => {
      const name = String(t).trim().slice(0, 24);
      if (!name) return false;
      const s = this.s(), vc = clone(s.vc);
      vc.name = name;
      const pv = Object.fromEntries(ids.map(id => [id, this.getN(id)]));
      this.store('set', VC_KEY, user.filter(x => x.name !== name).concat([{ name, vc, p: pv }]));
      this.edit(st => { st.vc.name = name; }, { label: 'Voice Control preset' });
      this.notify('Saved Voice Control preset “' + name + '”');
      return true;
    }) });
    if (user.length) items.push({ label: 'Delete', sub: user.map(x => ({ label: x.name, action: () => this.store('set', VC_KEY, user.filter(y => y.name !== x.name)) })) });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }
  // UNISON A / B / C: the gear popover's contents for every oscillator (§13.10)
  unisonPanel(o) {
    const d = this.d, P = OSC_P[o], p = this.panel('UNISON ' + OSC_L[o]), s0 = () => this.s();
    const range = this.pNum({ label: 'RANGE', min: 0, max: 48, step: 0.01, def: 2, px: 240, get: () => s0().osc[o].uni.range,
      fmt: v => v.toFixed(2) + ' st', parse: t => { const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(String(t)); return m ? parseFloat(m[1].replace(',', '.')) : null; },
      set: (v, ph) => this.edit(s => { s.osc[o].uni.range = v; }, { label: 'Unison range ' + OSC_L[o], phase: ph }) });
    const tun = this.bind(wk.menu({ label: 'MODE', items: () => UNI_MODES.map((m, i) => ({ v: i, label: typeof m === 'string' ? m : m.name || String(m) })),
      get: () => s0().osc[o].uni.mode, set: v => this.edit(s => { s.osc[o].uni.mode = v; }, { label: 'Unison mode ' + OSC_L[o] }) }));
    const kn = (id, label) => (destOf(id) ? this.dKnob(id, label, { size: 'sm' }).el : null);
    p.body.append(this.row(range.el, kn(P + '.uniw', 'WIDTH'), kn(P + '.uniwarp', 'WARP'), kn(P + '.uniwarp2', 'WARP 2'), kn(P + '.uniwt', 'WT POS')),
      this.row(this.dMenu(P + '.stack', 'STACK', () => this.enumItems(P + '.stack', UNI_STACKS.map(x => (typeof x === 'string' ? x : x.name || String(x))))).el, tun.el));
    return p.el;
  }
  // CHAOS (S1): shown in S1 mode or while a row reads a chaos source; Convert to Chaos LFOs (deviation 22)
  chaosPanel() {
    const d = this.d, p = this.panel('CHAOS (S1)'), s0 = () => this.s();
    const used = () => rowsOf(s0()).some(r => r && (/^chaos[12]$/.test(r.src) || /^chaos[12]$/.test(r.aux)));
    for (const c of [0, 1]) {
      const P = 'c' + (c + 1);
      const sw = (label, k) => this.pToggle({ label, kind: 'btn', get: () => s0().chaos[c][k],
        set: v => this.edit(s => { s.chaos[c][k] = v ? 1 : 0; }, { label: 'Chaos ' + (c + 1) + ' ' + label.toLowerCase() }) }).el;
      p.body.appendChild(this.row(mk(d, 'span', 'sx-txt', 'CHAOS ' + (c + 1)), this.dKnob(P + '.rate', 'RATE', { size: 'sm' }).el,
        this.dToggle(P + '.bpm', 'BPM', 'btn').el, sw('MONO', 'mono'), sw('S&H', 'sh')));
    }
    const conv = btn(d, 'sx-btn', 'Convert to Chaos LFOs', 'Move the chaos sources to free LFOs of the Chaos types (approximate)', () => this.confirmDlg('Convert to Chaos LFOs',
      'Each chaos source moves to a free LFO set to Chaos: Rossler (Chaos 1) or Chaos: Lorenz (Chaos 2). The output scaling differs slightly; S&H settings are dropped.', () => {
        if (!this.need('chaosToLfo')) return;
        const next = core.chaosToLfo(this.s(), this.bpm());   // BPM-synced chaos rates map at the project tempo
        this.edit(s => { const ui = s.ui; this.replaceState(s, next); s.ui = ui; }, { label: 'Convert to Chaos LFOs' });
        this.edDirty = true;
      }));
    this.custom(() => { p.el.classList.toggle('sx-hidden', !s1On(s0()) && !used()); conv.disabled = !used(); });
    p.body.appendChild(this.row(conv));
    return p.el;
  }
  // INFO / VERSION: author, notes, tags editor, build text
  infoPanel() {
    const d = this.d, p = this.panel('INFO'), s0 = () => this.s();
    const au = mk(d, 'input'), no = mk(d, 'textarea'), tg = mk(d, 'input');
    au.type = 'text'; au.maxLength = 64;
    no.maxLength = 2000;
    tg.type = 'text'; tg.maxLength = 400;
    tg.placeholder = 'tag, tag…';
    const la = mk(d, 'label', 'sx-txt', 'Author'), ln = mk(d, 'label', 'sx-txt', 'Notes'), lt = mk(d, 'label', 'sx-txt', 'Tags');
    la.appendChild(au); ln.appendChild(no); lt.appendChild(tg);
    au.addEventListener('change', () => this.edit(s => { s.author = au.value.slice(0, 64); }, { label: 'Author' }));
    no.addEventListener('change', () => this.edit(s => { s.notes = no.value.slice(0, 2000); }, { label: 'Notes' }));
    tg.addEventListener('change', () => this.edit(s => { s.tags = tagList(tg.value.split(',')).slice(0, 16); }, { label: 'Tags' }));
    this.custom(() => {
      const s = s0();
      if (d.activeElement !== au && au.value !== s.author) au.value = s.author || '';
      if (d.activeElement !== no && no.value !== s.notes) no.value = s.notes || '';
      const t = arr(s.tags).join(', ');
      if (d.activeElement !== tg && tg.value !== t) tg.value = t;
    });
    p.body.append(la, ln, lt, mk(d, 'p', 'sx-rate', BUILD));
    return p.el;
  }
  prefLine(ctl, note) {
    const r = mk(this.d, 'div', 'sx-pref');
    r.appendChild(ctl);
    if (note) r.appendChild(mk(this.d, 'span', '', note));
    return r;
  }
  // effective internal rate (§9.7, deviation 9): the processor's own rate from the snapshot (tapRate = proc.fs,
  // which already includes the device-rate cap and the CPU safeguard), else host.sampleRate (optional) × the cap
  osText() {
    const os = this.s().global.os, sn = this.snap, h = this.host.sampleRate, base = typeof h === 'function' ? +h() : +h;
    const kHz = r => 'Running at ' + (r >= 1000 ? +(r / 1000).toFixed(1) + ' kHz' : Math.round(r) + ' Hz');
    if (sn && sn.tapRate > 0) return kHz(sn.tapRate);
    if (!(base > 0)) return 'Runs at ' + os + '× the device rate (capped at 384 kHz)';
    const cap = Math.pow(2, Math.floor(Math.log2(384000 / base)));
    return kHz(base * Math.max(1, Math.min(os, cap)));
  }
  setPref(k, v) {
    const p = Object.assign({}, this.prefs);
    p[k] = v;
    this.prefs = normPrefs(p);
    this.store('set', PREFS_KEY, this.prefs);
    if (wk.setPrefs && (k === 'tooltips' || k === 'dblClick' || k === 'wheel')) wk.setPrefs({ [k]: this.prefs[k] });
    if (k === 'helpTips') this.applyHelp();
    if (typeof this.host.prefsChanged === 'function') this.host.prefsChanged(Object.assign({}, this.prefs));
    this.queue();
  }
  prefsPanel() {
    const d = this.d, p = this.panel('PREFERENCES'), P = () => this.prefs;
    const line = (label, ctl) => { const r = mk(d, 'div', 'sx-pref'); r.append(mk(d, 'span', '', label), ctl); return r; };
    const opt = (label, k) => { const r = mk(d, 'div', 'sx-pref'), w = this.pToggle({ label, kind: 'led', get: () => P()[k], set: v => this.setPref(k, v ? 1 : 0) }); r.appendChild(w.el); return r; };
    const seg = (label, items, get, set) => this.pSeg({ label, items, get, set }).el;
    const author = mk(d, 'input');
    author.type = 'text'; author.maxLength = 64;
    author.setAttribute('aria-label', 'Default author name');
    author.addEventListener('change', () => this.setPref('author', author.value));
    this.custom(() => { if (d.activeElement !== author) author.value = P().author; });
    // a drag shows its value locally and commits once at the end (setPref writes the storage and host.prefsChanged
    // recompiles every track when the smoothing scale changes)
    let smoothDrag = null;
    const smooth = this.pNum({ label: '', aria: 'Smoothing scale', min: 1, max: 800, step: 1, def: 100, px: 400,
      get: () => (smoothDrag !== null ? smoothDrag : Math.round(P().smooth * 100)), fmt: v => v + '%',
      set: (v, ph) => {
        if (ph === 'start' || ph === 'move') { smoothDrag = v; this.queue(); return; }
        smoothDrag = null;
        if (Math.round(P().smooth * 100) !== v) this.setPref('smooth', v / 100);
      } });
    p.body.append(
      opt('Help tooltips', 'helpTips'),
      opt('Param value tooltips', 'tooltips'),
      line('Double-click', seg('Double-click', ['Type value', 'Reset'], () => (P().dblClick === 'reset' ? 1 : 0), i => this.setPref('dblClick', i ? 'reset' : 'type'))),
      opt('Mouse wheel adjusts controls', 'wheel'),
      opt('Keyboard shortcuts', 'keys'),
      line('Default waveform view', seg('Default WT view', ['2D', '3D'], () => P().view3d, i => this.setPref('view3d', i))),
      opt('MPE enabled by default', 'mpeDefault'),
      opt('MPE Pitch Bend (also) maps to Expr X', 'mpeBendX'),
      opt('MPE Expr Y acts bi-directional', 'mpeYBi'),
      opt('Limit mod depth on drop', 'limitDrop'),
      opt('Mod wheel → WT Pos while editor open', 'wheelWt'),
      opt('Silence effect tails when transport stops', 'silenceTails'),
      opt('Load MIDI Map from Presets', 'midiFromPreset'),
      opt('Use Ultra quality when rendering', 'ultra'),
      line('Default quality', seg('Default quality', QUALITY.map(x => x[1]), () => Math.max(0, QUALITY.findIndex(x => x[0] === P().defOs)), i => this.setPref('defOs', QUALITY[i][0]))),
      line('Default author name', author),
      opt('Ask before preset change when edited', 'askPreset'),
      line('Smoothing scale', smooth.el));
    return p.el;
  }

  /* ---------------------------------------------------------------- destroy */
  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.drag) this.dragDone(null);
    if (this.pop) this.pop.close();
    if (this.big) { try { this.big.close(); } catch (err) { /* closed */ } this.big = null; }
    if (this.browser) this.browser.close();
    if (this.overlay) this.overlay.close();
    if (this.wtEd && this.wtEd.close) { try { this.wtEd.close(); } catch (err) { /* already closed */ } }
    for (const P of this.allPages()) for (const ed of P.editors) if (ed && ed.destroy) { try { ed.destroy(); } catch (err) { /* gone */ } }
    for (const x of [this.rack, this.mixer, this.kbd, this.seqPages.arp, this.seqPages.clip].concat(this.oscPanels || [])) {
      if (x && typeof x.destroy === 'function') { try { x.destroy(); } catch (err) { /* gone */ } }
    }
    if (this.mkeys && this.mkeys.destroy) this.mkeys.destroy();
    if (this.meter && this.meter.destroy) this.meter.destroy();
    if (this.ro) this.ro.disconnect();
    for (const f of this.offs) f();
    this.offs = [];
    clearTimeout(this.noticeT);
    clearTimeout(this.tipT);
    this.dropRender();
    if (this.host.monitor) this.host.monitor(false);
    if (this.lay) { this.lay.remove(); this.lay = null; }
    this.el.remove();
  }
}

/* ================================================================ PresetBrowser v2 (§9.10, §13.11, inv B25) */
// new PresetBrowser(container, host, { confirmLoad?: () => bool, modified?: () => bool, onLoad?: key => void,
//   notify?: text => void, hybrid?: (keys, favor) => bool, storage?, changed?: () => void, current?: () => key });
// modified() = the sound differs from the current preset (choosing it again reloads it); changed() = the browser
// changed the host's list (delete, rename, move, import, metadata); current() = the current key as the owner keeps it
// (else host.presets.current(), cached). Full-panel overlay (role=dialog) over `container`:
//   bar: CATEGORIES | TAGS tabs (category menu, or tag chips with All / Any; Alt-click / long-press excludes a tag),
//        search, ratings filter (all · rated · unrated · exact stars), ✓ auto-preview, menu ⋯, Import…, ✕
//   table: ▶ preview · Name · Category · Author · Rating (1–5 stars) · ⋯ (click a column sorts; again flips; ties →
//        previously clicked column, then Name); user rows marked
//   metadata pane: artist, category, description, comments, date, tags, New tag
//   preview macros: while a preview plays, MACROS 1–8 of the previewed preset (knobs; host.previewMacros(n[8]))
//   keys: ↑/↓ browse-to-audition (with auto-preview: move and preview instead), → preview, ← stop, Enter / double-click
//        load and close, Escape closes, Delete / Shift-Backspace delete a user preset (confirm), 7 Load Random Preset,
//        8 Hybridize, 9 Hybridize Favoring Selected Preset, ContextMenu row menu, Cmd/Ctrl-F focuses the search field
//        (inv B25: search by name, scoped by the category / tag filters)
// State { sort, sort2, dir, cat, q, tab, tags, tagMode, excl, stars, autoPreview } persists in host.storage
// BROWSER_KEY; ratings / tags / comments of factory presets in META_KEY (user presets through presets.setMeta when the
// host offers it).
export class PresetBrowser {
  constructor(container, host, opts) {
    this.box = container;
    this.host = host || {};
    this.o = opts || {};
    this.d = (container && container.ownerDocument) || globalThis.document;
    this.st = normBrowser(this.load());
    this.ov = null;
    this.sel = null;
    this.playing = null;
    this.pmac = null;     // macros 1–8 of the preview ({v: n[8], names: [8]}), adjustable while it plays (§13.11)
    this.cache = null;    // {all, rows}: the host's list and the rows with their metadata (read once per open, data())
    this.curC = undefined;   // host.presets.current() cache (without opts.current)
    this.pvT = 0;         // the preview's end timer (host.preview plays ≤ 4 s, §12.6)
  }
  stor() { return this.o.storage || this.host.storage; }
  load() { const s = this.stor(); try { return s && s.get ? s.get(BROWSER_KEY, null) : null; } catch (err) { return null; } }
  persist() { const s = this.stor(); try { if (s && s.set) s.set(BROWSER_KEY, Object.assign({}, this.st, { tags: this.st.tags.slice(), excl: this.st.excl.slice() })); } catch (err) { /* storage unavailable */ } }
  meta() { const s = this.stor(); try { const m = s && s.get ? s.get(META_KEY, null) : null; return isObj(m) ? m : {}; } catch (err) { return {}; } }
  saveMeta(m) { const s = this.stor(); try { if (s && s.set) s.set(META_KEY, m); } catch (err) { /* storage unavailable */ } }
  state() { return Object.assign({}, this.st); }
  // The host's list and the rows with their metadata are read once and cached — per open and after the browser's or
  // the panel's own changes (save, delete, rename, move, import, ratings / tags / comments): main.js re-parses
  // its user-preset store on every list() / current() call. Each row's tags are one set used everywhere (TAGS chips,
  // the filter, the details pane): meta tags (synth.sx.meta / the user preset's own) over the row's tags (the host's
  // list rows may carry the preset state's browser tags s.tags, §2.2.1), else — factory presets — serum-core's
  // FACTORY_PRESETS state tags. (presets.get is not called per row: one call may parse the host's whole store.)
  data() {
    if (this.cache) return this.cache;
    const p = this.host.presets, all = p && p.list ? arr(p.list()) : [];
    const base = all.map(r => (r && r.tags === undefined ? Object.assign({}, r, { tags: this.stateTags(r.key) }) : r));
    this.cache = { all, rows: withMeta(base, this.meta()) };
    return this.cache;
  }
  invalidate() { this.cache = null; this.curC = undefined; }
  // the preset object of key (host.presets.get; factory keys 'f:<name>' fall back to serum-core FACTORY_PRESETS)
  presetObj(key) {
    const pr = this.host.presets;
    let o = null;
    if (pr && typeof pr.get === 'function') { try { o = pr.get(key); } catch (err) { o = null; } }
    if (!o) { const m = /^f:(.*)$/.exec(String(key)); o = m ? arr(core.FACTORY_PRESETS).find(q => q && q.name === m[1]) || null : null; }
    return isObj(o) ? o : null;
  }
  stateTags(key) {
    const m = /^f:(.*)$/.exec(String(key)), o = m ? arr(core.FACTORY_PRESETS).find(q => q && q.name === m[1]) : null;
    return o && o.v && o.v.s ? tagList(o.v.s.tags) : [];
  }
  all() { return this.data().all; }
  rows() { return this.data().rows; }
  list() { return browserList(this.rows(), this.st); }
  // the current key: the panel's (opts.current, kept by its refresh), else host.presets.current() cached until a load
  current() {
    if (typeof this.o.current === 'function') { const k = this.o.current(); return k === undefined ? null : k; }
    if (this.curC === undefined) { const p = this.host.presets; const k = p && p.current ? p.current() : null; this.curC = k === undefined ? null : k; }
    return this.curC;
  }
  // the host's list changed through the browser: re-read it and tell the panel (header name, ◀ ▶)
  changed() { this.invalidate(); if (this.o.changed) this.o.changed(); }
  isOpen() { return !!this.ov; }
  notify(t) { if (this.o.notify) this.o.notify(t); else if (this.host.notify) this.host.notify(t); }
  set(patch) { Object.assign(this.st, patch); this.st = normBrowser(this.st); this.persist(); this.render(); }
  sortBy(col) {
    if (col === this.st.sort) this.st.dir = -this.st.dir;
    else { this.st.sort2 = this.st.sort; this.st.sort = col; this.st.dir = 1; }
    this.persist();
    this.render();
  }
  // Loads unless key is the current preset and nothing changed since it was loaded (opts.modified(): edits, Init
  // Preset), so choosing the current preset again reverts its edits (asking first per confirmLoad).
  loadKey(key, close) {
    const p = this.host.presets;
    if (!p || !p.load || key === null || key === undefined) return false;
    const load = key !== this.current() || !!(this.o.modified && this.o.modified());
    if (load && this.o.confirmLoad && !this.o.confirmLoad()) return false;
    if (load) { this.stopPreview(); p.load(key); this.curC = undefined; if (this.o.onLoad) this.o.onLoad(key); }
    this.sel = key;
    if (close) this.close(); else this.renderSel();
    return true;
  }
  /* preview (§13.11, §12.6): host.preview(key) plays the preset's preview clip on its own node; null stops */
  preview(key) {
    const f = this.host.preview;
    if (typeof f !== 'function') { this.notify('Preview is not available'); return false; }
    if (key === null || key === undefined) { this.stopPreview(); return false; }
    try { f(key); } catch (err) { console.warn(err); return false; }
    this.playing = key;
    this.pmac = this.macrosOf(key);
    // §12.6: the host plays the preview for at most PREVIEW_MS and then disconnects it (no completion callback in
    // §11.15): the play state, the stop icon and the macro strip end with it
    clearTimeout(this.pvT);
    this.pvT = setTimeout(() => { this.pvT = 0; if (this.playing === key) { this.playing = null; this.pmac = null; if (this.ov) this.renderSel(); } }, PREVIEW_MS);
    this.renderSel();
    return true;
  }
  stopPreview() {
    clearTimeout(this.pvT);
    this.pvT = 0;
    if (this.playing === null) return;
    this.playing = null;
    this.pmac = null;
    if (typeof this.host.preview === 'function') { try { this.host.preview(null); } catch (err) { /* host */ } }
    if (this.ov) this.renderSel();
  }
  // the previewed preset's macro values and names (host.presets.get; factory keys 'f:<name>' fall back to serum-core)
  macrosOf(key) {
    const o = this.presetObj(key);
    const M = o && o.v && o.v.s ? arr(o.v.s.macros) : [];
    return { v: Array.from({ length: N_MAC }, (_, k) => (isObj(M[k]) && fin(M[k].v) ? clamp01(M[k].v) : 0)),
      names: Array.from({ length: N_MAC }, (_, k) => (isObj(M[k]) && typeof M[k].name === 'string' && M[k].name) || 'Macro ' + (k + 1)) };
  }
  // a macro knob of the preview strip moved: the preview node plays with the new macro values (host.previewMacros,
  // optional: v = n[8]); the browsed preset itself is never changed
  setPreviewMacro(k, n) {
    if (!this.pmac || !(k >= 0 && k < N_MAC)) return;
    this.pmac.v[k] = clamp01(n);
    const f = this.host.previewMacros;
    if (typeof f === 'function') { try { f(this.pmac.v.slice()); } catch (err) { console.warn(err); } }
  }
  /* ratings / tags / comments */
  setMetaOf(key, patch) {
    const p = this.host.presets, row = this.all().find(x => x.key === key);
    if (!row) return;
    if (row.user && p && typeof p.setMeta === 'function') p.setMeta(key, patch);
    else {
      const m = this.meta(), cur = isObj(m[key]) ? m[key] : {};
      m[key] = Object.assign({}, cur, patch);
      this.saveMeta(m);
    }
    this.changed();
    this.render();
  }
  setStars(key, n) {
    const row = this.rows().find(x => x.key === key);
    if (!row) return;
    const v = row.stars === n ? 0 : clamp(Math.round(n), 0, 5);
    this.setMetaOf(key, { stars: v });
  }
  toggleTag(t, exclude) {
    const st = this.st, inc = st.tags.slice(), ex = st.excl.slice();
    if (exclude) { toggleIn(ex, t); toggleIn(inc, t, false); } else { toggleIn(inc, t); toggleIn(ex, t, false); }
    this.set({ tags: inc, excl: ex });
  }
  /* menu actions */
  randomKey(seed) {
    const L = this.list();
    if (!L.length) return null;
    const r = mulberry32((fin(seed) ? seed : Date.now()) >>> 0);
    let k = L[Math.floor(r() * L.length)].key;
    if (k === this.current() && L.length > 1) k = L[(L.findIndex(x => x.key === k) + 1) % L.length].key;
    return k;
  }
  loadRandom() { const k = this.randomKey(); if (k !== null) this.loadKey(k, false); }
  hybridize(favor) {
    const L = this.list();
    if (L.length < 2) { this.notify('Hybridize needs at least two presets in the list'); return false; }
    if (favor && !L.some(x => x.key === this.sel)) { this.notify('Select a preset to favour'); return false; }
    const keys = hybridPick(L, (Date.now() ^ 0x5bd1e995) >>> 0, 4, favor ? this.sel : undefined);
    const ok = this.o.hybrid ? this.o.hybrid(keys, !!favor) : false;
    this.renderSel();
    return ok;
  }
  del(key) {
    const p = this.host.presets, it = this.all().find(x => x.key === key);
    if (!p || !p.del || !it || !it.user) return;
    if (!askConfirm(this.d, 'Delete preset “' + it.name + '”?')) return;
    const L = this.list(), i = L.findIndex(x => x.key === key);
    if (this.playing === key) this.stopPreview();
    p.del(key);
    this.changed();
    const L2 = this.list();
    this.sel = L2.length ? L2[Math.min(Math.max(0, i), L2.length - 1)].key : null;
    this.render();
  }
  importFile() {
    const p = this.host.presets;
    if (!p || !p.importFile) { this.notify('Preset import is not available'); return Promise.resolve(); }
    return pickFile(this.d, '.json,application/json').then(f => (f ? p.importFile(f) : null)).then(k => {
      if (k === null || k === undefined) return;
      this.sel = k;
      this.changed();
      this.render();
      this.notify('Preset(s) imported');
    }, err => { console.warn(err); this.notify('Could not import that file'); });
  }
  exportPack() {
    const p = this.host.presets, keys = this.list().map(x => x.key);
    if (!p || typeof p.exportPack !== 'function') { this.notify('Pack export is not available'); return; }
    if (!keys.length) { this.notify('No presets in the list'); return; }
    p.exportPack(keys);
  }
  renameUI(key) {
    const p = this.host.presets, it = this.all().find(x => x.key === key);
    if (!it || !p || typeof p.rename !== 'function') return;
    const nm = typeof wk.ask === 'function' ? wk.ask('Rename preset', it.name) : null;
    if (nm && nm.trim() && nm.trim() !== it.name) { const k = p.rename(key, nm.trim().slice(0, 64)); if (k) this.sel = k; this.changed(); this.render(); }
  }
  moveUI(key) {
    const p = this.host.presets, it = this.all().find(x => x.key === key);
    if (!it || !p || typeof p.move !== 'function') return;
    const c = typeof wk.ask === 'function' ? wk.ask('Move to category', it.cat || 'User') : null;
    if (c && c.trim()) { p.move(key, c.trim().slice(0, 32)); this.changed(); this.render(); }
  }
  menuItems() {
    const p = this.host.presets || {}, it = this.all().find(x => x.key === this.sel), user = !!(it && it.user);
    const items = [
      { label: 'Load Random Preset (7)', action: () => this.loadRandom() },
      { label: 'Hybridize (8)', disabled: !this.o.hybrid, action: () => this.hybridize(false) },
      { label: 'Hybridize Favoring Selected Preset (9)', disabled: !this.o.hybrid || !it, action: () => this.hybridize(true) },
    ];
    // §13.11 items whose host member is missing (presets.rename / move / exportPack: optional host members) are shown
    // disabled, so the gap is visible instead of the item silently missing
    const can = k => typeof p[k] === 'function';
    items.push({ sep: true },
      { label: 'Rename…', disabled: !user || !can('rename'), action: () => this.renameUI(this.sel) },
      { label: 'Move to Category…', disabled: !user || !can('move'), action: () => this.moveUI(this.sel) },
      { label: 'Delete (Shift-Backspace)', disabled: !user || !p.del, action: () => this.del(this.sel) },
      { sep: true },
      { label: 'Create and Export a Pack…', disabled: !can('exportPack'), action: () => this.exportPack() },
      { label: 'Import Pack…', action: () => this.importFile() });
    return items;
  }
  rowMenu(key, x, y, anchor) {
    const p = this.host.presets, it = this.all().find(q => q.key === key);
    if (!it) return;
    const items = [{ label: 'Load', action: () => this.loadKey(key, true) }, { label: this.playing === key ? 'Stop Preview' : 'Preview', action: () => (this.playing === key ? this.stopPreview() : this.preview(key)) }];
    if (p && p.exportFile) items.push({ label: 'Export…', action: () => p.exportFile(key) });
    if (it.user && p && typeof p.rename === 'function') items.push({ label: 'Rename…', action: () => this.renameUI(key) });
    if (it.user && p && typeof p.move === 'function') items.push({ label: 'Move to Category…', action: () => this.moveUI(key) });
    if (it.user && p && p.del) items.push({ sep: true }, { label: 'Delete', action: () => this.del(key) });
    wk.contextMenu(x, y, items, { anchor });
  }
  open() {
    if (this.ov) { this.focusList(); return; }
    const d = this.d, ov = mk(d, 'div', 'sx-ov');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Preset browser');
    const root = mk(d, 'div', 'pb-root'), bar = mk(d, 'div', 'pb-bar'), bar2 = mk(d, 'div', 'pb-bar');
    // CATEGORIES | TAGS
    const tabs = mk(d, 'div', 'pb-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabB = {};
    for (const [k, t] of [['cats', 'CATEGORIES'], ['tags', 'TAGS']]) {
      const b = btn(d, '', t, null, () => this.set({ tab: k }));
      b.setAttribute('role', 'tab');
      tabB[k] = b;
      tabs.appendChild(b);
    }
    const cat = wk.menu({ label: '', arrows: true, items: () => [{ v: '', label: 'All categories' }].concat(presetCats(this.all()).map(c => ({ v: c, label: c }))),
      get: () => this.st.cat, set: v => this.set({ cat: v }) });
    const tagBox = mk(d, 'div', 'sx-tagbox');
    const tagMode = segField(d, { label: 'Tag match', items: ['All', 'Any'], get: () => (this.st.tagMode === 'any' ? 1 : 0), set: i => this.set({ tagMode: i ? 'any' : 'all' }) });
    const q = mk(d, 'input', 'pb-q');
    q.type = 'search';
    q.placeholder = 'Search name or author';
    q.setAttribute('aria-label', 'Search presets');
    q.value = this.st.q;
    q.addEventListener('input', () => { this.st.q = q.value; this.persist(); this.render(); });
    q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); this.focusList(); } });
    const stars = wk.menu({ label: '', arrows: false, items: () => [{ v: '', label: 'All ratings' }, { v: 'any', label: 'Rated' }, { v: 'none', label: 'Unrated' }]
      .concat([1, 2, 3, 4, 5].map(n => ({ v: n, label: '★'.repeat(n) }))), get: () => this.st.stars, set: v => this.set({ stars: v }) });
    const auto = wk.toggle({ label: 'Auto-preview', kind: 'btn', get: () => this.st.autoPreview, set: v => this.set({ autoPreview: v ? 1 : 0 }) });
    const more = btn(d, 'sx-btn', icon(d, 'more'), 'Browser menu', () => { const r = more.getBoundingClientRect(); wk.contextMenu(r.left, r.bottom + 2, this.menuItems(), { anchor: more }); });
    more.setAttribute('aria-haspopup', 'menu');
    const imp = btn(d, 'sx-btn', 'Import…', 'Import a preset file or pack', () => this.importFile());
    const x = btn(d, 'sx-btn', '✕', 'Close preset browser', () => this.close());
    bar.append(tabs, cat.el, tagMode.el, q, stars.el, auto.el, more, imp, x);
    bar2.appendChild(tagBox);
    const main = mk(d, 'div', 'pb-main');
    const tbl = mk(d, 'div', 'pb-tbl'), hd = mk(d, 'div', 'pb-hd'), list = mk(d, 'div', 'pb-list');
    const cols = {};
    hd.appendChild(mk(d, 'span'));
    for (const [k, t] of [['name', 'Name'], ['cat', 'Category'], ['author', 'Author'], ['stars', 'Rating']]) {
      const b = btn(d, '', t, null, () => this.sortBy(k));
      b.setAttribute('aria-label', 'Sort by ' + t);
      cols[k] = b;
      hd.appendChild(b);
    }
    hd.appendChild(mk(d, 'span'));
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Presets');
    list.addEventListener('keydown', e => this.key(e));
    tbl.append(hd, list);
    const metaEl = mk(d, 'div', 'pb-meta');
    metaEl.setAttribute('aria-label', 'Preset details');
    main.append(tbl, metaEl);
    // macros 1–8 of the preview, adjustable while it plays (§13.11)
    const macBar = mk(d, 'div', 'pb-macros'), macs = [];
    macBar.setAttribute('role', 'group');
    macBar.setAttribute('aria-label', 'Preview macros');
    const canMac = typeof this.host.previewMacros === 'function';
    macBar.appendChild(mk(d, 'span', 'sx-txt', canMac ? 'PREVIEW MACROS' : 'PREVIEW MACROS (not available)'));
    for (let k = 0; k < N_MAC; k++) {
      const w = wk.knob({ size: 'sm', label: () => (this.pmac ? this.pmac.names[k] : 'Macro ' + (k + 1)),
        get: () => (this.pmac ? this.pmac.v[k] : 0), set: n => this.setPreviewMacro(k, n), def: 0,
        fmt: n => Math.round(n * 100) + '%', disabled: () => !canMac || !this.pmac });
      macs.push(w);
      macBar.appendChild(w.el);
    }
    root.append(bar, bar2, macBar, main);
    ov.appendChild(root);
    ov.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      // Cmd/Ctrl-F: the browser's search field, not the page's find (inv B25)
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); q.focus(); if (q.select) q.select(); }
    });
    const prev = d.activeElement;
    this.ov = { el: ov, list, cols, cat, prev, tabB, tagBox, tagMode, stars, auto, metaEl, bar2, macBar, macs, q };
    this.invalidate();
    this.sel = this.current();
    const L = typeof this.o.layer === 'function' ? this.o.layer() || this.box : this.box; // (the canvas: the panel's top layer)
    L.appendChild(ov);
    this.render();
    if (L === this.box) fullScreenOverlay(this.box, ov);
    this.focusList();
  }
  close() {
    const O = this.ov;
    if (!O) return;
    this.ov = null;
    this.stopPreview();
    for (const w of [O.cat, O.stars, O.auto].concat(O.macs)) if (w && w.destroy) w.destroy();
    O.el.remove();
    if (O.prev && O.prev.focus && O.prev.isConnected !== false) O.prev.focus();
  }
  focusList() { if (this.ov) this.ov.list.focus(); }
  key(e) {
    const L = this.shown || this.list(), i = L.findIndex(p => p.key === this.sel), k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End' || k === 'PageDown' || k === 'PageUp') {
      e.preventDefault();
      if (!L.length) return;
      const j = k === 'Home' ? 0 : k === 'End' ? L.length - 1 : clamp((i < 0 ? (k === 'ArrowUp' ? L.length : -1) : i)
        + (k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : k === 'PageDown' ? 10 : -10), 0, L.length - 1);
      if (this.st.autoPreview) { this.sel = L[j].key; this.preview(L[j].key); }   // move and preview (§13.11)
      else this.loadKey(L[j].key, false);   // browse-to-audition (Phase 1)
    } else if (k === 'ArrowRight') { e.preventDefault(); if (i >= 0) this.preview(L[i].key); }
    else if (k === 'ArrowLeft') { e.preventDefault(); this.stopPreview(); }
    else if (k === 'Enter') { e.preventDefault(); if (i >= 0) this.loadKey(L[i].key, true); }
    else if (k === 'Delete' || (k === 'Backspace' && e.shiftKey)) { e.preventDefault(); if (i >= 0) this.del(L[i].key); }
    else if (k === '7' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.loadRandom(); }
    else if (k === '8' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.hybridize(false); }
    else if (k === '9' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.hybridize(true); }
    else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const row = i >= 0 && this.ov ? this.ov.rows[L[i].key] : null;
      if (row) { const r = row.getBoundingClientRect(); this.rowMenu(L[i].key, r.left + 20, r.bottom, row); }
    }
  }
  // full rebuild (filter, sort, tab, metadata or list changes); selection and preview changes go through renderSel
  render() {
    const O = this.ov;
    if (!O) return;
    const d = this.d, all = this.rows(), L = browserList(all, this.st), tagsView = this.st.tab === 'tags';
    this.shown = L;
    O.cat.update(); O.stars.update(); O.auto.update(); O.tagMode.update();
    for (const k of ['cats', 'tags']) O.tabB[k].setAttribute('aria-selected', this.st.tab === k ? 'true' : 'false');
    O.cat.el.classList.toggle('sx-hidden', tagsView);
    O.tagMode.el.classList.toggle('sx-hidden', !tagsView);
    O.bar2.classList.toggle('sx-hidden', !tagsView);
    // tag chips: click includes, Alt-click / long-press excludes
    O.tagBox.textContent = '';
    if (tagsView) {
      const tags = presetTags(all);
      if (!tags.length) O.tagBox.appendChild(mk(d, 'span', 'sx-txt', 'No tags yet: add them in the details pane'));
      for (const t of tags) {
        const c = btn(d, 'sx-chip', t, null, e => this.toggleTag(t, !!(e && e.altKey)));
        c.setAttribute('aria-pressed', this.st.tags.includes(t) ? 'true' : 'false');
        c.classList.toggle('sx-excl', this.st.excl.includes(t));
        c.title = 'Click: show presets with this tag; Alt-click / long-press: hide them';
        longPress(c, () => this.toggleTag(t, true));
        O.tagBox.appendChild(c);
      }
    }
    for (const k of SORT_COLS) O.cols[k].setAttribute('aria-sort', this.st.sort === k ? (this.st.dir > 0 ? 'ascending' : 'descending') : 'none');
    O.list.textContent = '';
    O.rows = {};
    O.paint = { sel: undefined, cur: undefined, play: undefined, meta: undefined };
    if (!L.length) O.list.appendChild(mk(d, 'div', 'pb-empty', 'No presets match'));
    L.forEach(p => {
      const r = mk(d, 'div', 'pb-row');
      r.id = 'pb-' + (++UID);
      r.setAttribute('role', 'option');
      r.setAttribute('aria-selected', 'false');
      const play = btn(d, 'pb-play', icon(d, 'play'), 'Preview ' + (p.name || 'preset'), e => {
        e.stopPropagation();
        this.sel = p.key;
        if (this.playing === p.key) this.stopPreview(); else this.preview(p.key);
      });
      play.tabIndex = -1;
      const nm = mk(d, 'span', 'pb-name', p.name || '(unnamed)');
      if (p.user) { const u = mk(d, 'span', 'pb-u', 'USER'); u.setAttribute('aria-label', 'user preset'); nm.appendChild(u); }
      const st = mk(d, 'span', 'pb-stars');
      st.setAttribute('role', 'group');
      st.setAttribute('aria-label', 'Rating ' + (p.stars || 0) + ' of 5');
      for (let k = 1; k <= 5; k++) {
        const b = btn(d, k <= p.stars ? 'sx-on' : '', '★', k + ' star' + (k > 1 ? 's' : ''), e => { e.stopPropagation(); this.setStars(p.key, k); });
        b.tabIndex = -1;
        st.appendChild(b);
      }
      const more = btn(d, 'pb-more', icon(d, 'more'), 'Preset menu', e => { e.stopPropagation(); const b = more.getBoundingClientRect(); this.rowMenu(p.key, b.left, b.bottom, more); });
      more.tabIndex = -1;
      r.append(play, nm, mk(d, 'span', '', p.cat || ''), mk(d, 'span', '', p.author || ''), st, more);
      let lpT = -1e9;   // the click that ends a touch long-press (row menu) does not also load the preset
      r.addEventListener('click', () => { if (Date.now() - lpT < 800) return; this.loadKey(p.key, false); this.focusList(); });
      r.addEventListener('dblclick', () => this.loadKey(p.key, true));
      r.addEventListener('contextmenu', e => { e.preventDefault(); this.rowMenu(p.key, e.clientX, e.clientY, r); });
      longPress(r, (x, y) => { lpT = Date.now(); this.rowMenu(p.key, x, y, r); });   // touch: no contextmenu event on iPad Safari
      O.list.appendChild(r);
      O.rows[p.key] = r;
      r.pbPlay = play;
      r.pbName = p.name || 'preset';
    });
    this.renderSel(true);
  }
  // selection, current preset, preview state (row attributes, play icons, the macro strip) and the details pane —
  // only the rows whose state changed are touched (§13.11 auditioning with the arrow keys stays cheap)
  renderSel(scroll) {
    const O = this.ov;
    if (!O || !O.rows) return;
    const P = O.paint, cur = this.current(), keys = new Set([P.sel, P.cur, P.play, this.sel, cur, this.playing]);
    for (const k of keys) {
      const r = k === undefined || k === null ? null : O.rows[k];
      if (!r) continue;
      r.setAttribute('aria-selected', k === this.sel ? 'true' : 'false');
      if (k === cur) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
      const pl = k === this.playing, b = r.pbPlay;
      if (b && b.pbOn !== pl) {
        b.pbOn = pl;
        b.classList.toggle('sx-on', pl);
        b.textContent = '';
        b.appendChild(icon(this.d, pl ? 'stop' : 'play'));
        const t = (pl ? 'Stop preview of ' : 'Preview ') + r.pbName;
        b.setAttribute('aria-label', t);
        b.title = t;
      }
    }
    const selEl = this.sel !== null && this.sel !== undefined ? O.rows[this.sel] || null : null;
    if (selEl) {
      O.list.setAttribute('aria-activedescendant', selEl.id);
      if ((scroll || P.sel !== this.sel) && selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest' });
    } else O.list.removeAttribute('aria-activedescendant');
    O.macBar.classList.toggle('sx-hidden', this.playing === null);
    if (P.play !== this.playing || this.playing !== null) for (const w of O.macs) w.update();
    if (P.meta !== this.sel || scroll) this.renderMeta(this.rows().find(p => p.key === this.sel) || null);
    O.paint = { sel: this.sel, cur, play: this.playing, meta: this.sel };
  }
  // metadata pane: artist, category, description, comments, date, tags (+ New tag)
  renderMeta(p) {
    const O = this.ov, d = this.d, el = O.metaEl;
    el.textContent = '';
    if (!p) { el.appendChild(mk(d, 'p', 'sx-txt', 'Select a preset to see its details')); return; }
    const full = this.presetObj(p.key), s = full && full.v && full.v.s ? full.v.s : null;
    const field = (label, value) => { const l = mk(d, 'label', '', label); l.appendChild(mk(d, 'span', 'pb-v', value || '—')); el.appendChild(l); };
    field('Name', p.name);
    field('Artist', p.author || (s && s.author));
    field('Category', p.cat);
    field('Description', (s && s.notes) || p.desc || '');
    if (full && full.date) field('Date', String(full.date).slice(0, 10));
    const cl = mk(d, 'label', '', 'Comments'), ct = mk(d, 'textarea');
    ct.value = p.comments || '';
    ct.maxLength = 1000;
    ct.setAttribute('aria-label', 'Comments');
    ct.addEventListener('change', () => this.setMetaOf(p.key, { comments: ct.value.slice(0, 1000) }));
    cl.appendChild(ct);
    el.appendChild(cl);
    // the row's one tag set (data(): metadata tags over the preset state's tags) — the same set the TAGS tab offers
    // and filters by; removing or adding writes the whole set to the metadata, which then overrides the state's tags
    const tl = mk(d, 'label', '', 'Tags'), box = mk(d, 'div', 'sx-tagbox'), tags = tagList(p.tags);
    for (const t of tags) {
      const c = btn(d, 'sx-chip', t + ' ✕', 'Remove tag ' + t, () => this.setMetaOf(p.key, { tags: tags.filter(x => x !== t) }));
      box.appendChild(c);
    }
    const nt = mk(d, 'input');
    nt.type = 'text'; nt.maxLength = 24; nt.placeholder = 'New tag';
    nt.setAttribute('aria-label', 'New tag');
    nt.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const t = nt.value.trim(); if (t) this.setMetaOf(p.key, { tags: tagList(tags.concat([t])) }); }
    });
    tl.append(box, nt);
    el.appendChild(tl);
  }
}
