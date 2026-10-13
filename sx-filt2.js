/*
 * sx-filt2.js — the Serum 2 "New" filter families, types 96–107 (classic script, no imports/exports; owner D3).
 * Contract: SPEC-serum2 §11.7 (exports), §3.5 (FILTERS 96–107, families 19–27), §6.13 (instances, PZ SVF, recipes, memory),
 * §0.3 (load order, IIFE shape, lazy references), §0.4 (code rules), §15.7 (tests: tests/sx-filt2.test.mjs).
 *
 * Script #2 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Publishes the frozen `globalThis.SxFilt2`; can be evaluated again in the same scope (it
 * keeps no store); a failure inside leaves SxFilt2 = null without throwing (then types 96–107 pass audio unfiltered, gain
 * 1, §0.3). Reads no other script's global. SerumDSP.SFilter (owner D1) creates family objects with make() in
 * apply/prealloc only and delegates tick/process to them for t ≥ 96; the FX Filter module (owner F1) uses them too.
 *
 * Exports
 *   VER 1 · FIRST 96 · LAST 107 · NTYPES 12 (types FIRST…LAST)
 *   IDS     Array(12) FILTERS ids of types 96–107 (wsp, djm, diffusor, mg_ladder, acid_ladder, ems_ladder, mg_dirty, pz_svf,
 *           comb2, exp_mm, exp_bpf, k35)
 *   FAMILY  Array(9) family names (wasp, djm, diffusor, ladder2, dirty, pzsvf, comb2, expmm, k35) = FILTER_FAMILY 19–27
 *   FAM     Uint8Array(12): FILTER_FAMILY index (19–27) of type 96 + j (= SxBase.FILTER_FAM2[96 + j], integration-tested)
 *   PZ_DEFAULT Float64Array(12): the PZ SVF corners TL, TR, BL, BR × [lp, bp, hp] = LP, BP, HP, Notch (serum-core
 *           PZ_DEFAULT flattened; the layout of one filter's 12 values of CP.pz). A fresh family object uses it with
 *           X = Y = 0 (the TL corner, a low-pass): the FX Filter module, which has no X/Y or corner data, never calls
 *           setXY/setPZ (§11.7).
 *   LINE_FLOOR_HZ 20: the delay floor of the delay-based families (Diffusor, Comb 2: fc and f2 clamped to ≥ 20 Hz for
 *           line sizing and tuning, §6.13.1).
 *           ⚑ Memory units (spec contradiction; RULINGS2 D1/D3: "MB" means MiB): a Diffusor object at fs ≥ 192 kHz holds 1 019 112 B
 *           (lines 253 902 Float32 = 1 015 608 B + 3 504 B of state) = 0.972 MiB — within "≤ 1 MB per filter" read as
 *           MiB (1 048 576 B), 1.9 % over it read as 10^6 B; two Diffusors per voice = 1.94 MiB (≤ 2 MiB; 2.04·10^6 B).
 *           The §6.13.1 recipe cannot meet its own bound "Σ_j d_j ≤ 0.75·fs/20": at the 20 Hz floor d₀ alone is fs/20
 *           and Σ_j d_j = 13.22·fs/20 (16 stages), so 1 MB in SI units would need a floor of ≈ 20.4 Hz or shorter
 *           stage delays. The tests use MiB. ⚑ Diffusor above fs = 192 kHz (the 384 kHz internal rate of base 192 kHz
 *           at OS 2, or base 96 kHz at OS 4): its lines keep their 192 kHz size and its floor rises to 20·fs/192000 Hz
 *           (40 Hz at 384 kHz) — this departs from the approved 20 Hz floor (§0.8 item 17) to keep one Diffusor
 *           ≤ 1 MiB and a voice ≤ 2 MiB at every reachable rate (§14.2 "≤ 2 MB per voice at base 192 kHz"); the
 *           alternative (20 Hz at every rate) doubles a Diffusor to 1.94 MiB at 384 kHz. Comb 2 (0.29 MiB at
 *           384 kHz) keeps the 20 Hz floor.
 *   [+] need(type, fs) → number of Float32 line samples the type's object uses at rate fs, BOTH channels (0 for the
 *           families without delay lines; Diffusor 2·Σ_j (⌈R·M_j⌉ + 4) with R = min(fs, 192000)/20 ≈ 1.32·min(fs, 192 kHz)
 *           — 253 902 at ≥ 192 kHz; Comb 2 4·(⌈fs/20⌉ + 4) ≈ 0.2·fs). Size SFilter's shared pool from need(), never from
 *           these approximations (a pool shorter than need() is not used: the object allocates its own lines); 0 for
 *           invalid arguments.
 *   make(type, fs, [+] pool = null) → family object | null — called by SFilter only in apply/prealloc (allocates: the
 *           delay families' Float32 lines, Diffusor ≤ 1 MiB at any rate and Comb 2 ≤ 160 KB per object at 192 kHz,
 *           ≤ 310 KB at 384 kHz). type must be an
 *           integer 96–107 and fs a finite rate > 0; otherwise null (SFilter passes that type unfiltered) and one
 *           console.warn per kind of error per scope. [+] pool: an optional Float32Array the object uses for its lines
 *           when pool.length ≥ need(type, fs) (else it allocates its own): SFilter may hand one pool to every family
 *           object of one filter (one family runs at a time; switching family must call reset() on the new object, the
 *           SFilter rule — reset() marks the lines empty in O(lines), reads of never-written samples return 0).
 *   family object {type, fam, fs, yl, yr, bytes (own typed arrays; a shared pool is not counted), fcL, fcR, res, drive,
 *     vr, x, y, pz,
 *     set(fcL, fcR, res, drive, vr)  cutoffs in Hz per channel (clamped to [8, 0.45·fs]), res/drive/vr ∈ [0, 1] (clamped;
 *                                    NaN → the lower bound), the SFilter.set semantics of Phase 1 (drive input gain
 *                                    10^(16·√drive/20) inside). Called once per chunk, or only when a value changed
 *                                    (SFilter.set skips unchanged values): coefficients are recomputed only when
 *                                    something changed; a SMOOTH cutoff glide (below) and a Diffusor STAGES change
 *                                    keep moving inside tick/process without further set() calls. Control ramps
 *                                    (IMPL, click-free modulation): the Diffusor stage delays d_j, the Comb 2 read
 *                                    delays and the DJ Mixer weight t move linearly per sample from their current
 *                                    values to the new targets over the samples since the previous change (one chunk
 *                                    while a control is modulated; ≤ 4 chunks of base 48 kHz, 4·round(fs/12000)
 *                                    samples), so a cutoff modulated once per chunk renders as with a per-sample
 *                                    control; the first set() after make/reset/setRate jumps
 *     setXY(x, y)                    PZ SVF position, each clamped to [0, 1] (once per chunk; other families ignore it)
 *     setPZ(c, off = 0)              PZ SVF corners: 12 values c[off…off+11] in the PZ_DEFAULT layout, each clamped to
 *                                    [−1, 1] (pass CP.pz with off = k·12, or a Float64Array(12)); a shorter c is ignored
 *                                    (one console.warn per scope); NaN keeps that corner value
 *     tick(xl, xr)                   one stereo sample; writes yl, yr (bit-identical to process over the same samples)
 *     process(L, R, off, n)          in place on L/R[off … off+n−1]; yl/yr = the last outputs; flushes denormal states and
 *                                    resets the object when a state ran away (non-finite or ≥ 1e9; Phase-1 SFilter rule;
 *                                    Comb 2, whose state lives in its lines, checks every comb output it writes)
 *     reset()                        clears every state (yl = yr = 0); a SMOOTH glide under way snaps to its target and
 *                                    a Diffusor runs exactly its S stages again (no set() call needed after reset); the
 *                                    next set() jumps to its cutoff (no glide)
 *     setRate(fs)                    new rate (re-sizes the delay lines: apply path only); invalid fs is ignored
 *     bytes                          Σ bytes of the object's own typed arrays}
 *     Hot paths (set, setXY, setPZ, tick, process, reset) never allocate.
 *   impulse(type, fc, res, drive, vr, fs, len = 4096, x = 0, y = 0, pz = null) → Float64Array(len)   (main thread)
 *           the left-channel response of a fresh family object to a 0.01 impulse divided by 0.01 (the Phase-1
 *           filterImpulse convention), with setXY(x, y) and setPZ(pz) applied when given (pz: 12 values, PZ_DEFAULT
 *           layout). Throws RangeError for a type outside 96–107 or an invalid fs, TypeError for a pz with < 12 values;
 *           len is floored, < 0 or NaN ⇒ 0.
 *
 * Common rules (Phase-1 §6.11): drive gain dg = 10^(16·√drive/20) into the family's nonlinearity; families without one
 * (DJ Mixer, Diffusor, EMS, PZ SVF, Exp MM/BPF) pass the input through the Phase-1 soft limiter sc (identity for
 * |x| ≤ 1); SVF resonance law k = √2·(1 − 0.99·res) (Q = 0.7071/(1 − 0.99·res)), with the Phase-1 saturating resonance
 * part (k = √2 − r·tanh(bp/2)/(bp/2), r = 0.99·√2·res) in the "clean" SVF families; ladder feedback per family; output
 * safety limiter lim (identity below |8|); TPT (zero-delay-feedback) structures with prewarped g = tan(π·fc/fs), the
 * nonlinearities replaced by their secant gains at the previous sample (no iteration; the Phase-1 ladder method).
 * Family recipes (§6.13.5; IMPL — interpretations and deviations marked ⚑; every ⚑ below (Wsp saturation location and
 * bias, Acid Ladder feedback and fc placement, MG Dirty feedback gain, the Diffusor memory units and floor above 192 kHz,
 * the Diffusor STAGES glide) is ratified by RULINGS2 D3 — MG Dirty with the unity-normalised feedback gain):
 *   wasp (96 Wsp)       2-pole SVF whose two integrators saturate, s(e) = e/(1 + |e|), MORPH m = var:
 *                       m < ½ ? lerp(lp, notch, 2m) : lerp(notch, hp, 2m − 1), notch = lp + hp; the asymmetric bias
 *                       +0.05·drive (buzz) is applied inside the saturators (their gains are taken at e + bias, so
 *                       positive and negative swings saturate differently: even harmonics) — ⚑ not added to the
 *                       signal, so silence stays silence (the Phase-1 reset rule) and the passband has no DC offset.
 *                       ⚑ "integrator saturation on each state update" is applied to each integrator's INPUT (the
 *                       transconductor of an OTA/inverter integrator), integrating s(e): saturating the stored state
 *                       itself acts as a per-sample leak (≈ −30 dB passband at 150 Hz for a −6 dBFS input), so it could
 *                       not meet the level calibration outside tiny signals.
 *   djm (97 DJ Mixer)   c = log(fc/MIDI0)/log(22050/MIDI0) per channel: c < 0.49 → SVF LP at 20·1000^(2c/0.98); c > 0.51 →
 *                       SVF HP at 20·1000^((c − 0.51)/0.49); between, a linear crossfade with the (dry) input, weight
 *                       |c − 0.5|/0.01 of the LP at its c = 0.49 cutoff / the HP at its c = 0.51 cutoff; exactly dry at
 *                       c = 0.5 (the cutoff knob's centre, √(MIDI0·22050) ≈ 424.6 Hz). The two sides share one SVF
 *                       state: crossing the centre (IMPL) fades the old side to dry (t → 0, its coefficients kept),
 *                       then reseeds the state to the new side's steady state (HP: empty; LP: the DC state of the last
 *                       input) and fades the new side in from t = 0 — the reseed happens at t = 0, so neither side's
 *                       weight jumps and a 20 kHz LP state is never read as a 20 Hz HP one.
 *   diffusor (98)       S = 1 + round(15·var) Schroeder allpasses in series (v = x + g·D(v), y = −g·v + D(v)), delays
 *                       d_j = (fs/fc)·0.5^(j/16)·(1 + 0.13·(j mod 3)) samples (fc ≥ the floor, d_j ≥ 1.5), g = 0.3 + 0.6·res;
 *                       D = integer delay + a first-order Thiran allpass for the fraction (keeps the chain exactly
 *                       allpass, flat magnitude). With S constant the output is the chain of S stages, sample for sample.
 *                       ⚑ STAGES changes (IMPL, click-free): the output position s̃ moves toward S by one stage per
 *                       4 ms and the output is tap ⌊s̃⌋ + (tap ⌈s̃⌉ − tap ⌊s̃⌋)·frac(s̃) (tap k = after k stages);
 *                       stages above S stay warm (running) while the output may still use them and stop 10 ms after
 *                       s̃ has come to rest at S (then the steady S-stage loop runs again; dropped stages never reach
 *                       the output, so dropping them changes no sample); a stage started mid-stream (a STAGES
 *                       increase) begins from an empty line and fades its delayed path in over 10 ms once its reads
 *                       hold written samples (an empty line would otherwise switch the full delayed signal in at once).
 *                       Cutoff changes ramp each d_j per sample (integer part and Thiran fraction per sample).
 *   ladder2 MG (99)     the Phase-1 4-pole ladder (tanh per stage, V = 2, secant ZDF), k = 4.1·res, no FAT, output y4.
 *   ladder2 Acid (100)  diode ladder: the stage coupling ẏ_k = ω·(y_{k−1} − y_k + 0.5·(y_{k+1} − y_k)), k = 1…4, y₅ = 0,
 *                       y₀ = sat(input − feedback) (V = 2), output 2·y4 (DC gain 2·16/31 = +0.27 dB), solved per sample as
 *                       a TPT system (tridiagonal solve). ⚑ The coupled ladder's 180° frequency is √1.5·ω, so the analog
 *                       ω is placed at fc/√1.5 (prewarped): the resonance and the self-oscillation sit at fc. ⚑ Feedback
 *                       is taken from the output (2·y4) with k = 7.1·res: the recipe's 6·res lies below this coupling's
 *                       oscillation threshold (k = 221/32 ≈ 6.906 on the output, 13.81 on y4), and §15.7 requires
 *                       self-oscillation at res 1. Side effect of the fc/√1.5 placement: at res 0 the −3 dB point is
 *                       0.255·fc (MG / EMS / MG Dirty 0.434·fc), i.e. the same cutoff knob is ≈ 0.8 octave darker.
 *                       The two §15.7 / §6.13.5 requirements conflict for this topology: §6.13.5's k = 6·res never
 *                       self-oscillates (threshold 13.81 on y4 with y₅ = 0, 8.61 with y₅ = y₄), and a placement that
 *                       kept the res-0 −3 dB point at 0.434·fc would move the self-oscillation off fc (§15.7 ±5 %).
 *   ladder2 EMS (101)   linear 4-pole ladder (no tanh), feedback k = 3.6·res through a one-pole HP at fc/4 (ZDF, solved
 *                       exactly); never self-oscillates (threshold k ≈ 5.17).
 *   ladder2 SMOOTH      (MG, Acid, EMS, and PZ SVF) cutoff glide: log2 fc per channel follows its target (the last
 *                       set()) through a one-pole stepped every gq = round(fs/12000) samples (the chunk rate at base
 *                       48 kHz; on a sample grid counted from make/reset/setRate) inside tick/process, coefficient
 *                       exp(−gq/(fs·τ)), τ = 0.05·var² s (var 0: none); within 1e-9 octave it arrives. The glide runs
 *                       whether or not set() is called again. The first set() after make/reset jumps.
 *   dirty (102 MG Dirty) MG ladder with input gain (1 + 15·var²)·dg (PAIN) and the feedback k·tanh(2·y4)/2 (secant gain,
 *                       kf = k·tg(2·y4)): "tanh(2·x) in the feedback" UNITY-NORMALISED (lead ruling, RULINGS2 D3): the
 *                       small-signal loop gain is k = 4.1·res as on the MG Ladder (same threshold at res ≈ 0.98, no
 *                       level jump against the other ladders); the feedback only saturates earlier (at half the level).
 *   pzsvf (103 PZ SVF)  clean SVF, output cl·lp + cb·bp + ch·hp, (cl, cb, ch) = bilinear of the corners at (X, Y)
 *                       (§6.13.4; bp = unity-peak band-pass k·v1, notch corner = lp + hp), + SMOOTH (var).
 *   comb2 (104 Comb 2)  two feedback combs in series at fa = max(fc, 20) and f2 = fa·2^(4(var − 0.5)) (the FRQ2 ratio is
 *                       kept below the floor; f2 clamped to [20, 0.45·fs]), y = x + fb·1.5·tanh(d/1.5), fb = 0.9995·res,
 *                       linear-interpolated delay reads (the delays ramp per sample on a cutoff/FRQ2 change), output
 *                       × √(1 − fb²).
 *   expmm (105 Exp MM, 106 Exp BPF)  clean SVF: Exp MM blends LP → Notch → HP with MIX (var) as wasp; Exp BPF = unity-peak BP.
 *   k35 (107 K35)       Korg-35 LP: one-pole LP1 → (+ feedback) → one-pole LP2 (out); feedback = one-pole HP of k·out,
 *                       k = 2·res, solved ZDF, the loop sum through tanh; −12 dB/oct, DC gain 1, marginal at res 1.
 *
 * Typed-array constructors are global lookups, used only in make/setRate/impulse (the allocation-free tests replace them
 * on the context).
 */
(function () {
  'use strict';
  try {
    const floor = Math.floor, ceil = Math.ceil, round = Math.round, exp = Math.exp, log = Math.log, pow = Math.pow,
      tan = Math.tan, sqrt = Math.sqrt, PI = Math.PI;
    const mlog2 = Math.log2;

    const VER = 1, FIRST = 96, LAST = 107, NTYPES = 12, LINE_FLOOR_HZ = 20;
    const IDS = Object.freeze(['wsp', 'djm', 'diffusor', 'mg_ladder', 'acid_ladder', 'ems_ladder', 'mg_dirty', 'pz_svf', 'comb2',
      'exp_mm', 'exp_bpf', 'k35']);
    const FAMILY = Object.freeze(['wasp', 'djm', 'diffusor', 'ladder2', 'dirty', 'pzsvf', 'comb2', 'expmm', 'k35']);
    const FAM0 = 19;                                           // FILTER_FAMILY index of 'wasp'
    const FJ = [0, 1, 2, 3, 3, 3, 4, 5, 6, 7, 7, 8];            // family j (0–8) of type 96 + t
    const FAM = Uint8Array.from(FJ, (j) => FAM0 + j);
    const PZ_DEF = [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1];       // TL LP · TR BP · BL HP · BR Notch (lp + hp)
    const PZ_DEFAULT = Float64Array.from(PZ_DEF);
    // family codes (j of FAMILY) and the ladder variants
    const WASP = 0, DJM = 1, DIFF = 2, LAD2 = 3, DIRTY = 4, PZSVF = 5, COMB2 = 6, EXPMM = 7, K35 = 8;
    const L_MG = 0, L_ACID = 1, L_EMS = 2;

    const MIDI0 = 440 * pow(2, -69 / 12);                    // 8.175798915643707 Hz
    const DJ_L = log(22050 / MIDI0);
    const K0 = Math.SQRT2;
    const LADDER_V = 2, IV = 1 / LADDER_V;                   // Phase-1 stage saturation level
    const ACID_W = sqrt(1.5);                                // 180° frequency of the 0.5-coupled ladder / ω (exact)
    const ACID_K = 7.1;                                      // feedback on the output 2·y4 at res 1 (threshold 221/32)
    const DIFF_N = 16;                                       // Diffusor stages allocated
    const DIFF_M = new Float64Array(DIFF_N);                 // d_j·fc/fs
    for (let j = 0; j < DIFF_N; j++) DIFF_M[j] = pow(0.5, j / 16) * (1 + 0.13 * (j % 3));
    const DIFF_GLIDE_S = 0.004;                              // Diffusor STAGES change: s̃ moves one stage per 4 ms
    const DIFF_RAMP_S = 0.01;                                // a stage started mid-stream fades its delayed path in over 10 ms
    const DB = 64;                                           // Diffusor general-path piece (scratch length)
    const NS = 16;                                           // state doubles per channel
    const NC = 32;                                           // coefficient doubles per channel (Diffusor: 16 N + 16 η)
    const GLIDE_HZ = 12000;                                  // SMOOTH glide update rate (the chunk rate at base 48 kHz)
    const RAMP_CHUNKS = 4;                                   // control ramps last ≤ 4 such chunks (rM = 4·gq samples)
    const C_BAD = NS - 1;                                    // Comb 2: runaway marker slot of st per channel (flush)

    const warned = new Set();
    function warnOnce(key, why) {
      if (warned.has(key)) return;
      warned.add(key);
      if (typeof console !== 'undefined') console.warn('sx-filt2: ' + why);
    }
    const isType = (t) => typeof t === 'number' && t >= FIRST && t <= LAST && floor(t) === t;
    const isRate = (fs) => typeof fs === 'number' && fs > 0 && fs < Infinity;
    const clamp01 = (x) => (x > 0 ? (x < 1 ? +x : 1) : 0);     // NaN → 0

    /* ------------------------------------------------------------ fast math (Phase-1 serum-dsp, §0.2 tolerances) */
    // tanh(x)/x: [7/6] Padé of tanh, then 1/|x| where it reaches 1 (x·tg(x) monotone, ≤ 1, within 1e-4 of tanh)
    function tg(x) {
      const z = x * x;
      if (z >= 24.7009) return 1 / (x < 0 ? -x : x);
      return (135135 + z * (17325 + z * (378 + z))) / (135135 + z * (62370 + z * (3150 + 28 * z)));
    }
    // soft limiter of the families without their own nonlinearity: identity for |x| ≤ 1, then 1 + tanh(|x| − 1)
    function sc(x) {
      if (x <= 1 && x >= -1) return x;
      const a = x < 0 ? -x : x, t = a - 1, y = 1 + t * tg(t);
      return x < 0 ? -y : y;
    }
    // output safety limiter: identity below |8|, bounded by 12
    function lim(x) {
      const a = x < 0 ? -x : x, t = (a - 8) * 0.25, y = 8 + 4 * t * tg(t);
      return x < 0 ? -y : y;
    }
    const prew = (fc, fs) => tan(PI * fc / fs);
    const isF32 = (a) => a !== null && typeof a === 'object' && Object.prototype.toString.call(a) === '[object Float32Array]';   // any realm

    /* ------------------------------------------------------------ delay-line sizes (§6.13.1, 20 Hz floor) */
    // Diffusor: the longest delay in samples is the one at 20 Hz and fs ≤ 192 kHz (DIFF_RMAX = fs/20); above 192 kHz the
    // lines keep their 192 kHz size and the floor rises to 20·fs/192000 Hz (§14.2: ≤ 1 MB per filter at any internal rate)
    const DIFF_FS_MAX = 192000;
    const diffRmax = (fs) => (fs < DIFF_FS_MAX ? fs : DIFF_FS_MAX) / LINE_FLOOR_HZ;
    function diffLen(j, fs) { return ceil(diffRmax(fs) * DIFF_M[j]) + 4; }
    function combLen(fs) { return ceil(fs / LINE_FLOOR_HZ) + 4; }
    function need(type, fs) {
      if (!isType(type) || !isRate(fs)) return 0;
      const f = FJ[type - FIRST];
      if (f === DIFF) { let n = 0; for (let j = 0; j < DIFF_N; j++) n += diffLen(j, fs); return 2 * n; }
      if (f === COMB2) return 4 * combLen(fs);
      return 0;
    }

    /* ------------------------------------------------------------ family object */
    class Filt2 {
      constructor(type, fs, pool) {
        this.type = type;
        this.fam = FAM[type - FIRST];
        this.f = FJ[type - FIRST];                           // family code 0–8
        this.lv = type === 100 ? L_ACID : type === 101 ? L_EMS : L_MG;
        this.bpo = type === 106 ? 1 : 0;                     // Exp BPF
        this.fs = fs;
        this.fcL = 1000; this.fcR = 1000; this.res = 0; this.drive = 0; this.vr = 0;
        this.x = 0; this.y = 0;
        this.pz = Float64Array.from(PZ_DEF);
        this.yl = 0; this.yr = 0;
        this.dg = 1;
        this.st = new Float64Array(2 * NS);                  // states per channel
        this.co = new Float64Array(2 * NC);                  // coefficients per channel
        this.mw = new Float64Array(4);                       // output weights (morph / PZ corners)
        this.ef = new Float64Array(2);                       // effective (smoothed) log2 cutoff per channel
        this.fresh = 1;                                      // next set() jumps (no glide)
        this.jmp = 1;                                        // the set() being applied jumps (coef reads it)
        this.dirty = 1;                                      // coefficients must be recomputed
        this.T1 = new Float64Array(2);                       // tick scratch
        // SMOOTH glide (ladder2, PZ SVF): targets tl0/tl1 (log2 Hz), one-pole factor ga per gq samples, grid counter gc
        this.tl0 = 0; this.tl1 = 0; this.ga = 0; this.gc = 0;
        this.gq = 1;
        // delay lines (Diffusor: 16 per channel, Comb 2: 2 per channel)
        this.nl = this.f === DIFF ? 2 * DIFF_N : this.f === COMB2 ? 4 : 0;
        this.lb = new Int32Array(this.nl); this.ln = new Int32Array(this.nl);
        this.lw = new Int32Array(this.nl); this.lc = new Int32Array(this.nl);
        this.own = null; this.pool = null;
        // Diffusor: target stage count dS, running stages sR (≥ dS; stages above dS stay warm until reset), glide
        // position sg (output = taps ⌊sg⌋/⌈sg⌉ blended), read ramps rp per line (1 = warm), scratch dY / dG
        this.dS = 0; this.sR = 0; this.sg = 1; this.sgN = 1; this.dg2 = 0.3;
        const dd = this.f === DIFF;
        this.rp = new Float64Array(dd ? 2 * DIFF_N : 0).fill(1);
        this.dY = new Float64Array(dd ? DB : 0); this.dG = new Float64Array(dd ? DB : 0);
        this.gR = 1; this.wR = 1;
        this.cfb = 0; this.cnrm = 1;                         // Comb 2: feedback, output scale
        this.kk = 0;                                         // K35: feedback
        this.gl = 0;                                         // 1 while a SMOOTH cutoff glide is under way
        // per-sample control ramps between set() calls (Diffusor delays d_j, Comb 2 delays, DJ Mixer weight t): current
        // value rC, increment rI, target rT per ramped value, samples left rN per channel; ns = samples since the last
        // set() that changed something (the ramp length of the next one, ≤ rM); sq = Diffusor samples at rest (sg = S)
        const nr = this.f === DIFF ? 2 * DIFF_N : this.f === COMB2 ? 4 : this.f === DJM ? 2 : 0;
        this.rC = new Float64Array(nr); this.rI = new Float64Array(nr); this.rT = new Float64Array(nr);
        this.rN = new Int32Array(2);
        this.pf = new Int32Array(2);                         // DJ Mixer: 1 while a centre crossing fades the old side out
        this.ns = 0; this.rl = 0; this.rM = 1; this.sq = 0;
        this.rates();
        this.layout(pool);
        this.bytes = 0;
        this.count();
        this.set(1000, 1000, 0, 0, 0);
        this.fresh = 1;                                      // the owner's first set() jumps to its cutoff
      }
      // rate-dependent constants (constructor / setRate)
      rates() {
        const fs = this.fs, q = round(fs / GLIDE_HZ);
        this.gq = q > 1 ? q : 1;
        this.gc = 0;
        this.gR = 1 / (DIFF_GLIDE_S * fs); this.wR = 1 / (DIFF_RAMP_S * fs);
        this.rM = RAMP_CHUNKS * this.gq; this.ns = 0;
      }
      count() {
        let b = 0;
        for (const a of [this.pz, this.st, this.co, this.mw, this.ef, this.T1, this.lb, this.ln, this.lw, this.lc, this.rp, this.dY,
          this.dG, this.rC, this.rI, this.rT, this.rN, this.pf]) b += a.byteLength;
        if (this.own !== null) b += this.own.byteLength;
        this.bytes = b;
      }
      // (re)size the lines for this.fs; uses `pool` when it is large enough, else its own buffer (apply path only)
      layout(pool) {
        const n = need(this.type, this.fs);
        if (n === 0) { this.pool = null; this.own = null; return; }
        if (isF32(pool) && pool.length >= n) { this.pool = pool; this.own = null; }
        else {
          if (pool !== null && pool !== undefined) warnOnce('make.pool', 'make: pool must be a Float32Array of ≥ need(type, fs) samples; using an own buffer');
          this.own = new Float32Array(n); this.pool = this.own;
        }
        let off = 0;
        for (let c = 0; c < 2; c++) {
          for (let j = 0; j < this.nl / 2; j++) {
            const L = this.f === DIFF ? diffLen(j, this.fs) : combLen(this.fs), q = c * (this.nl / 2) + j;
            this.lb[q] = off; this.ln[q] = L; off += L;
          }
        }
        this.lw.fill(0); this.lc.fill(0);
        if (this.f === DIFF) { this.rp.fill(1); this.sR = this.dS; this.sg = this.dS > 0 ? this.dS : 1; }
      }
      set(fcL, fcR, res, drive, vr) {
        const fs = this.fs, hi = 0.45 * fs;
        fcL = fcL > 8 ? (fcL < hi ? +fcL : hi) : 8;
        fcR = fcR > 8 ? (fcR < hi ? +fcR : hi) : 8;
        res = clamp01(res); drive = clamp01(drive); vr = clamp01(vr);
        const glide = this.f === LAD2 || this.f === PZSVF;
        if (!this.dirty && fcL === this.fcL && fcR === this.fcR && res === this.res && drive === this.drive && vr === this.vr) return;
        const jump = this.fresh;
        if (drive !== this.drive || this.dirty) this.dg = exp(Math.LN10 * 0.8 * sqrt(drive));   // 10^(16·√d/20)
        this.fcL = fcL; this.fcR = fcR; this.res = res; this.drive = drive; this.vr = vr;
        // cutoff glide (SMOOTH): set() only takes the targets; the one-pole runs in process/tick on the gq-sample grid
        // (glide()), so it keeps moving when set() is not called again (SFilter.set skips unchanged values)
        const ef = this.ef;
        if (glide) {
          const tL = mlog2(fcL), tR = mlog2(fcR);
          this.tl0 = tL; this.tl1 = tR;
          if (jump || vr === 0) { ef[0] = tL; ef[1] = tR; this.gl = 0; }
          else {
            this.ga = exp(-this.gq / (fs * 0.05 * vr * vr));             // τ = 0.05·var² s
            this.gl = ef[0] !== tL || ef[1] !== tR ? 1 : 0;
          }
        }
        this.jmp = jump; this.fresh = 0; this.dirty = 0;
        // ramp length of the ramped controls: the samples since the previous change (one chunk while modulated), ≤ rM;
        // a jump sets them at once
        this.rl = jump ? 0 : this.ns > 0 ? this.ns : this.rM;
        this.ns = 0;
        this.coef(glide ? pow(2, ef[0]) : fcL, glide ? pow(2, ef[1]) : fcR);
      }
      // one SMOOTH step: log2 fc moves toward the targets by the factor ga (gq samples); within 1e-9 octave it arrives
      glide() {
        const ef = this.ef, a = this.ga, tL = this.tl0, tR = this.tl1;
        let e0 = tL + (ef[0] - tL) * a, e1 = tR + (ef[1] - tR) * a;
        if (e0 - tL < 1e-9 && e0 - tL > -1e-9) e0 = tL;
        if (e1 - tR < 1e-9 && e1 - tR > -1e-9) e1 = tR;
        ef[0] = e0; ef[1] = e1;
        if (e0 === tL && e1 === tR) this.gl = 0;
        this.coef(pow(2, e0), pow(2, e1));
      }
      coef(fL, fR) {
        const fs = this.fs, hi = 0.45 * fs, co = this.co, res = this.res, vr = this.vr, f = this.f, mw = this.mw;
        const rC = this.rC, rI = this.rI, rT = this.rT, rN = this.rN, rl = this.rl;
        for (let ch = 0; ch < 2; ch++) {
          let fc = ch ? fR : fL;
          fc = fc > 8 ? (fc < hi ? fc : hi) : 8;
          const c = ch * NC;
          if (f === WASP || f === PZSVF || f === EXPMM || f === DJM) {
            let g, t = 1, hp = 0;
            if (f === DJM) {
              let p = log(fc / MIDI0) / DJ_L;
              p = p > 0 ? (p < 1 ? p : 1) : 0;
              let fd;
              if (p <= 0.5) { fd = 20 * pow(1000, 2 * (p < 0.49 ? p : 0.49) / 0.98); t = p < 0.49 ? 1 : (0.5 - p) / 0.01; }
              else { fd = 20 * pow(1000, ((p > 0.51 ? p : 0.51) - 0.51) / 0.49); t = p > 0.51 ? 1 : (p - 0.5) / 0.01; hp = 1; }
              fd = fd > 8 ? (fd < hi ? fd : hi) : 8;
              g = prew(fd, fs);
            } else g = prew(fc, fs);
            if (f === DJM) this.djmSide(ch, c, hp, t);       // before the coefficients change (a crossing keeps the old)
            const kr = K0 * (1 - 0.99 * res);
            co[c] = g; co[c + 1] = kr; co[c + 2] = K0 - kr;  // g, small-signal k, r (saturating resonance part)
            const a1 = 1 / (1 + g * (g + kr));
            co[c + 3] = a1; co[c + 4] = g * a1; co[c + 5] = g * g * a1;
            co[c + 6] = t;
          } else if (f === DIFF) {
            const Rm = diffRmax(fs), R = fs / fc < Rm ? fs / fc : Rm;     // fc ≥ the floor (20 Hz; 20·fs/192000 above)
            let any = 0;
            for (let j = 0; j < DIFF_N; j++) {
              let d = R * DIFF_M[j];
              if (d < 1.5) d = 1.5;
              const N = floor(d - 0.5), D = d - N;             // integer part N ≥ 1, Thiran fraction D ∈ [0.5, 1.5)
              co[c + j] = N; co[c + DIFF_N + j] = (1 - D) / (1 + D);
              const q = ch * DIFF_N + j;                       // the delay ramps per sample to d (pDiffG)
              rT[q] = d;
              if (rl === 0) rC[q] = d;
              else if (rC[q] !== d) { rI[q] = (d - rC[q]) / rl; any = 1; }
              else rI[q] = 0;
            }
            rN[ch] = any ? rl : 0;
          } else if (f === LAD2 || f === DIRTY) {
            const lv = f === DIRTY ? L_MG : this.lv;
            if (lv === L_ACID) {
              const g = prew(fc, fs) / ACID_W, b = 1 + 1.5 * g, a = -g, cu = -0.5 * g;
              // Thomas elimination of T = tridiag(a, b, cu) (constant diagonals): w_i, c'_i
              const w1 = b, c1 = cu / w1, w2 = b - a * c1, c2 = cu / w2, w3 = b - a * c2, c3 = cu / w3, w4 = b - a * c3;
              co[c] = g; co[c + 1] = a; co[c + 2] = 1 / w1; co[c + 3] = 1 / w2; co[c + 4] = 1 / w3; co[c + 5] = 1 / w4;
              co[c + 6] = c1; co[c + 7] = c2; co[c + 8] = c3;
              // t = T⁻¹ e1
              let r1 = 1 / w1, r2 = (0 - a * r1) / w2, r3 = (0 - a * r2) / w3, r4 = (0 - a * r3) / w4;
              const t4 = r4, t3 = r3 - c3 * t4, t2 = r2 - c2 * t3, t1 = r1 - c1 * t2;
              co[c + 9] = t1; co[c + 10] = t2; co[c + 11] = t3; co[c + 12] = t4;
              co[c + 13] = ACID_K * res;
            } else {
              const g = prew(fc, fs);
              co[c] = g / (1 + g);                            // G
              co[c + 13] = (lv === L_EMS ? 3.6 : 4.1) * res;
              if (lv === L_EMS) {
                let fh = 0.25 * fc;
                fh = fh > 8 ? fh : 8;
                const gh = prew(fh, fs);
                co[c + 1] = gh / (1 + gh);                    // Gh
              }
            }
          } else if (f === COMB2) {
            const fa = fc > LINE_FLOOR_HZ ? fc : LINE_FLOOR_HZ;
            let f2 = fa * pow(2, 4 * (vr - 0.5));                       // FRQ2 ratio from the clamped fc
            f2 = f2 > LINE_FLOOR_HZ ? (f2 < hi ? f2 : hi) : LINE_FLOOR_HZ;
            const D1 = fs / fa, D2 = fs / f2, q = 2 * ch;               // the read delays ramp per sample (pComb)
            co[c] = D1; co[c + 1] = D2; rT[q] = D1; rT[q + 1] = D2;
            if (rl === 0) { rC[q] = D1; rC[q + 1] = D2; rN[ch] = 0; }
            else if (rC[q] !== D1 || rC[q + 1] !== D2) { rI[q] = (D1 - rC[q]) / rl; rI[q + 1] = (D2 - rC[q + 1]) / rl; rN[ch] = rl; }
            else rN[ch] = 0;
          } else {                                             // K35
            const g = prew(fc, fs);
            co[c] = g / (1 + g);
          }
        }
        // shared (both channels)
        if (f === COMB2) { const fb = 0.9995 * res; this.cfb = fb; this.cnrm = sqrt(1 - fb * fb); }
        else if (f === K35) this.kk = 2 * res;
        else if (f === DIFF) {
          const S = 1 + round(15 * vr), jump = this.jmp;
          if (S > this.sR) {                                  // stages started now begin from empty lines (at their target
            for (let ch = 0; ch < 2; ch++) for (let j = this.sR; j < S; j++) {   // delay); mid-stream their delayed path
              const q = ch * DIFF_N + j;                      // fades in (rp ramp)
              this.lc[q] = 0; this.lw[q] = 0; this.st[ch * NS + j] = 0; this.rp[q] = jump ? 1 : 0;
              rC[q] = rT[q]; rI[q] = 0;
            }
            this.sR = S;
          }
          this.dS = S; this.dg2 = 0.3 + 0.6 * res;
          if (jump) { this.sg = S; this.sR = S; this.sq = 0; }   // a jump (after make / reset / setRate) runs exactly S stages
        } else if (f === WASP || f === EXPMM) {
          const m = vr;
          if (f === EXPMM && this.bpo) { mw[0] = 0; mw[1] = 1; mw[2] = 0; }
          else if (m < 0.5) { mw[0] = 1; mw[1] = 0; mw[2] = 2 * m; }      // lp·1 + bp·0 + hp·(2m) (notch = lp + hp)
          else { mw[0] = 2 - 2 * m; mw[1] = 0; mw[2] = 1; }
        } else if (f === PZSVF) this.pzw();
      }
      // DJ Mixer side hp (0 LP, 1 HP) and weight t of channel ch for a set() (called by coef BEFORE co[c…c+5] change):
      // a crossing of the centre first fades the side whose state runs (cur) to dry, see pDjm
      djmSide(ch, c, hp, t) {
        const co = this.co, rC = this.rC, rI = this.rI, rN = this.rN, pf = this.pf, rl = this.rl, s = this.st, b = ch * NS;
        const cur = pf[ch] ? co[c + 14] : co[c + 7];
        this.rT[ch] = t;
        if (rl === 0 || (pf[ch] === 0 && cur !== hp && rC[ch] === 0)) {      // a jump, or a crossing while already dry
          if (cur !== hp) { s[b] = 0; s[b + 2] = 0; s[b + 1] = hp ? 0 : s[b + 3]; }
          pf[ch] = 0; co[c + 7] = hp;
          if (rl === 0) { rC[ch] = t; rN[ch] = 0; } else { rI[ch] = t / rl; rN[ch] = rl; }
          return;
        }
        if (cur === hp) {                                    // same side (a crossing under way is cancelled)
          pf[ch] = 0; co[c + 7] = hp;
          if (rC[ch] !== t) { rI[ch] = (t - rC[ch]) / rl; rN[ch] = rl; } else rN[ch] = 0;
          return;
        }
        if (pf[ch] === 0) {                                  // a crossing starts: keep the old side's coefficients
          for (let j = 0; j < 6; j++) co[c + 8 + j] = co[c + j];
          co[c + 14] = cur; pf[ch] = 1;
          rI[ch] = -rC[ch] / rl; rN[ch] = rl;                // fade the old side out over rl samples
        }
        co[c + 7] = hp; co[c + 15] = rl;                     // then fade the new side in over rl samples
      }
      // PZ SVF output weights (cl, cb, ch) = bilinear of the corners at (X, Y) (§6.13.4)
      pzw() {
        const X = this.x, Y = this.y, c = this.pz, mw = this.mw;
        const a = (1 - X) * (1 - Y), b = X * (1 - Y), d = (1 - X) * Y, e = X * Y;
        for (let k = 0; k < 3; k++) mw[k] = a * c[k] + b * c[3 + k] + d * c[6 + k] + e * c[9 + k];
      }
      setXY(x, y) {
        x = clamp01(x); y = clamp01(y);
        if (x === this.x && y === this.y) return;
        this.x = x; this.y = y;
        if (this.f === PZSVF) this.pzw();
      }
      setPZ(c, off = 0) {
        const o = off > 0 ? floor(off) : 0;
        if (c === null || typeof c !== 'object' || !(c.length >= o + 12)) {
          warnOnce('setPZ', 'setPZ: c must hold 12 corner values from off (PZ_DEFAULT layout); ignored');
          return;
        }
        const pz = this.pz;
        for (let j = 0; j < 12; j++) {
          const v = c[o + j];
          pz[j] = v > -1 ? (v < 1 ? +v : 1) : (v <= -1 ? -1 : pz[j]);   // NaN keeps the previous corner value
        }
        if (this.f === PZSVF) this.pzw();
      }
      tick(xl, xr) {
        const T = this.T1;
        T[0] = xl; T[1] = xr;
        this.block(T, T, 0, 1, 1);
        this.yl = T[0]; this.yr = T[1];
      }
      process(L, R, off, n) {
        if (!(n > 0)) return;
        this.block(L, R, off, n, 0);
        this.yl = L[off + n - 1]; this.yr = R[off + n - 1];
        this.flush();
      }
      // the SMOOTH glide steps on a fixed grid of gq samples counted from make/reset/setRate (gc), so tick and process
      // split a block at the same samples and stay bit-identical
      block(L, R, off, n, t1) {
        const ns = this.ns + n;
        this.ns = ns < this.rM ? ns : this.rM;
        if (this.gl === 0) { this.gc = (this.gc + n) % this.gq; this.run(L, R, off, n, t1); return; }
        let o = off, left = n;
        while (left > 0) {
          if (this.gc === 0 && this.gl === 1) this.glide();
          let m = this.gq - this.gc;
          if (m > left) m = left;
          this.run(L, R, o, m, t1);
          this.gc = (this.gc + m) % this.gq; o += m; left -= m;
        }
      }
      // one family loop per channel; `t1` = tick mode (L and R are the same 2-element scratch: channel ch at index ch)
      run(L, R, off, n, t1) {
        for (let ch = 0; ch < 2; ch++) {
          const X = ch ? R : L, o = t1 ? ch : off, e = o + n;
          switch (this.f) {
            case WASP: this.pWasp(X, o, e, ch); break;
            case DJM: this.pDjm(X, o, e, ch); break;
            case PZSVF: case EXPMM: this.pSvf(X, o, e, ch); break;
            case DIFF: this.pDiff(X, o, e, ch); break;
            case LAD2: case DIRTY:
              if (this.f === LAD2 && this.lv === L_ACID) this.pAcid(X, o, e, ch);
              else if (this.f === LAD2 && this.lv === L_EMS) this.pEms(X, o, e, ch);
              else this.pLad(X, o, e, ch);
              break;
            case COMB2: this.pComb(X, o, e, ch); break;
            default: this.pK35(X, o, e, ch); break;
          }
        }
        if (this.f === DIFF) {
          this.sg = this.sgN;                                // both channels ran the same STAGES glide
          // warm stages above S that the output has not used for DIFF_RAMP_S stop running (back to the steady path; a
          // later increase restarts them from empty lines with the fade-in). sq counts per sample, so tick and process
          // drop them at the same block boundaries, and dropped stages never reach the output: no sample changes
          if (this.sR > this.dS && this.sq * this.wR >= 1) this.sR = this.dS;
        }
      }
      /* ---- wasp: SVF with saturating integrator inputs (secant gains of the previous sample), morph LP → N → HP */
      pWasp(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, co = this.co, g = co[c], k = co[c + 1];
        const dg = this.dg, bias = 0.05 * this.drive, wl = this.mw[0], wh = this.mw[2];
        let s1 = s[b], s2 = s[b + 1], e1 = s[b + 2], e2 = s[b + 3];
        for (let i = o; i < e; i++) {
          const u = X[i] * dg;
          const a1 = e1 + bias, a2 = e2 + bias;
          const G1 = g / (1 + (a1 < 0 ? -a1 : a1)), G2 = g / (1 + (a2 < 0 ? -a2 : a2));
          const hp = (u - (k + G2) * s1 - s2) / (1 + G1 * (k + G2));
          const bp = G1 * hp + s1;
          s1 = 2 * bp - s1;
          const lp = G2 * bp + s2;
          s2 = 2 * lp - s2;
          e1 = hp; e2 = bp;
          const y = wl * lp + wh * hp;
          X[i] = y <= 8 && y >= -8 ? y : lim(y);
        }
        s[b] = s1; s[b + 1] = s2; s[b + 2] = e1; s[b + 3] = e2;
      }
      /* ---- clean SVF with the Phase-1 saturating resonance: PZ SVF, Exp MM / BPF */
      pSvf(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, co = this.co;
        const g = co[c], kr = co[c + 1], r = co[c + 2], b1 = co[c + 3], b2 = co[c + 4], b3 = co[c + 5];
        const dg = this.dg, mw = this.mw, wl = mw[0], wb = mw[1], wh = mw[2];   // y = wl·lp + wb·(k·v1) + wh·hp
        let ic1 = s[b], ic2 = s[b + 1], bp = s[b + 2];
        for (let i = o; i < e; i++) {
          const x = sc(X[i] * dg);
          let a1 = b1, a2 = b2, a3 = b3, k = kr;
          if (r > 0) {
            k = K0 - r * tg(0.5 * bp);
            a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
          }
          const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; bp = v1;
          const kb = k * v1, hp = x - kb - v2;
          const y = wl * v2 + wb * kb + wh * hp;
          X[i] = y <= 8 && y >= -8 ? y : lim(y);
        }
        s[b] = ic1; s[b + 1] = ic2; s[b + 2] = bp;
      }
      /* ---- DJ Mixer: the same SVF, y = (1 − t)·x + t·(lp or hp); t ramps per sample to its target (rC → rT over rN
       * samples). Crossing the centre (pf = 1): the old side (its coefficients saved at co[c + 8…13], side co[c + 14])
       * fades to dry (t → 0), then the shared state is reseeded to the new side's steady state (HP: empty; LP: DC of the
       * last input) and the new side fades in from t = 0 over co[c + 15] samples — the reseed happens at t = 0, so it
       * never reaches the output, and neither side's weight jumps */
      pDjm(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, co = this.co, dg = this.dg, rC = this.rC, rI = this.rI, rN = this.rN;
        let pend = this.pf[ch], cb = pend ? c + 8 : c;
        let g = co[cb], kr = co[cb + 1], r = co[cb + 2], b1 = co[cb + 3], b2 = co[cb + 4], b3 = co[cb + 5];
        let hpm = pend ? co[c + 14] : co[c + 7], tt = pend ? 0 : co[c + 6];
        let rk = rN[ch], tc = rC[ch], ti = rI[ch];
        let ic1 = s[b], ic2 = s[b + 1], bp = s[b + 2], x = s[b + 3];
        for (let i = o; i < e; i++) {
          if (rk > 0) { rk--; tc = rk === 0 ? tt : tc + ti; }
          x = sc(X[i] * dg);
          let a1 = b1, a2 = b2, a3 = b3, k = kr;
          if (r > 0) {
            k = K0 - r * tg(0.5 * bp);
            a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
          }
          const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; bp = v1;
          const y = x + tc * ((hpm ? x - k * v1 - v2 : v2) - x);
          X[i] = y <= 8 && y >= -8 ? y : lim(y);
          if (pend && rk === 0) {                             // the old side has faded out: switch sides
            pend = 0;
            ic1 = 0; bp = 0; ic2 = co[c + 7] ? 0 : x;
            g = co[c]; kr = co[c + 1]; r = co[c + 2]; b1 = co[c + 3]; b2 = co[c + 4]; b3 = co[c + 5];
            hpm = co[c + 7]; tt = co[c + 6]; tc = 0;
            rk = co[c + 15]; ti = tt / rk;
          }
        }
        s[b] = ic1; s[b + 1] = ic2; s[b + 2] = bp; s[b + 3] = x;   // x: the last (limited) input, for an LP reseed
        rC[ch] = tc; rN[ch] = rk; rI[ch] = ti; this.pf[ch] = pend;
      }
      /* ---- Diffusor: S Schroeder allpasses, integer delay + Thiran fraction (stage by stage over the block: the stages
       * are in series and each depends only on its own input sequence, so this equals sample-by-sample processing) */
      pDiff(X, o, e, ch) {
        const P = this.pool, s = this.st, sb = ch * NS, c = ch * NC, co = this.co, S = this.dS, g = this.dg2, dg = this.dg;
        const lb = this.lb, ln = this.ln, lw = this.lw, lc = this.lc, q0 = ch * DIFF_N, rp = this.rp;
        for (let i = o; i < e; i++) X[i] = sc(X[i] * dg);
        let steady = this.sg === S && this.sR === S && this.rN[ch] === 0;
        if (steady) for (let j = 0; j < S; j++) if (rp[q0 + j] !== 1) { steady = false; break; }
        if (!steady) { this.pDiffG(X, o, e, ch); return; }
        this.sgN = S;
        for (let j = 0; j < S; j++) {
          const q = q0 + j, N = co[c + j] | 0, eta = co[c + DIFF_N + j], L = ln[q], base = lb[q];
          let w = lw[q], cnt = lc[q], ap = s[sb + j];
          let r = w - N; if (r < 0) r += L;
          let r2 = r - 1; if (r2 < 0) r2 += L;
          if (cnt > N) {                                      // both reads valid for the whole block (cnt only grows)
            for (let i = o; i < e; i++) {
              ap = eta * P[base + r] + P[base + r2] - eta * ap;
              let vv = X[i] + g * ap;
              if (vv < 1e-30 && vv > -1e-30) vv = 0;
              P[base + w] = vv;
              X[i] = ap - g * vv;
              r2 = r; r = r + 1 < L ? r + 1 : 0; w = w + 1 < L ? w + 1 : 0;
            }
            cnt = cnt + (e - o) < L ? cnt + (e - o) : L;
          } else {
            for (let i = o; i < e; i++) {
              const a = N <= cnt ? P[base + r] : 0, bb = N < cnt ? P[base + r2] : 0;
              ap = eta * a + bb - eta * ap;
              let vv = X[i] + g * ap;
              if (vv < 1e-30 && vv > -1e-30) vv = 0;
              P[base + w] = vv;
              X[i] = ap - g * vv;
              r2 = r; r = r + 1 < L ? r + 1 : 0; w = w + 1 < L ? w + 1 : 0;
              if (cnt < L) cnt++;
            }
          }
          lw[q] = w; lc[q] = cnt; s[sb + j] = ap;
        }
        for (let i = o; i < e; i++) { const v = X[i]; X[i] = v <= 8 && v >= -8 ? v : lim(v); }
      }
      /* ---- Diffusor while STAGES changes (general path): the running stages sR (≥ S) process the block in pieces of
       * ≤ DB samples; s̃ moves toward S by gR per sample and the output is the tap after ⌊s̃⌋ stages blended with the tap
       * after ⌈s̃⌉ (tap k = the signal after k stages); a stage started mid-stream (rp < 1) scales its delayed path by rp,
       * which rises by wR per sample once both its reads hold written samples. Per-sample arithmetic as pDiff, so a
       * steady stage gives the same samples as the steady path. */
      pDiffG(X, o, e, ch) {
        const P = this.pool, s = this.st, sb = ch * NS, c = ch * NC, co = this.co, S = this.dS, g = this.dg2;
        const lb = this.lb, ln = this.ln, lw = this.lw, lc = this.lc, q0 = ch * DIFF_N, rp = this.rp;
        const sR = this.sR, gR = this.gR, wR = this.wR, Y = this.dY, G = this.dG;
        const rC = this.rC, rI = this.rI, rT = this.rT;
        let sg = this.sg, sq = this.sq;
        for (let p = o; p < e; p += DB) {
          const pe = e - p < DB ? e : p + DB, m = pe - p, rem = this.rN[ch];
          for (let k = 0; k < m; k++) {
            const d = S - sg;
            sg = d > gR ? sg + gR : d < -gR ? sg - gR : S;
            G[k] = sg;
            sq = sg === S ? sq + 1 : 0;                       // samples at rest (channel 0 keeps the count)
          }
          // the output is the chain itself when s̃ rests at S = sR over the piece (s̃ is monotone): no tap blend
          const plain = sR === S && G[0] === S && G[m - 1] === S;
          for (let j = 0; j < sR; j++) {
            const q = q0 + j, N = co[c + j] | 0, eta = co[c + DIFF_N + j], L = ln[q], base = lb[q];
            let w = lw[q], cnt = lc[q], ap = s[sb + j], rho = rp[q];
            let r = w - N; if (r < 0) r += L;
            let r2 = r - 1; if (r2 < 0) r2 += L;
            if (rem > 0) {
              // the delay ramps per sample (a cutoff change): integer part and Thiran fraction per sample, d → its
              // target exactly at the ramp's end (then the same arithmetic as the steady loops)
              let d = rC[q], rk = rem;
              const di = rI[q], dt = rT[q];
              for (let i = p; i < pe; i++) {
                if (rk > 0) { rk--; d = rk === 0 ? dt : d + di; }
                const Ni = (d - 0.5) | 0, D = d - Ni, et = (1 - D) / (1 + D);   // d ≥ 1.5: | 0 = floor
                let ri = w - Ni; if (ri < 0) ri += L;
                let rj = ri - 1; if (rj < 0) rj += L;
                const a = Ni <= cnt ? P[base + ri] : 0, bb = Ni < cnt ? P[base + rj] : 0;
                ap = et * a + bb - et * ap;
                if (rho < 1 && Ni < cnt) { rho += wR; if (rho > 1) rho = 1; }
                const ae = rho * ap;
                let vv = X[i] + g * ae;
                if (vv < 1e-30 && vv > -1e-30) vv = 0;
                P[base + w] = vv;
                X[i] = ae - g * vv;
                w = w + 1 < L ? w + 1 : 0;
                if (cnt < L) cnt++;
              }
              rC[q] = d;
            } else if (rho === 1 && cnt > N) {
              for (let i = p; i < pe; i++) {
                ap = eta * P[base + r] + P[base + r2] - eta * ap;
                let vv = X[i] + g * ap;
                if (vv < 1e-30 && vv > -1e-30) vv = 0;
                P[base + w] = vv;
                X[i] = ap - g * vv;
                r2 = r; r = r + 1 < L ? r + 1 : 0; w = w + 1 < L ? w + 1 : 0;
              }
              cnt = cnt + m < L ? cnt + m : L;
            } else {
              for (let i = p; i < pe; i++) {
                const a = N <= cnt ? P[base + r] : 0, bb = N < cnt ? P[base + r2] : 0;
                ap = eta * a + bb - eta * ap;
                if (rho < 1 && N < cnt) { rho += wR; if (rho > 1) rho = 1; }
                const ae = rho * ap;
                let vv = X[i] + g * ae;
                if (vv < 1e-30 && vv > -1e-30) vv = 0;
                P[base + w] = vv;
                X[i] = ae - g * vv;
                r2 = r; r = r + 1 < L ? r + 1 : 0; w = w + 1 < L ? w + 1 : 0;
                if (cnt < L) cnt++;
              }
            }
            lw[q] = w; lc[q] = cnt; s[sb + j] = ap; rp[q] = rho;
            if (plain) continue;
            // tap j + 1 into the output blend
            const t = j + 1;
            for (let k = 0; k < m; k++) {
              const v = G[k], f = v | 0, u = v - f;
              if (f === t) Y[k] = u === 0 ? X[p + k] : X[p + k] * (1 - u);
              else if (f + 1 === t) Y[k] += X[p + k] * u;
            }
          }
          this.rN[ch] = rem > m ? rem - m : 0;
          if (plain) for (let k = p; k < pe; k++) { const v = X[k]; X[k] = v <= 8 && v >= -8 ? v : lim(v); }
          else for (let k = 0; k < m; k++) { const v = Y[k]; X[p + k] = v <= 8 && v >= -8 ? v : lim(v); }
        }
        this.sgN = sg;
        if (ch === 0) this.sq = sq < 1e9 ? sq : 1e9;
      }
      /* ---- MG Ladder / MG Dirty: the Phase-1 ladder (tanh stages, secant ZDF), tap y4 */
      pLad(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, co = this.co, G = co[c], k = co[c + 13], a = 1 - G;
        const dirty = this.f === DIRTY, dg = this.dg * (dirty ? 1 + 15 * this.vr * this.vr : 1);
        let s0 = s[b], s1 = s[b + 1], s2 = s[b + 2], s3 = s[b + 3], y0p = s[b + 4], y1p = s[b + 5], y2p = s[b + 6], y3p = s[b + 7];
        let up = s[b + 8];
        for (let i = o; i < e; i++) {
          const x = X[i] * dg;
          const g0 = G * tg(up * IV), g1 = G * tg(y0p * IV), g2 = G * tg(y1p * IV), g3 = G * tg(y2p * IV);
          const kf = dirty ? k * tg(2 * y3p) : k;                  // MG Dirty: k·tanh(2·y4)/2 (unity-normalised, RULINGS2 D3)
          const B0 = a * s0, B1 = g1 * B0 + a * s1, B2 = g2 * B1 + a * s2, B3 = g3 * B2 + a * s3;
          const A3 = g0 * g1 * g2 * g3;
          const u = (x - kf * B3) / (1 + kf * A3);
          const y0 = g0 * u + B0, y1 = g1 * y0 + a * s1, y2 = g2 * y1 + a * s2, y3 = g3 * y2 + a * s3;
          s0 = 2 * y0 - s0; s1 = 2 * y1 - s1; s2 = 2 * y2 - s2; s3 = 2 * y3 - s3;
          y0p = y0; y1p = y1; y2p = y2; y3p = y3; up = u;
          X[i] = y3 <= 8 && y3 >= -8 ? y3 : lim(y3);
        }
        s[b] = s0; s[b + 1] = s1; s[b + 2] = s2; s[b + 3] = s3; s[b + 4] = y0p; s[b + 5] = y1p; s[b + 6] = y2p; s[b + 7] = y3p;
        s[b + 8] = up;
      }
      /* ---- Acid: 0.5-coupled diode ladder, TPT (tridiagonal solve), input saturation, output 2·y4 */
      pAcid(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, co = this.co;
        const g = co[c], a = co[c + 1], iw1 = co[c + 2], iw2 = co[c + 3], iw3 = co[c + 4], iw4 = co[c + 5];
        const c1 = co[c + 6], c2 = co[c + 7], c3 = co[c + 8], t1 = co[c + 9], t2 = co[c + 10], t3 = co[c + 11], t4 = co[c + 12];
        const K = co[c + 13], dg = this.dg;
        let s1 = s[b], s2 = s[b + 1], s3 = s[b + 2], s4 = s[b + 3], vp = s[b + 4];
        for (let i = o; i < e; i++) {
          const x = X[i] * dg, sg = tg(vp * IV);                  // u = V·tanh((x − K·2y4)/V) ≈ sg·(x − 2K·y4)
          // z = T⁻¹ (g·sg·x·e1 + s)
          const r1 = (g * sg * x + s1) * iw1, r2 = (s2 - a * r1) * iw2, r3 = (s3 - a * r2) * iw3, r4 = (s4 - a * r3) * iw4;
          const z4 = r4, z3 = r3 - c3 * z4, z2 = r2 - c2 * z3, z1 = r1 - c1 * z2;
          const q = 2 * g * sg * K, y4 = z4 / (1 + q * t4), cc = q * y4;
          const y1 = z1 - cc * t1, y2 = z2 - cc * t2, y3 = z3 - cc * t3;
          s1 = 2 * y1 - s1; s2 = 2 * y2 - s2; s3 = 2 * y3 - s3; s4 = 2 * y4 - s4;
          vp = x - 2 * K * y4;
          const y = 2 * y4;
          X[i] = y <= 8 && y >= -8 ? y : lim(y);
        }
        s[b] = s1; s[b + 1] = s2; s[b + 2] = s3; s[b + 3] = s4; s[b + 4] = vp;
      }
      /* ---- EMS: linear 4-pole ladder, feedback k·HP(y4) with the HP one-pole at fc/4 (exact ZDF) */
      pEms(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, co = this.co, G = co[c], Gh = co[c + 1], k = co[c + 13], a = 1 - G;
        const dg = this.dg, A3 = G * G * G * G, kh = k * (1 - Gh);
        let s0 = s[b], s1 = s[b + 1], s2 = s[b + 2], s3 = s[b + 3], sh = s[b + 4];
        for (let i = o; i < e; i++) {
          const x = sc(X[i] * dg);
          const B0 = a * s0, B1 = G * B0 + a * s1, B2 = G * B1 + a * s2, B3 = G * B2 + a * s3;
          const u = (x - kh * (B3 - sh)) / (1 + kh * A3);
          const y0 = G * u + B0, y1 = G * y0 + a * s1, y2 = G * y1 + a * s2, y3 = G * y2 + a * s3;
          s0 = 2 * y0 - s0; s1 = 2 * y1 - s1; s2 = 2 * y2 - s2; s3 = 2 * y3 - s3;
          const lh = Gh * (y3 - sh) + sh;
          sh = 2 * lh - sh;
          X[i] = y3 <= 8 && y3 >= -8 ? y3 : lim(y3);
        }
        s[b] = s0; s[b + 1] = s1; s[b + 2] = s2; s[b + 3] = s3; s[b + 4] = sh;
      }
      /* ---- Comb 2: two saturating feedback combs in series */
      pComb(X, o, e, ch) {
        const P = this.pool, c = ch * NC, co = this.co, T1 = co[c], T2 = co[c + 1], fb = this.cfb, nrm = this.cnrm, dg = this.dg;
        const lb = this.lb, ln = this.ln, lw = this.lw, lc = this.lc, qa = ch * 2, qb = qa + 1;
        const La = ln[qa], Lb = ln[qb], ba = lb[qa], bbs = lb[qb];
        const rC = this.rC, i1 = this.rI[qa], i2 = this.rI[qb];
        let wa = lw[qa], wb = lw[qb], ca = lc[qa], cb = lc[qb], bad = 0;
        let D1 = rC[qa], D2 = rC[qb], rk = this.rN[ch];          // read delays, ramping per sample to T1, T2
        for (let i = o; i < e; i++) {
          if (rk > 0) {
            rk--;
            if (rk === 0) { D1 = T1; D2 = T2; } else { D1 += i1; D2 += i2; }
          }
          const x = X[i] * dg;
          // comb 1 at D1
          let d = 0;
          if (D1 <= ca) {
            let r = wa - D1; if (r < 0) r += La;
            const j = r | 0, f = r - j, p0 = P[ba + j];
            d = p0 + f * (P[ba + (j + 1 < La ? j + 1 : 0)] - p0);
          }
          let y1 = x + fb * 1.5 * (0.6666666666666666 * d) * tg(0.6666666666666666 * d);
          if (y1 < 1e-30 && y1 > -1e-30) y1 = 0;
          P[ba + wa] = y1; wa = wa + 1 < La ? wa + 1 : 0; if (ca < La) ca++;
          // comb 2 at D2
          d = 0;
          if (D2 <= cb) {
            let r = wb - D2; if (r < 0) r += Lb;
            const j = r | 0, f = r - j, p0 = P[bbs + j];
            d = p0 + f * (P[bbs + (j + 1 < Lb ? j + 1 : 0)] - p0);
          }
          let y2 = y1 + fb * 1.5 * (0.6666666666666666 * d) * tg(0.6666666666666666 * d);
          if (y2 < 1e-30 && y2 > -1e-30) y2 = 0;
          P[bbs + wb] = y2; wb = wb + 1 < Lb ? wb + 1 : 0; if (cb < Lb) cb++;
          if (!(y2 < 1e9 && y2 > -1e9)) bad = 1;              // non-finite / runaway: the whole state is in the lines
          const y = y2 * nrm;
          X[i] = y <= 8 && y >= -8 ? y : lim(y);
        }
        lw[qa] = wa; lw[qb] = wb; lc[qa] = ca; lc[qb] = cb;
        rC[qa] = D1; rC[qb] = D2; this.rN[ch] = rk;
        this.st[ch * NS + C_BAD] = bad ? 1e30 : 0;              // flush() resets the object (Phase-1 runaway rule)
      }
      /* ---- K35: LP1 → (+ HP feedback) → LP2, ZDF, loop sum through tanh */
      pK35(X, o, e, ch) {
        const s = this.st, b = ch * NS, c = ch * NC, G = this.co[c], a = 1 - G, K = this.kk, dg = this.dg;
        const den = 1 / (1 - K * G * a), ka = K * a * a;
        let s1 = s[b], s2 = s[b + 1], s3 = s[b + 2];
        for (let i = o; i < e; i++) {
          const x = X[i] * dg;
          const y1 = G * x + a * s1;
          s1 = 2 * y1 - s1;
          let u = (y1 + ka * s2 - a * s3) * den;
          u = u * tg(u);
          const y = G * u + a * s2;
          s2 = 2 * y - s2;
          const lh = G * (K * y - s3) + s3;
          s3 = 2 * lh - s3;
          X[i] = y <= 8 && y >= -8 ? y : lim(y);
        }
        s[b] = s1; s[b + 1] = s2; s[b + 2] = s3;
      }
      // clears every state; a SMOOTH glide under way snaps to its target (no stale glided cutoff on the next note, even
      // when the owner does not call set() again), a Diffusor runs exactly its S stages again, the glide grid restarts
      reset() {
        this.st.fill(0);
        if (this.nl > 0) { this.lc.fill(0); this.lw.fill(0); }
        this.yl = 0; this.yr = 0;
        this.fresh = 1; this.dirty = 1; this.gc = 0; this.ns = 0; this.sq = 0;
        this.rC.set(this.rT); this.rN.fill(0); this.pf.fill(0);   // control ramps snap to their targets
        if (this.f === DIFF) { this.rp.fill(1); this.sR = this.dS; this.sg = this.dS; this.sgN = this.dS; }
        if (this.gl !== 0) {
          const ef = this.ef;
          ef[0] = this.tl0; ef[1] = this.tl1; this.gl = 0;
          this.coef(pow(2, ef[0]), pow(2, ef[1]));
        }
      }
      // denormal flush of the states; a non-finite or runaway state resets the object (Phase-1 SFilter rule)
      flush() {
        const s = this.st;
        let bad = 0;
        for (let i = 0; i < 2 * NS; i++) {
          const v = s[i];
          if (v < 1e-30 && v > -1e-30) s[i] = 0;
          else if (!(v < 1e9 && v > -1e9)) bad = 1;
        }
        if (bad) {
          const fL = this.fcL, fR = this.fcR, r = this.res, d = this.drive, v = this.vr;
          this.reset();
          this.set(fL, fR, r, d, v);
        }
      }
      setRate(fs) {
        if (!isRate(fs)) { warnOnce('setRate', 'setRate: fs must be a finite rate > 0; ignored'); return; }
        const shared = this.own === null && this.pool !== null ? this.pool : null;
        this.fs = fs;
        this.rates();
        if (this.nl > 0) { this.layout(shared); this.count(); }
        this.dirty = 1; this.fresh = 1; this.gl = 0;
        this.set(this.fcL, this.fcR, this.res, this.drive, this.vr);
      }
    }

    function make(type, fs, pool = null) {
      if (!isType(type)) { warnOnce('make.type', 'make: type must be an integer ' + FIRST + '–' + LAST + ' (got ' + type + ')'); return null; }
      if (!isRate(fs)) { warnOnce('make.fs', 'make: fs must be a finite rate > 0 (got ' + fs + ')'); return null; }
      return new Filt2(type, fs, pool);
    }

    function impulse(type, fc, res, drive, vr, fs, len = 4096, x = 0, y = 0, pz = null) {
      if (!isType(type)) throw new RangeError('SxFilt2.impulse: type must be an integer ' + FIRST + '–' + LAST);
      if (!isRate(fs)) throw new RangeError('SxFilt2.impulse: fs must be a finite rate > 0');
      const hasPZ = pz !== null && pz !== undefined;
      if (hasPZ && !(typeof pz === 'object' && pz.length >= 12)) throw new TypeError('SxFilt2.impulse: pz must hold 12 corner values');
      const f = new Filt2(type, fs, null), out = new Float64Array(len > 0 ? floor(len) : 0);
      f.setXY(x, y);
      if (hasPZ) f.setPZ(pz, 0);
      f.set(fc, fc, res, drive, vr);
      for (let i = 0; i < out.length; i++) {
        f.tick(i === 0 ? 0.01 : 0, i === 0 ? 0.01 : 0);
        out[i] = f.yl / 0.01;
      }
      return out;
    }

    globalThis.SxFilt2 = Object.freeze({
      VER, FIRST, LAST, NTYPES, IDS, FAMILY, FAM, PZ_DEFAULT, LINE_FLOOR_HZ, need, make, impulse,
    });
  } catch (err) {
    globalThis.SxFilt2 = null;                                 // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-filt2: load failed', err);
  }
})();
