/*
 * serum-dsp.js — Serum-style voice DSP (classic script, no imports/exports).
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread (<script> injected by wk.loadDSP)
 * and in node vm contexts (tests). The whole file is one IIFE that publishes `globalThis.SerumDSP`; it can be
 * evaluated again in the same scope (the wavetable Map survives), and a failure inside leaves SerumDSP = null
 * without throwing. Contract: SPEC-serum.md §8.4 (exports), §3 (constants), §5 (modulation), §6 (voice
 * behaviour), §7 (wavetable data).
 *
 * Layout of this file:
 *   constants (destinations, sources, families, unison tables, ladders) · fast math · curves · table store ·
 *   SFilter (all 96 types, 19 families) · per-processor state (attach/begin/idle/transport/reset/fxMods/
 *   snapshot) · SerumVoice · renderWarp · warmUp · exports.
 *
 * Hot paths (SerumVoice.render, SFilter.tick/process, begin) never allocate: every buffer is created in a
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
 *    returns to its attach state. A voice whose processor was reset (or warmed up) re-syncs the CP at its next
 *    noteOn/render, so notes between a panic and the next begin are not lost.
 *  - transport(proc, true) also clears lastPitch, memPh, recent and the per-voice part of monoSrc (bookkeeping a
 *    fresh offline render does not have), so a song rendered from a tick is identical live and offline (§6.16).
 *  - renderWarp without opts.mod uses m = 0 with the mode active (AM → x·(1 − w/2), RM → x·(1 − w)), as §8.4.2
 *    states; the voice treats a switched-off modulator as "identical to Off" (§3.3).
 *  - SFilter: SVF damping k = √2 − r·sat(bp), r = √2·0.99·res (small-signal Q = 0.7071/(1 − 0.99·res)) with a
 *    soft 2·tanh(bp/2) limit on the resonance part (FAT on top for Normal types); Peak = x + 4·res·(k·bp); comb
 *    feedback 0.995·res (output × √(1 − fb²)), flange/phaser/fphs 0.9·res, all with 2·tanh(·/2) in the loop;
 *    bank DAMP = one-pole in the loop (coefficient 1 − 0.9·var); French LP = 2× driven ladder (stage level 1)
 *    with 8·var·BP(2·cutoff, Q 2) fed back, output halved; German LP = linear ZDF ladder with a 4·tanh(y/4)
 *    feedback limit; first-order EQ shelves put their midpoint gain at the cutoff; every family output passes a
 *    safety limiter above |8| (bounded by 12) and a non-finite state resets the filter.
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
      SQRT2 = Math.SQRT2, LN10 = Math.LN10;

    const VER = 1;
    const NS = 148, NF = 100, ND = 248, NSRC = 34, MAXCH = 32, TAP_N = 1024, NTYPES = 96, MAX_PTS = 480;
    const CURVE_K = 10, ENV_K = 10, PORTA_K = 6;
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
    const E1_ATT = DIDX.E1_ATT, L1_RATE = DIDX.L1_RATE, C1_RATE = DIDX.C1_RATE, G_PORTA = DIDX.G_PORTA,
      G_CURVE = DIDX.G_CURVE, G_TUNE = DIDX.G_TUNE, G_AMP = DIDX.G_AMP, G_BENDUP = DIDX.G_BENDUP, G_BENDDN = DIDX.G_BENDDN,
      BUS1 = DIDX.BUS1;
    const A_ON = DIDX.A_ON, N_ON = DIDX.N_ON, S_ON = DIDX.S_ON, F_ON = DIDX.F_ON, F_ROUTEA = DIDX.F_ROUTEA,
      A_TRACK = DIDX.A_TRACK, A_WARPMODE = DIDX.A_WARPMODE, S_SHAPE = DIDX.S_SHAPE, S_OCT = DIDX.S_OCT,
      F_TYPE = DIDX.F_TYPE, E1_CA = DIDX.E1_CA, C1_BPM = DIDX.C1_BPM, G_WHEEL = DIDX.G_WHEEL, G_BEND = DIDX.G_BEND;
    const FX_BASE = NS;                                         // FX dest idx − FX_BASE = fx idx

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
    const S_WHEEL = SIDX.WHEEL, S_ENV1 = SIDX.ENV1, S_LFO1 = SIDX.LFO1, S_VELO = SIDX.VELO, S_NOTE = SIDX.NOTE,
      S_AT = SIDX.AT, S_PAT = SIDX.PAT, S_CHAOS1 = SIDX.CHAOS1, S_NOISE = SIDX.NOISE, S_RAND1 = SIDX.RAND1,
      S_RAND2 = SIDX.RAND2, S_ALT1 = SIDX.ALT1, S_ALT2 = SIDX.ALT2, S_MACRO1 = SIDX.MACRO1, S_BEND = SIDX.BEND,
      S_MPEX = SIDX.MPEX, S_RELVEL = SIDX.RELVEL, S_FIXED = SIDX.FIXED;

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
    // curve table (129 or 1025 entries over [0, 1]) read with linear interpolation
    function tabAt(T, b, n, x) {
      if (!(x > 0)) return T[b];
      if (x >= 1) return T[b + n];
      const p = x * n, i = p | 0;
      return T[b + i] + (p - i) * (T[b + i + 1] - T[b + i]);
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
    // pool size (floats) needed by a family at rate fs
    function lineLen(fs, m) { return ceil(fs * m / 8) + 8; }
    function bankNeed(fs, sub) {
      let n = 0;
      if (sub === 0) for (let j = 0; j < 6; j++) n += ceil(fs / (8 * BANK_M[j])) + 8;
      else if (sub === 1) for (let j = 0; j < 6; j++) n += lineLen(fs, AP_M[j]);
      else for (let j = 0; j < 4; j++) n += lineLen(fs, FDN_M[j]);
      return 2 * n;
    }
    function poolNeed(fam, fs) {
      if (fam === F_COMB || fam === F_FLANGE || fam === F_FPHS || fam === F_DISTCOMB) return 2 * lineLen(fs, 1);
      if (fam === F_BANK) {
        const a = bankNeed(fs, 0), b = bankNeed(fs, 1), c = bankNeed(fs, 2);
        return a > b ? (a > c ? a : c) : (b > c ? b : c);
      }
      return 0;
    }
    function poolMax(fs) {
      const a = poolNeed(F_COMB, fs), b = poolNeed(F_BANK, fs);
      return a > b ? a : b;
    }

    class SFilter {
      constructor(fs) {
        this.fs = fs > 0 ? +fs : 48000;
        this.type = 1; this.fam = F_LADDER; this.sub = 1; this.all = 0; this.aLo = 0; this.aHi = NTYPES - 1; this.aNeed = 0; this.aFs = -1;
        this.aL = 1000; this.aR = 1000;                        // last set() cutoffs (unclamped, for setRate)
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
        this.set(1000, 1000, 0, 0, 0);
      }
      setRate(fs) {
        if (fs > 0 && +fs !== this.fs) {
          this.fs = +fs;
          if (this.pool.length > 0) { this.ensure(this.fam); this.layout(); }
        }
        this.fcL = -1; this.fcR = -1;                          // force recomputation (clamp and prewarp depend on fs)
        this.set(this.aL, this.aR, this.res, this.drive, this.vr);
      }
      setType(t) {
        t = t > 0 ? (t < NTYPES - 1 ? round(t) : NTYPES - 1) : 0;
        if (t === this.type) return;
        const fam = FILTER_FAM_OF[t];
        const change = fam !== this.fam || fam === F_BANK;     // bank subtypes use different line layouts
        this.type = t; this.fam = fam; this.sub = t - FAM_FIRST[fam];
        if (change) {                                          // switching family resets it; same family keeps state
          this.ensure(fam);
          this.layout();
          this.st.fill(0); this.ld.fill(0);
        }
        this.coef();
      }
      // all: the type is modulated — the pool covers every family of the types lo…hi it can reach (default: all)
      prealloc(all, lo = 0, hi = NTYPES - 1) {
        this.all = all ? 1 : 0;
        this.aLo = lo > 0 ? (lo < NTYPES ? lo | 0 : NTYPES - 1) : 0;
        this.aHi = hi > this.aLo ? (hi < NTYPES ? hi | 0 : NTYPES - 1) : this.aLo;
        this.aFs = -1;
        if (this.all) {
          const had = this.pool.length;
          this.ensure(this.fam);
          if (this.pool.length !== had) this.layout();
        }
      }
      // grow-only pool: enough for this family (or for every family of the reachable types after prealloc(true))
      ensure(fam) {
        let need = poolNeed(fam, this.fs);
        if (this.all) {
          if (this.aFs !== this.fs) {
            let m = 0;
            for (let t = this.aLo; t <= this.aHi; t++) { const q = poolNeed(FILTER_FAM_OF[t], this.fs); if (q > m) m = q; }
            this.aNeed = m; this.aFs = this.fs;
          }
          if (this.aNeed > need) need = this.aNeed;
        }
        if (need > this.pool.length) {
          this.pool = new Float32Array(need);
          this.lc.fill(0);
        }
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
              const L = sub === 0 ? ceil(fs / (8 * BANK_M[j])) + 8 : lineLen(fs, sub === 1 ? AP_M[j] : FDN_M[j]);
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
        this.coef();
        this.flush();
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
          default: a = this.fScream(0, xl); b = this.fScream(1, xr); break;
        }
        this.yl = a <= 8 && a >= -8 ? a : lim(a);
        this.yr = b <= 8 && b >= -8 ? b : lim(b);
      }
      process(L, R, off, n) {
        const end = off + n;
        const sub = this.sub;
        if (this.fam === F_LADDER) { if (n > 0) this.pLad(L, R, off, end); }
        else if (this.fam === F_SVF && (sub === 1 || sub === 5 || sub === 8 || sub === 10 || sub === 12)) { if (n > 0) this.pSvf(L, R, off, end, sub); }
        else {
          for (let i = off; i < end; i++) {
            this.tick(L[i], R[i]);
            L[i] = this.yl; R[i] = this.yr;
          }
        }
        this.flush();
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
    function filterImpulse(type, fc, res, drive, vr, fs, len = 4096) {
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

    /* ------------------------------------------------------------ built-in default CT (§4.1) */
    const DEF_CT = (() => {
      const lfoTab = new Float32Array(8 * 1025), lfoPtsOff = new Uint16Array(9), lfoPts = new Float64Array(8 * 9);
      const tri = Float64Array.from([0, 0, 0, 0.5, 1, 0, 1, 0, 0]);
      for (let l = 0; l < 8; l++) {
        lfoPtsOff[l] = 3 * l;
        lfoPts.set(tri, 9 * l);
        for (let j = 0; j <= 1024; j++) lfoTab[l * 1025 + j] = evalPts(tri, 0, 3, j / 1024);
      }
      lfoPtsOff[8] = 24;
      const remap = new Float32Array(2 * 2049);
      for (let o = 0; o < 2; o++) for (let j = 0; j <= 2048; j++) remap[o * 2049 + j] = j / 2048;
      const veloTab = new Float32Array(129), noteTab = new Float32Array(129);
      for (let j = 0; j <= 128; j++) { veloTab[j] = j / 128; noteTab[j] = j / 128; }
      const lfoLoop = new Float64Array(8).fill(-1);
      return Object.freeze({ key: '', lfoTab, lfoPtsOff, lfoPts, lfoPm: new Uint8Array(48), lfoPmAny: new Uint8Array(8),
        lfoStart: new Float64Array(8), lfoLoop, remap, veloTab, noteTab });
    })();

    /* ------------------------------------------------------------ shared helpers of the modulation system */
    // one matrix row (§5.2) from the source vector src into off[mDst − ob]
    function evalRow(sx, r, src, off, ob) {
      const si = sx.mSrc[r], bi = SRC_POL[si];
      let s = src[si];
      const k = sx.mK[r];
      if (k !== 0) {
        if (bi === 0) s = (1 - exp(-k * s)) * sx.mKd[r];
        else {
          const a = s < 0 ? -s : s, b = (1 - exp(-k * a)) * sx.mKd[r];
          s = s < 0 ? -b : b;
        }
      }
      let x = sx.mBi[r] ? (bi ? 0.5 * s : s - 0.5) : s;
      const ai = sx.mAux[r];
      if (ai !== 0) {
        let a = src[ai];
        if (SRC_POL[ai]) a = (a + 1) * 0.5;
        a = a > 0 ? (a < 1 ? a : 1) : 0;
        x *= sx.mInv[r] ? 1 - a : a;
      }
      off[sx.mDst[r] - ob] += sx.mAmt[r] * x;
    }
    // point-modulated LFO graph l (§5.7) evaluated at phase ph with bus values from the eff vector E: evalPts on the
    // modified point list, computing a modified x/y only for the points the binary search and the segment touch
    // (O(log n); x' of a point depends only on its unmodified neighbours, so this equals evalPts on the full list)
    let pmY0 = 0;
    function pmX(P, M, off, n, j, E) {
      const b = 3 * (off + j), mx = M[2 * (off + j)];
      let x = P[b];
      if (mx > 0 && mx <= 16 && j > 0 && j < n - 1) {
        const xl = P[b - 3], xr = P[b + 3];
        x += 2 * E[BUS1 + mx - 1] - 1;
        x = x > xl ? (x < xr ? x : xr) : xl;
      }
      return x;
    }
    function pmY(P, M, off, j, E) {
      const my = M[2 * (off + j) + 1];
      let y = P[3 * (off + j) + 1];
      if (my > 0 && my <= 16) {
        y += 2 * E[BUS1 + my - 1] - 1;
        y = y > 0 ? (y < 1 ? y : 1) : 0;
      }
      return y;
    }
    function pmEval(sx, l, x, E) {
      const off = sx.lfoPtsOff[l];
      let n = sx.lfoPtsOff[l + 1] - off;
      if (n > MAX_PTS) n = MAX_PTS;
      if (n < 1) { pmY0 = 0; return 0; }
      const P = sx.lfoPts, M = sx.lfoPm, last = n - 1;
      pmY0 = pmY(P, M, off, 0, E);
      if (x <= 0 || x < P[3 * off]) return pmY0;                // first and last x are never modulated
      if (x >= 1 || P[3 * (off + last)] <= x) return pmY(P, M, off, last, E);
      let lo = 0, hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (pmX(P, M, off, n, mid, E) <= x) lo = mid; else hi = mid;
      }
      const x0 = pmX(P, M, off, n, lo, E), dx = pmX(P, M, off, n, lo + 1, E) - x0;
      if (dx <= 1e-9) return pmY(P, M, off, lo + 1, E);
      const y0 = pmY(P, M, off, lo, E);
      return y0 + (pmY(P, M, off, lo + 1, E) - y0) * bend((x - x0) / dx, CURVE_K * P[3 * (off + lo) + 2]);
    }
    // chaos generators: Rössler (k 0) / Lorenz (k 1) state at S[j..j+2], RK2 (midpoint) with sub-steps ≤ 0.02
    const CHAOS_T0 = Float64Array.from([6.07, 0.75]);
    function chaosInt(S, j, k, h) {
      if (!(h > 0)) return;
      let x = S[j], y = S[j + 1], z = S[j + 2];
      const n = h > 0.02 ? ceil(h / 0.02) : 1, dt = h / n;
      for (let i = 0; i < n; i++) {
        if (k === 0) {
          const xm = x + 0.5 * dt * (-y - z), ym = y + 0.5 * dt * (x + 0.2 * y), zm = z + 0.5 * dt * (0.2 + z * (x - 5.7));
          x += dt * (-ym - zm); y += dt * (xm + 0.2 * ym); z += dt * (0.2 + zm * (xm - 5.7));
        } else {
          const xm = x + 0.5 * dt * 10 * (y - x), ym = y + 0.5 * dt * (x * (28 - z) - y), zm = z + 0.5 * dt * (x * y - 2.6666666666666665 * z);
          x += dt * 10 * (ym - xm); y += dt * (xm * (28 - zm) - ym); z += dt * (xm * ym - 2.6666666666666665 * zm);
        }
      }
      if (!(x === x && y === y && z === z) || x > 1e6 || x < -1e6) { x = 1; y = 1; z = 1; }
      S[j] = x; S[j + 1] = y; S[j + 2] = z;
    }
    function chaosOut(S, j, k) {
      const v = k ? S[j] / 20 : S[j] / 12;
      return v > -1 ? (v < 1 ? v : 1) : -1;
    }
    // BPM snap (§6.13): nearest straight ladder entry 128·2^(−i) beats, i = 0…14, in log distance
    function snapRate(rate, bpm) {
      const beats = bpm / 60 / rate;
      let i = round(mlog2(128 / beats));
      i = i > 0 ? (i < 14 ? i : 14) : 0;
      return bpm / 60 / (128 * pow(2, -i));
    }
    function xorshift(s) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }

    /* ------------------------------------------------------------ per-processor state (§8.4.2, §5) */
    const SEED = 0x2545F491;                                   // processor PRNG seed (constant: renders are reproducible)
    function makeSnap() {
      return {
        eff: new Float32Array(ND), lfoPh: new Float32Array(8), lfoOut: new Float32Array(8), env: new Float32Array(3),
        envStage: new Uint8Array(3), envT: new Float32Array(3), wtPos: new Float32Array(2), noisePos: 0, notes: 0,
        oscVoices: 0, maxVoices: 0, memNow: new Float32Array(32), filtTap: new Float32Array(TAP_N), tapRate: 0,
      };
    }
    function attach(proc) {
      if (proc.sx) return proc.sx;
      const sx = {
        span: 0, nCh: 0, CH: 0, OS: 0, base: 0, fs: 0, ok: 0, mon: 0, dtC: 0, kF: 0, kM: 0, kSm: -1, dBeat: 0,
        // copies of the current CP (§4.1)
        cp: null, bT: new Float64Array(NS), mN: 0, mSrc: new Int8Array(32), mDst: new Int16Array(32), mAmt: new Float64Array(32),
        mBi: new Uint8Array(32), mK: new Float64Array(32), mKd: new Float64Array(32), mAux: new Int8Array(32),
        mInv: new Uint8Array(32), mCtx: new Uint8Array(32), mOn: new Uint8Array(32), fxN: 0,
        srcUsed: new Uint8Array(NSRC), modded: new Uint8Array(NS), modList: new Int16Array(NS), modN: 0,
        wtA: '', wtB: '', noiseId: '', uniMode: new Uint8Array(2), uniRange: new Float64Array(2), memSet: new Float64Array(32),
        subDirect: 0, noiseOneshot: 0, noiseKey: 0, noiseDirect: 0, filKey: 0, direct: 0,
        lfoMode: new Uint8Array(8), lfoBpm: new Uint8Array(8), lfoAnchor: new Uint8Array(8), lfoLad: new Float64Array(8 * 43),
        lfoLadN: new Uint8Array(8), chaosMono: new Uint8Array(2), chaosSh: new Uint8Array(2), macroT: new Float64Array(4),
        cMono: 0, cLegato: 0, cPoly: 8, cAlways: 0, cScaled: 0, a4: 440, smooth: 1, veloPorta: 0, notePorta: 0,
        // current CT (§4.1)
        ct: null, ctWarn: '', lfoTab: DEF_CT.lfoTab, lfoPtsOff: DEF_CT.lfoPtsOff, lfoPts: DEF_CT.lfoPts, lfoPm: DEF_CT.lfoPm,
        lfoPmAny: DEF_CT.lfoPmAny, lfoStart: DEF_CT.lfoStart, lfoLoop: DEF_CT.lfoLoop, remap: DEF_CT.remap,
        veloTab: DEF_CT.veloTab, noteTab: DEF_CT.noteTab,
        // base smoothing (§5.4)
        smS: new Float64Array(NS), smB: new Float64Array(NS), baseA: new Float64Array(NS), baseD: new Float64Array(NS),
        mov: new Int16Array(NS), movN: 0,
        // global sources [src·32 + c], beat clock, performance smoothers
        g: new Float64Array(NSRC * MAXCH), beatC: new Float64Array(MAXCH), beatClk: 0, bpm: 120,
        wheelS: 0, atS: 0, bendS: 0, macS: new Float64Array(4),
        // mono context (§5.5)
        monoSrc: new Float64Array(NSRC), monoOff: new Float64Array(NS), monoEff: new Float64Array(NS),
        // Off-mode LFOs and mono chaos
        oPh: new Float64Array(8), oSm: new Float64Array(8), oInit: new Uint8Array(8), oK: new Float64Array(8),
        oKs: new Float64Array(8), oY0: new Float64Array(8), mch: new Float64Array(6), mchOut: new Float64Array(2), mchHold: new Float64Array(2),
        mchTim: new Float64Array(2),
        fxOff: new Float64Array(NF),
        tap: new Float64Array(TAP_N), tapW: 0,
        memPh: new Float64Array(2), recent: null, lastPitch: -1, alt: 0, seed: SEED, rng: SEED,
        snap: makeSnap(),
        // first-use warm-up on the real patch (warmStart): hidden voices, spans left, tables wait, saved bookkeeping
        hw: null, hwL: null, hwR: null, hwN: 0, hwOn: 0, hwWait: 0, hwFs: 0,
        hwRec: null, hwLP: -1, hwMem: new Float64Array(2), hwAlt: 0, hwRng: 0,
      };
      proc.sx = sx;
      initSx(sx, proc);
      return sx;
    }
    function seedMonoChaos(sx) {
      let r = xorshift(sx.seed ^ 0x51ED27);
      for (let i = 0; i < 6; i++) { r = xorshift(r); sx.mch[i] = 1 + (r / 2147483648 - 1); }
      for (let k = 0; k < 2; k++) { sx.mchOut[k] = chaosOut(sx.mch, 3 * k, k); sx.mchHold[k] = sx.mchOut[k]; sx.mchTim[k] = 0; }
    }
    // the attach state (also restored by reset; sx.mon, the host's monitor subscription, is kept)
    function initSx(sx, proc) {
      sx.span = 0; sx.nCh = 0; sx.CH = 0; sx.OS = 0; sx.base = 0; sx.fs = 0; sx.ok = 0; sx.dtC = 0; sx.kF = 0; sx.kM = 0;
      sx.kSm = -1; sx.dBeat = 0;
      sx.cp = null; sx.bT.fill(0); sx.mN = 0; sx.mSrc.fill(0); sx.mDst.fill(0); sx.mAmt.fill(0); sx.mBi.fill(0); sx.mK.fill(0);
      sx.mKd.fill(0); sx.mAux.fill(0); sx.mInv.fill(0); sx.mCtx.fill(0); sx.mOn.fill(0); sx.fxN = 0;
      sx.srcUsed.fill(0); sx.modded.fill(0); sx.modList.fill(0); sx.modN = 0;
      sx.wtA = ''; sx.wtB = ''; sx.noiseId = ''; sx.uniMode.fill(0); sx.uniRange.fill(0); sx.memSet.fill(0);
      sx.subDirect = 0; sx.noiseOneshot = 0; sx.noiseKey = 0; sx.noiseDirect = 0; sx.filKey = 0; sx.direct = 0;
      sx.lfoMode.fill(2); sx.lfoBpm.fill(0); sx.lfoAnchor.fill(0); sx.lfoLad.fill(0); sx.lfoLadN.fill(1);
      sx.chaosMono.fill(0); sx.chaosSh.fill(0); sx.macroT.fill(0);
      sx.cMono = 0; sx.cLegato = 0; sx.cPoly = 8; sx.cAlways = 0; sx.cScaled = 0; sx.a4 = 440; sx.smooth = 1;
      sx.veloPorta = 0; sx.notePorta = 0;
      sx.ct = null; sx.ctWarn = '';
      sx.lfoTab = DEF_CT.lfoTab; sx.lfoPtsOff = DEF_CT.lfoPtsOff; sx.lfoPts = DEF_CT.lfoPts; sx.lfoPm = DEF_CT.lfoPm;
      sx.lfoPmAny = DEF_CT.lfoPmAny; sx.lfoStart = DEF_CT.lfoStart; sx.lfoLoop = DEF_CT.lfoLoop; sx.remap = DEF_CT.remap;
      sx.veloTab = DEF_CT.veloTab; sx.noteTab = DEF_CT.noteTab;
      sx.smS.fill(0); sx.smB.fill(0); sx.baseA.fill(0); sx.baseD.fill(0); sx.mov.fill(0); sx.movN = 0;
      sx.g.fill(0); sx.g.fill(1, S_FIXED * MAXCH, S_FIXED * MAXCH + MAXCH);
      sx.beatC.fill(0); sx.beatClk = 0; sx.bpm = 120;
      sx.wheelS = 0; sx.atS = 0; sx.bendS = 0; sx.macS.fill(0);
      sx.monoSrc.fill(0); sx.monoSrc[S_FIXED] = 1; sx.monoOff.fill(0); sx.monoEff.fill(0);
      sx.oPh.fill(0); sx.oSm.fill(0); sx.oInit.fill(0); sx.oK.fill(0); sx.oKs.fill(-1);
      for (let l = 0; l < 8; l++) sx.oY0[l] = DEF_CT.lfoTab[l * 1025];
      seedMonoChaos(sx);
      sx.fxOff.fill(0);
      sx.tap.fill(0); sx.tapW = 0;
      sx.memPh.fill(0); sx.recent = null; sx.lastPitch = -1; sx.alt = 0; sx.seed = SEED; sx.rng = SEED;
      sx.hw = null; sx.hwL = null; sx.hwR = null; sx.hwN = 0; sx.hwOn = 0; sx.hwWait = 0;   // a reset ends a warm-up
      const s = sx.snap;
      s.eff.fill(0); s.lfoPh.fill(0); s.lfoOut.fill(0); s.env.fill(0); s.envStage.fill(0); s.envT.fill(0); s.wtPos.fill(0);
      s.noisePos = 0; s.notes = 0; s.oscVoices = 0; s.maxVoices = 0; s.memNow.fill(0); s.filtTap.fill(0); s.tapRate = 0;
      rates(sx, proc);
    }
    // per-chunk coefficients (chunk = 4 base frames)
    function rates(sx, proc) {
      const base = proc.base > 0 ? +proc.base : 48000, fs = proc.fs > 0 ? +proc.fs : base, CH = proc.CH > 0 ? proc.CH | 0 : 8;
      sx.CH = CH; sx.base = base; sx.fs = fs; sx.OS = proc.OS > 0 ? proc.OS | 0 : 1;
      sx.dtC = CH / fs;
      sx.kF = 1 - exp(-4 / (base * 0.0015));
      sx.kM = 1 - exp(-4 / (base * 0.006 * sx.smooth));
      sx.kSm = sx.smooth;
      sx.oKs.fill(-1);
    }
    function snapBase(sx) {
      const bT = sx.bT;
      sx.smS.set(bT); sx.smB.set(bT); sx.baseA.set(bT); sx.baseD.fill(0);
      for (let i = 0; i < NS; i++) sx.mov[i] = i;
      sx.movN = NS;
      sx.macS.set(sx.macroT);
      for (let i = 0; i < NS; i++) sx.monoEff[i] = bT[i];
    }
    // a CP this script understands: same major version (§4.3; minor bumps only append DESTS/SOURCES, whose indices
    // syncCP ignores)
    function cpOk(cp) { return !!cp && floor(+cp.ver) === VER; }
    // copy the scalars and tables of a new CP into sx (once per CP object)
    function syncCP(proc, sx, cp) {
      if (sx.cp === cp) return;
      const first = sx.cp === null;
      sx.cp = cp; sx.ok = 1;
      const b = cp.base, bT = sx.bT;
      for (let i = 0; i < NS; i++) { const v = b ? +b[i] : 0; bT[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
      let mN = cp.mN | 0;
      mN = mN > 0 ? (mN < 32 ? mN : 32) : 0;
      sx.mN = mN;
      sx.modded.fill(0); sx.srcUsed.fill(0);
      let fxN = 0;
      for (let r = 0; r < mN; r++) {
        const si = cp.mSrc[r] | 0, di = cp.mDst[r] | 0, ai = cp.mAux ? cp.mAux[r] | 0 : 0, ctx = cp.mCtx[r] | 0;
        let amt = +cp.mAmt[r];
        if (!(si > 0 && si < NSRC && di >= 0 && di < ND && ai >= 0 && ai < NSRC && amt === amt)) amt = 0;
        sx.mSrc[r] = si > 0 && si < NSRC ? si : S_FIXED; sx.mDst[r] = di >= 0 && di < ND ? di : 0; sx.mAmt[r] = amt;
        sx.mBi[r] = cp.mBi[r] ? 1 : 0;
        let k = +cp.mK[r];
        if (!(k >= 1e-4 || k <= -1e-4)) k = 0;
        sx.mK[r] = k; sx.mKd[r] = k !== 0 ? 1 / (1 - exp(-k)) : 0;
        sx.mAux[r] = ai >= 0 && ai < NSRC ? ai : 0; sx.mInv[r] = cp.mInv && cp.mInv[r] ? 1 : 0;
        sx.mCtx[r] = di < NS ? ctx & 3 : 4; sx.mOn[r] = cp.mOn && cp.mOn[r] ? 1 : 0;
        if (di < NS && (ctx & 1)) sx.modded[di] = 1;
        if (di >= NS) fxN++;
        sx.srcUsed[sx.mSrc[r]] = 1;
        if (ai > 0) sx.srcUsed[ai] = 1;
      }
      sx.fxN = fxN;
      let mn = 0;
      for (let i = 0; i < NS; i++) if (sx.modded[i]) sx.modList[mn++] = i;
      sx.modN = mn;
      sx.wtA = cp.wt && typeof cp.wt[0] === 'string' ? cp.wt[0] : '';
      sx.wtB = cp.wt && typeof cp.wt[1] === 'string' ? cp.wt[1] : '';
      sx.noiseId = typeof cp.noiseId === 'string' ? cp.noiseId : '';
      for (let o = 0; o < 2; o++) {
        const m = cp.uniMode ? cp.uniMode[o] | 0 : 0, R = cp.uniRange ? +cp.uniRange[o] : 2;
        sx.uniMode[o] = m >= 0 && m <= 4 ? m : 0;
        sx.uniRange[o] = R > 0 ? (R < 48 ? R : 48) : 0;
      }
      for (let i = 0; i < 32; i++) { const v = cp.memSet ? +cp.memSet[i] : 0; sx.memSet[i] = v > 0 ? v - floor(v) : 0; }
      sx.subDirect = cp.subDirect ? 1 : 0; sx.noiseOneshot = cp.noiseOneshot ? 1 : 0; sx.noiseKey = cp.noiseKey ? 1 : 0;
      sx.noiseDirect = cp.noiseDirect ? 1 : 0; sx.filKey = cp.filKey ? 1 : 0; sx.direct = cp.direct ? 1 : 0;
      for (let l = 0; l < 8; l++) {
        const m = cp.lfoMode ? cp.lfoMode[l] | 0 : 2;
        sx.lfoMode[l] = m >= 0 && m <= 2 ? m : 2;
        sx.lfoBpm[l] = cp.lfoBpm && cp.lfoBpm[l] ? 1 : 0;
        sx.lfoAnchor[l] = cp.lfoAnchor && cp.lfoAnchor[l] ? 1 : 0;
        let L = cp.lfoLadN ? cp.lfoLadN[l] | 0 : 15;
        L = L >= 1 ? (L <= 43 ? L : 43) : 1;
        sx.lfoLadN[l] = L;
        for (let j = 0; j < 43; j++) { const v = cp.lfoLad ? +cp.lfoLad[l * 43 + j] : 0; sx.lfoLad[l * 43 + j] = v > 0 ? v : 0; }
      }
      for (let k = 0; k < 2; k++) {
        sx.chaosMono[k] = cp.chaosMono && cp.chaosMono[k] ? 1 : 0;
        sx.chaosSh[k] = cp.chaosSh && cp.chaosSh[k] ? 1 : 0;
      }
      for (let m = 0; m < 4; m++) sx.macroT[m] = clamp01(cp.macro ? +cp.macro[m] : 0);
      sx.cMono = cp.mono ? 1 : 0; sx.cLegato = cp.legato ? 1 : 0; sx.cPoly = cp.poly > 0 ? cp.poly | 0 : 8;
      sx.cAlways = cp.always ? 1 : 0; sx.cScaled = cp.scaled ? 1 : 0;
      sx.a4 = cp.a4 > 0 ? +cp.a4 : 440;
      const sm = cp.smooth > 0 ? +cp.smooth : 1;
      sx.smooth = sm < 0.01 ? 0.01 : sm > 8 ? 8 : sm;
      sx.veloPorta = cp.veloPorta ? 1 : 0; sx.notePorta = cp.notePorta ? 1 : 0;   // optional CP fields (§2.2 velo/note.porta)
      if (sx.kSm !== sx.smooth) rates(sx, proc);
      let sounding = false;
      const vs = proc.voices;
      if (vs && vs.length) for (let k = 0; k < vs.length; k++) if (vs[k] && vs[k].active) { sounding = true; break; }
      if (first || !sounding) snapBase(sx);
    }
    function syncCT(proc, sx) {
      const pc = proc.ct;
      const ct = pc && pc.lfoTab && pc.lfoPtsOff && pc.lfoPts && pc.remap && pc.veloTab && pc.noteTab ? pc : DEF_CT;
      if (sx.ct !== ct) {
        sx.ct = ct;
        sx.lfoTab = ct.lfoTab; sx.lfoPtsOff = ct.lfoPtsOff; sx.lfoPts = ct.lfoPts;
        sx.lfoPm = ct.lfoPm || DEF_CT.lfoPm; sx.lfoPmAny = ct.lfoPmAny || DEF_CT.lfoPmAny;
        sx.lfoStart = ct.lfoStart || DEF_CT.lfoStart; sx.lfoLoop = ct.lfoLoop || DEF_CT.lfoLoop;
        sx.remap = ct.remap; sx.veloTab = ct.veloTab; sx.noteTab = ct.noteTab;
        for (let l = 0; l < 8; l++) sx.oY0[l] = ct.lfoTab[l * 1025];
      }
      const cp = sx.cp;
      if (cp && ct !== DEF_CT && typeof cp.ctKey === 'string' && cp.ctKey !== ct.key && sx.ctWarn !== cp.ctKey) {
        sx.ctWarn = cp.ctKey;
        if (typeof console !== 'undefined') console.warn('serum-dsp: CP ctKey', cp.ctKey, 'differs from the stored CT', ct.key);
      }
    }
    // base smoothing once per span of nb base frames (§5.4): two cascaded one-poles, stepped laws jump
    function smoothSpan(sx, nb) {
      const k = 1 - exp(-nb / (sx.base * 0.006 * sx.smooth));
      const bT = sx.bT, s1 = sx.smS, s2 = sx.smB, bA = sx.baseA, bD = sx.baseD, mov = sx.mov, cont = LAW_TAB.cont;
      let n = 0;
      for (let i = 0; i < NS; i++) {
        const t = bT[i], old = s2[i];
        if (old === t && s1[i] === t) { bA[i] = t; bD[i] = 0; continue; }
        if (cont[i] === 0) { s1[i] = t; s2[i] = t; bA[i] = t; bD[i] = 0; mov[n++] = i; continue; }
        let a = s1[i] + (t - s1[i]) * k, b = old + (a - old) * k;
        const e = t - b;
        if (e < 1e-9 && e > -1e-9) { a = t; b = t; }
        s1[i] = a; s2[i] = b; bA[i] = old; bD[i] = b - old; mov[n++] = i;
      }
      sx.movN = n;
    }
    // Off-mode LFO l at chunk c (raw value through SMOOTH into g), then its phase advance
    function offLfo(sx, l, c) {
      const E = sx.monoEff, kb = L1_RATE + 4 * l, dt = sx.dtC;
      const n = E[kb];
      let beats = 0, ph;
      if (sx.lfoBpm[l]) beats = sx.lfoLad[l * 43 + round(n * (sx.lfoLadN[l] - 1))];
      if (beats > 0 && sx.lfoAnchor[l]) {
        const x = sx.lfoStart[l] + sx.beatC[c] / beats;
        ph = x - floor(x);
      } else ph = sx.oPh[l];
      sx.oPh[l] = ph;
      let y;                                                   // y0 (first point, modulated) for the voices' delay/rise
      if (sx.lfoPmAny[l]) { y = pmEval(sx, l, ph, E); sx.oY0[l] = pmY0; }
      else { y = tabAt(sx.lfoTab, l * 1025, 1024, ph); sx.oY0[l] = sx.lfoTab[l * 1025]; }
      const sm = E[kb + 3];
      if (!sx.oInit[l] || !(sm > 0)) { sx.oSm[l] = y; sx.oInit[l] = 1; }
      else {
        if (sm !== sx.oKs[l]) { sx.oKs[l] = sm; sx.oK[l] = 1 - exp(-dt / (0.5 * sm * sm * sm)); }
        sx.oSm[l] += (y - sx.oSm[l]) * sx.oK[l];
      }
      sx.g[(S_LFO1 + l) * MAXCH + c] = sx.oSm[l];
      if (!(beats > 0 && sx.lfoAnchor[l])) {
        const inc = sx.lfoBpm[l] ? (beats > 0 ? dt * sx.bpm / 60 / beats : 0) : dt * 100 * n * n * n * n;
        let p = ph + inc;
        p -= floor(p);
        sx.oPh[l] = p;
      }
    }
    // an Off-mode LFO that no row reads and no monitor shows: only its phase moves, by the same steps as offLfo (so
    // it is exactly where an evaluated one would be once a row reads it; its smoothing then restarts at its value).
    // Eight free LFOs evaluated per chunk made an idle Serum track cost ~20x an idle track of the other models.
    function offSkip(sx, l, nCh) {
      const E = sx.monoEff, kb = L1_RATE + 4 * l, dt = sx.dtC, n = E[kb];
      let beats = 0;
      if (sx.lfoBpm[l]) beats = sx.lfoLad[l * 43 + round(n * (sx.lfoLadN[l] - 1))];
      if (beats > 0 && sx.lfoAnchor[l]) {
        const x = sx.lfoStart[l] + sx.beatC[nCh - 1] / beats;
        sx.oPh[l] = x - floor(x);
      } else {
        const inc = sx.lfoBpm[l] ? (beats > 0 ? dt * sx.bpm / 60 / beats : 0) : dt * 100 * n * n * n * n;
        let p = sx.oPh[l];
        for (let c = 0; c < nCh; c++) { p += inc; p -= floor(p); }
        sx.oPh[l] = p;
      }
      sx.oInit[l] = 0;
    }
    // mono chaos k at chunk c: current output into g, then advance (§6.13)
    function monoChaos(sx, k, c) {
      sx.g[(S_CHAOS1 + k) * MAXCH + c] = sx.chaosSh[k] ? sx.mchHold[k] : sx.mchOut[k];
      const E = sx.monoEff, n = E[C1_RATE + k];
      let rate = 1000 * n * n * n * n * n;
      if (E[C1_BPM + k] >= 0.5 && rate > 0) rate = snapRate(rate, sx.bpm);
      if (rate > 0) {
        chaosInt(sx.mch, 3 * k, k, rate * CHAOS_T0[k] * sx.dtC);
        sx.mchOut[k] = chaosOut(sx.mch, 3 * k, k);
        if (sx.chaosSh[k]) {
          const per = 1 / rate;
          sx.mchTim[k] += sx.dtC;
          if (sx.mchTim[k] >= per) { sx.mchTim[k] -= per * floor(sx.mchTim[k] / per); sx.mchHold[k] = sx.mchOut[k]; }
        }
      }
    }
    // begin without the span count: smoothing, mono context, per-chunk global sources (§5.5 order)
    function core(proc, sx, N) {
      const CH = proc.CH | 0;
      let nCh = CH > 0 ? (N / CH) | 0 : 1;
      nCh = nCh > 1 ? (nCh < MAXCH ? nCh : MAXCH) : 1;
      sx.nCh = nCh;
      const p = proc.p, cp = p && p.serum;
      if (!cpOk(cp)) { sx.ok = 0; return; }
      syncCP(proc, sx, cp);
      syncCT(proc, sx);
      if (CH !== sx.CH || +proc.base !== sx.base || +proc.fs !== sx.fs || sx.kSm !== sx.smooth) rates(sx, proc);
      sx.bpm = proc.bpm > 0 ? +proc.bpm : 120;
      // (1) base smoothing for this span
      smoothSpan(sx, nCh * 4);
      // (2) mono context from the previous span's monoSrc
      const mo = sx.monoOff, me = sx.monoEff, bA = sx.baseA, bD = sx.baseD;
      mo.fill(0);
      for (let r = 0; r < sx.mN; r++) if (sx.mCtx[r] & 2) evalRow(sx, r, sx.monoSrc, mo, 0);
      for (let i = 0; i < NS; i++) { const v = bA[i] + bD[i] + mo[i]; me[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
      // (3) per chunk: performance smoothers, wheel/bend with their G destinations, Off LFOs, mono chaos
      const g = sx.g, kF = sx.kF, kM = sx.kM;
      const sb = typeof proc.songBeat === 'function' ? proc.songBeat() : null;
      const beat0 = typeof sb === 'number' && sb === sb ? sb : sx.beatClk;
      const dB = sx.dtC * sx.bpm / 60;
      sx.dBeat = dB;
      const wh = +proc.wheel || 0, at = +proc.at || 0, bn = +proc.bendRaw || 0;
      let lfoSkip = 0;                                          // Off LFOs nothing reads: phase only (offSkip)
      if (sx.mon === 0) for (let l = 0; l < 8; l++) if (sx.lfoMode[l] === 2 && sx.srcUsed[S_LFO1 + l] === 0) lfoSkip |= 1 << l;
      for (let c = 0; c < nCh; c++) {
        sx.beatC[c] = beat0 + c * dB;
        sx.wheelS += (wh - sx.wheelS) * kF;
        sx.atS += (at - sx.atS) * kF;
        sx.bendS += (bn - sx.bendS) * kF;
        g[S_WHEEL * MAXCH + c] = clamp01(sx.wheelS + mo[G_WHEEL]);
        g[S_AT * MAXCH + c] = sx.atS;
        g[S_BEND * MAXCH + c] = 2 * clamp01((sx.bendS + 1) * 0.5 + mo[G_BEND]) - 1;
        for (let m = 0; m < 4; m++) {
          sx.macS[m] += (sx.macroT[m] - sx.macS[m]) * kM;
          g[(S_MACRO1 + m) * MAXCH + c] = sx.macS[m];
        }
        g[S_FIXED * MAXCH + c] = 1;
        for (let l = 0; l < 8; l++) if (sx.lfoMode[l] === 2 && (lfoSkip & (1 << l)) === 0) offLfo(sx, l, c);
        if (sx.chaosMono[0]) monoChaos(sx, 0, c);
        if (sx.chaosMono[1]) monoChaos(sx, 1, c);
      }
      if (lfoSkip !== 0) for (let l = 0; l < 8; l++) if ((lfoSkip & (1 << l)) !== 0) offSkip(sx, l, nCh);
      sx.beatClk = beat0 + nCh * dB;
      if (sx.wheelS < 1e-30 && sx.wheelS > -1e-30) sx.wheelS = 0;                // denormal flush (§0.2)
      if (sx.atS < 1e-30 && sx.atS > -1e-30) sx.atS = 0;
      if (sx.bendS < 1e-30 && sx.bendS > -1e-30) sx.bendS = 0;
      for (let m = 0; m < 4; m++) if (sx.macS[m] < 1e-30 && sx.macS[m] > -1e-30) sx.macS[m] = 0;
      for (let l = 0; l < 8; l++) if (sx.oSm[l] < 1e-30 && sx.oSm[l] > -1e-30) sx.oSm[l] = 0;
      // (4) global sources of the last chunk into monoSrc (read by the next mono context and by fxMods)
      const last = nCh - 1, ms = sx.monoSrc;
      ms[S_WHEEL] = g[S_WHEEL * MAXCH + last]; ms[S_AT] = g[S_AT * MAXCH + last]; ms[S_BEND] = g[S_BEND * MAXCH + last];
      for (let m = 0; m < 4; m++) ms[S_MACRO1 + m] = g[(S_MACRO1 + m) * MAXCH + last];
      ms[S_FIXED] = 1;
      for (let l = 0; l < 8; l++) if (sx.lfoMode[l] === 2) ms[S_LFO1 + l] = g[(S_LFO1 + l) * MAXCH + last];
      for (let k = 0; k < 2; k++) if (sx.chaosMono[k]) ms[S_CHAOS1 + k] = g[(S_CHAOS1 + k) * MAXCH + last];
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
      for (let l = 0; l < 8; l++) { sx.oPh[l] = sx.lfoStart[l]; sx.oInit[l] = 0; }
      const sb = typeof proc.songBeat === 'function' ? proc.songBeat() : null;
      if (typeof sb === 'number' && sb === sb) sx.beatClk = sb;
      seedMonoChaos(sx);
      sx.alt = 0; sx.rng = sx.seed;
      // bookkeeping a fresh (offline) processor does not have: portamento start, Mem phases, the recent voice and the
      // mono source vector (back to its attach state; the next begin rewrites the global sources)
      sx.lastPitch = -1; sx.memPh.fill(0); sx.recent = null;
      sx.monoSrc.fill(0); sx.monoSrc[S_FIXED] = 1;
    }
    function reset(proc) {
      const sx = proc.sx;
      if (!sx) return;
      initSx(sx, proc);
    }
    function fxMods(proc) {
      const sx = proc.sx || attach(proc), o = sx.fxOff;
      o.fill(0);
      if (sx.fxN === 0 || !sx.ok) return o;
      for (let r = 0; r < sx.mN; r++) if (sx.mCtx[r] & 4) evalRow(sx, r, sx.monoSrc, o, FX_BASE);
      return o;
    }
    function snapshot(proc) {
      const sx = proc.sx;
      if (!sx) return null;
      const s = sx.snap, eff = s.eff, v = sx.recent, p = proc.p, fxp = p && p.fxr;
      if (v && v.played) for (let i = 0; i < NS; i++) eff[i] = v.eff[i];
      else for (let i = 0; i < NS; i++) eff[i] = sx.bT[i];
      const fb = fxp && fxp.base;
      for (let k = 0; k < NF; k++) {
        const x = (fb ? +fb[k] : 0) + sx.fxOff[k];
        eff[NS + k] = x > 0 ? (x < 1 ? x : 1) : 0;
      }
      for (let l = 0; l < 8; l++) {
        s.lfoPh[l] = sx.lfoMode[l] === 2 || !v ? sx.oPh[l] : v.lPh[l];
        s.lfoOut[l] = v ? v.lVal[l] : sx.oSm[l];
      }
      if (v) {
        for (let e = 0; e < 3; e++) { s.env[e] = v.eV[e]; s.envStage[e] = v.eSt[e]; s.envT[e] = v.eT[e]; }
        s.wtPos[0] = v.wPos[0]; s.wtPos[1] = v.wPos[1];
        s.noisePos = v.nLen0 > 0 ? v.nPos / v.nLen0 : 0;
        for (let o = 0; o < 2; o++) {
          const N = v.uN[o], p0 = v.uPh[o * 16];
          for (let i = 0; i < 16; i++) {
            let d = i < N ? v.uPh[o * 16 + i] - p0 : 0;
            d -= floor(d);
            s.memNow[o * 16 + i] = d;
          }
        }
      } else {
        s.env.fill(0); s.envStage.fill(0); s.envT.fill(0); s.wtPos.fill(0); s.noisePos = 0; s.memNow.fill(0);
      }
      let notes = 0, osc = 0;
      const vs = proc.voices;
      if (vs) {
        for (let k = 0; k < vs.length; k++) {
          const w = vs[k];
          if (!w) continue;
          if (w.gate) notes++;
          if (w.active && w.uN) osc += (w.onA ? w.uN[0] : 0) + (w.onB ? w.uN[1] : 0) + w.onS + w.onN;
        }
      }
      s.notes = notes; s.oscVoices = osc;
      const bT = sx.bT;
      s.maxVoices = sx.ok ? (sx.cMono ? 1 : sx.cPoly) * (16 * (bT[A_ON] >= 0.5 ? 1 : 0) + 16 * (bT[A_ON + 1] >= 0.5 ? 1 : 0) +
        (bT[S_ON] >= 0.5 ? 1 : 0) + (bT[N_ON] >= 0.5 ? 1 : 0)) : 0;
      for (let j = 0; j < TAP_N; j++) s.filtTap[j] = sx.tap[(sx.tapW + j) & (TAP_N - 1)];
      s.tapRate = +proc.fs || 0;
      return s;
    }

    /* ------------------------------------------------------------ module scratch (one chunk, ≤ 32 samples) */
    const AL = new Float64Array(MAXCH), AR = new Float64Array(MAXCH), BL = new Float64Array(MAXCH), BR = new Float64Array(MAXCH);
    const NL = new Float64Array(MAXCH), NR = new Float64Array(MAXCH), SL = new Float64Array(MAXCH), SR = new Float64Array(MAXCH);
    const NRAW = new Float64Array(MAXCH), SRAW = new Float64Array(MAXCH), ZERO = new Float64Array(MAXCH);
    const RAW0 = new Float64Array(16 * MAXCH), RAW1 = new Float64Array(16 * MAXCH);
    const PHB = new Float64Array(MAXCH), WIN = new Float64Array(MAXCH), YB = new Float64Array(MAXCH), YB2 = new Float64Array(MAXCH);
    const FINL = new Float64Array(MAXCH), FINR = new Float64Array(MAXCH), WETL = new Float64Array(MAXCH), WETR = new Float64Array(MAXCH);
    const DRYL = new Float64Array(MAXCH), DRYR = new Float64Array(MAXCH);
    const MAXPH = 1 - pow(2, -24);
    const FC_L2 = mlog2(22050 / MIDI0);

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
    // fused plain reads (warp Off / neutral): one frame, or two frames blended with t ramping by dt per sample
    const FA = new Float64Array(9);
    function plain1(d, b, m, len, ph, inc, OL, OR, gl, gr, dgl, dgr, CH) {
      for (let s = 0; s < CH; s++) {
        const x = ph * len, i = x | 0, f = x - i;
        const xm = d[b + ((i - 1) & m)], x0 = d[b + (i & m)], x1 = d[b + ((i + 1) & m)], x2 = d[b + ((i + 2) & m)];
        const y = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
        gl += dgl; gr += dgr;
        OL[s] += gl * y; OR[s] += gr * y;
        ph += inc;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      return ph;
    }
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
    // read pass of the general path: Y[s] = table at PHB[s] (two frames blended when two; t, dt in FA[7], FA[8])
    function readPass(d, ba, bb, m, len, two, Y, CH) {
      let t = FA[7];
      const dt = FA[8];
      for (let s = 0; s < CH; s++) {
        const x = PHB[s] * len, i = x | 0, f = x - i;
        let y = hermAt(d, ba, m, i, f);
        if (two) { t += dt; y += t * (hermAt(d, bb, m, i, f) - y); }
        Y[s] = y;
      }
    }
    // one level of the general path (t0, dt in FA[7], FA[8]); xa ≥ 0 (interpolating table whose frame pair changed):
    // the old pair (xa, xa + 1) at xt = FA[6] crossfades into the new one over the chunk
    function readLv(d, len, fa, fb, two, xa, Y, CH) {
      const m = len - 1;
      readPass(d, fa * len, fb * len, m, len, two, Y, CH);
      if (xa < 0) return;
      const ba = xa * len, bb = ba + len, iC = 1 / CH, xt = FA[6];
      for (let s = 0; s < CH; s++) {
        const x = PHB[s] * len, i = x | 0, f = x - i;
        let y = hermAt(d, ba, m, i, f);
        if (xt !== 0) y += xt * (hermAt(d, bb, m, i, f) - y);
        Y[s] = y + (Y[s] - y) * ((s + 1) * iC);
      }
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

    /* ------------------------------------------------------------ SerumVoice (§8.4.3, §6) */
    let warnedVer = false;
    class SerumVoice {
      constructor(proc, i) {
        this.proc = proc; this.i = i | 0;
        this.active = false; this.gate = false; this.note = -1; this.stamp = 0; this.sus = false; this.vel = 0;
        this.ok = 0; this.relvel = 0.5; this.played = 0;
        this.r = ((0x9E3779B9 * (this.i + 7)) >>> 0) || 1;   // voice PRNG state (xorshift32)
        attach(proc);
        this.fs = proc.fs > 0 ? +proc.fs : 96000; this.CH = proc.CH > 0 ? proc.CH | 0 : 8;
        this.base = proc.base > 0 ? +proc.base : 48000;
        this.dt = this.CH / this.fs; this.flim = this.fs - (0.45 * this.base < 20000 ? 0.45 * this.base : 20000);
        this.xf = this.flim < 40000 ? 1 : 0;                 // level blending where the dropped octave is audible (§7.4)
        this.m0 = 1; this.margin();
        this.span = -1; this.fresh = 0; this.spare = 0;
        this.filt = new SFilter(this.fs);
        // modulation
        this.eff = new Float64Array(NS); this.off = new Float64Array(NS); this.src = new Float64Array(NSRC);
        this.src[S_FIXED] = 1;
        this.md = new Uint8Array(NS); this.mdCp = null;           // modded mask of the CP this voice last evaluated
        this.eOn = new Float64Array(3);                          // envelope values before a note-on restart (§6.1)
        // envelopes (stage 0 idle, 1 A, 2 H, 3 D, 4 S, 5 R)
        this.eSt = new Int32Array(3); this.eQ = new Float64Array(3); this.eV = new Float64Array(3); this.eV0 = new Float64Array(3);
        this.eVR = new Float64Array(3); this.eT = new Float64Array(3);
        // LFOs
        this.lPh = new Float64Array(8); this.lSm = new Float64Array(8); this.lVal = new Float64Array(8); this.lB0 = new Float64Array(8);
        this.lDone = new Uint8Array(8); this.lK = new Float64Array(8); this.lKs = new Float64Array(8).fill(-1); this.ly0 = 0;
        this.tau = 0;
        // chaos (per voice)
        this.ch = new Float64Array(6); this.cOut = new Float64Array(2); this.cHold = new Float64Array(2); this.cTim = new Float64Array(2);
        // note-on values
        this.vVelo = 0; this.vNote = 0; this.vR1 = 0; this.vR2 = 0; this.vAlt = 0; this.patS = 0;
        // pitch / portamento
        this.nP = 60; this.gS = 60; this.gTg = 60; this.gQ = 1;
        // oscillators: [o·16 + i] per unison voice
        this.uN = new Int32Array(2); this.uNx = new Int32Array(2); this.uPh = new Float64Array(32); this.uLv = new Int32Array(32).fill(-1);
        this.uFa = new Int32Array(32).fill(-1); this.uFp = new Float64Array(32); this.uGL = new Float64Array(32);
        this.uGR = new Float64Array(32); this.uRnd = new Float64Array(32); this.uRat = new Float64Array(32).fill(1);
        this.uPL = new Float64Array(32).fill(1); this.uPR = new Float64Array(32).fill(1); this.uEl = new Float64Array(32);
        this.uH = new Float64Array(32).fill(-1); this.uLx = new Int32Array(32).fill(-1); this.uWx = new Float64Array(32).fill(1);
        this.oOff = new Float64Array(2); this.wPos = new Float64Array(2);
        this.cDet = new Float64Array(2).fill(-1); this.cStk = new Int32Array(2).fill(-1); this.cN = new Int32Array(2);
        this.cMode = new Int32Array(2).fill(-1); this.cR = new Float64Array(2).fill(-1); this.cW = new Float64Array(2).fill(-1);
        this.cWN = new Int32Array(2); this.cBl = new Float64Array(2).fill(-1); this.cBN = new Int32Array(2);
        this.gC = new Float64Array(2).fill(1); this.gSd = new Float64Array(2).fill(1); this.comp = new Float64Array(2).fill(1);
        this.cPan = new Float64Array(2).fill(-9); this.bl = new Float64Array(2).fill(1); this.br = new Float64Array(2).fill(1);
        this.onA = 0; this.onB = 0; this.onS = 0; this.onN = 0;
        // wavetables
        this.wId0 = ''; this.wId1 = ''; this.wEp = new Float64Array(2).fill(-1); this.wOk = new Uint8Array(2);
        this.wF = new Int32Array(2).fill(1); this.wI = new Uint8Array(2);
        this.lvD = new Array(22).fill(EMPTY32); this.lvLen = new Int32Array(22).fill(4); this.lvHarm = new Float64Array(22).fill(1);
        // blended frames (bcGet): two cached levels per oscillator, and the last position asked for per oscillator
        this.bcF = [new Float32Array(2048), new Float32Array(2048), new Float32Array(2048), new Float32Array(2048)];
        this.bcD = new Array(4).fill(EMPTY32); this.bcE = new Float64Array(4).fill(-1); this.bcA = new Int32Array(4).fill(-1);
        this.bcB = new Int32Array(4).fill(-1); this.bcT = new Float64Array(4).fill(-1); this.bcR = new Uint8Array(2);
        this.skD = new Array(2).fill(EMPTY32); this.skE = new Float64Array(2).fill(-1); this.skA = new Int32Array(2).fill(-1);
        this.skB = new Int32Array(2).fill(-1); this.skT = new Float64Array(2).fill(-1); this.skC = new Float64Array(2).fill(-1);
        this.chk = 0;
        // sub
        this.sPh = 0; this.sLv = -1; this.sGL = 0; this.sGR = 0; this.sShape = -1; this.sEp = -1; this.sOk = 0;
        this.sD = new Array(11).fill(EMPTY32); this.sLen = new Int32Array(11).fill(4); this.sHarm = new Float64Array(11).fill(1);
        this.sPan = -9; this.sCl = 1; this.sCr = 1;
        // noise
        this.nPos = 0; this.nOffP = 0; this.nLv = -1; this.nGL = 0; this.nGR = 0; this.nId = ''; this.nEp = -1; this.nOk = 0;
        this.nLevels = 0; this.nLvL = new Array(6).fill(EMPTY32); this.nLvR = new Array(6).fill(EMPTY32);
        this.nLen = new Int32Array(6); this.nLs = new Float64Array(6); this.nLe = new Float64Array(6);
        this.nRate = 48000; this.nRoot = 60; this.nLen0 = 0; this.nDone = 0; this.nLast = 0; this.nPan = -9; this.nCl = 1; this.nCr = 1;
        // mixer ramps
        this.gAmp = 0; this.rg = new Float64Array(4); this.mixP = 1; this.fIdle = 1;
      }
      rnd() { this.r = xorshift(this.r) || 1; return this.r / 4294967296; }
      // level-0 margin m0 (file header): as large as level 1 still reaches the audible band limit, at most 1.4
      margin() {
        const band = 0.45 * this.base < 20000 ? 0.45 * this.base : 20000, m = this.flim / (2 * band);
        this.m0 = m > 1 ? (m < 1.4 ? m : 1.4) : 1;
      }

      apply(p) {
        const proc = this.proc, sx = attach(proc), cp = p && p.serum;
        const ok = cpOk(cp) ? 1 : 0;
        if (cp && !ok && !warnedVer) {
          warnedVer = true;
          if (typeof console !== 'undefined') console.warn('serum-dsp: CP version', cp.ver, 'not understood (expects', VER + ')');
        }
        this.ok = ok;
        const fs = proc.fs > 0 ? +proc.fs : this.fs, CH = proc.CH > 0 ? proc.CH | 0 : this.CH, base = proc.base > 0 ? +proc.base : this.base;
        if (fs !== this.fs || CH !== this.CH || base !== this.base) {
          this.fs = fs; this.CH = CH; this.base = base;
          this.lKs.fill(-1);
        }
        this.dt = this.CH / this.fs;
        this.flim = this.fs - (0.45 * this.base < 20000 ? 0.45 * this.base : 20000);
        this.xf = this.flim < 40000 ? 1 : 0;
        this.margin();
        this.uH.fill(-1);                                         // level selection depends on fs/flim/xf/m0
        this.filt.setRate(this.fs);
        this.cDet.fill(-1);
        if (!ok) return;
        syncCP(proc, sx, cp);
        syncCT(proc, sx);
        // a spare voice (engine-owned flag: above POLY, never addressed, §11.3) keeps its filter type and gets no delay
        // lines until POLY reaches it (a delay family costs up to 1.1 MB per voice); a modulated type preallocates only
        // the families its matrix rows can reach (base ± the sum of their amounts)
        if (this.spare === 1 && !this.active) return;
        const bt = round(95 * clamp01(sx.bT[F_TYPE]));
        if (cp.modded && cp.modded[F_TYPE]) {
          let a = 0;
          for (let r = 0; r < sx.mN; r++) if (sx.mDst[r] === F_TYPE) { const m = sx.mAmt[r]; a += m < 0 ? -m : m; }
          const b = sx.bT[F_TYPE];
          this.filt.prealloc(true, floor(95 * clamp01(b - a)), ceil(95 * clamp01(b + a)));
        } else this.filt.prealloc(false);
        if (!this.active) this.filt.setType(bt);
        else this.filt.ensure(FILTER_FAM_OF[bt]);
      }

      noteOn(n, vel01, legato, glc) {
        const proc = this.proc, sx = attach(proc);
        n = +n;
        vel01 = vel01 > 0 ? (vel01 < 1 ? +vel01 : 1) : 0;
        const wasActive = this.active;
        this.note = n; this.vel = vel01;
        this.gate = true; this.sus = false;
        if (!this.ok || !this.sync(sx)) { this.active = false; this.gate = false; return; }
        legato = !!legato && wasActive;
        const vs = proc.voices;
        // poly legato reference R and overlap
        let R = null, other = false;
        if (vs && vs.length) {
          for (let k = 0; k < vs.length; k++) {
            const w = vs[k];
            if (!w || w === this || !w.gate || !w.active || w.eSt === undefined) continue;
            other = true;
            if (!R || w.stamp > R.stamp) R = w;
          }
        }
        const polyLeg = !legato && sx.cLegato === 1 && sx.cMono === 0 && R !== null;
        if (!polyLeg) R = null;
        // processor flip-flop, voice PRNG, note-on draws
        sx.alt = sx.alt ? 0 : 1;
        if (!legato) {
          sx.rng = xorshift(sx.rng) || 1;
          this.r = xorshift(sx.rng ^ (0x9E3779B9 * (this.i + 1))) || 1;
          this.vR1 = this.rnd(); this.vR2 = this.rnd(); this.vAlt = sx.alt;
          this.relvel = 0.5;
        }
        this.vNote = tabAt(sx.noteTab, 0, 128, n / 127);            // also on legato notes (the new key, §5.3)
        if (!legato || sx.veloPorta) this.vVelo = tabAt(sx.veloTab, 0, 128, vel01);
        // modulation vector of a fresh voice starts at the current bases; a sounding one drops removed rows first
        const eff = this.eff, bA = sx.baseA, bD = sx.baseD;
        if (!wasActive) {
          const md = sx.modded, vm = this.md;
          for (let i = 0; i < NS; i++) { eff[i] = bA[i] + bD[i]; vm[i] = md[i]; }
          this.mdCp = sx.cp;
        } else this.unmod(sx, 1);
        // portamento (§6.1)
        const lastPitch = sx.lastPitch;
        const pt = 8 * pow(eff[G_PORTA], 5);
        const overlap = legato || (sx.cMono === 1 && proc.held && proc.held.length > 1) || (sx.cMono === 0 && other);
        let start = n;
        if (pt > 0 && (sx.cAlways === 1 || overlap)) start = R ? R.nP : lastPitch >= 0 ? (legato ? this.nP : lastPitch) : n;
        this.gS = start; this.gTg = n; this.gQ = start === n ? 1 : 0; this.nP = start;
        if (legato) { this.setRecent(sx); return; }
        // envelopes (the note-on evaluation sees their values before the restart: 0 fresh, current level on a steal,
        // R's level under poly legato)
        for (let e = 0; e < 3; e++) this.eOn[e] = R ? R.eV[e] : (wasActive ? this.eV[e] : 0);
        for (let e = 0; e < 3; e++) {
          if (R) {
            this.eSt[e] = R.eSt[e]; this.eQ[e] = R.eQ[e]; this.eV[e] = R.eV[e]; this.eV0[e] = R.eV0[e]; this.eVR[e] = R.eVR[e];
            this.eT[e] = R.eT[e];
          } else {
            const v0 = wasActive ? this.eV[e] : 0;
            this.eSt[e] = 1; this.eQ[e] = 0; this.eT[e] = 0; this.eV[e] = v0; this.eV0[e] = v0;
          }
          this.envTick(e, 0);
        }
        // LFOs (Trig/Env restart at lfoStart; poly legato copies R's phase and elapsed time)
        this.tau = R ? R.tau : 0;
        for (let l = 0; l < 8; l++) {
          if (sx.lfoMode[l] === 2) continue;
          if (R) { this.lPh[l] = R.lPh[l]; this.lB0[l] = R.lB0[l]; this.lDone[l] = R.lDone[l]; }
          else { this.lPh[l] = sx.lfoStart[l]; this.lB0[l] = sx.beatClk; this.lDone[l] = 0; }
        }
        // chaos per voice
        for (let k = 0; k < 2; k++) {
          for (let j = 0; j < 3; j++) this.ch[3 * k + j] = 1 + (2 * this.rnd() - 1);
          this.cOut[k] = chaosOut(this.ch, 3 * k, k); this.cHold[k] = this.cOut[k]; this.cTim[k] = 0;
        }
        // note-on evaluation (§6.1) of the mOn rows
        const src = this.src, gc = (sx.nCh > 0 ? sx.nCh : 1) - 1, g = sx.g;
        src[S_WHEEL] = g[S_WHEEL * MAXCH + gc]; src[S_AT] = g[S_AT * MAXCH + gc]; src[S_BEND] = g[S_BEND * MAXCH + gc];
        for (let m = 0; m < 4; m++) src[S_MACRO1 + m] = g[(S_MACRO1 + m) * MAXCH + gc];
        src[S_FIXED] = 1;
        for (let e = 0; e < 3; e++) src[S_ENV1 + e] = this.eOn[e];
        for (let l = 0; l < 8; l++) {
          const kb = L1_RATE + 4 * l, tsc = sx.lfoBpm[l] ? 120 / sx.bpm : 1;
          const dr = 4 * (eff[kb + 2] + eff[kb + 1]) * tsc;
          let v;
          if (sx.lfoMode[l] === 2) v = dr > 0 ? sx.oY0[l] : g[(S_LFO1 + l) * MAXCH + gc];
          else if (R) v = R.lVal[l];
          else {
            const y = this.lfoRaw(l, this.lPh[l]);
            v = dr > 0 ? this.ly0 : y;
          }
          this.lSm[l] = v; this.lVal[l] = v; src[S_LFO1 + l] = v;
        }
        src[S_VELO] = this.vVelo; src[S_NOTE] = this.vNote;
        src[S_PAT] = proc.patSeen && n >= 0 && n < 128 && proc.pat ? +proc.pat[n] || 0 : src[S_AT];
        this.patS = src[S_PAT];
        for (let k = 0; k < 2; k++) {
          src[S_CHAOS1 + k] = sx.chaosMono[k] ? g[(S_CHAOS1 + k) * MAXCH + gc] : (sx.chaosSh[k] ? this.cHold[k] : this.cOut[k]);
        }
        src[S_NOISE] = 0; src[S_RAND1] = this.vR1; src[S_RAND2] = this.vR2; src[S_ALT1] = this.vAlt; src[S_ALT2] = 1 - this.vAlt;
        src[S_MPEX] = 0; src[S_MPEX + 1] = 0; src[S_MPEX + 2] = 0; src[S_RELVEL] = 0.5;
        const off = this.off;
        for (let r = 0; r < sx.mN; r++) if (sx.mOn[r]) off[sx.mDst[r]] = 0;
        for (let r = 0; r < sx.mN; r++) if (sx.mOn[r]) evalRow(sx, r, src, off, 0);
        for (let r = 0; r < sx.mN; r++) {
          if (!sx.mOn[r]) continue;
          const d = sx.mDst[r], v = bA[d] + bD[d] + off[d];
          eff[d] = v > 0 ? (v < 1 ? v : 1) : 0;
        }
        // unison counts, random detunes
        const resetPh = !wasActive || (sx.cLegato === 1 && sx.cMono === 0);
        for (let o = 0; o < 2; o++) {
          const kB = o * 17, oldN = wasActive ? this.uN[o] : 0;
          let oldX = wasActive ? this.uNx[o] : 0;                    // unison voices still fading from an earlier steal
          if (oldX < oldN) oldX = oldN;
          const N = round(1 + 15 * eff[kB + D_UNI]);
          this.uN[o] = N;
          this.uNx[o] = oldX > N ? oldX : 0;                           // dropped unison voices fade out over one chunk
          for (let i = 0; i < 16; i++) this.uRnd[o * 16 + i] = 2 * this.rnd() - 1;
          this.cDet[o] = -1;
          for (let i = resetPh ? 0 : oldN; i < 16; i++) {
            const idx = o * 16 + i;
            if (!wasActive || (i >= oldN && (i < N || i >= oldX))) {
              this.uGL[idx] = 0; this.uGR[idx] = 0; this.uLv[idx] = -1; this.uFa[idx] = -1;
            }
          }
          // start phases (§6.4): every unison voice on reset, only the new ones otherwise (steal, mono overlap)
          const ph = eff[kB + D_PHASE], rd = eff[kB + D_RAND];
          const mem = sx.bT[kB + D_PHASE] >= 0.9995, trig = sx.bT[kB + D_RAND] >= 0.9995;
          const offs = mem ? 0 : (ph < 0.99999 ? ph : 0.99999);
          for (let i = resetPh ? 0 : oldN; i < N; i++) {
            let st;
            if (!mem) st = rd * this.rnd();
            else if (!trig) { st = sx.memPh[o] + sx.memSet[o * 16 + i]; st -= floor(st); }
            else st = sx.memSet[o * 16 + i];
            let p = st + offs;
            p -= floor(p);
            this.uPh[o * 16 + i] = p;
          }
          if (resetPh) this.oOff[o] = offs;
        }
        if (resetPh) this.sPh = 0;
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
        // fresh voice: filter cleared, ramps start at their targets, ENV1×AMP from 0
        if (!wasActive) {
          this.filt.reset(); this.fIdle = 0;
          this.gAmp = 0; this.sLv = -1;
          this.fresh = 1;
        }
        this.active = true; this.played = 1;
        this.setRecent(sx);
      }
      setRecent(sx) {
        sx.recent = this;
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
      // destinations whose last voice-context row disappeared since this voice last evaluated the matrix (row removed,
      // bypassed, amount 0, re-targeted) return to their base (§5.1); once per CP change
      unmod(sx, fr) {
        if (this.mdCp === sx.cp) return;
        this.mdCp = sx.cp;
        const md = sx.modded, vm = this.md, eff = this.eff, bA = sx.baseA, bD = sx.baseD;
        for (let i = 0; i < NS; i++) {
          if (vm[i] !== 0 && md[i] === 0) eff[i] = bA[i] + bD[i] * fr;
          vm[i] = md[i];
        }
      }
      noteOff(rv) {
        this.gate = false;
        this.relvel = rv === undefined || rv === null || !(rv >= 0) ? 0.5 : (rv < 1 ? +rv : 1);
        for (let e = 0; e < 3; e++) {
          if (this.eSt[e] !== 0 && this.eSt[e] !== 5) { this.eVR[e] = this.eV[e]; this.eSt[e] = 5; this.eQ[e] = 0; this.eT[e] = 0; }
        }
      }
      kill() {
        this.active = false; this.gate = false; this.sus = false;
        this.filt.reset();
        this.eSt.fill(0); this.eQ.fill(0); this.eV.fill(0); this.eT.fill(0);
        this.gAmp = 0; this.uGL.fill(0); this.uGR.fill(0); this.sGL = 0; this.sGR = 0; this.nGL = 0; this.nGR = 0;
        this.uLv.fill(-1); this.uFa.fill(-1); this.sLv = -1; this.nLv = -1; this.uNx.fill(0);
      }

      render(bufL, bufR, N, dirL, dirR) {
        if (!this.active || !this.ok) return;
        const sx = this.proc.sx;
        if (!sx || !this.sync(sx)) return;
        const CH = this.CH;
        let nCh = (N / CH) | 0;
        if (nCh > MAXCH) nCh = MAXCH;
        const extra = sx.span === 0 || this.span === sx.span;
        this.span = sx.span;
        const sN = sx.nCh > 0 ? sx.nCh : 1;
        const dir = dirL !== undefined && dirL !== null && dirR !== undefined && dirR !== null && sx.direct === 1;
        for (let c = 0; c < nCh; c++) {
          const gc = extra ? sN - 1 : (c < sN ? c : sN - 1);
          const fr = extra ? 1 : (c + 1) / sN;
          if (!this.chunk(bufL, bufR, dir ? dirL : bufL, dir ? dirR : bufR, c * CH, gc, fr)) break;
        }
        if (sx.recent === this) {
          const ms = sx.monoSrc, s = this.src;
          for (let k = 0; k < NSRC; k++) ms[k] = s[k];
          sx.lastPitch = this.nP;
          for (let o = 0; o < 2; o++) { let p = this.uPh[o * 16] - this.oOff[o]; p -= floor(p); sx.memPh[o] = p; }
        }
      }

      // one chunk (§5.6); returns false once the voice became inactive
      chunk(bufL, bufR, dirL, dirR, o0, gc, fr) {
        const sx = this.proc.sx, eff = this.eff;
        this.chk++;
        if (!this.gate && this.eV[0] <= 1e-5 && this.gAmp <= 1e-5 && this.fresh === 0) {
          this.active = false;
          for (let e = 0; e < 3; e++) { this.eSt[e] = 0; this.eV[e] = 0; }
          return false;
        }
        const mv = sx.mov, mvN = sx.movN, bA = sx.baseA, bD = sx.baseD, md = sx.modded;
        this.unmod(sx, fr);
        for (let j = 0; j < mvN; j++) { const i = mv[j]; if (md[i] === 0) eff[i] = bA[i] + bD[i] * fr; }
        this.sources(sx, gc);
        if (sx.mN > 0) this.matrix(sx, fr);
        this.renderChunk(sx, bufL, bufR, dirL, dirR, o0);
        this.advance(sx, gc);
        this.fresh = 0;
        return true;
      }

      sources(sx, gc) {
        const s = this.src, g = sx.g, used = sx.srcUsed, proc = this.proc;
        s[S_WHEEL] = g[S_WHEEL * MAXCH + gc]; s[S_AT] = g[S_AT * MAXCH + gc]; s[S_BEND] = g[S_BEND * MAXCH + gc];
        s[S_MACRO1] = g[S_MACRO1 * MAXCH + gc]; s[S_MACRO1 + 1] = g[(S_MACRO1 + 1) * MAXCH + gc];
        s[S_MACRO1 + 2] = g[(S_MACRO1 + 2) * MAXCH + gc]; s[S_MACRO1 + 3] = g[(S_MACRO1 + 3) * MAXCH + gc];
        s[S_FIXED] = 1;
        s[S_ENV1] = this.eV[0]; s[S_ENV1 + 1] = this.eV[1]; s[S_ENV1 + 2] = this.eV[2];
        const mon = sx.mon && sx.recent === this;
        for (let l = 0; l < 8; l++) if (used[S_LFO1 + l] || mon) s[S_LFO1 + l] = this.lfoVal(sx, l, gc);
        s[S_VELO] = this.vVelo;
        s[S_NOTE] = sx.notePorta ? tabAt(sx.noteTab, 0, 128, this.nP / 127) : this.vNote;
        if (proc.patSeen) {
          const n = this.note, t = n >= 0 && n < 128 && proc.pat ? +proc.pat[n] || 0 : 0;
          this.patS += (t - this.patS) * sx.kF;
          if (this.patS < 1e-30) this.patS = 0;
          s[S_PAT] = this.patS;
        } else { this.patS = s[S_AT]; s[S_PAT] = s[S_AT]; }
        for (let k = 0; k < 2; k++) {
          s[S_CHAOS1 + k] = sx.chaosMono[k] ? g[(S_CHAOS1 + k) * MAXCH + gc] : (sx.chaosSh[k] ? this.cHold[k] : this.cOut[k]);
        }
        s[S_NOISE] = this.onN ? this.nLast : 0;
        s[S_RAND1] = this.vR1; s[S_RAND2] = this.vR2; s[S_ALT1] = this.vAlt; s[S_ALT2] = 1 - this.vAlt;
        s[S_RELVEL] = this.relvel;
      }
      // LFO l source value at the chunk start (§6.12)
      lfoVal(sx, l, gc) {
        const eff = this.eff, kb = L1_RATE + 4 * l, tsc = sx.lfoBpm[l] ? 120 / sx.bpm : 1;
        const dly = 4 * eff[kb + 2] * tsc, rise = 4 * eff[kb + 1] * tsc, t = this.tau;
        if (sx.lfoMode[l] === 2) {
          const y = sx.g[(S_LFO1 + l) * MAXCH + gc], y0 = sx.oY0[l];
          const v = t < dly ? y0 : (rise > 0 && t < dly + rise ? y0 + (y - y0) * ((t - dly) / rise) : y);
          this.lVal[l] = v;
          return v;
        }
        const y = this.lfoRaw(l, this.lPh[l]), y0 = this.ly0;
        const v = t < dly ? y0 : (rise > 0 && t < dly + rise ? y0 + (y - y0) * ((t - dly) / rise) : y);
        const sm = eff[kb + 3];
        if (sm > 0) {
          if (sm !== this.lKs[l]) { this.lKs[l] = sm; this.lK[l] = 1 - exp(-this.dt / (0.5 * sm * sm * sm)); }
          this.lSm[l] += (v - this.lSm[l]) * this.lK[l];
          if (this.lSm[l] < 1e-30 && this.lSm[l] > -1e-30) this.lSm[l] = 0;
        } else this.lSm[l] = v;
        this.lVal[l] = this.lSm[l];
        return this.lSm[l];
      }
      lfoRaw(l, ph) {
        const sx = this.proc.sx;
        if (sx.lfoPmAny[l]) { const y = pmEval(sx, l, ph, this.eff); this.ly0 = pmY0; return y; }
        const T = sx.lfoTab, b = l * 1025;
        this.ly0 = T[b];
        return tabAt(T, b, 1024, ph);
      }
      matrix(sx, fr) {
        const off = this.off, eff = this.eff, ml = sx.modList, mn = sx.modN, src = this.src;
        for (let j = 0; j < mn; j++) off[ml[j]] = 0;
        const N = sx.mN, ctx = sx.mCtx;
        for (let r = 0; r < N; r++) if (ctx[r] & 1) evalRow(sx, r, src, off, 0);
        const bA = sx.baseA, bD = sx.baseD;
        for (let j = 0; j < mn; j++) {
          const i = ml[j], v = bA[i] + bD[i] * fr + off[i];
          eff[i] = v > 0 ? (v < 1 ? v : 1) : 0;
        }
      }
      // step 1 of the next chunk: envelopes, LFO phases, chaos and portamento with this chunk's eff values
      advance(sx, gc) {
        const dt = this.dt, eff = this.eff;
        this.envTick(0, dt); this.envTick(1, dt); this.envTick(2, dt);
        for (let l = 0; l < 8; l++) if (sx.lfoMode[l] !== 2) this.lfoAdv(sx, l, dt, gc);
        this.tau += dt;
        for (let k = 0; k < 2; k++) if (!sx.chaosMono[k] && sx.srcUsed[S_CHAOS1 + k]) this.chaosAdv(sx, k, dt);
        if (this.gQ < 1) {
          let T = 8 * pow(eff[G_PORTA], 5);
          if (sx.cScaled) { const d = this.gTg - this.gS; T *= (d < 0 ? -d : d) / 12; }
          this.gQ = T > 0 ? this.gQ + dt / T : 1;
          if (this.gQ > 1) this.gQ = 1;
          const c = 2 * eff[G_CURVE] - 1;
          this.nP = this.gS + (this.gTg - this.gS) * (this.gQ >= 1 ? 1 : bend(this.gQ, PORTA_K * c));
        } else this.nP = this.gTg;
      }
      envTick(e, dt) {
        const eff = this.eff, b = E1_ATT + 5 * e, cb = E1_CA + 3 * e;
        const na = eff[b], nh = eff[b + 1], nd = eff[b + 2], ns = eff[b + 3], nr = eff[b + 4];
        const A = 32 * na * na * na * na * na, H = 32 * nh * nh * nh * nh * nh, Dt = 32 * nd * nd * nd * nd * nd;
        const Rt = 32 * nr * nr * nr * nr * nr, S = e === 0 ? ns * ns : ns;
        let st = this.eSt[e], q = this.eQ[e], v = this.eV[e], t = this.eT[e], rem = dt;
        for (let guard = 0; guard < 8; guard++) {
          if (st === 1) {
            if (A <= 0) { st = 2; q = 0; t = 0; v = 1; continue; }
            const nq = q + rem / A;
            if (nq < 1) {
              q = nq; t += rem; rem = 0;
              const v0 = this.eV0[e];
              v = v0 + (1 - v0) * bend(q, ENV_K * (2 * eff[cb] - 1));
              break;
            }
            rem -= (1 - q) * A; st = 2; q = 0; t = 0; v = 1; continue;
          }
          if (st === 2) {
            if (H <= 0) { st = 3; q = 0; t = 0; v = 1; continue; }
            const nq = q + rem / H;
            if (nq < 1) { q = nq; t += rem; rem = 0; v = 1; break; }
            rem -= (1 - q) * H; st = 3; q = 0; t = 0; v = 1; continue;
          }
          if (st === 3) {
            if (Dt <= 0) { st = 4; q = 0; t = 0; v = S; continue; }
            const nq = q + rem / Dt;
            if (nq < 1) { q = nq; t += rem; rem = 0; v = 1 + (S - 1) * bend(q, ENV_K * (2 * eff[cb + 1] - 1)); break; }
            rem -= (1 - q) * Dt; st = 4; q = 0; t = 0; v = S; continue;
          }
          if (st === 4) { v = S; t += rem; rem = 0; break; }
          if (st === 5) {
            if (Rt <= 0) { st = 0; q = 0; t = 0; v = 0; break; }
            const nq = q + rem / Rt;
            if (nq < 1) { q = nq; t += rem; rem = 0; v = this.eVR[e] * (1 - bend(q, ENV_K * (2 * eff[cb + 2] - 1))); break; }
            st = 0; q = 0; t = 0; v = 0; break;
          }
          v = 0; break;
        }
        this.eSt[e] = st; this.eQ[e] = q; this.eV[e] = v; this.eT[e] = t;
      }
      lfoAdv(sx, l, dt, gc) {
        const n = this.eff[L1_RATE + 4 * l];
        let beats = 0, inc;
        if (sx.lfoBpm[l]) {
          beats = sx.lfoLad[l * 43 + round(n * (sx.lfoLadN[l] - 1))];
          inc = beats > 0 ? dt * sx.bpm / 60 / beats : 0;
        } else inc = dt * 100 * n * n * n * n;
        let ph = this.lPh[l];
        if (sx.lfoMode[l] === 0) {
          if (beats > 0 && sx.lfoAnchor[l]) {
            const x = sx.lfoStart[l] + (sx.beatC[gc] + sx.dBeat - this.lB0[l]) / beats;
            ph = x - floor(x);
          } else { ph += inc; ph -= floor(ph); }
        } else if (!this.lDone[l]) {
          const lp = sx.lfoLoop[l], loop = lp >= 0 && lp < 1;
          if (beats > 0 && sx.lfoAnchor[l] && (this.gate || !loop)) {
            // Env + BPM + Anchor (§6.12): unwrapped position since the trigger, held at 1 or wrapped into the loop while
            // gated; a released looping LFO accumulates from its phase to the end (below)
            const x = sx.lfoStart[l] + (sx.beatC[gc] + sx.dBeat - this.lB0[l]) / beats;
            if (x < 1) ph = x > 0 ? x : 0;
            else if (loop) { const L = 1 - lp; ph = lp + (x - 1) % L; }
            else { ph = 1; this.lDone[l] = 1; }
          } else {
            ph += inc;
            if (ph >= 1) {
              if (loop && this.gate) { const L = 1 - lp; ph = lp + (ph - 1) % L; }
              else { ph = 1; this.lDone[l] = 1; }
            }
          }
        }
        this.lPh[l] = ph;
      }
      chaosAdv(sx, k, dt) {
        const n = this.eff[C1_RATE + k];
        let rate = 1000 * n * n * n * n * n;
        if (this.eff[C1_BPM + k] >= 0.5 && rate > 0) rate = snapRate(rate, sx.bpm);
        if (!(rate > 0)) return;
        chaosInt(this.ch, 3 * k, k, rate * CHAOS_T0[k] * dt);
        this.cOut[k] = chaosOut(this.ch, 3 * k, k);
        if (sx.chaosSh[k]) {
          const per = 1 / rate;
          this.cTim[k] += dt;
          if (this.cTim[k] >= per) { this.cTim[k] -= per * floor(this.cTim[k] / per); this.cHold[k] = this.cOut[k]; }
        }
      }

      /* ---- rendering (§1, §6.3–§6.11) ---- */
      renderChunk(sx, bufL, bufR, dirL, dirR, o0) {
        const eff = this.eff, src = this.src, CH = this.CH, fresh = this.fresh;
        const onA = eff[A_ON] >= 0.5 ? 1 : 0, onB = eff[A_ON + 1] >= 0.5 ? 1 : 0;
        const onN = eff[N_ON] >= 0.5 ? 1 : 0, onS = eff[S_ON] >= 0.5 ? 1 : 0, fOn = eff[F_ON] >= 0.5 ? 1 : 0;
        this.onA = onA; this.onB = onB; this.onN = onN; this.onS = onS;
        const bnd = src[S_BEND], bu = round(48 * eff[G_BENDUP] - 24), bd = round(48 * eff[G_BENDDN] - 24);
        const bendSt = bnd >= 0 ? bnd * bu : -bnd * bd;
        const tune = 128 * eff[G_TUNE] - 64;
        // sub and noise first (they are FM modulators)
        const sAct = onS || this.sGL !== 0 || this.sGR !== 0 ? this.renderSub(sx, onS, bendSt, tune) : 0;
        if (!sAct) for (let s = 0; s < CH; s++) { SL[s] = 0; SR[s] = 0; SRAW[s] = 0; }
        const nAct = onN || this.nGL !== 0 || this.nGR !== 0 ? this.renderNoise(sx, onN, bendSt) : 0;
        if (!nAct) { for (let s = 0; s < CH; s++) { NL[s] = 0; NR[s] = 0; NRAW[s] = 0; } this.nLast = 0; }
        // oscillators: the FM/AM/RM modulator is rendered first (single direction, §3.3)
        let wmA = round(22 * eff[A_WARPMODE]), wmB = round(22 * eff[A_WARPMODE + 1]);
        if (wmA >= 18 && wmA <= 20 && wmB >= 18 && wmB <= 20) wmB = 0;
        const bFromA = wmB >= 18 && wmB <= 20 && onA === 1, aFromB = wmA >= 18 && wmA <= 20 && onB === 1;
        if (bFromA) {
          this.renderOsc(sx, 0, 1, wmA, AL, AR, onA, onB, onN, onS, bendSt, tune);
          this.renderOsc(sx, 1, 0, wmB, BL, BR, onB, onA, onN, onS, bendSt, tune);
        } else {
          this.renderOsc(sx, 1, aFromB ? 1 : 0, wmB, BL, BR, onB, onA, onN, onS, bendSt, tune);
          this.renderOsc(sx, 0, 0, wmA, AL, AR, onA, onB, onN, onS, bendSt, tune);
        }
        // routing (§1): switch gains ramped over the chunk; DIRECT sources never enter the filter
        const sDir = sx.subDirect, nDir = sx.noiseDirect, rg = this.rg;
        const tA = fOn & (eff[F_ROUTEA] >= 0.5 ? 1 : 0), tB = fOn & (eff[F_ROUTEA + 1] >= 0.5 ? 1 : 0);
        const tN = nDir ? 0 : fOn & (eff[F_ROUTEA + 2] >= 0.5 ? 1 : 0), tS = sDir ? 0 : fOn & (eff[F_ROUTEA + 3] >= 0.5 ? 1 : 0);
        let fType = round(95 * eff[F_TYPE]);
        fType = fType > 0 ? (fType < 95 ? fType : 95) : 0;
        const mixT = fType === 80 ? 1 : eff[F_MIX];
        if (fresh) { rg[0] = tA; rg[1] = tB; rg[2] = tN; rg[3] = tS; this.mixP = mixT; }
        let r0 = rg[0], r1 = rg[1], r2 = rg[2], r3 = rg[3];
        const iC = 1 / CH, d0 = (tA - r0) * iC, d1 = (tB - r1) * iC, d2 = (tN - r2) * iC, d3 = (tS - r3) * iC;
        const useF = (tA | tB | tN | tS) !== 0 || r0 !== 0 || r1 !== 0 || r2 !== 0 || r3 !== 0;
        rg[0] = tA; rg[1] = tB; rg[2] = tN; rg[3] = tS;
        const ns = nDir ? 0 : 1, ss = sDir ? 0 : 1;
        for (let s = 0; s < CH; s++) {
          r0 += d0; r1 += d1; r2 += d2; r3 += d3;
          const aL = AL[s], aR = AR[s], bL = BL[s], bR = BR[s], nL = ns * NL[s], nR = ns * NR[s], sL = ss * SL[s], sR = ss * SR[s];
          const fl = r0 * aL + r1 * bL + r2 * nL + r3 * sL, fr = r0 * aR + r1 * bR + r2 * nR + r3 * sR;
          FINL[s] = fl; FINR[s] = fr;
          DRYL[s] = aL + bL + nL + sL - fl; DRYR[s] = aR + bR + nR + sR - fr;
        }
        let mix = this.mixP;
        const dMix = (mixT - mix) * iC;
        this.mixP = mixT;
        if (useF) {
          const filt = this.filt;
          if (this.fIdle) { filt.reset(); this.fIdle = 0; }
          if (fType !== filt.type) filt.setType(fType);
          let fc = MIDI0 * exp2(FC_L2 * eff[F_CUTOFF]);
          if (sx.filKey) fc *= exp2((this.nP - 60) / 12);
          const sp = exp2((0.5 - eff[F_PAN]) * 3);
          filt.set(fc * sp, fc / sp, eff[F_RES], eff[F_DRIVE], eff[F_VAR]);
          for (let s = 0; s < CH; s++) { WETL[s] = FINL[s]; WETR[s] = FINR[s]; }
          filt.process(WETL, WETR, 0, CH);
          if (sx.mon && sx.recent === this) {
            let w = sx.tapW;
            const tap = sx.tap;
            for (let s = 0; s < CH; s++) { tap[w] = 0.5 * (WETL[s] + WETR[s]); w = (w + 1) & (TAP_N - 1); }
            sx.tapW = w;
          }
        } else this.fIdle = 1;
        // ENV 1 × AMP after the filter (ramped); direct sources to the direct bus
        const ga = eff[G_AMP], ampT = this.eV[0] * ga * ga;
        let amp = this.gAmp;
        const dAmp = (ampT - amp) * iC;
        this.gAmp = ampT;
        const dirOn = (sDir && sAct) || (nDir && nAct);
        for (let s = 0; s < CH; s++) {
          mix += dMix; amp += dAmp;
          let oL = DRYL[s], oR = DRYR[s];
          if (useF) { oL += FINL[s] + mix * (WETL[s] - FINL[s]); oR += FINR[s] + mix * (WETR[s] - FINR[s]); }
          bufL[o0 + s] += oL * amp; bufR[o0 + s] += oR * amp;
          if (dirOn) {
            dirL[o0 + s] += ((sDir ? SL[s] : 0) + (nDir ? NL[s] : 0)) * amp;
            dirR[o0 + s] += ((sDir ? SR[s] : 0) + (nDir ? NR[s] : 0)) * amp;
          }
        }
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
        const id = o ? sx.wtB : sx.wtA;
        if (id === (o ? this.wId1 : this.wId0) && this.wEp[o] === epoch) return;
        if (o) this.wId1 = id; else this.wId0 = id;
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
      // one oscillator's unison sum into OL/OR (§6.3–§6.7); cap = capture raw outputs (it modulates the other osc)
      renderOsc(sx, o, cap, wm, OL, OR, on, onO, onN, onS, bendSt, tune) {
        const eff = this.eff, CH = this.CH, kB = o * 17, N = this.uN[o], b16 = o * 16, fresh = this.fresh;
        for (let s = 0; s < CH; s++) { OL[s] = 0; OR[s] = 0; }
        if (!on && !cap) {
          let any = 0;
          for (let i = 0; i < 16; i++) if (this.uGL[b16 + i] !== 0 || this.uGR[b16 + i] !== 0) { any = 1; break; }
          if (!any) return 0;
        }
        this.resolveWT(sx, o);
        const ok = this.wOk[o];
        // pitch (§6.3)
        const nO = eff[A_TRACK + o] >= 0.5 ? this.nP : 0;
        const P0 = nO + 12 * round(8 * eff[kB + D_OCT] - 4) + round(24 * eff[kB + D_SEMI] - 12) + (2 * eff[kB + D_FINE] - 1) +
          (128 * eff[kB + D_CRS] - 64) + bendSt + tune;
        const fB = sx.a4 * exp2((P0 - 69) / 12);
        // unison ratios, pans, blend gains (cached until their inputs change)
        const dn = eff[kB + D_DET], det = dn * dn, stack = round(8 * eff[kB + D_STACK]), mode = sx.uniMode[o], R = sx.uniRange[o];
        const ub = (N - 1) * 16;
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
        const pan = 2 * eff[kB + D_PAN] - 1;
        if (pan !== this.cPan[o]) {
          this.cPan[o] = pan;
          this.bl[o] = panG(pan, 0); this.br[o] = panG(pan, 1);
        }
        const lev = eff[kB + D_LEVEL], gain = on ? lev * lev * this.comp[o] : 0;
        const gL0 = gain * this.bl[o], gR0 = gain * this.br[o], gcn = this.gC[o], gsd = this.gSd[o];
        // warp, position, modulator
        const wEff = eff[kB + D_WARP], uw = (2 * eff[kB + D_UNIWARP] - 1) * 0.5, uwt = (2 * eff[kB + D_UNIWT] - 1) * 0.5;
        const pos = eff[kB + D_WT];
        let MOD = ZERO, mN = 1, mStr = 0, mAvail = 0;
        if (wm >= 18 && wm <= 20) { if (onO) { MOD = o ? RAW0 : RAW1; mN = this.uN[1 - o]; mStr = MAXCH; mAvail = 1; } }
        else if (wm === 21) { if (onN) { MOD = NRAW; mAvail = 1; } }
        else if (wm === 22) { if (onS) { MOD = SRAW; mAvail = 1; } }
        if (mN < 1) mN = 1;
        // phase offset (PHASE knob, §6.4), spread over the chunk
        const mem = sx.bT[kB + D_PHASE] >= 0.9995, pk = eff[kB + D_PHASE];
        const nOff = mem ? 0 : (pk < 0.99999 ? pk : 0.99999), dOff = (nOff - this.oOff[o]) / CH;
        this.oOff[o] = nOff;
        const fs = this.fs, fmax = 0.45 * fs, flim = this.flim, F = this.wF[o], interp = this.wI[o];
        const REM = sx.remap, rb = o * 2049, RAW = o ? RAW1 : RAW0, hb = o * 11, iC = 1 / CH, m0 = this.m0;
        // unison voices dropped by a steal (uNx > N) fade out over this chunk with their old layout (§6.1, no click)
        const NX = this.uNx[o] > N ? this.uNx[o] : N, ubX = (NX - 1) * 16;
        this.uNx[o] = 0;
        const uRat = this.uRat, uPL = this.uPL, uPR = this.uPR, uGL = this.uGL, uGR = this.uGR, uPh = this.uPh, uLv = this.uLv;
        const uH = this.uH, uLx = this.uLx, uWx = this.uWx, uFa = this.uFa, uFp = this.uFp, lvD = this.lvD, lvLen = this.lvLen;
        const lvHarm = this.lvHarm, xf = this.xf;
        for (let i = 0; i < NX; i++) {
          const idx = b16 + i, live = i < N, t = live ? UT[ub + i] : UT[ubX + i];
          let f = fB * uRat[idx];
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
          // warp (§3.3, §6.7)
          let w = wEff + t * uw;
          w = w > 0 ? (w < 1 ? w : 1) : 0;
          const m = wm === 0 ? 0 : warpSetup(wm, w, mAvail);
          const K = wK, sp = m === 0 ? 1 : wSp;
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
          if (m === 0 && !twoLv && !cap && xa < 0) {
            const fs1 = (t1 >= 1 ? fb : fa);
            if (lvX < 0) {
              const bc = two && dt === 0 ? this.bcGet(o, d, fa, fb, t0, len) : null;   // a static position: cached blend
              if (bc !== null) ph = plain1(bc, 0, msk, len, ph, inc, OL, OR, gl, gr, dgl, dgr, CH);
              else if (two) {
                FA[0] = ph; FA[1] = inc; FA[2] = gl; FA[3] = gr; FA[4] = dgl; FA[5] = dgr; FA[7] = t0; FA[8] = dt;
                plain2(d, fa * len, fb * len, msk, len, OL, OR, CH);
                ph = FA[0];
              } else ph = plain1(d, fs1 * len, msk, len, ph, inc, OL, OR, gl, gr, dgl, dgr, CH);
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
            readLv(d, len, fa, fb, two, xa, YB, CH);
            if (twoLv) {
              readLv(lvD[hb + lvOld], lvLen[hb + lvOld], fa, fb, two, xa, YB2, CH);
              for (let s = 0; s < CH; s++) { const a = (s + 1) * iC; YB[s] = YB2[s] + (YB[s] - YB2[s]) * a; }
            } else if (lvX >= 0) {
              readLv(lvD[hb + lvX], lvLen[hb + lvX], fa, fb, two, xa, YB2, CH);
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

      resolveSub(shape) {
        if (shape === this.sShape && this.sEp === epoch) return;
        this.sShape = shape; this.sEp = epoch;
        const e = tables.get(SUB_IDS[shape]);
        if (!e || e.kind !== 'wt' || !e.levels) { this.sOk = 0; return; }
        this.sOk = 1;
        for (let l = 0; l < 11; l++) {
          const lv = e.levels[l];
          this.sD[l] = lv.data; this.sLen[l] = lv.len; this.sHarm[l] = lv.harm > 0 ? +lv.harm : MIP_HARM[l];
        }
      }
      // SUB (§6.3, §6.6): mono, linear level, equal-power pan; raw output in SRAW
      renderSub(sx, on, bendSt, tune) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH;
        let shape = round(4 * eff[S_SHAPE]);
        shape = shape > 0 ? (shape < 4 ? shape : 4) : 0;
        this.resolveSub(shape);
        const pan = 2 * eff[S_PAN] - 1;
        if (pan !== this.sPan) { this.sPan = pan; this.sCl = panG(pan, 0); this.sCr = panG(pan, 1); }
        const g = on ? eff[S_LEVEL] : 0, GLt = g * this.sCl, GRt = g * this.sCr;
        let gl = this.fresh ? GLt : this.sGL, gr = this.fresh ? GRt : this.sGR;
        const dgl = (GLt - gl) * iC, dgr = (GRt - gr) * iC;
        this.sGL = GLt; this.sGR = GRt;
        if (!this.sOk) return 0;
        const P = this.nP + 12 * round(8 * eff[S_OCT] - 4) + bendSt + tune;
        let f = sx.a4 * exp2((P - 69) / 12);
        const fmax = 0.45 * this.fs;
        f = f < fmax ? (f > 0.01 ? f : 0.01) : fmax;
        const inc = f / this.fs, lvOld = this.sLv;
        let lv, two, wX = 1, l2 = lvOld;
        if (this.xf) { lv = selBlend(this.flim / f, this.sHarm, 0); two = bLvB >= 0; l2 = bLvB; wX = bW; }
        else { lv = selLevel(lvOld, this.flim / f, this.sHarm, 0, this.m0); two = lvOld >= 0 && lvOld !== lv; }
        this.sLv = lv;
        const d = this.sD[lv], len = this.sLen[lv], m = len - 1;
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
        const id = sx.noiseId;
        if (id === this.nId && this.nEp === epoch) return;
        this.nId = id; this.nEp = epoch;
        const e = tables.get(id);
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
      // NOISE (§6.8): stereo sample player, level chosen by the read increment; raw mono average in NRAW
      renderNoise(sx, on, bendSt) {
        const eff = this.eff, CH = this.CH, iC = 1 / CH;
        this.resolveNoise(sx);
        const pan = 2 * eff[N_PAN] - 1;
        if (pan !== this.nPan) { this.nPan = pan; this.nCl = panG(pan, 0); this.nCr = panG(pan, 1); }
        const lev = eff[N_LEVEL], g = on ? lev * lev : 0, GLt = g * this.nCl, GRt = g * this.nCr;
        let gl = this.fresh ? GLt : this.nGL, gr = this.fresh ? GRt : this.nGR;
        const dgl = (GLt - gl) * iC, dgr = (GRt - gr) * iC;
        this.nGL = GLt; this.nGR = GRt;
        if (!this.nOk) return 0;
        const key = sx.noiseKey, pst = npitch(eff[N_PITCH]);
        const semis = key ? round(pst) + (this.nP - this.nRoot) + (2 * eff[N_FINE] - 1) + bendSt : pst;
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
    }

    /* ------------------------------------------------------------ renderWarp (§8.4.2) */
    // one cycle of frame (Float32Array 2048) through warp mode at amount amt, Hermite reads of level 0
    function renderWarp(frame, mode, amt, opts) {
      const over = opts && opts.over > 1 ? opts.over | 0 : 1, n = 2048 * over, out = new Float32Array(n);
      const R = opts && opts.remap && opts.remap.length >= 2049 ? opts.remap : DEF_CT.remap;
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
      const tmp = [];
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
        const ct = { key: '__warm', lfoTab: new Float32Array(8 * 1025), lfoPtsOff: new Uint16Array(9),
          lfoPts: new Float64Array(3 * 30), lfoPm: new Uint8Array(2 * 30), lfoPmAny: new Uint8Array(8),
          lfoStart: new Float64Array(8), lfoLoop: new Float64Array(8).fill(-1), remap: DEF_CT.remap,
          veloTab: DEF_CT.veloTab, noteTab: DEF_CT.noteTab };
        let po = 0;
        for (let l = 0; l < 8; l++) {
          const pts = l === 0 ? [0, 0, 0, 1, 1, 0] : [0, 0, 0, 0.5, 1, 0.3, 1, 0, 0];
          const np = pts.length / 3;
          ct.lfoPtsOff[l] = po;
          for (let j = 0; j < pts.length; j++) ct.lfoPts[3 * po + j] = pts[j];
          if (l === 2) { ct.lfoPm[2 * (po + 1) + 1] = 1; ct.lfoPm[2 * (po + 1)] = 1; ct.lfoPmAny[2] = 1; }
          for (let j = 0; j <= 1024; j++) ct.lfoTab[l * 1025 + j] = evalPts(ct.lfoPts, po, np, j / 1024);
          po += np;
        }
        ct.lfoPtsOff[8] = po;
        ct.lfoLoop[1] = 0.5;
        // CP
        const base = new Float64Array(NS);
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
          [S_LFO1 + 3, L1_RATE, 0.2, 1, -0.5, S_MACRO1, 3, 0], [S_ENV1 + 1, FX_BASE + 79, 0.3, 0, 0, 0, 4, 0],
          [S_LFO1 + 4, D_PHASE, 0.2, 1, 0, 0, 1, 1], [S_RAND1, 17 + D_RAND, 0.5, 0, 0, 0, 1, 1], [S_WHEEL, G_WHEEL, 0.1, 0, 0, 0, 2, 0],
        ];
        const nr = rows.length, mSrc = new Int8Array(32), mDst = new Int16Array(32), mAmt = new Float64Array(32), mBi = new Uint8Array(32);
        const mK = new Float64Array(32), mAux = new Int8Array(32), mInv = new Uint8Array(32), mCtx = new Uint8Array(32), mOn = new Uint8Array(32);
        const srcUsed = new Uint8Array(NSRC), modded = new Uint8Array(NS);
        for (let q = 0; q < nr; q++) {
          const w = rows[q];
          mSrc[q] = w[0]; mDst[q] = w[1]; mAmt[q] = w[2]; mBi[q] = w[3]; mK[q] = 6 * w[4]; mAux[q] = w[5]; mCtx[q] = w[6]; mOn[q] = w[7];
          srcUsed[w[0]] = 1; if (w[5]) srcUsed[w[5]] = 1; if (w[1] < NS) modded[w[1]] = 1;
        }
        const lfoLad = new Float64Array(8 * 43);
        for (let l = 0; l < 8; l++) for (let j = 0; j < 15; j++) lfoLad[l * 43 + j] = 128 * pow(2, -j);
        const cp = { ver: VER, NS, NSRC, base, mN: nr, mSrc, mDst, mAmt, mBi, mK, mAux, mInv, mCtx, mOn, srcUsed, modded,
          wt: ['__warm', '__warmD'], uniMode: Uint8Array.from([0, 4]), uniRange: Float64Array.from([2, 3]),
          memSet: new Float64Array(32), subDirect: 1, noiseOneshot: 0, noiseKey: 1, noiseDirect: 0, filKey: 1, noiseId: '__warmN',
          direct: 1, lfoMode: Uint8Array.from([0, 1, 2, 2, 0, 0, 0, 0]), lfoBpm: Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 0]),
          lfoAnchor: Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 0]), lfoLad, lfoLadN: new Uint8Array(8).fill(15),
          chaosMono: Uint8Array.from([0, 1]), chaosSh: Uint8Array.from([1, 0]), macro: new Float64Array(4).fill(0.5),
          mono: 0, legato: 0, poly: 8, always: 0, scaled: 0, oneNote: 1, os: 2, a4: 440, smooth: 1, ctKey: '__warm' };
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
      } finally {
        proc.p = saveP; proc.ct = saveCt; proc.voices = saveV;
        for (let k = 0; k < tmp.length; k++) dropWT(tmp[k]);
        reset(proc);
      }
    }

    /* ------------------------------------------------------------ first-use warm-up on the real patch (§11.5) */
    // warmUp optimises the code for a synthetic patch; the first real Serum patch of the scope then invalidates that
    // code (V8: dependent prototype chain / field type changes) and the first chord ran unoptimised (2-3x its steady
    // cost for several quanta — a dropout on slower machines). Warming up with the real patch shape instead costs ~50 %
    // more CPU for good (generic code), so the host plays the processor's own patch on two hidden voices into scratch
    // buffers, one span per warmTick while the track is silent, once the patch's tables are stored (gives up after
    // HW_WAIT spans). The note bookkeeping the hidden voices touch (recent voice, portamento start, alternation, random
    // sequence, phase memory) is restored at the end, so the track itself is unchanged. reset() ends it.
    const HW_SPANS = 80, HW_WAIT = 800;
    function warmStart(proc) {
      const sx = attach(proc);
      if (sx.hwN !== 0) return;
      sx.hwN = HW_SPANS; sx.hwOn = 0; sx.hwWait = HW_WAIT;
    }
    function hwReady(sx) {
      if (!sx.ok) return false;
      const bT = sx.bT;
      if (bT[A_ON] >= 0.5 && !tables.has(sx.wtA)) return false;
      if (bT[A_ON + 1] >= 0.5 && !tables.has(sx.wtB)) return false;
      if (bT[N_ON] >= 0.5 && !tables.has(sx.noiseId)) return false;
      return true;
    }
    function warmTick(proc, N) {
      const sx = proc.sx;
      if (!sx || sx.hwN === 0) return 0;
      if (sx.hwOn === 0) {
        if (!hwReady(sx)) { if (--sx.hwWait <= 0) sx.hwN = 0; return sx.hwN; }
        sx.hwRec = sx.recent; sx.hwLP = sx.lastPitch; sx.hwMem[0] = sx.memPh[0]; sx.hwMem[1] = sx.memPh[1];
        sx.hwAlt = sx.alt; sx.hwRng = sx.rng;
        const a = new SerumVoice(proc, 0), b = new SerumVoice(proc, 1);
        sx.hw = [a, b]; sx.hwL = new Float64Array(MAXCH * 32); sx.hwR = new Float64Array(MAXCH * 32);
        a.apply(proc.p); b.apply(proc.p);
        a.noteOn(60, 0.8, false, 1); b.noteOn(67, 0.6, false, 1);
        sx.recent = sx.hwRec;                                    // never the panel's voice (snapshot, filter tap)
        sx.hwOn = 1; sx.hwFs = +proc.fs;
      }
      if (+proc.fs !== sx.hwFs || !(N > 0 && N <= MAXCH * 32)) { warmEnd(proc); return 0; }
      const L = sx.hwL, R = sx.hwR, hw = sx.hw;
      for (let i = 0; i < N; i++) { L[i] = 0; R[i] = 0; }
      if (sx.hwN === HW_SPANS >> 1) hw[1].noteOff(0.5);             // the release path as well
      hw[0].render(L, R, N); hw[1].render(L, R, N);
      if (--sx.hwN === 0) warmEnd(proc);
      return sx.hwN;
    }
    function warmEnd(proc) {
      const sx = proc.sx;
      if (!sx) return;
      if (sx.hwOn === 1) {
        sx.recent = sx.hwRec; sx.lastPitch = sx.hwLP; sx.memPh[0] = sx.hwMem[0]; sx.memPh[1] = sx.hwMem[1];
        sx.alt = sx.hwAlt; sx.rng = sx.hwRng;
      }
      sx.hw = null; sx.hwL = null; sx.hwR = null; sx.hwN = 0; sx.hwOn = 0; sx.hwRec = null;
    }

    globalThis.SerumDSP = Object.freeze({
      VER, DIDX, FIDX, SIDX, LAW_TAB, SRC_POL, SUB_IDS, FILTER_FAMILY, FILTER_FAM_OF, UNI, tables,
      get epoch() { return epoch; },
      storeWT, storeWTFrame, dropWT,
      attach, reset, idle, transport, begin, fxMods, snapshot, warmUp, warmStart, warmTick, warmEnd,
      SerumVoice, SFilter, bend, evalPts, renderWarp, filterImpulse,
    });
  } catch (err) {
    globalThis.SerumDSP = null;                                // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('serum-dsp: load failed', err);
  }
})();
