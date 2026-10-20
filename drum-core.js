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

// the 808's personality in one table (§1.1: a 606 / 909 is a second table, not a fork)
export const PERS = deepFreeze({
  tr808: {
    id: 'tr808', lanes: LANES, sounds: SOUNDS, names: SOUND_NAMES, laneSound: LANE_SOUND, laneSw: LANE_SW, map: DEFAULT_MAP,
    keys: N_KEYS, basic: N_BASIC, partSteps: 16, parts: 2, stepT: STEP_T, spb: SPB, swung: SWUNG, preDefault: 3,
    modes: MODES, fills: FILLS, bvar: ['A', 'AB', 'B'], ifv: ['A', 'B'], tracks: N_TRACKS, trackLen: TRACK_LEN,
    tempo: { lo: TEMPO_LO, hi: TEMPO_HI, clicks: TEMPO_CLICKS }, swing: { lo: SWING_LO, hi: SWING_HI }, cleared: CLEARED,
    choke: { by: 11, of: 10 },                                         // a CH (lane 11) trigger chokes OH (lane 10)
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

/** The 128-entry note → sound table of a map (−1 = none): the payload's `map`, = Inst.noteOn's lookup (§1.4). */
export function mapTable(map) {
  const m = normMap(map), t = new Int8Array(128).fill(-1);
  for (let s = 0; s < 16; s++) for (const n of m[SOUNDS[s]]) t[n] = s;
  return t;
}
/** sound → its primary note (−1: unmapped). */
export function primaries(map) {
  const m = normMap(map), p = new Int8Array(16).fill(-1);
  for (let s = 0; s < 16; s++) if (m[SOUNDS[s]].length) p[s] = m[SOUNDS[s]][0];
  return p;
}
/** The roll's drum rows (§4.2): the mapped primaries in the map's order (kick first = the bottom row), { n, s, name }. */
export function drumRows(map) {
  const p = primaries(map), out = [];
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

/* ================================================================ normDrum (§6) */

function normMap(map) {
  const out = {}, used = new Set();
  const src = isObj(map) ? map : DEFAULT_MAP;
  for (const s of SOUNDS) {
    const a = Object.prototype.hasOwnProperty.call(src, s) ? src[s] : DEFAULT_MAP[s], l = [];
    if (Array.isArray(a)) for (let i = 0; i < a.length && l.length < 8; i++) {
      const n = a[i];
      if (fin(n) && n === Math.floor(n) && n >= 0 && n <= 127 && !used.has(n)) { used.add(n); l.push(n); } // (later duplicates dropped)
    }
    out[s] = l;
  }
  return out;
}
const SMP_ID = /^smp:[0-9a-f]{16}$/;
function normSmp(o) {
  const out = {};
  if (!isObj(o)) return out;
  for (const s of SOUNDS) {
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
/** dev.drum normalised: exact lengths, every value in range, unknown fields dropped; idempotent; never throws. */
export function normDrum(d) {
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
/** The explicit cyclic list of measures the machine plays (§3.4); pure, deterministic, memoised. */
export function compilePlan(mem, ui, x) {
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
/** The drum {t:'seq'} payload: the plan + the clock + the tables the Inst reads (§3.5); pk = its content key (not `at`). */
export function payload(drum, state, at = 'now') {
  const S = state || initState(), x = drum.x, ui = drum.ui;
  const plan = compilePlan(drum, ui, x), map = mapTable(drum.map), prim = primaries(drum.map), smp = slots(drum.smp);
  const s = { plan, sync: x.sync, run: !x.sync && !!S.run, bpm: tempoBpm(ui.tempo, ui.fine), swing: x.swing, at, tap: S.tap | 0,
    map, prim, mute: soundMute(x), smp };
  let h = fnvNum(0x811c9dc5 | 0, s.sync ? 1 : 0); h = fnvNum(h, s.run ? 1 : 0); h = fnvNum(h, Math.round(s.bpm * 100));
  h = fnvNum(h, s.swing); h = fnvNum(h, s.tap); h = fnvNum(h, s.mute); h = fnvArr(h, map); h = fnvArr(h, prim);
  if (smp) for (const e of smp) { if (!e) { h = fnvNum(h, 0); continue; } for (let i = 0; i < e.id.length; i++) h = fnvNum(h, e.id.charCodeAt(i)); h = fnvNum(h, e.on ? 2 : 1); }
  s.pk = plan.key + hex(h);
  return s;
}

/* ================================================================ the panel's state machine (§3.3) */

/** A fresh session: never saved (§3.2). pos: the last {t:'step'} heard; cmp: the COMPOSE recording; undo: one level. */
export function initState() { return { run: false, play: false, tap: 0, undo: null, pos: null, cmp: null, bpm: 120 }; }
export const running = (S, D) => (D.x.sync ? !!S.play : !!S.run);
// the variation a write mode edits: the I/F VARIATION for a fill; A / B; AB: the one heard (else A)
function editVar(S, D) {
  const ui = D.ui, ek = editKey(ui), P = S.pos;
  if (ek >= N_BASIC) return ui.ifv;
  if (ui.bvar !== 1) return ui.bvar === 2 ? 1 : 0;
  return running(S, D) && P && P.k === ek && !P.f ? P.v & 1 : 0;
}
/** The pattern (key · 2 + var) the step grid shows and edits (§3.6): the edited one, or the one heard / selected. */
export function gridPat(S, D) {
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

/** The panel's pure state machine (§3.3): (session, dev.drum, input) → { state, mem, cmds }. */
export function press(state, drum, input) {
  let S = state || initState(), D = drum;
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
  const K = P && P.k >= 0 ? D.keys[P.k] : CLEARED, T = STEP_T[K.pre], w = SWUNG[K.pre] ? swingTicks(D.x.swing, T) : 0, s = P ? P.s | 0 : 0;
  if (s >= K.l1 + K.l2 - 1) return T - (s & 1 ? w : 0);                // (the measure's last step: the next is step 1 on the beat)
  return s & 1 ? T - w : T + w;
}
/** Whether DEMO's targets (basic key 1 A / B, fill 1 A) are empty (else the host confirms before loading). */
export function demoFree(D) { return [0, 1, N_BASIC * 2].every(p => D.st[p].every(m => !m)); }

/** The LEDs (§3.3): step[16] 0 off · 1 on · 2 flashing · 3 the playhead over an unset step (lit) · 4 over a set one (dark);
 *  part [1st, 2nd] and vari [A, B] 0 / 1. */
export function leds(S, D) {
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
