/*
 * sx-spec.js — Spectral oscillator (classic script, no imports/exports; owner D5).
 * Contract: SPEC-serum2 §11.8 (the common oscillator contract), §6.10 (Spectral oscillator: streams, pool, staggered
 * FFTs, analysis reading, resynthesis, warps, filter), §6.7.1–§6.7.6 (regions, loop modes, slicing, unison START/SPAN),
 * §4.1 (the CP v2 fields read here), §4.5 (`spec` analysis entries), §3.9 (SPEC_N, hop per quality), §14.2 (stream pool
 * memory), §14.3 (qr.specHopMul, qr.specStreams), §11.10 (lazy warm-up), §0.3/§0.4 (script shape, lazy references, hot
 * paths), §0.8 sign-off items 1 (F/P warps through the warp delay line) and 15 (onset fade-in, staggered synthesis).
 *
 * Script #7 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Publishes the frozen `globalThis.SxSpec`; can be evaluated again in the same scope; a
 * failure inside leaves SxSpec = null without throwing (then Spectral oscillators are silent, §0.3). Reads `SxBase`
 * lazily (in `apply`, cached in a field): OTYPE, DIDX2, WARP_DOM, getAsset / epoch, FFT, HBUp, HBDown, warmAdd. Without
 * SxBase every oscillator stays silent (one console.warn per scope). Reads `SxWarp` lazily (in `apply`) for the F-, P- and
 * O-domain warps of §6.10.7 (Slots, chunk, incBlock, pdBlock, phaseBlock, outBlock — every warp law is SxWarp's; each
 * stream passes its unison index as the modulator column); without it those slots act as Off (one console.warn per scope,
 * §0.3, as on every oscillator type; the spectral warps 58–81 are SxSpec's own and keep working). Reads no other script's
 * global.
 *
 * API (§11.8; [+] = beyond the §11.8 list):
 *   VER 1 · MAXCH 32 (OL/OR/RAW stride) · MAXUNI 16 · NSL 258 (CP.sSlPos stride) · [+] MAXSTREAMS 64 (qr.specStreams cap)
 *   [+] K   frozen offsets of the oscillator's O2 destination block (§3.11.2; vi = vi(k.w1) + K.NAME), as SxSample.K
 *   [+] specN(base) → 2048 (base ≤ 48 kHz) | 4096 (§3.9 SPEC_N)
 *   [+] hopOf(N, q, mul) → synthesis hop: N·mul/(2q) for the quality q = CP.os (Draft 1 → N/2, High 2 → N/4, Ultra 4 →
 *       N/8) and mul = qr.specHopMul (1|2|4, §14.3), clamped to [N/8, N/2] (IMPL)
 *   [+] slotOf(si, H) → the stagger offset (base samples within a hop) at which stream si synthesises its frames
 *   [+] prep(base) → boolean   (M4 performance) builds the scope's read-only tables of specN(base) at base and
 *       SxBase.FFT(N) once — serum-dsp's construction-time warmUp calls it, so the first Spectral 'patch' of a session
 *       does not build them on the audio thread (≈ 1 ms cold); false without SxBase
 *   [+] class Pool          the processor-level stream pool (§6.10.1), stored by SxSpec in `sx.specPool` (D1: the field
 *                           name is SxSpec's): fields n (streams usable), N, os, base, gen (+1 when N, os or the base
 *                           rate change: every stream is rebuilt and holders forget their indices), st (Stream states),
 *                           nCapped (oscillators holding fewer streams than unison voices), frames (frames synthesised,
 *                           a counter for tests and the bench), need (the buffers some apply asked for), fft
 *                           (SxBase.FFT(N)), re/im (Float64Array(N/2 + 1)) and x (Float64Array(N)) shared synthesis
 *                           scratch, plus the shared per-bin tables and frame scratch (analysis bins sized for N_a 2048,
 *                           §9.4.6); setup(B, n, N, os, base, W, need) (allocation; need = the NEED_* bits below, absent =
 *                           all), take() → stream index | −1 (lowest free index), give(k), bytes(). A Stream holds ola
 *                           (Float32Array(N + N/2), the overlap-add ring), ph (Float32Array(N/2 + 1), synthesis phases),
 *                           up (SxBase.HBUp(os)) and, allocated in setup only when some apply's patch can use them (§14.2;
 *                           needOf: the slots' base modes, every mode when the mode destination is modulated, CP.modded),
 *                           line + sl (Float32Array of 50 ms at the OS rate, the §6.10.7 warp delay line, and
 *                           SxWarp.Slots(1): F/P/O-domain modes, SxWarp loaded), u0/u1 (Float32Array(N) per slot: the
 *                           Smear state Z (first N/2 + 1 values) or the slot's base-rate Vocode/Mask modulator ring), dn0/
 *                           dn1 (SxBase.HBDown(os) per slot: Vocode/Mask); a buffer is never freed before a rebuild; bytes
 *                           (≤ 54 KB with every buffer at N 2048, OS 2; the pool incl. its shared scratch stays ≤ 64 KB ×
 *                           n for n = 32 with every buffer and for n = 16 unless a warp-mode destination is modulated)
 *   [+] poolOf(sx) → Pool | null      [+] capOf(sx) → 0 | 1 (snapshot `specCap`, §6.20: some note found the pool empty
 *                                         and still sounds with fewer streams than unison voices)
 *   class SpecOsc(voice, o)   (Spectral, OTYPE 4) — holds only stream indices and per-note scalars (no audio buffers)
 *     apply(cp, o, qr) → boolean   copies the CP v2 fields of oscillator o. Returns false — and the oscillator is silent —
 *                                  when the CP shapes are invalid (one console.warn per scope), when SxBase is missing,
 *                                  or for o outside 0–2; true otherwise (also when the CP selects another type for o:
 *                                  `sel` = 0, held streams are returned). When the type is selected: the per-voice option
 *                                  arrays are allocated on the first such apply, and the processor's pool
 *                                  (voice.proc.sx.specPool) is created or resized to qr.specStreams streams at
 *                                  N = specN(proc.base), os = proc.fs/proc.base; a live processor also queues the lazy
 *                                  FFT warm-up (SxBase.warmAdd key 'sx-spec'). IMPL (M4 performance, §14.1): on a live
 *                                  processor the 'patch' message builds at most GROW0 (8) new streams (≈ 60 KB each:
 *                                  32 of them cost ≈ 2.5 ms of the audio thread) and a lazy job (key 'sx-spec-grow:…')
 *                                  adds GROW_STEP (4) per quantum up to the target (Pool.nT); until then notes take what
 *                                  the pool has (the capped-stream path). Offline processors build every stream at
 *                                  once. `qr` = Float64Array(5) caps or null for CP.qr
 *     noteOn(ctx, fresh, legato)   ctx = OscCtx (§11.8); a non-legato note returns the held streams and takes one per
 *                                  unison voice (ctx.N, ≤ 16) — fewer when the pool runs empty (`capped`, pool.nCapped);
 *                                  it reads the note-on values k.sstart, k.slice, k.ustart, k.uspan from ctx.eff, the
 *                                  pitch reference ctx.keyRef (slice ρ, scan key track) and the played key ctx.key (else
 *                                  voice.note; it picks the slice), and draws 2·ctx.N values from the voice's r2 stream
 *                                  (voice.rnd2(), §6.2): the START randoms u_i, then the Detune seeds. A legato note on a
 *                                  sounding oscillator keeps streams, playheads and phases; one that has played out (One-
 *                                  shot end) or holds no stream restarts like a non-legato note. (M4) A note that
 *                                  restarts resolves the analysis entry when the asset epoch changed (as render would in
 *                                  its first chunk: render's path then stays for an asset arriving later — V8 deoptimised
 *                                  the optimised render when a first chord took it)
 *     noteOff()                    gate off (Exit Loop on Release)
 *     render(ctx, OL, OR, RAW)     writes ctx.CH samples into OL/OR (Float64Array(32), overwritten, not added) and, when
 *                                  RAW (Float64Array(16·32)) is not null, ctx.N unison rows of raw mono output (post
 *                                  warps, pre level/pan) at [i·32 + s]. Resolves the analysis entry when the asset
 *                                  epoch changed (missing ⇒ silence, audible within one chunk after it arrives, §4.5);
 *                                  forgets streams of a rebuilt pool
 *     kill()                       returns the streams to the pool, clears the note state (the voice calls it when it
 *                                  ends, §6.19, so streams go back at once)
 *     active() → bool              true from noteOn until kill, false once every stream of a One-shot region has
 *                                  played out (its streams then go back to the pool)
 *     grains() → 0
 *     fields read by the voice/snapshot (read-only): sel, ok, [+] e (resolved entry or null), [+] nS (streams held),
 *     [+] si (Int16Array(16) stream indices, −1 unused), [+] capped (0/1), [+] N, H (synthesis size and hop),
 *     [+] mPos, mS, mLS, mLE (read position — Manual X|Y: pos + Δ₀ —, S, LS, LE of stream 0 as fractions of the analysed
 *     length, snapshot smpPos)
 *
 * Signal path per stream (one phase-vocoder stream per unison voice, §6.10.1–§6.10.4; normative where §6.10 is, IMPL
 * where marked):
 *   playhead   region coordinates q ∈ [0, |E − S|] from S toward E (E < S plays backwards), loop modes of §6.7.3 per
 *              synthesis frame (One-shot, Fwd, Rev, Fwd/Rwd, Tailed; Exit on Release; LE < LS swaps Fwd ↔ Rev, IMPL; a
 *              negative σ at note-on starts at the region end and mirrors the modes as SxSample does, IMPL),
 *              loop crossfade (§6.7.4) on magnitudes, slicing (§6.7.5), START/SPAN (§6.7.6), Manual X|Y (pos·L + Δ_i).
 *              Frame k is centred at output time kH + N/2 and reads the analysis at q_on + σ·max(0, centre)·srate/base
 *              (no latency: y(t) ≈ x(S + σt)); later frames advance by σ·H·srate/base (σ of §6.9.1 / Length to BPM).
 *              The crossfade fades toward the wrap the playhead travels to (forward: at b toward q − len with the room
 *              before a; backward: at a toward q + len with the room after b; Tailed forward toward q − Lr/2, backward
 *              after a backward start toward q + Lr/2), as SxSample. A held read (Manual X|Y, σ = 0) is clamped onto
 *              analysis frames whose window pair lies inside the sample (IMPL: a frame overlapping the zero padding,
 *              resynthesised every hop, beats); short samples read their centre frame
 *   analysis   magnitudes interpolated between frames ⌊P⌋, ⌈P⌉; instantaneous frequency κ of §6.10.2
 *   pitch      IMPL (deviation from the literal §6.10.3 bin formula, identical at ρ = 1): the analysis spectrum is cut into
 *              peak regions (each local maximum with the bins up to the minima on either side; a region whose peak is
 *              not a resolved sinusoid — |κ_p − p| > 1 bin, a window sidelobe or a hop-aliased frequency — within 8 bins
 *              and 20 dB below a resolved neighbour is merged into it); a region keeps its shape and moves by (s − 1)·c
 *              bins (c = κ_p, or p + the parabolic offset when unresolved; s = ρ·srate·N_s/(N_a·base)), its bins carry
 *              F = s·κ. A fractional move re-renders a resolved sinusoid's lobe (±4 bins) as the Hann kernel at its new
 *              centre and resamples the rest (Catmull-Rom over the whole spectrum, the moved regions tile the output),
 *              keeping the −π/bin phase slope of a frame-start-referenced lobe. Stretching the magnitudes by ρ (the
 *              literal formula) would shrink the synthesis window by 1/ρ and amplitude-modulate the output at the hop
 *              rate (gaps from ρ ≥ 4)
 *   frame      (1) Lo/Hi unless Post Warp, (2) spectral filter (CT.specFilt, CUT, MIX), (3) S-domain slots 1, 2 (§6.10.5;
 *              frequency-moving modes move or copy whole peak regions, IMPL), (4) Lo/Hi if Post Warp, (5) phases
 *              (φ_j += 2π·F_j·H/N_s; first frame and transient resets from the analysis phases; identity locking, IMPL:
 *              on frames reading an edge of the analysis, the first frame after them (so an edge-initialised start or
 *              wrap does not keep the edge frames' lobe phase relations at fast scans) and whenever regions moved — ρ ≠
 *              the root ratio, moving spectral warps — every bin of a region takes its peak's propagated phase plus the
 *              analysis phase
 *              difference, φ_j = φ_q + (P0_j − P0_q), so moved partials neither beat nor lose vertical coherence; Phase
 *              Lock per §6.10.3 on the same merged regions, φ_q + π·(j − q) within the Hann main lobe |j − q| ≤ 2 and the
 *              analysis relation on the sidelobes beyond, IMPL; Phase Twist as a per-frame offset, IMPL), inverse real
 *              FFT, synthesis window w/Σw² (Hann, any hop), overlap-add
 *   timing     frame k is synthesised during hop k − 1 at the stream's stagger offset slotOf(si, H) (sign-off 15; the
 *              offset spreads streams over the whole hop by a 6-bit bit reversal of the stream index, IMPL — the engine's
 *              chunk is 4 base samples, so (si·CH mod H)/CH would put up to 128 streams in one render quantum).
 *              Onset (sparse pre-roll, IMPL deviation from §6.10.1's N/H − 1 pre-roll frames, ratified by
 *              RULINGS2): the first hop synthesises 3 frames at every quality — kp = −N/(2H) (centred at the note-on), 0
 *              and 1 — at (j·H + slot)/3, j = 0, 1, 2 (one frame per chunk at most), so a chord's first hop costs 3× the
 *              steady load instead of N/H + 1 (5× High, 9× Ultra); while the missing frames −R … −1 would overlap (t <
 *              (N/H − 1)·H) the output is normalised by the window sum of the frames present, C/D(t) with C = Σw² of
 *              the full overlap. The frames kp and 0, synthesised after their start, are ramped in from their synthesis
 *              time to the end of the first hop (raised cosine), which is the onset fade-in (no frame enters with a
 *              step). A guard synthesises a late frame before it is read (onset frames by the last chunk of the hop)
 *   output     base rate → OS rate (SxBase.HBUp), then the F/P-domain warps through the warp delay line (§6.10.7: base
 *              delay D₀ = min(25 ms, 2·T₀) fixed at the first chunk, Δ from SxWarp.phaseBlock (P shapes, on θ), pdBlock
 *              (PD, Δ = offset·T₀), Slots.pdI (PD (Self), fed back per sample from the previous raw line read) and
 *              incBlock with inc = 1 (FM: Δ = the 5 Hz-leaky integral of g(m) − 1), clamped to ±(D₀ − 2 samples),
 *              4-point Hermite reads; a mode selected at note-on delays from the first sample, the 10 ms crossfade is for
 *              modes that appear or vanish later — while it fades out after the last F/P mode was cleared, that mode
 *              keeps shaping the delayed read, IMPL), then the O-domain warps per stream (SxWarp.outBlock; Odd/Even's
 *              second read = the line half a period away through the same delay, Sync window and crossfade, passed to
 *              both slots; Flip and the Sync window use the stream's fundamental phase θ = ∫ f_i dt), then × sNorm
 *              (1/peak), the unison gain ramps. SxWarp.chunk runs once per slot per chunk with the slot's mode for the
 *              stream (its F/P mode, else its O mode, else Off), so filter and Stomp Box states run on across chunks; a
 *              slot whose last F/P mode is still fading out starts a newly selected O mode when the fade ends (≤ 10 ms)
 *   X|Y        Y (eff k.gy, modes Add/Replace/Scale of §3.9) acts here on Spec Flt Cutoff (k.cut), Wet/Dry (k.smix),
 *              Freq Lo and Freq Hi. Level, Warp and Warp 2 are the voice's (as for Granular: Y on the eff level before
 *              its gain ramp, on the base amounts before the unison spread; serum-dsp must extend its Granular X|Y gate
 *              to Spectral, D1) — SxSpec never applies them
 *   Vocode/Mask per slot: the slot's own modulator (raw OS-rate output) is decimated (SxBase.HBDown) into the slot's
 *              base-rate ring every chunk while the slot holds such a mode, and its STFT (Hann over the last N_s
 *              samples) is taken per frame — for Spectral modulators too (IMPL: §6.10.5 reads a Spectral modulator's
 *              current frame); two such slots on the same modulator array share slot 1's ring and its spectrum. A slot
 *              at amount 0 is bit-identical to Off. Vocoder bands: 24 one-third-octave bands at 80·2^(b/3) Hz (IMPL)
 *   root       ρ = f_i / (440·2^((root + ctx.rootShift − 69)/12)) with root = the analysis entry's own `root` (IMPL
 *              extension of §4.5, to be produced by S1: the analysed record's root, 18.232 for wtsmp), else 60. Ids are
 *              opaque: no other entry is consulted, so the pitch never depends on what else is stored; root and peak are
 *              taken per entry object (a new entry restarts the streams)
 *
 * CP v2 fields read (§4.1; checked by type and length in apply): ver 2, os (1|2|4|8), base (429), oType, bendTrack (3),
 *   fmType (6), qr (5), spec (Array(3) of strings), sLoop, sRel, sLink, sExit, sScanKey, sScanLock, sLenOn, sSlMode,
 *   sSlEnd, sSlOne, sSlRoot, sPhLock, sTrans, sSmooth, sPostWarp, sNorm, sRev, xyOn, xyY, xyMode (Uint8Array(3)),
 *   sSlN (Uint16Array(3)), sSlPos (Float64Array(3·258)), sScanR (Float64Array(3)), lenLad (Float64Array(15)).
 *   CT `specFilt` (Float32Array(3·513)) is read at render from ctx.sx.CT (flat 1 when absent), CT `remap` from
 *   ctx.sx.remap (identity when absent). For the lazy stream buffers apply also reads base (the slots' mode n), modded
 *   (Uint8Array(429); absent or malformed ⇒ every mode possible), use (bit 4: slot 2) and s1 (A/B slot 1 legacy warps).
 *
 * Hot paths (noteOn, noteOff, render, kill, active, grains, Pool take/give) never allocate; patch values are copied in
 * apply into numeric fields and the instance's own typed arrays, never read from the CP object while rendering.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const MAXCH = 32, MAXUNI = 16, NSL = 258, MAXSTREAMS = 64;
    const T_SPEC = 4;                                         // OTYPE code (= serum-core OSC_TYPES), checked against SxBase
    const NLAD = 15;
    const PI = Math.PI, TWO_PI = 2 * PI, floor = Math.floor, round = Math.round, sqrt = Math.sqrt, exp = Math.exp,
      log = Math.log, pow = Math.pow, cos = Math.cos, sin = Math.sin, mlog2 = Math.log2;
    const MIDI0 = 440 * pow(2, -69 / 12);                     // 8.1758 Hz: the k.flo / k.fhi law floor (exp MIDI0…22050)
    const LN_F = log(22050 / MIDI0);
    const LINE_SEC = 0.05;                                    // warp delay line: 2·D0_MAX (§6.10.7: ≤ 50 ms at the OS rate)
    const XF_SEC = 0.01, D0_MAX = 0.025, FM_LEAK = TWO_PI * 5;
    const NA_MAX = 2048;                                      // the analysis N the frame scratch holds (§9.4.6: N_a = 2048)
    // per-stream buffers a patch may need (Pool.need, from apply; allocated lazily, never shrunk, §14.2)
    const NEED_LINE = 1, NEED_U0 = 2, NEED_U1 = 4, NEED_D0 = 8, NEED_D1 = 16, NEED_ALL = 31;
    const NBAND = 24, BAND_F0 = 80;                           // Vocode: 24 one-third-octave bands from 80 Hz (IMPL)
    const PEAK_FLOOR = 1e-6;                                  // peaks below max·1e-6 (−120 dB) do not open a region
    const PEAK_THR = 1e-2;                                    // Peak Octave / Harm: peaks above max·10^(−2) (§6.10.5)
    const MERGE_BINS = 8, MERGE_REL = 0.1;                    // sidelobe regions merged into their lobe (IMPL, mergeRegions)

    // O2 destination block of one oscillator, in §3.11.2 builder order (vi = vi(k.w1) + offset)
    const O2 = ['w1', 'w2', 'warp2', 'wvar1', 'wvar2', 'uniwarp2', 'ratio', 'hz', 'sstart', 'send', 'lstart', 'lend', 'xfade',
      'scan', 'scanrev', 'pos', 'slice', 'gy', 'dens', 'glen', 'wamt', 'wskew', 'roff', 'rdir', 'rpitch', 'rlen', 'rpan', 'rlvl',
      'rwamt', 'rwskew', 'rwarp', 'rwarp2', 'grev', 'flo', 'fhi', 'cut', 'smix', 'mdly', 'matt', 'mhold', 'mdec', 'msus', 'mrel',
      'mvel', 'mrand', 'timbre', 'ustart', 'uspan', 'fbal', 'bus1', 'bus2'];
    const k = {};
    for (let i = 0; i < O2.length; i++) k[O2[i].toUpperCase()] = i;
    const K = Object.freeze(k);
    const OSC_LETTER = ['A', 'B', 'C'];

    // WARPS2 index ranges used here (§3.4.1; the domain table itself is SxBase.WARP_DOM)
    const W_FM0 = 33, W_FM1 = 38, W_PD0 = 39, W_PDSUB = 42, W_PDSELF = 45, W_PD1 = 45, W_ODDEVEN = 16;
    const S_COMB = 58, S_GATE = 59, S_HARM = 60, S_SUBH = 61, S_SPREAD = 62, S_SMEAR = 63, S_DETUNE = 64, S_PKOCTU = 65,
      S_PKOCTD = 66, S_PKHARMU = 67, S_PKHARMD = 68, S_SHEP = 69, S_SHEPN = 70, S_VOC0 = 71, S_VOC1 = 73, S_MASK0 = 74,
      S_MASK1 = 76, S_MIRROR = 77, S_PSHIFT = 78, S_PBLEND = 79, S_SHIFT = 80, S_TWIST = 81;
    const D_F = 1, D_P = 2, D_O = 3, D_S = 4;                 // SxBase.WDOM codes (checked in prologue)

    /* ------------------------------------------------------------ one-time warnings (per scope) */
    let warnedBase = false, warnedCP = false, warnedCH = false, warnedNA = false, warnedWarp = false;
    function warn(what) {
      if (typeof console !== 'undefined') console.warn('sx-spec: ' + what);
    }
    function sxBase() {
      const B = globalThis.SxBase;
      if (B && typeof B === 'object' && typeof B.getAsset === 'function' && B.DIDX2 && B.OTYPE && typeof B.FFT === 'function'
        && typeof B.HBUp === 'function' && typeof B.HBDown === 'function' && B.WARP_DOM) return B;
      if (!warnedBase) { warnedBase = true; warn('SxBase is missing: Spectral oscillators are silent'); }
      return null;
    }
    function sxWarp() {                                        // optional (P/O-domain warps act as Off without it)
      const W = globalThis.SxWarp;
      return W && typeof W === 'object' && typeof W.Slots === 'function' && typeof W.chunk === 'function'
        && typeof W.phaseBlock === 'function' && typeof W.outBlock === 'function' ? W : null;
    }
    function badCP(why) {
      if (!warnedCP) { warnedCP = true; warn('CP not understood (' + why + '): Spectral oscillators are silent'); }
      return false;
    }

    /* ------------------------------------------------------------ sizes (§3.9, §14.3) */
    function specN(base) { return base > 48000 ? 4096 : 2048; }
    function hopOf(N, q, mul) {
      let h = Math.round(N * (mul > 0 ? mul : 1) / (2 * (q > 0 ? q : 1)));
      const lo = N >> 3, hi = N >> 1;
      if (!(h >= lo)) h = lo;                                   // NaN → N/8
      if (h > hi) h = hi;
      return h;
    }
    function osOf(fs, base) {                                   // OS factor of a processor: a power of two in [1, 16]
      const r = fs > 0 && base > 0 ? fs / base : 1;
      let os = 1;
      while (os < 16 && os * 1.5 < r) os <<= 1;
      return os;
    }
    // stagger offset of stream si within a hop H (H a multiple of 64): the 6-bit bit reversal of si spreads any 2^m
    // consecutive stream indices evenly over the hop
    function slotOf(si, H) {
      let x = si & 63, r = 0;
      for (let b = 0; b < 6; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      return floor(r * H / 64);
    }
    const modp = (x, m) => x - m * floor(x / m);               // x mod m in [0, m)

    /* ------------------------------------------------------------ sine table for the frame synthesis (IMPL, < 3e-7) */
    const SC_N = 4096, SC_Q = SC_N >> 2, SC_K = SC_N / TWO_PI;
    const SC = new Float64Array(SC_N + SC_Q + 2);
    for (let i = 0; i < SC.length; i++) SC[i] = sin(TWO_PI * i / SC_N);
    SC[SC_N >> 1] = 0; SC[SC_N] = 0; SC[SC_Q] = 1; SC[SC_N + SC_Q] = 1;

    /* ------------------------------------------------------------ one stream (§6.10.1, §14.2) */
    class Stream {
      constructor(B, N, os, fs) {
        const nb = (N >> 1) + 1;
        this.N = N; this.nb = nb; this.OL = N + (N >> 1); this.LL = Math.ceil(LINE_SEC * fs) + 8;
        this.ola = new Float32Array(this.OL);
        this.ph = new Float32Array(nb);
        this.up = new B.HBUp(os);
        // allocated by Pool.fit (apply) only when the patch can use them (§14.2):
        this.line = null; this.sl = null;                        // warp delay line, SxWarp.Slots(1): F/P/O-domain warps
        this.u0 = null; this.u1 = null;                          // per slot: Smear state (nb) or Vocode/Mask modulator ring (N)
        this.dn0 = null; this.dn1 = null;                        // per slot: the ring's decimator (SxBase.HBDown)
        // note state (start())
        this.i = 0; this.t = 0; this.k = 0; this.kp = -1; this.kl = -1; this.H = N >> 2; this.R = 3; this.slot = 0;
        this.q = 0; this.pd = 1; this.inL = 0; this.tb = 0; this.end = 0; this.sil = 0; this.done = 0; this.first = 1; this.lastTr = -1;
        this.zOn0 = 0; this.zOn1 = 0; this.seed = 1; this.dlt = 0; this.cen = 0; this.pa = 0; this.pav = 0; this.edg = 0;
        this.th = 0; this.d0 = -1; this.dmix = 0; this.lw = 0; this.y1 = 0; this.fz0 = 0; this.fz1 = 0;
        this.rw0 = 0; this.rw1 = 0; this.rk0 = 0; this.rk1 = 0;   // ring write indices; what u0/u1 hold (0 zeros, 1 Smear, 2 ring)
        this.lm1 = 0; this.lm2 = 0;                              // the last F/P-domain modes (shape the line while it fades out)
        this.lh = 0; this.fon = 440;                             // line history (samples; a line added mid-note fills first), f_i at note-on
        this.bytes = 0;
        this.count();
      }
      count() {
        let b = this.ola.byteLength + this.ph.byteLength + this.up.bytes;
        if (this.line !== null) b += this.line.byteLength;
        if (this.sl !== null) b += this.sl.bytes;
        if (this.u0 !== null) b += this.u0.byteLength;
        if (this.u1 !== null) b += this.u1.byteLength;
        if (this.dn0 !== null) b += this.dn0.bytes;
        if (this.dn1 !== null) b += this.dn1.bytes;
        this.bytes = b;
      }
      // fresh note: clear every buffer and state (allocation-free). Frames: kp = −N/(2H) (centred at the note-on), then
      // 0, 1, 2, … (sparse pre-roll, IMPL: frames −R … −1 other than kp are not synthesised, the onset hops are
      // normalised by the window sum of the frames present, renderStream)
      start(i, H, si, seed) {
        this.ola.fill(0); this.ph.fill(0);
        if (this.line !== null) this.line.fill(0);
        if (this.u0 !== null) this.u0.fill(0);
        if (this.u1 !== null) this.u1.fill(0);
        this.up.reset();
        if (this.dn0 !== null) this.dn0.reset();
        if (this.dn1 !== null) this.dn1.reset();
        if (this.sl !== null) this.sl.reset();
        const R = this.N / H - 1, kp = -((R + 1) >> 1);
        this.i = i; this.t = 0; this.H = H; this.R = R; this.kp = kp; this.k = kp; this.kl = kp - 1; this.slot = slotOf(si, H);
        this.q = 0; this.pd = 1; this.inL = 0; this.tb = 0; this.end = 0; this.sil = 0; this.done = 0; this.first = 1; this.lastTr = -1;
        this.zOn0 = 0; this.zOn1 = 0; this.seed = seed >>> 0 || 1; this.dlt = 0; this.pa = 0; this.pav = 0; this.edg = 0;
        this.cen = kp * H + (this.N >> 1);                     // centre time of the next frame (base samples since note-on): 0
        this.th = 0; this.d0 = -1; this.dmix = 0; this.lw = 0; this.y1 = 0; this.fz0 = 0; this.fz1 = 0;
        this.rw0 = 0; this.rw1 = 0; this.rk0 = 0; this.rk1 = 0;
        this.lm1 = 0; this.lm2 = 0;
        this.lh = this.LL; this.fon = 440;                       // before the note-on the stream was silent: a full history
      }
    }

    /* ------------------------------------------------------------ stream pool (§6.10.1, §14.2) */
    const GROW0 = 8, GROW_STEP = 4;                           // streams a live 'patch' builds at once / per lazy step
    // read-only tables of an analysis size N at base rate base (never written after this): synthesis windows
    // w(n)/Σ_m w²(n + m·h) for h = N/2, N/4, N/8 (periodic Hann; overlap-add normalisation 1/Σw²), the per-bin tables (bin
    // centre f_j = j·base/N) and the identity remap row
    const TABS = new Map();
    function tablesOf(N, base) {
      const key = N + ':' + base;
      let T = TABS.get(key);
      if (T !== undefined) return T;
      const nb = (N >> 1) + 1, F64 = (n) => new Float64Array(n);
      const hann = F64(N), ws = F64(3 * N);
      for (let n = 0; n < N; n++) hann[n] = 0.5 - 0.5 * cos(TWO_PI * n / N);
      for (let c = 0; c < 3; c++) {
        const h = N >> (c + 1), b = c * N;
        for (let n = 0; n < N; n++) {
          let d = 0;
          for (let r = n % h; r < N; r += h) d += hann[r] * hann[r];
          ws[b + n] = d > 0 ? hann[n] / d : 0;
        }
      }
      const xF = F64(nb), shC = F64(nb), shS = F64(nb), vb = F64(nb);
      const L1000 = log(1000);
      for (let j = 0; j < nb; j++) {
        const f = j * base / N;
        const l2 = j > 0 ? mlog2(f / 20) : -64;
        xF[j] = j > 0 ? log(f / 20) / L1000 : -64;
        shC[j] = cos(TWO_PI * l2); shS[j] = sin(TWO_PI * l2);
        const v = j > 0 ? 3 * mlog2(f / BAND_F0) : 0;
        vb[j] = v > 0 ? (v < NBAND - 1 ? v : NBAND - 1) : 0;
      }
      const remap = new Float32Array(2049);
      for (let j = 0; j <= 2048; j++) remap[j] = j / 2048;
      T = { hann, ws, xF, shC, shS, vb, remap };
      TABS.set(key, T);
      return T;
    }
    class Pool {
      constructor() {
        this.n = 0; this.N = 0; this.os = 0; this.base = 0; this.gen = 0;
        this.nT = 0;                                             // target streams (n grows to it: Pool.grow, lazy job)
        this.B = null; this.W = null;                            // SxBase and SxWarp of the last setup (grow builds with them)
        this.need = 0;                                           // NEED_* bits of every apply so far (buffers never shrink)
        this.st = [];
        this.busy = new Uint8Array(MAXSTREAMS);
        this.free = new Int16Array(MAXSTREAMS); this.nFree = 0;   // descending: free[nFree − 1] is the lowest index
        this.nCapped = 0;
        this.frames = 0;                                         // frames synthesised (tests, bench)
        this.fft = null; this.re = null; this.im = null; this.x = null;
        this.warm = 0;                                           // warm-up steps done (warmJob)
        this.nbA = (NA_MAX >> 1) + 1;
        this.A = null; this.KF = null; this.PA = null;            // analysis bins: magnitude, inst. frequency, phase
        this.M = null; this.F = null; this.P0 = null; this.Wt = null;   // output bins: magnitude, frequency (bins), phase0, weight
        this.M2 = null; this.F2 = null; this.P2 = null; this.W2 = null;
        this.PK = null; this.LO = null; this.HI = null; this.RG = null;  // peak regions, merge targets
        this.LK = null; this.LK2 = null;                         // lock bin per output bin (−1 none), its snapshot
        this.Mm = null; this.EB = null; this.EM = null; this.BW = null;  // Vocode / Mask
        this.ws = null; this.hann = null;                        // synthesis windows (hops N/2, N/4, N/8), Hann
        this.xF = null; this.shC = null; this.shS = null; this.vb = null;   // per-bin tables
        this.yb = null; this.xo = null; this.dl = null; this.ph = null; this.win = null; this.x2 = null; this.mg = null;
        this.dm = null; this.one = null; this.gm = null; this.pdo = null;
        this.w1a = null; this.fia = null; this.remap = null;
        this.ph0 = 0;                                            // phase offset factor of a (re)started frame (synth → build)
        this.edge = 0;                                           // 1: the frame reads an edge of the analysis (synth → build)
        this.mv = 0;                                             // 1: the frame's peak regions were moved (synth → build)
        this.lk1 = 0;                                            // 1: identity-lock this frame once (first clean frame after edges)
        this.fp = 0; this.ah = 0.25;                             // readFrame: fractional part of the phase read, hop_a/N_a
        this.mmK = -1;                                           // ring whose spectrum Mm holds for the current frame (−1 none)
      }
      // allocation allowed (apply): n streams usable at analysis size N, OS factor os, base rate base; need = NEED_* bits of
      // the buffers the caller's patch can use (added to the pool's; a buffer is never freed before a rebuild)
      // allocation allowed (apply): n streams usable at analysis size N, OS factor os, base rate base; need = NEED_* bits of
      // the buffers the caller's patch can use (added to the pool's; a buffer is never freed before a rebuild); at most
      // `cap` new streams are built now (default: all) — grow() adds the rest
      setup(B, n, N, os, base, W, need, cap) {
        n = n >= 1 ? (n < MAXSTREAMS ? Math.floor(n) : MAXSTREAMS) : 1;
        base = base > 0 ? +base : 48000;
        if (W === undefined) W = null;
        if (N !== this.N || os !== this.os || base !== this.base) {   // rate or size change: rebuild every stream
          this.gen++; this.N = N; this.os = os; this.base = base;
          this.st.length = 0; this.busy.fill(0); this.nCapped = 0;
          this.alloc(B, N, base);
        }
        this.B = B; this.W = W; this.nT = n;
        this.need |= need === undefined ? NEED_ALL : need & NEED_ALL;
        const fs = base * os;
        let k = cap >= 0 ? cap : MAXSTREAMS;
        while (this.st.length < n && k-- > 0) this.st.push(new Stream(B, N, os, fs));
        for (let i = 0; i < this.st.length; i++) this.fit(B, W, this.st[i], N, os);
        this.usable();
        return this;
      }
      // n = the streams built so far up to the target; the free list (descending) of the usable streams
      usable() {
        const n = this.st.length < this.nT ? this.st.length : this.nT;
        this.n = n;
        let f = 0;
        for (let i = n - 1; i >= 0; i--) if (this.busy[i] === 0) this.free[f++] = i;
        this.nFree = f;
      }
      // allocation allowed (a lazy warm-up step, never inside a render): up to k more streams towards nT → true while some
      // are still missing
      grow(k) {
        if (this.B === null || this.N === 0) return false;
        const fs = this.base * this.os;
        let j = 0;
        while (this.st.length < this.nT && j++ < k) {
          const st = new Stream(this.B, this.N, this.os, fs);
          this.fit(this.B, this.W, st, this.N, this.os);
          this.st.push(st);
        }
        this.usable();
        return this.st.length < this.nT;
      }
      // the lazily allocated buffers of one stream (apply): the warp line and Slots need SxWarp (without it F/P/O-domain
      // slots act as Off, §0.3); a buffer added to a sounding stream starts empty
      fit(B, W, s, N, os) {
        const nd = this.need;
        if ((nd & NEED_LINE) !== 0 && W !== null && s.line === null) { s.line = new Float32Array(s.LL); s.sl = new W.Slots(1); s.lh = 0; }
        if ((nd & NEED_U0) !== 0 && s.u0 === null) s.u0 = new Float32Array(N);
        if ((nd & NEED_U1) !== 0 && s.u1 === null) s.u1 = new Float32Array(N);
        if ((nd & NEED_D0) !== 0 && s.dn0 === null) s.dn0 = new B.HBDown(os);
        if ((nd & NEED_D1) !== 0 && s.dn1 === null) s.dn1 = new B.HBDown(os);
        s.count();
      }
      alloc(B, N, base) {
        const nb = (N >> 1) + 1, nbA = this.nbA, F64 = (n) => new Float64Array(n);
        this.fft = new B.FFT(N);
        this.re = F64(nb); this.im = F64(nb); this.x = F64(N);
        this.A = F64(nbA); this.KF = F64(nbA); this.PA = F64(nbA);
        this.M = F64(nb); this.F = F64(nb); this.P0 = F64(nb); this.Wt = F64(nb);
        this.M2 = F64(nb); this.F2 = F64(nb); this.P2 = F64(nb); this.W2 = F64(nb);
        const nr = nbA > nb ? nbA : nb;
        this.PK = new Int32Array(nr); this.LO = new Int32Array(nr); this.HI = new Int32Array(nr); this.RG = new Int32Array(nr);
        this.LK = new Int32Array(nb); this.LK2 = new Int32Array(nb);
        this.Mm = F64(nb); this.EB = F64(NBAND); this.EM = F64(NBAND); this.BW = F64(NBAND);
        // the read-only tables of (N, base), shared by every pool of the scope (built once: ≈ 0.7 ms of a cold 'patch')
        const T = tablesOf(N, base);
        this.hann = T.hann; this.ws = T.ws; this.xF = T.xF; this.shC = T.shC; this.shS = T.shS; this.vb = T.vb;
        // chunk scratch (base rate ≤ 32, OS rate ≤ MAXCH)
        this.yb = F64(MAXCH); this.xo = F64(MAXCH); this.dl = F64(MAXCH); this.ph = F64(MAXCH); this.win = F64(MAXCH);
        this.x2 = F64(MAXCH); this.mg = F64(MAXCH); this.dm = F64(MAXCH); this.gm = F64(MAXCH); this.pdo = F64(MAXCH);
        this.one = F64(MAXCH).fill(1); this.w1a = F64(1); this.fia = F64(1);
        this.remap = T.remap;                                    // identity remap row (CT.remap absent)
      }
      take() {
        if (this.nFree === 0) return -1;
        const i = this.free[--this.nFree];
        this.busy[i] = 1;
        return i;
      }
      give(i) {
        if (!(i >= 0 && i < this.st.length) || this.busy[i] === 0) return;
        this.busy[i] = 0;
        if (i >= this.n) return;                                 // retired by a smaller qr.specStreams
        const F = this.free;
        let j = this.nFree;
        while (j > 0 && F[j - 1] < i) { F[j] = F[j - 1]; j--; }
        F[j] = i;
        this.nFree++;
      }
      bytes() {
        let b = this.busy.byteLength + this.free.byteLength;
        const sh = [this.re, this.im, this.x, this.A, this.KF, this.PA, this.M, this.F, this.P0, this.Wt, this.M2, this.F2,
          this.P2, this.W2, this.PK, this.LO, this.HI, this.RG, this.LK, this.LK2, this.Mm, this.EB, this.EM, this.BW, this.ws,
          this.hann, this.xF, this.shC, this.shS, this.vb, this.yb, this.xo, this.dl, this.ph, this.win, this.x2, this.mg,
          this.dm, this.gm, this.pdo, this.one, this.w1a, this.fia, this.remap];
        for (let i = 0; i < sh.length; i++) if (sh[i]) b += sh[i].byteLength;
        for (let i = 0; i < this.st.length; i++) b += this.st[i].bytes;
        return b;
      }
    }
    function poolOf(sx) {
      const P = sx !== null && typeof sx === 'object' ? sx.specPool : null;
      return P && typeof P.take === 'function' ? P : null;
    }
    function capOf(sx) {
      const P = poolOf(sx);
      return P !== null && P.nCapped > 0 ? 1 : 0;
    }
    // the processor's pool for an apply; a live processor (proc given, not offline) builds GROW0 new streams now and
    // queues the growth job for the rest (key per pool generation and target)
    function ensurePool(sx, B, n, base, fs, W, need, proc) {
      let P = poolOf(sx);
      if (P === null) { P = new Pool(); sx.specPool = P; }
      const live = proc !== null && typeof proc === 'object' && !proc.offline && typeof B.warmAdd === 'function';
      P.setup(B, n, specN(base), osOf(fs, base), base, W, need, live ? GROW0 : -1);
      if (live && P.st.length < P.nT) B.warmAdd(proc, 'sx-spec-grow:' + P.gen + ':' + P.nT, growJob);
      return P;
    }
    // lazy job: GROW_STEP streams per step until the pool reaches its target (≈ 0.3 ms per step)
    function growJob(proc) {
      const P = poolOf(proc.sx);
      return P !== null && P.grow(GROW_STEP);
    }
    // lazy warm-up (§11.10): WARM_STEPS real-FFT round trips on the pool scratch, one per render quantum (step count in
    // the pool, so the job is one shared function and queuing it allocates nothing beyond SxBase's queue entry)
    const WARM_STEPS = 4;
    function warmJob(proc) {
      const P = poolOf(proc.sx);
      if (P === null || P.fft === null) return false;
      const x = P.x, N = P.N;
      for (let i = 0; i < N; i++) x[i] = 0;
      x[1] = 1;
      P.fft.rfwd(x, P.re, P.im);
      P.fft.rinv(P.re, P.im, x);
      return ++P.warm < WARM_STEPS;
    }

    /* ------------------------------------------------------------ CP v2 shape validation (§4.1) */
    // typed arrays from another realm: compare the tag, never instanceof (Phase-1 §0.2)
    const tag = (a) => (a !== null && typeof a === 'object' && ArrayBuffer.isView(a) ? a[Symbol.toStringTag] : '');
    const U8 = ['sLoop', 'sRel', 'sLink', 'sExit', 'sScanKey', 'sScanLock', 'sLenOn', 'sSlMode', 'sSlEnd', 'sSlOne', 'sSlRoot',
      'sPhLock', 'sTrans', 'sSmooth', 'sPostWarp', 'sNorm', 'sRev', 'xyOn', 'xyY', 'xyMode'];
    const SHAPES = [['base', 'Float64Array', 429], ['oType', 'Uint8Array', 3], ['bendTrack', 'Uint8Array', 3],
      ['fmType', 'Uint8Array', 6], ['qr', 'Float64Array', 5]].concat(U8.map((f) => [f, 'Uint8Array', 3]),
      [['sSlN', 'Uint16Array', 3], ['sSlPos', 'Float64Array', 3 * NSL], ['sScanR', 'Float64Array', 3],
        ['lenLad', 'Float64Array', NLAD]]);
    function checkCP(cp) {
      if (cp === null || typeof cp !== 'object') return 'no CP';
      if (cp.ver !== 2) return 'ver ' + cp.ver;
      if (!(cp.os === 1 || cp.os === 2 || cp.os === 4 || cp.os === 8)) return 'os must be 1, 2, 4 or 8';
      for (let i = 0; i < SHAPES.length; i++) {
        const s = SHAPES[i], a = cp[s[0]];
        if (tag(a) !== s[1] || a.length !== s[2]) return s[0] + ' must be ' + s[1] + '(' + s[2] + ')';
      }
      const ids = cp.spec;
      if (!Array.isArray(ids) || ids.length !== 3) return 'spec must be Array(3) of strings';
      for (let i = 0; i < 3; i++) if (typeof ids[i] !== 'string') return 'spec must be Array(3) of strings';
      return '';
    }
    function qrOk(q) {
      if (q === null || typeof q !== 'object' || q.length !== 5) return false;
      for (let i = 0; i < 5; i++) if (typeof q[i] !== 'number' || q[i] - q[i] !== 0) return false;
      return true;
    }
    function zero(ctx, OL, OR, RAW) {
      const CH = ctx.CH;
      for (let s = 0; s < CH; s++) { OL[s] = 0; OR[s] = 0; }
      if (RAW !== null) {
        const N = ctx.N;
        for (let i = 0; i < N; i++) { const b = i * MAXCH; for (let s = 0; s < CH; s++) RAW[b + s] = 0; }
      }
    }
    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);     // NaN → 0
    // X|Y Y modes (§3.9 XY_MODES): 0 Add (n + 2y − 1), 1 Replace (y), 2 Scale (n·y)
    function xyApply(n, y, mode) {
      return mode === 0 ? clamp01(n + 2 * y - 1) : mode === 1 ? clamp01(y) : clamp01(n * y);
    }
    // NEED_* bits of oscillator o's warp slots (apply; the voice's mode resolution, §6.6.6: slot 1 = eff k.w1 — in S1 mode
    // the legacy warp for A/B, which maps onto P/O/PD/AM/RM modes only —, slot 2 = eff k.w2 when CP.use bit 4 is set). A
    // slot whose mode destination is modulated (CP.modded; absent ⇒ assumed) can take any mode
    function needOf(cp, o, k0, WD) {
      const bs = cp.base, md = cp.modded, mOk = tag(md) === 'Uint8Array' && md.length === bs.length;
      const use = typeof cp.use === 'number' ? cp.use : 4;
      let need = 0;
      for (let kk = 0; kk < 2; kk++) {
        if (kk === 1 && (use & 4) === 0) continue;
        if (kk === 0 && cp.s1 === 1 && o < 2) { need |= NEED_LINE; continue; }
        const vi = k0 + K.W1 + kk, U = kk === 0 ? NEED_U0 : NEED_U1, D = kk === 0 ? NEED_D0 : NEED_D1;
        if (!mOk || md[vi] !== 0) { need |= NEED_LINE | U | D; continue; }
        let m = round(81 * bs[vi]);
        m = m > 0 ? (m < 81 ? m : 81) : 0;
        const d = WD[m];
        if (d === D_F || d === D_P || d === D_O) need |= NEED_LINE;
        else if (m === S_SMEAR) need |= U;
        else if (m >= S_VOC0 && m <= S_MASK1) need |= U | D;
      }
      return need;
    }
    // detune offset r_j ∈ [−1, 1) of bin j for a stream seed (integer hash, IMPL: one r2 draw per stream seeds them)
    function detR(seed, j) {
      let h = (seed ^ Math.imul(j + 1, 0x9E3779B1)) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
      h = (h ^ (h >>> 16)) >>> 0;
      return h / 2147483648 - 1;
    }

    /* ------------------------------------------------------------ frame kernels (module scope, monomorphic) */
    // analysis read (§6.10.2) at fractional frame position P (frames, centred at t·hop): magnitudes interpolated between
    // ⌊P⌋ and ⌈P⌉ (blended with a second position P2 at weights c1 = cos θ, c2 = sin θ for loop crossfades, √((c1·M)² +
    // (c2·M2)²): equal power, so a crossfade between equal spectra keeps the level). Phases follow the analysis
    // phase track Φ(P) = ph[t] + (P − t)·Δ(t), Δ(t) = the unwrapped increment of the frame pair (t, t + 1) (κ of §6.10.2
    // times 2π·hop/N): PA = Φ(P) wrapped, KF = κ (analysis bins) = the mean slope of Φ over [Pa, P] when avg (the
    // previous read position Pa within 2 frames, IMPL: the phase advance then telescopes exactly with the analysis, so
    // identity resynthesis is exact for any hop), else the slope at P. Returns ⌊P⌋ (clamped).
    function readFrame(Pl, e, P, Pa, avg, P2, c1, c2) {
      const nbA = (e.N >> 1) + 1, fr = e.frames, last = fr - 1, mag = e.mag, ph = e.ph, A = Pl.A, KF = Pl.KF, PA = Pl.PA;
      if (!(P > 0)) P = 0;
      if (P > last) P = last;
      let t0 = floor(P);
      if (t0 > last) t0 = last;
      const a = P - t0, t1 = t0 + 1 < fr ? t0 + 1 : t0, b0 = t0 * nbA, b1 = t1 * nbA;
      if (c2 > 0) {
        if (!(P2 > 0)) P2 = 0;
        if (P2 > last) P2 = last;
        const u0 = floor(P2), bb = P2 - u0, u1 = u0 + 1 < fr ? u0 + 1 : u0, d0 = u0 * nbA, d1 = u1 * nbA;
        for (let j = 0; j < nbA; j++) {                          // equal power in the magnitude domain
          const u = c1 * (mag[b0 + j] + (mag[b1 + j] - mag[b0 + j]) * a), v = c2 * (mag[d0 + j] + (mag[d1 + j] - mag[d0 + j]) * bb);
          A[j] = sqrt(u * u + v * v);
        }
      } else {
        for (let j = 0; j < nbA; j++) A[j] = mag[b0 + j] + (mag[b1 + j] - mag[b0 + j]) * a;
      }
      Pl.fp = 0; Pl.ah = e.hop / e.N;
      if (fr < 2) {
        for (let j = 0; j < nbA; j++) { PA[j] = ph[b0 + j]; KF[j] = j; }
        return t0;
      }
      const hop = e.hop, om = TWO_PI * hop / e.N, sc = e.N / (TWO_PI * hop);
      const tp = t0 < last ? t0 : last - 1, fp = P - tp, bp = tp * nbA;
      Pl.fp = fp;
      // mean-slope interval [lo, hi] (frames) and its pair indices
      let lo = 0, hi = 0, d = 0;
      if (avg) {
        let q = Pa;
        if (!(q > 0)) q = 0;
        if (q > last) q = last;
        lo = q < P ? q : P; hi = q < P ? P : q; d = hi - lo;
        if (!(d > 1e-9 && d <= 2)) avg = false;
      }
      if (!avg) {
        for (let j = 0; j < nbA; j++) {
          const w0 = om * j;
          let x = ph[bp + nbA + j] - ph[bp + j] - w0;
          x = w0 + x - TWO_PI * round(x / TWO_PI);
          let p = ph[bp + j] + fp * x;
          p -= TWO_PI * round(p / TWO_PI);
          PA[j] = p; KF[j] = x * sc;
        }
        return t0;
      }
      let tl = floor(lo);
      if (tl > last - 1) tl = last - 1;
      let th = floor(hi);
      if (th > last - 1) th = last - 1;
      const fl = lo - tl, fh = hi - th, n = th - tl, id = sc / d;
      for (let j = 0; j < nbA; j++) {
        const w0 = om * j;
        let x = ph[bp + nbA + j] - ph[bp + j] - w0;
        x = w0 + x - TWO_PI * round(x / TWO_PI);
        let p = ph[bp + j] + fp * x;
        p -= TWO_PI * round(p / TWO_PI);
        PA[j] = p;
        // Φ(hi) − Φ(lo) = −fl·Δ(tl) + Σ_{t = tl}^{th − 1} Δ(t) + fh·Δ(th)
        let acc = 0;
        for (let t = tl; t <= th; t++) {
          const bt = t * nbA;
          let y = ph[bt + nbA + j] - ph[bt + j] - w0;
          y = w0 + y - TWO_PI * round(y / TWO_PI);
          acc += (t === tl ? (n === 0 ? fh - fl : 1 - fl) : t === th ? fh : 1) * y;
        }
        KF[j] = acc * id;
      }
      return t0;
    }
    // a held read position (analysis frames) clamped so that the frame pair it reads (magnitudes ⌊P⌋, ⌈P⌉; phase slope of
    // the pair ⌊P⌋, ⌊P⌋ + 1) lies on frames whose window is inside the sample (no zero padding): [⌈N_a/(2·hop_a)⌉,
    // ⌊(len − N_a/2)/hop_a⌋ − 1]; the centre frame when the sample is too short for that
    function held(e, P) {
      const h = e.N >> 1, lo = Math.ceil(h / e.hop), hi = floor((e.len - h) / e.hop) - 1;
      if (!(hi >= lo)) return 0.5 * e.len / e.hop;
      return P > lo ? (P < hi ? P : hi) : lo;
    }
    // 4-point Hermite read of the warp line d samples (≥ 0, clamped to LL − 4) before write index wp
    function lineAt(line, LL, wp, d) {
      if (d > LL - 4) d = LL - 4;
      let pos = wp - d;
      while (pos < 0) pos += LL;
      if (pos >= LL) pos -= LL;                                 // −ε + LL may round to LL
      const i0 = pos | 0, f = pos - i0;
      let im = i0 - 1; if (im < 0) im += LL;
      let i1 = i0 + 1; if (i1 >= LL) i1 -= LL;
      let i2 = i1 + 1; if (i2 >= LL) i2 -= LL;
      const xm = line[im], x0 = line[i0], xa = line[i1], xb = line[i2];
      return (((0.5 * (xb - xm) + 1.5 * (x0 - xa)) * f + (xm - 2.5 * x0 + 2 * xa - 0.5 * xb)) * f + 0.5 * (xa - xm)) * f + x0;
    }
    // peak regions of X[0 … n): every local maximum above max·rel with the bins up to the minima on either side.
    // Writes PK (peak bins), LO/HI (region bounds, inclusive), returns the region count (0 for silence).
    function regions(Pl, X, n, rel) {
      let mx = 0;
      for (let j = 0; j < n; j++) if (X[j] > mx) mx = X[j];
      if (!(mx > 0)) return 0;
      const thr = mx * rel, PK = Pl.PK, LO = Pl.LO, HI = Pl.HI;
      let c = 0;
      for (let j = 1; j < n - 1; j++) {
        const x = X[j];
        if (x > thr && x > X[j - 1] && x >= X[j + 1]) PK[c++] = j;
      }
      if (c === 0) {                                             // monotonic edges: the maximum is one region
        let jm = 0;
        for (let j = 0; j < n; j++) if (X[j] === mx) { jm = j; break; }
        PK[0] = jm; LO[0] = 0; HI[0] = n - 1;
        return 1;
      }
      LO[0] = 0;
      for (let r = 0; r < c - 1; r++) {
        let jm = PK[r], m = X[jm];
        for (let j = PK[r] + 1; j < PK[r + 1]; j++) if (X[j] < m) { m = X[j]; jm = j; }
        HI[r] = jm; LO[r + 1] = jm + 1;
      }
      HI[c - 1] = n - 1;
      return c;
    }
    // merge every region whose peak is not a resolved sinusoid (|Fq[p] − p| > 1 bin: a window sidelobe, or an instantaneous
    // frequency aliased by the analysis hop) into the nearer resolved neighbour (equal distance: the larger peak) when it is
    // a sidelobe of it — within MERGE_BINS bins and MERGE_REL (−20 dB) below it — so a lobe and its sidelobes move, and lock,
    // as one region (IMPL); other unresolved regions stay on their own. Rewrites PK/LO/HI in place (they stay contiguous, in
    // order), returns the new count.
    function mergeRegions(Pl, X, Fq, c) {
      const PK = Pl.PK, LO = Pl.LO, HI = Pl.HI, G = Pl.RG;
      let last = -1;
      for (let r = 0; r < c; r++) {                             // forward: resolved flags, left candidates
        const p = PK[r], d = Fq[p] - p;
        if (d <= 1 && d >= -1) { G[r] = r; last = r; } else G[r] = last >= 0 ? -2 - last : -1;
      }
      if (last < 0) return c;
      let next = -1;
      for (let r = c - 1; r >= 0; r--) {                        // backward: right candidates, decide
        const g = G[r];
        if (g === r) { next = r; continue; }
        const L = g <= -2 ? -2 - g : -1;
        let t;
        if (L < 0) t = next;
        else if (next < 0) t = L;
        else {
          const dl = PK[r] - PK[L], dr = PK[next] - PK[r];
          t = dl < dr ? L : dr < dl ? next : X[PK[L]] >= X[PK[next]] ? L : next;
        }
        const d = PK[r] - PK[t];
        G[r] = d <= MERGE_BINS && d >= -MERGE_BINS && X[PK[r]] < MERGE_REL * X[PK[t]] ? t : r;
      }
      let n = 0;
      for (let r = 0; r < c;) {                                 // compact: one region per target, LO of its first part
        const t = G[r];
        let e = r;
        while (e + 1 < c && G[e + 1] === t) e++;
        PK[n] = PK[t]; LO[n] = LO[r]; HI[n] = HI[e]; n++;
        r = e + 1;
      }
      return n;
    }
    // parabolic offset of peak p ∈ (−0.5, 0.5) from the magnitudes (log domain)
    function peakOff(X, p, n) {
      if (p <= 0 || p >= n - 1) return 0;
      const a = log(X[p - 1] + 1e-30), b = log(X[p] + 1e-30), c = log(X[p + 1] + 1e-30), d = a - 2 * b + c;
      if (!(d < 0)) return 0;
      const o = 0.5 * (a - c) / d;
      return o > -0.499 ? (o < 0.499 ? o : 0.499) : -0.499;
    }
    // the centre of the peak p (bins): its instantaneous frequency Fq[p] when resolved, else the parabolic estimate
    function centre(X, Fq, p, n) {
      const f = Fq[p], d = f - p;
      return d <= 1 && d >= -1 ? f : p + peakOff(X, p, n);
    }
    // p when the peak p is a resolved sinusoid (|Fq[p] − p| ≤ 1 bin), else −1
    function sine(Fq, p) { const d = Fq[p] - p; return d <= 1 && d >= -1 ? p : -1; }
    // the normalised Hann window kernel K(δ) = sinc(δ)/(1 − δ²) (K(0) = 1, main lobe |δ| < 2, sign alternating beyond): the
    // spectrum of a full-scale sinusoid δ bins from a bin, in the window-normalised units of the analysis (§9.4.6), large-N
    // limit (the finite-N Dirichlet kernel differs by < 2e-6 within KW bins at N 2048). KW: the re-rendered width (place)
    const KW = 4;
    function hannK(d) {
      const a = d < 0 ? -d : d;
      if (a < 1e-9) return 1;
      const q = 1 - a * a;
      return q < 1e-7 && q > -1e-7 ? 0.5 : sin(PI * a) / (PI * a * q);
    }
    // the output bin a region's peak lands on: round(c), clamped into [1, nb − 2]
    function lockBin(c, nb) {
      const q = round(c);
      return q < 1 ? 1 : q > nb - 2 ? nb - 2 : q;
    }
    // one source region [lo, hi] (magnitudes SM, frequencies SF in bins, phases SP; ns source bins) placed into the output
    // bins (P.M, P.F, P.P0, weights P.Wt, lock bins P.LK) shifted by sh bins, scaled by amp. A whole-bin shift copies
    // [lo, hi]; a fractional one resamples the magnitudes by Catmull-Rom over the whole source (neighbours outside the region
    // included, so a lobe keeps its shape at the region edges) at the output bins whose source position u = j − sh lies in
    // [lo − ½, hi + ½) — the regions of one shift tile the output exactly. The dominant contribution of a bin sets its
    // F = fm·SF + fa, P0 = pm·(SP − π·(u − k)) of the nearest source bin k of the region (the −π/bin phase slope of a
    // frame-start-referenced analysis lobe, so a moved lobe keeps the relative phases of a sinusoid at its new position)
    // and its lock bin LK = lk (the output bin of the region's peak; −1: none).
    // When the region is a resolved sinusoid (pk ≥ 0: its peak bin, cen: its centre in source bins), a fractional move
    // re-renders the bins within KW of its new centre c' = cen + sh (main lobe and first sidelobes) as the Hann kernel
    // there — magnitude A·|K(j − c')| with A = SM[pk]/K(pk − cen), phase φ_c − π·(j − c') (+ π where K < 0), φ_c = the
    // source lobe's phase at its centre — IMPL: Catmull-Rom magnitudes of a moved lobe are not a Hann lobe, which the
    // overlap-add normalisation turns into hop-rate amplitude modulation (≈ 1 dB at the 2× overlap of Draft; < 0.15 dB
    // so). Any shift or frequency change sets Pl.mv
    function place(Pl, SM, SF, SP, lo, hi, sh, fm, fa, pm, amp, nb, ns, lk, pk, cen) {
      const M = Pl.M, F = Pl.F, P0 = Pl.P0, Wt = Pl.Wt, LK = Pl.LK;
      if (((sh !== 0) | (fm !== 1) | (fa !== 0)) !== 0) Pl.mv = 1;   // (every test evaluated: M4, see render)
      const fr = sh - floor(sh);
      if (fr === 0) {                                            // whole-bin shift: a plain copy
        let j0 = lo + sh, j1 = hi + sh;
        if (j0 < 1) j0 = 1;
        if (j1 > nb - 2) j1 = nb - 2;
        for (let j = j0; j <= j1; j++) {
          const kk = j - sh, v = amp * SM[kk];
          M[j] += v;
          if (v > Wt[j]) {
            Wt[j] = v; F[j] = fm * SF[kk] + fa; P0[j] = pm * SP[kk];
            LK[j] = lk;
          }
        }
        return;
      }
      let j0 = Math.ceil(lo - 0.5 + sh), j1 = Math.ceil(hi + 0.5 + sh) - 1;
      if (j0 < 1) j0 = 1;
      if (j1 > nb - 2) j1 = nb - 2;
      const last = ns - 1, cn = cen + sh, ka = pk >= 0 ? hannK(pk - cen) : 0, A = ka > 0.5 ? SM[pk] / ka : 0;
      const pc = A > 0 ? SP[pk] + PI * (pk - cen) : 0;           // the lobe's phase at its centre
      for (let j = j0; j <= j1; j++) {
        const u = j - sh, i = floor(u), f = u - i, dc = j - cn;
        let v, sg = 0;
        if (A > 0 && dc < KW && dc > -KW) { const kv = hannK(dc); v = A * (kv < 0 ? -kv : kv); sg = kv < 0 ? 2 : 1; }
        else {
          const im = i - 1 < 0 ? 0 : i - 1 > last ? last : i - 1, i0 = i < 0 ? 0 : i > last ? last : i;
          const i1 = i + 1 < 0 ? 0 : i + 1 > last ? last : i + 1, i2 = i + 2 < 0 ? 0 : i + 2 > last ? last : i + 2;
          const y0 = SM[im], y1 = SM[i0], y2 = SM[i1], y3 = SM[i2];
          v = ((((3 * (y1 - y2) + y3 - y0) * f + (2 * y0 - 5 * y1 + 4 * y2 - y3)) * f + (y2 - y0)) * f) * 0.5 + y1;
        }
        if (!(v > 0)) continue;
        v *= amp;
        M[j] += v;
        if (v > Wt[j]) {
          let kk = f < 0.5 ? i : i + 1;
          kk = kk < lo ? lo : kk > hi ? hi : kk;
          Wt[j] = v; F[j] = fm * SF[kk] + fa;
          P0[j] = sg === 0 ? pm * (SP[kk] - PI * (u - kk)) : pm * (pc - PI * dc + (sg === 2 ? PI : 0));
          LK[j] = lk;
        }
      }
    }
    // resynthesis with pitch (§6.10.3, IMPL peak regions): analysis bins (A, KF, PA; nbA) → output bins (M, F, P0, LK; nb).
    // Region r (resolved peak p at centre c = κ_p, sidelobe regions merged into it) moves by (s − 1)·c bins; F = s·κ
    function mapPitch(Pl, nbA, nb, s) {
      const A = Pl.A, KF = Pl.KF, PA = Pl.PA, M = Pl.M, F = Pl.F, P0 = Pl.P0, Wt = Pl.Wt, LK = Pl.LK;
      for (let j = 0; j < nb; j++) { M[j] = 0; F[j] = j; P0[j] = 0; Wt[j] = 0; LK[j] = -1; }
      Pl.mv = 0;
      let c = regions(Pl, A, nbA, PEAK_FLOOR);
      c = mergeRegions(Pl, A, KF, c);
      const PK = Pl.PK, LO = Pl.LO, HI = Pl.HI, ah = Pl.ah, fp = Pl.fp;
      // hop aliasing (IMPL): readFrame takes each bin's principal phase increment, so a bin more than N_a/(2·hop_a) bins
      // from its sinusoid (a window sidelobe) reads a frequency off by a multiple m of N_a/hop_a bins — and, at a fractional
      // read position, a phase off by 2π·m·fp. Every bin of a resolved region is put on its peak's branch
      for (let r = 0; r < c; r++) {
        const p = PK[r];
        if (sine(KF, p) < 0) continue;
        const kp = KF[p];
        for (let j = LO[r]; j <= HI[r]; j++) {
          const m = round((kp - KF[j]) * ah);
          if (m !== 0) { KF[j] += m / ah; let v = PA[j] + TWO_PI * m * fp; v -= TWO_PI * round(v / TWO_PI); PA[j] = v; }
        }
      }
      for (let r = 0; r < c; r++) {
        const p = PK[r], cen = centre(A, KF, p, nbA), sh = s === 1 ? 0 : (s - 1) * cen;
        place(Pl, A, KF, PA, LO[r], HI[r], sh, s, 0, 1, 1, nb, nbA, lockBin(s * cen, nb), sine(KF, p), cen);
      }
    }
    // snapshot M, F, P0, LK → M2, F2, P2, LK2 and clear the targets for a region move
    function snap(Pl, nb, clear) {
      const M = Pl.M, F = Pl.F, P0 = Pl.P0, M2 = Pl.M2, F2 = Pl.F2, P2 = Pl.P2, Wt = Pl.Wt, LK = Pl.LK, LK2 = Pl.LK2;
      for (let j = 0; j < nb; j++) {
        M2[j] = M[j]; F2[j] = F[j]; P2[j] = P0[j]; LK2[j] = LK[j];
        if (clear) { M[j] = 0; F[j] = j; P0[j] = 0; Wt[j] = 0; LK[j] = -1; } else Wt[j] = M[j];
      }
    }
    // move (clear = 1) or add copies (clear = 0, amplitude amp) of the peak regions of the snapshot: kind 0 multiplies
    // the peak position and the frequencies by a; kind 1 by a per-region detune 2^(w·r_p·50/1200) (r_p of the peak bin,
    // seed); only peaks above max·rel open a region. Copies scale their phases with the frequency
    function moveRegions(Pl, nb, kind, a, amp, rel, clear, seed, w) {
      snap(Pl, nb, clear);
      const M2 = Pl.M2, F2 = Pl.F2, P2 = Pl.P2;
      let c = regions(Pl, M2, nb, rel);
      c = mergeRegions(Pl, M2, F2, c);
      const PK = Pl.PK, LO = Pl.LO, HI = Pl.HI;
      for (let r = 0; r < c; r++) {
        const p = PK[r], cen = centre(M2, F2, p, nb);
        const f = kind === 0 ? a : pow(2, w * detR(seed, p) * (50 / 1200));
        place(Pl, M2, F2, P2, LO[r], HI[r], (f - 1) * cen, f, 0, clear ? 1 : f, amp, nb, nb, lockBin(f * cen, nb), sine(F2, p), cen);
      }
    }
    // Lo/Hi band limit (§6.10.4): gain 1 inside [flo, fhi] else 0; Smooth: 1/√(1+(flo/f)^8)·1/√(1+(f/fhi)^8)
    function bandLimit(M, nb, binHz, flo, fhi, smooth) {
      M[0] = 0;
      if (smooth) {
        for (let j = 1; j < nb; j++) {
          const f = j * binHz, a = flo / f, b = f / fhi, a2 = a * a, b2 = b * b, a4 = a2 * a2, b4 = b2 * b2;
          M[j] *= 1 / sqrt((1 + a4 * a4) * (1 + b4 * b4));
        }
      } else {
        for (let j = 1; j < nb; j++) { const f = j * binHz; if (f < flo || f > fhi) M[j] = 0; }
      }
    }
    // spectral filter (§6.10.4 step 2): M ×= 1 − mix + mix·curve(x − 0.5·cutV), curve = specFilt[off … off + 512]
    function specFilter(M, nb, xF, curve, off, cutV, mix) {
      const sh = 0.5 * cutV, dry = 1 - mix;
      for (let j = 1; j < nb; j++) {
        let x = (xF[j] - sh) * 512;
        x = x > 0 ? (x < 512 ? x : 512) : 0;
        const i = x | 0, fr = x - i, g = i < 512 ? curve[off + i] + (curve[off + i + 1] - curve[off + i]) * fr : curve[off + 512];
        M[j] *= dry + mix * g;
      }
    }
    // band envelopes (24 one-third-octave bands, linear interpolation across bands) of X into E (sqrt of mean power)
    function bands(Pl, X, nb, E) {
      const BW = Pl.BW, vb = Pl.vb;
      for (let b = 0; b < NBAND; b++) { E[b] = 0; BW[b] = 0; }
      for (let j = 1; j < nb; j++) {
        const v = vb[j], b0 = v | 0, fr = v - b0, p = X[j] * X[j];
        E[b0] += (1 - fr) * p; BW[b0] += 1 - fr;
        if (b0 + 1 < NBAND) { E[b0 + 1] += fr * p; BW[b0 + 1] += fr; }
      }
      let last = -1;
      for (let b = 0; b < NBAND; b++) {
        if (BW[b] > 1e-9) {
          E[b] = sqrt(E[b] / BW[b]);
          if (last < b - 1) for (let q = last + 1; q < b; q++) E[q] = last >= 0 ? E[last] + (E[b] - E[last]) * (q - last) / (b - last) : E[b];
          last = b;
        }
      }
      if (last < 0) for (let b = 0; b < NBAND; b++) E[b] = 0;
      else for (let q = last + 1; q < NBAND; q++) E[q] = E[last];
    }
    function bandAt(E, v) {
      const b0 = v | 0;
      return b0 + 1 < NBAND ? E[b0] + (E[b0 + 1] - E[b0]) * (v - b0) : E[NBAND - 1];
    }

    /* ------------------------------------------------------------ Spectral (§6.10) */
    class SpecOsc {
      constructor(voice, o) {
        this.v = voice; this.o = o >= 0 && o <= 2 ? o | 0 : 0;
        this.B = null; this.W = null; this.k0 = -1; this.kLen = -1; this.kLev = -1;   // SxBase, SxWarp, vi of k.w1 / k.lenrate / level
        this.ok = 0; this.sel = 0;
        this.id = ''; this.e = null; this.ep = -1;               // analysis entry id, resolved entry, epoch it was resolved at
        this.root = 60; this.peak = 1;
        // options (§2.2.3, §2.2.4, CP §4.1)
        this.loop = 0; this.rel = 0; this.link = 0; this.exit = 0; this.scanKey = 0; this.scanLock = 0; this.lenOn = 0;
        this.slMode = 0; this.slEnd = 0; this.slOne = 0; this.slRoot = 36; this.slN = 0; this.phLock = 0; this.trans = 0;
        this.smooth = 0; this.postWarp = 0; this.norm = 0; this.rev = 0; this.xyOn = 0; this.xyY = 0; this.xyMode = 0;
        this.scanR = 2; this.bendTrack = 1; this.fm1 = 0; this.fm2 = 0; this.q = 2; this.hopMul = 1; this.nStreams = 32;
        this.bSS = 0; this.bLS = 0; this.bLE = 1;                 // base n of k.sstart, k.lstart, k.lend (Relative / Link)
        this.N = 2048; this.H = 512;                              // synthesis size and hop (§3.9)
        this.sl = null; this.lad = null;                          // slice boundaries, length ladder (first apply selecting)
        // stream indices into the processor's pool and per-unison note values: the only per-voice state (§11.8)
        this.si = new Int16Array(MAXUNI).fill(-1);
        this.uR = new Float64Array(MAXUNI);                       // START randoms u_i (r2)
        this.dSeed = new Float64Array(MAXUNI);                    // Detune seeds (r2)
        this.nS = 0; this.pool = null; this.pgen = -1; this.capped = 0;
        // note state
        this.on = 0; this.gate = 0; this.fresh = 0; this.nU = 0; this.init = 0; this.done = 0;
        this.nSS = 0; this.nSl = 0; this.nUS = 0; this.nUP = 0; this.key = 60; this.pKey = 60;
        this.silentSl = 0; this.slS = 0; this.slE = 1;
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
        // per-chunk values (render → frame synthesis)
        this.cL = 1; this.cS = 0; this.cD = 1; this.cLr = 0; this.cA = 0; this.cB = 0; this.cMode = 0; this.cLx = 0;
        this.cRoomA = 0; this.cRoomB = 0; this.cRate = 1; this.cSig = 1; this.cPos = 0; this.cRhoK = 1; this.cFroot = 440;
        this.cFlo = MIDI0; this.cFhi = 22050; this.cCut = 0; this.cMix = 1;
        this.cM1 = 0; this.cM2 = 0; this.cV1 = 0; this.cV2 = 0; this.cShr = 0;
        this.cCurve = null; this.cRemap = null; this.cRb = 0; this.cNorm = 1;
      }
      apply(cp, o, qr) {
        if (!(o === 0 || o === 1 || o === 2)) { this.release(); this.ok = 0; this.sel = 0; return badCP('oscillator index ' + o); }
        this.o = o;
        const why = this.prologue(cp, o, qr);
        if (why) { this.release(); this.ok = 0; this.sel = 0; return why === '-' ? false : badCP(why); }
        const q = qr != null ? qr : cp.qr;
        this.ok = 1;
        this.sel = cp.oType[o] === T_SPEC ? 1 : 0;
        this.loop = cp.sLoop[o]; this.rel = cp.sRel[o]; this.link = cp.sLink[o]; this.exit = cp.sExit[o];
        this.scanKey = cp.sScanKey[o]; this.scanLock = cp.sScanLock[o]; this.lenOn = cp.sLenOn[o];
        this.slMode = cp.sSlMode[o]; this.slEnd = cp.sSlEnd[o]; this.slOne = cp.sSlOne[o]; this.slRoot = cp.sSlRoot[o];
        this.slN = cp.sSlN[o]; this.phLock = cp.sPhLock[o]; this.trans = cp.sTrans[o]; this.smooth = cp.sSmooth[o];
        this.postWarp = cp.sPostWarp[o]; this.norm = cp.sNorm[o]; this.rev = cp.sRev[o]; this.xyOn = cp.xyOn[o];
        this.xyY = cp.xyY[o]; this.xyMode = cp.xyMode[o]; this.scanR = +cp.sScanR[o]; this.bendTrack = cp.bendTrack[o];
        this.fm1 = cp.fmType[o * 2]; this.fm2 = cp.fmType[o * 2 + 1];
        this.q = cp.os; this.hopMul = q[2]; this.nStreams = q[3];
        const bs = cp.base, k0 = this.k0;
        this.bSS = bs[k0 + K.SSTART]; this.bLS = bs[k0 + K.LSTART]; this.bLE = bs[k0 + K.LEND];
        if (this.sel === 1) {
          if (this.sl === null) { this.sl = new Float64Array(NSL); this.lad = new Float64Array(NLAD); }
          const sp = cp.sSlPos, b = o * NSL, sl = this.sl, lad = this.lad, ll = cp.lenLad;
          for (let j = 0; j < NSL; j++) sl[j] = sp[b + j];
          for (let j = 0; j < NLAD; j++) lad[j] = ll[j];
          const proc = this.v !== null && typeof this.v === 'object' ? this.v.proc : null;
          const base = proc && proc.base > 0 ? +proc.base : 48000, fs = proc && proc.fs > 0 ? +proc.fs : 2 * base;
          this.N = specN(base); this.H = hopOf(this.N, this.q, this.hopMul);
          const sx = proc && proc.sx !== null && typeof proc.sx === 'object' ? proc.sx : null;
          this.W = sxWarp();
          if (this.W === null && !warnedWarp) {
            warnedWarp = true;
            warn('SxWarp is missing: phase- and output-domain warp slots of Spectral oscillators act as Off');
          }
          if (sx !== null) {
            this.pool = ensurePool(sx, this.B, this.nStreams, base, fs, this.W, needOf(cp, o, this.k0, this.B.WARP_DOM), proc);
            if (this.nS > 0 && this.pool.gen !== this.pgen) this.drop();
            if (!proc.offline) this.B.warmAdd(proc, 'sx-spec', warmJob);
          }
        } else this.release();
        const id = cp.spec[o];
        if (id !== this.id) { this.id = id; this.e = null; this.ep = -1; }
        return true;
      }
      // '' or the reason the CP cannot be used; sets B / k0 / kLen / kLev on success
      prologue(cp, o, qr) {
        const why = checkCP(cp);
        if (why) return why;
        if (!qrOk(qr != null ? qr : cp.qr)) return 'qr must hold 5 finite numbers';
        const B = sxBase();
        if (B === null) return '-';
        if (B.OTYPE.SPEC !== T_SPEC) return 'SxBase OTYPE codes differ';
        const WD = B.WDOM;
        if (!WD || WD.F !== D_F || WD.P !== D_P || WD.O !== D_O || WD.S !== D_S) return 'SxBase WDOM codes differ';
        const D = B.DIDX2, P = OSC_LETTER[o], k0 = D[P + '_W1'], kl = D[P + '_LENRATE'], kv = D[P + '_LEVEL'];
        if (!(k0 >= 0) || D[P + '_BUS2'] !== k0 + K.BUS2 || D[P + '_FLO'] !== k0 + K.FLO || !(kl >= 0) || !(kv >= 0)) {
          return 'SxBase destination indices differ';
        }
        this.B = B; this.k0 = k0; this.kLen = kl; this.kLev = kv;
        return '';
      }
      noteOn(ctx, fresh, legato) {
        this.gate = 1;
        if (this.ok === 0 || this.sel === 0) { this.on = 0; return; }
        this.fresh = fresh ? 1 : 0;
        // a legato note keeps the streams, playheads and phases of a sounding oscillator; one that has played out (One-shot
        // end) or holds no stream (pool empty or rebuilt) restarts
        if (legato && this.on === 1 && this.done === 0 && this.nS > 0) return;
        this.release();
        this.on = 1; this.done = 0; this.init = 1;
        // (M4) the entry of a fresh oscillator is resolved here rather than in its first render: that path of render then
        // stays for an asset arriving later (the first real chord took it in optimised code and deoptimised it, V8)
        const Bn = this.B;
        if (Bn !== null && Bn.epoch !== this.ep) this.resolve();
        let nU = ctx.N | 0;
        nU = nU < 1 ? 1 : nU > MAXUNI ? MAXUNI : nU;
        this.nU = nU;
        // note-on values (mOn destinations, §3.11.3) and the key
        const eff = ctx.eff, k0 = this.k0;
        const hasEff = eff !== null && typeof eff === 'object' && eff.length >= 429 && k0 >= 0;
        this.nSS = hasEff ? eff[k0 + K.SSTART] : 0; this.nSl = hasEff ? eff[k0 + K.SLICE] : 0;
        this.nUS = hasEff ? eff[k0 + K.USTART] : 0; this.nUP = hasEff ? eff[k0 + K.USPAN] : 0;
        const kr = ctx.keyRef;
        this.key = typeof kr === 'number' && kr - kr === 0 ? kr : 60;
        // the played key (folded, §6.2) picks the slice — ctx.key, else the voice's note, else the pitch reference
        const pk = ctx.key, vn = this.v !== null && typeof this.v === 'object' ? this.v.note : undefined;
        this.pKey = typeof pk === 'number' && pk - pk === 0 ? round(pk)
          : typeof vn === 'number' && vn - vn === 0 ? round(vn) : round(this.key);
        // r2 draws (§6.2): START randoms, then the Detune seeds — 2·N per non-legato note, whatever the pool holds
        const v = this.v, rnd = v !== null && typeof v === 'object' && typeof v.rnd2 === 'function';
        for (let i = 0; i < nU; i++) this.uR[i] = rnd ? v.rnd2() : 0;
        for (let i = 0; i < nU; i++) this.dSeed[i] = rnd ? floor(v.rnd2() * 4294967296) : 0x2545F491 + i;
        let P = this.pool;
        if (P === null && v !== null && typeof v === 'object' && v.proc) P = this.pool = poolOf(v.proc.sx);
        if (P === null) return;                                  // no pool yet: silent until the next apply creates it
        this.pgen = P.gen;
        const si = this.si;
        let n = 0;
        while (n < nU) {
          const s = P.take();
          if (s < 0) break;
          si[n++] = s;
        }
        this.nS = n;
        if (n < nU) { this.capped = 1; P.nCapped++; }
      }
      noteOff() { this.gate = 0; }
      render(ctx, OL, OR, RAW) {
        zero(ctx, OL, OR, RAW);
        if (this.on === 0) return;
        if (this.nS > 0 && (this.pool === null || this.pool.gen !== this.pgen)) this.drop();
        // (M4: tests and loads evaluated in every call where they can be — a test first evaluated by a real chord, a
        // different key or a later frame than the warm-up's, deoptimised the whole function, V8)
        const Bo = this.B, ep0 = this.ep, bep = Bo !== null ? Bo.epoch : ep0;
        if (bep !== ep0) {
          const old = this.e;
          this.resolve();
          if (this.e !== old && this.e !== null) this.init = 1;     // a new entry restarts the streams
        }
        const e = this.e, P = this.pool;
        if (e === null || this.nS === 0 || this.done === 1 || P === null) return;
        const f = ctx.f, gl = ctx.gl, gr = ctx.gr, dgl = ctx.dgl, dgr = ctx.dgr, eff = ctx.eff;
        if (!f || !gl || !gr || !dgl || !dgr || !eff) return;    // not an OscCtx (§11.8)
        const CH = ctx.CH | 0, os = P.os, CHb = (CH / os) | 0;
        if (!(CHb >= 1 && CHb * os === CH && CH <= MAXCH)) {
          if (!warnedCH) { warnedCH = true; warn('ctx.CH must be a multiple of the OS factor (≤ 32): silent'); }
          return;
        }
        if (((e.N >> 1) + 1) > P.nbA) {
          if (!warnedNA) { warnedNA = true; warn('analysis N above ' + NA_MAX + ': silent'); }
          return;
        }
        const init = this.init;
        if (init === 1) this.startSlice();
        this.chunkValues(ctx);
        if (init === 1) this.startStreams();
        const N = ctx.N < this.nS ? ctx.N : this.nS;
        let alive = 0;
        for (let i = 0; i < N; i++) {
          const st = P.st[this.si[i]];
          if (st.done === 1) continue;
          alive++;
          this.renderStream(st, i, ctx, CH, CHb, OL, OR, RAW);
        }
        if (N > 0) {                                             // stream 0's read position (snapshot smpPos)
          const s0 = P.st[this.si[0]], L = this.cL;
          this.mPos = !(L > 0) ? 0 : this.xyOn === 1 ? clamp01(this.cPos + this.nUS * this.uR[0] * this.cLr * this.cD / L)
            : clamp01((this.cS + this.cD * s0.q) / L);
        }
        if (alive === 0 && N > 0) { this.release(); this.done = 1; }   // every stream played out (One-shot, exit)
      }
      // the analysis entry of the current id (§4.5; ids are opaque, no other entry is consulted). Root and peak are taken
      // from the entry object itself, so they change only with the entry (which restarts the streams, render)
      resolve() {
        const B = this.B, e = this.id !== '' ? B.getAsset(this.id) : null, old = this.e;
        this.e = e !== null && e.kind === 'spec' ? e : null;
        this.ep = B.epoch;
        const ee = this.e;
        if (ee !== null && ee !== old) {
          const root = ee.root;
          this.root = typeof root === 'number' && root - root === 0 ? root : 60;
          this.peak = ee.peak > 0 ? ee.peak : 1;
        }
      }
      // the slice of the note (§6.7.5; sSlMode is compiled 0 while X|Y is on)
      startSlice() {
        const sl = this.sl;
        this.silentSl = 0; this.slS = 0; this.slE = 1;
        if (this.slMode !== 0 && sl !== null && this.slN >= 1) {
          let j;
          if (this.slOne) {
            j = round(255 * this.nSl);
            j = j < 0 ? 0 : j > this.slN - 1 ? this.slN - 1 : j;
          } else j = this.pKey - this.slRoot;
          if (j < 0 || j >= this.slN) this.silentSl = 1;
          else { this.slS = sl[j]; this.slE = sl[j + 1]; }
        }
      }
      // start every held stream at the note (entry present, region known): START/SPAN offsets Δ_i (§6.7.6)
      startStreams() {
        this.init = 0;
        const P = this.pool, nU = this.nU, Lr = this.cLr;
        for (let i = 0; i < this.nS; i++) {
          const si = this.si[i], st = P.st[si];
          st.start(i, this.H, si, this.dSeed[i]);
          if (this.silentSl === 1) { st.end = 1; continue; }
          // a negative scan factor at note-on plays the region backwards from its end (as SxSample, IMPL)
          const d = (this.nUS * this.uR[i] + this.nUP * i / nU) * Lr;
          st.tb = this.cRate < 0 ? 1 : 0;
          st.q = st.tb === 1 ? Lr - d : d;
          if (this.xyOn === 0) this.advance(st, 0);           // past the region end: into the loop, or silent (One-shot)
        }
      }
      // per-chunk values shared by the streams: region and loop (§6.7.1, §6.7.3), scan factor, filter, X|Y, warps
      chunkValues(ctx) {
        const e = this.e, eff = ctx.eff, k0 = this.k0, L = e.len, srate = e.rate;
        this.cL = L;
        // X|Y Y (§3.9 XY_Y_SPEC)
        const xy = this.xyOn === 1, Y = xy ? clamp01(eff[k0 + K.GY]) : 0, ym = this.xyMode, yt = xy ? this.xyY : 0;
        // region: S at note-on (or the slice), E/LS/LE continuous
        let S, E;
        if (this.slMode !== 0 && this.sl !== null) {
          S = this.slS * L;
          E = this.slEnd ? clamp01(eff[k0 + K.SEND]) * L : this.slE * L;
        } else {
          S = clamp01(this.nSS) * L; E = clamp01(eff[k0 + K.SEND]) * L;
        }
        let LS = clamp01(eff[k0 + K.LSTART]) * L, LE = clamp01(eff[k0 + K.LEND]) * L;
        if (this.rel) { const d = S - clamp01(this.bSS) * L; LS += d; LE += d; }
        if (this.link) LE = LS + (this.bLE - this.bLS) * L;
        const lo = S < E ? S : E, hi = S < E ? E : S;
        LS = LS < lo ? lo : LS > hi ? hi : LS; LE = LE < lo ? lo : LE > hi ? hi : LE;
        const d0 = E >= S ? 1 : -1, Lr = hi - lo;
        let a = (LS - S) * d0, b = (LE - S) * d0, mode = this.loop;
        if (a > b) {                                             // LE < LS: the loop runs backwards (Fwd ↔ Rev, IMPL)
          const t = a; a = b; b = t;
          if (mode === 1) mode = 2; else if (mode === 2) mode = 1;
        }
        this.cS = S; this.cD = d0; this.cLr = Lr; this.cA = a; this.cB = b; this.cMode = mode;
        // crossfade room (§6.7.4, "auto-scaled inside the sample"): frames available beyond the loop bound the partner read
        // passes — before a (region coordinates) for wraps at b, after b for wraps at a
        const pA = S + d0 * a, pB = S + d0 * b;
        this.cRoomA = d0 > 0 ? pA : L - pA; this.cRoomB = d0 > 0 ? L - pB : pB;
        const xf = clamp01(eff[k0 + K.XFADE]);
        this.cLx = xf * 0.5 * (b - a);
        this.mS = L > 0 ? S / L : 0; this.mLS = L > 0 ? LS / L : 0; this.mLE = L > 0 ? LE / L : 0;
        // scan factor σ (§6.9.1; Length to BPM §6.7.2) and source samples per output base sample
        const sg = eff[k0 + K.SCANREV] >= 0.5 ? -1 : 1, bpm = ctx.bpm > 0 ? +ctx.bpm : 120;
        let sig;
        if (this.lenOn === 1 && this.lad !== null) {
          let li = round(14 * clamp01(eff[this.kLen]));
          li = li < 0 ? 0 : li > NLAD - 1 ? NLAD - 1 : li;
          const beats = this.lad[li];
          sig = beats > 0 ? sg * (Lr / srate) / (beats * 60 / bpm) : 0;
        } else {
          sig = sg * (2 * clamp01(eff[k0 + K.SCAN]) - 1) * this.scanR;
          if (this.scanKey) sig *= pow(2, ((ctx.keyRef > -1e9 ? ctx.keyRef : 60) - 60) / 12);
          if (this.scanLock) sig *= bpm / 120;
        }
        this.cSig = sig;
        this.cRate = sig * srate / (ctx.base > 0 ? ctx.base : this.pool.base);
        this.cPos = clamp01(eff[k0 + K.POS]);
        // pitch reference (§6.3.3): ρ = f / f_root; slices: no key tracking / key relative to 60 (§6.7.5)
        const root = this.root + (typeof ctx.rootShift === 'number' && ctx.rootShift - ctx.rootShift === 0 ? ctx.rootShift : 0);
        this.cFroot = 440 * pow(2, (root - 69) / 12);
        this.cRhoK = this.slMode !== 0 && this.sl !== null
          ? (this.slOne ? pow(2, (root - 60) / 12) : pow(2, (root - this.key) / 12)) : 1;
        // band limits, filter
        let nlo = clamp01(eff[k0 + K.FLO]), nhi = clamp01(eff[k0 + K.FHI]), ncut = clamp01(eff[k0 + K.CUT]),
          nmix = clamp01(eff[k0 + K.SMIX]);
        if (yt === 4) ncut = xyApply(ncut, Y, ym);
        else if (yt === 5) nmix = xyApply(nmix, Y, ym);
        else if (yt === 6) nlo = xyApply(nlo, Y, ym);
        else if (yt === 7) nhi = xyApply(nhi, Y, ym);
        this.cFlo = MIDI0 * exp(LN_F * nlo); this.cFhi = MIDI0 * exp(LN_F * nhi);
        this.cCut = 2 * ncut - 1; this.cMix = nmix;
        const sx = ctx.sx, C = sx !== null && typeof sx === 'object' ? sx.CT : null;
        this.cCurve = C && C.specFilt && C.specFilt.length >= 3 * 513 ? C.specFilt : null;
        const rm = sx !== null && typeof sx === 'object' ? sx.remap : null;
        if (rm && rm.length >= (this.o + 1) * 2049) { this.cRemap = rm; this.cRb = this.o * 2049; }
        else { this.cRemap = this.pool.remap; this.cRb = 0; }
        // warps: modes, Var (resolved by the voice); two Vocode/Mask slots on the same modulator share slot 1's ring
        const m1 = ctx.mode1 | 0, m2 = ctx.mode2 | 0;
        this.cM1 = m1; this.cM2 = m2; this.cV1 = +ctx.var1 || 0; this.cV2 = +ctx.var2 || 0;
        this.cShr = m1 >= S_VOC0 && m1 <= S_MASK1 && m2 >= S_VOC0 && m2 <= S_MASK1 && ctx.mod1 === ctx.mod2
          && (ctx.modStride1 | 0) === (ctx.modStride2 | 0) ? 1 : 0;
        // sNorm: 1/peak, part of the raw signal. (X|Y Level, Warp and Warp 2 are the voice's, as for Granular: it applies Y
        // to the eff level before its gain ramp and to the base amounts before the unison spread, §3.9, §6.6.8)
        this.cNorm = this.norm ? 1 / this.peak : 1;
      }
      // the eff amount of slot kk for unison voice i (§6.6.8, by the voice)
      amt(ctx, kk, i) {
        const w = kk === 0 ? ctx.w1 : ctx.w2;
        return w ? clamp01(w[i]) : 0;
      }
      // one stream for one chunk: frame schedule, OLA read, fade-in, upsampling, warp delay line, O-domain warps, gains
      renderStream(st, i, ctx, CH, CHb, OL, OR, RAW) {
        const P = this.pool, H = st.H, R = st.R, kp = st.kp;
        // Vocode / Mask modulator rings (base rate, every chunk while the slot holds such a mode; per slot, §6.10.5), fed
        // before this chunk's frame reads them
        const m1 = this.cM1, m2 = this.cM2;
        if (m1 >= S_VOC0 && m1 <= S_MASK1 && st.u0 !== null && st.dn0 !== null) this.feedRing(st, 0, i, CH, CHb, ctx.mod1, ctx.modStride1);
        if (m2 >= S_VOC0 && m2 <= S_MASK1 && this.cShr === 0 && st.u1 !== null && st.dn1 !== null) {
          this.feedRing(st, 1, i, CH, CHb, ctx.mod2, ctx.modStride2);
        }
        // frame schedule (§6.10.1): the first hop synthesises frames kp, 0 and 1 (j = 0, 1, 2) at the stream's stagger
        // offset, one frame per chunk at most; frame k ≥ 2 during hop k − 1
        const kN = st.k, j = kN === kp ? 0 : kN <= 1 ? kN + 1 : -1;
        const due = j >= 0 ? floor((j * H + st.slot) / 3) : (kN - 1) * H + st.slot;
        if (st.t >= due) this.synth(st, i, ctx);
        // guard: a frame starting in this chunk exists before it is read (onset frames: by the last chunk of the first hop)
        while (st.k * H < st.t + CHb && (st.k >= 1 || st.t + CHb >= H)) this.synth(st, i, ctx);
        // OLA read. Onset (IMPL): the frames kp and 0 are ramped in by build(); while frames −R … −1 other than kp would
        // overlap (t < R·H, N/H ≥ 4) the output is normalised by the window sum of the frames present, C/D(t)
        const ola = st.ola, OLn = st.OL, yb = P.yb, tc = R >= 3 ? R * H : 0;
        let ri = st.t % OLn;
        for (let s = 0; s < CHb; s++) {
          let y = ola[ri];
          ola[ri] = 0;
          const t = st.t + s;
          if (t < tc && y !== 0) y *= this.onsetGain(st, t);
          yb[s] = y;
          if (++ri === OLn) ri = 0;
        }
        const fi = ctx.f[i], fon = fi > 0 ? +fi : 440;
        st.fon = st.t === 0 ? fon : st.fon;                       // the note-on frequency (D₀, §6.10.7; a store every chunk, M4)
        st.t += CHb;
        const xo = P.xo;
        st.up.process(yb, xo, CHb);
        // F/P-domain warps through the warp delay line, O-domain warps (§6.10.4 step 6, §6.10.7)
        if (st.line !== null) this.warpOut(st, i, ctx, CH, xo);
        // raw row (post warps, pre level/pan), gains
        const g = this.cNorm;
        if (RAW !== null) { const b = i * MAXCH; for (let s = 0; s < CH; s++) RAW[b + s] = xo[s] * g; }
        let gL = ctx.gl[i], gR = ctx.gr[i];
        const dL = ctx.dgl[i], dR = ctx.dgr[i];
        for (let s = 0; s < CH; s++) {
          gL += dL; gR += dR;
          const y = xo[s] * g;
          OL[s] += gL * y; OR[s] += gR * y;
        }
        // a One-shot stream played out: OLA drained (N/H + 2 silent frames), plus the warp line's delay when it was used
        if (st.end === 1 && st.sil > st.R + 2 + (st.dmix > 0 ? Math.ceil(2 * st.d0 / (P.os * H)) + 1 : 0)) st.done = 1;
      }
      // C/D(t) at onset time t < R·H: C = Σ w² of the full overlap (0.375·N/H), D = C minus the missing frames' w²
      onsetGain(st, t) {
        const H = st.H, N = st.N, hn = this.pool.hann, kp = st.kp, C = 0.375 * N / H;
        let D = C;
        for (let k = -st.R; k < 0; k++) {
          if (k === kp) continue;
          const n = t - k * H;
          if (n < N) { const w = hn[n]; D -= w * w; }
        }
        return D > 1e-3 ? C / D : C * 1e3;
      }
      // decimate slot kk's modulator (raw OS-rate output, column i mod stride) into the slot's base-rate ring (§6.10.5)
      feedRing(st, kk, i, CH, CHb, M, stride) {
        const P = this.pool, mg = P.mg, yb = P.dl, ring = kk === 0 ? st.u0 : st.u1, dn = kk === 0 ? st.dn0 : st.dn1;
        if ((kk === 0 ? st.rk0 : st.rk1) !== 2) {                // the buffer held Smear state or nothing: start an empty ring
          ring.fill(0); dn.reset();
          if (kk === 0) { st.rk0 = 2; st.rw0 = 0; st.zOn0 = 0; } else { st.rk1 = 2; st.rw1 = 0; st.zOn1 = 0; }
        }
        if (M !== null && typeof M === 'object' && M.length > 0) {
          const str = stride | 0;
          if (str > 0) { const u = i % str; for (let s = 0; s < CH; s++) mg[s] = M[s * str + u]; }
          else { const c = M[0]; for (let s = 0; s < CH; s++) mg[s] = c; }
        } else for (let s = 0; s < CH; s++) mg[s] = 0;
        dn.process(mg, yb, CHb);
        const n = ring.length;
        let w = kk === 0 ? st.rw0 : st.rw1;
        for (let s = 0; s < CHb; s++) { ring[w] = yb[s]; if (++w === n) w = 0; }
        if (kk === 0) st.rw0 = w; else st.rw1 = w;
      }
      // one synthesis frame of stream st (§6.10.2–§6.10.5) added into its OLA ring at T_k = k·H
      synth(st, i, ctx) {
        const P = this.pool, e = this.e, N = P.N, nb = (N >> 1) + 1, H = st.H, kk = st.k;
        const nbA = (e.N >> 1) + 1, hopA = e.hop, nh = kk - st.kl;   // nh: hops since the previous frame (kp → 0 jumps)
        P.mmK = -1;
        // playhead position of this frame (source samples), loop crossfade partner
        let silent = st.end === 1 ? 1 : 0, pos = 0, pos2 = 0, c1 = 1, c2 = 0;
        if (this.xyOn === 1) {
          const Lr = this.cLr, du = (this.nUS * this.uR[st.i] + this.nUP * st.i / this.nU) * Lr * this.cD;
          pos = this.cPos * this.cL + du;
          pos = pos > 0 ? (pos < this.cL ? pos : this.cL) : 0;
        } else if (silent === 0) {
          const q = st.q;
          pos = this.cS + this.cD * q;
          // loop crossfade (§6.7.4) on magnitudes, toward the wrap the playhead is travelling to (as SxSample): forward,
          // the wrap at b fades toward q − len (room before a); backward, the wrap at a toward q + len (room after b) — Fwd
          // and Rev loops alike (a Rev loop started backwards, or either scanned in reverse, wraps the other way). Tailed:
          // forward toward q − Lr/2 (the tail [Lr/2, Lr]); backward after a backward start toward q + Lr/2 (tail [0, Lr/2])
          const mode = this.cMode, a = this.cA, b = this.cB, len = b - a, fwd = this.cRate * st.pd >= 0;
          if ((mode === 1 || mode === 2) && st.inL === 1 && len >= 1 && this.cLx > 0) {
            let Lx = this.cLx;
            const room = fwd ? this.cRoomA : this.cRoomB;
            if (Lx > len * 0.5) Lx = len * 0.5;
            if (Lx > room) Lx = room;
            if (Lx > 0 && fwd && q > b - Lx) {
              const th = 0.5 * PI * (q - (b - Lx)) / Lx;
              c1 = cos(th); c2 = sin(th); pos2 = this.cS + this.cD * (q - len);
            } else if (Lx > 0 && !fwd && q < a + Lx) {
              const th = 0.5 * PI * ((a + Lx) - q) / Lx;
              c1 = cos(th); c2 = sin(th); pos2 = this.cS + this.cD * (q + len);
            }
          } else if (mode === 4 && this.cLr > 0 && (fwd || st.tb === 1)) {
            const half = 0.5 * this.cLr;
            let Lx = this.cLx > 0.01 * e.rate ? this.cLx : 0.01 * e.rate;
            if (Lx > half) Lx = half;
            if (fwd && q > this.cLr - Lx) {
              const th = 0.5 * PI * (q - (this.cLr - Lx)) / Lx;
              c1 = cos(th); c2 = sin(th); pos2 = this.cS + this.cD * (q - half);
            } else if (!fwd && q < Lx) {
              const th = 0.5 * PI * (Lx - q) / Lx;
              c1 = cos(th); c2 = sin(th); pos2 = this.cS + this.cD * (q + half);
            }
          }
        }
        const M = P.M;
        if (silent === 0) {
          let Pr = pos / hopA, P2r = pos2 / hopA;
          // a held read (Manual X|Y, σ = 0) stays on fully covered analysis frames: a frame whose window overlaps the
          // zero padding at either end, resynthesised every hop, beats (IMPL); shorter samples read their centre frame
          if (this.xyOn === 1 || this.cRate === 0) { Pr = held(e, Pr); if (c2 > 0) P2r = held(e, P2r); }
          const t0 = readFrame(P, e, Pr, st.pa, st.pav === 1, P2r, c1, c2);
          st.pa = Pr; st.pav = 1;
          // pitch (§6.10.3): ρ of this unison voice at synthesis time
          const fi = ctx.f[i], fr = this.cFroot;
          const rho = fi > 0 && fr > 0 ? (fi / fr) * this.cRhoK : 1;
          const s = rho * e.rate * N / (e.N * P.base);
          mapPitch(P, nbA, nb, s);
          // phase reference of a (re)started frame centred δo output samples before the note-on: the analysis phases
          // there moved back by δo (the onset frame kp is centred at the note-on: δo = 0)
          P.ph0 = st.cen < 0 ? TWO_PI * st.cen / N : 0;
          // edge frames (the analysis window overlaps the zero padding at either end of the sample) have incoherent
          // per-bin frequencies: their regions are phase-locked to the peak with the analysis phase offsets, and so is the
          // first frame after them, which replaces the edge frames' lobe phase relations by the clean ones (IMPL)
          P.edge = Pr * hopA < (e.N >> 1) || Pr * hopA + (e.N >> 1) > e.len ? 1 : 0;
          P.lk1 = 0;
          if (P.edge === 1) st.edg = 1; else if (st.edg === 1) { st.edg = 0; P.lk1 = 1; }
          // transient phase reset (once per flagged analysis frame)
          if (this.trans === 1 && e.trans[t0] === 1 && t0 !== st.lastTr) { st.lastTr = t0; st.dlt = 1; }
          // (1) Lo/Hi, (2) filter, (3) warps, (4) Lo/Hi post
          const binHz = P.base / N;
          if (this.postWarp === 0) bandLimit(M, nb, binHz, this.cFlo, this.cFhi, this.smooth);
          if (this.cMix !== 0 && this.cCurve !== null) specFilter(M, nb, P.xF, this.cCurve, this.o * 513, this.cCut, this.cMix);
          let tw = 0;
          const m1 = this.cM1, m2 = this.cM2;
          if (m1 >= S_COMB && m1 <= S_TWIST) tw += this.sWarp(st, ctx, 0, m1, this.amt(ctx, 0, st.i), nb);
          if (m2 >= S_COMB && m2 <= S_TWIST) tw += this.sWarp(st, ctx, 1, m2, this.amt(ctx, 1, st.i), nb);
          if (m1 !== S_SMEAR) st.zOn0 = 0;
          if (m2 !== S_SMEAR) st.zOn1 = 0;
          if (this.postWarp === 1) bandLimit(M, nb, binHz, this.cFlo, this.cFhi, this.smooth);
          let mx = 0;
          for (let j = 1; j < nb - 1; j++) if (M[j] > mx) mx = M[j];
          if (mx > 0) { this.build(st, nb, N, H, tw, nh); st.sil = 0; } else { this.idlePhases(st, nb, N, H, nh); st.sil++; }
        } else { this.idlePhases(st, nb, N, H, nh); st.sil++; }
        P.frames++;
        // next frame (kp → 0, then k + 1): advance the playhead by σ over the (clamped) centre-time step (§6.10.2)
        const kn = kk === st.kp ? 0 : kk + 1;
        st.kl = kk; st.k = kn;
        const c0 = st.cen, cn = c0 + (kn - kk) * H, step = (cn > 0 ? cn : 0) - (c0 > 0 ? c0 : 0);
        st.cen = cn;
        if (this.xyOn === 0 && st.end === 0 && step > 0) this.advance(st, this.cRate * step);
      }
      // phases without output (silent frames): keep the accumulators running at the bin frequencies
      idlePhases(st, nb, N, H, nh) {
        if (st.first === 1) return;
        const ph = st.ph, c = TWO_PI * H * nh / N;
        for (let j = 0; j < nb; j++) { let p = ph[j] + c * j; p -= TWO_PI * round(p / TWO_PI); ph[j] = p; }
      }
      // phases (advance / first frame / transient reset / Phase Lock), inverse FFT, synthesis window, overlap-add
      build(st, nb, N, H, tw, nh) {
        const P = this.pool, M = P.M, F = P.F, P0 = P.P0, ph = st.ph, re = P.re, im = P.im, x = P.x;
        if (st.first === 1 || st.dlt === 1) {
          // the analysis phase track at the read position, moved back by the pre-roll offset with the same frequencies
          // the following frozen-position frames advance by (so the two cancel exactly)
          const c0 = st.first === 1 ? P.ph0 : 0;
          for (let j = 0; j < nb; j++) { let p = P0[j] + c0 * F[j]; p -= TWO_PI * round(p / TWO_PI); ph[j] = p; }
          st.first = 0; st.dlt = 0;
        } else {
          const c = TWO_PI * H * nh / N;
          for (let j = 0; j < nb; j++) { let p = ph[j] + c * F[j]; p -= TWO_PI * round(p / TWO_PI); ph[j] = p; }
        }
        // identity locking (IMPL): on edge frames, the first frame after them, and whenever regions moved (pitch ≠ the root
        // ratio, moving spectral warps) every bin of a region takes its peak's phase plus the analysis phase difference,
        // φ_j = φ_q + (P0_j − P0_q) — the peak bins q propagate by their F (above); other frames keep the per-bin
        // propagation of §6.10.3
        if (((this.phLock === 0) & ((P.edge === 1) | (P.mv === 1) | (P.lk1 === 1))) !== 0) {
          const LK = P.LK;
          for (let j = 1; j < nb - 1; j++) {
            const q = LK[j];
            if (q < 0 || q === j || LK[q] !== q) continue;
            let v = ph[q] + P0[j] - P0[q];
            v -= TWO_PI * round(v / TWO_PI);
            ph[j] = v;
          }
        }
        if (this.phLock === 1) {
          // Phase Lock (§6.10.3, IMPL refinement): every bin of a peak region locks to the peak q every frame — the main lobe
          // (|j − q| ≤ 2 bins, the Hann main-lobe half width) takes φ_q + π·(j − q), the rest of the region (window
          // sidelobes, whose sign alternates) the analysis relation φ_q + (P0_j − P0_q). Regions: the merged peak regions of
          // the frame (LK); bins without a valid lock bin keep their propagated phase
          const LK = P.LK;
          for (let j = 1; j < nb - 1; j++) {
            const q = LK[j];
            if (q < 0 || q === j || LK[q] !== q) continue;
            const d = j - q;
            let v = d <= 2 && d >= -2 ? ph[q] + PI * d : ph[q] + P0[j] - P0[q];
            v -= TWO_PI * round(v / TWO_PI);
            ph[j] = v;
          }
        }
        const G = N / 4, tk = tw * 32 * PI / (nb * nb);
        re[0] = 0; im[0] = 0; re[nb - 1] = 0; im[nb - 1] = 0;
        for (let j = 1; j < nb - 1; j++) {
          const m = M[j] * G;
          if (m === 0) { re[j] = 0; im[j] = 0; continue; }
          let u = (ph[j] + tk * j * j) * SC_K;
          u -= SC_N * floor(u / SC_N);
          const q = u | 0, f = u - q, sn = SC[q] + (SC[q + 1] - SC[q]) * f, cs = SC[q + SC_Q] + (SC[q + SC_Q + 1] - SC[q + SC_Q]) * f;
          re[j] = m * cs; im[j] = m * sn;
        }
        P.fft.rinv(re, im, x);
        // overlap-add at T_k = k·H (stream time), skipping samples already played
        const wb = (H === (N >> 1) ? 0 : H === (N >> 2) ? 1 : 2) * N, ws = P.ws, ola = st.ola, OLn = st.OL;
        const Tk = st.k * H, e0 = st.t;
        let n0 = e0 - Tk;
        if (n0 < 0) n0 = 0;
        let idx = (Tk + n0) % OLn;
        if (idx < 0) idx += OLn;
        let n = n0;
        if (st.k <= 0 && n0 > 0 && e0 < H) {
          // an onset frame (kp, 0) synthesised after its start enters at 0 and is ramped in (raised cosine) from the first
          // unplayed sample to the end of the first hop, so no frame enters with a step (IMPL, §6.10.1 onset fade-in)
          const ir = PI / (H - e0);
          for (; n < N && Tk + n < H; n++) {
            ola[idx] += x[n] * ws[wb + n] * (0.5 - 0.5 * cos(ir * (Tk + n - e0)));
            if (++idx === OLn) idx = 0;
          }
        }
        for (; n < N; n++) {
          ola[idx] += x[n] * ws[wb + n];
          if (++idx === OLn) idx = 0;
        }
      }
      // S-domain warp slot kk (§6.10.5) on P.M / P.F; returns the Phase Twist amount (0 for other modes)
      sWarp(st, ctx, kk, mode, w, nb) {
        const P = this.pool, M = P.M, F = P.F;
        switch (mode) {
          case S_COMB: {
            if (w === 0) return 0;
            const Pp = 2 + 62 * (1 - w), d = w < 0.5 ? 2 * w : 1, dc = cos(TWO_PI / Pp), ds = sin(TWO_PI / Pp);
            let c = dc, s = ds;                                   // cos/sin(2πj/P) by rotation from j = 1
            for (let j = 1; j < nb; j++) {
              M[j] *= 1 - d * (0.5 - 0.5 * c);
              const c2 = c * dc - s * ds; s = s * dc + c * ds; c = c2;
            }
            return 0;
          }
          case S_GATE: {
            if (w === 0) return 0;
            let mx = 0;
            for (let j = 0; j < nb; j++) if (M[j] > mx) mx = M[j];
            const thr = w * w * mx;
            for (let j = 0; j < nb; j++) if (M[j] < thr) M[j] = 0;
            return 0;
          }
          case S_HARM:
            if (w === 0) return 0;
            moveRegions(P, nb, 0, 2, 0.5 * w, PEAK_FLOOR, 0, 0, 0);
            addCopies(P, nb, 3, 0.33 * w);
            return 0;
          case S_SUBH:
            if (w === 0) return 0;
            moveRegions(P, nb, 0, 0.5, 0.5 * w, PEAK_FLOOR, 0, 0, 0);
            addCopies(P, nb, 1 / 3, 0.33 * w);
            return 0;
          case S_SPREAD:
            if (w === 0) return 0;
            moveRegions(P, nb, 0, 1 + 2 * w, 1, PEAK_FLOOR, 1, 0, 0);
            return 0;
          case S_SMEAR: {                                        // per-slot state Z in the slot's buffer (first nb values)
            const z = kk === 0 ? st.u0 : st.u1;
            if (w === 0 || z === null) { if (kk === 0) st.zOn0 = 0; else st.zOn1 = 0; return 0; }
            if (kk === 0) { if (st.rk0 !== 1) { st.rk0 = 1; st.zOn0 = 0; } } else if (st.rk1 !== 1) { st.rk1 = 1; st.zOn1 = 0; }
            const on = kk === 0 ? st.zOn0 : st.zOn1, a = 1 - 0.97 * w;
            if (on === 0) { for (let j = 0; j < nb; j++) z[j] = M[j]; if (kk === 0) st.zOn0 = 1; else st.zOn1 = 1; }
            else for (let j = 0; j < nb; j++) { const v = z[j] + (M[j] - z[j]) * a; z[j] = v; M[j] = v; }
            return 0;
          }
          case S_DETUNE:
            if (w === 0) return 0;
            moveRegions(P, nb, 1, 1, 1, PEAK_FLOOR, 1, st.seed, w);
            return 0;
          case S_PKOCTU: case S_PKOCTD: case S_PKHARMU: case S_PKHARMD: {
            if (w === 0) return 0;
            const f = mode === S_PKOCTU ? 2 : mode === S_PKOCTD ? 0.5 : mode === S_PKHARMU ? 3 : 1 / 3;
            moveRegions(P, nb, 0, f, w, PEAK_THR, 0, 0, 0);
            return 0;
          }
          case S_SHEP: case S_SHEPN: {
            const cw = cos(TWO_PI * w), sw = sin(TWO_PI * w), C = P.shC, S = P.shS;
            for (let j = 1; j < nb; j++) {
              let g = 0.5 + 0.5 * (C[j] * cw + S[j] * sw);
              if (mode === S_SHEPN) { const g2 = g * g; g = g2 * g2 * g2; }
              M[j] *= g;
            }
            M[0] = 0;
            return 0;
          }
          case 71: case 72: case 73: case 74: case 75: case 76: {   // Vocode / Mask (B, C, Noise)
            // the slot's own modulator ring (slot 2 reads slot 1's when both are fed by the same modulator, cShr)
            const r = kk === 1 && this.cShr === 1 ? 0 : kk, ring = r === 0 ? st.u0 : st.u1;
            if (w === 0 || ring === null || (r === 0 ? st.rk0 : st.rk1) !== 2) return 0;
            if (P.mmK !== r) { this.modSpectrum(ring, r === 0 ? st.rw0 : st.rw1, nb); P.mmK = r; }
            const Mm = P.Mm;
            if (mode <= S_VOC1) {
              const EM = P.EM, EB = P.EB, vb = P.vb;
              bands(P, Mm, nb, EM); bands(P, M, nb, EB);
              for (let j = 1; j < nb; j++) {
                const r = bandAt(EM, vb[j]) / (bandAt(EB, vb[j]) > 1e-9 ? bandAt(EB, vb[j]) : 1e-9);
                const v = M[j] * (1 - w + w * r), cap = 16 * M[j];
                M[j] = v < cap ? v : cap;
              }
            } else {
              let mx = 0;
              for (let j = 0; j < nb; j++) if (Mm[j] > mx) mx = Mm[j];
              const k4 = mx > 0 ? 4 / mx : 0;
              for (let j = 0; j < nb; j++) { const r = Mm[j] * k4; M[j] *= 1 - w + w * (r < 1 ? r : 1); }
            }
            return 0;
          }
          case S_MIRROR: {
            if (w === 0) return 0;
            let q = round(nb * (0.02 + 0.48 * w));
            if (q < 1) q = 1;
            snap(P, nb, 0);
            const M2 = P.M2, F2 = P.F2, P2 = P.P2, P0 = P.P0, LK = P.LK, LK2 = P.LK2;
            for (let j = 1; j < 2 * q && j < nb; j++) {
              let src = 2 * q - j;
              if (src > nb - 1) src = nb - 1;
              M[j] = M2[src];
              const fm = 2 * q - F2[src], l = LK2[src] >= 0 ? 2 * q - LK2[src] : -1;
              F[j] = fm > 0 ? fm : 0; P0[j] = -P2[src]; LK[j] = l >= 1 && l < 2 * q && l < nb - 1 ? l : -1;
            }
            P.mv = 1;
            return 0;
          }
          case S_PSHIFT:
            if (w === 0.5) return 0;
            moveRegions(P, nb, 0, pow(2, (w - 0.5) * 4), 1, PEAK_FLOOR, 1, 0, 0);
            return 0;
          case S_PBLEND: {
            if (w === 0) return 0;
            snap(P, nb, 0);
            const M2 = P.M2, Wt = P.Wt;
            for (let j = 0; j < nb; j++) { M[j] = (1 - w) * M2[j]; Wt[j] = M[j]; }
            addCopies(P, nb, 2, w);
            return 0;
          }
          case S_SHIFT: {                                        // linear shift by Δ bins (fractional), frequencies + Δ
            if (w === 0.5) return 0;
            const dl = (2 * w - 1) * nb / 4, M2 = P.M2, F2 = P.F2;
            snap(P, nb, 1);
            let c = regions(P, M2, nb, PEAK_FLOOR);              // every region (they tile the spectrum), lobes re-rendered
            c = mergeRegions(P, M2, F2, c);
            const PK = P.PK, LO = P.LO, HI = P.HI;
            for (let r = 0; r < c; r++) {
              const p = PK[r], cen = centre(M2, F2, p, nb);
              place(P, M2, F2, P.P2, LO[r], HI[r], dl, 1, dl, 1, 1, nb, nb, lockBin(cen + dl, nb), sine(F2, p), cen);
            }
            return 0;
          }
          case S_TWIST:
            return w;
          default:
            return 0;
        }
      }
      // magnitude spectrum of a modulator ring (Hann over the last N base samples from write index rw, sine-amplitude units)
      modSpectrum(ring, rw, nb) {
        const P = this.pool, N = P.N, x = P.x, hann = P.hann, Mm = P.Mm, re = P.re, im = P.im;
        let r = rw;
        for (let n = 0; n < N; n++) { x[n] = ring[r] * hann[n]; if (++r === N) r = 0; }
        P.fft.rfwd(x, re, im);
        const g = 4 / N;
        for (let j = 0; j < nb; j++) Mm[j] = sqrt(re[j] * re[j] + im[j] * im[j]) * g;
      }
      // the playhead step of one frame (§6.7.3 loop modes in region coordinates)
      advance(st, dq) {
        const mode = this.cMode, a = this.cA, b = this.cB, Lr = this.cLr, len = b - a;
        const td = dq * st.pd, qu = st.q + td;
        let q = qu;
        const exitNow = this.exit === 1 && this.gate === 0;
        if (mode === 0 || exitNow) {
          if (q > Lr || q < 0) { st.end = 1; q = q > Lr ? Lr : 0; }
          st.q = q;
          return;
        }
        if (len < 1) {                                           // zero-length loop: hold at it once reached
          if (st.inL === 1 || (td >= 0 ? q >= a : q <= a)) { st.inL = 1; q = a; }
          else if (q < 0 || q > Lr) { st.inL = 1; q = a; }
          st.q = q;
          return;
        }
        switch (mode) {
          case 1:                                                // Fwd loop
            if (td >= 0) {
              if (q >= b) { q = a + modp(q - b, len); st.inL = 1; } else if (q >= a) st.inL = 1;
            } else if (q < a && (st.inL === 1 || q < 0 || st.q >= a)) { q = b - modp(a - q, len); st.inL = 1; }
            else if (q <= b) st.inL = 1;                         // travelling backwards: in the loop once past LE
            break;
          case 2:                                                // Rev loop: S → LE, then LE → LS backwards, LS jumps to LE
            if (st.inL === 0) {
              if (td >= 0 && q >= b) { st.inL = 1; st.pd = -st.pd; q = b - modp(q - b, len); }
              else if (td < 0 && st.tb === 1 && q <= a) { st.inL = 1; st.pd = -st.pd; q = a + modp(a - q, len); }   // mirror
              else if (td < 0 && q < 0) { st.inL = 1; q = b - modp(-q, len); }
            } else if (td < 0) {
              if (q < a) q = b - modp(a - q, len);
            } else if (q > b) q = a + modp(q - b, len);
            break;
          case 3: {                                              // Fwd/Rwd: ping-pong between LS and LE
            if (st.inL === 0) {
              const q0 = st.q;
              if ((q >= a && q <= b) || (q0 < a && q > b) || (q0 > b && q < a)) st.inL = 1;
              else if (q < 0 || q > Lr) { st.inL = 1; q = q < 0 ? a : b; }
            }
            if (st.inL === 1) {
              let guard = 0;
              while ((q > b || q < a) && guard++ < 64) {
                if (q > b) q = 2 * b - q; else q = 2 * a - q;
                st.pd = -st.pd;
              }
              if (q > b || q < a) q = a;
            }
            break;
          }
          default: {                                             // Tailed: S → E, then loop the tail [Lr/2, Lr]
            const half = 0.5 * Lr;
            if (q >= Lr && half > 0) { q = half + modp(q - Lr, half); st.inL = 1; }
            else if (q < 0 && st.tb === 1 && half > 0) { q = half - modp(-q, half); st.inL = 1; }   // E → S, tail [S, M]
            else if (q < 0) { st.end = 1; q = 0; }
          }
        }
        if (q !== qu) st.pav = 0;                                // a wrap: the next frame takes the slope, not the mean
        st.q = q;
      }
      // F/P-domain warps through the warp delay line, then O-domain warps (§6.10.4 step 6, §6.10.7), in place on the OS-rate
      // block x — for a stream with a line (Pool.fit: the patch can use F/P/O-domain modes and SxWarp is loaded; without
      // SxWarp these slots act as Off, §0.3). Every law is SxWarp's: incBlock (FM g(m)), pdBlock (PD offsets), Slots.pdI
      // (PD (Self) index), phaseBlock (P shapes, Sync window), outBlock (O stages); chunk() runs once per slot per chunk
      // with the slot's mode for this stream (its F/P mode, else its O mode, else Off)
      warpOut(st, i, ctx, CH, x) {
        const P = this.pool, fs = ctx.fs > 0 ? +ctx.fs : P.base * P.os, WD = this.B.WARP_DOM, W = this.W, sl = st.sl;
        if (W === null || sl === null) return;
        const m1 = this.cM1, m2 = this.cM2;
        const d1 = m1 > 0 && m1 < 82 ? WD[m1] : 0, d2 = m2 > 0 && m2 < 82 ? WD[m2] : 0;
        const fi = ctx.f[i] > 0 ? +ctx.f[i] : 440, T0 = 1 / fi, inc = fi / fs, T0s = T0 * fs;
        // the slots' F/P-domain modes shape the line; once none is left the last ones keep shaping the delayed read while
        // the line fades out (10 ms), so clearing a mode is as smooth as selecting it
        const f1 = d1 === D_F || d1 === D_P, f2 = d2 === D_F || d2 === D_P, fp = f1 || f2;
        let l1 = f1 ? m1 : 0, l2 = f2 ? m2 : 0;
        if (st.d0 < 0) {                                         // D₀ fixed from the note-on frequency (§6.10.7)
          let d0 = 2 / st.fon;
          if (d0 > D0_MAX) d0 = D0_MAX;
          st.d0 = d0 * fs;
          if (st.d0 < 4) st.d0 = 4;
          if (fp && st.t === CH / P.os) st.dmix = 1;             // a mode selected at note-on delays from the start (no fade)
        }
        if (fp) { st.lm1 = l1; st.lm2 = l2; } else if (st.dmix > 0) { l1 = st.lm1; l2 = st.lm2; }
        // O-domain modes (a slot still fading out its last F/P mode starts its new O mode once the fade has ended)
        const o1 = d1 === D_O && l1 === 0 ? m1 : 0, o2 = d2 === D_O && l2 === 0 ? m2 : 0;
        const w1 = this.amt(ctx, 0, i), w2 = this.amt(ctx, 1, i);
        this.slotSetup(sl, 0, l1 !== 0 ? l1 : o1, w1, this.cV1, this.fm1, fi, fs);
        this.slotSetup(sl, 1, l2 !== 0 ? l2 : o2, w2, this.cV2, this.fm2, fi, fs);
        // running fundamental phase θ (unwarped φ per sample)
        const ph = P.ph;
        let th = st.th;
        for (let s = 0; s < CH; s++) { ph[s] = th; th += inc; if (th >= 1) th -= 1; }
        st.th = th;
        // the line is written every chunk (Odd/Even and mode changes read its history); dm = the per-sample delayed share,
        // dl = the per-sample read delay
        const line = st.line, LL = st.LL, dm = P.dm, dl = P.dl, win = P.win, lw0 = st.lw;
        let lw = lw0, hasWin = 0;
        if (l1 === 0 && l2 === 0 && st.dmix === 0) {
          for (let s = 0; s < CH; s++) { line[lw] = x[s]; dm[s] = 0; if (++lw === LL) lw = 0; }
          st.lw = lw;
        } else {
          // per-sample delay offsets Δ (samples), summed in slot order: P shapes (phaseBlock on θ), PD, FM
          for (let s = 0; s < CH; s++) dl[s] = 0;
          const pk1 = l1 !== 0 && WD[l1] === D_P && !(l1 >= W_PD0 && l1 <= W_PD1);
          const pk2 = l2 !== 0 && WD[l2] === D_P && !(l2 >= W_PD0 && l2 <= W_PD1);
          if (pk1 || pk2) {
            const ph2 = P.x2, rt = this.cRemap, rb = this.cRb;
            for (let s = 0; s < CH; s++) ph2[s] = ph[s];
            if (pk1) W.phaseBlock(sl, 0, 0, l1, w1, this.cV1, rt, rb, ctx.mod1, ctx.modStride1 | 0, ph2, ph2, win, CH, i);
            if (pk2) W.phaseBlock(sl, 1, 0, l2, w2, this.cV2, rt, rb, ctx.mod2, ctx.modStride2 | 0, ph2, ph2, win, CH, i);
            hasWin = sl.hw[0] | sl.hw[1];
            for (let s = 0; s < CH; s++) { let d = ph2[s] - ph[s]; if (d > 0.5) d -= 1; else if (d < -0.5) d += 1; dl[s] += d * T0s; }
          }
          if (l1 !== 0) this.fpSlot(st, sl, 0, l1, w1, ctx.mod1, ctx.modStride1, CH, fs, T0s, i);
          if (l2 !== 0) this.fpSlot(st, sl, 1, l2, w2, ctx.mod2, ctx.modStride2, CH, fs, T0s, i);
          // read y = x(t − D₀ + Δ), Δ clamped to ±(D₀ − 2), PD (Self) fed back per sample (I·y₁·T₀, y₁ = the previous raw
          // line read, SxWarp header); crossfade from/to the undelayed signal over 10 ms
          // (a line added to a sounding stream by a patch change fades in only once it holds 2·D₀ of history)
          const D0 = st.d0, lim = D0 - 2, tgt = fp && st.lh >= 2 * D0 ? 1 : 0, xf = 1 / (XF_SEC * fs), iS = (sl.pdI[0] + sl.pdI[1]) * T0s;
          let dmx = st.dmix, y1 = st.y1;
          for (let s = 0; s < CH; s++) {
            const xin = x[s];
            line[lw] = xin;
            let dd = dl[s] + iS * y1;
            dd = dd > lim ? lim : dd < -lim ? -lim : dd;
            let y = lineAt(line, LL, lw, D0 - dd);
            y1 = y;
            if (hasWin) y *= win[s];
            if (dmx !== tgt) { dmx += tgt > dmx ? xf : -xf; dmx = dmx > 1 ? 1 : dmx < 0 ? 0 : dmx; }
            x[s] = xin + (y - xin) * dmx;
            dm[s] = dmx; dl[s] = D0 - dd;
            if (++lw === LL) lw = 0;
          }
          st.dmix = dmx; st.y1 = y1; st.lw = lw;
        }
        if (st.lh < st.LL) st.lh += CH;
        // O-domain warps (SxWarp.outBlock per stream, slot order)
        if (o1 !== 0 || o2 !== 0) {
          let x2 = null;
          if (o1 === W_ODDEVEN || o2 === W_ODDEVEN) {
            // the second read half a period away through the same delay, Sync window and crossfade as x (§6.10.7: Odd/Even
            // uses the same φ; SxWarp: y = O₂(O₁(x·win)) for both reads), passed to both slots
            x2 = P.x2;
            const half = 0.5 * T0s;
            let wp = lw0;
            for (let s = 0; s < CH; s++) {
              const u = lineAt(line, LL, wp, half), g = dm[s];
              if (g > 0) {
                let d = lineAt(line, LL, wp, dl[s] + half);
                if (hasWin) d *= win[s];
                x2[s] = u + (d - u) * g;
              } else x2[s] = u;
              if (++wp === LL) wp = 0;
            }
          }
          if (o1 !== 0) W.outBlock(sl, 0, 0, o1, w1, this.cV1, ctx.mod1, ctx.modStride1 | 0, x, x2, ph, CH, i);
          if (o2 !== 0) W.outBlock(sl, 1, 0, o2, w2, this.cV2, ctx.mod2, ctx.modStride2 | 0, x, x2, ph, CH, i);
        }
      }
      // SxWarp.chunk for slot kk of a stream's Slots(1)
      slotSetup(sl, kk, mode, w, v, fm, fi, fs) {
        const P = this.pool;
        P.w1a[0] = w; P.fia[0] = fi;
        this.W.chunk(sl, kk, mode, P.w1a, v, fm, P.fia, fs);
      }
      // PD 39–44: Δ += SxWarp.pdBlock offset (periods) · T₀; FM 33–38: Δ += z, z ← (z + g(m) − 1)·(1 − 2π·5/fs) with g(m)
      // from SxWarp.incBlock(inc = 1) (samples; the 5 Hz leak keeps Exp FM's mean pitch rise from accumulating, §6.10.7)
      fpSlot(st, sl, kk, mode, w, Mo, str, CH, fs, T0s, i) {
        const P = this.pool, dl = P.dl, ms = str | 0;
        if (mode >= W_PD0 && mode < W_PDSELF) {
          const o = P.pdo;
          if (this.W.pdBlock(sl, kk, 0, mode, w, Mo, ms, o, CH, i) === 1) for (let s = 0; s < CH; s++) dl[s] += o[s] * T0s;
        } else if (mode >= W_FM0 && mode <= W_FM1) {
          const g = P.gm, leak = 1 - FM_LEAK / fs;
          this.W.incBlock(sl, kk, 0, mode, kk === 0 ? this.fm1 : this.fm2, w, Mo, ms, P.one, g, CH, i);
          let z = kk === 0 ? st.fz0 : st.fz1;
          for (let s = 0; s < CH; s++) { z = (z + (g[s] - 1)) * leak; dl[s] += z; }
          if (kk === 0) st.fz0 = z; else st.fz1 = z;
        }
      }
      // return the held streams to the pool (when it is still the generation they came from)
      release() {
        const P = this.pool, si = this.si;
        if (P !== null && P.gen === this.pgen) {
          for (let i = 0; i < this.nS; i++) P.give(si[i]);
          if (this.capped === 1 && P.nCapped > 0) P.nCapped--;
        }
        for (let i = 0; i < MAXUNI; i++) si[i] = -1;
        this.nS = 0; this.capped = 0;
      }
      // forget streams of a rebuilt pool (its new generation starts with every stream free)
      drop() {
        const si = this.si;
        for (let i = 0; i < MAXUNI; i++) si[i] = -1;
        this.nS = 0; this.capped = 0;
      }
      kill() {
        this.release();
        this.on = 0; this.gate = 0; this.fresh = 0; this.nU = 0; this.init = 0; this.done = 0;
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
      }
      active() { return this.on === 1 && this.done === 0; }
      grains() { return 0; }
    }
    // copies of the snapshot's peak regions (taken by the previous moveRegions/snap call) at frequency × f, amplitude amp
    function addCopies(P, nb, f, amp) {
      const M2 = P.M2, F2 = P.F2, P2 = P.P2;
      let c = regions(P, M2, nb, PEAK_FLOOR);
      c = mergeRegions(P, M2, F2, c);
      const PK = P.PK, LO = P.LO, HI = P.HI;
      for (let r = 0; r < c; r++) {
        const cen = centre(M2, F2, PK[r], nb);
        place(P, M2, F2, P2, LO[r], HI[r], (f - 1) * cen, f, 0, f, amp, nb, nb, lockBin(f * cen, nb), sine(F2, PK[r]), cen);
      }
    }

    function prep(base) {
      const B = sxBase();
      if (B === null) return false;
      base = base > 0 ? +base : 48000;
      const N = specN(base);
      tablesOf(N, base);
      new B.FFT(N);                                              // (SxBase caches the FFT tables per size)
      return true;
    }

    globalThis.SxSpec = Object.freeze({ VER, MAXCH, MAXUNI, NSL, MAXSTREAMS, K, specN, hopOf, slotOf, prep, Pool, poolOf, capOf, SpecOsc });
  } catch (err) {
    globalThis.SxSpec = null;                                  // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-spec: load failed', err);
  }
})();
