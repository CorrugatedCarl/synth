/*
 * drum-core.js — the drum machines' pure main-side model (IMPL-7a §1.2–§1.4, §3, §4.1, §4.3; lane S). Leaf ES module: no
 * imports, no DOM / timers / storage; importable from the browser, node and Workers. The worklet side is dr-seq.js
 * (`DrSeq`), which embeds identical copies of the constants it needs (compared by tests/drum-core.test.mjs).
 *
 * Memory (`dev.drum`, §3.1 / §3.2 / §6), normalised by normDrum (idempotent, exact lengths, never throws):
 *   { v: 1, keys: [16 × { pre 1–4, l1 1–16, l2 0–16 }], st: [32 × [32 masks 0–0xFFF]] (pattern p = key · 2 + var),
 *     rt: [768 keys −1…15] (12 tracks × 64 measures, one store), rtEnd: [12] (absolute index ≥ the track's start, or −1),
 *     ui: { mode, inst, fill, bvar, ifv, pre, sel, ifk, edf, intro, tempo, fine }, x: { sync, swing, mute, solo, rec, part },
 *     map: { <sound>: [primary, …aliases] }, smp: { <sound>: { id, name, on } } }
 *   ui.edf (an addition to §3.2): which key the write modes edit — 0 the basic key `sel`, 1 the I/F key 12 + `ifk` (the last
 *   step key pressed decides, so the fill just written is the one MANUAL PLAY plays). ui.tempo is the TEMPO knob's click
 *   (0–39), ui.fine FINE's ± half a click; tempoBpm turns them into BPM (rounded to 0.01). x.swing is a whole percentage.
 *
 * press(state, drum, input) → { state, mem, cmds } (§3.3): the panel's state machine. `state` is the session (initState():
 * never saved), `drum` the device's whole record above (memory + ui + x); both are treated as immutable — a changed one comes
 * back as a new object (structural sharing), an unchanged one as the same reference. cmds, in order:
 *   { c: 'send', at: 'now' | 'bar' | 'beat2' }   post payload(mem, state, at) to the machine (the host dedupes by `pk`)
 *   { c: 'play' } / { c: 'stop' }                 the project's transport (SYNC on: START/STOP is the ▶)
 *   { c: 'bpm', v }                               the project tempo (SYNC on: TEMPO / FINE set it)
 *   { c: 'notice', text, undo: true }             the one-tap undo notice (its tap: press({ k: 'undo' }))
 * Inputs (`k`): start · step n (1–16) · clear (CLEAR released with no step key pressed while held) · clear+step n · tap f
 * (f: the fraction of the heard step elapsed at the tap, for the nearest step) · mode / inst / fill / bvar / ifv / pre /
 * tempo / fine v · extras: sync v · swing v · mute lane · solo lane · rec v · part v · grid lane s (s 0–31) · pad sound f
 * (REC) · map sound notes · mapReset · smp sound slot · undo · demo · host notifications: transport play · heard post (a
 * {t:'step'} at its heard time) · bpm v (the project tempo) · panic.
 * leds(state, drum) → the step / part / variation LEDs (§3.3 LEDs); gridPat(state, drum) → the pattern the grid shows.
 *
 * compilePlan(mem, ui, x) → plan (§3.4), pure and memoised (one entry, by the arrays' identity and the fields read):
 *   { key, shape, n, intro, loopFrom, mKey Int8Array(n), mVar Int8Array(n), mPre Uint8Array(n), mL1 Uint8Array(n),
 *     mOff Int32Array(n + 1) (step offsets), mT Int32Array(n + 1) (tick offsets from the plan's start), st Uint16Array,
 *     fill: { k, v, pre, l1, l2, st Uint16Array } | null }
 *   mL1 and mT are additions to §3.4 (the post's part; the clock's measure ticks, checked by DrSeq without allocating);
 *   key / shape: 8-hex FNV-1a (seq-core's) over the arrays — shape over the timing only (n, intro, loopFrom, mPre, mL1,
 *   mOff): DrSeq replaces an `at: 'now'` plan in place only when the shape is equal.
 * payload(drum, state, at) → the {t:'seq'} payload of §3.5 (+ prim, the 16 primaries for a step's lastNote, and pk, the
 *   content key the host compares); toNotes(plan, opts) → roll notes (§4.3); planTicks(plan); vTrig(v127, acc) (§1.3).
 *
 * 7b (IMPL-7b §3, §4; lane S6): a second personality, the TR-606, dispatched on the record's `m` ('tr606'; absent = the 808,
 * whose record, session, payload, plan, pk and notes stay byte-identical to 7a's): normDrum(d, model) (the machine: model ??
 * d.m — absent, unknown or hostile: the 808), compilePlan(mem, ui, x, S) (the 606's plan reads the session: the bar pointer,
 * TRACK WRITE's heard key, the D.S.), payload (+ m, rst; bpm = ui.tempo), press, leds, gridPat, stepLen, demoFree,
 * initState(model); mapTable / primaries / drumRows(map, model) (the 606's: its seven sounds only). Its record:
 *   { v: 1, m: 'tr606', keys: [32 × { sc 1–4, l1 1–16 }], st: [32 × [16 masks & 0xE2F]] (pattern p = group · 16 + key),
 *     rt: [704 keys −1…15] (tracks 1–7 × 64 bars, track 8 × 256: regions at 0, 64, … 384, 448), tg: [8 × 0 | 1] (a track's
 *     group), dc / sg: [8 × bar | −1] (D.C. / segno, absolute, inside the track's reach), ui: { mode 0 TRACK WRITE · 1 TRACK
 *     PLAY · 2 PATTERN PLAY · 3 PATTERN WRITE, inst 0–7, grp, sel 0–15, cl 0–3 (the chain sel … sel + cl in sel's block of
 *     four), sc 1–4 (the SCALE switch), tempo (BPM, 0.01) }, x: { sync, swing, mute, solo, rec }, map, smp }
 *   Its inputs, held states as down / up: key n down (shift: a chain with the selection) · fn down · clr down · tap f · start ·
 *   grp · mode / inst / sc / tempo (BPM) v · release (every hold let go, nothing done) · link303 → { c: 'link303', s } (the
 *   TB-303s' swing, swing303) · the 808's extras and host notifications — of which 'heard' (CLEAR's wipe) and 'transport' (the
 *   D.S. and TRACK WRITE's heard key end) may send. leds → { step[16] 0–4, run, grp: [I, II] } (the 808's codes).
 */

/* ================================================================ constants (PERS.tr808; = dr-seq.js where marked) */

export const PPQ = 960, BEAT = 960;                                   // (= DrSeq) song ticks per quarter; a beat
export const LANES = Object.freeze(['ac', 'bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch']);
export const SOUNDS = Object.freeze(['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch', 'lc', 'mc', 'hc', 'cl', 'ma']);
export const SOUND_NAMES = Object.freeze(['Kick', 'Snare', 'Low tom', 'Mid tom', 'Hi tom', 'Rim shot', 'Hand clap', 'Cowbell',
  'Cymbal', 'Open hat', 'Closed hat', 'Low conga', 'Mid conga', 'Hi conga', 'Claves', 'Maracas']);
// lane → its sound with the panel switch at 0 / at 1 (AC: none) (= DrSeq); sound → its lane; lane → its switch's patch id
export const LANE_SOUND = deepFreeze([[-1, -1], [0, 0], [1, 1], [2, 11], [3, 12], [4, 13], [5, 14], [6, 15], [7, 7], [8, 8], [9, 9], [10, 10]]);
export const SOUND_LANE = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 3, 4, 5, 6, 7]);
export const LANE_SW = Object.freeze(['', '', '', 'lts', 'mts', 'hts', 'rss', 'cps', '', '', '', '']);
// PRE-SCALE position 1–4 → step ticks at 960 PPQ, steps per beat, swung (16ths / 32nds only) (= DrSeq)
export const STEP_T = Object.freeze([0, 320, 160, 240, 120]);
export const SPB = Object.freeze([0, 3, 6, 4, 8]);
export const SWUNG = Object.freeze([0, 0, 0, 1, 1]);
export const FILLS = Object.freeze([0, 16, 12, 8, 4, 2]);             // AUTO FILL IN: MANUAL, 16, 12, 8, 4, 2
export const MODES = Object.freeze(['PATTERN CLEAR', 'PATTERN WRITE 1st PART', '2nd PART', 'MANUAL PLAY', 'PLAY', 'COMPOSE']);
export const M_CLEAR = 0, M_W1 = 1, M_W2 = 2, M_MAN = 3, M_PLAY = 4, M_COMP = 5;
export const N_KEYS = 16, N_BASIC = 12, N_PAT = 32, N_STEP = 32, N_TRACKS = 12, TRACK_LEN = 64, RT_LEN = 768;
export const MAX_MEAS = 769, MAX_STEPS = 24576;                        // (= DrSeq) a plan's bounds (768 measures + an intro)
export const V_N = 4, V_TOP = 14;                                      // trigger volts: unaccented; the accent bus at ACCENT 10
export const TEMPO_LO = 40, TEMPO_HI = 300, TEMPO_CLICKS = 40, SWING_LO = 50, SWING_HI = 75;
export const CLEARED = Object.freeze({ pre: 3, l1: 16, l2: 0 });
// the odd step of a pair starts this many whole ticks late (§3.5; pct a whole percentage: never a .5 tie) (= DrSeq)
export const swingTicks = (pct, T) => Math.round((2 * pct - 100) * T / 100);

// GM-based note map (§4.1): sound → [primary, …aliases]
export const DEFAULT_MAP = deepFreeze({ bd: [36, 35], sd: [38, 40], lt: [41, 43], mt: [45, 47], ht: [48, 50], rs: [37], cp: [39],
  cb: [56], cy: [49, 57], oh: [46], ch: [42, 44], lc: [64], mc: [63], hc: [62], cl: [75], ma: [70] });

/* ================================================================ constants (PERS.tr606; IMPL-7b §1.2, §3.1, §4) */

// the 606 in the 808's space (7b §1.2): its INSTRUMENT positions AC BD SD LT HT CY OH CH on the 808's lane bits, its seven
// sounds by the 808's sound ids (every sound list stays 16 long, indexed by sound id: never a 7-entry one); a step & 0xE2F
export const LANES606 = Object.freeze([0, 1, 2, 3, 5, 9, 10, 11]);
export const CODES606 = Object.freeze(['AC', 'BD', 'SD', 'LT', 'HT', 'CY', 'OH', 'CH']);
export const ROWS606 = Object.freeze(['Accent', 'Kick', 'Snare', 'Low tom', 'Hi tom', 'Cymbal', 'Open hat', 'Closed hat']);
export const SIDS606 = Object.freeze([0, 1, 2, 4, 8, 9, 10]);
export const MASK606 = 0xE2F;
export const M6_TW = 0, M6_TP = 1, M6_PP = 2, M6_PW = 3;              // the MODE rotary, clockwise (R6 §12)
export const MODES606 = Object.freeze(['TRACK WRITE', 'TRACK PLAY', 'PATTERN PLAY', 'PATTERN WRITE']);
export const SC_CODE = Object.freeze([0, 3, 4, 1, 2]);                // SCALE 1–4 → the plan's step code: 16ths, 32nds, 8th / 16th triplets
export const N_PAT6 = 32, N_STEP6 = 16, N_TRACKS6 = 8, RT6_LEN = 704, TRACK6_MAX = 256;
export const CLEARED6 = Object.freeze({ sc: 1, l1: 16 });
export const TEMPO6_LO = 40, TEMPO6_HI = 300;                          // continuous, 0.01 BPM (no click stops)
// the 606's note map (7b §4): the 808's primaries, the GM toms 43 / 45 / 47 / 50 folded onto its two toms
export const MAP606 = deepFreeze({ bd: [36, 35], sd: [38, 40], lt: [41, 43, 45], ht: [48, 50, 47], cy: [49, 57], oh: [46], ch: [42, 44] });
const HAS606 = new Set(Object.keys(MAP606));

// each machine's personality in one table (§1.1: a 606 / 909 is a second table, not a fork)
export const PERS = deepFreeze({
  tr808: {
    id: 'tr808', lanes: LANES, sounds: SOUNDS, names: SOUND_NAMES, laneSound: LANE_SOUND, laneSw: LANE_SW, map: DEFAULT_MAP,
    keys: N_KEYS, basic: N_BASIC, partSteps: 16, parts: 2, stepT: STEP_T, spb: SPB, swung: SWUNG, preDefault: 3,
    modes: MODES, fills: FILLS, bvar: ['A', 'AB', 'B'], ifv: ['A', 'B'], tracks: N_TRACKS, trackLen: TRACK_LEN,
    tempo: { lo: TEMPO_LO, hi: TEMPO_HI, clicks: TEMPO_CLICKS }, swing: { lo: SWING_LO, hi: SWING_HI }, cleared: CLEARED,
    choke: { by: 11, of: 10 },                                         // a CH (lane 11) trigger chokes OH (lane 10)
    sids: Array.from({ length: 16 }, (_, s) => s), mask: 0xFFF,        // (7b: the sounds it has, its lane bits)
  },
  // lanes: INSTRUMENT position → lane bit; codes / rows: the positions' labels; names: the 16 sound names by sound id
  tr606: {
    id: 'tr606', lanes: LANES606, codes: CODES606, rows: ROWS606, sids: SIDS606, mask: MASK606, sounds: SOUNDS, names: SOUND_NAMES,
    laneSound: LANE_SOUND, map: MAP606, keys: 16, groups: 2, patterns: N_PAT6, steps: N_STEP6, tracks: N_TRACKS6, rtLen: RT6_LEN,
    trackMax: TRACK6_MAX, scCode: SC_CODE, stepT: STEP_T, spb: SPB, swung: SWUNG, modes: MODES606,
    scales: ['16ths', '32nds', '8th triplets', '16th triplets'], dials: { mode: 4, inst: 8, sc: 4 },
    tempo: { lo: TEMPO6_LO, hi: TEMPO6_HI }, swing: { lo: SWING_LO, hi: SWING_HI }, cleared: CLEARED6, choke: { by: 11, of: 10 },
  },
});

/* ================================================================ small helpers */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;    // (NaN → lo; + 0: no −0 in saved state)
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const intIn = (x, d, lo, hi) => (fin(x) ? clamp(Math.round(x), lo, hi) : d);
const boolIn = (x, d) => (typeof x === 'boolean' ? x : d);
const maskIn = x => (fin(x) && x === Math.floor(x) ? x & 0xFFF : 0);
const at = (a, i) => (Array.isArray(a) ? a[i] : undefined);
const idx = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : -1); // an index input: in range or none
// FNV-1a 32 (= seq-core / wt.js) over numbers and typed arrays
function fnvNum(h, v) { h ^= v & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 8) & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 16) & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 24) & 255; return Math.imul(h, 0x01000193); }
function fnvArr(h, ta) {
  const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
  return h;
}
const hex = h => (h >>> 0).toString(16).padStart(8, '0');
const pName = k => (k >= N_BASIC ? 'Fill ' + (k - N_BASIC + 1) : 'Pattern ' + (k + 1));

/* ================================================================ note map, velocity, tempo (§1.3, §1.4, §3.2, §4.1) */

/** The 128-entry note → sound table of a map (−1 = none): the payload's `map`, = Inst.noteOn's lookup (§1.4). model: the
 *  machine whose sounds the map holds (7b: 'tr606' — its seven; else the 808's sixteen, a sound the map lacks at its default). */
export function mapTable(map, model) {
  const m = normMap(map, model), t = new Int8Array(128).fill(-1);
  for (let s = 0; s < 16; s++) for (const n of m[SOUNDS[s]]) t[n] = s;
  return t;
}
/** sound → its primary note (−1: unmapped); 16 by sound id for either machine. */
export function primaries(map, model) {
  const m = normMap(map, model), p = new Int8Array(16).fill(-1);
  for (let s = 0; s < 16; s++) if (m[SOUNDS[s]].length) p[s] = m[SOUNDS[s]][0];
  return p;
}
/** The roll's drum rows (§4.2): the mapped primaries in the map's order (kick first = the bottom row), { n, s, name }. */
export function drumRows(map, model) {
  const p = primaries(map, model), out = [];
  for (let s = 0; s < 16; s++) if (p[s] >= 0) out.push({ n: p[s], s, name: SOUND_NAMES[s] });
  return out;
}
/** Velocity (1–127) → trigger volts at ACCENT acc (0…1) (§1.3): 100 = V_N, 127 = V_A, ghosts down to 0.6 · V_N. */
export function vTrig(v127, acc) {
  const v = fin(v127) ? clamp(v127, 1, 127) : 100, a = fin(acc) ? clamp(acc, 0, 1) : 0.5;
  if (v < 100) return V_N * (0.6 + 0.4 * (v - 1) / 99);
  const u = (v - 100) / 27, VA = V_N + a * (V_TOP - V_N);
  return (1 - u) * V_N + u * VA;
}
const TR = Math.pow(TEMPO_HI / TEMPO_LO, 1 / (TEMPO_CLICKS - 1));       // one click ≈ 5.3 %
/** TEMPO click (0–39) + FINE (± 0.5 click) → BPM, 40–300, rounded to 0.01. */
export function tempoBpm(tempo, fine) {
  const c = intIn(tempo, 21, 0, TEMPO_CLICKS - 1) + (fin(fine) ? clamp(fine, -0.5, 0.5) : 0);
  return clamp(Math.round(TEMPO_LO * Math.pow(TR, c) * 100) / 100, TEMPO_LO, TEMPO_HI);
}
/** BPM → the knob positions showing it { tempo, fine } (SYNC on: the knobs show the project tempo). */
export function bpmTempo(bpm) {
  const c = Math.log(clamp(fin(bpm) ? bpm : 120, TEMPO_LO, TEMPO_HI) / TEMPO_LO) / Math.log(TR);
  const tempo = clamp(Math.round(c), 0, TEMPO_CLICKS - 1);
  return { tempo, fine: Math.round(clamp(c - tempo, -0.5, 0.5) * 1e4) / 1e4 + 0 };
}
const DEF_T = bpmTempo(120);                                            // the default knobs: 120 BPM
/** The 606's TEMPO (7b §3.1): the knob's travel u 0…1 → BPM on a log law, 40 · 7.5^u, rounded to 0.01 (40–300). */
export function tempo606(u) { return fin(u) ? Math.round(TEMPO6_LO * Math.pow(TEMPO6_HI / TEMPO6_LO, clamp(u, 0, 1)) * 100) / 100 + 0 : 120; }
/** …and back: BPM → the knob's travel 0…1. */
export function tempo606Pos(bpm) { return Math.log(clamp(fin(bpm) ? bpm : 120, TEMPO6_LO, TEMPO6_HI) / TEMPO6_LO) / Math.log(TEMPO6_HI / TEMPO6_LO) + 0; }
/** SYNC 303s (7b §3.8): a drum machine's swing P (50–75 %, whole ticks of a 16th) → the TB-303's extras swing s (0–50, a
 *  fraction s / 200 of a 16th): s = 4 · (P − 50), equal before rounding, clamped at the 303's 50 (62.5 %). */
export function swing303(P) { return clamp(4 * ((fin(P) ? Math.round(P) : SWING_LO) - SWING_LO), 0, 50); }
/** A machine's own (free) tempo in BPM: the 808's TEMPO + FINE, the 606's TEMPO. */
export function freeBpm(D) { return is606(D) ? D.ui.tempo : tempoBpm(D.ui.tempo, D.ui.fine); }
/** (7b review 1 #4, the lead's decision) The record with its own TEMPO (the 808: TEMPO + FINE) showing `bpm` (40–300) — "→
 *  Piano roll" leaves the machine SYNC off at the project's tempo, so its stopped clock (the 606's open hat's cut after ■)
 *  reads what the synced pattern's read (D5 at a stop too); the same record when it already shows it (or bpm is no number). */
export function withTempo(D, bpm) {
  if (!fin(bpm)) return D;
  if (is606(D)) { const b = bpm606(bpm, D.ui.tempo); return b === D.ui.tempo ? D : { ...D, ui: { ...D.ui, tempo: b } }; }
  const k = bpmTempo(bpm);
  return k.tempo === D.ui.tempo && k.fine === D.ui.fine ? D : { ...D, ui: { ...D.ui, tempo: k.tempo, fine: k.fine } };
}

/* ================================================================ normDrum (§6) */

// the map of a machine's sounds (7b: the 606's keeps its seven sounds and maps none of the others — every key present, so
// a reader without the model never fills the 808's defaults in)
function normMap(map, model) {
  const six = model === 'tr606', def = six ? MAP606 : DEFAULT_MAP, out = {}, used = new Set();
  const src = isObj(map) ? map : def;
  for (const s of SOUNDS) {
    if (six && !HAS606.has(s)) { out[s] = []; continue; }
    const a = Object.prototype.hasOwnProperty.call(src, s) ? src[s] : def[s], l = [];
    if (Array.isArray(a)) for (let i = 0; i < a.length && l.length < 8; i++) {
      const n = a[i];
      if (fin(n) && n === Math.floor(n) && n >= 0 && n <= 127 && !used.has(n)) { used.add(n); l.push(n); } // (later duplicates dropped)
    }
    out[s] = l;
  }
  return out;
}
const SMP_ID = /^smp:[0-9a-f]{16}$/;
function normSmp(o, model) {
  const out = {};
  if (!isObj(o)) return out;
  for (const s of SOUNDS) {
    if (model === 'tr606' && !HAS606.has(s)) continue;                 // (7b: only the 606's seven slots)
    const e = Object.prototype.hasOwnProperty.call(o, s) ? o[s] : null;
    if (!isObj(e) || typeof e.id !== 'string' || !SMP_ID.test(e.id)) continue;
    out[s] = { id: e.id, name: typeof e.name === 'string' ? e.name.slice(0, 64) : '', on: e.on === true };
  }
  return out;
}
function normUi(u) {
  u = isObj(u) ? u : {};
  return {
    mode: intIn(u.mode, M_MAN, 0, 5), inst: intIn(u.inst, 1, 0, 11), fill: intIn(u.fill, 0, 0, 5), bvar: intIn(u.bvar, 0, 0, 2),
    ifv: intIn(u.ifv, 0, 0, 1), pre: intIn(u.pre, 3, 1, 4), sel: intIn(u.sel, 0, 0, 11), ifk: intIn(u.ifk, 0, 0, 3),
    edf: intIn(u.edf, 0, 0, 1), intro: boolIn(u.intro, false), tempo: intIn(u.tempo, DEF_T.tempo, 0, TEMPO_CLICKS - 1),
    fine: fin(u.fine) ? Math.round(clamp(u.fine, -0.5, 0.5) * 1e4) / 1e4 + 0 : DEF_T.fine,
  };
}
function normX(x) {
  x = isObj(x) ? x : {};
  return { sync: boolIn(x.sync, true), swing: intIn(x.swing, SWING_LO, SWING_LO, SWING_HI), mute: maskIn(x.mute), solo: maskIn(x.solo),
    rec: boolIn(x.rec, false), part: intIn(x.part, 0, 0, 1) };
}
/** dev.drum normalised: exact lengths, every value in range, unknown fields dropped; idempotent; never throws. The machine
 *  (7b §3.1): `model`, else the record's own `m` — 'tr606' the 606's record; absent, unknown or hostile the 808's, exactly
 *  7a's (so a caller that forgets the model never turns a 606 record into an 808's). */
export function normDrum(d, model) {
  if (machineOf(d, model) === 'tr606') return norm606(d);
  try {
    d = isObj(d) ? d : {};
    const keys = [], st = [], rt = new Array(RT_LEN), rtEnd = [];
    for (let k = 0; k < N_KEYS; k++) {
      const e = isObj(at(d.keys, k)) ? d.keys[k] : CLEARED;
      keys.push({ pre: intIn(e.pre, CLEARED.pre, 1, 4), l1: intIn(e.l1, CLEARED.l1, 1, 16), l2: intIn(e.l2, CLEARED.l2, 0, 16) });
    }
    for (let p = 0; p < N_PAT; p++) {
      const a = at(d.st, p), row = new Array(N_STEP);
      for (let s = 0; s < N_STEP; s++) row[s] = maskIn(at(a, s));
      st.push(row);
    }
    for (let i = 0; i < RT_LEN; i++) rt[i] = intIn(at(d.rt, i), -1, -1, 15);
    for (let t = 0; t < N_TRACKS; t++) { const e = intIn(at(d.rtEnd, t), -1, -1, RT_LEN - 1); rtEnd.push(e >= t * TRACK_LEN ? e : -1); }
    return { v: 1, keys, st, rt, rtEnd, ui: normUi(d.ui), x: normX(d.x), map: normMap(d.map), smp: normSmp(d.smp) };
  } catch (e) {
    return normDrum(undefined);                                        // (a hostile getter: the defaults)
  }
}
function machineOf(d, model) {
  let m = model;
  if (m == null) try { m = isObj(d) ? d.m : undefined; } catch (e) { m = undefined; }
  return m === 'tr606' ? 'tr606' : 'tr808';
}
function is606(D) { try { return isObj(D) && D.m === 'tr606'; } catch (e) { return false; } }

// the 606's tracks (7b §3.1): track t's region starts at t6Start (tracks 1–7: 64 bars, 8: 256); its reach ≤ 256 bars, the
// store's end (703) bounding it; t6Of: the region a bar lies in
const t6Start = t => (t < 7 ? t * 64 : 448), t6RegEnd = t => (t < 7 ? t * 64 + 63 : RT6_LEN - 1);
const t6Max = t => Math.min(t6Start(t) + TRACK6_MAX - 1, RT6_LEN - 1), t6Of = j => (j < 448 ? j >> 6 : 7);
const bpm606 = (v, d) => (fin(v) ? Math.round(clamp(v, TEMPO6_LO, TEMPO6_HI) * 100) / 100 + 0 : d);
function normUi606(u) {
  u = isObj(u) ? u : {};
  const sel = intIn(u.sel, 0, 0, 15);
  return { mode: intIn(u.mode, M6_PP, 0, 3), inst: intIn(u.inst, 1, 0, 7), grp: intIn(u.grp, 0, 0, 1), sel, cl: intIn(u.cl, 0, 0, 3 - (sel & 3)),
    sc: intIn(u.sc, CLEARED6.sc, 1, 4), tempo: bpm606(u.tempo, 120) };
}
function normX606(x) {
  x = isObj(x) ? x : {};
  return { sync: boolIn(x.sync, true), swing: intIn(x.swing, SWING_LO, SWING_LO, SWING_HI), mute: maskIn(x.mute) & MASK606,
    solo: maskIn(x.solo) & MASK606, rec: boolIn(x.rec, false) };
}
function norm606(d) {
  try {
    d = isObj(d) ? d : {};
    const keys = [], st = [], rt = new Array(RT6_LEN), tg = [], dc = [], sg = [];
    for (let p = 0; p < N_PAT6; p++) {
      const e = isObj(at(d.keys, p)) ? d.keys[p] : CLEARED6, a = at(d.st, p), row = new Array(N_STEP6);
      keys.push({ sc: intIn(e.sc, CLEARED6.sc, 1, 4), l1: intIn(e.l1, CLEARED6.l1, 1, N_STEP6) });
      for (let s = 0; s < N_STEP6; s++) row[s] = maskIn(at(a, s)) & MASK606;
      st.push(row);
    }
    for (let i = 0; i < RT6_LEN; i++) rt[i] = intIn(at(d.rt, i), -1, -1, 15);
    const reach = (b, t) => (b >= t6Start(t) && b <= t6Max(t) ? b : -1);
    for (let t = 0; t < N_TRACKS6; t++) {
      tg.push(intIn(at(d.tg, t), 0, 0, 1));
      dc.push(reach(intIn(at(d.dc, t), -1, -1, RT6_LEN - 1), t));
      sg.push(reach(intIn(at(d.sg, t), -1, -1, RT6_LEN - 1), t));
    }
    return { v: 1, m: 'tr606', keys, st, rt, tg, dc, sg, ui: normUi606(d.ui), x: normX606(d.x), map: normMap(d.map, 'tr606'), smp: normSmp(d.smp, 'tr606') };
  } catch (e) {
    return norm606(undefined);                                         // (a hostile getter: the defaults)
  }
}
/** A 606 track's reach (7b §3.1) → { start, cap, max, end }: its region, continued into the next regions while the one
 *  before is full (its last bar written) and the next track has no D.C. or segno of its own — overwriting into a region
 *  ends its track (both go), a track written the hardware's way (its last bar as the D.C.) is never swallowed — cap = the
 *  last bar of the regions it covers, max = its 256 bars or the store's end; end = its D.C. bar, else its last written bar
 *  up to cap (an implicit D.C. there; −1: an empty track) [C]. */
export function track606(D, t) {
  const s = t6Start(t), mx = t6Max(t);
  let cap = t6RegEnd(t);
  for (let u = t + 1; u < N_TRACKS6 && t6Start(u) <= mx && D.rt[cap] >= 0 && D.dc[u] < 0 && D.sg[u] < 0; u++) cap = Math.min(t6RegEnd(u), mx);
  let end = D.dc[t];
  if (!(end >= s && end <= mx)) { end = -1; for (let j = cap; j >= s; j--) if (D.rt[j] >= 0) { end = j; break; } }
  return { start: s, cap, max: mx, end };
}

/* ================================================================ the plan (§3.4) */

// the effective mute / solo of the 12 lanes: a soloed sound lane mutes the unsoloed ones; AC follows its own mute only
export function audible(x) {
  const so = (x.solo | 0) & 0xFFE;
  return (so ? so : ~(x.mute | 0) & 0xFFE) | ((x.mute | 0) & 1 ? 0 : 1);
}
/** The payload's `mute`: the 16 sounds muted by mute / solo (bit = sound). */
export function soundMute(x) {
  const a = audible(x);
  let m = 0;
  for (let s = 0; s < 16; s++) if (!(a & (1 << SOUND_LANE[s]))) m |= 1 << s;
  return m;
}
const editKey = ui => (ui.edf ? N_BASIC + ui.ifk : ui.sel);
// the measures a mode plays: [[key, var], …], the intro flag and the loop start (§3.4)
function measures(mem, ui) {
  const out = [], bv = ui.bvar, AB = bv === 1, fixed = bv === 2 ? 1 : 0;
  let intro = 0;
  if (ui.mode <= M_W2) { // write / clear modes: the edited key (A, B or A + B)
    const ek = editKey(ui);
    if (ek >= N_BASIC) out.push([ek, ui.ifv]); else if (AB) out.push([ek, 0], [ek, 1]); else out.push([ek, fixed]);
  } else if (ui.mode === M_PLAY) { // the track's measures from its measure 1; AB counts its basic measures (§3.3)
    const t = ui.inst, s0 = t * TRACK_LEN, e = mem.rtEnd[t];
    let b = 0;
    for (let j = s0; j <= e; j++) {
      const k = mem.rt[j];
      out.push(k < 0 ? [-1, 0] : k >= N_BASIC ? [k, ui.ifv] : [k, AB ? (b++ & 1) : fixed]);
    }
  } else { // MANUAL PLAY, COMPOSE: [intro] + one cycle of AB ? 2N : N measures, every N-th a fill
    if (ui.intro) { out.push([N_BASIC + ui.ifk, ui.ifv]); intro = 1; }
    const N = FILLS[ui.fill] || 1, L = AB ? 2 * N : N;
    let b = 0;
    for (let i = 0; i < L; i++) {
      if (N > 1 && (i + 1) % N === 0) out.push([N_BASIC + ui.ifk, ui.ifv]);
      else out.push([ui.sel, AB ? (b++ & 1) : fixed]);
    }
  }
  return { list: out, intro, loopFrom: intro };
}
let memo = null;
/** The explicit cyclic list of measures the machine plays (§3.4); pure, deterministic, memoised. S: the session (7b: a
 *  606's plan reads it — the bar pointer, TRACK WRITE's heard key, the D.S.; absent: none, the track from its first bar). */
export function compilePlan(mem, ui, x, S) {
  if (is606(mem)) return plan606(mem, ui, x, S);                       // (7b: before the 808's guards, review #20)
  if (!isObj(mem) || !Array.isArray(mem.keys) || mem.keys.length !== N_KEYS || !Array.isArray(mem.st) || !Array.isArray(mem.rt)) mem = normDrum(mem);
  ui = ui ? normUi(ui) : mem.ui ? normUi(mem.ui) : normUi(null);
  x = x ? normX(x) : mem.x ? normX(mem.x) : normX(null);
  const A = audible(x);
  const sig = [ui.mode, ui.inst, ui.fill, ui.bvar, ui.ifv, ui.sel, ui.ifk, ui.edf, ui.intro ? 1 : 0, A].join(',');
  if (memo && memo.keys === mem.keys && memo.st === mem.st && memo.rt === mem.rt && memo.rtEnd === mem.rtEnd && memo.sig === sig) return memo.plan;
  const { list, intro, loopFrom } = measures(mem, ui), n = list.length;
  const mKey = new Int8Array(n), mVar = new Int8Array(n), mPre = new Uint8Array(n), mL1 = new Uint8Array(n);
  const mOff = new Int32Array(n + 1), mT = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const [k, v] = list[i], K = k < 0 ? CLEARED : mem.keys[k];
    mKey[i] = k; mVar[i] = v; mPre[i] = K.pre; mL1[i] = K.l1;
    mOff[i + 1] = mOff[i] + K.l1 + K.l2;
    mT[i + 1] = mT[i] + (K.l1 + K.l2) * STEP_T[K.pre];
  }
  const st = new Uint16Array(mOff[n]);
  for (let i = 0; i < n; i++) {
    if (mKey[i] < 0) continue;
    const row = mem.st[mKey[i] * 2 + mVar[i]];
    for (let s = 0, o = mOff[i]; o < mOff[i + 1]; s++, o++) st[o] = row[s] & A;
  }
  let fill = null;
  if (ui.mode >= M_MAN) { // TAP fills (§3.4): the selected I/F key at the I/F VARIATION, played by DrSeq on request
    const k = N_BASIC + ui.ifk, K = mem.keys[k], row = mem.st[k * 2 + ui.ifv], fs = new Uint16Array(K.l1 + K.l2);
    for (let s = 0; s < fs.length; s++) fs[s] = row[s] & A;
    fill = { k, v: ui.ifv, pre: K.pre, l1: K.l1, l2: K.l2, st: fs };
  }
  let h = fnvNum(0x811c9dc5 | 0, n); h = fnvNum(h, intro); h = fnvNum(h, loopFrom);
  h = fnvArr(h, mPre); h = fnvArr(h, mL1); h = fnvArr(h, mOff);
  const shape = hex(h);
  h = fnvArr(h, mKey); h = fnvArr(h, mVar); h = fnvArr(h, st);
  if (fill) { h = fnvNum(h, fill.k); h = fnvNum(h, fill.v); h = fnvNum(h, fill.pre); h = fnvNum(h, fill.l1); h = fnvNum(h, fill.l2); h = fnvArr(h, fill.st); } else h = fnvNum(h, -1);
  const plan = { key: hex(h), shape, n, intro, loopFrom, mKey, mVar, mPre, mL1, mOff, mT, st, fill };
  memo = { keys: mem.keys, st: mem.st, rt: mem.rt, rtEnd: mem.rtEnd, sig, plan };
  return plan;
}
// the 606's session fields a plan reads: the bar pointer inside track t's reach (one past it after the last TAP), else the
// track's first bar; TRACK WRITE's heard key / chain { sel, cl } (null: the bar's own)
function bar6(S, t) { const b = S ? S.bar : undefined, s = t6Start(t); return Number.isInteger(b) && b >= s && b <= t6Max(t) + 1 ? b : s; }
function tw6(S) {
  const w = S ? S.twSel : null;
  return isObj(w) && Number.isInteger(w.sel) && w.sel >= 0 && w.sel <= 15 && Number.isInteger(w.cl) && w.cl >= 0 && w.cl <= 3 - (w.sel & 3) ? w : null;
}
// the measures a 606 mode plays (7b §3.4): ps the patterns (0–31; −1 a silent bar of 16 sixteenths), bars the track bars
// they come from (−1: none), loopFrom (a free TRACK PLAY's pre-roll from a located bar), rot (the D.S. rotation applies)
function list606(mem, ui, x, S) {
  const ps = [], bars = [], t = ui.inst, put = (p, b) => { ps.push(p); bars.push(b); };
  let loopFrom = 0, rot = 0;
  if (ui.mode >= M6_PP) for (let k = ui.sel; k <= ui.sel + ui.cl; k++) put(ui.grp * 16 + k, -1); // the selection, looping
  else {
    const g = mem.tg[t] * 16, b = bar6(S, t), bar = j => put(mem.rt[j] >= 0 ? g + mem.rt[j] : -1, j); // (a continued track: its own group)
    if (ui.mode === M6_TW) { // the key / chain heard, else the bar's own pattern, looping
      const w = tw6(S);
      if (w) for (let k = w.sel; k <= w.sel + w.cl; k++) put(g + k, b); else if (b <= t6Max(t)) bar(b); else put(-1, b);
    } else { // TRACK PLAY: first … end looping; free, a located start a pre-roll; D.S. the cycle entered at the segno
      const T = track606(mem, t), sg = mem.sg[t];
      if (T.end >= 0) {
        if (S && S.ds > 0 && sg >= T.start && sg <= T.end) { rot = 1; for (let j = sg; j <= T.end; j++) bar(j); for (let j = T.start; j < sg; j++) bar(j); }
        else {
          if (!x.sync && b > T.start && b <= T.end) { for (let j = b; j <= T.end; j++) bar(j); loopFrom = T.end - b + 1; }
          for (let j = T.start; j <= T.end; j++) bar(j);
        }
      }
    }
  }
  return { ps, bars, loopFrom, rot };
}
const ok606 = D => Array.isArray(D.keys) && D.keys.length === N_PAT6 && Array.isArray(D.st) && D.st.length === N_PAT6 && Array.isArray(D.rt)
  && D.rt.length === RT6_LEN && Array.isArray(D.tg) && Array.isArray(D.dc) && Array.isArray(D.sg);
let memo6 = null;
// the 606's plan (7b §3.4): the shared format — a measure per pattern (mKey the pattern 0–31, mVar 0, mPre its SCALE's step
// code, mL1 = its LAST STEP = its length), fill null; the D.S. counter in the key while it rotates (a second D.S. re-swaps)
function plan606(mem, ui, x, S) {
  if (!ok606(mem)) mem = normDrum(mem, 'tr606');
  ui = normUi606(ui || mem.ui); x = normX606(x || mem.x);
  const A = audible(x), trk = ui.mode < M6_PP, w = ui.mode === M6_TW ? tw6(S) : null, ds = ui.mode === M6_TP && S && S.ds > 0 ? S.ds | 0 : 0;
  const sig = [ui.mode, ui.inst, ui.grp, ui.sel, ui.cl, A, x.sync ? 1 : 0, trk ? bar6(S, ui.inst) : -1, w ? w.sel * 4 + w.cl : -1, ds].join(',');
  const M = memo6;
  if (M && M.keys === mem.keys && M.st === mem.st && M.rt === mem.rt && M.tg === mem.tg && M.dc === mem.dc && M.sg === mem.sg && M.sig === sig) return M.plan;
  const { ps, loopFrom, rot } = list606(mem, ui, x, S), n = ps.length, intro = loopFrom > 0 ? 1 : 0;
  const mKey = new Int8Array(n), mVar = new Int8Array(n), mPre = new Uint8Array(n), mL1 = new Uint8Array(n);
  const mOff = new Int32Array(n + 1), mT = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const p = ps[i], K = p < 0 ? CLEARED6 : mem.keys[p], c = SC_CODE[K.sc];
    mKey[i] = p; mPre[i] = c; mL1[i] = K.l1;
    mOff[i + 1] = mOff[i] + K.l1;
    mT[i + 1] = mT[i] + K.l1 * STEP_T[c];
  }
  const st = new Uint16Array(mOff[n]);
  for (let i = 0; i < n; i++) {
    if (mKey[i] < 0) continue;
    const row = mem.st[mKey[i]];
    for (let s = 0, o = mOff[i]; o < mOff[i + 1]; s++, o++) st[o] = row[s] & A;
  }
  let h = fnvNum(0x811c9dc5 | 0, n); h = fnvNum(h, intro); h = fnvNum(h, loopFrom);
  h = fnvArr(h, mPre); h = fnvArr(h, mL1); h = fnvArr(h, mOff);
  const shape = hex(h);
  h = fnvArr(h, mKey); h = fnvArr(h, mVar); h = fnvArr(h, st); h = fnvNum(h, -1);
  if (rot) h = fnvNum(h, ds);
  const plan = { key: hex(h), shape, n, intro, loopFrom, mKey, mVar, mPre, mL1, mOff, mT, st, fill: null };
  memo6 = { keys: mem.keys, st: mem.st, rt: mem.rt, tg: mem.tg, dc: mem.dc, sg: mem.sg, sig, plan };
  return plan;
}
/** A plan's lengths in ticks: the intro, one cycle, intro + cycle. */
export function planTicks(plan) {
  if (!plan || !plan.n) return { intro: 0, cycle: 0, total: 0 };
  const T = plan.mT, i = T[plan.loopFrom];
  return { intro: i, cycle: T[plan.n] - i, total: T[plan.n] };
}
// the measure playing at tick t of a plan anchored at tick 0 (sync): { m, start } (measure index, its start tick)
function measureAt(plan, t) {
  const T = plan.mT, n = plan.n, lf = plan.loopFrom, cyc = T[n] - T[lf];
  let off = 0;
  if (t >= T[n]) off = T[n] - T[lf] + Math.floor((t - T[n]) / cyc) * cyc; // (whole cycles behind)
  let lo = off ? lf : 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] + off <= t) lo = m; else hi = m - 1; }
  return { m: lo, start: T[lo] + off };
}
const swOf = sw => (Array.isArray(sw) ? sw : isObj(sw) ? LANE_SW.map(id => (id && sw[id] ? 1 : 0)) : []);
/**
 * "→ Piano roll" (§4.3): the hits the synced sequencer plays in [t0, t1) — the plan anchored at tick 0, the steps at their
 * whole-tick swung positions — as roll notes { t, d: 120, n: the sound's primary, v: 100 | 127 }, sorted by t then n.
 * opts: { t0, t1, swing (%), sw (the patch's switches: { lts, … } or a per-lane array), map (or prim: the primaries) }.
 * Hits of an unmapped sound are skipped.
 */
export function toNotes(plan, opts = {}) {
  const out = [];
  if (!plan || !(plan.n > 0)) return out;
  const t0 = Math.max(0, fin(opts.t0) ? Math.round(opts.t0) : 0), t1 = fin(opts.t1) ? Math.round(opts.t1) : t0;
  const pct = intIn(opts.swing, SWING_LO, SWING_LO, SWING_HI), sw = swOf(opts.sw);
  const prim = opts.prim && opts.prim.length === 16 ? opts.prim : primaries(opts.map);
  let { m, start } = measureAt(plan, t0);
  while (start < t1) {
    const pre = plan.mPre[m], T = STEP_T[pre], off = SWUNG[pre] ? swingTicks(pct, T) : 0;
    for (let s = 0, o = plan.mOff[m]; o < plan.mOff[m + 1]; s++, o++) {
      const t = start + s * T + (s & 1 ? off : 0), mask = plan.st[o];
      if (t < t0 || t >= t1 || !(mask & 0xFFE)) continue;
      const v = mask & 1 ? 127 : 100;
      for (let l = 1; l < 12; l++) {
        if (!(mask & (1 << l))) continue;
        const n = prim[LANE_SOUND[l][sw[l] ? 1 : 0]];
        if (n >= 0) out.push({ t, d: 120, n, v });
      }
    }
    start += plan.mT[m + 1] - plan.mT[m];
    m = m + 1 < plan.n ? m + 1 : plan.loopFrom;
  }
  return out.sort((a, b) => a.t - b.t || a.n - b.n);
}

/* ================================================================ the payload (§3.5) */

function slots(smp) {
  let any = false;
  const a = SOUNDS.map(s => (smp && smp[s] ? (any = true, { id: smp[s].id, on: !!smp[s].on }) : null));
  return any ? a : null;
}
/** The drum {t:'seq'} payload: the plan + the clock + the tables the Inst reads (§3.5); pk = its content key (not `at`).
 *  7b: a 606's adds m 'tr606' (the Inst keeps a payload for another machine waiting), rst (STEP RESET's counter) and rstF
 *  (that press's heard frame, −1 none: DrSeq drops a restart the pattern's own measure start already made, review 2 #3), its
 *  bpm is its TEMPO itself; an 808's has none of the three. */
export function payload(drum, state, at = 'now') {
  if (is606(drum)) return payload606(drum, state, at);
  const S = state || initState(), x = drum.x, ui = drum.ui;
  const plan = compilePlan(drum, ui, x), map = mapTable(drum.map), prim = primaries(drum.map), smp = slots(drum.smp);
  const s = { plan, sync: x.sync, run: !x.sync && !!S.run, bpm: tempoBpm(ui.tempo, ui.fine), swing: x.swing, at, tap: S.tap | 0,
    map, prim, mute: soundMute(x), smp };
  s.pk = pkOf(s);
  return s;
}
function payload606(drum, state, at) {
  const S = state || initState('tr606'), x = normX606(drum.x), ui = normUi606(drum.ui);
  const plan = compilePlan(drum, ui, x, S), map = mapTable(drum.map, 'tr606'), prim = primaries(drum.map, 'tr606'), smp = slots(drum.smp);
  const s = { plan, sync: x.sync, run: !x.sync && !!S.run, bpm: ui.tempo, swing: x.swing, at, tap: 0, map, prim, mute: soundMute(x), smp,
    m: 'tr606', rst: S.rst | 0, rstF: fin(S.rstF) ? S.rstF : -1 };
  s.pk = pkOf(s);
  return s;
}
// the content key: the plan's + FNV over the rest (7b review #3: m and rst when present — STEP RESET changes rst alone)
function pkOf(s) {
  let h = fnvNum(0x811c9dc5 | 0, s.sync ? 1 : 0); h = fnvNum(h, s.run ? 1 : 0); h = fnvNum(h, Math.round(s.bpm * 100));
  h = fnvNum(h, s.swing); h = fnvNum(h, s.tap); h = fnvNum(h, s.mute); h = fnvArr(h, s.map); h = fnvArr(h, s.prim);
  if (s.smp) for (const e of s.smp) { if (!e) { h = fnvNum(h, 0); continue; } for (let i = 0; i < e.id.length; i++) h = fnvNum(h, e.id.charCodeAt(i)); h = fnvNum(h, e.on ? 2 : 1); }
  if (s.m !== undefined) { for (let i = 0; i < s.m.length; i++) h = fnvNum(h, s.m.charCodeAt(i)); h = fnvNum(h, s.rst); }
  return s.plan.key + hex(h);
}

/* ================================================================ the panel's state machine (§3.3) */

/** A fresh session: never saved (§3.2). pos: the last {t:'step'} heard; cmp: the COMPOSE recording; undo: one level.
 *  7b §3.2, initState('tr606'): bar (the track pointer, absolute; −1: the track's first), loc (the keypad's digits typed:
 *  { h, u } — hundreds, the last two digits), fn / clr (FUNCTION / CLEAR held), held (the step keys held), wipe (CLEAR held
 *  running in PATTERN WRITE), twSel (TRACK WRITE's heard key / chain), dcArm / sgArm, rst (STEP RESET's counter), rstF (its
 *  last press's heard frame, −1 none), ds (D.S.: a counter, 0 = the plain track), show (FUNCTION + CLEAR / PATTERN GROUP: 'dc' /
 *  'sg' shown), gfl (the group LED's flash after PATTERN CLEAR, until the next press). */
export function initState(model) {
  if (model === 'tr606') return { run: false, play: false, pos: null, undo: null, bpm: 120, bar: -1, loc: null, fn: false, clr: false,
    held: [], wipe: false, twSel: null, dcArm: false, sgArm: false, rst: 0, rstF: -1, ds: 0, show: null, gfl: 0 };
  return { run: false, play: false, tap: 0, undo: null, pos: null, cmp: null, bpm: 120 };
}
export const running = (S, D) => (D.x.sync ? !!S.play : !!S.run);
// the variation a write mode edits: the I/F VARIATION for a fill; A / B; AB: the one heard (else A)
function editVar(S, D) {
  const ui = D.ui, ek = editKey(ui), P = S.pos;
  if (ek >= N_BASIC) return ui.ifv;
  if (ui.bvar !== 1) return ui.bvar === 2 ? 1 : 0;
  return running(S, D) && P && P.k === ek && !P.f ? P.v & 1 : 0;
}
/** The pattern (key · 2 + var) the step grid shows and edits (§3.6): the edited one, or the one heard / selected. (7b: a
 *  606's, 0–31: PATTERN WRITE's edited one, else the one heard, else the selection's / the bar's.) */
export function gridPat(S, D) {
  if (is606(D)) return gridPat606(S, D);
  const ui = D.ui, P = S.pos;
  if (ui.mode <= M_W2) return editKey(ui) * 2 + editVar(S, D);
  if (running(S, D) && P && P.k >= 0) return P.k * 2 + (P.v & 1);
  return ui.sel * 2 + (ui.bvar === 2 ? 1 : 0);
}
// immutable updates (structural sharing)
const withUi = (D, o) => ({ ...D, ui: { ...D.ui, ...o } });
const withX = (D, o) => ({ ...D, x: { ...D.x, ...o } });
function withKey(D, k, o) { const keys = D.keys.slice(); keys[k] = { ...keys[k], ...o }; return { ...D, keys }; }
function withBit(D, p, s, lane, on) { // on: 1 set, 0 clear, −1 toggle
  const row = D.st[p], b = 1 << lane, v = on < 0 ? row[s] ^ b : on ? row[s] | b : row[s] & ~b;
  if (v === row[s]) return D;
  const st = D.st.slice(), r = row.slice(); r[s] = v; st[p] = r;
  return { ...D, st };
}
function withRt(D, i, k) { if (D.rt[i] === k) return D; const rt = D.rt.slice(); rt[i] = k; return { ...D, rt }; }
function withEnd(D, t, e) { if (D.rtEnd[t] === e) return D; const rtEnd = D.rtEnd.slice(); rtEnd[t] = e; return { ...D, rtEnd }; }
const memOf = D => ({ keys: D.keys, st: D.st, rt: D.rt, rtEnd: D.rtEnd });
const ZERO = Object.freeze(new Array(N_STEP).fill(0));
const send = at => ({ c: 'send', at });
// COMPOSE (§3.3): recording starts with the run (or on entering COMPOSE while running); m0 = the measure count (post.M)
// recorded as the track's measure 1: 0 synced (the song's measure index) and from START (free); the next measure after a
// TRACK change or entering COMPOSE mid-run (free). nw: a new composition (the track was empty, i.e. TRACK CLEAR first):
// it extends the track's end measure by measure; otherwise an edit (replaces measures, the length unchanged)
function cmpInit(S, D, mid) {
  const t = D.ui.inst, P = S.pos;
  return { tr: t, m0: mid && P && !(D.x.sync && mid === 'mode') ? P.M + 1 : 0, nw: D.rtEnd[t] < t * TRACK_LEN };
}
// the step a TAP / REC pad writes: the heard one, or the next when more than half of it has passed (the TR-08's rule)
function nearest(S, D, f) {
  const P = S.pos;
  if (!P || P.f || P.k < 0) return null;
  if (!(fin(f) && f >= 0.5)) return { k: P.k, v: P.v & 1, s: P.s };
  const plan = compilePlan(D, D.ui, D.x), m = P.m;
  if (!(m >= 0 && m < plan.n) || plan.mKey[m] !== P.k) return null;
  if (P.s + 1 < plan.mOff[m + 1] - plan.mOff[m]) return { k: P.k, v: P.v & 1, s: P.s + 1 };
  const m2 = m + 1 < plan.n ? m + 1 : plan.loopFrom;
  return plan.mKey[m2] < 0 ? null : { k: plan.mKey[m2], v: plan.mVar[m2], s: 0 };
}

/** The panel's pure state machine (§3.3): (session, dev.drum, input) → { state, mem, cmds }. (7b: a 606 record's own.) */
export function press(state, drum, input) {
  if (is606(drum)) return press606(state, drum, input);
  let S = state || initState(), D = drum;
  if (Array.isArray(S.held)) S = { ...initState(), run: !!S.run, play: !!S.play, pos: isObj(S.pos) ? S.pos : null, bpm: fin(S.bpm) ? S.bpm : 120 }; // (7b: a 606 session under an 808 record — its transport, position and tempo kept)
  const cmds = [], i = isObj(input) ? input : {}, ui = D.ui, x = D.x, run = running(S, D), mode = ui.mode;
  const ek = editKey(ui), aOf = () => (run ? 'bar' : 'now');
  const done = () => ({ state: S, mem: D, cmds });
  const n = idx(i.n, 1, 16), v = i.v;
  switch (i.k) {
    case 'start': {
      if (mode === M_CLEAR) break;                                      // (START in PATTERN CLEAR: nothing)
      if (x.sync) { cmds.push({ c: run ? 'stop' : 'play' }); break; }   // one clock: the project's ▶ (§13 answer 1)
      S = { ...S, run: !run, cmp: !run && mode === M_COMP ? cmpInit(S, D, null) : null, pos: run ? S.pos : null };
      cmds.push(send('now'));
      break;
    }
    case 'transport': { // the host: the project transport started / stopped (synced machines follow it)
      const p = !!i.play, was = !!S.play;
      S = { ...S, play: p };
      if (x.sync && p && !was) S = { ...S, pos: null, cmp: mode === M_COMP ? cmpInit(S, D, null) : null };
      if (x.sync && !p) S = { ...S, cmp: null };
      break;
    }
    case 'panic': S = { ...S, run: false, cmp: x.sync ? S.cmp : null }; break; // (the worklet already stopped a free machine)
    case 'bpm': S = { ...S, bpm: fin(v) ? v : S.bpm }; break;
    case 'heard': { // a step post at its heard time: the LEDs' position; COMPOSE records each measure's key at its first step
      const P = i.post;
      if (!isObj(P)) break;
      S = { ...S, pos: { s: P.s | 0, m: P.m | 0, k: P.k | 0, v: P.v | 0, p: P.p | 0, o: P.o | 0, M: P.M | 0, f: P.f ? 1 : 0 } };
      const C = S.cmp, k = idx(P.k, 0, 15);
      if (mode === M_COMP && run && C && (P.s | 0) === 0 && k >= 0) {
        const j = (P.M | 0) - C.m0, ri = C.tr * TRACK_LEN + j;
        if (j < 0 || ri >= RT_LEN) break;
        if (C.nw) { // a new composition overflows into the next tracks' regions (their old contents end)
          D = withEnd(withRt(D, ri, k), C.tr, Math.max(D.rtEnd[C.tr], ri));
          const u = Math.floor(ri / TRACK_LEN);
          if (u !== C.tr) D = withEnd(D, u, -1);
        } else if (ri <= D.rtEnd[C.tr]) D = withRt(D, ri, k);
      }
      break;
    }
    case 'step': {
      if (n < 1) break;
      const fk = n > N_BASIC;
      if (mode <= M_W2 && !(run && mode !== M_CLEAR)) { // stopped (or PATTERN CLEAR): select the key to edit (flashing)
        D = withUi(D, fk ? { ifk: n - 13, edf: 1 } : { sel: n - 1, edf: 0 });
        cmds.push(send('now'));
      } else if (mode <= M_W2) { // running in a write mode: toggle the instrument at that step of the MODE's part
        const s = (mode === M_W2 ? 16 : 0) + n - 1;
        D = withBit(D, ek * 2 + editVar(S, D), s, ui.inst, -1);
        cmds.push(send('now'));
      } else if (mode === M_MAN || mode === M_COMP) {
        if (fk) { // an I/F key: the fill / intro key; in COMPOSE (running) it also writes one fill into the next measure
          D = withUi(D, { ifk: n - 13, edf: 1 });
          if (mode === M_COMP && run) S = { ...S, tap: S.tap + 1 };
          cmds.push(send('now'));
        } else { // a basic key: the next measure (beat 2 of this one when pressed in its beat 1: MANUAL PLAY's quirk)
          D = withUi(D, { sel: n - 1, edf: 0 });
          const P = S.pos, q = mode === M_MAN && run && P && P.o < BEAT;
          cmds.push(send(!run ? 'now' : q ? 'beat2' : 'bar'));
        }
      }
      break;
    }
    case 'clear+step': { // CLEAR held + step key N (write modes, running): the MODE's part ends at step N
      if (!(run && (mode === M_W1 || mode === M_W2) && n >= 1)) break;
      D = withKey(D, ek, mode === M_W1 ? { l1: n } : { l2: n });
      cmds.push(send('bar'));
      break;
    }
    case 'clear': {
      if (mode === M_CLEAR) { // PATTERN CLEAR: per the variation (AB: both), lengths and pre-scale to the cleared values
        const vs = ek >= N_BASIC ? [ui.ifv] : ui.bvar === 1 ? [0, 1] : [ui.bvar === 2 ? 1 : 0];
        const text = pName(ek) + ' ' + vs.map(q => 'AB'[q]).join(' + ') + ' cleared';
        S = { ...S, undo: { text, ...memOf(D) } };
        D = withKey(D, ek, CLEARED);
        const st = D.st.slice(); for (const q of vs) st[ek * 2 + q] = ZERO.slice(); D = { ...D, st };
        cmds.push(send(aOf()), { c: 'notice', text: text + ' · tap to undo', undo: true });
      } else if ((mode === M_W1 || mode === M_W2) && run) { // PRE-SCALE SET: the switch's scale latched for the key
        D = withKey(D, ek, { pre: ui.pre });
        cmds.push(send('bar'));
      } else if (mode === M_COMP && !run) { // TRACK CLEAR (with its overflow)
        const t = ui.inst, s0 = t * TRACK_LEN, e = D.rtEnd[t], text = 'Track ' + (t + 1) + ' cleared';
        S = { ...S, undo: { text, ...memOf(D) } };
        if (e >= s0) { const rt = D.rt.slice(); for (let j = s0; j <= e; j++) rt[j] = -1; D = { ...D, rt }; }
        D = withEnd(D, t, -1);
        cmds.push(send('now'), { c: 'notice', text: text + ' · tap to undo', undo: true });
      }
      break;
    }
    case 'tap': {
      if (mode === M_W1 || mode === M_W2) { // TAP write: the instrument at the nearest step (AC included), one sound a tap
        const w = run ? nearest(S, D, i.f) : null;
        if (w && w.k === ek) { D = withBit(D, w.k * 2 + w.v, w.s, ui.inst, 1); cmds.push(send('now')); }
      } else if (mode === M_MAN && !run) { D = withUi(D, { intro: !ui.intro }); cmds.push(send('now')); }
      else if ((mode === M_MAN || mode === M_PLAY || mode === M_COMP) && run) { S = { ...S, tap: S.tap + 1 }; cmds.push(send('now')); }
      break;
    }
    case 'pad': { // REC (extras): a pad hit writes its lane at the nearest step while a write mode runs
      const s = idx(i.sound, 0, 15);
      if (!(x.rec && run && (mode === M_W1 || mode === M_W2) && s >= 0)) break;
      const w = nearest(S, D, i.f);
      if (w && w.k === ek) { D = withBit(D, w.k * 2 + w.v, w.s, SOUND_LANE[s], 1); cmds.push(send('now')); }
      break;
    }
    case 'mode': {
      const m = intIn(v, mode, 0, 5);
      if (m === mode) break;
      D = withUi(D, { mode: m });
      if (run) S = { ...S, cmp: m === M_COMP ? cmpInit(S, D, 'mode') : null };
      cmds.push(send(aOf()));
      break;
    }
    case 'inst': {
      const t = intIn(v, ui.inst, 0, 11);
      if (t === ui.inst) break;
      D = withUi(D, { inst: t });
      if (mode === M_PLAY || mode === M_COMP) { // the next track from its measure 1, at the next measure
        if (mode === M_COMP && run) S = { ...S, cmp: cmpInit(S, D, 'inst') };
        cmds.push(send(aOf()));
      }
      break;
    }
    case 'fill': { const f = intIn(v, ui.fill, 0, 5); if (f !== ui.fill) { D = withUi(D, { fill: f }); if (mode === M_MAN || mode === M_COMP) cmds.push(send(aOf())); } break; }
    case 'bvar': { const b = intIn(v, ui.bvar, 0, 2); if (b !== ui.bvar) { D = withUi(D, { bvar: b }); cmds.push(send(aOf())); } break; }
    case 'ifv': { const b = intIn(v, ui.ifv, 0, 1); if (b !== ui.ifv) { D = withUi(D, { ifv: b }); cmds.push(send('now')); } break; }
    case 'pre': D = withUi(D, { pre: intIn(v, ui.pre, 1, 4) }); break;  // (the scale the next CLEAR latches)
    case 'tempo': case 'fine': { // free: the machine's own tempo; synced: the project's (one gesture = one tempo edit)
      if (x.sync) {
        const k = bpmTempo(S.bpm), c = i.k === 'tempo' ? intIn(v, k.tempo, 0, TEMPO_CLICKS - 1) : k.tempo, f = i.k === 'fine' ? (fin(v) ? v : k.fine) : k.fine;
        cmds.push({ c: 'bpm', v: tempoBpm(c, f) });
      } else {
        D = withUi(D, i.k === 'tempo' ? { tempo: intIn(v, ui.tempo, 0, TEMPO_CLICKS - 1) } : { fine: fin(v) ? Math.round(clamp(v, -0.5, 0.5) * 1e4) / 1e4 + 0 : ui.fine });
        cmds.push(send('now'));
      }
      break;
    }
    case 'sync': { // SYNC on: the song's clock (a free run ends); off: the machine stops until its own START
      const y = !!v;
      if (y === x.sync) break;
      D = withX(D, { sync: y }); S = { ...S, run: false, cmp: null };
      cmds.push(send('now'));
      break;
    }
    case 'swing': { const w = intIn(v, x.swing, SWING_LO, SWING_HI); if (w !== x.swing) { D = withX(D, { swing: w }); cmds.push(send('now')); } break; }
    case 'mute': case 'solo': {
      const l = idx(i.lane, 0, 11);
      if (l < 0) break;
      D = withX(D, { [i.k]: x[i.k] ^ (1 << l) });
      cmds.push(send('now'));
      break;
    }
    case 'rec': D = withX(D, { rec: !!v }); break;
    case 'part': D = withX(D, { part: intIn(v, x.part, 0, 1) }); break;
    case 'grid': { // the step grid (extras): tap toggles a step of the shown pattern, any mode
      const l = idx(i.lane, 0, 11), s = idx(i.s, 0, 31);
      if (l < 0 || s < 0) break;
      D = withBit(D, gridPat(S, D), s, l, -1);
      cmds.push(send('now'));
      break;
    }
    case 'map': { // MAP…: one sound's notes (primary first); the notes leave any other sound
      const s = SOUNDS.indexOf(i.sound);
      if (s < 0 || !Array.isArray(i.notes)) break;
      const want = normMap({ [SOUNDS[s]]: i.notes, ...Object.fromEntries(SOUNDS.filter(q => q !== SOUNDS[s]).map(q => [q, []])) })[SOUNDS[s]];
      const m = {};
      for (const q of SOUNDS) m[q] = q === SOUNDS[s] ? want : D.map[q].filter(t => !want.includes(t));
      D = { ...D, map: normMap(m) };
      cmds.push(send('now'));
      break;
    }
    case 'mapReset': D = { ...D, map: normMap(DEFAULT_MAP) }; cmds.push(send('now')); break;
    case 'smp': { // SOUNDS…: a slot { id, name, on } or null
      const s = SOUNDS.indexOf(i.sound);
      if (s < 0) break;
      const smp = { ...D.smp };
      if (i.slot == null) delete smp[SOUNDS[s]]; else { const e = normSmp({ [SOUNDS[s]]: i.slot })[SOUNDS[s]]; if (!e) break; smp[SOUNDS[s]] = e; }
      D = { ...D, smp: normSmp(smp) };
      cmds.push(send('now'));
      break;
    }
    case 'undo': { // the notice's one-level undo (PATTERN CLEAR, TRACK CLEAR, DEMO)
      const U = S.undo;
      if (!U) break;
      D = { ...D, keys: U.keys, st: U.st, rt: U.rt, rtEnd: U.rtEnd };
      S = { ...S, undo: null };
      cmds.push(send(aOf()));
      break;
    }
    case 'demo': { // DEMO (extras): our own two patterns into basic key 1 A / B and fill 1 A (the host confirms first)
      const text = 'Demo loaded into pattern 1 A / B and fill 1';
      S = { ...S, undo: { text, ...memOf(D) } };
      const st = D.st.slice();
      st[0] = DEMO.a.slice(); st[1] = DEMO.b.slice(); st[N_BASIC * 2] = DEMO.f.slice();
      D = withKey(withKey({ ...D, st }, 0, CLEARED), N_BASIC, CLEARED);
      cmds.push(send(aOf()), { c: 'notice', text: text + ' · tap to undo', undo: true });
      break;
    }
    default: break;
  }
  return done();
}
/** Ticks from a heard step (a {t:'step'} post) to the next one — the host's TAP / REC fraction f = elapsed / this. */
export function stepLen(D, P) {
  if (is606(D)) return stepLen606(D, P);
  const K = P && P.k >= 0 ? D.keys[P.k] : CLEARED, T = STEP_T[K.pre], w = SWUNG[K.pre] ? swingTicks(D.x.swing, T) : 0, s = P ? P.s | 0 : 0;
  if (s >= K.l1 + K.l2 - 1) return T - (s & 1 ? w : 0);                // (the measure's last step: the next is step 1 on the beat)
  return s & 1 ? T - w : T + w;
}
/** Whether DEMO's targets (basic key 1 A / B, fill 1 A; 7b: the 606's patterns I-1 and I-2) are empty (else the host
 *  confirms before loading). */
export function demoFree(D) { return (is606(D) ? [0, 1] : [0, 1, N_BASIC * 2]).every(p => D.st[p].every(m => !m)); }

/** The LEDs (§3.3): step[16] 0 off · 1 on · 2 flashing · 3 the playhead over an unset step (lit) · 4 over a set one (dark);
 *  part [1st, 2nd] and vari [A, B] 0 / 1. (7b: a 606's { step, run, grp: [I, II] }, the same codes.) */
export function leds(S, D) {
  if (is606(D)) return leds606(S, D);
  const ui = D.ui, run = running(S, D), P = S.pos, step = new Array(16).fill(0), mode = ui.mode, ek = editKey(ui);
  let part = [0, 0], vari = ui.bvar === 2 ? [0, 1] : [1, 0];
  if (run && P) { part = [P.p ? 0 : 1, P.p ? 1 : 0]; vari = [P.v ? 0 : 1, P.v ? 1 : 0]; }
  if (run && (mode === M_W1 || mode === M_W2)) { // the instrument's steps of the MODE's part, the playhead inverted
    const q = mode === M_W2 ? 1 : 0, K = D.keys[ek], len = q ? K.l2 : K.l1, row = D.st[ek * 2 + editVar(S, D)];
    for (let j = 0; j < 16; j++) step[j] = j < len && (row[q * 16 + j] >> ui.inst) & 1 ? 1 : 0;
    if (P && !P.f && P.k === ek && P.p === q) { const j = P.s - q * 16; if (j >= 0 && j < 16) step[j] = step[j] ? 4 : 3; }
  } else if (run && mode >= M_MAN && P) { // the playing key steady, a pending one flashing
    if (P.k >= 0) step[P.k] = 1;
    if (mode !== M_PLAY && ui.sel !== P.k && !(P.k >= N_BASIC)) step[ui.sel] = 2;
  } else { // stopped: the selected key flashing (and the armed intro's I/F key)
    step[mode <= M_W2 ? ek : ui.sel] = 2;
    if (mode === M_MAN && ui.intro) step[N_BASIC + ui.ifk] = 2;
    if (mode <= M_W2) part = [mode === M_W2 ? 0 : 1, mode === M_W2 ? 1 : 0];
  }
  return { step, part, vari };
}

/* ================================================================ DEMO (§3.6: written for this project) */

// lane rows as 16-character strings, 'x' = a hit (pre-scale 3, 16 steps)
function rows(o) {
  const st = new Array(N_STEP).fill(0);
  for (const [lane, r] of Object.entries(o)) { const l = LANES.indexOf(lane); for (let s = 0; s < r.length; s++) if (r[s] === 'x') st[s] |= 1 << l; }
  return Object.freeze(st);
}
export const DEMO = Object.freeze({
  a: rows({ ac: 'x...x.......x...', bd: 'x.....x...x.....', sd: '....x.......x...', ch: 'x.x.x.x.x.x.x...', oh: '..............x.', cp: '............x...' }),
  b: rows({ ac: '....x.......x..x', bd: 'x..x....x..x....', sd: '....x.......x..x', ch: 'x.x.x.x.x.x.xx..', oh: '..............x.', cb: '......x.......x.', rs: '..........x.....' }),
  f: rows({ ac: 'x.......x...x..x', bd: 'x...............', ht: 'x.x.............', mt: '....x.x.........', lt: '........x.x.....', sd: '............xxxx', cy: 'x...............' }),
});

/* ================================================================ the TR-606's panel (IMPL-7b §3.2–§3.7; lane S6) */

const ZERO6 = Object.freeze(new Array(N_STEP6).fill(0));
const pName6 = p => (p < 16 ? 'I' : 'II') + '-' + ((p & 15) + 1);
const memOf6 = D => ({ m: 'tr606', keys: D.keys, st: D.st, rt: D.rt, tg: D.tg, dc: D.dc, sg: D.sg });
function withArr(D, f, i, v) { if (D[f][i] === v) return D; const a = D[f].slice(); a[i] = v; return { ...D, [f]: a }; }
// bars [a, b] written for track t: a later track whose region they reach ends — its D.C. and segno go (7a's overflow rule)
function endLater(D, a, b, t) { for (let u = t6Of(a); u <= t6Of(b); u++) if (u !== t) { D = withArr(D, 'dc', u, -1); D = withArr(D, 'sg', u, -1); } return D; }
// a 606 session (another machine's — an 808 session under a 606 record — keeps only its transport, position and tempo)
function sess6(S) {
  if (isObj(S) && Array.isArray(S.held)) return S;
  const o = isObj(S) ? S : {};
  return { ...initState('tr606'), run: !!o.run, play: !!o.play, pos: isObj(o.pos) ? o.pos : null, bpm: fin(o.bpm) ? o.bpm : 120 };
}
// the pattern PATTERN WRITE edits: the selection's first, or the one heard in a chain [C]
function edited6(S, D) {
  const ui = D.ui, P = S.pos, p0 = ui.grp * 16 + ui.sel;
  return running(S, D) && P && !P.f && P.k >= p0 && P.k <= p0 + ui.cl ? P.k : p0;
}
// the step a TAP / REC pad writes (7a's TR-08 rule): the heard one, or the next when more than half of it has passed
function nearest6(S, D, f) {
  const P = S.pos;
  if (!P || P.f || !(P.k >= 0)) return null;
  if (!(fin(f) && f >= 0.5)) return { p: P.k, s: P.s };
  const plan = compilePlan(D, D.ui, D.x, S), m = P.m;
  if (!(m >= 0 && m < plan.n) || plan.mKey[m] !== P.k) return null;
  if (P.s + 1 < plan.mOff[m + 1] - plan.mOff[m]) return { p: P.k, s: P.s + 1 };
  const m2 = m + 1 < plan.n ? m + 1 : plan.loopFrom;
  return plan.mKey[m2] < 0 ? null : { p: plan.mKey[m2], s: 0 };
}
// the bar heard (a track mode): TRACK PLAY running, the plan measure's bar; else the pointer
function heardBar6(S, D) {
  const ui = D.ui, P = S.pos;
  if (ui.mode === M6_TP && running(S, D) && P && P.m >= 0) { const L = list606(D, ui, D.x, S); if (P.m < L.bars.length && L.bars[P.m] >= 0) return L.bars[P.m]; }
  return bar6(S, ui.inst);
}

// the 606's state machine (7b §3.3): one row of the table per case; the buttons are held states (down / up), TAP, RUN/STOP
// and PATTERN GROUP act at the press, a key at its down unless a combination needs it held (a chain: the second key's down)
function press606(state, drum, input) {
  let S = sess6(state), D = drum;
  const cmds = [], i = isObj(input) ? input : {}, ui = D.ui, x = D.x, run = running(S, D), mode = ui.mode, t = ui.inst;
  const pat = mode >= M6_PP, aOf = () => (run ? 'bar' : 'now'), n = idx(i.n, 1, 16), v = i.v;
  const done = () => ({ state: S, mem: D, cmds });
  if (S.gfl && (i.down === true || ['start', 'tap', 'grp', 'mode', 'inst', 'transport'].includes(i.k))) S = { ...S, gfl: 0 };
  // a key down (k 0–15): that key, or the chain to a held key of its block (Shift: to the current selection's first) — ≤ 4, one block
  const chain = (k, mate, cur) => {
    const o = mate != null ? mate - 1 : i.shift && cur ? cur.sel : -1;
    return o >= 0 && o !== k && (o >> 2) === (k >> 2) ? { sel: Math.min(o, k), cl: Math.abs(o - k) } : { sel: k, cl: 0 };
  };
  // PATTERN CLEAR (stopped, PATTERN WRITE): the held keys' patterns, steps only — SCALE and LAST STEP kept; the group LED flashes
  const patternClear = ks => {
    const ps = [...new Set(ks)].map(k => ui.grp * 16 + k - 1).sort((a, b) => a - b), nm = ps.map(pName6);
    const text = (ps.length > 1 ? 'Patterns ' + nm.slice(0, -1).join(', ') + ' and ' + nm[nm.length - 1] : 'Pattern ' + nm[0]) + ' cleared';
    S = { ...S, undo: { text, ...memOf6(D) }, gfl: 1 };
    const st = D.st.slice();
    for (const p of ps) st[p] = ZERO6.slice();
    D = { ...D, st };
    cmds.push(send('now'), { c: 'notice', text: text + ' · tap to undo', undo: true });
  };
  const locate = L => clamp(t6Start(t) + L.h + L.u - 1, t6Start(t), t6Max(t)); // (the keypad's bar, clamped to the reach)
  // DEL / INS (FUNCTION + 15 / 16, stopped TRACK WRITE): bar `bar` removed (the rest shift left; a deleted D.C. bar moves the
  // D.C. to the bar before) or duplicated (the rest shift right; a full track drops its last bar) — D.C. and segno follow their bars
  const delIns = del => {
    if (S.loc) S = { ...S, bar: locate(S.loc), loc: null };            // (a locate typed first: that bar)
    const T = track606(D, t), b = bar6(S, t);
    if (T.end < 0 || b > T.end) return;
    const text = 'Bar ' + (b - T.start + 1) + (del ? ' deleted' : ' duplicated'), rt = D.rt.slice();
    let dc = D.dc[t], sg = D.sg[t], last = T.end;
    S = { ...S, undo: { text, ...memOf6(D) } };
    if (del) {
      for (let j = b; j < T.end; j++) rt[j] = rt[j + 1];
      rt[T.end] = -1;
      if (dc >= 0) dc = dc > b ? dc - 1 : dc === b ? (b > T.start ? b - 1 : -1) : dc;
      if (sg >= 0) sg = sg > b ? sg - 1 : sg === b && b === T.end ? (b > T.start ? b - 1 : -1) : sg;
    } else {
      const full = T.end >= T.cap;
      if (!full) last = T.end + 1;
      for (let j = last; j > b; j--) rt[j] = rt[j - 1];
      if (dc >= b && !full) dc++;
      if (sg > b) sg = Math.min(sg + 1, last);
    }
    D = endLater(withArr(withArr({ ...D, rt }, 'dc', t, dc), 'sg', t, sg), b, last, t);
    cmds.push(send('now'), { c: 'notice', text: text + ' · tap to undo', undo: true });
  };
  // TAP, running TRACK WRITE: the key (or chain: a bar each) heard into the track from `bar`, advancing; with D.C. armed the
  // last is the D.C. bar; with segno armed `bar` is marked instead
  const trackTap = () => {
    const mx = t6Max(t), b = bar6(S, t);
    if (S.sgArm) { if (b <= mx) D = withArr(D, 'sg', t, b); S = { ...S, sgArm: false }; return; }
    const w = tw6(S) || (b <= mx && D.rt[b] >= 0 ? { sel: D.rt[b], cl: 0 } : null);
    if (!w || b > mx) return;
    const rt = D.rt.slice();
    let j = b;
    for (let c = 0; c <= w.cl && j <= mx; c++, j++) rt[j] = w.sel + c;
    D = endLater({ ...D, rt }, b, j - 1, t);
    if (S.dcArm) D = withArr(D, 'dc', t, j - 1);
    S = { ...S, bar: j, dcArm: false };
    cmds.push(send('bar'));
  };
  switch (i.k) {
    case 'start': {
      if (!run && mode === M6_TP && track606(D, t).end < 0) break;     // (an empty track: nothing to play)
      if (x.sync) { cmds.push({ c: run ? 'stop' : 'play' }); break; }   // one clock: the project's ▶ (7a §13 answer 1)
      S = { ...S, run: !run, pos: run ? S.pos : null, twSel: null, ds: 0, dcArm: false, sgArm: false, wipe: false };
      cmds.push(send('now'));                                          // (pattern modes from the selection's first; track modes at `bar`)
      break;
    }
    case 'transport': { // the host: the song started / sought / stopped — synced, the plain track and the bar's own pattern again
      const p = !!i.play, was = !!S.play;
      S = { ...S, play: p };
      if (x.sync && (p || was)) {
        const ch = S.ds > 0 || tw6(S) !== null;
        S = { ...S, ds: 0, twSel: null, dcArm: false, sgArm: false, wipe: false, pos: p && !was ? null : S.pos };
        if (ch) cmds.push(send('now'));
      }
      break;
    }
    case 'panic': S = { ...S, run: false, fn: false, clr: false, held: [], wipe: false, loc: null, show: null, ...(x.sync ? null : { twSel: null, ds: 0, dcArm: false, sgArm: false }) }; break;
    case 'release': S = { ...S, fn: false, clr: false, held: [], wipe: false, loc: null, show: null }; break; // (a cancelled hold: nothing done)
    case 'bpm': S = { ...S, bpm: fin(v) ? v : S.bpm }; break;
    case 'heard': { // a step post at its heard time: the LEDs' position; CLEAR held in PATTERN WRITE wipes the step heard
      const P = i.post;
      if (!isObj(P)) break;
      S = { ...S, pos: { s: P.s | 0, m: P.m | 0, k: P.k | 0, v: P.v | 0, p: P.p | 0, o: P.o | 0, M: P.M | 0, f: P.f ? 1 : 0 } };
      const p = idx(P.k, 0, 31), s = idx(P.s, 0, 15);
      if (S.wipe && run && mode === M6_PW && !P.f && p >= 0 && s >= 0) {
        const D2 = withBit(D, p, s, LANES606[t], 0);
        if (D2 !== D) { D = D2; cmds.push(send('now')); }
      }
      break;
    }
    case 'key': {
      if (n < 1) break;
      if (i.down !== true) { if (S.held.includes(n)) S = { ...S, held: S.held.filter(q => q !== n) }; break; }
      const mate = S.held.find(q => q !== n && ((q - 1) >> 2) === ((n - 1) >> 2));
      if (!S.held.includes(n)) S = { ...S, held: [...S.held, n] };
      if (S.fn) { // FUNCTION + key
        if (run && mode === M6_PW) { // LAST STEP of the edited pattern ('bar' when it shortens the bar under the playhead)
          const p = edited6(S, D), old = D.keys[p].l1;
          if (n !== old) { D = withKey(D, p, { l1: n }); cmds.push(send(n < old ? 'bar' : 'now')); }
        } else if (!run && !pat) { // the bar keypad: 1–9, 10 = 0, 11 = 100, 12 = 200 (FUNCTION's release locates); 15 DEL, 16 INS
          if (n <= 12) {
            const L = S.loc || { h: 0, u: 0 };
            S = { ...S, show: null, loc: n >= 11 ? { h: (n - 10) * 100, u: L.u } : { h: L.h, u: (L.u * 10 + n % 10) % 100 } };
          } else if (n >= 15 && mode === M6_TW) delIns(n === 15);
        }
        break;
      }
      if (run && mode === M6_PW) { // the instrument at step n of the edited pattern (past its LAST STEP: nothing)
        const p = edited6(S, D);
        if (n <= D.keys[p].l1) { D = withBit(D, p, n - 1, LANES606[t], -1); cmds.push(send('now')); }
        break;
      }
      if (run && mode === M6_TW) { S = { ...S, twSel: chain(n - 1, mate, tw6(S)) }; cmds.push(send('bar')); break; } // heard from the next bar
      if (!pat || (run && mode !== M6_PP)) break;
      // pattern modes: select (stopped: flashing; running PATTERN PLAY: queued — it starts when the current pattern ends)
      const w = chain(n - 1, mate, ui);
      if (w.sel !== ui.sel || w.cl !== ui.cl) { D = withUi(D, w); cmds.push(send(aOf())); }
      if (S.clr && !run && mode === M6_PW) patternClear([n]);           // (CLEAR held first, then the key)
      break;
    }
    case 'fn': {
      if (i.down === true) {
        if (S.fn) break;
        S = { ...S, fn: true, loc: null, show: null };
        if (run && mode === M6_PW) { // the SCALE switch latched into the edited pattern, at the press
          const p = edited6(S, D);
          if (D.keys[p].sc !== ui.sc) { D = withKey(D, p, { sc: ui.sc }); cmds.push(send('bar')); }
        }
      } else if (S.fn) {
        const L = S.loc;
        S = { ...S, fn: false, loc: null, show: null };
        if (L && !run && !pat) { S = { ...S, bar: locate(L), twSel: null }; cmds.push(send('now')); }
      }
      break;
    }
    case 'clr': {
      if (i.down !== true) { if (S.clr || S.wipe) S = { ...S, clr: false, wipe: false }; break; }
      if (S.clr) break;
      S = { ...S, clr: true };
      if (S.fn) { if (!run && !pat) S = { ...S, show: 'dc', loc: null }; break; } // FUNCTION held wins (review #14): the D.C. bar shown
      if (mode === M6_PW) { if (run) S = { ...S, wipe: true }; else if (S.held.length) patternClear(S.held); }
      else if (!pat && !run) { S = { ...S, bar: t6Start(t), twSel: null }; cmds.push(send('now')); } // BAR RESET
      else if (mode === M6_TW && run) S = { ...S, dcArm: true };        // D.C.: the next TAP's bar is the track's last
      break;
    }
    case 'tap': {
      if (!run) { // stopped TRACK WRITE: the next bar (stepping through the track to check)
        if (mode === M6_TW) { const b = bar6(S, t); if (b < t6Max(t)) { S = { ...S, bar: b + 1, twSel: null }; cmds.push(send('now')); } }
        break;
      }
      if (mode === M6_PW) { // the instrument at the nearest step of the pattern heard
        const w = nearest6(S, D, i.f), p0 = ui.grp * 16 + ui.sel;
        if (w && w.p >= p0 && w.p <= p0 + ui.cl) { D = withBit(D, w.p, w.s, LANES606[t], 1); cmds.push(send('now')); }
      } else if (mode === M6_PP) { S = { ...S, rst: (S.rst | 0) + 1, rstF: fin(i.F) ? i.F : -1 }; cmds.push(send('now')); } // STEP RESET (DrSeq: the next even step; rstF the press's heard frame, review 2 #3)
      else if (mode === M6_TW) trackTap();
      else { // TRACK PLAY: D.S. — from the next bar the track continues at its segno
        const T = track606(D, t), sg = D.sg[t];
        if (T.end >= 0 && sg >= T.start && sg <= T.end) { S = { ...S, ds: (S.ds | 0) + 1 }; cmds.push(send('bar')); }
      }
      break;
    }
    case 'grp': { // PATTERN GROUP: stopped the group (pattern modes: the panel's; TRACK WRITE: the track's); running TRACK WRITE: segno
      if (S.fn) { if (!run && !pat) S = { ...S, show: 'sg', loc: null }; break; } // FUNCTION held wins: the segno bar shown
      if (!run) {
        if (pat) { D = withUi(D, { grp: ui.grp ^ 1 }); cmds.push(send('now')); }
        else if (mode === M6_TW) { D = withArr(D, 'tg', t, D.tg[t] ^ 1); cmds.push(send('now')); }
      } else if (mode === M6_TW) S = { ...S, sgArm: true };
      break;
    }
    case 'mode': { // the rules change at once; the plan at the next measure (PATTERN PLAY ↔ WRITE: the same plan, running on)
      const m = intIn(v, mode, 0, 3);
      if (m === mode) break;
      D = withUi(D, { mode: m });
      S = { ...S, twSel: null, ds: 0, dcArm: false, sgArm: false, wipe: false, loc: null, show: null };
      cmds.push(send(aOf()));
      break;
    }
    case 'inst': { // pattern modes: the instrument written; track modes: the track, from its first bar (running: at the next bar)
      const u = intIn(v, t, 0, 7);
      if (u === t) break;
      D = withUi(D, { inst: u });
      if (!pat) { S = { ...S, bar: t6Start(u), twSel: null, ds: 0, dcArm: false, sgArm: false, loc: null }; cmds.push(send(aOf())); }
      break;
    }
    case 'sc': { const c = intIn(v, ui.sc, 1, 4); if (c !== ui.sc) D = withUi(D, { sc: c }); break; } // (FUNCTION latches it)
    case 'tempo': { // v in BPM (tempo606 of the knob): free the machine's tempo; synced the project's (one gesture = one tempo edit)
      const b = bpm606(v, NaN);
      if (!(b > 0)) break;
      if (x.sync) cmds.push({ c: 'bpm', v: b });
      else if (b !== ui.tempo) { D = withUi(D, { tempo: b }); cmds.push(send('now')); }
      break;
    }
    case 'sync': {
      const y = !!v;
      if (y === x.sync) break;
      D = withX(D, { sync: y }); S = { ...S, run: false, twSel: null, ds: 0, dcArm: false, sgArm: false, wipe: false };
      cmds.push(send('now'));
      break;
    }
    case 'swing': { const w = intIn(v, x.swing, SWING_LO, SWING_HI); if (w !== x.swing) { D = withX(D, { swing: w }); cmds.push(send('now')); } break; }
    case 'mute': case 'solo': {
      const l = idx(i.lane, 0, 11);
      if (l < 0 || !((MASK606 >> l) & 1)) break;
      D = withX(D, { [i.k]: x[i.k] ^ (1 << l) });
      cmds.push(send('now'));
      break;
    }
    case 'rec': D = withX(D, { rec: !!v }); break;
    case 'grid': {
      const l = idx(i.lane, 0, 11), s = idx(i.s, 0, 15);
      if (l < 0 || s < 0 || !((MASK606 >> l) & 1)) break;
      D = withBit(D, gridPat606(S, D), s, l, -1);
      cmds.push(send('now'));
      break;
    }
    case 'pad': { // REC: a pad writes its lane at the nearest step while PATTERN WRITE runs
      const s = idx(i.sound, 0, 15);
      if (!(x.rec && run && mode === M6_PW && SIDS606.includes(s))) break;
      const w = nearest6(S, D, i.f), p0 = ui.grp * 16 + ui.sel;
      if (w && w.p >= p0 && w.p <= p0 + ui.cl) {
        D = withBit(D, w.p, w.s, SOUND_LANE[s], 1);
        if (fin(v) && v >= 1) D = withBit(D, w.p, w.s, 0, 1); // (review 1 #5: a hit heard at full accent — the AC pad held — writes AC too)
        cmds.push(send('now'));
      }
      break;
    }
    case 'map': { // MAP…: one of its seven sounds' notes (primary first); the notes leave any other sound
      const s = SOUNDS.indexOf(i.sound);
      if (s < 0 || !HAS606.has(SOUNDS[s]) || !Array.isArray(i.notes)) break;
      const want = normMap({ ...Object.fromEntries(SOUNDS.map(q => [q, []])), [SOUNDS[s]]: i.notes }, 'tr606')[SOUNDS[s]];
      const m = {};
      for (const q of SOUNDS) m[q] = q === SOUNDS[s] ? want : (D.map[q] || []).filter(k => !want.includes(k));
      D = { ...D, map: normMap(m, 'tr606') };
      cmds.push(send('now'));
      break;
    }
    case 'mapReset': D = { ...D, map: normMap(MAP606, 'tr606') }; cmds.push(send('now')); break;
    case 'smp': { // SOUNDS…: a slot of its seven { id, name, on } or null
      const s = SOUNDS.indexOf(i.sound);
      if (s < 0 || !HAS606.has(SOUNDS[s])) break;
      const smp = { ...D.smp };
      if (i.slot == null) delete smp[SOUNDS[s]]; else { const e = normSmp({ [SOUNDS[s]]: i.slot }, 'tr606')[SOUNDS[s]]; if (!e) break; smp[SOUNDS[s]] = e; }
      D = { ...D, smp: normSmp(smp, 'tr606') };
      cmds.push(send('now'));
      break;
    }
    case 'undo': { // the notice's one-level undo (PATTERN CLEAR, DEL / INS, DEMO: its selection too)
      const U = S.undo;
      if (!U || U.m !== 'tr606') break;
      D = { ...D, keys: U.keys, st: U.st, rt: U.rt, tg: U.tg, dc: U.dc, sg: U.sg, ...(U.ui ? { ui: U.ui } : null) };
      S = { ...S, undo: null };
      cmds.push(send(aOf()));
      break;
    }
    case 'demo': { // DEMO (extras): our own two patterns into I-1 and I-2, chained 1–2 in PATTERN PLAY (the host confirms first)
      const text = 'Demo loaded into patterns I-1 and I-2';
      S = { ...S, undo: { text, ...memOf6(D), ui: D.ui } };
      const st = D.st.slice();
      st[0] = DEMO606.a.slice(); st[1] = DEMO606.b.slice();
      D = withUi(withKey(withKey({ ...D, st }, 0, CLEARED6), 1, CLEARED6), { mode: M6_PP, grp: 0, sel: 0, cl: 1 });
      if (mode !== M6_PP) S = { ...S, twSel: null, ds: 0, dcArm: false, sgArm: false, wipe: false };
      cmds.push(send(aOf()), { c: 'notice', text: text + ' · tap to undo', undo: true });
      break;
    }
    case 'link303': cmds.push({ c: 'link303', s: swing303(x.swing) }); break; // SYNC 303s (§3.8): the host switches them
    default: break;
  }
  return done();
}

// the 606's grid pattern (0–31): PATTERN WRITE's edited one; running, the one heard; else the selection's / the bar's
function gridPat606(S, D) {
  S = sess6(S);
  const ui = D.ui, P = S.pos, t = ui.inst;
  if (ui.mode === M6_PW) return edited6(S, D);
  if (running(S, D) && P && !P.f && P.k >= 0 && P.k < N_PAT6) return P.k;
  if (ui.mode < M6_PP) { const b = bar6(S, t), k = b <= t6Max(t) ? D.rt[b] : -1; return D.tg[t] * 16 + (k >= 0 ? k : ui.sel); }
  return ui.grp * 16 + ui.sel;
}
// ticks from a heard step to the next (TAP's fraction): its pattern's SCALE, swing on 16ths / 32nds, the last step to the bar
function stepLen606(D, P) {
  const K = P && P.k >= 0 && P.k < N_PAT6 ? D.keys[P.k] : CLEARED6, c = SC_CODE[K.sc], T = STEP_T[c], s = P ? P.s | 0 : 0;
  const w = SWUNG[c] ? swingTicks(D.x.swing, T) : 0;
  if (s >= K.l1 - 1) return T - (s & 1 ? w : 0);
  return s & 1 ? T - w : T + w;
}
// a bar number on the step LEDs (§3.6, TR06's code): hundreds as key 11 / 12 and the tens steady, the units flashing; a
// units digit equal to the tens alternates with the beat (alt 1: flashing — stopped there is no beat)
function barLeds(step, num, alt) {
  const h = Math.floor(num / 100), te = Math.floor(num / 10) % 10, u = num % 10, key = d => (d ? d - 1 : 9);
  if (h) step[h === 1 ? 10 : 11] = 1;
  if (num >= 10) step[key(te)] = 1;
  step[key(u)] = num >= 10 && te === u && !alt ? 1 : 2;
}
// the 606's LEDs (7b §3.6): the 808's codes; run the RUN LED; grp the group LEDs (code 2: PATTERN CLEAR's flash)
function leds606(S, D) {
  S = sess6(S);
  const ui = D.ui, run = running(S, D), P = S.pos, mode = ui.mode, t = ui.inst, pat = mode >= M6_PP, step = new Array(16).fill(0);
  const g = pat ? ui.grp : D.tg[t], grp = [g ? 0 : 1, g ? 1 : 0];
  if (S.gfl) grp[g] = 2;
  if (S.fn && run && mode === M6_PW) { // FUNCTION held: the first step of each beat at the pattern's scale (scale 1: 1 5 9 13)
    const b = SPB[SC_CODE[D.keys[edited6(S, D)].sc]];
    for (let j = 0; j < 16; j += b) step[j] = 1;
  } else if (S.fn && !pat) { // a track mode, FUNCTION held: the bar typed, the D.C. / segno bar (stopped), else the bar heard
    const T = track606(D, t), L = S.loc;
    const b = L ? -1 : !run && S.show === 'dc' ? D.dc[t] : !run && S.show === 'sg' ? D.sg[t] : run ? heardBar6(S, D) : bar6(S, t);
    const num = L ? L.h + L.u : b >= 0 ? b - T.start + 1 : -1;
    if (num >= 0) barLeds(step, num, run && P ? Math.floor((P.o | 0) / BEAT) & 1 : 1);
  } else if (run && (mode === M6_PP || mode === M6_TP)) { if (P && P.s >= 0 && P.s < 16) step[P.s] = 1; } // the chase
  else if (run && mode === M6_PW) { // the instrument's steps of the pattern edited, the playhead inverted
    const p = edited6(S, D), K = D.keys[p], row = D.st[p], l = LANES606[t];
    for (let j = 0; j < 16; j++) step[j] = j < K.l1 && (row[j] >> l) & 1 ? 1 : 0;
    if (P && !P.f && P.k === p && P.s >= 0 && P.s < 16) step[P.s] = step[P.s] ? 4 : 3;
  } else if (run) { // TRACK WRITE: the key heard steady, the key / chain to be written flashing [C]
    if (P && P.k >= 0) step[P.k & 15] = 1;
    const w = tw6(S);
    if (w) for (let k = w.sel; k <= w.sel + w.cl; k++) if (!step[k]) step[k] = 2;
  } else if (pat) { step[ui.sel] = 2; for (let k = 1; k <= ui.cl; k++) step[ui.sel + k] = 1; } // the selection: first flashing, the chain steady
  else { const b = bar6(S, t), k = b <= t6Max(t) ? D.rt[b] : -1; if (k >= 0) step[k] = 2; } // a track stopped: the bar's key flashing [C]
  return { step, run: run ? 1 : 0, grp };
}

/* ================================================================ DEMO606 (7b §3.7: written for this project) */

// lane rows as 16-character strings, 'x' = a hit (SCALE 1, 16 steps): I-1 a groove under the TB-303's default line (its
// accents on 1, 5, 9, 13 and 16), I-2 its variation with the toms and the cymbal
function rows6(o) {
  const st = new Array(N_STEP6).fill(0);
  for (const [lane, r] of Object.entries(o)) { const l = LANES.indexOf(lane); for (let s = 0; s < r.length; s++) if (r[s] === 'x') st[s] |= 1 << l; }
  return Object.freeze(st);
}
export const DEMO606 = Object.freeze({
  a: rows6({ ac: 'x...x...x...x..x', bd: 'x...x...x...x...', sd: '....x.......x...', ch: 'xx.xxx.xxx.xxx.x', oh: '..x...x...x...x.' }),
  b: rows6({ ac: 'x...x...x...x.xx', bd: 'x...x...x..xx...', sd: '....x.......x.xx', lt: '..........x..x..', ht: '.........x......', ch: 'xx.xxx.xx.......', oh: '..x...x.........', cy: 'x...............' }),
});
