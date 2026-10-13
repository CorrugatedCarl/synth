/*
 * sx-gran.js — Granular oscillator (classic script, no imports/exports; owner D4).
 * Contract: SPEC-serum2 §11.8 (the common oscillator contract), §6.9 (Granular), §6.7.1–§6.7.4 and §6.7.6 (the playheads
 * it shares with Sample), §6.6.10 (phase- and output-domain warps on sample-based oscillators), §3.8 (windows), §3.9
 * (X|Y targets), §4.1 (the CP v2 fields read here), §4.5 (asset entries), §14.2 (≤ 96 KB per oscillator per voice;
 * processor grain cap), §0.3/§0.4 (script shape, lazy references, hot-path rules).
 *
 * Script #6 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Publishes the frozen `globalThis.SxGran`; can be evaluated again in the same scope; a
 * failure inside leaves SxGran = null without throwing (then Granular oscillators are silent, §0.3). Lazy references
 * (resolved in `apply`, cached in fields): SxBase (OTYPE, DIDX2, WIN_TAB / WIN_N grain windows, getAsset / epoch;
 * missing ⇒ silent, one console.warn per scope) and SxWarp (Slots and the block kernels, §6.6.1 — named as a caller by
 * §11.7; missing ⇒ warp slots act as Off, one console.warn per scope). The playhead/reader helpers are a copy of
 * sx-sample.js's (no reference to SxSample: each script fails alone, §0.3).
 *
 * API (§11.8; [+] = beyond the §11.8 list):
 *   VER 1 · MAXCH 32 (OL/OR/RAW stride) · MAXUNI 16 · MAXGR 256 (grains per oscillator per voice) · GST 16 (doubles of
 *   state per grain: the grain state is Float64Array(MAXGR·GST), §6.9.5) · NSL 258 (CP.sSlPos stride) · NLADG 27
 *   (CP.sDensLad / sGlenLad stride)
 *   [+] K   frozen offsets of the oscillator's O2 destination block (§3.11.2, `k.w1` … `k.bus2`; vi = vi(k.w1) + K.NAME)
 *   class GranOsc(voice, o)   (Granular, OTYPE 3)
 *     apply(cp, o, qr) → boolean   copies the CP v2 fields of oscillator o (allocation allowed). Returns false — and the
 *                                  oscillator is silent — when the CP shapes are invalid (one console.warn per scope),
 *                                  when SxBase is missing, or for o outside 0–2; true otherwise (also when the CP selects
 *                                  another type for o: the instance then idles, `sel` = 0). The grain state
 *                                  (Float64Array(256·16)), the stream state and three SxWarp.Slots are allocated on the
 *                                  first apply that selects Granular and reused afterwards. `qr` = the quality-reduction
 *                                  caps (Float64Array(5): [uniMax, grainsMax, specHopMul, specStreams, grainsProc],
 *                                  §4.1/§14.3) or null for CP.qr. Caps: grMax = min(sMaxGr[o], round(qr[1]), 256) ≥ 1
 *                                  per oscillator per voice; grProc = round(qr[4]) per processor
 *     noteOn(ctx, fresh, legato)   reads the note-on values (ctx.eff: k.sstart, k.slice, k.ustart, k.uspan) and the
 *                                  played key (ctx.key [+] / voice.note / keyRef), draws the START values from r2
 *                                  (voice.rnd2(), §6.2), makes this voice the processor's most recent granular voice
 *                                  (`sx.granLast`) and starts the streams; the Jump Start spawns (or the single note-on
 *                                  grain) happen in the first render that finds the entry. A legato note keeps the
 *                                  streams and grains running; a non-legato note restarts the streams and fades the
 *                                  running grains out over 5 ms (FADE), its Jump Start following once they are gone
 *     noteOff()                    gate off (Exit Loop on Release)
 *     render(ctx, OL, OR, RAW)     writes ctx.CH samples into OL/OR (Float64Array(32), overwritten, not added): per stream
 *                                  the sum of its grains, the O stage, then the stream's ramped unison gains (gl += dgl,
 *                                  OL[s] += gl·y); RAW (Float64Array(16·32) | null) receives ctx.N stream rows of the
 *                                  mono raw output (post warps, pre level/pan; with ctx.ownPan the stream pan's
 *                                  equal-power loss is compensated, exact without Rand Pan) at [u·32 + s]. [+] Optional
 *                                  OscCtx field `ownPan` (D1 SHOULD set it to 1 and leave the unison pan factors out of
 *                                  gl/gr/dgl/dgr for Granular oscillators): the grains then carry the whole §6.9.3 pan.
 *                                  Resolves the entry when the
 *                                  asset epoch changed (missing ⇒ silence, audible within one chunk after it arrives)
 *     kill()                       immediate stop: every grain dropped and returned to the processor count sx.grains
 *     active() → bool              false before noteOn, after kill, and once every stream ended (One-shot region done,
 *                                  or a Normal slice key outside the slices) with no grain left
 *     grains() → int              live grains of this oscillator
 *     fields read by the voice/snapshot (read-only): sel, ok, [+] e (the resolved entry or null), [+] grMax, grProc (the
 *     caps above), [+] mPos, mS, mLS, mLE (playhead of stream 0, S, LS, LE as fractions of the entry length, §6.20)
 *
 * Processor fields owned by this script (on `ctx.sx`, the voice's processor state; D1 resets them with sx): `grains`
 *   (live grains of all voices and oscillators, §6.9.2; treated as 0 when absent), `granLast` (the most recently
 *   triggered granular voice), `granStarve` (0/1: that voice was refused a grain by the processor cap and has not found
 *   room since; while set, every other voice's spawns are skipped), `granQ` (Float64Array(12), created by apply through
 *   voice.proc.sx as SxSample's msRR: 3 slots × [oscillator id, grains, demand, wants] of that voice's granular
 *   oscillators, cleared when another voice becomes the most recent; without it the processor-cap shares are off).
 *
 * CP v2 fields read (§4.1; checked by type and length in apply): ver 2, base (429), oType, bendTrack (3), fmType (6),
 *   smp (Array(3) of strings), qr (5), sLoop, sRel, sLink, sExit, sLoopGr, sScanKey, sScanLock, sLenOn, sSlMode, sSlEnd,
 *   sSlOne, sSlRoot, sWin, sDens, sDensJump, sGlen, sNorm, sRev, xyOn, xyY, xyMode, spawn, sDensLadN, sGlenLadN
 *   (Uint8Array(3)), sMaxGr, sSlN (Uint16Array(3)), sSlPos (Float64Array(3·258)), sDensLad, sGlenLad (Float64Array(3·27)),
 *   sScanR (3), lenLad (15). Optional: `a4` (finite > 0, else 440).
 *
 * Implementation choices (IMPL where §6.9 leaves room):
 *  - Streams = unison voices. Each stream's playhead follows the Sample playhead model (sx-sample.js header) with the
 *    increment (rate/fs)·σ (no pitch); grains spawn at the stream position of their spawn sample. Spawn times come from
 *    a clock in units of the spawn interval T_s (modulation of the density changes the clock speed, not the phase):
 *    after the note-on grain, stream u spawns at clock values off_u + k (Together off 0 ⇒ 1, 2, …; Even u/N; Exp
 *    2^(u/N) − 1; Random 1 + U then ⌊c⌋ + 1 + U, U redrawn per spawn). Spawns skipped by a cap are not retried.
 *  - Jump Start (§6.9.2): ceil(L_g/T_s) grains per stream with ages j·T_s, spawned interleaved (j outer, streams inner),
 *    each at the read position it would have had if spawned `age` samples ago from the moving playhead: P + Offset
 *    spread + age·(inc − dps) (inc = the grain's read increment, dps = the stream's), folded into the region — the
 *    jump grains sum like steady-state grains (M2 started them all at P, mutually shifted copies that comb-filtered);
 *    off: one grain per stream at note-on.
 *  - Per-oscillator cap grMax: shared by the live streams, floor(grMax/N) each (a stream beyond its share only takes
 *    room the other streams' unused shares leave), so a cap never collapses the unison image onto the first streams.
 *  - Processor cap grProc (§6.9.2, IMPL): the other voices spawn only into room below the cap that the most recent
 *    granular voice does not want (its demand: live streams × ⌈L_g/T_s⌉, ≤ grMax) and while that voice is not refused
 *    (`sx.granStarve`, set by a refusal, cleared when its spawn leaves room below the cap, by a new note, by kill or
 *    when it can no longer spawn): the oldest voices thin out first. That voice's K granular oscillators share the cap
 *    (floor(grProc/K) each, reserved while wanted) and, while the cap is full of older voices' grains, may each still
 *    spawn up to floor(grProc/2/K): a new note sounds at once. The processor count stays < 1.5·grProc and is back at
 *    grProc once the older grains end (no running grain is cut). §15.8 says "never exceed it" while §6.9.2 lets the
 *    newest voice spawn "up to its own cap": this bounded overshoot is the realisation (ratified, RULINGS2).
 *  - Per grain: ten r2 draws in a fixed order (length, offset, direction, pitch, pan, level, window amount, window skew,
 *    warp 1, warp 2), always taken (stable sequences when a Rand amount changes), plus one per spawn for Random spawning.
 *    Grain length is rounded to whole OS samples (≥ 2); the window time is age/(len − 1). The grain's pitch factor is
 *    fixed at spawn; the stream ratio ρ_u (vibrato, bend) is applied per chunk. The read level is chosen per chunk
 *    from |dp_g| × slot speeds (no crossfade: grains are windowed).
 *  - Pan (§6.9.3): with ctx.ownPan = 1 (the voice's gains without the unison pan) a grain gets lvl·panG(clamp(ctx.pan[u]
 *    + rpan·(2u − 1), −1, 1)) — one equal-power law. Without it (the M2 OscCtx) the stream's unison gains carry the
 *    stream pan and the grain is balanced inside it at δ = rpan·(2u − 1), clamped so that ctx.pan[u] + δ stays in
 *    [−1, 1] (two laws multiplied; a hard-panned stream's grains cannot reach the other side).
 *  - Grain starts are folded (reflected) into the region (Manual X|Y: into the whole sample). Grain reads stay inside the
 *    region [S, E) (Manual X|Y: the entry), reflected at its ends (§6.6.10, §6.9.1): material cut off with the markers
 *    is never heard, and a grain running off the region or the sample turns back instead of stepping to silence (M2:
 *    a step of up to 66× the slope). With Loop Grains read positions wrap into [LS, LE) with the §6.7.4 crossfade.
 *    Warped reads (P stage, Odd/Even second read, PD (Self) per sample) are bounded the same way (gbnd).
 *  - Window skew (§6.9.4): t_s is exact at each chunk's ends and per sample in the two chunks at the steep end of the
 *    skew curve, linear in between (≤ 0.01 from the formula; no per-sample pow — the hot loops take skewed grains).
 *  - Manual X|Y: stream position = pos·L + Δ_u (clamped to the entry), no scanning, slicing off. The Y targets 4–17 of
 *    XY_Y_GRAN are applied here (Add: n + 2y − 1, Replace: y, Scale: n·y, clamped); 1–3 (Level, Warp, Warp 2) feed the
 *    voice's gains and ctx.w1/w2 and are applied by the voice (D1).
 *  - Warps: F/P-domain slots act per grain on its read position through the stream's Slots (unison index u) with the
 *    stage order and the PD / PD (Self) realisation of sx-sample.js (pdBlock offsets, intra-period phase mapping, PD
 *    (Self) per sample with y₁ PER GRAIN — the grain's own previous raw read, 0 at spawn; SxWarp header proposal); with
 *    Rand Warp ≠ 0 a third Slots object holds per-grain coefficients (batches of 16 grains; the kernels read the stream's
 *    modulator column through their mc argument). O-domain slots act per stream on the grain sum (L and R Slots; the
 *    Odd/Even second reads are summed per grain and pass both slots), φ for Flip = the stream playhead's intra-period
 *    phase. Sync windows multiply each grain's read. Slots are clocked every chunk as in sx-sample.js. Loop Grains
 *    without per-grain warps has its own fused loop. Per-grain P/F warps and Rand Warp cost a phaseBlock/incBlock per
 *    grain per chunk (SxWarp.Slots holds ≤ 16 rows: Rand Warp coefficients are clocked per batch of 16 grains).
 *  - (M4 performance) render keeps the values and tests a grain needs only now and then (its end inside a chunk, a fade,
 *    a chunk leaving the region, a window end) evaluated for every grain, and the removal of finished grains is a method
 *    of its own (reap): V8 deoptimised the whole render the first time such a path was taken mid-note (4–6 ms quanta).
 *    [+] Field `wq` (0; set to 1 by serum-dsp's GRAN_JOB on a hidden voice): grains ≤ WQ_LG s and stream playheads that
 *    cross their region in ≈ WQ_CH chunks, so the warm-up takes the paths a real note meets after seconds. Output of
 *    every other oscillator unchanged.
 *
 * Hot paths (noteOn, noteOff, render, kill, active, grains) never allocate; patch values are copied in apply into
 * numeric fields and the instance's own typed arrays, never read from the CP object while rendering.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const MAXCH = 32, MAXUNI = 16, MAXGR = 256, GST = 16, NSL = 258, NLADG = 27, NLAD = 15;
    const T_GRAN = 3;                                         // OTYPE code (= serum-core OSC_TYPES), checked against SxBase
    const NSS = 16;                                           // doubles of state per stream (unison voice)
    const WQ_LG = 0.003, WQ_CH = 32;                          // GRAN_JOB's warm-up compression (GranOsc.wq)
    const floor = Math.floor, ceil = Math.ceil, round = Math.round, pow = Math.pow, sin = Math.sin, cos = Math.cos,
      sqrt = Math.sqrt, PI = Math.PI, SQRT2 = Math.SQRT2;

    // O2 destination block of one oscillator, in §3.11.2 builder order (vi = vi(k.w1) + offset)
    const O2 = ['w1', 'w2', 'warp2', 'wvar1', 'wvar2', 'uniwarp2', 'ratio', 'hz', 'sstart', 'send', 'lstart', 'lend', 'xfade',
      'scan', 'scanrev', 'pos', 'slice', 'gy', 'dens', 'glen', 'wamt', 'wskew', 'roff', 'rdir', 'rpitch', 'rlen', 'rpan', 'rlvl',
      'rwamt', 'rwskew', 'rwarp', 'rwarp2', 'grev', 'flo', 'fhi', 'cut', 'smix', 'mdly', 'matt', 'mhold', 'mdec', 'msus', 'mrel',
      'mvel', 'mrand', 'timbre', 'ustart', 'uspan', 'fbal', 'bus1', 'bus2'];
    const k = {};
    for (let i = 0; i < O2.length; i++) k[O2[i].toUpperCase()] = i;
    const K = Object.freeze(k);
    const OSC_LETTER = ['A', 'B', 'C'];
    // XY_Y_GRAN (§3.9) → O2 offset of the target (−1: none / applied by the voice)
    const XY_OFF = [-1, -1, -1, -1, K.DENS, K.GLEN, K.WAMT, K.WSKEW, K.ROFF, K.RDIR, K.RPITCH, K.RLEN, K.RPAN, K.RLVL, K.RWAMT,
      K.RWSKEW, K.RWARP, K.RWARP2];

    // playheads (sx-sample.js model), loop modes, stream and grain state layouts
    const PH_APP = 0, PH_LOOP = 1, PH_EXIT = 2, PH_END = 3;
    const LM_ONE = 0, LM_FWD = 1, LM_REV = 2, LM_PP = 3, LM_TAIL = 4;
    const T_P = 0, T_PH = 1, T_LT = 2, T_U = 3, T_NX = 4;
    const G_P = 0, G_PR = 1, G_AGE = 2, G_LEN = 3, G_IL = 4, G_GL = 5, G_GR = 6, G_WA = 7, G_SK = 8, G_U = 9, G_W1 = 10,
      G_W2 = 11, G_LV = 12, G_S0 = 13, G_Y1 = 14, G_FD = 15;   // G_Y1: the grain's PD (Self) y₁ (0 at spawn); G_FD:
                                                               // samples left of a retrigger fade-out (0 = none)
    const FADE = 0.005;                                       // s: fade-out of the grains a non-legato retrigger replaces
    const DOM_F = 1, DOM_P = 2, DOM_O = 3;
    const M_ODDEVEN = 16, M_PD0 = 39, M_PD1 = 44, M_PDSELF = 45; // WARPS2 indices (§3.4.1; checked against SxWarp.META.ids)

    /* ------------------------------------------------------------ module scratch (one chunk; processors run in turn) */
    const F = (n) => new Float64Array(n);
    const PA = F(MAXCH), PB = F(MAXCH), PC = F(MAXCH), PD = F(MAXCH), WA = F(MAXCH), WB = F(MAXCH), TW = F(MAXCH);
    const PHW = F(MAXCH), PBA = F(MAXCH), WIN = F(MAXCH), GX = F(MAXCH), GXR = F(MAXCH), GX2 = F(MAXCH), GX2R = F(MAXCH);
    const XT = F(MAXCH), GG = F(MAXCH), PHI = F(MAXCH), PHX = F(MAXCH), PBX = F(MAXCH), PDO = F(MAXCH);
    const SPOS = F(MAXUNI * MAXCH), SGF = F(MAXUNI * MAXCH);  // stream playhead positions, stream FM factors
    const SL = F(MAXUNI * MAXCH), SR = F(MAXUNI * MAXCH), S2L = F(MAXUNI * MAXCH), S2R = F(MAXUNI * MAXCH);
    const LIVE = new Uint8Array(MAXUNI);                     // stream u can spawn this chunk
    // grain read bounds of the oscillator being rendered (gbnd): [kind (1 region, reflected; 2 Loop Grains loop,
    // wrapped), region lo, region hi, LS, ld, LL]
    const GB = F(6);
    const RHO = F(MAXUNI), WG1 = F(MAXUNI), WG2 = F(MAXUNI), FG = F(MAXUNI), PAN = F(MAXUNI), HASG = new Uint8Array(MAXUNI);
    const oddU = new Uint8Array(MAXUNI);                     // stream u has an Odd/Even slot on (second reads needed)
    const QS = F(1026);
    for (let j = 0; j <= 1024; j++) QS[j] = sin(0.5 * PI * j / 1024);
    QS[1025] = 1;
    const IDREMAP = new Float32Array(3 * 2049);
    for (let o = 0; o < 3; o++) for (let j = 0; j <= 2048; j++) IDREMAP[o * 2049 + j] = j / 2048;
    const NOSX = { grains: 0, granLast: null, granStarve: 0, granQ: new Float64Array(12) };   // stand-in processor
                                                              // state when ctx.sx is absent (tools)
    const GQ = 12;                                            // sx.granQ: 3 slots × [oscillator id, grains, demand, wants]
    let GID = 0;                                              // GranOsc ids (registry slots)

    /* ------------------------------------------------------------ one-time warnings (per scope) */
    let warnedBase = false, warnedCP = false, warnedWarp = false;
    function warn(what) {
      if (typeof console !== 'undefined') console.warn('sx-gran: ' + what);
    }
    function sxBase() {
      const B = globalThis.SxBase;
      if (B && typeof B === 'object' && typeof B.getAsset === 'function' && B.DIDX2 && B.OTYPE && B.WIN_TAB) return B;
      if (!warnedBase) { warnedBase = true; warn('SxBase is missing: Granular oscillators are silent'); }
      return null;
    }
    function badCP(why) {
      if (!warnedCP) { warnedCP = true; warn('CP not understood (' + why + '): Granular oscillators are silent'); }
      return false;
    }
    function sxWarp() {
      const W = globalThis.SxWarp;
      if (W && typeof W === 'object' && typeof W.Slots === 'function' && typeof W.chunk === 'function' &&
        typeof W.incBlock === 'function' && typeof W.phaseBlock === 'function' && typeof W.outBlock === 'function' &&
        typeof W.pdBlock === 'function' && W.META && W.META.dom && W.META.avail && W.META.ids &&
        W.META.ids[M_PD0] === 'pd_o1' && W.META.ids[M_PD1] === 'pd_f2' && W.META.ids[M_PDSELF] === 'pd_self' &&
        W.META.ids[M_ODDEVEN] === 'oddeven' && W.DOM && W.DOM.F === DOM_F && W.DOM.P === DOM_P && W.DOM.O === DOM_O) return W;
      if (!warnedWarp) { warnedWarp = true; warn('SxWarp is missing: warp slots of Granular oscillators act as Off'); }
      return null;
    }

    /* ------------------------------------------------------------ CP v2 shape validation (§4.1) */
    // typed arrays from another realm: compare the tag, never instanceof (Phase-1 §0.2)
    const tag = (a) => (a !== null && typeof a === 'object' ? a[Symbol.toStringTag] || '' : '');
    const U8 = 'Uint8Array';
    const SHAPES = [['base', 'Float64Array', 429], ['oType', U8, 3], ['bendTrack', U8, 3], ['fmType', U8, 6],
      ['qr', 'Float64Array', 5], ['sLoop', U8, 3], ['sRel', U8, 3], ['sLink', U8, 3], ['sExit', U8, 3], ['sLoopGr', U8, 3],
      ['sScanKey', U8, 3], ['sScanLock', U8, 3], ['sLenOn', U8, 3], ['sSlMode', U8, 3], ['sSlEnd', U8, 3], ['sSlOne', U8, 3],
      ['sSlRoot', U8, 3], ['sWin', U8, 3], ['sDens', U8, 3], ['sDensJump', U8, 3], ['sGlen', U8, 3], ['sNorm', U8, 3],
      ['sRev', U8, 3], ['xyOn', U8, 3], ['xyY', U8, 3], ['xyMode', U8, 3], ['spawn', U8, 3], ['sDensLadN', U8, 3],
      ['sGlenLadN', U8, 3], ['sMaxGr', 'Uint16Array', 3], ['sSlN', 'Uint16Array', 3], ['sSlPos', 'Float64Array', 3 * NSL],
      ['sDensLad', 'Float64Array', 3 * NLADG], ['sGlenLad', 'Float64Array', 3 * NLADG], ['sScanR', 'Float64Array', 3],
      ['lenLad', 'Float64Array', NLAD]];
    function checkCP(cp) {
      if (cp === null || typeof cp !== 'object') return 'no CP';
      if (cp.ver !== 2) return 'ver ' + cp.ver;
      for (let i = 0; i < SHAPES.length; i++) {
        const s = SHAPES[i], a = cp[s[0]];
        if (tag(a) !== s[1] || a.length !== s[2]) return s[0] + ' must be ' + s[1] + '(' + s[2] + ')';
      }
      const ids = cp.smp;
      if (!Array.isArray(ids) || ids.length !== 3) return 'smp must be Array(3) of strings';
      for (let i = 0; i < 3; i++) if (typeof ids[i] !== 'string') return 'smp must be Array(3) of strings';
      return '';
    }
    function qrOk(q) {
      if (q === null || typeof q !== 'object' || q.length !== 5) return false;
      for (let i = 0; i < 5; i++) if (typeof q[i] !== 'number' || q[i] - q[i] !== 0) return false;
      return true;
    }
    const capInt = (x, lo, hi) => { x = Math.round(x); return x < lo ? lo : x > hi ? hi : x; };

    /* ------------------------------------------------------------ helpers (copies of sx-sample.js's) */
    function panG(p, right) {
      if (p === 0) return 1;
      const a = (p + 1) * PI * 0.25;
      return SQRT2 * (right ? sin(a) : cos(a));
    }
    const exp2 = (x) => pow(2, x);
    function seedR2(osc) {
      const v = osc.v;
      osc.hasR2 = v !== null && typeof v === 'object' && typeof v.rnd2 === 'function' ? 1 : 0;
      if (osc.hasR2 === 0) {
        const s = v !== null && typeof v === 'object' && typeof v.r2 === 'number' ? v.r2 >>> 0 : 0x9E3779B9;
        osc.r2s = ((s ^ 0x5BD1E995) >>> 0) || 1;
      }
    }
    function rnd(osc) {
      if (osc.hasR2 === 1) return +osc.v.rnd2();
      let x = osc.r2s;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      if (x === 0) x = 1;
      osc.r2s = x;
      return x / 4294967296;
    }
    function keyOf(ctx, v) {
      const kk = ctx.key;
      if (typeof kk === 'number' && kk === kk) return round(kk);
      if (v !== null && typeof v === 'object' && typeof v.note === 'number' && v.note === v.note) return round(v.note);
      const r = ctx.keyRef;
      return typeof r === 'number' && r === r ? round(r) : 60;
    }
    function keyRefOf(ctx, key) {
      const r = ctx.keyRef;
      return typeof r === 'number' && r === r ? r : key;
    }
    function lvSel(nLv, adp) {
      let l = 0;
      while (adp > 1 && l < nLv - 1) { adp *= 0.5; l++; }
      return l;
    }
    // grain reads (positions bounded by gbnd before; clamped to the entry as a safety)
    function readH(d, n, P, A, Bm, out, cnt) {
      const nm = n - 1;
      for (let s = 0; s < cnt; s++) {
        let q = A + Bm * P[s];
        if (!(q > 0)) q = 0; else if (q > nm) q = nm;
        const i = q | 0, f = q - i;
        const xm = d[i > 0 ? i - 1 : 0], x0 = d[i], x1 = d[i < nm ? i + 1 : nm], x2 = d[i + 2 <= nm ? i + 2 : nm];
        out[s] = (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
      }
    }
    function readW(e, lv, ch, rev, P1, P2, out, cnt) {
      const lev = e.levels[lv], d = ch === 0 || lev.R === null || lev.R === undefined ? lev.L : lev.R, nl = lev.len;
      const sc = 1 / (1 << lv), A = rev ? (e.len - 1) * sc : 0, Bm = rev ? -sc : sc;
      readH(d, nl, P1, A, Bm, out, cnt);
      if (P2 !== null) {
        readH(d, nl, P2, A, Bm, XT, cnt);
        for (let s = 0; s < cnt; s++) out[s] = WA[s] * out[s] + WB[s] * XT[s];
      } else for (let s = 0; s < cnt; s++) out[s] *= WA[s];
    }
    function fadeW(s, u) {
      if (!(u > 0)) { WA[s] = 1; WB[s] = 0; return; }
      if (u >= 1) { WA[s] = 0; WB[s] = 1; return; }
      const x = u * 1024, j = x | 0, fr = x - j;
      WB[s] = QS[j] + (QS[j + 1] - QS[j]) * fr;
      WA[s] = QS[1024 - j] + (QS[1023 - j] - QS[1024 - j]) * fr;
    }
    function remapOf(ctx) {
      const sx = ctx.sx, r = sx !== null && typeof sx === 'object' ? sx.remap : null;
      return r !== null && typeof r === 'object' && r.length >= 3 * 2049 ? r : IDREMAP;
    }
    // reflect x into [lo, hi]. (M4: the one-reflection results and every test are evaluated in every call — a value or
    // test first computed when a read left the region deoptimised the function it was inlined into, V8; only the
    // multiple reflection is a path of its own)
    function fold(x, lo, hi) {
      const w = hi - lo, r1 = 2 * hi - x, r2 = 2 * lo - x;
      const inR = ((x >= lo) & (x <= hi)) !== 0, up = ((x > hi) & (x <= hi + w)) !== 0, dn = ((x < lo) & (x >= lo - w)) !== 0;
      if (!(w > 0)) return lo;
      if (inR) return x;
      if (up) return r1;                                         // one reflection (the common case: no modulo)
      if (dn) return r2;
      let y = (x - lo) % (2 * w);
      if (y < 0) y += 2 * w;
      return lo + (y <= w ? y : 2 * w - y);
    }
    // skewed window time (§6.9.4)
    function skewT(t, s) {
      if (s === 0) return t;
      return s > 0 ? pow(t, 1 / (1 + 3 * s)) : 1 - pow(1 - t, 1 / (1 - 3 * s));
    }
    // a grain read position under GB (§6.6.10, §6.9.1): Loop Grains wraps into [LS, LE); otherwise the read stays in
    // the region (Manual X|Y: the entry), reflected at its ends
    function gbnd(p) {
      if (GB[0] === 2) {
        const LS = GB[3], ld = GB[4], LL = GB[5];
        let lam = (p - LS) * ld;
        if (lam < 0 || lam >= LL) { lam -= LL * floor(lam / LL); p = LS + ld * lam; }
        return p;
      }
      return fold(p, GB[1], GB[2]);                               // (= p inside the region)
    }
    // the processor's most recent granular voice (§6.9.2): its granular oscillators publish [id, grains, demand, wants]
    // in the slots of sx.granQ (numbers only: no object references kept in the processor state)
    // K = its oscillators that can spawn (≥ 1)
    function granK(q) {
      let k = 0;
      for (let b = 0; b < GQ; b += 4) if (q[b] !== 0 && q[b + 3] === 1) k++;
      return k > 0 ? k : 1;
    }
    // the processor shares its oscillators other than slot `me` still want (share, or their demand when smaller, minus
    // what they hold)
    function granRes(q, me, share) {
      let r = 0;
      for (let b = 0; b < GQ; b += 4) {
        if (q[b] === 0 || q[b + 3] !== 1 || b === me * 4) continue;
        const want = q[b + 2] < share ? q[b + 2] : share;
        if (want > q[b + 1]) r += want - q[b + 1];
      }
      return r;
    }
    // the grains its oscillators still want (demand = live streams × overlapping grains, ≤ their caps)
    function granNeed(q) {
      let r = 0;
      for (let b = 0; b < GQ; b += 4) if (q[b] !== 0 && q[b + 3] === 1 && q[b + 2] > q[b + 1]) r += q[b + 2] - q[b + 1];
      return r;
    }
    // P stage on the grain read positions PA (PB when xf) — sx-sample.js's pStage (§6.6.4, §6.6.10): PD 39–44 offsets
    // by I·m·T₀ (pdBlock), the other P modes map the intra-period phase, PD (Self) index → PS.sI; 1 ⇔ WIN written
    const PS = { sI: 0 };
    // (M4: the amounts are read from their arrays — wa[ia], wb[ib] — and Var 1 / 2, T₀ and 1/T₀ from PSD[0 … 3], which the
    // caller sets once per render: doubles passed to calls that are not inlined are boxed, per grain / voice and chunk)
    const PSD = new Float64Array(4);
    function pStage(W, sl, si, mc, f0, f1, m0, m1, wa, ia, wb, ib, rt, rb, mA, sA, mB, sB, xf, n) {
      let ok = 0, win = 0, sI = 0;
      const T0 = PSD[2], iT = PSD[3];
      for (let k = 0; k < 2; k++) {
        if ((k === 0 ? f0 : f1) === 0) continue;
        const m = k === 0 ? m0 : m1, wv = k === 0 ? wa : wb, wi = k === 0 ? ia : ib, v = PSD[k], M = k === 0 ? mA : mB, ms = k === 0 ? sA : sB;
        if (m === M_PDSELF) { sI += sl.pdI[k * sl.maxUni + si]; continue; }
        if (m >= M_PD0 && m <= M_PD1) {
          W.pdBlock(sl, k, si, m, wv[wi], M, ms, PDO, n, mc);
          for (let s = 0; s < n; s++) PA[s] += PDO[s] * T0;
          if (xf) for (let s = 0; s < n; s++) PB[s] += PDO[s] * T0;
          ok = 0;
          continue;
        }
        if (ok === 0) {
          for (let s = 0; s < n; s++) { const q = PA[s] * iT, fl = floor(q); PHW[s] = q - fl; PBA[s] = fl * T0; }
          if (xf) for (let s = 0; s < n; s++) { const q = PB[s] * iT, fl = floor(q); PHX[s] = q - fl; PBX[s] = fl * T0; }
          ok = 1;
        }
        W.phaseBlockA(sl, k, si, m, wv, wi, v, rt, rb, M, ms, PHW, PHW, WIN, n, mc);
        if (xf) W.phaseBlockA(sl, k, si, m, wv, wi, v, rt, rb, M, ms, PHX, PHX, null, n, mc);
        if (sl.hw[k] === 1) win = 1;
        for (let s = 0; s < n; s++) PA[s] = PBA[s] + PHW[s] * T0;
        if (xf) for (let s = 0; s < n; s++) PB[s] = PBX[s] + PHX[s] * T0;
      }
      PS.sI = sI;
      return win;
    }
    // one Hermite read of channel ch at level lv, level-0 position p (processed coordinates, clamped)
    function rdAt(e, lv, ch, rev, p) {
      const lev = e.levels[lv], d = ch === 0 || lev.R === null || lev.R === undefined ? lev.L : lev.R, nm = lev.len - 1;
      const sc = 1 / (1 << lv);
      let q = rev ? (e.len - 1 - p) * sc : p * sc;
      if (!(q > 0)) q = 0; else if (q > nm) q = nm;
      const i = q | 0, f = q - i;
      const xm = d[i > 0 ? i - 1 : 0], x0 = d[i], x1 = d[i < nm ? i + 1 : nm], x2 = d[i + 2 <= nm ? i + 2 : nm];
      return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
    }
    function rdMix(e, lv, ch, rev, pa, pb, s) {
      const x = rdAt(e, lv, ch, rev, pa);
      return pb === pb ? WA[s] * x + WB[s] * rdAt(e, lv, ch, rev, pb) : WA[s] * x;
    }
    // a grain's reads with PD (Self) feedback for s0 ≤ s < s1 (§6.6.4; y₁ per grain, SxWarp header proposal): p_r =
    // gbnd(p + I·y₁·T₀), x = read(p_r) into GX/GXR, y₁ ← the raw read (stereo: mono average), the Odd/Even read at
    // gbnd(p_r + T₀/2); the Loop Grains fade partner is offset likewise, unbounded (outside the loop by design)
    function readSelf(e, lv, rev, stereo, P2, I, T0, y1, odd, s0, s1) {
      const hT = 0.5 * T0;
      for (let s = s0; s < s1; s++) {
        const off = I * y1 * T0, pa = gbnd(PA[s] + off), pb = P2 !== null ? P2[s] + off : NaN;
        const l = rdMix(e, lv, 0, rev, pa, pb, s), r = stereo ? rdMix(e, lv, 1, rev, pa, pb, s) : l;
        GX[s] = l; GXR[s] = r;
        y1 = stereo ? 0.5 * (l + r) : l;
        if (odd) {
          const qa = gbnd(pa + hT), qb = P2 !== null ? pb + hT : NaN;
          GX2[s] = rdMix(e, lv, 0, rev, qa, qb, s);
          GX2R[s] = stereo ? rdMix(e, lv, 1, rev, qa, qb, s) : GX2[s];
        }
      }
      return y1;
    }

    /* ------------------------------------------------------------ Granular (§6.9) */
    class GranOsc {
      constructor(voice, o) {
        this.v = voice; this.o = o >= 0 && o <= 2 ? o | 0 : 0;
        this.B = null; this.k0 = -1; this.kLen = -1;            // SxBase and the vi of k.w1 / k.lenrate (apply)
        this.ok = 0; this.sel = 0;
        this.id = ''; this.e = null; this.ep = -1;               // entry id, resolved entry, epoch it was resolved at
        // options (§2.2.3, CP §4.1)
        this.loop = 0; this.rel = 0; this.link = 0; this.exit = 0; this.loopGr = 0; this.scanKey = 0; this.scanLock = 0;
        this.lenOn = 0; this.slMode = 0; this.slEnd = 0; this.slOne = 0; this.slRoot = 36; this.slN = 0;
        this.win = 0; this.dens = 0; this.densJump = 1; this.glen = 0; this.norm = 0; this.rev = 0;
        this.xyOn = 0; this.xyY = 0; this.xyMode = 0; this.spawn = 0; this.densLadN = 0; this.glenLadN = 0;
        this.scanR = 2; this.bendTrack = 1; this.fm1 = 0; this.fm2 = 0; this.a4 = 440; this.yOff = -1;
        this.sstB = 0; this.lstB = 0; this.lenB = 1;
        this.grMax = MAXGR; this.grProc = 512;                   // caps (§6.9.2)
        this.WT = null; this.WN = 1024;                          // SxBase window tables
        // warps
        this.W = null; this.ws = null; this.wsR = null; this.wg = null; this.wOff = 0; this.wOffR = 0;
        this.m0 = 0; this.m1 = 0; this.d0 = 0; this.d1 = 0;
        // per-voice state: allocated on the first apply that selects Granular (no audio buffers before, §11.8)
        this.gs = null; this.ss = null; this.sl = null; this.densLad = null; this.glenLad = null; this.lad = null;
        this.cU = null;                                          // live grains per stream (Int32Array(16))
        // note state
        this.on = 0; this.gate = 0; this.fresh = 0; this.N = 0; this.nGr = 0; this.pend = 0; this.jump = 0;
        this.key = 60; this.nS = 0; this.nSl = 0; this.nUs = 0; this.nUsp = 0; this.hasR2 = 0; this.r2s = 1;
        this.sliced = 0; this.slA = 0; this.slB = 1; this.clk = 0; this.sx = null; this.kInc = 1;
        this.dps = 0;                                            // stream playhead increment per sample (this chunk)
        this.wants = 0;                                          // 1 while a stream can spawn (processor cap shares)
        this.dem = 0;                                            // grains it wants: live streams × ⌈L_g/T_s⌉, ≤ grMax
        this.gid = ++GID; this.gq = null; this.gk = -1;           // id, registry (sx.granQ) and its slot (−1: none)
        // fields that keep their initial value for long stretches are stored twice here: the engine then never treats
        // them as constants, and their first real change (a retrigger, a backward Tailed note, …) does not throw the
        // optimised render code away on the audio thread (measured: a 1.4 ms warmTick, §14.1 row q)
        this.nFade = 1; this.nFade = 0; this.fdN = 2; this.fdN = 1; this.ownPan = 1; this.ownPan = 0; this.tb = 1; this.tb = 0;
        this.gk = 0; this.gk = -1; this.wants = 1; this.wants = 0; this.dem = 1; this.dem = 0;
        this.nFade = 0; this.fdN = 1;                            // grains fading out after a non-legato retrigger, fade length
        this.ownPan = 0;                                         // ctx.ownPan: grains carry the stream pan (§6.9.3)
        // [+] (M4) 1 on GRAN_JOB's hidden voices (serum-dsp, §11.10): grains ≤ WQ_LG s and stream playheads crossing their
        // region in ≈ WQ_CH chunks — the paths a real note meets only after a while (grains ending, spawns into the room
        // they leave, reads crossing the region ends, loop wraps, playhead ends) run in the warm-up, not in the first real
        // chord (V8 deoptimised the whole render there: 4–6 ms quanta). Stored twice: see above
        this.wq = 1; this.wq = 0;
        // region of the current chunk
        this.L = 0; this.S = 0; this.E = 0; this.sg = 1; this.RL = 0; this.LS = 0; this.LE = 0; this.ld = 1; this.LL = 1;
        this.LxF = 0; this.LxB = 0; this.lmode = 0; this.tb = 0;   // tb: Tailed note started backwards (tail [S, M])
        // per-chunk granular values (render → spawn)
        this.Ts = 1; this.Lg = 0.1; this.ovl = 1; this.vRoff = 0; this.vRdir = 0; this.vRp = 0; this.vRlen = 0; this.vRpan = 0;
        this.vRlvl = 0; this.vWamt = 1; this.vWsk = 0; this.vRwamt = 0; this.vRwsk = 0; this.vRw1 = 0; this.vRw2 = 0; this.vGrev = 0;
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
      }
      apply(cp, o, qr) {
        if (!(o >= 0 && o <= 2)) { this.ok = 0; this.sel = 0; return badCP('oscillator index ' + o); }
        o |= 0;
        this.o = o;
        let why = checkCP(cp);
        const q = why ? null : qr != null ? qr : cp.qr;
        if (!why && !qrOk(q)) why = 'qr must hold 5 finite numbers';
        if (why) { this.ok = 0; this.sel = 0; return badCP(why); }
        const B = sxBase();
        if (B === null) { this.ok = 0; this.sel = 0; return false; }
        const D = B.DIDX2, P = OSC_LETTER[o], k0 = D[P + '_W1'], kl = D[P + '_LENRATE'];
        if (B.OTYPE.GRAN !== T_GRAN) { this.ok = 0; this.sel = 0; return badCP('SxBase OTYPE codes differ'); }
        if (!(k0 >= 0) || D[P + '_BUS2'] !== k0 + K.BUS2 || !(kl >= 0)) {
          this.ok = 0; this.sel = 0; return badCP('SxBase destination indices differ');
        }
        this.B = B; this.k0 = k0; this.kLen = kl; this.WT = B.WIN_TAB; this.WN = B.WIN_N > 0 ? B.WIN_N : 1024;
        this.a4 = typeof cp.a4 === 'number' && cp.a4 > 0 && cp.a4 < Infinity ? cp.a4 : 440;
        this.ok = 1;
        this.sel = cp.oType[o] === T_GRAN ? 1 : 0;
        if (this.sel === 0) this.wants = 0;
        if (this.sel === 1 && this.gs === null) {
          this.gs = new Float64Array(MAXGR * GST); this.ss = new Float64Array(MAXUNI * NSS); this.cU = new Int32Array(MAXUNI);
          this.sl = new Float64Array(NSL); this.densLad = new Float64Array(NLADG); this.glenLad = new Float64Array(NLADG);
          this.lad = new Float64Array(NLAD);
        }
        if (this.sel === 1) {
          // the processor's registry of the most recent granular voice (§6.9.2 shares), as SxSample's sx.msRR
          const v = this.v, proc = v !== null && typeof v === 'object' ? v.proc : null;
          const psx = proc && typeof proc === 'object' ? proc.sx : null;
          if (psx !== null && typeof psx === 'object' && !(tag(psx.granQ) === 'Float64Array' && psx.granQ.length === GQ)) {
            psx.granQ = new Float64Array(GQ);
          }
          const W = sxWarp();
          this.W = W;
          if (W !== null && this.ws === null) { this.ws = new W.Slots(MAXUNI); this.wsR = new W.Slots(MAXUNI); this.wg = new W.Slots(MAXUNI); }
        }
        this.loop = cp.sLoop[o]; this.rel = cp.sRel[o]; this.link = cp.sLink[o]; this.exit = cp.sExit[o];
        this.loopGr = cp.sLoopGr[o]; this.scanKey = cp.sScanKey[o]; this.scanLock = cp.sScanLock[o]; this.lenOn = cp.sLenOn[o];
        this.slMode = cp.sSlMode[o]; this.slEnd = cp.sSlEnd[o]; this.slOne = cp.sSlOne[o]; this.slRoot = cp.sSlRoot[o];
        this.slN = cp.sSlN[o]; this.win = cp.sWin[o] < 10 ? cp.sWin[o] : 0; this.dens = cp.sDens[o]; this.densJump = cp.sDensJump[o];
        this.glen = cp.sGlen[o]; this.norm = cp.sNorm[o]; this.rev = cp.sRev[o]; this.xyOn = cp.xyOn[o];
        this.xyY = cp.xyY[o]; this.xyMode = cp.xyMode[o]; this.spawn = cp.spawn[o];
        this.densLadN = cp.sDensLadN[o]; this.glenLadN = cp.sGlenLadN[o];
        this.scanR = +cp.sScanR[o]; this.bendTrack = cp.bendTrack[o];
        this.fm1 = cp.fmType[o * 2]; this.fm2 = cp.fmType[o * 2 + 1];
        this.yOff = this.xyOn === 1 && this.xyY < XY_OFF.length ? XY_OFF[this.xyY] : -1;
        const bs = cp.base;
        this.sstB = bs[k0 + K.SSTART]; this.lstB = bs[k0 + K.LSTART]; this.lenB = bs[k0 + K.LEND];
        const mg = cp.sMaxGr[o], qm = capInt(q[1], 1, MAXGR);
        this.grMax = mg < 1 ? 1 : mg < qm ? mg : qm;
        this.grProc = capInt(q[4], 1, 4096);
        if (this.gs !== null) {
          const sp = cp.sSlPos, b = o * NSL, sl = this.sl;
          for (let j = 0; j < NSL; j++) sl[j] = sp[b + j];
          const dl = cp.sDensLad, gl = cp.sGlenLad, bg = o * NLADG, dd = this.densLad, gg = this.glenLad;
          for (let j = 0; j < NLADG; j++) { dd[j] = dl[bg + j]; gg[j] = gl[bg + j]; }
          const ll = cp.lenLad, lad = this.lad;
          for (let j = 0; j < NLAD; j++) lad[j] = ll[j];
        }
        const id = cp.smp[o];
        if (id !== this.id) { this.id = id; this.e = null; this.ep = -1; }
        return true;
      }
      sxOf(ctx) {
        const sx = ctx.sx;
        return sx !== null && typeof sx === 'object' ? sx : NOSX;
      }
      noteOn(ctx, fresh, legato) {
        this.gate = 1;
        if (this.ok === 0 || this.sel === 0) { this.on = 0; return; }
        this.fresh = fresh ? 1 : 0;
        const sx = this.sxOf(ctx);
        if (this.sx !== null && this.sx !== sx && this.nGr > 0) this.dropAll();   // processor changed (tools)
        this.sx = sx;
        if (legato && this.on === 1) return;                    // a legato note keeps the running streams and grains
        // a non-legato note on a sounding oscillator: its running grains fade out over FADE (they would otherwise hold
        // the oscillator's cap for up to L_g); the new note's Jump Start waits for them (≤ FADE)
        if (this.nGr > 0) {
          const gs = this.gs, fd = round(FADE * (ctx.fs > 0 ? ctx.fs : 48000)) || 1;
          let nf = 0;
          for (let gi = 0; gi < this.nGr; gi++) {
            const g = gi * GST;
            if (gs[g + G_FD] === 0 || gs[g + G_FD] > fd) gs[g + G_FD] = fd;
            nf++;
          }
          this.nFade = nf; this.fdN = fd;
        }
        let N = ctx.N | 0;
        N = N < 1 ? 1 : N > MAXUNI ? MAXUNI : N;
        this.on = 1; this.N = N;
        const eff = ctx.eff, k0 = this.k0, ss = this.ss;
        this.nS = eff[k0 + K.SSTART]; this.nSl = eff[k0 + K.SLICE];
        this.nUs = eff[k0 + K.USTART]; this.nUsp = eff[k0 + K.USPAN];
        this.key = keyOf(ctx, this.v);
        seedR2(this);
        for (let u = 0; u < MAXUNI; u++) { const b = u * NSS; ss[b + T_U] = u < N && this.nUs !== 0 ? rnd(this) : 0; ss[b + T_PH] = PH_END; }
        if (fresh && this.ws !== null) { this.ws.reset(); this.wsR.reset(); }
        // the most recent granular voice (§6.9.2): its oscillators register for the processor-cap shares
        const q = tag(sx.granQ) === 'Float64Array' && sx.granQ.length === GQ ? sx.granQ : null;
        if (sx.granLast !== this.v) { sx.granLast = this.v; if (q !== null) q.fill(0); }
        sx.granStarve = 0;
        this.gq = q; this.gk = -1;
        if (q !== null) {
          for (let k = 0; k < 3 && this.gk < 0; k++) if (q[4 * k] === this.gid) this.gk = k;
          for (let k = 0; k < 3 && this.gk < 0; k++) if (q[4 * k] === 0) { this.gk = k; q[4 * k] = this.gid; }
        }
        this.wants = 1; this.dem = this.grMax;                  // demand unknown until the first render: the cap
        this.pub();
        if (this.B.epoch !== this.ep) this.resolve();
        this.pend = 1; this.jump = 1;
        if (this.e !== null) this.start(ctx);
      }
      noteOff() { this.gate = 0; }
      resolve() {                                                 // the playback entry of the current id (§4.5)
        const B = this.B, e = this.id !== '' ? B.getAsset(this.id) : null;
        this.e = e !== null && e !== undefined && e.kind === 'smp' ? e : null;
        this.ep = B.epoch;
      }
      // §6.9.1 with §6.7.2: the signed scan factor σ
      sigma(ctx) {
        const eff = ctx.eff, k0 = this.k0, sr = eff[k0 + K.SCANREV] >= 0.5 ? -1 : 1, bpm = ctx.bpm > 0 ? ctx.bpm : 120;
        if (this.lenOn === 1) {
          let j = round(14 * eff[this.kLen]);
          j = j > 0 ? (j < 14 ? j : 14) : 0;
          const T = this.lad[j] * 60 / bpm;
          return T > 0 ? sr * (this.RL / this.e.rate) / T : 0;
        }
        let s = sr * (2 * eff[k0 + K.SCAN] - 1) * this.scanR;
        if (this.scanKey === 1) s *= exp2((keyRefOf(ctx, this.key) - 60) / 12);
        if (this.scanLock === 1) s *= bpm / 120;
        return s;
      }
      region(eff) {                                               // = SampleOsc.region (sx-sample.js)
        const L = this.L, k0 = this.k0, S = this.S, e = this.e;
        const E = this.sliced === 1 && this.slEnd === 0 ? this.slB * L : eff[k0 + K.SEND] * L;
        const sg = E >= S ? 1 : -1, RL = sg > 0 ? E - S : S - E, lo = sg > 0 ? S : E, hi = sg > 0 ? E : S;
        this.E = E; this.sg = sg; this.RL = RL;
        const mode = this.loop, xf = eff[k0 + K.XFADE];
        this.lmode = mode;
        if (mode === LM_TAIL) {
          // the tail is the half of the region played last: [M, E] forwards, [S, M] for a note started backwards
          const M = 0.5 * (S + E), LL = 0.5 * RL, LS = this.tb === 1 ? S : M, LE = this.tb === 1 ? M : E;
          this.LS = LS; this.LE = LE; this.ld = sg; this.LL = LL > 1e-9 ? LL : 1e-9;
          let lx = xf * 0.5 * LL;
          const m10 = 0.01 * e.rate;
          if (lx < m10) lx = m10;
          const half = 0.5 * LL, rF = sg > 0 ? LS : L - 1 - LS, rB = sg > 0 ? L - 1 - LE : LE;
          let a = lx < rF ? lx : rF; a = a < half ? a : half;
          let b = lx < rB ? lx : rB; b = b < half ? b : half;
          this.LxF = a > 0 ? a : 0; this.LxB = b > 0 ? b : 0;
        } else {
          let LS = eff[k0 + K.LSTART] * L, LE = eff[k0 + K.LEND] * L;
          if (this.rel === 1) { const d = S - this.sstB * L; LS += d; LE += d; }
          if (this.link === 1) LE = LS + (this.lenB - this.lstB) * L;
          LS = LS < lo ? lo : LS > hi ? hi : LS;
          LE = LE < lo ? lo : LE > hi ? hi : LE;
          const ld = LE >= LS ? 1 : -1, LL = ld > 0 ? LE - LS : LS - LE;
          this.LS = LS; this.LE = LE; this.ld = ld; this.LL = LL > 1e-9 ? LL : 1e-9;
          const lx = xf * 0.5 * LL, half = 0.5 * LL, rF = ld > 0 ? LS : L - 1 - LS, rB = ld > 0 ? L - 1 - LE : LE;
          let a = lx < rF ? lx : rF; a = a < half ? a : half;
          let b = lx < rB ? lx : rB; b = b < half ? b : half;
          this.LxF = a > 0 ? a : 0; this.LxB = b > 0 ? b : 0;
        }
        const iL = L > 0 ? 1 / L : 0;
        this.mS = S * iL; this.mLS = this.LS * iL; this.mLE = this.LE * iL;
      }
      // the streams from the note-on values (§6.9.1, §6.7.5, §6.7.6); the entry is resolved
      start(ctx) {
        this.pend = 0;
        const e = this.e, L = e.len, ss = this.ss, N = this.N;
        this.L = L;
        this.sliced = 0;
        if (this.xyOn === 0 && this.slMode !== 0 && this.slN >= 1) {   // slicing is off while X|Y is on (§6.7.5)
          const nS = this.slN;
          let j;
          if (this.slOne === 1) { j = round(255 * this.nSl); if (j > nS - 1) j = nS - 1; if (j < 0) j = 0; }
          else j = this.key - this.slRoot;
          if (j < 0 || j > nS - 1) { for (let u = 0; u < MAXUNI; u++) ss[u * NSS + T_PH] = PH_END; this.jump = 0; return; }
          this.sliced = 1; this.slA = this.sl[j]; this.slB = this.sl[j + 1];
        }
        this.S = (this.sliced === 1 ? this.slA : this.nS) * L;
        this.tb = 0;
        this.region(ctx.eff);
        const back = this.sigma(ctx) < 0, RL = this.RL, spawn = this.spawn;
        if (back && this.lmode === LM_TAIL) { this.tb = 1; this.region(ctx.eff); }
        this.clk = 0;
        for (let u = 0; u < N; u++) {
          const b = u * NSS, d = (this.nUs * ss[b + T_U] + this.nUsp * u / N) * RL;
          ss[b + T_LT] = 1;
          this.initHead(b, back ? RL - d : d, back);
          const off = spawn === 1 ? u / N : spawn === 2 ? exp2(u / N) - 1 : spawn === 3 ? rnd(this) : 0;
          ss[b + T_NX] = off > 0 ? off : 1;
          if (spawn === 3) ss[b + T_NX] = 1 + off;
        }
        for (let u = N; u < MAXUNI; u++) ss[u * NSS + T_PH] = PH_END;
      }
      // = SampleOsc.rIn: region coordinate where an approach in travel direction sd enters the loop
      rIn(sd) {
        const S = this.S, sg = this.sg, mode = this.lmode, rLE = (this.LE - S) * sg, rLS = (this.LS - S) * sg;
        if (mode === LM_TAIL) return sd > 0 ? this.RL : 0;
        if (sd > 0) return rLE;
        if (mode === LM_REV) return rLE < rLS ? rLE : rLS;
        return rLE > rLS ? rLE : rLS;
      }
      initHead(b, r, back) {                                      // = SampleOsc.initHead on the stream state
        const ss = this.ss, S = this.S, sg = this.sg, RL = this.RL, mode = this.lmode;
        let ph = PH_APP, lt = 1, P;
        if (mode === LM_ONE) {
          if (r > RL || r < 0) { ph = PH_END; r = r < 0 ? 0 : RL; }
          P = S + sg * r;
        } else {
          P = S + sg * r;
          const ri = this.rIn(back ? -1 : 1), enter = back ? r <= ri : r >= ri;
          if (enter || r < 0 || r > RL) {
            ph = PH_LOOP; lt = mode === LM_REV || mode === LM_PP ? -1 : 1;
            const LL = this.LL;
            let lam = (P - this.LS) * this.ld;
            if (lam >= LL || lam < 0) lam -= LL * floor(lam / LL);
            P = this.LS + this.ld * lam;
          }
        }
        ss[b + T_P] = P; ss[b + T_PH] = ph; ss[b + T_LT] = lt;
      }
      // stream playhead pass (SampleOsc.headPass without the read crossfade and FM: dr has the scan direction's sign):
      // positions into SPOS[u·32 + s]
      streamPass(u, dr, n) {
        const ss = this.ss, b = u * NSS, ob = u * MAXCH, mode = this.lmode, S = this.S, sg = this.sg, RL = this.RL;
        const LS = this.LS, ld = this.ld, LL = this.LL, exit = this.exit === 1 && this.gate === 0;
        const sd = dr < 0 ? -1 : 1, ri = this.rIn(sd), adr = dr < 0 ? -dr : dr;
        let P = ss[b + T_P], ph = ss[b + T_PH], lt = ss[b + T_LT];
        for (let s = 0; s < n; s++) {
          SPOS[ob + s] = P;
          if (ph === PH_END) continue;
          if (ph === PH_APP) {
            let r = (P - S) * sg + dr;
            if (mode === LM_ONE || exit) {
              if (sd > 0 ? r >= RL : r < 0) { ph = PH_END; r = sd > 0 ? RL : 0; }
              P = S + sg * r;
            } else if (sd > 0 ? r >= ri : r <= ri) {
              P = S + sg * r;
              ph = PH_LOOP; lt = mode === LM_REV || mode === LM_PP ? -1 : 1;
              let lam = (P - LS) * ld;
              if (lt === 1) {                                       // Fwd, Tailed: wrap at once (LE → LS)
                if (lam >= LL || lam < 0) lam -= LL * floor(lam / LL);
              } else {                                              // Rev, Fwd/Rwd: turn at the loop end reached
                if (lam > LL) lam = 2 * LL - lam;
                if (lam < 0) lam = lam < -LL ? 0 : -lam;
                if (lam > LL) lam = LL;
              }
              P = LS + ld * lam;
            } else {
              if (r < 0) r = 0; else if (r > RL) r = RL;
              P = S + sg * r;
            }
          } else if (ph === PH_LOOP) {
            if (exit) { ph = PH_EXIT; lt = (lt * sd < 0 ? -ld : ld) * sg; } else {
              let lam = (P - LS) * ld + lt * dr;
              if (mode === LM_PP) {                               // reflect at both ends (landing on LE stays there)
                if (lam > LL || lam < 0) {
                  const c = lam > LL ? ceil(lam / LL) - 1 : ceil(-lam / LL), m = lam - 2 * LL * floor(lam / (2 * LL));
                  lam = m <= LL ? m : 2 * LL - m;
                  if ((c & 1) === 1) lt = -lt;
                }
              } else if (lam >= LL) {
                lam -= LL;
                if (lam >= LL) lam -= LL * floor(lam / LL);
              } else if (lam < 0) {
                lam += LL;
                if (lam < 0) lam -= LL * floor(lam / LL);
              }
              P = LS + ld * lam;
            }
          }
          if (ph === PH_EXIT) {
            const r = (P - S) * sg + lt * adr;
            if (lt > 0 ? r >= RL : r < 0) { ph = PH_END; P = S + sg * (lt > 0 ? RL : 0); } else P = S + sg * r;
          }
        }
        ss[b + T_P] = P; ss[b + T_PH] = ph; ss[b + T_LT] = lt;
      }
      // eff n of an O2 destination with the X|Y Y target applied (§3.9 XY_MODES)
      effY(eff, off, gy) {
        const x = eff[this.k0 + off];
        if (off !== this.yOff) return x;
        const m = this.xyMode, y = m === 0 ? x + 2 * gy - 1 : m === 1 ? gy : x * gy;
        return y > 0 ? (y < 1 ? y : 1) : 0;
      }
      // a spawn of stream u is allowed by the caps (§6.9.2; spawns at a cap are skipped, running grains never cut):
      // (1) the oscillator's cap grMax, shared fairly by its live streams (a stream beyond floor(grMax/N) spawns only
      // into room the other live streams' unused shares leave); (2) the processor cap grProc: other voices spawn only
      // into room below it that the most recent granular voice does not want (its demand) and while that voice is not
      // refused — the oldest voices thin out first; that voice's K granular oscillators split it (share floor(grProc/K)
      // each, reserved while wanted), and when the cap is full of older voices' grains each may still spawn up to
      // floor(grProc/2/K) — the new note sounds at once, the processor count stays below 1.5·grProc and is back under
      // grProc once the older grains end (IMPL; §15.8 "never exceed" ↔ §6.9.2 "spawns up to its own cap": lead ruling
      // requested). A refusal of that voice sets sx.granStarve
      canSpawn(sx, u, NL) {
        const nG = this.nGr, gm = this.grMax;
        if (nG >= gm) return false;
        const cU = this.cU, q = floor(gm / NL);
        if (cU[u] >= q) {
          let res = 0;
          for (let w = 0; w < this.N; w++) if (w !== u && LIVE[w] === 1 && cU[w] < q) res += q - cU[w];
          if (nG + res >= gm) return false;
        }
        const T = sx.grains > 0 ? sx.grains : 0, P = this.grProc;
        const gq = this.gq;
        if (sx.granLast !== this.v) return sx.granStarve !== 1 && T + (gq !== null ? granNeed(gq) : 0) < P;
        const K = gq !== null ? granK(gq) : 1, share = floor(P / K);
        if (T < P) {
          if (nG < share || T + (gq !== null ? granRes(gq, this.gk, share) : 0) < P) return true;
        } else if (nG < floor((P >> 1) / K) && T < P + (P >> 1)) return true;
        sx.granStarve = 1;
        return false;
      }
      // a new grain of stream u at chunk sample s0, stream position p0, age in samples (Jump Start: read position as
      // if it had been spawned age samples ago from the moving playhead, §6.9.2 — p0 − age·dps + age·inc; the Offset
      // spread is added and the position folded into the region [lo, hi])
      spawnGrain(sx, u, s0, p0, age, fs, lo, hi) {
        const g = this.nGr * GST, gs = this.gs;
        // ten r2 draws, fixed order (§6.9.3)
        const uLen = rnd(this), uOff = rnd(this), uDir = rnd(this), uPit = rnd(this), uPan = rnd(this), uLvl = rnd(this);
        const uWa = rnd(this), uWs = rnd(this), uW1 = rnd(this), uW2 = rnd(this);
        let len = round(this.Lg * exp2(this.vRlen * (2 * uLen - 1)) * fs);
        if (len < 2) len = 2;
        if (age >= len) return;                                   // a Jump Start grain that would already be over
        const dir = (uDir < 0.5 * this.vRdir) !== (this.vGrev === 1) ? -1 : 1;
        const pr = dir * exp2(this.vRp * (2 * uPit - 1) / 12);
        const lvl = (1 - this.vRlvl * uLvl) * this.ovl, pan = PAN[u], dp = this.vRpan * (2 * uPan - 1);
        if (this.ownPan === 1) {                                  // §6.9.3: stream pan + rpan·(2u − 1), clamped, equal power
          let q = pan + dp;
          q = q < -1 ? -1 : q > 1 ? 1 : q;
          gs[g + G_GL] = lvl * panG(q, 0); gs[g + G_GR] = lvl * panG(q, 1);
        } else {                                                  // the voice's gains carry the stream pan: balance δ inside it
          let d = dp;
          const dlo = -1 - pan, dhi = 1 - pan;
          d = d < dlo ? dlo : d > dhi ? dhi : d;
          d = d < -1 ? -1 : d > 1 ? 1 : d;
          gs[g + G_GL] = lvl * panG(d, 0); gs[g + G_GR] = lvl * panG(d, 1);
        }
        let wa = this.vWamt + this.vRwamt * (2 * uWa - 1);
        wa = wa > 0 ? (wa < 1 ? wa : 1) : 0;
        let sk = this.vWsk + this.vRwsk * (2 * uWs - 1);
        sk = sk > -1 ? (sk < 1 ? sk : 1) : -1;
        const inc = this.kInc * RHO[u] * pr;
        gs[g + G_P] = fold(p0 + this.vRoff * (2 * uOff - 1) * 0.5 * this.RL + age * (inc - this.dps), lo, hi);
        gs[g + G_PR] = pr; gs[g + G_AGE] = age; gs[g + G_LEN] = len; gs[g + G_IL] = 1 / (len - 1);
        gs[g + G_WA] = wa; gs[g + G_SK] = sk; gs[g + G_U] = u;
        gs[g + G_W1] = this.vRw1 * (2 * uW1 - 1); gs[g + G_W2] = this.vRw2 * (2 * uW2 - 1);
        gs[g + G_LV] = -1; gs[g + G_S0] = s0; gs[g + G_Y1] = 0; gs[g + G_FD] = 0;
        this.nGr++; this.cU[u]++;
        sx.grains = (sx.grains > 0 ? sx.grains : 0) + 1;
        if (sx.granStarve === 1 && sx.granLast === this.v && sx.grains < this.grProc) sx.granStarve = 0;   // demand met
      }
      render(ctx, OL, OR, RAW) {
        const n = ctx.CH;
        for (let s = 0; s < n; s++) { OL[s] = 0; OR[s] = 0; }
        if (RAW !== null) {
          const NN = ctx.N;
          for (let u = 0; u < NN; u++) { const b = u * MAXCH; for (let s = 0; s < n; s++) RAW[b + s] = 0; }
        }
        if (this.on !== 1 || this.B === null) return;
        const sx = this.sxOf(ctx);
        if (this.sx !== sx) { if (this.sx !== null && this.nGr > 0) this.dropAll(); this.sx = sx; }
        const B = this.B;
        if (B.epoch !== this.ep) {
          const old = this.e;
          this.resolve();
          if (this.e !== old) { if (this.nGr > 0) this.dropAll(); this.pend = 1; this.jump = 1; }
        }
        const e = this.e;
        if (e === null) return;
        if (this.pend === 1) this.start(ctx);
        const eff = ctx.eff, k0 = this.k0, ss = this.ss, N = this.N, fs = ctx.fs, bpm = ctx.bpm > 0 ? ctx.bpm : 120;
        const L = e.len, rate = e.rate, rev = this.rev === 1, nLv = e.levels.length, stereo = e.ch === 2;
        this.L = L;
        this.region(eff);
        // granular values of this chunk (X|Y Y target applied, §3.9)
        const gy = eff[k0 + K.GY];
        const dn = this.effY(eff, K.DENS, gy), ln = this.effY(eff, K.GLEN, gy);
        this.vWamt = this.effY(eff, K.WAMT, gy); this.vWsk = 2 * this.effY(eff, K.WSKEW, gy) - 1;
        this.vRoff = this.effY(eff, K.ROFF, gy); this.vRdir = this.effY(eff, K.RDIR, gy);
        this.vRp = 12 * this.effY(eff, K.RPITCH, gy); this.vRlen = this.effY(eff, K.RLEN, gy);
        this.vRpan = this.effY(eff, K.RPAN, gy); this.vRlvl = this.effY(eff, K.RLVL, gy);
        this.vRwamt = this.effY(eff, K.RWAMT, gy); this.vRwsk = this.effY(eff, K.RWSKEW, gy);
        this.vRw1 = this.effY(eff, K.RWARP, gy); this.vRw2 = this.effY(eff, K.RWARP2, gy);
        this.vGrev = eff[k0 + K.GREV] >= 0.5 ? 1 : 0;
        // spawn interval T_s and grain length L_g (§6.9.2, §6.9.3), seconds
        const dm = this.dens, gm = this.glen;
        let Lg = 0, Ts = 1;
        const lgFree = 0.001 * pow(10, 4 * ln);
        if (gm === 1) { const nL = this.glenLadN > 0 ? this.glenLadN : 1; Lg = this.glenLad[round(ln * (nL - 1))] * 60 / bpm; }
        else Lg = lgFree;
        if (dm === 2) { Ts = Lg / round(1 + 63 * dn); }
        else if (dm === 1) { const nD = this.densLadN > 0 ? this.densLadN : 1; Ts = this.densLad[round(dn * (nD - 1))] * 60 / bpm; }
        else Ts = 1 / (0.1 * pow(8000, dn));
        if (!(Ts > 1e-6)) Ts = 1e-6;
        if (gm === 2 && dm !== 2) Lg = pow(800, ln) / 100 * Ts;
        if (!(Lg > 0)) Lg = 2 / fs;
        if (this.wq !== 0 && Lg > WQ_LG) Lg = WQ_LG;            // GRAN_JOB's time-compressed warm-up (wq, constructor)
        this.Ts = Ts; this.Lg = Lg;
        const r = Lg / Ts;
        this.ovl = 1 / sqrt(r > 1 ? r : 1);
        // stream ρ (§6.3.3; slices: pitch knobs only / relative to MIDI 60, §6.7.5) and the playhead increment
        const fRoot = 440 * exp2((e.root - 69) / 12);
        let fref = fRoot;
        if (this.sliced === 1) fref = this.slOne === 1 ? this.a4 * exp2(-0.75) : this.a4 * exp2((keyRefOf(ctx, this.key) - 69) / 12);
        const fa = ctx.f, cpan = ctx.pan;
        this.ownPan = ctx.ownPan === 1 ? 1 : 0;
        for (let u = 0; u < N; u++) {
          const f = fa[u], pn = cpan !== null && typeof cpan === 'object' ? cpan[u] : 0;
          RHO[u] = f > 0 ? f / fref : 0; HASG[u] = 0;
          PAN[u] = pn >= -1 && pn <= 1 ? pn : 0;
        }
        this.kInc = rate / fs;
        const kInc = this.kInc, T0 = rate / fRoot, iT = 1 / T0, hT = 0.5 * T0;
        // stream playheads (Manual X|Y: pos·L + Δ_u)
        const manual = this.xyOn === 1;
        const lo = manual ? 0 : this.sg > 0 ? this.S : this.E, hi = manual ? L - 1 : this.sg > 0 ? this.E : this.S;
        let dps = 0;
        if (manual) {
          const px = eff[k0 + K.POS] * L, RL = this.RL;
          for (let u = 0; u < N; u++) {
            const b = u * NSS;
            let p = px + (this.nUs * ss[b + T_U] + this.nUsp * u / N) * RL;
            p = p < 0 ? 0 : p > L - 1 ? L - 1 : p;
            ss[b + T_P] = p; if (ss[b + T_PH] === PH_END) ss[b + T_PH] = PH_APP;
            for (let s = 0; s < n; s++) SPOS[u * MAXCH + s] = p;
          }
        } else {
          const po = eff[k0 + K.POS] * L;
          dps = kInc * this.sigma(ctx);
          if (this.wq !== 0 && dps !== 0) {                     // GRAN_JOB: the region crossed in ≈ WQ_CH chunks
            const k = this.RL / (WQ_CH * n * (dps < 0 ? -dps : dps));
            if (k > 1) dps *= k;
          }
          for (let u = 0; u < N; u++) {
            this.streamPass(u, dps, n);
            if (po !== 0) for (let s = 0; s < n; s++) SPOS[u * MAXCH + s] += po;
          }
        }
        this.dps = dps;
        // the streams that can spawn (they share the oscillator's cap), then Jump Start / the note-on grains — deferred
        // while grains of a replaced note fade out (≤ FADE) — and the spawn schedule of this chunk
        let NL = 0;
        for (let u = 0; u < N; u++) { const l = manual || ss[u * NSS + T_PH] !== PH_END ? 1 : 0; LIVE[u] = l; NL += l; }
        this.wants = NL > 0 ? 1 : 0;
        const NLq = NL > 0 ? NL : 1, dem = NL * ceil(Lg / Ts - 1e-9);
        const gmx = this.grMax;
        this.dem = dem < gmx ? dem : gmx;
        const dc = 1 / (fs * Ts), c0 = this.clk, c1 = c0 + n * dc, spawn = this.spawn;
        if (this.jump === 1 && this.nFade === 0) {
          this.jump = 0;
          const cnt = this.densJump === 1 ? ceil(Lg / Ts - 1e-9) : 1, step = Ts * fs;
          for (let j = 0; j < cnt; j++) {                         // interleaved: at a cap every stream keeps its youngest
            let any = 0;
            for (let u = 0; u < N; u++) {
              if (LIVE[u] === 0 || !this.canSpawn(sx, u, NLq)) continue;
              this.spawnGrain(sx, u, 0, SPOS[u * MAXCH], round(j * step), fs, lo, hi);
              any = 1;
            }
            if (any === 0) break;
          }
        }
        for (let u = 0; u < N; u++) {
          const b = u * NSS;
          let nx = ss[b + T_NX], tries = 0;
          while (nx < c1) {
            if (++tries > MAXGR) { nx = c1 + (spawn === 3 ? rnd(this) : (nx - floor(nx))); break; }
            let s0 = floor((nx - c0) / dc);
            s0 = s0 < 0 ? 0 : s0 > n - 1 ? n - 1 : s0;
            if (LIVE[u] === 1 && this.jump === 0 && this.canSpawn(sx, u, NLq)) {   // (none while Jump Start waits)
              this.spawnGrain(sx, u, s0, SPOS[u * MAXCH + s0], 0, fs, lo, hi);
            }
            nx = spawn === 3 ? floor(nx) + 1 + rnd(this) : nx + 1;
          }
          ss[b + T_NX] = nx;
        }
        this.clk = c1;
        // it cannot spawn any more: its refusal ends (evaluated every chunk, branch-free: a branch first taken mid-note
        // deoptimised this whole function, V8)
        const gLast = sx.granLast, stv = sx.granStarve;
        sx.granStarve = stv === 1 && gLast === this.v && NL === 0 ? 0 : stv;
        // rebase the clock (keeps doubles exact over long notes)
        if (c1 > 1048576) { const sh = floor(c1); this.clk -= sh; for (let u = 0; u < N; u++) ss[u * NSS + T_NX] -= sh; }
        // warps (§6.6.10)
        const W = this.W, ws = this.ws, wsR = this.wsR, wg = this.wg;
        let m0 = 0, m1 = 0, d0 = 0, d1 = 0;
        if (W !== null && ws !== null) {
          const av = W.META.avail, dom = W.META.dom, bit = 1 << T_GRAN;
          m0 = ctx.mode1; m1 = ctx.mode2;
          m0 = m0 >= 1 && m0 <= 81 && (m0 | 0) === m0 && (av[m0] & bit) !== 0 ? m0 : 0;
          m1 = m1 >= 1 && m1 <= 81 && (m1 | 0) === m1 && (av[m1] & bit) !== 0 ? m1 : 0;
          d0 = m0 ? dom[m0] : 0; d1 = m1 ? dom[m1] : 0;
          // every chunk, both slots (SxWarp chunk contract: the per-voice states' only clock); a pair already clocked Off
          // is not clocked again until a mode returns (a repeated Off chunk() changes nothing, as in sx-sample.js)
          const r0 = d0 === DOM_O ? m0 : 0, r1 = d1 === DOM_O ? m1 : 0;
          if (m0 !== 0 || m1 !== 0 || this.wOff === 0) {
            W.chunk(ws, 0, m0, ctx.w1, ctx.var1, ctx.fm1, fa, fs, N);
            W.chunk(ws, 1, m1, ctx.w2, ctx.var2, ctx.fm2, fa, fs, N);
            this.wOff = m0 === 0 && m1 === 0 ? 1 : 0;
          }
          if (r0 !== 0 || r1 !== 0 || this.wOffR === 0) {
            W.chunk(wsR, 0, r0, ctx.w1, ctx.var1, ctx.fm1, fa, fs, N);
            W.chunk(wsR, 1, r1, ctx.w2, ctx.var2, ctx.fm2, fa, fs, N);
            this.wOffR = r0 === 0 && r1 === 0 ? 1 : 0;
          }
        }
        this.m0 = m0; this.m1 = m1; this.d0 = d0; this.d1 = d1;
        const wOn = m0 !== 0 || m1 !== 0;
        const w1 = ctx.w1, w2 = ctx.w2, v1 = ctx.var1, v2 = ctx.var2, fm1 = ctx.fm1 | 0, fm2 = ctx.fm2 | 0;
        const mod1 = ctx.mod1 || null, mod2 = ctx.mod2 || null, ms1 = ctx.modStride1 | 0, ms2 = ctx.modStride2 | 0;
        const rt = wOn ? remapOf(ctx) : IDREMAP, rb = this.o * 2049;
        const odd = m0 === M_ODDEVEN || m1 === M_ODDEVEN;      // the second reads (per stream: em decides below)
        // per-grain warp coefficients: Rand Warp on an F/P slot (batches of 16 grains in wg)
        const rw0 = this.vRw1 !== 0 && (d0 === DOM_F || d0 === DOM_P), rw1 = this.vRw2 !== 0 && (d1 === DOM_F || d1 === DOM_P);
        const batch = rw0 || rw1;
        // stream FM factors (one Slots row per stream)
        for (let u = 0; u < N; u++) {
          const ob = u * MAXCH;
          for (let s = 0; s < n; s++) { SL[ob + s] = 0; SR[ob + s] = 0; }
          oddU[u] = odd && ((m0 === M_ODDEVEN && ws.em[u] !== 0) || (m1 === M_ODDEVEN && ws.em[MAXUNI + u] !== 0)) ? 1 : 0;
          if (oddU[u] === 1) for (let s = 0; s < n; s++) { S2L[ob + s] = 0; S2R[ob + s] = 0; }
          if (!batch && wOn && ((d0 === DOM_F && ws.em[u] !== 0) || (d1 === DOM_F && ws.em[MAXUNI + u] !== 0))) {
            for (let s = 0; s < n; s++) GG[s] = 1;
            if (d0 === DOM_F && ws.em[u] !== 0) W.incBlockA(ws, 0, u, m0, fm1, w1, u, mod1, ms1, GG, GG, n);
            if (d1 === DOM_F && ws.em[MAXUNI + u] !== 0) W.incBlockA(ws, 1, u, m1, fm2, w2, u, mod2, ms2, GG, GG, n);
            for (let s = 0; s < n; s++) SGF[ob + s] = GG[s];
            HASG[u] = 1;
          }
        }
        // grains (§6.9.4, §6.9.5)
        const gs = this.gs, WT = this.WT, WN = this.WN, WN1 = WN - 1, wb = this.win * (WN + 1), loopGr = this.loopGr === 1;
        const LSg = this.LS, ldg = this.ld, LLg = this.LL, LxF = this.LxF, LxB = this.LxB, ifd = 1 / this.fdN;
        // grain read bounds (gbnd, §6.6.10, §6.9.1): Loop Grains wraps into [LS, LE); otherwise reads stay inside the
        // region [S, E) (Manual X|Y: the entry), reflected at its ends — material past the markers is never heard and a
        // grain running off the region (or the entry) turns back instead of stepping to silence
        let rlo = 0, rhi = L - 1;
        if (!manual) {
          if (this.sg > 0) { rlo = this.S; rhi = this.E - 1; } else { rlo = this.E + 1; rhi = this.S; }
          if (rlo < 0) rlo = 0;
          if (rhi > L - 1) rhi = L - 1;
          if (rhi < rlo) rhi = rlo;
        }
        GB[0] = loopGr ? 2 : 1; GB[1] = rlo; GB[2] = rhi; GB[3] = LSg; GB[4] = ldg; GB[5] = LLg;
        for (let g0 = 0; g0 < this.nGr; g0 += MAXUNI) {
          const gEnd = g0 + MAXUNI < this.nGr ? g0 + MAXUNI : this.nGr;
          if (batch) {                                            // per-grain warp amounts (§6.9.3 F/P-domain row)
            for (let j = 0; j < MAXUNI; j++) {
              const gi = g0 + j;
              if (gi < gEnd) {
                const g = gi * GST, u = gs[g + G_U];
                let a = w1[u] + gs[g + G_W1]; WG1[j] = a > 0 ? (a < 1 ? a : 1) : 0;
                a = w2[u] + gs[g + G_W2]; WG2[j] = a > 0 ? (a < 1 ? a : 1) : 0;
                FG[j] = fa[u];
              } else { WG1[j] = 0; WG2[j] = 0; FG[j] = 440; }
            }
            W.chunk(wg, 0, d0 === DOM_F || d0 === DOM_P ? m0 : 0, WG1, v1, fm1, FG, fs);
            W.chunk(wg, 1, d1 === DOM_F || d1 === DOM_P ? m1 : 0, WG2, v2, fm2, FG, fs);
          }
          for (let gi = g0; gi < gEnd; gi++) {
            const g = gi * GST, u = gs[g + G_U], j = gi - g0, ob = u * MAXCH;
            const s0 = gs[g + G_S0], len = gs[g + G_LEN], il = gs[g + G_IL], wa = gs[g + G_WA], sk = gs[g + G_SK];
            let age = gs[g + G_AGE], p = gs[g + G_P], fd = gs[g + G_FD];
            const hasG = HASG[u] === 1, inc = kInc * RHO[u] * gs[g + G_PR];
            // stage flags for this grain
            const sl = batch ? wg : ws, si = batch ? j : u;
            let fF0 = 0, fF1 = 0, fP0 = 0, fP1 = 0;
            if (wOn) {
              const em = sl.em, emS = ws.em;
              if (d0 === DOM_F && (batch ? em[si] : emS[u]) !== 0) fF0 = 1;
              if (d1 === DOM_F && (batch ? em[MAXUNI + si] : emS[MAXUNI + u]) !== 0) fF1 = 1;
              if (d0 === DOM_P && (batch ? em[si] : emS[u]) !== 0) fP0 = 1;
              if (d1 === DOM_P && (batch ? em[MAXUNI + si] : emS[MAXUNI + u]) !== 0) fP1 = 1;
            }
            let spd = 1;
            if (wOn) spd = batch ? wg.sp[si] * wg.sp[MAXUNI + si] : ws.sp[u] * ws.sp[MAXUNI + u];
            const adp = (inc < 0 ? -inc : inc) * spd, lv = lvSel(nLv, adp);
            gs[g + G_LV] = lv;
            const lev = e.levels[lv], dL = lev.L, dR = stereo && lev.R ? lev.R : dL, nl = lev.len, nm = nl - 1;
            const sc = 1 / (1 << lv), A = rev ? (L - 1) * sc : 0, Bm = rev ? -sc : sc;
            const gL = gs[g + G_GL], gR = gs[g + G_GR];
            // (every grain evaluates both ends and the tests: values first computed when a grain ends, or fades, inside a
            // chunk deoptimised this whole function, V8 — M4)
            const sE = s0 + (len - age), sF = s0 + fd;
            let s1 = sE < n ? sE : n;
            if (((fd > 0) & (sF < s1)) !== 0) s1 = sF;              // a retrigger fade-out ends inside this chunk
            const c = s1 > s0 ? s1 - s0 : 0;
            // window position x = WN·t_s, linear over the chunk; with skew t_s is exact at the chunk ends and per sample
            // in the two chunks at the steep end of the skew curve (no per-sample pow elsewhere, §6.9.4)
            let wx = age * il * WN, wdx = il * WN, wex = 0;
            if (sk !== 0 && c > 0) {
              if (sk > 0 ? age < 2 * n : len - age - c < 2 * n) wex = 1;
              else {
                const tz = (age + c) * il, xa = skewT(age * il, sk) * WN;
                wx = xa; wdx = (skewT(tz < 1 ? tz : 1, sk) * WN - xa) / c;
              }
            }
            const fast = !(fF0 | fF1 | fP0 | fP1) && !hasG && oddU[u] === 0;
            if (fast && !loopGr) {
              // fused read: window × Hermite at the grain's own level, reads inside the region (else reflected)
              const pz = p + inc * (c - 1), qa = A + Bm * p, plo = p < pz ? p : pz, phi = p < pz ? pz : p;
              // the chunk's reads inside the region, or wholly in its mirror image past one end (reflected: linear too)
              // (all three cases are evaluated for every grain: a test first evaluated when a grain's chunk left the
              // region deoptimised this whole function, V8 — M4)
              const in0 = (plo >= rlo) & (phi <= rhi), up = (plo >= rhi) & (phi <= 2 * rhi - rlo), dn = (phi <= rlo) & (plo >= 2 * rlo - rhi);
              const qU = A + Bm * (2 * rhi - p), qD = A + Bm * (2 * rlo - p), dq = Bm * inc, ndq = -dq;
              const isIn = in0 !== 0, isUp = up !== 0, hot = (in0 | up | dn) !== 0;
              const hq0 = isIn ? qa : isUp ? qU : qD, hdq = isIn ? dq : ndq;
              const hz = hq0 + hdq * (c - 1);
              if (hot && wex === 0 && fd === 0 && (hq0 < hz ? hq0 : hz) >= 1 && (hq0 < hz ? hz : hq0) <= nm - 2) {
                const G = GHP;                                    // (doubles through GHP: no boxed call arguments)
                G[0] = hq0; G[1] = hdq; G[2] = wx; G[3] = wdx; G[4] = wa; G[5] = gL; G[6] = gR;
                if (stereo) grainHot2(dL, dR, WT, wb, WN, ob, s0, s1);
                else grainHot(dL, WT, wb, WN, ob, s0, s1);
                p += inc * c;
              } else for (let s = s0, k = 0; s < s1; s++, k++) {
                const ts = wex === 1 ? skewT((age + k) * il, sk) * WN : wx + k * wdx;
                const x = ts < WN ? ts : WN, ji = x < WN ? x | 0 : WN1, wf = x - ji;
                let wv = 1 - wa + wa * (WT[wb + ji] + (WT[wb + ji + 1] - WT[wb + ji]) * wf);
                if (fd > 0) wv *= (fd - k) * ifd;
                const pr = fold(p, rlo, rhi);                     // (= p inside the region)
                const yl = hq(dL, nm, A + Bm * pr);
                SL[ob + s] += gL * wv * yl;
                SR[ob + s] += gR * wv * (stereo ? hq(dR, nm, A + Bm * pr) : yl);
                p += inc;
              }
              age += c;
            } else if (fast) {
              // Loop Grains without per-grain warps: fused wrap into [LS, LE) with the §6.7.4 crossfade
              const fw = inc * ldg >= 0;
              for (let s = s0, k = 0; s < s1; s++, k++) {
                const ts = wex === 1 ? skewT((age + k) * il, sk) * WN : wx + k * wdx;
                const x = ts < WN ? ts : WN, ji = x < WN ? x | 0 : WN1, wf = x - ji;
                let wv = 1 - wa + wa * (WT[wb + ji] + (WT[wb + ji + 1] - WT[wb + ji]) * wf);
                if (fd > 0) wv *= (fd - k) * ifd;
                const lam = (p - LSg) * ldg;
                let fu = 0, pp = p;
                if (fw) { if (LxF > 0 && lam > LLg - LxF && lam <= LLg) { fu = (lam - (LLg - LxF)) / LxF; pp = p - ldg * LLg; } }
                else if (LxB > 0 && lam < LxB && lam >= 0) { fu = (LxB - lam) / LxB; pp = p + ldg * LLg; }
                let yl = hq(dL, nm, A + Bm * p), yr = stereo ? hq(dR, nm, A + Bm * p) : yl;
                if (fu > 0) {
                  fadeW(s, fu);
                  yl = WA[s] * yl + WB[s] * hq(dL, nm, A + Bm * pp);
                  yr = stereo ? WA[s] * yr + WB[s] * hq(dR, nm, A + Bm * pp) : yl;
                }
                SL[ob + s] += gL * wv * yl; SR[ob + s] += gR * wv * yr;
                p += inc;
                let lm = (p - LSg) * ldg;
                if (lm >= LLg || lm < 0) { lm -= LLg * floor(lm / LLg); p = LSg + ldg * lm; }
              }
              age += c;
            } else {
              // block path: positions (FM, Loop Grains), P stage, reads, window
              const mc = batch ? u : -1;                          // per-grain Slots row j reads the stream's modulator column
              if (batch && (fF0 | fF1)) {
                for (let s = 0; s < n; s++) GG[s] = 1;
                if (fF0) W.incBlockA(wg, 0, j, m0, fm1, WG1, j, mod1, ms1, GG, GG, n, mc);
                if (fF1) W.incBlockA(wg, 1, j, m1, fm2, WG2, j, mod2, ms2, GG, GG, n, mc);
              } else if (hasG) for (let s = 0; s < n; s++) GG[s] = SGF[ob + s];
              const useG = (batch && (fF0 | fF1)) || hasG;
              let xf = 0;
              for (let s = 0; s < n; s++) {
                PA[s] = p; PB[s] = p; WB[s] = 0;
                if (s < s0 || s >= s1) { WA[s] = 0; TW[s] = 0; continue; }
                WA[s] = 1;
                const dpp = useG ? inc * GG[s] : inc;
                if (loopGr) {
                  const lam = (p - LSg) * ldg, dl = ldg * dpp;
                  if (dl >= 0) { if (LxF > 0 && lam > LLg - LxF && lam <= LLg) { fadeW(s, (lam - (LLg - LxF)) / LxF); PB[s] = p - ldg * LLg; xf = 1; } }
                  else if (LxB > 0 && lam < LxB && lam >= 0) { fadeW(s, (LxB - lam) / LxB); PB[s] = p + ldg * LLg; xf = 1; }
                }
                const k = s - s0, ts = wex === 1 ? skewT((age + k) * il, sk) * WN : wx + k * wdx;
                const x = ts < WN ? ts : WN, ji = x < WN ? x | 0 : WN1, wf = x - ji;
                TW[s] = 1 - wa + wa * (WT[wb + ji] + (WT[wb + ji + 1] - WT[wb + ji]) * wf);
                if (fd > 0) TW[s] *= (fd - k) * ifd;
                p += dpp;
                if (loopGr) {
                  let lam = (p - LSg) * ldg;
                  if (lam >= LLg) lam -= LLg * floor(lam / LLg); else if (lam < 0) lam -= LLg * floor(lam / LLg);
                  p = LSg + ldg * lam;
                }
              }
              age += c;
              let win = 0, sI = 0;
              if (fP0 | fP1) {
                PSD[0] = v1; PSD[1] = v2; PSD[2] = T0; PSD[3] = iT;
                win = pStage(W, sl, si, mc, fP0, fP1, m0, m1, batch ? WG1 : w1, batch ? j : u, batch ? WG2 : w2, batch ? j : u, rt, rb, mod1, ms1, mod2, ms2, xf, n);
                sI = PS.sI;
              }
              // §6.6.10: the reads wrap into the loop (Loop Grains) or stay in the region (reflected)
              if (loopGr) {
                for (let s = s0; s < s1; s++) {
                  const lam = (PA[s] - LSg) * ldg;
                  if (lam < 0 || lam >= LLg) PA[s] = LSg + ldg * (lam - LLg * floor(lam / LLg));
                }
              } else for (let s = s0; s < s1; s++) PA[s] = fold(PA[s], rlo, rhi);   // (= PA[s] inside the region)
              if (win === 1) for (let s = 0; s < n; s++) TW[s] *= WIN[s];
              const P2 = xf ? PB : null, gOdd = odd && oddU[u] === 1;
              if (sI > 0) gs[g + G_Y1] = readSelf(e, lv, rev, stereo, P2, sI, T0, gs[g + G_Y1], gOdd, s0, s1);
              else {
                readW(e, lv, 0, rev, PA, P2, GX, n);
                if (stereo) readW(e, lv, 1, rev, PA, P2, GXR, n);
                if (gOdd) {
                  for (let s = 0; s < n; s++) { PC[s] = gbnd(PA[s] + hT); PD[s] = PB[s] + hT; }
                  readW(e, lv, 0, rev, PC, xf ? PD : null, GX2, n);
                  if (stereo) readW(e, lv, 1, rev, PC, xf ? PD : null, GX2R, n);
                }
                if (s1 > s0) gs[g + G_Y1] = stereo ? 0.5 * (GX[s1 - 1] + GXR[s1 - 1]) : GX[s1 - 1];
              }
              const XR = stereo ? GXR : GX;
              for (let s = s0; s < s1; s++) { SL[ob + s] += gL * TW[s] * GX[s]; SR[ob + s] += gR * TW[s] * XR[s]; }
              if (gOdd) {
                const X2 = stereo ? GX2R : GX2;
                for (let s = s0; s < s1; s++) { S2L[ob + s] += gL * TW[s] * GX2[s]; S2R[ob + s] += gR * TW[s] * X2[s]; }
              }
            }
            if (fd > 0) { fd -= c; if (fd <= 0) { fd = 0; age = len; this.nFade--; } }   // faded out: the grain ends
            gs[g + G_P] = p; gs[g + G_AGE] = age; gs[g + G_S0] = 0; gs[g + G_FD] = fd;
          }
        }
        this.reap(sx);
        // streams: O stage, gains, raw tap
        const gn = this.norm === 1 && e.peak > 0 ? 1 / e.peak : 1, gl = ctx.gl, gr = ctx.gr, dgl = ctx.dgl, dgr = ctx.dgr;
        for (let u = 0; u < N; u++) {
          const ob = u * MAXCH;
          let fO0 = 0, fO1 = 0;
          if (wOn) {
            if (d0 === DOM_O && ws.em[u] !== 0) fO0 = 1;
            if (d1 === DOM_O && ws.em[MAXUNI + u] !== 0) fO1 = 1;
          }
          if (fO0 | fO1) {
            for (let s = 0; s < n; s++) {
              const q = SPOS[ob + s] * iT;
              PHI[s] = q - floor(q); GX[s] = SL[ob + s]; GXR[s] = SR[ob + s]; GX2[s] = S2L[ob + s]; GX2R[s] = S2R[ob + s];
            }
            // the second reads go through both slots when either is Odd/Even (SxWarp outBlock contract)
            const x2l = oddU[u] === 1 ? GX2 : null, x2r = oddU[u] === 1 ? GX2R : null;
            if (fO0) { W.outBlockA(ws, 0, u, m0, w1, u, v1, mod1, ms1, GX, x2l, PHI, n); W.outBlockA(wsR, 0, u, m0, w1, u, v1, mod1, ms1, GXR, x2r, PHI, n); }
            if (fO1) { W.outBlockA(ws, 1, u, m1, w2, u, v2, mod2, ms2, GX, x2l, PHI, n); W.outBlockA(wsR, 1, u, m1, w2, u, v2, mod2, ms2, GXR, x2r, PHI, n); }
            for (let s = 0; s < n; s++) { SL[ob + s] = GX[s]; SR[ob + s] = GXR[s]; }
          }
          let gL = gl[u], gR = gr[u];
          const dL = dgl[u], dR = dgr[u];
          for (let s = 0; s < n; s++) { gL += dL; gR += dR; OL[s] += gL * gn * SL[ob + s]; OR[s] += gR * gn * SR[ob + s]; }
          if (RAW !== null) {                                     // raw tap, pre pan: grains carrying the stream pan
            const pn = PAN[u], kr = this.ownPan === 1 && pn !== 0 ? 2 / (panG(pn, 0) + panG(pn, 1)) : 1;   // (exact without rpan)
            for (let s = 0; s < n; s++) RAW[ob + s] = 0.5 * kr * gn * (SL[ob + s] + SR[ob + s]);
          }
        }
        // snapshot and lifetime
        this.mPos = L > 0 ? ss[T_P] / L : 0;
        // (every stream scanned every chunk and the end stores made unconditionally: branches first taken at a note's
        // end deoptimised this whole function, V8)
        let live = this.nGr > 0 || manual ? 1 : 0;
        for (let u = 0; u < N; u++) live |= ss[u * NSS + T_PH] !== PH_END ? 1 : 0;
        const end = live === 0 && this.jump === 0;
        this.on = end ? 0 : this.on; this.wants = end ? 0 : this.wants;
        this.pub();
      }
      // finished grains leave (the last grain fills the slot; deterministic order). Its own method, called every chunk
      // (M4): the removal path, first taken when a grain ends, then deoptimises this small function only, not render
      // (V8 recompiled the whole render there: a 4–5 ms quantum); GRAN_JOB's time-compressed voice takes it before a
      // real note (wq)
      reap(sx) {
        const gs = this.gs, cU = this.cU;
        let ng = this.nGr;
        for (let gi = 0; gi < ng;) {
          const g = gi * GST;
          if (gs[g + G_AGE] >= gs[g + G_LEN]) {
            const u = gs[g + G_U];
            if (cU[u] > 0) cU[u]--;
            if (gs[g + G_FD] > 0 && this.nFade > 0) this.nFade--;
            ng--;
            if (gi !== ng) { const h = ng * GST; for (let x = 0; x < GST; x++) gs[g + x] = gs[h + x]; }
            sx.grains = sx.grains > 1 ? sx.grains - 1 : 0;
          } else gi++;
        }
        this.nGr = ng;
      }
      dropAll() {                                                 // every grain returned to its processor count
        const sx = this.sx;
        if (sx !== null && this.nGr > 0) sx.grains = sx.grains > this.nGr ? sx.grains - this.nGr : 0;
        this.nGr = 0;
        if (this.nFade !== 0) this.nFade = 0;                   // (no redundant store: see the constructor)
        if (this.cU !== null) this.cU.fill(0);
        this.pub();
      }
      // [grains, demand, wants] into this oscillator's registry slot (while it holds it)
      pub() {
        const q = this.gq, k = this.gk;
        if (q === null || k < 0 || q[4 * k] !== this.gid) return;
        q[4 * k + 1] = this.nGr; q[4 * k + 2] = this.dem; q[4 * k + 3] = this.wants;
      }
      kill() {
        this.dropAll();
        const sx = this.sx;
        this.wants = 0;
        this.pub();
        if (sx !== null && sx.granLast === this.v) sx.granStarve = 0;
        this.on = 0; this.gate = 0; this.fresh = 0; this.pend = 0; this.jump = 0;
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
        if (this.gs !== null) { this.gs.fill(0); this.ss.fill(0); }
        if (this.ws !== null) { this.ws.reset(); this.wsR.reset(); this.wg.reset(); }
      }
      active() { return this.on === 1; }
      grains() { return this.nGr; }
    }
    // clamped 4-point Hermite of d (last index nm) at level coordinate q
    function hq(d, nm, q) {
      if (!(q > 0)) q = 0; else if (q > nm) q = nm;
      const i = q | 0, f = q - i, xm = d[i > 0 ? i - 1 : 0], x0 = d[i], x1 = d[i < nm ? i + 1 : nm], x2 = d[i + 2 <= nm ? i + 2 : nm];
      return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
    }
    // grain hot loops (mono / stereo): SL/SR[ob + s] += g·Wg·H(q), q += dq, window index x += dx; reads in range
    // the fused hot reads of one grain (the fast path of render): q, dq, x, dx, wa, gL, gR in GHP[0 … 6] — a double passed
    // to a call that is not inlined is boxed (M4: the per-grain call was most of a Granular patch's allocation, V8)
    const GHP = new Float64Array(8);
    function grainHot(d, WT, wb, WN, ob, s0, s1) {
      let q = GHP[0], x = GHP[2];
      const dq = GHP[1], dx = GHP[3], wa = GHP[4], gL = GHP[5], gR = GHP[6];
      const a0 = 1 - wa, WN1 = WN - 1;
      for (let s = s0; s < s1; s++) {
        const ji = x < WN ? x | 0 : WN1, wf = x - ji, w0 = WT[wb + ji];
        const i = q | 0, f = q - i, xm = d[i - 1], x0 = d[i], x1 = d[i + 1], x2 = d[i + 2];
        const y = (a0 + wa * (w0 + (WT[wb + ji + 1] - w0) * wf)) *
          ((((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0);
        SL[ob + s] += gL * y; SR[ob + s] += gR * y;
        q += dq; x += dx;
      }
    }
    function grainHot2(dL, dR, WT, wb, WN, ob, s0, s1) {
      let q = GHP[0], x = GHP[2];
      const dq = GHP[1], dx = GHP[3], wa = GHP[4], gL = GHP[5], gR = GHP[6];
      const a0 = 1 - wa, WN1 = WN - 1;
      for (let s = s0; s < s1; s++) {
        const ji = x < WN ? x | 0 : WN1, wf = x - ji, w0 = WT[wb + ji], wv = a0 + wa * (w0 + (WT[wb + ji + 1] - w0) * wf);
        const i = q | 0, f = q - i;
        let xm = dL[i - 1], x0 = dL[i], x1 = dL[i + 1], x2 = dL[i + 2];
        SL[ob + s] += gL * wv * ((((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0);
        xm = dR[i - 1]; x0 = dR[i]; x1 = dR[i + 1]; x2 = dR[i + 2];
        SR[ob + s] += gR * wv * ((((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0);
        q += dq; x += dx;
      }
    }

    globalThis.SxGran = Object.freeze({ VER, MAXCH, MAXUNI, MAXGR, GST, NSL, NLADG, K, GranOsc });
  } catch (err) {
    globalThis.SxGran = null;                                  // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-gran: load failed', err);
  }
})();
