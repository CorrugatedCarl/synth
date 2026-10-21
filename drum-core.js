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
 *
 * 7c (IMPL-7c §3, §4; lane S9): a third personality, the TR-909 ('tr909' only for the exact string; the 808's and the 606's
 * records, sessions, payloads, plans, pk and notes byte-identical — their pins). The name tables live in PERS (sounds / names
 * by sound id; the 909's ids 7 / 8 its ride 'rd' / crash 'cr'): mapTable / primaries / drumRows / normMap / the slots read
 * PERS[model]. Its record:
 *   { v: 1, m: 'tr909', keys: [96 × { sc 1–4, l1 1–16, sh 1–7, fl 9–16, ch 0 | 1 }], st / ac / fm: [96 × [16 masks]] (pattern p =
 *     bank · 48 + group · 16 + key; ac & 0x83E & st, fm & 0x03E & st), tk: [8 × [measures 0–47]] (track t = bank · 4 + trk; per
 *     bank Σ ≤ 896), tt: [8 × 0 | 37–290], ui: { mode 0 PATTERN PLAY · 1 PATTERN WRITE · 2 TRACK PLAY · 3 TRACK WRITE, wm 0 STEP ·
 *     1 TAP, bank, grp, sel, bl (block play sel … sel + bl), inst (a lane, 0 TOTAL ACCENT), fw (flam write), trk, cyc, guide,
 *     tempo (whole BPM) }, x: { sync, mute, solo, rec }, map, smp }
 *   Its session (initState('tr909')): m, run, play, pos, undo, bpm, hold { shift isel clear last shuf tkey avail }, keys (the
 *   step keys held), dig, ptr, loc, pend, disp, erase, op, pg, tw, hits, cont, from, end (sess9's comment). Its inputs: { k:
 *   'hold', b, down } (b: shift · isel · clear · last · shuf · tkey · avail), { k: 'tap', b, n, held, keys } (b: start · stop ·
 *   scale · trk n 1–4 · pat n 1–3 · back · fwd · cyc · enter; review 2 F1 / F2: held { <b>: true } the holds at the tap's own
 *   press — Alt / Shift as shift on a desktop — OR'd in, keys the step keys held then), { k: 'key', n, down, shift, f } (f: TAP write's fraction of the heard step, as the 808's TAP),
 *   { k: 'tempo', v } (BPM, the knob through tempo909(u)), start (the host's START / STOP toggle), release, the extras (sync mute
 *   solo rec grid (+ flam: true) pad map mapReset smp undo demo, lanes & 0xFFF) and the host notifications (transport heard bpm
 *   panic) — 'bpm' sends when a synced plan's flams move (review #1), 'heard' the TAP erase and a free CYCLE-off track's end.
 *   Its commands add { c: 'hit', sound, v } / { c: 'hit', sound, off: true } (a TAP-write key played through the host's note
 *   path). leds → { step[16] 0–5 (5 dim), scl[4], trk[4], pat[3], tkey, back, fwd, avail, cyc, enter, disp (3 characters) }.
 *   Its plan adds ac / fl / mSh / mFl / once / guide (DrSeq's §3.5); rollPlan(D, bpm) / rollOpts(D, dev) feed toNotes for every
 *   machine ("→ Piano roll"); vel9 / vTrig9 the velocity law (the lead's P-1: 100 / 110 / 119 / 127 fixed per state).
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
// (= DrSeq) a plan's bounds — 7c §3.4: a 909 track of 896 measures + a 896 pre-roll + 1 (7a's were 769 / 24 576: the 808's and
// the 606's plans never reach either)
export const MAX_MEAS = 1793, MAX_STEPS = 28688;
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

/* ================================================================ constants (PERS.tr909; IMPL-7c §1.2, §1.3, §3.1, §4) */

// the 909 in the 808's space (7c §1.2): its INSTRUMENT positions AC BD SD LT MT HT RS HC CH OH CR RD on the 808's lane bits,
// its eleven sounds by the 808's sound ids — but ids 7 / 8 are its ride / crash (the 808's cowbell / cymbal slots, which it
// lacks); ids 11–15 keep the 808's keys and names, inert as the 606's absent sounds (never a slot, a row or a sid: review #12)
export const LANES909 = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 11, 10, 9, 8]);
export const CODES909 = Object.freeze(['AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'HC', 'CH', 'OH', 'CR', 'RD']);
export const ROWS909 = Object.freeze(['Accent', 'Kick', 'Snare', 'Low tom', 'Mid tom', 'Hi tom', 'Rim shot', 'Hand clap', 'Closed hat', 'Open hat', 'Crash', 'Ride']);
export const SOUNDS909 = Object.freeze(['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'rd', 'cr', 'oh', 'ch', 'lc', 'mc', 'hc', 'cl', 'ma']);
export const NAMES909 = Object.freeze(['Kick', 'Snare', 'Low tom', 'Mid tom', 'Hi tom', 'Rim shot', 'Hand clap', 'Ride', 'Crash', 'Open hat', 'Closed hat',
  'Low conga', 'Mid conga', 'Hi conga', 'Claves', 'Maracas']);
export const SIDS909 = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const MASK909 = 0xFFF, AC909 = 0x83E, FL909 = 0x03E;           // its lanes; per-voice accent BD SD LT MT HT CH; flam BD … HT (= DrSeq)
export const M9_PP = 0, M9_PW = 1, M9_TP = 2, M9_TW = 3;               // PATTERN PLAY · WRITE · TRACK PLAY · WRITE (ui.mode)
export const MODES909 = Object.freeze(['PATTERN PLAY', 'PATTERN WRITE', 'TRACK PLAY', 'TRACK WRITE']);
export const N_PAT9 = 96, N_STEP9 = 16, N_TRACKS9 = 8, BANK_MEAS = 896; // 2 banks × 3 groups × 16; 4 tracks a bank sharing 896 measures
export const CLEARED9 = Object.freeze({ sc: 1, l1: 16, sh: 1, fl: 9, ch: 0 });
export const TEMPO9_LO = 37, TEMPO9_HI = 290;                          // whole BPM (the display's)
// (the lead's P-1) one fixed velocity per accent state — normal, per-voice accent, total accent, both — never ranked by the
// TOTAL ACCENT knob: a written note names its state at any knob position or cable (a voice without per-voice accent: 100 / 127)
export const VEL9 = Object.freeze([100, 110, 119, 127]);              // (= DrSeq)
// the accent DAC's codes (§1.3: normal N0, + L per-voice, + round(TMAX · u) total, both ≤ 63) — the machine's law, copied (its
// fit is V9's, Dr808.proto.tr909.ACC9: aligned at the phase-0 merge, a test keeps them equal)
export const ACC9 = Object.freeze({ N0: 21, L: 11, TMAX: 22 });
// the 909's own receive notes = the GM numbers (§1.4), + GM's crash 2 (57) and ride 2 (59) as aliases
export const MAP909 = deepFreeze({ bd: [36, 35], sd: [38, 40], lt: [41, 43], mt: [45, 47], ht: [48, 50], rs: [37], cp: [39], rd: [51, 59], cr: [49, 57],
  oh: [46], ch: [42, 44] });
const HAS909 = new Set(Object.keys(MAP909));
// a step key → the INSTRUMENT SELECT / TAP voice (lane): 1 / 2 BD … 9 / 10 HT, 11 RS, 12 HC, 13 / 14 CH, 15 CRASH, 16 RIDE (the
// left key of a pair the accented one); its pair's other key (0: none); 13 + 14 together the open hat
const KEY_LANE9 = Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 11, 11, 9, 8]);
const keyAcc9 = n => (n <= 10 ? n & 1 : n === 13 ? 1 : 0), keyMate9 = n => (n <= 10 ? (n & 1 ? n + 1 : n - 1) : n === 13 ? 14 : n === 14 ? 13 : 0);

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
  // (7c) acLanes / flLanes: the lanes with a per-voice accent / a flam; keyLane: a step key's voice; vel: the states' velocities
  tr909: {
    id: 'tr909', lanes: LANES909, codes: CODES909, rows: ROWS909, sids: SIDS909, mask: MASK909, acLanes: AC909, flLanes: FL909,
    sounds: SOUNDS909, names: NAMES909, laneSound: LANE_SOUND, map: MAP909, keys: 16, banks: 2, groups: 3, patterns: N_PAT9,
    steps: N_STEP9, tracks: N_TRACKS9, bankMeas: BANK_MEAS, scCode: SC_CODE, stepT: STEP_T, spb: SPB, swung: SWUNG, modes: MODES909,
    scales: ['16ths', '32nds', '8th triplets', '16th triplets'], keyLane: KEY_LANE9, tempo: { lo: TEMPO9_LO, hi: TEMPO9_HI },
    cleared: CLEARED9, vel: VEL9, acc: ACC9,
  },
});
const MAPS = { tr808: [SOUNDS, DEFAULT_MAP, null], tr606: [SOUNDS, MAP606, HAS606], tr909: [SOUNDS909, MAP909, HAS909] }; // sounds, default map, the sounds it has
// a machine id (7c: three-way — 'tr606' / 'tr909' only for the exact string, anything else the 808)
const mach = m => (m === 'tr606' ? 'tr606' : m === 'tr909' ? 'tr909' : 'tr808');

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
 *  machine whose sounds the map holds (7b: 'tr606' — its seven; 7c: 'tr909' — its eleven, by its own keys (rd / cr on ids 7 /
 *  8); else the 808's sixteen, a sound the map lacks at its default). The keys and names are PERS[model].sounds / .names. */
export function mapTable(map, model) {
  const K = PERS[mach(model)].sounds, m = normMap(map, model), t = new Int8Array(128).fill(-1);
  for (let s = 0; s < 16; s++) for (const n of m[K[s]]) t[n] = s;
  return t;
}
/** sound → its primary note (−1: unmapped); 16 by sound id for every machine. */
export function primaries(map, model) {
  const K = PERS[mach(model)].sounds, m = normMap(map, model), p = new Int8Array(16).fill(-1);
  for (let s = 0; s < 16; s++) if (m[K[s]].length) p[s] = m[K[s]][0];
  return p;
}
/** The roll's drum rows (§4.2): the mapped primaries in the map's order (kick first = the bottom row), { n, s, name }. */
export function drumRows(map, model) {
  const N = PERS[mach(model)].names, p = primaries(map, model), out = [];
  for (let s = 0; s < 16; s++) if (p[s] >= 0) out.push({ n: p[s], s, name: N[s] });
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
/** The 909's TEMPO (7c §3.1): the knob's travel u 0…1 → whole BPM on a log law, round(37 · (290 / 37)^u) (37–290). */
export function tempo909(u) { return fin(u) ? Math.round(TEMPO9_LO * Math.pow(TEMPO9_HI / TEMPO9_LO, clamp(u, 0, 1))) + 0 : 120; }
/** …and back: BPM → the knob's travel 0…1. */
export function tempo909Pos(bpm) { return Math.log(clamp(fin(bpm) ? bpm : 120, TEMPO9_LO, TEMPO9_HI) / TEMPO9_LO) / Math.log(TEMPO9_HI / TEMPO9_LO) + 0; }
const bpm909 = (v, d) => (fin(v) ? Math.round(clamp(v, TEMPO9_LO, TEMPO9_HI)) + 0 : d);
const acc9 = s => (AC909 >> SOUND_LANE[s]) & 1;                         // a sound with a per-voice accent (BD SD LT MT HT CH)
/** (7c §1.3, the lead's P-1) A 909 hit's velocity by its state (0 normal · 1 per-voice accent · 2 total · 3 both): 100 / 110 /
 *  119 / 127, fixed — a voice without per-voice accent 100 / 127 (its per-voice state is normal, both its total). u (TOTAL
 *  ACCENT) is not read: the law never ranks by the knob. */
export function vel9(sound, state, u) {
  const q = (state | 0) & 3, s = idx(sound, 0, 15);
  return VEL9[s >= 0 && acc9(s) ? q : q & 2 ? 3 : 0];
}
/** …and the machine's inverse (V9's, copied: a test compares): velocity (1–127) → the accent DAC code at TOTAL ACCENT u 0…1 —
 *  the four states' codes at 100 / 110 / 119 / 127 (on every voice: one without per-voice accent has normal = per-voice and total = both), piecewise between them rounded to the
 *  DAC's integer (non-monotone between 110 and 119 only while T(u) < L); below 100 ghosts round(N0 · (0.6 + 0.4 (v − 1) / 99)). */
export function vTrig9(v127, sound, u) {
  const v = fin(v127) ? clamp(v127, 1, 127) : 100, a = fin(u) ? clamp(u, 0, 1) : 0.5, { N0, L, TMAX } = ACC9, T = Math.round(TMAX * a);
  if (v < 100) return Math.round(N0 * (0.6 + 0.4 * (v - 1) / 99));
  const s = idx(sound, 0, 15), pv = s >= 0 && acc9(s), c2 = pv ? N0 + L : N0, c3 = N0 + T, c4 = pv ? Math.min(63, N0 + L + T) : c3;
  // (the machine's law, the lead at the phase-0 merge: 100 / 110 / 119 / 127 name the same four states on every voice — one
  //  without per-voice accent reads 110 as normal and 119 as total — piecewise between them, rounded to the DAC's integer)
  return Math.round(v <= 110 ? N0 + (c2 - N0) * (v - 100) / 10 : v <= 119 ? c2 + (c3 - c2) * (v - 110) / 9 : c3 + (c4 - c3) * (v - 119) / 8) + 0;
}
/** A machine's own (free) tempo in BPM: the 808's TEMPO + FINE, the 606's and the 909's TEMPO. */
export function freeBpm(D) { return is606(D) || is909(D) ? D.ui.tempo : tempoBpm(D.ui.tempo, D.ui.fine); }
/** (7b review 1 #4, the lead's decision) The record with its own TEMPO (the 808: TEMPO + FINE) showing `bpm` (40–300) — "→
 *  Piano roll" leaves the machine SYNC off at the project's tempo, so its stopped clock (the 606's open hat's cut after ■)
 *  reads what the synced pattern's read (D5 at a stop too); the same record when it already shows it (or bpm is no number).
 *  (7c: the 909's whole BPM, 37–290.) */
export function withTempo(D, bpm) {
  if (!fin(bpm)) return D;
  if (is606(D)) { const b = bpm606(bpm, D.ui.tempo); return b === D.ui.tempo ? D : { ...D, ui: { ...D.ui, tempo: b } }; }
  if (is909(D)) { const b = bpm909(bpm, D.ui.tempo); return b === D.ui.tempo ? D : { ...D, ui: { ...D.ui, tempo: b } }; }
  const k = bpmTempo(bpm);
  return k.tempo === D.ui.tempo && k.fine === D.ui.fine ? D : { ...D, ui: { ...D.ui, tempo: k.tempo, fine: k.fine } };
}

/* ================================================================ normDrum (§6) */

// the map of a machine's sounds (7b: the 606's keeps its seven sounds and maps none of the others — every key present, so
// a reader without the model never fills the 808's defaults in; 7c: the 909's its eleven, by its own keys — rd / cr for ids
// 7 / 8 —, the five it lacks (the 808's keys 11–15) present and empty)
function normMap(map, model) {
  const [sounds, def, has] = MAPS[mach(model)], out = {}, used = new Set();
  const src = isObj(map) ? map : def;
  for (const s of sounds) {
    if (has && !has.has(s)) { out[s] = []; continue; }
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
  const out = {}, [sounds, , has] = MAPS[mach(model)];
  if (!isObj(o)) return out;
  for (const s of sounds) {
    if (has && !has.has(s)) continue;                                  // (7b: only the 606's seven slots; 7c: the 909's eleven)
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
 *  (7b §3.1): `model`, else the record's own `m` — 'tr606' the 606's record, 'tr909' the 909's (7c); absent, unknown or
 *  hostile the 808's, exactly 7a's (so a caller that forgets the model never turns a 606 / 909 record into an 808's). */
export function normDrum(d, model) {
  const M = machineOf(d, model);
  if (M === 'tr606') return norm606(d);
  if (M === 'tr909') return norm909(d);
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
  return mach(m);
}
function is606(D) { try { return isObj(D) && D.m === 'tr606'; } catch (e) { return false; } }
function is909(D) { try { return isObj(D) && D.m === 'tr909'; } catch (e) { return false; } }

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
  if (is909(mem)) return plan909(mem, ui, x, S);                       // (7c: likewise)
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
  if (plan.mSh) return notes909(plan, opts);                           // (7c: a 909 plan — its shuffle, flams and accents)
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

function slots(smp, sounds = SOUNDS) {
  let any = false;
  const a = sounds.map(s => (smp && smp[s] ? (any = true, { id: smp[s].id, on: !!smp[s].on }) : null));
  return any ? a : null;
}
/** The drum {t:'seq'} payload: the plan + the clock + the tables the Inst reads (§3.5); pk = its content key (not `at`).
 *  7b: a 606's adds m 'tr606' (the Inst keeps a payload for another machine waiting), rst (STEP RESET's counter) and rstF
 *  (that press's heard frame, −1 none: DrSeq drops a restart the pattern's own measure start already made, review 2 #3), its
 *  bpm is its TEMPO itself; an 808's has none of the three. */
export function payload(drum, state, at = 'now') {
  if (is606(drum)) return payload606(drum, state, at);
  if (is909(drum)) return payload909(drum, state, at);
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
  if (model === 'tr909') return init909();
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
  if (is909(D)) return gridPat909(S, D);
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
  if (is909(drum)) return press909(state, drum, input);
  let S = state || initState(), D = drum;
  if (Array.isArray(S.held) || S.m === 'tr909') S = { ...initState(), run: !!S.run, play: !!S.play, pos: isObj(S.pos) ? S.pos : null, bpm: fin(S.bpm) ? S.bpm : 120 }; // (7b / 7c: a 606 or 909 session under an 808 record — its transport, position and tempo kept)
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
  if (is909(D)) return stepLen909(D, P);
  const K = P && P.k >= 0 ? D.keys[P.k] : CLEARED, T = STEP_T[K.pre], w = SWUNG[K.pre] ? swingTicks(D.x.swing, T) : 0, s = P ? P.s | 0 : 0;
  if (s >= K.l1 + K.l2 - 1) return T - (s & 1 ? w : 0);                // (the measure's last step: the next is step 1 on the beat)
  return s & 1 ? T - w : T + w;
}
/** Whether DEMO's targets (basic key 1 A / B, fill 1 A; 7b: the 606's patterns I-1 and I-2) are empty (else the host
 *  confirms before loading). */
export function demoFree(D) { return (is606(D) || is909(D) ? [0, 1] : [0, 1, N_BASIC * 2]).every(p => D.st[p].every(m => !m)); }

/** The LEDs (§3.3): step[16] 0 off · 1 on · 2 flashing · 3 the playhead over an unset step (lit) · 4 over a set one (dark);
 *  part [1st, 2nd] and vari [A, B] 0 / 1. (7b: a 606's { step, run, grp: [I, II] }, the same codes.) */
export function leds(S, D) {
  if (is606(D)) return leds606(S, D);
  if (is909(D)) return leds909(S, D);
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

/* ================================================================ the TR-909 (IMPL-7c §3, §4; lane S9) */

// its record (§3.1): pattern p = bank · 48 + group · 16 + key (0–95), its keys { sc, l1, sh, fl, ch } and three step rows — st
// (the voices), ac (per-voice accents, & 0x83E & st), fm (flams, & 0x03E & st); track t = bank · 4 + its TRACK key, a list of
// measures (patterns of its bank, 0–47), per bank Σ ≤ 896 (tracks 1 → 4 kept in order, the later ones cut), tt its tempo
function normUi909(u) {
  u = isObj(u) ? u : {};
  const sel = intIn(u.sel, 0, 0, 15), inst = intIn(u.inst, 1, 0, 11);
  return { mode: intIn(u.mode, M9_PP, 0, 3), wm: intIn(u.wm, 0, 0, 1), bank: intIn(u.bank, 0, 0, 1), grp: intIn(u.grp, 0, 0, 2), sel,
    bl: intIn(u.bl, 0, 0, 15 - sel), inst, fw: boolIn(u.fw, false) && ((FL909 >> inst) & 1) === 1, trk: intIn(u.trk, 0, 0, 3),
    cyc: boolIn(u.cyc, true), guide: boolIn(u.guide, false), tempo: bpm909(u.tempo, 120) };
}
function normX909(x) {
  x = isObj(x) ? x : {};
  return { sync: boolIn(x.sync, true), mute: maskIn(x.mute), solo: maskIn(x.solo), rec: boolIn(x.rec, false) };
}
function norm909(d) {
  try {
    d = isObj(d) ? d : {};
    const keys = [], st = [], ac = [], fm = [], tk = [], tt = [];
    for (let p = 0; p < N_PAT9; p++) {
      const e = isObj(at(d.keys, p)) ? d.keys[p] : CLEARED9, a = at(d.st, p), b = at(d.ac, p), f = at(d.fm, p);
      const r = new Array(N_STEP9), ra = new Array(N_STEP9), rf = new Array(N_STEP9);
      for (let s = 0; s < N_STEP9; s++) { const m = maskIn(at(a, s)); r[s] = m; ra[s] = maskIn(at(b, s)) & AC909 & m; rf[s] = maskIn(at(f, s)) & FL909 & m; } // (review #22: a flag on a sounding voice)
      keys.push({ sc: intIn(e.sc, CLEARED9.sc, 1, 4), l1: intIn(e.l1, CLEARED9.l1, 1, N_STEP9), sh: intIn(e.sh, CLEARED9.sh, 1, 7), fl: intIn(e.fl, CLEARED9.fl, 9, 16),
        ch: (p & 15) < 15 ? intIn(e.ch, 0, 0, 1) : 0 });                // (a chain never leaves its group)
      st.push(r); ac.push(ra); fm.push(rf);
    }
    for (let t = 0, room = 0; t < N_TRACKS9; t++) {
      if (!(t & 3)) room = BANK_MEAS;
      const a = at(d.tk, t), n = Array.isArray(a) ? Math.min(a.length, room) : 0, L = new Array(n);
      for (let j = 0; j < n; j++) L[j] = intIn(a[j], 0, 0, 47);
      room -= n; tk.push(L);
      const v = intIn(at(d.tt, t), 0, 0, TEMPO9_HI);
      tt.push(v > 0 ? Math.max(v, TEMPO9_LO) : 0);
    }
    return { v: 1, m: 'tr909', keys, st, ac, fm, tk, tt, ui: normUi909(d.ui), x: normX909(d.x), map: normMap(d.map, 'tr909'), smp: normSmp(d.smp, 'tr909') };
  } catch (e) {
    return norm909(undefined);                                         // (a hostile getter: the defaults)
  }
}

// its session (§3.2; never saved): hold the held keys; keys the step keys held (pairs, blocks, chains, pads); dig SHIFT's digits
// typed; ptr TRACK WRITE's measure pointer (0 … the track's length: appending); loc TRACK PLAY's located measure; pend TRACK
// WRITE's chosen key / range { g, sel, bl } (ENTER writes it); disp 'full' (the bank's 896 reached: "  0" until the next
// press); erase the lanes CLEAR + a voice key erase in TAP write; op a SHIFT sequence awaiting ENTER ({ k: 'del', end } · 'ins' ·
// { k: 'copyT', a } · { k: 'copyP', bank, grp, key } · 'last'); pg a group pressed for the next key; tw the closed hat a TAP key
// wrote while held { n, p, s, on, ac, fm } (13 + 14 take it back, review #19); hits [[key, sound]] the pads sounding; (review 1
// F4) cont a free STOP's position { b: the running plan's located start, sh: its structure } and from the tick STOP/CONT
// continues at (the payload's, until a step is heard); (review 1 F5) end a synced CYCLE-off track past its last step heard
const HOLD0 = Object.freeze({ shift: false, isel: false, clear: false, last: false, shuf: false, tkey: false, avail: false });
function init909() {
  return { m: 'tr909', run: false, play: false, pos: null, undo: null, bpm: 120, hold: HOLD0, keys: [], dig: null, ptr: 0, loc: 0, pend: null,
    disp: null, erase: 0, op: null, pg: -1, tw: null, hits: [], cont: null, from: null, end: false };
}
// a 909 session (another machine's keeps only its transport, position and tempo)
function sess9(S) {
  if (isObj(S) && S.m === 'tr909') return S;
  const o = isObj(S) ? S : {};
  return { ...init909(), run: !!o.run, play: !!o.play, pos: isObj(o.pos) ? o.pos : null, bpm: fin(o.bpm) ? o.bpm : 120 };
}
const trk9 = ui => ui.bank * 4 + ui.trk, ed9 = ui => ui.bank * 48 + ui.grp * 16 + ui.sel;
const used9 = (D, b) => D.tk[b * 4].length + D.tk[b * 4 + 1].length + D.tk[b * 4 + 2].length + D.tk[b * 4 + 3].length;
const ptr9 = (S, D, t) => { const p = S ? S.ptr : 0; return Number.isInteger(p) && p > 0 ? Math.min(p, D.tk[t].length) : 0; };
const loc9 = (S, D, t) => { const p = S ? S.loc : 0; return Number.isInteger(p) && p > 0 && p < D.tk[t].length ? p : 0; };
const pName9 = p => (p < 48 ? 'I' : 'II') + '-' + (((p % 48) >> 4) + 1) + '-' + ((p & 15) + 1);
// the chain a pattern lies in (§3.3: adjacent patterns of one group, `ch` on each but its last) → [first, last]
function chain9(D, p) {
  let a = p, b = p;
  while ((a & 15) > 0 && D.keys[a - 1].ch) a--;
  while ((b & 15) < 15 && D.keys[b].ch) b++;
  return [a, b];
}
// the patterns a selection plays (§3.3, review #18): keys sel … sel + bl of the group at `base` in order, each contributing its
// whole chain once — a key inside a chain selects it from its first, a key inside one already contributed is skipped
function block9(D, base, sel, bl) {
  const out = [];
  for (let k = sel, last = -1; k <= sel + bl && k < 16; k++) {
    if (base + k <= last) continue;
    const [a, b] = chain9(D, base + k);
    for (let q = a; q <= b; q++) out.push(q);
    last = b;
  }
  return out;
}
// TRACK WRITE's pend as bank-relative patterns (0–47; a chain whole, a range as a block), or null
function pend9(S, D, bank) {
  const w = S ? S.pend : null;
  if (!isObj(w) || !(Number.isInteger(w.g) && w.g >= 0 && w.g <= 2 && Number.isInteger(w.sel) && w.sel >= 0 && Number.isInteger(w.bl) && w.bl >= 0 && w.sel + w.bl <= 15)) return null;
  return block9(D, bank * 48 + w.g * 16, w.sel, w.bl).map(p => p - bank * 48);
}
// a pattern's shuffle in whole ticks at 960 PPQ (§3.4): 16ths 20 · (sh − 1) — 2 … 12 / 96 of a beat, the even-numbered step
// late —, 32nds 20 · ⌊(sh − 1) / 2⌋ (our reading of the four settings: 1 = 2, 3 = 4, 5 = 6, 7), the triplet scales none
const sh9 = K => (K.sc === 1 ? 20 * (K.sh - 1) : K.sc === 2 ? 20 * ((K.sh - 1) >> 1) : 0);
// its flam spacing (§3.4): 10 + 4 · (fl − 9) ms of absolute time → whole ticks at the tempo the machine runs at, clamped below
// the measure's smallest step gap (review #2: the second hit always before the lane's next step — one pending slot in DrSeq)
function fl9(K, bpm) {
  const w = sh9(K), g = STEP_T[SC_CODE[K.sc]] - (w > 0 && K.l1 > 1 ? w : 0);
  return Math.min(Math.round((10 + 4 * (K.fl - 9)) * bpm * PPQ / 60000), g - 1);
}
// the measures a 909 mode plays (§3.4): PATTERN PLAY the selection (a pattern, its chain or the block), PATTERN WRITE the edited
// pattern alone, TRACK PLAY the track (free, a located start a pre-roll: loopFrom), TRACK WRITE pend, else the pointer's measure
function list909(mem, ui, x, S, t, w) {
  const base = ui.bank * 48;
  if (ui.mode === M9_PP) return { ps: block9(mem, base + ui.grp * 16, ui.sel, ui.bl), loopFrom: 0 };
  if (ui.mode === M9_PW) return { ps: [base + ui.grp * 16 + ui.sel], loopFrom: 0 };
  const L = mem.tk[t].map(m => base + m);
  if (ui.mode === M9_TW) { const p = ptr9(S, mem, t); return { ps: w ? w.map(m => base + m) : p < L.length ? [L[p]] : [], loopFrom: 0 }; }
  const b = x.sync ? 0 : loc9(S, mem, t);
  return b ? { ps: [...L.slice(b), ...L], loopFrom: L.length - b } : { ps: L, loopFrom: 0 };
}
const ok909 = D => Array.isArray(D.keys) && D.keys.length === N_PAT9 && Array.isArray(D.st) && D.st.length === N_PAT9 && Array.isArray(D.ac)
  && D.ac.length === N_PAT9 && Array.isArray(D.fm) && D.fm.length === N_PAT9 && Array.isArray(D.tk) && D.tk.length === N_TRACKS9 && D.tk.every(Array.isArray);
let memo9 = null;
// the 909's plan (§3.4): the shared format — a measure per pattern (mKey 0–95, mVar 0, mPre its SCALE's step code, mL1 its
// LAST STEP), fill null — and its own: ac / fl (a step's per-voice accents / flams, & st, which is & audible), mSh (a measure's
// shuffle in ticks), mFl (its flam spacing in ticks at the flam tempo fb: synced the session's project tempo, free its TEMPO;
// rollPlan's own), once (TRACK PLAY, CYCLE off: DrSeq silent after its first pass) and guide (TAP write's click: DrSeq's RS on
// the beats); every input in the memo's signature (review #8), all in the key, mSh in the shape too (a shuffle swaps at the bar)
function plan909(mem, ui, x, S, fb) {
  if (!ok909(mem)) mem = normDrum(mem, 'tr909');
  ui = normUi909(ui || mem.ui); x = normX909(x || mem.x);
  const bpm = fin(fb) && fb > 0 ? fb : x.sync ? (S && fin(S.bpm) && S.bpm > 0 ? S.bpm : 120) : ui.tempo;
  const A = audible(x), t = trk9(ui), tw = ui.mode === M9_TW, w = tw ? pend9(S, mem, ui.bank) : null;
  const once = ui.mode === M9_TP && !ui.cyc ? 1 : 0, guide = ui.mode === M9_PW && ui.wm === 1 && ui.guide ? 1 : 0;
  const sig = [ui.mode, ui.bank, ui.grp, ui.sel, ui.bl, ui.trk, once, guide, A, x.sync ? 1 : 0, bpm, ui.mode === M9_TP && !x.sync ? loc9(S, mem, t) : -1,
    tw ? ptr9(S, mem, t) : -1, w ? w.join('.') : '-'].join(',');
  const M = memo9;
  if (M && M.keys === mem.keys && M.st === mem.st && M.ac === mem.ac && M.fm === mem.fm && M.tk === mem.tk && M.sig === sig) return M.plan;
  const { ps, loopFrom } = list909(mem, ui, x, S, t, w), n = ps.length, intro = loopFrom > 0 ? 1 : 0;
  const mKey = new Int8Array(n), mVar = new Int8Array(n), mPre = new Uint8Array(n), mL1 = new Uint8Array(n), mSh = new Uint8Array(n), mFl = new Uint16Array(n);
  const mOff = new Int32Array(n + 1), mT = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const p = ps[i], K = mem.keys[p], c = SC_CODE[K.sc];
    mKey[i] = p; mPre[i] = c; mL1[i] = K.l1; mSh[i] = sh9(K); mFl[i] = fl9(K, bpm);
    mOff[i + 1] = mOff[i] + K.l1;
    mT[i + 1] = mT[i] + K.l1 * STEP_T[c];
  }
  const st = new Uint16Array(mOff[n]), ac = new Uint16Array(mOff[n]), fl = new Uint16Array(mOff[n]);
  for (let i = 0; i < n; i++) {
    const p = mKey[i], r = mem.st[p], ra = mem.ac[p], rf = mem.fm[p];
    let any = 0;
    for (let s = 0, o = mOff[i]; o < mOff[i + 1]; s++, o++) { const m = r[s] & A; st[o] = m; ac[o] = ra[s] & m & AC909; fl[o] = rf[s] & m & FL909; any |= fl[o]; }
    if (!any) mFl[i] = 0;                                              // (a measure without a flam: no spacing — a tempo change leaves its plan alone)
  }
  let h = fnvNum(0x811c9dc5 | 0, n); h = fnvNum(h, intro); h = fnvNum(h, loopFrom);
  h = fnvArr(h, mPre); h = fnvArr(h, mL1); h = fnvArr(h, mOff); h = fnvArr(h, mSh);
  const shape = hex(h);
  h = fnvArr(h, mKey); h = fnvArr(h, mVar); h = fnvArr(h, st); h = fnvNum(h, -1);
  h = fnvArr(h, ac); h = fnvArr(h, fl); h = fnvArr(h, mFl); h = fnvNum(h, once); h = fnvNum(h, guide);
  const plan = { key: hex(h), shape, n, intro, loopFrom, mKey, mVar, mPre, mL1, mOff, mT, st, fill: null, ac, fl, mSh, mFl, once, guide };
  memo9 = { keys: mem.keys, st: mem.st, ac: mem.ac, fm: mem.fm, tk: mem.tk, sig, plan };
  return plan;
}
// → Piano roll of a 909 plan (§4): each hit at the sequencer's own whole tick — its step's shuffled position, a flam's second hit
// at + mFl —, filtered by its own tick against [t0, t1) (a flam whose step lies before t0 keeps its second note), the velocity of
// its state (vel9, P-1); a flam pair's first note ends where its second starts (d = the spacing), its second where the step's
// other notes end (the step + 120; + 240 when the spacing reaches 120) — every note-off on the steps' grid of 20 ticks: an
// off-grid one (t + mFl + 120) a tick before a step split the song path's span there and moved that step a 4-frame point
// against the sequencer's (D5 at 120 BPM / 48 kHz) [C]; a `once` plan is never wrapped past its first pass (review #17). The
// guide click is never in st: never written.
function notes909(plan, opts) {
  const out = [], T = plan.mT, n = plan.n, end = plan.once ? (plan.loopFrom > 0 ? plan.loopFrom : n) : -1;
  const t0 = Math.max(0, fin(opts.t0) ? Math.round(opts.t0) : 0), t1 = fin(opts.t1) ? Math.round(opts.t1) : t0;
  const prim = opts.prim && opts.prim.length === 16 ? opts.prim : primaries(opts.map, 'tr909');
  const b = Math.max(0, t0 - STEP_T[1]);                                  // (a step back: a second hit lies under a step after its step)
  if (end >= 0 && b >= T[end]) return out;
  let { m, start } = measureAt(plan, b);
  while (start < t1) {
    const Ts = STEP_T[plan.mPre[m]], w = plan.mSh[m], d = plan.mFl[m], d2 = 120 * Math.ceil((d + 1) / 120) - d;
    for (let s = 0, o = plan.mOff[m]; o < plan.mOff[m + 1]; s++, o++) {
      const t = start + s * Ts + (s & 1 ? w : 0), mask = plan.st[o];
      if (!(mask & 0xFFE) || t >= t1) continue;
      for (let l = 1; l < 12; l++) {
        if (!(mask & (1 << l))) continue;
        const sd = LANE_SOUND[l][0], nn = prim[sd];
        if (nn < 0) continue;
        const v = vel9(sd, (mask & 1 ? 2 : 0) | ((plan.ac[o] >> l) & 1));
        if ((plan.fl[o] >> l) & 1) {
          if (t >= t0) out.push({ t, d, n: nn, v });
          if (t + d >= t0 && t + d < t1) out.push({ t: t + d, d: d2, n: nn, v });
        } else if (t >= t0) out.push({ t, d: 120, n: nn, v });
      }
    }
    start += T[m + 1] - T[m];
    if (m + 1 === end) break;
    m = m + 1 < n ? m + 1 : plan.loopFrom;
  }
  return out.sort((a, b) => a.t - b.t || a.n - b.n);
}
function payload909(drum, state, at) {
  const S = sess9(state), x = normX909(drum.x), ui = normUi909(drum.ui);
  const plan = compilePlan(drum, ui, x, S), map = mapTable(drum.map, 'tr909'), prim = primaries(drum.map, 'tr909'), smp = slots(drum.smp, SOUNDS909);
  const s = { plan, sync: x.sync, run: !x.sync && !!S.run, bpm: ui.tempo, swing: SWING_LO, at, tap: 0, map, prim, mute: soundMute(x), smp,
    m: 'tr909', rst: 0, rstF: -1 };
  if (s.run && fin(S.from) && S.from > 0) s.from = S.from;            // (review 1 F4: STOP/CONT's tick — DrSeq's free START there)
  s.pk = pkOf(s);
  return s;
}
/** The session fields a synced plan reads (review 1 F2), for an offline session (main.js: the bounce's payload) and rollPlan:
 *  the 909's TRACK WRITE pointer and chosen key { ptr, pend }; the 606's TRACK WRITE bar pointer (in TRACK PLAY it only places
 *  a free pre-roll: −1), its heard key / chain and its D.S. { bar, twSel, ds }; the 808's none (null). Never run, a free `loc`
 *  or the 808's tap: a free run is not bounced, and → Piano roll writes the synced sequencer's notes. */
export function planSess(D, S) {
  if (!isObj(S) || !isObj(D)) return null;
  if (is909(D)) return { ptr: S.ptr, pend: S.pend };
  if (is606(D)) return { bar: isObj(D.ui) && D.ui.mode === M6_TW ? S.bar : -1, twSel: S.twSel, ds: S.ds };
  return null;
}
/** "→ Piano roll"'s plan (7c §4, §10): the 808's today's compilePlan(D, D.ui, D.x); the 606's with planSess(D, S) (S the live
 *  session: TRACK WRITE's bar and key heard, its D.S.; none: the track from its first bar); the 909's as the synced sequencer
 *  plays it (no free pre-roll; TRACK WRITE the session's pointer / chosen key), its flams' ticks at the project's tempo `bpm`. */
export function rollPlan(D, bpm, S) {
  if (is909(D)) return plan909(D, D.ui, { ...D.x, sync: true }, planSess(D, S), fin(bpm) && bpm > 0 ? bpm : 120);
  return compilePlan(D, D.ui, D.x, is606(D) ? planSess(D, S) : undefined);
}
/** …and toNotes' options (dev: the device { model, vals }): the 808's / 606's today's { swing, sw: the patch's switches, prim: the
 *  model's primaries }; the 909's { prim } — its plan carries its shuffle, flams and accents, and P-1's fixed velocities read no
 *  TOTAL ACCENT. */
export function rollOpts(D, dev) {
  if (!is909(D)) return { swing: D.x.swing, sw: isObj(dev) ? dev.vals : undefined, prim: primaries(D.map, isObj(dev) && dev.model != null ? dev.model : D.m) };
  return { prim: primaries(D.map, 'tr909') };
}

const ZERO9 = Object.freeze(new Array(N_STEP9).fill(0));
const memOf9 = D => ({ m: 'tr909', keys: D.keys, st: D.st, ac: D.ac, fm: D.fm, tk: D.tk, tt: D.tt });
const withTk = (D, t, L) => { const tk = D.tk.slice(); tk[t] = L; return { ...D, tk }; };
// one voice (bit b) at step s of pattern p: on, its per-voice accent, its flam (each & its lanes); the same record when unchanged
function setStep9(D, p, s, b, on, a, f) {
  const r0 = D.st[p][s], a0 = D.ac[p][s], f0 = D.fm[p][s];
  const r1 = on ? r0 | b : r0 & ~b, a1 = on && a ? (a0 | b) & AC909 : a0 & ~b, f1 = on && f ? (f0 | b) & FL909 : f0 & ~b;
  if (r1 === r0 && a1 === a0 && f1 === f0) return D;
  const row = (R, v) => { const c = R.slice(), q = c[p].slice(); q[s] = v; c[p] = q; return c; };
  return { ...D, st: r1 !== r0 ? row(D.st, r1) : D.st, ac: a1 !== a0 ? row(D.ac, a1) : D.ac, fm: f1 !== f0 ? row(D.fm, f1) : D.fm };
}
// a step key in STEP write (§3.3): off → normal → accented → off (BD SD LT MT HT CH), off ↔ on (the others, TOTAL ACCENT); in
// flam write off ↔ flam, a flammed step replacing a plain one (its accent kept) and back; a plain write replaces a flam
function cycle9(D, p, s, l, fw) {
  const b = 1 << l, on = D.st[p][s] & b, a = D.ac[p][s] & b, f = D.fm[p][s] & b;
  if (fw) return f ? setStep9(D, p, s, b, 0, 0, 0) : setStep9(D, p, s, b, 1, a, 1);
  if (!on) return setStep9(D, p, s, b, 1, 0, 0);
  if ((AC909 & b) && !a) return setStep9(D, p, s, b, 1, 1, 0);
  return setStep9(D, p, s, b, 0, 0, 0);
}
// the lanes CLEAR + voice keys erase in TAP write, running (13 + 14: the open hat too); 0 otherwise
function erase9(S, D) {
  if (!(S.hold.clear && D.ui.mode === M9_PW && D.ui.wm === 1 && running(S, D))) return 0;
  let m = 0;
  for (const k of S.keys) m |= 1 << KEY_LANE9[k - 1];
  return S.keys.includes(13) && S.keys.includes(14) ? m | 1 << 10 : m;
}
// the step a TAP key / REC pad writes (7a's TR-08 rule): the heard one, or the next when more than half of it has passed
function nearest9(S, D, f) {
  const P = S.pos;
  if (!P || !(P.k >= 0) || !(P.m >= 0)) return null;
  if (!(fin(f) && f >= 0.5)) return { p: P.k, s: P.s };
  const plan = compilePlan(D, D.ui, D.x, S), m = P.m;
  if (!(m < plan.n) || plan.mKey[m] !== P.k) return null;
  if (P.s + 1 < plan.mOff[m + 1] - plan.mOff[m]) return { p: P.k, s: P.s + 1 };
  const m2 = m + 1 < plan.n ? m + 1 : plan.loopFrom;
  return { p: plan.mKey[m2], s: 0 };
}
// the track measure heard (TRACK PLAY running: the plan measure through a free pre-roll), −1 none
function heardMeas9(S, D) {
  const P = S.pos, t = trk9(D.ui);
  if (!P || !(P.m >= 0)) return -1;
  return measOf9(D, t, D.x.sync ? 0 : loc9(S, D, t), P.m);
}
// track t's measure that plan measure m plays when the plan starts at the located measure b (a free pre-roll), −1 none
function measOf9(D, t, b, m) {
  const L = D.tk[t].length, lf = b ? L - b : 0, j = !b ? m : m < lf ? b + m : m - lf;
  return m >= 0 && j < L ? j : -1;
}
// (review 1 F4) what a heard position indexes: a plan's structure and its patterns
const sig9 = pl => pl.shape + '/' + pl.mKey.join('.');
// STOP/CONT's tick (§3.3 [R]: "continue from where it stopped"): the step after the last one heard — the posts heard after the
// press included — in the plan CONT starts; null (from the top / the located measure's step 1) when that plan is not the one
// stopped (another selection, mode or track position: cont is dropped by those presses, the structure compared here)
function from9(S, D) {
  const c = S.cont, P = S.pos, ui = D.ui;
  if (!c || !P || !(P.m >= 0) || !(P.o >= 0)) return null;
  if (ui.mode === M9_TP) { const t = trk9(ui), j = measOf9(D, t, c.b, P.m); return j >= 0 && j === loc9(S, D, t) ? P.o + 1 : null; } // (its measure: the plan's first)
  const pl = compilePlan(D, ui, D.x, S);
  return sig9(pl) === c.sh && P.m < pl.n ? pl.mT[P.m] + P.o + 1 : null;
}

// the 909's state machine (§3.3): one row of the table per case. The held keys (SHIFT, INSTRUMENT SELECT, CLEAR, LAST STEP,
// SHUFFLE/FLAM, the TEMPO key, AVAILABLE MEAS) send { k: 'hold', b, down }; START, STOP/CONT, SCALE, TRACK n, PATTERN n, BACK,
// FWD, CYCLE/GUIDE and ENTER are taps { k: 'tap', b, n }; a step key { k: 'key', n, down, shift, f } acts at its down unless a
// combination needs it held (a pair, a block, a chain: the second key's down; Shift-click = with the selection / its pair)
// (review 2 F1) a tap's held keys: what was held at its own press (a finger lifted before the tap's release, or with it) and,
// on a desktop, Alt / Shift as SHIFT (review 2 F2) — OR'd into this press's holds, never stored
function heldOr9(h, x) {
  if (!isObj(x)) return h;
  let o = h;
  for (const k of Object.keys(HOLD0)) if (x[k] === true && !o[k]) o = { ...o, [k]: true };
  return o;
}
function press909(state, drum, input) {
  let S = sess9(state), D = drum;
  const cmds = [], i = isObj(input) ? input : {}, ui = D.ui, x = D.x, run = running(S, D), mode = ui.mode, H = i.k === 'tap' ? heldOr9(S.hold, i.held) : S.hold;
  const pat = mode <= M9_PW, t = trk9(ui), base = ui.bank * 48 + ui.grp * 16, ed = base + ui.sel, n = idx(i.n, 1, 16), v = i.v;
  const aOf = () => (run ? 'bar' : 'now'), done = () => ({ state: S, mem: D, cmds });
  const snap = (text, withUi) => { S = { ...S, undo: { text, ...memOf9(D), ...(withUi ? { ui: D.ui } : null) } }; };
  const notice = text => cmds.push(send('now'), { c: 'notice', text: text + ' · tap to undo', undo: true });
  const toMode = o => { D = withUi(D, o); S = { ...S, op: null, dig: null, pend: null, pg: -1, tw: null, erase: 0, cont: null, end: false }; cmds.push(send(aOf())); };
  const bank = b => { if (!pat && ui.bank !== b) { D = withUi(D, { bank: b }); S = { ...S, ptr: 0, loc: 0, pend: null, op: null, dig: null }; cmds.push(send(aOf())); } };
  if (S.disp && (i.k === 'tap' || ((i.k === 'key' || i.k === 'hold') && i.down === true))) S = { ...S, disp: null }; // ("  0" until the next press)
  // PATTERN CLEAR (stopped PATTERN WRITE): steps, accents, flams, its keys to the cleared values, out of its chain
  const clearPats = qs => {
    const ps = [...new Set(qs)].sort((a, b) => a - b), nm = ps.map(pName9);
    const text = (ps.length > 1 ? 'Patterns ' + nm.slice(0, -1).join(', ') + ' and ' + nm[nm.length - 1] : 'Pattern ' + nm[0]) + ' cleared';
    snap(text);
    const keys = D.keys.slice(), st = D.st.slice(), ac = D.ac.slice(), fm = D.fm.slice();
    for (const p of ps) { keys[p] = { ...CLEARED9 }; if (p & 15 && keys[p - 1].ch) keys[p - 1] = { ...keys[p - 1], ch: 0 }; st[p] = ZERO9.slice(); ac[p] = ZERO9.slice(); fm[p] = ZERO9.slice(); }
    D = { ...D, keys, st, ac, fm };
    notice(text);
  };
  // BACK / FWD (track modes): TRACK WRITE's pointer (0 … its length), TRACK PLAY's located measure (stopped: a free run's plan
  // reads it, so it never moves under one — STOP/CONT starts there)
  const stepPtr = d => {
    const L = D.tk[t].length;
    if (mode === M9_TW) { const p = ptr9(S, D, t), q = Math.min(Math.max(p + d, 0), L); if (q !== p) { S = { ...S, ptr: q }; if (!S.pend) cmds.push(send(aOf())); } }
    else if (mode === M9_TP && !run) { const p = loc9(S, D, t), q = Math.min(Math.max(p + d, 0), Math.max(0, L - 1)); if (q !== p) { S = { ...S, loc: q, cont: null }; if (!x.sync) cmds.push(send('now')); } }
  };
  // TRACK WRITE's key (a group key + a key; two held: a range): pend, heard from the next measure while running
  const pendKey = m => {
    const g = S.pg >= 0 ? S.pg : S.pend ? S.pend.g : ui.grp, o = S.pend;
    const w = m && m !== n ? { g, sel: Math.min(m, n) - 1, bl: Math.abs(m - n) } : { g, sel: n - 1, bl: 0 };
    S = { ...S, pend: w, pg: -1 };
    if (!o || o.g !== w.g || o.sel !== w.sel || o.bl !== w.bl) cmds.push(send(run ? 'bar' : 'now'));
  };
  // ENTER, TRACK WRITE: pend (or the pointer's own pattern) written at the pointer, which advances by its length — a chain as
  // consecutive measures; past the bank's 896 nothing is written and the display shows 0
  const writeTrack = () => {
    const L = D.tk[t], p = ptr9(S, D, t), w = pend9(S, D, ui.bank) || (p < L.length ? [L[p]] : null);
    if (!w) return;
    if (used9(D, ui.bank) + Math.max(0, p + w.length - L.length) > BANK_MEAS) { S = { ...S, disp: 'full' }; return; }
    if (w.some((m, j) => L[p + j] !== m)) { const a = L.slice(); w.forEach((m, j) => { a[p + j] = m; }); D = withTk(D, t, a); }
    S = { ...S, ptr: p + w.length };
    cmds.push(send(aOf()));
  };
  // ENTER after a SHIFT sequence (§3.3: DEL / INS / COPY of measures and LAST MEAS in TRACK WRITE, COPY of a pattern in PATTERN
  // WRITE), each destructive one with the one-level undo notice
  const enterOp = () => {
    const o = S.op, L = D.tk[t], p = ptr9(S, D, t), num = S.dig ? parseInt(S.dig, 10) : NaN, mm = (a, z) => (a === z ? 'Measure ' + (a + 1) : 'Measures ' + (a + 1) + '–' + (z + 1));
    if (o.k === 'last') { S = { ...S, op: null, dig: null, ptr: L.length }; if (!S.pend) cmds.push(send(aOf())); return; }
    if (o.k === 'copyP') { // that pattern onto the edited one: its steps, accents, flams, SCALE, LAST STEP, SHUFFLE, FLAM (its chain kept)
      if (o.key < 0) return;
      const src = o.bank * 48 + o.grp * 16 + o.key, K = D.keys[src];
      S = { ...S, op: null, dig: null };
      if (src === ed || run) return;
      const text = 'Pattern ' + pName9(src) + ' copied to ' + pName9(ed), st = D.st.slice(), ac = D.ac.slice(), fm = D.fm.slice();
      snap(text);
      st[ed] = D.st[src].slice(); ac[ed] = D.ac[src].slice(); fm[ed] = D.fm[src].slice();
      D = withKey({ ...D, st, ac, fm }, ed, { sc: K.sc, l1: K.l1, sh: K.sh, fl: K.fl });
      notice(text);
      return;
    }
    if (run) { S = { ...S, op: null, dig: null }; return; }               // (the track edits: stopped only)
    if (o.k === 'del') { // measures ptr … n (typed; LAST MEAS: to the end; none: the pointer's), later measures moving up
      if (p >= L.length) { S = { ...S, op: null, dig: null }; return; }
      const e = o.end ? L.length - 1 : num >= 1 ? Math.min(num - 1, L.length - 1) : p, a = Math.min(p, e), z = Math.max(p, e), text = mm(a, z) + ' deleted';
      snap(text);
      const T = L.slice(); T.splice(a, z - a + 1);
      D = withTk(D, t, T); S = { ...S, op: null, dig: null, ptr: a };
      notice(text);
    } else if (o.k === 'ins') { // pend (a key, its chain, or a range of adjacent patterns) inserted at the pointer
      const w = pend9(S, D, ui.bank);
      if (!w) return;                                                  // (a key first)
      if (used9(D, ui.bank) + w.length > BANK_MEAS) { S = { ...S, op: null, dig: null, disp: 'full' }; return; }
      const text = (w.length > 1 ? w.length + ' measures' : 'A measure') + ' inserted at ' + (p + 1);
      snap(text);
      const T = L.slice(); T.splice(p, 0, ...w);
      D = withTk(D, t, T); S = { ...S, op: null, dig: null };
      notice(text);
    } else if (o.k === 'copyT') { // measures a … b copied to the pointer (inserted): the first ENTER takes a, the second b (none: a)
      if (o.a == null) { if (num >= 1 && num <= L.length) S = { ...S, op: { ...o, a: num - 1 }, dig: null }; return; }
      const e = num >= 1 ? Math.min(num - 1, L.length - 1) : o.a, a = Math.min(o.a, e), z = Math.max(o.a, e), seg = L.slice(a, z + 1);
      if (used9(D, ui.bank) + seg.length > BANK_MEAS) { S = { ...S, op: null, dig: null, disp: 'full' }; return; }
      const text = mm(a, z) + ' copied to ' + (p + 1);
      snap(text);
      const T = L.slice(); T.splice(p, 0, ...seg);
      D = withTk(D, t, T); S = { ...S, op: null, dig: null };
      notice(text);
    }
  };
  // TAP write (§3.3): a step key is a drum pad — its voice at its state's velocity (the left key of a pair accented) through the
  // host's note path ({ c: 'hit' }); running, also written at the nearest step of the edited pattern. 13 + 14: the open hat —
  // the first key already played and wrote a closed hat, so the second takes that back off its step and writes the open one
  // there (the closed hat heard stays heard: the one hat voice, review #19)
  const tapKey = held => {
    const m = held.length ? held[held.length - 1] : i.shift === true ? keyMate9(n) : 0, oh = (n === 13 || n === 14) && m === keyMate9(n);
    const l = oh ? 10 : KEY_LANE9[n - 1], sound = LANE_SOUND[l][0], acc = !oh && keyAcc9(n) === 1;
    cmds.push({ c: 'hit', sound, v: vel9(sound, acc ? 1 : 0) });
    S = { ...S, hits: [...S.hits.filter(e => e[0] !== n), [n, sound]] };
    if (!run) return;
    let w;
    if (oh && S.tw && S.tw.n === m) { const T = S.tw; D = setStep9(D, T.p, T.s, 1 << 11, T.on, T.ac, T.fm); w = { p: T.p, s: T.s }; S = { ...S, tw: null }; }
    else w = nearest9(S, D, i.f);
    if (!w || w.p !== ed) { if (oh) cmds.push(send('now')); return; }
    const b = 1 << l;
    if (l === 11) S = { ...S, tw: { n, p: w.p, s: w.s, on: D.st[w.p][w.s] & b ? 1 : 0, ac: D.ac[w.p][w.s] & b ? 1 : 0, fm: D.fm[w.p][w.s] & b ? 1 : 0 } };
    D = setStep9(D, w.p, w.s, b, 1, acc ? 1 : 0, 0);
    cmds.push(send('now'));
  };
  switch (i.k) {
    case 'hold': {
      const b = i.b;
      if (typeof b !== 'string' || !Object.prototype.hasOwnProperty.call(HOLD0, b)) break;
      if (i.down !== true) { if (H[b]) S = { ...S, hold: { ...H, [b]: false }, ...(b === 'clear' ? { erase: 0 } : null) }; break; }
      if (H[b]) break;
      if (b === 'avail' && S.op && S.op.k === 'copyP') { S = { ...S, op: { ...S.op, bank: 1 } }; break; } // (COPY's bank II)
      if (H.shift && b === 'tkey') { if (ui.wm !== 0) { D = withUi(D, { wm: 0 }); if (mode === M9_PW) cmds.push(send('now')); } break; } // SHIFT + TEMPO: STEP write
      if (H.shift && b === 'avail') { bank(1); break; }                // SHIFT + AVAILABLE MEAS: bank II (from a track mode)
      S = { ...S, hold: { ...H, [b]: true } };
      if (b === 'clear') { // CLEAR after the keys (stopped PATTERN WRITE): their patterns cleared; TAP write running: the erase
        if (mode === M9_PW && !run && S.keys.length) clearPats(S.keys.map(k => base + k - 1));
        else S = { ...S, erase: erase9(S, D) };
      }
      break;
    }
    case 'tap': {
      const b = i.b;
      if (b === 'start') { // synced the project's ▶; free from the top (pattern modes the selection's first, TRACK PLAY measure 1)
        if (run || (mode === M9_TP && !D.tk[t].length)) break;         // (running: nothing; an empty track: nothing to play)
        S = { ...S, loc: 0, op: null, dig: null, cont: null, from: null };
        if (x.sync) { cmds.push({ c: 'play' }); break; }
        S = { ...S, run: true, pos: null };
        cmds.push(send('now'));
      } else if (b === 'stop') { // running: stop; stopped: continue (§3.3 [R]) — free, where it stopped (review 1 F4: the step after
        // the last heard — TRACK PLAY in the measure it stopped in, a pre-roll from it; a located measure: from its step 1)
        if (run) {
          if (x.sync) { cmds.push({ c: 'stop' }); break; }
          const j = mode === M9_TP ? heardMeas9(S, D) : -1, P = S.pos;
          const cont = P && P.m >= 0 ? { b: mode === M9_TP ? loc9(S, D, t) : 0, sh: sig9(compilePlan(D, ui, x, S)) } : null;
          S = { ...S, run: false, cont, from: null, ...(j >= 0 ? { loc: j } : null) };
          cmds.push(send('now'));
        } else {
          if (mode === M9_TP && !D.tk[t].length) break;
          if (x.sync) { cmds.push({ c: 'play' }); break; }
          S = { ...S, run: true, from: from9(S, D), cont: null, pos: null };
          cmds.push(send('now'));
        }
      } else if (b === 'pat') { // PATTERN n: PATTERN PLAY (SHIFT: PATTERN WRITE), group n; TRACK WRITE / COPY: the group of the next key
        const g = idx(i.n, 1, 3) - 1;
        if (g < 0) break;
        if (S.op && S.op.k === 'copyP') { S = { ...S, op: { ...S.op, grp: g } }; break; }
        if (H.shift) { if (mode !== M9_PW || g !== ui.grp) toMode({ mode: M9_PW, grp: g, bl: 0 }); break; }
        if (mode === M9_TW) { S = { ...S, pg: g }; break; }
        if (mode !== M9_PP) { toMode({ mode: M9_PP, grp: g, bl: 0 }); break; }
        if (run) S = { ...S, pg: g };                                   // (running: the next key picks its pattern there)
        else if (g !== ui.grp) { D = withUi(D, { grp: g, bl: 0 }); cmds.push(send('now')); }
      } else if (b === 'trk') { // TRACK n: TRACK PLAY (SHIFT: TRACK WRITE), track n of the bank; TEMPO held: its stored tempo too
        const k = idx(i.n, 1, 4) - 1;
        if (k < 0) break;
        if (H.shift) { if (mode !== M9_TW || k !== ui.trk) { toMode({ mode: M9_TW, trk: k }); S = { ...S, ptr: 0 }; } break; }
        if (mode !== M9_TP || k !== ui.trk) { toMode({ mode: M9_TP, trk: k }); S = { ...S, loc: 0 }; }
        const tt = D.tt[ui.bank * 4 + k];
        if (H.tkey && tt > 0) { if (x.sync) cmds.push({ c: 'bpm', v: tt }); else if (tt !== D.ui.tempo) { D = withUi(D, { tempo: tt }); cmds.push(send('now')); } }
      } else if (b === 'back') { // BACK (SHIFT: TAP write)
        if (H.shift) { if (ui.wm !== 1) { D = withUi(D, { wm: 1 }); if (mode === M9_PW) cmds.push(send('now')); } break; }
        stepPtr(-1);
      } else if (b === 'fwd') { // FWD (SHIFT: bank I, from a track mode; COPY: bank I)
        if (S.op && S.op.k === 'copyP') { S = { ...S, op: { ...S.op, bank: 0 } }; break; }
        if (H.shift) { bank(0); break; }
        stepPtr(1);
      } else if (b === 'cyc') { // CYCLE (TRACK PLAY) / GUIDE (TAP write); SHIFT: LAST MEAS (TRACK WRITE)
        if (H.shift) { if (mode === M9_TW) S = { ...S, op: S.op && S.op.k === 'del' ? { ...S.op, end: true } : { k: 'last' } }; break; }
        if (mode === M9_TP) { D = withUi(D, { cyc: !ui.cyc }); S = { ...S, end: false }; cmds.push(send('now')); } // (review 1 F5: an ended track plays again)
        else if (mode === M9_PW && ui.wm === 1) { D = withUi(D, { guide: !ui.guide }); cmds.push(send('now')); }
      } else if (b === 'scale') { // SCALE (PATTERN WRITE, running): 16 → 32 → 8T → 16T → 16, LAST STEP 16 / 16 / 12 / 12
        if (!(mode === M9_PW && run)) break;
        const sc = D.keys[ed].sc % 4 + 1;
        D = withKey(D, ed, { sc, l1: sc <= 2 ? 16 : 12 });
        cmds.push(send('bar'));
      } else if (b === 'enter') {
        if (H.isel) { if (ui.inst !== 0 || ui.fw) D = withUi(D, { inst: 0, fw: false }); break; } // INSTRUMENT SELECT + ENTER: TOTAL ACCENT
        if (H.tkey) { D = withArr(D, 'tt', t, x.sync ? bpm909(S.bpm, 120) : ui.tempo); break; } // TEMPO + ENTER: the track's tempo
        if (S.op) { enterOp(); break; }
        if (S.dig !== null && !pat) { // SHIFT + digits + ENTER: locate (TRACK PLAY stopped: STOP/CONT starts there)
          const L = D.tk[t].length, j = Math.max(0, (parseInt(S.dig, 10) || 0) - 1);
          S = { ...S, dig: null };
          if (mode === M9_TW) { const q = Math.min(j, L); if (q !== ptr9(S, D, t)) { S = { ...S, ptr: q }; if (!S.pend) cmds.push(send(aOf())); } }
          else if (!run) { const q = Math.min(j, Math.max(0, L - 1)); if (q !== loc9(S, D, t)) { S = { ...S, loc: q, cont: null }; if (!x.sync) cmds.push(send('now')); } }
          break;
        }
        const ks = S.keys.length ? S.keys : Array.isArray(i.keys) ? i.keys.filter(k => Number.isInteger(k) && k >= 1 && k <= 16) : []; // (review 2 F1: held at ENTER's press)
        if (mode === M9_PW && !run && ks.length) { // two keys + ENTER: the range chained; one key + ENTER: out of its chain
          const lo = base + Math.min(...ks) - 1, hi = base + Math.max(...ks) - 1;
          let D2 = D;
          const ch = (q, c) => { if (D2.keys[q].ch !== c) D2 = withKey(D2, q, { ch: c }); };
          for (let q = lo; q < hi; q++) ch(q, 1);
          ch(hi, 0);
          if (lo & 15) ch(lo - 1, 0);
          if (D2 !== D) { D = D2; cmds.push(send('now')); }
          break;
        }
        if (mode === M9_TW) writeTrack();
      }
      break;
    }
    case 'key': {
      if (n < 1) break;
      if (i.down !== true) { // an up: a pad's note off, the erase's lane
        if (!S.keys.includes(n)) break;
        S = { ...S, keys: S.keys.filter(q => q !== n) };
        const h = S.hits.find(e => e[0] === n);
        if (h) { S = { ...S, hits: S.hits.filter(e => e[0] !== n) }; cmds.push({ c: 'hit', sound: h[1], off: true }); }
        if (S.tw && S.tw.n === n) S = { ...S, tw: null };
        if (S.erase) S = { ...S, erase: erase9(S, D) };
        break;
      }
      const held = S.keys.filter(q => q !== n), sm = q => (held.length ? held[held.length - 1] : i.shift === true ? q : 0);
      if (!S.keys.includes(n)) S = { ...S, keys: [...S.keys, n] };
      if (H.isel) { // INSTRUMENT SELECT + key(s): the voice; a pair's both keys flam write (BD … HT) or the open hat (13 + 14)
        const pr = sm(keyMate9(n)) === keyMate9(n) && keyMate9(n) > 0;
        const o = pr ? (n >= 13 ? { inst: 10, fw: false } : { inst: KEY_LANE9[n - 1], fw: true }) : { inst: KEY_LANE9[n - 1], fw: false };
        if (o.inst !== ui.inst || o.fw !== ui.fw) D = withUi(D, o);
        break;
      }
      if (H.shift || (S.op && S.op.k === 'copyP')) { // SHIFT + a key: COPY's pattern, the keypad's digits (1–9, 10 = 0), COPY / INS / DEL
        S = { ...S, keys: held };                                        // (a keypad / sequence key is no step key held: never a pair's or a range's mate)
        if (S.op && S.op.k === 'copyP') { S = { ...S, op: { ...S.op, key: n - 1 } }; break; }
        if (S.op && S.op.k === 'ins') { pendKey(sm(0)); break; }
        if (pat) { if (mode === M9_PW && !run && n === 11) S = { ...S, op: { k: 'copyP', bank: ui.bank, grp: ui.grp, key: -1 }, dig: null }; break; }
        if (n <= 10) { S = { ...S, dig: ((S.dig || '') + (n % 10)).slice(-3) }; break; }
        if (mode === M9_TW && !run && n <= 13) S = { ...S, op: n === 11 ? { k: 'copyT', a: null } : n === 12 ? { k: 'ins' } : { k: 'del', end: false }, dig: null };
        break;
      }
      if (H.last) { // LAST STEP + key (PATTERN WRITE): 'bar' when it shortens the bar under the playhead
        if (mode === M9_PW) { const old = D.keys[ed].l1; if (n !== old) { D = withKey(D, ed, { l1: n }); cmds.push(send(run && n < old ? 'bar' : 'now')); } }
        break;
      }
      if (H.shuf) { // SHUFFLE/FLAM + key 1–7 / 9–16 (PATTERN WRITE, running): the edited pattern's
        const f = n <= 7 ? 'sh' : n >= 9 ? 'fl' : '';
        if (mode === M9_PW && run && f && D.keys[ed][f] !== n) { D = withKey(D, ed, { [f]: n }); cmds.push(send('now')); }
        break;
      }
      if (H.clear) { // CLEAR + key: stopped PATTERN WRITE that pattern cleared; TAP write running that voice erased as it passes
        if (mode === M9_PW && !run) clearPats([base + n - 1]);
        else S = { ...S, erase: erase9(S, D) };
        break;
      }
      if (mode === M9_PP) { // select (running: queued to the end of the measure); a second key while the first is held: block play
        const m = sm(ui.sel + 1), g = S.pg >= 0 ? S.pg : ui.grp;
        const o = m && m !== n ? { grp: g, sel: Math.min(m, n) - 1, bl: Math.abs(m - n) } : { grp: g, sel: n - 1, bl: 0 };
        S = { ...S, pg: -1 };
        if (o.grp !== ui.grp || o.sel !== ui.sel || o.bl !== ui.bl) { D = withUi(D, o); cmds.push(send(aOf())); }
      } else if (mode === M9_PW) {
        if (ui.wm === 1) tapKey(held);                                   // TAP write: the step keys are drum pads
        else if (!run) { if (!held.length && (ui.sel !== n - 1 || ui.bl)) { D = withUi(D, { sel: n - 1, bl: 0 }); cmds.push(send('now')); } } // stopped: the pattern to edit (a second key: a chain's range)
        else if (n <= D.keys[ed].l1) { const D2 = cycle9(D, ed, n - 1, ui.inst, ui.fw); if (D2 !== D) { D = D2; cmds.push(send('now')); } } // past LAST STEP nothing
      } else if (mode === M9_TW) pendKey(sm(S.pend ? S.pend.sel + 1 : 0));
      break;
    }
    case 'tempo': { // v in BPM (tempo909 of the knob): free the machine's tempo, synced the project's; TEMPO held at the minimum: erase
      const b = bpm909(v, NaN);
      if (!(b > 0)) break;
      if (H.tkey && b <= TEMPO9_LO) { D = withArr(D, 'tt', t, 0); break; }
      if (x.sync) cmds.push({ c: 'bpm', v: b });
      else if (b !== ui.tempo) { D = withUi(D, { tempo: b }); cmds.push(send('now')); } // (the flams' ticks follow it)
      break;
    }
    case 'start': return press909(S, D, { k: 'tap', b: run ? 'stop' : 'start' }); // (the host's START / STOP toggle, as the 808's)
    case 'transport': { // the host: the project transport started / stopped (synced machines follow it)
      const p = !!i.play, was = !!S.play;
      S = { ...S, play: p, end: false };
      if (x.sync && p && !was) S = { ...S, pos: null };
      break;
    }
    case 'panic': S = { ...S, run: false, hold: HOLD0, keys: [], dig: null, op: null, erase: 0, tw: null, hits: [], cont: null, from: null }; break;
    case 'release': S = { ...S, hold: HOLD0, keys: [], dig: null, op: null, erase: 0, tw: null, hits: [], pg: -1 }; break; // (a cancelled hold: nothing done)
    case 'bpm': { // the project tempo (review #1): synced, a plan whose flam ticks move is sent at once
      const b = fin(v) && v > 0 ? v : S.bpm;
      if (b === S.bpm) break;
      const k0 = x.sync ? compilePlan(D, ui, x, S).key : '';
      S = { ...S, bpm: b };
      if (x.sync && compilePlan(D, ui, x, S).key !== k0) cmds.push(send('now'));
      break;
    }
    case 'heard': { // a step post at its heard time: the LEDs' position; the TAP erase; a free CYCLE-off track's end
      const P = i.post;
      if (!isObj(P)) break;
      S = { ...S, pos: { s: P.s | 0, m: P.m | 0, k: P.k | 0, v: P.v | 0, p: P.p | 0, o: P.o | 0, M: P.M | 0, f: P.f ? 1 : 0 } };
      if (S.from !== null && run) S = { ...S, from: null };            // (review 1 F4: CONT's tick played — later payloads carry none)
      if (S.cont && !run && mode === M9_TP && !x.sync) { const j = measOf9(D, t, S.cont.b, P.m | 0); if (j >= 0 && j !== S.loc) S = { ...S, loc: j }; } // (the posts heard after STOP: its measure)
      if (mode === M9_TP && x.sync && !ui.cyc) { // (review 1 F5) a synced CYCLE-off track: its last step heard — the panel shows it ended
        const pl = compilePlan(D, ui, x, S), e = (pl.loopFrom > 0 ? pl.loopFrom : pl.n) - 1;
        const last = e >= 0 && (P.m | 0) === e && (P.s | 0) === pl.mOff[e + 1] - pl.mOff[e] - 1;
        if (last !== S.end) S = { ...S, end: last };
      } else if (S.end) S = { ...S, end: false };
      const s = idx(P.s, 0, 15);
      if (S.erase && run && (P.k | 0) === ed && s >= 0) {
        let D2 = D;
        for (let l = 0; l < 12; l++) if ((S.erase >> l) & 1) D2 = setStep9(D2, ed, s, 1 << l, 0, 0, 0);
        if (D2 !== D) { D = D2; cmds.push(send('now')); }
      }
      if (mode === M9_TP && !x.sync && run && !ui.cyc) { // (free: at the heard last step the session stops — the RUN state, the LEDs)
        const pl = compilePlan(D, ui, x, S), e = (pl.loopFrom > 0 ? pl.loopFrom : pl.n) - 1;
        if (e >= 0 && (P.m | 0) === e && (P.s | 0) === pl.mOff[e + 1] - pl.mOff[e] - 1) { S = { ...S, run: false }; cmds.push(send('now')); }
      }
      break;
    }
    case 'sync': { // SYNC on: the song's clock (a free run ends); off: the machine stops until its own START
      const y = !!v;
      if (y === x.sync) break;
      D = withX(D, { sync: y }); S = { ...S, run: false, cont: null, from: null, end: false };
      cmds.push(send('now'));
      break;
    }
    case 'mute': case 'solo': {
      const l = idx(i.lane, 0, 11);
      if (l < 0) break;
      D = withX(D, { [i.k]: x[i.k] ^ (1 << l) });
      cmds.push(send('now'));
      break;
    }
    case 'rec': D = withX(D, { rec: !!v }); break;
    case 'grid': { // the step grid (extras): a cell cycles as its step key would; flam (a long press, BD … HT) toggles the flam
      const l = idx(i.lane, 0, 11), s = idx(i.s, 0, 15), fw = i.flam === true;
      if (l < 0 || s < 0 || (fw && !((FL909 >> l) & 1))) break;
      const D2 = cycle9(D, gridPat909(S, D), s, l, fw);
      if (D2 !== D) { D = D2; cmds.push(send('now')); }
      break;
    }
    case 'pad': { // REC: a pad hit (v 0…1) writes its sound at the nearest step while PATTERN WRITE runs, in the state its velocity names
      const s = idx(i.sound, 0, 15);
      if (!(x.rec && run && mode === M9_PW && s >= 0 && s <= 10)) break;
      const w = nearest9(S, D, i.f);
      if (!w || w.p !== ed) break;
      const q = fin(v) ? Math.round(clamp(v, 0, 1) * 127) : 100, z = q >= 127 ? 3 : q >= 119 ? 2 : q >= 110 ? 1 : 0;
      let D2 = setStep9(D, w.p, w.s, 1 << SOUND_LANE[s], 1, z & 1, 0);
      if (z & 2) D2 = setStep9(D2, w.p, w.s, 1, 1, 0, 0);
      if (D2 !== D) { D = D2; cmds.push(send('now')); }
      break;
    }
    case 'map': { // MAP…: one of its eleven sounds' notes (primary first); the notes leave any other sound
      const s = SOUNDS909.indexOf(i.sound);
      if (s < 0 || !HAS909.has(SOUNDS909[s]) || !Array.isArray(i.notes)) break;
      const want = normMap({ ...Object.fromEntries(SOUNDS909.map(q => [q, []])), [SOUNDS909[s]]: i.notes }, 'tr909')[SOUNDS909[s]];
      const m = {};
      for (const q of SOUNDS909) m[q] = q === SOUNDS909[s] ? want : (D.map[q] || []).filter(k => !want.includes(k));
      D = { ...D, map: normMap(m, 'tr909') };
      cmds.push(send('now'));
      break;
    }
    case 'mapReset': D = { ...D, map: normMap(MAP909, 'tr909') }; cmds.push(send('now')); break;
    case 'smp': { // SOUNDS…: a slot of its eleven { id, name, on } or null
      const s = SOUNDS909.indexOf(i.sound);
      if (s < 0 || !HAS909.has(SOUNDS909[s])) break;
      const smp = { ...D.smp };
      if (i.slot == null) delete smp[SOUNDS909[s]]; else { const e = normSmp({ [SOUNDS909[s]]: i.slot }, 'tr909')[SOUNDS909[s]]; if (!e) break; smp[SOUNDS909[s]] = e; }
      D = { ...D, smp: normSmp(smp, 'tr909') };
      cmds.push(send('now'));
      break;
    }
    case 'undo': { // the notice's one-level undo (PATTERN CLEAR, COPY, DEL / INS / COPY of measures, DEMO: its selection too)
      const U = S.undo;
      if (!U || U.m !== 'tr909') break;
      D = { ...D, keys: U.keys, st: U.st, ac: U.ac, fm: U.fm, tk: U.tk, tt: U.tt, ...(U.ui ? { ui: U.ui } : null) };
      S = { ...S, undo: null };
      cmds.push(send(aOf()));
      break;
    }
    case 'demo': { // DEMO (extras): our own two patterns into I-1-1 and I-1-2, block-played 1–2 in PATTERN PLAY (the host confirms first)
      const text = 'Demo loaded into patterns I-1-1 and I-1-2', keys = D.keys.slice(), st = D.st.slice(), ac = D.ac.slice(), fm = D.fm.slice();
      snap(text, true);
      [DEMO909.a, DEMO909.b].forEach((Q, p) => { keys[p] = { ...DEMO909.key }; st[p] = Q.st.slice(); ac[p] = Q.ac.slice(); fm[p] = Q.fm.slice(); });
      D = withUi({ ...D, keys, st, ac, fm }, { mode: M9_PP, bank: 0, grp: 0, sel: 0, bl: 1 });
      S = { ...S, op: null, dig: null, pend: null, pg: -1, tw: null, erase: 0 };
      cmds.push(send(aOf()), { c: 'notice', text: text + ' · tap to undo', undo: true });
      break;
    }
    default: break;                                                     // (EXT INST, TAPE SYNC, CARTRIDGE, the MIDI keys: not emulated)
  }
  return done();
}

// the 909's grid pattern (0–95): PATTERN WRITE's edited one; running, the one heard; a track mode stopped, the pointer's / the
// located measure's; else the selection's
function gridPat909(S, D) {
  S = sess9(S);
  const ui = D.ui, P = S.pos, t = trk9(ui);
  if (ui.mode === M9_PW) return ed9(ui);
  if (running(S, D) && P && P.k >= 0 && P.k < N_PAT9) return P.k;
  if (ui.mode >= M9_TP) { const L = D.tk[t], j = ui.mode === M9_TW ? ptr9(S, D, t) : loc9(S, D, t); if (j < L.length) return ui.bank * 48 + L[j]; }
  return ed9(ui);
}
// ticks from a heard step to the next (TAP's fraction): its pattern's SCALE and SHUFFLE, the last step to the bar
function stepLen909(D, P) {
  const K = P && P.k >= 0 && P.k < N_PAT9 ? D.keys[P.k] : CLEARED9, T = STEP_T[SC_CODE[K.sc]], w = sh9(K), s = P ? P.s | 0 : 0;
  if (s >= K.l1 - 1) return T - (s & 1 ? w : 0);
  return s & 1 ? T - w : T + w;
}
// the display (§3.6; three characters): SHIFT's digits as typed; AVAILABLE MEAS the bank's free measures; TEMPO held and the
// pattern modes the tempo (synced the project's, rounded); the track modes the measure — running TRACK PLAY the one heard,
// else the pointer / the located one; an empty TRACK PLAY track and the bank's 896 reached: 0
function disp909(S, D) {
  const ui = D.ui, H = S.hold, p3 = v => String(v).slice(-3).padStart(3, ' '), t = trk9(ui), L = D.tk[t].length;
  const tempo = D.x.sync ? bpm909(S.bpm, 120) : ui.tempo;
  if (S.disp === 'full') return '  0';
  if (S.dig !== null) return p3(S.dig);
  if (H.avail) return p3(BANK_MEAS - used9(D, ui.bank));
  if (H.tkey || ui.mode <= M9_PW) return p3(tempo);
  if (ui.mode === M9_TW) return p3(ptr9(S, D, t) + 1);
  if (!L) return '  0';
  const j = running(S, D) && !S.end ? heardMeas9(S, D) : loc9(S, D, t);  // (review 1 F5: an ended synced track as stopped)
  return p3((j >= 0 ? j : 0) + 1);
}
/** The 909's LEDs (§3.6): { step[16] 0–5, scl[4], trk[4], pat[3], tkey, back, fwd, avail, cyc, enter, disp } — the 808's codes
 *  (0 off · 1 on · 2 flashing · 3 / 4 the inverted playhead) + 5 dim (a normal step); disp the display's three characters. */
function leds909(S, D) {
  S = sess9(S);
  const ui = D.ui, run = running(S, D) && !S.end, P = S.pos, H = S.hold, mode = ui.mode, pat = mode <= M9_PW, t = trk9(ui), ed = ed9(ui), step = new Array(16).fill(0); // (review 1 F5: end)
  if (H.shuf && mode === M9_PW) { const K = D.keys[ed]; step[K.sh - 1] = 1; step[K.fl - 1] = 1; } // SHUFFLE/FLAM held: the current values' keys
  else if (H.isel) { // INSTRUMENT SELECT held: the voice's key(s) — flam write and the open hat both keys flashing
    const l = ui.inst;
    for (let k = 1; k <= 16; k++) if (KEY_LANE9[k - 1] === l || (l === 10 && k >= 13 && k <= 14)) step[k - 1] = ui.fw || l === 10 ? 2 : 1;
  } else if (run && mode === M9_PW && ui.wm === 0) { // STEP write: the voice's steps — dim normal, bright accented (flam write: the flams bright), the playhead inverted
    const K = D.keys[ed], b = 1 << ui.inst, r = D.st[ed], ra = D.ac[ed], rf = D.fm[ed];
    for (let j = 0; j < K.l1; j++) if (r[j] & b) step[j] = ui.fw ? (rf[j] & b ? 1 : 5) : (AC909 & b) && !(ra[j] & b) ? 5 : 1;
    if (P && !P.f && P.k === ed && P.s >= 0 && P.s < 16) step[P.s] = step[P.s] ? 4 : 3;
  } else if (run) { // the chase (TAP write: and the keys held, lit as they are hit)
    if (P && P.s >= 0 && P.s < 16) step[P.s] = 1;
    if (mode === M9_PW) for (const k of S.keys) step[k - 1] = 1;
  } else if (pat) { // stopped: the selection's key flashing, a block's others steady (PATTERN WRITE: the edited pattern's chain steady)
    step[ui.sel] = 2;
    for (let k = 1; k <= ui.bl; k++) step[ui.sel + k] = 1;
    if (mode === M9_PW) { const [a, b] = chain9(D, ed); for (let q = a; q <= b; q++) if (q !== ed) step[q & 15] = 1; }
  } else { const L = D.tk[t], j = mode === M9_TW ? ptr9(S, D, t) : loc9(S, D, t); if (j < L.length) step[L[j] & 15] = 2; } // a track stopped: the measure's key
  const g = gridPat909(S, D), sc = D.keys[g].sc, scl = [0, 0, 0, 0], trk = [0, 0, 0, 0], pa = [0, 0, 0];
  scl[sc - 1] = 1;
  if (pat) pa[ui.grp] = mode === M9_PW ? 2 : 1; else trk[ui.trk] = mode === M9_TW ? 2 : 1;
  if (S.pg >= 0) pa[S.pg] = 2;
  return { step, scl, trk, pat: pa, tkey: H.tkey || (mode === M9_PW && ui.wm === 0) ? 1 : 0, back: mode === M9_PW && ui.wm === 1 ? 1 : 0,
    fwd: !pat && ui.bank === 0 ? 1 : 0, avail: H.avail || (!pat && ui.bank === 1) ? 1 : 0,
    cyc: mode === M9_TP ? (ui.cyc ? 1 : 0) : mode === M9_PW && ui.wm === 1 && ui.guide ? 1 : 0,
    enter: S.op || S.dig !== null || (mode === M9_TW && S.pend) ? 2 : mode === M9_PW && ui.inst === 0 ? 1 : 0, disp: disp909(S, D) };
}

/* ================================================================ DEMO909 (7c §3.7: written for this project) */

// lane rows as 16-character strings by the 909's codes: 'x' a hit, 'X' accented (per-voice), 'f' a flam, 'F' an accented flam;
// I-1-1 a house groove (the kick on the quarters, the clap on 2 / 4, closed hats with the open one on the off-beat eighths, a
// crash on the first step), I-1-2 its answer (the ride, a snare flam on step 13, a tom run); SHUFFLE 3, FLAM 11 (18 ms)
function rows9(o) {
  const st = new Array(N_STEP9).fill(0), ac = st.slice(), fm = st.slice();
  for (const [code, r] of Object.entries(o)) {
    const b = 1 << LANES909[CODES909.indexOf(code.toUpperCase())];
    for (let s = 0; s < r.length; s++) {
      const c = r[s];
      if (c === '.') continue;
      st[s] |= b;
      if (c === 'X' || c === 'F') ac[s] |= b & AC909;
      if (c === 'f' || c === 'F') fm[s] |= b & FL909;
    }
  }
  return Object.freeze({ st: Object.freeze(st), ac: Object.freeze(ac), fm: Object.freeze(fm) });
}
export const DEMO909 = Object.freeze({
  a: rows9({ ac: 'x.......x.......', bd: 'X...x...x...x...', hc: '....x.......x...', ch: 'X..xX..xX..xX..x', oh: '..x...x...x...x.', cr: 'x...............' }),
  b: rows9({ ac: '....x.......x...', bd: 'x...x...x...x...', sd: '....x.......f...', hc: '....x.......x...', ch: 'X..xX..xX..x....', oh: '..x...x...x.....',
    rd: 'x.x.x.x.x.x.x.x.', ht: '.............X..', mt: '..............x.', lt: '...............x' }),
  key: Object.freeze({ sc: 1, l1: 16, sh: 3, fl: 11, ch: 0 }),
});
