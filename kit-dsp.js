/*
 * kit-dsp.js — our drum machine's voices (stage DM, docs/canvas/IMPL-DM.md §2, §7.1, §9.2; lane V) — classic script, no
 * imports/exports. Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread (wk.loadDSP), in the offline
 * render worker (smprender.js), the bench worker (cv-cost.js) and node vm contexts (tests/dsp-scope.mjs). One IIFE publishes
 * the frozen `globalThis.DrKit`; a failure inside leaves DrKit = null without throwing. It reads no other script's global (D6).
 *
 * Six synthesized types on generic blocks (§2.2), every knob → Hz / s / dB by kit-core's KIT.TYPES (copied below with KIT.LAW,
 * lawVal and CHOKE_MS; tests/kit-dsp.test.mjs compares them byte for byte — no second source of a law): the Kick (a swept sine,
 * a 4 ms Hann noise click through a 1-pole high-pass, the drive), the Snare (two modes dropping 12 % over 8 ms, white noise through
 * a 2-pole high-pass), the Hi-hat (six polyBLEP squares on our ratio set + noise into a high-pass and a band-pass, summed), the
 * Clap (noise through a band-pass, n bursts, a tail, a 1-pole low-pass), the Tom (a bending sine, a noise burst at 2f, the drive),
 * the Perc (two struck resonators bending down). Units: the bus carries full scale (post: L = R = mono; no output stage: gain 1).
 *
 * Interface (§9.2, the Dr808 family's): DrKit.create(inst, 'kit'[, opt]) → machine (another kind: null)
 *   set(drum)           the KitP ({ v: Float64Array(144) in KIT.IDS order: knob positions 0…1, TYPE / CHOKE values }; a plain
 *                       object of the ids reads the same) — stored by reference; a hit reads its slot's nine at the chunk it
 *                       applies in (a turned knob takes effect at the next hit: a ringing hit keeps its sound, cut 1)
 *   setOS(os)           the Inst's oversampling: every rate-dependent coefficient rebuilt, the ringing instances carry on
 *   hit(slot, v127)     latches a hit of slot 0…15 (the note through the map) for the next render; the highest velocity wins
 *   trig(mask, vl, o)   latches a step: lane j = slot j (16 bits, no accent bit), vl[o + j] its velocity (a vl shorter than
 *                       o + 16, or none: v 100); v 0 nothing
 *   render(buf, N, F0)  adds every live instance into buf[0…N) (the Inst's mono OS-rate bus, N = n·OS); F0 the span's absolute
 *                       base frame (a multiple of 4: the family's span grid)
 *   post(L, R, mono, n) L = R = mono (decision f: mono in cut 1)
 *   poll · live · reset · mon() → { lit: 16 bits, act: Float32Array(16) } · smp(slots) (stored, inert in cut 1) · setSalt(s)
 *   _v                  the 32 instances (slot j's: 2j, 2j + 1), each with .on — the engine's CPU count; _M the shared state
 *   opt (tests): { hold: every decay held at 1 (a steady state: the filters' and the band-limiting gates), trace: n (each
 *   instance records its envelope's first n samples in .etr: the Clap's bursts) }
 *
 * Time base (§2.1, the family's): an instance starts at an absolute 4-base-frame chunk (CH = 4·OS samples) and counts its age in
 * OS samples; control-rate work — the pitch envelopes' steps (the sweep term at each chunk's middle), the bends' filter
 * coefficients — runs at its chunk boundaries, everything else per sample by recurrences, so any span split renders the same
 * bytes. Hits latch for the chunk where they land and apply in slot order: first every fade (a slot's own sounding instance —
 * the retrigger — and its choke group's other voices, all started before this chunk), then the starts. Sleep: an instance ends
 * at the first chunk boundary past its slowest envelope's 1e-5 (−100 dB) point + 4 chunks, its state zeroed (an age, not a
 * level test: span splits cannot move it; nothing it holds ever nears 1e-30 — the zeroing is the flush). The noise is a hash of
 * (the absolute OS-sample index, the slot), seeded KIT_SALT ^ salt: sleep and idle skips never change a hit's noise; its density
 * is rate-free (amplitude √(fs / 48 kHz)), so a noise path through its filters sounds the same at every OS.
 * Blocks (§2.1): rotation oscillators (the sine and the modes start at rest, phase 0: no attack), TPT state-variable filters
 * prewarped at their corner (tan), a TPT 1-pole, polyBLEP squares, the drive y = A·tanh(g·x) / tanh(g·A) with first-order
 * antiderivative anti-aliasing (ADAA1: F = A / (g·tanh(gA)) · ln cosh(g·x)); retrigger and choke fades a 3 ms raised cosine.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const fin = x => typeof x === 'number' && isFinite(x);
    const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;
    function deepFreeze(o) {
      if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
      return o;
    }

    /* ------------------------------------------------------------------ the laws: kit-core.js's, verbatim (compared by a test) */
    const kb = (id, label, law, lo, hi, unit, def) => ({ id, label, law, lo, hi, unit, def });
    const TUNE = (lo, hi, def) => kb('tune', 'Tune', 'exp', lo, hi, 'Hz', def);
    const DECAY = (lo, hi, def) => kb('decay', 'Decay', 'exp', lo, hi, 's', def);
    const DRIVE = kb('drive', 'Drive', 'drive', 0, 1, '', 0);              // (§2.1: one block for the Kick and the Tom)

    // §2.2's table: TUNE (u), DECAY (d, a T60) and k1–k4; bright = the k velocity brightens; blk = the block's own constants
    const TYPES = [
      null,
      { n: 1, id: 'kick', label: 'Kick', u: TUNE(30, 120, 0.5), d: DECAY(0.08, 2.4, 0.55), bright: 2,
        k: [kb('punch', 'Punch', 'exp', 1, 16, 'x', 0.5),                  // r = 2^(4k): the sweep's start ratio
          kb('sweep', 'Sweep', 'exp', 0.002, 0.08, 's', 0.4),               // τ of f(t) = f·(1 + (r − 1)·e^(−t/τ))
          kb('click', 'Click', 'lin', 0, 0.6, '', 0.3),                     // the burst's peak × the body's
          DRIVE],
        blk: { clickS: 0.004, clickHp: 2000 } },                            // a 4 ms Hann noise burst through a 1-pole high-pass
      { n: 2, id: 'snare', label: 'Snare', u: TUNE(120, 360, 0.5), d: DECAY(0.06, 0.78, 0.4), bright: 1,
        k: [kb('tone', 'Tone', 'bal', 0, 1, '', 0.55),                     // body : noise = cos : sin(k·π/2)
          kb('color', 'Color', 'exp', 1000, 8000, 'Hz', 0.5),               // the noise's 2-pole high-pass
          kb('snap', 'Snap', 'exp', 0.05, 0.6, 's', 0.45),                  // the noise's T60
          kb('body', 'Body', 'lin', 0, 1, '', 0.5)],                        // the second mode's level
        blk: { ratio: 1.594, drop: 0.12, dropS: 0.008 } },                  // a circular membrane's first two modes, dropping 12 % over 8 ms
      { n: 3, id: 'hat', label: 'Hi-hat', u: TUNE(200, 800, 0.5), d: DECAY(0.02, 1.5, 0.3), bright: 0,
        k: [kb('tone', 'Tone', 'exp', 3000, 12000, 'Hz', 0.5),             // the 2-pole high-pass
          kb('metal', 'Metal', 'lin', 0, 1, '', 0.6),                       // squares : noise
          kb('ring', 'Ring', 'exp', 0.7, 8, 'Q', 0.3),                      // the band-pass's Q
          kb('spread', 'Spread', 'lin', 0.5, 1.5, 'x', 0.5)],               // the ratios as 1 + (r − 1)·(0.5 + k)
        blk: { ratios: [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637], bp: 1.5 } }, // ours (D7); the band-pass at 1.5 × the high-pass
      { n: 4, id: 'clap', label: 'Clap', u: kb('tune', 'Tune', 'exp', 600, 2400, 'Hz', 0.5), d: DECAY(0.08, 0.8, 0.4), bright: 2,
        k: [kb('spread', 'Spread', 'exp', 0.004, 0.016, 's', 0.5),         // the bursts' spacing
          kb('count', 'Count', 'int', 2, 6, '', 0.5),                       // n = 2 + round(4k)
          kb('tone', 'Tone', 'exp', 2000, 16000, 'Hz', 0.6),                // a 1-pole low-pass
          kb('tail', 'Tail', 'lin', 0, 1, '', 0.6)],                        // the tail's level × the burst peak
        blk: { q: 1.4, upS: 0.0002, tauS: 0.0025 } },                       // the band-pass's Q; each burst 0.2 ms up, τ 2.5 ms down
      { n: 5, id: 'tom', label: 'Tom', u: TUNE(60, 480, 0.4), d: DECAY(0.08, 1.6, 0.5), bright: 2,
        k: [kb('bend', 'Bend', 'lin', 0, 12, 'st', 0.3),                   // f·2^((b/12)·e^(−t/τ))
          kb('sweep', 'Sweep', 'exp', 0.01, 0.12, 's', 0.4),
          kb('noise', 'Noise', 'lin', 0, 0.4, '', 0.2),                     // × the body's peak
          DRIVE],
        blk: { noiseAt: 2, noiseT60: 0.25 } },                              // the burst's band-pass at 2f, its T60 a quarter of the body's
      { n: 6, id: 'perc', label: 'Perc', u: TUNE(150, 4800, 0.6), d: DECAY(0.005, 1, 0.3), bright: 2,
        k: [kb('ratio', 'Ratio', 'lin', 1, 3, 'x', 0.4),                   // the second resonator at f·(1 + 2k)
          kb('tone', 'Tone', 'lin', 0, 1, '', 0.5),                         // the second mode's level
          kb('click', 'Click', 'lin', 0, 1, '', 0.3),                       // impulse ↔ noise burst
          kb('bend', 'Bend', 'lin', 0, 7, 'st', 0)],                        // both bend down over bendS
        blk: { burstS: 0.001, bendS: 0.015 } },                             // resonators Q = π·f·T60 / ln 1000
    ];
    // §2.1: the paths' attacks, velocity (gain (v/127)^vPow, the bright knob + vBright·(v − 100)/127), LEVEL ((l / lRef)²), the drive
    // block y = A·tanh(g·x) / tanh(g·A), the sleep / flush thresholds, the control-rate chunk in base frames
    const LAW = { att: 0.0003, vPow: 2, vBright: 0.2, lRef: 0.7, drive: { A: 0.8, g0: 0.01, g2: 6 }, sleep: 1e-5, sleepChunks: 4, flush: 1e-30, chunk: 4 };

    /** A knob's law at position x (0…1, clamped; not a number → the knob's default). */
    function lawVal(L, x) {
      const p = fin(x) ? clamp(x, 0, 1) : L.def;
      switch (L.law) {
        case 'exp': return L.lo * Math.pow(L.hi / L.lo, p);
        case 'int': return L.lo + Math.round((L.hi - L.lo) * p);
        case 'bal': return p * Math.PI / 2;
        case 'drive': return LAW.drive.g0 + LAW.drive.g2 * p * p;
        default: return L.lo + (L.hi - L.lo) * p;
      }
    }
    const CHOKE_MS = 3;                                   // = KIT.CHOKE_MS: a choke's (and a retrigger's) raised-cosine fade

    /* ------------------------------------------------------------------ our constants (lane V) [C] */
    const CODES = 'abcdefghijklmnop'.split('').map(c => 'k' + c), FIELDS = ['t', 'u', 'd', 'l', 'c', '1', '2', '3', '4'];
    const IDS = CODES.flatMap(s => FIELDS.map(f => s + f));           // (= KIT.IDS: the KitP's order)
    const AB = LAW.drive.A;                               // every voice's unit peak (the drive's A: its peak kept at any drive)
    // the bus scale (§2.1 KIT.OUT: the fixture groove on the Starter within 1 dB RMS of the 808's d8p, tests/engine-track) and the
    // types' own trims (their peaks under one another: a hat a third under the kick)
    const OUT = 1;
    const TRIM = [0, 1.08, 0.8, 1.2, 0.85, 0.9, 1.5];
    const KIT_SALT = 0x6B697421;                          // ('kit!') the noise seed, ^ the Inst's salt
    const TAU = 2 * Math.PI, LN2 = Math.LN2, LN1000 = Math.log(1000), LN1E5 = Math.log(1e5);
    const SPAN = 1024;                                    // the largest span in OS samples (128 frames × OS ≤ 8)
    const NB_Q = { tom: 1.5 };                            // the Tom burst's band-pass Q (§2.2 leaves it open) [C]
    const KN = 19596;                                     // the Perc's noise strike: 1 / √(∫hann² · noise density) — its response ≈ the impulse's
    const NOISE_HP = 0.6, NOISE_HAT = 0.7, BUS_HAT = 1;   // noise paths' levels (peaks ≈ the unit's)
    const hash = a => { a ^= a >>> 16; a = Math.imul(a, 0x7feb352d); a ^= a >>> 15; a = Math.imul(a, 0x846ca68b); a ^= a >>> 16; return a; };
    // cos / sin of a small angle (|w| ≤ 0.5: the voices' pitches below 0.08 fs), normalised (a rotation of exactly unit gain)
    const RC = new Float64Array(2);
    function cs(w) {
      const q = w * w, c = 1 - 0.5 * q * (1 - q / 12 * (1 - q / 30 * (1 - q / 56))), s = w * (1 - q / 6 * (1 - q / 20 * (1 - q / 42 * (1 - q / 72))));
      const r = 1 / Math.sqrt(c * c + s * s);
      RC[0] = c * r; RC[1] = s * r;
    }
    // the cubic B-spline step's residual for a unit edge t ∈ [0, 1) samples ago (the samples 2 before … 1 after): BL[0…3]
    const BL = new Float64Array(4);
    function bsp(t) {
      const t2 = t * t, t3 = t2 * t, t4 = t2 * t2, s = t - 1, s3 = s * s * s, u = 1 - t, u2 = u * u;
      BL[0] = t4 / 24; BL[1] = 1 / 24 + (4 * s - 2 * s3 - 0.75 * s * s3 + 2.75) / 6;
      BL[2] = -(1 / 24 + (-4 * t + 2 * t3 - 0.75 * t4 + 2.75) / 6); BL[3] = -u2 * u2 / 24;
    }
    // ln cosh(z), accurate at both ends (the ADAA's antiderivative: small z through sinh, large through the exponential)
    const lnch = z => { const a = z < 0 ? -z : z; if (a < 1) { const h = Math.sinh(0.5 * a); return Math.log1p(2 * h * h); } return a + Math.log1p(Math.exp(-2 * a)) - LN2; };
    // the expected peak of uniform noise (density 1 / (3 · 48 kHz)) through a peak-normalised band-pass at f0, Q: 3 × its RMS
    const bpPeak = (f0, q) => 3 * Math.sqrt(Math.PI * f0 / (2 * q) / 72000);

    /* ------------------------------------------------------------------ an instance */
    class Voice {
      constructor(j, tr) {
        this.on = false; this.s = j >> 1; this.t = 0; this.cg = 0;  // slot, type, choke group
        this.n = 0; this.nEnd = 0; this.fd = -1; this.g = 0; this.v = 0;  // age (OS samples), its end, the fade's index (−1 none), gain, velocity
        this.f = 0; this.T = 0; this.q1 = 0; this.q2 = 0; this.q3 = 0; this.q4 = 0; this.dp = 0;  // the laws at the hit (rate-free)
        this.e1 = 0; this.k1 = 0; this.e2 = 0; this.k2 = 0; this.ra = 0; this.ri = 0; this.nN = 0; // envelopes, the attack ramp, a path's end
        this.x1 = 0; this.y1 = 0; this.c1 = 1; this.s1 = 0; this.x2 = 0; this.y2 = 0; this.c2 = 1; this.s2 = 0; this.w1 = 0; this.w2 = 0;
        this.sw = 0; this.ks = 0; this.sweep = false; this.cN = 0; this.ca = 0; // the sweep term (a chunk's middle), its chunk factor; the click
        this.a1 = 0; this.a2 = 0; this.ga = 0; this.gb = 0; this.gc = 0; this.gk = 0; // SVF A: state, coefficients
        this.b1 = 0; this.b2 = 0; this.ha = 0; this.hb = 0; this.hc = 0; this.hk = 0; // SVF B
        this.lp = 0; this.lg = 0; this.na = 0;           // a TPT 1-pole's state and G; a noise path's amplitude
        this.dOn = false; this.dg = 0; this.dK = 0; this.dN = 0; this.xp = 0; this.Fp = 0; // the drive (ADAA1)
        this.ph = new Float64Array(6); this.pi = new Float64Array(6); this.h0 = this.h1 = this.h2 = this.h3 = 0; // the hat's squares: phases, increments, the BLEP's delay
        this.bn = 0; this.bi = 0; this.cn = 0; this.sN = 0; this.uN = 0; this.be = 0; this.te = 0; this.kb = 0; this.kt = 0; this.ui = 0; // the clap
        this.va = 0; this.vb = 0; this.vn = 0; this.vm = 0; this.da = 0; this.db = 0; this.nS = 0; // the perc's strikes (impulse doublets, noise) per mode, the doublets' spacings, the strike's length
        this.nu = 0;                                     // the perc's burst: its noise's Hann-weighted mean (taken at the strike)
        this.etr = tr > 0 ? new Float64Array(tr) : null;
      }
      zero() {
        this.e1 = this.e2 = this.ra = 0; this.x1 = this.y1 = this.x2 = this.y2 = 0; this.sw = 0; this.sweep = false;
        this.a1 = this.a2 = this.b1 = this.b2 = this.lp = 0; this.xp = this.Fp = 0; this.be = this.te = 0; this.cn = this.bi = 0;
        this.ph.fill(0); this.h0 = this.h1 = this.h2 = this.h3 = 0; this.fd = -1;
      }
    }

    function create(inst, kind, opt) {
      if (kind !== 'kit') return null;
      const o = opt || {};
      const base = inst && inst.base > 0 ? inst.base : (typeof sampleRate === 'number' ? sampleRate : 48000);
      const M = {
        base, OS: 1, fs: base, CH: 4, sig: 1, drum: null, dv: null, hold: !!o.hold,
        seed: KIT_SALT, ss: new Int32Array(16), lat: new Float64Array(16), latN: 0, lit: 0, act: new Float64Array(16),
        fadeN: 1, FADE: new Float64Array(Math.ceil(CHOKE_MS / 1000 * base * 8) + 4), tmp: new Float64Array(SPAN), n0: 0,
        kp: new Float64Array(4),
      };
      const V = []; for (let j = 0; j < 32; j++) V.push(new Voice(j, o.trace | 0));
      const SMP = []; for (let s = 0; s < 16; s++) SMP.push({ id: '', on: false });
      const MON = { lit: 0, act: new Float32Array(16) };

      // ---- the panel: slot s's field f (a KitP's array, a plain object's id, NaN without one)
      function val(s, f) { const i = 9 * s + f; return M.dv !== null ? M.dv[i] : M.drum !== null ? +M.drum[IDS[i]] : NaN; }
      const posOf = (x, L) => (fin(x) ? clamp(x, 0, 1) : L.def);
      function typeOf(s) { const x = Math.round(val(s, 0)); return x >= 1 && x <= 6 ? x : 0; }
      function chokeOf(s) { const x = Math.round(val(s, 4)); return x >= 1 && x <= 4 ? x : 0; }

      // ---- the rate: fs, the chunk, the noise density, the fade; every running instance rebuilt (its ages rescaled)
      function setRate(os) {
        const r = os / M.OS, oldN = M.fadeN;
        M.OS = os; M.fs = base * os; M.CH = 4 * os; M.sig = Math.sqrt(M.fs / 48000);
        M.fadeN = Math.max(2, Math.round(CHOKE_MS / 1000 * M.fs));
        for (let i = 0; i < M.fadeN; i++) M.FADE[i] = 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / M.fadeN);
        for (const v of V) {
          if (!v.on || r === 1) continue;
          v.n = Math.round(v.n * r); v.cn = Math.round(v.cn * r);
          if (v.fd >= 0) v.fd = Math.min(M.fadeN - 1, Math.round(v.fd * M.fadeN / oldN));
          prep(v);
        }
      }

      // ---- a hit: the slot's panel read now → the instance's laws (rate-free), its state at rest, then its coefficients
      function fire(v, s, t, vel) {
        const T = TYPES[t], kp = M.kp, bo = LAW.vBright * (vel - 100) / 127;
        v.zero();
        v.on = true; v.s = s; v.t = t; v.cg = chokeOf(s); v.v = vel; v.n = 0; v.fd = -1;
        const u = posOf(val(s, 1), T.u), d = posOf(val(s, 2), T.d), l = posOf(val(s, 3), { def: LAW.lRef });
        for (let i = 0; i < 4; i++) kp[i] = posOf(val(s, 5 + i), T.k[i]);
        kp[T.bright] = clamp(kp[T.bright] + bo, 0, 1);
        v.f = lawVal(T.u, u); v.T = lawVal(T.d, d);
        v.q1 = lawVal(T.k[0], kp[0]); v.q2 = lawVal(T.k[1], kp[1]); v.q3 = lawVal(T.k[2], kp[2]); v.q4 = lawVal(T.k[3], kp[3]); v.dp = kp[3];
        v.g = Math.pow(vel / 127, LAW.vPow) * (l / LAW.lRef) * (l / LAW.lRef) * OUT * TRIM[t];
        v.x1 = v.x2 = 1; v.e1 = v.e2 = 1; v.ra = 0; v.be = v.te = 0;
        if (t === 3) for (let i = 0; i < 6; i++) v.ph[i] = i / 6;   // (the squares' starting phases: their edges spread)
        if (v.etr !== null) v.etr.fill(0);
        prep(v);
        M.lit |= 1 << s;
      }
      const ceilCH = x => Math.ceil(x / M.CH) * M.CH;
      const t60k = T60 => (M.hold ? 1 : Math.pow(10, -3 / (T60 * M.fs)));
      const endOf = T60 => (M.hold ? Infinity : ceilCH(5 / 3 * T60 * M.fs) + LAW.sleepChunks * M.CH);   // −100 dB + 4 chunks
      // SVF coefficients (TPT, prewarped at fc, damping k = 1 / Q) into the instance's set A or B
      function svfA(v, fc, k) { const g = Math.tan(Math.PI * Math.min(fc, 0.45 * M.fs) / M.fs), a = 1 / (1 + g * (g + k)); v.ga = a; v.gb = g * a; v.gc = g * g * a; v.gk = k; }
      function svfB(v, fc, k) { const g = Math.tan(Math.PI * Math.min(fc, 0.45 * M.fs) / M.fs), a = 1 / (1 + g * (g + k)); v.ha = a; v.hb = g * a; v.hc = g * g * a; v.hk = k; }
      const g1 = fc => { const g = Math.tan(Math.PI * Math.min(fc, 0.45 * M.fs) / M.fs); return g / (1 + g); };
      // the rate-dependent coefficients of an instance from its laws and its age (fire, setOS)
      function prep(v) {
        const fs = M.fs, CH = M.CH, n = v.n, T = TYPES, mid = (Math.floor(n / CH) * CH + CH / 2) / fs; // (the current chunk's middle, s)
        v.ri = 1 / Math.max(1, LAW.att * fs);
        switch (v.t) {
          case 1: { // Kick: f, T60, r (PUNCH), τ (SWEEP), the click's peak (CLICK), the drive's g (DRIVE)
            v.k1 = t60k(v.T); v.w1 = TAU * v.f / fs;
            v.sweep = v.q1 > 1; v.ks = Math.exp(-CH / (v.q2 * fs)); v.sw = (v.q1 - 1) * Math.exp(-mid / v.q2);
            cs(v.w1 * (1 + v.sw)); v.c1 = RC[0]; v.s1 = RC[1];
            v.cN = Math.round(T[1].blk.clickS * fs); v.ca = v.q3 * AB * M.sig; v.lg = g1(T[1].blk.clickHp);
            drive(v); v.nEnd = endOf(v.T);
            break;
          }
          case 5: { // Tom: f, T60, b (BEND st), τ (SWEEP), the burst's level (NOISE), the drive
            v.k1 = t60k(v.T); v.w1 = TAU * v.f / fs;
            v.sweep = v.q1 > 0; v.ks = Math.exp(-CH / (v.q2 * fs)); v.sw = (v.q1 / 12) * Math.exp(-mid / v.q2);
            cs(v.w1 * Math.exp(v.sw * LN2)); v.c1 = RC[0]; v.s1 = RC[1];
            const f0 = T[5].blk.noiseAt * v.f, Tn = T[5].blk.noiseT60 * v.T;
            svfA(v, f0, 1 / NB_Q.tom); v.k2 = t60k(Tn); v.na = v.q3 * AB * M.sig / bpPeak(f0, NB_Q.tom);
            v.nN = v.q3 > 0 ? endOf(Tn) : 0;
            drive(v); v.nEnd = endOf(v.T);
            break;
          }
          case 2: { // Snare: f, the body's T60, θ (TONE), the noise's high-pass (COLOR), its T60 (SNAP), the second mode (BODY)
            const B = T[2].blk;
            v.k1 = t60k(v.T); v.w1 = TAU * v.f / fs; v.w2 = B.ratio * v.w1;
            v.sweep = true; v.ks = Math.exp(-CH / (B.dropS * fs)); v.sw = B.drop * Math.exp(-mid / B.dropS);
            cs(v.w1 * (1 + v.sw)); v.c1 = RC[0]; v.s1 = RC[1]; cs(v.w2 * (1 + v.sw)); v.c2 = RC[0]; v.s2 = RC[1];
            svfA(v, v.q2, Math.SQRT2); v.k2 = t60k(v.q3); v.na = Math.sin(v.q1) * AB * NOISE_HP * M.sig;
            v.nN = endOf(v.q3); v.nEnd = Math.max(endOf(v.T), v.nN);
            break;
          }
          case 3: { // Hi-hat: f, T60, the high-pass (TONE), squares : noise (METAL), the band-pass's Q (RING), the ratios' spread
            const R = T[3].blk.ratios, sp = v.q4;
            for (let i = 0; i < 6; i++) v.pi[i] = v.f * (1 + (R[i] - 1) * sp) / fs;
            v.k1 = t60k(v.T); svfA(v, v.q1, Math.SQRT2); svfB(v, T[3].blk.bp * v.q1, 1 / v.q3);
            v.na = (1 - v.q2) * NOISE_HAT * M.sig; v.nEnd = endOf(v.T);
            break;
          }
          case 4: { // Clap: the band-pass f, the tail's T60, s (SPREAD), n (COUNT), the low-pass (TONE), the tail's level (TAIL)
            const B = T[4].blk;
            svfA(v, v.f, 1 / B.q); v.lg = g1(v.q3); v.na = AB * M.sig / bpPeak(v.f, B.q);
            v.sN = Math.max(1, Math.round(v.q1 * fs)); v.bn = v.q2 | 0; v.uN = Math.max(1, Math.round(B.upS * fs)); v.ui = 1 / v.uN;
            v.kb = M.hold ? 1 : Math.exp(-1 / (B.tauS * fs)); v.kt = t60k(v.T);
            v.nEnd = M.hold ? Infinity : ceilCH((v.bn - 1) * v.sN + Math.max(5 / 3 * v.T, LN1E5 * B.tauS) * fs) + LAW.sleepChunks * CH;
            break;
          }
          case 6: { // Perc: two resonators at f and f·RATIO (Q = π·f·T60 / ln 1000), TONE the second's level, CLICK impulse ↔ noise, BEND
            const B = T[6].blk, f2 = v.f * v.q1;
            v.sweep = v.q4 > 0; v.ks = Math.exp(-CH / (B.bendS * fs)); v.sw = (v.q4 / 12) * Math.exp(-mid / B.bendS);
            perc(v);
            // the strikes at the starting pitch (each response's peak ≈ 1): the impulse a doublet — +v at the hit, −v half a period later
            // (the low-pass tap's response stays at rest at both, and its DC is exactly 0) —, the noise a 1 ms Hann burst
            const b0 = Math.exp((v.q4 / 12) * LN2), c = v.q3;
            v.va = 0.5 * (1 - c) * fs / (TAU * v.f * b0); v.vb = 0.5 * (1 - c) * fs / (TAU * f2 * b0);
            v.da = Math.max(1, Math.round(fs / (2 * Math.min(v.f * b0, 0.45 * fs)))); v.db = Math.max(1, Math.round(fs / (2 * Math.min(f2 * b0, 0.45 * fs))));
            v.vn = c * KN * M.sig / (TAU * v.f * b0); v.vm = c * KN * M.sig / (TAU * f2 * b0);
            v.nN = Math.max(1, Math.round(B.burstS * fs)); v.nS = Math.max(v.nN, v.da + 1, v.db + 1);
            // the end: the slower mode's decay (an overdamped one decays slower than its T60)
            let sl = Infinity;
            for (const f of [v.f, f2]) { const w = TAU * Math.min(f, 0.45 * fs), z = LN1000 / (w * v.T); const r = z < 1 ? LN1000 / v.T : w * (z - Math.sqrt(z * z - 1)); if (r < sl) sl = r; }
            v.nEnd = M.hold ? Infinity : ceilCH(Math.max(LN1E5 / sl, 0.0015) * fs) + LAW.sleepChunks * CH;
            break;
          }
          default: v.nEnd = 0;
        }
      }
      // the drive's constants (Kick, Tom): bypassed at DRIVE 0 (|y − x| ≤ 2e-5 there: the identity)
      function drive(v) { const g = v.q4; v.dOn = v.dp > 0; v.dg = g; v.dK = AB / (g * Math.tanh(g * AB)); v.dN = AB / Math.tanh(g * AB); }
      // the Perc's two resonators at the current bend (per chunk while it bends)
      function perc(v) {
        const b = Math.exp(v.sw * LN2), f1 = v.f * b, f2 = v.f * v.q1 * b, fs = M.fs;
        svfA(v, f1, M.hold ? 0 : LN1000 / (Math.PI * Math.min(f1, 0.45 * fs) * v.T)); svfB(v, f2, M.hold ? 0 : LN1000 / (Math.PI * Math.min(f2, 0.45 * fs) * v.T));
      }
      // a chunk boundary of a sweeping instance: the next chunk's pitch
      function ctl(v) {
        v.sw *= v.ks;
        if (v.t === 6) { perc(v); if (v.sw < 1e-9) v.sweep = false; return; }
        if (v.t === 5) { cs(v.w1 * Math.exp(v.sw * LN2)); v.c1 = RC[0]; v.s1 = RC[1]; if (v.sw < 1e-9) v.sweep = false; return; }
        cs(v.w1 * (1 + v.sw)); v.c1 = RC[0]; v.s1 = RC[1];
        if (v.t === 2) { cs(v.w2 * (1 + v.sw)); v.c2 = RC[0]; v.s2 = RC[1]; }
        if (v.sw < 1e-9) v.sweep = false;
      }

      // ---- the segments: m samples of instance v into b[o…o + m) (its absolute noise index i0), with constant coefficients
      function segKick(v, b, o, m, i0, ss) {
        let x = v.x1, y = v.y1, e = v.e1, n = v.n, j = o;
        const c = v.c1, s = v.s1, k = v.k1, g = v.g, end = o + m;
        if (n < v.cN || v.dOn) {
          const cN = v.cN, ca = v.ca, lg = v.lg, dOn = v.dOn, dg = v.dg, dK = v.dK, dN = v.dN;
          let lp = v.lp, xp = v.xp, Fp = v.Fp;
          for (; j < end; j++, n++) {
            let xi = AB * y * e;
            if (n < cN) {
              const h = 0.5 - 0.5 * Math.cos(TAU * n / cN), u = hash(((i0 + j - o) | 0) ^ ss) * 4.656612873077393e-10 * h * ca;
              const hv = (u - lp) * lg, lo = hv + lp; lp = lo + hv; xi += u - lo;
            }
            let yo = xi;
            if (dOn) {
              const F = dK * lnch(dg * xi), dx = xi - xp;
              yo = dx > 1e-6 || dx < -1e-6 ? (F - Fp) / dx : dN * Math.tanh(dg * 0.5 * (xi + xp));
              xp = xi; Fp = F;
            }
            b[j] += yo * g;
            const xn = c * x - s * y; y = s * x + c * y; x = xn; e *= k;
          }
          v.lp = lp; v.xp = xp; v.Fp = Fp;
        } else {
          const G = AB * g;
          for (; j < end; j++) { b[j] += G * e * y; const xn = c * x - s * y; y = s * x + c * y; x = xn; e *= k; }
          n += m;
        }
        v.x1 = x; v.y1 = y; v.e1 = e; v.n = n;
      }
      function segTom(v, b, o, m, i0, ss) {
        let x = v.x1, y = v.y1, e = v.e1, n = v.n, j = o;
        const c = v.c1, s = v.s1, k = v.k1, g = v.g, end = o + m;
        if (n < v.nN || v.dOn) {
          const nN = v.nN, na = v.na, k2 = v.k2, ri = v.ri, ga = v.ga, gb = v.gb, gc = v.gc, gk = v.gk, dOn = v.dOn, dg = v.dg, dK = v.dK, dN = v.dN;
          let e2 = v.e2, ra = v.ra, a1 = v.a1, a2 = v.a2, xp = v.xp, Fp = v.Fp;
          for (; j < end; j++, n++) {
            let xi = AB * y * e;
            if (n < nN) {
              const u = hash(((i0 + j - o) | 0) ^ ss) * 4.656612873077393e-10 * na;
              const v3 = u - a2, v1 = ga * a1 + gb * v3, v2 = a2 + gb * a1 + gc * v3; a1 = 2 * v1 - a1; a2 = 2 * v2 - a2;
              ra += ri; if (ra > 1) ra = 1;
              xi += gk * v1 * e2 * ra; e2 *= k2;
            }
            let yo = xi;
            if (dOn) {
              const F = dK * lnch(dg * xi), dx = xi - xp;
              yo = dx > 1e-6 || dx < -1e-6 ? (F - Fp) / dx : dN * Math.tanh(dg * 0.5 * (xi + xp));
              xp = xi; Fp = F;
            }
            b[j] += yo * g;
            const xn = c * x - s * y; y = s * x + c * y; x = xn; e *= k;
          }
          v.e2 = e2; v.ra = ra; v.a1 = a1; v.a2 = a2; v.xp = xp; v.Fp = Fp;
        } else {
          const G = AB * g;
          for (; j < end; j++) { b[j] += G * e * y; const xn = c * x - s * y; y = s * x + c * y; x = xn; e *= k; }
          n += m;
        }
        v.x1 = x; v.y1 = y; v.e1 = e; v.n = n;
      }
      function segSnare(v, b, o, m, i0, ss) {
        let x = v.x1, y = v.y1, p = v.x2, q = v.y2, e = v.e1, n = v.n, j = o;
        const c = v.c1, s = v.s1, c2 = v.c2, s2 = v.s2, k = v.k1, g = v.g, end = o + m;
        const bd = v.q4, G = AB * Math.cos(v.q1) / (1 + bd) * g;
        if (n < v.nN) {
          const nN = v.nN, na = v.na * g, k2 = v.k2, ri = v.ri, ga = v.ga, gb = v.gb, gc = v.gc, gk = v.gk;
          let e2 = v.e2, ra = v.ra, a1 = v.a1, a2 = v.a2;
          for (; j < end && n < nN; j++, n++) {
            const u = hash(((i0 + j - o) | 0) ^ ss) * 4.656612873077393e-10;
            const v3 = u - a2, v1 = ga * a1 + gb * v3, v2 = a2 + gb * a1 + gc * v3; a1 = 2 * v1 - a1; a2 = 2 * v2 - a2;
            ra += ri; if (ra > 1) ra = 1;
            b[j] += G * e * (y + bd * q) + (u - gk * v1 - v2) * na * e2 * ra;
            const xn = c * x - s * y; y = s * x + c * y; x = xn;
            const pn = c2 * p - s2 * q; q = s2 * p + c2 * q; p = pn; e *= k; e2 *= k2;
          }
          v.e2 = e2; v.ra = ra; v.a1 = a1; v.a2 = a2;
        }
        for (; j < end; j++, n++) {
          b[j] += G * e * (y + bd * q);
          const xn = c * x - s * y; y = s * x + c * y; x = xn;
          const pn = c2 * p - s2 * q; q = s2 * p + c2 * q; p = pn; e *= k;
        }
        v.x1 = x; v.y1 = y; v.x2 = p; v.y2 = q; v.e1 = e; v.n = n;
      }
      // the hat: six squares (high for phase < ½) band-limited by the cubic B-spline's step (a 4-sample residual at each edge, the
      // squares' sum 2 samples late: h0 the sample out, h1–h3 the next three's corrections so far), + noise, through the two filters
      function segHat(v, b, o, m, i0, ss) {
        const P = v.ph, I = v.pi, k = v.k1, ri = v.ri, end = o + m, mt = v.q2 / 6, na = v.na;
        const ga = v.ga, gb = v.gb, gc = v.gc, gk = v.gk, ha = v.ha, hb = v.hb, hc = v.hc, hk = v.hk, G = AB * BUS_HAT * v.g;
        let e = v.e1, ra = v.ra, a1 = v.a1, a2 = v.a2, b1 = v.b1, b2 = v.b2, h0 = v.h0, h1 = v.h1, h2 = v.h2, h3 = v.h3;
        for (let j = o; j < end; j++) {
          h0 = h1; h1 = h2; h2 = h3; h3 = 0;
          for (let i = 0; i < 6; i++) {
            const d = I[i];
            let p = P[i] + d, A = 0, t = 0;
            if (p >= 1) { p -= 1; A = 2; t = p / d; } else if (p >= 0.5 && p - d < 0.5) { A = -2; t = (p - 0.5) / d; }
            P[i] = p;
            h2 += p < 0.5 ? 1 : -1;
            if (A !== 0) { bsp(t); h0 += A * BL[0]; h1 += A * BL[1]; h2 += A * BL[2]; h3 += A * BL[3]; }
          }
          const xi = mt * h0 + na * hash(((i0 + j - o) | 0) ^ ss) * 4.656612873077393e-10;
          const v3 = xi - a2, v1 = ga * a1 + gb * v3, v2 = a2 + gb * a1 + gc * v3; a1 = 2 * v1 - a1; a2 = 2 * v2 - a2;
          const w3 = xi - b2, w1 = ha * b1 + hb * w3, w2 = b2 + hb * b1 + hc * w3; b1 = 2 * w1 - b1; b2 = 2 * w2 - b2;
          ra += ri; if (ra > 1) ra = 1;
          b[j] += G * e * ra * ((xi - gk * v1 - v2) + hk * w1);
          e *= k;
        }
        v.e1 = e; v.ra = ra; v.a1 = a1; v.a2 = a2; v.b1 = b1; v.b2 = b2; v.h0 = h0; v.h1 = h1; v.h2 = h2; v.h3 = h3; v.n += m;
      }
      function segClap(v, b, o, m, i0, ss) {
        const end = o + m, ga = v.ga, gb = v.gb, gc = v.gc, gk = v.gk, lg = v.lg, na = v.na, G = v.g, kb = v.kb, kt = v.kt, uN = v.uN, ui = v.ui, sN = v.sN, last = v.bn - 1, tl = v.q4;
        const tr = v.etr;
        let a1 = v.a1, a2 = v.a2, lp = v.lp, be = v.be, te = v.te, cn = v.cn, bi = v.bi, n = v.n;
        for (let j = o; j < end; j++, n++) {
          if (cn === sN && bi < last) { bi++; cn = 0; }
          be *= kb; te *= kt;
          if (cn < uN) { const r = (cn + 1) * ui; if (r > be) be = r; if (bi === last && tl * r > te) te = tl * r; }
          cn++;
          const env = be > te ? be : te;
          if (tr !== null && n < tr.length) tr[n] = env;
          const u = hash(((i0 + j - o) | 0) ^ ss) * 4.656612873077393e-10 * na;
          const v3 = u - a2, v1 = ga * a1 + gb * v3, v2 = a2 + gb * a1 + gc * v3; a1 = 2 * v1 - a1; a2 = 2 * v2 - a2;
          const bp = gk * v1, hv = (bp - lp) * lg, lo = hv + lp; lp = lo + hv;
          b[j] += G * env * lo;
        }
        v.a1 = a1; v.a2 = a2; v.lp = lp; v.be = be; v.te = te; v.cn = cn; v.bi = bi; v.n = n;
      }
      function segPerc(v, b, o, m, i0, ss) {
        const end = o + m, ga = v.ga, gb = v.gb, gc = v.gc, ha = v.ha, hb = v.hb, hc = v.hc, t2 = v.q2, G = AB * v.g / (1 + t2);
        let a1 = v.a1, a2 = v.a2, b1 = v.b1, b2 = v.b2, n = v.n, j = o;
        if (n < v.nS) { // the strike: the impulse doublets, the 1 ms Hann noise burst
          const nN = v.nN, nS = v.nS, da = v.da, db = v.db;
          // (the low-pass taps pass DC at gain 1: the burst's own mean would stay as a step's area — 1.6e-3 of DC over a T60 at v 127.
          // At the strike's first sample (j = o) its noise's Hann-weighted mean, from the same absolute indices, is taken off: Σ in = 0)
          if (n === 0) {
            let su = 0, sh = 0;
            for (let k = 0; k < nN; k++) { const h = 0.5 - 0.5 * Math.cos(TAU * k / nN); su += hash(((i0 + k) | 0) ^ ss) * 4.656612873077393e-10 * h; sh += h; }
            v.nu = sh > 0 ? su / sh : 0;
          }
          const nu = v.nu;
          for (; j < end && n < nS; j++, n++) {
            const u = n < nN ? (hash(((i0 + j - o) | 0) ^ ss) * 4.656612873077393e-10 - nu) * (0.5 - 0.5 * Math.cos(TAU * n / nN)) : 0;
            const xa = (n === 0 ? v.va : n === da ? -v.va : 0) + u * v.vn, xb = (n === 0 ? v.vb : n === db ? -v.vb : 0) + u * v.vm;
            const v3 = xa - a2, v1 = ga * a1 + gb * v3, v2 = a2 + gb * a1 + gc * v3; a1 = 2 * v1 - a1; a2 = 2 * v2 - a2;
            const w3 = xb - b2, w1 = ha * b1 + hb * w3, w2 = b2 + hb * b1 + hc * w3; b1 = 2 * w1 - b1; b2 = 2 * w2 - b2;
            b[j] += G * (v2 + t2 * w2);
          }
        }
        for (; j < end; j++, n++) { // ringing: the resonators' low-pass taps (at rest when struck: no step)
          const v1 = ga * a1 - gb * a2, v2 = a2 + gb * a1 - gc * a2; a1 = 2 * v1 - a1; a2 = 2 * v2 - a2;
          const w1 = ha * b1 - hb * b2, w2 = b2 + hb * b1 - hc * b2; b1 = 2 * w1 - b1; b2 = 2 * w2 - b2;
          b[j] += G * (v2 + t2 * w2);
        }
        v.a1 = a1; v.a2 = a2; v.b1 = b1; v.b2 = b2; v.n = n;
      }
      function seg(v, b, o, m, i0) {
        const ss = M.ss[v.s];
        switch (v.t) {
          case 1: segKick(v, b, o, m, i0, ss); break;
          case 2: segSnare(v, b, o, m, i0, ss); break;
          case 3: segHat(v, b, o, m, i0, ss); break;
          case 4: segClap(v, b, o, m, i0, ss); break;
          case 5: segTom(v, b, o, m, i0, ss); break;
          default: segPerc(v, b, o, m, i0, ss);
        }
      }
      function off(v) { v.on = false; v.zero(); }
      // an instance through the span: segments cut at its chunk boundaries (while it sweeps), its end and its fade's end
      function run(v, buf, N, n0) {
        const CH = M.CH, tmp = M.tmp, FADE = M.FADE;
        let i = 0;
        // (mon: the instance's level at the span's start — its gain under its main envelope — for the lamps)
        const lv = v.g * (M.hold ? 1 : Math.pow(10, -3 * v.n / (v.T * M.fs))) * (v.fd >= 0 ? FADE[v.fd] : 1);
        if (lv > M.act[v.s]) M.act[v.s] = lv;
        while (i < N) {
          if (v.n >= v.nEnd) { off(v); return; }
          let m = N - i;
          if (v.sweep) { if (v.n % CH === 0 && v.n > 0) ctl(v); if (v.sweep) { const r = CH - v.n % CH; if (r < m) m = r; } }
          if (v.nEnd - v.n < m) m = v.nEnd - v.n;
          if (v.fd >= 0) {
            if (M.fadeN - v.fd < m) m = M.fadeN - v.fd;
            if (m > tmp.length) m = tmp.length;
            tmp.fill(0, 0, m);
            seg(v, tmp, 0, m, n0 + i);
            const f0 = v.fd;
            for (let k = 0; k < m; k++) buf[i + k] += tmp[k] * FADE[f0 + k];
            v.fd += m; i += m;
            if (v.fd >= M.fadeN) { off(v); return; }
          } else { seg(v, buf, i, m, n0 + i); i += m; }
        }
        if (v.n >= v.nEnd) off(v);
      }

      // the latched hits, in slot order: every fade first (a retrigger's own slot, the choke groups — instances started before
      // this chunk), then the starts
      function apply() {
        const lat = M.lat;
        for (let s = 0; s < 16; s++) {
          if (!(lat[s] > 0)) continue;
          if (typeOf(s) === 0) { lat[s] = 0; continue; }   // (an empty slot: nothing)
          const cg = chokeOf(s);
          for (let k = 0; k < 32; k++) {
            const w = V[k];
            if (w.on && w.fd < 0 && (w.s === s || (cg > 0 && w.cg === cg))) w.fd = 0;
          }
        }
        for (let s = 0; s < 16; s++) {
          if (!(lat[s] > 0)) continue;
          const A = V[2 * s], B = V[2 * s + 1];
          let v = !A.on ? A : !B.on ? B : A.fd >= B.fd ? A : B;    // (both busy: the one further into its fade is cut)
          fire(v, s, typeOf(s), lat[s]);
        }
        lat.fill(0); M.latN = 0;
      }
      function anyOn() { for (let k = 0; k < 32; k++) if (V[k].on) return true; return false; }
      function latch(s, v) { if (v > M.lat[s]) M.lat[s] = v; M.latN = 1; }

      const DM = {
        VER,
        set(drum) { M.drum = drum && typeof drum === 'object' ? drum : null; const a = M.drum !== null ? M.drum.v : null; M.dv = a && a.length >= 144 && typeof a[0] === 'number' ? a : null; },
        setOS(os) { setRate(os > 0 ? os | 0 : 1); },
        hit(slot, v127) {
          const s = slot | 0;
          if (!(s >= 0 && s < 16) || slot !== slot) return;
          const v = +v127;
          if (!(v > 0)) return;
          latch(s, v < 127 ? v : 127);
        },
        trig(mask, vl, o) {
          const m = mask & 0xFFFF;
          if (m === 0) return;
          const at = o | 0, ok = !!vl && typeof vl.length === 'number' && o === at && at >= 0 && vl.length >= at + 16;
          for (let j = 0; j < 16; j++) {
            if (!((m >> j) & 1)) continue;
            const v = ok ? +vl[at + j] : 100;
            if (v > 0) latch(j, v < 127 ? v : 127);
          }
        },
        render(buf, N, F0) {
          const n0 = F0 * M.OS;
          M.n0 = n0;
          if (M.latN) apply();
          for (let k = 0; k < 32; k++) { const v = V[k]; if (v.on) run(v, buf, N, n0); }
        },
        poll(F0) {},
        post(L, R, mono, n) { for (let i = 0; i < n; i++) L[i] = R[i] = mono[i]; },
        live() { return M.latN === 1 || anyOn(); },
        reset() { for (const v of V) off(v); M.lat.fill(0); M.latN = 0; M.lit = 0; M.act.fill(0); },
        mon() {
          MON.lit = M.lit; M.lit = 0;
          for (let s = 0; s < 16; s++) MON.act[s] = M.act[s];
          M.act.fill(0);
          return MON;
        },
        smp(slots) {
          for (let s = 0; s < 16; s++) {
            const x = slots && slots[s], id = x && typeof x.id === 'string' ? x.id : '';
            SMP[s].id = id; SMP[s].on = !!(x && x.on && id);
          }
        },
        setSalt(s) {
          M.seed = (KIT_SALT ^ (s >>> 0)) >>> 0;
          for (let j = 0; j < 16; j++) M.ss[j] = hash((M.seed ^ Math.imul(j + 1, 0x9E3779B9)) | 0);
        },
        _M: M, _v: V, _smp: SMP, _mach: 'kit',
      };
      DM.setSalt(inst && inst.seedSalt ? inst.seedSalt : 0);
      setRate(inst && inst.OS > 0 ? inst.OS | 0 : 1);
      return DM;
    }

    globalThis.DrKit = Object.freeze({ VER, create, gain: () => 1, TYPES, LAW, CHOKE_MS, lawVal });
  } catch (err) {
    globalThis.DrKit = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('kit-dsp: load failed', err);
  }
})();
