/*
 * seq-core.js — pure model of the Serum-style instrument's sequencer and keyboard: arpeggiator, clip player, keyboard
 * panel (SPEC-serum2 §2.4 schemas, §3.15 constants, §4.4 compiled format, §7 semantics, §10.6–10.7 content, §11.3 API;
 * owner D6). Leaf ES module: no imports, no DOM / timers / storage access; importable from the browser, node and Workers.
 * serum-core re-exports everything here (§11.1). The worklet side is sx-seq.js (`SxSeq`), which embeds identical copies
 * of the constants it needs (compared by tests/seq.test.mjs).
 *
 * Schemas (§2.4): defaultArp / defaultClip / defaultKbd and normalizeArp / normalizeClip / normalizeKbd (idempotent,
 * return new objects, never throw). The normalisation rules are the ones serum-core applied provisionally before this
 * module existed (M1a), unchanged except: arp strum entries are sorted by time and their time is range-checked after
 * rounding. Virtual-destination bases (`slots[j].n.*`, `clips[j].n.*`) are snapped to their destination's grid
 * (`N_GRID`, = the stepped laws of §3.11.2 `arp.*` / `clip.*`).
 *
 * compileSeq(s, ctx) → { seq, seqT } (§4.4). ctx = { possOn } (optional): possOn(id) → boolean, the compiler's
 * "possibly on" test (base ≥ 0.5 or targeted by an active matrix row) — serum-core passes its own; without it the same
 * rule is evaluated from s.p and s.matrix. Pure and deterministic; a state that is not normalized is repaired
 * (normalizeArp/Clip/Kbd) before compiling, so it never throws.
 *   seq  = { ver: 1, key, active: 0 | 1, kbd: Float64Array(8), arpG: Float64Array(8), clipG: Float64Array(8), outIds }
 *     kbd   [trans, key (−1 off), scale mask, swing s, swing division (beats), arp map lo, arp map hi, arp fold]
 *           scale mask = 12-bit set of ABSOLUTE pitch classes (bit (key + step) mod 12; 0xFFF when key = −1). The ARP
 *           row's velocity range is not in kbd (8 entries are taken): the sequencer reads it from CP.mapVLo/mapVHi[5].
 *     arpG  [quant beats, midiOut, trigOct, sel, 0, −1, outTrack slot, 0]
 *     clipG [0, midiOut, trigOct, sel, trigger mode, preview index, outTrack slot, 0]    (clip quant is per clip)
 *           outTrack slot = index into outIds (the non-empty arp / clip target track ids, deduplicated), −1 none
 *   seqT = { key, parts } — delivered by part like serum-core's CT (B13): parts arp0…arp11, clip0…clip11 (SEQT_PART_NAMES).
 *     The §4.4 table describes the assembled layout; assembleSeqT(seqT) builds it (reference for SxSeq and the tests).
 *     arp<j>  { key, kind: 'arp', j, row: Float64Array(40), ev: Float64Array(5·evN), strum: Float64Array(2·strumN),
 *               lane: Float32Array(129·popcount(laneMask)) }
 *     clip<j> { key, kind: 'clip', j, row: Float64Array(24), notes: Float64Array(8·notesN), lane: Float32Array(129·…) }
 *     Rows follow §4.4 exactly; inside a part the offsets (evOff, strumOff, laneOff / notesOff, laneOff) are 0 — offsets
 *     are positions in the assembled arrays and are recomputed by whoever assembles (assembleSeqT, SxSeq.Seq.merge).
 *     Offsets count RECORDS (events, strums, notes, lane tables), not array elements. Lanes: tables of LANE_N + 1 = 129
 *     points of the lane graph at x = j/128 (laws.js renderPts), in mask-bit order (arp: vel 1, gate 2, chance 4, x 8;
 *     clip: m1…m8 = bits 0…7). Event / strum / note records are sorted (events and strums by t16, notes by t16 then note).
 *     Part keys: 8-hex FNV-1a of the part's name and the bytes of its typed arrays (UI-only fields — names, editor grid —
 *     never change a key); seqT.key = FNV-1a of the concatenated part keys in SEQT_PART_NAMES order (= seq.key). Parts
 *     and seqT are memoised by content (an unchanged slot keeps its part object): treat them as read-only, never
 *     transfer their buffers.
 *
 * Pure helpers (§11.3): arpLadder / gridLadder; quantize(note, key, scale) (§3.15.7; no MIDI-range clamping — callers
 * drop results outside 0…127), scaleMask(key, scale); swingTime(beat, s, d) (§7.2) and its inverse swingInv, swingLabel(s)
 * (Live convention, 'OFF' at 0); arpOrder(shape, notes, state) / rangeOrder(shape, R, state) (§7.4.1–7.4.2 reference:
 * arrays of steps, each step an array of MIDI notes / pass indices; `state` = {seed, prev, perm, offset} is optional and
 * updated in place by the random shapes, so successive calls continue one stream: xorshift32 draws, u = x / 2³²,
 * index = floor(u·N)); clip actions (§7.5.6): slicesToNotes / withSlices (Send to Selected Clip), wrapAt / wrapClip (Wrap
 * Clip to Begin Here), recExtend (Record EXTEND), clipToSmf (Export MIDI File), clipTrackNotes (Copy to Track); snapGrid /
 * snapTo (§13.3.2); slotName.
 * Piano-roll operations (inv B23): noteOps (clip notes [t16, len16, note, vel, mute, x, y, z]) and evOps (arp pattern
 * events [t16, len16, row, vel, accent]) — pure, every method returns NEW arrays: {list, sel} where `list` is the new
 * sorted record list and `sel` the indices of the selected records in it (see the section below for each method).
 * Content: genBassline(seed), genMelody(seed), FALLBACK_CLIPS, FACTORY_ARP_BANKS, FACTORY_CLIP_BANKS, FACTORY_PATTERNS.
 * Storage helpers (pure; the app store does the I/O): STORE_KEYS, *Payload, readLib, libPut, libDel, loadArpBank,
 * loadClipBank. Everything exported as a constant is deep-frozen.
 *
 * M3 status: schemas, compileSeq, constants, the pure helpers and the clip actions are final (the worklet side, sx-seq.js,
 * implements §7 completely). Factory content (§10.6, §10.7, original): arp banks Init · Basics · Range · Patterns (the
 * twelve FACTORY_PATTERNS after Init, one Pattern slot each), clip banks Init · Basslines · Chords · Slices · Melodies.
 * IMPL readings of the §10.6 one-liners: Pulse 8ths = rows 1–3 together on every eighth; Gallop = 16th-16th-8th per
 * beat on rows 1, 2, 3; Octave Bounce = rows 1 / −1 alternating on 16ths; Trance Gate = Chord step mode on every 16th
 * except 3, 7, 11, 14; Strum Up = Chord step mode on quarters with strum 0.4; Accent 3+3+2 = rows 1–3 cycling with
 * accents on 0, 3, 6, 8, 11, 14; Random Steps = rows 1–4 on 16ths, MODE Random, TIME 1/4; Pendulum Five = rows 1–5,
 * length 5, MODE Pendulum; Wrap Climb = rows 1–8 (length 8, WRAP; its bank slot sets WRAP RANGE 1 / TRANSPOSE 12);
 * Ghost 16ths = vel lane 110 / 40 alternating; Euclid 5/16 = row 1 at the Bjorklund positions 0, 3, 6, 9, 12. Chords:
 * half-bar chords voiced nearest to the previous chord (E3–E5); Slices: the 16 eighth-note slices of
 * `fsmp:Drum Loop 120` from note 36 (the factory sample's hit marks).
 */

/* ================================================================ small helpers */

const fin = x => typeof x === 'number' && isFinite(x);
// clamp; NaN → lo; '+ 0' turns −0 into 0 so normalised state survives a JSON round trip unchanged
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const objOf = x => (isObj(x) ? x : {});
const arrOf = x => (Array.isArray(x) ? x : []);
const intIn = (x, d, lo, hi) => (fin(x) ? clamp(Math.round(x), lo, hi) : d);
const bit = (x, d) => (typeof x === 'boolean' ? (x ? 1 : 0) : fin(x) ? (x >= 0.5 ? 1 : 0) : d);
const strIn = (x, d, max) => (typeof x === 'string' ? x.slice(0, max) : d);
const n01 = (x, d) => (fin(x) ? r5(clamp(x, 0, 1)) : d);
const mod = (a, m) => ((a % m) + m) % m;

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
// FNV-1a 32 over a string (= wt.js fnv1a32) and mulberry32 (= wt.js; main-thread generators, §0.4)
function fnvStr(s, h) {
  h = h === undefined ? 0x811c9dc5 : h;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function fnvBytes(h, ta) {
  const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const hex = h => (h >>> 0).toString(16).padStart(8, '0');
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
// the Phase-1 xorshift32 step (= SxBase.xorshift); the sequencer's random draws (§7.4.4, §7.8)
const xorshift = s => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
// Small LRU keyed by content (several tracks compile alternately)
function lruGet(cache, key, build, size) {
  let v = cache.get(key);
  if (v) { cache.delete(key); cache.set(key, v); return v; }
  v = build();
  cache.set(key, v);
  if (cache.size > size) cache.delete(cache.keys().next().value);
  return v;
}

/* ================================================================ §2.7, §4.4 sizes */

export const SQP_VER = 1;
export const N_SLOTS = 12;
export const MAX_EV = 512;               // arp pattern events per slot
export const MAX_STRUM = 512;            // strum entries per slot
export const MAX_PAT_LEN = 256;          // pattern LENGTH, sixteenths
export const MAX_CLIP_LEN = 1024;        // clip length, sixteenths
export const MAX_CLIP_NOTES = 1024;      // notes per clip
export const MAX_BANK_NOTES = 4096;      // notes per clip bank
export const LANE_N = 128;               // lane tables: LANE_N + 1 points
export const ARP_ROW = 40, CLIP_ROW = 24;
const MAX_LANE_PTS = 480;                // = serum-core MAX_PTS
const RAW_MAX = 65536;                   // hostile input bound: entries beyond this are not even inspected

/* ================================================================ §3.15 enumerations */

export const ARP_SHAPES = deepFreeze(['Played', 'Pattern', 'Chord', 'Converge', 'Diverge', 'Conv&Div', 'Down', 'Up', 'UpDown', 'DownUp',
  'Up&Down', 'Down&Up', 'Thumb Up', 'Thumb UD', 'Rand', 'Rand Once', 'Rand Drift', 'Rand NoDup']);
export const RANGE_SHAPES = deepFreeze(['Up', 'Down', 'Up/Down', 'Down/Up', 'Up+Down', 'Down+Up', 'Thumb Up', 'Thumb UD', 'Pinky Up',
  'Pinky UD', 'Converge', 'Diverge', 'Con+Diverge', 'Chord', 'Random', 'Rnd.NoDup', 'Rnd.Drift', 'Rnd.Once']);
export const ARP_PMODES = deepFreeze(['Normal', 'Reverse', 'Pendulum', 'Random', 'Rand Start', 'Rand End', 'One Shot', 'Static']);
export const STEP_MODES = deepFreeze(['Normal', 'New Only', 'Chord', 'Chord (new)']);
export const WRAP_MODES = deepFreeze(['Wrap', 'Phantom', 'Clamp']);
export const CLIP_MODES = deepFreeze(['Normal', 'Reverse', 'Pendulum', 'One Shot', 'Random', 'Rand.No Dup', 'Rand.Start', 'Rand.End', 'Static']);
export const KB_SPAN = deepFreeze(['Off', 'Mono', 'Poly', 'Offset']);
export const CLIP_TRIG = deepFreeze(['MONO', 'POLY']);
export const MIDI_OUT = deepFreeze(['Off', 'Clip Player', 'On']);
export const KEY_NAMES = deepFreeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
export const LANES_ARP = deepFreeze(['vel', 'gate', 'chance', 'x']);
export const LANES_CLIP = deepFreeze(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);

/* ================================================================ §3.15.4–3.15.6 ladders (beats; 1 bar = 4 beats) */

const lad = list => list.map(([label, beats]) => ({ label, beats }));
// ladders with dotted / triplet entries of the first `nd` straight entries, sorted slowest first (ties: straight, dot,
// trip) — the Phase-1 lfoLadder construction
function buildLadders(base, nd) {
  const out = [];
  for (let v = 0; v < 4; v++) {
    const dot = v & 1, trip = v >> 1, L = [];
    base.forEach(e => L.push({ label: e.label, beats: e.beats, k: 0 }));
    if (dot) for (let i = 0; i < nd; i++) L.push({ label: base[i].label + '.', beats: base[i].beats * 1.5, k: 1 });
    if (trip) for (let i = 0; i < nd; i++) L.push({ label: base[i].label + 'T', beats: base[i].beats * 2 / 3, k: 2 });
    L.sort((a, b) => b.beats - a.beats || a.k - b.k);
    out.push(deepFreeze(L.map(e => ({ label: e.label, beats: e.beats }))));
  }
  return deepFreeze(out);
}
export const ARP_LADDER = deepFreeze(lad([['4 bar', 16], ['2 bar', 8], ['1 bar', 4], ['1/2', 2], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25],
  ['1/32', 0.125], ['1/64', 0.0625]]));
const ARP_LADDERS = buildLadders(ARP_LADDER, 8);                                                  // lengths 9 / 17 / 17 / 25
const GRID_LADDERS = buildLadders(ARP_LADDER.concat(lad([['1/128', 1 / 32], ['1/256', 1 / 64]])), 8);   // 11 / 19 / 19 / 27
/** [{label, beats}] slowest → fastest (frozen, shared): the arp RATE ladder in BPM mode (§3.15.4). */
export function arpLadder(dot, trip) { return ARP_LADDERS[(dot ? 1 : 0) + (trip ? 2 : 0)]; }
/** Granular DENS / LENGTH ladder in BPM mode: ARP_LADDER extended to 1/128 and 1/256 (§3.15.4). */
export function gridLadder(dot, trip) { return GRID_LADDERS[(dot ? 1 : 0) + (trip ? 2 : 0)]; }
export const GRID_LADDER = deepFreeze(lad([['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/64', 0.0625], ['1/8T', 1 / 3],
  ['1/16T', 1 / 6]]));
export const TIME_LADDER = deepFreeze(lad([['1/16', 0.25], ['1/8', 0.5], ['1/4', 1], ['1/2', 2], ['1 bar', 4], ['2 bar', 8], ['4 bar', 16]]));
export const RRATE_LADDER = deepFreeze(lad([['1/4', 1], ['1/2', 2], ['1 bar', 4], ['2 bar', 8], ['4 bar', 16], ['8 bar', 32]]));
export const CLIP_RATES = deepFreeze(['×1/4', '×1/3', '×1/2', '×2/3', '×3/4', '×1', '×4/3', '×3/2', '×2', '×3', '×4']);
export const CLIP_RATE_VALUES = deepFreeze([1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4]);
export const LAUNCH_QUANT = deepFreeze(lad([['Off', 0], ['1/32', 0.125], ['1/16', 0.25], ['1/8', 0.5], ['1/4', 1], ['1/2', 2], ['1 bar', 4],
  ['2 bar', 8], ['4 bar', 16]]));
export const LEN_LADDER = deepFreeze(lad([['1/16', 0.25], ['1/8', 0.5], ['1/4', 1], ['1/2', 2], ['3/4', 3], ['1 bar', 4], ['1.5 bar', 6],
  ['2 bar', 8], ['3 bar', 12], ['4 bar', 16], ['6 bar', 24], ['8 bar', 32], ['12 bar', 48], ['16 bar', 64], ['32 bar', 128]]));
// kbd.div (§2.4.3): swing division
export const SWING_DIVS = deepFreeze(lad([['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125]]));
/** Arp RATE in Hz mode: 0.5·100^n (§3.2 arpRate). */
export const arpRateHz = n => 0.5 * Math.pow(100, n);

/* ================================================================ §3.15.7 scales */

const SCALE_TABLE = [
  ['Major', '0 2 4 5 7 9 11'], ['Natural Minor', '0 2 3 5 7 8 10'], ['Harmonic Minor', '0 2 3 5 7 8 11'],
  ['Melodic Minor', '0 2 3 5 7 9 11'], ['Dorian', '0 2 3 5 7 9 10'], ['Phrygian', '0 1 3 5 7 8 10'], ['Lydian', '0 2 4 6 7 9 11'],
  ['Mixolydian', '0 2 4 5 7 9 10'], ['Locrian', '0 1 3 5 6 8 10'], ['Major Pentatonic', '0 2 4 7 9'], ['Minor Pentatonic', '0 3 5 7 10'],
  ['Blues', '0 3 5 6 7 10'], ['Major Blues', '0 2 3 4 7 9'], ['Whole Tone', '0 2 4 6 8 10'], ['Diminished (W-H)', '0 2 3 5 6 8 9 11'],
  ['Diminished (H-W)', '0 1 3 4 6 7 9 10'], ['Augmented', '0 3 4 7 8 11'], ['Chromatic', '0 1 2 3 4 5 6 7 8 9 10 11'],
  ['Hungarian Minor', '0 2 3 6 7 8 11'], ['Double Harmonic', '0 1 4 5 7 8 11'], ['Neapolitan Major', '0 1 3 5 7 9 11'],
  ['Neapolitan Minor', '0 1 3 5 7 8 11'], ['Persian', '0 1 4 5 6 8 11'], ['Phrygian Dominant', '0 1 4 5 7 8 10'],
  ['Lydian Dominant', '0 2 4 6 7 9 10'], ['Altered', '0 1 3 4 6 8 10'], ['Bebop Major', '0 2 4 5 7 8 9 11'],
  ['Bebop Dominant', '0 2 4 5 7 9 10 11'], ['In', '0 1 5 7 8'], ['Hirajoshi', '0 2 3 7 8'], ['Iwato', '0 1 5 6 10'], ['Kumoi', '0 2 3 7 9'],
  ['Pelog', '0 1 3 7 8'], ['Egyptian', '0 2 5 7 10'], ['Prometheus', '0 2 4 6 9 10'], ['Enigmatic', '0 1 4 6 8 10 11'],
  ['Arabian', '0 2 4 5 6 8 10'], ['Spanish 8-Tone', '0 1 3 4 5 6 8 10'], ['Hungarian Major', '0 3 4 6 7 9 10'], ['Yo', '0 2 5 7 9'],
  ['Major Hexatonic', '0 2 4 5 7 9'], ['Minor Hexatonic', '0 2 3 5 7 10'],
];
// id: lower-case words joined by '-' ('natural-minor', 'diminished-w-h', 'spanish-8-tone')
export const SCALES = deepFreeze(SCALE_TABLE.map(([name, steps]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, steps: steps.split(' ').map(Number),
})));
const N_SCALES = SCALES.length;   // 42
// relative masks (key C): bit = semitone above the key
const REL_MASK = SCALES.map(sc => sc.steps.reduce((m, k) => m | (1 << k), 0));

/** 12-bit set of the ABSOLUTE pitch classes of `scale` in `key` (bit pc); key −1 (off) → 0xFFF. */
export function scaleMask(key, scale) {
  const k = intIn(key, -1, -1, 11);
  if (k < 0) return 0xFFF;
  const rel = REL_MASK[intIn(scale, 0, 0, N_SCALES - 1)];
  return ((rel << k) | (rel >>> (12 - k))) & 0xFFF;
}
/**
 * KEY/SCALE quantise (§3.15.7): key −1 → unchanged; else the nearest scale member by circular distance, ties → the lower
 * one (smaller resulting pitch), applied with the ±12 wrap that gives the smallest |Δ|. No range clamping.
 */
export function quantize(note, key, scale) {
  const k = intIn(key, -1, -1, 11);
  if (k < 0 || !fin(note)) return note;
  const m = scaleMask(k, scale), n = Math.round(note), pc = mod(n, 12);
  for (let d = 0; d <= 6; d++) {
    if ((m >> mod(pc - d, 12)) & 1) return n - d;
    if ((m >> mod(pc + d, 12)) & 1) return n + d;
  }
  return n;   // not reached: every scale has a member within 6 semitones
}

/* ================================================================ §7.2 swing */

/**
 * Swung position of `beat` (s ∈ [−1, 1], division d in beats): inside each pair [2kd, 2kd + 2d) the pair midpoint moves
 * from 2kd + d to 2kd + d·(1 + 0.75·s), piecewise linear. s = 0 returns `beat` exactly.
 */
export function swingTime(beat, s, d) {
  if (s === 0 || !(d > 0) || !fin(beat)) return beat;
  const P = 2 * d, k = Math.floor(beat / P), u = beat - k * P, m = d * (1 + 0.75 * clamp(s, -1, 1));
  return k * P + (u < d ? u * m / d : m + (u - d) * (P - m) / d);
}
/** Inverse of swingTime (straight position of a swung position). */
export function swingInv(beat, s, d) {
  if (s === 0 || !(d > 0) || !fin(beat)) return beat;
  const P = 2 * d, k = Math.floor(beat / P), u = beat - k * P, m = d * (1 + 0.75 * clamp(s, -1, 1));
  return k * P + (u < m ? u * d / m : d + (u - m) * d / (P - m));
}
/** SWING display in Live's convention: 50 + 37.5·s % (12.5–87.5 %), 'OFF' only at s = 0 (inv B21). */
export function swingLabel(s) {
  if (!fin(s) || s === 0) return 'OFF';
  return (50 + 37.5 * clamp(s, -1, 1)).toFixed(1) + '%';
}

/* ================================================================ §7.4.1–7.4.2 note orders (reference) */

const drawIdx = (st, n) => { st.seed = xorshift(st.seed); return Math.floor((st.seed / 4294967296) * n); };
const range = (a, b) => { const o = []; if (a <= b) for (let i = a; i <= b; i++) o.push(i); else for (let i = a; i >= b; i--) o.push(i); return o; };
const upDown = (lo, hi) => (hi > lo ? range(lo, hi).concat(hi - 1 > lo ? range(hi - 1, lo + 1) : []) : [lo]);
function converge(n) { const o = []; for (let a = 0, b = n - 1; a <= b; a++, b--) { o.push(a); if (b !== a) o.push(b); } return o; }
// one pass of a sequence kind over N elements (indices); random kinds draw from st
function passOf(kind, N, st) {
  if (N <= 0) return [];
  switch (kind) {
    case 'up': return range(0, N - 1);
    case 'down': return range(N - 1, 0);
    case 'updown': return upDown(0, N - 1);
    case 'downup': return N > 1 ? range(N - 1, 0).concat(N - 2 >= 1 ? range(1, N - 2) : []) : [0];
    case 'up&down': return range(0, N - 1).concat(range(N - 1, 0));
    case 'down&up': return range(N - 1, 0).concat(range(0, N - 1));
    case 'converge': return converge(N);
    case 'diverge': return converge(N).reverse();
    case 'convdiv': return converge(N).concat(converge(N).reverse().slice(1));
    case 'thumbup': { if (N === 1) return [0]; const o = []; for (let i = 1; i < N; i++) o.push(0, i); return o; }
    case 'thumbud': { if (N === 1) return [0]; const o = []; for (const i of upDown(1, N - 1)) o.push(0, i); return o; }
    case 'pinkyup': { if (N === 1) return [0]; const o = []; for (let i = 0; i < N - 1; i++) o.push(N - 1, i); return o; }
    case 'pinkyud': { if (N === 1) return [0]; const o = []; for (const i of upDown(0, N - 2)) o.push(N - 1, i); return o; }
    case 'chord': return [-1];
    case 'rand': { const o = []; for (let i = 0; i < N; i++) o.push(drawIdx(st, N)); st.prev = o[N - 1]; return o; }
    case 'nodup': {
      const o = [];
      let p = st.prev;
      for (let i = 0; i < N; i++) {
        if (N === 1) p = 0;
        else if (p >= 0 && p < N) { const k = drawIdx(st, N - 1); p = k >= p ? k + 1 : k; } else p = drawIdx(st, N);
        o.push(p);
      }
      st.prev = p;
      return o;
    }
    case 'drift': {
      const o = [];
      let p = st.prev >= 0 && st.prev < N ? st.prev : -1;
      for (let i = 0; i < N; i++) {
        if (p < 0) p = 0;
        else if (N > 1) { p += drawIdx(st, 2) ? 1 : -1; if (p < 0) p = 1; else if (p > N - 1) p = N - 2; }
        o.push(p);
      }
      st.prev = p;
      return o;
    }
    case 'once': {
      if (!Array.isArray(st.perm) || st.perm.length !== N) {
        const P = range(0, N - 1);
        for (let i = N - 1; i > 0; i--) { const j = drawIdx(st, i + 1), t = P[i]; P[i] = P[j]; P[j] = t; }
        st.perm = P;
      }
      return st.perm.slice();
    }
    default: return range(0, N - 1);
  }
}
const ARP_KIND = ['played', 'pattern', 'chord', 'converge', 'diverge', 'convdiv', 'down', 'up', 'updown', 'downup', 'up&down', 'down&up',
  'thumbup', 'thumbud', 'rand', 'once', 'drift', 'nodup'];
const RANGE_KIND = ['up', 'down', 'updown', 'downup', 'up&down', 'down&up', 'thumbup', 'thumbud', 'pinkyup', 'pinkyud', 'converge', 'diverge',
  'convdiv', 'chord', 'rand', 'nodup', 'drift', 'once'];
const stateOf = st => {
  const S = isObj(st) ? st : {};
  S.seed = fin(S.seed) && (S.seed >>> 0) ? S.seed >>> 0 : 0x9E3779B9;
  if (!fin(S.prev)) S.prev = -1;
  return S;
};
const rotate = (a, k) => { const n = a.length; if (!n) return a; const r = mod(Math.round(k) || 0, n); return r ? a.slice(r).concat(a.slice(0, r)) : a; };
/**
 * One pass of the arpeggiator SHAPE over the held notes (§7.4.1): an array of steps, each an array of MIDI notes
 * (Chord: every note in one step). `notes` in arrival order; every shape except Played sorts them ascending (duplicates
 * removed). Pattern (shape 1) has no note order: []. state.offset (OFFSET) rotates the pass.
 */
export function arpOrder(shape, notes, state) {
  const sh = intIn(shape, 7, 0, 17), kind = ARP_KIND[sh], S = stateOf(state);
  const H = arrOf(notes).filter(fin);
  if (kind === 'pattern' || !H.length) return [];
  const N = kind === 'played' ? H.length : 0;
  const sorted = kind === 'played' ? H : Array.from(new Set(H)).sort((a, b) => a - b);
  if (kind === 'chord') return [sorted.slice()];
  const idx = passOf(kind === 'played' ? 'up' : kind, N || sorted.length, S);
  return rotate(idx.map(i => [sorted[i]]), S.offset || 0);
}
/** One cycle of the transpose RANGE shape over R passes (§7.4.2): an array of steps, each an array of pass indices. */
export function rangeOrder(shape, R, state) {
  const kind = RANGE_KIND[intIn(shape, 0, 0, 17)], n = intIn(R, 1, 1, 64), S = stateOf(state);
  if (kind === 'chord') return [range(0, n - 1)];
  return passOf(kind, n, S).map(i => [i]);
}

/* ================================================================ §2.4 schemas */

export const ARP_N = deepFreeze({ rate: 0.75, hz: 0.5, shift: 0.75, range: 0, offset: 0, repeats: 0, gate: 0.375, chance: 1, rrate: 0.4,
  vdecay: 0.5, vtarget: 0.5, trans: 0.5, wtrans: 0.5, wrange: 0 });
export const CLIP_N = deepFreeze({ trans: 0.5, rate: 0.5, offset: 0 });
// grid steps of the virtual destinations' stepped laws (§3.11.2 int / enum rows: hi − lo); the others are continuous
export const N_GRID = deepFreeze({ 'arp.shift': 48, 'arp.range': 7, 'arp.offset': 15, 'arp.repeats': 16, 'arp.rrate': 5, 'arp.trans': 48,
  'arp.wtrans': 24, 'arp.wrange': 8, 'clip.trans': 48, 'clip.rate': 10 });
const ARP_NK = Object.keys(ARP_N), CLIP_NK = Object.keys(CLIP_N);

export function defaultPattern() {
  return { name: 'Init', len: 16, mode: 0, time: 4, stepMode: 0, wrap: 0, grid: 2, ev: [], strum: [],
    lanes: { vel: null, gate: null, chance: null, x: null } };
}
export function defaultArpSlot() {
  return { name: '', shape: 7, bpm: 1, trip: 0, dot: 0, n: Object.assign({}, ARP_N), rshape: 0, latch: 0, thru: 0, chancePre: 0,
    rLaunch: 1, rRate: 0, rNote: 0, rFirst: 0, vel: 0, vRetrig: 1, pat: defaultPattern() };
}
export function defaultArp() {
  return { bank: 'Init', dirty: 0, sel: 0, quant: 4, editAll: 0, midiOut: 0, outTrack: '', trigOct: 1,
    slots: Array.from({ length: N_SLOTS }, defaultArpSlot) };
}
export function defaultClipSlot() {
  return { name: '', len: 64, start: 0, off: 0, offQ: 2, kb: 1, mode: 0, time: 4, quant: 6, retrig: 1, veloTrig: 0, noteGate: 0,
    n: Object.assign({}, CLIP_N), notes: [], lanes: LANES_CLIP.reduce((o, k) => { o[k] = null; return o; }, {}) };
}
export function defaultClip() {
  return { bank: 'Init', dirty: 0, sel: 0, trig: 0, editAll: 0, midiOut: 0, outTrack: '', trigOct: 1, preview: -1,
    rec: { mode: 0, metro: 1 }, clips: Array.from({ length: N_SLOTS }, defaultClipSlot) };
}
const defMap = () => ({ k: [0, 127], v: [1, 127], fold: 0 });
export function defaultKbd() { return { trans: 0, key: -1, scale: 0, swing: 0, div: 1, arpMap: defMap() }; }

// Repairs a lane graph (§2.3 of Phase 1): drops malformed points, clamps, rounds to 5 decimals, sorts by x (stable), keeps
// ≤ 480 points, forces x = 0 / 1 at the ends; no valid point → null (no lane)
function normLane(raw) {
  if (!Array.isArray(raw)) return null;
  let out = [];
  for (let i = 0, n = Math.min(raw.length, RAW_MAX); i < n; i++) {
    const p = raw[i];
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) continue;
    out.push([r5(clamp(p[0], 0, 1)), r5(clamp(p[1], 0, 1)), fin(p[2]) ? r5(clamp(p[2], -1, 1)) : 0]);
  }
  if (!out.length) return null;
  out.sort((a, b) => a[0] - b[0]);
  if (out.length > MAX_LANE_PTS) out = out.slice(0, MAX_LANE_PTS);
  if (out.length === 1) out.push([1, out[0][1], 0]);
  out[0][0] = 0;
  out[out.length - 1][0] = 1;
  return out;
}
// virtual-destination bases of an arp slot / clip, snapped to the destinations' grids
const normNs = (x, defs, pre) => {
  const S = objOf(x), o = {};
  for (const k of Object.keys(defs)) {
    const m = N_GRID[pre + k] || 0, v = fin(S[k]) ? r5(clamp(S[k], 0, 1)) : NaN;
    o[k] = v === v ? (m ? Math.round(v * m) / m : v) + 0 : defs[k];
  }
  return o;
};
const pairInts = (x, lo, hi, d) => {
  const a = arrOf(x), u = intIn(a[0], d[0], lo, hi), w = intIn(a[1], d[1], lo, hi);
  return u <= w ? [u, w] : [w, u];
};
const normMap = m => { const M = objOf(m); return { k: pairInts(M.k, 0, 127, [0, 127]), v: pairInts(M.v, 1, 127, [1, 127]), fold: bit(M.fold, 0) }; };

/** One arp slot (§2.4.1), normalised. */
export function normalizeArpSlot(x) {
  const S = objOf(x), P = objOf(S.pat), len = intIn(P.len, 16, 1, MAX_PAT_LEN), lanes = objOf(P.lanes), ev = [], strum = [];
  for (const e of arrOf(P.ev).slice(0, RAW_MAX)) {
    if (ev.length >= MAX_EV || !Array.isArray(e) || !fin(e[0]) || !fin(e[1]) || !fin(e[2])) continue;
    const row = clamp(Math.round(e[2]), -32, 32), t = r5(e[0]), l = r5(e[1]);
    if (!row || t < 0 || t >= len || !(l > 0)) continue;
    ev.push([t, l, row, intIn(e[3], 100, 1, 127), bit(e[4], 0)]);
  }
  ev.sort((a, b) => a[0] - b[0]);
  for (const e of arrOf(P.strum).slice(0, RAW_MAX)) {
    if (strum.length >= MAX_STRUM || !Array.isArray(e) || !fin(e[0])) continue;
    const t = r5(e[0]);
    if (t >= 0 && t < len) strum.push([t, n01(e[1], 0)]);
  }
  strum.sort((a, b) => a[0] - b[0]);
  return {
    name: strIn(S.name, '', 32), shape: intIn(S.shape, 7, 0, 17), bpm: bit(S.bpm, 1), trip: bit(S.trip, 0), dot: bit(S.dot, 0),
    n: normNs(S.n, ARP_N, 'arp.'), rshape: intIn(S.rshape, 0, 0, 17), latch: bit(S.latch, 0), thru: bit(S.thru, 0), chancePre: bit(S.chancePre, 0),
    rLaunch: bit(S.rLaunch, 1), rRate: bit(S.rRate, 0), rNote: bit(S.rNote, 0), rFirst: bit(S.rFirst, 0), vel: bit(S.vel, 0), vRetrig: bit(S.vRetrig, 1),
    pat: { name: strIn(P.name, 'Init', 32), len, mode: intIn(P.mode, 0, 0, 7), time: intIn(P.time, 4, 0, 6), stepMode: intIn(P.stepMode, 0, 0, 3),
      wrap: intIn(P.wrap, 0, 0, 2), grid: intIn(P.grid, 2, 0, 6), ev, strum,
      lanes: LANES_ARP.reduce((o, k) => { o[k] = normLane(lanes[k]); return o; }, {}) },
  };
}
/** `s.arp` (§2.4.1), normalised; idempotent, returns a new object. */
export function normalizeArp(x) {
  const S = objOf(x), sl = arrOf(S.slots);
  return { bank: strIn(S.bank, 'Init', 64), dirty: bit(S.dirty, 0), sel: intIn(S.sel, 0, 0, 11), quant: intIn(S.quant, 4, 0, 8), editAll: bit(S.editAll, 0),
    midiOut: intIn(S.midiOut, 0, 0, 2), outTrack: strIn(S.outTrack, '', 64), trigOct: intIn(S.trigOct, 1, 0, 11),
    slots: Array.from({ length: N_SLOTS }, (_, j) => normalizeArpSlot(sl[j])) };
}
// one clip with at most `budget` notes (the bank budget, §2.7)
function normClipSlot(x, budget) {
  const C = objOf(x), len = intIn(C.len, 64, 1, MAX_CLIP_LEN), start = intIn(C.start, 0, 0, len - 1), lanes = objOf(C.lanes), notes = [];
  for (const e of arrOf(C.notes).slice(0, RAW_MAX)) {
    if (notes.length >= MAX_CLIP_NOTES || notes.length >= budget || !Array.isArray(e) || !fin(e[0]) || !fin(e[1]) || !fin(e[2])) continue;
    const t = r5(e[0]), l = r5(e[1]);
    if (t < 0 || !(l > 0)) continue;   // (checked after rounding: a normalized note never has length 0)
    notes.push([t, l, intIn(e[2], 60, 0, 127), intIn(e[3], 100, 1, 127), bit(e[4], 0), n01(e[5], 0.5), n01(e[6], 0.5), n01(e[7], 0)]);
  }
  notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  return {
    name: strIn(C.name, '', 32), len, start, off: intIn(C.off, start, start, len - 1), offQ: intIn(C.offQ, 2, 0, 6), kb: intIn(C.kb, 1, 0, 3),
    mode: intIn(C.mode, 0, 0, 8), time: intIn(C.time, 4, 0, 6), quant: intIn(C.quant, 6, 0, 8), retrig: bit(C.retrig, 1),
    veloTrig: bit(C.veloTrig, 0), noteGate: bit(C.noteGate, 0), n: normNs(C.n, CLIP_N, 'clip.'), notes,
    lanes: LANES_CLIP.reduce((o, k) => { o[k] = normLane(lanes[k]); return o; }, {}),
  };
}
/** One clip (§2.4.2), normalised (≤ 1024 notes). */
export function normalizeClipSlot(x) { return normClipSlot(x, MAX_CLIP_NOTES); }
/** `s.clip` (§2.4.2), normalised (≤ 4096 notes per bank, earlier clips first); idempotent, returns a new object. */
export function normalizeClip(x) {
  const S = objOf(x), cl = arrOf(S.clips), rec = objOf(S.rec);
  let budget = MAX_BANK_NOTES;
  const clips = Array.from({ length: N_SLOTS }, (_, j) => { const c = normClipSlot(cl[j], budget); budget -= c.notes.length; return c; });
  return { bank: strIn(S.bank, 'Init', 64), dirty: bit(S.dirty, 0), sel: intIn(S.sel, 0, 0, 11), trig: intIn(S.trig, 0, 0, 1), editAll: bit(S.editAll, 0),
    midiOut: intIn(S.midiOut, 0, 0, 2), outTrack: strIn(S.outTrack, '', 64), trigOct: intIn(S.trigOct, 1, 0, 11), preview: intIn(S.preview, -1, -1, 11),
    rec: { mode: intIn(rec.mode, 0, 0, 1), metro: bit(rec.metro, 1) }, clips };
}
/** `s.kbd` (§2.4.3), normalised. */
export function normalizeKbd(x) {
  const S = objOf(x);
  return { trans: intIn(S.trans, 0, -24, 24), key: intIn(S.key, -1, -1, 11), scale: intIn(S.scale, 0, 0, N_SCALES - 1),
    swing: fin(S.swing) ? r5(clamp(S.swing, -1, 1)) : 0, div: intIn(S.div, 1, 0, 2), arpMap: normMap(S.arpMap) };
}

/* ================================================================ §4.4 compileSeq */

// Phase-1 graph evaluation (= laws.js bend / evalPts with CURVE_K 10; a lane is a §2.3 graph)
const CURVE_K = 10;
const bend = (t, k) => (Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k)));
function evalPts(pts, x) {
  if (!pts || !pts.length) return 0;
  const last = pts.length - 1;
  if (x <= 0 || x < pts[0][0]) return pts[0][1];
  if (x >= 1) return pts[last][1];
  let lo = 0, hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= x) lo = mid; else hi = mid - 1;
  }
  if (lo === last) return pts[last][1];
  const p = pts[lo], q = pts[lo + 1], dx = q[0] - p[0];
  if (dx <= 1e-9) return q[1];
  return p[1] + (q[1] - p[1]) * bend((x - p[0]) / dx, CURVE_K * (p[2] || 0));
}

// The builders below read a NORMALIZED state and throw BAD on anything else (compileSeq then repairs and retries).
const BAD = { bad: 1 };
const chk = c => { if (!c) throw BAD; };
const I = (x, lo, hi) => { chk(Number.isInteger(x) && x >= lo && x <= hi); return x; };
const U = x => { chk(fin(x) && x >= 0 && x <= 1); return x; };
function chkLane(p) {
  if (p === null) return 0;
  chk(Array.isArray(p) && p.length >= 2 && p.length <= MAX_LANE_PTS);
  let px = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    chk(Array.isArray(q) && fin(q[0]) && fin(q[1]) && q[0] >= px && q[0] <= 1 && q[1] >= 0 && q[1] <= 1);
    chk(q[2] === undefined || (fin(q[2]) && q[2] >= -1 && q[2] <= 1));
    px = q[0];
  }
  chk(p[0][0] === 0 && p[p.length - 1][0] === 1);
  return 1;
}
function laneTabs(lanes, names) {
  chk(isObj(lanes));
  let mask = 0, n = 0;
  names.forEach((k, b) => { if (chkLane(lanes[k] === undefined ? null : lanes[k])) { mask |= 1 << b; n++; } });
  const tab = new Float32Array((LANE_N + 1) * n);
  let o = 0;
  names.forEach((k, b) => {
    if (!(mask & (1 << b))) return;
    for (let j = 0; j <= LANE_N; j++) tab[o + j] = evalPts(lanes[k], j / LANE_N);
    o += LANE_N + 1;
  });
  return { mask, tab };
}
function arpPart(S, j) {
  chk(isObj(S) && isObj(S.n) && isObj(S.pat));
  const P = S.pat, len = I(P.len, 1, MAX_PAT_LEN), ev = P.ev, st = P.strum;
  chk(Array.isArray(ev) && ev.length <= MAX_EV && Array.isArray(st) && st.length <= MAX_STRUM);
  const row = new Float64Array(ARP_ROW);
  row[0] = I(S.shape, 0, 17); row[1] = I(S.bpm, 0, 1); row[2] = I(S.trip, 0, 1); row[3] = I(S.dot, 0, 1);
  for (let k = 0; k < ARP_NK.length; k++) row[4 + k] = U(S.n[ARP_NK[k]]);
  row[18] = I(S.rshape, 0, 17);
  ['latch', 'thru', 'chancePre', 'rLaunch', 'rRate', 'rNote', 'rFirst', 'vel', 'vRetrig'].forEach((k, i) => { row[19 + i] = I(S[k], 0, 1); });
  row[28] = len; row[29] = I(P.mode, 0, 7); row[30] = TIME_LADDER[I(P.time, 0, 6)].beats; row[31] = I(P.stepMode, 0, 3); row[32] = I(P.wrap, 0, 2);
  const E = new Float64Array(5 * ev.length), es = ev.slice().sort((a, b) => a[0] - b[0]);
  es.forEach((e, i) => {
    chk(Array.isArray(e) && fin(e[0]) && e[0] >= 0 && e[0] < len && fin(e[1]) && e[1] > 0 && Number.isInteger(e[2]) && e[2] !== 0
      && e[2] >= -32 && e[2] <= 32);
    E[5 * i] = e[0]; E[5 * i + 1] = e[1]; E[5 * i + 2] = e[2]; E[5 * i + 3] = I(e[3], 1, 127); E[5 * i + 4] = I(e[4], 0, 1);
  });
  const M = new Float64Array(2 * st.length), ss = st.slice().sort((a, b) => a[0] - b[0]);
  ss.forEach((e, i) => { chk(Array.isArray(e) && fin(e[0]) && e[0] >= 0 && e[0] < len); M[2 * i] = e[0]; M[2 * i + 1] = U(e[1]); });
  const L = laneTabs(P.lanes, LANES_ARP);
  row[34] = ev.length; row[36] = st.length; row[37] = L.mask;      // evOff [33], strumOff [35], laneOff [38] stay 0 in a part
  return { key: '', kind: 'arp', j, row, ev: E, strum: M, lane: L.tab };
}
function clipPart(C, j) {
  chk(isObj(C) && isObj(C.n) && Array.isArray(C.notes) && C.notes.length <= MAX_CLIP_NOTES);
  const len = I(C.len, 1, MAX_CLIP_LEN), start = I(C.start, 0, len - 1), row = new Float64Array(CLIP_ROW);
  row[0] = len; row[1] = start; row[2] = I(C.off, start, len - 1); row[3] = GRID_LADDER[I(C.offQ, 0, 6)].beats; row[4] = I(C.kb, 0, 3);
  row[5] = I(C.mode, 0, 8); row[6] = TIME_LADDER[I(C.time, 0, 6)].beats; row[7] = LAUNCH_QUANT[I(C.quant, 0, 8)].beats;
  row[8] = I(C.retrig, 0, 1); row[9] = I(C.veloTrig, 0, 1); row[10] = I(C.noteGate, 0, 1);
  for (let k = 0; k < CLIP_NK.length; k++) row[11 + k] = U(C.n[CLIP_NK[k]]);
  const ns = C.notes.slice().sort((a, b) => a[0] - b[0] || a[2] - b[2]), N = new Float64Array(8 * ns.length);
  ns.forEach((e, i) => {
    chk(Array.isArray(e) && fin(e[0]) && e[0] >= 0 && fin(e[1]) && e[1] > 0);
    N[8 * i] = e[0]; N[8 * i + 1] = e[1]; N[8 * i + 2] = I(e[2], 0, 127); N[8 * i + 3] = I(e[3], 1, 127); N[8 * i + 4] = I(e[4], 0, 1);
    N[8 * i + 5] = U(e[5]); N[8 * i + 6] = U(e[6]); N[8 * i + 7] = U(e[7]);
  });
  const L = laneTabs(C.lanes, LANES_CLIP);
  row[15] = ns.length; row[16] = L.mask;                           // notesOff [14], laneOff [17] stay 0 in a part
  return { key: '', kind: 'clip', j, row, notes: N, lane: L.tab };
}
const PART_CACHE = new Map(), SEQT_CACHE = new Map();
// content key and memo: an unchanged part keeps its object
function keyed(p) {
  let h = fnvStr(p.kind + p.j);
  h = fnvBytes(h, p.row);
  if (p.kind === 'arp') { h = fnvBytes(h, p.ev); h = fnvBytes(h, p.strum); } else h = fnvBytes(h, p.notes);
  h = fnvBytes(h, p.lane);
  p.key = hex(h);
  return lruGet(PART_CACHE, p.key, () => p, 256);
}
export const SEQT_PART_NAMES = deepFreeze([...Array.from({ length: N_SLOTS }, (_, j) => 'arp' + j), ...Array.from({ length: N_SLOTS }, (_, j) => 'clip' + j)]);

const rowActive = r => isObj(r) && !!r.src && !!r.dst && !r.byp && fin(r.amt) && r.amt !== 0 && fin(r.out) && r.out !== 0;
const fullMap = m => isObj(m) && Array.isArray(m.k) && Array.isArray(m.v) && m.k[0] === 0 && m.k[1] === 127 && m.v[0] <= 1 && m.v[1] === 127;
function possOnOf(s, ctx) {
  if (ctx && typeof ctx.possOn === 'function') return id => !!ctx.possOn(id);
  const P = objOf(s.p), rows = arrOf(s.matrix);
  return id => (fin(P[id]) && P[id] >= 0.5) || rows.some(r => rowActive(r) && r.dst === id);
}
function compileFrom(s, A, C, K, ctx) {
  // parts
  chk(isObj(A) && Array.isArray(A.slots) && A.slots.length === N_SLOTS && isObj(C) && Array.isArray(C.clips) && C.clips.length === N_SLOTS);
  const parts = {};
  let total = 0;
  A.slots.forEach((S, j) => { parts['arp' + j] = keyed(arpPart(S, j)); });
  C.clips.forEach((X, j) => { const p = keyed(clipPart(X, j)); total += p.row[15]; parts['clip' + j] = p; });
  chk(total <= MAX_BANK_NOTES);
  const key = hex(fnvStr(SEQT_PART_NAMES.map(n => parts[n].key).join('')));
  const seqT = lruGet(SEQT_CACHE, key, () => ({ key, parts }), 16);
  // globals
  chk(isObj(K) && isObj(K.arpMap) && Array.isArray(K.arpMap.k));
  const kbd = new Float64Array(8);
  kbd[0] = I(K.trans, -24, 24); kbd[1] = I(K.key, -1, 11); kbd[2] = scaleMask(K.key, I(K.scale, 0, N_SCALES - 1));
  chk(fin(K.swing) && K.swing >= -1 && K.swing <= 1); kbd[3] = K.swing; kbd[4] = SWING_DIVS[I(K.div, 0, 2)].beats;
  kbd[5] = I(K.arpMap.k[0], 0, 127); kbd[6] = I(K.arpMap.k[1], kbd[5], 127); kbd[7] = I(K.arpMap.fold, 0, 1);
  const outIds = [];
  const slot = id => { chk(typeof id === 'string'); if (!id) return -1; let i = outIds.indexOf(id); if (i < 0) { i = outIds.length; outIds.push(id); } return i; };
  const arpG = new Float64Array(8), clipG = new Float64Array(8);
  arpG[0] = LAUNCH_QUANT[I(A.quant, 0, 8)].beats; arpG[1] = I(A.midiOut, 0, 2); arpG[2] = I(A.trigOct, 0, 11); arpG[3] = I(A.sel, 0, 11);
  arpG[4] = 0; arpG[5] = -1; arpG[6] = slot(A.outTrack);
  clipG[0] = 0; clipG[1] = I(C.midiOut, 0, 2); clipG[2] = I(C.trigOct, 0, 11); clipG[3] = I(C.sel, 0, 11); clipG[4] = I(C.trig, 0, 1);
  clipG[5] = I(C.preview, -1, 11); clipG[6] = slot(C.outTrack);
  // §4.4 seq.active: arp / clip possibly on, keyboard transpose or key, or any OSC MAPPING row (A, B, C, Noise, Sub, ARP)
  // narrower than full range (the trigger-octave clause needs its module possibly on, so it is covered by the first)
  const possOn = possOnOf(s, ctx), maps = arrOf(s.osc).map(O => objOf(O).map).concat([objOf(s.sub).map, objOf(s.noise).map, K.arpMap]);
  const active = possOn('arp.on') || possOn('clip.on') || K.trans !== 0 || K.key >= 0 || maps.some(m => m !== undefined && !fullMap(m)) ? 1 : 0;
  return { seq: { ver: SQP_VER, key, active, kbd, arpG, clipG, outIds }, seqT };
}
/**
 * §4.4: the sequencer patch of a (normalized) Serum state → { seq, seqT }. Memoised by content (parts and seqT objects
 * are shared between compiles: read-only). Never throws: a state whose arp / clip / kbd is not normalized is repaired
 * first (normalizeArp / normalizeClip / normalizeKbd).
 */
export function compileSeq(s, ctx) {
  const S = objOf(s);
  try {
    return compileFrom(S, S.arp, S.clip, S.kbd, ctx);
  } catch (err) {
    return compileFrom(S, normalizeArp(S.arp), normalizeClip(S.clip), normalizeKbd(S.kbd), ctx);
  }
}
/**
 * The assembled §4.4 layout of a complete seqT ({key, parts} with every part of SEQT_PART_NAMES): rows with the
 * offsets filled in (records, packed in slot order). Reference for SxSeq and the tests.
 */
export function assembleSeqT(seqT) {
  const T = objOf(seqT), P = objOf(T.parts), arps = [], clips = [];
  for (let j = 0; j < N_SLOTS; j++) {
    const a = P['arp' + j], c = P['clip' + j];
    if (!isObj(a) || !isObj(c)) return null;
    arps.push(a); clips.push(c);
  }
  const sum = (L, f) => L.reduce((t, p) => t + f(p), 0);
  const nl = m => { let n = 0; for (let b = 0; b < 8; b++) if (m & (1 << b)) n++; return n; };
  const out = {
    key: T.key, arp: new Float64Array(N_SLOTS * ARP_ROW), arpEv: new Float64Array(5 * sum(arps, p => p.row[34])),
    arpStrum: new Float64Array(2 * sum(arps, p => p.row[36])), arpLane: new Float32Array((LANE_N + 1) * sum(arps, p => nl(p.row[37]))),
    clip: new Float64Array(N_SLOTS * CLIP_ROW), clipNotes: new Float64Array(8 * sum(clips, p => p.row[15])),
    clipLane: new Float32Array((LANE_N + 1) * sum(clips, p => nl(p.row[16]))),
  };
  let eo = 0, so = 0, lo = 0;
  arps.forEach((p, j) => {
    out.arp.set(p.row, j * ARP_ROW);
    out.arp[j * ARP_ROW + 33] = eo; out.arp[j * ARP_ROW + 35] = so; out.arp[j * ARP_ROW + 38] = lo;
    out.arpEv.set(p.ev, 5 * eo); out.arpStrum.set(p.strum, 2 * so); out.arpLane.set(p.lane, (LANE_N + 1) * lo);
    eo += p.row[34]; so += p.row[36]; lo += nl(p.row[37]);
  });
  let no = 0;
  lo = 0;
  clips.forEach((p, j) => {
    out.clip.set(p.row, j * CLIP_ROW);
    out.clip[j * CLIP_ROW + 14] = no; out.clip[j * CLIP_ROW + 17] = lo;
    out.clipNotes.set(p.notes, 8 * no); out.clipLane.set(p.lane, (LANE_N + 1) * lo);
    no += p.row[15]; lo += nl(p.row[16]);
  });
  return out;
}

/* ================================================================ piano-roll operations (inv B23; pure) */

// Records are arrays; field 0 = t16, 1 = len16, 2 = pitch (clip: MIDI note 0–127; arp event: row ±1…±32, never 0).
// Every method takes the current list and `sel` (indices into it) and returns { list, sel } with NEW arrays: `list`
// sorted by t16 then pitch, `sel` the indices of the selected records after the operation. Times are rounded to 5
// decimals (state precision). Result sizes are not capped here: normalizeClip / normalizeArp enforce the limits.
export const MIN_LEN16 = 1 / 16;                      // shortest record after resize / chop / scale (1/16 of a sixteenth)
const rowLin = r => (r > 0 ? r - 1 : r);               // rows −32…−1, 1…32 ↔ contiguous −32…31
const linRow = l => (l >= 0 ? l + 1 : l);
function makeOps(cfg) {
  const P = 2, clampP = cfg.clip ? p => clamp(p, 0, 127) : p => clamp(p, -32, 32);
  const linP = cfg.clip ? p => p : rowLin, unLin = cfg.clip ? p => p : linRow, PLO = cfg.clip ? 0 : -32, PHI = cfg.clip ? 127 : 31;
  const tag = (list, sel) => { const S = new Set(arrOf(sel)); return arrOf(list).map((r, i) => ({ r: arrOf(r).slice(), s: S.has(i) })); };
  const out = T => {
    T.sort((a, b) => a.r[0] - b.r[0] || a.r[P] - b.r[P]);
    const sel = [];
    T.forEach((x, i) => { if (x.s) sel.push(i); });
    return { list: T.map(x => x.r), sel };
  };
  const span = T => { let a = Infinity, b = -Infinity; for (const x of T) if (x.s) { a = Math.min(a, x.r[0]); b = Math.max(b, x.r[0] + x.r[1]); } return [a, b]; };
  const ops = {
    /** add(list, sel, rec): rec appended and the only selected record */
    add(list, sel, rec) { const T = tag(list, []); T.push({ r: arrOf(rec).slice(), s: true }); return out(T); },
    /** remove(list, sel): the selected records deleted */
    remove(list, sel) { return out(tag(list, sel).filter(x => !x.s)); },
    /** move(list, sel, dt, dn): selected records shifted by dt sixteenths and dn semitones / rows (the group stays in range) */
    move(list, sel, dt, dn) {
      const T = tag(list, sel), S = T.filter(x => x.s);
      if (!S.length) return out(T);
      let t = fin(dt) ? dt : 0, d = fin(dn) ? Math.round(dn) : 0;
      t = Math.max(t, -Math.min(...S.map(x => x.r[0])));
      d = clamp(d, PLO - Math.min(...S.map(x => linP(x.r[P]))), PHI - Math.max(...S.map(x => linP(x.r[P]))));
      for (const x of S) { x.r[0] = r5(x.r[0] + t); x.r[P] = unLin(linP(x.r[P]) + d); }
      return out(T);
    },
    /** resize(list, sel, dl): selected lengths + dl (≥ MIN_LEN16) */
    resize(list, sel, dl) { const T = tag(list, sel); for (const x of T) if (x.s) x.r[1] = r5(Math.max(MIN_LEN16, x.r[1] + (fin(dl) ? dl : 0))); return out(T); },
    /** chop(list, sel, grid): selected records split at every multiple of grid (sixteenths) inside them (Chop ⌘U) */
    chop(list, sel, grid) {
      const T = tag(list, sel), R = [];
      for (const x of T) {
        if (!x.s || !(grid > 0)) { R.push(x); continue; }
        const t0 = x.r[0], t1 = x.r[0] + x.r[1];
        let a = t0;
        for (let k = Math.floor(t0 / grid + 1e-9) + 1; k * grid < t1 - 1e-9 && R.length < 65536; k++) {
          const c = r5(k * grid);
          if (c - a >= MIN_LEN16 && t1 - c >= MIN_LEN16) { const q = x.r.slice(); q[0] = r5(a); q[1] = r5(c - a); R.push({ r: q, s: true }); a = c; }
        }
        const q = x.r.slice(); q[0] = r5(a); q[1] = r5(t1 - a); R.push({ r: q, s: true });
      }
      return out(R);
    },
    /** legato(list, sel): each selected record lasts until the next later start among the selection (Legato ⌘L) */
    legato(list, sel) {
      const T = tag(list, sel), starts = Array.from(new Set(T.filter(x => x.s).map(x => x.r[0]))).sort((a, b) => a - b);
      for (const x of T) {
        if (!x.s) continue;
        const nx = starts.find(t => t > x.r[0]);
        if (nx !== undefined) x.r[1] = r5(nx - x.r[0]);
      }
      return out(T);
    },
    /** quantize(list, sel, grid, strength = 1): starts moved toward the nearest multiple of grid (Quantize ⌘Q) */
    quantize(list, sel, grid, strength) {
      const T = tag(list, sel), k = fin(strength) ? clamp(strength, 0, 1) : 1;
      if (grid > 0) for (const x of T) if (x.s) x.r[0] = r5(Math.max(0, x.r[0] + (Math.round(x.r[0] / grid) * grid - x.r[0]) * k));
      return out(T);
    },
    /** reverse(list, sel): selected records mirrored in time inside the selection's span (Reverse ⌘R) */
    reverse(list, sel) {
      const T = tag(list, sel), [a, b] = span(T);
      for (const x of T) if (x.s) x.r[0] = r5(a + b - (x.r[0] + x.r[1]));
      return out(T);
    },
    /** scaleTime(list, sel, f): starts (relative to the first selected start) and lengths × f (Scale Time `/` 0.5, `*` 2) */
    scaleTime(list, sel, f) {
      const T = tag(list, sel), [a] = span(T);
      if (f > 0) for (const x of T) if (x.s) { x.r[0] = r5(a + (x.r[0] - a) * f); x.r[1] = r5(Math.max(MIN_LEN16, x.r[1] * f)); }
      return out(T);
    },
    /** duplicate(list, sel): copies of the selection placed right after its span; the copies are selected (⌘D) */
    duplicate(list, sel) {
      const T = tag(list, sel), [a, b] = span(T), C = [];
      for (const x of T) { if (x.s) { const q = x.r.slice(); q[0] = r5(q[0] + (b - a)); C.push({ r: q, s: true }); x.s = false; } }
      return out(T.concat(C));
    },
    /** selectRange(list, t0, t1, p0, p1) → indices of the records overlapping [t0, t1) with p0 ≤ pitch ≤ p1 (marquee) */
    selectRange(list, t0, t1, p0, p1) {
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1), out2 = [];
      arrOf(list).forEach((r, i) => { if (r[0] < t1 && r[0] + r[1] > t0 && r[P] >= lo && r[P] <= hi) out2.push(i); });
      return out2;
    },
    /** timeCopy(list, range = [t0, t1]) → clipboard { len, list }: the parts of the records inside [t0, t1), times relative to t0 */
    timeCopy(list, rng) {
      const R = arrOf(rng), t0 = fin(R[0]) ? R[0] : 0, t1 = fin(R[1]) ? R[1] : t0, L = [];
      for (const r of arrOf(list)) {
        const a = Math.max(r[0], t0), b = Math.min(r[0] + r[1], t1);
        if (b - a > 1e-9) { const q = r.slice(); q[0] = r5(a - t0); q[1] = r5(b - a); L.push(q); }
      }
      return { len: r5(Math.max(0, t1 - t0)), list: L };
    },
    /** timePaste(list, clip, at): the region [at, at + clip.len) is overwritten (records split at its edges); pasted records selected */
    timePaste(list, clip, at) {
      const cb = objOf(clip), e = at + (fin(cb.len) ? cb.len : 0), T = [];
      for (const r of arrOf(list)) {
        const a = r[0], b = r[0] + r[1];
        if (b <= at || a >= e) { T.push({ r: r.slice(), s: false }); continue; }
        if (a < at) { const q = r.slice(); q[1] = r5(at - a); T.push({ r: q, s: false }); }
        if (b > e) { const q = r.slice(); q[0] = r5(e); q[1] = r5(b - e); T.push({ r: q, s: false }); }
      }
      for (const r of arrOf(cb.list)) { const q = r.slice(); q[0] = r5(q[0] + at); T.push({ r: q, s: true }); }
      return out(T);
    },
  };
  // whole clip / pattern: obj = a clip ({len, start, off, notes}) or a pattern ({len, ev}); returns a new object
  const F = cfg.clip ? 'notes' : 'ev', MAXL = cfg.clip ? MAX_CLIP_LEN : MAX_PAT_LEN;
  /** doubleClip(obj): the region [start, len) repeated once after itself, length doubled (≤ max) — Double Entire Clip ⌘E */
  ops.doubleClip = obj => {
    const o = clone(objOf(obj)), st = cfg.clip ? o.start || 0 : 0, len = o.len, w = len - st, L = arrOf(o[F]).slice();
    if (!(w > 0) || st + 2 * w > MAXL) return o;
    for (const r of arrOf(o[F])) if (r[0] >= st && r[0] < len) { const q = r.slice(); q[0] = r5(q[0] + w); L.push(q); }
    o[F] = out(L.map(r => ({ r, s: false }))).list;
    o.len = st + 2 * w;
    return o;
  };
  /** scaleClip(obj, f): every time, length and the region length × f (relative to start) — Scale Entire Clip 50 % / 200 % */
  ops.scaleClip = (obj, f) => {
    const o = clone(objOf(obj)), st = cfg.clip ? o.start || 0 : 0;
    if (!(f > 0)) return o;
    const len = clamp(Math.ceil(st + (o.len - st) * f - 1e-9), st + 1, MAXL);
    o[F] = out(arrOf(o[F]).map(r => {
      const q = r.slice();
      if (q[0] >= st) { q[0] = r5(st + (q[0] - st) * f); q[1] = r5(Math.max(MIN_LEN16, q[1] * f)); }   // records before start: untouched
      return { r: q, s: false };
    })).list;
    if (cfg.clip && fin(o.off)) o.off = clamp(Math.round(st + (o.off - st) * f), st, len - 1);
    o.len = len;
    return o;
  };
  if (cfg.clip) {
    /** mute(list, sel): mutes the selection, or unmutes it when every selected note is muted (Mute 0) */
    ops.mute = (list, sel) => {
      const T = tag(list, sel), S = T.filter(x => x.s), v = S.some(x => !x.r[4]) ? 1 : 0;
      for (const x of S) x.r[4] = v;
      return out(T);
    };
    /** conformToScale(list, sel, key, scale): pitches quantised to KEY/SCALE (Conform to Scale ⌘K) */
    ops.conformToScale = (list, sel, key, scale) => {
      const T = tag(list, sel);
      for (const x of T) if (x.s) x.r[P] = clampP(quantize(x.r[P], key, scale));
      return out(T);
    };
  } else {
    /** accent(list, sel): accents the selection, or clears it when every selected event is accented (Accent lane) */
    ops.accent = (list, sel) => {
      const T = tag(list, sel), S = T.filter(x => x.s), v = S.some(x => !x.r[4]) ? 1 : 0;
      for (const x of S) x.r[4] = v;
      return out(T);
    };
  }
  return deepFreeze(ops);
}
/** Clip-note operations: records [t16, len16, note, vel, mute, x, y, z]. */
export const noteOps = makeOps({ clip: true });
/** Arp pattern-event operations: records [t16, len16, row, vel, accent]. */
export const evOps = makeOps({ clip: false });

/* ================================================================ §7.5.6 clip actions */

/**
 * Send to Selected Clip: slice j (between the effective marks, fractions of a region of lenSec seconds) → note j at its
 * original start time in sixteenths at `bpm`, length = the slice duration, pitch root + j (notes above 127 are dropped),
 * velocity 100; the clip length is rounded up to whole bars (16–1024 sixteenths). → { len16, notes }
 */
export function slicesToNotes(marks, lenSec, bpm, root) {
  const tempo = fin(bpm) && bpm > 0 ? bpm : 120, L = fin(lenSec) && lenSec > 0 ? lenSec : 0, r0 = intIn(root, 36, 0, 127);
  const b = [0].concat(Array.from(new Set(arrOf(marks).filter(x => fin(x) && x > 0 && x < 1))).sort((x, y) => x - y), [1]);
  const k16 = L * tempo / 15, notes = [];
  for (let j = 0; j + 1 < b.length && r0 + j <= 127; j++) {
    const t = r5(b[j] * k16), l = r5((b[j + 1] - b[j]) * k16);
    if (l > 0 && t < MAX_CLIP_LEN) notes.push([t, l, r0 + j, 100, 0, 0.5, 0.5, 0]);
  }
  return { len16: clamp(16 * Math.ceil(k16 / 16 - 1e-9), 16, MAX_CLIP_LEN), notes };
}
/**
 * Wrap Clip to Begin Here: rotates the region [start, len) so that `off` becomes its start — a note at t ≥ off moves to
 * t − off + start, a note at t < off to t + (len − off); a note crossing `off` is split into two notes; the part of a
 * note beyond `len` (never heard: playback cuts notes at the loop end) is dropped. Notes outside the region are kept.
 * Returns the new sorted note list; the caller then sets off = start.
 */
export function wrapAt(notes, start, off, len) {
  const out = [];
  for (const r of arrOf(notes)) {
    const t = r[0], e = Math.min(r[0] + r[1], len);
    if (!(off > start && off < len) || t < start || t >= len) { out.push(r.slice()); continue; }
    const put = (a, b, to) => { const q = r.slice(); q[0] = r5(to); q[1] = r5(b - a); out.push(q); };
    if (t >= off) put(t, e, t - off + start);
    else if (e > off) { put(t, off, t + (len - off)); put(off, e, start); }
    else put(t, e, t + (len - off));
  }
  return out.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}
/** Wrap Clip to Begin Here on a clip slot: its notes rotated by wrapAt and off = start. → a new normalized clip slot */
export function wrapClip(slot) {
  const C = normalizeClipSlot(slot);
  return normalizeClipSlot(Object.assign(C, { notes: wrapAt(C.notes, C.start, C.off, C.len), off: C.start }));
}
/**
 * Send to Selected Clip on a clip slot: the notes and length of slicesToNotes' result {len16, notes} (start and the
 * offset marker kept when they still fit, else 0). → a new normalized clip slot
 */
export function withSlices(slot, res) {
  const C = normalizeClipSlot(slot), R = objOf(res), len = intIn(R.len16, 16, 1, MAX_CLIP_LEN);
  const start = C.start < len ? C.start : 0;
  return normalizeClipSlot(Object.assign(C, { len, start, off: C.off >= start && C.off < len ? C.off : start, notes: arrOf(R.notes) }));
}
/**
 * Record EXTEND: the clip length after recording reached position t16 (sixteenths): while t16 is at or past the end the
 * length grows by whole bars (16 sixteenths at a time) up to 1024 (§7.5.6; OVERDUB loops instead: the caller wraps t16).
 */
export function recExtend(len, t16) {
  let L = intIn(len, 64, 1, MAX_CLIP_LEN);
  if (!fin(t16)) return L;
  while (t16 >= L && L < MAX_CLIP_LEN) L = Math.min(MAX_CLIP_LEN, L + 16);
  return L;
}
/**
 * Copy to Track: the clip's unmuted notes of [start, len) in song.js units at song tick `playhead` (§7.5.6):
 * [{t: playhead + round(240·(t16 − start)), d: max(1, round(240·len16)), n, v}], in clip order (main.js passes them to
 * song.js pasteNotes as one project-history step).
 */
export function clipTrackNotes(clip, playhead) {
  const C = objOf(clip), len = fin(C.len) ? C.len : 64, start = fin(C.start) ? C.start : 0, at = fin(playhead) ? Math.max(0, Math.round(playhead)) : 0;
  const out = [];
  for (const r of arrOf(C.notes)) {
    if (!Array.isArray(r) || !fin(r[0]) || !fin(r[1]) || r[4] || r[0] < start || r[0] >= len) continue;
    out.push({ t: at + Math.round(240 * (r[0] - start)), d: Math.max(1, Math.round(240 * r[1])), n: intIn(r[2], 60, 0, 127), v: intIn(r[3], 100, 1, 127) });
  }
  return out;
}
/**
 * Export MIDI File: SMF type 0, 960 PPQ, tempo meta (bpm) then time signature 4/4 at tick 0; notes of [start, len) not
 * muted, at tick round(240·(t16 − start)), length max(1, round(240·len16)), channel 1, note-off velocity 0; at equal ticks
 * note-offs come before note-ons; no running status. A note crossing the clip end is cut there (as playback does, at
 * least 1 tick); end of track at 240·(len − start) (never before the last event). → Uint8Array
 */
export function clipToSmf(clip, bpm) {
  const C = objOf(clip), len = fin(C.len) ? C.len : 64, start = fin(C.start) ? C.start : 0, tempo = fin(bpm) && bpm > 0 ? bpm : 120;
  const endT = Math.round(240 * (len - start)), ev = [];
  for (const r of arrOf(C.notes)) {
    if (!Array.isArray(r) || !fin(r[0]) || r[4] || r[0] < start || r[0] >= len) continue;
    const on = Math.round(240 * (r[0] - start)), off = Math.max(on + 1, Math.min(on + Math.max(1, Math.round(240 * r[1])), endT));
    const n = intIn(r[2], 60, 0, 127), v = intIn(r[3], 100, 1, 127);
    ev.push([on, 1, n, v], [off, 0, n, 0]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const body = [], vlq = x => { const b = [x & 127]; while ((x >>>= 7)) b.unshift(128 | (x & 127)); body.push(...b); };
  const us = Math.round(60e6 / tempo);
  vlq(0); body.push(0xFF, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255);
  vlq(0); body.push(0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);
  let t = 0;
  for (const [tk, on, n, v] of ev) { vlq(tk - t); t = tk; body.push(on ? 0x90 : 0x80, n, v); }
  vlq(Math.max(0, endT - t)); body.push(0xFF, 0x2F, 0x00);
  const u32 = x => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255];
  return Uint8Array.from([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x03, 0xC0, 0x4D, 0x54, 0x72, 0x6B, ...u32(body.length), ...body]);
}

/* ================================================================ §13.3.2 marker snapping */

/**
 * Marker snapping grid (positions in sample frames). mode 2 / 'beats': 1/16 notes at the project tempo from S
 * (step = rate·15/bpm), or with Sample Length to BPM on (lenBeats > 0) sixteenths of the region at its RATE length
 * (step = |E − S| / (4·lenBeats)); mode 3 / 'loop': loop lengths in whole root periods — pass the fixed loop marker as S
 * and the root period T₀ (frames) as `loop` (the seam-error refinement is smp.loopSearch). Off / Zero (and anything
 * without a positive step) → null. → { origin, step }
 */
export function snapGrid(mode, o) {
  const m = typeof mode === 'string' ? ['off', 'zero', 'beats', 'loop'].indexOf(mode) : mode, O = objOf(o), S = fin(O.S) ? O.S : 0;
  let step = 0;
  if (m === 2) step = O.lenBeats > 0 && fin(O.E) ? Math.abs(O.E - S) / (4 * O.lenBeats) : O.rate > 0 && O.bpm > 0 ? O.rate * 15 / O.bpm : 0;
  else if (m === 3) step = O.loop > 0 ? O.loop : 0;
  return step > 0 && isFinite(step) ? { origin: S, step } : null;
}
/** Nearest grid position to x (x unchanged without a grid). */
export function snapTo(grid, x) {
  return grid && grid.step > 0 ? grid.origin + Math.round((x - grid.origin) / grid.step) * grid.step : x;
}

/* ================================================================ names */

/** Display name of an arp slot ('' → "<Shape> (<rate>)") or of clip j ('' → "Clip <j + 1>"). */
export function slotName(slot, j) {
  const S = objOf(slot);
  if (typeof S.name === 'string' && S.name) return S.name;
  if (!fin(S.shape)) return 'Clip ' + ((fin(j) ? j : 0) + 1);
  const n = objOf(S.n);
  let rate;
  if (S.bpm === 0) { const f = arpRateHz(fin(n.hz) ? clamp(n.hz, 0, 1) : ARP_N.hz); rate = f.toFixed(f < 10 ? 2 : 1) + ' Hz'; } else {
    const L = arpLadder(S.dot, S.trip);
    rate = L[Math.round((fin(n.rate) ? clamp(n.rate, 0, 1) : ARP_N.rate) * (L.length - 1))].label;
  }
  return ARP_SHAPES[intIn(S.shape, 7, 0, 17)] + ' (' + rate + ')';
}

/* ================================================================ §10.6–10.7 content (original, deterministic) */

const note = (t, l, n, v) => [t, l, n, v === undefined ? 100 : v, 0, 0.5, 0.5, 0];
const MINOR = [0, 2, 3, 5, 7, 8, 10], MINOR_PENTA = [0, 3, 5, 7, 10];
/**
 * A seeded original bass line (§10.7 Basslines): 16th notes over one or two bars, odd seeds in C minor (root C2), even
 * seeds in A minor (root A1); root-heavy, octave jumps 20 %, rests 25 %. → a normalized clip.
 */
export function genBassline(seed) {
  const sd = (fin(seed) ? Math.round(seed) : 1) >>> 0, rnd = mulberry32(fnvStr('bassline:' + sd)), cMinor = sd & 1;
  const root = cMinor ? 36 : 33, bars = rnd() < 0.5 ? 1 : 2, len = 16 * bars, notes = [];
  for (let k = 0; k < len; k++) {
    if (k > 0 && rnd() < 0.25) continue;
    const r = rnd(), deg = r < 0.5 ? 0 : r < 0.65 ? 4 : r < 0.75 ? 2 : r < 0.85 ? 6 : r < 0.93 ? 3 : 5;
    const oct = rnd() < 0.2 ? 12 : 0, l = k + 1 < len && rnd() < 0.15 ? 2 : 1;
    notes.push(note(k, l * 0.9, root + MINOR[deg] + oct, k % 4 === 0 ? 112 : 88 + Math.floor(rnd() * 20)));
    k += l - 1;
  }
  return normalizeClipSlot({ name: 'Bass ' + sd + (cMinor ? ' Cm' : ' Am'), len, notes });
}
/**
 * A seeded original melody (§10.7 Melodies): two bars of 8th-note phrases, odd seeds minor pentatonic from C4, even
 * seeds natural minor from A3, a random walk over the scale with rests 20 %; macro-1 lane ramping 0 → 1. → a clip.
 */
export function genMelody(seed) {
  const sd = (fin(seed) ? Math.round(seed) : 1) >>> 0, rnd = mulberry32(fnvStr('melody:' + sd)), penta = sd & 1;
  const sc = penta ? MINOR_PENTA : MINOR, root = penta ? 60 : 57, notes = [];
  let d = sc.length;                                 // scale degree index from root − 1 octave … root + 2 octaves
  for (let t = 0; t < 32; t += 2) {
    if (t > 0 && rnd() < 0.2) continue;
    d = clamp(d + Math.round((rnd() - 0.5) * 4), 0, 3 * sc.length - 1);
    const l = t + 4 <= 32 && rnd() < 0.25 ? 4 : 2, p = root - 12 + 12 * Math.floor(d / sc.length) + sc[d % sc.length];
    notes.push(note(t, l * 0.95, p, 84 + Math.floor(rnd() * 28)));
    if (l === 4) t += 2;
  }
  return normalizeClipSlot({ name: 'Melody ' + sd, len: 32, notes, lanes: { m1: [[0, 0, 0], [1, 1, 0]] } });
}
// Preview clips for presets without a preview clip (§12.6): a chord C–E–G–B of 2 beats, a bass line, a lead phrase
export const FALLBACK_CLIPS = deepFreeze([
  normalizeClipSlot({ name: 'Chord', len: 16, notes: [60, 64, 67, 71].map(n => note(0, 8, n)) }),
  normalizeClipSlot({ name: 'Bass', len: 16, notes: [36, 36, 48, 36, 39, 36, 43, 46].map((n, i) => note(2 * i, 1.8, n, i % 2 ? 96 : 112)) }),
  normalizeClipSlot({ name: 'Lead', len: 16, notes: [72, 75, 77, 79, 82, 79, 77, 75].map((n, i) => note(2 * i, i === 7 ? 2 : 1.8, n, 100)) }),
]);

// §10.6 arp banks: slots built from (shape, rate label, fields); rate labels resolve in the slot's ladder
function arpSlot(shape, rate, o) {
  const S = defaultArpSlot(), x = objOf(o);
  S.shape = ARP_SHAPES.indexOf(shape);
  const trip = /T$/.test(rate) ? 1 : 0, dot = /\.$/.test(rate) ? 1 : 0, L = arpLadder(dot, trip);
  S.trip = trip; S.dot = dot;
  S.n.rate = L.findIndex(e => e.label === rate) / (L.length - 1);
  if (x.range) S.n.range = (x.range - 1) / 7;
  if (x.shift !== undefined) S.n.shift = (x.shift + 24) / 48;
  if (x.gate !== undefined) S.n.gate = x.gate / 2;
  if (x.rshape) S.rshape = RANGE_SHAPES.indexOf(x.rshape);
  return normalizeArpSlot(S);
}
const bank = (type, name, key, list) => ({ type, v: 1, name, [key]: list });

// §10.6 Patterns: twelve original arp patterns as literal event lists ([t16, len16, row, vel, accent]; 16 sixteenths
// unless stated). Every pattern is also a factory pattern preset (FACTORY_PATTERNS, the pattern editor's Factory menu).
const pat = (name, ev, o) => normalizeArpSlot({ pat: Object.assign({ name, ev }, o || {}) }).pat;
const every = (step, len, f) => { const out = []; for (let t = 0, k = 0; t < len; t += step, k++) { const e = f(t, k); if (e) out.push(...(Array.isArray(e[0]) ? e : [e])); } return out; };
const VEL_STEPS = (hi, lo, n) => { const out = []; for (let k = 0; k < n; k++) { const y = (k % 2 ? lo : hi) / 127; out.push([k / n, y, 0], [(k + 1) / n, y, 0]); } return out; };
const PATTERNS = [
  pat('Pulse 8ths', every(2, 16, t => [[t, 1.5, 1, 100, 0], [t, 1.5, 2, 96, 0], [t, 1.5, 3, 92, 0]])),
  pat('Gallop', every(4, 16, t => [[t, 1, 1, 110, 1], [t + 1, 1, 2, 90, 0], [t + 2, 2, 3, 100, 0]])),
  pat('Octave Bounce', every(1, 16, (t, k) => [t, 0.75, k % 2 ? -1 : 1, k % 4 === 0 ? 112 : 92, 0])),
  pat('Trance Gate', every(1, 16, t => ([3, 7, 11, 14].includes(t) ? null : [t, 0.8, 1, t % 4 === 0 ? 118 : 96, 0])), { stepMode: 2 }),
  pat('Broken Chord', every(1, 16, (t, k) => [t, 1, [1, 3, 2, 4][k % 4], 100 - 8 * (k % 4), 0])),
  pat('Strum Up', every(4, 16, t => [t, 3.5, 1, t === 0 ? 112 : 96, 0]), { stepMode: 2, strum: [[0, 0.4], [4, 0.4], [8, 0.4], [12, 0.4]] }),
  pat('Accent 3+3+2', every(1, 16, (t, k) => [t, 0.9, 1 + (k % 3), [0, 3, 6, 8, 11, 14].includes(t) ? 104 : 80, [0, 3, 6, 8, 11, 14].includes(t) ? 1 : 0])),
  pat('Random Steps', every(1, 16, (t, k) => [t, 1, 1 + (k % 4), 100, 0]), { mode: 3, time: 2 }),
  pat('Pendulum Five', every(1, 5, (t, k) => [t, 1, k + 1, 100, 0]), { len: 5, mode: 2 }),
  pat('Wrap Climb', every(1, 8, (t, k) => [t, 1, k + 1, 92 + 4 * k, 0]), { len: 8, wrap: 0 }),
  pat('Ghost 16ths', every(1, 16, (t, k) => [t, 0.6, [1, 2, 3, 2][k % 4], 100, 0]), { lanes: { vel: VEL_STEPS(110, 40, 16) } }),
  pat('Euclid 5/16', [0, 3, 6, 9, 12].map(t => [t, 1.5, 1, t === 0 ? 116 : 98, 0])),          // Bjorklund E(5, 16)
];
// a Pattern slot (SHAPE Pattern) playing one of PATTERNS at `rate` (+ slot fields: wrange / wtrans for Wrap Climb)
function patSlot(i, rate, o) {
  const S = arpSlot('Pattern', rate, o), x = objOf(o);
  S.pat = clone(PATTERNS[i]);
  if (x.wrange !== undefined) S.n.wrange = x.wrange / 8;
  if (x.wtrans !== undefined) S.n.wtrans = x.wtrans / 24;
  return normalizeArpSlot(S);
}

export const FACTORY_ARP_BANKS = deepFreeze([
  bank('synth.sx.arpbank', 'Init', 'slots', Array.from({ length: N_SLOTS }, defaultArpSlot)),
  bank('synth.sx.arpbank', 'Basics', 'slots', [arpSlot('Up', '1/16'), arpSlot('Down', '1/16'), arpSlot('UpDown', '1/16'), arpSlot('Up&Down', '1/8'),
    arpSlot('Played', '1/16'), arpSlot('Chord', '1/8', { gate: 0.5 }), arpSlot('Converge', '1/16'), arpSlot('Diverge', '1/16'),
    arpSlot('Thumb Up', '1/16'), arpSlot('Rand', '1/16'), arpSlot('Rand Drift', '1/16'), arpSlot('Up', '1/16T')]),
  bank('synth.sx.arpbank', 'Range', 'slots', [arpSlot('Up', '1/16', { range: 2, shift: 12 }), arpSlot('Up', '1/16', { range: 3, rshape: 'Up/Down' }),
    arpSlot('Down', '1/16', { range: 2, rshape: 'Down' }), arpSlot('Up', '1/32', { range: 4 }), arpSlot('Up', '1/16', { range: 2, shift: 7 }),
    arpSlot('Up', '1/16', { range: 3, shift: 5, rshape: 'Converge' }), arpSlot('Chord', '1/8', { range: 2, rshape: 'Chord' }),
    arpSlot('UpDown', '1/16', { range: 2, rshape: 'Pinky Up' }), arpSlot('Rand', '1/16', { range: 3, rshape: 'Random' }),
    arpSlot('Thumb UD', '1/16', { range: 2 }), arpSlot('Played', '1/16', { range: 2, rshape: 'Thumb Up' }), arpSlot('Up', '1/8.', { range: 2 })]),
  // §10.6 Patterns: one slot per pattern (pattern sixteenths at 1/16 except Pulse 8ths / Strum Up / Gallop, whose events
  // already sit on their grid); Wrap Climb wraps its rows 4–8 an octave up (WRAP RANGE 1, WRAP TRANSPOSE 12)
  bank('synth.sx.arpbank', 'Patterns', 'slots', [patSlot(0, '1/16', { gate: 0.9 }), patSlot(1, '1/16'), patSlot(2, '1/16'), patSlot(3, '1/16', { gate: 0.9 }),
    patSlot(4, '1/16'), patSlot(5, '1/16', { gate: 0.9 }), patSlot(6, '1/16'), patSlot(7, '1/16'), patSlot(8, '1/16'),
    patSlot(9, '1/16', { wrange: 1, wtrans: 12 }), patSlot(10, '1/16'), patSlot(11, '1/16')]),
]);

// §10.7 Chords: twelve original two-bar progressions, four chords of half a bar each, voiced in four notes around C4
// (each chord's pitch classes placed nearest to the previous voicing, pulled towards E4; the first one in root position
// from G3–F#4; range E3–E5)
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const QUAL = { '': [0, 4, 7, 12], m: [0, 3, 7, 12], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus2: [0, 2, 7, 12], sus4: [0, 5, 7, 12],
  add9: [0, 4, 7, 14], m9: [0, 3, 10, 14], 6: [0, 4, 7, 9] };
function chordPcs(name) { const m = /^([A-G][b#]?)(.*)$/.exec(name); return QUAL[m[2]].map(i => (PC[m[1]] + i) % 12); }
function voice(pcs, prev) {
  const out = [];
  if (!prev) { let n = 60 + ((pcs[0] - 60) % 12 + 12) % 12; if (n > 66) n -= 12; return pcs.map(pc => n + ((pc - pcs[0]) % 12 + 12) % 12 + (out.includes(pc) ? 12 : (out.push(pc), 0))).sort((x, y) => x - y); }
  const used = new Set();
  for (const pc of pcs) {
    let best = 0, bd = 1e9;
    for (let x = 52; x <= 76; x++) if ((x % 12) === pc && !used.has(x)) { const d = Math.min(...prev.map(p => Math.abs(p - x))) + 0.25 * Math.abs(x - 64); if (d < bd) { bd = d; best = x; } }
    used.add(best); out.push(best);
  }
  return out.sort((a, b) => a - b);
}
function progression(name, chords, o) {
  const notes = [];
  let prev = null;
  chords.forEach((c, k) => {
    const v = voice(chordPcs(c), prev);
    prev = v;
    v.forEach((n, j) => notes.push(note(8 * k, 7.6, n, (j === 0 ? 100 : 92) + (k % 2 ? 0 : 6))));
  });
  return normalizeClipSlot(Object.assign({ name, len: 32, notes }, o || {}));
}
const CHORDS = [
  progression('Am F C G', ['Am', 'F', 'C', 'G']),
  progression('C G Am F', ['C', 'G', 'Am', 'F']),
  progression('Dm7 G7 Cmaj7', ['Dm7', 'G7', 'Cmaj7', 'Cmaj7']),
  progression('Cm Fm Gm Cm', ['Cm', 'Fm', 'Gm', 'Cm']),
  progression('C Am F G', ['C', 'Am', 'F', 'G']),
  progression('Am G F E', ['Am', 'G', 'F', 'E']),
  progression('F G Em Am', ['F', 'G', 'Em', 'Am']),
  progression('Dm9 G sus', ['Dm9', 'G', 'Dm9', 'Gsus4']),
  progression('Cmaj7 Fmaj7', ['Cmaj7', 'Fmaj7', 'Cmaj7', 'Fmaj7']),
  progression('Em G D A', ['Em', 'G', 'D', 'A']),
  progression('Dm7 G7 Em7 A7', ['Dm7', 'G7', 'Em7', 'A7']),
  progression('C Bb F C', ['C', 'Bb', 'F', 'C']),
];

// §10.7 Slices: twelve original drum patterns for the slices of `fsmp:Drum Loop 120` (sliced at its hits: 16 slices of an
// eighth note each, slice root 36 — 36 kick, 37 hat, 38 kick + snare, 39 hat, 40 kick, 41 kick + hat, 42 kick + snare +
// clap, 43 hat, 44–51 the second bar). Each string is one bar of sixteenths: a letter per step, '.' = rest (k 36, h 37,
// s 38, o 39, c 40, x 41, p 42, t 43; capitals = the second bar's slice, notes 44–51; ',' = a soft ghost of the
// previous slice).
const SL = { k: 36, h: 37, s: 38, o: 39, c: 40, x: 41, p: 42, t: 43 };
function slicePat(name, bars, o) {
  const notes = [];
  bars.forEach((b, bar) => {
    let last = 36;
    for (let i = 0; i < 16; i++) {
      const ch = b[i];
      if (!ch || ch === '.') continue;
      const lo = ch.toLowerCase(), n = ch === ',' ? last : SL[lo] + (ch !== lo ? 8 : 0);
      if (ch !== ',') last = n;
      notes.push(note(16 * bar + i, 1.8, n, ch === ',' ? 56 : i % 4 === 0 ? 112 : 96));
    }
  });
  return normalizeClipSlot(Object.assign({ name, len: 16 * bars.length, notes }, o || {}));
}
const SLICES = [
  slicePat('Straight', ['k.h.s.o.c.x.p.t.', 'K.H.S.O.C.X.P.T.']),
  slicePat('Four Floor', ['k.h.k.h.k.h.k.h.', 'k.h.p.h.k.h.p.t.']),
  slicePat('Backbeat', ['k.h.p.h.k.x.p.h.', 'k.h.p.h.k.x.p,T,']),
  slicePat('Half-Time', ['k.h.o.h.p.h.o.t.', 'k.h.o.x.p.h.o.T.']),
  slicePat('Breakbeat', ['k.h.s.h.h.k.s.t.', 'k.h.s.h.h.k.s,s,']),
  slicePat('Shuffle', ['k..hs..hk..hp..h', 'k..hs..hk..xp.,t']),
  slicePat('Stutter', ['k.h.s.h.k.h.ssss', 'k.h.s.h.k.h.pppp']),
  slicePat('Reverse Roll', ['T.P.X.C.O.S.H.K.', 't.p.x.c.o.s.h.k.']),
  slicePat('Kick Roll', ['k..k..k.k..k..k.', 'k..k..p.k..k.ppp']),
  slicePat('Hat Groove', ['k.h.p.h.h.x.p.h.', 'h.h.p.h.k.h.p.h.']),
  slicePat('Two-Step', ['k...p..k..k.p...', 'k...p..k..x.p.,.']),
  slicePat('Fill', ['k.h.s.h.k.x.p.h.', 'k.s.s,s.p,p,ssss']),
];

export const FACTORY_CLIP_BANKS = deepFreeze([
  bank('synth.sx.clipbank', 'Init', 'clips', Array.from({ length: N_SLOTS }, defaultClipSlot)),
  bank('synth.sx.clipbank', 'Basslines', 'clips', Array.from({ length: N_SLOTS }, (_, j) => genBassline(j + 1))),
  bank('synth.sx.clipbank', 'Chords', 'clips', CHORDS),
  bank('synth.sx.clipbank', 'Slices', 'clips', SLICES),
  bank('synth.sx.clipbank', 'Melodies', 'clips', Array.from({ length: N_SLOTS }, (_, j) => genMelody(j + 1))),
]);
export const FACTORY_PATTERNS = deepFreeze([{ type: 'synth.sx.arppat', v: 1, name: 'Init', pat: defaultPattern() }]
  .concat(PATTERNS.map(p => ({ type: 'synth.sx.arppat', v: 1, name: p.name, pat: p }))));

/* ================================================================ user banks: storage helpers (pure; I/O by the app store) */

export const STORE_KEYS = deepFreeze({ arpBanks: 'synth.sx.arpbanks', clipBanks: 'synth.sx.clipbanks', arpPats: 'synth.sx.arppats', clips: 'synth.sx.clips' });
const PAY = { 'synth.sx.arpbank': 'slots', 'synth.sx.clipbank': 'clips', 'synth.sx.arppat': 'pat', 'synth.sx.clip': 'clip' };
const nameOf = (x, d) => strIn(x, d, 64).trim() || d;
/** Save Arp Bank: { type: 'synth.sx.arpbank', v: 1, name, slots } */
export function arpBankPayload(arp, name) { return { type: 'synth.sx.arpbank', v: 1, name: nameOf(name, 'Arp Bank'), slots: normalizeArp(arp).slots }; }
/** Save Clip Bank: { type: 'synth.sx.clipbank', v: 1, name, clips } */
export function clipBankPayload(clip, name) { return { type: 'synth.sx.clipbank', v: 1, name: nameOf(name, 'Clip Bank'), clips: normalizeClip(clip).clips }; }
/** Pattern preset (pattern editor Save): { type: 'synth.sx.arppat', v: 1, name, pat } */
export function patPayload(pat, name) {
  const p = normalizeArpSlot({ pat }).pat;
  p.name = nameOf(name, 'Pattern').slice(0, 32);
  return { type: 'synth.sx.arppat', v: 1, name: p.name, pat: p };
}
/** Clip preset (CLIP field save): { type: 'synth.sx.clip', v: 1, name, clip } */
export function clipPayload(clip, name) {
  const c = normalizeClipSlot(clip);
  c.name = nameOf(name, 'Clip').slice(0, 32);
  return { type: 'synth.sx.clip', v: 1, name: c.name, clip: c };
}
function normPayload(p, type) {
  if (!isObj(p) || p.type !== type || typeof p.name !== 'string' || !p.name.trim()) return null;
  const name = nameOf(p.name, '');
  if (type === 'synth.sx.arpbank') return { type, v: 1, name, slots: normalizeArp({ slots: p.slots }).slots };
  if (type === 'synth.sx.clipbank') return { type, v: 1, name, clips: normalizeClip({ clips: p.clips }).clips };
  if (type === 'synth.sx.arppat') return { type, v: 1, name, pat: normalizeArpSlot({ pat: p.pat }).pat };
  return { type, v: 1, name, clip: normalizeClipSlot(p.clip) };
}
/** A stored library (JSON text or parsed array) → normalized payloads of `type` (invalid entries dropped, names unique: last wins). */
export function readLib(raw, type) {
  let a = raw;
  if (typeof raw === 'string') { try { a = JSON.parse(raw); } catch (err) { a = null; } }
  if (!PAY[type]) return [];
  const out = new Map();
  for (const p of arrOf(a)) { const q = normPayload(p, type); if (q) { out.delete(q.name); out.set(q.name, q); } }
  return Array.from(out.values());
}
/** Library with `payload` added (replacing an entry of the same name). */
export function libPut(lib, payload) { const p = clone(payload); return arrOf(lib).filter(x => !isObj(x) || x.name !== p.name).concat([p]); }
/** Library without the entry `name`. */
export function libDel(lib, name) { return arrOf(lib).filter(x => !isObj(x) || x.name !== name); }
/** Load an arp bank payload into `s.arp`: its 12 slots, bank name, not dirty (selection, quant, MIDI OUT kept). → new arp */
export function loadArpBank(arp, payload) {
  const A = normalizeArp(arp), p = normPayload(payload, 'synth.sx.arpbank');
  if (!p) return A;
  return Object.assign(A, { bank: p.name, dirty: 0, slots: p.slots });
}
/** Load a clip bank payload into `s.clip` (as loadArpBank). → new clip */
export function loadClipBank(clip, payload) {
  const C = normalizeClip(clip), p = normPayload(payload, 'synth.sx.clipbank');
  if (!p) return C;
  return normalizeClip(Object.assign(C, { bank: p.name, dirty: 0, clips: p.clips }));
}
