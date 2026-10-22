/* moog-dsp.js — PatchMoog, the 900-series family's module circuits (IMPL-9 §3.4, §3.5; lane V9b): the Model 15 set (921,
 * 921A, 921B, 923, 904A, 907A, 911, 902, 995) and our controller ('ctl', §2.4), each a class the generic evaluator
 * (patch-dsp.js → PatchDSP, lane V9a) instantiates per module and runs per (module, section) node. A classic AudioWorklet
 * script (no imports / exports): one IIFE publishes the frozen globalThis.PatchMoog; a failure inside leaves it null and
 * never throws (dr-808.js's rule). It reads no other script's global at load (the scripts load in parallel). Module numbers
 * and function names are facts (RM header); every circuit here is our own model in our own code, its numbers sourced in
 * docs/canvas/research-moog-modules.md §10 "as modelled" (each value with its tag).
 *
 *   globalThis.PatchMoog = { id 'moog', VER, T: { <type>: class }, ORDER, JACKS, SECS, PARAMS, SINK 'out', LINK, OUT_K, CTL
 *                            'ctl', IO, BL, Z, RANGE (each param's [lo, hi]), K (the constants), ex2, tanp, rail, psin, KW }
 *   JACKS[t]   [{ id, dir 'in' | 'out' | 'any', sig 'v' | 's', sec, norm?, ac? }] in moog-core's table order (a payload port
 *              = its index; moog-core.test cross-checks) · SECS[t] the section count · PARAMS[t] [[id, def, snap?], …] in
 *              table order (snap: a switch, it jumps; the controller's = m900's control order, pv['0'])
 *   SINK       the controller's MAIN OUT jack · LINK['921b'] = { from '921a', def [0, 0] }: a driven 921B reads its driver's
 *              two link outputs (V_drv, the width offset) on its two link inputs; undriven 0 V and 0 (50 %)
 *   IO[t]      the slots as the evaluator assigns them (patch-dsp.js header): ii / oi per jack (−1: none), nIn / nOut with
 *              the link's — ins = the 'in' jacks in table order then the link inputs, outs = the 'out' jacks then the link
 *              outputs; the multiples ('any') and the sink are the evaluator's (no slot is run by a class for them)
 *
 * The module shape (patch-dsp.js's header, IMPL-9 §7.4; written out in every class — a shared base method goes megamorphic):
 *   new T[t](h)      h = { fs, OS, n, salt, inst, type }: builds outs (Float64Array(BL = 32) each — 923 WHITE 1 / 2 and the
 *                    controller's PITCH 1 / 2, S-TRIG 1 / 2 share one) and the fresh state (noise / drift seeded by
 *                    0x9E3779B9 ^ salt ^ hash32(n)); default ins (Z), p / t (the defaults), mv 1, om (every output)
 *   ins, p, t, mv, om  the evaluator's: assigned and written by it, read here (an unpatched input reads the evaluator's zero
 *                    buffer — learned from its first whole-array `ins` assignment — so its work is skipped, bit-identically)
 *   flush()          every 32nd absolute chunk: recursive states below 1e-30 → 0
 *   ctl(cc)          once a chunk before any run: mv 1 → the coefficients from p (each value clamped into its range: the
 *                    knobs' glide is the evaluator's); the keyboard's note state, the drift
 *   run(sec, i0, n)  section sec over samples [i0, i0 + n) — a block step (0, CH) or a loop member (i, 1): the same bits;
 *                    only the outputs whose om bit is set are written (phases, envelopes and filters advance regardless)
 *   setOS(fs, os?)   the rate (os inferred from a 44.1 / 48 kHz base when absent) · reset() the fresh state · setSalt(s)
 * The controller adds note(n, v 0…1, on), reads h.inst's bend (semitones) / wheel / at (0…1) / sustain in its ctl, and sets
 * og = OUT_K × OUTPUT / 10 (MAIN OUT's full scale per volt, which the evaluator applies). The oscillators (921, 921B) take
 * h.inst.p.drift (the app's analog drift, as the classics'; else their own `dr`; 0 = none, the goldens) as a seeded slow walk
 * of ≈ 4 cents RMS × it.
 *
 * Conventions (§2.1): volts everywhere, Float64 at the OS rate; 1 V/oct with 0 V = C4; S-trigger lines carry 1 (closed) / 0
 * (open) per sample; a V-trigger edge is a rise through +1.5 V (re-armed below +1.0 V); the active outputs that can leave
 * −5 … +11 V soft-clip into −6 … +12 V (rail: linear inside, a quadratic knee) — the oscillators, envelopes and the 995 are
 * bounded by construction and skip it (the multiples are passive: the evaluator sums them).
 * Oscillators (921, 921B): one phase, four waveforms from it; every discontinuity — the wrap, the triangle's corners, the
 * rectangle's edges, a clamp, a sync reset — is placed at its sub-sample time and corrected by the 2-point polyBLEP (steps) /
 * polyBLAMP (slope changes) on the sample before and the sample after: the outputs run one OS sample late (5.2 µs at 48 k × 4).
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const BL = 32;                                  // a chunk at OS 8 (CH = 4·OS)
    const TAU = 2 * Math.PI;
    const C4 = 261.6255653005986;                   // 0 V at 8′ (Hz) [C]
    const EMAX = 5.5;                               // the 911's peak [R RM §1.3 JD-911]
    // MAIN OUT: volts → full scale (6.67 V = 1) [C, §3.2 "V9b pins it"]: at the contract's 0.1 K9's Classic bass peaked at
    // −14.1 dBFS, under the −12 … −3 headroom window; 0.15 puts it at −10.6 (48 k × 4 and 44.1 k × 2, tests/moog-dsp)
    const OUT_K = 0.15;
    const AS = Math.sqrt(3) / 2, AN = 0.705, AT = 0.565, AR = 0.85;   // saw 1.73, sine 1.41, triangle 1.13, rectangle 1.70 Vpp [§2.1]
    const TINY = 1e-30;
    const Z = new Float64Array(BL);                 // an unpatched input before an evaluator wires the module (never written)

    /* ------------------------------------------------------------ maths */
    const EXT = new Float64Array(41);
    for (let i = 0; i < 41; i++) EXT[i] = Math.pow(2, i - 20);
    // 2^v: the exponent clamped to ±20 (three inputs at a rail reach ≈ ±45), NaN → 2^0; 2^⌊v⌋ from the table × a degree-5 fit
    // of 2^f on [0, 1) (≤ 1.5e-4 cent; spike (a): Math.pow +7–17 %)
    function ex2(v) {
      if (v > 20) v = 20; else if (v < -20) v = -20; else if (v !== v) v = 0;
      const i = Math.floor(v), f = v - i;
      return EXT[i + 20] * (1 + f * (0.6931513628571114 + f * (0.24016415359818452 + f * (0.0558004467959535 +
        f * (0.009016687947411794 + f * 0.0018671827293546728)))));
    }
    // tan x, 0 ≤ x ≤ 0.46π: the [5/4] Padé (≤ 3.9e-5 relative, 0.006 cent at the clamp; Math.tan +4–8 %)
    function tanp(x) { const x2 = x * x; return x * (945 + x2 * (-105 + x2)) / (945 + x2 * (-420 + 15 * x2)); }
    // tanh(x)/x, the ladder's secant gain (engine.js `tr`, re-written: the Padé, 1/|x| past 3)
    function tr(x) { const x2 = x * x; if (x2 > 9) return 1 / Math.abs(x); return (27 + x2) / (27 + 9 * x2); }
    // the rails (§2.1): linear inside −5 … +11, a quadratic knee into −6 / +12 (slope 1 → 0 over 2 V); NaN → 0
    function rail(x) { return x <= 11 && x >= -5 ? x : knee(x); }
    function knee(x) {
      if (x > 11) return x >= 13 ? 12 : 12 - 0.25 * (13 - x) * (13 - x);
      if (x < -5) return x <= -7 ? -6 : -6 + 0.25 * (x + 7) * (x + 7);
      return 0;
    }
    // sin 2π·ph for ph in [0, 1.5): folded into ±¼ cycle, Taylor to x⁹ (≤ 3.6e-6)
    function psin(ph) {
      let t = ph < 0.5 ? ph : ph < 1.5 ? ph - 1 : ph - 2;
      if (t > 0.25) t = 0.5 - t; else if (t < -0.25) t = -0.5 - t;
      const x = TAU * t, x2 = x * x;
      return x * (1 + x2 * (-0.16666666666666666 + x2 * (0.008333333333333333 + x2 * (-1.984126984126984e-4 + x2 * 2.7557319223985893e-6))));
    }
    function hash32(a) { a ^= a >>> 16; a = Math.imul(a, 0x7feb352d); a ^= a >>> 15; a = Math.imul(a, 0x846ca68b); a ^= a >>> 16; return a >>> 0; }
    const seedOf = (salt, n) => ((0x9E3779B9 ^ (salt | 0) ^ hash32(n >>> 0)) >>> 0) || 1;
    const osOf = (fs, os) => os > 0 ? os | 0 : Math.max(1, Math.round(fs / (fs % 44100 === 0 ? 44100 : 48000)));
    const cl = (x, lo, hi) => (x >= lo ? x <= hi ? x : hi : x < lo ? lo : (lo + hi) / 2);   // (NaN → mid: never reached, the evaluator's values are finite)

    /* ------------------------------------------------------------ the tables (moog-core's ids and order; cross-checked) */
    // a jack: [id, dir i / o / a, sig v / s, sec, norm id?, ac?]; a param: [id, def, lo, hi, switch]
    const J = (id, d, s, sec, norm, ac) => [id, d, s, sec || 0, norm || '', ac ? 1 : 0];
    const P = (id, def, lo, hi, sw) => [id, def, lo, hi, sw ? 1 : 0];
    const OUT4 = [J('sin', 'o', 'v'), J('tri', 'o', 'v'), J('saw', 'o', 'v'), J('rec', 'o', 'v')];
    const ids = (p, n) => Array.from({ length: n }, (_, i) => p + (i + 1));   // ('b', 3) → b1 b2 b3 (stage 9b's rows)
    const SPEC = {
      ctl: {
        jacks: [J('kp1', 'o', 'v'), J('kp2', 'o', 'v'), J('ks1', 'o', 's'), J('ks2', 'o', 's'), J('kg', 'o', 'v'), J('kv', 'o', 'v'),
          J('kw', 'o', 'v'), J('ka', 'o', 'v'),
          J('m1', 'i', 'v', 1), J('m2', 'i', 'v', 1), J('m3', 'i', 'v', 1), J('m4', 'i', 'v', 1), J('mo', 'o', 'v', 1), J('mn', 'o', 'v', 1),
          J('a1', 'a', 'v', 2), J('a2', 'a', 'v', 2), J('a3', 'a', 'v', 2), J('a4', 'a', 'v', 2),
          J('b1', 'a', 'v', 3), J('b2', 'a', 'v', 3), J('b3', 'a', 'v', 3), J('b4', 'a', 'v', 3),
          J('vi', 'i', 'v', 4), J('vo', 'o', 's', 4), J('si', 'i', 's', 5), J('so', 'o', 'v', 5), J('out', 'i', 'v', 6)],
        params: [P('gl', 0, 0, 10), P('pr', 0, 0, 1, 1), P('rt', 0, 0, 1, 1), P('tu', 0, -50, 50),
          P('x1', 7, 0, 10), P('x2', 7, 0, 10), P('x3', 7, 0, 10), P('x4', 7, 0, 10), P('ov', 7, 0, 10)],
        nsec: 7,
      },
      921: {
        jacks: [J('f1', 'i', 'v'), J('f2', 'i', 'v'), J('f3', 'i', 'v'), J('w1', 'i', 'v'), J('w2', 'i', 'v'), J('cv', 'i', 'v'), J('cs', 'i', 's'),
          J('xm', 'o', 'v'), J('xp', 'o', 'v'), ...OUT4],
        params: [P('sp', 0, 0, 1, 1), P('cr', 1, 0, 1, 1), P('fq', 0, -6, 6), P('rg', 2, 0, 5, 1), P('pw', 50, 10, 90), P('ax', 2, 0, 5, 1),
          P('cl', 0, 0, 100), P('al', 5, 0, 10)],
        nsec: 1,
      },
      '921a': {
        jacks: [J('f1', 'i', 'v'), J('f2', 'i', 'v'), J('f3', 'i', 'v'), J('w1', 'i', 'v'), J('w2', 'i', 'v')],
        params: [P('sp', 0, 0, 1, 1), P('fq', 0, -6, 6), P('pw', 50, 10, 90)],
        nsec: 1, xout: 2,                               // V_drv and the width offset over the rear link (no jack)
      },
      '921b': {
        jacks: [J('dc', 'i', 'v'), J('ac', 'i', 'v', 0, '', 1), J('sy', 'i', 'v'), ...OUT4],
        params: [P('rg', 3, 0, 5, 1), P('fq', 0, -6, 6), P('ss', 1, 0, 2, 1)],
        nsec: 1, xin: 2,                                // the link's two inputs (ins 3, 4)
      },
      923: {
        jacks: [J('wh1', 'o', 'v'), J('wh2', 'o', 'v'), J('pk', 'o', 'v'), J('li', 'i', 'v', 1), J('lo', 'o', 'v', 1), J('hi', 'i', 'v', 2), J('ho', 'o', 'v', 2)],
        params: [P('lp', 5, 0, 10), P('hp', 5, 0, 10)],
        nsec: 3,
      },
      '904a': {
        jacks: [J('in', 'i', 'v'), J('c1', 'i', 'v'), J('c2', 'i', 'v'), J('c3', 'i', 'v'), J('out', 'o', 'v')],
        params: [P('fc', 0, -6, 6), P('rg', 1, 0, 2, 1), P('re', 0, 0, 10)],
        nsec: 1,
      },
      '907a': {
        jacks: [J('in', 'i', 'v'), J('out', 'o', 'v')],
        params: [P('lo', 10, 0, 10), P('b1', 10, 0, 10), P('b2', 10, 0, 10), P('b3', 10, 0, 10), P('b4', 10, 0, 10), P('b5', 10, 0, 10),
          P('b6', 10, 0, 10), P('b7', 10, 0, 10), P('b8', 10, 0, 10), P('hi', 10, 0, 10)],
        nsec: 1,
      },
      911: {
        jacks: [J('trg', 'i', 's'), J('out', 'o', 'v')],
        params: [P('t1', 1, 0, 10), P('t2', 5, 0, 10), P('t3', 4, 0, 10), P('es', 7, 0, 10)],
        nsec: 1,
      },
      902: {
        jacks: [J('i1', 'i', 'v'), J('i2', 'i', 'v'), J('o1', 'o', 'v'), J('o2', 'o', 'v'), J('c1', 'i', 'v'), J('c2', 'i', 'v'), J('c3', 'i', 'v')],
        params: [P('md', 0, 0, 1, 1), P('fc', 0, -6, 6)],
        nsec: 1,
      },
      995: {
        jacks: [J('i1', 'i', 'v', 0), J('o1', 'o', 'v', 0), J('i2', 'i', 'v', 1, 'i1'), J('o2', 'o', 'v', 1), J('i3', 'i', 'v', 2, 'i2'), J('o3', 'o', 'v', 2)],
        params: [P('a1', 0, 0, 10), P('a2', 0, 0, 10), P('a3', 0, 0, 10)],
        nsec: 3,
      },
      // stage 9b (IMPL-9b §2.2 / §2.3, lane V9c): the System 35 / 55 types, appended — the rows above untouched. A rear jack
      // (moog-core's `rear: 1`) is an ordinary slot here (§2.7: checked moog-core ↔ faces only); EV / LAMPS below
      '904b': {
        jacks: [J('in', 'i', 'v'), J('c1', 'i', 'v'), J('c2', 'i', 'v'), J('c3', 'i', 'v'), J('out', 'o', 'v')],
        params: [P('fc', 0, -6, 6), P('rg', 0, 0, 1, 1)],
        nsec: 1,
      },
      914: {
        jacks: [J('i1', 'i', 'v'), J('i2', 'i', 'v'), J('o1', 'o', 'v'), J('o2', 'o', 'v')],
        params: [P('lo', 10, 0, 10), ...ids('b', 12).map(id => P(id, 10, 0, 10)), P('hi', 10, 0, 10)],
        nsec: 1,
      },
      '911a': {
        jacks: [J('i1', 'i', 's'), J('o1', 'o', 's'), J('i2', 'i', 's'), J('o2', 'o', 's')],
        params: [P('d1', 3, 0, 10), P('d2', 3, 0, 10), P('md', 0, 0, 2, 1)],
        nsec: 1,
      },
      '903a': {
        jacks: [J('wh1', 'o', 'v'), J('wh2', 'o', 'v'), J('pk1', 'o', 'v'), J('pk2', 'o', 'v')],
        params: [],
        nsec: 1,
      },
      960: {
        jacks: [J('on', 'i', 'v'), J('off', 'i', 'v'), J('sh', 'i', 'v'), J('ci', 'i', 'v'), J('co', 'o', 'v'), ...ids('i', 9).map(id => J(id, 'i', 'v')),
          ...ids('o', 9).map(id => J(id, 'o', 'v')), J('ra1', 'o', 'v'), J('ra2', 'o', 'v'), J('rb1', 'o', 'v'), J('rb2', 'o', 'v'), J('rc1', 'o', 'v'), J('rc2', 'o', 'v')],
        params: [...ids('a', 8).map(id => P(id, 0, 0, 10)), ...ids('b', 8).map(id => P(id, 0, 0, 10)), ...ids('c', 8).map(id => P(id, 0, 0, 10)),
          ...ids('s', 8).map(id => P(id, 1, 0, 2, 1)), P('s9', 1, 0, 1, 1), P('ga', 0, 0, 2, 1), P('gb', 0, 0, 2, 1), P('gc', 0, 0, 2, 1),
          P('rg', 2, 0, 6, 1), P('vn', 2, 0, 10), P('cc', 0, 0, 1, 1), P('os', 1, 0, 1, 1)],
        nsec: 1,
      },
      961: {
        jacks: [...ids('a1', 6).map(id => J(id, 'i', 'v', 0)), ...ids('b1', 6).map(id => J(id, 'i', 'v', 0)), J('s1', 'o', 's', 0),
          ...ids('a2', 6).map(id => J(id, 'i', 'v', 1)), ...ids('b2', 6).map(id => J(id, 'i', 'v', 1)), J('s2', 'o', 's', 1),
          J('v1i', 'i', 's', 2), J('v1o', 'o', 'v', 2), J('v2i', 'i', 's', 3), J('v2o', 'o', 'v', 3), J('ai', 'i', 'v', 4), J('ao1', 'o', 'v', 4), J('ao2', 'o', 'v', 4)],
        params: [P('t1', 5, 0, 10), P('t2', 5, 0, 10), P('se', 5, 0, 10)],
        nsec: 5,
      },
      962: {
        jacks: [J('i1', 'i', 'v'), J('i2', 'i', 'v'), J('i3', 'i', 'v'), J('q1', 'o', 'v'), J('q2', 'o', 'v'), J('t1', 'i', 'v'), J('t2', 'i', 'v'), J('t3', 'i', 'v'),
          J('o1', 'o', 'v'), J('o2', 'o', 'v'), J('o3', 'o', 'v'), J('sh', 'i', 'v')],
        params: [],
        nsec: 1,
      },
      992: {
        jacks: [J('x4', 'i', 'v'), J('xr', 'o', 'v')],
        params: [P('s1', 0, 0, 1, 1), P('s2', 0, 0, 1, 1), P('s3', 0, 0, 1, 1), P('s4', 0, 0, 1, 1), P('at', 0, -10, 10)],
        nsec: 1,
      },
      993: {
        jacks: [],
        params: ['f1', 'f2', 't1', 't2', 't3', 'e1', 'e2', 'e3'].map(id => P(id, 0, 0, 1, 1)),
        nsec: 1,
      },
      994: {
        jacks: [...ids('a', 4).map(id => J(id, 'a', 'v', 0)), ...ids('b', 4).map(id => J(id, 'a', 'v', 1))],
        params: [],
        nsec: 2,
      },
      cp2: {
        jacks: [J('li', 'i', 'v', 0), J('lo', 'o', 'v', 0), J('hi', 'i', 'v', 1), J('ho', 'o', 'v', 1), ...ids('u', 4).map(id => J(id, 'a', 'v', 2)),
          J('po', 'o', 'v', 3), J('so', 'o', 's', 3), J('kpr', 'i', 'v', 3), J('ksr', 'i', 's', 3)],
        params: [P('lp', 5, 0, 10), P('hp', 5, 0, 10)],
        nsec: 4,
      },
      cp3a: {
        jacks: [...ids('m', 4).map(id => J(id, 'i', 'v', 0)), J('mo', 'o', 'v', 0), J('mn', 'o', 'v', 0), J('x4', 'i', 'v', 1), J('xr', 'o', 'v', 1),
          ...ids('a', 4).map(id => J(id, 'a', 'v', 2))],
        params: [...ids('x', 4).map(id => P(id, 7, 0, 10)), P('ms', 5, 0, 10), ...ids('r', 4).map(id => P(id, 0, 0, 1, 1)), P('ra', 10, 0, 10)],
        nsec: 3,
      },
      cp4a: {
        jacks: [J('ti', 'i', 's', 0), J('tr', 'o', 's', 0), J('ci', 'i', 'v', 1), J('cr', 'o', 'v', 1)],
        params: [...ids('c', 4).map(id => P(id, 0, 0, 1, 1)), ...ids('t', 3).map(id => P(id, 0, 0, 1, 1))],
        nsec: 2,
      },
      cp35: {
        jacks: [J('p6', 'o', 'v', 0), J('m6', 'o', 'v', 0), J('i1', 'i', 'v', 1, 'p6'), J('o1', 'o', 'v', 1), J('i2', 'i', 'v', 2, 'p6'), J('o2', 'o', 'v', 2),
          J('i3', 'i', 'v', 3, 'm6'), J('o3', 'o', 'v', 3), J('i4', 'i', 'v', 4, 'm6'), J('o4', 'o', 'v', 4), ...ids('u', 4).map(id => J(id, 'a', 'v', 5))],
        params: ids('a', 4).map(id => P(id, 0, 0, 10)),
        nsec: 6,
      },
      cp8a: {
        jacks: [],
        params: [],
        nsec: 1,
      },
      clk: {
        jacks: [J('ck', 'o', 'v'), J('rn', 'o', 'v'), J('rs', 'o', 'v')],
        params: [P('dv', 2, 0, 5, 1), P('md', 0, 0, 1, 1), P('ln', 0, 0, 31, 1)],    // LENGTH: OFF, 2 … 32 steps (index + 1; P-2 (b))
        nsec: 1,
      },
    };
    const ORDER = ['ctl', '921', '921a', '921b', '923', '904a', '907a', '911', '902', '995',
      '904b', '914', '911a', '903a', '960', '961', '962', '992', '993', '994', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', 'clk'];
    // momentary events and live lamps (IMPL-9b §1.5 / §1.6): the ids in order (= moog-core's `ev` / `lamps`); every type a row
    const EV0 = { 960: ['on', 'off', 'sh', ...ids('e', 9)], 962: ids('e', 3) }, LAMP0 = { 960: [...ids('l', 9), 'lo'], 962: ids('l', 3), clk: ['lr'] };
    const DIR = { i: 'in', o: 'out', a: 'any' };
    const JACKS = {}, SECS = {}, PARAMS = {}, IO = {}, PS = {};
    for (const t of ORDER) {
      const S = SPEC[t], js = S.jacks;
      JACKS[t] = Object.freeze(js.map(j => Object.freeze(Object.assign({ id: j[0], dir: DIR[j[1]], sig: j[2], sec: j[3] }, j[4] ? { norm: j[4] } : {}, j[5] ? { ac: 1 } : {}))));
      SECS[t] = S.nsec;
      PARAMS[t] = Object.freeze(S.params.map(p => Object.freeze(p[4] ? [p[0], p[1], 1] : [p[0], p[1]])));
      // the evaluator's slots: 'in' jacks then the link inputs; 'out' jacks then the link outputs ('any': none)
      const ii = [], oi = [];
      let ni = 0, no = 0;
      for (const j of js) { ii.push(j[1] === 'i' ? ni++ : -1); oi.push(j[1] === 'o' ? no++ : -1); }
      IO[t] = Object.freeze({ ii: Object.freeze(ii), oi: Object.freeze(oi), nIn: ni + (S.xin || 0), nOut: no + (S.xout || 0) });
      const ps = S.params;                              // the values' ranges (coefficients clamp into them)
      PS[t] = { n: ps.length, def: ps.map(p => p[1]), lo: Float64Array.from(ps.map(p => p[2])), hi: Float64Array.from(ps.map(p => p[3])) };
    }
    const LINK = Object.freeze({ '921b': Object.freeze({ from: '921a', def: Object.freeze([0, 0]) }) });

    // the module's common fields (each class calls it first, in the same order). Every field that can ever hold a double (or an
    // integer past 2^30) starts as one — `x = 0.5; x = 0` — here and in every constructor below: V8 changes an object's map when
    // a small-integer field first takes a double, and the code compiled for the old map deopts ("wrong map", "lost precision")
    // in the first quanta of a new Track; a field written twice with different values is mutable from its constructor on (not a
    // constant: the first change after it flipped "dependent field type constness" and deopted the compiled ctl)
    function base(m, h, t) {
      const io = IO[t];
      m.n = (h.n | 0) >>> 0; m.fs = 0.5; m.fs = +h.fs || 48000; m.os = osOf(m.fs, +h.OS || 0); m.salt = 0.5; m.salt = (h.salt | 0) >>> 0; m.inst = h.inst || null;
      m.zb = Z; m.i_ = null;
      const ins = []; for (let k = 0; k < io.nIn; k++) ins.push(Z);
      m.ins = ins;
      m.outs = []; for (let k = 0; k < io.nOut; k++) m.outs.push(new Float64Array(BL));
      m.p = Float64Array.from(PS[t].def); m.t = Float64Array.from(PS[t].def); m.mv = 1; m.om = (1 << io.nOut) - 1;
    }
    // ins: the evaluator assigns a whole array once (every entry its zero buffer) — learned as zb, what "unpatched" reads
    const insAcc = {
      get() { return this.i_; },
      set(a) { this.i_ = a; if (a && a.length > 1 && ArrayBuffer.isView(a[0])) { const z = a[0]; let s = 1; for (let k = 1; k < a.length; k++) if (a[k] !== z) s = 0; for (let k = 0; s === 1 && k < z.length; k++) if (z[k] !== 0) s = 0; if (s === 1) this.zb = z; } },
    };
    // the oscillators' drift: an Ornstein–Uhlenbeck walk per chunk (τ 2 s), 0.0033 oct (≈ 4 cents) RMS × the amount — the
    // Inst's p.drift (the app's analog-drift preference, as the classics') when the host has one, else the module's dr [C]
    function rnd(m) { let r = m.rs; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; m.rs = r >>> 0; return m.rs / 2147483648 - 1; }
    function drift(m) {
      const I = m.inst, d = I !== null && I.p ? +I.p.drift || 0 : m.dr;
      if (d > 0) m.dv += (0.0033 * d * 1.7320508 * rnd(m) * Math.sqrt(2 / m.dk - 1) - m.dv) * m.dk; else m.dv = 0;
    }

    /* ------------------------------------------------------------ the oscillators' event solver */
    // One class (monomorphic), a member of every 921 / 921B: called only on a sample with an event in (n − 1, n] — the wrap,
    // a triangle corner, a rectangle edge, a reset (sync / clamp) at u ∈ [0, 1] after sample n − 1. For each unit waveform
    // (saw 2p − 1, triangle, sine, rectangle ±1) it sums the 2-point polyBLEP of every step h and the polyBLAMP of every slope
    // change m (per sample) into s0 / t0 / n0 / r0 (the last sample's correction: h(1 − u)²/2 + m(1 − u)³/6) and s1 / t1 / n1
    // / r1 (this sample's: −h·u²/2 + m·u³/6); q the rectangle's level after the sample; returns the phase at n.
    const triU = p => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p);
    class Osc {
      constructor() {
        this.q = 1; this.s0 = this.s1 = this.t0 = this.t1 = this.n0 = this.n1 = this.r0 = this.r1 = 0.25;   // (doubles from the first write)
        this.s0 = 0; this.s1 = 0; this.t0 = 0; this.t1 = 0; this.n0 = 0; this.n1 = 0; this.r0 = 0; this.r1 = 0;
      }
      ev(ph, dt, w, ru, rp, q) {
        this.s0 = 0; this.s1 = 0; this.t0 = 0; this.t1 = 0; this.n0 = 0; this.n1 = 0; this.r0 = 0; this.r1 = 0;
        let p = ph, u0 = 0;
        if (ru >= 0) {
          p = this.seg(p, dt, w, 0, ru, q); q = this.q;
          if (rp >= 1) rp -= 1;
          // the reset p → rp at ru: every waveform's value step, the triangle's and the sine's slope steps
          const v = 1 - ru, a = 0.5 * v * v, b = -0.5 * ru * ru, A = v * v * v / 6, B = ru * ru * ru / 6;
          const hS = 2 * (rp - p), hT = triU(rp) - triU(p), mT = ((rp < 0.5) === (p < 0.5) ? 0 : rp < 0.5 ? 8 : -8) * dt;
          const hN = psin(rp) - psin(p), mN = TAU * dt * (psin(rp + 0.25) - psin(p + 0.25));
          const qr = rp < w ? 1 : -1, hR = qr - q;
          this.s0 += hS * a; this.s1 += hS * b;
          this.t0 += hT * a + mT * A; this.t1 += hT * b + mT * B;
          this.n0 += hN * a + mN * A; this.n1 += hN * b + mN * B;
          this.r0 += hR * a; this.r1 += hR * b;
          q = qr; p = rp; u0 = ru;
        }
        p = this.seg(p, dt, w, u0, 1, q);
        const qe = p < w ? 1 : -1;
        if (qe !== this.q) { this.r1 -= 0.5 * (qe - this.q); this.q = qe; }   // a width moved across the phase: centred on n
        return p;
      }
      // free motion from phase p at ua to ub: the triangle's corners, the rectangle's fall at w, the wrap (saw, triangle,
      // rectangle) and a fall after it; → the phase at ub (this.q the rectangle's level)
      seg(p, dt, w, ua, ub, q) {
        let e = p + dt * (ub - ua);
        if (p < 0.5 && e >= 0.5) this.bt(ua + (0.5 - p) / dt, -8 * dt);
        if (q > 0 && p < w && e >= w) { this.br(ua + (w - p) / dt, -2); q = -1; }
        if (e >= 1) {
          const u = ua + (1 - p) / dt;
          this.bs(u, -2); this.bt(u, 8 * dt);
          if (q < 0) { this.br(u, 2); q = 1; }
          e -= 1;
          if (e >= w) { this.br(u + w / dt, -2); q = -1; }
          if (e >= 0.5) this.bt(u + 0.5 / dt, -8 * dt);
        }
        this.q = q;
        return e;
      }
      bs(u, h) { const v = 1 - u; this.s0 += 0.5 * h * v * v; this.s1 -= 0.5 * h * u * u; }
      br(u, h) { const v = 1 - u; this.r0 += 0.5 * h * v * v; this.r1 -= 0.5 * h * u * u; }
      bt(u, m) { const v = 1 - u; this.t0 += m * v * v * v / 6; this.t1 += m * u * u * u / 6; }
    }

    /* ------------------------------------------------------------ 921: oscillator */
    // f = C4 · 2^(ΣV + range + FREQUENCY [+ SUB-AUDIO −10]); the width 1 V = 10 % on the knob, 5 … 95 %; a clamp (a V edge at
    // its sub-sample crossing, an S closure on its sample) resets the phase to CLAMPING POINT; AUX ± = the selected waveform at
    // its fixed level × AUX LEVEL / 2 (≈ ±4.3 V for the saw at 10)
    const S921 = PS['921'];
    class M921 {
      constructor(h) {
        base(this, h, '921');
        this.ph = this.pS = this.pT = this.pN = this.pR = this.vp = this.kc = this.kv = this.pwk = this.al = this.clp = this.dr = this.dv = this.rs = this.dk = 0.25;
        this.o = new Osc(); this.ph = 0; this.ql = 1; this.pS = -1; this.pT = -1; this.pN = 0; this.pR = 1;
        this.hi = 0; this.vp = 0; this.sp = 0; this.oml = -1;   // (-1: the first ctl takes the mask branch, in the warm-up too)
        this.kc = 0; this.kv = 0; this.pwk = 0.5; this.ax = 2; this.al = 2.5; this.clp = 0; this.dr = 0; this.dv = 0; this.rs = 1; this.dk = 0;
        this.setSalt(this.salt); this.rate(); this.coef();
      }
      rate() { this.kc = C4 / this.fs; this.dk = 1 - Math.exp(-(4 * this.os / this.fs) / 2); }
      coef() {
        const p = this.p, S = S921, sp = cl(p[0], 0, 1), cr = cl(p[1], 0, 1), fq = cl(p[2], -6, 6), rg = cl(p[3], 0, 5) | 0;
        this.kv = (rg - 2) + (sp >= 0.5 ? fq : fq / 6) + (cr < 0.5 ? -10 : 0);
        this.pwk = cl(p[4], S.lo[4], S.hi[4]) / 100; this.ax = cl(p[5], 0, 5) | 0; this.al = cl(p[7], 0, 10) / 2;
        const c = cl(p[6], 0, 100); this.clp = c >= 100 ? 0 : c / 100;
      }
      flush() {}
      ctl(cc) {
        if (this.mv !== 0) this.coef();
        drift(this);
        if (this.om !== this.oml) { this.oml = this.om; const p = this.ph; this.pS = 2 * p - 1; this.pT = triU(p); this.pN = psin(p); this.pR = this.ql; }
      }
      run(sec, i0, n) {
        const I = this.i_, f1 = I[0], f2 = I[1], f3 = I[2], w1 = I[3], w2 = I[4], cv = I[5], cs = I[6], Zb = this.zb;
        const U = this.outs, xm = U[0], xp = U[1], oN = U[2], oT = U[3], oS = U[4], oR = U[5];
        const om = this.om, ax = this.ax, au = (om & 3) !== 0, O = this.o;
        const wN = (om & 4) !== 0, wT = (om & 8) !== 0, wS = (om & 16) !== 0, wR = (om & 32) !== 0;
        const mN = wN || (au && ax === 0), mT = wT || (au && ax === 1), mS = wS || (au && (ax === 2 || ax === 3)), mR = wR || (au && ax >= 4);
        const ka = this.al * (ax === 0 ? AN : ax === 1 ? AT : ax === 2 ? AS : ax === 3 ? -AS : ax === 4 ? AR : -AR);
        const kc = this.kc, kv = this.kv + this.dv, pwk = this.pwk, clp = this.clp;
        // unpatched inputs skip their work: the pitch, the width, the clamp's two detectors (as if the zeros were read)
        // (each comparison on its own: `a !== Zb || b !== Zb` never reaches b while a is patched, and a comparison the warm-up never
        // ran has no type feedback — the compiled run deopts the first time a patch leaves a unpatched)
        const p1 = f1 !== Zb, p2 = f2 !== Zb, p3 = f3 !== Zb, fp = p1 || p2 || p3, q1 = w1 !== Zb, q2 = w2 !== Zb, wp = q1 || q2, ce = cv !== Zb, se = cs !== Zb;
        let dt = kc * ex2(kv); if (dt > 0.45) dt = 0.45;
        let w = pwk; w = w >= 0.05 ? w <= 0.95 ? w : 0.95 : 0.05;
        let ph = this.ph, ql = this.ql, pS = this.pS, pT = this.pT, pN = this.pN, pR = this.pR, hi = this.hi, vp = this.vp, sp = this.sp;
        for (let i = i0, e = i0 + n; i < e; i++) {
          if (fp) { let v = p1 ? f1[i] : 0; if (p2) v += f2[i]; if (p3) v += f3[i]; dt = kc * ex2(v + kv); if (dt > 0.45) dt = 0.45; }
          if (wp) { w = pwk + 0.1 * (w1[i] + w2[i]); w = w >= 0.05 ? w <= 0.95 ? w : 0.95 : 0.05; }
          let ru = -1;
          if (ce) { const v = cv[i]; if (hi === 0) { if (v > 1.5) { hi = 1; ru = (1.5 - vp) / (v - vp); } } else if (v < 1) hi = 0; vp = v; }
          if (se) { const s = cs[i] > 0.5 ? 1 : 0; if (s > sp && ru < 0) ru = 1; sp = s; }
          let p = ph + dt, cS = 0, cT = 0, cN = 0, cR = 0;
          if (ru >= 0 || p >= 1 || (ph < 0.5 && p >= 0.5) || (p < w) !== (ql > 0)) {
            p = O.ev(ph, dt, w, ru, clp, ql); ql = O.q;
            pS += O.s0; pT += O.t0; pN += O.n0; pR += O.r0; cS = O.s1; cT = O.t1; cN = O.n1; cR = O.r1;
          }
          ph = p;
          if (au) { const x = ka * (ax === 0 ? pN : ax === 1 ? pT : ax === 2 || ax === 3 ? pS : pR); xp[i] = x; xm[i] = -x; }
          if (mN) { if (wN) oN[i] = AN * pN; pN = psin(p) + cN; }
          if (mT) { if (wT) oT[i] = AT * pT; pT = (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) + cT; }
          if (mS) { if (wS) oS[i] = AS * pS; pS = 2 * p - 1 + cS; }
          if (mR) { if (wR) oR[i] = AR * pR; pR = ql + cR; }
        }
        this.ph = ph; this.ql = ql; this.pS = pS; this.pT = pT; this.pN = pN; this.pR = pR;
        this.hi = ce ? hi : 0; this.vp = ce ? vp : 0; this.sp = se ? sp : 0;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.ph = 0; this.ql = 1; this.pS = -1; this.pT = -1; this.pN = 0; this.pR = 1; this.hi = 0; this.vp = 0; this.sp = 0; this.dv = 0; this.rs = seedOf(this.salt, this.n); }
      setSalt(s) { this.salt = (s | 0) >>> 0; this.rs = seedOf(this.salt, this.n); }
    }

    /* ------------------------------------------------------------ 921A: oscillator driver */
    // V_drv = ΣV + FREQUENCY (1 V/oct outwardly: RM §8's "0.5× gain" is the inside) and the width offset (knob − 50 %) + 0.1 / V
    // over the rear link (its outs 0, 1) to its 921Bs; nothing else
    class M921A {
      constructor(h) { base(this, h, '921a'); this.kv = this.pwk = 0.25; this.kv = 0; this.pwk = 0; this.coef(); }
      coef() { const p = this.p, fq = cl(p[1], -6, 6); this.kv = cl(p[0], 0, 1) >= 0.5 ? fq : fq / 6; this.pwk = (cl(p[2], 10, 90) - 50) / 100; }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, f1 = I[0], f2 = I[1], f3 = I[2], w1 = I[3], w2 = I[4], dv = this.outs[0], dw = this.outs[1], kv = this.kv, pwk = this.pwk;
        for (let i = i0, e = i0 + n; i < e; i++) { dv[i] = f1[i] + f2[i] + f3[i] + kv; dw[i] = pwk + 0.1 * (w1[i] + w2[i]); }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.coef(); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 921B: oscillator */
    // its own exponential converter: f = C4 · 2^(V_drv + range + FREQUENCY / 6) · max(0, 1 + (V_dc + V_ac) / 5) (linear FM, no
    // through-zero: a relaxation core; AC MODULATE through a one-pole 10 Hz high-pass); the width from its driver (50 %
    // undriven); SYNC: at the sync input's rising zero crossing (its sub-sample time) the phase resets to 0 only when it lies
    // within a window about the wrap — [1 − wP, 1) ∪ [0, wM]: a slave at h·f·(1 + ε) locks to h·f for −wP/h ≤ ε ≤ wM/h; STRONG
    // wP = 1 − 2^(−6/12), wM = 2^(6/12) − 1 (±6 semitones at harmonic 1, locking about 1…6), WEAK a quarter of each
    const WP_S = 1 - Math.pow(2, -0.5), WM_S = Math.SQRT2 - 1;
    class M921B {
      constructor(h) {
        base(this, h, '921b');
        this.ph = this.pS = this.pT = this.pN = this.pR = this.hp = this.ap = this.yp = this.kc = this.kv = this.wP = this.wM = this.ahp = this.dr = this.dv = this.rs = this.dk = 0.25;
        this.o = new Osc(); this.ph = 0; this.ql = 1; this.pS = -1; this.pT = -1; this.pN = 0; this.pR = 1; this.oml = -1;
        this.hp = 0; this.ap = 0; this.yp = 0;
        this.kc = 0; this.kv = 0; this.ss = 1; this.wP = 0; this.wM = 0; this.ahp = 1; this.dr = 0; this.dv = 0; this.rs = 1; this.dk = 0;
        this.setSalt(this.salt); this.rate(); this.coef();
      }
      rate() { this.kc = C4 / this.fs; this.ahp = 1 / (1 + TAU * 10 / this.fs); this.dk = 1 - Math.exp(-(4 * this.os / this.fs) / 2); }
      coef() {
        const p = this.p, rg = cl(p[0], 0, 5) | 0;
        this.kv = (rg === 0 ? -6 : rg - 3) + cl(p[1], -6, 6) / 6; this.ss = cl(p[2], 0, 2) | 0;
        const q = this.ss === 2 ? 1 : this.ss === 0 ? 0.25 : 0;
        this.wP = WP_S * q; this.wM = WM_S * q;
      }
      flush() { if (this.hp < TINY && this.hp > -TINY) this.hp = 0; }
      ctl(cc) {
        if (this.mv !== 0) this.coef();
        drift(this);
        if (this.om !== this.oml) { this.oml = this.om; const p = this.ph; this.pS = 2 * p - 1; this.pT = triU(p); this.pN = psin(p); this.pR = this.ql; }
      }
      run(sec, i0, n) {
        const I = this.i_, dc = I[0], ac = I[1], sy = I[2], dv = I[3], dw = I[4], Zb = this.zb;
        const U = this.outs, oN = U[0], oT = U[1], oS = U[2], oR = U[3];
        const om = this.om, mN = (om & 1) !== 0, mT = (om & 2) !== 0, mS = (om & 4) !== 0, mR = (om & 8) !== 0, O = this.o;
        const kc = this.kc, kv = this.kv + this.dv, ahp = this.ahp, wP = 1 - this.wP, wM = this.wM;
        // unpatched inputs skip their work: the converter, the linear FM (the AC coupler while it still holds a charge),
        // the width, the sync detector (as if the zeros were read)
        const vp = dv !== Zb, l1 = dc !== Zb, l2 = ac !== Zb, l3 = this.hp !== 0, l4 = this.ap !== 0, lp = l1 || l2 || l3 || l4, wp = dw !== Zb, yo = sy !== Zb, sync = this.ss !== 1;
        const e0 = kc * ex2(kv);
        let dt = e0 > 0.45 ? 0.45 : e0, w = 0.5;
        let ph = this.ph, ql = this.ql, pS = this.pS, pT = this.pT, pN = this.pN, pR = this.pR, hp = this.hp, ap = this.ap, yp = this.yp;
        for (let i = i0, e = i0 + n; i < e; i++) {
          if (vp || lp) {
            let lin = 1;
            if (lp) { const a = ac[i]; hp = ahp * (hp + a - ap); ap = a; lin = 1 + 0.2 * (dc[i] + hp); if (!(lin > 0)) lin = 0; }
            dt = (vp ? kc * ex2(dv[i] + kv) : e0) * lin; if (dt > 0.45) dt = 0.45;
          }
          if (wp) { w = 0.5 + dw[i]; w = w >= 0.05 ? w <= 0.95 ? w : 0.95 : 0.05; }
          let ru = -1;
          if (yo) { const y = sy[i]; if (sync && yp < 0 && y >= 0) { const u = yp / (yp - y); let pa = ph + u * dt; if (pa >= 1) pa -= 1; if (pa >= wP || pa <= wM) ru = u; } yp = y; }
          let p = ph + dt, cS = 0, cT = 0, cN = 0, cR = 0;
          if (ru >= 0 || p >= 1 || (ph < 0.5 && p >= 0.5) || (p < w) !== (ql > 0)) {
            p = O.ev(ph, dt, w, ru, 0, ql); ql = O.q;
            pS += O.s0; pT += O.t0; pN += O.n0; pR += O.r0; cS = O.s1; cT = O.t1; cN = O.n1; cR = O.r1;
          }
          ph = p;
          if (mN) { oN[i] = AN * pN; pN = psin(p) + cN; }
          if (mT) { oT[i] = AT * pT; pT = (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) + cT; }
          if (mS) { oS[i] = AS * pS; pS = 2 * p - 1 + cS; }
          if (mR) { oR[i] = AR * pR; pR = ql + cR; }
        }
        this.ph = ph; this.ql = ql; this.pS = pS; this.pT = pT; this.pN = pN; this.pR = pR; this.hp = hp; this.ap = ap; this.yp = yo ? yp : 0;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.ph = 0; this.ql = 1; this.pS = -1; this.pT = -1; this.pN = 0; this.pR = 1; this.hp = 0; this.ap = 0; this.yp = 0; this.dv = 0; this.rs = seedOf(this.salt, this.n); }
      setSalt(s) { this.salt = (s | 0) >>> 0; this.rs = seedOf(this.salt, this.n); }
    }

    /* ------------------------------------------------------------ 923: noise + two RC filters */
    // 0 NOISE: xorshift white at the engine's density (0.5 V RMS over the band at 48 k × 4, √(fs / 192 k) of it at other
    // rates: the in-band density constant), Kellett's economy pink from the same white with its poles at fixed corners (the
    // spectrum never moves with the rate), 0.5 V RMS over 20 Hz … 20 kHz; 1 LP / 2 HP: one-pole RC (trapezoidal, prewarped),
    // 10 Hz … 10 kHz on an exponential knob (LAW.rc923)
    const PINK_F = [16.51, 264.6, 3945], PINK_P = [0.99765, 0.963, 0.57], PINK_B = [0.0990460, 0.2965164, 1.0526913], PINK_D = 0.1848;
    const PINK_K = 0.8102;                          // pink 0.5 V RMS in 20 Hz … 20 kHz at 48 k × 4 (measured, tests/moog-dsp)
    class M923 {
      constructor(h) {
        base(this, h, '923');
        this.outs[1] = this.outs[0];                  // WHITE 1 / 2: one source
        this.r = this.k0 = this.k1 = this.k2 = this.l = this.h = this.W = this.q0 = this.q1 = this.q2 = this.b0 = this.b1 = this.b2 = this.gl = this.gh = 0.25;
        this.r = 1; this.k0 = 0; this.k1 = 0; this.k2 = 0; this.l = 0; this.h = 0;
        this.W = 0; this.q0 = 0; this.q1 = 0; this.q2 = 0; this.b0 = 0; this.b1 = 0; this.b2 = 0; this.gl = 0; this.gh = 0;
        this.setSalt(this.salt); this.rate(); this.coef();
      }
      rate() {
        const fs = this.fs;
        this.W = 0.5 * Math.sqrt(3) * Math.sqrt(fs / 192000);
        this.q0 = Math.exp(-TAU * PINK_F[0] / fs); this.q1 = Math.exp(-TAU * PINK_F[1] / fs); this.q2 = Math.exp(-TAU * PINK_F[2] / fs);
        this.b0 = PINK_B[0] * (1 - this.q0) / (1 - PINK_P[0]); this.b1 = PINK_B[1] * (1 - this.q1) / (1 - PINK_P[1]); this.b2 = PINK_B[2] * (1 - this.q2) / (1 - PINK_P[2]);
      }
      coef() {
        const p = this.p, lim = 0.45 * this.fs;
        const fl = Math.min(lim, 10 * Math.pow(1000, cl(p[0], 0, 10) / 10)), fh = Math.min(lim, 10 * Math.pow(1000, cl(p[1], 0, 10) / 10));
        const gl = Math.tan(Math.PI * fl / this.fs), gh = Math.tan(Math.PI * fh / this.fs);
        this.gl = gl / (1 + gl); this.gh = gh / (1 + gh);
      }
      flush() {
        if (this.l < TINY && this.l > -TINY) this.l = 0; if (this.h < TINY && this.h > -TINY) this.h = 0;
        if (this.k0 < TINY && this.k0 > -TINY) this.k0 = 0; if (this.k1 < TINY && this.k1 > -TINY) this.k1 = 0; if (this.k2 < TINY && this.k2 > -TINY) this.k2 = 0;
      }
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const e = i0 + n;
        if (sec === 0) {
          const om = this.om, wo = this.outs[0], po = this.outs[2], mW = (om & 3) !== 0, mP = (om & 4) !== 0, W = this.W;
          const q0 = this.q0, q1 = this.q1, q2 = this.q2, b0 = this.b0, b1 = this.b1, b2 = this.b2;
          let r = this.r, k0 = this.k0, k1 = this.k1, k2 = this.k2;
          for (let i = i0; i < e; i++) {
            r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0;
            const x = W * (r / 2147483648 - 1);
            if (mW) wo[i] = x;
            if (mP) { k0 = q0 * k0 + b0 * x; k1 = q1 * k1 + b1 * x; k2 = q2 * k2 + b2 * x; po[i] = PINK_K * (k0 + k1 + k2 + PINK_D * x); }
          }
          this.r = r; this.k0 = k0; this.k1 = k1; this.k2 = k2;
        } else if (sec === 1) {
          const x = this.i_[0], o = this.outs[3], G = this.gl;
          let s = this.l;
          for (let i = i0; i < e; i++) { const v = (x[i] - s) * G, y = v + s; s = y + v; o[i] = rail(y); }
          this.l = s;
        } else {
          const x = this.i_[1], o = this.outs[4], G = this.gh;
          let s = this.h;
          for (let i = i0; i < e; i++) { const xi = x[i], v = (xi - s) * G, y = v + s; s = y + v; o[i] = rail(xi - y); }
          this.h = s;
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.k0 = 0; this.k1 = 0; this.k2 = 0; this.l = 0; this.h = 0; this.r = seedOf(this.salt, this.n); }
      setSalt(s) { this.salt = (s | 0) >>> 0; this.r = seedOf(this.salt, this.n); }
    }

    /* ------------------------------------------------------------ 904A: the transistor ladder */
    // engine.js Ladder's method re-written in this scope (§3.7: the old one untouched) — four stages dy_i = g(tanh y_{i−1} −
    // tanh y_i), zero-delay feedback by the secant linearisation at a prediction of this sample (2s − y), a second pass at the
    // first solution blended in over k 2…3 where g > 0.09 (f_c > fs/35) or above fs/4 — with g per sample from f_c = 2^(FIXED +
    // 6 + 2·range + ΣV) Hz (1 / 4 / 16 Hz at −6 V: 12 octaves a range; ≤ 0.46·fs), k = 0.44 · REGENERATION (k 4 at 9.1: it
    // whistles above), no input make-up (the passband falls as 1 / (1 + k)); the stages see the input × KI (a 1.73 Vpp saw drives
    // them lightly), the output × KO = 1 / KI (unity passband at k 0). Above k 4 the whistle's pitch is held on f_c (the
    // compression pulls it flat: KW, fitted, tests/moog-dsp).
    const KI = 0.25, KO = 4;
    // octaves added to f_c above k 4 (= engine.js oscOff's fit: −35.5 ct at k 4.4, measured); the arithmetic always runs (0 below 4: the
    // same bits) — a branch never taken in the warm-up has no type feedback, and deopts the compiled coef the first time k passes 4
    const KW = (k) => { const x = k - 4, d = x > 0 ? x : 0; return 0.09083 * d / (1 + 0.6 * d); };
    class M904A {
      constructor(h) {
        base(this, h, '904a');
        this.s0 = this.s1 = this.s2 = this.s3 = this.y0 = this.y1 = this.y2 = this.y3 = this.kx = this.k = this.pif = 0.25;
        this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0;
        this.kx = 6; this.k = 0; this.pif = 0; this.xm = 0.46 * Math.PI;
        this.rate(); this.coef();
      }
      rate() { this.pif = Math.PI / this.fs; }
      coef() { const p = this.p, k = 0.44 * cl(p[2], 0, 10); this.k = k; this.kx = cl(p[0], -6, 6) + 6 + 2 * (cl(p[1], 0, 2) | 0) + KW(k); }
      flush() {
        if (this.s0 < TINY && this.s0 > -TINY) this.s0 = 0; if (this.s1 < TINY && this.s1 > -TINY) this.s1 = 0;
        if (this.s2 < TINY && this.s2 > -TINY) this.s2 = 0; if (this.s3 < TINY && this.s3 > -TINY) this.s3 = 0;
        if (this.y0 < TINY && this.y0 > -TINY) this.y0 = 0; if (this.y1 < TINY && this.y1 > -TINY) this.y1 = 0;
        if (this.y2 < TINY && this.y2 > -TINY) this.y2 = 0; if (this.y3 < TINY && this.y3 > -TINY) this.y3 = 0;
      }
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, xi = I[0], c1 = I[1], c2 = I[2], c3 = I[3], out = this.outs[0], Zb = this.zb;
        const kx = this.kx, K = this.k, pif = this.pif, xm = this.xm, two = K > 2;
        const q1 = c1 !== Zb, q2 = c2 !== Zb, q3 = c3 !== Zb, cv = q1 || q2 || q3;   // unpatched inputs add nothing (+ 0)
        let x = pif * ex2(kx); if (x > xm) x = xm;
        let g = tanp(x);
        let s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3, Y0 = this.y0, Y1 = this.y1, Y2 = this.y2, Y3 = this.y3;
        for (let i = i0, e = i0 + n; i < e; i++) {
          if (cv) { let v = kx; if (q1) v += c1[i]; if (q2) v += c2[i]; if (q3) v += c3[i]; x = pif * ex2(v); if (x > xm) x = xm; g = tanp(x); }
          const xin = KI * xi[i];
          let e0 = 2 * s0 - Y0, e1 = 2 * s1 - Y1, e2 = 2 * s2 - Y2, e3 = 2 * s3 - Y3, y0 = 0, y1 = 0, y2 = 0, y3 = 0;
          const w = g > 1 ? 1 : g > 0.09 && two ? (K < 3 ? K - 2 : 1) : 0;
          for (let it = 0; it < 2; it++) {
            if (it === 1) { if (w === 0) break; e0 = y0; e1 = y1; e2 = y2; e3 = y3; }
            const t0 = tr(e0), t1 = tr(e1), t2 = tr(e2), t3 = tr(e3), tx = tr(xin - K * e3);
            const d0 = 1 / (1 + g * t0), d1 = 1 / (1 + g * t1), d2 = 1 / (1 + g * t2), d3 = 1 / (1 + g * t3);
            const G0 = g * tx * d0, G1 = g * t0 * d1, G2 = g * t1 * d2, G3 = g * t2 * d3;
            const S0 = s0 * d0, S1 = s1 * d1, S2 = s2 * d2, S3 = s3 * d3;
            const Gt = G0 * G1 * G2 * G3, St = ((S0 * G1 + S1) * G2 + S2) * G3 + S3;
            y3 = (Gt * xin + St) / (1 + K * Gt);
            const u = xin - K * y3;
            if (it === 1 && w < 1) {
              const v0 = G0 * u + S0, v1 = G1 * v0 + S1, v2 = G2 * v1 + S2;
              y0 = e0 + w * (v0 - e0); y1 = e1 + w * (v1 - e1); y2 = e2 + w * (v2 - e2); y3 = e3 + w * (y3 - e3);
            } else { y0 = G0 * u + S0; y1 = G1 * y0 + S1; y2 = G2 * y1 + S2; }
          }
          Y0 = y0; Y1 = y1; Y2 = y2; Y3 = y3;
          s0 = 2 * y0 - s0; s1 = 2 * y1 - s1; s2 = 2 * y2 - s2; s3 = 2 * y3 - s3;
          out[i] = rail(KO * y3);
        }
        this.s0 = s0; this.s1 = s1; this.s2 = s2; this.s3 = s3; this.y0 = Y0; this.y1 = Y1; this.y2 = Y2; this.y3 = Y3;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 907A: fixed filter bank */
    // ten parallel sections summed with the pots' gains (audio taper: (v / 10)³, 0 = off): a low-pass "shelf" at 177 Hz and a
    // high-pass at 4 kHz (two 2nd-order sections each, Q 0.85: 24 dB/oct), eight band-passes at 250 · √2^k Hz (four cascaded
    // 2nd-order band-pass sections each, Q 1.9, unity peak: 24 dB/oct skirts, × 1.3) — all at 10 the sum is flat within
    // ±1.6 dB from 20 Hz to 20 kHz at unity (the analog prototype; one polarity: alternating ones notch). TPT sections
    // prewarped at their centres, fused per band (its sections share coefficients, their states in registers; spike (a)
    // decision 2), at the OS rate.
    const FB = [250 / Math.SQRT2, 250, 250 * Math.SQRT2, 500, 500 * Math.SQRT2, 1000, 1000 * Math.SQRT2, 2000, 2000 * Math.SQRT2, 4000];
    const Q_BP = 1.9, Q_SH = 0.85, G_BP = 1.3, G_SH = 1;
    class M907A {
      constructor(h) {
        base(this, h, '907a');
        this.s1 = new Float64Array(36); this.s2 = new Float64Array(36);
        this.a1 = new Float64Array(10); this.a2 = new Float64Array(10); this.a3 = new Float64Array(10); this.kq = new Float64Array(10);
        this.gb = new Float64Array(10);
        this.rate(); this.coef();
      }
      rate() {
        for (let b = 0; b < 10; b++) {
          const sh = b === 0 || b === 9, g = Math.tan(Math.PI * Math.min(FB[b], 0.45 * this.fs) / this.fs), k = 1 / (sh ? Q_SH : Q_BP), a1 = 1 / (1 + g * (g + k));
          this.a1[b] = a1; this.a2[b] = g * a1; this.a3[b] = g * g * a1; this.kq[b] = k;
        }
      }
      coef() {
        const p = this.p;
        for (let b = 0; b < 10; b++) {
          const v = cl(p[b], 0, 10) / 10, k = this.kq[b];
          this.gb[b] = v * v * v * (b === 0 || b === 9 ? G_SH : G_BP * k * k * k * k);
        }
      }
      flush() { const A = this.s1, B = this.s2; for (let s = 0; s < 36; s++) { if (A[s] < TINY && A[s] > -TINY) A[s] = 0; if (B[s] < TINY && B[s] > -TINY) B[s] = 0; } }
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const x = this.i_[0], y = this.outs[0], S1 = this.s1, S2 = this.s2, A1 = this.a1, A2 = this.a2, A3 = this.a3, KQ = this.kq, gb = this.gb;
        const e = i0 + n;
        { // the low shelf (sections 0, 1): writes y
          const a1 = A1[0], a2 = A2[0], a3 = A3[0], g = gb[0];
          let p1 = S1[0], p2 = S2[0], q1 = S1[1], q2 = S2[1];
          for (let i = i0; i < e; i++) {
            let v3 = x[i] - p2, v1 = a1 * p1 + a2 * v3, v2 = p2 + a2 * p1 + a3 * v3; p1 = 2 * v1 - p1; p2 = 2 * v2 - p2;
            v3 = v2 - q2; v1 = a1 * q1 + a2 * v3; v2 = q2 + a2 * q1 + a3 * v3; q1 = 2 * v1 - q1; q2 = 2 * v2 - q2;
            y[i] = g * v2;
          }
          S1[0] = p1; S2[0] = p2; S1[1] = q1; S2[1] = q2;
        }
        for (let b = 1; b < 9; b++) { // the band-passes (sections 2 … 33, four a band): add
          const s = 4 * b - 2, a1 = A1[b], a2 = A2[b], a3 = A3[b], g = gb[b];
          let p1 = S1[s], p2 = S2[s], q1 = S1[s + 1], q2 = S2[s + 1], r1 = S1[s + 2], r2 = S2[s + 2], u1 = S1[s + 3], u2 = S2[s + 3];
          for (let i = i0; i < e; i++) {
            let v3 = x[i] - p2, v1 = a1 * p1 + a2 * v3, v2 = p2 + a2 * p1 + a3 * v3; p1 = 2 * v1 - p1; p2 = 2 * v2 - p2;
            let z = v1;
            v3 = z - q2; v1 = a1 * q1 + a2 * v3; v2 = q2 + a2 * q1 + a3 * v3; q1 = 2 * v1 - q1; q2 = 2 * v2 - q2; z = v1;
            v3 = z - r2; v1 = a1 * r1 + a2 * v3; v2 = r2 + a2 * r1 + a3 * v3; r1 = 2 * v1 - r1; r2 = 2 * v2 - r2; z = v1;
            v3 = z - u2; v1 = a1 * u1 + a2 * v3; v2 = u2 + a2 * u1 + a3 * v3; u1 = 2 * v1 - u1; u2 = 2 * v2 - u2;
            y[i] += g * v1;
          }
          S1[s] = p1; S2[s] = p2; S1[s + 1] = q1; S2[s + 1] = q2; S1[s + 2] = r1; S2[s + 2] = r2; S1[s + 3] = u1; S2[s + 3] = u2;
        }
        { // the high shelf (sections 34, 35): add, then the rails
          const a1 = A1[9], a2 = A2[9], a3 = A3[9], k = KQ[9], g = gb[9];
          let p1 = S1[34], p2 = S2[34], q1 = S1[35], q2 = S2[35];
          for (let i = i0; i < e; i++) {
            const x0 = x[i];
            let v3 = x0 - p2, v1 = a1 * p1 + a2 * v3, v2 = p2 + a2 * p1 + a3 * v3; p1 = 2 * v1 - p1; p2 = 2 * v2 - p2;
            const hh = x0 - k * v1 - v2;
            v3 = hh - q2; v1 = a1 * q1 + a2 * v3; v2 = q2 + a2 * q1 + a3 * v3; q1 = 2 * v1 - q1; q2 = 2 * v2 - q2;
            y[i] = rail(y[i] + g * (hh - k * v1 - v2));
          }
          S1[34] = p1; S2[34] = p2; S1[35] = q1; S2[35] = q2;
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.s1.fill(0); this.s2.fill(0); }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 911: envelope generator */
    // a closure (an S line's 0 → 1, per sample) → T1 from the current level: an RC toward 1.3 · Emax that stops at Emax, T1 the
    // time from 0 V (the log charge curve) → T2: an RC toward E SUS (T2 = 4 τ) while closed; an opening → T3: an RC to 0 V
    // from wherever (T3 = 4 τ); a closure during T3 starts T1 from there. Times 2 ms … 10 s (LAW.t911), E SUS 0.55 V a step.
    const OV911 = 1.3, LN_OV = Math.log(OV911 / (OV911 - 1));
    class M911 {
      constructor(h) {
        base(this, h, '911');
        this.v = this.c1 = this.c2 = this.c3 = this.sus = 0.25;
        this.v = 0; this.st = 0; this.sp = 0; this.c1 = 0; this.c2 = 0; this.c3 = 0; this.sus = 0;
        this.coef();
      }
      coef() {
        const p = this.p, fs = this.fs;
        this.c1 = 1 - Math.exp(-LN_OV / (0.002 * Math.pow(5000, cl(p[0], 0, 10) / 10) * fs));
        this.c2 = 1 - Math.exp(-4 / (0.002 * Math.pow(5000, cl(p[1], 0, 10) / 10) * fs));
        this.c3 = 1 - Math.exp(-4 / (0.002 * Math.pow(5000, cl(p[2], 0, 10) / 10) * fs));
        this.sus = 0.55 * cl(p[3], 0, 10);
      }
      flush() { if (this.v < TINY) this.v = 0; }
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const tg = this.i_[0], out = this.outs[0], c1 = this.c1, c2 = this.c2, c3 = this.c3, sus = this.sus, top = OV911 * EMAX;
        let v = this.v, st = this.st, sp = this.sp;
        for (let i = i0, e = i0 + n; i < e; i++) {
          const s = tg[i] > 0.5 ? 1 : 0;
          if (s !== sp) { st = s !== 0 ? 1 : 3; sp = s; }
          if (st === 1) { v += (top - v) * c1; if (v >= EMAX) { v = EMAX; st = 2; } }
          else if (st === 2) v += (sus - v) * c2;
          else if (st === 3) v -= v * c3;
          out[i] = v;
        }
        this.v = v; this.st = st; this.sp = sp;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.coef(); }
      reset() { this.v = 0; this.st = 0; this.sp = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 902: amplifier */
    // V = FIXED + ΣV (per sample: audio-rate AM); LIN g = V / 3 on 0 … 7.5 V (×2 at 6 V, ×2.5 at the top: RM §8's "gain of 3"
    // read as ∝ V clamped), EXP g = 2 · 4^(min(V, 6) − 6) (−12 dB / V below 6 V; 0 below −2 V: −90 dB); differential: x = upper
    // in − lower in; the lower output g·x, the upper −g·x (inverted)
    const T3 = 1 / 3;
    class M902 {
      constructor(h) { base(this, h, '902'); this.kf = 0.25; this.kf = 0; this.md = 0; this.coef(); }
      coef() { this.md = cl(this.p[0], 0, 1) | 0; this.kf = cl(this.p[1], -6, 6); }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, i1 = I[0], i2 = I[1], c1 = I[2], c2 = I[3], c3 = I[4], o1 = this.outs[0], o2 = this.outs[1], Zb = this.zb;
        const kf = this.kf, om = this.om, m1 = (om & 1) !== 0, m2 = (om & 2) !== 0;
        const p2 = i2 !== Zb, q2 = c2 !== Zb, q3 = c3 !== Zb;      // unpatched inputs add nothing (bit-identical: + 0)
        if (this.md === 1) {
          let Vl = NaN, g = 0;                       // (a held control voltage converts once)
          for (let i = i0, e = i0 + n; i < e; i++) {
            let V = kf + c1[i]; if (q2) V += c2[i]; if (q3) V += c3[i];
            if (V !== Vl) { Vl = V; g = V >= -2 ? 2 * ex2(2 * ((V < 6 ? V : 6) - 6)) : 0; }
            const y = g * (i1[i] - (p2 ? i2[i] : 0));   // (i1 − 0 = i1 bit for bit; the subtraction runs unpatched too: its feedback exists)
            if (m2) o2[i] = rail(y); if (m1) o1[i] = rail(-y);
          }
        } else {
          for (let i = i0, e = i0 + n; i < e; i++) {
            let V = kf + c1[i]; if (q2) V += c2[i]; if (q3) V += c3[i];
            const g = V > 0 ? (V < 7.5 ? V : 7.5) * T3 : 0, y = g * (i1[i] - (p2 ? i2[i] : 0));
            if (m2) o2[i] = rail(y); if (m1) o1[i] = rail(-y);
          }
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 995: attenuators */
    // three passive linear pots (0 = zero, clockwise = unity), one section each; 2 and 3 normalled to the input above (the
    // evaluator's normals: an unpatched i2 reads i1's source, i3 i2's)
    class M995 {
      constructor(h) { base(this, h, '995'); this.a = new Float64Array(3); this.coef(); }
      coef() { const p = this.p; this.a[0] = cl(p[0], 0, 10) / 10; this.a[1] = cl(p[1], 0, 10) / 10; this.a[2] = cl(p[2], 0, 10) / 10; }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const x = this.i_[sec], o = this.outs[sec], a = this.a[sec];
        for (let i = i0, e = i0 + n; i < e; i++) o[i] = x[i] * a;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ the controller (ours, §2.4, §3.5) */
    // 0 KBD: a held-key table (128 flags + order stamps); PRIORITY LOW (the lowest held key) or LAST (the most recent; a release
    // falls back to the previous held); PITCH = (key − 60) / 12 V slewed by GLIDE (an exponential slew, its time constant
    // LAW.glide: 5 ms … 5 s, off at 0 … 0.05; the first key after a reset snaps) + bend / 12 + TUNE / 1200 (unslewed); S-TRIG
    // closed while a key is held (the sustain pedal holds a closed line), MULTIPLE opens it for one chunk at a note-on while it
    // was closed; GATE 5 V likewise; VELOCITY 5 · v latched at each note-on; WHEEL 5 · wheel, PRESSURE 5 · at (per chunk)
    // 1 MIX: Σ m_k · LEVEL_k / 5 → MIX + (railed), MIX − its inverse · 4 V→S: a rise through +1.5 V closes, below +1.0 V opens
    // · 5 S→V: 4 V while closed — MULT A / B (2, 3) and OUT (6) are the evaluator's (og = OUT_K · OUTPUT / 10)
    class Ctl {
      constructor(h) {
        base(this, h, 'ctl');
        const U = this.outs; U[1] = U[0]; U[3] = U[2];     // PITCH 1 / 2, S-TRIG 1 / 2: one source each
        this.tgt = this.pv = this.vel = this.pb = this.vw = this.va = this.vv = this.gk = this.tu = 0.25;
        this.held = new Uint8Array(128); this.stamp = new Float64Array(128); this.nst = 0; this.nh = 0; this.nd = 0; this.non = 0;
        this.tgt = 0; this.pv = 0; this.first = 1; this.vel = 0; this.s = 0; this.gon = 0; this.rtg = 0;
        this.pb = 0; this.vw = 0; this.va = 0; this.vv = 0;
        this.gk = 1; this.lv = new Float64Array(4); this.og = OUT_K * 0.7; this.vsh = 0; this.pr = 0; this.rt = 0; this.tu = 0;
        this.coef();
      }
      coef() {
        const p = this.p, gl = cl(p[0], 0, 10), tau = gl > 0.05 ? 0.005 * Math.pow(1000, gl / 10) : 0;
        this.gk = tau > 0 ? 1 - Math.exp(-1 / (tau * this.fs)) : 1;
        this.pr = cl(p[1], 0, 1) | 0; this.rt = cl(p[2], 0, 1) | 0; this.tu = cl(p[3], -50, 50);
        for (let k = 0; k < 4; k++) this.lv[k] = cl(p[4 + k], 0, 10) / 5;
        this.og = OUT_K * cl(p[8], 0, 10) / 10;
      }
      note(n, v, on) {
        n = n | 0; if (n < 0 || n > 127) return;
        if (on) { if (this.held[n] === 0) { this.held[n] = 1; this.nh++; } this.stamp[n] = ++this.nst; this.vel = v > 0 ? v < 1 ? v : 1 : 0; this.non = 1; }
        else if (this.held[n] !== 0) { this.held[n] = 0; this.nh--; }
        this.nd = 1;
      }
      flush() { const d = this.pv - this.tgt; if (d < TINY && d > -TINY) this.pv = this.tgt; }
      ctl(cc) {
        if (this.mv !== 0) this.coef();
        this.rtg = 0;
        if (this.nd !== 0) {
          this.nd = 0;
          let k = -1;
          if (this.pr === 0) { for (let j = 0; j < 128; j++) if (this.held[j] !== 0) { k = j; break; } }
          else { let s = -1; for (let j = 0; j < 128; j++) if (this.held[j] !== 0 && this.stamp[j] > s) { s = this.stamp[j]; k = j; } }
          if (k >= 0) { this.tgt = (k - 60) / 12; if (this.first !== 0) { this.pv = this.tgt; this.first = 0; } }
          if (this.non !== 0) { this.vv = 5 * this.vel; if (this.gon !== 0 && this.rt === 1) this.rtg = 1; this.non = 0; }
        }
        const I = this.inst;
        let bend = 0, wheel = 0, at = 0, sus = 0;
        if (I !== null) { bend = +I.bend || 0; wheel = +I.wheel || 0; at = +I.at || 0; sus = I.sustain ? 1 : 0; }
        const g = this.nh > 0 || (sus !== 0 && this.gon !== 0) ? 1 : 0;
        this.gon = g; this.s = g !== 0 && this.rtg === 0 ? 1 : 0;
        this.pb = bend / 12 + this.tu / 1200; this.vw = 5 * wheel; this.va = 5 * at;
      }
      run(sec, i0, n) {
        const e = i0 + n, U = this.outs, I = this.i_;
        if (sec === 0) {
          const om = this.om, kp = U[0], ks = U[2], kg = U[4], kv = U[5], kw = U[6], ka = U[7];
          const s = this.s, tgt = this.tgt, gk = this.gk, pb = this.pb;
          let pv = this.pv;
          if ((om & 3) !== 0) for (let i = i0; i < e; i++) { pv += (tgt - pv) * gk; kp[i] = pv + pb; }
          else for (let i = i0; i < e; i++) pv += (tgt - pv) * gk;
          this.pv = pv;
          if ((om & 12) !== 0) for (let i = i0; i < e; i++) ks[i] = s;
          if ((om & 16) !== 0) { const v = 5 * s; for (let i = i0; i < e; i++) kg[i] = v; }
          if ((om & 32) !== 0) { const v = this.vv; for (let i = i0; i < e; i++) kv[i] = v; }
          if ((om & 64) !== 0) { const v = this.vw; for (let i = i0; i < e; i++) kw[i] = v; }
          if ((om & 128) !== 0) { const v = this.va; for (let i = i0; i < e; i++) ka[i] = v; }
        } else if (sec === 1) {
          const m1 = I[0], m2 = I[1], m3 = I[2], m4 = I[3], mo = U[8], mn = U[9], L = this.lv, l1 = L[0], l2 = L[1], l3 = L[2], l4 = L[3], Zb = this.zb;
          const om = this.om, a = (om & 256) !== 0, b = (om & 512) !== 0, q2 = m2 !== Zb, q3 = m3 !== Zb, q4 = m4 !== Zb;
          for (let i = i0; i < e; i++) {
            let x = l1 * m1[i]; if (q2) x += l2 * m2[i]; if (q3) x += l3 * m3[i]; if (q4) x += l4 * m4[i];
            if (a) mo[i] = rail(x); if (b) mn[i] = rail(-x);
          }
        } else if (sec === 4) {
          const x = I[4], o = U[10];
          let hi = this.vsh;
          for (let i = i0; i < e; i++) { const v = x[i]; if (hi === 0) { if (v > 1.5) hi = 1; } else if (v < 1) hi = 0; o[i] = hi; }
          this.vsh = hi;
        } else if (sec === 5) {
          const x = I[5], o = U[11];
          for (let i = i0; i < e; i++) o[i] = x[i] > 0.5 ? 4 : 0;
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.coef(); }
      reset() {
        this.held.fill(0); this.stamp.fill(0); this.nst = 0; this.nh = 0; this.nd = 0; this.non = 0;
        this.tgt = 0; this.pv = 0; this.first = 1; this.vel = 0; this.vv = 0; this.s = 0; this.gon = 0; this.rtg = 0; this.vsh = 0;
      }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ============================================================ stage 9b (IMPL-9b §3.3 / §3.4, lane V9c): the System 35 / 55
     * types — every class written out (the megamorphic lesson), every numeric field a double from its constructor where it can
     * ever hold one, no allocation outside the constructors. A class with events adds ev(k) (its own 8-slot ring, applied at its
     * next ctl, cleared by reset), one with lamps an int `lamp` (bit i = lamp i lit, PatchMoog.LAMPS's order). The 960 / 961 /
     * 962 build their patched-input lists once a chunk in ctl (spike (a2) decision 4); a "patched" test reads the evaluator's
     * zero buffer (zb: learned from a whole `ins` of ≥ 2 slots — every class here that tests has ≥ 2). */

    /* ------------------------------------------------------------ 904B: high-pass filter */
    // the 904A's control law without its feedback: f_c (the per-stage corner, −12 dB) = 2^(FIXED + 8 + 1.5·RANGE + ΣV) Hz — 4 Hz
    // (LOW) / 11.3 Hz (HIGH, 1½ oct up) at −6 V, 12 oct over the knob (16.4 / 46.3 kHz at +6 V); ≤ 0.46·fs. The complementary
    // ladder's stages are buffered [R PAT]: four independent one-pole TPT high-passes, g per sample (no k, no secant step);
    // the first stage's input through the ladder's soft compression (tr) [C]; input × KI, output × KO (unity passband), railed
    class M904B {
      constructor(h) {
        base(this, h, '904b');
        this.s0 = this.s1 = this.s2 = this.s3 = this.kx = this.pif = 0.25;
        this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.kx = 8; this.pif = 0; this.xm = 0.46 * Math.PI;
        this.rate(); this.coef();
      }
      rate() { this.pif = Math.PI / this.fs; }
      coef() { const p = this.p; this.kx = cl(p[0], -6, 6) + 8 + 1.5 * (cl(p[1], 0, 1) | 0); }
      flush() {
        if (this.s0 < TINY && this.s0 > -TINY) this.s0 = 0; if (this.s1 < TINY && this.s1 > -TINY) this.s1 = 0;
        if (this.s2 < TINY && this.s2 > -TINY) this.s2 = 0; if (this.s3 < TINY && this.s3 > -TINY) this.s3 = 0;
      }
      // (and a flush every chunk: with f_c near fs / 4 a stage's state falls × (1 − 2G) ≈ 0.03 a sample in silence — subnormal well
      // inside the evaluator's 32-chunk flush; in ctl, once a chunk, so a block step and a loop member's samples stay the same bits)
      ctl(cc) {
        if (this.mv !== 0) this.coef();
        if (this.s0 < TINY && this.s0 > -TINY) this.s0 = 0; if (this.s1 < TINY && this.s1 > -TINY) this.s1 = 0;
        if (this.s2 < TINY && this.s2 > -TINY) this.s2 = 0; if (this.s3 < TINY && this.s3 > -TINY) this.s3 = 0;
      }
      run(sec, i0, n) {
        const I = this.i_, xi = I[0], c1 = I[1], c2 = I[2], c3 = I[3], out = this.outs[0], Zb = this.zb, kx = this.kx, pif = this.pif, xm = this.xm;
        const q1 = c1 !== Zb, q2 = c2 !== Zb, q3 = c3 !== Zb, cv = q1 || q2 || q3;   // unpatched inputs add nothing (+ 0)
        let x = pif * ex2(kx); if (x > xm) x = xm;
        let g = tanp(x), G = g / (1 + g);
        let s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
        for (let i = i0, e = i0 + n; i < e; i++) {
          if (cv) { let v = kx; if (q1) v += c1[i]; if (q2) v += c2[i]; if (q3) v += c3[i]; x = pif * ex2(v); if (x > xm) x = xm; g = tanp(x); G = g / (1 + g); }
          const u = KI * xi[i], a = u * tr(u);
          let v = (a - s0) * G, l = v + s0; s0 = l + v; const h0 = a - l;
          v = (h0 - s1) * G; l = v + s1; s1 = l + v; const h1 = h0 - l;
          v = (h1 - s2) * G; l = v + s2; s2 = l + v; const h2 = h1 - l;
          v = (h2 - s3) * G; l = v + s3; s3 = l + v;
          out[i] = rail(KO * (h2 - l));
        }
        this.s0 = s0; this.s1 = s1; this.s2 = s2; this.s3 = s3;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 914: fixed filter bank */
    // twelve bands at 125 · √2^k Hz (125 … 5 657), each two stagger-tuned 2nd-order band-passes in cascade at f · 2^(∓D914)
    // (Q914 each: 12 dB/oct skirts), normalised to G914 at the centre; a 2nd-order low-pass at 88.4 Hz and a high-pass at 8 kHz
    // (Q914S); polarities alternating along the bank, the shelves continuing it (LP −, band 1 +, band 2 −, …, band 12 −, HP +):
    // all at 10 the sum is flat ± 1.4 dB from 20 Hz to 20 kHz about unity (the analog prototype; one polarity notches between
    // the bands: two sections cascaded turn 140° at a crossover) — D914, Q914, Q914S, G914 fitted for it (IMPL-9b §3.3, the 907A's
    // method). Pots (v / 10)³ (0 = off); no CV. Its two inputs a passive pair: one patched as is, both averaged [C on R? CH-914].
    // TPT sections prewarped at their own centres, fused per band (state in registers) at the OS rate; OUTPUT 1 / 2 one buffer
    const F914 = Array.from({ length: 12 }, (_, b) => 125 * Math.pow(Math.SQRT2, b)), D914 = 0.2, Q914 = 2, Q914S = 0.6, G914 = 0.925;
    const FL914 = 125 / Math.SQRT2, FH914 = 8000;
    const PK914 = 1 / (1 + Q914 * Q914 * Math.pow(Math.pow(2, D914) - Math.pow(2, -D914), 2));   // a staggered pair's gain at its centre
    class M914 {
      constructor(h) {
        base(this, h, '914');
        this.outs[1] = this.outs[0];
        this.s1 = new Float64Array(26); this.s2 = new Float64Array(26); this.xs = new Float64Array(BL);
        this.a1 = new Float64Array(26); this.a2 = new Float64Array(26); this.a3 = new Float64Array(26); this.kq = new Float64Array(26);
        this.gb = new Float64Array(14);
        this.rate(); this.coef();
      }
      rate() { // sections 0 … 23: band s >> 1 below / above its centre; 24 the low-pass, 25 the high-pass
        for (let s = 0; s < 26; s++) {
          const f = s < 24 ? F914[s >> 1] * Math.pow(2, (s & 1) !== 0 ? D914 : -D914) : s === 24 ? FL914 : FH914, k = s < 24 ? 1 / Q914 : 1 / Q914S;
          const g = Math.tan(Math.PI * Math.min(f, 0.45 * this.fs) / this.fs), a1 = 1 / (1 + g * (g + k));
          this.a1[s] = a1; this.a2[s] = g * a1; this.a3[s] = g * g * a1; this.kq[s] = k;
        }
      }
      coef() { // gb: 0 the low-pass (−), 1 … 12 the bands (+ − + …: the band-pass v1 × k² / PK914 × G914), 13 the high-pass (+)
        const p = this.p, k = 1 / Q914, kb = G914 * k * k / PK914;
        for (let b = 0; b < 14; b++) { const v = cl(p[b], 0, 10) / 10, c = v * v * v; this.gb[b] = b === 0 ? -c : b === 13 ? c : (b & 1) !== 0 ? kb * c : -kb * c; }
      }
      flush() { const A = this.s1, B = this.s2; for (let s = 0; s < 26; s++) { if (A[s] < TINY && A[s] > -TINY) A[s] = 0; if (B[s] < TINY && B[s] > -TINY) B[s] = 0; } }
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, ia = I[0], ib = I[1], Zb = this.zb, y = this.outs[0], S1 = this.s1, S2 = this.s2, A1 = this.a1, A2 = this.a2, A3 = this.a3, KQ = this.kq, gb = this.gb;
        const e = i0 + n, pa = ia !== Zb, pb = ib !== Zb;
        let x = pb && !pa ? ib : ia;
        if (pa && pb) { const xs = this.xs; for (let i = i0; i < e; i++) xs[i] = 0.5 * (ia[i] + ib[i]); x = xs; }
        { // the low-pass (24): writes y
          const a1 = A1[24], a2 = A2[24], a3 = A3[24], g = gb[0];
          let p1 = S1[24], p2 = S2[24];
          for (let i = i0; i < e; i++) { const v3 = x[i] - p2, v1 = a1 * p1 + a2 * v3, v2 = p2 + a2 * p1 + a3 * v3; p1 = 2 * v1 - p1; p2 = 2 * v2 - p2; y[i] = g * v2; }
          S1[24] = p1; S2[24] = p2;
        }
        for (let b = 0; b < 12; b++) { // the bands (two band-passes in cascade): add
          const s = 2 * b, a1 = A1[s], a2 = A2[s], a3 = A3[s], c1 = A1[s + 1], c2 = A2[s + 1], c3 = A3[s + 1], g = gb[b + 1];
          let p1 = S1[s], p2 = S2[s], q1 = S1[s + 1], q2 = S2[s + 1];
          for (let i = i0; i < e; i++) {
            let v3 = x[i] - p2, v1 = a1 * p1 + a2 * v3, v2 = p2 + a2 * p1 + a3 * v3; p1 = 2 * v1 - p1; p2 = 2 * v2 - p2;
            v3 = v1 - q2; v1 = c1 * q1 + c2 * v3; v2 = q2 + c2 * q1 + c3 * v3; q1 = 2 * v1 - q1; q2 = 2 * v2 - q2;
            y[i] += g * v1;
          }
          S1[s] = p1; S2[s] = p2; S1[s + 1] = q1; S2[s + 1] = q2;
        }
        { // the high-pass (25): add, then the rails
          const a1 = A1[25], a2 = A2[25], a3 = A3[25], k = KQ[25], g = gb[13];
          let p1 = S1[25], p2 = S2[25];
          for (let i = i0; i < e; i++) {
            const x0 = x[i], v3 = x0 - p2, v1 = a1 * p1 + a2 * v3, v2 = p2 + a2 * p1 + a3 * v3; p1 = 2 * v1 - p1; p2 = 2 * v2 - p2;
            y[i] = rail(y[i] + g * (x0 - k * v1 - v2));
          }
          S1[25] = p1; S2[25] = p2;
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.s1.fill(0); this.s2.fill(0); }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 911A: dual trigger delay */
    // two delay timers on S lines (the 911's > 0.5 read), DELAY = 2 ms · 1000^(v / 10) (2 ms … 2 s; LAW t911a) in OS samples
    // per chunk: an output closes DELAY after its start closes and opens when its start opens (an opening before the delay
    // ends cancels it). MODE OFF: INPUT 1 → OUTPUT 1, INPUT 2 → OUTPUT 2; PARALLEL: INPUT 1 starts both; SERIES: OUTPUT 1's
    // closure starts delay 2 (the delays add); INPUT 2 ignored in PARALLEL / SERIES [R VK-55, MS-911A]
    class M911A {
      constructor(h) {
        base(this, h, '911a');
        this.c1 = this.c2 = this.D1 = this.D2 = 0.25; this.c1 = 0; this.c2 = 0; this.D1 = 1; this.D2 = 1; this.md = 0;
        this.coef();
      }
      coef() {
        const p = this.p, fs = this.fs;
        this.D1 = Math.max(1, Math.round(0.002 * Math.pow(1000, cl(p[0], 0, 10) / 10) * fs)); this.D2 = Math.max(1, Math.round(0.002 * Math.pow(1000, cl(p[1], 0, 10) / 10) * fs));
        this.md = cl(p[2], 0, 2) | 0;
      }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, a = I[0], b = I[1], U = this.outs, o1 = U[0], o2 = U[1], D1 = this.D1, D2 = this.D2, md = this.md, om = this.om, m1 = (om & 1) !== 0, m2 = (om & 2) !== 0;
        let c1 = this.c1, c2 = this.c2;
        for (let i = i0, e = i0 + n; i < e; i++) {   // c: samples since the start closed (0 open), held at D + 1
          const s1 = a[i] > 0.5 ? 1 : 0;
          c1 = s1 !== 0 ? (c1 > D1 ? c1 : c1 + 1) : 0;
          const y1 = c1 > D1 ? 1 : 0, s2 = md === 0 ? (b[i] > 0.5 ? 1 : 0) : md === 1 ? s1 : y1;
          c2 = s2 !== 0 ? (c2 > D2 ? c2 : c2 + 1) : 0;
          if (m1) o1[i] = y1; if (m2) o2[i] = c2 > D2 ? 1 : 0;
        }
        this.c1 = c1; this.c2 = c2;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.coef(); }
      reset() { this.c1 = 0; this.c2 = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 903A: random signal */
    // the 923's NOISE section re-written: xorshift white at the engine's density (0.5 V RMS at 48 k × 4), Kellett's pink from
    // it (0.5 V RMS in 20 Hz … 20 kHz), its own seed (salt, module number); WHITE 1 / 2 one buffer, PINK 1 / 2 one buffer; an
    // unread pink never computed
    class M903A {
      constructor(h) {
        base(this, h, '903a');
        this.outs[1] = this.outs[0]; this.outs[3] = this.outs[2];
        this.r = this.k0 = this.k1 = this.k2 = this.W = this.q0 = this.q1 = this.q2 = this.b0 = this.b1 = this.b2 = 0.25;
        this.r = 1; this.k0 = 0; this.k1 = 0; this.k2 = 0; this.W = 0; this.q0 = 0; this.q1 = 0; this.q2 = 0; this.b0 = 0; this.b1 = 0; this.b2 = 0;
        this.setSalt(this.salt); this.rate();
      }
      rate() {
        const fs = this.fs;
        this.W = 0.5 * Math.sqrt(3) * Math.sqrt(fs / 192000);
        this.q0 = Math.exp(-TAU * PINK_F[0] / fs); this.q1 = Math.exp(-TAU * PINK_F[1] / fs); this.q2 = Math.exp(-TAU * PINK_F[2] / fs);
        this.b0 = PINK_B[0] * (1 - this.q0) / (1 - PINK_P[0]); this.b1 = PINK_B[1] * (1 - this.q1) / (1 - PINK_P[1]); this.b2 = PINK_B[2] * (1 - this.q2) / (1 - PINK_P[2]);
      }
      flush() { if (this.k0 < TINY && this.k0 > -TINY) this.k0 = 0; if (this.k1 < TINY && this.k1 > -TINY) this.k1 = 0; if (this.k2 < TINY && this.k2 > -TINY) this.k2 = 0; }
      ctl(cc) {}
      run(sec, i0, n) {
        const om = this.om, wo = this.outs[0], po = this.outs[2], mW = (om & 3) !== 0, mP = (om & 12) !== 0, W = this.W;
        const q0 = this.q0, q1 = this.q1, q2 = this.q2, b0 = this.b0, b1 = this.b1, b2 = this.b2;
        let r = this.r, k0 = this.k0, k1 = this.k1, k2 = this.k2;
        for (let i = i0, e = i0 + n; i < e; i++) {
          r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0;
          const x = W * (r / 2147483648 - 1);
          if (mW) wo[i] = x;
          if (mP) { k0 = q0 * k0 + b0 * x; k1 = q1 * k1 + b1 * x; k2 = q2 * k2 + b2 * x; po[i] = PINK_K * (k0 + k1 + k2 + PINK_D * x); }
        }
        this.r = r; this.k0 = k0; this.k1 = k1; this.k2 = k2;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); }
      reset() { this.k0 = 0; this.k1 = 0; this.k2 = 0; this.r = seedOf(this.salt, this.n); }
      setSalt(s) { this.salt = (s | 0) >>> 0; this.r = seedOf(this.salt, this.n); }
    }

    /* ------------------------------------------------------------ 960: sequential controller (IMPL-9b §3.4) */
    // ins 0 OSC ON · 1 OSC OFF · 2 SHIFT · 3 CONTROL INPUT · 4 … 12 stage IN 1 … 9; outs 0 OUTPUT · 1 … 9 stage OUT 1 … 9 · 10 / 12
    // / 14 ROW A / B / C (11, 13, 15 their second jacks: one buffer each). Per sample, the patched inputs only: a rise through
    // +1.5 V (re-armed below +1.0 V) on OSC ON / OFF sets / clears the clock's flip-flop (OFF after ON in one sample); on SHIFT
    // or the clock's wrap → a shift; on IN k → stage k, applied after a shift of the same sample (a select wins). The clock: f =
    // 0.1 · 4^RANGE · 4^(VERNIER / 10) · 2^(CONTROL INPUT + (ROW C → CLOCK ? row C : 0)) Hz in 0.1 … 1 000 Hz, a phase per sample
    // while the flip-flop is set (held while it is clear); OUTPUT +3.6 V for 90 % of the period, the shift at its rise (a start
    // from OSC ON raises it without one: the first stage plays a whole period) [R VK-55, MS-960; C]. A shift: a STOP stage holds;
    // else the next stage passing SKIP ones; after stage 8 stage 9 when its switch is STOP (the flip-flop cleared: the clock
    // stops), else stage 1; all of 1 … 8 SKIP → stays; from stage 9 → stage 1 (the same walk). SET k / IN k reach k whatever its
    // mode. ROW X = dial / 10 · 2 · 2^range V of the active stage (stage 9: 0 V), a step at the sample; stage OUT k +3.6 V while
    // k is active. Events (OSC ON, OSC OFF, SHIFT, SET 1 … 9) wait in an 8-slot ring for the next ctl, applied there: the
    // flip-flop's in order, then the shifts, then the last SET. Fresh (reset): stage 1, the flip-flop = CLOCK AT START, the
    // phase 0. lamp: bit k = stage k + 1, bit 9 the flip-flop
    const V960 = 3.6;
    class M960 {
      constructor(h) {
        base(this, h, '960');
        const U = this.outs; U[11] = U[10]; U[13] = U[12]; U[15] = U[14];
        this.ph = this.inc = this.f0 = this.ifs = this.ilo = this.ihi = 0.25;
        this.ph = 0; this.inc = 0; this.f0 = 1; this.ifs = 1; this.ilo = 0; this.ihi = 1;
        this.st = 0; this.osc = 0; this.rcc = 0; this.lamp = 1; this.fr = 1;
        this.vA = new Float64Array(9); this.vB = new Float64Array(9); this.vC = new Float64Array(9);
        this.sm = new Int32Array(9); this.nxt = new Int32Array(9); this.clr = new Uint8Array(9); this.hold = new Uint8Array(9);
        this.arm = new Uint8Array(13); this.pl = new Int32Array(9); this.npl = 0; this.pOn = 0; this.pOff = 0; this.pSh = 0; this.pCi = 0;
        this.oml = -1; this.mo = new Int32Array(9); this.nmo = 0; this.mCo = 0; this.mA = 0; this.mB = 0; this.mC = 0;
        this.ring = new Int32Array(8); this.eh = 0; this.en = 0;
        this.rate(); this.coef(); this.reset();
      }
      rate() { this.ifs = 1 / this.fs; this.ilo = 0.1 * this.ifs; this.ihi = 1000 * this.ifs; }
      coef() {
        const p = this.p, sm = this.sm, nxt = this.nxt, clr = this.clr, hold = this.hold;
        const ka = 0.2 * (1 << (cl(p[33], 0, 2) | 0)), kb = 0.2 * (1 << (cl(p[34], 0, 2) | 0)), kc = 0.2 * (1 << (cl(p[35], 0, 2) | 0));
        for (let k = 0; k < 8; k++) { this.vA[k] = cl(p[k], 0, 10) * ka; this.vB[k] = cl(p[8 + k], 0, 10) * kb; this.vC[k] = cl(p[16 + k], 0, 10) * kc; sm[k] = cl(p[24 + k], 0, 2) | 0; }
        this.vA[8] = 0; this.vB[8] = 0; this.vC[8] = 0; sm[8] = (cl(p[32], 0, 1) | 0) === 0 ? 0 : 2;    // modes: 0 STOP · 1 NORMAL · 2 SKIP
        for (let k = 0; k < 9; k++) { // the shift's table: the next stage after k, and whether it stops the clock
          let t = k, c = 0, j = k;
          for (let m = 0; m < 9; m++) {
            j = j === 8 ? 0 : j + 1;
            if (j === 8) { if (sm[8] === 0) { t = 8; c = 1; break; } continue; }
            if (sm[j] !== 2) { t = j; break; }
          }
          nxt[k] = t; clr[k] = c; hold[k] = k < 8 && sm[k] === 0 ? 1 : 0;
        }
        this.f0 = 0.1 * Math.pow(4, cl(p[36], 0, 6) | 0) * Math.pow(4, cl(p[37], 0, 10) / 10); this.rcc = cl(p[38], 0, 1) | 0;
      }
      incAt(v) { const x = this.f0 * ex2(v) * this.ifs; return x < this.ilo ? this.ilo : x > this.ihi ? this.ihi : x; }
      flush() {}
      ctl(cc) {
        if (this.mv !== 0) this.coef();
        // the fresh flip-flop = CLOCK AT START, taken at the first ctl after construction / reset (the evaluator writes the stored
        // values after both: a constructor's reset() would read the defaults — E9b's find)
        if (this.fr !== 0) { this.fr = 0; this.osc = cl(this.p[39], 0, 1) | 0; }
        if (this.ld !== 0) { // the patched inputs (after a re-wiring: insAccL)
          const I = this.i_, Zb = this.zb, arm = this.arm, pl = this.pl;
          let np = 0;
          for (let k = 0; k < 13; k++) { if (I[k] !== Zb) { if (k >= 4) pl[np++] = k; } else arm[k] = 1; }   // (unpatched: re-armed)
          this.npl = np; this.pOn = I[0] !== Zb ? 1 : 0; this.pOff = I[1] !== Zb ? 1 : 0; this.pSh = I[2] !== Zb ? 1 : 0; this.pCi = I[3] !== Zb ? 1 : 0; this.ld = 0;
        }
        if (this.om !== this.oml) {
          const om = this.om, mo = this.mo;
          let nm = 0; for (let k = 0; k < 9; k++) if ((om & (2 << k)) !== 0) mo[nm++] = k;
          this.nmo = nm; this.mCo = om & 1; this.mA = om & 0xC00; this.mB = om & 0x3000; this.mC = om & 0xC000; this.oml = om;
        }
        if (this.en !== 0) this.evs();
        this.inc = this.incAt(this.rcc !== 0 ? this.vC[this.st] : 0);
        this.lamp = (1 << this.st) | (this.osc << 9);
      }
      ev(k) { // an event (the message handler): kept for the next ctl; a full ring drops its oldest
        if (!(k >= 0 && k < 12)) return;
        if (this.en === 8) { this.eh = (this.eh + 1) & 7; this.en = 7; }
        this.ring[(this.eh + this.en) & 7] = k | 0; this.en++;
      }
      evs() { // the pending events: the flip-flop's (in order), then the shifts, then the last SET (a select wins over a shift)
        const R = this.ring, h = this.eh, n = this.en;
        for (let j = 0; j < n; j++) { const k = R[(h + j) & 7]; if (k === 0) this.osc = 1; else if (k === 1) this.osc = 0; }
        for (let j = 0; j < n; j++) if (R[(h + j) & 7] === 2) { const t = this.st; if (this.hold[t] === 0) { if (this.clr[t] !== 0) this.osc = 0; this.st = this.nxt[t]; } }
        let s = -1; for (let j = 0; j < n; j++) { const k = R[(h + j) & 7]; if (k >= 3) s = k - 3; }
        if (s >= 0) this.st = s;
        this.eh = 0; this.en = 0;
      }
      run(sec, i0, n) {
        const I = this.i_, U = this.outs, arm = this.arm, pl = this.pl, np = this.npl, hold = this.hold, nxt = this.nxt, clr = this.clr, VA = this.vA, VB = this.vB, VC = this.vC;
        const on = I[0], off = I[1], sh = I[2], ci = I[3], pOn = this.pOn, pOff = this.pOff, pSh = this.pSh, pCi = this.pCi;
        const co = U[0], ra = U[10], rb = U[12], rc = U[14], mCo = this.mCo, mA = this.mA, mB = this.mB, mC = this.mC, mo = this.mo, nm = this.nmo;
        const f0 = this.f0, rcc = this.rcc, ifs = this.ifs, ilo = this.ilo, ihi = this.ihi;
        let ph = this.ph, st = this.st, osc = this.osc, inc = this.inc;
        for (let i = i0, e = i0 + n; i < e; i++) {
          let sft = 0, sel = -1;
          if (pOn !== 0) { const v = on[i]; if (arm[0] !== 0) { if (v > 1.5) { arm[0] = 0; osc = 1; } } else if (v < 1) arm[0] = 1; }
          if (pOff !== 0) { const v = off[i]; if (arm[1] !== 0) { if (v > 1.5) { arm[1] = 0; osc = 0; } } else if (v < 1) arm[1] = 1; }
          if (pSh !== 0) { const v = sh[i]; if (arm[2] !== 0) { if (v > 1.5) { arm[2] = 0; sft = 1; } } else if (v < 1) arm[2] = 1; }
          if (osc !== 0) {
            if (pCi !== 0) { const x = f0 * ex2(ci[i] + (rcc !== 0 ? VC[st] : 0)) * ifs; inc = x < ilo ? ilo : x > ihi ? ihi : x; }
            ph += inc; if (ph >= 1) { ph -= 1; sft = 1; }
          }
          for (let j = 0; j < np; j++) { const k = pl[j], v = I[k][i]; if (arm[k] !== 0) { if (v > 1.5) { arm[k] = 0; sel = k - 4; } } else if (v < 1) arm[k] = 1; }
          if (sft !== 0 && hold[st] === 0) { if (clr[st] !== 0) osc = 0; st = nxt[st]; if (rcc !== 0 && pCi === 0) inc = this.incAt(VC[st]); }
          if (sel >= 0) { st = sel; if (rcc !== 0 && pCi === 0) inc = this.incAt(VC[st]); }
          if (mCo !== 0) co[i] = osc !== 0 && ph < 0.9 ? V960 : 0;
          if (mA !== 0) ra[i] = VA[st]; if (mB !== 0) rb[i] = VB[st]; if (mC !== 0) rc[i] = VC[st];
          for (let j = 0; j < nm; j++) { const k = mo[j]; U[1 + k][i] = st === k ? V960 : 0; }
        }
        this.ph = ph; this.st = st; this.osc = osc; this.inc = inc; this.lamp = (1 << st) | (osc << 9);
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); this.coef(); }
      reset() { this.ph = 0; this.st = 0; this.osc = 0; this.fr = 1; this.arm.fill(1); this.eh = 0; this.en = 0; this.lamp = 1; }   // (the flip-flop: at the next ctl)
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 961: interface (the 961CP console format) */
    // ins 0 … 5 / 6 … 11 V→S 1's A / B inputs, 12 … 23 V→S 2's, 24 / 25 S→V 1 / 2, 26 AUDIO; outs 0 / 1 S-TRIG OUT 1 / 2, 2 / 3
    // S→V 1 / 2, 4 AUDIO → V (5 its second jack: one buffer). V→S (sections 0, 1): closed while any A input is high (each its
    // own +1.5 V / +1.0 V Schmitt), or while the B one-shot runs — a rise on any B input (re)starts it for SWITCH ON TIME =
    // 40 ms · 100^(v / 10) (40 ms … 4 s; 400 ms at 5) [R VK-55, MS-961]. S→V (2, 3): 4 V while closed. AUDIO → V (4): a
    // comparator on the signal, on above θ = 5 · 0.01^(v / 10) V (5 V … 50 mV), off below θ / 2, out 4 V [C]
    class M961 {
      constructor(h) {
        base(this, h, '961');
        this.outs[5] = this.outs[4];
        this.th = this.T1 = this.T2 = 0.25; this.th = 0.5; this.T1 = 1; this.T2 = 1; this.hi = 0;
        this.ab = new Uint8Array(24); this.cnt = new Float64Array(2); this.rz = new Uint8Array(BL);
        this.la = new Int32Array(12); this.lb = new Int32Array(12); this.na0 = 0; this.nb0 = 0; this.na1 = 0; this.nb1 = 0;
        this.coef(); this.reset();
      }
      coef() {
        const p = this.p, fs = this.fs;
        this.T1 = Math.max(1, Math.round(0.04 * Math.pow(100, cl(p[0], 0, 10) / 10) * fs)); this.T2 = Math.max(1, Math.round(0.04 * Math.pow(100, cl(p[1], 0, 10) / 10) * fs));
        this.th = 5 * Math.pow(0.01, cl(p[2], 0, 10) / 10);
      }
      flush() {}
      ctl(cc) { // the patched A / B inputs of both V→S circuits (after a re-wiring: insAccL); an unpatched A reads low, an unpatched B re-arms
        if (this.mv !== 0) this.coef();
        if (this.ld === 0) return;
        this.ld = 0;
        const I = this.i_, Zb = this.zb, ab = this.ab, la = this.la, lb = this.lb;
        let na = 0, nb = 0;
        for (let k = 0; k < 6; k++) { if (I[k] !== Zb) la[na++] = k; else ab[k] = 0; if (I[6 + k] !== Zb) lb[nb++] = 6 + k; else ab[6 + k] = 1; }
        this.na0 = na; this.nb0 = nb; na = 6; nb = 6;
        for (let k = 12; k < 18; k++) { if (I[k] !== Zb) la[na++] = k; else ab[k] = 0; if (I[6 + k] !== Zb) lb[nb++] = 6 + k; else ab[6 + k] = 1; }
        this.na1 = na; this.nb1 = nb;
      }
      run(sec, i0, n) {
        const I = this.i_, e = i0 + n;
        if (sec < 2) {
          // input by input: the B inputs' rises (each its own Schmitt) mark rz, the one-shot runs over them, the A inputs' levels OR in
          const o = this.outs[sec], ab = this.ab, la = this.la, lb = this.lb, rz = this.rz, j0 = 6 * sec, na = sec === 0 ? this.na0 : this.na1, nb = sec === 0 ? this.nb0 : this.nb1, T = sec === 0 ? this.T1 : this.T2;
          let c = this.cnt[sec];
          for (let j = j0; j < nb; j++) { const k = lb[j], x = I[k]; let a = ab[k]; for (let i = i0; i < e; i++) { const v = x[i]; if (a !== 0) { if (v > 1.5) { a = 0; rz[i] = 1; } } else if (v < 1) a = 1; } ab[k] = a; }
          if (nb > j0 || c > 0) { for (let i = i0; i < e; i++) { if (rz[i] !== 0) { rz[i] = 0; c = T; } if (c > 0) { c -= 1; o[i] = 1; } else o[i] = 0; } }
          else for (let i = i0; i < e; i++) o[i] = 0;
          for (let j = j0; j < na; j++) { const k = la[j], x = I[k]; let a = ab[k]; for (let i = i0; i < e; i++) { const v = x[i]; if (a === 0) { if (v > 1.5) a = 1; } else if (v < 1) a = 0; if (a !== 0) o[i] = 1; } ab[k] = a; }
          this.cnt[sec] = c;
        } else if (sec < 4) {
          const x = I[22 + sec], o = this.outs[sec];
          for (let i = i0; i < e; i++) o[i] = x[i] > 0.5 ? 4 : 0;
        } else {
          const x = I[26], o = this.outs[4], th = this.th, tl = 0.5 * th;
          let hi = this.hi;
          for (let i = i0; i < e; i++) { const v = x[i]; if (hi === 0) { if (v > th) hi = 1; } else if (v < tl) hi = 0; o[i] = hi !== 0 ? 4 : 0; }
          this.hi = hi;
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.coef(); }
      reset() { const ab = this.ab; for (let k = 0; k < 24; k++) ab[k] = (k % 12) < 6 ? 0 : 1; this.cnt[0] = 0; this.cnt[1] = 0; this.hi = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 962: sequential switch */
    // ins 0 … 2 SIGNAL INPUT 1 … 3 · 3 … 5 TRIGGER IN 1 … 3 · 6 SHIFT; outs 0 OUTPUT (1 its second jack: one buffer) · 2 … 4
    // TRIGGER OUT 1 … 3. One input at a time to the output, a negative excursion clipped at −1 V (built for positive control
    // voltages: bipolar passes under 2 Vpp) [R MS-962; C the hard clip]; a rise on SHIFT steps 1 → 2 → 1 …, or 1 → 2 → 3 when
    // INPUT 3 is patched; a rise on TRIGGER IN k (or SET k, an event at the next ctl) selects k — after a shift of the same
    // sample (a select wins); TRIGGER OUT k +3.6 V while k is selected. Fresh: input 1. lamp: bit k = input k + 1
    class M962 {
      constructor(h) {
        base(this, h, '962');
        this.outs[1] = this.outs[0];
        this.sel = 0; this.ways = 2; this.lamp = 1;
        this.arm = new Uint8Array(7); this.pl = new Int32Array(3); this.npl = 0; this.pSh = 0;
        this.ring = new Int32Array(8); this.eh = 0; this.en = 0;
        this.reset();
      }
      flush() {}
      ctl(cc) {
        if (this.ld !== 0) { // the patched inputs (after a re-wiring: insAccL)
          const I = this.i_, Zb = this.zb, arm = this.arm, pl = this.pl;
          let np = 0;
          for (let k = 3; k < 7; k++) { if (I[k] !== Zb) { if (k < 6) pl[np++] = k; } else arm[k] = 1; }
          this.npl = np; this.pSh = I[6] !== Zb ? 1 : 0; this.ways = I[2] !== Zb ? 3 : 2; this.ld = 0;
        }
        if (this.en !== 0) { const R = this.ring; for (let j = 0; j < this.en; j++) this.sel = R[(this.eh + j) & 7]; this.eh = 0; this.en = 0; }
        this.lamp = 1 << this.sel;
      }
      ev(k) {
        if (!(k >= 0 && k < 3)) return;
        if (this.en === 8) { this.eh = (this.eh + 1) & 7; this.en = 7; }
        this.ring[(this.eh + this.en) & 7] = k | 0; this.en++;
      }
      run(sec, i0, n) {
        const I = this.i_, U = this.outs, q = U[0], o1 = U[2], o2 = U[3], o3 = U[4], sh = I[6], pSh = this.pSh, pl = this.pl, np = this.npl, arm = this.arm, ways = this.ways;
        const om = this.om, mq = (om & 3) !== 0, m1 = (om & 4) !== 0, m2 = (om & 8) !== 0, m3 = (om & 16) !== 0;
        let sel = this.sel;
        for (let i = i0, e = i0 + n; i < e; i++) {
          let sft = 0, s = -1;
          if (pSh !== 0) { const v = sh[i]; if (arm[6] !== 0) { if (v > 1.5) { arm[6] = 0; sft = 1; } } else if (v < 1) arm[6] = 1; }
          for (let j = 0; j < np; j++) { const k = pl[j], v = I[k][i]; if (arm[k] !== 0) { if (v > 1.5) { arm[k] = 0; s = k - 3; } } else if (v < 1) arm[k] = 1; }
          if (sft !== 0) sel = sel + 1 >= ways ? 0 : sel + 1;
          if (s >= 0) sel = s;
          if (mq) { const x = I[sel][i]; q[i] = x < -1 ? -1 : x; }
          if (m1) o1[i] = sel === 0 ? V960 : 0; if (m2) o2[i] = sel === 1 ? V960 : 0; if (m3) o3[i] = sel === 2 ? V960 : 0;
        }
        this.sel = sel; this.lamp = 1 << sel;
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() { this.sel = 0; this.arm.fill(1); this.eh = 0; this.en = 0; this.lamp = 1; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 992: control voltages */
    // its four switches are bus rows (moog-core: KEYBOARD / WHEEL / PRESSURE / EXT → the 904B's CONTROL INPUT 3); EXT IN through
    // the reversible attenuator (−10 … +10: × v / 10) to the rear output that the fourth row routes [R VK-55]
    class M992 {
      constructor(h) { base(this, h, '992'); this.g = 0.25; this.g = 0; this.coef(); }
      coef() { this.g = cl(this.p[4], -10, 10) / 10; }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) { const x = this.i_[0], o = this.outs[0], g = this.g; for (let i = i0, e = i0 + n; i < e; i++) o[i] = g * x[i]; }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ 993 / 994 / CP8A: no slots */
    // never scheduled, but a class each: without a T entry the evaluator drops the module and its cords as 'type' (the 994's
    // multiples are the evaluator's 'any' jacks; the 993's switches are bus rows; the CP8A is drawn, not emulated)
    class M993 {
      constructor(h) { base(this, h, '993'); }
      flush() {}
      ctl(cc) {}
      run(sec, i0, n) {}
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }
    class M994 {
      constructor(h) { base(this, h, '994'); }
      flush() {}
      ctl(cc) {}
      run(sec, i0, n) {}
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }
    class MCP8A {
      constructor(h) { base(this, h, 'cp8a'); }
      flush() {}
      ctl(cc) {}
      run(sec, i0, n) {}
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ CP2: filters, multiples, keyboard outputs (a stand-in) */
    // sections 0 / 1: one-pole passive LP / HP (the 923's: 10 · 1000^(v / 10) Hz, trapezoidal, prewarped); 2 the multiples (the
    // evaluator's); 3: PITCH / S-TRIG OUT copy the rear inputs that two always-on bus rows feed from the controller
    class MCP2 {
      constructor(h) { base(this, h, 'cp2'); this.l = this.h = this.gl = this.gh = 0.25; this.l = 0; this.h = 0; this.gl = 0; this.gh = 0; this.coef(); }
      coef() {
        const p = this.p, lim = 0.45 * this.fs;
        const fl = Math.min(lim, 10 * Math.pow(1000, cl(p[0], 0, 10) / 10)), fh = Math.min(lim, 10 * Math.pow(1000, cl(p[1], 0, 10) / 10));
        const gl = Math.tan(Math.PI * fl / this.fs), gh = Math.tan(Math.PI * fh / this.fs);
        this.gl = gl / (1 + gl); this.gh = gh / (1 + gh);
      }
      flush() { if (this.l < TINY && this.l > -TINY) this.l = 0; if (this.h < TINY && this.h > -TINY) this.h = 0; }
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, U = this.outs, e = i0 + n;
        if (sec === 0) {
          const x = I[0], o = U[0], G = this.gl;
          let s = this.l;
          for (let i = i0; i < e; i++) { const v = (x[i] - s) * G, y = v + s; s = y + v; o[i] = rail(y); }
          this.l = s;
        } else if (sec === 1) {
          const x = I[1], o = U[1], G = this.gh;
          let s = this.h;
          for (let i = i0; i < e; i++) { const xi = x[i], v = (xi - s) * G, y = v + s; s = y + v; o[i] = rail(xi - y); }
          this.h = s;
        } else if (sec === 3) {
          const kp = I[2], ks = I[3], po = U[2], so = U[3], om = this.om;
          if ((om & 4) !== 0) for (let i = i0; i < e; i++) po[i] = kp[i];
          if ((om & 8) !== 0) for (let i = i0; i < e; i++) so[i] = ks[i];
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.coef(); }
      reset() { this.l = 0; this.h = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ CP3A: mixer and routing */
    // section 0: the controller's MIX re-written — Σ m_k · LEVEL_k / 10 × MASTER / 5 (×1 at 5, ×2 at 10) → MIX + (railed), MIX −
    // its inverse [R VK-35 / VK-55, MS-CPANELS55]; 1: EXT IN × EXT LEVEL / 10 (10 = direct) to the rear output the fourth routing
    // switch's bus row takes to its driver; 2 the multiple (the evaluator's). The routing switches are bus rows (moog-core)
    class MCP3A {
      constructor(h) { base(this, h, 'cp3a'); this.lv = new Float64Array(4); this.ra = 0.25; this.ra = 1; this.coef(); }
      coef() { const p = this.p, ms = cl(p[4], 0, 10) / 5; for (let k = 0; k < 4; k++) this.lv[k] = cl(p[k], 0, 10) / 10 * ms; this.ra = cl(p[9], 0, 10) / 10; }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const I = this.i_, U = this.outs, e = i0 + n;
        if (sec === 0) {
          const m1 = I[0], m2 = I[1], m3 = I[2], m4 = I[3], mo = U[0], mn = U[1], L = this.lv, l1 = L[0], l2 = L[1], l3 = L[2], l4 = L[3], Zb = this.zb;
          const om = this.om, a = (om & 1) !== 0, b = (om & 2) !== 0, q2 = m2 !== Zb, q3 = m3 !== Zb, q4 = m4 !== Zb;
          for (let i = i0; i < e; i++) {
            let x = l1 * m1[i]; if (q2) x += l2 * m2[i]; if (q3) x += l3 * m3[i]; if (q4) x += l4 * m4[i];
            if (a) mo[i] = rail(x); if (b) mn[i] = rail(-x);
          }
        } else if (sec === 1) {
          const x = I[4], o = U[2], g = this.ra;
          for (let i = i0; i < e; i++) o[i] = g * x[i];
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ CP4A: routing (a stand-in) */
    // two pass-throughs to rear outputs for the bus rows (the trigger routing's, the CV routing's): TRIGGER IN → the rear S
    // line, CV IN → the rear CV
    class MCP4A {
      constructor(h) { base(this, h, 'cp4a'); }
      flush() {}
      ctl(cc) {}
      run(sec, i0, n) { const x = this.i_[sec], o = this.outs[sec]; for (let i = i0, e = i0 + n; i < e; i++) o[i] = x[i]; }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ CP35: attenuators and sources (a stand-in) */
    // section 0: +6 V and −6 V; sections 1 … 4: passive attenuators o_k = i_k · a_k / 10 (10 = unity), i1 / i2 normalled to +6 V,
    // i3 / i4 to −6 V (the evaluator's normals: unpatched, an adjustable ±6 V source); 5 the multiple (the evaluator's)
    class MCP35 {
      constructor(h) { base(this, h, 'cp35'); this.a = new Float64Array(4); this.coef(); }
      coef() { const p = this.p; for (let k = 0; k < 4; k++) this.a[k] = cl(p[k], 0, 10) / 10; }
      flush() {}
      ctl(cc) { if (this.mv !== 0) this.coef(); }
      run(sec, i0, n) {
        const U = this.outs, e = i0 + n;
        if (sec === 0) {
          const om = this.om, a = U[0], b = U[1];
          if ((om & 1) !== 0) for (let i = i0; i < e; i++) a[i] = 6;
          if ((om & 2) !== 0) for (let i = i0; i < e; i++) b[i] = -6;
        } else if (sec < 5) { const x = this.i_[sec - 1], o = U[sec + 1], g = this.a[sec - 1]; for (let i = i0; i < e; i++) o[i] = x[i] * g; }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); }
      reset() {}
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    /* ------------------------------------------------------------ the Song clock (ours, IMPL-9b §3.4) */
    // The song's steps as pulses, read per absolute chunk from the Inst's transport h.inst.tp (the Track's { play, frame, tick,
    // fpt, wrap, ls, le, end }, shared by reference): the continuous tick expression t(F) = tick + (F − frame) / fpt (drClock's)
    // at the chunk's two ends, the loop folded here (wrap and t ≥ le → ls + (t − ls) mod (le − ls)), stopping at end — never the
    // roll notes' rounded frames, so the output is the same whatever the span splits and however late the Track handles a wrap.
    // CLOCK +5 V while t ≥ 0 and frac(t / STEP) < ½: a level of the position, its changes at the half steps b, each on the OS
    // sample ⌈(b − t₀) · fpt · OS − 1e-9⌉ of its segment; RUN +5 V while running; RESTART a 5 ms pulse at a start (the first
    // running chunk after a reset, a stop or a count-in — t < 0 is silent, tick 0 the start), a loop wrap (its sample), a jump
    // (|Δt| > 0.5 tick between chunks: a seek; a tempo change's late anchor moves it ≤ 0.013 tick) and, LENGTH N on, every step
    // index ≡ 0 (mod N) from tick 0 (P-2 (b)) — a pulse still high is extended. MODE SONG: all low while stopped; ALWAYS:
    // stopped, the steps at the Inst's bpm from frame 0 (t = F / fpt, drClock's stopped clock: a stopped tempo change jumps,
    // RESTART). ctl plans the chunk — constants, or per-sample levels in a chunk with a change —, run copies it. lamp: bit 0 RUN
    const STEP_T = [960, 480, 240, 120, 320, 160];              // 1/4 1/8 1/16 1/32 1/8T 1/16T at 960 ticks a quarter
    // the half step before a segment's first sample at position p (sc samples a tick): floor(p / half), less one when that
    // boundary lies under a sample before p — it lands on the segment's first sample (an event there: a LENGTH RESTART)
    const qOf = (p, half, sc) => { const q = Math.floor(p / half); return (p - q * half) * sc < 1 - 1e-9 ? q - 1 : q; };
    class MClk {
      constructor(h) {
        base(this, h, 'clk');
        this.stp = this.half = this.base = this.pe = this.rsn = this.ra = this.k0 = this.n0 = this.s0 = 0.25;
        this.stp = 240; this.half = 120; this.base = this.fs / this.os; this.pe = 0; this.rsn = 0; this.ra = 0; this.k0 = 0; this.n0 = 0; this.s0 = 0;
        this.md = 0; this.N = 0; this.RSN = 1; this.was = 0; this.r1 = 0; this.cst = 1; this.wn = 0; this.lamp = 0;
        this.qk = new Float64Array(BL); this.qn = new Float64Array(BL); this.qs = new Float64Array(BL);
        this.rate(); this.coef();
      }
      rate() { this.base = this.fs / this.os; this.RSN = Math.max(1, Math.round(0.005 * this.fs)); }
      coef() { const p = this.p, l = cl(p[2], 0, 31) | 0; this.stp = STEP_T[cl(p[0], 0, 5) | 0]; this.half = 0.5 * this.stp; this.md = cl(p[1], 0, 1) | 0; this.N = l === 0 ? 0 : l + 1; }
      flush() {}
      ctl(cc) {
        if (this.mv !== 0) this.coef();
        const CH = 4 * this.os, F = 4 * cc, I = this.inst, tp = I !== null ? I.tp : undefined;
        let fpt = 0, u = 0, ue = 0, wr = 0, ls = 0, le = 0, end = Infinity, on = 0;
        if (tp !== undefined && tp !== null && tp.play && tp.fpt > 0) {
          on = 1; fpt = +tp.fpt; u = tp.tick + (F - tp.frame) / fpt; ue = tp.tick + (F + 4 - tp.frame) / fpt;
          if (tp.wrap && tp.le > tp.ls) { wr = 1; ls = +tp.ls; le = +tp.le; }
          if (tp.end !== undefined && tp.end !== null) end = +tp.end;
        } else if (this.md === 1) {
          const b = I !== null ? +I.bpm : 120;
          on = 1; fpt = this.base * 60 / ((b >= 20 ? b <= 400 ? b : 400 : b > 0 ? 20 : 120) * 960); u = F / fpt; ue = (F + 4) / fpt;
        }
        if (on === 0) { this.was = 0; this.rsn = 0; this.wn = 0; this.cst = 1; this.k0 = 0; this.n0 = 0; this.s0 = 0; this.lamp = 0; return; }   // stopped (SONG)
        const sc = fpt * this.os, half = this.half, L = le - ls;
        let p0 = u, pe = ue;
        if (wr !== 0 && p0 >= le) p0 = ls + (p0 - ls) % L;
        if (wr !== 0 && pe >= le) pe = ls + (pe - ls) % L;
        // a start / a jump → RESTART at sample 0; so does a wrap the last chunk placed on its sample CH (this chunk's 0)
        const r0 = p0 >= 0 && p0 < end ? 1 : 0, d = p0 - this.pe, fire0 = r0 !== 0 && (this.was === 0 || d > 0.5 || d < -0.5 || this.wn !== 0) ? 1 : 0;
        // the chunk's first change: the wrap, tick 0 (a count-in's end), the next half step or the end, the pulse's end — a half
        // step less than a sample before p0 lands on sample 0 here (⌈(b − p0) · sc − 1e-9⌉ = 0: the last chunk's was CH)
        let jw = CH;
        if (wr !== 0) { jw = Math.ceil((le - p0) * sc - 1e-9); if (jw < 0) jw = 0; }
        this.wn = wr !== 0 && jw === CH ? 1 : 0;
        let jn = CH;
        if (p0 < end) { const b = r0 === 0 ? 0 : Math.min(end, (qOf(p0, half, sc) + 1) * half); jn = Math.ceil((b - p0) * sc - 1e-9); }
        const rs = this.rsn;
        if (fire0 === 0 && jw >= CH && jn >= CH && (rs === 0 || rs >= CH)) { // no change in the chunk: constants
          const lv = r0 !== 0 && (Math.floor(p0 / half) & 1) === 0 ? 5 : 0;
          this.cst = 1; this.k0 = lv; this.n0 = r0 !== 0 ? 5 : 0; this.s0 = rs > 0 ? 5 : 0; this.rsn = rs > CH ? rs - CH : 0;
          this.was = r0; this.pe = pe; this.lamp = r0;
          return;
        }
        const qs = this.qs;   // a change inside: the per-sample plan
        for (let j = 0; j < CH; j++) qs[j] = j < rs ? 5 : 0;
        this.ra = rs;
        if (fire0 !== 0) this.fire(0, CH);
        if (jw > CH) jw = CH;
        this.walk(0, jw, p0, sc, end, CH);
        if (jw < CH) { const uw = p0 + jw / sc; this.fire(jw, CH); this.walk(jw, CH, uw > le ? ls + (uw - ls) % L : ls, sc, end, CH); }   // (the wrap's sample: from ls)
        this.cst = 0; this.rsn = this.ra > CH ? this.ra - CH : 0; this.was = this.r1; this.pe = pe; this.lamp = this.r1;
      }
      fire(j, CH) { const qs = this.qs, e = j + this.RSN; for (let k = j; k < CH && k < e; k++) qs[k] = 5; if (e > this.ra) this.ra = e; }
      // samples [ja, jb) at positions pa + (j − ja) / sc (no wrap inside): CLOCK / RUN, RESTART at tick 0 and at LENGTH's steps
      walk(ja, jb, pa, sc, end, CH) {
        const qk = this.qk, qn = this.qn, half = this.half, N = this.N;
        let j = ja, run = pa >= 0 && pa < end ? 1 : 0, done = pa >= end ? 1 : 0, q = run !== 0 ? qOf(pa, half, sc) : 0;
        while (j < jb) {
          let b = 0, kind = 0;                                 // the next change: 1 tick 0, 2 a half step, 3 the end, 0 none
          if (done !== 0) kind = 0; else if (run === 0) { b = 0; kind = 1; } else { b = (q + 1) * half; kind = 2; if (end <= b) { b = end; kind = 3; } }
          let jn = kind === 0 ? jb : ja + Math.ceil((b - pa) * sc - 1e-9);
          if (jn < j) jn = j;
          const lk = run !== 0 && (q & 1) === 0 ? 5 : 0, ln = run !== 0 ? 5 : 0, e = jn < jb ? jn : jb;
          for (; j < e; j++) { qk[j] = lk; qn[j] = ln; }
          if (jn >= jb) break;
          if (kind === 1) { run = 1; q = 0; this.fire(jn, CH); }
          else if (kind === 2) { q += 1; if ((q & 1) === 0 && N > 0 && (q / 2) % N === 0) this.fire(jn, CH); }
          else { run = 0; done = 1; }
        }
        this.r1 = run;
      }
      run(sec, i0, n) {
        const U = this.outs, om = this.om, e = i0 + n, ck = U[0], rn = U[1], rs = U[2];
        if (this.cst !== 0) {
          const a = this.k0, b = this.n0, c = this.s0;
          if ((om & 1) !== 0) for (let i = i0; i < e; i++) ck[i] = a;
          if ((om & 2) !== 0) for (let i = i0; i < e; i++) rn[i] = b;
          if ((om & 4) !== 0) for (let i = i0; i < e; i++) rs[i] = c;
        } else {
          const A = this.qk, B = this.qn, C = this.qs;
          if ((om & 1) !== 0) for (let i = i0; i < e; i++) ck[i] = A[i];
          if ((om & 2) !== 0) for (let i = i0; i < e; i++) rn[i] = B[i];
          if ((om & 4) !== 0) for (let i = i0; i < e; i++) rs[i] = C[i];
        }
      }
      setOS(fs, os) { this.fs = fs; this.os = osOf(fs, os); this.rate(); }
      reset() { this.was = 0; this.pe = 0; this.rsn = 0; this.ra = 0; this.wn = 0; this.cst = 1; this.k0 = 0; this.n0 = 0; this.s0 = 0; this.lamp = 0; }
      setSalt(s) { this.salt = (s | 0) >>> 0; }
    }

    for (const C of [M921, M921A, M921B, M923, M904A, M907A, M911, M902, M995, Ctl]) Object.defineProperty(C.prototype, 'ins', insAcc);
    // the 960 / 961 / 962's ins: insAcc's, and any access marks their patched-input lists stale (the evaluator re-wires a slot only
    // through it: make()'s whole array, install()'s m.ins[k] = …) — the lists rebuilt at the next ctl, not every chunk
    const insAccL = { get() { this.ld = 1; return this.i_; }, set(a) { insAcc.set.call(this, a); this.ld = 1; } };
    for (const C of [M904B, M914, M911A, M903A, M992, M993, M994, MCP2, MCP3A, MCP4A, MCP35, MCP8A, MClk]) Object.defineProperty(C.prototype, 'ins', insAcc);
    for (const C of [M960, M961, M962]) Object.defineProperty(C.prototype, 'ins', insAccL);
    const T = Object.freeze({ ctl: Ctl, 921: M921, '921a': M921A, '921b': M921B, 923: M923, '904a': M904A, '907a': M907A, 911: M911, 902: M902, 995: M995,
      '904b': M904B, 914: M914, '911a': M911A, '903a': M903A, 960: M960, 961: M961, 962: M962, 992: M992, 993: M993, 994: M994,
      cp2: MCP2, cp3a: MCP3A, cp4a: MCP4A, cp35: MCP35, cp8a: MCP8A, clk: MClk });
    const EV = Object.freeze(Object.fromEntries(ORDER.map(t => [t, Object.freeze((EV0[t] || []).slice())])));
    const LAMPS = Object.freeze(Object.fromEntries(ORDER.map(t => [t, Object.freeze((LAMP0[t] || []).slice())])));
    globalThis.PatchMoog = Object.freeze({
      id: 'moog', VER, T, ORDER: Object.freeze(ORDER), JACKS: Object.freeze(JACKS), SECS: Object.freeze(SECS), PARAMS: Object.freeze(PARAMS),
      SINK: 'out', LINK, OUT_K, CTL: 'ctl', IO: Object.freeze(IO), BL, Z, EV, LAMPS,
      RANGE: Object.freeze(Object.fromEntries(ORDER.map(t => [t, Object.freeze(SPEC[t].params.map(p => Object.freeze([p[2], p[3]])))]))),
      // the constants (tests, docs/canvas/research-moog-modules.md §10)
      K: Object.freeze({ C4, EMAX, AS, AN, AT, AR, KI, KO, FB: Object.freeze(FB.slice()), Q_BP, Q_SH, G_BP, G_SH, OV911, WP_S, WM_S, PINK_K,
        F914: Object.freeze(F914.slice()), D914, Q914, Q914S, G914, FL914, FH914, V960, STEP_T: Object.freeze(STEP_T.slice()) }),
      ex2, tanp, rail, psin, KW,
    });
  } catch (err) {
    globalThis.PatchMoog = null;                     // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('moog-dsp: load failed', err);
  }
})();
