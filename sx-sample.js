/*
 * sx-sample.js — Sample and Multisample oscillators (classic script, no imports/exports; owner D4).
 * Contract: SPEC-serum2 §11.8 (the common oscillator contract), §6.7 (Sample), §6.8 (Multisample), §6.6.10 (phase- and
 * output-domain warps on sample-based oscillators), §6.7.6 (unison START/SPAN), §4.1 (the CP v2 fields read here), §4.5
 * (asset entries), §14.2 (≤ 64 KB per oscillator per voice), §0.3/§0.4 (script shape, lazy references, hot-path rules).
 *
 * Script #5 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Publishes the frozen `globalThis.SxSample`; can be evaluated again in the same scope; a
 * failure inside leaves SxSample = null without throwing (then Sample and Multisample oscillators are silent, §0.3).
 * Lazy references (resolved in `apply`, cached in fields, never read at load time or per sample):
 *   SxBase  OTYPE, DIDX2 (voice-vector indices of the oscillator's destinations), getAsset / epoch (playback entries).
 *           Missing ⇒ every oscillator stays silent (one console.warn per scope).
 *   SxWarp  Slots, chunk, incBlock, phaseBlock, outBlock, META (the two warp slots, §6.6.1 block structure). §6.6.1 and
 *           §11.7 name SxSample as a caller of the block kernels, so the oscillator reads SxWarp although §0.2 lists only
 *           SxBase for D4 (flagged in the M2 report). Missing ⇒ both warp slots act as Off (§0.3 sx-warp row), one
 *           console.warn per scope; the oscillator still plays.
 *
 * API (§11.8; [+] = beyond the §11.8 list):
 *   VER 1 · MAXCH 32 (OL/OR/RAW stride) · MAXUNI 16 · MAXLAYER 8 (§6.8 layers per note) · NSL 258 (CP.sSlPos stride)
 *   [+] K   frozen offsets of the oscillator's O2 destination block (§3.11.2, `k.w1` … `k.bus2`; vi = vi(k.w1) + K.NAME)
 *   class SampleOsc(voice, o)   (Sample, OTYPE 2)        class MultiOsc(voice, o)   (Multisample, OTYPE 1)
 *     apply(cp, o, qr) → boolean   copies the CP v2 fields of oscillator o (allocation allowed). Returns false — and the
 *                                  oscillator is silent — when the CP shapes are invalid (one console.warn per scope),
 *                                  when SxBase is missing, or for o outside 0–2; true otherwise (also when the CP selects
 *                                  another type for o: the instance then idles, `sel` = 0). The per-voice state (and the
 *                                  two SxWarp.Slots) is allocated on the first apply that selects the class's type and
 *                                  reused afterwards. `qr` = Float64Array(5) caps or null for CP.qr (unison caps are the
 *                                  voice's: ctx.N)
 *     noteOn(ctx, fresh, legato)   reads the note-on values (ctx.eff: k.sstart, k.slice, k.ustart, k.uspan, k.mrand,
 *                                  k.timbre, k.mvel), the played key and velocity (below) and draws from the voice's r2
 *                                  stream (voice.rnd2(), §6.2); starts the playheads (deferred to the first render that
 *                                  finds the entry when it is missing at note-on). A legato note on a sounding oscillator
 *                                  keeps everything running. `fresh` (voice was idle) also clears the warp states
 *     noteOff()                    gate off (Exit Loop on Release; Multisample sustain loops and envelope release)
 *     render(ctx, OL, OR, RAW)     writes ctx.CH samples into OL/OR (Float64Array(32), overwritten, not added): Σ over
 *                                  unison voices of the warped read × the ramped unison gains (gl += dgl, then
 *                                  OL[s] += gl·y — the Phase-1 ramp); when RAW (Float64Array(16·32)) is not null, ctx.N
 *                                  unison rows of the mono raw output (post warps, pre level/pan) at [i·32 + s] (rows
 *                                  of ended or missing unison voices are 0). Resolves the entries when the asset epoch
 *                                  changed (missing ⇒ silence, audible within one chunk after it arrives, §4.5; a
 *                                  replaced entry restarts the note from its note-on values)
 *     kill()                       immediate stop, state cleared
 *     active() → bool              false before noteOn, after kill, once a One-shot (every unison voice) ended, a Normal
 *                                  slice key fell outside the slices, or (Multisample) every layer ended
 *     grains() → 0
 *     fields read by the voice/snapshot (read-only): sel, ok, [+] e (the resolved entry or null), [+] mPos, mS, mLS, mLE
 *     (playhead of unison voice 0, S, LS, LE as fractions of the entry length, processed coordinates, §6.20), [+] zone
 *     (MultiOsc: zone index of the first layer, −1 none, snapshot `zone`), [+] nL (MultiOsc: layers playing)
 *
 * OscCtx (§11.8) fields read: N, CH, fs, bpm, eff, f (Hz per unison voice, pre F stage), gl/gr/dgl/dgr (gain ramps),
 *   keyRef, gate (unused: the gate is noteOn/noteOff), mode1/mode2 (eff WARPS2 index after the voice's availability
 *   resolution; a mode not available on the type is treated as Off), w1/w2 (per unison voice), var1/var2, fm1/fm2,
 *   mod1/mod2 + modStride1/modStride2 (SxWarp layout), sx (remap table `sx.remap`, Float32Array(3·2049) CT remap;
 *   identity when absent; MultiOsc: round-robin counters `sx.msRR`). [+] Optional fields (D1 SHOULD fill them; fallbacks
 *   in brackets): `key` = the channel's played integer key n + dk_X of §6.2 (slice / zone choice) [voice.note, else
 *   round(keyRef)]; `vel` = vel01 [voice.vel, else 1]. ctx.wbuf is not used (module scratch, MAXCH long, instead).
 *   `rootShift` is not used (the S2 C3 rule is in ctx.f/keyRef: tracking off ⇒ note' = 60, §6.3.1).
 *
 * CP v2 fields read (§4.1; checked by type and length in apply): ver 2, base (429), oType, bendTrack (3), fmType (6),
 *   smp / multi (Array(3) of strings), qr (5); SampleOsc: sLoop, sRel, sLink, sExit, sScanLock, sLenOn, sSlMode, sSlEnd,
 *   sSlOne, sSlRoot, sNorm, sRev (Uint8Array(3)), sSlN (Uint16Array(3)), sSlPos (Float64Array(3·258)), sScanR (3),
 *   lenLad (15); MultiOsc: msOver, msDlyBpm (Uint8Array(3)), envLad (16). Optional: `a4` (finite > 0, else 440).
 *
 * Implementation choices (IMPL where §6.7/§6.8 leave room; all normative for this file's tests):
 *  - Playhead model (Sample, and Granular stream playheads): an absolute position P (level-0 frames, processed =
 *    post-`sRev` coordinates) and a phase APPROACH → LOOP (→ EXIT after a release with Exit Loop) → END. APPROACH runs
 *    from S toward E (region coordinate r = (P − S)·sign(E − S)). The travel direction is the scan direction sd =
 *    sign(σ) (Thru-Zero FM may run the playhead backwards for a while, §6.6.4, but never decides where it is heading):
 *    a One-shot (or exiting) playhead ends only at the bound it travels toward (E for sd > 0, S for sd < 0) and holds
 *    at the other one; looping modes enter LOOP at rIn — travelling forwards at LE (Tailed: E); backwards at the near
 *    loop end (Fwd, Fwd/Rwd: it runs on through the loop), at the far end LS for Rev (it turns there: the mirror of the
 *    forward case) and at S for Tailed. In LOOP the loop coordinate λ = distance from LS toward LE advances by lt·dr
 *    (Fwd lt = +1, Rev −1, Fwd/Rwd ±1 bouncing) and wraps (Fwd/Rev/Tailed) or reflects at both ends (Fwd/Rwd; a
 *    playhead landing exactly on LE stays there for that sample, then turns). Markers are eff values per chunk; a
 *    playhead outside the moved loop zone is wrapped back in.
 *  - A negative scan factor σ at note-on starts the playheads at the region end E (the region played backwards); a sign
 *    change during the note reverses the travel. A degenerate loop (|LE − LS| < 1e-9 frames) holds at LS. Tailed with
 *    σ < 0 at note-on plays E → S, then loops the tail [S, M] backwards (the mirror of S → E, then [M, E]).
 *  - Loop crossfade (§6.7.4): the fade zone is the one of the wrap the playhead is heading for (base direction lt·sd,
 *    so FM jitter does not switch it); it is applied while approaching the first wrap as well, where the approach itself
 *    wraps (forwards into Fwd / forward Tailed, backwards into a backward Tailed). The secondary read uses the
 *    quarter-sine table (equal power). Ping-pong and One-shot have none. Exit Loop on Release never fades into the loop
 *    start; a fade it leaves mid-zone (released inside a fade zone or before the first wrap) is ramped out over 5 ms,
 *    its partner read moving on with the playhead (no step at the release or at LE).
 *  - Unison START draws (u_i from r2) are taken only when the note-on k.ustart is not 0 (neutral rule §0.7).
 *  - Slices (§6.7.5): Normal mode ρ = f / (a4·2^((keyRef − 69)/12)) (pitch knobs only); Play Single Slice
 *    ρ = f / (a4·2^((60 − 69)/12)); Length to BPM excludes the key term the same way and takes precedence. `k.slice`
 *    = round(255·n) (int law). With Play Slice to End the slice runs to the eff Sample End.
 *  - `k.pos` (Position) is added to the read position (before the intra-period warps), clamped to the entry.
 *  - Warps (§6.6.1, §6.6.4, §6.6.10; SxWarp's caller contract): two Slots objects (L, and R for the O stage of stereo
 *    entries, so stateful output warps keep one state per channel), clocked by SxWarp.chunk every chunk with nu = N (a
 *    pair already clocked Off is not clocked again until a mode returns: a repeated Off chunk() changes nothing). Stage
 *    order per unison voice: F (incBlock on the playhead increments) → playhead → P stage on the read positions, slot 1
 *    then slot 2: PD 39–44 offsets the positions by I·m·T₀ frames (pdBlock, unwrapped — offsets of several periods are
 *    kept), the other P modes map the intra-period phase φ = frac(p/T₀) (phaseBlock; p' = p₀ + W(φ)·T₀) → read → Sync
 *    window → O stages (Flip reads the unwarped φ). Warped positions "wrap or clamp as the playhead itself does"
 *    (§6.6.10) — every warped read: the P stage, each PD (Self) read and the Odd/Even second read (bnd): where the
 *    playhead loops, or approaches the loop and the read lies past rIn, they wrap into [LS, LE) (Fwd/Rev/Tailed) or
 *    reflect (Fwd/Rwd); elsewhere they are clamped into the region [S, E), 2^ℓ level-0 frames in from E (ℓ = the read
 *    level: no clamped read interpolates across E). The Position offset is applied on top; Multisample: the zone loop
 *    while the layer loops, else the zone sample; Granular: sx-gran.js. The loop-fade partner reads are not bounded
 *    (they lie outside the loop by design). PD (Self) (45) is fed back per sample in the read: p_r = p + I·y₁·T₀
 *    (I = Σ slots.pdI of the slots in mode 45), y₁ = the previous raw read (stereo: mono average; before window, O
 *    stages and gains), kept in `slots.y1[i]` (Multisample: per layer and unison voice in the playhead state), cleared at
 *    a fresh note-on; while PD (Self) is off y₁ follows the chunk's last raw read. The Odd/Even second read (p' + T₀/2)
 *    goes through BOTH slots' outBlock whenever either slot of the voice is Odd/Even. The level choice uses |dp| × both
 *    slots' speeds. Multisample: the P stage and Sync window per layer (each layer's own T₀), the O stage on the layer
 *    sum (Flip with the first layer's φ).
 *  - Multisample (§6.8): ρ = f / (440·2^((root + tune/100 − 69)/12)) (the §6.3.3 a4 rule applied to §6.8's formula);
 *    layer envelopes are linear DAHDSR evaluated per chunk and ramped per sample; zone loops have no crossfade; a zone
 *    sample entry that is missing keeps its layer pending (it starts when the entry arrives). Thru-Zero FM holds a
 *    layer at frame 0 instead of ending it. A note restarts from its note-on values when the resolved multisample entry
 *    differs from the one its zones were chosen from (another id selected while it holds, a replaced entry); a zone
 *    sample arriving later only resolves its layer. Round-robin counters are per processor and oscillator: `sx.msRR`
 *    (Uint32Array(3·512), created by apply through voice.proc.sx; without it an instance-local copy is used), indexed by
 *    the first zone of the group in entry order — DEVIATION from §6.8/§12.2 (`proc.rr = Uint16Array(512)` per processor,
 *    owner I, not implemented): per oscillator, two oscillators on one multisample do not advance one counter twice
 *    per note; D1 resets and warm-up-restores it. Ratified (RULINGS2: documented IMPL choices stand).
 *
 * Hot paths (noteOn, noteOff, render, kill, active, grains) never allocate; patch values are copied in apply into
 * numeric fields and the instance's own typed arrays, never read from the CP object while rendering.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const MAXCH = 32, MAXUNI = 16, MAXLAYER = 8, NSL = 258, MAXZ = 512;
    const T_MULTI = 1, T_SAMPLE = 2;                          // OTYPE codes (= serum-core OSC_TYPES), checked against SxBase
    const NST = 8;                                            // doubles of playhead state per unison voice (per layer)
    const NLAD = 15, NENVLAD = 16;
    const floor = Math.floor, ceil = Math.ceil, round = Math.round, pow = Math.pow, sin = Math.sin, cos = Math.cos, PI = Math.PI,
      SQRT2 = Math.SQRT2;

    // O2 destination block of one oscillator, in §3.11.2 builder order (vi = vi(k.w1) + offset)
    const O2 = ['w1', 'w2', 'warp2', 'wvar1', 'wvar2', 'uniwarp2', 'ratio', 'hz', 'sstart', 'send', 'lstart', 'lend', 'xfade',
      'scan', 'scanrev', 'pos', 'slice', 'gy', 'dens', 'glen', 'wamt', 'wskew', 'roff', 'rdir', 'rpitch', 'rlen', 'rpan', 'rlvl',
      'rwamt', 'rwskew', 'rwarp', 'rwarp2', 'grev', 'flo', 'fhi', 'cut', 'smix', 'mdly', 'matt', 'mhold', 'mdec', 'msus', 'mrel',
      'mvel', 'mrand', 'timbre', 'ustart', 'uspan', 'fbal', 'bus1', 'bus2'];
    const k = {};
    for (let i = 0; i < O2.length; i++) k[O2[i].toUpperCase()] = i;
    const K = Object.freeze(k);
    const OSC_LETTER = ['A', 'B', 'C'];

    // playhead phases, loop modes (LOOP_MODES §3.9), state layout per unison voice
    const PH_APP = 0, PH_LOOP = 1, PH_EXIT = 2, PH_END = 3, PH_PEND = 4;
    const LM_ONE = 0, LM_FWD = 1, LM_REV = 2, LM_PP = 3, LM_TAIL = 4;
    const S_P = 0, S_PH = 1, S_LT = 2, S_LV = 3, S_U = 4, S_Y1 = 5;   // S_Y1: PD (Self) y₁ of a Multisample layer
    const S_XU = 6, S_XD = 7;      // Sample: loop-fade weight u of the last read, its partner offset (ramped out on exit)
    const XRAMP = 0.005;           // s: a loop fade abandoned mid-zone (Exit Loop on Release) ramps its partner out
    const DOM_F = 1, DOM_P = 2, DOM_O = 3;                    // SxWarp.DOM codes (checked in sxWarp)
    const M_ODDEVEN = 16, M_PD0 = 39, M_PD1 = 44, M_PDSELF = 45; // WARPS2 indices (§3.4.1; checked against SxWarp.META.ids)

    /* ------------------------------------------------------------ module scratch (one chunk; processors run in turn) */
    const PA = new Float64Array(MAXCH), PB = new Float64Array(MAXCH), PC = new Float64Array(MAXCH), PD = new Float64Array(MAXCH);
    const WA = new Float64Array(MAXCH), WB = new Float64Array(MAXCH), DR = new Float64Array(MAXCH), GF = new Float64Array(MAXCH);
    const PHI = new Float64Array(MAXCH), PHW = new Float64Array(MAXCH), PBA = new Float64Array(MAXCH), WIN = new Float64Array(MAXCH);
    const XL = new Float64Array(MAXCH), XR = new Float64Array(MAXCH), X2L = new Float64Array(MAXCH), X2R = new Float64Array(MAXCH);
    const XT = new Float64Array(MAXCH), XO = new Float64Array(MAXCH), YL = new Float64Array(MAXCH), YR = new Float64Array(MAXCH);
    const Y2L = new Float64Array(MAXCH), Y2R = new Float64Array(MAXCH);
    const PHX = new Float64Array(MAXCH), PBX = new Float64Array(MAXCH), PDO = new Float64Array(MAXCH);
    const PHS = new Uint8Array(MAXCH);                       // playhead phase of read s: 0 approach (a loop mode), 1 loop, 2 other
    // read bounds of the oscillator being rendered (§6.6.10; set by setBound, read by bnd): [kind (0 none, 1 Sample, 2
    // Multisample layer), LS, ld, LL, ping-pong, S, sg, region lo, region hi, approach wrap threshold rW, its direction
    // (+1: wrap reads past rW, −1: before rW), Position offset, zone ls, zone le, zone last frame]
    const BD = new Float64Array(15);
    const QS = new Float64Array(1026);                        // quarter sine: QS[j] = sin(π/2 · j/1024) (equal-power fades)
    for (let j = 0; j <= 1024; j++) QS[j] = sin(0.5 * PI * j / 1024);
    QS[1025] = 1;
    const IDREMAP = new Float32Array(3 * 2049);               // identity remap tables (CT remap absent)
    for (let o = 0; o < 3; o++) for (let j = 0; j <= 2048; j++) IDREMAP[o * 2049 + j] = j / 2048;

    /* ------------------------------------------------------------ one-time warnings (per scope) */
    let warnedBase = false, warnedCP = false, warnedWarp = false;
    function warn(what) {
      if (typeof console !== 'undefined') console.warn('sx-sample: ' + what);
    }
    function sxBase() {
      const B = globalThis.SxBase;
      if (B && typeof B === 'object' && typeof B.getAsset === 'function' && B.DIDX2 && B.OTYPE) return B;
      if (!warnedBase) { warnedBase = true; warn('SxBase is missing: Sample and Multisample oscillators are silent'); }
      return null;
    }
    function badCP(why) {
      if (!warnedCP) { warnedCP = true; warn('CP not understood (' + why + '): Sample and Multisample oscillators are silent'); }
      return false;
    }
    // SxWarp (lazy, §0.3): null ⇒ warp slots act as Off
    function sxWarp() {
      const W = globalThis.SxWarp;
      if (W && typeof W === 'object' && typeof W.Slots === 'function' && typeof W.chunk === 'function' &&
        typeof W.incBlock === 'function' && typeof W.phaseBlock === 'function' && typeof W.outBlock === 'function' &&
        typeof W.pdBlock === 'function' && W.META && W.META.dom && W.META.avail && W.META.ids &&
        W.META.ids[M_PD0] === 'pd_o1' && W.META.ids[M_PD1] === 'pd_f2' && W.META.ids[M_PDSELF] === 'pd_self' &&
        W.META.ids[M_ODDEVEN] === 'oddeven' && W.DOM && W.DOM.F === DOM_F && W.DOM.P === DOM_P && W.DOM.O === DOM_O) return W;
      if (!warnedWarp) { warnedWarp = true; warn('SxWarp is missing: warp slots of Sample and Multisample oscillators act as Off'); }
      return null;
    }

    /* ------------------------------------------------------------ CP v2 shape validation (§4.1) */
    // typed arrays from another realm: compare the tag, never instanceof (Phase-1 §0.2)
    const tag = (a) => (a !== null && typeof a === 'object' ? a[Symbol.toStringTag] || '' : '');
    const COMMON = [['base', 'Float64Array', 429], ['oType', 'Uint8Array', 3], ['bendTrack', 'Uint8Array', 3],
      ['fmType', 'Uint8Array', 6], ['qr', 'Float64Array', 5]];
    const SHAPES_SAMPLE = COMMON.concat([['sLoop', 'Uint8Array', 3], ['sRel', 'Uint8Array', 3], ['sLink', 'Uint8Array', 3],
      ['sExit', 'Uint8Array', 3], ['sScanLock', 'Uint8Array', 3], ['sLenOn', 'Uint8Array', 3], ['sSlMode', 'Uint8Array', 3],
      ['sSlEnd', 'Uint8Array', 3], ['sSlOne', 'Uint8Array', 3], ['sSlRoot', 'Uint8Array', 3], ['sNorm', 'Uint8Array', 3],
      ['sRev', 'Uint8Array', 3], ['sSlN', 'Uint16Array', 3], ['sSlPos', 'Float64Array', 3 * NSL],
      ['sScanR', 'Float64Array', 3], ['lenLad', 'Float64Array', NLAD]]);
    const SHAPES_MULTI = COMMON.concat([['msOver', 'Uint8Array', 3], ['msDlyBpm', 'Uint8Array', 3],
      ['envLad', 'Float64Array', NENVLAD]]);
    function ids3(a) {
      if (!Array.isArray(a) || a.length !== 3) return false;
      for (let i = 0; i < 3; i++) if (typeof a[i] !== 'string') return false;
      return true;
    }
    // '' when cp carries every field of `shapes` (and the id list `idsKey`) with the right type and length
    function checkCP(cp, shapes, idsKey) {
      if (cp === null || typeof cp !== 'object') return 'no CP';
      if (cp.ver !== 2) return 'ver ' + cp.ver;
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i], a = cp[s[0]];
        if (tag(a) !== s[1] || a.length !== s[2]) return s[0] + ' must be ' + s[1] + '(' + s[2] + ')';
      }
      if (!ids3(cp[idsKey])) return idsKey + ' must be Array(3) of strings';
      return '';
    }
    function qrOk(q) {
      if (q === null || typeof q !== 'object' || q.length !== 5) return false;
      for (let i = 0; i < 5; i++) if (typeof q[i] !== 'number' || q[i] - q[i] !== 0) return false;
      return true;
    }
    // common apply prologue: '' or the reason the CP cannot be used; sets osc.B / osc.k0 / osc.kLen on success
    function prologue(osc, cp, o, qr, shapes, idsKey) {
      const why = checkCP(cp, shapes, idsKey);
      if (why) return why;
      if (!qrOk(qr != null ? qr : cp.qr)) return 'qr must hold 5 finite numbers';
      const B = sxBase();
      if (B === null) return '-';
      if (B.OTYPE.MULTI !== T_MULTI || B.OTYPE.SAMPLE !== T_SAMPLE) return 'SxBase OTYPE codes differ';
      const D = B.DIDX2, P = OSC_LETTER[o], k0 = D[P + '_W1'], kl = D[P + '_LENRATE'];
      if (!(k0 >= 0) || D[P + '_BUS2'] !== k0 + K.BUS2 || !(kl >= 0)) return 'SxBase destination indices differ';
      osc.B = B; osc.k0 = k0; osc.kLen = kl;
      osc.a4 = typeof cp.a4 === 'number' && cp.a4 > 0 && cp.a4 < Infinity ? cp.a4 : 440;
      return '';
    }
    function zero(ctx, OL, OR, RAW) {
      const CH = ctx.CH;
      for (let s = 0; s < CH; s++) { OL[s] = 0; OR[s] = 0; }
      if (RAW !== null) {
        const N = ctx.N;
        for (let i = 0; i < N; i++) { const b = i * MAXCH; for (let s = 0; s < CH; s++) RAW[b + s] = 0; }
      }
    }

    /* ------------------------------------------------------------ small helpers (hot paths: no allocation) */
    function panG(p, right) {                                 // Phase-1 equal-power pan law (centre = 1 on both sides)
      if (p === 0) return 1;
      const a = (p + 1) * PI * 0.25;
      return SQRT2 * (right ? sin(a) : cos(a));
    }
    const exp2 = (x) => pow(2, x);
    const p5 = (x) => 32 * x * x * x * x * x;                 // pow5 law 0–32 s (k.mdly … k.mrel)
    // the voice's second PRNG stream (§6.2): voice.rnd2() when the voice has it, else a local xorshift32 stream seeded
    // from voice.r2 at note-on (tests and tools without a SerumVoice)
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
      const k = ctx.key;
      if (typeof k === 'number' && k === k) return round(k);
      if (v !== null && typeof v === 'object' && typeof v.note === 'number' && v.note === v.note) return round(v.note);
      const r = ctx.keyRef;
      return typeof r === 'number' && r === r ? round(r) : 60;
    }
    function velOf(ctx, v) {
      let x = ctx.vel;
      if (!(typeof x === 'number' && x === x)) x = v !== null && typeof v === 'object' && typeof v.vel === 'number' ? v.vel : 1;
      return x > 0 ? (x < 1 ? x : 1) : 0;
    }
    function keyRefOf(ctx, key) {
      const r = ctx.keyRef;
      return typeof r === 'number' && r === r ? r : key;
    }
    // level choice (§6.7.7): the smallest level ℓ with |dp|/2^ℓ ≤ 1, ≤ the entry's last level
    function lvSel(nLv, adp) {
      let l = 0;
      while (adp > 1 && l < nLv - 1) { adp *= 0.5; l++; }
      return l;
    }
    // 4-point Hermite (Phase-1 formula) reads of d (length n) at q = A + Bm·P[s], clamped to the entry, for s < cnt
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
    // one channel of level lv at positions P1 (primary, weight WA) and P2 (secondary, weight WB; null = none)
    function readW(e, lv, ch, rev, P1, P2, out, cnt) {
      const lev = e.levels[lv], d = ch === 0 || lev.R === null || lev.R === undefined ? lev.L : lev.R, nl = lev.len;
      const sc = 1 / (1 << lv), A = rev ? (e.len - 1) * sc : 0, Bm = rev ? -sc : sc;
      readH(d, nl, P1, A, Bm, out, cnt);
      if (P2 !== null) {
        readH(d, nl, P2, A, Bm, XT, cnt);
        for (let s = 0; s < cnt; s++) out[s] = WA[s] * out[s] + WB[s] * XT[s];
      } else for (let s = 0; s < cnt; s++) out[s] *= WA[s];
    }
    // readW with a one-chunk crossfade from the old level lvo (−1: none) to lv (§6.7.7)
    function readLv(e, lv, lvo, ch, rev, P1, P2, out, cnt) {
      readW(e, lv, ch, rev, P1, P2, out, cnt);
      if (lvo >= 0) {
        readW(e, lvo, ch, rev, P1, P2, XO, cnt);
        const ic = 1 / cnt;
        for (let s = 0; s < cnt; s++) { const o = XO[s]; out[s] = o + (out[s] - o) * (s + 1) * ic; }
      }
    }
    // equal-power fade weights at u ∈ [0, 1] into WA[s] (cos) / WB[s] (sin)
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
    // §6.6.10 "reads beyond the region/loop bounds wrap or clamp as the playhead itself does": read position p of a
    // read whose playhead phase is ph (PHS), under the bounds in BD. Sample (kind 1, playhead coordinates = p minus the
    // Position offset): where the playhead loops — or approaches the loop and the read lies past the point where the
    // approach enters it — p wraps into [LS, LE) (Fwd/Rev/Tailed) or reflects (Fwd/Rwd); elsewhere it is clamped into
    // the region. Multisample layer (kind 2): wraps into the zone loop while the layer loops, else stays in the sample.
    function bnd(p, ph) {
      const kind = BD[0];
      if (kind === 1) {
        const po = BD[11];
        let q = p - po;
        const r = (q - BD[5]) * BD[6];
        if (ph === 1 || (ph === 0 && (BD[10] > 0 ? r > BD[9] : r < BD[9]))) {
          const LS = BD[1], ld = BD[2], LL = BD[3];
          let lam = (q - LS) * ld;
          if (lam < 0 || lam >= LL) {
            if (BD[4] === 1) { lam -= 2 * LL * floor(lam / (2 * LL)); if (lam > LL) lam = 2 * LL - lam; } else lam -= LL * floor(lam / LL);
            q = LS + ld * lam;
          }
        } else q = q < BD[7] ? BD[7] : q > BD[8] ? BD[8] : q;
        return q + po;
      }
      if (kind === 2) {
        if (ph === 1) {
          const zls = BD[12], LL = BD[13] - zls;
          if (p < zls || p >= BD[13]) p -= LL * floor((p - zls) / LL);
        } else p = p < 0 ? 0 : p > BD[14] ? BD[14] : p;
      }
      return p;
    }
    // X[s] = bnd(X[s], PHS[s]) for s < n
    function boundArr(X, n) {
      for (let s = 0; s < n; s++) X[s] = bnd(X[s], PHS[s]);
    }

    /* ------------------------------------------------------------ warp slots (both oscillator classes) */
    // allocation (apply only): the SxWarp Slots of slot pair L and the O-stage copy for R
    function warpInit(osc, type) {
      const W = sxWarp();
      osc.W = W;
      if (W === null) return;
      if (osc.ws === null) {
        osc.ws = new W.Slots(MAXUNI); osc.wsR = new W.Slots(MAXUNI);
      }
      osc.avBit = 1 << type;
    }
    // per chunk (§6.6.1, SxWarp chunk contract): both slots of ws and of the right-channel O-stage copy wsR are clocked
    // every chunk with their real modes, nu = the unison voices in use; returns 1 when a slot is on. A pair already
    // clocked Off (mode 0 on both slots: every per-voice state cleared) is not clocked again until a mode returns — a
    // repeated Off chunk() changes nothing (SxWarp: O(1), em stays 0), so this equals clocking it every chunk.
    function warpChunk(osc, ctx, N) {
      const W = osc.W, ws = osc.ws;
      osc.m0 = 0; osc.m1 = 0; osc.d0 = 0; osc.d1 = 0;
      if (W === null || ws === null) return 0;
      let m0 = ctx.mode1, m1 = ctx.mode2;
      const av = W.META.avail, dom = W.META.dom, bit = osc.avBit;
      m0 = m0 >= 1 && m0 <= 81 && (m0 | 0) === m0 && (av[m0] & bit) !== 0 ? m0 : 0;
      m1 = m1 >= 1 && m1 <= 81 && (m1 | 0) === m1 && (av[m1] & bit) !== 0 ? m1 : 0;
      const fs = ctx.fs, fa = ctx.f, d0 = m0 ? dom[m0] : 0, d1 = m1 ? dom[m1] : 0;
      const r0 = d0 === DOM_O ? m0 : 0, r1 = d1 === DOM_O ? m1 : 0;
      if (m0 !== 0 || m1 !== 0 || osc.wOff === 0) {
        W.chunk(ws, 0, m0, ctx.w1, ctx.var1, ctx.fm1, fa, fs, N);
        W.chunk(ws, 1, m1, ctx.w2, ctx.var2, ctx.fm2, fa, fs, N);
        osc.wOff = m0 === 0 && m1 === 0 ? 1 : 0;
      }
      if (r0 !== 0 || r1 !== 0 || osc.wOffR === 0) {
        W.chunk(osc.wsR, 0, r0, ctx.w1, ctx.var1, ctx.fm1, fa, fs, N);
        W.chunk(osc.wsR, 1, r1, ctx.w2, ctx.var2, ctx.fm2, fa, fs, N);
        osc.wOffR = r0 === 0 && r1 === 0 ? 1 : 0;
      }
      osc.m0 = m0; osc.m1 = m1; osc.d0 = d0; osc.d1 = d1;
      return m0 !== 0 || m1 !== 0 ? 1 : 0;
    }
    // P stage (§6.6.1 step 3, §6.6.4, §6.6.10) of unison voice si of the Slots sl (modulator column mc, −1 = si) on the
    // read positions PA (and the loop-fade partners PB when xf), slot 1 then slot 2: PD 39–44 offsets the positions by
    // I·m·T₀ source frames (SxWarp.pdBlock, unwrapped); the other P modes map the intra-period phase φ = frac(p/T₀) of
    // the root period (p' = p₀ + W(φ)·T₀, phaseBlock; consecutive mappings chain on φ); PD (Self) is left to the read
    // (its index I is returned in PS.sI). Returns 1 when a Sync window was written to WIN.
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
    // one Hermite read of channel ch of entry e at level lv, level-0 position p (processed coordinates, clamped)
    function rdAt(e, lv, ch, rev, p) {
      const lev = e.levels[lv], d = ch === 0 || lev.R === null || lev.R === undefined ? lev.L : lev.R, nm = lev.len - 1;
      const sc = 1 / (1 << lv);
      let q = rev ? (e.len - 1 - p) * sc : p * sc;
      if (!(q > 0)) q = 0; else if (q > nm) q = nm;
      const i = q | 0, f = q - i;
      const xm = d[i > 0 ? i - 1 : 0], x0 = d[i], x1 = d[i < nm ? i + 1 : nm], x2 = d[i + 2 <= nm ? i + 2 : nm];
      return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0;
    }
    // the read of sample s as readLv computes it (level crossfade c from lvo, loop-fade partner pb weighted by WA/WB;
    // pb NaN = none)
    function rdMix(e, lv, lvo, ch, rev, pa, pb, s, c) {
      let x = rdAt(e, lv, ch, rev, pa);
      if (lvo >= 0) { const o = rdAt(e, lvo, ch, rev, pa); x = o + (x - o) * c; }
      if (pb === pb) {
        let y = rdAt(e, lv, ch, rev, pb);
        if (lvo >= 0) { const o = rdAt(e, lvo, ch, rev, pb); y = o + (y - o) * c; }
        return WA[s] * x + WB[s] * y;
      }
      return WA[s] * x;
    }
    // reads with PD (Self) feedback (§6.6.4; SxWarp header): per sample p_r = bnd(p + I·y₁·T₀) (the loop-fade partner
    // is offset likewise and not bounded: it lies outside the loop by design), x = read(p_r) into XL/XR, y₁ ← the raw
    // read (stereo: mono average); the Odd/Even second read at bnd(p_r + T₀/2) into X2L/X2R. Returns the new y₁.
    function readSelf(e, lv, lvo, rev, stereo, P2, I, T0, y1, odd, n) {
      const ic = 1 / n, hT = 0.5 * T0;
      for (let s = 0; s < n; s++) {
        const off = I * y1 * T0, ph = PHS[s], pa = bnd(PA[s] + off, ph), pb = P2 !== null ? P2[s] + off : NaN, c = (s + 1) * ic;
        const l = rdMix(e, lv, lvo, 0, rev, pa, pb, s, c), r = stereo ? rdMix(e, lv, lvo, 1, rev, pa, pb, s, c) : l;
        XL[s] = l; XR[s] = r;
        y1 = stereo ? 0.5 * (l + r) : l;
        if (odd) {
          const qa = bnd(pa + hT, ph), qb = P2 !== null ? pb + hT : NaN;
          X2L[s] = rdMix(e, lv, lvo, 0, rev, qa, qb, s, c);
          X2R[s] = stereo ? rdMix(e, lv, lvo, 1, rev, qa, qb, s, c) : X2L[s];
        }
      }
      return y1;
    }

    /* ------------------------------------------------------------ Sample (§6.7) */
    class SampleOsc {
      constructor(voice, o) {
        this.v = voice; this.o = o >= 0 && o <= 2 ? o | 0 : 0;
        this.B = null; this.k0 = -1; this.kLen = -1;            // SxBase and the vi of k.w1 / k.lenrate (apply)
        this.ok = 0; this.sel = 0;
        this.id = ''; this.e = null; this.ep = -1;               // entry id, resolved entry, epoch it was resolved at
        // options (§2.2.3, CP §4.1)
        this.loop = 0; this.rel = 0; this.link = 0; this.exit = 0; this.scanLock = 0; this.lenOn = 0;
        this.slMode = 0; this.slEnd = 0; this.slOne = 0; this.slRoot = 36; this.slN = 0; this.norm = 0; this.rev = 0;
        this.scanR = 2; this.bendTrack = 1; this.fm1 = 0; this.fm2 = 0; this.a4 = 440;
        this.sstB = 0; this.lstB = 0; this.lenB = 1;            // CP base n of k.sstart / k.lstart / k.lend (Relative, Link)
        // warps (SxWarp, apply)
        this.W = null; this.ws = null; this.wsR = null; this.avBit = 1 << T_SAMPLE; this.wOff = 0; this.wOffR = 0;
        this.m0 = 0; this.m1 = 0; this.d0 = 0; this.d1 = 0;
        // per-voice state: allocated on the first apply that selects Sample (no audio buffers before, §11.8)
        this.st = null; this.sl = null; this.lad = null;
        // note state
        this.on = 0; this.gate = 0; this.fresh = 0; this.N = 0; this.pend = 0;
        this.key = 60; this.nS = 0; this.nSl = 0; this.nUs = 0; this.nUsp = 0; this.hasR2 = 0; this.r2s = 1;
        this.sliced = 0; this.slA = 0; this.slB = 1;
        // region of the current chunk (§6.7.1)
        this.L = 0; this.S = 0; this.E = 0; this.sg = 1; this.RL = 0; this.LS = 0; this.LE = 0; this.ld = 1; this.LL = 1;
        this.LxF = 0; this.LxB = 0; this.lmode = 0;
        this.tb = 1; this.tb = 0;                                // Tailed note started backwards: the tail is [S, M]
                                                                 // (stored twice: never a constant to the engine, so a
                                                                 // backward Tailed note does not deoptimise render)
        this.xrd = 0;                                            // loop-fade ramp-out step per sample (render)
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
      }
      apply(cp, o, qr) {
        if (!(o >= 0 && o <= 2)) { this.ok = 0; this.sel = 0; return badCP('oscillator index ' + o); }
        o |= 0;
        this.o = o;
        const why = prologue(this, cp, o, qr, SHAPES_SAMPLE, 'smp');
        if (why) { this.ok = 0; this.sel = 0; return why === '-' ? false : badCP(why); }
        this.ok = 1;
        this.sel = cp.oType[o] === T_SAMPLE ? 1 : 0;
        if (this.sel === 1 && this.st === null) {
          this.st = new Float64Array(MAXUNI * NST); this.sl = new Float64Array(NSL); this.lad = new Float64Array(NLAD);
        }
        if (this.sel === 1) warpInit(this, T_SAMPLE);
        this.loop = cp.sLoop[o]; this.rel = cp.sRel[o]; this.link = cp.sLink[o]; this.exit = cp.sExit[o];
        this.scanLock = cp.sScanLock[o]; this.lenOn = cp.sLenOn[o]; this.slMode = cp.sSlMode[o]; this.slEnd = cp.sSlEnd[o];
        this.slOne = cp.sSlOne[o]; this.slRoot = cp.sSlRoot[o]; this.slN = cp.sSlN[o]; this.norm = cp.sNorm[o];
        this.rev = cp.sRev[o]; this.scanR = +cp.sScanR[o]; this.bendTrack = cp.bendTrack[o];
        this.fm1 = cp.fmType[o * 2]; this.fm2 = cp.fmType[o * 2 + 1];
        const bs = cp.base, k0 = this.k0;
        this.sstB = bs[k0 + K.SSTART]; this.lstB = bs[k0 + K.LSTART]; this.lenB = bs[k0 + K.LEND];
        if (this.st !== null) {
          const sp = cp.sSlPos, b = o * NSL, sl = this.sl, lad = this.lad, ll = cp.lenLad;
          for (let j = 0; j < NSL; j++) sl[j] = sp[b + j];
          for (let j = 0; j < NLAD; j++) lad[j] = ll[j];
        }
        const id = cp.smp[o];
        if (id !== this.id) { this.id = id; this.e = null; this.ep = -1; }
        return true;
      }
      noteOn(ctx, fresh, legato) {
        this.gate = 1;
        if (this.ok === 0 || this.sel === 0) { this.on = 0; return; }
        this.fresh = fresh ? 1 : 0;
        if (legato && this.on === 1) return;                    // a legato note keeps the running playheads
        let N = ctx.N | 0;
        N = N < 1 ? 1 : N > MAXUNI ? MAXUNI : N;
        this.on = 1; this.N = N;
        const eff = ctx.eff, k0 = this.k0, st = this.st;
        this.nS = eff[k0 + K.SSTART]; this.nSl = eff[k0 + K.SLICE];
        this.nUs = eff[k0 + K.USTART]; this.nUsp = eff[k0 + K.USPAN];
        this.key = keyOf(ctx, this.v);
        seedR2(this);
        for (let i = 0; i < MAXUNI; i++) { const b = i * NST; st[b + S_U] = i < N && this.nUs !== 0 ? rnd(this) : 0; st[b + S_PH] = PH_PEND; }
        if (fresh && this.ws !== null) { this.ws.reset(); this.wsR.reset(); }
        if (this.B.epoch !== this.ep) this.resolve();
        this.pend = 1;
        if (this.e !== null) this.start(ctx);
      }
      noteOff() { this.gate = 0; }
      resolve() {                                                 // the playback entry of the current id (§4.5)
        const B = this.B, e = this.id !== '' ? B.getAsset(this.id) : null;
        this.e = e !== null && e !== undefined && e.kind === 'smp' ? e : null;
        this.ep = B.epoch;
      }
      // scan factor σ (§6.7.2), signed; Length to BPM sets the region duration
      sigma(ctx) {
        const eff = ctx.eff, k0 = this.k0, sr = eff[k0 + K.SCANREV] >= 0.5 ? -1 : 1, bpm = ctx.bpm > 0 ? ctx.bpm : 120;
        if (this.lenOn === 1) {
          let j = round(14 * eff[this.kLen]);
          j = j > 0 ? (j < 14 ? j : 14) : 0;
          const T = this.lad[j] * 60 / bpm;
          return T > 0 ? sr * (this.RL / this.e.rate) / T : 0;
        }
        let s = sr * (2 * eff[k0 + K.SCAN] - 1) * this.scanR;
        if (this.scanLock === 1) s *= bpm / 120;
        return s;
      }
      // region and loop of this chunk (§6.7.1, §6.7.4) from the eff values; S is the note-on start
      region(eff) {
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
          if (mode === LM_FWD || mode === LM_REV) {
            const lx = xf * 0.5 * LL, half = 0.5 * LL, rF = ld > 0 ? LS : L - 1 - LS, rB = ld > 0 ? L - 1 - LE : LE;
            let a = lx < rF ? lx : rF; a = a < half ? a : half;
            let b = lx < rB ? lx : rB; b = b < half ? b : half;
            this.LxF = a > 0 ? a : 0; this.LxB = b > 0 ? b : 0;
          } else { this.LxF = 0; this.LxB = 0; }
        }
        const iL = L > 0 ? 1 / L : 0;
        this.mS = S * iL; this.mLS = this.LS * iL; this.mLE = this.LE * iL;
      }
      // the note's playheads from the note-on values (§6.7.1, §6.7.5, §6.7.6); the entry is resolved
      start(ctx) {
        this.pend = 0;
        const e = this.e, L = e.len, st = this.st, N = this.N;
        this.L = L;
        this.sliced = 0;
        if (this.slMode !== 0 && this.slN >= 1) {
          const nS = this.slN;
          let j;
          if (this.slOne === 1) { j = round(255 * this.nSl); if (j > nS - 1) j = nS - 1; if (j < 0) j = 0; }
          else j = this.key - this.slRoot;
          if (j < 0 || j > nS - 1) {                              // a key outside the slices is silent
            for (let i = 0; i < MAXUNI; i++) st[i * NST + S_PH] = PH_END;
            this.on = 0;
            return;
          }
          this.sliced = 1; this.slA = this.sl[j]; this.slB = this.sl[j + 1];
        }
        this.S = (this.sliced === 1 ? this.slA : this.nS) * L;
        this.tb = 0;
        this.region(ctx.eff);
        const back = this.sigma(ctx) < 0, RL = this.RL;
        if (back && this.lmode === LM_TAIL) { this.tb = 1; this.region(ctx.eff); }
        for (let i = 0; i < N; i++) {
          const b = i * NST, d = (this.nUs * st[b + S_U] + this.nUsp * i / N) * RL;
          st[b + S_LT] = 1; st[b + S_LV] = -1;
          this.initHead(b, back ? RL - d : d, back);
        }
        for (let i = N; i < MAXUNI; i++) st[i * NST + S_PH] = PH_END;
        this.mPos = st[S_P] / L;
      }
      // region coordinate where an approach in travel direction sd enters the loop: forwards at LE (Tailed: E);
      // backwards at the near loop end (Fwd, Fwd/Rwd: the playhead runs on through the loop), at the far end LS for Rev
      // (it turns there, mirroring the forward case) and at S for Tailed
      rIn(sd) {
        const S = this.S, sg = this.sg, mode = this.lmode, rLE = (this.LE - S) * sg, rLS = (this.LS - S) * sg;
        if (mode === LM_TAIL) return sd > 0 ? this.RL : 0;
        if (sd > 0) return rLE;
        if (mode === LM_REV) return rLE < rLS ? rLE : rLS;
        return rLE > rLS ? rLE : rLS;
      }
      // a playhead at region coordinate r (START/SPAN wrap into the loop, One-shot silent past the end, §6.7.6)
      initHead(b, r, back) {
        const st = this.st, S = this.S, sg = this.sg, RL = this.RL, mode = this.lmode;
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
        st[b + S_P] = P; st[b + S_PH] = ph; st[b + S_LT] = lt; st[b + S_XU] = 0; st[b + S_XD] = 0;
      }
      // playhead pass of one unison voice (state at b): positions PA (and fade partner PB / weights WA, WB) of the n
      // samples of this chunk, read before each step; dr = increment in region coordinates (DR[s] when useDR: the F
      // stage may change its sign — Thru-Zero FM runs the playhead backwards — while the scan direction sd = sign(dr0)
      // decides where the playhead is heading: it ends, or enters the loop, only at the bound it travels toward and
      // holds at the other one, §6.6.4)
      headPass(b, dr0, useDR, n) {
        const st = this.st, mode = this.lmode, S = this.S, sg = this.sg, RL = this.RL, LS = this.LS, ld = this.ld;
        const LL = this.LL, LxF = this.LxF, LxB = this.LxB, exit = this.exit === 1 && this.gate === 0;
        const sd = dr0 < 0 ? -1 : 1, ri = this.rIn(sd), tb = this.tb === 1, xr = this.xrd;
        const fadeF = mode === LM_FWD || mode === LM_TAIL, fadeR = mode === LM_REV;
        // approach fades: only where the approach itself wraps (forwards into Fwd / forward Tailed at LE, backwards into
        // a backward Tailed at S); the Rev and Fwd/Rwd approaches turn, a backward Fwd approach runs on into the loop
        const apF = (mode === LM_FWD || (mode === LM_TAIL && !tb)) && sd > 0, apB = mode === LM_TAIL && tb && sd < 0;
        let P = st[b + S_P], ph = st[b + S_PH], lt = st[b + S_LT], xu = st[b + S_XU], xd = st[b + S_XD], xf = 0;
        for (let s = 0; s < n; s++) {
          const dr = useDR === 1 ? DR[s] : dr0;
          PA[s] = P; WA[s] = 1; WB[s] = 0; PB[s] = P; PHS[s] = ph === PH_LOOP ? 1 : ph === PH_APP && mode !== LM_ONE && !exit ? 0 : 2;
          if (ph === PH_END) { WA[s] = 0; xu = 0; continue; }
          // loop crossfade (§6.7.4) at the read position: the zone of the wrap the playhead is heading for (base
          // direction, so Thru-Zero FM jitter does not switch it); a fade left mid-zone by Exit Loop on Release is
          // ramped out over XRAMP instead of dropped (its partner keeps moving with the playhead)
          const lp = ph === PH_LOOP && !exit && (fadeF || fadeR), dir = lp ? lt * sd : sd;
          let u = 0;
          if (lp || (ph === PH_APP && !exit && (apF || apB))) {
            const lam = (P - LS) * ld;
            if (dir > 0) {
              if (LxF > 0 && lam > LL - LxF && lam <= LL) { u = (lam - (LL - LxF)) / LxF; xd = -ld * LL; }
            } else if (LxB > 0 && lam < LxB && lam >= 0) { u = (LxB - lam) / LxB; xd = ld * LL; }
            xu = u;
          } else if (xu > 0) { u = xu; xu -= xr; if (xu < 0) xu = 0; }
          if (u > 0) { fadeW(s, u); PB[s] = P + xd; xf = 1; }
          // step
          if (ph === PH_APP) {
            let r = (P - S) * sg + dr;
            if (mode === LM_ONE || exit) {
              if (sd > 0 ? r >= RL : r < 0) { ph = PH_END; r = sd > 0 ? RL : 0; }
              else if (r < 0) r = 0; else if (r > RL) r = RL;
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
              if (r < 0) r = 0; else if (r > RL) r = RL;            // the bound behind the travel holds
              P = S + sg * r;
            }
          } else if (ph === PH_LOOP) {
            if (exit) {                                           // Exit Loop on Release: on toward the region end
              ph = PH_EXIT; lt = (lt * sd < 0 ? -ld : ld) * sg;
            } else {
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
          if (ph === PH_EXIT) {                                   // lt = exit direction in region coordinates
            let r = (P - S) * sg + lt * dr * sd;
            if (lt > 0 ? r >= RL : r < 0) { ph = PH_END; r = lt > 0 ? RL : 0; } else if (r < 0) r = 0; else if (r > RL) r = RL;
            P = S + sg * r;
          }
        }
        st[b + S_P] = P; st[b + S_PH] = ph; st[b + S_LT] = lt; st[b + S_XU] = xu; st[b + S_XD] = xd;
        return xf;
      }
      // the §6.6.10 read bounds of this chunk into BD (bnd): Position offset po, travel direction sd. Clamped reads stay
      // in [S, E) — the frame at the end marker E belongs to what follows the region; they keep `pull` = 2^ℓ level-0
      // frames in from E so that the level-ℓ Hermite read at the clamp does not interpolate across E
      setBound(po, sd, pull) {
        const S = this.S, sg = this.sg, RL = this.RL, Ei = S + sg * (RL > pull ? RL - pull : 0);
        BD[0] = 1; BD[1] = this.LS; BD[2] = this.ld; BD[3] = this.LL; BD[4] = this.lmode === LM_PP ? 1 : 0;
        BD[5] = S; BD[6] = sg; BD[7] = S < Ei ? S : Ei; BD[8] = S < Ei ? Ei : S; BD[9] = this.rIn(sd); BD[10] = sd;
        BD[11] = po;
      }
      render(ctx, OL, OR, RAW) {
        zero(ctx, OL, OR, RAW);
        if (this.on !== 1 || this.B === null) return;
        const B = this.B;
        if (B.epoch !== this.ep) { const old = this.e; this.resolve(); if (this.e !== old) this.pend = 1; }
        const e = this.e;
        if (e === null) return;
        if (this.pend === 1) { this.start(ctx); if (this.on !== 1) return; }
        const n = ctx.CH, eff = ctx.eff, k0 = this.k0, st = this.st, N = this.N, fs = ctx.fs;
        this.L = e.len;
        this.region(eff);
        const sig = this.sigma(ctx), rate = e.rate, L = e.len, rev = this.rev === 1, nLv = e.levels.length;
        const stereo = e.ch === 2, root = e.root, fRoot = 440 * exp2((root - 69) / 12);
        // ρ reference (§6.3.3, §6.7.2, §6.7.5): root (normal), the key (Length to BPM, Normal slices), MIDI 60 (single slice)
        let fref = fRoot;
        if (this.lenOn === 1 || (this.sliced === 1 && this.slOne === 0)) fref = this.a4 * exp2((keyRefOf(ctx, this.key) - 69) / 12);
        else if (this.sliced === 1) fref = this.a4 * exp2(-0.75);
        const kf = rate / fs * sig / fref, po = eff[k0 + K.POS] * L, T0 = rate / fRoot, hT = 0.5 * T0, iT = 1 / T0;
        const gn = this.norm === 1 && e.peak > 0 ? 1 / e.peak : 1;
        this.xrd = 1 / (XRAMP * fs);
        // warps (§6.6.10)
        const wOn = warpChunk(this, ctx, N), W = this.W, ws = this.ws, wsR = this.wsR;
        const m0 = this.m0, m1 = this.m1, d0 = this.d0, d1 = this.d1, w1 = ctx.w1, w2 = ctx.w2, v1 = ctx.var1, v2 = ctx.var2;
        const mod1 = ctx.mod1 || null, mod2 = ctx.mod2 || null, ms1 = ctx.modStride1 | 0, ms2 = ctx.modStride2 | 0;
        const fm1 = ctx.fm1 | 0, fm2 = ctx.fm2 | 0, rt = wOn ? remapOf(ctx) : IDREMAP, rb = this.o * 2049;
        const fa = ctx.f, gl = ctx.gl, gr = ctx.gr, dgl = ctx.dgl, dgr = ctx.dgr;
        let alive = 0;
        for (let i = 0; i < N; i++) {
          const b = i * NST;
          if (st[b + S_PH] === PH_END) continue;
          let f = fa[i];
          if (!(f > 0)) f = 0;
          const dr0 = kf * f;
          // stage flags of this unison voice
          let fF0 = 0, fF1 = 0, fP0 = 0, fP1 = 0, fO0 = 0, fO1 = 0;
          if (wOn === 1) {
            const em = ws.em;
            if (em[i] !== 0) { if (d0 === DOM_F) fF0 = 1; else if (d0 === DOM_P) fP0 = 1; else if (d0 === DOM_O) fO0 = 1; }
            if (em[MAXUNI + i] !== 0) { if (d1 === DOM_F) fF1 = 1; else if (d1 === DOM_P) fP1 = 1; else if (d1 === DOM_O) fO1 = 1; }
          }
          // 1. F stage (playhead increments × g(m))
          let useDR = 0;
          if (fF0 | fF1) {
            for (let s = 0; s < n; s++) DR[s] = dr0;
            if (fF0) W.incBlockA(ws, 0, i, m0, fm1, w1, i, mod1, ms1, DR, DR, n);
            if (fF1) W.incBlockA(ws, 1, i, m1, fm2, w2, i, mod2, ms2, DR, DR, n);
            useDR = 1;
          }
          // 2. playhead (loop modes, crossfade partner)
          const xf = this.headPass(b, dr0, useDR, n);
          if (st[b + S_PH] !== PH_END) alive++;
          if (po !== 0) for (let s = 0; s < n; s++) { PA[s] += po; PB[s] += po; }
          // 3. P stage on the read positions (§6.6.10); Flip reads the unwarped intra-period phase; every warped read
          // (P stage, PD (Self), the Odd/Even second read) wraps or clamps as the playhead does (bnd)
          const odd = (fO0 && m0 === M_ODDEVEN) || (fO1 && m1 === M_ODDEVEN);
          if (fO0 | fO1) for (let s = 0; s < n; s++) { const q = PA[s] * iT; PHI[s] = q - floor(q); }
          // level by |dp| × slot speeds (§6.7.7); clamped reads keep 2^ℓ level-0 frames inside the region end
          let adp = dr0 < 0 ? -dr0 : dr0;
          if (wOn === 1) adp *= ws.sp[i] * ws.sp[MAXUNI + i];
          const lv = lvSel(nLv, adp), lvp = st[b + S_LV], lvo = lvp >= 0 && lvp !== lv && lvp < nLv ? lvp : -1;
          st[b + S_LV] = lv;
          let win = 0, sI = 0;
          if (fP0 | fP1 | odd) this.setBound(po, dr0 < 0 ? -1 : 1, 1 << (lvo > lv ? lvo : lv));
          if (fP0 | fP1) {
            PSD[0] = v1; PSD[1] = v2; PSD[2] = T0; PSD[3] = iT;
            win = pStage(W, ws, i, -1, fP0, fP1, m0, m1, w1, i, w2, i, rt, rb, mod1, ms1, mod2, ms2, xf, n);
            sI = PS.sI;
            boundArr(PA, n);
          }
          // 4. read (level chosen above, one-chunk crossfade on a change); PD (Self) per sample
          const P2 = xf ? PB : null;
          if (sI > 0) ws.y1[i] = readSelf(e, lv, lvo, rev, stereo, P2, sI, T0, ws.y1[i], odd, n);
          else {
            readLv(e, lv, lvo, 0, rev, PA, P2, XL, n);
            if (stereo) readLv(e, lv, lvo, 1, rev, PA, P2, XR, n);
            if (odd) {                                          // the partner (PD) lies outside the loop by design
              for (let s = 0; s < n; s++) { PC[s] = bnd(PA[s] + hT, PHS[s]); PD[s] = PB[s] + hT; }
              const Q2 = xf ? PD : null;
              readLv(e, lv, lvo, 0, rev, PC, Q2, X2L, n);
              if (stereo) readLv(e, lv, lvo, 1, rev, PC, Q2, X2R, n);
            }
            if (wOn === 1) ws.y1[i] = stereo ? 0.5 * (XL[n - 1] + XR[n - 1]) : XL[n - 1];   // PD (Self) starts from it
          }
          // 5. Sync window, then the O stage (one Slots per channel; the second read goes through both slots, SxWarp)
          if (win === 1) {
            for (let s = 0; s < n; s++) { XL[s] *= WIN[s]; X2L[s] *= WIN[s]; }
            if (stereo) for (let s = 0; s < n; s++) { XR[s] *= WIN[s]; X2R[s] *= WIN[s]; }
          }
          const x2l = odd ? X2L : null, x2r = odd ? X2R : null;
          if (fO0) W.outBlockA(ws, 0, i, m0, w1, i, v1, mod1, ms1, XL, x2l, PHI, n);
          if (fO1) W.outBlockA(ws, 1, i, m1, w2, i, v2, mod2, ms2, XL, x2l, PHI, n);
          if (stereo) {
            if (fO0) W.outBlockA(wsR, 0, i, m0, w1, i, v1, mod1, ms1, XR, x2r, PHI, n);
            if (fO1) W.outBlockA(wsR, 1, i, m1, w2, i, v2, mod2, ms2, XR, x2r, PHI, n);
          }
          // 6. gains (Phase-1 ramp) and the raw tap (post warps, pre level/pan)
          const XRr = stereo ? XR : XL;
          let gL = gl[i], gR = gr[i];
          const dL = dgl[i], dR = dgr[i];
          for (let s = 0; s < n; s++) {
            gL += dL; gR += dR;
            OL[s] += gL * gn * XL[s]; OR[s] += gR * gn * XRr[s];
          }
          if (RAW !== null) {
            const rw = i * MAXCH;
            if (stereo) for (let s = 0; s < n; s++) RAW[rw + s] = gn * 0.5 * (XL[s] + XR[s]);
            else for (let s = 0; s < n; s++) RAW[rw + s] = gn * XL[s];
          }
        }
        this.mPos = st[S_P] * (L > 0 ? 1 / L : 0);
        if (alive === 0) this.on = 0;
      }
      kill() {
        this.on = 0; this.gate = 0; this.fresh = 0; this.pend = 0;
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
        if (this.st !== null) this.st.fill(0);
        if (this.ws !== null) { this.ws.reset(); this.wsR.reset(); }
      }
      active() { return this.on === 1; }
      grains() { return 0; }
    }

    /* ------------------------------------------------------------ Multisample (§6.8) */
    const ZM_ONE = 0, ZM_LOOP = 1, ZM_SUS = 2;                 // zone modes
    const EV_DLY = 0, EV_ATT = 1, EV_HOLD = 2, EV_DEC = 3, EV_SUS = 4, EV_REL = 5, EV_DONE = 6;
    class MultiOsc {
      constructor(voice, o) {
        this.v = voice; this.o = o >= 0 && o <= 2 ? o | 0 : 0;
        this.B = null; this.k0 = -1; this.kLen = -1;
        this.ok = 0; this.sel = 0;
        this.id = ''; this.e = null; this.ep = -1;
        this.over = 0; this.dlyBpm = 0; this.bendTrack = 1; this.fm1 = 0; this.fm2 = 0; this.a4 = 440;
        this.W = null; this.ws = null; this.wsR = null; this.avBit = 1 << T_MULTI; this.wOff = 0; this.wOffR = 0;
        this.m0 = 0; this.m1 = 0; this.d0 = 0; this.d1 = 0;
        // per-voice state (first apply that selects Multisample): layers × unison voices, layer zones and entries
        this.st = null; this.lz = null; this.lE = null; this.envLad = null; this.lf = null; this.lu = null; this.ls = null;
        this.rrOwn = null; this.rrTmp = null; this.rr = null;
        this.nL = 0;                                              // layers playing (≤ MAXLAYER)
        this.on = 0; this.gate = 0; this.fresh = 0; this.N = 0; this.pend = 0; this.hasR2 = 0; this.r2s = 1;
        this.key = 60; this.vel = 1; this.nTim = 0.5; this.nMvel = 1; this.nMrand = 0;
        this.eS = null;                                           // the entry start() chose the zones from
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0; this.zone = -1;
      }
      apply(cp, o, qr) {
        if (!(o >= 0 && o <= 2)) { this.ok = 0; this.sel = 0; return badCP('oscillator index ' + o); }
        o |= 0;
        this.o = o;
        const why = prologue(this, cp, o, qr, SHAPES_MULTI, 'multi');
        if (why) { this.ok = 0; this.sel = 0; return why === '-' ? false : badCP(why); }
        this.ok = 1;
        this.sel = cp.oType[o] === T_MULTI ? 1 : 0;
        if (this.sel === 1 && this.st === null) {
          this.st = new Float64Array(MAXLAYER * MAXUNI * NST);
          this.lz = new Int32Array(MAXLAYER).fill(-1);
          this.lE = new Array(MAXLAYER).fill(null);
          this.envLad = new Float64Array(NENVLAD);
          // per layer: [rootT, gain, panL, panR, mode, ls, le, off, rate·0 …] and envelope parameters/state
          this.lf = new Float64Array(MAXLAYER * 16);
          this.lu = new Float64Array(MAXLAYER);                   // RAND draws
          this.ls = new Float64Array(MAXLAYER * 8);               // envelope: stage, level, time, level at stage start, e0, e1
          this.rrOwn = new Uint32Array(3 * MAXZ);
          this.rrTmp = new Int32Array(MAXLAYER);
        }
        if (this.sel === 1) {
          warpInit(this, T_MULTI);
          const v = this.v, proc = v !== null && typeof v === 'object' ? v.proc : null, sx = proc && typeof proc === 'object' ? proc.sx : null;
          if (sx !== null && typeof sx === 'object' && !(tag(sx.msRR) === 'Uint32Array' && sx.msRR.length === 3 * MAXZ)) {
            sx.msRR = new Uint32Array(3 * MAXZ);
          }
        }
        this.over = cp.msOver[o]; this.dlyBpm = cp.msDlyBpm[o]; this.bendTrack = cp.bendTrack[o];
        this.fm1 = cp.fmType[o * 2]; this.fm2 = cp.fmType[o * 2 + 1];
        if (this.st !== null) { const el = this.envLad, src = cp.envLad; for (let j = 0; j < NENVLAD; j++) el[j] = src[j]; }
        const id = cp.multi[o];
        if (id !== this.id) { this.id = id; this.e = null; this.ep = -1; }
        return true;
      }
      noteOn(ctx, fresh, legato) {
        this.gate = 1;
        if (this.ok === 0 || this.sel === 0) { this.on = 0; return; }
        this.fresh = fresh ? 1 : 0;
        if (legato && this.on === 1) return;                    // a legato note keeps the running layers
        let N = ctx.N | 0;
        N = N < 1 ? 1 : N > MAXUNI ? MAXUNI : N;
        this.on = 1; this.N = N;
        const eff = ctx.eff, k0 = this.k0;
        this.nTim = eff[k0 + K.TIMBRE]; this.nMvel = eff[k0 + K.MVEL]; this.nMrand = eff[k0 + K.MRAND];
        this.key = keyOf(ctx, this.v); this.vel = velOf(ctx, this.v);
        seedR2(this);
        this.nL = 0; this.zone = -1;
        if (fresh && this.ws !== null) { this.ws.reset(); this.wsR.reset(); }
        this.rr = ctx.sx !== null && typeof ctx.sx === 'object' && tag(ctx.sx.msRR) === 'Uint32Array' &&
          ctx.sx.msRR.length === 3 * MAXZ ? ctx.sx.msRR : this.rrOwn;
        if (this.B.epoch !== this.ep) this.resolve();
        this.pend = 1;
        if (this.e !== null) this.start(ctx);
      }
      noteOff() { this.gate = 0; }
      resolve() {                                                 // the multisample entry and its layers' zone samples
        const B = this.B, e = this.id !== '' ? B.getAsset(this.id) : null;
        this.e = e !== null && e !== undefined && e.kind === 'multi' && Array.isArray(e.zones) ? e : null;
        this.ep = B.epoch;
        if (this.lE !== null) this.resolveLayers();
      }
      resolveLayers() {
        const B = this.B, e = this.e, lE = this.lE, lz = this.lz;
        for (let l = 0; l < MAXLAYER; l++) {
          const z = lz[l];
          let x = null;
          if (e !== null && z >= 0 && z < e.zones.length) {
            const zs = e.zones[z].smp, a = typeof zs === 'string' && zs !== '' ? B.getAsset(zs) : null;
            x = a !== null && a !== undefined && a.kind === 'smp' ? a : null;
          }
          lE[l] = x;
        }
      }
      // zone choice (§6.8): key, velocity, TIMBRE, round robin; layer RAND draws; the zone samples resolve later
      start(ctx) {
        this.pend = 0; this.eS = this.e;
        const zones = this.e.zones, nz = zones.length < MAXZ ? zones.length : MAXZ, lz = this.lz, rr = this.rr, ro = this.o * MAXZ;
        const tim = round(128 * this.nTim - 64), Kl = this.key - tim, v127 = round(127 * this.vel), tmp = this.rrTmp;
        let nL = 0, nT = 0;
        for (let z = 0; z < nz && nL < MAXLAYER; z++) {
          const Z = zones[z];
          if (!(Kl >= Z.lo && Kl <= Z.hi && v127 >= Z.vlo && v127 <= Z.vhi)) continue;
          const r = Z.rr, len = r && r.length >= 2 ? r[0] | 0 : 1;
          if (len > 1) {
            let g = z;                                            // group leader: first zone with the same ranges
            for (let y = 0; y < z; y++) {
              const Y = zones[y];
              if (Y.lo === Z.lo && Y.hi === Z.hi && Y.vlo === Z.vlo && Y.vhi === Z.vhi) { g = y; break; }
            }
            if ((rr[ro + g] % len) + 1 !== (r[1] | 0)) {
              let seen = 0;
              for (let t = 0; t < nT; t++) if (tmp[t] === g) seen = 1;
              if (!seen && nT < MAXLAYER) tmp[nT++] = g;
              continue;
            }
            let seen = 0;
            for (let t = 0; t < nT; t++) if (tmp[t] === g) seen = 1;
            if (!seen && nT < MAXLAYER) tmp[nT++] = g;
          }
          lz[nL] = z;
          nL++;
        }
        for (let t = 0; t < nT; t++) rr[ro + tmp[t]] = (rr[ro + tmp[t]] + 1) >>> 0;
        for (let l = nL; l < MAXLAYER; l++) lz[l] = -1;
        this.nL = nL; this.zone = nL > 0 ? lz[0] : -1;
        const vf = v127 / 127, mv = this.nMvel, mr = this.nMrand, lf = this.lf, ls = this.ls, st = this.st;
        for (let l = 0; l < nL; l++) {
          const Z = zones[lz[l]], fb = l * 16;
          this.lu[l] = mr !== 0 ? rnd(this) : 0;
          const vt = typeof Z.vt === 'number' ? Z.vt : 1;
          const pan = Z.pan > -1 ? (Z.pan < 1 ? +Z.pan : 1) : -1;
          const g = pow(10, (+Z.gain || 0) / 20) * (1 - vt * mv * (1 - vf * vf));
          lf[fb] = (+Z.root || 0) + (+Z.tune || 0) / 100;
          lf[fb + 1] = g; lf[fb + 2] = panG(pan, 0); lf[fb + 3] = panG(pan, 1);
          lf[fb + 4] = Z.mode === 'loop' ? ZM_LOOP : Z.mode === 'sustain' ? ZM_SUS : ZM_ONE;
          lf[fb + 5] = +Z.ls || 0; lf[fb + 6] = +Z.le || 0; lf[fb + 7] = +Z.off || 0;
          const en = Z.env;
          const has = en !== null && en !== undefined && en.length >= 6;
          lf[fb + 8] = has ? +en[0] : 0; lf[fb + 9] = has ? +en[1] : 0; lf[fb + 10] = has ? +en[2] : 0;
          lf[fb + 11] = has ? +en[3] : 0; lf[fb + 12] = has ? +en[4] : 1; lf[fb + 13] = has ? +en[5] : 0.001;
          const eb = l * 8;
          ls[eb] = EV_DLY; ls[eb + 1] = 0; ls[eb + 2] = 0; ls[eb + 3] = 0; ls[eb + 4] = 0; ls[eb + 5] = 0; ls[eb + 6] = 1;  // [6] = pending
          for (let i = 0; i < MAXUNI; i++) { const b = (l * MAXUNI + i) * NST; st[b + S_PH] = PH_PEND; st[b + S_LV] = -1; }
        }
        this.resolveLayers();
        if (nL === 0) this.on = 0;
      }
      // envelope parameters of layer l (OVERRIDE ⇒ k.m* eff values, §6.8) into E (delay, a, h, d, s, r) — returns s
      envPar(l, eff, bpm) {
        const lf = this.lf, fb = l * 16;
        if (this.over === 1) {
          const k0 = this.k0;
          const nd = eff[k0 + K.MDLY];
          let dly = p5(nd);
          if (this.dlyBpm === 1) { let j = round(15 * nd); j = j > 0 ? (j < 15 ? j : 15) : 0; dly = this.envLad[j] * 60 / bpm; }
          EP[0] = dly; EP[1] = p5(eff[k0 + K.MATT]); EP[2] = p5(eff[k0 + K.MHOLD]); EP[3] = p5(eff[k0 + K.MDEC]);
          EP[4] = eff[k0 + K.MSUS]; EP[5] = p5(eff[k0 + K.MREL]);
        } else for (let j = 0; j < 6; j++) EP[j] = lf[fb + 8 + j];
      }
      // advance the layer envelope by dt seconds (linear DAHDSR); returns the level at the end
      envAdv(l, dt) {
        const ls = this.ls, eb = l * 8;
        let stg = ls[eb], lev = ls[eb + 1], t = ls[eb + 2], v0 = ls[eb + 3];
        if (this.gate === 0 && stg < EV_REL) { stg = EV_REL; t = 0; v0 = lev; }
        let rem = dt;
        for (let guard = 0; guard < 8 && rem >= 0; guard++) {
          if (stg === EV_DONE) { lev = 0; break; }
          if (stg === EV_SUS) { lev = EP[4] > 0 ? (EP[4] < 1 ? EP[4] : 1) : 0; break; }
          const T = stg === EV_DLY ? EP[0] : stg === EV_ATT ? EP[1] : stg === EV_HOLD ? EP[2] : stg === EV_DEC ? EP[3] : EP[5];
          const S = EP[4] > 0 ? (EP[4] < 1 ? EP[4] : 1) : 0;
          if (t + rem < T) {
            t += rem;
            const q = t / T;
            lev = stg === EV_DLY ? 0 : stg === EV_ATT ? q : stg === EV_HOLD ? 1 : stg === EV_DEC ? 1 + (S - 1) * q : v0 * (1 - q);
            break;
          }
          rem -= T - t; t = 0;
          if (stg === EV_DLY) { stg = EV_ATT; lev = 0; } else if (stg === EV_ATT) { stg = EV_HOLD; lev = 1; } else if (stg === EV_HOLD) { stg = EV_DEC; lev = 1; } else if (stg === EV_DEC) { stg = EV_SUS; lev = S; } else { stg = EV_DONE; lev = 0; }
          v0 = lev;
          if (rem === 0 && stg !== EV_SUS) break;
        }
        ls[eb] = stg; ls[eb + 1] = lev; ls[eb + 2] = t; ls[eb + 3] = v0;
        return lev;
      }
      render(ctx, OL, OR, RAW) {
        zero(ctx, OL, OR, RAW);
        if (this.on !== 1 || this.B === null) return;
        const B = this.B;
        // another entry than the one start() chose the zones from (an id change, a replaced entry): the note restarts
        // from its note-on values, as SampleOsc does; a zone sample arriving later only resolves its layer
        if (B.epoch !== this.ep) { this.resolve(); if (this.e !== null && this.e !== this.eS) this.pend = 1; }
        if (this.e === null) return;
        if (this.pend === 1) { this.start(ctx); if (this.on !== 1) return; }
        const n = ctx.CH, eff = ctx.eff, st = this.st, N = this.N, nL = this.nL, fs = ctx.fs, bpm = ctx.bpm > 0 ? ctx.bpm : 120;
        const lf = this.lf, ls = this.ls, lE = this.lE, dt = n / fs;
        // warps: one Slots pair per oscillator (per unison voice), the O stage on the layer sum
        const wOn = warpChunk(this, ctx, N), W = this.W, ws = this.ws, wsR = this.wsR;
        const m0 = this.m0, m1 = this.m1, d0 = this.d0, d1 = this.d1, w1 = ctx.w1, w2 = ctx.w2, v1 = ctx.var1, v2 = ctx.var2;
        const mod1 = ctx.mod1 || null, mod2 = ctx.mod2 || null, ms1 = ctx.modStride1 | 0, ms2 = ctx.modStride2 | 0;
        const fm1 = ctx.fm1 | 0, fm2 = ctx.fm2 | 0, rt = wOn ? remapOf(ctx) : IDREMAP, rb = this.o * 2049;
        const fa = ctx.f, gl = ctx.gl, gr = ctx.gr, dgl = ctx.dgl, dgr = ctx.dgr;
        // layer start (pending until its zone sample arrives), envelopes for this chunk
        let alive = 0;
        for (let l = 0; l < nL; l++) {
          const eb = l * 8, x = lE[l];
          if (ls[eb] === EV_DONE) { ls[eb + 4] = 0; ls[eb + 5] = 0; continue; }
          alive++;
          if (x === null) continue;                             // pending: its zone sample has not arrived
          if (ls[eb + 6] === 1) {                                 // start the layer: off + RAND (§6.8)
            ls[eb + 6] = 0;
            const fb = l * 16, len = x.len, mr = this.nMrand;
            let p0 = lf[fb + 7] + mr * this.lu[l] * Math.min(0.25 * len, 2 * x.rate);
            if (!(p0 >= 0)) p0 = 0;
            for (let i = 0; i < MAXUNI; i++) {
              const b = (l * MAXUNI + i) * NST;
              st[b + S_P] = p0; st[b + S_PH] = i < N && p0 < len ? PH_APP : PH_END; st[b + S_LV] = -1; st[b + S_LT] = 0;
              st[b + S_Y1] = 0;
            }
          }
          this.envPar(l, eff, bpm);
          ls[eb + 4] = ls[eb + 1];
          ls[eb + 5] = this.envAdv(l, dt);
        }
        for (let i = 0; i < N; i++) {
          // FM factors g(m) of this unison voice (shared by its layers)
          let fF0 = 0, fF1 = 0, fP0 = 0, fP1 = 0, fO0 = 0, fO1 = 0;
          if (wOn === 1) {
            const em = ws.em;
            if (em[i] !== 0) { if (d0 === DOM_F) fF0 = 1; else if (d0 === DOM_P) fP0 = 1; else if (d0 === DOM_O) fO0 = 1; }
            if (em[MAXUNI + i] !== 0) { if (d1 === DOM_F) fF1 = 1; else if (d1 === DOM_P) fP1 = 1; else if (d1 === DOM_O) fO1 = 1; }
          }
          const useG = fF0 | fF1;
          if (useG) {
            for (let s = 0; s < n; s++) GF[s] = 1;
            if (fF0) W.incBlockA(ws, 0, i, m0, fm1, w1, i, mod1, ms1, GF, GF, n);
            if (fF1) W.incBlockA(ws, 1, i, m1, fm2, w2, i, mod2, ms2, GF, GF, n);
          }
          const odd = (fO0 && m0 === M_ODDEVEN) || (fO1 && m1 === M_ODDEVEN);
          let f = fa[i];
          if (!(f > 0)) f = 0;
          let spd = 1;
          if (wOn === 1) spd = ws.sp[i] * ws.sp[MAXUNI + i];
          for (let s = 0; s < n; s++) { YL[s] = 0; YR[s] = 0; Y2L[s] = 0; Y2R[s] = 0; }
          let first = 1;
          for (let l = 0; l < nL; l++) {
            const eb = l * 8, x = lE[l], b = (l * MAXUNI + i) * NST;
            if (x === null || ls[eb + 6] === 1 || st[b + S_PH] === PH_END) continue;
            const fb = l * 16, len = x.len, zm = lf[fb + 4], zls = lf[fb + 5], zle = lf[fb + 6];
            const loopOn = zle > zls && zle <= len && (zm === ZM_LOOP || (zm === ZM_SUS && this.gate === 1));
            const LL = zle - zls, fR = 440 * exp2((lf[fb] - 69) / 12), dp = x.rate / fs * f / fR, T0 = x.rate / fR, iT = 1 / T0;
            // playhead (zone loop / sustain loop / one-shot)
            let P = st[b + S_P], ph = st[b + S_PH];
            for (let s = 0; s < n; s++) {
              PA[s] = P; WA[s] = ph === PH_END ? 0 : 1; PHS[s] = loopOn && st[b + S_LT] === 1 ? 1 : 0;
              if (ph === PH_END) continue;
              P += useG ? dp * GF[s] : dp;
              if (loopOn && P >= zle) P -= LL * (1 + floor((P - zle) / LL));
              else if (loopOn && P < zls && st[b + S_LT] === 1) P += LL * (1 + floor((zls - P) / LL));
              if (P >= len) { ph = PH_END; P = len; } else if (P < 0) P = 0;   // Thru-Zero FM: the start holds (§6.6.4)
              if (loopOn && P >= zls && P < zle) st[b + S_LT] = 1;
            }
            st[b + S_P] = P; st[b + S_PH] = ph;
            // P stage on this zone's root period (§6.6.10); Flip of the layer sum reads the first layer's phase; warped
            // reads (P stage, PD (Self), Odd/Even) wrap into the zone loop while the layer loops, else stay in the sample
            if (first === 1 && (fO0 | fO1)) for (let s = 0; s < n; s++) { const q = PA[s] * iT; PHI[s] = q - floor(q); }
            first = 0;
            let win = 0, sI = 0;
            if (fP0 | fP1 | odd) { BD[0] = 2; BD[12] = zls; BD[13] = zle; BD[14] = len - 1; }
            if (fP0 | fP1) {
              PSD[0] = v1; PSD[1] = v2; PSD[2] = T0; PSD[3] = iT;
              win = pStage(W, ws, i, -1, fP0, fP1, m0, m1, w1, i, w2, i, rt, rb, mod1, ms1, mod2, ms2, 0, n);
              sI = PS.sI;
              boundArr(PA, n);
            }
            // read (PD (Self): per layer y₁ in the state)
            let adp = dp * spd;
            const nLv = x.levels.length, lv = lvSel(nLv, adp < 0 ? -adp : adp), lvp = st[b + S_LV];
            const lvo = lvp >= 0 && lvp !== lv && lvp < nLv ? lvp : -1;
            st[b + S_LV] = lv;
            const stereo = x.ch === 2;
            if (sI > 0) st[b + S_Y1] = readSelf(x, lv, lvo, false, stereo, null, sI, T0, st[b + S_Y1], odd, n);
            else {
              readLv(x, lv, lvo, 0, false, PA, null, XL, n);
              if (stereo) readLv(x, lv, lvo, 1, false, PA, null, XR, n);
              if (odd) {
                const h = 0.5 * T0;
                for (let s = 0; s < n; s++) PC[s] = bnd(PA[s] + h, PHS[s]);
                readLv(x, lv, lvo, 0, false, PC, null, X2L, n);
                if (stereo) readLv(x, lv, lvo, 1, false, PC, null, X2R, n);
              }
              st[b + S_Y1] = stereo ? 0.5 * (XL[n - 1] + XR[n - 1]) : XL[n - 1];
            }
            // Sync window of this layer, then layer gain × envelope ramp × pan into the layer sum
            const XRr = stereo ? XR : XL, X2Rr = stereo ? X2R : X2L;
            if (win === 1) {
              for (let s = 0; s < n; s++) { XL[s] *= WIN[s]; X2L[s] *= WIN[s]; }
              if (stereo) for (let s = 0; s < n; s++) { XR[s] *= WIN[s]; X2R[s] *= WIN[s]; }
            }
            const g = lf[fb + 1], pL = lf[fb + 2] * g, pR = lf[fb + 3] * g, e0 = ls[eb + 4], de = (ls[eb + 5] - e0) / n;
            for (let s = 0; s < n; s++) {
              const ev = e0 + de * (s + 1);
              YL[s] += pL * ev * XL[s]; YR[s] += pR * ev * XRr[s];
            }
            if (odd) for (let s = 0; s < n; s++) { const ev = e0 + de * (s + 1); Y2L[s] += pL * ev * X2L[s]; Y2R[s] += pR * ev * X2Rr[s]; }
          }
          // O stage on the layer sum (the second read through both slots, SxWarp), gains, raw tap
          const y2l = odd ? Y2L : null, y2r = odd ? Y2R : null;
          if (fO0) W.outBlockA(ws, 0, i, m0, w1, i, v1, mod1, ms1, YL, y2l, PHI, n);
          if (fO1) W.outBlockA(ws, 1, i, m1, w2, i, v2, mod2, ms2, YL, y2l, PHI, n);
          if (fO0) W.outBlockA(wsR, 0, i, m0, w1, i, v1, mod1, ms1, YR, y2r, PHI, n);
          if (fO1) W.outBlockA(wsR, 1, i, m1, w2, i, v2, mod2, ms2, YR, y2r, PHI, n);
          let gL = gl[i], gR = gr[i];
          const dL = dgl[i], dR = dgr[i];
          for (let s = 0; s < n; s++) { gL += dL; gR += dR; OL[s] += gL * YL[s]; OR[s] += gR * YR[s]; }
          if (RAW !== null) { const rw = i * MAXCH; for (let s = 0; s < n; s++) RAW[rw + s] = 0.5 * (YL[s] + YR[s]); }
        }
        // layers that ended (envelope done, or every unison playhead at its end)
        let live = 0;
        for (let l = 0; l < nL; l++) {
          const eb = l * 8;
          if (ls[eb] === EV_DONE) continue;
          if (lE[l] === null || ls[eb + 6] === 1) { live++; continue; }
          let any = 0;
          for (let i = 0; i < N; i++) if (st[(l * MAXUNI + i) * NST + S_PH] !== PH_END) { any = 1; break; }
          if (any) live++; else ls[eb] = EV_DONE;
        }
        if (nL > 0 && lE[0] !== null) {
          const x = lE[0];
          this.mPos = st[S_P] / x.len; this.mS = lf[7] / x.len; this.mLS = lf[5] / x.len; this.mLE = lf[6] / x.len;
        }
        if (live === 0 || alive === 0) this.on = 0;
      }
      kill() {
        this.on = 0; this.gate = 0; this.fresh = 0; this.nL = 0; this.zone = -1; this.pend = 0;
        this.mPos = 0; this.mS = 0; this.mLS = 0; this.mLE = 0;
        if (this.st !== null) {
          this.st.fill(0); this.lz.fill(-1); this.ls.fill(0);
          const lE = this.lE;
          for (let l = 0; l < MAXLAYER; l++) lE[l] = null;
        }
        if (this.ws !== null) { this.ws.reset(); this.wsR.reset(); }
      }
      active() { return this.on === 1; }
      grains() { return 0; }
    }
    const EP = new Float64Array(6);                           // envelope parameter scratch (MultiOsc.envPar)

    globalThis.SxSample = Object.freeze({ VER, MAXCH, MAXUNI, MAXLAYER, NSL, K, SampleOsc, MultiOsc });
  } catch (err) {
    globalThis.SxSample = null;                                // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-sample: load failed', err);
  }
})();
