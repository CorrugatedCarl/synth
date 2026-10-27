/*
 * fx-dsp.js — Serum-style FX rack DSP (classic script #11 of the SPEC-serum2 §0.3 list, no imports/exports). Owner F1
 * (Phase 1: E4).
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread (<script> injected by wk.loadDSP) and in
 * node vm contexts (tests). The whole file is one IIFE that publishes `globalThis.FXDSP`; it can be evaluated again in
 * the same scope, and a failure inside leaves FXDSP = null without throwing. `globalThis.SerumDSP` (SFilter for the
 * Filter module, filterImpulse) is read lazily inside functions, never at load; the S1 code never reads `SxBase`.
 * Contract: SPEC-serum2 §4.2 (FX-context layout), §4.3 (FXP v2 / FXT v2), §8.1 (rack engine), §11.11 (exports), §1
 * (buses, output stage), on top of SPEC-serum.md §8.5 (module recipes, shapers), §5.4–§5.5 (FX smoothing and
 * modulation), §6.15 (master / bypass output stage).
 *
 * v2 (F1, M1a step 3): FXRack reads FXP v2 (VER 2). One Unit per FXP instance, kept by instance id across set() calls
 * while its type and variant match (state, phases and buffers survive edits of other instances); a removed instance that
 * still sounds fades out (5 ms) at its old place in the chain, then is dropped. Parameters are addressed in the
 * FX-context layout: [0] g.master [1] g.bypass [2] g.direct [3] g.bus1v [4] g.bus2v, [8 + off + p] parameter p of the
 * instance (setMods takes the same vector; with a key argument a stale layout is ignored). Racks: MAIN (rack 0) on L/R,
 * BUS 1 / BUS 2 on their inputs (process b1*, b2*), each × its level and routed to Main / Direct / the other bus in
 * dependency order; rack bypass crossfades (5 ms). S1 variants (v = 1) are the Phase-1 modules with their v1 tables and
 * exactly the Phase-1 arithmetic per instance (they never read SxBase). A rack of S1 instances in Phase-1 module order
 * renders bit-identically to the Phase-1 FXRack (§8.1, §15.1): every neutral v2 term (direct / bus levels at 0 dB, no
 * bus, no rack bypass) is skipped, never computed (§0.7). phases() → Float64Array(48) and gr() → Float32Array(4·48) are
 * indexed by FXP instance (fxLayout order).
 * M2 (F1): the S2 variants of the changed modules (§8.2: Distortion modes 0–17 through SxBase's shapers with Key Track and
 * Overdrive staged by FXMods2.Overdrive, Phaser POLES / DEPTH 2, Chorus HPF, Delay HQ with Float32 lines, Compressor
 * crossovers / BELOW / band gains, EQ level, Filter types 0–107 / Key Track / Clean Mode), the S2 Reverb unit (§8.3:
 * pre-delay, LOW / HIGH CUT, Plate / Hall here, Vintage / Nitrous / Basin as FXMods2 tanks in one shared pool, type changes
 * ducked), the FXMods2 modules (Bode, Convolve, Utility) and the splitters (SplitMod: an FXMods2 band builder, the branch
 * chains run on the bands, Σ × LEVEL); every S2 variant at its S1-equivalent setting renders bit-identically to the S1
 * instance (Compressor: within its crossover rounding). Kinds that cannot run in this scope (§0.3 failure column: S2
 * variants without SxBase, the FXMods2 types without FXMods2, Convolve without its IR entry, an S2 reverb type without its
 * tank) pass their input. The per-track memory cap (§8.5): set() leaves an instance whose allocation would take the
 * rack's bytes() above 32 MB unallocated and bypassed and lists its id in `over` (the host shows the notice); set-time
 * growth of allocated units (Convolve tail FDL, S2 Reverb pool, splitter alignment lines) is checked too (Convolve:
 * keeps its FDL and is bypassed until it fits; Reverb: the unprepared TYPE is not installed); an instance refused once
 * is not allocated again until the rack has room for the size it measured. Convolve's adopted IR spectra are assets and
 * are not counted; its tail FDL is sized from the stored entry (nothing for a missing one) — at set() or at assets(),
 * the host hook called after SxBase.storeAsset / dropAsset (§9.5 'smp' / 'smpdel'). Splitters crossfade a branch
 * bypass over 5 ms and align their branches' latencies (Distortion, Limit look-ahead); `latency` includes Limit-mode
 * compressors in MAIN splitter branches. distCurve(mode 0–17, drive, xsA, xsB, n, stages) and
 * splitResponse(type, f1, f2, freqs, fs) are the §11.11 display helpers.
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
 *   Downsample hold, half-rate grids, the FX filter's S&H / ring phases, the Bode's BLUR LFOs): renders after a
 *   silent history are bit-identical to a fresh rack's (§10.7f). While a module sounds, its re-seed waits for a
 *   2.5 ms duck of that module (output → input), restarts it there and fades it back in (5 ms); phases() reports the
 *   new phase at once. The reverb's internal modulation is not re-seeded while its tail sounds. RETRIG stays immediate.
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
 * - rest(n): the host calls it for each span it skips an idle() rack (n frames): one pass over the Float32 lines, below
 *   FLT_MIN → 0, a bounded share per frame, until the rack runs again (the frozen lines keep no float32 subnormal).
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

    const VER = 2, NF = 100, NMOD = 10, BLK = 16, SPAN = 128, NXS = 1025, SWEEP = 0.125;   // VER = FXP major (§2.6.5); NF = v1 FX rows
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

    // §3.1 laws (same expressions as serum-core lawValue): lawU(law code, lo, hi, n); lawV(k, n) of v1 fx idx k
    function lawV(k, n) { return lawU(FLAW[k], FLO[k], FHI[k], n); }
    function lawU(law, lo, hi, n) {
      switch (law) {
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

    // delay time (s) of a time (ms) / BPM-ladder (DLY_LADDER index) pair, clamped to [0, cap]
    function dlyTimeS(ms, bpmOn, lad, bpm, cap) {
      const s = bpmOn >= 0.5 ? DLY_BEATS[lad > 0 ? (lad < 11 ? round(lad) : 11) : 0] * 60 / (bpm > 0 ? bpm : 120) : 0.001 * ms;
      return s > 0 ? (s < cap ? s : cap) : 0;
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
    // flushArr of a reverb pool's first n floats (default: all; null: nothing) → 1 if they held any nonzero value (0: clean,
    // FXRack.sweep's stop). The pools are Float32: a tail that decays into the float32 subnormal range never reaches 0 in a recirculating loop (g × the
    // smallest subnormal rounds back to it), and x86 pays a microcode assist per subnormal conversion — a never-calm rack
    // (MASTER's, a sidechain-live panel) on silence read and wrote tens of thousands for ever (the Windows idle-load report,
    // 2026-10-25). Only the reverb pools keep one: the Delay / Chorus / Flanger feedback goes through sat() (< 1e-25 → 0), the
    // Bode's through flush1, the other lines are feed-forward copies of a zero input. Whole, not in strides: the unswept part of
    // a loop re-infects a swept window within one period (the Plate kept 21 k of its 64 k floats under a 512-stride sweep)
    function sweepArr(s, n) {
      if (s === null) return 0;
      let nz = 0;
      if (!(n <= s.length)) n = s.length;
      for (let i = 0; i < n; i++) { const v = s[i]; if (v !== 0) { nz = 1; if (v < 1e-30 && v > -1e-30) s[i] = 0; } }
      return nz;
    }
    // review #7: a reverb's input diffusers (allpasses ahead of the tank, g > 0.5) stuck at ±the smallest float32 subnormal 1–3 s
    // after their input stopped while the tank still rang — no sweep before idle(), for ever at Hall / Basin's infinite
    // settings. After a tank run on a silent input (silent(): 0 a sample ≥ 1e-30 — its first, while audio plays —, 1 every
    // sample below, 2 exact zeros) the entries each diffuser wrote in it (its last m ≥ its writes, the whole line when m ≥ its
    // capacity) flush below FLT_MIN, the values a float32 holds only as subnormals (difFlush, Tank.dif in fx-mods2; outside the
    // tank loops: a store flush inside them cost JavaScriptCore 2–3 %). No diffuser gets there inside a golden: the audio is
    // unchanged
    const FLT_MIN = 1.1754943508222875e-38;
    function silent(L, R, o, m) {
      let s = 2;
      for (let i = o, e = o + m; i < e; i++) {
        const a = L[i], b = R[i];
        if (a !== 0 || b !== 0) { if (a >= 1e-30 || a <= -1e-30 || b >= 1e-30 || b <= -1e-30) return 0; s = 1; }
      }
      return s;
    }
    function fl32(P, a, b) {                                  // → 1 if a value was nonzero
      let nz = 0;
      for (let i = a; i < b; i++) { const v = P[i]; if (v !== 0) { nz = 1; if (Math.abs(v) < FLT_MIN) P[i] = 0; } }
      return nz;
    }
    function ring32(P, o, c, w, m) {                         // ring at o (capacity c, write index w): its last m entries
      if (m >= c) return fl32(P, o, o + c);
      if (w >= m) return fl32(P, o + w - m, o + w);
      return fl32(P, o + w - m + c, o + c) | fl32(P, o, o + w);
    }
    // the Reverb's diffusers e0 … e1 after a run of m samples with silent() = z (T.dz: samples of exact-zero input their entries
    // have read 0 for; past T.dzM, two laps of every line on the way in — the Plate's pre-delay too —, nothing can reach them
    // until a sample arrives: the flush stops)
    function difFlush(T, P, e0, e1, z, m) {
      if (z === 0) { T.dz = 0; return; }
      if (z === 1) T.dz = 0; else if (T.dz >= T.dzM) return;
      const off = T.off, cap = T.cap, wp = T.wp;
      let nz = 0;
      for (let e = e0; e <= e1; e++) nz |= ring32(P, off[e], cap[e], wp[e], m);
      T.dz = nz !== 0 ? 0 : T.dz + m;
    }
    // FXRack.rest: the Float32 lines of each kind (u.mod's fields; none: null) — the Hyper, Flanger, Chorus and Delay lines, the
    // reverb pools (the S2 pool holds the Vintage / Nitrous / Basin tanks too) and the S2 Reverb's pre-delay, the Bode's line
    // and BLUR allpasses, the Convolve's pre-delay and input FDLs; not tables (the shaper curves, the Ducker's curve, the IR
    // spectra). REST: floats per skipped frame (32 k a quantum, half the sweep's slowest)
    const LINES = [['lL', 'lR', 'lD'], null, ['lL', 'lR'], null, ['buf'], ['lL', 'lR'], null, ['pool'], null, null, null, null,
      ['buf'], ['lL', 'lR'], null, ['pool', 'pl'], null, null, ['lL', 'lR', 'bl'], ['pL', 'pR', 'mXr', 'mXi', 'tXr', 'tXi'], null, null, null];
    const REST = 256;

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
    function eqCoefs(v, fs, c) {                               // v = engine values of the EQ S1 table (local order)
      eqBand(v[7], 0, v[1], v[2], v[3], fs, c, 0);
      eqBand(v[8], 1, v[4], v[5], v[6], fs, c, 5);
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
        const ev = R.ev, n = R.en[1];
        this.rate = n > 0 ? 0.1 + 6 * n * n : 0;              // RATE 0 freezes the voices (phase memory, inv A20.1)
        this.det = ev[2];
        const N = ev[3], g = N > 0 ? 1 / sqrt(N) : 0;
        for (let j = 0; j < 7; j++) this.g1[j] = j < N ? g : 0;
        this.mx1 = ev[4]; this.lv1 = ev[5];
        const k = (0.3 + 1.7 * ev[6]) * this.fs / 1000;
        for (let q = 0; q < 4; q++) this.t1[q] = k * DIM_MS[q];
        this.dm1 = ev[7]; this.dl1 = ev[8];
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
        const mode = ev[7];
        this.mode = mode; this.filt = ev[8];
        this.S.xa = R.xsA; this.S.xb = R.xsB;
        this.S.set(mode, ev[1]);
        this.asym = mode === 0 || mode === 3 || mode === 9 || mode === 10 || mode === 12 || mode === 14 ? 1 : 0;
        this.k = 1 / ev[4];
        const c = R.cf;
        svfC(ev[3], this.k, fs, c, 0);
        this.a1 = c[0]; this.a2 = c[1]; this.a3 = c[2];
        const l = ev[2];
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
        this.rate = MODFX_HZ(en[1], en[7] >= 0.5, R.bpm);
        this.depth = ev[2]; this.fb = 0.95 * ev[3]; this.off = ev[4] / 360;
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
        this.rate = MODFX_HZ(en[1], en[8] >= 0.5, R.bpm);
        this.depth = ev[2]; this.freq = ev[3]; this.fb = 0.95 * ev[4]; this.off = ev[5] / 360;
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
        this.hp = 0;                                           // S2 HPF: the wet 2-pole filter is a high-pass (S1: always 0)
      }
      alloc() { this.cap = ceil(0.0465 * this.fs) + 8; this.buf = new Float32Array(4 * this.cap); }
      reset() { if (this.buf) this.buf.fill(0); this.w = 0; this.lp.fill(0); this.ir = 1; }
      upd(R) {
        const ev = R.ev, en = R.en;
        this.rate = MODFX_HZ(en[1], en[9] >= 0.5, R.bpm);
        this.t1 = ev[2]; this.t2 = ev[3]; this.dep = ev[4]; this.fb = ev[5]; this.mono = R.choMono;
        svfC(ev[6], SQRT2, this.fs, this.c, 0);
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
        const cap = this.cap, buf = this.buf, fb = this.fb, c = this.c, a1 = c[0], a2 = c[1], a3 = c[2], hp = this.hp;
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
            const yw = 0.5 * (ya + yb), v3 = yw - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
            s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
            X[i] = hp === 1 ? yw - SQRT2 * v1 - v2 : v2;
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
        const ev = R.ev, en = R.en, bpm = R.bpm > 0 ? R.bpm : 120, sync = en[10] >= 0.5;
        this.tL = this.time(en, ev, 2, 4, sync, bpm);
        this.tR = en[11] >= 0.5 ? this.tL : this.time(en, ev, 3, 5, sync, bpm);
        this.fb = ev[1]; this.mode = ev[12];
        const bw = ev[7];
        this.flat = bw >= DLY_FLAT ? 1 : 0;
        if (this.flat === 0) dlySvf(ev[6], bw, this.fi, this.c);
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
        this.slopeB = 0.75; this.bgL = 1; this.bgM = 1; this.bgH = 1;   // S2: BELOW slope, band gains (S1: RATIO's slope, 1)
        // IMPL-SC §3.2 (v3, Comp2 only): KEY EXT (the detector reads the track's key, R.sc), its HPF (states ks, coefficients kc;
        // off at the minimum), LISTEN (the key out), the block's key scratch (ka / kx / ky, Comp2.keyIn). Never set by a v1 / v2 unit:
        // the key branch is skipped, the arithmetic as before
        this.ext = 0; this.hpOn = 0; this.lsn = 0; this.ks = null; this.kc = null; this.ka = null; this.kx = null; this.ky = null;
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
        this.thr = ev[1]; this.thrDb = DB * log(this.thr);
        const r = ev[2];
        this.limit = r >= 1e6 ? 1 : 0; this.slope = 1 - 1 / r; this.slopeB = this.slope;
        const att = ev[3] > 0.1 ? ev[3] : 0.1, rel = ev[4] > 0.1 ? ev[4] : 0.1;
        this.aA = 1 - exp(-1000 / (att * fs)); this.rR = exp(-1000 / (rel * fs)); this.aR = 1 - this.rR;
        this.mk = ev[5];
        this.mb = en[11] >= 0.5 ? 1 : 0;
        const n = en[3], La = round(10 * n * n * fs / 1000);
        this.La = La < this.cap - 2 ? La : this.cap - 2 > 0 ? this.cap - 2 : 0;
        for (let b = 0; b < 3; b++) {
          const g = ev[6 + b], T = this.thrDb + (g > 1e-6 ? DB * log(g) : -120);
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
        const thrDb = this.thrDb, slope = this.slope, rR = this.rR, aA = this.aA, aR = this.aR, mk = this.mk, slopeB = this.slopeB;
        const bgL = this.bgL, bgM = this.bgM, bgH = this.bgH;
        const T = this.T, T0 = T[0], T1 = T[1], T2 = T[2], DL = R.dyL, DR = R.dyR, bp = this.bp, bg = this.bg;
        this.split(L, o, m, 0); this.split(Rc, o, m, 1);
        const d = this.bd, bLo = d[0], bMd = d[1], bHi = d[2], bAp = d[3], cLo = d[4], cMd = d[5], cHi = d[6], cAp = d[7];
        const M = this.mode, P = this.pm, cst = this.cst, fade = this.cx < 1 ? 1 : 0;
        const uS = M === 0 || (fade === 1 && P === 0), uL = M === 1 || (fade === 1 && P === 1), uM = M === 2 || (fade === 1 && P === 2);
        if (this.pre === 1 && m > 0) { la.fill(L[o], 0, cap); la.fill(Rc[o], cap, 2 * cap); this.pre = 0; }
        // IMPL-SC §3.2: KEY EXT (v3) — the single-band detector and the Limit deque read the track's key (Comp2.keyIn: the block's
        // filtered key kx / ky and its detector input ka, a pass of its own); hoisted per block, so a v1 / v2 unit's loop pays one
        // test. LISTEN replaces the output with the (filtered) key × makeup, the dry unchanged — not in MULTIBAND, whose bands ignore
        // the key (§11; review 1 F3: the output stays the bands)
        const K = this.ext === 1 ? R.sc : null, lsn = K !== null && this.lsn === 1 && M !== 2 ? 1 : 0, ka = this.ka, kx = this.kx, ky = this.ky;
        if (K !== null) this.keyIn(K, m);
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
          let a;
          if (K === null) { const al = xl < 0 ? -xl : xl, ar = xr < 0 ? -xr : xr; a = al > ar ? al : ar; } else a = ka[j];
          const r = a > thr ? thr / a : 1;
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
            g = mbCurve(p0, T0, slope, slopeB);
            if (g > g0 && eM === 0) { g0 += (g - g0) * aA; if (p0 > 1e-4) { const c = (g < 0 ? g : 0) - MB_UP; if (g0 < c) g0 = c; } } else g0 = g;
            g = mbCurve(p1, T1, slope, slopeB);
            if (g > g1 && eM === 0) { g1 += (g - g1) * aA; if (p1 > 1e-4) { const c = (g < 0 ? g : 0) - MB_UP; if (g1 < c) g1 = c; } } else g1 = g;
            g = mbCurve(p2, T2, slope, slopeB);
            if (g > g2 && eM === 0) { g2 += (g - g2) * aA; if (p2 > 1e-4) { const c = (g < 0 ? g : 0) - MB_UP; if (g2 < c) g2 = c; } } else g2 = g;
          }
          eS = 0; eM = 0;
          // outputs (wet, dry) of the modes in use; a mode change crossfades both
          let sL = 0, sR = 0, lL = 0, lR = 0, mL = 0, mR = 0;
          if (uS) { const gn = gs > 0 ? exp(-IDB * gs) : 1; sL = xl * gn; sR = xr * gn; }
          if (uL) { lL = yl * lg; lR = yr * lg; }
          if (uM) {
            const e0 = (g0 === 0 ? 1 : exp(-IDB * g0)) * bgL, e1 = (g1 === 0 ? 1 : exp(-IDB * g1)) * bgM, e2 = (g2 === 0 ? 1 : exp(-IDB * g2)) * bgH;
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
          if (lsn === 1) { oL = kx[j]; oR = ky[j]; }
          L[i] = oL * mk; Rc[i] = oR * mk; DL[j] = dl; DR[j] = dr;
        }
        this.w = w; this.front = front; this.cnt = cnt; this.tc = tc; this.lg = lg; this.pk = pk; this.gs = gs; this.cx = cx;
        bp[0] = p0; bp[1] = p1; bp[2] = p2; bg[0] = g0; bg[1] = g1; bg[2] = g2;
      }
      meter(gr, o) {                                         // gain reduction (dB) into gr[o … o + 3]
        if (this.mode === 2) { gr[o] = 0; gr[o + 1] = this.bg[0]; gr[o + 2] = this.bg[1]; gr[o + 3] = this.bg[2]; return; }
        gr[o] = this.mode === 1 ? (this.lg < 1 ? -DB * log(this.lg > 1e-12 ? this.lg : 1e-12) : 0) : this.gs;
        gr[o + 1] = 0; gr[o + 2] = 0; gr[o + 3] = 0;
      }
      flush() {
        flushArr(this.xs);
        if (this.pk < 1e-30) this.pk = 0;
        for (let b = 0; b < 3; b++) if (this.bp[b] < 1e-30) this.bp[b] = 0;
        flushArr(this.bg);                                     // (the band gains' attack one-poles decay to 0 in dB: ±)
        if (this.hpOn === 1) flushArr(this.ks);
      }
    }
    // multiband static curve: GR in dB (> 0 reduction, < 0 boost ≤ 24 dB) for peak level p (linear); slopeB = the slope
    // below T − 24 dB (Phase 1: RATIO's; S2: BELOW's)
    function mbCurve(p, T, slope, slopeB) {
      if (p <= 1e-4) return 0;                                 // below −80 dBFS: unchanged
      const lv = DB * log(p);
      if (lv > T) return (lv - T) * slope;
      const Tl = T - 24;
      if (lv < Tl) { const g = -(Tl - lv) * slopeB; return g > -24 ? g : -24; }
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
        this.dz = 0; this.dzM = 0;                             // (difFlush, review #7)
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
      apply(type) {                                            // new topology, empty (no allocation)
        this.layout(type, 1); this.type = type; this.reset();
        let c = 0;                                             // (difFlush: the Plate's pre-delay 0 and diffusers 1–4, the Hall's diffusers 0–3)
        for (let e = 0; e <= 4 - type; e++) if (this.cap[e] > c) c = this.cap[e];
        this.dzM = 2 * c * this.dec;                           // (samples at fs: the Plate's half rate above 96 kHz)
      }
      sweep() { return sweepArr(this.pool); }                // (FXRack.sweep: the denormal sweep)
      alloc(type) { type = type === 0 ? 0 : 1; this.ensure(type); this.apply(type); }
      reset() {
        if (this.pool) this.pool.fill(0);
        this.wp.fill(0); this.lp.fill(0); this.hs.fill(0); this.bw = 0; this.dmL = 0; this.dmR = 0;
        this.hph = 0; this.xa = 0; this.yl = 0; this.yr = 0; this.ir = 1; this.dz = 0;
      }
      seed() {                                                 // modulation phases restart at 0 (ramps restart there)
        this.mph = 0; this.sph = 0; this.hph = 0;
        const E = 8 * this.fi / PL_FS;
        this.ex0 = 0; this.ey0 = E;
        if (this.type === 1) for (let q = 0; q < 8; q++) this.dl[q] = this.hallD(q, 0);
      }
      upd(R) {
        const ev = R.ev, fs = this.fs, size = ev[1], t = ev[2], c = ev[4], hc = ev[5];
        svfC(20 * pow(50, ev[3]), SQRT2, fs, this.hc, 0);
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
          this.decay = 0.2 + 0.78 * size; this.width = ev[6];
        } else {
          const sc = (0.4 + 1.6 * size) * fs / 48000, hi = 0.45 * fs;
          this.sc1 = sc;
          this.inf = t >= 0.999 ? 1 : 0;
          const T60 = 0.8 + 11.2 * t;
          for (let q = 0; q < 8; q++) this.g[q] = this.inf === 1 ? 1 : exp(-3 * LN10 * HL_LEN[q] * sc / (T60 * fs));
          let f = 20000 * pow(0.05, hc);
          f = f < hi ? f : hi;
          this.lpK = 1 - exp(-TAU * f / fs);
          this.srate = 0.05 + 3 * c * c; this.sdep = 12 * ev[6] * fs / 48000;
        }
      }
      hallD(q, sph) { return HL_LEN[q] * this.sc1 + this.sdep * (0.5 + 0.5 * sin(TAU * (sph + 0.125 * q))); }
      snap() {
        this.sc0 = this.sc1; this.pd0 = this.pd1;
        const E = 8 * this.fi / PL_FS;
        this.ex0 = E * sin(TAU * this.mph); this.ey0 = E * cos(TAU * this.mph);
        if (this.type === 1) for (let q = 0; q < 8; q++) this.dl[q] = this.hallD(q, this.sph);
      }
      run(R, L, Rc, o, m) {                                    // (the S1 Reverb)
        const z = silent(L, Rc, o, m);
        if (this.type === 0) this.runPlate(L, Rc, o, m); else this.runHall(L, Rc, o, m);
        this.dif(z, m);
      }
      dif(z, m) { if (this.type === 0) difFlush(this, this.pool, 1, 4, z, m); else difFlush(this, this.pool, 0, 3, z, m); }   // (review #7)
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
        eqSvf(ev[7], 0, ev[1], ev[2], ev[3], fs, c, 0);
        eqSvf(ev[8], 1, ev[4], ev[5], ev[6], fs, c, 6);
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
        const ev = R.ev, fc = ev[1], sh = (0.5 - ev[5]) * 3;
        this.setType(ev[8]);
        this.sf.set(fc * pow(2, sh), fc * pow(2, -sh), ev[2], ev[3], ev[4]);
      }
      run(R, L, Rc, o, m) {
        const fL = this.fL, fR = this.fR;
        for (let j = 0; j < m; j++) { fL[j] = L[o + j]; fR[j] = Rc[o + j]; }
        this.sf.process(fL, fR, 0, m);
        for (let j = 0; j < m; j++) { L[o + j] = fL[j]; Rc[o + j] = fR[j]; }
      }
    }

    /* ------------------------------------------------------------ S2 variants of the changed modules (SPEC-serum2 §8.2, §8.3) */
    // Parameter positions are those of fx-core FXP_TAB[type][2] (the S1 table followed by the S2 rows, §3.16.2).

    // Distortion S2: modes 0–17 through SxBase (Shaper / shapeS: modes 0–15 bit-identical to the Phase-1 copy above, 17 Soft
    // Sat.), 16 Overdrive staged by FXMods2.Overdrive at the 2× shaper rate (identity without FXMods2: the stage passes),
    // Key Track (`kt`: FREQ × the setNote key factor), the Phase-1 filter / half-band / DC-blocker / power-glide machinery
    class Dist2 extends Dist {
      constructor(fs, B, M2) {
        super(fs);
        this.S = new B.Shaper(); this.ss = B.shapeS;
        this.od = M2 && typeof M2.Overdrive === 'function' ? new M2.Overdrive(2 * fs) : null;
        this.N = 4;
      }
      reset() { super.reset(); if (this.od) this.od.reset(); }
      upd(R) {
        const ev = R.ev, fs = this.fs, mode = ev[7];
        this.mode = mode; this.filt = ev[8];
        this.S.xa = R.xsA; this.S.xb = R.xsB;
        this.S.set(mode, ev[1]);
        this.asym = mode === 0 || mode === 3 || mode === 9 || mode === 10 || mode === 12 || mode === 14 ? 1 : 0;
        this.k = 1 / ev[4];
        const c = R.cf, F = R.en[9] >= 0.5 ? ev[3] * R.keyF : ev[3];
        svfC(F, this.k, fs, c, 0);
        this.a1 = c[0]; this.a2 = c[1]; this.a3 = c[2];
        const l = ev[2];
        if (l <= 0.5) { this.wl = 1 - 2 * l; this.wb = 2 * l; this.wh = 0; } else { this.wl = 0; this.wb = 2 - 2 * l; this.wh = 2 * l - 1; }
        this.N = ev[10];
        if (this.od) this.od.set(ev[1], this.N);
      }
      run(R, L, Rc, o, m) {
        const S = this.S, ss = this.ss, od = this.od, xh = this.xh, eh = this.eh, oh = this.oh, rh = this.rh, sv = this.sv, dc = this.dc, sb = this.sb;
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
            if (need === 1) {
              let vj = vdir > 0 ? v0 + j * gst : vdir < 0 ? v0 - j * gst : v0;
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
            if (mode === 14) {
              hy = hpA * (hy + we - hx); hx = we; ly += lpK * (ss(S, hy) - ly); ve = ly;
              hy = hpA * (hy + wo - hx); hx = wo; ly += lpK * (ss(S, hy) - ly); vo = ly;
            } else if (mode === 16) {                             // Overdrive: the even 2× sample precedes the odd one
              if (od !== null) { ve = od.tick(c, we); vo = od.tick(c, wo); } else { ve = we; vo = wo; }
            } else {
              ve = ss(S, we); vo = ss(S, wo);
            }
            eh[q] = ve; eh[q + 16] = ve; oh[q] = vo; oh[q + 16] = vo;
            let y = h0 * (eh[q] + eh[q + 15]) + h1 * (eh[q + 1] + eh[q + 14]) + h2 * (eh[q + 2] + eh[q + 13])
              + h3 * (eh[q + 3] + eh[q + 12]) + h4 * (eh[q + 4] + eh[q + 11]) + h5 * (eh[q + 5] + eh[q + 10])
              + h6 * (eh[q + 6] + eh[q + 9]) + h7 * (eh[q + 7] + eh[q + 8]) + 0.5 * oh[q + 8];
            if (mode === 8) {
              acc += 1;
              if (acc >= hold) { acc -= hold; if (acc >= hold) acc = 0; hd = y; }
              y = 0.5 * hd;
            }
            if (filt === 2) {
              const v3 = y - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
              ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
              y = wl * v2 + wb * k * v1 + wh * (y - k * v1 - v2);
            }
            const yd = y - dx + dcR * dy;
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
      flush() { super.flush(); if (this.od) this.od.flush(); }
    }

    // Phaser S2: POLES P first-order allpasses per channel (1–18), corners f_j = f_sweep·2^(depth2·(2j/(P − 1) − 1)) (P = 1:
    // f_sweep), the Phase-1 zero-delay feedback solved for any P (chain = A·u + B with A = Π a_j, B_j = a_j·B_{j−1} + s_j).
    // P = 6 with DEPTH 2 at 0 over the block runs the Phase-1 arithmetic exactly (A = (a²)³, Horner B)
    const PH_MAX = 18;
    class Phaser2 {
      constructor(fs) {
        this.fs = fs; this.s = new Float64Array(2 * PH_MAX);
        this.a0 = new Float64Array(2 * PH_MAX); this.a1 = new Float64Array(2 * PH_MAX); this.da = new Float64Array(PH_MAX);
        this.ak = new Float64Array(PH_MAX);
        this.ph = 0; this.rate = 0; this.depth = 0.5; this.freq = 600; this.fb = 0; this.off = 0.5; this.P = 4; this.d2 = 0; this.d20 = 0;
      }
      reset() { this.s.fill(0); }
      upd(R) {
        const ev = R.ev, en = R.en;
        this.rate = MODFX_HZ(en[1], en[8] >= 0.5, R.bpm);
        this.depth = ev[2]; this.freq = ev[3]; this.fb = 0.95 * ev[4]; this.off = ev[5] / 360;
        let P = ev[9];
        P = P > 1 ? (P < PH_MAX ? P : PH_MAX) : 1;
        if (P > this.P) for (let c = 0; c < 2; c++) for (let j = this.P; j < P; j++) this.s[PH_MAX * c + j] = 0;
        this.P = P; this.d2 = ev[10];
      }
      // the P coefficients for LFO phase ph into a[o …]
      coefs(ph, a, o) {
        const fs = this.fs, hi = 0.45 * fs, P = this.P, d2 = this.d2;
        const f0 = this.freq * pow(2, this.depth * 4 * (0.5 - 0.5 * cos(TAU * ph)) - 2 * this.depth);
        for (let j = 0; j < P; j++) {
          let f = d2 === 0 || P === 1 ? f0 : f0 * pow(2, d2 * (2 * j / (P - 1) - 1));
          f = f > 5 ? (f < hi ? f : hi) : 5;
          const t = tan(PI * f / fs);
          a[o + j] = (t - 1) / (t + 1);
          if (d2 === 0 || P === 1) { for (let q = j + 1; q < P; q++) a[o + q] = a[o + j]; break; }
        }
      }
      snap() { this.coefs(this.ph, this.a0, 0); this.coefs(this.ph + this.off, this.a0, PH_MAX); this.d20 = this.d2; }
      seed(p) { this.ph = p; this.snap(); }
      run(R, L, Rc, o, m) {
        const p = frac(this.ph + this.rate * m / this.fs);
        this.ph = p;
        const a0 = this.a0, a1 = this.a1, s = this.s, fb = this.fb, P = this.P, da = this.da, ak = this.ak;
        this.coefs(p, a1, 0); this.coefs(p + this.off, a1, PH_MAX);
        const uni = this.d2 === 0 && this.d20 === 0;
        for (let c = 0; c < 2; c++) {
          const X = c === 0 ? L : Rc, b = PH_MAX * c;
          if (uni && P === 6) {                                    // the Phase-1 arithmetic
            const a00 = a0[b], dd = (a1[b] - a00) / m;
            let s0 = s[b], s1 = s[b + 1], s2 = s[b + 2], s3 = s[b + 3], s4 = s[b + 4], s5 = s[b + 5];
            for (let j = 0; j < m; j++) {
              const i = o + j, x = X[i], a = a00 + dd * (j + 1);
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
            continue;
          }
          for (let q = 0; q < P; q++) da[q] = (a1[b + q] - a0[b + q]) / m;
          for (let j = 0; j < m; j++) {
            const i = o + j, x = X[i];
            let A = 1, B = 0;
            for (let q = 0; q < P; q++) { const a = a0[b + q] + da[q] * (j + 1); ak[q] = a; A *= a; B = a * B + s[b + q]; }
            let u = x + fb * (A * x + B) / (1 - fb * A);
            if (u > 4 || u < -4) u = sat(u);
            for (let q = 0; q < P; q++) { const a = ak[q], t = a * u + s[b + q]; s[b + q] = u - a * t; u = t; }
            X[i] = 0.5 * (x + u);
          }
        }
        for (let q = 0; q < 2 * PH_MAX; q++) a0[q] = a1[q];
        this.d20 = this.d2;
      }
      flush() { flushArr(this.s); }
    }

    // Chorus S2: HPF (`hp`): the wet 2-pole filter is a high-pass at the LPF frequency (the Phase-1 class with its hp flag)
    class Chorus2 extends Chorus {
      upd(R) { super.upd(R); this.hp = R.en[10] >= 0.5 ? 1 : 0; }
    }

    // Delay S2: High Quality (`hq`, default on): the lines always run at the full rate (Float32, 2 s: ≤ 3.1 MB at 192 kHz);
    // off: the Phase-1 half-rate lines above 96 kHz. An hq change above 96 kHz is a topology change (ducked, lines cleared).
    // (The flag is `hqOn`: the Phase-1 class uses `hq` for its half-rate interpolator ring position.)
    class Delay2 extends Delay {
      constructor(fs) { super(fs); this.hqOn = 1; this.hqT = 1; this.topo = 0; this.mode2(1); }
      mode2(h) {
        this.hqOn = h; this.dec = this.fs > 96000 && h === 0 ? 2 : 1; this.fi = this.fs / this.dec;
        this.sl = 1 / (0.02 * this.fi); this.ist = 1 / (0.005 * this.fi);
        if (this.lL) this.cap = ceil(2 * this.fi) + 8;
      }
      alloc() {
        const n = ceil(2 * this.fs) + 8;
        this.lL = new Float32Array(n); this.lR = new Float32Array(n); this.cap = ceil(2 * this.fi) + 8;
      }
      upd(R) {
        const h = R.en[13] >= 0.5 ? 1 : 0;
        if (this.fs <= 96000) this.hqOn = h;                    // the same full-rate lines either way
        else if (h !== this.hqOn) { this.hqT = h; this.topo = 1; }
        else if (this.topo === 1) this.topo = 0;               // switched back before the pending change was applied
        super.upd(R);
      }
      applyTopo() { this.mode2(this.hqT); this.reset(); this.topo = 0; }
    }

    // Compressor S2: crossovers at X-LOW / X-HIGH (X-HIGH ≥ 1.2·X-LOW at runtime; coefficients per block), the upward
    // ratio below threshold from BELOW, band output gains (dB) after each band's gain computer; the rest is Phase 1
    // IMPL-SC §3.2: its v3 (the same kind-14 unit over the v3 rows: KEY EXT, the key HPF, LISTEN appended at 18–20) reads the
    // extra rows only when the unit has them (R.n > N_CMP2); a v3 at KEY INT renders as the v2 it was (the key branch never
    // entered). The HPF's minimum (n 0 = 20 Hz) is off; its states are cleared when it turns on (no stale state resumes)
    class Comp2 extends Comp {
      constructor(fs) {
        super(fs); this.xlo = XO1; this.xhi = XO2; this.ks = new Float64Array(4); this.kc = new Float64Array(3); this.khz = 0;
        this.ka = new Float64Array(BLK); this.kx = new Float64Array(BLK); this.ky = new Float64Array(BLK);
      }
      // IMPL-SC §3.2: the block's key — sc.kL / kR at the block's call offset sc.b (null = silence: no key, nothing to key) — through
      // the key HPF when on (a TPT SVF high-pass per channel, hp = x − √2·v1 − v2) → kx / ky (LISTEN's output) and the detector's input
      // ka = max(|kl|, |kr|). A pass of its own before Comp.run's loop (review 1 F2: that loop keeps its registers); per sample the
      // arithmetic the loop did inline, bit for bit
      keyIn(K, m) {
        const kL = K.kL, kR = K.kR, kb = K.b, ka = this.ka, kx = this.kx, ky = this.ky;
        if (this.hpOn === 1) {
          const kc = this.kc, ks = this.ks, h1 = kc[0], h2 = kc[1], h3 = kc[2];
          let s0 = ks[0], s1 = ks[1], s2 = ks[2], s3 = ks[3];
          for (let j = 0; j < m; j++) {
            let kl = 0, kr = 0;
            if (kL !== null) { kl = kL[kb + j]; kr = kR[kb + j]; }
            let v3 = kl - s1, v1 = h1 * s0 + h2 * v3, v2 = s1 + h2 * s0 + h3 * v3;
            s0 = 2 * v1 - s0; s1 = 2 * v2 - s1; kl = kl - SQRT2 * v1 - v2;
            v3 = kr - s3; v1 = h1 * s2 + h2 * v3; v2 = s3 + h2 * s2 + h3 * v3;
            s2 = 2 * v1 - s2; s3 = 2 * v2 - s3; kr = kr - SQRT2 * v1 - v2;
            kx[j] = kl; ky[j] = kr;
            const al = kl < 0 ? -kl : kl, ar = kr < 0 ? -kr : kr;
            ka[j] = al > ar ? al : ar;
          }
          ks[0] = s0; ks[1] = s1; ks[2] = s2; ks[3] = s3;
          return;
        }
        if (kL === null) { for (let j = 0; j < m; j++) { kx[j] = 0; ky[j] = 0; ka[j] = 0; } return; }
        for (let j = 0; j < m; j++) {
          const kl = kL[kb + j], kr = kR[kb + j];
          kx[j] = kl; ky[j] = kr;
          const al = kl < 0 ? -kl : kl, ar = kr < 0 ? -kr : kr;
          ka[j] = al > ar ? al : ar;
        }
      }
      upd(R) {
        super.upd(R);
        const ev = R.ev, en = R.en, fs = this.fs;
        let lo = ev[12], hi = ev[13];
        if (hi < 1.2 * lo) hi = 1.2 * lo;
        if (lo !== this.xlo) { this.xlo = lo; svfC(lo, SQRT2, fs, this.xc, 0); }
        if (hi !== this.xhi) { this.xhi = hi; svfC(hi, SQRT2, fs, this.xc, 3); }
        const rb = ev[14];
        this.slopeB = 1 - 1 / rb;
        this.bgL = exp(IDB * ev[15]); this.bgM = exp(IDB * ev[16]); this.bgH = exp(IDB * ev[17]);
        if (R.n > N_CMP2) {
          const ext = en[I_EXT] >= 0.5 ? 1 : 0, hp = ext === 1 && en[I_SCHP] > 0 ? 1 : 0;
          if (hp === 1) {
            if (this.hpOn === 0) this.ks.fill(0);
            const f = ev[I_SCHP];
            if (f !== this.khz) { this.khz = f; svfC(f, SQRT2, fs, this.kc, 0); }
          }
          this.ext = ext; this.hpOn = hp; this.lsn = ext === 1 && en[I_LSN] >= 0.5 ? 1 : 0;
        } else if (this.ext === 1) { this.ext = 0; this.hpOn = 0; this.lsn = 0; }   // (a v3 → v2 downgrade in place)
      }
    }

    // Equalizer S2: LEVEL (2n)² after the bands (ramped per block; skipped at 0 dB)
    class EQ2 extends EQ {
      constructor(fs) { super(fs); this.l0 = 1; this.l1 = 1; }
      upd(R) { super.upd(R); this.l1 = R.ev[9]; }
      snap() { this.l0 = this.l1; }
      run(R, L, Rc, o, m) {
        super.run(R, L, Rc, o, m);
        const l0 = this.l0, l1 = this.l1, dl = (l1 - l0) / m;
        this.l0 = l1;
        if (l0 === 1 && l1 === 1) return;
        for (let j = 0; j < m; j++) { const i = o + j, g = l0 + dl * (j + 1); L[i] *= g; Rc[i] *= g; }
      }
    }

    // Filter S2: types 0–107 (SerumDSP.SFilter v2), Key Track (`kt`: CUTOFF × key factor), Clean Mode (§6.13.3: input
    // × 10^(−24/20), output × 10^(24/20) around the family)
    const CL_IN = Math.pow(10, -24 / 20), CL_OUT = Math.pow(10, 24 / 20);
    class Filt2 extends Filt {
      constructor(fs) { super(fs); this.cln = 0; }
      upd(R) {
        if (!this.sf) return;
        const ev = R.ev, fc = R.en[9] >= 0.5 ? ev[1] * R.keyF : ev[1], sh = (0.5 - ev[5]) * 3;
        this.setType(ev[8]);
        this.sf.set(fc * pow(2, sh), fc * pow(2, -sh), ev[2], ev[3], ev[4]);
        this.cln = R.en[10] >= 0.5 ? 1 : 0;
      }
      run(R, L, Rc, o, m) {
        const fL = this.fL, fR = this.fR;
        if (this.cln === 1) {
          for (let j = 0; j < m; j++) { fL[j] = L[o + j] * CL_IN; fR[j] = Rc[o + j] * CL_IN; }
          this.sf.process(fL, fR, 0, m);
          for (let j = 0; j < m; j++) { L[o + j] = fL[j] * CL_OUT; Rc[o + j] = fR[j] * CL_OUT; }
          return;
        }
        for (let j = 0; j < m; j++) { fL[j] = L[o + j]; fR[j] = Rc[o + j]; }
        this.sf.process(fL, fR, 0, m);
        for (let j = 0; j < m; j++) { L[o + j] = fL[j]; Rc[o + j] = fR[j]; }
      }
    }

    // Reverb S2 (§8.3): one unit for the five types. Common stages: pre-delay (mono, 2.5 s, half rate above 96 kHz, slewed),
    // output HP 20·50^locut Hz (Plate / Hall: the Phase-1 output HP of their engine) and LP 20000·0.05^hicut Hz (2-pole
    // TPT, every type). Plate / Hall run the Phase-1 Reverb engine with the S2 parameter mapping (Plate: input bandwidth
    // 0.9995, lengths × (0.2 + 1.3·size) (IMPL: the diffusers' ringing stays below the 0.2 s of SIZE 0; the Phase-1
    // 0.5 + size gives 0.3 s), tank decay from the RT60(size) law over the Dattorro loop (measured T30 within ±11 % of
    // the law for every size), wet × 2; Hall: T60 = 0.8 + 11.2·decay, SPIN rate
    // 0.05 + 3·spinr², depth 12·spind samples at 48 kHz, lengths × (0.4 + 1.6·size), in-loop LP at HIGH CUT as Phase 1);
    // Vintage / Nitrous / Basin are FXMods2 tanks. All types share one Float32 pool (only one type runs; a type change is
    // a topology change: ducked, the new type starts empty). The pool covers the installed type, or every type when the
    // type parameter is modulated (FXP filTypeAll); a modulated type that reaches a type without pool keeps the current one
    const PL_LOOP = 672 + 4453 + 1800 + 3720 + 908 + 4217 + 2656 + 3163;   // Dattorro loop length (samples at PL_FS)
    const RV_PRE = 2.5;
    let warnedRev = false;
    class Rev2 {
      constructor(fs, M2) {
        this.fs = fs; this.rv = new Reverb(fs);
        this.tk = [null, null, null, null, null];
        if (M2) {
          if (typeof M2.RevVintage === 'function') this.tk[2] = new M2.RevVintage(fs);
          if (typeof M2.RevNitrous === 'function') { this.tk[3] = new M2.RevNitrous(fs); this.tk[3].auto = 0; }
          if (typeof M2.RevBasin === 'function') this.tk[4] = new M2.RevBasin(fs);
        }
        this.nd = new Float64Array(5);
        this.nd[0] = this.rv.layout(0, 0); this.nd[1] = this.rv.layout(1, 0);
        for (let t = 2; t < 5; t++) this.nd[t] = this.tk[t] ? this.tk[t].need() : Infinity;
        this.pool = null; this.type = -1; this.want = 0; this.topo = 0;
        this.nw = 0;                                           // Nitrous MODE the controls select (installed with the tank)
        this.pdec = fs > 96000 ? 2 : 1; this.pfl = fs / this.pdec;
        this.pl = null; this.pcap = 0; this.pw = 0; this.pc = 0; this.pa = 0;
        this.pd = 0; this.pt = 0; this.psl = 1 / (0.02 * fs);
        this.hc = new Float64Array(3); this.lc = new Float64Array(3); this.hs = new Float64Array(4); this.ls = new Float64Array(4);
        svfC(20, SQRT2, fs, this.hc, 0); svfC(20000, SQRT2, fs, this.lc, 0);
        this.wet = 2; this.ir = 1; this.ist = 1 / (0.005 * fs);
      }
      // floats the pool needs for the types in `mask` (and the installed one)
      poolNeed(mask) {
        let need = this.type >= 0 ? this.nd[this.type] : 0;
        for (let t = 0; t < 5; t++) if ((mask >> t) & 1 && this.nd[t] !== Infinity && this.nd[t] > need) need = this.nd[t];
        return need;
      }
      // bytes prep(mask) would add (the rack checks them against the per-track cap before it grows the pool)
      prepNeed(mask) { const need = this.poolNeed(mask), have = this.pool ? this.pool.length : 0; return need > have ? 4 * (need - have) : 0; }
      // the pool covers the types in `mask` (and the installed one); grows only, the running content is kept
      prep(mask) {
        const need = this.poolNeed(mask);
        if (this.pool && this.pool.length >= need) return;
        const p = new Float32Array(need);
        if (this.pool) p.set(this.pool);
        this.pool = p; this.rv.pool = p;
        if (this.type >= 2) this.tk[this.type].buf = p;
      }
      ok(t) { return t >= 0 && t < 5 && this.nd[t] !== Infinity && this.pool !== null && this.pool.length >= this.nd[t]; }
      alloc(type) {
        this.pcap = ceil(RV_PRE * this.pfl) + 8; this.pl = new Float32Array(this.pcap);
        this.prep(1 << type);
        this.want = type; this.applyTopo();
      }
      install(t) {
        if (t <= 1) { this.rv.pool = this.pool; this.rv.apply(t); } else { if (t === 3) this.tk[3].nmode = this.nw; this.tk[t].bind(this.pool); }
        this.type = t;
      }
      applyTopo() { if (this.ok(this.want)) this.install(this.want); this.topo = 0; this.hs.fill(0); this.ls.fill(0); }
      reset() {
        if (this.pl) this.pl.fill(0);
        this.pw = 0; this.pc = 0; this.pa = 0; this.pd = this.pt; this.hs.fill(0); this.ls.fill(0); this.ir = 1;
        const t = this.type;
        if (t >= 0) { if (t <= 1) this.rv.reset(); else this.tk[t].reset(); }
      }
      seed() { this.rv.seed(); for (let t = 2; t < 5; t++) if (this.tk[t]) this.tk[t].seed(0); }
      // (FXRack.sweep: the installed type's region of the pool, [0, nd[type]) — a Vintage / Nitrous / Basin tank resets only that
      // part, so a TYPE switched mid-tail leaves the old type's data beyond it, never read, which kept the sweep going for ever;
      // the pre-delay line is a copy of the input)
      sweep() { return this.type < 0 ? 0 : sweepArr(this.pool, this.nd[this.type]); }
      upd(R) {
        const ev = R.ev, fs = this.fs;
        let t = ev[1], nm = ev[20];
        t = t > 0 ? (t < 4 ? t : 4) : 0;
        this.nw = nm > 0 ? (nm < 4 ? round(nm) : 4) : 0;
        // a topology change (another TYPE; Nitrous: another MODE — its eight lines would sweep thousands of samples
        // within one block) is requested here and applied ducked by the rack; back at the running topology before the
        // duck's bottom, the request is withdrawn (else the stale `want` would be installed and nothing re-requests)
        if (t !== this.type) {
          if (this.ok(t)) { this.want = t; this.topo = 1; } else if (!warnedRev) { warnedRev = true; if (typeof console !== 'undefined') console.warn('fx-dsp: S2 reverb type', t, 'not prepared; the current type keeps running'); }
        } else if (t === 3 && this.tk[3] !== null && this.nw !== this.tk[3].nmode) { this.want = 3; this.topo = 1; }
        else if (this.topo === 1) { this.topo = 0; this.want = t; }
        this.pt = dlyTimeS(ev[3], ev[4], ev[5], R.bpm, RV_PRE) * fs;
        const hpF = 20 * pow(50, ev[6]);
        svfC(hpF, SQRT2, fs, this.hc, 0);
        svfC(20000 * pow(0.05, ev[7]), SQRT2, fs, this.lc, 0);
        const V = this.rv, size = ev[2];
        if (this.type === 0) {
          const fi = V.fi, hi = 0.45 * fi;
          V.sc1 = (0.2 + 1.3 * size) * fi / PL_FS; V.pd1 = 1; V.bwK = 0.9995;
          let f = 20000 * pow(0.03, ev[8]);
          f = f < hi ? f : hi;
          V.dmK = 1 - exp(-TAU * f / fi);
          const rt = size < 0.1 ? 0.2 + 2 * size : 0.4 * pow(30, (size - 0.1) / 0.55 < 1 ? (size - 0.1) / 0.55 : 1);
          V.decay = pow(10, -3 * PL_LOOP * (0.2 + 1.3 * size) / (PL_FS * 4 * rt));
          V.width = ev[9];
          svfC(hpF, SQRT2, fs, V.hc, 0);
          this.wet = 2;
        } else if (this.type === 1) {
          const decay = ev[10], sc = (0.4 + 1.6 * size) * fs / 48000, hi = 0.45 * fs;
          V.sc1 = sc;
          V.inf = decay >= 0.999 ? 1 : 0;
          const T60 = 0.8 + 11.2 * decay;
          for (let q = 0; q < 8; q++) V.g[q] = V.inf === 1 ? 1 : exp(-3 * LN10 * HL_LEN[q] * sc / (T60 * fs));
          let f = 20000 * pow(0.05, ev[7]);
          f = f < hi ? f : hi;
          V.lpK = 1 - exp(-TAU * f / fs);
          const sr = ev[11];
          V.srate = 0.05 + 3 * sr * sr; V.sdep = 12 * ev[12] * fs / 48000;
          svfC(hpF, SQRT2, fs, V.hc, 0);
          this.wet = 1;
        } else if (this.type >= 2) { this.tk[this.type].upd(R); this.wet = 1; }
      }
      snap() {
        this.pd = this.pt;
        if (this.type >= 0 && this.type <= 1) this.rv.snap(); else if (this.type >= 2) this.tk[this.type].snap();
      }
      run(R, L, Rc, o, m) {
        const t = this.type;
        if (t < 0) { for (let j = 0; j < m; j++) { L[o + j] = 0; Rc[o + j] = 0; } return; }
        // pre-delay (mono)
        const pl = this.pl, pcap = this.pcap, dec = this.pdec, pt = this.pt, psl = this.psl, ist = this.ist;
        let pd = this.pd, pw = this.pw, pc = this.pc, pa = this.pa, ir = this.ir;
        for (let j = 0; j < m; j++) {
          const i = o + j;
          if (ir < 1) { ir += ist; if (ir > 1) ir = 1; }
          const x = 0.5 * (L[i] + Rc[i]) * ir;
          if (pd !== pt) {
            let st = (pt - pd) * psl;
            st = st > 1 ? 1 : st < -1 ? -1 : st;
            pd += st;
            if (pt - pd < 1e-6 && pd - pt < 1e-6) pd = pt;
          }
          let y = x;
          if (dec === 1) {
            pl[pw] = x;
            if (pd > 0) y = rdE(pl, 0, pcap, pw, pd);
            pw = pw + 1 === pcap ? 0 : pw + 1;
          } else {
            if (pd > 0) { const de = pd < 4 ? 4 : pd; y = rdE(pl, 0, pcap, pw, (de + 0.5 - pc) * 0.5); }
            pa += x;
            if (++pc === 2) { pl[pw] = 0.5 * pa; pw = pw + 1 === pcap ? 0 : pw + 1; pc = 0; pa = 0; }
          }
          L[i] = y; Rc[i] = y;
        }
        this.pd = pd; this.pw = pw; this.pc = pc; this.pa = pa; this.ir = ir;
        // the tank (Plate / Hall include the output HP); its input diffusers flushed after a silent input (review #7)
        const z = silent(L, Rc, o, m);
        if (t === 0) { this.rv.runPlate(L, Rc, o, m); this.rv.dif(z, m); }
        else if (t === 1) { this.rv.runHall(L, Rc, o, m); this.rv.dif(z, m); }
        else {
          this.tk[t].run(R, L, Rc, o, m); this.tk[t].dif(z, m);
          const hc = this.hc, a1 = hc[0], a2 = hc[1], a3 = hc[2], h = this.hs;
          for (let j = 0; j < m; j++) {
            const i = o + j;
            let lp = svfT(h, 0, L[i], a1, a2, a3);
            L[i] = L[i] - SQRT2 * SVO.bp - lp;
            lp = svfT(h, 2, Rc[i], a1, a2, a3);
            Rc[i] = Rc[i] - SQRT2 * SVO.bp - lp;
          }
        }
        // output LP (+ the Plate's +6 dB)
        const lc = this.lc, b1 = lc[0], b2 = lc[1], b3 = lc[2], s = this.ls, w = this.wet;
        for (let j = 0; j < m; j++) { const i = o + j; L[i] = w * svfT(s, 0, L[i], b1, b2, b3); Rc[i] = w * svfT(s, 2, Rc[i], b1, b2, b3); }
      }
      flush() {
        flushArr(this.hs); flushArr(this.ls);
        if (this.type >= 0 && this.type <= 1) this.rv.flush(); else if (this.type >= 2) this.tk[this.type].flush();
      }
      tail() { return this.pt; }
    }

    // Splitter unit (§8.4): the band builder (FXMods2 XoverLH / XoverLMH / MS), the band buffers and the splitter's own
    // input copy (the rack's block scratch is reused by the branch instances); LEVEL ramped per block on the branch sum.
    // Branch bypass crossfades over 5 ms (bx: 0 the branch runs … 1 its band passes; kL / kR: the band during a fade).
    // Latency alignment (IMPL): a branch holding latency (Distortion's 15 samples while it runs, a Limit-mode
    // compressor's look-ahead) would shift its band against the others and break the allpass sum, so every band is
    // delayed to the branch with the most latency (lines cl, allocated in set() once a branch can hold latency; the
    // delays glide at the Distortion enable-glide rate, so they follow its 0 ↔ 15-sample glide)
    class SplitMod {
      constructor(fs, t, M2) {
        this.fs = fs; this.t = t; this.nb = t === 14 ? 3 : 2;
        this.xo = t === 13 ? new M2.XoverLH(fs) : t === 14 ? new M2.XoverLMH(fs) : new M2.MS(fs);
        this.bL = [new Float64Array(BLK), new Float64Array(BLK), new Float64Array(BLK)];
        this.bR = [new Float64Array(BLK), new Float64Array(BLK), new Float64Array(BLK)];
        this.iL = new Float64Array(BLK); this.iR = new Float64Array(BLK);
        this.l0 = 1; this.l1 = 1;
        this.bx = new Float64Array(3);
        this.kL = [new Float64Array(BLK), new Float64Array(BLK), new Float64Array(BLK)];
        this.kR = [new Float64Array(BLK), new Float64Array(BLK), new Float64Array(BLK)];
        this.cl = null; this.lcap = 0; this.lw = 0;
        this.lt = new Float64Array(3); this.dd = new Float64Array(3); this.dt = new Float64Array(3);
        this.gr = DIST_LAT / (0.005 * fs);
      }
      // alignment lines for latency differences up to n samples (set-time, grow only); bytes they would add
      linesNeed(n) { return n > this.lcap ? 48 * (n - this.lcap) + (this.cl === null ? 192 : 0) : 0; }
      lines(n) {
        if (n <= this.lcap) return;
        this.cl = new Float64Array(6 * (n + 4)); this.lcap = n; this.lw = 0; this.dd.fill(0);
      }
      reset() { this.xo.reset(); if (this.cl !== null) this.cl.fill(0); this.dd.fill(0); this.lw = 0; }
      upd(R) {
        const ev = R.ev;
        if (this.t === 13) this.xo.set(ev[1]); else if (this.t === 14) this.xo.set(ev[1], ev[2]);
        this.l1 = ev[R.n - 1];
      }
      snap() { this.l0 = this.l1; }
      flush() { this.xo.flush(); }
    }

    /* ------------------------------------------------------------ FX v2 instance graph (SPEC-serum2 §4.2, §4.3, §8.1) */
    // FXTYPES of fx-core (§3.16.1) in S2 type-id order (FXP iType) and the v1 module (MOD_IDS index) of each type that has
    // an S1 variant (−1: none)
    const TYPES = Object.freeze(['dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil', 'hyper', 'bode', 'conv', 'util',
      'split2', 'split3', 'splitms', 'duck']);
    const NTYPES = TYPES.length;
    const T_ = TYPES.reduce((o, t, i) => { o[t] = i; return o; }, {});
    const MOD_OF_TYPE = Int8Array.from(TYPES, (t) => MOD_IDS.indexOf(t));
    // S1 parameter tables (fx-core FXP_TAB[type][1]): S1K[m][p] = v1 fx idx of parameter p of module m (the Phase-1 rows of
    // the module in fx idx order; Hyper owns the Dimension rows). Laws, ranges and continuity come from that v1 row, so an
    // S1 instance evaluates exactly the Phase-1 values. LOC[k] = position of v1 fx idx k in its table.
    const S1K = [], LOC = new Int16Array(NF).fill(-1);
    for (let m = 0; m < NMOD; m++) {
      const a = [];
      for (let k = 0; k < NF; k++) if (MOD_OF[k] === m) { LOC[k] = a.length; a.push(k); }
      S1K.push(Int16Array.from(a));
    }
    const S1_IDX = Object.freeze(TYPES.reduce((o, t, i) => {
      if (MOD_OF_TYPE[i] >= 0) o[t] = Object.freeze(Array.from(S1K[MOD_OF_TYPE[i]]));
      return o;
    }, {}));
    // Parameter tables of every (type, variant) as rows [pid, law code, lo, hi, def] (§3.16.2, embedded identically with
    // fx-core FXP_TAB; tests/fx-dsp.test.mjs compares them): ROWS[type][v]. S1 rows come from the v1 FX rows above.
    const RENAME_DIM = { 'fx.dim.size': 'dsize', 'fx.dim.mix': 'dmix', 'fx.dim.level': 'dlevel' };
    const pidOf = (id) => (RENAME_DIM[id] !== undefined ? RENAME_DIM[id] : id.slice(id.lastIndexOf('.') + 1));
    const s1Rows = (m) => Array.from(S1K[m], (k) => [pidOf(FX_IDS[k]), FX_LAW[k], FX_LO[k], FX_HI[k], FX_DEF[k]]);
    const R2 = (pid, law, lo, hi, def) => [pid, law, lo, hi, def];
    const ON2 = () => R2('on', BOOL, 0, 1, 1), LVL2 = () => R2('level', POW2, 0, 4, 0.5), MIX2 = (d) => R2('mix', LIN, 0, 1, d);
    const PCT2 = (p, d) => R2(p, LIN, 0, 1, d), BOOL2 = (p, d) => R2(p, BOOL, 0, 1, d), LAD2 = (p) => R2(p, ENUM, 0, 11, 7 / 11);
    function s2Of(m, swap, extra) {
      return s1Rows(m).map((r) => (r[0] === 'on' ? [r[0], r[1], r[2], r[3], 1] : swap[r[0]] !== undefined ? swap[r[0]] : r)).concat(extra);
    }
    const ROWS = TYPES.map(() => [null, null, null, null]);
    for (let t = 0; t < NTYPES; t++) if (MOD_OF_TYPE[t] >= 0) ROWS[t][1] = s1Rows(MOD_OF_TYPE[t]);
    ROWS[T_.dist][2] = s2Of(1, { mode: R2('mode', ENUM, 0, 17, 0) }, [BOOL2('kt', 0), R2('stages', INT, 1, 16, 3 / 15)]);
    ROWS[T_.phs][2] = s2Of(3, {}, [R2('poles', INT, 1, 18, 3 / 17), PCT2('depth2', 0)]);
    ROWS[T_.cho][2] = s2Of(4, {}, [BOOL2('hp', 0)]);
    ROWS[T_.dly][2] = s2Of(5, {}, [BOOL2('hq', 1)]);
    ROWS[T_.cmp][2] = s2Of(6, {}, [R2('xlo', EXP, 20, 1000, 0.4751), R2('xhi', EXP, 500, 16000, 0.4644), R2('below', RATIO, 1, 32, 0),
      R2('gL', LIN, -24, 24, 0.5), R2('gM', LIN, -24, 24, 0.5), R2('gH', LIN, -24, 24, 0.5)]);
    // (IMPL-SC §3) the Compressor's v3 = v2 + its sidechain key rows (KEY INT / EXT, the key's HPF — n 0 = off —, LISTEN)
    ROWS[T_.cmp][3] = ROWS[T_.cmp][2].concat([BOOL2('ext', 0), R2('schp', EXP, 20, 2000, 0), BOOL2('listen', 0)]);
    const N_CMP2 = ROWS[T_.cmp][2].length, I_EXT = N_CMP2, I_SCHP = N_CMP2 + 1, I_LSN = N_CMP2 + 2;   // (Comp2.upd: the v3 rows' positions)
    ROWS[T_.rev][2] = [ON2(), R2('type', ENUM, 0, 4, 0), PCT2('size', 0.5), R2('pre', POW3, 0, 2500, 0), BOOL2('prebpm', 0),
      LAD2('prelad'), PCT2('locut', 0), PCT2('hicut', 0.3), PCT2('damp', 0.5), PCT2('width', 1), PCT2('decay', 0.3),
      PCT2('spinr', 0.25), PCT2('spind', 0.2), PCT2('ersize', 0.5), PCT2('diffa', 0.7), PCT2('diffb', 0.5), PCT2('chr', 0.2),
      PCT2('chd', 0.2), PCT2('feed', 0.6), PCT2('diff', 0.7), R2('nmode', ENUM, 0, 4, 0), MIX2(0.3), LVL2()];
    ROWS[T_.eq][2] = s2Of(8, {}, [LVL2()]);
    ROWS[T_.fil][2] = s2Of(9, { type: R2('type', ENUM, 0, 107, 0) }, [BOOL2('kt', 0), BOOL2('clean', 0)]);
    ROWS[T_.bode][2] = [ON2(), BOOL2('mono', 0), R2('shift', LIN, -1, 1, 0.5), R2('range', EXP, 0.1, 5000, 0.6384),
      R2('dir', LIN, -1, 1, 1), PCT2('width', 1), R2('delay', POW2, 0, 2000, 0), BOOL2('bpm', 0), LAD2('dlad'), PCT2('feed', 0),
      R2('bal', LIN, -1, 1, 0.5), PCT2('blur', 0), BOOL2('retrig', 0), MIX2(1), LVL2()];
    ROWS[T_.conv][2] = [ON2(), R2('size', EXP, 0.1, 10, 0.5), R2('tone', LIN, -1, 1, 0.5), BOOL2('minph', 0), R2('pre', POW2, 0, 1000, 0),
      BOOL2('prebpm', 0), LAD2('prelad'), PCT2('att', 0), PCT2('dec', 1), PCT2('damp', 0), R2('irgain', LIN, -48, 12, 0.5), MIX2(0.5), LVL2()];
    ROWS[T_.util][2] = [ON2(), BOOL2('invL', 0), BOOL2('invR', 0), R2('lpf', EXP, 50, 20000, 1), R2('hpf', EXP, 1, 400, 0),
      BOOL2('mbass', 0), R2('mfreq', EXP, 20, 400, 0.5021), R2('width', LIN, 0, 8, 0.125), R2('pan', LIN, -1, 1, 0.5), MIX2(1), LVL2()];
    ROWS[T_.split2][2] = [ON2(), R2('freq', EXP, 30, 5800, 0.4374), LVL2()];
    ROWS[T_.split3][2] = [ON2(), R2('freq1', EXP, 30, 5800, 0.3604), R2('freq2', EXP, 30, 5800, 0.7978), LVL2()];
    ROWS[T_.splitms][2] = [ON2(), LVL2()];
    // (IMPL-SC §4.1) the Ducker: DEPTH (its mix), LENGTH ms / synced (1/8), ATTACK, SMOOTH, the NOTE filter (0 Any), LEVEL
    ROWS[T_.duck][2] = [ON2(), PCT2('depth', 1), R2('len', POW2, 10, 4000, 0.2453), BOOL2('bpm', 1), R2('lad', ENUM, 0, 11, 6 / 11),
      R2('att', LIN, 0, 50, 0.02), R2('smooth', LIN, 0, 20, 0.1), R2('note', ENUM, 0, 128, 0), LVL2()];
    const LAW_NAMES = ['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio'];
    // exported view: TAB[type id][v] = frozen [{pid, law (laws.js name), lo, hi, def}]
    const TAB = Object.freeze(TYPES.reduce((o, t, i) => {
      const e = {};
      for (const v of [1, 2, 3]) {
        if (ROWS[i][v]) e[v] = Object.freeze(ROWS[i][v].map((r) => Object.freeze({ pid: r[0], law: LAW_NAMES[r[1]], lo: r[2], hi: r[3], def: r[4] })));
      }
      o[t] = Object.freeze(e);
      return o;
    }, {}));
    // mix kind by type: 0 the module produces its final output (EQ, Hyper additive, splitters, the Ducker), 1 sin² law, 2 linear
    const MIXK_T = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 0, 2, 0, 1, 1, 2, 0, 0, 0, 0]);
    // FX-context globals (§4.2): [0] g.master (pow3, the v1 row 0) · [1] g.bypass (bool, v1 row 86) · [2] g.direct ·
    // [3] g.bus1v · [4] g.bus2v (pow2 0–4, n 0.5 = 0 dB); [5…7] unused
    const NG = 5, G_CONT = Uint8Array.from([1, 0, 1, 1, 1]), G_DEF = Float64Array.from([1, 0, 0.5, 0.5, 0.5]);
    function lawG(g, n) { return g === 0 ? lawV(0, n) : g === 1 ? lawV(86, n) : 0 + 4 * n * n; }
    const MAXI = 48;                                           // instances per track (phases(), gr() slots)
    const TAP_N = 1024;                                        // monitor tap length (setTap / tapOut; a power of two)
    const CAP_BYTES = 32 * 1024 * 1024;                        // §8.5 per-track FX memory cap (Convolve spectra excluded)
    // module kinds (Unit.k): 0–9 the S1 variants (= the v1 module index), 10 Distortion S2, 11 Phaser S2, 12 Chorus S2,
    // 13 Delay S2, 14 Compressor S2 (and its v3, the sidechain key: IMPL-SC §3), 15 Reverb S2, 16 EQ S2, 17 Filter S2, 18 Bode,
    // 19 Convolve, 20 Utility, 21 splitters, 22 the Ducker (FXMods2.Duck, IMPL-SC §4)
    const K_S2 = { dist: 10, phs: 11, cho: 12, dly: 13, cmp: 14, rev: 15, eq: 16, fil: 17, bode: 18, conv: 19, util: 20, split2: 21,
      split3: 21, splitms: 21, duck: 22 };
    const K2 = Int8Array.from(TYPES, (t) => (K_S2[t] === undefined ? -1 : K_S2[t]));
    const POS_RETRIG_BODE = ROWS[T_.bode][2].findIndex((r) => r[0] === 'retrig');

    // One FX instance: its parameter state (base smoothing, offsets, eff n / values of its table, §5.4 Phase 1), its
    // module object and its enable / mix state. Modules read their parameters through it (`R.ev[p]`, `R.en[p]` in table
    // order, `R.xsA`, `R.bpm`, `R.keyF`, `R.choMono`, `R.irId`, `R.convMax`) and the rack's block scratch through the same
    // fields as on the Phase-1 rack. Laws per parameter (law, lo, hi, cont): S1 instances take them from the v1 rows, so
    // they evaluate exactly the Phase-1 values.
    class Unit {
      constructor(R, id, t, v, k, rows) {
        const n = rows.length;
        this.id = id; this.t = t; this.v = v; this.k = k; this.n = n;
        this.law = Uint8Array.from(rows, (r) => r[1]); this.lo = Float64Array.from(rows, (r) => r[2]);
        this.hi = Float64Array.from(rows, (r) => r[3]); this.cont = Uint8Array.from(rows, (r) => isCont(r[1]));
        this.tgt = new Float64Array(n); this.bs = new Float64Array(n); this.md = new Float64Array(n); this.mdT = new Float64Array(n);
        this.eS = new Float64Array(n); this.eD = new Float64Array(n); this.en = new Float64Array(n); this.ev = new Float64Array(n);
        for (let p = 0; p < n; p++) this.tgt[p] = rows[p][4];
        if (n > 0) this.tgt[0] = 0;
        this.mk = MIXK_T[t]; this.mi = rows.findIndex((r) => r[0] === 'mix'); this.li = rows.findIndex((r) => r[0] === 'level');
        this.mod = null;
        // graph: FXP index (−1: removed, fading out), rack, parameter offset; keep / gone: set() bookkeeping
        this.idx = -1; this.rack = 0; this.off = 0; this.keep = 0; this.gone = 0;
        // st: 0 off, 1 on (fading in while xf < 1), 2 fading out, 3 ducking for the actions in pend (1 re-seed, 2 topology)
        this.st = 0; this.xf = 0; this.pend = 0; this.dirty = 1; this.has = 0; this.byp = 0; this.mv = 0;
        this.gD0 = 0; this.gW0 = 0; this.gD1 = 0; this.gW1 = 0;
        this.seedPh = 0; this.revType = 1; this.choMono = 0; this.bpm = R.bpm; this.keyF = R.keyF;
        this.irId = ''; this.convMax = 10;                     // Convolve: shaped-IR entry id (FXP iIr), tail cap (FXP convMax)
        this.br = null; this.bb = null;                        // splitters: branch chains, branch bypasses
        this.mem = 0; this.over = 0;                           // bytes of the module's buffers; left unallocated by the cap
        this.need = 0;                                         // bytes measured when the cap refused it (no retry without room)
        this.xsA = null; this.xsB = null;
        if (k === 1 || k === 10) { this.xsA = new Float32Array(NXS); this.xsB = new Float32Array(NXS); this.xsA.set(LINXS); this.xsB.set(LINXS); }
        this.cf = R.cf; this.dyL = R.dyL; this.dyR = R.dyR; this.dvL = R.dvL; this.dvR = R.dvR; this.wL = R.wL; this.wR = R.wR;
        this.sc = R.sc; this.src = '';                         // IMPL-SC §1.2 / §5.2: the rack's sidechain context (by reference), the source track id (FXP iSrc)
      }
    }
    // IMPL-SC §3.1: a unit whose variant changed while its kind and type did not (the Compressor's v2 → v3: its key rows appended)
    // grows in place — the per-row arrays re-made at the new length, the shared rows' state copied (the same pids, the same laws),
    // the new rows at their defaults; the module and the enable state (st, xf, the mix gains) are kept: no reset, no fade
    function growUnit(u, v, rows) {
      const n = rows.length, m = u.n < n ? u.n : n;
      const cp = (a, b) => { for (let p = 0; p < m; p++) b[p] = a[p]; return b; };
      u.law = Uint8Array.from(rows, (r) => r[1]); u.lo = Float64Array.from(rows, (r) => r[2]);
      u.hi = Float64Array.from(rows, (r) => r[3]); u.cont = Uint8Array.from(rows, (r) => isCont(r[1]));
      u.tgt = cp(u.tgt, new Float64Array(n)); u.bs = cp(u.bs, new Float64Array(n)); u.md = cp(u.md, new Float64Array(n)); u.mdT = cp(u.mdT, new Float64Array(n));
      u.eS = cp(u.eS, new Float64Array(n)); u.eD = cp(u.eD, new Float64Array(n)); u.en = cp(u.en, new Float64Array(n)); u.ev = cp(u.ev, new Float64Array(n));
      for (let p = m; p < n; p++) { const d = rows[p][4]; u.tgt[p] = d; u.bs[p] = d; u.en[p] = d; u.ev[p] = lawU(u.law[p], u.lo[p], u.hi[p], d); }
      u.v = v; u.n = n; u.mi = rows.findIndex((r) => r[0] === 'mix'); u.li = rows.findIndex((r) => r[0] === 'level'); u.dirty = 1;
      return m;
    }
    // bytes of the typed arrays reachable from a module (set() only): modules with bytes() report themselves
    function modBytes(x, seen, depth) {
      if (!x || typeof x !== 'object' || depth > 4) return 0;
      if (ArrayBuffer.isView(x)) { if (seen.has(x.buffer)) return 0; seen.add(x.buffer); return x.buffer.byteLength; }
      if (seen.has(x)) return 0;
      seen.add(x);
      if (typeof x.bytes === 'function') return x.bytes();
      let n = 0;
      const ks = Object.keys(x);
      for (let i = 0; i < ks.length; i++) n += modBytes(x[ks[i]], seen, depth + 1);
      return n;
    }

    // FXP v2 of the ten S1 modules in v1 module order (warm-up): W_OFF[m] = parameter offset of module m, AT[k] = FX-context
    // index of v1 fx idx k
    const W_OFF = new Int32Array(NMOD), AT = new Int32Array(NF);
    let W_NP = 0;
    for (let m = 0; m < NMOD; m++) { W_OFF[m] = W_NP; W_NP += S1K[m].length; }
    for (let k = 0; k < NF; k++) AT[k] = k === 0 ? 0 : k === 86 ? 1 : 8 + W_OFF[MOD_OF[k]] + LOC[k];
    function s1Fxp() {
      const NFX = 8 + W_NP, base = new Float64Array(NFX), nI = NMOD;
      base[0] = 1; base[2] = 0.5; base[3] = 0.5; base[4] = 0.5;
      for (let k = 1; k < NF; k++) if (k !== 86) base[AT[k]] = FX_DEF[k];
      return {
        ver: VER, NFX, NP: W_NP, key: '', base, nI,
        iType: Uint8Array.from(MOD_IDS, (m) => TYPES.indexOf(m)), iVar: new Uint8Array(nI).fill(1), iRack: new Uint8Array(nI),
        iBr: new Uint8Array(nI), iN: Uint8Array.from(S1K, (a) => a.length), iByp: new Uint8Array(nI), iAlloc: new Uint8Array(nI).fill(1),
        iPar: new Int16Array(nI).fill(-1), iOff: Int32Array.from(W_OFF), iBB: new Uint8Array(3 * nI), iPh: new Float64Array(nI),
        iId: MOD_IDS.slice(), iRev: new Uint8Array(nI).fill(1), iCho: new Uint8Array(nI), iIr: MOD_IDS.map(() => ''),
        rByp: new Uint8Array(3), rRoute: new Uint8Array(3), needs: [], filTypeAll: new Uint8Array(nI),
        seed: 0, any: 1, bpm: 120, smooth: 1, silence: 1, convMax: 10, xsKey: '',
      };
    }
    // FXP v2 with one instance of every S2-variant type except Convolve (warm-up): [type, parent, branch] in processing
    // order; returns the FXP and the parameter offset of every instance
    const W2 = [['dist', -1, 0], ['phs', -1, 0], ['cho', -1, 0], ['dly', -1, 0], ['cmp', -1, 0], ['rev', -1, 0], ['eq', -1, 0],
      ['fil', -1, 0], ['bode', -1, 0], ['util', -1, 0], ['split2', -1, 0], ['util', 10, 0], ['eq', 10, 1], ['split3', -1, 0],
      ['splitms', -1, 0]];
    function s2Fxp() {
      const nI = W2.length, off = new Int32Array(nI);
      let NP = 0;
      for (let i = 0; i < nI; i++) { off[i] = NP; NP += ROWS[T_[W2[i][0]]][2].length; }
      const base = new Float64Array(8 + NP);
      base[0] = 1; base[2] = 0.5; base[3] = 0.5; base[4] = 0.5;
      for (let i = 0; i < nI; i++) { const rows = ROWS[T_[W2[i][0]]][2]; for (let p = 0; p < rows.length; p++) base[8 + off[i] + p] = rows[p][4]; }
      return {
        fxp: {
          ver: VER, NFX: 8 + NP, NP, key: 'w2', base, nI,
          iType: Uint8Array.from(W2, (w) => T_[w[0]]), iVar: new Uint8Array(nI).fill(2), iRack: new Uint8Array(nI),
          iBr: Uint8Array.from(W2, (w) => w[2]), iN: Uint8Array.from(W2, (w) => ROWS[T_[w[0]]][2].length), iByp: new Uint8Array(nI),
          iAlloc: new Uint8Array(nI).fill(1), iPar: Int16Array.from(W2, (w) => w[1]), iOff: off, iBB: new Uint8Array(3 * nI),
          iPh: new Float64Array(nI), iId: W2.map((w, i) => 'w' + i), iRev: new Uint8Array(nI), iCho: new Uint8Array(nI),
          iIr: W2.map(() => ''), rByp: new Uint8Array(3), rRoute: new Uint8Array(3), needs: [],
          filTypeAll: Uint8Array.from(W2, (w) => (w[0] === 'rev' ? 1 : 0)),
          seed: 0, any: 1, bpm: 120, smooth: 1, silence: 1, convMax: 10, xsKey: '',
        },
        off,
      };
    }

    // FXP v2 of a Ducker and a v3 Compressor, both keyed from one source (IMPL-SC G7: the warm-up of the sidechain paths)
    function scFxp() {
      const W = [['duck', 2], ['cmp', 3]], nI = W.length, off = new Int32Array(nI), rowsOf = (w) => ROWS[T_[w[0]]][w[1]];
      let NP = 0;
      for (let i = 0; i < nI; i++) { off[i] = NP; NP += rowsOf(W[i]).length; }
      const base = new Float64Array(8 + NP);
      base[0] = 1; base[2] = 0.5; base[3] = 0.5; base[4] = 0.5;
      for (let i = 0; i < nI; i++) { const rows = rowsOf(W[i]); for (let p = 0; p < rows.length; p++) base[8 + off[i] + p] = rows[p][4]; }
      return {
        fxp: {
          ver: VER, NFX: 8 + NP, NP, key: 'wsc', base, nI,
          iType: Uint8Array.from(W, (w) => T_[w[0]]), iVar: Uint8Array.from(W, (w) => w[1]), iRack: new Uint8Array(nI),
          iBr: new Uint8Array(nI), iN: Uint8Array.from(W, (w) => rowsOf(w).length), iByp: new Uint8Array(nI),
          iAlloc: new Uint8Array(nI).fill(1), iPar: new Int16Array(nI).fill(-1), iOff: off, iBB: new Uint8Array(3 * nI),
          iPh: new Float64Array(nI), iId: ['wd', 'wc'], iRev: new Uint8Array(nI), iCho: new Uint8Array(nI), iIr: ['', ''],
          rByp: new Uint8Array(3), rRoute: new Uint8Array(3), needs: [], filTypeAll: new Uint8Array(nI),
          seed: 0, any: 1, bpm: 120, smooth: 1, silence: 1, convMax: 10, xsKey: '', iSrc: ['wsrc', 'wsrc'],
        },
        off,
      };
    }

    /* ------------------------------------------------------------ FXRack (§8.1; Phase-1 machinery per instance) */
    let warnedVer = false, warnedFxp = false;
    // A re-seed (fxp.seed, transport()) or a topology change (Plate ↔ Hall, S2 reverb type, S2 Delay HQ above 96 kHz)
    // while a module's lines hold audible signal is applied at the bottom of a 2.5 ms duck of that module (output → its
    // input), which then fades back in over 5 ms; with nothing audible (output < 1e-6 for SEEDQ s of zero input) it is
    // applied at once, so renders after a silent history are bit-identical to a fresh rack's (§10.7f).
    const SEEDQ = 0.25;
    const QBIG = 1e15;                                         // quietT after a clear: the lines hold nothing at all
    // settleN() (IMPL-M R1-2): its floor (s), and the Convolve's clock period (fx-mods2: the tail input ring 3 × 4096
    // frames, 32 work slices of 128 — its counter n repeats every 12288 frames)
    const SETTLE = 0.3, CONV_T = 12288;
    const isNum = (x) => typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity;
    const isList = (a, n) => !!a && typeof a === 'object' && typeof a.length === 'number' && a.length >= n;
    class FXRack {
      constructor(base) {
        const fs = base > 0 && base < 1e7 ? +base : 48000;
        this.fs = fs;
        this.bpm = 120; this.smooth = 1; this.silence = 1;
        // block scratch shared by every instance (modules run one at a time)
        this.inL = new Float64Array(BLK); this.inR = new Float64Array(BLK); this.dyL = new Float64Array(BLK); this.dyR = new Float64Array(BLK);
        this.dvL = new Float64Array(BLK); this.dvR = new Float64Array(BLK);
        this.wL = new Float64Array(BLK); this.wR = new Float64Array(BLK); this.cf = new Float64Array(8);
        // bus inputs, the bus → Direct block, a rack's input during its bypass crossfade
        this.xL1 = new Float64Array(BLK); this.xR1 = new Float64Array(BLK); this.xL2 = new Float64Array(BLK); this.xR2 = new Float64Array(BLK);
        this.xdL = new Float64Array(BLK); this.xdR = new Float64Array(BLK); this.raL = new Float64Array(BLK); this.raR = new Float64Array(BLK);
        // FX-context globals: target, smoothed base, offsets (current / target), eff n start / delta, eff n, value
        this.gt = Float64Array.from(G_DEF); this.gb = new Float64Array(NG); this.gm = new Float64Array(NG); this.gmT = new Float64Array(NG);
        this.gS = new Float64Array(NG); this.gD = new Float64Array(NG); this.gn = new Float64Array(NG); this.gv = new Float64Array(NG);
        this.gdirty = 1;
        // the graph: units in FXP order (then the ones fading out), the chain of each rack (processing order)
        this.U = []; this.C0 = []; this.C1 = []; this.C2 = []; this.byId = new Map(); this.gc = 0;
        this.nI = 0; this.NFX = 8; this.key = '';
        this.rByp = new Uint8Array(3); this.rRoute = new Uint8Array(3); this.rx = new Float64Array(3);
        this.phOut = new Float64Array(MAXI).fill(NaN); this.grOut = new Float32Array(4 * MAXI);
        // monitor tap (§13.5 Delay spectrum overlay, IMPL: the post-module mono signal of one instance): id, its unit,
        // ring and write index, the chronological copy tapOut() returns
        this.tapId = ''; this.tapU = null; this.tapB = new Float32Array(TAP_N); this.tapW = 0; this.tapO = new Float32Array(TAP_N);
        // fresh: 1 never given a real FXP, 2 reset() with no audio processed since → the next set() snaps like a first call
        this.fresh = 1; this.calm = 1; this.nAct = 0; this.quietT = QBIG; this.inZero = 0; this.qmax = 0;
        this.swT = 0; this.swi = 0; this.swN = 0;                // the denormal sweep (sweep()): audio since its last look, the next unit, clean pools in a row (−1: done)
        this.rs = 0; this.rsU = 0; this.rsJ = 0; this.rsI = 0;   // the idle skip's flush (rest()): 0 rested, 1 run since, 2 under way at unit / line / float
        this.gm0 = 1; this.gm1 = 1; this.gate = 1; this.gT = 1; this.rf = 1; this.rfT = 1; this.fstep = 1 / (0.005 * fs);
        this.gd0 = 1; this.gd1 = 1; this.gb0 = new Float64Array(3).fill(1); this.gb1 = new Float64Array(3).fill(1); this.xd = 0;
        // setNote: key-tracking pitch and factor 2^((pitch − 60)/12); note a double field from the start (V8: the first
        // fractional pitch must not change the rack's map and deoptimise the rack code in that quantum)
        this.note = 60.5; this.note = 60; this.keyF = 1;
        this.latency = 0;
        this.B = null; this.M2 = null;                         // SxBase / FXMods2, resolved in set() (§0.3 lazy references)
        this.nConv = 0;                                        // Convolve instances (polled once per process call)
        this.nSC = 0;                                          // Duckers and v3 Compressors (IMPL-SC review 1 F1: scLive's early out)
        this.over = [];                                        // ids left unallocated (bypassed) by the 32 MB cap (§8.5)
        // IMPL-SC §1.2: the sidechain context this rack owns (never replaced: every Unit copies the reference) — the host writes
        // q (the quantum's first frame), F (the frame of the call's sample 0), reg (the scope's trigger registry, or null) and
        // kL / kR (the track's key input, call-aligned Float64Array(128), or null) before each process call; the rack writes b
        // (the block's offset in the call) per block. A unit's block sample j is frame F + b + j, its key sample kL[b + j]
        this.sc = { q: 0, F: 0, b: 0, reg: null, kL: null, kR: null };
        this.snap();
      }

      /* ---------------- configuration (allocation allowed) */
      set(fxp, fxt) {
        let ok = !!fxp && typeof fxp === 'object' && !!fxp.base && (ArrayBuffer.isView(fxp.base) || Array.isArray(fxp.base)) &&
          fxp.base.length >= 8;
        if (ok && fxp.ver !== VER) {
          if (!warnedVer) { warnedVer = true; if (typeof console !== 'undefined') console.warn('fx-dsp: FXP version', fxp.ver, 'not understood (expects', VER + '); rack bypassed'); }
          ok = false;
        }
        if (ok && !okGraph(fxp)) {
          if (!warnedFxp) { warnedFxp = true; if (typeof console !== 'undefined') console.warn('fx-dsp: malformed FXP instance arrays; rack bypassed'); }
          ok = false;
        }
        const gt = this.gt, U = this.U;
        if (!ok) {                                             // null: every instance off, master 1, not bypassed, 0 dB
          for (let i = 0; i < U.length; i++) if (U[i].n > 0) U[i].tgt[0] = 0;
          for (let g = 0; g < NG; g++) gt[g] = G_DEF[g];
        } else {
          const b = fxp.base;
          for (let g = 0; g < NG; g++) { const v = +b[g]; if (v === v) gt[g] = clamp01(v); }
          if (fxp.bpm > 0 && fxp.bpm < 10000) this.bpm = +fxp.bpm;
          if (fxp.smooth >= 0 && fxp.smooth < 100) this.smooth = +fxp.smooth;
          if (fxp.silence === 0 || fxp.silence === 1) this.silence = fxp.silence;
          this.B = globalThis.SxBase || null;
          this.M2 = globalThis.FXMods2 || null;
          this.graph(fxp);
        }
        if (fxt && typeof fxt === 'object') {
          if (Array.isArray(fxt.xs)) this.setXS(fxt.xs);
          if (Array.isArray(fxt.cv)) this.setCV(fxt.cv);
        }
        const V = this.U;
        for (let i = 0; i < V.length; i++) V[i].dirty = 1;
        this.gdirty = 1;
        if (this.fresh !== 0) { this.snap(); this.seed(1); if (ok) this.fresh = 0; } else if (ok && fxp.seed) this.seed(0);
        this.calm = 0;
        if (this.rs === 2) this.rs = 1;                        // (rest(): a pass under way starts over on the new graph)
      }
      // module kind of an FXP (type, variant), −1 when it cannot run here (the instance passes its input): S2 variants need
      // SxBase, the FXMods2 types need FXMods2 (§0.3 failure column)
      kindOf(t, v) {
        if (!(t >= 0 && t < NTYPES)) return -1;
        if (v === 1) return MOD_OF_TYPE[t];
        if (v === 3) return t === T_.cmp && this.B !== null ? 14 : -1;   // (IMPL-SC §3.2) the Compressor's v3: the kind-14 unit over the v3 rows
        if (v !== 2 || this.B === null) return -1;
        const k = K2[t], M2 = this.M2;
        if (k < 18) return k;
        if (M2 === null) return -1;
        if (k === 18) return typeof M2.Bode === 'function' ? 18 : -1;
        if (k === 19) return typeof M2.Convolve === 'function' && typeof this.B.FFT === 'function' ? 19 : -1;
        if (k === 20) return typeof M2.Utility === 'function' ? 20 : -1;
        if (k === 22) return typeof M2.Duck === 'function' ? 22 : -1;   // (IMPL-SC §4.2) the Ducker
        return typeof M2.XoverLH === 'function' && typeof M2.XoverLMH === 'function' && typeof M2.MS === 'function' ? 21 : -1;
      }
      newMod(u) {
        const fs = this.fs, B = this.B, M2 = this.M2;
        switch (u.k) {
          case 0: return new Hyper(fs); case 1: return new Dist(fs); case 2: return new Flanger(fs); case 3: return new Phaser(fs);
          case 4: return new Chorus(fs); case 5: return new Delay(fs); case 6: return new Comp(fs); case 7: return new Reverb(fs);
          case 8: return new EQ(fs); case 9: return new Filt(fs);
          case 10: return new Dist2(fs, B, M2); case 11: return new Phaser2(fs); case 12: return new Chorus2(fs);
          case 13: return new Delay2(fs); case 14: return new Comp2(fs); case 15: return new Rev2(fs, M2); case 16: return new EQ2(fs);
          case 17: return new Filt2(fs);
          case 18: return new M2.Bode(fs); case 19: return new M2.Convolve(fs); case 20: return new M2.Utility(fs);
          case 21: return new SplitMod(fs, u.t, M2);
          case 22: return new M2.Duck(fs);
          default: return null;
        }
      }
      // S2 reverb type selected by the unit's eff n (base + offset)
      revT(u) { const n = clamp01(u.tgt[1] + u.mdT[1]); return round(4 * n); }
      // the instance graph of an FXP: units are kept by instance id with their state when the type and variant match,
      // new ones are created, removed ones that still sound fade out (5 ms) at their place in their chain (rack or
      // splitter branch), then are dropped. Pass 1 builds the graph, pass 2 allocates under the per-track cap (§8.5)
      graph(P) {
        const nI = P.nI, b = P.base, NFX = b.length, old = this.U, prev = new Map(), U = [], C = [[], [], []], byId = new Map();
        const at = [];
        for (let i = 0; i < old.length; i++) {
          const u = old[i];
          u.keep = 0;
          if (!prev.has(u.id) || prev.get(u.id).gone === 1) prev.set(u.id, u);
        }
        const oldC = [this.C0, this.C1, this.C2], oldBr = [];
        for (let i = 0; i < old.length; i++) { const u = old[i]; if (u.k === 21 && u.br) oldBr.push(u, u.br); }
        // pass 1
        for (let i = 0; i < nI; i++) {
          at.push(null);
          const t = P.iType[i], v = P.iVar[i], par = P.iPar[i], off = P.iOff[i], n = P.iN[i], id = String(P.iId[i]);
          const k = this.kindOf(t, v), rows = k >= 0 ? ROWS[t][v] : null;
          if (k < 0 || rows === null || rows.length !== n || !(off >= 0) || 8 + off + n > NFX) continue;
          let pu = null;
          if (par >= 0) {                                      // a branch instance of a running splitter (no splitter inside)
            pu = par < i ? at[par] : null;
            if (pu === null || pu.k !== 21 || k === 21) continue;
          }
          let u = prev.get(id), fresh = false, g0 = -1;
          if (u === undefined || u.k !== k || u.t !== t || u.keep === 1) {
            u = new Unit(this, id, t, v, k, rows);
            u.mod = this.newMod(u);
            fresh = true;
          } else if (u.v !== v) g0 = growUnit(u, v, rows);   // (IMPL-SC §3.1) the same kind at another variant: grown in place, state kept
          u.keep = 1; u.gone = 0; u.idx = i; u.off = off;
          const r = P.iRack[i];
          u.rack = r === 1 || r === 2 ? r : 0;
          for (let p = 0; p < n; p++) { const x = +b[8 + off + p]; if (x === x) u.tgt[p] = clamp01(x); }
          if (g0 >= 0) for (let p = g0; p < n; p++) u.bs[p] = u.tgt[p];   // (the grown rows start at their values: no glide from the defaults)
          u.src = P.iSrc ? String(P.iSrc[i]) : '';           // IMPL-SC §5.2: the sidechain source (a track id; '' none — the side array exists only with a unit)
          u.byp = P.iByp[i] ? 1 : 0;
          const ph = +P.iPh[i];
          if (isNum(ph)) u.seedPh = frac(ph);
          u.revType = P.iRev[i] === 0 ? 0 : 1;
          u.choMono = P.iCho[i] ? 1 : 0;
          u.bpm = this.bpm; u.keyF = this.keyF;
          if (k === 19) { const s = P.iIr[i]; u.irId = typeof s === 'string' ? s : ''; u.convMax = P.convMax > 0 ? +P.convMax : 10; }
          if (((k >= 18 && k <= 20) || k === 22) && !u.mod.set(u)) { u.keep = 0; continue; }
          if (k === 21) {
            u.br = [[], [], []];
            if (u.bb === null) u.bb = new Uint8Array(3);
            for (let q = 0; q < 3; q++) u.bb[q] = P.iBB[3 * i + q] ? 1 : 0;
            if (fresh) for (let q = 0; q < 3; q++) u.mod.bx[q] = u.bb[q];
          }
          u.fresh = fresh ? 1 : 0;
          U.push(u); byId.set(id, u); at[i] = u;
          if (pu !== null) { const q = P.iBr[i]; pu.br[q < pu.mod.nb ? q : 0].push(u); } else C[u.rack].push(u);
        }
        // removed units that still sound: fade out after the nearest unit that preceded them in the same chain
        if (this.fresh === 0) {
          for (let r = 0; r < 3; r++) this.fadeIns(oldC[r], C[r], U);
          for (let q = 0; q < oldBr.length; q += 2) {
            const su = oldBr[q], obr = oldBr[q + 1];
            if (su.keep === 1 && su.br !== obr) { for (let c = 0; c < 3; c++) this.fadeIns(obr[c], su.br[c], U); continue; }
            // a removed splitter fades out with its old branches (minus instances that live on elsewhere)
            for (let c = 0; c < 3; c++) su.br[c] = obr[c].filter((x) => x.keep === 0 && x.st !== 0);
          }
        }
        // pass 2: allocation (FXP order) under the per-track memory cap (§8.5). New allocations and the set-time growth
        // of allocated units (Convolve tail FDL, S2 Reverb pool, splitter alignment lines) are checked against
        // CAP_BYTES: a new instance that does not fit stays unallocated and bypassed; a unit whose growth does not fit
        // keeps its size (Convolve: bypassed until it fits; Reverb: the unprepared TYPE is not installed); both are
        // listed in `over` (host notice). An instance refused once is not allocated again (no allocate-measure-discard
        // per set()) until the rack's total leaves room for the size it measured
        const seen = new Set();
        let mem = 0;
        for (let i = 0; i < old.length; i++) { const u = old[i]; if (u.keep === 0 && u.st !== 0 && u.has === 1) mem += u.mem; }
        for (let i = 0; i < U.length; i++) { const u = U[i]; if (u.has === 1) mem += u.mem; }
        this.over = [];
        for (let i = 0; i < nI; i++) {
          const u = at[i];
          if (u === null) continue;
          const k = u.k;
          if ((P.iAlloc[i] || u.has === 1) && u.has === 0) {
            if (u.over === 1 && u.need > 0 && mem + u.need > CAP_BYTES) this.over.push(u.id);
            else {
              this.allocMod(u);
              if (u.has === 1) {
                if (k === 15) u.mod.prep(P.filTypeAll[i] ? 31 : 1 << this.revT(u));
                if (k === 21) u.mod.lines(this.alignCap(u));
                seen.clear();
                u.mem = modBytes(u.mod, seen, 0);
                if (mem + u.mem > CAP_BYTES) {                 // over the cap: unallocated and bypassed (host notice)
                  u.need = u.mem;
                  u.mod = this.newMod(u);
                  if ((k >= 18 && k <= 20) || k === 22) u.mod.set(u);
                  if (k === 21) for (let q = 0; q < 3; q++) u.mod.bx[q] = u.bb[q];
                  u.has = 0; u.mem = 0; u.over = 1;
                  this.over.push(u.id);
                } else { mem += u.mem; u.over = 0; u.need = 0; }
              }
            }
          } else if (u.has === 1) {
            if (k === 19) mem = this.fitConv(u, mem);
            else if (k === 15) {
              const mask = P.filTypeAll[i] ? 31 : 1 << this.revT(u), d = u.mod.prepNeed(mask);
              if (d > 0) { if (mem + d <= CAP_BYTES) { u.mod.prep(mask); mem += d; u.mem += d; } else this.over.push(u.id); }
            } else if (k === 21) {
              const n = this.alignCap(u), d = u.mod.linesNeed(n);
              if (d > 0) { if (mem + d <= CAP_BYTES) { u.mod.lines(n); mem += d; u.mem += d; } else this.over.push(u.id); }
            }
          }
          if (k === 7 && u.has === 1 && u.mod.type !== u.revType) {
            const pl = u.mod.pool ? u.mod.pool.length : 0;          // (S1 Plate ↔ Hall: Phase-1 behaviour, the growth is counted)
            this.revSwitch(u);
            const d = 4 * ((u.mod.pool ? u.mod.pool.length : 0) - pl);
            if (d > 0) { u.mem += d; mem += d; }
          }
          if ((k === 9 || k === 17) && u.has === 1) {
            const a0 = u.mod.all, t0 = u.mod.type;
            if (P.filTypeAll[i]) u.mod.prealloc();
            else u.mod.setType(round((k === 9 ? 95 : 107) * clamp01(u.tgt[8] + u.mdT[8])));
            if (u.mod.all !== a0 || u.mod.type !== t0) { seen.clear(); const nb = modBytes(u.mod, seen, 0); mem += nb - u.mem; u.mem = nb; }
          }
          if (u.fresh === 1 && this.fresh === 0) this.unitInit(u);
          u.fresh = 0;
        }
        let nc = 0, ns = 0;
        for (let i = 0; i < U.length; i++) { const k = U[i].k; if (k === 19) nc++; else if (k === 22 || (k === 14 && U[i].v === 3)) ns++; }
        this.nConv = nc; this.nSC = ns;
        const key = typeof P.key === 'string' ? P.key : '';
        if (key !== this.key || nI !== this.nI) this.grOut.fill(0);   // instance indices moved
        this.U = U; this.C0 = C[0]; this.C1 = C[1]; this.C2 = C[2]; this.byId = byId; this.gc = 0;
        this.tapU = this.tapId !== '' ? byId.get(this.tapId) || null : null;
        this.nI = nI; this.NFX = NFX; this.key = key;
        for (let k = 0; k < 3; k++) {
          this.rByp[k] = P.rByp[k] ? 1 : 0;
          const r = P.rRoute[k];
          this.rRoute[k] = k > 0 && (r === 1 || r === 2) ? r : 0;
        }
        if (this.rRoute[1] === 2 && this.rRoute[2] === 2) this.rRoute[2] = 0;
      }
      // a kept Convolve's tail FDL to its want() under the cap (set-time): shrinking always, growth when it fits, else the
      // instance keeps its FDL and is bypassed (`capped`) and listed in `over` → the rack's new total
      fitConv(u, mem) {
        const M = u.mod, d = M.fdlDelta();
        if (d === 0 || d < 0 || mem + d <= CAP_BYTES) {
          if (d !== 0) { M.size(); u.mem += d; mem += d; }
          M.capped = 0;
          return mem;
        }
        M.capped = 1;
        this.over.push(u.id);
        return mem;
      }
      // host hook (§9.5): the engine calls it after SxBase.storeAsset / dropAsset ('smp' / 'smpdel' messages; a
      // configuration call like set(), never from process()). Every Convolve instance adopts its arrived entry (or
      // notices a dropped one) and its tail FDL is sized to the stored entry under the per-track cap, so an IR that
      // arrives after the patch plays its whole tail at once (allocation allowed here; process() only adopts)
      assets() {
        if (this.nConv === 0) return;
        const U = this.U;
        let mem = 0;
        for (let i = 0; i < U.length; i++) if (U[i].has === 1) mem += U[i].mem;
        for (let i = 0; i < U.length; i++) {
          const u = U[i];
          if (u.k !== 19 || u.has !== 1 || u.gone === 1) continue;
          const j = this.over.indexOf(u.id);
          if (j >= 0) this.over.splice(j, 1);
          u.mod.poll(); u.mod.want();
          mem = this.fitConv(u, mem);
          if (u.st === 0 && u.mod.ready === 0) u.mod.release();
        }
        this.calm = 0;
        if (this.rs === 2) this.rs = 1;                        // (rest(): a re-sized FDL — a pass under way starts over)
      }
      // removed units of an old chain that still sound go into the new chain after their nearest kept predecessor
      fadeIns(oc, nc, U) {
        let at = 0;
        for (let q = 0; q < oc.length; q++) {
          const u = oc[q];
          if (u.keep === 1) { const ix = nc.indexOf(u); if (ix >= 0) at = ix + 1; continue; }
          if (u.st === 0) continue;
          u.gone = 1; u.idx = -1; u.keep = 1;
          nc.splice(at, 0, u); U.push(u); at++;
        }
      }
      // a unit created while the rack runs: parameters at their targets, LFO phase / hold restarted, enabled through the
      // state machine (5 ms fade-in)
      unitInit(u) {
        for (let p = 0; p < u.n; p++) {
          u.bs[p] = u.tgt[p]; u.md[p] = u.mdT[p];
          const n = clamp01(u.tgt[p] + u.mdT[p]);
          u.en[p] = n; u.ev[p] = lawU(u.law[p], u.lo[p], u.hi[p], n);
        }
        u.st = 0; u.xf = 0; u.dirty = 1;
        this.mixUpd(u); u.gD0 = u.gD1; u.gW0 = u.gW1;
        const k = u.k;
        if (k === 1 || k === 10) u.mod.seed(); else if (k === 0 || (k >= 2 && k <= 4) || k === 11 || k === 12 || k === 18) this.modSeed(u);
      }
      setXS(xs) {                                              // FXT v2: X-Shaper tables per Distortion instance id
        for (let j = 0; j < xs.length; j++) {
          const e = xs[j];
          if (!e || typeof e !== 'object') continue;
          const u = this.byId.get(String(e.id));
          if (u === undefined || (u.k !== 1 && u.k !== 10) || !okXS(e.xsA) || !okXS(e.xsB)) continue;
          const a = e.xsA, c = e.xsB, A = u.xsA, B = u.xsB;
          for (let i = 0; i < NXS; i++) { const x = +a[i], y = +c[i]; A[i] = x === x ? x : i / 1024; B[i] = y === y ? y : i / 1024; }
        }
      }
      setCV(cv) {                                              // FXT v2 (IMPL-SC §5.2): the Ducker curve tables per instance id (kind 22 only)
        for (let j = 0; j < cv.length; j++) {
          const e = cv[j];
          if (!e || typeof e !== 'object') continue;
          const u = this.byId.get(String(e.id));
          if (u === undefined || u.k !== 22 || !okXS(e.tab)) continue;
          u.mod.setTab(e.tab);
        }
      }
      allocMod(u) {
        if (u.has === 1) return;
        switch (u.k) {
          case 0: u.mod.alloc(); break;
          case 2: u.mod.alloc(); break;
          case 4: u.mod.alloc(); break;
          case 5: u.mod.alloc(); break;
          case 6: u.mod.alloc(); break;
          case 7: u.mod.alloc(u.revType); break;
          case 9: u.mod.alloc(); if (!u.mod.sf) return; break;
          case 12: u.mod.alloc(); break;
          case 13: u.mod.alloc(); break;
          case 14: u.mod.alloc(); break;
          case 15: u.mod.alloc(this.revT(u)); break;
          case 17: u.mod.alloc(); if (!u.mod.sf) return; break;
          case 18: case 19: case 20: case 22: u.mod.alloc(); if (u.mod.has !== 1) return; break;
          default: break;                                        // Distortion, Phaser, EQ, splitters own no lines
        }
        u.has = 1;
      }
      // Plate ↔ Hall: the pool grows here; a sounding reverb ducks and the new (empty) topology fades in
      revSwitch(u) {
        u.mod.ensure(u.revType);
        if (u.st !== 0 && this.quietT < SEEDQ * this.fs) { u.pend |= 2; if (u.st === 1) u.st = 3; } else this.revApply(u);
      }
      revApply(u) {
        const V = u.mod;
        if (V.type === u.revType) return;
        V.apply(u.revType);
        if (u.st !== 0) { V.upd(u); V.snap(); V.ir = 0; }
      }
      // a module asked for a topology change in upd() (S2 reverb type, S2 Delay HQ): ducked while it sounds, else at once
      topoReq(u) {
        if ((u.pend & 2) !== 0) return;
        if (u.st !== 0 && this.quietT < SEEDQ * this.fs) { u.pend |= 2; if (u.st === 1) u.st = 3; } else this.topoApply(u);
      }
      topoApply(u) {
        if (u.k === 7) { this.revApply(u); return; }
        if (u.mod.topo !== 1) return;
        u.mod.applyTopo();
        if (u.st !== 0) { this.modUpd(u); this.modSnap(u); u.mod.ir = 0; }
        if (u.mod.topo === 1) u.dirty = 1;                      // the controls moved on during the duck: the next block re-requests
      }
      // modulation offsets in FX-context layout (§4.2; SerumDSP.fxMods); `key` (optional) = the FX layout key the matrix
      // was compiled against: a different key (stale layout) or a short vector means no modulation
      setMods(off, key) {
        const use = !!off && typeof off === 'object' && off.length >= this.NFX && (typeof key !== 'string' || key === this.key);
        const gT = this.gmT, U = this.U;
        let ch = 0;
        for (let g = 0; g < NG; g++) {
          let v = use ? +off[g] : 0;
          v = v > -2 ? (v < 2 ? v : 2) : v < 0 ? -2 : 0;        // NaN → 0
          if (v !== gT[g]) { gT[g] = v; ch = 1; }
        }
        for (let i = 0; i < U.length; i++) {
          const u = U[i], T = u.mdT, o = 8 + u.off, live = use && u.gone === 0;
          for (let p = 0; p < u.n; p++) {
            let v = live ? +off[o + p] : 0;
            v = v > -2 ? (v < 2 ? v : 2) : v < 0 ? -2 : 0;
            if (v !== T[p]) { T[p] = v; ch = 1; }
          }
        }
        if (ch === 1) this.calm = 0;
      }
      // the snap (IMPL-MM §3.4): every modulation offset's ramp start ← its target (md ← mdT, the globals and every unit), so the
      // next call starts each parameter at b + mdT instead of ramping there from the previous call's target (span(): s = b + md;
      // it recomputes eS / eD from md at every call); then, for each running unit with an offset, the enable path's recipe
      // (states(): targets from bs + mdT, modUpd, modSnap, mixUpd, gD0 / gW0 ← gD1 / gW1) — the unit's own slews (the dry / wet
      // ramp, the Delay's dL → tL, Rev2's pre-delay, the Utility's w0 / gL0 / gR0, the Chorus' taps) start at the target too, not
      // on the pre-▶ trajectory (live: the payload's lifetime; offline: the pre-roll). u.dirty stays set: the next states() re-runs
      // modUpd (idempotent) and sees a topology request. MASTER alone calls it, once, in the first part after ▶ / a seek — live
      // and offline at the same moment, both after transport()'s re-seed of the ModCore, so the start is exact (MM2); a seek
      // while sound flows steps these controls as it steps md. No Track calls it. A no-op on a unit without offsets
      modsJump() {
        const gm = this.gm, gT = this.gmT, U = this.U;
        for (let g = 0; g < NG; g++) gm[g] = gT[g];
        for (let i = 0; i < U.length; i++) {
          const u = U[i], md = u.md, T = u.mdT, bs = u.bs, en = u.en, ev = u.ev, law = u.law, lo = u.lo, hi = u.hi;
          let any = 0;
          for (let p = 0; p < u.n; p++) { if (T[p] !== 0 || md[p] !== 0) any = 1; md[p] = T[p]; }
          if (any === 0 || u.st === 0 || u.has !== 1) continue;             // (no offset on this unit, or it is off / unallocated: nothing to snap)
          for (let p = 0; p < u.n; p++) { const n = clamp01(bs[p] + T[p]); if (n !== en[p]) { en[p] = n; ev[p] = lawU(law[p], lo[p], hi[p], n); u.dirty = 1; } }
          this.modUpd(u); this.modSnap(u); this.mixUpd(u); u.gD0 = u.gD1; u.gW0 = u.gW1;   // (the enable path's recipe, states())
        }
      }
      // key-tracking pitch (§8.1; engine, once per span: Serum's recent gliding pitch, other models the last note-on,
      // none 60): the Key Track rows of the S2 Distortion / Filter variants read the factor 2^((pitch − 60)/12)
      setNote(pitch) {
        const p = isNum(pitch) ? +pitch : 60;
        if (p === this.note) return;
        this.note = p; this.keyF = pow(2, (p - 60) / 12);
        const U = this.U;
        for (let i = 0; i < U.length; i++) { const u = U[i]; u.keyF = this.keyF; if (u.k === 10 || u.k === 17) u.dirty = 1; }
      }
      // note-on: Hyper RETRIG and Bode RETRIG (immediate; ends a pending re-seed duck)
      trigger() {
        const U = this.U;
        for (let i = 0; i < U.length; i++) {
          const u = U[i];
          if (u.k === 0) { if (u.tgt[9] + u.mdT[9] < 0.5) continue; } else if (u.k === 18) {
            if (u.tgt[POS_RETRIG_BODE] + u.mdT[POS_RETRIG_BODE] < 0.5) continue;
          } else continue;
          u.mod.seed(u.seedPh);
          if ((u.pend & 1) !== 0) { u.pend &= 2; if (u.st === 3 && u.pend === 0) u.st = 1; }
        }
      }
      transport() { this.seed(0); }
      // re-seed the LFO phases from seedPh; force (or nothing audible in the lines): at once, together with the other
      // free-running phases and counters (reverb modulation, half-rate grids, the FX filter's S&H / ring phases, the
      // Bode's BLUR LFOs — stage M review R1-1)
      seed(force) {
        const quiet = force === 1 || this.quietT >= SEEDQ * this.fs, U = this.U;
        for (let i = 0; i < U.length; i++) {
          const u = U[i];
          switch (u.k) {
            case 0: case 2: case 3: case 4: case 11: case 12: this.seedMod(u, quiet); break;
            case 18: if (quiet) u.mod.seedQ(); this.seedMod(u, quiet); break;
            case 1: case 10: u.mod.seed(); break;
            case 5: case 13: if (quiet) u.mod.hph = 0; break;
            case 7: case 15: if (quiet) u.mod.seed(); break;
            case 9: case 17: if (quiet && u.has === 1 && force !== 1) u.mod.reset(); break;
            default: break;
          }
        }
      }
      seedMod(u, quiet) {
        if (quiet || u.st === 0) { u.pend &= 2; this.modSeed(u); return; }
        u.pend |= 1;
        if (u.st === 1) u.st = 3;
      }
      modSeed(u) { u.mod.seed(u.seedPh); }
      // at the bottom of a duck: a re-seed restarts the module (its feedback lines hold signal written along the old
      // LFO trajectory, which would come out after one delay), then fades its line inputs in like an enable
      doPend(u) {
        const a = u.pend;
        u.pend = 0;
        if ((a & 2) !== 0) this.topoApply(u);
        if ((a & 1) !== 0) { this.modReset(u); this.modIntro(u); this.modSeed(u); }
      }
      flushPend() {
        const U = this.U;
        for (let i = 0; i < U.length; i++) { const u = U[i]; if (u.pend !== 0) { this.doPend(u); if (u.st === 3) u.st = 1; } }
      }
      // LFO phase of FXP instance i (Hyper, Flanger L, Phaser L, Chorus, Bode shifter; NaN without one); a re-seed waiting
      // for its duck reports the new phase
      phases() {
        const o = this.phOut, U = this.U;
        o.fill(NaN);
        for (let i = 0; i < U.length; i++) {
          const u = U[i], j = u.idx;
          if (j < 0 || j >= MAXI) continue;
          const sp = (u.pend & 1) !== 0;
          switch (u.k) {
            case 0: o[j] = sp ? u.seedPh : u.mod.ph[0]; break;
            case 2: case 3: case 4: case 11: case 12: case 18: o[j] = sp ? u.seedPh : u.mod.ph; break;
            default: break;
          }
        }
        return o;
      }
      gr() { return this.grOut; }                             // [4·i … 4·i + 3]: compressor gain reduction of FXP instance i
      // [+] monitor tap (§13.5 Delay: the filter display's realtime spectrum overlay, IMPL: post-delay mono tap): the last
      // TAP_N frames of instance id's output, (L + R)/2 after the module (its mix, enable fade; nothing while it does not
      // run). '' switches it off. tapOut() → Float32Array(TAP_N), oldest first (one reused array), or null when off
      setTap(id) {
        const k = typeof id === 'string' ? id : '';
        if (k === this.tapId) return;
        this.tapId = k; this.tapU = k !== '' ? this.byId.get(k) || null : null;
        this.tapB.fill(0); this.tapW = 0;
      }
      tapOut() {
        if (this.tapId === '') return null;
        const B = this.tapB, O = this.tapO, w = this.tapW;
        for (let j = 0; j < TAP_N; j++) O[j] = B[(w + j) & (TAP_N - 1)];
        return O;
      }
      tapPush(L, R, o, m) {
        const B = this.tapB;
        let w = this.tapW;
        for (let j = 0; j < m; j++) { B[w] = 0.5 * (L[o + j] + R[o + j]); w = (w + 1) & (TAP_N - 1); }
        this.tapW = w;
      }
      // nothing can sound for zero input: no instance enabled, or all enabled ones quiet for 1 s plus the longest gap
      // between a delay write and its echo; never while a soft-reset fade is pending (process() renders it)
      idle() {
        if (this.rf !== 1 || this.rfT !== 1) return false;
        if (this.calm === 1 || this.nAct === 0) return true;
        const U = this.U;
        let tail = 0;
        for (let i = 0; i < U.length; i++) {
          const u = U[i], k = u.k;
          if (u.st === 0 || (k !== 5 && k !== 13 && k !== 15 && k !== 18 && k !== 19)) continue;
          const t = u.mod.tail();
          if (t > tail) tail = t;
        }
        return this.quietT >= this.fs + tail;
      }
      // IMPL-SC review 1 F1: a live sidechain unit — a Ducker with a source, a v3 Compressor at KEY EXT — running or switched on. Its
      // state follows the key, not this rack's input, so a host's idle skip still drives the rack on zeros (engine.js Track.scIdle);
      // false at once without one (nSC, counted by graph())
      scLive() {
        if (this.nSC === 0) return false;
        const U = this.U;
        for (let i = 0; i < U.length; i++) {
          const u = U[i], k = u.k;
          if (k === 22 ? u.src === '' : k !== 14 || u.v !== 3 || (u.mod.ext === 0 && u.tgt[I_EXT] < 0.5)) continue;
          if (u.st !== 0 || (u.tgt[0] >= 0.5 && u.byp === 0 && u.gone === 0 && u.has === 1)) return true;
        }
        return false;
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
        const U = this.U;
        for (let i = 0; i < U.length; i++) if (U[i].has === 1) this.modReset(U[i]);
        this.flushPend(); this.dropGone(); this.grOut.fill(0); this.seed(1);
        this.quietT = QBIG; this.calm = 0; this.swT = 0; this.swi = 0; this.swN = 0;
      }
      clear() {
        const U = this.U;
        for (let i = 0; i < U.length; i++) if (U[i].has === 1) this.modReset(U[i]);
        this.quietT = QBIG; this.qmax = 0; this.rf = 1; this.rfT = 1;    // (qmax: this span counts from the clear on)
        this.swT = 0; this.swi = 0; this.swN = 0;
        this.grOut.fill(0);
        this.snap(); this.seed(1);
        this.calm = 0;
      }
      // removed units stop at once (snap, clear) / once silent (post)
      dropGone() {
        const U = this.U;
        for (let i = 0; i < U.length; i++) if (U[i].gone === 1) { U[i].st = 0; U[i].xf = 0; this.gc = 1; }
        this.collect();
      }
      collect() {                                              // in place (no allocation): drop gone units with st 0
        if (this.gc === 0) return;
        this.gc = 0;
        if (this.rs === 2) this.rs = 1;                        // (rest(): the units move — a pass under way starts over)
        const L = [this.U, this.C0, this.C1, this.C2];
        for (let a = 0; a < 4; a++) this.compact(L[a]);
        const U = this.U;
        for (let i = 0; i < U.length; i++) { const u = U[i]; if (u.k === 21) for (let c = 0; c < 3; c++) this.compact(u.br[c]); }
      }
      compact(A) {
        let w = 0;
        for (let r = 0; r < A.length; r++) { const u = A[r]; if (u.gone === 1 && u.st === 0) continue; A[w++] = u; }
        A.length = w;
      }
      // whether unit u can run now (Convolve: an IR is adopted; Reverb S2: its type exists here)
      rdy(u) {
        const k = u.k;
        if (k === 19) return u.mod.ready === 1 && u.mod.capped === 0;
        if (k === 15) { const t = round(4 * u.en[1]); return u.mod.nd[t > 4 ? 4 : t] !== Infinity; }
        return true;
      }
      // snap every smoother to its target (first set, reset)
      snap() {
        this.flushPend();
        this.dropGone();
        const gt = this.gt, gmT = this.gmT;
        for (let g = 0; g < NG; g++) {
          this.gb[g] = gt[g]; this.gm[g] = gmT[g];
          const n = clamp01(gt[g] + gmT[g]);
          this.gn[g] = n; this.gv[g] = lawG(g, n);
        }
        const U = this.U;
        let act = 0;
        for (let i = 0; i < U.length; i++) {
          const u = U[i], tgt = u.tgt, mdT = u.mdT, law = u.law, lo = u.lo, hi = u.hi;
          for (let p = 0; p < u.n; p++) {
            u.bs[p] = tgt[p]; u.md[p] = mdT[p];
            const n = clamp01(tgt[p] + mdT[p]);
            u.en[p] = n; u.ev[p] = lawU(law[p], lo[p], hi[p], n);
          }
          const on = u.en[0] >= 0.5 && u.byp === 0 && u.has === 1 && this.rdy(u);
          u.st = on ? 1 : 0; u.xf = on ? 1 : 0;
          if (on) {
            this.modUpd(u);
            if (u.mod.topo === 1) { u.mod.applyTopo(); this.modUpd(u); }
            this.modSnap(u); act++; u.dirty = 0;
          } else u.dirty = 1;
          this.mixUpd(u); u.gD0 = u.gD1; u.gW0 = u.gW1;
          if (u.k === 1 || u.k === 10) u.mod.v = u.st !== 0 ? DIST_LAT : 0;
          if (u.k === 21) for (let c = 0; c < 3; c++) u.mod.bx[c] = u.bb[c];
        }
        this.nAct = act;
        const gv = this.gv;
        this.gm0 = this.gm1 = gv[0]; this.gT = this.gn[1] >= 0.5 ? 0 : 1; this.gate = this.gT; this.gdirty = 0;
        this.gd0 = this.gd1 = gv[2];
        this.gb0[1] = this.gb1[1] = gv[3]; this.gb0[2] = this.gb1[2] = gv[4];
        for (let k = 0; k < 3; k++) this.rx[k] = this.rByp[k];
        this.latency = this.lat();
      }
      // look-ahead of the Limit-mode compressors on the main path (MAIN rack, incl. the branches of its splitters)
      lat() {
        const C = this.C0;
        let a = 0;
        for (let q = 0; q < C.length; q++) {
          const u = C[q], k = u.k;
          if (u.st === 0) continue;
          if (k === 6 || k === 14) { if (u.mod.mode === 1 && u.mod.La > a) a = u.mod.La; continue; }
          if (k !== 21) continue;
          for (let c = 0; c < u.mod.nb; c++) {
            if (u.bb[c] !== 0 && u.mod.bx[c] === 1) continue;
            const ch = u.br[c];
            for (let j = 0; j < ch.length; j++) {
              const x = ch[j];
              if ((x.k === 6 || x.k === 14) && x.st !== 0 && x.mod.mode === 1 && x.mod.La > a) a = x.mod.La;
            }
          }
        }
        return a;
      }
      // IMPL-M §1.2: the delay of MAIN's output against its input (samples) — not `latency` (the longest look-ahead): the
      // sum along MAIN of each running unit's output delay — a Distortion's (its dry glide v: 0 … DIST_LAT, DIST_LAT once
      // enabled), a Limit-mode compressor's look-ahead La —, a splitter its longest running branch (every band is aligned
      // to it, see align); a fully bypassed rack passes its input (0). Reads state only (the master's A/B alignment and the
      // bounce's trim; never called by the rack itself)
      pathLat() {
        if (this.rByp[0] === 1 && this.rx[0] === 1) return 0;
        return this.chainLat(this.C0);
      }
      chainLat(C) {
        let a = 0;
        for (let q = 0; q < C.length; q++) {
          const u = C[q], k = u.k;
          if (u.st === 0) continue;
          if (k === 1 || k === 10) a += u.mod.v;
          else if (k === 6 || k === 14) { if (u.mod.mode === 1) a += u.mod.La; }
          else if (k === 21) {
            let mx = 0;
            for (let c = 0; c < u.mod.nb; c++) {
              if (u.bb[c] !== 0 && u.mod.bx[c] === 1) continue;
              const b = this.chainLat(u.br[c]);
              if (b > mx) mx = b;
            }
            a += mx;
          }
        }
        return a;
      }
      // IMPL-M R1-2: frames of exact zeros that take a freshly set rack to the state of one with a silent history (the
      // offline MASTER plays them before frame 0; a live rack has always heard them before ▶). Its start-up transients
      // are then over: a splitter's band alignment glides from 0 at gr = DIST_LAT / 5 ms samples per sample over up to
      // its line capacity (the slowest: ≈ 0.16 s per Limit-mode compressor at full look-ahead in a branch at 48 kHz,
      // 0.64 s at 192 kHz), a RATIO / multiband compressor's first block skips its attack (ent), the 5 ms fades and
      // ramps. Length: ≥ SETTLE s (> SEEDQ: the start's transport() is a quiet re-seed, as live) and ≥ the slowest
      // alignment glide + 10 ms, rounded up to whole Convolve clock periods (CONV_T: its partitions then stand as a fresh
      // instance's, which renders as before). Set time only (reads state)
      settleN() {
        const U = this.U;
        let g = 0;
        for (let i = 0; i < U.length; i++) { const u = U[i]; if (u.k === 21 && u.mod.lcap > 0) { const t = u.mod.lcap / u.mod.gr; if (t > g) g = t; } }
        const n = SETTLE * this.fs > g + 0.01 * this.fs ? SETTLE * this.fs : g + 0.01 * this.fs;
        return ceil(n / CONV_T) * CONV_T;
      }

      /* ---------------- per-module dispatch (monomorphic call sites) */
      modUpd(u) {
        switch (u.k) {
          case 0: u.mod.upd(u); break; case 1: u.mod.upd(u); break; case 2: u.mod.upd(u); break;
          case 3: u.mod.upd(u); break; case 4: u.mod.upd(u); break; case 5: u.mod.upd(u); break;
          case 6: u.mod.upd(u); break; case 7: u.mod.upd(u); break; case 8: u.mod.upd(u); break;
          case 9: u.mod.upd(u); break; case 10: u.mod.upd(u); break; case 11: u.mod.upd(u); break;
          case 12: u.mod.upd(u); break; case 13: u.mod.upd(u); break; case 14: u.mod.upd(u); break;
          case 15: u.mod.upd(u); break; case 16: u.mod.upd(u); break; case 17: u.mod.upd(u); break;
          case 18: u.mod.upd(u); break; case 19: u.mod.upd(u); break; case 20: u.mod.upd(u); break;
          default: u.mod.upd(u); break;
        }
      }
      modSnap(u) {
        switch (u.k) {
          case 0: u.mod.snap(); break; case 2: u.mod.snap(); break; case 3: u.mod.snap(); break;
          case 4: u.mod.snap(); break; case 5: u.mod.snap(); break; case 6: u.mod.snap(); break;
          case 7: u.mod.snap(); break; case 11: u.mod.snap(); break; case 12: u.mod.snap(); break;
          case 13: u.mod.snap(); break; case 14: u.mod.snap(); break; case 15: u.mod.snap(); break;
          case 16: u.mod.snap(); break; case 18: u.mod.snap(); break; case 19: u.mod.snap(); break;
          case 20: u.mod.snap(); break; case 21: u.mod.snap(); break; case 22: u.mod.snap(); break;
          default: break;
        }
      }
      modReset(u) {
        switch (u.k) {
          case 0: u.mod.reset(); break; case 1: u.mod.reset(); break; case 2: u.mod.reset(); break;
          case 3: u.mod.reset(); break; case 4: u.mod.reset(); break; case 5: u.mod.reset(); break;
          case 6: u.mod.reset(); break; case 7: u.mod.reset(); break; case 8: u.mod.reset(); break;
          case 9: u.mod.reset(); break; case 10: u.mod.reset(); break; case 11: u.mod.reset(); break;
          case 12: u.mod.reset(); break; case 13: u.mod.reset(); break; case 14: u.mod.reset(); break;
          case 15: u.mod.reset(); break; case 16: u.mod.reset(); break; case 17: u.mod.reset(); break;
          case 18: u.mod.reset(); break; case 19: u.mod.reset(); break; case 20: u.mod.reset(); break;
          default: u.mod.reset(); break;
        }
      }
      // after an enable during audio: fade the delay-line inputs in (5 ms); the look-ahead line starts filled with the
      // first input sample (no run of zeros, no jump when the real input arrives at the read position)
      modIntro(u) {
        switch (u.k) {
          case 0: case 2: case 4: case 5: case 7: case 12: case 13: case 15: case 18: case 19: u.mod.ir = 0; break;
          case 6: case 14: u.mod.pre = 1; break;
          default: break;
        }
      }
      modFlush(u) {
        switch (u.k) {
          case 1: u.mod.flush(); break; case 3: u.mod.flush(); break; case 4: u.mod.flush(); break;
          case 5: u.mod.flush(); break; case 6: u.mod.flush(); break; case 7: u.mod.flush(); break;
          case 8: u.mod.flush(); break; case 10: u.mod.flush(); break; case 11: u.mod.flush(); break;
          case 12: u.mod.flush(); break; case 13: u.mod.flush(); break; case 14: u.mod.flush(); break;
          case 15: u.mod.flush(); break; case 16: u.mod.flush(); break; case 18: u.mod.flush(); break;
          case 19: u.mod.flush(); break; case 20: u.mod.flush(); break; case 21: u.mod.flush(); break;
          default: break;                                        // Hyper / Flanger / Filter / Ducker: feed-forward or line-only state
        }
      }
      mixUpd(u) {
        const mk = u.mk;
        if (mk === 0) return;
        const mx = u.ev[u.mi], lv = u.ev[u.li];
        if (mk === 2) { u.gD1 = (1 - mx) * lv; u.gW1 = mx * lv; return; }
        const s = sin(HPI * mx);
        u.gD1 = (1 - mx * mx) * lv; u.gW1 = s * s * lv;
      }

      /* ---------------- audio */
      // L/R: main input (in place → output); dL/dR: direct input (added × g.direct before master); b1*/b2*: bus inputs
      process(L, R, n, dL, dR, b1L, b1R, b2L, b2R) {
        if (this.fresh === 2) this.fresh = 0;                // audio after a reset(): later edits glide again
        if (this.calm === 1 && !dL && !b1L && !b2L && (this.nConv === 0 || !this.wake())) return;   // bypass-cheap: O(1)
        n = n | 0;
        this.rs = 1;                                           // (the lines run: rest() flushes them again at the next skip)
        for (let o = 0; o < n; o += SPAN) this.span(L, R, o, n - o < SPAN ? n - o : SPAN, dL, dR, b1L, b1R, b2L, b2R);
      }
      // a calm rack polls its Convolve instances: one that is enabled and has just received its IR wakes the rack
      wake() {
        const U = this.U;
        let w = false;
        for (let i = 0; i < U.length; i++) {
          const u = U[i];
          if (u.k !== 19 || u.has !== 1) continue;
          if (u.mod.poll(1) && u.st === 0 && u.tgt[0] + u.mdT[0] >= 0.5 && u.byp === 0) w = true;
        }
        if (w) this.calm = 0;
        return w;
      }
      span(L, R, o, n, dL, dR, b1L, b1R, b2L, b2R) {
        // §5.4: base one-pole (τ = 10 ms × smooth) per call, mods reached linearly across the call
        const tau = 0.01 * this.smooth * this.fs, a = tau > 0 ? 1 - exp(-n / tau) : 1;
        let mvG = 0;
        {
          const tgt = this.gt, bs = this.gb, md = this.gm, mdT = this.gmT, eS = this.gS, eD = this.gD;
          for (let g = 0; g < NG; g++) {
            const b0 = bs[g], t = tgt[g], c = G_CONT[g];
            let b1 = t;
            if (c === 1 && b0 !== t) {
              b1 = b0 + (t - b0) * a;
              if (b1 - t < 1e-10 && t - b1 < 1e-10) b1 = t;
            }
            bs[g] = b1;
            const s = (c === 1 ? b0 : b1) + md[g], e = b1 + mdT[g];
            md[g] = mdT[g];
            eS[g] = s; eD[g] = e - s;
            if (e !== s) mvG = 1;
          }
        }
        const U = this.U, nu = U.length;
        for (let i = 0; i < nu; i++) {
          const u = U[i], cont = u.cont, tgt = u.tgt, bs = u.bs, md = u.md, mdT = u.mdT, eS = u.eS, eD = u.eD;
          let mv = 0;
          for (let p = 0; p < u.n; p++) {
            const b0 = bs[p], t = tgt[p], c = cont[p];
            let b1 = t;
            if (c === 1 && b0 !== t) {
              b1 = b0 + (t - b0) * a;
              if (b1 - t < 1e-10 && t - b1 < 1e-10) b1 = t;
            }
            bs[p] = b1;
            const s = (c === 1 ? b0 : b1) + md[p], e = b1 + mdT[p];
            md[p] = mdT[p];
            eS[p] = s; eD[p] = e - s;
            if (e !== s) mv = 1;
          }
          u.mv = mv;
          if (u.k === 19 && u.has === 1) u.mod.poll(1);          // Convolve: adopt an arrived IR (one epoch compare)
        }
        let z = 1;
        for (let i = o, end = o + n; i < end; i++) if (L[i] !== 0 || R[i] !== 0) { z = 0; break; }
        if (z === 1 && b1L) for (let i = o, end = o + n; i < end; i++) if (b1L[i] !== 0 || (b1R && b1R[i] !== 0)) { z = 0; break; }
        if (z === 1 && b2L) for (let i = o, end = o + n; i < end; i++) if (b2L[i] !== 0 || (b2R && b2R[i] !== 0)) { z = 0; break; }
        this.inZero = z; this.qmax = 0;
        const bus = b1L || b2L || this.C1.length > 0 || this.C2.length > 0;
        const sc = this.sc;
        for (let b = 0; b < n; b += BLK) {
          const m = n - b < BLK ? n - b : BLK, oo = o + b, t = (b + m) / n;
          sc.b = oo;                                             // (IMPL-SC §1.2) this block's offset in the call: the sidechain units' frame / key index
          if (b === 0 || mvG === 1) this.paramsG(t);
          for (let i = 0; i < nu; i++) { const u = U[i]; if (b === 0 || u.mv === 1) this.params(u, t); }
          this.states();
          this.xd = 0;
          if (bus) this.buses(L, R, oo, m, b1L, b1R, b2L, b2R);
          this.rackRun(0, this.C0, L, R, oo, m);
          this.out(L, R, oo, m, dL, dR);
        }
        this.post(n);
      }
      // eff n at block position t ∈ (0, 1] of the call; law values recomputed only where n changed
      paramsG(t) {
        const eS = this.gS, eD = this.gD, en = this.gn, ev = this.gv;
        for (let g = 0; g < NG; g++) {
          let n = eS[g] + eD[g] * t;
          n = n > 0 ? (n < 1 ? n : 1) : 0;
          if (n !== en[g]) { en[g] = n; ev[g] = lawG(g, n); this.gdirty = 1; }
        }
      }
      params(u, t) {
        const eS = u.eS, eD = u.eD, en = u.en, ev = u.ev, law = u.law, lo = u.lo, hi = u.hi;
        for (let p = 0; p < u.n; p++) {
          let n = eS[p] + eD[p] * t;
          n = n > 0 ? (n < 1 ? n : 1) : 0;
          if (n !== en[p]) { en[p] = n; ev[p] = lawU(law[p], lo[p], hi[p], n); u.dirty = 1; }
        }
      }
      // instance enable state machine (st, see Unit) and coefficient updates
      states() {
        const U = this.U;
        for (let i = 0; i < U.length; i++) {
          const u = U[i], on = u.en[0] >= 0.5 && u.byp === 0 && u.has === 1 && u.gone === 0 && this.rdy(u), s = u.st;
          if (on) {
            if (s === 0) {                                       // 0 → 1: reset, fresh coefficients, fade in
              this.modReset(u); this.modIntro(u); this.modUpd(u);
              if (u.mod.topo === 1) { u.mod.applyTopo(); this.modIntro(u); this.modUpd(u); }
              this.modSnap(u); this.mixUpd(u);
              u.gD0 = u.gD1; u.gW0 = u.gW1;
              u.st = 1; u.xf = 0; u.dirty = 0;
              if (u.k === 1 || u.k === 10) u.mod.v = 0;
              continue;
            }
            if (s === 2) u.st = u.pend !== 0 ? 3 : 1;
          } else if (s === 1 || s === 3) u.st = 2;
          if (u.st !== 0 && u.dirty === 1) {
            this.modUpd(u); this.mixUpd(u); u.dirty = 0;
            if (u.mod.topo === 1) this.topoReq(u);
          }
        }
        if (this.gdirty === 1) {
          const gv = this.gv;
          this.gm1 = gv[0]; this.gT = this.gn[1] >= 0.5 ? 0 : 1; this.gd1 = gv[2]; this.gb1[1] = gv[3]; this.gb1[2] = gv[4];
          this.gdirty = 0;
        }
        this.latency = this.lat();
      }
      // a rack's chain over [o, o + m) of X/Y; rack bypass: the input passes (5 ms crossfade), units frozen when fully bypassed
      rackRun(k, C, X, Y, o, m) {
        const T = this.rByp[k];
        let x = this.rx[k];
        if (x === 0 && T === 0) {
          for (let q = 0; q < C.length; q++) { const u = C[q]; if (u.st !== 0) this.runMod(u, X, Y, o, m); }
          return;
        }
        if (x === 1 && T === 1) return;
        const aL = this.raL, aR = this.raR, st = T === 1 ? this.fstep : -this.fstep;
        for (let j = 0; j < m; j++) { aL[j] = X[o + j]; aR[j] = Y[o + j]; }
        for (let q = 0; q < C.length; q++) { const u = C[q]; if (u.st !== 0) this.runMod(u, X, Y, o, m); }
        for (let j = 0; j < m; j++) {
          x += st;
          x = x > 1 ? 1 : x < 0 ? 0 : x;
          const i = o + j;
          X[i] += x * (aL[j] - X[i]); Y[i] += x * (aR[j] - Y[i]);
        }
        this.rx[k] = x;
      }
      // §1 buses for block [oo, oo + m): inputs, racks in dependency order, level g.busKv (n 0.5 = 0 dB is skipped), routing
      // into the main input (L/R), the direct block or the other bus
      // A bus without input, without a running unit and not fed by the other bus is silent: skipped (its level ramp
      // is kept current)
      buses(L, R, oo, m, b1L, b1R, b2L, b2R) {
        const X1 = this.xL1, Y1 = this.xR1, X2 = this.xL2, Y2 = this.xR2, r2 = this.rRoute[2] === 2;
        let a1 = b1L || this.running(this.C1) ? 1 : 0, a2 = b2L || this.running(this.C2) ? 1 : 0;
        if (r2 && a2 === 1) a1 = 1;
        if (!r2 && this.rRoute[1] === 2 && a1 === 1) a2 = 1;
        if (a1 === 1) for (let j = 0; j < m; j++) { const i = oo + j; X1[j] = b1L ? b1L[i] : 0; Y1[j] = b1R ? b1R[i] : 0; }
        if (a2 === 1) for (let j = 0; j < m; j++) { const i = oo + j; X2[j] = b2L ? b2L[i] : 0; Y2[j] = b2R ? b2R[i] : 0; }
        if (r2) { this.bus(2, a2, L, R, oo, m); this.bus(1, a1, L, R, oo, m); } else { this.bus(1, a1, L, R, oo, m); this.bus(2, a2, L, R, oo, m); }
      }
      running(C) { for (let q = 0; q < C.length; q++) if (C[q].st !== 0) return true; return false; }
      bus(k, live, L, R, oo, m) {
        if (live === 0) { this.gb0[k] = this.gb1[k]; return; }
        const X = k === 1 ? this.xL1 : this.xL2, Y = k === 1 ? this.xR1 : this.xR2;
        this.rackRun(k, k === 1 ? this.C1 : this.C2, X, Y, 0, m);
        const g0 = this.gb0[k], g1 = this.gb1[k];
        this.gb0[k] = g1;
        if (g0 !== 1 || g1 !== 1) {
          const dg = (g1 - g0) / m;
          for (let j = 0; j < m; j++) { const g = g0 + dg * (j + 1); X[j] *= g; Y[j] *= g; }
        }
        const r = this.rRoute[k];
        if (r === 0) {
          for (let j = 0; j < m; j++) { L[oo + j] += X[j]; R[oo + j] += Y[j]; }
        } else if (r === 1) {
          const dl = this.xdL, dr = this.xdR;
          if (this.xd === 0) { for (let j = 0; j < m; j++) { dl[j] = X[j]; dr[j] = Y[j]; } this.xd = 1; }
          else for (let j = 0; j < m; j++) { dl[j] += X[j]; dr[j] += Y[j]; }
        } else {
          const tl = k === 1 ? this.xL2 : this.xL1, tr = k === 1 ? this.xR2 : this.xR1;
          for (let j = 0; j < m; j++) { tl[j] += X[j]; tr[j] += Y[j]; }
        }
      }
      runMod(u, L, R, o, m) {
        const k = u.k;
        if (k === 21) { this.runSplit(u, L, R, o, m); return; }
        const inL = this.inL, inR = this.inR;
        for (let j = 0; j < m; j++) { inL[j] = L[o + j]; inR[j] = R[o + j]; }
        let dd = 0;
        switch (k) {
          case 0: u.mod.run(u, L, R, o, m); break;
          case 1: case 10: {
            const D = u.mod, s = u.st, x = u.xf;
            D.need = s !== 1 || x < 1 ? 1 : 0; D.vdir = s === 1 ? 1 : x === 0 ? -1 : 0;
            if (k === 1) D.run(u, L, R, o, m); else D.run(u, L, R, o, m);
            dd = 1; break;
          }
          case 2: u.mod.run(u, L, R, o, m); break;
          case 3: u.mod.run(u, L, R, o, m); break;
          case 4: u.mod.run(u, L, R, o, m); break;
          case 5: u.mod.run(u, L, R, o, m); break;
          case 6: u.mod.run(u, L, R, o, m); dd = 1; break;
          case 7: u.mod.run(u, L, R, o, m); break;
          case 8: u.mod.run(u, L, R, o, m); break;
          case 9: u.mod.run(u, L, R, o, m); break;
          case 11: u.mod.run(u, L, R, o, m); break;
          case 12: u.mod.run(u, L, R, o, m); break;
          case 13: u.mod.run(u, L, R, o, m); break;
          case 14: u.mod.run(u, L, R, o, m); dd = 1; break;
          case 15: u.mod.run(u, L, R, o, m); break;
          case 16: u.mod.run(u, L, R, o, m); break;
          case 17: u.mod.run(u, L, R, o, m); break;
          case 18: u.mod.run(u, L, R, o, m); break;
          case 19: u.mod.run(u, L, R, o, m); break;
          case 22: u.mod.run(u, L, R, o, m); break;
          default: u.mod.run(u, L, R, o, m); break;
        }
        if (u.mk !== 0) this.mix(u, L, R, o, m, dd === 1 ? this.dyL : inL, dd === 1 ? this.dyR : inR);
        if (u.st >= 2 || u.xf < 1) { if (k === 1 || k === 10) this.xfadeD(u, L, R, o, m); else this.xfade(u, L, R, o, m, inL, inR); }
        if (this.inZero === 1) this.track(L, R, o, m);
        if (u === this.tapU) this.tapPush(L, R, o, m);
      }
      // a splitter: bands → each branch's chain (a bypassed branch passes its band) → Σ × LEVEL; the splitter's own
      // enable crossfade uses its own input copy (the branch instances reuse the rack's block scratch)
      runSplit(u, L, R, o, m) {
        const S = u.mod, iL = S.iL, iR = S.iR, bL = S.bL, bR = S.bR, nb = S.nb, bx = S.bx;
        for (let j = 0; j < m; j++) { iL[j] = L[o + j]; iR[j] = R[o + j]; }
        S.xo.split(L, R, o, m, bL[0], bR[0], bL[1], bR[1], bL[2], bR[2]);
        for (let c = 0; c < nb; c++) {
          const T = u.bb[c] !== 0 ? 1 : 0;
          let x = bx[c];
          if (x === 1 && T === 1) continue;                      // bypassed branch: its band passes (units frozen)
          const ch = u.br[c], X = bL[c], Y = bR[c];
          if (x === 0 && T === 0) {
            for (let q = 0; q < ch.length; q++) { const y = ch[q]; if (y.st !== 0) this.runMod(y, X, Y, 0, m); }
            continue;
          }
          // branch bypass fading (5 ms): the chain runs, its band is mixed back in
          const kl = S.kL[c], kr = S.kR[c], st = T === 1 ? this.fstep : -this.fstep;
          for (let j = 0; j < m; j++) { kl[j] = X[j]; kr[j] = Y[j]; }
          for (let q = 0; q < ch.length; q++) { const y = ch[q]; if (y.st !== 0) this.runMod(y, X, Y, 0, m); }
          for (let j = 0; j < m; j++) {
            x += st;
            x = x > 1 ? 1 : x < 0 ? 0 : x;
            X[j] += x * (kl[j] - X[j]); Y[j] += x * (kr[j] - Y[j]);
          }
          bx[c] = x;
        }
        if (S.cl !== null) this.align(u, m);
        const l0 = S.l0, l1 = S.l1, dl = (l1 - l0) / m, x0 = bL[0], y0 = bR[0], x1 = bL[1], y1 = bR[1], x2 = bL[2], y2 = bR[2];
        S.l0 = l1;
        for (let j = 0; j < m; j++) {
          const g = l0 + dl * (j + 1);
          let sl = x0[j] + x1[j], sr = y0[j] + y1[j];
          if (nb === 3) { sl += x2[j]; sr += y2[j]; }
          L[o + j] = g * sl; R[o + j] = g * sr;
        }
        if (u.st >= 2 || u.xf < 1) this.xfade(u, L, R, o, m, iL, iR);
        if (this.inZero === 1) this.track(L, R, o, m);
      }
      // splitter latency alignment over the block (see SplitMod): each band is delayed by (the largest branch latency −
      // its own branch's), the delays gliding at S.gr samples per sample; the lines are written every block
      align(u, m) {
        const S = u.mod, nb = S.nb, lt = S.lt, dt = S.dt, dd = S.dd, br = u.br, bx = S.bx, lc = S.lcap;
        let mx = 0;
        for (let c = 0; c < nb; c++) {
          let a = 0;
          if (u.bb[c] === 0 || bx[c] < 1) {
            const ch = br[c];
            for (let q = 0; q < ch.length; q++) {
              const x = ch[q], k = x.k;
              if (x.st === 0) continue;
              if (k === 1 || k === 10) a += x.mod.v; else if ((k === 6 || k === 14) && x.mod.mode === 1) a += x.mod.La;
            }
          }
          lt[c] = a;
          if (a > mx) mx = a;
        }
        for (let c = 0; c < nb; c++) { const t = mx - lt[c]; dt[c] = t < lc ? t : lc; }
        const cap = lc + 4, P = S.cl, gr = S.gr, bL = S.bL, bR = S.bR;
        let w = S.lw;
        for (let j = 0; j < m; j++) {
          for (let c = 0; c < nb; c++) {
            const oL = 2 * c * cap, oR = oL + cap, X = bL[c], Y = bR[c];
            P[oL + w] = X[j]; P[oR + w] = Y[j];
            let d = dd[c];
            const t = dt[c];
            if (d !== t) { d = d < t ? (d + gr > t ? t : d + gr) : (d - gr < t ? t : d - gr); dd[c] = d; }
            if (d > 0) { X[j] = rdE(P, oL, cap, w, d); Y[j] = rdE(P, oR, cap, w, d); }
          }
          w = w + 1 === cap ? 0 : w + 1;
        }
        S.lw = w;
      }
      // alignment-line capacity a splitter's branches can need: the largest branch total of maximum latencies
      // (Distortion DIST_LAT, compressor look-ahead ≤ 10 ms)
      alignCap(u) {
        let n = 0;
        const la = ceil(0.01 * this.fs) + 2;
        for (let c = 0; c < u.mod.nb; c++) {
          let a = 0;
          const ch = u.br[c];
          for (let q = 0; q < ch.length; q++) { const k = ch[q].k; if (k === 1 || k === 10) a += DIST_LAT; else if (k === 6 || k === 14) a += la; }
          if (a > n) n = a;
        }
        return n;
      }
      track(L, R, o, m) {                                       // peak of a module output during zero input (quietT)
        let q = this.qmax;
        for (let j = 0; j < m; j++) {
          const a = L[o + j], b = R[o + j];
          if (a > q) q = a; else if (-a > q) q = -a;
          if (b > q) q = b; else if (-b > q) q = -b;
        }
        this.qmax = q;
      }
      // MIX law (inv A20.2) out = dry·(1 − m²)·lvl + wet·sin²(πm/2)·lvl (Filter, Utility: linear), ramped per sample
      mix(u, L, R, o, m, DL, DR) {
        const d0 = u.gD0, w0 = u.gW0, d1 = u.gD1, w1 = u.gW1;
        u.gD0 = d1; u.gW0 = w1;
        if (d0 === 0 && d1 === 0 && w0 === 1 && w1 === 1) return;
        const dd = (d1 - d0) / m, dw = (w1 - w0) / m;
        for (let j = 0; j < m; j++) {
          const i = o + j, gd = d0 + dd * (j + 1), gw = w0 + dw * (j + 1);
          L[i] = DL[j] * gd + L[i] * gw; R[i] = DR[j] * gd + R[i] * gw;
        }
      }
      // 5 ms enable / disable crossfade with the module input; st 3: 2.5 ms duck, pending actions at the bottom, fade in
      xfade(u, L, R, o, m, inL, inR) {
        const s = u.st, step = s === 1 ? this.fstep : s === 3 ? -2 * this.fstep : -this.fstep;
        let x = u.xf;
        for (let j = 0; j < m; j++) {
          x += step;
          x = x > 1 ? 1 : x < 0 ? 0 : x;
          const i = o + j;
          L[i] = inL[j] + x * (L[i] - inL[j]); R[i] = inR[j] + x * (R[i] - inR[j]);
        }
        u.xf = x;
        if (x === 0 && s >= 2) {
          if (u.pend !== 0) this.doPend(u);
          u.st = s === 2 ? 0 : 1;                                // stopped (cleared at the next enable) / fade back in
        }
      }
      // Distortion (DIST_LAT samples of latency, wet and dry): while the module's output weight is 0 the bypassed signal
      // glides between no delay and the latency (5 ms, ≈ 1 semitone), so the 5 ms crossfade itself is between
      // time-aligned signals (no comb notch mid-fade) and both ends are continuous
      xfadeD(u, L, R, o, m) {
        const D = u.mod, dvL = this.dvL, dvR = this.dvR, s = u.st, fst = this.fstep;
        const v0 = D.v0, gst = D.gst, vdir = D.vdir;
        let x = u.xf;
        for (let j = 0; j < m; j++) {
          if (s === 1) { if (x < 1 && (vdir <= 0 || v0 + j * gst >= DIST_LAT)) { x += fst; if (x > 1) x = 1; } } else if (x > 0 && vdir === 0) { x -= fst; if (x < 0) x = 0; }
          const i = o + j, a = dvL[j], b = dvR[j];
          L[i] = a + x * (L[i] - a); R[i] = b + x * (R[i] - b);
        }
        u.xf = x;
        if (s === 2 && x === 0 && D.v === 0) u.st = 0;
      }
      // output stage: + direct (× g.direct, skipped at 0 dB), × master (ramped), × bypass gate (5 ms), × soft-reset fade
      out(L, R, o, m, dL, dR) {
        const e0 = this.gd0, e1 = this.gd1;
        this.gd0 = e1;
        if (dL && dR) {
          if (e0 === 1 && e1 === 1) for (let j = 0; j < m; j++) { const i = o + j; L[i] += dL[i]; R[i] += dR[i]; }
          else { const de = (e1 - e0) / m; for (let j = 0; j < m; j++) { const i = o + j, g = e0 + de * (j + 1); L[i] += dL[i] * g; R[i] += dR[i] * g; } }
        }
        if (this.xd === 1) {
          const xl = this.xdL, xr = this.xdR;
          if (e0 === 1 && e1 === 1) for (let j = 0; j < m; j++) { L[o + j] += xl[j]; R[o + j] += xr[j]; }
          else { const de = (e1 - e0) / m; for (let j = 0; j < m; j++) { const g = e0 + de * (j + 1); L[o + j] += xl[j] * g; R[o + j] += xr[j] * g; } }
        }
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
        const U = this.U, gr = this.grOut;
        let act = 0;
        for (let i = 0; i < U.length; i++) {
          const u = U[i];
          if (u.st !== 0) { act++; this.modFlush(u); } else {
            if (u.gone === 1) this.gc = 1;
            if (u.k === 19 && u.has === 1 && u.mod.ready === 0) u.mod.release();   // a dropped IR: let go of its buffers
          }
          if ((u.k === 6 || u.k === 14 || u.k === 22) && u.idx >= 0 && u.idx < MAXI) {   // (22: the Ducker's reduction and playhead, IMPL-SC §4.2)
            const o = 4 * u.idx;
            if (u.st !== 0) u.mod.meter(gr, o); else if (gr[o] !== 0 || gr[o + 1] !== 0 || gr[o + 2] !== 0 || gr[o + 3] !== 0) { gr[o] = 0; gr[o + 1] = 0; gr[o + 2] = 0; gr[o + 3] = 0; }
          }
        }
        if (this.gc === 1) this.collect();
        this.nAct = act;
        // (the denormal sweep's schedule restarts with each silence — never carried over from an earlier one: live ≡ bounce,
        // §10.7f; a nonzero module output re-arms a finished sweep; idle() looked at once per SWEEP s, the sweep only then)
        if (act > 0 && this.inZero === 1 && this.qmax < 1e-6) { this.quietT += n; if (this.qmax !== 0) this.swN = 0; }
        else { this.quietT = 0; this.swT = 0; this.swi = 0; this.swN = 0; }
        if (act > 0 && this.inZero === 1 && this.swN >= 0 && this.quietT >= this.fs && (this.swT += n) >= this.fs * SWEEP) { this.swT = 0; if (this.idle()) this.sweep(); }
        const g = this.gm1;
        this.calm = act === 0 && this.gate === 1 && this.gT === 1 && this.rf === 1 && this.rfT === 1 &&
          g - 1 < 1e-9 && 1 - g < 1e-9 && this.gb[0] === this.gt[0] ? 1 : 0;
      }
      // the denormal sweep (sweepArr): the next reverb's pool (S1 Reverb, S2 Reverb — the only lines that keep a subnormal),
      // whole, every SWEEP s once the rack is idle() — ≥ 1 s of exact-zero input with every module output < 1e-6, plus the longest
      // echo gap: its host skips an ordinary panel from there (an instrument's own rack once the instrument has been quiet 2 s),
      // so only MASTER and a sidechain-live panel keep sweeping; never inside a golden's gaps between bursts (0.25–0.5 s; their
      // tails far above 1e-30: the audio is unchanged). Round robin, one pool per sweep (the largest: the Plate's 64 k floats at
      // 48 kHz, Nitrous's 154 k at 192 kHz); done (swN −1) after a full round of clean pools since the last dirty one with no
      // module output, until the next sound; a reverb that does not run (frozen()) is left as it is. The small states flush per
      // block (modFlush)
      sweep() {
        const U = this.U, nu = U.length;
        let n = 0, j = -1;
        for (let k = 0; k < nu; k++) {
          const i = (this.swi + k) % nu, u = U[i];
          if (u.st === 0 || u.has !== 1 || (u.k !== 7 && u.k !== 15) || this.frozen(u) === 1) continue;
          n++;
          if (j < 0) j = i;
        }
        if (j < 0) { this.swi = 0; this.swN = -1; return; }
        this.swi = j + 1;
        if (U[j].mod.sweep() !== 0) this.swN = 0; else if (++this.swN >= n) this.swN = -1;
      }
      // 1: unit x sits in a splitter branch that does not run (bypassed: its band passes, runSplit; or the splitter stopped) —
      // frozen, its tail neither decays nor reaches the output until the branch runs again (a nonzero output then re-arms the
      // sweep); a frozen pool kept the sweep going for ever (review #5)
      frozen(x) {
        const U = this.U;
        for (let i = 0; i < U.length; i++) {
          const s = U[i];
          if (s.k !== 21 || s.br === null) continue;
          for (let c = 0; c < s.mod.nb; c++) if (s.br[c].indexOf(x) >= 0) return s.st === 0 || (s.bb[c] !== 0 && s.mod.bx[c] === 1) ? 1 : 0;
        }
        return 0;
      }
      // the host's idle skip (engine.js, §6.4: an Inst holding the rack, or a panel no source feeds, skipped while idle(); not
      // a sidechain-live rack, which runs on): the rack stops with its lines as they stand. Running, a feed-forward line refills
      // with the zero input within one ring (review #3); skipped, it keeps what its input wrote on the way to exact 0 — float32
      // subnormals in the S2 Reverb's 2.5 s pre-delay (7 after a 909, 21 after a Juno, 22 after a Prophet-5: inst-denormal), a
      // Delay's 2 s lines. One pass over every unit's Float32 lines (LINES; the pools too: a short pre-delay idles before the
      // first ⅛ s sweep) flushes below FLT_MIN — the values a float32 holds only as subnormals; no normal value, no −0 changes —
      // REST floats per skipped frame (a Delay + Reverb rack holds ~380 k at 48 kHz, ~750 k at 96: no quantum carries it), then
      // nothing until the rack runs again (process(): rs 1). Counted in frames, not calls: live ≡ bounce
      rest(n) {
        if (this.rs === 0) return;
        if (this.rs === 1) { this.rs = 2; this.rsU = 0; this.rsJ = 0; this.rsI = 0; }
        const U = this.U;
        let b = n * REST;
        for (;;) {
          if (this.rsU >= U.length) { this.rs = 0; return; }
          const u = U[this.rsU], L = u.has === 1 ? LINES[u.k] : null;
          if (!L || this.rsJ >= L.length) { this.rsU++; this.rsJ = 0; this.rsI = 0; continue; }
          const a = u.mod[L[this.rsJ]], c = a ? a.length : 0, i0 = this.rsI < c ? this.rsI : c, e = c - i0 > b ? i0 + b : c;
          if (e > i0) fl32(a, i0, e);
          b -= e - i0;
          if (e < c) { this.rsI = e; return; }
          this.rsJ++; this.rsI = 0;
          if (b <= 0) return;
        }
      }

      /* ---------------- JIT warm-up and test hooks */
      warmUp() {
        const t = new FXRack(this.fs), N = SPAN, L = new Float64Array(N), R = new Float64Array(N);
        const dL = new Float64Array(N), dR = new Float64Array(N), fxp = s1Fxp(), base = fxp.base, mods = new Float64Array(fxp.NFX);
        for (let m = 0; m < NMOD; m++) base[8 + W_OFF[m]] = 1;
        base[0] = 0.83; base[AT[FIDX.DIM_MIX]] = 0.53; base[AT[FIDX.DLY_Q]] = 0.63; base[AT[FIDX.DLY_TIMEL]] = 0.31; base[AT[FIDX.REV_T]] = 0.37;
        fxp.filTypeAll[9] = 1;
        fxp.iPh[0] = 0.1; fxp.iPh[2] = 0.2; fxp.iPh[3] = 0.3; fxp.iPh[4] = 0.4;
        let r = 0x2545F491;
        for (let round = 0; round < 2; round++) {
          for (let c = 0; c < 16; c++) {
            // every module, mode and switch: compressor single band / Limit / multiband (c = 3, 11 Limit; 4–7, 12–15 MB)
            base[AT[FIDX.DIST_MODE]] = c / 15; base[AT[FIDX.DIST_FILT]] = (c % 3) / 2; base[AT[FIDX.DLY_MODE]] = (c % 3) / 2;
            base[AT[FIDX.DLY_BPM]] = c & 1; base[AT[FIDX.DLY_LINK]] = (c >> 1) & 1; base[AT[FIDX.EQ_TYPEL]] = (c % 3) / 2;
            base[AT[FIDX.EQ_TYPEH]] = ((c + 1) % 3) / 2; base[AT[FIDX.CMP_MB]] = (c >> 2) & 1;
            base[AT[FIDX.FLG_BPM]] = c & 1; base[AT[FIDX.PHS_BPM]] = (c >> 1) & 1; base[AT[FIDX.CHO_BPM]] = (c >> 2) & 1;
            base[AT[FIDX.HYPER_RETRIG]] = c & 1; base[AT[FIDX.FIL_TYPE]] = (c * 6 + round) / 95;
            base[AT[FIDX.DIST_ON]] = c === 9 ? 0 : 1;            // Distortion disable / enable glides
            fxp.iRev[7] = c & 1; fxp.iCho[4] = (c >> 2) & 1; fxp.seed = c === 0 || c === 6 ? 1 : 0;
            t.set(fxp, null);
            for (let s = 0; s < 3; s++) {
              for (let i = 0; i < N; i++) {
                r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
                L[i] = ((r >>> 0) / 4294967296 - 0.5) * 0.9; R[i] = L[i] * 0.7; dL[i] = L[i] * 0.1; dR[i] = dL[i];
              }
              mods[AT[FIDX.FIL_CUTOFF]] = 0.07 * s; mods[AT[FIDX.DIST_DRIVE]] = 0.11 * s; mods[AT[FIDX.REV_SIZE]] = 0.05 * s;
              mods[AT[FIDX.CMP_RATIO]] = c % 4 === 3 ? 0.3 : 0;  // a modulated RATIO reaches Limit within the call (base glides)
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
        // buses and routing: instances on BUS 1 / BUS 2, every route, rack bypass fades, direct and bus levels
        const bL = new Float64Array(N), bR = new Float64Array(N);
        for (let c = 0; c < 4; c++) {
          for (let i = 0; i < NMOD; i++) fxp.iRack[i] = i % 3;
          fxp.rRoute[1] = c % 3; fxp.rRoute[2] = c & 1; fxp.rByp[c % 3] = c & 1; base[2] = 0.3 + 0.1 * c; base[3] = 0.4; base[4] = 0.6;
          fxp.key = 'w' + c; fxp.seed = 0;
          t.set(fxp, null);
          for (let s = 0; s < 2; s++) {
            for (let i = 0; i < N; i++) { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; bL[i] = ((r >>> 0) / 4294967296 - 0.5) * 0.5; bR[i] = -bL[i]; L[i] = bL[i]; R[i] = bR[i]; }
            t.process(L, R, N, dL, dR, bL, bR, s === 1 ? undefined : bR, s === 1 ? undefined : bL);
          }
        }
        // the S2 variants and the FXMods2 modules (when SxBase / FXMods2 are loaded): every mode switch once, one process
        // call per configuration (the §14.1 row q budget: the whole warmUp ≤ 1.5 × Phase 1)
        if (globalThis.SxBase && globalThis.FXMods2) {
          const W = s2Fxp(), P = W.fxp, B2 = P.base, o = W.off, rv = 5, at = (i, pid) => 8 + o[i] + ROWS[P.iType[i]][2].findIndex((x) => x[0] === pid);
          for (let c = 0; c < 5; c++) {
            B2[at(0, 'mode')] = c === 0 ? 16 / 17 : c === 1 ? 1 : c / 17; B2[at(0, 'kt')] = c & 1; B2[at(1, 'poles')] = c & 1 ? 5 / 17 : 9 / 17;
            B2[at(1, 'depth2')] = 0.2 * (c & 1); B2[at(2, 'hp')] = c & 1; B2[at(4, 'mb')] = c & 1; B2[at(rv, 'type')] = (c % 5) / 4;
            B2[at(7, 'clean')] = c & 1; B2[at(8, 'delay')] = 0.2; B2[at(8, 'feed')] = 0.4; B2[at(8, 'blur')] = 0.3 * (c & 1);
            B2[at(9, 'mbass')] = c & 1; B2[at(9, 'width')] = 0.2; P.key = 'w2' + c; P.seed = c === 2 ? 1 : 0;
            t.set(P, null);
            for (let i = 0; i < 64; i++) { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; L[i] = ((r >>> 0) / 4294967296 - 0.5) * 0.8; R[i] = -0.5 * L[i]; }
            t.trigger();
            t.process(L, R, 64);
          }
          // IMPL-SC G7 (skeptic #28): the sidechain paths — a Ducker fed from a hand-filled ring (synced / ms, attack, smooth, the NOTE
          // filter) and a v3 compressor keyed from a key buffer (KEY EXT, the HPF off / on, LISTEN, single band / multiband), on the
          // temporary rack's own sc context
          if (typeof globalThis.FXMods2.Duck === 'function') {
            const W = scFxp(), P = W.fxp, B3 = P.base, o = W.off, at = (i, pid) => 8 + o[i] + ROWS[P.iType[i]][P.iVar[i]].findIndex((x) => x[0] === pid);
            const ring = { q: -1, n: 2, f: new Float64Array(64), note: new Uint8Array(64), vel: new Float32Array(64) }, s = t.sc;
            const kL = new Float64Array(N), kR = new Float64Array(N), tab = new Float32Array(NXS);
            for (let i = 0; i < NXS; i++) tab[i] = i / (NXS - 1);
            s.reg = new Map([['wsrc', ring]]); s.kL = kL; s.kR = kR;
            for (let c = 0; c < 4; c++) {
              B3[at(0, 'bpm')] = c & 1; B3[at(0, 'att')] = 0.02 * (c & 1); B3[at(0, 'smooth')] = c < 2 ? 0 : 0.1; B3[at(0, 'note')] = c === 3 ? 37 / 128 : 0;
              B3[at(1, 'ext')] = 1; B3[at(1, 'schp')] = c & 2 ? 0.4 : 0; B3[at(1, 'listen')] = c === 3 ? 1 : 0; B3[at(1, 'thr')] = 0.3; B3[at(1, 'mb')] = c === 2 ? 1 : 0;
              P.key = 'wsc' + c;
              t.set(P, c === 0 ? { xs: [], cv: [{ id: 'wd', tab }] } : null);
              for (let q = 0; q < 6; q++) {
                const F0 = 128 * q;
                for (let i = 0; i < N; i++) { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; L[i] = ((r >>> 0) / 4294967296 - 0.5) * 0.8; R[i] = -0.5 * L[i]; kL[i] = 1.5 * L[(i + 37) & 127]; kR[i] = kL[i]; }
                ring.f[0] = F0 + 5; ring.note[0] = 36; ring.vel[0] = 1; ring.f[1] = F0 + 70; ring.note[1] = 38; ring.vel[1] = 0.5; ring.q = F0;
                s.q = F0; s.F = F0;
                t.process(L, R, N);
              }
              t.gr();
            }
            s.reg = null; s.kL = null; s.kR = null;
          }
        }
        t.transport(); t.reset();
        this.reset();
      }
      // test hook: bytes held in typed arrays reachable from the rack and its instances (module buffers, the FX filter's
      // SFilter); the shared constant tables are not counted
      bytes() {
        const seen = new Set(), skip = { U: 1, C0: 1, C1: 1, C2: 1, byId: 1, B: 1, M2: 1 };
        for (let m = 0; m < NMOD; m++) seen.add(S1K[m].buffer);
        seen.add(LINXS.buffer);
        let n = 0;
        const add = (x, depth) => {
          if (!x || typeof x !== 'object' || depth > 4) return;
          if (ArrayBuffer.isView(x)) { if (!seen.has(x.buffer)) { seen.add(x.buffer); n += x.buffer.byteLength; } return; }
          if (seen.has(x)) return;
          seen.add(x);
          if (depth > 0 && typeof x.bytes === 'function') { n += x.bytes(); return; }
          for (const k of Object.keys(x)) if (depth > 0 || skip[k] !== 1) add(x[k], depth + 1);
        };
        add(this, 0);
        for (let i = 0; i < this.U.length; i++) add(this.U[i], 0);
        return n;
      }
    }
    // structural check of the instance arrays of an FXP v2 (lengths ≥ nI, offsets inside base)
    function okGraph(P) {
      const nI = P.nI;
      if (!(nI >= 0 && nI <= MAXI && nI === (nI | 0))) return false;
      for (const k of ['iType', 'iVar', 'iRack', 'iBr', 'iN', 'iByp', 'iAlloc', 'iPar', 'iOff', 'iPh', 'iId', 'iRev', 'iCho', 'iIr', 'filTypeAll']) {
        if (!isList(P[k], nI)) return false;
      }
      if (P.iSrc !== undefined && !isList(P.iSrc, nI)) return false;   // (IMPL-SC §5.2: present only when a sidechain unit exists)
      return isList(P.iBB, 3 * nI) && isList(P.rByp, 3) && isList(P.rRoute, 3);
    }

    /* ------------------------------------------------------------ main-thread helpers (§8.5.1; SPEC-serum2 §11.11) */
    // static transfer y(x) for x = −1…1 (Downsample: y = 0.5x). Modes 0–15: the Phase-1 shapers (S1 copy). Modes 16
    // Overdrive and 17 Soft Sat. are the S2 curves (SxBase.shape when loaded, else the §8.2 formulas): Overdrive is the
    // static chain of `stages` (1–16, default 4) stages without their low-passes, w₁ = shape(16, x, d), w_j = shape(16,
    // w_{j−1}, log10(2/0.9)) — the module's response at low frequencies
    const OD_D1 = Math.log10(2 / 0.9), OD_K = 1 / tanh(1.8);
    function sh16(x, d) { return 0.9 * (tanh(1.8 * 0.5 * pow(10, d) * x) * OD_K); }
    function sh17(x, d) { const u = 0.5 * pow(10, 0.6 * d) * x; return u < 1 && u > -1 ? 1.5 * u - 0.5 * u * u * u : u > 0 ? 1 : -1; }
    function distCurve(mode, drive, xsA, xsB, n = 257, stages = 4) {
      const md = round(+mode);
      n = n > 1 ? n | 0 : 2;
      const out = new Float64Array(n);
      if (md === 16 || md === 17) {
        const B = globalThis.SxBase, sh = B && typeof B.shape === 'function' ? B.shape : null, d = clamp01(+drive);
        let N = round(+stages);
        N = N > 1 ? (N < 16 ? N : 16) : 1;
        for (let i = 0; i < n; i++) {
          const x = -1 + 2 * i / (n - 1);
          if (md === 17) { out[i] = sh ? sh(17, x, d) : sh17(x, d); continue; }
          let w = sh ? sh(16, x, d) : sh16(x, d);
          for (let j = 1; j < N; j++) w = sh ? sh(16, w, OD_D1) : sh16(w, OD_D1);
          out[i] = w;
        }
        return out;
      }
      const S = new Shaper();
      S.xa = okXS(xsA) ? xsA : LINXS; S.xb = okXS(xsB) ? xsB : LINXS;
      S.set(+mode, drive);
      for (let i = 0; i < n; i++) { const x = -1 + 2 * i / (n - 1); out[i] = S.mode === 8 ? 0.5 * x : shape(S, x); }
      return out;
    }
    // magnitude (dB) of the EQ bands of FXP instance `inst` at freqs (§11.11 eqResponse(fxp, instIndex, effN, freqs, fs)).
    // effN: eff n source — the FX-context vector (base + offsets, index 8 + off + p), or a Serum snapshot `eff`
    // (NSV + MAXFX = 1589 entries, the FX context from 429 on); absent: fxp.base; no FXP / EQ instance: the defaults.
    // inst < 0 or not an EQ: the first EQ instance of fxp. The Phase-1 call form eqResponse(fxp, effN, freqs, fs) is
    // accepted (fx-ui's display: effN = fxp.base, the first EQ instance).
    const SNAP_EFF = 429 + 8 + 48 * 24, SNAP_FX = 429;
    function eqResponse(fxp, inst, effN, freqs, fs) {
      if (typeof inst !== 'number') { fs = freqs; freqs = effN; effN = inst; inst = -1; }
      const n = freqs && freqs.length > 0 ? freqs.length | 0 : 0, out = new Float64Array(n), K = S1K[8];
      fs = fs > 0 ? +fs : 48000;
      let at = -1;
      if (fxp && typeof fxp === 'object' && fxp.ver === VER && fxp.base && isList(fxp.iType, fxp.nI) && isList(fxp.iOff, fxp.nI)) {
        const eq = TYPES.indexOf('eq');
        if (inst >= 0 && inst < fxp.nI && fxp.iType[inst] === eq) at = inst;
        for (let i = 0; i < fxp.nI && at < 0; i++) if (fxp.iType[i] === eq) at = i;
      }
      let src = null, o = 0;
      if (at >= 0) {
        o = 8 + fxp.iOff[at];
        const nP = fxp.iVar && fxp.iVar[at] === 2 ? K.length + 1 : K.length;
        if (effN && effN.length === SNAP_EFF) { src = effN; o += SNAP_FX; } else if (effN && effN.length >= o + nP) src = effN;
        else if (fxp.base.length >= o + nP) src = fxp.base;
      }
      const v = new Float64Array(K.length), c = new Float64Array(10);
      for (let p = 0; p < K.length; p++) v[p] = lawV(K[p], clamp01(src ? +src[o + p] : FX_DEF[K[p]]));
      eqCoefs(v, fs, c);
      // S2 variant: + LEVEL (2n)² after the bands
      let lv = 0;
      if (at >= 0 && fxp.iVar && fxp.iVar[at] === 2) {
        const nl = clamp01(src ? +src[o + K.length] : 0.5), g = 4 * nl * nl;
        lv = g > 1e-15 ? DB * log(g) : -300;
      }
      for (let i = 0; i < n; i++) {
        const w = TAU * freqs[i] / fs;
        out[i] = 0.5 * DB * log(bqMag2(c, 0, w) * bqMag2(c, 5, w)) + lv;
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
    // dB response of each splitter branch's band at freqs (§11.11): type = FXP type id (13 Splitter L/H, 14 L/M/H, 15 M/S)
    // or its id string; f1, f2 = crossovers in Hz (L/H: f1 only; clamped to [10 Hz, 0.45·fs]; L/M/H keeps f2 ≥ 1.2·f1 as
    // the module does). LR4 = two cascaded 2-pole Butterworth TPT sections (bilinear, prewarped at the crossover):
    // |LP| = 1/(1 + Ω⁴), |HP| = Ω⁴/(1 + Ω⁴), Ω = tan(πf/fs)/tan(πfc/fs). L/M/H: low = LP(f1) (its freq2 allpass keeps the
    // magnitude), mid = HP(f1)·LP(f2), high = HP(f1)·HP(f2). M/S: both branches flat (0 dB). Floor −300 dB.
    // → [Float64Array(freqs.length) per branch], or null for another type
    function splitResponse(type, f1, f2, freqs, fs) {
      const t = typeof type === 'string' ? TYPES.indexOf(type) : +type;
      const nb = t === 13 || t === 15 ? 2 : t === 14 ? 3 : 0;
      if (nb === 0) return null;
      const n = freqs && freqs.length > 0 ? freqs.length | 0 : 0, out = [];
      for (let b = 0; b < nb; b++) out.push(new Float64Array(n));
      if (t === 15) return out;
      fs = fs > 0 ? +fs : 48000;
      const hi = 0.45 * fs, ny = 0.5 * fs, cl = (f) => (f > 10 ? (f < hi ? f : hi) : 10);
      const a = cl(+f1);
      let c = cl(+f2);
      if (c < 1.2 * a) c = cl(1.2 * a);
      const ta = tan(PI * a / fs), tc = tan(PI * c / fs);
      const dB = (g) => DB * log(g > 1e-15 ? g : 1e-15);
      for (let i = 0; i < n; i++) {
        const f = +freqs[i], w = tan(PI * (f > 0 ? (f < ny ? f : ny) : 0) / fs);
        let A = w / ta;
        A *= A; A *= A;
        const lpA = 1 / (1 + A), hpA = A / (1 + A);
        if (t === 13) { out[0][i] = dB(lpA); out[1][i] = dB(hpA); continue; }
        let Cc = w / tc;
        Cc *= Cc; Cc *= Cc;
        out[0][i] = dB(lpA); out[1][i] = dB(hpA / (1 + Cc)); out[2][i] = dB(hpA * Cc / (1 + Cc));
      }
      return out;
    }
    // re-export of SerumDSP.filterImpulse, resolved at call time (null without SerumDSP)
    function filterImpulse(type, fc, res, drive, vr, fs, len) {
      const S = globalThis.SerumDSP;
      return S && typeof S.filterImpulse === 'function' ? S.filterImpulse(type, fc, res, drive, vr, fs, len) : null;
    }

    globalThis.FXDSP = Object.freeze({
      VER, FIDX, LAW_TAB_FX, TYPES, S1_IDX, TAB, FXRack, distCurve, eqResponse, delayFilterResponse, splitResponse, MODFX_HZ,
      filterImpulse,
    });
  } catch (err) {
    globalThis.FXDSP = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('fx-dsp: load failed', err);
  }
})();
