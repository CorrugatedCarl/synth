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
    };
    const ORDER = ['ctl', '921', '921a', '921b', '923', '904a', '907a', '911', '902', '995'];
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

    for (const C of [M921, M921A, M921B, M923, M904A, M907A, M911, M902, M995, Ctl]) Object.defineProperty(C.prototype, 'ins', insAcc);
    const T = Object.freeze({ ctl: Ctl, 921: M921, '921a': M921A, '921b': M921B, 923: M923, '904a': M904A, '907a': M907A, 911: M911, 902: M902, 995: M995 });
    globalThis.PatchMoog = Object.freeze({
      id: 'moog', VER, T, ORDER: Object.freeze(ORDER), JACKS: Object.freeze(JACKS), SECS: Object.freeze(SECS), PARAMS: Object.freeze(PARAMS),
      SINK: 'out', LINK, OUT_K, CTL: 'ctl', IO: Object.freeze(IO), BL, Z,
      RANGE: Object.freeze(Object.fromEntries(ORDER.map(t => [t, Object.freeze(SPEC[t].params.map(p => Object.freeze([p[2], p[3]])))]))),
      // the constants (tests, docs/canvas/research-moog-modules.md §10)
      K: Object.freeze({ C4, EMAX, AS, AN, AT, AR, KI, KO, FB: Object.freeze(FB.slice()), Q_BP, Q_SH, G_BP, G_SH, OV911, WP_S, WM_S, PINK_K }),
      ex2, tanp, rail, psin, KW,
    });
  } catch (err) {
    globalThis.PatchMoog = null;                     // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('moog-dsp: load failed', err);
  }
})();
