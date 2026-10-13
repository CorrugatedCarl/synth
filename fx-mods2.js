/*
 * fx-mods2.js — the Serum 2 FX modules (classic script #10 of the SPEC-serum2 §0.3 list, no imports/exports). Owner F1.
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread (<script> injected by wk.loadDSP) and in node
 * vm contexts (tests/dsp-scope.mjs). The whole file is one IIFE that publishes the frozen `globalThis.FXMods2`; it can be
 * evaluated again in the same scope (a fresh object; nothing here must survive re-evaluation), and a failure inside
 * leaves FXMods2 = null without throwing (§0.3 "Failure ⇒": the instances it runs then pass their input). No other
 * script's global is read at load time: `SxBase` (FFT, shape, the asset store) is resolved in constructors / set() and
 * cached in fields, never looked up per sample; a missing SxBase costs one console.warn per scope.
 * Contract: SPEC-serum2 §11.11 (exports), §8.2 (Overdrive), §8.3 (Vintage, Nitrous, Basin), §8.4 (Bode, Convolve,
 * Utility, splitters), §8.5 / §14 (budgets), §3.16 (parameter tables, embedded identically with fx-core FXP_TAB), §4.5
 * (shaped-IR entries), §0.3 / §0.4 (script and code rules).
 *
 * M2 (this file): the recipes of §8.2–§8.4 behind the M1b signatures. fx-dsp's FXRack constructs these classes in set()
 * (lazily, from the FXMods2 it finds then) and drives them through the module protocol below.
 *
 * Exports
 *   VER 2
 *   TYPES        FXTYPES ids by S2 type id (FXP iType): fx-core FXTYPES order, the same list as FXDSP.TYPES
 *   TAB          {rev, bode, conv, util, split2, split3, splitms}: the S2 (v = 2) parameter tables of the types run
 *                here, frozen rows {pid, law, lo, hi, def[, nomod: true]} in table (= flat FX-context layout) order —
 *                equal to fx-core FXP_TAB[type][2] (tests/fx-mods2.test.mjs). `rev` is the whole S2 Reverb table
 *                (all five types share it; Plate / Hall run in fx-dsp)
 *   PIDX         {type: {pid: position in TAB[type]}}
 *   Bode, Convolve, Utility                    modules (protocol below)
 *   RevVintage, RevNitrous, RevBasin           S2 reverb tanks (module protocol; see "Reverb tanks")
 *   XoverLH, XoverLMH, MS                      splitter band builders (see "Splitters")
 *   Overdrive                                  Distortion S2 mode 16 staging around SxBase.shape(16, …) (see below)
 *
 * Module protocol (the Phase-1 module protocol of fx-dsp: FXRack drives a module through its instance's Unit `R`, whose
 * fields are n (table length), ev / en (Float64Array(n): eff values / eff n in TAB order, re-evaluated per 16-sample
 * block), bpm, keyF (setNote key factor), seedPh and, for Convolve, irId (FXP iIr) and convMax (FXP convMax, seconds)):
 *   new X(fs)               fs = the rack's base rate (the AudioContext rate); small state only, lines come from alloc()
 *   set(R) → boolean        rack set() (allocation allowed): validates the unit (R.n = the type's table length, R.ev and
 *                           R.en typed arrays with ≥ n values) and resolves lazy references; false ⇒ the rack keeps
 *                           the instance bypassed
 *   alloc()                 lines and pools (FXP iAlloc, or the first enable); allocation allowed
 *   reset()                 clears every state; no allocation
 *   upd(R)                  coefficients from R.ev / R.en (when dirty, at most once per 16-sample block)
 *   snap()                  ramped coefficients jump to their targets (first enable, re-seed)
 *   seed(p)                 LFO / oscillator phases to p ∈ [0, 1) (re-seed; Bode RETRIG at note-on: θ ← 2π·p)
 *   run(R, L, Rc, o, m)     in place over [o, o + m), m ≤ 16: the module's wet signal (MIX / LEVEL by the type's mix
 *                           kind, enable crossfades and ducks are the rack's, as for the Phase-1 modules)
 *   flush()                 denormal flush of the feedback states (once per process call)
 *   tail() → samples        longest write → echo gap of the module's lines (FXRack.idle())
 *   bytes() → bytes         typed-array bytes held by the instance (the 32 MB per-track cap, §8.5); an adopted
 *                           shaped-IR entry is not counted (it is an asset, §14.2)
 *   Convolve only (set-time sizing under the rack's cap): want() → tail FDL partitions needed (qWant), fdlDelta() →
 *                           bytes size() would add (< 0: release), size() resizes (allocation); release() frees the
 *                           slots of a dropped entry; fields short (an adopted entry waits for FDL), capped (rack: the
 *                           growth did not fit — bypassed)
 *   fields                  has (1 once alloc() ran), ir (delay-line input ramp, 0 → 1 over 5 ms after an enable; the
 *                           rack sets 0), ph (Bode: shifter phase θ/2π, reported by FXRack.phases(); NaN for the others),
 *                           latency (0: every module here is zero-latency, Convolve included)
 *
 * Bode (§8.4): Hilbert pair of two cascades of four second-order-in-z⁻¹ allpass sections y = c·(x + y[n−2]) − x[n−2] with
 *   c = a² for the listed a values (IMPL reading of "a² ∈ {…}": the listed numbers are the a of the classic design; used
 *   directly as c the pair is up to 13° off quadrature). The one-sample delay sits on the FIRST path (the only placement
 *   that gives quadrature with these sets: ±0.7° from 30 Hz to 20 kHz at 48 kHz; delaying the second path, as §8.4's
 *   parenthesis reads, gives −75° at 1 kHz and −15° at 5 kHz), and the second path leads it by 90°, so I = the second
 *   path, Q = the delayed first path (Q lags I by 90°) — the assignment for which §8.4's formulas up = I cos θ − Q sin θ
 *   shift UP by f (1 kHz + 100 Hz → 1100 Hz, image ≈ −49 dB; IMPL, deviation from the parenthesis noted in the M2
 *   report). The quadrature oscillator runs as a rotation per sample,
 *   re-anchored to θ every block. Delay line (2 s, BPM ladder ≤ 2 s) per channel at the line rate fs/ceil(fs/48000)
 *   (box-filter decimation, linear-interpolated reads; ≤ 0.77 MB at any rate), read position slewed ≤ 1 sample per
 *   sample. Delay time 0 = the delay section is off (no output, no feedback). BLUR: four allpasses (g 0.5) per channel in
 *   the feedback path, base delays BLUR_MS, modulated by blur·4 ms at 0.3 / 0.77 / 1.23 / 1.7 Hz (IMPL). Wet = DIR/WIDTH
 *   output + the delay output; the shifter input is x + 0.995·feed·blur(delay output), the line write bounded like the
 *   Phase-1 Delay's sat() (identity below |4|): FEEDBACK 100 % spirals for a long time but stays bounded (IMPL). Rates
 *   other than 48 kHz use a Hilbert pair designed for the same 43.6 Hz transition band (8 / 10 / 12 coefficients up to
 *   50 / 200 kHz / above; see hilDesign), so the quadrature band stays 30 Hz – 20 kHz at every rate.
 * Convolve (§8.4, §4.5): set(R) takes R.irId (the shaped-IR entry id `<ir id>@<rate>~<shapeKey>`, '' = none) and
 *   R.convMax; poll(live) (once per process call, live = 1: one epoch compare; set() and FXRack.assets() call it at
 *   configuration time, before the rack sizes the FDL) adopts the entry from SxBase as soon as it is stored;
 *   `ready` = 1 while an entry is adopted — until then the rack passes the instance's input (bypassed). adopt(e) takes
 *   the entry's buffers as they are (no copy, no FFT of the IR on the audio thread). Engine (zero latency): head = IR
 *   [0, 128) direct-form FIR per sample; middle = IR [128, 8192) as 63 uniform partitions of 128 (FFT 256, overlap-save)
 *   computed at every 128-frame boundary of the instance clock for the next 128 frames; tail = IR [8192, len) as
 *   partitions of 4096 (FFT 8192, overlap-save) whose result for 4096-block J + 2 is computed during block J + 1, spread
 *   over its 32 slices of 128 frames (slice 0 / 1: input FFT L / R, 2–29: spectral MACs, 30 / 31: inverse FFT L / R).
 *   Partition spectra are read in the layout of SxBase.FFT(n).rfwd (bins 0…n/2 of the partition zero-padded to n, unscaled
 *   e^{−2πijk/n}): B = n/2 + 1 values per partition; the full (B = n) and packed (B = n/2, im[0] = Nyquist) layouts that
 *   SxBase.storeAsset accepts are read too. The input spectra (frequency-domain delay lines, Float32) do not depend on
 *   the IR, so an IR change (new shape key) crossfades two IR slots over 20 ms from the next tail period (the incoming
 *   slot computes one tail period first; IRs without a tail start at the next 128 boundary); a newer entry replaces a
 *   warming one and waits behind a fading one. The tail FDL (Float32, ≈ 8 B per IR frame and channel; it counts toward
 *   the rack's 32 MB cap, the IR's own spectra do not) holds what the stored entry of irId and the slots in use need,
 *   each capped by convMax (FXP.convMax, §14.3 Q3: the tail partitions played are capped at once, no rebuild needed);
 *   a missing entry reserves nothing. The rack sizes it at set-time (set() / FXRack.assets(), under the cap: want(),
 *   fdlDelta(), size()); adoption never allocates — an entry longer than the FDL plays its tail up to the FDL (`short`)
 *   until the next sizing, grown partitions join at the next tail period. Only an adoption from process() (poll(1)) that
 *   outgrows the FDL is a real truncation and warns (once per scope); a configuration-time adoption is sized by the rack
 *   right after it (an over-cap instance is bypassed and listed in the rack's `over` instead). The input spectra are written whenever the
 *   FDL exists (also while no slot has a tail), so an IR adopted later never convolves stale input. A dropped entry of
 *   irId (SxBase.dropAsset, §9.9) makes the instance not ready (the rack fades it out, then release() frees the slots);
 *   a superseded shape variant chosen again while it is rebuilt keeps playing (held). Pre-delay line (≤ 1 s, stereo,
 *   slewed) before the convolver; IR GAIN applied live (ramped per block).
 * Utility (§8.4): polarity → HPF (2-pole TPT, off at ≤ 1.01 Hz) → LPF (2-pole TPT, off at ≥ 19.9 kHz) → MONO BASS (LR4
 *   at FREQ, the low band summed to mono) → WIDTH (side × width) → PAN (Phase-1 equal-power balance √2·cos/sin((p+1)π/4)).
 *   Every stage at its neutral value is skipped (input passes bit-identically); width and pan gains ramp per block. A
 *   stage switching on or off (LPF below / above 19.9 kHz, HPF above / below 1.01 Hz, MONO BASS) crossfades over 5 ms
 *   (an engaging stage starts from cleared states; a disengaging one runs until faded out).
 *
 * Reverb tanks (§8.3): run() maps the pre-delayed reverb input (mono sum of L / R) to the tank's stereo wet output. The S2
 *   Reverb unit in fx-dsp owns the stages common to the five types (pre-delay, LOW CUT / HIGH CUT output filters, WIDTH)
 *   and runs Plate / Hall itself; Vintage, Nitrous and Basin read their own controls from the rev table (Nitrous / Basin
 *   also `hicut` for their in-loop low-pass, §8.3). All three share one pool: need() → Float32 floats at this rate for the
 *   largest SIZE, bind(buf) adopts a pool of ≥ need() floats (the unit's shared reverb pool, only one type runs at a
 *   time; binding resets), alloc() binds a pool of its own when none is bound. Lengths in samples at 48 kHz scale with
 *   fs/48000; CHORUS depths too. IMPL details beyond §8.3: Vintage injects the diffused input into the Hadamard FDN with
 *   signs (+, −, −, +), its outputs are the modulated line reads; Nitrous input allpasses [131, 293], in-loop allpasses
 *   [37, 43, 53, 61, 67, 73, 79, 89] (× the MODE scale), outputs Σ even / Σ odd lines with alternating signs; Basin chain
 *   A feeds lines 0 / 2, chain B lines 1 / 3 of a Hadamard FDN, L = lines 0 + 2, R = lines 1 + 3. Output trims
 *   (VIN_OUT, NIT_OUT, BAS_OUT) put every type's default wet level at the S2 Hall's (≈ −6 dB re dry on white noise).
 *   Vintage's ER tap times scale with 0.1 + 0.9·ersize (never all at zero delay). Nitrous: inside the S2 Reverb unit
 *   (auto 0) a MODE change is a topology change (ducked, tank cleared; nmode = installed, nwant = selected). Line
 *   capacities are computed once per rate (capsArr), so bind() (a TYPE change inside process()) allocates nothing.
 *
 * Splitters (§8.4): the splitter unit in fx-dsp keeps one band builder; split(L, R, o, m, …) reads the block
 *   [o, o + m) of L / R and writes band b into the branch buffers (index 0 … m − 1); the rack runs branch b's chain on
 *   band b and sums the branch outputs × LEVEL into L / R (M/S included: L = m₀ + s₀, R = m₁ + s₁ is that sum).
 *   XoverLH.set(f) / XoverLMH.set(f1, f2) take Hz (clamped to [10 Hz, 0.45·fs]; L/M/H keeps f2 ≥ 1.2·f1), once per
 *   block. LR4 = two cascaded 2-pole Butterworth TPT sections (k = √2, g = tan(π·fc/fs)) — the responses that
 *   FXDSP.splitResponse evaluates. L/H: LP4 + HP4 = AP2(f); L/M/H: the low band passes AP2(f2) so the three bands sum to
 *   AP2(f2)·AP2(f1) (allpass-flat).
 *
 * Overdrive (§8.2 mode 16; used by fx-dsp's Distortion S2 at its 2× shaper rate): new Overdrive(fs2), set(d, stages)
 *   (drive n ∈ [0, 1], stages 1–16), tick(c, x) → y for one 2×-rate sample of channel c (0 L, 1 R), run(c, X, o, n)
 *   the same in place over X[o, o + n). Recipe: u₀ = G·x, G = 0.5·10^d; stage j: u_j = LP₉ₖ(tanh(1.8·u_{j−1}) /
 *   tanh(1.8)) (one-pole low-pass at 9 kHz per stage); y = 0.9·u_N, with the stage curve taken from SxBase.shape(16, …)
 *   (the one copy of the shapers, §0.3): with shape(16, x, d) = 0.9·tanh(1.8·G·x)/tanh(1.8) (Overdrive at one stage, no
 *   low-pass), the scaled stage outputs w_j = 0.9·u_j obey w₁ = LP(shape(16, x, d)) and w_j = LP(shape(16, w_{j−1},
 *   OD_D1)) with OD_D1 = log10(2/0.9) (G = 1/0.9), and y = w_N. Two SxBase.Shaper objects hold the two drives (no
 *   coefficient recomputation per sample). Without SxBase the stage curve is the identity (the instance passes audio).
 *
 * Budgets (§8.5, base 192 kHz): Bode ≤ 1 MB, S2 reverb tanks ≤ 2 MB (one shared pool), Convolve: pre-delay, head
 * histories, FIFOs, the frequency-domain delay lines (Float32) and two IR slots' output buffers here (the tail FDL
 * sized by the rack from the stored entry and convMax), its partition spectra count as assets.
 */
(function () {
  'use strict';
  try {
    const exp = Math.exp, tan = Math.tan, floor = Math.floor, ceil = Math.ceil, round = Math.round, sin = Math.sin,
      cos = Math.cos, pow = Math.pow, sqrt = Math.sqrt, tanh = Math.tanh, PI = Math.PI;
    const TAU = 2 * PI, SQRT2 = Math.SQRT2;

    const VER = 2;
    const BLK = 16;                                            // the rack's coefficient block (m ≤ BLK in run)

    /* ------------------------------------------------------------ §3.16 catalogue (embedded copy of fx-core) */
    const TYPES = Object.freeze(['dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil', 'hyper', 'bode', 'conv', 'util',
      'split2', 'split3', 'splitms']);
    // rows [pid, law, lo, hi, def, nomod] → frozen {pid, law, lo, hi, def[, nomod: true]}
    const tab = (rows) => Object.freeze(rows.map(([pid, law, lo, hi, def, nm]) => Object.freeze(nm
      ? { pid, law, lo, hi, def, nomod: true } : { pid, law, lo, hi, def })));
    const ON = ['on', 'bool', 0, 1, 1], LVL = ['level', 'pow2', 0, 4, 0.5];
    const pct = (pid, def) => [pid, 'lin', 0, 1, def];
    const lad = (pid) => [pid, 'enum', 0, 11, 7 / 11];
    const bool = (pid, def) => [pid, 'bool', 0, 1, def];
    const TAB = Object.freeze({
      rev: tab([ON, ['type', 'enum', 0, 4, 0], pct('size', 0.5), ['pre', 'pow3', 0, 2500, 0], bool('prebpm', 0), lad('prelad'),
        pct('locut', 0), pct('hicut', 0.3), pct('damp', 0.5), pct('width', 1), pct('decay', 0.3), pct('spinr', 0.25), pct('spind', 0.2),
        pct('ersize', 0.5), pct('diffa', 0.7), pct('diffb', 0.5), pct('chr', 0.2), pct('chd', 0.2), pct('feed', 0.6), pct('diff', 0.7),
        ['nmode', 'enum', 0, 4, 0], pct('mix', 0.3), LVL]),
      bode: tab([ON, bool('mono', 0), ['shift', 'lin', -1, 1, 0.5], ['range', 'exp', 0.1, 5000, 0.6384], ['dir', 'lin', -1, 1, 1],
        pct('width', 1), ['delay', 'pow2', 0, 2000, 0], bool('bpm', 0), lad('dlad'), pct('feed', 0), ['bal', 'lin', -1, 1, 0.5],
        pct('blur', 0), bool('retrig', 0), pct('mix', 1), LVL]),
      conv: tab([ON, ['size', 'exp', 0.1, 10, 0.5, 1], ['tone', 'lin', -1, 1, 0.5, 1], ['minph', 'bool', 0, 1, 0, 1],
        ['pre', 'pow2', 0, 1000, 0], bool('prebpm', 0), lad('prelad'), ['att', 'lin', 0, 1, 0, 1], ['dec', 'lin', 0, 1, 1, 1],
        ['damp', 'lin', 0, 1, 0, 1], ['irgain', 'lin', -48, 12, 0.5], pct('mix', 0.5), LVL]),
      util: tab([ON, bool('invL', 0), bool('invR', 0), ['lpf', 'exp', 50, 20000, 1], ['hpf', 'exp', 1, 400, 0], bool('mbass', 0),
        ['mfreq', 'exp', 20, 400, 0.5021], ['width', 'lin', 0, 8, 0.125], ['pan', 'lin', -1, 1, 0.5], pct('mix', 1), LVL]),
      split2: tab([ON, ['freq', 'exp', 30, 5800, 0.4374], LVL]),
      split3: tab([ON, ['freq1', 'exp', 30, 5800, 0.3604], ['freq2', 'exp', 30, 5800, 0.7978], LVL]),
      splitms: tab([ON, LVL]),
    });
    const PIDX = Object.freeze(Object.keys(TAB).reduce((o, t) => {
      const m = {};
      TAB[t].forEach((r, i) => { m[r.pid] = i; });
      o[t] = Object.freeze(m);
      return o;
    }, {}));
    const RV = PIDX.rev, BO = PIDX.bode, CV = PIDX.conv, UT = PIDX.util;
    const N_REV = TAB.rev.length, N_BODE = TAB.bode.length, N_CONV = TAB.conv.length, N_UTIL = TAB.util.length;

    /* ------------------------------------------------------------ recipe constants (§8.2–§8.4) */
    const DLY_BEATS = Float64Array.from([1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16]);   // DLY_LADDER
    const MAX_DLY = 2;                                         // Bode delay line (s; longer ladder values are clamped)
    // Bode Hilbert pair: the a of the four sections of each path (section coefficient c = a²); the first path one sample later
    const HIL_A = Float64Array.from([0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737]);
    const HIL_B = Float64Array.from([0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278]);
    const HIL_CA = HIL_A.map((a) => a * a), HIL_CB = HIL_B.map((a) => a * a);
    // other rates (IMPL): the listed pair is the 8-coefficient elliptic polyphase-allpass Hilbert design with a transition
    // band of HIL_TBW Hz at 48 kHz (the closed form below reproduces it within 2e-6); at any other rate the pair is
    // designed for the same transition in Hz, with 8 coefficients up to 50 kHz, 10 up to 200 kHz, 12 above (the order
    // keeps the quadrature error ≤ the 48 kHz set's 0.7° over 30 Hz – 20 kHz). Coefficients sorted ascending: even
    // indices → the I path, odd → the Q path (one sample later). 48 kHz: the listed values exactly
    const HIL_TBW = 43.558187364964866, HIL_MAXS = 6;
    function hilDesign(fs, ca, cb) {
      if (fs === 48000) { ca.set(HIL_CA); cb.set(HIL_CB); return 4; }
      const n = fs <= 50000 ? 8 : fs <= 200000 ? 10 : 12, tbw = HIL_TBW / fs;
      let k = tan((1 - 2 * tbw) * PI / 4);
      k *= k;
      const kk = pow(1 - k * k, 0.25), e = 0.5 * (1 - kk) / (1 + kk), e4 = e * e * e * e;
      const q = e * (1 + e4 * (2 + e4 * (15 + 150 * e4))), ord = 2 * n + 1;
      for (let i = 0; i < n; i++) {
        const c = i + 1;
        let num = 0, den = 0.5;
        for (let j = 0, sg = 1; j < 40; j++, sg = -sg) { const v = pow(q, j * (j + 1)) * sin((2 * j + 1) * c * PI / ord) * sg; num += v; if (v < 1e-100 && v > -1e-100) break; }
        for (let j = 1, sg = -1; j < 40; j++, sg = -sg) { const v = pow(q, j * j) * cos(2 * j * c * PI / ord) * sg; den += v; if (v < 1e-100 && v > -1e-100) break; }
        const ww = num * pow(q, 0.25) / den, w2 = ww * ww, x = sqrt((1 - w2 * k) * (1 - w2 / k)) / (1 + w2), co = (1 - x) / (1 + x);
        if ((i & 1) === 0) cb[i >> 1] = co; else ca[i >> 1] = co;
      }
      return n >> 1;
    }
    const BODE_FB = 0.995;                                     // loop gain at FEEDBACK 100 % (IMPL: the spiral decays slowly)
    // delay-line write bound (the Phase-1 Delay's sat(): identity below |4|, never beyond 5): the shifter can raise the
    // level of components outside its quadrature band, so the feedback loop is bounded explicitly
    const fbSat = (v) => (v > 4 ? 4 + tanh(v - 4) : v < -4 ? -4 - tanh(-4 - v) : v);
    const BLUR_MS = Float64Array.from([3.1, 4.3, 5.9, 7.7]), BLUR_HZ = Float64Array.from([0.3, 0.77, 1.23, 1.7]);
    // reverb tanks: delay lengths in samples at 48 kHz (scaled to the base rate and by the SIZE factor of §8.3)
    const VIN_DIF = Float64Array.from([142, 107, 379, 277]), VIN_FDN = Float64Array.from([1447, 1979, 2311, 2741]);
    const VIN_LAP = Float64Array.from([47, 59, 71, 83]);
    const VIN_INJ = Float64Array.from([0.5, -0.5, -0.5, 0.5]);
    const NIT_MODES = Object.freeze([[1123, 1439, 1777, 2063, 2399, 2803, 3121, 3517], [389, 433, 487, 523, 571, 619, 661, 709],
      [601, 613, 977, 991, 1607, 1621, 2593, 2609], [1009, 1013, 1019, 1021, 1031, 1033, 1039, 1049],
      [211, 263, 307, 353, 401, 449, 503, 557]].map((a) => Float64Array.from(a)));
    const NIT_MAX = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7].map((q) => Math.max(...NIT_MODES.map((a) => a[q]))));
    const NIT_IAP = Float64Array.from([131, 293]), NIT_LAP = Float64Array.from([37, 43, 53, 61, 67, 73, 79, 89]);
    const NIT_SG = Float64Array.from([1, 1, -1, -1, 1, -1, -1, 1]);
    const BAS_AP = Object.freeze([[113, 163, 229, 317, 421, 557, 733, 967], [131, 179, 251, 337, 449, 593, 787, 1031]]
      .map((a) => Float64Array.from(a)));
    const BAS_FDN = Float64Array.from([2203, 2689, 3253, 3851]);
    // output trims: every type's default wet level lands at the Hall level (≈ −6 dB re dry on white noise through the S2
    // Reverb unit's output filters, measured; tests/fx-dsp.test.mjs bounds each to the Hall ± 3 dB)
    const VIN_OUT = 0.55, NIT_OUT = 1.6, BAS_OUT = 1.58;
    // Vintage ER SIZE floor (IMPL on §8.3's ersize·(5 + 6.25j)… ms): at ER SIZE 0 the twelve taps would all sit at zero
    // delay (an in-phase +7 dB copy of the dry); the scale runs from ER_FLOOR (first tap 0.5 ms) to 1 instead
    const ER_FLOOR = 0.1;
    // Overdrive (§8.2): per-stage low-pass, output trim, the drive that gives the later stages G = 1/0.9 (see header)
    const OD_LP = 9000, OD_TRIM = 0.9, OD_D1 = Math.log10(2 / OD_TRIM), OD_MAXST = 16;
    // Convolve engine sizes
    const HN = 128, MN = 256, MB = 129, MP = 63, TB = 4096, TN = 8192, TBIN = 4097, TSL = 32;   // TSL = TB / HN slices
    const CONV_XF = 0.02;                                      // IR crossfade (s)

    /* ------------------------------------------------------------ helpers */
    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);   // NaN → 0
    const frac = (x) => { const f = x - floor(x); return f === f && f < 1 ? f : 0; };
    const isVec = (a, n) => !!a && ArrayBuffer.isView(a) && a.length >= n;
    // a Unit fits a table of n parameters
    const okUnit = (R, n) => !!R && typeof R === 'object' && R.n === n && isVec(R.ev, n) && isVec(R.en, n);
    const tb = (a) => (a && ArrayBuffer.isView(a) ? a.byteLength : 0);
    function silence(L, R, o, m) { for (let i = o, e = o + m; i < e; i++) { L[i] = 0; R[i] = 0; } }
    function flushArr(s) { for (let i = 0; i < s.length; i++) { const v = s[i]; if (v < 1e-30 && v > -1e-30) s[i] = 0; } }
    const flush1 = (v) => (v < 1e-30 && v > -1e-30 ? 0 : v);
    // crossover frequency: Hz in [10, 0.45·fs] (NaN → 10)
    const xoF = (f, fs) => { const hi = 0.45 * fs; f = +f; return f > 10 ? (f < hi ? f : hi) : 10; };
    // delay time (s) of a time / BPM-ladder pair, ≤ cap
    function dlyS(ms, bpmOn, lad, bpm, cap) {
      const s = bpmOn >= 0.5 ? DLY_BEATS[lad > 0 ? (lad < 11 ? round(lad) : 11) : 0] * 60 / (bpm > 0 ? bpm : 120) : 0.001 * ms;
      return s > 0 ? (s < cap ? s : cap) : 0;
    }
    // one-pole low-pass coefficient for f Hz (clamped to [5, 0.45·fs])
    const opK = (f, fs) => { const hi = 0.45 * fs; f = f > 5 ? (f < hi ? f : hi) : 5; return 1 - exp(-TAU * f / fs); };
    // TPT SVF coefficients (k = damping) into c[o…o+2] = a1, a2, a3 for f Hz (clamped to [5, 0.45·fs])
    function svfC(f, k, fs, c, o) {
      const hi = 0.45 * fs;
      f = f > 5 ? (f < hi ? f : hi) : 5;
      const g = tan(PI * f / fs), a1 = 1 / (1 + g * (g + k));
      c[o] = a1; c[o + 1] = g * a1; c[o + 2] = g * g * a1;
    }
    // TPT SVF tick on states s[o], s[o+1]; returns lp, leaves bp in SVO.bp (hp = x − k·bp − lp)
    const SVO = { bp: 0 };
    function svfT(s, o, x, a1, a2, a3) {
      const ic1 = s[o], ic2 = s[o + 1], v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      s[o] = 2 * v1 - ic1; s[o + 1] = 2 * v2 - ic2;
      SVO.bp = v1;
      return v2;
    }
    // ring read at fractional delay d ≥ 0 behind slot w (the current sample), ring P[o, o + c) (linear interpolation)
    function rdE(P, o, c, w, d) {
      const di = d | 0, fd = d - di;
      let i1 = w - di;
      if (i1 < 0) i1 += c;
      const b = P[o + i1];
      if (fd === 0) return b;
      return b + (P[o + (i1 === 0 ? c - 1 : i1 - 1)] - b) * fd;
    }
    let warnedBase = false;                                    // one console.warn per scope for a missing SxBase
    function base(what) {
      const B = globalThis.SxBase;
      if (B) return B;
      if (!warnedBase) {
        warnedBase = true;
        if (typeof console !== 'undefined') console.warn('fx-mods2: SxBase is not loaded; ' + what + ' passes its input');
      }
      return null;
    }
    let warnedTrunc = false;

    /* ------------------------------------------------------------ Bode frequency shifter (§8.4) */
    class Bode {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.has = 0; this.ir = 1; this.ist = 1 / (0.005 * this.fs); this.ph = 0; this.latency = 0;
        // Hilbert allpass states: 2 channels × 2 paths × 4 sections × (x[n−1], x[n−2], y[n−1], y[n−2]), + the one-sample
        // delays of the first path per channel at [64], [65]
        // Hilbert pair: ns sections per path (hilDesign), coefficients ca (Q path) / cb (I path); states per channel and
        // path ns × (x[n−1], x[n−2], y[n−1], y[n−2]), then the one-sample delays of the Q path at [16·ns], [16·ns + 1]
        this.ca = new Float64Array(HIL_MAXS); this.cb = new Float64Array(HIL_MAXS);
        this.ns = hilDesign(this.fs, this.ca, this.cb);
        this.hs = new Float64Array(16 * this.ns + 2);
        // delay line (alloc): per channel at the line rate fs/dec; slot `w` is being accumulated (c samples so far)
        this.dec = ceil(this.fs / 48000 - 1e-9); this.fl = this.fs / this.dec;
        this.lL = null; this.lR = null; this.cap = 0; this.w = 0; this.dc = 0; this.aL = 0; this.aR = 0;
        this.dd = 0; this.dt = 0; this.sl = 1 / (0.02 * this.fs);   // current / target read delay (base samples), slew
        this.dlo = (this.dec + 1) * 1.5 + 1;                    // shortest readable delay (base samples)
        // BLUR: 4 allpasses per channel (alloc), their LFO phases and per-block delays
        this.bl = null; this.bcap = 0; this.bw = 0;
        this.bph = new Float64Array(4); this.bd0 = new Float64Array(4); this.bd1 = new Float64Array(4);
        // quadrature oscillator: θ (cycles) = ph, rotation state per block
        this.qc = 1; this.qs = 0;
        // controls (upd)
        this.mono = 0; this.f = 0; this.dir = 1; this.width = 1; this.dly = 0; this.fb = 0; this.bal = 0; this.blur = 0; this.retrig = 0;
      }
      set(R) { return okUnit(R, N_BODE); }
      alloc() {
        if (this.has === 1) return;
        this.cap = ceil(MAX_DLY * this.fl) + 8;
        this.lL = new Float32Array(this.cap); this.lR = new Float32Array(this.cap);
        this.bcap = ceil((BLUR_MS[3] + 4 + 1) * this.fs / 1000) + 4;
        this.bl = new Float32Array(8 * this.bcap);
        this.has = 1;
      }
      reset() {
        this.hs.fill(0);
        if (this.lL) { this.lL.fill(0); this.lR.fill(0); }
        if (this.bl) this.bl.fill(0);
        this.w = 0; this.dc = 0; this.aL = 0; this.aR = 0; this.bw = 0; this.ir = 1;
        this.dd = this.dt;
      }
      upd(R) {
        const ev = R.ev;
        this.mono = ev[BO.mono]; this.f = ev[BO.shift] * ev[BO.range]; this.dir = ev[BO.dir]; this.width = ev[BO.width];
        const s = dlyS(ev[BO.delay], ev[BO.bpm], ev[BO.dlad], R.bpm, MAX_DLY);
        this.dly = s;
        let d = s * this.fs;
        const lo = this.dlo;                                     // the newest complete line sample, plus interpolation
        if (d > 0 && d < lo) d = lo;
        const hi = (this.cap - 4) * this.dec;
        this.dt = d < hi ? d : hi;
        this.fb = BODE_FB * ev[BO.feed]; this.bal = ev[BO.bal]; this.blur = ev[BO.blur]; this.retrig = ev[BO.retrig];
      }
      snap() { this.dd = this.dt; this.blurD(this.bd0); }
      seed(p) { this.ph = frac(+p); this.qc = cos(TAU * this.ph); this.qs = sin(TAU * this.ph); }
      // blur allpass delays (base samples) at the current LFO phases
      blurD(o) {
        const k = this.fs / 1000, dep = this.blur * 4;
        for (let q = 0; q < 4; q++) o[q] = (BLUR_MS[q] + dep * (0.5 + 0.5 * sin(TAU * this.bph[q]))) * k;
      }
      // one Hilbert pair step for channel c: → I, Q in HIL[0], HIL[1] (Q lags I by 90°)
      hil(c, x) {
        const s = this.hs, ns = this.ns, ba = 8 * ns * c, bb = ba + 4 * ns, ca = this.ca, cb = this.cb;
        let v = x;
        for (let j = 0; j < ns; j++) {
          const b = ba + 4 * j, y = ca[j] * (v + s[b + 3]) - s[b + 1];
          s[b + 1] = s[b]; s[b] = v; s[b + 3] = s[b + 2]; s[b + 2] = y; v = y;
        }
        const ia = 16 * ns + c, Q = s[ia];                     // first path, one sample later
        s[ia] = v;
        v = x;
        for (let j = 0; j < ns; j++) {
          const b = bb + 4 * j, y = cb[j] * (v + s[b + 3]) - s[b + 1];
          s[b + 1] = s[b]; s[b] = v; s[b + 3] = s[b + 2]; s[b + 2] = y; v = y;
        }
        HIL[0] = v; HIL[1] = Q;                                 // I = second path (leads Q by 90°)
      }
      run(R, L, Rc, o, m) {
        const fs = this.fs, inc = this.f / fs, dl = this.dly > 0 ? 1 : 0, mono = this.mono >= 0.5 ? 1 : 0;
        const dir = this.dir, w = this.width, wa = 0.5 * (1 + w), wb = 0.5 * (1 - w), b = this.bal, ba = 0.5 * (1 - b), bu = 0.5 * (1 + b);
        const fb = dl === 1 ? this.fb : 0, ist = this.ist, sl = this.sl, dt = this.dt, dec = this.dec, idec = 1 / dec, dlo = this.dlo;
        const lL = this.lL, lR = this.lR, cap = this.cap, blur = this.blur, bl = this.bl, bcap = this.bcap;
        // rotation per sample; the block end re-anchors θ (no drift)
        const cr = cos(TAU * inc), sr = sin(TAU * inc);
        let qc = this.qc, qs = this.qs, ir = this.ir, dd = this.dd, wl = this.w, dc = this.dc, aL = this.aL, aR = this.aR, bw = this.bw;
        const bd0 = this.bd0, bd1 = this.bd1;
        if (blur > 0) {
          for (let q = 0; q < 4; q++) this.bph[q] = frac(this.bph[q] + BLUR_HZ[q] * m / fs);
          this.blurD(bd1);
        }
        for (let j = 0; j < m; j++) {
          const i = o + j;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          let xl = L[i] * ir, xr = Rc[i] * ir;
          // delay output (line rate, linear interpolation at the slewed delay) → blur → feedback into the shifter input
          let yl = 0, yr = 0;
          if (dl === 1) {
            if (dd !== dt) {
              let st = (dt - dd) * sl;
              st = st > 1 ? 1 : st < -1 ? -1 : st;
              dd += st;
              if (dt - dd < 1e-6 && dd - dt < 1e-6) dd = dt;
            }
            const de = dd < dlo ? dlo : dd, p = (dc - de - 0.5 * (dec - 1)) * idec;   // line position re slot wl (≤ −1)
            yl = rdE(lL, 0, cap, wl, -p); yr = rdE(lR, 0, cap, wl, -p);
            if (fb !== 0) {
              let fl = yl, fr = yr;
              if (blur > 0) {
                const k = j + 1;
                for (let q = 0; q < 4; q++) {
                  const d = bd0[q] + (bd1[q] - bd0[q]) * k / m, oa = 2 * q * bcap, ob = oa + bcap;
                  let s = rdE(bl, oa, bcap, bw, d), u = fl - 0.5 * s;
                  bl[oa + bw] = u; fl = s + 0.5 * u;
                  s = rdE(bl, ob, bcap, bw, d); u = fr - 0.5 * s;
                  bl[ob + bw] = u; fr = s + 0.5 * u;
                }
                bw = bw + 1 === bcap ? 0 : bw + 1;
              }
              xl += fb * fl; xr += fb * fr;
            }
          }
          // shifters
          let uL, dL, uR, dR;
          if (mono === 1) {
            this.hil(0, 0.5 * (xl + xr));
            const I = HIL[0], Q = HIL[1];
            uL = I * qc - Q * qs; dL = I * qc + Q * qs; uR = uL; dR = dL;
          } else {
            this.hil(0, xl);
            let I = HIL[0], Q = HIL[1];
            uL = I * qc - Q * qs; dL = I * qc + Q * qs;
            this.hil(1, xr);
            I = HIL[0]; Q = HIL[1];
            uR = I * qc - Q * qs; dR = I * qc + Q * qs;
          }
          const t = qc * cr - qs * sr;
          qs = qs * cr + qc * sr; qc = t;
          // DIR, WIDTH
          const oL = dir >= 0 ? uL : (1 + dir) * uL - dir * dL, oR = dir <= 0 ? dR : (1 - dir) * dR + dir * uR;
          let zl = oL * wa + oR * wb, zr = oR * wa + oL * wb;
          // delay input (balance of the sidebands), decimated write
          aL += ba * dL + bu * uL; aR += ba * dR + bu * uR;
          if (++dc === dec) {
            lL[wl] = flush1(fbSat(aL * idec)); lR[wl] = flush1(fbSat(aR * idec));
            wl = wl + 1 === cap ? 0 : wl + 1;
            dc = 0; aL = 0; aR = 0;
          }
          if (dl === 1) { zl += yl; zr += yr; }
          L[i] = zl; Rc[i] = zr;
        }
        this.ph = frac(this.ph + inc * m);
        this.qc = cos(TAU * this.ph); this.qs = sin(TAU * this.ph);
        this.ir = ir; this.dd = dd; this.w = wl; this.dc = dc; this.aL = aL; this.aR = aR; this.bw = bw;
        if (blur > 0) for (let q = 0; q < 4; q++) bd0[q] = bd1[q];
      }
      flush() { flushArr(this.hs); }
      tail() { return this.dly > 0 ? this.dt + 2 * this.dec : 0; }
      bytes() { return tb(this.hs) + tb(this.ca) + tb(this.cb) + tb(this.lL) + tb(this.lR) + tb(this.bl) + tb(this.bph) + tb(this.bd0) + tb(this.bd1); }
    }
    const HIL = new Float64Array(2);

    /* ------------------------------------------------------------ Convolve (§8.4; shaped-IR entries §4.5) */
    // partition layout of a spectrum array set {n, re, im}: B values per partition (n/2 + 1, n or n/2 packed), or 0
    function layoutB(P, full) {
      if (!P || !(P.n >= 0) || !isVec(P.re, 0) || !isVec(P.im, 0) || P.re.length !== P.im.length) return 0;
      if (P.n === 0) return full / 2 + 1;
      const B = P.re.length / P.n;
      return B === full / 2 + 1 || B === full || B === full / 2 ? B : 0;
    }
    function okIr(e, fs) {
      if (!e || typeof e !== 'object' || e.kind !== 'ir' || e.rate !== fs || (e.ch !== 1 && e.ch !== 2) || !(e.len >= 1)) return false;
      if (!Array.isArray(e.head) || !Array.isArray(e.hp) || !Array.isArray(e.tp)) return false;
      for (let c = 0; c < e.ch; c++) {
        const hp = e.hp[c], tp = e.tp[c];
        if (!isVec(e.head[c], HN) || !hp || !tp || !isVec(hp.re, 0) || !isVec(hp.im, 0) || !isVec(tp.re, 0) || !isVec(tp.im, 0)) return false;
        if (layoutB(hp, MN) === 0 || layoutB(tp, TN) === 0 || hp.n > MP) return false;
      }
      return true;
    }
    // tail partitions needed for an IR of `len` frames
    const tailParts = (len) => (len > TN ? ceil((len - TN) / TB) : 0);
    // bytes of a tail FDL of q partitions (two Float32 arrays of 2 channels × q × 4097 bins)
    const fdlBytes = (q) => 16 * q * TBIN;
    // One IR slot: the adopted entry, its partition counts / layouts, and its output buffers (alloc). nTe = the tail
    // partitions it plays (the entry's, capped by convMax); nT = those in use (≤ the FDL capacity); nTn = nT from the next
    // tail period on (a change mid-period would split the period's MACs between two partition counts)
    class IrSlot {
      constructor() {
        this.e = null; this.ch = 1; this.nH = 0; this.nT = 0; this.nTe = 0; this.nTn = 0; this.bH = MB; this.bT = TBIN; this.len = 0;
        this.mo = null;                                         // middle output: 2 × 128 (the current 128 block)
        this.to = null;                                         // tail output: 2 buffers × 2 ch × 4096
        this.aR = null; this.aI = null;                         // tail accumulators: [ch] → Float64Array(4097)
        this.tOn = 0;                                           // 1 while this slot computes its tail
      }
      alloc() {
        if (this.mo) return;
        this.mo = new Float64Array(2 * HN); this.to = new Float64Array(4 * TB);
        this.aR = [new Float64Array(TBIN), new Float64Array(TBIN)]; this.aI = [new Float64Array(TBIN), new Float64Array(TBIN)];
      }
      take(e, qc, cap) {
        this.e = e; this.ch = e.ch; this.len = e.len;
        this.nH = e.hp[0].n; this.bH = layoutB(e.hp[0], MN);
        this.nTe = e.tp[0].n < cap ? e.tp[0].n : cap;
        this.nT = this.nTe < qc ? this.nTe : qc; this.nTn = this.nT; this.bT = layoutB(e.tp[0], TN);
        this.tOn = 0;
        this.clear();
      }
      // partitions in use for an FDL of qc partitions and the tail cap (convMax): fewer at once, more from the next period
      fit(qc, cap) {
        if (this.e === null) return;
        this.nTe = this.e.tp[0].n < cap ? this.e.tp[0].n : cap;
        const n = this.nTe < qc ? this.nTe : qc;
        this.nTn = n;
        if (n < this.nT || this.tOn === 0) this.nT = n;
      }
      clear() { if (this.mo) { this.mo.fill(0); this.to.fill(0); for (let c = 0; c < 2; c++) { this.aR[c].fill(0); this.aI[c].fill(0); } } }
      drop() { this.e = null; this.nH = 0; this.nT = 0; this.nTe = 0; this.nTn = 0; this.len = 0; this.tOn = 0; }
      bytes() { return this.mo ? tb(this.mo) + tb(this.to) + 4 * tb(this.aR[0]) : 0; }
    }
    class Convolve {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.has = 0; this.ir = 1; this.ist = 1 / (0.005 * this.fs); this.ph = NaN; this.latency = 0;
        this.B = null;                                          // SxBase (set)
        // irId: the entry the instance plays (FXP iIr); ent: the entry adopted for it (entId = its id) — null while it is
        // missing or after SxBase dropped it (ready 0: the rack bypasses the instance, then release() frees the slots)
        // held: ent is irId's entry but the store dropped it before the id became current again (a superseded shape
        // variant chosen again while it is rebuilt): it keeps playing, the drop is not a deletion
        this.irId = ''; this.ent = null; this.entId = ''; this.held = 0; this.ready = 0; this.ep = -1; this.convMax = 10;
        this.capQ = tailParts(ceil(10 * this.fs));              // tail partitions allowed by convMax (FXP, §14.3 Q3)
        this.qWant = 0; this.Qc = 0;                            // tail FDL capacity wanted (want) / allocated (partitions)
        this.short = 0;                                         // 1: an adopted entry needs more FDL than allocated
        this.capped = 0;                                        // rack: 1 while the FDL growth it needs does not fit the cap
        this.F1 = null; this.F2 = null;                         // SxBase.FFT(256), FFT(8192)
        this.S = [new IrSlot(), new IrSlot()];                  // IR slots
        this.cur = -1; this.nx = -1; this.xs = 0; this.xg = 0; this.xst = 1 / (CONV_XF * this.fs); this.pend = null;
        this.n = 0;                                             // instance clock (samples since reset)
        // buffers (alloc)
        this.hx = null; this.hp = 0;                            // head histories 2 × 256 (each sample at p and p + 128)
        this.mi = null;                                         // middle input segments [ch] → 256: [previous 128, current 128]
        this.mXr = null; this.mXi = null; this.mh = 0;          // middle FDL 2 × 63 × 129 (Float32), head slot
        this.ti = null;                                         // tail input rings 2 × 12288
        this.tXr = null; this.tXi = null; this.th = 0; this.tb = 0;   // tail FDL 2 × Qc × 4097, head slot; tail buffer in use
        this.sx = null; this.sr = null; this.si = null;         // scratch: 8192 time, 4097 bins
        this.pL = null; this.pR = null; this.pcap = 0; this.pw = 0;   // pre-delay line (alloc)
        this.pre = 0; this.pd = 0; this.psl = 1 / (0.02 * this.fs);
        this.g0 = 1; this.g1 = 1;                               // IR GAIN (linear), ramped per block
      }
      set(R) {
        if (!okUnit(R, N_CONV)) return false;
        const B = base('Convolve');
        this.B = B && typeof B.getAsset === 'function' && typeof B.FFT === 'function' ? B : null;
        const id = typeof R.irId === 'string' ? R.irId : '';
        const cm = R.convMax > 0 && R.convMax < 10 ? +R.convMax : 10;
        if (cm !== this.convMax) { this.convMax = cm; this.capQ = tailParts(ceil(cm * this.fs)); }
        if (id !== this.irId) {
          this.irId = id;
          if (id === '') { this.dropAll(); this.ready = 0; }
          this.held = this.ent !== null && this.entId === id && this.B !== null && this.B.getAsset(id) === null ? 1 : 0;
        }
        this.ep = -1;                                           // re-read the store (an entry may have been dropped)
        for (let k = 0; k < 2; k++) this.S[k].fit(this.Qc, this.capQ);
        this.want();
        this.poll();
        return true;
      }
      // the tail FDL capacity the instance needs (qWant, partitions): the stored entry of irId and the slots in use, each
      // capped by convMax. A missing entry reserves nothing (§8.5: the FDL is sized when the entry is stored — the rack's
      // next set() or assets()); the rack compares fdlDelta() with its 32 MB cap and calls size() (allocation)
      want() {
        let q = 0;
        const e = this.B !== null && this.irId !== '' ? this.B.getAsset(this.irId) : null;
        if (e !== null && okIr(e, this.fs)) q = e.tp[0].n < this.capQ ? e.tp[0].n : this.capQ;
        for (let k = 0; k < 2; k++) { const s = this.S[k]; if (s.e !== null && s.nTe > q) q = s.nTe; }
        this.qWant = q;
        return q;
      }
      fdlDelta() { return fdlBytes(this.qWant) - fdlBytes(this.Qc); }
      // sizes the tail FDL to qWant partitions (allocation: set-time only — the rack's set() / assets() / alloc()); the
      // newest min(old, new) partitions are kept in ring order; the slots then use up to the new capacity (from the next
      // tail period when they grow)
      size() {
        const q = this.qWant;
        if (q !== this.Qc || this.tXr === null) {
          const nr = new Float32Array(2 * q * TBIN), ni = new Float32Array(2 * q * TBIN), Q0 = this.Qc, keep = Q0 < q ? Q0 : q;
          if (this.tXr && keep > 0) {
            for (let c = 0; c < 2; c++) {
              for (let k = 0; k < keep; k++) {                   // newest first: slot th − k → k' = keep − 1 − k (ring order kept)
                const from = c * Q0 * TBIN + ((this.th - k + Q0) % Q0) * TBIN, to = c * q * TBIN + (keep - 1 - k) * TBIN;
                nr.set(this.tXr.subarray(from, from + TBIN), to); ni.set(this.tXi.subarray(from, from + TBIN), to);
              }
            }
            this.th = keep > 0 ? keep - 1 : 0;
          } else this.th = 0;
          this.tXr = nr; this.tXi = ni; this.Qc = q;
        }
        let sh = 0;
        for (let k = 0; k < 2; k++) { const s = this.S[k]; s.fit(q, this.capQ); if (s.e !== null && s.nTe > q) sh = 1; }
        this.short = sh;
      }
      // once per process call (live = 1): adopts the entry as soon as SxBase holds it, notices when the adopted entry of
      // irId was dropped (§9.9: a deleted IR bypasses the instance; one epoch compare while nothing changes). No
      // allocation: an entry longer than the FDL plays its tail up to the FDL (`short`) until the rack re-sizes it. set()
      // and the rack's assets() call it at configuration time (live falsy), where the rack's sizing follows at once
      poll(live = 0) {
        if (this.irId === '') return this.ready === 1;
        const B = this.B;
        if (B === null) return false;
        const ep = B.epoch;
        if (ep === this.ep) return this.ready === 1;
        this.ep = ep;
        const e = B.getAsset(this.irId);
        if (e !== null) { if (e !== this.ent && okIr(e, this.fs)) this.adopt(e, live === 1 ? 1 : 0); } else if (this.ent !== null && this.entId === this.irId && this.held === 0) this.lost();
        return this.ready === 1;
      }
      adopt(e, live = 0) {
        this.ent = e; this.entId = this.irId; this.held = 0;
        const cap = this.capQ;
        let k = -1;
        if (this.cur < 0 || this.S[this.cur].e === null) {         // nothing playing: take it at once
          k = this.cur < 0 ? 0 : this.cur;
          this.S[k].take(e, this.Qc, cap);
          this.cur = k; this.nx = -1; this.xs = 0; this.pend = null;
        } else if (this.xs === 2) this.pend = e;                    // a crossfade runs: next in line
        else {
          k = this.cur === 0 ? 1 : 0;
          this.S[k].take(e, this.Qc, cap);
          this.nx = k; this.xs = 1;
        }
        const need = e.tp[0].n < cap ? e.tp[0].n : cap;
        if (need > this.Qc) {
          this.short = 1;
          if (live === 1 && !warnedTrunc) { warnedTrunc = true; if (typeof console !== 'undefined') console.warn('fx-mods2: Convolve IR arrived after set(); its tail is shortened until the rack sizes the delay lines (FXRack.assets() / set())'); }
        }
        this.ready = 1;
      }
      // the adopted entry of irId was dropped from SxBase: not ready (the rack fades the instance out), slots kept until
      // release() (the fade still plays them); an entry stored again under the id is adopted as usual
      lost() { this.ent = null; this.entId = ''; this.pend = null; this.ready = 0; }
      // rack: the instance stopped while not ready — the slots let go of the dropped entry's buffers
      release() { if (this.ready === 0 && this.cur >= 0) this.dropAll(); }
      dropAll() { this.S[0].drop(); this.S[1].drop(); this.cur = -1; this.nx = -1; this.xs = 0; this.pend = null; this.ent = null; this.entId = ''; this.held = 0; this.short = 0; }
      alloc() {
        if (this.has === 1) return;
        const B = this.B;
        if (B === null) return;
        this.F1 = new B.FFT(MN); this.F2 = new B.FFT(TN);
        this.hx = new Float64Array(4 * HN); this.mi = [new Float64Array(MN), new Float64Array(MN)];
        this.mXr = new Float32Array(2 * MP * MB); this.mXi = new Float32Array(2 * MP * MB);
        this.ti = new Float64Array(2 * 3 * TB);
        this.sx = new Float64Array(TN); this.sr = new Float64Array(TBIN); this.si = new Float64Array(TBIN);
        this.pcap = ceil(1 * this.fs) + 8; this.pL = new Float32Array(this.pcap); this.pR = new Float32Array(this.pcap);
        this.S[0].alloc(); this.S[1].alloc();
        this.size();
        this.has = 1;
        if (this.cur >= 0) this.S[this.cur].clear();
      }
      reset() {
        if (this.hx) {
          this.hx.fill(0); this.mi[0].fill(0); this.mi[1].fill(0); this.mXr.fill(0); this.mXi.fill(0); this.ti.fill(0);
          if (this.tXr) { this.tXr.fill(0); this.tXi.fill(0); }
          this.pL.fill(0); this.pR.fill(0);
        }
        this.hp = 0; this.mh = 0; this.th = 0; this.tb = 0; this.pw = 0; this.n = 0; this.ir = 1; this.pd = this.pre;
        if (this.xs !== 0) {                                     // a pending switch completes at once
          this.S[this.cur].drop(); this.cur = this.nx; this.nx = -1; this.xs = 0;
          if (this.pend !== null) { const e = this.pend; this.pend = null; this.S[this.cur === 0 ? 1 : 0].drop(); this.S[this.cur].take(e, this.Qc, this.capQ); }
        }
        for (let k = 0; k < 2; k++) { this.S[k].clear(); this.S[k].tOn = 0; }
        this.xg = 0;
      }
      upd(R) {
        const ev = R.ev;
        let s = dlyS(ev[CV.pre], ev[CV.prebpm], ev[CV.prelad], R.bpm, 1);
        s *= this.fs;
        const hi = this.pcap > 0 ? this.pcap - 4 : 0;
        this.pre = s < hi ? s : hi;
        this.g1 = exp(0.11512925464970229 * ev[CV.irgain]);   // 10^(dB/20)
      }
      snap() { this.pd = this.pre; this.g0 = this.g1; }
      seed(p) {}
      // head FIR of slot k, channel c at the history position p (taps over hx[p + 1 … p + 128])
      head(k, c) {
        const S = this.S[k], h = S.e.head[S.ch === 2 ? c : 0], hx = this.hx, b = c * 2 * HN + this.hp + HN;
        let y = 0;
        for (let t = 0; t < HN; t++) y += h[t] * hx[b - t];
        return y;
      }
      run(R, L, Rc, o, m) {
        if (this.cur < 0 || this.has !== 1) { silence(L, Rc, o, m); return; }
        const ist = this.ist, psl = this.psl, pcap = this.pcap, pL = this.pL, pR = this.pR, hx = this.hx, mi0 = this.mi[0], mi1 = this.mi[1], ti = this.ti;
        const g0 = this.g0, dg = (this.g1 - g0) / m;
        this.g0 = this.g1;
        let ir = this.ir, pd = this.pd, pw = this.pw;
        const pt = this.pre;
        for (let j = 0; j < m; j++) {
          const i = o + j;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          let xl = L[i] * ir, xr = Rc[i] * ir;
          // pre-delay (slewed read, linear interpolation)
          pL[pw] = xl; pR[pw] = xr;
          if (pd !== pt) {
            let st = (pt - pd) * psl;
            st = st > 1 ? 1 : st < -1 ? -1 : st;
            pd += st;
            if (pt - pd < 1e-6 && pd - pt < 1e-6) pd = pt;
          }
          if (pd > 0) { xl = rdE(pL, 0, pcap, pw, pd); xr = rdE(pR, 0, pcap, pw, pd); }
          pw = pw + 1 === pcap ? 0 : pw + 1;
          // input histories
          const n = this.n, hp = this.hp, q = n & (HN - 1), tq = n % (3 * TB);
          hx[hp] = xl; hx[hp + HN] = xl; hx[2 * HN + hp] = xr; hx[3 * HN + hp] = xr;
          mi0[HN + q] = xl; mi1[HN + q] = xr;
          ti[tq] = xl; ti[3 * TB + tq] = xr;
          // output = head + middle + tail of the slot(s)
          const tq4 = n & (TB - 1), tbo = this.tb * 2 * TB;
          const k = this.cur, S = this.S[k];
          let yl = this.head(k, 0) + S.mo[q], yr = this.head(k, 1) + S.mo[HN + q];
          if (S.nT > 0) { yl += S.to[tbo + tq4]; yr += S.to[tbo + TB + tq4]; }
          if (this.xs === 2) {
            const k2 = this.nx, S2 = this.S[k2];
            let zl = this.head(k2, 0) + S2.mo[q], zr = this.head(k2, 1) + S2.mo[HN + q];
            if (S2.nT > 0) { zl += S2.to[tbo + tq4]; zr += S2.to[tbo + TB + tq4]; }
            let x = this.xg + this.xst;
            if (x > 1) x = 1;
            this.xg = x;
            yl += x * (zl - yl); yr += x * (zr - yr);
          }
          const g = g0 + dg * (j + 1);
          L[i] = g * yl; Rc[i] = g * yr;
          this.hp = hp + 1 === HN ? 0 : hp + 1;
          this.n = n + 1;
          if (q === HN - 1) this.block();
          if (this.xs === 2 && this.xg >= 1) this.done();
        }
        this.ir = ir; this.pd = pd; this.pw = pw;
      }
      // the crossfade ended: the incoming slot plays; a waiting entry starts warming
      done() {
        this.S[this.cur].drop();
        this.cur = this.nx; this.nx = -1; this.xs = 0; this.xg = 0;
        if (this.pend !== null) {
          const e = this.pend, k = this.cur === 0 ? 1 : 0;
          this.pend = null;
          this.S[k].take(e, this.Qc, this.capQ);
          this.nx = k; this.xs = 1;
        }
      }
      // work at a 128-frame boundary (this.n is a multiple of 128): middle input spectra and outputs, one tail slice
      block() {
        const s = floor(this.n / HN) % TSL;
        if (s === 0) for (let k = 0; k < 2; k++) { const S = this.S[k]; if (S.nT !== S.nTn) S.nT = S.nTn; }   // grown partitions
        const hasT = this.S[this.cur].nT > 0 || (this.nx >= 0 && this.S[this.nx].nT > 0);
        if (s === 0) {
          this.tb ^= 1;                                         // the tail buffers computed last period play now
          if (this.xs === 1) {                                  // warming: computes its tail from now, fades in next period
            const S2 = this.S[this.nx];
            if (S2.tOn === 1 || !hasT) this.xs = 2; else S2.tOn = 1;
          }
          this.S[this.cur].tOn = 1;
        } else if (this.xs === 1 && !hasT) this.xs = 2;          // no tail on either side: fade from this block on
        // middle: input spectrum of [previous 128, current 128] per channel into the FDL head, outputs per slot
        const F = this.F1, mi = this.mi, sr = this.sr, si = this.si, sx = this.sx;
        this.mh = this.mh + 1 === MP ? 0 : this.mh + 1;
        for (let c = 0; c < 2; c++) {
          const x = mi[c];
          F.rfwd(x, sr, si);
          const xo = (c * MP + this.mh) * MB;
          for (let k = 0; k < MB; k++) { this.mXr[xo + k] = sr[k]; this.mXi[xo + k] = si[k]; }
          for (let k = 0; k < HN; k++) x[k] = x[HN + k];
        }
        this.mid(this.cur);
        if (this.xs === 2) this.mid(this.nx);
        // tail slice: the input spectra keep the FDL current whenever it exists (also while no slot plays a tail, so a
        // longer IR adopted later never reads input spectra from before an IR without a tail); MACs / IFFTs per slot
        const Qc = this.Qc;
        if (Qc === 0) return;
        if (s <= 1) {                                           // input FFT of block J (just completed) and J − 1
          const c = s, n0 = this.n - s * HN - 2 * TB, ti = this.ti, ob = c * 3 * TB;
          let p = ((n0 % (3 * TB)) + 3 * TB) % (3 * TB);
          for (let t = 0; t < TN; t++) { sx[t] = ti[ob + p]; p = p + 1 === 3 * TB ? 0 : p + 1; }
          this.F2.rfwd(sx, sr, si);
          if (c === 0) this.th = this.th + 1 >= Qc ? 0 : this.th + 1;
          const xo = (c * Qc + this.th) * TBIN, Xr = this.tXr, Xi = this.tXi;
          for (let k = 0; k < TBIN; k++) { Xr[xo + k] = sr[k]; Xi[xo + k] = si[k]; }
          return;
        }
        if (!hasT) return;
        for (let k = 0; k < 2; k++) {
          const S = this.S[k];
          if (S.tOn !== 1 || S.nT === 0 || S.e === null) continue;
          if (s <= 29) {
            const q0 = floor((s - 2) * S.nT / 28), q1 = floor((s - 1) * S.nT / 28);
            if (s === 2) for (let c = 0; c < 2; c++) { S.aR[c].fill(0); S.aI[c].fill(0); }
            for (let c = 0; c < 2; c++) this.mac(S, c, q0, q1);
          } else {
            const c = s - 30;
            this.F2.rinv(S.aR[c], S.aI[c], sx);
            const to = S.to, d = (this.tb ^ 1) * 2 * TB + c * TB;
            for (let t = 0; t < TB; t++) to[d + t] = sx[TB + t];
          }
        }
      }
      // middle output of slot k for the next 128 frames: Σ_p X[mh − p]·H_p → IFFT → [128, 256)
      mid(k) {
        const S = this.S[k];
        if (S.e === null) return;
        const sr = this.sr, si = this.si, sx = this.sx, nH = S.nH, B = S.bH, Xr = this.mXr, Xi = this.mXi;
        for (let c = 0; c < 2; c++) {
          for (let b = 0; b < MB; b++) { sr[b] = 0; si[b] = 0; }
          const H = S.e.hp[S.ch === 2 ? c : 0], Hr = H.re, Hi = H.im;
          for (let p = 0; p < nH; p++) {
            const xo = (c * MP + (this.mh - p + MP) % MP) * MB, ho = p * B;
            if (B === MN / 2) {                                 // packed: re[0] = DC, im[0] = Nyquist
              sr[0] += Xr[xo] * Hr[ho]; sr[HN] += Xr[xo + HN] * Hi[ho];
              for (let b = 1; b < HN; b++) {
                const xr = Xr[xo + b], xi = Xi[xo + b], hr = Hr[ho + b], hi = Hi[ho + b];
                sr[b] += xr * hr - xi * hi; si[b] += xr * hi + xi * hr;
              }
            } else {
              for (let b = 0; b < MB; b++) {
                const xr = Xr[xo + b], xi = Xi[xo + b], hr = Hr[ho + b], hi = Hi[ho + b];
                sr[b] += xr * hr - xi * hi; si[b] += xr * hi + xi * hr;
              }
            }
          }
          this.F1.rinv(sr, si, sx);
          const mo = S.mo, d = c * HN;
          for (let t = 0; t < HN; t++) mo[d + t] = sx[HN + t];
        }
      }
      // tail MACs of slot S, channel c, partitions [q0, q1): accumulators += X[th − q]·H_q
      mac(S, c, q0, q1) {
        const Qc = this.Qc, H = S.e.tp[S.ch === 2 ? c : 0], Hr = H.re, Hi = H.im, B = S.bT, Xr = this.tXr, Xi = this.tXi;
        const ar = S.aR[c], ai = S.aI[c], ab = 0;
        for (let q = q0; q < q1; q++) {
          const xo = (c * Qc + (this.th - q + Qc) % Qc) * TBIN, ho = q * B;
          if (B === TB) {
            ar[ab] += Xr[xo] * Hr[ho]; ar[ab + TB] += Xr[xo + TB] * Hi[ho];
            for (let k = 1; k < TB; k++) {
              const xr = Xr[xo + k], xi = Xi[xo + k], hr = Hr[ho + k], hi = Hi[ho + k];
              ar[ab + k] += xr * hr - xi * hi; ai[ab + k] += xr * hi + xi * hr;
            }
          } else {
            for (let k = 0; k < TBIN; k++) {
              const xr = Xr[xo + k], xi = Xi[xo + k], hr = Hr[ho + k], hi = Hi[ho + k];
              ar[ab + k] += xr * hr - xi * hi; ai[ab + k] += xr * hi + xi * hr;
            }
          }
        }
      }
      flush() {}
      tail() {
        let n = 0;
        for (let k = 0; k < 2; k++) {
          const S = this.S[k];
          if (S.e === null) continue;
          const l = S.len < TN + S.nT * TB ? S.len : TN + S.nT * TB;
          if (l > n) n = l;
        }
        return n + this.pre + TB;
      }
      bytes() {
        return tb(this.hx) + (this.mi ? 2 * tb(this.mi[0]) : 0) + tb(this.mXr) + tb(this.mXi) + tb(this.ti) + tb(this.tXr) + tb(this.tXi) + tb(this.sx)
          + tb(this.sr) + tb(this.si) + tb(this.pL) + tb(this.pR) + this.S[0].bytes() + this.S[1].bytes();
      }
    }

    /* ------------------------------------------------------------ Utility (§8.4) */
    const UT_LPOFF = 19900, UT_HPOFF = 1.01;
    class Utility {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.has = 0; this.ir = 1; this.ph = NaN; this.latency = 0;
        // states: HPF L/R [0–3], LPF L/R [4–7], MONO BASS per channel: SVF1, LP2, HP2 (6 each) [8–19]
        this.s = new Float64Array(20);
        this.c = new Float64Array(9);                           // HPF, LPF, MONO BASS SVF coefficients
        this.invL = 0; this.invR = 0; this.lpf = 20000; this.hpf = 1; this.mbass = 0; this.mfreq = 90; this.width = 1; this.pan = 0;
        this.lpOn = 0; this.hpOn = 0; this.mbOn = 0;            // stage targets (HPF, LPF, MONO BASS)
        // stage crossfades [HPF, LPF, MONO BASS]: 0 bypassed … 1 processing, 5 ms between them (an engaging stage starts
        // from cleared states, a disengaging one keeps running until it is faded out)
        this.g = new Float64Array(3); this.gst = 1 / (0.005 * this.fs);
        this.w0 = 1; this.w1 = 1; this.gL0 = 1; this.gL1 = 1; this.gR0 = 1; this.gR1 = 1;
      }
      set(R) { return okUnit(R, N_UTIL); }
      alloc() { this.has = 1; }
      reset() {
        this.s.fill(0); this.w0 = this.w1; this.gL0 = this.gL1; this.gR0 = this.gR1;
        this.g[0] = this.hpOn; this.g[1] = this.lpOn; this.g[2] = this.mbOn;
      }
      upd(R) {
        const ev = R.ev, fs = this.fs, c = this.c, g = this.g, s = this.s;
        this.invL = ev[UT.invL] >= 0.5 ? 1 : 0; this.invR = ev[UT.invR] >= 0.5 ? 1 : 0;
        this.lpf = ev[UT.lpf]; this.hpf = ev[UT.hpf]; this.mfreq = ev[UT.mfreq];
        const lp = this.lpf < UT_LPOFF ? 1 : 0, hp = this.hpf > UT_HPOFF ? 1 : 0, mb = ev[UT.mbass] >= 0.5 ? 1 : 0;
        if (hp === 1 && this.hpOn === 0 && g[0] === 0) { s[0] = 0; s[1] = 0; s[2] = 0; s[3] = 0; }
        if (lp === 1 && this.lpOn === 0 && g[1] === 0) { s[4] = 0; s[5] = 0; s[6] = 0; s[7] = 0; }
        if (mb === 1 && this.mbOn === 0 && g[2] === 0) for (let k = 8; k < 20; k++) s[k] = 0;
        this.lpOn = lp; this.hpOn = hp; this.mbOn = mb; this.mbass = mb;
        if (hp === 1 || g[0] > 0) svfC(this.hpf, SQRT2, fs, c, 0);
        if (lp === 1 || g[1] > 0) svfC(this.lpf, SQRT2, fs, c, 3);
        if (mb === 1 || g[2] > 0) svfC(this.mfreq, SQRT2, fs, c, 6);
        this.width = ev[UT.width]; this.w1 = this.width;
        const p = ev[UT.pan];
        this.pan = p;
        if (p === 0) { this.gL1 = 1; this.gR1 = 1; } else { const a = (p + 1) * PI / 4; this.gL1 = SQRT2 * cos(a); this.gR1 = SQRT2 * sin(a); }
      }
      snap() { this.w0 = this.w1; this.gL0 = this.gL1; this.gR0 = this.gR1; this.g[0] = this.hpOn; this.g[1] = this.lpOn; this.g[2] = this.mbOn; }
      seed(p) {}
      run(R, L, Rc, o, m) {
        const s = this.s, c = this.c, iL = this.invL, iR = this.invR, hp = this.hpOn, lp = this.lpOn, mb = this.mbOn, G = this.g, gst = this.gst;
        let gh = G[0], gl = G[1], gm = G[2];
        const rh = hp === 1 || gh > 0 ? 1 : 0, rl = lp === 1 || gl > 0 ? 1 : 0, rm = mb === 1 || gm > 0 ? 1 : 0;
        const w0 = this.w0, w1 = this.w1, l0 = this.gL0, l1 = this.gL1, r0 = this.gR0, r1 = this.gR1;
        const wOn = w0 !== 1 || w1 !== 1 ? 1 : 0, pOn = l0 !== 1 || l1 !== 1 || r0 !== 1 || r1 !== 1 ? 1 : 0;
        const dw = (w1 - w0) / m, dl = (l1 - l0) / m, dr = (r1 - r0) / m;
        this.w0 = w1; this.gL0 = l1; this.gR0 = r1;
        if (iL === 0 && iR === 0 && rh === 0 && rl === 0 && rm === 0 && wOn === 0 && pOn === 0) return;   // neutral: identity
        const sh = hp === 1 ? gst : -gst, sl = lp === 1 ? gst : -gst, sm = mb === 1 ? gst : -gst;
        for (let j = 0; j < m; j++) {
          const i = o + j;
          let l = L[i], r = Rc[i];
          if (iL === 1) l = -l;
          if (iR === 1) r = -r;
          if (rh === 1) {
            let v = svfT(s, 0, l, c[0], c[1], c[2]);
            const yl = l - SQRT2 * SVO.bp - v;
            v = svfT(s, 2, r, c[0], c[1], c[2]);
            const yr = r - SQRT2 * SVO.bp - v;
            if (gh === 1 && hp === 1) { l = yl; r = yr; } else {
              gh += sh; gh = gh > 1 ? 1 : gh < 0 ? 0 : gh;
              l += gh * (yl - l); r += gh * (yr - r);
            }
          }
          if (rl === 1) {
            const yl = svfT(s, 4, l, c[3], c[4], c[5]), yr = svfT(s, 6, r, c[3], c[4], c[5]);
            if (gl === 1 && lp === 1) { l = yl; r = yr; } else {
              gl += sl; gl = gl > 1 ? 1 : gl < 0 ? 0 : gl;
              l += gl * (yl - l); r += gl * (yr - r);
            }
          }
          if (rm === 1) {                                         // LR4 at FREQ; lows mono
            const a1 = c[6], a2 = c[7], a3 = c[8];
            let v = svfT(s, 8, l, a1, a2, a3), h = l - SQRT2 * SVO.bp - v;
            const loL = svfT(s, 10, v, a1, a2, a3);
            v = svfT(s, 12, h, a1, a2, a3);
            const hiL = h - SQRT2 * SVO.bp - v;
            v = svfT(s, 14, r, a1, a2, a3); h = r - SQRT2 * SVO.bp - v;
            const loR = svfT(s, 16, v, a1, a2, a3);
            v = svfT(s, 18, h, a1, a2, a3);
            const hiR = h - SQRT2 * SVO.bp - v, lo = 0.5 * (loL + loR);
            if (gm === 1 && mb === 1) { l = lo + hiL; r = lo + hiR; } else {
              gm += sm; gm = gm > 1 ? 1 : gm < 0 ? 0 : gm;
              l += gm * (lo + hiL - l); r += gm * (lo + hiR - r);
            }
          }
          if (wOn === 1) { const w = w0 + dw * (j + 1), md = 0.5 * (l + r), sd = 0.5 * (l - r) * w; l = md + sd; r = md - sd; }
          if (pOn === 1) { l *= l0 + dl * (j + 1); r *= r0 + dr * (j + 1); }
          L[i] = l; Rc[i] = r;
        }
        G[0] = gh; G[1] = gl; G[2] = gm;
      }
      flush() { flushArr(this.s); }
      tail() { return 0; }
      bytes() { return tb(this.s) + tb(this.c) + tb(this.g); }
    }

    /* ------------------------------------------------------------ S2 reverb tanks (§8.3) */
    // shared controls of the rev table read by every tank
    function revUpd(T, ev) {
      T.size = ev[RV.size]; T.decay = ev[RV.decay]; T.damp = ev[RV.damp]; T.hicut = ev[RV.hicut];
      T.chr = ev[RV.chr]; T.chd = ev[RV.chd];
    }
    // ring layout helper: lines with capacities → offsets (Int32Array) and total floats
    function layLines(caps, off) { let t = 0; for (let k = 0; k < caps.length; k++) { off[k] = t; t += caps[k]; } return t; }
    // Schroeder allpass on ring e of pool P at delay d (gain g): input x → output
    function ap(P, off, cap, wp, e, d, g, x) {
      const s = rdE(P, off[e], cap[e], wp[e], d), u = x + g * s;
      P[off[e] + wp[e]] = u;
      return s - g * u;
    }
    function adv(wp, cap, e0, e1) { for (let e = e0; e < e1; e++) wp[e] = wp[e] + 1 === cap[e] ? 0 : wp[e] + 1; }
    // tank base: pool binding, shared fields
    class Tank {
      constructor(fs, nl) {
        this.fs = fs > 0 ? +fs : 48000;
        this.has = 0; this.ir = 1; this.ist = 1 / (0.005 * this.fs); this.ph = NaN; this.latency = 0;
        this.buf = null; this.own = 0; this.used = 0;
        this.off = new Int32Array(nl); this.cap = new Int32Array(nl); this.wp = new Int32Array(nl);
        this.cph = 0; this.cr = 0.1; this.cd = 0;               // chorus phase, rate (Hz), depth (samples)
        this.size = 0.5; this.decay = 0.3; this.damp = 0.5; this.hicut = 0.3; this.chr = 0.2; this.chd = 0.2;
        this.k = this.fs / 48000;
        this.capsArr = null;                                    // line capacities (constant per rate; set by the subclass)
      }
      set(R) { return okUnit(R, N_REV); }
      need() { return layLines(this.capsArr, this.off); }
      // adopts a pool of ≥ need() floats and resets (no allocation: a type change installs a tank inside process())
      bind(buf) {
        const n = layLines(this.capsArr, this.off);
        if (!buf || !(buf.length >= n)) return false;
        this.buf = buf; this.used = n; this.has = 1;
        for (let e = 0; e < this.cap.length; e++) this.cap[e] = this.capsArr[e];
        this.reset();
        return true;
      }
      alloc() { if (this.buf === null) { this.bind(new Float32Array(this.need())); this.own = 1; } }
      reset() { if (this.buf) this.buf.fill(0, 0, this.used); this.wp.fill(0); this.ir = 1; this.clr(); }
      clr() {}
      snap() {}
      seed(p) { this.cph = frac(+p); }
      tail() { return 0; }
      bytes() { return (this.own === 1 ? tb(this.buf) : 0) + tb(this.off) + tb(this.cap) + tb(this.wp); }
    }

    // Vintage: lines 0 ER, 1–4 input diffusers, 5–8 FDN, 9–12 in-loop allpasses
    class RevVintage extends Tank {
      constructor(fs) {
        super(fs, 13);
        this.st = new Float64Array(16); this.dF0 = new Float64Array(4); this.dF1 = new Float64Array(4);
        this.dA = new Float64Array(4); this.dL = new Float64Array(4); this.g = new Float64Array(4);
        this.tE = new Float64Array(12); this.gE = new Float64Array(12);
        this.ersize = 0.5; this.diffa = 0.7; this.diffb = 0.5; this.lpK = 1; this.gD = 0.63; this.gA = 0.35;
        this.capsArr = Int32Array.from(this.caps());
      }
      caps() {                                                  // (constructor only)
        const k = this.k, c = [ceil(0.08 * this.fs) + 4];
        for (let j = 0; j < 4; j++) c.push(ceil(VIN_DIF[j] * 1.5 * k) + 4);
        for (let q = 0; q < 4; q++) c.push(ceil(VIN_FDN[q] * 1.5 * k + 12 * k + 4) + 4);
        for (let q = 0; q < 4; q++) c.push(ceil(VIN_LAP[q] * 1.5 * k) + 4);
        return c;
      }
      clr() { this.st.fill(0); }
      upd(R) {
        const ev = R.ev, fs = this.fs, k = this.k;
        revUpd(this, ev); this.ersize = ev[RV.ersize]; this.diffa = ev[RV.diffa]; this.diffb = ev[RV.diffb];
        const sc = (0.5 + this.size) * k, T60 = 0.3 + 19.7 * this.decay * this.decay;
        for (let j = 0; j < 4; j++) this.dA[j] = VIN_DIF[j] * sc;
        for (let q = 0; q < 4; q++) {
          this.dF1[q] = VIN_FDN[q] * sc; this.dL[q] = VIN_LAP[q] * sc;
          this.g[q] = exp(-3 * Math.LN10 * this.dF1[q] / (fs * T60));
        }
        this.lpK = opK(20000 * pow(0.05, this.damp), fs);
        this.gD = 0.9 * this.diffa; this.gA = 0.7 * this.diffb;
        for (let j = 0; j < 12; j++) {
          this.tE[j] = (ER_FLOOR + (1 - ER_FLOOR) * this.ersize) * (5 + 6.25 * j) * (1 + 0.07 * sin(2.3 * j)) * fs / 1000;
          this.gE[j] = 0.8 * pow(0.88, j);
        }
        this.cr = 0.05 * pow(100, this.chr); this.cd = 12 * this.chd * k;
      }
      snap() { for (let q = 0; q < 4; q++) this.dF0[q] = this.dF1[q]; }
      run(R, L, Rc, o, m) {
        const P = this.buf, off = this.off, cap = this.cap, wp = this.wp, st = this.st, fs = this.fs;
        const p0 = this.cph, p1 = frac(p0 + this.cr * m / fs), cd = this.cd;
        this.cph = p1;
        const dF0 = this.dF0, dF1 = this.dF1, g = this.g, lpK = this.lpK, gD = this.gD, gA = this.gA, ist = this.ist;
        let ir = this.ir;
        for (let j = 0; j < m; j++) {
          const i = o + j, t = (j + 1) / m;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          const x = 0.5 * (L[i] + Rc[i]) * ir;
          // early reflections
          P[off[0] + wp[0]] = x;
          let eL = 0, eR = 0;
          for (let e = 0; e < 12; e += 2) { eL += this.gE[e] * rdE(P, off[0], cap[0], wp[0], this.tE[e]); eR += this.gE[e + 1] * rdE(P, off[0], cap[0], wp[0], this.tE[e + 1]); }
          // input diffusion
          let v = x;
          for (let e = 1; e <= 4; e++) v = ap(P, off, cap, wp, e, this.dA[e - 1], gD, v);
          // tank
          const ph = p0 + (p1 - p0 + (p1 < p0 ? 1 : 0)) * t;
          let y0 = 0, y1 = 0, y2 = 0, y3 = 0, o0 = 0, o1 = 0, o2 = 0, o3 = 0;
          for (let q = 0; q < 4; q++) {
            const e = 5 + q, d = dF0[q] + (dF1[q] - dF0[q]) * t + cd * (0.5 + 0.5 * sin(TAU * (ph + 0.25 * q)));
            const r = rdE(P, off[e], cap[e], wp[e], d);
            let y = (st[q] += lpK * (r - st[q]));
            y = ap(P, off, cap, wp, 9 + q, this.dL[q], gA, y) * g[q];
            if (q === 0) { y0 = y; o0 = r; } else if (q === 1) { y1 = y; o1 = r; } else if (q === 2) { y2 = y; o2 = r; } else { y3 = y; o3 = r; }
          }
          const h0 = 0.5 * (y0 + y1 + y2 + y3), h1 = 0.5 * (y0 - y1 + y2 - y3), h2 = 0.5 * (y0 + y1 - y2 - y3), h3 = 0.5 * (y0 - y1 - y2 + y3);
          P[off[5] + wp[5]] = h0 + VIN_INJ[0] * v; P[off[6] + wp[6]] = h1 + VIN_INJ[1] * v;
          P[off[7] + wp[7]] = h2 + VIN_INJ[2] * v; P[off[8] + wp[8]] = h3 + VIN_INJ[3] * v;
          adv(wp, cap, 0, 13);
          L[i] = VIN_OUT * (o0 + o2) + eL; Rc[i] = VIN_OUT * (o1 + o3) + eR;
        }
        for (let q = 0; q < 4; q++) dF0[q] = dF1[q];
        this.ir = ir;
      }
      flush() { flushArr(this.st); }
    }

    // Nitrous: lines 0–1 input allpasses, 2–9 FDN lines, 10–17 in-loop allpasses
    class RevNitrous extends Tank {
      constructor(fs) {
        super(fs, 18);
        this.st = new Float64Array(8); this.tf = new Float64Array(8);
        this.dF0 = new Float64Array(8); this.dF1 = new Float64Array(8); this.dI = new Float64Array(2); this.dL = new Float64Array(8);
        this.feed = 0.6; this.diff = 0.7; this.lpK = 1; this.gl = 0.594; this.gd = 0.49;
        // MODE: nmode = the installed delay set, nwant = the one the controls select. Standalone (auto 1) a new MODE is
        // installed at once; inside the S2 Reverb unit (auto 0) a MODE change is a topology change (ducked, tank cleared,
        // like TYPE) — the eight lines must not sweep thousands of samples within one block
        this.nmode = 0; this.nwant = 0; this.auto = 1;
        this.capsArr = Int32Array.from(this.caps());
      }
      caps() {                                                  // (constructor only)
        const k = this.k, c = [];
        for (let j = 0; j < 2; j++) c.push(ceil(NIT_IAP[j] * 2 * k) + 4);
        for (let q = 0; q < 8; q++) c.push(ceil(NIT_MAX[q] * 2 * k + 12 * k + 4) + 4);
        for (let q = 0; q < 8; q++) c.push(ceil(NIT_LAP[q] * 2 * k) + 4);
        return c;
      }
      clr() { this.st.fill(0); }
      upd(R) {
        const ev = R.ev, km = ev[RV.nmode], k = this.k;
        revUpd(this, ev); this.feed = ev[RV.feed]; this.diff = ev[RV.diff];
        this.nwant = km > 0 ? (km < NIT_MODES.length - 1 ? round(km) : NIT_MODES.length - 1) : 0;
        if (this.auto === 1) this.nmode = this.nwant;
        const sc = (0.4 + 1.6 * this.size) * k, M = NIT_MODES[this.nmode];
        for (let q = 0; q < 8; q++) { this.dF1[q] = M[q] * sc; this.dL[q] = NIT_LAP[q] * sc; }
        for (let j = 0; j < 2; j++) this.dI[j] = NIT_IAP[j] * sc;
        this.gl = 0.99 * this.feed; this.gd = 0.7 * this.diff;
        this.lpK = opK(20000 * pow(0.05, this.hicut), this.fs);
        this.cr = 0.05 * pow(100, this.chr); this.cd = 12 * this.chd * k;
      }
      snap() { for (let q = 0; q < 8; q++) this.dF0[q] = this.dF1[q]; }
      run(R, L, Rc, o, m) {
        const P = this.buf, off = this.off, cap = this.cap, wp = this.wp, st = this.st, tf = this.tf, fs = this.fs;
        const p0 = this.cph, p1 = frac(p0 + this.cr * m / fs), cd = this.cd;
        this.cph = p1;
        const dF0 = this.dF0, dF1 = this.dF1, gl = this.gl, gd = this.gd, lpK = this.lpK, ist = this.ist;
        let ir = this.ir;
        for (let j = 0; j < m; j++) {
          const i = o + j, t = (j + 1) / m;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          let v = 0.5 * (L[i] + Rc[i]) * ir;
          v = ap(P, off, cap, wp, 0, this.dI[0], gd, v);
          v = ap(P, off, cap, wp, 1, this.dI[1], gd, v);
          const ph = p0 + (p1 - p0 + (p1 < p0 ? 1 : 0)) * t;
          let sum = 0, yl = 0, yr = 0;
          for (let q = 0; q < 8; q++) {
            const e = 2 + q, d = dF0[q] + (dF1[q] - dF0[q]) * t + cd * (0.5 + 0.5 * sin(TAU * (ph + 0.125 * q)));
            const r = rdE(P, off[e], cap[e], wp[e], d);
            if ((q & 1) === 0) yl += NIT_SG[q] * r; else yr += NIT_SG[q] * r;
            let y = (st[q] += lpK * (r - st[q]));
            y = ap(P, off, cap, wp, 10 + q, this.dL[q], gd, y) * gl;
            tf[q] = y; sum += y;
          }
          sum *= 0.25;                                           // Householder: y_q − (2/8)·Σy
          for (let q = 0; q < 8; q++) { const e = 2 + q; P[off[e] + wp[e]] = tf[q] - sum + (q & 1 ? -0.35 : 0.35) * v; }
          adv(wp, cap, 0, 18);
          L[i] = NIT_OUT * yl; Rc[i] = NIT_OUT * yr;
        }
        for (let q = 0; q < 8; q++) dF0[q] = dF1[q];
        this.ir = ir;
      }
      flush() { flushArr(this.st); }
    }

    // Basin: lines 0–7 chain A allpasses, 8–15 chain B, 16–19 FDN lines
    class RevBasin extends Tank {
      constructor(fs) {
        super(fs, 20);
        this.st = new Float64Array(4); this.dF0 = new Float64Array(4); this.dF1 = new Float64Array(4); this.dA = new Float64Array(16);
        this.feed = 0.6; this.gl = 0.6; this.inf = 0; this.lpK = 1;
        this.capsArr = Int32Array.from(this.caps());
      }
      caps() {                                                  // (constructor only)
        const k = this.k, c = [];
        for (let a = 0; a < 2; a++) for (let j = 0; j < 8; j++) c.push(ceil(BAS_AP[a][j] * 1.5 * k) + 4);
        for (let q = 0; q < 4; q++) c.push(ceil(BAS_FDN[q] * 1.5 * k + 40 * k + 4) + 4);
        return c;
      }
      clr() { this.st.fill(0); }
      upd(R) {
        const ev = R.ev, k = this.k;
        revUpd(this, ev); this.feed = ev[RV.feed];
        const sc = (0.5 + this.size) * k;
        for (let a = 0; a < 2; a++) for (let j = 0; j < 8; j++) this.dA[8 * a + j] = BAS_AP[a][j] * sc;
        for (let q = 0; q < 4; q++) this.dF1[q] = BAS_FDN[q] * sc;
        this.inf = this.feed >= 0.999 ? 1 : 0; this.gl = this.inf === 1 ? 1 : this.feed;
        this.lpK = opK(6000 * (1 - 0.8 * this.hicut), this.fs);
        this.cr = 0.05 * pow(100, this.chr); this.cd = 40 * this.chd * k;
      }
      snap() { for (let q = 0; q < 4; q++) this.dF0[q] = this.dF1[q]; }
      run(R, L, Rc, o, m) {
        const P = this.buf, off = this.off, cap = this.cap, wp = this.wp, st = this.st, fs = this.fs;
        const p0 = this.cph, p1 = frac(p0 + this.cr * m / fs), cd = this.cd;
        this.cph = p1;
        const dF0 = this.dF0, dF1 = this.dF1, dA = this.dA, gl = this.gl, inf = this.inf, lpK = this.lpK, ist = this.ist;
        let ir = this.ir;
        for (let j = 0; j < m; j++) {
          const i = o + j, t = (j + 1) / m;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          const x = 0.5 * (L[i] + Rc[i]) * ir;
          let a = x, b = x;
          for (let e = 0; e < 8; e++) { a = ap(P, off, cap, wp, e, dA[e], 0.75, a); b = ap(P, off, cap, wp, 8 + e, dA[8 + e], 0.75, b); }
          const ph = p0 + (p1 - p0 + (p1 < p0 ? 1 : 0)) * t;
          let y0 = 0, y1 = 0, y2 = 0, y3 = 0, o0 = 0, o1 = 0, o2 = 0, o3 = 0;
          for (let q = 0; q < 4; q++) {
            const e = 16 + q, d = dF0[q] + (dF1[q] - dF0[q]) * t + cd * (0.5 + 0.5 * sin(TAU * (ph + 0.25 * q)));
            const r = rdE(P, off[e], cap[e], wp[e], d);
            let y = (st[q] += lpK * (r - st[q])) * gl;
            if (inf === 1) y = 1.5 * tanh(y / 1.5);
            if (q === 0) { y0 = y; o0 = r; } else if (q === 1) { y1 = y; o1 = r; } else if (q === 2) { y2 = y; o2 = r; } else { y3 = y; o3 = r; }
          }
          const h0 = 0.5 * (y0 + y1 + y2 + y3), h1 = 0.5 * (y0 - y1 + y2 - y3), h2 = 0.5 * (y0 + y1 - y2 - y3), h3 = 0.5 * (y0 - y1 - y2 + y3);
          P[off[16] + wp[16]] = h0 + 0.5 * a; P[off[17] + wp[17]] = h1 + 0.5 * b;
          P[off[18] + wp[18]] = h2 - 0.5 * a; P[off[19] + wp[19]] = h3 - 0.5 * b;
          adv(wp, cap, 0, 20);
          L[i] = BAS_OUT * (o0 + o2); Rc[i] = BAS_OUT * (o1 + o3);
        }
        for (let q = 0; q < 4; q++) dF0[q] = dF1[q];
        this.ir = ir;
      }
      flush() { flushArr(this.st); }
    }

    /* ------------------------------------------------------------ splitter band builders (§8.4) */
    // LR4 of one sample on states s[b…b+5] (SVF1, LP2, HP2): → low in XO[0], high in XO[1]
    const XO = new Float64Array(2);
    function lr4(s, b, x, a1, a2, a3) {
      let v = svfT(s, b, x, a1, a2, a3);
      const h = x - SQRT2 * SVO.bp - v;
      XO[0] = svfT(s, b + 2, v, a1, a2, a3);
      v = svfT(s, b + 4, h, a1, a2, a3);
      XO[1] = h - SQRT2 * SVO.bp - v;
    }
    class XoverLH {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.f = 300; this.g = tan(PI * 300 / this.fs);
        this.s = new Float64Array(16);                          // per channel: LP and HP chains, 2 TPT sections × 2 states
        this.c = new Float64Array(3);
        svfC(300, SQRT2, this.fs, this.c, 0);
      }
      set(f) { f = xoF(f, this.fs); if (f !== this.f) { this.f = f; this.g = tan(PI * f / this.fs); svfC(f, SQRT2, this.fs, this.c, 0); } }
      reset() { this.s.fill(0); }
      split(L, R, o, m, aL, aR, bL, bR) {
        const s = this.s, a1 = this.c[0], a2 = this.c[1], a3 = this.c[2];
        for (let j = 0; j < m; j++) {
          lr4(s, 0, L[o + j], a1, a2, a3); aL[j] = XO[0]; bL[j] = XO[1];
          lr4(s, 6, R[o + j], a1, a2, a3); aR[j] = XO[0]; bR[j] = XO[1];
        }
      }
      flush() { flushArr(this.s); }
      bytes() { return tb(this.s) + tb(this.c); }
    }
    class XoverLMH {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.f1 = 200; this.f2 = 2000; this.g1 = tan(PI * 200 / this.fs); this.g2 = tan(PI * 2000 / this.fs);
        this.s = new Float64Array(40);                          // per channel: two LR4 splits + the low band's freq2 allpass
        this.c = new Float64Array(6);
        svfC(200, SQRT2, this.fs, this.c, 0); svfC(2000, SQRT2, this.fs, this.c, 3);
      }
      set(f1, f2) {
        const fs = this.fs;
        f1 = xoF(f1, fs); f2 = xoF(f2, fs);
        if (f2 < 1.2 * f1) f2 = xoF(1.2 * f1, fs);
        if (f1 !== this.f1) { this.f1 = f1; this.g1 = tan(PI * f1 / fs); svfC(f1, SQRT2, fs, this.c, 0); }
        if (f2 !== this.f2) { this.f2 = f2; this.g2 = tan(PI * f2 / fs); svfC(f2, SQRT2, fs, this.c, 3); }
      }
      reset() { this.s.fill(0); }
      split(L, R, o, m, aL, aR, bL, bR, cL, cR) {
        const s = this.s, c = this.c, A1 = c[0], A2 = c[1], A3 = c[2], B1 = c[3], B2 = c[4], B3 = c[5], K2 = 2 * SQRT2;
        for (let j = 0; j < m; j++) {
          for (let ch = 0; ch < 2; ch++) {
            const b = 20 * ch, x = ch === 0 ? L[o + j] : R[o + j];
            lr4(s, b, x, A1, A2, A3);
            const lo = XO[0], hi = XO[1];
            lr4(s, b + 6, hi, B1, B2, B3);
            const md = XO[0], hh = XO[1];
            svfT(s, b + 12, lo, B1, B2, B3);
            const la = lo - K2 * SVO.bp;                         // low band through AP2(f2)
            if (ch === 0) { aL[j] = la; bL[j] = md; cL[j] = hh; } else { aR[j] = la; bR[j] = md; cR[j] = hh; }
          }
        }
      }
      flush() { flushArr(this.s); }
      bytes() { return tb(this.s) + tb(this.c); }
    }
    // M/S: branch 0 gets (m, m), branch 1 (s, −s) with m = (L + R)/2, s = (L − R)/2; stateless
    class MS {
      constructor(fs) { this.fs = fs > 0 ? +fs : 48000; }
      set() {}
      reset() {}
      split(L, R, o, m, aL, aR, bL, bR) {
        for (let j = 0; j < m; j++) {
          const l = L[o + j], r = R[o + j], md = 0.5 * (l + r), sd = 0.5 * (l - r);
          aL[j] = md; aR[j] = md; bL[j] = sd; bR[j] = -sd;
        }
      }
      flush() {}
      bytes() { return 0; }
    }

    /* ------------------------------------------------------------ Overdrive staging (§8.2 mode 16) */
    class Overdrive {
      constructor(fs2) {
        this.fs = fs2 > 0 ? +fs2 : 96000;
        this.a = 1 - exp(-2 * PI * OD_LP / this.fs);            // one-pole low-pass coefficient per stage
        this.d = 0; this.N = 4;
        this.s = new Float64Array(2 * OD_MAXST);                // low-pass state per channel and stage
        this.sh = null; this.S1 = null; this.S2 = null;         // SxBase.shapeS and two Shapers (resolved here or in set)
        const B = globalThis.SxBase;
        if (B && typeof B.shape === 'function') this.bind(B);
      }
      bind(B) {
        this.sh = B.shape;
        if (typeof B.Shaper === 'function' && typeof B.shapeS === 'function') {
          this.S1 = new B.Shaper(); this.S2 = new B.Shaper(); this.ss = B.shapeS;
          this.S1.set(16, this.d); this.S2.set(16, OD_D1);
        }
      }
      set(d, stages) {
        this.d = clamp01(+d);
        const N = round(+stages);
        this.N = N > 1 ? (N < OD_MAXST ? N : OD_MAXST) : 1;     // NaN → 1
        if (this.sh === null) { const B = base('Overdrive'); if (B && typeof B.shape === 'function') this.bind(B); }
        if (this.S1 !== null) this.S1.set(16, this.d);
      }
      reset() { this.s.fill(0); }
      tick(c, x) {
        const s = this.s, a = this.a, N = this.N, b = c * OD_MAXST;
        if (this.S1 === null) {
          if (this.sh === null) return x;
          let w = s[b] += a * (this.sh(16, x, this.d) - s[b]);
          for (let j = 1; j < N; j++) w = (s[b + j] += a * (this.sh(16, w, OD_D1) - s[b + j]));
          return w;
        }
        const f = this.ss, S2 = this.S2;
        let w = (s[b] += a * (f(this.S1, x) - s[b]));
        for (let j = 1; j < N; j++) w = (s[b + j] += a * (f(S2, w) - s[b + j]));
        return w;
      }
      run(c, X, o, n) { for (let i = o, e = o + n; i < e; i++) X[i] = this.tick(c, X[i]); }
      flush() { flushArr(this.s); }
      bytes() { return tb(this.s); }
    }

    globalThis.FXMods2 = Object.freeze({
      VER, TYPES, TAB, PIDX,
      Bode, Convolve, Utility, RevVintage, RevNitrous, RevBasin, XoverLH, XoverLMH, MS, Overdrive,
    });
  } catch (err) {
    globalThis.FXMods2 = null;                                 // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('fx-mods2: load failed', err);
  }
})();
