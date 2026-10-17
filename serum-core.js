/*
 * serum-core.js — pure model of the Serum-style instrument (SPEC-serum2 §2–§5, §11.1, delta on SPEC-serum v2).
 * Canonical constants (§3), the v2 state schema, its normalisation and the exact v1 → v2 migration (§2.6), the
 * compiler to the engine formats CP v2 / CT v2 (§4.1). No DOM, no timers: importable from the browser, from node and
 * from Workers. Imports laws.js (knob laws, curve maths, display engine), fx-core.js (FX constants and FX state, owner
 * F1 since the M1a move), seq-core.js (sequencer schemas, constants, compileSeq; D6) and tuning.js (§11.4); re-exports
 * all four, so Phase-1 importers keep working and the UI reaches every §3 list through serum-core (§11.1).
 *
 * Index spaces (§3.11.1): static idx 0–147 v1 synth, 148–247 the v1 FX rows (fx-core FX_ROWS_V1), 248–528 SYN2.
 * vi(idx) = the voice-vector index (CP.base, eff, modded): idx for 0–147, idx − 100 for SYN2, −1 for FX rows and the
 * scope-M rows g.direct / g.bus1v / g.bus2v. The Phase-1 test "idx ≥ NS ⇒ FX" is forbidden: use isFxId / vi.
 *
 * State versions (§2.6): normalizeSerum migrates v1 input (s.v absent or 1) through normalizeV1 (the Phase-1
 * normalizeSerum, kept verbatim) and migrate1; a non-object input gives defaultSerum(). Migrated states carry
 * global.s1 = 1 (S1 Compatibility Mode). setS1(s, on) changes only that flag.
 *
 * compileSerum v2 (§4.1) emits every CP v2 field with its fixed shape, compiled from the state (neutral for v1 states).
 * CP.tune comes from global.tun.tab (normalisation rebuilds it from the .scl / .kbm texts of kind 'scl'), CP.sclN /
 * sclPer / sclSteps from tuning.js's stepTable(global.tun.scl) when global.tun.kind = 'scl' (memoised by text); dynamic
 * FX destinations fx.<inst>.<pid> resolve through fx-core's fxDest / fxLayout (without ctx.fx rows to them are inactive,
 * §4.1). Filter channels (§1, §6.12): a filter channel is in use when the filter is possibly on, a possibly-on source
 * routed to Filter has a balance share for it, or the other filter's channel is in use and routed into it (an off filter
 * passes its bypass sum through its level and route): the Direct bit / outMask count such channels' routes; CP.use bit 2
 * stays "Filter 2 possibly on" (§4.1; the DSP's bypass sum needs no Filter 2 instance). CP.use bit 512 only for a tuning
 * table that differs from the identity (§0.7). ctx.ultra (bounces with "Use Ultra quality when rendering") compiles
 * CP.os = 4 — the host passes it for bounces only. seq / seqT (SQP, §4.4) come from seq-core's compileSeq (with this
 * compiler's "possibly on" rule); CP.use bit 8192 = seq.active.
 * CP additions to the §4.1 table (appended, M2 review): mSlot (Uint8Array(64): the matrix slot of each compacted row, then
 * the idle slots in slot order — sx-mod keeps randd draws, slew states and snapshot.mOut per slot, §6.2) and cpKey
 * (8-hex FNV-1a over every CP field except ctKey: graph edits change only ctKey and CT parts, so a host comparing cpKey
 * can post the changed parts alone, {t: 'ct'}, and stay within the §4.1 per-frame budget). The arp / clip / kbd schemas (§2.4) are seq-core's defaultArp/Clip/Kbd and normalizeArp/Clip/Kbd.
 * CT v2 is delivered by part (§4.1, B13): patch.serumT = {key, parts}; part shapes:
 *   lfo<l>  {key, n, tab: Float32Array(1025), pts: Float64Array(3n), pm: Uint8Array(2n), pmAny, start, loop}
 *   path<l> {key, x: Float32Array(1025), y: Float32Array(1025)}      (zeros for LFOs whose type is not 'path')
 *   remap<o> {key, tab: Float32Array(2049)}     crv<r> {key, tab: Float32Array(129)} (identity without a curve)
 *   spec<o> {key, tab: Float32Array(513)}       velo, note {key, tab: Float32Array(129)}
 * key = 8-hex FNV-1a of the concatenated part keys in the order lfo0…9, path0…9, remap0…2, velo, note, crv0…63,
 * spec0…2 (= CT_PART_NAMES order; = CP.ctKey). Part keys: 8-hex content hashes; 'none' (a non-Path LFO's path part) and
 * 'ident' (a row without an editable curve). crv<r> is indexed by matrix slot r (CP.mCrv holds the slot). Parts are
 * memoised by content (an unchanged graph keeps its part object). assembleCT(serumT) builds the full CT layout of §4.1
 * from the parts (reference for the DSP's mergeCT).
 * CP.mDst: ≥ 0 a vi; < 0 an FX-context index k as −1 − k (0 g.master, 1 g.bypass, 2 g.direct, 3 g.bus1v, 4 g.bus2v,
 * 8 + flat FX parameter). S1 pairs: a row on the other mode's field is compiled onto the active one, amount × range
 * ratio, CP.mAlias = 1 (§2.6.4).
 * Extra exports: migrate1, setS1, opsKey(ops) (§9.1 '~opsKey' of trim/fade), oscUses(s, o), oscTypeOf(s, o),
 * assembleCT, CT_PART_NAMES, FACTORY_PRESETS_V1 (the Phase-1 objects), FACTORY_PRESETS_V2 (the M3 Serum 2 presets, §10.11:
 * original recipes with s1 = 0; FACTORY_PRESETS = FACTORY_PRESETS_V2, then the migrated Phase-1 presets), MEMSET_DEFAULT_C,
 * PZ_DEFAULT, PATH_DEFAULT.
 * Documented deviations (ratified by RULINGS2: documented IMPL choices stand unless overruled there):
 *   - syncS1 applies the phase-memory knob-end rule (PHASE / RAND at 360° / 100 % → osc.phMem) only in S1 mode, where the
 *     knob ends mean Mem (§6.21 item 6); in S2 mode PHASE is a plain start phase and turning it must not rewrite the
 *     phase-memory menu (§2.6.4 states the forward maps without a mode condition).
 *   - §2.7 worst case: every graph at its maximum fits < 512 KB (≈ 480 KB), but with full clip banks (seq-core
 *     normalisation, ≈ 187 KB) the state is ≈ 0.66 MB; the test bounds it at 768 KB.
 *
 * Editing actions of §11.1: warpChoice2, swapWarps, syncS1, chaosToLfo (new state), applyMacros, swapMacros,
 * initMods, sortMatrix, copyModule (v2 pairs, Copy w/mods), swapModules, initModule, initPreset ({s, fx}), hybridize
 * ({s, fx}), destMenu / srcMenu (grouped menus), assetNeeds, tableNeeds (user tables / noises to embed), fxModded2
 * (compileFx v2 `modded`).
 * Helpers of the v2 UI actions (§13, M2; in place unless noted): setDestBase (knob / typed / MIDI base write for every
 * kind of destination, incl. macros, the virtual arp.* / clip.* of the selected slot and dynamic FX ids), setEnvBpm /
 * setMsDelayBpm (MS ↔ BPM units, nearest ENV_LADDER entry), filterFeeds / toggleFilterRoute (filter routing switches),
 * moduleOf / lockState / setLock / setModuleLock (Lock Module, Lock / Unlock Control; the virtual Arp / Clip controls
 * belong to their module), pitchChoice (pitch mode menu, ratio cycles), moveMod / rowCurvePts / rowInfo (matrix drag, Editable Curve start points, row badges), trimSample /
 * clearSampleOps (Trim, Reload Sample), loadTuning / clearTuning / tuningInfo, FACTORY_VC / vcPresetOf / applyVcPreset,
 * FACTORY_SPEC_FILTERS. destBase of arp.* / clip.* = the selected slot's / clip's n; locks of virtual destinations are kept
 * by applyPreset (macro values, every slot's base; an unlocked one inside a locked Arp / Clip takes the preset's slot
 * values), whose result obeys §2.2.5 (normalisation rules for ratio cycles and F1 ↔ F2 across kept and loaded modules).
 * S1 pairs across S1 flags (applyPreset, hybridize; §2.6.4): when the kept modules / locked parameters and the incoming
 * state differ in S1 mode, each pair is written into the field the loaded state's mode reads, from the state whose sound
 * it keeps (forward / inverse map); a kept S2 value without an S1 rendition (S2-only filter type, warp, Triangle sub,
 * bend beyond ±24, phase memory the knob ends cannot give) loads the state in S2 mode (global.s1 = 0) instead.
 * chaosToLfo(s, bpm) converts a BPM chaos rate to the ladder entry it plays at `bpm` (default 120; the GLOBAL page passes
 * the project tempo). toggleFilterRoute follows §13.3 literally: routed to Filter, a tap only toggles the switch.
 * sortMatrix(s, mode, fx) orders FX rows by the destination menu's instance order when given the FX state. With a v2
 * FX state every fx.* id resolves only through fxDest (B26), memoised per FX state object (validated against the
 * instance sequence on every lookup: structural edits in place are seen, parameter edits need nothing).
 *
 * Everything exported as a constant is deep-frozen. Functions never mutate their inputs, except the editing helpers
 * defined as in place on the state `s` (addMod, removeMods, setModAmount, toggleModBypass, toggleModPolarity,
 * reassignSource, veloToAmp, vibratoAssign, initLfos, copyLfo, pruneBuses, clearPointMods, warpChoice, warpChoice2,
 * swapWarps, syncS1, applyMacros (and its `fx`), swapMacros, initMods, sortMatrix, copyModule's target, swapModules,
 * initModule). Compiled objects contain typed arrays and are not frozen: treat them as read-only (CT / SQP parts are
 * memoised).
 */
import * as L from './laws.js?v=9';
import * as FXC from './fx-core.js?v=9';
import * as SQ from './seq-core.js?v=9';
import { stepTable, tuningState, describe as tunDescribe } from './tuning.js?v=9';
import { FX_ROWS_V1, RENAME1, DIST_MODES, DIST_FILTER, DLY_MODES, EQ_TYPES_L, EQ_TYPES_H, MODFX_LADDER, DLY_LADDER, REV_LABELS,
  defaultFxV1, normalizeFxV1, normalizeFx } from './fx-core.js?v=9';

export * from './laws.js?v=9';
export * from './fx-core.js?v=9';
export * from './seq-core.js?v=9';
export * from './tuning.js?v=9';

const { bend, evalPts, renderPts, CURVE_K } = L;

/* ================================================================ small helpers */

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fin = x => typeof x === 'number' && isFinite(x);
// clamp; NaN → lo; '+ 0' turns −0 into 0 so normalised state survives a JSON round trip unchanged
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
// fractional part in [0, 1): x − floor(x) rounds to exactly 1 for tiny negative x (−1e-20 → 1), which is folded to 0
const frac = x => { const f = x - Math.floor(x); return f < 1 ? f : 0; };
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const objOf = x => (isObj(x) ? x : {});
const arrOf = x => (Array.isArray(x) ? x : []);
const num = (x, d, lo, hi) => (fin(x) ? clamp(x, lo, hi) : d);
const intIn = (x, d, lo, hi) => (fin(x) ? clamp(Math.round(x), lo, hi) : d);
const bit = (x, d) => (typeof x === 'boolean' ? (x ? 1 : 0) : fin(x) ? (x >= 0.5 ? 1 : 0) : d);
const strIn = (x, d, max) => (typeof x === 'string' ? x.slice(0, max) : d);
const oneOf = (x, list, d) => (typeof x === 'string' && list.indexOf(x) >= 0 ? x : d);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
// deep copy of plain JSON data
function clone(x) {
  if (Array.isArray(x)) return x.map(clone);
  if (isObj(x)) { const o = {}; for (const k of Object.keys(x)) o[k] = clone(x[k]); return o; }
  return x;
}

/* ================================================================ §0.4, §4.4 constants */

export const VERSION = 2;
export const CP_VER = 2;
export const MIDI0 = 440 * Math.pow(2, -69 / 12);      // 8.175798915643707 Hz (MIDI note 0)

export const ENV_K = 10;
export const MC_K = 6;
export const PORTA_K = 6;
export const LFO_N = 1024;
export const REMAP_N = 2048;
export const XS_N = 1024;
export const CURVE_N = 128;
export const CRV_N = 128;
export const SPEC_FILT_N = 512;
export const MAX_PTS = 480;
export const MAX_CRV_PTS = 64;
export const MAX_SPEC_PTS = 128;
export const N_OSC = 3;
export const N_MATRIX = 64;
export const N_LFO = 10;
export const N_ENV = 4;
export const N_MACRO = 8;
export const N_BUS = 16;
export const FRAME = 2048;
export const MAX_FRAMES = 256;
export const SLEW_T = n => 4 * n * n * n;              // matrix RISE / FALL time in seconds (§3.13)

// Phase-1 sizes (v1 states, normalizeV1)
const V1 = { N_MATRIX: 32, N_LFO: 8, N_ENV: 3, N_MACRO: 4, NSRC: 34 };

/* ================================================================ §3.2 format codes */

export const FMT_CODES = deepFreeze(['pct', 'pct1', 'pan', 'fpan', 'oct', 'st', 'st2', 'ct', 'crs', 'int', 'det', 'phase', 'deg', 'frame',
  'bip100', 'hz', 'time', 'ms', 'msFloor', 'cmpAtt', 'db', 'dbv', 'dbtrim', 'bool', 'enum', 'ratio', 'xoff', 'q01', 'q2', 'lbh', 'var',
  'npitch', 'lfoRate', 'lfoTime', 'chaosRate', 'modRate', 'dlyTime', 'revT',
  'ratio2', 'hzoff', 'st1', 'xmul', 'smpPos', 'scan', 'vcScale', 'semiH', 'slice', 'dens', 'glen', 'fbal', 'arpRate', 'inf0']);

/* ================================================================ §3.3 warp modes */

// Phase-1 list (23 entries), used only by a.warpMode / b.warpMode in S1 mode (§3.4.2)
export const WARPS = deepFreeze([
  ['off', 'Off'], ['sync', 'Sync'], ['sync_half', 'Sync 1/2 Win.'], ['sync_win', 'Sync Window'],
  ['bend_p', 'Bend +'], ['bend_n', 'Bend -'], ['bend_pn', 'Bend +/-'], ['pwm', 'PWM'],
  ['asym_p', 'Asym +'], ['asym_n', 'Asym -'], ['asym_pn', 'Asym +/-'], ['flip', 'Flip'], ['mirror', 'Mirror'],
  ['remap1', 'Remap 1'], ['remap2', 'Remap 2'], ['remap3', 'Remap 3'], ['remap4', 'Remap 4'], ['quantize', 'Quantize'],
  ['fm_osc', 'FM (from B)', 'FM (from A)'], ['am_osc', 'AM (from B)', 'AM (from A)'], ['rm_osc', 'RM (from B)', 'RM (from A)'],
  ['fm_noise', 'FM (Noise)'], ['fm_sub', 'FM (Sub)'],
].map(([id, name, nameB]) => ({ id, name, nameB: nameB || name })));

// Serum 2 list (§3.4.1): {id, name (OSC A label), nameO: [label for A, B, C], dom, avail}; o1/o2 = the first / second
// other oscillator in A, B, C order (A → B, C; B → A, C; C → A, B)
const OTHERS = [['B', 'C'], ['A', 'C'], ['A', 'B']];
export const WARPS2 = deepFreeze((() => {
  const W = [];
  const w = (id, name, dom, avail) => W.push({ id, name, nameO: [name, name, name], dom, avail: avail || 'all' });
  const wo = (id, pre, k, dom) => W.push({ id, name: `${pre} (${OTHERS[0][k]})`, nameO: OTHERS.map(o => `${pre} (${o[k]})`), dom, avail: 'all' });
  w('off', 'Off', '');
  w('sync', 'Sync', 'P');
  w('bend_p', 'Bend +', 'P'); w('bend_n', 'Bend -', 'P'); w('bend_pn', 'Bend +/-', 'P');
  w('pwm', 'PWM', 'P');
  w('asym_p', 'Asym +', 'P'); w('asym_n', 'Asym -', 'P'); w('asym_pn', 'Asym +/-', 'P');
  w('flip', 'Flip', 'O');
  w('mirror', 'Mirror', 'P');
  for (let r = 1; r <= 4; r++) w('remap' + r, 'Remap ' + r, 'P');
  w('quantize', 'Quantize', 'P');
  w('oddeven', 'Odd/Even', 'O');
  w('lpf', 'LPF', 'O'); w('hpf', 'HPF', 'O');
  for (const [id, name] of [['d_tube', 'Tube'], ['d_soft', 'Soft Clip'], ['d_hard', 'Hard Clip'], ['d_diode1', 'Diode 1'], ['d_diode2', 'Diode 2'],
    ['d_linfold', 'Linear Fold'], ['d_sinfold', 'Sine Fold'], ['d_zerosq', 'Zero-Square'], ['d_asym', 'Asym'], ['d_rectify', 'Rectify'],
    ['d_sinesh', 'Sine Shaper'], ['d_stomp', 'Stomp Box'], ['d_tape', 'Tape Sat.'], ['d_softsat', 'Soft Sat.']]) w(id, name, 'O');
  const mods = (pre, lab, dom, self) => {
    wo(pre + '_o1', lab, 0, dom); wo(pre + '_o2', lab, 1, dom);
    w(pre + '_noise', lab + ' (Noise)', dom); w(pre + '_sub', lab + ' (Sub)', dom);
    w(pre + '_f1', lab + ' (Filter 1)', dom); w(pre + '_f2', lab + ' (Filter 2)', dom);
    if (self) w(pre + '_self', lab + ' (Self)', dom);
  };
  mods('fm', 'FM', 'F');
  mods('pd', 'PD', 'P', true);
  mods('am', 'AM', 'O');
  mods('rm', 'RM', 'O');
  for (const [id, name] of [['s_comb', 'Comb'], ['s_gate', 'Gate'], ['s_harm', 'Add Harmonics'], ['s_subh', 'Add Subharmonics'],
    ['s_spread', 'Spread'], ['s_smear', 'Smear'], ['s_detune', 'Detune'], ['s_pkoctu', 'Peak Octave Up'], ['s_pkoctd', 'Peak Octave Down'],
    ['s_pkharmu', 'Peak Harm Up'], ['s_pkharmd', 'Peak Harm Down'], ['s_shep', 'Shepard Filter'], ['s_shepn', 'Shepard Narrow']]) w(id, name, 'S', 'Sp');
  for (const [id, pre, k] of [['s_voc', 'Vocode'], ['s_mask', 'Mask']].flatMap(([id, pre]) => [[id + '_o1', pre, 0], [id + '_o2', pre, 1], [id + '_noise', pre, -1]])) {
    if (k < 0) w(id, pre + ' (Noise)', 'S', 'Sp');
    else W.push({ id, name: `${pre} (${OTHERS[0][k]})`, nameO: OTHERS.map(o => `${pre} (${o[k]})`), dom: 'S', avail: 'Sp' });
  }
  for (const [id, name] of [['s_mirror', 'Mirror'], ['s_pshift', 'Pitch Shift'], ['s_pblend', 'Pitch Blend'], ['s_shift', 'Shift'],
    ['s_twist', 'Phase Twist']]) w(id, name, 'S', 'Sp');
  return W;
})());
export const WARP_AVAIL = deepFreeze(WARPS2.map(e => e.avail));
// v1 warp index → [WARPS2 index, Var] (§2.6.4); exact except entry 2 (Sync 1/2 Win.)
export const S1_TO_S2_WARP = deepFreeze([[0, 0], [1, 0], [1, 0.5], [1, 1], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0],
  [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [39, 0], [46, 0], [52, 0], [41, 0], [42, 0]]);

/* ================================================================ §3.4/§3.5 filters */

export const FILTER_CATS = deepFreeze(['Normal', 'Multi', 'Flanges', 'Misc', 'New']);
export const FILTER_FAMILY = deepFreeze(['ladder', 'svf', 'dual', 'morph', 'comb', 'flange', 'phaser', 'fphs', 'eq', 'ring', 'snh', 'bank',
  'french', 'german', 'addbass', 'formant', 'breject', 'distcomb', 'scream',
  'wasp', 'djm', 'diffusor', 'ladder2', 'dirty', 'pzsvf', 'comb2', 'expmm', 'k35']);
export const FILTERS = deepFreeze((() => {
  const F = [];
  const fa = (name, id, cat, varLabel, family) => F.push({ id, name, cat, varLabel, family });
  for (const n of [6, 12, 18, 24]) fa(`MG Low ${n}`, `mg_low${n}`, 'Normal', 'FAT', 'ladder');
  for (const n of [6, 12, 18, 24]) fa(`Low ${n}`, `low${n}`, 'Normal', 'FAT', 'svf');
  for (const n of [6, 12, 18, 24]) fa(`High ${n}`, `high${n}`, 'Normal', 'FAT', 'svf');
  for (const n of [12, 24]) fa(`Band ${n}`, `band${n}`, 'Normal', 'FAT', 'svf');
  for (const n of [12, 24]) fa(`Peak ${n}`, `peak${n}`, 'Normal', 'FAT', 'svf');
  for (const n of [12, 24]) fa(`Notch ${n}`, `notch${n}`, 'Normal', 'FAT', 'svf');
  fa('LH 6', 'lh6', 'Multi', 'FREQ', 'dual');
  fa('LH 12', 'lh12', 'Multi', 'FREQ', 'dual');
  for (const [p, s] of [['L', 'B'], ['L', 'P'], ['L', 'N'], ['H', 'B'], ['H', 'P'], ['H', 'N'], ['B', 'P'], ['B', 'N'], ['P', 'P'], ['P', 'N'], ['N', 'N']]) {
    fa(`${p}${s} 12`, `${p}${s}12`.toLowerCase(), 'Multi', 'FREQ', 'dual');
  }
  for (const [a, b, c] of [['L', 'B', 'H'], ['L', 'P', 'H'], ['L', 'N', 'H'], ['B', 'P', 'N']]) {
    for (const n of [12, 24]) fa(`${a}/${b}/${c} ${n}`, `${a}${b}${c}${n}`.toLowerCase(), 'Multi', 'MORPH', 'morph');
  }
  for (const [pre, fam] of [['Cmb', 'comb'], ['Flg', 'flange']]) {
    for (const pol of ['+', '-']) fa(`${pre} ${pol}`, `${pre.toLowerCase()}_${pol === '+' ? 'p' : 'n'}`, 'Flanges', 'FAT', fam);
    for (const [t, v] of [['L6', 'LP FREQ'], ['H6', 'HP FREQ'], ['HL6', 'HL WID']]) {
      for (const pol of ['+', '-']) fa(`${pre} ${t}${pol}`, `${pre.toLowerCase()}_${t.toLowerCase()}${pol === '+' ? 'p' : 'n'}`, 'Flanges', v, fam);
    }
  }
  for (const o of [12, 24, 36, 48]) for (const pol of ['+', '-']) fa(`Phs ${o}${pol}`, `phs${o}${pol === '+' ? 'p' : 'n'}`, 'Flanges', 'FAT', 'phaser');
  for (const [t, v] of [['L6', 'LP FREQ'], ['H6', 'HP FREQ'], ['HL6', 'HL WID']]) {
    for (const pol of ['+', '-']) fa(`Phs 48${t}${pol}`, `phs48${t.toLowerCase()}${pol === '+' ? 'p' : 'n'}`, 'Flanges', v, 'phaser');
  }
  for (const pol of ['+', '-']) fa(`FPhs 12HL6${pol}`, `fphs12hl6${pol === '+' ? 'p' : 'n'}`, 'Flanges', 'HL WID', 'fphs');
  fa('Low EQ 6', 'loweq6', 'Misc', 'DB', 'eq');
  fa('Low EQ 12', 'loweq12', 'Misc', 'DB', 'eq');
  fa('Band EQ 12', 'bandeq12', 'Misc', 'DB', 'eq');
  fa('High EQ 6', 'higheq6', 'Misc', 'DB', 'eq');
  fa('High EQ 12', 'higheq12', 'Misc', 'DB', 'eq');
  fa('Ring Mod', 'ringmod', 'Misc', '', 'ring');
  fa('Ring Modx2', 'ringmod2', 'Misc', 'SPREAD', 'ring');
  fa('SampHold', 'samphold', 'Misc', '', 'snh');
  fa('SampHold-', 'samphold_n', 'Misc', '', 'snh');
  fa('Combs', 'combs', 'Misc', 'DAMP', 'bank');
  fa('Allpasses', 'allpasses', 'Misc', 'DAMP', 'bank');
  fa('Reverb', 'reverb', 'Misc', 'DAMP', 'bank');
  fa('French LP', 'french_lp', 'Misc', 'BOEUF', 'french');
  fa('German LP', 'german_lp', 'Misc', '', 'german');
  fa('Add Bass', 'add_bass', 'Misc', 'THRU', 'addbass');
  fa('Formant-I', 'formant1', 'Misc', 'FORMNT', 'formant');
  fa('Formant-II', 'formant2', 'Misc', 'FORMNT', 'formant');
  fa('Formant-III', 'formant3', 'Misc', 'FORMNT', 'formant');
  fa('Bandreject', 'bandreject', 'Misc', 'WIDTH', 'breject');
  fa('Dist.Comb 1 LP', 'distcomb1_lp', 'Misc', 'COMBFRQ', 'distcomb');
  fa('Dist.Comb 1 BP', 'distcomb1_bp', 'Misc', 'COMBFRQ', 'distcomb');
  fa('Dist.Comb 2 LP', 'distcomb2_lp', 'Misc', 'COMBFRQ', 'distcomb');
  fa('Dist.Comb 2 BP', 'distcomb2_bp', 'Misc', 'COMBFRQ', 'distcomb');
  fa('Scream LP', 'scream_lp', 'Misc', 'SCREAM', 'scream');
  fa('Scream BP', 'scream_bp', 'Misc', 'SCREAM', 'scream');
  // §3.5 "New" category (types 96–107)
  fa('Wsp', 'wsp', 'New', 'MORPH', 'wasp');
  fa('DJ Mixer', 'djm', 'New', '', 'djm');
  fa('Diffusor', 'diffusor', 'New', 'STAGES', 'diffusor');
  fa('MG Ladder', 'mg_ladder', 'New', 'SMOOTH', 'ladder2');
  fa('Acid Ladder', 'acid_ladder', 'New', 'SMOOTH', 'ladder2');
  fa('EMS Ladder', 'ems_ladder', 'New', 'SMOOTH', 'ladder2');
  fa('MG Dirty', 'mg_dirty', 'New', 'PAIN', 'dirty');
  fa('PZ SVF', 'pz_svf', 'New', 'SMOOTH', 'pzsvf');
  fa('Comb 2', 'comb2', 'New', 'FRQ2', 'comb2');
  fa('Exp MM', 'exp_mm', 'New', 'MIX', 'expmm');
  fa('Exp BPF', 'exp_bpf', 'New', '', 'expmm');
  fa('K35', 'k35', 'New', '', 'k35');
  return F;
})());

/* ================================================================ §3.5 formants, §3.6 sub shapes and colour noises */

// FORMANTS[table I/II/III][vowel a e i o u] = [F1, F2, F3] Hz
export const FORMANTS = deepFreeze([
  [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]],
  [[850, 1220, 2810], [610, 2330, 2990], [310, 2790, 3310], [590, 920, 2710], [370, 950, 2670]],
  [[1030, 1370, 3170], [690, 2610, 3570], [370, 3200, 3730], [680, 1060, 3180], [430, 1170, 3260]],
]);

export const SUB_SHAPES = deepFreeze([['sine', 'Sine'], ['roundrect', 'RoundRect'], ['saw', 'Saw'], ['square', 'Square'], ['pulse', 'Pulse']]
  .map(([id, name]) => ({ id, name, table: 'sub:' + name })));
export const SUB_IDS = deepFreeze(SUB_SHAPES.map(s => s.table));
export const SUB_SHAPES2 = deepFreeze([['sine', 'Sine', 'Sine'], ['roundrect', 'Rounded Rect', 'RoundRect'], ['triangle', 'Triangle', 'Triangle'],
  ['saw', 'Saw', 'Saw'], ['square', 'Square', 'Square'], ['pulse', 'Pulse', 'Pulse']].map(([id, name, t]) => ({ id, name, table: 'sub:' + t })));
export const SUB_IDS2 = deepFreeze(SUB_SHAPES2.map(s => s.table));
export const S1_TO_S2_SUB = deepFreeze([0, 1, 3, 4, 5]);
export const COLOR_NOISES = deepFreeze(['White', 'Pink', 'Brown', 'Geiger'].map(n => ({ id: 'color:' + n, name: n })));

/* ================================================================ §3.3 oscillator types, routing, voicing */

const idName = list => deepFreeze(list.map(([id, name]) => ({ id, name })));
export const OSC_TYPES = idName([['wt', 'Wavetable'], ['multi', 'Multisample'], ['sample', 'Sample'], ['gran', 'Granular'], ['spec', 'Spectral']]);
export const PITCH_MODES = idName([['semi', 'Semitones'], ['harm', 'Harmonics'], ['ratio', 'Ratio'], ['step', 'Step']]);
export const PHASE_MEM = idName([['all', 'All Voices'], ['contig', 'Contiguous'], ['voice', 'Per Voice']]);
export const ROUTES_SRC = deepFreeze(['Filter', 'Main', 'Direct', 'None']);
export const ROUTES_FILT = deepFreeze(['Filter', 'Main', 'Direct', 'None']);
export const ROUTES_BUS = deepFreeze(['Main', 'Direct', 'Bus']);
export const STEAL = deepFreeze(['Newest', 'Oldest', 'Highest', 'Lowest', 'Velocity']);
export const MPE_XYZ = deepFreeze(['Off', 'XYZ -> Macro 1,2,3', 'YZ -> Macro 1,2', 'Y -> Mod Wheel']);
export const FM_TYPES = deepFreeze(['Thru-Zero', 'Exp', 'Linear']);
const OSC_TYPE_IDS = OSC_TYPES.map(e => e.id), PITCH_MODE_IDS = PITCH_MODES.map(e => e.id), PHASE_MEM_IDS = PHASE_MEM.map(e => e.id);

/* ================================================================ §3.7 unison */

export const UNI_STACKS = deepFreeze(['off', '12 (1x)', '12 (2x)', '12 (3x)', '12+7(1x)', '12+7(2x)', '12+7(3x)', 'Center-12', 'Center-24']);
export const UNI_MODES = deepFreeze(['Linear', 'Super', 'Exp.', 'Inv.', 'Random']);
export const UNI_SPAWN = deepFreeze(['Together', 'Even', 'Exp', 'Random']);

// Detune slot shape s(t), t ∈ [−1, 1]. Random (4) is drawn per voice at note-on by the DSP: 0 here (and in the tables).
export function detuneShape(mode, t) {
  const a = Math.abs(t), s = t < 0 ? -1 : t > 0 ? 1 : 0;
  switch (mode) {
    case 0: return t;
    case 1: return s * Math.pow(a, 1.5);
    case 2: return s * Math.pow(a, 2.5);
    case 3: return s * Math.sqrt(a);
    default: return 0;
  }
}

const isCentreVoice = (i, N) => (N & 1 ? i === (N - 1) / 2 : i === N / 2 - 1 || i === N / 2);
const STACK_CYCLES = [null, null, null, null, [0, 7, 12], [0, 7, 12, 19, 24], [0, 7, 12, 19, 24, 31, 36]];

// Semitone offset of unison voice i (sorted by detune slot) of N for stack index `stack` (§3.8)
export function stackSemis(stack, i, N) {
  switch (stack) {
    case 1: return i & 1 ? 12 : 0;
    case 2: return i & 1 ? 12 * (1 + ((i - 1) / 2) % 2) : 0;
    case 3: return i & 1 ? 12 * (1 + ((i - 1) / 2) % 3) : 0;
    case 4: case 5: case 6: { const c = STACK_CYCLES[stack]; return c[i % c.length]; }
    case 7: return isCentreVoice(i, N) ? -12 : 0;
    case 8: return isCentreVoice(i, N) ? -24 : 0;
    default: return 0;
  }
}

const UNI = (() => {
  const uniShape = new Float64Array(5 * 256), uniStack = new Float64Array(9 * 256), uniCenter = new Uint8Array(256);
  for (let N = 1; N <= 16; N++) {
    for (let i = 0; i < N; i++) {
      const t = N > 1 ? 2 * i / (N - 1) - 1 : 0, o = (N - 1) * 16 + i;
      for (let m = 0; m < 5; m++) uniShape[m * 256 + o] = detuneShape(m, t) + 0;
      for (let k = 0; k < 9; k++) uniStack[k * 256 + o] = stackSemis(k, i, N);
      uniCenter[o] = isCentreVoice(i, N) ? 1 : 0;
    }
  }
  return { uniShape, uniStack, uniCenter };
})();

// { uniShape [mode·256 + (N−1)·16 + i], uniStack [stack·256 + (N−1)·16 + i], uniCenter [(N−1)·16 + i] } — fresh copies
export function uniTables() {
  return { uniShape: UNI.uniShape.slice(), uniStack: UNI.uniStack.slice(), uniCenter: UNI.uniCenter.slice() };
}

/* ================================================================ §3.8–§3.9 granular, sample and spectral enumerations */

export const GRAIN_WINDOWS = idName([['hann', 'Hann'], ['welch', 'Welch'], ['gauss', 'Gaussian'], ['bh', 'Blackman-Harris'], ['sinc', 'Sinc'],
  ['tukey', 'Tukey'], ['tri', 'Triangle'], ['trap', 'Trapezoid'], ['expdec', 'ExpDec'], ['expdecrev', 'Exp Dec Rev']]);
export const LOOP_MODES = deepFreeze(['One-shot', 'Fwd Loop', 'Rev Loop', 'Fwd/Rwd Loop', 'Tailed']);
export const SCAN_RANGES = deepFreeze([2, 4, 8]);
export const FADE_MS = deepFreeze([0, 1, 2, 4, 8, 16, 32, 64, 128]);
export const SLICE_MODES = deepFreeze(['Off', 'Auto', 'Manual']);
export const DENS_MODES = deepFreeze(['Free', 'BPM Sync', 'Grains']);
export const GLEN_MODES = deepFreeze(['Free', 'BPM Sync', 'Percent']);
export const XY_Y_GRAN = deepFreeze(['None', 'Level', 'Warp', 'Warp 2', 'Density', 'Grain Length', 'Window Amt', 'Window Skew', 'Rand Offset',
  'Rand Dir', 'Rand Pitch', 'Rand Length', 'Rand Pan', 'Rand Gain', 'Rand Window', 'Rand Skew', 'Rand Warp', 'Rand Warp 2']);
export const XY_Y_SPEC = deepFreeze(['None', 'Level', 'Warp', 'Warp 2', 'Spec Flt Cutoff', 'Spec Flt Wet/Dry', 'Freq Lo', 'Freq Hi']);
export const XY_MODES = deepFreeze(['Add', 'Replace', 'Scale']);
export const SPEC_N = deepFreeze({ base48: 2048, above48: 4096, hopDiv: [2, 4, 8] });

/* ================================================================ §3.9, §3.12 ladders, envelopes, LFOs */

const LFO_LABELS = ['32 bar', '16 bar', '8 bar', '4 bar', '2 bar', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64', '1/128', '1/256', 'fast'];
export const LFO_LADDER = deepFreeze(LFO_LABELS.map((label, i) => ({ label, beats: 128 * Math.pow(2, -i) })));
// ladders with dotted / triplet entries of the first `nd` straight entries, sorted slowest first (ties: straight, dot, trip)
function buildLadders(base, nd) {
  const out = [];
  for (let v = 0; v < 4; v++) {
    const dot = v & 1, trip = v >> 1, Lv = [];
    base.forEach(e => Lv.push({ label: e.label, beats: e.beats, k: 0 }));
    if (dot) for (let i = 0; i < nd; i++) Lv.push({ label: base[i].label + '.', beats: base[i].beats * 1.5, k: 1 });
    if (trip) for (let i = 0; i < nd; i++) Lv.push({ label: base[i].label + 'T', beats: base[i].beats * 2 / 3, k: 2 });
    Lv.sort((a, b) => b.beats - a.beats || a.k - b.k);
    out.push(deepFreeze(Lv.map(e => ({ label: e.label, beats: e.beats }))));
  }
  return out;
}
const LADDERS = buildLadders(LFO_LADDER, 14);
// [{label, beats}] slowest → fastest; lengths 15 / 29 / 29 / 43 (frozen, shared)
export function lfoLadder(dot, trip) { return LADDERS[(dot ? 1 : 0) + (trip ? 2 : 0)]; }
// ENV_LADDER (BPM units, §3.12): 0, then the 15 straight LFO ladder entries reversed (fast … 32 bar)
export const ENV_LADDER = deepFreeze([{ label: '0', beats: 0 }].concat(LFO_LADDER.slice().reverse().map(e => ({ label: e.label, beats: e.beats }))));
export const LFO_MODES2 = idName([['retrig', 'RETRIG'], ['env', 'ENVELOPE'], ['free', 'FREE']]);
export const LFO_TYPES = idName([['normal', 'Normal'], ['path', 'Path'], ['lorenz', 'Chaos: Lorenz'], ['rossler', 'Chaos: Rossler'], ['sh', 'S&H']]);
export const LFO_DIRS = idName([['fwd', 'Forward'], ['rev', 'Reverse'], ['pp', 'Ping Pong']]);
export const LFO_TOOLS = deepFreeze(['point', 'flat', 'rampUp', 'rampDown']);
const LFO_MODE_IDS = LFO_MODES2.map(e => e.id), LFO_TYPE_IDS = LFO_TYPES.map(e => e.id), LFO_DIR_IDS = LFO_DIRS.map(e => e.id);

/* ================================================================ §3.14 tuning and MPE, §2.2.6 Voice Control */

export const TUN_KINDS = deepFreeze(['none', 'scl', 'tun']);
export const MPE_BEND_DEF = 48;
export const A4_RANGE = deepFreeze([400, 480]);
export const VC_RATES = deepFreeze([1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4]);

/* ================================================================ §3.15 sequencer constants (seq-core.js, D6; re-exported) */

const { arpLadder, gridLadder, LEN_LADDER, RRATE_LADDER, CLIP_RATES } = SQ;

/* ================================================================ §3.10 sources (v2: 62) */

export const SOURCES = deepFreeze((() => {
  const S = [{ id: '', label: '(none)', pol: '', scope: '', tile: 0 }];
  const add = (id, label, pol, scope, tile) => S.push({ id, label, pol, scope, tile: tile ? 1 : 0 });
  add('wheel', 'Mod Wheel', 'uni', 'G', 1);
  for (let e = 1; e <= 3; e++) add('env' + e, 'Env ' + e, 'uni', 'V', 1);
  for (let l = 1; l <= 8; l++) add('lfo' + l, 'LFO ' + l, 'uni', 'V/G', 1);
  add('velo', 'Velocity', 'uni', 'V', 1);
  add('note', 'Note', 'uni', 'V', 1);
  add('at', 'Aftertouch', 'uni', 'G');
  add('pat', 'Poly AT', 'uni', 'V');
  add('chaos1', 'Chaos 1', 'bi', 'V/G');
  add('chaos2', 'Chaos 2', 'bi', 'V/G');
  add('noise', 'Noise Osc', 'bi', 'V');
  add('rand1', 'NoteOn Rand 1', 'uni', 'V');
  add('rand2', 'NoteOn Rand 2', 'uni', 'V');
  add('alt1', 'NoteOn Alt', 'uni', 'V');
  add('alt2', 'NoteOn Alt 2', 'uni', 'V');
  for (let m = 1; m <= 4; m++) add('macro' + m, 'Macro ' + m, 'uni', 'G', 1);
  add('bend', 'Pitch Bend', 'bi', 'G');
  add('mpex', 'MPE X', 'bi', 'V');
  add('mpey', 'MPE Y', 'uni', 'V');
  add('mpez', 'MPE Z', 'uni', 'V');
  add('relvel', 'Rel. Velo', 'uni', 'V');
  add('fixed', 'Fixed', 'uni', 'G');
  // §3.10 Serum 2 sources (34–61)
  add('env4', 'Env 4', 'uni', 'V', 1);
  add('lfo9', 'LFO 9', 'uni', 'V/G', 1);
  add('lfo10', 'LFO 10', 'uni', 'V/G', 1);
  for (let l = 1; l <= 10; l++) add('lfo' + l + 'y', 'LFO ' + l + ' Y', 'uni', 'V/G');
  for (let m = 5; m <= 8; m++) add('macro' + m, 'Macro ' + m, 'uni', 'G', 1);
  add('randd', 'Note-On Rand (Discrete)', 'uni', 'V');
  add('osca', 'OSC A', 'bi', 'V');
  add('oscb', 'OSC B', 'bi', 'V');
  add('oscc', 'OSC C', 'bi', 'V');
  add('sub', 'SUB', 'bi', 'V');
  add('filt1', 'Filter 1', 'bi', 'V');
  add('filt2', 'Filter 2', 'bi', 'V');
  add('actv', 'Active Voices', 'uni', 'G');
  add('vidx', 'Voice Index', 'uni', 'V');
  add('vmod1', 'Voice Mod 1', 'bi', 'V');
  add('vmod2', 'Voice Mod 2', 'bi', 'V');
  return S;
})());
export const NSRC = SOURCES.length;                     // 62
const SRC_MAP = new Map(SOURCES.map((s, i) => [s.id, i]));
const SRC_MAP_V1 = new Map(SOURCES.slice(0, V1.NSRC).map((s, i) => [s.id, i]));
export const SRC_INDEX = deepFreeze(SOURCES.reduce((o, s, i) => { o[s.id] = i; return o; }, {}));
// Phase-1 menu order (v1 sources); SRC_MENU2 = the v2 order of §3.10 (chaos sources last: listed under "S1")
export const SRC_MENU = deepFreeze(['env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'velo', 'note',
  'wheel', 'at', 'pat', 'bend', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2', 'macro1', 'macro2', 'macro3', 'macro4',
  'mpex', 'mpey', 'mpez', 'relvel', 'fixed']);
export const SRC_MENU2 = deepFreeze([
  'env1', 'env2', 'env3', 'env4', ...Array.from({ length: 10 }, (_, l) => 'lfo' + (l + 1)), ...Array.from({ length: 10 }, (_, l) => 'lfo' + (l + 1) + 'y'),
  'velo', 'note', 'wheel', 'at', 'pat', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'rand1', 'rand2', 'randd', 'alt1', 'alt2',
  ...Array.from({ length: 8 }, (_, m) => 'macro' + (m + 1)), 'osca', 'oscb', 'oscc', 'sub', 'noise', 'filt1', 'filt2', 'actv', 'vidx',
  'vmod1', 'vmod2', 'fixed', 'chaos1', 'chaos2']);
export const SIDX = deepFreeze(SOURCES.reduce((o, s, i) => { if (s.id) o[s.id.toUpperCase()] = i; return o; }, {}));

/* ================================================================ §3.11 destinations (v2: 529) */

// The 17 Phase-1 per-oscillator rows (k = a, b; Block C reuses them for c, §3.11.2)
const OSC_ROWS_V1 = [
  ['level', 'Level', 'pow2', 0, 1, 0.75, 'pct', 'V', 0],
  ['pan', 'Pan', 'lin', -1, 1, 0.5, 'pan', 'V', 1],
  ['oct', 'Octave', 'int', -4, 4, 0.5, 'oct', 'V', 1],
  ['semi', 'Semi', 'int', -12, 12, 0.5, 'st', 'V', 1],
  ['fine', 'Fine', 'lin', -100, 100, 0.5, 'ct', 'V', 1],
  ['crs', 'Coarse Pitch', 'lin', -64, 64, 0.5, 'crs', 'V', 1],
  ['uni', 'Unison', 'int', 1, 16, 0, 'int', 'V*', 0],
  ['det', 'Uni Detune', 'pow2', 0, 1, 0.5, 'det', 'V', 0],
  ['blend', 'Uni Blend', 'lin', 0, 1, 0.75, 'pct', 'V', 0],
  ['phase', 'Phase', 'lin', 0, 360, 0.5, 'phase', 'V', 0],
  ['rand', 'Rand Phase', 'lin', 0, 1, 1, 'pct', 'V', 0],
  ['wt', 'WT Pos', 'lin', 0, 1, 0, 'frame', 'V', 0],
  ['warp', 'Warp', 'lin', 0, 1, 0, 'pct', 'V', 0],
  ['uniw', 'Uni Width', 'lin', 0, 1, 1, 'pct', 'V', 0],
  ['uniwarp', 'Uni Warp', 'lin', -1, 1, 0.5, 'bip100', 'V', 1],
  ['uniwt', 'Uni WT Pos', 'lin', -1, 1, 0.5, 'bip100', 'V', 1],
  ['stack', 'Uni Stack', 'enum', 0, 8, 0, 'enum:UNI_STACKS', 'V', 0],
];

export const DESTS = deepFreeze((() => {
  const D = [];
  const add = (id, label, law, lo, hi, def, fmt, scope, ctr, group) => D.push({ id, label, law, lo, hi, def, fmt, scope, ctr: ctr ? 1 : 0, group });
  // ---- v1 synth rows (idx 0–147), Phase-1 builder
  for (const [k, K] of [['a', 'A'], ['b', 'B']]) for (const r of OSC_ROWS_V1) add(`${k}.${r[0]}`, `Osc ${K} ${r[1]}`, r[2], r[3], r[4], r[5], r[6], r[7], r[8], `Osc ${K}`);
  add('n.level', 'Noise Level', 'pow2', 0, 1, 0.25, 'pct', 'V', 0, 'Noise');
  add('n.pitch', 'Noise Pitch', 'npitch', -200, 48, 0.5, 'npitch', 'V', 1, 'Noise');
  add('n.fine', 'Noise Fine', 'lin', -100, 100, 0.5, 'ct', 'V', 1, 'Noise');
  add('n.pan', 'Noise Pan', 'lin', -1, 1, 0.5, 'pan', 'V', 1, 'Noise');
  add('n.rand', 'Noise Rand Phase', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Noise');
  add('n.phase', 'Noise Phase', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Noise');
  add('s.level', 'Sub Level', 'lin', 0, 1, 0.75, 'pct', 'V', 0, 'Sub');
  add('s.pan', 'Sub Pan', 'lin', -1, 1, 0.5, 'pan', 'V', 1, 'Sub');
  add('f.cutoff', 'Filter Cutoff', 'exp', MIDI0, 22050, 0.5, 'hz', 'V', 0, 'Filter');
  add('f.res', 'Filter Res', 'lin', 0, 1, 0.1, 'pct', 'V', 0, 'Filter');
  add('f.drive', 'Filter Drive', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter');
  add('f.var', 'Filter Var', 'lin', 0, 1, 0, 'var', 'V', 0, 'Filter');
  add('f.mix', 'Filter Mix', 'lin', 0, 1, 1, 'pct', 'V', 0, 'Filter');
  add('f.pan', 'Filter Pan', 'lin', 0, 1, 0.5, 'fpan', 'V', 1, 'Filter');
  for (let e = 1; e <= 3; e++) {
    const g = `Env ${e}`;
    add(`e${e}.att`, `Env ${e} Attack`, 'pow5', 0, 32, 0.11, 'time', 'V*', 0, g);
    add(`e${e}.hold`, `Env ${e} Hold`, 'pow5', 0, 32, 0, 'time', 'V*', 0, g);
    add(`e${e}.dec`, `Env ${e} Decay`, 'pow5', 0, 32, 0.5, 'time', 'V*', 0, g);
    if (e === 1) add(`e${e}.sus`, `Env ${e} Sustain`, 'pow2', 0, 1, 1, 'db', 'V*', 0, g);
    else add(`e${e}.sus`, `Env ${e} Sustain`, 'lin', 0, 1, 1, 'pct', 'V*', 0, g);
    add(`e${e}.rel`, `Env ${e} Release`, 'pow5', 0, 32, 0.215, 'time', 'V*', 0, g);
  }
  for (let l = 1; l <= 8; l++) {
    const g = `LFO ${l}`;
    add(`l${l}.rate`, `LFO ${l} Rate`, 'pow4', 0, 100, 0.5, 'lfoRate', 'V*M', 0, g);
    add(`l${l}.rise`, `LFO ${l} Rise`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g);
    add(`l${l}.delay`, `LFO ${l} Delay`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g);
    add(`l${l}.smooth`, `LFO ${l} Smooth`, 'lin', 0, 1, 0, 'pct', 'V*M', 0, g);
  }
  add('c1.rate', 'Chaos 1 Rate', 'pow5', 0, 1000, 0.2512, 'chaosRate', 'V*M', 0, 'Chaos');
  add('c2.rate', 'Chaos 2 Rate', 'pow5', 0, 1000, 0.2512, 'chaosRate', 'V*M', 0, 'Chaos');
  add('g.porta', 'Porta Time', 'pow5', 0, 8, 0, 'time', 'V', 0, 'Global');
  add('g.curve', 'Porta Curve', 'lin', -1, 1, 0.5, 'bip100', 'V', 1, 'Global');
  add('g.tune', 'Master Tune', 'lin', -64, 64, 0.5, 'st2', 'V', 1, 'Global');
  add('g.amp', 'Amp', 'pow2', 0, 1, 1, 'pct', 'V', 0, 'Global');
  add('g.bendup', 'Bend Up', 'int', -24, 24, 26 / 48, 'st', 'V', 0, 'Global');
  add('g.benddn', 'Bend Down', 'int', -24, 24, 22 / 48, 'st', 'V', 0, 'Global');
  for (let b = 1; b <= 16; b++) add(`bus${b}`, `LFO Bus ${b}`, 'lin', -1, 1, 0.5, 'bip100', 'V*M', 1, 'LFO Bus');
  for (const [k, K, def] of [['a', 'A', 1], ['b', 'B', 0]]) add(`${k}.on`, `Osc ${K} On`, 'bool', 0, 1, def, 'bool', 'V', 0, `Osc ${K}`);
  add('n.on', 'Noise On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Noise');
  add('s.on', 'Sub On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Sub');
  add('f.on', 'Filter On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Filter');
  for (const [k, K, def] of [['A', 'A', 1], ['B', 'B', 0], ['N', 'Noise', 0], ['S', 'Sub', 0]]) add(`f.route${k}`, `${K}>Filter`, 'bool', 0, 1, def, 'bool', 'V', 0, 'Filter');
  for (const [k, K] of [['a', 'A'], ['b', 'B']]) add(`${k}.track`, `Osc ${K} Pitch Track`, 'bool', 0, 1, 1, 'bool', 'V', 0, `Osc ${K}`);
  for (const [k, K] of [['a', 'A'], ['b', 'B']]) add(`${k}.warpMode`, `Osc ${K} Warp Mode`, 'enum', 0, 22, 0, 'enum:WARPS', 'V', 0, `Osc ${K}`);
  add('s.shape', 'Sub Shape', 'enum', 0, 4, 0, 'enum:SUB_SHAPES', 'V', 0, 'Sub');
  add('s.oct', 'Sub Octave', 'int', -4, 4, 0.5, 'oct', 'V', 1, 'Sub');
  add('f.type', 'Filter Type', 'enum', 0, 95, 1 / 95, 'enum:FILTERS', 'V', 0, 'Filter');
  for (let e = 1; e <= 3; e++) {
    add(`e${e}.ca`, `Env ${e} Attack Curve`, 'lin', 0, 1, 0.5, 'pct', 'V*', 0, `Env ${e}`);
    add(`e${e}.cd`, `Env ${e} Decay Curve`, 'lin', 0, 1, 0.666, 'pct', 'V*', 0, `Env ${e}`);
    add(`e${e}.cr`, `Env ${e} Release Curve`, 'lin', 0, 1, 0.666, 'pct', 'V*', 0, `Env ${e}`);
  }
  add('c1.bpm', 'Chaos 1 BPM', 'bool', 0, 1, 0, 'bool', 'V*M', 0, 'Chaos');
  add('c2.bpm', 'Chaos 2 BPM', 'bool', 0, 1, 0, 'bool', 'V*M', 0, 'Chaos');
  add('g.wheel', 'Mod Wheel', 'lin', 0, 1, 0, 'pct', 'G', 0, 'Global');
  add('g.bend', 'Pitch Bend', 'lin', -1, 1, 0.5, 'bip100', 'G', 1, 'Global');
  // ---- v1 FX rows (idx 148–247), generated from fx-core's FX_ROWS_V1 (§3.11.1, §11.2)
  for (const r of FX_ROWS_V1) add(r.id, r.label, r.law, r.lo, r.hi, r.def, r.fmt, r.scope, r.ctr, r.group);
  // ---- SYN2 (idx 248–528), §3.11.2 normative builder
  // Block C — OSC C base (idx 248–266)
  for (const r of OSC_ROWS_V1) add(`c.${r[0]}`, `Osc C ${r[1]}`, r[2], r[3], r[4], r[5], r[6], r[7], r[8], 'Osc C');
  add('c.on', 'Osc C On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Osc C');
  add('c.track', 'Osc C Pitch Track', 'bool', 0, 1, 1, 'bool', 'V', 0, 'Osc C');
  // Block O2 — per oscillator a, b, c (51 rows each; idx 267–317 a, 318–368 b, 369–419 c)
  for (const [k, K] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) {
    const g = `Osc ${K}`, gs = `Osc ${K} Sample`, gg = `Osc ${K} Granular`, gp = `Osc ${K} Spectral`, gm = `Osc ${K} Multisample`;
    add(`${k}.w1`, `Osc ${K} Warp 1 Mode`, 'enum', 0, 81, 0, 'enum:WARPS2', 'V', 0, g);
    add(`${k}.w2`, `Osc ${K} Warp 2 Mode`, 'enum', 0, 81, 0, 'enum:WARPS2', 'V', 0, g);
    add(`${k}.warp2`, `Osc ${K} Warp 2`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
    add(`${k}.wvar1`, `Osc ${K} Warp 1 Var`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
    add(`${k}.wvar2`, `Osc ${K} Warp 2 Var`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
    add(`${k}.uniwarp2`, `Osc ${K} Uni Warp 2`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, g);
    add(`${k}.ratio`, `Osc ${K} Ratio`, 'exp', 0.0625, 16, 0.5, 'ratio2', 'V', 0, g);
    add(`${k}.hz`, `Osc ${K} Hz Offset`, 'lin', -50, 50, 0.5, 'hzoff', 'V', 1, g);
    add(`${k}.sstart`, `Osc ${K} Sample Start`, 'lin', 0, 1, 0, 'smpPos', 'V*', 0, gs);
    add(`${k}.send`, `Osc ${K} Sample End`, 'lin', 0, 1, 1, 'smpPos', 'V', 0, gs);
    add(`${k}.lstart`, `Osc ${K} Loop Start`, 'lin', 0, 1, 0, 'smpPos', 'V', 0, gs);
    add(`${k}.lend`, `Osc ${K} Loop End`, 'lin', 0, 1, 1, 'smpPos', 'V', 0, gs);
    add(`${k}.xfade`, `Osc ${K} Loop X-Fade`, 'lin', 0, 1, 0, 'pct', 'V', 0, gs);
    add(`${k}.scan`, `Osc ${K} Scan`, 'lin', -1, 1, 0.75, 'scan', 'V', 1, gs);
    add(`${k}.scanrev`, `Osc ${K} Scan Reverse`, 'bool', 0, 1, 0, 'bool', 'V', 0, gs);
    add(`${k}.pos`, `Osc ${K} Position`, 'lin', 0, 1, 0, 'smpPos', 'V', 0, gs);
    add(`${k}.slice`, `Osc ${K} Single Slice`, 'int', 0, 255, 0, 'slice', 'V*', 0, gs);
    add(`${k}.gy`, `Osc ${K} X|Y Y`, 'lin', 0, 1, 0.5, 'pct', 'V', 0, gg);
    add(`${k}.dens`, `Osc ${K} Density`, 'lin', 0, 1, 0.6, 'dens', 'V', 0, gg);
    add(`${k}.glen`, `Osc ${K} Grain Length`, 'lin', 0, 1, 0.5, 'glen', 'V', 0, gg);
    add(`${k}.wamt`, `Osc ${K} Window Amount`, 'lin', 0, 1, 1, 'pct', 'V', 0, gg);
    add(`${k}.wskew`, `Osc ${K} Window Skew`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, gg);
    for (const [id, lb, hi, fmt] of [['roff', 'Rand Offset', 1, 'pct'], ['rdir', 'Rand Dir', 1, 'pct'], ['rpitch', 'Rand Pitch', 12, 'st2'],
      ['rlen', 'Rand Length', 1, 'pct'], ['rpan', 'Rand Pan', 1, 'pct'], ['rlvl', 'Rand Level', 1, 'pct'], ['rwamt', 'Rand Window', 1, 'pct'],
      ['rwskew', 'Rand Skew', 1, 'pct'], ['rwarp', 'Rand Warp', 1, 'pct'], ['rwarp2', 'Rand Warp 2', 1, 'pct']]) {
      add(`${k}.${id}`, `Osc ${K} ${lb}`, 'lin', 0, hi, 0, fmt, 'V', 0, gg);
    }
    add(`${k}.grev`, `Osc ${K} Reverse Grains`, 'bool', 0, 1, 0, 'bool', 'V', 0, gg);
    add(`${k}.flo`, `Osc ${K} Freq Lo`, 'exp', MIDI0, 22050, 0, 'hz', 'V', 0, gp);
    add(`${k}.fhi`, `Osc ${K} Freq Hi`, 'exp', MIDI0, 22050, 1, 'hz', 'V', 0, gp);
    add(`${k}.cut`, `Osc ${K} Spectral Cut`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, gp);
    add(`${k}.smix`, `Osc ${K} Spectral Mix`, 'lin', 0, 1, 1, 'pct', 'V', 0, gp);
    for (const [id, lb, law, hi, def, fmt] of [['mdly', 'MS Delay', 'pow5', 32, 0, 'time'], ['matt', 'MS Attack', 'pow5', 32, 0.11, 'time'],
      ['mhold', 'MS Hold', 'pow5', 32, 0, 'time'], ['mdec', 'MS Decay', 'pow5', 32, 0.5, 'time'], ['msus', 'MS Sustain', 'lin', 1, 1, 'pct'],
      ['mrel', 'MS Release', 'pow5', 32, 0.215, 'time']]) {
      add(`${k}.${id}`, `Osc ${K} ${lb}`, law, 0, hi, def, fmt, 'V*', 0, gm);
    }
    add(`${k}.mvel`, `Osc ${K} Vel Track`, 'lin', 0, 1, 1, 'pct', 'V*', 0, gm);
    add(`${k}.mrand`, `Osc ${K} MS Rand`, 'lin', 0, 1, 0, 'pct', 'V*', 0, gm);
    add(`${k}.timbre`, `Osc ${K} Timbre`, 'lin', -64, 64, 0.5, 'st1', 'V*', 1, gm);
    add(`${k}.ustart`, `Osc ${K} Uni Rand Start`, 'lin', 0, 1, 0, 'pct', 'V*', 0, g);
    add(`${k}.uspan`, `Osc ${K} Uni Span`, 'lin', 0, 1, 0, 'pct', 'V*', 0, g);
    add(`${k}.fbal`, `Osc ${K} Filter Balance`, 'lin', -1, 1, 0, 'fbal', 'V', 1, g);
    add(`${k}.bus1`, `Osc ${K} Bus 1`, 'pow2', 0, 1, 0, 'pct', 'V', 0, g);
    add(`${k}.bus2`, `Osc ${K} Bus 2`, 'pow2', 0, 1, 0, 'pct', 'V', 0, g);
  }
  // Sub (420–426), Noise (427–431)
  add('s.shp', 'Sub Shape', 'enum', 0, 5, 0, 'enum:SUB_SHAPES2', 'V', 0, 'Sub');
  add('s.crs', 'Sub Coarse', 'lin', -64, 64, 0.5, 'crs', 'V', 1, 'Sub');
  add('s.phase', 'Sub Phase', 'lin', 0, 360, 0, 'deg', 'V*', 0, 'Sub');
  add('s.track', 'Sub Pitch Track', 'bool', 0, 1, 1, 'bool', 'V', 0, 'Sub');
  add('s.fbal', 'Sub Filter Balance', 'lin', -1, 1, 0, 'fbal', 'V', 1, 'Sub');
  add('s.bus1', 'Sub Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Sub');
  add('s.bus2', 'Sub Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Sub');
  add('n.stereo', 'Noise Stereo', 'lin', 0, 1, 1, 'pct', 'V', 0, 'Noise');
  add('n.color', 'Noise Filter', 'lin', -1, 1, 0.5, 'bip100', 'V', 1, 'Noise');
  add('n.fbal', 'Noise Filter Balance', 'lin', -1, 1, 0, 'fbal', 'V', 1, 'Noise');
  add('n.bus1', 'Noise Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Noise');
  add('n.bus2', 'Noise Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Noise');
  // Filter 1 extensions (432–438)
  add('f.type2', 'Filter 1 Type', 'enum', 0, 107, 1 / 107, 'enum:FILTERS', 'V', 0, 'Filter');
  add('f.level', 'Filter 1 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'V', 0, 'Filter');
  add('f.routeC', 'C>Filter', 'bool', 0, 1, 1, 'bool', 'V', 0, 'Filter');
  add('f.x', 'Filter 1 X', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter');
  add('f.y', 'Filter 1 Y', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter');
  add('f.bus1', 'Filter 1 Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter');
  add('f.bus2', 'Filter 1 Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter');
  // Filter 2 (439–456)
  add('f2.on', 'Filter 2 On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Filter 2');
  add('f2.type', 'Filter 2 Type', 'enum', 0, 107, 1 / 107, 'enum:FILTERS', 'V', 0, 'Filter 2');
  add('f2.cutoff', 'Filter 2 Cutoff', 'exp', MIDI0, 22050, 0.5, 'hz', 'V', 0, 'Filter 2');
  add('f2.res', 'Filter 2 Res', 'lin', 0, 1, 0.1, 'pct', 'V', 0, 'Filter 2');
  add('f2.drive', 'Filter 2 Drive', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
  add('f2.var', 'Filter 2 Var', 'lin', 0, 1, 0, 'var', 'V', 0, 'Filter 2');
  add('f2.mix', 'Filter 2 Mix', 'lin', 0, 1, 1, 'pct', 'V', 0, 'Filter 2');
  add('f2.pan', 'Filter 2 Pan', 'lin', 0, 1, 0.5, 'fpan', 'V', 1, 'Filter 2');
  add('f2.level', 'Filter 2 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'V', 0, 'Filter 2');
  for (const [s, S] of [['A', 'A'], ['B', 'B'], ['C', 'C'], ['N', 'Noise'], ['S', 'Sub']]) add(`f2.route${s}`, `${S}>Filter 2`, 'bool', 0, 1, 1, 'bool', 'V', 0, 'Filter 2');
  add('f2.x', 'Filter 2 X', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
  add('f2.y', 'Filter 2 Y', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
  add('f2.bus1', 'Filter 2 Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
  add('f2.bus2', 'Filter 2 Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
  // ENV 4 and Start/End (457–470)
  add('e4.att', 'Env 4 Attack', 'pow5', 0, 32, 0.11, 'time', 'V*', 0, 'Env 4');
  add('e4.hold', 'Env 4 Hold', 'pow5', 0, 32, 0, 'time', 'V*', 0, 'Env 4');
  add('e4.dec', 'Env 4 Decay', 'pow5', 0, 32, 0.5, 'time', 'V*', 0, 'Env 4');
  add('e4.sus', 'Env 4 Sustain', 'lin', 0, 1, 1, 'pct', 'V*', 0, 'Env 4');
  add('e4.rel', 'Env 4 Release', 'pow5', 0, 32, 0.215, 'time', 'V*', 0, 'Env 4');
  add('e4.ca', 'Env 4 Attack Curve', 'lin', 0, 1, 0.5, 'pct', 'V*', 0, 'Env 4');
  add('e4.cd', 'Env 4 Decay Curve', 'lin', 0, 1, 0.666, 'pct', 'V*', 0, 'Env 4');
  add('e4.cr', 'Env 4 Release Curve', 'lin', 0, 1, 0.666, 'pct', 'V*', 0, 'Env 4');
  for (const e of [2, 3, 4]) {
    add(`e${e}.start`, `Env ${e} Start`, 'lin', 0, 1, 0, 'db', 'V*', 0, `Env ${e}`);   // 0 → '-inf dB' (inv B15)
    add(`e${e}.end`, `Env ${e} End`, 'lin', 0, 1, 0, 'db', 'V*', 0, `Env ${e}`);
  }
  // LFO 9, 10 and PHASE of LFO 1–10 (471–488)
  for (const l of [9, 10]) {
    const g = `LFO ${l}`;
    add(`l${l}.rate`, `LFO ${l} Rate`, 'pow4', 0, 100, 0.5, 'lfoRate', 'V*M', 0, g);
    add(`l${l}.rise`, `LFO ${l} Rise`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g);
    add(`l${l}.delay`, `LFO ${l} Delay`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g);
    add(`l${l}.smooth`, `LFO ${l} Smooth`, 'lin', 0, 1, 0, 'pct', 'V*M', 0, g);
  }
  for (let l = 1; l <= 10; l++) add(`l${l}.phase`, `LFO ${l} Phase`, 'lin', 0, 360, 0, 'deg', 'V*M', 0, `LFO ${l}`);
  // Macros as destinations (489–496) — VIRTUAL (base = s.macros[m].v)
  for (let m = 1; m <= 8; m++) add(`m${m}`, `Macro ${m}`, 'lin', 0, 1, 0, 'pct', 'G', 0, 'Macros');
  // Voice Control (497–502)
  add('vc.pan', 'VC Rand Pan', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
  add('vc.det', 'VC Rand Detune', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
  add('vc.cut', 'VC Rand Cutoff', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
  add('vc.env', 'VC Rand Envs', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
  add('vc.escale', 'VC Env Scale', 'exp', 0.25, 4, 0.5, 'vcScale', 'V*', 0, 'Voice Control');
  add('vc.lscale', 'VC LFO Scale', 'exp', 0.25, 4, 0.5, 'vcScale', 'V*M', 0, 'Voice Control');
  // Mixer processor gains (503–505)
  add('g.direct', 'Direct Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'M', 0, 'Mixer');
  add('g.bus1v', 'Bus 1 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'M', 0, 'Mixer');
  add('g.bus2v', 'Bus 2 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'M', 0, 'Mixer');
  // Arpeggiator (506–519): arp.on stored; the rest VIRTUAL (base = playing slot's n.*)
  add('arp.on', 'Arp Enable', 'bool', 0, 1, 0, 'bool', 'G', 0, 'Arp');
  add('arp.rate', 'Arp Rate', 'lin', 0, 1, 0.75, 'arpRate', 'G', 0, 'Arp');
  add('arp.shift', 'Arp Shift', 'int', -24, 24, 0.75, 'st', 'G', 1, 'Arp');
  add('arp.range', 'Arp Range', 'int', 1, 8, 0, 'int', 'G', 0, 'Arp');
  add('arp.offset', 'Arp Offset', 'int', 0, 15, 0, 'int', 'G', 0, 'Arp');
  add('arp.repeats', 'Arp Repeats', 'int', 0, 16, 0, 'inf0', 'G', 0, 'Arp');
  add('arp.gate', 'Arp Gate', 'lin', 0, 2, 0.375, 'pct1', 'G', 0, 'Arp');
  add('arp.chance', 'Arp Chance', 'lin', 0, 1, 1, 'pct', 'G', 0, 'Arp');
  add('arp.rrate', 'Arp Retrig Rate', 'enum', 0, 5, 0.4, 'enum:RRATE_LADDER', 'G', 0, 'Arp');
  add('arp.vdecay', 'Arp Velo Decay', 'lin', -1, 1, 0.5, 'bip100', 'G', 1, 'Arp');
  add('arp.vtarget', 'Arp Velo Target', 'lin', 0, 1, 0.5, 'pct', 'G', 0, 'Arp');
  add('arp.trans', 'Arp Transpose', 'int', -24, 24, 0.5, 'st', 'G', 1, 'Arp');
  add('arp.wtrans', 'Arp Wrap Transpose', 'int', 0, 24, 0.5, 'st', 'G', 0, 'Arp');
  add('arp.wrange', 'Arp Wrap Range', 'int', 0, 8, 0, 'int', 'G', 0, 'Arp');
  // Clip player (520–523): clip.on stored; the rest VIRTUAL (base = playing clip's n.*)
  add('clip.on', 'Clip Player Enable', 'bool', 0, 1, 0, 'bool', 'G', 0, 'Clip');
  add('clip.trans', 'Clip Transpose', 'int', -24, 24, 0.5, 'st', 'G', 1, 'Clip');
  add('clip.rate', 'Clip Rate', 'enum', 0, 10, 0.5, 'enum:CLIP_RATES', 'G', 0, 'Clip');
  add('clip.offset', 'Clip Offset', 'lin', 0, 1, 0, 'pct', 'G', 0, 'Clip');
  // Review round 2 appendix (524–528) — appended, never reordered
  for (const [k, K] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) {      // Sample Length to BPM RATE (inv B6 "Scan BPM Rate")
    add(`${k}.lenrate`, `Osc ${K} Scan BPM Rate`, 'enum', 0, 14, 5 / 14, 'enum:LEN_LADDER', 'V', 0, `Osc ${K} Sample`);
  }
  add('g.bu2', 'Pitch Bend Up', 'int', 0, 48, 2 / 48, 'st', 'V', 0, 'Global');          // S2 bend ranges (inv B19), outside S1 mode
  add('g.bd2', 'Pitch Bend Down', 'int', -48, 0, 46 / 48, 'st', 'V', 0, 'Global');   // labels unique vs the v1 rows
  return D;
})());

export const ND = DESTS.length;   // 529
export const NS = 148;            // v1 synth rows (kept)
export const NV1 = 248;           // end of the v1 table
export const NF1 = 100;           // v1 FX block length
export const NF = NF1;            // Phase-1 name of the v1 FX block length
export const NS2 = ND - NV1;      // 281
export const NSV = NS + NS2;      // 429: voice-vector length
const DEST_MAP = new Map(DESTS.map((d, i) => [d.id, i]));
export const DEST_INDEX = deepFreeze(DESTS.reduce((o, d, i) => { o[d.id] = i; return o; }, {}));

// §3.11.1 index mapping
const VI_OF = new Int16Array(ND), IDX_OF = new Int16Array(NSV).fill(-1);
DESTS.forEach((d, i) => {
  const v = i < NS ? i : i < NV1 || d.scope === 'M' ? -1 : i - NF1;
  VI_OF[i] = v;
  if (v >= 0) IDX_OF[v] = i;
});
const destIdx = idOrIdx => {
  if (typeof idOrIdx === 'number') return idOrIdx >= 0 && idOrIdx < ND && (idOrIdx | 0) === idOrIdx ? idOrIdx : -1;
  const i = DEST_MAP.get(idOrIdx);
  return i === undefined ? -1 : i;
};
// voice-vector index of a destination (static index or id); −1 for FX rows, scope-M rows and unknown ids
export function vi(idx) { const i = destIdx(idx); return i < 0 ? -1 : VI_OF[i]; }
// static index of voice-vector slot v; −1 for the unused slots 403–405 and out-of-range values
export function idxOfVi(v) { return Number.isInteger(v) && v >= 0 && v < NSV ? IDX_OF[v] : -1; }
// the only allowed FX test (§3.11.1): FX parameter ids (static v1 rows or dynamic fx.<inst>.<pid>) and the two FX-context gains
export function isFxId(id) { return typeof id === 'string' && (/^fx\./.test(id) || id === 'g.master' || id === 'g.bypass'); }

const constName = id => id.replace(/^fx\./, '').toUpperCase().replace(/\./g, '_');
// DIDX (v2): constant names → vi (every destination with a voice slot); FIDX: v1 FX rows → fx idx (idx − 148)
export const DIDX = deepFreeze(DESTS.reduce((o, d, i) => { if (VI_OF[i] >= 0) o[constName(d.id)] = VI_OF[i]; return o; }, {}));
export const FIDX = deepFreeze(FX_ROWS_V1.reduce((o, d, k) => { o[constName(d.id)] = k; return o; }, {}));
export const GIDX = deepFreeze({ MASTER: 0, BYPASS: 1, DIRECT: 2, BUS1V: 3, BUS2V: 4 });
export const MATRIX_ONLY = deepFreeze(['g.tune', 'g.amp', 'g.wheel', 'g.bend', 'g.bypass'].concat(Array.from({ length: 16 }, (_, b) => 'bus' + (b + 1))));
export const VIRTUAL = deepFreeze(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'arp.rate', 'arp.shift', 'arp.range', 'arp.offset', 'arp.repeats',
  'arp.gate', 'arp.chance', 'arp.rrate', 'arp.vdecay', 'arp.vtarget', 'arp.trans', 'arp.wtrans', 'arp.wrange', 'clip.trans', 'clip.rate', 'clip.offset']);
export const NOTE_ON_DESTS = deepFreeze(['a.uni', 'b.uni', 'a.phase', 'b.phase', 'a.rand', 'b.rand', 'n.phase', 'n.rand', 'c.uni', 'c.phase', 'c.rand',
  's.phase', ...['a', 'b', 'c'].flatMap(k => ['sstart', 'slice', 'mvel', 'mrand', 'timbre', 'ustart', 'uspan'].map(x => k + '.' + x))]);
// §3.11.4: base values of new states that differ from the destination defaults (applied by defaultSerum)
export const DEF2 = deepFreeze({ 'f.routeB': 1, 'f.routeN': 1, 'f.routeS': 1 });
// §2.6.4 paired fields: S1 mode reads the v1 field(s), S2 mode the counterpart(s)
// (label: the control name the GLOBAL page lists under "S1 rendition differs: …")
export const S1_PAIRS = deepFreeze([
  { id: 'aWarp', v1: ['a.warpMode'], s2: ['a.w1', 'a.wvar1'], label: 'Osc A Warp' },
  { id: 'bWarp', v1: ['b.warpMode'], s2: ['b.w1', 'b.wvar1'], label: 'Osc B Warp' },
  { id: 'subShape', v1: ['s.shape'], s2: ['s.shp'], label: 'Sub Shape' },
  { id: 'f1Type', v1: ['f.type'], s2: ['f.type2'], label: 'Filter 1 Type' },
  { id: 'bendUp', v1: ['g.bendup'], s2: ['g.bu2'], label: 'Bend Up' },
  { id: 'bendDown', v1: ['g.benddn'], s2: ['g.bd2'], label: 'Bend Down' },
  { id: 'aPhaseMem', v1: ['a.phase', 'a.rand'], s2: [], path: ['osc', 0, 'phMem'], label: 'Osc A Phase Memory' },
  { id: 'bPhaseMem', v1: ['b.phase', 'b.rand'], s2: [], path: ['osc', 1, 'phMem'], label: 'Osc B Phase Memory' },
]);
// destination pairs used by row aliasing (§2.6.4): v1 id ↔ S2 id
const ALIAS_V1 = { 'a.warpMode': 'a.w1', 'b.warpMode': 'b.w1', 's.shape': 's.shp', 'f.type': 'f.type2', 'g.bendup': 'g.bu2', 'g.benddn': 'g.bd2' };
const ALIAS_S2 = Object.keys(ALIAS_V1).reduce((o, k) => { o[ALIAS_V1[k]] = k; return o; }, {});

const STEPPED = new Uint8Array(ND);
DESTS.forEach((d, i) => { STEPPED[i] = L.gridOf(d.law, d.lo, d.hi) > 0 ? 1 : 0; });
const I_MASTER = DEST_MAP.get('g.master'), I_BYPASS = DEST_MAP.get('g.bypass');
const IS_VIRTUAL = new Uint8Array(ND);
for (const id of VIRTUAL) IS_VIRTUAL[DEST_MAP.get(id)] = 1;
// ids stored in s.p (§2.1): v1 synth ids, g.master, g.bypass, every non-virtual SYN2 id
const STORED = [];
for (let i = 0; i < ND; i++) if (i < NS || i === I_MASTER || i === I_BYPASS || (i >= NV1 && !IS_VIRTUAL[i])) STORED.push(i);
const FORCED = (() => {   // placeholders normalizeSerum always writes
  const f = { 'g.wheel': 0, 'g.bend': 0.5 };
  for (let b = 1; b <= 16; b++) f['bus' + b] = 0.5;
  return f;
})();
// dynamic FX destination ids fx.<inst>.<pid> (§3.16.4); static v1 FX ids have the same shape
const FX_DYN_RE = /^fx\.[a-z][a-z0-9]{0,11}\.[A-Za-z][A-Za-z0-9]{0,15}$/;
// a destination id a v2 matrix row, lock or MIDI map may hold: static synth ids, g.master / g.bypass, dynamic FX ids
const destIdOk = id => typeof id === 'string' && ((DEST_MAP.has(id) && !/^fx\./.test(id)) || FX_DYN_RE.test(id));
const RENAME = id => (typeof id === 'string' && own(RENAME1, id) ? RENAME1[id] : id);
const UNRENAME = Object.keys(RENAME1).reduce((o, k) => { o[RENAME1[k]] = k; return o; }, {});

/* ================================================================ §11.1 module fields */

// MODULE_FIELDS[m] = { p: [DEST ids in s.p], paths: [[key, …], …] structured paths into the state } (v2)
const groupIds = groups => DESTS.filter((d, i) => groups.indexOf(d.group) >= 0 && !IS_VIRTUAL[i] && !/^fx\./.test(d.id)).map(d => d.id);
export const MODULE_FIELDS = deepFreeze((() => {
  const M = {};
  ['A', 'B', 'C'].forEach((K, i) => {
    M['osc' + K] = { p: groupIds([`Osc ${K}`, `Osc ${K} Sample`, `Osc ${K} Granular`, `Osc ${K} Spectral`, `Osc ${K} Multisample`]), paths: [['osc', i]] };
  });
  M.noise = { p: groupIds(['Noise']), paths: [['noise']] };
  M.sub = { p: groupIds(['Sub']), paths: [['sub']] };
  M.filter = { p: groupIds(['Filter']), paths: [['filter', 0]] };
  M.filter2 = { p: groupIds(['Filter 2']), paths: [['filter', 1]] };
  for (let e = 1; e <= N_ENV; e++) M['env' + e] = { p: groupIds(['Env ' + e]), paths: [['env', e - 1]] };
  for (let l = 1; l <= N_LFO; l++) M['lfo' + l] = { p: groupIds(['LFO ' + l]), paths: [['lfo', l - 1]] };
  M.velo = { p: [], paths: [['velo']] };
  M.note = { p: [], paths: [['note']] };
  M.arp = { p: groupIds(['Arp']), paths: [['arp']] };
  M.clip = { p: groupIds(['Clip']), paths: [['clip']] };
  M.vc = { p: groupIds(['Voice Control']), paths: [['vc']] };
  M.matrix = { p: [], paths: [['matrix']] };
  return M;
})());
const MODULE_NAMES = Object.keys(MODULE_FIELDS);
const MODULE_NAMES_V1 = ['oscA', 'oscB', 'noise', 'sub', 'filter'];
// destinations of a module incl. its virtual ones (arp.*, clip.*: the §11.1 groups Arp / Clip, stored per arp slot / clip
// in n.*): rows targeting the module (copy with mods, Init Module), module locks (moduleOf, lockState, setLock,
// locks.unp). MODULE_FIELDS[m].p stays the list of ids stored in s.p.
const MODULE_DESTS = {};
for (const m of MODULE_NAMES) MODULE_DESTS[m] = new Set(MODULE_FIELDS[m].p);
for (const id of VIRTUAL) { if (/^arp\./.test(id)) MODULE_DESTS.arp.add(id); if (/^clip\./.test(id)) MODULE_DESTS.clip.add(id); }

/* ================================================================ §3.1 law evaluation (static and dynamic FX ids) */

// ---- dynamic FX ids through fx-core's fxDest, memoised per v2 FX state (UI repaints, menus and labels resolve every FX
// id of a rack; fxDest walks the whole rack several times per call). An fxDest result depends only on the processing-order
// sequence of the instances (object, id, type, variant) and an instance label also on their racks: that sequence is
// re-checked on every lookup (O(instances), no allocation), so structural edits (add / remove / move / variant, a replaced
// instance object) start a new cache, while in-place parameter edits need nothing (results reference the live instance).
// A state fx-core has to repair (fxDest answers from a repaired copy, not the live instances) is never cached.
const isFx2 = fx => isObj(fx) && Array.isArray(fx.racks);
const FXD = new WeakMap();
const FX_SPLIT = new Map(arrOf(FXC.FXTYPES).filter(T => isObj(T) && T.split > 0).map(T => [T.id, T.split]));
const SEQ_W = 5;                                       // per instance: object, id, type, variant, rack
// the instance sequence of v2 state fx in fx-core's processing order (racks 0–2, splitter branches after their splitter)
// compared with `seq` (cmp) or written into a new array; null for a malformed rack / instance / branch list or a mismatch
function fxSeq(fx, seq) {
  const out = seq || [];
  let j = 0;
  const at = (I, k) => {
    if (!isObj(I) || !isObj(I.p) || !isObj(I.sub)) return false;
    if (seq) return j + SEQ_W <= seq.length && seq[j] === I && seq[j + 1] === I.id && seq[j + 2] === I.type && seq[j + 3] === I.v && seq[j + 4] === k;
    out.push(I, I.id, I.type, I.v, k);
    return true;
  };
  for (let k = 0; k < 3; k++) {
    const R = fx.racks[k];
    if (!isObj(R) || !Array.isArray(R.mods)) return null;
    for (const I of R.mods) {
      if (!at(I, k)) return null;
      j += SEQ_W;
      const sp = FX_SPLIT.get(I.type);
      if (!sp) continue;
      if (!Array.isArray(I.br) || I.br.length !== sp || !Array.isArray(I.bb) || I.bb.length !== sp) return null;
      for (const B of I.br) {
        if (!Array.isArray(B)) return null;
        for (const c of B) { if (!at(c, k)) return null; j += SEQ_W; }
      }
    }
  }
  return seq ? (j === seq.length ? seq : null) : out;
}
function fxEntry(fx) {
  if (!isFx2(fx) || fx.v !== 2) return null;
  const E = FXD.get(fx);
  if (E && fxSeq(fx, E.seq)) return E.bad ? null : E;
  const seq = fxSeq(fx, null);
  if (!seq) { FXD.delete(fx); return null; }
  if (seq.length) {                                    // fx-core answers from the live instances (no repair)?
    const I = seq[0], tab = FXC.FXP_TAB && FXC.FXP_TAB[I.type] ? FXC.FXP_TAB[I.type][I.v] : null;
    let d = null;
    try { d = Array.isArray(tab) && tab.length ? FXC.fxDest('fx.' + I.id + '.' + tab[0].pid, fx) : null; } catch (err) { d = null; }
    if (!d || d.inst !== I) { FXD.set(fx, { seq, bad: true }); return null; }
  }
  const N = { seq, bad: false, d: new Map(), rows: new Map(), labels: new Map() };
  FXD.set(fx, N);
  return N;
}
// fxDest(id, fx) (null for anything it does not resolve; never throws), through the cache of a v2 state
function fxDestOf(id, fx, E) {
  if (typeof FXC.fxDest !== 'function' || typeof id !== 'string' || !isObj(fx)) return null;
  if (E === undefined) E = fxEntry(fx);
  if (E && E.d.has(id)) return E.d.get(id);
  let d = null;
  try { d = FXC.fxDest(id, fx); } catch (err) { d = null; }
  if (!isObj(d)) d = null;
  if (E) E.d.set(id, d);
  return d;
}
// instance label (fx-core instLabel) of instance `iid`, cached like fxDest; '' when unknown
function fxLabelOf(fx, iid) {
  if (typeof FXC.instLabel !== 'function') return '';
  const E = fxEntry(fx);
  if (E && E.labels.has(iid)) return E.labels.get(iid);
  let t = '';
  try { t = FXC.instLabel(fx, iid) || ''; } catch (err) { t = ''; }
  if (E) E.labels.set(iid, t);
  return t;
}
// Row of a dynamic FX destination through fx-core's fxDest: {…row, id, nomod, flat} (frozen, cached per state), or null
function fxRow(id, fx) {
  if (typeof FXC.fxDest !== 'function' || !isObj(fx) || typeof id !== 'string' || !FX_DYN_RE.test(id)) return null;
  const E = fxEntry(fx);
  if (E && E.rows.has(id)) return E.rows.get(id);
  const r = fxDestOf(id, fx, E);
  const row = r && isObj(r.row) ? Object.freeze(Object.assign({}, r.row, { id, nomod: !!r.nomod, flat: r.flat })) : null;
  if (E) E.rows.set(id, row);
  return row;
}
// a static DEST row, else a dynamic FX row (with an FX state), else null
// (B26, §3.11.1: with a v2 FX state every fx.* id resolves only through fxDest — e.g. fx.dist.mode of an S2 instance has 18
// modes, the static v1 row 16; the static rows serve v1 FX states and callers without an FX state)
function rowOf(id, fx) {
  if (typeof id === 'string' && isFx2(fx) && /^fx\./.test(id)) return fxRow(id, fx);
  const i = destIdx(id);
  if (i >= 0) return DESTS[i];
  return typeof id === 'string' ? fxRow(id, fx) : null;
}
// the parameter pid of the same FX instance as FX id `id` (fx.<inst>.<x> → fx.<inst>.<pid>)
const sibling = (id, pid) => String(id).replace(/\.[^.]+$/, '.' + pid);
// the instance of a dynamic FX id in a v2 FX state, or null
function fxInst(id, fx) {
  if (!isFx2(fx)) return null;
  const d = fxDestOf(id, fx);
  return d && isObj(d.inst) ? d.inst : null;
}

// Engine value of DEST (id or index; dynamic FX ids with `fx`) at normalised n (clamped to [0, 1]); unknown dest → n
export function lawValue(idOrIdx, n, fx) {
  const r = rowOf(idOrIdx, fx), x = clamp01(n);
  return r ? L.lawValue(r.law, r.lo, r.hi, x) : x;
}

// Normalised n of engine value v (clamped to the law's value range); unknown dest → v
export function lawNorm(idOrIdx, v, fx) {
  const r = rowOf(idOrIdx, fx);
  if (!r) return v;
  return L.lawNorm(r.law, r.lo, r.hi, v, r.def);
}

// Snap n to the grid of a stepped law (k/(hi − lo) exactly); continuous laws unchanged
function snapN(i, n) {
  if (!STEPPED[i]) return n;
  const m = DESTS[i].hi - DESTS[i].lo;
  return Math.round(n * m) / m;
}

/* ================================================================ §3.2 display formats (through laws.js) */

const ENUM_LISTS = { UNI_STACKS, WARPS, WARPS2, SUB_SHAPES, SUB_SHAPES2, FILTERS, DIST_MODES, DIST_FILTER, DLY_MODES, EQ_TYPES_L, EQ_TYPES_H,
  LEN_LADDER, RRATE_LADDER, CLIP_RATES };
const listOf = name => (own(ENUM_LISTS, name) ? ENUM_LISTS[name] : Array.isArray(FXC[name]) ? FXC[name] : null);
const OSC_K = { a: 0, b: 1, c: 2 };
const oscOfId = id => (typeof id === 'string' && /^[abc]\./.test(id) ? OSC_K[id.charAt(0)] : -1);

// Base n of any DEST: synth ids (and g.master / g.bypass, which live in s.p) from s.p, FX ids from the FX state (v1:
// fx.p, Hyper's Dimension rows under their v1 ids; v2: the instance through fx-core), virtual macros from s.macros,
// else the destination default (§5.8). Unknown id → 0.
export function destBase(s, fx, id) {
  if (typeof id !== 'string') { const i = destIdx(id); if (i < 0) return 0; id = DESTS[i].id; }
  if (isFxId(id) && id !== 'g.master' && id !== 'g.bypass') {
    if (isObj(fx) && isObj(fx.p)) {                    // v1 FX state
      const sid = own(UNRENAME, id) ? UNRENAME[id] : id, i = destIdx(sid), v = fx.p[sid];
      if (i >= 0) return fin(v) ? clamp01(v) + 0 : DESTS[i].def;
    }
    const d = FX_DYN_RE.test(id) ? fxDestOf(id, fx) : null;
    if (d && isObj(d.row)) {
      const v = isObj(d.inst) && isObj(d.inst.p) ? d.inst.p[d.pid] : undefined;
      return fin(v) ? clamp01(v) + 0 : fin(d.row.def) ? d.row.def : 0;
    }
    const i = destIdx(id);
    return i >= 0 ? DESTS[i].def : 0;
  }
  const i = destIdx(id);
  if (i < 0) return 0;
  const d = DESTS[i];
  if (/^m[1-8]$/.test(id)) { const M = isObj(s) ? arrOf(s.macros)[+id.charAt(1) - 1] : null; return isObj(M) && fin(M.v) ? clamp01(M.v) + 0 : d.def; }
  if (IS_VIRTUAL[i]) {
    const N = seqN(s, id);
    if (N && fin(N.n[N.key])) return clamp01(N.n[N.key]) + 0;
    return N && N.key === 'hz' ? SQ.ARP_N.hz : d.def;
  }
  const v = isObj(s) && isObj(s.p) ? s.p[id] : undefined;
  return fin(v) ? clamp01(v) + 0 : d.def;
}
// virtual sequencer destination arp.* / clip.* (§3.11.3) → {n: the selected slot's / clip's n object, key, list, keyOf}
// or null. arp.rate is n.rate in BPM mode and n.hz in HZ mode (slot.bpm = 0: the sequencer then reads n.hz, §2.4.1,
// §4.4; RULINGS2 C1/U1), per slot: keyOf(slot) is the key of any slot of the list (EDIT ALL)
const arpKey = (X, k) => (k === 'rate' && isObj(X) && bit(X.bpm, 1) === 0 ? 'hz' : k);
function seqN(s, id) {
  const q = /^(arp|clip)\.(\w+)$/.exec(id), A = q && isObj(s) ? s[q[1]] : null;
  if (!isObj(A)) return null;
  const arp = q[1] === 'arp', list = arrOf(arp ? A.slots : A.clips), X = list[intIn(A.sel, 0, 0, list.length - 1)];
  const keyOf = Y => (arp ? arpKey(Y, q[2]) : q[2]);
  return isObj(X) && isObj(X.n) ? { n: X.n, key: keyOf(X), list, keyOf } : null;
}
const ctxN = (ctx, id) => destBase(ctx && ctx.s, ctx && ctx.fx, id);
const lfoOf = (ctx, l) => (ctx && isObj(ctx.s) && Array.isArray(ctx.s.lfo) && isObj(ctx.s.lfo[l]) ? ctx.s.lfo[l] : null);
const lfoSw = (ctx, l, k, d) => { const o = lfoOf(ctx, l); return o && o[k] !== undefined ? !!o[k] : !!d; };
const oscOf = (ctx, o) => (ctx && isObj(ctx.s) && Array.isArray(ctx.s.osc) && isObj(ctx.s.osc[o]) ? ctx.s.osc[o] : null);
const smpoOf = (ctx, o) => { const O = oscOf(ctx, o); return O && isObj(O.smpo) ? O.smpo : {}; };
// S1 mode of the state in ctx: a v2 state's global.s1; a v1 state (no s1 field) or no state: S1 (Phase-1 behaviour)
const s1Of = ctx => {
  const g = ctx && isObj(ctx.s) && isObj(ctx.s.global) ? ctx.s.global : null;
  return !g || g.s1 === undefined ? true : !!bit(g.s1, 0);
};

// Format context of row r (id) for laws.fmtCore / parseCore (§3.2), resolved from the caller's ctx {s, fx, bpm, frames,
// interp, eff, smpLen}
function fmtCtx(r, id, ctx) {
  const c = { bpm: ctx && fin(ctx.bpm) && ctx.bpm > 0 ? ctx.bpm : 120, law: r.law, lo: r.lo, hi: r.hi };
  const fmt = r.fmt, o = oscOfId(id);
  if (fmt.slice(0, 5) === 'enum:') {
    const name = fmt.slice(5);
    c.list = listOf(name);
    c.nameIdx = name === 'WARPS' ? (id === 'b.warpMode' ? 1 : 0) : name === 'WARPS2' ? Math.max(0, o) : 0;
    return c;
  }
  switch (fmt) {
    case 'frame': {
      const k = Math.max(0, o);
      c.F = ctx && ctx.frames && fin(ctx.frames[k]) && ctx.frames[k] >= 1 ? Math.round(ctx.frames[k]) : 256;
      c.discrete = !!ctx && !!ctx.interp && (ctx.interp[k] === 0 || ctx.interp[k] === false);
      break;
    }
    case 'phase': c.mem = (o === 0 || o === 1) && s1Of(ctx); break;
    case 'cmpAtt': {      // the instance's ratio (snapshot eff: static v1 ids only)
      const rid = sibling(id, 'ratio'), ri = isFx2(ctx && ctx.fx) ? undefined : DEST_MAP.get(rid);
      c.limit = (ri !== undefined && ctx && ctx.eff && fin(ctx.eff[ri]) ? ctx.eff[ri] : ctxN(ctx, rid)) >= 0.9825;
      break;
    }
    case 'var': {
      const ty = filterTypeId(id, ctx && ctx.s), f = FILTERS[lawValue(ty, ctxN(ctx, ty), ctx && ctx.fx)];
      c.eq = !!f && f.family === 'eq';
      break;
    }
    case 'npitch': c.key = !!(ctx && isObj(ctx.s) && isObj(ctx.s.noise) && bit(ctx.s.noise.keytrack, 0)); break;
    case 'lfoRate': case 'lfoTime': {
      const m = /^l(\d+)\./.exec(id), l = m ? +m[1] - 1 : 0;
      c.sync = lfoSw(ctx, l, 'bpm', 1);
      c.ladder = lfoLadder(lfoSw(ctx, l, 'dot', 0), lfoSw(ctx, l, 'trip', 0));
      if (!c.sync && lfoSw(ctx, l, 'x10', 0)) c.mul = 10;
      break;
    }
    case 'chaosRate': c.sync = ctxN(ctx, id.slice(0, 2) + '.bpm') >= 0.5; c.ladder = LFO_LADDER; break;
    case 'modRate': c.sync = ctxN(ctx, id.replace(/\.rate$/, '.bpm')) >= 0.5; c.ladder = MODFX_LADDER; break;
    case 'dlyTime': c.sync = ctxN(ctx, sibling(id, 'bpm')) >= 0.5; c.ladder = DLY_LADDER; break;
    case 'revT': c.plate = revType(id, ctx && ctx.fx) === 0; break;
    case 'time': {      // BPM units (§6.14, §6.8): ENV 1–4 A/H/D/R with env[e].bpm, MS Delay with msmo.dlyBpm → ENV_LADDER labels
      const m = /^e([1-4])\.(att|hold|dec|rel)$/.exec(id), S = ctx && isObj(ctx.s) ? ctx.s : null;
      const E = m && S && Array.isArray(S.env) ? S.env[+m[1] - 1] : null, O = /^[abc]\.mdly$/.test(id) ? oscOf(ctx, o) : null;
      if ((isObj(E) && bit(E.bpm, 0)) || (O && isObj(O.msmo) && bit(O.msmo.dlyBpm, 0))) { c.sync = true; c.ladder = ENV_LADDER; }
      break;
    }
    case 'smpPos': { const Ls = ctx && Array.isArray(ctx.smpLen) ? ctx.smpLen[Math.max(0, o)] : 0; if (fin(Ls) && Ls > 0) c.len = Ls; break; }
    case 'scan': c.R = SCAN_RANGES[intIn(smpoOf(ctx, Math.max(0, o)).scanRange, 0, 0, 2)]; break;
    case 'vcScale': if (id === 'vc.lscale' && ctx && isObj(ctx.s) && isObj(ctx.s.vc) && bit(ctx.s.vc.lmode, 0)) c.rates = VC_RATES; break;
    case 'dens': case 'glen': {
      const g = objOf(smpoOf(ctx, Math.max(0, o))[fmt]);
      c.mode = intIn(g.mode, 0, 0, 2);
      c.ladder = gridLadder(bit(g.dot, 0), bit(g.trip, 0));
      break;
    }
    case 'arpRate': {
      const A = ctx && isObj(ctx.s) && isObj(ctx.s.arp) ? ctx.s.arp : null, sl = A ? objOf(arrOf(A.slots)[intIn(A.sel, 0, 0, 11)]) : {};
      c.sync = !!bit(sl.bpm, 1);
      c.ladder = arpLadder(bit(sl.dot, 0), bit(sl.trip, 0));
      break;
    }
    default: break;
  }
  return c;
}
// format code actually used: SEM in Harmonics / Step pitch mode shows ×h / n steps (§3.2 semiH)
function fmtOf(r, id, ctx) {
  if (r.fmt === 'st' && /^[abc]\.semi$/.test(id)) {
    const O = oscOf(ctx, oscOfId(id)), m = O && isObj(O.pitch) ? O.pitch.mode : 'semi';
    if (m === 'harm' || m === 'step') return 'semiH';
  }
  return r.fmt;
}

// Display text of DEST `id` at normalised n (§3.2). ctx = { s, fx, bpm, frames, interp, eff?, smpLen? } (all optional;
// eff = snapshot eff vector, used for the Limit look-ahead display; smpLen = [A, B, C] sample lengths in seconds for the
// time display of the sample markers). Envelope A/H/D/R in BPM units (env[e].bpm) and the multisample delay with
// msmo.dlyBpm show ENV_LADDER labels (§6.14, §6.8). Never throws; unknown id → String(n).
export function fmtParam(id, n, ctx) {
  try {
    const r = rowOf(id, ctx && ctx.fx);
    if (!r) return String(n);
    const x = clamp01(n), c = fmtCtx(r, String(r.id), ctx || null), f = fmtOf(r, String(r.id), ctx || null);
    if (f === 'semiH') c.pmode = oscOf(ctx, oscOfId(r.id)).pitch.mode;
    return L.fmtCore(f, L.lawValue(r.law, r.lo, r.hi, x), x, c);
  } catch (err) {
    return String(n);
  }
}

// Typed entry (§8.1): accepts what fmtParam prints plus comma decimals, case-insensitive units, bare numbers in display
// units (time: the unit the control shows at its current base, s or ms), beat divisions for time dests, ladder labels
// for synced rates/times, enum labels (exact or unique prefix). Returns the clamped (stepped: grid-snapped) n, or null.
// Never throws.
export function parseParam(id, text, ctx) {
  try {
    if (typeof id !== 'string' && typeof id !== 'number') return null;
    const r = rowOf(id, ctx && ctx.fx);
    if (!r || (typeof text !== 'string' && typeof text !== 'number')) return null;
    const rid = String(r.id), c = fmtCtx(r, rid, ctx || null), f = fmtOf(r, rid, ctx || null);
    if (f === 'semiH') c.pmode = oscOf(ctx, oscOfId(rid)).pitch.mode;
    c.base = destBase(ctx && ctx.s, ctx && ctx.fx, rid);
    return L.parseCore(f, text, c);
  } catch (err) {
    return null;
  }
}

/* ================================================================ small DEST helpers (§8.1, §11.1) */

export function isCenter(id, fx) { const r = rowOf(id, fx); return !!r && r.ctr === 1; }
export function varLabel(type) { const f = FILTERS[type]; return f ? f.varLabel : ''; }

// Label for menus/tooltips; filter Var follows the current type, reverb slots follow the reverb type
// (dynamic FX ids of a v2 FX state: '<instance label> <parameter label>', fx-core instLabel)
export function destLabel(id, s, fx) {
  const r = rowOf(id, fx);
  if (!r) return String(id);
  const rid = String(r.id), inst = /^fx\./.test(rid) ? fxInst(rid, fx) : null;
  let lab = String(r.label);
  if (rid === 'f.var' || rid === 'f2.var' || (/^fx\./.test(rid) && /\.var$/.test(rid))) {
    const ty = filterTypeId(rid, s);
    lab = varLabel(lawValue(ty, destBase(s, fx, ty), fx)) || lab;
  } else if (inst ? inst.type === 'rev' : rid.slice(0, 7) === 'fx.rev.') {
    const slot = REV_SLOTS.indexOf(rid.slice(rid.lastIndexOf('.') + 1)), t = revType(rid, fx);
    if (slot >= 0 && t >= 0 && (!inst || inst.v === 1)) lab = REV_LABELS[t][slot];
  }
  if (inst && typeof FXC.instLabel === 'function') return fxLabelOf(fx, inst.id) + ' ' + lab;
  return lab;
}
const REV_SLOTS = ['size', 't', 'locut', 'c', 'hicut', 'w', 'mix'];
// the type destination a filter Var follows: Filter 1 (f.type in S1 mode, else f.type2), Filter 2, an FX filter instance
function filterTypeId(id, s) {
  if (id === 'f.var') return s1Of({ s }) ? 'f.type' : 'f.type2';
  return id === 'f2.var' ? 'f2.type' : sibling(id, 'type');
}
// S1 reverb type (0 Plate, 1 Hall) of reverb id `id`: the instance's sub.type (v2 FX state, S1 variant; −1 for an S2
// instance or an unknown id), else fx.rev.type of a v1 FX state (Phase 1: anything but Plate, incl. no FX state, is Hall)
function revType(id, fx) {
  if (isFx2(fx)) {
    const inst = fxInst(id, fx), t = inst && inst.v === 1 && isObj(inst.sub) ? inst.sub.type : undefined;
    return fin(t) ? (t < 0.5 ? 0 : 1) : -1;
  }
  return isObj(fx) && isObj(fx.rev) && fin(fx.rev.type) && fx.rev.type < 0.5 ? 0 : 1;
}

// Matrix "12st" typing (§8.1): amount for `st` semitones on a semitone-linear destination, else null
const SEMI_UNITS = { 'a.semi': 1, 'b.semi': 1, 'c.semi': 1, 'a.crs': 1, 'b.crs': 1, 'c.crs': 1, 's.crs': 1, 'g.tune': 1, 'g.bendup': 1,
  'g.benddn': 1, 'g.bu2': 1, 'g.bd2': 1, 'a.oct': 12, 'b.oct': 12, 'c.oct': 12, 's.oct': 12, 'a.fine': 0.01, 'b.fine': 0.01, 'c.fine': 0.01 };
export function semitoneAmount(dst, st, bi) {
  if (!own(SEMI_UNITS, dst) || !fin(st)) return null;
  const i = DEST_MAP.get(dst);
  return clamp((st / SEMI_UNITS[dst]) / (DESTS[i].hi - DESTS[i].lo) * (bi ? 2 : 1), -1, 1);
}

// MIDI learn value (§8.1): macros and continuous dests cc/127, stepped dests grid-exact; unknown → null. Dynamic FX ids:
// grid-exact through their row when the FX state is given (fx, optional), else cc/127.
export function midiValue(id, cc, fx) {
  const n = clamp01(cc / 127);
  if (/^macro[1-8]$/.test(id)) return n;
  if (isFx2(fx) && typeof id === 'string' && /^fx\./.test(id)) {
    const r = fxRow(id, fx);
    return r ? L.snapN(r.law, r.lo, r.hi, n) + 0 : null;
  }
  const i = destIdx(id);
  if (i < 0) return FX_DYN_RE.test(String(id)) ? n : null;
  return STEPPED[i] ? lawNorm(i, lawValue(i, n)) : n;
}

/* ================================================================ §2 state: defaults */

const memSetDefault = off => Array.from({ length: 16 }, (_, i) => Math.round(frac(off + 0.6180339887 * i) * 1e6) / 1e6 % 1);
export const MEMSET_DEFAULT_A = deepFreeze(memSetDefault(0.137));
export const MEMSET_DEFAULT_B = deepFreeze(memSetDefault(0.511));
export const MEMSET_DEFAULT_C = deepFreeze(memSetDefault(0.829));
const MEMSETS = [MEMSET_DEFAULT_A, MEMSET_DEFAULT_B, MEMSET_DEFAULT_C];

const DIAG = [[0, 0, 0], [1, 1, 0]];
const LFO_PTS_DEFAULT = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];          // TRIANGLE
export const PZ_DEFAULT = deepFreeze([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1]]);
export const PATH_DEFAULT = deepFreeze([[0.5, 1, 0], [1, 0.5, 0], [0.5, 0, 0], [0, 0.5, 0], [0.5, 1, 0]]);
const SPEC_FLAT = [[0, 1, 0], [1, 1, 0]];
const clonePts = pts => pts.map(p => p.slice());
// The default oscillator table of v2 states (§2.1, B3): 'factory:Default Shapes', a 9-frame table whose frame 0 is the
// Phase-1 'factory:Default' saw (§10.5), so WT POS and its modulation move on an Init sound. v1 states keep their tables
// (migrate1: OSC A/B as stored, OSC C 'factory:Default', §2.6.2).
const DEFAULT_WT = 'factory:Default Shapes';

/* ---- v1 (Phase 1, verbatim): defaults and normalisation of v1 states (normalizeV1, factory recipes) */
const emptyRowV1 = () => ({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 });
const defLfoV1 = () => ({ mode: 'off', bpm: 1, dot: 0, trip: 0, anchor: 1, pts: clonePts(LFO_PTS_DEFAULT), loop: -1, start: 0 });
const UI_PAGES_V1 = ['osc', 'fx', 'matrix', 'global'];
const LFO_MODES_V1 = ['trig', 'env', 'off'];
function defaultPV1() {
  const p = {};
  for (let i = 0; i < NS; i++) p[DESTS[i].id] = DESTS[i].def;
  p['g.master'] = DESTS[I_MASTER].def;
  p['g.bypass'] = DESTS[I_BYPASS].def;
  return p;
}
function defaultV1() {
  return {
    v: 1,
    author: '', notes: '',
    p: defaultPV1(),
    osc: [
      { wt: 'factory:Default', remap: clonePts(DIAG), memSet: MEMSET_DEFAULT_A.slice() },
      { wt: 'factory:Default', remap: clonePts(DIAG), memSet: MEMSET_DEFAULT_B.slice() },
    ],
    sub: { direct: 0 },
    noise: { src: 'noise:White', oneshot: 0, keytrack: 0, direct: 0 },
    filter: { keytrack: 0 },
    lfo: Array.from({ length: V1.N_LFO }, defLfoV1),
    lfoGrid: { x: 8, y: 8 },
    velo: { pts: clonePts(DIAG), porta: 0 },
    note: { pts: clonePts(DIAG), porta: 0 },
    chaos: [{ mono: 0, sh: 0 }, { mono: 0, sh: 0 }],
    macros: Array.from({ length: V1.N_MACRO }, (_, m) => ({ name: 'Macro ' + (m + 1), v: 0 })),
    matrix: Array.from({ length: V1.N_MATRIX }, emptyRowV1),
    voicing: { mono: 0, legato: 0, poly: 8, always: 0, scaled: 0, oneNote: 1 },
    global: { os: 2, a4: 440, uniRange: [2, 2], uniMode: [0, 0] },
    midi: {},
    locks: { p: [], mod: [], misc: { poly: 0, os: 0, tuning: 0 } },
    ui: { page: 'osc', env: 0, mod: 'lfo1', envLock: 1, envZoom: 1, view3d: [0, 0], wtSel: [0, 0], filtView: 0 },
  };
}

/* ---- v2 defaults (§2.1) */
const emptyRow = () => ({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
const defMap = warp => (warp ? { k: [0, 127], v: [1, 127], fold: 0, warp: 0 } : { k: [0, 127], v: [1, 127], fold: 0 });
const defSmpo = () => ({
  loop: 0, rel: 0, link: 0, exitRel: 0, loopGrains: 0, scanRange: 0, scanKey: 0, scanLock: 0, lenBpm: 0, snap: 0,
  ops: { fade: 0, norm: 0, rev: 0, trim: null },
  slice: { mode: 0, thr: 0.5, marks: [], toEnd: 0, single: 0, root: 36, sync: 0 },
  win: 0, dens: { mode: 0, trip: 0, dot: 0, jump: 1, max: 256 }, glen: { mode: 0, trip: 0, dot: 0 },
  phaseLock: 0, transients: 0, anim: 0, zoomSE: 0, wave: 0,
});
const defSpec = () => ({ filt: { kind: 'curve', pts: clonePts(SPEC_FLAT), wt: '', grid: 8 }, smooth: 0, postWarp: 0 });
const OSC_ROUTE_DEF = [0, 1, 1];
const defOsc = o => ({
  type: 'wt', wt: DEFAULT_WT, remap: clonePts(DIAG), memSet: MEMSETS[o].slice(),
  smp: '', multi: '', phMem: 'all', phLegato: 0, smoothWT: 0,
  pitch: { mode: 'semi', src: 'note' }, bendTrack: 1, fm: [0, 0], uni: { range: 2, mode: 0, spawn: 0 },
  route: OSC_ROUTE_DEF[o], env: 1, map: defMap(true),
  smpo: defSmpo(), msmo: { override: 0, dlyBpm: 0 }, spec: defSpec(), xy: { on: 0, y: 0, yMode: 0 },
});
const defFilter = () => ({ keytrack: 0, clean: 0, route: 1, env: 1, pz: clone(PZ_DEFAULT) });
const defLfo = () => ({ mode: 'retrig', mono: 0, type: 'normal', dir: 'fwd', bpm: 1, dot: 0, trip: 0, anchor: 1, x10: 0, swing: 0,
  pts: clonePts(LFO_PTS_DEFAULT), path: clone(PATH_DEFAULT), loop: -1, start: 0 });
const defVc = () => ({ name: 'Init', len: 1, steps: Array.from({ length: 8 }, () => [0, 0, 0, 0, 0, 0]), sel: [1, 1, 1, 1, 1], lmode: 0 });
const defKbd = () => SQ.defaultKbd();
// §2.4 schemas: seq-core.js (D6)
const defArp = () => SQ.defaultArp(), defClip = () => SQ.defaultClip();
const UI_PAGES = ['osc', 'mix', 'fx', 'matrix', 'arp', 'clip', 'global'];
const defUi = () => ({ page: 'osc', env: 0, mod: 'lfo1', envLock: 1, envZoom: 1, view3d: [0, 0, 0], wtSel: [0, 0, 0], filtView: [0, 0],
  osc: 0, oscTab: 0, filtTab: 0, mixFold: 0, lfoEd: 0, mtxSort: 0, kbdOpen: 1, arpEd: 0, clipZoom: [1, 1], envGrid: 0 });
const defTun = () => ({ name: '', kind: 'none', scl: '', kbm: '', tab: null });

function defaultP() {
  const p = {};
  for (const i of STORED) p[DESTS[i].id] = DESTS[i].def;
  return Object.assign(p, DEF2);
}

export function defaultSerum() {
  return {
    v: VERSION,
    author: '', notes: '', tags: [],
    p: defaultP(),
    osc: [defOsc(0), defOsc(1), defOsc(2)],
    sub: { direct: 0, route: 1, env: 1, contig: 0, map: defMap(true) },
    noise: { src: 'noise:White', oneshot: 0, keytrack: 0, direct: 0, route: 1, env: 1, map: defMap(true) },
    filter: [defFilter(), defFilter()],
    env: Array.from({ length: N_ENV }, () => ({ bpm: 0, legInv: 0, stealRe: 0 })),
    lfo: Array.from({ length: N_LFO }, defLfo),
    lfoGrid: { x: 8, y: 8 },
    velo: { pts: clonePts(DIAG), porta: 0 },
    note: { pts: clonePts(DIAG), porta: 0 },
    chaos: [{ mono: 0, sh: 0 }, { mono: 0, sh: 0 }],
    macros: Array.from({ length: N_MACRO }, (_, m) => ({ name: 'Macro ' + (m + 1), v: 0 })),
    matrix: Array.from({ length: N_MATRIX }, emptyRow),
    voicing: { mono: 0, legato: 0, poly: 8, always: 0, scaled: 0, oneNote: 1, steal: 0 },
    vc: defVc(),
    kbd: defKbd(),
    arp: defArp(),
    clip: defClip(),
    global: { os: 2, a4: 440, s1: 0, nosmooth: 0, mpe: { on: 0, bend: MPE_BEND_DEF, xyz: 0 }, tun: defTun() },
    midi: {},
    locks: { p: [], mod: [], unp: [], misc: { poly: 0, os: 0, tuning: 0 } },
    ui: defUi(),
  };
}

/* ================================================================ §2 state: normalisation */

const busOf = x => (fin(x) ? clamp(Math.round(x), 0, N_BUS) : 0);
const RAW_PTS_MAX = 65536;   // hostile input bound: entries beyond this are not even inspected
// Ids with the prefixes valid for the slot (§2.2.5). Anything else → the default id.
const tableId = (x, prefixes, d) => (typeof x === 'string' && x.length <= 256
  && prefixes.some(p => x.length > p.length && x.slice(0, p.length) === p) ? x : d);
const OSC_PREFIXES = ['factory:', 'user:'], NOISE_PREFIXES_V1 = ['noise:', 'nzuser:'];
// noise.src v2 (§2.2.2, §3.6): a sample noise (noise: / nzuser:) or exactly one of the four COLOR_NOISES ids
const noiseSrc = (x, d) => (COLOR_NOISES.some(e => e.id === x) ? x : tableId(x, NOISE_PREFIXES_V1, d));
const SMP_PREFIXES = ['fsmp:', 'smp:', 'factory:', 'user:'], MULTI_PREFIXES = ['fmsmp:', 'msmp:'];

// Repairs a graph (§2.3): drops malformed points, clamps, rounds to 5 decimals, sorts by x (stable), keeps ≤ max points
// (default MAX_PTS), forces x = 0 / 1 at the ends. lfo = true keeps bus links (mx, my). def = null: null for no points.
function normPts(raw, def, lfo, max) {
  const M = max || MAX_PTS;
  if (!Array.isArray(raw)) return def ? clonePts(def) : null;
  let out = [];
  for (let i = 0, n = Math.min(raw.length, RAW_PTS_MAX); i < n; i++) {
    const p = raw[i];
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) continue;
    const q = [r5(clamp(p[0], 0, 1)), r5(clamp(p[1], 0, 1)), fin(p[2]) ? r5(clamp(p[2], -1, 1)) : 0];
    if (lfo) { const mx = busOf(p[3]), my = busOf(p[4]); if (mx || my) q.push(mx, my); }
    out.push(q);
  }
  if (!out.length) return def ? clonePts(def) : null;
  out.sort((a, b) => a[0] - b[0]);
  if (out.length > M) out = out.slice(0, M);
  if (out.length === 1) out.push([1, out[0][1], 0]);
  const first = out[0], last = out[out.length - 1];
  first[0] = 0;
  last[0] = 1;
  for (const p of [first, last]) {
    if (p.length > 3) { p[3] = 0; if (!p[4]) p.length = 3; }
  }
  return out;
}
// LFO Path (§2.2.2): 2–480 points [x, y, c] in order (not sorted), x / y ∈ [0, 1], c ∈ [−1, 1]
function normPath(raw) {
  if (!Array.isArray(raw)) return clone(PATH_DEFAULT);
  const out = [];
  for (let i = 0, n = Math.min(raw.length, RAW_PTS_MAX); i < n && out.length < MAX_PTS; i++) {
    const p = raw[i];
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) continue;
    out.push([r5(clamp(p[0], 0, 1)), r5(clamp(p[1], 0, 1)), fin(p[2]) ? r5(clamp(p[2], -1, 1)) : 0]);
  }
  return out.length >= 2 ? out : clone(PATH_DEFAULT);
}

function normN(i, x) {
  return fin(x) ? snapN(i, clamp(x, 0, 1)) + 0 : DESTS[i].def;
}

function normRowV1(r) {
  if (!isObj(r)) return emptyRowV1();
  const src = r.src === undefined ? '' : r.src, dst = r.dst === undefined ? '' : r.dst, aux = r.aux === undefined ? '' : r.aux;
  if (typeof src !== 'string' || typeof dst !== 'string' || typeof aux !== 'string') return emptyRowV1();
  if ((src && !SRC_MAP_V1.has(src)) || (aux && !SRC_MAP_V1.has(aux)) || (dst && destIdx(dst) >= NV1) || (dst && destIdx(dst) < 0)) return emptyRowV1();
  return { src, amt: num(r.amt, 0, -1, 1), dst, bi: bit(r.bi, 0), curve: num(r.curve, 0, -1, 1), aux, inv: bit(r.inv, 0), byp: bit(r.byp, 0), out: num(r.out, 1, 0, 1) };
}

function normOs(x) {
  if (!fin(x)) return 2;
  return x < Math.SQRT2 ? 1 : x < 2 * Math.SQRT2 ? 2 : 4;
}

const isWarpFromOther = n => { const m = Math.round(22 * n); return m >= 18 && m <= 20; };

// The Phase-1 normalizeSerum, verbatim (constants pinned to the v1 table): a valid v1 state from any JSON value.
function normalizeV1(s) {
  const S = objOf(s), d = defaultV1();
  // ---- parameters
  const P = objOf(S.p), p = {};
  for (let i = 0; i < NS; i++) p[DESTS[i].id] = normN(i, P[DESTS[i].id]);
  p['g.master'] = normN(I_MASTER, P['g.master']);
  p['g.bypass'] = normN(I_BYPASS, P['g.bypass']);
  for (const k of Object.keys(FORCED)) p[k] = FORCED[k];
  if (isWarpFromOther(p['a.warpMode']) && isWarpFromOther(p['b.warpMode'])) p['b.warpMode'] = 0;   // single direction: keep A
  // ---- oscillators
  const osc = [0, 1].map(o => {
    const src = objOf(arrOf(S.osc)[o]), def = d.osc[o];
    const ms = arrOf(src.memSet), memSet = def.memSet.map((v, i) => (fin(ms[i]) ? frac(ms[i]) + 0 : v));
    return { wt: tableId(src.wt, OSC_PREFIXES, def.wt), remap: normPts(src.remap, DIAG, false), memSet };
  });
  const sub = objOf(S.sub), noise = objOf(S.noise), filter = objOf(S.filter);
  // ---- LFOs
  const lfo = Array.from({ length: V1.N_LFO }, (_, l) => {
    const Lf = objOf(arrOf(S.lfo)[l]), pts = normPts(Lf.pts, LFO_PTS_DEFAULT, true), last = pts.length - 1;
    return {
      mode: LFO_MODES_V1.indexOf(Lf.mode) >= 0 ? Lf.mode : 'off',
      bpm: bit(Lf.bpm, 1), dot: bit(Lf.dot, 0), trip: bit(Lf.trip, 0), anchor: bit(Lf.anchor, 1),
      pts,
      loop: fin(Lf.loop) && Lf.loop >= 0 ? clamp(Math.round(Lf.loop), 0, last) : -1,
      start: intIn(Lf.start, 0, 0, last),
    };
  });
  const grid = objOf(S.lfoGrid), velo = objOf(S.velo), note = objOf(S.note);
  const chaos = [0, 1].map(c => { const C = objOf(arrOf(S.chaos)[c]); return { mono: bit(C.mono, 0), sh: bit(C.sh, 0) }; });
  const macros = Array.from({ length: V1.N_MACRO }, (_, m) => {
    const M = objOf(arrOf(S.macros)[m]);
    return { name: strIn(M.name, 'Macro ' + (m + 1), 24), v: num(M.v, 0, 0, 1) };
  });
  const mx = arrOf(S.matrix), matrix = Array.from({ length: V1.N_MATRIX }, (_, r) => normRowV1(mx[r]));
  const vo = objOf(S.voicing), gl = objOf(S.global);
  const ur = arrOf(gl.uniRange), um = arrOf(gl.uniMode);
  // ---- MIDI map: cc '0'…'119' → DEST id | macro1…4
  const M = objOf(S.midi), midi = {};
  for (const k of Object.keys(M)) {
    if (!/^(0|[1-9]\d{0,2})$/.test(k) || +k > 119) continue;
    const t = M[k];
    if (typeof t === 'string' && ((destIdx(t) >= 0 && destIdx(t) < NV1) || /^macro[1-4]$/.test(t))) midi[k] = t;
  }
  // ---- locks, ui
  const lk = objOf(S.locks), misc = objOf(lk.misc), lp = [];
  for (const id of arrOf(lk.p)) if (typeof id === 'string' && destIdx(id) >= 0 && destIdx(id) < NV1 && lp.indexOf(id) < 0) lp.push(id);
  const lmod = arrOf(lk.mod), U = objOf(S.ui), v3 = arrOf(U.view3d), ws = arrOf(U.wtSel);
  return {
    v: 1,
    author: strIn(S.author, '', 64), notes: strIn(S.notes, '', 2000),
    p,
    osc,
    sub: { direct: bit(sub.direct, 0) },
    noise: { src: tableId(noise.src, NOISE_PREFIXES_V1, 'noise:White'), oneshot: bit(noise.oneshot, 0), keytrack: bit(noise.keytrack, 0), direct: bit(noise.direct, 0) },
    filter: { keytrack: bit(filter.keytrack, 0) },
    lfo,
    lfoGrid: { x: intIn(grid.x, 8, 1, 64), y: intIn(grid.y, 8, 1, 64) },
    velo: { pts: normPts(velo.pts, DIAG, false), porta: bit(velo.porta, 0) },
    note: { pts: normPts(note.pts, DIAG, false), porta: bit(note.porta, 0) },
    chaos,
    macros,
    matrix,
    voicing: { mono: bit(vo.mono, 0), legato: bit(vo.legato, 0), poly: intIn(vo.poly, 8, 1, 32), always: bit(vo.always, 0), scaled: bit(vo.scaled, 0), oneNote: bit(vo.oneNote, 1) },
    global: {
      os: normOs(gl.os),
      a4: fin(gl.a4) ? clamp(Math.round(gl.a4 * 10) / 10, 430, 450) : 440,
      uniRange: [0, 1].map(o => (fin(ur[o]) ? clamp(Math.round(ur[o] * 100) / 100, 0, 48) : 2)),
      uniMode: [0, 1].map(o => intIn(um[o], 0, 0, 4)),
    },
    midi,
    locks: { p: lp, mod: MODULE_NAMES_V1.filter(m => lmod.indexOf(m) >= 0), misc: { poly: bit(misc.poly, 0), os: bit(misc.os, 0), tuning: bit(misc.tuning, 0) } },
    ui: {
      page: UI_PAGES_V1.indexOf(U.page) >= 0 ? U.page : 'osc',
      env: intIn(U.env, 0, 0, V1.N_ENV - 1),
      mod: typeof U.mod === 'string' && U.mod && SRC_MAP_V1.has(U.mod) ? U.mod : 'lfo1',
      envLock: bit(U.envLock, 1),
      envZoom: fin(U.envZoom) && U.envZoom > 0 ? clamp(U.envZoom, 0.001, 1000) : 1,
      view3d: [bit(v3[0], 0), bit(v3[1], 0)],
      wtSel: [intIn(ws[0], 0, 0, MAX_FRAMES - 1), intIn(ws[1], 0, 0, MAX_FRAMES - 1)],
      filtView: intIn(U.filtView, 0, 0, 2),
    },
  };
}

/* ---- v1 → v2 migration (§2.6.2), exact: no audible change */

const FILTVIEW_V1 = [0, 2, 1];    // v1 ui.filtView: 0 response, 1 phase, 2 spectrum → v2 [0 response, 2 phase + FFT, 1 response + FFT]
function migrateCore(n1) {
  const s = defaultSerum();
  s.author = n1.author;
  s.notes = n1.notes;
  // ---- p: every v1 key unchanged; SYN2 ids at their destination defaults (no DEF2); S2 counterparts of the S1 pairs
  const p = {};
  for (const i of STORED) p[DESTS[i].id] = DESTS[i].def;
  Object.assign(p, n1.p);
  const n = id => n1.p[id];
  for (const k of ['a', 'b']) {
    const [w, v] = S1_TO_S2_WARP[Math.round(22 * n(k + '.warpMode'))];
    p[k + '.w1'] = w / 81;
    p[k + '.wvar1'] = v;
    p[k + '.fbal'] = 0;
  }
  p['s.shp'] = S1_TO_S2_SUB[Math.round(4 * n('s.shape'))] / 5;
  p['f.type2'] = Math.round(95 * n('f.type')) / 107;
  p['g.bu2'] = clamp(lawValue('g.bendup', n('g.bendup')), 0, 48) / 48;
  p['g.bd2'] = (clamp(lawValue('g.benddn', n('g.benddn')), -48, 0) + 48) / 48;
  p['s.fbal'] = 0;
  p['n.fbal'] = 0;
  s.p = p;
  // ---- oscillators
  for (let o = 0; o < 2; o++) {
    const O = s.osc[o], k = o ? 'b' : 'a', ph = n(k + '.phase') >= 0.9995, rd = n(k + '.rand') >= 0.9995;
    O.wt = n1.osc[o].wt;
    O.remap = clone(n1.osc[o].remap);
    O.memSet = n1.osc[o].memSet.slice();
    O.type = 'wt';
    O.uni = { range: n1.global.uniRange[o], mode: n1.global.uniMode[o], spawn: 0 };
    O.route = 0;
    O.env = 1;
    O.phMem = ph && rd ? 'voice' : ph ? 'contig' : 'all';
  }
  s.osc[2].route = 0;
  s.osc[2].wt = 'factory:Default';
  // ---- sub / noise / filters
  s.sub = Object.assign(s.sub, { route: n1.sub.direct ? 2 : 0, env: 1, direct: 0 });
  s.noise = Object.assign(s.noise, { src: n1.noise.src, oneshot: n1.noise.oneshot, keytrack: n1.noise.keytrack,
    route: n1.noise.direct ? 2 : 0, env: 1, direct: 0 });
  s.filter[0] = Object.assign(defFilter(), { keytrack: n1.filter.keytrack, route: 1, env: 1 });
  // ---- LFOs 8 → 10
  for (let l = 0; l < N_LFO; l++) {
    const Lf = defLfo();
    if (l < V1.N_LFO) {
      const A = n1.lfo[l];
      Object.assign(Lf, { mode: A.mode === 'trig' ? 'retrig' : A.mode === 'env' ? 'env' : 'free', mono: A.mode === 'off' ? 1 : 0,
        bpm: A.bpm, dot: A.dot, trip: A.trip, anchor: A.anchor, pts: clone(A.pts), loop: A.loop, start: A.start });
    } else {
      Lf.mode = 'free';
      Lf.mono = 1;
    }
    s.lfo[l] = Lf;
  }
  s.lfoGrid = clone(n1.lfoGrid);
  s.velo = clone(n1.velo);
  s.note = clone(n1.note);
  s.chaos = clone(n1.chaos);
  for (let m = 0; m < V1.N_MACRO; m++) s.macros[m] = clone(n1.macros[m]);
  // ---- matrix: slots 0–31 unchanged (+ v2 fields), FX ids renamed (RENAME1)
  for (let r = 0; r < V1.N_MATRIX; r++) s.matrix[r] = Object.assign(emptyRow(), n1.matrix[r], { dst: RENAME(n1.matrix[r].dst) });
  s.voicing = Object.assign({}, n1.voicing, { steal: 0 });
  s.global = { os: n1.global.os, a4: n1.global.a4, s1: 1, nosmooth: 0, mpe: { on: 0, bend: MPE_BEND_DEF, xyz: 0 }, tun: defTun() };
  // ---- midi, locks, ui
  s.midi = {};
  for (const k of Object.keys(n1.midi)) s.midi[k] = RENAME(n1.midi[k]);
  s.locks = { p: n1.locks.p.map(RENAME), mod: n1.locks.mod.slice(), unp: [], misc: clone(n1.locks.misc) };
  const U = n1.ui;
  Object.assign(s.ui, { page: U.page, env: U.env, mod: U.mod, envLock: U.envLock, envZoom: U.envZoom, view3d: [U.view3d[0], U.view3d[1], 0],
    wtSel: [U.wtSel[0], U.wtSel[1], 0], filtView: [FILTVIEW_V1[U.filtView] || 0, 0] });
  return s;
}

// §2.6.2: a v1 state (any JSON value, normalised as v1 first) → the equivalent normalised v2 state (S1 mode)
export function migrate1(v1) {
  return normV2(migrateCore(normalizeV1(v1)));
}

/* ---- v2 normalisation (§2.2.5) */

const pairInts = (x, lo, hi, d) => {
  const a = arrOf(x), u = intIn(a[0], d[0], lo, hi), w = intIn(a[1], d[1], lo, hi);
  return u <= w ? [u, w] : [w, u];
};
const normMap = (m, warp) => {
  const M = objOf(m), o = { k: pairInts(M.k, 0, 127, [0, 127]), v: pairInts(M.v, 1, 127, [1, 127]), fold: bit(M.fold, 0) };
  if (warp) o.warp = bit(M.warp, 0);
  return o;
};
const assetId = (x, prefixes) => tableId(x, prefixes, '');
function normSmpo(x) {
  const S = objOf(x), ops = objOf(S.ops), sl = objOf(S.slice), dn = objOf(S.dens), gn = objOf(S.glen), tr = arrOf(ops.trim);
  const trim = tr.length === 2 && fin(tr[0]) && fin(tr[1]) && clamp(tr[0], 0, 1) < clamp(tr[1], 0, 1) ? [r5(clamp(tr[0], 0, 1)), r5(clamp(tr[1], 0, 1))] : null;
  const marks = [];
  for (const m of arrOf(sl.marks).slice(0, RAW_PTS_MAX)) if (fin(m) && m > 0 && m < 1) { const q = r5(m); if (q > 0 && q < 1) marks.push(q); }
  marks.sort((a, b) => a - b);
  const um = marks.filter((m, i) => i === 0 || m !== marks[i - 1]).slice(0, 256);
  return {
    loop: intIn(S.loop, 0, 0, 4), rel: bit(S.rel, 0), link: bit(S.link, 0), exitRel: bit(S.exitRel, 0), loopGrains: bit(S.loopGrains, 0),
    scanRange: intIn(S.scanRange, 0, 0, 2), scanKey: bit(S.scanKey, 0), scanLock: bit(S.scanLock, 0), lenBpm: bit(S.lenBpm, 0),
    snap: intIn(S.snap, 0, 0, 3),
    ops: { fade: intIn(ops.fade, 0, 0, FADE_MS.length - 1), norm: bit(ops.norm, 0), rev: bit(ops.rev, 0), trim },
    slice: { mode: intIn(sl.mode, 0, 0, 2), thr: num(sl.thr, 0.5, 0, 1), marks: um, toEnd: bit(sl.toEnd, 0), single: bit(sl.single, 0),
      root: intIn(sl.root, 36, 0, 127), sync: bit(sl.sync, 0) },
    win: intIn(S.win, 0, 0, GRAIN_WINDOWS.length - 1),
    dens: { mode: intIn(dn.mode, 0, 0, 2), trip: bit(dn.trip, 0), dot: bit(dn.dot, 0), jump: bit(dn.jump, 1), max: intIn(dn.max, 256, 1, 256) },
    glen: { mode: intIn(gn.mode, 0, 0, 2), trip: bit(gn.trip, 0), dot: bit(gn.dot, 0) },
    phaseLock: bit(S.phaseLock, 0), transients: bit(S.transients, 0), anim: bit(S.anim, 0), zoomSE: bit(S.zoomSE, 0), wave: bit(S.wave, 0),
  };
}
function normSpec(x) {
  const S = objOf(x), F = objOf(S.filt);
  return {
    filt: { kind: oneOf(F.kind, ['curve', 'wt'], 'curve'), pts: normPts(F.pts, SPEC_FLAT, false, MAX_SPEC_PTS), wt: assetId(F.wt, OSC_PREFIXES),
      grid: intIn(F.grid, 8, 0, 64) },
    smooth: bit(S.smooth, 0), postWarp: bit(S.postWarp, 0),
  };
}
function normOsc(x, o) {
  const S = objOf(x), def = defOsc(o), ms = arrOf(S.memSet), pi = objOf(S.pitch), u = objOf(S.uni), fm = arrOf(S.fm), msmo = objOf(S.msmo), xy = objOf(S.xy);
  return {
    type: oneOf(S.type, OSC_TYPE_IDS, 'wt'),
    wt: tableId(S.wt, OSC_PREFIXES, def.wt),
    remap: normPts(S.remap, DIAG, false),
    memSet: def.memSet.map((v, i) => (fin(ms[i]) ? frac(ms[i]) + 0 : v)),
    smp: assetId(S.smp, SMP_PREFIXES),
    multi: assetId(S.multi, MULTI_PREFIXES),
    phMem: oneOf(S.phMem, PHASE_MEM_IDS, 'all'), phLegato: bit(S.phLegato, 0), smoothWT: bit(S.smoothWT, 0),
    pitch: { mode: oneOf(pi.mode, PITCH_MODE_IDS, 'semi'), src: oneOf(pi.src, ['note', 'A', 'B', 'C'], 'note') },
    bendTrack: bit(S.bendTrack, 1),
    fm: [intIn(fm[0], 0, 0, 2), intIn(fm[1], 0, 0, 2)],
    uni: { range: fin(u.range) ? clamp(Math.round(u.range * 100) / 100, 0, 48) : 2, mode: intIn(u.mode, 0, 0, 4), spawn: intIn(u.spawn, 0, 0, 3) },
    route: intIn(S.route, def.route, 0, 3), env: bit(S.env, 1),
    map: normMap(S.map, true),
    smpo: normSmpo(S.smpo), msmo: { override: bit(msmo.override, 0), dlyBpm: bit(msmo.dlyBpm, 0) }, spec: normSpec(S.spec),
    xy: { on: bit(xy.on, 0), y: intIn(xy.y, 0, 0, 17), yMode: intIn(xy.yMode, 0, 0, 2) },
  };
}
// Ratio sources (§2.2.5): own oscillator ⇒ note; a cycle of ratio-mode oscillators ⇒ its latest oscillator (A, B, C
// order) falls back to note
function fixRatioSources(osc) {
  const K = ['A', 'B', 'C'];
  osc.forEach((O, o) => { if (O.pitch.src === K[o]) O.pitch.src = 'note'; });
  for (let guard = 0; guard < 3; guard++) {
    const next = osc.map(O => (O.pitch.mode === 'ratio' && O.pitch.src !== 'note' ? K.indexOf(O.pitch.src) : -1));
    let broke = false;
    for (let o = 0; o < 3 && !broke; o++) {
      const seen = [o];
      for (let x = next[o]; x >= 0; x = next[x]) {
        if (x === o) { osc[Math.max(...seen)].pitch.src = 'note'; broke = true; break; }
        if (seen.indexOf(x) >= 0) break;
        seen.push(x);
      }
    }
    if (!broke) break;
  }
}
function normFilter(x) {
  const S = objOf(x), pz = arrOf(S.pz);
  return {
    keytrack: bit(S.keytrack, 0), clean: bit(S.clean, 0), route: intIn(S.route, 1, 0, 3), env: bit(S.env, 1),
    pz: PZ_DEFAULT.map((c, k) => { const q = arrOf(pz[k]); return c.map((v, j) => (fin(q[j]) ? r5(clamp(q[j], -1, 1)) : v)); }),
  };
}
function normLfo(x) {
  const S = objOf(x), pts = normPts(S.pts, LFO_PTS_DEFAULT, true), last = pts.length - 1;
  const mode = S.mode === 'trig' ? 'retrig' : S.mode === 'off' ? 'free' : oneOf(S.mode, LFO_MODE_IDS, 'retrig');
  return {
    mode, mono: S.mode === 'off' ? 1 : bit(S.mono, 0), type: oneOf(S.type, LFO_TYPE_IDS, 'normal'), dir: oneOf(S.dir, LFO_DIR_IDS, 'fwd'),
    bpm: bit(S.bpm, 1), dot: bit(S.dot, 0), trip: bit(S.trip, 0), anchor: bit(S.anchor, 1), x10: bit(S.x10, 0), swing: bit(S.swing, 0),
    pts, path: normPath(S.path),
    loop: fin(S.loop) && S.loop >= 0 ? clamp(Math.round(S.loop), 0, last) : -1,
    start: intIn(S.start, 0, 0, last),
  };
}
function normRow(r) {
  if (!isObj(r)) return emptyRow();
  const src = r.src === undefined ? '' : r.src, dst = r.dst === undefined ? '' : r.dst, aux = r.aux === undefined ? '' : r.aux;
  if (typeof src !== 'string' || typeof dst !== 'string' || typeof aux !== 'string') return emptyRow();
  if ((src && !SRC_MAP.has(src)) || (aux && !SRC_MAP.has(aux)) || (dst && !destIdOk(dst))) return emptyRow();
  const rise = num(r.rise, 0, 0, 1), slink = bit(r.slink, 0);
  return { src, amt: num(r.amt, 0, -1, 1), dst, bi: bit(r.bi, 0), curve: num(r.curve, 0, -1, 1), aux, inv: bit(r.inv, 0), byp: bit(r.byp, 0),
    out: num(r.out, 1, 0, 1), acurve: num(r.acurve, 0, -1, 1), crv: normPts(r.crv, null, false, MAX_CRV_PTS), rise,
    fall: slink ? rise : num(r.fall, 0, 0, 1), slink };
}
function normVc(x) {
  const S = objOf(x), st = arrOf(S.steps), sel = arrOf(S.sel);
  return {
    name: strIn(S.name, 'Init', 24), len: intIn(S.len, 1, 1, 8),
    steps: Array.from({ length: 8 }, (_, j) => { const q = arrOf(st[j]); return [0, 1, 2, 3, 4, 5].map(k => (fin(q[k]) ? r5(clamp(q[k], -1, 1)) : 0)); }),
    sel: [0, 1, 2, 3, 4].map(k => bit(sel[k], 1)), lmode: intIn(S.lmode, 0, 0, 1),
  };
}
// global.tun (§2.2.2, §6.18): kind 'scl' — the .scl / .kbm texts are the source of truth: when the .scl parses, tab is
// (re)computed from them (tuning.js tableFrom; memoised by text), else the stored tab is kept; kind 'tun' keeps its tab
// (the only data); a tuned kind without a 128-entry tab becomes 'none'; kind 'none' has tab null.
const TUN_TABS = new Map();
function tunTab(scl, kbm) {
  const key = scl + '\u0000' + kbm;
  let t = TUN_TABS.get(key);
  if (t === undefined) {
    const r = tuningState({ scl, kbm: kbm || undefined });
    t = r.error ? null : r.tab;
    if (TUN_TABS.size >= 8) TUN_TABS.delete(TUN_TABS.keys().next().value);
    TUN_TABS.set(key, t);
  }
  return t ? t.slice() : null;
}
function normTun(x) {
  const S = objOf(x), scl = strIn(S.scl, '', 16384), kbm = strIn(S.kbm, '', 16384);
  let kind = oneOf(S.kind, TUN_KINDS, 'none');
  let tab = Array.isArray(S.tab) && S.tab.length === 128 ? S.tab.map(v => (fin(v) ? v : null)) : null;
  if (kind === 'scl' && scl) { const t = tunTab(scl, kbm); if (t) tab = t; }
  if (kind === 'none') tab = null;
  else if (!tab) kind = 'none';
  return { name: strIn(S.name, '', 64), kind, scl, kbm, tab };
}
const lockIds = (x, max) => {
  const out = [];
  for (const id of arrOf(x)) if (destIdOk(id) && out.indexOf(id) < 0 && out.length < max) out.push(id);
  return out;
};

// v2 normalisation of a (v2-shaped) state: every field of §2.1 repaired, unknown keys dropped. Idempotent.
function normV2(s) {
  const S = objOf(s);
  // ---- parameters: stored ids only (virtual destinations are dropped); placeholders; v1 warp single-direction rule
  const P = objOf(S.p), p = {};
  for (const i of STORED) { const id = DESTS[i].id; p[id] = fin(P[id]) ? normN(i, P[id]) : own(DEF2, id) ? DEF2[id] : DESTS[i].def; }
  for (const k of Object.keys(FORCED)) p[k] = FORCED[k];
  if (isWarpFromOther(p['a.warpMode']) && isWarpFromOther(p['b.warpMode'])) p['b.warpMode'] = 0;   // single direction: keep A
  // ---- oscillators (Round-1 key smpo.lenIdx → p[k.lenrate])
  const osc = [0, 1, 2].map(o => normOsc(arrOf(S.osc)[o], o));
  fixRatioSources(osc);
  [0, 1, 2].forEach(o => {
    const li = objOf(objOf(arrOf(S.osc)[o]).smpo).lenIdx, id = 'abc'.charAt(o) + '.lenrate';
    if (fin(li)) p[id] = intIn(li, 5, 0, 14) / 14;             // Round-1 key wins (a v2 state never carries it)
  });
  const sub = objOf(S.sub), noise = objOf(S.noise), F = arrOf(S.filter);
  const filter = [normFilter(F[0]), normFilter(F[1])];
  if (filter[0].route === 0 && filter[1].route === 0) filter[1].route = 1;   // F1 ↔ F2 loop: F2 → Main
  const E = arrOf(S.env), env = Array.from({ length: N_ENV }, (_, e) => { const x = objOf(E[e]); return { bpm: bit(x.bpm, 0), legInv: bit(x.legInv, 0), stealRe: bit(x.stealRe, 0) }; });
  const lfo = Array.from({ length: N_LFO }, (_, l) => normLfo(arrOf(S.lfo)[l]));
  const grid = objOf(S.lfoGrid), velo = objOf(S.velo), note = objOf(S.note);
  const chaos = [0, 1].map(c => { const C = objOf(arrOf(S.chaos)[c]); return { mono: bit(C.mono, 0), sh: bit(C.sh, 0) }; });
  const macros = Array.from({ length: N_MACRO }, (_, m) => {
    const M = objOf(arrOf(S.macros)[m]);
    return { name: strIn(M.name, 'Macro ' + (m + 1), 24), v: num(M.v, 0, 0, 1) };
  });
  const mx = arrOf(S.matrix), matrix = Array.from({ length: N_MATRIX }, (_, r) => normRow(mx[r]));
  const vo = objOf(S.voicing), gl = objOf(S.global), mpe = objOf(gl.mpe);
  // ---- MIDI map: cc '0'…'119' → DEST id (static or dynamic FX) | macro1…8
  const M = objOf(S.midi), midi = {};
  for (const k of Object.keys(M)) {
    if (!/^(0|[1-9]\d{0,2})$/.test(k) || +k > 119) continue;
    const t = M[k];
    if (typeof t === 'string' && ((destIdOk(t) && !own(FORCED, t)) || /^macro[1-8]$/.test(t))) midi[k] = t;   // no placeholder targets
  }
  // ---- locks: unp ⊆ ids of locked modules, minus explicitly locked ids
  const lk = objOf(S.locks), misc = objOf(lk.misc), lmod = arrOf(lk.mod), mods = MODULE_NAMES.filter(m => lmod.indexOf(m) >= 0);
  const lp = lockIds(lk.p, 1024), inMods = new Set();
  for (const m of mods) for (const id of MODULE_DESTS[m]) inMods.add(id);
  const unp = lockIds(lk.unp, 128).filter(id => inMods.has(id) && lp.indexOf(id) < 0);
  // ---- ui
  const U = objOf(S.ui), v3 = arrOf(U.view3d), ws = arrOf(U.wtSel), cz = arrOf(U.clipZoom);
  const fv = Array.isArray(U.filtView) ? U.filtView : fin(U.filtView) ? [FILTVIEW_V1[intIn(U.filtView, 0, 0, 2)], 0] : [];
  const tags = [];
  for (const t of arrOf(S.tags)) if (typeof t === 'string' && t && tags.length < 16) { const q = t.slice(0, 24); if (tags.indexOf(q) < 0) tags.push(q); }
  return {
    v: VERSION,
    author: strIn(S.author, '', 64), notes: strIn(S.notes, '', 2000), tags,
    p,
    osc,
    sub: { direct: 0, route: intIn(sub.route, 1, 0, 3), env: bit(sub.env, 1), contig: bit(sub.contig, 0), map: normMap(sub.map, true) },
    noise: { src: noiseSrc(noise.src, 'noise:White'), oneshot: bit(noise.oneshot, 0), keytrack: bit(noise.keytrack, 0), direct: 0,
      route: intIn(noise.route, 1, 0, 3), env: bit(noise.env, 1), map: normMap(noise.map, true) },
    filter,
    env,
    lfo,
    lfoGrid: { x: intIn(grid.x, 8, 1, 64), y: intIn(grid.y, 8, 1, 64) },
    velo: { pts: normPts(velo.pts, DIAG, false), porta: bit(velo.porta, 0) },
    note: { pts: normPts(note.pts, DIAG, false), porta: bit(note.porta, 0) },
    chaos,
    macros,
    matrix,
    voicing: { mono: bit(vo.mono, 0), legato: bit(vo.legato, 0), poly: intIn(vo.poly, 8, 1, 32), always: bit(vo.always, 0), scaled: bit(vo.scaled, 0),
      oneNote: bit(vo.oneNote, 1), steal: intIn(vo.steal, 0, 0, 4) },
    vc: normVc(S.vc),
    kbd: SQ.normalizeKbd(S.kbd),
    arp: SQ.normalizeArp(S.arp),
    clip: SQ.normalizeClip(S.clip),
    global: {
      os: normOs(gl.os),
      a4: fin(gl.a4) ? clamp(Math.round(gl.a4 * 10) / 10, A4_RANGE[0], A4_RANGE[1]) : 440,
      s1: bit(gl.s1, 0), nosmooth: bit(gl.nosmooth, 0),
      mpe: { on: bit(mpe.on, 0), bend: intIn(mpe.bend, MPE_BEND_DEF, 1, 96), xyz: intIn(mpe.xyz, 0, 0, 3) },
      tun: normTun(gl.tun),
    },
    midi,
    locks: { p: lp, mod: mods, unp, misc: { poly: bit(misc.poly, 0), os: bit(misc.os, 0), tuning: bit(misc.tuning, 0) } },
    ui: {
      page: UI_PAGES.indexOf(U.page) >= 0 ? U.page : 'osc',
      env: intIn(U.env, 0, 0, N_ENV - 1),
      mod: typeof U.mod === 'string' && U.mod && SRC_MAP.has(U.mod) ? U.mod : 'lfo1',
      envLock: bit(U.envLock, 1),
      envZoom: fin(U.envZoom) && U.envZoom > 0 ? clamp(U.envZoom, 0.001, 1000) : 1,
      view3d: [0, 1, 2].map(k => bit(v3[k], 0)),
      wtSel: [0, 1, 2].map(k => intIn(ws[k], 0, 0, MAX_FRAMES - 1)),
      filtView: [0, 1].map(k => intIn(fv[k], 0, 0, 2)),
      osc: intIn(U.osc, 0, 0, 2), oscTab: intIn(U.oscTab, 0, 0, 2), filtTab: intIn(U.filtTab, 0, 0, 1), mixFold: bit(U.mixFold, 0),
      lfoEd: bit(U.lfoEd, 0), mtxSort: intIn(U.mtxSort, 0, 0, 2), kbdOpen: bit(U.kbdOpen, 1), arpEd: bit(U.arpEd, 0),
      clipZoom: [0, 1].map(k => (fin(cz[k]) && cz[k] > 0 ? clamp(cz[k], 1 / 16, 64) : 1)), envGrid: intIn(U.envGrid, 0, 0, 1),
    },
  };
}

// §2.6.1: a new valid v2 state from any JSON value; v1 input (s.v absent or 1) is migrated (migrate1); a non-object gives
// defaultSerum(). Idempotent; never shares objects with its input.
export function normalizeSerum(s) {
  if (!isObj(s)) return defaultSerum();
  return fin(s.v) && s.v >= 2 ? normV2(s) : migrate1(s);
}

// §2.6.4: the S1 Compatibility Mode checkbox — a new state with only global.s1 changed
export function setS1(s, on) {
  const r = normalizeSerum(s);
  r.global.s1 = on ? 1 : 0;
  return r;
}

/* ================================================================ §4.1 compiler helpers */

const FNV0 = 0x811c9dc5;
function fnv(h, v) {
  v |= 0;
  h = Math.imul(h ^ (v & 255), 16777619);
  h = Math.imul(h ^ ((v >>> 8) & 255), 16777619);
  h = Math.imul(h ^ ((v >>> 16) & 255), 16777619);
  return Math.imul(h ^ (v >>> 24), 16777619);
}
const fnvStr = s => { let h = FNV0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
// Hashes a graph and checks that it is in normalized form (§2.3): 2…max points; x numeric, non-decreasing, first 0 and
// last 1; y in [0, 1]; c absent or in [−1, 1]; mx / my absent or integers 0…16; no mx on an end point. Anything else sets
// hashBad, which makes the compiler repair the state through normalizeSerum first: a key always describes the values
// the tables are built from, so a malformed curve can never put NaN tables into the shared cache.
let hashBad = false;
const busOk = v => v === undefined || (Number.isInteger(v) && v >= 0 && v <= N_BUS);
function fnvPts(h, pts, max) {
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > (max || MAX_PTS)) { hashBad = true; return h; }
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
// LFO paths: 2…MAX_PTS points [x, y, c] in any order
function fnvPath(h, pts) {
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_PTS) { hashBad = true; return h; }
  h = fnv(h, pts.length);
  for (const p of pts) {
    const ok = Array.isArray(p) && fin(p[0]) && fin(p[1]) && (p[2] === undefined || fin(p[2]));
    const c = ok && p[2] !== undefined ? p[2] : 0;
    if (!ok || p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1 || c < -1 || c > 1) { hashBad = true; return h; }
    h = fnv(fnv(fnv(h, Math.round(p[0] * 1e5)), Math.round(p[1] * 1e5)), Math.round(c * 1e5));
  }
  return h;
}
const hex = h => (h >>> 0).toString(16).padStart(8, '0');

// Small LRU of compiled tables, keyed by content (several tracks compile alternately)
function lruGet(cache, key, build, size) {
  let v = cache.get(key);
  if (v) { cache.delete(key); cache.set(key, v); return v; }
  v = build();
  cache.set(key, v);
  if (cache.size > (size || 16)) cache.delete(cache.keys().next().value);
  return v;
}
const CT_CACHE = new Map(), PART_CACHE = new Map();

/* ---- CT v2 parts (§4.1, B13) */

const CT_PART_NAMES = deepFreeze([...Array.from({ length: N_LFO }, (_, l) => 'lfo' + l), ...Array.from({ length: N_LFO }, (_, l) => 'path' + l),
  'remap0', 'remap1', 'remap2', 'velo', 'note', ...Array.from({ length: N_MATRIX }, (_, r) => 'crv' + r), 'spec0', 'spec1', 'spec2']);
export { CT_PART_NAMES };

function lfoPart(Lf, key) {
  const pts = Lf.pts, n = pts.length, tab = new Float32Array(LFO_N + 1), P = new Float64Array(3 * n), pm = new Uint8Array(2 * n);
  let pmAny = 0;
  for (let j = 0; j <= LFO_N; j++) tab[j] = evalPts(pts, j / LFO_N);
  for (let i = 0; i < n; i++) {
    const p = pts[i], mx = p[3] || 0, my = p[4] || 0;
    P[3 * i] = p[0]; P[3 * i + 1] = p[1]; P[3 * i + 2] = p[2] || 0;
    pm[2 * i] = mx; pm[2 * i + 1] = my;
    if (mx || my) pmAny = 1;
  }
  const st = pts[Lf.start] || pts[0];
  return { key, n, tab, pts: P, pm, pmAny, start: st[0], loop: Lf.loop >= 0 && pts[Lf.loop] ? pts[Lf.loop][0] : -1 };
}
// Path LFO (§6.15.3): the polyline (x linear, y bent by the segment curvature) resampled to 1025 points at equal arc length
function pathPart(path, key) {
  const x = new Float32Array(LFO_N + 1), y = new Float32Array(LFO_N + 1);
  if (!path) return { key, x, y };
  const SUB = 32, segs = path.length - 1, M = segs * SUB + 1, px = new Float64Array(M), py = new Float64Array(M), cum = new Float64Array(M);
  let k = 0;
  for (let i = 0; i < segs; i++) {
    const a = path[i], b = path[i + 1], kk = CURVE_K * (a[2] || 0);
    for (let j = i === 0 ? 0 : 1; j <= SUB; j++) { const t = j / SUB; px[k] = a[0] + (b[0] - a[0]) * t; py[k] = a[1] + (b[1] - a[1]) * bend(t, kk); k++; }
  }
  for (let j = 1; j < M; j++) cum[j] = cum[j - 1] + Math.hypot(px[j] - px[j - 1], py[j] - py[j - 1]);
  const tot = cum[M - 1];
  if (!(tot > 0)) { x.fill(px[0]); y.fill(py[0]); return { key, x, y }; }
  let sg = 0;
  for (let j = 0; j <= LFO_N; j++) {
    const s = tot * j / LFO_N;
    while (sg < M - 2 && cum[sg + 1] < s) sg++;
    const d = cum[sg + 1] - cum[sg], u = d > 0 ? Math.min(1, Math.max(0, (s - cum[sg]) / d)) : 0;
    x[j] = px[sg] + (px[sg + 1] - px[sg]) * u;
    y[j] = py[sg] + (py[sg + 1] - py[sg]) * u;
  }
  return { key, x, y };
}
const tabPart = (pts, n, key) => ({ key, tab: pts ? renderPts(pts, n) : (() => { const t = new Float32Array(n + 1); for (let j = 0; j <= n; j++) t[j] = j / n; return t; })() });
const part = (name, key, build) => lruGet(PART_CACHE, name.replace(/\d+$/, '') + '|' + key, build, 512);

// serumT = {key, parts} of a state, memoised by content; null when a graph is malformed
function buildSerumT(s) {
  hashBad = false;
  const keys = {};
  for (let l = 0; l < N_LFO; l++) {
    const Lf = s.lfo[l], n = Array.isArray(Lf.pts) ? Lf.pts.length : 0;
    let h = fnvPts(FNV0, Lf.pts);
    // start / loop must index a point (loop may be −1); otherwise the CT would not match its key
    if (!Number.isInteger(Lf.start) || Lf.start < 0 || Lf.start >= n || !Number.isInteger(Lf.loop) || Lf.loop < -1 || Lf.loop >= n) hashBad = true;
    h = fnv(fnv(h, Lf.start), Lf.loop);
    keys['lfo' + l] = hex(h);
    keys['path' + l] = Lf.type === 'path' ? hex(fnvPath(FNV0, Lf.path)) : 'none';
  }
  for (let o = 0; o < N_OSC; o++) keys['remap' + o] = hex(fnvPts(FNV0, s.osc[o].remap));
  keys.velo = hex(fnvPts(FNV0, s.velo.pts));
  keys.note = hex(fnvPts(FNV0, s.note.pts));
  for (let r = 0; r < N_MATRIX; r++) { const c = isObj(s.matrix[r]) ? s.matrix[r].crv : null; keys['crv' + r] = c === null || c === undefined ? 'ident' : hex(fnvPts(FNV0, c, MAX_CRV_PTS)); }
  for (let o = 0; o < N_OSC; o++) keys['spec' + o] = hex(fnvPts(FNV0, s.osc[o].spec.filt.pts, MAX_SPEC_PTS));
  if (hashBad) return null;
  let cat = '';
  for (const nm of CT_PART_NAMES) cat += keys[nm];
  const key = hex(fnvStr(cat));
  return lruGet(CT_CACHE, key, () => {
    const tmp = {}, parts = {};
    for (let l = 0; l < N_LFO; l++) {
      const Lf = s.lfo[l];
      parts['lfo' + l] = part('lfo', keys['lfo' + l], () => lfoPart(Lf, keys['lfo' + l]));
      parts['path' + l] = part('path', keys['path' + l], () => pathPart(Lf.type === 'path' ? Lf.path : null, keys['path' + l]));
    }
    for (let o = 0; o < N_OSC; o++) parts['remap' + o] = part('remap', keys['remap' + o], () => tabPart(s.osc[o].remap, REMAP_N, keys['remap' + o]));
    parts.velo = part('curve', keys.velo, () => tabPart(s.velo.pts, CURVE_N, keys.velo));
    parts.note = part('curve', keys.note, () => tabPart(s.note.pts, CURVE_N, keys.note));
    for (let r = 0; r < N_MATRIX; r++) { const c = s.matrix[r].crv; parts['crv' + r] = part('crv', keys['crv' + r], () => tabPart(c || null, CRV_N, keys['crv' + r])); }
    for (let o = 0; o < N_OSC; o++) parts['spec' + o] = part('spec', keys['spec' + o], () => tabPart(s.osc[o].spec.filt.pts, SPEC_FILT_N, keys['spec' + o]));
    for (const nm of CT_PART_NAMES) tmp[nm] = parts[nm];                 // key order = CT_PART_NAMES
    return { key, parts: tmp };
  });
}

// The full CT v2 layout of §4.1 assembled from a serumT {key, parts} (reference for the DSP's part merging, tests)
export function assembleCT(serumT) {
  const P = serumT.parts, tot = Array.from({ length: N_LFO }, (_, l) => P['lfo' + l].n).reduce((a, b) => a + b, 0);
  const ct = {
    key: serumT.key, lfoTab: new Float32Array(N_LFO * (LFO_N + 1)), lfoPtsOff: new Uint16Array(N_LFO + 1), lfoPts: new Float64Array(3 * tot),
    lfoPm: new Uint8Array(2 * tot), lfoPmAny: new Uint8Array(N_LFO), lfoStart: new Float64Array(N_LFO), lfoLoop: new Float64Array(N_LFO),
    pathX: new Float32Array(N_LFO * (LFO_N + 1)), pathY: new Float32Array(N_LFO * (LFO_N + 1)), remap: new Float32Array(N_OSC * (REMAP_N + 1)),
    veloTab: P.velo.tab.slice(), noteTab: P.note.tab.slice(), crv: new Float32Array(N_MATRIX * (CRV_N + 1)),
    specFilt: new Float32Array(N_OSC * (SPEC_FILT_N + 1)),
  };
  let off = 0;
  for (let l = 0; l < N_LFO; l++) {
    const q = P['lfo' + l], w = P['path' + l];
    ct.lfoPtsOff[l] = off;
    ct.lfoTab.set(q.tab, l * (LFO_N + 1));
    ct.lfoPts.set(q.pts, 3 * off);
    ct.lfoPm.set(q.pm, 2 * off);
    ct.lfoPmAny[l] = q.pmAny;
    ct.lfoStart[l] = q.start;
    ct.lfoLoop[l] = q.loop;
    ct.pathX.set(w.x, l * (LFO_N + 1));
    ct.pathY.set(w.y, l * (LFO_N + 1));
    off += q.n;
  }
  ct.lfoPtsOff[N_LFO] = off;
  for (let o = 0; o < N_OSC; o++) { ct.remap.set(P['remap' + o].tab, o * (REMAP_N + 1)); ct.specFilt.set(P['spec' + o].tab, o * (SPEC_FILT_N + 1)); }
  for (let r = 0; r < N_MATRIX; r++) ct.crv.set(P['crv' + r].tab, r * (CRV_N + 1));
  return ct;
}

// Compiler ctx scalars (§4.1, §9.7): tempo 20–999 BPM (missing / non-positive → 120), smoothing scale 0.01–8 (missing → 1).
const ctxTempo = c => (fin(c.bpm) && c.bpm > 0 ? clamp(c.bpm, 20, 999) : 120);
const ctxSmooth = c => (fin(c.smooth) ? clamp(c.smooth, 0.01, 8) : 1);
// quality-reduction caps (§14.3): [uniMax 1–16, grainsMax 16–256, specHopMul 1|2|4, specStreams 1–64, grainsProc 64–1024]
const QR_DEF = [16, 256, 1, 32, 512], QR_KEYS = ['uniMax', 'grainsMax', 'specHopMul', 'specStreams', 'grainsProc'];
const QR_LIM = [[1, 16], [16, 256], [1, 4], [1, 64], [64, 1024]];
function ctxQr(q) {
  const out = Float64Array.from(QR_DEF);
  if (!q || typeof q !== 'object') return out;
  for (let k = 0; k < 5; k++) {
    const v = Array.isArray(q) || ArrayBuffer.isView(q) ? q[k] : q[QR_KEYS[k]];
    if (fin(v)) out[k] = k === 2 ? (v >= 3 ? 4 : v >= 1.5 ? 2 : 1) : clamp(Math.round(v), QR_LIM[k][0], QR_LIM[k][1]);
  }
  return out;
}

const CTX_OF_SCOPE = { V: 1, 'V*': 1, 'V*M': 3, G: 2, M: 4 };
const ON_DEST = new Uint8Array(ND);
for (const id of NOTE_ON_DESTS) ON_DEST[DEST_MAP.get(id)] = 1;
const FXCTX = { 'g.master': 0, 'g.bypass': 1, 'g.direct': 2, 'g.bus1v': 3, 'g.bus2v': 4 };
const SRC_BI = new Uint8Array(NSRC);
SOURCES.forEach((s, i) => { SRC_BI[i] = s.pol === 'bi' ? 1 : 0; });
const S_RANDD = SRC_MAP.get('randd'), S_MPEY = SRC_MAP.get('mpey');
const rangeOfId = id => { const d = DESTS[DEST_MAP.get(id)]; return d.hi - d.lo; };

const rowActive = r => !!r && !!r.src && !!r.dst && !r.byp && r.amt !== 0 && r.out !== 0 && fin(r.amt) && fin(r.out);

// Uint8Array(ND): 1 for every static destination targeted by an active matrix row (v2 FX ids of renamed v1 rows count
// for their v1 row)
function targetsOf(s) {
  const t = new Uint8Array(ND), mx = arrOf(s.matrix);
  for (let r = 0; r < mx.length && r < N_MATRIX; r++) {
    const row = mx[r];
    if (!rowActive(row) || !SRC_MAP.get(row.src) || (row.aux && !SRC_MAP.has(row.aux))) continue;
    const di = DEST_MAP.get(own(UNRENAME, row.dst) ? UNRENAME[row.dst] : row.dst);
    if (di !== undefined) t[di] = 1;
  }
  return t;
}

// Phase-1 API (v1 FX rack): 1 at v1 fx idx k when an active row of `s` targets v1 FX destination k (compileFx ctx.modded)
export function fxModded(s) {
  const t = targetsOf(objOf(s)), out = new Uint8Array(NF1);
  for (let k = 0; k < NF1; k++) out[k] = t[NS + k];
  return out;
}

// Cheap structural check of a v2 state before compiling (the host normalizes on entry, §4.1; anything that fails here,
// or throws while compiling, is compiled from normalizeSerum(s) instead)
const isArr = (x, n) => Array.isArray(x) && x.length === n;
function serumShapeOk(s) {
  if (!isObj(s) || s.v !== VERSION || !isObj(s.p) || !isArr(s.osc, N_OSC) || !isArr(s.lfo, N_LFO) || !isArr(s.matrix, N_MATRIX)
    || !isArr(s.macros, N_MACRO) || !isArr(s.chaos, 2) || !isArr(s.filter, 2) || !isArr(s.env, N_ENV) || !isObj(s.voicing) || !isObj(s.global)
    || !isObj(s.sub) || !isObj(s.noise) || !isObj(s.velo) || !isObj(s.note) || !isObj(s.vc) || !isObj(s.kbd) || !isObj(s.arp) || !isObj(s.clip)
    || !isObj(s.global.mpe) || !isObj(s.global.tun)) return false;
  for (let o = 0; o < N_OSC; o++) {
    const O = s.osc[o];
    if (!isObj(O) || tableId(O.wt, OSC_PREFIXES, null) === null || !isArr(O.memSet, 16) || !isObj(O.smpo) || !isObj(O.spec) || !isObj(O.spec.filt)
      || !isObj(O.pitch) || !isObj(O.uni) || !isObj(O.map) || !isObj(O.xy) || !isObj(O.msmo)) return false;
  }
  for (let l = 0; l < N_LFO; l++) if (!isObj(s.lfo[l])) return false;
  for (let m = 0; m < N_MACRO; m++) if (!isObj(s.macros[m])) return false;
  for (let r = 0; r < N_MATRIX; r++) if (!isObj(s.matrix[r])) return false;
  return isObj(s.chaos[0]) && isObj(s.chaos[1]) && isObj(s.filter[0]) && isObj(s.filter[1]) && noiseSrc(s.noise.src, null) !== null;
}

// §9.1 asset ids: entry-changing ops key (8-hex FNV-1a of the canonical JSON of the non-default trim / fade; '' when none)
export function opsKey(ops) {
  const o = objOf(ops), c = {};
  if (Array.isArray(o.trim) && o.trim.length === 2) c.trim = [o.trim[0], o.trim[1]];
  if (fin(o.fade) && o.fade > 0) c.fade = o.fade;
  return Object.keys(c).length ? hex(fnvStr(JSON.stringify(c))) : '';
}
// playback entry id of an oscillator's sample source (sample / wavetable played as a sample), '' when none
function playId(O) {
  const id = typeof O.smp === 'string' ? O.smp : '';
  if (!id) return '';
  const b = /^(factory|user):/.test(id) ? 'wtsmp:' + id : id, k = opsKey(objOf(O.smpo).ops);
  return k ? b + '~' + k : b;
}
// {wt, smp, spec, multi} asset ids an oscillator plays with its current type ('' = none)
export function oscUses(s, o) {
  const O = isObj(s) && Array.isArray(s.osc) && isObj(s.osc[o]) ? s.osc[o] : null, out = { wt: '', smp: '', spec: '', multi: '' };
  if (!O) return out;
  const t = O.type || 'wt';
  if (t === 'wt') out.wt = typeof O.wt === 'string' ? O.wt : '';
  else if (t === 'multi') out.multi = typeof O.multi === 'string' ? O.multi : '';
  else if (t === 'sample' || t === 'gran') out.smp = playId(O);
  else if (t === 'spec') { const p = playId(O); out.spec = p ? 'spec:' + p + (objOf(objOf(O.smpo).ops).rev ? '~r' : '') : ''; }
  return out;
}
export function oscTypeOf(s, o) { const O = isObj(s) && Array.isArray(s.osc) && isObj(s.osc[o]) ? s.osc[o] : null; return O && OSC_TYPE_IDS.indexOf(O.type) >= 0 ? O.type : 'wt'; }

/* ================================================================ §4.1 compileSerum */

// §4.1: normalized state → engine patch { engine: 'serum', …, needs, serum: CP v2, serumT: CT v2 parts, seq, seqT }.
// ctx = { bpm, smooth, fx, qr, ultra, mpeBendX, mpeYBi } (all optional). Never throws: a state that is not normalized is
// repaired (normalizeSerum) before compiling.
export function compileSerum(s, ctx) {
  if (serumShapeOk(s)) {
    try {
      const P = compileCore(s, ctx);
      if (P) return P;
    } catch (err) { /* malformed inner value: compile the repaired copy below */ }
  }
  return compileCore(normalizeSerum(s), ctx);
}

// Step pitch-mode data of a .scl text (tuning.js stepTable), memoised by text (the state keeps the text, §2.2.2)
const NO_STEPS = stepTable(null), STEPS = new Map();
function stepsOf(text) {
  let e = STEPS.get(text);
  if (!e) {
    e = stepTable(text);
    if (STEPS.size >= 8) STEPS.delete(STEPS.keys().next().value);
    STEPS.set(text, e);
  }
  return e;
}

// CP content key (§4.1 addition): FNV-1a 32 over every CP field except ctKey / cpKey, in field order — a graph edit changes
// only CP.ctKey and the CT parts, so a host comparing cpKey can post the changed parts alone ({t: 'ct'}, §12.4)
const KEY_F64 = new Float64Array(1), KEY_U8 = new Uint8Array(KEY_F64.buffer);
function cpKeyOf(CP) {
  let h = 0x811c9dc5;
  const byte = b => { h = Math.imul(h ^ b, 0x01000193); };
  const str = x => { for (let i = 0; i < x.length; i++) { const c = x.charCodeAt(i); byte(c & 255); byte(c >>> 8); } byte(0); };
  for (const k of Object.keys(CP)) {
    if (k === 'ctKey' || k === 'cpKey') continue;
    str(k);
    const v = CP[k];
    if (typeof v === 'number') { KEY_F64[0] = v; for (let i = 0; i < 8; i++) byte(KEY_U8[i]); }
    else if (typeof v === 'string') str(v);
    else if (Array.isArray(v)) for (const x of v) str(String(x));
    else if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function compileCore(s, ctx) {
  const serumT = buildSerumT(s);
  if (!serumT) return null;
  const c = isObj(ctx) ? ctx : {}, P = s.p, vo = s.voicing, gl = s.global, s1 = gl.s1 ? 1 : 0;
  // ---- eff bases per vi; virtual macros from s.macros, sequencer virtual bases 0 (the sequencer adds n.*, §3.11.3)
  const base = new Float64Array(NSV);
  for (const i of STORED) { const v = VI_OF[i]; if (v >= 0) { const x = P[DESTS[i].id]; base[v] = fin(x) ? clamp01(x) : DESTS[i].def; } }
  for (let m = 0; m < N_MACRO; m++) base[VI_OF[DEST_MAP.get('m' + (m + 1))]] = num(s.macros[m].v, 0, 0, 1);
  // ---- FX layout (fx-core v2, F1) for dynamic FX destinations
  let layout = null;
  if (isObj(c.fx) && typeof FXC.fxLayout === 'function' && typeof FXC.fxDest === 'function') {
    try { layout = FXC.fxLayout(c.fx); } catch (err) { layout = null; }
  }
  const fxKey = layout && typeof layout.key === 'string' ? layout.key : '', NFX = 8 + (layout && fin(layout.NP) ? layout.NP : 0);
  // ---- matrix (§4.1, §5.2)
  const NR = N_MATRIX;
  const mSrc = new Int8Array(NR), mAux = new Int8Array(NR), mDst = new Int16Array(NR), mAmt = new Float64Array(NR), mK = new Float64Array(NR);
  const mAK = new Float64Array(NR), mBi = new Uint8Array(NR), mInv = new Uint8Array(NR), mCtx = new Uint8Array(NR), mOn = new Uint8Array(NR);
  const mCrv = new Int8Array(NR), mRise = new Float64Array(NR), mFall = new Float64Array(NR), mRd = new Uint8Array(NR), mAlias = new Uint8Array(NR);
  // mSlot: matrix slot of each compacted row (sx-mod keeps randd draws, slew states and snapshot.mOut per slot, §6.2),
  // followed by the inactive slots in slot order — a permutation of 0–63, so a CP without active rows maps r → r
  const mSlot = new Uint8Array(NR), idle = [];
  const srcUsed = new Uint8Array(NSRC), modded = new Uint8Array(NSV), targeted = new Uint8Array(ND);
  let mN = 0, curved = 0;
  for (let r = 0; r < NR; r++) {
    const row = s.matrix[r];
    if (!rowActive(row)) { idle.push(r); continue; }
    const si = SRC_MAP.get(row.src), ai = row.aux ? SRC_MAP.get(row.aux) : 0;
    if (!si || ai === undefined) { idle.push(r); continue; }
    let amt = clamp(row.amt, -1, 1) * clamp(row.out, 0, 1), alias = 0, dv = -1, fk = -1, cx = 0, on = 0;
    if (own(FXCTX, row.dst)) {
      fk = FXCTX[row.dst]; cx = 4;
    } else if (isFxId(row.dst)) {                                    // dynamic FX destination (§3.16.4)
      let d = null;
      if (layout) d = fxDestOf(row.dst, c.fx);
      if (!d || d.nomod || !fin(d.flat)) { idle.push(r); continue; }
      fk = 8 + d.flat; cx = 4;
    } else {
      let id = row.dst;
      if (s1 ? own(ALIAS_S2, id) : own(ALIAS_V1, id)) {             // the other mode's field of an S1 pair (§2.6.4)
        const to = s1 ? ALIAS_S2[id] : ALIAS_V1[id];
        amt *= rangeOfId(id) / rangeOfId(to);
        id = to; alias = 1;
      }
      const di = DEST_MAP.get(id);
      if (di === undefined || VI_OF[di] < 0) { idle.push(r); continue; }
      dv = VI_OF[di]; cx = CTX_OF_SCOPE[DESTS[di].scope]; on = ON_DEST[di];
      targeted[di] = 1;
    }
    mSlot[mN] = r;
    mSrc[mN] = si;
    mAux[mN] = ai;
    mDst[mN] = fk >= 0 ? -1 - fk : dv;
    mAmt[mN] = amt;
    mK[mN] = MC_K * (fin(row.curve) ? clamp(row.curve, -1, 1) : 0) + 0;
    mAK[mN] = MC_K * (fin(row.acurve) ? clamp(row.acurve, -1, 1) : 0) + 0;
    mBi[mN] = row.bi ? 1 : 0;
    mInv[mN] = row.inv ? 1 : 0;
    mCtx[mN] = cx;
    mOn[mN] = on;
    mCrv[mN] = Array.isArray(row.crv) ? r : -1;
    mRise[mN] = SLEW_T(num(row.rise, 0, 0, 1));
    mFall[mN] = SLEW_T(num(row.fall, 0, 0, 1));
    mRd[mN] = si === S_RANDD || ai === S_RANDD ? 1 : 0;
    mAlias[mN] = alias;
    if (mCrv[mN] >= 0 || mRise[mN] > 0 || mFall[mN] > 0 || mAK[mN] !== 0) curved = 1;
    srcUsed[si] = 1;
    if (ai) srcUsed[ai] = 1;
    if (dv >= 0 && (cx & 1)) modded[dv] = 1;
    mN++;
  }
  idle.forEach((r, j) => { mSlot[mN + j] = r; });
  const possOn = id => P[id] >= 0.5 || targeted[DEST_MAP.get(id)] === 1;
  const isT = id => targeted[DEST_MAP.get(id)] === 1;
  const onO = [possOn('a.on'), possOn('b.on'), possOn('c.on')], onS = possOn('s.on'), onN = possOn('n.on');
  const onF = [possOn('f.on'), possOn('f2.on')];
  // ---- needs (§4.1)
  const needs = [];
  const need = id => { if (id && needs.indexOf(id) < 0) needs.push(id); };
  const uses = [0, 1, 2].map(o => oscUses(s, o));
  for (let o = 0; o < N_OSC; o++) if (onO[o]) { const u = uses[o]; need(u.wt); need(u.smp); need(u.spec); need(u.multi); }
  if (onS) {
    const [ids, sid] = s1 ? [SUB_IDS, 's.shape'] : [SUB_IDS2, 's.shp'];
    if (isT(sid)) ids.forEach(need);
    else need(ids[lawValue(sid, P[sid])]);
  }
  const colour = COLOR_NOISES.findIndex(e => e.id === s.noise.src);
  if (onN && colour < 0) need(s.noise.src);
  // ---- per-oscillator data
  const U8 = n => new Uint8Array(n);
  const oType = U8(3), phMem = U8(3), phLeg = U8(3), smoothWT = U8(3), pMode = U8(3), bendTrack = U8(3), uniMode = U8(3), spawn = U8(3);
  const pSrc = new Int8Array(3), uniRange = new Float64Array(3), fmType = U8(6), memSet = new Float64Array(48);
  const sLoop = U8(3), sRel = U8(3), sLink = U8(3), sExit = U8(3), sLoopGr = U8(3), sScanKey = U8(3), sScanLock = U8(3), sLenOn = U8(3), sSlMode = U8(3);
  const sSlEnd = U8(3), sSlOne = U8(3), sSlRoot = U8(3), sWin = U8(3), sDens = U8(3), sDensJump = U8(3), sGlen = U8(3), sPhLock = U8(3), sTrans = U8(3);
  const sSmooth = U8(3), sPostWarp = U8(3), sNorm = U8(3), sRev = U8(3), xyOn = U8(3), xyY = U8(3), xyMode = U8(3), msOver = U8(3), msDlyBpm = U8(3);
  const sScanR = new Float64Array(3), sMaxGr = new Uint16Array(3), sSlN = new Uint16Array(3), sSlPos = new Float64Array(3 * 258);
  const sDensLad = new Float64Array(3 * 27), sGlenLad = new Float64Array(3 * 27), sDensLadN = U8(3), sGlenLadN = U8(3);
  const lenLad = Float64Array.from(LEN_LADDER, e => e.beats);
  for (let o = 0; o < N_OSC; o++) {
    const O = s.osc[o], so = O.smpo, sl = objOf(so.slice), dn = objOf(so.dens), gn = objOf(so.glen), op = objOf(so.ops);
    oType[o] = Math.max(0, OSC_TYPE_IDS.indexOf(O.type));
    phMem[o] = Math.max(0, PHASE_MEM_IDS.indexOf(O.phMem));
    phLeg[o] = O.phLegato ? 1 : 0;
    smoothWT[o] = O.smoothWT ? 1 : 0;
    pMode[o] = Math.max(0, PITCH_MODE_IDS.indexOf(O.pitch.mode));
    pSrc[o] = ['A', 'B', 'C'].indexOf(O.pitch.src);
    bendTrack[o] = O.bendTrack ? 1 : 0;
    uniMode[o] = intIn(O.uni.mode, 0, 0, 4);
    spawn[o] = intIn(O.uni.spawn, 0, 0, 3);
    uniRange[o] = num(O.uni.range, 2, 0, 48);
    fmType[2 * o] = intIn(arrOf(O.fm)[0], 0, 0, 2);
    fmType[2 * o + 1] = intIn(arrOf(O.fm)[1], 0, 0, 2);
    for (let i = 0; i < 16; i++) { const v = O.memSet[i]; memSet[o * 16 + i] = fin(v) ? frac(v) : 0; }
    sLoop[o] = intIn(so.loop, 0, 0, 4); sRel[o] = so.rel ? 1 : 0; sLink[o] = so.link ? 1 : 0; sExit[o] = so.exitRel ? 1 : 0;
    sLoopGr[o] = so.loopGrains ? 1 : 0; sScanKey[o] = so.scanKey ? 1 : 0; sScanLock[o] = so.scanLock ? 1 : 0; sLenOn[o] = so.lenBpm ? 1 : 0;
    xyOn[o] = O.xy.on && (O.type === 'gran' || O.type === 'spec') ? 1 : 0;
    xyY[o] = intIn(O.xy.y, 0, 0, 17); xyMode[o] = intIn(O.xy.yMode, 0, 0, 2);
    sSlMode[o] = xyOn[o] ? 0 : intIn(sl.mode, 0, 0, 2);
    sSlEnd[o] = sl.toEnd ? 1 : 0; sSlOne[o] = sl.single ? 1 : 0; sSlRoot[o] = intIn(sl.root, 36, 0, 127);
    sWin[o] = intIn(so.win, 0, 0, 9); sDens[o] = intIn(dn.mode, 0, 0, 2); sDensJump[o] = bit(dn.jump, 1); sGlen[o] = intIn(gn.mode, 0, 0, 2);
    sPhLock[o] = so.phaseLock ? 1 : 0; sTrans[o] = so.transients ? 1 : 0;
    sSmooth[o] = O.spec.smooth ? 1 : 0; sPostWarp[o] = O.spec.postWarp ? 1 : 0;
    sNorm[o] = op.norm ? 1 : 0; sRev[o] = op.rev ? 1 : 0;
    msOver[o] = O.msmo.override ? 1 : 0; msDlyBpm[o] = O.msmo.dlyBpm ? 1 : 0;
    sScanR[o] = SCAN_RANGES[intIn(so.scanRange, 0, 0, 2)];
    sMaxGr[o] = intIn(dn.max, 256, 1, 256);
    const marks = arrOf(sl.marks).filter(m => fin(m) && m > 0 && m < 1).slice(0, 256);
    sSlN[o] = marks.length + 1;
    sSlPos[o * 258] = 0;
    marks.forEach((m, j) => { sSlPos[o * 258 + 1 + j] = m; });
    sSlPos[o * 258 + marks.length + 1] = 1;
    const dl = gridLadder(dn.dot, dn.trip), gl2 = gridLadder(gn.dot, gn.trip);
    sDensLadN[o] = dl.length; sGlenLadN[o] = gl2.length;
    dl.forEach((e, j) => { sDensLad[o * 27 + j] = e.beats; });
    gl2.forEach((e, j) => { sGlenLad[o * 27 + j] = e.beats; });
  }
  // ---- keyboard mapping, routing (channels A, B, C, Noise, Sub, [ARP | F1, F2])
  const chans = [s.osc[0], s.osc[1], s.osc[2], s.noise, s.sub];
  const mapLo = U8(6), mapHi = U8(6), mapVLo = U8(6), mapVHi = U8(6), mapFold = U8(6), mapWarp = U8(6);
  chans.concat([{ map: s.kbd.arpMap }]).forEach((X, k) => {
    const m = X.map;
    mapLo[k] = m.k[0]; mapHi[k] = m.k[1]; mapVLo[k] = m.v[0]; mapVHi[k] = m.v[1]; mapFold[k] = m.fold ? 1 : 0; mapWarp[k] = m.warp ? 1 : 0;
  });
  const route = U8(7), envOn = U8(7);
  chans.concat(s.filter).forEach((X, k) => { route[k] = intIn(X.route, 1, 0, 3); envOn[k] = X.env ? 1 : 0; });
  const fKey = Uint8Array.from(s.filter, f => (f.keytrack ? 1 : 0)), fClean = Uint8Array.from(s.filter, f => (f.clean ? 1 : 0));
  const pz = new Float64Array(24);
  for (let k = 0; k < 2; k++) for (let q = 0; q < 4; q++) for (let j = 0; j < 3; j++) pz[k * 12 + q * 3 + j] = s.filter[k].pz[q][j];
  // ---- envelopes, LFOs
  const envBpm = Uint8Array.from(s.env, e => (e.bpm ? 1 : 0)), envLegInv = Uint8Array.from(s.env, e => (e.legInv ? 1 : 0));
  const envStealRe = Uint8Array.from(s.env, e => (e.stealRe ? 1 : 0)), envLad = Float64Array.from(ENV_LADDER, e => e.beats);
  const lfoMode = U8(N_LFO), lfoMono = U8(N_LFO), lfoType = U8(N_LFO), lfoDir = U8(N_LFO), lfoBpm = U8(N_LFO), lfoAnchor = U8(N_LFO);
  const lfoX10 = U8(N_LFO), lfoSwing = U8(N_LFO), lfoLadN = U8(N_LFO), lfoLad = new Float64Array(N_LFO * 43);
  for (let l = 0; l < N_LFO; l++) {
    const Lf = s.lfo[l], lad = lfoLadder(Lf.dot, Lf.trip);
    lfoMode[l] = Math.max(0, LFO_MODE_IDS.indexOf(Lf.mode));
    lfoMono[l] = Lf.mono ? 1 : 0;
    lfoType[l] = Math.max(0, LFO_TYPE_IDS.indexOf(Lf.type));
    lfoDir[l] = Math.max(0, LFO_DIR_IDS.indexOf(Lf.dir));
    lfoBpm[l] = Lf.bpm ? 1 : 0;
    lfoAnchor[l] = Lf.anchor ? 1 : 0;
    lfoX10[l] = Lf.x10 ? 1 : 0;
    lfoSwing[l] = Lf.swing ? 1 : 0;
    lfoLadN[l] = lad.length;
    for (let j = 0; j < lad.length; j++) lfoLad[l * 43 + j] = lad[j].beats;
  }
  const macro = new Float64Array(N_MACRO);
  for (let m = 0; m < N_MACRO; m++) macro[m] = num(s.macros[m].v, 0, 0, 1);
  // ---- MPE (§6.17), tuning (§6.18), Voice Control (§6.16)
  const mpe = gl.mpe, mpeOn = mpe.on ? 1 : 0, mpeMac = new Int8Array(N_MACRO).fill(-1);
  if (mpeOn && mpe.xyz === 1) { mpeMac[0] = 0; mpeMac[1] = 1; mpeMac[2] = 2; }
  if (mpeOn && mpe.xyz === 2) { mpeMac[0] = 1; mpeMac[1] = 2; }
  // tuning table (§6.18): use & 512 only for a table that differs from the identity (§0.7: an exact identity table —
  // a 12-TET .scl, a .kbm that only remaps to 12-TET at 440 Hz — is the neutral term); unmapped keys (null) differ
  const tun = gl.tun, T = tun.kind !== 'none' && Array.isArray(tun.tab) && tun.tab.length === 128 ? tun.tab : null, tune = new Float64Array(128);
  let tuned = false;
  for (let k = 0; k < 128; k++) { tune[k] = T ? (fin(T[k]) ? T[k] : NaN) : k; if (tune[k] !== k) tuned = true; }
  const steps = tun.kind === 'scl' && tun.scl ? stepsOf(tun.scl) : NO_STEPS;      // Step pitch mode (§6.3.3)
  const V = s.vc, vcLen = intIn(V.len, 1, 1, 8), vcSteps = new Float64Array(48), vcSel = Uint8Array.from(V.sel, x => (x ? 1 : 0));
  let vcAny = 0;
  for (let j = 0; j < 8; j++) for (let k = 0; k < 6; k++) { const x = num(arrOf(V.steps[j])[k], 0, -1, 1); vcSteps[j * 6 + k] = x; if (x !== 0 && j < vcLen) vcAny = 1; }
  for (const id of ['vc.pan', 'vc.det', 'vc.cut', 'vc.env']) if (P[id] > 0 || isT(id)) vcAny = 1;
  for (const id of ['vidx', 'vmod1', 'vmod2']) if (srcUsed[SRC_MAP.get(id)]) vcAny = 1;
  const srcBi = SRC_BI.slice();
  if (c.mpeYBi) srcBi[S_MPEY] = 1;
  // ---- feature bits (§4.1)
  const bus = (k, j) => P[k + '.bus' + j] > 0 || isT(k + '.bus' + j);
  const sendKeys = ['a', 'b', 'c', 'n', 's', 'f', 'f2'];
  const anyBus = j => sendKeys.some(k => bus(k, j));
  // filter channels (§1, §6.12): channel k carries signal when filter k is possibly on, when a possibly-on source routed
  // to Filter possibly has a balance share for it, or when the other filter's channel carries signal and is routed into
  // it (route 0, added to u_k with no gating) — an off filter still passes its bypass sum v_k through its level and
  // route. Share of F1: s1 = (1 − b)/2 = 0 only at fbal n = 1 exactly; of F2: n = 0 exactly (not targeted).
  const SRC_KEYS = ['a', 'b', 'c', 'n', 's'], srcOn = [onO[0], onO[1], onO[2], onN, onS];
  const shares = (key, f) => isT(key + '.fbal') || P[key + '.fbal'] !== (f ? 0 : 1);
  const fUse = [0, 1].map(f => onF[f] || SRC_KEYS.some((key, x) => srcOn[x] && route[x] === 0 && shares(key, f)));
  // filter → filter (normalisation forbids both at once; the DSP then treats F2 as Main, so F1 → F2 is taken first)
  if (route[5] === 0 && fUse[0]) fUse[1] = true;
  else if (route[6] === 0 && fUse[1]) fUse[0] = true;
  const chanOn = [onO[0], onO[1], onO[2], onN, onS, fUse[0], fUse[1]];
  const anyDirect = chanOn.some((on, k) => on && route[k] === 2);
  const typeOn = t => s.osc.some((O, o) => onO[o] && O.type === t);
  const SQP = SQ.compileSeq(s, { possOn }), seqOn = SQP.seq.active === 1;      // §4.4 (seq-core, D6)
  let use = 0;
  if (onO[2]) use |= 1;
  // bit 2 = Filter 2 possibly on (allocates an instance per voice, §6.13.1) — only that: a Filter 2 *channel* fed while
  // the filter is off (a source's balance share, F1 → F2) has bit 2 clear and must still carry its bypass sum (S2 − U2)
  // through f2.level and its route; outMask / the Direct bit (128) cover that channel
  if (onF[1]) use |= 2;
  if (['a', 'b', 'c'].some(k => P[k + '.w2'] > 0 || isT(k + '.w2'))) use |= 4;
  if (typeOn('sample') || typeOn('multi')) use |= 8;
  if (typeOn('gran')) use |= 16;
  if (typeOn('spec')) use |= 32;
  if (anyBus(1) || anyBus(2)) use |= 64;
  if (anyDirect) use |= 128;
  if (mpeOn) use |= 256;
  if (tuned) use |= 512;
  if (vcAny) use |= 1024;
  if (['env4', 'lfo9', 'lfo10', 'lfo9y', 'lfo10y'].some(id => srcUsed[SRC_MAP.get(id)])) use |= 2048;
  if (curved) use |= 4096;
  if (seqOn) use |= 8192;
  if (s1) use |= 16384;
  const outMask = 1 | (anyDirect ? 2 : 0) | (anyBus(1) ? 4 : 0) | (anyBus(2) ? 8 : 0);
  const poly = intIn(vo.poly, 8, 1, 32);
  const CP = {
    ver: CP_VER, NSV, NSRC, NROW: N_MATRIX, use,
    base,
    mN, mSrc, mAux, mDst, mAmt, mK, mAK, mBi, mInv, mCtx, mOn, mCrv, mRise, mFall, mRd, mAlias, srcUsed, srcBi, modded,
    oType, phMem, phLeg, smoothWT, pMode, bendTrack, uniMode, spawn, pSrc, uniRange, fmType,
    wt: uses.map(u => u.wt), smp: uses.map(u => u.smp), spec: uses.map(u => u.spec), multi: uses.map(u => u.multi),
    memSet,
    mapLo, mapHi, mapVLo, mapVHi, mapFold, mapWarp,
    sLoop, sRel, sLink, sExit, sLoopGr, sScanKey, sScanLock, sLenOn, sSlMode, sSlEnd, sSlOne, sSlRoot, sWin, sDens, sDensJump, sGlen, sPhLock,
    sTrans, sSmooth, sPostWarp, sNorm, sRev, xyOn, xyY, xyMode, msOver, msDlyBpm,
    sScanR, lenLad, sMaxGr, sSlN, sSlPos, sDensLad, sGlenLad, sDensLadN, sGlenLadN,
    route, envOn, fKey, fClean, pz,
    subContig: s.sub.contig ? 1 : 0, noiseOneshot: s.noise.oneshot ? 1 : 0, noiseKey: s.noise.keytrack ? 1 : 0,
    noiseId: colour < 0 ? s.noise.src : '', noiseColor: colour,
    envBpm, envLegInv, envStealRe, envLad,
    lfoMode, lfoMono, lfoType, lfoDir, lfoBpm, lfoAnchor, lfoX10, lfoSwing, lfoLadN, lfoLad,
    chaosMono: Uint8Array.from(s.chaos, ch => (ch.mono ? 1 : 0)),
    chaosSh: Uint8Array.from(s.chaos, ch => (ch.sh ? 1 : 0)),
    macro, mpeMac,
    mono: vo.mono ? 1 : 0, legato: vo.legato ? 1 : 0, poly, always: vo.always ? 1 : 0, scaled: vo.scaled ? 1 : 0, oneNote: vo.oneNote ? 1 : 0,
    steal: intIn(vo.steal, 0, 0, 4),
    // "follow portamento/legato" (§2.2): NOTE reads the gliding pitch, VELO is re-captured on legato notes
    veloPorta: s.velo.porta ? 1 : 0, notePorta: s.note.porta ? 1 : 0,
    vcLen, vcLMode: V.lmode ? 1 : 0, vcRates: Float64Array.from(VC_RATES), vcSteps, vcSel,
    os: c.ultra ? 4 : normOs(gl.os), a4: fin(gl.a4) ? clamp(gl.a4, A4_RANGE[0], A4_RANGE[1]) : 440, s1,
    smooth: gl.nosmooth ? 0.01 : ctxSmooth(c),
    tune, sclN: steps.sclN, sclPer: steps.sclPer, sclSteps: Float64Array.from(steps.sclSteps),
    mpeOn, mpeBend: intIn(mpe.bend, MPE_BEND_DEF, 1, 96), mpeBendX: c.mpeBendX ? 1 : 0, mpeWheelY: mpeOn && mpe.xyz === 3 ? 1 : 0,
    outMask, fxKey, NFX,
    qr: ctxQr(c.qr),
    ctKey: serumT.key,
    mSlot,
    cpKey: '',
  };
  CP.cpKey = cpKeyOf(CP);
  return {
    engine: 'serum',
    mode: vo.mono ? 'mono' : 'poly',
    poly: vo.mono ? 1 : poly,
    prio: 'last',
    legato: !!vo.legato,
    glide: 0, glideLegato: false, unison: 1, unisonDetune: 0, drift: 0, bendRange: 2, level: 1,
    bpm: ctxTempo(c),
    needs,
    serum: CP,
    serumT,
    seq: SQP.seq, seqT: SQP.seqT,   // SQP (§4.4): seq-core compileSeq (part-keyed seqT, memoised by content)
  };
}

/* ================================================================ §8.1 matrix helpers (mutate s in place) */

const isSrcId = x => typeof x === 'string' && x !== '' && SRC_MAP.has(x);
const rowsOf = s => (isObj(s) && Array.isArray(s.matrix) ? s.matrix : []);
const slotOk = (s, slot) => Number.isInteger(slot) && slot >= 0 && slot < Math.min(rowsOf(s).length, N_MATRIX);
const lfoOk = l => Number.isInteger(l) && l >= 0 && l < N_LFO;
const LFO_SRC_RE = /^lfo([1-9]|10)y?$/;
const LFO_KNOBS = ['rate', 'rise', 'delay', 'smooth', 'phase'];

// first slot whose source is empty (§5.8), −1 when the matrix is full
function freeSlot(s) {
  const M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (!isObj(M[r]) || M[r].src === '' || M[r].src === undefined) return r;
  return -1;
}

// Adds a modulation row src → dst with the drag-and-drop defaults of §5.8 (FX bases from the FX state):
// bi = the destination's ctr flag; amount: bool dest base ≥ 0.5 ? −1 : +1; bipolar 0.5; unipolar
// limit (default on) ? max(0.05, min(0.5, 1 − base)) : 0.5. opts.amt / opts.bi override; opts.slot writes
// that slot (replacing its row), else the first slot with src ''. Returns the slot, or −1 (full / bad ids / a Convolve
// shaping parameter, which is not a modulation destination: deviation 20).
export function addMod(s, fx, src, dst, opts) {
  const o = objOf(opts), d = rowOf(dst, fx);
  if (!isSrcId(src) || !d || d.nomod || !isObj(s) || !Array.isArray(s.matrix)) return -1;
  const slot = o.slot === undefined || o.slot === null ? freeSlot(s) : slotOk(s, o.slot) ? o.slot : -1;
  if (slot < 0) return -1;
  const base = destBase(s, fx, d.id);
  const bi = o.bi === undefined || o.bi === null ? d.ctr : bit(o.bi, 0);
  let amt;
  if (fin(o.amt)) amt = clamp(o.amt, -1, 1);
  else if (d.law === 'bool') amt = base >= 0.5 ? -1 : 1;
  else if (bi) amt = 0.5;
  else amt = o.limit === false || o.limit === 0 ? 0.5 : Math.max(0.05, Math.min(0.5, 1 - base));
  s.matrix[slot] = Object.assign(emptyRow(), { src, amt, dst: d.id, bi });
  return slot;
}

// [{slot, row}] for every row whose destination is dst, in any state (rows are the state's own objects)
export function modsFor(s, dst) {
  const out = [], M = rowsOf(s);
  if (typeof dst !== 'string' || !dst) return out;
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r]) && M[r].dst === dst) out.push({ slot: r, row: M[r] });
  return out;
}

// Clears (to the empty row) every row targeting dst, optionally only those from src; returns the count
export function removeMods(s, dst, src) {
  const M = rowsOf(s), any = src === undefined || src === null;
  let k = 0;
  if (typeof dst !== 'string' || !dst) return 0;
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    if (isObj(M[r]) && M[r].dst === dst && (any || M[r].src === src)) { M[r] = emptyRow(); k++; }
  }
  return k;
}

const rowAt = (s, slot) => (slotOk(s, slot) && isObj(s.matrix[slot]) ? s.matrix[slot] : null);
// amount of row `slot`, clamped to [−1, 1]; false for a bad slot / amount
export function setModAmount(s, slot, amt) {
  const r = rowAt(s, slot);
  if (!r || !fin(amt)) return false;
  r.amt = clamp(amt, -1, 1);
  return true;
}
export function toggleModBypass(s, slot) {
  const r = rowAt(s, slot);
  if (!r) return false;
  r.byp = r.byp ? 0 : 1;
  return true;
}
export function toggleModPolarity(s, slot) {
  const r = rowAt(s, slot);
  if (!r) return false;
  r.bi = r.bi ? 0 : 1;
  return true;
}
// Alt-click on a matrix SOURCE menu (inv A16.3): every row whose source is fromSrc gets toSrc; returns the count
export function reassignSource(s, fromSrc, toSrc) {
  const M = rowsOf(s);
  let k = 0;
  if (!isSrcId(fromSrc) || !isSrcId(toSrc) || fromSrc === toSrc) return 0;
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r]) && M[r].src === fromSrc) { M[r].src = toSrc; k++; }
  return k;
}

// Matrix menu "Velo->Amp" (inv A16.3): Fixed × (1 − Velocity) pulls Amp down, so eff g.amp n = velocity.
// Returns the slot of the (new or already identical) row, −1 when the matrix is full.
const VELO_AMP = { src: 'fixed', amt: -1, dst: 'g.amp', bi: 0, curve: 0, aux: 'velo', inv: 1, byp: 0, out: 1 };
const sameRow = (a, b) => isObj(a) && Object.keys(b).every(k => a[k] === b[k]);
export function veloToAmp(s) {
  const M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (sameRow(M[r], VELO_AMP)) return r;
  const slot = freeSlot(s);
  if (slot >= 0) M[slot] = Object.assign(M.length > V1.N_MATRIX ? emptyRow() : {}, VELO_AMP);
  return slot;
}

// "Vibrato quick-assign" (inv A16.3): the first unused LFO (no row reads it and its mode is the default: RETRIG, or a
// migrated free-running v1 LFO) becomes a 5.3 Hz Retrig sine on Master Tune, scaled by the mod wheel (bipolar, amount
// 0.008 = ±0.51 st at full wheel). Returns the row's slot, or −1 (no unused LFO or matrix full; nothing changed).
// one sine cycle starting at the centre (9 points, curvature fitted: |error| < 0.006)
const VIB_PTS = [[0, 0.5, 0.03287], [0.125, 0.85355, 0.20169], [0.25, 1, -0.20169], [0.375, 0.85355, -0.03287], [0.5, 0.5, 0.03287],
  [0.625, 0.14645, 0.20169], [0.75, 0, -0.20169], [0.875, 0.14645, -0.03287], [1, 0.5, 0]];
const lfoDefaultMode = Lf => !isObj(Lf) || Lf.mode === 'off' || (Lf.mode === 'retrig' && !Lf.mono) || (Lf.mode === 'free' && !!Lf.mono);
export function vibratoAssign(s) {
  if (!isObj(s) || !Array.isArray(s.lfo) || !isObj(s.p)) return -1;
  const n = Math.min(s.lfo.length, N_LFO);
  let l = 0;
  while (l < n && (lfoUsed(s, l) || !lfoDefaultMode(s.lfo[l]))) l++;
  const slot = freeSlot(s);
  if (l >= n || slot < 0) return -1;
  // a fresh LFO (switches, loop/start default; Delay, Rise and Smooth 0 so the vibrato starts at once), Retrig,
  // BPM off; the buses the old points linked lose those links, their rows are pruned (inv A13)
  const cut = isObj(s.lfo[l]) ? ptsBuses(s.lfo[l].pts) : [];
  s.lfo[l] = Object.assign(defLfo(), { mode: 'retrig', bpm: 0, pts: clonePts(VIB_PTS) });
  for (const k of LFO_KNOBS) s.p['l' + (l + 1) + '.' + k] = DESTS[DEST_MAP.get('l' + (l + 1) + '.' + k)].def;
  s.p['l' + (l + 1) + '.rate'] = 0.48;
  pruneBuses(s, cut);
  s.matrix[slot] = Object.assign(emptyRow(), { src: 'lfo' + (l + 1), amt: 0.008, dst: 'g.tune', bi: 1, aux: 'wheel' });
  return slot;
}

// any row (bypassed included) whose source or aux source is LFO l (0-based; its X or Y output)
export function lfoUsed(s, l) {
  const id = 'lfo' + (l + 1), idy = id + 'y', M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r]) && (M[r].src === id || M[r].aux === id || M[r].src === idy || M[r].aux === idy)) return true;
  return false;
}

/* ================================================================ §8.1 LFO and bus helpers (in place) */

// Main menu "Init All LFOs" (inv A2.1): every LFO and its lN.* knobs back to default, rows reading an LFO (as source or
// aux) cleared, then the rows of the buses some point linked before the reset pruned (rows aimed at buses no point ever
// linked are kept, see pruneBuses). Returns the rows cleared.
export function initLfos(s) {
  if (!isObj(s)) return 0;
  const links = busLinks(s), cut = [];
  for (let k = 1; k <= N_BUS; k++) if (links[k].length) cut.push(k);
  if (!Array.isArray(s.lfo)) s.lfo = [];
  s.lfo.length = N_LFO;
  for (let l = 0; l < N_LFO; l++) s.lfo[l] = defLfo();
  if (isObj(s.p)) {
    for (let l = 1; l <= N_LFO; l++) for (const k of LFO_KNOBS) s.p['l' + l + '.' + k] = DESTS[DEST_MAP.get('l' + l + '.' + k)].def;
  }
  const M = rowsOf(s);
  let k = 0;
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    if (isObj(M[r]) && (LFO_SRC_RE.test(M[r].src) || LFO_SRC_RE.test(M[r].aux))) { M[r] = emptyRow(); k++; }
  }
  return k + pruneBuses(s, cut);
}

// Alt-drag an LFO tile onto another (inv A13): every field of LFO `from` (mode, switches, type, direction, points with
// bus links, path, loop/start) and its lN.* base values copied to LFO `to` (0-based); rows of buses that only the
// overwritten points of `to` linked are pruned (inv A13). Returns false for bad indices.
export function copyLfo(s, from, to) {
  if (!isObj(s) || !Array.isArray(s.lfo) || !lfoOk(from) || !lfoOk(to) || from === to || !isObj(s.lfo[from])) return false;
  const cut = isObj(s.lfo[to]) ? ptsBuses(s.lfo[to].pts) : [];
  s.lfo[to] = clone(s.lfo[from]);
  if (isObj(s.p)) for (const k of LFO_KNOBS) { const v = s.p['l' + (from + 1) + '.' + k]; if (v !== undefined) s.p['l' + (to + 1) + '.' + k] = v; }
  pruneBuses(s, cut);          // links the overwritten points held (inv A13)
  return true;
}

const busNum = id => { const m = typeof id === 'string' ? /^bus([1-9]|1[0-6])$/.exec(id) : null; return m ? +m[1] : 0; };
// links[k] = [{lfo, pt, axis}] for bus k = 1…16 (index 0 unused)
function busLinks(s) {
  const links = Array.from({ length: N_BUS + 1 }, () => []), lfo = isObj(s) ? arrOf(s.lfo) : [];
  for (let l = 0; l < lfo.length && l < N_LFO; l++) {
    const pts = isObj(lfo[l]) ? arrOf(lfo[l].pts) : [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!Array.isArray(p)) continue;
      const mx = busOf(p[3]), my = busOf(p[4]);
      if (mx) links[mx].push({ lfo: l, pt: i, axis: 'x' });
      if (my) links[my].push({ lfo: l, pt: i, axis: 'y' });
    }
  }
  return links;
}

// Map<bus 1–16, {points: [{lfo, pt, axis}], sources: [srcId]}> of the buses some LFO point links (ascending),
// with the sources of the rows targeting them (slot order, unique)
export function linkedBuses(s) {
  const links = busLinks(s), M = rowsOf(s), out = new Map();
  for (let k = 1; k <= N_BUS; k++) {
    if (!links[k].length) continue;
    const sources = [];
    for (let r = 0; r < M.length && r < N_MATRIX; r++) {
      const w = M[r];
      if (isObj(w) && w.dst === 'bus' + k && isSrcId(w.src) && sources.indexOf(w.src) < 0) sources.push(w.src);
    }
    out.set(k, { points: links[k], sources });
  }
  return out;
}

// lowest bus that no point links and no row targets; 0 when all 16 are in use
export function newBus(s) {
  const links = busLinks(s), used = new Uint8Array(N_BUS + 1), M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r])) used[busNum(M[r].dst)] = 1;
  for (let k = 1; k <= N_BUS; k++) if (!links[k].length && !used[k]) return k;
  return 0;
}

// In place (inv A13 "removing point mods deletes unused bus routings"): clears the rows whose destination is a
// bus that no LFO point links. `buses` (bus number, array or Set of 1…16) limits this to those buses: the editing
// helpers pass the buses whose links they just removed, so a row aimed at a bus that was never linked (a routing
// prepared in the matrix before linking points; newBus treats such a bus as taken) survives. Without `buses`,
// every unlinked bus is swept. Returns the number of rows cleared.
export function pruneBuses(s, buses) {
  const links = busLinks(s), M = rowsOf(s);
  let only = null, n = 0;
  if (buses !== undefined && buses !== null) {
    only = new Uint8Array(N_BUS + 1);
    const list = typeof buses === 'number' ? [buses] : buses instanceof Set ? Array.from(buses) : arrOf(buses);
    for (const b of list) if (Number.isInteger(b) && b >= 1 && b <= N_BUS) only[b] = 1;
  }
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    const k = isObj(M[r]) ? busNum(M[r].dst) : 0;
    if (k && !links[k].length && (!only || only[k])) { M[r] = M.length > V1.N_MATRIX ? emptyRow() : emptyRowV1(); n++; }
  }
  return n;
}

// bus numbers (1…16) linked by the points of a graph (any value; malformed points ignored)
function ptsBuses(pts) {
  const out = [];
  for (const p of arrOf(pts)) {
    if (!Array.isArray(p)) continue;
    for (const b of [busOf(p[3]), busOf(p[4])]) if (b && out.indexOf(b) < 0) out.push(b);
  }
  return out;
}

// In place: removes the bus links (mx, my) of points idxs of LFO `lfo` (0-based; idxs = index, array, or
// null/undefined = every point), then prunes the rows of the buses that thereby lost their last link (rows of
// other buses are kept, see pruneBuses). Returns the number of rows pruned.
export function clearPointMods(s, lfo, idxs) {
  const Lf = isObj(s) && Array.isArray(s.lfo) && lfoOk(lfo) ? s.lfo[lfo] : null, cut = [];
  if (isObj(Lf) && Array.isArray(Lf.pts)) {
    const list = idxs === undefined || idxs === null ? Lf.pts.map((_, i) => i) : typeof idxs === 'number' ? [idxs] : arrOf(idxs);
    for (const i of list) {
      const p = Number.isInteger(i) ? Lf.pts[i] : null;
      if (Array.isArray(p) && p.length > 3) { cut.push(...ptsBuses([p])); Lf.pts[i] = p.slice(0, 3); }
    }
  }
  return pruneBuses(s, cut);
}

// Warp menu choice of the v1 warp slot (inv A5, in place; S1 mode slot 1 of OSC A/B): oscillator o (0 = A, 1 = B) gets
// mode 0–22; choosing FM/AM/RM from the other oscillator (18–20) turns those modes off on the other one.
export function warpChoice(s, o, mode) {
  if (!isObj(s) || !isObj(s.p) || !fin(mode)) return;
  const m = clamp(Math.round(mode), 0, 22), me = o ? 'b.warpMode' : 'a.warpMode', other = o ? 'a.warpMode' : 'b.warpMode';
  s.p[me] = m / 22;
  if (m >= 18 && m <= 20 && fin(s.p[other]) && isWarpFromOther(s.p[other])) s.p[other] = 0;
}

/* ================================================================ §11.1 module copy, presets */

function getPath(o, path) {
  let v = o;
  for (const k of path) { if (!v || typeof v !== 'object') return undefined; v = v[k]; }
  return v;
}
function setPath(o, path, v) {
  let t = o;
  for (let j = 0; j < path.length - 1; j++) {
    if (!t[path[j]] || typeof t[path[j]] !== 'object') t[path[j]] = typeof path[j + 1] === 'number' ? [] : {};
    t = t[path[j]];
  }
  t[path[path.length - 1]] = v;
}

const OSC_MODS = ['oscA', 'oscB', 'oscC'];
// module → id prefix of its destinations (pairs of the same kind map their ids by suffix, §11.1 copyModule)
const MODULE_PREFIX = { oscA: 'a', oscB: 'b', oscC: 'c', noise: 'n', sub: 's', filter: 'f', filter2: 'f2', arp: 'arp', clip: 'clip', vc: 'vc' };
for (let e = 1; e <= N_ENV; e++) MODULE_PREFIX['env' + e] = 'e' + e;
for (let l = 1; l <= N_LFO; l++) MODULE_PREFIX['lfo' + l] = 'l' + l;
// kind of a module: modules of one kind (except 'one') may be copied / swapped into each other
const moduleKind = m => (/^osc[ABC]$/.test(m) ? 'osc' : m === 'filter' || m === 'filter2' ? 'filter' : /^env\d+$/.test(m) ? 'env'
  : /^lfo\d+$/.test(m) ? 'lfo' : 'one');
// destination id of module `from` → the corresponding id of module `to` ('' when it has none): by suffix, plus Filter 1's
// S2 type f.type2 ↔ Filter 2's f2.type (the v1 field f.type has no Filter 2 counterpart)
function mapDest(id, from, to) {
  if (from === to) return id;
  if (id === 'f.type2' && from === 'filter') return to === 'filter2' ? 'f2.type' : '';
  if (id === 'f2.type' && from === 'filter2') return to === 'filter' ? 'f.type2' : '';
  if (id === 'f.type') return '';
  const a = MODULE_PREFIX[from], b = MODULE_PREFIX[to];
  if (!a || !b || typeof id !== 'string' || id.slice(0, a.length + 1) !== a + '.') return '';
  const t = b + id.slice(a.length);
  return MODULE_DESTS[to].has(t) ? t : '';
}
// knob value n of destination sid carried to tid: n itself when both rows share law and range, else through the value
function convN(sid, tid, n) {
  const i = DEST_MAP.get(sid), j = DEST_MAP.get(tid), a = DESTS[i], b = DESTS[j];
  if (a.law === b.law && a.lo === b.lo && a.hi === b.hi) return n;
  return snapN(j, clamp01(L.lawNorm(b.law, b.lo, b.hi, L.lawValue(a.law, a.lo, a.hi, n), b.def))) + 0;
}
// module m of `target` ← module `from` of `source`: destinations by suffix (mapDest; a missing source id keeps the
// target's value, except Start/End copied from ENV 1, which become 0 = their default), structured paths by position
function copyFields(target, source, m, from) {
  const F = MODULE_FIELDS[m], G = MODULE_FIELDS[from], env = m !== from && moduleKind(m) === 'env';
  if (!isObj(target.p)) target.p = {};
  if (isObj(source.p)) {
    for (const id of F.p) {
      const sid = m === from ? id : mapDest(id, m, from);
      if (sid && fin(source.p[sid])) target.p[id] = m === from ? source.p[sid] : convN(sid, id, source.p[sid]);
      else if (!sid && env) target.p[id] = DESTS[DEST_MAP.get(id)].def;
    }
  }
  F.paths.forEach((path, j) => { const v = getPath(source, G.paths[j]); if (v !== undefined) setPath(target, path, clone(v)); });
}
const emptyRowOf = M => (M.length > V1.N_MATRIX ? emptyRow() : emptyRowV1());

// Module copy without the LFO bus pruning (shared by copyModule and swapModules): fields, then the per-kind repairs
function copyCore(target, source, m, f) {
  copyFields(target, source, m, f);
  const kind = moduleKind(m), o = OSC_MODS.indexOf(m);
  if (kind === 'osc') {
    const O = arrOf(target.osc)[o];
    if (isObj(O) && isObj(O.pitch) && O.pitch.src === 'ABC'.charAt(o)) O.pitch.src = 'note';
    if (o < 2 && fin(target.p['a.warpMode']) && fin(target.p['b.warpMode'])
      && isWarpFromOther(target.p['a.warpMode']) && isWarpFromOther(target.p['b.warpMode'])) target.p[o === 0 ? 'b.warpMode' : 'a.warpMode'] = 0;
    // OSC C has no v1 warp field: an A/B target takes the S1 rendition of the pasted slot 1 where one exists (§2.6.4)
    if (o < 2 && f === 'oscC' && isObj(target.global) && target.global.s1 !== undefined) syncS1(target, 'ab'.charAt(o) + '.w1');
    if (isObj(target.global) && target.global.s1 !== undefined) breakWarpCycles(target, o);
    pitchChoice(target, o);                              // ratio-source cycle (§2.2.5): the target is the most recent choice
  } else if (kind === 'filter') {
    // Filter 2 → Filter 1 writes f.type2 (from f2.type): f.type follows through the inverse map in both modes (§2.6.4;
    // type ≤ 95), so ticking S1 plays the pasted type where it has an S1 rendition
    if (m === 'filter' && f === 'filter2' && isObj(source.p) && fin(source.p['f2.type'])) syncS1(target, 'f.type2');
    const F = arrOf(target.filter);
    if (isObj(F[0]) && isObj(F[1]) && F[0].route === 0 && F[1].route === 0) F[m === 'filter' ? 0 : 1].route = 1;   // no F1 ↔ F2 loop
  }
}

// In place: module m of `target` (MODULE_FIELDS[m]: s.p destinations and structured paths, deep copies) gets the values of
// module `from` (default m) of `source` — Copy/Paste/Init of a module (Init: source = defaultSerum(); see initModule).
// Allowed (m, from) pairs (§11.1): any two oscillators (a.* ↔ b.* ↔ c.* and the whole osc object; a ratio source equal to
// the target becomes note; the warp-cycle rule and the ratio-source cycle rule (§2.2.5, pitchChoice) are re-applied with
// the target as the most recent choice, and the v1 warp single-direction rule keeps the written oscillator); Filter ↔
// Filter 2 (f.* ↔ f2.*, f.type2 ↔ f2.type; a copy into Filter 1 also sets f.type when the type is ≤ 95, in both modes, so
// the S1 pair stays consistent, §2.6.4; a route that would make both filters feed each other is set to Main on the target); any two envelopes (Start/End dropped into ENV 1, 0 from ENV 1); any two LFOs (incl. PHASE;
// rows of buses that only the overwritten points of the target linked are pruned, as copyLfo); and every module with
// itself. opts.mods ("Copy (w/mods)", inv B2): the rows of `source` targeting module `from`'s destinations replace the
// rows of `target` targeting m's, re-targeted by suffix (as many as there are free slots). Returns false (nothing
// changed) for bad arguments or other pairs.
export function copyModule(target, source, m, from, opts) {
  const f = from === undefined || from === null ? m : from;
  if (!own(MODULE_FIELDS, m) || !own(MODULE_FIELDS, f) || !isObj(target) || !isObj(source)) return false;
  const kind = moduleKind(m);
  if (f !== m && (kind === 'one' || kind !== moduleKind(f))) return false;
  const withMods = !!objOf(opts).mods;
  const rows = withMods ? rowsOf(source).slice(0, N_MATRIX).filter(r => isObj(r) && MODULE_DESTS[f].has(r.dst)).map(clone) : null;
  const l = kind === 'lfo' ? +m.slice(3) - 1 : -1;
  const cut = l >= 0 && Array.isArray(target.lfo) && isObj(target.lfo[l]) ? ptsBuses(target.lfo[l].pts) : [];
  copyCore(target, source, m, f);
  if (withMods && Array.isArray(target.matrix)) {
    const M = target.matrix;
    for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r]) && MODULE_DESTS[m].has(M[r].dst)) M[r] = emptyRowOf(M);
    for (const row of rows) {
      const dst = mapDest(row.dst, f, m), slot = dst ? freeSlot(target) : -1;
      if (slot >= 0) M[slot] = Object.assign(emptyRowOf(M), row, { dst });
    }
  }
  if (l >= 0) pruneBuses(target, cut);
  return true;
}

// In place (module-label drag, inv B2): modules a and b of s exchange their settings (the copyModule pairs of one kind)
// and the rows targeting them (re-targeted by suffix; a row without a counterpart — e.g. ENV 2 Start moving to ENV 1 — is
// cleared). LFO point links travel with their points. Returns false for bad or unpaired modules.
export function swapModules(s, a, b) {
  if (!isObj(s) || !own(MODULE_FIELDS, a) || !own(MODULE_FIELDS, b) || a === b) return false;
  const kind = moduleKind(a);
  if (kind === 'one' || kind !== moduleKind(b)) return false;
  const tmp = clone(s);
  copyCore(s, tmp, a, b);
  copyCore(s, tmp, b, a);
  const M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    const w = M[r];
    if (!isObj(w)) continue;
    const from = MODULE_DESTS[a].has(w.dst) ? a : MODULE_DESTS[b].has(w.dst) ? b : '';
    if (!from) continue;
    const dst = mapDest(w.dst, from, from === a ? b : a);
    if (dst) w.dst = dst;
    else M[r] = emptyRowOf(M);
  }
  return true;
}

// In place (inv B2 "Init Module also removes the module's modulations"): module m's destinations and structured paths ←
// defaultSerum()'s, then every row whose destination belongs to m is cleared (rows *from* the module as a source stay);
// an initialised LFO loses its point links (rows of buses no point links any more are pruned). Locks are unchanged.
export function initModule(s, m) {
  if (!isObj(s) || !own(MODULE_FIELDS, m)) return false;
  const l = moduleKind(m) === 'lfo' ? +m.slice(3) - 1 : -1;
  const cut = l >= 0 && Array.isArray(s.lfo) && isObj(s.lfo[l]) ? ptsBuses(s.lfo[l].pts) : [];
  copyFields(s, defaultSerum(), m, m);
  const M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r]) && MODULE_DESTS[m].has(M[r].dst)) M[r] = emptyRowOf(M);
  if (l >= 0) pruneBuses(s, cut);
  return true;
}

// Preset load (§11.1): a new state from preset {name, cat, v: {s}, fx} that shares no object with the preset or with
// cur: (1) cur's locked parameters keep their values (synth ids; FX ids go through applyPresetFx); (2) locked modules
// (incl. Lock Matrix) are copied from cur, then the preset's values are re-applied for the controls unlocked inside them
// (locks.unp); (3) misc locks (poly, os, tuning: a4 and the tuning); locks and ui from cur; (4) midi: midiFromPreset 0
// keeps cur.midi, 1 (default, Phase 1) takes the preset's map when non-empty.
// virtual arp.* / clip.* destination id (§3.11.3): the values of every arp slot / clip of `from` (n[key]) into `to`'s
function seqVirtualCopy(id, from, to) {
  const q = /^(arp|clip)\.(\w+)$/.exec(id);
  if (!q || !DEST_MAP.has(id) || !IS_VIRTUAL[DEST_MAP.get(id)]) return;
  const list = x => (q[1] === 'arp' ? arrOf(objOf(x.arp).slots) : arrOf(objOf(x.clip).clips));
  const Fs = list(from), keys = id === 'arp.rate' ? ['rate', 'hz'] : [q[2]];  // arp.rate: its BPM and HZ bases (RULINGS2 C1/U1)
  list(to).forEach((x, j) => { const y = Fs[j]; if (isObj(x) && isObj(x.n) && isObj(y) && isObj(y.n)) for (const k of keys) if (fin(y.n[k])) x.n[k] = y.n[k]; });
}
export function applyPreset(cur, preset, opts) {
  const o = objOf(opts), c = normalizeSerum(cur), r = normalizeSerum(objOf(objOf(preset).v).s), pp = Object.assign({}, r.p);
  const pre = { arp: r.arp, clip: r.clip };                 // the preset's sequencer modules (a locked one is replaced below)
  // the preset's S1-pair fields as it plays them (read when the S1 flags differ, below)
  const prePairs = { p: pp, osc: r.osc.map(O => ({ phMem: O.phMem })), global: { s1: r.global.s1 } };
  for (const id of c.locks.p) {
    if (own(r.p, id)) { r.p[id] = c.p[id]; continue; }
    // virtual destinations (§3.11.3: locks work on them): a macro keeps its value, arp.* / clip.* keep every slot's base
    const mi = macroIdx(id);
    if (mi >= 0) r.macros[mi].v = c.macros[mi].v;
    else seqVirtualCopy(id, c, r);
  }
  for (const m of c.locks.mod) copyFields(r, c, m, m);      // the cross-module rules are re-applied below
  for (const id of c.locks.unp) {
    if (c.locks.p.indexOf(id) >= 0) continue;
    if (own(pp, id)) r.p[id] = pp[id];
    else seqVirtualCopy(id, pre, r);                         // an unlocked Arp / Clip control: the preset's slot values
  }
  if (c.locks.misc.poly) r.voicing.poly = c.voicing.poly;
  if (c.locks.misc.os) r.global.os = c.global.os;
  if (c.locks.misc.tuning) { r.global.a4 = c.global.a4; r.global.tun = clone(c.global.tun); }
  r.locks = c.locks;
  r.ui = c.ui;
  if (o.midiFromPreset === 0 || o.midiFromPreset === false || !Object.keys(r.midi).length) r.midi = c.midi;
  // S1 pairs (§2.6.4) when cur and the preset differ in S1 mode: a locked pair (pairLocked) keeps cur's sound, the others
  // the preset's, each written into the field the loaded state's mode reads (forward / inverse map). A locked S2 value
  // without an S1 rendition (S2-only filter type, warp or Triangle sub, bend beyond ±24, phase memory the knob ends do
  // not give) loads the preset in S2 mode (global.s1 = 0) instead: the preset's own pairs then play their S2 renditions.
  if (c.global.s1 !== r.global.s1) reconcilePairs(r, p => (pairLocked(c, p) ? c : prePairs));
  // modules from cur and from the preset may conflict: the normalisation rules apply (§2.2.5; Phase 1's warp rule keeps A),
  // so the loaded state plays as it will after a reload — ratio-source cycles: the later oscillator → note; F1 ↔ F2: F2 → Main
  if (isWarpFromOther(r.p['a.warpMode']) && isWarpFromOther(r.p['b.warpMode'])) r.p['b.warpMode'] = 0;   // keep A
  fixRatioSources(r.osc);
  if (r.filter[0].route === 0 && r.filter[1].route === 0) r.filter[1].route = 1;
  return r;
}

/* ================================================================ §11.1 warps: S2 slots, Swap Warps, the cycle rule */

const WARP_SRC = WARPS2.map(w => (/_o1$/.test(w.id) ? 1 : /_o2$/.test(w.id) ? 2 : 0));   // 1: reads o1, 2: reads o2
const OTHER_OSC = [[1, 2], [0, 2], [0, 1]];
const W_KEYS = ['w1', 'w2'];
const warpIdx = n => (fin(n) ? clamp(Math.round(81 * n), 0, 81) : 0);
// v1 warp index whose S2 rendition (S1_TO_S2_WARP) is WARPS2 mode i with Var v (Var matters for Sync only), or −1
function v1WarpOf(i, v) {
  for (let m = 0; m < S1_TO_S2_WARP.length; m++) {
    const e = S1_TO_S2_WARP[m];
    if (e[0] === i && (i !== 1 || e[1] === v)) return m;
  }
  return -1;
}
// oscillator-sourced warp slots (base modes, §6.6.6 edges target ← source): [{o, slot, src, legacy}]. S1 mode reads the
// slot 1 of A/B from the v1 field (modes 18–20 read the other of A/B); spectral modes count on Spectral oscillators only
function warpEdges(s) {
  const out = [], s1 = s1Of({ s }), P = objOf(s.p);
  for (let o = 0; o < N_OSC; o++) {
    const k = 'abc'.charAt(o), type = oscTypeOf(s, o);
    for (let slot = 0; slot < 2; slot++) {
      if (s1 && o < 2 && slot === 0) {
        if (fin(P[k + '.warpMode']) && isWarpFromOther(P[k + '.warpMode'])) out.push({ o, slot, src: 1 - o, legacy: 1 });
        continue;
      }
      const i = warpIdx(P[k + '.' + W_KEYS[slot]]), w = WARP_SRC[i];
      if (w && (WARPS2[i].avail !== 'Sp' || type === 'spec')) out.push({ o, slot, src: OTHER_OSC[o][w - 1], legacy: 0 });
    }
  }
  return out;
}
// §6.6.6 with oscillator o as the most recent choice (in place): while a slot of o closes a cycle, the slot of the other
// oscillator on that cycle that reads o is set Off. Returns the slots set Off [{o, slot}].
function breakWarpCycles(s, o) {
  const off = [];
  if (!isObj(s) || !isObj(s.p)) return off;
  for (let guard = 0; guard < 2 * N_OSC; guard++) {
    const E = warpEdges(s);
    let hit = null;
    for (const e of E) {
      if (e.o !== o) continue;
      const seen = [e.src], stack = [e.src];          // follow "depends on" from o's modulator until an edge reading o
      while (stack.length && !hit) {
        const t = stack.pop();
        for (const d of E) {
          if (d.o !== t) continue;
          if (d.src === o) { hit = d; break; }
          if (seen.indexOf(d.src) < 0) { seen.push(d.src); stack.push(d.src); }
        }
      }
      if (hit) break;
    }
    if (!hit) break;
    s.p['abc'.charAt(hit.o) + '.' + (hit.legacy ? 'warpMode' : W_KEYS[hit.slot])] = 0;
    off.push({ o: hit.o, slot: hit.slot });
  }
  return off;
}

// Warp menu choice (in place, §11.1): oscillator o (0–2) slot (0 = WARP 1, 1 = WARP 2) gets WARPS2 mode `mode` (k.w1 /
// k.w2); in S1 mode the slot 1 of A/B is the v1 field and `mode` a WARPS index (Phase-1 warpChoice). A choice that closes
// an oscillator cycle sets the conflicting slots of the other oscillators Off (most recent choice wins). Returns the
// slots set Off [{o, slot}] (empty for bad arguments). The panel calls syncS1 afterwards (§2.6.4).
export function warpChoice2(s, o, slot, mode) {
  if (!isObj(s) || !isObj(s.p) || !fin(mode) || (o !== 0 && o !== 1 && o !== 2) || (slot !== 0 && slot !== 1)) return [];
  if (o < 2 && slot === 0 && s1Of({ s })) warpChoice(s, o, mode);
  else s.p['abc'.charAt(o) + '.' + W_KEYS[slot]] = clamp(Math.round(mode), 0, 81) / 81;
  return breakWarpCycles(s, o);
}

// "Swap Warps" (in place, §3.4.2): oscillator o's slots exchange their modes, amounts (k.warp ↔ k.warp2), Vars, unison
// spreads (k.uniwarp ↔ k.uniwarp2) and FM types (osc.fm), and the rows targeting them are re-targeted. In S1 mode the
// slot 1 of A/B is the v1 field: its S2 rendition moves to slot 2 and slot 2's mode must have a v1 rendition (else
// nothing changes and false is returned); a row on the v1 field moves to k.w2 with its amount × 22/81 (same step count).
const SWAP_W = [['warp', 'warp2'], ['wvar1', 'wvar2'], ['uniwarp', 'uniwarp2'], ['w1', 'w2']];
export function swapWarps(s, o) {
  if (!isObj(s) || !isObj(s.p) || (o !== 0 && o !== 1 && o !== 2)) return false;
  const k = 'abc'.charAt(o), P = s.p, legacy = o < 2 && s1Of({ s });
  let v1 = -1;
  if (legacy) {
    v1 = v1WarpOf(warpIdx(P[k + '.w2']), P[k + '.wvar2']);
    if (v1 < 0) return false;
    const e = S1_TO_S2_WARP[Math.round(22 * num(P[k + '.warpMode'], 0, 0, 1))];
    P[k + '.w1'] = e[0] / 81;
    P[k + '.wvar1'] = e[1];
  }
  const map = {};
  for (const [x, y] of SWAP_W) {
    const a = P[k + '.' + x], b = P[k + '.' + y];
    if (b !== undefined) P[k + '.' + x] = b;
    if (a !== undefined) P[k + '.' + y] = a;
    map[k + '.' + x] = k + '.' + y;
    map[k + '.' + y] = k + '.' + x;
  }
  if (legacy) { P[k + '.warpMode'] = v1 / 22; map[k + '.warpMode'] = k + '.w2'; }
  const O = arrOf(s.osc)[o];
  if (isObj(O) && Array.isArray(O.fm) && O.fm.length === 2) O.fm = [O.fm[1], O.fm[0]];
  const M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    const w = M[r];
    if (!isObj(w) || !own(map, w.dst)) continue;
    if (w.dst === k + '.warpMode' && fin(w.amt)) w.amt = clamp(w.amt * 22 / 81, -1, 1);
    w.dst = map[w.dst];
  }
  return true;
}

/* ================================================================ §2.6.4 S1 pairs: syncS1 */

const PAIR_BY_ID = S1_PAIRS.reduce((o, p) => { o[p.id] = p; return o; }, {});
const PAIR_OF = {};
for (const p of S1_PAIRS) { PAIR_OF[p.id] = p.id; for (const id of p.v1.concat(p.s2)) PAIR_OF[id] = p.id; }
PAIR_OF['a.phMem'] = 'aPhaseMem';
PAIR_OF['b.phMem'] = 'bPhaseMem';
const pN = (s, id) => destBase(s, null, id);
const knobEnd = n => n >= 0.9995;
const phMemOf = (s, k) => (knobEnd(pN(s, k + '.phase')) ? (knobEnd(pN(s, k + '.rand')) ? 'voice' : 'contig') : 'all');
// forward map of a pair: the S2 rendition of the v1 field(s) ({id: n}, or {phMem} for the phase-memory pairs)
function pairForward(s, p) {
  const v = p.v1[0];
  switch (p.id) {
    case 'aWarp': case 'bWarp': { const e = S1_TO_S2_WARP[Math.round(22 * pN(s, v))]; return { [p.s2[0]]: e[0] / 81, [p.s2[1]]: e[1] }; }
    case 'subShape': return { 's.shp': S1_TO_S2_SUB[Math.round(4 * pN(s, v))] / 5 };
    case 'f1Type': return { 'f.type2': Math.round(95 * pN(s, v)) / 107 };
    case 'bendUp': return { 'g.bu2': clamp(lawValue(v, pN(s, v)), 0, 48) / 48 };
    case 'bendDown': return { 'g.bd2': (clamp(lawValue(v, pN(s, v)), -48, 0) + 48) / 48 };
    default: return { phMem: phMemOf(s, v.charAt(0)) };
  }
}
const phMemCur = (s, k) => { const O = arrOf(s.osc)[k === 'a' ? 0 : 1]; return isObj(O) ? O.phMem : undefined; };
// Do the two renditions of pair p differ (GLOBAL "S1 rendition differs", §13.10)? The S2 field(s) differ from the forward
// map of the v1 field(s) (Var compared for Sync only), or the forward map itself is inexact for the v1 value (§2.6.2,
// §2.6.4): v1 warp 2 (Sync 1/2 Win. → Sync with Var ½, approximate), a v1 bend outside the S2 range (Bend Up < 0, Bend
// Down > 0: clamped to 0).
function pairDiffers(s, p) {
  const f = pairForward(s, p);
  if (f.phMem) return phMemCur(s, p.v1[0].charAt(0)) !== f.phMem;
  if (p.id === 'aWarp' || p.id === 'bWarp') {
    if (Math.round(22 * pN(s, p.v1[0])) === 2) return true;
    const i = warpIdx(pN(s, p.s2[0]));
    return i !== Math.round(81 * f[p.s2[0]]) || (i === 1 && pN(s, p.s2[1]) !== f[p.s2[1]]);
  }
  if (p.id === 'bendUp' || p.id === 'bendDown') {
    const v = lawValue(p.v1[0], pN(s, p.v1[0]));
    if (p.id === 'bendUp' ? v < 0 : v > 0) return true;
  }
  const id = p.s2[0], j = DEST_MAP.get(id);
  return snapN(j, pN(s, id)) !== snapN(j, f[id]);
}
// inverse map: v1 field values ({id: n}) for the current S2 rendition when it is in the image of the forward map, else null
function pairInverse(s, p) {
  const v = p.v1[0];
  switch (p.id) {
    case 'aWarp': case 'bWarp': { const m = v1WarpOf(warpIdx(pN(s, p.s2[0])), pN(s, p.s2[1])); return m < 0 ? null : { [v]: m / 22 }; }
    case 'subShape': { const i = S1_TO_S2_SUB.indexOf(Math.round(5 * pN(s, 's.shp'))); return i < 0 ? null : { [v]: i / 4 }; }
    case 'f1Type': { const t = Math.round(107 * pN(s, 'f.type2')); return t > 95 ? null : { [v]: t / 95 }; }
    case 'bendUp': { const u = lawValue('g.bu2', pN(s, 'g.bu2')); return u > 24 ? null : { [v]: (u + 24) / 48 }; }
    case 'bendDown': { const d = lawValue('g.bd2', pN(s, 'g.bd2')); return d < -24 ? null : { [v]: (d + 24) / 48 }; }
    default: return null;                              // phase memory: the knobs are never moved
  }
}

// After an edit of a paired field (§2.6.4; in place): `id` = a destination of S1_PAIRS (v1 or S2 side), 'a.phMem' /
// 'b.phMem' or a pair id. An edit of a v1 field writes its counterpart through the forward map (the phase-memory knob-end
// rule only in S1 mode, where PHASE/RAND have their Mem meaning); an edit of a counterpart writes the v1 field through
// the inverse map when the new value is in the image of the forward map (and the pair is not already consistent), else
// leaves it. Returns the ids of every pair whose renditions now differ (GLOBAL page "S1 rendition differs").
export function syncS1(s, id) {
  if (!isObj(s) || !isObj(s.p)) return [];
  const p = own(PAIR_OF, id) ? PAIR_BY_ID[PAIR_OF[id]] : null;
  if (p) {
    const fromV1 = p.v1.indexOf(id) >= 0;
    if (!p.s2.length) {                                // phase memory
      if (fromV1 && s1Of({ s })) { const O = arrOf(s.osc)[id.charAt(0) === 'a' ? 0 : 1]; if (isObj(O)) O.phMem = pairForward(s, p).phMem; }
    } else if (fromV1) {
      const f = pairForward(s, p);
      for (const k of Object.keys(f)) s.p[k] = f[k];
    } else if (pairDiffers(s, p)) {
      const inv = pairInverse(s, p);
      if (inv) for (const k of Object.keys(inv)) s.p[k] = inv[k];
    }
  }
  return S1_PAIRS.filter(q => pairDiffers(s, q)).map(q => q.id);
}

// ---- S1 pairs across states with different S1 flags (applyPreset with locks, hybridize)
const pairOsc = p => (p.v1[0].charAt(0) === 'a' ? 0 : 1);              // the oscillator of a phase-memory pair
// The field values r must hold for pair p to play as state `src` plays it, in r's mode toS1 ({id: n}, {phMem} or {}),
// or null when there is none: same mode — src's active field(s); S1 → S2 — the forward map (bends clamped, Sync 1/2 Win.
// approximate); S2 → S1 — the inverse map (null for an S2-only value). Phase memory: S2 mode reads osc.phMem (src's, or
// the knob-end rendition of an S1 src); S1 mode reads r's own PHASE / RAND knob ends (never moved): null when they do not
// give the phMem of an S2 src.
function pairRendition(r, src, p, toS1) {
  const fromS1 = s1Of({ s: src });
  if (!p.s2.length) {
    const k = 'ab'.charAt(pairOsc(p));
    if (!toS1) { const m = fromS1 ? phMemOf(src, k) : phMemCur(src, k); return m === undefined ? {} : { phMem: m }; }
    return fromS1 || phMemOf(r, k) === phMemCur(src, k) ? {} : null;
  }
  if (fromS1 === toS1) { const o = {}; for (const id of toS1 ? p.v1 : p.s2) o[id] = pN(src, id); return o; }
  return fromS1 ? pairForward(src, p) : pairInverse(src, p);
}
// In place: every S1 pair of r takes the rendition of srcOf(p) (the state whose sound r must keep for that pair) in r's
// mode. r keeps its own S1 flag unless some pair has no S1 rendition: then r plays in S2 mode (global.s1 = 0), where every
// pair has one. Returns the ids of the pairs written from a source in the other mode (approximate where the maps are).
function reconcilePairs(r, srcOf) {
  let toS1 = s1Of({ s: r });
  if (toS1 && S1_PAIRS.some(p => !pairRendition(r, srcOf(p), p, true))) toS1 = false;
  r.global.s1 = toS1 ? 1 : 0;
  const out = [];
  for (const p of S1_PAIRS) {
    const src = srcOf(p), w = pairRendition(r, src, p, toS1);
    if (!w) continue;
    if (s1Of({ s: src }) !== toS1) out.push(p.id);
    for (const id of Object.keys(w)) {
      if (id !== 'phMem') r.p[id] = w[id];
      else if (isObj(r.osc[pairOsc(p)])) r.osc[pairOsc(p)].phMem = w.phMem;
    }
  }
  return out;
}
// Is S1 pair p locked in state c (§11.1 applyPreset)? Its module is locked and none of its destinations is unlocked
// (locks.unp), or one of them is a locked parameter (locks.p). Phase memory follows the oscillator's module lock only
// (osc.phMem is part of the module, not a destination; a lock on the PHASE / RAND knob locks the knob).
function pairLocked(c, p) {
  const ids = p.v1.concat(p.s2), Lk = c.locks, m = moduleOf(p.v1[0]);
  if (p.s2.length && ids.some(id => Lk.p.indexOf(id) >= 0)) return true;
  return !!m && Lk.mod.indexOf(m) >= 0 && (!p.s2.length || !ids.some(id => Lk.unp.indexOf(id) >= 0));
}

/* ================================================================ deviation 22: chaos sources → Chaos LFOs */

// A new state (GLOBAL > CHAOS "Convert to Chaos LFOs", approximate): each S1 chaos source read by some row moves to the
// first LFO that no row uses and whose mode and type are default, set to type rossler (Chaos 1) / lorenz (Chaos 2) with the
// chaos rate and MONO (MONO → FREE mode, else RETRIG); the rows' sources / aux sources are re-pointed. Rate: BPM off — the
// chaos rate in Hz (above 100 Hz with the ×10 switch); BPM on — the chaos rate stays a Hz-law value that the DSP snaps to
// the nearest LFO_LADDER entry at the tempo (Phase-1 snapRate, = the chaosRate display), so the LFO gets that entry as its
// straight-ladder index at `bpm` (default 120; the GLOBAL page passes the project tempo); a rate of 0 Hz (frozen chaos)
// becomes a 0 Hz LFO with BPM off. The LFO's DELAY / RISE / SMOOTH / PHASE knobs go back to their defaults and its
// direction, swing and HOST anchor to Forward / 0 / off (an S1 chaos source has none of them). A chaos S&H setting has no
// equivalent and is dropped. Without a free LFO the chaos rows stay.
export function chaosToLfo(s, bpm) {
  const r = normalizeSerum(s), tempo = tempoOf(bpm), top = LFO_LADDER.length - 1;
  for (let c = 0; c < 2; c++) {
    const id = 'chaos' + (c + 1);
    if (!r.matrix.some(w => w.src === id || w.aux === id)) continue;
    let l = 0;
    while (l < N_LFO && (lfoUsed(r, l) || !lfoDefaultMode(r.lfo[l]) || r.lfo[l].type !== 'normal')) l++;
    if (l >= N_LFO) continue;
    const Lf = r.lfo[l], ch = r.chaos[c], k = 'c' + (c + 1), lk = 'l' + (l + 1);
    let hz = lawValue(k + '.rate', r.p[k + '.rate']);
    const sync = r.p[k + '.bpm'] >= 0.5 && hz > 0;
    Object.assign(Lf, { type: c === 0 ? 'rossler' : 'lorenz', mono: ch.mono, mode: ch.mono ? 'free' : 'retrig', bpm: sync ? 1 : 0, dot: 0, trip: 0,
      x10: 0, dir: 'fwd', swing: 0, anchor: 0 });
    for (const x of LFO_KNOBS) r.p[lk + '.' + x] = DESTS[DEST_MAP.get(lk + '.' + x)].def;
    if (sync) r.p[lk + '.rate'] = clamp(Math.round(Math.log2(LFO_LADDER[0].beats * hz * 60 / tempo)), 0, top) / top;
    else {
      if (hz > 100) { Lf.x10 = 1; hz /= 10; }
      r.p[lk + '.rate'] = lawNorm(lk + '.rate', hz);
    }
    for (const w of r.matrix) { if (w.src === id) w.src = 'lfo' + (l + 1); if (w.aux === id) w.aux = 'lfo' + (l + 1); }
  }
  return r;
}

/* ================================================================ §5.6, §5.8 macros and matrix actions (in place) */

const MACRO_SRC_RE = /^macro([1-8])$/;
// macro index 0–7 from 0–7, 'macro1'…'macro8' or 'm1'…'m8'; −1 otherwise
const macroIdx = x => (Number.isInteger(x) && x >= 0 && x < N_MACRO ? x : typeof x === 'string' && /^(macro|m)[1-8]$/.test(x) ? +x.slice(-1) - 1 : -1);
// base n of an FX destination written back into the FX state (v1: fx.p under the v1 id; v2: the instance through fxDest)
function fxBaseSet(fx, id, n) {
  if (!isObj(fx)) return;
  if (isObj(fx.p)) {
    const sid = own(UNRENAME, id) ? UNRENAME[id] : id, i = destIdx(sid);
    if (i >= 0) fx.p[sid] = snapN(i, clamp01(n)) + 0;
    return;
  }
  const d = fxDestOf(id, fx);
  if (d && isObj(d.inst) && isObj(d.inst.p) && isObj(d.row)) d.inst.p[d.pid] = L.snapN(d.row.law, d.row.lo, d.row.hi, clamp01(n)) + 0;
}

// a dynamic FX destination a row can modulate in v2 FX state fx (fxDest resolves it, not nomod; = compileCore / rowInfo)
function fxModOk(id, fx) {
  const d = fxDestOf(id, fx);
  return !!d && !d.nomod && fin(d.flat);
}
// "Apply and Delete Macros" (§5.8): every active row from macro1…8 to a stored (non-virtual) destination adds its current
// offset — amt·out·x of §5.2 at the macro's value (editable curve or curve bend, polarity; no aux, no slew) — to the
// destination's base; offsets onto one destination are summed, then clamped (= the eff value); a row on the other mode's
// field of an S1 pair acts on the active field (compile rule), and the pair's other field follows (syncS1, §2.6.4: forward
// map from a v1 field, inverse map from a counterpart whose new value has an S1 rendition). FX bases are written into
// `fx`. Then every row whose source or aux is a macro is cleared. Returns the number of rows cleared.
export function applyMacros(s, fx) {
  if (!isObj(s) || !isObj(s.p)) return 0;
  const M = rowsOf(s), s1 = s1Of({ s }), sum = new Map();
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    const w = M[r], mm = rowActive(w) ? MACRO_SRC_RE.exec(w.src) : null;
    if (!mm || (w.aux && !SRC_MAP.has(w.aux))) continue;
    let id = w.dst;
    const i = destIdx(id);
    if (i >= 0 && (IS_VIRTUAL[i] || own(FORCED, id))) continue;
    if (i < 0 && !FX_DYN_RE.test(String(id))) continue;
    // an FX row the compiler treats as inactive (v2 FX state: missing instance, Convolve shaping parameter, deviation 20)
    // has no audible offset: deleted below without being applied
    if (isFx2(fx) && /^fx\./.test(id) && !fxModOk(id, fx)) continue;
    const Mc = arrOf(s.macros)[+mm[1] - 1];
    let u = isObj(Mc) ? num(Mc.v, 0, 0, 1) : 0;
    if (Array.isArray(w.crv) && w.crv.length >= 2) u = clamp01(L.evalPts(w.crv, u));
    else if (fin(w.curve) && w.curve !== 0) { const k = MC_K * clamp(w.curve, -1, 1); u = (1 - Math.exp(-k * u)) / (1 - Math.exp(-k)); }
    let amt = clamp(w.amt, -1, 1) * clamp(w.out, 0, 1);
    if (i >= 0 && (s1 ? own(ALIAS_S2, id) : own(ALIAS_V1, id))) { const to = s1 ? ALIAS_S2[id] : ALIAS_V1[id]; amt *= rangeOfId(id) / rangeOfId(to); id = to; }
    sum.set(id, (sum.get(id) || 0) + amt * (w.bi ? u - 0.5 : u));
  }
  for (const [id, off] of sum) {
    const n = destBase(s, fx, id) + off;
    if (isFxId(id) && id !== 'g.master' && id !== 'g.bypass') fxBaseSet(fx, id, n);
    else {
      const j = DEST_MAP.get(id);
      s.p[id] = snapN(j, clamp01(n)) + 0;
      if (own(PAIR_OF, id)) syncS1(s, id);
    }
  }
  let k = 0;
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    if (isObj(M[r]) && (MACRO_SRC_RE.test(M[r].src) || MACRO_SRC_RE.test(M[r].aux))) { M[r] = emptyRowOf(M); k++; }
  }
  return k;
}

// Dropping a macro tile on another macro's label (§5.6, inv B17): macros a and b (0–7 or 'macroN' / 'mN') exchange name
// and value, and every reference: row sources / aux sources (macroA ↔ macroB), row destinations (mA ↔ mB), the MIDI map,
// parameter locks and the clip slots' macro lanes. Returns false for bad or equal indices.
export function swapMacros(s, a, b) {
  const ia = macroIdx(a), ib = macroIdx(b);
  if (!isObj(s) || !Array.isArray(s.macros) || ia < 0 || ib < 0 || ia === ib) return false;
  const t = s.macros[ia];
  s.macros[ia] = s.macros[ib];
  s.macros[ib] = t;
  const sa = 'macro' + (ia + 1), sb = 'macro' + (ib + 1), da = 'm' + (ia + 1), db = 'm' + (ib + 1);
  const sw = (x, p, q) => (x === p ? q : x === q ? p : x);
  for (const w of rowsOf(s)) if (isObj(w)) { w.src = sw(w.src, sa, sb); w.aux = sw(w.aux, sa, sb); w.dst = sw(w.dst, da, db); }
  if (isObj(s.midi)) for (const k of Object.keys(s.midi)) s.midi[k] = sw(sw(s.midi[k], sa, sb), da, db);
  if (isObj(s.locks) && Array.isArray(s.locks.p)) s.locks.p = s.locks.p.map(id => sw(id, da, db));
  if (isObj(s.clip)) {
    for (const C of arrOf(s.clip.clips)) {
      const ln = isObj(C) ? C.lanes : null;
      if (isObj(ln)) { const x = ln[da]; ln[da] = ln[db]; ln[db] = x; }
    }
  }
  return true;
}

// Main menu "Init Modulations" (§11.1): every matrix row cleared and every LFO point's bus link removed. Returns the number
// of non-empty rows cleared.
export function initMods(s) {
  if (!isObj(s)) return 0;
  const M = rowsOf(s);
  let k = 0;
  for (let r = 0; r < M.length && r < N_MATRIX; r++) {
    if (isObj(M[r]) && (M[r].src || M[r].dst)) k++;
    M[r] = emptyRowOf(M);
  }
  for (const Lf of arrOf(isObj(s) ? s.lfo : null)) {
    if (isObj(Lf) && Array.isArray(Lf.pts)) Lf.pts = Lf.pts.map(p => (Array.isArray(p) && p.length > 3 ? p.slice(0, 3) : p));
  }
  return k;
}

/* ================================================================ §11.1 menus (destination / source) and Sort */

// destination menu group order; the S1 legacy destinations (the v1 fields of S1_PAIRS and the Chaos rows) form 'S1'
const DEST_GROUP_ORDER = (() => {
  const g = [];
  for (const K of ['A', 'B', 'C']) g.push(`Osc ${K}`, `Osc ${K} Sample`, `Osc ${K} Granular`, `Osc ${K} Spectral`, `Osc ${K} Multisample`);
  g.push('Noise', 'Sub', 'Filter', 'Filter 2', 'Mixer');
  for (let e = 1; e <= N_ENV; e++) g.push('Env ' + e);
  for (let l = 1; l <= N_LFO; l++) g.push('LFO ' + l);
  g.push('Macros', 'Voice Control', 'Arp', 'Clip', 'Global', 'LFO Bus', 'Master', 'S1');
  return g;
})();
const GROUP_RANK = new Map(DEST_GROUP_ORDER.map((g, i) => [g, i]));
const S1_LEGACY = new Set(['a.warpMode', 'b.warpMode', 's.shape', 'f.type', 'g.bendup', 'g.benddn', 'c1.rate', 'c2.rate', 'c1.bpm', 'c2.bpm']);
// sample-type groups shown for these oscillator types (or when a row targets one of their destinations)
const TYPE_GROUPS = { Sample: ['sample', 'gran', 'spec'], Granular: ['gran'], Spectral: ['spec'], Multisample: ['multi'] };
const groupOfDest = i => (S1_LEGACY.has(DESTS[i].id) ? 'S1' : DESTS[i].group);

// Destination menu (§11.1): [{group, items: [{id, label}]}] in DEST_GROUP_ORDER, then one group per FX instance (fxLayout
// order, group 'FX ' + instLabel, item labels destLabel; Convolve's nomod parameters omitted). opts.matrix lists the matrix-only
// destinations (MATRIX_ONLY) too. An oscillator's Sample / Granular / Spectral / Multisample groups are listed for the
// types that use them; the S1 group (v1 warp / sub shape / filter type / bend fields, Chaos rates) when s1 or in use.
// Virtual destinations (macros m1…m8, arp.*, clip.*) are listed. Static v1 FX rows are never listed (an FX state is
// required for FX destinations, §3.11.1).
export function destMenu(s, fx, opts) {
  const o = objOf(opts), S = isObj(s) ? s : null, used = new Set(), groups = new Map();
  for (const w of rowsOf(S)) if (isObj(w) && w.dst) used.add(w.dst);
  const chaosUsed = rowsOf(S).some(w => isObj(w) && (/^chaos[12]$/.test(String(w.src)) || /^chaos[12]$/.test(String(w.aux))));
  const s1 = s1Of({ s: S }), types = [0, 1, 2].map(k => oscTypeOf(S, k));
  const shown = new Map();
  const groupShown = g => {
    if (shown.has(g)) return shown.get(g);
    let ok = true;
    const m = /^Osc ([ABC]) (Sample|Granular|Spectral|Multisample)$/.exec(g);
    if (m) ok = TYPE_GROUPS[m[2]].indexOf(types['ABC'.indexOf(m[1])]) >= 0;
    else if (g === 'S1') ok = s1 || chaosUsed;
    if (!ok) ok = DESTS.some((d, i) => groupOfDest(i) === g && used.has(d.id));
    shown.set(g, ok);
    return ok;
  };
  for (let i = 0; i < ND; i++) {
    const d = DESTS[i];
    if (isFxId(d.id) && d.id !== 'g.master' && d.id !== 'g.bypass') continue;
    if (!o.matrix && MATRIX_ONLY.indexOf(d.id) >= 0) continue;
    const g = groupOfDest(i);
    if (!GROUP_RANK.has(g) || !groupShown(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ id: d.id, label: destLabel(d.id, S, fx) });
  }
  const out = DEST_GROUP_ORDER.filter(g => groups.has(g)).map(g => ({ group: g, items: groups.get(g) }));
  let layout = null;
  if (isObj(fx) && typeof FXC.fxLayout === 'function') { try { layout = FXC.fxLayout(fx); } catch (err) { layout = null; } }
  for (const e of layout ? layout.inst : []) {
    const tab = FXC.FXP_TAB && FXC.FXP_TAB[e.type] ? FXC.FXP_TAB[e.type][e.v] : null, items = [];
    for (const row of arrOf(tab)) {
      if (row.nomod) continue;
      const id = 'fx.' + e.id + '.' + row.pid;
      items.push({ id, label: destLabel(id, S, fx) });
    }
    let g = e.id;
    g = fxLabelOf(fx, e.id) || e.id;
    if (items.length) out.push({ group: 'FX ' + g, items });
  }
  return out;
}

// Source menu (§3.10 SRC_MENU2 order): [{group, items: [{id, label}]}]; macro items carry the macro names; LFO Y outputs
// only for Path-type LFOs (or when a row reads them); the S1 chaos sources only in S1 mode or when a row reads them.
const SRC_GROUP = id => (/^env\d$/.test(id) ? 'Envelopes' : /^lfo\d+y?$/.test(id) ? 'LFOs' : /^macro\d$/.test(id) ? 'Macros'
  : /^(rand1|rand2|randd|alt1|alt2)$/.test(id) ? 'Random' : /^(osca|oscb|oscc|sub|noise|filt1|filt2)$/.test(id) ? 'Audio'
  : /^(actv|vidx|vmod1|vmod2)$/.test(id) ? 'Voice' : /^chaos[12]$/.test(id) ? 'S1' : id === 'fixed' ? 'Fixed' : 'Performance');
export function srcMenu(s) {
  const S = isObj(s) ? s : null, used = new Set(), out = [], s1 = s1Of({ s: S });
  for (const w of rowsOf(S)) if (isObj(w)) { if (w.src) used.add(w.src); if (w.aux) used.add(w.aux); }
  for (const id of SRC_MENU2) {
    const y = /^lfo(\d+)y$/.exec(id);
    if (y) { const Lf = S ? arrOf(S.lfo)[+y[1] - 1] : null; if (!(isObj(Lf) && Lf.type === 'path') && !used.has(id)) continue; }
    if (/^chaos[12]$/.test(id) && !s1 && !used.has(id)) continue;
    const g = SRC_GROUP(id), m = MACRO_SRC_RE.exec(id), Mc = m && S ? arrOf(S.macros)[+m[1] - 1] : null;
    const label = isObj(Mc) && typeof Mc.name === 'string' && Mc.name ? Mc.name : SOURCES[SRC_MAP.get(id)].label;
    if (!out.length || out[out.length - 1].group !== g) out.push({ group: g, items: [] });
    out[out.length - 1].items.push({ id, label });
  }
  return out;
}

// rank of a destination in the destination-menu order: [group rank, static index, ''] for synth rows; FX ids after them —
// with an FX state in the menu's FX order (fxLayout instance order, then parameter order: the FX-context index of
// fxDest(id, fx).flat), instances that no longer exist after those; without one by id —; unknown ids last
const destRank = (id, fx) => {
  const i = destIdx(id);
  if (i >= 0 && !(isFxId(id) && id !== 'g.master' && id !== 'g.bypass')) return [GROUP_RANK.has(groupOfDest(i)) ? GROUP_RANK.get(groupOfDest(i)) : 900, i, ''];
  if (typeof id !== 'string' || !FX_DYN_RE.test(id)) return [2000, 0, String(id)];
  const d = fxDestOf(id, fx);
  return d && fin(d.flat) ? [1000, d.flat, ''] : [1001, 0, id];
};
// Matrix "Sort by Source / Destination" (§5.8; in place): stable sort of the non-empty rows by SRC_MENU2 order ('src') or
// destination-menu order ('dst'; pass the track's FX state `fx` so FX rows follow the menu's instance order, else they
// sort by id); empty rows last. Returns false for a bad mode.
export function sortMatrix(s, mode, fx) {
  if ((mode !== 'src' && mode !== 'dst') || !isObj(s) || !Array.isArray(s.matrix)) return false;
  const M = s.matrix, n = Math.min(M.length, N_MATRIX);
  const keyOf = w => {
    if (!isObj(w) || (!w.src && !w.dst)) return [1, 0, 0, ''];
    if (mode === 'src') { const k = SRC_MENU2.indexOf(w.src); return [0, k < 0 ? 999 : k, 0, '']; }
    return [0].concat(destRank(w.dst, fx));
  };
  const rows = M.slice(0, n).map((w, i) => ({ w, i, k: keyOf(w) }));
  rows.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || (a.k[3] < b.k[3] ? -1 : a.k[3] > b.k[3] ? 1 : 0) || a.i - b.i);
  rows.forEach((x, r) => { M[r] = x.w; });
  return true;
}

/* ================================================================ §11.1 Init Preset, hybridize, assets, FX modded */

// Init Preset (manual p.33, §11.1): {s, fx} — s = defaultSerum() with the preference-driven fields (prefs.defOs → global.os,
// prefs.author, prefs.view3d → ui.view3d, prefs.mpeDefault → global.mpe.on), every lock removed, ui.page kept from cur;
// fx = fx-core's defaultFx() with every rack lock cleared. Does not go through applyPreset.
export function initPreset(cur, prefs) {
  const P = objOf(prefs), s = defaultSerum(), c = objOf(cur), U = objOf(c.ui);
  if (P.defOs === 1 || P.defOs === 2 || P.defOs === 4) s.global.os = P.defOs;
  if (typeof P.author === 'string') s.author = P.author.slice(0, 64);
  if (P.view3d) s.ui.view3d = s.ui.view3d.map(() => 1);
  if (P.mpeDefault) s.global.mpe.on = 1;
  if (UI_PAGES.indexOf(U.page) >= 0) s.ui.page = U.page;
  const fx = FXC.defaultFx();
  if (isObj(fx)) {
    if ('lock' in fx) fx.lock = 0;
    for (const R of arrOf(fx.racks)) if (isObj(R)) R.lock = 0;
  }
  return { s, fx };
}

// mulberry32 (the same generator as wt.js; serum-core may not import wt.js)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const GENES = MODULE_NAMES.filter(m => m !== 'matrix').concat(['macros', 'voicing', 'global', 'fx']);
const GLOBAL_GENE_GROUPS = ['Global', 'Mixer', 'Master', 'Chaos'];
// gene of a row's destination: its module, 'macros' (m1…m8), 'fx' (FX ids), 'bus' (LFO buses), else 'global'
function geneOfDest(id) {
  if (isFxId(id) && id !== 'g.master' && id !== 'g.bypass') return 'fx';
  for (const m of MODULE_NAMES) if (MODULE_DESTS[m].has(id)) return m;
  if (/^m[1-8]$/.test(id)) return 'macros';
  if (/^bus([1-9]|1[0-6])$/.test(id)) return 'bus';
  return 'global';
}
// a parent preset → {s (normalised), fx}: preset objects {v: {s}, fx}, {s, fx} pairs or bare states
function parentOf(x) {
  if (!isObj(x)) return null;
  const st = isObj(x.v) && isObj(x.v.s) ? x.v.s : isObj(x.s) ? x.s : isObj(x.p) ? x : null;
  if (!st) return null;
  return { s: normalizeSerum(st), fx: isObj(x.fx) ? x.fx : null };
}

// Preset browser Hybridize (inv B25): {s, fx} mixing the parents gene by gene — genes = the MODULE_FIELDS modules (minus
// the matrix), macros, voicing, global (global state minus os / a4, the Global / Mixer / Master / Chaos destinations,
// chaos, kbd, lfoGrid) and the FX state (taken whole); each gene's parent is a mulberry32(seed) draw in GENES order
// (opts.favor = index of the favoured parent: probability ½, the others share ½ equally; else uniform). The base (os, a4,
// author, tags, ui, midi, locks) is the favoured parent, else the first. Matrix rows follow the parent of their
// destination's gene (rows to LFO buses follow the parents of the LFOs that link them; unlinked bus rows are pruned), in
// parent then slot order, up to 64. Deterministic per seed; s is normalised; fx is the chosen parent's (or defaultFx()).
export function hybridize(presets, opts) {
  const o = objOf(opts), list = arrOf(presets).map(parentOf).filter(Boolean), N = list.length;
  if (!N) return { s: defaultSerum(), fx: FXC.defaultFx() };
  const rnd = mulberry32(fin(o.seed) ? o.seed : 0);
  const fav = Number.isInteger(o.favor) && o.favor >= 0 && o.favor < N ? o.favor : -1;
  const pick = () => {
    const u = rnd();
    if (N === 1) return 0;
    if (fav < 0) return Math.min(N - 1, Math.floor(u * N));
    if (u < 0.5) return fav;
    const k = Math.min(N - 2, Math.floor((u - 0.5) * 2 * (N - 1)));
    return k >= fav ? k + 1 : k;
  };
  const gene = {};
  for (const g of GENES) gene[g] = pick();
  const r = clone(list[fav >= 0 ? fav : 0].s);
  for (const m of MODULE_NAMES) if (m !== 'matrix') copyFields(r, list[gene[m]].s, m, m);
  r.macros = clone(list[gene.macros].s.macros);
  r.voicing = clone(list[gene.voicing].s.voicing);
  const G = list[gene.global].s, os = r.global.os, a4 = r.global.a4;
  r.global = Object.assign(clone(G.global), { os, a4 });
  for (const d of DESTS) if (GLOBAL_GENE_GROUPS.indexOf(d.group) >= 0 && own(G.p, d.id)) r.p[d.id] = G.p[d.id];
  r.chaos = clone(G.chaos);
  r.kbd = clone(G.kbd);
  r.lfoGrid = clone(G.lfoGrid);
  // S1 pairs (§2.6.4): S1 mode comes with the global gene; a pair whose module came from a parent in the other mode plays
  // that parent's rendition (applyPreset's rule: S2 mode when one has no S1 rendition)
  const pairSrc = p => { const m = moduleOf(p.v1[0]); return m ? list[gene[m]].s : G; };
  if (S1_PAIRS.some(p => s1Of({ s: pairSrc(p) }) !== s1Of({ s: r }))) reconcilePairs(r, pairSrc);
  // rows
  const linked = list.map(() => new Set());
  for (let l = 0; l < N_LFO; l++) for (const b of ptsBuses(list[gene['lfo' + (l + 1)]].s.lfo[l].pts)) linked[gene['lfo' + (l + 1)]].add(b);
  const rows = [];
  list.forEach((P, p) => {
    for (const w of P.s.matrix) {
      if (!w.dst || rows.length >= N_MATRIX) continue;
      const g = geneOfDest(w.dst);
      if (g === 'bus' ? linked[p].has(busNum(w.dst)) : gene[g] === p) rows.push(clone(w));
    }
  });
  r.matrix = Array.from({ length: N_MATRIX }, (_, k) => rows[k] || emptyRow());
  pruneBuses(r);
  const fx = list[gene.fx].fx;
  return { s: normalizeSerum(r), fx: fx ? clone(fx) : FXC.defaultFx() };
}

// asset ids a state references (§9.1 samples and multisamples, user and factory; for embedding, §9.8): every
// oscillator's smp (fsmp: / smp:) and multi (fmsmp: / msmp:) whatever its current type. Zone samples of multisamples are
// resolved by the host. Wavetables are not assets: tableNeeds lists the user tables (embedded as wts, Phase 1).
const ASSET_RE = /^(fsmp|smp|fmsmp|msmp):./;
export function assetNeeds(s) {
  const out = [];
  const add = id => { if (typeof id === 'string' && ASSET_RE.test(id) && out.indexOf(id) < 0) out.push(id); };
  for (const O of arrOf(isObj(s) ? s.osc : null)) if (isObj(O)) { add(O.smp); add(O.multi); }
  return out;
}
// user wavetable and user noise ids a state references (exported preset / project files embed them as `wts`, Phase-1
// rule; the host's list for embedding): every oscillator's table osc[0–2].wt, a table played as a sample by a Sample /
// Granular / Spectral oscillator (osc[i].smp = 'user:…', §9.4.8), the spectral filter's table (osc[i].spec.filt.wt) —
// each whatever the oscillator's current type or power — and the noise sample (nzuser:). Order: first reference.
const TABLE_RE = /^(user|nzuser):./;
export function tableNeeds(s) {
  const out = [];
  const add = id => { if (typeof id === 'string' && TABLE_RE.test(id) && out.indexOf(id) < 0) out.push(id); };
  if (!isObj(s)) return out;
  for (const O of arrOf(s.osc)) {
    if (!isObj(O)) continue;
    add(O.wt);
    if (typeof O.smp === 'string' && /^user:/.test(O.smp)) add(O.smp);
    const F = isObj(O.spec) && isObj(O.spec.filt) ? O.spec.filt : null;
    if (F && typeof F.wt === 'string' && /^user:/.test(F.wt)) add(F.wt);
  }
  if (isObj(s.noise) && typeof s.noise.src === 'string' && /^nzuser:/.test(s.noise.src)) add(s.noise.src);
  return out;
}

// compileFx v2 `modded` (§11.1): Uint8Array(NFX = 8 + fxLayout(fx).NP), 1 at FX-context index k when an active row of s
// targets it (0 g.master, 1 g.bypass, 2 g.direct, 3 g.bus1v, 4 g.bus2v; 8 + flat for dynamic FX ids through fxDest).
// Convolve's nomod parameters are never marked. Without an FX state NFX = 8.
export function fxModded2(s, fx) {
  let layout = null;
  if (isObj(fx) && typeof FXC.fxLayout === 'function') { try { layout = FXC.fxLayout(fx); } catch (err) { layout = null; } }
  const out = new Uint8Array(8 + (layout && fin(layout.NP) ? layout.NP : 0));
  for (const w of rowsOf(s).slice(0, N_MATRIX)) {
    if (!rowActive(w) || !SRC_MAP.get(w.src) || (w.aux && !SRC_MAP.has(w.aux))) continue;
    if (own(FXCTX, w.dst)) out[FXCTX[w.dst]] = 1;
    else if (layout && isFxId(w.dst)) {
      const d = fxDestOf(w.dst, fx);
      if (d && !d.nomod && fin(d.flat) && 8 + d.flat < out.length) out[8 + d.flat] = 1;
    }
  }
  return out;
}

/* ================================================================ §13 editing helpers of the v2 UI actions (in place) */

// ---- generic base write (knobs, typed entry, MIDI learn): every kind of destination
// In place: base n of `id` ← n (clamped; stepped laws grid-snapped): synth ids and g.master / g.bypass in s.p, macros
// m1…m8 in s.macros[m].v, the virtual arp.* / clip.* in the selected slot's / clip's n (opts.all: every slot / clip — ARP
// / CLIP "EDIT ALL"), dynamic FX ids in the instance's p (v1 FX states: fx.p). Returns the n written, or null (unknown id,
// the placeholders bus1–16 / g.wheel / g.bend that normalisation always resets, bad n). Paired S1 fields are not synchronised here: the panel calls syncS1 after the edit (§2.6.4).
export function setDestBase(s, fx, id, n, opts) {
  if (!fin(n) || typeof id !== 'string') return null;
  const x = clamp01(n);
  if (isFxId(id) && id !== 'g.master' && id !== 'g.bypass') {
    const r = fxRow(id, fx) || (isObj(fx) && isObj(fx.p) ? rowOf(own(UNRENAME, id) ? UNRENAME[id] : id, null) : null);
    if (!r) return null;
    fxBaseSet(fx, id, x);
    return destBase(s, fx, id);
  }
  const i = destIdx(id);
  if (i < 0 || !isObj(s) || own(FORCED, id)) return null;          // placeholders (bus1–16, g.wheel, g.bend) have no base
  const v = snapN(i, x) + 0, mi = /^m[1-8]$/.test(id) ? +id.charAt(1) - 1 : -1;
  if (mi >= 0) { if (!Array.isArray(s.macros) || !isObj(s.macros[mi])) return null; s.macros[mi].v = v; return v; }
  if (IS_VIRTUAL[i]) {
    const N = seqN(s, id);
    if (!N) return null;
    if (objOf(opts).all) { for (const X of N.list) if (isObj(X) && isObj(X.n)) X.n[N.keyOf(X)] = v; } else N.n[N.key] = v;
    return v;
  }
  if (!isObj(s.p)) s.p = {};
  s.p[id] = v;
  return v;
}

// ---- envelope / multisample-delay time units (§6.14 "switching units converts the base value to the nearest entry at
// the current tempo", inv B15; §6.8 DELAY BPM)
const ENV_TIME_KEYS = ['att', 'hold', 'dec', 'rel'], ENV_LAD_N = ENV_LADDER.length - 1;
// ENV_LADDER index nearest to `beats` (log distance; below half of the first non-zero entry: entry 0 = 0 s)
function envLadIdx(beats) {
  if (!(beats > ENV_LADDER[1].beats / 2)) return 0;
  let best = 1, bd = Infinity;
  for (let j = 1; j <= ENV_LAD_N; j++) { const d = Math.abs(Math.log2(ENV_LADDER[j].beats / beats)); if (d < bd - 1e-12) { bd = d; best = j; } }
  return best;
}
const tempoOf = bpm => (fin(bpm) && bpm > 0 ? clamp(bpm, 20, 999) : 120);
// base n of time destination id converted from seconds (its law) to ENV_LADDER units at `tempo`, or back
function convTime(s, id, toBpm, tempo) {
  const i = DEST_MAP.get(id), n = num(s.p[id], DESTS[i].def, 0, 1);
  s.p[id] = toBpm ? envLadIdx(lawValue(i, n) * tempo / 60) / ENV_LAD_N : lawNorm(i, ENV_LADDER[Math.round(n * ENV_LAD_N)].beats * 60 / tempo);
}
// ENV e (0–3) MS/BPM toggle: env[e].bpm ← on; switching converts A/H/D/R to the nearest ENV_LADDER entry at `bpm` (BPM on)
// or to the seconds of the entry (BPM off; capped at 32 s). Returns false for bad arguments.
export function setEnvBpm(s, e, on, bpm) {
  const E = isObj(s) && isObj(s.p) && Array.isArray(s.env) && Number.isInteger(e) && e >= 0 && e < N_ENV ? s.env[e] : null;
  if (!isObj(E)) return false;
  const want = on ? 1 : 0;
  if (bit(E.bpm, 0) !== want) for (const k of ENV_TIME_KEYS) convTime(s, 'e' + (e + 1) + '.' + k, want, tempoOf(bpm));
  E.bpm = want;
  return true;
}
// Multisample envelope DELAY menu "BPM Sync" of oscillator o (0–2): osc[o].msmo.dlyBpm ← on, k.mdly converted as setEnvBpm
export function setMsDelayBpm(s, o, on, bpm) {
  const O = isObj(s) && isObj(s.p) && Array.isArray(s.osc) && (o === 0 || o === 1 || o === 2) ? s.osc[o] : null;
  if (!isObj(O)) return false;
  if (!isObj(O.msmo)) O.msmo = { override: 0, dlyBpm: 0 };
  const want = on ? 1 : 0;
  if (bit(O.msmo.dlyBpm, 0) !== want) convTime(s, 'abc'.charAt(o) + '.mdly', want, tempoOf(bpm));
  O.msmo.dlyBpm = want;
  return true;
}

// ---- filter routing switches S A B C N (§13.3 FILTER 1 / 2, inv B12/B13)
const CH_LETTER = ['A', 'B', 'C', 'N', 'S'], CH_KEY = ['a', 'b', 'c', 'n', 's'];
const chIdx = ch => (Number.isInteger(ch) && ch >= 0 && ch < 5 ? ch : typeof ch === 'string' ? CH_LETTER.indexOf(ch.toUpperCase()) : -1);
const chObj = (s, x) => (x < 3 ? arrOf(s.osc)[x] : x === 3 ? s.noise : s.sub);
const switchId = (k, x) => (k ? 'f2.route' : 'f.route') + CH_LETTER[x];
// balance share of filter k (0, 1) of channel x: s1 = (1 − b)/2, s2 = (1 + b)/2 (§6.12; base values)
const shareOf = (s, k, x) => { const b = lawValue(CH_KEY[x] + '.fbal', destBase(s, null, CH_KEY[x] + '.fbal')); return k ? (1 + b) / 2 : (1 - b) / 2; };
// Is the switch of channel ch ('A' 'B' 'C' 'N' 'S' or 0–4) lit on filter k (0 = Filter 1, 1 = Filter 2)? = the channel is
// routed to Filter, its balance gives filter k a share, and the filter's route switch for it is on (base values).
export function filterFeeds(s, k, ch) {
  const x = chIdx(ch), X = isObj(s) && x >= 0 ? chObj(s, x) : null;
  if (!isObj(X) || (k !== 0 && k !== 1)) return false;
  return X.route === 0 && shareOf(s, k, x) > 0 && destBase(s, null, switchId(k, x)) >= 0.5;
}
// Tap on a routing switch (§13.3 "tap toggles the switch and, when off-route, sets the source's route to Filter with the
// balance at this filter"): a channel routed to Filter toggles the switch only (the balance is never moved, so the other
// filter's feed is untouched and two taps restore the state; with no share for filter k the switch stays unlit); an
// off-route channel (Main / Direct / None) is routed to Filter with the balance fully at filter k (fbal n 0 = Filter 1,
// 1 = Filter 2) and the switch on. Returns the new lit state (false also for bad arguments).
export function toggleFilterRoute(s, k, ch) {
  const x = chIdx(ch), X = isObj(s) && isObj(s.p) && x >= 0 ? chObj(s, x) : null;
  if (!isObj(X) || (k !== 0 && k !== 1)) return false;
  const sw = switchId(k, x);
  if (X.route === 0) s.p[sw] = destBase(s, null, sw) >= 0.5 ? 0 : 1;
  else { X.route = 0; s.p[CH_KEY[x] + '.fbal'] = k; s.p[sw] = 1; }
  return filterFeeds(s, k, x);
}

// ---- locks (inv B2: Lock Module, Lock / Unlock Control inside a locked module, parameter locks)
const MODULE_OF = new Map();
for (const m of MODULE_NAMES) for (const id of MODULE_DESTS[m]) if (!MODULE_OF.has(id)) MODULE_OF.set(id, m);
// module (MODULE_FIELDS key) whose destinations include id (incl. the virtual Arp / Clip controls); '' for none (global,
// macro and FX destinations)
export function moduleOf(id) { return typeof id === 'string' && MODULE_OF.has(id) ? MODULE_OF.get(id) : ''; }
const lockArrs = s => {
  if (!isObj(s.locks)) s.locks = { p: [], mod: [], unp: [], misc: { poly: 0, os: 0, tuning: 0 } };
  const Lk = s.locks;
  for (const k of ['p', 'mod', 'unp']) if (!Array.isArray(Lk[k])) Lk[k] = [];
  return Lk;
};
const drop = (a, x) => { const i = a.indexOf(x); if (i >= 0) a.splice(i, 1); };
// lock state of a control: 'param' (locks.p), 'module' (in a locked module), 'unlocked' (in a locked module, unlocked
// through locks.unp), '' (free)
export function lockState(s, id) {
  const Lk = isObj(s) && isObj(s.locks) ? s.locks : null;
  if (!Lk || typeof id !== 'string') return '';
  if (arrOf(Lk.p).indexOf(id) >= 0) return 'param';
  const m = moduleOf(id);
  return m && arrOf(Lk.mod).indexOf(m) >= 0 ? (arrOf(Lk.unp).indexOf(id) >= 0 ? 'unlocked' : 'module') : '';
}
// Knob menu Lock / Unlock Control (in place): inside a locked module, on = the module lock applies again (id leaves
// locks.unp), off = the control is unlocked (id joins locks.unp, leaves locks.p); elsewhere on / off adds / removes a
// parameter lock (locks.p). Returns false for an id that cannot be locked.
export function setLock(s, id, on) {
  if (!isObj(s) || !destIdOk(id)) return false;
  const Lk = lockArrs(s), m = moduleOf(id);
  if (m && Lk.mod.indexOf(m) >= 0) {
    if (on) drop(Lk.unp, id);
    else { drop(Lk.p, id); if (Lk.unp.indexOf(id) < 0 && Lk.unp.length < 128) Lk.unp.push(id); }
  } else if (on) { if (Lk.p.indexOf(id) < 0 && Lk.p.length < 1024) Lk.p.push(id); } else drop(Lk.p, id);
  return true;
}
// Lock Module / Lock Matrix (in place): m ∈ MODULE_FIELDS; unlocking drops the module's controls from locks.unp
export function setModuleLock(s, m, on) {
  if (!isObj(s) || !own(MODULE_FIELDS, m)) return false;
  const Lk = lockArrs(s);
  if (on) {                                            // in MODULE_NAMES order (= normalizeSerum: the same lock set, the same JSON)
    if (Lk.mod.indexOf(m) < 0) { const ord = MODULE_NAMES.filter(x => x === m || Lk.mod.indexOf(x) >= 0); Lk.mod.splice(0, Lk.mod.length, ...ord); }
  } else {
    drop(Lk.mod, m);
    Lk.unp = Lk.unp.filter(id => moduleOf(id) !== m);
  }
  return true;
}

// ---- pitch mode menu (§13.3 Pitch row; §2.2.5 ratio sources)
// Oscillator o (0–2): pitch.mode ← mode (PITCH_MODES id; undefined / null keeps it), pitch.src ← src ('note' 'A' 'B' 'C';
// the oscillator itself → 'note'). A ratio-source cycle through o is broken with o as the most recent choice: the
// oscillator on the cycle that reads o falls back to 'note'. Returns the oscillators reset ([] also for bad arguments).
// Step mode is accepted without a .scl (the DSP then plays Semitones; the menu disables it, tuningInfo(s).step).
export function pitchChoice(s, o, mode, src) {
  const O = isObj(s) && Array.isArray(s.osc) && (o === 0 || o === 1 || o === 2) ? s.osc[o] : null;
  if (!isObj(O)) return [];
  const hasM = mode !== undefined && mode !== null, hasS = src !== undefined && src !== null;
  if ((hasM && PITCH_MODE_IDS.indexOf(mode) < 0) || (hasS && ['note', 'A', 'B', 'C'].indexOf(src) < 0)) return [];
  if (!isObj(O.pitch)) O.pitch = { mode: 'semi', src: 'note' };
  if (hasM) O.pitch.mode = mode;
  if (hasS) O.pitch.src = src === 'ABC'.charAt(o) ? 'note' : src;
  const reset = [];
  for (let guard = 0; guard < N_OSC; guard++) {
    const next = s.osc.map(X => (isObj(X) && isObj(X.pitch) && X.pitch.mode === 'ratio' ? 'ABC'.indexOf(X.pitch.src) : -1));
    let x = next[o], prev = o, hit = -1;
    for (let k = 0; k < N_OSC && x >= 0; k++) { if (x === o) { hit = prev; break; } prev = x; x = next[x]; }
    if (hit < 0 || hit === o) break;
    s.osc[hit].pitch.src = 'note';
    reset.push(hit);
  }
  return reset;
}

// ---- matrix rows (§13.6)
// Drag handle: row `from` moves to slot `to` (the rows between shift by one). Returns false for bad slots.
export function moveMod(s, from, to) {
  if (!slotOk(s, from) || !slotOk(s, to)) return false;
  if (from !== to) { const w = s.matrix.splice(from, 1)[0]; s.matrix.splice(to, 0, w); }
  return true;
}
// Points for the Editable Curve editor of row `slot` (kind mcurve): a copy of its crv, else the graph equal to its
// Phase-1 curve bend (§5.2): unipolar source [[0, 0, c], [1, 1, 0]], bipolar [[0, 0, −c], [½, ½, c], [1, 1, 0]] with
// c = curve·MC_K/CURVE_K (the bend is odd about the centre for bipolar sources). null for a bad slot.
export function rowCurvePts(s, slot) {
  const r = rowAt(s, slot);
  if (!r) return null;
  if (Array.isArray(r.crv)) return normPts(r.crv, [[0, 0, 0], [1, 1, 0]], false, MAX_CRV_PTS);
  const c = r5(clamp((fin(r.curve) ? r.curve : 0) * MC_K / CURVE_K, -1, 1)), bi = isSrcId(r.src) && SRC_BI[SRC_MAP.get(r.src)] === 1;
  return bi ? [[0, 0, 0 - c], [0.5, 0.5, c], [1, 1, 0]] : [[0, 0, c], [1, 1, 0]];
}
// Matrix row badges (§13.6): {active (compiles, §2.3), alias (the other mode's field of an S1 pair, "≈", §2.6.4), nomod
// (a Convolve shaping parameter, deviation 20), missing (a dynamic FX id whose instance does not exist in fx)}
export function rowInfo(s, fx, slot) {
  const r = rowAt(s, slot), out = { active: false, alias: false, nomod: false, missing: false };
  if (!r || typeof r.dst !== 'string' || !r.dst) return out;
  out.alias = s1Of({ s }) ? own(ALIAS_S2, r.dst) : own(ALIAS_V1, r.dst);
  let ok;
  if (isFxId(r.dst) && !own(FXCTX, r.dst)) {
    const d = fxDestOf(r.dst, fx);
    out.missing = !d;
    out.nomod = !!d && !!d.nomod;
    ok = !!d && !d.nomod && fin(d.flat);
  } else ok = own(FXCTX, r.dst) || vi(r.dst) >= 0;
  out.active = ok && rowActive(r) && isSrcId(r.src) && (!r.aux || isSrcId(r.aux));
  return out;
}

// ---- sample operations (Sample / Granular / Spectral view menu: Trim, Reload Sample; §9.4.2, §13.3)
// Markers k.sstart / k.send / k.lstart / k.lend and slice marks are fractions of the processed sample (§6.7.7: after trim
// and reverse); ops.trim is [t0, t1] in fractions of the stored record, applied before the reverse.
const SMP_MARKS = ['sstart', 'send', 'lstart', 'lend'];
const smpoAt = (s, o) => (isObj(s) && isObj(s.p) && Array.isArray(s.osc) && (o === 0 || o === 1 || o === 2) && isObj(s.osc[o]) && isObj(s.osc[o].smpo)
  ? s.osc[o].smpo : null);
// oscillator o's markers and slice marks through x → f(x) (markers clamped to [0, 1]; marks kept inside (0, 1), sorted,
// unique); k.pos (Position, also a fraction of the processed sample) through f when it is a point — the Manual X|Y
// position of a Granular / Spectral oscillator (§6.9.1, §6.10) — else through g: a read offset pos·L (scratch, §6.7.7,
// Granular scan), kept in audio length (clamped to [0, 1])
function mapMarkers(s, o, f, g) {
  const k = 'abc'.charAt(o), sl = s.osc[o].smpo.slice, O = s.osc[o], ty = oscTypeOf(s, o);
  for (const m of SMP_MARKS) s.p[k + '.' + m] = clamp01(f(destBase(s, null, k + '.' + m))) + 0;
  const pt = (ty === 'gran' || ty === 'spec') && isObj(O.xy) && bit(O.xy.on, 0) === 1;
  s.p[k + '.pos'] = clamp01((pt ? f : g)(destBase(s, null, k + '.pos'))) + 0;
  if (isObj(sl) && Array.isArray(sl.marks)) {
    const out = [];
    for (const x of sl.marks) { const q = fin(x) ? r5(f(x)) : -1; if (q > 0 && q < 1 && out.indexOf(q) < 0) out.push(q); }
    sl.marks = out.sort((a, b) => a - b).slice(0, 256);
  }
}
// Trim (in place): the processed sample is cut to the region between the start and end markers — ops.trim becomes that
// range of the record (through the current trim and reverse) and every marker / slice mark is re-expressed in the new
// processed coordinates (start 0, end 1, the region keeps its direction). Returns false when there is nothing to trim
// (the region is the whole sample or empty) or for bad arguments.
export function trimSample(s, o) {
  const so = smpoAt(s, o);
  if (!so) return false;
  const k = 'abc'.charAt(o), S = destBase(s, null, k + '.sstart'), E = destBase(s, null, k + '.send');
  const a = Math.min(S, E), b = Math.max(S, E), ops = isObj(so.ops) ? so.ops : (so.ops = { fade: 0, norm: 0, rev: 0, trim: null });
  if (!(b - a >= 1e-4) || (a <= 0 && b >= 1)) return false;
  const tr = Array.isArray(ops.trim) && ops.trim.length === 2 ? ops.trim : [0, 1], w = tr[1] - tr[0];
  const lo = ops.rev ? tr[1] - b * w : tr[0] + a * w, hi = ops.rev ? tr[1] - a * w : tr[0] + b * w;
  if (!(r5(hi) > r5(lo))) return false;
  ops.trim = [r5(lo), r5(hi)];
  mapMarkers(s, o, x => (x - a) / (b - a), x => x / (b - a));
  return true;
}
// Reload Sample (in place, §9.4.2): smpo.ops cleared; markers and slice marks are carried to the record's coordinates so
// they keep pointing at the same audio (a reversed sample's region then plays backwards: start after end). false for bad
// arguments.
export function clearSampleOps(s, o) {
  const so = smpoAt(s, o);
  if (!so) return false;
  const ops = objOf(so.ops), tr = Array.isArray(ops.trim) && ops.trim.length === 2 ? ops.trim : [0, 1], w = tr[1] - tr[0], rev = !!bit(ops.rev, 0);
  mapMarkers(s, o, x => (rev ? tr[1] - x * w : tr[0] + x * w), x => x * w);
  so.ops = { fade: 0, norm: 0, rev: 0, trim: null };
  return true;
}

// ---- tuning files (GLOBAL > TUNING, main menu Load Tuning…; §6.18, §11.4)
// Load .scl / .kbm / .tun texts (files = {scl?, kbm?, tun?, name?}, tuning.js tuningState rules: a .scl keeps the loaded
// .kbm, a .kbm keeps the loaded .scl; {kbm: null} = Clear Mapping) into s.global.tun (in place). Returns {name, kind} or
// {error} (state unchanged).
export function loadTuning(s, files) {
  if (!isObj(s)) return { error: 'no state' };
  if (!isObj(s.global)) s.global = {};
  const r = tuningState(files, s.global.tun);
  if (r.error) return { error: r.error };
  s.global.tun = r;
  return { name: r.name, kind: r.kind };
}
// Clear Tuning (in place): 12-TET, no files
export function clearTuning(s) {
  if (!isObj(s)) return false;
  if (!isObj(s.global)) s.global = {};
  s.global.tun = defTun();
  return true;
}
// {name, kind, step (Step pitch mode available: a .scl of ≤ 128 degrees), text (tuning.js describe)}
export function tuningInfo(s) {
  const T = isObj(s) && isObj(s.global) && isObj(s.global.tun) ? s.global.tun : defTun();
  const kind = oneOf(T.kind, TUN_KINDS, 'none');
  return { name: typeof T.name === 'string' ? T.name : '', kind, step: kind === 'scl' && typeof T.scl === 'string' && !!T.scl && stepsOf(T.scl).sclN > 0,
    text: kind === 'none' ? tunDescribe(null) : tunDescribe(T.tab) };
}

// ---- Voice Control presets (§10.9, GLOBAL > VOICE CONTROL; user presets: storage key synth.sx.vc, kept by the UI)
// preset = {name, vc: {len, steps (8 × [pan, det, cut, env, m1, m2]), sel, lmode}, p: {vc.pan, vc.det, vc.cut, vc.env,
// vc.escale, vc.lscale → n}}
const VC_IDS = ['vc.pan', 'vc.det', 'vc.cut', 'vc.env', 'vc.escale', 'vc.lscale'];
const vcPre = (name, len, f, p) => ({
  name, vc: { len, steps: Array.from({ length: 8 }, (_, j) => (j < len ? f(j) : [0, 0, 0, 0, 0, 0])), sel: [1, 1, 1, 1, 1], lmode: 0 },
  p: Object.assign({ 'vc.pan': 0, 'vc.det': 0, 'vc.cut': 0, 'vc.env': 0, 'vc.escale': 0.5, 'vc.lscale': 0.5 }, p || {}),
});
const VC0 = () => [0, 0, 0, 0, 0, 0];
export const FACTORY_VC = deepFreeze([
  vcPre('Init', 1, VC0),
  vcPre('Analog Drift', 1, VC0, { 'vc.pan': 0.15, 'vc.det': 0.08, 'vc.cut': 0.1, 'vc.env': 0.1 }),
  vcPre('Stereo Spread', 4, j => [[-0.6, 0.6, -0.3, 0.3][j], 0, 0, 0, 0, 0]),
  vcPre('Round Robin Pan', 3, j => [[-0.8, 0, 0.8][j], 0, 0, 0, 0, 0]),
  vcPre('Cutoff Walk', 8, j => [0, 0, r5(-0.4 + 0.8 * j / 7), 0, 0, 0]),
  vcPre('Mod Sequence', 4, j => [0, 0, 0, 0, [-1, -0.33, 0.33, 1][j], 0]),
]);
// the current Voice Control as a preset ("Save…"); name defaults to vc.name
export function vcPresetOf(s, name) {
  const V = normVc(isObj(s) ? s.vc : null), p = {};
  for (const id of VC_IDS) p[id] = destBase(s, null, id);
  return { name: strIn(name, V.name, 24) || V.name, vc: { len: V.len, steps: V.steps, sel: V.sel, lmode: V.lmode }, p };
}
// In place: s.vc ← the preset (normalised; vc.name = preset name) and its six vc.* bases (missing → the defaults)
export function applyVcPreset(s, preset) {
  if (!isObj(s) || !isObj(preset)) return false;
  const P = objOf(preset.p);
  s.vc = normVc(Object.assign({}, objOf(preset.vc), { name: strIn(preset.name, 'Init', 24) }));
  if (!isObj(s.p)) s.p = {};
  for (const id of VC_IDS) { const i = DEST_MAP.get(id); s.p[id] = fin(P[id]) ? snapN(i, clamp01(P[id])) + 0 : DESTS[i].def; }
  return true;
}

// ---- spectral filter presets (§10.8; the Spectral FILTER display's presets menu): {name, pts} with x = log-frequency
// 20 Hz…20 kHz, y = gain, in normalised graph form (≤ 128 points)
const SPEC_X = f => Math.log(f / 20) / Math.log(1000);
// raised cosine on [a, b] (0 → h → 0) sampled at k + 1 points
const bumpPts = (a, b, h, k) => Array.from({ length: k + 1 }, (_, j) => [a + (b - a) * j / k, h * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / k)), 0]);
export const FACTORY_SPEC_FILTERS = deepFreeze([
  ['Flat', [[0, 1, 0], [1, 1, 0]]],
  ['Low Pass', [[0, 1, 0], [0.6, 1, 0], [0.75, 0, 0], [1, 0, 0]]],
  ['High Pass', [[0, 0, 0], [0.25, 0, 0], [0.4, 1, 0], [1, 1, 0]]],
  ['Band', [[0, 0, 0], ...bumpPts(0.4, 0.6, 1, 12), [1, 0, 0]]],
  ['Comb 8', Array.from({ length: 8 }, (_, t) => bumpPts(t / 8, (t + 1) / 8, 1, 8).slice(t ? 1 : 0)).flat()],
  ['Vowel A', [[0, 0, 0], ...FORMANTS[0][0].flatMap((f, j) => bumpPts(SPEC_X(f) - 0.025, SPEC_X(f) + 0.025, [1, 0.8, 0.6][j], 8)), [1, 0, 0]]],
  ['Teeth', [...Array.from({ length: 16 }, (_, t) => [[t / 16, 1, 0], [(t + 0.5) / 16, 1, 0], [(t + 0.5) / 16, 0, 0], [(t + 1) / 16, 0, 0]]).flat()]],
  ['Stairs', [[0, 1, 0], [0.25, 1, 0], [0.25, 0.75, 0], [0.5, 0.75, 0], [0.5, 0.5, 0], [0.75, 0.5, 0], [0.75, 0.25, 0], [1, 0.25, 0]]],
  ['Tilt Down', [[0, 1, 0], [1, 0.1, 0]]],
].map(([name, pts]) => ({ name, pts: normPts(pts.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]), SPEC_FLAT, false, MAX_SPEC_PTS) })));

/* ================================================================ factory presets (Phase-1 recipes, §8.1 of SPEC-serum; v2: §10.11) */

// Original sounds, written as recipes in engine units: `v` / `fx` values go through lawNorm (seconds, Hz, gains,
// semitones, enum indices as each destination's law defines them), `n` / `fxn` are knob positions (tempo ladders),
// `wt` names factory tables, `mods` are matrix rows (amounts in knob space, §5.2), `lfo` overrides LFO fields.
// Only factory:, sub: and noise: content is referenced, so every preset plays on a fresh install. Levels were set by
// rendering each preset through the engine (serum-dsp → fx-dsp → engine.js) with a typical phrase of its category
// at velocity 0.8: peaks sit between −9 and −3 dBFS.
const PTS_SINE = VIB_PTS;                                                       // one cycle from the centre
const PTS_RISE = [[0, 0, 0.35], [1, 1, 0]];                                     // slow start, faster finish
// steps(values) → a stepped graph, one flat segment per value (y ∈ [0, 1]); gate(pattern, len) → a gate for rows into g.amp
// with amount −1 (y 0 = open): 'x' opens the step for `len` of its length, '.' keeps it closed; 4 ms-ish ramps against clicks
const steps = vals => {
  const n = vals.length, out = [];
  vals.forEach((y, i) => { out.push([i / n, y, 0], [(i + 1) / n, y, 0]); });
  for (let i = out.length - 2; i >= 2; i -= 2) if (out[i - 1][1] === out[i][1]) out.splice(i - 1, 2);   // merge equal neighbours
  return out;
};
const gate = (pat, len = 0.75, e = 1 / 512) => {
  const n = pat.length, out = [[0, 1, 0]];
  for (let i = 0; i < n; i++) if (pat[i] === 'x') { const a = i / n, b = a + len / n; out.push([a, 1, 0], [a + e, 0, 0], [b - e, 0, 0], [b, 1, 0]); }
  out.push([1, 1, 0]);
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
};
const LAD = (lab, dot, trip) => { const L = lfoLadder(!!dot, !!trip); return L.findIndex(e => e.label === lab) / (L.length - 1); };
const DLY_N = lab => DLY_LADDER.findIndex(e => e.label === lab) / (DLY_LADDER.length - 1);
const dbA = db => Math.pow(10, db / 20);
const row = (src, dst, amt, o) => Object.assign(emptyRowV1(), { src, dst, amt }, o);
const st = (dst, semis, bi) => semitoneAmount(dst, semis, bi ? 1 : 0);
function recipe(name, cat, r) {
  const s = defaultV1(), fx = defaultFxV1();
  const put = (tgt, o) => { for (const id of Object.keys(o || {})) tgt.p[id] = lawNorm(id, o[id]); };
  s.author = 'Factory';
  put(s, r.v); Object.assign(s.p, r.n || {});
  if (r.wt) r.wt.forEach((t, o) => { if (t) s.osc[o].wt = 'factory:' + t; });
  if (r.remap) r.remap.forEach((p, o) => { if (p) s.osc[o].remap = clonePts(p); });
  if (r.noise) Object.assign(s.noise, r.noise);
  if (r.sub) Object.assign(s.sub, r.sub);
  if (r.filter) Object.assign(s.filter, r.filter);
  if (r.lfo) r.lfo.forEach((o, l) => { if (o) Object.assign(s.lfo[l], o, o.pts ? { pts: clonePts(o.pts) } : {}); });
  if (r.voicing) Object.assign(s.voicing, r.voicing);
  if (r.uni) { if (r.uni.range) s.global.uniRange = r.uni.range.slice(); if (r.uni.mode) s.global.uniMode = r.uni.mode.slice(); }
  if (r.macros) r.macros.forEach((m, i) => { if (m) Object.assign(s.macros[i], typeof m === 'string' ? { name: m } : m); });
  (r.mods || []).forEach((m, i) => { s.matrix[i] = m; });
  if (r.velo) veloToAmp(s);
  s.notes = r.notes || '';
  put(fx, r.fx); Object.assign(fx.p, r.fxn || {});
  if (r.rev !== undefined) fx.rev.type = r.rev;
  if (r.xs) { fx.dist.xa = clonePts(r.xs[0]); if (r.xs[1]) fx.dist.xb = clonePts(r.xs[1]); }
  return { name, cat, v: { s: normalizeV1(s) }, fx: normalizeFxV1(fx) };
}
const ON = 1, OFF = 0;
const OTT = (o) => Object.assign({ 'fx.cmp.on': ON, 'fx.cmp.mb': ON, 'fx.cmp.thr': dbA(-24), 'fx.cmp.ratio': 6, 'fx.cmp.att': 2, 'fx.cmp.rel': 90,
  'fx.cmp.mbL': 1, 'fx.cmp.mbM': 1, 'fx.cmp.mbH': 1, 'fx.cmp.gain': dbA(9), 'fx.cmp.mix': 0.6 }, o);

const PTS_PLUCK = [[0, 1, 0], [0.02, 0, 0.4], [1, 0.97, 0]];                    // per-step pluck for rows into g.amp (amount −1)
const PTS_PUMP = [[0, 0, 0], [0.04, 1, 0], [0.62, 0, -0.25], [1, 0, 0]];         // sidechain-style duck once per cycle

export const FACTORY_PRESETS_V1 = deepFreeze([
  { name: 'Init', cat: 'Init', v: { s: defaultV1() }, fx: defaultFxV1() },

  /* ---- Bass */
  recipe('Deep Sub', 'Bass', {
    notes: 'Clean sine sub with a whisper of tape saturation for small speakers. Mono with a short glide. Macro 1 adds grit.',
    wt: ['Sine'], voicing: { mono: 1, legato: 1 }, macros: ['Grit'],
    v: { 'a.level': 0.8, 'a.rand': 0, 'a.phase': 0, 'e1.att': 0.003, 'e1.rel': 0.08, 'g.porta': 0.04, 'g.master': 0.645 },
    mods: [row('macro1', 'fx.dist.drive', 0.5), row('macro1', 'fx.dist.mix', 0.6)],
    fx: { 'fx.dist.on': ON, 'fx.dist.mode': 15, 'fx.dist.drive': 0.2, 'fx.dist.mix': 0.25 },
  }),
  recipe('Reese Drift', 'Bass', {
    notes: 'Two detuned saw stacks beating against each other over a sine sub, low-passed, with a slow phaser drift. Mod wheel opens the filter.',
    voicing: { mono: 1, legato: 1 },
    v: { 'a.uni': 4, 'a.det': 0.12, 'a.level': 0.85, 'b.on': ON, 'b.uni': 4, 'b.det': 0.09, 'b.fine': 18, 'b.level': 0.85,
      's.on': ON, 's.level': 0.3, 'f.on': ON, 'f.type': 3, 'f.routeB': ON, 'f.cutoff': 1100, 'f.res': 0.2, 'f.drive': 0.08,
      'e1.att': 0.004, 'e1.rel': 0.12, 'g.porta': 0.05, 'l1.rate': 0.15, 'g.master': 0.923 },
    lfo: [{ bpm: 0, pts: PTS_SINE }],
    mods: [row('lfo1', 'f.cutoff', 0.12, { bi: 1 }), row('wheel', 'f.cutoff', 0.35)],
    fx: { 'fx.phs.on': ON, 'fx.phs.mix': 0.35, 'fx.phs.rate': 0.12, 'fx.phs.feed': 0.5, 'fx.cmp.on': ON, 'fx.cmp.att': 6, 'fx.cmp.rel': 120,
      'fx.cmp.thr': dbA(-14), 'fx.cmp.ratio': 3 },
  }),
  recipe('Neuro Snarl', 'Bass', {
    notes: 'Folded table phase-modulated by oscillator B, scanned and warped by a tempo-synced LFO into a distorted comb filter and multiband ' +
      'compression; Macro 1 morphs the X-Shaper between its two fold curves. The sine sub runs DIRECT OUT, clean under the mayhem. ' +
      'Macro 2 = LFO rate.',
    wt: ['Fold Sweep', 'Sine'], voicing: { mono: 1, legato: 1 }, macros: ['Snarl', 'Rate'], sub: { direct: 1 },
    v: { 'a.wt': 0.3, 'a.uni': 2, 'a.det': 0.04, 'a.level': 0.5, 'a.warpMode': 18, 'a.warp': 0.1, 'b.on': ON, 'b.level': 0,
      's.on': ON, 's.level': 0.5, 'f.on': ON, 'f.type': 90, 'f.cutoff': 900, 'f.res': 0.35, 'f.var': 0.55, 'f.drive': 0.08, 'f.mix': 0.8,
      'e1.att': 0.002, 'e1.rel': 0.06, 'g.porta': 0.03, 'g.master': 0.241 },
    lfo: [{ mode: 'trig', pts: [[0, 0, 0], [0.25, 1, 0.3], [0.5, 0.3, 0], [0.75, 0.85, -0.3], [1, 0, 0]] }], n: { 'l1.rate': LAD('1/4') },
    mods: [row('lfo1', 'a.wt', 0.4), row('lfo1', 'a.warp', 0.22), row('lfo1', 'f.cutoff', 0.25), row('macro1', 'a.warp', 0.25),
      row('macro1', 'fx.dist.drive', 0.35), row('macro2', 'l1.rate', 2 / 14)],
    fx: OTT({ 'fx.dist.on': ON, 'fx.dist.mode': 11, 'fx.dist.drive': 0.3, 'fx.dist.mix': 0.6, 'fx.eq.on': ON, 'fx.eq.typeL': 2, 'fx.eq.freqL': 90,
      'fx.eq.qL': 0.25 }),
    xs: [[[0, 0, 0], [0.35, 0.8, 0.4], [0.6, 0.45, 0], [1, 1, 0]], [[0, 0, 0], [0.25, 1, 0], [0.5, 0.2, 0], [0.75, 0.9, 0], [1, 0.6, 0]]],
  }),
  recipe('Wobble Dub', 'Bass', {
    notes: 'Saw-to-square and saw stacks over a sine sub into a resonant ladder, wobbled by an eighth-note LFO. Macro 1 doubles and ' +
      'quadruples the wobble rate, Macro 2 adds growl.',
    wt: ['Saw to Square', 'Default'], voicing: { mono: 1, legato: 1 }, macros: ['Rate', 'Growl'],
    v: { 'a.uni': 3, 'a.det': 0.07, 'a.level': 0.9, 'b.on': ON, 'b.uni': 3, 'b.det': 0.12, 'b.level': 0.6, 's.on': ON, 's.level': 0.25,
      'f.on': ON, 'f.type': 3,
      'f.routeB': ON, 'f.cutoff': 220, 'f.res': 0.5, 'f.drive': 0.3, 'e1.att': 0.003, 'e1.rel': 0.1, 'g.master': 0.542 },
    lfo: [{ mode: 'trig', pts: [[0, 0, 0.35], [0.4, 1, -0.25], [1, 0, 0]] }], n: { 'l1.rate': LAD('1/8') },
    mods: [row('lfo1', 'f.cutoff', 0.55), row('lfo1', 'a.wt', 0.5), row('macro1', 'l1.rate', 2 / 14), row('macro2', 'f.res', 0.3),
      row('macro2', 'fx.dist.drive', 0.3)],
    fx: { 'fx.dist.on': ON, 'fx.dist.drive': 0.35, 'fx.dist.mix': 0.5, 'fx.cmp.on': ON, 'fx.cmp.att': 6, 'fx.cmp.rel': 120,
      'fx.cmp.thr': dbA(-16), 'fx.cmp.ratio': 4 },
  }),
  recipe('Growl Yoi', 'Bass', {
    notes: 'A Remap 2-warped saw through a Formant-II filter and a vowel wavetable, all driven by the same quarter-note LFO: the bass ' +
      'says "yoi". Sub direct out. Macro 1 shifts the formants.',
    wt: ['Default', 'Vowels'], voicing: { mono: 1, legato: 1 }, macros: ['Formant'], sub: { direct: 1 },
    remap: [[[0, 0, 0], [0.4, 0.85, 0.3], [1, 1, 0]]],
    v: { 'a.uni': 2, 'a.det': 0.03, 'a.level': 0.9, 'a.warpMode': 14, 'a.warp': 0.2, 'b.on': ON, 'b.wt': 0.2, 'b.level': 0.8, 's.on': ON,
      's.level': 0.4,
      'f.on': ON, 'f.type': 87, 'f.cutoff': 300, 'f.res': 0.2, 'f.var': 0.2, 'e1.att': 0.002, 'e1.rel': 0.06, 'g.master': 0.404 },
    lfo: [{ mode: 'trig', pts: [[0, 0, 0], [0.3, 1, -0.4], [0.7, 0.6, 0], [1, 0, 0.3]] }], n: { 'l1.rate': LAD('1/4') },
    mods: [row('lfo1', 'b.wt', 0.6), row('lfo1', 'f.cutoff', 0.35), row('lfo1', 'a.warp', 0.5), row('macro1', 'f.var', 0.4)],
    fx: OTT({ 'fx.dist.on': ON, 'fx.dist.mode': 3, 'fx.dist.drive': 0.4, 'fx.dist.mix': 0.5, 'fx.eq.on': ON, 'fx.eq.typeL': 2, 'fx.eq.freqL': 90,
      'fx.eq.qL': 0.25 }),
  }),
  recipe('FM Bite', 'Bass', {
    notes: 'Sine carrier phase-modulated by a silent sine an octave up; Env 2 and velocity give each note its bite. Macro 1 = FM depth, ' +
      'mod wheel detunes the modulator for a grinding beat.',
    wt: ['Sine', 'Sine'], voicing: { mono: 1 }, macros: ['FM'],
    v: { 'a.level': 0.8, 'a.rand': 0, 'a.phase': 0, 'a.warpMode': 18, 'a.warp': 0.05, 'b.on': ON, 'b.oct': 1, 'b.level': 0, 'b.rand': 0,
      'b.phase': 0, 'e1.att': 0.001, 'e1.dec': 0.8, 'e1.sus': 0.7, 'e1.rel': 0.06, 'e2.att': 0, 'e2.dec': 0.22, 'e2.sus': 0.15, 'g.master': 0.679 },
    mods: [row('env2', 'a.warp', 0.22), row('velo', 'a.warp', 0.08), row('macro1', 'a.warp', 0.2), row('wheel', 'b.fine', 0.1)],
    fx: { 'fx.dist.on': ON, 'fx.dist.mode': 1, 'fx.dist.drive': 0.25, 'fx.dist.mix': 0.4, 'fx.cmp.on': ON, 'fx.cmp.att': 6, 'fx.cmp.rel': 120,
      'fx.cmp.thr': dbA(-12), 'fx.cmp.ratio': 3 },
  }),
  recipe('Rubber Bass', 'Bass', {
    notes: 'Square with a quick pitch blip and a snappy resonant low-pass; velocity sets the snap.',
    wt: ['Square'], voicing: { mono: 1 },
    v: { 'a.oct': -1, 'a.level': 0.65, 'a.rand': 0, 'f.on': ON, 'f.type': 7, 'f.cutoff': 190, 'f.res': 0.42, 'e1.att': 0.001, 'e1.dec': 0.6,
      'e1.sus': 0.55, 'e1.rel': 0.05, 'e2.att': 0, 'e2.dec': 0.17, 'e2.sus': 0, 'e3.att': 0, 'e3.dec': 0.045, 'e3.sus': 0, 'g.master': 0.531 },
    mods: [row('env2', 'f.cutoff', 0.42), row('env3', 'a.crs', st('a.crs', 7)), row('velo', 'f.cutoff', 0.12)],
  }),

  /* ---- Lead */
  recipe('Supersaw Anthem', 'Lead', {
    notes: 'Nine-voice super-detuned saws plus seven an octave up, thickened by Hyper, dotted ping-pong echoes and a hall. ' +
      'Mod wheel = delayed vibrato, Macro 1 = detune.',
    voicing: { poly: 6 }, uni: { mode: [1, 1] }, macros: ['Detune'],
    v: { 'a.uni': 9, 'a.det': 0.25, 'a.blend': 0.8, 'a.level': 0.6, 'b.on': ON, 'b.uni': 7, 'b.det': 0.2, 'b.oct': 1, 'b.level': 0.35,
      'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 3500, 'f.res': 0.1, 'e1.att': 0.005, 'e1.dec': 1, 'e1.sus': 0.9, 'e1.rel': 0.3,
      'e2.att': 0, 'e2.dec': 0.35, 'e2.sus': 0.4, 'l1.rate': 5.3, 'l1.delay': 0.25, 'l1.rise': 0.3, 'g.master': 0.296 },
    lfo: [{ mode: 'trig', bpm: 0, pts: PTS_SINE }],
    mods: [row('lfo1', 'g.tune', 0.008, { bi: 1, aux: 'wheel' }), row('env2', 'f.cutoff', 0.15), row('velo', 'f.cutoff', 0.1),
      row('macro1', 'a.det', 0.3), row('macro1', 'b.det', 0.3)],
    fx: { 'fx.hyper.on': ON, 'fx.hyper.unison': 4, 'fx.hyper.detune': 0.3, 'fx.hyper.mix': 0.3, 'fx.dly.on': ON, 'fx.dly.mode': 1,
      'fx.dly.offL': 1.5, 'fx.dly.offR': 1.5, 'fx.dly.feed': 0.35, 'fx.dly.mix': 0.18, 'fx.rev.on': ON, 'fx.rev.size': 0.6, 'fx.rev.t': 0.25,
      'fx.rev.mix': 0.22 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') },
  }),
  recipe('Sync Scream', 'Lead', {
    notes: 'Saw through the Sync Window warp, swept open by Env 2, over a square an octave down, into tube drive. ' +
      'Mod wheel = sync amount, aftertouch = vibrato.',
    wt: ['Default', 'Square'], voicing: { mono: 1, legato: 1 }, macros: ['Sync'],
    v: { 'a.uni': 3, 'a.det': 0.05, 'a.level': 0.65, 'a.warpMode': 3, 'a.warp': 0.25, 'b.on': ON, 'b.oct': -1, 'b.level': 0.3,
      'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 7000,
      'e1.att': 0.003, 'e1.rel': 0.18, 'e2.att': 0.01, 'e2.dec': 0.7, 'e2.sus': 0.35, 'g.porta': 0.05, 'l1.rate': 5.5, 'g.master': 0.474 },
    lfo: [{ mode: 'trig', bpm: 0, pts: PTS_SINE }],
    mods: [row('env2', 'a.warp', 0.45), row('wheel', 'a.warp', 0.3), row('macro1', 'a.warp', 0.4), row('lfo1', 'g.tune', 0.008, { bi: 1,
      aux: 'at' })],
    fx: { 'fx.dist.on': ON, 'fx.dist.drive': 0.3, 'fx.dist.mix': 0.5, 'fx.dly.on': ON, 'fx.dly.mix': 0.15, 'fx.rev.on': ON, 'fx.rev.mix': 0.15 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') }, rev: 0,
  }),
  recipe('Vowel Talker', 'Lead', {
    notes: 'Saw and square through a Formant-I filter that walks through the vowels every half note. Mod wheel shifts the formants, ' +
      'Macro 1 picks the vowel.',
    wt: ['Default', 'Square'], voicing: { mono: 1, legato: 1 }, macros: ['Vowel'],
    v: { 'a.uni': 2, 'a.det': 0.04, 'a.level': 0.7, 'b.on': ON, 'b.level': 0.4, 'f.on': ON, 'f.type': 86, 'f.routeB': ON, 'f.cutoff': 400,
      'f.res': 0.5, 'f.var': 0.4, 'e1.att': 0.01, 'e1.rel': 0.2, 'g.porta': 0.06, 'g.master': 0.615 },
    lfo: [{ mode: 'trig', pts: [[0, 0.1, 0.2], [0.25, 0.6, -0.2], [0.5, 0.3, 0.2], [0.75, 0.9, -0.2], [1, 0.1, 0]] }], n: { 'l1.rate': LAD('1/2') },
    mods: [row('lfo1', 'f.cutoff', 0.35), row('wheel', 'f.var', 0.4), row('macro1', 'f.cutoff', 0.5)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.2, 'fx.dly.on': ON, 'fx.dly.mix': 0.15, 'fx.rev.on': ON, 'fx.rev.mix': 0.18 },
    fxn: { 'fx.dly.timeL': DLY_N('1/4'), 'fx.dly.timeR': DLY_N('1/4') },
  }),
  recipe('Glass Whistle', 'Lead', {
    notes: 'Sine with gentle FM from a silent oscillator an octave up and a delayed vibrato; velocity adds shine.',
    wt: ['Sine', 'Sine'], voicing: { mono: 1, legato: 1 },
    v: { 'a.warpMode': 18, 'a.warp': 0.1, 'a.level': 0.7, 'b.on': ON, 'b.oct': 1, 'b.level': 0, 'e1.att': 0.02, 'e1.rel': 0.25,
      'g.porta': 0.08, 'l1.rate': 5.2, 'l1.delay': 0.35, 'l1.rise': 0.5, 'g.master': 0.563 },
    lfo: [{ mode: 'trig', bpm: 0, pts: PTS_SINE }],
    mods: [row('lfo1', 'a.fine', 0.06, { bi: 1 }), row('velo', 'a.warp', 0.08)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mix': 0.15, 'fx.rev.on': ON, 'fx.rev.mix': 0.25, 'fx.rev.size': 0.6 },
    fxn: { 'fx.dly.timeL': DLY_N('1/4'), 'fx.dly.timeR': DLY_N('1/4') },
  }),
  recipe('Square Hero', 'Lead', {
    notes: 'Slowly swept pulse width over a square sub, a little chorus and echo. Mod wheel = vibrato.',
    wt: ['PWM Sweep'], voicing: { mono: 1, legato: 1 },
    v: { 'a.wt': 0.1, 'a.level': 0.6, 's.on': ON, 's.shape': 3, 's.oct': -1, 's.level': 0.25, 'f.on': ON, 'f.cutoff': 3000, 'f.res': 0.2,
      'e1.att': 0.003, 'e1.rel': 0.15, 'e2.dec': 0.4, 'e2.sus': 0.2, 'g.porta': 0.05, 'l1.rate': 0.45, 'l2.rate': 5.3, 'g.master': 0.754 },
    lfo: [{ bpm: 0 }, { mode: 'trig', bpm: 0, pts: PTS_SINE }],
    mods: [row('lfo1', 'a.wt', 0.6), row('env2', 'f.cutoff', 0.15), row('lfo2', 'g.tune', 0.008, { bi: 1, aux: 'wheel' })],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.25, 'fx.dly.on': ON, 'fx.dly.mix': 0.14 },
    fxn: { 'fx.dly.timeL': DLY_N('1/4'), 'fx.dly.timeR': DLY_N('1/4') },
  }),
  recipe('Rave Siren', 'Lead', {
    notes: 'Wide detuned pulse stacks that scoop up into every note with an always-on glide, the pulse width drifting. Mod wheel = scoop depth.',
    wt: ['PWM Sweep', 'Default'], voicing: { mono: 1, legato: 1, always: 1 }, uni: { mode: [1, 1] },
    v: { 'a.wt': 0.3, 'a.uni': 7, 'a.det': 0.35, 'a.level': 0.6, 'b.on': ON, 'b.oct': -1, 'b.uni': 5, 'b.det': 0.25, 'b.level': 0.5,
      'e1.att': 0.01, 'e1.rel': 0.4, 'e2.att': 0, 'e2.dec': 0.3, 'e2.sus': 0, 'g.porta': 0.12, 'l1.rate': 0.4, 'g.master': 0.365 },
    lfo: [{ bpm: 0 }],
    mods: [row('env2', 'a.crs', -st('a.crs', 5)), row('env2', 'b.crs', -st('b.crs', 5)), row('lfo1', 'a.wt', 0.35),
      row('env2', 'a.crs', -st('a.crs', 12), { aux: 'wheel' }), row('env2', 'b.crs', -st('b.crs', 12), { aux: 'wheel' })],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.4, 'fx.rev.on': ON, 'fx.rev.mix': 0.25 },
  }),

  /* ---- Pad */
  recipe('Warm Cloud', 'Pad', {
    notes: 'Soft analog ramps and a triangle drifting through a slowly moving ladder filter, chorus and hall. Mod wheel / Macro 1 brighten.',
    wt: ['Analog Ramp', 'Triangle'], macros: ['Bright'],
    v: { 'a.wt': 0.3, 'a.uni': 5, 'a.det': 0.1, 'a.level': 0.55, 'b.on': ON, 'b.uni': 3, 'b.det': 0.06, 'b.fine': 7, 'b.level': 0.4,
      'f.on': ON, 'f.routeB': ON, 'f.cutoff': 1800, 'f.res': 0.1, 'e1.att': 1.1, 'e1.dec': 2, 'e1.sus': 0.8, 'e1.rel': 2.2, 'l1.rate': 0.2,
      'g.master': 0.395 },
    lfo: [{ bpm: 0 }],
    mods: [row('lfo1', 'f.cutoff', 0.12, { bi: 1 }), row('wheel', 'f.cutoff', 0.25), row('macro1', 'f.cutoff', 0.3)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.35, 'fx.rev.on': ON, 'fx.rev.mix': 0.35, 'fx.rev.size': 0.7, 'fx.rev.t': 0.5 },
  }),
  recipe('Chaos Bloom', 'Pad', {
    notes: 'Random-spectra and glass tables wandering on two chaos generators (per note, so every voice evolves differently), ' +
      'widened by Hyper and Dimension into a long hall. Macro 1 = bloom.',
    wt: ['Random Spectra', 'Glass'], macros: ['Bloom'],
    v: { 'a.wt': 0.4, 'a.uni': 4, 'a.det': 0.12, 'a.level': 0.55, 'b.on': ON, 'b.wt': 0.3, 'b.uni': 3, 'b.det': 0.08, 'b.oct': 1, 'b.level': 0.3,
      'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 2500, 'f.res': 0.15, 'e1.att': 1.5, 'e1.dec': 2, 'e1.sus': 0.85, 'e1.rel': 3,
      'c1.rate': 0.3, 'c2.rate': 0.18, 'l1.rate': 0.07, 'g.master': 0.265 },
    lfo: [{ bpm: 0 }],
    mods: [row('chaos1', 'a.wt', 0.25), row('chaos2', 'f.cutoff', 0.12), row('lfo1', 'b.wt', 0.4), row('chaos1', 'b.pan', 0.25),
      row('macro1', 'f.cutoff', 0.3), row('macro1', 'fx.dim.mix', 0.4)],
    fx: { 'fx.hyper.on': ON, 'fx.hyper.unison': 3, 'fx.hyper.detune': 0.2, 'fx.hyper.mix': 0.25, 'fx.dim.size': 0.6, 'fx.dim.mix': 0.4,
      'fx.rev.on': ON, 'fx.rev.size': 0.85, 'fx.rev.t': 0.6, 'fx.rev.mix': 0.4 },
  }),
  recipe('Choir Haze', 'Pad', {
    notes: 'Choir wavetable drifting between vowels with a key-tracked breath on top. Mod wheel widens the ensemble.',
    wt: ['Choir'], noise: { src: 'noise:Breath', keytrack: 1 },
    v: { 'a.wt': 0.2, 'a.uni': 4, 'a.det': 0.05, 'a.level': 0.8, 'n.on': ON, 'n.level': 0.12, 'f.on': ON, 'f.type': 5, 'f.routeN': ON,
      'f.cutoff': 2600, 'f.res': 0.15, 'e1.att': 0.8, 'e1.dec': 2, 'e1.sus': 0.85, 'e1.rel': 2.5, 'l1.rate': 0.18, 'g.master': 0.49 },
    lfo: [{ bpm: 0 }],
    mods: [row('lfo1', 'a.wt', 0.5), row('wheel', 'a.det', 0.3)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.2, 'fx.rev.on': ON, 'fx.rev.mix': 0.4, 'fx.rev.size': 0.8, 'fx.rev.t': 0.6 },
  }),
  recipe('Shimmer Field', 'Pad', {
    notes: 'Harmonic build scanned slowly with octave-stacked unison and a glassy top, into ping-pong echoes and a big hall. Mod wheel = glass.',
    wt: ['Harmonic Sweep', 'Glass'],
    v: { 'a.wt': 0.12, 'a.uni': 6, 'a.det': 0.06, 'a.stack': 1, 'a.level': 0.38, 'b.on': ON, 'b.oct': 1, 'b.wt': 0.4, 'b.level': 0.2,
      'e1.att': 1.3, 'e1.dec': 3, 'e1.sus': 0.75, 'e1.rel': 3, 'l1.rate': 0.12, 'g.master': 0.332 },
    lfo: [{ bpm: 0 }],
    mods: [row('lfo1', 'a.wt', 0.4), row('wheel', 'b.level', 0.3)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.25, 'fx.dly.feed': 0.5, 'fx.rev.on': ON, 'fx.rev.mix': 0.45, 'fx.rev.size': 0.9,
      'fx.rev.t': 0.7 },
    fxn: { 'fx.dly.timeL': DLY_N('1/4'), 'fx.dly.timeR': DLY_N('1/4') },
  }),
  recipe('Dark Drone', 'Pad', {
    notes: 'Mirror-warped formant sweep over a sub-octave saw and wind noise, a resonant ladder and a slow phaser.',
    wt: ['Formant Sweep'], noise: { src: 'noise:Wind' },
    v: { 'a.wt': 0.2, 'a.uni': 3, 'a.det': 0.04, 'a.level': 0.6, 'a.warpMode': 12, 'a.warp': 0.5, 'b.on': ON, 'b.oct': -1, 'b.uni': 2, 'b.level': 0.4,
      'n.on': ON, 'n.level': 0.2,
      'f.on': ON, 'f.type': 3, 'f.routeB': ON, 'f.routeN': ON, 'f.cutoff': 520, 'f.res': 0.3, 'e1.att': 1.6, 'e1.dec': 4, 'e1.sus': 0.9,
      'e1.rel': 3, 'l1.rate': 0.11, 'l2.rate': 0.17, 'g.master': 0.652 },
    lfo: [{ bpm: 0 }, { bpm: 0 }],
    mods: [row('lfo1', 'f.cutoff', 0.2), row('lfo2', 'a.wt', 0.5)],
    fx: { 'fx.phs.on': ON, 'fx.phs.mix': 0.4, 'fx.phs.rate': 0.1, 'fx.rev.on': ON, 'fx.rev.mix': 0.4, 'fx.rev.size': 0.85, 'fx.rev.t': 0.65 },
  }),
  recipe('Bowed Strings', 'Pad', {
    notes: 'Bowed tables in a five-voice ensemble with an octave below, slow bow attack, chorus and hall. Mod wheel = vibrato, velocity = ' +
      'brightness.',
    wt: ['Bowed', 'Bowed'],
    v: { 'a.wt': 0.3, 'a.uni': 5, 'a.det': 0.1, 'a.level': 0.6, 'b.on': ON, 'b.wt': 0.6, 'b.uni': 3, 'b.det': 0.07, 'b.oct': -1, 'b.level': 0.4,
      'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 3500, 'f.res': 0.1, 'e1.att': 0.45, 'e1.dec': 1, 'e1.sus': 0.9, 'e1.rel': 0.9,
      'l1.rate': 5, 'l2.rate': 0.1, 'g.master': 0.191 },
    lfo: [{ mode: 'trig', bpm: 0, pts: PTS_SINE }, { bpm: 0 }],
    mods: [row('lfo1', 'g.tune', 0.006, { bi: 1, aux: 'wheel' }), row('lfo2', 'a.wt', 0.3), row('velo', 'f.cutoff', 0.15)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.3, 'fx.rev.on': ON, 'fx.rev.mix': 0.3, 'fx.rev.size': 0.7, 'fx.eq.on': ON, 'fx.eq.typeL': 2,
      'fx.eq.freqL': 90, 'fx.eq.qL': 0.25 },
  }),

  /* ---- Pluck */
  recipe('Glass Pluck', 'Pluck', {
    notes: 'Bell-like partials with a filter snap and ping-pong echoes.',
    wt: ['Glass', 'Sine'], velo: 1,
    v: { 'a.wt': 0.6, 'a.level': 1, 'b.on': ON, 'b.oct': 1, 'b.level': 0.3, 'f.on': ON, 'f.routeB': ON, 'f.cutoff': 1200, 'f.res': 0.2,
      'f.drive': 0.12,
      'e1.att': 0.001, 'e1.dec': 0.6, 'e1.sus': 0, 'e1.rel': 0.45, 'e2.att': 0, 'e2.dec': 0.25, 'e2.sus': 0, 'g.master': 0.63 },
    mods: [row('env2', 'f.cutoff', 0.4), row('velo', 'f.cutoff', 0.15)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.22, 'fx.dly.feed': 0.35, 'fx.rev.on': ON, 'fx.rev.mix': 0.2 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') },
  }),
  recipe('Kalimba Tine', 'Pluck', {
    notes: 'FM bell table brightened by Env 2 at the attack, in a small plate.',
    wt: ['FM Bell'], velo: 1,
    v: { 'a.wt': 0.25, 'a.level': 0.55, 'e1.att': 0.001, 'e1.dec': 0.9, 'e1.sus': 0, 'e1.rel': 0.5, 'e2.att': 0, 'e2.dec': 0.15, 'e2.sus': 0,
      'g.master': 0.982 },
    mods: [row('env2', 'a.wt', 0.45), row('velo', 'a.wt', 0.15)],
    fx: { 'fx.rev.on': ON, 'fx.rev.mix': 0.22, 'fx.rev.size': 0.45 }, rev: 0,
  }),
  recipe('Nylon Pick', 'Pluck', {
    notes: 'Triangle-to-saw body with a one-shot pick transient; the filter follows the keyboard.',
    wt: ['Basic Shapes'], noise: { src: 'noise:Pluck Noise', oneshot: 1 }, filter: { keytrack: 1 }, velo: 1,
    v: { 'a.wt': 0.3, 'a.level': 0.9, 'n.on': ON, 'n.level': 0.45, 'f.on': ON, 'f.routeN': ON, 'f.cutoff': 700, 'f.res': 0.1,
      'e1.att': 0.001, 'e1.dec': 1.2, 'e1.sus': 0, 'e1.rel': 0.3, 'e2.att': 0, 'e2.dec': 0.35, 'e2.sus': 0, 'g.master': 0.991 },
    mods: [row('env2', 'f.cutoff', 0.35)],
    fx: { 'fx.rev.on': ON, 'fx.rev.mix': 0.15, 'fx.rev.size': 0.4 }, rev: 0,
  }),
  recipe('Future Pluck', 'Pluck', {
    notes: 'Super-detuned saw stacks plucked by a filter envelope, multiband-compressed and thrown into dotted echoes and a hall. Macro 1 = decay.',
    voicing: { poly: 8 }, uni: { mode: [1, 1] }, velo: 1, macros: ['Decay'],
    v: { 'a.uni': 7, 'a.det': 0.18, 'a.level': 0.85, 'b.on': ON, 'b.uni': 5, 'b.det': 0.12, 'b.oct': 1, 'b.level': 0.5, 'f.on': ON, 'f.type': 1,
      'f.routeB': ON, 'f.cutoff': 300, 'f.res': 0.25, 'e1.att': 0.001, 'e1.dec': 0.45, 'e1.sus': 0, 'e1.rel': 0.35, 'e2.att': 0, 'e2.dec': 0.22,
      'e2.sus': 0, 'g.master': 0.652 },
    mods: [row('env2', 'f.cutoff', 0.45), row('velo', 'f.cutoff', 0.1), row('macro1', 'e1.dec', 0.2), row('macro1', 'e2.dec', 0.2)],
    fx: OTT({ 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.offL': 1.5, 'fx.dly.offR': 1.5, 'fx.dly.mix': 0.2, 'fx.dly.feed': 0.35,
      'fx.rev.on': ON, 'fx.rev.size': 0.6, 'fx.rev.mix': 0.25, 'fx.cmp.mix': 0.5 }),
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') },
  }),

  /* ---- Keys */
  recipe('Tine Keys', 'Keys', {
    notes: 'Electric-piano style FM tine with a gentle auto-pan; velocity sets brightness and level. Mod wheel = pan depth.',
    wt: ['FM Ratio 1', 'Sine'], velo: 1,
    v: { 'a.wt': 0.12, 'a.level': 0.5, 'b.on': ON, 'b.oct': 2, 'b.level': 0.1, 'e1.att': 0.002, 'e1.dec': 2.5, 'e1.sus': 0.15, 'e1.rel': 0.35,
      'e2.att': 0, 'e2.dec': 0.4, 'e2.sus': 0, 'l1.rate': 4.5, 'g.master': 0.385 },
    lfo: [{ bpm: 0, pts: PTS_SINE }],
    mods: [row('env2', 'a.wt', 0.35), row('velo', 'a.wt', 0.2), row('lfo1', 'a.pan', 0.3, { bi: 1 }), row('lfo1', 'b.pan', 0.3, { bi: 1 }),
      row('lfo1', 'a.pan', 0.5, { bi: 1, aux: 'wheel' }), row('lfo1', 'b.pan', 0.5, { bi: 1, aux: 'wheel' })],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.25, 'fx.rev.on': ON, 'fx.rev.mix': 0.15 },
  }),
  recipe('Reed Organ', 'Keys', {
    notes: 'Reed wavetable with an octave sine, organ envelope and a rotary-style chorus. Mod wheel speeds the rotor up.',
    wt: ['Reed', 'Sine'],
    v: { 'a.wt': 0.5, 'a.level': 0.32, 'b.on': ON, 'b.oct': 1, 'b.level': 0.2, 'e1.att': 0.005, 'e1.sus': 1, 'e1.rel': 0.08, 'g.master': 0.275 },
    mods: [row('wheel', 'fx.cho.rate', 0.2)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.4, 'fx.cho.rate': 1.2, 'fx.rev.on': ON, 'fx.rev.mix': 0.15 },
  }),
  recipe('Soft Clav', 'Keys', {
    notes: 'Narrow pulse with a key-tracked filter snap.',
    wt: ['Pulse 25'], filter: { keytrack: 1 }, velo: 1,
    v: { 'a.level': 0.6, 'f.on': ON, 'f.type': 5, 'f.cutoff': 1500, 'f.res': 0.25, 'e1.att': 0.001, 'e1.dec': 0.5, 'e1.sus': 0.2,
      'e1.rel': 0.12, 'e2.att': 0, 'e2.dec': 0.15, 'e2.sus': 0, 'g.master': 0.43 },
    mods: [row('env2', 'f.cutoff', 0.25), row('velo', 'f.cutoff', 0.15)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mix': 0.1 },
  }),
  recipe('Bell Keys', 'Keys', {
    notes: 'FM bell table with a twelfth partial that fades first and a key-tracked glass strike, in a soft hall.',
    wt: ['FM Bell', 'Sine'], noise: { src: 'noise:Glass Tone', oneshot: 1, keytrack: 1 }, velo: 1,
    v: { 'a.wt': 0.45, 'a.level': 0.6, 'b.on': ON, 'b.oct': 1, 'b.semi': 7, 'b.level': 0.12, 'n.on': ON, 'n.level': 0.2,
      'e1.att': 0.001, 'e1.dec': 3, 'e1.sus': 0, 'e1.rel': 1.2, 'e1.cd': 0.75, 'e2.att': 0, 'e2.dec': 0.6, 'e2.sus': 0, 'e3.att': 0, 'e3.dec': 0.25,
      'e3.sus': 0, 'g.master': 0.232 },
    mods: [row('env2', 'a.wt', 0.3), row('env3', 'b.level', 0.45), row('velo', 'a.wt', 0.2)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.15, 'fx.rev.on': ON, 'fx.rev.size': 0.65, 'fx.rev.mix': 0.3 },
  }),

  /* ---- Chord */
  recipe('House Stab', 'Chord', {
    notes: 'One key plays a minor-seventh stab: both oscillators stack root/fifth/octave (12+7 unison stack), B a minor third up. ' +
      'Filter snap and a plate. Macro 1 = decay.',
    voicing: { poly: 6 }, velo: 1, macros: ['Decay'],
    v: { 'a.uni': 3, 'a.stack': 4, 'a.det': 0.05, 'a.level': 0.85, 'b.on': ON, 'b.uni': 3, 'b.stack': 4, 'b.semi': 3, 'b.det': 0.05, 'b.level': 0.8,
      'f.on': ON, 'f.type': 1, 'f.routeB': ON, 'f.cutoff': 800, 'f.res': 0.25, 'f.drive': 0.1, 'e1.att': 0.001, 'e1.dec': 0.6, 'e1.sus': 0.12,
      'e1.rel': 0.25,
      'e2.att': 0, 'e2.dec': 0.25, 'e2.sus': 0, 'g.master': 0.627 },
    mods: [row('env2', 'f.cutoff', 0.35), row('velo', 'f.cutoff', 0.15), row('macro1', 'e1.dec', 0.2), row('macro1', 'e2.dec', 0.15)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.2, 'fx.rev.on': ON, 'fx.rev.mix': 0.2 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') }, rev: 0,
  }),
  recipe('Dimension Chord', 'Chord', {
    notes: 'One key plays a major-seventh chord (12+7 stacks, B a major third up) of warm analog ramps, spread by Hyper and Dimension. ' +
      'Macro 1 = space.',
    wt: ['Analog Ramp', 'Analog Ramp'], voicing: { poly: 6 }, macros: ['Space'],
    v: { 'a.wt': 0.25, 'a.uni': 3, 'a.stack': 4, 'a.det': 0.08, 'a.level': 0.6, 'b.on': ON, 'b.wt': 0.4, 'b.uni': 3, 'b.stack': 4, 'b.semi': 4,
      'b.det': 0.08, 'b.level': 0.5, 'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 2400, 'f.res': 0.15, 'e1.att': 0.04, 'e1.dec': 1.5,
      'e1.sus': 0.6, 'e1.rel': 1.2, 'l1.rate': 0.15, 'g.master': 0.514 },
    lfo: [{ bpm: 0 }],
    mods: [row('lfo1', 'f.cutoff', 0.1, { bi: 1 }), row('macro1', 'fx.dim.mix', 0.5), row('macro1', 'fx.rev.mix', 0.3)],
    fx: { 'fx.hyper.on': ON, 'fx.hyper.unison': 3, 'fx.hyper.detune': 0.25, 'fx.hyper.mix': 0.3, 'fx.dim.size': 0.7, 'fx.dim.mix': 0.5,
      'fx.rev.on': ON, 'fx.rev.size': 0.75, 'fx.rev.mix': 0.3 },
  }),
  recipe('Rave Organ', 'Chord', {
    notes: 'Reed and square stacks voiced root / fifth / octave from one key, organ envelope, chorus and plate.',
    wt: ['Reed', 'Square'], voicing: { poly: 6 },
    v: { 'a.wt': 0.6, 'a.uni': 2, 'a.stack': 1, 'a.level': 0.6, 'b.on': ON, 'b.semi': 7, 'b.uni': 2, 'b.stack': 1, 'b.level': 0.45,
      'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 2600, 'f.res': 0.15, 'e1.att': 0.001, 'e1.dec': 0.5, 'e1.sus': 0.4, 'e1.rel': 0.15,
      'e2.att': 0, 'e2.dec': 0.3, 'e2.sus': 0, 'g.master': 0.599 },
    mods: [row('env2', 'f.cutoff', 0.2)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.3, 'fx.rev.on': ON, 'fx.rev.mix': 0.18 }, rev: 0,
  }),

  /* ---- Arp */
  recipe('Octave Runner', 'Arp', {
    notes: 'Hold notes or chords: a one-bar stepped LFO jumps each note through octaves while a sixteenth-note LFO plucks every step. ' +
      'Mod wheel opens the filter.',
    wt: ['Saw to Square'], voicing: { poly: 8 },
    v: { 'a.wt': 0.25, 'a.uni': 3, 'a.det': 0.06, 'a.level': 0.65, 'f.on': ON, 'f.type': 5, 'f.cutoff': 1800, 'f.res': 0.25,
      'e1.att': 0.002, 'e1.rel': 0.25, 'g.master': 0.29 },
    lfo: [{ mode: 'trig', pts: steps([0, 1, 0, 2, 0, 1, 2, 1, 0, 1, 0, 2, 1, 2, 1, 0].map(o => o / 4)) }, { mode: 'trig', pts: PTS_PLUCK }],
    n: { 'l1.rate': LAD('1 bar'), 'l2.rate': LAD('1/16') },
    mods: [row('lfo1', 'a.oct', 0.5), row('lfo2', 'g.amp', -0.8), row('lfo2', 'f.cutoff', -0.2), row('wheel', 'f.cutoff', 0.3)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.2, 'fx.dly.feed': 0.3, 'fx.rev.on': ON, 'fx.rev.mix': 0.15 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') }, rev: 0,
  }),
  recipe('Pentatonic Sparkle', 'Arp', {
    notes: 'Hold a note: an eight-step LFO plays a major-pentatonic run on an FM bell, plucked in sixteenths, with dotted echoes.',
    wt: ['FM Bell', 'Sine'], voicing: { poly: 8 },
    v: { 'a.wt': 0.35, 'a.level': 0.6, 'b.on': ON, 'b.oct': 1, 'b.level': 0.2, 'e1.att': 0.002, 'e1.rel': 0.4, 'g.master': 0.254 },
    lfo: [{ mode: 'trig', pts: steps([0, 2, 4, 7, 9, 12, 9, 7].map(x => x / 12)) }, { mode: 'trig', pts: PTS_PLUCK }],
    n: { 'l1.rate': LAD('1/2'), 'l2.rate': LAD('1/16') },
    mods: [row('lfo1', 'a.semi', 0.5), row('lfo1', 'b.semi', 0.5), row('lfo2', 'g.amp', -0.85), row('lfo2', 'a.wt', -0.25)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.offL': 1.5, 'fx.dly.offR': 1.5, 'fx.dly.mix': 0.22, 'fx.dly.feed': 0.4,
      'fx.rev.on': ON, 'fx.rev.size': 0.6, 'fx.rev.mix': 0.25 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') },
  }),
  recipe('Minor Cascade', 'Arp', {
    notes: 'Hold a note: a twelve-step minor-seventh figure in sixteenth triplets on the glass table over a filtered saw an octave down.',
    wt: ['Glass', 'Default'], voicing: { poly: 8 },
    v: { 'a.wt': 0.5, 'a.level': 0.6, 'b.on': ON, 'b.oct': -1, 'b.level': 0.3, 'f.on': ON, 'f.type': 5, 'f.routeA': OFF, 'f.routeB': ON,
      'f.cutoff': 900, 'e1.att': 0.002, 'e1.rel': 0.4, 'g.master': 0.396 },
    lfo: [{ mode: 'trig', pts: steps([0, 3, 7, 12, 10, 7, 3, 7, 12, 10, 7, 3].map(x => x / 12)) }, { mode: 'trig', trip: 1, pts: PTS_PLUCK }],
    n: { 'l1.rate': LAD('1/2'), 'l2.rate': LAD('1/16T', 0, 1) },
    mods: [row('lfo1', 'a.semi', 0.5), row('lfo1', 'b.semi', 0.5), row('lfo2', 'g.amp', -0.85)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.2, 'fx.rev.on': ON, 'fx.rev.size': 0.7, 'fx.rev.mix': 0.3 },
    fxn: { 'fx.dly.timeL': DLY_N('1/4'), 'fx.dly.timeR': DLY_N('1/4') },
  }),

  /* ---- Seq */
  recipe('Trance Gate', 'Seq', {
    notes: 'Super-detuned saws chopped by a sixteen-step gate (one bar, follows the tempo). Macro 1 smooths the gate away.',
    voicing: { poly: 6 }, uni: { mode: [1, 1] }, macros: ['Smooth'],
    v: { 'a.uni': 7, 'a.det': 0.2, 'a.level': 0.6, 'b.on': ON, 'b.uni': 5, 'b.det': 0.15, 'b.oct': 1, 'b.level': 0.3, 'f.on': ON, 'f.type': 5,
      'f.routeB': ON, 'f.cutoff': 4000, 'e1.att': 0.01, 'e1.rel': 0.3, 'g.master': 0.461 },
    lfo: [{ mode: 'trig', pts: gate('xx.xx.xx.x.xx.x.', 0.7) }], n: { 'l1.rate': LAD('1 bar') },
    mods: [row('lfo1', 'g.amp', -1, { aux: 'macro1', inv: 1 })],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.offL': 1.5, 'fx.dly.offR': 1.5, 'fx.dly.mix': 0.22, 'fx.rev.on': ON, 'fx.rev.mix': 0.25 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') },
  }),
  recipe('Acid Walker', 'Seq', {
    notes: 'Hold one key: three one-bar LFOs play a sixteen-step acid line (pitch, accent and per-step envelope) through a resonant ' +
      'ladder and tube drive. Macro 1 = cutoff, Macro 2 = resonance.',
    wt: ['Saw to Square'], voicing: { mono: 1 }, macros: ['Cutoff', 'Reso'],
    v: { 'a.level': 0.7, 'f.on': ON, 'f.type': 3, 'f.cutoff': 300, 'f.res': 0.72, 'f.drive': 0.2, 'e1.att': 0.002, 'e1.rel': 0.08,
      'g.master': 0.706 },
    lfo: [{ mode: 'trig', pts: steps([0, 0, 12, 0, 3, 0, 7, 12, 0, 10, 0, 3, 12, 0, 7, 5].map(x => x / 12)) },
      { mode: 'trig', pts: steps([1, 0.2, 0.6, 0.2, 1, 0.2, 0.4, 0.8, 0.3, 1, 0.2, 0.5, 0.9, 0.2, 0.6, 0.3]) },
      { mode: 'trig', pts: [[0, 1, 0], [0.02, 0, 0.45], [1, 1, 0]] }],
    n: { 'l1.rate': LAD('1 bar'), 'l2.rate': LAD('1 bar'), 'l3.rate': LAD('1/16') },
    mods: [row('lfo1', 'a.semi', 0.5), row('lfo2', 'f.cutoff', 0.25), row('lfo3', 'f.cutoff', -0.3), row('lfo3', 'g.amp', -0.5),
      row('macro1', 'f.cutoff', 0.35), row('macro2', 'f.res', 0.2)],
    fx: { 'fx.dist.on': ON, 'fx.dist.drive': 0.45, 'fx.dist.mix': 0.45, 'fx.dly.on': ON, 'fx.dly.offL': 1.5, 'fx.dly.offR': 1.5, 'fx.dly.mix': 0.18 },
    fxn: { 'fx.dly.timeL': DLY_N('1/8'), 'fx.dly.timeR': DLY_N('1/8') },
  }),
  recipe('Bit Steps Seq', 'Seq', {
    notes: 'Hold a note: a sixteen-step LFO picks a bit-reduced frame for every sixteenth while a second LFO plucks each step. ' +
      'Macro 1 = bit depth.',
    wt: ['Bit Steps'], macros: ['Crush'],
    v: { 'a.wt': 0.3, 'a.level': 0.8, 'e1.att': 0.001, 'e1.rel': 0.1, 'g.master': 0.644 },
    lfo: [{ mode: 'trig', pts: steps([0.1, 0.7, 0.35, 0.95, 0.2, 0.55, 0.8, 0.45, 0.15, 0.9, 0.4, 0.65, 0.25, 1, 0.5, 0.75]) },
      { mode: 'trig', pts: PTS_PLUCK }], n: { 'l1.rate': LAD('1 bar'), 'l2.rate': LAD('1/16') },
    mods: [row('lfo1', 'a.wt', 0.7), row('lfo2', 'g.amp', -0.6), row('macro1', 'a.wt', 0.3), row('macro1', 'fx.dist.drive', 0.4)],
    fx: { 'fx.dist.on': ON, 'fx.dist.mode': 8, 'fx.dist.drive': 0.25, 'fx.dist.mix': 0.35, 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.2 },
    fxn: { 'fx.dly.timeL': DLY_N('1/16'), 'fx.dly.timeR': DLY_N('1/8') },
  }),
  recipe('Sidechain Pump', 'Seq', {
    notes: 'A harmonic-sweep pad ducked on every beat by a free-running LFO anchored to the song position, so it pumps in time with the kick.',
    wt: ['Harmonic Sweep', 'Analog Ramp'], voicing: { poly: 6 },
    v: { 'a.wt': 0.35, 'a.uni': 5, 'a.det': 0.12, 'a.level': 0.55, 'b.on': ON, 'b.uni': 3, 'b.det': 0.1, 'b.oct': -1, 'b.level': 0.35,
      'f.on': ON, 'f.type': 5, 'f.routeB': ON, 'f.cutoff': 2200, 'e1.att': 0.05, 'e1.rel': 0.5, 'g.master': 0.515 },
    lfo: [{ pts: PTS_PUMP }], n: { 'l1.rate': LAD('1/4') },
    mods: [row('lfo1', 'g.amp', -0.9)],
    fx: { 'fx.cho.on': ON, 'fx.cho.mix': 0.2, 'fx.rev.on': ON, 'fx.rev.mix': 0.25 },
  }),

  /* ---- Drum */
  recipe('Punch Kick', 'Drum', {
    notes: 'Sine kick: a 36-semitone pitch drop from Env 2 with a click on top (C3 ≈ 49 Hz body). Macro 1 = punch, Macro 2 = decay.',
    wt: ['Sine'], noise: { src: 'noise:Click', oneshot: 1 }, voicing: { poly: 4 }, velo: 1, macros: ['Punch', 'Decay'],
    v: { 'a.level': 0.9, 'a.rand': 0, 'a.phase': 0, 'a.oct': -1, 'a.semi': -5, 'n.on': ON, 'n.level': 0.35, 'e1.att': 0, 'e1.hold': 0.02,
      'e1.dec': 0.35, 'e1.sus': 0, 'e1.rel': 0.1, 'e1.cd': 0.8, 'e2.att': 0, 'e2.dec': 0.045, 'e2.sus': 0, 'e2.cd': 0.85, 'g.master': 0.788 },
    mods: [row('env2', 'a.crs', st('a.crs', 36)), row('macro1', 'fx.dist.drive', 0.4), row('macro2', 'e1.dec', 0.2)],
    fx: { 'fx.dist.on': ON, 'fx.dist.drive': 0.3, 'fx.dist.mix': 0.5, 'fx.cmp.on': ON, 'fx.cmp.att': 6, 'fx.cmp.rel': 120, 'fx.cmp.thr': dbA(-12),
      'fx.cmp.ratio': 4 },
  }),
  recipe('Noise Snare', 'Drum', {
    notes: 'Triangle body with a pitch blip (shorter than the noise) plus high-passed white noise, in a small plate. Macro 1 = snap.',
    wt: ['Triangle'], noise: { src: 'noise:White' }, voicing: { poly: 4 }, velo: 1, macros: ['Snap'],
    v: { 'a.level': 0.2, 'a.rand': 0, 'a.phase': 0, 'a.semi': 7, 'n.on': ON, 'n.level': 0.7, 'f.on': ON, 'f.type': 9, 'f.routeA': OFF,
      'f.routeN': ON, 'f.cutoff': 1800, 'f.res': 0.2, 'e1.att': 0, 'e1.dec': 0.2, 'e1.sus': 0, 'e1.rel': 0.15, 'e1.cd': 0.8,
      'e2.att': 0, 'e2.dec': 0.03, 'e2.sus': 0, 'e3.att': 0, 'e3.dec': 0.07, 'e3.sus': 0, 'g.master': 0.734 },
    mods: [row('env2', 'a.crs', st('a.crs', 12)), row('env3', 'a.level', 0.5), row('macro1', 'f.cutoff', 0.2), row('macro1', 'e1.dec', -0.08)],
    fx: { 'fx.cmp.on': ON, 'fx.cmp.att': 6, 'fx.cmp.rel': 120, 'fx.cmp.thr': dbA(-14), 'fx.cmp.ratio': 3, 'fx.rev.on': ON, 'fx.rev.size': 0.3,
      'fx.rev.mix': 0.15 },
    rev: 0,
  }),
  recipe('Tight Hat', 'Drum', {
    notes: 'High-passed white noise with a short decay; mod wheel opens the hat, velocity brightens it.',
    noise: { src: 'noise:White' }, voicing: { poly: 4 }, velo: 1,
    v: { 'a.on': OFF, 'n.on': ON, 'n.level': 1, 'f.on': ON, 'f.type': 11, 'f.routeA': OFF, 'f.routeN': ON, 'f.cutoff': 7000, 'f.res': 0.15,
      'f.drive': 0.3,
      'e1.att': 0, 'e1.dec': 0.06, 'e1.sus': 0, 'e1.rel': 0.05, 'e1.cd': 0.85, 'g.master': 0.726 },
    mods: [row('wheel', 'e1.dec', 0.18), row('velo', 'f.cutoff', 0.1)],
    fx: { 'fx.eq.on': ON, 'fx.eq.typeH': 0, 'fx.eq.freqH': 9000, 'fx.eq.gainH': 3 },
  }),
  recipe('Electro Clap', 'Drum', {
    notes: 'Band-passed noise retriggered three times by a one-shot Env-mode LFO, then a short tail into a plate.',
    noise: { src: 'noise:Pink' }, voicing: { poly: 4 }, velo: 1,
    v: { 'a.on': OFF, 'n.on': ON, 'n.level': 1, 'f.on': ON, 'f.type': 12, 'f.routeA': OFF, 'f.routeN': ON, 'f.cutoff': 1300, 'f.res': 0.3,
      'f.drive': 0.5,
      'e1.att': 0, 'e1.dec': 0.22, 'e1.sus': 0, 'e1.rel': 0.15, 'e1.cd': 0.85, 'l1.rate': 33, 'g.master': 0.522 },
    lfo: [{ mode: 'env', bpm: 0, pts: [[0, 0, 0], [0.1, 1, 0.5], [0.3, 0, 0], [0.4, 1, 0.5], [0.6, 0, 0], [0.7, 1, 0.5], [0.9, 0, 0], [1, 0, 0]] }],
    mods: [row('lfo1', 'g.amp', -1)],
    fx: { 'fx.cmp.on': ON, 'fx.cmp.att': 3, 'fx.cmp.rel': 80, 'fx.cmp.thr': dbA(-20), 'fx.cmp.ratio': 4, 'fx.cmp.gain': dbA(9),
      'fx.rev.on': ON, 'fx.rev.size': 0.35, 'fx.rev.mix': 0.25 }, rev: 0,
  }),
  recipe('Tom Drop', 'Drum', {
    notes: 'Pitched sine tom with a seven-semitone drop and a snap of noise; play it chromatically.',
    wt: ['Sine'], noise: { src: 'noise:Snap', oneshot: 1 }, voicing: { poly: 4 }, velo: 1,
    v: { 'a.level': 0.9, 'a.rand': 0, 'a.phase': 0, 'n.on': ON, 'n.level': 0.25, 'e1.att': 0, 'e1.dec': 0.45, 'e1.sus': 0, 'e1.rel': 0.2,
      'e1.cd': 0.8, 'e2.att': 0, 'e2.dec': 0.12, 'e2.sus': 0, 'g.master': 0.782 },
    mods: [row('env2', 'a.crs', st('a.crs', 7))],
    fx: { 'fx.dist.on': ON, 'fx.dist.drive': 0.2, 'fx.dist.mix': 0.3, 'fx.rev.on': ON, 'fx.rev.mix': 0.15 }, rev: 0,
  }),

  /* ---- FX */
  recipe('Riser Sweep', 'FX', {
    notes: 'A one-shot noise riser and a saw stack climbing two octaves and opening the filter over four bars (one pass).',
    noise: { src: 'noise:Riser', oneshot: 1 },
    v: { 'a.uni': 7, 'a.det': 0.15, 'a.level': 0.6, 'n.on': ON, 'n.level': 0.7, 'f.on': ON, 'f.routeN': ON, 'f.cutoff': 300, 'f.res': 0.3,
      'e1.att': 0.05, 'e1.rel': 1.5, 'g.master': 0.75 },
    lfo: [{ mode: 'env', pts: PTS_RISE }], n: { 'l1.rate': LAD('4 bar') },
    mods: [row('lfo1', 'a.crs', st('a.crs', 24)), row('lfo1', 'f.cutoff', 0.55)],
    fx: { 'fx.rev.on': ON, 'fx.rev.mix': 0.35, 'fx.rev.size': 0.8, 'fx.dly.on': ON, 'fx.dly.mix': 0.2 },
  }),
  recipe('Downlifter', 'FX', {
    notes: 'A one-shot noise fall and a saw stack sliding down two octaves over two bars as the filter closes, into echoes and a hall.',
    noise: { src: 'noise:Downlifter', oneshot: 1 },
    v: { 'a.uni': 7, 'a.det': 0.3, 'a.level': 0.6, 'n.on': ON, 'n.level': 0.8, 'f.on': ON, 'f.routeN': ON, 'f.cutoff': 400, 'f.res': 0.2,
      'e1.att': 0.01, 'e1.rel': 1.5, 'g.master': 0.784 },
    lfo: [{ mode: 'env', pts: [[0, 1, 0], [1, 0, -0.4]] }], n: { 'l1.rate': LAD('2 bar') },
    mods: [row('lfo1', 'a.crs', st('a.crs', 24)), row('lfo1', 'f.cutoff', 0.5)],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.25, 'fx.rev.on': ON, 'fx.rev.size': 0.85, 'fx.rev.mix': 0.4 },
  }),
  recipe('Impact Boom', 'FX', {
    notes: 'Sub sine dropping two octaves from the strike, an impact tail noise and a long hall.',
    wt: ['Sine'], noise: { src: 'noise:Impact Tail', oneshot: 1 }, voicing: { poly: 4 },
    v: { 'a.level': 0.9, 'a.rand': 0, 'a.phase': 0, 'a.oct': -2, 'n.on': ON, 'n.level': 0.6, 'e1.att': 0, 'e1.dec': 2.5, 'e1.sus': 0, 'e1.rel': 1.5,
      'e1.cd': 0.8, 'e2.att': 0, 'e2.dec': 0.35, 'e2.sus': 0, 'g.master': 0.438 },
    mods: [row('env2', 'a.crs', st('a.crs', 24))],
    fx: { 'fx.dist.on': ON, 'fx.dist.drive': 0.3, 'fx.dist.mix': 0.3, 'fx.rev.on': ON, 'fx.rev.size': 0.9, 'fx.rev.t': 0.6, 'fx.rev.mix': 0.35 },
  }),
  recipe('Wind Tunnel', 'FX', {
    notes: 'Wind noise through a moving resonant band-pass, panned slowly.',
    noise: { src: 'noise:Wind' },
    v: { 'a.on': OFF, 'n.on': ON, 'n.level': 1, 'f.on': ON, 'f.type': 12, 'f.routeA': OFF, 'f.routeN': ON, 'f.cutoff': 800, 'f.res': 0.55,
      'f.drive': 0.3,
      'e1.att': 0.6, 'e1.rel': 1.5, 'l1.rate': 0.08, 'l2.rate': 0.05, 'g.master': 0.562 },
    lfo: [{ bpm: 0 }, { bpm: 0 }],
    mods: [row('lfo1', 'f.cutoff', 0.25, { bi: 1 }), row('lfo2', 'n.pan', 0.6, { bi: 1 })],
    fx: { 'fx.rev.on': ON, 'fx.rev.mix': 0.4, 'fx.rev.size': 0.75 },
  }),
  recipe('Laser Drop', 'FX', {
    notes: 'Sync square diving down several octaves, bounced by ping-pong echoes.',
    wt: ['Sync Square'], voicing: { mono: 1 },
    v: { 'a.wt': 0.5, 'a.level': 0.8, 'e1.att': 0, 'e1.dec': 0.5, 'e1.sus': 0, 'e1.rel': 0.2, 'e2.att': 0, 'e2.dec': 0.35, 'e2.sus': 0,
      'g.master': 0.654 },
    mods: [row('env2', 'a.crs', st('a.crs', 45))],
    fx: { 'fx.dly.on': ON, 'fx.dly.mode': 1, 'fx.dly.mix': 0.3, 'fx.dly.feed': 0.45, 'fx.rev.on': ON, 'fx.rev.mix': 0.2 },
    fxn: { 'fx.dly.timeL': DLY_N('1/16'), 'fx.dly.timeR': DLY_N('1/16') },
  }),
]);

/* ================================================================ factory presets v2 (§10.11, M3; C1 + D6) */

// Serum 2 recipes (original sounds, s1 = 0): `v` values in engine units (lawNorm: seconds, Hz, gains, semitones, enum
// indices — WI / FI give WARPS2 / FILTERS indices by id / name), `n` knob positions, `osc` per-oscillator fields deep-merged
// into the default oscillator (`wt` / `spec.filt.wt` as factory table names; `smp` / `multi` factory asset ids, which a
// fresh install generates on first use, §10), `sub` / `noise` / `filter` / `env` / `lfo` / `voicing` / `kbd` / `global`
// merged likewise, `mods` matrix rows (v2 rows, amounts in knob space), `macros` names (or {name, v}), `vc` a FACTORY_VC
// name, `arp` / `clip` {bank (factory bank name), sel, slots / clips: [per-slot fields merged]}, `tun` .scl text, and
// `fx` {main, bus1, bus2: [[type, {pid: engine value | {n}}, {sub, br: [[…], …]}]…], route: [bus 1, bus 2]} built with
// fx-core newInstance (instance ids: the type id, then <type>2 …, which `mods` address as fx.<id>.<pid>). Levels were set
// by rendering each preset through the engine with its assets (tests/presets2.test.mjs): the category phrase at velocity
// 0.8 peaks between −9 and −3 dBFS, finite, without DC, within the §14.1 CPU budget at 2x.
const WI = id => { const i = WARPS2.findIndex(w => w.id === id); if (i < 0) throw new Error('recipe2: warp ' + id); return i; };
const FI = name => { const i = FILTERS.findIndex(f => f.name === name); if (i < 0) throw new Error('recipe2: filter ' + name); return i; };
const row2 = (src, dst, amt, o) => Object.assign(emptyRow(), { src, dst, amt }, o);
function mergeIn(t, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (isObj(v) && isObj(t[k])) mergeIn(t[k], v); else t[k] = clone(v);
  }
  return t;
}
function recipeInst(fx, id) {
  for (const R of fx.racks) for (const I of R.mods) {
    if (I.id === id) return I;
    for (const B of arrOf(I.br)) for (const J of B) if (J.id === id) return J;
  }
  return null;
}
function addFx(fx, spec, where) {
  const [type, vals, o] = spec, id = FXC.newInstance(fx, type, where), I = id ? recipeInst(fx, id) : null;
  if (!I) throw new Error('recipe2: cannot add ' + type);
  for (const pid of Object.keys(vals || {})) {
    const x = vals[pid], fid = 'fx.' + id + '.' + pid;
    if (!FXC.fxDest(fid, fx)) throw new Error('recipe2: ' + type + ' has no ' + pid);
    I.p[pid] = isObj(x) ? clamp01(x.n) : lawNorm(fid, x, fx);
  }
  if (o && o.sub) mergeIn(I.sub, o.sub);
  if (o && o.br) o.br.forEach((list, b) => list.forEach(sp => addFx(fx, sp, { rack: where.rack, splitter: id, branch: b })));
  return id;
}
function recipe2(name, cat, r) {
  const s = defaultSerum(), fx = FXC.defaultFx2();
  s.author = 'Factory';
  s.notes = r.notes || '';
  s.tags = (r.tags || []).slice();
  (r.osc || []).forEach((o, i) => {
    if (!o) return;
    const O = s.osc[i], x = Object.assign({}, o);
    if (x.wt) { O.wt = 'factory:' + x.wt; delete x.wt; }
    if (x.spec && x.spec.filt && x.spec.filt.wt) x.spec = mergeIn(clone(x.spec), { filt: { wt: 'factory:' + x.spec.filt.wt } });
    mergeIn(O, x);
  });
  for (const k of ['sub', 'noise', 'voicing', 'kbd', 'global', 'velo', 'note']) if (r[k]) mergeIn(s[k], r[k]);
  for (const k of ['filter', 'env', 'lfo']) if (r[k]) r[k].forEach((o, i) => { if (o) mergeIn(s[k][i], o); });
  if (r.macros) r.macros.forEach((m, i) => { if (m) Object.assign(s.macros[i], typeof m === 'string' ? { name: m } : m); });
  for (const id of Object.keys(r.v || {})) { if (destIdx(id) < 0) throw new Error('recipe2: ' + id); s.p[id] = lawNorm(id, r.v[id]); }
  for (const id of Object.keys(r.n || {})) { if (destIdx(id) < 0) throw new Error('recipe2: ' + id); s.p[id] = r.n[id]; }
  if (r.vc) applyVcPreset(s, FACTORY_VC.find(p => p.name === r.vc));
  if (r.tun) { const t = loadTuning(s, { scl: r.tun.scl, name: r.tun.name }); if (t.error) throw new Error('recipe2: tuning ' + t.error); }
  if (r.arp) {
    const b = SQ.FACTORY_ARP_BANKS.find(x => x.name === r.arp.bank);
    if (b) s.arp = SQ.loadArpBank(s.arp, b);
    s.arp.sel = r.arp.sel || 0;
    (r.arp.slots || []).forEach((o, j) => { if (o) mergeIn(s.arp.slots[j], o); });
  }
  if (r.clip) {
    const b = SQ.FACTORY_CLIP_BANKS.find(x => x.name === r.clip.bank);
    if (b) s.clip = SQ.loadClipBank(s.clip, b);
    s.clip.sel = r.clip.sel || 0;
    if (r.clip.trig !== undefined) s.clip.trig = r.clip.trig;
    (r.clip.clips || []).forEach((o, j) => { if (o) mergeIn(s.clip.clips[j], o); });
    if (r.clip.all) s.clip.clips.forEach(c => mergeIn(c, r.clip.all));
  }
  (r.mods || []).forEach((m, i) => { s.matrix[i] = m; });
  if (r.velo2) veloToAmp(s);
  const F = r.fx || {};
  ['main', 'bus1', 'bus2'].forEach((k, rack) => (F[k] || []).forEach(sp => addFx(fx, sp, { rack })));
  if (F.route) { fx.racks[1].route = F.route[0] || 0; fx.racks[2].route = F.route[1] || 0; }
  const sN = normalizeSerum(s);
  return { name, cat, v: { s: sN }, fx: FXC.normalizeFx(fx, sN) };
}
const SINE_LFO = [[0, 0.5, 0.03287], [0.125, 0.85355, 0.20169], [0.25, 1, -0.20169], [0.375, 0.85355, -0.03287], [0.5, 0.5, 0.03287],
  [0.625, 0.14645, 0.20169], [0.75, 0, -0.20169], [0.875, 0.14645, -0.03287], [1, 0.5, 0]];
// Drum Loop 120's hits (§10.2 render plan): every eighth note of its two bars → 16 slices
const DRUM_MARKS = Array.from({ length: 15 }, (_, k) => (k + 1) / 16);
// 7-limit just intonation, twelve degrees on C (original Scala text; key 60 = degree 0, key 69 sounds at 440 Hz)
const JUST7_SCL = '! just7.scl\n!\n7-limit just major (twelve degrees on C, septimal minor seventh)\n 12\n!\n 16/15\n 9/8\n 6/5\n 5/4\n 4/3\n 7/5\n 3/2\n 8/5\n 5/3\n 7/4\n 15/8\n 2/1\n';

export const FACTORY_PRESETS_V2 = deepFreeze([
  /* ---- Keys */
  recipe2('Tine Garden', 'Keys', {
    notes: 'The DX tine multisample with a quiet Juno pad multisample under it through an Exp MM low-pass, an HPF chorus, a small-room ' +
      'Convolve and a Utility width stage. Velocity drives the level and the pad\'s brightness; Macro 1 brings the pad up, Macro 2 = ' +
      'room, the mod wheel adds chorus.',
    tags: ['multisample', 'convolve', 'utility'], macros: ['Pad', 'Room'], velo2: 1,
    osc: [{ type: 'multi', multi: 'fmsmp:DX Tine Piano', route: 1 }, { type: 'multi', multi: 'fmsmp:Juno Pad', route: 0 }],
    v: { 'a.level': 0.85, 'b.on': ON, 'b.level': 0.3, 'f.on': ON, 'f.type2': FI('Exp MM'), 'f.cutoff': 2600, 'f.res': 0.12, 'f.var': 0,
      'e1.att': 0.001, 'e1.dec': 3, 'e1.sus': 1, 'e1.rel': 0.45, 'g.master': 0.575 },
    mods: [row2('macro1', 'b.level', 0.45), row2('velo', 'f.cutoff', 0.18), row2('wheel', 'fx.cho.mix', 0.4), row2('macro2', 'fx.conv.mix', 0.4)],
    fx: { main: [['cho', { rate: 0.35, dly1: 5, dly2: 9, depth: 2, feed: 0.05, lpf: 600, hp: 1, mix: 0.3 }],
      ['conv', { mix: 0.22, pre: 4 }, { sub: { ir: 'fir:Short/Small Room' } }], ['util', { width: 1.25, hpf: 28 }]] },
  }),
  recipe2('Organ Drive', 'Keys', {
    notes: 'The Square Organ multisample warped through a Tube distortion warp, with a sine an octave up, into a Wsp filter, the S2 ' +
      'Overdrive, a twelve-pole phaser "rotor" and a Vintage room. Macro 1 = drive (warp and Overdrive), Macro 2 = rotor speed, ' +
      'mod wheel = vibrato.',
    tags: ['multisample', 'warp', 'overdrive'], macros: ['Drive', 'Rotor'],
    osc: [{ type: 'multi', multi: 'fmsmp:Square Organ' }, { wt: 'Default Shapes' }],
    v: { 'a.level': 0.75, 'a.w1': WI('d_tube'), 'a.warp': 0.35, 'b.on': ON, 'b.wt': 1 / 8, 'b.oct': 1, 'b.level': 0.22, 'b.rand': 0,
      'f.on': ON, 'f.type2': FI('Wsp'), 'f.cutoff': 5200, 'f.res': 0.2, 'f.drive': 0.15, 'f.var': 0.1,
      'e1.att': 0.004, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.12, 'l1.rate': 5.8, 'g.master': 0.169 },
    lfo: [{ mode: 'retrig', bpm: 0, pts: SINE_LFO }],
    mods: [row2('macro1', 'a.warp', 0.4), row2('macro1', 'fx.dist.drive', 0.35), row2('macro2', 'fx.phs.rate', 0.35),
      row2('lfo1', 'g.tune', 0.006, { bi: 1, aux: 'wheel' })],
    fx: { main: [['dist', { mode: 16, drive: 0.3, stages: 4, mix: 0.55 }], ['phs', { rate: 0.7, depth: 0.45, freq: 900, feed: 0.25, poles: 12, depth2: 0.3, mix: 0.45 }],
      ['rev', { type: 2, size: 0.3, ersize: 0.5, decay: 0.25, damp: 0.5, mix: 0.18 }]] },
  }),
  /* ---- Bass */
  recipe2('Sub Foundation', 'Bass', {
    notes: 'Three bass multisamples stacked — Mini Bass, the Juno sub for weight, the DX bass for the click — through an Acid ' +
      'Ladder with an envelope, then Utility mono-bass, a gentle compressor and an EQ. Mono with glide; Macro 1 = acid.',
    tags: ['multisample', 'acid ladder', 'utility'], macros: ['Acid'], voicing: { mono: 1, legato: 1 },
    osc: [{ type: 'multi', multi: 'fmsmp:Mini Bass' }, { type: 'multi', multi: 'fmsmp:Juno Sub Bass', route: 0 }, { type: 'multi', multi: 'fmsmp:DX Bass', route: 0 }],
    v: { 'a.level': 0.75, 'b.on': ON, 'b.level': 0.6, 'c.on': ON, 'c.level': 0.35, 'f.on': ON, 'f.type2': FI('Acid Ladder'), 'f.cutoff': 700,
      'f.res': 0.3, 'f.drive': 0.15, 'f.var': 0.2, 'e1.att': 0.002, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.09, 'e2.att': 0, 'e2.dec': 0.28,
      'e2.sus': 0.1, 'e2.rel': 0.1, 'g.porta': 0.035, 'g.master': 0.852 },
    mods: [row2('env2', 'f.cutoff', 0.32), row2('macro1', 'f.res', 0.4), row2('macro1', 'e2.dec', 0.15), row2('velo', 'f.cutoff', 0.08)],
    fx: { main: [['util', { mbass: 1, mfreq: 140 }], ['cmp', { thr: 0.3, ratio: 3, att: 6, rel: 110, gain: 1.4, mix: 1 }],
      ['eq', { typeL: 0, freqL: 80, gainL: 2, typeH: 0, freqH: 6000, gainH: -2 }]] },
  }),
  recipe2('Thru-Zero Growl', 'Bass', {
    notes: 'True through-zero FM: a sine carrier modulated by a silent saw (osc B, routed nowhere), then a Sine Fold distortion warp. ' +
      'Filter 1 MG Dirty and Filter 2 Comb 2 in parallel; a Splitter crushes only the highs. Env 2 = FM bite, LFO 1 (1/8) = fold.',
    tags: ['fm', 'dual warp', 'filter 2', 'splitter'], macros: ['FM', 'Fold'], voicing: { mono: 1, legato: 1 },
    osc: [{ wt: 'Default Shapes', fm: [0, 0], route: 0 }, { wt: 'Default Shapes', route: 3 }],
    v: { 'a.wt': 1 / 8, 'a.level': 0.8, 'a.rand': 0, 'a.w1': WI('fm_o1'), 'a.warp': 0.18, 'a.w2': WI('d_sinfold'), 'a.warp2': 0.2,
      'a.fbal': 0, 'b.on': ON, 'b.level': 0, 'b.wt': 0, 'b.oct': 0,
      'f.on': ON, 'f.type2': FI('MG Dirty'), 'f.cutoff': 1100, 'f.res': 0.25, 'f.var': 0.35, 'f2.on': ON, 'f2.type': FI('Comb 2'),
      'f2.cutoff': 180, 'f2.res': 0.45, 'f2.var': 0.6, 'f2.mix': 0.55, 'f2.level': 0.35,
      'e1.att': 0.002, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.08, 'e2.att': 0, 'e2.dec': 0.3, 'e2.sus': 0.2, 'g.porta': 0.03, 'g.master': 0.588 },
    lfo: [{ mode: 'retrig' }], n: { 'l1.rate': LAD('1/8') },
    mods: [row2('env2', 'a.warp', 0.25), row2('macro1', 'a.warp', 0.3), row2('lfo1', 'a.warp2', 0.3), row2('macro2', 'a.warp2', 0.4),
      row2('env2', 'f.cutoff', 0.15)],
    fx: { main: [['split2', { freq: 220 }, { br: [[['util', { mbass: 1, mfreq: 150 }]], [['dist', { mode: 2, drive: 0.4, mix: 0.8 }],
      ['eq', { typeL: 2, freqL: 300, typeH: 2, freqH: 9000 }]]] }], ['cmp', { thr: 0.25, ratio: 4, att: 4, rel: 90, gain: 1.3 }]] },
  }),
  /* ---- Pad */
  recipe2('Velvet Orchestra', 'Pad', {
    notes: 'Solina, OB and Jupiter string and pad multisamples blended through an Exp MM low-pass that breathes with a slow LFO (the ' +
      'Solina layer swells in on the multisample override envelope); each oscillator also sends to Bus 1, a fully wet Hall reverb. ' +
      'Macro 1 = brightness, Macro 2 = hall send.',
    tags: ['multisample', 'bus fx', 'hall'], macros: ['Bright', 'Hall'],
    osc: [{ type: 'multi', multi: 'fmsmp:Solina Strings', msmo: { override: 1 } }, { type: 'multi', multi: 'fmsmp:OB Strings', route: 0 }, { type: 'multi', multi: 'fmsmp:Jupiter Pad', route: 0 }],
    v: { 'a.level': 0.6, 'a.matt': 0.6, 'a.mdec': 1, 'a.msus': 1, 'a.mrel': 1.6, 'b.on': ON, 'b.level': 0.5, 'c.on': ON, 'c.level': 0.5, 'a.bus1': 0.45, 'b.bus1': 0.45, 'c.bus1': 0.45,
      'f.on': ON, 'f.type2': FI('Exp MM'), 'f.cutoff': 3200, 'f.res': 0.1, 'f.var': 0, 'e1.att': 0.45, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 1.4,
      'l1.rate': 0.12, 'g.master': 0.244 },
    lfo: [{ mode: 'free', mono: 1, bpm: 0, pts: SINE_LFO }],
    mods: [row2('lfo1', 'f.cutoff', 0.08, { bi: 1 }), row2('macro1', 'f.cutoff', 0.3), row2('macro2', 'a.bus1', 0.4), row2('macro2', 'b.bus1', 0.4),
      row2('macro2', 'c.bus1', 0.4)],
    fx: { main: [['cho', { rate: 0.25, dly1: 7, dly2: 12, depth: 2.5, feed: 0.05, lpf: 9000, mix: 0.25 }]],
      bus1: [['rev', { type: 1, size: 0.75, decay: 0.45, spinr: 0.3, spind: 0.3, locut: 0.2, mix: 1 }]] },
  }),
  /* ---- Lead */
  recipe2('Mini Pressure', 'Lead', {
    notes: 'MPE-ready: the Mini Lead multisample with a Hollow PWM stack through a PZ SVF whose X follows slide (Expr Y) and whose Y ' +
      'follows pressure (Expr Z, slewed); pressure also drives the tape drive and the vibrato depth, Expr X moves the PWM table, ' +
      'per-note bend reaches 48 semitones. ' +
      'Without MPE: mod wheel = vibrato, velocity = brightness.',
    tags: ['multisample', 'mpe', 'pz svf'], macros: ['Drive'], global: { mpe: { on: 1, bend: 48 } },
    osc: [{ type: 'multi', multi: 'fmsmp:Mini Lead' }, { wt: 'Hollow PWM', uni: { range: 2, mode: 1 }, route: 0 }],
    v: { 'a.level': 0.75, 'b.on': ON, 'b.level': 0.4, 'b.uni': 3, 'b.det': 0.12, 'b.wt': 0.25,
      'f.on': ON, 'f.type2': FI('PZ SVF'), 'f.cutoff': 2400, 'f.res': 0.3, 'f.x': 0.15, 'f.y': 0,
      'e1.att': 0.008, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.25, 'l1.rate': 5.4, 'g.porta': 0.02, 'g.master': 0.478 },
    lfo: [{ mode: 'retrig', bpm: 0, pts: SINE_LFO }],
    mods: [row2('mpey', 'f.x', 0.6), row2('mpez', 'f.y', 0.5, { rise: 0.25, fall: 0.4 }), row2('mpez', 'fx.dist.drive', 0.3), row2('mpex', 'b.wt', 0.25, { bi: 1 }),
      row2('lfo1', 'g.tune', 0.006, { bi: 1, aux: 'wheel' }), row2('lfo1', 'g.tune', 0.005, { bi: 1, aux: 'mpez' }), row2('velo', 'f.cutoff', 0.15),
      row2('macro1', 'fx.dist.drive', 0.4)],
    fx: { main: [['dist', { mode: 14, drive: 0.15, mix: 0.6 }], ['dly', { bpm: 1, mode: 1, timeL: { n: 6 / 11 }, timeR: { n: 7 / 11 }, feed: 0.35, mix: 0.2, hq: 1 }],
      ['rev', { type: 0, size: 0.45, pre: 15, damp: 0.3, mix: 0.18 }]] },
  }),
  /* ---- Texture */
  recipe2('Granular Drift', 'Texture', {
    notes: 'Three granular oscillators on the factory textures: the Granular Bed through Gaussian grains, the Wind Field through Tukey ' +
      'grains, the Metal Scrape through reversed exponential grains with random pitch — slowly scanning, into a Basin reverb. ' +
      'Macro 1 = density, Macro 2 = scan speed, mod wheel = grain pitch scatter.',
    tags: ['granular', 'basin'], macros: ['Density', 'Scan'],
    osc: [{ type: 'gran', smp: 'fsmp:Granular Bed', smpo: { win: 2, loop: 1 }, uni: { spawn: 1 } },
      { type: 'gran', smp: 'fsmp:Wind Field', smpo: { win: 5, loop: 1 } },
      { type: 'gran', smp: 'fsmp:Metal Scrape', smpo: { win: 9, loop: 1 }, uni: { spawn: 3 } }],
    v: { 'a.level': 1, 'a.dens': 0.5, 'a.glen': 0.62, 'a.scan': 0.06, 'a.roff': 0.25, 'a.rpan': 0.6, 'a.rpitch': 0.15, 'a.uni': 2, 'a.det': 0.05,
      'b.on': ON, 'b.level': 0.65, 'b.dens': 0.42, 'b.glen': 0.55, 'b.scan': 0.1, 'b.rpan': 0.8, 'b.roff': 0.4,
      'c.on': ON, 'c.level': 0.5, 'c.dens': 0.35, 'c.glen': 0.5, 'c.scan': 0.04, 'c.rpitch': 5, 'c.rpan': 1, 'c.uni': 2,
      'e1.att': 1.2, 'e1.dec': 2, 'e1.sus': 1, 'e1.rel': 2.5, 'g.master': 0.811 },
    mods: [row2('macro1', 'a.dens', 0.3), row2('macro1', 'b.dens', 0.3), row2('macro2', 'a.scan', 0.25), row2('macro2', 'c.scan', 0.25),
      row2('wheel', 'a.rpitch', 0.4)],
    fx: { main: [['rev', { type: 4, size: 0.75, feed: 0.8, chr: 0.25, chd: 0.35, hicut: 0.35, mix: 0.4 }]] },
  }),
  /* ---- Sequence */
  recipe2('Break Chopper', 'Sequence', {
    notes: 'The Drum Loop sliced at its sixteen eighth notes and replayed by the Slices clip bank (hold a key: KB SPAN Mono, C4 plays the ' +
      'slices as written, other keys shift them). Each clip\'s Macro 1 lane sweeps a DJ Mixer filter; a three-band compressor and ' +
      'Utility glue it. Clips 1–12 on the trigger octave.',
    tags: ['sample', 'slices', 'clip', 'dj mixer'], macros: ['DJ Filter'],
    osc: [{ type: 'sample', smp: 'fsmp:Drum Loop 120', route: 0, smpo: { slice: { mode: 2, marks: DRUM_MARKS, root: 36 } } }],
    clip: { bank: 'Slices', sel: 2, all: { noteGate: 1, lanes: { m1: [[0, 0.5, 0], [0.5, 0.5, 0], [0.75, 0.25, 0.3], [1, 0.5, 0]] } } },
    v: { 'a.level': 0.8, 'clip.on': ON, 'f.on': ON, 'f.type2': FI('DJ Mixer'), 'f.cutoff': Math.sqrt(MIDI0 * 22050),
      'f.res': 0.2, 'e1.att': 0, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.12, 'g.master': 0.57 },
    voicing: { poly: 8 },
    mods: [row2('macro1', 'f.cutoff', 0.5, { bi: 1 })],
    fx: { main: [['cmp', { mb: 1, thr: 0.25, ratio: 3, below: 1.5, att: 4, rel: 80, gL: 2, gM: 0, gH: 1.5, mix: 0.6 }], ['util', { width: 1.15 }]] },
  }),  recipe2('Clavinet Bite', 'Keys', {
    notes: 'The Prophet Clav multisample over the Acid Pluck multisample an octave down, through a K35 low-pass whose envelope snaps ' +
      'with velocity, then Soft Sat. distortion, an S2 EQ and a short slapback. Macro 1 = bite (resonance and drive).',
    tags: ['multisample', 'k35', 'soft sat'], macros: ['Bite'], velo2: 1,
    osc: [{ type: 'multi', multi: 'fmsmp:Prophet Clav' }, { type: 'multi', multi: 'fmsmp:Acid Pluck', route: 0 }],
    v: { 'a.level': 0.8, 'b.on': ON, 'b.level': 0.35, 'b.oct': -1, 'f.on': ON, 'f.type2': FI('K35'), 'f.cutoff': 1500, 'f.res': 0.3,
      'e1.att': 0.001, 'e1.dec': 1.2, 'e1.sus': 1, 'e1.rel': 0.15, 'e2.att': 0, 'e2.dec': 0.22, 'e2.sus': 0.15, 'e2.rel': 0.15, 'g.master': 0.539 },
    mods: [row2('env2', 'f.cutoff', 0.3), row2('velo', 'f.cutoff', 0.2, { crv: [[0, 0, 0], [0.5, 0.2, 0.3], [1, 1, 0]] }), row2('macro1', 'f.res', 0.35), row2('macro1', 'fx.dist.drive', 0.3)],
    fx: { main: [['dist', { mode: 17, drive: 0.25, mix: 0.6 }], ['eq', { typeL: 2, freqL: 90, typeH: 0, freqH: 5000, gainH: 3, level: 1 }],
      ['dly', { bpm: 0, timeL: 85, timeR: 105, feed: 0.15, mix: 0.18, hq: 0 }]] },
  }),
  recipe2('Grain Keys', 'Keys', {
    notes: 'Playable granular keys: the Pluck Guitar sample through trapezoid grains and the Choir Ahh loop through Blackman-Harris ' +
      'grains, both key-tracked, frozen near their start and slowly scanning. Macro 1 = grain size, mod wheel = scan, velocity = level.',
    tags: ['granular'], macros: ['Grain Size'], velo2: 1,
    osc: [{ type: 'gran', smp: 'fsmp:Pluck Guitar', smpo: { win: 7, loop: 1 } }, { type: 'gran', smp: 'fsmp:Choir Ahh', smpo: { win: 3, loop: 1 } }],
    v: { 'a.level': 0.75, 'a.dens': 0.6, 'a.glen': 0.5, 'a.scan': 0.08, 'a.lstart': 0.02, 'a.lend': 0.6, 'a.rpan': 0.4, 'a.roff': 0.05,
      'b.on': ON, 'b.level': 0.4, 'b.dens': 0.55, 'b.glen': 0.58, 'b.scan': 0.05, 'b.sstart': 0.3, 'b.lstart': 0.25, 'b.lend': 0.85, 'b.rpan': 0.7,
      'e1.att': 0.01, 'e1.dec': 1.6, 'e1.sus': 0.55, 'e1.rel': 0.6, 'g.master': 0.686 },
    mods: [row2('macro1', 'a.glen', 0.25), row2('macro1', 'b.glen', 0.25), row2('wheel', 'a.scan', 0.3)],
    fx: { main: [['cho', { rate: 0.5, dly1: 4, dly2: 9, depth: 2, mix: 0.25 }], ['rev', { type: 0, size: 0.5, pre: 10, mix: 0.2 }]] },
  }),
  recipe2('Exp FM Reese', 'Bass', {
    notes: 'Two detuned saw stacks; the first is exponentially frequency-modulated by a silent sine (osc C) and hard-synced with the ' +
      'window, through an EMS Ladder into a Wsp filter in series, then an M/S splitter (compressed mid, widened side) and ' +
      'Overdrive. Mod wheel = FM depth, Macro 1 = width.',
    tags: ['fm', 'dual warp', 'filter 2', 'splitter'], macros: ['Width'], voicing: { mono: 1, legato: 1 },
    osc: [{ wt: 'Default Shapes', fm: [1, 0] }, { wt: 'Default Shapes', route: 0 }, { wt: 'Default Shapes', route: 3 }],
    filter: [{ route: 0 }],
    v: { 'a.wt': 0, 'a.uni': 2, 'a.det': 0.1, 'a.level': 0.7, 'a.w1': WI('fm_o2'), 'a.warp': 0.12, 'a.w2': WI('sync'), 'a.warp2': 0.08, 'a.wvar2': 1,
      'b.on': ON, 'b.wt': 0, 'b.uni': 2, 'b.det': 0.14, 'b.level': 0.6, 'c.on': ON, 'c.wt': 1 / 8, 'c.oct': -1, 'c.level': 0,
      'f.on': ON, 'f.type2': FI('EMS Ladder'), 'f.cutoff': 900, 'f.res': 0.3, 'f2.on': ON, 'f2.type': FI('Wsp'), 'f2.cutoff': 2500, 'f2.res': 0.15,
      'f2.var': 0, 'e1.att': 0.003, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.12, 'l1.rate': 0.2, 'g.porta': 0.04, 'g.master': 0.407 },
    lfo: [{ mode: 'free', mono: 1, bpm: 0, pts: SINE_LFO }],
    mods: [row2('wheel', 'a.warp', 0.25), row2('lfo1', 'f.cutoff', 0.06, { bi: 1 }), row2('macro1', 'fx.util.width', 0.3)],
    fx: { main: [['splitms', {}, { br: [[['cmp', { thr: 0.3, ratio: 3, att: 8, rel: 120 }]], [['util', { width: 1.4, hpf: 150 }]]] }],
      ['dist', { mode: 16, drive: 0.2, stages: 3, mix: 0.4 }], ['util', { hpf: 22 }]] },
  }),
  recipe2('Linear Rubber', 'Bass', {
    notes: 'Linear FM (never running backwards) of a sine by a square two octaves up, plus PD (Self) feedback, over a Triangle sub; ' +
      'Env 2 bends the FM index so every note bounces. Macro 1 = rubber (FM), Macro 2 = self feedback.',
    tags: ['fm', 'pd', 'sub'], macros: ['Rubber', 'Feedback'], voicing: { mono: 1, legato: 0 },
    osc: [{ wt: 'Default Shapes', fm: [2, 0] }, { wt: 'Default Shapes', route: 3 }],
    sub: { route: 1 },
    v: { 'a.wt': 1 / 8, 'a.level': 0.75, 'a.rand': 0, 'a.w1': WI('fm_o1'), 'a.warp': 0.1, 'a.w2': WI('pd_self'), 'a.warp2': 0.15,
      'b.on': ON, 'b.wt': 3 / 8, 'b.oct': 2, 'b.level': 0, 's.on': ON, 's.shp': 2, 's.level': 0.55, 's.oct': -1,
      'f.on': ON, 'f.type2': FI('MG Low 24'), 'f.cutoff': 1600, 'f.res': 0.2,
      'e1.att': 0.002, 'e1.dec': 0.6, 'e1.sus': 0.7, 'e1.rel': 0.1, 'e2.att': 0, 'e2.dec': 0.35, 'e2.sus': 0, 'g.master': 0.639 },
    mods: [row2('env2', 'a.warp', 0.3), row2('macro1', 'a.warp', 0.25), row2('macro2', 'a.warp2', 0.3), row2('env2', 'f.cutoff', 0.2)],
    fx: { main: [['cmp', { thr: 0.3, ratio: 4, att: 3, rel: 80, gain: 1.4 }], ['eq', { typeL: 0, freqL: 60, gainL: 2, typeH: 2, freqH: 9000 }]] },
  }),
  recipe2('Spectral Choir', 'Pad', {
    notes: 'Two Spectral oscillators: the Choir Ahh loop smeared and given extra harmonics, and the Vocal Sweep 2 wavetable played as a ' +
      'sample, pitch-blended an octave up and swept by a Shepard filter. A Vintage reverb. Macro 1 = smear, Macro 2 = octave blend, ' +
      'mod wheel = Shepard sweep speed.',
    tags: ['spectral', 'vintage'], macros: ['Smear', 'Octave'],
    osc: [{ type: 'spec', smp: 'fsmp:Choir Ahh', smpo: { loop: 1 } }, { type: 'spec', smp: 'factory:Vocal Sweep 2', smpo: { loop: 1 } }],
    v: { 'a.level': 0.7, 'a.lstart': 0.25, 'a.lend': 0.875, 'a.sstart': 0.25, 'a.w1': WI('s_smear'), 'a.warp': 0.55, 'a.w2': WI('s_harm'), 'a.warp2': 0.3,
      'b.on': ON, 'b.level': 0.45, 'b.scan': 0.15, 'b.w1': WI('s_pblend'), 'b.warp': 0.35, 'b.w2': WI('s_shep'), 'b.warp2': 0,
      'e1.att': 0.7, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 1.6, 'l1.rate': 0.05, 'g.master': 0.295 },
    lfo: [{ mode: 'free', mono: 1, bpm: 0, pts: [[0, 0, 0], [1, 1, 0]] }],
    mods: [row2('lfo1', 'b.warp2', 1), row2('wheel', 'l1.rate', 0.15), row2('macro1', 'a.warp', 0.4), row2('macro2', 'b.warp', 0.5)],
    fx: { main: [['rev', { type: 2, size: 0.65, ersize: 0.6, decay: 0.5, damp: 0.4, diffa: 0.75, diffb: 0.6, chr: 0.25, chd: 0.3, mix: 0.35 }]] },
  }),
  recipe2('Glass Cathedral', 'Pad', {
    notes: 'The Glass Bell sample through long Welch grains with a little pitch scatter, over a wide Spectral Saw stack smeared by the ' +
      'Diffusor filter, into the Cathedral impulse response. Macro 1 = diffusion, Macro 2 = space.',
    tags: ['granular', 'diffusor', 'convolve'], macros: ['Diffuse', 'Space'],
    osc: [{ type: 'gran', smp: 'fsmp:Glass Bell', smpo: { win: 1, loop: 1 }, route: 1 }, { wt: 'Spectral Saw', uni: { mode: 1 }, route: 0 }],
    v: { 'a.level': 0.65, 'a.dens': 0.62, 'a.glen': 0.68, 'a.scan': 0.03, 'a.lstart': 0.05, 'a.lend': 0.7, 'a.rpitch': 0.12, 'a.rpan': 0.8,
      'b.on': ON, 'b.level': 0.4, 'b.uni': 5, 'b.det': 0.18, 'b.wt': 0.3, 'f.on': ON, 'f.type2': FI('Diffusor'), 'f.cutoff': 900,
      'f.res': 0.45, 'f.var': 0.55, 'f.mix': 0.7, 'e1.att': 1.1, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 2.2, 'l1.rate': 0.08, 'g.master': 0.308 },
    lfo: [{ mode: 'free', mono: 1, bpm: 0, pts: SINE_LFO }],
    mods: [row2('lfo1', 'b.wt', 0.2, { bi: 1 }), row2('macro1', 'f.var', 0.4), row2('macro2', 'fx.conv.mix', 0.35)],
    fx: { main: [['conv', { mix: 0.35, pre: 20 }, { sub: { ir: 'fir:Massive/Cathedral' } }], ['eq', { typeL: 2, freqL: 120, typeH: 0, freqH: 9000, gainH: 2 }]] },
  }),
  recipe2('Drift Machine', 'Pad', {
    notes: 'Three wavetable oscillators (Hollow PWM super-unison, a synced and bent saw, a Metallic FM shimmer swelling in on Env 4 from ' +
      'its Start level) through an MG Ladder into a DJ Mixer in series. LFO 2 draws a Path whose X opens the ladder and whose Y ' +
      'tilts the DJ filter; Voice Control "Analog Drift" detunes and colours every note differently. Macro 1 = motion, Macro 2 = shimmer.',
    tags: ['3 osc', 'dual warp', 'path lfo', 'voice control', 'filter 2'], macros: ['Motion', 'Shimmer'], vc: 'Analog Drift',
    osc: [{ wt: 'Hollow PWM', uni: { mode: 1, range: 2 }, smoothWT: 1 }, { wt: 'Default Shapes', route: 0 }, { wt: 'Metallic FM', route: 0 }],
    filter: [{ route: 0 }],
    lfo: [null, { type: 'path', mode: 'free', mono: 1, bpm: 1, path: [[0.5, 0.9, 0], [0.85, 0.6, 0.3], [0.7, 0.15, 0], [0.3, 0.2, -0.3], [0.15, 0.65, 0], [0.5, 0.9, 0]] }],
    n: { 'l2.rate': LAD('4 bar') },
    v: { 'a.uni': 5, 'a.det': 0.15, 'a.wt': 0.4, 'a.level': 0.4, 'b.on': ON, 'b.wt': 0, 'b.level': 0.32, 'b.w1': WI('sync'), 'b.warp': 0.18,
      'b.wvar1': 0.5, 'b.w2': WI('bend_pn'), 'b.warp2': 0.6, 'c.on': ON, 'c.oct': 1, 'c.level': 0.12, 'c.wt': 0.5,
      'f.on': ON, 'f.type2': FI('MG Ladder'), 'f.cutoff': 1400, 'f.res': 0.25, 'f.var': 0.3, 'f2.on': ON, 'f2.type': FI('DJ Mixer'), 'f2.cutoff': Math.sqrt(MIDI0 * 22050),
      'e1.att': 0.6, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 1.5, 'e4.att': 2.5, 'e4.dec': 1, 'e4.sus': 1, 'e4.rel': 1.5, 'e4.start': 0.15, 'e4.end': 0, 'g.master': 0.393 },
    mods: [row2('lfo2', 'f.cutoff', 0.25, { bi: 1 }), row2('lfo2y', 'f2.cutoff', 0.12, { bi: 1 }), row2('env4', 'c.level', 0.45), row2('macro1', 'l2.rate', 0.2),
      row2('macro2', 'c.wt', 0.4), row2('vmod1', 'b.warp', 0.1)],
    fx: { main: [['cho', { rate: 0.3, dly1: 8, dly2: 13, depth: 3, feed: 0.1, lpf: 8000, mix: 0.35 }], ['rev', { type: 1, size: 0.6, decay: 0.35, mix: 0.22 }], ['util', { hpf: 25 }]] },
  }),
  recipe2('Pressure Brass', 'Lead', {
    notes: 'MPE-ready brass section: the Prophet Brass and CS-80 Brass multisamples through an MG Ladder. Pressure (Expr Z) swells the ' +
      'level and opens the ladder, slide (Expr Y) crossfades towards the CS-80, glide X pans. Without MPE: velocity and mod wheel do the ' +
      'same jobs.',
    tags: ['multisample', 'mpe', 'mg ladder'], macros: ['Section'], velo2: 1, global: { mpe: { on: 1, bend: 48 } }, voicing: { poly: 6 },
    osc: [{ type: 'multi', multi: 'fmsmp:Prophet Brass' }, { type: 'multi', multi: 'fmsmp:CS-80 Brass', route: 0 }],
    v: { 'a.level': 1, 'b.on': ON, 'b.level': 0.65, 'f.on': ON, 'f.type2': FI('MG Ladder'), 'f.cutoff': 2400, 'f.res': 0.15, 'f.var': 0.3, 'f.level': 1.5,
      'e1.att': 0.02, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.35, 'g.master': 0.982 },
    mods: [row2('mpez', 'f.cutoff', 0.25), row2('mpez', 'g.amp', 0.2), row2('mpey', 'b.level', 0.4), row2('mpex', 'a.pan', 0.5, { bi: 1 }),
      row2('wheel', 'f.cutoff', 0.2), row2('velo', 'f.cutoff', 0.12), row2('macro1', 'b.level', 0.4)],
    fx: { main: [['cho', { rate: 0.4, dly1: 6, dly2: 10, depth: 2, mix: 0.2 }], ['rev', { type: 1, size: 0.55, decay: 0.3, locut: 0.15, mix: 0.2 }]] },
  }),
  recipe2('Harmonic Whistle', 'Lead', {
    notes: 'Additive whistle: an Odd/Even-warped saw with a low-pass warp, and two sines in Harmonics pitch mode (×3 and ×5), plus pink ' +
      'breath noise; mono with glide, delayed vibrato on the mod wheel. A Plate reverb and an eighth echo.',
    tags: ['pitch modes', 'odd/even', 'color noise', 'plate'], macros: ['Breath', 'Odd/Even'], voicing: { mono: 1, legato: 1 },
    osc: [{ wt: 'Default Shapes' }, { wt: 'Default Shapes', pitch: { mode: 'harm' } }, { wt: 'Default Shapes', pitch: { mode: 'harm' } }],
    noise: { src: 'color:Pink' },
    v: { 'a.wt': 0, 'a.level': 0.55, 'a.w1': WI('oddeven'), 'a.warp': 0.25, 'a.w2': WI('lpf'), 'a.warp2': 0.4,
      'b.on': ON, 'b.wt': 1 / 8, 'b.semi': 2, 'b.level': 0.3, 'c.on': ON, 'c.wt': 1 / 8, 'c.semi': 4, 'c.level': 0.18,
      'n.on': ON, 'n.level': 0.12, 'n.color': 0.3, 'e1.att': 0.03, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.3, 'e2.att': 0.15, 'e2.dec': 0.6, 'e2.sus': 0.3,
      'l1.rate': 5.2, 'l1.delay': 0.3, 'l1.rise': 0.4, 'g.porta': 0.06, 'g.master': 0.316 },
    lfo: [{ mode: 'retrig', bpm: 0, pts: SINE_LFO }],
    mods: [row2('lfo1', 'g.tune', 0.007, { bi: 1, aux: 'wheel' }), row2('env2', 'a.warp2', 0.25), row2('macro1', 'n.level', 0.3), row2('macro2', 'a.warp', 0.5)],
    fx: { main: [['dly', { bpm: 1, mode: 1, timeL: { n: 6 / 11 }, timeR: { n: 6 / 11 }, feed: 0.3, mix: 0.16 }], ['rev', { type: 0, size: 0.55, pre: 20, damp: 0.35, mix: 0.22 }]] },
  }),
  recipe2('Spectral Shift Lead', 'Lead', {
    notes: 'The Spectral Saw wavetable resynthesised by a Spectral oscillator: Shift moves every partial by a fixed number of hertz (LFO 1 ' +
      'wobbles it), Pitch Shift follows the mod wheel up to an octave. A saw sub-oscillator underneath keeps the body. Macro 1 = shift.',
    tags: ['spectral', 'wavetable as sample'], macros: ['Shift'], voicing: { mono: 1, legato: 1 },
    osc: [{ type: 'spec', smp: 'factory:Spectral Saw', smpo: { loop: 1 } }, { wt: 'Default Shapes', route: 0 }],
    v: { 'a.level': 0.75, 'a.scan': 0.1, 'a.w1': WI('s_shift'), 'a.warp': 0.5, 'a.w2': WI('s_pshift'), 'a.warp2': 0.5,
      'b.on': ON, 'b.wt': 0, 'b.oct': -1, 'b.level': 0.3, 'f.on': ON, 'f.type2': FI('Low 12'), 'f.cutoff': 3500, 'f.res': 0.15,
      'e1.att': 0.01, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.3, 'l1.rate': 3.5, 'g.porta': 0.05, 'g.master': 0.597 },
    lfo: [{ mode: 'retrig', bpm: 0, pts: SINE_LFO }],
    mods: [row2('lfo1', 'a.warp', 0.002, { bi: 1 }), row2('wheel', 'a.warp2', 0.25), row2('macro1', 'a.warp', 0.15, { bi: 1 })],
    fx: { main: [['dist', { mode: 17, drive: 0.2, mix: 0.4 }], ['dly', { bpm: 1, mode: 1, timeL: { n: 7 / 11 }, timeR: { n: 7 / 11 }, feed: 0.4, mix: 0.2 }],
      ['rev', { type: 0, size: 0.4, mix: 0.15 }]] },
  }),
  /* ---- Pluck */
  recipe2('Mallet Garden', 'Pluck', {
    notes: 'Marimba, tubular bells and harpsichord multisamples layered and retuned to a 7-limit just scale (the embedded .scl, twelve ' +
      'degrees on C), into a slow Bode frequency-shifter shimmer and a Nitrous "Marble" reverb. Macro 1 = bells, Macro 2 = shimmer.',
    tags: ['multisample', 'tuning', 'bode', 'nitrous'], macros: ['Bells', 'Shimmer'], velo2: 1,
    tun: { scl: JUST7_SCL, name: 'Just 7-limit' },
    osc: [{ type: 'multi', multi: 'fmsmp:DX Marimba' }, { type: 'multi', multi: 'fmsmp:DX Bells' }, { type: 'multi', multi: 'fmsmp:Modular Harpsichord' }],
    v: { 'a.level': 1, 'b.on': ON, 'b.level': 0.45, 'c.on': ON, 'c.level': 0.5, 'e1.att': 0.001, 'e1.dec': 2, 'e1.sus': 1, 'e1.rel': 0.8, 'g.master': 0.903 },
    mods: [row2('macro1', 'b.level', 0.4), row2('macro2', 'fx.bode.mix', 0.4)],
    fx: { main: [['bode', { shift: 0.004, range: 100, delay: 140, feed: 0.4, blur: 0.3, bal: 0.5, mix: 0.25 }],
      ['rev', { type: 3, nmode: 1, size: 0.5, feed: 0.65, diff: 0.75, mix: 0.25 }], ['util', { hpf: 30 }]] },
  }),
  recipe2('Ring Bell Pluck', 'Pluck', {
    notes: 'The ARP Ring Bells multisample ring-modulated by a silent Metallic FM oscillator that follows it in Ratio pitch mode (× 3.5), ' +
      'into a spring impulse response and a dotted echo. Macro 1 = ring, Macro 2 = ratio.',
    tags: ['multisample', 'ring mod', 'ratio', 'convolve'], macros: ['Ring', 'Ratio'], velo2: 1,
    osc: [{ type: 'multi', multi: 'fmsmp:ARP Ring Bells' }, { wt: 'Metallic FM', route: 3, pitch: { mode: 'ratio', src: 'A' } }],
    v: { 'a.level': 1, 'a.w1': WI('rm_o1'), 'a.warp': 0.3, 'b.on': ON, 'b.level': 0, 'b.ratio': 3.5, 'b.wt': 0.3,
      'e1.att': 0.001, 'e1.dec': 1.5, 'e1.sus': 0.6, 'e1.rel': 0.6, 'g.master': 0.897 },
    mods: [row2('macro1', 'a.warp', 0.5), row2('macro2', 'b.ratio', 0.2)],
    fx: { main: [['conv', { mix: 0.3 }, { sub: { ir: 'fir:Weird/Spring' } }], ['dly', { bpm: 1, timeL: { n: 6 / 11 }, timeR: { n: 5 / 11 }, feed: 0.3, mix: 0.18 }], ['util', { level: 1.8 }]] },
  }),
  recipe2('Karplus Slice', 'Pluck', {
    notes: 'The Pluck Guitar sample played across the keyboard, with the Stepped Partials wavetable through a high-pass warp and an Exp ' +
      'BPF band-pass for a glassy attack layer, into chorus and a plate. Macro 1 = attack layer, Macro 2 = band-pass sweep.',
    tags: ['sample', 'exp bpf', 'warp'], macros: ['Glass', 'Band'], velo2: 1,
    osc: [{ type: 'sample', smp: 'fsmp:Pluck Guitar', route: 1 }, { wt: 'Stepped Partials', route: 0 }],
    v: { 'a.level': 0.8, 'b.on': ON, 'b.level': 0.4, 'b.wt': 0.4, 'b.w1': WI('hpf'), 'b.warp': 0.35, 'f.on': ON, 'f.type2': FI('Exp BPF'), 'f.cutoff': 1800,
      'f.res': 0.35, 'e1.att': 0.001, 'e1.dec': 0.9, 'e1.sus': 0.4, 'e1.rel': 0.4, 'e2.att': 0, 'e2.dec': 0.18, 'e2.sus': 0, 'g.master': 0.749 },
    mods: [row2('env2', 'b.level', 0.4), row2('env2', 'f.cutoff', 0.2), row2('macro1', 'b.level', 0.4), row2('macro2', 'f.cutoff', 0.3, { bi: 1 })],
    fx: { main: [['cho', { rate: 0.6, dly1: 5, dly2: 8, depth: 2, mix: 0.25 }], ['rev', { type: 0, size: 0.4, pre: 8, damp: 0.4, mix: 0.18 }]] },
  }),
  /* ---- Chord */
  recipe2('Dual Warp Stab', 'Chord', {
    notes: 'A Spectral Saw stack with Bend + and a Hard Clip distortion warp, Hollow PWM underneath, through Filter 1 (low-pass) and ' +
      'Filter 2 (Peak) in parallel, then a 2x12 cabinet impulse and a hall. Env 2 = the stab; Macro 1 = warp, Macro 2 = cabinet.',
    tags: ['dual warp', 'filter 2', 'convolve'], macros: ['Warp', 'Cab'], velo2: 1,
    osc: [{ wt: 'Spectral Saw', uni: { mode: 1 } }, { wt: 'Hollow PWM', route: 0 }],
    v: { 'a.uni': 4, 'a.det': 0.12, 'a.wt': 0.5, 'a.level': 0.85, 'a.w1': WI('bend_p'), 'a.warp': 0.3, 'a.w2': WI('d_hard'), 'a.warp2': 0.25, 'a.fbal': 0,
      'b.on': ON, 'b.level': 0.55, 'b.wt': 0.5, 'b.fbal': 0,
      'f.on': ON, 'f.type2': FI('Low 24'), 'f.cutoff': 900, 'f.res': 0.2, 'f.level': 1.25, 'f2.on': ON, 'f2.type': FI('Peak 12'), 'f2.cutoff': 1800, 'f2.res': 0.4, 'f2.level': 0.45,
      'e1.att': 0.002, 'e1.dec': 0.5, 'e1.sus': 0.3, 'e1.rel': 0.3, 'e2.att': 0, 'e2.dec': 0.3, 'e2.sus': 0.1, 'g.master': 0.95 },
    mods: [row2('env2', 'f.cutoff', 0.35), row2('env2', 'f2.cutoff', 0.2), row2('macro1', 'a.warp2', 0.4), row2('macro2', 'fx.conv.mix', 0.5)],
    fx: { main: [['conv', { mix: 0.4, irgain: -12 }, { sub: { ir: 'fir:Cab/2x12 Closed' } }], ['rev', { type: 1, size: 0.5, decay: 0.3, mix: 0.18 }]] },
  }),
  recipe2('Shimmer Chord', 'Chord', {
    notes: 'Soft triangle-and-sine chords whose Bus 2 send feeds a shimmer: a hall followed by a Bode shifter in feedback, which climbs ' +
      'upwards behind the dry chord. Bus 2 returns to the main bus; Macro 1 = shimmer send, Macro 2 = shift.',
    tags: ['bus fx', 'bode', 'hall'], macros: ['Shimmer', 'Shift'],
    osc: [{ wt: 'Default Shapes' }, { wt: 'Default Shapes', route: 0 }],
    v: { 'a.wt': 2 / 8, 'a.level': 0.6, 'a.uni': 2, 'a.det': 0.06, 'a.bus2': 0.5, 'b.on': ON, 'b.wt': 1 / 8, 'b.oct': 1, 'b.level': 0.3, 'b.bus2': 0.5,
      'f.on': ON, 'f.type2': FI('Low 12'), 'f.cutoff': 4000, 'e1.att': 0.05, 'e1.dec': 1, 'e1.sus': 0.85, 'e1.rel': 1, 'g.master': 0.498 },
    mods: [row2('macro1', 'a.bus2', 0.4), row2('macro1', 'b.bus2', 0.4), row2('macro2', 'fx.bode.shift', 0.1, { bi: 1 })],
    fx: { main: [['cho', { rate: 0.3, dly1: 6, dly2: 11, depth: 2, mix: 0.2 }]],
      bus2: [['rev', { type: 1, size: 0.8, decay: 0.55, spinr: 0.3, spind: 0.35, locut: 0.25, mix: 1 }],
        ['bode', { shift: 0.12, range: 100, delay: 160, feed: 0.55, bal: 1, blur: 0.35, mix: 0.6 }]] },
  }),
  /* ---- Arp */
  recipe2('Pulse Arp', 'Arp', {
    notes: 'The Patterns bank\'s "Pulse 8ths" plays the held chord as eighth-note pulses through a resonant low-pass pluck; Bus 1 is a ' +
      'ping-pong delay. Slots 1–12 hold the twelve factory patterns (trigger octave C-1). Macro 1 = filter, Macro 2 = delay send.',
    tags: ['arp', 'pattern', 'bus fx'], macros: ['Filter', 'Delay'], arp: { bank: 'Patterns', sel: 0 },
    osc: [{ wt: 'Default Shapes' }, { wt: 'Hollow PWM', route: 0 }],
    v: { 'arp.on': ON, 'a.wt': 0, 'a.level': 0.6, 'a.bus1': 0.35, 'b.on': ON, 'b.level': 0.4, 'b.wt': 0.3, 'b.bus1': 0.35,
      'f.on': ON, 'f.type2': FI('MG Low 24'), 'f.cutoff': 700, 'f.res': 0.35, 'e1.att': 0.001, 'e1.dec': 0.25, 'e1.sus': 0.2, 'e1.rel': 0.15,
      'e2.att': 0, 'e2.dec': 0.18, 'e2.sus': 0, 'g.master': 0.635 },
    mods: [row2('env2', 'f.cutoff', 0.35), row2('macro1', 'f.cutoff', 0.3), row2('macro2', 'a.bus1', 0.4), row2('macro2', 'b.bus1', 0.4)],
    fx: { main: [['rev', { type: 0, size: 0.4, mix: 0.12 }]], bus1: [['dly', { bpm: 1, mode: 1, timeL: { n: 6 / 11 }, timeR: { n: 7 / 11 }, feed: 0.45, mix: 1, freq: 1800, q: 2 }]] },
  }),
  recipe2('Euclid Glass', 'Arp', {
    notes: 'The Glass Bell sample on the "Euclid 5/16" pattern over two octaves (RANGE 2), into a Comb Shimmer impulse response and a ' +
      'quarter-note echo. Macro 1 = shimmer, mod wheel = pattern gate.',
    tags: ['arp', 'pattern', 'sample', 'convolve'], macros: ['Shimmer'],
    arp: { bank: 'Patterns', sel: 11, slots: Array.from({ length: 12 }, (_, j) => (j === 11 ? { n: { range: 1 / 7 }, rshape: 0 } : null)) },
    osc: [{ type: 'sample', smp: 'fsmp:Glass Bell' }],
    v: { 'arp.on': ON, 'a.level': 0.8, 'e1.att': 0.001, 'e1.dec': 1.2, 'e1.sus': 0.3, 'e1.rel': 0.5, 'g.master': 0.768 },
    mods: [row2('macro1', 'fx.conv.mix', 0.4), row2('wheel', 'arp.gate', 0.4)],
    fx: { main: [['conv', { mix: 0.3 }, { sub: { ir: 'fir:Coloration/Comb Shimmer' } }], ['dly', { bpm: 1, timeL: { n: 7 / 11 }, timeR: { n: 7 / 11 }, feed: 0.35, mix: 0.2 }]] },
  }),
  recipe2('Gallop Runner', 'Arp', {
    notes: 'A saw-and-square stack on the "Gallop" pattern; a three-band splitter adds chorus to the mids and Soft Sat. grit to the ' +
      'highs while the lows stay clean. Macro 1 = grit, Macro 2 = gate length.',
    tags: ['arp', 'pattern', 'splitter', 'soft sat'], macros: ['Grit', 'Gate'], arp: { bank: 'Patterns', sel: 1 },
    osc: [{ wt: 'Default Shapes' }, { wt: 'Default Shapes', route: 0 }],
    v: { 'arp.on': ON, 'a.wt': 0, 'a.uni': 3, 'a.det': 0.1, 'a.level': 0.55, 'b.on': ON, 'b.wt': 3 / 8, 'b.oct': -1, 'b.level': 0.35,
      'f.on': ON, 'f.type2': FI('Low 24'), 'f.cutoff': 2200, 'f.res': 0.2, 'e1.att': 0.001, 'e1.dec': 0.3, 'e1.sus': 0.5, 'e1.rel': 0.1, 'g.master': 0.406 },
    mods: [row2('macro1', 'fx.dist.drive', 0.4), row2('macro2', 'arp.gate', 0.3, { bi: 1 })],
    fx: { main: [['split3', { freq1: 180, freq2: 2500 }, { br: [[], [['cho', { rate: 0.5, mix: 0.4 }]], [['dist', { mode: 17, drive: 0.4 }]]] }],
      ['rev', { type: 0, size: 0.35, mix: 0.12 }]] },
  }),
  recipe2('Trance Gate Pad', 'Arp', {
    notes: 'A super-unison pad gated by the "Trance Gate" pattern (Chord step mode: every held note on each open step), widened by Voice ' +
      'Control "Stereo Spread", into a long hall and an eighth echo. Macro 1 = gate length, Macro 2 = space.',
    tags: ['arp', 'pattern', 'voice control'], macros: ['Gate', 'Space'], vc: 'Stereo Spread', arp: { bank: 'Patterns', sel: 3 },
    osc: [{ wt: 'Spectral Saw', uni: { mode: 1 } }, { wt: 'Default Shapes', uni: { mode: 1 }, route: 0 }],
    v: { 'arp.on': ON, 'a.uni': 7, 'a.det': 0.2, 'a.wt': 0.2, 'a.level': 0.5, 'b.on': ON, 'b.uni': 5, 'b.det': 0.15, 'b.wt': 0, 'b.oct': 1, 'b.level': 0.25,
      'f.on': ON, 'f.type2': FI('Low 12'), 'f.cutoff': 3000, 'f.res': 0.1, 'e1.att': 0.002, 'e1.dec': 0.2, 'e1.sus': 0.8, 'e1.rel': 0.08, 'g.master': 0.381 },
    mods: [row2('macro1', 'arp.gate', 0.3, { bi: 1 }), row2('macro2', 'fx.rev.mix', 0.3)],
    fx: { main: [['dly', { bpm: 1, mode: 1, timeL: { n: 6 / 11 }, timeR: { n: 6 / 11 }, feed: 0.3, mix: 0.15 }], ['rev', { type: 1, size: 0.7, decay: 0.4, mix: 0.25 }]] },
  }),
  /* ---- Sequence */
  recipe2('Acid Machine', 'Sequence', {
    notes: 'The Basslines clip bank driving a squelchy saw through the Acid Ladder (hold a key: KB SPAN Mono transposes from C4, release ' +
      'stops — NOTE GATE), swung sixteenths, an MG Dirty FX filter for grit. Every clip carries a Macro 1 lane that opens the filter ' +
      'over the bar; Macro 2 = accent.',
    tags: ['clip', 'acid ladder', 'swing', 'fx filter'], macros: ['Cutoff', 'Accent'], voicing: { mono: 1, legato: 1 },
    clip: { bank: 'Basslines', sel: 1, all: { noteGate: 1, lanes: { m1: [[0, 0.1, 0.3], [0.75, 0.6, -0.3], [1, 0.25, 0]] } } },
    osc: [{ wt: 'Default Shapes' }],
    v: { 'clip.on': ON, 'a.wt': 0, 'a.level': 0.75, 'f.on': ON, 'f.type2': FI('Acid Ladder'), 'f.cutoff': 380, 'f.res': 0.55, 'f.drive': 0.2,
      'e1.att': 0.001, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.05, 'e2.att': 0, 'e2.dec': 0.16, 'e2.sus': 0, 'g.porta': 0.03, 'g.master': 0.638 },
    mods: [row2('macro1', 'f.cutoff', 0.35), row2('env2', 'f.cutoff', 0.3), row2('velo', 'f.cutoff', 0.15), row2('macro2', 'f.res', 0.3)],
    kbd: { swing: 0.25, div: 1 },
    fx: { main: [['fil', { type: FI('MG Dirty'), cutoff: 7000, res: 0.1, drive: 0.3, mix: 0.5 }], ['dist', { mode: 0, drive: 0.25, mix: 0.4 }], ['dly', { bpm: 1, mode: 1, timeL: { n: 5 / 11 }, timeR: { n: 6 / 11 }, feed: 0.35, mix: 0.15 }]] },
  }),
  recipe2('Chord Progressor', 'Sequence', {
    notes: 'Hold one key and the Chords clip bank plays its two-bar progressions on a soft detuned pad (KB SPAN Mono: the key transposes ' +
      'from C4, NOTE GATE stops on release). Each clip\'s Macro 1 lane rises over the progression and opens the filter.',
    tags: ['clip', 'chords'], macros: ['Open'],
    clip: { bank: 'Chords', sel: 0, all: { noteGate: 1, lanes: { m1: [[0, 0, 0], [1, 1, 0]] } } },
    osc: [{ wt: 'Default Shapes', uni: { mode: 1 } }, { wt: 'Hollow PWM', route: 0 }],
    v: { 'clip.on': ON, 'a.wt': 0, 'a.uni': 3, 'a.det': 0.1, 'a.level': 0.5, 'b.on': ON, 'b.level': 0.35, 'b.wt': 0.5,
      'f.on': ON, 'f.type2': FI('Low 12'), 'f.cutoff': 900, 'f.res': 0.15, 'e1.att': 0.02, 'e1.dec': 1, 'e1.sus': 0.8, 'e1.rel': 0.3, 'g.master': 0.274 },
    mods: [row2('macro1', 'f.cutoff', 0.3)],
    fx: { main: [['cho', { rate: 0.4, mix: 0.3 }], ['rev', { type: 1, size: 0.6, decay: 0.35, mix: 0.22 }]] },
  }),
  recipe2('Melody Box', 'Sequence', {
    notes: 'The Melodies clip bank on a music-box voice: the Vocal Sweep 2 wavetable scanned by each clip\'s Macro 1 lane (a ramp over ' +
      'two bars), a sine an octave up, a quarter echo and a plate. Hold a key to play (NOTE GATE): the key transposes from C4 and ' +
      'KEY / SCALE (C minor pentatonic) keeps every transposition in the scale.',
    tags: ['clip', 'wavetable', 'scale'], macros: ['Vowel'],
    clip: { bank: 'Melodies', sel: 0, all: { noteGate: 1 } }, kbd: { key: 0, scale: 10 },
    osc: [{ wt: 'Vocal Sweep 2' }, { wt: 'Default Shapes' }],
    v: { 'clip.on': ON, 'a.level': 0.6, 'b.on': ON, 'b.wt': 1 / 8, 'b.oct': 1, 'b.level': 0.3, 'e1.att': 0.002, 'e1.dec': 0.6, 'e1.sus': 0.3,
      'e1.rel': 0.35, 'g.master': 0.567 },
    mods: [row2('macro1', 'a.wt', 0.9)],
    fx: { main: [['dly', { bpm: 1, mode: 1, timeL: { n: 7 / 11 }, timeR: { n: 7 / 11 }, feed: 0.35, mix: 0.2 }], ['rev', { type: 0, size: 0.5, mix: 0.2 }]] },
  }),
  /* ---- Texture */
  recipe2('Frozen Vowels', 'Texture', {
    notes: 'The Vowel Phrase in Manual X|Y granular mode: an S&H LFO jumps the X position between vowels while Y scatters grain pitch, ' +
      'Sinc grains; the Whisper Text underneath through reversed Triangle grains. A Granular Smear impulse response and a long echo. ' +
      'Macro 1 = scatter, mod wheel = freeze rate.',
    tags: ['granular', 'x|y', 's&h lfo', 'convolve'], macros: ['Scatter'],
    osc: [{ type: 'gran', smp: 'fsmp:Vowel Phrase', smpo: { win: 4 }, xy: { on: 1, y: 10, yMode: 0 } },
      { type: 'gran', smp: 'fsmp:Whisper Text', smpo: { win: 6, loop: 1 } }],
    lfo: [{ type: 'sh', mode: 'free', mono: 1, bpm: 1, pts: [[0, 0, 0], [1, 1, 0]] }], n: { 'l1.rate': LAD('1/2') },
    v: { 'a.level': 1, 'a.dens': 0.6, 'a.glen': 0.6, 'a.pos': 0.3, 'a.gy': 0.55, 'a.rpan': 0.5, 'a.uni': 2, 'a.det': 0.03,
      'b.on': ON, 'b.level': 0.5, 'b.dens': 0.5, 'b.glen': 0.52, 'b.scan': 0.2, 'b.grev': 1, 'b.rdir': 0.5, 'b.rpan': 0.9,
      'e1.att': 0.8, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 2, 'g.master': 0.729 },
    mods: [row2('lfo1', 'a.pos', 0.6), row2('macro1', 'a.gy', 0.4), row2('wheel', 'l1.rate', 0.2)],
    fx: { main: [['conv', { mix: 0.3 }, { sub: { ir: 'fir:Weird/Granular Smear' } }], ['dly', { bpm: 1, mode: 1, timeL: { n: 8 / 11 }, timeR: { n: 9 / 11 }, feed: 0.4, mix: 0.2 }]] },
  }),
  recipe2('Spectral Mask Field', 'Texture', {
    notes: 'The FM Drone resynthesised by a Spectral oscillator, masked by pink noise and vocoded by a Stepped Partials wavetable whose ' +
      'position a Rossler chaos LFO wanders (both modulators routed nowhere). A Basin reverb. Macro 1 = mask, Macro 2 = vocode.',
    tags: ['spectral', 'chaos lfo', 'color noise'], macros: ['Mask', 'Vocode'],
    osc: [{ type: 'spec', smp: 'fsmp:FM Drone', smpo: { loop: 1 } }, null, { wt: 'Stepped Partials', route: 3 }],
    noise: { src: 'color:Pink', route: 3 },
    lfo: [{ type: 'rossler', mode: 'free', mono: 1, bpm: 0 }],
    v: { 'a.level': 0.8, 'a.scan': 0.25, 'a.w1': WI('s_mask_noise'), 'a.warp': 0.45, 'a.w2': WI('s_voc_o2'), 'a.warp2': 0.5,
      'c.on': ON, 'c.level': 0, 'c.wt': 0.3, 'n.on': ON, 'n.level': 0.5, 'l1.rate': 0.4,
      'e1.att': 1.5, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 2.5, 'g.master': 0.461 },
    mods: [row2('lfo1', 'c.wt', 0.6, { bi: 1 }), row2('macro1', 'a.warp', 0.4), row2('macro2', 'a.warp2', 0.4)],
    fx: { main: [['rev', { type: 4, size: 0.7, feed: 0.75, chr: 0.2, chd: 0.3, mix: 0.35 }]] },
  }),
  recipe2('Shepard Haze', 'Texture', {
    notes: 'The Hollow PWM wavetable as a Spectral source through Shepard Narrow (its sweep rises forever on a saw LFO) and Spread; the ' +
      'Granular Bed resynthesised with Phase Twist and per-bin Detune. Macro 1 = spread, Macro 2 = twist.',
    tags: ['spectral', 'shepard'], macros: ['Spread', 'Twist'],
    osc: [{ type: 'spec', smp: 'factory:Hollow PWM', smpo: { loop: 1 } }, { type: 'spec', smp: 'fsmp:Granular Bed', smpo: { loop: 1 } }],
    lfo: [{ mode: 'free', mono: 1, bpm: 0, pts: [[0, 0, 0], [1, 1, 0]] }],
    v: { 'a.level': 0.6, 'a.scan': 0.05, 'a.w1': WI('s_shepn'), 'a.warp': 0, 'a.w2': WI('s_spread'), 'a.warp2': 0.1,
      'b.on': ON, 'b.level': 0.5, 'b.scan': 0.1, 'b.w1': WI('s_twist'), 'b.warp': 0.3, 'b.w2': WI('s_detune'), 'b.warp2': 0.4,
      'l1.rate': 0.07, 'e1.att': 2, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 3, 'g.master': 0.572 },
    mods: [row2('lfo1', 'a.warp', 1), row2('macro1', 'a.warp2', 0.3), row2('macro2', 'b.warp', 0.5)],
    fx: { main: [['rev', { type: 1, size: 0.85, decay: 0.6, spinr: 0.2, spind: 0.4, mix: 0.4 }]] },
  }),
  /* ---- Pad (spectral) and Keys (spectral) */
  recipe2('Vocoder Pad', 'Pad', {
    notes: 'A bright Spectral Saw stack resynthesised and vocoded by the Vowel Phrase (a Sample oscillator routed nowhere), combed, through ' +
      'a "Vowel A" spectral filter. Macro 1 = vocode, Macro 2 = comb.',
    tags: ['spectral', 'vocode', 'spectral filter'], macros: ['Vocode', 'Comb'],
    osc: [{ type: 'spec', smp: 'factory:Spectral Saw', smpo: { loop: 1 }, spec: { filt: { pts: FACTORY_SPEC_FILTERS.find(p => p.name === 'Vowel A').pts } } },
      { type: 'sample', smp: 'fsmp:Vowel Phrase', route: 3, smpo: { loop: 1 } }],
    v: { 'a.level': 0.8, 'a.scan': 0.2, 'a.smix': 0.5, 'a.w1': WI('s_voc_o1'), 'a.warp': 0.7, 'a.w2': WI('s_comb'), 'a.warp2': 0.2,
      'b.on': ON, 'b.level': 0, 'e1.att': 0.4, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 1.2, 'g.master': 0.337 },
    mods: [row2('macro1', 'a.warp', 0.3), row2('macro2', 'a.warp2', 0.5)],
    fx: { main: [['cho', { rate: 0.3, mix: 0.3 }], ['rev', { type: 2, size: 0.5, decay: 0.4, mix: 0.25 }]] },
  }),
  recipe2('Spectral Peaks', 'Keys', {
    notes: 'Two Spectral oscillators that grow partials from their peaks: the Glass Bell with Peak Octave Up and Peak Harm Down, the Pluck ' +
      'Guitar with Peak Octave Down and Peak Harm Up. Velocity = level; Macro 1 = upper peaks, Macro 2 = lower peaks.',
    tags: ['spectral'], macros: ['Upper', 'Lower'], velo2: 1,
    osc: [{ type: 'spec', smp: 'fsmp:Glass Bell' }, { type: 'spec', smp: 'fsmp:Pluck Guitar' }],
    v: { 'a.level': 0.65, 'a.w1': WI('s_pkoctu'), 'a.warp': 0.35, 'a.w2': WI('s_pkharmd'), 'a.warp2': 0.25,
      'b.on': ON, 'b.level': 0.6, 'b.w1': WI('s_pkoctd'), 'b.warp': 0.3, 'b.w2': WI('s_pkharmu'), 'b.warp2': 0.25,
      'e1.att': 0.003, 'e1.dec': 1.5, 'e1.sus': 0.5, 'e1.rel': 0.6, 'g.master': 0.348 },
    mods: [row2('macro1', 'a.warp', 0.4), row2('macro1', 'b.warp2', 0.4), row2('macro2', 'b.warp', 0.4), row2('macro2', 'a.warp2', 0.4)],
    fx: { main: [['rev', { type: 0, size: 0.45, pre: 12, mix: 0.2 }]] },
  }),
  /* ---- FX */
  recipe2('Spectral Debris', 'FX', {
    notes: 'Three Spectral oscillators: the Riser gated and mirrored, the Metal Scrape with sub-harmonics masked by the riser, the Impact ' +
      'vocoded by noise and masked by the scrape. One held note is a whole transition. Macro 1 = gate, Macro 2 = mirror.',
    tags: ['spectral'], macros: ['Gate', 'Mirror'],
    osc: [{ type: 'spec', smp: 'fsmp:Riser 4 bar' }, { type: 'spec', smp: 'fsmp:Metal Scrape' }, { type: 'spec', smp: 'fsmp:Impact' }],
    noise: { src: 'color:White', route: 3 },
    v: { 'a.level': 0.9, 'a.w1': WI('s_gate'), 'a.warp': 0.3, 'a.w2': WI('s_mirror'), 'a.warp2': 0.35,
      'b.on': ON, 'b.level': 0.7, 'b.w1': WI('s_subh'), 'b.warp': 0.4, 'b.w2': WI('s_mask_o1'), 'b.warp2': 0.4,
      'c.on': ON, 'c.level': 0.9, 'c.w1': WI('s_voc_noise'), 'c.warp': 0.3, 'c.w2': WI('s_mask_o2'), 'c.warp2': 0.3, 'n.on': ON, 'n.level': 0.4,
      'e1.att': 0.01, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 1.5, 'g.master': 0.908 },
    mods: [row2('macro1', 'a.warp', 0.5), row2('macro2', 'a.warp2', 0.5)],
    fx: { main: [['dly', { bpm: 1, mode: 1, timeL: { n: 7 / 11 }, timeR: { n: 8 / 11 }, feed: 0.4, mix: 0.2 }], ['rev', { type: 1, size: 0.7, decay: 0.45, mix: 0.3 }]] },
  }),
  recipe2('Grain Storm', 'FX', {
    notes: 'The Riser through Hann grains spawning on a sixteenth-note grid, the Impact through exponential-decay grains, and Geiger noise ' +
      'through a Comb 2 filter swept by a Lorenz chaos LFO; Bode with feedback on top. Macro 1 = storm (density, Geiger), Macro 2 = shift.',
    tags: ['granular', 'chaos lfo', 'comb 2', 'bode', 'color noise'], macros: ['Storm', 'Shift'],
    osc: [{ type: 'gran', smp: 'fsmp:Riser 4 bar', smpo: { win: 0, dens: { mode: 1 } } }, { type: 'gran', smp: 'fsmp:Impact', smpo: { win: 8, loop: 1 } }],
    noise: { src: 'color:Geiger', route: 0 },
    lfo: [{ type: 'lorenz', mode: 'free', mono: 1, bpm: 0 }],
    v: { 'a.level': 0.7, 'a.dens': 6 / 16, 'a.glen': 0.55, 'a.rpan': 0.7, 'b.on': ON, 'b.level': 0.5, 'b.dens': 0.45, 'b.glen': 0.6, 'b.rpitch': 4, 'b.scan': 0.3,
      'n.on': ON, 'n.level': 0.35, 'n.pitch': 12, 'f.on': ON, 'f.type2': FI('Comb 2'), 'f.cutoff': 300, 'f.res': 0.4, 'f.var': 0.65, 'f.mix': 0.5,
      'f.routeA': 0, 'f.routeB': 0, 'f.routeN': 1, 'l1.rate': 0.6, 'e1.att': 0.05, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 1.2, 'g.master': 0.226 },
    mods: [row2('lfo1', 'f.cutoff', 0.3, { bi: 1 }), row2('macro1', 'a.dens', 0.25), row2('macro1', 'n.level', 0.3), row2('macro2', 'fx.bode.shift', 0.3, { bi: 1 })],
    fx: { main: [['bode', { shift: 0.53, range: 100, delay: 90, feed: 0.4, mix: 0.4 }], ['rev', { type: 3, nmode: 2, size: 0.6, feed: 0.7, mix: 0.3 }]] },
  }),
  /* ---- Drum */
  recipe2('Break Kit', 'Drum', {
    notes: 'The Break 96 loop cut into its sixteen sixteenth notes from C3 (one slice per key up to D#4, no keytracking), through a punchy ' +
      'compressor, a Utility and the Tape Head impulse response. Macro 1 = punch, Macro 2 = tape.',
    tags: ['sample', 'slices', 'convolve'], macros: ['Punch', 'Tape'],
    osc: [{ type: 'sample', smp: 'fsmp:Break 96', route: 1, smpo: { slice: { mode: 2, marks: Array.from({ length: 15 }, (_, k) => (k + 1) / 16), root: 48 } } }],
    v: { 'a.level': 0.8, 'e1.att': 0, 'e1.dec': 1, 'e1.sus': 1, 'e1.rel': 0.08, 'g.master': 0.603 },
    voicing: { poly: 8 },
    mods: [row2('macro1', 'fx.cmp.mix', 0.5), row2('macro2', 'fx.conv.mix', 0.5)],
    fx: { main: [['cmp', { thr: 0.3, ratio: 4, att: 12, rel: 70, gain: 1.4, mix: 0.6 }], ['conv', { mix: 0.3 }, { sub: { ir: 'fir:Coloration/Tape Head' } }],
      ['util', { hpf: 30, width: 1.1 }]] },
  }),
]);

// v2 list (§10.11, §11.1): the new Serum 2 presets (C1 + D6, M3) first, then the Phase-1 presets migrated (s1 = 1).
// FACTORY_PRESETS_V1 keeps the Phase-1 objects (frozen, for tests and the golden suite). Preset keys ('f:' + name) of the
// Phase-1 presets resolve to their migrated versions.
export const FACTORY_PRESETS = deepFreeze(FACTORY_PRESETS_V2.concat(FACTORY_PRESETS_V1.map(p => {
  const s = normalizeSerum(p.v.s);
  return { name: p.name, cat: p.cat, v: { s }, fx: normalizeFx(p.fx, s) };
})));
