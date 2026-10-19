/*
 * serum-dsp.js — Serum-style voice DSP (classic script, no imports/exports).
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread (<script> injected by wk.loadDSP)
 * and in node vm contexts (tests). The whole file is one IIFE that publishes `globalThis.SerumDSP`; it can be
 * evaluated again in the same scope (the wavetable Map survives), and a failure inside leaves SerumDSP = null
 * without throwing. Contract: SPEC-serum.md §8.4 (exports), §3 (constants), §5 (modulation), §6 (voice
 * behaviour), §7 (wavetable data); SPEC-serum2 §11.10 (v2 exports), §4.1 (CP v2 / CT v2), §0.3 (script list).
 *
 * Phase 2 (SPEC-serum2; M1a: the D1+D2 joint edit, M2: the complete v2 voice): VER 2, reads CP v2 (voice vector by vi,
 * 429 slots; 62 sources; 64 rows; FX rows by FX-context index). The modulation code (envelopes, LFOs, chaos, macros,
 * base smoothing, the matrix in the voice/mono/FX contexts) lives in sx-mod.js (`SxMod`, read lazily in attach and the
 * SerumVoice constructor; missing ⇒ Serum voices are silent, one warning per scope). Each SerumVoice holds
 * `this.mod = new SxMod.ModV(this)`; `eff`, `src` and `eV` are aliases of the ModV's arrays. The CT arrives either as
 * CT v2 parts (`{key, parts}`, §4.1: merged allocation-free into a preallocated full CT, `mergeCT`) or as a full CT
 * object (tests, warmUp).
 * The v2 voice (§1, §6): OSC A/B/C of every type — Wavetable here (Phase-1 reader, Smooth Interpolation, both WARPS2
 * slots through the SxWarp block kernels, PD Self per sample), Sample/Multisample (SxSample), Granular (SxGran) and
 * Spectral (SxSpec) through the common oscillator contract (§11.8: the voice fills an OscCtx per chunk); pitch modes
 * Semitones/Harmonics/Ratio/Step, Hz offset, tuning table, S2 bend ranges, MPE per-note bend (§6.3); the phase-memory
 * menu and Phase Legato (§6.4); warp sources, availability and the render-order/cycle rule (§6.6.6); keyboard mapping
 * with fold/warp (§6.2); S2 sub (6 shapes, n² level, phase, Contiguous) and colour noises (§6.11); the mixer (§6.12:
 * per-channel routes Filter/Main/Direct/None, filter balance, switch ramps, ENV toggles, Bus 1/2 sends; outputs main,
 * direct, bus 1, bus 2 per CP.outMask); Filter 1 and Filter 2 (types 0–107: SFilter delegates 96–107 to SxFilt2
 * families allocated only in apply/prealloc), routed into each other or out, Clean Mode, PZ SVF corners, key track
 * per mode (§6.13); Voice Control offsets (pan, detune, cutoff; §6.2/§6.16); the lifetime rules incl. the 2 ms grain
 * fade (§6.19); snapshot v2 (§6.20); `allocate` with the Voice Steal Priority (§12.3). S1 mode (§6.21) keeps the
 * Phase-1 code path for its seven items; every Phase-2 term is skipped at its neutral value (§0.7).
 *
 * Layout of this file:
 *   constants (destinations, voice vector v2, sources, families, unison tables, WARPS2 domains) · fast math · curves ·
 *   table store · SFilter (108 types) · CT store (mergeCT) · per-processor state (attach/begin/idle/transport/
 *   reset/fxMods/snapshot/allocate) · mixer helpers · Phase-1 warps · SerumVoice (note-on, pitch, oscillator setup,
 *   wavetable reader, type oscillators, mixer, filters, sub, noises) · renderWarp · warmUp · exports.
 *
 * Hot paths (SerumVoice.render, SFilter.tick/process, begin, mergeCT) never allocate: every buffer is created in a
 * constructor, in attach/apply/setType/prealloc/storeWT, or once at load (module scratch, shared by every voice
 * of the scope — processors run one after another on the audio thread).
 *
 * Implementation choices where the spec leaves room (IMPL-free) or is silent:
 *  - Timing inside a chunk: sources are read at the chunk start, gains/levels computed from them are the ramp
 *    *targets* of that chunk (ramped from the previous chunk's targets), then envelopes/LFOs/chaos/portamento
 *    advance by one chunk with this chunk's eff values (= "previous chunk's eff" for the next one, §5.6).
 *    Zero-length envelope stages are settled at note-on (attack 0 → level 1 at once); the note-on evaluation
 *    (§6.1) still sees the envelopes' pre-trigger values (0 for a fresh voice).
 *  - A destination whose last voice-context row disappears (row removed, bypassed, amount 0, re-targeted) returns
 *    to its smoothed base at the voice's next chunk (each voice keeps the modded mask it last evaluated).
 *  - Mip levels (§7.4, lead sign-off on deviation 9): hysteresis + one-chunk crossfade on a level change; where
 *    the octave a switch drops is audible (flim/2 < 20 kHz, i.e. OS 1) the richest alias-safe level is instead
 *    blended continuously with the next one over the third of an octave below its limit (selBlend; unwarped
 *    reads fuse both levels in one loop). Level 0 (1023 harmonics in 2048 samples, only 2× oversampled) has
 *    Hermite images just above flim that fold into the audible band: with hysteresis it is taken only from
 *    H ≥ m0·1023, m0 = clamp(flim / (2·min(20 kHz, 0.45·base)), 1, 1.4) (level 1 still reaches the audible limit).
 *  - Interpolating tables: when the frame pair changes between chunks (fast or stepped WT position), the chunk
 *    crossfades the old pair (at its last position) into the new pair, like the discrete one-chunk crossfade.
 *  - A steal that lowers the unison count fades the dropped unison voices out over one chunk.
 *  - Env-mode LFOs with BPM + Anchor: φ = lfoStart + Δbeat/beats unwrapped (§6.12), held at 1, or wrapped into
 *    [lfoLoop, 1) while gated; after note-off a looping LFO accumulates from its phase to the end.
 *  - NOTE is re-sampled on mono legato notes (note.porta off: the new key; on: the gliding pitch); VELO only with
 *    velo.porta (§5.3). CP.veloPorta / CP.notePorta come from serum-core (§2.2).
 *  - CP/serum versions: a CP whose major version (floor(ver)) differs from VER is silent (§4.3).
 *  - reset(proc) keeps sx.mon (the host's smon subscription, §11.5 sets it only on the message); every other field
 *    returns to its attach state (the merged CT store is a cache of proc.ct and is kept; the multisample round-robin
 *    counters SxSample keeps in sx.msRR are zeroed). A voice whose processor was reset (or warmed up) re-syncs the CP
 *    at its next noteOn/render, so notes between a panic and the next begin are not lost.
 *  - transport(proc, true) also clears lastPitch, memPh, recent, the per-voice part of monoSrc, vcN (SxMod) and the
 *    round-robin counters sx.msRR (bookkeeping a fresh offline render does not have), so a song rendered from a tick is
 *    identical live and offline (§6.16, §7.8). Both warm-ups restore proc.vcN and sx.msRR after their hidden notes.
 *  - mergeCT(proc, serumT) takes a `{key, parts}` object holding any subset of the CT v2 parts (the engine wraps a
 *    single `{t: 'ct', part}` that way); invalid parts are ignored (one warning per part name).
 *  - renderWarp without opts.mod uses m = 0 with the mode active (AM → x·(1 − w/2), RM → x·(1 − w)), as §8.4.2
 *    states; the voice treats a switched-off modulator as "identical to Off" (§3.3).
 *  - SFilter: SVF damping k = √2 − r·sat(bp), r = √2·0.99·res (small-signal Q = 0.7071/(1 − 0.99·res)) with a
 *    soft 2·tanh(bp/2) limit on the resonance part (FAT on top for Normal types); Peak = x + 4·res·(k·bp); comb
 *    feedback 0.995·res (output × √(1 − fb²)), flange/phaser/fphs 0.9·res, all with 2·tanh(·/2) in the loop;
 *    bank DAMP = one-pole in the loop (coefficient 1 − 0.9·var); French LP = 2× driven ladder (stage level 1)
 *    with 8·var·BP(2·cutoff, Q 2) fed back, output halved; German LP = linear ZDF ladder with a 4·tanh(y/4)
 *    feedback limit; first-order EQ shelves put their midpoint gain at the cutoff; every family output passes a
 *    safety limiter above |8| (bounded by 12) and a non-finite state resets the filter.
 *  - (M2) Keyboard fold (§6.2) when no octave transpose fits the range: of the two transposes next to the range (one
 *    above hi, one below lo) the nearer one picks its bound (ties: the bound on the side of the played key).
 *  - (M2) Granular X|Y with Y → Level / Warp / Warp 2 (§3.9, the targets SxGran leaves to the voice): the Y mode acts on
 *    the eff n of the oscillator's LEVEL / WARP / WARP 2 before the unison spread; Spectral applies its Y itself.
 *  - (M2) S2 filter key track without a tracking oscillator: the played key, tuned when a tuning table is loaded.
 *  - (M2) Lifetime with grains still sounding (§6.19): the voice keeps rendering for ⌈2 ms / chunk⌉ chunks while its
 *    channel gains ramp linearly to 0, then ends (the grains go back to the processor count). (review 4) Rule (b) always
 *    ends with that fade: its ENV-off channels play unattenuated until then (a hard cut would click).
 *  - (M2) warmUp (§11.10) runs the Phase-1 synthetic patch, then 20 ms of a complete S2 CP: OSC C with both WARPS2 slots
 *    swept over every wavetable mode (0–57), Filter 1/2 swept over the 108 types (LFO 1 at ≈ 66 Hz), Sample +
 *    Multisample oscillators on two tiny synthetic assets (stored in SxBase for the run, dropped afterwards), colour
 *    noise, S2 sub, F1 → F2, Direct, buses, MPE, tuning, VC and the LFO types (≈ 1.3 × the Phase-1 warmUp; budget 1.5×).
 *  - (review 3) Colour noise (§6.11.2): white is −12 dBFS RMS in the audible band (generated at the OS rate, audio
 *    outputs × √OS: the decimator keeps 1/OS of its power); streams a/b are seeded from two r2 draws through fmix32 with
 *    different salts (unrelated at every lag). Geiger clicks ±(0.5 + 0.5u) take the sign and u from two separate draws.
 *    (review 4) Every colour is −12 dBFS RMS: Geiger through one gain per rate calibrated at 40 clicks/s (PITCH 0), so
 *    the click size stays independent of PITCH (the RMS follows the click rate; peaks reach ≈ +15 dBFS at LEVEL 1, the
 *    crest factor of sparse 0.15 ms clicks); brown's integrator is rate-independent (leak 0.002·base/fs, input gain
 *    0.0414·√(base/fs): §6.11.2's recipe at OS 1, the same corner and spectrum at every OS); the raw noise (warp Noise
 *    modulator, `noise` source) keeps the per-sample calibration at every OS (white's √OS only on the audio outputs).
 *  - (review 3/4) Filter memory (§6.13.1, §14.2): SxFilt2's delay families (Diffusor, Comb 2: 20 Hz floor, their own
 *    sizing) borrow their SFilter's pool (sized by the largest reachable family, not the sum). Types 0–95 keep the
 *    Phase-1 line sizes (8 Hz cutoff clamp) in both filters and the FX Filter (§3.5 "unchanged", §6.21 item 8).
 *    DEVIATION (ARCH2 rule 1 over §14.2, for the lead): the Phase-1 delay families exceed "both filters ≤ 2 MB at base
 *    192 kHz" — the FDN bank (82) takes 1.06 MiB per filter at fs 192 kHz and 2.13 MiB at fs 384 kHz (base 192 kHz,
 *    OS 2), so both filters on it (or both types modulated over a range that reaches it) take 4.26–4.28 MiB per voice
 *    there, in S1 and S2 mode alike (S1-mode Filter 1 on 82 + Filter 2 on the Diffusor: 3.10 MiB); 2.13–2.16 MiB at fs
 *    192 kHz, 1.06 MiB at base 48 kHz, OS 2. The new types alone stay ≤ 1.94 MiB for both filters at fs 384 kHz.
 *    Meeting the budget would need a 20 Hz floor on the Phase-1 types (their tuning below 20 Hz would change).
 *  - (review 3) Lifetime rule (b) (§6.19): an envelope is idle once its release has finished (stage 0), whatever End
 *    level it holds (inv B13); SxMod's envsIdle decides (a bypassed ENV 4 takes no part).
 *  - (review 3) Per-chunk gains ramp across the chunk from the previous chunk's value, like the Phase-1 gains: filter
 *    levels, filter balance shares, bus send gains and the filter-to-filter feed level (unchanged values take the
 *    plain path, so §0.7 neutral patches stay bit-identical).
 *  - (review 3) The Filter-k warp buffers (§6.6.7) are rewritten in every chunk while any WARPS2 slot can exist (zeros
 *    while filter k is off), so a slot switched to Filter k reads the previous chunk; audio taps (§5.3) come from the
 *    CP rows (sx.srcU, not SxMod's private srcUsed) and a switched-off oscillator neither renders for its tap nor reads
 *    other than 0. Keys a .kbm leaves unmapped (CP.tune NaN) get no voice (allocate → null) and noteOn ignores them.
 *  - (review 3) Lazy warm-ups (§11.10): an apply that selects Granular queues GRAN_JOB through SxBase.warmAdd (live
 *    processors only; key 'sx-gran:<asset id>'). warmTick runs one lazy step in every state (waiting for tables,
 *    rendering, after giving up) and returns hidden spans + lazy jobs left. (review 4) GRAN_JOB is bounded (§14.1 row q):
 *    two hidden voices of its own (two reach the processor grain cap, as real chords do), made, applied and started in
 *    separate steps, then one voice per step (alternating) rendering 1 chunk in the first steps and 2 afterwards; it
 *    runs after the first-use hidden voices (which leave Granular oscillators silent) and once the Granular assets are
 *    stored (waits up to HW_WAIT steps); the first-use hidden voices also wait for the Sample, Multisample (with its zone
 *    samples) and Spectral assets. Hidden voices never write the channel meters (sx.pk).
 *  - (review 4) SFilter (§6.13.1): prealloc(true) covers 0–107; setType of a type that is not modulated (no prealloc(true))
 *    makes its SxFilt2 object (an apply path by the Phase-1 contract, as the Phase-1 families allocate their lines); a
 *    modulated type missing from the preallocated range passes unfiltered and is allocated by the next prealloc call.
 *  - (M4 performance; every item leaves the output bit for bit as it was) the one-frame wavetable read is written out in
 *    renderWT (whether V8 inlined the plain1 call, and so boxed its six doubles, depended on the inlining budget the other
 *    paths left: row a ran 1.1–1.7× Phase 1); per oscillator a "unison gains all 0" flag (gz) spares a switched-off
 *    oscillator its 16-slot scan, its output clearing and (lazy oscPitch) its pitch; SFilter flushes only the states its
 *    family can hold (flushFam) and set() skips the flush while the state is as process() left it (cln); a filter input
 *    whose switch is off and settled adds nothing to u (addSrc). Warm-ups: GRAN_JOB's second hidden voice runs time-
 *    compressed (SxGran wq) and is retriggered, the first-use hidden voices retrigger their first note a quarter in (a
 *    note's first chunk then runs with type feedback in place — the hidden voices' own first chunks ran before V8 had
 *    allocated it) and a Spectral patch plays them HW_SPANS_SPEC spans (its frame code reached optimised code only then):
 *    the paths a real chord meets later in a note, which V8 deoptimised mid-chord (4–6 ms quanta), are warm.
 */
(function () {
  'use strict';
  const prev = globalThis.SerumDSP;                         // idempotent re-evaluation
  try {
    const tables = (prev && prev.tables) || new Map();       // the wavetable Map MUST survive re-evaluation
    let epoch = prev && prev.epoch >= 0 ? prev.epoch + 1 : 0;

    // Math functions as locals: in a node vm context every global lookup goes through the context interceptor
    // (≈ 10× slower hot loops). Typed-array constructors stay global lookups on purpose: they are only used in
    // constructors, and the allocation-free tests (§10.1) replace them on the context to catch hot-path allocation.
    const exp = Math.exp, tan = Math.tan, sqrt = Math.sqrt, floor = Math.floor, ceil = Math.ceil, round = Math.round,
      sin = Math.sin, cos = Math.cos, log = Math.log, mlog2 = Math.log2, pow = Math.pow, PI = Math.PI,
      SQRT2 = Math.SQRT2, LN10 = Math.LN10, imul = Math.imul;

    const VER = 2;
    const NS = 148, NF = 100, ND = 248, NSRC = 34, MAXCH = 32, TAP_N = 1024, NTYPES = 96, MAX_PTS = 480;
    const NSV = 429, NSRC2 = 78, NROW = 64, MAXFX = 8 + 48 * 24, N_LFO = 10, N_ENV = 4, N_OSC = 3;   // CP v2 shapes (§4.1; NSRC2 62 + 16 canvas ext inputs, IMPL-2b §3.2)
    const S_EXT0 = 62, N_EXT = 16;
    const CURVE_K = 10;
    const MIDI0 = 440 * pow(2, -69 / 12);                   // 8.175798915643707 Hz (MIDI note 0)
    const MIDI128 = 440 * pow(2, 59 / 12);                  // 13289.75 Hz (MIDI note 128)
    const MIP_HARM = [1023, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];

    /* ------------------------------------------------------------ destinations (§3.13) */
    // Law indices (§3.1).
    const LIN = 0, INT = 1, ENUM = 2, BOOL = 3, EXP = 4, POW2 = 5, POW3 = 6, POW4 = 7, POW5 = 8, RPOW3 = 9, RATIO = 10,
      NPITCH = 11;
    // Built in DEST index order, mirroring the generator of the spec tables (exp/gen.mjs): [id, law, lo, hi].
    const DIDS = [], DLAW = [], DLO = [], DHI = [];
    const dst = (id, law, lo, hi) => { DIDS.push(id); DLAW.push(law); DLO.push(lo); DHI.push(hi); };
    const grp = (pre, rows) => { for (let i = 0; i < rows.length; i += 4) dst(pre + rows[i], rows[i + 1], rows[i + 2], rows[i + 3]); };
    for (const o of ['a', 'b']) {
      grp(o + '.', ['level', POW2, 0, 1, 'pan', LIN, -1, 1, 'oct', INT, -4, 4, 'semi', INT, -12, 12, 'fine', LIN, -100, 100,
        'crs', LIN, -64, 64, 'uni', INT, 1, 16, 'det', POW2, 0, 1, 'blend', LIN, 0, 1, 'phase', LIN, 0, 360,
        'rand', LIN, 0, 1, 'wt', LIN, 0, 1, 'warp', LIN, 0, 1, 'uniw', LIN, 0, 1, 'uniwarp', LIN, -1, 1,
        'uniwt', LIN, -1, 1, 'stack', ENUM, 0, 8]);
    }
    grp('n.', ['level', POW2, 0, 1, 'pitch', NPITCH, -200, 48, 'fine', LIN, -100, 100, 'pan', LIN, -1, 1,
      'rand', LIN, 0, 1, 'phase', LIN, 0, 1]);
    grp('s.', ['level', LIN, 0, 1, 'pan', LIN, -1, 1]);
    grp('f.', ['cutoff', EXP, MIDI0, 22050, 'res', LIN, 0, 1, 'drive', LIN, 0, 1, 'var', LIN, 0, 1, 'mix', LIN, 0, 1,
      'pan', LIN, 0, 1]);
    for (let e = 1; e <= 3; e++) {
      grp('e' + e + '.', ['att', POW5, 0, 32, 'hold', POW5, 0, 32, 'dec', POW5, 0, 32, 'sus', e === 1 ? POW2 : LIN, 0, 1,
        'rel', POW5, 0, 32]);
    }
    for (let l = 1; l <= 8; l++) grp('l' + l + '.', ['rate', POW4, 0, 100, 'rise', LIN, 0, 4, 'delay', LIN, 0, 4, 'smooth', LIN, 0, 1]);
    grp('', ['c1.rate', POW5, 0, 1000, 'c2.rate', POW5, 0, 1000]);
    grp('g.', ['porta', POW5, 0, 8, 'curve', LIN, -1, 1, 'tune', LIN, -64, 64, 'amp', POW2, 0, 1, 'bendup', INT, -24, 24,
      'benddn', INT, -24, 24]);
    for (let b = 1; b <= 16; b++) dst('bus' + b, LIN, -1, 1);
    grp('', ['a.on', BOOL, 0, 1, 'b.on', BOOL, 0, 1, 'n.on', BOOL, 0, 1, 's.on', BOOL, 0, 1, 'f.on', BOOL, 0, 1,
      'f.routeA', BOOL, 0, 1, 'f.routeB', BOOL, 0, 1, 'f.routeN', BOOL, 0, 1, 'f.routeS', BOOL, 0, 1,
      'a.track', BOOL, 0, 1, 'b.track', BOOL, 0, 1, 'a.warpMode', ENUM, 0, 22, 'b.warpMode', ENUM, 0, 22,
      's.shape', ENUM, 0, 4, 's.oct', INT, -4, 4, 'f.type', ENUM, 0, 95]);
    for (let e = 1; e <= 3; e++) grp('e' + e + '.', ['ca', LIN, 0, 1, 'cd', LIN, 0, 1, 'cr', LIN, 0, 1]);
    grp('', ['c1.bpm', BOOL, 0, 1, 'c2.bpm', BOOL, 0, 1, 'g.wheel', LIN, 0, 1, 'g.bend', LIN, -1, 1]);
    if (DIDS.length !== NS) throw new Error('synth segment has ' + DIDS.length + ' destinations');
    // FX segment (fx idx = idx − 148)
    const LVL = ['level', POW2, 0, 4];
    dst('g.master', POW3, 0, 1);
    grp('fx.hyper.', ['on', BOOL, 0, 1, 'rate', LIN, 0, 1, 'detune', LIN, 0, 1, 'unison', INT, 0, 7, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.dim.', ['size', LIN, 0, 1, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.dist.', ['on', BOOL, 0, 1, 'drive', LIN, 0, 1, 'lbh', LIN, 0, 1, 'freq', EXP, MIDI0, MIDI128, 'q', EXP, 0.5, 8,
      'mix', LIN, 0, 1].concat(LVL));
    grp('fx.flg.', ['on', BOOL, 0, 1, 'rate', POW4, 0, 20, 'depth', LIN, 0, 1, 'feed', LIN, 0, 1, 'phase', LIN, 0, 360,
      'mix', LIN, 0, 1].concat(LVL));
    grp('fx.phs.', ['on', BOOL, 0, 1, 'rate', POW4, 0, 20, 'depth', LIN, 0, 1, 'freq', EXP, 20, 18000, 'feed', LIN, 0, 1,
      'phase', LIN, 0, 360, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.cho.', ['on', BOOL, 0, 1, 'rate', POW4, 0, 20, 'dly1', POW2, 0, 20, 'dly2', POW2, 0, 20, 'depth', POW2, 0, 26,
      'feed', LIN, 0, 0.95, 'lpf', EXP, 50, 20000, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.dly.', ['on', BOOL, 0, 1, 'feed', LIN, 0, 1, 'timeL', POW4, 1, 501, 'timeR', POW4, 1, 501, 'offL', LIN, 0.5, 1.5,
      'offR', LIN, 0.5, 1.5, 'freq', EXP, 40, 18000, 'q', LIN, 0.8, 8.2, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.cmp.', ['on', BOOL, 0, 1, 'thr', RPOW3, 1e-6, 1, 'ratio', RATIO, 1, 32, 'att', POW2, 0, 1000, 'rel', POW2, 0, 1000,
      'gain', POW2, 1, 32, 'mbL', LIN, 0, 2, 'mbM', LIN, 0, 2, 'mbH', LIN, 0, 2, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.rev.', ['on', BOOL, 0, 1, 'size', LIN, 0, 1, 't', LIN, 0, 1, 'locut', LIN, 0, 1, 'c', LIN, 0, 1, 'hicut', LIN, 0, 1,
      'w', LIN, 0, 1, 'mix', LIN, 0, 1].concat(LVL));
    grp('fx.eq.', ['on', BOOL, 0, 1, 'freqL', EXP, 21.533, 20000, 'qL', LIN, 0, 1, 'gainL', LIN, -24, 24,
      'freqH', EXP, 21.533, 20000, 'qH', LIN, 0, 1, 'gainH', LIN, -24, 24]);
    grp('fx.fil.', ['on', BOOL, 0, 1, 'cutoff', EXP, MIDI0, 22050, 'res', LIN, 0, 1, 'drive', LIN, 0, 1, 'var', LIN, 0, 1,
      'pan', LIN, 0, 1, 'mix', LIN, 0, 1].concat(LVL));
    dst('g.bypass', BOOL, 0, 1);
    grp('fx.', ['hyper.retrig', BOOL, 0, 1, 'dist.mode', ENUM, 0, 15, 'dist.filt', ENUM, 0, 2, 'flg.bpm', BOOL, 0, 1,
      'phs.bpm', BOOL, 0, 1, 'cho.bpm', BOOL, 0, 1, 'dly.bpm', BOOL, 0, 1, 'dly.link', BOOL, 0, 1, 'dly.mode', ENUM, 0, 2,
      'cmp.mb', BOOL, 0, 1, 'eq.typeL', ENUM, 0, 2, 'eq.typeH', ENUM, 0, 2, 'fil.type', ENUM, 0, 95]);
    if (DIDS.length !== ND) throw new Error('destination table has ' + DIDS.length + ' entries');

    // Index objects: id upper-cased, '.' → '_', 'fx.' prefix dropped (§3.13 naming rule).
    const constName = (id) => id.replace(/^fx\./, '').toUpperCase().replace(/\./g, '_');
    const didx = {}, fidx = {};
    for (let i = 0; i < NS; i++) didx[constName(DIDS[i])] = i;
    for (let i = NS; i < ND; i++) fidx[constName(DIDS[i])] = i - NS;
    const DIDX = Object.freeze(didx), FIDX = Object.freeze(fidx);

    const LAW_TAB = Object.freeze({
      law: Uint8Array.from(DLAW), lo: Float64Array.from(DLO), hi: Float64Array.from(DHI),
      cont: Uint8Array.from(DLAW, (l) => (l === INT || l === ENUM || l === BOOL ? 0 : 1)),
    });

    // destination indices used by the DSP code (osc B = osc A + 17)
    const D_A = 0, D_LEVEL = 0, D_PAN = 1, D_OCT = 2, D_SEMI = 3, D_FINE = 4, D_CRS = 5, D_UNI = 6, D_DET = 7, D_BLEND = 8,
      D_PHASE = 9, D_RAND = 10, D_WT = 11, D_WARP = 12, D_UNIW = 13, D_UNIWARP = 14, D_UNIWT = 15, D_STACK = 16;
    const N_LEVEL = DIDX.N_LEVEL, N_PITCH = DIDX.N_PITCH, N_FINE = DIDX.N_FINE, N_PAN = DIDX.N_PAN, N_RAND = DIDX.N_RAND,
      N_PHASE = DIDX.N_PHASE, S_LEVEL = DIDX.S_LEVEL, S_PAN = DIDX.S_PAN;
    const F_CUTOFF = DIDX.F_CUTOFF, F_RES = DIDX.F_RES, F_DRIVE = DIDX.F_DRIVE, F_VAR = DIDX.F_VAR, F_MIX = DIDX.F_MIX,
      F_PAN = DIDX.F_PAN;
    const E1_ATT = DIDX.E1_ATT, L1_RATE = DIDX.L1_RATE, C1_RATE = DIDX.C1_RATE, G_TUNE = DIDX.G_TUNE, G_AMP = DIDX.G_AMP,
      G_BENDUP = DIDX.G_BENDUP, G_BENDDN = DIDX.G_BENDDN, BUS1 = DIDX.BUS1;
    const A_ON = DIDX.A_ON, N_ON = DIDX.N_ON, S_ON = DIDX.S_ON, F_ON = DIDX.F_ON, F_ROUTEA = DIDX.F_ROUTEA,
      A_TRACK = DIDX.A_TRACK, A_WARPMODE = DIDX.A_WARPMODE, S_SHAPE = DIDX.S_SHAPE, S_OCT = DIDX.S_OCT,
      F_TYPE = DIDX.F_TYPE, E1_CA = DIDX.E1_CA, G_WHEEL = DIDX.G_WHEEL;

    /* ------------------------------------------------------------ sources (§3.12) */
    const SRC_IDS = ['', 'wheel', 'env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8',
      'velo', 'note', 'at', 'pat', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2',
      'macro1', 'macro2', 'macro3', 'macro4', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'fixed'];
    if (SRC_IDS.length !== NSRC) throw new Error('source table has ' + SRC_IDS.length + ' entries');
    const sidx = {};
    for (let i = 1; i < NSRC; i++) sidx[SRC_IDS[i].toUpperCase()] = i;
    const SIDX = Object.freeze(sidx);
    const SRC_POL = new Uint8Array(NSRC);                      // 1 = bipolar native range [−1, 1]
    SRC_POL[SIDX.CHAOS1] = 1; SRC_POL[SIDX.CHAOS2] = 1; SRC_POL[SIDX.NOISE] = 1; SRC_POL[SIDX.BEND] = 1; SRC_POL[SIDX.MPEX] = 1;
    // (the voice reads S_BEND; the rest name the warm-up rows — the source vector itself is SxMod's)
    const S_WHEEL = SIDX.WHEEL, S_ENV1 = SIDX.ENV1, S_LFO1 = SIDX.LFO1, S_VELO = SIDX.VELO, S_CHAOS1 = SIDX.CHAOS1,
      S_NOISE = SIDX.NOISE, S_RAND1 = SIDX.RAND1, S_MACRO1 = SIDX.MACRO1, S_BEND = SIDX.BEND, S_FIXED = SIDX.FIXED;

    /* ------------------------------------------------------------ sub shapes, filter families (§3.4, §3.6) */
    const SUB_IDS = Object.freeze(['sub:Sine', 'sub:RoundRect', 'sub:Saw', 'sub:Square', 'sub:Pulse']);
    const FILTER_FAMILY = Object.freeze(['ladder', 'svf', 'dual', 'morph', 'comb', 'flange', 'phaser', 'fphs', 'eq', 'ring',
      'snh', 'bank', 'french', 'german', 'addbass', 'formant', 'breject', 'distcomb', 'scream']);
    // types per family, in type order (0–95)
    const FAM_RUNS = [0, 4, 1, 14, 2, 13, 3, 8, 4, 8, 5, 8, 6, 14, 7, 2, 8, 5, 9, 2, 10, 2, 11, 3, 12, 1, 13, 1, 14, 1, 15, 3,
      16, 1, 17, 4, 18, 2];
    const FILTER_FAM_OF = new Uint8Array(NTYPES);
    const FAM_FIRST = new Int32Array(FILTER_FAMILY.length);
    for (let r = 0, t = 0; r < FAM_RUNS.length; r += 2) {
      FAM_FIRST[FAM_RUNS[r]] = t;
      for (let j = 0; j < FAM_RUNS[r + 1]; j++) FILTER_FAM_OF[t++] = FAM_RUNS[r];
    }
    const F_LADDER = 0, F_SVF = 1, F_DUAL = 2, F_MORPH = 3, F_COMB = 4, F_FLANGE = 5, F_PHASER = 6, F_FPHS = 7, F_EQ = 8,
      F_RING = 9, F_SNH = 10, F_BANK = 11, F_FRENCH = 12, F_GERMAN = 13, F_ADDBASS = 14, F_FORMANT = 15, F_BREJECT = 16,
      F_DISTCOMB = 17, F_SCREAM = 18;
    // Serum 2 types 96–107 (SPEC-serum2 §3.5): one pseudo-family F_NEW inside SFilter, delegated to SxFilt2 objects
    const NT2 = 108, NT_NEW = NT2 - NTYPES, F_NEW = 19;
    const CLEAN_IN = pow(10, -24 / 20), CLEAN_OUT = pow(10, 24 / 20);
    let warnedF2 = false, warnedF2pre = false;
    function warnF2() {
      if (warnedF2) return;
      warnedF2 = true;
      if (typeof console !== 'undefined') console.warn('serum-dsp: SxFilt2 unavailable, filter types 96–107 pass audio unfiltered');
    }
    function warnF2pre(t) {
      if (warnedF2pre) return;
      warnedF2pre = true;
      if (typeof console !== 'undefined') console.warn('serum-dsp: filter type', t, 'was not preallocated (passes unfiltered until the next apply)');
    }

    /* ------------------------------------------------------------ unison tables (§3.8) */
    // layouts: uniShape[mode·256 + (N−1)·16 + i], uniStack[stack·256 + (N−1)·16 + i], uniCenter[(N−1)·16 + i]
    const STACK_CYC = [null, null, null, null, [0, 7, 12], [0, 7, 12, 19, 24], [0, 7, 12, 19, 24, 31, 36]];
    const isCenter = (i, N) => ((N & 1) ? i === (N - 1) / 2 : i === N / 2 - 1 || i === N / 2);
    const detuneShape = (mode, t) => {
      const a = t < 0 ? -t : t, s = t < 0 ? -1 : t > 0 ? 1 : 0;
      if (mode === 0) return t;
      if (mode === 1) return s * pow(a, 1.5);
      if (mode === 2) return s * pow(a, 2.5);
      if (mode === 3) return s * sqrt(a);
      return 0;                                                // Random (4) is drawn per voice at note-on: 0 in the table
    };
    const stackSemis = (stack, i, N) => {
      if (stack === 1) return (i & 1) ? 12 : 0;
      if (stack === 2) return (i & 1) ? 12 * (1 + ((i - 1) / 2) % 2) : 0;
      if (stack === 3) return (i & 1) ? 12 * (1 + ((i - 1) / 2) % 3) : 0;
      if (stack >= 4 && stack <= 6) return STACK_CYC[stack][i % STACK_CYC[stack].length];
      if (stack === 7 || stack === 8) return isCenter(i, N) ? (stack === 7 ? -12 : -24) : 0;
      return 0;
    };
    const UNI = (() => {
      const uniShape = new Float64Array(5 * 256), uniStack = new Float64Array(9 * 256), uniCenter = new Uint8Array(256);
      for (let N = 1; N <= 16; N++) {
        for (let i = 0; i < N; i++) {
          const t = N > 1 ? 2 * i / (N - 1) - 1 : 0, o = (N - 1) * 16 + i;
          for (let m = 0; m < 5; m++) uniShape[m * 256 + o] = detuneShape(m, t) + 0;   // + 0: no −0 entries
          for (let s = 0; s < 9; s++) uniStack[s * 256 + o] = stackSemis(s, i, N);
          uniCenter[o] = isCenter(i, N) ? 1 : 0;
        }
      }
      return Object.freeze({ uniShape, uniStack, uniCenter });
    })();
    const U_SHAPE = UNI.uniShape, U_STACK = UNI.uniStack, U_CENTER = UNI.uniCenter;
    const UT = new Float64Array(256);                          // detune slot t_i at [(N−1)·16 + i]
    for (let N = 1; N <= 16; N++) for (let i = 0; i < N; i++) UT[(N - 1) * 16 + i] = N > 1 ? 2 * i / (N - 1) - 1 : 0;

    /* ------------------------------------------------------------ voice vector v2 (SPEC-serum2 §3.11.1, §3.11.2) */
    // Destination ids by vi (0–428): the Phase-1 synth rows (vi = idx < 148), then the SYN2 rows in builder order (vi =
    // idx − 100); the three scope-M rows (g.direct, g.bus1v, g.bus2v) keep their slots 403–405 unused (''). Embedded copy
    // of the normative builder (integration-tested against SxBase.DIDS2 / serum-core); only the indices are needed here.
    const VIDS = DIDS.slice(0, NS);
    const OSC_ROWS = ['level', 'pan', 'oct', 'semi', 'fine', 'crs', 'uni', 'det', 'blend', 'phase', 'rand', 'wt', 'warp', 'uniw',
      'uniwarp', 'uniwt', 'stack'];
    const O2_ROWS = ['w1', 'w2', 'warp2', 'wvar1', 'wvar2', 'uniwarp2', 'ratio', 'hz', 'sstart', 'send', 'lstart', 'lend', 'xfade',
      'scan', 'scanrev', 'pos', 'slice', 'gy', 'dens', 'glen', 'wamt', 'wskew', 'roff', 'rdir', 'rpitch', 'rlen', 'rpan', 'rlvl',
      'rwamt', 'rwskew', 'rwarp', 'rwarp2', 'grev', 'flo', 'fhi', 'cut', 'smix', 'mdly', 'matt', 'mhold', 'mdec', 'msus', 'mrel',
      'mvel', 'mrand', 'timbre', 'ustart', 'uspan', 'fbal', 'bus1', 'bus2'];
    for (const r of OSC_ROWS) VIDS.push('c.' + r);
    VIDS.push('c.on', 'c.track');
    for (const k of ['a', 'b', 'c']) for (const r of O2_ROWS) VIDS.push(k + '.' + r);
    for (const r of ['shp', 'crs', 'phase', 'track', 'fbal', 'bus1', 'bus2']) VIDS.push('s.' + r);
    for (const r of ['stereo', 'color', 'fbal', 'bus1', 'bus2']) VIDS.push('n.' + r);
    for (const r of ['type2', 'level', 'routeC', 'x', 'y', 'bus1', 'bus2']) VIDS.push('f.' + r);
    for (const r of ['on', 'type', 'cutoff', 'res', 'drive', 'var', 'mix', 'pan', 'level', 'routeA', 'routeB', 'routeC', 'routeN',
      'routeS', 'x', 'y', 'bus1', 'bus2']) VIDS.push('f2.' + r);
    for (const r of ['att', 'hold', 'dec', 'sus', 'rel', 'ca', 'cd', 'cr']) VIDS.push('e4.' + r);
    for (const e of [2, 3, 4]) VIDS.push('e' + e + '.start', 'e' + e + '.end');
    for (const l of [9, 10]) for (const r of ['rate', 'rise', 'delay', 'smooth']) VIDS.push('l' + l + '.' + r);
    for (let l = 1; l <= 10; l++) VIDS.push('l' + l + '.phase');
    for (let m = 1; m <= 8; m++) VIDS.push('m' + m);
    for (const r of ['pan', 'det', 'cut', 'env', 'escale', 'lscale']) VIDS.push('vc.' + r);
    VIDS.push('', '', '');                                    // g.direct, g.bus1v, g.bus2v: FX context only
    for (const r of ['on', 'rate', 'shift', 'range', 'offset', 'repeats', 'gate', 'chance', 'rrate', 'vdecay', 'vtarget', 'trans',
      'wtrans', 'wrange']) VIDS.push('arp.' + r);
    for (const r of ['on', 'trans', 'rate', 'offset']) VIDS.push('clip.' + r);
    VIDS.push('a.lenrate', 'b.lenrate', 'c.lenrate', 'g.bu2', 'g.bd2');
    if (VIDS.length !== NSV) throw new Error('voice vector has ' + VIDS.length + ' slots');
    const vidx = {};
    for (let i = 0; i < NSV; i++) if (VIDS[i] !== '') vidx[constName(VIDS[i])] = i;
    const VIDX = Object.freeze(vidx);
    const VI = (id) => { const v = VIDX[constName(id)]; if (!(v >= 0)) throw new Error('no vi for ' + id); return v; };
    // per-oscillator blocks: the 17 Phase-1 rows (D_* offsets), on/track switches, the 51-row O2 block (K_* offsets)
    const OKB = Int32Array.from([0, 17, VI('c.level')]);
    const OON = Int32Array.from([VI('a.on'), VI('b.on'), VI('c.on')]);
    const OTRK = Int32Array.from([VI('a.track'), VI('b.track'), VI('c.track')]);
    const O2B = Int32Array.from([VI('a.w1'), VI('b.w1'), VI('c.w1')]);
    const K_W1 = 0, K_W2 = 1, K_WARP2 = 2, K_WVAR1 = 3, K_WVAR2 = 4, K_UNIWARP2 = 5, K_RATIO = 6, K_HZ = 7, K_GY = 17,
      K_FBAL = 48, K_BUS1 = 49;
    // channels A, B, C, Noise, Sub (CP route/envOn/map order; F1, F2 follow at 5, 6 in route/envOn)
    const C_ON = OON[2];
    const F_TYPE2 = VI('f.type2'), F_LEVEL = VI('f.level'), F_X = VI('f.x'), F_BUS1 = VI('f.bus1');
    const F2_ON = VI('f2.on'), F2_TYPE = VI('f2.type'), F2_CUTOFF = VI('f2.cutoff'), F2_RES = VI('f2.res'), F2_DRIVE = VI('f2.drive'),
      F2_VAR = VI('f2.var'), F2_MIX = VI('f2.mix'), F2_PAN = VI('f2.pan'), F2_LEVEL = VI('f2.level'), F2_X = VI('f2.x'),
      F2_BUS1 = VI('f2.bus1');
    const S_SHP = VI('s.shp'), S_CRS = VI('s.crs'), S_PHASE = VI('s.phase'), S_TRACK = VI('s.track');
    const N_STEREO = VI('n.stereo'), N_COLOR = VI('n.color');
    const G_BU2 = VI('g.bu2'), G_BD2 = VI('g.bd2');
    const F1SW = Int32Array.from([VI('f.routeA'), VI('f.routeB'), VI('f.routeC'), VI('f.routeN'), VI('f.routeS')]);
    const F2SW = Int32Array.from([VI('f2.routeA'), VI('f2.routeB'), VI('f2.routeC'), VI('f2.routeN'), VI('f2.routeS')]);
    const FBAL = Int32Array.from([O2B[0] + K_FBAL, O2B[1] + K_FBAL, O2B[2] + K_FBAL, VI('n.fbal'), VI('s.fbal')]);
    const BUS1V = Int32Array.from([O2B[0] + K_BUS1, O2B[1] + K_BUS1, O2B[2] + K_BUS1, VI('n.bus1'), VI('s.bus1'), F_BUS1, F2_BUS1]);
    // sources v2 (§3.10): audio taps written by the voice (§11.6)
    const S_OSCA = 52, S_SUB = 55, S_FILT1 = 56;
    // WARPS2 (§3.4.1): domain and modulator source per mode (same list as serum-core / SxBase / SxWarp, integration-tested)
    const N_WARP2 = 82, WD_F = 1, WD_P = 2, WD_O = 3, WD_S = 4;
    const MS_O1 = 1, MS_O2 = 2, MS_NOISE = 3, MS_SUB = 4, MS_F1 = 5, MS_F2 = 6;
    const WDOM2 = new Uint8Array(N_WARP2), WSRC2 = new Uint8Array(N_WARP2);
    for (let m = 1; m < N_WARP2; m++) {
      WDOM2[m] = m >= 58 ? WD_S : m >= 46 ? WD_O : m >= 39 ? WD_P : m >= 33 ? WD_F : m >= 16 ? WD_O : m === 9 ? WD_O : WD_P;
      if (m >= 33 && m <= 57) { const j = m <= 44 ? (m - 33) % 6 : (m - 46) % 6; WSRC2[m] = m === 45 ? 0 : 1 + j; }
    }
    WSRC2[71] = MS_O1; WSRC2[72] = MS_O2; WSRC2[73] = MS_NOISE; WSRC2[74] = MS_O1; WSRC2[75] = MS_O2; WSRC2[76] = MS_NOISE;
    const W_ODDEVEN = 16, W_PDSELF = 45;
    // S1_TO_S2_WARP (§2.6.4): Phase-1 warp index → [WARPS2 index, Var] (non-wavetable oscillators of A/B in S1 mode)
    const S1W_MODE = Uint8Array.from([0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 39, 46, 52, 41, 42]);
    const S1W_VAR = Float64Array.from([0, 0, 0.5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // o1/o2 = first/second other oscillator in A, B, C order (§3.4.2)
    const OTH = Int32Array.from([1, 2, 0, 2, 0, 1]);
    const SUB_IDS2 = Object.freeze(['sub:Sine', 'sub:RoundRect', 'sub:Triangle', 'sub:Saw', 'sub:Square', 'sub:Pulse']);

    /* ------------------------------------------------------------ fast math (§0.2 tolerances) */
    // tanh(x)/x, the secant gain of tanh: [7/6] Padé approximant of tanh, then 1/|x| where it reaches 1.
    // x·tg(x) is monotone, never exceeds 1 and stays within 9.7e-5 of tanh(x) (§0.2 tolerance 1e-4).
    function tg(x) {
      const z = x * x;
      if (z >= 24.7009) return 1 / (x < 0 ? -x : x);           // |x| ≥ 4.97
      return (135135 + z * (17325 + z * (378 + z))) / (135135 + z * (62370 + z * (3150 + 28 * z)));
    }
    function th(x) { return x * tg(x); }                       // tanh, |error| < 1e-4

    // 2^x = 2^i · 2^(j/64) · 2^g with g ∈ [0, 1/64): two tables and a cubic (relative error < 1e-9)
    const P2 = new Float64Array(161), E64 = new Float64Array(64);
    for (let i = 0; i < 161; i++) P2[i] = pow(2, i - 80);
    for (let j = 0; j < 64; j++) E64[j] = pow(2, j / 64);
    function exp2(x) {
      if (x < -79) return 0;
      if (x > 79) x = 79;
      const y = x * 64, k = floor(y), g = (y - k) * 0.015625;
      return P2[(k >> 6) + 80] * E64[k & 63] * (1 + g * (0.6931471805599453 + g * (0.2402265069591007 + g * 0.05550410866482158)));
    }
    // log2(x) for normal x > 0: exponent and the top 8 mantissa bits from the IEEE bits (tables), then a cubic in
    // r = m/m_j − 1, |r| < 1/256 (|error| < 1e-10)
    const CVF = new Float64Array(1), CVI = new Int32Array(CVF.buffer);
    CVF[0] = 1;
    const HIW = CVI[1] === 0x3FF00000 ? 1 : 0;                 // index of the high word (endianness)
    const LG_T = new Float64Array(256), LG_I = new Float64Array(256);
    for (let j = 0; j < 256; j++) { LG_T[j] = mlog2(1 + j / 256); LG_I[j] = 1 / (1 + j / 256); }
    function log2(x) {
      CVF[0] = x;
      const hi = CVI[HIW], j = (hi >> 12) & 255;
      CVI[HIW] = (hi & 0x000FFFFF) | 0x3FF00000;
      const r = CVF[0] * LG_I[j] - 1;
      return ((hi >> 20) - 1023) + LG_T[j] + r * (1.4426950408889634 - r * (0.7213475204444817 - r * 0.4808983469629878));
    }
    // u^K for u ∈ [0, 1], K > 0 (relative error < 1e-7)
    function powU(u, K) {
      if (u < 1e-300) return 0;
      return exp2(K * log2(u));
    }
    // sin(2πp), p in cycles: 4096-point table with linear interpolation (|error| < 3e-7)
    const SIN_N = 4096;
    const SIN_T = new Float64Array(SIN_N + 1);
    for (let i = 0; i <= SIN_N; i++) SIN_T[i] = sin(2 * PI * i / SIN_N);
    function sin1(p) {
      p -= floor(p);
      const x = p * SIN_N, i = x | 0;
      return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (x - i);
    }
    // equal-power pan gains √2·cos((p+1)π/4) / √2·sin((p+1)π/4); exactly 1 at the centre
    function panG(p, right) {
      if (p === 0) return 1;
      const a = (p + 1) * PI * 0.25;
      return SQRT2 * (right ? sin(a) : cos(a));
    }
    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);     // NaN → 0
    // soft limiter used by the families without their own nonlinearity: identity for |x| ≤ 1, then 1 + tanh(|x| − 1)
    function sc(x) {
      if (x <= 1 && x >= -1) return x;
      const a = x < 0 ? -x : x, t = a - 1, y = 1 + t * tg(t);
      return x < 0 ? -y : y;
    }
    // output safety limiter of SFilter: identity below |8| (+18 dBFS), bounded by 12
    function lim(x) {
      const a = x < 0 ? -x : x, t = (a - 8) * 0.25, y = 8 + 4 * t * tg(t);
      return x < 0 ? -y : y;
    }
    // noise pitch law (§3.1 npitch, lo −200, hi 48)
    function npitch(n) {
      if (n >= 0.5) return 96 * (n - 0.5);
      if (!(n > 0)) return -200;
      const v = 100 * mlog2(2 * n);
      return v > -200 ? v : -200;
    }

    /* ------------------------------------------------------------ curves (§4.4) */
    function bend(t, k) {
      if (k < 1e-4 && k > -1e-4) return t;
      return (1 - exp(-k * t)) / (1 - exp(-k));
    }
    // P = interleaved [x, y, c] per point; off, n in points
    function evalPts(P, off, n, x) {
      const b = 3 * off, last = n - 1;
      if (x <= 0 || x < P[b]) return P[b + 1];
      if (x >= 1 || P[b + 3 * last] <= x) return P[b + 3 * last + 1];
      let lo = 0, hi = last;                                     // P.x[lo] ≤ x < P.x[hi]
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (P[b + 3 * mid] <= x) lo = mid; else hi = mid;
      }
      const j = b + 3 * lo, dx = P[j + 3] - P[j];
      if (dx <= 1e-9) return P[j + 4];
      return P[j + 1] + (P[j + 4] - P[j + 1]) * bend((x - P[j]) / dx, CURVE_K * P[j + 2]);
    }

    // 4-point cubic Hermite (Catmull-Rom) read with wrap (§6.5)
    function herm(buf, mask, pos) {
      const i = floor(pos), f = pos - i;
      const xm = buf[(i - 1) & mask], x0 = buf[i & mask], x1 = buf[(i + 1) & mask], x2 = buf[(i + 2) & mask];
      const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
      return ((c3 * f + c2) * f + c1) * f + x0;
    }
    // same at integer index i, fraction f, in the frame starting at b (mask m = len − 1)
    function hermAt(d, b, m, i, f) {
      const xm = d[b + ((i - 1) & m)], x0 = d[b + (i & m)], x1 = d[b + ((i + 1) & m)], x2 = d[b + ((i + 2) & m)];
      return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
    }

    const isF32 = (a) => a !== null && typeof a === 'object' && ArrayBuffer.isView(a) && a[Symbol.toStringTag] === 'Float32Array';
    const isPow2 = (n) => Number.isInteger(n) && n >= 4 && (n & (n - 1)) === 0;
    const EMPTY32 = new Float32Array(4);

    /* ------------------------------------------------------------ table store (§7.5) */
    const warnedIds = new Set();
    function warnOnce(id, why) {
      const key = String(id);
      if (warnedIds.has(key)) return;
      warnedIds.add(key);
      if (typeof console !== 'undefined') console.warn('serum-dsp: invalid table entry', key, '-', why);
    }
    function checkWT(e) {
      const F = e.frames;
      if (!Number.isInteger(F) || F < 1 || F > 256) return 'frames must be 1–256';
      if (!Array.isArray(e.levels) || e.levels.length !== 11) return 'needs 11 levels';
      for (let l = 0; l < 11; l++) {
        const lv = e.levels[l];
        if (!lv || typeof lv !== 'object') return 'level ' + l + ' missing';
        if (!isPow2(lv.len)) return 'level ' + l + ' len must be a power of two';
        if (!isF32(lv.data)) return 'level ' + l + ' data must be a Float32Array';
        if (lv.data.length !== F * lv.len) return 'level ' + l + ' data length must be frames·len';
      }
      return '';
    }
    function checkLoop(o, len) {
      const ls = o.loopStart, le = o.loopEnd;
      if (ls === undefined && le === undefined) return true;
      return Number.isFinite(ls) && Number.isFinite(le) && ls >= 0 && ls < le && le <= len;
    }
    function checkNoise(e) {
      if (!(Number.isFinite(e.rate) && e.rate > 0)) return 'rate must be > 0';
      if (e.ch !== 1 && e.ch !== 2) return 'ch must be 1 or 2';
      if (e.root !== undefined && !Number.isFinite(e.root)) return 'root must be a number';
      if (!Array.isArray(e.levels) || e.levels.length < 1 || e.levels.length > 6) return 'needs 1–6 levels';
      for (let l = 0; l < e.levels.length; l++) {
        const lv = e.levels[l];
        if (!lv || typeof lv !== 'object') return 'level ' + l + ' missing';
        if (!Number.isInteger(lv.len) || lv.len < 4) return 'level ' + l + ' len must be an integer ≥ 4';
        if (!isF32(lv.L) || lv.L.length !== lv.len) return 'level ' + l + ' L must be a Float32Array of len samples';
        if (e.ch === 2 ? !isF32(lv.R) || lv.R.length !== lv.len : lv.R != null && (!isF32(lv.R) || lv.R.length !== lv.len)) {
          return 'level ' + l + ' R must be a Float32Array of len samples' + (e.ch === 2 ? '' : ' or null');
        }
        if (!checkLoop(lv, lv.len)) return 'level ' + l + ' loop points out of range';
      }
      if (e.len !== undefined && e.len !== e.levels[0].len) return 'len must equal level 0 len';
      return '';
    }
    function storeWT(id, entry) {
      if (typeof id !== 'string' || id === '') { warnOnce(id, 'id must be a non-empty string'); return false; }
      if (!entry || typeof entry !== 'object') { warnOnce(id, 'not an object'); return false; }
      const why = entry.kind === 'wt' ? checkWT(entry) : entry.kind === 'noise' ? checkNoise(entry) : 'kind must be wt or noise';
      if (why) { warnOnce(id, why); return false; }
      tables.set(id, entry);
      epoch++;
      return true;
    }
    function storeWTFrame(id, f, levels) {
      const e = tables.get(id);
      if (!e || e.kind !== 'wt') { warnOnce(id, 'storeWTFrame: no wavetable stored under this id'); return false; }
      if (!Number.isInteger(f) || f < 0 || f >= e.frames) { warnOnce(id, 'storeWTFrame: frame out of range'); return false; }
      if (!Array.isArray(levels) || levels.length !== 11) { warnOnce(id, 'storeWTFrame: needs 11 levels'); return false; }
      for (let l = 0; l < 11; l++) {
        const lv = levels[l], len = e.levels[l].len;
        if (!lv || !isF32(lv.data) || lv.data.length !== len || (lv.len !== undefined && lv.len !== len)) {
          warnOnce(id, 'storeWTFrame: level ' + l + ' must hold len samples');
          return false;
        }
      }
      for (let l = 0; l < 11; l++) e.levels[l].data.set(levels[l].data, f * e.levels[l].len);
      epoch++;
      return true;
    }
    function dropWT(id) {
      tables.delete(id);
      epoch++;
    }

    /* ------------------------------------------------------------ SFilter (§8.4.5, §6.11, §3.4) */
    // Per channel: a generic state block st[ch·ST …] and coefficient block co[ch·NCO …]; the ladder families
    // (MG Low, French, German) keep their 9-double state in ld. Delay families (comb, flange, fphs, bank, distcomb)
    // read and write lines inside one grow-only Float32 pool sized for the 8 Hz minimum cutoff at the current rate;
    // a line returns 0 for delays longer than what was written since the last reset (so reset is O(lines)).
    //
    // Ladder: four TPT one-poles with tanh at every stage input (V·tanh(x/V)) and the resonance feedback k·sat(y3)
    // (k = 4.1·res; FAT: sat(x) = x + var·(tanh(3x)/3 − x)); MG Low 6/12/18 tap stage 1/2/3 of the same loop.
    // Solved per sample as a zero-delay-feedback loop whose tanh's are replaced by their secant gains at the
    // previous sample (no iteration: cheap, unconditionally stable).
    // SVF: TPT state-variable filter (Zavalishin/Simper); damping k = k0 − r·sat(bp)/bp with k0 = √2 (Butterworth)
    // and r = √2·0.99·res, i.e. Q = 0.7071/(1 − 0.99·res) for small signals; the resonance part saturates softly
    // (2·tanh(bp/2), plus FAT on the Normal types), which bounds the level at full resonance.
    const LADDER_V = 2;                                        // stage saturation level (IMPL: clean below ≈ −6 dBFS)
    const IV = 1 / LADDER_V;
    const LD = 9;                                              // ladder state per channel: s0..s3, y0..y3, u
    const ST = 24;                                             // generic state doubles per channel
    const NCO = 32;                                            // coefficient doubles per channel
    const K0 = SQRT2;
    const FVAR_L2 = mlog2(22050 / MIDI0);
    const BANK_M = Float64Array.from([1, 1.5, 2, 2.5, 3, 4]);
    const AP_M = Float64Array.from([1, 0.77, 0.59, 0.45, 0.34, 0.26]);
    const FDN_M = Float64Array.from([1, 1.33, 1.57, 1.91]);
    // formant tables I, II, III (§3.5): [table·15 + vowel·3 + k]
    const FORMANT = Float64Array.from([730, 1090, 2440, 530, 1840, 2480, 270, 2290, 3010, 570, 840, 2410, 300, 870, 2240,
      850, 1220, 2810, 610, 2330, 2990, 310, 2790, 3310, 590, 920, 2710, 370, 950, 2670,
      1030, 1370, 3170, 690, 2610, 3570, 370, 3200, 3730, 680, 1060, 3180, 430, 1170, 3260]);
    const FORMANT_G = Float64Array.from([1, 0.7, 0.5]);
    // responses: 0 L, 1 H, 2 B (unity peak), 3 P (peak), 4 N (notch)
    const DUAL_A = Int8Array.from([0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4]);      // types 18–30 (18 = one-pole pair)
    const DUAL_B = Int8Array.from([1, 1, 2, 3, 4, 2, 3, 4, 3, 4, 3, 4, 4]);
    const MORPH_R = Int8Array.from([0, 2, 1, 0, 3, 1, 0, 4, 1, 2, 3, 4]);       // L/B/H, L/P/H, L/N/H, B/P/N
    const fVar = (v) => MIDI0 * pow(2, FVAR_L2 * v);
    const prew = (fc, fs) => tan(PI * fc / fs);
    // pool size (floats) needed by a family at rate fs: the Phase-1 sizing for the 8 Hz cutoff clamp (types 0–95 are
    // unchanged in every filter, SPEC-serum2 §3.5; the 20 Hz delay floor of §6.13.1 belongs to SxFilt2's Diffusor and
    // Comb 2 only, which size their own needs)
    function lineLen(fs, m) { return ceil(fs * m / 8) + 8; }
    function bankLen(fs, j) { return ceil(fs / (8 * BANK_M[j])) + 8; }
    function bankNeed(fs, sub) {
      let n = 0;
      if (sub === 0) for (let j = 0; j < 6; j++) n += bankLen(fs, j);
      else if (sub === 1) for (let j = 0; j < 6; j++) n += lineLen(fs, AP_M[j]);
      else for (let j = 0; j < 4; j++) n += lineLen(fs, FDN_M[j]);
      return 2 * n;
    }
    // (the bank subtypes have different layouts: the pool is sized for the subtype in use, or for every subtype a
    // modulated type can reach, so the FDN bank's 1.1 MB at 192 kHz is only taken by a filter that can play it, §14.2)
    function poolNeed(fam, fs, sub = -1) {
      if (fam === F_COMB || fam === F_FLANGE || fam === F_FPHS || fam === F_DISTCOMB) return 2 * lineLen(fs, 1);
      if (fam === F_BANK) {
        if (sub >= 0 && sub <= 2) return bankNeed(fs, sub);
        const a = bankNeed(fs, 0), b = bankNeed(fs, 1), c = bankNeed(fs, 2);
        return a > b ? (a > c ? a : c) : (b > c ? b : c);
      }
      return 0;
    }

    class SFilter {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.type = 1; this.fam = F_LADDER; this.sub = 1; this.all = 0; this.aLo = 0; this.aHi = NTYPES - 1; this.aNeed = 0; this.aFs = -1;
        this.aL = 1000; this.aR = 1000;                        // last set() cutoffs (unclamped, for setRate)
        // (M4) 1 while the state is as the flush at the end of process() left it (only process — and tick called directly,
        // filterImpulse — change it): set() then skips its flush, which would change nothing (the flush is idempotent)
        this.cln = 0;
        this.fcL = -1; this.fcR = -1; this.res = 0; this.drive = -1; this.vr = 0;
        this.dg = 1;
        // ladder families
        this.GL = 0; this.GR = 0; this.k = 0; this.tap = 1;
        this.ld = new Float64Array(2 * LD);
        this.ly0 = 0; this.ly1 = 0; this.ly2 = 0;
        // generic families
        this.st = new Float64Array(2 * ST);
        this.co = new Float64Array(2 * NCO);
        this.k0 = K0; this.r = 0; this.fat = 0; this.pk = 0;
        this.wA = 1; this.wB = 0; this.wC = 0;
        this.fb = 0; this.fbs = 0; this.norm = 1; this.nap = 4; this.lk = 0; this.flg = 0; this.bpo = 0;
        this.kf = 0.2; this.kb = 1; this.dc = 1; this.gs = 2;
        this.v1 = 0; this.v2 = 0; this.ke = K0;
        // delay lines
        this.pool = EMPTY32;
        this.lb = new Int32Array(16); this.ln = new Int32Array(16); this.lw = new Int32Array(16); this.lc = new Int32Array(16);
        this.nl = 0;
        this.yl = 0; this.yr = 0;
        // Serum 2 "New" types 96–107 (SPEC-serum2 §6.13.1): SxFilt2 family objects, created only on apply paths — need,
        // prealloc, setRate, and setType while the type is not modulated (the Phase-1 contract: setType runs on the render
        // path only for modulated types, which prealloc'ated in apply); nx = the object of the current type (null: not
        // allocated, audio passes unfiltered; miss = that type, allocated by the next prealloc). Their delay lines
        // (Diffusor, Comb 2) borrow this filter's pool (SxFilt2 make(…, pool)): one family runs at a time, so the pool is
        // sized by the largest family reachable, never by the sum (§14.2)
        this.f2o = null; this.nx = null; this.F2 = null; this.miss = -1;
        this.px = 0; this.py = 0; this.pz = null; this.pzOff = 0;  // PZ SVF X/Y and corner data (setXY / setPZ)
        this.cl = 0;                                           // Clean Mode (§6.13.3)
        this.set(1000, 1000, 0, 0, 0);
      }
      setRate(fs) {
        if (fs > 0 && +fs !== this.fs) {
          this.fs = +fs;
          // one pool for the new rate (the Phase-1 lines of the current or every reachable family, the SxFilt2 objects'
          // lines), then the SxFilt2 objects at the new rate: borrowers made again on the pool, the others re-rated
          const o = this.f2o;
          let n2 = 0;
          if (o !== null) for (let j = 0; j < NT_NEW; j++) if (o[j] !== null) { const q = this.f2Need(NTYPES + j); if (q > n2) n2 = q; }
          this.grow(n2, false);
          if (this.pool.length > 0) { this.ensure(this.fam, this.sub, false); this.layout(); }
          if (o !== null) {
            for (let j = 0; j < NT_NEW; j++) {
              if (o[j] === null) continue;
              if (this.f2Need(NTYPES + j) > 0) this.remake(j); else o[j].setRate(this.fs);
            }
          }
        }
        this.fcL = -1; this.fcR = -1;                          // force recomputation (clamp and prewarp depend on fs)
        this.set(this.aL, this.aR, this.res, this.drive, this.vr);
      }
      // the SxFilt2 object of type t ≥ 96 (allocation: apply / prealloc paths only); false when SxFilt2 is missing
      need(t) {
        t = round(+t);
        if (!(t >= NTYPES && t < NT2)) return false;
        if (this.f2o !== null && this.f2o[t - NTYPES] !== null) return true;
        const F2 = this.F2 || globalThis.SxFilt2;
        if (!F2 || typeof F2.make !== 'function') { warnF2(); return false; }
        this.F2 = F2;
        if (this.f2o === null) this.f2o = new Array(NT_NEW).fill(null);
        this.grow(this.f2Need(t), true);                         // the pool holds this family's lines as well
        const o = this.make2(t);
        if (!o) return false;
        this.f2o[t - NTYPES] = o;
        if (this.type === t) { this.nx = o; o.reset(); }
        if (this.miss === t) this.miss = -1;
        return true;
      }
      // Float32 line samples the SxFilt2 object of type t uses at this rate (0: no lines, or no SxFilt2.need)
      f2Need(t) {
        const F2 = this.F2;
        return F2 !== null && typeof F2.need === 'function' ? F2.need(t, this.fs) | 0 : 0;
      }
      // a SxFilt2 object of type t with the current controls, on this filter's pool when it has lines (apply paths)
      make2(t) {
        const q = this.f2Need(t);
        const o = this.F2.make(t, this.fs, q > 0 && this.pool.length >= q && this.pool !== EMPTY32 ? this.pool : null);
        if (!o) return null;
        o.set(this.aL, this.aR, this.res, this.drive, this.vr);
        o.setXY(this.px, this.py);
        if (this.pz !== null) o.setPZ(this.pz, this.pzOff);
        return o;
      }
      // the object of new type NTYPES + j made again on the current pool (after the pool was replaced; state restarts)
      remake(j) {
        const o = this.make2(NTYPES + j);
        if (!o) return;
        const cur = this.f2o[j] === this.nx;
        this.f2o[j] = o;
        if (cur) { this.nx = o; o.reset(); }
      }
      // the pool grows to n samples (apply paths): the Phase-1 lines restart empty and, with re, the SxFilt2 objects that
      // borrowed the old pool are made again on the new one
      grow(n, re) {
        if (!(n > this.pool.length)) return;
        this.pool = new Float32Array(n);
        this.lc.fill(0);
        const o = this.f2o;
        if (re && o !== null) for (let j = 0; j < NT_NEW; j++) if (o[j] !== null && this.f2Need(NTYPES + j) > 0) this.remake(j);
      }
      // PZ SVF position and corners (once per chunk; other types ignore them)
      setXY(x, y) {
        this.px = x; this.py = y;
        if (this.nx !== null) this.nx.setXY(x, y);
      }
      setPZ(c, off = 0) {
        this.pz = c; this.pzOff = off;
        if (this.nx !== null) this.nx.setPZ(c, off);
      }
      setClean(on) { this.cl = on ? 1 : 0; }
      setType(t) {
        t = t > 0 ? (t < NT2 - 1 ? round(t) : NT2 - 1) : 0;
        if (t === this.type) return;
        if (t >= NTYPES) {                                     // Serum 2 "New" family (SxFilt2)
          // a type that is not modulated (no prealloc(true)) is set on an apply path (Phase-1 contract, §8.4.5): its object
          // is made here, as the Phase-1 families allocate their lines; a modulated type never allocates (render path)
          let o = this.f2o !== null ? this.f2o[t - NTYPES] : null;
          if (o === null && this.all === 0 && this.need(t)) o = this.f2o[t - NTYPES];
          this.type = t; this.fam = F_NEW; this.sub = t - NTYPES; this.nx = o;
          if (o !== null) {                                    // (reset last: the family starts fresh, its next set jumps)
            o.set(this.aL, this.aR, this.res, this.drive, this.vr);
            o.setXY(this.px, this.py);
            if (this.pz !== null) o.setPZ(this.pz, this.pzOff);
            o.reset();
          } else if (this.all !== 0 && this.miss !== t) { this.miss = t; warnF2pre(t); }
          return;
        }
        const fam = FILTER_FAM_OF[t];
        const change = fam !== this.fam || fam === F_BANK;     // bank subtypes use different line layouts
        this.type = t; this.fam = fam; this.sub = t - FAM_FIRST[fam]; this.nx = null;
        if (change) {                                          // switching family resets it; same family keeps state
          this.ensure(fam, this.sub);
          this.layout();
          this.st.fill(0); this.ld.fill(0);
        }
        this.coef();
      }
      // all: the type is modulated — the pool covers every family of the types lo…hi it can reach (default 0–107, §6.13.1:
      // the SxFilt2 objects of every reachable new type are created too; callers limited to 0–95 pass hi = 95). Any call
      // (an apply path) also allocates a new type a modulated setType found missing (`miss`, §6.13.1)
      prealloc(all, lo = 0, hi = NT2 - 1) {
        this.all = all ? 1 : 0;
        this.aLo = lo > 0 ? (lo < NT2 ? lo | 0 : NT2 - 1) : 0;
        this.aHi = hi > this.aLo ? (hi < NT2 ? hi | 0 : NT2 - 1) : this.aLo;
        this.aFs = -1;
        if (this.all) {
          if (this.F2 === null && this.aHi >= NTYPES) {
            const F2 = globalThis.SxFilt2;
            if (F2 && typeof F2.make === 'function') this.F2 = F2;
          }
          const had = this.pool;
          this.ensure(this.fam, this.sub);                       // one pool for every reachable family, new ones included
          if (this.pool !== had) this.layout();
          for (let t = this.aLo > NTYPES ? this.aLo : NTYPES; t <= this.aHi; t++) this.need(t);
        }
        if (this.miss >= NTYPES) this.need(this.miss);
      }
      // grow-only pool: enough for this family and subtype (or for every type reachable after prealloc(true), the
      // SxFilt2 delay families of types 96–107 included — they borrow the pool)
      ensure(fam, sub = -1, re = true) {
        let need = poolNeed(fam, this.fs, sub);
        if (this.type >= NTYPES) { const q = this.f2Need(this.type); if (q > need) need = q; }   // the playing new type's lines
        if (this.all) {
          if (this.aFs !== this.fs) {
            let m = 0;
            for (let t = this.aLo; t <= this.aHi; t++) {
              let q;
              if (t < NTYPES) { const fm = FILTER_FAM_OF[t]; q = poolNeed(fm, this.fs, t - FAM_FIRST[fm]); }
              else q = this.f2Need(t);
              if (q > m) m = q;
            }
            this.aNeed = m; this.aFs = this.fs;
          }
          if (this.aNeed > need) need = this.aNeed;
        }
        this.grow(need, re);
      }
      layout() {
        const fs = this.fs, fam = this.fam, lb = this.lb, ln = this.ln;
        let nl = 0, off = 0;
        if (fam === F_COMB || fam === F_FLANGE || fam === F_FPHS || fam === F_DISTCOMB) {
          const U = lineLen(fs, 1);
          for (let ch = 0; ch < 2; ch++) { lb[nl] = off; ln[nl] = U; off += U; nl++; }
        } else if (fam === F_BANK) {
          const sub = this.sub, nj = sub === 2 ? 4 : 6;
          for (let ch = 0; ch < 2; ch++) {
            for (let j = 0; j < nj; j++) {
              const L = sub === 0 ? bankLen(fs, j) : lineLen(fs, sub === 1 ? AP_M[j] : FDN_M[j]);
              lb[nl] = off; ln[nl] = L; off += L; nl++;
            }
          }
        }
        if (off > this.pool.length) { nl = 0; }                 // not allocated (cannot happen after ensure)
        this.nl = nl;
        this.lw.fill(0); this.lc.fill(0);
      }
      set(fcL, fcR, res, drive, vr) {
        const fs = this.fs, hi = 0.45 * fs;
        this.aL = fcL; this.aR = fcR;
        fcL = fcL > 8 ? (fcL < hi ? +fcL : hi) : 8;
        fcR = fcR > 8 ? (fcR < hi ? +fcR : hi) : 8;
        res = res > 0 ? (res < 1 ? +res : 1) : 0;
        drive = drive > 0 ? (drive < 1 ? +drive : 1) : 0;
        vr = vr > 0 ? (vr < 1 ? +vr : 1) : 0;
        if (fcL === this.fcL && fcR === this.fcR && res === this.res && drive === this.drive && vr === this.vr) return;
        if (drive !== this.drive) this.dg = exp(LN10 * 0.8 * sqrt(drive));   // 10^(16·√d/20)
        this.fcL = fcL; this.fcR = fcR; this.res = res; this.drive = drive; this.vr = vr;
        if (this.fam === F_NEW) { if (this.nx !== null) this.nx.set(fcL, fcR, res, drive, vr); return; }
        this.coef();
        if (this.cln === 0) this.flushFam();                     // (M4: the family's states only, as process; cln)
      }
      // coefficients of the current family for both channels
      coef() {
        const fs = this.fs, co = this.co, fam = this.fam, sub = this.sub, res = this.res, vr = this.vr;
        const kr = K0 * (1 - 0.99 * res);
        this.k0 = K0; this.r = 0; this.fat = 0; this.lk = 0;
        for (let ch = 0; ch < 2; ch++) {
          const fc = ch ? this.fcR : this.fcL, c = ch * NCO, hi = 0.45 * fs;
          const g = prew(fc, fs);
          co[c] = g; co[c + 1] = g / (1 + g);
          if (fam === F_LADDER || fam === F_GERMAN || fam === F_FRENCH) {
            if (ch) this.GR = g / (1 + g); else this.GL = g / (1 + g);
            if (fam === F_FRENCH) {                             // BP at 2·cutoff (Q 2) for the BOEUF feedback
              const f2 = 2 * fc < hi ? 2 * fc : hi, g2 = prew(f2, fs), k2 = 0.5, a1 = 1 / (1 + g2 * (g2 + k2));
              co[c + 2] = g2; co[c + 23] = a1; co[c + 24] = g2 * a1; co[c + 25] = g2 * g2 * a1;
            }
          } else if (fam === F_SVF || fam === F_MORPH || fam === F_ADDBASS || fam === F_DISTCOMB || fam === F_SCREAM ||
            fam === F_DUAL) {
            const a1 = 1 / (1 + g * (g + K0));
            co[c + 20] = a1; co[c + 21] = g * a1; co[c + 22] = g * g * a1;
            if (fam === F_DUAL || fam === F_SCREAM) {
              let f2 = fVar(vr);
              f2 = f2 > 8 ? (f2 < hi ? f2 : hi) : 8;
              const g2 = prew(f2, fs), b1 = 1 / (1 + g2 * (g2 + K0));
              co[c + 2] = g2; co[c + 3] = g2 / (1 + g2);
              co[c + 23] = b1; co[c + 24] = g2 * b1; co[c + 25] = g2 * g2 * b1;
            }
            if (fam === F_DISTCOMB) {
              let fcb = fc * exp2(4 * (vr - 0.5));
              fcb = fcb > 8 ? (fcb < hi ? fcb : hi) : 8;
              co[c + 6] = fs / fcb;
            }
          } else if (fam === F_COMB || fam === F_FLANGE || fam === F_PHASER || fam === F_FPHS) {
            co[c + 6] = fs / fc;
            const lk = fam === F_FPHS ? 3 : fam === F_PHASER ? (sub < 8 ? 0 : 1 + ((sub - 8) >> 1)) : sub >> 1;
            if (lk === 1 || lk === 2) {
              let f2 = fVar(vr);
              f2 = f2 > 8 ? (f2 < hi ? f2 : hi) : 8;
              const g2 = prew(f2, fs);
              co[c + 3] = g2 / (1 + g2);
            } else if (lk === 3) {
              const w = 0.25 + 5 * vr;
              let fh = fc * exp2(-w), fl = fc * exp2(w);
              fh = fh > 8 ? (fh < hi ? fh : hi) : 8;
              fl = fl > 8 ? (fl < hi ? fl : hi) : 8;
              const gh = prew(fh, fs), gl = prew(fl, fs);
              co[c + 3] = gh / (1 + gh); co[c + 5] = gl / (1 + gl);
            }
          } else if (fam === F_EQ) {
            this.eqCoef(c, fc, vr, res);
          } else if (fam === F_RING) {
            co[c + 7] = fc / fs * (sub === 1 ? 1 + 0.5 * vr : 1);
            co[c + 8] = fc / fs * (1 - 0.5 * vr);
          } else if (fam === F_SNH) {
            co[c + 7] = fc / fs;
          } else if (fam === F_BANK) {
            const R = fs / fc;
            if (sub === 0) for (let j = 0; j < 6; j++) co[c + 14 + j] = R / (BANK_M[j] * (ch ? 1.007 : 1));
            else if (sub === 1) for (let j = 0; j < 6; j++) co[c + 14 + j] = R * AP_M[j];
            else for (let j = 0; j < 4; j++) co[c + 14 + j] = R * FDN_M[j];
          } else if (fam === F_FORMANT) {
            const kf = 1 / (5 + 20 * res), tb = sub * 15;
            let P = log(fc / 80) / log(100);
            P = 4 * (P > 0 ? (P < 1 ? P : 1) : 0);
            const i0 = P < 4 ? floor(P) : 4, i1 = i0 < 4 ? i0 + 1 : 4, t = P - i0, sh = exp2(2 * vr);
            for (let j = 0; j < 3; j++) {
              let F = (FORMANT[tb + i0 * 3 + j] + t * (FORMANT[tb + i1 * 3 + j] - FORMANT[tb + i0 * 3 + j])) * sh;
              F = F > 8 ? (F < hi ? F : hi) : 8;
              const gf = prew(F, fs), a1 = 1 / (1 + gf * (gf + kf)), b = c + 14 + 4 * j;
              co[b] = gf; co[b + 1] = a1; co[b + 2] = gf * a1; co[b + 3] = gf * gf * a1;
            }
            this.kf = kf;
          } else if (fam === F_BREJECT) {
            const bw = (0.1 + 3.9 * vr) * (1 - 0.9 * res), q = exp2(bw), kb = (q - 1) / sqrt(q), a1 = 1 / (1 + g * (g + kb));
            co[c + 20] = a1; co[c + 21] = g * a1; co[c + 22] = g * g * a1;
            this.kb = kb;
          }
        }
        switch (fam) {
          case F_LADDER: this.k = 4.1 * res; this.tap = sub; break;
          case F_GERMAN: case F_FRENCH: this.k = 4.1 * res; this.tap = 3; break;
          case F_SVF: this.r = K0 - kr; this.fat = vr; this.pk = 4 * res; break;
          case F_DUAL: this.r = K0 - kr; this.pk = 4 * res; break;
          case F_MORPH:
            this.r = K0 - kr; this.pk = 4 * res;
            if (vr <= 0.5) { this.wA = 1 - 2 * vr; this.wB = 2 * vr; this.wC = 0; }
            else { this.wA = 0; this.wB = 2 - 2 * vr; this.wC = 2 * vr - 1; }
            break;
          case F_COMB: case F_FLANGE: {
            this.flg = fam === F_FLANGE ? 1 : 0;
            this.lk = sub >> 1;
            this.fb = (this.flg ? 0.9 : 0.995) * res;
            this.fbs = (sub & 1) ? -this.fb : this.fb;
            this.fat = this.lk === 0 ? vr : 0;
            this.norm = this.flg ? 1 : sqrt(1 - this.fb * this.fb);
            break;
          }
          case F_PHASER: {
            const s2 = sub < 8 ? sub : sub - 8;
            this.nap = sub < 8 ? 4 * (1 + (sub >> 1)) : 16;
            this.lk = sub < 8 ? 0 : 1 + ((sub - 8) >> 1);
            this.fb = 0.9 * res; this.fbs = (s2 & 1) ? -this.fb : this.fb;
            this.fat = this.lk === 0 ? vr : 0;
            break;
          }
          case F_FPHS: this.lk = 3; this.fb = 0.9 * res; this.fbs = sub ? -this.fb : this.fb; break;
          case F_BANK:
            this.dc = 1 - 0.9 * vr;
            this.fb = sub === 0 ? 0.97 * res : sub === 1 ? 0.5 + 0.45 * res : 0.5 + 0.49 * res;
            break;
          case F_ADDBASS: this.r = K0 - kr; break;
          case F_DISTCOMB:
            this.r = 0.5 * (K0 - kr); this.bpo = sub & 1;
            this.fb = 0.98 * res; this.fbs = sub >= 2 ? -this.fb : this.fb;
            break;
          case F_SCREAM: this.bpo = sub; this.gs = 2 + 30 * this.drive * this.drive; break;
          default: break;
        }
      }
      eqCoef(c, fc, vr, res) {
        const co = this.co, fs = this.fs, t = this.type;
        const db = vr < 0.5 ? (vr > 0 ? 40 * Math.log10(2 * vr) : -96) : 48 * (vr - 0.5);
        const dB = db > -96 ? db : -96;
        let b0, b1, b2, a0, a1, a2;
        if (t === 71 || t === 74) {                             // first-order shelves, midpoint gain at fc
          const k = prew(fc, fs), sg = pow(10, dB / 40);
          if (t === 71) { b0 = 1 + k * sg; b1 = -1 + k * sg; a0 = 1 + k / sg; a1 = -1 + k / sg; }
          else { b0 = sg + k; b1 = -sg + k; a0 = 1 / sg + k; a1 = -1 / sg + k; }
          b2 = 0; a2 = 0;
        } else {                                               // RBJ cookbook
          const A = pow(10, dB / 40), w0 = 2 * PI * fc / fs, cw = cos(w0), sw = sin(w0);
          const Q = t === 73 ? 0.5 + 9.5 * res : 0.5 + 4 * res, al = sw / (2 * Q), sa = 2 * sqrt(A) * al;
          if (t === 73) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
          else if (t === 72) {
            b0 = A * ((A + 1) - (A - 1) * cw + sa); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sa);
            a0 = (A + 1) + (A - 1) * cw + sa; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sa;
          } else {
            b0 = A * ((A + 1) + (A - 1) * cw + sa); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sa);
            a0 = (A + 1) - (A - 1) * cw + sa; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sa;
          }
        }
        co[c + 9] = b0 / a0; co[c + 10] = b1 / a0; co[c + 11] = b2 / a0; co[c + 12] = a1 / a0; co[c + 13] = a2 / a0;
      }
      tick(xl, xr) {
        let a, b;
        if (this.cl !== 0) { xl *= CLEAN_IN; xr *= CLEAN_IN; }
        switch (this.fam) {
          case F_LADDER: a = this.fLad(0, xl); b = this.fLad(1, xr); break;
          case F_SVF: a = this.fSvf(0, xl); b = this.fSvf(1, xr); break;
          case F_DUAL: a = this.fDual(0, xl); b = this.fDual(1, xr); break;
          case F_MORPH: a = this.fMorph(0, xl); b = this.fMorph(1, xr); break;
          case F_COMB: case F_FLANGE: a = this.fComb(0, xl); b = this.fComb(1, xr); break;
          case F_PHASER: a = this.fPhs(0, xl); b = this.fPhs(1, xr); break;
          case F_FPHS: a = this.fFphs(0, xl); b = this.fFphs(1, xr); break;
          case F_EQ: a = this.fEq(0, xl); b = this.fEq(1, xr); break;
          case F_RING: a = this.fRing(0, xl); b = this.fRing(1, xr); break;
          case F_SNH: a = this.fSnh(0, xl); b = this.fSnh(1, xr); break;
          case F_BANK: a = this.fBank(0, xl); b = this.fBank(1, xr); break;
          case F_FRENCH: a = this.fFrench(0, xl); b = this.fFrench(1, xr); break;
          case F_GERMAN: a = this.fGerman(0, xl); b = this.fGerman(1, xr); break;
          case F_ADDBASS: a = this.fAddBass(0, xl); b = this.fAddBass(1, xr); break;
          case F_FORMANT: a = this.fFormant(0, xl); b = this.fFormant(1, xr); break;
          case F_BREJECT: a = this.fBrej(0, xl); b = this.fBrej(1, xr); break;
          case F_DISTCOMB: a = this.fDistComb(0, xl); b = this.fDistComb(1, xr); break;
          case F_NEW: {
            const o = this.nx;
            if (o !== null) { o.tick(xl, xr); a = o.yl; b = o.yr; } else { a = xl; b = xr; }
            break;
          }
          default: a = this.fScream(0, xl); b = this.fScream(1, xr); break;
        }
        if (this.cl !== 0) { a *= CLEAN_OUT; b *= CLEAN_OUT; }
        this.yl = a <= 8 && a >= -8 ? a : lim(a);
        this.yr = b <= 8 && b >= -8 ? b : lim(b);
      }
      process(L, R, off, n) {
        const end = off + n;
        const sub = this.sub;
        if (this.cl !== 0) { this.pClean(L, R, off, end); return; }
        if (this.fam === F_NEW) { this.pNew(L, R, off, end); return; }
        if (this.fam === F_LADDER) { if (n > 0) this.pLad(L, R, off, end); }
        else if (this.fam === F_SVF && (sub === 1 || sub === 5 || sub === 8 || sub === 10 || sub === 12)) { if (n > 0) this.pSvf(L, R, off, end, sub); }
        else {
          for (let i = off; i < end; i++) {
            this.tick(L[i], R[i]);
            L[i] = this.yl; R[i] = this.yr;
          }
        }
        this.flushFam();
        this.cln = 1;
      }
      // Serum 2 families: the SxFilt2 object processes the block (missing object: unfiltered)
      pNew(L, R, off, end) {
        const o = this.nx;
        if (o !== null) {
          if (end > off) {
            o.process(L, R, off, end - off);
            for (let i = off; i < end; i++) {
              const a = L[i], b = R[i];
              if (!(a <= 8 && a >= -8)) L[i] = lim(a);
              if (!(b <= 8 && b >= -8)) R[i] = lim(b);
            }
          }
        }
        if (end > off) { this.yl = L[end - 1]; this.yr = R[end - 1]; }
      }
      // Clean Mode (§6.13.3): input −24 dB, output +24 dB around the family
      pClean(L, R, off, end) {
        for (let i = off; i < end; i++) { L[i] *= CLEAN_IN; R[i] *= CLEAN_IN; }
        this.cl = 0;
        this.process(L, R, off, end - off);
        this.cl = 1;
        for (let i = off; i < end; i++) {
          const a = L[i] * CLEAN_OUT, b = R[i] * CLEAN_OUT;
          L[i] = a <= 8 && a >= -8 ? a : lim(a); R[i] = b <= 8 && b >= -8 ? b : lim(b);
        }
        if (end > off) { this.yl = L[end - 1]; this.yr = R[end - 1]; }
      }
      // Low / High / Band / Peak / Notch 12 (one SVF stage) the same way: tick → fSvf → svf inlined, bit for bit
      pSvf(L, R, off, end, sub) {
        const s = this.st, co = this.co, dg = this.dg, k0 = this.k0, r = this.r, fat = this.fat, pk = this.pk;
        let v1 = 0, v2 = 0, k = k0;
        for (let ch = 0; ch < 2; ch++) {
          const X = ch ? R : L, o = ch * ST, c = ch * NCO, g = co[c];
          const b1 = co[c + 20], b2 = co[c + 21], b3 = co[c + 22];
          let ic1 = s[o], ic2 = s[o + 1], bp = s[o + 2];
          for (let i = off; i < end; i++) {
            const x = sc(X[i] * dg);
            let a1 = b1, a2 = b2, a3 = b3;
            k = k0;
            if (r > 0) {
              let sg = tg(0.5 * bp);
              if (fat > 0) sg *= 1 + fat * (tg(3 * bp) - 1);
              k -= r * sg;
              a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
            }
            const v3 = x - ic2;
            v1 = a1 * ic1 + a2 * v3; v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; bp = v1;
            const y = sub === 1 ? v2 : sub === 5 ? x - k * v1 - v2 : sub === 8 ? k * v1 : sub === 10 ? x + pk * k * v1 : x - k * v1;
            X[i] = y <= 8 && y >= -8 ? y : lim(y);
          }
          s[o] = ic1; s[o + 1] = ic2; s[o + 2] = bp;
        }
        this.v1 = v1; this.v2 = v2; this.ke = k;
        this.yl = L[end - 1]; this.yr = R[end - 1];
      }
      // MG Low 6/12/18/24 (the default family) as one block loop per channel with the state in locals: the same
      // arithmetic as tick → fLad → ladder, bit for bit, without per-sample calls (V8 did not inline them and boxed
      // their double arguments: ~180 MB/s of garbage and ~25 minor GCs per second for one filtered track)
      pLad(L, R, off, end) {
        const s = this.ld, dg = this.dg, k = this.k, fat = this.vr, tap = this.tap;
        for (let ch = 0; ch < 2; ch++) {
          const X = ch ? R : L, o = ch * LD, G = ch ? this.GR : this.GL, a = 1 - G;
          let s0 = s[o], s1 = s[o + 1], s2 = s[o + 2], s3 = s[o + 3], y0p = s[o + 4], y1p = s[o + 5], y2p = s[o + 6], y3p = s[o + 7];
          let up = s[o + 8];
          for (let i = off; i < end; i++) {
            const x = X[i] * dg;
            const g0 = G * tg(up * IV), g1 = G * tg(y0p * IV), g2 = G * tg(y1p * IV), g3 = G * tg(y2p * IV);
            const kf = fat > 0 ? k * (1 + fat * (tg(3 * y3p) - 1)) : k;
            const B0 = a * s0, B1 = g1 * B0 + a * s1, B2 = g2 * B1 + a * s2, B3 = g3 * B2 + a * s3;
            const A3 = g0 * g1 * g2 * g3;
            const u = (x - kf * B3) / (1 + kf * A3);
            const y0 = g0 * u + B0, y1 = g1 * y0 + a * s1, y2 = g2 * y1 + a * s2, y3 = g3 * y2 + a * s3;
            s0 = 2 * y0 - s0; s1 = 2 * y1 - s1; s2 = 2 * y2 - s2; s3 = 2 * y3 - s3;
            y0p = y0; y1p = y1; y2p = y2; y3p = y3; up = u;
            const y = tap === 3 ? y3 : tap === 1 ? y1 : tap === 0 ? y0 : y2;
            X[i] = y <= 8 && y >= -8 ? y : lim(y);
          }
          s[o] = s0; s[o + 1] = s1; s[o + 2] = s2; s[o + 3] = s3; s[o + 4] = y0p; s[o + 5] = y1p; s[o + 6] = y2p; s[o + 7] = y3p;
          s[o + 8] = up;
          if (ch === 1) { this.ly0 = y0p; this.ly1 = y1p; this.ly2 = y2p; }
        }
        this.yl = L[end - 1]; this.yr = R[end - 1];
      }
      reset() {
        this.ld.fill(0); this.st.fill(0); this.lc.fill(0);
        if (this.nx !== null) this.nx.reset();
        this.yl = 0; this.yr = 0;
      }
      // denormal flush of every feedback state; a non-finite or runaway state resets the filter
      flush() {
        const s = this.st, l = this.ld;
        let bad = 0;
        for (let i = 0; i < 2 * ST; i++) {
          const v = s[i];
          if (v < 1e-30 && v > -1e-30) s[i] = 0;
          else if (!(v < 1e9 && v > -1e9)) bad = 1;
        }
        for (let i = 0; i < 2 * LD; i++) {
          const v = l[i];
          if (v < 1e-30 && v > -1e-30) l[i] = 0;
          else if (!(v < 1e9 && v > -1e9)) bad = 1;
        }
        if (bad) this.reset();
      }
      // (M4) flush() of the states the current family can hold: ld is written by the ladder families only (MG Low, German,
      // French; zeroed on every change between the Phase-1 families and by reset), st by every family but MG Low, and the
      // SVF family only st[0 … 6] of each channel — checking a state that holds 0 changes nothing, so this equals flush()
      // (twice per chunk and voice: set, process)
      flushFam() {
        const fam = this.fam;
        if (fam === F_LADDER) this.flushLd();
        else if (fam === F_SVF) this.flushSt(7);                // (fSvf / pSvf: st[0 … 6] of each channel)
        else if (fam === F_GERMAN || fam === F_FRENCH || fam === F_NEW) this.flush();   // (New: setType keeps ld)
        else this.flushSt(ST);
      }
      // flush() of st[0 … m) of each channel
      flushSt(m) {
        const s = this.st;
        let bad = 0;
        for (let c = 0; c < 2 * ST; c += ST) {
          for (let i = c; i < c + m; i++) {
            const v = s[i];
            if (v < 1e-30 && v > -1e-30) s[i] = 0;
            else if (!(v < 1e9 && v > -1e9)) bad = 1;
          }
        }
        if (bad) this.reset();
      }
      // flush for the MG Low ladder (pLad keeps its whole state in ld; st stays zero for that family): the same result as
      // flush() with a third of the checks (once per chunk and voice, the default filter)
      flushLd() {
        const l = this.ld;
        let bad = 0;
        for (let i = 0; i < 2 * LD; i++) {
          const v = l[i];
          if (v < 1e-30 && v > -1e-30) l[i] = 0;
          else if (!(v < 1e9 && v > -1e9)) bad = 1;
        }
        if (bad) this.reset();
      }

      /* ---- building blocks ---- */
      // TPT one-pole LP, state st[o], G = g/(1+g)
      op(o, x, G) {
        const s = this.st, v = (x - s[o]) * G, lp = v + s[o];
        s[o] = lp + v;
        return lp;
      }
      // TPT SVF with a saturating resonance part (state st[o..o+2]); outputs this.v1 (bp), this.v2 (lp), this.ke (k)
      svf(o, x, g, a1, a2, a3) {
        const s = this.st, ic1 = s[o], ic2 = s[o + 1];
        let k = this.k0;
        if (this.r > 0) {
          const b = s[o + 2];
          let sg = tg(0.5 * b);
          if (this.fat > 0) sg *= 1 + this.fat * (tg(3 * b) - 1);
          k -= this.r * sg;
          a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
        }
        const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        s[o] = 2 * v1 - ic1; s[o + 1] = 2 * v2 - ic2; s[o + 2] = v1;
        this.v1 = v1; this.v2 = v2; this.ke = k;
      }
      // linear TPT SVF with fixed damping k (a's precomputed for that k)
      svfLin(o, x, k, a1, a2, a3) {
        const s = this.st, ic1 = s[o], ic2 = s[o + 1];
        const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        s[o] = 2 * v1 - ic1; s[o + 1] = 2 * v2 - ic2;
        this.v1 = v1; this.v2 = v2; this.ke = k;
      }
      resp(c, x) {
        if (c === 0) return this.v2;
        const kb = this.ke * this.v1;
        if (c === 1) return x - kb - this.v2;
        if (c === 2) return kb;
        if (c === 3) return x + this.pk * kb;
        return x - kb;
      }
      // 4-stage ladder at state ld[o..o+8]; returns y3 (stage outputs y0..y2 in ly0..ly2)
      ladder(o, x, G, k, fat, iv, lin) {
        const s = this.ld, a = 1 - G;
        const s0 = s[o], s1 = s[o + 1], s2 = s[o + 2], s3 = s[o + 3];
        let g0 = G, g1 = G, g2 = G, g3 = G, kf = k;
        if (lin) kf = k * tg(0.25 * s[o + 7]);                  // German: linear stages, soft-limited feedback
        else {
          // secant gains of the stage tanh's at the previous sample's arguments
          g0 = G * tg(s[o + 8] * iv); g1 = G * tg(s[o + 4] * iv); g2 = G * tg(s[o + 5] * iv); g3 = G * tg(s[o + 6] * iv);
          if (fat > 0) kf = k * (1 + fat * (tg(3 * s[o + 7]) - 1));
        }
        // y3 = A3·u + B3 through the four stages, then u = x − kf·y3 solved for u
        const B0 = a * s0, B1 = g1 * B0 + a * s1, B2 = g2 * B1 + a * s2, B3 = g3 * B2 + a * s3;
        const A3 = g0 * g1 * g2 * g3;
        const u = (x - kf * B3) / (1 + kf * A3);
        const y0 = g0 * u + B0, y1 = g1 * y0 + a * s1, y2 = g2 * y1 + a * s2, y3 = g3 * y2 + a * s3;
        s[o] = 2 * y0 - s0; s[o + 1] = 2 * y1 - s1; s[o + 2] = 2 * y2 - s2; s[o + 3] = 2 * y3 - s3;
        s[o + 4] = y0; s[o + 5] = y1; s[o + 6] = y2; s[o + 7] = y3; s[o + 8] = u;
        this.ly0 = y0; this.ly1 = y1; this.ly2 = y2;
        return y3;
      }
      // delay line j: read at fractional delay d (samples), write one sample
      lr(j, d) {
        const n = this.ln[j];
        if (d > n - 3) d = n - 3;
        if (d < 1) d = 1;
        if (d > this.lc[j]) return 0;                          // older than what was written since the last reset
        let r = this.lw[j] - d;
        if (r < 0) r += n;
        const i = r | 0, f = r - i, b = this.lb[j], P = this.pool, a = P[b + i];
        return a + f * (P[b + (i + 1 < n ? i + 1 : 0)] - a);
      }
      lwr(j, v) {
        if (v < 1e-30 && v > -1e-30) v = 0;
        const w = this.lw[j];
        this.pool[this.lb[j] + w] = v;
        this.lw[j] = w + 1 < this.ln[j] ? w + 1 : 0;
        if (this.lc[j] < this.ln[j]) this.lc[j]++;
      }
      // feedback saturation: 2·tanh(v/2) (+ FAT)
      fbSat(v) {
        let sg = tg(0.5 * v);
        if (this.fat > 0) sg *= 1 + this.fat * (tg(3 * v) - 1);
        return v * sg;
      }
      // loop filter of the comb/flange/phaser variants (states st[o], st[o+1])
      loopF(o, d, c) {
        const lk = this.lk;
        if (lk === 0) return d;
        const co = this.co;
        if (lk === 1) return this.op(o, d, co[c + 3]);
        const h = d - this.op(o, d, co[c + 3]);
        if (lk === 2) return h;
        return this.op(o + 1, h, co[c + 5]);
      }

      /* ---- families (one channel each) ---- */
      fLad(ch, x) {
        const y3 = this.ladder(ch * LD, x * this.dg, ch ? this.GR : this.GL, this.k, this.vr, IV, 0);
        const t = this.tap;
        return t === 3 ? y3 : t === 1 ? this.ly1 : t === 0 ? this.ly0 : this.ly2;
      }
      fGerman(ch, x) {
        return this.ladder(ch * LD, sc(x * this.dg), ch ? this.GR : this.GL, this.k, 0, IV, 1);
      }
      fFrench(ch, x) {
        const c = ch * NCO, o = ch * ST, co = this.co, s = this.st;
        this.svfLin(o, s[o + 3], 0.5, co[c + 23], co[c + 24], co[c + 25]);
        const bp = 0.5 * this.v1;
        const y = this.ladder(ch * LD, 2 * x * this.dg + 8 * this.vr * bp, ch ? this.GR : this.GL, this.k, 0, 1, 0);
        s[o + 3] = y;
        return 0.5 * y;
      }
      fSvf(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, co = this.co, g = co[c], a1 = co[c + 20], a2 = co[c + 21], a3 = co[c + 22];
        switch (this.sub) {
          case 0: return this.op(o + 6, x, co[c + 1]);
          case 1: this.svf(o, x, g, a1, a2, a3); return this.v2;
          case 2: this.svf(o, x, g, a1, a2, a3); return this.op(o + 6, this.v2, co[c + 1]);
          case 3: this.svf(o, x, g, a1, a2, a3); this.svf(o + 3, this.v2, g, a1, a2, a3); return this.v2;
          case 4: return x - this.op(o + 6, x, co[c + 1]);
          case 5: this.svf(o, x, g, a1, a2, a3); return x - this.ke * this.v1 - this.v2;
          case 6: {
            this.svf(o, x, g, a1, a2, a3);
            const h = x - this.ke * this.v1 - this.v2;
            return h - this.op(o + 6, h, co[c + 1]);
          }
          case 7: {
            this.svf(o, x, g, a1, a2, a3);
            const h = x - this.ke * this.v1 - this.v2;
            this.svf(o + 3, h, g, a1, a2, a3);
            return h - this.ke * this.v1 - this.v2;
          }
          case 8: this.svf(o, x, g, a1, a2, a3); return this.ke * this.v1;
          case 9: {
            this.svf(o, x, g, a1, a2, a3);
            this.svf(o + 3, this.ke * this.v1, g, a1, a2, a3);
            return this.ke * this.v1;
          }
          case 10: this.svf(o, x, g, a1, a2, a3); return x + this.pk * this.ke * this.v1;
          case 11: {
            this.svf(o, x, g, a1, a2, a3);
            const p = x + this.pk * this.ke * this.v1;
            this.svf(o + 3, p, g, a1, a2, a3);
            return p + this.pk * this.ke * this.v1;
          }
          case 12: this.svf(o, x, g, a1, a2, a3); return x - this.ke * this.v1;
          default: {
            this.svf(o, x, g, a1, a2, a3);
            const n = x - this.ke * this.v1;
            this.svf(o + 3, n, g, a1, a2, a3);
            return n - this.ke * this.v1;
          }
        }
      }
      fDual(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, co = this.co, sub = this.sub;
        if (sub === 0) {
          const l = this.op(o + 6, x, co[c + 1]);
          return l - this.op(o + 7, l, co[c + 3]);
        }
        this.svf(o, x, co[c], co[c + 20], co[c + 21], co[c + 22]);
        const y = this.resp(DUAL_A[sub], x);
        this.svf(o + 3, y, co[c + 2], co[c + 23], co[c + 24], co[c + 25]);
        return this.resp(DUAL_B[sub], y);
      }
      fMorph(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, co = this.co, g = co[c], a1 = co[c + 20], a2 = co[c + 21], a3 = co[c + 22];
        const mb = (this.sub >> 1) * 3, rA = MORPH_R[mb], rB = MORPH_R[mb + 1], rC = MORPH_R[mb + 2];
        this.svf(o, x, g, a1, a2, a3);
        let y = this.wA * this.resp(rA, x) + this.wB * this.resp(rB, x) + this.wC * this.resp(rC, x);
        if (this.sub & 1) {
          this.svf(o + 3, y, g, a1, a2, a3);
          y = this.wA * this.resp(rA, y) + this.wB * this.resp(rB, y) + this.wC * this.resp(rC, y);
        }
        return y;
      }
      fComb(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST;
        const d = this.lr(ch, this.co[c + 6]);
        const y = x + this.fbs * this.fbSat(this.loopF(o, d, c));
        this.lwr(ch, y);
        return this.flg ? 0.5 * (x + d) : y * this.norm;
      }
      fPhs(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, s = this.st, G = this.co[c + 1], n = this.nap;
        let u = x + this.fbs * this.fbSat(this.loopF(o + 18, s[o + 20], c));
        for (let k = 0; k < n; k++) {
          const v = (u - s[o + k]) * G, lp = v + s[o + k];
          s[o + k] = lp + v;
          u = 2 * lp - u;
        }
        s[o + 20] = u;
        return 0.5 * (x + u);
      }
      fFphs(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, s = this.st, G = this.co[c + 1];
        let d = this.lr(ch, this.co[c + 6]);
        for (let k = 0; k < 4; k++) {
          const v = (d - s[o + k]) * G, lp = v + s[o + k];
          s[o + k] = lp + v;
          d = 2 * lp - d;
        }
        this.lwr(ch, x + this.fbs * this.fbSat(this.loopF(o + 4, d, c)));
        return 0.5 * (x + d);
      }
      fEq(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, co = this.co, s = this.st;
        const y = co[c + 9] * x + s[o];
        s[o] = co[c + 10] * x - co[c + 12] * y + s[o + 1];
        s[o + 1] = co[c + 11] * x - co[c + 13] * y;
        return y;
      }
      fRing(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, s = this.st;
        let p = s[o] + this.co[c + 7];
        if (p >= 1) p -= floor(p);
        if (this.sub === 0) { const y = x * sin1(s[o]); s[o] = p; return y; }
        let q = s[o + 1] + this.co[c + 8];
        if (q >= 1) q -= floor(q);
        const y = 0.5 * x * (sin1(s[o]) + sin1(s[o + 1]));
        s[o] = p; s[o + 1] = q;
        return y;
      }
      fSnh(ch, x) {
        x = sc(x * this.dg);
        const o = ch * ST, s = this.st;
        let p = s[o] + this.co[ch * NCO + 7];
        if (p >= 1) { p -= floor(p); s[o + 1] = x; }
        s[o] = p;
        return this.sub ? x - s[o + 1] : s[o + 1];
      }
      fBank(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO + 14, o = ch * ST, s = this.st, co = this.co, dc = this.dc, fb = this.fb, sub = this.sub;
        if (sub === 0) {                                       // 6 parallel feedback combs
          let y = 0;
          for (let j = 0; j < 6; j++) {
            const L = ch * 6 + j, d = this.lr(L, co[c + j]);
            const lp = s[o + j] + dc * (d - s[o + j]);
            s[o + j] = lp;
            this.lwr(L, x + fb * lp * tg(0.5 * lp));
            y += d;
          }
          return 0.4082482904638631 * y;
        }
        if (sub === 1) {                                       // 6 series Schroeder allpasses
          let u = x;
          for (let j = 0; j < 6; j++) {
            const L = ch * 6 + j, d = this.lr(L, co[c + j]);
            const dd = s[o + j] + dc * (d - s[o + j]);
            s[o + j] = dd;
            const v = u + fb * dd;
            this.lwr(L, v * tg(0.125 * v));
            u = dd - fb * v;
          }
          return u;
        }
        const L0 = ch * 4;                                     // 4-line Hadamard FDN
        let r0 = this.lr(L0, co[c]), r1 = this.lr(L0 + 1, co[c + 1]), r2 = this.lr(L0 + 2, co[c + 2]), r3 = this.lr(L0 + 3, co[c + 3]);
        r0 = s[o] + dc * (r0 - s[o]); s[o] = r0;
        r1 = s[o + 1] + dc * (r1 - s[o + 1]); s[o + 1] = r1;
        r2 = s[o + 2] + dc * (r2 - s[o + 2]); s[o + 2] = r2;
        r3 = s[o + 3] + dc * (r3 - s[o + 3]); s[o + 3] = r3;
        const h0 = 0.5 * (r0 + r1 + r2 + r3), h1 = 0.5 * (r0 - r1 + r2 - r3), h2 = 0.5 * (r0 + r1 - r2 - r3), h3 = 0.5 * (r0 - r1 - r2 + r3);
        const xi = 0.5 * x;
        this.lwr(L0, xi + fb * h0 * tg(0.5 * h0));
        this.lwr(L0 + 1, xi + fb * h1 * tg(0.5 * h1));
        this.lwr(L0 + 2, xi + fb * h2 * tg(0.5 * h2));
        this.lwr(L0 + 3, xi + fb * h3 * tg(0.5 * h3));
        return 0.5 * (r0 + r1 + r2 + r3);
      }
      fAddBass(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, o = ch * ST, co = this.co, s = this.st;
        this.svf(o, x, co[c], co[c + 20], co[c + 21], co[c + 22]);
        const lp = this.v2;
        const v = (x - s[o + 3]) * co[c + 1], l1 = v + s[o + 3];
        s[o + 3] = l1 + v;
        return th(1.5 * lp) * 0.6666666666666666 + this.vr * (2 * l1 - x);
      }
      fFormant(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO + 14, o = ch * ST, co = this.co, kf = this.kf;
        let y = 0;
        for (let j = 0; j < 3; j++) {
          const b = c + 4 * j;
          this.svfLin(o + 3 * j, x, kf, co[b + 1], co[b + 2], co[b + 3]);
          y += FORMANT_G[j] * kf * this.v1;
        }
        return y;
      }
      fBrej(ch, x) {
        x = sc(x * this.dg);
        const c = ch * NCO, co = this.co;
        this.svfLin(ch * ST, x, this.kb, co[c + 20], co[c + 21], co[c + 22]);
        return x - this.kb * this.v1;
      }
      fDistComb(ch, x) {
        const c = ch * NCO, o = ch * ST, co = this.co;
        const d = this.lr(ch, co[c + 6]);
        const u = sc(x * this.dg) + this.fbs * th(1.5 * d);
        this.svf(o, u, co[c], co[c + 20], co[c + 21], co[c + 22]);
        const y = this.bpo ? this.ke * this.v1 : this.v2;
        this.lwr(ch, y);
        return y;
      }
      fScream(ch, x) {
        const c = ch * NCO, o = ch * ST, co = this.co, s = this.st;
        const v = this.op(o + 4, s[o + 5], co[c + 3]);
        const u = sc(x * this.dg) + this.res * th(this.gs * v);
        this.svf(o, u, co[c], co[c + 20], co[c + 21], co[c + 22]);
        const y = this.bpo ? this.ke * this.v1 : this.v2;
        s[o + 5] = y;
        return y;
      }
    }

    // left-channel response of a fresh SFilter to a 0.01-amplitude impulse, divided by 0.01 (UI displays)
    // (x, y, pz: PZ SVF position and corners, §6.13.4, passed through to SxFilt2.impulse for the types ≥ 96)
    function filterImpulse(type, fc, res, drive, vr, fs, len = 4096, x = 0, y = 0, pz = null) {
      if (round(+type) >= NTYPES) {                            // Serum 2 types: SxFilt2 (unit impulse without it)
        const F2 = globalThis.SxFilt2, t = round(+type) < NT2 ? round(+type) : NT2 - 1;
        if (F2 && typeof F2.impulse === 'function') return F2.impulse(t, fc, res, drive, vr, fs > 0 ? +fs : 48000, len > 0 ? len | 0 : 0, x, y, pz);
        const u = new Float64Array(len > 0 ? len | 0 : 0);
        if (u.length) u[0] = 1;
        return u;
      }
      const f = new SFilter(fs), out = new Float64Array(len > 0 ? len | 0 : 0);
      f.setType(type);
      f.set(fc, fc, res, drive, vr);
      for (let i = 0; i < out.length; i++) {
        const x = i === 0 ? 0.01 : 0;
        f.tick(x, x);
        out[i] = f.yl / 0.01;
      }
      return out;
    }

    /* ------------------------------------------------------------ CT v2 store (§4.1): defaults, part merging */
    const LFO_N = 1024, REMAP_N = 2048, CURVE_N = 128, CRV_N = 128, SPEC_FILT_N = 512;
    const CT_PTS = N_LFO * MAX_PTS;                            // packed LFO points of a merged CT (≤ 480 per LFO)
    const TRI = Float64Array.from([0, 0, 0, 0.5, 1, 0, 1, 0, 0]), TRI_PM = new Uint8Array(6);
    // identity remap of every oscillator (renderWarp without opts.remap; the voices before any CT) and identity curve
    const DEF_REMAP = new Float32Array(N_OSC * (REMAP_N + 1));
    for (let o = 0; o < N_OSC; o++) for (let j = 0; j <= REMAP_N; j++) DEF_REMAP[o * (REMAP_N + 1) + j] = j / REMAP_N;
    const DEF_TAB = new Float32Array(CURVE_N + 1);
    for (let j = 0; j <= CURVE_N; j++) DEF_TAB[j] = j / CURVE_N;
    // a full CT v2 (§4.1 layout; one per processor, allocated in attach) holding the built-in defaults
    function makeCT() {
      const ct = { key: '', lfoTab: new Float32Array(N_LFO * (LFO_N + 1)), lfoPtsOff: new Uint16Array(N_LFO + 1),
        lfoPts: new Float64Array(3 * CT_PTS), lfoPm: new Uint8Array(2 * CT_PTS), lfoPmAny: new Uint8Array(N_LFO),
        lfoStart: new Float64Array(N_LFO), lfoLoop: new Float64Array(N_LFO).fill(-1),
        pathX: new Float32Array(N_LFO * (LFO_N + 1)), pathY: new Float32Array(N_LFO * (LFO_N + 1)),
        remap: DEF_REMAP.slice(), veloTab: DEF_TAB.slice(), noteTab: DEF_TAB.slice(),
        crv: new Float32Array(NROW * (CRV_N + 1)), specFilt: new Float32Array(N_OSC * (SPEC_FILT_N + 1)).fill(1) };
      for (let l = 0; l < N_LFO; l++) {
        ct.lfoPtsOff[l] = 3 * l;
        ct.lfoPts.set(TRI, 9 * l);
        for (let j = 0; j <= LFO_N; j++) ct.lfoTab[l * (LFO_N + 1) + j] = evalPts(TRI, 0, 3, j / LFO_N);
      }
      ct.lfoPtsOff[N_LFO] = 3 * N_LFO;
      for (let r = 0; r < NROW; r++) ct.crv.set(DEF_TAB, r * (CRV_N + 1));
      return ct;
    }
    const partNames = (p, n) => Object.freeze(Array.from({ length: n }, (_, i) => p + i));
    const PN_LFO = partNames('lfo', N_LFO), PN_PATH = partNames('path', N_LFO), PN_REMAP = partNames('remap', N_OSC),
      PN_CRV = partNames('crv', NROW), PN_SPEC = partNames('spec', N_OSC);
    const isTA = (a, tag, n) => a !== null && typeof a === 'object' && ArrayBuffer.isView(a) && a[Symbol.toStringTag] === tag &&
      a.length === n;
    const warnedParts = new Set();
    function badPart(name) {
      if (warnedParts.has(name)) return;
      warnedParts.add(name);
      if (typeof console !== 'undefined') console.warn('serum-dsp: invalid CT part', name);
    }
    // merge the parts of t = {key, parts: {name: part}} (any subset, §4.1) into the processor's full CT; a part whose key
    // equals the merged one is skipped. Returns whether anything changed (then sx.ctGen counts up). Allocation-free.
    function mergeCT(proc, t) {
      const sx = proc.sx || attach(proc);
      const P = t !== null && typeof t === 'object' ? t.parts : null;
      if (P === null || typeof P !== 'object') return false;
      const C = sx.CT, K = sx.ctK;
      let ch = 0, lfo = 0;
      for (let l = 0; l < N_LFO; l++) {
        const q = P[PN_LFO[l]];
        if (q && q.key !== K.lfo[l]) {
          const n = q.n, st = +q.start, lp = +q.loop;
          if (Number.isInteger(n) && n >= 1 && n <= MAX_PTS && isTA(q.tab, 'Float32Array', LFO_N + 1) &&
            isTA(q.pts, 'Float64Array', 3 * n) && isTA(q.pm, 'Uint8Array', 2 * n) && st >= 0 && st <= 1 && lp >= -1 && lp <= 1) {
            K.lfo[l] = q.key; sx.ctQ[l] = q; lfo = 1;
            C.lfoTab.set(q.tab, l * (LFO_N + 1));
            C.lfoPmAny[l] = q.pmAny ? 1 : 0; C.lfoStart[l] = st; C.lfoLoop[l] = lp;
          } else badPart(PN_LFO[l]);
        }
        const w = P[PN_PATH[l]];
        if (w && w.key !== K.path[l]) {
          if (isTA(w.x, 'Float32Array', LFO_N + 1) && isTA(w.y, 'Float32Array', LFO_N + 1)) {
            K.path[l] = w.key; C.pathX.set(w.x, l * (LFO_N + 1)); C.pathY.set(w.y, l * (LFO_N + 1)); ch = 1;
          } else badPart(PN_PATH[l]);
        }
      }
      if (lfo) {                                               // repack the point lists in LFO order
        let off = 0;
        for (let l = 0; l < N_LFO; l++) {
          const q = sx.ctQ[l];
          C.lfoPtsOff[l] = off;
          if (q !== null) { C.lfoPts.set(q.pts, 3 * off); C.lfoPm.set(q.pm, 2 * off); off += q.n; }
          else { C.lfoPts.set(TRI, 3 * off); C.lfoPm.set(TRI_PM, 2 * off); off += 3; }
        }
        C.lfoPtsOff[N_LFO] = off;
        ch = 1;
      }
      for (let o = 0; o < N_OSC; o++) {
        const r = P[PN_REMAP[o]];
        if (r && r.key !== K.remap[o]) {
          if (isTA(r.tab, 'Float32Array', REMAP_N + 1)) { K.remap[o] = r.key; C.remap.set(r.tab, o * (REMAP_N + 1)); ch = 1; }
          else badPart(PN_REMAP[o]);
        }
        const s = P[PN_SPEC[o]];
        if (s && s.key !== K.spec[o]) {
          if (isTA(s.tab, 'Float32Array', SPEC_FILT_N + 1)) { K.spec[o] = s.key; C.specFilt.set(s.tab, o * (SPEC_FILT_N + 1)); ch = 1; }
          else badPart(PN_SPEC[o]);
        }
      }
      const vq = P.velo, nq = P.note;
      if (vq && vq.key !== K.velo) {
        if (isTA(vq.tab, 'Float32Array', CURVE_N + 1)) { K.velo = vq.key; C.veloTab.set(vq.tab); ch = 1; } else badPart('velo');
      }
      if (nq && nq.key !== K.note) {
        if (isTA(nq.tab, 'Float32Array', CURVE_N + 1)) { K.note = nq.key; C.noteTab.set(nq.tab); ch = 1; } else badPart('note');
      }
      for (let r = 0; r < NROW; r++) {
        const c = P[PN_CRV[r]];
        if (c && c.key !== K.crv[r]) {
          if (isTA(c.tab, 'Float32Array', CRV_N + 1)) { K.crv[r] = c.key; C.crv.set(c.tab, r * (CRV_N + 1)); ch = 1; }
          else badPart(PN_CRV[r]);
        }
      }
      if (typeof t.key === 'string' && t.key !== C.key) { C.key = t.key; ch = 1; }
      if (ch) sx.ctGen++;
      return ch === 1;
    }

    function xorshift(s) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }
    // key n is left unmapped by the loaded tuning (CP.tune[n] = NaN, §6.18; sx.tuned set)
    function unmapped(sx, n) { const k = n | 0, t = k >= 0 && k <= 127 ? sx.tune[k] : 0; return t !== t; }

    /* ------------------------------------------------------------ per-processor state (§8.4.2; modulation in SxMod) */
    const SEED = 0x2545F491;                                   // processor PRNG seed (constant: renders are reproducible)
    let warnedMod = false;
    function makeSnap() {
      return {
        eff: new Float32Array(NSV + MAXFX), lfoPh: new Float32Array(N_LFO), lfoOut: new Float32Array(N_LFO),
        lfoY: new Float32Array(N_LFO), env: new Float32Array(N_ENV), envStage: new Uint8Array(N_ENV), envT: new Float32Array(N_ENV),
        wtPos: new Float32Array(N_OSC), noisePos: 0, notes: 0, oscVoices: 0, maxVoices: 0, memNow: new Float32Array(16 * N_OSC),
        filtTap: new Float32Array(2 * TAP_N), tapRate: 0,
        // SPEC-serum2 §6.20 additions
        smpPos: new Float32Array(4 * N_OSC), grains: new Uint16Array(N_OSC), specCap: 0, mix: new Float32Array(11).fill(-120),
        mOut: new Float32Array(NROW), zone: new Int16Array(N_OSC).fill(-1), seq: new Float64Array(16),
      };
    }
    function attach(proc) {
      if (proc.sx) return proc.sx;
      const sx = {
        span: 0, nCh: 0, ok: 0, mon: 0, M: null, mod: null, g: null,
        // copies of the current CP v2 (§4.1) read by the voices (the modulation copies live in sx.mod, SxMod)
        cp: null, bT: new Float64Array(NSV), s1: 0, use: 0, outMask: 1, wt: ['', '', ''], noiseId: '', noiseColor: -1,
        oType: new Uint8Array(N_OSC), phMem: new Uint8Array(N_OSC), phLeg: new Uint8Array(N_OSC), smoothWT: new Uint8Array(N_OSC),
        pMode: new Uint8Array(N_OSC), pSrc: new Int8Array(N_OSC), bendTrack: new Uint8Array(N_OSC), uniMode: new Uint8Array(N_OSC),
        uniRange: new Float64Array(N_OSC), fmType: new Uint8Array(2 * N_OSC), memSet: new Float64Array(16 * N_OSC),
        xyOn: new Uint8Array(N_OSC), xyY: new Uint8Array(N_OSC), xyMode: new Uint8Array(N_OSC),
        mapLo: new Uint8Array(6), mapHi: new Uint8Array(6), mapVLo: new Uint8Array(6), mapVHi: new Uint8Array(6),
        mapFold: new Uint8Array(6), mapWarp: new Uint8Array(6), mapFull: new Uint8Array(6),
        route: new Uint8Array(7), envOn: new Uint8Array(7), fKey: new Uint8Array(2), fClean: new Uint8Array(2), pz: new Float64Array(24),
        subContig: 0, noiseOneshot: 0, noiseKey: 0, tuned: 0, tune: new Float64Array(128), sclN: 0, sclPer: 0,
        sclSteps: new Float64Array(128), mpeOn: 0, mpeBend: 48, vcOn: 0, vcSel: new Uint8Array(5), uniMax: 16,
        cMono: 0, cLegato: 0, cPoly: 8, a4: 440, steal: 0, anyDir: 0, anyBus: 0,
        srcU: new Uint8Array(NSRC2),                           // sources read by the matrix rows (audio taps, §5.3; from the CP)
        // CT store: the last proc.ct merged (parts, or a full CT object), the full CT, its generation, the LFO parts in
        // use, the merged part keys
        ctIn: null, ctFull: null, CT: makeCT(), ctGen: 0, ctQ: new Array(N_LFO).fill(null),
        ctK: { lfo: new Array(N_LFO).fill(''), path: new Array(N_LFO).fill(''), remap: new Array(N_OSC).fill(''),
          crv: new Array(NROW).fill(''), spec: new Array(N_OSC).fill(''), velo: '', note: '' },
        remap: DEF_REMAP,
        tap: new Float64Array(TAP_N), tapW: 0, tap2: new Float64Array(TAP_N), tapW2: 0,
        memPh: new Float64Array(N_OSC), subPh: 0, alt: 0, seed: (SEED ^ (proc.seedSalt | 0)) >>> 0, rng: (SEED ^ (proc.seedSalt | 0)) >>> 0,
        grains: 0, pk: new Float64Array(11),                  // processor grain count (SxGran, §6.9.2); mix-meter peaks
        snap: makeSnap(),
        // first-use warm-up on the real patch (warmStart): hidden voices, spans left, tables wait, saved bookkeeping
        hw: null, hwL: null, hwR: null, hwN: 0, hwT: 0, hwOn: 0, hwWait: 0, hwFs: 0,
        hwRec: null, hwLP: -1, hwMem: new Float64Array(N_OSC), hwSub: 0, hwAlt: 0, hwRng: 0, hwVc: 0, hwRR: null, hwRRok: 0, hwMs: null,
        // the Granular lazy warm-up (GRAN_JOB): hidden voice, scratch, step, chunks left, asset wait, patch and rate it
        // runs on, bookkeeping saved, a complete run done
        gw: null, gwL: null, gwR: null, gwSt: 0, gwN: 0, gwWait: 0, gwCp: null, gwFs: 0, gwSaved: 0, gwOk: 0, gwRt: 0,
        hwSt: 0,                                              // hidden-voice start step (1 apply, 2 note-on, 3 rendering)
        // fields the type scripts own (SxGran, SxSpec, SxSample: created there when absent), declared here so the first
        // Granular / Spectral / Multisample note does not change the map of sx (V8: code depending on it deoptimised)
        granLast: null, granStarve: 0, granQ: null, specPool: null, msRR: null,
        // IMPL-2b §4: ModCore's offsets for this Serum's own FX (the Track sets mcFx / mcHi per span while rows exist; fxMods
        // then returns fxSum = SxMod's vector + mcFx — without rows SxMod's vector itself, byte for byte)
        mcFx: null, mcHi: 0, fxSum: new Float64Array(MAXFX),
      };
      proc.sx = sx;
      initSx(sx, proc);
      // modulation (SxMod, script 4 of the §0.3 list; it needs SxBase): resolved here once per processor
      const M = globalThis.SxMod;
      if (M && M.attach(sx, proc)) { sx.M = M; sx.g = sx.mod.g; }   // sx.g: the global source table (§11.6), SxMod's
      else {
        sx.mod = null;
        if (!warnedMod) { warnedMod = true; if (typeof console !== 'undefined') console.warn('serum-dsp: SxMod unavailable, Serum voices are silent'); }
      }
      return sx;
    }
    // the attach state (also restored by reset; sx.mon, the host's monitor subscription, and the CT store are kept)
    function initSx(sx, proc) {
      sx.span = 0; sx.nCh = 0; sx.ok = 0;
      sx.cp = null; sx.bT.fill(0); sx.s1 = 0; sx.use = 0; sx.outMask = 1;
      sx.wt[0] = ''; sx.wt[1] = ''; sx.wt[2] = ''; sx.noiseId = ''; sx.noiseColor = -1;
      sx.oType.fill(0); sx.phMem.fill(0); sx.phLeg.fill(0); sx.smoothWT.fill(0); sx.pMode.fill(0); sx.pSrc.fill(-1);
      sx.bendTrack.fill(1); sx.uniMode.fill(0); sx.uniRange.fill(0); sx.fmType.fill(0); sx.memSet.fill(0);
      sx.xyOn.fill(0); sx.xyY.fill(0); sx.xyMode.fill(0);
      sx.mapLo.fill(0); sx.mapHi.fill(127); sx.mapVLo.fill(1); sx.mapVHi.fill(127); sx.mapFold.fill(0); sx.mapWarp.fill(0);
      sx.mapFull.fill(1);
      sx.route.fill(1); sx.envOn.fill(1); sx.fKey.fill(0); sx.fClean.fill(0); sx.pz.fill(0); sx.srcU.fill(0);
      sx.subContig = 0; sx.noiseOneshot = 0; sx.noiseKey = 0;
      sx.tuned = 0; for (let k = 0; k < 128; k++) sx.tune[k] = k;
      sx.sclN = 0; sx.sclPer = 0; sx.sclSteps.fill(0); sx.mpeOn = 0; sx.mpeBend = 48; sx.vcOn = 0; sx.vcSel.fill(1); sx.uniMax = 16;
      sx.cMono = 0; sx.cLegato = 0; sx.cPoly = 8; sx.a4 = 440; sx.steal = 0; sx.anyDir = 0; sx.anyBus = 0;
      sx.remap = DEF_REMAP;
      sx.tap.fill(0); sx.tapW = 0; sx.tap2.fill(0); sx.tapW2 = 0;
      sx.memPh.fill(0); sx.subPh = 0; sx.alt = 0; sx.seed = (SEED ^ (proc.seedSalt | 0)) >>> 0; sx.rng = sx.seed;
      sx.grains = 0; sx.pk.fill(0);
      if (sx.msRR) sx.msRR.fill(0);                           // multisample round robins (SxSample's counters in sx, §6.8)
      sx.hw = null; sx.hwL = null; sx.hwR = null; sx.hwN = 0; sx.hwOn = 0; sx.hwWait = 0; sx.hwSt = 0;   // a reset ends the warm-ups
      sx.gw = null; sx.gwL = null; sx.gwR = null; sx.gwSt = 0; sx.gwN = 0; sx.gwCp = null; sx.gwSaved = 0; sx.gwRt = 0;
      const s = sx.snap;
      s.eff.fill(0); s.lfoPh.fill(0); s.lfoOut.fill(0); s.lfoY.fill(0); s.env.fill(0); s.envStage.fill(0); s.envT.fill(0);
      s.wtPos.fill(0); s.noisePos = 0; s.notes = 0; s.oscVoices = 0; s.maxVoices = 0; s.memNow.fill(0); s.filtTap.fill(0);
      s.tapRate = 0; s.smpPos.fill(0); s.grains.fill(0); s.specCap = 0; s.mix.fill(-120); s.mOut.fill(0); s.zone.fill(-1);
      s.seq.fill(0);
      if (sx.M) sx.M.reset(sx, proc);
    }
    // a CP this script understands: same major version (§2.6.5; minor bumps only append)
    function cpOk(cp) { return !!cp && floor(+cp.ver) === VER; }
    // CP field readers: a missing or short field reads as the v1-equivalent default (hand-built CPs of tests and warmUp)
    const u8At = (a, i, d) => (a && a.length > i ? a[i] | 0 : d);
    const fAt = (a, i, d) => { const v = a && a.length > i ? +a[i] : d; return v === v ? v : d; };
    // copy the scalars and tables of a new CP into sx (once per CP object), then the modulation fields (SxMod)
    function syncCP(proc, sx, cp) {
      if (sx.cp === cp) return;
      sx.cp = cp; sx.ok = 1;
      const b = cp.base, bT = sx.bT;
      for (let i = 0; i < NSV; i++) { const v = b && b.length > i ? +b[i] : 0; bT[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
      sx.s1 = cp.s1 ? 1 : 0;
      sx.use = cp.use | 0;
      sx.outMask = cp.outMask !== undefined ? cp.outMask | 0 : 1;
      for (let o = 0; o < N_OSC; o++) {
        sx.wt[o] = cp.wt && typeof cp.wt[o] === 'string' ? cp.wt[o] : '';
        const t = u8At(cp.oType, o, 0);
        sx.oType[o] = t >= 0 && t <= 4 ? t : 0;
        const pm = u8At(cp.phMem, o, 0);
        sx.phMem[o] = pm >= 0 && pm <= 2 ? pm : 0;
        sx.phLeg[o] = u8At(cp.phLeg, o, 0) ? 1 : 0;
        sx.smoothWT[o] = u8At(cp.smoothWT, o, 0) ? 1 : 0;
        const md = u8At(cp.pMode, o, 0);
        sx.pMode[o] = md >= 0 && md <= 3 ? md : 0;
        const ps = cp.pSrc && cp.pSrc.length > o ? cp.pSrc[o] | 0 : -1;
        sx.pSrc[o] = ps >= 0 && ps <= 2 && ps !== o ? ps : -1;
        sx.bendTrack[o] = u8At(cp.bendTrack, o, 1) ? 1 : 0;
        const m = u8At(cp.uniMode, o, 0), R = fAt(cp.uniRange, o, 2);
        sx.uniMode[o] = m >= 0 && m <= 4 ? m : 0;
        sx.uniRange[o] = R > 0 ? (R < 48 ? R : 48) : 0;
        for (let k = 0; k < 2; k++) { const f = u8At(cp.fmType, 2 * o + k, 0); sx.fmType[2 * o + k] = f >= 0 && f <= 2 ? f : 0; }
        // Granular X|Y (§3.9): the Y targets Level, Warp, Warp 2 are applied by the voice (the rest inside SxGran/SxSpec)
        const xy = u8At(cp.xyOn, o, 0) !== 0 && sx.oType[o] === 3, yt = u8At(cp.xyY, o, 0), ym = u8At(cp.xyMode, o, 0);
        sx.xyOn[o] = xy && yt >= 1 && yt <= 3 ? 1 : 0; sx.xyY[o] = yt; sx.xyMode[o] = ym >= 0 && ym <= 2 ? ym : 0;
      }
      for (let i = 0; i < 16 * N_OSC; i++) { const v = fAt(cp.memSet, i, 0); sx.memSet[i] = v > 0 ? v - floor(v) : 0; }
      sx.noiseId = typeof cp.noiseId === 'string' ? cp.noiseId : '';
      const nc = cp.noiseColor !== undefined ? cp.noiseColor | 0 : -1;
      sx.noiseColor = nc >= 0 && nc <= 3 ? nc : -1;
      sx.noiseOneshot = cp.noiseOneshot ? 1 : 0; sx.noiseKey = cp.noiseKey ? 1 : 0; sx.subContig = cp.subContig ? 1 : 0;
      // keyboard mapping (channels A, B, C, Noise, Sub, ARP); full-range channels always play (§6.2)
      for (let c = 0; c < 6; c++) {
        const lo = u8At(cp.mapLo, c, 0), hi = u8At(cp.mapHi, c, 127), vl = u8At(cp.mapVLo, c, 1), vh = u8At(cp.mapVHi, c, 127);
        sx.mapLo[c] = lo; sx.mapHi[c] = hi; sx.mapVLo[c] = vl; sx.mapVHi[c] = vh;
        sx.mapFold[c] = u8At(cp.mapFold, c, 0) ? 1 : 0; sx.mapWarp[c] = u8At(cp.mapWarp, c, 0) ? 1 : 0;
        sx.mapFull[c] = lo <= 0 && hi >= 127 && vl <= 1 && vh >= 127 ? 1 : 0;
      }
      // routes (CP.route: A, B, C, Noise, Sub, F1, F2; 0 Filter · 1 Main · 2 Direct · 3 None) and ENV toggles; without a
      // route field the Phase-1 routing (sources into Filter 1, Filter 1 to Main)
      for (let k = 0; k < 7; k++) {
        const r = u8At(cp.route, k, k < 5 ? 0 : 1);
        sx.route[k] = r >= 0 && r <= 3 ? r : 1;
        sx.envOn[k] = u8At(cp.envOn, k, 1) ? 1 : 0;
      }
      if (sx.route[5] === 0 && sx.route[6] === 0) sx.route[6] = 1;   // both filters into each other: F2 → Main (§1)
      sx.anyDir = 0;
      for (let k = 0; k < 7; k++) if (sx.route[k] === 2) sx.anyDir = 1;
      // bus sends (CP.use & 64, or a send base > 0 in a hand-built CP)
      sx.anyBus = (sx.use & 64) !== 0 ? 1 : 0;
      for (let c = 0; c < 7 && sx.anyBus === 0; c++) if (bT[BUS1V[c]] > 0 || bT[BUS1V[c] + 1] > 0) sx.anyBus = 1;
      for (let k = 0; k < 2; k++) { sx.fKey[k] = u8At(cp.fKey, k, 0) ? 1 : 0; sx.fClean[k] = u8At(cp.fClean, k, 0) ? 1 : 0; }
      for (let j = 0; j < 24; j++) sx.pz[j] = fAt(cp.pz, j, PZ_DEF[j % 12]);
      // tuning (§6.18), Step mode scale (§6.3.3), MPE (§6.17), Voice Control channel selection (§6.2), quality caps (§14.3)
      sx.tuned = (sx.use & 512) !== 0 && cp.tune && cp.tune.length >= 128 ? 1 : 0;
      for (let k = 0; k < 128; k++) sx.tune[k] = sx.tuned ? +cp.tune[k] : k;
      const sn = cp.sclN | 0;
      sx.sclN = sn > 0 && sn <= 128 && cp.sclSteps && cp.sclSteps.length >= sn ? sn : 0;
      sx.sclPer = +cp.sclPer || 0;
      for (let k = 0; k < 128; k++) sx.sclSteps[k] = fAt(cp.sclSteps, k, 0);
      sx.mpeOn = (sx.use & 256) !== 0 && cp.mpeOn ? 1 : 0;
      sx.mpeBend = cp.mpeBend > 0 ? +cp.mpeBend : 48;
      sx.vcOn = (sx.use & 1024) !== 0 ? 1 : 0;
      for (let c = 0; c < 5; c++) sx.vcSel[c] = u8At(cp.vcSel, c, 1) ? 1 : 0;
      const um = cp.qr && cp.qr.length >= 1 ? round(+cp.qr[0]) : 16;
      sx.uniMax = um >= 1 && um <= 16 ? um : 16;
      sx.cMono = cp.mono ? 1 : 0; sx.cLegato = cp.legato ? 1 : 0; sx.cPoly = cp.poly > 0 ? cp.poly | 0 : 8;
      sx.a4 = cp.a4 > 0 ? +cp.a4 : 440;
      // the sources the rows read (source and aux of rows 0 … mN − 1): which audio taps the voices write (§5.3) — derived
      // from the CP here (SxMod's own copy is private to it, §11.6)
      const su = sx.srcU;
      su.fill(0);
      let mN = cp.mN | 0;
      mN = mN > 0 ? (mN < NROW ? mN : NROW) : 0;
      for (let r = 0; r < mN; r++) {
        const si = cp.mSrc && cp.mSrc.length > r ? cp.mSrc[r] | 0 : 0, ai = cp.mAux && cp.mAux.length > r ? cp.mAux[r] | 0 : 0;
        if (si > 0 && si < NSRC2) su[si] = 1;
        if (ai > 0 && ai < NSRC2) su[ai] = 1;
      }
      const st = cp.steal | 0;
      sx.steal = st >= 0 && st <= 4 ? st : 0;
      sx.M.sync(proc, sx, cp);
    }
    const PZ_DEF = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1]);
    // the CT of proc.ct: CT v2 parts (merged into sx.CT), a full CT object, or the built-in defaults. A full CT is handed
    // to SxMod as it is; its spectral filter curves (read by SxSpec from sx.CT.specFilt) are copied into the merged store
    // once per object (flat 1 without them), and the part keys are cleared so that a later parts CT merges again
    const SPEC_ALL = N_OSC * (SPEC_FILT_N + 1);
    function syncCT(proc, sx) {
      const M = sx.M, pc = proc.ct;
      let ct = null;
      if (pc !== null && typeof pc === 'object' && pc.parts) {
        if (pc !== sx.ctIn) { sx.ctIn = pc; mergeCT(proc, pc); }
        sx.ctFull = null;
        ct = sx.CT;
      } else if (pc && pc.lfoTab && pc.lfoPtsOff && pc.lfoPts && pc.remap && pc.veloTab && pc.noteTab) {
        ct = pc;
        if (pc !== sx.ctFull) {
          sx.ctFull = pc; sx.ctIn = null;
          const sf = pc.specFilt;
          if (isTA(sf, 'Float32Array', SPEC_ALL)) sx.CT.specFilt.set(sf); else sx.CT.specFilt.fill(1);
          for (let o = 0; o < N_OSC; o++) sx.ctK.spec[o] = '';
          sx.ctGen++;
        }
      }
      sx.remap = ct !== null && ct.remap ? ct.remap : DEF_REMAP;
      M.syncCT(proc, sx, ct !== null ? ct : M.DEF_CT, sx.ctGen);
    }
    // begin without the span count: CP/CT sync, then the modulation span (SxMod.begin, §5.5 order)
    function core(proc, sx, N) {
      const CH = proc.CH | 0;
      let nCh = CH > 0 ? (N / CH) | 0 : 1;
      nCh = nCh > 1 ? (nCh < MAXCH ? nCh : MAXCH) : 1;
      sx.nCh = nCh;
      const p = proc.p, cp = p && p.serum, M = sx.M;
      if (M === null || !cpOk(cp)) { sx.ok = 0; return; }
      syncCP(proc, sx, cp);
      syncCT(proc, sx);
      M.begin(proc, sx, nCh);
    }
    function begin(proc, N) {
      const sx = proc.sx || attach(proc);
      sx.span++;
      core(proc, sx, N);
    }
    function idle(proc, n) {
      const sx = attach(proc), OS = proc.OS > 0 ? proc.OS | 0 : 1;
      let rem = n > 0 ? n | 0 : 0;
      while (rem >= 4) {
        const nb = rem > 128 ? 128 : rem - (rem & 3);
        core(proc, sx, nb * OS);
        rem -= nb;
      }
    }
    function transport(proc, playing) {
      const sx = attach(proc);
      if (!playing) return;
      if (sx.M !== null) sx.M.transport(proc, sx, playing);
      sx.alt = 0; sx.rng = sx.seed;
      // bookkeeping a fresh (offline) processor does not have: Mem phases, the contiguous sub phase, the multisample
      // round-robin counters SxSample keeps in sx (§6.8, §7.8; the rest — vcN, recent, … — is SxMod's)
      sx.memPh.fill(0); sx.subPh = 0;
      if (sx.msRR) sx.msRR.fill(0);
    }
    function reset(proc) {
      const sx = proc.sx;
      if (!sx) return;
      initSx(sx, proc);
    }
    const FX0 = new Float64Array(MAXFX);                      // FX offsets without SxMod (all 0)
    function fxMods(proc) {
      const sx = proc.sx || attach(proc);
      const o = sx.M !== null ? sx.M.fxMods(proc, sx) : FX0, x = sx.mcFx;
      if (x === null) return o;
      const s = sx.fxSum, hi = sx.mcHi;                       // (IMPL-2b §4: + ModCore's rows on this Serum's own FX)
      s.set(o);
      for (let k = 0; k < hi; k++) s[k] += x[k];
      return s;
    }
    // IMPL-2b §3.2: the Track's ext hand-off, once per span before begin — the 16 ext rows of g (ext k, chunk c at
    // ext[k·32 + c]); begin's step (4) copies their last chunk into monoSrc as it does the G sources (the mono context one
    // span behind, fxMods this span: exactly a processor LFO's timing, N2); extOff clears them (the rows left)
    function extIn(proc, ext, nCh) {
      const sx = proc.sx, m = sx !== null ? sx.mod : null;
      if (m === null) return;
      m.g.set(ext, S_EXT0 * MAXCH);
    }
    function extOff(proc) {
      const sx = proc.sx, m = sx !== null ? sx.mod : null;
      if (m === null) return;
      m.g.fill(0, S_EXT0 * MAXCH); m.monoSrc.fill(0, S_EXT0);
    }
    // the CP / CT sync without a span (ModCore's shim after a new synthetic CP: a note-on may come before its first span)
    function sync(proc) {
      const sx = attach(proc), p = proc.p, cp = p && p.serum;
      if (sx.M === null || !cpOk(cp)) { sx.ok = 0; return false; }
      syncCP(proc, sx, cp);
      syncCT(proc, sx);
      return true;
    }
    // the pitch (MIDI float, gliding, tuned) of the most recent voice, else the last one played, else 60 (FX key tracking,
    // §12.5)
    function recentPitch(proc) {
      const sx = proc.sx, m = sx ? sx.mod : null;
      if (!m) return 60;
      const v = m.recent;
      if (v !== null && v.mod !== null) return v.mod.nP;
      return m.lastPitch >= 0 ? m.lastPitch : 60;
    }
    // Voice allocation helper for the engine (§12.3): the voice for note n among voices[0 … nUse−1] — same (n, ch) reuse
    // when oneNote, else (1) inactive, (2) not gated, (3) sustain-held (lowest stamp each), (4) gated by CP.steal: Newest →
    // lowest stamp · Oldest → highest stamp · Highest → lowest note · Lowest → highest note · Velocity → lowest velocity
    // (ties: lowest stamp). Pure selection (no state change); null without voices.
    function allocate(proc, n, ch = 0, nUse = -1) {
      const vs = proc.voices;
      if (!vs || !vs.length) return null;
      const sx = proc.sx || attach(proc), cp = sx.cp || (proc.p && proc.p.serum) || null;
      // a key the tuning's .kbm leaves unmapped (CP.tune[n] NaN, use & 512) gets no voice: the note-on is ignored (§6.18)
      if (cp && (cp.use & 512) !== 0 && cp.tune && cp.tune.length >= 128) {
        const k = n | 0, t = k >= 0 && k <= 127 ? +cp.tune[k] : 0;
        if (t !== t) return null;
      }
      let U = nUse >= 1 ? nUse | 0 : vs.length;
      if (U > vs.length) U = vs.length;
      if (cp && cp.oneNote) {
        for (let i = 0; i < U; i++) { const x = vs[i]; if (x.active && x.note === n && (x.ch | 0) === (ch | 0)) return x; }
      }
      let best = null;
      for (let i = 0; i < U; i++) { const x = vs[i]; if (!x.active && (!best || x.stamp < best.stamp)) best = x; }
      if (best) return best;
      for (let i = 0; i < U; i++) { const x = vs[i]; if (!x.gate && (!best || x.stamp < best.stamp)) best = x; }
      if (best) return best;
      for (let i = 0; i < U; i++) { const x = vs[i]; if (x.sus && (!best || x.stamp < best.stamp)) best = x; }
      if (best) return best;
      const st = cp ? cp.steal | 0 : 0;
      for (let i = 0; i < U; i++) {
        const x = vs[i];
        if (!best) { best = x; continue; }
        let d;
        if (st === 1) d = x.stamp - best.stamp;                 // Oldest: steal the newest (highest stamp)
        else if (st === 2) d = best.note - x.note;              // Highest: steal the lowest note
        else if (st === 3) d = x.note - best.note;              // Lowest: steal the highest note
        else if (st === 4) d = best.vel - x.vel;                // Velocity: steal the lowest velocity
        else d = best.stamp - x.stamp;                          // Newest: steal the oldest (lowest stamp)
        if (d > 0 || (d === 0 && x.stamp < best.stamp)) best = x;
      }
      return best;
    }
    function snapshot(proc) {
      const sx = proc.sx;
      if (!sx) return null;
      const s = sx.snap, m = sx.mod, v = m ? m.recent : null;
      if (m) sx.M.snap(proc, sx, s);
      if (v) {
        for (let o = 0; o < N_OSC; o++) {
          s.wtPos[o] = v.wPos[o];
          const N = v.uN[o], p0 = v.uPh[o * 16];
          for (let i = 0; i < 16; i++) {
            let d = i < N ? v.uPh[o * 16 + i] - p0 : 0;
            d -= floor(d);
            s.memNow[o * 16 + i] = d;
          }
          const x = v.ox[o];
          if (x !== null && x.sel === 1) {
            s.smpPos[4 * o] = +x.mPos || 0; s.smpPos[4 * o + 1] = +x.mS || 0; s.smpPos[4 * o + 2] = +x.mLS || 0;
            s.smpPos[4 * o + 3] = +x.mLE || 0;
            s.zone[o] = x.zone !== undefined ? x.zone | 0 : -1;
          } else { s.smpPos.fill(0, 4 * o, 4 * o + 4); s.zone[o] = -1; }
        }
        s.noisePos = v.nLen0 > 0 ? v.nPos / v.nLen0 : 0;
      } else {
        s.wtPos.fill(0); s.noisePos = 0; s.memNow.fill(0); s.smpPos.fill(0); s.zone.fill(-1);
      }
      let notes = 0, osc = 0;
      s.grains.fill(0);
      const vs = proc.voices;
      if (vs) {
        for (let k = 0; k < vs.length; k++) {
          const w = vs[k];
          if (!w) continue;
          if (w.gate) notes++;
          if (w.active && w.uN) {
            osc += (w.onA ? w.uN[0] : 0) + (w.onB ? w.uN[1] : 0) + (w.onC ? w.uN[2] : 0) + w.onS + w.onN;
            if (w.ox) for (let o = 0; o < N_OSC; o++) { const x = w.ox[o]; if (x !== null) { const g = x.grains() | 0; s.grains[o] += g; osc += g; } }
          }
        }
      }
      s.notes = notes; s.oscVoices = osc;
      const bT = sx.bT;
      s.maxVoices = sx.ok ? (sx.cMono ? 1 : sx.cPoly) * (16 * (bT[A_ON] >= 0.5 ? 1 : 0) + 16 * (bT[A_ON + 1] >= 0.5 ? 1 : 0) +
        ((sx.use & 1) && bT[C_ON] >= 0.5 ? 16 : 0) + (bT[S_ON] >= 0.5 ? 1 : 0) + (bT[N_ON] >= 0.5 ? 1 : 0)) : 0;
      for (let j = 0; j < TAP_N; j++) {
        s.filtTap[j] = sx.tap[(sx.tapW + j) & (TAP_N - 1)];
        s.filtTap[TAP_N + j] = sx.tap2[(sx.tapW2 + j) & (TAP_N - 1)];
      }
      s.tapRate = +proc.fs || 0;
      const SP = globalThis.SxSpec;
      s.specCap = SP && typeof SP.capOf === 'function' ? (SP.capOf(sx) ? 1 : 0) : 0;
      // channel peaks of the last span(s) in dBFS (A, B, C, N, S, F1, F2; the rack adds Bus 1/2, Main, Direct)
      for (let c = 0; c < 7; c++) { const p = sx.pk[c]; s.mix[c] = p > 1e-6 ? 20 * Math.log10(p) : -120; sx.pk[c] = 0; }
      const sq = proc.sxSeq;
      if (sq && typeof sq.snapshot === 'function') sq.snapshot(s.seq);
      return s;
    }

    /* ------------------------------------------------------------ module scratch (one chunk, ≤ 32 samples) */
    const AL = new Float64Array(MAXCH), AR = new Float64Array(MAXCH), BL = new Float64Array(MAXCH), BR = new Float64Array(MAXCH);
    const CL = new Float64Array(MAXCH), CR = new Float64Array(MAXCH);
    const NL = new Float64Array(MAXCH), NR = new Float64Array(MAXCH), SL = new Float64Array(MAXCH), SR = new Float64Array(MAXCH);
    const NRAW = new Float64Array(MAXCH), SRAW = new Float64Array(MAXCH), ZERO = new Float64Array(16 * MAXCH);
    const RAW0 = new Float64Array(16 * MAXCH), RAW1 = new Float64Array(16 * MAXCH), RAW2 = new Float64Array(16 * MAXCH);
    // sample-major copies of the raw unison outputs ([s·N + i]) for the SxWarp kernels (§11.7 modulator layout)
    const MT0 = new Float64Array(16 * MAXCH), MT1 = new Float64Array(16 * MAXCH), MT2 = new Float64Array(16 * MAXCH);
    const PHB = new Float64Array(MAXCH), WIN = new Float64Array(MAXCH), YB = new Float64Array(MAXCH), YB2 = new Float64Array(MAXCH);
    // WARPS2 path: increments, unwarped phases, the Odd/Even phases and read, the Sync window; per-unison-voice amounts,
    // frequencies
    const INC = new Float64Array(MAXCH), PHU = new Float64Array(MAXCH), PHC = new Float64Array(MAXCH), X2B = new Float64Array(MAXCH);
    const X2C = new Float64Array(MAXCH), WN = new Float64Array(MAXCH);
    const WA1 = new Float64Array(16), WA2 = new Float64Array(16), FI = new Float64Array(16);
    // mixer: filter inputs u_k and source sums (bypass v_k = S_k − u_k), wet signals, filter outputs (post mix, pre level)
    const U1L = new Float64Array(MAXCH), U1R = new Float64Array(MAXCH), S1L = new Float64Array(MAXCH), S1R = new Float64Array(MAXCH);
    const U2L = new Float64Array(MAXCH), U2R = new Float64Array(MAXCH), S2L = new Float64Array(MAXCH), S2R = new Float64Array(MAXCH);
    const W1L = new Float64Array(MAXCH), W1R = new Float64Array(MAXCH), W2L = new Float64Array(MAXCH), W2R = new Float64Array(MAXCH);
    const Y1L = new Float64Array(MAXCH), Y1R = new Float64Array(MAXCH), Y2L = new Float64Array(MAXCH), Y2R = new Float64Array(MAXCH);
    // output groups: main, direct, bus 1, bus 2 × (ENV 1 on, ENV 1 off) — [L, R] pairs at 2·g, 2·g + 1
    const GB = [];
    for (let g = 0; g < 16; g++) GB.push(new Float64Array(MAXCH));
    const GU = new Uint8Array(8);
    const XLS = [AL, BL, CL, NL, SL], XRS = [AR, BR, CR, NR, SR], RAWS = [RAW0, RAW1, RAW2], MTS = [MT0, MT1, MT2];
    const CHX = Int32Array.from([0, 1, 3, 4, 2]);             // u/v summation order: A, B, Noise, Sub, C (§6.12)
    const DIRX = Int32Array.from([4, 3, 0, 1, 2]);            // Direct summation order: Sub, Noise, A, B, C (§6.12)
    const MAXPH = 1 - pow(2, -24);
    const FC_L2 = mlog2(22050 / MIDI0);
    // colour noise calibration (§6.11.2): −12 dBFS RMS from uniform white in [−1, 1) (analytic variances). White is
    // generated at the voice rate fs = OS·base and the engine's decimator keeps only the band ≤ base/2, so its audio
    // outputs get × √OS: −12 dBFS RMS in the audible band at every Quality; its raw samples (NRAW, the `noise` source)
    // stay at K_WHITE, independent of the Quality (pink and brown hold most of their power far below base/2: within
    // 1 dB at OS 1/2/4 without a correction; brown's integrator is rate-independent)
    const K_WHITE = 0.4350714922217474, K_PINK = 0.11 * 1.2957116107223994, K_BROWN = 3.5 * 0.1898038343596395;
    const K_GEIGER = pow(10, -12 / 20);                       // Geiger: −12 dBFS RMS at 40 clicks/s (per-rate gain kG)
    // colour-noise stream seeds (§6.11.2): two r2 draws, each through its own murmur3 finaliser salt, so streams a and b
    // (and the voice's later r2 draws) are unrelated points of the xorshift cycle — consecutive xorshift states would
    // make b[k] = a[k + 1] (STEREO without effect)
    function fmix32(h) {
      h ^= h >>> 16; h = imul(h, 0x85EBCA6B); h ^= h >>> 13; h = imul(h, 0xC2B2AE35); h ^= h >>> 16;
      return h >>> 0;
    }
    // pitch modes (§3.3)
    const PM_HARM = 1, PM_RATIO = 2, PM_STEP = 3;
    // X|Y modulation of a target's eff n by y (§3.9 XY_MODES: 0 Add n + 2y − 1, 1 Replace y, 2 Scale n·y; clamped)
    function xyApply(mode, n, y) {
      const v = mode === 1 ? y : mode === 2 ? n * y : n + 2 * y - 1;
      return v > 0 ? (v < 1 ? v : 1) : 0;
    }
    // keyboard fold (§6.2): n shifted by octaves into [lo, hi]; no octave fits ⇒ the bound nearer to the octave
    // transposes of n on either side of the range (IMPL reading of "the nearer bound"; ties: the bound n is beyond)
    function foldInto(n, lo, hi) {
      if (n >= lo && n <= hi) return n;
      // fewest octaves toward the range; when that transpose overshoots, a = the transpose above hi, b = the one below lo
      let a, b;
      if (n < lo) { a = n + 12 * ceil((lo - n) / 12); if (a <= hi) return a; b = a - 12; }
      else { b = n - 12 * ceil((n - hi) / 12); if (b >= lo) return b; a = b + 12; }
      const dA = a - hi, dB = lo - b;
      return dA < dB || (dA === dB && n > hi) ? hi : lo;
    }
    // Step pitch mode (§6.3.3): degree d → semitones
    function sclSemis(sx, d) {
      const n = sx.sclN, q = floor(d / n), r = d - q * n;
      return q * sx.sclPer + sx.sclSteps[r];
    }
    // source x (scaled by g unless g = 1) through a linear switch ramp r0 → r0 + n·dr into u, and into the source sum S
    // (§6.12: u_k += s_k·G_k·x; the bypass is v_k = S_k − u_k, the Phase-1 arithmetic form)
    // (M4) a switch that is off and stays off this chunk (r0 = dr = 0) adds 0·x to u: u is never −0 (it starts at +0 and a
    // sum that cancels is +0), so u + (±0) = u — only the source sum is updated
    function addSrc(XL, XR, g, r0, dr, UL, UR, SLs, SRs, CH) {
      let r = r0;
      if (r0 === 0 && dr === 0) {
        if (g === 1) for (let s = 0; s < CH; s++) { SLs[s] += XL[s]; SRs[s] += XR[s]; }
        else for (let s = 0; s < CH; s++) { SLs[s] += g * XL[s]; SRs[s] += g * XR[s]; }
        return;
      }
      if (g === 1) {
        for (let s = 0; s < CH; s++) { r += dr; const xl = XL[s], xr = XR[s]; UL[s] += r * xl; UR[s] += r * xr; SLs[s] += xl; SRs[s] += xr; }
      } else {
        for (let s = 0; s < CH; s++) { r += dr; const xl = g * XL[s], xr = g * XR[s]; UL[s] += r * xl; UR[s] += r * xr; SLs[s] += xl; SRs[s] += xr; }
      }
    }
    // addSrc with the share g ramped per sample from g0 by dg (filter balance, filter-to-filter level); dg = 0 is addSrc
    function addSrcR(XL, XR, g0, dg, r0, dr, UL, UR, SLs, SRs, CH) {
      if (dg === 0) { addSrc(XL, XR, g0, r0, dr, UL, UR, SLs, SRs, CH); return; }
      let r = r0, g = g0;
      for (let s = 0; s < CH; s++) { r += dr; g += dg; const xl = g * XL[s], xr = g * XR[s]; UL[s] += r * xl; UR[s] += r * xr; SLs[s] += xl; SRs[s] += xr; }
    }
    // addG with the gain ramped per sample from g0 by d (the Phase-1 ramp form: the last sample reaches g0 + CH·d); d = 0
    // is addG with g0
    function addGR(DL, DR, XL, XR, g0, d, first, CH) {
      if (d === 0) { addG(DL, DR, XL, XR, g0, first, CH); return; }
      let g = g0;
      if (first) for (let s = 0; s < CH; s++) { g += d; DL[s] = g * XL[s]; DR[s] = g * XR[s]; }
      else for (let s = 0; s < CH; s++) { g += d; DL[s] += g * XL[s]; DR[s] += g * XR[s]; }
    }
    // dst (+)= g·src (first: assignment)
    function addG(DL, DR, XL, XR, g, first, CH) {
      if (first) {
        if (g === 1) for (let s = 0; s < CH; s++) { DL[s] = XL[s]; DR[s] = XR[s]; }
        else for (let s = 0; s < CH; s++) { DL[s] = g * XL[s]; DR[s] = g * XR[s]; }
      } else if (g === 1) for (let s = 0; s < CH; s++) { DL[s] += XL[s]; DR[s] += XR[s]; }
      else for (let s = 0; s < CH; s++) { DL[s] += g * XL[s]; DR[s] += g * XR[s]; }
    }
    function zero4(a, b, c, d, CH) { for (let s = 0; s < CH; s++) { a[s] = 0; b[s] = 0; c[s] = 0; d[s] = 0; } }
    // out[o0 + s] += x[s]·amp_s with the linear gain ramp amp0 → amp0 + CH·d (the Phase-1 per-sample ramp)
    function addAmp(OL, OR, o0, XL, XR, amp0, d, CH) {
      let a = amp0;
      for (let s = 0; s < CH; s++) { a += d; OL[o0 + s] += XL[s] * a; OR[o0 + s] += XR[s] * a; }
    }
    function peak2(XL, XR, CH) {
      let p = 0;
      for (let s = 0; s < CH; s++) { const a = XL[s] < 0 ? -XL[s] : XL[s], b = XR[s] < 0 ? -XR[s] : XR[s]; if (a > p) p = a; if (b > p) p = b; }
      return p;
    }

    /* ------------------------------------------------------------ warps (§3.3) */
    // warped read phase of mode m (≠ 0, 2/3 use the sync phase, 11/19/20 return φ) for parameter K, amount w,
    // remap table R at rb and modulator sample mv
    function warpPh(m, ph, K, w, R, rb, mv) {
      switch (m) {
        case 1: case 2: case 3: { const x = ph * K; return x - floor(x); }
        case 4: case 5: case 6:
          if (ph < 0.5) return 0.5 * powU(2 * ph, K);
          return 1 - 0.5 * powU(2 - 2 * ph, K);
        case 7: { const v = ph * K; return v < MAXPH ? v : MAXPH; }
        case 8: case 9: case 10: return powU(ph, K);
        case 12: return powU(ph < 0.5 ? 2 * ph : 2 - 2 * ph, K);
        case 13: return ph + w * (remapG(R, rb, ph) - ph);
        case 14: {
          const q = ph < 0.5 ? 0.5 * remapG(R, rb, 2 * ph) : 1 - 0.5 * remapG(R, rb, 2 - 2 * ph);
          return ph + w * (q - ph);
        }
        case 15: { const x = ph - K * sin1(ph); return x - floor(x); }
        case 16: {
          const x4 = 4 * ph, s = floor(x4), u = x4 - s;
          const up = (s & 1) ? 1 - remapG(R, rb, 1 - u) : remapG(R, rb, u);
          return ph + w * ((s + up) * 0.25 - ph);
        }
        case 17: return floor(ph * K) / K;
        case 18: case 21: case 22: { const x = ph + K * mv; return x - floor(x); }
        default: return ph;
      }
    }
    function remapG(R, rb, p) {
      const x = p * 2048;
      let i = x | 0;
      if (i > 2047) i = 2047; else if (i < 0) i = 0;
      const a = R[rb + i];
      return a + (x - i) * (R[rb + i + 1] - a);
    }
    // output factor of modes 2, 3, 11, 19, 20 (unwarped phase ph)
    function winF(m, ph, w, mv) {
      if (m === 2) { if (ph < 0.25 || ph > 0.75) { const s = sin1(ph); return s * s; } return 1; }
      if (m === 3) return 0.5 - 0.5 * sin1(ph + 0.25);
      if (m === 11) return ph < w ? 1 : -1;
      if (m === 19) return 1 - w + w * (0.5 + 0.5 * mv);
      return 1 - w + w * mv;
    }
    // K and speed for mode m at amount w; returns the effective mode (0 when the setting is neutral, §3.3)
    let wK = 0, wSp = 1;
    function warpSetup(m, w, mAvail) {
      wK = 0; wSp = 1;
      switch (m) {
        case 1: case 2: case 3:
          if (m === 1 && w === 0) return 0;
          wK = exp2(4.4 * w); wSp = wK; return m;
        case 4: case 8: if (w === 0) return 0; wK = exp2(2.5 * w); wSp = wK; return m;
        case 5: case 9: if (w === 0) return 0; wK = exp2(-2.5 * w); wSp = 1 / wK; return m;
        case 6: case 10: if (w === 0.5) return 0; wK = exp2(2.5 * (2 * w - 1)); wSp = wK > 1 ? wK : 1 / wK; return m;
        case 7: if (w === 0) return 0; wK = 1 / (1 - 0.995 * w); wSp = wK; return m;
        case 11: return m;
        case 12: wK = exp2(2.5 * (2 * w - 1)); wSp = 2 * (wK > 1 ? wK : 1 / wK); return m;
        case 13: case 14: if (w === 0) return 0; wSp = 2; return m;
        case 15: if (w === 0) return 0; wK = 0.9 * w / (2 * PI); wSp = 1 + 0.9 * w; return m;
        case 16: if (w === 0) return 0; wSp = 4; return m;
        case 17: { if (w < 1e-6) return 0; const M = round(2048 * exp2(-10 * w)); wK = M > 2 ? M : 2; return m; }
        case 18: case 21: if (!mAvail || w === 0) return 0; wK = 3 * w * sqrt(w); wSp = 1 + 6.3 * wK; return m;
        case 22: if (!mAvail || w === 0) return 0; wK = 4 * w * sqrt(w); wSp = 1 + 6.3 * wK; return m;
        case 19: case 20: if (!mAvail || w === 0) return 0; return m;
        default: return 0;
      }
    }
    // phase passes of the power-law warps (same formulas as warpPh, specialised for speed)
    function phBend(ph, inc, K, CH) {
      for (let s = 0; s < CH; s++) {
        PHB[s] = ph < 0.5 ? 0.5 * powU(2 * ph, K) : 1 - 0.5 * powU(2 - 2 * ph, K);
        ph += inc;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      return ph;
    }
    function phAsym(ph, inc, K, CH) {
      for (let s = 0; s < CH; s++) {
        PHB[s] = powU(ph, K);
        ph += inc;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      return ph;
    }
    // first mip level with harm ≤ H, with hysteresis towards more harmonics (§6.5, §7.4)
    // m0 = margin of level 0 (its Hermite images sit just above flim, see the file header)
    function selLevel(cur, H, harm, hb, m0) {
      let l = 0;
      while (l < 10 && harm[hb + l] * (l === 0 ? m0 : 1) > H) l++;
      if (cur < 0 || l >= cur) return l;
      let c = cur;
      while (c > l && H >= 1.05 * harm[hb + c - 1] * (c === 1 ? m0 : 1)) c--;
      return c;
    }
    // §7.4 with the lead's sign-off on deviation 9: where the octave a level switch drops is audible (flim/2 < 20 kHz,
    // i.e. OS 1), the richest alias-safe level ℓ (harm ≤ H) is blended with ℓ + 1 while H < 1.25·harm(ℓ), so the top
    // octave fades out continuously over a third of an octave of pitch instead of switching (both levels stay
    // alias-safe; a narrow band keeps the two-level reads, and so the cost of OS 1, low).
    // Returns ℓ; bLvB = ℓ + 1 (or −1 when ℓ plays alone) with bW = the weight of ℓ.
    let bLvB = -1, bW = 1;
    function selBlend(H, harm, hb) {
      let l = 0;
      while (l < 10 && harm[hb + l] > H) l++;
      bLvB = -1; bW = 1;
      if (l < 10) {
        const h = harm[hb + l], a = (H - h) / (0.25 * h);
        if (a < 1) { if (a > 0) { bLvB = l + 1; bW = a; } else l++; }
      }
      return l;
    }
    // fused plain reads (warp Off / neutral): two frames blended with t ramping by dt per sample (the one-frame read is
    // written out in renderWT)
    const FA = new Float64Array(9);
    function plain2(d, ba, bb, m, len, OL, OR, CH) {        // doubles in FA (see plainB1)
      let ph = FA[0], gl = FA[2], gr = FA[3], t = FA[7];
      const inc = FA[1], dgl = FA[4], dgr = FA[5], dt = FA[8];
      for (let s = 0; s < CH; s++) {
        const x = ph * len, i = x | 0, f = x - i;
        const im = (i - 1) & m, i0 = i & m, i1 = (i + 1) & m, i2 = (i + 2) & m;
        let xm = d[ba + im], x0 = d[ba + i0], x1 = d[ba + i1], x2 = d[ba + i2];
        const ya = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        xm = d[bb + im]; x0 = d[bb + i0]; x1 = d[bb + i1]; x2 = d[bb + i2];
        const yb = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        t += dt;
        const y = ya + t * (yb - ya);
        gl += dgl; gr += dgr;
        OL[s] += gl * y; OR[s] += gr * y;
        ph += inc;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      FA[0] = ph;
    }
    // fused unwarped reads of two levels (selBlend): y = yB + (yA − yB)·w, A = level ℓ (one frame or two frames
    // blended with t ramping by dt), B = level ℓ + 1 at the same phase and frames. These are too large to be inlined:
    // their double arguments travel in FA (a call boxes double arguments) — FA = [ph, inc, gl, gr, dgl, dgr, w, t, dt],
    // the phase comes back in FA[0].
    function plainB1(da, ba, ma, la, db, bb, mb, lb, OL, OR, CH) {
      let ph = FA[0], gl = FA[2], gr = FA[3];
      const inc = FA[1], dgl = FA[4], dgr = FA[5], w = FA[6];
      for (let s = 0; s < CH; s++) {
        let x = ph * la, i = x | 0, f = x - i;
        let xm = da[ba + ((i - 1) & ma)], x0 = da[ba + (i & ma)], x1 = da[ba + ((i + 1) & ma)], x2 = da[ba + ((i + 2) & ma)];
        const ya = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        x = ph * lb; i = x | 0; f = x - i;
        xm = db[bb + ((i - 1) & mb)]; x0 = db[bb + (i & mb)]; x1 = db[bb + ((i + 1) & mb)]; x2 = db[bb + ((i + 2) & mb)];
        const yb = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        const y = yb + (ya - yb) * w;
        gl += dgl; gr += dgr;
        OL[s] += gl * y; OR[s] += gr * y;
        ph += inc;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      FA[0] = ph;
    }
    function plainB2(da, aa, ab, ma, la, db, ba, bb, mb, lb, OL, OR, CH) {
      let ph = FA[0], gl = FA[2], gr = FA[3], t = FA[7];
      const inc = FA[1], dgl = FA[4], dgr = FA[5], w = FA[6], dt = FA[8];
      for (let s = 0; s < CH; s++) {
        t += dt;
        let x = ph * la, i = x | 0, f = x - i, im = (i - 1) & ma, i0 = i & ma, i1 = (i + 1) & ma, i2 = (i + 2) & ma;
        let xm = da[aa + im], x0 = da[aa + i0], x1 = da[aa + i1], x2 = da[aa + i2];
        let ya = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        xm = da[ab + im]; x0 = da[ab + i0]; x1 = da[ab + i1]; x2 = da[ab + i2];
        ya += t * ((((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0 - ya);
        x = ph * lb; i = x | 0; f = x - i; im = (i - 1) & mb; i0 = i & mb; i1 = (i + 1) & mb; i2 = (i + 2) & mb;
        xm = db[ba + im]; x0 = db[ba + i0]; x1 = db[ba + i1]; x2 = db[ba + i2];
        let yb = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        xm = db[bb + im]; x0 = db[bb + i0]; x1 = db[bb + i1]; x2 = db[bb + i2];
        yb += t * ((((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0 - yb);
        const y = yb + (ya - yb) * w;
        gl += dgl; gr += dgr;
        OL[s] += gl * y; OR[s] += gr * y;
        ph += inc;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      FA[0] = ph;
    }
    // read pass of the general path: Y[s] = table at P[s] (two frames blended when two; t, dt in FA[7], FA[8])
    function readPass(d, ba, bb, m, len, two, Y, CH, P) {
      let t = FA[7];
      const dt = FA[8];
      for (let s = 0; s < CH; s++) {
        const x = P[s] * len, i = x | 0, f = x - i;
        let y = hermAt(d, ba, m, i, f);
        if (two) { t += dt; y += t * (hermAt(d, bb, m, i, f) - y); }
        Y[s] = y;
      }
    }
    // one level of the general path (t0, dt in FA[7], FA[8]); xa ≥ 0 (interpolating table whose frame pair changed):
    // the old pair (xa, xa + 1) at xt = FA[6] crossfades into the new one over the chunk
    function readLv(d, len, fa, fb, two, xa, Y, CH, P) {
      const m = len - 1;
      readPass(d, fa * len, fb * len, m, len, two, Y, CH, P);
      if (xa < 0) return;
      const ba = xa * len, bb = ba + len, iC = 1 / CH, xt = FA[6];
      for (let s = 0; s < CH; s++) {
        const x = P[s] * len, i = x | 0, f = x - i;
        let y = hermAt(d, ba, m, i, f);
        if (xt !== 0) y += xt * (hermAt(d, bb, m, i, f) - y);
        Y[s] = y + (Y[s] - y) * ((s + 1) * iC);
      }
    }
    // the general-path read of one unison voice at the phases P (§6.5, §7.4): level ℓ plus the one-chunk level crossfade
    // (lvOld, twoLv) or the selBlend pair (lvX, wX); FA[6…8] = xt, t0, dt; Y2 = scratch
    function readFull(P, Y, Y2, lvD, lvLen, hb, lv, lvOld, twoLv, lvX, wX, fa, fb, two, xa, CH) {
      readLv(lvD[hb + lv], lvLen[hb + lv], fa, fb, two, xa, Y, CH, P);
      if (twoLv) {
        readLv(lvD[hb + lvOld], lvLen[hb + lvOld], fa, fb, two, xa, Y2, CH, P);
        const iC = 1 / CH;
        for (let s = 0; s < CH; s++) { const a = (s + 1) * iC; Y[s] = Y2[s] + (Y[s] - Y2[s]) * a; }
      } else if (lvX >= 0) {
        readLv(lvD[hb + lvX], lvLen[hb + lvX], fa, fb, two, xa, Y2, CH, P);
        for (let s = 0; s < CH; s++) Y[s] = Y2[s] + (Y[s] - Y2[s]) * wX;
      }
    }
    // PD (Self) read of one unison voice: per sample φ_r = frac(P[s] + I·y₁), Y[s] = x(φ_r), y₁ = Y[s]; level ℓ with the
    // partner level l2 (weight w2 of ℓ; w2 < 0: the one-chunk crossfade (s + 1)/CH), frames fa/fb blended by t (FA[7],
    // FA[8]); xa ≥ 0 (interpolating table whose frame pair changed): the old pair (xa, xa + 1) at xt = FA[6] crossfades
    // into the new one over the chunk at every level, as readLv; P[s] ← φ_r (the Odd/Even second read follows it);
    // returns y₁ (the crossfaded read)
    function readSelf(P, Y, y1, I, lvD, lvLen, hb, lv, l2, w2, fa, fb, two, xa, CH) {
      let t = FA[7];
      const dt = FA[8], xt = FA[6], d = lvD[hb + lv], len = lvLen[hb + lv], m = len - 1, ba = fa * len, bb = fb * len, iC = 1 / CH;
      const dd = l2 >= 0 ? lvD[hb + l2] : d, len2 = l2 >= 0 ? lvLen[hb + l2] : len, m2 = len2 - 1, ba2 = fa * len2, bb2 = fb * len2;
      const xo = xa >= 0 ? xa : 0, xb = xo * len, xb2 = xo * len2;
      for (let s = 0; s < CH; s++) {
        let q = P[s] + I * y1;
        q -= floor(q);
        P[s] = q;
        let x = q * len, i = x | 0, f = x - i;
        let y = hermAt(d, ba, m, i, f);
        if (two) { t += dt; y += t * (hermAt(d, bb, m, i, f) - y); }
        const a = (s + 1) * iC;
        if (xa >= 0) {
          let o = hermAt(d, xb, m, i, f);
          if (xt !== 0) o += xt * (hermAt(d, xb + len, m, i, f) - o);
          y = o + (y - o) * a;
        }
        if (l2 >= 0) {
          x = q * len2; i = x | 0; f = x - i;
          let z = hermAt(dd, ba2, m2, i, f);
          if (two) z += t * (hermAt(dd, bb2, m2, i, f) - z);
          if (xa >= 0) {
            let o = hermAt(dd, xb2, m2, i, f);
            if (xt !== 0) o += xt * (hermAt(dd, xb2 + len2, m2, i, f) - o);
            z = o + (z - o) * a;
          }
          y = z + (y - z) * (w2 >= 0 ? w2 : a);
        }
        Y[s] = y; y1 = y;
      }
      return y1;
    }
    // noise sample j of a level (looping inside [ls, le) when lp), 0 outside
    function nzAt(A, j, ls, le, len, lp) {
      if (lp) { if (j >= le) j -= le - ls; else if (j < ls) j += le - ls; }
      return j >= 0 && j < len ? A[j] : 0;
    }
    function nzRead(A, p, ls, le, len, lp) {
      const i = floor(p), f = p - i;
      const xm = nzAt(A, i - 1, ls, le, len, lp), x0 = nzAt(A, i, ls, le, len, lp), x1 = nzAt(A, i + 1, ls, le, len, lp),
        x2 = nzAt(A, i + 2, ls, le, len, lp);
      return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
    }

    /* ------------------------------------------------------------ SerumVoice (§8.4.3, §6; SPEC-serum2 §6, §11.10) */
    let warnedVer = false, warnedWarp = false;
    const warnedType = new Uint8Array(4);                       // per script of TYPE_SCRIPT (sx-sample, sx-gran, sx-spec)
    const TYPE_GLOBAL = ['', 'SxSample', 'SxSample', 'SxGran', 'SxSpec'];
    const TYPE_CLASS = ['', 'MultiOsc', 'SampleOsc', 'GranOsc', 'SpecOsc'];
    const TYPE_SCRIPT = [0, 1, 1, 2, 3];
    // the oscillator context of the common oscillator contract (§11.8), owned and filled per chunk by the voice
    function makeCtx(o) {
      const F = () => new Float64Array(16), B = () => new Float64Array(MAXCH);
      return { o, N: 1, f: F(), gl: F(), gr: F(), dgl: F(), dgr: F(), pan: F(), t: F(), w1: F(), w2: F(),
        mode1: 0, mode2: 0, var1: 0, var2: 0, fm1: 0, fm2: 0, mod1: ZERO, mod2: ZERO, modStride1: 0, modStride2: 0,
        eff: null, cp: null, sx: null, gate: 0, fresh: 0, CH: 8, fs: 96000, base: 48000, bpm: 120, keyRef: 60, rootShift: 0,
        key: 60, vel: 1,                                       // [+] the channel's played key (fold incl.) and velocity
        wbuf: { inc: B(), ph: B(), ph2: B(), win: B(), x: B(), x2: B() } };
    }
    class SerumVoice {
      constructor(proc, i) {
        this.proc = proc; this.i = i | 0;
        // note: a double field from the start (V8): a note number that arrives boxed (a typed-array or double-array read,
        // the sequencer) would otherwise generalise the field at the first real note — a new map for every voice and a
        // deoptimisation of the whole voice path in that quantum (the hidden warm-up notes are small integers)
        this.note = -0.5; this.vel = 0.5;
        this.active = false; this.gate = false; this.note = -1; this.stamp = 0; this.sus = false; this.vel = 0;
        this.ok = 0; this.played = 0;
        this.r = ((0x9E3779B9 * (this.i + 7)) >>> 0) || 1;   // voice PRNG state (xorshift32)
        this.r2 = this.r;                                      // second stream (SPEC-serum2 §6.2): Phase-2 draws only
        const sx = attach(proc);
        this.fs = proc.fs > 0 ? +proc.fs : 96000; this.CH = proc.CH > 0 ? proc.CH | 0 : 8;
        this.base = proc.base > 0 ? +proc.base : 48000;
        this.dt = this.CH / this.fs; this.flim = this.fs - (0.45 * this.base < 20000 ? 0.45 * this.base : 20000);
        this.xf = this.flim < 40000 ? 1 : 0;                 // level blending where the dropped octave is audible (§7.4)
        this.m0 = 1; this.margin();
        this.span = -1; this.fresh = 0; this.spare = 0;
        this.hid = 0;                                          // hidden warm-up voice: 1 first-use (warmTick), 2 GRAN_JOB
        this.gq = null;                                        // GRAN_JOB's light grain caps for the voice's first chunks
        this.filt = new SFilter(this.fs); this.filt2 = null;  // Filter 2: allocated by the first apply with CP.use & 2
        // modulation (SxMod.ModV: envelopes, LFOs, chaos, sources, matrix, portamento); eff, src and eV are its arrays
        this.mod = sx.M !== null ? new sx.M.ModV(this) : null;
        const mv = this.mod;
        this.eff = mv !== null ? mv.eff : new Float64Array(NSV); this.src = mv !== null ? mv.src : new Float64Array(NSRC2);
        this.eV = mv !== null ? mv.eV : new Float64Array(N_ENV);
        // note context: MPE channel, generated-note expression, keyboard gates and fold offsets (A, B, C, Noise, Sub),
        // Voice Control offsets (from the ModV)
        this.ch = 0; this.ex = null; this.kg = new Uint8Array(5).fill(1); this.dk = new Float64Array(5);
        this.vcP = 0; this.vcD = 0; this.vcC = 0;
        // oscillators: [o·16 + i] per unison voice
        this.uN = new Int32Array(N_OSC); this.uNx = new Int32Array(N_OSC); this.uPh = new Float64Array(48);
        this.uHi = Int32Array.from([16, 16, 16]);              // fillCtx: unison slots whose gains may be non-zero (≤ 16)
        this.uLv = new Int32Array(48).fill(-1); this.uFa = new Int32Array(48).fill(-1); this.uFp = new Float64Array(48);
        this.uGL = new Float64Array(48); this.uGR = new Float64Array(48); this.uRnd = new Float64Array(48);
        // (M4) per oscillator: 0 once a scan found every unison gain of it 0 and no render wrote one since (a switched-off
        // oscillator then skips its 16-slot scan every chunk); 1 = may be non-zero
        this.gz = new Uint8Array(3).fill(1);
        this.uRat = new Float64Array(48).fill(1); this.uPL = new Float64Array(48).fill(1); this.uPR = new Float64Array(48).fill(1);
        this.uEl = new Float64Array(48); this.uH = new Float64Array(48).fill(-1); this.uLx = new Int32Array(48).fill(-1);
        this.uWx = new Float64Array(48).fill(1);
        this.oOff = new Float64Array(N_OSC); this.wPos = new Float64Array(N_OSC); this.memK = new Uint8Array(N_OSC);
        this.cDet = new Float64Array(N_OSC).fill(-1); this.cStk = new Int32Array(N_OSC).fill(-1); this.cN = new Int32Array(N_OSC);
        this.cMode = new Int32Array(N_OSC).fill(-1); this.cR = new Float64Array(N_OSC).fill(-1); this.cW = new Float64Array(N_OSC).fill(-1);
        this.cWN = new Int32Array(N_OSC); this.cBl = new Float64Array(N_OSC).fill(-1); this.cBN = new Int32Array(N_OSC);
        this.gC = new Float64Array(N_OSC).fill(1); this.gSd = new Float64Array(N_OSC).fill(1); this.comp = new Float64Array(N_OSC).fill(1);
        this.cPan = new Float64Array(N_OSC).fill(-9); this.bl = new Float64Array(N_OSC).fill(1); this.br = new Float64Array(N_OSC).fill(1);
        this.onA = 0; this.onB = 0; this.onC = 0; this.onS = 0; this.onN = 0;
        // per chunk: pitch terms, base pitch / frequency / Hz offset per oscillator, warp modes, modulators, render order
        this.pBend = 0; this.pTune = 0; this.pMpe = 0; this.pDet = 0; this.pOk = 0;
        this.cP = new Float64Array(N_OSC); this.fB = new Float64Array(N_OSC); this.cHz = new Float64Array(N_OSC);
        this.oOn = new Uint8Array(N_OSC); this.oAv = new Uint8Array(N_OSC); this.oCap = new Uint8Array(N_OSC);
        this.mtx = new Uint8Array(N_OSC); this.dep = new Uint8Array(N_OSC); this.lg = new Uint8Array(N_OSC);
        this.md = new Uint8Array(2 * N_OSC); this.lvar = new Float64Array(N_OSC).fill(-1);
        this.mA = [ZERO, ZERO, ZERO, ZERO, ZERO, ZERO]; this.mS = new Int32Array(2 * N_OSC);
        this.ord = new Int32Array(N_OSC); this.ordN = 0; this.act = new Uint8Array(5); this.fpUse = 0;
        // WARPS2 slots (SxWarp.Slots per oscillator, apply), oscillator type objects (SxSample/SxGran/SxSpec, apply) and
        // their contexts
        this.W = null; this.wsl = [null, null, null];
        this.ox = [null, null, null]; this.oxs = new Array(4 * N_OSC).fill(null); this.ctx = [null, null, null];
        // wavetables
        this.wId = ['', '', '']; this.wEp = new Float64Array(N_OSC).fill(-1); this.wOk = new Uint8Array(N_OSC);
        this.wF = new Int32Array(N_OSC).fill(1); this.wI = new Uint8Array(N_OSC);
        this.lvD = new Array(11 * N_OSC).fill(EMPTY32); this.lvLen = new Int32Array(11 * N_OSC).fill(4);
        this.lvHarm = new Float64Array(11 * N_OSC).fill(1);
        // blended frames (bcGet): two cached levels per oscillator, and the last position asked for per oscillator
        this.bcF = []; for (let k = 0; k < 2 * N_OSC; k++) this.bcF.push(new Float32Array(2048));
        this.bcD = new Array(2 * N_OSC).fill(EMPTY32); this.bcE = new Float64Array(2 * N_OSC).fill(-1);
        this.bcA = new Int32Array(2 * N_OSC).fill(-1); this.bcB = new Int32Array(2 * N_OSC).fill(-1);
        this.bcT = new Float64Array(2 * N_OSC).fill(-1); this.bcR = new Uint8Array(N_OSC);
        this.skD = new Array(N_OSC).fill(EMPTY32); this.skE = new Float64Array(N_OSC).fill(-1); this.skA = new Int32Array(N_OSC).fill(-1);
        this.skB = new Int32Array(N_OSC).fill(-1); this.skT = new Float64Array(N_OSC).fill(-1); this.skC = new Float64Array(N_OSC).fill(-1);
        this.chk = 0;
        // sub
        this.sPh = 0; this.sLv = -1; this.sGL = 0; this.sGR = 0; this.sShape = -1; this.sSet = -1; this.sEp = -1; this.sOk = 0;
        this.sD = new Array(11).fill(EMPTY32); this.sLen = new Int32Array(11).fill(4); this.sHarm = new Float64Array(11).fill(1);
        this.sPan = -9; this.sCl = 1; this.sCr = 1;
        // noise (sample) and colour noise generators (streams a, b; per stream pink b0…b6, brown y, Geiger envelope;
        // tilt one-pole state per channel)
        this.nPos = 0; this.nOffP = 0; this.nLv = -1; this.nGL = 0; this.nGR = 0; this.nId = ''; this.nEp = -1; this.nOk = 0;
        this.nLevels = 0; this.nLvL = new Array(6).fill(EMPTY32); this.nLvR = new Array(6).fill(EMPTY32);
        this.nLen = new Int32Array(6); this.nLs = new Float64Array(6); this.nLe = new Float64Array(6);
        this.nRate = 48000; this.nRoot = 60; this.nLen0 = 0; this.nDone = 0; this.nLast = 0; this.nPan = -9; this.nCl = 1; this.nCr = 1;
        this.ca = 1; this.cb = 1; this.cs = new Float64Array(20); this.ct = new Float64Array(2);
        // mixer: switch ramps per channel (Filter 1, Filter 2), filter-to-filter ramps, mixes, ENV 1 on/off group gains
        this.gAmp = 0; this.gAmpN = 0; this.rg1 = new Float64Array(5); this.rg2 = new Float64Array(5); this.rgF = new Float64Array(2);
        // previous chunk's targets of the per-chunk gains ramped across the next chunk: filter balance shares (per channel,
        // F1 / F2), filter levels, bus send gains (channel·2 + bus), filter-to-filter feed levels (by receiving filter)
        this.hb1 = new Float64Array(5); this.hb2 = new Float64Array(5); this.lvP = new Float64Array(2);
        this.sgP = new Float64Array(14); this.fdP = new Float64Array(2);
        this.mixP = 1; this.mixP2 = 1; this.fIdle = 1; this.fIdle2 = 1; this.noEnv = 0; this.fo = 0; this.fu = new Uint8Array(4);
        // Filter-sourced warp modulation (§6.6.7): mono filter outputs (post mix, pre level) of the previous chunk
        this.fp1 = new Float64Array(MAXCH); this.fp2 = new Float64Array(MAXCH); this.fpZ = 3;   // fpZ bit k: fp(k+1) holds zeros
        this.fadeK = 0; this.fadeN = 0;                          // lifetime grain fade (§6.19): chunks in all / left
        // outputs of the current render call
        this.oL = null; this.oR = null; this.oDL = null; this.oDR = null; this.oB1L = null; this.oB1R = null;
        this.oB2L = null; this.oB2R = null;
      }
      rnd() { this.r = xorshift(this.r) || 1; return this.r / 4294967296; }
      rnd2() { this.r2 = xorshift(this.r2) || 1; return this.r2 / 4294967296; }
      // level-0 margin m0 (file header): as large as level 1 still reaches the audible band limit, at most 1.4
      margin() {
        const band = 0.45 * this.base < 20000 ? 0.45 * this.base : 20000, m = this.flim / (2 * band);
        this.m0 = m > 1 ? (m < 1.4 ? m : 1.4) : 1;
      }

      apply(p) {
        this.uHi.fill(16);                                       // (a type change may leave gains in any unison slot)
        const proc = this.proc, sx = attach(proc), cp = p && p.serum;
        const vok = cpOk(cp), ok = vok && this.mod !== null ? 1 : 0;
        if (cp && !vok && !warnedVer) {
          warnedVer = true;
          if (typeof console !== 'undefined') console.warn('serum-dsp: CP version', cp.ver, 'not understood (expects', VER + ')');
        }
        this.ok = ok;
        const fs = proc.fs > 0 ? +proc.fs : this.fs, CH = proc.CH > 0 ? proc.CH | 0 : this.CH, base = proc.base > 0 ? +proc.base : this.base;
        let rch = false;
        if (fs !== this.fs || CH !== this.CH || base !== this.base) {
          this.fs = fs; this.CH = CH; this.base = base;
          rch = true;
        }
        this.dt = this.CH / this.fs;
        if (this.mod !== null) this.mod.setDt(this.dt, rch);
        this.flim = this.fs - (0.45 * this.base < 20000 ? 0.45 * this.base : 20000);
        this.xf = this.flim < 40000 ? 1 : 0;
        this.margin();
        this.uH.fill(-1);                                         // level selection depends on fs/flim/xf/m0
        this.filt.setRate(this.fs);
        if (this.filt2 !== null) this.filt2.setRate(this.fs);
        this.cDet.fill(-1);
        if (!ok) return;
        syncCP(proc, sx, cp);
        syncCT(proc, sx);
        const use = sx.use;
        // WARPS2 slots and oscillator type objects (allocation happens here, never on the render path)
        if (this.W === null) {
          const W = globalThis.SxWarp;
          if (W && typeof W.Slots === 'function' && typeof W.chunk === 'function') {
            this.W = W;
            for (let o = 0; o < N_OSC; o++) this.wsl[o] = new W.Slots(16);
          } else if (!warnedWarp) { warnedWarp = true; if (typeof console !== 'undefined') console.warn('serum-dsp: SxWarp unavailable, Serum 2 warp slots act as Off'); }
        }
        for (let o = 0; o < N_OSC; o++) {
          const t = sx.oType[o];
          const skip = t === 3 && this.hid === 1;                // first-use hidden voices: Granular is GRAN_JOB's (§11.10)
          if (t !== 0 && !skip && this.oxs[4 * o + t - 1] === null) {
            const G = globalThis[TYPE_GLOBAL[t]], C = G ? G[TYPE_CLASS[t]] : null;
            if (typeof C === 'function') this.oxs[4 * o + t - 1] = new C(this, o);
            else if (warnedType[TYPE_SCRIPT[t]] === 0) {          // one warning per missing script and scope (§0.3)
              warnedType[TYPE_SCRIPT[t]] = 1;
              if (typeof console !== 'undefined') console.warn('serum-dsp:', TYPE_GLOBAL[t], 'unavailable, those oscillators are silent');
            }
          }
          // the Granular lazy warm-up (§11.10), queued once per live processor and asset id (SxBase dedupes by key)
          if (t === 3 && this.hid === 0 && !proc.offline && sx.gwOk === 0) {
            const B = globalThis.SxBase, id = cp.smp && typeof cp.smp[o] === 'string' ? cp.smp[o] : '';
            if (B && typeof B.warmAdd === 'function' && B.warmAdd(proc, 'sx-gran:' + id, GRAN_JOB)) sx.gwWait = HW_WAIT;
          }
          for (let k = 0; k < 4; k++) { const x = this.oxs[4 * o + k]; if (x !== null) x.apply(cp, o, k === 2 ? this.gq : null); }
          const x = t !== 0 && !skip ? this.oxs[4 * o + t - 1] : null;
          if (x !== this.ox[o] && this.ox[o] !== null && this.active) this.ox[o].kill();
          this.ox[o] = x;
          if (x !== null && this.ctx[o] === null) this.ctx[o] = makeCtx(o);
        }
        if ((use & 2) !== 0 && this.filt2 === null) this.filt2 = new SFilter(this.fs);
        // a spare voice (engine-owned flag: above POLY, never addressed, §11.3) keeps its filter type and gets no delay
        // lines until POLY reaches it (a delay family costs up to 1.1 MB per voice); a modulated type preallocates only
        // the families its matrix rows can reach (base ± the sum of their amounts)
        if (this.spare === 1 && !this.active) return;
        if (sx.s1) this.prepFilter(sx, cp, this.filt, F_TYPE, NTYPES - 1);
        else this.prepFilter(sx, cp, this.filt, F_TYPE2, NT2 - 1);
        if (this.filt2 !== null) this.prepFilter(sx, cp, this.filt2, F2_TYPE, NT2 - 1);
      }
      prepFilter(sx, cp, f, vi, top) {
        const bt = round(top * clamp01(sx.bT[vi]));
        if (cp.modded && cp.modded[vi]) {
          const md = sx.mod;
          let a = 0;
          for (let r = 0; r < md.mN; r++) if (md.mDst[r] === vi && md.mCtx[r] !== 4) { const m = md.mAmt[r]; a += m < 0 ? -m : m; }
          const b = sx.bT[vi];
          f.prealloc(true, floor(top * clamp01(b - a)), ceil(top * clamp01(b + a)));
        } else f.prealloc(false);
        if (bt >= NTYPES) f.need(bt);
        if (!this.active) f.setType(bt);
        else if (bt < NTYPES) f.ensure(FILTER_FAM_OF[bt], bt - FAM_FIRST[FILTER_FAM_OF[bt]]);
      }

      // keyboard mapping (§6.2): per channel A, B, C, Noise, Sub — in range: plays at n; out of the key range with fold:
      // plays folded (dk = folded key − n); otherwise silent for this note (gate 0, still rendered as a warp source)
      keymap(sx, n, vel01) {
        const v = round(127 * vel01), kg = this.kg, dk = this.dk;
        for (let c = 0; c < 5; c++) {
          kg[c] = 1; dk[c] = 0;
          if (sx.mapFull[c] === 1) continue;
          const lo = sx.mapLo[c], hi = sx.mapHi[c], inV = v >= sx.mapVLo[c] && v <= sx.mapVHi[c];
          if (inV && n >= lo && n <= hi) continue;
          if (inV && sx.mapFold[c] === 1) { dk[c] = foldInto(n, lo, hi) - n; continue; }
          kg[c] = 0;
        }
      }
      // Voice Control per-note offsets (§6.2), computed by the ModV at note-on: vcOn, vc = [panO, detO (cents), cutO, envS]
      readVC(sx) {
        const mv = this.mod, v = mv.vc;
        if (sx.vcOn === 0 || !mv.vcOn || !v) { this.vcP = 0; this.vcD = 0; this.vcC = 0; return; }
        this.vcP = +v[0] || 0; this.vcD = +v[1] || 0; this.vcC = +v[2] || 0;
      }

      noteOn(n, vel01, legato, glc, ch = 0, ex = null) {
        const proc = this.proc, sx = attach(proc);
        n = +n;
        vel01 = vel01 > 0 ? (vel01 < 1 ? +vel01 : 1) : 0;
        const wasActive = this.active;
        if (!this.ok || !this.sync(sx)) {
          this.note = n; this.vel = vel01; this.sus = false; this.fadeK = 0; this.fadeN = 0;
          this.active = false; this.gate = false; return;
        }
        if (sx.tuned !== 0 && unmapped(sx, n)) return;          // a key the .kbm leaves unmapped: ignored (§6.18)
        this.note = n; this.vel = vel01;
        this.gate = true; this.sus = false; this.fadeK = 0; this.fadeN = 0;
        legato = !!legato && wasActive;
        const vs = proc.voices;
        // poly legato reference R and overlap
        let R = null, other = false;
        if (vs && vs.length) {
          for (let k = 0; k < vs.length; k++) {
            const w = vs[k];
            if (!w || w === this || !w.gate || !w.active || !w.mod) continue;
            other = true;
            if (!R || w.stamp > R.stamp) R = w;
          }
        }
        const polyLeg = !legato && sx.cLegato === 1 && sx.cMono === 0 && R !== null;
        if (!polyLeg) R = null;
        // processor flip-flop, voice PRNG streams (r: the Phase-1 draws in Phase-1 order; r2: Phase-2 draws, §6.2)
        sx.alt = sx.alt ? 0 : 1;
        if (!legato) {
          sx.rng = xorshift(sx.rng) || 1;
          const seed = sx.rng ^ (0x9E3779B9 * (this.i + 1));
          this.r = xorshift(seed) || 1;
          this.r2 = xorshift((seed ^ 0x85EBCA6B) >>> 0) || 1;
        }
        this.ch = ch > 0 && ch <= 16 ? ch | 0 : 0;
        this.ex = ex !== undefined ? ex : null;
        this.keymap(sx, n, vel01);
        if (!wasActive) {                                        // audio-tap sources of a fresh voice read 0 (§5.3)
          const src = this.src;
          for (let k = S_OSCA; k <= S_FILT1 + 1; k++) src[k] = 0;
          this.fp1.fill(0); this.fp2.fill(0); this.fpZ = 3;
        }
        // modulation (SxMod): note-on draws rand1/rand2, VELO/NOTE, eff, portamento, envelopes, LFOs, chaos draws,
        // the note-on evaluation of the mOn rows; recent voice
        this.mod.noteOn(n, vel01, legato, R !== null ? R.mod : null, this.ch, this.ex, other);
        this.readVC(sx);
        if (legato) { this.typeNoteOn(sx, false, true); return; }
        // unison counts, random detunes, start phases (§6.4) — OSC A, B on the Phase-1 stream r in Phase-1 order, OSC C
        // on r2
        const eff = this.eff, use = sx.use, s1 = sx.s1;
        const pLegMode = sx.cLegato === 1 && sx.cMono === 0, resetG = !wasActive || pLegMode;
        for (let o = 0; o < N_OSC; o++) {
          if (o === 2 && (use & 1) === 0) { this.uN[2] = 0; this.uNx[2] = 0; continue; }
          const c2 = o === 2, kB = OKB[o], b16 = o * 16, oldN = wasActive ? this.uN[o] : 0;
          let oldX = wasActive ? this.uNx[o] : 0;                    // unison voices still fading from an earlier steal
          if (oldX < oldN) oldX = oldN;
          let N = round(1 + 15 * eff[kB + D_UNI]);
          if (N > sx.uniMax) N = sx.uniMax;
          this.uN[o] = N;
          this.uNx[o] = oldX > N ? oldX : 0;                           // dropped unison voices fade out over one chunk
          if (c2) for (let i = 0; i < 16; i++) this.uRnd[b16 + i] = 2 * this.rnd2() - 1;
          else for (let i = 0; i < 16; i++) this.uRnd[b16 + i] = 2 * this.rnd() - 1;
          this.cDet[o] = -1;
          // Phase Legato (§6.4) inverts the reset rule: a steal resets, poly legato keeps the phases running
          const resetPh = sx.phLeg[o] ? !wasActive || !pLegMode : resetG;
          for (let i = resetPh ? 0 : oldN; i < 16; i++) {
            const idx = b16 + i;
            if (!wasActive || (i >= oldN && (i < N || i >= oldX))) {
              this.uGL[idx] = 0; this.uGR[idx] = 0; this.uLv[idx] = -1; this.uFa[idx] = -1;
            }
          }
          // start phases: every unison voice on reset, only the new ones otherwise (steal, mono overlap). S1 mode, A/B:
          // the Phase-1 knob-end rule; otherwise the phase-memory menu (§6.4)
          const ph = eff[kB + D_PHASE], rd = eff[kB + D_RAND];
          let mem, trig;
          if (s1 && !c2) { mem = sx.bT[kB + D_PHASE] >= 0.9995; trig = sx.bT[kB + D_RAND] >= 0.9995; this.memK[o] = mem ? 1 : 0; }
          else { const pm = sx.phMem[o]; mem = pm !== 0; trig = pm === 2; this.memK[o] = 0; }
          const offs = this.memK[o] === 1 ? 0 : (ph < 0.99999 ? ph : 0.99999);
          for (let i = resetPh ? 0 : oldN; i < N; i++) {
            let st;
            if (!mem) st = rd * (c2 ? this.rnd2() : this.rnd());
            else if (!trig) { st = sx.memPh[o] + sx.memSet[o * 16 + i]; st -= floor(st); }
            else st = sx.memSet[o * 16 + i];
            let p = st + offs;
            p -= floor(p);
            this.uPh[b16 + i] = p;
          }
          if (resetPh) this.oOff[o] = offs;
        }
        // sub start phase (§6.11.1): s.phase, or the processor's last sub phase (Contiguous)
        if (resetG) {
          if (sx.subContig) this.sPh = sx.subPh;
          else { const q = eff[S_PHASE]; this.sPh = q > 0 ? (q < 1 ? q : 0) : 0; }
        }
        // noise read position (§6.8)
        this.resolveNoise(sx);
        const nph = eff[N_PHASE], nrd = eff[N_RAND];
        let np = (nph + nrd * this.rnd()) * this.nLen0;
        this.nDone = 0;
        if (this.nOk) {
          const ls = this.nLs[0], le = this.nLe[0], L = le - ls;
          if (!sx.noiseOneshot) { if (np >= le && L > 0) np -= L * (1 + floor((np - le) / L)); }
          else if (np >= this.nLen0) this.nDone = 1;
        }
        this.nPos = np;
        this.nOffP = nph * this.nLen0;
        this.nLv = -1; this.nLast = 0;
        // colour noise streams (§6.11.2), seeded from r2
        if (sx.noiseColor >= 0) {
          this.rnd2(); this.ca = fmix32((this.r2 ^ 0x68E31DA4) >>> 0) || 1;
          this.rnd2(); this.cb = fmix32((this.r2 ^ 0xB5297A4D) >>> 0) || 1;
        }
        // fresh voice: filters cleared, ramps start at their targets, ENV1×AMP from 0
        if (!wasActive) {
          this.filt.reset(); this.fIdle = 0;
          if (this.filt2 !== null) { this.filt2.reset(); this.fIdle2 = 0; }
          this.gAmp = 0; this.gAmpN = 0; this.sLv = -1; this.noEnv = 0;
          this.cs.fill(0); this.ct.fill(0);
          for (let o = 0; o < N_OSC; o++) if (this.wsl[o] !== null) this.wsl[o].reset();
          this.fresh = 1;
        }
        this.typeNoteOn(sx, !wasActive, false);
        this.active = true; this.played = 1;
      }
      // note-on of the Sample/Multisample/Granular/Spectral oscillators: their context with the note-on values first
      typeNoteOn(sx, fresh, legato) {
        let any = 0;
        for (let o = 0; o < N_OSC; o++) if (this.ox[o] !== null) any = 1;
        if (!any) return;
        const eff = this.eff;
        this.pitchGlobals(sx);
        this.oscSetup(sx, eff[A_ON] >= 0.5 ? 1 : 0, eff[A_ON + 1] >= 0.5 ? 1 : 0, (sx.use & 1) !== 0 && eff[C_ON] >= 0.5 ? 1 : 0,
          eff[N_ON] >= 0.5 ? 1 : 0, eff[S_ON] >= 0.5 ? 1 : 0);
        this.oscPitch(sx);
        for (let o = 0; o < N_OSC; o++) {
          const x = this.ox[o];
          if (x === null) continue;
          this.fillCtx(sx, o, 0);
          x.noteOn(this.ctx[o], fresh, legato);
        }
      }
      // re-sync the processor's CP when reset/warmUp cleared sx (§6.16): notes before the next begin still sound
      sync(sx) {
        if (sx.ok) return 1;
        const p = this.proc.p, cp = p && p.serum;
        if (!this.ok || !cpOk(cp)) return 0;
        syncCP(this.proc, sx, cp);
        syncCT(this.proc, sx);
        return sx.ok;
      }
      noteOff(rv) {
        this.gate = false;
        if (this.mod !== null) this.mod.noteOff(rv);
        for (let o = 0; o < N_OSC; o++) { const x = this.ox[o]; if (x !== null) x.noteOff(); }
      }
      kill() {
        this.active = false; this.gate = false; this.sus = false; this.fadeK = 0; this.fadeN = 0;
        this.filt.reset();
        if (this.filt2 !== null) this.filt2.reset();
        if (this.mod !== null) this.mod.kill();
        this.gAmp = 0; this.gAmpN = 0; this.uGL.fill(0); this.uGR.fill(0); this.sGL = 0; this.sGR = 0; this.nGL = 0; this.nGR = 0;
        this.uLv.fill(-1); this.uFa.fill(-1); this.sLv = -1; this.nLv = -1; this.uNx.fill(0);
        for (let o = 0; o < N_OSC; o++) { const x = this.ox[o]; if (x !== null) x.kill(); }
      }
      // the voice ends (lifetime rule, §6.19): envelopes idle, the type oscillators return their streams/grains
      end() {
        this.active = false;
        this.mod.stop();
        for (let o = 0; o < N_OSC; o++) { const x = this.ox[o]; if (x !== null) x.kill(); }
      }
      // every envelope has finished its release (stage 0, whatever End level it holds — inv B13 "terminates after the
      // longest release of any of the envelopes"): lifetime rule (b) of §6.19 (SxMod's envsIdle, which also leaves out a
      // bypassed ENV 4; the fallback reads the documented ModV stages)
      envIdle() {
        const mv = this.mod;
        if (typeof mv.envsIdle === 'function') return mv.envsIdle();
        const st = mv.eSt;
        for (let e = 0; e < N_ENV; e++) if (st[e] !== 0) return false;
        return true;
      }

      // render(O, N) (SPEC-serum2 §11.10: O = {L, R, dL, dR, b1L, b1R, b2L, b2R}, OS-rate arrays, outputs selected by
      // CP.outMask) or the Phase-1 signature render(bufL, bufR, N, dirL, dirR) (direct → dirL/dirR or main, buses → main)
      render(a, b, c, d, e) {
        if (!this.active || !this.ok) return;
        const sx = this.proc.sx;
        if (!sx || !this.sync(sx)) return;
        let N;
        if (a !== null && typeof a === 'object' && typeof a.length !== 'number') {
          N = b;
          const m = sx.outMask, dOk = (m & 2) !== 0 && !!a.dL && !!a.dR;
          const b1 = (m & 4) !== 0 && !!a.b1L && !!a.b1R, b2 = (m & 8) !== 0 && !!a.b2L && !!a.b2R;
          this.oL = a.L; this.oR = a.R;
          this.oDL = dOk ? a.dL : a.L; this.oDR = dOk ? a.dR : a.R;
          this.oB1L = b1 ? a.b1L : a.L; this.oB1R = b1 ? a.b1R : a.R; this.oB2L = b2 ? a.b2L : a.L; this.oB2R = b2 ? a.b2R : a.R;
        } else {
          N = c;
          const dir = d !== undefined && d !== null && e !== undefined && e !== null && (sx.outMask & 2) !== 0;
          this.oL = a; this.oR = b; this.oDL = dir ? d : a; this.oDR = dir ? e : b;
          this.oB1L = a; this.oB1R = b; this.oB2L = a; this.oB2R = b;
        }
        const CH = this.CH;
        let nCh = (N / CH) | 0;
        if (nCh > MAXCH) nCh = MAXCH;
        const extra = sx.span === 0 || this.span === sx.span;
        this.span = sx.span;
        const sN = sx.nCh > 0 ? sx.nCh : 1;
        for (let k = 0; k < nCh; k++) {
          const gc = extra ? sN - 1 : (k < sN ? k : sN - 1);
          const fr = extra ? 1 : (k + 1) / sN;
          if (!this.chunk(k * CH, gc, fr)) break;
        }
        if (sx.mod.recent === this) {
          this.mod.post();                                       // sources → monoSrc, portamento start (SxMod)
          for (let o = 0; o < N_OSC; o++) { let p = this.uPh[o * 16] - this.oOff[o]; p -= floor(p); sx.memPh[o] = p; }
          sx.subPh = this.sPh;
        }
      }

      // one chunk (SPEC-serum2 §6.1): steps 1–3 in SxMod, rendering here; returns false once the voice became inactive
      chunk(o0, gc, fr) {
        const sx = this.proc.sx, mv = this.mod;
        this.chk++;
        if (this.fadeK > 0) {                                    // the 2 ms end fade (§6.19) is over
          if (this.fadeN <= 0) { this.fadeK = 0; this.end(); return false; }
        } else if (!this.gate && this.fresh === 0 &&
          (this.noEnv === 0 ? this.eV[0] <= 1e-5 && this.gAmp <= 1e-5 : this.envIdle())) {
          // rule (a) with no grain sounding ends at once (every channel is already silent); grains still sounding, and
          // rule (b) (ENV-off channels play at full level until now), end with a 2 ms fade of every group gain (§6.19)
          if (this.noEnv === 0 && !this.grainsLive()) { this.end(); return false; }
          const K = ceil(0.002 * this.fs / this.CH);
          this.fadeK = K > 1 ? K : 1; this.fadeN = this.fadeK;
        }
        mv.follow(fr);
        mv.sources(gc);
        mv.matrix(fr);
        this.renderChunk(sx, o0);
        mv.advance(gc);
        this.fresh = 0;
        if (this.fadeK > 0) this.fadeN--;
        return true;
      }
      grainsLive() {
        for (let o = 0; o < N_OSC; o++) { const x = this.ox[o]; if (x !== null && x.grains() > 0) return true; }
        return false;
      }

      /* ---- pitch (§6.3) ---- */
      // per-chunk terms shared by every channel: bend (S1 ranges g.bendup/benddn, else g.bu2/bd2), master tune, the MPE
      // per-note bend, the Voice Control detune
      pitchGlobals(sx) {
        const eff = this.eff, bnd = this.src[S_BEND];
        let bu, bd;
        if (sx.s1) { bu = round(48 * eff[G_BENDUP] - 24); bd = round(48 * eff[G_BENDDN] - 24); }
        else { bu = round(48 * eff[G_BU2]); bd = round(48 * eff[G_BD2]) - 48; }
        this.pBend = bnd >= 0 ? bnd * bu : -bnd * bd;
        this.pTune = 128 * eff[G_TUNE] - 64;
        const ms = sx.mpeOn !== 0 ? this.mod.mpeSt : 0;          // SxMod: smoothed member-channel bend × CP.mpeBend
        this.pMpe = ms > 0 || ms < 0 ? ms : 0;
        this.pDet = sx.vcOn !== 0 ? this.vcD / 100 : 0;
      }
      // note' of channel c with its pitch tracking on (§6.3.1): the gliding pitch (SxMod's nP, already tuned when
      // CP.use & 512, §11.6), plus the channel's fold offset (tuned: tune[n + dk] − tune[n])
      noteOf(sx, c) {
        const nP = this.mod.nP, d = this.dk[c];
        if (d === 0) return nP;
        if (sx.tuned === 0) return nP + d;
        const n = this.note | 0, k = n + d, T = sx.tune;
        let a = T[n >= 0 ? (n <= 127 ? n : 127) : 0], b = T[k >= 0 ? (k <= 127 ? k : 127) : 0];
        if (a !== a) a = n;
        if (b !== b) b = k;
        return nP + (b - a);
      }
      // base pitch (without unison terms) and frequency of every oscillator in its pitch mode (§6.3.3); ratio oscillators
      // after their source (normalisation keeps the chains acyclic)
      // (M4) lazy (renderChunk, after oscSetup): an oscillator that renders nothing this chunk — switched off (or outside its
      // key range), not a tap, its unison gains all 0 (gz) — and is no ratio oscillator's source keeps last chunk's pitch:
      // only renderWT / fillCtx read it, and neither runs for it this chunk
      oscPitch(sx, lazy) {
        const nO = (sx.use & 1) !== 0 ? 3 : 2;
        this.pOk = 0;
        let left = 0, src = 0;
        if (lazy) for (let o = 0; o < nO; o++) if (sx.pMode[o] === PM_RATIO) { const q = sx.pSrc[o]; if (q >= 0 && q < nO) src |= 1 << q; }
        for (let o = 0; o < nO; o++) {
          if (sx.pMode[o] === PM_RATIO && sx.pSrc[o] >= 0 && sx.pSrc[o] < nO) left |= 1 << o;
          else if (lazy && (src & (1 << o)) === 0 && (this.oOn[o] & this.kg[o]) === 0 && this.oCap[o] === 0 && this.gz[o] === 0) continue;
          else this.oscP(sx, o);
        }
        for (let pass = 0; pass < 2 && left !== 0; pass++) {
          for (let o = 0; o < nO; o++) if ((left & (1 << o)) !== 0 && (left & (1 << sx.pSrc[o])) === 0) { this.oscP(sx, o); left &= ~(1 << o); }
        }
        for (let o = 0; o < nO; o++) if ((left & (1 << o)) !== 0) this.oscP(sx, o);
      }
      oscP(sx, o) {
        const eff = this.eff, kB = OKB[o], t = sx.oType[o], trk = eff[OTRK[o]] >= 0.5;
        const nt = trk ? this.noteOf(sx, o) : (t === 0 ? 0 : 60);
        const bt = trk || t <= 1 || sx.bendTrack[o] === 1;      // tracking off: Sample/Granular/Spectral bend per bendTrack
        const bendSt = bt ? this.pBend : 0, mpeSt = bt ? this.pMpe : 0, tune = this.pTune, mode = sx.pMode[o];
        let p;
        if (mode === PM_RATIO) {
          const s = sx.pSrc[o];
          let ps;
          if (s >= 0 && (this.pOk & (1 << s)) !== 0) ps = this.cP[s];
          else { ps = nt + bendSt + tune; if (mpeSt !== 0) ps += mpeSt; }
          p = ps + (96 * eff[O2B[o] + K_RATIO] - 48) + (2 * eff[kB + D_FINE] - 1) + (128 * eff[kB + D_CRS] - 64);
        } else {
          const oct = round(8 * eff[kB + D_OCT] - 4), semi = round(24 * eff[kB + D_SEMI] - 12);
          if (mode === PM_HARM) {
            const h = semi >= 0 ? 12 * mlog2(semi + 1) : -12 * mlog2(1 - semi);
            p = nt + 12 * oct + h + (2 * eff[kB + D_FINE] - 1) + (128 * eff[kB + D_CRS] - 64) + bendSt + tune;
          } else if (mode === PM_STEP && sx.sclN > 0) {
            p = nt + sclSemis(sx, oct * sx.sclN + semi) + (2 * eff[kB + D_FINE] - 1) + (128 * eff[kB + D_CRS] - 64) + bendSt + tune;
          } else {                                               // Semitones: the Phase-1 arithmetic
            p = nt + 12 * oct + semi + (2 * eff[kB + D_FINE] - 1) + (128 * eff[kB + D_CRS] - 64) + bendSt + tune;
          }
          if (mpeSt !== 0) p += mpeSt;
        }
        this.cP[o] = p; this.pOk |= 1 << o;
        const det = sx.vcSel[o] !== 0 ? this.pDet : 0;
        this.fB[o] = sx.a4 * exp2(((det !== 0 ? p + det : p) - 69) / 12);
        const hz = eff[O2B[o] + K_HZ];
        this.cHz[o] = hz === 0.5 ? 0 : 100 * hz - 50;
      }

      /* ---- oscillator setup per chunk: warp modes, modulators, render order (§6.6.6) ---- */
      oscSetup(sx, onA, onB, onC, onN, onS) {
        const eff = this.eff, s1 = sx.s1, use = sx.use, kg = this.kg, on = this.oOn, av = this.oAv, md = this.md, lg = this.lg;
        const dep = this.dep, nO = (use & 1) !== 0 ? 3 : 2;
        on[0] = onA; on[1] = onB; on[2] = onC;
        const su = sx.srcU;
        for (let o = 0; o < N_OSC; o++) {
          av[o] = on[o] !== 0 && (kg[o] !== 0 || sx.mapWarp[o] !== 0) ? 1 : 0;   // usable as a warp modulator
          dep[o] = 0; this.mtx[o] = 0; this.lvar[o] = -1;
          this.oCap[o] = su[S_OSCA + o] !== 0 && on[o] !== 0 ? 1 : 0;   // audio-tap source (§5.3) of a switched-on oscillator
          const b = O2B[o];
          let m1 = 0, m2 = 0;
          lg[o] = 0;
          if (o < 2 && s1) { const w = round(22 * eff[A_WARPMODE + o]); lg[o] = w > 0 ? (w < 22 ? w : 22) : 0; }
          else m1 = round(81 * eff[b + K_W1]);
          if ((use & 4) !== 0) m2 = round(81 * eff[b + K_W2]);
          m1 = m1 > 0 ? (m1 < 81 ? m1 : 81) : 0; m2 = m2 > 0 ? (m2 < 81 ? m2 : 81) : 0;
          if (sx.oType[o] !== 4) { if (m1 >= 58) m1 = 0; if (m2 >= 58) m2 = 0; }   // spectral warps: Spectral only (§3.4.2)
          md[2 * o] = m1; md[2 * o + 1] = m2;
        }
        // Phase-1 single-direction rule of the legacy FM/AM/RM pair (S1 mode)
        if (lg[0] >= 18 && lg[0] <= 20 && lg[1] >= 18 && lg[1] <= 20) lg[1] = 0;
        // legacy slot 1 of a non-wavetable A/B (S1 mode): S1_TO_S2_WARP onto WARPS2
        for (let o = 0; o < 2; o++) {
          if (lg[o] !== 0 && this.ox[o] !== null && sx.oType[o] !== 0) { md[2 * o] = S1W_MODE[lg[o]]; this.lvar[o] = S1W_VAR[lg[o]]; lg[o] = 0; }
        }
        // modulators: availability, edges target ← source in slot order (A1, A2, B1, B2, C1, C2); an edge that would close
        // a cycle turns its slot Off for this chunk
        const f1 = eff[F_ON] >= 0.5, f2 = this.filt2 !== null && eff[F2_ON] >= 0.5;
        let fpu = 0;
        for (let o = 0; o < nO; o++) {
          for (let k = 0; k < 2; k++) {
            let srcO = -1, legacy = 0;
            const j = 2 * o + k;
            this.mA[j] = ZERO; this.mS[j] = 0;
            if (k === 0 && lg[o] !== 0) {
              if (lg[o] >= 18 && lg[o] <= 20) { srcO = 1 - o; legacy = 1; } else continue;
            } else {
              const m = md[j];
              if (m === 0) continue;
              const ms = WSRC2[m];
              if (ms === MS_O1 || ms === MS_O2) srcO = OTH[2 * o + ms - 1];
              else if (ms === MS_NOISE) { if (onN) { this.mA[j] = NRAW; this.mS[j] = 1; } else md[j] = 0; continue; }
              else if (ms === MS_SUB) { if (onS) { this.mA[j] = SRAW; this.mS[j] = 1; } else md[j] = 0; continue; }
              else if (ms === MS_F1) { if (f1) { this.mA[j] = this.fp1; this.mS[j] = 1; fpu |= 1; } else md[j] = 0; continue; }
              else if (ms === MS_F2) { if (f2) { this.mA[j] = this.fp2; this.mS[j] = 1; fpu |= 2; } else md[j] = 0; continue; }
              else continue;
            }
            if (srcO >= nO || av[srcO] === 0 || this.reach(srcO, o)) { if (!legacy) md[j] = 0; else if (srcO < nO && av[srcO] !== 0) lg[o] = 0; continue; }
            dep[o] |= 1 << srcO; this.oCap[srcO] = 1;
            if (!legacy) { this.mtx[srcO] = 1; this.mA[j] = MTS[srcO]; this.mS[j] = this.uN[srcO] > 0 ? this.uN[srcO] : 1; }
          }
        }
        this.fpUse = fpu;
        // render order: topological over the accepted edges, ties A, B, C
        let placed = 0, n = 0;
        for (let pass = 0; pass < nO; pass++) {
          for (let o = 0; o < nO; o++) {
            if ((placed & (1 << o)) !== 0 || (dep[o] & ~placed) !== 0) continue;
            this.ord[n++] = o; placed |= 1 << o;
            break;
          }
        }
        this.ordN = n;
      }
      // does oscillator a (transitively) depend on oscillator b?
      reach(a, b) {
        const dep = this.dep;
        let seen = 0, front = dep[a];
        while (front !== 0) {
          if ((front & (1 << b)) !== 0) return true;
          seen |= front;
          let nx = 0;
          for (let o = 0; o < N_OSC; o++) if ((front & (1 << o)) !== 0) nx |= dep[o];
          front = nx & ~seen;
        }
        return a === b;
      }
      // raw unison outputs of oscillator o, sample-major (the SxWarp modulator layout [s·N + i])
      toMT(o) {
        const N = this.uN[o] > 0 ? this.uN[o] : 1, CH = this.CH, RAW = RAWS[o], MT = MTS[o];
        for (let i = 0; i < N; i++) { const b = i * MAXCH; for (let s = 0; s < CH; s++) MT[s * N + i] = RAW[b + s]; }
      }

      /* ---- rendering (§1, §6) ---- */
      renderChunk(sx, o0) {
        const eff = this.eff, CH = this.CH, use = sx.use, kg = this.kg, act = this.act;
        const onA = eff[A_ON] >= 0.5 ? 1 : 0, onB = eff[A_ON + 1] >= 0.5 ? 1 : 0, onC = (use & 1) !== 0 && eff[C_ON] >= 0.5 ? 1 : 0;
        const onN = eff[N_ON] >= 0.5 ? 1 : 0, onS = eff[S_ON] >= 0.5 ? 1 : 0;
        this.onA = onA; this.onB = onB; this.onC = onC; this.onN = onN; this.onS = onS;
        this.pitchGlobals(sx);
        // sub and noise first (they are warp modulators)
        const sAct = onS || this.sGL !== 0 || this.sGR !== 0 ? this.renderSub(sx, onS & kg[4]) : 0;
        if (!sAct) for (let s = 0; s < CH; s++) { SL[s] = 0; SR[s] = 0; SRAW[s] = 0; }
        const nAct = onN || this.nGL !== 0 || this.nGR !== 0
          ? (sx.noiseColor >= 0 ? this.renderColor(sx, onN & kg[3]) : this.renderNoise(sx, onN & kg[3])) : 0;
        if (!nAct) { for (let s = 0; s < CH; s++) { NL[s] = 0; NR[s] = 0; NRAW[s] = 0; } this.nLast = 0; }
        act[3] = nAct; act[4] = sAct;
        // oscillators: modes, modulators and order (§6.6.6), pitches (§6.3), rendered in order
        this.oscSetup(sx, onA, onB, onC, onN, onS);
        this.oscPitch(sx, 1);
        act[0] = 0; act[1] = 0; act[2] = 0;
        for (let k = 0; k < this.ordN; k++) {
          const o = this.ord[k];
          act[o] = this.ox[o] === null ? this.renderWT(sx, o, XLS[o], XRS[o]) : this.renderType(sx, o, XLS[o], XRS[o]);
          if (act[o] === 0 && this.oCap[o] !== 0) RAWS[o].fill(0, 0, 16 * MAXCH);
          if (this.mtx[o] !== 0) this.toMT(o);
        }
        this.mixOut(sx, o0);
      }

      // Blend of frames fa, fb at t of one level (data d, length len), cached: plain1 on it equals plain2's two reads
      // per sample (the blend is linear) at half the reads, shared by the unison voices of the oscillator. Built only
      // for a position that also held in an earlier chunk (a modulated WT POS changes every chunk: plain2 then).
      bcGet(o, d, fa, fb, t, len) {
        const b = o * 2;
        for (let k = b; k < b + 2; k++) {
          if (this.bcD[k] === d && this.bcE[k] === epoch && this.bcA[k] === fa && this.bcB[k] === fb && this.bcT[k] === t) return this.bcF[k];
        }
        if (this.skD[o] === d && this.skE[o] === epoch && this.skA[o] === fa && this.skB[o] === fb && this.skT[o] === t) {
          if (this.skC[o] === this.chk || len > 2048) return null;
          const k = b + this.bcR[o];
          this.bcR[o] ^= 1;
          const F = this.bcF[k], A = fa * len, B = fb * len;
          for (let i = 0; i < len; i++) { const x = d[A + i]; F[i] = x + t * (d[B + i] - x); }
          this.bcD[k] = d; this.bcE[k] = epoch; this.bcA[k] = fa; this.bcB[k] = fb; this.bcT[k] = t;
          return F;
        }
        this.skD[o] = d; this.skE[o] = epoch; this.skA[o] = fa; this.skB[o] = fb; this.skT[o] = t; this.skC[o] = this.chk;
        return null;
      }
      resolveWT(sx, o) {
        const id = sx.wt[o];
        if (id === this.wId[o] && this.wEp[o] === epoch) return;
        this.wId[o] = id;
        this.wEp[o] = epoch;
        const e = tables.get(id);
        for (let i = 0; i < 16; i++) { this.uLv[o * 16 + i] = -1; this.uFa[o * 16 + i] = -1; }
        if (!e || e.kind !== 'wt' || !e.levels) { this.wOk[o] = 0; return; }
        this.wOk[o] = 1;
        this.wF[o] = e.frames | 0;
        this.wI[o] = e.interp && e.frames > 1 ? 1 : 0;
        for (let l = 0; l < 11; l++) {
          const lv = e.levels[l];
          this.lvD[o * 11 + l] = lv.data; this.lvLen[o * 11 + l] = lv.len;
          this.lvHarm[o * 11 + l] = lv.harm > 0 ? +lv.harm : MIP_HARM[l];
        }
      }
      // unison ratios, pans, blend gains and the oscillator pan (cached until their inputs change; Phase-1 formulas)
      uniCache(sx, o, N) {
        const eff = this.eff, kB = OKB[o], b16 = o * 16, ub = (N - 1) * 16;
        const dn = eff[kB + D_DET], det = dn * dn, stack = round(8 * eff[kB + D_STACK]), mode = sx.uniMode[o], R = sx.uniRange[o];
        if (det !== this.cDet[o] || stack !== this.cStk[o] || N !== this.cN[o] || mode !== this.cMode[o] || R !== this.cR[o]) {
          this.cDet[o] = det; this.cStk[o] = stack; this.cN[o] = N; this.cMode[o] = mode; this.cR[o] = R;
          const sb = (stack >= 0 && stack <= 8 ? stack : 0) * 256 + ub;
          for (let i = 0; i < N; i++) {
            const sh = mode === 4 ? this.uRnd[b16 + i] : U_SHAPE[mode * 256 + ub + i];
            this.uRat[b16 + i] = exp2((U_STACK[sb + i] + sh * det * R * 0.5) / 12);
          }
        }
        const width = eff[kB + D_UNIW];
        if (width !== this.cW[o] || N !== this.cWN[o]) {
          this.cW[o] = width; this.cWN[o] = N;
          for (let i = 0; i < N; i++) {
            const pp = UT[ub + i] * width;
            this.uPL[b16 + i] = panG(pp, 0); this.uPR[b16 + i] = panG(pp, 1);
          }
        }
        const blend = eff[kB + D_BLEND];
        if (blend !== this.cBl[o] || N !== this.cBN[o]) {
          this.cBl[o] = blend; this.cBN[o] = N;
          let gc = 1, gs = 1, comp = 1 / sqrt(N);
          if (N > 2) {
            if (blend <= 0.75) gs = blend / 0.75; else gc = (1 - blend) / 0.25;
            const nc = (N & 1) ? 1 : 2, S = nc * gc * gc + (N - nc) * gs * gs;
            comp = S > 1e-12 ? 1 / sqrt(S) : 0;
          }
          this.gC[o] = gc; this.gSd[o] = gs; this.comp[o] = comp;
        }
        let pan = 2 * eff[kB + D_PAN] - 1;
        if (sx.vcOn !== 0 && sx.vcSel[o] !== 0 && this.vcP !== 0) { pan += this.vcP; pan = pan > -1 ? (pan < 1 ? pan : 1) : -1; }
        if (pan !== this.cPan[o]) {
          this.cPan[o] = pan;
          this.bl[o] = panG(pan, 0); this.br[o] = panG(pan, 1);
        }
      }
      // WARPS2 slot amounts per unison voice (§6.6.8) and the unison frequencies; SxWarp.chunk for both slots
      warpChunk(sx, o, NX, ub, ubX, N, fB, hz) {
        const eff = this.eff, kB = OKB[o], b = O2B[o], sl = this.wsl[o], W = this.W, m1 = this.md[2 * o], m2 = this.md[2 * o + 1];
        const uw = (2 * eff[kB + D_UNIWARP] - 1) * 0.5, uw2 = (2 * eff[b + K_UNIWARP2] - 1) * 0.5, w1 = eff[kB + D_WARP];
        const w2 = eff[b + K_WARP2], fs = this.fs, fmax = 0.45 * fs, b16 = o * 16;
        for (let i = 0; i < NX; i++) {                           // (SxWarp.chunk reads the first NX values only)
          const t = i < N ? UT[ub + i] : UT[ubX + i];
          let a = w1 + t * uw, c = w2 + t * uw2;
          WA1[i] = a > 0 ? (a < 1 ? a : 1) : 0; WA2[i] = c > 0 ? (c < 1 ? c : 1) : 0;
          let f = fB * this.uRat[b16 + i];
          if (hz !== 0) f += hz;
          FI[i] = f < fmax ? (f > 0.01 ? f : 0.01) : fmax;
        }
        const v1 = this.lvar[o] >= 0 ? this.lvar[o] : eff[b + K_WVAR1];
        const e1 = W.chunk(sl, 0, m1, WA1, v1, sx.fmType[2 * o], FI, fs, NX);
        const e2 = W.chunk(sl, 1, m2, WA2, eff[b + K_WVAR2], sx.fmType[2 * o + 1], FI, fs, NX);
        return (e1 !== 0 ? 1 : 0) | (e2 !== 0 ? 2 : 0);
      }
      // one wavetable oscillator's unison sum into OL/OR (§6.3–§6.7, §6.6); RAW capture when it is a modulator or tap
      renderWT(sx, o, OL, OR) {
        const eff = this.eff, CH = this.CH, kB = OKB[o], N = this.uN[o], b16 = o * 16, fresh = this.fresh;
        const on = this.oOn[o] & this.kg[o], cap = this.oCap[o];
        // (an oscillator that renders nothing returns 0 without clearing OL / OR: its act is 0 and nothing reads them, M4)
        if (N < 1) return 0;
        if (!on && !cap) {
          if (this.gz[o] === 0) return 0;
          let any = 0;
          for (let i = 0; i < 16; i++) if (this.uGL[b16 + i] !== 0 || this.uGR[b16 + i] !== 0) { any = 1; break; }
          if (!any) { this.gz[o] = 0; return 0; }
        }
        this.gz[o] = 1;
        for (let s = 0; s < CH; s++) { OL[s] = 0; OR[s] = 0; }
        this.resolveWT(sx, o);
        const ok = this.wOk[o];
        const fB = this.fB[o], hz = this.cHz[o];
        const ub = (N - 1) * 16;
        this.uniCache(sx, o, N);
        const lev = eff[kB + D_LEVEL], gain = on ? lev * lev * this.comp[o] : 0;
        const gL0 = gain * this.bl[o], gR0 = gain * this.br[o], gcn = this.gC[o], gsd = this.gSd[o];
        // warp, position, modulator (legacy slot 1: S1 mode, Phase-1 code path)
        const wEff = eff[kB + D_WARP], uw = (2 * eff[kB + D_UNIWARP] - 1) * 0.5, uwt = (2 * eff[kB + D_UNIWT] - 1) * 0.5;
        const pos = eff[kB + D_WT];
        const wm = this.lg[o];
        let MOD = ZERO, mN = 1, mStr = 0, mAvail = 0;
        if (wm >= 18 && wm <= 20) { const q = 1 - o; if ((this.dep[o] & (1 << q)) !== 0) { MOD = RAWS[q]; mN = this.uN[q]; mStr = MAXCH; mAvail = 1; } }
        else if (wm === 21) { if (this.onN) { MOD = NRAW; mAvail = 1; } }
        else if (wm === 22) { if (this.onS) { MOD = SRAW; mAvail = 1; } }
        if (mN < 1) mN = 1;
        // phase offset (PHASE knob, §6.4), spread over the chunk (S1 knob-end Mem: no offset)
        const mem = sx.s1 !== 0 && o < 2 && sx.bT[kB + D_PHASE] >= 0.9995, pk = eff[kB + D_PHASE];
        const nOff = mem ? 0 : (pk < 0.99999 ? pk : 0.99999), dOff = (nOff - this.oOff[o]) / CH;
        this.oOff[o] = nOff;
        const fs = this.fs, fmax = 0.45 * fs, flim = this.flim, F = this.wF[o];
        const interp = this.wI[o] !== 0 || (sx.smoothWT[o] !== 0 && F > 1) ? 1 : 0;   // Smooth Interpolation (§6.5)
        const REM = o < 2 || sx.remap.length >= N_OSC * 2049 ? sx.remap : DEF_REMAP, rb = o * 2049, RAW = RAWS[o];
        const hb = o * 11, iC = 1 / CH, m0 = this.m0;
        // unison voices dropped by a steal (uNx > N) fade out over this chunk with their old layout (§6.1, no click)
        const NX = this.uNx[o] > N ? this.uNx[o] : N, ubX = (NX - 1) * 16;
        this.uNx[o] = 0;
        // WARPS2 slots of this chunk (SxWarp, §6.6): which slots act, their per-voice coefficients
        const m1 = this.md[2 * o], m2 = this.md[2 * o + 1], sl = this.wsl[o];
        let es = 0;
        if ((m1 !== 0 || m2 !== 0) && sl !== null) es = this.warpChunk(sx, o, NX, ub, ubX, N, fB, hz);
        const U = sl !== null ? sl.maxUni : 16, d1 = (es & 1) !== 0 ? WDOM2[m1] : 0, d2 = (es & 2) !== 0 ? WDOM2[m2] : 0;
        const b2 = O2B[o], var1 = this.lvar[o] >= 0 ? this.lvar[o] : eff[b2 + K_WVAR1], var2 = eff[b2 + K_WVAR2];
        const fm1 = sx.fmType[2 * o], fm2 = sx.fmType[2 * o + 1];
        const M1 = this.mA[2 * o], ms1 = this.mS[2 * o], M2 = this.mA[2 * o + 1], ms2 = this.mS[2 * o + 1], W = this.W;
        const uRat = this.uRat, uPL = this.uPL, uPR = this.uPR, uGL = this.uGL, uGR = this.uGR, uPh = this.uPh, uLv = this.uLv;
        const uH = this.uH, uLx = this.uLx, uWx = this.uWx, uFa = this.uFa, uFp = this.uFp, lvD = this.lvD, lvLen = this.lvLen;
        const lvHarm = this.lvHarm, xf = this.xf;
        for (let i = 0; i < NX; i++) {
          const idx = b16 + i, live = i < N, t = live ? UT[ub + i] : UT[ubX + i];
          let f = fB * uRat[idx];
          if (hz !== 0) f += hz;
          f = f < fmax ? (f > 0.01 ? f : 0.01) : fmax;
          const inc = f / fs + dOff;
          // gains (ramped from the previous chunk)
          const gi = N <= 2 || U_CENTER[ub + i] ? gcn : gsd;
          const GLt = live ? gL0 * gi * uPL[idx] : 0, GRt = live ? gR0 * gi * uPR[idx] : 0;
          let gl = fresh ? GLt : uGL[idx], gr = fresh ? GRt : uGR[idx];
          const dgl = (GLt - gl) * iC, dgr = (GRt - gr) * iC;
          uGL[idx] = GLt; uGR[idx] = GRt;
          let ph = uPh[idx];
          if (!ok) { ph += inc * CH; ph -= floor(ph); uPh[idx] = ph; continue; }
          // legacy warp (§3.3, §6.7)
          let w = wEff + t * uw;
          w = w > 0 ? (w < 1 ? w : 1) : 0;
          const m = wm === 0 ? 0 : warpSetup(wm, w, mAvail);
          const K = wK;
          let sp = m === 0 ? 1 : wSp;
          // WARPS2 slots acting on this unison voice
          const a1 = d1 !== 0 && sl.em[i] !== 0, a2 = d2 !== 0 && sl.em[U + i] !== 0;
          if (a1) sp *= sl.sp[i];
          if (a2) sp *= sl.sp[U + i];
          // mip level (§7.4) with hysteresis; a change crossfades over the chunk. The selection depends only on H
          // (and the previous level): an unchanged H keeps the previous result.
          const lvOld = uLv[idx], H = flim / (f * sp);
          let lv, lvX = -1, wX = 1, twoLv = false;
          if (H === uH[idx] && lvOld >= 0) { lv = lvOld; lvX = uLx[idx]; wX = uWx[idx]; }
          else {
            if (xf) { lv = selBlend(H, lvHarm, hb); lvX = bLvB; wX = bW; }
            else { lv = selLevel(lvOld, H, lvHarm, hb, m0); twoLv = lvOld >= 0 && lvOld !== lv; }
            uH[idx] = H; uLv[idx] = lv; uLx[idx] = lvX; uWx[idx] = wX;
            this.uEl[idx] = lvX >= 0 ? lv + 1 - wX : lv;
          }
          // frames (§6.5)
          let p = pos + t * uwt;
          p = p > 0 ? (p < 1 ? p : 1) : 0;
          if (i === 0) this.wPos[o] = p;
          let fa, fb, t0, t1, xa = -1, xt = 0;                  // xa ≥ 0: old pair (xa, xa + 1) at xt crossfades out
          if (interp) {
            const fp = p * (F - 1);
            let k0 = fp | 0;
            if (k0 > F - 2) k0 = F - 2;
            fa = k0; fb = k0 + 1; t1 = fp - k0;
            const kp = uFa[idx];
            if (kp < 0 || kp > F - 2) t0 = t1;
            else if (kp === k0) { t0 = uFp[idx] - k0; t0 = t0 > 0 ? (t0 < 1 ? t0 : 1) : 0; }
            else { t0 = t1; xa = kp; xt = uFp[idx] - kp; xt = xt > 0 ? (xt < 1 ? xt : 1) : 0; }
            uFp[idx] = fp; uFa[idx] = k0;
          } else {
            let k = F > 1 ? floor(p * F) : 0;
            if (k > F - 1) k = F - 1;
            const kp = uFa[idx];
            if (kp < 0 || kp === k || kp >= F) { fa = k; fb = k; t0 = 0; t1 = 0; }
            else { fa = kp; fb = k; t0 = 0; t1 = 1; }
            uFa[idx] = k;
          }
          const two = fa !== fb && (t0 !== 0 || t1 !== 0) && !(t0 === 1 && t1 === 1);
          const d = lvD[hb + lv], len = lvLen[hb + lv], msk = len - 1, dt = (t1 - t0) * iC;
          if (a1 || a2) {
            // WARPS2 path (§6.6.1): F stage → accumulator → P stages → read (+ Odd/Even) → windows → O stages
            if (d1 === WD_F || d2 === WD_F) {
              for (let s = 0; s < CH; s++) INC[s] = inc;
              if (a1 && d1 === WD_F) W.incBlockA(sl, 0, i, m1, fm1, WA1, i, M1, ms1, INC, INC, CH);
              if (a2 && d2 === WD_F) W.incBlockA(sl, 1, i, m2, fm2, WA2, i, M2, ms2, INC, INC, CH);
              for (let s = 0; s < CH; s++) { PHU[s] = ph; ph += INC[s]; if (ph >= 1 || ph < 0) ph -= floor(ph); }
            } else {
              for (let s = 0; s < CH; s++) { PHU[s] = ph; ph += inc; if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1; }
            }
            const hw = (a1 && sl.hw[0] !== 0) || (a2 && sl.hw[1] !== 0);
            if (hw) for (let s = 0; s < CH; s++) WN[s] = 1;
            const hasWin = m === 2 || m === 3 || m === 11 || m === 19 || m === 20;
            if (m !== 0) {
              const mo = mStr ? (i % mN) * mStr : 0;
              for (let s = 0; s < CH; s++) {
                const mv = MOD[mo + s], q = PHU[s];
                PHB[s] = warpPh(m, q, K, w, REM, rb, mv);
                if (hasWin) WIN[s] = winF(m, q, w, mv);
              }
            } else if (a1 && d1 === WD_P && m1 !== W_PDSELF) W.phaseBlockA(sl, 0, i, m1, WA1, i, var1, REM, rb, M1, ms1, PHU, PHB, WN, CH);
            else for (let s = 0; s < CH; s++) PHB[s] = PHU[s];
            // (PD (Self) is not passed to phaseBlock on the wavetable path: the read loop applies it per sample, §11.7)
            if (a2 && d2 === WD_P && m2 !== W_PDSELF) W.phaseBlockA(sl, 1, i, m2, WA2, i, var2, REM, rb, M2, ms2, PHB, PHB, WN, CH);
            FA[6] = xt; FA[7] = t0; FA[8] = dt;
            // PD (Self) (§6.6.4; SxWarp: the kernels leave it to the read loop): φ_r = frac(φ₂ + I·y₁), y₁ = the read
            const I = (a1 ? sl.pdI[i] : 0) + (a2 ? sl.pdI[U + i] : 0);
            if (I !== 0) sl.y1[i] = readSelf(PHB, YB, sl.y1[i], I, lvD, lvLen, hb, lv, twoLv ? lvOld : lvX, twoLv ? -1 : wX, fa, fb, two, xa, CH);
            else readFull(PHB, YB, YB2, lvD, lvLen, hb, lv, lvOld, twoLv, lvX, wX, fa, fb, two, xa, CH);
            const oe = (a1 && m1 === W_ODDEVEN) || (a2 && m2 === W_ODDEVEN);
            if (oe) {
              for (let s = 0; s < CH; s++) { let q = PHB[s] + 0.5; if (q >= 1) q -= 1; PHC[s] = q; }
              readFull(PHC, X2B, X2C, lvD, lvLen, hb, lv, lvOld, twoLv, lvX, wX, fa, fb, two, xa, CH);
            }
            // stage 5: windows (legacy slot 1, Sync Var) on the read samples, then the O slots
            if (hasWin) for (let s = 0; s < CH; s++) { YB[s] *= WIN[s]; X2B[s] *= WIN[s]; }
            if (hw) for (let s = 0; s < CH; s++) { YB[s] *= WN[s]; X2B[s] *= WN[s]; }
            if (a1 && d1 === WD_O) W.outBlockA(sl, 0, i, m1, WA1, i, var1, M1, ms1, YB, oe ? X2B : null, PHU, CH);
            if (a2 && d2 === WD_O) W.outBlockA(sl, 1, i, m2, WA2, i, var2, M2, ms2, YB, oe ? X2B : null, PHU, CH);
            for (let s = 0; s < CH; s++) {
              const y = YB[s];
              if (cap) RAW[i * MAXCH + s] = y;
              gl += dgl; gr += dgr;
              OL[s] += gl * y; OR[s] += gr * y;
            }
          } else if (m === 0 && !twoLv && !cap && xa < 0) {
            const fs1 = (t1 >= 1 ? fb : fa);
            if (lvX < 0) {
              const bc = two && dt === 0 ? this.bcGet(o, d, fa, fb, t0, len) : null;   // a static position: cached blend
              if (two && bc === null) {
                FA[0] = ph; FA[1] = inc; FA[2] = gl; FA[3] = gr; FA[4] = dgl; FA[5] = dgr; FA[7] = t0; FA[8] = dt;
                plain2(d, fa * len, fb * len, msk, len, OL, OR, CH);
                ph = FA[0];
              } else {
                // plain1 written out here (M4: the most common read of all — whether V8 inlined the call depended on the
                // inlining budget the other paths of this function left; out of line it cost row a ≈ 25 % over Phase 1)
                const D = bc !== null ? bc : d, b = bc !== null ? 0 : fs1 * len;
                for (let s = 0; s < CH; s++) {
                  const x = ph * len, j = x | 0, f = x - j;
                  const xm = D[b + ((j - 1) & msk)], x0 = D[b + (j & msk)], x1 = D[b + ((j + 1) & msk)], x2 = D[b + ((j + 2) & msk)];
                  const y = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
                  gl += dgl; gr += dgr;
                  OL[s] += gl * y; OR[s] += gr * y;
                  ph += inc;
                  if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
                }
              }
            } else {
              const d2 = lvD[hb + lvX], len2 = lvLen[hb + lvX];
              FA[0] = ph; FA[1] = inc; FA[2] = gl; FA[3] = gr; FA[4] = dgl; FA[5] = dgr; FA[6] = wX; FA[7] = t0; FA[8] = dt;
              if (two) plainB2(d, fa * len, fb * len, msk, len, d2, fa * len2, fb * len2, len2 - 1, len2, OL, OR, CH);
              else plainB1(d, fs1 * len, msk, len, d2, fs1 * len2, len2 - 1, len2, OL, OR, CH);
              ph = FA[0];
            }
          } else {
            const mo = mStr ? (i % mN) * mStr : 0;
            const hasWin = m === 2 || m === 3 || m === 11 || m === 19 || m === 20;
            if (m >= 4 && m <= 6) ph = phBend(ph, inc, K, CH);
            else if (m >= 8 && m <= 10) ph = phAsym(ph, inc, K, CH);
            else {
              for (let s = 0; s < CH; s++) {
                const mv = MOD[mo + s];
                PHB[s] = m === 0 ? ph : warpPh(m, ph, K, w, REM, rb, mv);
                if (hasWin) WIN[s] = winF(m, ph, w, mv);
                ph += inc;
                if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
              }
            }
            FA[6] = xt; FA[7] = t0; FA[8] = dt;
            readLv(d, len, fa, fb, two, xa, YB, CH, PHB);
            if (twoLv) {
              readLv(lvD[hb + lvOld], lvLen[hb + lvOld], fa, fb, two, xa, YB2, CH, PHB);
              for (let s = 0; s < CH; s++) { const a = (s + 1) * iC; YB[s] = YB2[s] + (YB[s] - YB2[s]) * a; }
            } else if (lvX >= 0) {
              readLv(lvD[hb + lvX], lvLen[hb + lvX], fa, fb, two, xa, YB2, CH, PHB);
              for (let s = 0; s < CH; s++) YB[s] = YB2[s] + (YB[s] - YB2[s]) * wX;
            }
            for (let s = 0; s < CH; s++) {
              let y = YB[s];
              if (hasWin) y *= WIN[s];
              if (cap) RAW[i * MAXCH + s] = y;
              gl += dgl; gr += dgr;
              OL[s] += gl * y; OR[s] += gr * y;
            }
          }
          uPh[idx] = ph;
        }
        if (cap && !ok) RAW.fill(0, 0, NX * MAXCH);
        return 1;
      }
      // the oscillator context (§11.8) of oscillator o: unison frequencies, gain ramps (gains = 1: note-on), pans, slots,
      // warp modes and amounts, modulators, note values
      fillCtx(sx, o, gains) {
        const ctx = this.ctx[o], eff = this.eff, kB = OKB[o], b16 = o * 16, b = O2B[o];
        let N = this.uN[o];
        if (N < 1) N = 1;
        const ub = (N - 1) * 16, fs = this.fs, fmax = 0.45 * fs, fB = this.fB[o], hz = this.cHz[o];
        this.uniCache(sx, o, N);
        ctx.o = o; ctx.N = N;
        const uw = (2 * eff[kB + D_UNIWARP] - 1) * 0.5, uw2 = (2 * eff[b + K_UNIWARP2] - 1) * 0.5;
        let w1 = eff[kB + D_WARP], w2 = eff[b + K_WARP2], lev = eff[kB + D_LEVEL];
        if (sx.xyOn[o] !== 0) {                                  // Granular X|Y → Level / Warp / Warp 2 (§3.9 XY_MODES)
          const yt = sx.xyY[o], y = eff[b + K_GY];
          if (yt === 1) lev = xyApply(sx.xyMode[o], lev, y);
          else if (yt === 2) w1 = xyApply(sx.xyMode[o], w1, y);
          else w2 = xyApply(sx.xyMode[o], w2, y);
        }
        for (let i = 0; i < N; i++) {
          const t = UT[ub + i];
          let f = fB * this.uRat[b16 + i];
          if (hz !== 0) f += hz;
          ctx.f[i] = f < fmax ? (f > 0.01 ? f : 0.01) : fmax;
          ctx.t[i] = t; ctx.pan[i] = t * eff[kB + D_UNIW];
          const a = w1 + t * uw, c = w2 + t * uw2;
          ctx.w1[i] = a > 0 ? (a < 1 ? a : 1) : 0; ctx.w2[i] = c > 0 ? (c < 1 ? c : 1) : 0;
        }
        if (gains) {
          const on = this.oOn[o] & this.kg[o], gain = on ? lev * lev * this.comp[o] : 0;
          const gL0 = gain * this.bl[o], gR0 = gain * this.br[o], gcn = this.gC[o], gsd = this.gSd[o], iC = 1 / this.CH;
          const fresh = this.fresh;
          // slots ≥ N ramp their gains to 0 over one chunk; beyond uHi (no slot ≥ N held a gain or a ramp last chunk)
          // they and their ctx entries are already 0 — the loop stops there (M4: 16 slots per oscillator per chunk)
          let M = this.uHi[o], tail = 0;
          if (M < N) M = N;
          this.gz[o] = 1;
          for (let i = 0; i < M; i++) {
            const idx = b16 + i, live = i < N;
            const gi = N <= 2 || U_CENTER[ub + i] ? gcn : gsd;
            const GLt = live ? gL0 * gi * this.uPL[idx] : 0, GRt = live ? gR0 * gi * this.uPR[idx] : 0;
            const gl = fresh ? GLt : this.uGL[idx], gr = fresh ? GRt : this.uGR[idx];
            this.uGL[idx] = GLt; this.uGR[idx] = GRt;
            ctx.gl[i] = gl; ctx.gr[i] = gr; ctx.dgl[i] = (GLt - gl) * iC; ctx.dgr[i] = (GRt - gr) * iC;
            if (!live && (gl !== 0 || gr !== 0)) tail = 1;
          }
          this.uHi[o] = tail !== 0 ? M : N;
        }
        ctx.mode1 = this.md[2 * o]; ctx.mode2 = this.md[2 * o + 1];
        ctx.var1 = this.lvar[o] >= 0 ? this.lvar[o] : eff[b + K_WVAR1]; ctx.var2 = eff[b + K_WVAR2];
        ctx.fm1 = sx.fmType[2 * o]; ctx.fm2 = sx.fmType[2 * o + 1];
        ctx.mod1 = this.mA[2 * o]; ctx.mod2 = this.mA[2 * o + 1]; ctx.modStride1 = this.mS[2 * o]; ctx.modStride2 = this.mS[2 * o + 1];
        ctx.eff = eff; ctx.cp = sx.cp; ctx.sx = sx; ctx.gate = this.gate ? 1 : 0; ctx.fresh = this.fresh; ctx.CH = this.CH;
        ctx.fs = this.fs; ctx.base = this.base; ctx.bpm = this.proc.bpm > 0 ? +this.proc.bpm : 120;
        ctx.keyRef = eff[OTRK[o]] >= 0.5 ? this.noteOf(sx, o) : 60; ctx.rootShift = 0;
        ctx.key = this.note + this.dk[o]; ctx.vel = this.vel;
      }
      // a Sample / Multisample / Granular / Spectral oscillator (§11.8): its context, then its render (overwrites OL/OR)
      renderType(sx, o, OL, OR) {
        const x = this.ox[o], CH = this.CH, b16 = o * 16;
        const on = this.oOn[o] & this.kg[o], cap = this.oCap[o];
        if (!on && !cap) {
          let any = this.gz[o];
          if (any !== 0) {
            any = 0;
            for (let i = 0; i < 16; i++) if (this.uGL[b16 + i] !== 0 || this.uGR[b16 + i] !== 0) { any = 1; break; }
            if (!any) this.gz[o] = 0;
          }
          if (!any) return 0;                                    // (act 0: OL / OR are not read)
        }
        this.uNx[o] = 0;
        this.fillCtx(sx, o, 1);
        x.render(this.ctx[o], OL, OR, cap ? RAWS[o] : null);
        return 1;
      }

      /* ---- mixer, filters, channel gains (§1, §6.12, §6.13) ---- */
      mixOut(sx, o0) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH, fresh = this.fresh, act = this.act, RT = sx.route, E = sx.envOn;
        const f1On = eff[F_ON] >= 0.5 ? 1 : 0, f2On = this.filt2 !== null && eff[F2_ON] >= 0.5 ? 1 : 0;
        const rg1 = this.rg1, rg2 = this.rg2, hb1 = this.hb1, hb2 = this.hb2, nX = (sx.use & 1) !== 0 ? 5 : 4;
        // (a) filter-routed sources: switch-gated, ramped inputs u_k and the source sums S_k (v_k = S_k − u_k), in the
        // order A, B, Noise, Sub, C; the F1 share s1 = (1 − b)/2, the F2 share s2 = (1 + b)/2 of the balance b
        let u1 = 0, u2 = 0, useF1 = 0, useF2 = 0;
        for (let j = 0; j < nX; j++) {
          const c = CHX[j], toF = RT[c] === 0;
          const t1 = toF && f1On && eff[F1SW[c]] >= 0.5 ? 1 : 0, t2 = toF && f2On && eff[F2SW[c]] >= 0.5 ? 1 : 0;
          const r1 = fresh ? t1 : rg1[c], r2 = fresh ? t2 : rg2[c];
          rg1[c] = t1; rg2[c] = t2;
          if (t1 !== 0 || r1 !== 0) useF1 = 1;
          if (t2 !== 0 || r2 !== 0) useF2 = 1;
          // the balance shares are ramped from the previous chunk's (bal 0: exactly 1 / 0, the Phase-1 path)
          const bal = eff[FBAL[c]], h1 = bal === 0 ? 1 : 1 - bal, h2 = bal === 0 ? 0 : bal;
          const q1 = fresh ? h1 : hb1[c], q2 = fresh ? h2 : hb2[c];
          hb1[c] = h1; hb2[c] = h2;
          if (!toF || act[c] === 0) continue;
          if (h1 !== 0 || q1 !== 0) {
            if (u1 === 0) { zero4(U1L, U1R, S1L, S1R, CH); u1 = 1; }
            addSrcR(XLS[c], XRS[c], q1, (h1 - q1) * iC, r1, (t1 - r1) * iC, U1L, U1R, S1L, S1R, CH);
          }
          if (h2 !== 0 || q2 !== 0) {
            if (u2 === 0) { zero4(U2L, U2R, S2L, S2R, CH); u2 = 1; }
            addSrcR(XLS[c], XRS[c], q2, (h2 - q2) * iC, r2, (t2 - r2) * iC, U2L, U2R, S2L, S2R, CH);
          }
        }
        // (b) the filters in the §1 order (F2 first when it feeds F1 and F1 does not feed F2)
        this.fo = 0;                                             // bit k: filter k+1 produced an output this chunk
        const fu = this.fu;                                      // [u1 content, u2 content, F1 runs, F2 runs]
        fu[0] = u1; fu[1] = u2; fu[2] = useF1; fu[3] = useF2;
        if (RT[6] === 0 && RT[5] !== 0) { this.filter2(sx); this.filter1(sx); }
        else { this.filter1(sx); this.filter2(sx); }
        // (c) output groups: Main (A, B, C, Noise, Sub, F1, F2), Direct (Sub, Noise, A, B, C, F1, F2), bus sends; group
        // g = 2·{main 0, direct 1, bus1 2, bus2 3} + (ENV toggle off ? 1 : 0)
        GU[0] = 0; GU[1] = 0; GU[2] = 0; GU[3] = 0; GU[4] = 0; GU[5] = 0; GU[6] = 0; GU[7] = 0;   // (M4: not fill(), a call per chunk)
        for (let c = 0; c < 5; c++) {                            // channel order A, B, C, Noise, Sub (act: rendered)
          if (act[c] === 0 || RT[c] !== 1) continue;
          const g = E[c] ? 0 : 1;
          addG(GB[2 * g], GB[2 * g + 1], XLS[c], XRS[c], 1, GU[g] === 0, CH); GU[g] = 1;
        }
        // filter levels L_k, ramped from the previous chunk's (n 0.5: exactly 1, the Phase-1 path)
        const fo = this.fo, L1 = eff[F_LEVEL] === 0.5 ? 1 : 4 * eff[F_LEVEL] * eff[F_LEVEL];
        const L2 = eff[F2_LEVEL] === 0.5 ? 1 : 4 * eff[F2_LEVEL] * eff[F2_LEVEL];
        const lvP = this.lvP, P1 = fresh ? L1 : lvP[0], P2 = fresh ? L2 : lvP[1], dL1 = (L1 - P1) * iC, dL2 = (L2 - P2) * iC;
        lvP[0] = L1; lvP[1] = L2;
        if ((fo & 1) !== 0 && RT[5] === 1) { const g = E[5] ? 0 : 1; addGR(GB[2 * g], GB[2 * g + 1], Y1L, Y1R, P1, dL1, GU[g] === 0, CH); GU[g] = 1; }
        if ((fo & 2) !== 0 && RT[6] === 1) { const g = E[6] ? 0 : 1; addGR(GB[2 * g], GB[2 * g + 1], Y2L, Y2R, P2, dL2, GU[g] === 0, CH); GU[g] = 1; }
        if (sx.anyDir !== 0) {
          for (let j = 0; j < 5; j++) {
            const c = DIRX[j];
            if (act[c] === 0 || RT[c] !== 2) continue;
            const g = E[c] ? 2 : 3;
            addG(GB[2 * g], GB[2 * g + 1], XLS[c], XRS[c], 1, GU[g] === 0, CH); GU[g] = 1;
          }
          if ((fo & 1) !== 0 && RT[5] === 2) { const g = E[5] ? 2 : 3; addGR(GB[2 * g], GB[2 * g + 1], Y1L, Y1R, P1, dL1, GU[g] === 0, CH); GU[g] = 1; }
          if ((fo & 2) !== 0 && RT[6] === 2) { const g = E[6] ? 2 : 3; addGR(GB[2 * g], GB[2 * g + 1], Y2L, Y2R, P2, dL2, GU[g] === 0, CH); GU[g] = 1; }
        }
        if (sx.anyBus !== 0) {                                   // bus sends: post level/pan, (n)² of the send knob
          const sgP = this.sgP;                                  // (each send gain ramped from the previous chunk's)
          for (let c = 0; c < 7; c++) {
            let XL, XR, gl = 1, grp, has;
            if (c < 5) { has = act[c] !== 0; XL = XLS[c]; XR = XRS[c]; grp = RT[c] === 0 ? 1 : E[c]; }
            else if (c === 5) { has = (fo & 1) !== 0; XL = Y1L; XR = Y1R; gl = L1; grp = RT[5] === 0 ? 1 : E[5]; }
            else { has = (fo & 2) !== 0; XL = Y2L; XR = Y2R; gl = L2; grp = RT[6] === 0 ? 1 : E[6]; }
            for (let k = 0; k < 2; k++) {
              const n = eff[BUS1V[c] + k], T = n > 0 ? gl * n * n : 0, j = 2 * c + k, P = fresh ? T : sgP[j];
              sgP[j] = T;
              if (!has || (T === 0 && P === 0)) continue;
              const g = 4 + 2 * k + (grp ? 0 : 1);
              addGR(GB[2 * g], GB[2 * g + 1], XL, XR, P, (T - P) * iC, GU[g] === 0, CH); GU[g] = 1;
            }
          }
        }
        // (d) channel gains: AMP·ENV 1 (toggle on) / AMP (off), ramped per sample from the previous chunk's targets
        const ga = eff[G_AMP], fd = this.fadeK > 0 ? (this.fadeN - 1) / this.fadeK : 1;
        const ampT = this.eV[0] * ga * ga * fd, amp = this.gAmp, dAmp = (ampT - amp) * iC;
        this.gAmp = ampT;
        const ampNT = ga * ga * fd, ampN = this.gAmpN, dAmpN = (ampNT - ampN) * iC;
        this.gAmpN = ampNT;
        this.noEnv = GU[1] | GU[3] | GU[5] | GU[7];
        const OL = this.oL, OR = this.oR;
        if (GU[0]) addAmp(OL, OR, o0, GB[0], GB[1], amp, dAmp, CH);
        if (GU[1]) addAmp(OL, OR, o0, GB[2], GB[3], ampN, dAmpN, CH);
        if (GU[2]) addAmp(this.oDL, this.oDR, o0, GB[4], GB[5], amp, dAmp, CH);
        if (GU[3]) addAmp(this.oDL, this.oDR, o0, GB[6], GB[7], ampN, dAmpN, CH);
        if (GU[4]) addAmp(this.oB1L, this.oB1R, o0, GB[8], GB[9], amp, dAmp, CH);
        if (GU[5]) addAmp(this.oB1L, this.oB1R, o0, GB[10], GB[11], ampN, dAmpN, CH);
        if (GU[6]) addAmp(this.oB2L, this.oB2R, o0, GB[12], GB[13], amp, dAmp, CH);
        if (GU[7]) addAmp(this.oB2L, this.oB2R, o0, GB[14], GB[15], ampN, dAmpN, CH);
        // (e) taps: filter outputs for Filter-sourced warps (§6.6.7), audio-tap sources (§5.3), channel meters (§6.20)
        // (fPrev of §6.6.7 is kept current in every chunk, whether or not a slot reads it now: a slot that selects
        // Filter k later, or filter k switched back on, reads the previous chunk, never an old one; zeros while off)
        // (no WARPS2 slot can exist in S1 mode without OSC C and slot 2, use & 5: the buffers then just hold zeros)
        {
          const p1 = this.fp1, p2 = this.fp2, any = sx.s1 === 0 || (sx.use & 5) !== 0;
          if (any && (fo & 1) !== 0 && f1On !== 0) { for (let s = 0; s < CH; s++) p1[s] = 0.5 * (Y1L[s] + Y1R[s]); this.fpZ &= 2; }
          else if ((this.fpZ & 1) === 0) { p1.fill(0); this.fpZ |= 1; }
          if (any && (fo & 2) !== 0 && f2On !== 0) { for (let s = 0; s < CH; s++) p2[s] = 0.5 * (Y2L[s] + Y2R[s]); this.fpZ &= 1; }
          else if ((this.fpZ & 2) === 0) { p2.fill(0); this.fpZ |= 2; }
        }
        const su = sx.srcU;
        {
          const src = this.src, l = CH - 1, on = this.oOn;
          for (let o = 0; o < N_OSC; o++) {
            if (su[S_OSCA + o] === 0) continue;
            const N = this.uN[o] > 0 ? this.uN[o] : 1, RAW = RAWS[o];
            let m = 0;                                           // a switched-off oscillator reads 0, like the sub
            if (act[o] !== 0 && on[o] !== 0) { for (let i = 0; i < N; i++) m += RAW[i * MAXCH + l]; m /= N; }
            src[S_OSCA + o] = m;
          }
          if (su[S_SUB] !== 0) src[S_SUB] = SRAW[l];
          if (su[S_FILT1] !== 0) src[S_FILT1] = (fo & 1) !== 0 ? 0.5 * (Y1L[l] + Y1R[l]) : 0;
          if (su[S_FILT1 + 1] !== 0) src[S_FILT1 + 1] = (fo & 2) !== 0 ? 0.5 * (Y2L[l] + Y2R[l]) : 0;
        }
        if (sx.mon !== 0 && this.hid === 0) {                  // (hidden warm-up voices never reach the meters)
          const pk = sx.pk;
          for (let c = 0; c < 5; c++) if (act[c] !== 0) { const p = peak2(XLS[c], XRS[c], CH); if (p > pk[c]) pk[c] = p; }
          if ((fo & 1) !== 0) { const p = L1 * peak2(Y1L, Y1R, CH); if (p > pk[5]) pk[5] = p; }
          if ((fo & 2) !== 0) { const p = L2 * peak2(Y2L, Y2R, CH); if (p > pk[6]) pk[6] = p; }
        }
      }
      // cutoff n of filter k with the Voice Control offset (§6.13.2), key tracking (§6.13.6), pan split
      fcOf(sx, cutN, k) {
        let n = cutN;
        if (sx.vcOn !== 0 && this.vcC !== 0) { n += this.vcC; n = n > 0 ? (n < 1 ? n : 1) : 0; }
        let fc = MIDI0 * exp2(FC_L2 * n);
        if (sx.fKey[k] !== 0) {
          let ref;
          if (sx.s1 !== 0) ref = this.mod.nP;                       // S1: the gliding voice pitch (Phase 1)
          else {                                                  // S2: note' of the first tracking, sounding oscillator
            ref = this.note;                                      // (none: the played key, tuned, without glide)
            if (sx.tuned !== 0) { const n = ref | 0, k = sx.tune[n >= 0 ? (n <= 127 ? n : 127) : 0]; if (k === k) ref = k; }
            const eff = this.eff, on = this.oOn;
            for (let o = 0; o < N_OSC; o++) if (on[o] !== 0 && eff[OTRK[o]] >= 0.5) { ref = this.noteOf(sx, o); break; }
          }
          fc *= exp2((ref - 60) / 12);
        }
        return fc;
      }
      // Filter 1: inputs u1 (+ Filter 2 when it feeds Filter 1), output Y1 = v1 + (u1 + mix·(F(u1) − u1)) (post mix, pre
      // level; the Phase-1 arithmetic form), routed by mixOut; into Filter 2 when routed there
      filter1(sx) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH, filt = this.filt, u1 = this.fu[0], useF = this.fu[2];
        let fType;
        if (sx.s1) { fType = round(95 * eff[F_TYPE]); fType = fType > 0 ? (fType < 95 ? fType : 95) : 0; }
        else { fType = round(107 * eff[F_TYPE2]); fType = fType > 0 ? (fType < 107 ? fType : 107) : 0; }
        const mixT = fType === 80 ? 1 : eff[F_MIX];
        if (this.fresh) this.mixP = mixT;
        let mix = this.mixP;
        const dMix = (mixT - mix) * iC;
        this.mixP = mixT;
        if (u1 === 0 && !useF) { this.fIdle = 1; return; }
        if (u1 === 0) zero4(U1L, U1R, S1L, S1R, CH);
        if (useF) {
          if (this.fIdle) { filt.reset(); this.fIdle = 0; }
          if (fType !== filt.type) filt.setType(fType);
          const fc = this.fcOf(sx, eff[F_CUTOFF], 0);
          const sp = exp2((0.5 - eff[F_PAN]) * 3);
          filt.set(fc * sp, fc / sp, eff[F_RES], eff[F_DRIVE], eff[F_VAR]);
          if (fType === 103) { filt.setXY(eff[F_X], eff[F_X + 1]); filt.setPZ(sx.pz, 0); }
          filt.setClean(sx.fClean[0]);
          for (let s = 0; s < CH; s++) { W1L[s] = U1L[s]; W1R[s] = U1R[s]; }
          filt.process(W1L, W1R, 0, CH);
          if (sx.mon && sx.mod.recent === this) {
            let w = sx.tapW;
            const tap = sx.tap;
            for (let s = 0; s < CH; s++) { tap[w] = 0.5 * (W1L[s] + W1R[s]); w = (w + 1) & (TAP_N - 1); }
            sx.tapW = w;
          }
          for (let s = 0; s < CH; s++) {
            mix += dMix;
            const ul = U1L[s], ur = U1R[s];
            Y1L[s] = (S1L[s] - ul) + (ul + mix * (W1L[s] - ul)); Y1R[s] = (S1R[s] - ur) + (ur + mix * (W1R[s] - ur));
          }
        } else {
          this.fIdle = 1;
          for (let s = 0; s < CH; s++) { Y1L[s] = S1L[s] - U1L[s]; Y1R[s] = S1R[s] - U1R[s]; }
        }
        this.fo |= 1;
        if (sx.route[5] === 0) this.feed(sx, 1, Y1L, Y1R, eff[F_LEVEL]);
      }
      filter2(sx) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH, filt = this.filt2, u2 = this.fu[1];
        let useF = this.fu[3];
        let fType = round(107 * eff[F2_TYPE]);
        fType = fType > 0 ? (fType < 107 ? fType : 107) : 0;
        const mixT = fType === 80 ? 1 : eff[F2_MIX];
        if (this.fresh) this.mixP2 = mixT;
        let mix = this.mixP2;
        const dMix = (mixT - mix) * iC;
        this.mixP2 = mixT;
        if ((u2 === 0 && !useF) || filt === null) { this.fIdle2 = 1; if (u2 === 0) return; useF = 0; }
        if (u2 === 0) zero4(U2L, U2R, S2L, S2R, CH);
        if (useF) {
          if (this.fIdle2) { filt.reset(); this.fIdle2 = 0; }
          if (fType !== filt.type) filt.setType(fType);
          const fc = this.fcOf(sx, eff[F2_CUTOFF], 1);
          const sp = exp2((0.5 - eff[F2_PAN]) * 3);
          filt.set(fc * sp, fc / sp, eff[F2_RES], eff[F2_DRIVE], eff[F2_VAR]);
          if (fType === 103) { filt.setXY(eff[F2_X], eff[F2_X + 1]); filt.setPZ(sx.pz, 12); }
          filt.setClean(sx.fClean[1]);
          for (let s = 0; s < CH; s++) { W2L[s] = U2L[s]; W2R[s] = U2R[s]; }
          filt.process(W2L, W2R, 0, CH);
          if (sx.mon && sx.mod.recent === this) {
            let w = sx.tapW2;
            const tap = sx.tap2;
            for (let s = 0; s < CH; s++) { tap[w] = 0.5 * (W2L[s] + W2R[s]); w = (w + 1) & (TAP_N - 1); }
            sx.tapW2 = w;
          }
          for (let s = 0; s < CH; s++) {
            mix += dMix;
            const ul = U2L[s], ur = U2R[s];
            Y2L[s] = (S2L[s] - ul) + (ul + mix * (W2L[s] - ul)); Y2R[s] = (S2R[s] - ur) + (ur + mix * (W2R[s] - ur));
          }
        } else {
          this.fIdle2 = 1;
          for (let s = 0; s < CH; s++) { Y2L[s] = S2L[s] - U2L[s]; Y2R[s] = S2R[s] - U2R[s]; }
        }
        this.fo |= 2;
        if (sx.route[6] === 0) this.feed(sx, 0, Y2L, Y2R, eff[F2_LEVEL]);
      }
      // filter output (× its level) into the other filter k: its input (ramped by that filter's on state) and source sum
      feed(sx, k, YL, YR, lvN) {
        const CH = this.CH, iC = 1 / CH, g = lvN === 0.5 ? 1 : 4 * lvN * lvN, g0 = this.fresh ? g : this.fdP[k];
        this.fdP[k] = g;                                         // (the level ramped from the previous chunk's)
        const on = k === 0 ? this.eff[F_ON] >= 0.5 : this.filt2 !== null && this.eff[F2_ON] >= 0.5, t = on ? 1 : 0;
        const r0 = this.fresh ? t : this.rgF[k];
        this.rgF[k] = t;
        const UL = k === 0 ? U1L : U2L, UR = k === 0 ? U1R : U2R, SLs = k === 0 ? S1L : S2L, SRs = k === 0 ? S1R : S2R;
        // (the other filter runs after this one; its input arrays start here when no source feeds it)
        const fu = this.fu;
        if (fu[k] === 0) { zero4(UL, UR, SLs, SRs, CH); fu[k] = 1; }
        if (t !== 0 || r0 !== 0) fu[2 + k] = 1;
        addSrcR(YL, YR, g0, (g - g0) * iC, r0, (t - r0) * iC, UL, UR, SLs, SRs, CH);
      }

      resolveSub(shape, set) {
        if (shape === this.sShape && set === this.sSet && this.sEp === epoch) return;
        this.sShape = shape; this.sSet = set; this.sEp = epoch;
        const e = tables.get(set ? SUB_IDS2[shape] : SUB_IDS[shape]);
        if (!e || e.kind !== 'wt' || !e.levels) { this.sOk = 0; return; }
        this.sOk = 1;
        for (let l = 0; l < 11; l++) {
          const lv = e.levels[l];
          this.sD[l] = lv.data; this.sLen[l] = lv.len; this.sHarm[l] = lv.harm > 0 ? +lv.harm : MIP_HARM[l];
        }
      }
      // SUB (§6.3, §6.6, §6.11.1): mono, level n (S1) / n² (S2), equal-power pan; raw output in SRAW
      renderSub(sx, on) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH, s1 = sx.s1;
        let shape;
        if (s1) { shape = round(4 * eff[S_SHAPE]); shape = shape > 0 ? (shape < 4 ? shape : 4) : 0; }
        else { shape = round(5 * eff[S_SHP]); shape = shape > 0 ? (shape < 5 ? shape : 5) : 0; }
        this.resolveSub(shape, s1 ? 0 : 1);
        let pan = 2 * eff[S_PAN] - 1;
        if (sx.vcOn !== 0 && sx.vcSel[4] !== 0 && this.vcP !== 0) { pan += this.vcP; pan = pan > -1 ? (pan < 1 ? pan : 1) : -1; }
        if (pan !== this.sPan) { this.sPan = pan; this.sCl = panG(pan, 0); this.sCr = panG(pan, 1); }
        const lv = eff[S_LEVEL], g = on ? (s1 ? lv : lv * lv) : 0, GLt = g * this.sCl, GRt = g * this.sCr;
        let gl = this.fresh ? GLt : this.sGL, gr = this.fresh ? GRt : this.sGR;
        const dgl = (GLt - gl) * iC, dgr = (GRt - gr) * iC;
        this.sGL = GLt; this.sGR = GRt;
        if (!this.sOk) return 0;
        const nt = eff[S_TRACK] >= 0.5 ? this.noteOf(sx, 4) : 0;
        let P = nt + 12 * round(8 * eff[S_OCT] - 4);
        if (!s1) { const c = eff[S_CRS]; if (c !== 0.5) P += 128 * c - 64; }
        P = P + this.pBend + this.pTune;
        if (this.pMpe !== 0) P += this.pMpe;
        if (this.pDet !== 0 && sx.vcSel[4] !== 0) P += this.pDet;
        let f = sx.a4 * exp2((P - 69) / 12);
        const fmax = 0.45 * this.fs;
        f = f < fmax ? (f > 0.01 ? f : 0.01) : fmax;
        const inc = f / this.fs, lvOld = this.sLv;
        let lv2, two, wX = 1, l2 = lvOld;
        if (this.xf) { lv2 = selBlend(this.flim / f, this.sHarm, 0); two = bLvB >= 0; l2 = bLvB; wX = bW; }
        else { lv2 = selLevel(lvOld, this.flim / f, this.sHarm, 0, this.m0); two = lvOld >= 0 && lvOld !== lv2; }
        this.sLv = lv2;
        const d = this.sD[lv2], len = this.sLen[lv2], m = len - 1;
        const d2 = two ? this.sD[l2] : d, len2 = two ? this.sLen[l2] : len, m2 = len2 - 1, xfd = this.xf;
        let ph = this.sPh;
        for (let s = 0; s < CH; s++) {
          const x = ph * len, i = x | 0;
          let y = hermAt(d, 0, m, i, x - i);
          if (two) { const x2 = ph * len2, i2 = x2 | 0, y2 = hermAt(d2, 0, m2, i2, x2 - i2); y = y2 + (y - y2) * (xfd ? wX : (s + 1) * iC); }
          SRAW[s] = y;
          gl += dgl; gr += dgr;
          SL[s] = gl * y; SR[s] = gr * y;
          ph += inc;
          if (ph >= 1) ph -= 1;
        }
        this.sPh = ph;
        return 1;
      }
      resolveNoise(sx) {
        const id = sx.noiseColor >= 0 ? '' : sx.noiseId;
        if (id === this.nId && this.nEp === epoch) return;
        this.nId = id; this.nEp = epoch;
        const e = id !== '' ? tables.get(id) : undefined;
        if (!e || e.kind !== 'noise' || !e.levels) { this.nOk = 0; this.nLen0 = 0; return; }
        this.nOk = 1;
        this.nRate = +e.rate; this.nRoot = e.root !== undefined ? +e.root : 60;
        let nl = e.levels.length;
        nl = nl < 6 ? nl : 6;
        this.nLevels = nl;
        for (let l = 0; l < nl; l++) {
          const lv = e.levels[l];
          this.nLvL[l] = lv.L; this.nLvR[l] = lv.R ? lv.R : lv.L; this.nLen[l] = lv.len;
          const ls = lv.loopStart !== undefined ? +lv.loopStart : (l === 0 && e.loopStart !== undefined ? +e.loopStart : 0);
          const le = lv.loopEnd !== undefined ? +lv.loopEnd : (l === 0 && e.loopEnd !== undefined ? +e.loopEnd : lv.len);
          this.nLs[l] = ls >= 0 && ls < lv.len ? ls : 0;
          this.nLe[l] = le > this.nLs[l] && le <= lv.len ? le : lv.len;
        }
        this.nLen0 = this.nLen[0];
        this.nLv = -1;
      }
      noisePan(sx) {
        let pan = 2 * this.eff[N_PAN] - 1;
        if (sx.vcOn !== 0 && sx.vcSel[3] !== 0 && this.vcP !== 0) { pan += this.vcP; pan = pan > -1 ? (pan < 1 ? pan : 1) : -1; }
        if (pan !== this.nPan) { this.nPan = pan; this.nCl = panG(pan, 0); this.nCr = panG(pan, 1); }
      }
      // NOISE (§6.8): stereo sample player, level chosen by the read increment; raw mono average in NRAW
      renderNoise(sx, on) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH;
        this.resolveNoise(sx);
        this.noisePan(sx);
        const lev = eff[N_LEVEL], g = on ? lev * lev : 0, GLt = g * this.nCl, GRt = g * this.nCr;
        let gl = this.fresh ? GLt : this.nGL, gr = this.fresh ? GRt : this.nGR;
        const dgl = (GLt - gl) * iC, dgr = (GRt - gr) * iC;
        this.nGL = GLt; this.nGR = GRt;
        if (!this.nOk) return 0;
        const key = sx.noiseKey, pst = npitch(eff[N_PITCH]);
        let semis = pst;
        if (key) {
          semis = round(pst) + (this.noteOf(sx, 3) - this.nRoot) + (2 * eff[N_FINE] - 1) + this.pBend;
          if (this.pMpe !== 0) semis += this.pMpe;
        }
        if (this.pDet !== 0 && sx.vcSel[3] !== 0) semis += this.pDet;
        const inc0 = this.nRate / this.fs * exp2(semis / 12);
        let lv = 0, r = inc0;
        while (r > 1 && lv < this.nLevels - 1) { r *= 0.5; lv++; }
        const lvOld = this.nLv < 0 ? lv : this.nLv;
        this.nLv = lv;
        const len0 = this.nLen0, nOff = eff[N_PHASE] * len0, dP = (nOff - this.nOffP) * iC;
        this.nOffP = nOff;
        const loop = sx.noiseOneshot ? 0 : 1, ls0 = this.nLs[0], le0 = this.nLe[0], L0 = le0 - ls0;
        const sc1 = 1 / (1 << lv), sc2 = 1 / (1 << lvOld), two = lvOld !== lv;
        const AL1 = this.nLvL[lv], AR1 = this.nLvR[lv], ls1 = this.nLs[lv], le1 = this.nLe[lv], n1 = this.nLen[lv];
        const AL2 = this.nLvL[lvOld], AR2 = this.nLvR[lvOld], ls2 = this.nLs[lvOld], le2 = this.nLe[lvOld], n2 = this.nLen[lvOld];
        let pos = this.nPos;
        for (let s = 0; s < CH; s++) {
          let yl = 0, yr = 0;
          if (!this.nDone) {
            const p1 = pos * sc1, lp1 = loop && p1 >= ls1 ? 1 : 0;
            yl = nzRead(AL1, p1, ls1, le1, n1, lp1); yr = AR1 === AL1 ? yl : nzRead(AR1, p1, ls1, le1, n1, lp1);
            if (two) {
              const p2 = pos * sc2, lp2 = loop && p2 >= ls2 ? 1 : 0, a = (s + 1) * iC;
              const zl = nzRead(AL2, p2, ls2, le2, n2, lp2), zr = AR2 === AL2 ? zl : nzRead(AR2, p2, ls2, le2, n2, lp2);
              yl = zl + (yl - zl) * a; yr = zr + (yr - zr) * a;
            }
            pos += inc0 + dP;
            if (loop) {
              if (pos >= le0 && L0 > 0) pos -= L0 * (1 + floor((pos - le0) / L0));
              else if (pos < 0) pos = L0 > 0 ? le0 + (pos % L0) : 0;
            } else if (pos >= len0) this.nDone = 1;
          }
          NRAW[s] = 0.5 * (yl + yr);
          gl += dgl; gr += dgr;
          NL[s] = gl * yl; NR[s] = gr * yr;
        }
        this.nPos = pos;
        this.nLast = NRAW[CH - 1];
        return 1;
      }
      // colour noises (§6.11.2): two white streams a, b (xorshift, seeded from r2 at note-on through fmix32); Pink
      // (Kellet's refined filter), Brown (leaky integrator, rate-independent: leak and input gain scaled by base/fs, so
      // the literal recipe at OS 1 and the same corner and spectrum at every OS), Geiger (Poisson clicks at
      // 40·2^(PITCH/12)/s, τ 0.15 ms, each ±(0.5 + 0.5u) with the sign and u from two further draws of the stream);
      // STEREO decorrelation, FILTER tilt (one-pole LP above / HP below the centre). Levels: −12 dBFS RMS in the audible
      // band at every OS (white × √OS on the audio outputs only); Geiger × one gain per rate that puts 40 clicks/s
      // (PITCH 0) at −12 dBFS RMS, so the click size does not depend on PITCH (the RMS follows the click rate). The raw
      // mono NRAW (Noise modulator of the warps, the `noise` source) keeps the per-sample calibration: OS-independent
      renderColor(sx, on) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH, kind = sx.noiseColor, cs = this.cs, ct = this.ct;
        this.noisePan(sx);
        const lev = eff[N_LEVEL], g = on ? lev * lev : 0, GLt = g * this.nCl, GRt = g * this.nCr;
        let gl = this.fresh ? GLt : this.nGL, gr = this.fresh ? GRt : this.nGR;
        const dgl = (GLt - gl) * iC, dgr = (GRt - gr) * iC;
        this.nGL = GLt; this.nGR = GRt;
        const st = eff[N_STEREO], c = 2 * eff[N_COLOR] - 1, fs = this.fs;
        const wa = 1 - st, nrm = st === 0 ? 1 : 1 / sqrt(wa * wa + st * st);
        let tc = 0, hp = 0;
        if (c > 0) { let fc = 20000 * exp2(-9 * c); if (fc > 0.45 * fs) fc = 0.45 * fs; tc = 1 - exp(-2 * PI * fc / fs); }
        else if (c < 0) { let fc = 20 * exp2(-9 * c); if (fc > 0.45 * fs) fc = 0.45 * fs; tc = 1 - exp(-2 * PI * fc / fs); hp = 1; }
        let pg = 0, dec = 0, kG = 1;
        if (kind === 3) {
          pg = 40 * exp2(npitch(eff[N_PITCH]) / 12) / fs; dec = exp(-1 / (0.00015 * fs));
          kG = K_GEIGER / sqrt(40 / fs * (7 / 12) / (1 - dec * dec));   // E[(0.5 + 0.5u)²] = 7/12
        }
        const r = this.base / fs, bc = 1 - 0.002 * r, bg = 0.0414 * sqrt(r), ow = kind === 0 ? sqrt(fs / this.base) : 1;
        let ra = this.ca, rb = this.cb, t0 = ct[0], t1 = ct[1];
        for (let s = 0; s < CH; s++) {
          let a, b = 0;
          ra = xorshift(ra) || 1;
          const wA = ra / 2147483648 - 1;
          if (kind === 0) a = wA * K_WHITE;
          else if (kind === 1) a = this.pink(cs, 0, wA);
          else if (kind === 2) { const y = bc * cs[7] + bg * wA; cs[7] = y; a = K_BROWN * y; }
          else {
            let e = cs[8] * dec;
            if (ra / 4294967296 < pg) {
              ra = xorshift(ra) || 1; const sg = ra < 2147483648 ? -1 : 1;
              ra = xorshift(ra) || 1; e += sg * (0.5 + 0.5 * (ra / 4294967296));
            }
            cs[8] = e; a = kG * e;
          }
          if (st !== 0) {
            rb = xorshift(rb) || 1;
            const wB = rb / 2147483648 - 1;
            if (kind === 0) b = wB * K_WHITE;
            else if (kind === 1) b = this.pink(cs, 10, wB);
            else if (kind === 2) { const y = bc * cs[17] + bg * wB; cs[17] = y; b = K_BROWN * y; }
            else {
              let e = cs[18] * dec;
              if (rb / 4294967296 < pg) {
                rb = xorshift(rb) || 1; const sg = rb < 2147483648 ? -1 : 1;
                rb = xorshift(rb) || 1; e += sg * (0.5 + 0.5 * (rb / 4294967296));
              }
              cs[18] = e; b = kG * e;
            }
          }
          let yl = a, yr = st === 0 ? a : (wa * a + st * b) * nrm;
          if (tc !== 0) {
            t0 += (yl - t0) * tc; t1 += (yr - t1) * tc;
            if (hp) { yl -= t0; yr -= t1; } else { yl = t0; yr = t1; }
          }
          NRAW[s] = 0.5 * (yl + yr);
          gl += dgl; gr += dgr;
          NL[s] = gl * ow * yl; NR[s] = gr * ow * yr;
        }
        for (let j = 0; j < 20; j++) { const v = cs[j]; if (v < 1e-30 && v > -1e-30) cs[j] = 0; }
        if (t0 < 1e-30 && t0 > -1e-30) t0 = 0;
        if (t1 < 1e-30 && t1 > -1e-30) t1 = 0;
        this.ca = ra; this.cb = rb; ct[0] = t0; ct[1] = t1;
        this.nLast = NRAW[CH - 1];
        return 1;
      }
      // Paul Kellet's refined pink filter on white w, state cs[o … o+6], × the −12 dBFS RMS calibration
      pink(cs, o, w) {
        const b0 = 0.99886 * cs[o] + w * 0.0555179, b1 = 0.99332 * cs[o + 1] + w * 0.0750759, b2 = 0.96900 * cs[o + 2] + w * 0.1538520;
        const b3 = 0.86650 * cs[o + 3] + w * 0.3104856, b4 = 0.55000 * cs[o + 4] + w * 0.5329522, b5 = -0.7616 * cs[o + 5] - w * 0.0168980;
        const y = b0 + b1 + b2 + b3 + b4 + b5 + cs[o + 6] + w * 0.5362;
        cs[o] = b0; cs[o + 1] = b1; cs[o + 2] = b2; cs[o + 3] = b3; cs[o + 4] = b4; cs[o + 5] = b5; cs[o + 6] = w * 0.115926;
        return y * K_PINK;
      }
    }

    /* ------------------------------------------------------------ renderWarp (§8.4.2) */
    // one cycle of frame (Float32Array 2048) through warp mode at amount amt, Hermite reads of level 0
    function renderWarp(frame, mode, amt, opts) {
      const over = opts && opts.over > 1 ? opts.over | 0 : 1, n = 2048 * over, out = new Float32Array(n);
      const R = opts && opts.remap && opts.remap.length >= 2049 ? opts.remap : DEF_REMAP;
      const mod = opts && opts.mod && opts.mod.length >= 2048 ? opts.mod : null;
      let w = +amt;
      w = w > 0 ? (w < 1 ? w : 1) : 0;
      let m = mode | 0;
      m = m >= 0 && m <= 22 ? m : 0;
      const em = m === 0 ? 0 : warpSetup(m, w, 1), K = wK;      // no opts.mod: m = 0 (§8.4.2)
      const hasWin = em === 2 || em === 3 || em === 11 || em === 19 || em === 20;
      for (let j = 0; j < n; j++) {
        const ph = j / n, mv = mod ? herm(mod, 2047, ph * 2048) : 0;
        const pw = em === 0 ? ph : warpPh(em, ph, K, w, R, 0, mv);
        let y = herm(frame, 2047, pw * 2048);
        if (hasWin) y *= winF(em, ph, w, mv);
        out[j] = y;
      }
      return out;
    }

    /* ------------------------------------------------------------ warmUp (§8.4.2, §11.5) */
    function warmUp(proc) {
      const sx = attach(proc);
      const saveP = proc.p, saveCt = proc.ct, saveV = proc.voices;
      const saveVc = proc.vcN;                                 // the Voice Control step counter (SxMod, §6.2) of the processor
      const tmp = [], tmpA = [];
      const store = (id, e) => { if (!tables.has(id) && storeWT(id, e)) tmp.push(id); };
      try {
        // synthetic tables: 64-frame crossfade table, 4-frame discrete table, sub shapes if missing, 2-level noise
        const mk = (F, interp, amp) => ({ kind: 'wt', v: 1, frames: F, interp, morph: interp,
          levels: MIP_HARM.map((h, l) => {
            const len = l < 3 ? 2048 : l === 3 ? 1024 : l === 4 ? 512 : 256, data = new Float32Array(F * len);
            for (let f = 0; f < F; f++) for (let j = 0; j < len; j++) data[f * len + j] = amp * sin(2 * PI * j / len) * (1 - f / (2 * F));
            return { len, harm: h, data };
          }) });
        store('__warm', mk(64, 1, 0.5));
        store('__warmD', mk(4, 0, 0.5));
        for (let k = 0; k < 5; k++) store(SUB_IDS[k], mk(1, 0, 0.5));
        let r = 12345;
        const nz = (len) => { const a = new Float32Array(len); for (let i = 0; i < len; i++) { r = xorshift(r); a[i] = (r / 2147483648 - 1) * 0.3; } return a; };
        store('__warmN', { kind: 'noise', v: 1, rate: 48000, ch: 2, root: 60, len: 4096, loopStart: 0, loopEnd: 4096,
          levels: [{ len: 4096, loopStart: 0, loopEnd: 4096, L: nz(4096), R: nz(4096) },
            { len: 2048, loopStart: 0, loopEnd: 2048, L: nz(2048), R: nz(2048) }] });
        // CT: LFO 1 rising saw (sweeps every filter type and warp mode), LFO 2 env with a loop, LFO 3 point-modulated
        // (a full CT v2 object, §4.1 layout)
        const ct = { key: '__warm', lfoTab: new Float32Array(N_LFO * 1025), lfoPtsOff: new Uint16Array(N_LFO + 1),
          lfoPts: new Float64Array(3 * 30), lfoPm: new Uint8Array(2 * 30), lfoPmAny: new Uint8Array(N_LFO),
          lfoStart: new Float64Array(N_LFO), lfoLoop: new Float64Array(N_LFO).fill(-1), remap: DEF_REMAP,
          veloTab: DEF_TAB, noteTab: DEF_TAB };
        let po = 0;
        for (let l = 0; l < N_LFO; l++) {
          const pts = l === 0 ? [0, 0, 0, 1, 1, 0] : [0, 0, 0, 0.5, 1, 0.3, 1, 0, 0];
          const np = pts.length / 3;
          ct.lfoPtsOff[l] = po;
          for (let j = 0; j < pts.length; j++) ct.lfoPts[3 * po + j] = pts[j];
          if (l === 2) { ct.lfoPm[2 * (po + 1) + 1] = 1; ct.lfoPm[2 * (po + 1)] = 1; ct.lfoPmAny[2] = 1; }
          for (let j = 0; j <= 1024; j++) ct.lfoTab[l * 1025 + j] = evalPts(ct.lfoPts, po, np, j / 1024);
          po += np;
        }
        ct.lfoPtsOff[N_LFO] = po;
        ct.lfoLoop[1] = 0.5;
        // CP v2 (§4.1 shapes; the S1 subset is exercised)
        const base = new Float64Array(NSV);
        for (let i = 0; i < NS; i++) {
          const law = DLAW[i], lo = DLO[i], hi = DHI[i];
          base[i] = law === EXP || law === POW2 || law === POW3 || law === POW4 || law === POW5 ? 0.5 : (lo < 0 ? -lo / (hi - lo) : 0);
        }
        base[D_UNI] = 1; base[17 + D_UNI] = 1; base[D_DET] = 0.6; base[17 + D_DET] = 0.6; base[D_LEVEL] = 0.5; base[17 + D_LEVEL] = 0.5;
        base[D_BLEND] = 0.75; base[17 + D_BLEND] = 0.75; base[D_RAND] = 1; base[17 + D_RAND] = 1; base[D_WARP] = 0.5; base[17 + D_WARP] = 0.5;
        base[D_UNIW] = 1; base[17 + D_UNIW] = 1;
        for (let e = 0; e < 3; e++) { base[E1_ATT + 5 * e] = 0.1; base[E1_ATT + 5 * e + 2] = 0.4; base[E1_ATT + 5 * e + 3] = 0.8; base[E1_ATT + 5 * e + 4] = 0.2; }
        for (let e = 0; e < 9; e++) base[E1_CA + e] = 0.6;
        for (let l = 0; l < 8; l++) { base[L1_RATE + 4 * l] = 0.45; base[L1_RATE + 4 * l + 3] = l === 3 ? 0.3 : 0; }
        base[L1_RATE + 4 * 4 + 1] = 0.01; base[L1_RATE + 4 * 4 + 2] = 0.01;
        base[C1_RATE] = 0.5; base[C1_RATE + 1] = 0.5; base[G_AMP] = 1; base[G_BENDUP] = 13 / 24; base[G_BENDDN] = 11 / 24;
        base[A_ON] = 1; base[A_ON + 1] = 1; base[N_ON] = 1; base[S_ON] = 1; base[F_ON] = 1; base[F_ROUTEA] = 1; base[F_ROUTEA + 1] = 1;
        base[F_ROUTEA + 2] = 0; base[F_ROUTEA + 3] = 1; base[A_TRACK] = 1; base[A_TRACK + 1] = 1;
        base[A_WARPMODE] = 0; base[A_WARPMODE + 1] = 4 / 22; base[S_SHAPE] = 0.5; base[F_TYPE] = 0; base[F_CUTOFF] = 0.7;
        base[F_RES] = 0.4; base[F_DRIVE] = 0.3; base[F_VAR] = 0.4; base[F_MIX] = 1; base[N_LEVEL] = 0.3; base[N_PITCH] = 0.5;
        base[S_LEVEL] = 0.5; base[F_PAN] = 0.5;
        for (let b = 0; b < 16; b++) base[BUS1 + b] = 0.5;
        // rows: [src, dst, amt, bi, curve, aux, ctx, on]
        const rows = [
          [S_LFO1, F_TYPE, 1, 0, 0, 0, 1, 0], [S_LFO1, A_WARPMODE, 1, 0, 0, 0, 1, 0], [S_LFO1 + 1, D_WT, 0.8, 0, 0.3, 0, 1, 0],
          [S_LFO1 + 2, F_CUTOFF, 0.2, 1, 0, S_VELO, 1, 0], [S_FIXED, BUS1, 0.4, 0, 0, 0, 3, 0], [S_CHAOS1, F_RES, 0.2, 1, 0, 0, 1, 0],
          [S_CHAOS1 + 1, 17 + D_WT, 0.3, 1, 0, 0, 1, 0], [S_VELO, D_UNI, 1, 0, 0, 0, 1, 1], [S_NOISE, N_PITCH, 0.4, 1, 0, 0, 1, 0],
          [S_LFO1 + 3, L1_RATE, 0.2, 1, -0.5, S_MACRO1, 3, 0], [S_ENV1 + 1, -1 - (8 + 79), 0.3, 0, 0, 0, 4, 0],
          [S_LFO1 + 4, D_PHASE, 0.2, 1, 0, 0, 1, 1], [S_RAND1, 17 + D_RAND, 0.5, 0, 0, 0, 1, 1], [S_WHEEL, G_WHEEL, 0.1, 0, 0, 0, 2, 0],
        ];
        const nr = rows.length, mSrc = new Int8Array(NROW), mDst = new Int16Array(NROW), mAmt = new Float64Array(NROW);
        const mBi = new Uint8Array(NROW), mK = new Float64Array(NROW), mAux = new Int8Array(NROW), mInv = new Uint8Array(NROW);
        const mCtx = new Uint8Array(NROW), mOn = new Uint8Array(NROW);
        const srcUsed = new Uint8Array(NSRC2), modded = new Uint8Array(NSV);
        for (let q = 0; q < nr; q++) {
          const w = rows[q];
          mSrc[q] = w[0]; mDst[q] = w[1]; mAmt[q] = w[2]; mBi[q] = w[3]; mK[q] = 6 * w[4]; mAux[q] = w[5]; mCtx[q] = w[6]; mOn[q] = w[7];
          srcUsed[w[0]] = 1; if (w[5]) srcUsed[w[5]] = 1; if (w[1] >= 0 && (w[6] & 1)) modded[w[1]] = 1;
        }
        const lfoLad = new Float64Array(N_LFO * 43);
        for (let l = 0; l < N_LFO; l++) for (let j = 0; j < 15; j++) lfoLad[l * 43 + j] = 128 * pow(2, -j);
        const cp = { ver: VER, NSV, NSRC: NSRC2, NROW, base, mN: nr, mSrc, mDst, mAmt, mBi, mK, mAux, mInv, mCtx, mOn, srcUsed,
          modded, wt: ['__warm', '__warmD', ''], uniMode: Uint8Array.from([0, 4, 0]), uniRange: Float64Array.from([2, 3, 2]),
          memSet: new Float64Array(16 * N_OSC), route: Uint8Array.from([0, 0, 1, 0, 2, 1, 1]), fKey: Uint8Array.from([1, 0]),
          noiseOneshot: 0, noiseKey: 1, noiseId: '__warmN', noiseColor: -1, outMask: 3,
          lfoMode: Uint8Array.from([0, 1, 2, 2, 0, 0, 0, 0, 2, 2]), lfoBpm: Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]),
          lfoAnchor: Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]), lfoLad, lfoLadN: new Uint8Array(N_LFO).fill(15),
          chaosMono: Uint8Array.from([0, 1]), chaosSh: Uint8Array.from([1, 0]), macro: new Float64Array(8).fill(0.5),
          mono: 0, legato: 0, poly: 8, always: 0, scaled: 0, oneNote: 1, os: 2, a4: 440, s1: 1, smooth: 1, ctKey: '__warm' };
        proc.p = { serum: cp, fxr: null };
        proc.ct = ct;
        const v1 = new SerumVoice(proc, 30), v2 = new SerumVoice(proc, 31);
        proc.voices = [v1, v2];
        v1.apply(proc.p); v2.apply(proc.p);
        const OS = proc.OS > 0 ? proc.OS | 0 : 1, N = 128 * OS;
        const L = new Float64Array(N), Rr = new Float64Array(N), DL = new Float64Array(N), DR = new Float64Array(N);
        const spans = ceil(0.1 * (proc.base > 0 ? proc.base : 48000) / 128);   // (0.25 s cost 40 % more for no gain)
        v1.noteOn(60, 0.95, false, 1); v2.noteOn(67, 0.4, false, 1);
        for (let k = 0; k < spans; k++) {
          if (k === (spans >> 1)) { v2.noteOff(0.3); v1.noteOn(72, 1, true, 1); }
          begin(proc, N);
          v1.render(L, Rr, N, DL, DR); v2.render(L, Rr, N, DL, DR);
          fxMods(proc); snapshot(proc);
        }
        v1.kill(); v2.kill();
        v1.render(L, Rr, N, DL, DR);
        // Serum 2 code (SPEC-serum2 §11.10, light engines only): OSC C with both WARPS2 slots swept over every mode
        // (block kernels of every domain, PD Self), Filter 1/2 swept over the 108 types (SxFilt2 families), Sample and
        // Multisample oscillators on tiny synthetic assets, colour noise, the S2 sub, F1 → F2, Direct, buses, LFO types
        const B = globalThis.SxBase;
        for (let k = 0; k < SUB_IDS2.length; k++) store(SUB_IDS2[k], mk(1, 0, 0.5));
        if (B && typeof B.storeAsset === 'function' && typeof B.dropAsset === 'function') {
          const len = 4096, Ls = new Float32Array(len);
          for (let i = 0; i < len; i++) Ls[i] = 0.5 * sin(2 * PI * 8 * i / len);
          const smp = { id: '__warmS', v: 1, kind: 'smp', bytes: 4 * len, rate: 48000, ch: 1, len, root: 60, loop: { start: 0, end: len }, peak: 0.5,
            levels: [{ len, L: Ls, R: null }, { len: len >> 1, L: Ls.subarray(0, len >> 1), R: null }] };
          const multi = { id: '__warmM', v: 1, kind: 'multi', bytes: 0, zones: [{ lo: 0, hi: 127, vlo: 0, vhi: 127, root: 60, tune: 0, gain: 0, pan: 0,
            smp: '__warmS', mode: 'loop', ls: 0, le: len, off: 0, env: [0, 0.001, 0, 0.1, 0.8, 0.05], rr: [1, 1], vt: 1 }] };
          if (!B.getAsset('__warmS') && B.storeAsset('__warmS', smp)) tmpA.push('__warmS');
          if (!B.getAsset('__warmM') && B.storeAsset('__warmM', multi)) tmpA.push('__warmM');
        }
        const cp2 = warmCP2(cp, base);
        proc.p = { serum: cp2, fxr: null };
        v1.apply(proc.p); v2.apply(proc.p);
        v1.noteOn(57, 0.9, false, 1, 2); v2.noteOn(64, 0.5, false, 1);
        const spans2 = ceil(0.02 * (proc.base > 0 ? proc.base : 48000) / 128);   // (LFO 1 at ≈ 66 Hz: > 1 sweep)
        for (let k = 0; k < spans2; k++) {
          if (k === (spans2 >> 1)) { v2.noteOff(0.3); v1.noteOn(60, 1, false, 1, 2); }
          begin(proc, N);
          v1.render(proc.sxOut || WARM_O, N); v2.render(L, Rr, N, DL, DR);
          fxMods(proc); snapshot(proc);
        }
        v1.kill(); v2.kill();
      } finally {
        proc.p = saveP; proc.ct = saveCt; proc.voices = saveV;
        for (let k = 0; k < tmp.length; k++) dropWT(tmp[k]);
        const B = globalThis.SxBase;
        if (B) for (let k = 0; k < tmpA.length; k++) B.dropAsset(tmpA[k]);
        reset(proc);                                           // (also clears the round-robin counters, sx.msRR)
        if (typeof saveVc === 'number') proc.vcN = saveVc;     // the hidden note-ons advanced it (VC patch)
        // (M4) the Spectral tables and FFT of this rate, built here rather than in the first Spectral 'patch' message
        const SP = globalThis.SxSpec;
        if (SP && typeof SP.prep === 'function') { try { SP.prep(proc.base); } catch (err) { /* only costs the first patch */ } }
      }
    }
    // OS-rate output object of the warm-up renders (§11.10 signature render(O, N)); 4 × 128 frames covers OS ≤ 4
    const WARM_O = { L: new Float64Array(512), R: new Float64Array(512), dL: new Float64Array(512), dR: new Float64Array(512),
      b1L: new Float64Array(512), b1R: new Float64Array(512), b2L: new Float64Array(512), b2R: new Float64Array(512) };
    // a complete CP v2 (every §4.1 field, SPEC-serum2) for the Serum 2 part of warmUp, built on the S1 warm CP c1
    function warmCP2(c1, b1) {
      const U8 = (n, v = 0) => new Uint8Array(n).fill(v), F64 = (n, v = 0) => new Float64Array(n).fill(v);
      const cp = Object.assign({}, c1);
      for (const k of ['oType', 'phMem', 'phLeg', 'smoothWT', 'pMode', 'uniMode', 'spawn', 'sLoop', 'sRel', 'sLink', 'sExit', 'sLoopGr', 'sScanKey',
        'sScanLock', 'sLenOn', 'sSlMode', 'sSlEnd', 'sSlOne', 'sSlRoot', 'sWin', 'sDens', 'sDensJump', 'sGlen', 'sPhLock', 'sTrans', 'sSmooth',
        'sPostWarp', 'sNorm', 'sRev', 'xyOn', 'xyY', 'xyMode', 'msOver', 'msDlyBpm']) cp[k] = U8(N_OSC);
      cp.bendTrack = U8(N_OSC, 1); cp.sDensLadN = U8(N_OSC, 1); cp.sGlenLadN = U8(N_OSC, 1);
      cp.pSrc = new Int8Array(N_OSC).fill(-1); cp.uniRange = F64(N_OSC, 2); cp.sScanR = F64(N_OSC, 2); cp.fmType = U8(2 * N_OSC);
      cp.sMaxGr = new Uint16Array(N_OSC).fill(256); cp.sSlN = new Uint16Array(N_OSC);
      cp.sSlPos = F64(3 * 258); for (let o = 0; o < N_OSC; o++) cp.sSlPos[o * 258 + 1] = 1;
      cp.sDensLad = F64(81, 1); cp.sGlenLad = F64(81, 1); cp.memSet = F64(16 * N_OSC);
      cp.lenLad = Float64Array.from([0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 128]);
      for (const k of ['mapLo', 'mapFold', 'mapWarp']) cp[k] = U8(6);
      cp.mapHi = U8(6, 127); cp.mapVLo = U8(6, 1); cp.mapVHi = U8(6, 127);
      cp.wt = ['__warm', '__warmD', '__warm']; cp.smp = ['__warmS', '', '']; cp.spec = ['', '', '']; cp.multi = ['', '__warmM', ''];
      cp.route = Uint8Array.from([0, 0, 0, 2, 0, 0, 1]); cp.envOn = Uint8Array.from([1, 1, 1, 0, 1, 1, 1]);
      cp.fKey = Uint8Array.from([1, 1]); cp.fClean = Uint8Array.from([0, 1]); cp.pz = Float64Array.from([...PZ_DEF, ...PZ_DEF]);
      cp.subContig = 1; cp.noiseColor = 1; cp.noiseId = '';
      cp.envBpm = U8(N_ENV); cp.envLegInv = U8(N_ENV); cp.envStealRe = U8(N_ENV);
      cp.envLad = Float64Array.from([0, 1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64, 128]);
      cp.lfoMode = Uint8Array.from([0, 1, 2, 0, 1, 2, 0, 0, 0, 0]); cp.lfoMono = Uint8Array.from([0, 0, 1, 0, 1, 0, 0, 0, 0, 0]);
      cp.lfoType = Uint8Array.from([0, 1, 2, 3, 4, 0, 0, 0, 0, 0]); cp.lfoDir = Uint8Array.from([0, 1, 2, 0, 0, 0, 0, 0, 0, 0]);
      cp.lfoX10 = U8(N_LFO); cp.lfoSwing = U8(N_LFO); cp.mpeMac = new Int8Array(8).fill(-1);
      cp.vcLen = 2; cp.vcLMode = 0; cp.vcRates = Float64Array.from([1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4]);
      cp.vcSteps = F64(48); cp.vcSteps[0] = 0.2; cp.vcSteps[7] = 0.3; cp.vcSel = U8(5, 1);
      cp.tune = F64(128); for (let k = 0; k < 128; k++) cp.tune[k] = k + 0.01;
      cp.sclN = 0; cp.sclPer = 0; cp.sclSteps = F64(128); cp.mpeOn = 1; cp.mpeBend = 48; cp.mpeBendX = 0; cp.mpeWheelY = 0;
      cp.outMask = 15; cp.fxKey = ''; cp.NFX = 8; cp.qr = Float64Array.from([16, 256, 1, 32, 512]);
      cp.steal = 0; cp.veloPorta = 0; cp.notePorta = 0; cp.s1 = 0;
      cp.use = 1 | 2 | 4 | 8 | 64 | 128 | 256 | 512 | 1024 | 2048;
      cp.oType[0] = 2; cp.oType[1] = 1; cp.pMode[2] = 1; cp.phMem[2] = 1; cp.fmType[4] = 1; cp.fmType[5] = 2;
      // matrix: the S1 rows plus LFO 1 sweeping OSC C's two warp modes and both filter types over their whole range
      const base = Float64Array.from(b1), M = 64;
      const rows = [[S_LFO1, OKB[2] + D_WT, 0.5], [S_LFO1, O2B[2] + K_W1, 1], [S_LFO1, O2B[2] + K_W2, 1], [S_LFO1, F_TYPE2, 1], [S_LFO1, F2_TYPE, 1],
        [S_LFO1 + 1, O2B[2] + K_WARP2, 0.5], [S_LFO1 + 2, F2_CUTOFF, 0.3]];
      const mN0 = c1.mN;
      for (const k of ['mSrc', 'mAux', 'mCrv']) cp[k] = new Int8Array(M);
      cp.mDst = new Int16Array(M);
      for (const k of ['mAmt', 'mK', 'mAK', 'mRise', 'mFall']) cp[k] = new Float64Array(M);
      for (const k of ['mBi', 'mInv', 'mCtx', 'mOn', 'mRd', 'mAlias']) cp[k] = new Uint8Array(M);
      cp.mCrv.fill(-1);
      for (let q = 0; q < mN0; q++) {
        cp.mSrc[q] = c1.mSrc[q]; cp.mDst[q] = c1.mDst[q]; cp.mAmt[q] = c1.mAmt[q]; cp.mBi[q] = c1.mBi[q]; cp.mK[q] = c1.mK[q];
        cp.mAux[q] = c1.mAux[q]; cp.mInv[q] = c1.mInv[q]; cp.mCtx[q] = c1.mCtx[q]; cp.mOn[q] = c1.mOn[q];
      }
      cp.mRise[1] = 0.05; cp.mFall[1] = 0.1;
      cp.modded = Uint8Array.from(c1.modded); cp.srcUsed = Uint8Array.from(c1.srcUsed); cp.srcBi = U8(NSRC2);
      for (let j = 0; j < rows.length; j++) {
        const q = mN0 + j, r = rows[j];
        cp.mSrc[q] = r[0]; cp.mDst[q] = r[1]; cp.mAmt[q] = r[2]; cp.mCtx[q] = 1; cp.modded[r[1]] = 1; cp.srcUsed[r[0]] = 1;
      }
      cp.mN = mN0 + rows.length;
      for (const vi of [C_ON, F2_ON, F1SW[2]]) base[vi] = 1;
      const kc = OKB[2];
      base[kc + D_LEVEL] = 0.5; base[kc + D_UNI] = 3 / 15; base[kc + D_DET] = 0.4; base[kc + D_WARP] = 0.5; base[kc + D_SEMI] = 13 / 24;
      base[OTRK[2]] = 1; base[O2B[2] + K_WARP2] = 0.4; base[O2B[2] + K_WVAR1] = 0.5; base[O2B[2] + K_RATIO] = 0.5; base[O2B[2] + K_HZ] = 0.5;
      base[O2B[2] + K_UNIWARP2] = 0.5; base[O2B[2] + K_FBAL] = 0.5; base[O2B[2] + K_BUS1] = 0.5;
      for (let o = 0; o < 2; o++) { base[O2B[o] + K_RATIO] = 0.5; base[O2B[o] + K_HZ] = 0.5; base[O2B[o] + K_UNIWARP2] = 0.5; base[O2B[o] + 9] = 1; base[O2B[o] + 11] = 1; base[O2B[o] + 13] = 0.75; }
      base[S_CRS] = 0.55; base[S_TRACK] = 1; base[S_SHP] = 0.4; base[N_STEREO] = 0.7; base[N_COLOR] = 0.6;
      base[F_TYPE2] = 1 / 107; base[F_LEVEL] = 0.5; base[F2_CUTOFF] = 0.6; base[F2_RES] = 0.3; base[F2_MIX] = 1; base[F2_PAN] = 0.5; base[F2_LEVEL] = 0.5;
      base[F2_TYPE] = 100 / 107; base[F2_X] = 0.3; base[F2_X + 1] = 0.6; base[F2_BUS1 + 1] = 0.5;
      for (let c = 0; c < 5; c++) base[F2SW[c]] = 1;
      base[G_BU2] = 2 / 48; base[G_BD2] = 46 / 48; base[VI('vc.escale')] = 0.5; base[VI('vc.lscale')] = 0.5;
      // LFO 1 (the sweep of OSC C's warp modes and both filter types) at 100·0.9⁴ ≈ 66 Hz: the 20 ms of the Serum 2 part
      // visit every filter type 0–107 and every WARPS2 mode a wavetable oscillator can take (0–57)
      base[L1_RATE] = 0.9;
      cp.base = base;
      return cp;
    }

    /* ------------------------------------------------------------ first-use warm-up on the real patch (§11.5) */
    // warmUp optimises the code for a synthetic patch; the first real Serum patch of the scope then invalidates that
    // code (V8: dependent prototype chain / field type changes) and the first chord ran unoptimised (2-3x its steady
    // cost for several quanta — a dropout on slower machines). Warming up with the real patch shape instead costs ~50 %
    // more CPU for good (generic code), so the host plays the processor's own patch on two hidden voices into scratch
    // buffers, one span per warmTick while the track is silent, once the patch's tables and assets are stored (gives up
    // after HW_WAIT spans). The note bookkeeping the hidden voices touch (recent voice, portamento start, alternation,
    // random sequence, phase memory, the Voice Control step counter proc.vcN, the multisample round-robin counters
    // sx.msRR) is restored at the end, so the track itself is unchanged; they write no channel meter. reset() ends it.
    // Lazy warm-ups (§11.10): jobs queued through SxBase.warmAdd the first time an apply selects a heavy engine (SxSpec
    // queues its FFT job itself; a Granular oscillator queues GRAN_JOB here) run one step per warmTick in every state of
    // the hidden-voice warm-up (waiting, rendering, after it ended or gave up); warmTick returns hidden spans left + lazy
    // jobs left, so 0 means nothing is queued. The hidden voices leave Granular oscillators silent: GRAN_JOB warms them
    // up in bounded steps (§14.1 row q: every lazy warmTick ≤ 1 ms), after the hidden voices.
    // (M4) HW_SPANS_SPEC: a patch with a Spectral oscillator plays its hidden voices longer — its frame code (one build per
    // hop) had not reached optimised code after 80 spans in V8, so a first chord 0.5 s after the preset change ran it
    // unoptimised for ≈ 40 ms (2–6× the steady quantum); the spans are cheap (two Spectral voices ≈ 0.03 of real time)
    const HW_SPANS = 80, HW_SPANS_SPEC = 240, HW_WAIT = 800, HW_COLD = 6;
    // GRAN_JOB: GW_CH chunks per hidden voice, at most GW_K chunks per warmTick; the first GW_C0 chunks of each voice one
    // per step with light grain caps (GW_Q0 / GW_Q1, the CP.qr layout): the code is cold there
    const GW_CH = 320, GW_K = 2, GW_C0 = 8, GW_Q0 = Float64Array.from([16, 18, 1, 32, 512]);
    // (M4) the first voice's light caps allow 18 grains per oscillator (more than one batch of 16: the grain loop's later
    // batches), the second voice starts under a processor cap of 6 grains (GW_Q1): it is refused and starves (the cap
    // branches) — paths a first real chord otherwise met cold (V8 deoptimised the whole render there)
    const GW_Q1 = Float64Array.from([16, 8, 1, 32, 6]);
    function warmStart(proc) {
      const sx = attach(proc);
      if (sx.hwN !== 0) return;
      sx.hwT = hwSpans(proc); sx.hwN = sx.hwT; sx.hwOn = 0; sx.hwWait = HW_WAIT;
    }
    // the hidden spans of the processor's patch: HW_SPANS_SPEC when an oscillator that plays is Spectral (read from the
    // CP, as warmKey: the processor state may not be synced to it yet)
    function hwSpans(proc) {
      const cp = proc && proc.p ? proc.p.serum : null;
      if (!cpOk(cp) || !cp.base || cp.base.length < NSV) return HW_SPANS;
      const b = cp.base, use = cp.use | 0, ot = cp.oType;
      for (let o = 0; o < N_OSC; o++) {
        const on = (o < 2 || (use & 1) !== 0) && b[OON[o]] >= 0.5;
        if (on && ot && ot.length > o && (ot[o] | 0) === 4) return HW_SPANS_SPEC;
      }
      return HW_SPANS;
    }
    // an oscillator that plays (on; OSC C only with CP.use & 1)
    function oscOn(sx, o) { return (o < 2 || (sx.use & 1) !== 0) && sx.bT[OON[o]] >= 0.5; }
    // the asset of oscillator o of type t is stored (§4.5: Multisample cp.multi with every zone sample, Sample/Granular
    // cp.smp, Spectral cp.spec; '' = none selected, nothing to wait for; no SxBase: those oscillators are silent anyway)
    function assetReady(cp, t, o) {
      const B = globalThis.SxBase;
      if (!B || typeof B.getAsset !== 'function' || !cp) return true;
      const ids = t === 1 ? cp.multi : t === 4 ? cp.spec : cp.smp, id = ids && typeof ids[o] === 'string' ? ids[o] : '';
      if (id === '') return true;
      const e = B.getAsset(id);
      if (!e) return false;
      if (t === 1 && Array.isArray(e.zones)) {
        for (let z = 0; z < e.zones.length; z++) {
          const zs = e.zones[z] ? e.zones[z].smp : '';
          if (typeof zs === 'string' && zs !== '' && !B.getAsset(zs)) return false;
        }
      }
      return true;
    }
    // the hidden voices can start: wavetables and assets of every oscillator that plays (Granular excepted: GRAN_JOB waits
    // for its own asset) and the sample noise's table are stored
    function hwReady(sx) {
      if (!sx.ok) return false;
      for (let o = 0; o < N_OSC; o++) {
        if (!oscOn(sx, o)) continue;
        const t = sx.oType[o];
        if (t === 0) { if (!tables.has(sx.wt[o])) return false; }
        else if (t !== 3 && !assetReady(sx.cp, t, o)) return false;
      }
      if (sx.bT[N_ON] >= 0.5 && sx.noiseColor < 0 && !tables.has(sx.noiseId)) return false;
      return true;
    }
    // the note bookkeeping hidden note-ons touch, saved before them and restored after (both warm-ups, one at a time)
    function hwSave(proc, sx) {
      sx.hwRec = sx.mod.recent; sx.hwLP = sx.mod.lastPitch; sx.hwMem.set(sx.memPh); sx.hwSub = sx.subPh;
      sx.hwAlt = sx.alt; sx.hwRng = sx.rng;
      sx.hwVc = typeof proc.vcN === 'number' ? proc.vcN : -1;
      const rr = sx.msRR;
      if (rr) {
        if (sx.hwRR === null || sx.hwRR.length !== rr.length) sx.hwRR = new Uint32Array(rr.length);
        sx.hwRR.set(rr); sx.hwRRok = 1;
      } else sx.hwRRok = 0;
    }
    function hwRestore(proc, sx) {
      sx.mod.recent = sx.hwRec; sx.mod.lastPitch = sx.hwLP; sx.memPh.set(sx.hwMem); sx.subPh = sx.hwSub;
      sx.alt = sx.hwAlt; sx.rng = sx.hwRng;
      if (sx.hwVc >= 0) proc.vcN = sx.hwVc;
      const rr = sx.msRR;
      if (rr) { if (sx.hwRRok === 1 && sx.hwRR !== null && sx.hwRR.length === rr.length) rr.set(sx.hwRR); else rr.fill(0); }
      sx.hwRec = null; sx.hwRRok = 0;
    }
    // lazy jobs queued (no step)
    function lazyN(proc) { const W = proc.sxWarm; return W && W.q ? W.q.length - W.h : 0; }
    // one step of the head lazy job (SxBase.warmTick, ≤ 1 ms) → lazy jobs left
    function lazyTick(proc) {
      const B = globalThis.SxBase;
      return B && typeof B.warmTick === 'function' && proc.sxWarm ? B.warmTick(proc) | 0 : 0;
    }
    // the Granular lazy warm-up (§11.10; queued by SerumVoice.apply, live processors only, once per processor and asset
    // id): two hidden voices (hid 2, notes 60 and 67, as the first-use warm-up: two voices reach the processor grain cap)
    // play the current patch, one bounded step per warmTick (§14.1 row q): the voices are made, applied and started in
    // separate steps; then each step renders one voice, alternating — one chunk with light grain caps in the first steps
    // (cold code), then (after one re-apply step per voice with the patch's own caps) GW_K chunks — GW_CH chunks per
    // voice, the second note released half-way. It waits for the first-use hidden
    // voices and (up to HW_WAIT steps) for the Granular assets; it is dropped while a voice of the track sounds (real
    // notes run that code; warmEnd ends it) and when the patch no longer plays Granular; a patch or rate change restarts
    // it. One complete run per processor is enough (the code is warm for any sample): later jobs then end at once.
    function granOn(sx) {
      for (let o = 0; o < N_OSC; o++) if (sx.oType[o] === 3 && oscOn(sx, o)) return true;
      return false;
    }
    function granReady(sx) {
      for (let o = 0; o < N_OSC; o++) if (sx.oType[o] === 3 && oscOn(sx, o) && !assetReady(sx.cp, 3, o)) return false;
      return true;
    }
    function GRAN_JOB(proc) {
      const sx = proc.sx;
      if (!sx || proc.offline || sx.gwOk === 1 || sx.mod === null) { if (sx) gwEnd(proc); return false; }
      const vs = proc.voices;
      if (vs) for (let k = 0; k < vs.length; k++) if (vs[k] && vs[k].active) { gwEnd(proc); return false; }
      if (sx.hwN !== 0) return true;                          // after the first-use hidden voices
      const cp = proc.p && proc.p.serum;
      if (sx.gwSt !== 0 && (cp !== sx.gwCp || +proc.fs !== sx.gwFs)) gwEnd(proc);   // patch or rate changed: restart
      const st = sx.gwSt, g = sx.gw;
      switch (st) {
        case 0:
          if (!sx.ok || !cpOk(cp) || !granOn(sx)) return false;
          if (!granReady(sx)) return --sx.gwWait > 0;         // waiting for the Granular asset
          sx.gw = [new SerumVoice(proc, 0), null];
          sx.gw[0].hid = 2; sx.gw[0].gq = GW_Q0;
          sx.gwL = new Float64Array(GW_K * MAXCH); sx.gwR = new Float64Array(GW_K * MAXCH);
          sx.gwCp = cp; sx.gwFs = +proc.fs;
          break;
        case 1: g[0].apply(proc.p); break;
        case 2: g[1] = new SerumVoice(proc, 1); g[1].hid = 2; g[1].gq = GW_Q1; break;
        case 3: g[1].apply(proc.p); gwQ(g[1]); break;
        case 4:
          if (!g[0].ok || !g[1].ok || !(g[0].CH > 0 && g[0].CH <= MAXCH)) { gwEnd(proc); return false; }
          hwSave(proc, sx); sx.gwSaved = 1;
          g[0].noteOn(60, 0.8, false, 1);
          sx.mod.recent = sx.hwRec;                              // never the panel's voice (snapshot, filter tap)
          break;
        case 5:
          g[1].noteOn(67, 0.6, false, 1);
          sx.mod.recent = sx.hwRec;
          sx.gwN = 2 * GW_CH;
          break;
        default: {
          const k = sx.gwN & 1, done = GW_CH - (sx.gwN >> 1), c = done < GW_C0 ? 1 : GW_K;
          if (c > 1 && g[k].gq !== null) { g[k].gq = null; g[k].apply(proc.p); return true; }   // the patch's caps
          const L = sx.gwL, R = sx.gwR, n = c * g[0].CH;
          for (let i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
          if (k === 1 && done === GW_CH >> 1) g[1].noteOff(0.5);   // the release path as well
          if (k === 1 && done === GW_CH >> 2) { g[1].noteOn(67, 0.6, false, 1); sx.mod.recent = sx.hwRec; }   // (M4) a retrigger: the grains' fade-out
          hidRender(sx, g[k], hwOut(L, R), n);
          sx.gwN--;
          if (sx.gwN > 0 && (g[0].active || g[1].active)) return true;
          gwEnd(proc);
          sx.gwOk = 1;
          return false;
        }
      }
      sx.gwSt = st + 1;
      return true;
    }
    // (M4) the second hidden voice's Granular oscillators run time-compressed (SxGran's wq: grains of a few ms, stream
    // playheads crossing their region in a fraction of the job) — the paths a real note meets only after seconds (grains
    // ending, spawns into the room they leave, reads crossing the region ends, playhead ends and loop wraps; a retrigger
    // at 1/4: the grains' fade-out) are warm early; the first voice plays the patch as it is (the paths of a chord's
    // first quanta, and enough grains to have the code optimised); the two alternate step by step
    function gwQ(v) { for (let o = 0; o < N_OSC; o++) { const x = v.oxs[4 * o + 2]; if (x !== null) x.wq = 1; } }
    // ends the Granular job's hidden notes (grains back to the processor, bookkeeping restored); the job restarts from
    // its first step if it runs again
    function gwEnd(proc) {
      const sx = proc.sx;
      if (!sx) return;
      if (sx.gw !== null) for (let k = 0; k < 2; k++) { const v = sx.gw[k]; if (v !== null && v.active) v.kill(); }
      if (sx.gwSaved === 1) { hwRestore(proc, sx); sx.gwSaved = 0; }
      sx.gw = null; sx.gwL = null; sx.gwR = null; sx.gwSt = 0; sx.gwN = 0; sx.gwCp = null; sx.gwRt = 0;
    }
    // The hidden voices start over three quanta (§14.1 row q: no quantum carries the whole start — construction, apply,
    // note-on and the first span cost 4–6 ms together; a lazy step runs with the cheap apply / note-on steps, none with
    // the construction), and the first HW_COLD spans render one chunk of one voice each (the code is cold: interpreted,
    // a Spectral note's first frames), then both voices whole spans.
    function warmTick(proc, N) {
      const sx = proc.sx;
      if (!sx) return 0;
      if (sx.hwN === 0) { const j = lazyTick(proc); return sx.hwN + j; }
      if (sx.hwOn === 0) {
        if (!hwReady(sx)) {
          if (--sx.hwWait <= 0) sx.hwN = 0;                    // gives up on the hidden voices; lazy jobs still run
          const j = lazyTick(proc);
          return sx.hwN + j;
        }
        gwEnd(proc);                                           // (one hidden note at a time: a Granular job restarts later)
        hwSave(proc, sx);
        const a = new SerumVoice(proc, 0), b = new SerumVoice(proc, 1);
        a.hid = 1; b.hid = 1;
        sx.hw = [a, b]; sx.hwL = new Float64Array(MAXCH * 32); sx.hwR = new Float64Array(MAXCH * 32);
        sx.hwOn = 1; sx.hwSt = 1; sx.hwFs = +proc.fs;
        return sx.hwN + lazyN(proc);
      }
      // (apply and note-on are cheap steps: a lazy step — e.g. the Spectral FFT warm-up — runs before the first span)
      if (sx.hwSt === 1) { sx.hw[0].apply(proc.p); sx.hw[1].apply(proc.p); sx.hwSt = 2; return sx.hwN + lazyTick(proc); }
      if (sx.hwSt === 2) {
        sx.hw[0].noteOn(60, 0.8, false, 1); sx.hw[1].noteOn(67, 0.6, false, 1);
        sx.mod.recent = sx.hwRec;                                // never the panel's voice (snapshot, filter tap)
        sx.hwSt = 3;
        return sx.hwN + lazyTick(proc);
      }
      if (+proc.fs !== sx.hwFs || !(N > 0 && N <= MAXCH * 32)) { warmEnd(proc); const j = lazyTick(proc); return sx.hwN + j; }
      const L = sx.hwL, R = sx.hwR, hw = sx.hw, O = hwOut(L, R);
      for (let i = 0; i < N; i++) { L[i] = 0; R[i] = 0; }
      if (sx.hwN === sx.hwT >> 1) hw[1].noteOff(0.5);               // the release path as well
      // (M4) a retrigger of the first voice a quarter in: a note's first chunk (entry resolution, stream / grain starts,
      // slices) runs again with the code's type feedback in place — the hidden voices' own first chunks ran before V8 had
      // allocated it, so the first real chord met those paths cold in optimised code and deoptimised it
      if (sx.hwN === sx.hwT - (sx.hwT >> 2)) { hw[0].noteOn(60, 0.8, false, 1); sx.mod.recent = sx.hwRec; }
      const cold = sx.hwT - sx.hwN;                                    // spans rendered so far
      if (cold < HW_COLD) {
        // the first spans of cold code (interpreted, a Spectral note's first frames): one chunk of one voice per span
        const v = hw[cold & 1], c = v.CH > 0 && v.CH <= N ? v.CH : N;
        hidRender(sx, v, O, c);
        sx.hwN--;
        return sx.hwN + lazyN(proc);
      }
      hidRender(sx, hw[0], O, N); hidRender(sx, hw[1], O, N);
      if (--sx.hwN === 0) warmEnd(proc);
      const j = lazyTick(proc);
      return sx.hwN + j;
    }
    // the shape of the processor's patch the hidden voices warm up (§11.10): S1/S2 mode, per oscillator that plays its type
    // and warp modes, the filter types, noise / sub — '' without a usable CP. The engine re-arms warmStart when a patch's
    // shape differs from the one it last warmed (a preset change while the track is silent: the code the new shape runs
    // is JIT-cold, its first chord would be rendered unoptimised)
    function warmKey(proc) {
      const cp = proc && proc.p ? proc.p.serum : null;
      if (!cpOk(cp) || !cp.base || cp.base.length < NSV) return '';
      const b = cp.base, use = cp.use | 0, s1 = cp.s1 ? 1 : 0, ot = cp.oType;
      let k = s1 ? 'S1' : 'S2';
      for (let o = 0; o < N_OSC; o++) {
        const on = (o < 2 || (use & 1) !== 0) && b[OON[o]] >= 0.5;
        if (!on) { k += '|-'; continue; }
        const w = O2B[o], t = ot && ot.length > o ? ot[o] | 0 : 0;
        k += '|' + t + ':' + (o < 2 && s1 ? round(22 * b[A_WARPMODE + o]) : round(81 * b[w + K_W1])) + ':' + ((use & 4) !== 0 ? round(81 * b[w + K_W2]) : 0);
      }
      k += '|f' + (b[F_ON] >= 0.5 ? (s1 ? round(95 * b[F_TYPE]) : round(107 * b[F_TYPE2])) : -1);
      k += ':' + ((use & 2) !== 0 && b[F2_ON] >= 0.5 ? round(107 * b[F2_TYPE]) : -1);
      k += '|' + (b[N_ON] >= 0.5 ? 1 : 0) + (b[S_ON] >= 0.5 ? 1 : 0);
      return k;
    }
    // the hidden voices render through the engine's call form render(O, N) with an output object of the engine's shape
    // (§12.2 sxOut: L, R, dL, dR, b1L, b1R, b2L, b2R, in that order: the same map), every pair on the scratch buffers —
    // warmed up with render(L, R, N) instead, the first real chord met a new map in render() and deoptimised (V8)
    let HWO = null;
    function hwOut(L, R) {
      if (HWO === null || HWO.L !== L || HWO.R !== R) HWO = { L, R, dL: L, dR: R, b1L: L, b1R: R, b2L: L, b2R: R };
      return HWO;
    }
    // one hidden span as the recent voice, as the first real chord's recent voice renders (its `recent === this` branch:
    // SxMod post(), phase memory — never run by the warm-up before, it deoptimised render at the first chord, V8); the
    // processor's mono sources and last pitch (read by every span's begin / fxMods / recentPitch) are restored right
    // after, the phase memory with the rest of the bookkeeping at the end (hwRestore)
    function hidRender(sx, v, O, N) {
      const m = sx.mod, ms = m.monoSrc, rec = m.recent, lp = m.lastPitch;
      if (sx.hwMs === null || sx.hwMs.length !== ms.length) sx.hwMs = new Float64Array(ms.length);
      sx.hwMs.set(ms);
      m.recent = v;
      v.render(O, N);
      recentPitch(v.proc);                                     // (the engine reads it every span: its recent-voice path)
      m.recent = rec; ms.set(sx.hwMs); m.lastPitch = lp;
    }
    // ends both warm-ups (the host calls it at the first real note, and when the track leaves Serum)
    function warmEnd(proc) {
      const sx = proc.sx;
      if (!sx) return;
      if (sx.hwOn === 1) {
        // the hidden voices give back what they hold (spectral streams, grains), then the bookkeeping is restored
        if (sx.hw !== null) for (let k = 0; k < sx.hw.length; k++) sx.hw[k].kill();
        hwRestore(proc, sx);
      }
      sx.hw = null; sx.hwL = null; sx.hwR = null; sx.hwN = 0; sx.hwOn = 0; sx.hwSt = 0; sx.hwRec = null; sx.hwRRok = 0;
      gwEnd(proc);
    }

    globalThis.SerumDSP = Object.freeze({
      VER, DIDX, FIDX, SIDX, LAW_TAB, SRC_POL, SUB_IDS, FILTER_FAMILY, FILTER_FAM_OF, UNI, tables,
      VIDX, SUB_IDS2,
      get epoch() { return epoch; },
      storeWT, storeWTFrame, dropWT,
      attach, reset, idle, transport, begin, fxMods, snapshot, mergeCT, recentPitch, warmUp, warmStart, warmTick, warmEnd, warmKey,
      sync, extIn, extOff,
      allocate,
      SerumVoice, SFilter, bend, evalPts, renderWarp, filterImpulse,
    });
  } catch (err) {
    globalThis.SerumDSP = null;                                // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('serum-dsp: load failed', err);
  }
})();
