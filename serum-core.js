/*
 * serum-core.js — pure model of the Serum-style instrument and of the per-track FX rack.
 * Canonical constants (spec §3), state schemas and normalisation (§2), compilers to the
 * engine formats (§4) and the shared curve maths (§4.4). No DOM, no timers, no imports:
 * importable from the browser, from node and from Workers. Contract: SPEC-serum.md (v2);
 * the § numbers in comments refer to it.
 *
 * Everything exported as a constant is deep-frozen. Functions never mutate their inputs, except the §8.1 editing
 * helpers that the spec defines as in place on the state `s` (addMod, removeMods, setModAmount, toggleModBypass,
 * toggleModPolarity, reassignSource, veloToAmp, vibratoAssign, initLfos, copyLfo, pruneBuses, clearPointMods,
 * warpChoice, copyModule's target). Typed entry: parseParam (§8.1) inverts fmtParam (§3.2).
 * Compiled objects (CP, CT, FXP, FXT) contain typed arrays and are not frozen: treat them as
 * read-only (CT/FXT objects are memoised and shared between calls with equal curves).
 *
 * Beyond the §8.1 list (shapes other modules rely on):
 *   compileFxT(fx) → FXT {key, xsA, xsB} (§4.2): the only producer of patch.fxrT; memoised by content (shared
 *     object, key === FXP.xsKey of the same fx); repairs a malformed fx through normalizeFx like compileFx.
 *   CP.veloPorta, CP.notePorta (0/1): s.velo.porta / s.note.porta for the DSP (§5.3, §6.1; absent from §4.1).
 *   MODULE_FIELDS[m] = {p: [DEST ids in s.p], paths: [[key, …], …]} (structured paths into the state).
 *   REV_LABELS[rev.type] (0 Plate, 1 Hall) = labels of the slots size, t, locut, c, hicut, w, mix.
 *   CMP_RATIO_DETENTS = n values (1 − 1/r, Limit = 1), as wk knob `detents` expect, not ratios.
 *   copyModule(target, source, m, from?) module Copy/Paste/Init incl. OSC A ↔ OSC B; destBase(s, fx, id) base n
 *   of any DEST (FX ids from fx.p); eqGainDb(v) EQ-family Var gain in dB; MEMSET_DEFAULT_A / _B (§2.1).
 *   pruneBuses(s, buses?) optional bus list; parseParam reads bare numbers on time controls in the unit the
 *   control shows at its current base (s or ms).
 *   FACTORY_CHAINS = { type: 'synth.fxchains', v: 1, chains: [{ name, fx }] }: factory effect chains (rack presets for
 *   any track) in the shared chain-library format, fx normalised without ui / lock; the rack's and SerumUI's Load
 *   Effect Chain menus list them under Factory. FACTORY_PRESETS categories: Init, Bass, Lead, Pad, Pluck, Keys,
 *   Chord, Arp, Seq, Drum, FX.
 */

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
const sgn = v => (v > 0 ? '+' : '');

function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/* ================================================================ §0.4, §4.4 constants */

export const VERSION = 1;
export const CP_VER = 1;
export const FXP_VER = 1;
export const MIDI0 = 440 * Math.pow(2, -69 / 12);      // 8.175798915643707 Hz (MIDI note 0)
const MIDI128 = 440 * Math.pow(2, 59 / 12);            // 13289.750322… Hz (MIDI note 128)

export const CURVE_K = 10;
export const ENV_K = 10;
export const MC_K = 6;
export const PORTA_K = 6;
export const LFO_N = 1024;
export const REMAP_N = 2048;
export const XS_N = 1024;
export const CURVE_N = 128;
export const MAX_PTS = 480;
export const N_MATRIX = 32;
export const N_LFO = 8;
export const N_ENV = 3;
export const N_MACRO = 4;
export const N_BUS = 16;
export const FRAME = 2048;
export const MAX_FRAMES = 256;

/* ================================================================ §3.1 laws, §3.2 format codes */

export const LAWS = deepFreeze(['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio', 'npitch']);
export const LAW = deepFreeze(LAWS.reduce((o, n, i) => { o[n] = i; return o; }, {}));

export const FMT_CODES = deepFreeze(['pct', 'pct1', 'pan', 'fpan', 'oct', 'st', 'st2', 'ct', 'crs', 'int', 'det', 'phase', 'deg', 'frame',
  'bip100', 'hz', 'time', 'ms', 'msFloor', 'cmpAtt', 'db', 'dbv', 'dbtrim', 'bool', 'enum', 'ratio', 'xoff', 'q01', 'q2', 'lbh', 'var',
  'npitch', 'lfoRate', 'lfoTime', 'chaosRate', 'modRate', 'dlyTime', 'revT']);

/* ================================================================ §3.3 warp modes */

export const WARPS = deepFreeze([
  ['off', 'Off'], ['sync', 'Sync'], ['sync_half', 'Sync 1/2 Win.'], ['sync_win', 'Sync Window'],
  ['bend_p', 'Bend +'], ['bend_n', 'Bend -'], ['bend_pn', 'Bend +/-'], ['pwm', 'PWM'],
  ['asym_p', 'Asym +'], ['asym_n', 'Asym -'], ['asym_pn', 'Asym +/-'], ['flip', 'Flip'], ['mirror', 'Mirror'],
  ['remap1', 'Remap 1'], ['remap2', 'Remap 2'], ['remap3', 'Remap 3'], ['remap4', 'Remap 4'], ['quantize', 'Quantize'],
  ['fm_osc', 'FM (from B)', 'FM (from A)'], ['am_osc', 'AM (from B)', 'AM (from A)'], ['rm_osc', 'RM (from B)', 'RM (from A)'],
  ['fm_noise', 'FM (Noise)'], ['fm_sub', 'FM (Sub)'],
].map(([id, name, nameB]) => ({ id, name, nameB: nameB || name })));

/* ================================================================ §3.4 filters (same builder as exp/gen.mjs, minus hints) */

export const FILTER_CATS = deepFreeze(['Normal', 'Multi', 'Flanges', 'Misc']);
export const FILTER_FAMILY = deepFreeze(['ladder', 'svf', 'dual', 'morph', 'comb', 'flange', 'phaser', 'fphs', 'eq', 'ring', 'snh', 'bank',
  'french', 'german', 'addbass', 'formant', 'breject', 'distcomb', 'scream']);
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
  return F;
})());

/* ================================================================ §3.5 formants, §3.6 sub shapes */

// FORMANTS[table I/II/III][vowel a e i o u] = [F1, F2, F3] Hz
export const FORMANTS = deepFreeze([
  [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]],
  [[850, 1220, 2810], [610, 2330, 2990], [310, 2790, 3310], [590, 920, 2710], [370, 950, 2670]],
  [[1030, 1370, 3170], [690, 2610, 3570], [370, 3200, 3730], [680, 1060, 3180], [430, 1170, 3260]],
]);

export const SUB_SHAPES = deepFreeze([['sine', 'Sine'], ['roundrect', 'RoundRect'], ['saw', 'Saw'], ['square', 'Square'], ['pulse', 'Pulse']]
  .map(([id, name]) => ({ id, name, table: 'sub:' + name })));
export const SUB_IDS = deepFreeze(SUB_SHAPES.map(s => s.table));

/* ================================================================ §3.8 unison */

export const UNI_STACKS = deepFreeze(['off', '12 (1x)', '12 (2x)', '12 (3x)', '12+7(1x)', '12+7(2x)', '12+7(3x)', 'Center-12', 'Center-24']);
export const UNI_MODES = deepFreeze(['Linear', 'Super', 'Exp.', 'Inv.', 'Random']);

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

/* ================================================================ §3.9, §3.10 ladders */

const LFO_LABELS = ['32 bar', '16 bar', '8 bar', '4 bar', '2 bar', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64', '1/128', '1/256', 'fast'];
export const LFO_LADDER = deepFreeze(LFO_LABELS.map((label, i) => ({ label, beats: 128 * Math.pow(2, -i) })));
const LADDERS = [];
for (let v = 0; v < 4; v++) {
  const dot = v & 1, trip = v >> 1, L = [];
  LFO_LADDER.forEach((e, i) => L.push({ label: e.label, beats: e.beats, k: 0 }));
  if (dot) for (let i = 0; i < 14; i++) L.push({ label: LFO_LADDER[i].label + '.', beats: LFO_LADDER[i].beats * 1.5, k: 1 });
  if (trip) for (let i = 0; i < 14; i++) L.push({ label: LFO_LADDER[i].label + 'T', beats: LFO_LADDER[i].beats * 2 / 3, k: 2 });
  L.sort((a, b) => b.beats - a.beats || a.k - b.k);
  LADDERS.push(deepFreeze(L.map(e => ({ label: e.label, beats: e.beats }))));
}
// [{label, beats}] slowest → fastest; lengths 15 / 29 / 29 / 43 (frozen, shared)
export function lfoLadder(dot, trip) { return LADDERS[(dot ? 1 : 0) + (trip ? 2 : 0)]; }

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

/* ================================================================ §3.11 FX enumerations */

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
const REV_SLOTS = ['size', 't', 'locut', 'c', 'hicut', 'w', 'mix'];
export const EQ_TYPES_L = deepFreeze(['Shelf', 'Peak', 'HP']);
export const EQ_TYPES_H = deepFreeze(['Shelf', 'Peak', 'LP']);
// Ratio detents of the compressor RATIO knob as normalised values n = 1 − 1/r (wk knob `detents` are n values):
// r = 1.0, 1.1 … 1.9, 2, 3, 4, 5, 6, 7, 8, 10, 16, 32, then Limit (n = 1).
export const CMP_RATIO_DETENTS = deepFreeze([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 4, 5, 6, 7, 8, 10, 16, 32]
  .map(r => 1 - 1 / r).concat([1]));

/* ================================================================ §3.12 sources */

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
  return S;
})());
export const NSRC = SOURCES.length;
const SRC_MAP = new Map(SOURCES.map((s, i) => [s.id, i]));
export const SRC_INDEX = deepFreeze(SOURCES.reduce((o, s, i) => { o[s.id] = i; return o; }, {}));
export const SRC_MENU = deepFreeze(['env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'velo', 'note',
  'wheel', 'at', 'pat', 'bend', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2', 'macro1', 'macro2', 'macro3', 'macro4',
  'mpex', 'mpey', 'mpez', 'relvel', 'fixed']);
export const SIDX = deepFreeze(SOURCES.reduce((o, s, i) => { if (s.id) o[s.id.toUpperCase()] = i; return o; }, {}));

/* ================================================================ §3.13 destinations (same builder as exp/gen.mjs) */

export const DESTS = deepFreeze((() => {
  const D = [];
  const add = (id, label, law, lo, hi, def, fmt, scope, ctr, group) => D.push({ id, label, law, lo, hi, def, fmt, scope, ctr: ctr ? 1 : 0, group });
  for (const [k, K] of [['a', 'A'], ['b', 'B']]) {
    const g = `Osc ${K}`;
    add(`${k}.level`, `Osc ${K} Level`, 'pow2', 0, 1, 0.75, 'pct', 'V', 0, g);
    add(`${k}.pan`, `Osc ${K} Pan`, 'lin', -1, 1, 0.5, 'pan', 'V', 1, g);
    add(`${k}.oct`, `Osc ${K} Octave`, 'int', -4, 4, 0.5, 'oct', 'V', 1, g);
    add(`${k}.semi`, `Osc ${K} Semi`, 'int', -12, 12, 0.5, 'st', 'V', 1, g);
    add(`${k}.fine`, `Osc ${K} Fine`, 'lin', -100, 100, 0.5, 'ct', 'V', 1, g);
    add(`${k}.crs`, `Osc ${K} Coarse Pitch`, 'lin', -64, 64, 0.5, 'crs', 'V', 1, g);
    add(`${k}.uni`, `Osc ${K} Unison`, 'int', 1, 16, 0, 'int', 'V*', 0, g);
    add(`${k}.det`, `Osc ${K} Uni Detune`, 'pow2', 0, 1, 0.5, 'det', 'V', 0, g);
    add(`${k}.blend`, `Osc ${K} Uni Blend`, 'lin', 0, 1, 0.75, 'pct', 'V', 0, g);
    add(`${k}.phase`, `Osc ${K} Phase`, 'lin', 0, 360, 0.5, 'phase', 'V', 0, g);
    add(`${k}.rand`, `Osc ${K} Rand Phase`, 'lin', 0, 1, 1, 'pct', 'V', 0, g);
    add(`${k}.wt`, `Osc ${K} WT Pos`, 'lin', 0, 1, 0, 'frame', 'V', 0, g);
    add(`${k}.warp`, `Osc ${K} Warp`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
    add(`${k}.uniw`, `Osc ${K} Uni Width`, 'lin', 0, 1, 1, 'pct', 'V', 0, g);
    add(`${k}.uniwarp`, `Osc ${K} Uni Warp`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, g);
    add(`${k}.uniwt`, `Osc ${K} Uni WT Pos`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, g);
    add(`${k}.stack`, `Osc ${K} Uni Stack`, 'enum', 0, 8, 0, 'enum:UNI_STACKS', 'V', 0, g);
  }
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
  // ---- FX segment (fx idx = idx − 148)
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

export const ND = DESTS.length;   // 248
export const NS = 148;
export const NF = ND - NS;       // 100
const DEST_MAP = new Map(DESTS.map((d, i) => [d.id, i]));
export const DEST_INDEX = deepFreeze(DESTS.reduce((o, d, i) => { o[d.id] = i; return o; }, {}));
const constName = id => id.replace(/^fx\./, '').toUpperCase().replace(/\./g, '_');
export const DIDX = deepFreeze(DESTS.slice(0, NS).reduce((o, d, i) => { o[constName(d.id)] = i; return o; }, {}));
export const FIDX = deepFreeze(DESTS.slice(NS).reduce((o, d, k) => { o[constName(d.id)] = k; return o; }, {}));
export const MATRIX_ONLY = deepFreeze(['g.tune', 'g.amp', 'g.wheel', 'g.bend', 'g.bypass'].concat(Array.from({ length: 16 }, (_, b) => 'bus' + (b + 1))));

const LAW_IDX = new Uint8Array(ND), D_LO = new Float64Array(ND), D_HI = new Float64Array(ND);
DESTS.forEach((d, i) => { LAW_IDX[i] = LAW[d.law]; D_LO[i] = d.lo; D_HI[i] = d.hi; });
const STEPPED = new Uint8Array(ND);
DESTS.forEach((d, i) => { STEPPED[i] = d.law === 'int' || d.law === 'enum' || d.law === 'bool' ? 1 : 0; });
const I_MASTER = DEST_MAP.get('g.master'), I_BYPASS = DEST_MAP.get('g.bypass');
const NOTE_ON_DESTS = ['a.uni', 'b.uni', 'a.phase', 'b.phase', 'a.rand', 'b.rand', 'n.phase', 'n.rand'];
const FORCED = (() => {   // placeholders normalizeSerum always writes
  const f = { 'g.wheel': 0, 'g.bend': 0.5 };
  for (let b = 1; b <= 16; b++) f['bus' + b] = 0.5;
  return f;
})();

/* ================================================================ §8.1 module fields */

// MODULE_FIELDS[m] = { p: [DEST ids in s.p], paths: [[key, …], …] structured paths into the state }
export const MODULE_FIELDS = deepFreeze({
  oscA: { p: DESTS.filter(d => d.group === 'Osc A').map(d => d.id), paths: [['osc', 0], ['global', 'uniRange', 0], ['global', 'uniMode', 0]] },
  oscB: { p: DESTS.filter(d => d.group === 'Osc B').map(d => d.id), paths: [['osc', 1], ['global', 'uniRange', 1], ['global', 'uniMode', 1]] },
  noise: { p: DESTS.filter(d => d.group === 'Noise').map(d => d.id), paths: [['noise']] },
  sub: { p: DESTS.filter(d => d.group === 'Sub').map(d => d.id), paths: [['sub']] },
  filter: { p: DESTS.filter(d => d.group === 'Filter').map(d => d.id), paths: [['filter']] },
});
const MODULE_NAMES = Object.keys(MODULE_FIELDS);

/* ================================================================ §4.4 curves */

export function bend(t, k) {
  return Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k));
}

// pts = [[x, y, c(, mx, my)], …] (§2.3); an empty or missing graph evaluates to 0
export function evalPts(pts, x) {
  if (!pts || !pts.length) return 0;
  const last = pts.length - 1;
  if (x <= 0 || x < pts[0][0]) return pts[0][1];
  if (x >= 1) return pts[last][1];
  let lo = 0, hi = last;               // largest j with pts[j].x ≤ x (equal x: the later point wins)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= x) lo = mid; else hi = mid - 1;
  }
  if (lo === last) return pts[last][1];
  const p = pts[lo], q = pts[lo + 1], dx = q[0] - p[0];
  if (dx <= 1e-9) return q[1];
  return p[1] + (q[1] - p[1]) * bend((x - p[0]) / dx, CURVE_K * (p[2] || 0));
}

export function renderPts(pts, n) {
  n = fin(n) && n >= 1 ? Math.floor(n) : 1;
  const out = new Float32Array(n + 1);
  for (let j = 0; j <= n; j++) out[j] = evalPts(pts, j / n);
  return out;
}

/* ================================================================ §3.1 law evaluation */

function destIdx(idOrIdx) {
  if (typeof idOrIdx === 'number') return idOrIdx >= 0 && idOrIdx < ND && (idOrIdx | 0) === idOrIdx ? idOrIdx : -1;
  const i = DEST_MAP.get(idOrIdx);
  return i === undefined ? -1 : i;
}

function lawV(law, lo, hi, n) {
  switch (law) {
    case 0: return lo + (hi - lo) * n;
    case 1: return Math.round(lo + (hi - lo) * n);
    case 2: return Math.round(hi * n);
    case 3: return n >= 0.5 ? 1 : 0;
    case 4: return lo * Math.pow(hi / lo, n);
    case 5: return lo + (hi - lo) * n * n;
    case 6: return lo + (hi - lo) * n * n * n;
    case 7: { const n2 = n * n; return lo + (hi - lo) * n2 * n2; }
    case 8: { const n2 = n * n; return lo + (hi - lo) * n2 * n2 * n; }
    case 9: { const u = 1 - n; return Math.max(lo, hi * u * u * u); }
    case 10: return n >= 0.9825 ? 1e9 : Math.min(hi, 1 / (1 - n));
    case 11: return n >= 0.5 ? 2 * hi * (n - 0.5) : Math.max(lo, 100 * Math.log2(2 * n));
    default: return n;
  }
}

function lawN(law, lo, hi, v) {
  switch (law) {
    case 0: return (clamp(v, lo, hi) - lo) / (hi - lo);
    case 1: return (Math.round(clamp(v, lo, hi)) - lo) / (hi - lo);
    case 2: return Math.round(clamp(v, 0, hi)) / hi;
    case 3: return v ? 1 : 0;
    case 4: return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
    case 5: return Math.sqrt((clamp(v, lo, hi) - lo) / (hi - lo));
    case 6: return Math.cbrt((clamp(v, lo, hi) - lo) / (hi - lo));
    case 7: return Math.pow((clamp(v, lo, hi) - lo) / (hi - lo), 1 / 4);
    case 8: return Math.pow((clamp(v, lo, hi) - lo) / (hi - lo), 1 / 5);
    case 9: return 1 - Math.cbrt(clamp(v, lo, hi) / hi);
    case 10: return v >= 1e6 ? 1 : Math.min(0.9824, 1 - 1 / clamp(v, lo, hi));
    case 11: { const x = clamp(v, lo, hi); return x >= 0 ? 0.5 + x / (2 * hi) : Math.pow(2, x / 100) / 2; }
    default: return v;
  }
}

// Engine value of DEST (id or index) at normalised n (clamped to [0, 1]); unknown dest → n
export function lawValue(idOrIdx, n) {
  const i = destIdx(idOrIdx), x = clamp01(n);
  return i < 0 ? x : lawV(LAW_IDX[i], D_LO[i], D_HI[i], x);
}

// Normalised n of engine value v (clamped to the law's value range); unknown dest → v
export function lawNorm(idOrIdx, v) {
  const i = destIdx(idOrIdx);
  if (i < 0) return v;
  if (typeof v === 'boolean') v = v ? 1 : 0;
  if (typeof v !== 'number' || v !== v) return DESTS[i].def;
  return clamp01(lawN(LAW_IDX[i], D_LO[i], D_HI[i], v)) + 0;
}

// Snap n to the grid of a stepped law (k/(hi − lo) exactly); continuous laws unchanged
function snapN(i, n) {
  if (!STEPPED[i]) return n;
  const m = D_HI[i] - D_LO[i];
  return Math.round(n * m) / m;
}

/* ================================================================ §3.2 display formats */

const ENUM_LISTS = { UNI_STACKS, WARPS, SUB_SHAPES, FILTERS, DIST_MODES, DIST_FILTER, DLY_MODES, EQ_TYPES_L, EQ_TYPES_H };
// Display precision (§3.2) is chosen from the value as printed, and thresholds allow 1e-9 relative, so a value
// typed exactly at a boundary (100 Hz, 1 s; stored through its law as 99.99999999999997) or rounding up to it
// (999.97 Hz) prints in the next range ('100 Hz', '1.00 kHz'); signs come from the printed value as well
// ('0 ct', never '+0 ct'; '0.0 dB', never '-0.0 dB'). This keeps fmtParam ∘ parseParam ∘ fmtParam stable.
const up = x => x * (1 + 1e-9);
const below = (x, dp, lim) => up(x) < lim && +x.toFixed(dp) < lim;
const toF = (x, dp) => { const t = x.toFixed(dp); return +t === 0 ? (0).toFixed(dp) : t; };
const sgnF = (x, dp) => (+x.toFixed(dp) > 0 ? '+' : '');
function fmtHz(f) {
  if (below(f, 2, 10)) return f.toFixed(2) + ' Hz';
  if (below(f, 1, 100)) return f.toFixed(1) + ' Hz';
  if (below(f, 0, 1000)) return f.toFixed(0) + ' Hz';
  const k = f / 1000;
  return k.toFixed(below(k, 2, 10) ? 2 : 1) + ' kHz';
}
function fmtTime(s) {
  const ms = 1000 * s;
  if (below(ms, 2, 10)) return toF(ms, 2) + ' ms';
  if (below(ms, 1, 100)) return ms.toFixed(1) + ' ms';
  if (below(ms, 0, 1000)) return ms.toFixed(0) + ' ms';
  return s.toFixed(below(s, 2, 10) ? 2 : 1) + ' s';
}
const fmtDbv = v => sgnF(v, 1) + toF(v, 1) + ' dB';

// Base n of any DEST: synth ids (and g.master / g.bypass, which live in s.p) from s.p, FX ids from fx.p,
// else the destination default (§5.8: FX bases come from fx.p). Unknown id → 0.
export function destBase(s, fx, id) {
  const i = destIdx(id);
  if (i < 0) return 0;
  const src = i >= NS && i !== I_MASTER && i !== I_BYPASS ? fx : s;
  const v = isObj(src) && isObj(src.p) ? src.p[DESTS[i].id] : undefined;
  return fin(v) ? clamp01(v) + 0 : DESTS[i].def;
}
const ctxN = (ctx, id) => destBase(ctx && ctx.s, ctx && ctx.fx, id);
const lfoOf = (ctx, l) => (ctx && ctx.s && Array.isArray(ctx.s.lfo) && isObj(ctx.s.lfo[l]) ? ctx.s.lfo[l] : null);
const lfoSw = (ctx, l, k, d) => { const o = lfoOf(ctx, l); return o && o[k] !== undefined ? !!o[k] : !!d; };
const ctxBpm = ctx => (ctx && fin(ctx.bpm) && ctx.bpm > 0 ? ctx.bpm : 120);
export const eqGainDb = v => (v < 0.5 ? Math.max(-96, 40 * Math.log10(2 * v)) : 48 * (v - 0.5));

function fmtCore(i, n, ctx) {
  const d = DESTS[i], id = d.id, fmt = d.fmt, v = lawV(LAW_IDX[i], D_LO[i], D_HI[i], n);
  if (fmt.slice(0, 5) === 'enum:') {
    const list = ENUM_LISTS[fmt.slice(5)], e = list && list[v];
    if (e === undefined) return String(v);
    return typeof e === 'string' ? e : id === 'b.warpMode' ? e.nameB : e.name;
  }
  switch (fmt) {
    case 'pct': return Math.round(n * 100) + '%';
    case 'pct1': return Math.round(v * 100) + '%';
    case 'pan': { const k = Math.round(Math.abs(v) * 50); return k === 0 ? 'C' : (v < 0 ? 'L' : 'R') + k; }
    case 'fpan': { const k = Math.round(Math.abs(n - 0.5) * 200); return k === 0 ? 'C' : (n < 0.5 ? 'L' : 'R') + k; }
    case 'oct': return sgn(v) + (v + 0) + ' oct';
    case 'st': return sgn(v) + (v + 0) + ' st';
    case 'st2': return sgnF(v, 2) + toF(v, 2) + ' st';
    case 'ct': { const r = Math.round(v) + 0; return sgn(r) + r + ' ct'; }
    case 'crs': return Math.abs(v) < 0.005 ? '--' : sgnF(v, 2) + toF(v, 2) + ' st';
    case 'int': return String(v + 0);
    case 'det': return toF(v, 2);
    case 'phase': return n >= 0.9995 ? 'Mem' : Math.round(v) + '°';
    case 'deg': return Math.round(v) + '°';
    case 'frame': {
      const o = id.charAt(0) === 'b' ? 1 : 0;
      const F = ctx && ctx.frames && fin(ctx.frames[o]) && ctx.frames[o] >= 1 ? Math.round(ctx.frames[o]) : 256;
      const discrete = !!ctx && !!ctx.interp && (ctx.interp[o] === 0 || ctx.interp[o] === false);
      return String(discrete ? 1 + Math.min(F - 1, Math.floor(n * F)) : 1 + Math.round(n * (F - 1)));
    }
    case 'bip100': { const r = Math.round(v * 100) + 0; return sgn(r) + r + '%'; }
    case 'hz': return fmtHz(v);
    case 'time': return fmtTime(v);
    case 'ms': return fmtTime(v / 1000);
    case 'msFloor': return fmtTime(Math.max(0.1, v) / 1000);
    case 'cmpAtt': {
      const ri = DEST_MAP.get('fx.cmp.ratio');
      const rn = ctx && ctx.eff && fin(ctx.eff[ri]) ? ctx.eff[ri] : ctxN(ctx, 'fx.cmp.ratio');
      return rn >= 0.9825 ? (10 * n * n).toFixed(2) + ' ms' : fmtTime(Math.max(0.1, v) / 1000);
    }
    case 'db': return v <= 1e-6 ? '-inf dB' : toF(20 * Math.log10(v), 1) + ' dB';
    case 'dbv': return fmtDbv(v);
    case 'dbtrim': return n <= 0 ? '-inf dB' : toF(40 * Math.log10(2 * n), 1) + ' dB';
    case 'bool': return v ? 'On' : 'Off';
    case 'ratio': return v >= 1e6 ? 'Limit' : below(v, 1, 2) ? v.toFixed(1) + ':1' : Math.round(v) + ':1';
    case 'xoff': {        // §3.2 ±0.01 windows applied to the printed value, compared in exact hundredths
      const h = Math.round(+v.toFixed(2) * 100);        // printed 1.49 → 149 (no 1.5 − 1.49 > 0.01 float error)
      if (Math.abs(h - 400 / 3) <= 1) return 'TRIP';     // printed 1.33, 1.34 (1.32 is 0.0133 away)
      if (Math.abs(h - 150) <= 1) return 'DOT';          // printed 1.49 … 1.51
      if (Math.abs(h - 75) <= 1) return 'Dot 1/2';       // printed 0.74 … 0.76
      return 'x' + v.toFixed(2);
    }
    case 'q01': return v.toFixed(2);
    case 'q2': return v.toFixed(1);
    case 'lbh': return (n < 0.25 ? 'LP' : n <= 0.75 ? 'BP' : 'HP') + ' ' + Math.round(n * 100);
    case 'var': {
      const t = lawValue(id === 'f.var' ? 'f.type' : 'fx.fil.type', ctxN(ctx, id === 'f.var' ? 'f.type' : 'fx.fil.type'));
      return FILTERS[t] && FILTERS[t].family === 'eq' ? fmtDbv(eqGainDb(n)) : Math.round(n * 100) + '%';
    }
    case 'npitch': {
      const key = ctx && ctx.s && isObj(ctx.s.noise) && bit(ctx.s.noise.keytrack, 0);
      const r = Math.round(v) + 0;
      return key ? sgn(r) + r + ' st' : sgnF(v, 1) + toF(v, 1) + ' st';
    }
    case 'lfoRate': {
      const l = +id.charAt(1) - 1;
      if (!lfoSw(ctx, l, 'bpm', 1)) return fmtHz(v);
      const L = lfoLadder(lfoSw(ctx, l, 'dot', 0), lfoSw(ctx, l, 'trip', 0));
      return L[Math.round(n * (L.length - 1))].label;
    }
    case 'lfoTime': {
      const l = +id.charAt(1) - 1;
      return lfoSw(ctx, l, 'bpm', 1) ? (v * 2).toFixed(2) + ' beats' : fmtTime(v);
    }
    case 'chaosRate': {
      if (ctxN(ctx, id.slice(0, 2) + '.bpm') < 0.5) return fmtHz(v);
      const beats = ctxBpm(ctx) / 60 / v;
      const k = Math.round(Math.log2(128 / beats));
      return LFO_LADDER[k > 0 ? (k < 14 ? k : 14) : 0].label;
    }
    case 'modRate': {
      if (ctxN(ctx, id.replace(/\.rate$/, '.bpm')) < 0.5) return fmtHz(v);
      return MODFX_LADDER[Math.round(n * 30)].label;
    }
    case 'dlyTime': return ctxN(ctx, 'fx.dly.bpm') >= 0.5 ? DLY_LADDER[Math.round(n * 11)].label : fmtTime(v / 1000);
    case 'revT': {
      const rv = ctx && ctx.fx && isObj(ctx.fx.rev) && fin(ctx.fx.rev.type) ? ctx.fx.rev.type : 1;
      if (rv < 0.5) return Math.round(200 * n) + ' ms';
      return n >= 0.999 ? 'inf' : (0.8 + 11.2 * n).toFixed(1) + ' s';
    }
    default: return String(n);
  }
}

// Display text of DEST `id` at normalised n (§3.2). ctx = { s, fx, bpm, frames, interp, eff? } (all optional;
// eff = snapshot eff vector, used for the Limit look-ahead display). Never throws; unknown id → String(n).
export function fmtParam(id, n, ctx) {
  const i = destIdx(id);
  if (i < 0) return String(n);
  try {
    return fmtCore(i, clamp01(n), ctx || null);
  } catch (err) {
    return String(n);
  }
}

/* ================================================================ §8.1 typed entry (parseParam) */

// Canonical unit tokens accepted after a number (case-insensitive; '' = bare number)
const UNIT_ALIAS = {
  '': '', hz: 'hz', k: 'khz', khz: 'khz', ms: 'ms', msec: 'ms', s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  '%': '%', db: 'db', st: 'st', semi: 'st', semis: 'st', semitone: 'st', semitones: 'st', ct: 'ct', c: 'ct', cent: 'ct', cents: 'ct',
  oct: 'oct', octave: 'oct', octaves: 'oct', '°': 'deg', deg: 'deg', beat: 'beats', beats: 'beats', ':1': 'ratio',
};
// formats whose own display unit is '%' (elsewhere '%' means knob position, n·100)
const PCT_OWN = { pct: 1, pct1: 1, bip100: 1, var: 1, lbh: 1 };
const NUM_RE = /^([+-]?)\s*(inf(?:inity)?|∞|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/;
const NUM = '(\\d+(?:\\.\\d*)?|\\.\\d+)';
const LR_PRE = new RegExp('^([lr]) ?' + NUM + '$'), LR_POST = new RegExp('^' + NUM + ' ?([lr])$');
const LBH_RE = new RegExp('^(lp|bp|hp)? ?' + NUM + '? ?%?$');

// lower case, ASCII minus, decimal comma → point, single spaces
const prepText = text => String(text).trim().toLowerCase().replace(/[−‒–—]/g, '-')
  .replace(/,(?=\d)/g, '.').replace(/\s+/g, ' ');

// "<number> <unit>" → { x, u } (u canonical, '' = bare), else null; 'inf' parses as Infinity
function numUnit(t) {
  const m = NUM_RE.exec(t);
  if (!m || !own(UNIT_ALIAS, m[3])) return null;
  const u = UNIT_ALIAS[m[3]];
  const mag = /^[\d.]/.test(m[2]) ? parseFloat(m[2]) : Infinity;
  return { x: m[1] === '-' ? -mag : mag, u };
}

// Beat count of a division ('1/8', '1/4.', '1/8T', '1/4d', '2 bar', '4 bar T') or '<n> beats'; else null
function beatsOf(t) {
  const k = t.replace(/ /g, '');
  let m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)([.dt]?)$/.exec(k), b, suf;
  if (m) { b = 4 * m[1] / m[2]; suf = m[3]; } else if ((m = /^(\d+(?:\.\d+)?)bars?([.dt]?)$/.exec(k))) { b = 4 * m[1]; suf = m[2]; } else {
    const q = numUnit(t);
    return q && q.u === 'beats' && q.x >= 0 && isFinite(q.x) ? q.x : null;
  }
  if (suf === '.' || suf === 'd') b *= 1.5; else if (suf === 't') b *= 2 / 3;
  return isFinite(b) && b > 0 ? b : null;
}

// Index of a ladder entry by label (case and spaces ignored) or by an exactly equal beat value; −1 if none
const ladKey = s => s.toLowerCase().replace(/\s+/g, '').replace(/d$/, '.');
function ladderIdx(L, t) {
  const k = ladKey(t);
  for (let j = 0; j < L.length; j++) if (ladKey(L[j].label) === k) return j;
  const b = beatsOf(t);
  if (b !== null) for (let j = 0; j < L.length; j++) if (Math.abs(L[j].beats - b) <= 1e-9 * b) return j;
  return -1;
}

// seconds from '<n> ms|s', a beat division or '<n> beats' (at ctx.bpm, not re-synced); bare numbers in `bare`
function parseSec(t, ctx, bare) {
  const b = beatsOf(t);
  if (b !== null) return b * 60 / ctxBpm(ctx);
  const q = numUnit(t);
  if (!q) return null;
  const u = q.u || bare;
  return u === 's' ? q.x : u === 'ms' ? q.x / 1000 : null;
}
function parseHz(t) {
  const q = numUnit(t);
  if (!q) return null;
  const u = q.u || 'hz';
  return u === 'hz' ? q.x : u === 'khz' ? 1000 * q.x : null;
}
// rate in Hz, or a beat division converted at ctx.bpm (one cycle per division)
function parseRate(t, ctx) {
  const f = parseHz(t);
  if (f !== null) return f;
  const b = beatsOf(t);
  return b === null ? null : ctxBpm(ctx) / 60 / b;
}
// pitch in `unit` ('st' | 'oct' | 'ct'); other pitch units converted, bare numbers in `unit`
function parsePitch(t, unit) {
  const q = numUnit(t);
  if (!q) return null;
  const u = q.u || unit;
  const st = u === 'st' ? q.x : u === 'oct' ? 12 * q.x : u === 'ct' ? q.x / 100 : null;
  return st === null ? null : unit === 'st' ? st : unit === 'oct' ? st / 12 : 100 * st;
}
function parseDb(t) {
  const q = numUnit(t);
  return q && (q.u === '' || q.u === 'db') ? q.x : null;
}
// 'C' → 0; 'L12' / '12 L' → −12; 'R40' → 40; bare signed numbers as they are
function parseLR(t) {
  if (/^(c|center|centre|mid)$/.test(t)) return 0;
  let m = LR_PRE.exec(t);
  if (m) return m[1] === 'l' ? -m[2] : +m[2];
  if ((m = LR_POST.exec(t))) return m[2] === 'l' ? -m[1] : +m[1];
  const q = numUnit(t);
  return q && q.u === '' ? q.x : null;
}
function parseEnum(i, t) {
  const list = ENUM_LISTS[DESTS[i].fmt.slice(5)], hi = D_HI[i];
  if (!list) return null;
  const tight = s => String(s).toLowerCase().replace(/\s+/g, '');
  // only the labels an entry has (FILTERS / SUB_SHAPES have no nameB: never match the text 'undefined')
  const names = e => (typeof e === 'string' ? [e] : [e.name, e.nameB, e.id].filter(x => typeof x === 'string' && x !== ''));
  const k = tight(t), n = Math.min(list.length, hi + 1);
  for (let j = 0; j < n; j++) if (names(list[j]).some(x => tight(x) === k)) return j / hi;
  let hit = -1;                                    // unique prefix
  for (let j = 0; j < n; j++) {
    if (!names(list[j]).some(x => tight(x).indexOf(k) === 0)) continue;
    if (hit >= 0) return null;
    hit = j;
  }
  return hit >= 0 ? hit / hi : null;
}
// Display unit ('s' | 'ms') of a time control at its current base (from ctx, else its default): §8.1 reads bare
// numbers in display units, so '2' on a knob showing '1.00 s' is 2 s and on one showing '14.7 ms' is 2 ms.
const shownUnit = (i, ctx) => (/ s$/.test(fmtParam(DESTS[i].id, ctxN(ctx, DESTS[i].id), ctx)) ? 's' : 'ms');
const cmpLimit = ctx => {
  const ri = DEST_MAP.get('fx.cmp.ratio');
  return (ctx && ctx.eff && fin(ctx.eff[ri]) ? ctx.eff[ri] : ctxN(ctx, 'fx.cmp.ratio')) >= 0.9825;
};

function parseCore(i, t, ctx) {
  const d = DESTS[i], id = d.id, fmt = d.fmt, q = numUnit(t);
  const norm = v => (v === null || v !== v ? null : lawNorm(i, v));
  if (fmt.slice(0, 5) === 'enum:') return parseEnum(i, t);
  if (q && q.u === '%' && !PCT_OWN[fmt]) return q.x / 100;          // knob position
  const bare = q && q.u === '' ? q.x : null;
  switch (fmt) {
    case 'pct': return q && (q.u === '' || q.u === '%') ? q.x / 100 : null;
    case 'pct1': case 'bip100': return q && (q.u === '' || q.u === '%') ? norm(q.x / 100) : null;
    case 'pan': { const x = parseLR(t); return x === null ? null : norm(x / 50); }
    case 'fpan': { const x = parseLR(t); return x === null ? null : 0.5 + x / 200; }
    case 'oct': return norm(parsePitch(t, 'oct'));
    case 'st': case 'st2': case 'npitch': return norm(parsePitch(t, 'st'));
    case 'crs': return /^-+$/.test(t) ? norm(0) : norm(parsePitch(t, 'st'));
    case 'ct': return norm(parsePitch(t, 'ct'));
    case 'int': case 'det': case 'q01': case 'q2': return norm(bare);
    case 'phase': case 'deg': {
      if (fmt === 'phase' && /^mem/.test(t)) return 1;
      const x = q && (q.u === '' || q.u === 'deg') ? norm(q.x) : null;
      return fmt === 'phase' && x !== null ? Math.min(x, 0.9994) : x;     // degrees never select Mem
    }
    case 'frame': {
      if (bare === null) return null;
      const o = id.charAt(0) === 'b' ? 1 : 0;
      const F = ctx && ctx.frames && fin(ctx.frames[o]) && ctx.frames[o] >= 1 ? Math.round(ctx.frames[o]) : 256;
      return F > 1 ? (clamp(Math.round(bare), 1, F) - 1) / (F - 1) : 0;
    }
    case 'hz': return norm(parseHz(t));
    case 'time': return norm(parseSec(t, ctx, shownUnit(i, ctx)));
    case 'ms': case 'msFloor': { const s = parseSec(t, ctx, shownUnit(i, ctx)); return s === null ? null : norm(1000 * s); }
    case 'cmpAtt': {
      const s = parseSec(t, ctx, shownUnit(i, ctx));
      if (s === null) return null;
      return cmpLimit(ctx) ? Math.sqrt(clamp(1000 * s, 0, 10) / 10) : norm(1000 * s);   // Limit: look-ahead 0–10 ms
    }
    case 'db': {          // '-inf' (≤ −120 dB) → the knob end with the smallest amplitude (threshold: n = 1)
      const x = parseDb(t);
      if (x === null) return null;
      return x <= -120 ? (lawValue(i, 1) < lawValue(i, 0) ? 1 : 0) : norm(Math.pow(10, x / 20));
    }
    case 'dbv': return norm(parseDb(t));
    case 'dbtrim': { const x = parseDb(t); return x === null ? null : Math.pow(10, x / 40) / 2; }
    case 'bool':
      if (/^(on|true|yes|1)$/.test(t)) return 1;
      return /^(off|false|no|0)$/.test(t) ? 0 : null;
    case 'ratio':
      if (/^(limit|lim)$/.test(t)) return 1;
      return q && (q.u === '' || q.u === 'ratio') ? norm(q.x) : null;
    case 'xoff': {
      const k = t.replace(/ /g, '');
      if (k === 'trip') return norm(4 / 3);
      if (k === 'dot') return norm(1.5);
      if (k === 'dot1/2') return norm(0.75);
      const m = /^x?(\d+(?:\.\d*)?|\.\d+)x?$/.exec(k);
      return m ? norm(+m[1]) : null;
    }
    case 'lbh': {          // 'LP 0' … 'HP 100'; the band word keeps n inside its band
      const m = LBH_RE.exec(t);
      if (!m || (!m[1] && m[2] === undefined)) return null;
      const x = m[2] !== undefined ? m[2] / 100 : m[1] === 'lp' ? 0 : m[1] === 'bp' ? 0.5 : 1;
      return m[1] === 'lp' ? Math.min(x, 0.249999) : m[1] === 'bp' ? clamp(x, 0.25, 0.75) : m[1] === 'hp' ? Math.max(x, 0.750001) : x;
    }
    case 'var': {          // percent, or dB of the EQ gain law for eq-family filter types (§6.11)
      if (q && q.u === '%') return q.x / 100;
      const ty = id === 'f.var' ? 'f.type' : 'fx.fil.type', f = FILTERS[lawValue(ty, ctxN(ctx, ty))];
      if (f && f.family === 'eq') {
        const x = parseDb(t);
        return x === null ? null : x >= 0 ? 0.5 + x / 48 : x <= -96 ? 0 : Math.pow(10, x / 40) / 2;
      }
      return bare === null ? null : bare / 100;
    }
    case 'lfoRate': {
      const l = +id.charAt(1) - 1;
      if (!lfoSw(ctx, l, 'bpm', 1)) return norm(parseRate(t, ctx));
      const L = lfoLadder(lfoSw(ctx, l, 'dot', 0), lfoSw(ctx, l, 'trip', 0)), j = ladderIdx(L, t);
      return j < 0 ? null : j / (L.length - 1);
    }
    case 'lfoTime': {      // BPM on: value = beats / 2 (display), absolute times are made tempo-relative
      const l = +id.charAt(1) - 1;
      if (!lfoSw(ctx, l, 'bpm', 1)) return norm(parseSec(t, ctx, shownUnit(i, ctx)));
      const b = beatsOf(t);
      if (b !== null) return norm(b / 2);
      if (bare !== null) return norm(bare / 2);
      const s = parseSec(t, ctx, 'ms');
      return s === null ? null : norm(s * ctxBpm(ctx) / 120);
    }
    case 'chaosRate': {
      if (ctxN(ctx, id.slice(0, 2) + '.bpm') >= 0.5) {
        const j = ladderIdx(LFO_LADDER, t);
        if (j >= 0) return norm(ctxBpm(ctx) / 60 / LFO_LADDER[j].beats);
      }
      return norm(parseRate(t, ctx));
    }
    case 'modRate': {
      if (ctxN(ctx, id.replace(/\.rate$/, '.bpm')) < 0.5) return norm(parseRate(t, ctx));
      const j = ladderIdx(MODFX_LADDER, t);
      return j < 0 ? null : j / 30;
    }
    case 'dlyTime': {
      if (ctxN(ctx, 'fx.dly.bpm') >= 0.5) { const j = ladderIdx(DLY_LADDER, t); return j < 0 ? null : j / 11; }
      const s = parseSec(t, ctx, shownUnit(i, ctx));
      return s === null ? null : norm(1000 * s);
    }
    case 'revT': {         // Plate: pre-delay ms (n·200); Hall: decay s (0.8 + 11.2·n)
      const plate = ctx && ctx.fx && isObj(ctx.fx.rev) && fin(ctx.fx.rev.type) && ctx.fx.rev.type < 0.5;
      const s = parseSec(t, ctx, plate ? 'ms' : 's');
      if (s === null) return null;
      return plate ? 1000 * s / 200 : s === Infinity ? 1 : Math.min((s - 0.8) / 11.2, 0.9989);   // finite: never 'inf'
    }
    default: return null;
  }
}

// Typed entry (§8.1): accepts what fmtParam prints plus comma decimals, case-insensitive units, bare numbers in
// display units (time: the unit the control shows at its current base, s or ms), beat divisions for time dests,
// ladder labels for synced rates/times, enum labels (exact or unique prefix). Returns the clamped (stepped:
// grid-snapped) n, or null. Never throws.
export function parseParam(id, text, ctx) {
  const i = destIdx(id);
  if (i < 0 || (typeof text !== 'string' && typeof text !== 'number')) return null;
  const t = prepText(text);
  if (!t || t.length > 64) return null;
  let n;
  try {
    n = parseCore(i, t, ctx || null);
  } catch (err) {
    return null;
  }
  return typeof n === 'number' && n === n ? snapN(i, clamp01(n)) + 0 : null;
}

/* ================================================================ small DEST helpers (§8.1) */

export function isCenter(id) { const i = destIdx(id); return i >= 0 && DESTS[i].ctr === 1; }
export function varLabel(type) { const f = FILTERS[type]; return f ? f.varLabel : ''; }

// Label for menus/tooltips; filter Var follows the current type, reverb slots follow the reverb type
export function destLabel(id, s, fx) {
  const i = destIdx(id);
  if (i < 0) return String(id);
  const d = DESTS[i];
  if (d.id === 'f.var' || d.id === 'fx.fil.var') {
    const t = d.id === 'f.var' ? lawValue('f.type', ctxN({ s }, 'f.type')) : lawValue('fx.fil.type', ctxN({ fx }, 'fx.fil.type'));
    return varLabel(t) || d.label;
  }
  if (d.id.slice(0, 7) === 'fx.rev.') {
    const slot = REV_SLOTS.indexOf(d.id.slice(7));
    if (slot >= 0) {
      const t = fx && isObj(fx.rev) && fin(fx.rev.type) && fx.rev.type < 0.5 ? 0 : 1;
      return REV_LABELS[t][slot];
    }
  }
  return d.label;
}

// Matrix "12st" typing (§8.1): amount for `st` semitones on a semitone-linear destination, else null
const SEMI_UNITS = { 'a.semi': 1, 'b.semi': 1, 'a.crs': 1, 'b.crs': 1, 'g.tune': 1, 'g.bendup': 1, 'g.benddn': 1,
  'a.oct': 12, 'b.oct': 12, 's.oct': 12, 'a.fine': 0.01, 'b.fine': 0.01 };
export function semitoneAmount(dst, st, bi) {
  if (!own(SEMI_UNITS, dst) || !fin(st)) return null;
  const i = DEST_MAP.get(dst);
  return clamp((st / SEMI_UNITS[dst]) / (D_HI[i] - D_LO[i]) * (bi ? 2 : 1), -1, 1);
}

// MIDI learn value (§8.1): macros and continuous dests cc/127, stepped dests grid-exact; unknown → null
export function midiValue(id, cc) {
  const n = clamp01(cc / 127);
  if (/^macro[1-4]$/.test(id)) return n;
  const i = destIdx(id);
  if (i < 0) return null;
  return STEPPED[i] ? lawNorm(i, lawValue(i, n)) : n;
}

/* ================================================================ §2 state: defaults */

const memSetDefault = off => Array.from({ length: 16 }, (_, i) => Math.round(frac(off + 0.6180339887 * i) * 1e6) / 1e6 % 1);
export const MEMSET_DEFAULT_A = deepFreeze(memSetDefault(0.137));
export const MEMSET_DEFAULT_B = deepFreeze(memSetDefault(0.511));

const DIAG = [[0, 0, 0], [1, 1, 0]];
const LFO_PTS_DEFAULT = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
const clonePts = pts => pts.map(p => p.slice());
const emptyRow = () => ({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 });
const defLfo = () => ({ mode: 'off', bpm: 1, dot: 0, trip: 0, anchor: 1, pts: clonePts(LFO_PTS_DEFAULT), loop: -1, start: 0 });
const UI_PAGES = ['osc', 'fx', 'matrix', 'global'];
const LFO_MODES = ['trig', 'env', 'off'];

function defaultP() {
  const p = {};
  for (let i = 0; i < NS; i++) p[DESTS[i].id] = DESTS[i].def;
  p['g.master'] = DESTS[I_MASTER].def;
  p['g.bypass'] = DESTS[I_BYPASS].def;
  return p;
}

export function defaultSerum() {
  return {
    v: VERSION,
    author: '', notes: '',
    p: defaultP(),
    osc: [
      { wt: 'factory:Default', remap: clonePts(DIAG), memSet: MEMSET_DEFAULT_A.slice() },
      { wt: 'factory:Default', remap: clonePts(DIAG), memSet: MEMSET_DEFAULT_B.slice() },
    ],
    sub: { direct: 0 },
    noise: { src: 'noise:White', oneshot: 0, keytrack: 0, direct: 0 },
    filter: { keytrack: 0 },
    lfo: Array.from({ length: N_LFO }, defLfo),
    lfoGrid: { x: 8, y: 8 },
    velo: { pts: clonePts(DIAG), porta: 0 },
    note: { pts: clonePts(DIAG), porta: 0 },
    chaos: [{ mono: 0, sh: 0 }, { mono: 0, sh: 0 }],
    macros: Array.from({ length: N_MACRO }, (_, m) => ({ name: 'Macro ' + (m + 1), v: 0 })),
    matrix: Array.from({ length: N_MATRIX }, emptyRow),
    voicing: { mono: 0, legato: 0, poly: 8, always: 0, scaled: 0, oneNote: 1 },
    global: { os: 2, a4: 440, uniRange: [2, 2], uniMode: [0, 0] },
    midi: {},
    locks: { p: [], mod: [], misc: { poly: 0, os: 0, tuning: 0 } },
    ui: { page: 'osc', env: 0, mod: 'lfo1', envLock: 1, envZoom: 1, view3d: [0, 0], wtSel: [0, 0], filtView: 0 },
  };
}

/* ================================================================ §2 state: normalisation */

const busOf = x => (fin(x) ? clamp(Math.round(x), 0, N_BUS) : 0);
const RAW_PTS_MAX = 65536;   // hostile input bound: entries beyond this are not even inspected
// Table ids (§7.6) with the prefixes valid for the slot: oscillators play factory:/user: tables,
// the noise oscillator noise:/nzuser: sources. Anything else → the default id.
const tableId = (x, prefixes, d) => (typeof x === 'string' && x.length <= 256
  && prefixes.some(p => x.length > p.length && x.slice(0, p.length) === p) ? x : d);
const OSC_PREFIXES = ['factory:', 'user:'], NOISE_PREFIXES = ['noise:', 'nzuser:'];

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

function normN(i, x) {
  return fin(x) ? snapN(i, clamp(x, 0, 1)) + 0 : DESTS[i].def;
}

function normRow(r) {
  if (!isObj(r)) return emptyRow();
  const src = r.src === undefined ? '' : r.src, dst = r.dst === undefined ? '' : r.dst, aux = r.aux === undefined ? '' : r.aux;
  if (typeof src !== 'string' || typeof dst !== 'string' || typeof aux !== 'string') return emptyRow();
  if ((src && !SRC_MAP.has(src)) || (aux && !SRC_MAP.has(aux)) || (dst && !DEST_MAP.has(dst))) return emptyRow();
  return { src, amt: num(r.amt, 0, -1, 1), dst, bi: bit(r.bi, 0), curve: num(r.curve, 0, -1, 1), aux, inv: bit(r.inv, 0), byp: bit(r.byp, 0), out: num(r.out, 1, 0, 1) };
}

function normOs(x) {
  if (!fin(x)) return 2;
  return x < Math.SQRT2 ? 1 : x < 2 * Math.SQRT2 ? 2 : 4;
}

const isWarpFromOther = n => { const m = Math.round(22 * n); return m >= 18 && m <= 20; };

// Returns a new valid state (§2, §8.1): tolerant of any JSON value; idempotent.
export function normalizeSerum(s) {
  const S = objOf(s), d = defaultSerum();
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
  const lfo = Array.from({ length: N_LFO }, (_, l) => {
    const L = objOf(arrOf(S.lfo)[l]), pts = normPts(L.pts, LFO_PTS_DEFAULT, true), last = pts.length - 1;
    return {
      mode: LFO_MODES.indexOf(L.mode) >= 0 ? L.mode : 'off',
      bpm: bit(L.bpm, 1), dot: bit(L.dot, 0), trip: bit(L.trip, 0), anchor: bit(L.anchor, 1),
      pts,
      loop: fin(L.loop) && L.loop >= 0 ? clamp(Math.round(L.loop), 0, last) : -1,
      start: intIn(L.start, 0, 0, last),
    };
  });
  const grid = objOf(S.lfoGrid), velo = objOf(S.velo), note = objOf(S.note);
  const chaos = [0, 1].map(c => { const C = objOf(arrOf(S.chaos)[c]); return { mono: bit(C.mono, 0), sh: bit(C.sh, 0) }; });
  const macros = Array.from({ length: N_MACRO }, (_, m) => {
    const M = objOf(arrOf(S.macros)[m]);
    return { name: strIn(M.name, 'Macro ' + (m + 1), 24), v: num(M.v, 0, 0, 1) };
  });
  const mx = arrOf(S.matrix), matrix = Array.from({ length: N_MATRIX }, (_, r) => normRow(mx[r]));
  const vo = objOf(S.voicing), gl = objOf(S.global);
  const ur = arrOf(gl.uniRange), um = arrOf(gl.uniMode);
  // ---- MIDI map: cc '0'…'119' → DEST id | macro1…4
  const M = objOf(S.midi), midi = {};
  for (const k of Object.keys(M)) {
    if (!/^(0|[1-9]\d{0,2})$/.test(k) || +k > 119) continue;
    const t = M[k];
    if (typeof t === 'string' && (DEST_MAP.has(t) || /^macro[1-4]$/.test(t))) midi[k] = t;
  }
  // ---- locks, ui
  const lk = objOf(S.locks), misc = objOf(lk.misc), lp = [];
  for (const id of arrOf(lk.p)) if (typeof id === 'string' && DEST_MAP.has(id) && lp.indexOf(id) < 0) lp.push(id);
  const lmod = arrOf(lk.mod), U = objOf(S.ui), v3 = arrOf(U.view3d), ws = arrOf(U.wtSel);
  return {
    v: VERSION,
    author: strIn(S.author, '', 64), notes: strIn(S.notes, '', 2000),
    p,
    osc,
    sub: { direct: bit(sub.direct, 0) },
    noise: { src: tableId(noise.src, NOISE_PREFIXES, 'noise:White'), oneshot: bit(noise.oneshot, 0), keytrack: bit(noise.keytrack, 0), direct: bit(noise.direct, 0) },
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
    locks: { p: lp, mod: MODULE_NAMES.filter(m => lmod.indexOf(m) >= 0), misc: { poly: bit(misc.poly, 0), os: bit(misc.os, 0), tuning: bit(misc.tuning, 0) } },
    ui: {
      page: UI_PAGES.indexOf(U.page) >= 0 ? U.page : 'osc',
      env: intIn(U.env, 0, 0, N_ENV - 1),
      mod: typeof U.mod === 'string' && U.mod && SRC_MAP.has(U.mod) ? U.mod : 'lfo1',
      envLock: bit(U.envLock, 1),
      envZoom: fin(U.envZoom) && U.envZoom > 0 ? clamp(U.envZoom, 0.001, 1000) : 1,
      view3d: [bit(v3[0], 0), bit(v3[1], 0)],
      wtSel: [intIn(ws[0], 0, 0, MAX_FRAMES - 1), intIn(ws[1], 0, 0, MAX_FRAMES - 1)],
      filtView: intIn(U.filtView, 0, 0, 2),
    },
  };
}

/* ================================================================ §2.5 FX state */

const MOD_IDS = FX_ORDER_DEFAULT;
const UI_LVL_KEYS = ['hyper', 'dim', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'fil'];
const FX_P_IDX = [];   // dest indices stored in fx.p (fx idx 1–85, 87–99)
for (let i = NS; i < ND; i++) if (i !== I_MASTER && i !== I_BYPASS) FX_P_IDX.push(i);
const FX_ENABLE = MOD_IDS.map(m => DEST_MAP.get('fx.' + m + '.on') - NS);   // fx idx of each module's enable
const MOD_INDEX = MOD_IDS.reduce((o, m, i) => { o[m] = i; return o; }, {});

export function defaultFx() {
  const p = {};
  for (const i of FX_P_IDX) p[DESTS[i].id] = DESTS[i].def;
  const byp = {}, lvl = {};
  for (const m of MOD_IDS) byp[m] = 0;
  for (const k of UI_LVL_KEYS) lvl[k] = 0;
  return {
    v: VERSION,
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

export function normalizeFx(fx) {
  const F = objOf(fx), order = [];
  for (const m of arrOf(F.order)) if (typeof m === 'string' && own(MOD_INDEX, m) && order.indexOf(m) < 0) order.push(m);
  for (const m of MOD_IDS) if (order.indexOf(m) < 0) order.push(m);
  const B = objOf(F.byp), byp = {};
  for (const m of MOD_IDS) byp[m] = bit(B[m], 0);
  const P = objOf(F.p), p = {};
  for (const i of FX_P_IDX) p[DESTS[i].id] = normN(i, P[DESTS[i].id]);
  const dist = objOf(F.dist), ph = arrOf(F.phase), U = objOf(F.ui), L = objOf(U.lvl), lvl = {};
  for (const k of UI_LVL_KEYS) lvl[k] = bit(L[k], 0);
  return {
    v: VERSION,
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

/* ================================================================ §4 compilers */

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
const CT_CACHE = new Map(), FXT_CACHE = new Map();

// CT content key (§4.1), or null when a graph is malformed
function ctKeyOf(s) {
  let h = FNV0;
  hashBad = false;
  for (let l = 0; l < N_LFO; l++) {
    const L = s.lfo[l], n = Array.isArray(L.pts) ? L.pts.length : 0;
    h = fnvPts(h, L.pts);
    // start / loop must index a point (loop may be −1); otherwise the CT would not match its key
    if (!Number.isInteger(L.start) || L.start < 0 || L.start >= n || !Number.isInteger(L.loop) || L.loop < -1 || L.loop >= n) hashBad = true;
    h = fnv(h, L.start);
    h = fnv(h, L.loop);
  }
  h = fnvPts(h, s.osc[0].remap);
  h = fnvPts(h, s.osc[1].remap);
  h = fnvPts(h, s.velo.pts);
  h = fnvPts(h, s.note.pts);
  return hashBad ? null : hex(h);
}

function buildCT(s, key) {
  const lfoTab = new Float32Array(N_LFO * (LFO_N + 1)), lfoPtsOff = new Uint16Array(N_LFO + 1);
  let tot = 0;
  for (let l = 0; l < N_LFO; l++) { lfoPtsOff[l] = tot; tot += s.lfo[l].pts.length; }
  lfoPtsOff[N_LFO] = tot;
  const lfoPts = new Float64Array(3 * tot), lfoPm = new Uint8Array(2 * tot), lfoPmAny = new Uint8Array(N_LFO);
  const lfoStart = new Float64Array(N_LFO), lfoLoop = new Float64Array(N_LFO);
  for (let l = 0; l < N_LFO; l++) {
    const L = s.lfo[l], pts = L.pts, o = lfoPtsOff[l];
    for (let j = 0; j <= LFO_N; j++) lfoTab[l * (LFO_N + 1) + j] = evalPts(pts, j / LFO_N);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], mx = p[3] || 0, my = p[4] || 0;
      lfoPts[3 * (o + i)] = p[0]; lfoPts[3 * (o + i) + 1] = p[1]; lfoPts[3 * (o + i) + 2] = p[2] || 0;
      lfoPm[2 * (o + i)] = mx; lfoPm[2 * (o + i) + 1] = my;
      if (mx || my) lfoPmAny[l] = 1;
    }
    const st = pts[L.start] || pts[0];
    lfoStart[l] = st[0];
    lfoLoop[l] = L.loop >= 0 && pts[L.loop] ? pts[L.loop][0] : -1;
  }
  const remap = new Float32Array(2 * (REMAP_N + 1));
  for (let o = 0; o < 2; o++) for (let j = 0; j <= REMAP_N; j++) remap[o * (REMAP_N + 1) + j] = evalPts(s.osc[o].remap, j / REMAP_N);
  return {
    key, lfoTab, lfoPtsOff, lfoPts, lfoPm, lfoPmAny, lfoStart, lfoLoop, remap,
    veloTab: renderPts(s.velo.pts, CURVE_N), noteTab: renderPts(s.note.pts, CURVE_N),
  };
}

// Compiler ctx scalars (§4.1, §4.2, §9.7): tempo 20–999 BPM (missing / non-positive → 120), smoothing scale
// 0.01–8 (missing → 1). A zero or negative value would make ladder times or smoothing coefficients diverge.
const ctxTempo = c => (fin(c.bpm) && c.bpm > 0 ? clamp(c.bpm, 20, 999) : 120);
const ctxSmooth = c => (fin(c.smooth) ? clamp(c.smooth, 0.01, 8) : 1);

const CTX_OF_SCOPE = { V: 1, 'V*': 1, 'V*M': 3, G: 2, M: 4 };
const ON_DEST = new Uint8Array(ND);
for (const id of NOTE_ON_DESTS) ON_DEST[DEST_MAP.get(id)] = 1;

const rowActive = r => !!r && !!r.src && !!r.dst && !r.byp && r.amt !== 0 && r.out !== 0 && fin(r.amt) && fin(r.out);

// Uint8Array(ND): 1 for every destination targeted by an active matrix row
function targetsOf(s) {
  const t = new Uint8Array(ND), mx = arrOf(s.matrix);
  for (let r = 0; r < mx.length && r < N_MATRIX; r++) {
    const row = mx[r];
    if (!rowActive(row) || !SRC_MAP.get(row.src) || (row.aux && !SRC_MAP.has(row.aux))) continue;
    const di = DEST_MAP.get(row.dst);
    if (di !== undefined) t[di] = 1;
  }
  return t;
}

// 1 at fx idx k when an active row of `s` targets FX destination k (compileFx ctx.modded)
export function fxModded(s) {
  const t = targetsOf(objOf(s)), out = new Uint8Array(NF);
  for (let k = 0; k < NF; k++) out[k] = t[NS + k];
  return out;
}

// Cheap structural check of a state before compiling (the host normalizes on entry, §4.1; anything that
// fails here, or throws while compiling, is compiled from normalizeSerum(s) instead)
const isArr = (x, n) => Array.isArray(x) && x.length === n;
function serumShapeOk(s) {
  if (!isObj(s) || s.v !== VERSION || !isObj(s.p) || !isArr(s.osc, 2) || !isArr(s.lfo, N_LFO) || !isArr(s.matrix, N_MATRIX)
    || !isArr(s.macros, N_MACRO) || !isArr(s.chaos, 2) || !isObj(s.voicing) || !isObj(s.global) || !isObj(s.sub)
    || !isObj(s.noise) || !isObj(s.filter) || !isObj(s.velo) || !isObj(s.note)) return false;
  for (let o = 0; o < 2; o++) {
    const O = s.osc[o];
    if (!isObj(O) || tableId(O.wt, OSC_PREFIXES, null) === null || !isArr(O.memSet, 16)) return false;
  }
  for (let l = 0; l < N_LFO; l++) if (!isObj(s.lfo[l])) return false;
  for (let m = 0; m < N_MACRO; m++) if (!isObj(s.macros[m])) return false;
  return isObj(s.chaos[0]) && isObj(s.chaos[1]) && isArr(s.global.uniRange, 2) && isArr(s.global.uniMode, 2)
    && tableId(s.noise.src, NOISE_PREFIXES, null) !== null;
}

// §4.1: normalized state → engine patch { engine: 'serum', …, needs, serum: CP, serumT: CT }.
// Never throws: a state that is not normalized is repaired (normalizeSerum) before compiling.
export function compileSerum(s, ctx) {
  if (serumShapeOk(s)) {
    try {
      const P = compileCore(s, ctx);
      if (P) return P;
    } catch (err) { /* malformed inner value: compile the repaired copy below */ }
  }
  return compileCore(normalizeSerum(s), ctx);
}

function compileCore(s, ctx) {
  const key = ctKeyOf(s);
  if (key === null) return null;
  const c = isObj(ctx) ? ctx : {}, P = s.p, vo = s.voicing, gl = s.global;
  const base = new Float64Array(NS);
  for (let i = 0; i < NS; i++) { const v = P[DESTS[i].id]; base[i] = fin(v) ? clamp01(v) : DESTS[i].def; }
  const mSrc = new Int8Array(N_MATRIX), mDst = new Int16Array(N_MATRIX), mAmt = new Float64Array(N_MATRIX), mBi = new Uint8Array(N_MATRIX);
  const mK = new Float64Array(N_MATRIX), mAux = new Int8Array(N_MATRIX), mInv = new Uint8Array(N_MATRIX), mCtx = new Uint8Array(N_MATRIX);
  const mOn = new Uint8Array(N_MATRIX), srcUsed = new Uint8Array(NSRC), modded = new Uint8Array(NS), targeted = new Uint8Array(ND);
  let mN = 0;
  for (let r = 0; r < s.matrix.length && r < N_MATRIX; r++) {
    const row = s.matrix[r];
    if (!rowActive(row)) continue;
    const si = SRC_MAP.get(row.src), di = DEST_MAP.get(row.dst), ai = row.aux ? SRC_MAP.get(row.aux) : 0;
    if (!si || di === undefined || ai === undefined) continue;
    mSrc[mN] = si;
    mDst[mN] = di;
    mAmt[mN] = clamp(row.amt, -1, 1) * clamp(row.out, 0, 1);
    mBi[mN] = row.bi ? 1 : 0;
    mK[mN] = MC_K * (fin(row.curve) ? clamp(row.curve, -1, 1) : 0) + 0;
    mAux[mN] = ai;
    mInv[mN] = row.inv ? 1 : 0;
    mCtx[mN] = CTX_OF_SCOPE[DESTS[di].scope];
    mOn[mN] = ON_DEST[di];
    srcUsed[si] = 1;
    if (ai) srcUsed[ai] = 1;
    if (di < NS) modded[di] = 1;
    targeted[di] = 1;
    mN++;
  }
  const possOn = id => P[id] >= 0.5 || targeted[DEST_MAP.get(id)] === 1;
  const onA = possOn('a.on'), onB = possOn('b.on'), onS = possOn('s.on'), onN = possOn('n.on');
  const needs = [];
  const need = id => { if (id && needs.indexOf(id) < 0) needs.push(id); };
  if (onA) need(s.osc[0].wt);
  if (onB) need(s.osc[1].wt);
  if (onS) {
    if (targeted[DEST_MAP.get('s.shape')]) SUB_IDS.forEach(need);
    else need(SUB_IDS[lawValue('s.shape', P['s.shape'])]);
  }
  if (onN) need(s.noise.src);
  const lfoMode = new Uint8Array(N_LFO), lfoBpm = new Uint8Array(N_LFO), lfoAnchor = new Uint8Array(N_LFO);
  const lfoLad = new Float64Array(N_LFO * 43), lfoLadN = new Uint8Array(N_LFO);
  for (let l = 0; l < N_LFO; l++) {
    const L = s.lfo[l], lad = lfoLadder(L.dot, L.trip);
    lfoMode[l] = L.mode === 'trig' ? 0 : L.mode === 'env' ? 1 : 2;
    lfoBpm[l] = L.bpm ? 1 : 0;
    lfoAnchor[l] = L.anchor ? 1 : 0;
    lfoLadN[l] = lad.length;
    for (let j = 0; j < lad.length; j++) lfoLad[l * 43 + j] = lad[j].beats;
  }
  const memSet = new Float64Array(32);
  for (let o = 0; o < 2; o++) for (let i = 0; i < 16; i++) { const v = s.osc[o].memSet[i]; memSet[o * 16 + i] = fin(v) ? frac(v) : 0; }
  const macro = new Float64Array(N_MACRO);
  for (let m = 0; m < N_MACRO; m++) macro[m] = num(s.macros[m].v, 0, 0, 1);
  const serumT = lruGet(CT_CACHE, key, () => buildCT(s, key));
  const subDirect = s.sub.direct ? 1 : 0, noiseDirect = s.noise.direct ? 1 : 0, poly = intIn(vo.poly, 8, 1, 32);
  const CP = {
    ver: CP_VER, NS, NSRC,
    base,
    mN, mSrc, mDst, mAmt, mBi, mK, mAux, mInv, mCtx, mOn, srcUsed, modded,
    wt: [s.osc[0].wt, s.osc[1].wt],
    uniMode: Uint8Array.from(gl.uniMode, x => intIn(x, 0, 0, 4)),
    uniRange: Float64Array.from(gl.uniRange, x => num(x, 2, 0, 48)),
    memSet,
    subDirect, noiseOneshot: s.noise.oneshot ? 1 : 0, noiseKey: s.noise.keytrack ? 1 : 0, noiseDirect, filKey: s.filter.keytrack ? 1 : 0,
    noiseId: s.noise.src,
    direct: (subDirect && onS) || (noiseDirect && onN) ? 1 : 0,
    lfoMode, lfoBpm, lfoAnchor, lfoLad, lfoLadN,
    chaosMono: Uint8Array.from(s.chaos, ch => (ch.mono ? 1 : 0)),
    chaosSh: Uint8Array.from(s.chaos, ch => (ch.sh ? 1 : 0)),
    macro,
    mono: vo.mono ? 1 : 0, legato: vo.legato ? 1 : 0, poly, always: vo.always ? 1 : 0, scaled: vo.scaled ? 1 : 0, oneNote: vo.oneNote ? 1 : 0,
    // "follow portamento/legato" (§2.2, §3.12, §5.3, §6.1; not in the §4.1 table): NOTE reads the gliding pitch,
    // VELO is re-captured on legato notes
    veloPorta: s.velo.porta ? 1 : 0, notePorta: s.note.porta ? 1 : 0,
    os: normOs(gl.os), a4: fin(gl.a4) ? clamp(gl.a4, 430, 450) : 440,
    smooth: ctxSmooth(c),
    ctKey: key,
  };
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
  };
}

// X-Shaper tables key (§4.2), or null when a curve is malformed
function xsKeyOf(fx) {
  hashBad = false;
  const h = fnvPts(fnvPts(FNV0, fx.dist.xa), fx.dist.xb);
  return hashBad ? null : hex(h);
}

// Cheap structural check of an FX state (anything failing it is compiled from normalizeFx(fx))
function fxShapeOk(fx) {
  if (!isObj(fx) || fx.v !== VERSION || !isObj(fx.p) || !isObj(fx.byp) || !isArr(fx.order, 10) || !isObj(fx.dist)
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
export function compileFxT(fx) {
  const F = fxValid(fx) ? fx : normalizeFx(fx), key = xsKeyOf(F);
  return lruGet(FXT_CACHE, key, () => ({ key, xsA: renderPts(F.dist.xa, XS_N), xsB: renderPts(F.dist.xb, XS_N) }));
}

// §4.2: normalized FX state → FXP (patch.fxr). ctx = { bpm, master, bypass, modded, seed, smooth, silence }.
// Never throws: a state that is not normalized is repaired (normalizeFx) before compiling.
export function compileFx(fx, ctx) {
  if (fxShapeOk(fx)) {
    try {
      const P = compileFxCore(fx, ctx);
      if (P) return P;
    } catch (err) { /* malformed inner value: compile the repaired copy below */ }
  }
  return compileFxCore(normalizeFx(fx), ctx);
}

function compileFxCore(fx, ctx) {
  const xsKey = xsKeyOf(fx);
  if (xsKey === null) return null;
  const c = isObj(ctx) ? ctx : {}, P = fx.p;
  const base = new Float64Array(NF);
  for (let k = 0; k < NF; k++) { const d = DESTS[NS + k], v = P[d.id]; base[k] = fin(v) ? clamp01(v) : d.def; }
  base[0] = fin(c.master) ? clamp01(c.master) : 1;
  base[I_BYPASS - NS] = fin(c.bypass) ? (c.bypass >= 0.5 ? 1 : 0) : 0;
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
    ver: FXP_VER, NF,
    base, order, byp,
    revType: intIn(fx.rev.type, 1, 0, 1), choMono: fx.cho.mono ? 1 : 0,
    alloc,
    filTypeAll: modded && modded[FIDX.FIL_TYPE] ? 1 : 0,
    phase: Float64Array.from(fx.phase, x => (fin(x) ? frac(x) : 0)),
    seed: c.seed ? 1 : 0,
    any,
    bpm: ctxTempo(c),
    smooth: ctxSmooth(c),
    silence: bit(c.silence, 1),
    xsKey,
  };
}

/* ================================================================ §8.1 matrix helpers (mutate s in place) */

const isSrcId = x => typeof x === 'string' && x !== '' && SRC_MAP.has(x);
const rowsOf = s => (isObj(s) && Array.isArray(s.matrix) ? s.matrix : []);
const slotOk = (s, slot) => Number.isInteger(slot) && slot >= 0 && slot < Math.min(rowsOf(s).length, N_MATRIX);
const lfoOk = l => Number.isInteger(l) && l >= 0 && l < N_LFO;
const LFO_SRC_RE = /^lfo[1-8]$/;
const LFO_KNOBS = ['rate', 'rise', 'delay', 'smooth'];

// first slot whose source is empty (§5.8), −1 when the matrix is full
function freeSlot(s) {
  const M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (!isObj(M[r]) || M[r].src === '' || M[r].src === undefined) return r;
  return -1;
}

// Adds a modulation row src → dst with the drag-and-drop defaults of §5.8 (FX bases read from fx.p):
// bi = the destination's ctr flag; amount: bool dest base ≥ 0.5 ? −1 : +1; bipolar 0.5; unipolar
// limit (default on) ? max(0.05, min(0.5, 1 − base)) : 0.5. opts.amt / opts.bi override; opts.slot writes
// that slot (replacing its row), else the first slot with src ''. Returns the slot, or −1 (full / bad ids).
export function addMod(s, fx, src, dst, opts) {
  const o = objOf(opts), di = destIdx(dst);
  if (!isSrcId(src) || di < 0 || !isObj(s) || !Array.isArray(s.matrix)) return -1;
  const slot = o.slot === undefined || o.slot === null ? freeSlot(s) : slotOk(s, o.slot) ? o.slot : -1;
  if (slot < 0) return -1;
  const d = DESTS[di], base = destBase(s, fx, d.id);
  const bi = o.bi === undefined || o.bi === null ? d.ctr : bit(o.bi, 0);
  let amt;
  if (fin(o.amt)) amt = clamp(o.amt, -1, 1);
  else if (d.law === 'bool') amt = base >= 0.5 ? -1 : 1;
  else if (bi) amt = 0.5;
  else amt = o.limit === false || o.limit === 0 ? 0.5 : Math.max(0.05, Math.min(0.5, 1 - base));
  s.matrix[slot] = { src, amt, dst: d.id, bi, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
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
  if (slot >= 0) M[slot] = Object.assign({}, VELO_AMP);
  return slot;
}

// "Vibrato quick-assign" (inv A16.3): the first LFO no row uses becomes a 5.3 Hz Trig sine on Master Tune,
// scaled by the mod wheel (bipolar, amount 0.008 = ±0.51 st at full wheel). Returns the row's slot, or −1
// (no unused LFO or matrix full; nothing changed).
// one sine cycle starting at the centre (9 points, curvature fitted: |error| < 0.006)
const VIB_PTS = [[0, 0.5, 0.03287], [0.125, 0.85355, 0.20169], [0.25, 1, -0.20169], [0.375, 0.85355, -0.03287], [0.5, 0.5, 0.03287],
  [0.625, 0.14645, 0.20169], [0.75, 0, -0.20169], [0.875, 0.14645, -0.03287], [1, 0.5, 0]];
export function vibratoAssign(s) {
  if (!isObj(s) || !Array.isArray(s.lfo) || !isObj(s.p)) return -1;
  let l = 0;
  while (l < N_LFO && lfoUsed(s, l)) l++;
  const slot = freeSlot(s);
  if (l >= N_LFO || slot < 0) return -1;
  // a fresh LFO (switches, loop/start default; Delay, Rise and Smooth 0 so the vibrato starts at once), Trig,
  // BPM off; the buses the old points linked lose those links, their rows are pruned (inv A13)
  const cut = isObj(s.lfo[l]) ? ptsBuses(s.lfo[l].pts) : [];
  s.lfo[l] = Object.assign(defLfo(), { mode: 'trig', bpm: 0, pts: clonePts(VIB_PTS) });
  for (const k of LFO_KNOBS) s.p['l' + (l + 1) + '.' + k] = DESTS[DEST_MAP.get('l' + (l + 1) + '.' + k)].def;
  s.p['l' + (l + 1) + '.rate'] = 0.48;
  pruneBuses(s, cut);
  s.matrix[slot] = { src: 'lfo' + (l + 1), amt: 0.008, dst: 'g.tune', bi: 1, curve: 0, aux: 'wheel', inv: 0, byp: 0, out: 1 };
  return slot;
}

// any row (bypassed included) whose source or aux source is LFO l (0-based)
export function lfoUsed(s, l) {
  const id = 'lfo' + (l + 1), M = rowsOf(s);
  for (let r = 0; r < M.length && r < N_MATRIX; r++) if (isObj(M[r]) && (M[r].src === id || M[r].aux === id)) return true;
  return false;
}

/* ================================================================ §8.1 LFO and bus helpers (in place) */

// Main menu "Init All LFOs" (inv A2.1): every LFO and its four lN.* knobs back to default, rows reading an LFO
// (as source or aux) cleared, then the rows of the buses some point linked before the reset pruned (rows aimed
// at buses no point ever linked are kept, see pruneBuses). Returns the rows cleared.
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

// Alt-drag an LFO tile onto another (inv A13): mode, switches, points (with bus links), loop/start and the
// four lN.* base values of LFO `from` copied to LFO `to` (0-based); rows of buses that only the overwritten
// points of `to` linked are pruned (inv A13). Returns false for bad indices.
export function copyLfo(s, from, to) {
  if (!isObj(s) || !Array.isArray(s.lfo) || !lfoOk(from) || !lfoOk(to) || from === to || !isObj(s.lfo[from])) return false;
  const A = s.lfo[from], cut = isObj(s.lfo[to]) ? ptsBuses(s.lfo[to].pts) : [];
  s.lfo[to] = { mode: A.mode, bpm: A.bpm, dot: A.dot, trip: A.trip, anchor: A.anchor, pts: clone(A.pts), loop: A.loop, start: A.start };
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
    if (k && !links[k].length && (!only || only[k])) { M[r] = emptyRow(); n++; }
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
  const L = isObj(s) && Array.isArray(s.lfo) && lfoOk(lfo) ? s.lfo[lfo] : null, cut = [];
  if (isObj(L) && Array.isArray(L.pts)) {
    const list = idxs === undefined || idxs === null ? L.pts.map((_, i) => i) : typeof idxs === 'number' ? [idxs] : arrOf(idxs);
    for (const i of list) {
      const p = Number.isInteger(i) ? L.pts[i] : null;
      if (Array.isArray(p) && p.length > 3) { cut.push(...ptsBuses([p])); L.pts[i] = p.slice(0, 3); }
    }
  }
  return pruneBuses(s, cut);
}

// Warp menu choice (inv A5, in place): oscillator o (0 = A, 1 = B) gets mode 0–22; choosing FM/AM/RM from the
// other oscillator (18–20) turns those modes off on the other one (the most recent choice wins).
export function warpChoice(s, o, mode) {
  if (!isObj(s) || !isObj(s.p) || !fin(mode)) return;
  const m = clamp(Math.round(mode), 0, 22), me = o ? 'b.warpMode' : 'a.warpMode', other = o ? 'a.warpMode' : 'b.warpMode';
  s.p[me] = m / 22;
  if (m >= 18 && m <= 20 && fin(s.p[other]) && isWarpFromOther(s.p[other])) s.p[other] = 0;
}

/* ================================================================ §8.1 module copy, presets */

// deep copy of plain JSON data
function clone(x) {
  if (Array.isArray(x)) return x.map(clone);
  if (isObj(x)) { const o = {}; for (const k of Object.keys(x)) o[k] = clone(x[k]); return o; }
  return x;
}
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

// module m of `target` ← module `from` of `source` (same module, or OSC A ↔ OSC B: ids a.* ↔ b.*, paths by position)
function copyFields(target, source, m, from) {
  const F = MODULE_FIELDS[m], G = MODULE_FIELDS[from];
  if (!isObj(target.p)) target.p = {};
  if (isObj(source.p)) {
    for (const id of F.p) {
      const sid = m === from ? id : G.p[0].slice(0, 2) + id.slice(2);
      if (fin(source.p[sid])) target.p[id] = source.p[sid];
    }
  }
  F.paths.forEach((path, j) => { const v = getPath(source, G.paths[j]); if (v !== undefined) setPath(target, path, clone(v)); });
}

// In place: module m of `target` (MODULE_FIELDS[m]: s.p destinations and structured paths, deep copies) gets the
// values of module `from` (default m) of `source` — Copy/Paste/Init of a module (Init: source = defaultSerum()).
// `from` may differ from m only between the oscillators: copyModule(s, clip, 'oscB', 'oscA') pastes OSC A's
// settings onto OSC B (a.* → b.*, osc[0] → osc[1], uniRange/uniMode [0] → [1]). Like warpChoice, the written
// oscillator wins the warp single-direction rule (inv A5): if both warp modes end up in 18–20, the other
// oscillator's mode becomes Off. Returns false (nothing changed) for bad arguments.
export function copyModule(target, source, m, from) {
  const f = from === undefined || from === null ? m : from;
  if (!own(MODULE_FIELDS, m) || !own(MODULE_FIELDS, f) || !isObj(target) || !isObj(source)) return false;
  if (f !== m && !((m === 'oscA' && f === 'oscB') || (m === 'oscB' && f === 'oscA'))) return false;
  copyFields(target, source, m, f);
  if ((m === 'oscA' || m === 'oscB') && fin(target.p['a.warpMode']) && fin(target.p['b.warpMode'])
    && isWarpFromOther(target.p['a.warpMode']) && isWarpFromOther(target.p['b.warpMode'])) target.p[m === 'oscA' ? 'b.warpMode' : 'a.warpMode'] = 0;
  return true;
}

// Preset load (§8.1): a new state from preset {name, cat, v: {s}, fx} that shares no object with the preset or
// with cur, keeping cur's locked parameters (synth ids; FX ids go through applyPresetFx), locked modules,
// locks.misc fields (poly, os, A4), locks and ui; midi = the preset's map when non-empty, else cur's.
export function applyPreset(cur, preset) {
  const c = normalizeSerum(cur), r = normalizeSerum(objOf(objOf(preset).v).s);
  for (const id of c.locks.p) if (own(r.p, id)) r.p[id] = c.p[id];
  for (const m of c.locks.mod) copyFields(r, c, m, m);      // the warp rule is re-applied below (keeps A)
  if (c.locks.misc.poly) r.voicing.poly = c.voicing.poly;
  if (c.locks.misc.os) r.global.os = c.global.os;
  if (c.locks.misc.tuning) r.global.a4 = c.global.a4;
  r.locks = c.locks;
  r.ui = c.ui;
  if (!Object.keys(r.midi).length) r.midi = c.midi;
  if (isWarpFromOther(r.p['a.warpMode']) && isWarpFromOther(r.p['b.warpMode'])) r.p['b.warpMode'] = 0;   // keep A
  return r;
}

// FX side of a preset load (§8.1): Lock FX Rack keeps (a deep copy of) the current rack; otherwise the preset's
// rack (default when absent) with the locked FX ids' values, `ui` and `lock` taken from curFx.
export function applyPresetFx(curFx, presetFx, lockedIds) {
  const c = normalizeFx(curFx);
  if (c.lock) return c;
  const r = normalizeFx(presetFx === undefined || presetFx === null ? defaultFx() : presetFx);
  for (const id of arrOf(lockedIds)) if (typeof id === 'string' && own(r.p, id)) r.p[id] = c.p[id];
  r.ui = c.ui;
  r.lock = c.lock;
  return r;
}

/* ================================================================ factory presets (§8.1, M3) */

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
const MFX_N = lab => MODFX_LADDER.findIndex(e => e.label === lab) / (MODFX_LADDER.length - 1);
const dbA = db => Math.pow(10, db / 20);
const row = (src, dst, amt, o) => Object.assign(emptyRow(), { src, dst, amt }, o);
const st = (dst, semis, bi) => semitoneAmount(dst, semis, bi ? 1 : 0);
function recipe(name, cat, r) {
  const s = defaultSerum(), fx = defaultFx();
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
  return { name, cat, v: { s: normalizeSerum(s) }, fx: normalizeFx(fx) };
}
const ON = 1, OFF = 0;
const OTT = (o) => Object.assign({ 'fx.cmp.on': ON, 'fx.cmp.mb': ON, 'fx.cmp.thr': dbA(-24), 'fx.cmp.ratio': 6, 'fx.cmp.att': 2, 'fx.cmp.rel': 90,
  'fx.cmp.mbL': 1, 'fx.cmp.mbM': 1, 'fx.cmp.mbH': 1, 'fx.cmp.gain': dbA(9), 'fx.cmp.mix': 0.6 }, o);

const PTS_PLUCK = [[0, 1, 0], [0.02, 0, 0.4], [1, 0.97, 0]];                    // per-step pluck for rows into g.amp (amount −1)
const PTS_PUMP = [[0, 0, 0], [0.04, 1, 0], [0.62, 0, -0.25], [1, 0, 0]];         // sidechain-style duck once per cycle

export const FACTORY_PRESETS = deepFreeze([
  { name: 'Init', cat: 'Init', v: { s: defaultSerum() }, fx: defaultFx() },

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

/* ================================================================ factory effect chains (shared chain library format) */

// Rack presets for any track (FX tab of every model, Serum's FX page): the library form the rack and SerumUI read and
// write ({ type: 'synth.fxchains', v: 1, chains: [{ name, fx }] }, fx without ui / lock). Levels were checked on a
// plain saw, a Serum pad and drum hits: each chain keeps the peak within a few dB of the dry signal.
function chain(name, r) {
  const fx = defaultFx();
  for (const id of Object.keys(r.fx || {})) fx.p[id] = lawNorm(id, r.fx[id]);
  Object.assign(fx.p, r.fxn || {});
  if (r.order) fx.order = r.order.concat(fx.order.filter(m => !r.order.includes(m)));
  if (r.rev !== undefined) fx.rev.type = r.rev;
  if (r.mono !== undefined) fx.cho.mono = r.mono;
  const c = normalizeFx(fx);
  delete c.ui; delete c.lock;
  return { name, fx: c };
}
export const FACTORY_CHAINS = deepFreeze({ type: 'synth.fxchains', v: 1, chains: [
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
