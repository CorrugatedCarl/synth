/*
 * fx-dsp.js — Serum-style FX rack DSP (classic script, no imports/exports). Owner E4.
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread (<script> injected by wk.loadDSP) and in
 * node vm contexts (tests). The whole file is one IIFE that publishes `globalThis.FXDSP`; it can be evaluated again in
 * the same scope, and a failure inside leaves FXDSP = null without throwing. `globalThis.SerumDSP` (SFilter for the
 * Filter module, filterImpulse) is read lazily inside functions, never at load.
 * Contract: SPEC-serum.md §8.5 (exports, FXRack, module recipes, shapers), §4.2 (FXP / FXT), §5.4–§5.5 (FX smoothing
 * and modulation), §6.15 (master / bypass output stage), §3.10–§3.13 (ladders, enumerations, FX destinations).
 *
 * Implementation notes (IMPL choices within the spec):
 * - Parameters: per process() call ("span", ≤ 128 frames) the base n is smoothed by a one-pole (τ = 10 ms × smooth)
 *   and the setMods offsets are reached linearly across the call; eff n = clamp(base + mod) is re-evaluated at the end
 *   of every 16-sample block (the coefficient update), so a modulated value moves in 16-sample steps of 16/n of the
 *   total (1/n per sample on average). Stepped laws (switches/enums) take a base change at the first block.
 * - Gains (MIX, LEVEL, master, Hyper/Dimension mixes) are ramped per sample across each block.
 * - Distortion: the shaper runs at 2× through 31-tap half-band polyphase filters (latency 15 base samples); the dry
 *   path of the MIX is delayed by the same 15 samples so the mix does not comb. Downsample mode keeps that latency.
 *   The DC blocker follows the recipe (modes 0, 3, 9, 10, 12, 14), so X-Shaper (Asym) is not stateless for very slow
 *   signals (spec §10.5.14 lists it as stateless; the test compares it against the DC-blocked static curve).
 *   Power on/off: while the module's output weight is 0 the bypassed signal glides between no delay and the 15-sample
 *   latency (5 ms, ≈ 1 semitone at 48 kHz), so the 5 ms output crossfade is between time-aligned signals (no comb
 *   notch mid-fade, no step at either end; the module has run 5 ms before it is heard). Enabling takes 10 ms in all.
 * - Compressor: decoupled peak detector (instant capture, RELEASE one-pole decay) → static curve → ATTACK one-pole on
 *   the gain reduction (a peak detector with symmetric one-poles would average a sine and miss §10.5.5). Multiband:
 *   LR4 crossovers + allpass compensation of the low band (bands sum to an allpass, i.e. 1:1 is transparent); a boost
 *   left from a quiet passage is cut back at once to ≤ 3 dB above the target of a new, louder level (no overshoot).
 *   Detectors, look-ahead line and crossovers run in every mode; a mode change (RATIO ↔ Limit, MULTIBAND) crossfades
 *   the old and new mode outputs over 5 ms. The module supplies its own MIX dry: input, look-ahead-delayed input
 *   (Limit) or input through the bands' allpass pair (Multiband). Enabling in Limit mode starts the look-ahead line
 *   filled with the first input sample.
 * - Delay: above 96 kHz the lines run at half rate (half-band decimator / interpolator, +30 base samples on every echo)
 *   so all modules plus the FX filter's largest family pool stay within 4 MB at 192 kHz. Lines hold 2 s (§8.5.3):
 *   longer ladder values (2 bar, 4 bar, slow tempos, ×1.5 offsets) are clamped to 2 s.
 * - Feedback paths that can reach unity gain (Delay, Hall at infinite decay) saturate softly above |4| (never reached
 *   in normal use) so extreme settings stay bounded.
 * - Phases (inv A20.1): every LFO keeps running only while its module processes; rate 0 holds (Hyper too: its
 *   rate law 0.1 + 6·rate² Hz applies for rate > 0, rate 0 freezes the voices). Re-seeding (fxp.seed, transport(),
 *   reset(), RETRIG) also restarts the LFO-dependent ramps, so a render after a re-seed does not depend on history.
 *   With nothing audible in the lines (output < 1e-6 for 0.25 s of zero input, or a cleared rack) a re-seed is
 *   immediate and also restarts the other free-running phases and counters (Dimension AM, reverb modulation,
 *   Downsample hold, half-rate grids, the FX filter's S&H / ring phases): renders after a silent history are
 *   bit-identical to a fresh rack's (§10.7f). While a module sounds, its re-seed waits for a 2.5 ms duck of that
 *   module (output → input), restarts it there and fades it back in (5 ms); phases() reports the new phase at once.
 *   The reverb's internal modulation is not re-seeded while its tail sounds. RETRIG stays immediate.
 * - Enabling a module resets it and fades its delay-line inputs in over 5 ms (besides the 5 ms output crossfade), so
 *   taps do not click when the first signal reaches them. A disabled module is cleared at its next enable. A Plate ↔
 *   Hall change while the reverb sounds ducks it the same way; the new topology starts empty.
 * - Hyper voices use a linear balance law around p = ±(0.3 + 0.1·j), widened ×1.35 with a 0.95 wet trim (calibrated to
 *   the measured +2.5 dB / side −4.5 dB character on saws, averaged over 55–880 Hz: the fixed voice delays comb single
 *   pitches by ±2.5 dB). L + R gain is 1.9 for every voice, so the widening scales the side only (mono sum unchanged).
 *   Plate runs at half rate above 96 kHz (memory budget).
 * - EQ and the Delay band filter run as TPT SVFs with exactly the RBJ transfer functions that eqResponse /
 *   delayFilterResponse evaluate (biquads misbehave under fast coefficient modulation).
 * - reset(false) (Panic, engine restore) clears and snaps at once; until audio is processed the next set() snaps and
 *   re-seeds like a first call (a warmed-up processor and a fresh one render identically), afterwards edits glide
 *   again. set(null) does not consume that first snap. reset(true) fades audible tails out over 5 ms (idle() is false
 *   until process() has rendered it) and clears at once when nothing is audible; parameters keep gliding.
 * - idle(): no module enabled, or every enabled module's output < 1e-6 for 1 s of zero input plus the longest delay
 *   line gap (an echo can still be in flight).
 * - warmUp() exercises every module and mode on a temporary rack (same classes ⇒ the JIT state is shared), then
 *   reset()s this rack; the temporary buffers are garbage afterwards (memory budget of the idle rack is kept).
 */
(function () {
  'use strict';
  try {
    // Math functions as locals: in a node vm context every global lookup goes through the context interceptor. The
    // typed-array constructors stay global lookups on purpose: they are only used in constructors / set(), and the
    // allocation-free tests (§10.1) replace them on the context to catch hot-path allocation.
    const exp = Math.exp, log = Math.log, sin = Math.sin, cos = Math.cos, tan = Math.tan, pow = Math.pow,
      sqrt = Math.sqrt, floor = Math.floor, ceil = Math.ceil, round = Math.round, tanh = Math.tanh, PI = Math.PI;
    const TAU = 2 * PI, HPI = 0.5 * PI, SQRT2 = Math.SQRT2, LN10 = Math.LN10;
    const DB = 20 / LN10;                                      // 20·log10(x) = DB·ln(x)
    const IDB = LN10 / 20;                                     // 10^(g/20) = exp(IDB·g)

    const VER = 1, NF = 100, NMOD = 10, BLK = 16, SPAN = 128, NXS = 1025;
    const MIDI0 = 440 * Math.pow(2, -69 / 12), MIDI128 = 440 * Math.pow(2, 59 / 12);

    /* ------------------------------------------------------------ FX destinations (§3.13 FX segment, fx idx order) */
    const LIN = 0, INT = 1, ENUM = 2, BOOL = 3, EXP = 4, POW2 = 5, POW3 = 6, POW4 = 7, POW5 = 8, RPOW3 = 9, RATIO = 10;
    const FX_IDS = [], FX_LAW = [], FX_LO = [], FX_HI = [], FX_DEF = [];
    const fd = (id, law, lo, hi, def) => { FX_IDS.push(id); FX_LAW.push(law); FX_LO.push(lo); FX_HI.push(hi); FX_DEF.push(def); };
    const lvl = (m) => fd('fx.' + m + '.level', POW2, 0, 4, 0.5);
    fd('g.master', POW3, 0, 1, 0.7);
    fd('fx.hyper.on', BOOL, 0, 1, 0); fd('fx.hyper.rate', LIN, 0, 1, 0.4); fd('fx.hyper.detune', LIN, 0, 1, 0.25);
    fd('fx.hyper.unison', INT, 0, 7, 4 / 7); fd('fx.hyper.mix', LIN, 0, 1, 0.5); lvl('hyper');
    fd('fx.dim.size', LIN, 0, 1, 0.5); fd('fx.dim.mix', LIN, 0, 1, 0); lvl('dim');
    fd('fx.dist.on', BOOL, 0, 1, 0); fd('fx.dist.drive', LIN, 0, 1, 0.25); fd('fx.dist.lbh', LIN, 0, 1, 0);
    fd('fx.dist.freq', EXP, MIDI0, MIDI128, 0.5); fd('fx.dist.q', EXP, 0.5, 8, 0.5); fd('fx.dist.mix', LIN, 0, 1, 1); lvl('dist');
    fd('fx.flg.on', BOOL, 0, 1, 0); fd('fx.flg.rate', POW4, 0, 20, 0.25); fd('fx.flg.depth', LIN, 0, 1, 1);
    fd('fx.flg.feed', LIN, 0, 1, 0.5); fd('fx.flg.phase', LIN, 0, 360, 0.5); fd('fx.flg.mix', LIN, 0, 1, 1); lvl('flg');
    fd('fx.phs.on', BOOL, 0, 1, 0); fd('fx.phs.rate', POW4, 0, 20, 0.25); fd('fx.phs.depth', LIN, 0, 1, 0.5);
    fd('fx.phs.freq', EXP, 20, 18000, 0.5); fd('fx.phs.feed', LIN, 0, 1, 0.8); fd('fx.phs.phase', LIN, 0, 360, 0.5);
    fd('fx.phs.mix', LIN, 0, 1, 1); lvl('phs');
    fd('fx.cho.on', BOOL, 0, 1, 0); fd('fx.cho.rate', POW4, 0, 20, 0.25); fd('fx.cho.dly1', POW2, 0, 20, 0.5);
    fd('fx.cho.dly2', POW2, 0, 20, 0); fd('fx.cho.depth', POW2, 0, 26, 1); fd('fx.cho.feed', LIN, 0, 0.95, 0.1);
    fd('fx.cho.lpf', EXP, 50, 20000, 0.5); fd('fx.cho.mix', LIN, 0, 1, 0.5); lvl('cho');
    fd('fx.dly.on', BOOL, 0, 1, 0); fd('fx.dly.feed', LIN, 0, 1, 0.4); fd('fx.dly.timeL', POW4, 1, 501, 0.625);
    fd('fx.dly.timeR', POW4, 1, 501, 0.625); fd('fx.dly.offL', LIN, 0.5, 1.5, 0.5); fd('fx.dly.offR', LIN, 0.5, 1.5, 0.5);
    fd('fx.dly.freq', EXP, 40, 18000, 0.5); fd('fx.dly.q', LIN, 0.8, 8.2, 6 / 7.4); fd('fx.dly.mix', LIN, 0, 1, 0.3); lvl('dly');
    fd('fx.cmp.on', BOOL, 0, 1, 0); fd('fx.cmp.thr', RPOW3, 0.000001, 1, 0.5); fd('fx.cmp.ratio', RATIO, 1, 32, 0.75);
    fd('fx.cmp.att', POW2, 0, 1000, 0.3); fd('fx.cmp.rel', POW2, 0, 1000, 0.3); fd('fx.cmp.gain', POW2, 1, 32, 0);
    fd('fx.cmp.mbL', LIN, 0, 2, 0.5); fd('fx.cmp.mbM', LIN, 0, 2, 0.5); fd('fx.cmp.mbH', LIN, 0, 2, 0.5);
    fd('fx.cmp.mix', LIN, 0, 1, 1); lvl('cmp');
    fd('fx.rev.on', BOOL, 0, 1, 0); fd('fx.rev.size', LIN, 0, 1, 0.33); fd('fx.rev.t', LIN, 0, 1, 0.12);
    fd('fx.rev.locut', LIN, 0, 1, 0); fd('fx.rev.c', LIN, 0, 1, 0.25); fd('fx.rev.hicut', LIN, 0, 1, 0.5);
    fd('fx.rev.w', LIN, 0, 1, 0.2); fd('fx.rev.mix', LIN, 0, 1, 0.33); lvl('rev');
    fd('fx.eq.on', BOOL, 0, 1, 0); fd('fx.eq.freqL', EXP, 21.533, 20000, 0.333); fd('fx.eq.qL', LIN, 0, 1, 0.6);
    fd('fx.eq.gainL', LIN, -24, 24, 0.5); fd('fx.eq.freqH', EXP, 21.533, 20000, 0.666); fd('fx.eq.qH', LIN, 0, 1, 0.6);
    fd('fx.eq.gainH', LIN, -24, 24, 0.5);
    fd('fx.fil.on', BOOL, 0, 1, 0); fd('fx.fil.cutoff', EXP, MIDI0, 22050, 0.5); fd('fx.fil.res', LIN, 0, 1, 0);
    fd('fx.fil.drive', LIN, 0, 1, 0); fd('fx.fil.var', LIN, 0, 1, 0); fd('fx.fil.pan', LIN, 0, 1, 0.5);
    fd('fx.fil.mix', LIN, 0, 1, 1); lvl('fil');
    fd('g.bypass', BOOL, 0, 1, 0);
    fd('fx.hyper.retrig', BOOL, 0, 1, 0); fd('fx.dist.mode', ENUM, 0, 15, 0); fd('fx.dist.filt', ENUM, 0, 2, 0);
    fd('fx.flg.bpm', BOOL, 0, 1, 0); fd('fx.phs.bpm', BOOL, 0, 1, 0); fd('fx.cho.bpm', BOOL, 0, 1, 0);
    fd('fx.dly.bpm', BOOL, 0, 1, 1); fd('fx.dly.link', BOOL, 0, 1, 0); fd('fx.dly.mode', ENUM, 0, 2, 0);
    fd('fx.cmp.mb', BOOL, 0, 1, 0); fd('fx.eq.typeL', ENUM, 0, 2, 0); fd('fx.eq.typeH', ENUM, 0, 2, 0);
    fd('fx.fil.type', ENUM, 0, 95, 0);
    if (FX_IDS.length !== NF) throw new Error('FX segment has ' + FX_IDS.length + ' destinations');

    // FIDX: id upper-cased, '.' → '_', 'fx.' prefix dropped (§3.13 naming rule)
    const fidx = {};
    for (let k = 0; k < NF; k++) fidx[FX_IDS[k].replace(/^fx\./, '').toUpperCase().replace(/\./g, '_')] = k;
    const FIDX = Object.freeze(fidx);
    const isCont = (l) => (l === INT || l === ENUM || l === BOOL ? 0 : 1);
    const LAW_TAB_FX = Object.freeze({
      law: Uint8Array.from(FX_LAW), lo: Float64Array.from(FX_LO), hi: Float64Array.from(FX_HI), cont: Uint8Array.from(FX_LAW, isCont),
    });
    // private copies (the exported tables are frozen objects around mutable typed arrays)
    const FLAW = Uint8Array.from(FX_LAW), FLO = Float64Array.from(FX_LO), FHI = Float64Array.from(FX_HI);
    const FCONT = Uint8Array.from(FX_LAW, isCont);

    // modules (§3.11 module index), their enable / mix / level fx idx; MOD_OF[k] = owning module (NMOD = master/bypass)
    const MOD_IDS = ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'];
    const MOD_OF = new Uint8Array(NF);
    for (let k = 0; k < NF; k++) {
      const id = FX_IDS[k], m = id.split('.')[1];
      MOD_OF[k] = id.indexOf('g.') === 0 ? NMOD : m === 'dim' ? 0 : MOD_IDS.indexOf(m);
    }
    const ON = Uint8Array.from(MOD_IDS, (m) => FIDX[m.toUpperCase() + '_ON']);
    // mix kind: 0 = the module produces its final output (Hyper/Dimension additive, EQ), 1 = sin² law, 2 = linear (Filter)
    const MIXK = Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 1, 0, 2]);
    const MIXI = Int8Array.from(MOD_IDS, (m) => (FIDX[m.toUpperCase() + '_MIX'] === undefined ? -1 : FIDX[m.toUpperCase() + '_MIX']));
    const LVLI = Int8Array.from(MOD_IDS, (m) => (FIDX[m.toUpperCase() + '_LEVEL'] === undefined ? -1 : FIDX[m.toUpperCase() + '_LEVEL']));

    // §3.10 ladders (beats): MODFX (index round(n·30), 0 = Off) and DLY (index round(n·11))
    const MODFX_BEATS = Float64Array.from([Infinity, 96, 256 / 3, 64, 48, 128 / 3, 32, 24, 64 / 3, 16, 12, 32 / 3, 8, 6, 16 / 3, 4,
      3, 8 / 3, 2, 1.5, 4 / 3, 1, 0.75, 2 / 3, 0.5, 0.375, 1 / 3, 0.25, 0.1875, 1 / 6, 0.125]);
    const DLY_BEATS = Float64Array.from([1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16]);

    // §3.1 laws (same expressions as serum-core lawValue)
    function lawV(k, n) {
      const lo = FLO[k], hi = FHI[k];
      switch (FLAW[k]) {
        case LIN: return lo + (hi - lo) * n;
        case INT: return round(lo + (hi - lo) * n);
        case ENUM: return round(hi * n);
        case BOOL: return n >= 0.5 ? 1 : 0;
        case EXP: return lo * pow(hi / lo, n);
        case POW2: return lo + (hi - lo) * n * n;
        case POW3: return lo + (hi - lo) * n * n * n;
        case POW4: { const n2 = n * n; return lo + (hi - lo) * n2 * n2; }
        case POW5: { const n2 = n * n; return lo + (hi - lo) * n2 * n2 * n; }
        case RPOW3: { const u = 1 - n, v = hi * u * u * u; return v > lo ? v : lo; }
        case RATIO: { if (n >= 0.9825) return 1e9; const v = 1 / (1 - n); return v < hi ? v : hi; }
        default: return n;
      }
    }
    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);   // NaN → 0
    const frac = (x) => x - floor(x);

    // Flanger / Phaser / Chorus rate in Hz (§3.10, §8.5.1): ladder when BPM is on (index 0 = Off = 0 Hz), else 20·n⁴
    function MODFX_HZ(n, bpmOn, bpm) {
      n = clamp01(+n);
      if (bpmOn) {
        const i = round(n * 30);
        return i === 0 ? 0 : (bpm > 0 ? +bpm : 120) / 60 / MODFX_BEATS[i];
      }
      const n2 = n * n;
      return 20 * n2 * n2;
    }

    /* ------------------------------------------------------------ shared DSP helpers */
    // delay-line reads at fractional delay d ≥ 0 (samples) behind index w (the slot of the current sample), ring P[o, o+c).
    // The interpolation weights depend on d only (not on the ring position), so identical content gives identical bits.
    function rdE(P, o, c, w, d) {                              // linear interpolation
      const di = d | 0, fd = d - di;
      let i1 = w - di;                                         // x[n − di]
      if (i1 < 0) i1 += c;
      const b = P[o + i1];
      if (fd === 0) return b;
      return b + (P[o + (i1 === 0 ? c - 1 : i1 - 1)] - b) * fd;
    }
    function rdH(P, o, c, w, d) {                              // 4-point Hermite (d ≥ 2)
      const di = d | 0, fd = d - di;
      let i1 = w - di;                                         // x[n − di]
      if (i1 < 0) i1 += c;
      if (fd === 0) return P[o + i1];
      const i0 = i1 === 0 ? c - 1 : i1 - 1, im = i0 === 0 ? c - 1 : i0 - 1, i2 = i1 + 1 === c ? 0 : i1 + 1;
      const xm = P[o + im], x0 = P[o + i0], x1 = P[o + i1], x2 = P[o + i2], f = 1 - fd;
      const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
      return ((c3 * f + c2) * f + c1) * f + x0;
    }
    // soft safety limit for feedback writes (identity below |4|, bounded by 5) and denormal guard: keeps feedback paths
    // bounded when extreme parameter jumps pump energy into them (delay-time sweeps under high feedback)
    function sat(v) {
      if (v > 4) return 4 + tanh(v - 4);
      if (v < -4) return -4 - tanh(-4 - v);
      return v < 1e-25 && v > -1e-25 ? 0 : v;
    }
    // TPT SVF tick on s[o] (ic1), s[o+1] (ic2); returns lp, leaves bp in SVO.bp (hp = x − k·bp − lp)
    const SVO = { bp: 0 };
    function svfT(s, o, x, a1, a2, a3) {
      const ic1 = s[o], ic2 = s[o + 1], v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      s[o] = 2 * v1 - ic1; s[o + 1] = 2 * v2 - ic2;
      SVO.bp = v1;
      return v2;
    }
    // SVF coefficients into c[o..o+2] = a1, a2, a3 for cutoff f (clamped to [5, 0.45·fs]) and damping k
    function svfC(f, k, fs, c, o) {
      const hi = 0.45 * fs;
      f = f > 5 ? (f < hi ? f : hi) : 5;
      const g = tan(PI * f / fs), a1 = 1 / (1 + g * (g + k));
      c[o] = a1; c[o + 1] = g * a1; c[o + 2] = g * g * a1;
    }
    // TPT SVF over a block: lp[j] = v2, bp[j] = v1 (hp = x − k·v1 − v2); states s[o], s[o+1]; x may alias lp or bp
    function svfRun(x, n, s, o, a1, a2, a3, lp, bp) {
      let ic1 = s[o], ic2 = s[o + 1];
      for (let j = 0; j < n; j++) {
        const v3 = x[j] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
        lp[j] = v2; bp[j] = v1;
      }
      s[o] = ic1; s[o + 1] = ic2;
    }
    // RBJ biquads, normalised [b0, b1, b2, a1, a2] at c[o]
    function biq(hp, f, Q, fs, c, o) {                         // low-pass (hp = 0) / high-pass (hp = 1)
      const w0 = TAU * f / fs, cw = cos(w0), al = sin(w0) / (2 * Q), a0 = 1 + al;
      const b0 = hp ? (1 + cw) / 2 : (1 - cw) / 2;
      c[o] = b0 / a0; c[o + 1] = (hp ? -(1 + cw) : 1 - cw) / a0; c[o + 2] = b0 / a0;
      c[o + 3] = -2 * cw / a0; c[o + 4] = (1 - al) / a0;
    }
    // |H(e^jw)|² of the normalised biquad at c[o]
    function bqMag2(c, o, w) {
      const c1 = cos(w), s1 = sin(w), c2 = cos(2 * w), s2 = sin(2 * w);
      const nr = c[o] + c[o + 1] * c1 + c[o + 2] * c2, ni = -(c[o + 1] * s1 + c[o + 2] * s2);
      const dr = 1 + c[o + 3] * c1 + c[o + 4] * c2, di = -(c[o + 3] * s1 + c[o + 4] * s2);
      return (nr * nr + ni * ni) / (dr * dr + di * di);
    }
    function flushArr(s) {
      for (let i = 0; i < s.length; i++) { const v = s[i]; if (v < 1e-30 && v > -1e-30) s[i] = 0; }
    }

    // EQ band (§8.5.3): RBJ cookbook, A = 10^(gain/40), Q = 0.25·40^q, α = sin w0/(2Q). type 0 shelf, 1 peak, 2 pass
    // (left band: low shelf / HP; right band: high shelf / LP)
    function eqBand(type, high, F, q, gain, fs, c, o) {
      const hi = 0.48 * fs;
      F = F > 5 ? (F < hi ? F : hi) : 5;
      const Q = 0.25 * pow(40, q);
      if (type === 2) { biq(high ? 0 : 1, F, Q, fs, c, o); return; }
      const A = pow(10, gain / 40), w0 = TAU * F / fs, cw = cos(w0), al = sin(w0) / (2 * Q);
      let b0, b1, b2, a0, a1, a2;
      if (type === 1) {
        b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
      } else {
        const sa = 2 * sqrt(A) * al;
        if (!high) {
          b0 = A * ((A + 1) - (A - 1) * cw + sa); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sa);
          a0 = (A + 1) + (A - 1) * cw + sa; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sa;
        } else {
          b0 = A * ((A + 1) + (A - 1) * cw + sa); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sa);
          a0 = (A + 1) - (A - 1) * cw + sa; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sa;
        }
      }
      c[o] = b0 / a0; c[o + 1] = b1 / a0; c[o + 2] = b2 / a0; c[o + 3] = a1 / a0; c[o + 4] = a2 / a0;
    }
    function eqCoefs(v, fs, c) {                               // v = engine values in fx idx order
      eqBand(v[97], 0, v[72], v[73], v[74], fs, c, 0);
      eqBand(v[98], 1, v[75], v[76], v[77], fs, c, 5);
    }
    // The module runs the same transfer functions as TPT SVFs (Simper's trapezoidal SVF: identical bilinear mapping
    // with prewarp at w0, so |H| equals the RBJ biquad exactly) because SVFs stay well-behaved under fast coefficient
    // changes. c[o..o+5] = a1, a2, a3, m0, m1, m2; y = m0·x + m1·v1 (band) + m2·v2 (low).
    function eqSvf(type, high, F, q, gain, fs, c, o) {
      const hi = 0.48 * fs;
      F = F > 5 ? (F < hi ? F : hi) : 5;
      const Q = 0.25 * pow(40, q), t = tan(PI * F / fs);
      let g = t, k = 1 / Q, m0, m1, m2;
      if (type === 2) {
        if (high) { m0 = 0; m1 = 0; m2 = 1; } else { m0 = 1; m1 = -k; m2 = -1; }
      } else {
        const A = pow(10, gain / 40);
        if (type === 1) { k = 1 / (Q * A); m0 = 1; m1 = k * (A * A - 1); m2 = 0; }
        else if (!high) { g = t / sqrt(A); m0 = 1; m1 = k * (A - 1); m2 = A * A - 1; }
        else { g = t * sqrt(A); m0 = A * A; m1 = k * (1 - A) * A; m2 = 1 - A * A; }
      }
      const a1 = 1 / (1 + g * (g + k));
      c[o] = a1; c[o + 1] = g * a1; c[o + 2] = g * g * a1; c[o + 3] = m0; c[o + 4] = m1; c[o + 5] = m2;
    }
    // two cascaded SVF bands (coefficients c[0..11], states s[o..o+3]) for one sample
    function eq2(c, s, o, x) {
      let ic1 = s[o], ic2 = s[o + 1], v3 = x - ic2, v1 = c[0] * ic1 + c[1] * v3, v2 = ic2 + c[1] * ic1 + c[2] * v3;
      s[o] = 2 * v1 - ic1; s[o + 1] = 2 * v2 - ic2;
      const y = c[3] * x + c[4] * v1 + c[5] * v2;
      ic1 = s[o + 2]; ic2 = s[o + 3]; v3 = y - ic2; v1 = c[6] * ic1 + c[7] * v3; v2 = ic2 + c[7] * ic1 + c[8] * v3;
      s[o + 2] = 2 * v1 - ic1; s[o + 3] = 2 * v2 - ic2;
      return c[9] * y + c[10] * v1 + c[11] * v2;
    }
    // Delay band filter (§8.5.3): HP at F·2^(−bw/2) then LP at F·2^(+bw/2), 2-pole Butterworth each. dlyCoefs gives
    // the biquads (response maths), dlySvf the same pair as TPT SVFs (module): c = HP a1..a3, LP a1..a3
    function dlyFreqs(F, bw, fs, o) {
      const hi = 0.45 * fs;
      let fh = F * pow(2, -bw / 2), fl = F * pow(2, bw / 2);
      o[0] = fh > 5 ? (fh < hi ? fh : hi) : 5;
      o[1] = fl > 5 ? (fl < hi ? fl : hi) : 5;
    }
    function dlyCoefs(F, bw, fs, c) {
      dlyFreqs(F, bw, fs, c);
      const fh = c[0], fl = c[1];
      biq(1, fh, Math.SQRT1_2, fs, c, 0);
      biq(0, fl, Math.SQRT1_2, fs, c, 5);
    }
    function dlySvf(F, bw, fs, c) {
      dlyFreqs(F, bw, fs, c);
      const fh = c[0], fl = c[1];
      svfC(fh, SQRT2, fs, c, 0);
      svfC(fl, SQRT2, fs, c, 3);
    }
    function dlyF(c, s, o, x) {                                // SVF HP then SVF LP (Q = 1/√2)
      let ic1 = s[o], ic2 = s[o + 1], v3 = x - ic2, v1 = c[0] * ic1 + c[1] * v3, v2 = ic2 + c[1] * ic1 + c[2] * v3;
      s[o] = 2 * v1 - ic1; s[o + 1] = 2 * v2 - ic2;
      const h = x - SQRT2 * v1 - v2;
      ic1 = s[o + 2]; ic2 = s[o + 3]; v3 = h - ic2; v1 = c[3] * ic1 + c[4] * v3; v2 = ic2 + c[4] * ic1 + c[5] * v3;
      s[o + 2] = 2 * v1 - ic1; s[o + 3] = 2 * v2 - ic2;
      return v2;
    }
    const DLY_FLAT = 8.19;                                     // Q value ≥ 8.19 (n ≥ 0.999) → band filter bypassed

    /* ------------------------------------------------------------ Distortion shapers (§8.5.4) */
    const LINXS = new Float32Array(NXS);
    for (let j = 0; j < NXS; j++) LINXS[j] = j / 1024;
    const okXS = (t) => !!t && typeof t === 'object' && ArrayBuffer.isView(t) && t.length >= NXS;
    class Shaper {
      constructor() { this.mode = 0; this.G = 0.5; this.a = 0; this.b = 0; this.d = 0; this.xa = LINXS; this.xb = LINXS; }
      set(mode, d) {
        mode = mode > 0 ? (mode < 15 ? round(mode) : 15) : 0;
        d = clamp01(+d);
        this.mode = mode; this.d = d; this.a = 0; this.b = 0;
        switch (mode) {
          case 0: this.G = 0.5 * pow(10, 1.2 * d); this.a = 0.2 * d; this.b = tanh(0.2 * d); break;
          case 1: this.G = 0.5 * pow(10, 0.9 * d); break;
          case 2: this.G = (1 + 4 * d * d * d) / 2; break;
          case 3: this.G = 1 + 9 * d * d; break;
          case 4: this.G = 1.8 * (1 + 3 * d); break;
          case 5: this.G = 0.5 + 14 * d; break;
          case 6: this.G = 0.5 + 6 * d; break;
          case 7: this.G = 0.5 * (1 + 15 * d * d); this.a = 0.1 * d; this.b = 1 + d; break;
          case 8: this.G = 1; this.a = pow(2, 8 * d); break;      // hold length (samples)
          case 9: this.G = 0.5 * (1 + 12 * d * d); break;
          case 10: this.G = 0.5 * (1 + 4 * d * d); this.a = 2 * d < 1 ? 2 * d : 1; break;
          case 11: case 12: this.G = 1; break;
          case 13: this.G = 0.5 * (1 + 3 * d); break;
          case 14: this.G = 0.5 * pow(10, 1.3 * d); break;
          default: this.G = 0.5 * pow(10, 0.8 * d); break;
        }
      }
    }
    function xsRd(t, p) {                                      // X-Shaper table at p ∈ [0, 1] (linear interpolation)
      const q = p * 1024;
      let i = q | 0;
      if (i > 1023) i = 1023;
      const a = t[i];
      return a + (t[i + 1] - a) * (q - i);
    }
    // static shaper y(x); Stomp Box here is its static core (the module adds its HP/LP), Downsample is the identity
    function shape(S, x) {
      const G = S.G;
      switch (S.mode) {
        case 0: return tanh(G * x + S.a) - S.b;
        case 1: { const u = G * x; return u < 1.5 && u > -1.5 ? u - u * u * u / 6.75 : u > 0 ? 1 : -1; }
        case 2: { const u = G * x; return u > 1 ? 1 : u < -1 ? -1 : u; }
        case 3: { const u = G * x; return u >= 0 ? 0.9 * (1 - exp(-2 * u)) : -0.7 * (1 - exp(2 * u)); }
        case 4: { const u = G * x; return sin(u > HPI ? HPI : u < -HPI ? -HPI : u); }
        case 5: { let t = G * x + 1; t -= 4 * floor(0.25 * t); return t < 2 ? t - 1 : 3 - t; }   // (2/π)·asin(sin(π·u/2))
        case 6: return sin(HPI * G * x);
        case 7: {
          const u = G * x, a = u < 0 ? -u : u;
          if (a < S.a) return 0;
          const y = a < 1 ? pow(a, S.b) : 1;
          return u < 0 ? -y : y;
        }
        case 8: return x;
        case 9: { const u = G * x; return u >= 0 ? tanh(1.2 * u) : tanh(0.6 * u); }
        case 10: { const u = G * x, y = u >= 0 ? u : -S.a * u; return y > 1 ? 1 : y; }
        case 11: {
          let v = 0.5 * x;
          v = v > 1 ? 1 : v < -1 ? -1 : v;
          const a = v < 0 ? -v : v, A = xsRd(S.xa, a), y = A + S.d * (xsRd(S.xb, a) - A);
          return v < 0 ? -y : y;
        }
        case 12: {
          let v = 0.5 * x;
          v = v > 1 ? 1 : v < -1 ? -1 : v;
          const p = 0.5 * (v + 1), A = xsRd(S.xa, p);
          return 2 * (A + S.d * (xsRd(S.xb, p) - A)) - 1;
        }
        case 13: { const u = G * x; return sin(HPI * (u > 1 ? 1 : u < -1 ? -1 : u)); }
        case 14: { const u = G * x; return tanh(1.5 * (u + 0.25 * u * u)) * (2 / 3); }
        default: { const u = G * x; return u / sqrt(1 + u * u); }
      }
    }

    // 31-tap half-band (Kaiser β 7): HB[i] = tap at offset 2i − 15 from the centre (centre tap 0.5); Σ HB = 0.5
    const HB = (() => {
      const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; };
      const h = new Float64Array(16);
      let sum = 0;
      for (let i = 0; i < 16; i++) {
        const k = 2 * i - 15, r = k / 16;
        h[i] = (sin(HPI * k) / (PI * k)) * I0(7 * sqrt(1 - r * r)) / I0(7);
        sum += h[i];
      }
      for (let i = 0; i < 16; i++) h[i] *= 0.5 / sum;
      return h;
    })();
    const DIST_LAT = 15;                                       // up + down latency in base samples

    /* ------------------------------------------------------------ modules */
    // Hyper (7-voice micro-delay unison) + Dimension (4-line side widener), §8.5.3. Voice j sits at p = ±(0.3 + 0.1·j)
    // (even j left, reading the L line; odd j right, reading the R line) with a linear balance law widened ×1.35 and a
    // 0.95 wet trim: calibrated on saws 55–880 Hz to the measured character (mix 1: ≈ +2.4 dB total, side ≈ −5 dB).
    // L + R = 1.9 per voice: the widening (small negative gains on the far side of voices 5 and 6) moves only the side;
    // a non-negative law reaches side ≈ −7.4 dB at the same total, or −4.5 dB only with the total at +3.8 dB.
    const HY_PAN_L = new Float64Array(7), HY_PAN_R = new Float64Array(7);
    for (let j = 0; j < 7; j++) {
      const p = ((j & 1) === 0 ? -1 : 1) * (0.3 + 0.1 * j);
      HY_PAN_L[j] = 0.95 * (1 - 1.35 * p); HY_PAN_R[j] = 0.95 * (1 + 1.35 * p);
    }
    const DIM_MS = Float64Array.from([7.3, 11.9, 17.1, 23.3]), DIM_HZ = Float64Array.from([0.13, 0.17, 0.23, 0.29]);
    const DIM_SG = Float64Array.from([1, -1, 1, -1]);
    class Hyper {
      constructor(fs) {
        this.fs = fs;
        this.lL = null; this.lR = null; this.lD = null; this.cap = 0; this.capD = 0; this.w = 0; this.wD = 0;
        this.ph = new Float64Array(7); this.d0 = new Float64Array(7); this.g0 = new Float64Array(7); this.g1 = new Float64Array(7);
        this.am = new Float64Array(4); this.a0 = new Float64Array(4); this.t0 = new Float64Array(4); this.t1 = new Float64Array(4);
        this.rate = 0; this.det = 0; this.mx0 = 0; this.mx1 = 0; this.lv0 = 1; this.lv1 = 1;
        this.dm0 = 0; this.dm1 = 0; this.dl0 = 1; this.dl1 = 1;
        this.ir = 1; this.ist = 1 / (0.005 * fs);              // line-input fade-in after an enable (no arrival clicks)
      }
      alloc() {
        this.cap = ceil(0.018 * this.fs) + 8; this.capD = ceil(0.047 * this.fs) + 8;
        this.lL = new Float32Array(this.cap); this.lR = new Float32Array(this.cap); this.lD = new Float32Array(this.capD);
      }
      reset() {
        if (this.lL) { this.lL.fill(0); this.lR.fill(0); this.lD.fill(0); }
        this.w = 0; this.wD = 0; this.ir = 1;
      }
      seed(p0) {                                               // re-seed (RETRIG, transport, preset): ramps restart there
        for (let j = 0; j < 7; j++) { this.ph[j] = frac(p0 + 0.618 * j); this.d0[j] = this.vd(j); }
        this.am.fill(0);
        for (let q = 0; q < 4; q++) this.a0[q] = 1;
      }
      vd(j) { return (1.5 + 2.2 * j + 3 * this.det * (0.5 + 0.5 * sin(TAU * this.ph[j]))) * this.fs / 1000; }
      upd(R) {
        const ev = R.ev, n = R.en[2];
        this.rate = n > 0 ? 0.1 + 6 * n * n : 0;              // RATE 0 freezes the voices (phase memory, inv A20.1)
        this.det = ev[3];
        const N = ev[4], g = N > 0 ? 1 / sqrt(N) : 0;
        for (let j = 0; j < 7; j++) this.g1[j] = j < N ? g : 0;
        this.mx1 = ev[5]; this.lv1 = ev[6];
        const k = (0.3 + 1.7 * ev[7]) * this.fs / 1000;
        for (let q = 0; q < 4; q++) this.t1[q] = k * DIM_MS[q];
        this.dm1 = ev[8]; this.dl1 = ev[9];
      }
      snap() {
        for (let j = 0; j < 7; j++) { this.g0[j] = this.g1[j]; this.d0[j] = this.vd(j); }
        for (let q = 0; q < 4; q++) { this.t0[q] = this.t1[q]; this.a0[q] = 1 + 0.3 * sin(TAU * this.am[q]); }
        this.mx0 = this.mx1; this.lv0 = this.lv1; this.dm0 = this.dm1; this.dl0 = this.dl1;
      }
      run(R, L, Rc, o, m) {
        const fs = this.fs, cap = this.cap, lL = this.lL, lR = this.lR, wl = R.wL, wr = R.wR, w0 = this.w, ir0 = this.ir, ist = this.ist;
        let w = w0, ir = ir0;
        for (let j = 0; j < m; j++) {
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          lL[w] = L[o + j] * ir; lR[w] = Rc[o + j] * ir; wl[j] = 0; wr[j] = 0;
          w = w + 1 === cap ? 0 : w + 1;
        }
        this.w = w; this.ir = ir;
        const inc = m / fs, rate = this.rate;
        for (let v = 0; v < 7; v++) {
          const p = frac(this.ph[v] + rate * (0.83 + 0.11 * v) * inc);
          this.ph[v] = p;
          const d1 = this.vd(v), d0 = this.d0[v], g0 = this.g0[v], g1 = this.g1[v];
          this.d0[v] = d1; this.g0[v] = g1;
          if (g0 === 0 && g1 === 0) continue;
          const line = (v & 1) === 0 ? lL : lR, pl = HY_PAN_L[v], pr = HY_PAN_R[v], dd = (d1 - d0) / m, dg = (g1 - g0) / m;
          let wi = w0;
          for (let j = 0; j < m; j++) {
            const x = rdE(line, 0, cap, wi, d0 + dd * (j + 1)) * (g0 + dg * (j + 1));
            wl[j] += pl * x; wr[j] += pr * x;
            wi = wi + 1 === cap ? 0 : wi + 1;
          }
        }
        // Hyper section: out = LEVEL·(in + MIX·wet) (additive, §8.5.2)
        const mx0 = this.mx0, lv0 = this.lv0, dmx = (this.mx1 - mx0) / m, dlv = (this.lv1 - lv0) / m;
        this.mx0 = this.mx1; this.lv0 = this.lv1;
        for (let j = 0; j < m; j++) {
          const i = o + j, mx = mx0 + dmx * (j + 1), lv = lv0 + dlv * (j + 1);
          L[i] = lv * (L[i] + mx * wl[j]); Rc[i] = lv * (Rc[i] + mx * wr[j]);
        }
        // Dimension: mono feed, 4 AM'd taps summed out of phase → side only
        const lD = this.lD, cD = this.capD, wd0 = this.wD;
        let wd = wd0, jr = ir0;
        for (let j = 0; j < m; j++) {
          if (jr < 1) { jr += ist; if (jr > 1) jr = 1; }
          lD[wd] = 0.5 * (L[o + j] + Rc[o + j]) * jr;
          wd = wd + 1 === cD ? 0 : wd + 1;
        }
        this.wD = wd;
        const am = this.am, a0 = this.a0, t0 = this.t0, t1 = this.t1;
        const dm0 = this.dm0, dm1 = this.dm1, dl0 = this.dl0, dl1 = this.dl1;
        this.dm0 = dm1; this.dl0 = dl1;
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0;                    // AM gains at block end
        for (let q = 0; q < 4; q++) {
          am[q] = frac(am[q] + DIM_HZ[q] * inc);
          const a = 1 + 0.3 * sin(TAU * am[q]);
          if (q === 0) b0 = a; else if (q === 1) b1 = a; else if (q === 2) b2 = a; else b3 = a;
        }
        if (dm0 !== 0 || dm1 !== 0) {
          const s0 = t0[0], s1 = t0[1], s2 = t0[2], s3 = t0[3];
          const e0 = (t1[0] - s0) / m, e1 = (t1[1] - s1) / m, e2 = (t1[2] - s2) / m, e3 = (t1[3] - s3) / m;
          const c0 = a0[0], c1 = a0[1], c2 = a0[2], c3 = a0[3];
          const f0 = (b0 - c0) / m, f1 = (b1 - c1) / m, f2 = (b2 - c2) / m, f3 = (b3 - c3) / m;
          const ddm = (dm1 - dm0) / m, ddl = (dl1 - dl0) / m;
          let wi = wd0;
          for (let j = 0; j < m; j++) {
            const k = j + 1, i = o + j;
            const side = 0.5 * ((c0 + f0 * k) * rdE(lD, 0, cD, wi, s0 + e0 * k) - (c1 + f1 * k) * rdE(lD, 0, cD, wi, s1 + e1 * k)
              + (c2 + f2 * k) * rdE(lD, 0, cD, wi, s2 + e2 * k) - (c3 + f3 * k) * rdE(lD, 0, cD, wi, s3 + e3 * k));
            const sd = 0.45 * (dm0 + ddm * k) * side, lv = dl0 + ddl * k;
            L[i] = lv * (L[i] + sd); Rc[i] = lv * (Rc[i] - sd);
            wi = wi + 1 === cD ? 0 : wi + 1;
          }
        } else if (dl0 !== 1 || dl1 !== 1) {
          const ddl = (dl1 - dl0) / m;
          for (let j = 0; j < m; j++) { const lv = dl0 + ddl * (j + 1), i = o + j; L[i] *= lv; Rc[i] *= lv; }
        }
        a0[0] = b0; a0[1] = b1; a0[2] = b2; a0[3] = b3;
        t0[0] = t1[0]; t0[1] = t1[1]; t0[2] = t1[2]; t0[3] = t1[3];
      }
    }

    // Distortion: OFF/PRE/POST TPT SVF (LP/BP/HP morph), shaper at 2× (half-band polyphase), DC blocker, §8.5.3–8.5.4
    class Dist {
      constructor(fs) {
        this.fs = fs;
        this.S = new Shaper();
        this.xh = new Float64Array(64); this.eh = new Float64Array(64); this.oh = new Float64Array(64); this.rh = new Float64Array(64);
        this.p = 0; this.acc = 0;
        // enable / disable glide of the dry path between 0 and DIST_LAT samples (managed by the rack, see xfadeD)
        this.v = 0; this.v0 = 0; this.vdir = 0; this.need = 0; this.gst = DIST_LAT / (0.005 * fs);
        this.sv = new Float64Array(4); this.dc = new Float64Array(4); this.sb = new Float64Array(6); this.hd = new Float64Array(2);
        this.filt = 0; this.mode = 0; this.asym = 0;
        this.k = 1; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.wl = 1; this.wb = 0; this.wh = 0;
        this.dcR = 1 - TAU * 5 / fs;
        this.hpA = exp(-TAU * 720 / (2 * fs)); this.lpK = 1 - exp(-TAU * 6000 / (2 * fs));   // Stomp Box filters at 2×
      }
      reset() {
        this.xh.fill(0); this.eh.fill(0); this.oh.fill(0); this.rh.fill(0); this.p = 0; this.acc = 0;
        this.sv.fill(0); this.dc.fill(0); this.sb.fill(0); this.hd.fill(0);
      }
      seed() { this.acc = 1e9; }                               // Downsample: the next sample starts a hold (re-seed point)
      upd(R) {
        const ev = R.ev, fs = this.fs;
        const mode = ev[88];
        this.mode = mode; this.filt = ev[89];
        this.S.xa = R.xsA; this.S.xb = R.xsB;
        this.S.set(mode, ev[11]);
        this.asym = mode === 0 || mode === 3 || mode === 9 || mode === 10 || mode === 12 || mode === 14 ? 1 : 0;
        this.k = 1 / ev[14];
        const c = R.cf;
        svfC(ev[13], this.k, fs, c, 0);
        this.a1 = c[0]; this.a2 = c[1]; this.a3 = c[2];
        const l = ev[12];
        if (l <= 0.5) { this.wl = 1 - 2 * l; this.wb = 2 * l; this.wh = 0; } else { this.wl = 0; this.wb = 2 - 2 * l; this.wh = 2 * l - 1; }
      }
      run(R, L, Rc, o, m) {
        const S = this.S, xh = this.xh, eh = this.eh, oh = this.oh, rh = this.rh, sv = this.sv, dc = this.dc, sb = this.sb;
        const filt = this.filt, mode = this.mode, asym = this.asym, k = this.k, a1 = this.a1, a2 = this.a2, a3 = this.a3;
        const wl = this.wl, wb = this.wb, wh = this.wh, dcR = this.dcR, hpA = this.hpA, lpK = this.lpK, hold = S.a;
        const h0 = HB[0], h1 = HB[1], h2 = HB[2], h3 = HB[3], h4 = HB[4], h5 = HB[5], h6 = HB[6], h7 = HB[7];
        const p0 = this.p, acc0 = this.acc, need = this.need, vdir = this.vdir, v0 = this.v, gst = this.gst;
        let pe = p0, acc = acc0;
        for (let c = 0; c < 2; c++) {
          const X = c === 0 ? L : Rc, DY = c === 0 ? R.dyL : R.dyR, DV = c === 0 ? R.dvL : R.dvR, b = c << 5;
          let p = p0, ic1 = sv[2 * c], ic2 = sv[2 * c + 1], dx = dc[2 * c], dy = dc[2 * c + 1], hd = this.hd[c];
          let hx = sb[3 * c], hy = sb[3 * c + 1], ly = sb[3 * c + 2];
          acc = acc0;
          for (let j = 0; j < m; j++) {
            const i = o + j;
            let x = X[i];
            p = (p + 15) & 15;
            const q = b + p;
            rh[q] = x; rh[q + 16] = x;
            DY[j] = rh[q + DIST_LAT];
            if (need === 1) {                                   // dry at the glide delay (fractional, 0…DIST_LAT)
              let vj = vdir > 0 ? v0 + j * gst : vdir < 0 ? v0 - j * gst : v0;   // ≤ samples since the enable
              vj = vj > DIST_LAT ? DIST_LAT : vj < 0 ? 0 : vj;
              const di = vj | 0, f = vj - di;
              let a = rh[q + di];
              if (f > 0) a += f * (rh[q + di + 1] - a);
              DV[j] = a;
            }
            if (filt === 1) {
              const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
              ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
              x = wl * v2 + wb * k * v1 + wh * (x - k * v1 - v2);
            }
            xh[q] = x; xh[q + 16] = x;
            const we = 2 * (h0 * (xh[q] + xh[q + 15]) + h1 * (xh[q + 1] + xh[q + 14]) + h2 * (xh[q + 2] + xh[q + 13])
              + h3 * (xh[q + 3] + xh[q + 12]) + h4 * (xh[q + 4] + xh[q + 11]) + h5 * (xh[q + 5] + xh[q + 10])
              + h6 * (xh[q + 6] + xh[q + 9]) + h7 * (xh[q + 7] + xh[q + 8]));
            const wo = xh[q + 7];
            let ve, vo;
            if (mode === 14) {                                  // Stomp Box: HP 720 Hz → shaper → LP 6 kHz (at 2×)
              hy = hpA * (hy + we - hx); hx = we; ly += lpK * (shape(S, hy) - ly); ve = ly;
              hy = hpA * (hy + wo - hx); hx = wo; ly += lpK * (shape(S, hy) - ly); vo = ly;
            } else {
              ve = shape(S, we); vo = shape(S, wo);
            }
            eh[q] = ve; eh[q + 16] = ve; oh[q] = vo; oh[q + 16] = vo;
            let y = h0 * (eh[q] + eh[q + 15]) + h1 * (eh[q + 1] + eh[q + 14]) + h2 * (eh[q + 2] + eh[q + 13])
              + h3 * (eh[q + 3] + eh[q + 12]) + h4 * (eh[q + 4] + eh[q + 11]) + h5 * (eh[q + 5] + eh[q + 10])
              + h6 * (eh[q + 6] + eh[q + 9]) + h7 * (eh[q + 7] + eh[q + 8]) + 0.5 * oh[q + 8];
            if (mode === 8) {                                   // Downsample: 0.5·held(x), fractional hold length
              acc += 1;
              if (acc >= hold) { acc -= hold; if (acc >= hold) acc = 0; hd = y; }
              y = 0.5 * hd;
            }
            if (filt === 2) {
              const v3 = y - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
              ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
              y = wl * v2 + wb * k * v1 + wh * (y - k * v1 - v2);
            }
            const yd = y - dx + dcR * dy;                       // 5 Hz DC blocker (always tracking; used for asym modes)
            dx = y; dy = yd;
            X[i] = asym === 1 ? yd : y;
          }
          sv[2 * c] = ic1; sv[2 * c + 1] = ic2; dc[2 * c] = dx; dc[2 * c + 1] = dy; this.hd[c] = hd;
          sb[3 * c] = hx; sb[3 * c + 1] = hy; sb[3 * c + 2] = ly;
          pe = p;
        }
        this.p = pe; this.acc = acc; this.v0 = v0;
        if (vdir !== 0) { const v = vdir > 0 ? v0 + m * gst : v0 - m * gst; this.v = v > DIST_LAT ? DIST_LAT : v < 0 ? 0 : v; }
      }
      flush() { flushArr(this.sv); flushArr(this.dc); flushArr(this.sb); }
    }

    // Flanger: d = 0.25 + 15.75·depth·(0.5 − 0.5·cos 2πφ) ms, φR = φL + PHASE, feedback 0.95·feed, wet = (in + delayed)/2
    class Flanger {
      constructor(fs) {
        this.fs = fs; this.lL = null; this.lR = null; this.cap = 0; this.w = 0;
        this.ph = 0; this.d0L = 0; this.d0R = 0; this.rate = 0; this.depth = 1; this.fb = 0; this.off = 0.5;
        this.ir = 1; this.ist = 1 / (0.005 * fs);
      }
      alloc() { this.cap = ceil(0.0165 * this.fs) + 8; this.lL = new Float32Array(this.cap); this.lR = new Float32Array(this.cap); }
      reset() { if (this.lL) { this.lL.fill(0); this.lR.fill(0); } this.w = 0; this.ir = 1; }
      upd(R) {
        const ev = R.ev, en = R.en;
        this.rate = MODFX_HZ(en[18], en[90] >= 0.5, R.bpm);
        this.depth = ev[19]; this.fb = 0.95 * ev[20]; this.off = ev[21] / 360;
      }
      dly(ph) { return (0.25 + 15.75 * this.depth * (0.5 - 0.5 * cos(TAU * ph))) * this.fs / 1000; }
      snap() { this.d0L = this.dly(this.ph); this.d0R = this.dly(this.ph + this.off); }
      seed(p) { this.ph = p; this.snap(); }
      run(R, L, Rc, o, m) {
        const cap = this.cap, fb = this.fb;
        const p = frac(this.ph + this.rate * m / this.fs);
        this.ph = p;
        const d1L = this.dly(p), d1R = this.dly(p + this.off), w0 = this.w, ir0 = this.ir, ist = this.ist;
        let w = w0, ir = ir0;
        for (let c = 0; c < 2; c++) {
          const X = c === 0 ? L : Rc, line = c === 0 ? this.lL : this.lR, d0 = c === 0 ? this.d0L : this.d0R;
          const dd = ((c === 0 ? d1L : d1R) - d0) / m;
          w = w0; ir = ir0;
          for (let j = 0; j < m; j++) {
            const i = o + j, x = X[i], y = rdH(line, 0, cap, w, d0 + dd * (j + 1));
            if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
            line[w] = sat(x * ir + fb * y);
            X[i] = 0.5 * (x + y);
            w = w + 1 === cap ? 0 : w + 1;
          }
        }
        this.w = w; this.ir = ir; this.d0L = d1L; this.d0R = d1R;
      }
    }

    // Phaser: 6 first-order allpasses per channel at f = freq·2^(depth·4·(0.5 − 0.5·cos 2πφ) − 2·depth); the feedback
    // 0.95·feed from the chain output is solved without a unit delay (rate-independent resonances)
    class Phaser {
      constructor(fs) {
        this.fs = fs; this.s = new Float64Array(12);
        this.ph = 0; this.a0L = 0; this.a0R = 0; this.rate = 0; this.depth = 0.5; this.freq = 600; this.fb = 0; this.off = 0.5;
      }
      reset() { this.s.fill(0); }
      upd(R) {
        const ev = R.ev, en = R.en;
        this.rate = MODFX_HZ(en[25], en[91] >= 0.5, R.bpm);
        this.depth = ev[26]; this.freq = ev[27]; this.fb = 0.95 * ev[28]; this.off = ev[29] / 360;
      }
      coef(ph) {
        const fs = this.fs, hi = 0.45 * fs;
        let f = this.freq * pow(2, this.depth * 4 * (0.5 - 0.5 * cos(TAU * ph)) - 2 * this.depth);
        f = f > 5 ? (f < hi ? f : hi) : 5;
        const t = tan(PI * f / fs);
        return (t - 1) / (t + 1);
      }
      snap() { this.a0L = this.coef(this.ph); this.a0R = this.coef(this.ph + this.off); }
      seed(p) { this.ph = p; this.snap(); }
      run(R, L, Rc, o, m) {
        const p = frac(this.ph + this.rate * m / this.fs);
        this.ph = p;
        const a1L = this.coef(p), a1R = this.coef(p + this.off), s = this.s, fb = this.fb;
        for (let c = 0; c < 2; c++) {
          const X = c === 0 ? L : Rc, a0 = c === 0 ? this.a0L : this.a0R, da = ((c === 0 ? a1L : a1R) - a0) / m, b = 6 * c;
          let s0 = s[b], s1 = s[b + 1], s2 = s[b + 2], s3 = s[b + 3], s4 = s[b + 4], s5 = s[b + 5];
          for (let j = 0; j < m; j++) {
            const i = o + j, x = X[i], a = a0 + da * (j + 1);
            // zero-delay feedback: the chain output is y = A·u + B (A = a⁶, B from the stage states), u = x + fb·y
            const a2 = a * a, A = a2 * a2 * a2, B = ((((s0 * a + s1) * a + s2) * a + s3) * a + s4) * a + s5;
            let u = x + fb * (A * x + B) / (1 - fb * A), t;
            if (u > 4 || u < -4) u = sat(u);
            t = a * u + s0; s0 = u - a * t; u = t;
            t = a * u + s1; s1 = u - a * t; u = t;
            t = a * u + s2; s2 = u - a * t; u = t;
            t = a * u + s3; s3 = u - a * t; u = t;
            t = a * u + s4; s4 = u - a * t; u = t;
            t = a * u + s5; s5 = u - a * t; u = t;
            X[i] = 0.5 * (x + u);
          }
          s[b] = s0; s[b + 1] = s1; s[b + 2] = s2; s[b + 3] = s3; s[b + 4] = s4; s[b + 5] = s5;
        }
        this.a0L = a1L; this.a0R = a1R;
      }
      flush() { flushArr(this.s); }
    }

    // Chorus: taps L1/L2/R1/R2 (θ 0, π, π/2, 3π/2; mono: R uses L's θ), per-line feedback, wet LP 2-pole at LPF
    const CHO_TH = Float64Array.from([0, PI, HPI, 1.5 * PI]), CHO_TH_MONO = Float64Array.from([0, PI, 0, PI]);
    class Chorus {
      constructor(fs) {
        this.fs = fs; this.buf = null; this.cap = 0; this.w = 0; this.ph = 0;
        this.d0 = new Float64Array(4); this.d1 = new Float64Array(4); this.lp = new Float64Array(4); this.c = new Float64Array(3);
        this.rate = 0; this.t1 = 5; this.t2 = 0; this.dep = 26; this.fb = 0.095; this.mono = 0;
        this.ir = 1; this.ist = 1 / (0.005 * fs);
      }
      alloc() { this.cap = ceil(0.0465 * this.fs) + 8; this.buf = new Float32Array(4 * this.cap); }
      reset() { if (this.buf) this.buf.fill(0); this.w = 0; this.lp.fill(0); this.ir = 1; }
      upd(R) {
        const ev = R.ev, en = R.en;
        this.rate = MODFX_HZ(en[33], en[92] >= 0.5, R.bpm);
        this.t1 = ev[34]; this.t2 = ev[35]; this.dep = ev[36]; this.fb = ev[37]; this.mono = R.choMono;
        svfC(ev[38], SQRT2, this.fs, this.c, 0);
      }
      tap(t, ph) {
        const th = this.mono === 1 ? CHO_TH_MONO[t] : CHO_TH[t];
        const d = (((t & 1) === 0 ? this.t1 : this.t2) + this.dep * (0.5 + 0.5 * sin(TAU * ph + th))) * this.fs / 1000;
        const lo = 0.0001 * this.fs > 3 ? 0.0001 * this.fs : 3;            // ≥ 0.1 ms (and ≥ 3 samples for the read)
        return d > lo ? d : lo;
      }
      snap() { for (let t = 0; t < 4; t++) this.d0[t] = this.tap(t, this.ph); }
      seed(p) { this.ph = p; this.snap(); }
      run(R, L, Rc, o, m) {
        const cap = this.cap, buf = this.buf, fb = this.fb, c = this.c, a1 = c[0], a2 = c[1], a3 = c[2];
        const p = frac(this.ph + this.rate * m / this.fs);
        this.ph = p;
        const d0 = this.d0, d1 = this.d1;
        for (let t = 0; t < 4; t++) d1[t] = this.tap(t, p);
        const w0 = this.w, ir0 = this.ir, ist = this.ist;
        let w = w0, ir = ir0;
        for (let ch = 0; ch < 2; ch++) {
          const X = ch === 0 ? L : Rc, ta = 2 * ch, oa = ta * cap, ob = oa + cap;
          const da = d0[ta], db = d0[ta + 1], dda = (d1[ta] - da) / m, ddb = (d1[ta + 1] - db) / m;
          let s1 = this.lp[ta], s2 = this.lp[ta + 1];
          w = w0; ir = ir0;
          for (let j = 0; j < m; j++) {
            const i = o + j, k = j + 1;
            if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
            const x = X[i], xi = x * ir;
            const ya = rdH(buf, oa, cap, w, da + dda * k), yb = rdH(buf, ob, cap, w, db + ddb * k);
            buf[oa + w] = sat(xi + fb * ya); buf[ob + w] = sat(xi + fb * yb);
            const v3 = 0.5 * (ya + yb) - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
            s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
            X[i] = v2;
            w = w + 1 === cap ? 0 : w + 1;
          }
          this.lp[ta] = s1; this.lp[ta + 1] = s2;
        }
        this.w = w; this.ir = ir;
        for (let t = 0; t < 4; t++) d0[t] = d1[t];
      }
      flush() { flushArr(this.lp); }
    }

    // Delay: L/R lines (2 s, Float32), sync ladder or 1 + 500n⁴ ms × offset, LINK, band filter in the loop and on the wet,
    // modes Normal / Ping-Pong / Tap->Delay, slewed read position (≤ 1 sample per sample). Above 96 kHz the lines run at
    // half rate (31-tap half-band decimator in, interpolator out, flat to ≈ 0.2·fs; +30 base samples on every echo):
    // 2 s lines at 192 kHz would take 3 MB of the 4 MB rack budget (§8.5.2) next to the FX filter's family pool.
    const DLY_HL = 30;                                         // half-rate conversion latency (base samples)
    class Delay {
      constructor(fs) {
        this.fs = fs; this.lL = null; this.lR = null; this.cap = 0; this.w = 0;
        this.dec = fs > 96000 ? 2 : 1; this.fi = fs / this.dec;  // line rate
        this.dL = 3; this.dR = 3; this.tL = 3; this.tR = 3; this.fb = 0.4; this.mode = 0; this.flat = 0;
        this.c = new Float64Array(6); this.s = new Float64Array(8);
        this.sl = 1 / (0.02 * this.fi);
        this.ir = 1; this.ist = 1 / (0.005 * this.fi);
        // half rate: decimator rings (2 × 32, duplicated), interpolator rings (2 × 16, duplicated), line-rate scratch
        this.hb = new Float64Array(192); this.hL = new Float64Array(BLK); this.hR = new Float64Array(BLK);
        this.hp = 0; this.hq = 0; this.hph = 0;
      }
      alloc() { this.cap = ceil(2 * this.fi) + 8; this.lL = new Float32Array(this.cap); this.lR = new Float32Array(this.cap); }
      reset() {
        if (this.lL) { this.lL.fill(0); this.lR.fill(0); }
        this.w = 0; this.s.fill(0); this.ir = 1; this.hb.fill(0); this.hp = 0; this.hq = 0; this.hph = 0;
      }
      time(en, ev, it, io, sync, bpm) {                        // line-rate samples, [3, 2 s]
        const t = (sync ? DLY_BEATS[round(en[it] * 11)] * 60 / bpm : ev[it] / 1000) * ev[io] * this.fi;
        const hi = 2 * this.fi;
        return t > 3 ? (t < hi ? t : hi) : 3;
      }
      upd(R) {
        const ev = R.ev, en = R.en, bpm = R.bpm > 0 ? R.bpm : 120, sync = en[93] >= 0.5;
        this.tL = this.time(en, ev, 43, 45, sync, bpm);
        this.tR = en[94] >= 0.5 ? this.tL : this.time(en, ev, 44, 46, sync, bpm);
        this.fb = ev[42]; this.mode = ev[95];
        const bw = ev[48];
        this.flat = bw >= DLY_FLAT ? 1 : 0;
        if (this.flat === 0) dlySvf(ev[47], bw, this.fi, this.c);
      }
      snap() { this.dL = this.tL; this.dR = this.tR; }
      // longest gap (base samples) between a write and the echo it produces: idle() must wait for it (§10.5.12)
      tail() {
        let a = this.dL > this.dR ? this.dL : this.dR;
        if (this.tL > a) a = this.tL;
        if (this.tR > a) a = this.tR;
        return a * this.dec + (this.dec === 2 ? DLY_HL : 0);
      }
      run(R, L, Rc, o, m) { if (this.dec === 2) this.half(L, Rc, o, m); else this.core(L, Rc, o, m); }
      // half rate: decimate the block into hL/hR, run the lines there, interpolate back (HB taps at offsets 2i − 15)
      half(L, Rc, o, m) {
        const hb = this.hb, hL = this.hL, hR = this.hR;
        const h0 = HB[0], h1 = HB[1], h2 = HB[2], h3 = HB[3], h4 = HB[4], h5 = HB[5], h6 = HB[6], h7 = HB[7];
        const ph0 = this.hph;
        let p = this.hp, ph = ph0, k = 0;
        for (let j = 0; j < m; j++) {
          p = (p + 31) & 31;
          const xl = L[o + j], xr = Rc[o + j];
          hb[p] = xl; hb[p + 32] = xl; hb[64 + p] = xr; hb[96 + p] = xr;
          ph ^= 1;
          if (ph === 1) {                                        // y = ½·x[t−15] + Σ HB[i]·x[t − 2i]
            for (let c = 0; c < 2; c++) {
              const q = p + (c << 6);
              const y = 0.5 * hb[q + 15] + h0 * (hb[q] + hb[q + 30]) + h1 * (hb[q + 2] + hb[q + 28]) + h2 * (hb[q + 4] + hb[q + 26])
                + h3 * (hb[q + 6] + hb[q + 24]) + h4 * (hb[q + 8] + hb[q + 22]) + h5 * (hb[q + 10] + hb[q + 20])
                + h6 * (hb[q + 12] + hb[q + 18]) + h7 * (hb[q + 14] + hb[q + 16]);
              if (c === 0) hL[k] = y; else hR[k] = y;
            }
            k++;
          }
        }
        this.hp = p; this.hph = ph;
        if (k > 0) this.core(hL, hR, 0, k);
        let q = this.hq, kk = 0;
        ph = ph0;
        for (let j = 0; j < m; j++) {
          ph ^= 1;
          if (ph === 1) {                                        // new line-rate sample z[k]: odd output 2·Σ HB[i]·z[k − i]
            q = (q + 15) & 15;
            const zl = hL[kk], zr = hR[kk];
            hb[128 + q] = zl; hb[144 + q] = zl; hb[160 + q] = zr; hb[176 + q] = zr;
            kk++;
            for (let c = 0; c < 2; c++) {
              const b = 128 + (c << 5) + q;
              const y = 2 * (h0 * (hb[b] + hb[b + 15]) + h1 * (hb[b + 1] + hb[b + 14]) + h2 * (hb[b + 2] + hb[b + 13])
                + h3 * (hb[b + 3] + hb[b + 12]) + h4 * (hb[b + 4] + hb[b + 11]) + h5 * (hb[b + 5] + hb[b + 10])
                + h6 * (hb[b + 6] + hb[b + 9]) + h7 * (hb[b + 7] + hb[b + 8]));
              if (c === 0) L[o + j] = y; else Rc[o + j] = y;
            }
          } else {                                               // even output: z[k − 7]
            L[o + j] = hb[135 + q]; Rc[o + j] = hb[167 + q];
          }
        }
        this.hq = q;
      }
      core(L, Rc, o, m) {
        const cap = this.cap, lL = this.lL, lR = this.lR, fb = this.fb, mode = this.mode, flat = this.flat, c = this.c, s = this.s;
        const tl = this.tL, tr = this.tR, sl = this.sl, ist = this.ist;
        let dl = this.dL, dr = this.dR, w = this.w, ir = this.ir;
        for (let j = 0; j < m; j++) {
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          const i = o + j, xl = L[i] * ir, xr = Rc[i] * ir;
          if (dl !== tl) {
            let st = (tl - dl) * sl;
            st = st > 1 ? 1 : st < -1 ? -1 : st;
            dl += st;
            if (tl - dl < 1e-6 && dl - tl < 1e-6) dl = tl;
          }
          if (dr !== tr) {
            let st = (tr - dr) * sl;
            st = st > 1 ? 1 : st < -1 ? -1 : st;
            dr += st;
            if (tr - dr < 1e-6 && dr - tr < 1e-6) dr = tr;
          }
          let yl = rdH(lL, 0, cap, w, dl), yr = rdH(lR, 0, cap, w, dr);
          if (flat === 0) { yl = dlyF(c, s, 0, yl); yr = dlyF(c, s, 4, yr); }
          if (mode === 0) {
            lL[w] = sat(xl + fb * yl); lR[w] = sat(xr + fb * yr);
            L[i] = yl; Rc[i] = yr;
          } else if (mode === 1) {
            const mo = 0.5 * (xl + xr);
            lL[w] = sat(mo + fb * yr); lR[w] = sat(fb * yl);
            L[i] = yl; Rc[i] = yr;
          } else {
            lL[w] = 0.5 * (xl + xr); lR[w] = sat(yl + fb * yr);
            const y = yl + yr;
            L[i] = y; Rc[i] = y;
          }
          w = w + 1 === cap ? 0 : w + 1;
        }
        this.dL = dl; this.dR = dr; this.w = w; this.ir = ir;
      }
      flush() { flushArr(this.s); flushArr(this.hb); }
    }

    // Compressor (§8.5.3): single band (decoupled peak detector, hard knee), Limit (look-ahead min-window limiter),
    // Multiband (LR4 crossovers 128.3 Hz / 2.5 kHz, upward + downward per band). The detectors, the look-ahead line and
    // the crossovers run in every mode, so a mode change (RATIO into / out of Limit, MULTIBAND: both are modulation
    // destinations) starts from current state, and the old and new mode outputs are crossfaded over 5 ms. The module
    // supplies the dry signal of its MIX: the input (single band), the look-ahead-delayed input (Limit) or the input
    // through the allpass pair the bands sum to (Multiband), so MIX < 100 % never combs.
    const XO1 = 128.3, XO2 = 2500;
    const MB_UP = 3;                                           // a band's boost stays ≤ the target for its level + 3 dB
    class Comp {
      constructor(fs) {
        this.fs = fs;
        this.la = null; this.cap = 0; this.w = 0; this.pre = 0;
        this.dqT = null; this.dqV = null; this.dqC = 0; this.front = 0; this.cnt = 0; this.tc = 0;
        this.pk = 0; this.gs = 0; this.lg = 1;
        this.bp = new Float64Array(3); this.bg = new Float64Array(3); this.T = new Float64Array(3);
        this.xs = new Float64Array(36); this.xc = new Float64Array(6);   // per channel 7 crossover SVFs + 2 dry allpass SVFs
        // block scratch: input, temporaries, bands and dry allpass per channel (L at 0, R at 4 in bd)
        this.bx = new Float64Array(BLK); this.bh = new Float64Array(BLK); this.b1 = new Float64Array(BLK); this.b2 = new Float64Array(BLK);
        this.bd = [];
        for (let k = 0; k < 8; k++) this.bd.push(new Float64Array(BLK));
        svfC(XO1, SQRT2, fs, this.xc, 0); svfC(XO2, SQRT2, fs, this.xc, 3);
        this.thr = 0.125; this.thrDb = -18.06; this.slope = 0.75; this.limit = 0; this.mb = 0; this.La = 0;
        this.aA = 1; this.rR = 0; this.aR = 1; this.mk = 1;
        this.mode = 0; this.pm = 0; this.cx = 1; this.cst = 1 / (0.005 * fs);   // 0 single band, 1 Limit, 2 Multiband
        this.ent = 0;                                          // a mode entered: its gain smoother starts at its target
      }
      alloc() {
        const n = ceil(0.01 * this.fs) + 4;
        this.cap = n; this.la = new Float64Array(2 * n);
        this.dqC = n + 2; this.dqT = new Float64Array(this.dqC); this.dqV = new Float64Array(this.dqC);
      }
      reset() {
        if (this.la) this.la.fill(0);
        this.w = 0; this.front = 0; this.cnt = 0; this.tc = 0; this.pre = 0;
        this.pk = 0; this.gs = 0; this.lg = 1; this.bp.fill(0); this.bg.fill(0); this.xs.fill(0);
      }
      upd(R) {
        const ev = R.ev, en = R.en, fs = this.fs;
        this.thr = ev[52]; this.thrDb = DB * log(this.thr);
        const r = ev[53];
        this.limit = r >= 1e6 ? 1 : 0; this.slope = 1 - 1 / r;
        const att = ev[54] > 0.1 ? ev[54] : 0.1, rel = ev[55] > 0.1 ? ev[55] : 0.1;
        this.aA = 1 - exp(-1000 / (att * fs)); this.rR = exp(-1000 / (rel * fs)); this.aR = 1 - this.rR;
        this.mk = ev[56];
        this.mb = en[96] >= 0.5 ? 1 : 0;
        const n = en[54], La = round(10 * n * n * fs / 1000);
        this.La = La < this.cap - 2 ? La : this.cap - 2 > 0 ? this.cap - 2 : 0;
        for (let b = 0; b < 3; b++) {
          const g = ev[57 + b], T = this.thrDb + (g > 1e-6 ? DB * log(g) : -120);
          this.T[b] = T > -120 ? T : -120;
        }
        const M = this.mb === 1 ? 2 : this.limit === 1 ? 1 : 0;
        if (M !== this.mode) {                                 // crossfade from the mode heard now (a reversal mid-fade turns back)
          if (this.cx < 1 && M === this.pm) { this.pm = this.mode; this.cx = 1 - this.cx; } else { this.pm = this.mode; this.cx = 0; this.ent = 1; }
          this.mode = M;
        }
      }
      snap() { this.pm = this.mode; this.cx = 1; this.ent = 1; }
      // crossovers of one channel over the block: low / mid / high bands (sum = AP2(XO2)·AP2(XO1)) and the dry allpass pair
      split(X, o, m, c) {
        const s = this.xs, xc = this.xc, A1 = xc[0], A2 = xc[1], A3 = xc[2], B1 = xc[3], B2 = xc[4], B3 = xc[5], K = SQRT2, K2 = 2 * SQRT2;
        const x = this.bx, h = this.bh, t1 = this.b1, t2 = this.b2, b = 18 * c, d = this.bd, q = 4 * c;
        const lo = d[q], md = d[q + 1], hi = d[q + 2], ap = d[q + 3];
        for (let j = 0; j < m; j++) x[j] = X[o + j];
        svfRun(x, m, s, b, A1, A2, A3, t1, t2);
        for (let j = 0; j < m; j++) h[j] = x[j] - K * t2[j] - t1[j];               // HP2(XO1)
        svfRun(t1, m, s, b + 2, A1, A2, A3, lo, t2);                              // LR4 low
        svfRun(h, m, s, b + 4, A1, A2, A3, t1, t2);
        for (let j = 0; j < m; j++) h[j] = h[j] - K * t2[j] - t1[j];               // LR4 high at XO1
        svfRun(h, m, s, b + 6, B1, B2, B3, t1, t2);
        for (let j = 0; j < m; j++) h[j] = h[j] - K * t2[j] - t1[j];
        svfRun(t1, m, s, b + 8, B1, B2, B3, md, t2);                              // mid
        svfRun(h, m, s, b + 10, B1, B2, B3, t1, t2);
        for (let j = 0; j < m; j++) hi[j] = h[j] - K * t2[j] - t1[j];             // high
        svfRun(lo, m, s, b + 12, B1, B2, B3, t1, t2);
        for (let j = 0; j < m; j++) lo[j] = lo[j] - K2 * t2[j];                    // low through AP2(XO2)
        svfRun(x, m, s, b + 14, A1, A2, A3, t1, t2);
        for (let j = 0; j < m; j++) h[j] = x[j] - K2 * t2[j];
        svfRun(h, m, s, b + 16, B1, B2, B3, t1, t2);
        for (let j = 0; j < m; j++) ap[j] = h[j] - K2 * t2[j];                     // dry: AP2(XO2)·AP2(XO1)
      }
      run(R, L, Rc, o, m) {
        const la = this.la, cap = this.cap, La = this.La, dqT = this.dqT, dqV = this.dqV, dqC = this.dqC, thr = this.thr;
        const thrDb = this.thrDb, slope = this.slope, rR = this.rR, aA = this.aA, aR = this.aR, mk = this.mk;
        const T = this.T, T0 = T[0], T1 = T[1], T2 = T[2], DL = R.dyL, DR = R.dyR, bp = this.bp, bg = this.bg;
        this.split(L, o, m, 0); this.split(Rc, o, m, 1);
        const d = this.bd, bLo = d[0], bMd = d[1], bHi = d[2], bAp = d[3], cLo = d[4], cMd = d[5], cHi = d[6], cAp = d[7];
        const M = this.mode, P = this.pm, cst = this.cst, fade = this.cx < 1 ? 1 : 0;
        const uS = M === 0 || (fade === 1 && P === 0), uL = M === 1 || (fade === 1 && P === 1), uM = M === 2 || (fade === 1 && P === 2);
        if (this.pre === 1 && m > 0) { la.fill(L[o], 0, cap); la.fill(Rc[o], cap, 2 * cap); this.pre = 0; }
        // the single-band and band gain smoothers (log / curve per sample) run only while their mode is heard; the
        // smoother of a mode just entered starts at its target (its state is stale)
        let eS = this.ent === 1 && M === 0 ? 1 : 0, eM = this.ent === 1 && M === 2 ? 1 : 0;
        this.ent = 0;
        let w = this.w, front = this.front, cnt = this.cnt, tc = this.tc, lg = this.lg, pk = this.pk, gs = this.gs, cx = this.cx;
        let p0 = bp[0], p1 = bp[1], p2 = bp[2], g0 = bg[0], g1 = bg[1], g2 = bg[2];
        for (let j = 0; j < m; j++) {
          const i = o + j, xl = L[i], xr = Rc[i];
          // look-ahead line; limiter gain = min of thr/|x| over the window (monotonic deque), release one-pole
          la[w] = xl; la[cap + w] = xr;
          let ri = w - La;
          if (ri < 0) ri += cap;
          const yl = la[ri], yr = la[cap + ri];
          w = w + 1 === cap ? 0 : w + 1;
          const al = xl < 0 ? -xl : xl, ar = xr < 0 ? -xr : xr, a = al > ar ? al : ar, r = a > thr ? thr / a : 1;
          while (cnt > 0) {
            let bk = front + cnt - 1;
            if (bk >= dqC) bk -= dqC;
            if (dqV[bk] >= r) cnt--; else break;
          }
          let nb = front + cnt;
          if (nb >= dqC) nb -= dqC;
          dqV[nb] = r; dqT[nb] = tc; cnt++;
          while (dqT[front] < tc - La) { front = front + 1 === dqC ? 0 : front + 1; cnt--; }
          const mn = dqV[front];
          lg = mn < lg ? mn : lg + (mn - lg) * aR;
          tc++;
          // single band: peak detector (instant capture, release decay) → static curve → attack one-pole on the GR
          pk *= rR;
          if (a > pk) pk = a;
          let g = 0;
          if (uS) {
            g = pk > thr ? (DB * log(pk) - thrDb) * slope : 0;
            if (g > gs && eS === 0) gs += (g - gs) * aA; else gs = g;
          }
          const loL = bLo[j], mdL = bMd[j], hiL = bHi[j], apL = bAp[j], loR = cLo[j], mdR = cMd[j], hiR = cHi[j], apR = cAp[j];
          // per band: stereo-linked peak → static curve (downward above T, upward below T − 24 dB) → attack one-pole;
          // a boost left over from a quiet passage is cut back at once to ≤ MB_UP dB above the target of the new level
          let pa = loL < 0 ? -loL : loL, pb = loR < 0 ? -loR : loR;
          p0 *= rR; if (pa > p0) p0 = pa; if (pb > p0) p0 = pb;
          pa = mdL < 0 ? -mdL : mdL; pb = mdR < 0 ? -mdR : mdR;
          p1 *= rR; if (pa > p1) p1 = pa; if (pb > p1) p1 = pb;
          pa = hiL < 0 ? -hiL : hiL; pb = hiR < 0 ? -hiR : hiR;
          p2 *= rR; if (pa > p2) p2 = pa; if (pb > p2) p2 = pb;
          if (uM) {
            g = mbCurve(p0, T0, slope);
            if (g > g0 && eM === 0) { g0 += (g - g0) * aA; if (p0 > 1e-4) { const c = (g < 0 ? g : 0) - MB_UP; if (g0 < c) g0 = c; } } else g0 = g;
            g = mbCurve(p1, T1, slope);
            if (g > g1 && eM === 0) { g1 += (g - g1) * aA; if (p1 > 1e-4) { const c = (g < 0 ? g : 0) - MB_UP; if (g1 < c) g1 = c; } } else g1 = g;
            g = mbCurve(p2, T2, slope);
            if (g > g2 && eM === 0) { g2 += (g - g2) * aA; if (p2 > 1e-4) { const c = (g < 0 ? g : 0) - MB_UP; if (g2 < c) g2 = c; } } else g2 = g;
          }
          eS = 0; eM = 0;
          // outputs (wet, dry) of the modes in use; a mode change crossfades both
          let sL = 0, sR = 0, lL = 0, lR = 0, mL = 0, mR = 0;
          if (uS) { const gn = gs > 0 ? exp(-IDB * gs) : 1; sL = xl * gn; sR = xr * gn; }
          if (uL) { lL = yl * lg; lR = yr * lg; }
          if (uM) {
            const e0 = g0 === 0 ? 1 : exp(-IDB * g0), e1 = g1 === 0 ? 1 : exp(-IDB * g1), e2 = g2 === 0 ? 1 : exp(-IDB * g2);
            mL = loL * e0 + mdL * e1 + hiL * e2; mR = loR * e0 + mdR * e1 + hiR * e2;
          }
          let oL = M === 0 ? sL : M === 1 ? lL : mL, oR = M === 0 ? sR : M === 1 ? lR : mR;
          let dl = M === 0 ? xl : M === 1 ? yl : apL, dr = M === 0 ? xr : M === 1 ? yr : apR;
          if (fade === 1) {
            cx += cst;
            if (cx > 1) cx = 1;
            const qL = P === 0 ? sL : P === 1 ? lL : mL, qR = P === 0 ? sR : P === 1 ? lR : mR;
            const el = P === 0 ? xl : P === 1 ? yl : apL, er = P === 0 ? xr : P === 1 ? yr : apR;
            oL = qL + cx * (oL - qL); oR = qR + cx * (oR - qR); dl = el + cx * (dl - el); dr = er + cx * (dr - er);
          }
          L[i] = oL * mk; Rc[i] = oR * mk; DL[j] = dl; DR[j] = dr;
        }
        this.w = w; this.front = front; this.cnt = cnt; this.tc = tc; this.lg = lg; this.pk = pk; this.gs = gs; this.cx = cx;
        bp[0] = p0; bp[1] = p1; bp[2] = p2; bg[0] = g0; bg[1] = g1; bg[2] = g2;
      }
      meter(gr) {
        if (this.mode === 2) { gr[0] = 0; gr[1] = this.bg[0]; gr[2] = this.bg[1]; gr[3] = this.bg[2]; return; }
        gr[0] = this.mode === 1 ? (this.lg < 1 ? -DB * log(this.lg > 1e-12 ? this.lg : 1e-12) : 0) : this.gs;
        gr[1] = 0; gr[2] = 0; gr[3] = 0;
      }
      flush() {
        flushArr(this.xs);
        if (this.pk < 1e-30) this.pk = 0;
        for (let b = 0; b < 3; b++) if (this.bp[b] < 1e-30) this.bp[b] = 0;
      }
    }
    // multiband static curve: GR in dB (> 0 reduction, < 0 boost ≤ 24 dB) for peak level p (linear)
    function mbCurve(p, T, slope) {
      if (p <= 1e-4) return 0;                                 // below −80 dBFS: unchanged
      const lv = DB * log(p);
      if (lv > T) return (lv - T) * slope;
      const Tl = T - 24;
      if (lv < Tl) { const g = -(Tl - lv) * slope; return g > -24 ? g : -24; }
      return 0;
    }

    // Reverb: Plate = Dattorro (1997) tank, Hall = 4 diffusers → 8-line Householder FDN (§8.5.3). Above 96 kHz the Plate
    // runs at half rate (2-sample average in, linear interpolation out): its memory stays within the rack budget.
    const PL_FS = 29761, PL_OUT = 0.9;                       // Dattorro output taps (0.6 in the paper; +3.5 dB here)
    const PL_LEN = Float64Array.from([0, 142, 107, 379, 277, 672, 4453, 1800, 3720, 908, 4217, 2656, 3163]);
    const HL_LEN = Float64Array.from([1009, 1123, 1277, 1361, 1489, 1597, 1733, 1867]);
    const HL_IN = Float64Array.from([1, 1, -1, -1, 1, -1, 1, -1].map((v) => 0.4 * v));
    const HL_SL = Float64Array.from([1, -1, 1, -1, 1, -1, 1, -1]), HL_SR = Float64Array.from([1, 1, -1, -1, 1, 1, -1, -1]);
    const HL_OUT = 0.55;                                       // wet ≈ −5 dB re dry on white noise at the defaults
    class Reverb {
      constructor(fs) {
        this.fs = fs; this.pool = null; this.type = -1;
        this.dec = fs > 96000 ? 2 : 1; this.fi = fs / this.dec;   // Plate internal rate
        this.off = new Int32Array(13); this.cap = new Int32Array(13); this.wp = new Int32Array(13);
        this.dl = new Float64Array(8); this.dt = new Float64Array(8); this.lp = new Float64Array(8); this.g = new Float64Array(8);
        this.tf = new Float64Array(8); this.hs = new Float64Array(4); this.hc = new Float64Array(3);
        this.sc0 = 1; this.sc1 = 1; this.pd0 = 1; this.pd1 = 1; this.ex0 = 0; this.ey0 = 0;
        this.bw = 0; this.dmL = 0; this.dmR = 0; this.bwK = 1; this.dmK = 1; this.decay = 0.5; this.width = 1; this.mph = 0;
        this.hph = 0; this.xa = 0; this.yl = 0; this.yr = 0;
        this.sph = 0; this.srate = 0.05; this.sdep = 0; this.lpK = 1; this.inf = 0;
        this.ir = 1; this.ist = 1 / (0.005 * fs);
      }
      // pool layout of a topology (floats); wr = 1 also installs it (off / cap)
      layout(type, wr) {
        const fs = this.fs, fi = this.fi, off = this.off, cap = this.cap;
        let tot = 0;
        if (wr) { off.fill(0); cap.fill(0); }
        for (let e = 0; e < 13; e++) {
          let c = 0;
          if (type === 0) c = e === 0 ? ceil(0.2 * fi) + 4 : ceil(PL_LEN[e] * 1.5 * (fi / PL_FS) + (e === 5 || e === 9 ? 8 * fi / PL_FS : 0)) + 4;
          else if (e < 4) c = ceil(PL_LEN[e + 1] * fs / PL_FS) + 4;
          else if (e < 12) c = ceil((2 * HL_LEN[e - 4] + 12) * fs / 48000) + 4;
          if (wr) { off[e] = tot; cap[e] = c; }
          tot += c;
        }
        return tot;
      }
      ensure(type) {                                           // grow-only pool for that topology (set() only)
        const tot = this.layout(type, 0);
        if (!this.pool || this.pool.length < tot) {
          const p = new Float32Array(tot);
          if (this.pool) p.set(this.pool);                     // the running topology keeps its content
          this.pool = p;
        }
      }
      apply(type) { this.layout(type, 1); this.type = type; this.reset(); }   // new topology, empty (no allocation)
      alloc(type) { type = type === 0 ? 0 : 1; this.ensure(type); this.apply(type); }
      reset() {
        if (this.pool) this.pool.fill(0);
        this.wp.fill(0); this.lp.fill(0); this.hs.fill(0); this.bw = 0; this.dmL = 0; this.dmR = 0;
        this.hph = 0; this.xa = 0; this.yl = 0; this.yr = 0; this.ir = 1;
      }
      seed() {                                                 // modulation phases restart at 0 (ramps restart there)
        this.mph = 0; this.sph = 0; this.hph = 0;
        const E = 8 * this.fi / PL_FS;
        this.ex0 = 0; this.ey0 = E;
        if (this.type === 1) for (let q = 0; q < 8; q++) this.dl[q] = this.hallD(q, 0);
      }
      upd(R) {
        const ev = R.ev, fs = this.fs, size = ev[63], t = ev[64], c = ev[66], hc = ev[67];
        svfC(20 * pow(50, ev[65]), SQRT2, fs, this.hc, 0);
        if (this.type === 0) {
          const fi = this.fi, hi = 0.45 * fi;
          this.sc1 = (0.5 + size) * fi / PL_FS;
          const pd = 0.2 * t * fi;
          this.pd1 = pd > 1 ? pd : 1;
          let f = 20000 * pow(0.05, hc);
          f = f < hi ? f : hi;
          this.bwK = 1 - exp(-TAU * f / fi);
          f = 20000 * pow(0.03, c);
          f = f < hi ? f : hi;
          this.dmK = 1 - exp(-TAU * f / fi);
          this.decay = 0.2 + 0.78 * size; this.width = ev[68];
        } else {
          const sc = (0.4 + 1.6 * size) * fs / 48000, hi = 0.45 * fs;
          this.sc1 = sc;
          this.inf = t >= 0.999 ? 1 : 0;
          const T60 = 0.8 + 11.2 * t;
          for (let q = 0; q < 8; q++) this.g[q] = this.inf === 1 ? 1 : exp(-3 * LN10 * HL_LEN[q] * sc / (T60 * fs));
          let f = 20000 * pow(0.05, hc);
          f = f < hi ? f : hi;
          this.lpK = 1 - exp(-TAU * f / fs);
          this.srate = 0.05 + 3 * c * c; this.sdep = 12 * ev[68] * fs / 48000;
        }
      }
      hallD(q, sph) { return HL_LEN[q] * this.sc1 + this.sdep * (0.5 + 0.5 * sin(TAU * (sph + 0.125 * q))); }
      snap() {
        this.sc0 = this.sc1; this.pd0 = this.pd1;
        const E = 8 * this.fi / PL_FS;
        this.ex0 = E * sin(TAU * this.mph); this.ey0 = E * cos(TAU * this.mph);
        if (this.type === 1) for (let q = 0; q < 8; q++) this.dl[q] = this.hallD(q, this.sph);
      }
      run(R, L, Rc, o, m) { if (this.type === 0) this.runPlate(L, Rc, o, m); else this.runHall(L, Rc, o, m); }
      outHP(L, Rc, i, yl, yr) {                                // output low-cut (2-pole SVF HP per channel)
        const hc = this.hc, a1 = hc[0], a2 = hc[1], a3 = hc[2], h = this.hs;
        let lp = svfT(h, 0, yl, a1, a2, a3);
        L[i] = yl - SQRT2 * SVO.bp - lp;
        lp = svfT(h, 2, yr, a1, a2, a3);
        Rc[i] = yr - SQRT2 * SVO.bp - lp;
      }
      runPlate(L, Rc, o, m) {
        const P = this.pool, off = this.off, cap = this.cap, wp = this.wp, fs = this.fs, dec = this.dec;
        const mp = frac(this.mph + 0.5 * m / fs);
        this.mph = mp;
        const E = 8 * this.fi / PL_FS, ex1 = E * sin(TAU * mp), ey1 = E * cos(TAU * mp);
        const sc0 = this.sc0, dsc = (this.sc1 - sc0) / m, pd0 = this.pd0, dpd = (this.pd1 - pd0) / m;
        const ex0 = this.ex0, dex = (ex1 - ex0) / m, ey0 = this.ey0, dey = (ey1 - ey0) / m;
        this.sc0 = this.sc1; this.pd0 = this.pd1; this.ex0 = ex1; this.ey0 = ey1;
        const bwK = this.bwK, dmK = this.dmK, decay = this.decay, width = this.width;
        const o0 = off[0], o1 = off[1], o2 = off[2], o3 = off[3], o4 = off[4], o5 = off[5], o6 = off[6], o7 = off[7], o8 = off[8];
        const o9 = off[9], o10 = off[10], o11 = off[11], o12 = off[12];
        const c0 = cap[0], c1 = cap[1], c2 = cap[2], c3 = cap[3], c4 = cap[4], c5 = cap[5], c6 = cap[6], c7 = cap[7], c8 = cap[8];
        const c9 = cap[9], c10 = cap[10], c11 = cap[11], c12 = cap[12];
        let w0 = wp[0], w1 = wp[1], w2 = wp[2], w3 = wp[3], w4 = wp[4], w5 = wp[5], w6 = wp[6], w7 = wp[7], w8 = wp[8];
        let w9 = wp[9], w10 = wp[10], w11 = wp[11], w12 = wp[12];
        let bw = this.bw, dmL = this.dmL, dmR = this.dmR, hph = this.hph, xa = this.xa, pl = this.yl, pr = this.yr, ir = this.ir;
        const ist = this.ist;
        for (let j = 0; j < m; j++) {
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          const k = j + 1, i = o + j, xin = 0.5 * (L[i] + Rc[i]) * ir;
          let yl, yr;
          if (dec === 2 && hph === 0) {                          // half rate: hold the even input, output the last value
            xa = xin; hph = 1; yl = pl; yr = pr;
          } else {
            const sc = sc0 + dsc * k;
            let x = xin;
            if (dec === 2) { x = 0.5 * (xa + xin); hph = 0; }
            // pre-delay, input band-limit, 4 input diffusers
            let v = rdE(P, o0, c0, w0, pd0 + dpd * k);
            P[o0 + w0] = x;
            bw += bwK * (v - bw);
            v = bw;
            let s = rdE(P, o1, c1, w1, 142 * sc), u = v + 0.75 * s;
            v = s - 0.75 * u; P[o1 + w1] = u;
            s = rdE(P, o2, c2, w2, 107 * sc); u = v + 0.75 * s; v = s - 0.75 * u; P[o2 + w2] = u;
            s = rdE(P, o3, c3, w3, 379 * sc); u = v + 0.625 * s; v = s - 0.625 * u; P[o3 + w3] = u;
            s = rdE(P, o4, c4, w4, 277 * sc); u = v + 0.625 * s; v = s - 0.625 * u; P[o4 + w4] = u;
            // tank (cross-coupled halves)
            const lT = rdE(P, o8, c8, w8, 3720 * sc), rT = rdE(P, o12, c12, w12, 3163 * sc);
            let a = v + decay * rT;
            s = rdE(P, o5, c5, w5, 672 * sc + ex0 + dex * k); u = a - 0.7 * s; a = s + 0.7 * u; P[o5 + w5] = u;
            let d = rdE(P, o6, c6, w6, 4453 * sc);
            P[o6 + w6] = a;
            dmL += dmK * (d - dmL);
            a = dmL * decay;
            s = rdE(P, o7, c7, w7, 1800 * sc); u = a + 0.5 * s; a = s - 0.5 * u; P[o7 + w7] = u;
            P[o8 + w8] = a;
            let b = v + decay * lT;
            s = rdE(P, o9, c9, w9, 908 * sc + ey0 + dey * k); u = b - 0.7 * s; b = s + 0.7 * u; P[o9 + w9] = u;
            d = rdE(P, o10, c10, w10, 4217 * sc);
            P[o10 + w10] = b;
            dmR += dmK * (d - dmR);
            b = dmR * decay;
            s = rdE(P, o11, c11, w11, 2656 * sc); u = b + 0.5 * s; b = s - 0.5 * u; P[o11 + w11] = u;
            P[o12 + w12] = b;
            // output taps
            yl = PL_OUT * (rdE(P, o10, c10, w10, 266 * sc) + rdE(P, o10, c10, w10, 2974 * sc) - rdE(P, o11, c11, w11, 1913 * sc)
              + rdE(P, o12, c12, w12, 1996 * sc) - rdE(P, o6, c6, w6, 1990 * sc) - rdE(P, o7, c7, w7, 187 * sc)
              - rdE(P, o8, c8, w8, 1066 * sc));
            yr = PL_OUT * (rdE(P, o6, c6, w6, 353 * sc) + rdE(P, o6, c6, w6, 3627 * sc) - rdE(P, o7, c7, w7, 1228 * sc)
              + rdE(P, o8, c8, w8, 2673 * sc) - rdE(P, o10, c10, w10, 2111 * sc) - rdE(P, o11, c11, w11, 335 * sc)
              - rdE(P, o12, c12, w12, 121 * sc));
            w0 = w0 + 1 === c0 ? 0 : w0 + 1; w1 = w1 + 1 === c1 ? 0 : w1 + 1; w2 = w2 + 1 === c2 ? 0 : w2 + 1;
            w3 = w3 + 1 === c3 ? 0 : w3 + 1; w4 = w4 + 1 === c4 ? 0 : w4 + 1; w5 = w5 + 1 === c5 ? 0 : w5 + 1;
            w6 = w6 + 1 === c6 ? 0 : w6 + 1; w7 = w7 + 1 === c7 ? 0 : w7 + 1; w8 = w8 + 1 === c8 ? 0 : w8 + 1;
            w9 = w9 + 1 === c9 ? 0 : w9 + 1; w10 = w10 + 1 === c10 ? 0 : w10 + 1; w11 = w11 + 1 === c11 ? 0 : w11 + 1;
            w12 = w12 + 1 === c12 ? 0 : w12 + 1;
            if (dec === 2) {                                     // odd sample: midpoint between the last two outputs
              const nl = yl, nr = yr;
              yl = 0.5 * (pl + nl); yr = 0.5 * (pr + nr); pl = nl; pr = nr;
            }
          }
          const mid = 0.5 * (yl + yr), side = 0.5 * width * (yl - yr);
          this.outHP(L, Rc, i, mid + side, mid - side);
        }
        wp[0] = w0; wp[1] = w1; wp[2] = w2; wp[3] = w3; wp[4] = w4; wp[5] = w5; wp[6] = w6; wp[7] = w7; wp[8] = w8;
        wp[9] = w9; wp[10] = w10; wp[11] = w11; wp[12] = w12;
        this.bw = bw; this.dmL = dmL; this.dmR = dmR; this.hph = hph; this.xa = xa; this.yl = pl; this.yr = pr; this.ir = ir;
      }
      runHall(L, Rc, o, m) {
        const P = this.pool, off = this.off, cap = this.cap, wp = this.wp, fs = this.fs, s = fs / PL_FS;
        const sp = frac(this.sph + this.srate * m / fs);
        this.sph = sp;
        const dl = this.dl, dt = this.dt, lp = this.lp, g = this.g, tf = this.tf, lpK = this.lpK;
        for (let q = 0; q < 8; q++) dt[q] = (this.hallD(q, sp) - dl[q]) / m;   // per-sample increments
        const D0 = 142 * s, D1 = 107 * s, D2 = 379 * s, D3 = 277 * s;
        const o0 = off[0], o1 = off[1], o2 = off[2], o3 = off[3], c0 = cap[0], c1 = cap[1], c2 = cap[2], c3 = cap[3];
        let w0 = wp[0], w1 = wp[1], w2 = wp[2], w3 = wp[3], ir = this.ir;
        const ist = this.ist;
        for (let j = 0; j < m; j++) {
          const i = o + j;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          let v = 0.5 * (L[i] + Rc[i]) * ir, x = rdE(P, o0, c0, w0, D0), u = v + 0.7 * x;
          v = x - 0.7 * u; P[o0 + w0] = u;
          x = rdE(P, o1, c1, w1, D1); u = v + 0.7 * x; v = x - 0.7 * u; P[o1 + w1] = u;
          x = rdE(P, o2, c2, w2, D2); u = v + 0.7 * x; v = x - 0.7 * u; P[o2 + w2] = u;
          x = rdE(P, o3, c3, w3, D3); u = v + 0.7 * x; v = x - 0.7 * u; P[o3 + w3] = u;
          w0 = w0 + 1 === c0 ? 0 : w0 + 1; w1 = w1 + 1 === c1 ? 0 : w1 + 1;
          w2 = w2 + 1 === c2 ? 0 : w2 + 1; w3 = w3 + 1 === c3 ? 0 : w3 + 1;
          let sum = 0, yl = 0, yr = 0;
          for (let q = 0; q < 8; q++) {
            const e = 4 + q, d = dl[q] + dt[q];
            dl[q] = d;
            const y = rdE(P, off[e], cap[e], wp[e], d);
            yl += HL_SL[q] * y; yr += HL_SR[q] * y;
            const f = (lp[q] += lpK * (y - lp[q])) * g[q];
            tf[q] = f; sum += f;
          }
          sum *= 0.25;                                           // Householder: y_i = x_i − (2/N)·Σx
          for (let q = 0; q < 8; q++) {
            const e = 4 + q, we = wp[e];
            P[off[e] + we] = sat(tf[q] - sum + HL_IN[q] * v);
            wp[e] = we + 1 === cap[e] ? 0 : we + 1;
          }
          this.outHP(L, Rc, i, HL_OUT * yl, HL_OUT * yr);
        }
        wp[0] = w0; wp[1] = w1; wp[2] = w2; wp[3] = w3; this.ir = ir;
      }
      flush() {
        flushArr(this.hs); flushArr(this.lp);
        if (this.bw < 1e-30 && this.bw > -1e-30) this.bw = 0;
        if (this.dmL < 1e-30 && this.dmL > -1e-30) this.dmL = 0;
        if (this.dmR < 1e-30 && this.dmR > -1e-30) this.dmR = 0;
      }
    }

    // EQ: two RBJ-cookbook bands in series (left band then right band), realised as TPT SVFs
    class EQ {
      constructor(fs) { this.fs = fs; this.c = new Float64Array(12); this.s = new Float64Array(8); }
      reset() { this.s.fill(0); }
      upd(R) {
        const ev = R.ev, fs = this.fs, c = this.c;
        eqSvf(ev[97], 0, ev[72], ev[73], ev[74], fs, c, 0);
        eqSvf(ev[98], 1, ev[75], ev[76], ev[77], fs, c, 6);
      }
      run(R, L, Rc, o, m) {
        const c = this.c, s = this.s;
        for (let j = 0; j < m; j++) { const i = o + j; L[i] = eq2(c, s, 0, L[i]); Rc[i] = eq2(c, s, 4, Rc[i]); }
      }
      flush() { flushArr(this.s); }
    }

    // Filter: SerumDSP.SFilter (type = eff fx.fil.type), cutoff split by PAN as §6.11 (no key track)
    class Filt {
      constructor(fs) {
        this.fs = fs; this.sf = null; this.type = -1; this.all = 0;
        this.fL = new Float64Array(BLK); this.fR = new Float64Array(BLK);
      }
      alloc() {
        const S = globalThis.SerumDSP;
        if (S && typeof S.SFilter === 'function') { this.sf = new S.SFilter(this.fs); this.type = -1; }
      }
      prealloc() { if (this.sf && this.all === 0) { this.sf.prealloc(true); this.all = 1; } }
      setType(t) { if (this.sf && t !== this.type) { this.sf.setType(t); this.type = t; } }
      reset() { if (this.sf) this.sf.reset(); }
      upd(R) {
        if (!this.sf) return;
        const ev = R.ev, fc = ev[79], sh = (0.5 - ev[83]) * 3;
        this.setType(ev[99]);
        this.sf.set(fc * pow(2, sh), fc * pow(2, -sh), ev[80], ev[81], ev[82]);
      }
      run(R, L, Rc, o, m) {
        const fL = this.fL, fR = this.fR;
        for (let j = 0; j < m; j++) { fL[j] = L[o + j]; fR[j] = Rc[o + j]; }
        this.sf.process(fL, fR, 0, m);
        for (let j = 0; j < m; j++) { L[o + j] = fL[j]; Rc[o + j] = fR[j]; }
      }
    }

    /* ------------------------------------------------------------ FXRack (§8.5.2) */
    let warnedVer = false;
    // A re-seed (fxp.seed, transport()) or a Plate ↔ Hall change while a module's lines hold audible signal is applied at
    // the bottom of a 2.5 ms duck of that module (output → its input), which then fades back in over 5 ms; with nothing
    // audible (output < 1e-6 for SEEDQ s of zero input) it is applied at once, so renders after a silent history are
    // bit-identical to a fresh rack's (§10.7f).
    const SEEDQ = 0.25;
    const QBIG = 1e15;                                         // quietT after a clear: the lines hold nothing at all
    class FXRack {
      constructor(base) {
        const fs = base > 0 && base < 1e7 ? +base : 48000;
        this.fs = fs;
        this.tgt = new Float64Array(NF); this.bs = new Float64Array(NF); this.md = new Float64Array(NF); this.mdT = new Float64Array(NF);
        this.eS = new Float64Array(NF); this.eD = new Float64Array(NF); this.en = new Float64Array(NF); this.ev = new Float64Array(NF);
        this.dirty = new Uint8Array(NMOD + 1);
        this.ord = new Uint8Array(NMOD); this.byp = new Uint8Array(NMOD); this.has = new Uint8Array(NMOD);
        // st: 0 off, 1 on (fading in while xf < 1), 2 fading out, 3 ducking for the actions in pend (1 re-seed, 2 topology)
        this.st = new Uint8Array(NMOD); this.xf = new Float64Array(NMOD); this.pend = new Uint8Array(NMOD);
        this.gD0 = new Float64Array(NMOD); this.gW0 = new Float64Array(NMOD); this.gD1 = new Float64Array(NMOD); this.gW1 = new Float64Array(NMOD);
        this.inL = new Float64Array(BLK); this.inR = new Float64Array(BLK); this.dyL = new Float64Array(BLK); this.dyR = new Float64Array(BLK);
        this.dvL = new Float64Array(BLK); this.dvR = new Float64Array(BLK);
        this.wL = new Float64Array(BLK); this.wR = new Float64Array(BLK); this.cf = new Float64Array(8);
        this.xsA = new Float32Array(NXS); this.xsB = new Float32Array(NXS);
        this.xsA.set(LINXS); this.xsB.set(LINXS);
        this.seedPh = new Float64Array(4); this.phOut = new Float64Array(4); this.grOut = new Float32Array(4);
        this.mHy = new Hyper(fs); this.mDi = new Dist(fs); this.mFl = new Flanger(fs); this.mPh = new Phaser(fs); this.mCh = new Chorus(fs);
        this.mDl = new Delay(fs); this.mCp = new Comp(fs); this.mRv = new Reverb(fs); this.mEq = new EQ(fs); this.mFi = new Filt(fs);
        this.bpm = 120; this.smooth = 1; this.silence = 1; this.revType = 1; this.choMono = 0;
        // fresh: 1 never given a real FXP, 2 reset() with no audio processed since → the next set() snaps like a first call
        this.fresh = 1; this.calm = 1; this.nAct = 0; this.quietT = QBIG; this.inZero = 0; this.qmax = 0;
        this.gm0 = 1; this.gm1 = 1; this.gate = 1; this.gT = 1; this.rf = 1; this.rfT = 1; this.fstep = 1 / (0.005 * fs);
        this.latency = 0;
        for (let m = 0; m < NMOD; m++) this.ord[m] = m;
        for (let k = 0; k < NF; k++) this.tgt[k] = FX_DEF[k];
        for (let m = 0; m < NMOD; m++) this.tgt[ON[m]] = 0;
        this.tgt[0] = 1; this.tgt[86] = 0;
        this.snap();
      }

      /* ---------------- configuration (allocation allowed) */
      set(fxp, fxt) {
        if (fxt && typeof fxt === 'object' && okXS(fxt.xsA) && okXS(fxt.xsB)) {
          const a = fxt.xsA, b = fxt.xsB, A = this.xsA, B = this.xsB;
          for (let j = 0; j < NXS; j++) { const x = +a[j], y = +b[j]; A[j] = x === x ? x : j / 1024; B[j] = y === y ? y : j / 1024; }
        }
        let ok = !!fxp && typeof fxp === 'object' && !!fxp.base && (ArrayBuffer.isView(fxp.base) || Array.isArray(fxp.base)) &&
          fxp.base.length >= NF;
        if (ok && fxp.ver !== VER) {
          if (!warnedVer) { warnedVer = true; if (typeof console !== 'undefined') console.warn('fx-dsp: FXP version', fxp.ver, 'not understood (expects', VER + '); rack bypassed'); }
          ok = false;
        }
        const tgt = this.tgt;
        if (!ok) {                                             // null: every module off, master 1, not bypassed
          for (let m = 0; m < NMOD; m++) tgt[ON[m]] = 0;
          tgt[0] = 1; tgt[86] = 0;
        } else {
          const b = fxp.base;
          for (let k = 0; k < NF; k++) { const v = +b[k]; if (v === v) tgt[k] = clamp01(v); }
          const o = fxp.order;
          let okO = !!o && typeof o === 'object' && o.length === NMOD, mask = 0;
          if (okO) {
            for (let k = 0; k < NMOD; k++) {
              const v = o[k];
              if (!(v >= 0 && v < NMOD && v === (v | 0)) || (mask & (1 << v))) { okO = false; break; }
              mask |= 1 << v;
            }
          }
          for (let k = 0; k < NMOD; k++) this.ord[k] = okO ? o[k] : k;
          const by = fxp.byp;
          for (let m = 0; m < NMOD; m++) this.byp[m] = by && by[m] ? 1 : 0;
          if (fxp.bpm > 0 && fxp.bpm < 10000) this.bpm = +fxp.bpm;
          if (fxp.smooth >= 0 && fxp.smooth < 100) this.smooth = +fxp.smooth;
          if (fxp.silence === 0 || fxp.silence === 1) this.silence = fxp.silence;
          this.choMono = fxp.choMono ? 1 : 0;
          const ph = fxp.phase;
          if (ph && typeof ph === 'object' && ph.length >= 4) for (let k = 0; k < 4; k++) { const v = +ph[k]; if (v === v && v !== Infinity && v !== -Infinity) this.seedPh[k] = frac(v); }
          this.revType = fxp.revType === 0 ? 0 : 1;
          const al = fxp.alloc;
          for (let m = 0; m < NMOD; m++) if ((al && al[m]) || this.has[m]) this.allocMod(m);
          if (this.has[7] === 1 && this.mRv.type !== this.revType) this.revSwitch();
          if (this.has[9] === 1) {
            if (fxp.filTypeAll) this.mFi.prealloc();
            else this.mFi.setType(round(95 * clamp01(tgt[99] + this.mdT[99])));
          }
        }
        for (let m = 0; m <= NMOD; m++) this.dirty[m] = 1;
        if (this.fresh !== 0) { this.snap(); this.seed(1); if (ok) this.fresh = 0; } else if (ok && fxp.seed) this.seed(0);
        this.calm = 0;
      }
      allocMod(m) {
        if (this.has[m] === 1) return;
        switch (m) {
          case 0: this.mHy.alloc(); break;
          case 2: this.mFl.alloc(); break;
          case 4: this.mCh.alloc(); break;
          case 5: this.mDl.alloc(); break;
          case 6: this.mCp.alloc(); break;
          case 7: this.mRv.alloc(this.revType); break;
          case 9: this.mFi.alloc(); if (!this.mFi.sf) return; break;
          default: break;                                        // Distortion, Phaser, EQ own no buffers
        }
        this.has[m] = 1;
      }
      // Plate ↔ Hall: the pool grows here; a sounding reverb ducks and the new (empty) topology fades in
      revSwitch() {
        this.mRv.ensure(this.revType);
        if (this.st[7] !== 0 && this.quietT < SEEDQ * this.fs) { this.pend[7] |= 2; if (this.st[7] === 1) this.st[7] = 3; } else this.revApply();
      }
      revApply() {
        const V = this.mRv;
        if (V.type === this.revType) return;
        V.apply(this.revType);
        if (this.st[7] !== 0) { V.upd(this); V.snap(); V.ir = 0; }
      }
      setMods(off) {
        const T = this.mdT;
        let ch = 0;
        if (off && typeof off === 'object' && off.length >= NF) {
          for (let k = 0; k < NF; k++) {
            let v = +off[k];
            v = v > -2 ? (v < 2 ? v : 2) : v < 0 ? -2 : 0;      // NaN → 0
            if (v !== T[k]) { T[k] = v; ch = 1; }
          }
        } else {
          for (let k = 0; k < NF; k++) if (T[k] !== 0) { T[k] = 0; ch = 1; }
        }
        if (ch === 1) this.calm = 0;
      }
      trigger() {                                              // note-on: Hyper RETRIG (immediate; ends a pending re-seed duck)
        const n = this.tgt[87] + this.mdT[87];
        if (n >= 0.5) {
          this.mHy.seed(this.seedPh[0]);
          if ((this.pend[0] & 1) !== 0) { this.pend[0] = 0; if (this.st[0] === 3) this.st[0] = 1; }
        }
      }
      transport() { this.seed(0); }
      // re-seed the LFO phases from seedPh; force (or nothing audible in the lines): at once, together with the other
      // free-running phases and counters (reverb modulation, half-rate grids, the FX filter's S&H / ring phases)
      seed(force) {
        const quiet = force === 1 || this.quietT >= SEEDQ * this.fs;
        this.seedMod(0, quiet); this.seedMod(2, quiet); this.seedMod(3, quiet); this.seedMod(4, quiet);
        this.mDi.seed();
        if (quiet) {
          this.mRv.seed(); this.mDl.hph = 0;
          if (this.has[9] === 1 && force !== 1) this.mFi.reset();
        }
      }
      seedMod(k, quiet) {
        if (quiet || this.st[k] === 0) { this.pend[k] &= 2; this.modSeed(k); return; }
        this.pend[k] |= 1;
        if (this.st[k] === 1) this.st[k] = 3;
      }
      modSeed(k) {
        const P = this.seedPh;
        switch (k) {
          case 0: this.mHy.seed(P[0]); break; case 2: this.mFl.seed(P[1]); break;
          case 3: this.mPh.seed(P[2]); break; default: this.mCh.seed(P[3]); break;
        }
      }
      // at the bottom of a duck: a re-seed restarts the module (its feedback lines hold signal written along the old
      // LFO trajectory, which would come out after one delay), then fades its line inputs in like an enable
      doPend(k) {
        const a = this.pend[k];
        this.pend[k] = 0;
        if ((a & 2) !== 0) this.revApply();
        if ((a & 1) !== 0) { this.modReset(k); this.modIntro(k); this.modSeed(k); }
      }
      flushPend() {
        for (let k = 0; k < NMOD; k++) if (this.pend[k] !== 0) { this.doPend(k); if (this.st[k] === 3) this.st[k] = 1; }
      }
      phases() {                                               // a re-seed waiting for its duck reports the new phase
        const o = this.phOut, P = this.seedPh, pd = this.pend;
        o[0] = (pd[0] & 1) !== 0 ? P[0] : this.mHy.ph[0]; o[1] = (pd[2] & 1) !== 0 ? P[1] : this.mFl.ph;
        o[2] = (pd[3] & 1) !== 0 ? P[2] : this.mPh.ph; o[3] = (pd[4] & 1) !== 0 ? P[3] : this.mCh.ph;
        return o;
      }
      gr() { return this.grOut; }
      // nothing can sound for zero input: no module enabled, or all enabled modules quiet for 1 s plus the longest gap
      // between a delay write and its echo; never while a soft-reset fade is pending (process() renders it)
      idle() {
        if (this.rf !== 1 || this.rfT !== 1) return false;
        if (this.calm === 1 || this.nAct === 0) return true;
        return this.quietT >= this.fs + (this.st[5] !== 0 ? this.mDl.tail() : 0);
      }
      // soft: audible tails fade out over 5 ms, then everything is cleared and the output fades back in; with nothing
      // audible the states are cleared at once and the parameters keep gliding. Hard (panic, restore): cleared and
      // snapped now; the next set() also snaps and re-seeds like a first call unless audio is processed before it.
      reset(soft) {
        if (soft) {
          if (this.nAct > 0 && !this.idle()) { this.rfT = 0; this.calm = 0; } else this.wipe();
          return;
        }
        this.clear();
        if (this.fresh === 0) this.fresh = 2;
      }
      wipe() {
        for (let m = 0; m < NMOD; m++) if (this.has[m] === 1) this.modReset(m);
        this.flushPend(); this.grOut.fill(0); this.seed(1);
        this.quietT = QBIG; this.calm = 0;
      }
      clear() {
        for (let m = 0; m < NMOD; m++) if (this.has[m] === 1) this.modReset(m);
        this.quietT = QBIG; this.qmax = 0; this.rf = 1; this.rfT = 1;    // (qmax: this span counts from the clear on)
        this.grOut.fill(0);
        this.snap(); this.seed(1);
        this.calm = 0;
      }
      // snap every smoother to its target (first set, reset)
      snap() {
        this.flushPend();
        const tgt = this.tgt, en = this.en, ev = this.ev;
        for (let k = 0; k < NF; k++) {
          this.bs[k] = tgt[k]; this.md[k] = this.mdT[k];
          const n = clamp01(tgt[k] + this.mdT[k]);
          en[k] = n; ev[k] = lawV(k, n);
        }
        let act = 0;
        for (let m = 0; m < NMOD; m++) {
          const on = en[ON[m]] >= 0.5 && this.byp[m] === 0 && this.has[m] === 1;
          this.st[m] = on ? 1 : 0; this.xf[m] = on ? 1 : 0;
          if (on) { this.modUpd(m); this.modSnap(m); act++; this.dirty[m] = 0; } else this.dirty[m] = 1;
          this.mixUpd(m); this.gD0[m] = this.gD1[m]; this.gW0[m] = this.gW1[m];
        }
        this.nAct = act;
        this.mDi.v = this.st[1] !== 0 ? DIST_LAT : 0;
        this.gm0 = this.gm1 = ev[0]; this.gT = en[86] >= 0.5 ? 0 : 1; this.gate = this.gT; this.dirty[NMOD] = 0;
        this.latency = this.st[6] !== 0 && this.mCp.mode === 1 ? this.mCp.La : 0;
      }

      /* ---------------- per-module dispatch (monomorphic call sites) */
      modUpd(m) {
        switch (m) {
          case 0: this.mHy.upd(this); break; case 1: this.mDi.upd(this); break; case 2: this.mFl.upd(this); break;
          case 3: this.mPh.upd(this); break; case 4: this.mCh.upd(this); break; case 5: this.mDl.upd(this); break;
          case 6: this.mCp.upd(this); break; case 7: this.mRv.upd(this); break; case 8: this.mEq.upd(this); break;
          default: this.mFi.upd(this); break;
        }
      }
      modSnap(m) {
        switch (m) {
          case 0: this.mHy.snap(); break; case 2: this.mFl.snap(); break; case 3: this.mPh.snap(); break;
          case 4: this.mCh.snap(); break; case 5: this.mDl.snap(); break; case 6: this.mCp.snap(); break;
          case 7: this.mRv.snap(); break;
          default: break;
        }
      }
      modReset(m) {
        switch (m) {
          case 0: this.mHy.reset(); break; case 1: this.mDi.reset(); break; case 2: this.mFl.reset(); break;
          case 3: this.mPh.reset(); break; case 4: this.mCh.reset(); break; case 5: this.mDl.reset(); break;
          case 6: this.mCp.reset(); break; case 7: this.mRv.reset(); break; case 8: this.mEq.reset(); break;
          default: this.mFi.reset(); break;
        }
      }
      // after an enable during audio: fade the delay-line inputs in (5 ms); the look-ahead line starts filled with the
      // first input sample (no run of zeros, no jump when the real input arrives at the read position)
      modIntro(m) {
        switch (m) {
          case 0: this.mHy.ir = 0; break; case 2: this.mFl.ir = 0; break; case 4: this.mCh.ir = 0; break;
          case 5: this.mDl.ir = 0; break; case 6: this.mCp.pre = 1; break; case 7: this.mRv.ir = 0; break;
          default: break;
        }
      }
      modFlush(m) {
        switch (m) {
          case 1: this.mDi.flush(); break; case 3: this.mPh.flush(); break; case 4: this.mCh.flush(); break;
          case 5: this.mDl.flush(); break; case 6: this.mCp.flush(); break; case 7: this.mRv.flush(); break;
          case 8: this.mEq.flush(); break;
          default: break;                                        // Hyper / Flanger: feed-forward or line-only state
        }
      }
      mixUpd(m) {
        const mk = MIXK[m];
        if (mk === 0) return;
        const mx = this.ev[MIXI[m]], lv = this.ev[LVLI[m]];
        if (mk === 2) { this.gD1[m] = (1 - mx) * lv; this.gW1[m] = mx * lv; return; }
        const s = sin(HPI * mx);
        this.gD1[m] = (1 - mx * mx) * lv; this.gW1[m] = s * s * lv;
      }

      /* ---------------- audio */
      process(L, R, n, dL, dR) {
        if (this.fresh === 2) this.fresh = 0;                // audio after a reset(): later edits glide again
        if (this.calm === 1 && !dL) return;                  // bypass-cheap: O(1), L/R untouched
        n = n | 0;
        for (let o = 0; o < n; o += SPAN) this.span(L, R, o, n - o < SPAN ? n - o : SPAN, dL, dR);
      }
      span(L, R, o, n, dL, dR) {
        // §5.4: base one-pole (τ = 10 ms × smooth) per call, mods reached linearly across the call
        const tau = 0.01 * this.smooth * this.fs, a = tau > 0 ? 1 - exp(-n / tau) : 1;
        const tgt = this.tgt, bs = this.bs, md = this.md, mdT = this.mdT, eS = this.eS, eD = this.eD;
        let mv = 0;
        for (let k = 0; k < NF; k++) {
          const b0 = bs[k], t = tgt[k];
          let b1 = t;
          if (FCONT[k] === 1 && b0 !== t) {
            b1 = b0 + (t - b0) * a;
            if (b1 - t < 1e-10 && t - b1 < 1e-10) b1 = t;
          }
          bs[k] = b1;
          const s = (FCONT[k] === 1 ? b0 : b1) + md[k], e = b1 + mdT[k];
          md[k] = mdT[k];
          eS[k] = s; eD[k] = e - s;
          if (e !== s) mv = 1;
        }
        let z = 1;
        for (let i = o, end = o + n; i < end; i++) if (L[i] !== 0 || R[i] !== 0) { z = 0; break; }
        this.inZero = z; this.qmax = 0;
        const ord = this.ord, st = this.st;
        for (let b = 0; b < n; b += BLK) {
          const m = n - b < BLK ? n - b : BLK, oo = o + b;
          if (b === 0 || mv === 1) this.params((b + m) / n);
          this.states();
          for (let q = 0; q < NMOD; q++) { const k = ord[q]; if (st[k] !== 0) this.runMod(k, L, R, oo, m); }
          this.out(L, R, oo, m, dL, dR);
        }
        this.post(n);
      }
      // eff n at block position t ∈ (0, 1] of the call; law values recomputed only where n changed
      params(t) {
        const eS = this.eS, eD = this.eD, en = this.en, ev = this.ev, dirty = this.dirty;
        for (let k = 0; k < NF; k++) {
          let n = eS[k] + eD[k] * t;
          n = n > 0 ? (n < 1 ? n : 1) : 0;
          if (n !== en[k]) { en[k] = n; ev[k] = lawV(k, n); dirty[MOD_OF[k]] = 1; }
        }
      }
      // module enable state machine (st, see the constructor) and coefficient updates
      states() {
        const en = this.en, st = this.st, dirty = this.dirty;
        for (let m = 0; m < NMOD; m++) {
          const on = en[ON[m]] >= 0.5 && this.byp[m] === 0 && this.has[m] === 1, s = st[m];
          if (on) {
            if (s === 0) {                                       // 0 → 1: reset, fresh coefficients, fade in
              this.modReset(m); this.modIntro(m); this.modUpd(m); this.modSnap(m); this.mixUpd(m);
              this.gD0[m] = this.gD1[m]; this.gW0[m] = this.gW1[m];
              st[m] = 1; this.xf[m] = 0; dirty[m] = 0;
              if (m === 1) this.mDi.v = 0;
              continue;
            }
            if (s === 2) st[m] = this.pend[m] !== 0 ? 3 : 1;
          } else if (s === 1 || s === 3) st[m] = 2;
          if (st[m] !== 0 && dirty[m] === 1) { this.modUpd(m); this.mixUpd(m); dirty[m] = 0; }
        }
        if (dirty[NMOD] === 1) { this.gm1 = this.ev[0]; this.gT = en[86] >= 0.5 ? 0 : 1; dirty[NMOD] = 0; }
        this.latency = st[6] !== 0 && this.mCp.mode === 1 ? this.mCp.La : 0;
      }
      runMod(k, L, R, o, m) {
        const inL = this.inL, inR = this.inR;
        for (let j = 0; j < m; j++) { inL[j] = L[o + j]; inR[j] = R[o + j]; }
        let dd = 0;
        switch (k) {
          case 0: this.mHy.run(this, L, R, o, m); break;
          case 1: {
            const D = this.mDi, s = this.st[1], x = this.xf[1];
            D.need = s !== 1 || x < 1 ? 1 : 0; D.vdir = s === 1 ? 1 : x === 0 ? -1 : 0;
            D.run(this, L, R, o, m); dd = 1; break;
          }
          case 2: this.mFl.run(this, L, R, o, m); break;
          case 3: this.mPh.run(this, L, R, o, m); break;
          case 4: this.mCh.run(this, L, R, o, m); break;
          case 5: this.mDl.run(this, L, R, o, m); break;
          case 6: this.mCp.run(this, L, R, o, m); dd = 1; break;
          case 7: this.mRv.run(this, L, R, o, m); break;
          case 8: this.mEq.run(this, L, R, o, m); break;
          default: this.mFi.run(this, L, R, o, m); break;
        }
        if (MIXK[k] !== 0) this.mix(k, L, R, o, m, dd === 1 ? this.dyL : inL, dd === 1 ? this.dyR : inR);
        if (this.st[k] >= 2 || this.xf[k] < 1) { if (k === 1) this.xfadeD(L, R, o, m); else this.xfade(k, L, R, o, m); }
        if (this.inZero === 1) {
          let q = this.qmax;
          for (let j = 0; j < m; j++) {
            const a = L[o + j], b = R[o + j];
            if (a > q) q = a; else if (-a > q) q = -a;
            if (b > q) q = b; else if (-b > q) q = -b;
          }
          this.qmax = q;
        }
      }
      // MIX law (inv A20.2) out = dry·(1 − m²)·lvl + wet·sin²(πm/2)·lvl (Filter: linear), ramped per sample
      mix(k, L, R, o, m, DL, DR) {
        const d0 = this.gD0[k], w0 = this.gW0[k], d1 = this.gD1[k], w1 = this.gW1[k];
        this.gD0[k] = d1; this.gW0[k] = w1;
        if (d0 === 0 && d1 === 0 && w0 === 1 && w1 === 1) return;
        const dd = (d1 - d0) / m, dw = (w1 - w0) / m;
        for (let j = 0; j < m; j++) {
          const i = o + j, gd = d0 + dd * (j + 1), gw = w0 + dw * (j + 1);
          L[i] = DL[j] * gd + L[i] * gw; R[i] = DR[j] * gd + R[i] * gw;
        }
      }
      // 5 ms enable / disable crossfade with the module input; st 3: 2.5 ms duck, pending actions at the bottom, fade in
      xfade(k, L, R, o, m) {
        const inL = this.inL, inR = this.inR, s = this.st[k], step = s === 1 ? this.fstep : s === 3 ? -2 * this.fstep : -this.fstep;
        let x = this.xf[k];
        for (let j = 0; j < m; j++) {
          x += step;
          x = x > 1 ? 1 : x < 0 ? 0 : x;
          const i = o + j;
          L[i] = inL[j] + x * (L[i] - inL[j]); R[i] = inR[j] + x * (R[i] - inR[j]);
        }
        this.xf[k] = x;
        if (x === 0 && s >= 2) {
          if (this.pend[k] !== 0) this.doPend(k);
          this.st[k] = s === 2 ? 0 : 1;                          // stopped (cleared at the next enable) / fade back in
        }
      }
      // Distortion (DIST_LAT samples of latency, wet and dry): while the module's output weight is 0 the bypassed signal
      // glides between no delay and the latency (5 ms, ≈ 1 semitone), so the 5 ms crossfade itself is between
      // time-aligned signals (no comb notch mid-fade) and both ends are continuous
      xfadeD(L, R, o, m) {
        const D = this.mDi, dvL = this.dvL, dvR = this.dvR, s = this.st[1], fst = this.fstep;
        const v0 = D.v0, gst = D.gst, vdir = D.vdir;
        let x = this.xf[1];
        for (let j = 0; j < m; j++) {
          if (s === 1) { if (x < 1 && (vdir <= 0 || v0 + j * gst >= DIST_LAT)) { x += fst; if (x > 1) x = 1; } } else if (x > 0 && vdir === 0) { x -= fst; if (x < 0) x = 0; }
          const i = o + j, a = dvL[j], b = dvR[j];
          L[i] = a + x * (L[i] - a); R[i] = b + x * (R[i] - b);
        }
        this.xf[1] = x;
        if (s === 2 && x === 0 && D.v === 0) this.st[1] = 0;
      }
      // output stage: + direct bus, × master (ramped), × bypass gate (5 ms), × soft-reset fade
      out(L, R, o, m, dL, dR) {
        if (dL && dR) for (let j = 0; j < m; j++) { const i = o + j; L[i] += dL[i]; R[i] += dR[i]; }
        const g0 = this.gm0, g1 = this.gm1, gT = this.gT, rfT = this.rfT;
        this.gm0 = g1;
        let gate = this.gate, rf = this.rf;
        if (g0 === 1 && g1 === 1 && gate === 1 && gT === 1 && rf === 1 && rfT === 1) return;
        const dg = (g1 - g0) / m, st = this.fstep;
        for (let j = 0; j < m; j++) {
          if (gate !== gT) {
            if (gate < gT) { gate += st; if (gate > gT) gate = gT; } else { gate -= st; if (gate < gT) gate = gT; }
          }
          if (rf !== rfT) {
            if (rf < rfT) { rf += st; if (rf > rfT) rf = rfT; } else { rf -= st; if (rf < rfT) rf = rfT; }
          }
          const i = o + j, g = (g0 + dg * (j + 1)) * gate * rf;
          L[i] *= g; R[i] *= g;
        }
        this.gate = gate; this.rf = rf;
        if (rf === 0 && rfT === 0) { this.clear(); this.rf = 0; this.rfT = 1; }   // soft reset: clear, then fade back in
      }
      post(n) {
        let act = 0;
        for (let m = 0; m < NMOD; m++) if (this.st[m] !== 0) { act++; this.modFlush(m); }
        this.nAct = act;
        if (act > 0 && this.inZero === 1 && this.qmax < 1e-6) this.quietT += n; else this.quietT = 0;
        const gr = this.grOut;
        if (this.st[6] !== 0) this.mCp.meter(gr); else if (gr[0] !== 0 || gr[1] !== 0 || gr[2] !== 0 || gr[3] !== 0) gr.fill(0);
        const g = this.gm1;
        this.calm = act === 0 && this.gate === 1 && this.gT === 1 && this.rf === 1 && this.rfT === 1 &&
          g - 1 < 1e-9 && 1 - g < 1e-9 && this.bs[0] === this.tgt[0] ? 1 : 0;
      }

      /* ---------------- JIT warm-up and test hooks */
      warmUp() {
        const t = new FXRack(this.fs), N = SPAN, L = new Float64Array(N), R = new Float64Array(N);
        const dL = new Float64Array(N), dR = new Float64Array(N), base = new Float64Array(NF), mods = new Float64Array(NF);
        for (let k = 0; k < NF; k++) base[k] = FX_DEF[k];
        for (let m = 0; m < NMOD; m++) base[ON[m]] = 1;
        base[0] = 0.83; base[FIDX.DIM_MIX] = 0.53; base[FIDX.DLY_Q] = 0.63; base[FIDX.DLY_TIMEL] = 0.31; base[FIDX.REV_T] = 0.37;
        const ord = new Uint8Array(NMOD), all = new Uint8Array(NMOD);
        for (let m = 0; m < NMOD; m++) { ord[m] = m; all[m] = 1; }
        const fxp = { ver: VER, NF, base, order: ord, byp: new Uint8Array(NMOD), revType: 0, choMono: 0, alloc: all, filTypeAll: 1,
          phase: Float64Array.from([0.1, 0.2, 0.3, 0.4]), seed: 1, any: 1, bpm: 120, smooth: 1, silence: 1, xsKey: '' };
        let r = 0x2545F491;
        for (let round = 0; round < 2; round++) {
          for (let c = 0; c < 16; c++) {
            // every module, mode and switch: compressor single band / Limit / multiband (c = 3, 11 Limit; 4–7, 12–15 MB)
            base[FIDX.DIST_MODE] = c / 15; base[FIDX.DIST_FILT] = (c % 3) / 2; base[FIDX.DLY_MODE] = (c % 3) / 2;
            base[FIDX.DLY_BPM] = c & 1; base[FIDX.DLY_LINK] = (c >> 1) & 1; base[FIDX.EQ_TYPEL] = (c % 3) / 2;
            base[FIDX.EQ_TYPEH] = ((c + 1) % 3) / 2; base[FIDX.CMP_MB] = (c >> 2) & 1;
            base[FIDX.FLG_BPM] = c & 1; base[FIDX.PHS_BPM] = (c >> 1) & 1; base[FIDX.CHO_BPM] = (c >> 2) & 1;
            base[FIDX.HYPER_RETRIG] = c & 1; base[FIDX.FIL_TYPE] = (c * 6 + round) / 95;
            base[FIDX.DIST_ON] = c === 9 ? 0 : 1;                // Distortion disable / enable glides
            fxp.revType = c & 1; fxp.choMono = (c >> 2) & 1; fxp.seed = c === 0 || c === 6 ? 1 : 0;
            t.set(fxp, null);
            for (let s = 0; s < 3; s++) {
              for (let i = 0; i < N; i++) {
                r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
                L[i] = ((r >>> 0) / 4294967296 - 0.5) * 0.9; R[i] = L[i] * 0.7; dL[i] = L[i] * 0.1; dR[i] = dL[i];
              }
              mods[FIDX.FIL_CUTOFF] = 0.07 * s; mods[FIDX.DIST_DRIVE] = 0.11 * s; mods[FIDX.REV_SIZE] = 0.05 * s;
              mods[FIDX.CMP_RATIO] = c % 4 === 3 ? 0.3 : 0;      // a modulated RATIO reaches Limit within the call (base glides)
              t.setMods(mods);
              t.trigger();
              if (c === 11 && s === 1) t.transport();            // re-seed ducks
              t.process(L, R, N, s === 2 ? dL : undefined, s === 2 ? dR : undefined);
            }
            t.gr(); t.phases(); t.idle();
          }
        }
        t.setMods(null); t.reset(true);
        for (let s = 0; s < 4; s++) t.process(L, R, N);
        t.transport(); t.reset();
        this.reset();
      }
      // test hook: bytes held in typed arrays reachable from the rack (module buffers, the FX filter's SFilter)
      bytes() {
        const seen = new Set();
        let n = 0;
        const add = (x, depth) => {
          if (!x || typeof x !== 'object' || depth > 3) return;
          if (ArrayBuffer.isView(x)) { if (!seen.has(x.buffer)) { seen.add(x.buffer); n += x.buffer.byteLength; } return; }
          if (seen.has(x)) return;
          seen.add(x);
          for (const k of Object.keys(x)) add(x[k], depth + 1);
        };
        add(this, 0);
        return n;
      }
    }

    /* ------------------------------------------------------------ main-thread helpers (§8.5.1) */
    // static transfer y(x) for x = −1…1 (Downsample: y = 0.5x)
    function distCurve(mode, drive, xsA, xsB, n = 257) {
      n = n > 1 ? n | 0 : 2;
      const S = new Shaper(), out = new Float64Array(n);
      S.xa = okXS(xsA) ? xsA : LINXS; S.xb = okXS(xsB) ? xsB : LINXS;
      S.set(+mode, drive);
      for (let i = 0; i < n; i++) { const x = -1 + 2 * i / (n - 1); out[i] = S.mode === 8 ? 0.5 * x : shape(S, x); }
      return out;
    }
    // magnitude (dB) of the 2-band EQ at freqs; effN = eff n vector (snapshot eff of 248, or 100 in fx idx order),
    // else fxp.base, else the defaults
    function eqResponse(fxp, effN, freqs, fs) {
      const n = freqs && freqs.length > 0 ? freqs.length | 0 : 0, out = new Float64Array(n);
      fs = fs > 0 ? +fs : 48000;
      let src = null, off = 0;
      if (effN && effN.length >= 248) { src = effN; off = 148; } else if (effN && effN.length >= NF) src = effN;
      else if (fxp && fxp.base && fxp.base.length >= NF) src = fxp.base;
      const v = new Float64Array(NF), c = new Float64Array(10);
      for (let k = 72; k <= 98; k++) v[k] = lawV(k, clamp01(src ? +src[off + k] : FX_DEF[k]));
      eqCoefs(v, fs, c);
      for (let i = 0; i < n; i++) {
        const w = TAU * freqs[i] / fs;
        out[i] = 0.5 * DB * log(bqMag2(c, 0, w) * bqMag2(c, 5, w));
      }
      return out;
    }
    // dB response of the delay band filter (F Hz, bandwidth in octaves); flat 0 dB when bypassed (bw ≥ 8.19). Above
    // 96 kHz the filter runs at the half-rate line rate, like the module.
    function delayFilterResponse(F, bwOct, freqs, fs) {
      const n = freqs && freqs.length > 0 ? freqs.length | 0 : 0, out = new Float64Array(n);
      if (!(bwOct < DLY_FLAT)) return out;
      fs = fs > 0 ? +fs : 48000;
      const fi = fs > 96000 ? fs / 2 : fs, c = new Float64Array(10);
      dlyCoefs(+F, +bwOct, fi, c);
      for (let i = 0; i < n; i++) {
        const w = TAU * freqs[i] / fi;
        out[i] = 0.5 * DB * log(bqMag2(c, 0, w) * bqMag2(c, 5, w));
      }
      return out;
    }
    // re-export of SerumDSP.filterImpulse, resolved at call time (null without SerumDSP)
    function filterImpulse(type, fc, res, drive, vr, fs, len) {
      const S = globalThis.SerumDSP;
      return S && typeof S.filterImpulse === 'function' ? S.filterImpulse(type, fc, res, drive, vr, fs, len) : null;
    }

    globalThis.FXDSP = Object.freeze({
      VER, FIDX, LAW_TAB_FX, FXRack, distCurve, eqResponse, delayFilterResponse, MODFX_HZ, filterImpulse,
    });
  } catch (err) {
    globalThis.FXDSP = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('fx-dsp: load failed', err);
  }
})();
