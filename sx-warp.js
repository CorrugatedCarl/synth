/*
 * sx-warp.js — Serum 2 warp engine (classic script, no imports/exports; owner D3).
 * Contract: SPEC-serum2 §11.7 (exports), §3.4 (WARPS2), §6.6 (warp engine, block structure B18), §6.6.10 (sample types),
 * §6.10.7 (Spectral warp delay line), §0.3 (load order, IIFE shape, lazy references), §0.4 (code rules), §15.7 (tests:
 * tests/sx-warp.test.mjs).
 *
 * Script #3 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Publishes the frozen `globalThis.SxWarp`; can be evaluated again in the same scope (it
 * keeps no store); a failure inside leaves SxWarp = null without throwing (then S2 warp slots act as Off, §0.3). Reads no
 * other script's global at load: the distortion warps resolve `SxBase` (its Shaper / shapeBlock, the one shared copy of
 * the FX shapers, §0.3) in `new Slots` and cache it there — without SxBase the distortion warps act as Off (one warning).
 *
 * Exports ([+] = an addition beyond §11.7, ⚑ = an interpretation/deviation; ratified by RULINGS2 D3: chunk's nu,
 * Slots.pdI/y1, the kernels' modulator column mc, pdBlock, renderWarp2 opts.hz, renderSweep, the PD (Self) realisation;
 * ruled there: the distortion warps' DC blocker, added; the x2 obligation of outBlock is the documented IMPL choice)
 *   VER 1 · N 82 (WARPS2 length) · MAXUNI 16
 *   Codes (frozen objects): DOM {NONE 0 (Off), F 1, P 2, O 3, S 4} (= SxBase.WDOM) · SP speed kinds {ONE 0 (speed 1),
 *     SYNC 1 (r = 2^(4.4w)), P1 2 (the Phase-1 rule of the mode), FM 3 (TZ/Lin 1 + 8w², Exp 2^(4w)), PD 4 (1 + 6.3·I),
 *     NONE 5 (S domain: no read phase, speed 1)} · NT neutral kinds {ALWAYS 0 (Off), W0V0 1 (w = 0 and v = 0), W0 2
 *     (w = 0), WHALF 3 (w = 0.5), NEVER 4} · MS modulator source {NONE 0, O1 1, O2 2, NOISE 3, SUB 4, F1 5, F2 6, SELF 7}
 *     (o1/o2 = first/second other oscillator in A, B, C order, §3.4.2) · FM types {TZ 0, EXP 1, LIN 2} (= FM_TYPES)
 *   META   per-mode tables (index = WARPS2 index), built by the same normative list as serum-core WARPS2 / SxBase
 *          (integration-tested): ids Array(82) · dom Uint8Array(82) (DOM codes) · avail Uint8Array(82) (bit t set ⇔
 *          available on oscillator type t of OSC_TYPES / SxBase.OTYPE: 31 = all, 16 = Spectral only) · speed Uint8Array(82)
 *          (SP kinds) · neutral Uint8Array(82) (NT kinds) · msrc Uint8Array(82) (MS codes) · dist Int8Array(82) (FX
 *          distortion mode of the d_* modes: Tube…Zero-Square 0–7, Asym 9, Rectify 10, Sine Shaper 13, Stomp Box 14,
 *          Tape Sat. 15, Soft Sat. 17; −1 otherwise)
 *   speed(mode, w, fm) → number ≥ 1: the read-speed factor of a slot at amount w (§3.4.1 speed column; Phase-1
 *          warpSetup speeds for the P1 kind; 1 at a neutral amount, for Off, unknown modes and the S domain). Used for the
 *          mip level (§6.5: H = flim/(f·speed); the oscillator multiplies the F- and P-domain slot speeds).
 *   Slots(maxUni = 16)  per oscillator per voice, created in apply (allocates; never on the render path). Public fields:
 *          maxUni · mode Uint8Array(2) (the mode passed to the last chunk() of slot k, 0 after a validation failure) ·
 *          em Uint8Array(2·maxUni) (effective mode of unison voice i of slot k at [k·maxUni + i]; 0 = acts as Off for that
 *          voice: Off, neutral amount, beyond chunk's nu, or a distortion warp without SxBase) · sp Float64Array(2·maxUni)
 *          (speed per voice, 1 when Off) · hw Uint8Array(2) (1 ⇔ slot k writes a Sync window, i.e. Sync with Var > 0) ·
 *          [+] pdI Float64Array(2·maxUni) (PD (Self) index I = 1.5·w^1.5 of voice i in slot k, 0 otherwise) ·
 *          y1 Float64Array(maxUni) (the PD (Self) feedback sample y₁ of each unison voice: storage for the CALLER's
 *          per-sample loop, which reads and writes it; no kernel reads it; cleared by reset(); see PD (Self) below) ·
 *          bytes (Σ typed-array bytes).
 *          reset() clears every state (filters and Stomp Box of x and x2, y1): call it at a fresh note-on (§6.6.4).
 *          Other fields are private.
 *   chunk(slots, k, mode, w, v, fm, fi, fs, [+] nu = maxUni) → effective mode of the slot (0 when every unison voice acts
 *          as Off), once per slot per chunk, for BOTH slots and before any kernel of the chunk (mode 0 costs O(1);
 *          phaseBlock of slot 1 reads slot 0's hw, outBlock of slot 0 reads slot 1's em for Odd/Even):
 *          k 0|1 · mode = the eff WARPS2 index AFTER the caller's availability resolution (§3.4.2 type, §6.6.6 modulator,
 *          cycle rule: unavailable ⇒ 0) · w Float64Array(≥ nu) eff amount per unison voice (§6.6.8) · v the slot's
 *          eff Var · fm FM type 0–2 (osc.fm[slot]) · fi Float64Array(≥ nu) unison voice frequencies in Hz (LPF/HPF) ·
 *          fs the oscillator's (OS) rate · nu = the unison voices in use (voices ≥ nu are reported Off; default maxUni).
 *          Call it EVERY chunk for both slots, also while both are Off (O(1)), with the slot's real mode, and only once
 *          per slot per chunk: chunk() is the only clock the per-voice states have. A caller that skips it while both
 *          slots are Off leaves em at the old mode, so a slot that comes back resumes filter/Stomp states that are
 *          chunks old (a click); a caller that calls it twice per chunk with mode 0 in between (e.g. to select kernels
 *          by domain) restarts LPF/HPF/Stomp Box every chunk. The kernels already ignore a mode of another domain.
 *          Computes em, sp, hw, pdI and the per-voice coefficients (LPF/HPF SVF — pow/tan only when f_i, w, fs or the
 *          mode changed —, Stomp Box filters); a voice whose effective mode changes (Off → on, LPF ↔ HPF, …) restarts
 *          its filter state (LPF: from the DC steady state of its first input sample, so Off → LPF has no step; HPF,
 *          Stomp Box: from zero). Neutral amounts are
 *          exact-equality tests (§0.7; Quantize keeps its Phase-1 rule w < 1e-6). Invalid arguments ⇒ the slot acts as
 *          Off for this chunk, one console.warn per kind of error per scope.
 *   Block kernels (B18): one call per unison voice per chunk per slot, a monomorphic loop selected once per call by
 *   `mode`, no per-sample cross-script call. Each returns 1 when it applied slot k to unison voice i, 0 when it acted as
 *   Off (output = input bit for bit; this includes a mode of another domain, em[k·maxUni + i] ≠ mode — the kernel acts
 *   only on what the last chunk() set up — and missing data: a remap mode without a remap row, Odd/Even without x2,
 *   Flip without ph). The caller may skip calls for em = 0. Arguments shared by the kernels: w = the eff amount of THIS
 *   unison voice (the number passed in chunk's w[i]), v = the slot's Var, m / mStride = the modulator (§6.6.6): sample
 *   s of the modulator's unison voice (u mod mStride) is read at m[s·mStride + (u mod mStride)], i.e. oscillator
 *   modulators deliver their per-unison-voice raw output SAMPLE-MAJOR (RAW[s·N + u], mStride = N = that oscillator's
 *   unison count this chunk); mono modulators (noise, sub, filter fPrev of §6.6.7) pass mStride = 1; mStride = 0 reads
 *   the constant m[0]; m = null reads 0 (the mode stays active: AM → x·(1 − w/2), RM → x·(1 − w), FM/PD → identity;
 *   the Phase-1 renderWarp convention); an m shorter than its layout needs reads 0 (one warning).
 *   ⚑ [+] The modulator column u (§11.7 writes g(m[s·mStride]) without one): u = the optional last argument mc of
 *   every kernel (an integer ≥ 0; default −1 = absent ⇒ u = i, the Slots voice index; the §11.7 arities are kept).
 *   A caller whose Slots voice index is not the oscillator's unison voice — a Slots(1) per Spectral stream, a Slots
 *   per grain — passes the unison voice / stream index as mc, so §6.6.6's "unison voice i mod N_other" holds.
 *   incBlock(slots, k, i, mode, fm, w, m, mStride, inc, out, n) → 0|1
 *          F stage (§6.6.1 step 1), modes 33–38: out[s] = inc[s]·g(m) for s < n (out may be inc: in place), Thru-Zero
 *          g = 1 + 8w²·m, Linear max(0, 1 + 8w²·m), Exp 2^(4w·m). Sample types pass playhead increments; Spectral
 *          (§6.10.7) can pass inc = 1 to get g(m) per sample for its leaky Δ integrator (the integrator and its state
 *          are SxSpec's), so the FM law lives in one script.
 *   phaseBlock(slots, k, i, mode, w, v, remapTab, rb, m, mStride, phIn, phOut, win, n) → 0|1
 *          P stages (§6.6.1 step 3): phOut[s] = W(phIn[s]) for phIn ∈ [0, 1) (phOut may be phIn); the Phase-1 formulas
 *          of Bend/PWM/Asym/Mirror/Remap/Quantize, Sync φ' = frac(φ·2^(4.4w)), PD φ' = frac(φ + I·m) (I = 3w^1.5, Sub
 *          4w^1.5) — WRAPPED into [0, 1): right for a cycle phase (wavetables, the Spectral stream phase θ); a read
 *          position that is not a cycle phase (sample types, §6.6.4: offset I·m·T₀ source frames, which may leave the
 *          root period) takes the unwrapped offset from pdBlock instead. PD (Self) (mode 45) acts as Off here (copy,
 *          returns 0): it is fed back per sample by the caller's read loop (below), so no caller can apply it twice
 *          or with a held feedback sample. remapTab = CT.remap (Float32Array(3·2049)), rb = o·2049. Also used with
 *          the intra-period phase of §6.6.10 and the stream phase of §6.10.7. win (Float64Array | null): when
 *          slots.hw[k], the slot's Sync window
 *          (1 − v + v·sin²(π·φ_in)) is ASSIGNED to win (k = 0, or k = 1 with hw[0] = 0) or MULTIPLIED into it (k = 1 with
 *          hw[0] = 1); the caller applies win in stage 5 iff hw[0] | hw[1] — to the read sample (and to the Odd/Even
 *          second read) BEFORE the O stages: y = O₂(O₁(x·win)).
 *   outBlock(slots, k, i, mode, w, v, m, mStride, x, x2, ph, n) → 0|1
 *          O stages (§6.6.1 step 5) in place on the read samples x: Flip (ph < w ? x : −x, ph = the unwarped accumulator
 *          phase), Odd/Even (x2 = the second read at φ₂ + ½), LPF/HPF (TPT SVF, Q 0.7071, per unison voice), the 14
 *          distortions (y = x + (D(x) − x)·min(1, 10w), D = SxBase's FX shaper at drive w — re-set only when the mode
 *          or w changed; Stomp Box: HP 720 Hz → shaper → LP 6 kHz at fs, states per unison voice; IMPL (M4 performance):
 *          the tanh curves — Tube, Asym, Stomp Box, Soft Sat. — use a clamped rational tanh here (ftanh, Padé 7/6, clamp
 *          ±4.97: |error| ≤ 9.7e-5, monotonic, |y| ≤ 1; Math.tanh per unison sample was 15 % of a dense patch), the FX
 *          Distortion keeps SxBase's exact shapers (S1 bit-identity)), AM
 *          x·(1 − w + w·(0.5 + 0.5m)), RM x·(1 − w + w·m). DC blocker (lead ruling, RULINGS2 D3): every distortion
 *          warp (19–32) is followed by the Phase-1 Distortion module's 5 Hz one-pole DC blocker y = x − x₁ + R·y₁,
 *          R = 1 − 2π·5/fs (§8.5.3), per slot per unison voice (and per x2 state), on the blended output — the static
 *          §8.5.4 shapers of Tube, Diode 1, Asym, Rectify, Stomp Box … otherwise leave DC on the oscillator output
 *          (Rectify sine w 1 ≈ +0.87). Its states start at 0 (reset(), a voice's mode change, the x2 restart). At a
 *          neutral amount the slot is Off: no blocker (§0.7). renderWarp2 removes the DC exactly instead (below).
 *          Odd/Even after an O slot (§15.7 separation through y = O₂(O₁(x))): when slot 1 (k = 1) of this voice is
 *          Odd/Even (em), slot 0's outBlock also runs its O stage on x2 as the same chain half a cycle later — Flip at
 *          frac(ph + ½), LPF/HPF/Stomp Box with a second state per voice, the shapers, AM/RM with the same m sample,
 *          Odd/Even with x and x2 swapped — so CALLERS MUST PASS THE SECOND READ x2 TO BOTH SLOTS' outBlock WHENEVER
 *          EITHER SLOT OF THE VOICE IS Odd/Even (not only to the Odd/Even slot; one console.warn per scope when slot 0
 *          acts on a voice whose slot 1 is Odd/Even and gets x2 = null — its even harmonics then leak, §15.7/§15.8).
 *          ⚑ This obligation is not yet written in §11.7 (which defines x2 only as "the Odd/Even second read"); it is
 *          the only way slot 2's Odd/Even can separate the harmonics of O₁(x) as y = O₂(O₁(x)) requires. Slot 1 never
 *          touches x2 (nothing follows it).
 *   [+] incBlockA(slots, k, i, mode, fm, wa, wi, …), phaseBlockA(slots, k, i, mode, wa, wi, v, …), outBlockA(slots, k, i,
 *          mode, wa, wi, v, …) (M4 performance): incBlock / phaseBlock / outBlock with the amount read as wa[wi] (the
 *          caller's per-voice amount array and index) instead of a number — a double argument of a call V8 does not
 *          inline is boxed, one heap number per voice, slot and chunk; the number forms are these with a one-value
 *          array. The P-stage kernels below phaseBlock take their coefficient through a scratch value for the same
 *          reason, and their u^K is written out per block (powArr, the operations of powU: bit-identical; Bend in one
 *          pass, and the mantissa as u·2^−e instead of a store into the double's exponent bits read back as a double).
 *          chunk() keeps a voice's em / sp / pdI rows when its amount and the slot's mode, Var and FM type are those
 *          they were computed for (the same values; no pow / neutrality test per voice per chunk; LPF / HPF unchanged).
 *   [+] pdBlock(slots, k, i, mode, w, m, mStride, out, n) → 0|1
 *          PD 39–44 as an unwrapped offset: out[s] = I·m(s) (I = 3w^1.5, Sub 4w^1.5; m as above), in periods; 0 and
 *          returns 0 for any other mode or a voice chunk() did not set up. frac(φ + out[s]) is bit-identical to
 *          phaseBlock's PD. Sample types (§6.6.4, §6.6.10): p' = p + out[s]·T₀ before the intra-period mapping of a
 *          later P slot (after the one of an earlier P slot), so offsets of several periods are kept; Spectral
 *          (§6.10.7): Δ = out[s]·T₀(t). Keeps the PD law in this script.
 *   PD (Self) (mode 45, §6.6.4: m = the unison voice's previous output sample; IMPL — ONE realisation for every
 *   oscillator type, per sample, in the caller's read loop; no kernel applies it, phaseBlock(45) and pdBlock(45) act
 *   as Off for EVERY caller, so an oscillator type whose read loop does not implement the feedback below renders PD
 *   (Self) as Off. No kernel can realise it: the feedback needs the read of sample s before the phase of sample s + 1,
 *   i.e. the caller's read inside the loop (B18 / §0.3 exclude a per-sample cross-script call). ⚑ The realisation as a
 *   whole — y₁, the order, and Granular's per-grain y₁ — is ratified by RULINGS2 D3/D4):
 *     · I = Σ slots.pdI[k·maxUni + i] over the slots in mode 45 (chunk() fills pdI; 1.5·w^1.5 each).
 *     · y₁ = the previous RAW READ sample of that unison voice — before the Sync window, the O stages, level, pan and
 *       sample gain; a stereo read feeds back its mono average —, updated every sample, kept in slots.y1[i] across
 *       chunks, cleared by reset() at a fresh note-on. ⚑ §3.4.1/§6.6.4 say "previous output sample" and §6.6.6 calls
 *       an oscillator's output "post its own warps": that differs from the raw read only when the other slot is an O
 *       warp (LPF/HPF, distortion, AM/RM, Flip, Odd/Even) or Sync with Var > 0. Feeding back the post-O sample would
 *       need the O stages per sample inside the feedback loop — the B18 / §0.3 obstacle of the order below — so every
 *       caller feeds back the raw read (one definition for all types; storing a chunk's last post-O, post-gain sample
 *       in slots.y1 is not this realisation).
 *     · Wavetable (serum-dsp's read loop, renderWarp2): φ_r = frac(φ₂ + I·y₁), x = x(φ_r), y₁ ← x; the Odd/Even
 *       second read follows φ_r. Sample / Multisample: p_r = p₂ + I·y₁·T₀ (unwrapped, §6.6.4), x = read(p_r),
 *       y₁ ← x; the Odd/Even second read at p_r + T₀/2. Granular (ratified, RULINGS2 D3/D4):
 *       y₁ per grain (the grain's own previous raw read, 0 at spawn), since a grain-by-grain render has no per-sample
 *       stream sum; Spectral: Δ = I·y₁·T₀(t) with y₁ = the stream's previous warp-line read (before its O stages and
 *       the F/P crossfade).
 *     · ⚑ Order (IMPL deviation from §6.6.1 step 3, ratified by RULINGS2 D3): the self shift is applied AFTER the
 *       P stage of the other slot whichever slot holds PD (Self): φ_r = frac(W(φ) + I·y₁). This differs from §6.6.1
 *       only for PD (Self) in slot 1 with Sync, Bend, PWM, Asym, Mirror, Remap or Quantize in slot 2 (PD offsets
 *       commute; F and O slots are not phase stages): there §6.6.1 asks for φ₂ = W₂(frac(φ + I·y₁)), which needs W₂
 *       per sample inside the feedback loop — a per-sample cross-script call or a second copy of the P formulas in
 *       every caller, both excluded by B18 / §0.3. Consequences: Swap Warps does not change such a pair, and a Sync
 *       slot 2 takes its window from the phase before the self shift.
 *   renderWarp2(frame, slots, opts) → Float32Array(2048·over)   (main thread, §6.6.9)
 *          one cycle of frame (array-like ≥ 2048 values, level 0) through both slots, Hermite reads (as Phase-1
 *          renderWarp), through the block kernels exactly as the wavetable voice runs them (stages 1–5 above, PD (Self)
 *          per sample); slots = [{mode, w, v, fm}, …] (≤ 2 entries, null/missing = Off), opts = {over, remap
 *          (Float32Array(≥ 2049), default identity), mod (array-like ≥ 2048 | null: one cycle of the modulator, read at
 *          the unwarped phase; null = m 0), osc, [+] hz (fundamental assumed for LPF/HPF, default 220: the cycle is
 *          rendered at fs = hz·2048·over)}; chunks of 32 samples. Modes with state (LPF, HPF, Stomp Box, PD (Self))
 *          run 8 cycles first and return the 9th (steady state). A distortion slot's DC blocker is replaced by the exact
 *          periodic steady state of an ideal DC block: the mean of the slot's output over the rendered cycle is
 *          subtracted (one extra measuring pass per distortion slot; the 5 Hz pole would need ≈ 0.44·hz cycles to
 *          settle, and at audio rates it removes the DC only). Spectral-only modes act as Off. Throws TypeError for
 *          a malformed frame / slots / opts; numeric values are clamped (mode outside 0–81 ⇒ Off, w and v into [0, 1],
 *          fm 0–2).
 *   [+] renderSweep(frame, slots, opts) → Float32Array(F·2048·over) | null   (main thread, §13.3.1 Render OSC Warp)
 *          F = opts.frames (default 256) frames: frame f = renderWarp2 with slot 1 at the absolute amount f/(F − 1) and
 *          slot 2 at its given values; if slot 1 is Off, slot 2 is swept instead (slot 1 Off); both Off ⇒ null.
 *
 * Hot paths (chunk, the kernels) never allocate. Typed-array constructors are global lookups, used only in the Slots
 * constructor, renderWarp2 and renderSweep (the allocation-free tests replace them on the context).
 */
(function () {
  'use strict';
  try {
    const pow = Math.pow, sqrt = Math.sqrt, floor = Math.floor, round = Math.round, exp = Math.exp, tan = Math.tan,
      sin = Math.sin, PI = Math.PI, mlog2 = Math.log2, SQRT2 = Math.SQRT2;

    const VER = 1, N = 82, MAXUNI = 16;
    const MAXCH_W = 2048;                                      // the longest block the P-stage scratch serves (renderWarp2 frame)
    const DOM = Object.freeze({ NONE: 0, F: 1, P: 2, O: 3, S: 4 });
    const SP = Object.freeze({ ONE: 0, SYNC: 1, P1: 2, FM: 3, PD: 4, NONE: 5 });
    const NT = Object.freeze({ ALWAYS: 0, W0V0: 1, W0: 2, WHALF: 3, NEVER: 4 });
    const MS = Object.freeze({ NONE: 0, O1: 1, O2: 2, NOISE: 3, SUB: 4, F1: 5, F2: 6, SELF: 7 });
    const FM = Object.freeze({ TZ: 0, EXP: 1, LIN: 2 });
    const AV_ALL = 31, AV_SPEC = 16;                         // bit t = OSC_TYPES index t (SPEC = 4)

    /* ------------------------------------------------------------ WARPS2 meta (§3.4.1, same list as serum-core) */
    const IDS = [], DOMS = [], SPEEDS = [], NEUTS = [], SRCS = [], DISTS = [];
    const def = (id, dom, sp, nt, src = MS.NONE, dist = -1) => {
      IDS.push(id); DOMS.push(dom); SPEEDS.push(sp); NEUTS.push(nt); SRCS.push(src); DISTS.push(dist);
    };
    def('off', DOM.NONE, SP.ONE, NT.ALWAYS);
    def('sync', DOM.P, SP.SYNC, NT.W0V0);
    def('bend_p', DOM.P, SP.P1, NT.W0); def('bend_n', DOM.P, SP.P1, NT.W0); def('bend_pn', DOM.P, SP.P1, NT.WHALF);
    def('pwm', DOM.P, SP.P1, NT.W0);
    def('asym_p', DOM.P, SP.P1, NT.W0); def('asym_n', DOM.P, SP.P1, NT.W0); def('asym_pn', DOM.P, SP.P1, NT.WHALF);
    def('flip', DOM.O, SP.ONE, NT.NEVER);
    def('mirror', DOM.P, SP.P1, NT.NEVER);
    for (let r = 1; r <= 4; r++) def('remap' + r, DOM.P, SP.P1, NT.W0);
    def('quantize', DOM.P, SP.ONE, NT.W0);
    def('oddeven', DOM.O, SP.ONE, NT.WHALF);
    def('lpf', DOM.O, SP.ONE, NT.W0); def('hpf', DOM.O, SP.ONE, NT.W0);
    const DIST = [['d_tube', 0], ['d_soft', 1], ['d_hard', 2], ['d_diode1', 3], ['d_diode2', 4], ['d_linfold', 5],
      ['d_sinfold', 6], ['d_zerosq', 7], ['d_asym', 9], ['d_rectify', 10], ['d_sinesh', 13], ['d_stomp', 14], ['d_tape', 15],
      ['d_softsat', 17]];
    for (const [id, fx] of DIST) def(id, DOM.O, SP.ONE, NT.W0, MS.NONE, fx);
    const SRC6 = [['o1', MS.O1], ['o2', MS.O2], ['noise', MS.NOISE], ['sub', MS.SUB], ['f1', MS.F1], ['f2', MS.F2]];
    for (const [pre, dom, sp, self] of [['fm', DOM.F, SP.FM, 0], ['pd', DOM.P, SP.PD, 1], ['am', DOM.O, SP.ONE, 0],
      ['rm', DOM.O, SP.ONE, 0]]) {
      for (const [s, src] of SRC6) def(pre + '_' + s, dom, sp, NT.W0, src);
      if (self) def(pre + '_self', dom, sp, NT.W0, MS.SELF);
    }
    for (const id of ['s_comb', 's_gate', 's_harm', 's_subh', 's_spread', 's_smear', 's_detune', 's_pkoctu', 's_pkoctd',
      's_pkharmu', 's_pkharmd']) def(id, DOM.S, SP.NONE, NT.W0);
    def('s_shep', DOM.S, SP.NONE, NT.NEVER); def('s_shepn', DOM.S, SP.NONE, NT.NEVER);
    for (const [pre, s, src] of [['s_voc', 'o1', MS.O1], ['s_voc', 'o2', MS.O2], ['s_voc', 'noise', MS.NOISE],
      ['s_mask', 'o1', MS.O1], ['s_mask', 'o2', MS.O2], ['s_mask', 'noise', MS.NOISE]]) def(pre + '_' + s, DOM.S, SP.NONE, NT.W0, src);
    def('s_mirror', DOM.S, SP.NONE, NT.W0); def('s_pshift', DOM.S, SP.NONE, NT.WHALF); def('s_pblend', DOM.S, SP.NONE, NT.W0);
    def('s_shift', DOM.S, SP.NONE, NT.WHALF); def('s_twist', DOM.S, SP.NONE, NT.W0);
    if (IDS.length !== N) throw new Error('warp table has ' + IDS.length + ' entries');
    const META = Object.freeze({
      ids: Object.freeze(IDS),
      dom: Uint8Array.from(DOMS),
      avail: Uint8Array.from(DOMS, (d) => (d === DOM.S ? AV_SPEC : AV_ALL)),
      speed: Uint8Array.from(SPEEDS),
      neutral: Uint8Array.from(NEUTS),
      msrc: Uint8Array.from(SRCS),
      dist: Int8Array.from(DISTS),
    });
    // private copies (META's typed arrays are not frozen)
    const SPEED_K = Uint8Array.from(SPEEDS), DOM_K = Uint8Array.from(DOMS), NEUT_K = Uint8Array.from(NEUTS);
    const DIST_K = Int8Array.from(DISTS);
    const M_SYNC = 1, M_FLIP = 9, M_QUANT = 15, M_ODDEVEN = 16, M_LPF = 17, M_HPF = 18, M_STOMP = 30, M_PDSUB = 42,
      M_PDSELF = 45;

    /* ------------------------------------------------------------ helpers */
    const warned = new Set();
    function warnOnce(key, why) {
      if (warned.has(key)) return;
      warned.add(key);
      if (typeof console !== 'undefined') console.warn('sx-warp: ' + why);
    }
    const clamp01 = (x) => (x > 0 ? (x < 1 ? +x : 1) : 0);   // NaN → 0
    const isMode = (m) => typeof m === 'number' && m >= 0 && m < N && floor(m) === m;
    const isVec = (a, n) => a !== null && typeof a === 'object' && a.length >= n;

    /* ------------------------------------------------------------ fast math (Phase-1 serum-dsp verbatim, §0.2 tolerances) */
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
    // log2(x) for normal x > 0: exponent and the top 8 mantissa bits from the IEEE bits, then a cubic (|error| < 1e-10)
    const CVF = new Float64Array(1), CVI = new Int32Array(CVF.buffer);
    CVF[0] = 1;
    const HIW = CVI[1] === 0x3FF00000 ? 1 : 0;
    const LG_T = new Float64Array(256), LG_I = new Float64Array(256);
    const NE = new Float64Array(2048);                        // 2^(1023 − E): u·NE[E] = the mantissa of a normal u of biased exponent E
    for (let E = 0; E < 2048; E++) NE[E] = pow(2, 1023 - E);
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
    const SIN_N = 4096, SIN_T = new Float64Array(SIN_N + 1);
    for (let i = 0; i <= SIN_N; i++) SIN_T[i] = sin(2 * PI * i / SIN_N);
    function sin1(p) {
      p -= floor(p);
      const x = p * SIN_N, i = x | 0;
      return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (x - i);
    }
    const MAXPH = 1 - pow(2, -24);
    function remapG(R, rb, p) {
      const x = p * 2048;
      let i = x | 0;
      if (i > 2047) i = 2047; else if (i < 0) i = 0;
      const a = R[rb + i];
      return a + (x - i) * (R[rb + i + 1] - a);
    }

    /* ------------------------------------------------------------ speed (§3.4.1 speed column) */
    // P1 kind: the Phase-1 warpSetup speeds of the same transform (WARPS2 2–8, 10–14 = Phase-1 modes 4–10, 12–16)
    function speed(mode, w, fm) {
      if (!isMode(mode)) return 1;
      w = clamp01(w);
      switch (SPEED_K[mode]) {
        case SP.SYNC: return w === 0 ? 1 : pow(2, 4.4 * w);
        case SP.P1:
          switch (mode) {
            case 2: case 6: case 3: case 7: return w === 0 ? 1 : pow(2, 2.5 * w);         // Bend/Asym + (K), − (1/K)
            case 4: case 8: { if (w === 0.5) return 1; const K = pow(2, 2.5 * (2 * w - 1)); return K > 1 ? K : 1 / K; }
            case 5: return w === 0 ? 1 : 1 / (1 - 0.995 * w);                                 // PWM
            case 10: { const K = pow(2, 2.5 * (2 * w - 1)); return 2 * (K > 1 ? K : 1 / K); } // Mirror (never neutral)
            case 11: case 12: return w === 0 ? 1 : 2;                                         // Remap 1, 2
            case 13: return w === 0 ? 1 : 1 + 0.9 * w;                                        // Remap 3
            default: return w === 0 ? 1 : 4;                                                  // Remap 4
          }
        case SP.FM: return fm === FM.EXP ? pow(2, 4 * w) : 1 + 8 * w * w;
        case SP.PD: {
          const I = (mode === M_PDSUB ? 4 : mode === M_PDSELF ? 1.5 : 3) * w * sqrt(w);     // Sub 4·w^1.5, Self 1.5·w^1.5
          return 1 + 6.3 * I;
        }
        default: return 1;
      }
    }
    // speed(mode, w, fm) of a valid mode at w = clamp01(wa[i]), stored into sp[q] (chunk, per unison voice: a double
    // returned by — or passed to — a call that is not inlined is boxed, M4; the same arithmetic as speed)
    // (the amount is read here from the caller's array: a double argument of a call that is not inlined is boxed)
    function speedSet(sp, q, mode, wa, i, fm) {
      const w = clamp01(wa[i]);
      switch (SPEED_K[mode]) {
        case SP.SYNC: if (w === 0) sp[q] = 1; else sp[q] = pow(2, 4.4 * w); return;
        case SP.P1:
          switch (mode) {
            case 2: case 6: case 3: case 7: if (w === 0) sp[q] = 1; else sp[q] = pow(2, 2.5 * w); return;
            case 4: case 8: {
              if (w === 0.5) { sp[q] = 1; return; }
              const K = pow(2, 2.5 * (2 * w - 1));
              if (K > 1) sp[q] = K; else sp[q] = 1 / K;
              return;
            }
            case 5: if (w === 0) sp[q] = 1; else sp[q] = 1 / (1 - 0.995 * w); return;
            case 10: { const K = pow(2, 2.5 * (2 * w - 1)); if (K > 1) sp[q] = 2 * K; else sp[q] = 2 * (1 / K); return; }
            case 11: case 12: if (w === 0) sp[q] = 1; else sp[q] = 2; return;
            case 13: if (w === 0) sp[q] = 1; else sp[q] = 1 + 0.9 * w; return;
            default: if (w === 0) sp[q] = 1; else sp[q] = 4; return;
          }
        case SP.FM: if (fm === FM.EXP) sp[q] = pow(2, 4 * w); else sp[q] = 1 + 8 * w * w; return;
        case SP.PD: {
          const I = (mode === M_PDSUB ? 4 : mode === M_PDSELF ? 1.5 : 3) * w * sqrt(w);
          sp[q] = 1 + 6.3 * I;
          return;
        }
        default: sp[q] = 1;
      }
    }
    // exact-equality neutrality of mode at amount w, Var v (§3.4.1 last column, §0.7; Quantize: Phase-1 w < 1e-6)
    function neutral(mode, w, v) {
      switch (NEUT_K[mode]) {
        case NT.ALWAYS: return true;
        case NT.W0V0: return w === 0 && v === 0;
        case NT.W0: return mode === M_QUANT ? w < 1e-6 : w === 0;
        case NT.WHALF: return w === 0.5;
        default: return false;
      }
    }

    /* ------------------------------------------------------------ Slots (per oscillator per voice) */
    // per slot per unison voice: NCO coefficient doubles (SVF g/a1/a2/a3 + the f/w/fs/mode they were computed for) and
    // NST state doubles ([0, 4) the read sample x, [4, 8) the Odd/Even second read x2: SVF ic1/ic2, Stomp Box hx/hy/ly)
    const NCO = 8, NST = 8, X2S = 4;
    const TMP = 64;                                          // distortion scratch (samples per shapeBlock call)
    class Slots {
      constructor(maxUni = MAXUNI) {
        let U = +maxUni;
        if (!(U >= 1 && U <= MAXUNI && floor(U) === U)) {
          warnOnce('slots.maxUni', 'Slots(maxUni): maxUni must be an integer 1–' + MAXUNI + ' (got ' + maxUni + '); using ' + MAXUNI);
          U = MAXUNI;
        }
        this.brand = 'SxWarp.Slots';
        this.maxUni = U;
        this.mode = new Uint8Array(2);
        this.clr = new Uint8Array(2).fill(1);                // 1 while the slot's em/sp/pdI rows hold the Off values
        this.nuH = new Uint8Array(2);                         // per slot: voices ≥ nuH hold the Off values (chunk)
        this.fm = new Uint8Array(2);
        this.v = new Float64Array(2);
        this.hw = new Uint8Array(2);
        this.em = new Uint8Array(2 * U);
        this.sp = new Float64Array(2 * U).fill(1);
        this.pdI = new Float64Array(2 * U);
        this.co = new Float64Array(2 * U * NCO);              // per-voice coefficients (SVF g/a1/a2/a3, cache key)
        this.st = new Float64Array(2 * U * NST);              // per-voice states of x and x2 (SVF ic1/ic2, Stomp Box hx/hy/ly)
        this.fr = new Uint8Array(2 * U);                      // per-voice restart flags: 1 = x state, 2 = x2 state
        this.sk = new Float64Array(4);                        // Stomp Box filter coefficients per slot (hpA, lpK)
        this.tmp = new Float64Array(TMP);
        this.y1 = new Float64Array(U);
        // DC blocker of the distortion warps (RULINGS2 D3): per slot per voice [x₁, y₁] of x and of x2; R per slot;
        // dcOn 0 = no blocker (renderWarp2 removes the DC exactly)
        this.dc = new Float64Array(2 * U * 4);
        this.dcR = new Float64Array(2);
        this.dcOn = 1;
        // (M4 performance) chunk() cache: per slot the (mode, Var, FM type) the voices' em/sp/pdI rows were computed for
        // (cK 255: none), per slot voice the clamped amount (cw −1: none) — an unchanged voice keeps its rows (the same
        // values: no pow / neutrality test per voice per chunk)
        this.cK = new Uint8Array(2).fill(255);
        this.cV = new Float64Array(2);
        this.cF = new Uint8Array(2);
        this.cw = new Float64Array(2 * U).fill(-1);
        // the shared FX shapers (SxBase, §0.3), resolved lazily here and cached
        const B = globalThis.SxBase;
        if (B && typeof B.Shaper === 'function' && typeof B.shapeBlock === 'function') {
          this.sh0 = new B.Shaper(); this.sh1 = new B.Shaper(); this.sb = B.shapeBlock;
        } else { this.sh0 = null; this.sh1 = null; this.sb = null; }
        let bytes = 0;
        for (const a of [this.mode, this.clr, this.nuH, this.fm, this.v, this.hw, this.em, this.sp, this.pdI, this.co, this.st, this.fr,
          this.sk, this.tmp, this.y1, this.dc, this.dcR, this.cK, this.cV, this.cF, this.cw]) bytes += a.byteLength;
        this.bytes = bytes;
      }
      reset() {
        this.st.fill(0); this.y1.fill(0); this.fr.fill(3); this.dc.fill(0);
      }
    }
    const isSlots = (s) => s !== null && typeof s === 'object' && s.brand === 'SxWarp.Slots';

    /* ------------------------------------------------------------ per-chunk setup */
    function chunk(slots, k, mode, w, v, fm, fi, fs, nu = -1) {
      if (!isSlots(slots)) { warnOnce('chunk.slots', 'chunk: slots is not a SxWarp.Slots'); return 0; }
      if (k !== 0 && k !== 1) { warnOnce('chunk.k', 'chunk: slot index k must be 0 or 1'); return 0; }
      const U = slots.maxUni, b = k * U;
      const NU = nu >= 0 && nu <= U ? nu | 0 : U;
      let m = mode;
      if (!isMode(m)) { warnOnce('chunk.mode', 'chunk: mode must be an integer 0–' + (N - 1) + ' (slot acts as Off)'); m = 0; }
      if (m !== 0 && !(isVec(w, NU) && isVec(fi, NU))) {
        warnOnce('chunk.vec', 'chunk: w and fi must hold one value per unison voice (length ≥ ' + NU + '); slot acts as Off');
        m = 0;
      }
      if (m !== 0 && !(fs > 0 && fs < Infinity)) { warnOnce('chunk.fs', 'chunk: fs must be a finite rate > 0; slot acts as Off'); m = 0; }
      const vv = clamp01(v), fmk = fm === 1 || fm === 2 ? fm : 0;
      slots.mode[k] = m;
      slots.v[k] = vv;
      slots.fm[k] = fmk;
      slots.hw[k] = m === M_SYNC && vv > 0 ? 1 : 0;
      const em = slots.em, sp = slots.sp, pdI = slots.pdI;
      let act = m;
      if (m !== 0 && DIST_K[m] >= 0 && slots.sb === null) {
        warnOnce('chunk.shape', 'chunk: SxBase (the shared FX shapers) is not loaded; distortion warps act as Off');
        act = 0;
      }
      if (act === 0) {
        if (slots.clr[k] === 0) {                            // O(1) while the slot stays Off
          for (let i = 0; i < U; i++) { em[b + i] = 0; sp[b + i] = 1; pdI[b + i] = 0; }
          slots.clr[k] = 1; slots.nuH[k] = 0;
        }
        slots.cK[k] = 255;                                    // (the rows hold the Off values: the cache is void)
        return 0;
      }
      slots.clr[k] = 0;
      const co = slots.co, st = slots.st, filt = m === M_LPF || m === M_HPF;
      if (m === M_STOMP) { slots.sk[2 * k] = exp(-2 * PI * 720 / fs); slots.sk[2 * k + 1] = 1 - exp(-2 * PI * 6000 / fs); }
      if (DIST_K[m] >= 0) slots.dcR[k] = 1 - 2 * PI * 5 / fs;                 // the distortion warps' DC blocker
      // the voices whose amount, the slot's mode, Var and FM type are those of their rows keep them (M4 cache)
      const cw = slots.cw, same = slots.cK[k] === m && slots.cV[k] === vv && slots.cF[k] === fmk;
      slots.cK[k] = m; slots.cV[k] = vv; slots.cF[k] = fmk;
      let any = 0;
      for (let i = 0; i < NU; i++) {
        const wi = clamp01(w[i]), q = b + i, old = em[q];
        if (same && cw[q] === wi && !filt) { if (old !== 0) any = 1; continue; }
        cw[q] = wi;
        const e = neutral(m, wi, vv) ? 0 : m;
        em[q] = e;
        if (e === 0) { sp[q] = 1; pdI[q] = 0; continue; }
        any = 1;
        speedSet(sp, q, m, w, i, fmk);
        pdI[q] = m === M_PDSELF ? 1.5 * wi * sqrt(wi) : 0;
        if (old !== e) {
          const c = q * NST, dc = slots.dc, d = q * 4;
          for (let j = 0; j < NST; j++) st[c + j] = 0;
          dc[d] = 0; dc[d + 1] = 0; dc[d + 2] = 0; dc[d + 3] = 0;
          slots.fr[q] = 3;
        }
        if (filt) {
          let f = fi[i];
          f = f > 0 && f < Infinity ? +f : 8;
          const c = q * NCO;
          if (co[c + 4] !== f || co[c + 5] !== wi || co[c + 6] !== fs || co[c + 7] !== m) {   // pow/tan only on a change
            let fc = m === M_LPF ? f * pow(2, 10 * (1 - wi)) : f * pow(2, 10 * wi - 3);
            const hi = 0.45 * fs;
            fc = fc > 8 ? (fc < hi ? fc : hi) : 8;
            const g = tan(PI * fc / fs), a1 = 1 / (1 + g * (g + SQRT2));
            co[c] = g; co[c + 1] = a1; co[c + 2] = g * a1; co[c + 3] = g * g * a1;
            co[c + 4] = f; co[c + 5] = wi; co[c + 6] = fs; co[c + 7] = m;
          }
        }
      }
      // voices ≥ NU act as Off: only those an earlier chunk set (≥ nuH they already hold the Off values)
      const hiU = slots.nuH[k];
      for (let i = NU; i < hiU; i++) { em[b + i] = 0; sp[b + i] = 1; pdI[b + i] = 0; cw[b + i] = -1; }
      slots.nuH[k] = NU;
      return any ? m : 0;
    }

    /* ------------------------------------------------------------ block kernels (B18) */
    function copy(a, b, n) { if (b !== a) for (let s = 0; s < n; s++) b[s] = a[s]; }
    // the kernel acts only on what the last chunk() of slot k set up for voice i
    function live(slots, k, i, mode) {
      if (!isSlots(slots) || (k !== 0 && k !== 1) || !isMode(mode) || mode === 0) return false;
      const U = slots.maxUni;
      return i >= 0 && i < U && (i | 0) === i && slots.em[k * U + i] === mode;
    }
    const ZERO = new Float64Array(1);
    // modulator layout → (array, base, step): m[s·mStride + (col mod mStride)], mStride 0 = constant m[0], null = 0;
    // col = the caller's modulator column mc when given (an integer ≥ 0), else the Slots voice index i
    let mArr = ZERO, mB = 0, mS = 0;
    function modAt(m, mStride, i, n) {
      mArr = ZERO; mB = 0; mS = 0;
      if (m === null || m === undefined) return;
      if (typeof m !== 'object' || typeof m.length !== 'number') { warnOnce('mod', 'kernel: m must be an array of samples or null; read as 0'); return; }
      const ms = mStride > 0 ? floor(mStride) : 0;
      if (ms === 0) { if (m.length >= 1) { mArr = m; } return; }
      const base = i % ms;
      if (n > 0 && m.length < base + (n - 1) * ms + 1) { warnOnce('mod.len', 'kernel: m is shorter than its layout (s·mStride + i mod mStride); read as 0'); return; }
      mArr = m; mB = base; mS = ms;
    }

    const col = (mc, i) => (mc >= 0 && mc <= 0x7fffffff && floor(mc) === mc ? mc : i);   // undefined / invalid → i
    // [+] (M4) the kernels with the amount read from an array — wa[wi] — instead of a number argument: a caller rendering
    // per unison voice per chunk passes its amount array and the voice (a double argument of a call that is not inlined
    // is boxed: one heap number per voice, slot and chunk, V8). incBlock / phaseBlock / outBlock are these with a
    // one-value array
    const WARG = new Float64Array(1);
    function incBlock(slots, k, i, mode, fm, w, m, mStride, inc, out, n, mc = -1) {
      WARG[0] = w;
      return incBlockA(slots, k, i, mode, fm, WARG, 0, m, mStride, inc, out, n, mc);
    }
    function incBlockA(slots, k, i, mode, fm, wa, wi, m, mStride, inc, out, n, mc = -1) {
      if (DOM_K[mode] !== DOM.F || !live(slots, k, i, mode)) { copy(inc, out, n); return 0; }
      const w = clamp01(wa[wi]);
      modAt(m, mStride, col(mc, i), n);
      const M = mArr, mb = mB, ms = mS;
      if (fm === FM.EXP) {
        const b = 4 * w;
        for (let s = 0; s < n; s++) out[s] = inc[s] * exp2(b * M[mb + s * ms]);
      } else if (fm === FM.LIN) {
        const a = 8 * w * w;
        for (let s = 0; s < n; s++) { const g = 1 + a * M[mb + s * ms]; out[s] = inc[s] * (g > 0 ? g : 0); }
      } else {
        const a = 8 * w * w;
        for (let s = 0; s < n; s++) out[s] = inc[s] * (1 + a * M[mb + s * ms]);
      }
      return 1;
    }

    function phaseBlock(slots, k, i, mode, w, v, remapTab, rb, m, mStride, phIn, phOut, win, n, mc = -1) {
      WARG[0] = w;
      return phaseBlockA(slots, k, i, mode, WARG, 0, v, remapTab, rb, m, mStride, phIn, phOut, win, n, mc);
    }
    function phaseBlockA(slots, k, i, mode, wa, wi, v, remapTab, rb, m, mStride, phIn, phOut, win, n, mc = -1) {
      if (DOM_K[mode] !== DOM.P || !live(slots, k, i, mode)) { copy(phIn, phOut, n); return 0; }
      // PD (Self) is never applied by a kernel: every caller feeds it back per sample in its read loop (header)
      if (mode === M_PDSELF) { copy(phIn, phOut, n); return 0; }
      const w = clamp01(wa[wi]);
      if (mode >= 11 && mode <= 14 && !(remapTab !== null && typeof remapTab === 'object' && remapTab.length >= (rb | 0) + 2049 && rb >= 0)) {
        warnOnce('remap', 'phaseBlock: a remap mode needs remapTab with a 2049-value row at rb; acts as Off');
        copy(phIn, phOut, n);
        return 0;
      }
      // Sync window (from the input phase, before phOut may overwrite it)
      if (mode === M_SYNC && slots.hw[k] === 1 && win !== null && win !== undefined) {
        const vv = clamp01(v), mul = k === 1 && slots.hw[0] === 1;
        if (mul) for (let s = 0; s < n; s++) win[s] *= 1 - vv + vv * (0.5 - 0.5 * sin1(phIn[s] + 0.25));
        else for (let s = 0; s < n; s++) win[s] = 1 - vv + vv * (0.5 - 0.5 * sin1(phIn[s] + 0.25));
      }
      // one small kernel per mode (B18; M4: a per-sample helper such as powU is inlined into a small loop — inside the
      // whole switch it was not, and every call boxed its result: 60 % of a dense patch's allocation, V8)
      // (the kernel's coefficient travels in PKK[0]: no boxed argument)
      switch (mode) {
        case 1: PKK[0] = exp2(4.4 * w); pkSync(phIn, phOut, n); break;
        case 2: case 3: case 4:                                                      // Bend +, −, +/−
          PKK[0] = mode === 2 ? exp2(2.5 * w) : mode === 3 ? exp2(-2.5 * w) : exp2(2.5 * (2 * w - 1));
          pkBend(phIn, phOut, n);
          break;
        case 5: PKK[0] = 1 / (1 - 0.995 * w); pkClip(phIn, phOut, n); break;
        case 6: case 7: case 8:                                                      // Asym +, −, +/−
          PKK[0] = mode === 6 ? exp2(2.5 * w) : mode === 7 ? exp2(-2.5 * w) : exp2(2.5 * (2 * w - 1));
          pkAsym(phIn, phOut, n);
          break;
        case 10: PKK[0] = exp2(2.5 * (2 * w - 1)); pkMirror(phIn, phOut, n); break;       // Mirror
        case 11: PKK[0] = w; pkRemap1(phIn, phOut, n, remapTab, rb); break;
        case 12: PKK[0] = w; pkRemap2(phIn, phOut, n, remapTab, rb); break;
        case 13: PKK[0] = 0.9 * w / (2 * PI); pkSine(phIn, phOut, n); break;
        case 14: PKK[0] = w; pkRemap4(phIn, phOut, n, remapTab, rb); break;
        case 15: { const M = round(2048 * exp2(-10 * w)); PKK[0] = M > 2 ? M : 2; pkQuant(phIn, phOut, n); break; }   // Quantize
        default: {                                                                   // PD 39–44: frac(φ + I·m)
          PKK[0] = (mode === M_PDSUB ? 4 : 3) * w * sqrt(w);
          modAt(m, mStride, col(mc, i), n);
          pkPD(phIn, phOut, n, mArr, mB, mS);
          break;
        }
      }
      return 1;
    }
    // the coefficient of the P-stage kernels (phaseBlockA writes it, the kernel reads it)
    const PKK = new Float64Array(1);
    // u^K (K = PKK[0]) in place on U[0 … n): powU written out (exp2 ∘ log2, the same operations: bit-identical) — no
    // call per sample
    // (M4) the mantissa as u·2^−e (NE, exact for a normal u) instead of rewriting the exponent bits and reading the double
    // back: a 32-bit store into the double followed by a 64-bit load of it cannot be forwarded (a store-buffer stall per
    // sample). The same value, so the same bits as powU
    function powArr(U, n) {
      const K = PKK[0];
      for (let s = 0; s < n; s++) {
        const u = U[s];
        if (u < 1e-300) { U[s] = 0; continue; }
        CVF[0] = u;
        const hi = CVI[HIW], j = (hi >> 12) & 255;
        const r = u * NE[hi >> 20] * LG_I[j] - 1;
        let x = K * (((hi >> 20) - 1023) + LG_T[j] + r * (1.4426950408889634 - r * (0.7213475204444817 - r * 0.4808983469629878)));
        if (x < -79) { U[s] = 0; continue; }
        if (x > 79) x = 79;
        const y = x * 64, k = floor(y), g = (y - k) * 0.015625;
        U[s] = P2[(k >> 6) + 80] * E64[k & 63] * (1 + g * (0.6931471805599453 + g * (0.2402265069591007 + g * 0.05550410866482158)));
      }
    }
    const PWT = new Float64Array(MAXCH_W);                     // powArr scratch (one chunk)
    function pkSync(phIn, phOut, n) { const K = PKK[0]; for (let s = 0; s < n; s++) { const x = phIn[s] * K; phOut[s] = x - floor(x); } }
    // (M4) Bend in one pass: the u of each sample, powArr's operations on it and the output (the warp of every dense
    // wavetable patch; the same values as the three passes it replaces)
    function pkBend(phIn, phOut, n) {
      const K = PKK[0];
      if (n > MAXCH_W) { for (let s = 0; s < n; s++) { const ph = phIn[s]; phOut[s] = ph < 0.5 ? 0.5 * powU(2 * ph, K) : 1 - 0.5 * powU(2 - 2 * ph, K); } return; }
      for (let s = 0; s < n; s++) {
        const ph = phIn[s], lo = ph < 0.5, u = lo ? 2 * ph : 2 - 2 * ph;
        let p = 0;
        if (!(u < 1e-300)) {                                    // (NaN goes on, as in powArr)
          CVF[0] = u;
          const hi = CVI[HIW], j = (hi >> 12) & 255;
          const r = u * NE[hi >> 20] * LG_I[j] - 1;
          let x = K * (((hi >> 20) - 1023) + LG_T[j] + r * (1.4426950408889634 - r * (0.7213475204444817 - r * 0.4808983469629878)));
          if (!(x < -79)) {
            if (x > 79) x = 79;
            const y = x * 64, k = floor(y), g = (y - k) * 0.015625;
            p = P2[(k >> 6) + 80] * E64[k & 63] * (1 + g * (0.6931471805599453 + g * (0.2402265069591007 + g * 0.05550410866482158)));
          }
        }
        phOut[s] = lo ? 0.5 * p : 1 - 0.5 * p;
      }
    }
    function pkClip(phIn, phOut, n) { const K = PKK[0]; for (let s = 0; s < n; s++) { const x = phIn[s] * K; phOut[s] = x < MAXPH ? x : MAXPH; } }
    function pkAsym(phIn, phOut, n) {
      if (n > MAXCH_W) { const K = PKK[0]; for (let s = 0; s < n; s++) phOut[s] = powU(phIn[s], K); return; }
      const T = PWT;
      for (let s = 0; s < n; s++) T[s] = phIn[s];
      powArr(T, n);
      for (let s = 0; s < n; s++) phOut[s] = T[s];
    }
    function pkMirror(phIn, phOut, n) {
      if (n > MAXCH_W) { const K = PKK[0]; for (let s = 0; s < n; s++) { const ph = phIn[s]; phOut[s] = powU(ph < 0.5 ? 2 * ph : 2 - 2 * ph, K); } return; }
      const T = PWT;
      for (let s = 0; s < n; s++) { const ph = phIn[s]; T[s] = ph < 0.5 ? 2 * ph : 2 - 2 * ph; }
      powArr(T, n);
      for (let s = 0; s < n; s++) phOut[s] = T[s];
    }
    function pkRemap1(phIn, phOut, n, R, rb) { const w = PKK[0]; for (let s = 0; s < n; s++) { const ph = phIn[s]; phOut[s] = ph + w * (remapG(R, rb, ph) - ph); } }
    function pkRemap2(phIn, phOut, n, R, rb) {
      const w = PKK[0];
      for (let s = 0; s < n; s++) {
        const ph = phIn[s], q = ph < 0.5 ? 0.5 * remapG(R, rb, 2 * ph) : 1 - 0.5 * remapG(R, rb, 2 - 2 * ph);
        phOut[s] = ph + w * (q - ph);
      }
    }
    function pkSine(phIn, phOut, n) { const K = PKK[0]; for (let s = 0; s < n; s++) { const x = phIn[s] - K * sin1(phIn[s]); phOut[s] = x - floor(x); } }
    function pkRemap4(phIn, phOut, n, R, rb) {
      const w = PKK[0];
      for (let s = 0; s < n; s++) {
        const ph = phIn[s], x4 = 4 * ph, q = floor(x4), u = x4 - q;
        const up = (q & 1) ? 1 - remapG(R, rb, 1 - u) : remapG(R, rb, u);
        phOut[s] = ph + w * ((q + up) * 0.25 - ph);
      }
    }
    function pkQuant(phIn, phOut, n) { const K = PKK[0]; for (let s = 0; s < n; s++) phOut[s] = floor(phIn[s] * K) / K; }
    function pkPD(phIn, phOut, n, M, mb, ms) { const K = PKK[0]; for (let s = 0; s < n; s++) { const x = phIn[s] + K * M[mb + s * ms]; phOut[s] = x - floor(x); } }

    // TPT SVF (Q 0.7071) of one signal in place, state at st[z], st[z + 1]; LP or HP output
    function svfRun(co, c, st, z, x, n, lp) {
      const a1 = co[c + 1], a2 = co[c + 2], a3 = co[c + 3];
      let ic1 = st[z], ic2 = st[z + 1];
      if (lp) {
        for (let s = 0; s < n; s++) {
          const v3 = x[s] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          x[s] = v2;
        }
      } else {
        for (let s = 0; s < n; s++) {
          const xs = x[s], v3 = xs - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          x[s] = xs - SQRT2 * v1 - v2;
        }
      }
      st[z] = ic1 < 1e-30 && ic1 > -1e-30 ? 0 : ic1; st[z + 1] = ic2 < 1e-30 && ic2 > -1e-30 ? 0 : ic2;
    }
    // a set distortion shaper on one signal in place, blend bl; Stomp Box: HP → shaper → LP with the state at st[z…z+2]
    // rational tanh (Padé 7/6), clamped at ±4.97 (|error| ≤ 9.7e-5, monotonic, |y| ≤ 1): the distortion warps' tanh curves
    function ftanh(x) {
      if (x >= 4.97) return 1;
      if (x <= -4.97) return -1;
      const x2 = x * x;
      return x * (135135 + x2 * (17325 + x2 * (378 + x2))) / (135135 + x2 * (62370 + x2 * (3150 + 28 * x2)));
    }
    // SxBase.shapeBlock (sb) with ftanh for the tanh curves (FX modes 0 Tube, 9 Asym, 14 Stomp Box, 16 Soft Sat.; the
    // Shaper's coefficients as SxBase sets them), one monomorphic loop per mode (B18); every other curve is SxBase's
    function shapeW(sb, S, x, off, n) {
      const G = S.G, sa = S.a, sbb = S.b, e = off + n;
      switch (S.mode) {
        case 0: for (let i = off; i < e; i++) x[i] = ftanh(G * x[i] + sa) - sbb; break;
        case 9: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u >= 0 ? ftanh(1.2 * u) : ftanh(0.6 * u); } break;
        case 14: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = ftanh(1.5 * (u + 0.25 * u * u)) * (2 / 3); } break;
        case 16: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = sbb * (ftanh(1.8 * u) * sa); } break;
        default: sb(S, x, off, n); break;
      }
    }
    function distRun(slots, k, S, x, n, bl, stomp, z) {
      const sb = slots.sb, T = slots.tmp, st = slots.st;
      if (bl === 1 && !stomp) { shapeW(sb, S, x, 0, n); return; }                 // w ≥ 0.1: y = D(x), in place
      const hpA = slots.sk[2 * k], lpK = slots.sk[2 * k + 1];
      let hx = st[z], hy = st[z + 1], ly = st[z + 2];
      for (let o = 0; o < n; o += TMP) {
        const L = n - o < TMP ? n - o : TMP;
        if (stomp) for (let j = 0; j < L; j++) { const xs = x[o + j]; hy = hpA * (hy + xs - hx); hx = xs; T[j] = hy; }
        else for (let j = 0; j < L; j++) T[j] = x[o + j];
        shapeW(sb, S, T, 0, L);
        if (stomp) for (let j = 0; j < L; j++) { ly += lpK * (T[j] - ly); T[j] = ly; }
        if (bl === 1) for (let j = 0; j < L; j++) x[o + j] = T[j];
        else for (let j = 0; j < L; j++) { const xs = x[o + j]; x[o + j] = xs + (T[j] - xs) * bl; }
      }
      if (stomp) {
        st[z] = hx; st[z + 1] = hy < 1e-30 && hy > -1e-30 ? 0 : hy; st[z + 2] = ly < 1e-30 && ly > -1e-30 ? 0 : ly;
      }
    }
    // the distortion warps' 5 Hz DC blocker on one signal in place, state [x₁, y₁] at D[j], D[j + 1] (RULINGS2 D3)
    function dcRun(D, j, R, x, n) {
      let x1 = D[j], y1 = D[j + 1];
      for (let s = 0; s < n; s++) { const xs = x[s], y = xs - x1 + R * y1; x1 = xs; y1 = y; x[s] = y; }
      D[j] = x1; D[j + 1] = y1 < 1e-30 && y1 > -1e-30 ? 0 : y1;
    }
    let oeWarned = false;
    function outBlock(slots, k, i, mode, w, v, m, mStride, x, x2, ph, n, mc = -1) {
      WARG[0] = w;
      return outBlockA(slots, k, i, mode, WARG, 0, v, m, mStride, x, x2, ph, n, mc);
    }
    function outBlockA(slots, k, i, mode, wa, wi, v, m, mStride, x, x2, ph, n, mc = -1) {
      if (DOM_K[mode] !== DOM.O || !live(slots, k, i, mode)) return 0;
      const w = clamp01(wa[wi]);
      const U = slots.maxUni, q = k * U + i, fr = slots.fr;
      // slot 1's O stage also processes the Odd/Even second read when slot 2 of this voice is Odd/Even, so that slot 2
      // separates the harmonics of O₁(x) (x2 = the same chain half a cycle later); x2 states restart when resumed
      const oe1 = k === 0 && slots.em[U + i] === M_ODDEVEN, two = oe1 && x2 !== null && x2 !== undefined;
      if (oe1 && !two && !oeWarned) {
        oeWarned = true;
        warnOnce('out.x2', 'outBlock: slot 2 is Odd/Even but slot 1\'s outBlock got no x2 — pass the second read to BOTH slots ' +
          'whenever either is Odd/Even, else slot 2 separates the raw read (even harmonics of O₁(x) leak through)');
      }
      const f0 = k === 0 && !two ? fr[q] | 2 : fr[q];
      fr[q] = two ? 0 : f0 & 2;                                                       // restart flags consumed here
      if (mode === M_FLIP) {
        if (ph === null || ph === undefined) return 0;
        for (let s = 0; s < n; s++) if (!(ph[s] < w)) x[s] = -x[s];                 // Phase-1: y·(φ < w ? 1 : −1)
        if (two) for (let s = 0; s < n; s++) { let p = ph[s] + 0.5; if (p >= 1) p -= 1; if (!(p < w)) x2[s] = -x2[s]; }
        return 1;
      }
      if (mode === M_ODDEVEN) {
        if (x2 === null || x2 === undefined) return 0;
        if (w < 0.5) {
          const a = 2 * w;
          if (two) for (let s = 0; s < n; s++) { const xs = x[s], ys = x2[s], xo = (xs - ys) * 0.5; x[s] = xo + (xs - xo) * a; x2[s] = (ys + xo) * a - xo; }
          else for (let s = 0; s < n; s++) { const xs = x[s], xo = (xs - x2[s]) * 0.5; x[s] = xo + (xs - xo) * a; }
        } else {
          const a = 2 * w - 1;
          if (two) for (let s = 0; s < n; s++) { const xs = x[s], ys = x2[s], xe = (xs + ys) * 0.5; x[s] = xs + (xe - xs) * a; x2[s] = ys + (xe - ys) * a; }
          else for (let s = 0; s < n; s++) { const xs = x[s], xe = (xs + x2[s]) * 0.5; x[s] = xs + (xe - xs) * a; }
        }
        return 1;
      }
      if (mode === M_LPF || mode === M_HPF) {
        const co = slots.co, st = slots.st, c = q * NCO, z = q * NST, lp = mode === M_LPF;
        // a voice entering LPF starts from the DC steady state of its first input (no step from the dry Off output);
        // HPF starts from zero (its output then starts at ≈ x)
        if (lp && (f0 & 1) !== 0 && n > 0) { st[z] = 0; st[z + 1] = x[0]; }
        svfRun(co, c, st, z, x, n, lp);
        if (two) {
          if ((f0 & 2) !== 0) { st[z + X2S] = 0; st[z + X2S + 1] = lp && n > 0 ? x2[0] : 0; }
          svfRun(co, c, st, z + X2S, x2, n, lp);
        }
        return 1;
      }
      if (mode >= 46) {                                                               // AM 46–51, RM 52–57
        modAt(m, mStride, col(mc, i), n);
        const M = mArr, mb = mB, ms = mS;
        if (mode <= 51) {
          for (let s = 0; s < n; s++) x[s] *= 1 - w + w * (0.5 + 0.5 * M[mb + s * ms]);
          if (two) for (let s = 0; s < n; s++) x2[s] *= 1 - w + w * (0.5 + 0.5 * M[mb + s * ms]);
        } else {
          for (let s = 0; s < n; s++) x[s] *= 1 - w + w * M[mb + s * ms];
          if (two) for (let s = 0; s < n; s++) x2[s] *= 1 - w + w * M[mb + s * ms];
        }
        return 1;
      }
      // distortions 19–32: y = x + (D(x) − x)·min(1, 10w), D = SxBase's FX shaper at drive w (set only on a change)
      const S = k === 0 ? slots.sh0 : slots.sh1;
      if (S === null || slots.sb === null) return 0;
      const dm = DIST_K[mode];
      if (S.mode !== dm || S.d !== w) S.set(dm, w);
      const bl = 10 * w < 1 ? 10 * w : 1, stomp = mode === M_STOMP, z = q * NST, dcOn = slots.dcOn === 1, R = slots.dcR[k];
      distRun(slots, k, S, x, n, bl, stomp, z);
      if (dcOn) dcRun(slots.dc, q * 4, R, x, n);
      if (two) {
        if ((f0 & 2) !== 0) {
          if (stomp) { const st = slots.st; st[z + X2S] = 0; st[z + X2S + 1] = 0; st[z + X2S + 2] = 0; }
          slots.dc[q * 4 + 2] = 0; slots.dc[q * 4 + 3] = 0;
        }
        distRun(slots, k, S, x2, n, bl, stomp, z + X2S);
        if (dcOn) dcRun(slots.dc, q * 4 + 2, R, x2, n);
      }
      return 1;
    }

    // [+] PD offsets for callers whose read position is not a cycle phase (§6.6.4 sample types, §6.10.7 Spectral):
    // out[s] = I·m(s) (I = 3w^1.5, Sub 4w^1.5) for PD 39–44 — the unwrapped offset in periods; 0 (and returns 0) otherwise
    function pdBlock(slots, k, i, mode, w, m, mStride, out, n, mc = -1) {
      if (!(mode >= 39 && mode <= 44) || !live(slots, k, i, mode)) { for (let s = 0; s < n; s++) out[s] = 0; return 0; }
      w = clamp01(w);
      const K = (mode === M_PDSUB ? 4 : 3) * w * sqrt(w);
      modAt(m, mStride, col(mc, i), n);
      const M = mArr, mb = mB, ms = mS;
      for (let s = 0; s < n; s++) out[s] = K * M[mb + s * ms];
      return 1;
    }

    /* ------------------------------------------------------------ renderWarp2 (§6.6.9, main thread) */
    // 4-point cubic Hermite (Catmull-Rom) read with wrap — the Phase-1 serum-dsp `herm`
    function herm(buf, mask, pos) {
      const i = floor(pos), f = pos - i;
      const xm = buf[(i - 1) & mask], x0 = buf[i & mask], x1 = buf[(i + 1) & mask], x2 = buf[(i + 2) & mask];
      const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
      return ((c3 * f + c2) * f + c1) * f + x0;
    }
    const IDREMAP = new Float32Array(2049);
    for (let j = 0; j <= 2048; j++) IDREMAP[j] = j / 2048;
    function checkArgs(frame, slots, opts, who) {
      if (!isVec(frame, 2048)) throw new TypeError(who + ': frame must be array-like with ≥ 2048 values');
      if (slots !== undefined && slots !== null && !Array.isArray(slots)) throw new TypeError(who + ': slots must be an array');
      const S = slots || [];
      if (S.length > 2) throw new TypeError(who + ': at most 2 slots');
      for (let k = 0; k < S.length; k++) {
        const e = S[k];
        if (e !== undefined && e !== null && typeof e !== 'object') throw new TypeError(who + ': slot ' + k + ' must be an object or null');
      }
      if (opts !== undefined && opts !== null && typeof opts !== 'object') throw new TypeError(who + ': opts must be an object');
      const o = opts || {};
      if (o.remap !== undefined && o.remap !== null && !isVec(o.remap, 2049)) throw new TypeError(who + ': opts.remap must hold ≥ 2049 values');
      if (o.mod !== undefined && o.mod !== null && !isVec(o.mod, 2048)) throw new TypeError(who + ': opts.mod must hold ≥ 2048 values');
      return [S, o];
    }
    // a slot entry → {mode, w, v, fm} with the lenient clamping of renderWarp2 (spectral-only modes → Off)
    function normSlot(e) {
      const r = { mode: 0, w: 0, v: 0, fm: 0 };
      if (e === null || e === undefined) return r;
      const m = +e.mode;
      r.mode = isMode(m) && DOM_K[m] !== DOM.S ? m : 0;
      r.w = clamp01(e.w); r.v = clamp01(e.v);
      r.fm = e.fm === 1 || e.fm === 2 ? e.fm : 0;
      return r;
    }
    function renderWarp2(frame, slots, opts) {
      const [S, o] = checkArgs(frame, slots, opts, 'renderWarp2');
      const over = o.over > 1 ? o.over | 0 : 1, n = 2048 * over, out = new Float32Array(n);
      const R = o.remap !== undefined && o.remap !== null ? o.remap : IDREMAP;
      const mod = o.mod !== undefined && o.mod !== null ? o.mod : null;
      const hz = o.hz > 0 && o.hz < Infinity ? +o.hz : 220, fs = hz * n;
      const a = normSlot(S[0]), b = normSlot(S[1]);
      const sl = new Slots(1), W0 = new Float64Array(1), W1 = new Float64Array(1), FI = new Float64Array(1);
      sl.dcOn = 0;                                             // the distortion slots' DC: removed exactly (below)
      W0[0] = a.w; W1[0] = b.w; FI[0] = hz;
      const e0 = chunk(sl, 0, a.mode, W0, a.v, a.fm, FI, fs), e1 = chunk(sl, 1, b.mode, W1, b.v, b.fm, FI, fs);
      const fmAny = DOM_K[e0] === DOM.F || DOM_K[e1] === DOM.F;
      const stateful = (e) => e === M_LPF || e === M_HPF || e === M_STOMP || e === M_PDSELF;
      const warm = stateful(e0) || stateful(e1) ? 8 : 0, total = (warm + 1) * n, skip = warm * n;
      const oe = e0 === M_ODDEVEN || e1 === M_ODDEVEN, hw = sl.hw[0] | sl.hw[1];
      // PD (Self): per sample in the read loop, after the P stages (phaseBlock passes mode 45 through)
      const I = (e0 === M_PDSELF ? sl.pdI[0] : 0) + (e1 === M_PDSELF ? sl.pdI[1] : 0);
      const B = 32, INC = new Float64Array(B), MB = new Float64Array(B), PH = new Float64Array(B), P2B = new Float64Array(B);
      const WIN = new Float64Array(B), X = new Float64Array(B), X2 = new Float64Array(B);
      // one pass over warm + 1 cycles; mu0 / mu1: subtracted after slot 1's / slot 2's O stage (the DC of a distortion
      // slot); returns the sums of X after each slot's O stage (before the subtraction) over the returned cycle
      const sum = new Float64Array(2);
      const pass = (mu0, mu1, rec) => {
      let ph = 0, y1 = 0;
      sum[0] = 0; sum[1] = 0;
      sl.reset();
      for (let j0 = 0; j0 < total; j0 += B) {
        const L = total - j0 < B ? total - j0 : B;
        for (let s = 0; s < L; s++) {
          const jj = (j0 + s) % n;
          INC[s] = 1 / n;
          MB[s] = mod !== null ? herm(mod, 2047, (jj / n) * 2048) : 0;
        }
        // stage 1: F slots
        incBlock(sl, 0, 0, a.mode, a.fm, a.w, MB, 1, INC, INC, L);
        incBlock(sl, 1, 0, b.mode, b.fm, b.w, MB, 1, INC, INC, L);
        // stage 2: accumulator (exact j/n when no F slot is active: bit-identical to Phase-1 renderWarp)
        for (let s = 0; s < L; s++) {
          if (fmAny) { PH[s] = ph; ph += INC[s]; ph -= floor(ph); }
          else PH[s] = ((j0 + s) % n) / n;
        }
        // stage 3: P slots
        phaseBlock(sl, 0, 0, a.mode, a.w, a.v, R, 0, MB, 1, PH, P2B, WIN, L);
        phaseBlock(sl, 1, 0, b.mode, b.w, b.v, R, 0, MB, 1, P2B, P2B, WIN, L);
        // stage 4: read (PD (Self): φ_r = frac(φ₂ + I·y₁), y₁ = the previous read sample)
        if (I !== 0) {
          for (let s = 0; s < L; s++) {
            let p = P2B[s] + I * y1;
            p -= floor(p);
            P2B[s] = p;
            const y = herm(frame, 2047, p * 2048);
            X[s] = y; y1 = y;
            if (oe) X2[s] = herm(frame, 2047, (p + 0.5) * 2048);
          }
        } else {
          for (let s = 0; s < L; s++) {
            const p = P2B[s];
            X[s] = herm(frame, 2047, p * 2048);
            if (oe) X2[s] = herm(frame, 2047, (p + 0.5) * 2048);
          }
        }
        // stage 5: Sync window, then O slots (slot 1's O stage also runs on X2 when slot 2 is Odd/Even)
        if (hw) for (let s = 0; s < L; s++) { X[s] *= WIN[s]; X2[s] *= WIN[s]; }
        const tail = j0 + L > skip;
        outBlock(sl, 0, 0, a.mode, a.w, a.v, MB, 1, X, oe ? X2 : null, PH, L);
        if (dist0) {
          if (tail) for (let s = 0; s < L; s++) if (j0 + s >= skip) sum[0] += X[s];
          if (mu0 !== 0) { for (let s = 0; s < L; s++) X[s] -= mu0; if (oe) for (let s = 0; s < L; s++) X2[s] -= mu0; }
        }
        outBlock(sl, 1, 0, b.mode, b.w, b.v, MB, 1, X, oe ? X2 : null, PH, L);
        if (dist1) {
          if (tail) for (let s = 0; s < L; s++) if (j0 + s >= skip) sum[1] += X[s];
          if (mu1 !== 0) { for (let s = 0; s < L; s++) X[s] -= mu1; if (oe) for (let s = 0; s < L; s++) X2[s] -= mu1; }
        }
        if (rec) for (let s = 0; s < L; s++) { const j = j0 + s - skip; if (j >= 0) out[j] = X[s]; }
      }
      };
      // the distortion slots' DC (their blocker's ideal steady state): slot 1's mean measured first, then slot 2's on the
      // corrected chain; without distortion slots one pass (bit-identical to the renderer before the blocker)
      const dist0 = DIST_K[e0] >= 0, dist1 = DIST_K[e1] >= 0;
      let mu0 = 0, mu1 = 0;
      if (dist0) { pass(0, 0, false); mu0 = sum[0] / n; }
      if (dist1) { pass(mu0, 0, false); mu1 = sum[1] / n; }
      pass(mu0, mu1, true);
      return out;
    }
    function renderSweep(frame, slots, opts) {
      const [S, o] = checkArgs(frame, slots, opts, 'renderSweep');
      const a = normSlot(S[0]), b = normSlot(S[1]);
      if (a.mode === 0 && b.mode === 0) return null;
      const F = o.frames >= 1 ? floor(o.frames) : 256, over = o.over > 1 ? o.over | 0 : 1, n = 2048 * over;
      const out = new Float32Array(F * n), sw = a.mode !== 0 ? 0 : 1;
      for (let f = 0; f < F; f++) {
        const w = F > 1 ? f / (F - 1) : 0;
        const sl = sw === 0 ? [{ mode: a.mode, w, v: a.v, fm: a.fm }, b] : [null, { mode: b.mode, w, v: b.v, fm: b.fm }];
        out.set(renderWarp2(frame, sl, o), f * n);
      }
      return out;
    }

    globalThis.SxWarp = Object.freeze({
      VER, N, MAXUNI, DOM, SP, NT, MS, FM, META,
      speed, Slots, chunk, incBlock, phaseBlock, outBlock, pdBlock, renderWarp2, renderSweep, incBlockA, phaseBlockA, outBlockA,
    });
  } catch (err) {
    globalThis.SxWarp = null;                                  // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-warp: load failed', err);
  }
})();
