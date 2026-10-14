/*
 * fx-core.js — pure model of the per-track FX rack (SPEC-serum2 §2.5, §2.6.3, §3.16, §4.2, §4.3, §11.2; Phase-1
 * SPEC-serum §2.5, §3.11, §4.2, §8.1). Imports only laws.js (no cycle with serum-core, which re-exports everything here).
 * No DOM, no timers, no storage. Owner F1 (after C1's M1a move of the FX constants and v1 functions, §0.5).
 *
 * v1 (moved VERBATIM from the Phase-1 serum-core.js, tests/ref-p1/serum-core.js; each v1 function is kept as a `…V1`
 * internal): FX_MODULES, FX_ORDER_DEFAULT, DIST_MODES, DIST_FILTER, DLY_MODES, REV_TYPES, REV_LABELS, EQ_TYPES_L,
 * EQ_TYPES_H, CMP_RATIO_DETENTS, MODFX_LADDER, DLY_LADDER (Phase-1 §3.11 enumerations); FX_ROWS_V1 (the 100 v1 FX
 * destination rows = Phase-1 DESTS 148–247, incl. g.master at 0 and g.bypass at 86; serum-core builds DESTS 148–247
 * from them); RENAME1 (v1 → v2 FX destination ids, §2.6.2); defaultFxV1, normalizeFxV1, compileFxV1 (FXP v1),
 * compileFxTV1, applyPresetFxV1, FACTORY_CHAINS_V1.
 *
 * v2 (F1, M1a step 3):
 *   FXP_VER 2, MAX_INST 48, FXTYPES (§3.16.1), FXP_TAB[type][v] (§3.16.2: S1 variants = the Phase-1 rows of the module in
 *   fx idx order with short labels, S2 variants per the table), FX_S1_IDX[type] (v1 fx idx of every S1 row), DIST_MODES2,
 *   REV_TYPES2, NITROUS_MODES, REV_LABELS2, CONV_IR_DEFAULT;
 *   defaultFx2(), normalizeFx2(fx, refs?) (v1 input ⇒ migrateFx1), migrateFx1(v1, refs?) (§2.6.3);
 *   fxLayout(fx) (§4.2), compileFx(fx, ctx) → FXP v2 and compileFxT(fx) → FXT v2 (§4.3), fxDest(id, fx), instLabel(fx, id)
 *   (§3.16.4), storePhases(fx, ph) (writes FXRack.phases() back into a state: v2 inst.ph by instance, v1 fx.phase).
 *   The compiled-format functions (fxLayout, compileFx, compileFxT, fxDest, instLabel, storePhases) accept a v2 state
 *   AND a v1 state. A v1 state (Phase-1 shape, or anything that is not a v2 state: repaired by normalizeFxV1 when it
 *   fails the Phase-1 structural check, exactly as the Phase-1 compiler did) is read as its migration WITHOUT the
 *   keep/drop rule: all ten modules become S1 instances in the v1 order (ids = module ids, Hyper's Dimension rows as
 *   dsize / dmix / dlevel), so every v1 row id and every v1 modulation target keeps working and the rack renders
 *   bit-identically to the Phase-1 rack (§8.1, §15.1).
 *   ctx.modded of compileFx: Uint8Array(NFX) in FX-context layout (fxModded2, §11.1), or — for the transition — the
 *   Phase-1 Uint8Array(100) in v1 fx idx order (fxModded) when its length is 100 and differs from NFX.
 *
 * v2 (F1, M2): the §11.2 state operations, in place on a live v2 state (a v1 state is not edited: its owner converts it
 *   with migrateFx1 first; a malformed v2 state is repaired in place by normalizeFx2 before the edit): newInstance (ids
 *   per §2.5, caps 16 / 8 / 48, no splitter in a branch, default module preset payload), removeInstance (with a Serum
 *   state: its rows, locks and MIDI entries addressing the instance and its branch instances), moveInstance,
 *   duplicateInstance ({mods}: rows copied onto the copy's ids), rack clipboard cutRack / copyRack / pasteRack /
 *   clearRack, upgradeInstance (S1 → S2, a new object), modulePresetPayload / applyModulePreset, rackPresetPayload /
 *   applyRackPreset (paste / rack-preset load: new ids, never a replaced instance's; with a Serum state its rows / locks
 *   / MIDI entries are removed), migrateChains1, applyPresetFx2 (locked racks kept, the 48-instance cap on the incoming
 *   side, collisions renamed, rows of `s` rewritten / dropped — Lock Matrix aware —, locked dynamic ids across S1 / S2
 *   variants), addable(where[, type]) (§3.16.1); factory content FACTORY_FX_PRESETS ({type: [payload]}, ≥ 3 per type),
 *   FACTORY_RACKS (§10.10 names first), FACTORY_CHAINS2 (MAIN rack only). compileFx also reads ctx.qr.convMax (§14.3
 *   Q3) and ctx.buses (non-Serum tracks: bus instances compiled disabled, §2.5).
 *
 * FX state v2 everywhere (RULINGS2 F1, the integration step's coordinated switch): `defaultFx` = defaultFx2,
 * `normalizeFx(fx, refs)` = normalizeFx2 (a v1 input migrates to S1-variant instances, bit-exact with Phase 1),
 * `applyPresetFx` = applyPresetFx2 and `FACTORY_CHAINS` = FACTORY_CHAINS2; main.js (fxOf, presets, chains, the default
 * preset), serum-core's presets and serum-ui's chain menu hold v2 states. The v1 functions stay exported under their
 * `…V1` names (Phase-1 files, tests, the golden suite). compileFx, compileFxT and FXP_VER are v2 (every FXP the engine
 * receives is FXP v2); they still read a v1 state as its migration without the keep/drop rule (above).
 *
 * Everything exported as a constant is deep-frozen. Compiled objects (FXP, FXT) contain typed arrays and are not
 * frozen: treat them as read-only (FXT objects and layouts are memoised and shared between calls with equal content).
 */
import { lawNorm as lawNormL, snapN as snapL, renderPts } from './laws.js?v=7';

/* ================================================================ small helpers (verbatim from Phase-1 serum-core) */

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
const frac = x => { const f = x - Math.floor(x); return f < 1 ? f : 0; };
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const objOf = x => (isObj(x) ? x : {});
const arrOf = x => (Array.isArray(x) ? x : []);
const intIn = (x, d, lo, hi) => (fin(x) ? clamp(Math.round(x), lo, hi) : d);
const bit = (x, d) => (typeof x === 'boolean' ? (x ? 1 : 0) : fin(x) ? (x >= 0.5 ? 1 : 0) : d);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const FX_V1 = 1;                                       // v1 FX state version (Phase-1 serum-core VERSION)
const FXP_V1 = 1;                                      // v1 FXP (compileFxV1)
export const FXP_VER = 2;                              // FXP v2 (compileFx, §2.6.5, §4.3)
const MIDI0 = 440 * Math.pow(2, -69 / 12);             // 8.175798915643707 Hz (MIDI note 0)
const MIDI128 = 440 * Math.pow(2, 59 / 12);            // 13289.750322… Hz (MIDI note 128)
const XS_N = 1024;
const MAX_PTS = 480;
const N_BUS = 16;

/* ================================================================ §3.11 FX enumerations (Phase 1) */

export const MODFX_LADDER = deepFreeze([
  ['Off', Infinity], ['24 bar', 96], ['32 bar T', 256 / 3], ['16 bar', 64], ['12 bar', 48], ['16 bar T', 128 / 3], ['8 bar', 32],
  ['6 bar', 24], ['8 bar T', 64 / 3], ['4 bar', 16], ['3 bar', 12], ['4 bar T', 32 / 3], ['2 bar', 8], ['1.5 bar', 6], ['2 bar T', 16 / 3],
  ['1 bar', 4], ['1/2.', 3], ['1 bar T', 8 / 3], ['1/2', 2], ['1/4.', 1.5], ['1/2 T', 4 / 3], ['1/4', 1], ['1/8.', 0.75], ['1/4 T', 2 / 3],
  ['1/8', 0.5], ['1/16.', 0.375], ['1/8 T', 1 / 3], ['1/16', 0.25], ['1/32.', 0.1875], ['1/16 T', 1 / 6], ['1/32', 0.125],
].map(([label, beats]) => ({ label, beats })));

export const DLY_LADDER = deepFreeze([
  ['fast', 1 / 128], ['1/256', 1 / 64], ['1/128', 1 / 32], ['1/64', 1 / 16], ['1/32', 1 / 8], ['1/16', 1 / 4], ['1/8', 1 / 2],
  ['1/4', 1], ['1/2', 2], ['1 bar', 4], ['2 bar', 8], ['4 bar', 16],
].map(([label, beats]) => ({ label, beats })));

export const FX_MODULES = deepFreeze([['hyper', 'Hyper/Dimension'], ['dist', 'Distortion'], ['flg', 'Flanger'], ['phs', 'Phaser'],
  ['cho', 'Chorus'], ['dly', 'Delay'], ['cmp', 'Compressor'], ['rev', 'Reverb'], ['eq', 'EQ'], ['fil', 'Filter']]
  .map(([id, label]) => ({ id, label })));
export const FX_ORDER_DEFAULT = deepFreeze(FX_MODULES.map(m => m.id));
export const DIST_MODES = deepFreeze(['Tube', 'SoftClip', 'HardClip', 'Diode 1', 'Diode 2', 'Lin.Fold', 'Sin Fold', 'Zero-Square',
  'Downsample', 'Asym', 'Rectify', 'X-Shaper', 'X-Shaper (Asym)', 'Sine Shaper', 'Stomp Box', 'Tape Sat.']);
export const DIST_FILTER = deepFreeze(['Off', 'Pre', 'Post']);
export const DLY_MODES = deepFreeze(['Normal', 'Ping-Pong', 'Tap->Delay']);
export const REV_TYPES = deepFreeze(['Plate', 'Hall']);
// REV_LABELS[rev.type] = labels of the slots size, t, locut, c, hicut, w, mix
export const REV_LABELS = deepFreeze([
  ['SIZE', 'PRE DELAY', 'LOW CUT', 'DAMP', 'HIGH CUT', 'WIDTH', 'MIX'],
  ['SIZE', 'DECAY', 'LOW CUT', 'SPIN', 'HIGH CUT', 'SPIN DEPTH', 'MIX'],
]);
export const EQ_TYPES_L = deepFreeze(['Shelf', 'Peak', 'HP']);
export const EQ_TYPES_H = deepFreeze(['Shelf', 'Peak', 'LP']);
// Ratio detents of the compressor RATIO knob as normalised values n = 1 − 1/r (wk knob `detents` are n values):
// r = 1.0, 1.1 … 1.9, 2, 3, 4, 5, 6, 7, 8, 10, 16, 32, then Limit (n = 1).
export const CMP_RATIO_DETENTS = deepFreeze([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 4, 5, 6, 7, 8, 10, 16, 32]
  .map(r => 1 - 1 / r).concat([1]));

/* ================================================================ v1 FX destination rows (Phase-1 DESTS 148–247) */

export const FX_ROWS_V1 = deepFreeze((() => {
  const D = [];
  const add = (id, label, law, lo, hi, def, fmt, scope, ctr, group) => D.push({ id, label, law, lo, hi, def, fmt, scope, ctr: ctr ? 1 : 0, group });
  add('g.master', 'Master Volume', 'pow3', 0, 1, 0.7, 'db', 'M', 0, 'Master');
  const fxm = (m, grp, rows) => { for (const r of rows) add(`fx.${m}.${r[0]}`, r[1], r[2], r[3], r[4], r[5], r[6], 'M', r[7] || 0, grp); };
  const LVL = nm => ['level', `${nm} Level`, 'pow2', 0, 4, 0.5, 'dbtrim', 0];
  fxm('hyper', 'FX Hyper/Dim', [
    ['on', 'Hyper/Dim Enable', 'bool', 0, 1, 0, 'bool'],
    ['rate', 'Hyper Rate', 'lin', 0, 1, 0.4, 'pct'],
    ['detune', 'Hyper Detune', 'lin', 0, 1, 0.25, 'pct'],
    ['unison', 'Hyper Unison', 'int', 0, 7, 4 / 7, 'int'],
    ['mix', 'Hyper Mix', 'lin', 0, 1, 0.5, 'pct'],
    LVL('Hyper'),
  ]);
  fxm('dim', 'FX Hyper/Dim', [
    ['size', 'Dimension Size', 'lin', 0, 1, 0.5, 'pct'],
    ['mix', 'Dimension Mix', 'lin', 0, 1, 0, 'pct'],
    LVL('Dimension'),
  ]);
  fxm('dist', 'FX Distortion', [
    ['on', 'Distortion Enable', 'bool', 0, 1, 0, 'bool'],
    ['drive', 'Dist Drive', 'lin', 0, 1, 0.25, 'pct'],
    ['lbh', 'Dist LP/BP/HP', 'lin', 0, 1, 0, 'lbh'],
    ['freq', 'Dist Freq', 'exp', MIDI0, MIDI128, 0.5, 'hz'],
    ['q', 'Dist Q', 'exp', 0.5, 8, 0.5, 'q01'],
    ['mix', 'Dist Mix', 'lin', 0, 1, 1, 'pct'],
    LVL('Dist'),
  ]);
  fxm('flg', 'FX Flanger', [
    ['on', 'Flanger Enable', 'bool', 0, 1, 0, 'bool'],
    ['rate', 'Flanger Rate', 'pow4', 0, 20, 0.25, 'modRate'],
    ['depth', 'Flanger Depth', 'lin', 0, 1, 1, 'pct'],
    ['feed', 'Flanger Feed', 'lin', 0, 1, 0.5, 'pct'],
    ['phase', 'Flanger Phase', 'lin', 0, 360, 0.5, 'deg'],
    ['mix', 'Flanger Mix', 'lin', 0, 1, 1, 'pct'],
    LVL('Flanger'),
  ]);
  fxm('phs', 'FX Phaser', [
    ['on', 'Phaser Enable', 'bool', 0, 1, 0, 'bool'],
    ['rate', 'Phaser Rate', 'pow4', 0, 20, 0.25, 'modRate'],
    ['depth', 'Phaser Depth', 'lin', 0, 1, 0.5, 'pct'],
    ['freq', 'Phaser Freq', 'exp', 20, 18000, 0.5, 'hz'],
    ['feed', 'Phaser Feed', 'lin', 0, 1, 0.8, 'pct'],
    ['phase', 'Phaser Phase', 'lin', 0, 360, 0.5, 'deg'],
    ['mix', 'Phaser Mix', 'lin', 0, 1, 1, 'pct'],
    LVL('Phaser'),
  ]);
  fxm('cho', 'FX Chorus', [
    ['on', 'Chorus Enable', 'bool', 0, 1, 0, 'bool'],
    ['rate', 'Chorus Rate', 'pow4', 0, 20, 0.25, 'modRate'],
    ['dly1', 'Chorus Delay 1', 'pow2', 0, 20, 0.5, 'ms'],
    ['dly2', 'Chorus Delay 2', 'pow2', 0, 20, 0, 'ms'],
    ['depth', 'Chorus Depth', 'pow2', 0, 26, 1, 'ms'],
    ['feed', 'Chorus Feed', 'lin', 0, 0.95, 0.1, 'pct1'],
    ['lpf', 'Chorus LPF', 'exp', 50, 20000, 0.5, 'hz'],
    ['mix', 'Chorus Mix', 'lin', 0, 1, 0.5, 'pct'],
    LVL('Chorus'),
  ]);
  fxm('dly', 'FX Delay', [
    ['on', 'Delay Enable', 'bool', 0, 1, 0, 'bool'],
    ['feed', 'Delay Feed', 'lin', 0, 1, 0.4, 'pct'],
    ['timeL', 'Delay Time L', 'pow4', 1, 501, 0.625, 'dlyTime'],
    ['timeR', 'Delay Time R', 'pow4', 1, 501, 0.625, 'dlyTime'],
    ['offL', 'Delay Offset L', 'lin', 0.5, 1.5, 0.5, 'xoff'],
    ['offR', 'Delay Offset R', 'lin', 0.5, 1.5, 0.5, 'xoff'],
    ['freq', 'Delay Filter Freq', 'exp', 40, 18000, 0.5, 'hz'],
    ['q', 'Delay Filter Q', 'lin', 0.8, 8.2, 6 / 7.4, 'q2'],
    ['mix', 'Delay Mix', 'lin', 0, 1, 0.3, 'pct'],
    LVL('Delay'),
  ]);
  fxm('cmp', 'FX Compressor', [
    ['on', 'Compressor Enable', 'bool', 0, 1, 0, 'bool'],
    ['thr', 'Comp Threshold', 'rpow3', 1e-6, 1, 0.5, 'db'],
    ['ratio', 'Comp Ratio', 'ratio', 1, 32, 0.75, 'ratio'],
    ['att', 'Comp Attack', 'pow2', 0, 1000, 0.3, 'cmpAtt'],
    ['rel', 'Comp Release', 'pow2', 0, 1000, 0.3, 'msFloor'],
    ['gain', 'Comp Gain', 'pow2', 1, 32, 0, 'db'],
    ['mbL', 'Comp MB Low', 'lin', 0, 2, 0.5, 'pct1'],
    ['mbM', 'Comp MB Mid', 'lin', 0, 2, 0.5, 'pct1'],
    ['mbH', 'Comp MB High', 'lin', 0, 2, 0.5, 'pct1'],
    ['mix', 'Comp Mix', 'lin', 0, 1, 1, 'pct'],
    LVL('Comp'),
  ]);
  fxm('rev', 'FX Reverb', [
    ['on', 'Reverb Enable', 'bool', 0, 1, 0, 'bool'],
    ['size', 'Reverb Size', 'lin', 0, 1, 0.33, 'pct'],
    ['t', 'Reverb PreDelay / Decay', 'lin', 0, 1, 0.12, 'revT'],
    ['locut', 'Reverb Low Cut', 'lin', 0, 1, 0, 'pct'],
    ['c', 'Reverb Damp / Spin', 'lin', 0, 1, 0.25, 'pct'],
    ['hicut', 'Reverb High Cut', 'lin', 0, 1, 0.5, 'pct'],
    ['w', 'Reverb Width / Spin Depth', 'lin', 0, 1, 0.2, 'pct'],
    ['mix', 'Reverb Mix', 'lin', 0, 1, 0.33, 'pct'],
    LVL('Reverb'),
  ]);
  fxm('eq', 'FX EQ', [
    ['on', 'EQ Enable', 'bool', 0, 1, 0, 'bool'],
    ['freqL', 'EQ Freq L', 'exp', 21.533, 20000, 0.333, 'hz'],
    ['qL', 'EQ Q L', 'lin', 0, 1, 0.6, 'pct'],
    ['gainL', 'EQ Gain L', 'lin', -24, 24, 0.5, 'dbv', 1],
    ['freqH', 'EQ Freq H', 'exp', 21.533, 20000, 0.666, 'hz'],
    ['qH', 'EQ Q H', 'lin', 0, 1, 0.6, 'pct'],
    ['gainH', 'EQ Gain H', 'lin', -24, 24, 0.5, 'dbv', 1],
  ]);
  fxm('fil', 'FX Filter', [
    ['on', 'FX Filter Enable', 'bool', 0, 1, 0, 'bool'],
    ['cutoff', 'FX Filter Cutoff', 'exp', MIDI0, 22050, 0.5, 'hz'],
    ['res', 'FX Filter Res', 'lin', 0, 1, 0, 'pct'],
    ['drive', 'FX Filter Drive', 'lin', 0, 1, 0, 'pct'],
    ['var', 'FX Filter Var', 'lin', 0, 1, 0, 'var'],
    ['pan', 'FX Filter Pan', 'lin', 0, 1, 0.5, 'fpan', 1],
    ['mix', 'FX Filter Mix', 'lin', 0, 1, 1, 'pct'],
    LVL('FX Filter'),
  ]);
  add('g.bypass', 'Bypass', 'bool', 0, 1, 0, 'bool', 'M', 0, 'Master');
  fxm('hyper', 'FX Hyper/Dim', [['retrig', 'Hyper Retrig', 'bool', 0, 1, 0, 'bool']]);
  fxm('dist', 'FX Distortion', [
    ['mode', 'Dist Mode', 'enum', 0, 15, 0, 'enum:DIST_MODES'],
    ['filt', 'Dist Pre/Post', 'enum', 0, 2, 0, 'enum:DIST_FILTER'],
  ]);
  fxm('flg', 'FX Flanger', [['bpm', 'Flanger BPM', 'bool', 0, 1, 0, 'bool']]);
  fxm('phs', 'FX Phaser', [['bpm', 'Phaser BPM', 'bool', 0, 1, 0, 'bool']]);
  fxm('cho', 'FX Chorus', [['bpm', 'Chorus BPM', 'bool', 0, 1, 0, 'bool']]);
  fxm('dly', 'FX Delay', [
    ['bpm', 'Delay BPM', 'bool', 0, 1, 1, 'bool'],
    ['link', 'Delay Link', 'bool', 0, 1, 0, 'bool'],
    ['mode', 'Delay Mode', 'enum', 0, 2, 0, 'enum:DLY_MODES'],
  ]);
  fxm('cmp', 'FX Compressor', [['mb', 'Comp Multiband', 'bool', 0, 1, 0, 'bool']]);
  fxm('eq', 'FX EQ', [
    ['typeL', 'EQ Type L', 'enum', 0, 2, 0, 'enum:EQ_TYPES_L'],
    ['typeH', 'EQ Type H', 'enum', 0, 2, 0, 'enum:EQ_TYPES_H'],
  ]);
  fxm('fil', 'FX Filter', [['type', 'FX Filter Type', 'enum', 0, 95, 0, 'enum:FILTERS']]);
  return D;
})());

// v1 FX destination ids that are renamed in v2 (§2.6.2): Hyper's Dimension parameters belong to the Hyper instance
export const RENAME1 = deepFreeze({ 'fx.dim.size': 'fx.hyper.dsize', 'fx.dim.mix': 'fx.hyper.dmix', 'fx.dim.level': 'fx.hyper.dlevel' });

/* ================================================================ v1 internals: rows by id, normalisation helpers */

const NF = FX_ROWS_V1.length;                          // 100 (Phase-1 NF = ND − NS)
const ROW_MAP = new Map(FX_ROWS_V1.map((d, k) => [d.id, k]));
const K_BYPASS = ROW_MAP.get('g.bypass');            // 86 (Phase-1 I_BYPASS − NS)
const K_FIL_TYPE = ROW_MAP.get('fx.fil.type');       // 99 (Phase-1 FIDX.FIL_TYPE)
// engine value → n for a v1 FX row id (Phase-1 serum-core lawNorm restricted to the FX rows); unknown id → v
function lawNormFx(id, v) {
  const k = ROW_MAP.get(id);
  if (k === undefined) return v;
  const d = FX_ROWS_V1[k];
  return lawNormL(d.law, d.lo, d.hi, v, d.def);
}
function normN(k, x) {
  const d = FX_ROWS_V1[k];
  return fin(x) ? snapL(d.law, d.lo, d.hi, clamp(x, 0, 1)) + 0 : d.def;
}

const DIAG = [[0, 0, 0], [1, 1, 0]];
const clonePts = pts => pts.map(p => p.slice());
const busOf = x => (fin(x) ? clamp(Math.round(x), 0, N_BUS) : 0);
const RAW_PTS_MAX = 65536;   // hostile input bound: entries beyond this are not even inspected

// Repairs a graph (§2.3): drops malformed points, clamps, rounds to 5 decimals, sorts by x (stable),
// keeps ≤ MAX_PTS points, forces x = 0 / 1 at the ends. lfo = true keeps bus links (mx, my).
function normPts(raw, def, lfo) {
  if (!Array.isArray(raw)) return clonePts(def);
  let out = [];
  for (let i = 0, n = Math.min(raw.length, RAW_PTS_MAX); i < n; i++) {
    const p = raw[i];
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) continue;
    const q = [r5(clamp(p[0], 0, 1)), r5(clamp(p[1], 0, 1)), fin(p[2]) ? r5(clamp(p[2], -1, 1)) : 0];
    if (lfo) { const mx = busOf(p[3]), my = busOf(p[4]); if (mx || my) q.push(mx, my); }
    out.push(q);
  }
  if (!out.length) return clonePts(def);
  out.sort((a, b) => a[0] - b[0]);
  if (out.length > MAX_PTS) out = out.slice(0, MAX_PTS);
  if (out.length === 1) out.push([1, out[0][1], 0]);
  const first = out[0], last = out[out.length - 1];
  first[0] = 0;
  last[0] = 1;
  for (const p of [first, last]) {
    if (p.length > 3) { p[3] = 0; if (!p[4]) p.length = 3; }
  }
  return out;
}

/* ================================================================ §2.5 FX state (v1) */

const MOD_IDS = FX_ORDER_DEFAULT;
const UI_LVL_KEYS = ['hyper', 'dim', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'fil'];
const FX_P_IDX = [];   // row indices stored in fx.p (fx idx 1–85, 87–99)
for (let k = 0; k < NF; k++) if (FX_ROWS_V1[k].id !== 'g.master' && k !== K_BYPASS) FX_P_IDX.push(k);
const FX_ENABLE = MOD_IDS.map(m => ROW_MAP.get('fx.' + m + '.on'));   // fx idx of each module's enable
const MOD_INDEX = MOD_IDS.reduce((o, m, i) => { o[m] = i; return o; }, {});

export function defaultFxV1() {
  const p = {};
  for (const k of FX_P_IDX) p[FX_ROWS_V1[k].id] = FX_ROWS_V1[k].def;
  const byp = {}, lvl = {};
  for (const m of MOD_IDS) byp[m] = 0;
  for (const k of UI_LVL_KEYS) lvl[k] = 0;
  return {
    v: FX_V1,
    order: MOD_IDS.slice(),
    byp,
    p,
    dist: { xa: clonePts(DIAG), xb: clonePts(DIAG) },
    cho: { mono: 0 },
    rev: { type: 1 },
    phase: [0, 0, 0, 0],
    lock: 0,
    ui: { lvl, sel: '' },
  };
}

export function normalizeFxV1(fx) {
  const F = objOf(fx), order = [];
  for (const m of arrOf(F.order)) if (typeof m === 'string' && own(MOD_INDEX, m) && order.indexOf(m) < 0) order.push(m);
  for (const m of MOD_IDS) if (order.indexOf(m) < 0) order.push(m);
  const B = objOf(F.byp), byp = {};
  for (const m of MOD_IDS) byp[m] = bit(B[m], 0);
  const P = objOf(F.p), p = {};
  for (const k of FX_P_IDX) p[FX_ROWS_V1[k].id] = normN(k, P[FX_ROWS_V1[k].id]);
  const dist = objOf(F.dist), ph = arrOf(F.phase), U = objOf(F.ui), L = objOf(U.lvl), lvl = {};
  for (const k of UI_LVL_KEYS) lvl[k] = bit(L[k], 0);
  return {
    v: FX_V1,
    order,
    byp,
    p,
    dist: { xa: normPts(dist.xa, DIAG, false), xb: normPts(dist.xb, DIAG, false) },
    cho: { mono: bit(objOf(F.cho).mono, 0) },
    rev: { type: intIn(objOf(F.rev).type, 1, 0, 1) },
    phase: [0, 1, 2, 3].map(k => (fin(ph[k]) ? frac(ph[k]) + 0 : 0)),
    lock: bit(F.lock, 0),
    ui: { lvl, sel: typeof U.sel === 'string' && own(MOD_INDEX, U.sel) ? U.sel : '' },
  };
}

/* ================================================================ §4.2 compilers (v1) */

const FNV0 = 0x811c9dc5;
function fnv(h, v) {
  v |= 0;
  h = Math.imul(h ^ (v & 255), 16777619);
  h = Math.imul(h ^ ((v >>> 8) & 255), 16777619);
  h = Math.imul(h ^ ((v >>> 16) & 255), 16777619);
  return Math.imul(h ^ (v >>> 24), 16777619);
}
// Hashes a graph and checks that it is in normalized form (§2.3): 2…MAX_PTS points; x numeric, non-decreasing,
// first 0 and last 1; y in [0, 1]; c absent or in [−1, 1]; mx / my absent or integers 0…16; no mx on an end
// point. Anything else sets hashBad, which makes the compilers repair the state through normalize first: a key
// always describes the values the tables are built from, so a malformed curve can never put NaN tables into the
// shared cache (and be served to the repaired state, whose key would be the same).
let hashBad = false;
const busOk = v => v === undefined || (Number.isInteger(v) && v >= 0 && v <= N_BUS);
function fnvPts(h, pts) {
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_PTS) { hashBad = true; return h; }
  const last = pts.length - 1;
  h = fnv(h, pts.length);
  let px = 0;
  for (let i = 0; i <= last; i++) {
    const p = pts[i];
    if (!Array.isArray(p)) { hashBad = true; return h; }
    const x = p[0], y = p[1], c = p[2] === undefined ? 0 : p[2];
    if (!fin(x) || !fin(y) || !fin(c) || x < px || x > 1 || y < 0 || y > 1 || c < -1 || c > 1 || !busOk(p[3]) || !busOk(p[4])
      || (i === 0 && x !== 0) || (i === last && x !== 1) || ((i === 0 || i === last) && p[3])) { hashBad = true; return h; }
    px = x;
    h = fnv(h, Math.round(x * 1e5));
    h = fnv(h, Math.round(y * 1e5));
    h = fnv(h, Math.round(c * 1e5));
    h = fnv(h, p[3] || 0);
    h = fnv(h, p[4] || 0);
  }
  return h;
}
const hex = h => (h >>> 0).toString(16).padStart(8, '0');

// Small LRU of compiled curve tables, keyed by content (several tracks compile alternately)
function lruGet(cache, key, build) {
  let v = cache.get(key);
  if (v) { cache.delete(key); cache.set(key, v); return v; }
  v = build();
  cache.set(key, v);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  return v;
}
const FXT_CACHE = new Map();

// Compiler ctx scalars (§4.2, §9.7): tempo 20–999 BPM (missing / non-positive → 120), smoothing scale 0.01–8
// (missing → 1). A zero or negative value would make ladder times or smoothing coefficients diverge.
const ctxTempo = c => (fin(c.bpm) && c.bpm > 0 ? clamp(c.bpm, 20, 999) : 120);
const ctxSmooth = c => (fin(c.smooth) ? clamp(c.smooth, 0.01, 8) : 1);

// X-Shaper tables key (§4.2), or null when a curve is malformed
function xsKeyOf(fx) {
  hashBad = false;
  const h = fnvPts(fnvPts(FNV0, fx.dist.xa), fx.dist.xb);
  return hashBad ? null : hex(h);
}

// Cheap structural check of an FX state (anything failing it is compiled from normalizeFx(fx))
const isArr = (x, n) => Array.isArray(x) && x.length === n;
function fxShapeOk(fx) {
  if (!isObj(fx) || fx.v !== FX_V1 || !isObj(fx.p) || !isObj(fx.byp) || !isArr(fx.order, 10) || !isObj(fx.dist)
    || !isObj(fx.cho) || !isObj(fx.rev) || !isArr(fx.phase, 4)) return false;
  let seen = 0;
  for (let j = 0; j < 10; j++) {
    const m = fx.order[j];
    if (typeof m !== 'string' || !own(MOD_INDEX, m) || seen & (1 << MOD_INDEX[m])) return false;
    seen |= 1 << MOD_INDEX[m];
  }
  return true;
}
const fxValid = fx => fxShapeOk(fx) && xsKeyOf(fx) !== null;

// FXT (§4.2) = { key, xsA, xsB } X-Shaper tables for patch.fxrT; memoised by content (shared object)
export function compileFxTV1(fx) {
  const F = fxValid(fx) ? fx : normalizeFxV1(fx), key = xsKeyOf(F);
  return lruGet(FXT_CACHE, key, () => ({ key, xsA: renderPts(F.dist.xa, XS_N), xsB: renderPts(F.dist.xb, XS_N) }));
}

// §4.2: normalized FX state → FXP (patch.fxr). ctx = { bpm, master, bypass, modded, seed, smooth, silence }.
// Never throws: a state that is not normalized is repaired (normalizeFx) before compiling.
export function compileFxV1(fx, ctx) {
  if (fxShapeOk(fx)) {
    try {
      const P = compileFxCore(fx, ctx);
      if (P) return P;
    } catch (err) { /* malformed inner value: compile the repaired copy below */ }
  }
  return compileFxCore(normalizeFxV1(fx), ctx);
}

function compileFxCore(fx, ctx) {
  const xsKey = xsKeyOf(fx);
  if (xsKey === null) return null;
  const c = isObj(ctx) ? ctx : {}, P = fx.p;
  const base = new Float64Array(NF);
  for (let k = 0; k < NF; k++) { const d = FX_ROWS_V1[k], v = P[d.id]; base[k] = fin(v) ? clamp01(v) : d.def; }
  base[0] = fin(c.master) ? clamp01(c.master) : 1;
  base[K_BYPASS] = fin(c.bypass) ? (c.bypass >= 0.5 ? 1 : 0) : 0;
  const modded = c.modded && c.modded.length >= NF ? c.modded : null;
  const order = new Uint8Array(10), byp = new Uint8Array(10), alloc = new Uint8Array(10);
  for (let j = 0; j < 10; j++) order[j] = MOD_INDEX[fx.order[j]];
  let any = 0;
  for (let m = 0; m < 10; m++) {
    byp[m] = fx.byp[MOD_IDS[m]] ? 1 : 0;
    const e = FX_ENABLE[m], on = base[e] >= 0.5;
    if (on) any = 1;
    alloc[m] = on || (modded && modded[e]) ? 1 : 0;
  }
  return {
    ver: FXP_V1, NF,
    base, order, byp,
    revType: intIn(fx.rev.type, 1, 0, 1), choMono: fx.cho.mono ? 1 : 0,
    alloc,
    filTypeAll: modded && modded[K_FIL_TYPE] ? 1 : 0,
    phase: Float64Array.from(fx.phase, x => (fin(x) ? frac(x) : 0)),
    seed: c.seed ? 1 : 0,
    any,
    bpm: ctxTempo(c),
    smooth: ctxSmooth(c),
    silence: bit(c.silence, 1),
    xsKey,
  };
}

// FX side of a preset load (§8.1): Lock FX Rack keeps (a deep copy of) the current rack; otherwise the preset's
// rack (default when absent) with the locked FX ids' values, `ui` and `lock` taken from curFx.
export function applyPresetFxV1(curFx, presetFx, lockedIds) {
  const c = normalizeFxV1(curFx);
  if (c.lock) return c;
  const r = normalizeFxV1(presetFx === undefined || presetFx === null ? defaultFxV1() : presetFx);
  for (const id of arrOf(lockedIds)) if (typeof id === 'string' && own(r.p, id)) r.p[id] = c.p[id];
  r.ui = c.ui;
  r.lock = c.lock;
  return r;
}

/* ================================================================ factory effect chains (shared chain library format) */

const ON = 1;
const DLY_N = lab => DLY_LADDER.findIndex(e => e.label === lab) / (DLY_LADDER.length - 1);
const MFX_N = lab => MODFX_LADDER.findIndex(e => e.label === lab) / (MODFX_LADDER.length - 1);
const dbA = db => Math.pow(10, db / 20);
const OTT = (o) => Object.assign({ 'fx.cmp.on': ON, 'fx.cmp.mb': ON, 'fx.cmp.thr': dbA(-24), 'fx.cmp.ratio': 6, 'fx.cmp.att': 2, 'fx.cmp.rel': 90,
  'fx.cmp.mbL': 1, 'fx.cmp.mbM': 1, 'fx.cmp.mbH': 1, 'fx.cmp.gain': dbA(9), 'fx.cmp.mix': 0.6 }, o);

// Rack presets for any track (FX tab of every model, Serum's FX page): the library form the rack and SerumUI read and
// write ({ type: 'synth.fxchains', v: 1, chains: [{ name, fx }] }, fx without ui / lock). Levels were checked on a
// plain saw, a Serum pad and drum hits: each chain keeps the peak within a few dB of the dry signal.
function chain(name, r) {
  const fx = defaultFxV1();
  for (const id of Object.keys(r.fx || {})) fx.p[id] = lawNormFx(id, r.fx[id]);
  Object.assign(fx.p, r.fxn || {});
  if (r.order) fx.order = r.order.concat(fx.order.filter(m => !r.order.includes(m)));
  if (r.rev !== undefined) fx.rev.type = r.rev;
  if (r.mono !== undefined) fx.cho.mono = r.mono;
  const c = normalizeFxV1(fx);
  delete c.ui; delete c.lock;
  return { name, fx: c };
}
export const FACTORY_CHAINS_V1 = deepFreeze({ type: 'synth.fxchains', v: 1, chains: [
  chain('Wide Chorus', { fx: { 'fx.cho.on': ON, 'fx.cho.rate': 0.35, 'fx.cho.dly1': 7, 'fx.cho.dly2': 13, 'fx.cho.depth': 4, 'fx.cho.feed': 0.15,
    'fx.cho.lpf': 9000, 'fx.cho.mix': 0.45 } }),
  chain('Dub Delay', {
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.offL': 1.5, 'fx.dly.offR': 1.5, 'fx.dly.feed': 0.62, 'fx.dly.freq': 1100, 'fx.dly.q': 2.2,
      'fx.dly.mix': 0.35, 'fx.rev.on': ON, 'fx.rev.size': 0.35, 'fx.rev.mix': 0.15 },
    fxn: { 'fx.dly.timeL': DLY_N('1/4'), 'fx.dly.timeR': DLY_N('1/4') }, rev: 0,
  }),
  chain('Hall Verb', { fx: { 'fx.rev.on': ON, 'fx.rev.size': 0.75, 'fx.rev.t': 0.3, 'fx.rev.locut': 0.25, 'fx.rev.hicut': 0.45, 'fx.rev.c': 0.3,
    'fx.rev.w': 0.35, 'fx.rev.mix': 0.3 } }),
  chain('Plate Room', { fx: { 'fx.rev.on': ON, 'fx.rev.size': 0.4, 'fx.rev.t': 0.08, 'fx.rev.locut': 0.2, 'fx.rev.c': 0.4, 'fx.rev.hicut': 0.35,
    'fx.rev.w': 0.8, 'fx.rev.mix': 0.22 }, rev: 0 }),
  chain('OTT Squash', { fx: OTT({ 'fx.cmp.gain': dbA(6), 'fx.cmp.mix': 0.55 }) }),
  chain('Lo-Fi', { fx: { 'fx.dist.on': ON, 'fx.dist.mode': 8, 'fx.dist.drive': 0.45, 'fx.dist.mix': 0.55, 'fx.cho.on': ON, 'fx.cho.rate': 0.6,
    'fx.cho.dly1': 4, 'fx.cho.dly2': 4, 'fx.cho.depth': 1.2, 'fx.cho.feed': 0, 'fx.cho.lpf': 6000, 'fx.cho.mix': 0.45, 'fx.eq.on': ON,
    'fx.eq.typeL': 2, 'fx.eq.freqL': 180, 'fx.eq.qL': 0.3, 'fx.eq.typeH': 2, 'fx.eq.freqH': 4500, 'fx.eq.qH': 0.3 }, mono: 1 }),
  chain('Hyper Wide', { fx: { 'fx.hyper.on': ON, 'fx.hyper.unison': 5, 'fx.hyper.detune': 0.3, 'fx.hyper.rate': 0.35, 'fx.hyper.mix': 0.35,
    'fx.dim.size': 0.6, 'fx.dim.mix': 0.45 } }),
  chain('Jet Phaser', { fx: { 'fx.phs.on': ON, 'fx.phs.bpm': ON, 'fx.phs.depth': 0.7, 'fx.phs.freq': 900, 'fx.phs.feed': 0.6, 'fx.phs.mix': 0.6,
    'fx.flg.on': ON, 'fx.flg.bpm': ON, 'fx.flg.depth': 0.5, 'fx.flg.feed': 0.35, 'fx.flg.mix': 0.35 },
    fxn: { 'fx.phs.rate': MFX_N('2 bar'), 'fx.flg.rate': MFX_N('4 bar') } }),
  chain('Grit Drive', { fx: { 'fx.dist.on': ON, 'fx.dist.mode': 0, 'fx.dist.drive': 0.4, 'fx.dist.filt': 2, 'fx.dist.lbh': 0, 'fx.dist.freq': 8000,
    'fx.dist.q': 0.7, 'fx.dist.mix': 0.65, 'fx.cmp.on': ON, 'fx.cmp.att': 6, 'fx.cmp.rel': 120, 'fx.cmp.thr': dbA(-12), 'fx.cmp.ratio': 2.5 } }),
] });


/* ================================================================ §3.16 FX v2 catalogue */

export const MAX_INST = 48;                            // instances per track (top level + branches, §2.5)
const MAX_TOP = 16, MAX_BR = 8;                        // top-level instances per rack, instances per splitter branch
export const DIST_MODES2 = deepFreeze(DIST_MODES.concat(['Overdrive', 'Soft Sat.']));
export const REV_TYPES2 = deepFreeze(['Plate', 'Hall', 'Vintage', 'Nitrous', 'Basin']);
export const NITROUS_MODES = deepFreeze(['Space', 'Marble', 'Rectangle', 'Hexagon', 'Box']);
// controls shown per S2 reverb type (inv B14.4), by REV_TYPES2 index
export const REV_LABELS2 = deepFreeze([
  ['locut', 'hicut', 'size', 'pre', 'damp', 'width'],
  ['locut', 'hicut', 'size', 'pre', 'decay', 'spinr', 'spind'],
  ['locut', 'hicut', 'size', 'pre', 'ersize', 'decay', 'damp', 'diffa', 'diffb', 'chr', 'chd'],
  ['locut', 'hicut', 'size', 'pre', 'feed', 'diff', 'nmode', 'chr', 'chd'],
  ['locut', 'hicut', 'size', 'pre', 'feed', 'chr', 'chd'],
]);
export const CONV_IR_DEFAULT = 'fir:Medium/Chamber';

// §3.16.1: index = S2 type id (FXP iType); variants (new instances get the highest); mix kind; splitter branch count
export const FXTYPES = deepFreeze([
  ['dist', 'Distortion', [1, 2], 'sin2', 0], ['flg', 'Flanger', [1], 'sin2', 0], ['phs', 'Phaser', [1, 2], 'sin2', 0],
  ['cho', 'Chorus', [1, 2], 'sin2', 0], ['dly', 'Delay', [1, 2], 'sin2', 0], ['cmp', 'Compressor', [1, 2], 'sin2', 0],
  ['rev', 'Reverb', [1, 2], 'sin2', 0], ['eq', 'Equalizer', [1, 2], 'none', 0], ['fil', 'Filter', [1, 2], 'linear', 0],
  ['hyper', 'Hyper/Dimension', [1], 'additive', 0], ['bode', 'Bode', [2], 'sin2', 0], ['conv', 'Convolve', [2], 'sin2', 0],
  ['util', 'Utility', [2], 'linear', 0], ['split2', 'Splitter L/H', [2], 'branches', 2],
  ['split3', 'Splitter L/M/H', [2], 'branches', 3], ['splitms', 'Splitter M/S', [2], 'branches', 2],
].map(([id, label, variants, mix, split]) => ({ id, label, variants, mix, split })));
const TYPE_IDX = FXTYPES.reduce((o, t, i) => { o[t.id] = i; return o; }, {});
const typeOf = id => (typeof id === 'string' && own(TYPE_IDX, id) ? FXTYPES[TYPE_IDX[id]] : null);
const ADD_RACK = deepFreeze(FXTYPES.map(t => t.id)), ADD_BRANCH = deepFreeze(FXTYPES.filter(t => !t.split).map(t => t.id));
// §3.16.1 addable(where[, type]): the types that can be added at `where` — every type in a MAIN / BUS rack, the 13
// effects (no splitters, deviation 10) inside a splitter branch. `where` = a location as newInstance takes it
// ({rack, splitter, branch}: a splitter id means a branch), or true / 'branch' for a branch; with `type` → boolean
export function addable(where, type) {
  const inBr = where === true || where === 'branch' || (isObj(where) && typeof where.splitter === 'string' && where.splitter !== '');
  const list = inBr ? ADD_BRANCH : ADD_RACK;
  return type === undefined ? list : list.indexOf(type) >= 0;
}

// S1 variants: the Phase-1 rows of the module in fx idx order (Hyper's Dimension rows as dsize / dmix / dlevel), with the
// module prefix dropped from the label (the destination label is "<instance label> <param label>", §3.16.4)
const renamed = id => (own(RENAME1, id) ? RENAME1[id] : id);
const S1_ROWS = {};
for (let k = 0; k < NF; k++) {
  const m = /^fx\.([a-z]+)\./.exec(renamed(FX_ROWS_V1[k].id));
  if (m) (S1_ROWS[m[1]] || (S1_ROWS[m[1]] = [])).push(k);
}
export const FX_S1_IDX = deepFreeze(FX_ORDER_DEFAULT.reduce((o, m) => { o[m] = S1_ROWS[m].slice(); return o; }, {}));
const V1_OF = new Map(FX_ROWS_V1.map((d, k) => [renamed(d.id), k]));      // renamed v1 FX id → v1 fx idx
const PREFIXES = ['Hyper/Dim ', 'Hyper ', 'Distortion ', 'Dist ', 'Flanger ', 'Phaser ', 'Chorus ', 'Delay ', 'Compressor ', 'Comp ',
  'Reverb ', 'EQ ', 'FX Filter '];
const shortLabel = l => { for (const p of PREFIXES) if (l.indexOf(p) === 0) return l.slice(p.length); return l; };
function rowOf1(k) {
  const d = FX_ROWS_V1[k], id = renamed(d.id);
  return { pid: id.slice(id.lastIndexOf('.') + 1), label: shortLabel(d.label), law: d.law, lo: d.lo, hi: d.hi, def: d.def, fmt: d.fmt, ctr: d.ctr };
}
const R2 = (pid, label, law, lo, hi, def, fmt, ctr, nomod) => (nomod
  ? { pid, label, law, lo, hi, def, fmt, ctr: ctr ? 1 : 0, nomod: true } : { pid, label, law, lo, hi, def, fmt, ctr: ctr ? 1 : 0 });
const ON2 = () => R2('on', 'Enable', 'bool', 0, 1, 1, 'bool');
const LVL2 = () => R2('level', 'Level', 'pow2', 0, 4, 0.5, 'dbtrim');
const MIX2 = def => R2('mix', 'Mix', 'lin', 0, 1, def, 'pct');
const BOOL2 = (pid, label, def) => R2(pid, label, 'bool', 0, 1, def, 'bool');
const PCT2 = (pid, label, def) => R2(pid, label, 'lin', 0, 1, def, 'pct');
const LAD2 = (pid, label) => R2(pid, label, 'enum', 0, 11, 7 / 11, 'enum:DLY_LADDER');
// S2 variant of a type with an S1 variant: the S1 table (enable default 1, `swap` rows replaced at their position)
// followed by `extra`
function s2Of(type, swap, extra) {
  return S1_ROWS[type].map(rowOf1).map(r => (r.pid === 'on' ? Object.assign(r, { def: 1 }) : own(swap, r.pid) ? swap[r.pid] : r)).concat(extra);
}
const s1Of = type => S1_ROWS[type].map(rowOf1);
export const FXP_TAB = deepFreeze({
  dist: { 1: s1Of('dist'), 2: s2Of('dist', { mode: R2('mode', 'Mode', 'enum', 0, 17, 0, 'enum:DIST_MODES2') },
    [BOOL2('kt', 'Key Track', 0), R2('stages', 'Stages', 'int', 1, 16, 3 / 15, 'int')]) },
  flg: { 1: s1Of('flg') },
  phs: { 1: s1Of('phs'), 2: s2Of('phs', {}, [R2('poles', 'Poles', 'int', 1, 18, 3 / 17, 'int'), PCT2('depth2', 'Depth 2', 0)]) },
  cho: { 1: s1Of('cho'), 2: s2Of('cho', {}, [BOOL2('hp', 'HPF', 0)]) },
  dly: { 1: s1Of('dly'), 2: s2Of('dly', {}, [BOOL2('hq', 'High Quality', 1)]) },
  cmp: { 1: s1Of('cmp'), 2: s2Of('cmp', {}, [R2('xlo', 'X-Low', 'exp', 20, 1000, 0.4751, 'hz'), R2('xhi', 'X-High', 'exp', 500, 16000, 0.4644, 'hz'),
    R2('below', 'Below', 'ratio', 1, 32, 0, 'ratio'), R2('gL', 'Low Gain', 'lin', -24, 24, 0.5, 'dbv'), R2('gM', 'Mid Gain', 'lin', -24, 24, 0.5, 'dbv'),
    R2('gH', 'High Gain', 'lin', -24, 24, 0.5, 'dbv')]) },
  rev: { 1: s1Of('rev'), 2: [ON2(), R2('type', 'Type', 'enum', 0, 4, 0, 'enum:REV_TYPES2'), PCT2('size', 'Size', 0.5),
    R2('pre', 'Pre-Delay', 'pow3', 0, 2500, 0, 'ms'), BOOL2('prebpm', 'Pre-Delay BPM', 0), LAD2('prelad', 'Pre-Delay Sync'),
    PCT2('locut', 'Low Cut', 0), PCT2('hicut', 'High Cut', 0.3), PCT2('damp', 'Damp', 0.5), PCT2('width', 'Width', 1),
    PCT2('decay', 'Decay', 0.3), PCT2('spinr', 'Spin Rate', 0.25), PCT2('spind', 'Spin Depth', 0.2), PCT2('ersize', 'ER Size', 0.5),
    PCT2('diffa', 'Diffusion A', 0.7), PCT2('diffb', 'Diffusion B', 0.5), PCT2('chr', 'Chorus Rate', 0.2), PCT2('chd', 'Chorus Depth', 0.2),
    PCT2('feed', 'Feedback', 0.6), PCT2('diff', 'Diffusion', 0.7), R2('nmode', 'Mode', 'enum', 0, 4, 0, 'enum:NITROUS_MODES'), MIX2(0.3),
    LVL2()] },
  eq: { 1: s1Of('eq'), 2: s2Of('eq', {}, [LVL2()]) },
  fil: { 1: s1Of('fil'), 2: s2Of('fil', { type: R2('type', 'Type', 'enum', 0, 107, 0, 'enum:FILTERS') },
    [BOOL2('kt', 'Key Track', 0), BOOL2('clean', 'Clean Mode', 0)]) },
  hyper: { 1: s1Of('hyper') },
  bode: { 2: [ON2(), BOOL2('mono', 'Mono Input', 0), R2('shift', 'Shift', 'lin', -1, 1, 0.5, 'bip100', 1),
    R2('range', 'Range', 'exp', 0.1, 5000, 0.6384, 'hz'), R2('dir', 'Direction', 'lin', -1, 1, 1, 'bip100', 1), PCT2('width', 'Width', 1),
    R2('delay', 'Delay', 'pow2', 0, 2000, 0, 'ms'), BOOL2('bpm', 'Delay BPM', 0), LAD2('dlad', 'Delay Sync'), PCT2('feed', 'Feedback', 0),
    R2('bal', 'Balance', 'lin', -1, 1, 0.5, 'bip100', 1), PCT2('blur', 'Blur', 0), BOOL2('retrig', 'Retrig', 0), MIX2(1), LVL2()] },
  conv: { 2: [ON2(), R2('size', 'Size', 'exp', 0.1, 10, 0.5, 'pct1', 0, true), R2('tone', 'Tone', 'lin', -1, 1, 0.5, 'bip100', 1, true),
    R2('minph', 'Min Phase', 'bool', 0, 1, 0, 'bool', 0, true), R2('pre', 'Pre-Delay', 'pow2', 0, 1000, 0, 'ms'),
    BOOL2('prebpm', 'Pre-Delay BPM', 0), LAD2('prelad', 'Pre-Delay Sync'), R2('att', 'Attack', 'lin', 0, 1, 0, 'pct', 0, true),
    R2('dec', 'Decay', 'lin', 0, 1, 1, 'pct', 0, true), R2('damp', 'Damp', 'lin', 0, 1, 0, 'pct', 0, true),
    R2('irgain', 'IR Gain', 'lin', -48, 12, 0.5, 'dbv'), MIX2(0.5), LVL2()] },
  util: { 2: [ON2(), BOOL2('invL', 'Invert L', 0), BOOL2('invR', 'Invert R', 0), R2('lpf', 'LPF', 'exp', 50, 20000, 1, 'hz'),
    R2('hpf', 'HPF', 'exp', 1, 400, 0, 'hz'), BOOL2('mbass', 'Mono Bass', 0), R2('mfreq', 'Mono Bass Freq', 'exp', 20, 400, 0.5021, 'hz'),
    R2('width', 'Width', 'lin', 0, 8, 0.125, 'pct1'), R2('pan', 'Pan', 'lin', -1, 1, 0.5, 'pan', 1), MIX2(1), LVL2()] },
  split2: { 2: [ON2(), R2('freq', 'Crossover', 'exp', 30, 5800, 0.4374, 'hz'), LVL2()] },
  split3: { 2: [ON2(), R2('freq1', 'Crossover 1', 'exp', 30, 5800, 0.3604, 'hz'), R2('freq2', 'Crossover 2', 'exp', 30, 5800, 0.7978, 'hz'), LVL2()] },
  splitms: { 2: [ON2(), LVL2()] },
});
const tabOf = (type, v) => FXP_TAB[type][v];

/* ================================================================ §2.5 FX state v2 */

const ID_RE = /^[a-z][a-z0-9]{0,11}$/;
const emptyRack = () => ({ mods: [], byp: 0, lock: 0, route: 0 });
const isV2 = fx => isObj(fx) && (fx.v === 2 || (fin(fx.v) && fx.v > 2));
const PH_SLOT = { hyper: 0, flg: 1, phs: 2, cho: 3 };      // v1 fx.phase slot of the modules with an LFO

export function defaultFx2() {
  return { v: 2, racks: [emptyRack(), emptyRack(), emptyRack()], ui: { rack: 0, sel: '', expand: 0, br: {} } };
}

function normSub(type, v, raw) {
  const S = objOf(raw);
  switch (type) {
    case 'dist': return { xa: normPts(S.xa, DIAG, false), xb: normPts(S.xb, DIAG, false) };
    case 'cho': return { mono: bit(S.mono, 0) };
    case 'rev': return v === 1 ? { type: intIn(S.type, 1, 0, 1) } : {};
    case 'conv': return { ir: typeof S.ir === 'string' && (S.ir === '' || /^(fir|ir):/.test(S.ir)) && S.ir.length <= 256 ? S.ir : CONV_IR_DEFAULT };
    default: return {};
  }
}
// visits the instances of a v2 state in processing order (§4.2): racks 0, 1, 2; list order; a splitter followed
// depth-first by its branch lists. fn(inst, rack, parent index, branch, index)
function walk(F, fn) {
  let i = 0;
  for (let k = 0; k < 3; k++) {
    for (const I of F.racks[k].mods) {
      const me = i++, T = typeOf(I.type);
      fn(I, k, -1, 0, me);
      if (T && T.split && Array.isArray(I.br)) for (let b = 0; b < I.br.length; b++) for (const c of I.br[b]) fn(c, k, me, b, i++);
    }
  }
  return i;
}
// instance ids of the FX instances a Serum state refers to (matrix destinations, locked controls, MIDI map; v1 Dimension
// ids belong to Hyper)
const REF_RE = /^fx\.([a-z][a-z0-9]{0,11})\./;
function refIds(s) {
  const out = new Set();
  if (!isObj(s)) return out;
  const add = id => { const m = typeof id === 'string' ? REF_RE.exec(id) : null; if (m) out.add(m[1] === 'dim' ? 'hyper' : m[1]); };
  for (const r of arrOf(s.matrix)) if (isObj(r)) add(r.dst);
  const L = objOf(s.locks);
  for (const id of arrOf(L.p)) add(id);
  for (const id of arrOf(L.unp)) add(id);
  const M = objOf(s.midi);
  for (const k of Object.keys(M)) add(M[k]);
  return out;
}

// §2.5 normalisation; v1 input (fx.v absent / 1) ⇒ migrateFx1(normalizeFxV1(fx), refs) (§2.6.3); v > 2: best effort.
// Ids: the first valid occurrence keeps its id, invalid / duplicate ids get `<type>` or `<type><k>` (lowest k ≥ 2, never
// an id used elsewhere in the input). Caps: 16 top-level instances per rack, 8 per branch, 48 per track (processing
// order), no splitters inside branches; both buses routed to each other ⇒ BUS 2 → Main. Idempotent; never mutates.
export function normalizeFx2(fx, refs) {
  if (!isObj(fx)) return defaultFx2();
  if (!isV2(fx)) return migrateFx1(fx, refs);
  const RK = arrOf(fx.racks), reserved = new Set(), used = new Set();
  const reserve = I => { if (isObj(I) && typeOf(I.type) && typeof I.id === 'string' && ID_RE.test(I.id)) reserved.add(I.id); };
  for (let k = 0; k < 3; k++) {
    for (const I of arrOf(objOf(RK[k]).mods)) {
      reserve(I);
      if (isObj(I) && Array.isArray(I.br)) for (const B of I.br) for (const c of arrOf(B)) reserve(c);
    }
  }
  const take = (I, type) => {
    let id = typeof I.id === 'string' && ID_RE.test(I.id) && !used.has(I.id) ? I.id : '';
    if (!id) {
      id = type;
      for (let k = 2; used.has(id) || (reserved.has(id) && id !== I.id); k++) id = type + k;
    }
    used.add(id);
    return id;
  };
  let n = 0;
  const inst = (raw, inBr) => {
    const I = objOf(raw), T = typeOf(I.type);
    if (!T || (inBr && T.split) || n >= MAX_INST) return null;
    n++;
    const v = T.variants.indexOf(I.v) >= 0 ? I.v : T.variants[T.variants.length - 1];
    const id = take(I, T.id), tab = tabOf(T.id, v), P = objOf(I.p), p = {};
    for (const r of tab) p[r.pid] = fin(P[r.pid]) ? snapL(r.law, r.lo, r.hi, clamp(P[r.pid], 0, 1)) + 0 : r.def;
    const o = { id, type: T.id, v, byp: bit(I.byp, 0), p, sub: normSub(T.id, v, I.sub), ph: fin(I.ph) ? frac(I.ph) + 0 : 0 };
    if (T.split) {
      const B = arrOf(I.br), BB = arrOf(I.bb);
      o.br = []; o.bb = [];
      for (let b = 0; b < T.split; b++) {
        const list = [];
        for (const c of arrOf(B[b])) { if (list.length >= MAX_BR) break; const x = inst(c, true); if (x) list.push(x); }
        o.br.push(list); o.bb.push(bit(BB[b], 0));
      }
    }
    const U = objOf(I.ui);
    o.ui = { lvl: bit(U.lvl, 0), lvl2: bit(U.lvl2, 0) };
    return o;
  };
  const racks = [];
  for (let k = 0; k < 3; k++) {
    const Rk = objOf(RK[k]), mods = [];
    for (const raw of arrOf(Rk.mods)) { if (mods.length >= MAX_TOP) break; const x = inst(raw, false); if (x) mods.push(x); }
    racks.push({ mods, byp: bit(Rk.byp, 0), lock: bit(Rk.lock, 0), route: k === 0 ? 0 : intIn(Rk.route, 0, 0, 2) });
  }
  if (racks[1].route === 2 && racks[2].route === 2) racks[2].route = 0;
  const out = { v: 2, racks, ui: null }, U = objOf(fx.ui), UB = objOf(U.br), br = {};
  walk(out, I => { const T = typeOf(I.type); if (T.split && own(UB, I.id) && fin(UB[I.id])) br[I.id] = intIn(UB[I.id], 0, 0, T.split - 1); });
  out.ui = { rack: intIn(U.rack, 0, 0, 2), sel: typeof U.sel === 'string' && used.has(U.sel) ? U.sel : '', expand: bit(U.expand, 0), br };
  return out;
}

// the S1 instance of v1 module m of a v1 state (values as stored: callers guard them)
function s1Inst(F, m) {
  const p = {};
  for (const k of S1_ROWS[m]) { const r = FX_ROWS_V1[k], id = renamed(r.id); p[id.slice(id.lastIndexOf('.') + 1)] = F.p[r.id]; }
  const sub = m === 'dist' ? { xa: F.dist.xa, xb: F.dist.xb } : m === 'cho' ? { mono: F.cho.mono ? 1 : 0 }
    : m === 'rev' ? { type: intIn(F.rev.type, 1, 0, 1) } : {};
  const ph = own(PH_SLOT, m) ? F.phase[PH_SLOT[m]] : 0, L = isObj(F.ui) ? objOf(F.ui.lvl) : {};
  return { id: m, type: m, v: 1, byp: F.byp[m] ? 1 : 0, p, sub, ph: fin(ph) ? frac(ph) + 0 : 0,
    ui: { lvl: bit(L[m], 0), lvl2: m === 'hyper' ? bit(L.dim, 0) : 0 } };
}
const pristinePts = pts => JSON.stringify(pts) === JSON.stringify(DIAG);

// §2.6.3: v1 FX state → v2. Each module of the v1 order becomes S1 instance `m`; it is kept if enabled, bypassed, edited
// (any parameter or sub-state off its v1 default) or referenced by `refs` (a Serum state: rows, locks, MIDI map), else
// dropped (a pristine disabled module produces no output). racks[0].lock = v1 lock; buses empty.
export function migrateFx1(v1, refs) {
  const F = normalizeFxV1(v1), keep = refIds(refs), mods = [];
  for (const m of F.order) {
    const I = s1Inst(F, m);
    let edited = I.byp === 1 || I.p.on >= 0.5 || keep.has(m);
    for (const k of S1_ROWS[m]) { const r = FX_ROWS_V1[k], id = renamed(r.id); if (I.p[id.slice(id.lastIndexOf('.') + 1)] !== r.def) edited = true; }
    if (m === 'dist' && !(pristinePts(I.sub.xa) && pristinePts(I.sub.xb))) edited = true;
    if (m === 'cho' && I.sub.mono !== 0) edited = true;
    if (m === 'rev' && I.sub.type !== 1) edited = true;
    if (!edited) continue;
    if (m === 'dist') I.sub = { xa: clonePts(I.sub.xa), xb: clonePts(I.sub.xb) };
    mods.push(I);
  }
  const sel = F.ui.sel && mods.some(I => I.id === F.ui.sel) ? F.ui.sel : '';
  return { v: 2, racks: [{ mods, byp: 0, lock: F.lock, route: 0 }, emptyRack(), emptyRack()], ui: { rack: 0, sel, expand: 0, br: {} } };
}

// a v1 state read by the compiled-format functions: every module as an S1 instance in the v1 order (no keep/drop rule)
function viewV1(F) {
  return { v: 2, racks: [{ mods: F.order.map(m => s1Inst(F, m)), byp: 0, lock: F.lock ? 1 : 0, route: 0 }, emptyRack(), emptyRack()],
    ui: { rack: 0, sel: '', expand: 0, br: {} } };
}
// structural check of a v2 state (values are guarded where they are read); anything failing it is normalized first
function fx2ShapeOk(fx) {
  if (fx.v !== 2 || !isArr(fx.racks, 3)) return false;
  const ids = new Set();
  let n = 0;
  const ok = (I, inBr) => {
    if (!isObj(I) || typeof I.id !== 'string' || !ID_RE.test(I.id) || ids.has(I.id) || !isObj(I.p) || !isObj(I.sub)) return false;
    const T = typeOf(I.type);
    if (!T || T.variants.indexOf(I.v) < 0 || (inBr && T.split) || ++n > MAX_INST) return false;
    ids.add(I.id);
    if (T.split) {
      if (!isArr(I.br, T.split) || !isArr(I.bb, T.split)) return false;
      for (const B of I.br) {
        if (!Array.isArray(B) || B.length > MAX_BR) return false;
        for (const c of B) if (!ok(c, true)) return false;
      }
    }
    return true;
  };
  for (let k = 0; k < 3; k++) {
    const Rk = fx.racks[k];
    if (!isObj(Rk) || !Array.isArray(Rk.mods) || Rk.mods.length > MAX_TOP) return false;
    for (const I of Rk.mods) if (!ok(I, false)) return false;
  }
  return true;
}
// the v2 state a compiled-format function reads (see the header)
function stateOf(fx) {
  if (isV2(fx)) return fx2ShapeOk(fx) ? fx : normalizeFx2(fx);
  return viewV1(fxShapeOk(fx) ? fx : normalizeFxV1(fx));
}

/* ================================================================ §4.2 layout, §3.16.4 dynamic destinations */

const fnvStr = (h, s) => { for (let i = 0; i < s.length; i++) h = fnv(h, s.charCodeAt(i)); return h; };
const LAYOUTS = new Map();
function layoutOf(F) {
  let sig = '';
  walk(F, (I, k, par, b) => { sig += I.id + '|' + I.type + '|' + I.v + '|' + k + '|' + par + '|' + b + ';'; });
  return lruGet(LAYOUTS, sig, () => {
    const inst = [];
    let off = 0;
    walk(F, (I, rack, parent, branch) => {
      const n = tabOf(I.type, I.v).length;
      inst.push({ id: I.id, type: I.type, v: I.v, rack, parent, branch, off, n });
      off += n;
    });
    return deepFreeze({ key: hex(fnvStr(FNV0, sig)), inst, NP: off });
  });
}
// §4.2: {key, inst: [{id, type, v, rack, parent, branch, off, n}], NP} (memoised, frozen); NFX = 8 + NP
export function fxLayout(fx) { return layoutOf(stateOf(fx)); }

const DYN_RE = /^fx\.([a-z][a-z0-9]{0,11})\.([A-Za-z][A-Za-z0-9]{0,15})$/;
// §3.16.4: dynamic destination fx.<inst>.<pid> (v1 Dimension ids through RENAME1) → {inst, type, v, pid, row, flat, nomod,
// index} (flat = FX parameter index: FX-context index 8 + flat; index = fxLayout index), or null
export function fxDest(id, fx) {
  if (typeof id !== 'string') return null;
  const m = DYN_RE.exec(renamed(id));
  if (!m) return null;
  const F = stateOf(fx);
  let I = null, i = -1;
  walk(F, (x, k, par, b, j) => { if (I === null && x.id === m[1]) { I = x; i = j; } });
  if (I === null) return null;
  const e = layoutOf(F).inst[i], tab = tabOf(e.type, e.v);
  for (let p = 0; p < tab.length; p++) {
    if (tab[p].pid === m[2]) return { inst: I, type: e.type, v: e.v, pid: m[2], row: tab[p], flat: e.off + p, nomod: !!tab[p].nomod, index: i };
  }
  return null;
}
// instance label (§3.16.4): type label + ' 2', ' 3' … for later instances of the type (processing order) + ' (Bus k)'
export function instLabel(fx, id) {
  const L = fxLayout(fx);
  let i = -1, k = 1;
  for (let j = 0; j < L.inst.length && i < 0; j++) if (L.inst[j].id === id) i = j;
  if (i < 0) return '';
  const e = L.inst[i];
  for (let j = 0; j < i; j++) if (L.inst[j].type === e.type) k++;
  return typeOf(e.type).label + (k > 1 ? ' ' + k : '') + (e.rack ? ' (Bus ' + e.rack + ')' : '');
}
// FXRack.phases() (fxLayout order, NaN = no LFO) back into a state, in place (phase memory, §8.1): v2 inst.ph, v1
// fx.phase[hyper, flg, phs, cho]. Returns fx.
export function storePhases(fx, ph) {
  if (!isObj(fx) || !ph || typeof ph.length !== 'number') return fx;
  if (isV2(fx)) {
    if (fx2ShapeOk(fx)) walk(fx, (I, k, par, b, i) => { const x = +ph[i]; if (isFinite(x)) I.ph = frac(x) + 0; });
  } else if (fxShapeOk(fx)) {
    layoutOf(viewV1(fx)).inst.forEach((e, i) => { const x = +ph[i]; if (own(PH_SLOT, e.type) && isFinite(x)) fx.phase[PH_SLOT[e.type]] = frac(x) + 0; });
  }
  return fx;
}

/* ================================================================ §4.3 compilers (v2) */

// ctx.modded as a Uint8Array(NFX) in FX-context layout, or null: NFX-long arrays are taken as they are; the Phase-1
// Uint8Array(100) (v1 fx idx order) is mapped through the instance ids (v1 module ids) and the S1 pids
function moddedCtx(md, NFX, L) {
  if (!md || typeof md !== 'object' || typeof md.length !== 'number') return null;
  if (md.length === NFX) return md;
  if (md.length !== NF) return null;
  const out = new Uint8Array(NFX);
  out[0] = md[0] ? 1 : 0;
  out[1] = md[K_BYPASS] ? 1 : 0;
  for (const e of L.inst) {
    const tab = tabOf(e.type, e.v);
    for (let p = 0; p < tab.length; p++) { const k = V1_OF.get('fx.' + e.id + '.' + tab[p].pid); if (k !== undefined && md[k]) out[8 + e.off + p] = 1; }
  }
  return out;
}
// FXT key over the Distortion instances (id and both curves), or null when a curve is malformed
function fxtKeyOf(F) {
  hashBad = false;
  let h = FNV0, nd = 0;
  walk(F, I => { if (I.type === 'dist') { const S = objOf(I.sub); h = fnvPts(fnvPts(fnvStr(h, I.id), S.xa), S.xb); nd++; } });
  return hashBad ? null : hex(fnv(h, nd));
}
const CONV_SHAPE = ['size', 'tone', 'minph', 'att', 'dec', 'damp'];

function compile2(F, ctx) {
  const xsKey = fxtKeyOf(F);
  if (xsKey === null) return null;
  const L = layoutOf(F), c = isObj(ctx) ? ctx : {}, nI = L.inst.length, NFX = 8 + L.NP, objs = [];
  walk(F, I => objs.push(I));
  const base = new Float64Array(NFX);
  base[0] = fin(c.master) ? clamp01(c.master) : 1;
  base[1] = fin(c.bypass) ? (c.bypass >= 0.5 ? 1 : 0) : 0;
  base[2] = fin(c.direct) ? clamp01(c.direct) : 0.5;
  base[3] = fin(c.bus1v) ? clamp01(c.bus1v) : 0.5;
  base[4] = fin(c.bus2v) ? clamp01(c.bus2v) : 0.5;
  const md = moddedCtx(c.modded, NFX, L), rate = fin(c.rate) && c.rate > 0 ? Math.round(c.rate) : 48000;
  // §2.5: non-Serum tracks process only racks[0] (their buses have no input). ctx.buses (0/1) says so explicitly; without
  // it a track is a Serum track when the context carries any of the five Serum gains (§4.3: "others nothing"). The
  // instances of BUS 1 / BUS 2 then compile disabled and unallocated (the rack never runs them)
  const buses = c.buses !== undefined && c.buses !== null ? bit(c.buses, 1)
    : fin(c.master) || fin(c.bypass) || fin(c.direct) || fin(c.bus1v) || fin(c.bus2v) ? 1 : 0;
  // §14.3 Q3: the Convolve tail cap travels in ctx.qr (ctx.convMax: alias)
  const qr = isObj(c.qr) ? c.qr : null, cm = qr && fin(qr.convMax) ? qr.convMax : fin(c.convMax) ? c.convMax : 10;
  const iType = new Uint8Array(nI), iVar = new Uint8Array(nI), iRack = new Uint8Array(nI), iBr = new Uint8Array(nI), iN = new Uint8Array(nI);
  const iByp = new Uint8Array(nI), iAlloc = new Uint8Array(nI), iPar = new Int16Array(nI), iOff = new Int32Array(nI), iBB = new Uint8Array(3 * nI);
  const iPh = new Float64Array(nI), iRev = new Uint8Array(nI), iCho = new Uint8Array(nI), filTypeAll = new Uint8Array(nI), iId = [], iIr = [], needs = [];
  let any = 0;
  for (let i = 0; i < nI; i++) {
    const I = objs[i], e = L.inst[i], T = typeOf(e.type), tab = tabOf(e.type, e.v), P = objOf(I.p), o = 8 + e.off, S = objOf(I.sub);
    for (let p = 0; p < tab.length; p++) { const x = P[tab[p].pid]; base[o + p] = fin(x) ? clamp01(x) : tab[p].def; }
    if (e.rack > 0 && !buses) base[o] = 0;
    const on = base[o] >= 0.5;
    if (on) any = 1;
    iType[i] = TYPE_IDX[e.type]; iVar[i] = e.v; iRack[i] = e.rack; iBr[i] = e.branch; iN[i] = e.n; iByp[i] = I.byp ? 1 : 0;
    iAlloc[i] = on || (md && md[o] && (e.rack === 0 || buses)) ? 1 : 0;
    iPar[i] = e.parent; iOff[i] = e.off;
    if (T.split) for (let b = 0; b < T.split; b++) iBB[3 * i + b] = Array.isArray(I.bb) && I.bb[b] ? 1 : 0;
    iPh[i] = fin(I.ph) ? frac(I.ph) : 0;
    iId.push(e.id);
    if (e.type === 'rev' && e.v === 1) iRev[i] = intIn(S.type, 1, 0, 1);
    if (e.type === 'cho') iCho[i] = S.mono ? 1 : 0;
    // a modulated TYPE preallocates every variant of it: FX Filter families, and (IMPL extension of §4.3) the S2 Reverb's
    // shared tank pool for all five types
    if (e.type === 'fil' || (e.type === 'rev' && e.v === 2)) { const tp = tab.findIndex(r => r.pid === 'type'); filTypeAll[i] = md && md[o + tp] ? 1 : 0; }
    let ir = '';
    if (e.type === 'conv' && typeof S.ir === 'string' && S.ir) {
      let h = FNV0;
      for (let p = 0; p < tab.length; p++) if (CONV_SHAPE.indexOf(tab[p].pid) >= 0) h = fnv(h, Math.round(base[o + p] * 256));
      ir = S.ir + '@' + rate + '~' + hex(h);
      if (needs.indexOf(ir) < 0) needs.push(ir);
    }
    iIr.push(ir);
  }
  const rByp = new Uint8Array(3), rRoute = new Uint8Array(3);
  for (let k = 0; k < 3; k++) {
    const Rk = F.racks[k];
    rByp[k] = Rk.byp ? 1 : 0;
    rRoute[k] = k === 0 ? 0 : intIn(Rk.route, 0, 0, 2);
  }
  if (rRoute[1] === 2 && rRoute[2] === 2) rRoute[2] = 0;
  return {
    ver: FXP_VER, NFX, NP: L.NP, key: L.key,
    base, nI, iType, iVar, iRack, iBr, iN, iByp, iAlloc, iPar, iOff, iBB, iPh, iId, iRev, iCho, iIr,
    rByp, rRoute, needs, filTypeAll,
    seed: c.seed ? 1 : 0, any, bpm: ctxTempo(c), smooth: ctxSmooth(c), silence: bit(c.silence, 1),
    convMax: clamp(cm, 0.1, 10),
    xsKey,
  };
}

// §4.3: FX state (v2, or v1 read as its S1 instances) → FXP v2 (patch.fxr, every model). ctx = {bpm, rate, master, bypass,
// direct, bus1v, bus2v, modded, seed, smooth, silence, qr, buses}: master / bypass / direct / bus levels are normalised
// values (Serum tracks pass s.p; others nothing ⇒ master 1, bypass 0, direct and buses n 0.5 = 0 dB); qr = the §14.3
// quality caps ({convMax: s}: FXP.convMax, the Convolve tail cap; ctx.convMax is accepted as an alias); buses = 0 for
// tracks whose BUS racks get no input (non-Serum tracks, §2.5: their bus instances compile disabled and unallocated),
// default 1 when any Serum gain is given, else 0. Never throws: a state that is not normalized is repaired first (v2:
// normalizeFx2; v1: normalizeFxV1, the Phase-1 rule).
export function compileFx(fx, ctx) {
  if (isV2(fx)) {
    if (fx2ShapeOk(fx)) {
      try { const P = compile2(fx, ctx); if (P) return P; } catch (err) { /* malformed inner value: compile the repaired copy */ }
    }
    return compile2(normalizeFx2(fx), ctx);
  }
  if (fxShapeOk(fx)) {
    try { const P = compile2(viewV1(fx), ctx); if (P) return P; } catch (err) { /* idem */ }
  }
  return compile2(viewV1(normalizeFxV1(fx)), ctx);
}

const FXT2_CACHE = new Map();
const LIN_XS = renderPts(DIAG, XS_N);
// §4.3 FXT v2 = {key, xs: [{id, xsA, xsB}] (every Distortion instance, processing order), xsA, xsB} (memoised by content).
// xsA / xsB = the first Distortion instance's tables (linear without one): the Phase-1 FXT fields, kept for the
// X-Shaper displays that read them.
export function compileFxT(fx) {
  let F = stateOf(fx), key = fxtKeyOf(F);
  if (key === null) { F = isV2(fx) ? normalizeFx2(fx) : viewV1(normalizeFxV1(fx)); key = fxtKeyOf(F); }
  return lruGet(FXT2_CACHE, key, () => {
    const xs = [];
    walk(F, I => { if (I.type === 'dist') xs.push({ id: I.id, xsA: renderPts(I.sub.xa, XS_N), xsB: renderPts(I.sub.xb, XS_N) }); });
    return { key, xs, xsA: xs.length ? xs[0].xsA : LIN_XS, xsB: xs.length ? xs[0].xsB : LIN_XS };
  });
}

/* ================================================================ §11.2 instance operations (v2 states, in place) */

// The live v2 state an in-place operation edits: a v2 state as it is (repaired in place by normalizeFx2 when it fails the
// structural check), or null for anything else (v1 states are converted by their owner first, §2.6.3)
function live(fx) {
  if (!isV2(fx)) return null;
  if (fx.v === 2 && fx2ShapeOk(fx)) return fx;
  const n = normalizeFx2(fx);
  for (const k of Object.keys(fx)) delete fx[k];
  return Object.assign(fx, n);
}
// location of instance `id`: {inst, list, index, rack, parent (the splitter instance or null), branch}, or null
function locate(F, id) {
  for (let k = 0; k < 3; k++) {
    const mods = F.racks[k].mods;
    for (let i = 0; i < mods.length; i++) {
      const I = mods[i];
      if (I.id === id) return { inst: I, list: mods, index: i, rack: k, parent: null, branch: 0 };
      if (Array.isArray(I.br)) {
        for (let b = 0; b < I.br.length; b++) {
          const B = I.br[b];
          for (let j = 0; j < B.length; j++) if (B[j].id === id) return { inst: B[j], list: B, index: j, rack: k, parent: I, branch: b };
        }
      }
    }
  }
  return null;
}
// destination {rack, splitter, branch} → the instance list, or null (a splitter is addressed by id, in any rack)
function whereOf(o) {
  const w = objOf(o);
  return { rack: intIn(w.rack, 0, 0, 2), splitter: typeof w.splitter === 'string' && w.splitter ? w.splitter : null,
    branch: fin(w.branch) ? Math.round(w.branch) : 0, at: w.at };
}
function listAt(F, w) {
  if (!w.splitter) return F.racks[w.rack].mods;
  const L = locate(F, w.splitter), T = L ? typeOf(L.inst.type) : null;
  if (!L || L.parent || !T || !T.split || !(w.branch >= 0 && w.branch < T.split)) return null;
  return L.inst.br[w.branch];
}
const countInst = F => walk(F, () => {});
const subCount = I => (Array.isArray(I.br) ? I.br.reduce((a, B) => a + arrOf(B).length, 0) : 0);
const atIn = (at, n) => (fin(at) ? clamp(Math.round(at), 0, n) : n);
const cloneJ = x => JSON.parse(JSON.stringify(x));
// new instance id (§2.5): the type id if unused in the track (and not in `taken`), else <type><k> with the lowest k ≥ 2
function freshId(F, type, taken) {
  const used = new Set(taken || []);
  walk(F, I => used.add(I.id));
  let id = type;
  for (let k = 2; used.has(id); k++) id = type + k;
  return id;
}
// parameter values of a (type, variant) table from raw n values (missing / invalid ⇒ the row default; stepped laws snapped)
function normP(type, v, raw) {
  const P = objOf(raw), p = {};
  for (const r of tabOf(type, v)) p[r.pid] = fin(P[r.pid]) ? snapL(r.law, r.lo, r.hi, clamp(P[r.pid], 0, 1)) + 0 : r.def;
  return p;
}
// a fresh instance of type T, variant v (table defaults; splitters with empty branches)
function makeInst(id, T, v) {
  const I = { id, type: T.id, v, byp: 0, p: normP(T.id, v, null), sub: normSub(T.id, v, null), ph: 0 };
  if (T.split) { I.br = []; I.bb = []; for (let b = 0; b < T.split; b++) { I.br.push([]); I.bb.push(0); } }
  I.ui = { lvl: 0, lvl2: 0 };
  return I;
}
// {v, p, sub} of a module preset payload for an instance of `type` (null when it is not for that type): the payload's
// variant (an S1 payload for a type with an S2 variant is upgraded when `want` = 2)
function payloadPS(type, payload, want) {
  const P = objOf(payload), T = typeOf(type);
  if (!T || P.ftype !== type) return null;
  const fv = T.variants.indexOf(P.fv) >= 0 ? P.fv : T.variants[T.variants.length - 1];
  let x = { id: type, type, v: fv, byp: 0, p: normP(type, fv, P.p), sub: normSub(type, fv, P.sub), ph: 0 };
  if (want === 2 && fv === 1 && T.variants.indexOf(2) >= 0) x = upgradeInstance(x);
  return { v: x.v, p: x.p, sub: x.sub };
}

// §11.2 newInstance: a new instance of `type` at {rack, splitter, branch, at} (at = index in the destination list, default
// the end) with the highest variant and its table defaults, or the default module preset payload `preset` (its p and
// sub, variant 2 where the type has one; the new instance is enabled, §3.16.2 "on default 1 for instances created in
// v2", also for the S1-only types Hyper and Flanger). In place; → the new id, or null (unknown type, v1 state, caps: 16
// per rack,
// 8 per branch, 48 per track; a splitter inside a branch; unknown splitter / branch)
export function newInstance(fx, type, opts) {
  const F = live(fx), T = typeOf(type);
  if (!F || !T) return null;
  const o = objOf(opts), w = whereOf(o);
  if (w.splitter && T.split) return null;
  const list = listAt(F, w);
  if (!list || list.length >= (w.splitter ? MAX_BR : MAX_TOP) || countInst(F) >= MAX_INST) return null;
  const v = T.variants[T.variants.length - 1], I = makeInst(freshId(F, T.id), T, v), pre = o.preset ? payloadPS(T.id, o.preset, v) : null;
  if (pre && pre.v === v) { I.p = pre.p; I.sub = pre.sub; }
  I.p.on = 1;                                          // created in v2: enabled (also Hyper / Flanger; a preset never sets it)
  list.splice(atIn(o.at, list.length), 0, I);
  return I.id;
}

// ---- the Serum-state side of instance operations: matrix rows, locked controls and the MIDI map addressing fx.<id>.*
// (v1 Dimension ids fx.dim.* belong to instance `hyper`)
const EMPTY_ROW1 = { src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
const EMPTY_ROW2 = Object.assign({}, EMPTY_ROW1, { acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
const emptyRowFor = M => Object.assign({}, M.length > 32 ? EMPTY_ROW2 : EMPTY_ROW1);
const refInst = id => { const m = typeof id === 'string' ? REF_RE.exec(id) : null; return m ? (m[1] === 'dim' ? 'hyper' : m[1]) : null; };
// in place: rows / locks / MIDI entries of `s` addressing an instance in `ids` (Set) are removed → rows cleared
function dropRefs(s, ids) {
  if (!isObj(s) || !ids.size) return 0;
  let n = 0;
  if (Array.isArray(s.matrix)) {
    const M = s.matrix;
    for (let r = 0; r < M.length; r++) if (isObj(M[r]) && ids.has(refInst(M[r].dst))) { M[r] = emptyRowFor(M); n++; }
  }
  if (isObj(s.locks)) for (const k of ['p', 'unp']) if (Array.isArray(s.locks[k])) s.locks[k] = s.locks[k].filter(x => !ids.has(refInst(x)));
  if (isObj(s.midi)) for (const k of Object.keys(s.midi)) if (ids.has(refInst(s.midi[k]))) delete s.midi[k];
  return n;
}
// fx.<old>.<pid> (fx.dim.* for hyper) → fx.<new>.<pid>
function reId(id, from, to) {
  if (refInst(id) !== from) return id;
  const r = renamed(id);
  return 'fx.' + to + r.slice(r.indexOf('.', 3));
}
// in place: active rows of `s` addressing an instance in `map` (old id → new id) are copied onto the new ids into the
// free matrix slots (no source and no destination), in row order while slots remain → rows copied
function copyRefs(s, map) {
  if (!isObj(s) || !Array.isArray(s.matrix)) return 0;
  const M = s.matrix, add = [];
  for (const r of M) {
    const from = isObj(r) && r.src ? refInst(r.dst) : null;
    if (from !== null && own(map, from)) add.push(Object.assign(cloneJ(r), { dst: reId(r.dst, from, map[from]) }));
  }
  let n = 0;
  for (const r of add) {
    const slot = M.findIndex(x => !isObj(x) || (!x.src && !x.dst));
    if (slot < 0) break;
    M[slot] = r; n++;
  }
  return n;
}
// ids of an instance and its branch instances
function idsOf(I) {
  const out = new Set([I.id]);
  if (Array.isArray(I.br)) for (const B of I.br) for (const c of arrOf(B)) out.add(c.id);
  return out;
}

// §11.2 removeInstance: removes instance `id` (a splitter with its branches); with a Serum state `s` also the matrix rows,
// locked controls and MIDI assignments addressing it (in place). → true when removed
export function removeInstance(fx, id, s) {
  const F = live(fx), L = F ? locate(F, id) : null;
  if (!L) return false;
  L.list.splice(L.index, 1);
  const gone = idsOf(L.inst);
  if (isObj(F.ui)) {
    if (gone.has(F.ui.sel)) F.ui.sel = '';
    if (isObj(F.ui.br)) for (const x of gone) delete F.ui.br[x];
  }
  dropRefs(s, gone);
  return true;
}

// §11.2 moveInstance: moves instance `id` to {rack, splitter, branch, at} (at = its final index in the destination list,
// default the end); a splitter never enters a branch. → true when moved
export function moveInstance(fx, id, to) {
  const F = live(fx), L = F ? locate(F, id) : null;
  if (!L) return false;
  const w = whereOf(to);
  if (w.splitter && (typeOf(L.inst.type).split || w.splitter === id)) return false;
  const dst = listAt(F, w);
  if (!dst || (dst !== L.list && dst.length >= (w.splitter ? MAX_BR : MAX_TOP))) return false;
  L.list.splice(L.index, 1);
  dst.splice(atIn(w.at, dst.length), 0, L.inst);
  return true;
}

// §11.2 duplicateInstance: a copy of instance `id` (new ids for it and its branch instances) right after it, or at
// opts.to; opts.mods with a Serum state `s` also copies the active rows addressing it onto the copy (free slots). → the
// new id, or null (caps)
export function duplicateInstance(fx, id, s, opts) {
  const F = live(fx), L = F ? locate(F, id) : null;
  if (!L) return null;
  const o = objOf(opts), T = typeOf(L.inst.type);
  if (countInst(F) + 1 + subCount(L.inst) > MAX_INST) return null;
  const w = o.to ? whereOf(o.to) : null;
  if (w && w.splitter && T.split) return null;
  const dst = w ? listAt(F, w) : L.list;
  if (!dst || dst.length >= (dst === L.list ? (L.parent ? MAX_BR : MAX_TOP) : w.splitter ? MAX_BR : MAX_TOP)) return null;
  const C = cloneJ(L.inst), taken = [], map = {};
  const re = x => { const n = freshId(F, x.type, taken); taken.push(n); map[x.id] = n; x.id = n; };
  re(C);
  if (Array.isArray(C.br)) for (const B of C.br) for (const c of B) re(c);
  if (T.split && isObj(F.ui) && isObj(F.ui.br) && own(F.ui.br, id)) F.ui.br[C.id] = F.ui.br[id];
  dst.splice(w ? atIn(w.at, dst.length) : L.index + 1, 0, C);
  if (o.mods) copyRefs(s, map);
  return C.id;
}

// ---- rack presets and the rack clipboard ({type: 'synth.fxrack', v: 1, name, rack}, §2.5)
// §11.2 rackPresetPayload: rack k as a rack preset (instances copied; byp / route kept, lock cleared), or null
export function rackPresetPayload(fx, k, name) {
  const F = stateOf(fx), R = F.racks[intIn(k, 0, 0, 2)];
  return { type: 'synth.fxrack', v: 1, name: typeof name === 'string' ? name : '', rack: { mods: cloneJ(R.mods), byp: R.byp ? 1 : 0, lock: 0, route: R.route | 0 } };
}
// §11.2 applyRackPreset: rack k's instances ← the payload's (normalised; the track caps apply, instances beyond them are
// dropped); the rack's bypass, lock and routing stay. Every incoming instance gets an id by the new-instance rule (§2.5:
// the type id, else <type><k>) among the ids not used by the other racks nor by the instances it replaces, so a matrix
// row, lock or MIDI entry still addressing a replaced instance never binds to a newcomer; with a Serum state `s` those
// rows / locks / MIDI entries are removed. In place → true
export function applyRackPreset(fx, k, payload, s) {
  const F = live(fx), P = objOf(payload), R = objOf(P.rack);
  if (!F || !Array.isArray(R.mods)) return false;
  const kk = intIn(k, 0, 0, 2), taken = new Set(), gone = new Set();
  walk(F, (I, rk) => { taken.add(I.id); if (rk === kk) gone.add(I.id); });
  // normalise the incoming instances on their own (ids unique among themselves, caps, splitter rules)
  const inc = normalizeFx2({ v: 2, racks: [{ mods: R.mods }, emptyRack(), emptyRack()] }).racks[0].mods;
  let n = countInst(F) - F.racks[kk].mods.reduce((a, I) => a + 1 + subCount(I), 0);
  const out = [];
  const fix = I => {
    let id = I.type;
    for (let j = 2; taken.has(id); j++) id = I.type + j;
    taken.add(id); I.id = id;
  };
  for (const I of inc) {
    const add = 1 + subCount(I);
    if (n + add > MAX_INST) break;
    n += add;
    fix(I);
    if (Array.isArray(I.br)) for (const B of I.br) for (const c of B) fix(c);
    out.push(I);
  }
  F.racks[kk].mods = out;
  if (isObj(F.ui)) {
    if (F.ui.sel && !locate(F, F.ui.sel)) F.ui.sel = '';
    if (isObj(F.ui.br)) for (const x of gone) delete F.ui.br[x];
  }
  dropRefs(s, gone);
  return true;
}
// §11.2 rack clipboard: copyRack → payload (or null); clearRack removes every instance of rack k (and, with a Serum state
// `s`, the rows / locks / MIDI addressing them); cutRack = copy + clear; pasteRack = applyRackPreset (new ids, §2.5;
// with `s` the replaced instances' rows / locks / MIDI entries are removed)
export function copyRack(fx, k) { return isObj(fx) ? rackPresetPayload(fx, k, '') : null; }
export function clearRack(fx, k, s) {
  const F = live(fx);
  if (!F) return false;
  const R = F.racks[intIn(k, 0, 0, 2)], gone = new Set();
  for (const I of R.mods) for (const x of idsOf(I)) gone.add(x);
  R.mods = [];
  if (isObj(F.ui)) {
    if (gone.has(F.ui.sel)) F.ui.sel = '';
    if (isObj(F.ui.br)) for (const x of gone) delete F.ui.br[x];
  }
  dropRefs(s, gone);
  return true;
}
export function cutRack(fx, k, s) {
  if (!live(fx)) return null;
  const c = copyRack(fx, k);
  clearRack(fx, k, s);
  return c;
}
export function pasteRack(fx, k, clip, s) { return applyRackPreset(fx, k, clip, s); }

// §11.2 upgradeInstance: S1 → S2 variant (a new instance object; null when `inst` is not an S1 instance of a type with an
// S2 variant). Same pids keep n (enums re-gridded by value: Distortion mode 0–15 → 0–17, Filter type 0–95 → 0–107);
// Phase-1-equivalent values for the new pids where S2 can reproduce S1 (Phaser poles 6 and DEPTH 2 0, Delay HQ off,
// Compressor BELOW = RATIO and band gains 0 dB with the Phase-1 crossovers, Chorus HPF off, EQ / level 0 dB, Key Track /
// Clean off); Reverb (approximate: the S2 laws differ): Plate t → PRE-DELAY 200·t ms, c → DAMP, w → WIDTH; Hall t →
// DECAY, c → SPIN RATE, w → SPIN DEPTH; type Plate / Hall from sub.type
export function upgradeInstance(inst) {
  const I = objOf(inst), T = typeOf(I.type);
  if (!T || I.v !== 1 || T.variants.indexOf(2) < 0) return null;
  const t1 = tabOf(T.id, 1), t2 = tabOf(T.id, 2), P = objOf(I.p), p = {};
  const row1 = pid => t1.find(r => r.pid === pid) || null;
  const old = pid => { const r = row1(pid), x = P[pid]; return fin(x) ? clamp01(x) : r ? r.def : 0; };
  for (const r of t2) {
    const r1 = row1(r.pid);
    if (!r1) { p[r.pid] = r.def; continue; }
    let n = old(r.pid);
    if (r.law === 'enum' && r1.law === 'enum' && r.hi - r.lo !== r1.hi - r1.lo) n = clamp(Math.round(n * (r1.hi - r1.lo)) + r1.lo - r.lo, 0, r.hi - r.lo) / (r.hi - r.lo);
    p[r.pid] = snapL(r.law, r.lo, r.hi, n) + 0;
  }
  const S = objOf(I.sub);
  let sub = normSub(T.id, 2, S);
  switch (T.id) {
    case 'phs': p.poles = 5 / 17; p.depth2 = 0; break;
    case 'dly': p.hq = 0; break;
    case 'cmp': p.below = old('ratio'); p.gL = p.gM = p.gH = 0.5; break;
    case 'rev': {
      const plate = intIn(S.type, 1, 0, 1) === 0, row = t2.find(r => r.pid === 'pre');
      p.type = plate ? 0 : 1 / 4;
      if (plate) { p.pre = lawNormL(row.law, row.lo, row.hi, 200 * old('t'), row.def); p.damp = old('c'); p.width = old('w'); }
      else { p.decay = old('t'); p.spinr = old('c'); p.spind = old('w'); }
      sub = {};
      break;
    }
    default: break;
  }
  const U = objOf(I.ui);
  return { id: I.id, type: T.id, v: 2, byp: bit(I.byp, 0), p, sub, ph: fin(I.ph) ? frac(I.ph) + 0 : 0, ui: { lvl: bit(U.lvl, 0), lvl2: bit(U.lvl2, 0) } };
}

// ---- module presets ({type: 'synth.fxmod', v: 2, name, ftype, fv, p, sub}, §2.5). A module preset never carries or sets
// the enable (`on`): loading one changes the sound of the module, not whether it runs (the rack UI's rule, fx-ui)
const noOn = p => { const o = Object.assign({}, p); delete o.on; return o; };
// §11.2 modulePresetPayload: instance `id` of an FX state (v2, or v1 read as its S1 instances) as a module preset, or null
export function modulePresetPayload(fx, id, name) {
  const F = stateOf(fx), L = locate(F, id);
  if (!L) return null;
  const I = L.inst;
  return { type: 'synth.fxmod', v: 2, name: typeof name === 'string' ? name : '', ftype: I.type, fv: I.v, p: noOn(normP(I.type, I.v, I.p)),
    sub: cloneJ(normSub(I.type, I.v, I.sub)) };
}
// §11.2 applyModulePreset: the payload's parameters and sub-state onto instance `id` (same type only; an S1 instance
// receiving an S2 payload is upgraded first, an S1 payload for an S2 instance is upgraded); parameters whose
// destination id is in `lockedIds` (fx.<id>.<pid>) and the enable keep their values. In place → true when applied
export function applyModulePreset(fx, id, payload, lockedIds) {
  const F = live(fx), L = F ? locate(F, id) : null;
  if (!L) return false;
  let I = L.inst;
  const P = objOf(payload), T = typeOf(I.type);
  if (P.ftype !== I.type) return false;
  const fv = T.variants.indexOf(P.fv) >= 0 ? P.fv : T.variants[T.variants.length - 1];
  if (I.v === 1 && fv === 2) {
    const U = upgradeInstance(I);
    for (const k of Object.keys(I)) delete I[k];
    I = Object.assign(I, U);
  }
  const src = payloadPS(I.type, P, I.v);
  if (!src || src.v !== I.v) return false;
  const keep = new Set();
  for (const x of arrOf(lockedIds)) if (refInst(x) === I.id) { const r = renamed(x); keep.add(r.slice(r.lastIndexOf('.') + 1)); }
  for (const r of tabOf(I.type, I.v)) if (r.pid !== 'on' && !keep.has(r.pid)) I.p[r.pid] = src.p[r.pid];
  I.sub = cloneJ(src.sub);
  return true;
}

// ---- effect chains (synth.fxchains v2: {type, v: 2, chains: [{name, fx}]}, fx = a v2 state without ui, racks unlocked)
function chainFx(fx) {
  const c = isV2(fx) ? normalizeFx2(fx) : migrateFx1(fx);
  delete c.ui;
  for (const R of c.racks) R.lock = 0;
  return c;
}
// The state to load for factory chain `c` of FACTORY_CHAINS2: a Phase-1 factory chain as its v1 state (FACTORY_CHAINS_V1,
// by name). The chain loaders (serum-ui, fx-ui) migrate a v1 chain — this one, or a v1 library entry written by an older
// version — with the track's Serum state as refs (normalizeFx(fx, s), §2.6.3): the modules the track's rows, locks and
// MIDI map address are kept, as Phase 1 kept every module (without refs pristine disabled modules are dropped, and with
// them the user's locks, rows and MIDI maps). A Serum 2 chain is returned as it is
export function factoryChainFx(c) {
  if (!isObj(c)) return null;
  for (const v of FACTORY_CHAINS_V1.chains) if (v.name === c.name) return v.fx;
  return isObj(c.fx) ? c.fx : null;
}
// §11.2 migrateChains1: a chain library (v1 or v2 object, or a bare array of {name, fx}) → v2 library (v1 chains migrate,
// entries without a name or an fx object are dropped)
export function migrateChains1(lib) {
  const L = Array.isArray(lib) ? lib : arrOf(objOf(lib).chains), chains = [];
  for (const c of L) if (isObj(c) && typeof c.name === 'string' && c.name && isObj(c.fx)) chains.push({ name: c.name, fx: chainFx(c.fx) });
  return { type: 'synth.fxchains', v: 2, chains };
}

// ---- §11.2 applyPresetFx v2 (preset load). Racks with lock = 1 are kept from curFx (instances, ids, values); the others
// come from presetFx (default when absent; a v1 preset migrates with `s` as refs — without a Serum state, the Phase-1
// call form, every v1 module is kept, as the keep / drop rule needs the rows); incoming instances are admitted in rack
// order while the track stays within MAX_INST (48, §2.7: the rest of the incoming side is dropped, never the locked
// side); incoming instances whose ids collide with kept ones are renamed. The rows of `s` (the new Serum state from
// applyPreset) are rewritten in place: without Lock Matrix they are the preset's and follow renamed instances, rows
// addressing ids of the locked racks (no incoming instance) are dropped; with Lock Matrix (`'matrix'` in s.locks.mod)
// they are the current rows: rows addressing instances of a locked rack are dropped (S2 clears modulation to a locked
// bus), the others keep their ids. MIDI entries follow renamed instances. Locked dynamic ids (s.locks.p, or `s` itself
// when it is an id array — the Phase-1 call form) keep the current value when the result has an instance of the same
// id and type: same variant ⇒ the value as it is; S1 ↔ S2 variants ⇒ for a row of the same law and range in both
// tables (enums of another range re-gridded by value, skipped when the value has no counterpart). ui and the lock flags
// from curFx. Never mutates curFx / presetFx; `s` is rewritten in place.
export function applyPresetFx2(curFx, presetFx, s) {
  const rows = isObj(s) ? s : null, locked = Array.isArray(s) ? s : rows && isObj(rows.locks) ? arrOf(rows.locks.p) : [];
  const c = normalizeFx2(curFx, rows || undefined);
  const P = presetFx === undefined || presetFx === null ? defaultFx2() : presetFx;
  const r = !isObj(P) || isV2(P) || rows ? normalizeFx2(P, rows || undefined) : normalizeFx2(viewV1(fxShapeOk(P) ? P : normalizeFxV1(P)));
  const keptIds = new Set();
  let total = 0;
  for (let k = 0; k < 3; k++) if (c.racks[k].lock) for (const I of c.racks[k].mods) { total += 1 + subCount(I); for (const x of idsOf(I)) keptIds.add(x); }
  const out = { v: 2, racks: [], ui: c.ui };
  const taken = new Set(keptIds), map = {}, inIds = new Set();
  walk(r, I => inIds.add(I.id));
  for (let k = 0; k < 3; k++) {
    if (c.racks[k].lock) { out.racks.push(c.racks[k]); continue; }
    const R = r.racks[k], mods = [];
    for (const I of R.mods) {
      const add = 1 + subCount(I);
      if (total + add > MAX_INST) continue;
      total += add;
      for (const J of [I].concat(Array.isArray(I.br) ? [].concat(...I.br) : [])) {
        if (keptIds.has(J.id)) {
          let id = J.type;
          for (let j = 2; taken.has(id) || inIds.has(id); j++) id = J.type + j;
          map[J.id] = id; J.id = id;
        }
        taken.add(J.id);
      }
      mods.push(I);
    }
    out.racks.push({ mods, byp: R.byp, lock: 0, route: R.route });
  }
  if (out.racks[1].route === 2 && out.racks[2].route === 2) out.racks[2].route = 0;
  if (out.ui && out.ui.sel && !locate(out, out.ui.sel)) out.ui.sel = '';
  if (rows) {
    const lockMx = isObj(rows.locks) && arrOf(rows.locks.mod).indexOf('matrix') >= 0;
    const drop = lockMx ? keptIds : new Set([...keptIds].filter(x => !own(map, x)));
    if (Array.isArray(rows.matrix)) {
      const M = rows.matrix;
      for (let i = 0; i < M.length; i++) {
        const w = M[i], from = isObj(w) ? refInst(w.dst) : null;
        if (from === null) continue;
        if (!lockMx && own(map, from)) M[i] = Object.assign({}, w, { dst: reId(w.dst, from, map[from]) });
        else if (drop.has(from)) M[i] = emptyRowFor(M);
      }
    }
    if (isObj(rows.midi)) {
      for (const k of Object.keys(rows.midi)) {
        const from = refInst(rows.midi[k]);
        if (from !== null && own(map, from)) rows.midi[k] = reId(rows.midi[k], from, map[from]);
      }
    }
  }
  for (const x of locked) {
    const d = fxDest(x, c), e = fxDest(x, out);
    if (!d || !e || d.inst === e.inst || d.type !== e.type) continue;
    const n = lockedN(d.row, e.row, d.inst.p[d.pid]);
    if (n !== null) e.inst.p[e.pid] = n;
  }
  return out;
}
// the n a locked control carries from row a (value n) to row b of the same pid (S1 / S2 variants of a type): the same n
// for the same law and range; enums of another range by value (Distortion mode 0–15 → 0–17, Filter type 0–95 → 0–107,
// and back when the value exists there); null when the row has no counterpart
function lockedN(a, b, n) {
  if (!fin(n) || a.law !== b.law) return null;
  if (a.lo === b.lo && a.hi === b.hi) return n;
  if (a.law !== 'enum') return null;
  const v = Math.round(clamp01(n) * (a.hi - a.lo)) + a.lo;
  return v >= b.lo && v <= b.hi ? (v - b.lo) / (b.hi - b.lo) : null;
}

/* ================================================================ factory content (original) */

// an instance of `type` (variant v, default the highest) from engine values {pid: value} (laws.js lawNorm per row; {n}
// sets n directly, e.g. a BPM-ladder position)
function fxI(type, vals, o) {
  const T = typeOf(type), opt = objOf(o), v = opt.v || T.variants[T.variants.length - 1], tab = tabOf(type, v), p = normP(type, v, null);
  for (const pid of Object.keys(vals || {})) {
    const r = tab.find(x => x.pid === pid);
    if (!r) throw new Error('fx-core factory: ' + type + ' has no ' + pid);
    const x = vals[pid];
    p[pid] = snapL(r.law, r.lo, r.hi, isObj(x) ? clamp01(x.n) : lawNormL(r.law, r.lo, r.hi, x, r.def)) + 0;
  }
  const I = makeInst(opt.id || type, T, v);
  I.p = p;
  if (opt.sub) I.sub = normSub(type, v, opt.sub);
  if (opt.br) I.br = opt.br.map(B => B.slice());
  return I;
}
const fxState = (racks, route) => normalizeFx2({ v: 2, racks: racks.map((mods, k) => ({ mods, route: route ? route[k] : 0 })) });
const modPreset = (name, I) => ({ type: 'synth.fxmod', v: 2, name, ftype: I.type, fv: I.v, p: noOn(I.p), sub: I.sub });

// §11.2 FACTORY_FX_PRESETS: module presets per type (original settings)
export const FACTORY_FX_PRESETS = deepFreeze(((L) => {
  const out = {};
  for (const [name, I] of L) (out[I.type] || (out[I.type] = [])).push(modPreset(name, I));
  return out;
})([
  ['Warm Tube', fxI('dist', { mode: 0, drive: 0.35, mix: 0.7, filt: 2, freq: 6000, q: 0.7 })],
  ['Overdrive Stack', fxI('dist', { mode: 16, drive: 0.45, stages: 6, mix: 1 })],
  ['Soft Saturation', fxI('dist', { mode: 17, drive: 0.3, mix: 1 })],
  ['Fold Crunch', fxI('dist', { mode: 6, drive: 0.4, mix: 0.6, kt: 1, filt: 1, lbh: 0.5, freq: 1200, q: 1.2 })],
  ['Slow Sweep', fxI('flg', { rate: 0.15, depth: 0.8, feed: 0.6, mix: 0.5 })],
  ['Metallic Comb', fxI('flg', { rate: 0.04, depth: 0.2, feed: 0.85, mix: 0.6 })],
  ['Stereo Jet', fxI('flg', { rate: 0.3, depth: 1, feed: 0.7, phase: 180, mix: 0.55 })],
  ['Twelve Pole', fxI('phs', { rate: 0.25, depth: 0.6, freq: 800, feed: 0.5, poles: 12, depth2: 0.4, mix: 0.7 })],
  ['Classic Six', fxI('phs', { rate: 0.4, depth: 0.5, freq: 600, feed: 0.7, poles: 6, mix: 0.6 })],
  ['Wide Notches', fxI('phs', { rate: 0.1, depth: 0.8, freq: 1200, feed: 0.3, phase: 90, poles: 4, depth2: 0.7, mix: 0.6 })],
  ['Ensemble', fxI('cho', { rate: 0.6, dly1: 6, dly2: 11, depth: 3, feed: 0.1, lpf: 9000, mix: 0.45 })],
  ['Airy Chorus', fxI('cho', { rate: 0.3, dly1: 4, dly2: 9, depth: 2, feed: 0.05, lpf: 1500, hp: 1, mix: 0.4 })],
  ['Slow Doubler', fxI('cho', { rate: 0.15, dly1: 12, dly2: 18, depth: 1.5, feed: 0, lpf: 12000, mix: 0.35 })],
  ['Quarter Echo', fxI('dly', { bpm: 1, timeL: { n: 7 / 11 }, timeR: { n: 7 / 11 }, feed: 0.45, mix: 0.3 })],
  ['Ping Pong Eighths', fxI('dly', { bpm: 1, mode: 1, timeL: { n: 6 / 11 }, timeR: { n: 6 / 11 }, feed: 0.5, mix: 0.3, freq: 2000, q: 2 })],
  ['Slapback', fxI('dly', { bpm: 0, timeL: 90, timeR: 110, feed: 0.15, mix: 0.25 })],
  ['Glue', fxI('cmp', { thr: Math.pow(10, -18 / 20), ratio: 2, att: 10, rel: 150, gain: Math.pow(10, 3 / 20), mix: 1 })],
  ['Three Band Lift', fxI('cmp', { mb: 1, thr: Math.pow(10, -20 / 20), ratio: 4, below: 2, att: 3, rel: 80, gL: 2, gM: 0, gH: 1.5, mix: 0.7 })],
  ['Punch', fxI('cmp', { thr: Math.pow(10, -15 / 20), ratio: 4, att: 20, rel: 80, gain: Math.pow(10, 4 / 20), mix: 0.8 })],
  ['Bright Plate', fxI('rev', { type: 0, size: 0.45, pre: 15, damp: 0.25, width: 1, hicut: 0.15, mix: 0.25 })],
  ['Big Hall', fxI('rev', { type: 1, size: 0.8, decay: 0.45, spinr: 0.3, spind: 0.3, locut: 0.2, mix: 0.3 })],
  ['Vintage Room', fxI('rev', { type: 2, size: 0.35, ersize: 0.6, decay: 0.25, damp: 0.5, mix: 0.25 })],
  ['Nitrous Marble', fxI('rev', { type: 3, nmode: 1, size: 0.5, feed: 0.75, diff: 0.8, mix: 0.3 })],
  ['Basin Swell', fxI('rev', { type: 4, size: 0.7, feed: 0.85, chd: 0.4, hicut: 0.4, mix: 0.35 })],
  ['Smile', fxI('eq', { typeL: 0, freqL: 120, gainL: 4, typeH: 0, freqH: 8000, gainH: 3 })],
  ['Telephone Band', fxI('eq', { typeL: 2, freqL: 400, typeH: 2, freqH: 3200, level: 1.4 })],
  ['Low Cut 80 Hz', fxI('eq', { typeL: 2, freqL: 80, typeH: 0, freqH: 12000, gainH: 0 })],
  ['Dark Low Pass', fxI('fil', { type: 1, cutoff: 1200, res: 0.2, mix: 1 })],
  ['Tracking Band', fxI('fil', { type: 12, cutoff: 900, res: 0.5, kt: 1, mix: 1 })],
  ['Resonant High Pass', fxI('fil', { type: 9, cutoff: 300, res: 0.5, mix: 1 })],
  ['Wide Unison', fxI('hyper', { unison: 5, detune: 0.35, rate: 0.4, mix: 0.4, dsize: 0.6, dmix: 0.3 })],
  ['Dimension Only', fxI('hyper', { mix: 0, dsize: 0.7, dmix: 0.5 })],
  ['Subtle Thickener', fxI('hyper', { unison: 3, detune: 0.15, rate: 0.2, mix: 0.25 })],
  ['Upshift 50 Hz', fxI('bode', { shift: 0.5, range: 100, mix: 0.5 })],
  ['Barber Pole', fxI('bode', { shift: 0.02, range: 100, delay: 120, feed: 0.7, mix: 0.6 })],
  ['Blurred Spiral', fxI('bode', { shift: -0.15, range: 20, delay: 250, feed: 0.6, blur: 0.6, bal: 0, mix: 0.5 })],
  ['Chamber Space', fxI('conv', { mix: 0.3 }, { sub: { ir: 'fir:Medium/Chamber' } })],
  ['Cab Sim', fxI('conv', { mix: 1, irgain: -12 }, { sub: { ir: 'fir:Cab/4x12 Vintage' } })],
  ['Small Room Wet', fxI('conv', { mix: 0.6 }, { sub: { ir: 'fir:Short/Small Room' } })],
  ['Endless Plate', fxI('conv', { mix: 0.35, tone: 0.2 }, { sub: { ir: 'fir:Massive/Endless Plate' } })],
  ['Mono Bass', fxI('util', { mbass: 1, mfreq: 120 })],
  ['Extra Wide', fxI('util', { width: 1.6 })],
  ['Clean Up', fxI('util', { hpf: 30, lpf: 16000 })],
  ['Low / High at 250 Hz', fxI('split2', { freq: 250 })],
  ['Bass Split 120 Hz', fxI('split2', { freq: 120 })],
  ['Presence Split 2 kHz', fxI('split2', { freq: 2000 })],
  ['Three Bands', fxI('split3', { freq1: 180, freq2: 3000 })],
  ['Bass / Mid / Air', fxI('split3', { freq1: 120, freq2: 5000 })],
  ['Low Mids', fxI('split3', { freq1: 100, freq2: 800 })],
  ['Mid / Side', fxI('splitms', {})],
  ['Mid / Side −6 dB', fxI('splitms', { level: 0.5 })],
  ['Mid / Side +3 dB', fxI('splitms', { level: Math.pow(10, 3 / 20) })],
]));

// §11.2 FACTORY_RACKS: rack presets (original), [{type: 'synth.fxrack', v: 1, name, rack}]
const rackP = (name, mods) => ({ type: 'synth.fxrack', v: 1, name, rack: { mods: fxState([mods]).racks[0].mods, byp: 0, lock: 0, route: 0 } });
// (§10.10: Main — Shimmer Hall, Parallel Crush; Bus — Send Plate, Send Delay; then extras). Mono-summing modules
// (the reverbs, Bode with MONO INPUT) are never placed in an M/S splitter's side branch: it receives (s, −s), whose mono
// sum is 0
export const FACTORY_RACKS = deepFreeze([
  rackP('Shimmer Hall', [fxI('rev', { type: 1, size: 0.8, decay: 0.55, spinr: 0.3, spind: 0.35, locut: 0.15, mix: 0.35 }),
    fxI('bode', { shift: 0.12, range: 100, delay: 160, feed: 0.5, bal: 1, blur: 0.3, mix: 0.3 })]),
  rackP('Parallel Crush', [fxI('split2', { freq: 900 }, { br: [[], [fxI('dist', { mode: 2, drive: 0.55, mix: 1 }), fxI('eq', { typeL: 2, freqL: 1200, typeH: 0, freqH: 9000, gainH: -3 })]] })]),
  rackP('Send Plate', [fxI('eq', { typeL: 2, freqL: 200, typeH: 2, freqH: 9000 }), fxI('rev', { type: 0, size: 0.5, pre: 20, mix: 1 })]),
  rackP('Send Delay', [fxI('dly', { bpm: 1, mode: 1, timeL: { n: 6 / 11 }, timeR: { n: 7 / 11 }, feed: 0.45, mix: 1, freq: 1800, q: 2 })]),
  rackP('Bus Hall', [fxI('rev', { type: 1, size: 0.75, decay: 0.4, mix: 1, locut: 0.25 })]),
  rackP('Echo Throw', [fxI('dly', { bpm: 1, mode: 1, timeL: { n: 7 / 11 }, timeR: { n: 7 / 11 }, feed: 0.55, mix: 1, freq: 1500, q: 2.5 }), fxI('rev', { type: 3, size: 0.5, mix: 0.3 })]),
  rackP('Band Split Drive', [fxI('split3', { freq1: 150, freq2: 2500 }, { br: [[], [fxI('dist', { mode: 17, drive: 0.5 })], [fxI('cho', { mix: 0.5 })]] })]),
  rackP('Mid / Side Width', [fxI('splitms', {}, { br: [[fxI('cmp', { thr: 0.3, ratio: 2 })], [fxI('util', { width: 1.5 }), fxI('eq', { typeL: 2, freqL: 150, typeH: 0, freqH: 8000, gainH: 2 })]] })]),
]);

// §11.2 FACTORY_CHAINS v2 (exported as FACTORY_CHAINS2 during the transition, see the header): the Phase-1 chains migrated,
// then chains with the Serum 2 modules — MAIN rack only: chains are offered to every model, and non-Serum tracks process
// only racks[0] (§2.5)
export const FACTORY_CHAINS2 = deepFreeze({ type: 'synth.fxchains', v: 2, chains: migrateChains1(FACTORY_CHAINS_V1).chains.concat([
  { name: 'Bode Shimmer', fx: chainFx(fxState([[fxI('bode', { shift: 0.12, range: 100, delay: 180, feed: 0.55, blur: 0.4, mix: 0.4 }),
    fxI('rev', { type: 4, size: 0.6, feed: 0.8, mix: 0.3 })]])) },
  { name: 'Vintage Space', fx: chainFx(fxState([[fxI('cmp', { thr: 0.25, ratio: 2, att: 8, rel: 120 }),
    fxI('rev', { type: 2, size: 0.6, decay: 0.5, mix: 0.3 })]])) },
  { name: 'Split Saturation', fx: chainFx(fxState([[fxI('split2', { freq: 200 }, { br: [[fxI('util', { mbass: 1, mfreq: 200 })],
    [fxI('dist', { mode: 17, drive: 0.4 }), fxI('cho', { mix: 0.35 })]] }), fxI('eq', { typeH: 0, freqH: 9000, gainH: 2 })]])) },
  { name: 'Cab Amp', fx: chainFx(fxState([[fxI('dist', { mode: 16, drive: 0.35, stages: 4 }), fxI('conv', { mix: 1, irgain: -20 }, { sub: { ir: 'fir:Cab/2x12 Closed' } }),
    fxI('util', { hpf: 60 })]])) },
]) });

/* ================================================================ entry points (§11.2; RULINGS2 F1: FX state v2 everywhere) */

export const defaultFx = defaultFx2;
// v2 result for every input: a v1 state (any model) migrates, migrateFx1(normalizeFxV1(fx), refs) — S1-variant instances
// that render bit-identically to the Phase-1 rack (§2.6.3; golden shards 3 and 4); refs = the track's Serum state (the
// instances its rows / locks / MIDI map address are kept)
export function normalizeFx(fx, refs) { return normalizeFx2(fx, refs); }
// v2 result: applyPresetFx2 (a v1 current or preset state migrates first; `s` = the new Serum state, or the Phase-1 call
// form — an array of locked ids — whose locked values are kept the same way)
export function applyPresetFx(curFx, presetFx, s) { return applyPresetFx2(curFx, presetFx, s); }
export const FACTORY_CHAINS = FACTORY_CHAINS2;
