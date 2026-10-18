/*
 * sx-mod.js — Serum modulation engine (classic script, no imports/exports; owner D2).
 * Contract: SPEC-serum2 §11.6 (exports, the D1/D2 boundary), §5 (modulation semantics), §6.1 steps 1–3, §6.2 (note-on),
 * §6.14 (envelopes), §6.15 (LFOs), §6.16 (Voice Control), §6.17 (MPE), §6.18 (tuned NOTE/portamento), §0.7 (neutral
 * terms); Phase-1 SPEC-serum §5, §6.1, §6.10, §6.12, §6.13 (+ RULINGS) for everything this file took over from serum-dsp.
 *
 * Script #4 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests). Publishes the frozen `globalThis.SxMod`; can be evaluated again in the same scope; a failure inside
 * leaves SxMod = null without throwing (then Serum tracks are silent, §0.3). Reads `SxBase` lazily (attach): LAW_TAB2.cont
 * (which voice-vector slots are smoothed) and SRC_POL2 (native source polarity when a CP carries no srcBi).
 *
 * M1a moved the Phase-1 modulation code here VERBATIM; M2 (this version) completes the v2 modulation system:
 *   ENV 1–4 (ENV 4 = the ENV 2 code), Start/End levels of ENV 2–4, MS/BPM units (ENV_LADDER), Legato Inverted, Voice
 *   Steal Retrigger, time scaling by Voice Control (envS × eff vc.escale);
 *   LFO 1–10 with MODE × MONO (§6.15.1: per-voice RETRIG/ENVELOPE = Phase-1 Trig/Env; processor FREE = Phase-1 Off; per-voice
 *   FREE on the processor clock plus the voice's own PHASE; processor RETRIG/ENVELOPE restarted by every note-on, legato
 *   and poly-legato ones included), HOST (BPM: Phase-1 Anchor, also for mono LFOs; Hz: song-clock anchoring while the
 *   transport plays, S2 mode only), PHASE, DIRECTION (fwd/rev/ping-pong), ×10, swing (kbd.swing pair geometry, §7.2, on
 *   RETRIG, ENVELOPE and FREE; anchored restarts align the pair geometry to the restart), VC LFO scaling (% or snapped to
 *   VC_RATES), types Normal / Path (X and Y outputs) / Chaos Lorenz / Chaos Rossler (≤ 4 RK2 sub-steps per chunk) / S&H;
 *   macros 1–8 incl. macros as destinations (mono context, §5.6), clip-lane overrides (proc.seqMacro) and MPE → macro maps;
 *   the 64-row matrix v2 (editable curves from CT.crv, aux curve, RISE/FALL slew per voice / per processor, randd per slot);
 *   every new source: env4, lfo9/10, lfoNy, macro5–8, randd, the audio taps (written by the voice), actv, vidx, vmod1/2,
 *   MPE X/Y/Z per voice (member channel or a generated note's expression), mpeWheelY;
 *   Voice Control per-note values (§6.2), tuned NOTE source and portamento (§6.18, `use & 512`).
 * Matrix slots: CP rows are compacted (§4.1); randd draws, slew states and the snapshot's mOut are kept per matrix SLOT
 * (0–63), read from the CP field `mSlot` (Uint8Array(64): slot of compacted row r, emitted by compileSerum; beyond the
 * §4.1 table); a CP without it falls back to the compacted index r (exact while no inactive slot precedes an active row).
 * Every Phase-2 term is skipped (never computed) at its neutral value (§0.7): v1 states — and any state whose new terms
 * are neutral — run the Phase-1 instruction sequence (the Phase-1 functions below are kept verbatim as fast paths).
 *
 * API (§11.6; [+] = beyond the §11.6 list):
 *   VER 1 · NSV 429 · NSRC 62 · NROW 64 · MAXCH 32 · MAXFX 1160 · DEF_CT (the built-in CT v2 fields this file reads)
 *   attach(sx, proc) → sx.mod (per-processor state, idempotent; null when SxBase is missing)
 *   [+] sync(proc, sx, cp)          copy the modulation fields of a new CP (once per CP object)
 *   [+] syncCT(proc, sx, ct, gen)   adopt a full CT; gen changes when the same CT object was rewritten in place
 *   begin(proc, sx, nCh)            §11.6 order: base smoothing over 429 vi, mono context, performance smoothers, macros
 *                                   (clip lanes, MPE maps, macro destinations), processor LFOs, mono chaos, global sources
 *   idle(proc, sx, n)               begin() over n base frames in spans of ≤ 128 (CP/CT synced by the caller)
 *   transport(proc, sx, playing)    play-with-seek: processor LFO phases/states, beat clock, mono chaos, processor Phase-2
 *                                   stream, proc.vcN = 0, recent voice, mono source vector, Hz-HOST re-anchoring,
 *                                   proc.seqMacro / proc.mpe re-resolved
 *   reset(sx[, proc])               back to the attach state (§11.6 signature; without proc the current rates are kept)
 *   fxMods(proc, sx) → Float64Array(MAXFX)   offsets in FX-context order (§4.2, §5.5), reused
 *   [+] snap(proc, sx, s)           modulation part of the snapshot (§6.20): eff, LFO/env monitors, mOut (when s has it)
 *   class ModV(voice): noteOn(n, vel01, legato, polyRef, ch, ex, other), noteOff(rv), kill(), [+] follow(fr), sources(gc),
 *     matrix(fr), advance(gc), envVal(e), lfoVal(l), [+] post(), [+] stop(), [+] setDt(dt, changed), [+] rnd2(),
 *     [+] envsIdle() (§6.19 rule b: every envelope has finished its release — stage 0, whatever End level it holds, inv
 *     B13 "terminates after the longest release"; all four, ENV 4 included),
 *     fields eff (429), off, src (62), eV/eSt/eT/eQ/eV0/eVR/eOn (4), lPh/lVal/lY/lSm/lSmY/lCy/lRp/… (10), ch/cOut/cHold/cTim
 *     (S1 chaos), vVelo, vNote, vR1, vR2, vAlt, patS, relvel, nP/gS/gTg/gQ (portamento; nP is the TUNED gliding pitch
 *     when `use & 512`: serum-dsp must not apply CP.tune again), tau, rd (64, randd per matrix slot), slew (64),
 *     Voice Control: vcOn (0/1 for this note), vc = Float64Array(4) [panO (bipolar pan units), detO (cents), cutO (cutoff
 *     n offset, both filters), envS (envelope time multiplier)] — neutral [0, 0, 0, 1]; vIdx, vM1, vM2;
 *     MPE: mpeCh (member channel 2–16 or 0), xpOn (expression active), mpeSt (per-note bend in semitones = smoothed
 *     bend·CP.mpeBend; 0 without a member channel). `ex` (noteOn) = the expression of a generated note as stored in clips
 *     (§2.4.2): x, y, z ∈ [0, 1], x neutral 0.5 → mpex = 2x − 1, mpey = y, mpez = z; null = the note carries no
 *     expression (X/Y/Z = 0, §6.17). Callers pass ex only for notes that carry expression (clip / arp expression lanes).
 *     MPE → macro maps (§6.17) are per voice for every voice, a voice without expression maps its zero expression
 *     ((0 + 1)/2 for X, 0 for Y/Z); the mono context maps the recent voice's.
 * sx.mod fields read by serum-dsp: monoEff, monoOff, fxOff, recent, beatC, macro (= the smoothed macro sources), act,
 *   g (aliased as sx.g, the global source table [src·32 + c]), mN/mDst/mAmt/mCtx (filter-type preallocation), lastPitch.
 *
 * Voice fields read here (owned by serum-dsp's SerumVoice): proc, i, dt (via setDt), gate, note, active, played (snap), onN, nLast,
 * rnd() (Phase-1 stream r), r2 / rnd2() (the Phase-2 stream, §6.2: ModV.rnd2() calls voice.rnd2 when it exists, else
 * steps voice.r2 with the same xorshift mapping as rnd()). Processor fields read: voices, held, bpm, songBeat(), wheel,
 * at, bendRaw, pat, patSeen, mpe (Float64Array(17·4), §6.17), seqMacro (Float64Array(8), NaN = no lane; written by
 * SxSeq), p.seq.kbd (swing) — mpe and seqMacro are resolved once per CP in sync() and again by transport() (the engine
 * creates both arrays once; an absent seqMacro means no clip lanes) —, vcN (created by attach when absent, read and incremented at note-ons, §6.2;
 * reset by transport). The voice writes the audio-tap sources
 * src[52…57] after each chunk (§11.6); ModV zeroes them at a fresh note-on and never computes them.
 *
 * Phase-2 draws (r2 stream, normative order inside ModV.noteOn, non-legato note-ons only, before serum-dsp's own r2
 * draws): (1) randd — only when a row has mRd: one draw per matrix slot 0–63 in slot order; (2) Voice Control u₁…u₄ —
 * only when `use & 1024`; (3) per-voice LFOs l = 0…9 that restart (RETRIG/ENVELOPE, and FREE per voice) without a
 * poly-legato reference: S&H one draw, Chaos three draws. S&H LFOs draw again at every cycle change: per-voice FREE ones
 * at the start of sources() (unconditionally, before any use/monitor test), RETRIG/ENVELOPE ones in advance().
 * Processor LFOs (MONO) draw from a processor stream (`r2p`), reseeded by transport/reset (never sx.rng); a processor
 * FREE S&H LFO draws at every cycle change whether or not anything reads it. No draw and no state integration depends on
 * the monitor (sx.mon): the snapshot only reads (live = bounce, §0.4).
 *
 * Note-on order (§6.2, IMPL): draws → note-on sources that do not depend on the restarts → PRE-RESTART PASS: the
 * voice-context rows into the slots the restarts read (lN.phase, eN.start, vc.pan/det/cut/env, and lN.rate + vc.lscale
 * of per-voice Hz-HOST LFOs) are evaluated with the note's sources, envelope and LFO sources at their values before the
 * restart (a fresh voice: 0 for its own envelopes and per-voice LFOs) → Voice Control offsets → envelope and LFO
 * restarts from those eff values → note-on evaluation of the mOn rows (Phase 1). A stolen voice never reuses the previous
 * note's eff for these slots. Legato note-ons run the pass before Legato Inverted restarts.
 *
 * Bypass of `use & 2048` (§4.1, §14.1; LFO 9/10 and ENV 4 read by no row): the per-voice LFO 9/10 advance only on the
 * most recent voice (they feed the monitor; deterministic, independent of sx.mon). ENV 4 runs on every voice (one
 * envelope tick per chunk) and always takes part in lifetime rule (b) (§6.19: all four envelopes).
 *
 * Song position at a note-on: the engine applies a transport start / loop wrap and fires that frame's note-ons before the
 * span's begin, so note-ons read proc.songBeat() themselves (notePos). Hz HOST (RETRIG/ENVELOPE, per voice and MONO)
 * starts at frac(start + songSeconds·rateHz) of the note; BPM HOST anchors at the note's song beat — MONO always, per
 * voice in S2 mode (S1 mode keeps the Phase-1 beat clock, which still holds the loop end right after a loop wrap).
 *
 * HOST in Hz (FREE LFOs, S2 mode, transport playing; IMPL refinement of §6.15.1 pending the lead): the phase is set to
 * φ = frac(start + songSeconds·rateHz) at transport start/seek, at song-position discontinuities (loop wraps) and when an
 * LFO becomes Hz-HOST, and integrates the (modulated) rate in between — identical to the closed form at a constant rate,
 * no phase racing when the rate moves (the closed form's phase velocity carries a songSeconds·d(rate)/dt term).
 * The same rule for the LFO scale on BPM + HOST LFOs (IMPL, pending the lead): their Phase-1 closed forms multiply the
 * whole elapsed time by the scale, so a scale change re-bases the anchor (per voice lB0, MONO P.lB0, FREE song offset
 * fB0) to keep the phase continuous — exact closed form while the scale is constant; FREE LFOs re-lock to the song at
 * play / seek / loop wrap (fB0 = 0). At scale 1 throughout (every v1 state) nothing is re-based.
 *
 * PHASE on FREE LFOs shifts phase and cycle together (Ping Pong turns and S&H draws where the read position wraps).
 * Ping Pong on ENVELOPE loop passes mirrors inside the loop region (readPos; IMPL for a spec gap, pending the lead).
 * vc.escale is sampled at note-on (§6.16) with envS; MONO RETRIG/ENVELOPE restarts keep the SMOOTH state (the shared
 * value glides). Hidden warm-up voices (voice.hid > 0) touch no processor state in noteOn.
 *
 * Hot paths (begin, ModV.follow/sources/matrix/advance/noteOn, fxMods, snap) never allocate.
 */
(function () {
  'use strict';
  try {
    // Math functions as locals (vm-context global lookups are slow); typed-array constructors stay global lookups on
    // purpose (used only at load and in attach / ModV constructors; the allocation-free tests replace them).
    const exp = Math.exp, floor = Math.floor, ceil = Math.ceil, round = Math.round, mlog2 = Math.log2, pow = Math.pow;

    const VER = 1;
    const NSV = 429, NSRC = 62, NROW = 64, MAXCH = 32, MAX_PTS = 480, MAXFX = 8 + 48 * 24;
    const N_LFO = 10, N_ENV = 4, N_MACRO = 8, LFO_ALL = (1 << N_LFO) - 1;
    const SKIP_MAX = 4096;                                      // owed chunks a skipped LFO replays exactly (advance)
    const CURVE_K = 10, ENV_K = 10, PORTA_K = 6;
    const LFO_N = 1024, CURVE_N = 128, CRV_N = 128;

    /* ------------------------------------------------------------ indices (vi, §3.11.1; vi = idx − 100 from idx 248) */
    const L1_RATE = 63, C1_RATE = 95, G_PORTA = 97, G_CURVE = 98, BUS1 = 103, C1_BPM = 144, G_WHEEL = 146, G_BEND = 147;
    const L1_PHASE = 379, M1 = 389, VC_PAN = 397, VC_DET = 398, VC_CUT = 399, VC_ENV = 400, VC_ESCALE = 401, VC_LSCALE = 402;
    // envelopes: first time slot (att, hold, dec, sus, rel), first curve slot (ca, cd, cr), Start / End (ENV 2–4)
    const EB = Int16Array.of(48, 53, 58, 357), EC = Int16Array.of(135, 138, 141, 362);
    const ESTART = Int16Array.of(-1, 365, 367, 369), EEND = Int16Array.of(-1, 366, 368, 370);
    // LFO l: rate slot (rate, rise, delay, smooth follow it)
    const LRATE = Int16Array.of(63, 67, 71, 75, 79, 83, 87, 91, 371, 375);
    // sources (§3.10)
    const S_WHEEL = 1, S_ENV1 = 2, S_LFO1 = 5, S_VELO = 13, S_NOTE = 14, S_AT = 15, S_PAT = 16, S_CHAOS1 = 17, S_NOISE = 19,
      S_RAND1 = 20, S_RAND2 = 21, S_ALT1 = 22, S_ALT2 = 23, S_MACRO1 = 24, S_BEND = 28, S_MPEX = 29, S_MPEY = 30, S_MPEZ = 31,
      S_RELVEL = 32, S_FIXED = 33, S_RANDD = 51, S_OSCA = 52, S_ACTV = 58, S_VIDX = 59, S_VMOD1 = 60, S_VMOD2 = 61;
    const ESRC = Int8Array.of(2, 3, 4, 34), LSRC = Int8Array.of(5, 6, 7, 8, 9, 10, 11, 12, 35, 36);
    const LYSRC = Int8Array.of(37, 38, 39, 40, 41, 42, 43, 44, 45, 46), MSRC = Int8Array.of(24, 25, 26, 27, 47, 48, 49, 50);
    // LFO types (LFO_TYPES), kinds (§6.15.1 table)
    const T_PATH = 1, T_LORENZ = 2, T_ROSSLER = 3, T_SH = 4;
    const K_VOICE = 0, K_OFF = 1, K_FREE = 2, K_MONO = 3;    // per-voice Trig/Env · processor FREE · per-voice FREE · processor Trig/Env

    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);     // NaN → 0
    function xorshift(s) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }

    /* ------------------------------------------------------------ curves (Phase-1 §4.4) */
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

    /* ------------------------------------------------------------ built-in default CT (CT v2 fields read here, §4.1) */
    const DEF_CT = (() => {
      const lfoTab = new Float32Array(N_LFO * (LFO_N + 1)), lfoPtsOff = new Uint16Array(N_LFO + 1), lfoPts = new Float64Array(N_LFO * 9);
      const tri = Float64Array.from([0, 0, 0, 0.5, 1, 0, 1, 0, 0]);
      for (let l = 0; l < N_LFO; l++) {
        lfoPtsOff[l] = 3 * l;
        lfoPts.set(tri, 9 * l);
        for (let j = 0; j <= LFO_N; j++) lfoTab[l * (LFO_N + 1) + j] = evalPts(tri, 0, 3, j / LFO_N);
      }
      lfoPtsOff[N_LFO] = 3 * N_LFO;
      const veloTab = new Float32Array(CURVE_N + 1), noteTab = new Float32Array(CURVE_N + 1);
      for (let j = 0; j <= CURVE_N; j++) { veloTab[j] = j / CURVE_N; noteTab[j] = j / CURVE_N; }
      const crv = new Float32Array(NROW * (CRV_N + 1));
      for (let r = 0; r < NROW; r++) for (let j = 0; j <= CRV_N; j++) crv[r * (CRV_N + 1) + j] = j / CRV_N;
      const lfoLoop = new Float64Array(N_LFO).fill(-1);
      return Object.freeze({ key: '', lfoTab, lfoPtsOff, lfoPts, lfoPm: new Uint8Array(N_LFO * 6), lfoPmAny: new Uint8Array(N_LFO),
        lfoStart: new Float64Array(N_LFO), lfoLoop, pathX: new Float32Array(N_LFO * (LFO_N + 1)),
        pathY: new Float32Array(N_LFO * (LFO_N + 1)), veloTab, noteTab, crv });
    })();
    const ENV_LAD0 = Float64Array.of(0, 1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64, 128);
    const VC_RATES0 = Float64Array.of(1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4);

    /* ------------------------------------------------------------ shared helpers of the modulation system */
    // one matrix row (§5.2, Phase 1) from the source vector src into off[mDst] (vi for voice/mono rows, FX-ctx index for FX)
    function evalRow(m, r, src, off) {
      const si = m.mSrc[r], bi = m.srcBi[si];
      let s = src[si];
      const k = m.mK[r];
      if (k !== 0) {
        if (bi === 0) s = (1 - exp(-k * s)) * m.mKd[r];
        else {
          const a = s < 0 ? -s : s, b = (1 - exp(-k * a)) * m.mKd[r];
          s = s < 0 ? -b : b;
        }
      }
      let x = m.mBi[r] ? (bi ? 0.5 * s : s - 0.5) : s;
      const ai = m.mAux[r];
      if (ai !== 0) {
        let a = src[ai];
        if (m.srcBi[ai]) a = (a + 1) * 0.5;
        a = a > 0 ? (a < 1 ? a : 1) : 0;
        x *= m.mInv[r] ? 1 - a : a;
      }
      off[m.mDst[r]] += m.mAmt[r] * x;
    }
    // one matrix row v2 (§5.2; rows with an editable curve, slew, aux curve or randd: mX ≠ 0). rd = the note-on draws per
    // slot, Z/ZG = the slew state per slot and its generation (initialised to the curved source at the first evaluation
    // after a note-on / an edit of the row), RXD[0] = the chunk (voice) or span (mono/FX) duration, set by the caller (M4:
    // a double argument — or result — of this call, not inlined, was boxed per row and chunk). Adds mAmt·x into off.
    const RXD = new Float64Array(1);
    function evalRowX(m, r, src, off, rd, Z, ZG) {
      const dtS = RXD[0], si = m.mSrc[r], bi = m.srcBi[si], slot = m.mSlot[r];
      let s = si === S_RANDD ? rd[slot] : src[si];
      const cv = m.mCrv[r];
      if (cv >= 0) {
        const u = tabAt(m.crvTab, cv * (CRV_N + 1), CRV_N, bi ? (s + 1) * 0.5 : s);
        s = bi ? 2 * u - 1 : u;
      } else {
        const k = m.mK[r];
        if (k !== 0) {
          if (bi === 0) s = (1 - exp(-k * s)) * m.mKd[r];
          else {
            const a = s < 0 ? -s : s, b = (1 - exp(-k * a)) * m.mKd[r];
            s = s < 0 ? -b : b;
          }
        }
      }
      if ((m.mX[r] & 2) !== 0) {
        if (ZG[slot] !== m.slGen[slot]) { ZG[slot] = m.slGen[slot]; Z[slot] = s; }
        else {
          const z = Z[slot], d = s - z, R = bi ? 2 : 1;
          if (d > 0) {
            const t = m.mRise[r];
            if (t > 0) { const mx = R * dtS / t; Z[slot] = d < mx ? s : z + mx; } else Z[slot] = s;
          } else if (d < 0) {
            const t = m.mFall[r];
            if (t > 0) { const mx = R * dtS / t; Z[slot] = -d < mx ? s : z - mx; } else Z[slot] = s;
          }
        }
        s = Z[slot];
      }
      let x = m.mBi[r] ? (bi ? 0.5 * s : s - 0.5) : s;
      const ai = m.mAux[r];
      if (ai !== 0) {
        let a = ai === S_RANDD ? rd[slot] : src[ai];
        if (m.srcBi[ai]) a = (a + 1) * 0.5;
        a = a > 0 ? (a < 1 ? a : 1) : 0;
        const ak = m.mAK[r];
        if (ak !== 0) a = (1 - exp(-ak * a)) * m.mAKd[r];
        x *= m.mInv[r] ? 1 - a : a;
      }
      off[m.mDst[r]] += m.mAmt[r] * x;
    }
    // mAmt·x of row r without side effects (snapshot mOut; slew rows read their current state)
    function rowOut(m, r, src, rd, Z, ZG) {
      const si = m.mSrc[r], bi = m.srcBi[si], slot = m.mSlot[r];
      let s = si === S_RANDD ? rd[slot] : src[si];
      const cv = m.mCrv[r], k = m.mK[r];
      if (cv >= 0) {
        const u = tabAt(m.crvTab, cv * (CRV_N + 1), CRV_N, bi ? (s + 1) * 0.5 : s);
        s = bi ? 2 * u - 1 : u;
      } else if (k !== 0) {
        if (bi === 0) s = (1 - exp(-k * s)) * m.mKd[r];
        else { const a = s < 0 ? -s : s, b = (1 - exp(-k * a)) * m.mKd[r]; s = s < 0 ? -b : b; }
      }
      if ((m.mX[r] & 2) !== 0 && ZG[slot] === m.slGen[slot]) s = Z[slot];
      let x = m.mBi[r] ? (bi ? 0.5 * s : s - 0.5) : s;
      const ai = m.mAux[r];
      if (ai !== 0) {
        let a = ai === S_RANDD ? rd[slot] : src[ai];
        if (m.srcBi[ai]) a = (a + 1) * 0.5;
        a = a > 0 ? (a < 1 ? a : 1) : 0;
        const ak = m.mAK[r];
        if (ak !== 0) a = (1 - exp(-ak * a)) * m.mAKd[r];
        x *= m.mInv[r] ? 1 - a : a;
      }
      return m.mAmt[r] * x;
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
    function pmEval(m, l, x, E) {
      const off = m.lfoPtsOff[l];
      let n = m.lfoPtsOff[l + 1] - off;
      if (n > MAX_PTS) n = MAX_PTS;
      if (n < 1) { pmY0 = 0; return 0; }
      const P = m.lfoPts, M = m.lfoPm, last = n - 1;
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
      const n = h > 0.02 ? ceil(h / 0.02) : 1;
      chaosRun(S, j, k, n, h / n);
    }
    // chaos LFOs (§6.15.3): at most 4 sub-steps per chunk (≤ 0.02 each up to h = 0.08, as chaosInt), beyond that the
    // step grows up to a per-type cap that keeps RK2 stable (Rössler 0.1, Lorenz 0.04 per sub-step): the effective
    // integration rate saturates far above the control rate instead of costing up to ~26 sub-steps per LFO per voice
    const CHAOS_HMAX = Float64Array.from([0.4, 0.16]);
    function chaosIntL(S, j, k, h) {
      if (!(h > 0)) return;
      if (h > CHAOS_HMAX[k]) h = CHAOS_HMAX[k];
      let n = h > 0.02 ? ceil(h / 0.02) : 1;
      if (n > 4) n = 4;
      chaosRun(S, j, k, n, h / n);
    }
    function chaosRun(S, j, k, n, dt) {
      let x = S[j], y = S[j + 1], z = S[j + 2];
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
    // BPM snap (Phase-1 §6.13): nearest straight ladder entry 128·2^(−i) beats, i = 0…14, in log distance
    function snapRate(rate, bpm) {
      const beats = bpm / 60 / rate;
      let i = round(mlog2(128 / beats));
      i = i > 0 ? (i < 14 ? i : 14) : 0;
      return bpm / 60 / (128 * pow(2, -i));
    }

    /* ------------------------------------------------------------ LFO v2 helpers (§6.15) */
    // cycle parity of a cycle counter (integer-valued double)
    function odd(cy) { return cy - 2 * floor(cy * 0.5) !== 0; }
    // effective LFO scale from Voice Control (eff vc.lscale, exp law 0.25…4; Rate mode snaps to VC_RATES nearest in
    // log2, ties to the smaller); exactly 1 at n = 0.5 (skipped, §0.7)
    function lsc(m, E) {
      const n = E[VC_LSCALE];
      if (n === 0.5) return 1;
      const v = 0.25 * pow(16, n);
      if (m.vcLMode === 0) return v;
      const lv = mlog2(v > 0 ? v : 1e-9), R = m.vcRates, L = m.vcRL;
      let best = R[0], bd = Infinity;
      for (let i = 0; i < R.length; i++) { const d0 = L[i] - lv, d = d0 < 0 ? -d0 : d0; if (d < bd - 1e-9) { bd = d; best = R[i]; } }
      return best;
    }
    // start phase (§6.15.2): pts[start].x exactly when the eff PHASE is 0, else frac(pts[start].x + phase/360)
    function startPh(m, l, E) {
      const d = E[L1_PHASE + l], s = m.lfoStart[l];
      if (d === 0) return s;
      const x = s + d;
      return x - floor(x);
    }
    // ladder entry (beats) of a BPM LFO at eff rate n
    function ladBeats(m, l, n) { return m.lfoLad[l * 43 + round(n * (m.lfoLadN[l] - 1))]; }
    // cycles per second of LFO l (BPM: the ladder entry at the tempo; Hz: law ×10 when x10), × the LFO scale sc (= lsc of
    // the same eff vector, computed once per voice chunk / processor span by the caller)
    function lfoHz(m, l, E, sc) {
      const n = E[LRATE[l]];
      let hz;
      if (m.lfoBpm[l]) { const beats = ladBeats(m, l, n); hz = beats > 0 ? m.bpm / 60 / beats : 0; }
      else hz = (m.lfoX10[l] ? 1000 : 100) * n * n * n * n;
      return sc !== 1 ? hz * sc : hz;
    }
    // swing pair geometry (§7.2) on an unswung cycle position x: even cycles last ×(1 + 0.75s), odd ×(1 − 0.75s)
    let swCy = 0;
    function swingMap(x, s) {
      const a = 1 + 0.75 * s, k = floor(x * 0.5), w = x - 2 * k;
      if (w < a) { swCy = 2 * k; return w / a; }
      swCy = 2 * k + 1;
      return (w - a) / (2 - a);
    }
    // read position of a phase under DIRECTION (§6.15.2). Ping Pong on the loop passes of an ENVELOPE LFO (cycle ≥ 1,
    // φ ∈ [lp, 1)) mirrors inside the loop region — odd passes read lp + (1 − φ), from 1 back to lp — so the passes join
    // without a step (IMPL for the spec gap: the plain 1 − φ would read the mirrored start of the graph, outside the loop)
    function readPos(m, l, ph, cy) {
      const d = m.lfoDir[l];
      if (d === 0) return ph;
      if (d === 1) return 1 - ph;
      if (!odd(cy)) return ph;
      const lp = m.lfoLoop[l];
      return m.lfoMode[l] === 1 && lp > 0 && lp < 1 ? lp + (1 - ph) : 1 - ph;
    }
    // the song position of the note-on being processed (ModV.noteOn → notePos). The engine applies a transport start / a
    // loop wrap / a stop and then fires that frame's note-ons BEFORE the span's begin, so the processor beat clock
    // (beatClk, = the start of the next span) and m.playing may still describe the previous span; proc.songBeat() then
    // tells. While the song runs on contiguously, beatClk is the exact position (proc.songBeat() of a live note handled
    // between two render quanta still reports the start of the previous span); after a jump of the song position (loop
    // wrap; more than two quanta away) or at a play start, the song position. nPl = transport playing, nBeat = the note's
    // beat (stopped: the processor beat clock, as begin uses it), nSec = songSeconds (§6.15.1)
    let nPl = 0, nBeat = 0, nSec = 0;
    function notePos(m, proc) {
      const sb = typeof proc.songBeat === 'function' ? proc.songBeat() : null;
      if (typeof sb === 'number' && sb === sb) {
        const bpm = proc.bpm > 0 ? +proc.bpm : 120, d = sb - m.beatClk, thr = 64 * m.dtC * bpm / 60;
        nPl = 1; nBeat = m.playing !== 0 && d < thr && d > -thr ? m.beatClk : sb; nSec = nBeat * 60 / bpm;
      } else { nPl = 0; nBeat = m.beatClk; nSec = 0; }
    }
    // HOST in Hz (§6.15.1, S2 mode, BPM off, transport playing at the note-on): restart phase frac(start + songSeconds·rateHz)
    let hsCy = 0;
    function hostStart(m, l, E, st, sc) {
      if (m.hostHz[l] !== 0 && nPl !== 0) {
        const x = st + nSec * lfoHz(m, l, E, sc), c = floor(x);
        hsCy = c;
        return x - c;
      }
      hsCy = 0;
      return st;
    }
    // chaos LFO output (§6.15.3): Lorenz clamp(0.5 + x/40), Rossler clamp(0.5 + x/24)
    function chaosLfo(S, j, ty) {
      const v = ty === T_LORENZ ? 0.5 + S[j] / 40 : 0.5 + S[j] / 24;
      return v > 0 ? (v < 1 ? v : 1) : 0;
    }
    function seedChaos(H, l, ty) {
      const j = 3 * l;
      for (let i = 0; i < 3; i++) H.lCh[j + i] = 1 + (2 * H.rnd2() - 1);
      H.lV0[l] = chaosLfo(H.lCh, j, ty);
    }
    // restart draws of an S&H / Chaos LFO (voice: r2; processor: r2p)
    function seedLfo(m, H, l) {
      const ty = m.lfoType[l];
      if (ty === T_SH) { const u = H.rnd2(); H.lSH[l] = u; H.lV0[l] = u; }
      else if (ty === T_LORENZ || ty === T_ROSSLER) seedChaos(H, l, ty);
    }
    function lfoChaos(m, H, l, E, dt, sc) {
      const hz = lfoHz(m, l, E, sc);
      if (!(hz > 0)) return;
      const k = m.lfoType[l] === T_LORENZ ? 1 : 0;
      chaosIntL(H.lCh, 3 * l, k, hz * CHAOS_T0[k] * dt);
    }
    // raw value of LFO l at read position rp (holder H = a ModV or the processor holder m.P): sets H.ly0 (value the
    // direction reads at φ = 0, the DELAY value), H.lyY / H.ly0Y (Path Y; 0 for other types)
    function rawOf(m, H, l, rp, E) {
      const ty = m.lfoType[l];
      if (ty === 0) {
        H.lyY = 0; H.ly0Y = 0;
        const rev = m.lfoDir[l] === 1;
        if (m.lfoPmAny[l]) {
          if (rev) { H.ly0 = pmEval(m, l, 1, E); return pmEval(m, l, rp, E); }
          const y = pmEval(m, l, rp, E);
          H.ly0 = pmY0;
          return y;
        }
        const T = m.lfoTab, b = l * 1025;
        H.ly0 = rev ? T[b + 1024] : T[b];
        return tabAt(T, b, 1024, rp);
      }
      if (ty === T_PATH) {
        const b = l * 1025, b0 = b + (m.lfoDir[l] === 1 ? 1024 : 0);
        H.ly0 = m.pathX[b0]; H.ly0Y = m.pathY[b0];
        H.lyY = tabAt(m.pathY, b, 1024, rp);
        return tabAt(m.pathX, b, 1024, rp);
      }
      H.lyY = 0; H.ly0Y = 0; H.ly0 = H.lV0[l];
      if (ty === T_SH) return H.lSH[l];
      return chaosLfo(H.lCh, 3 * l, ty);
    }
    // DELAY / RISE (from tau) and SMOOTH on a raw value (and the Path Y), into H.lVal / H.lY
    function lfoOut(m, H, l, E, y, tau, dt) {
      const kb = LRATE[l], tsc = m.lfoBpm[l] ? 120 / m.bpm : 1;
      const dly = 4 * E[kb + 2] * tsc, rise = 4 * E[kb + 1] * tsc, y0 = H.ly0;
      const x = tau < dly ? y0 : (rise > 0 && tau < dly + rise ? y0 + (y - y0) * ((tau - dly) / rise) : y);
      let xY = 0;
      const path = m.lfoType[l] === T_PATH;
      if (path) {
        const yY = H.lyY, z0 = H.ly0Y;
        xY = tau < dly ? z0 : (rise > 0 && tau < dly + rise ? z0 + (yY - z0) * ((tau - dly) / rise) : yY);
      }
      const sm = E[kb + 3];
      if (sm > 0) {
        if (sm !== H.lKs[l]) { H.lKs[l] = sm; H.lK[l] = 1 - exp(-dt / (0.5 * sm * sm * sm)); }
        const k = H.lK[l];
        H.lSm[l] += (x - H.lSm[l]) * k;
        if (H.lSm[l] < 1e-30 && H.lSm[l] > -1e-30) H.lSm[l] = 0;
        if (path) { H.lSmY[l] += (xY - H.lSmY[l]) * k; if (H.lSmY[l] < 1e-30 && H.lSmY[l] > -1e-30) H.lSmY[l] = 0; }
        else H.lSmY[l] = 0;
      } else { H.lSm[l] = x; H.lSmY[l] = xY; }
      H.lVal[l] = H.lSm[l]; H.lY[l] = H.lSmY[l];
      return H.lSm[l];
    }
    // phase advance of a RETRIG / ENVELOPE LFO (general path: PHASE, ×10, LFO scale, swing, cycle counter for DIRECTION
    // and S&H, chaos integration); beatNow = song/processor beat at the end of the step, gate = loop hold condition,
    // sc = the LFO scale of E (the anchored forms stay continuous when it changes: H.lB0 is re-based, rebaseV/rebaseP).
    // The Phase-1 arithmetic is kept term by term (each extra factor applied only when it is not neutral).
    function lfoAdvG(m, H, l, E, dt, beatNow, gate, used, sc) {
      const n = E[LRATE[l]], ty = m.lfoType[l];
      let beats = 0, inc;
      if (m.lfoBpm[l]) {
        beats = ladBeats(m, l, n);
        inc = beats > 0 ? dt * m.bpm / 60 / beats : 0;
      } else inc = dt * (m.lfoX10[l] ? 1000 : 100) * n * n * n * n;
      if (sc !== 1) inc *= sc;
      let ph = H.lPh[l], cy = H.lCy[l], wr = 0;
      const sw = m.lSw[l];
      if (m.lfoMode[l] === 0) {
        if (beats > 0 && m.lfoAnchor[l]) {
          const st = startPh(m, l, E), y = (sc !== 1 ? (beatNow - H.lB0[l]) * sc : beatNow - H.lB0[l]) / beats;
          let c;
          // swung: the first (partial, even) cycle from the start point lasts ×(1 + 0.75s) of its unswung length, as on
          // the accumulating path — the pair geometry is aligned to the restart (φ = start exactly at the note-on)
          if (sw !== 0) { ph = swingMap(st * (1 + 0.75 * sw) + y, sw); c = swCy; } else { const x = st + y; c = floor(x); ph = x - c; }
          if (c !== cy) { wr = 1; cy = c; }
        } else if (sw !== 0) {
          let f = odd(cy) ? 1 - 0.75 * sw : 1 + 0.75 * sw;
          ph += inc / f;
          for (let g = 0; ph >= 1 && g < 64; g++) {
            const left = (ph - 1) * f;
            cy++; wr = 1;
            f = odd(cy) ? 1 - 0.75 * sw : 1 + 0.75 * sw;
            ph = left / f;
          }
          if (ph >= 1) ph -= floor(ph);
        } else {
          ph += inc;
          const c = floor(ph);
          if (c !== 0) { ph -= c; cy += c; wr = 1; }
        }
      } else if (!H.lDone[l]) {
        const lp = m.lfoLoop[l], loop = lp >= 0 && lp < 1;
        if (beats > 0 && m.lfoAnchor[l] && (gate || !loop)) {
          if (sw === 0) {
            const x = startPh(m, l, E) + (sc !== 1 ? (beatNow - H.lB0[l]) * sc : beatNow - H.lB0[l]) / beats;
            if (x < 1) ph = x > 0 ? x : 0;
            else if (loop) {
              const L = 1 - lp, c = 1 + floor((x - 1) / L);
              ph = lp + (x - 1) % L;
              if (c !== cy) { wr = 1; cy = c; }
            } else { ph = 1; H.lDone[l] = 1; }
          } else {
            // swing (§6.15.2): the pass from the start point is cycle 0 (even, ×a), loop cycles 1, 2, … alternate
            // ×(2 − a) / ×a; y = unswung cycles since the restart
            const st = startPh(m, l, E), y = (sc !== 1 ? (beatNow - H.lB0[l]) * sc : beatNow - H.lB0[l]) / beats;
            const a = 1 + 0.75 * sw, f0 = (1 - st) * a;
            if (y < f0) { const x = st + y / a; ph = x > 0 ? x : 0; }
            else if (loop) {
              const L = 1 - lp, b = 2 - a, y1 = y - f0, k = floor(y1 / (2 * L)), w = y1 - 2 * L * k;
              let c;
              if (w < L * b) { c = 1 + 2 * k; ph = lp + w / b; } else { c = 2 + 2 * k; ph = lp + (w - L * b) / a; }
              if (ph >= 1) ph = lp;
              if (c !== cy) { wr = 1; cy = c; }
            } else { ph = 1; H.lDone[l] = 1; }
          }
        } else if (sw === 0) {
          ph += inc;
          if (ph >= 1) {
            if (loop && gate) { const L = 1 - lp; ph = lp + (ph - 1) % L; cy++; wr = 1; }
            else { ph = 1; H.lDone[l] = 1; }
          }
        } else {
          // swing on the accumulating path: cycle cy runs at 1/f of the unswung speed (f = a even, 2 − a odd)
          let f = odd(cy) ? 1 - 0.75 * sw : 1 + 0.75 * sw;
          ph += inc / f;
          for (let g = 0; ph >= 1 && g < 64; g++) {
            if (!(loop && gate)) { ph = 1; H.lDone[l] = 1; break; }
            const left = (ph - 1) * f;
            cy++; wr = 1;
            f = odd(cy) ? 1 - 0.75 * sw : 1 + 0.75 * sw;
            ph = lp + left / f;
          }
          if (ph >= 1 && !H.lDone[l]) ph = lp + (ph - 1) % (1 - lp);
        }
      }
      H.lPh[l] = ph; H.lCy[l] = cy;
      if (ty === T_SH) { if (wr !== 0) H.lSH[l] = H.rnd2(); }
      else if ((ty === T_LORENZ || ty === T_ROSSLER) && used && !H.lDone[l]) lfoChaos(m, H, l, E, dt, sc);
    }
    // LFO scale changes (vc.lscale, §6.15.2) on BPM + HOST LFOs: their anchored closed forms multiply the WHOLE elapsed
    // time since the anchor by the scale, so a scale change would move the phase by elapsed × Δscale (racing / jumps).
    // The anchor is re-based instead, keeping the phase at beat b continuous: (b − B0')·new = (b − B0)·old (IMPL, the
    // scale analogue of the Hz-HOST rule in the header). Per voice: RETRIG/ENVELOPE anchors lB0, q = old/new scale
    function rebaseV(m, H, b, q) {
      for (let l = 0; l < N_LFO; l++) {
        if (m.lKind[l] === K_VOICE && m.lfoBpm[l] !== 0 && m.lfoAnchor[l] !== 0) H.lB0[l] = b - (b - H.lB0[l]) * q;
      }
    }
    // processor: MONO RETRIG/ENVELOPE anchors (P.lB0) and the song-anchor offsets fB0 of FREE LFOs (free = 0 right after
    // a song-position jump: the FREE closed form re-locks to the song there, fB0 = 0)
    function rebaseP(m, b, q, free) {
      for (let l = 0; l < N_LFO; l++) {
        if (m.lfoBpm[l] === 0 || m.lfoAnchor[l] === 0) continue;
        const k = m.lKind[l];
        if (k === K_MONO) m.oB0[l] = b - (b - m.oB0[l]) * q;
        else if (k !== K_VOICE && free) m.fB0[l] = b - (b - m.fB0[l]) * q;
      }
    }

    /* ------------------------------------------------------------ per-processor state (sx.mod) */
    const SEED = 0x2545F491;                                   // processor seed of the mono chaos (as Phase 1)
    const SEED2 = 0x6C8E9CF5;                                  // salt of the processor Phase-2 stream (mono S&H / chaos LFOs)
    // per-processor modulation state (sx.mod): built by a constructor so that every processor's state object shares
    // one hidden class (a ~180-property object literal gets a map of its own per object, which turns every access
    // site in begin megamorphic once a few processors have existed in the scope)
    function ModState(B) {
      this.cont = B.LAW_TAB2.cont; this.pol0 = B.SRC_POL2;
      this.nCh = 0; this.CH = 0; this.OS = 0; this.base = 0; this.fs = 0; this.dtC = 0; this.kF = 0; this.kM = 0; this.kSm = -1; this.dBeat = 0;
      // copies of the current CP (§4.1)
      this.cp = null; this.bT = new Float64Array(NSV); this.mN = 0; this.mSrc = new Int8Array(NROW); this.mDst = new Int16Array(NROW);
      this.mAmt = new Float64Array(NROW); this.mBi = new Uint8Array(NROW); this.mK = new Float64Array(NROW); this.mKd = new Float64Array(NROW);
      this.mAux = new Int8Array(NROW); this.mInv = new Uint8Array(NROW); this.mCtx = new Uint8Array(NROW); this.mOn = new Uint8Array(NROW); this.fxN = 0;
      // matrix v2 (§4.1, §5.2): editable curve slot, slew times, aux curve, randd flag, source slot, feature flags
      // (1 crv, 2 slew, 4 aux curve, 8 randd), slew generation per slot (bumped when the slewed row of a slot changes)
      this.mCrv = new Int8Array(NROW); this.mRise = new Float64Array(NROW); this.mFall = new Float64Array(NROW); this.mAK = new Float64Array(NROW);
      this.mAKd = new Float64Array(NROW); this.mRd = new Uint8Array(NROW); this.mSlot = new Uint8Array(NROW); this.mX = new Uint8Array(NROW);
      this.anyRd = 0; this.slGen = new Int32Array(NROW); this.slKey = new Int32Array(NROW);
      // pre-restart pass (§6.2, header): slots read by the note-on restarts, the voice rows into them, their distinct targets
      this.preMask = new Uint8Array(NSV); this.mPre = new Uint8Array(NROW); this.preD = new Int16Array(NSV); this.preDN = 0; this.preN = 0;
      this.srcUsed = new Uint8Array(NSRC); this.srcBi = new Uint8Array(NSRC); this.modded = new Uint8Array(NSV); this.modList = new Int16Array(NSV);
      this.modN = 0;
      this.lUse = 0;                                           // (M4) bit l: a row reads LFO l (srcUsed of its two sources)
      this.lfoMode = new Uint8Array(N_LFO); this.lfoBpm = new Uint8Array(N_LFO); this.lfoAnchor = new Uint8Array(N_LFO);
      this.lfoLad = new Float64Array(N_LFO * 43); this.lfoLadN = new Uint8Array(N_LFO); this.chaosMono = new Uint8Array(2);
      this.chaosSh = new Uint8Array(2); this.macroT = new Float64Array(N_MACRO);
      // LFO v2 (§6.15): MONO, TYPE, DIRECTION, ×10, swing flag; derived kind, Hz HOST, swing amount, extension flags
      this.lfoMono = new Uint8Array(N_LFO); this.lfoType = new Uint8Array(N_LFO); this.lfoDir = new Uint8Array(N_LFO);
      this.lfoX10 = new Uint8Array(N_LFO); this.lfoSwing = new Uint8Array(N_LFO); this.lKind = new Uint8Array(N_LFO);
      this.hostHz = new Uint8Array(N_LFO); this.lSw = new Float64Array(N_LFO); this.lExt = new Uint8Array(N_LFO); this.k2Any = 0; this.k3Any = 0;
      this.k3Env = 0; this.swing = 0;
      // envelopes v2 (§6.14)
      this.envBpm = new Uint8Array(N_ENV); this.envLegInv = new Uint8Array(N_ENV); this.envStealRe = new Uint8Array(N_ENV);
      this.envLad = new Float64Array(16); this.anyLegInv = 0;
      this.cMono = 0; this.cLegato = 0; this.cAlways = 0; this.cScaled = 0; this.cPoly = 8; this.smooth = 1; this.veloPorta = 0; this.notePorta = 0;
      // feature gates (CP.use, §4.1), S1 mode, Voice Control, MPE, tuning
      this.use = 0; this.x4On = 1; this.s1 = 0; this.vcOn = 0; this.vcLen = 1; this.vcLMode = 0; this.vcSteps = new Float64Array(48); this.vcRates = new Float64Array(11);
      this.vcRL = new Float64Array(11); this.mpeOn = 0; this.mpeBendX = 0; this.mpeWheelY = 0; this.mpeBend = 48; this.mpeMac = new Int8Array(N_MACRO);
      this.mpeMacAny = 0; this.tunOn = 0; this.tune = new Float64Array(128);
      // current CT (§4.1)
      this.ct = null; this.ctGen = -1; this.ctWarn = ''; this.lfoTab = DEF_CT.lfoTab; this.lfoPtsOff = DEF_CT.lfoPtsOff; this.lfoPts = DEF_CT.lfoPts;
      this.lfoPm = DEF_CT.lfoPm; this.lfoPmAny = DEF_CT.lfoPmAny; this.lfoStart = DEF_CT.lfoStart; this.lfoLoop = DEF_CT.lfoLoop;
      this.veloTab = DEF_CT.veloTab; this.noteTab = DEF_CT.noteTab; this.pathX = DEF_CT.pathX; this.pathY = DEF_CT.pathY; this.crvTab = DEF_CT.crv;
      // base smoothing (§5.4)
      this.smS = new Float64Array(NSV); this.smB = new Float64Array(NSV); this.baseA = new Float64Array(NSV); this.baseD = new Float64Array(NSV);
      this.mov = new Int16Array(NSV); this.movN = 0;
      // slots that are not settled (smS = smB = baseA = bT, baseD = 0): only these are visited by the smoothing, double
      // buffered (unP = the list processed in the last span, whose monoEff entries are recomputed)
      this.unL = new Int16Array(NSV); this.unN = 0; this.unP = new Int16Array(NSV); this.unPN = 0;
      // distinct targets of the mono-context rows; meAll = recompute every monoEff entry once (after a CP change)
      this.monoList = new Int16Array(NSV); this.monoN = 0; this.meAll = 1;
      // global sources [src·32 + c], beat clock, transport, performance smoothers, macro targets of the span
      this.g = new Float64Array(NSRC * MAXCH); this.beatC = new Float64Array(MAXCH); this.beatClk = 0; this.bpm = 120; this.playing = 0;
      this.hAnc = 1;                                            // Hz-HOST FREE LFOs re-anchor at the next span's chunk 0
      this.wheelS = 0; this.atS = 0; this.bendS = 0; this.macS = null; this.macro = new Float64Array(N_MACRO); this.macB = new Float64Array(N_MACRO); this.act = 0;
      this.anyGate = 0;
      // begin's per-span work lists: processor LFOs with per-chunk work (and its kind), the value each settled macro's
      // g row holds for every chunk (NaN = not filled)
      this.lWork = new Int8Array(N_LFO); this.lWorkK = new Uint8Array(N_LFO); this.macFill = new Float64Array(N_MACRO);
      // mono context (§5.5)
      this.monoSrc = new Float64Array(NSRC); this.monoOff = new Float64Array(NSV); this.monoEff = new Float64Array(NSV);
      // processor LFOs: Phase-1 Off-mode arrays (kind 1) shared by the general processor holder P (kinds 1–3)
      this.oPh = new Float64Array(N_LFO); this.oSm = new Float64Array(N_LFO); this.oInit = new Uint8Array(N_LFO); this.oK = new Float64Array(N_LFO);
      this.oKs = new Float64Array(N_LFO); this.oY0 = new Float64Array(N_LFO); this.oY0Y = new Float64Array(N_LFO); this.oSmY = new Float64Array(N_LFO);
      this.oCy = new Float64Array(N_LFO); this.oCyE = new Float64Array(N_LFO); this.oRp = new Float64Array(N_LFO); this.oDone = new Uint8Array(N_LFO);
      this.oB0 = new Float64Array(N_LFO); this.oSH = new Float64Array(N_LFO); this.oCh = new Float64Array(3 * N_LFO); this.oV0 = new Float64Array(N_LFO);
      this.oVal = new Float64Array(N_LFO); this.oValY = new Float64Array(N_LFO); this.oTau = 0; this.r2p = 1; this.P = null;
      // LFO scale of the mono context (this span, the previous span) and the song-anchor offsets of BPM + HOST FREE LFOs
      // (beats; 0 = the Phase-1 closed form, re-based by scale changes: rebaseP)
      this.scM = 1; this.scP = 1; this.fB0 = new Float64Array(N_LFO); this.jmp = 0;
      // per-voice FREE LFOs (kind 2): read position and cycle of the processor clock per chunk [l·32 + c]
      this.fPh = new Float64Array(N_LFO * MAXCH); this.fCy = new Float64Array(N_LFO * MAXCH);
      this.mch = new Float64Array(6); this.mchOut = new Float64Array(2); this.mchHold = new Float64Array(2); this.mchTim = new Float64Array(2);
      // processor slew state of mono/FX rows (per slot) and the randd draws without a recent voice
      this.pSlew = new Float64Array(NROW); this.pSlG = new Int32Array(NROW); this.rd0 = new Float64Array(NROW);
      this.fxOff = new Float64Array(MAXFX); this.fxHi = 0; this.fxDirty = 0;
      this.recent = null; this.lastPitch = -1; this.seed = SEED;
      // processor arrays owned by the engine / SxSeq, resolved in sync (never looked up per span: a missing property
      // read on the processor object is a slow lookup): clip-lane macro bases, MPE channel state
      this.lane = null; this.mpeA = null;
    }
    let warnedBase = false;                                     // one console.warn per script per scope (§0.3)
    function attach(sx, proc) {
      if (sx.mod) return sx.mod;
      const B = globalThis.SxBase;
      if (!B || !B.LAW_TAB2 || !B.SRC_POL2) {
        if (!warnedBase && typeof console !== 'undefined') { warnedBase = true; console.warn('sx-mod: SxBase missing, Serum modulation unavailable'); }
        return null;
      }
      const m = new ModState(B);
      m.macS = m.macro;                                         // the smoothed macro sources (§11.6 `macro`)
      // processor LFO holder: the same field names as a ModV (lfoAdvG, rawOf, lfoOut work on both)
      m.P = {
        lPh: m.oPh, lCy: m.oCy, lDone: m.oDone, lB0: m.oB0, lSm: m.oSm, lSmY: m.oSmY, lK: m.oK, lKs: m.oKs, lSH: m.oSH,
        lCh: m.oCh, lV0: m.oV0, lVal: m.oVal, lY: m.oValY, ly0: 0, ly0Y: 0, lyY: 0,
        rnd2() { m.r2p = xorshift(m.r2p) || 1; return m.r2p / 4294967296; },
      };
      sx.mod = m;
      if (typeof proc.vcN !== 'number') proc.vcN = 0;           // the Voice Control step counter (§6.2) exists from here on
      init(m, proc);
      return m;
    }
    function seedMonoChaos(m) {
      let r = xorshift(m.seed ^ 0x51ED27);
      for (let i = 0; i < 6; i++) { r = xorshift(r); m.mch[i] = 1 + (r / 2147483648 - 1); }
      for (let k = 0; k < 2; k++) { m.mchOut[k] = chaosOut(m.mch, 3 * k, k); m.mchHold[k] = m.mchOut[k]; m.mchTim[k] = 0; }
    }
    // processor Phase-2 stream and the processor LFO states (S&H value and chaos state of every LFO, in LFO order)
    function seedProcLfos(m) {
      m.r2p = xorshift((m.seed ^ SEED2) >>> 0) || 1;
      const P = m.P;
      for (let l = 0; l < N_LFO; l++) {
        const u = P.rnd2();
        m.oSH[l] = u;
        for (let i = 0; i < 3; i++) m.oCh[3 * l + i] = 1 + (2 * P.rnd2() - 1);
        const ty = m.lfoType[l];
        m.oV0[l] = ty === T_SH ? u : ty === T_LORENZ || ty === T_ROSSLER ? chaosLfo(m.oCh, 3 * l, ty) : 0;
        m.oCy[l] = 0; m.oCyE[l] = 0; m.oDone[l] = 0; m.oB0[l] = m.beatClk;
        m.oSmY[l] = 0; m.oY0Y[l] = 0; m.oVal[l] = 0; m.oValY[l] = 0;
      }
      m.oTau = 0;
      m.pSlG.fill(-1);
    }
    // the attach state (also restored by reset)
    function init(m, proc) {
      m.nCh = 0; m.CH = 0; m.OS = 0; m.base = 0; m.fs = 0; m.dtC = 0; m.kF = 0; m.kM = 0; m.kSm = -1; m.dBeat = 0;
      m.cp = null; m.bT.fill(0); m.mN = 0; m.mSrc.fill(0); m.mDst.fill(0); m.mAmt.fill(0); m.mBi.fill(0); m.mK.fill(0);
      m.mKd.fill(0); m.mAux.fill(0); m.mInv.fill(0); m.mCtx.fill(0); m.mOn.fill(0); m.fxN = 0;
      m.mCrv.fill(-1); m.mRise.fill(0); m.mFall.fill(0); m.mAK.fill(0); m.mAKd.fill(0); m.mRd.fill(0); m.mX.fill(0);
      for (let r = 0; r < NROW; r++) m.mSlot[r] = r;
      m.anyRd = 0; m.slGen.fill(0); m.slKey.fill(-1);
      m.preMask.fill(0); m.mPre.fill(0); m.preDN = 0; m.preN = 0;
      m.srcUsed.fill(0); m.srcBi.set(m.pol0); m.modded.fill(0); m.modList.fill(0); m.modN = 0; m.lUse = 0;
      m.lfoMode.fill(2); m.lfoBpm.fill(0); m.lfoAnchor.fill(0); m.lfoLad.fill(0); m.lfoLadN.fill(1);
      m.chaosMono.fill(0); m.chaosSh.fill(0); m.macroT.fill(0);
      m.lfoMono.fill(1); m.lfoType.fill(0); m.lfoDir.fill(0); m.lfoX10.fill(0); m.lfoSwing.fill(0); m.lKind.fill(K_OFF);
      m.hostHz.fill(0); m.lSw.fill(0); m.lExt.fill(0); m.k2Any = 0; m.k3Any = 0; m.k3Env = 0; m.swing = 0;
      m.envBpm.fill(0); m.envLegInv.fill(0); m.envStealRe.fill(0); m.envLad.set(ENV_LAD0); m.anyLegInv = 0;
      m.cMono = 0; m.cLegato = 0; m.cAlways = 0; m.cScaled = 0; m.cPoly = 8; m.smooth = 1;
      m.veloPorta = 0; m.notePorta = 0;
      m.use = 0; m.x4On = 1; m.s1 = 0; m.vcOn = 0; m.vcLen = 1; m.vcLMode = 0; m.vcSteps.fill(0); m.vcRates.set(VC_RATES0);
      for (let i = 0; i < 11; i++) m.vcRL[i] = mlog2(m.vcRates[i]);
      m.mpeOn = 0; m.mpeBendX = 0; m.mpeWheelY = 0; m.mpeBend = 48; m.mpeMac.fill(-1); m.mpeMacAny = 0;
      m.tunOn = 0; for (let k = 0; k < 128; k++) m.tune[k] = k;
      m.ct = null; m.ctGen = -1; m.ctWarn = '';
      m.lfoTab = DEF_CT.lfoTab; m.lfoPtsOff = DEF_CT.lfoPtsOff; m.lfoPts = DEF_CT.lfoPts; m.lfoPm = DEF_CT.lfoPm;
      m.lfoPmAny = DEF_CT.lfoPmAny; m.lfoStart = DEF_CT.lfoStart; m.lfoLoop = DEF_CT.lfoLoop;
      m.veloTab = DEF_CT.veloTab; m.noteTab = DEF_CT.noteTab; m.pathX = DEF_CT.pathX; m.pathY = DEF_CT.pathY; m.crvTab = DEF_CT.crv;
      m.smS.fill(0); m.smB.fill(0); m.baseA.fill(0); m.baseD.fill(0); m.mov.fill(0); m.movN = 0;
      m.unN = 0; m.unPN = 0; m.monoN = 0; m.meAll = 1;
      m.g.fill(0); m.g.fill(1, S_FIXED * MAXCH, S_FIXED * MAXCH + MAXCH); m.macFill.fill(NaN);
      m.beatC.fill(0); m.beatClk = 0; m.bpm = 120; m.playing = 0; m.hAnc = 1;
      m.wheelS = 0; m.atS = 0; m.bendS = 0; m.macS.fill(0); m.macB.fill(0); m.act = 0; m.anyGate = 0;
      m.monoSrc.fill(0); m.monoSrc[S_FIXED] = 1; m.monoOff.fill(0); m.monoEff.fill(0);
      m.oPh.fill(0); m.oSm.fill(0); m.oInit.fill(0); m.oK.fill(0); m.oKs.fill(-1); m.oRp.fill(0);
      for (let l = 0; l < N_LFO; l++) m.oY0[l] = DEF_CT.lfoTab[l * 1025];
      m.fPh.fill(0); m.fCy.fill(0);
      m.scM = 1; m.scP = 1; m.fB0.fill(0); m.jmp = 0;
      m.seed = (SEED ^ (proc.seedSalt | 0)) >>> 0;              // (IMPL-1e §2.4: an Inst's salt; 0 = SEED)
      seedMonoChaos(m);
      seedProcLfos(m);
      m.pSlew.fill(0);
      m.fxOff.fill(0); m.fxHi = 0; m.fxDirty = 0;
      m.recent = null; m.lastPitch = -1;
      rates(m, proc);
    }
    // per-chunk coefficients (chunk = 4 base frames)
    function rates(m, proc) {
      const base = proc.base > 0 ? +proc.base : 48000, fs = proc.fs > 0 ? +proc.fs : base, CH = proc.CH > 0 ? proc.CH | 0 : 8;
      m.CH = CH; m.base = base; m.fs = fs; m.OS = proc.OS > 0 ? proc.OS | 0 : 1;
      m.dtC = CH / fs;
      m.kF = 1 - exp(-4 / (base * 0.0015));
      m.kM = 1 - exp(-4 / (base * 0.006 * m.smooth));
      m.kSm = m.smooth;
      m.oKs.fill(-1);
    }
    function snapBase(m) {
      const bT = m.bT;
      m.smS.set(bT); m.smB.set(bT); m.baseA.set(bT); m.baseD.fill(0);
      for (let i = 0; i < NSV; i++) m.mov[i] = i;
      m.movN = NSV;
      // macro sources jump to their current target (§5.6): base, clip lane, MPE map and the mono-context offsets on
      // m1…m8 evaluated from the current mono sources (sync zeroed monoOff just before; begin re-evaluates it) — a patch
      // edit while no voice sounds must not dip a modulated macro back to its base. Unmodulated macros: their base (Phase 1)
      const mo = m.monoOff;
      if (m.mN > 0) {
        const rv = recentMod(m), rd = rv !== null ? rv.rd : m.rd0;
        for (let r = 0; r < m.mN; r++) {
          const d = m.mDst[r];
          if ((m.mCtx[r] & 2) !== 0 && d >= M1 && d < M1 + N_MACRO) mo[d] += rowOut(m, r, m.monoSrc, rd, m.pSlew, m.pSlG);
        }
      }
      macroTargets(m, mo);
      m.macS.set(m.macB); m.macFill.fill(NaN);
      for (let i = 0; i < NSV; i++) m.monoEff[i] = bT[i];
    }
    // engine / sequencer arrays (§6.17 proc.mpe, §7.5.5 proc.seqMacro), resolved in sync and transport (never per span)
    function procArrays(m, proc) {
      const sqm = proc.seqMacro, mpa = proc.mpe;
      m.lane = sqm && typeof sqm === 'object' && sqm.BYTES_PER_ELEMENT === 8 && sqm.length >= N_MACRO ? sqm : null;
      m.mpeA = mpa && typeof mpa === 'object' && mpa.length >= 17 * 4 ? mpa : null;
    }
    const u8 = (a, i, d) => (a ? (a[i] ? 1 : 0) : d);
    // copy the modulation fields of a new CP (once per CP object); the caller checked its major version
    function sync(proc, sx, cp) {
      const m = sx.mod;
      if (m.cp === cp) return;
      const first = m.cp === null;
      m.cp = cp;
      const b = cp.base, bT = m.bT;
      for (let i = 0; i < NSV; i++) { const v = b ? +b[i] : 0; bT[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
      let mN = cp.mN | 0;
      mN = mN > 0 ? (mN < NROW ? mN : NROW) : 0;
      m.mN = mN;
      m.modded.fill(0); m.srcUsed.fill(0);
      const sb = cp.srcBi;
      for (let i = 0; i < NSRC; i++) m.srcBi[i] = sb ? (sb[i] ? 1 : 0) : m.pol0[i];
      let fxN = 0, fxHi = 0, anyRd = 0;
      for (let r = 0; r < mN; r++) {
        const si = cp.mSrc[r] | 0, di = cp.mDst[r] | 0, ai = cp.mAux ? cp.mAux[r] | 0 : 0, ctx = cp.mCtx[r] | 0;
        // voice/mono rows: 0 ≤ vi < 429; FX rows: FX-context index k = −1 − mDst (§4.1); anything else: an FX row of
        // amount 0 (Phase 1: an invalid destination)
        const vd = di >= 0 && di < NSV, fk = -1 - di, fd = di < 0 && fk < MAXFX;
        let amt = +cp.mAmt[r];
        if (!(si > 0 && si < NSRC && (vd || fd) && ai >= 0 && ai < NSRC && amt === amt)) amt = 0;
        m.mSrc[r] = si > 0 && si < NSRC ? si : S_FIXED; m.mDst[r] = vd ? di : fd ? fk : 0; m.mAmt[r] = amt;
        m.mBi[r] = cp.mBi[r] ? 1 : 0;
        let k = +cp.mK[r];
        if (!(k >= 1e-4 || k <= -1e-4)) k = 0;
        m.mK[r] = k; m.mKd[r] = k !== 0 ? 1 / (1 - exp(-k)) : 0;
        m.mAux[r] = ai >= 0 && ai < NSRC ? ai : 0; m.mInv[r] = cp.mInv && cp.mInv[r] ? 1 : 0;
        m.mCtx[r] = vd ? ctx & 3 : 4; m.mOn[r] = cp.mOn && cp.mOn[r] ? 1 : 0;
        if (vd && (ctx & 1)) m.modded[di] = 1;
        if (!vd) { fxN++; if (m.mDst[r] >= fxHi) fxHi = m.mDst[r] + 1; }
        m.srcUsed[m.mSrc[r]] = 1;
        if (ai > 0) m.srcUsed[ai] = 1;
        // matrix v2 (§5.2): curve slot, slew, aux curve, randd, source slot (§0.7: per-row flags)
        let cv = cp.mCrv ? cp.mCrv[r] | 0 : -1;
        if (!(cv >= 0 && cv < NROW)) cv = -1;
        let ri = cp.mRise ? +cp.mRise[r] : 0, fa = cp.mFall ? +cp.mFall[r] : 0;
        if (!(ri > 0)) ri = 0;
        if (!(fa > 0)) fa = 0;
        let ak = cp.mAK ? +cp.mAK[r] : 0;
        if (!(ak >= 1e-4 || ak <= -1e-4)) ak = 0;
        const rdr = m.mSrc[r] === S_RANDD || m.mAux[r] === S_RANDD || (cp.mRd && cp.mRd[r]) ? 1 : 0;
        let slot = cp.mSlot ? cp.mSlot[r] | 0 : r;
        if (!(slot >= 0 && slot < NROW)) slot = r;
        m.mCrv[r] = cv; m.mRise[r] = ri; m.mFall[r] = fa; m.mAK[r] = ak; m.mAKd[r] = ak !== 0 ? 1 / (1 - exp(-ak)) : 0;
        m.mRd[r] = rdr; m.mSlot[r] = slot;
        const x = (cv >= 0 ? 1 : 0) | (ri > 0 || fa > 0 ? 2 : 0) | (ak !== 0 ? 4 : 0) | (rdr ? 8 : 0);
        m.mX[r] = x;
        if (rdr) anyRd = 1;
        if ((x & 2) !== 0) {                                    // a slewed row: a new source in its slot restarts the slew
          const key = m.mSrc[r] * 4 + (cv >= 0 ? 1 : 0) + (m.mBi[r] ? 2 : 0);
          if (m.slKey[slot] !== key) { m.slKey[slot] = key; m.slGen[slot] = (m.slGen[slot] + 1) | 0; }
        }
      }
      for (let r = mN; r < NROW; r++) { m.mX[r] = 0; m.mRd[r] = 0; m.mCrv[r] = -1; }
      m.anyRd = anyRd;
      m.fxN = fxN; m.fxHi = fxHi;
      let mn = 0;
      for (let i = 0; i < NSV; i++) if (m.modded[i]) m.modList[mn++] = i;
      m.modN = mn;
      // mono-context targets (distinct vi); the offsets start from 0 and every monoEff entry is recomputed once
      const mo = m.monoOff, ml = m.monoList;
      mo.fill(0);
      let nm = 0;
      for (let r = 0; r < mN; r++) {
        if (!(m.mCtx[r] & 2)) continue;
        const d = m.mDst[r];
        let dup = false;
        for (let j = 0; j < nm; j++) if (ml[j] === d) { dup = true; break; }
        if (!dup) ml[nm++] = d;
      }
      m.monoN = nm; m.meAll = 1;
      procArrays(m, proc);
      // feature gates; LFO 9/10 run on every voice only when some row reads them or ENV 4 (use & 2048, or a row here;
      // ENV 4 itself always runs: lifetime rule (b))
      const use = cp.use | 0;
      m.use = use; m.s1 = cp.s1 ? 1 : 0;
      const su = m.srcUsed;
      m.x4On = (use & 2048) !== 0 || su[ESRC[3]] || su[LSRC[8]] || su[LSRC[9]] || su[LYSRC[8]] || su[LYSRC[9]] ? 1 : 0;
      let lu = 0;
      for (let l = 0; l < N_LFO; l++) if (su[LSRC[l]] || su[LYSRC[l]]) lu |= 1 << l;
      m.lUse = lu;
      // keyboard swing (§7.2) for swung BPM LFOs
      const pp = proc.p, sq = pp && pp.serum === cp ? pp.seq : null, kb = sq && sq.kbd;
      let sw = kb ? +kb[3] : 0;
      sw = sw === sw ? (sw > -1 ? (sw < 1 ? sw : 1) : -1) : 0;
      m.swing = sw;
      let k2 = 0, k3 = 0, k3e = 0;
      for (let l = 0; l < N_LFO; l++) {
        const md = cp.lfoMode ? cp.lfoMode[l] | 0 : 2;
        const mode = md >= 0 && md <= 2 ? md : 2;
        m.lfoMode[l] = mode;
        m.lfoBpm[l] = cp.lfoBpm && cp.lfoBpm[l] ? 1 : 0;
        m.lfoAnchor[l] = cp.lfoAnchor && cp.lfoAnchor[l] ? 1 : 0;
        let L = cp.lfoLadN ? cp.lfoLadN[l] | 0 : 15;
        L = L >= 1 ? (L <= 43 ? L : 43) : 1;
        m.lfoLadN[l] = L;
        for (let j = 0; j < 43; j++) { const v = cp.lfoLad ? +cp.lfoLad[l * 43 + j] : 0; m.lfoLad[l * 43 + j] = v > 0 ? v : 0; }
        // without lfoMono a FREE LFO is the Phase-1 Off mode (processor)
        const mono = cp.lfoMono ? (cp.lfoMono[l] ? 1 : 0) : (mode === 2 ? 1 : 0);
        let ty = cp.lfoType ? cp.lfoType[l] | 0 : 0;
        if (!(ty >= 0 && ty <= 4)) ty = 0;
        let dir = cp.lfoDir ? cp.lfoDir[l] | 0 : 0;
        if (!(dir >= 0 && dir <= 2)) dir = 0;
        const bpm = m.lfoBpm[l], x10 = u8(cp.lfoX10, l, 0), swf = u8(cp.lfoSwing, l, 0);
        m.lfoMono[l] = mono; m.lfoType[l] = ty; m.lfoDir[l] = dir; m.lfoX10[l] = x10; m.lfoSwing[l] = swf;
        const kind = mode === 2 ? (mono ? K_OFF : K_FREE) : (mono ? K_MONO : K_VOICE);
        m.lKind[l] = kind;
        if (kind === K_FREE) k2 = 1;
        if (kind === K_MONO) { k3 = 1; if (mode === 1) k3e = 1; }
        // HOST in Hz: S2 mode only (§6.21 item 5); swing only with BPM and a non-zero kbd.swing
        const hh = !m.s1 && !bpm && m.lfoAnchor[l] ? 1 : 0;
        if (hh !== 0 && m.hostHz[l] === 0) m.hAnc = 1;            // a new Hz-HOST LFO anchors at the next span
        m.hostHz[l] = hh;
        m.lSw[l] = bpm && swf && sw !== 0 ? sw : 0;
        m.lExt[l] = dir !== 0 || ty !== 0 || (x10 && !bpm) || m.lSw[l] !== 0 || m.hostHz[l] !== 0 ? 1 : 0;
        // Y output of a non-Path LFO is 0 (§3.10): clear what a former Path type left in the processor's Y state (the
        // Phase-1 fast path offLfo never writes the Y row)
        if (ty !== T_PATH) {
          const j = LYSRC[l] * MAXCH;
          m.g.fill(0, j, j + MAXCH); m.monoSrc[LYSRC[l]] = 0;
          m.oSmY[l] = 0; m.oY0Y[l] = 0; m.oValY[l] = 0;
        }
      }
      m.k2Any = k2; m.k3Any = k3; m.k3Env = k3e;
      // pre-restart pass (§6.2): slots the note-on restarts read — PHASE of every LFO, Start of ENV 2–4, the Voice
      // Control amounts and the envelope time scale (vc.escale, sampled at note-on, §6.16), and the rate + LFO scale of
      // per-voice Hz-HOST LFOs (their restart phase uses the rate)
      const pm = m.preMask;
      pm.fill(0);
      for (let l = 0; l < N_LFO; l++) {
        pm[L1_PHASE + l] = 1;
        if (m.hostHz[l] !== 0 && m.lKind[l] === K_VOICE) { pm[LRATE[l]] = 1; pm[VC_LSCALE] = 1; }
      }
      for (let e = 1; e < N_ENV; e++) pm[ESTART[e]] = 1;
      for (let i = VC_PAN; i <= VC_ESCALE; i++) pm[i] = 1;
      let pn = 0, pd = 0;
      for (let r = 0; r < mN; r++) {
        const d = m.mDst[r], on = (m.mCtx[r] & 1) !== 0 && pm[d] !== 0 ? 1 : 0;
        m.mPre[r] = on;
        if (on === 0) continue;
        pn++;
        let dup = false;
        for (let j = 0; j < pd; j++) if (m.preD[j] === d) { dup = true; break; }
        if (!dup) m.preD[pd++] = d;
      }
      for (let r = mN; r < NROW; r++) m.mPre[r] = 0;
      m.preN = pn; m.preDN = pd;
      for (let k = 0; k < 2; k++) {
        m.chaosMono[k] = cp.chaosMono && cp.chaosMono[k] ? 1 : 0;
        m.chaosSh[k] = cp.chaosSh && cp.chaosSh[k] ? 1 : 0;
      }
      for (let i = 0; i < N_MACRO; i++) m.macroT[i] = clamp01(cp.macro ? +cp.macro[i] : 0);
      m.cMono = cp.mono ? 1 : 0; m.cLegato = cp.legato ? 1 : 0;
      m.cAlways = cp.always ? 1 : 0; m.cScaled = cp.scaled ? 1 : 0;
      m.cPoly = cp.poly > 0 ? cp.poly | 0 : 8;
      const sm = cp.smooth > 0 ? +cp.smooth : 1;
      m.smooth = sm < 0.01 ? 0.01 : sm > 8 ? 8 : sm;
      m.veloPorta = cp.veloPorta ? 1 : 0; m.notePorta = cp.notePorta ? 1 : 0;   // CP fields of §2.2 velo/note.porta
      // envelopes (§6.14)
      let li = 0;
      for (let e = 0; e < N_ENV; e++) {
        m.envBpm[e] = u8(cp.envBpm, e, 0); m.envLegInv[e] = u8(cp.envLegInv, e, 0); m.envStealRe[e] = u8(cp.envStealRe, e, 0);
        if (m.envLegInv[e]) li = 1;
      }
      m.anyLegInv = li;
      for (let j = 0; j < 16; j++) { const v = cp.envLad ? +cp.envLad[j] : ENV_LAD0[j]; m.envLad[j] = v > 0 ? v : 0; }
      // Voice Control (§6.16), MPE (§6.17), tuning (§6.18)
      m.vcOn = use & 1024 ? 1 : 0;
      let vl = cp.vcLen | 0;
      m.vcLen = vl >= 1 ? (vl <= 8 ? vl : 8) : 1;
      m.vcLMode = cp.vcLMode ? 1 : 0;
      for (let j = 0; j < 48; j++) { const v = cp.vcSteps ? +cp.vcSteps[j] : 0; m.vcSteps[j] = v === v ? (v > -1 ? (v < 1 ? v : 1) : -1) : 0; }
      if (cp.vcRates && cp.vcRates.length === 11) for (let i = 0; i < 11; i++) { const v = +cp.vcRates[i]; m.vcRates[i] = v > 0 ? v : VC_RATES0[i]; }
      else m.vcRates.set(VC_RATES0);
      for (let i = 0; i < 11; i++) m.vcRL[i] = mlog2(m.vcRates[i]);
      m.mpeOn = use & 256 && (cp.mpeOn === undefined || cp.mpeOn) ? 1 : 0;
      m.mpeBendX = cp.mpeBendX ? 1 : 0;
      m.mpeWheelY = m.mpeOn && cp.mpeWheelY ? 1 : 0;
      m.mpeBend = cp.mpeBend > 0 ? +cp.mpeBend : 48;
      let ma = 0;
      for (let i = 0; i < N_MACRO; i++) {
        const v = m.mpeOn && cp.mpeMac ? cp.mpeMac[i] | 0 : -1;
        m.mpeMac[i] = v >= 0 && v <= 2 ? v : -1;
        if (m.mpeMac[i] >= 0) ma = 1;
      }
      m.mpeMacAny = ma;
      m.tunOn = use & 512 && cp.tune ? 1 : 0;
      if (m.tunOn) for (let k = 0; k < 128; k++) { const v = +cp.tune[k]; m.tune[k] = v === v ? v : NaN; }
      if (m.kSm !== m.smooth) rates(m, proc);
      let sounding = false;
      const vs = proc.voices;
      if (vs && vs.length) for (let k = 0; k < vs.length; k++) if (vs[k] && vs[k].active) { sounding = true; break; }
      if (first || !sounding) snapBase(m);
      // the slots the smoothing has to visit (the others are settled: their Phase-1 update is a no-op)
      const s1 = m.smS, s2 = m.smB, bA = m.baseA, bD = m.baseD, un = m.unL;
      let q = 0;
      for (let i = 0; i < NSV; i++) { const t = bT[i]; if (!(s2[i] === t && s1[i] === t && bA[i] === t && bD[i] === 0)) un[q++] = i; }
      m.unN = q;
    }
    // adopt a full CT (§4.1 layout); gen changes when the caller rewrote the same object in place
    function syncCT(proc, sx, ct, gen) {
      const m = sx.mod;
      if (m.ct !== ct || m.ctGen !== gen) {
        m.ct = ct; m.ctGen = gen;
        m.lfoTab = ct.lfoTab; m.lfoPtsOff = ct.lfoPtsOff; m.lfoPts = ct.lfoPts;
        m.lfoPm = ct.lfoPm || DEF_CT.lfoPm; m.lfoPmAny = ct.lfoPmAny || DEF_CT.lfoPmAny;
        m.lfoStart = ct.lfoStart || DEF_CT.lfoStart; m.lfoLoop = ct.lfoLoop || DEF_CT.lfoLoop;
        m.veloTab = ct.veloTab; m.noteTab = ct.noteTab;
        m.pathX = ct.pathX && ct.pathX.length >= N_LFO * 1025 ? ct.pathX : DEF_CT.pathX;
        m.pathY = ct.pathY && ct.pathY.length >= N_LFO * 1025 ? ct.pathY : DEF_CT.pathY;
        m.crvTab = ct.crv && ct.crv.length >= NROW * (CRV_N + 1) ? ct.crv : DEF_CT.crv;
        const nl = ct.lfoTab.length >= N_LFO * 1025 ? N_LFO : 8;
        for (let l = 0; l < nl; l++) m.oY0[l] = ct.lfoTab[l * 1025];
      }
      const cp = m.cp;
      if (cp && ct.key !== '' && typeof cp.ctKey === 'string' && cp.ctKey !== ct.key && m.ctWarn !== cp.ctKey) {
        m.ctWarn = cp.ctKey;
        if (typeof console !== 'undefined') console.warn('sx-mod: CP ctKey', cp.ctKey, 'differs from the stored CT', ct.key);
      }
    }
    // base smoothing once per span of nb base frames (§5.4): two cascaded one-poles, stepped laws jump. Phase-1 code over
    // the slots that are not settled (m.unL, ascending); a settled slot leaves the list once its baseA/baseD are final.
    function smoothSpan(m, nb) {
      const k = 1 - exp(-nb / (m.base * 0.006 * m.smooth));
      const bT = m.bT, s1 = m.smS, s2 = m.smB, bA = m.baseA, bD = m.baseD, mov = m.mov, cont = m.cont;
      const un = m.unL, nxt = m.unP, N = m.unN;
      let n = 0, q = 0;
      for (let j = 0; j < N; j++) {
        const i = un[j], t = bT[i], old = s2[i];
        if (old === t && s1[i] === t) { bA[i] = t; bD[i] = 0; continue; }
        nxt[q++] = i;
        if (cont[i] === 0) { s1[i] = t; s2[i] = t; bA[i] = t; bD[i] = 0; mov[n++] = i; continue; }
        let a = s1[i] + (t - s1[i]) * k, b = old + (a - old) * k;
        const e = t - b;
        if (e < 1e-9 && e > -1e-9) { a = t; b = t; }
        s1[i] = a; s2[i] = b; bA[i] = old; bD[i] = b - old; mov[n++] = i;
      }
      m.movN = n;
      m.unL = nxt; m.unN = q; m.unP = un; m.unPN = N;           // unP = the slots visited in this span
    }
    // Off-mode LFO l at chunk c (raw value through SMOOTH into g), then its phase advance (Phase-1 verbatim: the fast
    // path of a processor FREE LFO whose v2 terms are neutral)
    function offLfo(m, l, c) {
      const E = m.monoEff, kb = LRATE[l], dt = m.dtC;
      const n = E[kb];
      let beats = 0, ph;
      if (m.lfoBpm[l]) beats = m.lfoLad[l * 43 + round(n * (m.lfoLadN[l] - 1))];
      if (beats > 0 && m.lfoAnchor[l]) {
        const x = m.lfoStart[l] + m.beatC[c] / beats;
        ph = x - floor(x);
      } else ph = m.oPh[l];
      m.oPh[l] = ph;
      let y;                                                   // y0 (first point, modulated) for the voices' delay/rise
      if (m.lfoPmAny[l]) { y = pmEval(m, l, ph, E); m.oY0[l] = pmY0; }
      else { y = tabAt(m.lfoTab, l * 1025, 1024, ph); m.oY0[l] = m.lfoTab[l * 1025]; }
      const sm = E[kb + 3];
      if (!m.oInit[l] || !(sm > 0)) { m.oSm[l] = y; m.oInit[l] = 1; }
      else {
        if (sm !== m.oKs[l]) { m.oKs[l] = sm; m.oK[l] = 1 - exp(-dt / (0.5 * sm * sm * sm)); }
        m.oSm[l] += (y - m.oSm[l]) * m.oK[l];
      }
      m.g[LSRC[l] * MAXCH + c] = m.oSm[l];
      if (!(beats > 0 && m.lfoAnchor[l])) {
        const inc = m.lfoBpm[l] ? (beats > 0 ? dt * m.bpm / 60 / beats : 0) : dt * 100 * n * n * n * n;
        let p = ph + inc;
        p -= floor(p);
        m.oPh[l] = p;
      }
      m.oRp[l] = m.oPh[l];
    }
    // an Off-mode LFO that no row reads and no monitor shows: only its phase moves, by the same steps as offLfo (so
    // it is exactly where an evaluated one would be once a row reads it; its smoothing then restarts at its value)
    function offSkip(m, l, nCh) {
      const E = m.monoEff, kb = LRATE[l], dt = m.dtC, n = E[kb];
      let beats = 0;
      if (m.lfoBpm[l]) beats = m.lfoLad[l * 43 + round(n * (m.lfoLadN[l] - 1))];
      if (beats > 0 && m.lfoAnchor[l]) {
        const x = m.lfoStart[l] + m.beatC[nCh - 1] / beats;
        m.oPh[l] = x - floor(x);
      } else {
        const inc = m.lfoBpm[l] ? (beats > 0 ? dt * m.bpm / 60 / beats : 0) : dt * 100 * n * n * n * n;
        let p = m.oPh[l];
        for (let c = 0; c < nCh; c++) { p += inc; p -= floor(p); }
        m.oPh[l] = p;
      }
      m.oInit[l] = 0;
      m.oRp[l] = m.oPh[l];
    }
    // processor clock of a FREE LFO (general path, kinds 1 and 2) at chunk c: the read position (mono-context PHASE offset
    // added, DIRECTION applied) of this chunk; fpPh / fpCy = the clock position (before PHASE and DIRECTION) and cycle of
    // this chunk (per-voice FREE LFOs add their own PHASE); fpCyR = the cycle of the PHASE-shifted position (Ping Pong
    // and S&H count cycles of what is read: phase and cycle are taken together from clock + PHASE); the accumulator then
    // advances. sc = the mono-context LFO scale of the span. BPM + HOST: the Phase-1 closed form, its song anchor offset
    // fB0 re-based by scale changes (rebaseP). Hz HOST while playing: anchored to frac(start + songSeconds·rateHz) at
    // chunk 0 of a span flagged by hAnc (play / seek / loop wrap / new Hz-HOST LFO), integrated in between (header)
    let fpCy = 0, fpPh = 0, fpCyR = 0;
    function freePos(m, l, c, sc) {
      const E = m.monoEff, kb = LRATE[l], dt = m.dtC, n = E[kb], sw = m.lSw[l];
      let beats = 0, ph, cy = m.oCy[l], anch = 0;
      if (m.lfoBpm[l]) beats = ladBeats(m, l, n);
      if (beats > 0 && m.lfoAnchor[l]) {
        const fb = m.fB0[l], bc = fb !== 0 ? m.beatC[c] - fb : m.beatC[c];
        const x = m.lfoStart[l] + (sc !== 1 ? bc * sc : bc) / beats;
        if (sw !== 0) { ph = swingMap(x, sw); cy = swCy; } else { cy = floor(x); ph = x - cy; }
        anch = 1;
      } else if (m.hostHz[l] !== 0 && m.playing !== 0 && m.hAnc !== 0 && c === 0) {
        const x = m.lfoStart[l] + m.beatC[0] * 60 / m.bpm * lfoHz(m, l, E, sc);
        cy = floor(x); ph = x - cy;
      } else ph = m.oPh[l];
      fpCy = cy; fpPh = ph;
      const d = E[L1_PHASE + l];
      let rp = ph, cr = cy;
      if (d !== 0) { const u = ph + d, f = floor(u); rp = u - f; cr = cy + f; }
      fpCyR = cr;
      rp = readPos(m, l, rp, cr);
      m.oRp[l] = rp;
      if (anch === 0) {
        let inc = m.lfoBpm[l] ? (beats > 0 ? dt * m.bpm / 60 / beats : 0) : dt * (m.lfoX10[l] ? 1000 : 100) * n * n * n * n;
        if (sc !== 1) inc *= sc;
        let p = ph;
        if (sw !== 0) {
          let f = odd(cy) ? 1 - 0.75 * sw : 1 + 0.75 * sw;
          p += inc / f;
          for (let g = 0; p >= 1 && g < 64; g++) { const left = (p - 1) * f; cy++; f = odd(cy) ? 1 - 0.75 * sw : 1 + 0.75 * sw; p = left / f; }
          if (p >= 1) p -= floor(p);
        } else {
          p += inc;
          const k = floor(p);
          if (k !== 0) { p -= k; cy += k; }
        }
        m.oPh[l] = p;
      } else m.oPh[l] = ph;
      m.oCy[l] = cy;
      return rp;
    }
    // processor FREE LFO (kind 1) with v2 terms: read position from freePos, type/point modulation with monoEff, SMOOTH
    // on the shared value (Phase-1 Off-mode rule), Y output for Path; S&H draws on every cycle change (whether or not
    // the LFO is read or shown: the shared stream r2p must not depend on the monitor), chaos integration while a row
    // reads it (used = read or monitored, rowU = read by a row)
    function offLfoX(m, l, c, used, rowU) {
      const rp = freePos(m, l, c, m.scM), cy = fpCyR, P = m.P, ty = m.lfoType[l];
      if (ty === T_SH && cy !== m.oCyE[l]) m.oSH[l] = P.rnd2();
      m.oCyE[l] = cy;
      if (!used) { m.oInit[l] = 0; return; }
      const E = m.monoEff;
      const y = rawOf(m, P, l, rp, E), yY = P.lyY;
      m.oY0[l] = P.ly0; m.oY0Y[l] = P.ly0Y;
      const sm = E[LRATE[l] + 3];
      if (!m.oInit[l] || !(sm > 0)) { m.oSm[l] = y; m.oSmY[l] = yY; m.oInit[l] = 1; }
      else {
        if (sm !== m.oKs[l]) { m.oKs[l] = sm; m.oK[l] = 1 - exp(-m.dtC / (0.5 * sm * sm * sm)); }
        m.oSm[l] += (y - m.oSm[l]) * m.oK[l];
        m.oSmY[l] += (yY - m.oSmY[l]) * m.oK[l];
      }
      m.g[LSRC[l] * MAXCH + c] = m.oSm[l];
      m.g[LYSRC[l] * MAXCH + c] = m.oSmY[l];
      if ((ty === T_LORENZ || ty === T_ROSSLER) && rowU) lfoChaos(m, P, l, E, m.dtC, m.scM);
    }
    // processor RETRIG / ENVELOPE LFO (kind 3, §6.15.1) at chunk c: value (DELAY/RISE from the last processor note-on,
    // SMOOTH) into g, then the phase advance (ENVELOPE loops hold while any voice is gated); S&H draws at every wrap,
    // chaos integrates while a row reads it (never gated by the monitor)
    function monoLfo(m, l, c, used, rowU) {
      const P = m.P, E = m.monoEff;
      if (used) {
        const rp = readPos(m, l, P.lPh[l], P.lCy[l]);
        m.oRp[l] = rp;
        const x = lfoOut(m, P, l, E, rawOf(m, P, l, rp, E), m.oTau, m.dtC);
        m.g[LSRC[l] * MAXCH + c] = x;
        m.g[LYSRC[l] * MAXCH + c] = P.lY[l];
      }
      lfoAdvG(m, P, l, E, m.dtC, m.beatC[c] + m.dBeat, m.anyGate, rowU, m.scM);
    }
    // restart of a processor RETRIG / ENVELOPE LFO by a note-on (the caller zeroes oTau and set the note's song position,
    // notePos): start phase (Hz HOST: on the song clock at the note), anchor beat = the note's song beat (BPM HOST), cycle
    // counter, draws from r2p, output at τ = 0 (DELAY/RISE rules) for the note-on evaluation. The shared output is
    // read by every sounding voice: with SMOOTH on it is NOT reset — it glides from its current value to the restarted
    // one (lfoOut) instead of stepping in the voices already sounding; SMOOTH off: the restart value at once
    function monoRestart(m, l) {
      const P = m.P, E = m.monoEff;
      P.lPh[l] = hostStart(m, l, E, startPh(m, l, E), lsc(m, E)); P.lCy[l] = hsCy; P.lDone[l] = 0; P.lB0[l] = nBeat;
      seedLfo(m, P, l);
      const rp = readPos(m, l, P.lPh[l], P.lCy[l]), kb = LRATE[l];
      m.oRp[l] = rp;
      if (E[kb + 3] > 0) return;
      const y = rawOf(m, P, l, rp, E);
      const tsc = m.lfoBpm[l] ? 120 / m.bpm : 1, dr = 4 * (E[kb + 2] + E[kb + 1]) * tsc;
      const x = dr > 0 ? P.ly0 : y, xY = dr > 0 ? P.ly0Y : P.lyY;
      P.lSm[l] = x; P.lVal[l] = x; P.lSmY[l] = xY; P.lY[l] = xY;
    }
    // mono chaos k at chunk c: current output into g, then advance (Phase-1 §6.13)
    function monoChaos(m, k, c) {
      m.g[(S_CHAOS1 + k) * MAXCH + c] = m.chaosSh[k] ? m.mchHold[k] : m.mchOut[k];
      const E = m.monoEff, n = E[C1_RATE + k];
      let rate = 1000 * n * n * n * n * n;
      if (E[C1_BPM + k] >= 0.5 && rate > 0) rate = snapRate(rate, m.bpm);
      if (rate > 0) {
        chaosInt(m.mch, 3 * k, k, rate * CHAOS_T0[k] * m.dtC);
        m.mchOut[k] = chaosOut(m.mch, 3 * k, k);
        if (m.chaosSh[k]) {
          const per = 1 / rate;
          m.mchTim[k] += m.dtC;
          if (m.mchTim[k] >= per) { m.mchTim[k] -= per * floor(m.mchTim[k] / per); m.mchHold[k] = m.mchOut[k]; }
        }
      }
    }
    // the recent voice's ModV (its per-voice sources feed the mono / FX contexts), or null
    function recentMod(m) { const v = m.recent; return v && v.mod ? v.mod : null; }
    // macro targets of the span (§5.6): the base macros[m].v, replaced by a playing clip lane (proc.seqMacro) or by the
    // recent voice's expression value (MPE → macro maps; a voice without expression maps its zero expression, §6.17),
    // plus the mono-context offsets on m1…m8, clamped
    function macroTargets(m, mo) {
      const lane = m.lane, rv = m.mpeMacAny ? recentMod(m) : null;
      for (let i = 0; i < N_MACRO; i++) {
        let b = m.macroT[i];
        if (lane !== null) { const v = lane[i]; if (v === v) b = clamp01(v); }
        if (m.mpeMac[i] >= 0 && rv !== null) b = rv.xpMac(m.mpeMac[i]);
        const o = mo[M1 + i];
        if (o !== 0) b = clamp01(b + o);
        m.macB[i] = b;
      }
    }
    // one span of nCh chunks after the CP/CT sync: smoothing, mono context, per-chunk global sources (§5.5 order)
    function begin(proc, sx, nCh) {
      const m = sx.mod;
      m.nCh = nCh;
      const CH = proc.CH | 0;
      if (CH !== m.CH || +proc.base !== m.base || +proc.fs !== m.fs || m.kSm !== m.smooth) rates(m, proc);
      m.bpm = proc.bpm > 0 ? +proc.bpm : 120;
      // (1) base smoothing for this span
      smoothSpan(m, nCh * 4);
      // (2) mono context from the previous span's monoSrc
      // (monoOff is 0 outside the mono targets; monoEff = clamp(baseA + baseD + monoOff) is recomputed where one of the
      // three may have changed: the slots the smoothing visited, the mono targets, everything after a CP change)
      const mo = m.monoOff, me = m.monoEff, bA = m.baseA, bD = m.baseD, ml = m.monoList, nm = m.monoN;
      for (let j = 0; j < nm; j++) mo[ml[j]] = 0;
      if (m.mN > 0) {
        const rv = recentMod(m), rd = rv !== null ? rv.rd : m.rd0;
        RXD[0] = nCh * m.dtC;
        for (let r = 0; r < m.mN; r++) {
          if (!(m.mCtx[r] & 2)) continue;
          if (m.mX[r] === 0) evalRow(m, r, m.monoSrc, mo);
          else evalRowX(m, r, m.monoSrc, mo, rd, m.pSlew, m.pSlG);
        }
      }
      if (m.meAll !== 0) {
        for (let i = 0; i < NSV; i++) { const v = bA[i] + bD[i] + mo[i]; me[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
        m.meAll = 0;
      } else {
        const ap = m.unP, na = m.unPN;
        for (let j = 0; j < na; j++) { const i = ap[j], v = bA[i] + bD[i] + mo[i]; me[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
        for (let j = 0; j < nm; j++) { const i = ml[j], v = bA[i] + bD[i] + mo[i]; me[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
      }
      // (3) per chunk: performance smoothers, wheel/bend with their G destinations, macros, processor LFOs, mono chaos
      const g = m.g, kF = m.kF, kM = m.kM;
      const sb = typeof proc.songBeat === 'function' ? proc.songBeat() : null;
      const playing = typeof sb === 'number' && sb === sb, wasPl = m.playing;
      m.playing = playing ? 1 : 0;
      const beat0 = playing ? sb : m.beatClk;
      const dB = m.dtC * m.bpm / 60;
      m.dBeat = dB;
      // Hz-HOST re-anchoring: the transport started, or the song position jumped (seek, loop wrap) by more than two chunks;
      // there the BPM + HOST FREE LFOs re-lock to their Phase-1 closed form (song-anchor offsets back to 0)
      let jmp = m.jmp !== 0;                                    // (transport() flags a play / seek it applied)
      m.jmp = 0;
      if (playing) { const dj = sb - m.beatClk; if (wasPl === 0 || dj > 2 * dB || dj < -2 * dB) { m.hAnc = 1; jmp = true; } }
      if (jmp) m.fB0.fill(0);
      // the mono-context LFO scale of this span (once; §14.1) and the re-basing of anchored processor LFOs when it moved
      const scM = me[VC_LSCALE] === 0.5 ? 1 : lsc(m, me);
      m.scM = scM;
      if (scM !== m.scP) { rebaseP(m, beat0, m.scP / scM, !jmp); m.scP = scM; }
      const wh = +proc.wheel || 0, at = +proc.at || 0, bn = +proc.bendRaw || 0;
      macroTargets(m, mo);
      const used = m.srcUsed, mon = sx.mon !== 0;
      // active voices (actv, §5.3) and the gate of processor ENVELOPE loops, counted at the end of the previous span
      const actOn = used[S_ACTV] !== 0 || mon;
      if (actOn || m.k3Env !== 0) {
        let a = 0, gt = 0;
        const vs = proc.voices;
        if (vs && vs.length) for (let k = 0; k < vs.length; k++) { const v = vs[k]; if (v) { if (v.active) a++; if (v.gate) gt = 1; } }
        m.anyGate = gt;
        const pl = m.cMono ? 1 : m.cPoly, x = a / pl;
        m.act = x < 1 ? x : 1;
      }
      let lfoSkip = 0, lfoUse = 0, lfoRow = 0;                  // per LFO bit masks (read or shown; read by a row)
      const scN = me[VC_LSCALE] === 0.5, LW = m.lWork, LK = m.lWorkK;
      let nw = 0;                                               // the LFOs with per-chunk work in this span, and how
      for (let l = 0; l < N_LFO; l++) {
        const k = m.lKind[l], ru = used[LSRC[l]] !== 0 || used[LYSRC[l]] !== 0, u = mon || ru;
        if (u) lfoUse |= 1 << l;
        if (ru) lfoRow |= 1 << l;
        if (k === K_VOICE) continue;
        let w = k === K_OFF ? 1 : k === K_FREE ? 2 : 3;          // 0 offLfo · 1 offLfoX · 2 freePos · 3 monoLfo
        if (k === K_OFF && m.lExt[l] === 0 && scN && me[L1_PHASE + l] === 0 && m.fB0[l] === 0) {
          if (sx.mon === 0 && used[LSRC[l]] === 0) { lfoSkip |= 1 << l; continue; }   // Off LFOs nothing reads: offSkip
          w = 0;
        }
        LW[nw] = l; LK[nw] = w; nw++;
      }
      // macros whose smoothing has settled and whose g rows already hold that value for every chunk need no per-chunk
      // work (the update would add 0; exact); a settled macro fills its row once
      let macW = 0;
      const MF = m.macFill;
      for (let i = 0; i < N_MACRO; i++) {
        const x = m.macS[i];
        if (x !== m.macB[i]) { macW |= 1 << i; MF[i] = NaN; } else if (MF[i] !== x) { g.fill(x, MSRC[i] * MAXCH, MSRC[i] * MAXCH + MAXCH); MF[i] = x; }
      }
      let wS = m.wheelS, aS = m.atS, bS = m.bendS;           // performance smoothers in locals (stored once per span)
      const bC = m.beatC, moW = mo[G_WHEEL], moB = mo[G_BEND];
      for (let c = 0; c < nCh; c++) {
        bC[c] = beat0 + c * dB;
        wS += (wh - wS) * kF;
        aS += (at - aS) * kF;
        bS += (bn - bS) * kF;
        g[S_WHEEL * MAXCH + c] = clamp01(wS + moW);
        g[S_AT * MAXCH + c] = aS;
        g[S_BEND * MAXCH + c] = 2 * clamp01((bS + 1) * 0.5 + moB) - 1;
        if (macW !== 0) {
          for (let i = 0; i < N_MACRO; i++) {
            if ((macW & (1 << i)) === 0) continue;
            m.macS[i] += (m.macB[i] - m.macS[i]) * kM;
            g[MSRC[i] * MAXCH + c] = m.macS[i];
          }
        }
        g[S_FIXED * MAXCH + c] = 1;
        for (let j = 0; j < nw; j++) {
          const l = LW[j], w = LK[j];
          if (w === 0) offLfo(m, l, c);
          else if (w === 1) offLfoX(m, l, c, (lfoUse & (1 << l)) !== 0, (lfoRow & (1 << l)) !== 0);
          else if (w === 2) {                                   // per-voice FREE: the clock, each voice adds its PHASE
            freePos(m, l, c, scM);
            m.fPh[l * MAXCH + c] = fpPh; m.fCy[l * MAXCH + c] = fpCy;
          } else monoLfo(m, l, c, (lfoUse & (1 << l)) !== 0, (lfoRow & (1 << l)) !== 0);
        }
        if (m.k3Any !== 0) m.oTau += m.dtC;
        if (m.chaosMono[0]) monoChaos(m, 0, c);
        if (m.chaosMono[1]) monoChaos(m, 1, c);
        if (actOn) g[S_ACTV * MAXCH + c] = m.act;
      }
      m.wheelS = wS; m.atS = aS; m.bendS = bS;
      if (lfoSkip !== 0) for (let l = 0; l < N_LFO; l++) if ((lfoSkip & (1 << l)) !== 0) offSkip(m, l, nCh);
      if (playing) m.hAnc = 0;                                  // (kept pending while stopped: anchors at the play start)
      m.beatClk = beat0 + nCh * dB;
      if (m.wheelS < 1e-30 && m.wheelS > -1e-30) m.wheelS = 0;                // denormal flush (§0.2)
      if (m.atS < 1e-30 && m.atS > -1e-30) m.atS = 0;
      if (m.bendS < 1e-30 && m.bendS > -1e-30) m.bendS = 0;
      for (let i = 0; i < N_MACRO; i++) if (m.macS[i] < 1e-30 && m.macS[i] > -1e-30) m.macS[i] = 0;
      for (let l = 0; l < N_LFO; l++) {
        if (m.oSm[l] < 1e-30 && m.oSm[l] > -1e-30) m.oSm[l] = 0;
        if (m.oSmY[l] < 1e-30 && m.oSmY[l] > -1e-30) m.oSmY[l] = 0;
      }
      // (4) global sources of the last chunk into monoSrc (read by the next mono context and by fxMods)
      const last = nCh - 1, ms = m.monoSrc;
      ms[S_WHEEL] = g[S_WHEEL * MAXCH + last]; ms[S_AT] = g[S_AT * MAXCH + last]; ms[S_BEND] = g[S_BEND * MAXCH + last];
      for (let i = 0; i < N_MACRO; i++) ms[MSRC[i]] = g[MSRC[i] * MAXCH + last];
      ms[S_FIXED] = 1;
      for (let l = 0; l < N_LFO; l++) {
        const k = m.lKind[l];
        if (k === K_OFF || k === K_MONO) { ms[LSRC[l]] = g[LSRC[l] * MAXCH + last]; ms[LYSRC[l]] = g[LYSRC[l] * MAXCH + last]; }
      }
      for (let k = 0; k < 2; k++) if (m.chaosMono[k]) ms[S_CHAOS1 + k] = g[(S_CHAOS1 + k) * MAXCH + last];
      if (actOn) ms[S_ACTV] = m.act;
    }
    // n base frames of silence in spans of ≤ 128 frames (LFOs, clocks and smoothers keep time); CP/CT synced by the caller
    function idle(proc, sx, n) {
      const OS = proc.OS > 0 ? proc.OS | 0 : 1, CH = proc.CH | 0;
      let rem = n > 0 ? n | 0 : 0;
      while (rem >= 4) {
        const nb = rem > 128 ? 128 : rem - (rem & 3), N = nb * OS;
        let nCh = CH > 0 ? (N / CH) | 0 : 1;
        nCh = nCh > 1 ? (nCh < MAXCH ? nCh : MAXCH) : 1;
        begin(proc, sx, nCh);
        rem -= nb;
      }
    }
    function transport(proc, sx, playing) {
      const m = sx.mod;
      if (!m) return;
      if (!playing) { m.playing = 0; return; }                 // stop (serum-dsp does not forward it today; harmless)
      for (let l = 0; l < N_LFO; l++) { m.oPh[l] = m.lfoStart[l]; m.oInit[l] = 0; m.oRp[l] = m.oPh[l]; }
      const sb = typeof proc.songBeat === 'function' ? proc.songBeat() : null;
      if (typeof sb === 'number' && sb === sb) { m.beatClk = sb; m.playing = 1; }
      m.fB0.fill(0); m.jmp = 1;                                // BPM + HOST FREE LFOs: the Phase-1 closed form at the play position
      seedMonoChaos(m);
      seedProcLfos(m);                                         // processor S&H / chaos LFO states, mono slews, oTau
      proc.vcN = 0;                                            // Voice Control step counter (§6.2)
      // bookkeeping a fresh (offline) processor does not have: portamento start, the recent voice and the mono source
      // vector (back to its attach state; the next begin rewrites the global sources)
      m.lastPitch = -1; m.recent = null;
      m.monoSrc.fill(0); m.monoSrc[S_FIXED] = 1;
      m.hAnc = 1;                                              // Hz-HOST FREE LFOs anchor at the play position
      procArrays(m, proc);                                     // arrays the engine / SxSeq created after the last sync
    }
    // §11.6 reset(sx); serum-dsp passes proc (the rates are re-read), without it the current rates are kept
    function reset(sx, proc) {
      const m = sx.mod;
      if (!m) return;
      init(m, proc && typeof proc === 'object' ? proc : { base: m.base, fs: m.fs, CH: m.CH, OS: m.OS });
    }
    function fxMods(proc, sx) {
      const m = sx.mod, o = m.fxOff;
      if (m.fxDirty > 0) { o.fill(0, 0, m.fxDirty); m.fxDirty = 0; }   // (entries ≥ fxDirty are 0 already)
      if (m.fxN === 0 || !sx.ok) return o;
      const rv = recentMod(m), rd = rv !== null ? rv.rd : m.rd0;
      RXD[0] = m.nCh * m.dtC;
      for (let r = 0; r < m.mN; r++) {
        if (!(m.mCtx[r] & 4)) continue;
        if (m.mX[r] === 0) evalRow(m, r, m.monoSrc, o);
        else evalRowX(m, r, m.monoSrc, o, rd, m.pSlew, m.pSlG);
      }
      m.fxDirty = m.fxHi;
      return o;
    }
    // modulation part of the snapshot (§6.20): s.eff = recent voice eff (or the bases) by vi, then the FX-context eff
    // (FXP base at the same FX-context index + offset, clamped); LFO and envelope monitors of the recent voice; mOut
    function snap(proc, sx, s) {
      const m = sx.mod, eff = s.eff, v = m.recent, mv = v && v.mod, p = proc.p, fxp = p && p.fxr;
      if (v && v.played && mv) for (let i = 0; i < NSV; i++) eff[i] = mv.eff[i];
      else for (let i = 0; i < NSV; i++) eff[i] = m.bT[i];
      const fb = fxp && fxp.base, nf = fb && fb.length < MAXFX ? fb.length : MAXFX;
      for (let k = 0; k < MAXFX; k++) {
        const x = (fb && k < nf ? +fb[k] : 0) + m.fxOff[k];
        eff[NSV + k] = x > 0 ? (x < 1 ? x : 1) : 0;
      }
      for (let l = 0; l < N_LFO; l++) {
        const k = m.lKind[l];
        if (k === K_VOICE) s.lfoPh[l] = mv ? (m.lExt[l] === 0 ? mv.lPh[l] : mv.lRp[l]) : m.oPh[l];
        else if (k === K_FREE && mv) s.lfoPh[l] = mv.lRp[l];           // the recent voice's own PHASE (§6.15.1)
        else s.lfoPh[l] = m.oRp[l];
        s.lfoOut[l] = mv ? mv.lVal[l] : k === K_MONO ? m.oVal[l] : m.oSm[l];
        if (s.lfoY) s.lfoY[l] = mv ? mv.lY[l] : k === K_MONO ? m.oValY[l] : k === K_OFF ? m.oSmY[l] : 0;
      }
      const ne = s.env.length < N_ENV ? s.env.length : N_ENV;
      if (mv) for (let e = 0; e < ne; e++) { s.env[e] = mv.eV[e]; s.envStage[e] = mv.eSt[e]; s.envT[e] = mv.eT[e]; }
      else { s.env.fill(0); s.envStage.fill(0); s.envT.fill(0); }
      const mo = s.mOut;
      if (mo) {
        mo.fill(0);
        const rd = mv ? mv.rd : m.rd0;
        for (let r = 0; r < m.mN; r++) {
          const slot = m.mSlot[r];
          if (slot >= mo.length) continue;
          if ((m.mCtx[r] & 1) !== 0) { if (mv) mo[slot] = rowOut(m, r, mv.src, rd, mv.slew, mv.slG); }
          else mo[slot] = rowOut(m, r, m.monoSrc, rd, m.pSlew, m.pSlG);
        }
      }
    }

    /* ------------------------------------------------------------ per-voice modulation (ModV) */
    class ModV {
      constructor(voice) {
        this.v = voice;
        this.m = voice.proc.sx.mod;                              // the processor's modulation state (attach first)
        this.dt = voice.dt > 0 ? +voice.dt : 8 / 96000;
        this.hasR2 = typeof voice.rnd2 === 'function';
        this.eff = new Float64Array(NSV); this.off = new Float64Array(NSV); this.src = new Float64Array(NSRC);
        this.src[S_FIXED] = 1;
        this.md = new Uint8Array(NSV); this.mdCp = null;          // modded mask of the CP this voice last evaluated
        this.eOn = new Float64Array(N_ENV);                       // envelope values before a note-on restart (§6.1)
        // envelopes (stage 0 idle, 1 A, 2 H, 3 D, 4 S, 5 R); eScale = time multiplier of the current chunk
        this.eSt = new Int32Array(N_ENV); this.eQ = new Float64Array(N_ENV); this.eV = new Float64Array(N_ENV);
        this.eV0 = new Float64Array(N_ENV); this.eVR = new Float64Array(N_ENV); this.eT = new Float64Array(N_ENV);
        this.eScale = 1;
        // LFOs (phase, cycle counter, read position, smoothing, outputs, S&H value, chaos state, delay value)
        this.lPh = new Float64Array(N_LFO); this.lSm = new Float64Array(N_LFO); this.lVal = new Float64Array(N_LFO);
        this.lB0 = new Float64Array(N_LFO); this.lDone = new Uint8Array(N_LFO); this.lK = new Float64Array(N_LFO);
        this.lSk = new Int32Array(N_LFO);                      // chunks a skipped per-voice LFO still owes its phase (advance)
        this.lKs = new Float64Array(N_LFO).fill(-1); this.lY = new Float64Array(N_LFO); this.ly0 = 0;
        this.lCy = new Float64Array(N_LFO); this.lRp = new Float64Array(N_LFO); this.lSmY = new Float64Array(N_LFO);
        this.lSH = new Float64Array(N_LFO); this.lCh = new Float64Array(3 * N_LFO); this.lV0 = new Float64Array(N_LFO);
        this.ly0Y = 0; this.lyY = 0;
        this.lScP = 1;                                            // LFO scale of the last advance (anchor re-basing, rebaseV)
        this.tau = 0;
        // chaos (per voice, S1 sources 17/18)
        this.ch = new Float64Array(6); this.cOut = new Float64Array(2); this.cHold = new Float64Array(2); this.cTim = new Float64Array(2);
        // note-on values
        this.vVelo = 0; this.vNote = 0; this.vR1 = 0; this.vR2 = 0; this.vAlt = 0; this.patS = 0; this.relvel = 0.5;
        // pitch / portamento
        this.nP = 60; this.gS = 60; this.gTg = 60; this.gQ = 1;
        // matrix v2: randd draws per slot, slew state per slot and its generation (−1 = restart at the next evaluation)
        this.rd = new Float64Array(NROW); this.slew = new Float64Array(NROW); this.slG = new Int32Array(NROW).fill(-1);
        // Voice Control (§6.2): this note's step values, offsets [panO, detO, cutO, envS] and draws u₁…u₄
        this.vcOn = 0; this.vc = Float64Array.of(0, 0, 0, 1); this.vcU = new Float64Array(4);
        this.vK = 0; this.vIdx = 0; this.vM1 = 0; this.vM2 = 0;
        // MPE / note expression (§6.17): member channel, generated-note expression, smoothed x/y/z/bend and targets
        this.mpeCh = 0; this.ex = new Float64Array(3); this.exOn = 0; this.xpOn = 0;
        this.xS = 0; this.yS = 0; this.zS = 0; this.bS = 0; this.tx = 0; this.ty = 0; this.tz = 0; this.tb = 0; this.mpeSt = 0;
      }
      // chunk duration of the voice (voice.apply); changed = the rate changed (LFO smoothing coefficients are stale)
      setDt(dt, changed) {
        this.dt = dt;
        if (changed) this.lKs.fill(-1);
      }
      envVal(e) { return this.eV[e]; }
      lfoVal(l) { return this.lVal[l]; }
      // one draw of the voice's Phase-2 stream r2 (§6.2)
      rnd2() {
        const v = this.v;
        if (this.hasR2) return v.rnd2();
        v.r2 = xorshift(v.r2) || 1;
        return v.r2 / 4294967296;
      }
      // §6.19 rule (b): all four envelopes have finished (stage 0 — idle at 0, or holding its End level after the release:
      // inv B13 "terminates after the longest release of any of the envelopes"), ENV 4 included whether or not a row
      // reads it (it runs on every voice, advance)
      envsIdle() {
        const s = this.eSt;
        return s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0;
      }
      // expression targets of this voice (member channel → proc.mpe, else the generated note's x/y/z)
      xpTarget() {
        if (this.mpeCh > 0) {
          const P = this.m.mpeA, j = this.mpeCh * 4;
          if (P && P.length >= j + 4) {
            const b = +P[j] || 0;
            this.tb = b; this.ty = +P[j + 1] || 0; this.tz = +P[j + 2] || 0; this.tx = this.m.mpeBendX ? b : +P[j + 3] || 0;
            return;
          }
          this.tb = 0; this.tx = 0; this.ty = 0; this.tz = 0;
        } else { this.tb = 0; this.tx = this.ex[0]; this.ty = this.ex[1]; this.tz = this.ex[2]; }
      }
      // per chunk: expression smoothing (τ 1.5 ms, the Phase-1 performance coefficient) and the per-note bend
      xpTick() {
        this.xpTarget();
        const k = this.m.kF;
        this.xS += (this.tx - this.xS) * k; this.yS += (this.ty - this.yS) * k; this.zS += (this.tz - this.zS) * k;
        this.bS += (this.tb - this.bS) * k;
        if (this.bS < 1e-30 && this.bS > -1e-30) this.bS = 0;                // denormal flush (§0.2)
        if (this.xS < 1e-30 && this.xS > -1e-30) this.xS = 0;
        if (this.yS < 1e-30 && this.yS > -1e-30) this.yS = 0;
        if (this.zS < 1e-30 && this.zS > -1e-30) this.zS = 0;
        this.mpeSt = this.mpeCh > 0 ? this.bS * this.m.mpeBend : 0;
      }
      // macro value from an expression dimension (0 X as (x+1)/2, 1 Y, 2 Z)
      xpMac(d) { return clamp01(d === 0 ? (this.xS + 1) * 0.5 : d === 1 ? this.yS : this.zS); }
      // the note's channel / expression (§6.17); a non-legato note restarts the smoothing at the current values. A
      // generated note's ex is x, y, z ∈ [0, 1] as stored in clips (§2.4.2; x neutral 0.5): X = 2x − 1 (bipolar mpex)
      xpNote(ch, ex, legato) {
        const m = this.m;
        this.mpeCh = m.mpeOn && ch >= 2 && ch <= 16 ? ch | 0 : 0;
        if (this.mpeCh === 0 && ex && ex.length >= 3) {
          const a = +ex[0], b = +ex[1], c = +ex[2];
          this.ex[0] = a === a ? 2 * clamp01(a) - 1 : 0; this.ex[1] = clamp01(b); this.ex[2] = clamp01(c);
          this.exOn = 1;
        } else { this.exOn = 0; this.ex[0] = 0; this.ex[1] = 0; this.ex[2] = 0; }
        this.xpOn = this.mpeCh > 0 || this.exOn ? 1 : 0;
        if (this.xpOn === 0) { this.xS = 0; this.yS = 0; this.zS = 0; this.bS = 0; this.mpeSt = 0; return; }
        if (!legato) {
          this.xpTarget();
          this.xS = this.tx; this.yS = this.ty; this.zS = this.tz; this.bS = this.tb;
          this.mpeSt = this.mpeCh > 0 ? this.bS * m.mpeBend : 0;
        }
      }
      // the level an envelope restarts from (§6.14): a sounding voice keeps its level (steal), unless Voice Steal
      // Retrigger; otherwise the Start level (ENV 2–4 eff eN.start; ENV 1: 0)
      startLvl(e, wasActive) {
        if (wasActive && this.m.envStealRe[e] === 0) return this.eV[e];
        return e > 0 ? this.eff[ESTART[e]] : 0;
      }
      envRestart(e, v0) {
        this.eSt[e] = 1; this.eQ[e] = 0; this.eT[e] = 0; this.eV[e] = v0; this.eV0[e] = v0;
        this.envTick(e, 0);
      }
      // envelope time multiplier of the note (§6.14, §6.16: vc.* are sampled at note-on, vc.lscale excepted): envS (Voice
      // Control) × eff vc.escale after the pre-restart pass, each skipped when neutral; taken at the note-ons that start
      // envelopes (non-legato, and legato ones with Legato Inverted envelopes) and kept for the note
      escale() {
        const n = this.eff[VC_ESCALE];
        let s = this.vc[3];
        if (n !== 0.5) s *= 0.25 * pow(16, n);
        this.eScale = s;
      }
      // the modulation part of a note-on (Phase-1 serum-dsp noteOn + §6.2): the voice has stored note/vel/gate, checked
      // its CP, flipped sx.alt and re-seeded its streams r / r2 (non-legato); R = the poly-legato reference (ModV) or null
      noteOn(n, vel01, legato, R, ch, ex, other) {
        const v = this.v, proc = v.proc, sx = proc.sx, m = this.m, wasActive = v.active;
        // a hidden warm-up voice of serum-dsp (hid 1 first-use, 2 Granular job) leaves the processor alone: no MONO LFO
        // restart (no r2p draws), no oTau reset, never the recent voice (vcN, recent, lastPitch: serum-dsp hwSave/hwRestore)
        const hid = v.hid > 0;
        notePos(m, proc);                                           // the note's song position (HOST anchors)
        if (!legato) {
          this.vR1 = v.rnd(); this.vR2 = v.rnd(); this.vAlt = sx.alt;
          this.relvel = 0.5;
        }
        // tuned pitch of the key (§6.18): NOTE source and portamento glide between tuned pitches
        let np = n;
        if (m.tunOn !== 0) { const k = n | 0; if (k === n && k >= 0 && k < 128) { const t = m.tune[k]; if (t === t) np = t; } }
        this.vNote = tabAt(m.noteTab, 0, 128, np / 127);            // also on legato notes (the new key, §5.3)
        if (!legato || m.veloPorta) this.vVelo = tabAt(m.veloTab, 0, 128, vel01);
        this.xpNote(ch, ex, legato);
        // modulation vector of a fresh voice starts at the current bases; a sounding one drops removed rows first
        const eff = this.eff, bA = m.baseA, bD = m.baseD;
        if (!wasActive) {
          const md = m.modded, vm = this.md;
          for (let i = 0; i < NSV; i++) { eff[i] = bA[i] + bD[i]; vm[i] = md[i]; }
          this.mdCp = m.cp;
        } else this.unmod(1);
        // portamento (§6.1)
        const lastPitch = m.lastPitch;
        const pt = 8 * pow(eff[G_PORTA], 5);
        const overlap = legato || (m.cMono === 1 && proc.held && proc.held.length > 1) || (m.cMono === 0 && other);
        let start = np;
        if (pt > 0 && (m.cAlways === 1 || overlap)) start = R ? R.nP : lastPitch >= 0 ? (legato ? this.nP : lastPitch) : np;
        this.gS = start; this.gTg = np; this.gQ = start === np ? 1 : 0; this.nP = start;
        if (legato) {
          // Legato Inverted (§6.14): those envelopes restart as on a steal (their Start levels from the pre-restart pass
          // over the current sources with this note's VELO / NOTE)
          if (m.anyLegInv !== 0) {
            if (m.preN !== 0) {
              const src = this.src;
              src[S_VELO] = this.vVelo;
              if (m.notePorta === 0) src[S_NOTE] = this.vNote;
              for (let e = 0; e < N_ENV; e++) src[ESRC[e]] = this.eV[e];
              this.prePass();
            }
            this.escale();
            for (let e = 0; e < N_ENV; e++) if (m.envLegInv[e]) this.envRestart(e, this.startLvl(e, true));
          }
          // processor RETRIG / ENVELOPE LFOs restart at every note-on of the processor (§6.15.1), legato ones included
          if (m.k3Any !== 0 && !hid) {
            for (let l = 0; l < N_LFO; l++) if (m.lKind[l] === K_MONO) monoRestart(m, l);
            m.oTau = 0;
          }
          if (!hid) m.recent = v;
          return;
        }
        // Phase-2 draws (r2, header order): randd per slot, Voice Control
        if (m.anyRd !== 0) for (let k = 0; k < NROW; k++) this.rd[k] = this.rnd2();
        if (m.vcOn !== 0) {
          let N = +proc.vcN;
          N = N >= 0 ? floor(N) : 0;
          const L = m.vcLen, k = N % L;
          proc.vcN = N + 1;                                        // (hidden voices too: hwRestore resets it)
          this.vK = k; this.vIdx = k / L; this.vM1 = m.vcSteps[k * 6 + 4]; this.vM2 = m.vcSteps[k * 6 + 5];
          for (let j = 0; j < 4; j++) this.vcU[j] = 2 * this.rnd2() - 1;
          this.vcOn = 1;
        } else if (this.vcOn !== 0) {
          this.vcOn = 0; this.vIdx = 0; this.vM1 = 0; this.vM2 = 0;
          this.vc[0] = 0; this.vc[1] = 0; this.vc[2] = 0; this.vc[3] = 1;
        }
        this.slG.fill(-1);                                         // every slew restarts at its first evaluation
        // chaos per voice (S1 sources; Phase-1 stream r: rand1 and rand2 above, then these six draws — nothing between
        // them draws from r, so the Phase-1 order and count are kept)
        for (let k = 0; k < 2; k++) {
          for (let j = 0; j < 3; j++) this.ch[3 * k + j] = 1 + (2 * v.rnd() - 1);
          this.cOut[k] = chaosOut(this.ch, 3 * k, k); this.cHold[k] = this.cOut[k]; this.cTim[k] = 0;
        }
        // note-on sources (§6.1) that do not depend on the restarts
        const gcL = (m.nCh > 0 ? m.nCh : 1) - 1;
        const src = this.src, gc = gcL, g = m.g;
        src[S_WHEEL] = g[S_WHEEL * MAXCH + gc]; src[S_AT] = g[S_AT * MAXCH + gc]; src[S_BEND] = g[S_BEND * MAXCH + gc];
        for (let i = 0; i < N_MACRO; i++) src[MSRC[i]] = g[MSRC[i] * MAXCH + gc];
        src[S_FIXED] = 1;
        src[S_VELO] = this.vVelo; src[S_NOTE] = this.vNote;
        src[S_PAT] = proc.patSeen && n >= 0 && n < 128 && proc.pat ? +proc.pat[n] || 0 : src[S_AT];
        this.patS = src[S_PAT];
        for (let k = 0; k < 2; k++) {
          src[S_CHAOS1 + k] = m.chaosMono[k] ? g[(S_CHAOS1 + k) * MAXCH + gc] : (m.chaosSh[k] ? this.cHold[k] : this.cOut[k]);
        }
        src[S_NOISE] = 0; src[S_RAND1] = this.vR1; src[S_RAND2] = this.vR2; src[S_ALT1] = this.vAlt; src[S_ALT2] = 1 - this.vAlt;
        if (this.xpOn !== 0) {
          src[S_MPEX] = this.xS; src[S_MPEY] = m.srcBi[S_MPEY] ? 2 * this.yS - 1 : this.yS; src[S_MPEZ] = this.zS;
        } else { src[S_MPEX] = 0; src[S_MPEY] = 0; src[S_MPEZ] = 0; }
        // Y → wheel (§6.17) for every voice: member channel or generated-note Y; a voice without expression has Y = 0
        // (as the MPE → macro maps: its zero expression, never the global wheel)
        if (m.mpeWheelY !== 0) src[S_WHEEL] = this.xpOn !== 0 ? this.yS : 0;
        // MPE → macro maps per voice (§6.17); a voice without expression maps its zero expression
        if (m.mpeMacAny !== 0) for (let i = 0; i < N_MACRO; i++) if (m.mpeMac[i] >= 0) src[MSRC[i]] = this.xpMacSrc(i);
        src[S_RELVEL] = 0.5;
        src[S_ACTV] = g[S_ACTV * MAXCH + gc];
        src[S_VIDX] = this.vIdx; src[S_VMOD1] = this.vM1; src[S_VMOD2] = this.vM2;
        if (!wasActive) for (let k = S_OSCA; k < S_ACTV; k++) src[k] = 0;     // audio taps: 0 at a fresh voice
        // pre-restart pass (§6.2, header): rows into lN.phase, eN.start, vc.* (and the rate of Hz-HOST LFOs) from this
        // note's sources; envelopes and LFOs at their values before the restart (a fresh voice: its own ones at 0)
        if (m.preN !== 0) {
          for (let e = 0; e < N_ENV; e++) src[ESRC[e]] = wasActive ? this.eV[e] : 0;
          for (let l = 0; l < N_LFO; l++) {
            const k = m.lKind[l];
            let x = 0, xY = 0;
            if (k === K_OFF) { x = g[LSRC[l] * MAXCH + gc]; xY = g[LYSRC[l] * MAXCH + gc]; }
            else if (k === K_MONO) { x = m.oVal[l]; xY = m.oValY[l]; }
            else if (wasActive) { x = this.lVal[l]; xY = this.lY[l]; }
            src[LSRC[l]] = x; src[LYSRC[l]] = xY;
          }
          this.prePass();
        }
        // Voice Control offsets with this note's eff amounts (§6.2)
        if (this.vcOn !== 0) {
          const k6 = this.vK * 6, S = m.vcSteps, u = this.vcU;
          this.vc[0] = S[k6] + eff[VC_PAN] * u[0];
          this.vc[1] = 100 * (S[k6 + 1] + eff[VC_DET] * u[1]);
          this.vc[2] = 0.5 * S[k6 + 2] + 0.25 * eff[VC_CUT] * u[2];
          this.vc[3] = pow(2, S[k6 + 3] + eff[VC_ENV] * u[3]);
        }
        this.escale();
        // envelopes (the note-on evaluation sees their values at the restart: the Start level fresh, the current level
        // on a steal, R's level under poly legato; envLegInv envelopes restart as on a steal)
        for (let e = 0; e < N_ENV; e++) {
          if (R && m.envLegInv[e] === 0) {
            this.eOn[e] = R.eV[e];
            this.eSt[e] = R.eSt[e]; this.eQ[e] = R.eQ[e]; this.eV[e] = R.eV[e]; this.eV0[e] = R.eV0[e]; this.eVR[e] = R.eVR[e];
            this.eT[e] = R.eT[e];
            this.envTick(e, 0);
          } else {
            const v0 = this.startLvl(e, wasActive);
            this.eOn[e] = v0;
            this.envRestart(e, v0);
          }
        }
        // LFOs (§6.15): per-voice RETRIG/ENVELOPE restart at their start phase (poly legato copies R's state); per-voice
        // FREE LFOs take new S&H/chaos states; processor RETRIG/ENVELOPE LFOs restart at every note-on (§6.15.1)
        this.tau = R ? R.tau : 0;
        // anchor beat of BPM + HOST LFOs: the note's song beat (§6.12 "beat at the trigger"; S2 mode — S1 mode keeps the
        // Phase-1 processor beat clock, which after a loop wrap still holds the loop end until the next begin), and the
        // LFO scale the anchored forms start from (rebaseV)
        const vB0 = m.s1 !== 0 ? m.beatClk : nBeat, vsc = lsc(m, eff);
        this.lScP = R ? R.lScP : vsc;
        let mono3 = 0;
        for (let l = 0; l < N_LFO; l++) {
          const k = m.lKind[l];
          if (k === K_OFF) continue;
          if (k === K_MONO) { if (!hid) { monoRestart(m, l); mono3 = 1; } continue; }
          this.lSk[l] = 0;
          if (R) {
            this.lPh[l] = R.lPh[l]; this.lB0[l] = R.lB0[l]; this.lDone[l] = R.lDone[l]; this.lSk[l] = R.lSk[l];
            this.lCy[l] = R.lCy[l]; this.lSH[l] = R.lSH[l]; this.lV0[l] = R.lV0[l];
            this.lCh[3 * l] = R.lCh[3 * l]; this.lCh[3 * l + 1] = R.lCh[3 * l + 1]; this.lCh[3 * l + 2] = R.lCh[3 * l + 2];
            continue;
          }
          if (k === K_VOICE) {
            if (m.lExt[l] === 0 && eff[L1_PHASE + l] === 0) { this.lPh[l] = m.lfoStart[l]; this.lCy[l] = 0; }
            else { this.lPh[l] = hostStart(m, l, eff, startPh(m, l, eff), vsc); this.lCy[l] = hsCy; }
            this.lB0[l] = vB0; this.lDone[l] = 0;
          } else this.lCy[l] = this.freeCy(l, gcL);
          if (m.lfoType[l] >= 2) seedLfo(m, this, l);
        }
        if (mono3 !== 0) m.oTau = 0;
        // note-on evaluation (§6.1) of the mOn rows: envelopes and LFOs at their restart values
        for (let e = 0; e < N_ENV; e++) src[ESRC[e]] = this.eOn[e];
        for (let l = 0; l < N_LFO; l++) {
          const k = m.lKind[l], kb = LRATE[l], tsc = m.lfoBpm[l] ? 120 / m.bpm : 1;
          const dr = 4 * (eff[kb + 2] + eff[kb + 1]) * tsc;
          let x, xY = 0;
          if (k === K_OFF) {
            x = dr > 0 ? m.oY0[l] : g[LSRC[l] * MAXCH + gc];
            if (m.lfoType[l] === T_PATH) xY = dr > 0 ? m.oY0Y[l] : g[LYSRC[l] * MAXCH + gc];
          } else if (k === K_MONO) { x = m.oVal[l]; xY = m.oValY[l]; }
          else if (R) { x = R.lVal[l]; xY = R.lY[l]; }
          else if (k === K_VOICE && m.lExt[l] === 0) {
            const y = this.lfoRaw(l, this.lPh[l]);
            x = dr > 0 ? this.ly0 : y;
          } else {
            const rp = k === K_FREE ? this.freeRp(l, gc) : readPos(m, l, this.lPh[l], this.lCy[l]);
            this.lRp[l] = rp;
            const y = rawOf(m, this, l, rp, eff);
            x = dr > 0 ? this.ly0 : y; xY = dr > 0 ? this.ly0Y : this.lyY;
          }
          this.lSm[l] = x; this.lVal[l] = x; src[LSRC[l]] = x;
          this.lSmY[l] = xY; this.lY[l] = xY; src[LYSRC[l]] = xY;
        }
        const off = this.off;
        for (let r = 0; r < m.mN; r++) if (m.mOn[r]) off[m.mDst[r]] = 0;
        RXD[0] = this.dt;
        for (let r = 0; r < m.mN; r++) {
          if (!m.mOn[r]) continue;
          if (m.mX[r] === 0) evalRow(m, r, src, off);
          else evalRowX(m, r, src, off, this.rd, this.slew, this.slG);
        }
        for (let r = 0; r < m.mN; r++) {
          if (!m.mOn[r]) continue;
          const d = m.mDst[r], x = bA[d] + bD[d] + off[d];
          eff[d] = x > 0 ? (x < 1 ? x : 1) : 0;
        }
        if (!hid) m.recent = v;
      }
      // the pre-restart pass (§6.2, header): the voice rows into the slots the restarts read, from the source vector as
      // set by noteOn, into eff (base + offsets, clamped); slewed rows read their source without stepping the slew
      prePass() {
        const m = this.m, off = this.off, eff = this.eff, src = this.src, P = m.preD, np = m.preDN, bA = m.baseA, bD = m.baseD;
        for (let j = 0; j < np; j++) off[P[j]] = 0;
        for (let r = 0; r < m.mN; r++) {
          if (m.mPre[r] === 0) continue;
          if (m.mX[r] === 0) evalRow(m, r, src, off);
          else off[m.mDst[r]] += rowOut(m, r, src, this.rd, this.slew, this.slG);
        }
        for (let j = 0; j < np; j++) { const d = P[j], x = bA[d] + bD[d] + off[d]; eff[d] = x > 0 ? (x < 1 ? x : 1) : 0; }
      }
      // read position of a per-voice FREE LFO at chunk gc: the processor clock + this voice's eff PHASE (skipped at 0,
      // §0.7), DIRECTION by the cycle of that shifted position (§6.15.1 / §6.15.2: phase and cycle taken together, so
      // Ping Pong turns where the read position wraps)
      freeRp(l, gc) {
        const m = this.m, j = l * MAXCH + gc, d = this.eff[L1_PHASE + l];
        let p = m.fPh[j], c = m.fCy[j];
        if (d !== 0) { const u = p + d, f = floor(u); p = u - f; c += f; }
        return readPos(m, l, p, c);
      }
      // cycle of the shifted position (clock + this voice's PHASE) at chunk gc: S&H draws on its changes
      freeCy(l, gc) {
        const m = this.m, j = l * MAXCH + gc, d = this.eff[L1_PHASE + l], c = m.fCy[j];
        return d !== 0 ? c + floor(m.fPh[j] + d) : c;
      }
      // per-voice macro source of an MPE-mapped macro: the voice's expression value + the mono offsets on m_i (§6.17)
      xpMacSrc(i) {
        const o = this.m.monoOff[M1 + i], b = this.xpMac(this.m.mpeMac[i]);
        return o !== 0 ? clamp01(b + o) : b;
      }
      // destinations whose last voice-context row disappeared since this voice last evaluated the matrix (row removed,
      // bypassed, amount 0, re-targeted) return to their base (§5.1); once per CP change
      unmod(fr) {
        const m = this.m;
        if (this.mdCp === m.cp) return;
        this.mdCp = m.cp;
        const md = m.modded, vm = this.md, eff = this.eff, bA = m.baseA, bD = m.baseD;
        for (let i = 0; i < NSV; i++) {
          if (vm[i] !== 0 && md[i] === 0) eff[i] = bA[i] + bD[i] * fr;
          vm[i] = md[i];
        }
      }
      noteOff(rv) {
        this.relvel = rv === undefined || rv === null || !(rv >= 0) ? 0.5 : (rv < 1 ? +rv : 1);
        for (let e = 0; e < N_ENV; e++) {
          if (this.eSt[e] !== 0 && this.eSt[e] !== 5) { this.eVR[e] = this.eV[e]; this.eSt[e] = 5; this.eQ[e] = 0; this.eT[e] = 0; }
        }
      }
      kill() {
        this.eSt.fill(0); this.eQ.fill(0); this.eV.fill(0); this.eT.fill(0);
      }
      // the voice ended (lifetime rule): envelopes idle at 0
      stop() {
        for (let e = 0; e < N_ENV; e++) { this.eSt[e] = 0; this.eV[e] = 0; }
      }
      // step 2a of a chunk: dropped rows back to their base, unmodulated destinations follow the smoothed base
      follow(fr) {
        const m = this.m, eff = this.eff;
        const mv = m.mov, mvN = m.movN, bA = m.baseA, bD = m.baseD, md = m.modded;
        this.unmod(fr);
        for (let j = 0; j < mvN; j++) { const i = mv[j]; if (md[i] === 0) eff[i] = bA[i] + bD[i] * fr; }
      }
      // step 2b: the voice's source vector at the chunk start (gc = chunk of the span for the global sources)
      sources(gc) {
        const v = this.v, m = this.m, s = this.src, g = m.g, used = m.srcUsed, proc = v.proc;
        s[S_WHEEL] = g[S_WHEEL * MAXCH + gc]; s[S_AT] = g[S_AT * MAXCH + gc]; s[S_BEND] = g[S_BEND * MAXCH + gc];
        for (let i = 0; i < N_MACRO; i++) s[MSRC[i]] = g[MSRC[i] * MAXCH + gc];
        s[S_FIXED] = 1;
        s[S_ENV1] = this.eV[0]; s[S_ENV1 + 1] = this.eV[1]; s[S_ENV1 + 2] = this.eV[2]; s[ESRC[3]] = this.eV[3];
        const mon = proc.sx.mon && m.recent === v;
        // per-voice FREE LFOs follow the cycle of the processor clock + their PHASE; an S&H one draws at every cycle change
        // — before any use / monitor test, so the voice stream r2 never depends on what is read or shown (LFO 9/10
        // bypassed: §4.1)
        if (m.k2Any !== 0) {
          const nl = m.x4On !== 0 || m.recent === v ? N_LFO : N_LFO - 2;
          for (let l = 0; l < nl; l++) {
            if (m.lKind[l] !== K_FREE) continue;
            const cy = this.freeCy(l, gc);
            if (cy !== this.lCy[l]) { this.lCy[l] = cy; if (m.lfoType[l] === T_SH) this.lSH[l] = this.rnd2(); }
          }
        }
        // (the LFOs a row reads, m.lUse — every LFO for the monitored voice; none: no loop, M4)
        const lu = mon ? LFO_ALL : m.lUse;
        if (lu !== 0) {
          for (let l = 0; l < N_LFO; l++) if ((lu & (1 << l)) !== 0) { s[LSRC[l]] = this.lfoSrc(l, gc); s[LYSRC[l]] = this.lY[l]; }
        }
        s[S_VELO] = this.vVelo;
        s[S_NOTE] = m.notePorta ? tabAt(m.noteTab, 0, 128, this.nP / 127) : this.vNote;
        if (proc.patSeen) {
          const n = v.note, t = n >= 0 && n < 128 && proc.pat ? +proc.pat[n] || 0 : 0;
          this.patS += (t - this.patS) * m.kF;
          if (this.patS < 1e-30) this.patS = 0;
          s[S_PAT] = this.patS;
        } else { this.patS = s[S_AT]; s[S_PAT] = s[S_AT]; }
        for (let k = 0; k < 2; k++) {
          s[S_CHAOS1 + k] = m.chaosMono[k] ? g[(S_CHAOS1 + k) * MAXCH + gc] : (m.chaosSh[k] ? this.cHold[k] : this.cOut[k]);
        }
        s[S_NOISE] = v.onN ? v.nLast : 0;
        s[S_RAND1] = this.vR1; s[S_RAND2] = this.vR2; s[S_ALT1] = this.vAlt; s[S_ALT2] = 1 - this.vAlt;
        s[S_RELVEL] = this.relvel;
        if (this.xpOn !== 0) {
          this.xpTick();
          s[S_MPEX] = this.xS; s[S_MPEY] = m.srcBi[S_MPEY] ? 2 * this.yS - 1 : this.yS; s[S_MPEZ] = this.zS;
        }
        if (m.mpeWheelY !== 0) s[S_WHEEL] = this.xpOn !== 0 ? this.yS : 0;   // Y → wheel, every voice (§6.17)
        // MPE → macro maps per voice (§6.17); a voice without expression maps its zero expression
        if (m.mpeMacAny !== 0) for (let i = 0; i < N_MACRO; i++) if (m.mpeMac[i] >= 0) s[MSRC[i]] = this.xpMacSrc(i);
        if (used[S_ACTV]) s[S_ACTV] = g[S_ACTV * MAXCH + gc];
      }
      // LFO l source value at the chunk start (Phase-1 §6.12 + §6.15)
      lfoSrc(l, gc) {
        const m = this.m, k = m.lKind[l];
        if (k === K_MONO) {                                       // processor value incl. DELAY/RISE/SMOOTH (begin)
          const x = m.g[LSRC[l] * MAXCH + gc];
          this.lVal[l] = x; this.lY[l] = m.g[LYSRC[l] * MAXCH + gc];
          return x;
        }
        const eff = this.eff, kb = LRATE[l], tsc = m.lfoBpm[l] ? 120 / m.bpm : 1;
        const dly = 4 * eff[kb + 2] * tsc, rise = 4 * eff[kb + 1] * tsc, t = this.tau;
        if (k === K_OFF) {
          const y = m.g[LSRC[l] * MAXCH + gc], y0 = m.oY0[l];
          const x = t < dly ? y0 : (rise > 0 && t < dly + rise ? y0 + (y - y0) * ((t - dly) / rise) : y);
          this.lVal[l] = x;
          if (m.lfoType[l] === T_PATH) {
            const yY = m.g[LYSRC[l] * MAXCH + gc], z0 = m.oY0Y[l];
            this.lY[l] = t < dly ? z0 : (rise > 0 && t < dly + rise ? z0 + (yY - z0) * ((t - dly) / rise) : yY);
          } else this.lY[l] = 0;
          return x;
        }
        if (k === K_VOICE && m.lExt[l] === 0) {                   // Phase-1 Trig/Env
          const y = this.lfoRaw(l, this.lPh[l]), y0 = this.ly0;
          const x = t < dly ? y0 : (rise > 0 && t < dly + rise ? y0 + (y - y0) * ((t - dly) / rise) : y);
          const sm = eff[kb + 3];
          if (sm > 0) {
            if (sm !== this.lKs[l]) { this.lKs[l] = sm; this.lK[l] = 1 - exp(-this.dt / (0.5 * sm * sm * sm)); }
            this.lSm[l] += (x - this.lSm[l]) * this.lK[l];
            if (this.lSm[l] < 1e-30 && this.lSm[l] > -1e-30) this.lSm[l] = 0;
          } else this.lSm[l] = x;
          this.lVal[l] = this.lSm[l];
          this.lY[l] = 0;
          return this.lSm[l];
        }
        // (FREE: its cycle and S&H draws are taken in sources, unconditionally)
        const rp = k === K_FREE ? this.freeRp(l, gc) : readPos(m, l, this.lPh[l], this.lCy[l]);
        this.lRp[l] = rp;
        return lfoOut(m, this, l, eff, rawOf(m, this, l, rp, eff), t, this.dt);
      }
      lfoRaw(l, ph) {
        const m = this.m;
        if (m.lfoPmAny[l]) { const y = pmEval(m, l, ph, this.eff); this.ly0 = pmY0; return y; }
        const T = m.lfoTab, b = l * 1025;
        this.ly0 = T[b];
        return tabAt(T, b, 1024, ph);
      }
      // step 3: voice-context rows → eff of the modded destinations
      matrix(fr) {
        const m = this.m;
        if (m.mN <= 0) return;
        const off = this.off, eff = this.eff, ml = m.modList, mn = m.modN, src = this.src;
        for (let j = 0; j < mn; j++) off[ml[j]] = 0;
        const N = m.mN, ctx = m.mCtx, X = m.mX;
        RXD[0] = this.dt;
        for (let r = 0; r < N; r++) {
          if (!(ctx[r] & 1)) continue;
          if (X[r] === 0) evalRow(m, r, src, off);
          else evalRowX(m, r, src, off, this.rd, this.slew, this.slG);
        }
        const bA = m.baseA, bD = m.baseD;
        for (let j = 0; j < mn; j++) {
          const i = ml[j], x = bA[i] + bD[i] * fr + off[i];
          eff[i] = x > 0 ? (x < 1 ? x : 1) : 0;
        }
      }
      // step 1 of the next chunk: envelopes, LFO phases, chaos and portamento with this chunk's eff values
      advance(gc) {
        const m = this.m, dt = this.dt, eff = this.eff;
        // LFO 9/10 bypass (use & 2048 = 0, §4.1 / §14.1): they run only on the most recent voice (the monitor). ENV 4 runs
        // on every voice: lifetime rule (b) waits for all four envelopes (§6.19), whatever the rows read — read by no row
        // and not shown, only its stage timing matters, so its idle and sustain stages are not ticked
        const x4 = m.x4On !== 0 || m.recent === this.v, s4 = this.eSt[3];
        this.envTick(0, dt); this.envTick(1, dt); this.envTick(2, dt);
        if (x4 || (s4 !== 0 && s4 !== 4)) this.envTick(3, dt);
        // the LFO scale of this chunk, once (§14.1); a change re-bases the BPM + HOST anchors (continuous phase, rebaseV)
        const scN = eff[VC_LSCALE] === 0.5, sc = scN ? 1 : lsc(m, eff), used = m.srcUsed, nl = x4 ? N_LFO : N_LFO - 2;
        if (sc !== this.lScP) { rebaseV(m, this, m.beatC[gc], this.lScP / sc); this.lScP = sc; }
        // (M4 performance, S2 mode) a per-voice LFO whose outputs no row reads, on a voice other than the most recent one
        // (the monitor's), on the plain path: its phase is not advanced chunk by chunk — lSk counts the chunks it owes,
        // paid the first chunk it is needed again (a row starts reading it, another path) by replaying them, op for op as
        // they would have run (exact while its rate did not change; beyond SKIP_MAX chunks one step over the owed time).
        // Its output is read by nothing meanwhile (§14.1: 8 LFOs per voice per chunk). S1 mode never skips (Phase-1
        // equivalence with edits mid-note, §15.1)
        const rec = m.recent === this.v || m.s1 !== 0, lu = m.lUse;
        for (let l = 0; l < nl; l++) {
          const k = m.lKind[l];
          if (k === K_VOICE) {
            const plain = m.lExt[l] === 0 && scN && eff[L1_PHASE + l] === 0, need = rec || (lu & (1 << l)) !== 0;   // (lu: m.lUse)
            if (plain && !need) { this.lSk[l]++; continue; }
            if (this.lSk[l] !== 0) this.lfoOwe(l, dt, gc);
            if (plain) this.lfoAdv(l, dt, gc);
            else lfoAdvG(m, this, l, eff, dt, m.beatC[gc] + m.dBeat, this.v.gate, used[LSRC[l]] !== 0 || used[LYSRC[l]] !== 0, sc);
          } else if (k === K_FREE) {
            const ty = m.lfoType[l];
            if ((ty === T_LORENZ || ty === T_ROSSLER) && (used[LSRC[l]] !== 0 || used[LYSRC[l]] !== 0)) lfoChaos(m, this, l, eff, dt, sc);
          }
        }
        this.tau += dt;
        for (let k = 0; k < 2; k++) if (!m.chaosMono[k] && m.srcUsed[S_CHAOS1 + k]) this.chaosAdv(k, dt);
        if (this.gQ < 1) {
          let T = 8 * pow(eff[G_PORTA], 5);
          if (m.cScaled) { const d = this.gTg - this.gS; T *= (d < 0 ? -d : d) / 12; }
          this.gQ = T > 0 ? this.gQ + dt / T : 1;
          if (this.gQ > 1) this.gQ = 1;
          const c = 2 * eff[G_CURVE] - 1;
          this.nP = this.gS + (this.gTg - this.gS) * (this.gQ >= 1 ? 1 : bend(this.gQ, PORTA_K * c));
        } else this.nP = this.gTg;
      }
      // envelope e over dt seconds (Phase-1 §6.10 + §6.14: BPM units, time scaling, Start/End levels of ENV 2–4)
      envTick(e, dt) {
        const m = this.m, eff = this.eff, b = EB[e], cb = EC[e];
        // (M4) sustain and idle read no stage time: the loop below would only set v (S, or the End level) and t — the
        // common case of a held or finished note, without the four stage times (Phase-1 arithmetic unchanged)
        const st0 = this.eSt[e];
        if (st0 === 4) { const ns = eff[b + 3]; this.eV[e] = e === 0 ? ns * ns : ns; this.eT[e] += dt; return; }
        if (st0 === 0) { this.eV[e] = e === 0 ? 0 : eff[EEND[e]]; return; }
        const na = eff[b], nh = eff[b + 1], nd = eff[b + 2], ns = eff[b + 3], nr = eff[b + 4];
        let A, H, Dt, Rt;
        if (m.envBpm[e] === 0) {
          A = 32 * na * na * na * na * na; H = 32 * nh * nh * nh * nh * nh; Dt = 32 * nd * nd * nd * nd * nd;
          Rt = 32 * nr * nr * nr * nr * nr;
        } else {
          const L = m.envLad, k = 60 / m.bpm;
          A = L[round(na * 15)] * k; H = L[round(nh * 15)] * k; Dt = L[round(nd * 15)] * k; Rt = L[round(nr * 15)] * k;
        }
        const sc = this.eScale;
        if (sc !== 1) { A *= sc; H *= sc; Dt *= sc; Rt *= sc; }
        const S = e === 0 ? ns * ns : ns, E0 = e === 0 ? 0 : eff[EEND[e]];
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
            if (Rt <= 0) { st = 0; q = 0; t = 0; v = E0; break; }
            const nq = q + rem / Rt;
            if (nq < 1) {
              q = nq; t += rem; rem = 0;
              if (E0 === 0) v = this.eVR[e] * (1 - bend(q, ENV_K * (2 * eff[cb + 2] - 1)));
              else v = E0 + (this.eVR[e] - E0) * (1 - bend(q, ENV_K * (2 * eff[cb + 2] - 1)));
              break;
            }
            st = 0; q = 0; t = 0; v = E0; break;
          }
          v = E0; break;                                           // idle: 0 (ENV 1), the End level (ENV 2–4)
        }
        this.eSt[e] = st; this.eQ[e] = q; this.eV[e] = v; this.eT[e] = t;
      }
      // Phase-1 Trig/Env phase advance (the fast path of a per-voice RETRIG/ENVELOPE LFO whose v2 terms are neutral)
      lfoAdv(l, dt, gc) {
        const m = this.m, n = this.eff[LRATE[l]];
        let beats = 0, inc;
        if (m.lfoBpm[l]) {
          beats = m.lfoLad[l * 43 + round(n * (m.lfoLadN[l] - 1))];
          inc = beats > 0 ? dt * m.bpm / 60 / beats : 0;
        } else inc = dt * 100 * n * n * n * n;
        let ph = this.lPh[l];
        if (m.lfoMode[l] === 0) {
          if (beats > 0 && m.lfoAnchor[l]) {
            const x = m.lfoStart[l] + (m.beatC[gc] + m.dBeat - this.lB0[l]) / beats;
            ph = x - floor(x);
          } else { ph += inc; ph -= floor(ph); }
        } else if (!this.lDone[l]) {
          const lp = m.lfoLoop[l], loop = lp >= 0 && lp < 1;
          if (beats > 0 && m.lfoAnchor[l] && (this.v.gate || !loop)) {
            // Env + BPM + Anchor (§6.12): unwrapped position since the trigger, held at 1 or wrapped into the loop while
            // gated; a released looping LFO accumulates from its phase to the end (below)
            const x = m.lfoStart[l] + (m.beatC[gc] + m.dBeat - this.lB0[l]) / beats;
            if (x < 1) ph = x > 0 ? x : 0;
            else if (loop) { const L = 1 - lp; ph = lp + (x - 1) % L; }
            else { ph = 1; this.lDone[l] = 1; }
          } else {
            ph += inc;
            if (ph >= 1) {
              if (loop && this.v.gate) { const L = 1 - lp; ph = lp + (ph - 1) % L; }
              else { ph = 1; this.lDone[l] = 1; }
            }
          }
        }
        this.lPh[l] = ph;
      }
      // pays the chunks a skipped LFO owes (advance)
      lfoOwe(l, dt, gc) {
        const k = this.lSk[l];
        this.lSk[l] = 0;
        if (k > SKIP_MAX) { this.lfoAdv(l, k * dt, gc); return; }
        for (let j = 0; j < k; j++) this.lfoAdv(l, dt, gc);
      }
      chaosAdv(k, dt) {
        const m = this.m, n = this.eff[C1_RATE + k];
        let rate = 1000 * n * n * n * n * n;
        if (this.eff[C1_BPM + k] >= 0.5 && rate > 0) rate = snapRate(rate, m.bpm);
        if (!(rate > 0)) return;
        chaosInt(this.ch, 3 * k, k, rate * CHAOS_T0[k] * dt);
        this.cOut[k] = chaosOut(this.ch, 3 * k, k);
        if (m.chaosSh[k]) {
          const per = 1 / rate;
          this.cTim[k] += dt;
          if (this.cTim[k] >= per) { this.cTim[k] -= per * floor(this.cTim[k] / per); this.cHold[k] = this.cOut[k]; }
        }
      }
      // end of a render of the most recent voice: its sources feed the mono and FX contexts of the next span
      post() {
        const m = this.m, ms = m.monoSrc, s = this.src;
        for (let k = 0; k < NSRC; k++) ms[k] = s[k];
        m.lastPitch = this.nP;
      }
    }

    globalThis.SxMod = Object.freeze({
      VER, NSV, NSRC, NROW, MAXCH, MAXFX, DEF_CT,
      attach, sync, syncCT, begin, idle, transport, reset, fxMods, snap, ModV,
    });
  } catch (err) {
    globalThis.SxMod = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-mod: load failed', err);
  }
})();
