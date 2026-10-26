/*
 * dr-808.js — the drum machines' voice circuits: the TR-808 (stage 7a lane V, IMPL-7a §2), the TR-606 (stage 7b lane V6,
 * IMPL-7b §2), the TR-909 (stage 7c lane V9, IMPL-7c §2) and the SDS-V's voice cards (stage 7d + 8 lane V5, IMPL-8 §12: no
 * sequencer, four memories per card; our reading of its topology with our own values, research-sdsv-circuits.md §6) —
 * classic script, no imports/exports.
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread and in node vm contexts (tests/dsp-scope.mjs
 * `run`). One IIFE publishes the frozen `globalThis.Dr808`; a failure inside leaves Dr808 = null without throwing.
 * Our own circuit-level models of the machines' voice boards, written from the component values of the published
 * schematics (read for values only; the tables per voice: docs/canvas/research-808-circuits.md §16, research-606-circuits
 * .md §15, research-909-circuits.md §16) and the published analyses cited there. No recording of any machine is used: the
 * 909's hi-hat, crash and ride images are our own (tools/rom909.mjs, the generated ROM909 block). One shell, a descriptor
 * per machine (MACH): the 808's constants as 7a built them, the 606's and the 909's knob tables, sounds and lanes;
 * Dr808.gain(kind, drum) the output stage's static gain, Dr808.mach[kind] { KNOB_IDS, KNOB_DEF, SOUNDS (16, by sound id),
 * sids (the ones it has) }; Dr808.proto.tr909 the 909's laws, its ROM decoder (rom9) and the staircase (ENV9) lane R9 reads;
 * the SDS-V's mach entry adds SW_IDS / SW_DEF (its memory keys), Dr808.proto.sdsv its laws (padVolts, sens, vD, minVel, t60),
 * the factory sounds (FACTV), the default trims (TRIMV), the card tables and the SSM2044 (Ota4).
 *
 * Interface (IMPL-7a §11, IMPL-7b §11, IMPL-7c §11, IMPL-8 §12.1): Dr808.create(inst, 'tr808' | 'tr606' | 'tr909' |
 * 'sdsv'[, opt]) → machine (another kind: null)
 *   set(drum)           the flat p.drum (knob positions 0…1, switch indices; models.js ids, §2.3), read once per span
 *   setOS(os, fs)       the Inst's oversampling (fs = base · os); rebuilds every rate-dependent coefficient
 *   hit(sound, v127)    latches a hit of sound 0…15 (SOUNDS) for the next render; v127 → trigger volts (§1.3) — the 909: →
 *                       the hit's accent-DAC code (vTrig9: the velocities 100 / 110 / 119 / 127 name its four states); the
 *                       SDS-V: → the pad's volts (5…75 mV), its channel's SENSITIVITY makes V_D at the hit (a soft hit at a low
 *                       SENSITIVITY fires nothing: the comparator, IMPL-8 §11.4)
 *   trim(t)             (the SDS-V's only) the payload's trims: 5 channels × memories 3, 4 × the six (0…1), copied
 *   trig(mask[, acc])   latches a sequencer step: 12-bit lane mask, bit 0 = accent (§1.2) — the 909: bit 0 TOTAL ACCENT,
 *                       acc the step's per-voice accents (its lanes & 0x83E); the SDS-V (no sequencer, no accent): lanes 1–5
 *                       hit its five at v 100's volts
 *   render(buf, N, F0)  adds every live circuit into buf[0…N) (OS rate, N = n·OS); F0 = the span's absolute base frame
 *   post(L, R, mono, n) base rate: the sample lanes, MASTER VOLUME, the output stage → L / R (full scale)
 *   poll(F0)            the engine's idle skip (no render): the 909's pending chip swap converts (one image a quantum)
 *   live() · reset() · mon() → { lit, act } · smp(slots) (§5: the drum payload's 16 slots { id, on } | null) · setSalt(s)
 *   opt (tests): { noSleep: no circuit ever sleeps, bankOn: the metal bank free-running (never asleep), vcaOn (the 606):
 *   the metal VCAs' bases held at their peak (fully on: the envelopes' discharge through their supply resistors); the 909:
 *   rom { hh, cr, rd } stand-in images (Uint8Array codes) instead of the block's, dacTap: the ROM voices add their DAC's
 *   staircase alone (volts about mid-scale) to the bus }
 *   the 606 reads its open hat's tempo clock from inst.drClock(F) → { t, tpf } (song ticks at frame F, ticks per frame) at
 *   absolute chunk starts while the hat sounds (a stand-in Inst without it: 120 BPM from frame 0)
 * Units are volts, ohms, farads and seconds; the mix bus carries the summing amplifier's output (808 IC4a, 606 IC14A).
 *
 * Time base (D5, §2.1): control-rate work — knob glides, coefficients, the VCAs' supply constants, sleep — runs per
 * absolute 4-base-frame chunk (CH = 4·OS samples); a voice renders a whole span per call but takes those steps at its
 * chunk boundaries, so the same hits render the same bytes whatever splits the spans. Each voice has an attack loop (the
 * trigger, the excitation, the charging envelopes, per sample) and a ringing loop (the same circuit at rest: the settled
 * inputs dropped, envelopes with τ ≥ 15 ms stepped per chunk on the chunk's mean VCA current). Latched hits apply at the
 * first chunk of the next render, in lane order, one trigger per circuit (the highest volts; both sounds of a one-circuit
 * pair in one chunk: the panel switch's). The noise is a hash of the absolute index and the metal oscillators' phases are
 * functions of it; the filters behind them restart from a fixed pre-roll when they wake, so sleep, idle skips and span
 * splits never change what a hit sounds like.
 *
 * Blocks (§2.1): fixed linear networks by the trapezoidal rule (= bilinear) prewarped at the frequency the voice lives
 * at (h_eff = 2/K); networks whose elements move every sample (the bass drum's attack switch, the toms' diodes) by the
 * time-varying trapezoidal rule with plain K = 2·fs, the toms' diode leg implicit (a passive nonlinear resistor). Swing-
 * type VCAs (the metal voices, the snare's noise, the rim shot) are Werner's memoryless model (lower edge, soft switch
 * α 3.5) driven by the coupled base voltage: for the small coupling capacitors a peak tracker with the bias resistor's
 * linear leak (the base-emitter junction clamping through the capacitor), for the rim shot's 10 µF the base node solved
 * with its source resistance (tabulated). The metal bank's oscillators run through the passive summing network and the two
 * band-passes as their periodic steady state (the hardware's band-passes are always fed by free-running oscillators),
 * tabulated per oscillator from the analog responses (with the op-amps' finite GBW). Denormals: every voice that falls
 * below 1e-5 of its trigger scale (≈ −100 dB, IMPL-7a §15 #35) for 4 chunks sleeps with its states zeroed — the clap's
 * reverb, whose bias drains by a 1/t law, fades out 2–2.9 s after its trigger first (its bias capacitors kept; review 1 F4).
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const TAU = 2 * Math.PI, VT = 0.02585;                  // thermal voltage at 300 K
    const BETA = 300, IES = 1e-14, VBE = 0.65, VSAT = 0.1;  // 2SC945(P)-class small-signal transistors (typical)
    const B15 = 15;                                         // the voice board's ± rails
    const GBW = 3e6;                                        // µPC4558 unity-gain frequency (typ.)
    const RW = 50;                                          // pot end / wiper resistance: a pot at 0 is never a short
    // a swing VCA's base, clamped by its junction through the coupling capacitor, carries its bias current near the
    // signal's peaks; KPK = the peak junction current over the bias current there (sets the conducting window) [C]
    let KPK = 4;
    const V_N = 4.0, V_X = 14.0;                            // trigger bus: unaccented, accent ceiling (§1.3) [R]
    const THR = 1e-5;                                       // sleep: 1e-5 of the circuit's trigger scale (§15 #35)
    // the clap's sleep rule (7a review 1 F4): its reverb stage (Q70) fades out from CP_T0 to CP_T1 s after the clap's
    // last trigger, then the circuit sleeps. As read, C138 drains only through Q70's junction — a 1/t law, ≈ 75 s above
    // THR — whose far end (below ≈ −60 dB, past ≈ 1 s) the schematic does not fix (the junction's low-current β,
    // leakage); the fade leaves the first 2 s the circuit's, byte for byte, and costs nothing after 3 s [C]
    let CP_T0 = 2.0, CP_T1 = 2.9;
    const SOUNDS = Object.freeze(['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch', 'lc', 'mc', 'hc', 'cl', 'ma']);
    // sound → circuit, variant (circuits: 0 BD 1 SD 2 LT 3 MT 4 HT 5 RS 6 CP 7 CB 8 CY 9 OH 10 CH 11 MA)
    const S_CIR = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 2, 3, 4, 5, 11]);
    const S_VAR = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
    const S_PAIR = Object.freeze([-1, -1, 11, 12, 13, 14, -1, -1, -1, -1, -1, 2, 3, 4, 5, -1]);   // a one-circuit pair's other
    // lane (pattern bit 1…11) → its sound; the alternate and the switch (index into SW_IDS) that picks it
    const LANE_S = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const LANE_ALT = Object.freeze([-1, -1, -1, 11, 12, 13, 14, 15, -1, -1, -1, -1]);
    const LANE_SW = Object.freeze([-1, -1, -1, 0, 1, 2, 3, 4, -1, -1, -1, -1]);
    const S_SW = Object.freeze([-1, -1, 0, 1, 2, 3, 4, -1, -1, -1, -1, 0, 1, 2, 3, 4]);   // a sound's lane switch
    const NCIR = 12;
    // knobs (§2.3 ids) and their defaults; switches
    const KNOB_IDS = Object.freeze(['ac', 'bdl', 'bdt', 'bdd', 'sdl', 'sdt', 'sds', 'ltl', 'ltt', 'mtl', 'mtt', 'htl', 'htt',
      'rsl', 'cpl', 'cbl', 'cyl', 'cyt', 'cyd', 'ohl', 'ohd', 'chl', 'vol']);
    const KNOB_DEF = Object.freeze([0.5, 0.7, 0.5, 0.5, 0.7, 0.5, 0.5, 0.7, 0.5, 0.7, 0.5, 0.7, 0.5,
      0.7, 0.7, 0.7, 0.7, 0.5, 0.5, 0.7, 0.5, 0.7, 0.75]);
    const NK = 23;
    const SW_IDS = Object.freeze(['lts', 'mts', 'hts', 'rss', 'cps']);
    const K = Object.freeze(Object.fromEntries(KNOB_IDS.map((k, i) => [k, i])));
    // knob → the circuits it retunes (bit = circuit), so a glide recomputes only what moved; 1 << 30 = the output stage
    const KNOB_CIR = Object.freeze([0, 1, 1, 1, 2, 2, 2, 4, 4, 8, 8, 16, 16, 32, 64 | 2048, 128, 256, 256, 256, 512, 512, 1024, 1 << 30]);
    const LEVEL_OF = Object.freeze([K.bdl, K.sdl, K.ltl, K.mtl, K.htl, K.rsl, K.cpl, K.cbl, K.cyl, K.ohl, K.chl, K.cpl]);

    /* ------------------------------------------------------------------ small helpers */
    const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);     // (NaN → 0)
    const tapA = k => (Math.pow(10, 2 * k) - 1) / 99;        // audio taper: ≈ 9 % at mid travel
    const tapC = k => 1 - tapA(1 - k);                       // reverse audio
    const par = (a, b) => a * b / (a + b);
    // vTrig (drum-core's law, §1.3): velocity → trigger volts at accent knob ac (0…1)
    function vTrig(v127, ac) {
      const VA = V_N + ac * (V_X - V_N);
      if (!(v127 >= 1)) v127 = 1;
      if (v127 > 127) v127 = 127;
      if (v127 >= 100) { const u = (v127 - 100) / 27; return (1 - u) * V_N + u * VA; }
      return V_N * (0.6 + 0.4 * (v127 - 1) / 99);
    }
    // the metal voices' buffered bus (IC2a on the voicing board: R18 / D1 clamp the trigger's share, R19 the rest, into a
    // ×31.3 amplifier on the rails): ≈ 6.9 V at the 4 V trigger, its ceiling near 13.8 V at accent [R RC §1]
    const MV_A = (1 + 100e3 / 3.3e3) / (1 / 100e3 + 1 / 15e3 + 1 / 3.3e3);
    const vMetal = V => { const v = MV_A * (V / 100e3 + 0.65 / 15e3); return v < 12.8 ? v : 13.8 - 1 / (v - 11.8); };
    // an op-amp output on the ±15 V rails: linear to 11 V, then a soft knee into ±13.5 V
    function rail(v) {
      const a = v < 0 ? -v : v;
      if (a <= 11) return v;
      const y = 11 + 2.5 * (1 - Math.exp((11 - a) / 2.5));
      return v < 0 ? -y : y;
    }

    // bilinear constant K (s → K (z−1)/(z+1)), prewarped at f0; plain 2·fs when f0 is near or above Nyquist
    function kBil(f0, fs) {
      if (!(f0 > 0) || f0 > 0.42 * fs) return 2 * fs;
      const w = TAU * f0;
      return w / Math.tan(w / (2 * fs));
    }
    // first order (b1 s + b0)/(a1 s + a0) → c[o], c[o+1], c[o+2] = b0, b1, a1 of a TDF-II section
    function bil1(c, o, b1, b0, a1, a0, Kb) {
      const d = a1 * Kb + a0;
      c[o] = (b1 * Kb + b0) / d; c[o + 1] = (b0 - b1 * Kb) / d; c[o + 2] = (a0 - a1 * Kb) / d;
    }
    // second order → c[o…o+4] = B0 B1 B2 A1 A2
    function bil2(c, o, b2, b1, b0, a2, a1, a0, Kb) {
      const K2 = Kb * Kb, d = a2 * K2 + a1 * Kb + a0;
      c[o] = (b2 * K2 + b1 * Kb + b0) / d; c[o + 1] = 2 * (b0 - b2 * K2) / d; c[o + 2] = (b2 * K2 - b1 * Kb + b0) / d;
      c[o + 3] = 2 * (a0 - a2 * K2) / d; c[o + 4] = (a2 * K2 - a1 * Kb + a0) / d;
    }
    // Sallen-Key high-pass (series C1, C2; R1 from their junction to the output, R2 from the amplifier's input to ground;
    // gain G): G s² R1R2C1C2 / (s² R1R2C1C2 + s (R1 (C1 + C2) + (1 − G) R2 C2) + 1)
    function skHP(c, o, C1, C2, R1, R2, G, Kb) {
      const a2 = R1 * R2 * C1 * C2, a1 = R1 * (C1 + C2) + (1 - G) * R2 * C2;
      bil2(c, o, G * a2, 0, 0, a2, a1, 1, Kb);
    }
    // 3×3 inverse of (I − D·A) (D: diagonal step weights) into m (row-major); A row-major
    function inv3(m, a, d0, d1, d2) {
      const m00 = 1 - d0 * a[0], m01 = -d0 * a[1], m02 = -d0 * a[2];
      const m10 = -d1 * a[3], m11 = 1 - d1 * a[4], m12 = -d1 * a[5];
      const m20 = -d2 * a[6], m21 = -d2 * a[7], m22 = 1 - d2 * a[8];
      const c00 = m11 * m22 - m12 * m21, c01 = m12 * m20 - m10 * m22, c02 = m10 * m21 - m11 * m20;
      const r = 1 / (m00 * c00 + m01 * c01 + m02 * c02);
      m[0] = c00 * r; m[1] = (m02 * m21 - m01 * m22) * r; m[2] = (m01 * m12 - m02 * m11) * r;
      m[3] = c01 * r; m[4] = (m00 * m22 - m02 * m20) * r; m[5] = (m02 * m10 - m00 * m12) * r;
      m[6] = c02 * r; m[7] = (m01 * m20 - m00 * m21) * r; m[8] = (m00 * m11 - m01 * m10) * r;
    }
    // a fixed n-state linear network ẋ = A x + B u (n ≤ 5, m ≤ 3), y = C x + D u, by the trapezoidal rule:
    // x' = Ad x + Bd (u + u₋₁). The network is a derivative function f(c, x, u, dx) → y that solves its own resistive
    // nodes; A, B, C, D are probed column by column (no hand algebra to get wrong). Design time only (knob changes).
    class Lin {
      constructor(n, m) {
        this.n = n; this.m = m;
        this.Ad = new Float64Array(n * n); this.Bd = new Float64Array(n * m); this.C = new Float64Array(n); this.D = new Float64Array(m);
        this.x = new Float64Array(n); this.up = new Float64Array(m);
        this.A = new Float64Array(n * n); this.B = new Float64Array(n * m); this.M = new Float64Array(n * n);
        this.w = new Float64Array(n * 2 * n); this.px = new Float64Array(n); this.pu = new Float64Array(m); this.pd = new Float64Array(n);
      }
      design(f, cx, h) {
        const n = this.n, m = this.m, A = this.A, B = this.B, px = this.px, pu = this.pu, pd = this.pd;
        px.fill(0); pu.fill(0);
        for (let j = 0; j < n; j++) { px[j] = 1; this.C[j] = f(cx, px, pu, pd); for (let i = 0; i < n; i++) A[i * n + j] = pd[i]; px[j] = 0; }
        for (let k = 0; k < m; k++) { pu[k] = 1; this.D[k] = f(cx, px, pu, pd); for (let i = 0; i < n; i++) B[i * m + k] = pd[i]; pu[k] = 0; }
        // M = (I − h/2 A)^−1 by Gauss–Jordan on [I − h/2 A | I]
        const w = this.w, W = 2 * n;
        for (let i = 0; i < n; i++) for (let j = 0; j < W; j++) w[i * W + j] = j < n ? (i === j ? 1 : 0) - 0.5 * h * A[i * n + j] : (j - n === i ? 1 : 0);
        for (let c = 0; c < n; c++) {
          let p = c;
          for (let r = c + 1; r < n; r++) if (Math.abs(w[r * W + c]) > Math.abs(w[p * W + c])) p = r;
          if (p !== c) for (let j = 0; j < W; j++) { const t = w[c * W + j]; w[c * W + j] = w[p * W + j]; w[p * W + j] = t; }
          const iv = 1 / w[c * W + c];
          for (let j = 0; j < W; j++) w[c * W + j] *= iv;
          for (let r = 0; r < n; r++) if (r !== c) { const q = w[r * W + c]; if (q !== 0) for (let j = 0; j < W; j++) w[r * W + j] -= q * w[c * W + j]; }
        }
        const M = this.M;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i * n + j] = w[i * W + n + j];
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) { let s = M[i * n + j]; for (let k = 0; k < n; k++) s += 0.5 * h * M[i * n + k] * A[k * n + j]; this.Ad[i * n + j] = s; }
          for (let k = 0; k < m; k++) { let s = 0; for (let l = 0; l < n; l++) s += M[i * n + l] * B[l * m + k]; this.Bd[i * m + k] = 0.5 * h * s; }
        }
      }
      reset() { this.x.fill(0); this.up.fill(0); }
    }
    // the bridged-T in a non-inverting op-amp loop (snare, rim shot GEN1): fixed, 2 states (vCa, vCb), trapezoidal;
    // u at the + input, V_J = u − a, Vo = u − a − b. x' = Ad x + Bd (u + u₋₁) in c[0…5].
    class BT2 {
      constructor() { this.c = new Float64Array(6); }
      design(Ca, Cb, Rbr, Gsh, hEff) {
        const p = 1 / (Rbr * Ca), q1 = (Gsh - 1 / Rbr) / Cb, q2 = -1 / (Rbr * Cb), bb = -Gsh / Cb, h2 = 0.5 * hEff;
        const m00 = 1 + h2 * p, m01 = h2 * p, m10 = -h2 * q1, m11 = 1 - h2 * q2, det = m00 * m11 - m01 * m10;
        const i00 = m11 / det, i01 = -m01 / det, i10 = -m10 / det, i11 = m00 / det;
        const p00 = 1 - h2 * p, p01 = -h2 * p, p10 = h2 * q1, p11 = 1 + h2 * q2, c = this.c;
        c[0] = i00 * p00 + i01 * p10; c[1] = i00 * p01 + i01 * p11; c[2] = i10 * p00 + i11 * p10; c[3] = i10 * p01 + i11 * p11;
        c[4] = i01 * h2 * bb; c[5] = i11 * h2 * bb;
      }
    }
    // a 32-bit integer hash (lowbias32): the noise is a function of the absolute sample index
    function hash32(a) {
      a ^= a >>> 16; a = Math.imul(a, 0x7feb352d); a ^= a >>> 15; a = Math.imul(a, 0x846ca68b); a ^= a >>> 16;
      return a >>> 0;
    }
    // Werner's swing-type VCA (ICMC 2014 §8): the lower edge of the output vs the supply, and the soft switch
    // g(y) = (1 + e^{−αy})^{−1/α} (α 3.5) of y = ln(R_c·I_c / (V_s − V_le)) — both tabulated
    const VLE_N = 512, VLE_MAX = 16, VLE = new Float64Array(VLE_N + 2);
    for (let i = 0; i <= VLE_N + 1; i++) {
      const v = i * VLE_MAX / VLE_N;
      const le = -1.396 * Math.exp(-1.063 * v) + 0.825 * Math.exp(-0.837 * Math.pow(v, 1.447)) + 0.566;
      VLE[i] = le > 0 ? le : 0;
    }
    const vle = v => { if (!(v > 0)) return 0; if (v >= VLE_MAX) return VLE[VLE_N]; const x = v * (VLE_N / VLE_MAX), i = x | 0; return VLE[i] + (VLE[i + 1] - VLE[i]) * (x - i); };
    // what a supply can still swing a VCA's output by (an envelope below its lower edge is silent: sleep's measure)
    const swing = v => { const s = v - vle(v); return s > 0 ? s : 0; };
    const G_LO = -16, G_HI = 12, G_N = 2048, G_SC = G_N / (G_HI - G_LO), GT = new Float64Array(G_N + 2);
    for (let i = 0; i <= G_N + 1; i++) { const y = G_LO + i / G_SC; GT[i] = i === 0 ? 0 : i >= G_N ? 1 : Math.pow(1 + Math.exp(-3.5 * y), -1 / 3.5); }
    // g(y) branch-free (the index clamped: 0 below the table, 1 above); y = (V_b − V_peak) / VT + ln(R_c·I_on / swing)
    const gT = y => { const t = Math.min(Math.max((y - G_LO) * G_SC, 0), G_N), k = t | 0; return GT[k] + (GT[k + 1] - GT[k]) * (t - k); };
    const LG_N = 2048, LG_R = 24, LGT = new Float64Array(LG_N + 2);
    for (let i = 0; i <= LG_N + 1; i++) { const x = -LG_R + i * (2 * LG_R / LG_N); LGT[i] = 1 / (1 + Math.exp(-x)); }
    const logi = x => { if (x <= -LG_R) return 0; if (x >= LG_R) return 1; const t = (x + LG_R) * (LG_N / (2 * LG_R)), i = t | 0; return LGT[i] + (LGT[i + 1] - LGT[i]) * (t - i); };
    const softplus = z => (z > 30 ? z : z < -30 ? 0 : Math.log1p(Math.exp(z)));
    const SP_LO = -16, SP_HI = 24, SP_N = 2560, SP_SC = SP_N / (SP_HI - SP_LO), SPT = new Float64Array(SP_N + 2);
    for (let i = 0; i <= SP_N + 1; i++) SPT[i] = softplus(SP_LO + i / SP_SC);

    /* ------------------------------------------------------------------ component tables (RC §16) */
    // C38 at rest: R156's current through Q42's base junction
    const V38EQ = (() => { let v = 0.6; for (let i = 0; i < 60; i++) { const ib = IES / BETA * Math.exp(v / VT), f = (B15 - v) / 1e6 - ib; v += f / (1 / 1e6 + ib / VT); } return v; })();
    const BD = Object.freeze({ R156: 1e6, C38: 0.1e-6, R157: 8.2e3, R158: 2.7e3, R160: 22e3, R159: 100e3, C39: 0.033e-6,
      R161: 1e6, R162: 4.7e3, R163: 100e3, C40: 0.015e-6, C41: 0.015e-6, C42: 0.015e-6, R165: 47e3, R166: 6.8e3, R167: 1e6,
      R170: 470e3, R164: 47e3, R169: 47e3, C43: 33e-6, VR6: 500e3, R171: 220, R172: 10e3, VR5: 10e3, C45: 0.1e-6,
      C47: 0.47e-6, VR4: 100e3, C49: 0.47e-6, R177: 82e3, R176: 100e3, C50: 1e-6, R174: 100e3, R175: 1e3, RMIX: 22e3,
      // Q43's base-collector leakage, Werner's fit (DAFx-14 eq. 8; V0 is −0.556 V): i = m·softplus(α(V0 − Vcomm))/α
      LA: 14.3150, LV0: -0.5560, LM: 1.4765e-5, DCL: 0.71 });
    const SD = Object.freeze({ R189: 100e3, C57: 6.8e-9, R190: 680, C58: 0.056e-6, C59: 0.027e-6, R196: 680, R197: 820e3,
      R191: 10e3, R192: 220, C60: 6.8e-9, C61: 0.015e-6, R195: 2.2e3, R198: 1e6, C63: 0.047e-6, C65: 0.047e-6, VR8: 100e3,
      R204: 100e3, C56: 22e-9, R194: 2.2e6, C53: 1e-9, R185: 15e3, C52: 0.1e-6, R184: 15e3, C51: 0.47e-6, RQ47: 430,
      VR9: 10e3, R199: 1e3, C66: 1.8e-9, C67: 1.8e-9, R201: 22e3, R202: 47e3, C69: 0.01e-6, R205: 27e3, R210: 470e3,
      C70: 220e-12, VR7: 100e3, RMIX: 33e3 });
    // toms / congas: Ca, Cb (TOM adds Ca2 / Cb2), the trigger's coupling cap C_x, the + input's load R_q (CONGA adds R_t
    // in parallel), the output coupling C_o and feedback C_f, the noise "reverb" path; R_br = R_fb = 820 k, the shunt leg
    // 1 k + the 500 Ω B tuning pot with the 1S188FM pair; output R 100 k
    const TOM = Object.freeze([
      { Ca: 0.056e-6, Ca2: 0, Cb: 0.012e-6, Cb2: 0.047e-6, Cx: 0.0068e-6, Rq: 4.7e3, Rt: 1.5e3, Co: 0.047e-6, Cf: 1e-9,
        Ce: 0.039e-6, Cn: 0.047e-6, Cn1: 0.047e-6, Cn2: 0.018e-6 },
      { Ca: 0.027e-6, Ca2: 0.0082e-6, Cb: 0.012e-6, Cb2: 0.027e-6, Cx: 0.0027e-6, Rq: 6.8e3, Rt: 2.2e3, Co: 0.039e-6, Cf: 1e-9,
        Ce: 0.033e-6, Cn: 0.047e-6, Cn1: 0.033e-6, Cn2: 0.015e-6 },
      { Ca: 0.027e-6, Ca2: 0, Cb: 0.0056e-6, Cb2: 0.022e-6, Cx: 0.0027e-6, Rq: 5.6e3, Rt: 1.5e3, Co: 0.033e-6, Cf: 1e-9,
        Ce: 0.033e-6, Cn: 0.047e-6, Cn1: 0.027e-6, Cn2: 0.01e-6 }]);
    // the toms' shunt leg i(V) (odd, on ±LEG_V; |V_J| peaks near 1.6 V at accent, linear beyond): LEG_S slices over the
    // TUNING travel, shared, blended per knob change (a glide never re-solves the diodes)
    const LEG_N = 512, LEG_V = 2.5, LEG_SC = LEG_N / LEG_V, LEG_S = 32, LEG_W = 2 * LEG_N + 2;
    const TM = Object.freeze({ Rx: 22e3, Rbr: 820e3, Rfb: 820e3, R231: 1e3, VRt: 500, Ro: 100e3, Rn: 100e3, R235: 470e3,
      VRl: 100e3, Re: 4.7e3, R218: 2.2e6, R216: 15e3, R217: 3.3e3, R220: 33e3, R221: 4.7e3, R223: 22e3, R222: 22e3,
      DIS: 6e-8, DIN: 1.2, RMIX: 33e3 });
    const RS = Object.freeze({ C111: 0.01e-6, R307: 100e3, R301: 47e3, R302: 10e3, C116: 0.0047e-6, C115: 0.0047e-6,
      R315: 5.6e3, R316: 1e6, C114: 0.001e-6, R306: 22e3, R310: 33e3, R311: 10e3, C119: 0.0022e-6, C117: 0.0022e-6,
      // R313 reads 390 k: with R308 820 k and C117 = C119 that is a loop gain of 1.05 (a self-oscillating generator at any
      // op-amp GBW); fitted [fit] to the table's 25 ms claves (real units' tolerances decide which side of 1 they sit)
      C118: 0.0022e-6, R312: 1e3, R308: 820e3, R313: 491e3, R318: 220e3, R320: 22e3, R317: 10e3, C120: 10e-6, R321: 2.2e6,
      R107: 1e3, C24: 0.47e-6, R108: 10e3, C121: 0.0047e-6, C122: 0.0047e-6, R322: 10e3, R325: 330e3,
      R324: 68e3,                                           // unprinted on the schematic: fitted [fit] to the table's 3 Vp-p
      C125: 0.01e-6, R326: 10e3, R319: 220e3, R330: 470e3, C153: 22e-12, VR16: 100e3, C112: 0.022e-6, C113: 0.047e-6,
      R305: 1e6, R327: 470e3, JVP: -1.0, JRON: 300, RMIX: 33e3 });
    const CP = Object.freeze({ R332: 27e3, C127: 1.8e-9, R333: 10e3, C128: 0.0047e-6, C129: 0.0047e-6, R334: 100e3,
      // GATE: the 30 ms comparator window [R SN]; VCMP: the recharge threshold giving the ≈ 10 ms saws [fit]; ITAIL: the
      // OTA's bias at full conversion [fit: the table's 2 Vp-p]; VOFF / VACC: the converter's offset and its accent shift
      // through C143 / R362 [fit]; KREV: the reverb stage's gain into IC19 over the path as read (which leaves the tail
      // at −35…−40 dB), fitted [fit] to the table's 100 ms (RC §16: the R342 / R346 divider is the suspect)
      KREV: 4.5,
      C144: 0.47e-6, R365: 82e3, R367: 330, R368: 470e3, R371: 15e3, GATE: 0.030, VCMP: 11.57, ITAIL: 0.40e-3, VOFF: -0.444,
      VACC: 0.01, C136: 0.022e-6, R372: 39e3, R382: 1e3, R383: 82e3, C150: 0.001e-6, R378: 100e3, C139: 0.018e-6, R348: 1e6,
      C138: 0.047e-6, R349: 1e6, R342: 15e3, R346: 680, C137: 0.033e-6, R363: 10e3, R369: 330, C146: 0.018e-6,
      C152: 0.0047e-6, R376: 47e3, R375: 470e3, C149: 220e-12, VR17: 100e3, RMIX: 33e3,
      // maracas: C135 network (Q67), C134 (Q66's base) — the gate's span MAG and the noise level MAK fitted [fit] to
      // the table's 25 / 35 ms and 3 / 5 Vp-p (the gate's topology is the least certain read, RC §6); the HP (Q68)
      C135: 0.1e-6, R345: 150e3, R344: 220e3, R343: 100e3, R341: 470e3, C134: 0.033e-6, MAG: 8.0, MAK: 6.4,
      C131: 0.01e-6, R338: 15e3, C132: 0.001e-6, C133: 0.001e-6, R339: 3.3e3, R340: 68e3, C151: 0.01e-6, R377: 100e3 });
    const CB = Object.freeze({ R62: 33e3, R63: 2.2e3, R30: 470e3, C32: 10e-6, R28: 100e3, R122: 1e3, C9: 0.47e-6, R82: 33e3,
      C34: 1e-6, R26: 10e3, C30: 0.0022e-6, R24: 2.2e3, C28: 0.01e-6, C29: 0.0033e-6, R25: 470e3, C75: 1e-6, R116: 8.2e3,
      VR5: 5e3, C76: 0.022e-6, R117: 22e3, RMIX: 47e3 });
    const MT = Object.freeze({ F: [205.3, 369.6, 304.4, 522.7, 800, 540], DUTY: 0.4798, VOH: 5, RS: 120e3, R53: 1e3,
      R52: 33e3, C10: 0.0033e-6, C13: 0.0068e-6, C14: 0.0068e-6, R56: 560, R57: 82e3,
      R55: 22e3, C11: 0.001e-6, C15: 0.0033e-6, C16: 0.0033e-6, R58: 560, R59: 82e3, CC: 0.022e-6, RB: 2e6 });
    const CY = Object.freeze({ VSM: 0.7258, TSM: 1.0244e-4, VON: 0.5899, VF: 0.6195, C41: 1e-6, R93: 470e3, VR2: 2e6,
      R105: 33e3, C45: 2.2e-6, R104: 22e3, R92: 33e3, R89: 10e3, R91: 33e3, C40: 1e-6, R88: 33e3, C39: 0.47e-6, R90: 33e3,
      // the VCA output nodes rise through their supply resistor into the node capacitor and, through the forward-biased
      // gating diode, the collector's (C50 reads ".00?5": taken as 1.5 n like its neighbours [R?])
      C50: 1.5e-9, C43: 1.5e-9, C38: 1e-6, R87: 22e3, C37: 2.2e-6, R94: 39e3, C47: 1.5e-9, C36: 1.5e-9,
      C48: 1.5e-9, C59: 1.5e-9, R124: 22e3, R127: 82e3, C58: 0.01e-6, R123: 100e3, C57: 0.0033e-6, R121: 10e3,
      C51: 1e-9, C52: 1e-9, R107: 18e3, R113: 18e3, C56: 0.01e-6, R120: 10e3,
      C49: 0.0033e-6, R106: 6.8e3, C53: 1e-9, R108: 18e3, C54: 1e-9, R109: 18e3, G3: 1 + 39 / 22, C55: 0.01e-6, R112: 22e3,
      R119: 22e3, R129: 15e3, VR4: 20e3, R125: 2.2e3, C90: 0.01e-6, R128: 470e3, C77: 220e-12, VR6: 100e3, RMIX: 47e3 });
    const HH = Object.freeze({ R131: 22e3, R130: 10e3, R137: 470, C62: 0.47e-6, R139: 1e6, R134: 100e3, C60: 10e-6,
      R132: 100e3, VR3: 2e6, R133: 10e3, R173: 330e3, R144: 33e3, C64: 1.5e-9, C65: 1.5e-9, C66: 1.5e-9, C68: 1.5e-9,
      R147: 2.7e3, R146: 68e3, C80: 470e-12, R160: 39e3, R159: 470e3, C79: 220e-12, VR7: 100e3, C63: 0.47e-6, R142: 33e3,
      C69: 1.5e-9, C70: 1.5e-9, C72: 1e-9, C73: 1e-9, R153: 2.7e3, R155: 68e3, C74: 470e-12, R162: 33e3, R161: 470e3,
      C82: 220e-12, VR8: 100e3, RMIXO: 56e3, RMIXC: 47e3 });
    const MIX = Object.freeze({ R75: 33e3, C18: 220e-12, C19: 1e-6, VR1: 50e3, C23: 1e-6, R77: 22e3, R76: 33e3, C22: 220e-12,
      ROUT: 1e3, RAIL: 13.5 });
    // the output's full-scale constant (volts at the output amplifier → 1.0; full scale ≈ 0.45 V): §2.5 — the BD at the
    // default knobs, unaccented, peaks at the TB-303's default note at its default volume (0.428, −7.4 dBFS through an
    // empty rack; tests/dr-808.test.mjs). Raised LEVEL / VOLUME and accent drive the track's limiter, as on the hardware.
    const OUT_K = 2.2;
    const mixG = Rm => MIX.R75 / (MIX.ROUT + Rm);           // a voice's gain into the summing amplifier

    /* ------------------------------------------------------------------ the metal bank (steady-state tables) */
    const TN = 2048, TLOG = 11;                             // samples per oscillator period in the tables
    const FRE = new Float64Array(TN), FIM = new Float64Array(TN), FREV = new Uint16Array(TN);
    const FCOS = new Float64Array(TN / 2), FSIN = new Float64Array(TN / 2);
    for (let i = 0; i < TN; i++) { let r = 0; for (let b = 0; b < TLOG; b++) r |= ((i >> b) & 1) << (TLOG - 1 - b); FREV[i] = r; }
    for (let i = 0; i < TN / 2; i++) { FCOS[i] = Math.cos(TAU * i / TN); FSIN[i] = Math.sin(TAU * i / TN); }
    function ifft() { // FRE/FIM ← inverse DFT (no 1/N): radix 2, in place, design time only
      for (let i = 0; i < TN; i++) { const j = FREV[i]; if (j > i) { let t = FRE[i]; FRE[i] = FRE[j]; FRE[j] = t; t = FIM[i]; FIM[i] = FIM[j]; FIM[j] = t; } }
      for (let size = 2; size <= TN; size <<= 1) {
        const half = size >> 1, step = TN / size;
        for (let i = 0; i < TN; i += size) {
          for (let k = 0; k < half; k++) {
            const wr = FCOS[k * step], wi = FSIN[k * step], a = i + k, b = a + half;
            const tr = FRE[b] * wr - FIM[b] * wi, ti = FRE[b] * wi + FIM[b] * wr;
            FRE[b] = FRE[a] - tr; FIM[b] = FIM[a] - ti; FRE[a] += tr; FIM[a] += ti;
          }
        }
      }
    }
    // a metal band-pass's analog response at f (Hz) from the summing node: inverting stage, series R + C into the
    // inverting node, bridged-T feedback (Ca to J, Cb from J to the output, Rbr across, Rsh from J to ground), a one-pole
    // op-amp. Returns [re, im] of Vo / V_bus.
    function bandH(f, R, C, Ca, Cb, Rsh, Rbr, out) {
      const w = TAU * f;
      const den = 1 + (w * R * C) * (w * R * C), yiR = (w * R * C) * (w * C) / den, yiI = (w * C) / den;
      const aI = -(TAU * GBW) / w;                           // A = ω_t / jw = j·aI
      const gb = 1 / Rbr, ga = w * Ca, gcb = w * Cb;
      // KCL at the inverting node Vm and at J, Vo = −A·Vm; complex 2×2 by Cramer
      const a11r = -yiR - gb, a11i = -yiI - ga - aI * gb, a12r = 0, a12i = ga;
      const b1r = -yiR, b1i = -yiI;
      const a21r = gcb * aI, a21i = ga, a22r = -1 / Rsh, a22i = -(ga + gcb);
      const dr = a11r * a22r - a11i * a22i - (a12r * a21r - a12i * a21i), di = a11r * a22i + a11i * a22r - (a12r * a21i + a12i * a21r);
      const nr = b1r * a22r - b1i * a22i, ni = b1r * a22i + b1i * a22r;
      const dd = dr * dr + di * di, vmr = (nr * dr + ni * di) / dd, vmi = (ni * dr - nr * di) / dd;
      out[0] = aI * vmi; out[1] = -aI * vmr;
      return out;
    }

    /* ------------------------------------------------------------------ voices */
    // A voice renders a whole span: run(mb, o, n) adds g·V_out into mb[o…o+n) (n a multiple of CH), taking its chunk-rate
    // steps at the chunk boundaries and going to sleep (states zeroed) at the chunk where it falls quiet. Shared sources
    // (M.wn, M.pn, M.lo, M.hi, M.s5, M.s6, M.v63) are indexed like mb.
    class Voice {
      constructor(M, scale) { this.M = M; this.on = false; this.qn = 0; this.tN = 0; this.tV = 0; this.vo = 0; this.thr = THR * scale; this.act = 0; }
      // a chunk's activity: the voice sleeps after 4 quiet chunks (true: it went to sleep — the caller returns at once)
      quiet(a) {
        if (a > this.act) this.act = a;
        if (a >= this.thr || this.M.noSleep) { this.qn = 0; return false; }
        if (++this.qn < 4) return false;
        this.on = false; this.qn = 0; this.zero();
        return true;
      }
    }

    /* BASS DRUM (RC §2; Werner DAFx-14): trigger → pulse shaper (low shelf, D53 clamp) → bridged-T in IC12's loop with
     * the feedback buffer (DECAY) and the retrigger input, solved together (3 states, time-varying trapezoid); the
     * attack switch Q43 from the envelope network Q41 / C38 / R156 / Q42 / R160 / C39 / D52, whose falling edge is the
     * retrigger pulse through R161; the pitch sigh from Q43's base-collector leakage (Werner's fit) as a source behind
     * the shunt leg; tone low-pass, level, output high-passes. */
    class BassDrum extends Voice {
      constructor(M) {
        super(M, V_N);
        this.cs = new Float64Array(3); this.ct = new Float64Array(3); this.cl = new Float64Array(3); this.co = new Float64Array(3); this.cc = new Float64Array(3);
        this.A = new Float64Array(9); this.B = new Float64Array(9); this.Mi = new Float64Array(9);
        this.rLeg = 0; this.r6 = 0; this.gl = 0; this.gox = 0; this.uMin = 0;
        this.zero();
      }
      zero() {
        this.ss = 0; this.v38 = V38EQ; this.vc39 = VSAT; this.vcm = 0; this.vcm1 = 0; this.eg = 0; this.rp = BD.R165;
        this.a = 0; this.b = 0; this.sa = 0; this.sb = 0; this.sw = 0;
        this.st = 0; this.sl = 0; this.so = 0; this.sc = 0; this.vo = 0; this.tN = 0;
      }
      os() { this.rLeg = 0; this.kn(); }
      // A, B of the bridged-T + feedback buffer for shunt leg R (Q43 / R165 / R166) and the DECAY resistance
      build(R) {
        const P = BD, A = this.A, Bm = this.B, R6 = this.r6, Gk = 1 / P.R164, Rp6 = 1 / (1 / P.R169 + 1 / R6);
        const p = 1 / (P.R167 * P.C41), Gs = 1 / R + 1 / P.R161 + 1 / P.R170, F = Rp6 * Gk / P.R170, gw = Rp6 * Gk / R6;
        A[0] = -p; A[1] = -p; A[2] = 0; Bm[0] = 0; Bm[1] = 0; Bm[2] = 0;
        A[3] = (-1 / P.R167 + Gs + F) / P.C42; A[4] = (-1 / P.R167 + F) / P.C42; A[5] = -Rp6 / (R6 * P.R170) / P.C42;
        Bm[3] = (-Gs - F) / P.C42; Bm[4] = 1 / P.R161 / P.C42; Bm[5] = 1 / R / P.C42;
        A[6] = -gw / P.C43; A[7] = -gw / P.C43; A[8] = (-1 / R6 + Rp6 / (R6 * R6)) / P.C43;
        Bm[6] = gw / P.C43; Bm[7] = 0; Bm[8] = 0;
        const h2 = 0.5 * this.M.h;
        inv3(this.Mi, A, h2, h2, h2);
        this.rLeg = R;
      }
      kn() {
        const M = this.M, P = BD, fs = M.fs, kv = M.kv;
        this.r6 = P.VR6 * clamp01(kv[K.bdd]) + RW;
        this.build(this.rLeg > 0 ? this.rLeg : P.R165 + P.R166);
        bil1(this.cs, 0, P.R162 * P.R163 * P.C40, P.R162, P.R162 * P.R163 * P.C40, P.R162 + P.R163, kBil(49.5, fs));
        // tone: R171 + R172 ∥ VR5 (10 k C taper; TONE 10 = brightest) with C45
        const r5 = P.VR5 * tapC(1 - clamp01(kv[K.bdt])) + RW, req = P.R171 + par(P.R172, r5);
        bil1(this.ct, 0, 0, 1, req * P.C45, 1, kBil(1 / (TAU * req * P.C45), fs));
        // level: C47 into VR4 (100 k A, a divider); the wiper's source impedance into C49 → R177 → R176 (Q44)
        const lv = tapA(clamp01(kv[K.bdl])), rl = P.VR4 * lv, rw = rl * (P.VR4 - rl) / P.VR4, k0 = kBil(49.5, fs);
        bil1(this.cl, 0, P.VR4 * P.C47, 0, P.VR4 * P.C47, 1, k0);
        const ro = rw + P.R177 + P.R176;
        bil1(this.co, 0, ro * P.C49, 0, ro * P.C49, 1, k0);
        this.gl = lv; this.gox = P.R176 / ro;
        const rc = par(P.R174, P.R175 + P.RMIX);              // Q44 → C50 → R174 ∥ (R175 + the bus input)
        bil1(this.cc, 0, rc * P.C50, 0, rc * P.C50, 1, k0);
      }
      fire(V) { this.tV = V; this.tN = this.M.nP; this.on = true; this.qn = 0; this.eg = 1; }
      // a span: the attack loop while the envelope network moves, then the lean ringing loop (the same model at rest)
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.eg !== 0 || this.tN > 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const P = BD, M = this.M, CH = M.CH, h = M.h, h2 = 0.5 * h, cs = this.cs, ct = this.ct, cl = this.cl, co = this.co, cc = this.cc;
        const Bm = this.B, Mi = this.Mi, g = mixG(P.RMIX), glo = this.gl * this.gox, tV = this.tV;
        const isb = IES / BETA, g160 = 1 / P.R160, g161 = 1 / P.R161, g159 = 1 / P.R159, c38 = P.C38, hc39 = h / P.C39;
        const kl = P.LM / P.LA, g157 = 1 / P.R157, i158 = VBE / P.R158, g156 = 1 / P.R156, iVT = 1 / VT, g165 = 1 / P.R165;
        let ss = this.ss, v38 = this.v38, vc39 = this.vc39, vcm = this.vcm, vcm1 = this.vcm1, eg = this.eg;
        let sa = this.sa, sb = this.sb, sw = this.sw, a = this.a, b = this.b, st = this.st, sl = this.sl, so = this.so, sc = this.sc;
        let tN = this.tN, vo = this.vo, rp = this.rp;
        // the coefficients in locals (a typed-array load after every store to mb would be reloaded)
        const cs0 = cs[0], cs1 = cs[1], cs2 = cs[2], ct0 = ct[0], ct1 = ct[1], ct2 = ct[2], cl0 = cl[0], cl1 = cl[1], cl2 = cl[2];
        const co0 = co[0], co1 = co[1], co2 = co[2], cc0 = cc[0], cc1 = cc[1], cc2 = cc[2], b6 = h2 * Bm[6];
        let m0 = Mi[0], m1 = Mi[1], m2 = Mi[2], m3 = Mi[3], m4 = Mi[4], m5 = Mi[5], m6 = Mi[6], m7 = Mi[7], m8 = Mi[8];
        let b3 = h2 * Bm[3], b4 = h2 * Bm[4], b5 = h2 * Bm[5], c = o;
        for (; c < e && (eg !== 0 || tN > 0); c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            // pulse shaper + D53 (a memoryless clamp of the falling edge at about −0.71 V)
            const y = cs0 * vt + ss; ss = cs1 * vt - cs2 * y;
            const u = y < -1e-9 ? -P.DCL * (1 - Math.exp(y / P.DCL)) : y;
            if (u < this.uMin) this.uMin = u;                 // (the clamp's floor, for the tests)
            let vrp;
            if (eg !== 0) {
              // envelope: Q41 discharges C38 while the trigger holds its base up; R156 recharges it; Q42's junction
              const ib41 = (vt - VBE) * g157 - i158;
              const ib42 = isb * Math.exp(Math.min(v38 * iVT, 44));
              const f38 = (B15 - v38) * g156 - ib42 - (ib41 > 0 ? BETA * ib41 : 0);
              v38 += h * f38 / (c38 + h * (g156 + ib42 * iVT));
              if (v38 < 0.02) v38 = 0.02;
              const ic42 = BETA * ib42;
              // the Venv / Vrp node: R160 from B2, Q42, Q43's base (R159), C39 → (D52 ∥ R161 → Vcomm)
              let gq = g159, ven = (B15 * g160 - ic42 + VBE * gq + (vc39 + vcm) * g161) / (g160 + gq + g161);
              if (ven < VBE) { gq = 0; ven = (B15 * g160 - ic42 + (vc39 + vcm) * g161) / (g160 + g161); }
              let sat = 0;
              if (ven < VSAT) { ven = VSAT; sat = 1; }
              let i39;
              vrp = ven - vc39;
              if (vrp > 0.6) {                               // D52 conducts: Vrp clamped, Venv rides on C39
                vrp = 0.6; ven = 0.6 + vc39;
                gq = ven > VBE ? g159 : 0;
                i39 = (B15 - ven) * g160 - ic42 - gq * (ven - VBE);
                if (i39 < (vrp - vcm) * g161) { vrp = ven - vc39; i39 = (vrp - vcm) * g161; }
              } else i39 = (vrp - vcm) * g161;
              vc39 += hc39 * i39;
              // Q43: saturated while its base current lasts (a conductance β·Ib / Vce,sat across R165)
              const ib43 = gq * (ven - VBE), g43 = ib43 > 0 ? BETA * ib43 / VSAT : 0;
              rp = g43 > 0 ? 1 / (g165 + g43) : P.R165;
              const rleg = P.R166 + rp, dr = rleg - this.rLeg;
              if (dr > 1e-7 * rleg || dr < -1e-7 * rleg) {
                this.build(rleg);
                m0 = Mi[0]; m1 = Mi[1]; m2 = Mi[2]; m3 = Mi[3]; m4 = Mi[4]; m5 = Mi[5]; m6 = Mi[6]; m7 = Mi[7]; m8 = Mi[8];
                b3 = h2 * Bm[3]; b4 = h2 * Bm[4]; b5 = h2 * Bm[5];
              }
              // settled: the trigger gone, Q42 saturated again, C38 back at rest → the cheap path below
              if (tN === 0 && sat === 1 && g43 === 0 && v38 > V38EQ - 1e-6) { eg = 0; v38 = V38EQ; }
            } else {
              // at rest Q42 holds Venv at saturation; C39 relaxes through R161 (the tail of the retrigger pulse)
              vrp = VSAT - vc39;
              vc39 += hc39 * (vrp - vcm) * g161;
            }
            // Q43's base-collector leakage (the sigh): Werner's fit as a source behind the shunt leg, from V_comm two
            // samples back (≤ 42 µs at OS 1 on a 50 Hz ring: the leak stays off the resonator's per-sample recursion)
            const z = Math.min(Math.max(P.LA * (P.LV0 - vcm1), SP_LO), SP_HI), tz = (z - SP_LO) * SP_SC, kz = tz | 0;
            const vx = (SPT[kz] + (SPT[kz + 1] - SPT[kz]) * (tz - kz)) * kl * rp;
            vcm1 = vcm;
            // bridged-T + feedback buffer (trapezoid, s-form): q = s + h/2·B u; x = (I − h/2·A)⁻¹ q; s ← 2x − s (B's first
            // row is 0: C41 sees no input)
            const q1 = sb + (b3 * u + b4 * vrp + b5 * vx), q2 = sw + b6 * u;
            a = m0 * sa + m1 * q1 + m2 * q2; b = m3 * sa + m4 * q1 + m5 * q2; const w = m6 * sa + m7 * q1 + m8 * q2;
            sa = 2 * a - sa; sb = 2 * b - sb; sw = 2 * w - sw;
            vcm = u - a;
            let vbt = vcm - b; if (vbt > 11 || vbt < -11) vbt = rail(vbt);
            // tone LP → level (C47 / VR4) → C49 / R177 / R176 → Q44 → C50 → the jack / bus
            const v1 = ct0 * vbt + st; st = ct1 * vbt - ct2 * v1;
            const v2 = cl0 * v1 + sl; sl = cl1 * v1 - cl2 * v2;
            const v3 = co0 * v2 + so; so = co1 * v2 - co2 * v3;
            const v4 = glo * v3;
            vo = cc0 * v4 + sc; sc = cc1 * v4 - cc2 * vo;
            mb[i] += g * vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          const act = Math.max(pk, Math.abs(a), Math.abs(b), tN > 0 || eg !== 0 ? 1 : 0, Math.abs(vc39 - VSAT) * 1e-2);
          if (this.quiet(act)) return e;
        }
        this.ss = ss; this.v38 = v38; this.vc39 = vc39; this.vcm = vcm; this.vcm1 = vcm1; this.eg = eg; this.rp = rp;
        this.sa = sa; this.sb = sb; this.sw = sw; this.a = a; this.b = b; this.st = st; this.sl = sl; this.so = so; this.sc = sc;
        this.tN = tN; this.vo = vo;
        return c;
      }
      // at rest: no trigger, Q41 / Q43 off, Q42 saturated (V_env = V_sat), the shaper settled (its 67 µs pole long gone:
      // u = 0); C39 still relaxes through R161 and the leak still sighs
      ring(mb, o, e) {
        const P = BD, CH = this.M.CH, h2 = 0.5 * this.M.h, ct = this.ct, cl = this.cl, co = this.co, cc = this.cc, Bm = this.B, Mi = this.Mi;
        const g = mixG(P.RMIX), glo = this.gl * this.gox, k39 = this.M.h / (P.C39 * P.R161), kl = P.LM / P.LA * P.R165;
        const ct0 = ct[0], ct1 = ct[1], ct2 = ct[2], cl0 = cl[0], cl1 = cl[1], cl2 = cl[2];
        const co0 = co[0], co1 = co[1], co2 = co[2], cc0 = cc[0], cc1 = cc[1], cc2 = cc[2], b4 = h2 * Bm[4], b5 = h2 * Bm[5];
        const m0 = Mi[0], m1 = Mi[1], m2 = Mi[2], m3 = Mi[3], m4 = Mi[4], m5 = Mi[5], m6 = Mi[6], m7 = Mi[7], m8 = Mi[8];
        const LA = P.LA, LV0 = P.LV0;
        let vc39 = this.vc39, vcm = this.vcm, vcm1 = this.vcm1, sa = this.sa, sb = this.sb, sw = this.sw, a = this.a, b = this.b;
        let st = this.st, sl = this.sl, so = this.so, sc = this.sc, vo = this.vo;
        this.ss = 0;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vrp = VSAT - vc39;
            vc39 += (vrp - vcm) * k39;
            const z = Math.min(Math.max(LA * (LV0 - vcm1), SP_LO), SP_HI), tz = (z - SP_LO) * SP_SC, kz = tz | 0;
            const vx = (SPT[kz] + (SPT[kz + 1] - SPT[kz]) * (tz - kz)) * kl;
            vcm1 = vcm;
            const q1 = sb + (b4 * vrp + b5 * vx);
            a = m0 * sa + m1 * q1 + m2 * sw; b = m3 * sa + m4 * q1 + m5 * sw; const w = m6 * sa + m7 * q1 + m8 * sw;
            sa = 2 * a - sa; sb = 2 * b - sb; sw = 2 * w - sw;
            vcm = -a;
            let vbt = vcm - b; if (vbt > 11 || vbt < -11) vbt = rail(vbt);
            const v1 = ct0 * vbt + st; st = ct1 * vbt - ct2 * v1;
            const v2 = cl0 * v1 + sl; sl = cl1 * v1 - cl2 * v2;
            const v3 = co0 * v2 + so; so = co1 * v2 - co2 * v3;
            const v4 = glo * v3;
            vo = cc0 * v4 + sc; sc = cc1 * v4 - cc2 * vo;
            mb[i] += g * vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          if (this.quiet(Math.max(pk, Math.abs(a), Math.abs(b), Math.abs(vc39 - VSAT) * 1e-2))) return;
        }
        this.vc39 = vc39; this.vcm = vcm; this.vcm1 = vcm1; this.sa = sa; this.sb = sb; this.sw = sw; this.a = a; this.b = b;
        this.st = st; this.sl = sl; this.so = so; this.sc = sc; this.vo = vo;
      }
    }

    /* SNARE (RC §3): two bridged-T resonators (production values, ≈ 173 / 336 Hz) kicked by the gated trigger (R189 ∥ C57
     * into R190; R191 / R192), TONE (VR8) between their coupling caps into IC13; white noise → Q48 swing VCA supplied by
     * the SNAPPY ladder (Q47 → C51 → R184 → C52 → R185) → Sallen-Key high-pass (Q49) → C69 / R205 into IC13. */
    function sdTone(c, x, u, dx) {                           // the TONE network → the current into IC13
      const P = SD, g204 = 1 / P.R204, W = (c.ga * (u[0] - x[0]) + c.gb * (u[1] - x[1])) / (c.ga + c.gb + g204);
      dx[0] = c.ga * (u[0] - x[0] - W) / P.C63; dx[1] = c.gb * (u[1] - x[1] - W) / P.C65;
      return W * g204;
    }
    class Snare extends Voice {
      constructor(M) {
        super(M, V_N);
        this.ce = new Float64Array(3); this.r1 = new BT2(); this.r2 = new BT2(); this.tn = new Lin(2, 2);
        this.chp = new Float64Array(5); this.c69 = new Float64Array(3); this.cf = new Float64Array(3);
        this.u2k = 0; this.snp = 0; this.d48 = 0; this.ga = 0; this.gb = 0;
        this.zero();
      }
      zero() {
        this.se = 0; this.a1 = 0; this.b1 = 0; this.u1p = 0; this.a2 = 0; this.b2 = 0; this.u2p = 0; this.tn.reset();
        this.p = 0; this.x = 0; this.v51 = 0; this.v52 = 0; this.h1 = 0; this.h2 = 0; this.s69 = 0; this.sf = 0; this.vo = 0;
        this.tN = 0; this.pre = 1;
      }
      os() { this.kn(); }
      kn() {
        const P = SD, M = this.M, fs = M.fs, kv = M.kv, f1 = 173.3, f2 = 336;
        bil1(this.ce, 0, P.R189 * P.R190 * P.C57, P.R190, P.R189 * P.R190 * P.C57, P.R189 + P.R190, kBil(f1, fs));
        this.r1.design(P.C58, P.C59, P.R197, 1 / P.R196, 2 / kBil(f1, fs));
        this.r2.design(P.C60, P.C61, P.R198, 1 / P.R195, 2 / kBil(f2, fs));
        this.u2k = P.R192 / (P.R191 + P.R192);
        // TONE: VR8 (100 k B) from the low resonator's C63 (pin 1) to the high one's C65 (pin 3); TONE 10 = pin 3
        const t = clamp01(kv[K.sdt]);
        this.ga = 1 / (P.VR8 * t + RW); this.gb = 1 / (P.VR8 * (1 - t) + RW);
        this.tn.design(sdTone, this, 2 / kBil(f1, fs));
        skHP(this.chp, 0, P.C66, P.C67, P.R201, P.R202, 1, kBil(2750, fs));
        bil1(this.c69, 0, P.C69, 0, P.R205 * P.C69, 1, kBil(2750, fs));   // C69 / R205: the current into the sum node
        const rf = 1 / (1 / P.R210 + 1 / (P.VR7 * tapA(clamp01(kv[K.sdl])) + RW));
        bil1(this.cf, 0, 0, rf, rf * P.C70, 1, kBil(Math.min(1 / (TAU * rf * P.C70), 0.4 * fs), fs));
        // SNAPPY: VR9 (10 k B) over R199 to ground → R186 → Q47 (follower)
        this.snp = (P.R199 + P.VR9 * clamp01(kv[K.sds])) / (P.VR9 + P.R199);
        this.d48 = M.h * (B15 - VBE) / P.R194 / P.C56;      // the base's bias recharge per sample (the tracker's leak)
      }
      fire(V) { this.tV = V; this.tN = this.M.nP; if (!this.on) this.pre = 1; this.on = true; this.qn = 0; }
      // a span: the trigger's loop while it lasts, then the ringing loop (no input: the 4.6 µs excitation pole long gone)
      run(mb, o, n) {
        const e = o + n;
        if (this.pre) { this.pre = 0; this.p = this.M.wnPeak; }
        let c = o;
        if (this.tN > 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const P = SD, M = this.M, CH = M.CH, h = M.h, wn = M.wn, ce = this.ce, c1 = this.r1.c, c2 = this.r2.c, tV = this.tV;
        const tn = this.tn, Ad = tn.Ad, Bd = tn.Bd, Ct = tn.C, Dt = tn.D, x = tn.x, up = tn.up;
        const chp = this.chp, c69 = this.c69, cf = this.cf, g = mixG(P.RMIX), u2k = this.u2k, snp = this.snp, d48 = this.d48;
        const ion = BETA * KPK * (B15 - VBE) / P.R194, kx = 1 - Math.exp(-h / (P.R185 * P.C53)), iVT = 1 / VT;
        const g47 = 1 / P.RQ47, g184 = 1 / P.R184, g185 = 1 / P.R185, h51 = h / P.C51, h52 = h / P.C52;
        let se = this.se, a1 = this.a1, b1 = this.b1, u1p = this.u1p, a2 = this.a2, b2 = this.b2, u2p = this.u2p;
        let x0 = x[0], x1 = x[1], up0 = up[0], up1 = up[1];
        let p = this.p, xn = this.x, v51 = this.v51, v52 = this.v52, h1 = this.h1, h2 = this.h2, s69 = this.s69, sf = this.sf;
        let tN = this.tN, vo = this.vo, c = o;
        for (; c < e && tN > 0; c += CH) {
          // the VCA's supply per chunk (the ladder moves slowly): its swing, the switch's offset, the current it draws
          const vs = Math.max(v52, 0), sw = vs - vle(vs), lnK = sw > 1e-9 ? Math.log(P.R185 * ion / sw) : 0;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            const u1 = ce[0] * vt + se; se = ce[1] * vt - ce[2] * u1;
            const s1 = u1 + u1p; u1p = u1;
            const na1 = c1[0] * a1 + c1[1] * b1 + c1[4] * s1; b1 = c1[2] * a1 + c1[3] * b1 + c1[5] * s1; a1 = na1;
            const u2 = u2k * vt, s2 = u2 + u2p; u2p = u2;
            const na2 = c2[0] * a2 + c2[1] * b2 + c2[4] * s2; b2 = c2[2] * a2 + c2[3] * b2 + c2[5] * s2; a2 = na2;
            let vo1 = u1 - a1 - b1, vo2 = u2 - a2 - b2;
            if (vo1 > 11 || vo1 < -11) vo1 = rail(vo1);
            if (vo2 > 11 || vo2 < -11) vo2 = rail(vo2);
            // TONE network → current into IC13
            const q0 = vo1 + up0, q1 = vo2 + up1; up0 = vo1; up1 = vo2;
            const nx0 = Ad[0] * x0 + Ad[1] * x1 + Bd[0] * q0 + Bd[1] * q1; x1 = Ad[2] * x0 + Ad[3] * x1 + Bd[2] * q0 + Bd[3] * q1; x0 = nx0;
            const it = Ct[0] * x0 + Ct[1] * x1 + Dt[0] * vo1 + Dt[1] * vo2;
            // the snappy envelope: Q47 charges C51 toward the divided trigger less V_BE; the ladder bleeds into the VCA
            const i51 = Math.max(vt * snp - VBE - v51, 0) * g47;
            // the noise VCA (Q48): base = clamp level + noise − tracked peak; its output node C53 pulled down at once,
            // recharged through R185
            const v = wn[i];
            p = Math.max(p - d48, v);
            const tgt = vs - sw * gT((v - p) * iVT + lnK);
            xn = Math.min(tgt, xn + (tgt - xn) * kx);
            const i52 = (v51 - v52) * g184;
            v51 += (i51 - i52) * h51;
            v52 += (i52 - Math.max(vs - xn, 0) * g185) * h52;
            // the high-pass (Q49) → C69 / R205
            const yh = chp[0] * xn + h1; h1 = chp[1] * xn - chp[3] * yh + h2; h2 = chp[2] * xn - chp[4] * yh;
            const in_ = c69[0] * yh + s69; s69 = c69[1] * yh - c69[2] * in_;
            // IC13: −(R210 ∥ VR7) ∥ C70 of the summed currents
            const ii = -(it + in_);
            vo = cf[0] * ii + sf; sf = cf[1] * ii - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(1)) return e;
        }
        this.se = se; this.a1 = a1; this.b1 = b1; this.u1p = u1p; this.a2 = a2; this.b2 = b2; this.u2p = u2p;
        x[0] = x0; x[1] = x1; up[0] = up0; up[1] = up1;
        this.p = p; this.x = xn; this.v51 = v51; this.v52 = v52; this.h1 = h1; this.h2 = h2; this.s69 = s69; this.sf = sf;
        this.tN = tN; this.vo = vo;
        return c;
      }
      ring(mb, o, e) {
        const P = SD, M = this.M, CH = M.CH, h = M.h, wn = M.wn, c1 = this.r1.c, c2 = this.r2.c, tn = this.tn, Ad = tn.Ad, Bd = tn.Bd;
        const chp = this.chp, c69 = this.c69, cf = this.cf, g = mixG(P.RMIX), d48 = this.d48;
        const ion = BETA * KPK * (B15 - VBE) / P.R194, kx = 1 - Math.exp(-h / (P.R185 * P.C53)), iVT = 1 / VT;
        const g184 = 1 / P.R184, g185 = 1 / P.R185, h51 = h / P.C51, h52 = h / P.C52;
        const r10 = c1[0], r11 = c1[1], r12 = c1[2], r13 = c1[3], r20 = c2[0], r21 = c2[1], r22 = c2[2], r23 = c2[3];
        const A0 = Ad[0], A1 = Ad[1], A2 = Ad[2], A3 = Ad[3], B0 = Bd[0], B1 = Bd[1], B2 = Bd[2], B3 = Bd[3];
        const C0 = tn.C[0], C1 = tn.C[1], D0 = tn.D[0], D1 = tn.D[1], x = tn.x, up = tn.up;
        const H0 = chp[0], H1 = chp[1], H2 = chp[2], H3 = chp[3], H4 = chp[4], k0 = c69[0], k1 = c69[1], k2 = c69[2], f0 = cf[0], f1 = cf[1], f2 = cf[2];
        let a1 = this.a1, b1 = this.b1, a2 = this.a2, b2 = this.b2, x0 = x[0], x1 = x[1], up0 = up[0], up1 = up[1];
        let p = this.p, xn = this.x, v51 = this.v51, v52 = this.v52, h1 = this.h1, h2 = this.h2, s69 = this.s69, sf = this.sf, vo = this.vo;
        this.se = 0; this.u1p = 0; this.u2p = 0;
        for (let c = o; c < e; c += CH) {
          const vs = Math.max(v52, 0), sw = vs - vle(vs), lnK = sw > 1e-9 ? Math.log(P.R185 * ion / sw) : 0;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const na1 = r10 * a1 + r11 * b1; b1 = r12 * a1 + r13 * b1; a1 = na1;
            const na2 = r20 * a2 + r21 * b2; b2 = r22 * a2 + r23 * b2; a2 = na2;
            let vo1 = -a1 - b1, vo2 = -a2 - b2;
            if (vo1 > 11 || vo1 < -11) vo1 = rail(vo1);
            if (vo2 > 11 || vo2 < -11) vo2 = rail(vo2);
            const q0 = vo1 + up0, q1 = vo2 + up1; up0 = vo1; up1 = vo2;
            const nx0 = A0 * x0 + A1 * x1 + B0 * q0 + B1 * q1; x1 = A2 * x0 + A3 * x1 + B2 * q0 + B3 * q1; x0 = nx0;
            const it = C0 * x0 + C1 * x1 + D0 * vo1 + D1 * vo2;
            const v = wn[i];
            p = Math.max(p - d48, v);
            const tgt = vs - sw * gT((v - p) * iVT + lnK);
            xn = Math.min(tgt, xn + (tgt - xn) * kx);
            const i52 = (v51 - v52) * g184;
            v51 -= i52 * h51;
            v52 += (i52 - Math.max(vs - xn, 0) * g185) * h52;
            const yh = H0 * xn + h1; h1 = H1 * xn - H3 * yh + h2; h2 = H2 * xn - H4 * yh;
            const in_ = k0 * yh + s69; s69 = k1 * yh - k2 * in_;
            const ii = -(it + in_);
            vo = f0 * ii + sf; sf = f1 * ii - f2 * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(Math.max(pk, Math.abs(a1), Math.abs(b1), Math.abs(a2), Math.abs(b2), swing(Math.max(v51, v52))))) return;
        }
        this.a1 = a1; this.b1 = b1; this.a2 = a2; this.b2 = b2; x[0] = x0; x[1] = x1; up[0] = up0; up[1] = up1;
        this.p = p; this.x = xn; this.v51 = v51; this.v52 = v52; this.h1 = h1; this.h2 = h2; this.s69 = s69; this.sf = sf; this.vo = vo;
      }
    }

    // the leg's slices: i(V) of R_b + R231 ∥ (R_t + the anti-parallel 1S188FM pair), R_t = 500 Ω · TUNING, R_b the rest
    // (+ 10 Ω each). Parametrized by the diodes' current i: x = R_t·i + nV_T·asinh(i / 2I_s), V = R_b (x / R231 + i) + x —
    // Newton in i, warm-started along V (monotone: V(i) is concave). Built once, at the first machine.
    let LEGT = null;
    function legTables() {
      if (LEGT) return LEGT;
      const T = new Float64Array((LEG_S + 1) * LEG_W), r231 = TM.R231, is2 = 2 * TM.DIS, nvt = TM.DIN * VT;
      for (let s = 0; s <= LEG_S; s++) {
        const tu = s / LEG_S, rt = TM.VRt * tu + RW * 0.2, rb = TM.VRt * (1 - tu) + RW * 0.2, o = s * LEG_W + LEG_N;
        let i = 0;
        for (let j = 0; j <= LEG_N + 1; j++) {
          const V = j / LEG_SC;
          for (let it = 0; it < 60; it++) {
            const x = rt * i + nvt * Math.asinh(i / is2), dx = rt + nvt / Math.sqrt(i * i + is2 * is2);
            const st = (rb * (x / r231 + i) + x - V) / (rb * (dx / r231 + 1) + dx);
            i -= st;
            if (Math.abs(st) <= 1e-16 + 1e-13 * Math.abs(i)) break;
          }
          const I = (rt * i + nvt * Math.asinh(i / is2)) / r231 + i;
          T[o + j] = I; if (j <= LEG_N) T[o - j] = -I;
        }
      }
      return (LEGT = T);
    }
    /* TOMS / CONGAS (RC §4): one circuit per pair. Trigger → C_x (D clamp) → R226 into the + input (R225, + R224 in
     * CONGA); a bridged-T in IC_a's loop whose shunt leg is R231 ∥ (pot top + the 1S188FM pair) over the pot's lower part
     * (the pitch falls as the ring decays), positive feedback from the inverter IC_b through 820 k to the T's junction;
     * TOM switches in C (frequency), CONGA R224 (level) and TOM the pink-noise "reverb" gate (Q52). Output → R233 → C81
     * → IC13. */
    class Tom extends Voice {
      constructor(M, k) {
        super(M, V_N);
        this.k = k; this.T = TOM[k]; this.var = 0;
        this.ch = new Float64Array(3); this.cf = new Float64Array(3); this.cn1 = new Float64Array(3); this.cn2 = new Float64Array(3); this.cnh = new Float64Array(3);
        this.Ca = 0; this.Cb = 0; this.gq = 0; this.ex = 0; this.exA = 0; this.tu = -1;
        this.IT = new Float64Array(LEG_W);                   // the shunt leg's current on −LEG_V…LEG_V (the slices blended)
        this.RD = new Float64Array(LEG_W); this.C1 = 0;      // the Newton step's reciprocal slope per segment
        this.zero();
      }
      zero() {
        this.cx = 0; this.a = 0; this.b = 0; this.sa = 0; this.sb = 0; this.vj = 0;
        this.sh = 0; this.sfo = 0; this.v72 = 0; this.n1 = 0; this.n2 = 0; this.nh = 0; this.vo = 0; this.tN = 0;
      }
      os() { this.kn(); }
      kn() {
        const T = this.T, P = TM, M = this.M, fs = M.fs, kv = M.kv, tom = this.var === 0;
        this.Ca = T.Ca + (tom ? T.Ca2 : 0); this.Cb = T.Cb + (tom ? T.Cb2 : 0);
        const rq = tom ? T.Rq : par(T.Rq, T.Rt);              // CONGA grounds R224 (its contact is the grounded one)
        this.gq = rq / (P.Rx + rq);
        const tau = T.Cx * (P.Rx + rq), h = M.h;
        this.ex = Math.exp(-h / tau); this.exA = tau / h * (1 - this.ex);
        const tu = clamp01(kv[this.k === 0 ? K.ltt : this.k === 1 ? K.mtt : K.htt]);
        if (tu !== this.tu) {                                 // TUNING 10 = the highest pitch (R_b smallest)
          const LT = legTables(), IT = this.IT, x = tu * LEG_S, s0 = Math.min(x | 0, LEG_S - 1), f = x - s0, o0 = s0 * LEG_W, o1 = o0 + LEG_W;
          for (let k = 0; k < LEG_W; k++) IT[k] = LT[o0 + k] + (LT[o1 + k] - LT[o0 + k]) * f;
          this.tu = tu;
        }
        // the Newton step's constants: C1 + kc·slope per segment of the leg's table, inverted
        const kc = 0.5 * h / this.Cb, hp = 0.5 * h / (P.Rbr * this.Ca), b1 = (1 + hp) / hp, gb = 1 / P.Rbr, gf = 1 / P.Rfb;
        const C1 = this.C1 = b1 + kc * ((b1 - 1) * gb + gf * (2 - b1)), IT = this.IT, RD = this.RD;
        for (let j = 0; j < LEG_W - 1; j++) RD[j] = 1 / (C1 + kc * (IT[j + 1] - IT[j]) * LEG_SC);
        const fr = 1 / (TAU * Math.sqrt(P.Rbr * (P.R231 + P.VRt * (1 - tu) + RW * 0.2) * this.Ca * this.Cb));
        const req = par(P.Ro, P.Rn);                          // −Vo → R233 (∥ R232 from the noise) → C81 → IC13
        bil1(this.ch, 0, T.Co, 0, req * T.Co, 1, kBil(fr, fs));
        const lv = tapA(clamp01(kv[this.k === 0 ? K.ltl : this.k === 1 ? K.mtl : K.htl]));
        const rf = 1 / (1 / P.R235 + 1 / (P.VRl * lv + RW));
        bil1(this.cf, 0, 0, rf, rf * T.Cf, 1, kBil(Math.min(1 / (TAU * rf * T.Cf), 0.4 * fs), fs));
        // the noise path after Q52: C74 into R223 (≈ 154 Hz high-pass), R222 into C75 (≈ 268 Hz low-pass); PN via C71
        bil1(this.cnh, 0, P.R223 * T.Cn1, 0, P.R223 * T.Cn1, 1, kBil(200, fs));
        bil1(this.cn2, 0, 0, 1, (P.R222 + par(P.R223, P.R221)) * T.Cn2, 1, kBil(200, fs));
        const rn = P.R220 + par(P.R216, P.R217);
        bil1(this.cn1, 0, rn * T.Cn, 0, rn * T.Cn, 1, kBil(200, fs));
      }
      fire(V, vr) {
        if (vr !== this.var) { this.var = vr; this.kn(); }
        this.tV = V; this.tN = this.M.nP; this.on = true; this.qn = 0;
      }
      // a span: the excitation's loop while the trigger or C_x moves, then the ringing loop (no input)
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.tN > 0 || this.cx !== 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const T = this.T, P = TM, M = this.M, CH = M.CH, h = M.h, h2 = 0.5 * h, pn = M.pn, ch = this.ch, cf = this.cf, tV = this.tV;
        const cnh = this.cnh, cn1 = this.cn1, cn2 = this.cn2, g = mixG(P.RMIX), tom = this.var === 0;
        const Cb = this.Cb, gb = 1 / P.Rbr, gf = 1 / P.Rfb, p = gb / this.Ca, gq = this.gq, ex = this.ex, exA = this.exA;
        const IT = this.IT, RD = this.RD, kc = h2 / Cb, req = par(P.Ro, P.Rn), hp = h2 * p, ihp = 1 / hp, b1 = (1 + hp) / hp;
        const C1 = this.C1, kRo = req / P.Ro, kRn = req / P.Rn, JX = LEG_W - 3;
        const ke = 1 - Math.exp(-h / (P.Re * T.Ce)), kpn = P.R217 / (P.R216 + P.R217), rn = P.R220 + par(P.R216, P.R217);
        const isat = (B15 - VSAT) / P.R221, g218 = 1 / P.R218, hCe = h / T.Ce;
        let cx = this.cx, a = this.a, b = this.b, sa = this.sa, sb = this.sb, vj = this.vj;
        let sh = this.sh, sfo = this.sfo, v72 = this.v72, n1 = this.n1, n2 = this.n2, nh = this.nh, tN = this.tN, vo = this.vo, c = o;
        for (; c < e && (tN > 0 || cx !== 0); c += CH) {
          // Q52's small-signal input conductance from its bias (per chunk: C72 bleeds over ≈ 86 ms)
          const gib = 1 / (rn + VT / Math.max((v72 - VBE) * g218, 1e-12));
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            // excitation: C_x from the trigger into (R226 + R_q), the clamp diode holds the node above −0.6 V; the
            // node's mean over the sample (its fast decay integrated, not point-sampled)
            const c0 = cx;
            cx = vt + (cx - vt) * ex;
            let vp = (vt - c0) * exA;
            if (vt - cx < -0.6) { cx = vt + 0.6; if (vp < -0.6) vp = -0.6; }
            const u = vp * gq;
            // the resonator by the trapezoid with the leg's current implicit (a passive nonlinear resistor evaluated at
            // the new point): a' = −p(a + b); Cb b' = −(a + b)/Rbr − i_leg(V_J) − Gf (2u − 2a − b); V = V_J: a = u − V,
            // b = b0 + b1 V (s-form: s = x + h/2·f). Newton from the last V on the leg's table (linear beyond its ends;
            // RD: the step's reciprocal slope per segment) — one step while V moves less than two segments a sample,
            // more at the attack; the leg's current is the last step's linearization, so the trapezoid's equation holds.
            const b0 = (sa - u * (1 + hp)) * ihp, C0 = b0 + kc * ((u + b0) * gb - gf * b0) - sb;
            let il = 0;
            for (let it = 0; it < 6; it++) {
              const t = (vj + LEG_V) * LEG_SC, j = Math.min(Math.max(t | 0, 0), JX), i0 = IT[j], d = IT[j + 1] - i0;
              const iv = i0 + (t - j) * d, dV = (C0 + C1 * vj + kc * iv) * RD[j];
              il = iv - d * LEG_SC * dV; vj -= dV;
              if (Math.abs(dV) < 2 / LEG_SC) break;
            }
            a = u - vj; b = b0 + b1 * vj;
            sa = a - hp * (a + b); sb = b - kc * ((a + b) * gb + il + gf * (2 * u - 2 * a - b));
            let vout = u - a - b; if (vout > 11 || vout < -11) vout = rail(vout);
            // the pink-noise gate (TOM): C72 charged through R219 / D55, bled by R218 into Q52's base with the noise
            let vn = 0;
            if (tom) {
              v72 = Math.max(v72, v72 + (vt - 0.6 - v72) * ke);
              const ie2 = Math.max(v72 - VBE, 0) * g218;
              v72 -= ie2 * hCe;
              const vpn = kpn * pn[i];
              const yb = cn1[0] * vpn + n1; n1 = cn1[1] * vpn - cn1[2] * yb;
              const vc = -P.R221 * Math.min(Math.max(ie2 + yb * gib, 0) * BETA, isat);
              const y1 = cnh[0] * vc + nh; nh = cnh[1] * vc - cnh[2] * y1;
              vn = cn2[0] * y1 + n2; n2 = cn2[1] * y1 - cn2[2] * vn;
            }
            // output: (−Vo/R233 + Vn/R232)·R_eq through C81 (the current), then IC13
            const vin = vn * kRn - vout * kRo;
            const yc = ch[0] * vin + sh; sh = ch[1] * vin - ch[2] * yc;
            vo = -cf[0] * yc + sfo; sfo = -cf[1] * yc - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (tN === 0 && Math.abs(cx) < 1e-7) cx = 0;      // C_x settled: the ringing loop from the next chunk
          if (this.quiet(1)) return e;
        }
        this.cx = cx; this.a = a; this.b = b; this.sa = sa; this.sb = sb; this.vj = vj;
        this.sh = sh; this.sfo = sfo; this.v72 = v72; this.n1 = n1; this.n2 = n2; this.nh = nh; this.tN = tN; this.vo = vo;
        return c;
      }
      ring(mb, o, e) {
        const T = this.T, P = TM, M = this.M, CH = M.CH, h = M.h, h2 = 0.5 * h, pn = M.pn, ch = this.ch, cf = this.cf;
        const g = mixG(P.RMIX), tom = this.var === 0, Cb = this.Cb, gb = 1 / P.Rbr, gf = 1 / P.Rfb, p = gb / this.Ca;
        const IT = this.IT, RD = this.RD, kc = h2 / Cb, req = par(P.Ro, P.Rn), hp = h2 * p, ihp = 1 / hp, b1 = (1 + hp) / hp;
        const C1 = this.C1, kRo = req / P.Ro, kRn = req / P.Rn, JX = LEG_W - 3, kb = 1 + kc * (gb - gf);
        const kpn = P.R217 / (P.R216 + P.R217), rn = P.R220 + par(P.R216, P.R217), isat = (B15 - VSAT) / P.R221, g218 = 1 / P.R218;
        const e72 = Math.exp(-CH * h / (P.R218 * T.Ce)), R221 = P.R221;
        const n10 = this.cn1[0], n11 = this.cn1[1], n12 = this.cn1[2], nh0 = this.cnh[0], nh1 = this.cnh[1], nh2 = this.cnh[2];
        const n20 = this.cn2[0], n21 = this.cn2[1], n22 = this.cn2[2], ch0 = ch[0], ch1 = ch[1], ch2 = ch[2], f0 = cf[0], f1 = cf[1], f2 = cf[2];
        let a = this.a, b = this.b, sa = this.sa, sb = this.sb, vj = this.vj;
        let sh = this.sh, sfo = this.sfo, v72 = this.v72, n1 = this.n1, n2 = this.n2, nh = this.nh, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          // C72 bleeds through R218 into Q52's base: its current and the base's input conductance per chunk
          const ie2 = Math.max(v72 - VBE, 0) * g218, gib = 1 / (rn + VT / Math.max(ie2, 1e-12));
          if (v72 > VBE) v72 = VBE + (v72 - VBE) * e72;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const b0 = sa * ihp, C0 = b0 * kb - sb;
            let il = 0;
            for (let it = 0; it < 6; it++) {
              const t = (vj + LEG_V) * LEG_SC, j = Math.min(Math.max(t | 0, 0), JX), i0 = IT[j], d = IT[j + 1] - i0;
              const iv = i0 + (t - j) * d, dV = (C0 + C1 * vj + kc * iv) * RD[j];
              il = iv - d * LEG_SC * dV; vj -= dV;
              if (Math.abs(dV) < 2 / LEG_SC) break;
            }
            a = -vj; b = b0 + b1 * vj;
            sa = a - hp * (a + b); sb = b - kc * ((a + b) * gb + il - gf * (2 * a + b));
            let vout = -a - b; if (vout > 11 || vout < -11) vout = rail(vout);
            let vn = 0;
            if (tom) {
              const vpn = kpn * pn[i];
              const yb = n10 * vpn + n1; n1 = n11 * vpn - n12 * yb;
              const vc = -R221 * Math.min(Math.max(ie2 + yb * gib, 0) * BETA, isat);
              const y1 = nh0 * vc + nh; nh = nh1 * vc - nh2 * y1;
              vn = n20 * y1 + n2; n2 = n21 * y1 - n22 * vn;
            }
            const vin = vn * kRn - vout * kRo;
            const yc = ch0 * vin + sh; sh = ch1 * vin - ch2 * yc;
            vo = -f0 * yc + sfo; sfo = -f1 * yc - f2 * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(Math.max(pk, Math.abs(a), Math.abs(b), tom ? (v72 - VBE) * 0.1 : 0))) return;
        }
        this.a = a; this.b = b; this.sa = sa; this.sb = sb; this.vj = vj;
        this.sh = sh; this.sfo = sfo; this.v72 = v72; this.n1 = n1; this.n2 = n2; this.nh = nh; this.vo = vo;
      }
    }

    // Q62's base node (RIM): M's Thevenin source R_M (R318 ∥ R320 ∥ R317) through C120 into the junction, biased by R321
    // from +15 V: V_b·(1 + R_M/R321) + R_M·I_s,b·e^{V_b/V_T} = V_M − v_C120 + R_M·15/R321 =: c. V_b(c) tabulated once
    // (Newton at design time, monotone), linear below the table (the junction off) and above; I_b = (c − a·V_b) / R_M.
    const VB_LO = -1, VB_HI = 15, VB_N = 8192, VB_SC = VB_N / (VB_HI - VB_LO);
    const RS_RM = 1 / (1 / RS.R318 + 1 / RS.R320 + 1 / RS.R317), RS_A = 1 + RS_RM / RS.R321;
    let VBT = null;
    function vbTable() {
      if (VBT) return VBT;
      const T = new Float64Array(VB_N + 2), k = RS_RM * IES / BETA;
      let v = VB_LO / RS_A;
      for (let i = 0; i <= VB_N + 1; i++) {
        const c = VB_LO + i / VB_SC;
        for (let it = 0; it < 100; it++) {
          const e = Math.exp(v / VT), st = (RS_A * v + k * e - c) / (RS_A + k * e / VT);
          v -= st;
          if (Math.abs(st) < 1e-14) break;
        }
        T[i] = v;
      }
      return (VBT = T);
    }

    /* RIM SHOT / CLAVES (RC §5): GEN1 (IC21, ≈ 452 Hz) through C111 / D62; GEN2 (IC20a; finite GBW, 3 states: RIM adds
     * C118, CLAVES feeds the inverted output back through R313) through C114 / D64. RIM: GEN1 and −GEN2 into Q62's swing
     * VCA on C24's envelope → Sallen-Key high-pass (Q63, ≈ 590 Hz) → R324 → C125; CLAVES: −GEN2 → R319 → C125. IC19 with
     * the JFET mute Q74 (IMPL-7a §15 #36): Q61 pulls its gate C113 to −15 V for the trigger, R305 ∥ R327 bring it back
     * (τ ≈ 15 ms), so the channel opens for ≈ 40 ms and closes again as the gate passes the pinch-off. */
    class RimClaves extends Voice {
      constructor(M) {
        super(M, V_N);
        this.var = 0;
        this.g1 = new BT2(); this.M2 = new Float64Array(18); this.A2 = new Float64Array(9); this.T9 = new Float64Array(9);
        this.chp = new Float64Array(5); this.cc = new Float64Array(3); this.cf = new Float64Array(3);
        this.e1on = 0; this.e1onA = 0; this.e1off = 0; this.e2on = 0; this.e2onA = 0; this.e2off = 0; this.kG = 0; this.lv = 0; this.rf = -1;
        this.zero();
      }
      zero() {
        this.c1 = 0; this.c2 = 0; this.a1 = 0; this.b1 = 0; this.u1p = 0; this.a2 = 0; this.b2 = 0; this.vo2 = 0; this.sa2 = 0; this.sb2 = 0;
        // C120 at rest: the base sits where the junction carries R321's bias current
        this.vbq = VT * Math.log((B15 - 0.67) / RS.R321 / (IES / BETA)); this.p = -this.vbq;
        this.v24 = 0; this.xn = 0; this.h1 = 0; this.h2 = 0; this.sc = 0; this.sf = 0; this.vg = 0; this.vo = 0; this.tN = 0;
      }
      os() { vbTable(); this.design2(0); this.design2(1); this.kn(); }
      // GEN2 for variant vr into M2[9·vr…]: vCa, vCb by the trapezoid, the op-amp's output (GBW) by backward Euler
      design2(vr) {
        const P = RS, h = this.M.h, A = this.A2, Ca = P.C119, Cb = P.C117 + (vr === 0 ? P.C118 : 0), gf = vr === 1 ? 1 / P.R313 : 0;
        const gs = 1 / P.R312, gb = 1 / P.R308, wt = TAU * GBW;
        A[0] = -gb / Ca; A[1] = -gb / Ca; A[2] = 0;
        A[3] = -gb / Cb; A[4] = (-gb - gs - gf) / Cb; A[5] = -(gs + 2 * gf) / Cb;
        A[6] = -wt; A[7] = -wt; A[8] = -wt;
        inv3(this.T9, A, 0.5 * h, 0.5 * h, h);
        for (let i = 0; i < 9; i++) this.M2[9 * vr + i] = this.T9[i];
      }
      kn() {
        const P = RS, M = this.M, fs = M.fs, h = M.h, kv = M.kv;
        this.g1.design(P.C116, P.C115, P.R316, 1 / P.R315, 2 / kBil(452, fs));
        // the excitation networks: piecewise linear (diode on / off), exact exponential steps and interval means
        const t1on = P.C111 / (1 / P.R307 + 1 / (P.R301 + P.R302)), t1off = P.C111 * P.R307;
        const t2on = P.C114 / (1 / P.R306 + 1 / (P.R310 + P.R311)), t2off = P.C114 * P.R306;
        this.e1on = Math.exp(-h / t1on); this.e1onA = t1on / h * (1 - this.e1on); this.e1off = Math.exp(-h / t1off);
        this.e2on = Math.exp(-h / t2on); this.e2onA = t2on / h * (1 - this.e2on); this.e2off = Math.exp(-h / t2off);
        skHP(this.chp, 0, P.C121, P.C122, P.R322, P.R325, 1, kBil(590, fs));
        const rin = this.var === 0 ? P.R324 + P.R326 : P.R319 + P.R326;
        bil1(this.cc, 0, P.C125, 0, rin * P.C125, 1, kBil(this.var === 0 ? 590 : 2500, fs));
        this.lv = P.VR16 * tapA(clamp01(kv[K.rsl])) + RW; this.rf = -1;
        this.kG = 1 - Math.exp(-h / (P.C113 * par(P.R305, P.R327)));
      }
      fire(V, vr) {
        if (vr !== this.var) { this.var = vr; this.kn(); }
        this.tV = V; this.tN = this.M.nP; this.on = true; this.qn = 0;
      }
      // Q74's channel from its gate → IC19's feedback R ∥ C153 (redesigned only when it moves: the gate settles at 0)
      jfet(vg) {
        const P = RS, rds = vg <= P.JVP ? 1e12 : P.JRON / (1 - vg / P.JVP), rf = 1 / (1 / P.R330 + 1 / this.lv + 1 / rds);
        const d = rf - this.rf;
        if (d > 1e-6 * rf || d < -1e-6 * rf) {
          this.rf = rf;
          bil1(this.cf, 0, 0, rf, rf * P.C153, 1, kBil(Math.min(1 / (TAU * rf * P.C153), 0.4 * this.M.fs), this.M.fs));
        }
      }
      // a span: the trigger's loop, then the ringing loop (the excitations off, their capacitors relaxing per chunk)
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.tN > 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const P = RS, M = this.M, CH = M.CH, h = M.h, h2 = 0.5 * h, g = mixG(P.RMIX), vr = this.var, c1 = this.g1.c, tV = this.tV;
        const M2 = this.M2, mo = 9 * vr, Cb = P.C117 + (vr === 0 ? P.C118 : 0), gf = vr === 1 ? 1 / P.R313 : 0;
        const gs = 1 / P.R312, gb = 1 / P.R308, wt = TAU * GBW, chp = this.chp, cc = this.cc, cf = this.cf;
        const g301 = 1 / (P.R301 + P.R302), k302 = P.R302 * g301, g310 = 1 / (P.R310 + P.R311), k311 = P.R311 * g310;
        const veq1 = 0.6 * g301 / (1 / P.R307 + g301), veq2 = 0.6 * g310 / (1 / P.R306 + g310);
        const gM = 1 / (1 / P.R318 + 1 / P.R320 + 1 / P.R317), isb = IES / BETA, kCh = 1 - Math.exp(-h / (P.R107 * P.C24));
        const iVT = 1 / VT, g321 = 1 / P.R321, h120 = h / P.C120, k24 = h / (P.R108 * P.C24), VBT = vbTable();
        const kc15 = gM * B15 * g321, iRM = 1 / gM;
        let c1s = this.c1, c2s = this.c2, a1 = this.a1, b1 = this.b1, u1p = this.u1p, a2 = this.a2, b2 = this.b2, v2 = this.vo2;
        let sa2 = this.sa2, sb2 = this.sb2, p = this.p, v24 = this.v24, xn = this.xn, h1 = this.h1, hh2 = this.h2;
        let sc = this.sc, sf = this.sf, vg = this.vg, tN = this.tN, vo = this.vo, vbq = this.vbq, c = o;
        for (; c < e && tN > 0; c += CH) {
          this.jfet(vg);
          // the VCA (RIM): y = ln(R108·β·Ib / (V_s − V_le)) = V_b / VT + ln(R108·β·Is_b / (V_s − V_le)); supply per chunk
          const vs = Math.max(v24 - 0.6, 0), sw = vs - vle(vs), lnK = sw > 1e-9 ? Math.log(P.R108 * BETA * isb / sw) : 0;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            // E1: C111 with R307, D62 → R301 / R302
            let ve = vt - c1s, u1 = 0;
            if (ve > 0.6) { const mm = veq1 + (ve - veq1) * this.e1onA; ve = veq1 + (ve - veq1) * this.e1on; u1 = (mm > 0.6 ? mm - 0.6 : 0) * k302; }
            else ve *= this.e1off;
            c1s = vt - ve;
            // E2: C114 with R306, D64 → R310 / R311
            let ve2 = vt - c2s, u2 = 0;
            if (ve2 > 0.6) { const mm = veq2 + (ve2 - veq2) * this.e2onA; ve2 = veq2 + (ve2 - veq2) * this.e2on; u2 = (mm > 0.6 ? mm - 0.6 : 0) * k311; }
            else ve2 *= this.e2off;
            c2s = vt - ve2;
            // GEN1
            const s1 = u1 + u1p; u1p = u1;
            const na = c1[0] * a1 + c1[1] * b1 + c1[4] * s1; b1 = c1[2] * a1 + c1[3] * b1 + c1[5] * s1; a1 = na;
            let vo1 = u1 - a1 - b1; if (vo1 > 11 || vo1 < -11) vo1 = rail(vo1);
            // GEN2: vCa, vCb by the trapezoid (s-form), the op-amp's output by backward Euler
            const r2 = v2 + h * wt * u2;
            a2 = M2[mo] * sa2 + M2[mo + 1] * sb2 + M2[mo + 2] * r2; b2 = M2[mo + 3] * sa2 + M2[mo + 4] * sb2 + M2[mo + 5] * r2;
            v2 = M2[mo + 6] * sa2 + M2[mo + 7] * sb2 + M2[mo + 8] * r2;
            sa2 = 2 * a2 - sa2; sb2 = 2 * b2 - sb2;
            let v2r = v2; if (v2r > 11 || v2r < -11) v2r = rail(v2r);
            let iin;
            const tg = vt - 0.6; if (tg > v24) v24 += (tg - v24) * kCh;
            if (vr === 0) {
              // M → C120 (10 µ) → Q62's base, biased through R321 (vbTable): M's Thevenin resistance limits the junction,
              // so the base follows the ring
              const cv = (vo1 / P.R318 - v2r / P.R320) * gM - p + kc15, t = (cv - VB_LO) * VB_SC;
              const j = Math.min(Math.max(t | 0, 0), VB_N - 1), vb = VBT[j] + (VBT[j + 1] - VBT[j]) * (t - j);
              const ib = (cv - RS_A * vb) * iRM;
              vbq = vb;
              p += (ib - (B15 - vb) * g321) * h120;
              xn = vs - sw * gT(vb * iVT + lnK);
              v24 -= (vs - xn) * k24;
              const yh = chp[0] * xn + h1; h1 = chp[1] * xn - chp[3] * yh + hh2; hh2 = chp[2] * xn - chp[4] * yh;
              iin = cc[0] * yh + sc; sc = cc[1] * yh - cc[2] * iin;
            } else {
              iin = -cc[0] * v2r + sc; sc = -cc[1] * v2r - cc[2] * iin;
            }
            // Q61 / C113: the JFET's gate pulled to −15 V while the trigger lasts
            if (vt > 0) vg += (-B15 - vg) * 0.5; else vg -= vg * this.kG;
            vo = -cf[0] * iin + sf; sf = -cf[1] * iin - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(1)) return e;
        }
        this.c1 = c1s; this.c2 = c2s; this.a1 = a1; this.b1 = b1; this.u1p = u1p; this.a2 = a2; this.b2 = b2; this.vo2 = v2;
        this.sa2 = sa2; this.sb2 = sb2; this.p = p; this.v24 = v24; this.xn = xn; this.h1 = h1; this.h2 = hh2;
        this.sc = sc; this.sf = sf; this.vg = vg; this.tN = tN; this.vo = vo; this.vbq = vbq;
        return c;
      }
      ring(mb, o, e) {
        const P = RS, M = this.M, CH = M.CH, h = M.h, g = mixG(P.RMIX), vr = this.var, c1 = this.g1.c, M2 = this.M2, mo = 9 * vr;
        const chp = this.chp, cc = this.cc, cf = this.cf, gM = 1 / (1 / P.R318 + 1 / P.R320 + 1 / P.R317), isb = IES / BETA;
        const iVT = 1 / VT, g321 = 1 / P.R321, h120 = h / P.C120, k24 = h / (P.R108 * P.C24), g318 = gM / P.R318, g320 = gM / P.R320;
        const VBT = vbTable(), kc15 = gM * B15 * g321, iRM = 1 / gM;
        const r10 = c1[0], r11 = c1[1], r12 = c1[2], r13 = c1[3], m0 = M2[mo], m1 = M2[mo + 1], m2 = M2[mo + 2], m3 = M2[mo + 3];
        const m4 = M2[mo + 4], m5 = M2[mo + 5], m6 = M2[mo + 6], m7 = M2[mo + 7], m8 = M2[mo + 8];
        const H0 = chp[0], H1 = chp[1], H2 = chp[2], H3 = chp[3], H4 = chp[4], k0 = cc[0], k1 = cc[1], k2 = cc[2];
        const eG = Math.pow(1 - this.kG, CH), e1 = Math.pow(this.e1off, CH), e2 = Math.pow(this.e2off, CH);
        let a1 = this.a1, b1 = this.b1, a2 = this.a2, b2 = this.b2, v2 = this.vo2, sa2 = this.sa2, sb2 = this.sb2, p = this.p;
        let v24 = this.v24, xn = this.xn, h1 = this.h1, hh2 = this.h2, sc = this.sc, sf = this.sf, vg = this.vg, vo = this.vo, vbq = this.vbq;
        this.u1p = 0;
        for (let c = o; c < e; c += CH) {
          this.jfet(vg);
          const f0 = cf[0], f1 = cf[1], f2 = cf[2];
          vg *= eG; this.c1 *= e1; this.c2 *= e2;
          const vs = Math.max(v24 - 0.6, 0), sw = vs - vle(vs), lnK = sw > 1e-9 ? Math.log(P.R108 * BETA * isb / sw) : 0;
          const pc = kc15 - p;
          let pk = 0, ip = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const na = r10 * a1 + r11 * b1; b1 = r12 * a1 + r13 * b1; a1 = na;
            let vo1 = -a1 - b1; if (vo1 > 11 || vo1 < -11) vo1 = rail(vo1);
            a2 = m0 * sa2 + m1 * sb2 + m2 * v2; b2 = m3 * sa2 + m4 * sb2 + m5 * v2; v2 = m6 * sa2 + m7 * sb2 + m8 * v2;
            sa2 = 2 * a2 - sa2; sb2 = 2 * b2 - sb2;
            let v2r = v2; if (v2r > 11 || v2r < -11) v2r = rail(v2r);
            let iin;
            if (vr === 0) {
              // the base node from the table; C120 (10 µ: < 1 mV a chunk) integrates its current per chunk
              const cv = vo1 * g318 - v2r * g320 + pc, t = (cv - VB_LO) * VB_SC;
              const j = Math.min(Math.max(t | 0, 0), VB_N - 1), vb = VBT[j] + (VBT[j + 1] - VBT[j]) * (t - j);
              ip += (cv - RS_A * vb) * iRM - (B15 - vb) * g321;
              vbq = vb;
              xn = vs - sw * gT(vb * iVT + lnK);
              v24 -= (vs - xn) * k24;
              const yh = H0 * xn + h1; h1 = H1 * xn - H3 * yh + hh2; hh2 = H2 * xn - H4 * yh;
              iin = k0 * yh + sc; sc = k1 * yh - k2 * iin;
            } else {
              iin = -k0 * v2r + sc; sc = -k1 * v2r - k2 * iin;
            }
            vo = -f0 * iin + sf; sf = -f1 * iin - f2 * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          p += ip * h120;
          const act = Math.max(pk, Math.abs(a1), Math.abs(b1), Math.abs(a2), Math.abs(b2), Math.abs(v2), vr === 0 ? swing(v24 - 0.6) : 0);
          if (this.quiet(act)) return;
        }
        this.a1 = a1; this.b1 = b1; this.a2 = a2; this.b2 = b2; this.vo2 = v2; this.sa2 = sa2; this.sb2 = sb2; this.p = p;
        this.v24 = v24; this.xn = xn; this.h1 = h1; this.h2 = hh2; this.sc = sc; this.sf = sf; this.vg = vg; this.vo = vo; this.vbq = vbq;
      }
    }

    // Q70's base current from C138 through R349 and its junction: v = Ib·R349 + V_BE(Ib) + (β+1)·Ib·R369 (Newton from
    // the last chunk's current: C138 moves slowly, one step is usually exact to 1e-6)
    function q70(v, ib) {
      const isb = IES / BETA, rr = CP.R349 + (BETA + 1) * CP.R369;
      if (!(v > 0.3)) return 0;
      let x = ib > 1e-12 ? ib : 1e-9;
      for (let it = 0; it < 30; it++) {
        const F = x * rr + VT * Math.log(x / isb + 1) - v, dF = rr + VT / (x + isb), s = F / dF;
        x -= s; if (x < 1e-15) x = 1e-15;
        if (Math.abs(s) < 1e-15 + 1e-6 * x) break;
      }
      return x;
    }
    // the CP / MA lane's output amplifier (IC19: −(R375 ∥ VR17) ∥ C149); each circuit runs its own copy (it is linear)
    function cpOut(cf, kv, fs) {
      const rf = 1 / (1 / CP.R375 + 1 / (CP.VR17 * tapA(clamp01(kv[K.cpl])) + RW));
      bil1(cf, 0, 0, rf, rf * CP.C149, 1, kBil(Math.min(1 / (TAU * rf * CP.C149), 0.4 * fs), fs));
    }

    /* HAND CLAP (RC §6): white noise → bridged-T band-pass (IC21, ≈ 1.25 kHz) → (a) the OTA (IC22) whose bias the
     * exponential converter Q71 / Q72 sets from the sawtooth on C144 (the AN6912 network: a 30 ms gate; C144 recharged
     * to −15 V through Q73 / R367 whenever it has discharged through R365 to the comparator's threshold, once more at the
     * gate's end), and (b) the "reverb" stage Q70 biased by the slow envelope C139 → R348 → C138 → R349. The threshold,
     * the converter's offset and the OTA's bias are fitted [fit] (RC §14, §16: the comparator network is not fully read). */
    class Clap extends Voice {
      constructor(M) {
        super(M, V_N);
        this.cb = new Float64Array(5); this.c136 = new Float64Array(3); this.c150 = new Float64Array(3); this.c137 = new Float64Array(3);
        this.c146 = new Float64Array(3); this.c152 = new Float64Array(3); this.cf = new Float64Array(3);
        this.rest();
      }
      // asleep (quiet → zero) the reverb's bias capacitors C139 / C138 keep their charge (F4: the fade ends the sound,
      // not that slow state — the next clap starts from it, as on a circuit that never slept, not from 0 V); rest(): a
      // fresh circuit (create, the machine's reset)
      zero() {
        this.b1 = 0; this.b2 = 0; this.vs = 0; this.gate = 0; this.rech = 0; this.last = 0; this.s136 = 0; this.s150 = 0;
        this.s137 = 0; this.s146 = 0; this.s152 = 0; this.vacc = V_N; this.ibq = 0;
        this.sf = 0; this.vo = 0; this.tN = 0; this.ag = 0;
      }
      rest() { this.v139 = 0; this.v138 = 0; this.zero(); }
      os() { this.kn(); }
      kn() {
        const P = CP, fs = this.M.fs;
        // band-pass: −s C128 R334 (1/R332 + s C127) / (s² C128 C129 R334 + s (C128 + C129 + C127) + 1/R333 + 1/R332)
        const G = 1 / P.R333 + 1 / P.R332;
        bil2(this.cb, 0, -P.C128 * P.R334 * P.C127, -P.C128 * P.R334 / P.R332, 0, P.C128 * P.C129 * P.R334, P.C128 + P.C129 + P.C127, G, kBil(1250, fs));
        bil1(this.c136, 0, (P.R372 + P.R382) * P.C136, 0, (P.R372 + P.R382) * P.C136, 1, kBil(1250, fs));
        bil1(this.c150, 0, P.C150, 0, P.R378 * P.C150, 1, kBil(1250, fs));       // → the current into IC19
        bil1(this.c137, 0, P.C137 * 2e3, 0, P.C137 * 2e3, 1, kBil(1250, fs));
        bil1(this.c146, 0, 0, 1, P.R363 * P.C146, 1, kBil(800, fs));
        bil1(this.c152, 0, P.C152, 0, P.R376 * P.C152, 1, kBil(800, fs));
        cpOut(this.cf, this.M.kv, fs);
      }
      fire(V) { this.tV = V; this.tN = this.M.nP; this.gate = CP.GATE; this.rech = 1; this.last = 0; this.vacc = V; this.on = true; this.qn = 0; this.ag = 0; }
      // a span: the burst's loop while the gate, the sawtooth or the converter is live, then the reverb's tail (the OTA
      // off: its bias below 1e-5 of full conversion (−100 dB, the sleep rule) and falling as the last saw relaxes)
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.burst()) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      burst() {
        const P = CP;
        return this.tN > 0 || this.gate > 0 || this.rech !== 0 ||
          logi((P.VOFF + P.VACC * (this.vacc - V_N) - this.vs * P.R371 / (P.R368 + P.R371)) / VT) > 1e-5;
      }
      att(mb, o, e) {
        const P = CP, M = this.M, CH = M.CH, h = M.h, wn = M.wn, g = mixG(P.RMIX), cb = this.cb, c136 = this.c136, c150 = this.c150;
        const c137 = this.c137, c146 = this.c146, c152 = this.c152, cf = this.cf, tV = this.tV;
        const kR = 1 - Math.exp(-h / (P.R367 * P.C144)), kD = Math.exp(-h / (P.R365 * P.C144)), kdv = P.R371 / (P.R368 + P.R371);
        const kin = P.R382 / (P.R372 + P.R382) / (2 * VT), kmd = P.R346 / (P.R342 + P.R346), gch = 1 - Math.exp(-h / 50e-6);
        const voff = P.VOFF + P.VACC * (this.vacc - V_N), iVT = 1 / VT, it0 = P.R383 * P.ITAIL, g348 = 1 / P.R348;
        let b1 = this.b1, b2 = this.b2, vs = this.vs, gate = this.gate, rech = this.rech, last = this.last, s136 = this.s136, s150 = this.s150;
        let v139 = this.v139, v138 = this.v138, s137 = this.s137, s146 = this.s146, s152 = this.s152, sf = this.sf, tN = this.tN, vo = this.vo;
        let c = o;
        for (; c < e; c += CH) {
          if (!(tN > 0 || gate > 0 || rech !== 0 || logi((voff - vs * kdv) * iVT) > 1e-5)) break;
          this.ag++;                                         // (the chunks since the trigger: the tail's fade, F4)
          const ib = this.ibq = q70(v138, this.ibq);         // Q70's base current (per chunk: C138 is slow)
          const icd = BETA * ib, gm = icd / VT, gr = gm / (1 + gm * P.R369);
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            const v = wn[i];
            const yb = cb[0] * v + b1; b1 = cb[1] * v - cb[3] * yb + b2; b2 = cb[2] * v - cb[4] * yb;
            // the sawtooth: recharge toward −15 V, else discharge through R365; the comparator and the gate's end
            if (rech !== 0) { vs += (-B15 - vs) * kR; if (vs < -14.85) rech = 0; } else vs *= kD;
            if (gate > 0) { gate -= h; if (vs > -P.VCMP) rech = 1; if (gate <= 0 && last === 0) { last = 1; rech = 1; } }
            const gs = logi((voff - vs * kdv) * iVT);
            // the OTA: v_in from the band-pass through C136 / R372 / R382; I_out = I_abc tanh(v/2VT) into R383
            const yi = c136[0] * yb + s136; s136 = c136[1] * yb - c136[2] * yi;
            const xo = Math.min(Math.max(yi * kin, -3), 3), th = xo * (27 + xo * xo) / (27 + 9 * xo * xo);
            const v22 = it0 * gs * th;
            const ys = c150[0] * v22 + s150; s150 = c150[1] * v22 - c150[2] * ys;
            // the reverb stage: Q69 → D69 → C139 → R348 → C138 → R349 → Q70 (gain from its bias, the band at its base)
            v139 = Math.max(v139, v139 + (vt - 1.25 - v139) * gch);
            const i48 = (v139 - v138) * g348;
            v139 -= h * i48 / P.C139; v138 += h * (i48 - ib) / P.C138;
            const vb = kmd * yb, yb2 = c137[0] * vb + s137; s137 = c137[1] * vb - c137[2] * yb2;
            const vc = -P.R363 * Math.max(icd + yb2 * gr, 0);
            const yl = c146[0] * vc + s146; s146 = c146[1] * vc - c146[2] * yl;
            const yr = c152[0] * yl + s152; s152 = c152[1] * yl - c152[2] * yr;
            const ii = ys + P.KREV * yr;
            vo = -cf[0] * ii + sf; sf = -cf[1] * ii - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(1)) return e;
        }
        this.b1 = b1; this.b2 = b2; this.vs = vs; this.gate = gate; this.rech = rech; this.last = last; this.s136 = s136; this.s150 = s150;
        this.v139 = v139; this.v138 = v138; this.s137 = s137; this.s146 = s146; this.s152 = s152; this.sf = sf; this.tN = tN; this.vo = vo;
        return c;
      }
      ring(mb, o, e) {
        const P = CP, M = this.M, CH = M.CH, h = M.h, wn = M.wn, g = mixG(P.RMIX), cb = this.cb, c137 = this.c137, c146 = this.c146;
        const c152 = this.c152, cf = this.cf, kmd = P.R346 / (P.R342 + P.R346), T = CH * h, g348 = 1 / P.R348, R363 = P.R363;
        const kD = Math.pow(Math.exp(-h / (P.R365 * P.C144)), CH);
        const B0 = cb[0], B1 = cb[1], B2 = cb[2], B3 = cb[3], B4 = cb[4], q0 = c137[0] * kmd, q1 = c137[1] * kmd, q2 = c137[2];
        const f0k = cf[0] * P.KREV, f1k = cf[1] * P.KREV;
        const l0 = c146[0], l1 = c146[1], l2 = c146[2], r0 = c152[0], r1 = c152[1], r2 = c152[2], f0 = cf[0], f1 = cf[1], f2 = cf[2];
        let b1 = this.b1, b2 = this.b2, v139 = this.v139, v138 = this.v138, s137 = this.s137, s146 = this.s146, s152 = this.s152;
        let sf = this.sf, vo = this.vo, ag = this.ag;
        this.s136 = 0; this.s150 = 0;
        // the sleep rule's fade (F4): 1 until CP_T0 s after the trigger (× 1 is exact: those chunks are the circuit's
        // bytes), then linear to 0 at CP_T1, per 4-frame chunk
        const A0 = CP_T0 * M.base / 4, A1 = CP_T1 * M.base / 4, iA = 1 / (A1 - A0);
        for (let c = o; c < e; c += CH) {
          const w = ag < A0 ? 1 : ag >= A1 ? 0 : (A1 - ag) * iA;
          ag++;
          const ib = this.ibq = q70(v138, this.ibq), ic = BETA * ib, gm = ic / VT, icd = ic * w, gr = gm / (1 + gm * P.R369) * w;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const v = wn[i];
            const yb = B0 * v + b1; b1 = B1 * v - B3 * yb + b2; b2 = B2 * v - B4 * yb;
            const yb2 = q0 * yb + s137; s137 = q1 * yb - q2 * yb2;
            const vc = -R363 * Math.max(icd + yb2 * gr, 0);
            const yl = l0 * vc + s146; s146 = l1 * vc - l2 * yl;
            const yr = r0 * yl + s152; s152 = r1 * yl - r2 * yr;
            vo = -f0k * yr + sf; sf = -f1k * yr - f2 * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          // C139 → R348 → C138 → Q70's base, per chunk (τ ≥ 18 ms); the sawtooth relaxing
          const i48 = (v139 - v138) * g348;
          v139 -= T * i48 / P.C139; v138 += T * (i48 - ib) / P.C138; this.vs *= kD;
          // the reverb's gain on the ≈ 2 mV band at its base into IC19 (C138 bleeds through the junction slowly)
          if (this.quiet(Math.max(pk, R363 * gr * 2e-3 * 1.7 * P.KREV, (v139 - v138) * 1e-2))) return;
        }
        this.b1 = b1; this.b2 = b2; this.v139 = v139; this.v138 = v138; this.s137 = s137; this.s146 = s146; this.s152 = s152;
        this.sf = sf; this.vo = vo; this.ag = ag;
      }
    }

    /* MARACAS (RC §6): white noise gated by the Q67 / Q66 network (C135 charged by the trigger through D67 holds Q67 on,
     * Q67 holds C134 down; C134 then recharges through R341 and the gate closes) → C131 / R338 → Sallen-Key high-pass
     * (Q68, ≈ 10.6 kHz) → C151 / R377 into IC19. */
    class Maracas extends Voice {
      constructor(M) {
        super(M, V_N);
        this.cm1 = new Float64Array(3); this.cm2 = new Float64Array(5); this.cm3 = new Float64Array(3); this.cf = new Float64Array(3);
        this.zero();
      }
      zero() { this.v135 = 0; this.v134 = B15; this.m1 = 0; this.m2a = 0; this.m2b = 0; this.m3 = 0; this.sf = 0; this.vo = 0; this.tN = 0; }
      os() { this.kn(); }
      kn() {
        const P = CP, fs = this.M.fs;
        bil1(this.cm1, 0, P.R338 * P.C131, 0, P.R338 * P.C131, 1, kBil(10600, fs));
        skHP(this.cm2, 0, P.C132, P.C133, P.R339, P.R340, 1, kBil(9000, fs));     // (see the closed hat)
        bil1(this.cm3, 0, P.C151, 0, P.R377 * P.C151, 1, kBil(10600, fs));
        cpOut(this.cf, this.M.kv, fs);
      }
      fire(V) { this.tV = V; this.tN = this.M.nP; this.on = true; this.qn = 0; }
      run(mb, o, n) {
        const P = CP, M = this.M, CH = M.CH, h = M.h, wn = M.wn, g = mixG(P.RMIX), cm1 = this.cm1, cm2 = this.cm2, cm3 = this.cm3, cf = this.cf;
        const gch = 1 - Math.exp(-h / 50e-6), tV = this.tV, kk = P.MAK * Math.pow(tV / V_N, 0.4), icm = B15 / P.R343;
        let v135 = this.v135, v134 = this.v134, m1 = this.m1, m2a = this.m2a, m2b = this.m2b, m3 = this.m3, sf = this.sf, tN = this.tN, vo = this.vo;
        for (let c = o, e = o + n; c < e; c += CH) {
          let pk = 0, gt = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            // C135: charged through D67, bled by R345 and Q67's base (R344); Q67 holds C134 down through D66
            const tg = vt - 0.6; if (tg > v135) v135 += (tg - v135) * gch;
            const ib67 = v135 > VBE ? (v135 - VBE) / P.R344 : 0;
            v135 -= h * (v135 / P.R345 + ib67) / P.C135;
            let ic67 = BETA * ib67; if (ic67 > icm) ic67 = icm;
            const vk = B15 - P.R343 * ic67;
            if (vk + 0.6 < v134) v134 = vk + 0.6; else v134 += h * (vk - v134) / (P.R341 * P.C134);
            gt = 1 - (v134 > 0 ? v134 : 0) / P.MAG; gt = gt > 0 ? gt * gt : 0;
            const vn = wn[i] * gt * kk;
            const y1 = cm1[0] * vn + m1; m1 = cm1[1] * vn - cm1[2] * y1;
            const y2 = cm2[0] * y1 + m2a; m2a = cm2[1] * y1 - cm2[3] * y2 + m2b; m2b = cm2[2] * y1 - cm2[4] * y2;
            const y3 = cm3[0] * y2 + m3; m3 = cm3[1] * y2 - cm3[2] * y3;
            vo = -cf[0] * y3 + sf; sf = -cf[1] * y3 - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(Math.max(pk, gt * 0.1, tN > 0 ? 1 : 0))) return;
        }
        this.v135 = v135; this.v134 = v134; this.m1 = m1; this.m2a = m2a; this.m2b = m2b; this.m3 = m3; this.sf = sf; this.tN = tN; this.vo = vo;
      }
    }

    /* COWBELL (RC §10): oscillators #5 / #6 (squares through R62 / R63, R64 / R65 into C32 / C33) switch Q15 / Q14 (swing
     * VCAs supplied from C9 through R28 / R29 with the gating diodes); C9 is charged through Q5 / R122 / D2 from the metal
     * bus and shares its charge with C34 through R82 (the abrupt first decay); the two outputs into the multiple-feedback
     * band-pass (IC2a, ≈ 860 Hz) → C75 / R116 / VR5 (5 k A) → C76 / R117 (≈ 330 Hz) → IC6. */
    function cbBP(c, x, u, dx) {                             // the band-pass, both (identical) inputs combined
      const P = CB, iin = 2 * (u[0] - x[0] - x[1]) / P.R26;  // x = (vC_in, V_J, vC29): through both R26 + C30
      const vo = x[1] - x[2], dvj = -vo / (P.R25 * P.C28);   // C28 to the virtual ground
      dx[0] = iin / (2 * P.C30); dx[1] = dvj; dx[2] = (iin - x[1] / P.R24 - P.C28 * dvj) / P.C29;
      return vo;
    }
    class Cowbell extends Voice {
      constructor(M) {
        super(M, 6.9);
        this.bp = new Lin(3, 1); this.c75 = new Float64Array(3); this.c76 = new Float64Array(3); this.gl = 0;
        this.zero();
      }
      zero() { this.v9 = 0; this.v34 = 0; this.bp.reset(); this.s75 = 0; this.s76 = 0; this.vo = 0; this.tN = 0; }
      os() { this.bp.design(cbBP, null, 2 / kBil(860, this.M.fs)); this.kn(); }
      kn() {
        const P = CB, fs = this.M.fs, kv = this.M.kv;
        const rl = P.VR5 * tapA(clamp01(kv[K.cbl])), rw = rl * (P.VR5 - rl) / P.VR5 + RW;
        bil1(this.c75, 0, (P.R116 + P.VR5) * P.C75, 0, (P.R116 + P.VR5) * P.C75, 1, kBil(860, fs));
        bil1(this.c76, 0, (P.R117 + rw) * P.C76, 0, (P.R117 + rw) * P.C76, 1, kBil(860, fs));
        this.gl = rl / (P.R116 + P.VR5) * P.R117 / (P.R117 + rw);
      }
      fire(V) { this.tV = vMetal(V); this.tN = this.M.nP; this.on = true; this.qn = 0; }
      // a span: the trigger's loop (C9 charging, per sample), then the ringing loop — C9 / C34 (τ ≥ 15 ms) step per chunk
      // on the chunk's mean VCA current
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.tN > 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const P = CB, M = this.M, CH = M.CH, h = M.h, s5 = M.s5, s6 = M.s6, g = mixG(P.RMIX), bp = this.bp, Ad = bp.Ad, Bd = bp.Bd, C = bp.C, D = bp.D, x = bp.x;
        const c75 = this.c75, c76 = this.c76, gl = this.gl, ion = BETA * KPK * (B15 - VBE) / P.R30, tV = this.tV, iVT = 1 / VT;
        const g122 = 1 / P.R122, g82 = 1 / P.R82, g28 = 1 / P.R28, h9 = h / P.C9, h34 = h / P.C34;
        let v9 = this.v9, v34 = this.v34, up = bp.up[0], x0 = x[0], x1 = x[1], x2 = x[2], s75 = this.s75, s76 = this.s76, tN = this.tN, vo = this.vo, c = o;
        for (; c < e && tN > 0; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            // the two swing VCAs: the square at the base (its top clamped by the junction: s5 / s6 relative to it); the
            // supply per sample while C9 charges
            const vs = Math.max(v9, 0), sw = swing(vs), lnK = sw > 1e-9 ? Math.log(P.R28 * ion / sw) : 0;
            const xa = vs - sw * gT(s6[i] * iVT + lnK), xb = vs - sw * gT(s5[i] * iVT + lnK);
            // C9: charged from the metal bus (Q5, R122, D2), shares with C34 through R82, bleeds through R28 / R29
            const ich = Math.max(vt - 0.7 - v9, 0) * g122, i82 = (v9 - v34) * g82;
            v9 += (ich - i82 - (2 * vs - xa - xb) * g28) * h9; v34 += i82 * h34;
            // the band-pass (the two outputs' mean)
            const uu = 0.5 * (xa + xb), q = uu + up; up = uu;
            const n0 = Ad[0] * x0 + Ad[1] * x1 + Ad[2] * x2 + Bd[0] * q, n1 = Ad[3] * x0 + Ad[4] * x1 + Ad[5] * x2 + Bd[1] * q;
            x2 = Ad[6] * x0 + Ad[7] * x1 + Ad[8] * x2 + Bd[2] * q; x0 = n0; x1 = n1;
            let yb = C[0] * x0 + C[1] * x1 + C[2] * x2 + D[0] * uu; if (yb > 11 || yb < -11) yb = rail(yb);
            const y1 = c75[0] * yb + s75; s75 = c75[1] * yb - c75[2] * y1;
            const y2 = c76[0] * y1 + s76; s76 = c76[1] * y1 - c76[2] * y2;
            vo = gl * y2;
            mb[i] += g * vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          if (this.quiet(1)) return e;
        }
        bp.up[0] = up; x[0] = x0; x[1] = x1; x[2] = x2; this.v9 = v9; this.v34 = v34; this.s75 = s75; this.s76 = s76; this.tN = tN; this.vo = vo;
        return c;
      }
      ring(mb, o, e) {
        const P = CB, M = this.M, CH = M.CH, h = M.h, s5 = M.s5, s6 = M.s6, g = mixG(P.RMIX), bp = this.bp, Ad = bp.Ad, Bd = bp.Bd, x = bp.x;
        const ion = BETA * KPK * (B15 - VBE) / P.R30, iVT = 1 / VT, g82 = 1 / P.R82, g28 = 1 / P.R28, T = CH * h, gg = g * this.gl;
        const A0 = Ad[0], A1 = Ad[1], A2 = Ad[2], A3 = Ad[3], A4 = Ad[4], A5 = Ad[5], A6 = Ad[6], A7 = Ad[7], A8 = Ad[8];
        const Q0 = 0.5 * Bd[0], Q1 = 0.5 * Bd[1], Q2 = 0.5 * Bd[2], C0 = bp.C[0], C1 = bp.C[1], C2 = bp.C[2], D0 = 0.5 * bp.D[0];
        const c75 = this.c75, c76 = this.c76, k0 = c75[0], k1 = c75[1], k2 = c75[2], l0 = c76[0], l1 = c76[1], l2 = c76[2];
        let v9 = this.v9, v34 = this.v34, up = 2 * bp.up[0], x0 = x[0], x1 = x[1], x2 = x[2], s75 = this.s75, s76 = this.s76, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          const vs = Math.max(v9, 0), sw = swing(vs), lnK = sw > 1e-9 ? Math.log(P.R28 * ion / sw) : 0;
          let pk = 0, acc = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const uu = 2 * vs - sw * (gT(s6[i] * iVT + lnK) + gT(s5[i] * iVT + lnK)), q = uu + up; up = uu;   // xa + xb
            acc += uu;
            const n0 = A0 * x0 + A1 * x1 + A2 * x2 + Q0 * q, n1 = A3 * x0 + A4 * x1 + A5 * x2 + Q1 * q;
            x2 = A6 * x0 + A7 * x1 + A8 * x2 + Q2 * q; x0 = n0; x1 = n1;
            let yb = C0 * x0 + C1 * x1 + C2 * x2 + D0 * uu; if (yb > 11 || yb < -11) yb = rail(yb);
            const y1 = k0 * yb + s75; s75 = k1 * yb - k2 * y1;
            vo = l0 * y1 + s76; s76 = l1 * y1 - l2 * vo;
            mb[i] += gg * vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          const i82 = (v9 - v34) * g82;
          v9 -= (i82 + (2 * vs - acc / CH) * g28) * T / P.C9; v34 += i82 * T / P.C34;
          if (this.quiet(Math.max(pk * this.gl, swing(v9), Math.abs(x1)))) return;
        }
        bp.up[0] = 0.5 * up; x[0] = x0; x[1] = x1; x[2] = x2; this.v9 = v9; this.v34 = v34; this.s75 = s75; this.s76 = s76; this.vo = vo * this.gl;
      }
    }

    /* CYMBAL (RC §8; Werner ICMC 2014): the attack smoother (Q19), three envelope generators (D6 / D7 / D8: EG3 C38 with
     * the R87 / C37 shelf, EG2 C40 → R88 → C39, EG1 C41 with DECAY (VR2), buffered by Q20 into EG1.2 (R105 / C45) and the
     * EG1.3 divider), three swing VCAs (Q18 on the 3440 Hz band; Q17 and Q16 on the 7100 Hz band), the three high-passes
     * (Q25 2nd order; IC5 2nd order ×2; IC5 3rd order ×2.77), the passive tone network (VR4) and the level stage (C90 into
     * IC6: a differentiator below ≈ 1.6 kHz). */
    function cyHP3(c, x, u, dx) {                            // the 3rd-order high-pass, x = (v49, v53, v54)
      const P = CY, V1 = u[0] - x[0], V2 = V1 - x[1], VP = V2 - x[2], Vo = P.G3 * VP;
      const i54 = VP / P.R109, i108 = (V2 - Vo) / P.R108;
      dx[2] = i54 / P.C54; dx[1] = (i108 + i54) / P.C53; dx[0] = (V1 / P.R106 + i108 + i54) / P.C49;
      return Vo;
    }
    function cyTone(c, x, u, dx) {                           // the tone network: x = (c55, c56, c58, V_T3, V_S)
      const P = CY, vS = x[4], T3 = x[3], ra = c.ra, rb = c.rb;
      const T1 = ((u[0] - x[0]) / P.R112 + vS / P.R119) / (1 / P.R112 + 1 / ra + 1 / P.R119);
      const T2 = ((u[1] - x[1]) / P.R120 + T3 / P.R121 + vS / P.R129) / (1 / P.R120 + 1 / P.R121 + 1 / (rb + P.R125) + 1 / P.R129);
      const i112 = (u[0] - x[0] - T1) / P.R112, i120 = (u[1] - x[1] - T2) / P.R120, i123 = (u[2] - x[2] - T3) / P.R123;
      const iS = (T1 - vS) / P.R119 + (T2 - vS) / P.R129;
      dx[0] = i112 / P.C55; dx[1] = i120 / P.C56; dx[2] = i123 / P.C58; dx[3] = (i123 - (T3 - T2) / P.R121) / P.C57; dx[4] = iS / P.C90;
      return iS;                                             // the current into IC6's summing node
    }
    class Cymbal extends Voice {
      constructor(M) {
        super(M, 6.9);
        this.h1 = new Float64Array(5); this.h2 = new Float64Array(5); this.h3 = new Lin(3, 1); this.tn = new Lin(5, 3);
        this.cf = new Float64Array(3); this.ksm = 0; this.k41 = 0; this.ra = 0; this.rb = 0;
        this.zero();
      }
      zero() {
        this.sm = 0; this.v41 = 0; this.vs1 = 0; this.v40 = 0; this.v39 = 0; this.v38 = 0; this.v37 = 0; this.xe = 0; this.xb = 0;
        this.s1a = 0; this.s1b = 0; this.s2a = 0; this.s2b = 0; this.h3.reset(); this.tn.reset(); this.sf = 0; this.vo = 0; this.tN = 0;
      }
      os() {
        const P = CY, fs = this.M.fs;
        skHP(this.h1, 0, P.C48, P.C59, P.R124, P.R127, 1, kBil(2500, fs));
        skHP(this.h2, 0, P.C51, P.C52, P.R107, P.R113, 2, kBil(9000, fs));
        this.h3.design(cyHP3, null, 2 / kBil(9000, fs));
        this.ksm = 1 - Math.exp(-this.M.h / P.TSM);
        this.kn();
      }
      kn() {
        const P = CY, M = this.M, fs = M.fs, kv = M.kv;
        // tone: VR4 (20 k B) with its wiper grounded — T1 sees Ra to ground, T2 sees Rb + R125; TONE 10 = band 3 full
        const t = clamp01(kv[K.cyt]);
        this.ra = P.VR4 * t + RW; this.rb = P.VR4 * (1 - t) + RW;
        this.tn.design(cyTone, this, 2 / kBil(6000, fs));
        const rf = 1 / (1 / P.R128 + 1 / (P.VR6 * tapA(clamp01(kv[K.cyl])) + RW));
        bil1(this.cf, 0, 0, rf, rf * P.C77, 1, kBil(Math.min(1 / (TAU * rf * P.C77), 0.4 * fs), fs));
        this.k41 = M.h / ((P.R93 + P.VR2 * clamp01(kv[K.cyd]) + RW) * P.C41);
      }
      fire(V) { this.tV = vMetal(V); this.tN = this.M.nP; this.on = true; this.qn = 0; }
      // a span: the trigger's loop while the smoother moves (the peak followers charging, per sample), then the ringing
      // loop — the envelopes (τ ≥ 15 ms) step per chunk on the chunk's mean VCA currents
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.tN > 0 || this.sm !== 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const P = CY, M = this.M, CH = M.CH, h = M.h, lo = M.lo, hi = M.hi, g = mixG(P.RMIX), tV = this.tV;
        const H1 = this.h1, H2 = this.h2, h3 = this.h3, A3 = h3.Ad, B3 = h3.Bd, C3 = h3.C, D3 = h3.D, x3 = h3.x;
        const tn = this.tn, At = tn.Ad, Bt = tn.Bd, Ct = tn.C, Dt = tn.D, xt = tn.x, ut = tn.up, cf = this.cf;
        const ion = BETA * KPK * (B15 - VBE) / MT.RB, ksm = this.ksm, k41 = this.k41, iVT = 1 / VT;
        const rN = P.R91 + par(P.R92, P.R89), kN = P.R89 / (P.R92 + P.R89), g90 = 1 / P.R90, gN = 1 / rN, gt2 = g90 + gN;
        const kE = 1 - Math.exp(-h / (par(P.R90, rN) * (P.C50 + P.C43))), kB = 1 - Math.exp(-h / (P.R94 * (P.C47 + P.C36)));
        let sm = this.sm, v41 = this.v41, vs1 = this.vs1, v40 = this.v40, v39 = this.v39, v38 = this.v38, v37 = this.v37;
        let xe = this.xe, xb = this.xb, s1a = this.s1a, s1b = this.s1b, s2a = this.s2a, s2b = this.s2b, u3p = h3.up[0], sf = this.sf;
        let tN = this.tN, vo = this.vo, c = o;
        let a0 = x3[0], a1 = x3[1], a2 = x3[2], t0 = xt[0], t1 = xt[1], t2 = xt[2], t3 = xt[3], t4 = xt[4], ut0 = ut[0], ut1 = ut[1], ut2 = ut[2];
        for (; c < e && (tN > 0 || sm !== 0); c += CH) {
          // EG1.2's supply per chunk (it moves over 73 ms); EG2's and EG3's per sample below (they jump with the trigger)
          const sw1 = swing(vs1), lk1 = sw1 > 1e-9 ? Math.log(P.R104 * ion / sw1) : 0, r2 = par(P.R90, rN) * ion, r3 = P.R94 * ion;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            sm += (Math.max(vt - P.VSM, 0) - sm) * ksm;
            const ve = sm - P.VON;
            v41 = Math.max(ve, v41 - v41 * k41); v40 = Math.max(ve, v40); v38 = Math.max(ve, v38);
            const e20 = Math.max(v41 - P.VF, 0);
            // VCA1 (Q18, 3440 Hz band) on EG1.2 (C45) through R104; VCA2 (Q17) and VCA3 (Q16) on the 7100 Hz band
            const yl = lo[i] * iVT, yh = hi[i] * iVT;
            const xg = vs1 - sw1 * gT(yl + lk1);
            const vs2 = (v39 * g90 + e20 * kN * gN) / gt2, sw2 = swing(vs2), sw3 = swing(v38);
            const te = vs2 - (sw2 > 1e-9 ? sw2 * gT(yh + Math.log(r2 / sw2)) : 0); xe = Math.min(te, xe + (te - xe) * kE);
            const tb = v38 - (sw3 > 1e-9 ? sw3 * gT(yh + Math.log(r3 / sw3)) : 0); xb = Math.min(tb, xb + (tb - xb) * kB);
            // the envelopes' currents
            vs1 += h * ((e20 - vs1) / P.R105 - Math.max(vs1 - xg, 0) / P.R104) / P.C45;
            const i88 = (v40 - v39) / P.R88;
            v40 -= h * i88 / P.C40; v39 = Math.max(v39 + h * (i88 - Math.max(v39 - xe, 0) / P.R90) / P.C39, 0);
            const i87 = (v38 - v37) / P.R87;
            v38 = Math.max(v38 - h * (i87 + Math.max(v38 - xb, 0) / P.R94) / P.C38, 0); v37 += h * i87 / P.C37;
            // the high-passes
            const y1 = H1[0] * xg + s1a; s1a = H1[1] * xg - H1[3] * y1 + s1b; s1b = H1[2] * xg - H1[4] * y1;
            let y2 = H2[0] * xe + s2a; s2a = H2[1] * xe - H2[3] * y2 + s2b; s2b = H2[2] * xe - H2[4] * y2;
            const q3 = xb + u3p; u3p = xb;
            const n0 = A3[0] * a0 + A3[1] * a1 + A3[2] * a2 + B3[0] * q3, n1 = A3[3] * a0 + A3[4] * a1 + A3[5] * a2 + B3[1] * q3;
            a2 = A3[6] * a0 + A3[7] * a1 + A3[8] * a2 + B3[2] * q3; a0 = n0; a1 = n1;
            let y3 = C3[0] * a0 + C3[1] * a1 + C3[2] * a2 + D3[0] * xb;
            if (y2 > 11 || y2 < -11) y2 = rail(y2);
            if (y3 > 11 || y3 < -11) y3 = rail(y3);
            // the tone network (band A from HP3, band B from HP2, band C from HP1)
            const q0 = y3 + ut0, q1 = y2 + ut1, q2 = y1 + ut2; ut0 = y3; ut1 = y2; ut2 = y1;
            const z0 = At[0] * t0 + At[1] * t1 + At[2] * t2 + At[3] * t3 + At[4] * t4 + Bt[0] * q0 + Bt[1] * q1 + Bt[2] * q2;
            const z1 = At[5] * t0 + At[6] * t1 + At[7] * t2 + At[8] * t3 + At[9] * t4 + Bt[3] * q0 + Bt[4] * q1 + Bt[5] * q2;
            const z2 = At[10] * t0 + At[11] * t1 + At[12] * t2 + At[13] * t3 + At[14] * t4 + Bt[6] * q0 + Bt[7] * q1 + Bt[8] * q2;
            const z3 = At[15] * t0 + At[16] * t1 + At[17] * t2 + At[18] * t3 + At[19] * t4 + Bt[9] * q0 + Bt[10] * q1 + Bt[11] * q2;
            t4 = At[20] * t0 + At[21] * t1 + At[22] * t2 + At[23] * t3 + At[24] * t4 + Bt[12] * q0 + Bt[13] * q1 + Bt[14] * q2;
            t0 = z0; t1 = z1; t2 = z2; t3 = z3;
            const iS = Ct[0] * t0 + Ct[1] * t1 + Ct[2] * t2 + Ct[3] * t3 + Ct[4] * t4 + Dt[0] * y3 + Dt[1] * y2 + Dt[2] * y1;
            vo = -cf[0] * iS + sf; sf = -cf[1] * iS - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (tN === 0 && sm < 1e-9) sm = 0;                // the smoother settled: the ringing loop from the next chunk
          if (this.quiet(1)) return e;
        }
        this.sm = sm; this.v41 = v41; this.vs1 = vs1; this.v40 = v40; this.v39 = v39; this.v38 = v38; this.v37 = v37;
        this.xe = xe; this.xb = xb; this.s1a = s1a; this.s1b = s1b; this.s2a = s2a; this.s2b = s2b; h3.up[0] = u3p; this.sf = sf;
        x3[0] = a0; x3[1] = a1; x3[2] = a2; xt[0] = t0; xt[1] = t1; xt[2] = t2; xt[3] = t3; xt[4] = t4; ut[0] = ut0; ut[1] = ut1; ut[2] = ut2;
        this.tN = tN; this.vo = vo;
        return c;
      }
      ring(mb, o, e) {
        const P = CY, M = this.M, CH = M.CH, h = M.h, lo = M.lo, hi = M.hi, g = mixG(P.RMIX), T = CH * h;
        const H1 = this.h1, H2 = this.h2, h3 = this.h3, A3 = h3.Ad, B3 = h3.Bd, C3 = h3.C, x3 = h3.x;
        const tn = this.tn, At = tn.Ad, Bt = tn.Bd, Ct = tn.C, Dt = tn.D, xt = tn.x, ut = tn.up, cf = this.cf;
        const ion = BETA * KPK * (B15 - VBE) / MT.RB, e41 = Math.pow(1 - this.k41, CH), iVT = 1 / VT;
        const rN = P.R91 + par(P.R92, P.R89), kN = P.R89 / (P.R92 + P.R89), g90 = 1 / P.R90, gN = 1 / rN, gt2 = g90 + gN;
        const kE = 1 - Math.exp(-h / (par(P.R90, rN) * (P.C50 + P.C43))), kB = 1 - Math.exp(-h / (P.R94 * (P.C47 + P.C36)));
        const p10 = H1[0], p11 = H1[1], p12 = H1[2], p13 = H1[3], p14 = H1[4], p20 = H2[0], p21 = H2[1], p22 = H2[2], p23 = H2[3], p24 = H2[4];
        const a00 = A3[0], a01 = A3[1], a02 = A3[2], a10 = A3[3], a11 = A3[4], a12 = A3[5], a20 = A3[6], a21 = A3[7], a22 = A3[8];
        const e0 = B3[0], e1 = B3[1], e2 = B3[2], o0 = C3[0], o1 = C3[1], o2 = C3[2], o3 = h3.D[0];
        const f0 = cf[0], f1 = cf[1], f2 = cf[2];
        const T00 = At[0], T01 = At[1], T02 = At[2], T03 = At[3], T04 = At[4], T10 = At[5], T11 = At[6], T12 = At[7], T13 = At[8], T14 = At[9];
        const T20 = At[10], T21 = At[11], T22 = At[12], T23 = At[13], T24 = At[14], T30 = At[15], T31 = At[16], T32 = At[17], T33 = At[18];
        const T34 = At[19], T40 = At[20], T41 = At[21], T42 = At[22], T43 = At[23], T44 = At[24];
        const B00 = Bt[0], B01 = Bt[1], B02 = Bt[2], B10 = Bt[3], B11 = Bt[4], B12 = Bt[5], B20 = Bt[6], B21 = Bt[7], B22 = Bt[8];
        const B30 = Bt[9], B31 = Bt[10], B32 = Bt[11], B40 = Bt[12], B41 = Bt[13], B42 = Bt[14];
        const U0 = Ct[0], U1 = Ct[1], U2 = Ct[2], U3 = Ct[3], U4 = Ct[4], V0 = Dt[0], V1 = Dt[1], V2 = Dt[2];
        let v41 = this.v41, vs1 = this.vs1, v40 = this.v40, v39 = this.v39, v38 = this.v38, v37 = this.v37;
        let xe = this.xe, xb = this.xb, s1a = this.s1a, s1b = this.s1b, s2a = this.s2a, s2b = this.s2b, u3p = h3.up[0], sf = this.sf, vo = this.vo;
        let a0 = x3[0], a1 = x3[1], a2 = x3[2], t0 = xt[0], t1 = xt[1], t2 = xt[2], t3 = xt[3], t4 = xt[4], ut0 = ut[0], ut1 = ut[1], ut2 = ut[2];
        for (let c = o; c < e; c += CH) {
          const e20 = Math.max(v41 - P.VF, 0), vs2 = (v39 * g90 + e20 * kN * gN) / gt2;
          const sw1 = swing(vs1), sw2 = swing(vs2), sw3 = swing(v38);
          const lk1 = sw1 > 1e-9 ? Math.log(P.R104 * ion / sw1) : 0, lk2 = sw2 > 1e-9 ? Math.log(par(P.R90, rN) * ion / sw2) : 0;
          const lk3 = sw3 > 1e-9 ? Math.log(P.R94 * ion / sw3) : 0;
          let pk = 0, ac1 = 0, ac2 = 0, ac3 = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const yl = lo[i] * iVT, yh = hi[i] * iVT;
            const d1 = sw1 * gT(yl + lk1), xg = vs1 - d1;
            const te = vs2 - sw2 * gT(yh + lk2); xe = Math.min(te, xe + (te - xe) * kE);
            const tb = v38 - sw3 * gT(yh + lk3); xb = Math.min(tb, xb + (tb - xb) * kB);
            ac1 += d1; ac2 += Math.max(v39 - xe, 0); ac3 += Math.max(v38 - xb, 0);
            const y1 = p10 * xg + s1a; s1a = p11 * xg - p13 * y1 + s1b; s1b = p12 * xg - p14 * y1;
            let y2 = p20 * xe + s2a; s2a = p21 * xe - p23 * y2 + s2b; s2b = p22 * xe - p24 * y2;
            const q3 = xb + u3p; u3p = xb;
            const n0 = (a00 * a0 + a01 * a1) + (a02 * a2 + e0 * q3), n1 = (a10 * a0 + a11 * a1) + (a12 * a2 + e1 * q3);
            a2 = (a20 * a0 + a21 * a1) + (a22 * a2 + e2 * q3); a0 = n0; a1 = n1;
            let y3 = (o0 * a0 + o1 * a1) + (o2 * a2 + o3 * xb);
            if (y2 > 11 || y2 < -11) y2 = rail(y2);
            if (y3 > 11 || y3 < -11) y3 = rail(y3);
            const q0 = y3 + ut0, q1 = y2 + ut1, q2 = y1 + ut2; ut0 = y3; ut1 = y2; ut2 = y1;
            // (the sums as trees: the states' recursion stays short; the inputs' share is off it)
            const w0 = B00 * q0 + B01 * q1 + B02 * q2, w1 = B10 * q0 + B11 * q1 + B12 * q2, w2 = B20 * q0 + B21 * q1 + B22 * q2;
            const w3 = B30 * q0 + B31 * q1 + B32 * q2, w4 = B40 * q0 + B41 * q1 + B42 * q2;
            const z0 = ((T00 * t0 + T01 * t1) + (T02 * t2 + T03 * t3)) + (T04 * t4 + w0);
            const z1 = ((T10 * t0 + T11 * t1) + (T12 * t2 + T13 * t3)) + (T14 * t4 + w1);
            const z2 = ((T20 * t0 + T21 * t1) + (T22 * t2 + T23 * t3)) + (T24 * t4 + w2);
            const z3 = ((T30 * t0 + T31 * t1) + (T32 * t2 + T33 * t3)) + (T34 * t4 + w3);
            t4 = ((T40 * t0 + T41 * t1) + (T42 * t2 + T43 * t3)) + (T44 * t4 + w4);
            t0 = z0; t1 = z1; t2 = z2; t3 = z3;
            const iS = ((U0 * t0 + U1 * t1) + (U2 * t2 + U3 * t3)) + (U4 * t4 + (V0 * y3 + V1 * y2 + V2 * y1));
            vo = -f0 * iS + sf; sf = -f1 * iS - f2 * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          // the envelopes per chunk: EG1 (DECAY) exact; EG1.2, EG2, EG3 by the chunk's mean VCA currents
          v41 *= e41;
          vs1 += T * ((e20 - vs1) / P.R105 - ac1 / (CH * P.R104)) / P.C45;
          const i88 = (v40 - v39) / P.R88;
          v40 -= T * i88 / P.C40; v39 = Math.max(v39 + T * (i88 - ac2 / (CH * P.R90)) / P.C39, 0);
          const i87 = (v38 - v37) / P.R87;
          v38 = Math.max(v38 - T * (i87 + ac3 / (CH * P.R94)) / P.C38, 0); v37 += T * i87 / P.C37;
          if (this.quiet(Math.max(pk, swing(v41 - P.VF), swing(vs1), swing(Math.max(v39, v40)), swing(v38)))) return;
        }
        this.v41 = v41; this.vs1 = vs1; this.v40 = v40; this.v39 = v39; this.v38 = v38; this.v37 = v37;
        this.xe = xe; this.xb = xb; this.s1a = s1a; this.s1b = s1b; this.s2a = s2a; this.s2b = s2b; h3.up[0] = u3p; this.sf = sf;
        x3[0] = a0; x3[1] = a1; x3[2] = a2; xt[0] = t0; xt[1] = t1; xt[2] = t2; xt[3] = t3; xt[4] = t4; ut[0] = ut0; ut[1] = ut1; ut[2] = ut2;
        this.vo = vo;
      }
    }

    /* OPEN / CLOSED HAT (RC §9): both on the 7100 Hz band. OH: Q24 charges C62 from the metal bus; Q21 holds C60 (the
     * DECAY timer: VR3 2 M B + R132 from +15 V) discharged during the trigger, after which C60 charges until Q22 conducts
     * and drains C62 through R134; Q29 buffers C62 into the VCA (Q27) through R144; Sallen-Key high-pass Q26 (≈ 7.8 kHz)
     * → C80 / R160 → IC7. CH: Q28 charges C63, which supplies the VCA (Q30) through R142 and, through R173, holds Q23 on —
     * Q23 drains the open hat's C62 through R134 (the choke); high-pass Q31 (≈ 11.7 kHz) → C74 / R162 → IC7. */
    class Hat extends Voice {
      constructor(M, open) {
        super(M, 6.9);
        this.open = open;
        this.hp = new Float64Array(5); this.cc = new Float64Array(3); this.cf = new Float64Array(3); this.g60 = 0;
        this.zero();
      }
      // mute: the closed hat fired for a CH sample (§5) — its circuit runs (C63, the choke) but adds nothing to the bus
      zero() { this.v62 = 0; this.v60 = B15; this.xn = 0; this.s1 = 0; this.s2 = 0; this.sc = 0; this.sf = 0; this.vo = 0; this.tN = 0; this.mute = false; }
      os() {
        const P = HH, fs = this.M.fs, o = this.open;
        // the high-pass prewarped at its corner (OH) / at 9 kHz (CH, MA: their 11–12 kHz corners would leave > 0.2 dB below
        // 5 kHz at OS 4; at 9 kHz both the passband and the resonance's place hold, the peak ≈ 0.6 % low)
        skHP(this.hp, 0, o ? P.C66 : P.C72, o ? P.C68 : P.C73, o ? P.R147 : P.R153, o ? P.R146 : P.R155, 1, kBil(o ? 7800 : 9000, fs));
        const r = o ? P.R160 : P.R162, c = o ? P.C80 : P.C74;
        bil1(this.cc, 0, c, 0, r * c, 1, kBil(o ? 7800 : 11700, fs));
        this.kn();
      }
      kn() {
        const P = HH, M = this.M, fs = M.fs, kv = M.kv, o = this.open;
        const rf = 1 / (1 / (o ? P.R159 : P.R161) + 1 / (P.VR7 * tapA(clamp01(kv[o ? K.ohl : K.chl])) + RW)), c = o ? P.C79 : P.C82;
        bil1(this.cf, 0, 0, rf, rf * c, 1, kBil(Math.min(1 / (TAU * rf * c), 0.4 * fs), fs));
        if (o) this.g60 = 1 / (P.R132 + P.VR3 * clamp01(kv[K.ohd]) + RW);   // C60's charging conductance (DECAY)
      }
      fire(V) { this.tV = vMetal(V); this.tN = this.M.nP; this.on = true; this.qn = 0; }
      // a span: the trigger's loop (the envelope capacitor charging, per sample), then the ringing loop — the envelopes
      // (τ ≥ 15 ms) step per chunk on the chunk's mean VCA current. The closed hat leaves its C63 per chunk in M.v63
      // (chunk-start index) for the open hat's choke.
      run(mb, o, n) {
        const e = o + n;
        let c = o;
        if (this.tN > 0) c = this.att(mb, o, e);
        if (c < e && this.on) this.ring(mb, c, e);
      }
      att(mb, o, e) {
        const P = HH, M = this.M, CH = M.CH, h = M.h, hi = M.hi, op = this.open, hp = this.hp, cc = this.cc, cf = this.cf, tV = this.tV;
        const g = this.mute ? 0 : mixG(op ? P.RMIXO : P.RMIXC), ion = BETA * KPK * (B15 - VBE) / MT.RB, rc = op ? P.R144 : P.R142, iVT = 1 / VT;
        const kx = 1 - Math.exp(-h / (rc * (op ? P.C64 + P.C65 : P.C69 + P.C70))), kch = 1 - Math.exp(-h / (P.R137 * P.C62));
        const tr = M.v63, g60 = this.g60, rr = P.R130 / (P.R130 + P.R131), VF = CY.VF, g133 = 1 / P.R133, g173 = 1 / P.R173;
        const g134 = 1 / P.R134, g139 = 1 / P.R139, h60 = h / P.C60, h62 = h / P.C62, h63 = h / P.C63, grc = 1 / rc;
        let v62 = this.v62, v60 = this.v60, xn = this.xn, s1 = this.s1, s2 = this.s2, sc = this.sc, sf = this.sf, tN = this.tN, vo = this.vo, c = o;
        for (; c < e && tN > 0; c += CH) {
          let ib23 = 0;
          if (op) { const v63 = tr[c]; ib23 = Math.max(v63 - VBE, 0) * g173; } else tr[c] = v62;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const vt = tN > 0 ? tV : 0;
            if (tN > 0) tN--;
            // the envelope capacitor (OH: C62, CH: C63): charged by its follower from the metal bus
            v62 = Math.max(v62, v62 + (vt - 0.7 - v62) * kch);
            let vs;
            if (op) {
              // Q21 discharges C60 during the trigger; C60 charges through VR3 + R132 into Q22's base (R133); Q22 and
              // Q23 (the choke, from the closed hat's C63 through R173) drain C62 through R134
              const ib22 = Math.max(v60 - VBE, 0) * g133;
              if (vt * rr > VBE) v60 = 0; else v60 += ((B15 - v60) * g60 - ib22) * h60;
              const i134 = v62 > VSAT ? Math.min(BETA * (ib22 + ib23), (v62 - VSAT) * g134) : 0;
              v62 -= (v62 * g139 + i134) * h62;
              vs = Math.max(v62 - VF, 0);                    // Q29's emitter (base via R140)
            } else vs = v62;
            // the supply per sample while it charges (its swing and the switch's offset follow it)
            const sw = swing(vs), t1 = vs - (sw > 1e-9 ? sw * gT(hi[i] * iVT + Math.log(rc * ion / sw)) : 0);
            xn = Math.min(t1, xn + (t1 - xn) * kx);
            if (!op) v62 = Math.max(v62 - ((vs - xn) * grc + Math.max(v62 - VBE, 0) * g173) * h63, 0);
            const yh = hp[0] * xn + s1; s1 = hp[1] * xn - hp[3] * yh + s2; s2 = hp[2] * xn - hp[4] * yh;
            const yc = cc[0] * yh + sc; sc = cc[1] * yh - cc[2] * yc;
            vo = -cf[0] * yc + sf; sf = -cf[1] * yc - cf[2] * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (this.quiet(1)) return e;
        }
        this.v62 = v62; this.v60 = v60; this.xn = xn; this.s1 = s1; this.s2 = s2; this.sc = sc; this.sf = sf; this.tN = tN; this.vo = vo;
        return c;
      }
      ring(mb, o, e) {
        const P = HH, M = this.M, CH = M.CH, h = M.h, hi = M.hi, op = this.open, hp = this.hp, cc = this.cc, cf = this.cf;
        const g = this.mute ? 0 : mixG(op ? P.RMIXO : P.RMIXC), ion = BETA * KPK * (B15 - VBE) / MT.RB, rc = op ? P.R144 : P.R142, iVT = 1 / VT;
        const kx = 1 - Math.exp(-h / (rc * (op ? P.C64 + P.C65 : P.C69 + P.C70))), tr = M.v63, g60 = this.g60, VF = CY.VF;
        const g133 = 1 / P.R133, g173 = 1 / P.R173, g134 = 1 / P.R134, g139 = 1 / P.R139, T = CH * h, grc = 1 / rc;
        const H0 = hp[0], H1 = hp[1], H2 = hp[2], H3 = hp[3], H4 = hp[4], k0 = cc[0], k1 = cc[1], k2 = cc[2], f0 = cf[0], f1 = cf[1], f2 = cf[2];
        let v62 = this.v62, v60 = this.v60, xn = this.xn, s1 = this.s1, s2 = this.s2, sc = this.sc, sf = this.sf, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          const vs = op ? Math.max(v62 - VF, 0) : v62, sw = swing(vs), lnK = sw > 1e-9 ? Math.log(rc * ion / sw) : 0;
          if (!op) tr[c] = v62;
          let pk = 0, acc = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            const t1 = vs - sw * gT(hi[i] * iVT + lnK);
            xn = Math.min(t1, xn + (t1 - xn) * kx);
            acc += vs - xn;
            const yh = H0 * xn + s1; s1 = H1 * xn - H3 * yh + s2; s2 = H2 * xn - H4 * yh;
            const yc = k0 * yh + sc; sc = k1 * yh - k2 * yc;
            vo = -f0 * yc + sf; sf = -f1 * yc - f2 * vo;
            const vq = vo > 11 || vo < -11 ? rail(vo) : vo;
            mb[i] += g * vq;
            pk = Math.max(pk, Math.abs(vq));
          }
          if (op) {
            const ib22 = Math.max(v60 - VBE, 0) * g133, ib23 = Math.max(tr[c] - VBE, 0) * g173;
            v60 += ((B15 - v60) * g60 - ib22) * T / P.C60;
            const i134 = v62 > VSAT ? Math.min(BETA * (ib22 + ib23), (v62 - VSAT) * g134) : 0;
            v62 -= (v62 * g139 + i134) * T / P.C62;
          } else v62 = Math.max(v62 - (acc / CH * grc + Math.max(v62 - VBE, 0) * g173) * T / P.C63, 0);
          if (this.quiet(Math.max(pk, swing(op ? v62 - VF : v62)))) return;
        }
        this.v62 = v62; this.v60 = v60; this.xn = xn; this.s1 = s1; this.s2 = s2; this.sc = sc; this.sf = sf; this.vo = vo;
      }
    }

    /* ================================================================== the TR-606 (stage 7b lane V6, IMPL-7b §2) */
    // Our circuit-level model of the 606's voice board (main board + the toms' sub board), from the component values of
    // its service notes' schematic (read for values only; the tables as modelled: research-606-circuits.md §15). No
    // negative rail: every op-amp sits on a bias and swings 0 … 13.5 V (NJM2904), so a stage clips (bias) down and
    // (13.5 − bias) up; the swing-type VCAs and the noise are the 808's blocks with the 606's networks.
    const V_N6 = 4.8;                                       // +B ≈ 6.15 V (RD6.8EB less V_BE) − D6 − Q11's V_BE [C, R6 §14]
    const R189 = 47e3;                                      // IC14A's feedback: the voices add R189 · (their current) to the bus
    // ACCENT (§1.3): Q9 saturated into VR2 (10 k B as a rheostat, u clockwise = more) and R43 4.7 k at Q11's base; below
    // the unaccented path's height the accent is the plain trigger
    const vAcc6 = u => { const r = 10e3 * (1 - clamp01(u)) + RW, v = 15 * 4.7e3 / (4.7e3 + r) - VBE; return v > V_N6 ? v : V_N6; };
    const V_X6 = vAcc6(1);
    function vTrig6(v127, ac) {
      const VA = vAcc6(ac);
      if (!(v127 >= 1)) v127 = 1;
      if (v127 > 127) v127 = 127;
      if (v127 >= 100) { const u = (v127 - 100) / 27; return (1 - u) * V_N6 + u * VA; }
      return V_N6 * (0.6 + 0.4 * (v127 - 1) / 99);
    }
    const BIAS9 = 15 * 47 / 79, BIAS4 = 15 * 47 / 169;     // + inputs: 15 V · R65 / (R52 + R51 + R65); the snare's R118 / (R101 + R113 + R118)
    const OA_HI = 13.5;                                     // the NJM2904's top on 15 V; its bottom is ground [R typ]
    const VD = 0.6;                                         // a 1S2473's forward drop (the gating and pick-off diodes) [C]
    const BD6 = Object.freeze({ R63: 10e3, R64: 1e3, C25: 0.47e-6, R51: 22e3, R65: 47e3, C19: 56e-9, R59: 680e3, R58: 3.3e3,
      C23: 15e-9, R61: 560e3, R66: 12e3, R56: 10e3, C16: 1e-6, R60: 18e3, C22: 1e-6, C21: 0.01e-6, VR3: 50e3, R57: 47e3 });
    const SD6 = Object.freeze({ R98: 10e3, R99: 1e3, C34: 3.3e-9, R113: 22e3, R118: 47e3, C32: 27e-9, R112: 820e3, R107: 330,
      R115: 680, R106: 100e3, R104: 18e3, C31: 0.47e-6, R105: 27e3, R114: 47e3, R100: 1e3, C35: 0.47e-6, R120: 27e3,
      C37: 0.056e-6, R121: 15e3, C38: 1.5e-9, C39: 2.2e-9, C51: 0.047e-6, R147: 1e6, C52: 1.8e-9, C58: 1.8e-9, R153: 22e3,
      R155: 100e3, R152: 100e3, C57: 0.01e-6, R111: 10e3, R110: 68e3, VR4: 50e3, R102: 10e3 });
    // the toms' sub board: LT (IC9A) / HT (IC9B); the pitch envelope C303 (Q305 / Q306 dump C302); the rumble Q309 → Q310
    const TM6 = Object.freeze({ R312: 10e3, R311: 1e3, C301: 4.7e-9, R309: 10e3, R310: 1e3, C307: 3.9e-9, R320: 22e3,
      R329: 47e3, C304: 27e-9, R1L: 2e6, R323: 180, R318: 820, C310: 18e-9, R1H: 2e6, R334: 100, R333: 820, C303: 0.47e-6,
      R317: 680e3, R319: 39e3, R331: 680e3, R332: 22e3, R321: 100, C302: 47e-6, R337: 2.2e3, C313: 0.068e-6, R338: 1e6, R339: 33e3,
      R346: 10e3, R347: 4.7e3, C312: 0.047e-6, R350: 4.7e3, R351: 10e3, C318: 47e-6, C316: 0.047e-6, R340: 22e3, R348: 10e3,
      C317: 0.01e-6, R349: 100e3, R326: 15e3, R327: 15e3, VR5: 50e3, R108: 22e3 });
    // the metal bank: six HD14584 oscillators f = 2.0698 / RC (the 808's two measured: RC §7) — A R226 330 k / C99 15 n
    // (before the "84 lot": §13 Q3), B R225 / C98, C R224 / C97, D R244 / C107, E R245 / C108, F R246 / C109 — each through
    // 150 k into R210 1 k; the band-passes IC15B / IC15A are the 808's value for value (MT's fields); the swing VCAs' bases
    // C76 47 n / R202 1 M (the 3454 Hz band, Q39) and C65 / C66 1 µ / R180 / R173 1 M (the 7117 Hz band, Q38 / Q37), +15 V
    const FRC = 2.0698;
    const MT6 = Object.freeze(Object.assign({}, MT, { F: [FRC / (330e3 * 15e-9), FRC / (470e3 * 10e-9), FRC / (330e3 * 10e-9),
      FRC / (560e3 * 15e-9), FRC / (560e3 * 12e-9), FRC / (470e3 * 12e-9)], RS: 150e3, R53: 1e3, CL: 0.047e-6, RL: 1e6,
      CH: 1e-6, RH: 1e6, R226L: 680e3 }));
    const CY6 = Object.freeze({ R141: 220, C49: 1e-6, R163: 1e6, R164: 1e6, R183: 15e3, R184: 15e3, R185: 33e3, C61: 2.2e-6,
      R186: 33e3, C77: 2.2e-9, R202: 1e6, C59: 2.2e-9, C60: 2.2e-9, R159: 22e3, R195: 100e3, R196: 100e3, C79: 0.01e-6,
      R198: 47e3, C78: 3.3e-9, R200: 22e3, C47: 1e-6, R165: 68e3, C48: 2.2e-6, R166: 22e3, R181: 33e3, C64: 2.2e-9,
      R180: 1e6, C62: 2.2e-9, C63: 1e-9, C73: 1e-9, R203: 18e3, R207: 39e3, R208: 39e3, R204: 5.6e3, VR6: 50e3, R109: 10e3 });
    // the hats: C45 (OH), C42 (CH), one VCA Q37; the choke Q25 (C42 → R135) and the tempo cut Q24 (C41 → R131), both
    // draining C45 through R137 (C46 / R136 on their collectors: not modelled, R6 §15); the tempo clock's pulse (IC1 pin
    // 10, 5 V) → D1 → R6 into C41
    const HH6 = Object.freeze({ R140: 220, C45: 1e-6, R167: 1e6, R168: 33e3, R169: 33e3, R170: 33e3, R137: 100e3,
      R131: 100e3, C41: 0.056e-6, R6: 15e3, R133: 220, C42: 0.47e-6, R134: 33e3, R135: 330e3,
      C43: 2.2e-9, R173: 1e6, C67: 2.2e-9, C44: 2.2e-9, R172: 12e3, C69: 1e-9, C70: 1e-9, R174: 18e3, R175: 39e3,
      R176: 39e3, VR7: 50e3, R149: 22e3,
      // the tempo clock (IC1, Q2): its pin-10 pulse lasts while Q2 recharges C8 across the Schmitt's hysteresis (0.60 V:
      // the 2.07 · RC constant's thresholds 2.10 / 2.70 V at 5 V) on β · I_B (R13 47 k from the 5 V gate's swing, R22 47 k
      // across the junction), plus two HD14584 delays (≈ 0.13 µs each at 5 V) — ≈ 1.25 µs [C, R6 §14], far below a
      // sample: a charge event of TCK into C41
      VCK: 5, C8: 0.039e-6, HYS: 0.6, R13: 47e3, R22: 47e3, TPD: 0.13e-6 });
    const TCK = HH6.C8 * HH6.HYS / (BETA * ((HH6.VCK - VBE) / HH6.R13 - VBE / HH6.R22)) + 2 * HH6.TPD;
    // the noise (IC10B: gain 1 + R116 / (R117 + TM3) set by TM3 for 130 mV rms at the test point; C36 across R116: the
    // pole FC) and the mixer / output (IC14A, VOLUME, IC14B: both at 7.5 V, the rails 0 … 13.5 V)
    const NZ6 = Object.freeze({ R116: 1e6, C36: 22e-12, R117: 22e3, RMS: 0.13, FC: 1 / (TAU * 1e6 * 22e-12) });
    const MIX6 = Object.freeze({ R189, C86: 220e-12, C56: 2.2e-6, C87: 2.2e-6, VR8: 50e3, R191: 22e3, C83: 2.2e-6, R190: 33e3,
      C88: 220e-12, HI: OA_HI - 7.5, LO: 7.5 });
    // the output's full-scale constant (volts at OUTPUT → 1.0): §2.5 — the BD at the default panel, unaccented, peaks at
    // the 808's default BD (0.4286 at OS 4, 48 kHz; tests/dr-606.test.mjs)
    const OUT_K6 = 1.364;
    // a full-scale sample at LEVEL 10 ≈ the bass drum's peak on the bus at LEVEL 10, unaccented (§5)
    const SMP_LEVEL6 = 1.68;

    // 2 × 2 inverse of [[m00 m01] [m10 m11]] into c[o…o+3]
    function inv2(c, o, m00, m01, m10, m11) { const d = 1 / (m00 * m11 - m01 * m10); c[o] = m11 * d; c[o + 1] = -m01 * d; c[o + 2] = -m10 * d; c[o + 3] = m00 * d; }
    // the bridged-T in a non-inverting single-supply loop (BD, SD, toms): equal capacitors C, R1 bridging, the shunt leg
    // G = 1/R2 (moved by the pitch kicks), trapezoidal in s-form (x = M⁻¹ (s + h/2·B u), s ← 2x − s: exact as A moves);
    // V_J = u − a, Vo = u − a − b. At a rail the output is the rail and V− leaves u: the same network with J = Vo + b
    // (A_s, the rail as input). c: [0…3] M⁻¹ in the loop, [4…7] M⁻¹ saturated, [8] h/2 · (−G/C)
    function btDesign(c, C, R1, G, h) {
      const h2 = 0.5 * h, p = 1 / (R1 * C), q2 = -1 / (R1 * C), g = G / C;
      inv2(c, 0, 1 + h2 * p, h2 * p, -h2 * (g + q2), 1 - h2 * q2);
      inv2(c, 4, 1 + h2 * p, h2 * p, -h2 * q2, 1 - h2 * (q2 - g));
      c[8] = -h2 * g;
    }
    // a transistor's base fed from a Thevenin source (Vth behind Rth) through its junction: Ib with Vth = Ib·Rth +
    // V_T·ln(1 + Ib / Is_b), Is_b = I_ES / β — tabulated once per Rth (0.5 mV steps to 2 V, then 10 mV; linear between)
    const JQ1 = 4000, JQ2 = 1400, JTB = new Map();
    function jTab(R) {
      let T = JTB.get(R);
      if (T) return T;
      T = new Float64Array(JQ1 + JQ2 + 2);
      const isb = IES / BETA;
      let z = 0;
      for (let k = 0; k < JQ1 + JQ2 + 2; k++) {
        const v = k <= JQ1 ? k / 2000 : 2 + (k - JQ1) / 100;
        for (let it = 0; it < 100; it++) {                  // Newton in z = ln(1 + Ib / Is_b), warm along v
          const ez = Math.exp(z), st = (isb * (ez - 1) * R + VT * z - v) / (isb * ez * R + VT);
          z -= st; if (z < 0) z = 0;
          if (Math.abs(st) < 1e-12) break;
        }
        T[k] = isb * (Math.exp(z) - 1);
      }
      JTB.set(R, T);
      return T;
    }
    function jIb(T, v) {
      if (!(v > 0)) return 0;
      let x, i;
      if (v < 2) { x = v * 2000; i = x | 0; } else { x = JQ1 + (v - 2) * 100; i = x < JQ1 + JQ2 ? x | 0 : JQ1 + JQ2; }
      return T[i] + (T[i + 1] - T[i]) * (x - i);
    }
    // a 50 k B level pot at position k as the divider into Rs (the mixer's virtual earth): o[0] the load the top node
    // sees, o[1] the current into Rs per volt at the top (the pot's ends 50 Ω)
    function pot6(k, R, Rs, o) { const rt = R * (1 - k) + RW, rb = R * k + RW, rl = par(rb, Rs); o[0] = 1 / (rt + rl); o[1] = rl / (rt + rl) / Rs; return o; }
    // an op-amp output about its bias (single supply): linear, then a 1 V knee into the rails (lo below, hi above)
    function rail6(v, lo, hi) {
      if (v > hi - 1) return hi - Math.exp(hi - 1 - v);
      if (v < 1 - lo) return Math.exp(v + lo - 1) - lo;
      return v;
    }
    // the extras (§2.3): at 5 every factor is exactly 1 (4 ** 0)
    const fUp = u => Math.pow(4, 2 * (clamp01(u) - 0.5)), fDn = u => Math.pow(4, -2 * (clamp01(u) - 0.5));

    // the 606's knobs (models.js ids, IMPL-7b §1.1): the face, then the extras (5 = the stock circuit, §2.3)
    const K6_IDS = Object.freeze(['ac', 'bdl', 'sdl', 'tml', 'cyl', 'hhl', 'vol', 'bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu',
      'htd', 'cyd', 'ohd', 'chd']);
    const K6_DEF = Object.freeze([0.5, 0.7, 0.7, 0.7, 0.7, 0.7, 0.75, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const K6 = Object.freeze(Object.fromEntries(K6_IDS.map((k, i) => [k, i])));
    // knob → the circuits it retunes: 1 BD, 2 SD, 4 the tom pair, 8 CY, 16 the hat pair; 1 << 30 the output stage
    const K6_CIR = Object.freeze([0, 1, 2, 4, 8, 16, 1 << 30, 1, 1, 2, 2, 4, 4, 4, 4, 8, 16, 16]);
    // the sounds it has (the 808's ids, §1.2), its lanes (bits & 0xE2F) → sound; per sound its LEVEL / TUNE / DECAY knob
    // (the samples' rules, §5; −1 none)
    const S6 = Object.freeze([0, 1, 2, 4, 8, 9, 10]);
    const HAS6 = Object.freeze(Array.from({ length: 16 }, (_, s) => S6.includes(s)));
    const LANE_S6 = Object.freeze([-1, 0, 1, 2, -1, 4, -1, -1, -1, 8, 9, 10]);
    const S6_LEV = Object.freeze([K6.bdl, K6.sdl, K6.tml, -1, K6.tml, -1, -1, -1, K6.cyl, K6.hhl, K6.hhl, -1, -1, -1, -1, -1]);
    const S6_TUN = Object.freeze([K6.bdu, K6.sdu, K6.ltu, -1, K6.htu, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    const S6_DEC = Object.freeze([K6.bdd, K6.sdd, K6.ltd, -1, K6.htd, -1, -1, -1, K6.cyd, K6.ohd, K6.chd, -1, -1, -1, -1, -1]);

    /* BASS DRUM (R6 §4, §15): the gated trigger / 11 (R63 / R64) through C25 into the + inputs (15 k to the decoupled
     * bias) of two bridged-T loops in parallel — IC5A 60 Hz (C19 / C20, R59, R58) and IC5B 129 Hz (C23 / C24, R61, R66),
     * each on its own rails — summed by R56 + C16 / R60 + C22 into VR3's top (C21), the wiper into R57. */
    function bdNet6(c, x, u, dx) {                          // x = (C16, C22, the top of VR3), u = (IC5A, IC5B)
      const P = BD6, i16 = (u[0] - x[0] - x[2]) / P.R56, i22 = (u[1] - x[1] - x[2]) / P.R60;
      dx[0] = i16 / P.C16; dx[1] = i22 / P.C22; dx[2] = (i16 + i22 - x[2] * c.pt[0]) / P.C21;
      return x[2] * c.pt[1] * R189;
    }
    class Bd6 extends Voice {
      constructor(M) {
        super(M, V_N6);
        this.ca = new Float64Array(9); this.cb = new Float64Array(9); this.net = new Lin(3, 2); this.pt = new Float64Array(2);
        this.ex = 0; this.exA = 0;
        this.zero();
      }
      zero() { this.cx = 0; this.sa = 0; this.sb = 0; this.ta = 0; this.tb = 0; this.net.reset(); this.vo = 0; this.tN = 0; }
      os() {
        // C25 between the divider (R63 ∥ R64) and the + inputs' load (R51 ∥ R65): u = the load's share of (V − v_C25),
        // its mean over the sample (exact exponential: a pulse's area is kept at every rate)
        const P = BD6, h = this.M.h, rq = par(P.R51, P.R65), rs = par(P.R63, P.R64), tau = P.C25 * (rq + rs);
        this.ex = Math.exp(-h / tau); this.exA = rq / (rq + rs) * tau / h * (1 - this.ex);
        this.kn();
      }
      kn() {
        const P = BD6, M = this.M, fs = M.fs, kv = M.kv;
        // TUNE: both R2 × 4^−2(u−½); DECAY: R1 × 4^2(u−½), R2 × 4^−2(u−½) (constant pitch)
        const t = fDn(kv[K6.bdu]), d = fUp(kv[K6.bdd]);
        const r1a = P.R59 * d, r2a = P.R58 * t / d, r1b = P.R61 * d, r2b = P.R66 * t / d;
        btDesign(this.ca, P.C19, r1a, 1 / r2a, 2 / kBil(1 / (TAU * P.C19 * Math.sqrt(r1a * r2a)), fs));
        btDesign(this.cb, P.C23, r1b, 1 / r2b, 2 / kBil(1 / (TAU * P.C23 * Math.sqrt(r1b * r2b)), fs));
        pot6(clamp01(kv[K6.bdl]), P.VR3, P.R57, this.pt);
        this.net.design(bdNet6, this, 2 / kBil(2500, fs));
      }
      fire(V) { this.tV = V * BD6.R64 / (BD6.R63 + BD6.R64); this.tN = this.M.nP; this.on = true; this.qn = 0; }
      run(mb, o, n) {
        const M = this.M, CH = M.CH, e = o + n, ca = this.ca, cb = this.cb, L = this.net, Ad = L.Ad, Bd = L.Bd, x = L.x, up = L.up;
        const a0 = ca[0], a1 = ca[1], a2 = ca[2], a3 = ca[3], a4 = ca[4], a5 = ca[5], a6 = ca[6], a7 = ca[7], ah = ca[8];
        const b0 = cb[0], b1 = cb[1], b2 = cb[2], b3 = cb[3], b4 = cb[4], b5 = cb[5], b6 = cb[6], b7 = cb[7], bh = cb[8];
        const A0 = Ad[0], A1 = Ad[1], A2 = Ad[2], A3 = Ad[3], A4 = Ad[4], A5 = Ad[5], A6 = Ad[6], A7 = Ad[7], A8 = Ad[8];
        const B0 = Bd[0], B1 = Bd[1], B2 = Bd[2], B3 = Bd[3], B4 = Bd[4], B5 = Bd[5], C0 = L.C[0], C1 = L.C[1], C2 = L.C[2], D0 = L.D[0], D1 = L.D[1];
        const VH = OA_HI - BIAS9, VL = -BIAS9, ex = this.ex, exA = this.exA, tV = this.tV;
        let cx = this.cx, sa = this.sa, sb = this.sb, ta = this.ta, tb = this.tb, x0 = x[0], x1 = x[1], x2 = x[2], u0 = up[0], u1 = up[1];
        let tN = this.tN, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let u = 0;
            if (tN > 0 || cx !== 0) {                      // C25: the pulse's mean over the sample (exact exponential)
              const vd = tN > 0 ? tV : 0;
              if (tN > 0) tN--;
              u = (vd - cx) * exA; cx = vd - (vd - cx) * ex;
            }
            let q = sb + ah * u, A = a0 * sa + a1 * q, B = a2 * sa + a3 * q, ya = u - A - B;
            if (ya > VH || ya < VL) { ya = ya > VH ? VH : VL; q = sb + ah * ya; A = a4 * sa + a5 * q; B = a6 * sa + a7 * q; }
            sa = 2 * A - sa; sb = 2 * B - sb;
            q = tb + bh * u; A = b0 * ta + b1 * q; B = b2 * ta + b3 * q;
            let yb = u - A - B;
            if (yb > VH || yb < VL) { yb = yb > VH ? VH : VL; q = tb + bh * yb; A = b4 * ta + b5 * q; B = b6 * ta + b7 * q; }
            ta = 2 * A - ta; tb = 2 * B - tb;
            const q0 = ya + u0, q1 = yb + u1; u0 = ya; u1 = yb;
            const n0 = A0 * x0 + A1 * x1 + A2 * x2 + B0 * q0 + B1 * q1, n1 = A3 * x0 + A4 * x1 + A5 * x2 + B2 * q0 + B3 * q1;
            x2 = A6 * x0 + A7 * x1 + A8 * x2 + B4 * q0 + B5 * q1; x0 = n0; x1 = n1;
            vo = C0 * x0 + C1 * x1 + C2 * x2 + D0 * ya + D1 * yb;
            mb[i] += vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          if (tN === 0 && Math.abs(cx) < 1e-12) cx = 0;
          const act = Math.max(pk, Math.abs(sa) + Math.abs(sb), Math.abs(ta) + Math.abs(tb), Math.abs(x0) + Math.abs(x1), Math.abs(cx) * 30, tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.cx = cx; this.sa = sa; this.sb = sb; this.ta = ta; this.tb = tb; x[0] = x0; x[1] = x1; x[2] = x2; up[0] = u0; up[1] = u1;
        this.tN = tN; this.vo = vo;
      }
    }

    /* SNARE (R6 §5, §15): the gated trigger / 11 through C34 (two edge spikes into 15 k) at IC10A's + input; one bridged-T
     * (C32 / C33, R112, R107 + R115) whose R115 Q17 shorts while C31 holds its base up (Q16 charges C31 from the gate
     * through R104's current limit, R105 / R114 drain it into the base): the pitch kick; the noise through C51 into the swing
     * VCA Q30 (R147 from +15) on the ladder R100 → D26 → C35 → R120 → C37 → R121 → D27 (C38 / C39); Q32's Sallen-Key
     * high-pass → C57 → R111, the tone → R110: both into VR4's top, the wiper into R102. */
    function sdNet6(c, x, u, dx) {                          // x = (C57), u = (IC10A, Q32's emitter)
      const P = SD6, g10 = 1 / P.R110, g11 = 1 / P.R111, vt = (u[0] * g10 + (u[1] - x[0]) * g11) / (g10 + g11 + c.pt[0]);
      dx[0] = (u[1] - x[0] - vt) * g11 / P.C57;
      return vt * c.pt[1] * R189;
    }
    class Sd6 extends Voice {
      constructor(M) {
        super(M, V_N6);
        this.cr = new Float64Array(9); this.chp = new Float64Array(5); this.net = new Lin(1, 2); this.pt = new Float64Array(2);
        this.ex = 0; this.exA = 0; this.T17 = jTab(par(SD6.R105, SD6.R114)); this.r1 = 0; this.s2 = 1; this.hb = 0; this.G = -1;
        this.kd = 1; this.d30 = 0;
        this.zero();
      }
      zero() {
        this.cx = 0; this.sa = 0; this.sb = 0; this.v31 = 0; this.v35 = 0; this.v37 = 0; this.xn = 0; this.p = 0;
        this.h1 = 0; this.h2 = 0; this.net.reset(); this.vo = 0; this.tN = 0; this.pre = 1; this.g17 = 0; this.kick();
      }
      os() {
        const P = SD6, M = this.M, h = M.h, rq = par(P.R113, P.R118), rs = par(P.R98, P.R99), tau = P.C34 * (rq + rs);
        this.ex = Math.exp(-h / tau); this.exA = rq / (rq + rs) * tau / h * (1 - this.ex);
        skHP(this.chp, 0, P.C52, P.C58, P.R153, par(P.R155, P.R152), 1, kBil(2670, M.fs));
        this.d30 = h * (B15 - VBE) / P.R147 / P.C51;        // the base's bias recharge per sample (the tracker's leak)
        this.kn();
      }
      kn() {
        const P = SD6, M = this.M, kv = M.kv, d = fUp(kv[K6.sdd]);
        this.r1 = P.R112 * d; this.s2 = fDn(kv[K6.sdu]) / d; this.kd = d;
        const r2 = P.R107 + P.R115;
        this.hb = 2 / kBil(1 / (TAU * P.C32 * Math.sqrt(this.r1 * r2 * this.s2)), M.fs);
        this.G = -1; this.kick();
        pot6(clamp01(kv[K6.sdl]), P.VR4, P.R102, this.pt);
        this.net.design(sdNet6, this, 2 / kBil(1000, M.fs));
      }
      // the shunt leg with Q17 (its base current from C31: a conductance β·Ib / V_CE,sat across R115, the 808 BD's Q43)
      kick() {
        if (!(this.r1 > 0)) return;
        const P = SD6, G = 1 / ((P.R107 + 1 / (1 / P.R115 + this.g17)) * this.s2), dg = G - this.G;
        if (dg > 1e-7 * G || dg < -1e-7 * G) { btDesign(this.cr, P.C32, this.r1, G, this.hb); this.G = G; }
      }
      fire(V) { this.tV = V; this.tN = this.M.nP; if (!this.on) this.pre = 1; this.on = true; this.qn = 0; }
      run(mb, o, n) {
        const P = SD6, M = this.M, CH = M.CH, h = M.h, wn = M.wn, e = o + n, cr = this.cr, chp = this.chp, L = this.net, x = L.x, up = L.up;
        const VH = OA_HI - BIAS4, VL = -BIAS4, ex = this.ex, exA = this.exA, tV = this.tV, k11 = P.R99 / (P.R98 + P.R99);
        const kd = this.kd, r120 = P.R120 * kd, r121 = P.R121 * kd, ion = BETA * KPK * (B15 - VBE) / P.R147, iVT = 1 / VT, d30 = this.d30;
        const kx = 1 - Math.exp(-h / (r121 * (P.C38 + P.C39))), g120 = 1 / r120, g121 = 1 / r121, g100 = 1 / P.R100, h35 = h / P.C35, h37 = h / P.C37;
        const H0 = chp[0], H1 = chp[1], H2 = chp[2], H3 = chp[3], H4 = chp[4], La = L.Ad[0], Lb0 = L.Bd[0], Lb1 = L.Bd[1], Lc = L.C[0], Ld0 = L.D[0], Ld1 = L.D[1];
        const T17 = this.T17, kth = P.R114 / (P.R105 + P.R114), rth = par(P.R105, P.R114), g105 = 1 / P.R105, h31 = h / P.C31;
        if (this.pre) { this.pre = 0; this.p = M.wnPeak; }
        let cx = this.cx, sa = this.sa, sb = this.sb, v31 = this.v31, v35 = this.v35, v37 = this.v37, xn = this.xn, p = this.p;
        let h1 = this.h1, h2 = this.h2, x0 = x[0], u0 = up[0], u1 = up[1], tN = this.tN, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          // per chunk: Q17 from C31 (τ ≈ 13 ms), the VCA's supply (C37 behind R121 and D27)
          const ib = jIb(T17, v31 * kth), i105 = (v31 - (v31 * kth - ib * rth)) * g105;
          this.g17 = BETA * ib / VSAT; this.kick();
          const r0 = cr[0], r1 = cr[1], r2 = cr[2], r3 = cr[3], r4 = cr[4], r5 = cr[5], r6 = cr[6], r7 = cr[7], rh = cr[8];
          const vs = Math.max(v37 - VD, 0), sw = vs - vle(vs), lnK = sw > 1e-9 ? Math.log(r121 * ion / sw) : 0;
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let u = 0, vg = 0;
            if (tN > 0 || cx !== 0) {
              if (tN > 0) { vg = tV; tN--; }
              const vd = vg * k11;
              u = (vd - cx) * exA; cx = vd - (vd - cx) * ex;
            }
            if (vg > 0) {                                  // the gate: Q16 charges C31 (R104 limits), C35 through R100 / D26
              const ib16 = Math.max(vg - VBE - v31, 0) / P.R106, ic16 = Math.min(BETA * ib16, Math.max(B15 - VSAT - v31, 0) / P.R104);
              v31 += (ib16 + ic16 - i105) * h31;
              v35 += Math.max(vg - VD - v35, 0) * g100 * h35;
            }
            let q = sb + rh * u, A = r0 * sa + r1 * q, B = r2 * sa + r3 * q, yt = u - A - B;
            if (yt > VH || yt < VL) { yt = yt > VH ? VH : VL; q = sb + rh * yt; A = r4 * sa + r5 * q; B = r6 * sa + r7 * q; }
            sa = 2 * A - sa; sb = 2 * B - sb;
            // the noise VCA (Q30): base = clamp level + noise − tracked peak; the node pulled down at once, recharged via R121
            const v = wn[i];
            p = Math.max(p - d30, v);
            const tgt = vs - sw * gT((v - p) * iVT + lnK);
            xn = Math.min(tgt, xn + (tgt - xn) * kx);
            const i37 = (v35 - v37) * g120;
            v35 -= i37 * h35;
            v37 += (i37 - Math.max(vs - xn, 0) * g121) * h37;
            const yh = H0 * xn + h1; h1 = H1 * xn - H3 * yh + h2; h2 = H2 * xn - H4 * yh;
            // VR4's top (R110 / C57 + R111) → R102
            const q0 = yt + u0, q1 = yh + u1; u0 = yt; u1 = yh;
            x0 = La * x0 + Lb0 * q0 + Lb1 * q1;
            vo = Lc * x0 + Ld0 * yt + Ld1 * yh;
            mb[i] += vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          if (tN === 0) { v31 = Math.max(v31 - i105 * CH * h31, 0); if (Math.abs(cx) < 1e-12) cx = 0; }
          const act = Math.max(pk, Math.abs(sa) + Math.abs(sb), swing(Math.max(v35, v37) - VD), Math.abs(cx) * 30, tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.cx = cx; this.sa = sa; this.sb = sb; this.v31 = v31; this.v35 = v35; this.v37 = v37; this.xn = xn; this.p = p;
        this.h1 = h1; this.h2 = h2; x[0] = x0; up[0] = u0; up[1] = u1; this.tN = tN; this.vo = vo;
      }
    }

    /* TOMS (R6 §6, §15; the sub board): one circuit for the pair. Each tom: the gated trigger / 11 through C301 / C307
     * (spikes) into a bridged-T (IC9A 132 Hz / IC9B 206 Hz) whose R318 / R333 a transistor shorts; both transistors take
     * their base from C303, which Q306 dumps C302 into at either tom's gate (≈ 15 V whatever the accent) and R317 / R331
     * drain — so a hit on one bends the other while it rings. The rumble: the same envelope through R337 onto C313, then
     * R338 + R339 into Q310's base, which takes the noise through C312 (Q309's 273 Hz low-pass, R346 / R347): a common-
     * emitter stage (R350 from C318 / R351) → C316 / R340 → R348 / C317 → R349 into the tom bus — the envelope's two
     * capacitors decay together through the kick transistors' and Q310's bases (≈ 0.12–0.14 s, R6 §6) [R? the envelope's
     * source read as C303: R6 §15]; R326 / R327 from the toms; VR5 → R108. */
    function tmRum6(c, x, u, dx) {                         // x = (C316, C317), u = (Q310's collector − its rest)
      const P = TM6, vx = u[0] - x[0], i48 = (vx - x[1]) / P.R348;
      dx[0] = (vx / P.R340 + i48) / P.C316; dx[1] = (i48 - x[1] / P.R349) / P.C317;
      return x[1];
    }
    class Toms6 extends Voice {
      constructor(M) {
        super(M, V_N6);
        this.cl = new Float64Array(9); this.ch = new Float64Array(9); this.rum = new Lin(2, 1); this.pt = new Float64Array(2);
        this.exL = 0; this.exAL = 0; this.exH = 0; this.exAH = 0; this.kD = 0; this.e13 = 0; this.hpn = new Float64Array(3);
        this.T7 = jTab(par(TM6.R317, TM6.R319)); this.T8 = jTab(par(TM6.R331, TM6.R332)); this.T10 = jTab(TM6.R338 + TM6.R339);
        this.r1L = 0; this.r1H = 0; this.sL = 1; this.sH = 1; this.hL = 0; this.hH = 0; this.GL = -1; this.GH = -1;
        this.kL = 0; this.kH = 0; this.kR = 0; this.actL = 0; this.actH = 0;
        this.zero();
      }
      zero() {
        this.cxL = 0; this.cxH = 0; this.saL = 0; this.sbL = 0; this.saH = 0; this.sbH = 0; this.v303 = 0; this.v313 = 0;
        this.v318 = B15; this.hn = 0; this.rum.reset(); this.vo = 0; this.tN = 0; this.tNH = 0; this.vgL = 0; this.vgH = 0;
        this.g7 = 0; this.g8 = 0; this.kick();
      }
      os() {
        const P = TM6, M = this.M, h = M.h, rq = par(P.R320, P.R329);
        let rs = par(P.R312, P.R311), tau = P.C301 * (rq + rs); this.exL = Math.exp(-h / tau); this.exAL = rq / (rq + rs) * tau / h * (1 - this.exL);
        rs = par(P.R309, P.R310); tau = P.C307 * (rq + rs); this.exH = Math.exp(-h / tau); this.exAH = rq / (rq + rs) * tau / h * (1 - this.exH);
        // Q306 saturated: C302 (47 µ, a reservoir) into C303 through R321 per sample of a gate; R337 between C303 and C313
        // (their difference relaxes by e13 a chunk)
        this.kD = 1 - Math.exp(-h / (P.R321 * P.C303)); this.e13 = Math.exp(-M.CH * h / (P.R337 * par(P.C303, P.C313)));
        this.rum.design(tmRum6, null, 2 / kBil(1600, M.fs));
        this.kn();
      }
      kn() {
        const P = TM6, M = this.M, kv = M.kv, fs = M.fs, dL = fUp(kv[K6.ltd]), dH = fUp(kv[K6.htd]);
        this.r1L = P.R1L * dL; this.sL = fDn(kv[K6.ltu]) / dL; this.r1H = P.R1H * dH; this.sH = fDn(kv[K6.htu]) / dH;
        this.hL = 2 / kBil(1 / (TAU * P.C304 * Math.sqrt(this.r1L * (P.R323 + P.R318) * this.sL)), fs);
        this.hH = 2 / kBil(1 / (TAU * P.C310 * Math.sqrt(this.r1H * (P.R334 + P.R333) * this.sH)), fs);
        this.GL = this.GH = -1; this.kick();
        // the tom bus: R326 / R327 / R349 into VR5's top → R108
        pot6(clamp01(kv[K6.tml]), P.VR5, P.R108, this.pt);
        const gt = 1 / P.R326 + 1 / P.R327 + 1 / P.R349 + this.pt[0], kb = this.pt[1] * R189 / gt;
        this.kL = kb / P.R326; this.kH = kb / P.R327; this.kR = kb / P.R349;
      }
      kick() {
        if (!(this.r1L > 0)) return;
        const P = TM6;
        let G = 1 / ((P.R323 + 1 / (1 / P.R318 + this.g7)) * this.sL), dg = G - this.GL;
        if (dg > 1e-7 * G || dg < -1e-7 * G) { btDesign(this.cl, P.C304, this.r1L, G, this.hL); this.GL = G; }
        G = 1 / ((P.R334 + 1 / (1 / P.R333 + this.g8)) * this.sH); dg = G - this.GH;
        if (dg > 1e-7 * G || dg < -1e-7 * G) { btDesign(this.ch, P.C310, this.r1H, G, this.hH); this.GH = G; }
      }
      fire(V, hi) {
        if (hi) { this.vgH = V; this.tNH = this.M.nP; } else { this.vgL = V; this.tN = this.M.nP; }
        this.on = true; this.qn = 0;
      }
      run(mb, o, n) {
        const P = TM6, M = this.M, CH = M.CH, h = M.h, pn = M.pn, e = o + n, cl = this.cl, chh = this.ch, R = this.rum;
        const VH = OA_HI - BIAS9, VL = -BIAS9, exL = this.exL, exAL = this.exAL, exH = this.exH, exAH = this.exAH, k11L = P.R311 / (P.R312 + P.R311);
        const k11H = P.R310 / (P.R309 + P.R310), kD = this.kD, VDMP = B15 - VSAT, kL = this.kL, kH = this.kH, kR = this.kR;
        const RA0 = R.Ad[0], RA1 = R.Ad[1], RA2 = R.Ad[2], RA3 = R.Ad[3], RB0 = R.Bd[0], RB1 = R.Bd[1], RC0 = R.C[0], RC1 = R.C[1], RD0 = R.D[0];
        const hp = this.hpn, kdv = P.R347 / (P.R346 + P.R347), rs = par(P.R346, P.R347), i33 = 1 / (P.C303 + P.C313), e13 = this.e13;
        const k7 = P.R319 / (P.R317 + P.R319), r7 = par(P.R317, P.R319), k8 = P.R332 / (P.R331 + P.R332), r8 = par(P.R331, P.R332);
        const T7 = this.T7, T8 = this.T8, T10 = this.T10, T = CH * h;
        let cxL = this.cxL, cxH = this.cxH, saL = this.saL, sbL = this.sbL, saH = this.saH, sbH = this.sbH, v303 = this.v303;
        let v313 = this.v313, v318 = this.v318, hn = this.hn, x0 = R.x[0], x1 = R.x[1], ru = R.up[0], tN = this.tN, tNH = this.tNH, vo = this.vo;
        const vgL = this.vgL, vgH = this.vgH;
        for (let c = o; c < e; c += CH) {
          // per chunk: C303 → Q307 / Q308 (the kicks), C313 → Q310, C318
          const ib7 = jIb(T7, v303 * k7), ib8 = jIb(T8, v303 * k8), ib10 = jIb(T10, v313);
          if (tN === 0 && tNH === 0) {
            v303 = Math.max(v303 - ((v303 - v303 * k7 + ib7 * r7) / P.R317 + (v303 - v303 * k8 + ib8 * r8) / P.R331) * T / P.C303, 0);
            v313 = Math.max(v313 - ib10 * T / P.C313, 0);
            const va = (P.C303 * v303 + P.C313 * v313) * i33, dd = (v303 - v313) * e13;   // R337: the two equalise
            v303 = va + dd * P.C313 * i33; v313 = va - dd * P.C303 * i33;
          }
          this.g7 = BETA * ib7 / VSAT; this.g8 = BETA * ib8 / VSAT; this.kick();
          const l0 = cl[0], l1 = cl[1], l2 = cl[2], l3 = cl[3], l4 = cl[4], l5 = cl[5], l6 = cl[6], l7 = cl[7], lh = cl[8];
          const m0 = chh[0], m1 = chh[1], m2 = chh[2], m3 = chh[3], m4 = chh[4], m5 = chh[5], m6 = chh[6], m7 = chh[7], mh = chh[8];
          // Q310: its envelope current, the noise current through C312 into the base (the source R346 ∥ R347 and r_π: the
          // coupling's corner moves with the current, plain K = 2·fs below 1 kHz)
          const imax = Math.max(v318 - VSAT, 0) / P.R350, ic0 = BETA * ib10, rin = rs + BETA * VT / Math.max(ic0, 1e-12), gn = BETA / rin;
          bil1(hp, 0, 1, 0, 1, 1 / (P.C312 * rin), 2 * M.fs);
          const p0 = hp[0], p1 = hp[1], p2 = hp[2];
          let pk = 0, pL = 0, pH = 0, icm = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let uL = 0, uH = 0, vdo = 0;
            if (tN > 0 || cxL !== 0) {
              let vd = 0;
              if (tN > 0) { vd = vgL * k11L; vdo = vgL; tN--; }
              uL = (vd - cxL) * exAL; cxL = vd - (vd - cxL) * exL;
            }
            if (tNH > 0 || cxH !== 0) {
              let vd = 0;
              if (tNH > 0) { vd = vgH * k11H; if (vgH > vdo) vdo = vgH; tNH--; }
              uH = (vd - cxH) * exAH; cxH = vd - (vd - cxH) * exH;
            }
            if (vdo > 0) v303 += (VDMP - v303) * kD;        // a gate: Q306 dumps C302 into C303
            let q = sbL + lh * uL, A = l0 * saL + l1 * q, B = l2 * saL + l3 * q, yL = uL - A - B;
            if (yL > VH || yL < VL) { yL = yL > VH ? VH : VL; q = sbL + lh * yL; A = l4 * saL + l5 * q; B = l6 * saL + l7 * q; }
            saL = 2 * A - saL; sbL = 2 * B - sbL;
            q = sbH + mh * uH; A = m0 * saH + m1 * q; B = m2 * saH + m3 * q;
            let yH = uH - A - B;
            if (yH > VH || yH < VL) { yH = yH > VH ? VH : VL; q = sbH + mh * yH; A = m4 * saH + m5 * q; B = m6 * saH + m7 * q; }
            saH = 2 * A - saH; sbH = 2 * B - sbH;
            // the rumble: the noise current through C312 on Q310's envelope current, its collector into the band-pass
            const vn = kdv * pn[i], yn = p0 * vn + hn; hn = p1 * vn - p2 * yn;
            let ic = ic0 + gn * yn; ic = ic > 0 ? (ic < imax ? ic : imax) : 0;
            icm += ic;
            const vc = v318 - B15 - P.R350 * ic, qr = vc + ru; ru = vc;
            const n0 = RA0 * x0 + RA1 * x1 + RB0 * qr; x1 = RA2 * x0 + RA3 * x1 + RB1 * qr; x0 = n0;
            const yr = RC0 * x0 + RC1 * x1 + RD0 * vc;
            vo = kL * yL + kH * yH + kR * yr;
            mb[i] += vo;
            const aL = Math.abs(yL), aH = Math.abs(yH);
            if (aL > pL) pL = aL; if (aH > pH) pH = aH;
            pk = Math.max(pk, Math.abs(vo));
          }
          if (tN > 0 || tNH > 0) { const va = (P.C303 * v303 + P.C313 * v313) * i33, dd = (v303 - v313) * e13; v303 = va + dd * P.C313 * i33; v313 = va - dd * P.C303 * i33; }
          v318 += ((B15 - v318) / P.R351 - icm / CH) * T / P.C318;
          if (tN === 0 && Math.abs(cxL) < 1e-12) cxL = 0;
          if (tNH === 0 && Math.abs(cxH) < 1e-12) cxH = 0;
          pL *= kL; pH *= kH;
          if (pL > this.actL) this.actL = pL; if (pH > this.actH) this.actH = pH;
          // the rumble's share of the bus: its noise (≈ 0.2 V peaks at the base) and C318's recovery, whose slope reaches the
          // bus through C316 · R340
          const act = Math.max(pk, Math.abs(saL) + Math.abs(sbL), Math.abs(saH) + Math.abs(sbH), kR * (Math.abs(x1) + P.R350 * gn * 0.2),
            kR * (B15 - v318) * P.C316 * P.R340 / (P.R351 * P.C318), Math.abs(cxL) * 30, Math.abs(cxH) * 30, tN > 0 || tNH > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.cxL = cxL; this.cxH = cxH; this.saL = saL; this.sbL = sbL; this.saH = saH; this.sbH = sbH; this.v303 = v303;
        this.v313 = v313; this.v318 = v318; this.hn = hn; R.x[0] = x0; R.x[1] = x1; R.up[0] = ru; this.tN = tN; this.tNH = tNH; this.vo = vo;
      }
    }

    /* CYMBAL (R6 §8, §15): the gate through R141 charges E1 (C49, R163 + R164) by D28 and C47 (R165 / C48) by D29. Low
     * band: Q35 follows E1, R185 → C61 (the ≈ 73 ms rise) → R186 → D35 → Q39 on the 3454 Hz band → Q40's Sallen-Key high-
     * pass → C79 / R198 / C78 → R200; high band: C47 via R166 and half of E1 (R183 / R184) via R181 → D34 → Q38 on the
     * 7117 Hz band → C62 + C63 / C73 into IC12B (gain 2) → R204; both into VR6's top, the wiper into R109. */
    function cyHi6(c, x, u, dx) {                          // x = (C62 + C63 in series, C73), u = (D34's anode)
      const P = CY6, va = u[0] - x[0], vp = va - x[1], i73 = vp / par(P.R207, P.R208), is = i73 + (va - 2 * vp) / P.R203;
      dx[0] = is / (P.C62 * P.C63 / (P.C62 + P.C63)); dx[1] = i73 / P.C73;
      return 2 * vp;
    }
    function cyNet6(c, x, u, dx) {                         // x = (C79, C78), u = (Q40's emitter, IC12B)
      const P = CY6, g0 = 1 / P.R200, g4 = 1 / P.R204, vt = (x[1] * g0 + u[1] * g4) / (g0 + g4 + c.pt[0]), i98 = (u[0] - x[0] - x[1]) / P.R198;
      dx[0] = i98 / P.C79; dx[1] = (i98 - (x[1] - vt) * g0) / P.C78;
      return vt * c.pt[1] * R189;
    }
    class Cy6 extends Voice {
      constructor(M) {
        super(M, V_N6);
        this.slo = new Float64Array(5); this.hi = new Lin(2, 1); this.net = new Lin(2, 2); this.pt = new Float64Array(2); this.r49 = 0; this.r165 = 0;
        this.zero();
      }
      zero() {
        this.v49 = 0; this.v61 = 0; this.v47 = 0; this.v48 = 0; this.xl = 0; this.xh = 0; this.s1 = 0; this.s2 = 0;
        this.hi.reset(); this.net.reset(); this.vo = 0; this.tN = 0;
      }
      os() {
        const P = CY6, fs = this.M.fs;
        skHP(this.slo, 0, P.C59, P.C60, P.R159, par(P.R195, P.R196), 1, kBil(2180, fs));
        this.hi.design(cyHi6, null, 2 / kBil(8500, fs));
        this.kn();
      }
      kn() {
        const P = CY6, kv = this.M.kv, d = fUp(kv[K6.cyd]);
        this.r49 = (P.R163 + P.R164) * d; this.r165 = P.R165 * d;   // DECAY: E1's bleed and the high band's tail
        pot6(clamp01(kv[K6.cyl]), P.VR6, P.R109, this.pt);
        this.net.design(cyNet6, this, 2 / kBil(1000, this.M.fs));
      }
      fire(V) { this.tV = V; this.tN = this.M.nP; this.on = true; this.qn = 0; }
      run(mb, o, n) {
        const P = CY6, M = this.M, CH = M.CH, h = M.h, T = CH * h, lo = M.lo, hi = M.hi, e = o + n, iVT = 1 / VT, tV = this.tV;
        const ionL = BETA * KPK * (B15 - VBE) / P.R202, ionH = BETA * KPK * (B15 - VBE) / P.R180, kxl = 1 - Math.exp(-h / (P.R186 * P.C77));
        const RM = par(P.R183, P.R184), kM = P.R184 / (P.R183 + P.R184), RK = par(P.R166, P.R181 + RM), kG = P.R141 / h;
        const kxh = 1 - Math.exp(-h / (RK * P.C64)), r49 = this.r49, r165 = this.r165, VF = CY.VF;
        const S = this.slo, S0 = S[0], S1 = S[1], S2 = S[2], S3 = S[3], S4 = S[4], Hl = this.hi, Nt = this.net;
        const HA0 = Hl.Ad[0], HA1 = Hl.Ad[1], HA2 = Hl.Ad[2], HA3 = Hl.Ad[3], HB0 = Hl.Bd[0], HB1 = Hl.Bd[1], HC0 = Hl.C[0], HC1 = Hl.C[1], HD0 = Hl.D[0];
        const NA0 = Nt.Ad[0], NA1 = Nt.Ad[1], NA2 = Nt.Ad[2], NA3 = Nt.Ad[3], NB0 = Nt.Bd[0], NB1 = Nt.Bd[1], NB2 = Nt.Bd[2], NB3 = Nt.Bd[3];
        const NC0 = Nt.C[0], NC1 = Nt.C[1], ND0 = Nt.D[0], ND1 = Nt.D[1], LO = -7.5, HI = OA_HI - 7.5;
        let v49 = this.v49, v61 = this.v61, v47 = this.v47, v48 = this.v48, xl = this.xl, xh = this.xh, s1 = this.s1, s2 = this.s2;
        let h0 = Hl.x[0], h1 = Hl.x[1], hu = Hl.up[0], n0 = Nt.x[0], n1 = Nt.x[1], nu0 = Nt.up[0], nu1 = Nt.up[1], tN = this.tN, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          // per chunk: Q35's emitter, the two VCAs' supplies (the low: C61 behind R186; the high: the Thevenin of C47 via
          // R166 and E1's half via R181)
          const E = Math.max(v49 - VF, 0), vk = (v47 / P.R166 + E * kM / (P.R181 + RM)) * RK;
          const vsL = Math.max(v61 - VD, 0), swL = swing(vsL), lkL = swL > 1e-9 ? Math.log(P.R186 * ionL / swL) : 0;
          const vsH = Math.max(vk - VD, 0), swH = swing(vsH), lkH = swH > 1e-9 ? Math.log(RK * ionH / swH) : 0;
          let pk = 0, aL = 0, aH = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            if (tN > 0) {                                  // the gate: R141 into C49 (D28) and C47 (D29), backward Euler
              tN--;
              const top = tV - VD;
              let on9 = v49 < top, on7 = v47 < top, vn = top;
              for (let it = 0; it < 2; it++) {
                const sc = (on9 ? P.C49 : 0) + (on7 ? P.C47 : 0);
                if (sc === 0) break;
                vn = (top + kG * ((on9 ? P.C49 * v49 : 0) + (on7 ? P.C47 * v47 : 0))) / (1 + kG * sc);
                if (on9 && v49 >= vn) on9 = false; else if (on7 && v47 >= vn) on7 = false; else break;
              }
              if (on9) v49 = vn; if (on7) v47 = vn;
            }
            const tl = vsL - swL * gT(lo[i] * iVT + lkL); xl = Math.min(tl, xl + (tl - xl) * kxl);
            const th = vsH - swH * gT(hi[i] * iVT + lkH); xh = Math.min(th, xh + (th - xh) * kxh);
            aL += xl; aH += xh;
            // the low band: Q40's high-pass; the high band: C62 + C63 / C73 into IC12B
            const yl = S0 * xl + s1; s1 = S1 * xl - S3 * yl + s2; s2 = S2 * xl - S4 * yl;
            const qh = xh + hu; hu = xh;
            const m0 = HA0 * h0 + HA1 * h1 + HB0 * qh; h1 = HA2 * h0 + HA3 * h1 + HB1 * qh; h0 = m0;
            let yh = HC0 * h0 + HC1 * h1 + HD0 * xh;
            if (yh > HI - 1 || yh < 1 + LO) yh = rail6(yh, 7.5, HI);
            const q0 = yl + nu0, q1 = yh + nu1; nu0 = yl; nu1 = yh;
            const m1 = NA0 * n0 + NA1 * n1 + NB0 * q0 + NB1 * q1; n1 = NA2 * n0 + NA3 * n1 + NB2 * q0 + NB3 * q1; n0 = m1;
            vo = NC0 * n0 + NC1 * n1 + ND0 * yl + ND1 * yh;
            mb[i] += vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          // the envelopes per chunk on the chunk's mean VCA currents (every τ ≥ 15 ms)
          const kb = aH / CH + VD, lb = aL / CH + VD, mN = E * kM + (kb - E * kM) * RM / (RM + P.R181);
          const i66 = (v47 - kb) / P.R166, i65 = (v47 - v48) / r165, iE = (E - mN) / P.R183 + (E - v61) / P.R185;
          v47 = Math.max(v47 - (i66 + i65) * T / P.C47, 0); v48 += i65 * T / P.C48;
          v61 += ((E - v61) / P.R185 - Math.max(v61 - lb, 0) / P.R186) * T / P.C61;
          v49 = Math.max(v49 - (v49 / r49 + (v49 > VF ? iE / (BETA + 1) : 0)) * T / P.C49, 0);
          const act = Math.max(pk, swL, swH, swing(Math.max(v61, v47, v48, E * kM * RK / (P.R181 + RM)) - VD), tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.v49 = v49; this.v61 = v61; this.v47 = v47; this.v48 = v48; this.xl = xl; this.xh = xh; this.s1 = s1; this.s2 = s2;
        Hl.x[0] = h0; Hl.x[1] = h1; Hl.up[0] = hu; Nt.x[0] = n0; Nt.x[1] = n1; Nt.up[0] = nu0; Nt.up[1] = nu1; this.tN = tN; this.vo = vo;
      }
    }

    /* HATS (R6 §9, §15): one circuit for the pair. OH: R140 charges C45 (bled by R167), Q36 follows it → R170 → D33; CH:
     * R133 charges C42 → R134 → D32; both diodes into the collector of Q37 (C43) on the 7117 Hz band: one swing VCA whose
     * pull-up is the higher supply. The pick-offs at the anodes (C67 / C44) → R172 → IC12A's Sallen-Key high-pass (gain 2)
     * → VR7 → R149. The choke: C42 holds Q25 on through R135; the tempo cut: the clock's pulses charge C41 through D1 / R6,
     * Q23 empties it at each OH gate, R131 → Q24; Q24 / Q25 drain C45 through R137. C41 matters only while the OH sounds:
     * the clock is read per absolute chunk from the OH's hit on (the hats asleep, it costs nothing). */
    function hhNet6(c, x, u, dx) {                         // x = (C67 ∥ C44, C69, C70), u = (the pick-offs' mean)
      const P = HH6, vs = u[0] - x[0], va = vs - x[1], vp = va - x[2], i70 = vp / par(P.R175, P.R176), i69 = i70 + (va - 2 * vp) / P.R174;
      dx[0] = (vs / P.R172 + i69) / (P.C67 + P.C44); dx[1] = i69 / P.C69; dx[2] = i70 / P.C70;
      return 2 * vp;
    }
    class Hats6 extends Voice {
      constructor(M) {
        super(M, V_N6);
        this.net = new Lin(3, 1); this.pt = new Float64Array(2); this.T24 = jTab(HH6.R131); this.T25 = jTab(HH6.R135);
        this.r167 = 0; this.r134 = 0; this.kck = 0; this.ky = 0; this.actO = 0; this.actC = 0;
        this.zero();
      }
      zero() {
        this.v45 = 0; this.v41 = 0; this.v42 = 0; this.xc = 0; this.net.reset(); this.vo = 0; this.tN = 0; this.tNC = 0;
        this.vgO = 0; this.vgC = 0; this.ohl = false; this.mute = false;
      }
      os() { this.net.design(hhNet6, null, 2 / kBil(8500, this.M.fs)); this.kn(); }
      kn() {
        const P = HH6, kv = this.M.kv, d = fUp(kv[K6.ohd]);
        this.r167 = P.R167 * d; this.r134 = P.R134 * fUp(kv[K6.chd]);   // DECAY: R167 and the cut's R6 together (P-2); R134
        this.kck = 1 - Math.exp(-TCK / (P.R6 * d * P.C41));
        pot6(clamp01(kv[K6.hhl]), P.VR7, P.R149, this.pt); this.ky = this.pt[1] * R189;
      }
      fire(V, closed, mute) {
        if (closed) { this.vgC = V; this.tNC = this.M.nP; this.mute = !!mute; } else { this.vgO = V; this.tN = this.M.nP; this.ohl = true; }
        this.on = true; this.qn = 0;
      }
      run(mb, o, n) {
        const P = HH6, M = this.M, CH = M.CH, h = M.h, T = CH * h, hi = M.hi, e = o + n, iVT = 1 / VT, VF = CY.VF, OS = M.OS;
        const ion = BETA * KPK * (B15 - VBE) / P.R173, r167 = this.r167, r134 = this.r134, kck = this.kck, ky = this.ky;
        const k40 = 1 - Math.exp(-h / (P.R140 * P.C45)), k33 = 1 - Math.exp(-h / (P.R133 * P.C42)), g37 = 1 / P.R137;
        const L = this.net, A0 = L.Ad[0], A1 = L.Ad[1], A2 = L.Ad[2], A3 = L.Ad[3], A4 = L.Ad[4], A5 = L.Ad[5], A6 = L.Ad[6], A7 = L.Ad[7], A8 = L.Ad[8];
        const B0 = L.Bd[0], B1 = L.Bd[1], B2 = L.Bd[2], C0 = L.C[0], C1 = L.C[1], C2 = L.C[2], D0 = L.D[0], T24 = this.T24, T25 = this.T25;
        const vgO = this.vgO, vgC = this.vgC, mute = this.mute, HI = OA_HI - 7.5;
        let v45 = this.v45, v41 = this.v41, v42 = this.v42, xc = this.xc, x0 = L.x[0], x1 = L.x[1], x2 = L.x[2], xu = L.up[0];
        let tN = this.tN, tNC = this.tNC, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          // the tempo clock at this chunk's own start: a pulse where floor(tick / 40) steps (24 a quarter note)
          let jp = -1;
          if (this.ohl) {
            const ck = M.clock((M.n0 + c) / OS), t0 = ck.t, tp = ck.tpf;
            if (tp > 0 && t0 === t0) {
              const k0 = Math.floor(t0 / 40);
              if (Math.floor((t0 + 4 * tp) / 40) > k0) { jp = Math.floor((40 * (k0 + 1) - t0) / tp * OS); if (jp > CH - 1) jp = CH - 1; }
            }
          }
          // the supplies per chunk (the open one: Q36 follows C45; the closed one: C42), the higher one pulls the node up
          const vo1 = Math.max(v45 - VF, 0), vs = Math.max(Math.max(vo1, v42) - VD, 0), rc = vo1 >= v42 ? P.R170 : r134;
          const sw = swing(vs), lnK = sw > 1e-9 ? Math.log(rc * ion / sw) : 0, kx = 1 - Math.exp(-h / (rc * P.C43));
          const tO = vo1 - VD, tC = v42 - VD;
          let pk = 0, aO = 0, aC = 0, ge = tN > 0 ? (tN < CH ? tN : CH) : 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            if (tN > 0) { tN--; v45 += Math.max(vgO - VD - v45, 0) * k40; v41 = 0; }   // R140 / D30; Q23 empties C41
            if (tNC > 0) { tNC--; v42 += Math.max(vgC - VD - v42, 0) * k33; }       // R133 / D31
            const t = vs - sw * gT(hi[i] * iVT + lnK);
            xc = Math.min(t, xc + (t - xc) * kx);
            const oa = xc < tO ? xc : tO, ca = xc < tC ? xc : tC;
            aO += tO - oa; aC += tC - ca;
            const u = 0.5 * (oa + (mute ? tC : ca)), q = u + xu; xu = u;
            const n0 = A0 * x0 + A1 * x1 + A2 * x2 + B0 * q, n1 = A3 * x0 + A4 * x1 + A5 * x2 + B1 * q;
            x2 = A6 * x0 + A7 * x1 + A8 * x2 + B2 * q; x0 = n0; x1 = n1;
            let y = C0 * x0 + C1 * x1 + C2 * x2 + D0 * u;
            if (y > HI - 1 || y < -6.5) y = rail6(y, 7.5, HI);
            vo = ky * y;
            mb[i] += vo;
            pk = Math.max(pk, Math.abs(vo));
          }
          // per chunk: Q24 (C41) and Q25 (C42) sink at the joined collectors; C45 drains through R137
          let ib4 = jIb(T24, v41), w4 = CH;
          if (jp >= ge) {                                   // the pulse (after the OH's gate): the leak up to it, the charge, the rest
            v41 = Math.max(v41 - ib4 * jp * h / P.C41, 0);
            v41 += (P.VCK - VD - v41) * kck;
            const ib2 = jIb(T24, v41);
            v41 = Math.max(v41 - ib2 * (CH - jp) * h / P.C41, 0);
            ib4 = (ib4 * jp + ib2 * (CH - jp)) / CH; w4 = 0;
          }
          if (w4) v41 = Math.max(v41 - ib4 * T / P.C41, 0);
          const ib5 = jIb(T25, v42), isk = BETA * (ib4 + ib5);
          let vz = v45 - isk / g37;
          if (vz < VSAT) vz = VSAT;
          const i37 = v45 > vz ? (v45 - vz) * g37 : 0, ib36 = (vo1 / P.R169 + aO / (CH * P.R170)) / (BETA + 1);
          v45 = Math.max(v45 - (v45 / r167 + i37 + (v45 > VF ? ib36 : 0)) * T / P.C45, 0);
          v42 = Math.max(v42 - (aC / (CH * r134) + ib5) * T / P.C42, 0);
          const pO = vo1 >= v42 ? pk : 0;
          if (pO > this.actO) this.actO = pO; if (pk - pO > this.actC) this.actC = pk - pO;
          // (the pick-off capacitors' charge is the anodes' DC: no sound once the VCA's supply cannot swing)
          const act = Math.max(pk, sw, tN > 0 || tNC > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.v45 = v45; this.v41 = v41; this.v42 = v42; this.xc = xc; L.x[0] = x0; L.x[1] = x1; L.x[2] = x2; L.up[0] = xu;
        this.tN = tN; this.tNC = tNC; this.vo = vo;
      }
    }

    /* ================================================================== the TR-909 (stage 7c lane V9, IMPL-7c §2) */
    // Our circuit-level model of the 909's analog voice board (BD, SD, LT / MT / HT, RS, HC: R9 §2–§7, the late revision of
    // R9 §14) and of its sampled-voice playback path (the hats, crash and ride: R9 §9), from the values R9 reads in the
    // published service notes and analyses (the tables as modelled: research-909-circuits.md §16). No recording of any machine
    // is used: the three images the playback path reads are our own (tools/rom909.mjs, the ROM909 block below). An analog
    // voice: triangle VCOs (integrator, comparator and the ± 1 switch as a state machine — the corner at its fractional time —,
    // reset and held while the 2 ms trigger is high), the diode shapers (DSH), transistor VCAs on RC envelopes whose starts the
    // voice's held accent level sets (V_acc − 1.2 V: the accent DACs, ACC9), the shared digital noise (the 31-stage register).
    // A ROM voice: the gated word clock from the trigger, the counter over its region, the 6-bit DAC's staircase laid on the OS
    // grid with each step at its fractional time (2-point polyBLEP, one sample late: engine.js renderDac's method), the coupling,
    // the VCA (the hats' RC through the log / exp converter; the cymbals' address staircase through the anti-log stage), the two
    // reconstruction Sallen-Keys, the output stage. Volts throughout; each voice adds its mono share (the MONO jack: L normalled
    // onto R, R9 §10) of its output into the bus.

    /* ROM909 — generated by tools/rom909.mjs, do not edit */
    // recipes v1: our own struck-plate models (IMPL-7c §2.4, §14 lane R9) · 6-bit words, one character each, code =
    // ROM909_A.indexOf(character), mid-scale 32 · 30 kHz nominal · hh 32 768 words (open 0–24 575, closed 24 576–32 767), cr and
    // rd 32 768 · FNV-1a hh 0x261674e6 cr 0x06f03031 rd 0x15cbf81f · cymbals pre-compensated by the model's staircase (Dr808.proto.tr909.ENV9)
    const ROM909_A = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    const ROM909 = {
      hh: 'XgwhZ_fXJYieSVLULFURTbuhSYcSSEEVRWYeiZJOTRSSfZVQIW_baPWTPbc_TLRckXGTcRIRcdPHbRQZacUXUb_V_MMYXUNVZVVNYWT_SXaPTiYUPTbPLLYeWPSacTUVVWZaWSRZUPVUVYYUSRQXYWWYWSTZgVPKMWXcYUUXRUabSM_RPYYWQQTVbZPThZRXXVSSLUdcVNORZQVdY_RSYOTa_abQOUTUSWYTX_IMdd_YTOW_VKRXWW_cROX_UQQWa_SRWTYcRSXX_SLXZQVVXVSVVY_UOVZUXYUUSVcaSLNR_bUQXUXXSZWVTTSZTVbUVQV_XWUQVZXPPZWWZVRQTXVVUWYcTPTUdVXaQRPT_UUYYUXYMP_WVWRUSV_ZYTYUSUURVbTPbYSYSTTWXWXQSVTWTYYU_XVSRSVSZdQVZWRRWYVSWTSQVZYXWVXYVOVYNSadQQU_YOVZSQbWQQVYPVeWOY_WYVRNVURbQXWUZZZOZUQVSZWPUVTTXaVVWUWWYNVZTXQSXYXTQYbWSOPXbZXYWPRaXSVTUXXPRUYeXPWYNPdaSORXXWWZ_aLMaYVQZWPSWWRWZWQYeUPQOXdXUSWVSaYUNRWPd_WTYbMWXbULS_aTSQZWSNWYWVUaURZbPOWXVWU_aPRTWWVaROWYTUaRUVZWQYUXXSL_fQSTUV_ZRTYYTUUWUYcUKVXUXSTQ_YRXUWWXU_YOPQ__VZWSXTYTQbVSVZVWPRXRUXWXYQTSZXYSWaQVXUVbQSaVIW_UXQZaUUVOYhTNQUXVUWXRSWXZXSSYWWXYXSTPWdRSRPYX_VTacOPSYcPTYXMcbITUdcRSWSPXUUVc_MWYYPTXXXMbXSSWeSUWSRZRRXaRTXPgUUaRVXSVRRWWVVbRUVRbWTTPWYYXXWXSM__UTUVXVTQVZWWMeUNhYVOUVPUQYbZUMXdQUVSbYWPSZVfZGScTTOTaQT__PYcNWUVaUVOPadTMZfRLWXXTSXVUZUSVZZTRQOWcYUSVXQWdWTSVVXZSQUaWYTVXPSTbYQSSVbVVQTZWXQSZXV_QPTUX_XVYTRVZTYUOTVaZQP_XQWXUYVaWKaVPaVPRadTTXQTYWTPZVQbaSWXOZUPZXSZ_QSVUVZVVTZVUWPWU_WTPUXTcSRT_YYgMOVTXTXTUdRPTRWZ_WUYZYRLYZQWZQSSXbTTQWYX__VLYZTWUWUO_USYOb_PWWSVSWYVZTP__VRTUScYQRWYYPOdZVTSVX_RUXSSSXXaUMXTVZRXXUTUaUSWZSOYZYU_WQSZXTYLNXbbJRgMWaUYRTVZXXRN_XVYYSSYWRTTUaWRRX_cOW_MdVLRSZXUYSWVZVO__NPcVWWWS_WTULbVW_QOSWZ_ScWSTYWQTQ_XUQU_WNTbWXWVTTXVT_UTWWRXZRXURUX_WPQWYSWcVWSTVVXYVWXUVSQXYRYUPTaSaXMcUUWYXNMfaTYOVRXVReXRVSMSeaUPXXVXSQVeSWXLUZWTVZXRUaWSWRYWRZWQZUTUSYSW_ZQNbbVRTWVaTOWYRVZTSZRSYVdWRPabMQWRX_SOcZPTSeUW_TQVYRVVWQcdNTQRcYUQWZSUSWTWZRWbUOUXWXYOZXPTU_SQZdRVWPYVZRSfUOUaUOWXXW_PN_XVRUbWTYQTcUUPPYddQVPU_LaXORUbZWZNSVQcVUPWcZYNSRSeWSUS_TPZWUcXUWSVRRXYXSQYVPXSbUMeaPVaUQVhRRUSYPWWVXSVYVUTYTZTSbSXXWTRXUPQaYPVbWRUPYbUWOUaW_VRVUNUcVVZQVRNgbMXZRVNXgQSXVUQU_YTZUNUYXVSUZURYaWRSPYhRLYaPXdUSSVQQZcUUWSRUVeaPVUULUXfYP_VVNQZWSXZVNW_PaaTSZYRNTXQ_aXVUNY_UZRaUKaWRUTUbYQVUUTaSWZRXRfXRSLV__UYSOSXYWVUZTYVUYSWUSRaZUPaaMVTXVSXSUeSPSX_RZUSYZXQSUWaXVPRWXYQVZVTXUVXUOPcaUTYTOVZeRNXWWPZbURVYST_XQSYWOYYTQPbYQSXbYWTWVUVXXWXTUNVZUQXdQZSRgSOV_SRcWRRXaRSaUQYUPV_WWWSVZXUZVWQOXWQUWVaURYZSVWTVUWWVbVSTOaXWPSaTcOQWUbWTQXVYXSTVUWaORZXcWPQQZcXNQWZWWTWXUcOUYSXQWYQUXPWXVbVPa_MUaVUXWVRSWWZRRYUVRbZUZNVcNO_U_aTLSYYVUZVVUYTSTRYUYbUTWTYVRRZYUVUTTaTTXTWYSMXdZQS_RPdUVaVPSWUYQTTUdZUULWbSXVWXUSZYSYZRUSRcVQSUZZXSVVTXVPSZXVRX_TWSRcYSZSSUSYWQVbZVSR_WRYRSXaVTSVYUXOVaXVXRVbSUVSUSTXYZVNRbXXWUZROVZXUUWSUTSYYZRbVKVX_RWWXXXYKRcYUWK_bQXT_UPWWVQU_UWWWSP__UTXRWbXNQ_X_UMUcbTTSLacMVXSTWYWXWUSYbVPXTNWcXKZXXbROMZb_QQXPcVVTNh_RPU_XVTYURdUOVRYUXURVZVVUTaRUXWQWYTVUXYXQWSWVTWRaXUQVjUMYTQWVZUPUWWXaSXXMZTTcSVZRSYTTYVURPZdRRYWYURTbVSTSYVYQVVYSQaSZRTeXMUaUXRXTYYOVQZXQ__QVZUURWWYWSbTOXVSYaSXWOYXUWPSZYWRYYZVRTTWSYVVTR_YSZUS_UWSUXV_SVXRUXVYYOWZOVYVYPUaQTTXZU_VWNVcVZRSVWOVXWVPWVVRaaQSdZPaXRQS__QTXVXPYbXRRVRWW_VMWSX_UUWWPTbVYYSWURZZSTSSYWQ_XUXTTWXYUSWTXUTP_UTdUTTbTV_UVRSYWVWQZZRTUUSUX_XTXYYNQWWfOTSObVUWUXXSaYUVQaTVZOXVSQYZVUQYXRVbMR_YaOZXRWURVaTaVRWVTRYaTQYTTd_OQRUZVXYWWXMPdTUUXURW_SRZaaNZYPPRYcRSbQWVVXWWTVUTTXVVQVZTT__LV_UTVYZRRXZdNQXUYOUXRcYQZXRPVaUSTXZSYURZUYXTSYVVXSSQYWXWUWPXbUMXZVYOVaTWXOSabTQVXOTbX_USVTRTZYQ_WObWSX_QUVUYRUUUWZYVWYTRQVaVOWYOUUUVbcSNWfTQVYSVXSUTQaYRUUaQTXTZXVSUXUSSZaWSOTVW_SUbWPWaVPVbTQaTPWUaWUPSaSUVZXNTdTW_RUS_YOWYOWZVZXQXXPXUSWUYRUfSRWRXbUQZXWUNVYUTXZZPRXTYYTVVaYMPXWV_WTTVXVVQUT_aRPWZRW_UTTWZSUZUUTVZZRTUV_RXVSaSUWWVSTYWOWbSRXSWZXXUTS_aQQUZYUWSU_RTYS_TQZVZVSQXbRSXXOQdXSVUaTUXUVSXWRTXVTWVYWSVXTZZWWTRSVWWXZWSTWQWUXYPcWPVVWTVXUWWVXWQVZVVYURYZWSTVRYVPYXTSWZRXXWWUTPabUSZXQSTSWYSbVPXRY_VVXWTSPaYPYXUSS_RaUSZUYP_VPWaYRWXSYTRZRXWQUXZZURUTUYWURXVVYUdQNYTTVXZWNUbYUXVNXaWTQZWRTXVTTTa_VSWTTYTOWWWaZZPRZTWXRXTUURVUdXPVUVXQUWUaXSYUTYWRUYSWWUYVUYVVVVVRQVcVNUaWXRVZUUVXVYWROYXSZVWVTUSVXYVVSMYXV_UTYWT_WUSQ_YUVRXWTXWQUcWQSYVVWSVUaWRSVXXWTUTZYQUWSbYRTYWRTUXVTYZUYTSSX_RWVXSUTXYQVWUWcSRXTWZYSYSRWXXSXXVQSWVXST_VRWUUYR_XR_VWSUYVSR_XUVWTYWPXXVSWVTVWUPZ_XRRZVUYZWMSdSUbUNQYbXPTZUTaXRUXUMYbTRUYSWWXVSXYYPVUYZOUTVYZYRTWQT_UTZURWUZbTPUWT_TRTXbRUVSWYXWVUXTSTYYUXSSWYVSVWZVPZUV_SWVT_VNTXYPUZZ_TUSRXTUcSTZTSUWVVTUbSSZXZTTTS_TRbURZTUVTVUXWUVVfUOWVPSdVWWUQTYVWTZQS_WUVYWTUYSTXVXTWZPOYaPSVXZWZSRSYZPV_XVSVXTTUUVUUVYWUXRVYWZRUVQVdYPWTZWUXQUW_VSWRWWWWXVNVYTSZZSSSYZWUQVXXXVUTaVPXTZTT_TWUSVRXWW_RUTWVUYWTUWZWRXVSU__STVVVTSYTVUQYXT_WU_VTVTUYUTXTWZVUTVYSO_bTRTWTXWVYUUSVZUPW_XVQV_WOWWSYWVU_WUTSUVVWWUaRRWXSVaVVSVXVVVRVXUXURYWWVSaWTQWZSVVWTRXcWWRQZTTYXUUTUTV_XTVVTXWUVYXTSVXLSYZcUVTVWTWWSXVSYUUSYUUaSVWYSSWXXRTWWVVWZRP__USURX_TUVW_SSZSXURXXWTXWVRUaWSTVXWVRTYRWXWXWWQVY_TMWaYTTUTUZYVVRXUSXXUUSTX_XRWSYUTXVUTYSVYWUZUQYaVUMOZYZQZZSWTUYWUVUVYVNWWVYUXWSUWWSSU_bR_VNVWWRXWUXVYSOXaWRTYWTXSQaXTWW_XQ_UMUVXVQXXS_UR_XUWYUUUUUUWTUWUQa_SSU_XUQXUUaWVTSU_SPXVXXVWVTVVVXUWSSVU_UWUTZWTUXYVRXVVWUYUSWXUVaXTQUUTWWSU_XXSTYXTRVZYSRX_TRSYaUSSYXTRVXTWTXXP_YWVTXYPTYSYTSbWSOX_USVWSSYbSTVVZUWTSWWSWYQX_VWUTTYWURQ_aTQRVfWPYSTZWUUYXMQZYZVOVUa_QTVWQYWTXWWWSQ__WRSSZ_VTSYXUVaVQTXSQXXUWWUWSWUWWSaZRVWQTTUXZUTXSXVWVUa_QTUUYSZUTZPTaURXTUYXRWTTZUWVXWUVSUUWXXURXXWUUXVSSZVSTXYSYXRWZVWURUV_XNTZWUUVWXSV_TXWRWTUXSWXWRV_VTUYYPTbYUQQYXXVRYTRXVXVaVTUSVZWSWQWVTZWSWZWVRTVUVXXUXWTUTXXUTUVSWWTVYWWTTYWVUVUSW_YTSUYWOY_VRRXTXZVUTVZXUVYZOQ_XOS_UXWWWUSTXQaaTWTTU_aPT_TTTTTVUZXRVXWTYYTTYSTYUXWSUXVYURaTSVUXVTUUZTPYWVXWQTaXQUXWVVUYVRZXSSZaSSXSUZTSWWVTVUUWUWQV_YYRTSUYY_TT_SRVWXRZYQWWUVVYPSXUYZVSYVVYUUTVXUUUWTTaUTYUUXWUVTS_YUSQSUXVXZVUTUWZXRWWSYVSRSWaXTXUTXWQXYXVRWXQTWUZXVUVVVURZXWUVXSXRWYWUSXUYRTYUYYSTWRXZYXTQX_VTTTVXTYURXXWUTTXbUTVSUWXUUVUW_RTZRWWV_WRXYSSPT_YVRUYVSXWS_VVUSUWZWTQY_VQSYVVZXSVUWUVWWWSYXWTPTVXXVTTYWVWUVUWYUVVWXTQSXYYVT_YQVYUSWXTRSUYSRYYZUWXTUYWSRUXWZXRWYUVSUZWSTVUWVVYZRQXXZSRZVSTYUW_WVRSVVUVRSZcST_UXTRXUYYQRTWXSU_WWVWWVUXYTUVWRTZYUUYUSWUTVUUWVYYUUTYW_USSSbSQWXUYYRTVWUVSXWXURXVYUTWZUSWUVUYZSTWWTXUUYVVSTUYYSWVWVTYSVXSTZVVYTWVVUSVYUUUTWWVUXUUXUVSVXUUXZTWVUTUZWTXZUURTYXTVUWUSaUSWVXVQUZXVUVUQWWWUOWXVW_XTUWZTSUVYUUXUVXXURUWVSWXTSUXWTWWTXVXYVTWTVUV_STXVTVWXUTUUWVWVTRUYYUUVWXTYVRWaXVTTTSYUUWYXTVQTXUXXUYVVSUZRRXVXYUUTVWVWXXVSTWXWSSVWVVVWVWXVVWUQWZUVURUYXSXVUXTVUWWTTXWUXYVUXUUUSWXUVUWZYTXVNXWWXUXTSUTXbXRSUVWTV_UUXUSUXWVUSXXYWRWTSVUVY_XSWSTXTUVWXWQSTaZVXSTTVTWX_YPTXTUYUVWVYWTTTWYXUSXaUSURSUaVSWXVSYWSUZVUWWYRTaTSUW_VQPYWUZSSXWWVUYXUSUUTVUaYRVTWWTXWURWXTYYUSVZWTTYVSUTWWVXUWTQZXVXTTYXUXTTVUXYVSUYURVZaVRTWVWZVSQWWWWUWVVRUWU_YTWVVTRVYXWRW_RTXYRTVZVPWVXTVXTYWUUYYXTQWVUXXSSUYXTWYVSXSUXUVWWUTUWUTUZZUTUXTUVWXUVXRSaVQXXYXTXUSWXYTQWWVZXTTXTRWZTUWXYPVWUWTVWXVWVWTTXVWXTUVWYURTX_WRUUTZ_TRRWYVXTUWVYWWTTTTWXZVSTYZTSYTSYSVZYURSWUTYUUWWVYTTXVVSWZSVVSZWVWWSRUXXXTSXSWYTUVZZTURTYVVUXZUPVVWVSUZ_RTVVXXWWWTTVZSRWUYYTTYVTUUWTWYUVVWUWUSVYZUSYXVWTTV_XTTTWWUVVTVVTVXXTQXcWSTVWTVYXXSTVUVXTSUSX_XTUVWUWZSTVVYTRWYVVZWSUVVWUVTSYZRRZYVVSUWUUUVXXTUWUVUUXXVVWWUXVQWWUUVWURXaRYXRXTWXTUZWWTTYVUUWTUXXUWXQRX_WUUTV_VSSVWVWYXPWVTZUTUXXWSVUVZZVQVWYURVVWXTTYWUSVWWVWTTWVWXWUWUWWUWTUTXUUVTUWXWXVWUVTSYVUUVWUWUXUSZTWVV_TUTUWXWUSVWVWRSW_YWWTVSVXTWTXYTUXYXVQTVXYUVUVUTWXVRUYVUYUTWUVUUXWTUWVWWTSWYVZXSUVUWVUTVXUVUVUVXVUWSRYZVUWWUUXUTXUUYRS_XUSTZXSWUUTWWWUUUTZVSYWXWOV_ZURUVUVXXTTYWVUPS_WTWXXQWUXXUWTVUVVWYVTTUYXSXUSYXTVVUTWVVYUSWXVXVUTVWWXUTXUUURXTVZZVRUT_XTVTVTTYXVVUVXVXVRWVWVTWWTTWXYSWXTSTYTTVYWUZZTSWVSWWXVTXRVXWVU_WOUZSUWWYZURSU_YTSUWYWQUVXXRWYWUUSUXXWWVTUVXWVYURRWXWXVUTUYXUXTSWXVWVSSWXTYZUUUUXUVVUTTVXWSV_XSWVUVWVUXWUWXVTSWXXWRVUTWYXTUWVWSVXSWVUVWUUXYWXZUPRYWVVXTSWTUWWYXPUZUUUSWXXXUUUVVTXZXRTWVUYXVUUXVTVTUZUVYWSTXUVTUYVWVUXTTWWXTUWVWVVTUUUYXTVWTTWWUXVRUXXXWUTWWUXWSS_ZTTVVTWYUQUXWQT_YTUVWYVUYTTYTUVYYSSTXVUXSSXXVUXWUVVVWXTSUYVTSVZWUUVUYVWVUUXWRXVVTUUWZVVTVVVUUVWYSSUYWWWUWWUWWUUWUUTVZUVQTXUWUWWWVWTRVWVXWUVUVVXXVUWUUVVUUVVXUTZXSTUYWSTVTVXXWSSXYWVVUSZXVTSXWXVUUVUUWWVVWUVTWVUXWVTTVXZVUVSTUWXVWWTTVVVXWRWWVXXYVUVUTVXSSYXTTWWTUVUUZYXVSUVWWUXVUWSTVUVYWUXVUUSUWXYTUVTUVXWUUWVUVVVVYVUWUSSV_WQXXVUSWVWXVUVVWUTYUU_VSWVTUTWWXVUXSWVTVVXXUUWWVWVUUYYUTTUVWTWXRVZVUXWVUTTUXWUWXVTVUVXVVUVWVWVUXSTWVUTWXXXTSVYWUUUVWYUTUVXUUXYXXWTQSWYVVWVWSSVWWWWSTWYWPVZXWTTUVWUVZVUWWSVVTWYWTSVWVWXWUVUXUSXWSTVYWSUVYUVTUUV_YTRUWXVUXWWUUVUWUVWVVUUWWWVSYVTWUVUWXXWSWWUTSYVUWUWWWVSSYWWWTVVUWVUWVWUTWVWYTRXXUVUXWTVWWVWUTWVVUWVRVYVYYSUVVWRQ_YUTTXZWTUUSWXTXVUTRYXVXUVUTZYVTTWWVUUWWSWXVVTVWSVYUSXZTUTUUWWUXWUVTUZUWWUVWVRVXXUTVTSWYVSTYWVXWUVTUXWVXWTUWVVXWWUTUUWVTUVXVTWWTVWYURWYTTWXWVUTVUWZTVWTVVUWXVSVUVXXVRTV_aQRUUVVWVVUUWWWUXVUXWWTTUWYWTRU_ZUTTWVTVWVTUVWXVTVXTUVTWYYVTWVUVVWWSTYVSWUVWVWUTUXWTYVUVWXUVYVUUVVTXUUXUUWUXUVVUXTTWWVVWUTWZTUYVTUXTVYUUTVWVVUTXVVWTVVUTVYYXQUZVTVVUYVUUUUUYWUTWVTUVWWXVVVVUSVVXUVWWWSVVWUWYUWXSTUUVWWYVSTUTVYUWYVVWWVVUWVTUWYUUVVXUXXTVUTTYVSWXXUUUVUVYUTUWTVXXWTSVXWZXUSTXWVVWVSTYVQVYVTVXUUWUUVVVWVUXUUXVUUUXXUUVVWWVVUSUWUWXVWWVVVSVWUWYXQRUXYVSXYVUTUWVUXUUWTVTUWXXUSTXVYYUUUUVUWXVVUVXWVTSWYUTUVWVVWWUSXXUUWXVUTTTTXYYVVUUTTXVUWXWSTWVVVWZTUVUYWUUTUWYWTTVWUVUWWUVVXUUVVVUVWVVXVVWVTTVXVUWUUWTVXYVTTVXSVWXXTUTVVXTSYZWUTRTWYXVWWUUUWVVWVWTVYUUVVVUVWVTVWVWUTUUVVXYUUVUYXTUVUWVUUUXXTTWWWUTVSUYXTWZVTUTUXYXSQXWUWUWWWWWVUUTTVWUTWYUWXWUUUUVWWWTTXZVRVUVXWSUWVUSZWUUWXTTTSVYVVXWUWXUUUXXUUTTWXUUWWVVTUXVSWWUVVXVTSUXXVXVUWUUUVVWTTWXUWVTWWWVTUXWVWUUXVVTTWVVVXXUVSVYVTVWVXWWVUUVVUUSVWVXWWVTTVYWVUVVVVUWUTVWXVVXVTUVWVVUUVUUUVYWRUXXWVVSUXUUXWTVWUUWUUUVXUVTTXUVWTTWYVTTWXVUUVWWVUUUVXVVWTVWUUWVUWZVQTXWVWVSUVVYVVVXYUUUUVSUVWXUUVXXXVSVUXWUVUUUYVXUTWVVWUSWTUVWXWYVTWXTSWVTWWWWVWSSXWTVXWTUYWVUSWYXVVUWVWVTSVWTWWVTTVXXXXTUWUWVUUVWVVWWSVXVUWWSWWUVWXXUUTUXTWWTYWUTTXWTWVVYYTSWUTWVUXWWVSUWWYWSVUUWVXWVTVXWUSVUTXXUUWVUVYWTWUUUVVUWWXUSVWXYVSSUXVVVTWVVYWUUVSUWYXVWTTVWYUWVSSUYWVUVXVWTUXWUTUXUUWUTVWVVWVUUVVXUVWTUWXVTTXXVTUVUUYZVTTVXTSXWVVVWVXUSUWWVVVVXVUTVXWVUWUUWXVTUWVSWYUUYWSQWYWWTTVXUUVUYWVVSUXVYWTWUTVUUWWWVSVYVWUUVUVWYWUUUWVVUTVVUWWUWWVVZUTVTVVUSVYXUUWUUYVTWUVVVUSXZWTUVWWUTVTSYYVWUTTWXUVVWXUTVUW_TTWTVVVWUWXVUTUWXVWVUUVWTVXXVTVWUSUVXWTUUWZTVWUUWWVXVSUWXWUUXWTUVXVUVXUUVVWUUWXVWWUTTWVVWUWTVVUXVVVUTUWYVTWVVWVUVUTXWWVUWVWYUVWUUTWUVWTWWVVWVUUUWWVVWUTVXVWVVVUVVUWVWVTUVWXVUTVXUTVXWVUVWUWUUUVVVVUWVUYYVUVUSVXUSVWXVWXTUWWTUXWTTXWUWWUUWWVWUUWUUVXWUUSWZWUTVWTTUUXWXWUVUVXUTVWWUVVUWUWXWUTUYXRUXWVVSTYWUUUXWUVVSTWZWWVTWUVWUWUVWTTWXVWUWTUWVVUUUXXWVVTWXVWUVVTTVYVTXWWVUVUVWWUVVUTVYXUTWVUVVWWWVVUUVTWWVVTUWWVUUXWUTW_UTVXXSWVUTWXUVVXXXTSUVWVUTVWWWVVWUVVVWUTVWXWUWTUVVWVWXUTWVVUUXWWUUUVWUWWVXUSUXXVTUVWWUWXXUUXWVUVTUUVYVWTUVVWVTTYVTWYWTVWWUTWVVVVWUUTXYUUVTVYUTSVWVWWSUWWWVVVUVXUUWXUTVVUXVSVWWUXWTUTVYVUVUUWVVUVWWVWVVWUVSVXVUTWUVZVUWUUVUVXWWWUVVUVVVVVVWUTVVVXXUUVWVVVUTUVWYVUWUVVUWTVWVVUTWYUVYUUUWXSUVWVTUWXTUXWWYUSTWWXXVVVUUWVUVWUVUUXVTVYVUWWTUVWVUUWVTVUXXWUUUVXVUVVVXTWWTVUUVVWXUWVVUTWVWWUVTUWTWWXXUUUVVWVWTWWWWVXTUVUTUXWWUVVTUWVVZUVXWVTWWWUUWWVTTWVVVVVUWVVWTUUVVVUWTTZXXVTVTUXWVUUVWYWTVVVUTVTWWUTUWXWVUUWTWWWXUVUTWXWVTWXTTVYXUTUVVWVUVUVWVVUVVWWVUVWXUTUVWVWVVUUXXUUWVUWUTWXVTWUWWVVXXSVTUZWUUUWUTWVVWVTSXXUTUWXUVYVTTVVWXVUSVWXVTVVUUXWWVUVUVWWTVVVWUVWXTUVVXVWUUUVWVVVUVUVXXUUWVTWXTTXVUVUVVVWSVWUYVUWUXXUTTVWWVVVUVUWWXVSVUUWXWTSWWWXVWUUVVWWUTVWVWUUXUVWVVVVWUVWVWUVUTTXXUUWWUVVWVUVWVWUVWUXVUTWXTVVWWUUUUTVXVXWTUWVVVVVVVVWVWTTWVUUVWXVTVWUTUWXWWVUUVVUUUWXUVXWTTUVXWWUTWVUUVWWYVSTVVWXWVTVUUVVXVVXVSTUVWXZWUSVUTXVVVWVTVWWVUVVUUZWTXWUUSUVVXWVTUVWWVVTUYWVUTWVXWVVUWTTVVVWVVWVVVWWWTWVTVWWTUUVYWTVWUUXVWWUVTVWWWXWUVUSUXXUWVUUVVTVVVUWVWWTVVWWVVWUUVWUVUUXWWXUTWVUWVVVTVUUVWXVUUWVVWVXVUUVWWWWUTVUUXYUTUVXXUTUTVYXUUWVWTSXWWUTWUWVUXWUUVVVUVUUXVVUUYVVWUUVWTTVVWVVUWXWVTVVUVXWVUVWWWWWSUVWWTWVVWWVUWUWVTWXUVUWXTUVWUWXVUSUXVWUUVXVTXXUTUWWVUTVXWVUTUXXVVWVTTWVVVWTUVWXVVVTUWXVUVUWVWWVVTSWXWTUYWVUVWWVVUWXVTUUWXUWWUTVWVVVVWVVWVVVVUUVVUWVTWXVWVVUVWWTTXWUUUVWVVVVVUWWXWUVTUWWUWVTVWVTUVVVUWXVVVVXVVWTUWWVWUTVXVVWVUTWXXWTTUVWWVWVUVWWVVTVWWWVUVWUVWXXUTTSVYYVTVUTVVVWVUUTVXWVWVUWWUTVXVUUVWVVTTWWXVUUTWVVVWXWWWVVUUUWVUWVUUUVVWXVVUTTWWWUUVVXUVWUTUWWWTTUVYXWVUVUUWVVWVVUVWVVTUWXVVUVXUWVRUWWWWUVVTVWUVYVUVUVUUZVTWTUXVVVVXUTTXWTVWWXWUVTTVVWUVWUVVVWVVWTUWWWVUVUTVYWWXVTTVVVVVVUUUUVWVUWWTTVWXXVVTUVVXWUVUSVWVXWVVVVVTUUVXVUVUVWYWUUUUUWWXVUUTVUWXUTWXWUSVWWWVVWVUVUUWWWWVUVWUUXWUVVUWWVUUXYUVUTVVWUVVWWUVTWWVVWVVTVXTUXWVVWWUTVWXUUVTVWVWVUUTWVUXVVTVVUWXVTXVUVWXVTUXWVVUVWVUVVVWVUUWVVVUVVWVUVWVWWWWWUTTUVVUUXXUUUWVTVVWXVVUUWVWWVTUVVSVYYWUVUUWWWVVUWVTTWWTUVWXWUTWUVWVWVUUVWYUUVVXUTUVUUVVWWUVWVVVUWWUVVVUUWVVXWVTTUUWWWVUWVWWVUUVVVUWVVUWWUWVWVUXUSVXWTUWWVVWTVWVWUVVVWVVVUYUUWUWWVUVWVVWWTSVVVVWVWWUVVUTWXVUUVUVVUVWWWVSUVVXWVUVUWWVWWVUUTWTVXWUTVXXUUVWVUUUXWUVUUWXVVUVXVWWUVVVUUWVUVVUWWVVUWVVVVWVUVVVVWVVVUUVVWVUWVTTWWVVWXUUVVWVUWUWWTVXWVTTVWWUUWWVVSVVUWXVWVWURWXWVUVWUUUVXWUVVUWWUVVUVWUVVWUTVXWTUVWUUXXVVXVSVVVVUVUUXVVWVUVWWVUUUTVXXWVUUVWWUUUVXVVVVVVWWUUVVVTVYVUVVUWXVVVTVVWWVTVXUUWWWVVVVUTVUUVWXVUUVWWVUUVUWVVVVWUVWWWVVUTUWXWWWUUVWUUVUUUXWWVTWVVUWWVUUVVVWXVTTWWXVUWVUUVWUUVVVWWUWVVWUWUWWVVTVVUUTWWVVUUWXVVWVUTUXVWXUVTVVVVUWVVVUVVVVVUTWXWUUVWVUVUVWVVWVUVUVUUWWVVVWWVVUVVUVVWWUVVVUWWVVVVVWTWWTVVVVUUWWWXUUTUXWWUVVUUUWVVWWVUWVUVVUUUXXUTVVVVVWUVVVXVUUUVWWWVWVTTWVVTUWVWWUUWWVVVVXWTUUWVVVWWVVUVVWVUVUTUVWXVVVUUVWUUWVVWVUUXXWVVWVTVUVVVUWXTUWUTWVWWWUTWVVWVVUVXWUUVVUVVVWVTUVWXXUUUVVUWVVUVVVWVVUUVVVUWWWVUVWUUWXVWWUTUVWWVVWVTVVVVVWUUUUUWYVWXUUVWUVVVVVWWWWUUVUXWUUVVUVWWVUVUVWUVUVVVYVUVWUVVWWTWWUTWVVVTVVVVUVWWVWUSVXWVWVUUVXUTWWVUVWWUVVVVUUWWVUTWWVWVVVVWUUVVUVXVUVVUVVVUUXYWUWVUWUUVVVWVVWUUUVXWVVVWWVUVWUUUVVUVWVVVVXVUUVVWXVVUVVVWVVVUVXUTVWVVVVVVUVWVUUVVVVVVVVVVWVUUUUWXWUVVUUVVWWVVTUVVVVVVWVUTVWWWVWVWVUUVVUWWVUUWVVUVXVUUWVTVWWWVUUUWVWWTVVUUXVTXWVVWUTVVWWUUWWWWUUWWUVVUUVXVVVWVRUXWWVUVUVVWXUUUWXVVVUVVUVVWWVUVVVVVWWWVWVVWUTUWVVVVWVVUTWWUWWUVVXVTUVXXVVVVUTVWWVUVVWWVVVVVVUUWVUUUVWYXUTUWWWXUTVWWWUUVVUVXVUVWVVVUWVVVVVVUVVVWXWVVVWWUUUUVUTXYVUUUWVUVVWWVVUVWWWUUWVWVTTVWVVVWUUWUUWVUUWVVVUVVVVVWVWWVTUWVWWVWWUUVVWVVVVUWVUVWXVVUUUUVWWVVVVVWXWUUVVVVVVUUVXWVVVWVUVVUVWWVUVVVWUVWWUUWWWVUUUXXVUUVUVVUWUUWVWUUUWWVVVWVVVVVVVWUVVVWVUUVVVVVUVWWXUUTUVVWWVUVVVVUVWWVVVVVUVWVVVVUUVWVUVVVUWWVWVVVUVVVVVVVVVVWVTVVWXVUUWWVWUTVVUVVWVUWWVUWWVVWWUVVVUUUWWVWWVUUVVVWVUUUVWWVUUUWVVXVVVVVVXVUVVWVVVVTVVWWTVXWUVVVWWVUVVUVUUWWVVVVVUVWVVUWVUVVVUUWVVWUUVVUVWWWUVUWWVUTVWVUVVVVUWWVWUVVVVVVUVVWWUUUVUUVXYUVWVVUVVUVWUUUUWXWVUVVUWWVVVWWWVUUVXWUUVUUVWWVUVVVVUUVWVUWVUTVWXYVVVUUUUVWVUVVUUVWWUUWWUUUVWVWWVWXVSUWWUUWWWVVUUTUWXVUUVWVWVVVUVVVWVVVUVVVWVWVVUVVWWUUVUVWWWVVTVVWWUUVVUWVWWUTVWWWWWUTVWVUVVWVVUUVWUWWVVVVUVWWVTUWWUVVVWWVVVWVUVUVWXWTVWVUVWWVVUTWWUUVWVVVVVVVUUWWVVVVWWUUVXXVUTVVVWVVVUUVVVVVVWWWVUUUWWVVVWVUUVVUVWVVVUUVUXWWWTUUVVWWWVVVVUWWVVVWWVUUWWVVVUUUVWWVUVVVVVVWVVWUVVUUVUWVVXWUVWWVUVVUVVUUWVVWVWVVVVWWVUVVVUUUVVWVVUUVWVWVVVVWVWVVVUVUVWWVVUVWWVTTVWVVVUVWVWVVUVVVVVVVVVUUVXXWTTWVUVVWWVVVUVWWXUUUVVVWVVVUVVVVVWVUVVUVWVVVUVVVUUWWVUUVVVWWVUWVUUVVVVWVTUWVWVUVVTUWWUVWXVUVVVVTVVVWVVVVUUVVWWVUVVWWVUVWVVVVUVVVWVVUUVVWVVTTWWUVWVWWVTVWWVUUVVVWVVWWVUUVVWVVVWVTVUWVVVVVVVUUUVXXVUUVWUVWVUVWVUVVVVVUUWWUUWVVVWXVVUTUWWVVVVUUUWVWVVWUVWWWVVTUXWVVVTUWWVUVUVVVVWXVUUVWWUUWVWVVUUVVVVWWVUVVVVUVWVVVUVWVVVUVVWWVUUVVWWVUUVVVVVVUUVVUVWWVVVVXWVUUVVWWVVUUVUVVTVWWVTVYWUUWWVWUUWVVVUUVVVWWVVUWVVWVVVVUVWVVVUVWWWVUVVVWVVWUUUWWVVUUVVVWWVVVVUUWVVVUUVWVVVVVWWVUTVVVWVVVUWWVVUVVUUVVVUUWVVWWUUVVWVWXVUVVVVVUUWWVVUUVVVVVWXVUVUVUVWVVVUVVVVVVVVVWUVVWVVVUUWWVVWWUTVWVVUUVVVVVWVVWVUWWWVVVUUVVUVVVUVWWVUVVVWWVUUVWWVVVVVVVVUVXVUUVVVVUVVWWVUUVWWVUVUVWVWVUUWVVVWVVVVVWVUUVVVWVVVUUVWWUVVVWVVVVVVWWUUVVVVVVVVUUVUWWWWVUUUVVVWVUVVVVWVVVVVUVWVVVWVVVVVWWVTSUVVUVWWVVUVVWWVVVTVXWVVWVVUVVUVWWVVWWUUVVVVUVVUVVVUVVVWXVWUUVWWVVVVVUUVWVVWWWUTVUUVVVWWVUUVVWWVVVVWWVUUVVVUUVVVVWVVWVVVVUUVWUVVVUUWWXVVVVVUUWVVWWVVVVUVWVUUVWVVWUVVVUVWVUVVUVWVUVWWVVUUUVWVVVVWVUVWWVWUTVWWVVVVVVVUVVVWWVUVVUVVWVUVVWVUVVVWVVVVVUVWVVVUWWUUUVWWVWWVVUVVVWWVUVVVVVVVVVWVUVWWWUVVTUWVVVVVVVVVVVVVVWVVVUUVXWWWVVVVVVWWVUUVWVUVVVVUWWWVUUVVVVVUUWWVUVVWVVVVWVWVVVVUVVVVVVVVWWVTUWWUVVUUUWXWVUVWXWUTUUVWVVVVVVVWWVUVXVUVVVUVWVVUVUUWWWWVUUVVVWVVVVUVVVVVWVVVVUVVVVVWVVVVVVVVWUVVVVVVVUVWVUVUUVVVWWVVVWVUVVWVVVVWUUVVVVWVUUVVWVVWVTUWWVVVUTUWXWVVVUUVWVVUUVWWVTUVVVVVVVVVWWWVUVVVVVWVUUVVVUUWVWWVUUVVVVVVWWVVVVVVVVVVWVUUWWVVVVVVVVUVVVUUVVWWVUVWVVVUVVVVUVVVVVVWWVVVVVVVWVVVUVVVVWVUUUWVVWVVVVWVUUUVVVVVUVWXWVVVVVUVWWVTTUVWWWVUVVVUVWVWWVVVVVVVVVVWVTUWWVWVVUVVUUVVWWVUUVWVUUVWWWVVVUVWWWVTTUVVVVVVVWVVVWWVWVVUUVVVVVVVVVVVVUVVVVVWVUVVVVVWWVUVWVVVVUVWVUVWWUUVWWVUUUWWVUVVUVVVVUUWWVVVVVUUXWUUWWVVUVVVWVUVUVVVVWWVVVVUUWWVVVWUUVWVVVUVVVWWVUVVVVWVVVVUUVVVVVVWVUUVVVVVWVUVVVVVWWVTUWWVVVVWVVVUUUVWWWUVUUVWWVVUVVVVVWVVUVWVVUVWWWVVUUVVVVWVVVUUVWWVVVVVUVWWVVVVVVVWVVUUVUUVVVVVWVVWVVUUVVVVVWVUUVVWWWVUVVVVWWVVVVVVWWUUUVVVVUVVWWVVWVTUVVVVUUWWVVVVUVVVWVVVVVVVVVVVVVUUVWWVVVVVVVWWWUUVVUUVVWWWVUUVWVUVWWVVUVVVVVVVWVVVVVUVVWWVUUVVVVVVWVUUVWWVVWUUVVWVVVVVVUVWWVVVUUVVVWVVUVWVVVVVVVVUVWVWWWVUUUVVVVVUUVVWVVVVWWUVVVVWWVUUVVVVUWVUWVUVVVWWVUVVVUVWVUVVVWVUVVWWVVVVVVWWWVUTVVVVVVVVVUUUWVVVVWVUVVWWVVUVVVVVVUUVWWWUUVVVVVVVVVUVVVVVVVVVVVVVUVVVWWVVVWVUVWWUUUUWVVVUVVWVVWVWVVVVVVUVVVWVVUUVVVVVVVVWWVVVVVVVUUVVVVWVWVVUVVUVVWVVWWUUVVVWVVUUUUVWVVWWVVUVVVVVVVVVVWVVWVVVVVVVVUVWWVVVVVVWVUVVVVVVVVVWWVUUVVVVVUVWWVVVVVVVVUUWWWVVVUWVVVUUWWVVVUVWWVUUVVWWVVVVVVVVWVVVVVVUUVVWVVUUVWVWWVUUUVWVVVVVVVVVUUWWVVWWVVUWWVVWVUUUVWVVVVVVWVVVUUVVWVVVUUUWWVVUVVVVVVWVVVVWVVVWWVVVUVVVVUUUWVVWVWWVUVWWVVVVUUVWVVVUVVVVVVVUVWVUVWVVVUUVVVVWWVVVVVVVVVVVVVVUUVVVVVVVVVUVVVVVVUVWWVVVUUWVVVVUUUVWWVVUUUWXWVVVUVWWVVVUVUUVVVVVVVUVVVVWVVUUVWVVVUUVVVVVWWVVVVWVVVVVUUWVVVVVVWVUVWWVVVUVUUVWVUVWVVWVVVVVVUUVVVVVVVWVUVVVVVVVVWVUUUVWVVWWVUVVVVVWWVVVVVVVVUVUVWVVWWVUVVVVVWWWVUUVVVVVVVWVUVVVWUVVVWWVUUVVWVVVVVUVVVVVVVVVVVVVVUWVVVVVVVVVVUUVVVVVVVWVUVVVVUVVVUVVVVVWWVVVVUUVVVVVVVVVVVVVVUVVWVVUUVWWVVVVVVVVVVVVVVVVVVVVVVWWVVVVVVVVUVWVVUVVVVVVVVUVWWVVWVVVVVUVVVVVVVVVVVVWVUUUVVWWVUUVVVVVWWVUVVVVUVVVWVVVUWWUUVVVVVUVVVVVUUVWWWVUVVVVWUUVVVVWVVVVVUWWWVVVVVVUVVVVVVVVUVWVVVVVVVVVVVUVWWVVVVWVWVUVVUVVVWVVUVVVWVVVVVVVVVVVVVVVVVVVVWVVWVVVUVVUVVWVUUVVWWVUVWVVUUVWWVUUWWVVVVVVVVWWUVUUWWVVVVUUVVVVVVVVVWVVUUWWVVVVVWVWVVVUUVWVUVVWVUVVVWVVVVVUVWWVVUUVVVVVVVVVUUVVVVWVVVVVUVVVVUVWWVVVVVVVVVUUVWVUVVWVVVWWVVUUVWVVUVVWVVVVWWWWUTVUVVWWVVVUUVVVWVVVVVUVWWVUVVUVWWVVVVVWWVVVVUUWVVVUVVWWWVVVVVVVVVVVVVVVVUVWWVUUVVVVUVVVVVVUVVWVVVUUVWWWVVVVVVVVVVVVVVVVVVVVVVVWVVUUWWVVVVVVUUVWWWVVVVVWVVVVUUVWVUVVVWVVUVWVVUVVVVVVVVVUVVVVVVVVVVVWWVVVVVVVVVUVVVVVVWWVVVVVWVVVVVVVVUUVVVVVUVVVVVVVVVVVVVVVVVWWWVVVUVVWVVVVVVWWVUVVVVWVVVVVUVVVVUVVVVVVVVWWWVVVVVUVUVVVVVVVVVWVVVUUWWVVVVWWVVVVVVWVUUUVVVVVVVVVVUUWWVVVVVVUVVVWWVUUVVWVVVVVVUVVVVVUVVVUVWWVVVVVVVVVVUUUVWWVVVVVWVUVVVVWVVUVVVVVVVWVUVVVWVVVWWVVVUUVVVWWVVVVVVVVVVVVVVVWVVUVVVVVVVVVVVVVVVVVVVVVVVUUUVWVVVWWVVVVVVWVVVVVVWWUVVUVVVVVUVWWVVUUVVWWVUUVVUVWVUVWVVVUUWWWVVVVVUVWWVVUVVVVWVVVVVUVVVVVVWWVVVVVWVVVWWUUVWVUVVVVVWWVVVVVVVWVVVVVVUVVVVVVVVVUVWWWUUVVVUWWVVVUVWWVVVVVUUVVVVVVVWVUUVVWWVUVVVVVUUVWWVVVVVVVVVVUVWVUUVWVVVVVVUUWWWVVVVWVVVVVVVVVUVWVUUVWWVVVVVWWVVVVUUVVVWWVUUUVVVWWWVUUVVVVVWVVWVUUVVVVVVVUVVUVWVVVVVWVVVVVVVVVVVVUVVVVUWWVUVWWVVUUVVWVVVUVVVWVVVVVUUWWVVVVVVVVVVUVVUUVVWWVWVVVVUVVVVUVWVVVUUVVWWVVVVVVVVWWVUVVVVVWVVVVVVWVVVVVUVVVVVVVVVVVVWWVVVVVVVWWVVVVVVWWUUUVVVVVWWWVVVUVVWVVUUVWVVVVVVVVVVVVVVUVWVVVVVVVVVVWVVVVVVWVVUUVVVWVVVVVWWVVUVVVVVVVVWVVVUVVVVVVVVVWWWVVVVVVVVVVVVVVVVVVVVVVVVVUWWVVVVUUVVVVVVVVWVVVVVVVVVVVUVVVVVUVVWVVVVVVVVVUUVWWVUVVWWVVWVUUVVVWVWVVVUWWVVVVVVVVVVUVWVVVVVVVUVVVUUVVWVVVWVVWWVUVVWUUVVVVVVVVVUVVVUWVVVVVVVVVVWVVUVWVVVVUVVVVVVWVUVUVVVWWVWVUUUVWVVWVUUVVWWVVUVVVWVVVVVWVVUUVVVVVVUVVVVVVVVVWVVVVVVUUVVVWVVWVVVVVUVVVVUVWVVUUVWVVVWWVVVUUVWVVVWVVVVVVVVVVWVVVVVVVVVVVVVWVVUVWVVVUUVVVVVVWVVVWWVVVVVVVUVVVVVVVVVUVVWVVWVUUVWWVUUVVVVVVVVVVVVVUVVVVVVVVVVVUVVWVVVVVVVVVWVVWVVUVVVVVVVVWVVVUUVVWVVVVVVVVWVVVVVVVVVVVVVVUVVVWVUVVVVVVVVVVVVVVVUVVVVVVVVVVWVVVVVUVWVVVUVVVVVWVVVVVVVUUVWVVVVVVVVVWVVUVVVVVUVVVVVVVVVWVUUUVVVVVVVVVVVVVVVVVVVVVUUVVVVVVUVVVVVVVVVUUVWWWVVUVWVVVVVVVUVVVVVWVVUUVVVVVVVVVWVVVVVVVVWWUUVVVVVVVUVVVVVVWVVVVVVVVVWVVVVVVVVVVVVVVVVUTUVWVVVVVVVVVVVWVUUVWVVVUVVVVVWWVVVUVWVVVUVVVVVVVVVVVUVWWVUVVVVVVVVVVVVUVVVVVVVWVVVVVVVVVUVWWWVUUVVVVVWVVUVVWVVVUVVVWWVVUUVVVVVVVVVVVVWWVVVUUVVWWVVVVVVVVVVVWVVVVVVVVWVVVVVVVVVWVVVVVVVVVVVUUVVVVVVVWVVVUVVWVVVVVVVVVVVVUVWWVVUVVVUVVVVVVVVVVVVWVVVVVVVVVUVVWVVVVVUVVVVVVVVVVUVWVVVVVVVVVWWVVUUVVVVVVVVVVUVUVWVVUVVVVVVVVVVVVWVVVUVVVVVVVVWVVVVVVVVVWVVVVVVVVVVVUUVVVWWVVVVVWWVVVVUVVVVVUVVVVVVVVWVVVVVUUVVWVVVVVVVVVVVVVVVVWWVVVUUVVVVVUVVVWVVVVVVVWVVVVVVVVVVVUVVVVVVWWVVVWVVVVVVVVVVVUUVVVVVVUVVVVVVVVVVVVWVVVVVVVVVVVUVVVUVWWVVVVVVVVVVVVVVVVUUVVVWVVVVVWWVWVVUUVVWVVVVVUVVVVVVVVVVVVWVVVVUUUVVVVVWVVVVVVVVVVVWVVVUVVVVVVVUUVVVWVUVVVVVVVVVVVVUUUVWWVUVVVVVVVVVVWVVVVVVVVVUVVVVVVWVVVVVVVVVUUVWVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVWVUUVVVUVWVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVUVWWWVVUVVVVWWVVVVVVVVVVUUVVVVVWVVVUVVVVVVVVVVVVVVWVVVVVVVVVUVVVWVVVVVVVVVVVUVVVVVVVVVVVVVVWVVUVVVUVVVVVVVVVVVVVVVVWWVUUVVVVVVVVUVVVWVVVUVVVVVVWWVVVVVVVVVVUUVWVVVVVVVVVVWVVVVVVVVUVVVUUVVWVVVVVVVVVVVVUUVWWVUVVVVVVVVUVVVWWVVVVUUVVVUUUVVVVWVVVVVVVVUVVWVVUUVVVVVWVVVUUVVVVVWVVVVVVVUUVVVVVVVVVVVVVWVVVUVVWWVUVVVWVUVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVUVWVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVWVVUVVVVVVVVVVVVVWVVVVUUVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVWVUVVVVWVVVUUVWVVVVVVVVVVVVVVVVVVVVVVVVVVVWVUVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVUVVVVVVVVVVVVVVVVWVVVVVVVVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVVWWVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVUVWVVVVVVUVVVVVVVVVVVVVVVVWVVVVVVVVVVVUVVVVUUVVVVVVVVVVVVVVVVVVWVUVVVVVVVVVVVVVUVVVVVUVVVVVVVVVWWWVVVUVVVVVVVVVUVVWVVVVUUVVWWVVVVVVVVVVVVVVVWVVVUVVVVVVVVVVVVVVVVVVVVVVVWVVVUVVVVVVVVVVWVVUVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVUVWVVVUVVVVVVVVVVVVVUVVVVVVVWVVVUVVVVVVVVVVVVVVVVVVVVVVVWVVUVVVWVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVWVVVUUVVVWVVUUVWVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVWVVVVWVUUVVVWVUUVVVVVWVVVUUVVWVVVVVVVVVVWWVVVVVVVVVVUUUVVVVVVVVVVUVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVWVVUVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVWVVVUUVWWVUVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVUVVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVVWWVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVWVVVVVVVVVVWVVVVVVVVVVVVVUVWVVVVUVVVVVVVVVVVVVVVVVVVVVVVVUVVWVVVVVVVVVVVVVVVVVVVVVUVWWVUVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVUVVVWVVVVVVVVVVVVVUVVVVVVVUVVVWWVVVUVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVWWVVVVVVVVVVVUVVVVVVVVVVWVVVUVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVWVVVVVVVVVVVVVVVVVVWVVVVVVVVUVVVVVVVVVVVVVVVVVVVWWVVVVVVVVVUVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVVWWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWWVVUVVVWVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVWVVWVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVUVVVVVVVWVVVVVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVWWVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVVWVVUUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUiw_SaeJJhiTVNVQEYRQevWLfWWMBXUTZclVHTUTQ_gUVFVa_cLYQPeaZLKXkfDQhTFUfhHNfKVZcUUTXbReJObYSNcWXOVaQ_RWcJViVSMcZNLSkVPOacPVTVUbZTOXbKWWUZYVUQR_VU_WQRWkYNKOZYdXPUWSVeVIcTNcXWORUZcTIeeLXYWUPMWecRMObYKeYbQMbLWbVcXLVXSSW_SYYIOi_W_LPabON_WTWfTKaZRQRZcVOWTReSRXWcLNdUTXVXQVWYaROX_PZYQWQcfRNLUZgQPdSVUTYYVUPZSUaWZIWbUXTQa_NQaWSaVTRUWUXURhWNTOhTWbPSNaXRXZVV_LPcVXUUVNXbZTTVSTZUMiQKiTWWOWVWVYQUZUVUVQ_aVUQTVTUeVOaYNPWfXRTRQScYUVTZXUOZWKUiYMTVbTS_OSjQQWWWJecKWZUYYROZTXVOaTY_VPUbNU_XTSXTUUbUTYRYXTMbaRTQ_VXYNXXYYLPVcYXXSLZeQ_POcYOVQ_hSOVVQYZYQSTXVVYaYHYWVWU_PTXYUQbVN_bUTNQhUUSWYNfXPPZRPeXURaPUXYZKW_XPTcXTNV_VUPhWH_bTLYZVRUeSPVXSaZMRY_OYaRRZYQYUUWUPdaLUVUW_TSVYVRWVSWgOOZRdQPV__STQXYUVcRPRWbTaQTWTZQXVVTZWYUMaQVYXXWVMVYbSRbNTaVZRPYcRLYaWRTaZQUOZdSVQSaWSZSRWYXTVQW_PWbWRPTbaOUTUYXSTcYQPU_XRTbNWiKPTcbSSVUT_PSeYLTcZMVVYVOcWRUZWTXSVaQQbWO_TVbOZSUYVZQRZWRaSWZQVXZROZWVZPZ_RPaYNWVaTUQUcUTQbMZeSUM_WVQVaXVOZXOZUTaWVNWYZ_NUVYYOYURYaSS_QYSTYVYPReYLVdYPYQUXSZVaRRUXaRZSMYaZMUaOYZXRRZUWWSVSX_URVbRLdYSZOU_ZTPVbVQVUZYUVNWaQVXXWSTYTTbTRUWZTVYTQaVSUWaMZYPXXSMbdSSQZTY_KZVPbbPSZWTRRbXRbTQZPWaSUWXPbQTZSdQRUYVTWVWVSbZKXYRT_TUZWSSYOYbTSWZUMY_P_WWRNbaRUUTWSbaIVbTUUXSXYQWUVaOVZWVNbXPaUQZVXVRTYZSYQXZPQaaTSRZWVSWXTVUVaSTZNbSSbRZSVVSZaOPYYUVbQQV_WSUQYfRMbSU_R_SVVTZVOVbVTR_RUcSSRTbZPSVaWQYTWWOXYRWYVSUZXRScSPYWUScSRaUQT_T_XOTVZVSbSRWZWRVPacPQXZTQZZUSXVPZWXVSYTUVWVXWRRZZVUPYXSWYVXSObTVZRXUTT_YSSYUTZTZQWZSURbXKZbQZPVYSTYZUWTSOacVRTVWXSVYVTZRRXYUWUWVQcRTXU_RUZSWWVWTWTS__LRcVSYTUWVXTXTUaPXYRVQeYNSXfPQXUY_NUbUSS_VUUaPPcUWUTT_WTVO_YWOVaTXUSRbVTYUTTYUVSW_QVWWTRY_SWVSWXYOZWTUVZPXWSbURTXYRUXYWVUSU_WPUZVaOWYRXRaTSTYYUZQTTWYXTRXX_TPVWXVaRNfTTVRZXXUUXRSYWXUVWTVUZVPZ_OT_VSVcOUYUVUXTWRbURT_WObRVUUaVQSbVRVWXTVXVWSRZ_SQXYUXSW_PUYWTVYVTQUgOTcOVSaUVWS_TRWaTWVSVXVVUUZURWZTSVW_UN_YO_YRWXSUWUVYZPUXPbXTWSSXVXYRXWXOSdSTYVTUYTUYTVZVQXUVVYZOWXSWWXTWVTYXTSTZaSUUVTUXYTSXWXXTNXYYWUTTUVZVTVVUXTWYTWTTXTYVXWPVYWSVUXXTUSXYUTUVXXUSUXXZRSWWVVUUYWXPVcQUVUaSTZTSWZVRUZUTVYUSYUUWWUTXXUWUYRTbTSUXXUTXVVRXXTWUVQX_PUbQWWSbTPTaUT_SURX_RZUSZRTZWUYTRUZWUVUZOYaQTUaXPT_UUWUUSYUWYTWTTXYTSYYUTXSUYXTR_SWWUWTWXWQUZZWTQVYXWSUTZVSXVVXSUZSUZUVRXXUWTYURZWTVWVUWWUUUVZSTVYVSZSYUT_PVZTVXVQYVSWWXTXWUSWTYYRXVXSWYTTWVV_QTXYSSZUWYPTZVWSaSRWVXWWRVXYTRXVWYXSRXWTWZSUWUYVUVVXSW_STWTVYRWZRVXUSXZTSVV_WPTXYVVTSXVVYRU_VPXZTTVXTWVVSXZTUQYXUUYTUYVVRYVTVX_SPYYSWWXVSUUZYUQXWRYUYTVZRRYZQVWXWTTQY_TTSXXRYUYVQWWVUXVWUVWQX_TVSUXZWPSY_XPQZZVUTQZXSZTTWVYUUTVYWVTXTRWbTRXVYSTVV_WRWUUZUVP__QSVYVVVWSWWTWVVVUYTS_TUUYUTYVUUUVYRVYUUUVYTSZUWVSUXZSWTVWS_WRXUTZVWUQaTSaRWYRWVUWYTTVWXUUWXTWTVXXTTXS_TUVVWTVWXRYWQWYUWSVWVXTWUUUXaRSVWXRXUYVSYUVUUXYSUXSWXVTUYUVUTXZURXUVUWVWYRVVWWSWXVTUVYVRYWRUXZVQUYVT_USVUaUPW_TSYWRWVV_TTVVTVZXSSWZTTZST_VTVWUTXXTTXVVSVZWUVTVWVXUWRVZVRYYPUUaVRYTSYWUXUTWVUXVXUUUU_USXTWYTWRVYZSRZVTZTUWSZTVUU_SVWWUSXWUYVVUSYVWWUVTUYXSTXWTWWWQTZWWUTXVUVUXVVWVUYSVXRaSVWTYUTVZUWTSYVTWYUTSWWXWSUTXXVUVWWUSVYSVYUTWXQWYUTXYRSU_XQYVTXTUVVWUVVUYTVUUYSXWTTWZSTYWTTWZUSXVVVVUWXUUXYQUXWUVVXUTVVXSWYTSXWWWTTVXWWVUSYZRTXVWVRZUVYQRYYUTWXQWXXUTWWVQaXOYXTVVVXUSVXWWTTXTXWRYWUUUUXVUYTVSXWWYPU_WSTWXUWUWUSZYTSYXSUXVVXSVWUXSU_WSTUYXSVWUUXXSTWZTTXUUVYUVTT_TUXWUTVWWWTUVWXUVVUUXWVUUWTWYUTVXTUYVVSS_XRVWWWTUVVWVWTSZUVXSVVWXUTVVXXVUTVXWSWVVXUUVYSWYRVVWUVVWWUTXYQWVWUVVT_RUXWVTWVUUXXUVTUYUVWUTVZURVZXSTTZUUZQYVSXTZVRVZVSWYUSYVVUUXTVXTVXVTXUVWVVUYUUTUXXWTUUXUTYVWSWWTXUWTYWUUVXSWWVWTVXVTXVTYUTVXXRWXUXTWVVUUYVWTUYVTVYTUXVVUVWVTWZURVWVWVXVTUVXWTWWTUXVWXSTV_USXUUZVSWVWUWVTVXVRVYVWUUVUXWVVTVWVYTUXTUVYXSSW_UTWRXXWTSZVUUWWUUTXWVTWWVTUXUWWWTSWYVWVTWVWUVWVWUUUYVTYUUUWXUUXUUWUWVUWWUUWVTXWTUWXSUXWVSXXQXXTWYTSWXVTVWVVWUTWXVUUVWTYWSWUWWVUUWWVVSWXVVWUT_VRYVTWVVUVXUVVVVWWUUYUTWVWVSVXVUTWWUVXVUVVUVWVVVWUUVWWSWVVXUTUUYWVVUUWXVTUYVUTVYWTUXUTWVWTUYVSVYTWTWVTWUWWTVXUWVVVWVVUWWTWXTUWVVUWWTSYVSZUTUXXUUVVUYUTWXUSWXVTXTVXTVUVXVSWWWVTVVWVWRWYRVYUUWSXVVYUTVXVVUUUYVTWTWWVUUWVVVVUUWYUSVWVVVVWTUWVWWUSYXUUVVTWVWXTWUUWUWWUVWUVWTWVVXTUWUWWUUWVTYUTXVVWUUXWUUVXWTUWUWWUVWTUXVVUXVUXVUUVXVTXTUWVVVWUTXWVUTXVVWUUUYUUYUUUWXTUXWTWXTVVWVUVWVUVVVWWTVVUWXUSWVWVVUVWWWVVUVVVUXWTUVXTWUUWVWUVVXUUWUXUUWVWWTUWVWVTWVVUVXUUVWVUVXUTXVUWVVWTVWVWUVVWVUXWTTVVXVUVVUWWUUWWSWXVVUXUVVTXWTVWVUTXXUUUXWTVVVXVTVWWVVWUVWVVWVUWUUWVVVUVVWVUTWWWVTUVXUUVWUVWTWVVUUWWWTTWXUVWUWTWWTWVVXUUWUVVVVUXVTVVXVUXUVUVXUVVVVVVWVTWWUVVWUUWWUUVVVUWVSVYVUVTWWUUVXWSVWUWVVVVVVWUUWXVTVWVVWUWWUVUVXUUWXUTVWVUVVTVXUVUVXUTVXWUTVXVTVWVUVWVUVWUVVVWVTWYVUTUXWTWWVVTWWWVUWUVVVVWWTVXUUWVVVUWWUXUUWVVVVVWWWSUYWVTVWWWUSXXTVVWVUXUTVXVTVWVVUWWTVXVUVVWVVVVWUVVWVTVWYSUWVVVWUUWXUTVWVVVVWUVWVVWUUVVWVVUVWUVWVVUUWWUVWVUWUVXXUTXUUXVTVWVVUWVVVTWWUUVXVSVYWTTXWUVVVVVUXUUWUWUVWVUUWXTUYVUTXVUVVWTVXUUVVVVVVVVVVVUWVVWUUVXVTUWXWVTUYWTVVVVVVWWTTWWVWUUVXVUVWVUVUWWVUUVVWWVSVWWVSVWUVXUTWXVTWVVWUVVVVWUVWVTWWUVUVXUUWUVWUVVWVSWWVUVWTWVUXVVVUVVVUVVVWUVVVVUVVUWVVUVVVVVXUUUWWUVVVUWVUVWVVUVVWWTUWWVVVVVUWVUWWUUWVVVWUVVVVUWWTUXWVUVVVVUWUTWXUUWUVVVWVUVVVWUVVWTVWVVUUVWVVUVVVVWVVUVWVVUWVVWUVVUWVVUUWWVUVWWTVXVTVWVUWVUVVWVUWXTUWWUUVWVVWVUUWUUXUVVUVXVUVWVUWUVVWVUVVVUWWVVUVWVVWUVVVVUVWVVVVWUUVVVUVVVWVUVXUVWVVUVWVTWWTUXVUVVVWUUWWUVVUVWUVVWVUVVWUVWVUVWUUUWVVVUVVUVWWUVVUWVVVVUVWUVVVWUUWUUWUWVUVWVVUVWWUUVWVVVWVVVVVUWVVWUVWVUVVVVVVUWVUVVVUVXVUWVVWUVVWVTWWVVVVVVUVWVVUVXVTWWWVUWUUWVVWTVWVVVVVVUVWUVWVUVVVVUVVUWUVWUVWVUWVUWVUWVUWWUUUWXUUWWUUWVVVVVVUVXVUUWWVUVVVVVVUVVWVUWVVVVVUVVWVVVUVWVVVVVVVVWVUVVUWWVUVWVUWVUVWVUUVWVUVWVUWUVWVUVVVVWWUVVWVUWXUVVVVVWVVUVWVVVVVUVWVUWUVVVVVVVUUXVUWVVUWVUWVVVVWUVWVUWWUVWVVVVVVVVVVVVVVUVWVVVVVVWUVVVWVVUVWUUVVVWVUVVWVVWVVVUWVVUUWVVUVVUWWVVVVVVUWWUVVVVVVUVWUUWVVVVVVVVWUUVVVVWVUWVUVVVVVVVVUWVUVWVVVVWUVWUVVVVUVWUVVVVVWVUVVWVUVVVVVVUVWVVVWVVVVVUVWVUVVVVVWVUWVVVVWUVVVVUVWVVVUVVVVUVVWUVWVVVVVVVWVUWVVWVUVWVVUVWVUVWVUWVUVVVVVVUWWUWVUVVWVUVWVUVWVUVVVWVUVVVVVVVVVVVVUVVVWWUUVVVVVVUWVVVUVVWVVVWVUVVVVUVWVVVVVVUWWUVVVUVWVVVWUVVVVVVVVVVWWVUVVVVVVVVVVUVWWUUWWVUUWVVVVVVVUVVUVVVVVVWVUVWVVVVVVVVVVWUVVVWVVVVVVVVUVWWUUWWUVVUVWVUVVVUWVVVVUVVVVVWUUWVVWUUWVVVUVWUVVVVVVVVVVVWUVVVVVVVVUVWUVVWVVVVVVVVVVVVVVVVUVWVVVVVVVVVVVVVVVUWWVVVWVUVWVVWVUVVVVVUVWVVVUVVVVVVVVVVVVVVVVVVVUVWUVVVVVVVWVUVVVVUVVVVVVUVWVUWVVVVVVVVVVVVVVVVVWVVVVWVVVVVVVVVWVUVWVVVVVVVVVUVVVWVVWVUVWVUUWWUUWVVVVVVVVVVUVVVVVVVWVUVVVVVVVUWWUUVVVWVUVVWVVVVVVVVVWVVVVVVVUWVUWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVUVVVWVUVVWUVVVVVVVVWVUVWVVVWVUVWVVVVVWUVWVUVVVVVVVVVVVVVVVVVVVVVUUWWUVWVVVVVVVVVVVVVVUVVVVVWVUVWVUVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVWVVVVVWVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVUVVVVVVVVVVVWVUVWVVVVVWVUVWVVVVVVVVVVVVVVVVVVVVVVVVWVUVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVWVUVWVVUWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVWVVVVVVVUVWVVVVVVVVVVVVVUVVVVVVVVVVVUVVVVVVVVVVVVVUVWVVUVVVVWVUVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVUUVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVWVVVVVVVVVVVVUVVVVUVVVVVVVVVVVVVVVUVWVVVVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVUVWVUVVVVVVUVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUWVVVVVVVVVVVVVVVWVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
      cr: 'VhwunidZVTTWWXfgXPPQRVXafd_WSVWURTRPQSWYTPTUUSSWVUVWXYWTTZ_YZZaa_dYMIJNRSXYVUUTUZbZXZZYTNORYaZ___c_SPRNNTTXVTVYWVXYZTRUWZYWUTUTXZWVRNKPVXWWYXUVXWVVUVWYXUVXZY_YUUVSPRUQORRPRTXbbcYQORZbaZXY_caddXVPJINRVXZaXRLJMPTVZabcbbc_VTTVUSQQUWVUTUQNRPPWab_YVWYUSTSRUWURSST_fb_beccXQTUWYWXZUQKJNNOQVX_ddZWVUTVVSVXabXVUXTSRLJOTTTVab_ZYUPQRUUUWVWUZVUXXXUWY_ZTSSRUVVYYXWXVTRTYXYUUTRWY_YZaZVTWXVWXSPSUWSPPTa_ZTRQNPRWY__XXWVTRTWY__YUSVXXVRSTSQQW_VPSRUXVUXcZXXYTQUWYW_fbYPOPRYZXROPTXY_ZZZVSPOPSVXYWUVXWVVUSOOTWZbbYWVadYVUXUVXWTQUVVVVYVUZZYZVVVPKJKNSTTTV_bZabcbWVVONVXUSSRQPSXY_ZWWWXadcYVVUWVVQMPSROQWYXWXWUWUW_YWVUYZUUTRUVSSVWZaYXWXUVVSTVYVTUVWWXUVOPTUZYYUSTWYZWVYUQQVXVUUWWSRX__YTTYXWWVUQRTUWQOOPUY_ZYYYXWTTWZaZVSRQTVTRRX_WTRQTYZ_ca_YX_ccVRVXSOPQSRUZTSXYZSRSPRWWUZcbVUVVWTTQRYaXSSTSRWWWYVWUWSPTVURTXWUXY_bbaWSPSWXUTYZUXUQVVRRRVZZZXXXWUUVVQPVUVZaWUUQRSTYUUUTXWUUVVUTUZ_VUWXTNSTWWSUSYXWa_aYVWQRUaaTRRUYXXaYXUTUXZVWUUSQRUWWXYYVUSPQTTYXTSU_aWSTRRYaZZWXVRVTRUWXXSLMPRUV_YYYRTQSZXXaaWXYZZUXZVSVWUWVUVUVUSWZabYUPOTUSUPKOSXZYYW_aWQPRRZc_WTXZYSQUTPQUSXZ_aWVUTUYYZ_XXUUWXYTTWQRSTWWXXWWVSUUUSUWRRQUXZXZXSSW_VTWVSSRUUSUSUYZZ_WTVabYUTUUUVXWXYRQUXYYWVPKQUTXbZVTSPMTXbaZ_VUUVURSTVXWWTYdZQMTXYXVUUYb_ZXVWYbWPPNPWUSWSUUVZYZYZVOLQUUW_a_ZNPURU_XTXUTRTUTOMTVZfcXYZWUVVVUSUXYXWTTWRPRXfdaaZ_YVRMIIQVXacZWORWWVQWVUXXWUSUTQVV_bXcUUZY_RPSVPO_b_XRMQQOWXVWXRS_WVb_aZZ_XbRIQTUWXVTSRZWRRWaWXVSWYZUSRQSVVTUVYXUUYYWSUVW_YZYWXUVXZSPWVZ_URRUROSVY_YTTSRTVTRWYacYWbVQTOSTRZ_XXWZTSWTWYWWTQPPTSSXYYTYYPUWYZWUTVVZYSUYXSTNMWZaaVRSPVXUVUZadWUbYUTXZdZTSQTUTXVQROMOWaWZUSWUWWVZWSSSVXYRTYZZVY_WVXUQPSUXUSXTUQNXXUTUY_ZcYTPPXY_VaiYSSUVSSTPVYUSRXYRWbbbTQPUWWUSUVWVRSTSaaWUYaWVSTSTWWURTPOTUWYWXUSXXVWVWXYXUTYcWQSVROYYUVSRXZXWV_aRSXSRYWUVTVSY_XTSVPSVXUXYONTUTZZYWYdXVcZRQRTXYUUXUUYWSOUUQQUbUUYYTVYTYSVYVSSUVYYV_ZRONUX__UUV_XUUS_eYQRQSXZWRPOQPT_XXWUQQXWaeZXVTPN__SRPTXUSWYX_VZYTXUUVRSWWXRP_dYX_VWRVYRaaRPRSXYOQTOPSbg_SWbZSSV__VVTQNPYcXVUQOQZ__VTXXVSUZd_TPSVUQLOSXURS__YZXYWVVURXe_WURRSRTYY_dXROQPTVU_aUSXXXXSVYSUZXVb_RPNUVTTV_XWQMSYbYVSLSY_bccWRPSYcVOYYUWSRPJOSPY_VUUXZYUYTSXY_TWYXZWUUORbWPWUSWVUdeYUQSQNOZVPX_c_QQY_YZYQ_WVa_bSQPQQQRSVTWY_daVKOSVeZWYWYY_ZQNOUYUQTUTTXaZUUSKRTYaXXSWVXSQTYWPVUYbZWW_abXWXNQYYXQWWUUPVWWVTSVYVPTXTVXXWTSRSVVUSWXWXYVSZ_WdbRQNSYYUTXZaWUYVRQX__XSSTdYTSMMQUabSQTYURRNUWSVXZYUUbi_VROROU_WUUTXZSRTVWPQZbddXQX_WXWSUVWUOUcZUYXVOSYOPXXRNNQYaaWSZZTUUZcbYSOKMWSQYbYSQSYXWRPbc_YSSXYQUVTZbULQZTLQYjiXWVVTVb_STaXSSOJOYbUMRWRPWTRUdcVSPZZRTYWXVWdgXSYaYTPKR_Y_YXTKLVXTYUUQJTYTWYXYWXWVTUVSXbVVXQURUbTTUafgfTGLUYYSHLVWaUWZVTT_XUTOWWU_YXYXUWZWVXPQUVZWPSZXVWaWPXVQVXXWc_WXSPUWZXRVSMQSOPRUZUSYXWXZWYaa_VVSRWYWWUQWWQSVTTWRWbUQUZXSVcdXVYTS_YSZWUWLOVWYTQVabdVQWTOPSQQX_YSPTSXbZSTWPRXYaVLNZZXWU_WRSUTYYVSUZVXZ_WXXWWUUVYYXSSVRNWVVVTacZUSQSSRWWTYXSRPQVZaXQSXYVTSSXYSPXYTWRUW_f_SUYUYXQXWOTWZVOU_ddUNRXXUXVWWUYTWVQWSMV_bbWQUYRMRUVZcYUQMUYXTSVQTORXUZZcWSVSSYdXNYdZYYVOLPWVVZcYQSZVPUWaZXRQWUVRTVVRTSNbibZXSUTVbVX_TUPSZRPOQYXYTWfeYXXZXOVa_SRUJKNPUTSOXaYWPVZRLSUW_XadaXPNTMPXSWYaaZ_XYWTWcZUTQXb_VQTRLLYaZZWaUKNWZVYaZPUWORPaaYbUcZUZVYTQST_PP_TRSX_RPKSZVWQVYSSUbX_c_ZVUMSVOJSXTVUWZcXRUagYYaSPKVcUPWYOQSZaYcXTQNSXZdZVYTX_YPLXXSOPXbdTNSNSVXYW_RWYTXYZROUYWUUUXY_eWSYRPUUPPUa_UWVXZSOYXYcbaVSRWSLSbYLQbWWUU_ZXUSQSWTWWXXKNVUSSZXPMZ_PRXaZWYUPSSTaff_YWSWXYU__QUXTTTWaUWYOORMMOU_cUOZ_ZUQUVWaZXRSXZZONYaTUXVUMRVXabeTOYZXSRVSRQQU_YWVQUYXURXX_ZTUSdZUUMRXaTKSYTUc_WbaUSSX_SONXXOWWbXRUSVPSWSVVb_VYYSXaYZSSSUb_RPVRIMRXYUYigZPRSSZWYQPUZeUPTSUWTbbTcXLOWWXYQUYbXXWVdXQOTTSPSf_RTQabRVaTPVUQRRVZTRNQ_XQTZUUYVTUMTcW___ZWWWYSRWZYTRTWWaTOXbZVPMSSQXZUX_UTVaXSWeaZWVTPbSINVTTYYWTVRXZWSNQOYbdeZTZVN_TJSaWZZVQRVWYNV_VZWRQVYVRRXZVRUZaZSQVWRTSPMUcaWZdVXaVSVRNWXXQTaWTVRQRTbXVZVV_UTYWVVRMSU__UY_bSIOUYbXVUVT__RRNUYX_XVXZVTSUZWYWPUV__VUKMPSdaVTVaVXcYTQWWQTWTXWSOQUU_VV_eYQSNRSOacYUPNSaYTYYVRTYZ_X_XVbWSSQYXUZXPQURWUUWWUQVXSTPIPZaVZcaZVWbZZUQYfe_VLKWaRUXQQRVTRYYXNOXY_STUSVYRYaOUTPVVYdXUWTJTZMS_XRTacURVWcaPUaTWYPQYe_c_WSRWTSKQXVYbVZYPPPaePHTWcdUXOLZVSWPRV_XWVZcWOKUYfdXYOSUSUUWTZ_RUYWVYZQQUVORfZXOETZcVNYdSOVVZWTXXYXSOXdVWWaZNPQVRRZWNQZYSUWYdcaVRPXXSWUU__SWaWPTXORbYYbSUWTUQMUaSRXSNT_UTZWVVWYXPZeTUPYYSfhRSYLPRPV_RJQYVZcVZXTSRYbdZTVVS_bYZNNRPTXUWZRWVRTUMUhWMPY_Y__c_X_UPSSNTWXZUSWYUQTUXbVLP_bUPORSWabTLVUTccTW_WPNSbbTMVdV_dWTRW_RUSSZWZS_YPVSTSOQYZUWTaYQUSVdbRQQTUVbUQQRSVULOXebUNRWbgbadXRPUbUUWPQXaXTOUWQOVXWZ_ZVZXRTVWbZQRTWUUPVfWURQWWUSSVYTQQQ_aVZWTRVRPSVXX_XUVXVXXcYNSZXQSVaXVXUWecPPYTRXTVXVTRYWQQV_WRPSTZZadNNQNMOWbYQWUUbUSVUeeXbWTXZZZ_cXRSWUWbWSTSKQWQSd_QRPYUROGP_hQQXbeTSSTXd_T_SNV_ZTWOKVYZVUVXWVaZWa_NNYZaWOUVRWXQNVYSYX_YPVYTWWYdQQZ_RLPTVbeWSKOTUVWXSadcaRQPUSSXYYRTTSUVRRabebV_gdWTLRSMLLVZbaWSQWYVQVUTUYZSVXcTNVXPWbSTXYTY_WWW_WMRVVadZMJSVZbXMSYWWSRVZTZWS_RSUUWV_YWVOPVWSPSZ__YVSVZSQSMVkdUgeTOKXXWZWYNPZ__QNWUQRRRTYVaXOW__YTXXQPWaTSUYWYXUVMQSWYVWZcaVUVaXGLVhfJNUTUPLVcURUUVZdcXS_WSOOTYhWPORbUNXUWcWSUaVZaPRQTXZVU__YSYaWbXWabULRYYPLQYZVULEP_ceSIYeaXWUSXYRJQVUXWUULTWRXZbYXXURZ_Vf_QPZ_TUPUSPYYVWVdaTTXYRVX_WNSWZZXUPLSTRTQ_caVTYPGJVceWINbicRTdXNcaSWc_OYTWUTZRQTVOTRUXTVZZ_ZQXZTPQVTOTaWTPS_bUTgcWbWRNTebdXHSTRQLV_YUUVWROTVRPWYSUd_ZbSVWWWWQSfTSaVRUTUTNOV__ZZVSRZbXVOQWWXaVTXSWTRVSYXRXSNYUMW_WYWQRab__PPVTTXWVWUQ_cTRSXUYXXYLPUWaSRWbaRVQQVV_YdYWWOSSbb_WHKNWc_ZYXYURVYW_YYSKTSRYUTTRVWSOWYUSVZYYWYSRTKSTY_QWS_geaPUWRTQSaaZebVWONUYWTSUWTWcSGTUSRQVcdSWUVdWRYTHNYgfXUNXcdbZdZWPQRQSMTbWJMWWTRU_bTKPYXXYSRa_TUPQUUVUXWTcg_SSVZbfYRRWZVWRWZWNJOSTVZVVcbTNVZNLRWYWZddaWRTUSVUSafbaTMNLMTVQXZTNUXUabYRSXZcXRU_c_QUYLR_XXSVZRSSXVTSYcYabVPRTXWYZPPLSZZYW_WSV_QMLSUS_a_VVKNVbZS_PMSUYW_XWXZRQZ_fUNZgUPXXVPUYTSZdYRT_SOUINTQYVYcTRXaaaf_XTU_SRXVQSRGSaPRefcdXSPOWWRUQRYYZbWNQPRYaZSONSTcYTZTXVUZRIVSSZSSSXWc_YYUWWfZVVQVTUbVTUUYdZKUffXHKYWWZZZVMMPOQTXVbaSW_YVURX_VWVXZOSPO_SQLPXSZXUY__YXWXUWWZZXZUVQSSPOTfdYW__MP_YWZYRYbTQOTbZUVTQLQXVTPXYYeXUWOOa_NVcSRTUWSPNWcVXeUSf_VWRTUUWRVa_RHOPTaYWYVHMcgbZZbXIPY_cXZWRPYSRcYZbWLQXZSPUWUQWZYTOYYRSVWWbWVUPVb_TJNVTVSY_a_URTVOLSUQYcbSTaZZWdbTOWZSVZYNVbTKQ_VZVSVOVRSZSSPRYXdcWWPIJXYYbVcfXOQQUbZURSSPUegZTVXWWfVMSUSZcXYSV_efQPKRZRXMJUWZTOQXYTROUVYhdZPKPWWV_XRZWRYRXXUWQLMZaagaYTPRWa_bVXZSPLJOYXWVXVUYcZKRW_aSVWOW_PQQNVg_WUSTXWR_bTRV_bX_bRQWXSTZS_aTTPUZZPPQW_S__OKZ_TUUdZQVaXQUUUQSRQbdZXQLSXSNROUTTaX_YecQPTg_XVadKMXVRTOS_XWWZTTbYVXRKRUdhQPXYUXccOJWXSMKWcWWVSWWaXWYZVRUUTVUQWUPURUacSU_UVOWdSQaeXQOUaZSRSQQWURRVd_UWTLWaX_YXWTWZPNS_aVUTUTVZVRVSXbRKMX_YYYcYQXaYWXaTIQUTSO_cYZRNUVQYWU_UWUTXXYUSQdiRQTUXYZceZKMaXVPRVPUVRPOWfaTPVYUQMScbXZSU_VUSQ_ZUZXULORQWRQRT__aVKTebcegUQZSTbdVUQOYbdVMRSYURULUeYJKXVQQQUVWVUdbXWUYWUPafUVRZg_VQNLN_bebQQQPV_WRPTTVWSVXWWWTXWRW_SSaXRVaYRRTSWUSTX_UUQSVXaRQYaXWTTUbaTVVVQNNUjiYRNZfcPOTKYeYTWcYYUSTUYUSVbRMROVRNRPV_SQYeZURTZXSMNS_ded_VQRTQXVP_ZQRbdYYWVVYXSWXUVUWWWROYYWVUXSKMUUXXTaa_TQZffYLOXUWRQRRNMY__VaaQRQXZWXZcUWPNTQTZhXPUYTRSKPXcYUWWX_ZUSW_URTbaVZWUTQWXUZUSXYZXSSUTUVTPOVaaYaZWUSQMXZSSRQR_UMU_YRZd__YZSOPWZ_bQOMOXUZYSeZYYKKWeWYaUQMSddTNPSWXWUXbX_RHefYVSZROSUVYaVWVTVdiUPRYQHNTVVYSUTWZNPTYabWXaYVTZWTUYUSXTXPQYRXRNNRefYJLbjfeUPTUXVWUSONTVXXTXWUaUSVXWZWYVUWOVLU_QXZYb_UacSMQTVUNPagbTQKMTaXTTT_VV__QWdUWSUVakUMSSKNcffXTSQNLVZbWQTSWTQXYWTNSXYTYbabUPIUSRcZSLV_ZWOUSUceXNXcWUSQRQXYRXecUVLKWZYZURaZYWUYWLRdV_ZRUUOOXWWVUYeaZ_PNdaITUSVNTaVUVMMUaZaVQUVV_iWSTNWXSUYZXVSMSY_RSaTTYZYWWTTYSQTXXQPWYOOX_X_cYTQUYSQUPVYIOSWcZXU_cdjaZ_PSaXUSOTWSRVZTLNQOTa_YTTecVfYRM9SdUUWPPVaUTYWbUUec_VYUSZXUOWaZWONPUXSUZWQNXWLSYPQWUVWbdWUbYVVIKYc_ZYaROaUNXaSPU_UOQRZWXcWVflcUKKPT_YRTXRQVWbYQ_XVYVUWeYSXVPOSTTRT_XUVQSTPKOXaZWRZdbaMRXZbVUNPVWVTRWZX_PUZUdZOSWVXVVTQTYYXaYWTOSRSQX_WbXRSUTPVXZYXcdffZKNVQWWOVYRPMQdcQTaTPZZTQTZXYRKMMTe_SUWUVWQVaUTcbRT_YWW_UTNSkSQcddaWOPXYMPXe_PRQQTUW_XOMPRVX_hbVVSUSPRQQTW_gUMRPXUNRYZW_ZQVY_XYgYWSPVdeUMJWZZYV_TMWXWZTSQV_RHNYcUTZVSVZZ_TUcYRXMScWTScWUWPKMRSYUSVVaXVYbaPVdYZWPVWWSTYaXRQVZVTTUMSYZYSTPQUWUXcXXU_fQHQXVQNScbQXcXSNRaWQVYORbVUZUQUYSTbg_VXQXXThhSQSVYSSRPUTQPQSSXQYYTXWeYWYVaWVTVROYVUXRUb_SQVWVSVY_ZTPJTYXZRRWZbSWcaXQXTPTUUXXRPTWY_VTUVYVTZXOUSRYOSZXTSSSaaZWSTWTSVaRQYceWZ_ZUUXOOV_cRMQPNSVST_fYQXaZUSc_PVZaaOMUNQXRMTZXWVekcVOPSQOVZYU_bURKQX_SIUYYUTeeUNa_RV_WQZe_URQPPUcZUXWZddTLHHUXRTZ_VUUWWX_XZZUQNNYfbURVWQHMYVQQXV_j_ZWZ_WRJMRWaaUW_WQSSN_jWPXYafgaTTVQLMUVVUTYQLNVaZabTTXUUTPNVb_LUjcVRPRTRWbXTLNTVWVXRTMNae_UWSXbZUZYZgVWVSWaedSKOSVNS_YVPRYYSSQUaUQ_YXWT_PSYVRSZSTYSNQXTRXVQZeUVWUTPYcabbRJWYX_VaaWWWYNJWdZOJSZTTSNWRLVdaXRQbW_hYXUTROUVZcWTS__PUUNPYaTWWONXTQa_VVPLYcdbTW_TTURVV_VRKOZQW_e_MSTSWUXWbZXYTSRNNYXXUWf_TRTcdYTRXTOZbTSVVUNNYXWXSSXXQTZYcaWac_QMQWZZWPUNCMUbYTXZWXXTUVYZceRITaZSONW_VRKOZeaZWYYSYOLUaaSOYcUWXZUJPT_i_SWa_RQZXRW_WNNWVU_aRaaSUZPLVUaXWVSTOTYRPXY_aTKRbSTbYUU_dPNWQTSXdXONUSVaRPSZiaQRWUZfaPQZUSPS__XTMOXaZZYPNdeTQVWX_UPUaaZVRRLLZVWcOJPVXVYYXQRWXefYWUQUcaPUTcgPJHTccZSPTebRRSVSKRVTP_cUVTZQLUXZaX_fZQSUSWY__QSbXWUQQSQVUPQSVNXZTXZcdZRWTT_XXUMS_UUVYUOVTOQVWUVYZWWTVVPYYUVV_ffSPUVWWWXZWSRQQUWTWXRSUZ_TOQSSabWTOVeXTWXaWQXTPYXQQURTSTYWefXXVWNOVTRTdZceUQOWVQQXUQQYZNVbYSRVYYROYjeRSVVZaWPQRVXRWacaTVRRSNTVQTaYLMTPVdZYVTZ__eYPKJRbdXROOQRXfXWcTSXSTZ_YcaTQQPPTSdeXXVSSQQWTNU_SXZVVTacQPWYUV_UOX_TY_W_VOSSSceUSQTVPMSZYTSXUWeXQVVLGR_dddfWOSbbUXSRTMWcXY_OPZVRTSSUUYWQVXSRbgYUSSVXfVQVOSORWVTWaUY_SNUaZWXWR_ZVWQVSXWNPV_UVXYQFTgYQXWZYTUSYWVXPWWPQ__XcXUWUUXSUZUSTWYYVbdUUWVQYXUTJRS_bWVQJHSVWUUYecUMSaaWXSUcUZZUSWZXUJMQWTNYg_UTVcdXYWQTPQYYaWRQUYVVSVcXPQXbXTWSPRU_WS_UXeUNMOUVZbaYVTPOOMSZPNUcaWZSVbTOPRZeZVTU_UVhg_PKTV_aa_WXPQacZbaYWONONKLRYYZSMPSWUXXWXZcXXZZXSNJNQZZUSOQYe_WWVMO_VOWcTQV_b_cYRZXTaYVVSQSYbWRX_ZPMXYWUURV_SUaZTUVUWTRSMORPLSeec_c_UWYWTYYTTTXWOMWXVXVTXXSYRQXUSOJIPdh_VTOQZRPXYjg_fWVWYTTcSOWTOVQKPTbZWRR_Y_ZWZUYVMVWRY_adZVMLPXfXSVXWRQQXcZXQUaWUNNUaaYUMRVQXZKMbhfYXYTOLQVVSOOVfeQQV_caWSOMgiTPRYUSRJVcRSW_cdXSPNdaTWTYWMMQSPTSYibUNXbXZSZfVTYYXPKOLIXeeaRUWWUUUWaXXVZ_YTQb_TPHOecRSZbQHTd_UIN_WYYZaRUUXZUaaZZSSUSPJPaaUT_TQRKRX_eZPLWVQUPSbffQJVdaZREQUTeYTZVTXYZ_b_XZTSWVYUKFPYab_cZSRWXLNYVWcXSWWcXNNWYNQZYSUWXPPXRRRSdfZXTUVUTLQb_USigW_UTRRVZTQYSNUUPU_ZSP_bUVeeTVYTSXSLUWQVSVWJUbYVTQOWWVYZbbXNPRSZSMV_TQYVUdaaacZVdaSTUWYOMVTVYLKTWWXfeaWQRONTX_TNYbPO_ZUVUSPQVRYYSWVUOTcYOUYUYaXWbdZQS_WWVYYVXRONSVRPOXXSSTZa_U_dYaaaUNXVOVURWYUUQMUTOS_PETdf_UVZVZeVXZTRRQUZVV_bcZRHJRZYVdYRXXWTTNKYYTVRadY_XXVSWTSZaZZZUQORRKOXSSYbbVXVRXYZRTUVbXVQRYZUONUXdVTTPWUWTVXRSTdeUSPOPZibTVSPSVQWZY_SRR_idZSRZVOTVYRNXYVVRU_aYRVZYVaaTSTTQVVaaTVQOTWUTVcaSYTQUUZ_UQRSVcbXSSVSLQYRRXRRSQRWcXUWc_SRTOU_aZRXYZ_fiSLVZSNVZXXVXRFKTRRU_bZXZVTXXVWVSXbcfWVYPNPVTWXOT__X_ZSPOSa_WVVbaSLNQMPWZWRZcZVPSRSYZdc_RQ_STTXWQPQWQOSbbV_YXVVWWXSU_USYdd_UVVLLTSRXSKUdXQRSSUUXaWVccUWabaWSZXSSTfaQSRSTMQcZPLMUZ__UYWTTORXXZbUQZXTW_jcPUVXWNILWYZSQPLYZTSWcbWUVRPZWSUVYX_XX_XUTUXdVPV_WOPYVWcaRGOYWPYUNSSWZgbXYWTSfbTRVZPSTKLWPSYVZUOUdfaVWZUZjZNQQTVUVUPRTUWSVTPXXSVXWS__VaSKMWaZ_XTYaUWTVWQTUUZaVTWXTPURQSTgeYUNXVZbWUPX_WYUPQTUYQIVTPXXa_ZYUMTeVMMQWcgbPUZX_bZWUU_SQZYXaTIOQRSRVNMXZ_bWR_cVTQRTTSXcYUTTOKUbZWYWYYbgWUTTUP_ZNQXWZULTXYURTZWMUbaUUTXcbaLNKPabWKXb__adTNTfdTRMMV_UXZPSSQSTTSTUeeYSPYQLWccWRPQSTXbZbYXUKTUXc_ULPXaUWWQQOVVUSV_WVVZZWbdaSPXc_WPMUXURRT__WRRUUXWTSWRQUZf_WWMT_SSNORXcXYYXZWTZUTWVVVRYbYTOTUTST_YVXYTPVVTYeYNNQYYUXWU_VRVTWVML_ePGLSWaURVXYbgabYZeVQVW__VbVPWYSRROSWSNLOdjbbWM_XJRVTOPVbf_RORUZQSgaWPKTXTPQUdeUORXZbVPQTVSPRYeeWSUVTX_X_c_OIUTUeYRVdhdVVXOQW_WONNT_Z_aYXVVVRLNTRPSVXPQbVUPMY___cTSYSUYYWUWWPQbeZTJRYTTWVXSJUce_baQTSQVaZZcTOWWTQOSWcaSLPXZUOWVQWWTXYdjhYQXVOSRTVYUVSQVTSMWaNNaZWXVRMTZYPTVQYeb_RTdaVSYZXSNZYUROPQVTWUYcWTPTWUaZWXUUYZOQYSQUYZabXZWTXSUYYbTKNaULNQcbcUVYQQZbWOUfVLIPUUXb_SXTTaa_aZSWPCLW_XWab_UPPPPSXZUTUaaWUXVT_TTZfdTSTTTWUTTPNQYY_YTTSUTaeXPNTRPVYUXbXPHRaUahZQUXRRWURWW_c_ZTTUUUOPVWRWbd_QTWaVSQLYbUVYYZgbRXVWZXVTPUZUSSVNPaRDJZbUaeVNKXdZRMOXYUTRPVVVaTIJWb__bkh_VXXYaVRYhTQZUSNPTTXYXRVdYRNLNRVaaWXYUQQST_SMcgSQMNXSRXYSSWaZTbYWbVNHPedVVXY_YSOTVXYTTRTZWVPTfZUYddVXOR_UTRUSPQQRQUZUSXcVUZTTc_QYZTVYYUNSaYORZXVTVTRTLIYjcUVUU_VQUXWZSOWYbdXSWYRPUZXRRacTPOLRXVV_aXWVVQMZYOWYW_XUUXXZYXdXQ_aROQOSTQSQRNRWScdVWVVOQXdh_XXZZTSSRYWSRNWZ_WMPXaUVZZa_TNNUWXbYWVOUWX_abVSPN_ZQRTSPSTSUOQUSVVWbZSZfXXURZZX_ZUXURVWVWUQYYWTSX_YX_OJUSUbXRQXfaWSOORNQeaXQYcbbRROS_adZTNHO_cWQVWRW_faUUTTRONRVXZTKSXYSPUZ_WXXZaYSPKPaaVSQRUaUMabXTQZZWVSSU_aSXYWWVZYbabUOXTPTWYebOIQYYTVaVVVROQZURVQQUZROSVZXXWXcYSWZTIUfVU_UNYdSNORQQQPRXbaefbcWUaZWUVXSQMPWYWTPRccWRLPRQZeUSYXXVSQTWRJTYZiXTWZUVYVXQTXSSXedWS_aLIRURVcaWRWVSTYXX_RLRYNNYdcc_VXUUWYYQUZXZY_YNEGQVZaVQPSVXZXZZabddVRQSXRNNNQUXROVaVUZRRUUef__adbVQRUUPRVOIJSUUTYaVYWXWVZZNTcWZUVbabXSVZXTVXZYYZVNHKO_eUSQUUSUSWSNSX_f__WRWLRcYWXQVaVWTQSU_e_TYWMSVRSRMNOTeaSOWhgZWWUSWfbUQXUNPKQSRTWXWccZTRPMbfVTRVcZafVUYSQTTONSWdXTa_SLOQPPPUWZdZZYVUTYZZYWbaQTaVSYUNKM_e_RQSPPR_YQVZbVONUcdWUXMNXbUMSU_bdWPcaWYRSROQRXgfVYSMWVVXXVUZZQORUYTOVYRQUVUPSbcZVVVS_eYSVZPO__SRZaZZWXRRVRPMSWabPRWTNPZhcTROOU_YZ_VYSUbadaTNSZ_ZUPRSNPVUVbWONTaWUZaUMLRWYWSPORQSccWacaULQXSKQacZRPSUXXZWUXXUdjbeZYcWX_RSZQQSMQRROTWRUPRZVRTX_VPX_SWcZQLOZcXUZbXZZOLWdb_TXeVVWUSOWTIGQ_YTSVRQUWUPUcaVZf_UYQTULYdcYQWVRTPYeURSMNTWad_PRUabURRZVXZQNQWacYXTQVUSVUQRYjhWTRR__QVXYXY_VPKQTQPPVcVOYZUSSQTQPVSaeWT_aYTYedWQVWRNOTXYOMVX__VVSUcZUTUadZSVXPIMQTYURWbWU__TUXVYcaaZPLRSNRbaWYXfbKOXbaWSPSUWWWWWNHRVSRU_bUOPNRaYUPQffZbeXT_TPXUXdXRNNRT_baXPRbYNMQYYTSWYXSTceaPMY_WXSSVTVSMMUSVVSX__YaUSYYUUT_fZXWSRTMQUXZWXVYYUPTaeXRWPKKNWWXTRZaYWadWVXTNMY_WVPYbNKSX_ZPRUYXQXVXWS_hcUUVSVVOT__YbZTRXcWWTUaXQKOPVaUOIPYXVWYPNSXaXWWSRUXX_URVWVTVWSSUYhfYSRZfcWVTVdfUKLKHPYee_X_aYbUNWSMLMV_OIWbVWXRRLMVSQUcimdRRVSKNZbVWXVWYXTSNIPZgcTYfZVcXLPZWWVXaVWURVWUWVVTSUYaYRMSSLQZYNSZWX_eXTQLRVTV_ccZTSTUZWYXPUVYafaQcaOLHPWPRSRddRLSZVUWc_TSTcc_TQSUXZ_PJVcWORWTQQZaZUPSXbUR_TYVTaYZSQRNMWaV_YRR_WVbYSQSNQWZdbYYbVNSURUYaaVNLUYUWWVNPccbcd_UYbbQLSWZXSPOWVOQSNMSSVXTRTZcTNUcfYVRQW_d_VTaYNRRTTceUXYZWSVXUUSGJYaNKWSWf_Y_X_VKQXSPWcXVTUUOTYZZWYXZUNSab_WQOOVTTVah_QRVUUVSXXUVSZcZWTQMSbcVLOUWXXWWXTNRaebZSSSOPKWdXZWNRVPXdZXUNQRTYWZebVVXZUTWVQNWbPLOQaXSTWWXebVVVTW_SLOXfZLNVTTbX_jbUSRSUXZSSWWYRSUUXWVTTVefVTTefVZYKLPSZ__YSPOKLKQVSTXYTXcVTSYcXQNXadSMTTWXWOSWYZRVWbeNIRTU__aXXaYUUWWTUaWRZ_baSPWXVVRQSYZXWQWXSVbaRTUPVTOSYUX_UTTTTYdaSPPMUWUZ__UPTUQPRYdZTNKR_XZf_TUZVXaUQNTcd_VSOPOPSUa_ZXVZZURTXWXTPNOdgbWTXTWVVQT_VYVQHKXVXbYXSNUcgb_QMOMTUXdXRNLQZZ_YRTXaXYZVZVUU_aPVddTPNNPWbVVaXTYUTWjhTZdUJQRPQLMMVdXPRUWTPVTSX_YWTOYddZTWSNTZaWXbcaOGNWXQMUbeaWVVTVXPQYZVRTVbfaSKMVXUVXSQOIUhjaPOORUXbccaUTTRWXWVdaURPWROTSLKVeaRUc_WZaUOSWRTRKKRYZaYTTZbXacUUZRVYXaTTUSPRZZ_baUUUSRPSZYXWOPV_VMPUYZUUVWURRNS_UOWZXaaYURUUQNThibUQ_bUPOSTZaQLRWWYUOOSac_WV_cd_USTXdhZTXRMMJNSNVaWUQQSWTKL_faaWQRTTTPSfjdYZ_Wa_UPPPPXaYXXTTPNNMRYd_XURUWRTcaVSRVZVVUOXXTXUSTVcXLOXSJTefieWTTRWaZcaQRXWXVORUV_ZRQOUUTWTTYZPOUcdSMPWQPUZaZaadXRTXQQ_acZTWYTQPLLVaVONUSTaSLRZbVS_eifWROVaZVSRQTTZfSOPQMMZZZRUd_YUVYTSYXQLVZUW_aUSYbXWbVOVXSMMQWa_WQVZUQXaWTVZWRYhZSSSVVUWSMMNS_e_QQTXYccQTbYROQVVXUQRRTXUWbaYRUaXYYXVSTTVTTRVVQNMQQZeXPU_XVYSYkgcZSPSWW_VWUPQNT__YacSOPPW_YaZWchVJPROPSRTVURNSVSUSVUQOUUOXXabcaXZY_XWYfh_YXSKFMTUUVW_eeVTaYTSPNSURY_TROPUQR_cabVR_ZRTUXWKQYYUXYTYUSRT_XYVVZVYVSTMLUWZZUTS_ZUVVVWUVXUZaYTU_YUOOSORcbZUOQXbecUWXSPOKKTRWYMMRSWZYZ_VYeieZXWSXc_bZQOWVSXONS_bKLTVYXUWaSQQOPRVXWVYTSRVUMWdZYZVVTQSWVTRPTXZWXYRV_aaabXU_aWRVXYcZQLMNPXZSNTXUUSWb_ZSMVZXSMQPPWedU_bXWUXWaeZTOIMVXUSUZUMNXaWZXQTX_ZXRUWVXQRWYWYYURPXbeXLTaaWWZ_ZRPPSQNRQVYc_QTWaeYONTbYOPS_aTRRTRQXWW_ZXXXXROTWWUXa_bXRPOPTY__QO__WUVXVXZVVSPTVZcdfYLRXWPNV_c_WTRUXWTOPQQTQUWTUSUaZTYXPJMPWbaYRVTLQagWVYWYZWaYUVUWSV_VYZZVSXUTZbSRZXYTSROYaYdeVOLLQVZ_SKPXXUYWRQOSadXXbWTW_XNPUZdeeTQXUPTTNKQVTRVXXVTSYbTVeXSYa_ZaWNNZ_ROKRYRJSXUZXXXSUYWSVbZXcVXdbaQKRYUTdeaWRONTVWVSRRXfhVIN_ZTPJKUXSQSZXUabWUSYYTYTQQRRVbcaXYVQPPRXdaWTVVONRRXjhdaWXWWS__KOVXSPQRSQRXZWVUWVPSce_WSROTabUPVTWYPQU_ZPPWba_SOZcXPSZeYOPQQOR_b_accYVYVOGCKUSPUWabZfeZSKQXZRTecUQTWWPOS_bTMPZ_Z_VWUWUOQUb_VTTSPRXYVXZbXMVbYdbVTOQYXSSNNWXagZQPXcbZVTTXVPNMNOOSZaaYTXYWSNSXYZXWTbeTVWUTUTRUY__aOELQVUTeeSPRWadTMUYYUZdZaYTWU_cTTYXWUMSaYVMJWWSWVVWRQSTRQSTYdZRSQVYSTVVTbhbVQUbYUYVXXYYSPQNQYcdSMOQVVPVdcabWRWZaXQHPZVVVYWQSUWZUUZYQKT_aYSVXWWXYSRVYXTUWQTZYVYSLTZaWQLHMSWYXXSSa_Zdc_WSVOKRW_YXZVSWQSbdYTW_fc__WTPOILQTZWVZ_OTc_UUTOOUYafcWQRTUSXdXNEMWWXWSOORYeg_SPalhULLRTPSTRUbfcVNMXbXTNN_e_WU_bYSOWWLNZZZZXWWXVRVVNSaVQQQRKPYXXXVXbb_ZTVVOUQQXXWVVMNabV_ecgYPOQZYUVZUOTXXUSXXTSUWYVRZZRRZWPUXXNOaeUNQOSYURRW_aVOXdYTXadfSPTSWTQWcbZQHEIW_UWXZd_XYVVROMVbXXYZWTOSZXTOSUUVSYaYWUUURV_ehbUSUQWaUOUXZigWLKSTRQRYVONPVXUPTXTUVX_dcTQOQZ_WYcVSXVYaYWQMOVZUQQQVZRQVX_VV_bdZQJVYOTPLTaZXZYZXUJLTVfbUZaZZWRVbUTSTWPVbcWVWUXTSVUWXQLOYfYPTQPYbZWVUTZcYSTXb_WXUNNXcWOPSRQMP__TSY_USSXb_VUPKMTZXTYbXVVYc_XYaZRTTRTWaXQTVOPWPLLUTOYaWWbXVVWkgVW_YUURPOTYXTQRTVab_WZbXYaUQbfZWSNMTXTQORXPNRPXjhQJQVYWSS__VPNOMRXWRVdcXWe_PTZZWffRNQQUUWhfSNNSabWW__WRQSSUUVQMVhdURVXRXYVSOV__PSXSRQROOQVXWWUWXaYVaebSLR_ZXXWXXYb_TMQVNPQKLSbgcUU_coi_dTKNPVfXOTTROMUUVWPSQPUUVUUZZSPUYXZ_ROX__dZRQRSNMWdaae_PNOVXSXUUVUUUVWTTdeQLVYZVRXX_XQUadXSUSWXUQKQSSSVYNQYcbYdWRQT_gjaXZYYVMJKPTXZTRSOQaaUVTSPQVUWVZd_aaRNSVUXdacZSUX_VPKORVWUQPVTWWSXXTQTffWUWXWRQTVaaVSSSRTYYRQUYdbXWUUbeWQONQSScgWOQUVSOXcYSSUZYYaYSNNNNTYZbXWZX__UQVURRRSPRTTSPRV_bZSSWYd_VWVW_YVTX__gcRPRNQZaUWYQRSWYZXWTKIHQZZZZVSROMSUTadZZ_aXQRZaXUPPSWXce_cWRTQXZZUU_YWSPUVTTSUXZ_ZcaTQQPRWXXUVTOJKNQTYfbVSSSSWQOfhebWWUSRRSW_POZWVWWSPT_YUZYZZW_VPUYQIO_fdZZUJIPSRWYZZZaWTYbYTTVZWVbQFOUSYWR_khZRJNYYXUQVWYcZTVXSOMQW_dbWSPLILQWYbeYXZccUTQVaRSQUYTQKMUVPSWWZWSWdeaVXbcbVYZW_UNKPW_ZTSYZVTSPKNPMWaUSRNS__dcY__aZUYZYTSVUUVVVWSOTWUTSSNL_fUQUTVXXUNZcTMMSUVeeUTWbeaYTQXabYSNNSPXbTRVUOLSaYVajhaXSXaUPOPORVUWUVTNQRRSYZWZYYb_WUUTVZZWTPRUZb_aZSNVYVWLPWUWVTQNSZVWdbZWXVQQZdVTVRSQUYTROOSRQ_XWa_cf_VcZONSUQRRUUVXWXVSNPaZT_c_YUUVQSYXUSUYZ_YQTa_XUWTXbRMXbQOXYVOKR_YU_daYWUTRWVQVSSTPMNUZbSPTVcaXTSQLQXZehdZYJFTXYYW_ZTVaXY_VXURVXUQQVWTTWZXQRVWXXXUVXYYSUSSZTNQRSV_ZbcUWZWVUTQTVSYXSQQQPRQYcVRORYdfVVYVYY__Z_aUMWaTOTYVPLSWXXTTbZTX_aVXbTJJQVa_WUYaUONTZigTUXQOSVQOSUZVOTZXQQTTXWTVUVRPNOUX__VRSZqm_XY_USLNdi_SMOUUQPUSTWTZda_ccYNLTTUWWURYWSVTTX_TIMVXYZWXbdVNONYdVWXWYaXOKKOQVWSV_aUTXWWTWZVVV_dcZ_XPRTONSYYbbc_PNONVZUUVWYdaQRWTVVWaXSPNUZZXUXVPNKPXSSabVTX__YcdYMLROMTZVVWVYccZYVRTZXVSSTWROTRYc_RUcXUYaUOV__ZUTWSLNV_fcSPRQQQPRWYUTWSQUUWVSYVW_ZbZUVSQXQQ__XSS_cUWZKFNVX_egaUSTaecVTUXXOMMQVSXbUQX_TSUYXUURNPV_febVVbZVVXUZgdYOIDJXUQTW_edUJENXWVYWPSTTZUPVaXUTSX_WTUZYUWXSUZWPQWZURTWYYZYSRVVZcaXUXceaWW_UNJLSYZ_XRQSSRNTaYWWTTbWQSMUUOXZOTZPPVTUUVfeYX_ZYYVVZcaNCLYfbURTXWaZNQXWUSV__dcXWQKNSQRWUQUaZUbfZQKKMSXZ_UYb_VONRVRUbZWUYge_XVURQSTUXSOVacXMNXaRQcfZPUWRSLKU_YSTVWaZUTYaUSWYaYWTMVbVPOQURQYWSTRMRVUX_ddYVXYZaZZWTVYaYTVYXTQMQZc_XUMOXZVTRSVRS_YUXTLRUWTPXYVWXXZW_ifYSQQSWTUWRSWUTUOPUSPSSQUVVWWXYbbZ_caYWWZc_SSUXSIIPVTVXXWVaaUOUceUMXdXOSbf_VQMTUXYVONUUUUTVXURUTTVWVUUQQSYbUXiiaVTVTUXTPRXQMVWURUVUYYQRdfSMVeWSXYWPHFPafaYe_TWYRKQYYQNUbcWTRSRTTQZca_ceeaUQSZeYMOSSQSWPKOY_QSXYcWRZVTWWWVTZd_VRRVdbVQMLR_bXOLT__YSMMQSUSQWWZWXcYVWaZehbTRWTOOPRSVWXc_WVUZVTQNTWXWTW_UTUMOWSMSegaUSSSUPOVafaZXWRIQab__XW_XXYXWRQZdbXZZPPRTQPSUOOTTacWVTRSOVZZbaWNOTPQRWeWPNOVY_aWWabbXWWVXWPMUUSRQPUbbXPRURUbdbeZPRXYVWZdfUSVTTOQPILUcZZ_WXYZWVURUTRVWVTSPLXfWS_WOOPYd_cc_YTOPPSZhgUOSSVaVSTWaTHJTYaUPSSVYYZTKNTVZeg_RRQPXYXYYY_UNRVXTSaf_SPPMPWdbYYXXUOS_dZWYTPUYWSRUONXecYb_WSUTORUWUOOQMRbgdPKSVSR_eca_XXXZaZaULNPQPQRUZUSNLOOUadcXWa_acaYVWZaZYaaXOKJOXVWVMKNVXbjeRJSYUQQXdZUUUUVXVOOSVVRU__XURVXXYWTPSZXRRUSSXWRbga__cXQUXVQMPYZRUZWSPTdbQMPVaebY__ONWXYRMXbZVSMHMUZYZZa_X_XUWYSMNNOSVUbgbZ__TVaXVRLIP__RKRUNNSVWTPYeZTXce_WYc_VZfdTKOVUOLKNW__abYZWQPPVcZLMXecTRTVVSRWbdaadXRRPSUUUX_XUWPOOOW_SNTZfe_XRSVVTRWQNSRZbXWTNLPVa___YTRSUXZXTTUURV_XZ_XWVRUUW_YTLQ___WWYWQQXVQLO_ab_PNWe_SRXZSUWWUUVadWOQcjgYOORPPTTSMJNXVNSeaVXYaaXSOTZXWWTPOX_TVXTSRWaVPSa_VUU__UONYdZTWaY_XQSUYYWQOUWXXXWTVYZZWLLSRRXXURUada__USXRLOTUTUUWVVYabbWVXWWWQSXROSUTVSQRSXVYbZaa_WTUXZSSUSPQWWXXUOFPYXacXTRR_bdcWTZYQOPQRUTSXXTSQTZVUXSKOWSSTYdfjkbSUVTaaZa_URSQPSVTPMLTXXZVX__YWVXZWZWSUTTXVTUTRSUUXSNTbaRWWYZNSZSMPW__YUXXUXWOEHTZVTWacXUZb_bXSVaZW_YTRTSPQRSWX_d_QOROSQNRVbgcVTUUQZb_gdXTPOQTWZWYVNQUVZVQVVTWWRPSWXSNLWYOXeYVTSSPUhjcbe_RRXZQOROGIRYSNYbcaYXVVZ_WWSSUVYURUb_XbebXVVVWaYSWYPIIMRTXe_RTWVRUVVSQSSTW_bXQQSUSWYRTWTabWRPVUWddY_cWQMNQW_XWRPXZXX_caXVSPOPVVccRORNNZ_ZbYTWUUVPQUVVVRRZZUPNTXVXYVX_edURVXTOPQRYYSSUZYVZULSbYW_ddbVRQSVSYdaUWabcVPNMWfZNPSS_YPLPUSSQRVURUaYRRTVSUXUWXYWSSWZceWLLPTZdhgaYWTVZXSRWWRQRRRTQIMTWdhfaXZa_TLOROPTUYbaWTTUUTWc_SPRVZZVUWWWXVSSRRTSPQPRUSVbie_dbRJLXdZXWXZUTTUUUTXZZcaWTVWTUSUYVTPRWYaVSUPKRYTRSLRXXSUZVWVRRTWXUSSZgbZaefWTZWTQKMSQQUZXQPQVccVWddWTW_YSSW_ZWXYXXNFNUQNTWXaebWQX_QV_WTROWbWVTSX__TLMXZUVVTVURRSUbbWXXVc_TaedZTIILQURUWUXYTOPUXSRTVbbVPU_UNOYaSScdYYdZSSWbYZfaXVSVTPONRbeZVVRRRSQJLTdnhTOUWSVXQRTQLNSZdXPIJUa_XVUVYbYVd_U_dZTRTbfcZVSSW_VSTURJLVURTWZWWYVRPScaQTVQLPWZTU_XTWTSZYXPOXaZ_ZQQXVMPagdWTOSdgXNV_TPTXYWZXPNRRNSWY__gbVVWZUWaZZXUTWXUTOTYVZVRSQNMMQYa_XUOHQZbbXSQUSUWONUX_ebURUXecUQWTNSXaUKJWaSVUQTZZWaca_bZQNMNXbbc_dWJOXcbbXNTUUZWTRPOSTSVTRWUOTVUYccaVPVc_QOPUZXYdcVPNPPPOOSYaUVdeWTUUWYdeVPYgaRRSWWNLMTYWOLSW_ZTRZbYZVQXaTUZZYRUcXVYUROJRaafj_TSQRTNMSWYTPRQQPLLTbb_bf_YadcTTW_e_TQMSaXOMQSQMNVXW_YTWUUYWSRVTPTagcZZWTXaTPTXYVWYWZaZYTPMPTX__ZUUXWTUXQUaVQSVSNKHNURSRT_ZTXddea_aXUQPYYPUZZVTTOTWUSPRTWZdgZ_cYPT_YSORW_bZPLPTRPWZVWbbWSRNQYbYSTRMNUWRUdhfaYedWROSUTVUPLNUYYZXPRTSTXaYSRUSSUYZVTWWVWYaWVYYWRPX_YaXQQROKQTTWXWTU_cXVadaUQRPPWXWYY_bdWLOQPXdaVXYOOTY_UPORTUXVXV_aVVSRQVdaUQTUUXYXSRWZ_UOOUcbYYWUY_VZfYQOROOacTNNORWZVTXWTSMMUXeeSOTUWccbTLOTZgfYU_fZONTWVQJMRT_YRR_fYORWXUTafcSPNNVTV_WYa_XVXWSNQVYaYTSXUNOKFOZabebUVZWSPTYWUVZa_Z__YWVUPOORWSRPRTOLVYVafgXUUTTQVWYdcaa_XXYWSSVVTOOQTTOSTRRUYa_RRWYVRQT_dbYUNMTWVYZ_hdPINRQU__WUXbeeaTQPOOQRRZfdWPSXUSVVTbi_UPKWeWMMLNOQafYSQNVcYXaefdWPNJQ_baWSTVXUPKMROOWdd_WVZXY__aYZ_XUPNXaROPPOLOWVUWXXWXVXZ_ZaYNNWYWWSSYaWU_cfXPPQQRWYUORXVTZdgfXOQUUURWfdUQNNSRQLHRVST_ebZXWUSXWSYYVXaa_YWWQNRVVVXUTXadXQTYZWUVZZQMSTSWXTNHNW_dfbWPRWTSTX_XXSOTSOMRXTRPVbceXKKRZfeXSUXWYYWZdbVROTfdXY_WTTWZRNTTUTSUVXWVWUTXbVUWQQRRVZZXWQLT_VUPMT_cVTYb_URLOTTV_XTWQORUaZTWYY_VUa_UXXTTUTUWTPVbaaXRV_bYTQRTSVWVOLNNVcdYTYc_beYTUVVNScZRKJNSSNOXhmdOMQSVZbVTUSSPSVSSXd_SOPVbcZceYRSQMJRcee_Y_ZTMPOUZZYZ_VSSWTOSTSOMONTYTVddRPaaTVgj_XTMQWZYTSVTTVTWWVWYZUUWY_YZbcXROPWZULBHQTVZa_b_QHPbdYTXVONSacUQWWUUV_dZTQLOWbZXRNTZaZYXVXYYUUWTYc_RTZXTPUYYVSUPMQUZbefZRNQRVZYUPNLSX_TLRSSX_ZaaaZSSTWXWVUVVXYYRQWSQSUWYWZaY_aaVTXWUa_PKLVaSIINUZVSORWSMPYbaYZbYXefbbaXRQPUZXZZUUSRTSVWZYQLNV__WVVWVUYXRNPVaYRPNQTPPTZabYUXZfhUJLRZbZWYXQNQVZVONU_ZXdbZZVSPQTYbZRPVd_RSRVWSXXUWYZXXUTQLQ_e_VXYVNLTQPSRWdaOPYYUORUZa_XOOSTSTUZabeaZYWYdaTTVVSKKPPSdkhdbZXTPPRWUNMOQQRST_aUSTTTYYTSRZfYT_dXSZdWNWaVRQPQRVVQRTNQWXVTTRWXST_bWW_eZVZac_WTQRWYYZUUY_ZUSTYXUTSUYXTSUTOIOaaSORVZVYcXTRRSNJKRcaRSTSXZVWXSQUWYacgidWWadcUOMQTSWYRNTadeXOOPSUXZZZRMLPXVNMPQUXUTSUabaYZdgcVSSWZWSUUQKMRTSOUcbWWTVZZ_X_YTTTTUSSVRPYZUYbaWSTUVXa_WUXWPVUS_YOQ__VU_aWPOYbVPTZYUQONNQSRSafdbaYTUXWVSRUSSV_icSOKIIOSW_fZNOU_XUTMHLTYVQXefeaTRUZXVZZZbedcXQUVTTUUVXZVPQSTPKGFKXhmjZZZZTMPTXYZ_cYPQRSVWUTROUXVRNQ_aWWZbhgZadYSSNHLUUPMRSNRVXaZSUWYcaTRXYWVXYaVNNOVcaQPTXXPQWVUTTTUdibWSUVRRRPUZ_aZVUXWWZaaZZ_XOMRQTQNUVUW_cbXSRSSUXZ_WTTTQNOQVWZZSUf_PTbda_cXOIKRTSOMOTZWXYXdldWTMLQRPXaWNKRSOOSYbZUVWXZQSfkbUUYbb_WVVQRUWURXdgdWRSPLPVUVXPNTVXSRYUOWYZcZTUZXWWYZRJKRYeeZQQRQXYUXZWQGM_efZTTRNQX_XUSSRYcXVXWXVOIOUXYY_USYaZQTXUSZbY_bYWRRULPWYZVWVRTWTUaYZVRRVaTLS_ZVUUZ_XTPNOTXZZceYTSXaaVMKMRWXddRMW_USUSRVVPUZVUW_ZUSYcaYbcYUPPOPTYaUQPLORQSVZabYUaZTRW_VVOMVSONMQYYVYbeaTOR_kjcbZUXXQPSYde_WSNNRRVYZYVPKLPPUZ_VRQRXVTZcZWVQTVVUbeVTV__URTWWVRUVPQUVYXUTQRW_ccZWRMT__UORWWSTVSSVYbfcSPVXNHMPSVZaXUVQRchebZWbcVUQOSV_ZSUVUOLLNNNRXaUWa_XVWWWW_eZSSRVW_aRJNVYb_XWYWPPVXUOQUVXaaXZYVWWWUQRWaUKNTZcZXWVTTTWZXY_WYbTNKOagcVTWXYUQPQSUZaddYSQSOMQURKMONSaaVSUWdeSNS_fjbQPSUTQRSZieWTWSMPUWWWSRSSUWYYYZaVSYYXROXejgbUX_XVQRUVVOPWXTPTVPQWRKRWaeZRMSUNKKNNQ_bY_YRPSSZe_VWckhWQNMRVY_ZVVVSUZYZdaYWUYb_ZZSOMNPPWZX_aUMPTX_ZWUWXWSNNQWXNMU_YTT_bVSSVXYYXUSZZRSWadaPGLVXSRWba_cbVQTXY_XRSUY_XVPIMTTSVWRTZ_ULLRSSX_aegdYVUVSPQSYZXZXTSPRYcdZTQPRVUXbbaZYQMTVVUVb_USUXSHIQSPMPTY_ZffZYXTRRW_RNYdZOJMTXWSTafdY_d_QQZacZTRSWac_SRVWQKMQQPKJTYUXYURRWVOQWWUVZZafgbXTOPVY__baa_VTWWXZYXTU_ZSQRKIRXTRUUUQTXTVaZVVUXaaWMLS_aURVdbUQMRac_RHGKTXWcifaUOQ_c_bcYOKQUSMOWWUQT_aYUNJOYfebbWQRVUW_VTUWcbXQNQRT_bbZWXVUTXYVTPOPRZdYTQTTSXXQKQUPNPY_WRPUZcbXZcXTTTSWdba_VSNOVWROUZbbZXXY_YUWVOWcYWZSGIRPRYZZUVb_XVTTXXTQNMPQNPQSXafhcZTMNQSWUTTYikhfZWWVUUUWVRUWSSY_YONWXZecROQSRPSQKNSZ_XYWUQPRUWWX_aXVVPLPVadaVUONUYdfaRNX_WXVUVXWUUUQKNUYXVZZYaaWYcYSUWbaSTQMRZZWTRVZWRPS_dXNMQYVMRXWRPScfYVYaaZVQRY_YSMMQUYVUUSSRQUeiaWYXTTTVUTQQVWURSXXXZZTQSWYZa_Y_WRVSQRUXTUXXYVXZXURQPUZY_XVZ_RNPQPQVZZYUXbTOONQTUV_bbdWQTTMJKMRYhmjbZ_abZTSVTTSMMOLPTVafdcaUSSXWTQPVce_VUXWROEBNVYdiaTWbfZWaXNLVYTUWVSSTQOPTXWTWUPVaaYURQOS_ebWZ_URSVZYRUYTRWXUXZWXTOU__XbeXTSTUSOLPSW_de_UTTVSHINVhgXRXb_ZVRUXYXRPRSXWRPNLOWZZYZbccefXPONRY_XSPTVNMTUPWaYSRUSXZYYUUYZYad_a_SRUXWVWRNLSYTQPRSTVNKTYVTVZWTWaeda_bZVVXbaW_YQOUXVTXVUZWNMSWUTWZVQPPPSRPNOXZTTX_ZZhleYTTWVRTXVVURQNOSVVZcY_ZPNVdd_YQMSWZVOOUXXTRWZYRMPUYZWUUTRWXUVWacb_XWUQU__bcXRRPLQSPQTWWWVUXZ_aXTPNQZ_SSZcaRMQSTV_bWVYYYUOS_VPOQSWZSQYbYUXZVTTTTXeibROTVWWWUSVSPUZbcaaZSPNRcdPHHNXaZSKNPQXZTOOWbYWZZaaXZa_YVYZPEJUZZXXZccXVVUVbdeeUMKQ_ZRLLOQUVUYfcSRTSSRPOPVaa_YVQQSVYZ__YXWRPPPYedWNPYZVUPMPUYXY_ecZXRSVXYQPTVWSUXUUYWQSVUUSTRWec_Z_VRVWSTWYZYVQPSSRSRPOTYVRQVWXc_UWXXVVafbRPW_VQUSHK_ZTTX__VPRalgVTWWVWSPQSSRSRPSZcaXbbXXVVcZRSUWWROMLQRPPSVUYYUXXVXZXUWWUUVVUWYXQIIQacUQUUSUYaacdZXXUV_TLSU_dYVY_XaaSPUWVQJKMOPOORUSPUegdXSXb_fjdVVccYTSRJJYdVPOWaXQMR_ebUQVYWTUWRHDKSXbbddZSSUXcZVWSOTTPMKKPWUQQSZcbcbWSTYZ_aaZXbeZXXZZXWWRNOPQLNZdZYaYSPOQVZ_WRORWTRRTXWWZbaXUQQTTVZVPOVbYV_WTVVWYUSWZUQUWZZTMJQW_bkoaOMQTWYZYXYSLOQOSVYegcQIJNTZ_USTWYVPJOUSOQcjjhcYUUUW_baYVROOSTZ_VTNOVYYYUSSRSYYYcZPIHLOOR_aYacZahdWVYWQPUYceYSOMPNQVUZdYTVWXWONUTNLOTWVUXWXcbXRVgfUPUWZXRTWXWVVURNQYZSRYbbWQOPQTZccaZVSVYWVQLSVOLSXVTVVUXXXbcXTVWTVZ_TPUZWSWbgeYPQWURORUTVX_aUQUXVXXSQOV__abYNHNTST___YTSQRTZeWLMRWabWPSUTSTYWUTUVUTXcbXVbgb__WTPMNNNT_gkbSRMJPXYSOQVWVVXZeeYWWUQQRSRTVRRUSOMPZebVWYZ_WZ___UVbgeWSVYWSLNRJIUbbbZ_baYWYXSSVSOPXXTSRSUSLEHQZ_YYURSTRSVX_YWVTRVZ_fe_ZXZaVRTX_XTWYWUUZZVRNQSWcaVRT_cZPJKQXUNOU_aZXY_WRSSNNVcdaUUWVUYbYRXcVRUONUUSRPSWac__caURSRTRNVZVRQSYdaTTZXTXcaUVVTPTWSRPSUUVZbWSTUSOOWegaabUNPPKPYYSNNWgkcUTTRMMSZ_ZVUZWUURNQcgfcTPWZZYWUSSUVVWWUQORSTSVXV_caaWMKRUUVWXVVYWPPVaffdZWWSKKOTRNQTTSVXUOOUceYUYaYRPTROQYgdcgdTOUZ_YVRQVadZXccTRYZTQQPUXRLJOWZYXXUUTUVSXYZZXZ_bXSRQU_UIIQTXZVOMR_ZTXZVUQOTWYUQTZ_ZcbWYXUPLQZc_WWVNHMWba_b__dcYXXTQNOXc_WVTVaZRMPZheVRSTUTUTUXSTXYUOOUTOMPROQVYbffcVNLOUYYdeWWWTUVXYSPNMPYbYURXabcZVUUURSU_ii_SKLV_XXWQOVYXVWZZVQOMMU_ffaYQPSQNPUVb_RQTXZTOMRZYVVcgWQ_faVY_UKINRVSOVXUTTTUVYedbZTWY_fh_RMKORVUSRRTSSSNOSWbdbXYbefZOGLSQQXfgbXUNJPWYZWTQOMNWbbYPPTZa_WUXWVUVcba_SPPTbaSWdbTMNYc_XRPSTX_VZaXTPQTTXZSQVWYXRQTUWWURRTROS_YRUZVRWVSX_WWabWOSb_VUUVTPVaYVZbXOLNRSSTVWcljZTQRUUTXXXVYZXTRNLQVZVOLMV_ZXRRSTXZVSWbgfYSWccYQNRYddZTPPQNMTYWTSNOVVXWPPUXegWSYa_WROPVXSSWZZbeee_ROWa_WSPNNPUVVSORVXUPOSZaUOMQVZc_VRSVWUSRUZYTT_daaYXZ__WWWVYWSQRVWSPOPTZb_beaYVSQRUVZ_VTVRKFKTTQSUWXXYaln_NKMSXXZbaYPLPSRRUTTYcaW_eZRVZXcbUPPVZXUX_VOLNPSTSUWUTTZ_VUWTRSUZXRRQSaeZVURTUTVUTSRUXYXSQUVYabacgd_WTXceVMLPURSUUUXVSW_aYXW_XKINOMRUSSQSYXVZeeZUOR_cdgheXLDLXbebYVUQLPQOSQNQRSWXWXYWQOTaeYSUV_d_UWYVQQTWUPOLKKMOWdb___cdbbdefbYWPOTQJMTXXVTUTQRWaZZbedbbVPRVRMTbZRTYUSRNLOURUbc_aecWNHGELVWSVdhaQOQOSXXYYZ_YWPIFNaeYRXbZYXabXYccWQSaeaWUXTJMWXSMNSTVWZbYUVVUPNSYWPOVabcbVOOXdaUSYffbZXQPWUNGJTVUVUKESabebUQXedYXaWQONMSVSWdaUUVXVROOQSZVRZaQNQYjjcWRRQQVYba_a_XUZYSOTYRLLNTVRTXXbXPQUYZWSVddVTVPNTXbfd_ZTRZbZWTTSOORY_PDDHNWZabcfcVRTZZSLJRWRQXYWYYZYWXa__c_VWXSPPSTTXYWURSWWVdhbZXSTVUTRNOUUSSSSVbbVQRTOJOVWWTSVVWbdYVVUX_YTRSYebVUXVUWSNKOXdeZVXYV_cVRYbbaaaSLOPOPVWQLJNPQUVWYWV_dZTVYXSTXWNNTWaaWYege_UPOQTUXbcXQPOOROSaZTLMUZaYW_daUYdc_XWURWVQRUSPNOOQTTUYYSNPWWVWVTOSYbd_ZaYXYacaaXQOPPTVXZSMQY_TNQZigYVUSSV_ZVUWXWWQOQNMQVUW_YTUabWZgedYSUWWQPTSOMSQPRSXXWWTQPPSY_a_YWVTXaccUNJOXb_TOPXc_TOTWWUVaYTSXaZVTSQSWYYWUVWRNMRWVPOWcebUQXecXSSVWWSOPahaXXWUTYaYXeeWSOLLKOSWWUTVYWTQRXXQNRTXa_X_eheXTOLLLOVZZXYZYWQNTZYYXQNPTY_WRPOWZUV_ba_X_cZ_cZQMQTVUQONQUVUWaYVaeZSPSVUWZ_YQMNRQORTV_cdeZUXgfXTOOOKMQRVZXVWXXVVVUXaaXSQUXZZTLLQWaXYcb_ZTMJLT_dcUOSXYZ_URSRQTVRRWce_YXX_cWTWXbcZWSOPQUXTQOOPOTUVTRRTXYacbXSV_daRQQOPTWWZa_XSPTXURQPRUYXWVSQOOVcedeeZWUQPRPMQV_eeaYUUWYXUVWYccaXQLKNPSWYYXTONQQPPOOTZbebXZYYXUTSVTUXX_c_VTRONSY_ZZWPPUVUUYaZWURPTYWWY_XWWQNNUWWaaZZ_a_acZSPRSUUQNQVVNLSUV__ZXX_XVX_XRRUVROOT__YXSNOTTVVZZRRW_didVNKRYZZXVVTVXYUPPPQWcaYYTOSWYa_WVTQRVZXVW__VNKMSWWVSUacWQNOUZZWY_YVTV_b_YUSSSUSQRSUYYRLPUVUTYdda_ZYXSRVZaXUYgcVURQQQQSSWZTOSYYVW__WVWOHLQQRVZ_YXYVSSTTWZa_WVUPTXWTRQRVZ_b_abXROPRQRVbgaWYXTUVVVUTZZUPOTWTPSZc_YbcYUTRTWWVSQPTTTSPUURRSUWUQRVXYZZY__aaTMOVVSW_ZRNVZaZXbeZUYZTTVUTPLNUdfYSRPQUXZZZUVXSTZd_RLLPPSVY__ULJKLQYflmk_UXVVWUQLPVUVbcaYROQWWPOUZ_WQQTTSVYURYccdcaWRQSWbaURQQRSSUW_VNNQU_ZWVUTRSSRUWYXPMUYYbee_VUXZYXWTTZcZUTTW_XRNLQWXZYVRPMMTXXTTWYcaXWYbaVUWVTTWaZTQPQTUUVXVQPPKLRYbabbYYVSW_a_YVPPSTSNJNTY_XZaZXRLPWYXZdcVSVTPQQUVSVZ_bedaWSSTXZUUXUTWYYURRSTTUSRSWYVSWbabca_YSNNROHHR_ZWTWaTLNSWZ_XXWTRQUacbc_WWTPRZcXPORRPSSUXTUY__Z_aVRWYUUXZZZ_bbb_RLMMMQXWSSQRUTTX_bbYVVbdTPTYYTRRQRTSPQPKNUXZ_ZYZZYWUTRSWYWSWade_UPOTbdYTTUWYVVWUSUXXXUWZXUZbZXUTQJKRSRV__YXVTRTRKKQWVSUZaYVSQYc_WRPOUdeaZaYSSVYZ_XTUURSWXXUUVUXaYTVWTRSWY__YVSTXXUVWXUSTVWQLPXYSRUUVaaUOMRYXUVWYYTRUYZXXWVZc_VROQVXTLOXc_YZWTUYYURQTTTUTVbeebWTQONMOVYTPORVXWWZbZSQPSaedcbZYXUVVRPSXa_WTTUZ_RRZ_VTXXVSSSQNMRXXUPSYa_VTTTTSRQRX__YWWVWYZXUQNR_c_WRPTWVTSWaYVYaZRQT_gdWPPVY_ZUPMNRRPPUWWTQTTSVac_WZb_UUZZXZYSUVUWVTTTTUQQVYYWUUVTQSVTPRYcbYXadbZWUTTWVUZaWQLLQZaWRNNRYZWWXXUUUVVSPOSVVVZXTQQQQUbigb_ZVSRTXWRPRRPORWbbWQQXeeaZXYaaXSNMLKPTUXbbYTOQWXXZ_a___ZZZZYUSTSOMOORVXWXWQRVWZ_YWVSSVVVWVUXWTSTYa_VSTVUVUQOPRSTVXYUPOSX_aabaVTZb_ZXTSUSSSSTSVXUQOSXYYZYY_XTVWUSQPOOORY_ZY_cgeYVUUWXXVQSVXXWUVZ_XQOSRRSUTSTUUUVXXWVUW__WRQSTTVVVVVVVWXXVSSX_YUWVTSSUXWUYbaWQQSTWVRQSVWVSQUbbXXXWXWXXWWUUTSVWWXVRQRTYbaWTTVZ_YVTROPSTRRWZXUUTTUXaaYWY_aYSQPOQWabZWUUVSPRVZa___XTOIIMSTSXYUSOPTYXWWZbbcd_ZYSPORUWYZYVUWYYXVVXWTRTX__WTUUTRRUTSRPTWWXYWVVVVVSTUQNSXZaZWYZYUQSZdc_WSQPQSVWWXUPORVYXVUUWWZaZXUSTVWWVXZWTRQSVWYXSQSUX_bbWRUVTUXXXWVYZUPNPTVUTRSUUTSUWXYYWRPW_XTV__XUTSUWUVYYXYYVTSRTXWSSUVXXXbbVTWZYWWVTQQTWWTQTZaZYbaTQSVSTURSUTUUWYWTTTUZaXRQQRTUXaaWUSTUUSRSUWWVVXWWWROQX_YYYZXYZYXZZWURTYYVRTUSROQTURPV__WUWYZ__ZaaYVSTUTVVTRSVXUPOSWYXXYWRRVZXUUWTQQSSUVVWYXWUVXXXZZXUVVVWYYVX_XUTTXXVWVTTSRSTSRSVVVYZZXTQQQRSW__WSTXZYWVVWXWSSVUSSSRTUTTV_d_ZaZUQSVVWZ_WUVXVTVWVTSTVXYYWTSRSTSRUXWVTUURRUY__YWVVWWVUVVUWWVWUSUWXVTSQSUUVXY__XWWVSRVXVWTSTUXacZWVUTTTTSTVZZVPPRUVVYYXWVVWXWUVXXUUWUSTXYXTRTVWXWWWWZ_XTQQSTTSVYXYZTORVVUUVWXXZYXWTQOMPVZZXWVVWWWWXXXVTVXYYXVURRRRUWUVWVUUWXWXWUVWVUTWZZWSTUTVY_ZXVSRTWVTW_ZXVTSUWVSRUVVWXTPRSSTUUWWUQRUWWYa_ZYWWXXXZZZXTRTVXWSRTTTVVTSSTVWXYXSPTXWVWWTUWXVSRSVWVUVW_bZYWTTWYYXXZXTSUVWUSTUWXWVUVWVTSSSSUUSSUWXYXVSRSVXYYXYZXWWWVUSRTWXVUUTUVWVSUWVUTTTSSSUXXWVUSTWZb_WVVVWWYYXXXUSSSTWXYWTSW_ZYXWTSUUUV_bXTTWWSRQQQRRQQRSUWXYYYXXWXVTUVVXYWVTTUWXWUVXXUSUWXWVXWUVVVWXWUUWYYYYXWWUSSVUSTWXWWVSQSVWWVVUUUTTUUUVVVWVUVWVTUWXXWVVWXXXWVTSTSTVWXWWZYWX__XURSVYXVUSTXXURSVVTUVWXWUSRRSUUUVVVWXWVVVVVVVWXZZZZYWWVVVTQRTVVVUSSVWWWWXWTTTUWYWVTTTUUUUVWWVVWYYXWUUWVSRUWXXYXWVTUUVWVVVUTUXXWVUSSUWWVUSRUYXWVWXVUTSUWWTTVZ_XTSTVXWUUXYWWWVUTVUTUVVWYYWVVUTSRTVWWWXYXUSSSTTUXYYXWWWWWWWWXWUSSUUVUTSTUVUUWVVWXWWVVWXXYZXTRQRUUTVVUUVVVVUUUVYbbXUUXYWWVUTTTRTVUSSUVXVUWXYXWWVVXYYXVUUUVUUWZYVUTSSTUVUSSSTUUUVXXXUSQRVZabbYWTRQQRSUWXXWVXWWVUUTTVXYYXVVUWXWUUVUUWWWWWVTUWWVUUUVVVUSRSTVXWUTTUXXVUVVXYXWWVWXXVVWWXYXVTSSTSSUVXWVUTTUWXYXVWVVXXWWWUTSTVUVXXUSRQRUWXVUVVWXWVTUWXYYXWVVUTTUVWWUUWXXYYXWVUTUUTVWXWUUUUUWXWWWXWVUUTTUWXWUTSTVVVUUWWWVUVWVUUUVVWWXYYVUUVVVWWVUUTUWWVVUUVXWVVTTUTTTVXYXVVWWVVVWXXXWVVVWWWVVUTSTVVVWWVUUUVVVVVWXXXWWUUUUUWVUUVVVVWVUUWVUTTUVVUVVVVUSSSTUWYYXXXXXWWWWVVWWWVVVVTTVWVVWXWVTSTVWVTUVVVVVWWXWVVVVWWVUUUVWXXWWWWVUTTUTUWWVUUVVWVUSTVWWWWVUVWXWVWVVVVVUTTTVWVVWXXWXXVVUTTVVUTUVVVVVVWVUVXXXWVUUWWVVXYXVUUVWVVWXXVUUTTUVVUTTUVVVVUTUVUUWXXXYXVVVWWUSRRUVUUVVVWWWWWXXVUUWXXWUUVVUUVVVUUVVUVWWWUVVVVWWVVWWVUUVWVVVVUUVWVVWWXWUUUVVVVUUUUVWWVUVVVUUVUUUVWVUVWXXWVVVVVWWWWVVVVVVUUUVVWVVUUVVVVWWWVVVWWUUVXXVUTTTTUUUVUUUVWVVWWXXWVUVWVVVUUUVVVVWWVVVWWWUTTUVVVWWVVVVWXWWWWWWWWVUUVVUTUUVWWWWWWWVVVUVVVVVVUUUUVVVUTTUUUUVWWWXXVUUVWWVVVWVVVVUUUVWVVVWWXWVUUVVUVVVVWWWWUTTUVVUUVWXXWWWWWVUUVWWVUUUUVVWWVUVVWWWWVVVVUUUUUVVVUUUVVVVVVVVVVVVWWWVVUUVVUUVWWVUUVWWWWVVVWVVUUUUUUVVUUVWXWWWWWVUUUUUVVVUVVVVVWVVVWVUVVVVVVVVVWWVVVVVVVUVVVVWWWVVVVVVVWWVUUUUUUVVWWWVVVWVUVWWVVVVVVUUVWWWVUUVWVVVWWVUVVWWWWVVUUUVVVVVVWWVVVVUTTUVWXWVVVVWVVVUVVWWVVVVVUUUUVWWVVVVVVVWWVWVVVWWVVVVVVVVVVVVVUUVUUUUUUVVWWVVVVVVVVUUUVVWWVVVWVVVVVWWWWWWVWWVVUUVVWWWWVVVVVUUUUUUVVVVVUVVVVVWWWWVVVVVVUUUVVVUUVVVUUVVVWWWWVVVUVVVVVUVVVVVWWWWWWWWWVVWVVVVVVVVVUUVVVVVVUUVVVVVVVVVVVUVVVVVVVVVVVVVUUUUVVWWWVVVVVVVVUVVWWVVVWVVVVVVVVVVUUVVVVVVVVVWWVVVVVVVVWWWWVVVVVVVVVVVVVVVVVVVVVVVVVVUUUUUVVVVVVVVVVVVWVVVVVVUVVWWVVVVUUUUUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVUUUVVVVVVVVVVVVVVVVVWVVUUUVVVVVVVWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVWWVVVUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
      rd: 'XwhURMMD_WXWJMVZdTHSXcUQUdgZNdhRVVXUWSRUVTUULcmUPfPBYbcMLVTcOOWRaWXbSONTdhaY_bTWRGUTWdQPPUdUTYWJU_NXQNabfgZPMQLOYZXlc_XNaUPOROaVLaVMScSR_WNaZXlTSYUWWNMURZcebZTQPSbTUVTSURagONQTURbYLVYVYRRPSVYfVUWXYVaVRVWbRK_ibOOPWfXNLRRTbTUfTPXSZ_QYYRUa_cbGGOUYXZPOWbhYQ_WSdSJQNY_V_XUaSMQMWafdfZOQPZVVZZXRUXURVQTcUSTOMPSXXaaaZVWPLYcTYVXYO_g_YONPYXRTRdYQQLSXVUUYVWaPVWZ_RWR_cZYMJZcXdSSQSgPINSdYNIV_UXWYbdXUWSUVVWPTYVRUeaQQedUYRWYTRKRNYgWNPZTQPRWabYSUUPYZTbfWT_eTVU_XOVT_RVRITMLUUU_fbWbUVYUPNQQZdYS_bcWQRSWYWTZWMMRVaURYWYPLTVaXV_VMSZWZfYQWZ_XXUYTQRVYOgVKOPVU_VeZUTJSXVUaSQXTbdaTPXXXXSSZYOUXSVOXc_UWWLQRTcUMWWTUYURUShhXYTWTOSQVXabTYVQSRQXbSLPYXbhTMPYdWROTU_cYRQWUTXZRYXSXTSYXXYVORU_aPRRVTUSS_aYT_ZcWQVSTVYSVX_ZUVUWSTUUQQPTWVRW_TXZeZPRRVXRVURcU_gVUQRc_SUYYQUURUSPPWZXUXTQXZYTWYVPYUS_ZcXRPVZWUTVVWRQSRSYcXWLQYYYOWZVRRUchXWTTRVaZXPccYXJPUUSOXVRWSWVTZYPP_ZYPSWWaabUUTUZXYTTcYQWWRPNTYTRca_bUNKSSSRRZedXQPYYYUWbVNSZXaXQY_TQTXRPOZXScUPMQZZWTWSSibVcTVUTLNZXZRVXV_WUQYYSSX_PONUXU_bRQXVcaWUVSY_SVQSYaXSUXYTVUU_UUSUaWOHTYaVTUVZQZXUaUQRWYWbVU_SZXQTWYXSUVRTVRWON_cbVVSSXVYVQZTTVVZXbXWPOSbaRWUUUPSVQRTWTVYU__ZaXRUTQSSZcXWUTZX_VQZXTVVPOSSXUV_aXPSWTTSXgVPWUTSXbg_NRPPWSXbYVTSNWWVUY_XVNWXSTXTTVW_TUXZXSVZVZcWXTUVXYQOMO_YOT_bXPNQUabQSWTXUWVUY_aXZSUWXTQZVRWaWNQZfSRWQQQOSWSbZT_WTTWb_WSRe_QUZWSPSYWTVTSYYRTXUNPX_YWWVVSabUTXZVTSZRORWaVZYWYYVMTWRSXWOVVXZVYTMTWWWTXYZWZUR__TRUUXX_YYWNQUXUUWRJMadZXaWOPURQcXRcW_XWdVQTRQWUXYbUSSRVWYPPWXTTXZaXVSPPYbWWXRWaXaUQTTUQWcUQVRQSTXbTTdWPWZWSTQVYSSNYehdRVVRSTVZZSLTcaUTTQ_XRNRZSYVTVQNRWWfgZVSaYUWQPUYWYZYXWUUNRXTWRUXWSMRZYTTXWWWPTZceaWWZOJVXTUZVVbaXOTZQKOUVRQV_TYeYVUaXQUcaPVUVWSUPZYVWTaXW_UWSTRMPQYXTXZQT_RUVXZVXXUUUTU_c_WVVVVSQNW_YXOMORRRXYYdYYbUXXWXWVUWSUWVWUUbVOQPSTX_WTSTSTZYX_XYURSUWYYXUSQT__UXYTYZXQOXXVZRMXXSPSVYeWRRROQ_WYWRXceWOWYYYWWUWUUNMVUURSVWVX__WPXZURLWYY_TSYXUXWaZSRXUSYYURRWTUZRUXWWUVTRUXWTUXYSUbUcfWNJSTbaZWSWTXSQXcXPTTWXSVWVTRRRSW_VTaeaYZXSPUTQVYd_WPTZOOV_YVPOVXTSWXVTUUWUZZV_ZRNWcYTTZTTaTYYQVUR_bWQSTPSYVVOSZTZXVYYSV_TNTWUfbWVUZVRRWRSZUVVSYVNUPOW_TXgWQYZPZZTTTZZXXVUXWUUZRLRXWQSUVYYWPRYZY_ZSS_YVTSVYSTYV_VabRTSUTQSYUPXVVWWYRQXXTQT_TRTZbYRTWTdX_eXUQVPPWVVXUPWZSUSTVSTRXaUSZXTXaYaXQUUXZVTWVSPRSS_VY_WTUTRYURRW_UTWXVdbVVPPVXZdbYSMPTTbYPMOXXa_VVXZSSMOXSSYcaWTXZVRWZTVWTTb_RSQVX_XSXWPKTXUUU_VTVXaWNMW_ZaWZYSWSVRWaXcXQOPRTXWXZVPUTSYTUWRT_ZWZXZWVTPOTcYTUV___XTVUXSRSTXSUTPTYZ_YPUXOQ_bXRTY_aU__UQTZYTPRQVXeaRPNQSTUX_ZUYTQXXOSXT_XWYZWZaXVSTOZZWTQUQSWYTWXTRPTWXQWZaVNWVZZUVWWWSXabZMLTVVbZRUUPWZXXQUVPUVSRTYVZ__cXUWaSSVSVU_ZSMSYTSUVYZSTTOTaZQRTXbZTRQafZXVZVPVZVTTVWSVWSQWSRYXaWPRXYSRWYSVUX_RUWWXYYVXSQ_aQUVVZVWQSYUSOSXPQSVbbTXdTVXVVTSYZYZWUVZTWVTSQWRPXWQVUUTRWVSYeXQSbVRaYYXYVRRWYSZZZVUTOZVVWQQXURTUWYYTYSQXWTVVWbVSUSVZbUVWSWUXRUYRWaXPRTRYTQaSVcXQQTRUVZYfgUWVRVSWZTYVTWTLUYTRNWUXZUYYZTSPPYTZYTZZaYXWSYWSTTUXURWXUYYQOSUYUZVVYSSMQYXWb_UWZVXWTTTYX_ZUVURWTNT_XTTRVYTRQVZSOPah_XXPVcYXTWUOTWXVZ_UTWRRRSWUTTUYXVTPTVa_TU_aXXWXTRVTWYQVYZbVTVVTTUOPYUNSWXYXTRVYZZURWUW_VQS_YUXW__UZSTTOTYYTURUVQRV_WWSQZXUVWQWbUTWUYcaZTURQUTSVVQQSXSUaYUXbUYWQTTWZVQXXWaSWXXXPXZSSWWUYWUXQOPOSgcZWMVUTX_YVWPQYZXXSVYVZYSVURSVYSTUSQVVUZYVTYWQRVUTUSZbaWWVUdaTWaVPOOQSZZQRY_WVUVUSTTQTYWVYXUWWXWVSXaWY_YTTNNWZWRYUWZUWSOSYYQNSWVUYa_WXXVVVYVNWaSSUXZTSacSUQTVQTSXWbRDOUd_RVYbYXWVTUWbZWZWURRUTYdWRPRVTQRaTSVMOXcZVXXVUVa_VUXUUVX_XQNWSUXYZVXXVMPSTYWQSZgZRVUTSTTYVUUQXaYUXfgYLMVWUWWQSXVRRWTQSWbUPV_bYTXRPWZY_aXZWQOTVSUVXYWTNTWUWVXWRRYaYXTUXXbPNWSSYcWTaXSWVTTVSRUUTTSUWXZYaTSVSPQYYZ_WYXTWWTUWZYVTRSVWVUTTVWVRW_VXTMQU_bWPUXRX_ZSQYb_VWUSUWVUUTVWZXTQRUUXSSXVWWSUUX_WVWYWTQUcYQPXWWYYXVVVWTTQRSTSSWYYUUYWPTUXaVXXZZUVVWYXTQVZcXOSTYVQQQWVRPWZUTXZZXWXUSUWTX_a_RSWWUYYUNUZRQLUbWTXVUTQZZVSXZSRYWVeTNRWW__WZVYZUUTYYTROQUTQSZXWUXcRKRZYSRVWYcbaTWaVYZUQRSQUYXQTVQUUX_SVTSVSVVV_UUTXYPYZ_baZQQVWVUTXWSQQTVUTX_YVUVUVUSTVTXcZYXUSUYRPZ_VVRRYfZPQSWTZUQUSRVYVTQSYYYXaaWYTTUXbTRSSYWTUVWTWUQXTSVXXRUWSYYORTVZ_aZYXWSPRXXVSPWaYVYXUUTQSWUVVVXWVVWQNSWZbcXTUWXXTPUVX_VRVYXURRTVTSTUYWSUVVTW_YWWXVTYZVVVWVTOUbZXZWUVTSRQWURVRVWVXVXYXTQQTWUXaZYUVXXYQTcYXXRTUTSPSbXTTTWRVWUWXTQSWWX_YVUWSYXR__XXURYYTWSRUUVVQV_WUVRRSSTRVXZ_W_ZWZVQVaYWUTUSWTSURXXUUUVVXWVSUTOQW_YacXUTUUYWXYTSTVVWUVWVWVQT_YVTTQRSRSWZWUXXVV_YVRT_XZWUVTXYWTUWSMRXWXVWYSPTSSRVWUbcXWZYYXXURTUTWXYXRTUWWVSOTVVUTTTYYTWZWWVSaeUQROQOVcZZYVXVUUSWWVXXTQVVTTRTUUTWZYa_ZUQTRWXSUXXWWYa_UURSUXVQSTVWVUTSVTUVVXYXTWWPQZ__ZSWZXWYZSSWTRSRSTX_UQRX_XWVUTSTUVZZURTaaVWXUUTSZWVVTWWWSSTWZUQWZXVVZWPOUYXSRUXb_WWXXWTTTUXUSVZUWTRXWYWSQTXYWRTXVSTVVWZZbZVYVUWWXRRPVXSaYURSUUYZTNSZXSQQUZZXWWSQWZ_eVTYWVPQ_aTSSVWWZVONRWXVUTSUXaY_aWUTTVVWWVXVTQPUZbaZYXTQOSYUSSTUXVRRVYWZZ_YTSRVYXSXecZSOPTYYUXYSSUTVSSWWQPSTWW_c_VQPXYUXVWUUbZUVUTWYTRSUXVRX_RRURQTU_aVVZZPRXRTYbcZWZXTQSVSTWWYVRUTQSUWVXXTTVYXVWVTUWXVUWTWXXbZVSQQWXTUUVXYUTUSTQYYVXWVRUSSZXXXTWaVUaWVUUWVVWXSSTRTUVXUSVWVWVRSXYWWZZWTTVWVUZcWNORTW_XUWVXXSUZUVZURPOUYXUWXYVUY_ZVTPT_WVXYYWVTVVUVTROPUXYZVRQTVYYXXSTZ_XTVWTUWWTVUXZWXUYYUTSSPQQWbYSTTUYXTSSTXWVVYbZYXUVUWSSXWVTXXUTSTSUUWWXWSVUVVVUV__XQTWUY_WUWX_YUQSVVVSLRXSWXWUUXUTUYVXZVRTZXYTWaYYXTPRVXWVVVSQUWUUVWUSVUUUTVVTTWZXWYXVVYWXWVYVX_WSTRSTSVUTXYXXXUORTRWTQTY__XVZaWRVWTUXYSVTUZVQTRUbYVSSVXUVVOTZVSVWZcYTVTUXWWXYVUVSVYUSTVWTTWWVPOUTVVTTWYYaZaXUURSWXXXTTWWYWTTVbYSQSUTTXYVTQUTUXXYYYUSVWVTWXUWVUWWaaVRURQTVTQUYWUWWYURWURU__URTUVaZTUWXYY_YVTTVVSQTSU_TRWVRRVUWZYWXYXWTSRWXX_WWTUXUXVX_USRSSTWSRUTWa_WVWUSUWVSSXUYYUXZaUSUWXVTUUTPRZXTTXXUSUXWUWRQU__QT_aXWWVUWZXXVWWVTQTSVYXSRWYTQSWWSVVTTWXXXQWcYWXUWaZWSOSXTQTUYaYUTTSRVVUYXUTUXWXXWRT_WTXUUXVUXZUUWTTXVTUTWWVWRRWVSSSTVWVYaXRW_ZXWYVSQTY_VUSRXWWWURTURTUVWZSRVUX__WVWXUSUVWXZXTRXWSVXXXUTUUWTSSTTVTT_aXSSUTYZWSSVY_WW_VVWVXXVSQTXUPRYYUUTRTWVXYYaXTRPUWUWWXWVZYWVUWXVRUWXTVYTSVTSVSUVTTUXWWUSSUVWaba_UUWUSUXXVVTQUWSSVXVTVUWVRVbYRQRTYYTVZaWWWWYUUVVWVUTVWVSVURUYWQQVVSTUXXUV_YW_YVWZTUWUVVUSTWVVUTWWVWTQSUUWWTUXUTWSV_XXY_YWVTRSWYUTWXUSVUXUSWYVRSVWTTTVWVSTZb_UUbaYUPRXXVRQXZXUXXURNRSRSWZVYXTUWXXXVUTVYWYZZTPVWXTVWW_XWTRVTQTUNQYWUVVVYZV_ZWTOTXYYWUTWXVVZ_UPSWUSTTSUYWUTSRWWUY_YYVSQUUTVWaaYWWXTSVXYYTTTQRUUVWTTRW_WSRWUUYXXUSWaaYXQQUWVXYTVYTTWVUUVUUVUUTVYYSOUZXVSPVZZZXYXURVXWY_aXTQQSXVQTTUVUTVUSTTZZWRSTUYYYYaZUVVTTSTWXY_ZWSPRTTWXTTWVSQTXXXXUVVTUYZYWWVVUUTVYXWPRUXXUYXUTXURSVVSUYYVVVWY_YTRSTUVY_VYb_WUTRSVTRTUWUTVUWTPRY_ZWVWVXWVTVWVWZbYVSSWZVRSSRUVQTVWYTQUWUWXWWXXYVUVSVWXZXVTWWWWUUTUURQTXXZXTTURTWVXWWWUTV_XUUVUXc_WXWTSRVVSVVVTRVYWWVURQTVYYVUTWWY_USWZ_Z_WQTWXXVTOOSTUVWVXXWUTQSYXVTUXYbZWXWVRSTUWa_USTVVSRUUWZYVSTYWQQVUQTUTSTWcbVUX_XUVVUVXXVWXWTUXTWXSQPXWQRSWXYVWWUXWYUTVUWXVWXTQWZZ_VVXUTRTYWTSSUVQSVTVZZVW_ZWWWUTRSRRY_WYZXTTWUYWRRTVTUTSSWXUUWXWWXXTTTWWWZXVUYXVXXWSSUSTWUWUQSVWTRVZYWRTYXWVUUVWVVWY_ZXWUQRWXXWSQTVYWRVXVTTVZXUTQUWVUUVVXYXXYXWVWXWVTUTSSRTWWTTVYUUTTWXYTWZSQXZWZYVXWVXVYYUTSRSTSUVTWYWTVWVTRUVUTXXUY_XSVaZWTVWTVSUZWUSSWYWVWUSQUUTVSUVWYVWZ__WUWURSWWUZZWUQTVVVWUTVXXVTUUQRTWYYTSVVZXTVYZZWTUVWXXWWUVVWWWTRTUSOQUWUTVWWXWTUYaaXTUUVVVXWUVXXTTVUWWVVUTUVTTSUZVWWSWXTVWUWVVXWVUWYYXWVRTWWWVTUVTTTTUUWWXURWZXXXUSSVWXXWWXXWVTVXXWWWSUTSUSTTVUVWYYSTUUSRVYXUWYYYYZVTWWVUXXWWTRTVUUUTTTUVUSUYYXURSUVXZYZaZWRTVTSUWUVWWWWTTUWXUTTWWUUWXTRTVWWWaaYXWTUUUWYWUTSUUVXYVTTTSUUQSUUSTY_ZWUXWVWWVVXXVUVXWWXVSSUVWWVUUTTUURUXUTRSZaYXVUUUWYYUTYWVWUXYTTWWUTQTYZXRSUTVUTVWTTXZZ_ZWVWQQWUWYWXYZWSTSRQUVTTUTUTUZ_XWWVUTUVYYZYTTUVUVYXWXVUVUSUXYVUTVVSSVXWWTRUYZTQUXXXXTSWYbZWVVUTWVUUSUUTUWXTUSPSXWUVVUVXZYWWVWYYVVXVWVRQWXUTSUWWVXXUVVSSTUTTVWXWWUUUY_YXVUTWXWVVUSTTSWXWVWXVSTUVWTSTWVVTSVXXXYZYVSRTWXZYYYVTUUUUTRUVUSRUUTWWYWVTRVXa_XXWVVVWZZVSSSVZZUSWXTQRRTUSUZXWWVWUUWVVWZZUTUUVTUXXXWUTTTWXUUUWUTUTTVWWVVVWUUYYYYUSTVUY_WVVVWXYUSRTVTTYYUVSSURVXXXWVVUUUUVVVWWW_c_USSSVUSRUZYTSUTQRVXWXYXXUWXTVWYXUVXZVTWWVVUSRTWTRVZYXVUVWWURQSUXYVTTWXVUXXWWVVXZVWWUTSVVUXYVTTWWUQTURRSWZ_YYYVSSXXWVWWWWWVYYWSQQTVWXWXYUVTRRVYVUVTSVXZYWWYZWSTYWTTTUZ_WUTTVXXVVUSUVSQVXVVTTWWXZWUUVWX_ZVUUUVUWYWUWXUTTUVSSTSRUXVVWWWXXXYYVSQSXYWWYYXYVSTWYVRQSTUVUVVUVVWVYYYXTTUVVWUTWXXWTVWYXXWSUWURUUUVWUSTVWVWWTSVYXVUUVWVX_XVZXVWWVTRUUWYVOOUVTRTWYZWVVUTTWZYVWVUWYXYZYVRSTSTUUSTWZWUTUVUWYWTVVUWTUUVYYUVY__WVSRUWWWUTWXUTUSTWVUVWWVUTUUTTUUVWZZUTWYZYYWSTVUVTRVXWUVUVVUVVUUUSQVWXXVWWWYYYZWUSSUWVUWVUQQUWXUUZZTRTUWWXXUTUUUWXWYZZVTUTVWVWYXUUXVSSSXZVSQRVXWUWWTRRTWXWXZXXVXWTVWUSWYYXWYWTSTSRTTTTUWWXWUUTTVZZWUUTSWYXWWXWWVVWVUUWVTTSVWUUVWVSSUUWVVWVWVUVYaZWVTU_ZTTUTUUWWVWWRPRVWXXUUVUUSVXWWWXUUXZ_YVTUVTVVVYUPSWVTVTTVVXXWWWUSTTVXYXXWVXWUUWXWWXWWVTUVVUTUSSTVWWUTVUUSUVUWXXWWYYZYVUUUXWUWWVTVVVWTUTQUVSVWVWVVTSVUUY_ZXWVWVVUTVWXWVWWXXVTRQUWUVTSSUZZWTTWXWXXVSVZZWUVVTTWWUVXWSTWWWTTUUVUTUVWTTVXWVWUXXTTVWVUVXZbaWSSSTVTTWWVVUUSTUTUVVWVUXVWWVXXYVUWVUWYXVWVVVTUUVVUTUTUWVWWWWWUVWUSQUYWTTWYXVX_bXSVVTSSUVUTTVXUTVWZYURRWYWWUSVYWUWYXXVVYWVTSSWYVTTUTTTTVXWVWUSSTWWWWZXWWVWYWVVWXWUVYWSSUVWXTSUUVVUUUTRTWWXWWWXZYWTUWXWVVWWSRUVWYVRSXYVVVTSUWTRSSUXYWWXVWWUWYXWWUVXWVUWWWXVSUTTUTSRSVWWVVVUUTVXYYZYVTTVY_YXWTTUXVPQUYXVUTRTUTTUWVSUZ_WWXWXVTTUVXXVYYXUTVVWUSUVUTTWWUVWVUTUUTWYWVUVWVVUVWYYXXXWUUUUUTWYWTQQSTVXYVUXYWVVUTVYYWSSV_YYYVVWVSSTTTUUVVUWUTUUVYXVWUTUUSVXWWUXZXWWUVXVSSUXWVVWXWUVWVUTSTVVURUXWWXWVVXWUXYXWXXUTUURSWXXVSTTUVUUSTWUSUXZYVUVXXVWYXWWWVUTUWVVTUZYVUTSUUUVTTTTUVVVXWVVWXXXWWVVXXWUSUVVYXUUXWSRRTTWXUTWXWWVUUVUWWTUWXXUTXXWVVXYVSVXWUVUSTSTSSTUUWZZXWVUVWYYWUVVXVUYXYXVWUTSTSSURQUWVUUVXWVWVUWXXXWUUUUVXZXWWXWVVVVUTTUURTWWVUUTVWUUVWWVVWVUVVUUVWZa_XUVUSSUWVUTSUVWXVUTTUUWVUTUXYVSTXYYYYWUVXVVVVVUTRTWXVTUUWWXVTTSTUVWWWYXTTWYXXXXVVWVVXYVSSTSSVXXUUUUTUTTUWVVXXZXUUVUVXWXXVWWUVVVWVVVWUSTWWVSQTWVVUUWXXWWUVYXUUVVUVSSWZYXVUUTSVWVUSSVWUTTVWUUVYZaXTUWWVTWWWXUUUVYYWUSUVTUUUTTUWWUSTVXXVUWWVUUWWXXVX_YVVUUUUUUTTUTSUUUVVVVVUUVXXUXYWXXXVVUSTUXYZYWURTVVWUTTUTSTWWUUTUXWUUUTVXYWVXWY_XWTTVVVVVUXXWUPRUVUUVWWUUUSVWWXWWUVWYXVWYWUUVUTUYWTUVUSUWWUUVVUSUXWWVWVVXVVVUXXYYWVUVUTTVWUVWWUTTVWVVUTSSTXZXVWXWVUTUWWVVVWXZZWTUXWUTTTTVUUWUTTUVWVUUUVVXYXXYWUUUTUXYXVXYWSRVUSTWXVVWVTTUVVVWWVVVVVVVVWVTVWWXWWXXVUWWUTUTTVWWUSTUTUUWWXWSTWVUWXXYXYZYYVTTTSUUTVXWTSTUWVUVVVWWVUVUUVWXXWXYXUTVWVSTUWYZYVVUSTVVSSTVXWSTWVWWUVWVUUXYZYZZXUTTTUUVWUSVXUSTTUWVUUUTTUVVXWVXXXXWXVVYWUUTUVUWXVUVUUUTTVTSTWXWWUVYYWUTWYYVVWWXXVSPSVXYYVUTTTWWVVUSSUVWVVWWXWWVWWXXWUTVXXUTSUZZWVUWWTRRSUUTUUVWVUWXWURTYZZYWVVUVXXXVUVVWWVUUUTTTSUVTTVXXUUYZXVWVSRTVYZYWVVWUVYXUTTUVVVVVUUUTTTTUUXZZWVVVVTUWVVXXXVSTXYXWTSTVVVVVUUTVWVUTWVVWVUSSUYYWWXWWXVWXWWUTTUVVVVUTUVWVTSTUVXYWTTUVXXWVUWYYYWXVRQTXYWUTUUVVUUVWWTTTUUTVVUVYXVWXYVUVVVWYWVUUVUVVWWTSSTVWVVWWVUTTWXWXXWVTSUXZZWSRTVXXWXXUTUUVVVUUVUUTSRTWYXVVVXYWVVWYYWVWUSUVXYYXTRTTTTTVUTTTVVVVVWVVUVXYXWXYYWTSTVWVWXUTUWWTTTSTUXWUVVVXWUVWVVWWVVVVWXWVWXXVUTUWVTSUVVVTUVUUUUUVWVVUWYXVTTVXZYXVUVUVVTUVWWVUUUVVTSUWVVWVWWUVUVWXVTTVYYXXWVVVUVVVWUTTUUTVWUSTVVXYWTRTUUXXXWXYXUVWVVVVWWVTTTTTXYXWVUUTRRSVXXWVWYWUUUUWWWWWVUUWVVVUWYXWVVUVVVVTRRUUUTSVVVXXWWWWWWVVXWWXVTUVUUVVUTTWXVVXXUTTTTUWWWWVVXXWUTUWVTVYXWYYUSUTSUTUVWWVTTWVTTTTUWXVWXXWXYZXTRRUWWXXWXWVVVUTSTTUVVSUWWVUVYXWVUUUUUWWWXWWVWVUWVUVWUSTUUWVUUVVUVUUVWXWWVTUWWWWVUVXXWWYXTSTUUVTRVYXURSUUTVWWVVVWWWWVWXWUVWVVXY_ZVTTUVVUUUUTUTTXXUUTSTXYWVXXYXUUWWWWVVVWVUVVTSTUWWVWXVTSUWUVUUWVVWWWWWVUTVXWVVVVWWVUVWVVWVUTRTWXVTUTTVWWVVZXTTWXWYZXVUUUVVWVTUWWVVVUTTVWVVWTSVWXXVUUUUVWWWWUUVXYXWXWUTSTUTTVWVVVVUVVUVWYXUUUUVWXXWVVVUTVXYXWVTTTVWVUVUSVVTTVUUTUXXWWWWWWVUUWXXXXXWWVUVUSSTWWVVUUUTTVVXVSSUXXWVVWXXXXVWXXVUSUWVVVUUVUTTWYWTTVTUXXVUTTUVWWWXZYXVUVWVTTVWUVVTUUVVWWVVTUVVUUVVUVWWWWXXWWVVWWWWWWVUTTUVWXXVUTTUVVUTUUUUUWVTVWYZZXXXVUVVUUUTVXXWVUTTTUUUTSVXWWUVWWWXYWUUVWVTTVWWWVTUWXXVTUXXUTUUVVVVVVUTVWXYXWWVVVUWWWVUUVUUVXXVTUVUUVWUTTTUWVUXZYUSTVWWWXXYWUUVXXVTUWWVUSTVUUWVTTUUUVVVXZYVTRUWWVUVWXVUXYYYVVUSSTUWWVUUVVTSTVVXXTTWWUUVVWXXXXYYVTVXWVVUUUUTUVVUSSTVWXXYXWWVTRSVWWWWY_YWWWUSSTWXVUTUWXWVUTTTUUVWVUVVUVVUWXWXXXXVUVWVUUVXWVTUVVTTUUVVVTTWWVVWUSSVYYXWVUWXXVUVVVUVVUTUWYXUSSTVUSUVUUUWYWVWXYWVVWWUUTUWWVUWYYWUTTUUUVVVVUTUVWWVUUUWWWXXVUVWWVVUVWXXVUUVUUTUUUVWWUTTUUUVWWWVVWXXXXXWUTSUWWXWWUSRUVWWUUWWUSSUWYYWVVVVVUTTVWVWYXWVVXYWWWTSTUVVVUUVUUVUUUUVVWXWWWVVVVWVUVWWXYWVUUWWUTUUUUVWUSTWWUTUUVVVVVXXXYXXWVVVVVWYYWSSRRUWUUVXWVUTUUVVVVVVWUUUVWXYWVVUVXVVXWUTWYWUTVVTUVUUUVVUTTUWXVUUWVUWZZYWWXXUSTVVVXXVVUTTTTUUTRRVYYXVUVYYXVVWWVTTVXXYYVTRSUUVWXWUTTUVVWUTTSTVXXWVVVUTUWXXXVVWXXYWUVVUTTTTVWVTUUUVVVUUWXWXWVVVWXVUWXWVTTWXWUTUWXUUWVTTSSUWWXXWWVUUVVVWXXXWVVXXWVTSTUUUVWVUUTTUVWWWWWWUTTWYWWVUUTVWWXXXWUTUUVXWUSUWXWVTSTVVVWXVUUUTUUWWWWVVWWWYZZVTTUUUUUVWWWVUUTUUUUVVVVWWWXWVUUVWWWVWXXVUUUTTTVWVVVUVVUUUUUUVVXXWWVVVWWXVUUVWWXWTVWWVVVVWWUTVVVTSTUUUTUWWVVWUTVXYXXVUUWXWWVVVVVVUUTUVUVUUVVUUVVUTVXXXXXWVUUVXYWUUVWVWWWVUTSUVVUTVXVTUWWVWXVTTVUUXYXXWWXXWVVVUUWXWUTSSUUUTTVVVVVUVVVVUVXYXWVWXWUVWVUUVVUVVWXVTRSTUUVWWVVWWWWUSUXYYYXWVVWWWUUVTSVXWWVUTTUUVUUVVWXXWUTTUWWVVWWVWWWUUVWVVXWVUVWVVVUSSUVWVUUTUVWVUWYYZXWUTUVVWWWVUTUWXXWUUUUTUUUVXXVUUUVUTUWXXWVWWWWVUUVUUUVWWWXVUTSTVVUUUVWWWWXWUTTVXYXUTTVVVVWWXXXVVWUUUTTTVWVTUWYXURRUWWWWWXWWWWVUVVVUUWXWWXVTUUUUTTTUVVUTVXYYXVUUVWVVUVWWWVVVVVWWXXUSSTUVVUVWVVUUWVUUUUUUVXXXWUVVVWXXXXWUUVVVVTTTTVUTUWVVXXURSTVWWXZXUTVWXXWVUVVVXYWTSTVWVUVWVUUUTUUUUUUVVVXYYXXXWWVWWVUVVUVUUUWVTSTUVVVWWVVUTUUUUVYYXXWVVWWVVVVVWVTTTVXWWVUTTUWXWVUTSTUVWVVWXXWXXXXWWUTVVVVUUUVWVVUUVVTUVVVUUUVVWXWWXWTTVVUVXXWVWWVUUWWVVVUUVVUUUVWVUTSUWYYXXXWTSTVWWXXXVTUVVVVWWXWVTTUTSUVVWWVUWXWWVUVWWXXXUSSUWWWVUUVVVVVVVWVTSTVVWVVWYXVTUUUVVVWWVXYXWVVUTTTUXYWUUVVVTTVUUWWVUUVVVVVUVWWWWWXYXWVTTTUUVWXWTTUTSRSUVWWWWWWWWXXWWWWVVVVWXWVVUUUTUVUUVVVVUTVWVUVVVUUVVVWVTSUWXWWXYXVUUUVXXWWWTTTUVVVVVVUUUUUVXYXVVUVWWXWVVVUVWXXVUUVVUVUTTUUUUUVVUVWWWWWWWXWVVWVUVXWVUVVVUUUTUWWWVUVVUUUVUUVVWWXWTSUVWXVVWWVVVWXWVVVVVVVUUTSTVWWVWWWVTTTUVWWVWWXYXWVVTTTUWXXVUVVTTTVWUUVVVWXXWVUTTUXYWUUVWWWVVVUUVVUUWWUTSTWXWVVVVVVVWWVUVUUWXWXXXVTUUUVWWVVUVWWVVUUTUVVUTUWWVWVTTTVWXYZYVTTVXWVUVVVWWUTTTVVUUUVWVVVWUUVWXWWWWVWXVUVVUUUUUUXYXWVUUUUUUUVVUUUUUVVWWUUWWWVVWXYXVTTUVVWXYVTTTTUUUUUUUVWVVVXXWVVVVXXXVVWVUUUVWVUUVUVVUUVUVWWVUTUUUUVWWWVWVVWXXVUVWWVVWWWWUTTTTUVVWWWWWVUUUUWWWUUUUVUVXXWVVUVVWYXWVUTSTVVUUUUVVWVUUTVWVVVWWWXXWVUTUVWWXWVUUVWUTTTUVWVVWWVVWWUTTUVWXWWXWWVVVVVUUUUWVUVVVUVWWWXXVUUUTSTVXXXWVVWWVUUUVWXVUUVWXWUTUVVVVWVUTUVVWVUUUUUXYXWVUWXWUTUWXXWUUVVVWWVUTSUVVVVUSSTVWXXWWWVVVVUVXXXVTTVXXWVUUTUVVVWWVUVVUTUUVWXWWVUVVTUWXXWWWWWWXWVTTTUUUUWWWVTSTUVWXWVUUWWVVWWVVVWXWUUVWXWUUUVVUUTUVWWUUVUTUVXWVVUUUWWVWWWWWXWVVVVVVUUUUTTUWXVUUVWWVUUUUUWXWVVWWXXWVVVVVVVUUUTTVVVWVVVWWVVUTVWVUUVWVUVVWXXWWWVVVTSTUVWXWUUVWWVUUTUVVUVWVWWWWVVWWXXVUVVUUVVWVUUUVWWUTUUVVVVUTUVVTTWXWXYXWVUTTVVWWVWWVUUVWWXUSUUTTUWXVTUVVXYXWVTSTWXYWVWWVUTTVWWWWWVVUUVWWVUUTUVVVWWWVUUUUVWWWWVVVWXVVWWWVVVVUTTTUTTUVWXWWVVVVVUUUWXWWWVWWVUUVWUUVWVUTTVWVUVUVVVVWXWUTUVUTUWYYXVUVVUTUXXXWWVUUVVVVVUUUVWXWVTTTTUUVWYXWWWVWXWUTSTVVVVWUTTUUUWWWVVVUUUVWVVVVVWXXXWVVVTUUUVVWWWWVVTSSSUVWWVUUVWWVUTTTVXZZZXWVUTTUUUVWXVUUVVUUUUTTWXXWVUUUVVWWWWWWWWVUUVUTUVVVVXXWVTSTUVVVWXWUTTWWVVUVWXXWUUVWWWWVUUVWWVUUTTUUUVWWVVVVUVWXWWVTUUVWWWWVUTUVWWWWWWVVUSSUVVVWWWVVVVUUUUVWWWWWWVUUVWWWVVUUVWWVUUUVVTTVWXWVUUVVVUTUVWXWWWXXWVVVVVVVWVVVUUTUUVVVVUUUVVVWWVTUVWXXWVVWWVUTTVWXWUTUUUVWXWVUVVVWVUUTUVUTUWWXWVUUVVVWXWWVVUVVVVVVUUVVVVUSTUVWWVUWXWVVXXWWVVUTUVWYYXWUSRRUWWWWWVUVVUTUUUVVVWWXYXWUSTUVVWWXXWWVVVUTTUVVUTTUWXWVVVUUWYZXVTSTUVVVWWWWXXWWVVVUUUUUUUUVVUUTVXYXWVVUVWVUUVVVVVWWWXXWVTRRSUVWXXVUSTVWWVUUVWWWWVVXXVUVWWWVVVVTTUVVVUUWWVVWWUUUWWVUUUVWVUVWWVVWWXWVUWXWVUTSTUVVVVVUUUUVWWWVVUUUUVWWWWWVWWWXXVUUTSTUVWWWWVUUVVUUUUUUVVVVVVWWVUUWXXWVWVVUVVUUVVVVWXWVUUUUUUTUWXXWVVVVWWVVUUVVVWXWWVUTTTVWXXWUUUTTTWXWVVWWVVWXXVUUUUWXXWVVWWUTTVXXWVUTTUUUTUUVWXWVVWWVUTTVWWWXXXVUUUWWVUVWWVUUUUTTUUUVWXXWVVVUUUUUXYYXWVVVWWVUTUUUUVWVVVVVVUVWWWWVVUUUVVVUVWWWWXXWUVUTUVVVVVVVVVVUUVUUVVWWVVVVUUVWXXWVVVVVVWXWVTSSTUVWWUUVVWWWWWVUTTUUVVVWYYXVUTUUVVVVUVWVWWWWWUTUUUVWWVUUUUUVWXWVUVXWWWWVVUTTUWXXYXVUTTUVVVVUUVUVVVVWWWWWVWXWVUUTTUVWWWWUUVVVVVVUSSTUWWXWUUVXXXWVVVWVVVUUVWWWWVVVWWVUUUUUTTUVWWWWVUTVXXWUUVWWWWVVVVUVVWXWWWWUTTTTVVVVVVUVWXWUUUTUVWXWWVUUVXWXXXWWWVUTSRSUVVUVWYYXWVUUTUVVVVWWWVUUUVVWWXWVVWUTUUUTUVWWXXWUTUUUVVUUTUWXWVVWVVVUVVWXWVUUUUVWWWVUVVUUUUUUVWWWWWWXYWUTTUVWXWVVUTTUVWVVWWWWWVWVTTUUUTUWXYYXWVUTTUVVVVWXVVVUUTTTVWXWVVVVUUUVWWWWVWWWWVUUTUVVWWWVWWWVVVUTUVWXWVUUTTUVWVVUVXXXWWUTTUVWXXWVVWVUUVUTUUTUUVWWVUUUVWWWXWWWWVUTTUWWWWVVWVVVWVUTUVWVVUUUVVUVWXWVVUUUUUVVVWXWWWVWXXVTSTUVWXVUUVWVUUVWVUUVVVWWWVVWVVVWWXWVVVVVUTUVVVWWVVTSTUVWWVUUUVUUWWWWWWXXWVUUVWVUVVUVVVWWVUUVVTRSUWXWWWVVWWWVWWWVVWVVVUUUUUVWWWVVUTTSSTWXXVUUVVWXXWVUTUVXXWWVUUUUUUVWYYWUUUVVUTTTUUVXYXWVUUTUVVUUVWVVVWWWXWWVVVVVVWVUTTTUVWWVVWXXXWUTUVVVWWWXXWUUTTTTVXXWUUUTTUVVWXXXXWVVVUTTUUUVWWXXWVUTTUVVWWWUUUUUVVVVUVVVWWWWVUTTUVVWWXXWWXWWUTTTVWVUVVWWVVVVVVUVUUTUVWWWWUUUUWXXYXVTTTUVVVWXWVUTUUVWXWVUTUUVVVVVVUWYZYWVVVUUUTUVVWXXVUUTTUVVUUVWWVUTTUUVVXYYYXWVTUUUUVWWWWWWXWVTSSTUVVVVVVVUUVVVVXXWVUUVWWWUUTTVXXXXWWWUTSTUUUVVWVVVVWWWVVUUVWWVVUTUVWWWXXXXWUTSTTTUVWWVVVWXWUUUUVWWVVUUVVVVWWWWWWVUUVVUTTTUUWXXXWVTTUWWWVUUUWWWWWWVUUUVWXXWUTTSSTUVWXXWUUWWUTTUUVVWWXXWWVUUUVWVVWWVVUUUUUUVWWWVVUUVVUUUVVVXXXWVUUTUWXWVVUUVVWVUUUVVVWWWWVTSSTUUVWXWXWVVWWWVUUUWWVVVVVVUUUVWWXWWVUUTTTUVVWXXXWWVUTTTUUUWWXWWWWVVVVVWWVVUUUVUUTTTVWYZYWVUUTTUVWWWWWWVVWXVTTUUUUVWVUTTUUVWWWXXWWVUTTTUVWXYXWVVVWVTRSVXXWVUUUVUUUVWWWWWVUUVVUUUUVWWXXWVUUVVVUUVVVVVVVVUUUVVVWWVVVVVUUVVVXXYXVUUVVVVUTUVVVVWWVVUSSTUVVWWWWVWXXXWVWWVWWWWVUTSSTUVWXWWWWVUTTVWVUUUVWWVWVVUUVWXWVVUUUVVVUUVVWXWVVVVUTSTUVWVWWWVVVVVVVWWWWVVUUUVWWVUUWXXXVUTSSTUWWWWWVVWWWVUUTUVVVWXXWVTTUVWXYXVUTTTUTUUVVWXXXWWVUUUUUVWXXXWUTUVVWWXXWVUUTTTUVVWWVVWWXXVTTSSTVXYZXWVVVVVVUTUVVVVVVVVUUTTVWWWWVVUUVXXVUUVXXWVVVVVUUVVVVWVVUTUVVWWVVVVWWVVVTSSUWXXYYWVUUTUVWWWWVVUUVWWWVUTUWWVVVUTUVWWXWWWXXVUUVVVUUTUVVWWWWVTTUVVVVVVUUUUVVWWXXWWVVVUUVVUUUVWXXXWVUTTTUVWWVUVUVVVVVVVVVVWXXWVTSSTVYYYXWVVUUUUUUTTUVVWWVVVWWVUVWXXWVUUUVVVWWVVWWVVWVUTTTTVWXXWWVUUUVWWVUUVVWWVVVVVVVWWWXWVVUTTTUVVUVWWVVWVVVVUUUUVWXXWVUVWWWXXWVVUTTTTUVWWWXXXWVUTSTUUVVWWWWXWVVVVVWWWWVVUUUTSSUWXXXXWWVUUTTTUVVVVXYWVVWVVUUUVWWVVUUUUVXWWWWVUUUUUVVUUUUUWXYYXWUTTTVWXWWVUVVVVVVVVVUUUUUVUTTUVWXXXXXXWUTTUVVVUUUVWWWWWWVVUUVVVUTTTUVWXXWWWXXVUUUTTTUVWXXWWVVUVVVVVWVVUUUTTUVVWVVWWWVWWVUUUUVWXYYXVUTTUVVVVVUUTUVVUVVWXXXXWVUUUUUUVWWWVVVVVUVVUUTUUVWWWVVVVVWXWWVUUUTTTUVVWWXXXWXXWVVUTTUVWXXWUTTUVVVWWWUTUVVWVUUVWWXYYXVTTTUUTTUVWXWWXXWVUTUUVVVVVVUUUVWWXXWWWWVUUUUTTUVWXXXWVVUTSTUVWWWVVVVVVWWVVVVVWWWWWVUTUVVWXYXWVTTTTTUVVVVVVWXWWVVVVVVVWXXVTTTVWWXXXWVUTTUUUUUTUVWXXXWVVVUUWXWVVVUVVVWWWVUUVWXWWUTTTUUVWWWWVVUUUVVVUUVVVWWXXVUUVWWWVVUTTTUUUUVWWXXXWUUUVVUTTUVXYYXWVUUUVVVWWVVUUUUUUVWWWWWWWVUTSSTVXYXWWXWWVVUTUUUUUVVVVVVVUUVVWXXWVUTTUUUVWWXXXWVVUUVUUVVVUVWWVUUVVWWVVUVVVVUUUUUVWWXYYXWVUTTTTUVWWWWVVVVVUUUVVVVVVVVUUUVWXYXXXVTTTUVVVUUUVWXXWWVUTUUUUVWWVVUUUVVWXXWVVVVVVUUUUUVWWXYXVUTTTTTTUVWVUVWWVWWWVUUVWWWVUUVVWXXXWVVVUTTTUUUUUUVVVWWVVVVVVVVWVVVUTUVWXXXWWWVUVUUTTTUVWXXXWVUUVVUUUUUUUVXXWVVWWWVVVWXXWUSSSTVWWXXWVVUTTTUUVWXXXXXWWVVVWWWWWVUSSTUUVWWWVVVWWUTSSTUVWXYYXXWVUVWWVVVWWVVUUUUTTVWXXWWWWVUSTUVVVVWXWWWWWVUUUUUVWWWVUUVVWVVWWVUUTTTTUVWXXWWXYYXVTSSTUVWXWVVVUUUVVWWWVVUUUUVUUUUVWYZYWVUUTTTUVVWXXXWVVUUVUUUUUVVUUUUTUWXXXXWWWVTTTTVWWXXXXXWVUTSTUVVVVVVUUUVVVVWXWVVVVUUUUUUVWXYZYXWVUTUUUUUUVVVVVVWWVVUUVVUUVVUUUVWXXYXWWVVVUTTTUVWWWWWWVUUUTTUVVWWVTTUVWXWWWXXWWWVVUUUTTUVWWWWWVUUUUUUUVVWWWVVWVVWWXWWWWVUUTTUVVWXXXXWVVUUTSSTUVWWVVWWWWVVVVWXWWVUUUVVVUVWWWWWWVUSRSTUVVWXWWVWWVVVVVUUUVWWWWVUUWWWWWVUTTTTTTVWWVVWWXXXWVUTTTUVXXWWVUVVVWWWVUTTTTTUVVWWWWWWWWWVTSTUUVVWWWWWWWWWWWVUUUUUUUUUUTUVWXXWWVUUUUUVVVWXXXWVVVVVVVVVVVVVTSSSUWYZYXWVUUUUUUVVVVWXYYYXVTSSTVVWWVUUUVWVVVVWWVVVVUTTTUVVWXXXXXWVUUUUVUUUVWWWWWVUUUVVVVVUUUTUUUVWXXWWXXWVUTUUUUUVXXYXWUUTTTUVVUUUUUUUWWWVVWXZYXWUTSSTUVXXXWWVVVUUTUVVUUUVXXWUTTUVWWWWWWVUUUVWVVWXXXWWVVUSSSSTUWXWVVVVUVWXWWVUUVVWWVVVVVWWWWWWVUSRRSUWXXWVVVVWWVUUVVVVVVVWWVUUVWXXWWWVUTTTUUVVVWWWVUTTTUVVVVVWXXWVVVVWWXXWVVVUTTTTSTVWXYXWUTTTUTUVWWWVWXXXWVVVUUUVVVVUUUUUUUVWXXWWVUTUUUUVVVVWXXYXWUTTVVVVVVVUUVVVVWXWVUUUUUUTTTUVXXXXXXVUUUUVVVWWWVVVWWWVUUUUUVVUTTTUUUVXYYWVVVWVUUUVVVVWXXXWWVVUTTUVWVVUTTTUVVVWXXXXWVVVUTTUUVWYYXWVVUUUUVVVUUUVVVVUUUVWWXXWVUUUUUVWXXXWWWWVVVUUTTUUUUUUVVVVVVVWXXWUUTTTVWXXXXXXXXWVUTTTTTVWWWWVUVVVUUUVVUUUVVVVWWWWXYYXXVUUTTTTUUUVWVVVWWWVUTTUVVVVVUUUVWWXXXXVUUUUVUUVVVVVWXWVVUUSSTUVWWWWWVUVWWWVWWXWVUUVUUTUUVWYYXWVTSSSTTUVWWWVWWWWWWWVVVVVVVUUVVWWWWWWVVUTTUUTTUUVVXYYXWVUUUUVVWWWVVVVVVWWWWVVVWVVUTTTTTVWXXXVVVVWVUUUUUUVXXXXWWVVVWWXWVTTTSSTVVWWWWWWVVUTUUVVWWWXXXWVUUUUVVVWVVUTTTUVWWWWWWWVVUTTSSUWYZZYYXVUUVVVVVVUUUUUUUUVUUVWXXWUTTTUUVWWXXXXXXWVUUUUUUUVWXWVUUVVUUUVVVUTTUUUVWWXXXXXXWVTTTTUVXXXWVUUVVVVUTTUUUUVVVUVWWWXYYXWVUUUTUUVWWWWWWWVUUUUUUTUUVWVUUUVVWXYXWVVUUUUVUUVVWXXYXXVTSSSTTUVWWWVVVVWWWVUVWWWWVVUUUVWXXXXXVUTTTTTTUVWWVVWVVVVVVVVVVVVVUUUVWXXXXXWVUUUUTTSTTUVXYYXVUUUUUVVUVVVVVWXXXXWVVWWVVUTTTUVVWWWWWVVVUUTTTUVVWWXXWWVVVVWXXWVUTTTTTUUVWWXXWVUUUUTTTUWXXXXXWVVVVWWWVVVVVVUUTUVVVVWWWVUTSSSSTVWXXXXXXXWVUUUUVWWWVVUUUUVWWXXWUTSTTTUUUVWXXXXXWVVUTUVVWWXWWVUUUVVWWVUUUTTTTUUVWWXXYXWWVUTTTUVXXXXWVVVUUUUUUUVVVUTTTTVWWXXXXXWVUUUUUUUVWXYZYWVTTTUUUVVVUUUVUUUVWWXWWVVUUUVVVWWXYYYXWVUTTTTUUUVVVWVUUVVVVVVVVVVVVVVVVWXYXXWVUUUTTTUUUVWWVWWVUUUUVVWWVVVUUUVWXWWWVWXWWVUTTTTUVWXYXVUTTTUUUUUVVWWXXXWWVVWWWWWVVUTTTUVWWWWXWVUTTTTTTUVWWWVVVWWWWWWXWWVUUUUVWWWWWWWWVUTSSSTUVWWWXXWWVVWWWWVUUVVVVVUVVVVVWXXWUTSRRSUVWXXWWWVVVVVVUUVVVWXXWWWVVWWWVVVVUSSSTUVVVWXXXWWVUTTUUVWXXWWWWWVVWVVVVVUUUUUTTUUUWXYXWVUTSTUVVVWWXXXXXWWVUUUUUVUUUUUTTUVWXYXWUUTTTTUVWXXYYYXWVUTTTUVVVUVVVVUUVVVVVVVVVVVUUUUUVWXXYYYWVUTUUUUUUUVVWXWVVUUUUUUUUUUUUVWWXYYXXXWVUUUUTTUVWWWWWVVUUTUUUUUUUUUVVVWXYYXWWWWWUTTTUVWWWXXXVUUTTTUUTTUVVVVVVVVVWXYXWVUTTTUVWXXYYXWWVVUTSSSSTUVXXXVVVUUVWXXWVVVVVUVVWWWWWWWVVTSRRSTVWWWWWWWVUUVVUUUUVWWWWWWVVWWWWWVVVUTSSSTVWWWXWWVUUUUUUVVVVWWWWWWWXYYXWVUTTTTTTUUVWWWWWVVUUTTTUWXXXXXXXXWVVVVVVVVUUUUUUUVWXXXWVUTSSTTUUWXXXXYXWWVUUUVVVVVVUTTUVWWWWVVUUUUTSSTUWXYYYYXWVUTTUVWWVVVVVVVVVUUUUVVUUTSTTUVWYYYXWWWWWVVUUUUVVWWWWVVUUUUUVVVUTTTTUVWXXXXWWVVVUTTTUVXYYYXXVUUUUUVVUUUTTTUVVVVWWWWWWWVTTTUVWXYZYXWVUUTTUUUUUUUVVVUUVVVWWXXWVUUUUVVWXXYYXWWVUUTSSSTUVWWWWVVUUUVVVVVVVVVVVVWWXXYYXWVUTTTTTUUVVVVWVVVVUUTTTUVWWVVVVVWXYYYXWVUUTTTUUUUVWWXWWVUTSSTUUVVVVVVWWXYXXXWWVVVUTTUUVVWWXWWVUTTTTTTUVWWXXWWWWWWVVVVVVVVVVUUUVWXXWVVUTSSTTUUVVWWXXXXWWVUUUVWXWUUUUVVWWWWVVVUUTSSTTTUVXYYYXWVVUUVVVVVVVWWWWVVVVVWWVUUTTSTTUUVWXXXWWVVUUUTTVWXXYYYXWUUUUUVVVVUTSSTUVVWWWWWWWVVUTTUVWWXXYYXWVUUTUUVVUUUUUUUVVVVVVWWWVUTTTUVWXYYYYXWVVUTTTTUVVVVVVVUUUVWWWVUTTTUUVVWXXXXXXXXXVUTTUVVWWWVUUUUUUUUUUUUUUUVVWWWWXXYXWWVVUUUUVVVVVVVVVVVUTTTTUUUUVVVWWXXXXWWVVUUUUVVVVWXXXXXVUTSSTTUUVVVVUVVVVWXXXXWVVVVVUUVWWXXXXWVTSSSSTTUVVVVVWWVVVVVWWWWVVVVVWVWXXXXWVUTTSSTTUUUUWXXXWVUUTUUVWWWWVVWXXXXWWVVVVUUUTSRRSVWXXXWWVUUUUUUVVWWWWWXXXXWWVVVWWVUTSSTUVWWWXWWVTSSTTUUVWXYYXXXWVVVVVVVVUUUUUUUUUVWXXWWVTSSSTUVWXYYXXWWWWVUTTUVWWVVVVUUVVVVVUUUUTTTTUVWWYYYYXWWVUUTTUVWWWWVUUUUUVVVVUTSTTTUUVWWXYYYXWVVUTUUVVWWWWWWVVVVUUTTUUUUTTUUUVWXXYYXWVUTTUUVWWXXXXXWWVUTTSTTTUUUUUUUVWXXXXWWVUVVUUVVWXYZZYXWUSSSSTTTTTUVVVVVVVVVWWWWVVUVVVWWXYYYXWVVUTSTUUUUVVVVVVVVUUTUVWWVVVUUVWXXXYYYXVUUTTTSTUVVWWXWVUTTTUUUVVVVWWWWWXXWWWXXWVVUUTTTUVWWWVVVUUUTTTTUVWWXWWWWWXXXXXXWVUTTTTUVVVWWWWWVUTSSRSUVWXYXXXWVVUVWWWWVVVVVVVUUVWWWWWWVTSRRSTVWXXXXXWVVVVVVVVVWXXWVUVVVVVVVVUTTTSSSUVVWWXYYXWVVUUUVWWWWWWWWVVWWVUUUUTTTTTTTUVWXYYXWVVUTTTUVWXXYXXXWVVVVVUUUUUUUTTSTUVWXXWWVUUTTUVVWXXYYYYXWVUTTTUUVVUTTTUUUVWWWVVVUUUUUUVVWYYZZYXWVUTTTUUUVVVVVVVUUUUUUUUUUUVVVVWWXYYYYXWVUUUUTUUVWWWWVUUUUTTTUUVVVVUVVWXXXXXXXWVVUUUUUVVWWWWWVVTTSTTTTTUVWWWWWWWWXYYXWVVUTTUUVWWXXXWVUTTSSTTTUVVWWWWVVVWWWWWWVVVVVVWXXXXXWVUUUTSSRSTUVWWWWWWWVVVWVWWWWWWVVVVWWWXWWVUTSSSSTUVVVWWWXXWWVVUUUVVWWWWWWWWWWWWWVUTTTTTTTUUVWWXWWVUUTTTUVVWXXXXXXWWWWWVVUTTTTTUUUUVVWWWWVVUTTTUVWXXXYYYXWVUUUUVVVVVUUUUUUVVWWVVTSSTTUVVVWXYYYYXWVVVUUUUVVVWVVVVVVVVUUUUUTTTTTUVXXYYYXXWWVVUUUUVWWWWWVVUUTTUUUUTTTTTUVWXXYXXXXWVVUUUUUVWXYYXWVUTTTTUUUUUTTTUVVWWXXXWWWVVUUUUVXYYYYXWVUUTSSSTTUUVVUUVWWWWWWWWWVVUUUVVWXXYYXWWVTSSSTTTUVVVVVVVUUVWWWWVVVVVVWWXXXXXXXWUUTSRSTUUVWWWVVVVVUUUVVVVVWWWWWXXXYXXWWVUTSSSTUVWWWWWVVUTTTTTUUVWXWWWXXYYXXXWVUUUUUUTUUVWWWWWVUSRRSTTVWXXXYXXWWWWWWVVVVVUUUUUVVWWWWWVUTSSSSTVWWXXXXXWWVVVVVVVVWVVVVVVVWWWVVUTTSRRSTUVVXYZZYXWVUUUVVWWWWWWXXWVVVUUTTTTTTSSTUVWXXYYXXWVUUUUVVVVWXXXXWVVUUUUUUUTTTSTVWWWXXXWWVUUUUUVWXXXYYXXWVVUUTTTTTTTTUUVVWWWWWWVUUUUUVVWXYYYYXXWVUUUTTTUUUUUUUUUUVVVWWVVUUTUUVWXYYYYYXXWUTSSSTUVVVVVVVVUUVVVUUUUUUUVWXXXXYYXXXWVUTTTUUVVVWWVVVVUTTTTTTUUVWWWWWXYYYYXVVUUUUUUUVWXXWVVUUTTSSTTUVVWWWWWWWXXWXXWVUUUUUUVWXXXXXWVTSSRRSTUVWWWXXXWWWWWWWWVVVVVWWVVWWWXWVUUTTSSSSTUVVWWXXWVVVVVVWWWWWWVVWWXXWWVVUUTTSSSSTUVWWXXWWVVUUUVVWWWWWXXXXWWVVVVUUTTTTTTUUVWXXXWVUUTTTUVVWXXYYXXWWWWVVUUUTTTTTTTUVVWWVVVUUUUTTUWXYZZYYXWVVVUUUUVVUUUUUUUUUUVVWVUTSSSTVWXYYZZYXWVVUUUUUUUUVVVVUUUVVVUUTTUUUUUVVWXYZZYWWVVUUTTUVWXXWVVUUUUUUUTTTTTUUUVVWXXXXXXXWVUTUUVWWWXXWWWVUTSSSSTTUUVVVVVWWXXXXXWVUUUVVVVWWXXXXWVTSSSTTTUUVVVVVVVWWWWVVVVVVVVVWWXYYYYXWVTSSRSSTUVUUVVVWWVVVVUVVVVVVWWWXXYYXXWWUTTTTTTTTUVWWWWVUUTTUUUVVWWWWWWWXXXXXWWVUTTSSSTUVWXXWVUUUUTTTTUVWWXYYXXXXXXWWVVUUTTTTUUVWWWWVUUTTSSSTUVWXYYYYXWWWWWWWVUUUUUUUUVVVWVVVUTSSSSTUVWXYYYXXWWVVVVVVWWWVVVVVUVVVVVUUTTSSSTUVWXXXXXXXXWVUTUVWXXXWWVVVVUUUVUUTSSSTTUVWXYYYXXWVVUUUVVWWXYXXWWVUTTTTTTTTTUUUUUVWXXXWWVVUUUUVVWXXXXXXXWVVUTSTTUUUTUUUUVVWWWWWVVUUUUVWXYYYYYXWVUTSSSTTUUVVVVVUUUUVVWVVUUVVVVVWXYZZYXWVUTTSTTTUVWWWVVUUUUUUUVVVVUUVVWXYYYYYXXWVUTTTTTUVWWWWWVUTSSSTUUUVVVWWXXXXXXXXXWVUUUUUUVVWXXWVUTTTSSSTTUVWWXXWWWWWWWWWWWVUUUUVWWXWWWVVUTSRRSSTUVWXXXXWWVVVVWXXWVVWWWWWVVVWWWVTSSSSRSTUVWXXXXWWWWVVVUUVWWXXXWWWWWWVUUTTSSSTTTUVWWWWWWWVVVUUUVWXXXXXXYXWVVUUTTTSSSTTUVVVWWXWWVUTTTUVWXYYYYXXWWWVVUUTTTTTTTUUUUVWWWWVUTTTTUVWXXYZZZYWVVVUUUTUUUUUTTUUVVVVVVVUUUTTUUVXYYYYYXXWWVUTTTUUVVVWWVVUUUTTUUUTTTTUVWWXYYYYYXWVVUUUUUUVWWWWVUUTTTTTTTUUUUUVWXXYYXXXXXWVUUUUVVWXXXWVVUTSSSSTUUUUUVVVWWWWWXXXXWVUUUVWXXXXXWVVUTSSSSSTTUVWWWVVVVVVWWWVVVVVVWWXXXXYXWVUTSSSSSSTUWWWVVUVVVVVVVWWWVVWXXXXXWWWWVUTSSSSSTUVVWWWWVVUUUUUVVWWXXXXXXXXXWWVVUUTTTTTUUUVWWWVUUUUUUUUUVWYYYYXWWWWWWVVUUUUUTTTUUVVVVVVUUTSSSTVWXYYYYYXXWVVVVVVVVUUUUVVVVVVVUTSSSSTUVWWWXYZZYXVVUVVWWVVVVVVVUUUUUUUUTTTTTTTTUVXYYZYYXVVUUUVWWXWWWWWWVVUTTTSSTTUTTTUVWWXXXXWWVVUUUVVWXXXXXXWVUUTTTTTTTTTUUUVVWWXWWWVVVUVVWWWWXYYYXWVVUTSSTTTUUUUUUVVVWWWWWVVVVVUUVXYZZYXXWVUUTTTTTTUUUUVVVVUUUVVVVUUUUVWWXYYYYYXXWVTSSTTUUUVWWVVUUUUUUUTTUUVWWWXXXYYYYXXWVUUTTTTUVVVWVVUUTTTTTUUUVWWWXXXXXXXXWWWVUTTTTVWWWWWWVUUTSSSSTTUVWXYYXXWWWWXXWVVUVVVVVVVVWWWWUTSRRSSTUUVWWXXYYXXWVVVVVWWWVVVVWWWWVVVUUTSSRSSTUVWWXXXXWVVUUVVWWXXXXWWWWWVVVUUTSSSTTTTUVVWXXXWVVVVVVVVWWXYYXXXWWVVUUUTTTTTTTTUVWWWWVVVUUUUUVWWXXYYZYXXWVUUTTUUTTTTTUVVVVVVWVVUUUTUUVWWYZZZYXWVUUUUUUUUUUVVUUUUUUUUUUUTTUUVWXYYZZYYXWWVUTTTTUVVWWWVVUTTTTTTUUUUUUVWXXXXYYXXWWVUUUUVVVVWWWVVUTTTTSTTTUUVVWWWWXYYYXWVVVVVUUVVWWXWWWVUTSSSSSTUVVVVVVVWXXXXWWWWVVVUVVWXXXXWWVUTSRRRSTUVVVVWWWWWWVVVWWWWWWXWWWWXXXXWVUSRRSSTTUUVVWWWWVVVVVVVVWWXXWWWWXYYXWVUTTTTSRSSTUVWWWWWVVUTTUVVWWXXXXYYYXWVVUUUUTTTTTUUVVVWVVVUTSSTUVVWWXXYZYYXWWWWVVUUUUUUUUUUUVVVUUTTTTTTTUWXYZZYYXWWVVVVUUVVUUUUVVWVVUUUUUTSSSTUVWXYYYYYXXWVVVVVVVVVVWWWVUUTUUUUTSSSTTUVWXYYYYXWWVVVUUVVWWXXXWVVUUUUTSSSTTTUUUVWWXYXXXXWWVUUUVWXYYXXWWWVVTSSRSSTTTUUUVVVVWXXXWWVUUVWWWXXYYYYXWVUTSSSSSTUUVVUUUUVWWWWVVVVVVWWWXYYYYXWWVUTSSRSTUVVVVVVVVVUUUUVVVWWWWWXXYYYXXWWVUTSSTTUUUVVWWVVUTTTTUVVVVWXYYYYXXXXXWVUUUUUTTTUUVVWVVUTTTTTTUUVWWWXXYYYYXWWVVVVVUUUUVVVWVVUUTTTTTTTTUVWXXXXXXXWWWWWWVVVVVVVWWWVVVVVUSSRSSSTTUWXYYYXWWWWVWWVVVWWWWWWWWVVUUTSSSSSSTTUVWXXXXXXWWVUUUVWXXXXXXWWWVUUUUUTSSSSTTUVWWWWWWWVUUUUUVWXYYYYYWVVVVUUTTSSTTUUUUUUVVWWWVUUUUUVVWXYZZYXXWWVUUTTTTTUUUUUUUVVVVVVVVUUUUVWXXYYZZZYXVUTSSTUUUUVVVVVUUUUUUUUUTUUVWWWXXYZZYXWVUUUTTUUUVVWWVUUUTTTSSTUUVVVVWWXZZZZYXWVVUUUUUVVWWVVVVUUTSRSTTUUVVVWXXYYXXXXWWVVVVUVVVVWWWWWVUTSSSSSSTTUVWXXXWWWXXWWWVVVVVVVWXXYXWVUTTTSRRRSTUVWWXWWWWVVVWWWWWWWWXXXXXWWVVVUTSRRRSTUUVWWXXWWVVVVVVVVVWXXYYXXWWVWVVUTTSSTTTTUVVVVWVVVVVUUTUVWXYYYYXXWWWVVUUUUTTTTTUUVVVVVVVUUTTTUVWXYYZZZYXXWVVUUUUTTTUUUUUUVVWVVUTSTTUVVWWXYYZYYXWWVVUUUUVVVVUUUUVVVUTTTTTTTUUVVXXYZZYYYXWUUTUVVVVVVVWWVVUTSSSTTTTTTVWWXXYYYYXWVVVVVWWWWWWWWWVUUTTSSSSTTUUUUVVWXXYYXWVVVVVVVVWWXYXXWVVUTSSSSSTUUUUUVWWXWWWWWWWWVVVVWXXYYXXWVUTSRRSTTTUUUVVVVVVVVVWWWWWVVVWXXYYYYXWVUUTTSSSSSTVWWWVVUUUUUUVVVVWWXXYYYYXXWWWVUUTSSSTTUVVVVVVUUUTTTUUVVWWXXYZYYXXXWWVUTTTTUUUUVVVVVUUTTTTTTUUVWXYYYXXXXXWWVUUUUVVVVVVVVVVUUUTSSSSTUWXXXXXXXXXXWVVUVVWWVVVVVVVVVVUUTSRRSTUUVWWXXYYYXWVVVWWWWWWWWWVVVVVVUUTSSSSTTTUUVWXYYXXWWVVVVVWWXXXXWWWWVVUTSSSTTTTTTUVWWXWWWWWVVVVVWWWXXYYYXXWVUTTTTTTSSTTUUVVVVWWVVVVVVVWWWWXYZZYXWVUUUTTSSSTUUUVUUUVVVVUVVVVUUVVWYYZZYYXWWVVUTTTTTTUUUVVVUTTTTUUVVVVVWXYYYYYXXXWWVVUTTTUUUVVWVVUUTTTTTTTTUVWXXXXXXYYXXWWVUUUUUVVVWWVVUUUTTSSSSTUVVWWXXXYYXXXWWWVVUUUVWWWWVVVVVUTSRRSTUVVWWWWXWWWWWWWWVVVWWXXWWWWWWVVUTSSSSSSTTUVWWWWXXXWWVVVWWXXXWWWWWWWWVUTSSRRRSTUUVWWWWXWWVUTUVWXXXXXXXXXXWWVUUTTTTTTTTTTUVWWXWVUUUUUVVWWXYYYYYYXWVVUUTTTTTTSSTUVVVVVUUUUUUVVVWXYYZZZYYXWVUTTUUUUTTTUUUUUUUUUUUUUUUUVWXYZZZYYXWVUUVVVUUUUVVVVVUUTTTTTTTTTUUVVWXYZZYXXWWWVUUUUVWWWWVUUTTTTTTTTTTTUVWWXXXXXXYYXXVUUUVVWWWWWVVVUTTSSSSSTTUVWXWWWWWXYYXWVUUVVWWXXXXXWVUUTTSSRRSTUVWWVVVWWXXXWVVVVVWWWXXXYXXWWVUTSRRRSTUVVUUVVWWVVVVVVVWWWXXYYYXXXXXWVTSRRSTTUUUUVWWWVVUUUUVVVWWXXXXXXXXXXWVUUUTTTTTTTUUVVVVVUUUTTUUVWWXXXYYZZYXVVVUUUTTTTUUVVVUUUUUUTTTTUVVWWXYYZZYXWWWWWWVUUUUUUUUVVVVUTSSTTTTTUUVWYYZYYXWWWWWVVVVVVVVVVVVUUTTTTTTSSSTUVWXXXXXXXXXWVVVVVVWWXXWWVUUTTTTTSSSSSTUVWWXXXXXXWWWWWVVVVWXYYXWUUUUUTSSRSSTUUUVVWWWWWWWWWVVVVWXYYYXXWWWVVUTSSSSTUUUUUVVVVVVWWWVUUUVWXXXXXXYYXWVUTSSSSTTUUVVVUUUUVVVVUUVVWXXXXXXYYYXWVVUTTTTTUUUUVUUUVVUUTTTUVVWWWWWXYYYYXXWWVVUUTUUUUUUUVVVUTSSSSTUVVWWWXXYYYYYXXWVVVVVVUUUUVVWVVUTTSSTTTTTUVWXXYYYYXXWWVVWWWVVVVVWWWVUUTTTSSSSSTUVWWXXYXXWWVVWWWWWVVWWXXXWVVUUTTTSSSSSTTUVWXXXWWVWWWWWVVVWXXYXXWVVUUTTTTTTSSSTUVWWWWWWWWWVVVVVWXXYYYXXWVVUUUUTTSSSSTUVVVVVVVVWVVUUUVWXYYYYYYXWWVVVUTTSSTUUUUUUUUVVVVVUUUUVVWXXYYYYXXXWWVUTTTTUUVUUUUUVVUUUUTTUUUUVWXYYYYYYYXWVUTTUUVVVUUUUUUUUTTTTTTUUVVWWWXXYYYYXWVUUVVVVVVVVVVVVUTTTSSSTTUUVVVWWXYYYYXWWWWWVVVVVVVWWWVVUTTSSSSTTUUVVWXXXXWWWWWWWWWVVWWWWWWWWWVUTSSSTTTTTUVWWXWWWWVVVWWWWWWWWXXXXXWVUUTTTTTSSSTUVWWWVVVVVVVWWWWWWWWXXYYXWVVVVUUTTSSSTUUVVVVVVVVUUUVVVWWWXYYYYXWWWWVVUTTTTTTUUUUVVVVUUUUUUUUVVXYYYYYXXXWWVVUUUUUUUUUUUUUUUUUUUTTTTUVWXYYYYXYXXWVVUUUUUUVVVVUUUUUUUUTSSTUUVWWWXXYYYXXWWVVVUVVWWWVVVUUUUUUTSSSTTUUUUVWXXYYYXXWVVVVVVWWWWWWWWWVUTSSSSTTTUUVVWWWWWXXXWWVVVWWWWWWWWXWWVUTTTTTTTTTUUVVWWWWWWWVVVWWWWWVWWXXXXWVUUTTTTTTTTTUUVVWWWVVVVVWWWWVVWXXYYYXXWVVUTTTTTTTTTUVVVVVUUUUVVVVVVWWXXXXXXXWWWVUUUTTTTTUUVVVVUUUUUUUUUVVWWXXYYXXXXWWVVVUUTTUUVVVVUUUUUUUUTTUUVVWXXXXXXXXWWWWVUUUUUVVVVVUUUUUUTTTTTUUVVWXXXXXXXXXWWVVUVVVWVVUUUVVVVUTTTSSTTUVWWWWWXXXXWWVVVVWWWWWVVVVVVVUUTTSSTTUUVVVVWWXXXWWVVVVWWWWWWWWWWWVVUUTTTTTTTUUUUUVWWWWVVVVVWWWWWWXXXXXXWVUUTTTTUUUTTUUVVWWWVVVVVVVVVWWWWXXXXXXWVUTTUUUUUTTUUVVVVUUUUUVVVVWWWWWXXYYXXWVVUUUUUUTUUUVVUUUUUUUUUUUVVVVWWXYYYXXWWWVVVUUUUUVVVVVVUUTTTTTUUUUVVWWXXXXXWXXXWWVUUUUUVVVVVVUUUUTTTTTTUUVWWWWWWWWXXXWWVVVVVVVVVVVVVUUUUTTTSTTUVWWWWWWWWWWWWWWVVVWWWWWWVVVVVUUTTSSTTUUVVVWWWWWWWWVVVVVWWWXXWWWVVWVVUTTTTTTUUUUUVVWWWWWVVVVVWWXXWWWWWWWWVVUTTTTTUUUUUUVVVVVVVVUUUVVWWWWWXXXXXWVVUUUUUUUUUUUUUVVVVVVUUUUVVVWWWWXXXXXWWVVVUUUUUUUUUUUVVVUUUUUUVVVVVVWWXXXXXWWWVVVVVVVUUUUUVVVUUUUUUUUUUUUVWWXXXXXXWWWVVVVVUUVVVWWVVUUTUUUUUTUUUUVWWWWXXXWWWWWWVVVVVWWWWVVUUUUUTTTTTUUVVVWWWWWWWWXWWVVVVVWWWWWVVVVVUUTTTTTTUUVVVVVVVVWWWWVVVVWWWWWWWWWWVVUUUTTTTTUUVVVVVVVVWVVVVVVWWWWWWWWWWWWVVUUTTTTUUUUUUVVVVVVVVUUVVWWWWWWWWWWWWWVVUUUUUUUUUUUUVVVVVUUUUVVVVWWWWWWXXXXWVVVUVVVVUUUUUUVVVVUUUUUUUUVVWWWXXXXXWWVVVVVVVVUUUVVVVVUUUUUUUUUUUVVVWWXXXWWVVVVWWVVVVVVVVVVUUUUUUUUUUUUUUVWWXXWWWWWWWVVVVVVWWWWWVVVUUUUUUUUUUUUVVWWWWWWWWWWVVVVVWWWWWWWVVUUUUUUUTTUUUVVVVVVVWWWWVVVVVVWWWWWWWVVVVVUUUTTTUUVVVVUVVVVVVVVVVVVVWWWXWWWWWWVVVUTTTUUUVVVVVVVVVVVVVVVVVWWWWWWWWWWWWVVUUUUUUVVVUUUUUVVVVUUUUVVWWWWWWWWXXWWVVVVVUUUUUVVVVVVVVUUUUUUVVVVWWWWWWWWWWWVVVVVVVVVVVVVVVVUUUUUUUVVVVVVWWWWWWWVVVVVVVVVVVVVVVVVVUUUUUUUUUUUVVWWWWWWWVVVVWWWWVVVVVVWVVVUUUUUUUUUUUUVVWWWWWVVVVVWWWVVVVWWWWVVVUUUUUUUUUUUUVVVVVVVVVVVVVVVVVWWWWWWVVVVVVVUUUUUUUUUVVVVVVVVVVVVVVVVWWWWWWWWVVVVUUUUUUUUVVVVVUUVVVVVVVVVVVWWWWWWWWWWVVVVUUUUVVVVVUUUUVVVVVUUVVVVWWWWWWWWWWWVVVUUUVVVVVVVVVVVVUUUUUVVVVVVVVWWWWWWWVVVVVVVVVVVVVVVVVUUUUUUUVVVVVVVWWWWWWWVVVVVVVVVVVVVVVVVUUUUUUUUVVVVVVVWWWWVVVVVWWVVVVVVVVVVVVVUUUUUUUUVVVVVVWWVVVVVVVWWWVVVVVWWWVVVVVUUUUUUUUUUVVVVVVVVVVVVVVVVVWWWWWWWVVVVVVVUUUUUUVVVVVVVVVVVVVVVVVWWWWWWWWVVVVVVVVUUUUVVVVVVVVVVVVVVVVVVVWWWWWWWVVVVVVVVUUVVVVVVVVVVVVVVVVVVVVVVWWWWWWWWWVVVVVVVVVVVVVVVVVVVVVVUUUVVVVVWWWWWWWWVVVVVVVVVVVVVVVVVVVVUUUUUVVVVVVVVWWWWWVVVVVVVVVVVVVVVVVVVUUUUUUVVVVVVVVVWWWVVVVVVVVVVVVVVVVVVVVUUUUUUVVVVVVVVVVVVVVVVVVVVVVVVVVWWWVVVUUUUUVVVVVVVVVVVVVVVVVVVVVVVVVVWWWWVVVVVVVUUUUVVVVVVVVVVVVVVVVVVVVVVWWWWVVVVVVVVVVUUVVVVVVVVVVVVVVVVVVVVVWWWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWWWVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
    };
    /* end ROM909 */

    // the decoder: each image 32 768 words (a short or missing string — the frame's placeholder — reads as mid-scale: silence;
    // a character outside the alphabet as mid-scale), decoded once per scope into Uint8Arrays every 909 of the scope shares
    // (the first create, or the engine's warm-up); the worklet only reads the stored codes (D7)
    const W9 = 32768, OPEN9 = 24576, RATE9 = 30000;
    let ROM9I = null;
    function dec9(s) {
      const t = new Int16Array(128).fill(-1), o = new Uint8Array(W9).fill(32), n = typeof s === 'string' ? Math.min(s.length, W9) : 0;
      for (let i = 0; i < 64; i++) t[ROM909_A.charCodeAt(i)] = i;
      for (let i = 0; i < n; i++) { const c = s.charCodeAt(i), v = c < 128 ? t[c] : -1; o[i] = v >= 0 ? v : 32; }
      return o;
    }
    function rom9() {
      if (ROM9I === null) ROM9I = Object.freeze({ hh: dec9(ROM909.hh), cr: dec9(ROM909.cr), rd: dec9(ROM909.rd) });
      return ROM9I;
    }

    // the accent DACs (R9 §1, §8; IMPL-7c §1.3): eight 6-bit latches — BD SD LT MT HT HH, RS + HC, CR + RD — through the
    // RM-0621's binary weights to 0…5 V (code · 5/63 [R?]), held until the next write; × 3.13 in each analog voice (1 + 10k /
    // 4.7k) on the 15 V rail (a 1 V knee into 13.5 V: the clip MW3 puts near code 52–56). The four states of a hit: normal N0,
    // per-voice N0 + L (BD SD LT MT HT CH), total N0 + round(TMAX · u) (u the TOTAL ACCENT knob, read by the CPU), both
    // min(63, N0 + L + T) [fit: TMAX the toms' +7.5 dB span, L the CH's +4.4 dB, N0 so that both at full TOTAL ACCENT meets
    // the clip — R9 §15]. Velocities (the lead's P-1): 100 / 110 / 119 / 127 name the four states at any knob position, the
    // codes between two of them interpolated and rounded (the DAC's), below 100 ghosts round(N0 (0.6 + 0.4 (v − 1) / 99))
    const ACC9 = Object.freeze({ N0: 21, L: 11, TMAX: 22 });
    const DAC9V = 5 / 63, ABUF9 = 1 + 10e3 / 4.7e3, CBOTH9 = Math.min(63, ACC9.N0 + ACC9.L + ACC9.TMAX);
    const vAcc9 = c => { const v = ABUF9 * DAC9V * c; return v < 12.5 ? v : 13.5 - Math.exp(12.5 - v); };
    const PV9 = Object.freeze([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);   // per-voice accent, by sound id
    const DAC_OF9 = Object.freeze([0, 1, 2, 3, 4, 6, 6, 7, 7, 5, 5]);              // sound → its DAC
    // the four states' codes of sound s at TOTAL ACCENT u → o[0…3] (normal, per-voice, total, both)
    function codes9(s, u, o) {
      const N0 = ACC9.N0, T = Math.round(ACC9.TMAX * clamp01(u)), pv = PV9[s] === 1;
      o[0] = N0; o[1] = pv ? N0 + ACC9.L : N0; o[2] = N0 + T; o[3] = pv ? Math.min(63, N0 + ACC9.L + T) : N0 + T;
      return o;
    }
    function vTrig9(v127, s, u) {
      const N0 = ACC9.N0, T = Math.round(ACC9.TMAX * clamp01(u)), pv = PV9[s] === 1;
      let v = +v127;
      if (!(v >= 1)) v = 1;
      if (v > 127) v = 127;
      if (v < 100) return Math.round(N0 * (0.6 + 0.4 * (v - 1) / 99));
      const c2 = pv ? N0 + ACC9.L : N0, c3 = N0 + T, c4 = pv ? Math.min(63, N0 + ACC9.L + T) : c3;
      return Math.round(v <= 110 ? N0 + (c2 - N0) * (v - 100) / 10 : v <= 119 ? c2 + (c3 - c2) * (v - 110) / 9 : c3 + (c4 - c3) * (v - 119) / 8);
    }

    // the 909's A pots (BD TUNE VR2, BD DECAY VR5, OH DECAY VR23): the JIS "A" curve, 15 % at mid travel — MW1's BD DECAY
    // times sit within 15 % of it at 0 / 25 / 50 / 75 / 100 %, tapA's 9 % misses 25 % and 50 % by 18–25 % [C]
    const TA9 = (0.85 / 0.15) * (0.85 / 0.15), tapA9 = k => (Math.pow(TA9, k) - 1) / (TA9 - 1);

    // the diode shapers (R9 §2: R52 10 k into the anti-parallel 1SS133 pair ∥ the 2.2 k + 47 Ω divider; every 909 VCO's
    // rounding and the rim shot's clipper): v(vin) from (vin − v) / R_s = 2 I_s sinh(v / n V_T) + v / R_L, tabulated once a
    // scope (0…4 V at 1 mV, 4…40 V at 20 mV; odd) [the 1SS133 as a 1N4148-class junction: I_s 2.52 nA, n 1.752 — C]
    const DS_N1 = 4000, DS_N2 = 1800, DS_RS = 10e3, DS_RL = 2247, DS_IS = 2.52e-9, DS_NV = 1.752 * VT;
    let DSH = null;
    function dshBuild() {
      const T = new Float64Array(DS_N1 + DS_N2 + 2);
      let v = 0;
      for (let k = 0; k < T.length; k++) {
        const vin = k <= DS_N1 ? k / 1000 : 4 + (k - DS_N1) / 50;
        for (let it = 0; it < 80; it++) {                   // Newton, warm along vin
          const ea = Math.exp(v / DS_NV), eb = 1 / ea, f = (vin - v) / DS_RS - DS_IS * (ea - eb) - v / DS_RL;
          const st = f / (-1 / DS_RS - DS_IS * (ea + eb) / DS_NV - 1 / DS_RL);
          v -= st;
          if (Math.abs(st) < 1e-13) break;
        }
        T[k] = v;
      }
      return T;
    }
    function dsh(T, v) {
      const a = v < 0 ? -v : v;
      let x;
      if (a < 4) x = a * 1000; else { x = DS_N1 + (a - 4) * 50; if (x > DS_N1 + DS_N2) x = DS_N1 + DS_N2; }
      const i = x | 0, y = T[i] + (T[i + 1] - T[i]) * (x - i);
      return v < 0 ? -y : y;
    }

    // the noise (R9 §7): 31 stages, feedback from stages 31 and 13 — the bit entering is e[k] = e[k − 13] ⊕ e[k − 31] (the
    // m-sequence of x³¹ + x¹⁸ + 1, the reciprocal of the tap polynomial x³¹ + x¹³ + 1; period 2³¹ − 1, a Mersenne prime),
    // filled with ones at power-up, clocked at NZ9_F (R184 10 k / C47 100 p ≈ 300 kHz [R?]); 0 / +15 V bits. Position n of the
    // stream is reached by r = x^n mod c(x) (GF(2), 31-bit words): e[n + j] = Σ r_i e[i + j], from the first 62 bits
    const NZ9_F = 300000, NZ9_C = 0x40001;                   // c(x) = x³¹ + x¹⁸ + 1: x³¹ ≡ x¹⁸ + 1
    const xt9 = r => ((r << 1) ^ ((r >>> 30) & 1 ? NZ9_C : 0)) & 0x7FFFFFFF;   // r · x mod c
    function mul9(a, b) { let r = 0; for (let i = 30; i >= 0; i--) { r = xt9(r); if ((b >>> i) & 1) r ^= a; } return r; }
    function pow9(n) {                                       // x^n mod c, 0 ≤ n < 2⁵³
      const hi = Math.floor(n / 4294967296), lo = (n - hi * 4294967296) >>> 0;
      let r = 1;
      for (let i = 20; i >= 0; i--) { r = mul9(r, r); if ((hi >>> i) & 1) r = xt9(r); }
      for (let i = 31; i >= 0; i--) { r = mul9(r, r); if ((lo >>> i) & 1) r = xt9(r); }
      return r;
    }
    const NZ9_E = (() => {                                   // E_j: e[j…j + 30] packed (bit i = e[i + j])
      const e = new Uint8Array(62), E = new Int32Array(31);
      for (let k = 0; k < 62; k++) e[k] = k < 31 ? 1 : e[k - 13] ^ e[k - 31];
      for (let j = 0; j < 31; j++) { let w = 0; for (let i = 0; i < 31; i++) w |= e[i + j] << i; E[j] = w; }
      return E;
    })();
    const par9 = x => { x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1; return x & 1; };
    // the register at bit position n ≥ 31: its 31 stages, bit t = e[n − 1 − t] (stepping it yields e[n])
    function win9(n) { const r = pow9(n - 31); let w = 0; for (let j = 0; j < 31; j++) w |= par9(r & NZ9_E[j]) << (30 - j); return w; }

    // the analog voices' component tables (R9 §2–§6; research-909-circuits.md §16 lists each with its tag)
    const BD9 = Object.freeze({
      // VCO (IC13a / IC13b / IC12b, Q10): f = F + DF · (C9's charge, 0…1) [R: 49.5 Hz measured; DF between MW1's 216 derived and
      // 225–247 measured]; the triangle's peak into the shaper ATRI [fit: MW1's H3 −25.7 dB re H1], Q12's emitter KAP [fit H2 −28]
      F: 49.5, DF: 230, ATRI: 3.05, KAP: 0.35,
      // the pitch envelope: C9 0.33 µ through D7 / R21 [C 1 k] from the trigger's +15 V, discharged through R57 + VR2 (100 k A) ∥
      // the buffer's input RP [fit 22 k / 330 k: MW1's τ 6.8 / 29.4 ms at TUNE 0 / 10]
      C9: 0.33e-6, R21: 1e3, R57: 22e3, VR2: 100e3, RP: 330e3,
      // ENV1: C8 0.33 µ through D9 [TC8 C] to KE1 · (V_acc − 1.2) under D8's clamp CL1 (a soft knee from KN1) [fit: the clamp met
      // at 80 % TOTAL ACCENT, MW1], held by Q3 (C7 / R18) HOLD [R measured 61–63 ms], then (R58 + VR5 1 M A) ∥ R54 [R: τ 14–107
      // ms]; Q12's threshold ETH ends the tail [C]
      C8: 0.33e-6, TC8: 0.2e-3, KE1: 0.306, CL1: 2.6, KN1: 2.2, HOLD: 0.061, R58: 47e3, VR5: 1e6, R54: 470e3, ETH: 0.01,
      // the click: the trigger's edge through C2 3.3 n into RD [C] → the unity Sallen-Key (3.7 kHz, Q 3.1) (× KP [C]), and the
      // noise / 3.6 → 26 Hz high-pass → 513 Hz low-pass; ENV2 (C12) 0.7 ms up and down [R? MW1]; Q6 with ATTACK (VR3 500 Ω,
      // a rheostat) over RE [fit: 7.5 dB of range]
      VP: 15, C2: 3.3e-9, RD: 10e3, FCK: 3700, QCK: 3.1, KP: 0.02, NDIV: 3.6, FN1: 26, FN2: 513, TE2: 0.7e-3, RE: 365, VR3: 500,
      // the output (IC11a, LEVEL VR4 100 k B its feedback): the body's and the click's gains [fit: 0.61 Vp-p at LEVEL 5,
      // unaccented, MW1; the click ≈ 7 dB under the hit's peak at ATTACK 5]
      G: 1.087, GC: 0.26 });
    const e1Clamp9 = x => (x <= BD9.KN1 ? (x > 0 ? x : 0) : BD9.CL1 - (BD9.CL1 - BD9.KN1) * Math.exp(-(x - BD9.KN1) / (BD9.CL1 - BD9.KN1)));
    const SD9 = Object.freeze({
      // VCO-1 over TUNE (VR6 10 k, the CV node 1.25…2.5 V) [R measured 117.4 … 230.7 Hz, linear within 1 %], VCO-2 × RATIO [R
      // measured]; the bend: C66 0.01 µ through R247 47 k at the trigger, (470 k + 100 k) its discharge [R: +216 Hz, 5.7 ms]
      F0: 117.4, F1: 230.7, RATIO: 1.5, BEND: 216, R247: 47e3, C66: 0.01e-6, TBD: 5.7e-3, ATRI: 3.05,
      // the tone VCAs: VCO-1 × ENV3 (24 ms), VCO-2 × ENV2 (21 ms) G2 under it [R: ≈ 9 dB]; the envelopes' starts V_acc − 1.2 + D
      // [fit D: the snare's +4.8 dB TOTAL ACCENT span]
      TE3: 24e-3, TE2: 21e-3, G2: 0.355, TC: 0.2e-3, D: 3.4,
      // the noise / 4 → 48 Hz high-pass → the unity Sallen-Key low-pass 8.5 kHz Q 1.9 → (a) 1.52 kHz high-pass → Q48 × ENV4,
      // (b) the Sallen-Key high-pass 4.05 kHz Q 1.31 → Q47 × ENV5 (the 2 ms crack: TE5 its fall [C]) [R]
      NDIV: 4, FH1: 48, FL: 8500, QL: 1.9, FH2: 1520, FH3: 4050, QH3: 1.31, TE5: 0.3e-3,
      // ENV4 (TONE): held HOLD4 [R 24 ms], then C4 drains through RF4 to ground and RT4 + VR7 (500 k B) towards −V_neg (RHO of
      // the unaccented start) — one network gives MW1's τ 32 / 76 ms and the cut (−40 dB) at 99 / 295 ms, TONE 0 / 10 [fit]
      HOLD4: 24e-3, C4: 0.747e-6, RF4: 124e3, RT4: 65.5e3, VR7: 500e3, RHO: 0.162,
      // the gains: tone, the main noise branch, the crack, the voice [fit: +3.6 dB re the BD at LEVEL 5; the noise's share C]
      GT: 1, GN: 0.55, GK: 0.275, G: 0.1307 });
    // the toms (R9 §4): VCO-1 at TUNE 0 / 5 / 10 [R measured], ENV1 / ENV3 τ [R]; DECAY's capacitor C2 [fit: MW1's −20 dB times at
    // DECAY 0 / 10, TUNE 5 — LT 165 / 213, MT 103 / 138, HT 108 / 160 ms]
    const TOM9 = Object.freeze([
      Object.freeze({ F: Object.freeze([57.0, 85.8, 117.2]), T1: 0.103, T3: 0.026, C2: 0.22e-6 }),
      Object.freeze({ F: Object.freeze([71.9, 106.6, 141.3]), T1: 0.0705, T3: 0.026, C2: 0.12e-6 }),
      Object.freeze({ F: Object.freeze([82.8, 125.4, 166.7]), T1: 0.0705, T3: 0.022, C2: 0.18e-6 })]);
    const TM9 = Object.freeze({
      // three phase-synced triangles 1 : R2 : R3 on one supply [R]; the negative supply's two capacitors (0.047 µ · 470 k, 0.1 µ ·
      // 2.2 M) charged at the trigger: PA + PB sharp at the start, PB the slow droop [fit: 25–38 % sharp, ≈ 7 % droop]
      R2: 0.667, R3: 1.8, PA: 0.24, PB: 0.07, TPA: 22e-3, TPB: 0.22, TC: 0.2e-3, ATRI: 3.05,
      // VCO-1's overdrive: the timer (0.01 µ · 1 M) shunting the 1 k path, OD × the drive while it holds above ODK [C: ≈ 32 ms]
      TOD: 10e-3, OD: 10, ODK: 0.3,
      // DECAY: VCO-2's envelope through RD2 56 k + VRD (500 k B) on the tom's C2; the gains of VCO-2 / VCO-3 re VCO-1 [fit, with C2]
      RD2: 56e3, VRD: 500e3, G2: 0.6, G3: 0.5,
      // the noise band (≈ 0.6–1.6 kHz) into VCO-3 under ENV3: the tick (Q33 / C54 0.0047 µ late, its RTK [C]) and the steady
      // part (R194 100 k late): KT / KS of VCO-3's frequency per unit noise [C]
      FH: 600, FL: 1600, C54: 0.0047e-6, RTK: 68e3, KT: 0.6, KS: 0.08,
      // per tom the output gain [fit: LT −0.6, MT +0.3, HT +0.4 dB re the BD at LEVEL 5, MW3]
      G: Object.freeze([0.1639, 0.1824, 0.1824]) });
    const RS9 = Object.freeze({
      // three bridged-T resonators [R: 220 / 488 / 1036 Hz, τ 9.6 / 4.6 / 2.9 ms] on C (their R1 = τ / C, G = ω² τ C), rung by
      // the trigger's edge (C_X into 10 k: TX [C]), each through its drive resistor — RDRV for the 220 / 488 Hz ones [C], R417
      // for the 1 kHz one (late 3.3 k; early 12 k: 3.6× weaker, R9 §14) — so the 1 kHz rings strongest (its g the largest);
      // KD the rings' sum into the clipper [C: ≈ 1.8 V peak, ≈ 10 dB into the clip at the start]
      F: Object.freeze([220, 488, 1036]), T: Object.freeze([9.6e-3, 4.6e-3, 2.9e-3]), C: 0.01e-6, TX: 0.1e-3, KD: 0.01, RDRV: 3.3e3, R417: 3.3e3, R417E: 12e3,
      // Q65's envelope [C 20 ms] from V_acc − 1.2 + D [fit D: +3.9 dB]; the Sallen-Key high-pass (10 n, 22 k / 220 k: 229 Hz Q
      // 1.58 [R]); LEVEL 100 k B ∥ 220 p
      TV: 20e-3, D: 5.6, HC: 0.01e-6, HR1: 22e3, HR2: 220e3, VR: 100e3, CL: 220e-12, G: 0.292 });
    const HC9 = Object.freeze({
      // the noise into the multiple-feedback band-pass 963 Hz Q 2.1; the bursts: 181 Hz high-pass → the OTA (the exp converter on
      // the burst timer's ramps: exponential falls TB [C]) → 1.94 kHz high-pass, onsets ON [R measured]; the tail: 440 Hz
      // low-pass → Q37 on the two-pole envelope (TT2 in, TT1 out: the swell peaks ≈ 28 ms [R 25–30], the fall 90 ms [R]) [R]
      FBP: 963, QBP: 2.1, FH1: 181, FH2: 1940, FL: 440, ON: Object.freeze([0, 9.8e-3, 21.5e-3, 31.4e-3]),
      TB: Object.freeze([2.4e-3, 2.4e-3, 2.4e-3, 6e-3]), TT1: 0.09, TT2: 0.0118,
      // accent: the bursts only, from the RS + HC DAC at each onset, V_acc − 1.2 + D [fit D: +2.7 dB]; the gains [fit: 2 Vp-p at
      // LEVEL 5 (the trimmer, MW1); the tail's share C]
      D: 8, GB: 1, GT: 4, G: 0.306 });
    // the ROM path (R9 §9): the word clock f_osc = KCK / (R_t · C) (IC72c / d, gated: started at the trigger) ÷ 2 for the
    // counters — KCK fitted so the hats' R492 12 k / C160 470 p run SN9's 60 kHz (30 kHz words) [fit]; crash / ride: R443 /
    // R441 6.8 k + their TUNE (VR25 / VR27 10 k B, higher = faster) on C131 / C130 470 p, × LATE for R442 / R440 10 k (≈ +0.4
    // semitone, R9 §14 [R?]); the DAC: code · 5 / 63 V (RA9 / RA10 / RA12 binary [R?]) through C157 / C127 / C128 10 µ into the
    // VCA (RIN [C]); the reconstruction: two unity Sallen-Keys, 5.6 k / 5.6 k with 1200 p / 1000 p and 2700 p / 390 p [R]; the
    // output stage 22 k in, LEVEL 50 k B its feedback; the hats' late C134 0.01 µ into the mixer's 22 k (≈ 723 Hz) [R §14]
    const ROMC9 = Object.freeze({ C: 470e-12, KCK: 60e3 * 12e3 * 470e-12, RH: 12e3, RT0: 6.8e3, VRT: 10e3, LATE: Math.pow(2, 0.4 / 12),
      CC: 10e-6, RIN: 10e3, R: 5.6e3, C1A: 1200e-12, C2A: 1000e-12, C1B: 2700e-12, C2B: 390e-12, RO: 22e3, VRL: 50e3, C134: 0.01e-6,
      R134: 22e3 });
    // the hats' VCA: C135 1 µ charged at the trigger through Q73 (to VHH, TCH [C]), drained by R452 100 k + OH DECAY (VR23 1 M
    // A) and, CLOSED, R451 10 k + CH DECAY (VR21 100 k B) in parallel [R]; Q84's log / exp converter: Q85's gain ∝ v135 ·
    // e^(KX · V_dac) with the HH DAC through R481 4.7 k [fit KX: the CH's per-voice accent +4.4 dB]; G [fit: an image at ±28
    // codes gives the scope's 1.2 Vp-p OH at LEVEL 5, MW2]
    const KX9 = Math.log(Math.pow(10, 4.4 / 20)) / (ACC9.L * DAC9V);
    const HH9 = Object.freeze({ C135: 1e-6, VHH: 10, TCH: 0.1e-3, R452: 100e3, VR23: 1e6, R451: 10e3, VR21: 100e3, G: 0.2314 });
    // the cymbals' VCAs: the counter's A9…A14 (a step every 512 words) through RA11 / RA13 into R432 270 k / R439 470 k, the
    // anti-log stages: gain ∝ e^(−AL · R432 / R · step / 63 + KX · V_dac) [fit AL: the crash's −14 dB at 0.91 s on a flat
    // image (its data was pre-compensated, SN9); the ride RA11's map with its own R439, R9 §15], the shared CR + RD DAC
    // through R426 / R435 4.7 k (KX the hats'); G [fit: ±28 codes → the scope's 2.3 / 2.2 Vp-p at LEVEL 5]
    const CY9 = Object.freeze({ AL: 1.905, R432: 270e3, R439: 470e3, GC: 0.446, GR: 0.424 });
    // what the source material shares with the model (lane R9's tool reads it, IMPL-7c §2.4): the cymbal VCAs' gain at each
    // staircase step (any common scale: the tool divides by step 0), the word format
    const ENV9 = Object.freeze({
      cr: Object.freeze(Array.from({ length: 64 }, (_, k) => Math.exp(-CY9.AL * k / 63))),
      rd: Object.freeze(Array.from({ length: 64 }, (_, k) => Math.exp(-CY9.AL * CY9.R432 / CY9.R439 * k / 63))),
      KX: KX9, WORDS: W9, OPEN: OPEN9, RATE: RATE9, STEP: 512 });
    // the mixer (R9 §10): each voice's mono share 6 k · (1 / R_L + 1 / R_R) of its fixed L / R mix resistors (LT, RIDE 8.2 /
    // 15 k; HT, HH 15 / 8.2 k; CRASH 12 / 10 k; the rest 12 / 12 k) [R? two readings]; MASTER VOLUME VR28 (50 k B) the
    // summing amplifier's feedback over RM [C 12 k]; the output's DC coupling HC_F [C — MW3's 130 Hz input coupling and
    // 6.6 kHz master low-pass are left out until a re-read, R9 §15]; the late 0.01 µ at the jack behind its 1 k (15.9 kHz) [R]
    const MIX9 = Object.freeze({ W: Object.freeze([1, 1, 6 / 8.2 + 6 / 15, 1, 6 / 8.2 + 6 / 15, 1, 1, 6 / 8.2 + 6 / 15, 6 / 12 + 6 / 10, 6 / 8.2 + 6 / 15]),
      VR28: 50e3, RM: 12e3, HC_F: 3, RJ: 1e3, CJ: 0.01e-6 });
    // the output's full-scale constant (volts at the master → 1.0): §2.6's anchor — the BD at the default panel (its LEVEL
    // 9) peaks at the 808's default BD (0.3029 × 7 / 9: LEVEL is VR4's feedback, linear). The lead (2026-10-21, review 1 F1):
    // every drum machine at about the same loudness, MIX9.W kept — the balance sits in the default LEVEL knobs (K9_DEF, models.js:
    // the clap's, cymbals', snare's and hats' sources sit high), the default groove's RMS through the Track within 1 dB of the
    // 808's, below the track limiter (IMPL-7c §14)
    const OUT_K9 = 0.3029 * 7 / 9;
    // a full-scale sample at LEVEL 10 ≈ the BD's peak on the bus at LEVEL 10, unaccented (§5); the accent law's ceiling (+4 dB)
    const SMP_LEVEL9 = 0.65, SMP_ACC9 = Math.pow(10, 4 / 20);

    // the 909's knobs (models.js ids, IMPL-7c §1.1): the face, block by block
    const K9_IDS = Object.freeze(['ac', 'bdu', 'bdl', 'bda', 'bdd', 'sdu', 'sdl', 'sdt', 'sds', 'ltu', 'ltl', 'ltd', 'mtu', 'mtl', 'mtd',
      'htu', 'htl', 'htd', 'rsl', 'cpl', 'hhl', 'chd', 'ohd', 'crl', 'rdl', 'cru', 'rdu', 'vol']);
    const K9 = Object.freeze(Object.fromEntries(K9_IDS.map((k, i) => [k, i])));
    // (the default LEVELs: review 1 F1's balance — the kick 9, snare and hats 4, clap 1.5, crash 3, ride 3.5, the rest 7)
    const LV9_DEF = Object.freeze({ bdl: 0.9, sdl: 0.4, hhl: 0.4, cpl: 0.15, crl: 0.3, rdl: 0.35 });
    const K9_DEF = Object.freeze(K9_IDS.map(k => (k === 'vol' ? 0.75 : k in LV9_DEF ? LV9_DEF[k] : /l$/.test(k) ? 0.7 : 0.5)));
    // knob → the circuits it retunes: 1 BD, 2 SD, 4 LT, 8 MT, 16 HT, 32 RS, 64 HC, 128 the hats, 256 crash, 512 ride; 1 << 30
    // the output stage (TOTAL ACCENT is read at the hit)
    const K9_CIR = Object.freeze(K9_IDS.map(k => (k === 'ac' ? 0 : k === 'vol' ? 1 << 30 : { bd: 1, sd: 2, lt: 4, mt: 8, ht: 16,
      rs: 32, cp: 64, hh: 128, ch: 128, oh: 128, cr: 256, rd: 512 }[k.slice(0, 2)])));
    // the sounds (the 808's ids, ids 7 / 8 the ride and the crash: IMPL-7c §1.2; 11–15 keep the 808's keys, inert), its lanes
    // (the 808's: lane k → sound k − 1); per sound its LEVEL / TUNE / DECAY knob (the samples' rules, §5; −1 none)
    const SOUNDS9 = Object.freeze(['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'rd', 'cr', 'oh', 'ch', 'lc', 'mc', 'hc', 'cl', 'ma']);
    const S9 = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const S9_LEV = Object.freeze([K9.bdl, K9.sdl, K9.ltl, K9.mtl, K9.htl, K9.rsl, K9.cpl, K9.rdl, K9.crl, K9.hhl, K9.hhl, -1, -1, -1, -1, -1]);
    const S9_TUN = Object.freeze([K9.bdu, K9.sdu, K9.ltu, K9.mtu, K9.htu, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    const S9_DEC = Object.freeze([K9.bdd, -1, K9.ltd, K9.mtd, K9.htd, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);

    // the staircase's droop compensation (Rom9): 1 + 2a (1 − cos ω) against the triangle kernel's sinc², a = 1/12 (exact at rest)
    const Q9E = 1 / 12;
    // the unity Sallen-Key low-pass (equal R): 1 / (s² R² C1 C2 + s 2 R C2 + 1), C1 the feedback capacitor; prewarped at f0,
    // capped at 0.45 fs (the reconstruction filters at OS 1)
    function skLP9(c, R, C1, C2, fs) { const f0 = 1 / (TAU * R * Math.sqrt(C1 * C2)); bil2(c, 0, 0, 0, 1, R * R * C1 * C2, 2 * R * C2, 1, kBil(Math.min(f0, 0.45 * fs), fs)); }
    // e^x − 1 for the VCAs' small emitter swings (|x| ≤ 0.2: within 1e-4)
    const vexp = x => x * (1 + x * (0.5 + x * 0.16666666666666666));
    // a triangle VCO's step: the integrator by ± 4 f h, the comparator's corner reflected at its fractional time (inline in the
    // loops: x += dr * 4fh; if (x > 1) { x = 2 − x; dr = −1 } else if (x < −1) { x = −2 − x; dr = 1 })

    /* BASS DRUM (R9 §2): the triangle VCO (reset and held by the trigger) on C9's pitch envelope (TUNE its fall) → the diode
     * shaper → Q12's emitter, its base on ENV1 (C8: accent-charged, D8's clamp, Q3's hold, DECAY's fall; the threshold ends
     * the tail); the click: the trigger's edges through C2 → the 3.7 kHz Sallen-Key, and the noise's low band, through Q6 on
     * ENV2 (ATTACK in its emitter); IC11a sums them, LEVEL its feedback. */
    class Bd9 extends Voice {
      constructor(M, Q) {
        super(M, 1); this.Q = Q;
        this.cd = new Float64Array(3); this.ck = new Float64Array(5); this.cnh = new Float64Array(3); this.cnl = new Float64Array(3);
        this.nP = 1; this.nH = 1; this.k9c = 0; this.k9d = 0; this.k8c = 0; this.k1 = 0; this.k2 = 0; this.kat = 1; this.gl = 0;
        this.e1t = 0; this.e2t = 0;
        this.zero();
      }
      zero() {
        this.x = 0; this.dr = 1; this.v9 = 0; this.e1 = 0; this.e2 = 0; this.tN = 0; this.hN = 0; this.sd = 0; this.s1 = 0; this.s2 = 0;
        this.sh = 0; this.sl = 0; this.vo = 0; this.nzOn = false;
      }
      os() {
        const M = this.M, P = BD9, fs = M.fs, h = M.h, td = P.C2 * P.RD, w = TAU * P.FCK;
        this.nP = Math.max(1, Math.round(2e-3 * fs)); this.nH = Math.round(P.HOLD * fs);
        this.k9c = 1 - Math.exp(-h / (P.R21 * P.C9)); this.k8c = 1 - Math.exp(-h / P.TC8); this.k2 = Math.exp(-h / P.TE2);
        bil1(this.cd, 0, td, 0, td, 1, kBil(1 / (TAU * td), fs));
        bil2(this.ck, 0, 0, 0, 1, 1 / (w * w), 1 / (w * P.QCK), 1, kBil(P.FCK, fs));
        bil1(this.cnh, 0, 1 / (TAU * P.FN1), 0, 1 / (TAU * P.FN1), 1, kBil(P.FN1, fs));
        bil1(this.cnl, 0, 0, 1, 1 / (TAU * P.FN2), 1, kBil(P.FN2, fs));
        this.kn();
      }
      kn() {
        // TUNE: C9 through R57 + VR2 (100 k A) ∥ RP; DECAY: C8 through (R58 + VR5 1 M A) ∥ R54; ATTACK: VR3 (a 500 Ω rheostat,
        // clockwise = less) over RE in Q6's emitter (the click's gain, 1 at mid); LEVEL: VR4 (100 k B), IC11a's feedback
        const M = this.M, P = BD9, kv = M.kv, h = M.h;
        this.k9d = Math.exp(-h / (P.C9 * par(P.R57 + P.VR2 * tapA9(clamp01(kv[K9.bdu])) + RW, P.RP)));
        this.k1 = Math.exp(-h / (P.C8 * par(P.R58 + P.VR5 * tapA9(clamp01(kv[K9.bdd])) + RW, P.R54)));
        this.kat = (P.RE + 0.5 * P.VR3) / (P.RE + P.VR3 * (1 - clamp01(kv[K9.bda])));
        this.gl = clamp01(kv[K9.bdl]);
      }
      fire(code) {
        const x = vAcc9(code) - 1.2;
        this.e1t = e1Clamp9(BD9.KE1 * x); this.e2t = x > 0 ? x : 0;
        this.tN = this.nP; this.hN = this.nH; this.on = true; this.qn = 0; this.nzOn = true;
      }
      run(mb, o, n) {
        const P = BD9, M = this.M, CH = M.CH, e = o + n, nz = this.Q.nz, T = DSH, cd = this.cd, ck = this.ck, ch = this.cnh, cl = this.cnl;
        const d0 = cd[0], d1 = cd[1], d2 = cd[2], K0 = ck[0], K1 = ck[1], K2 = ck[2], K3 = ck[3], K4 = ck[4];
        const H0 = ch[0], H1 = ch[1], H2 = ch[2], L0 = cl[0], L1 = cl[1], L2 = cl[2];
        const k9c = this.k9c, k9d = this.k9d, k8c = this.k8c, k1 = this.k1, k2 = this.k2, e1t = this.e1t, e2t = this.e2t;
        const f4 = 4 * M.h, F = P.F, DF = P.DF, A = P.ATRI, KAP = P.KAP, iK = 1 / KAP, ETH = P.ETH, VP = P.VP, KP = P.KP, iN = 1 / P.NDIV;
        const w = MIX9.W[0], gB = this.gl * P.G, gC = this.gl * P.GC * this.kat;
        let x = this.x, dr = this.dr, v9 = this.v9, e1 = this.e1, e2 = this.e2, tN = this.tN, hN = this.hN;
        let sd = this.sd, s1 = this.s1, s2 = this.s2, sh = this.sh, sl = this.sl, vo = this.vo, nzOn = this.nzOn;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let up = 0;
            if (tN > 0) {                                  // the trigger: the VCO held at its reset; C9, C8, C12 charging
              tN--; up = VP; x = 0; dr = 1;
              v9 += (1 - v9) * k9c;
              if (e1 < e1t) e1 += (e1t - e1) * k8c;
              e2 += (e2t - e2) * (1 - k2);
            } else {
              v9 *= k9d; e2 *= k2;
              x += dr * f4 * (F + DF * v9);
              if (x > 1) { x = 2 - x; dr = -1; } else if (x < -1) { x = -2 - x; dr = 1; }
            }
            if (hN > 0) hN--; else e1 *= k1;              // Q3's hold from the trigger, then DECAY
            let y = 0;
            if (e1 > ETH) { const s = KAP * dsh(T, A * x); y = gB * (e1 - ETH) * vexp(s) * iK; }
            if (nzOn) {
              const yd = d0 * up + sd; sd = d1 * up - d2 * yd;                         // C2 into R_D
              const yk = K0 * yd + s1; s1 = K1 * yd - K3 * yk + s2; s2 = K2 * yd - K4 * yk;   // the 3.7 kHz Sallen-Key
              const xn = nz[i] * iN, yh = H0 * xn + sh; sh = H1 * xn - H2 * yh;           // the noise's 26 Hz high-pass
              const yl = L0 * yh + sl; sl = L1 * yh - L2 * yl;                            // and 513 Hz low-pass
              y += gC * e2 * (KP * yk + yl);
            }
            vo = y;
            mb[i] += w * y;
            pk = Math.max(pk, Math.abs(y));
          }
          // the click's VCA closed: its filters rest (the noise is not read) [C]
          if (nzOn && tN === 0 && e2 < 1e-7) { nzOn = false; e2 = 0; sd = s1 = s2 = sh = sl = 0; }
          const act = Math.max(pk, e1 > ETH ? (e1 - ETH) * gB : 0, nzOn ? 1e-4 : 0, tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.x = x; this.dr = dr; this.v9 = v9; this.e1 = e1; this.e2 = e2; this.tN = tN; this.hN = hN;
        this.sd = sd; this.s1 = s1; this.s2 = s2; this.sh = sh; this.sl = sl; this.vo = vo; this.nzOn = nzOn;
      }
    }

    /* SNARE (R9 §3): two triangle VCOs (1 : 1.5) on the CV node TUNE sets, both reset and held by the trigger, the bend C66 on
     * VCO-1; Q50 / Q51 on ENV3 / ENV2; the noise / 4 → 48 Hz → the 8.5 kHz Sallen-Key → (a) 1.52 kHz → Q48 on ENV4 (TONE's
     * network, its tail cut where it crosses zero) and (b) the 4.05 kHz Sallen-Key high-pass → Q47 on ENV5 (the crack);
     * SNAPPY the noise's feedback at IC39b; LEVEL the voice's. */
    class Sd9 extends Voice {
      constructor(M, Q) {
        super(M, 1); this.Q = Q;
        this.ch1 = new Float64Array(3); this.cl = new Float64Array(5); this.ch2 = new Float64Array(3); this.ch3 = new Float64Array(5);
        this.nP = 1; this.nH = 1; this.kbc = 0; this.kbd = 0; this.kc = 0; this.k2 = 0; this.k3 = 0; this.k4 = 0; this.k5 = 0;
        this.ft = 0; this.vEnd = 0; this.gs = 0; this.gl = 0; this.et = 0;
        this.zero();
      }
      zero() {
        this.x1 = 0; this.d1 = 1; this.x2 = 0; this.d2 = 1; this.vb = 0; this.e2 = 0; this.e3 = 0; this.e4 = 0; this.e5 = 0;
        this.tN = 0; this.hN = 0; this.a1 = 0; this.l1 = 0; this.l2 = 0; this.a2 = 0; this.b1 = 0; this.b2 = 0; this.vo = 0; this.nzOn = false;
      }
      os() {
        const M = this.M, P = SD9, fs = M.fs, h = M.h, wl = TAU * P.FL, wh = TAU * P.FH3;
        this.nP = Math.max(1, Math.round(2e-3 * fs)); this.nH = Math.round(P.HOLD4 * fs);
        this.kbc = 1 - Math.exp(-h / (P.R247 * P.C66)); this.kbd = Math.exp(-h / P.TBD); this.kc = 1 - Math.exp(-h / P.TC);
        this.k2 = Math.exp(-h / P.TE2); this.k3 = Math.exp(-h / P.TE3); this.k5 = Math.exp(-h / P.TE5);
        bil1(this.ch1, 0, 1 / (TAU * P.FH1), 0, 1 / (TAU * P.FH1), 1, kBil(P.FH1, fs));
        bil2(this.cl, 0, 0, 0, 1, 1 / (wl * wl), 1 / (wl * P.QL), 1, kBil(P.FL, fs));
        bil1(this.ch2, 0, 1 / (TAU * P.FH2), 0, 1 / (TAU * P.FH2), 1, kBil(P.FH2, fs));
        bil2(this.ch3, 0, 1 / (wh * wh), 0, 0, 1 / (wh * wh), 1 / (wh * P.QH3), 1, kBil(P.FH3, fs));
        this.kn();
      }
      kn() {
        // TUNE: VR6 (linear) the CV node; TONE: VR7 (500 k B) in ENV4's network; SNAPPY: VR9 (10 k, linear) IC39b's feedback
        const M = this.M, P = SD9, kv = M.kv, h = M.h, rt = P.RT4 + P.VR7 * clamp01(kv[K9.sdt]) + RW;
        this.ft = P.F0 + (P.F1 - P.F0) * clamp01(kv[K9.sdu]);
        this.k4 = Math.exp(-h / (P.C4 * par(P.RF4, rt)));
        this.vEnd = -P.RHO * (vAcc9(ACC9.N0) - 1.2 + P.D) * P.RF4 / (P.RF4 + rt);
        this.gs = clamp01(kv[K9.sds]); this.gl = clamp01(kv[K9.sdl]);
      }
      fire(code) { this.et = vAcc9(code) - 1.2 + SD9.D; this.tN = this.nP; this.hN = this.nH; this.on = true; this.qn = 0; this.nzOn = true; }
      run(mb, o, n) {
        const P = SD9, M = this.M, CH = M.CH, e = o + n, nz = this.Q.nz, T = DSH;
        const a0 = this.ch1[0], a1c = this.ch1[1], a2c = this.ch1[2], L0 = this.cl[0], L1 = this.cl[1], L2 = this.cl[2], L3 = this.cl[3], L4 = this.cl[4];
        const b0 = this.ch2[0], b1c = this.ch2[1], b2c = this.ch2[2], H0 = this.ch3[0], H1 = this.ch3[1], H2 = this.ch3[2], H3 = this.ch3[3], H4 = this.ch3[4];
        const kbc = this.kbc, kbd = this.kbd, kc = this.kc, k2 = this.k2, k3 = this.k3, k4 = this.k4, k5 = this.k5, et = this.et, vEnd = this.vEnd;
        const f4 = 4 * M.h, ft = this.ft, f2 = P.RATIO * ft, BEND = P.BEND, A = P.ATRI, iN = 1 / P.NDIV, w = MIX9.W[1];
        const g = this.gl * P.G, gT = g * P.GT, gT2 = gT * P.G2, gN = g * this.gs * P.GN, gK = g * this.gs * P.GK;
        let x1 = this.x1, d1 = this.d1, x2 = this.x2, d2 = this.d2, vb = this.vb, e2 = this.e2, e3 = this.e3, e4 = this.e4, e5 = this.e5;
        let tN = this.tN, hN = this.hN, sa = this.a1, l1 = this.l1, l2 = this.l2, sb = this.a2, h1 = this.b1, h2 = this.b2, vo = this.vo, nzOn = this.nzOn;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let y = 0;
            if (tN > 0) {                                  // the trigger: both VCOs held at their reset; the envelopes charging
              tN--; x1 = 0; d1 = 1; x2 = 0; d2 = 1;
              vb += (1 - vb) * kbc;
              if (e2 < et) e2 += (et - e2) * kc; if (e3 < et) e3 += (et - e3) * kc;
              if (e4 < et) e4 += (et - e4) * kc; if (e5 < et) e5 += (et - e5) * kc;
            } else {
              vb *= kbd; e2 *= k2; e3 *= k3; e5 *= k5;
              x1 += d1 * f4 * (ft + BEND * vb);
              if (x1 > 1) { x1 = 2 - x1; d1 = -1; } else if (x1 < -1) { x1 = -2 - x1; d1 = 1; }
              x2 += d2 * f4 * f2;
              if (x2 > 1) { x2 = 2 - x2; d2 = -1; } else if (x2 < -1) { x2 = -2 - x2; d2 = 1; }
              y = gT * e3 * dsh(T, A * x1) + gT2 * e2 * dsh(T, A * x2);
            }
            if (hN > 0) hN--; else if (tN === 0) e4 = vEnd + (e4 - vEnd) * k4;   // ENV4: the hold, then TONE's network
            if (nzOn) {
              const xn = nz[i] * iN, ya = a0 * xn + sa; sa = a1c * xn - a2c * ya;                    // 48 Hz
              const yl = L0 * ya + l1; l1 = L1 * ya - L3 * yl + l2; l2 = L2 * ya - L4 * yl;        // the 8.5 kHz Sallen-Key
              const yb = b0 * yl + sb; sb = b1c * yl - b2c * yb;                                    // (a) 1.52 kHz
              const yh = H0 * yl + h1; h1 = H1 * yl - H3 * yh + h2; h2 = H2 * yl - H4 * yh;        // (b) the 4.05 kHz SK
              y += gN * (e4 > 0 ? e4 : 0) * yb + gK * e5 * yh;
            }
            vo = y;
            mb[i] += w * y;
            pk = Math.max(pk, Math.abs(y));
          }
          // the noise VCAs closed (ENV4 past zero, ENV5 gone): the noise filters rest [C]
          if (nzOn && tN === 0 && hN === 0 && e4 <= 0 && e5 < 1e-7) { nzOn = false; e5 = 0; sa = l1 = l2 = sb = h1 = h2 = 0; }
          const act = Math.max(pk, (e2 + e3) * gT, nzOn ? 1e-4 : 0, tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.x1 = x1; this.d1 = d1; this.x2 = x2; this.d2 = d2; this.vb = vb; this.e2 = e2; this.e3 = e3; this.e4 = e4; this.e5 = e5;
        this.tN = tN; this.hN = hN; this.a1 = sa; this.l1 = l1; this.l2 = l2; this.a2 = sb; this.b1 = h1; this.b2 = h2; this.vo = vo; this.nzOn = nzOn;
      }
    }

    /* TOMS (R9 §4): one circuit × 3. Three phase-synced triangle VCOs (1 : 0.667 : 1.8) on the TUNE supply, whose negative
     * side two capacitors pull sharp at the trigger (22 ms, 220 ms); VCO-1 overdriven by the attack timer (a near-square
     * relaxing to the rounded triangle); VCO-1 × ENV1, VCO-2 × ENV2 (DECAY), VCO-3 × ENV3 with the noise band (a tick and a
     * steady part) gated by ENV3 into its control; LEVEL the voice's. */
    class Tom9 extends Voice {
      constructor(M, Q, k) {
        super(M, 1); this.Q = Q; this.k = k; this.P = TOM9[k];
        this.cnh = new Float64Array(3); this.cnl = new Float64Array(3);
        this.nP = 1; this.ka = 0; this.kb = 0; this.kc = 0; this.kod = 0; this.k1 = 0; this.k2 = 0; this.k3 = 0; this.ktk = 0;
        this.f0 = 0; this.gl = 0; this.et = 0; this.nb = 1;
        this.zero();
      }
      zero() {
        this.x1 = 0; this.d1 = 1; this.x2 = 0; this.d2 = 1; this.x3 = 0; this.d3 = 1; this.pa = 0; this.pb = 0; this.od = 0;
        this.e1 = 0; this.e2 = 0; this.e3 = 0; this.tk = 0; this.tN = 0; this.sh = 0; this.sl = 0; this.vo = 0; this.nzOn = false;
      }
      os() {
        const M = this.M, P = TM9, fs = M.fs, h = M.h;
        this.nP = Math.max(1, Math.round(2e-3 * fs));
        this.ka = Math.exp(-h / P.TPA); this.kb = Math.exp(-h / P.TPB); this.kc = 1 - Math.exp(-h / P.TC); this.kod = Math.exp(-h / P.TOD);
        this.k1 = Math.exp(-h / this.P.T1); this.k3 = Math.exp(-h / this.P.T3); this.ktk = Math.exp(-h / (P.C54 * P.RTK));
        bil1(this.cnh, 0, 1 / (TAU * P.FH), 0, 1 / (TAU * P.FH), 1, kBil(P.FH, fs));
        bil1(this.cnl, 0, 0, 1, 1 / (TAU * P.FL), 1, kBil(P.FL, fs));
        // the band's rms from the bits' density (± 7.5 V at 300 kHz: 2 · 7.5² / f V²/Hz) through the two first-order edges
        // (noise bandwidth f_L² π / 2 (f_H + f_L)): the noise into VCO-3 per unit rms
        this.nb = 1 / Math.sqrt(2 * 7.5 * 7.5 / NZ9_F * P.FL * P.FL * Math.PI / (2 * (P.FH + P.FL)));
        this.kn();
      }
      kn() {
        // TUNE: the supply, 10 k linear (VCO-1 through MW1's three points); DECAY: ENV2 on C2 through RD2 + VRD (500 k B)
        const M = this.M, P = TM9, kv = M.kv, u = clamp01(kv[this.k === 0 ? K9.ltu : this.k === 1 ? K9.mtu : K9.htu]), F = this.P.F;
        this.f0 = F[0] + (-3 * F[0] + 4 * F[1] - F[2]) * u + (2 * F[0] - 4 * F[1] + 2 * F[2]) * u * u;
        this.k2 = Math.exp(-M.h / (this.P.C2 * (P.RD2 + P.VRD * clamp01(kv[this.k === 0 ? K9.ltd : this.k === 1 ? K9.mtd : K9.htd]) + RW)));
        this.gl = clamp01(kv[this.k === 0 ? K9.ltl : this.k === 1 ? K9.mtl : K9.htl]);
      }
      fire(code) { this.et = vAcc9(code) - 1.2; this.tN = this.nP; this.on = true; this.qn = 0; this.nzOn = true; }
      run(mb, o, n) {
        const P = TM9, M = this.M, CH = M.CH, e = o + n, nz = this.Q.nz, T = DSH, w = MIX9.W[2 + this.k];
        const H0 = this.cnh[0], H1 = this.cnh[1], H2 = this.cnh[2], L0 = this.cnl[0], L1 = this.cnl[1], L2 = this.cnl[2];
        const ka = this.ka, kb = this.kb, kc = this.kc, kod = this.kod, k1 = this.k1, k2 = this.k2, k3 = this.k3, ktk = this.ktk, et = this.et;
        const f4 = 4 * M.h, f0 = this.f0, PA = P.PA, PB = P.PB, R2 = P.R2, R3 = P.R3, A = P.ATRI, OD1 = P.OD - 1, iODK = 1 / P.ODK;
        // (the noise's gate follows ENV3 relative to its start: the accent a level on the toms, R9 §8 [C])
        const KT = P.KT, KS = P.KS, nbk = this.nb, iE = et > 0 ? 1 / et : 0, g = this.gl * P.G[this.k], g2 = g * P.G2, g3 = g * P.G3;
        let x1 = this.x1, d1 = this.d1, x2 = this.x2, d2 = this.d2, x3 = this.x3, d3 = this.d3, pa = this.pa, pb = this.pb, od = this.od;
        let e1 = this.e1, e2 = this.e2, e3 = this.e3, tk = this.tk, tN = this.tN, sh = this.sh, sl = this.sl, vo = this.vo, nzOn = this.nzOn;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let y = 0, nb = 0;
            if (nzOn) {                                    // the noise band (the shared stream through the 0.6–1.6 kHz band)
              const yh = H0 * nz[i] + sh; sh = H1 * nz[i] - H2 * yh;
              nb = L0 * yh + sl; sl = L1 * yh - L2 * nb;
            }
            if (tN > 0) {                                  // the trigger: the VCOs held; the supply's capacitors, the timer, the envelopes
              tN--; x1 = x2 = x3 = 0; d1 = d2 = d3 = 1;
              pa += (1 - pa) * kc; pb += (1 - pb) * kc; od += (1 - od) * kc; tk += (1 - tk) * kc;
              if (e1 < et) e1 += (et - e1) * kc; if (e2 < et) e2 += (et - e2) * kc; if (e3 < et) e3 += (et - e3) * kc;
            } else {
              pa *= ka; pb *= kb; od *= kod; tk *= ktk; e1 *= k1; e2 *= k2; e3 *= k3;
              const f1 = f0 * (1 + PA * pa + PB * pb), q = 1 + e3 * iE * (KT * tk + KS) * nb * nbk;
              x1 += d1 * f4 * f1;
              if (x1 > 1) { x1 = 2 - x1; d1 = -1; } else if (x1 < -1) { x1 = -2 - x1; d1 = 1; }
              x2 += d2 * f4 * f1 * R2;
              if (x2 > 1) { x2 = 2 - x2; d2 = -1; } else if (x2 < -1) { x2 = -2 - x2; d2 = 1; }
              x3 += d3 * f4 * f1 * R3 * (q > 0 ? q : 0);
              if (x3 > 1) { x3 = 2 - x3; d3 = -1; } else if (x3 < -1) { x3 = -2 - x3; d3 = 1; }
              const dv = od * iODK, drv = 1 + OD1 * (dv < 1 ? dv : 1);
              y = g * e1 * dsh(T, A * drv * x1) + g2 * e2 * dsh(T, A * x2) + g3 * e3 * dsh(T, A * x3);
            }
            vo = y;
            mb[i] += w * y;
            pk = Math.max(pk, Math.abs(y));
          }
          if (nzOn && tN === 0 && e3 < 1e-6 && tk < 1e-6) { nzOn = false; sh = sl = 0; }
          const act = Math.max(pk, (e1 + e2 + e3) * g, tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.x1 = x1; this.d1 = d1; this.x2 = x2; this.d2 = d2; this.x3 = x3; this.d3 = d3; this.pa = pa; this.pb = pb; this.od = od;
        this.e1 = e1; this.e2 = e2; this.e3 = e3; this.tk = tk; this.tN = tN; this.sh = sh; this.sl = sl; this.vo = vo; this.nzOn = nzOn;
      }
    }

    /* RIM SHOT (R9 §5): the trigger's edges through C_X ring three bridged-T resonators (btDesign: the 606's trapezoid in
     * s-form); their rings summed into the anti-parallel diodes (DSH: ≈ ± 0.55 V); Q65 on its envelope (the accent's level);
     * the 229 Hz Sallen-Key high-pass; LEVEL (100 k B ∥ 220 p) the voice's. */
    class Rs9 extends Voice {
      constructor(M, Q) {
        super(M, 1); this.Q = Q;
        this.cr = [new Float64Array(9), new Float64Array(9), new Float64Array(9)]; this.cx = new Float64Array(3);
        this.chp = new Float64Array(5); this.clv = new Float64Array(3); this.wr = new Float64Array(3);
        this.nP = 1; this.kc = 0; this.kv = 0; this.gl = 0; this.et = 0;
        this.zero();
      }
      zero() { this.sx = 0; this.a0 = 0; this.b0 = 0; this.a1 = 0; this.b1 = 0; this.a2 = 0; this.b2 = 0; this.ev = 0; this.h1 = 0; this.h2 = 0; this.lv = 0; this.tN = 0; this.vo = 0; }
      os() {
        const M = this.M, P = RS9, fs = M.fs, h = M.h;
        this.nP = Math.max(1, Math.round(2e-3 * fs)); this.kc = 1 - Math.exp(-h / 0.2e-3); this.kv = Math.exp(-h / P.TV);
        bil1(this.cx, 0, P.TX, 0, P.TX, 1, kBil(1 / (TAU * P.TX), fs));
        for (let k = 0; k < 3; k++) {
          const tau = P.T[k], wk = TAU * P.F[k], g = wk * wk * tau;     // p = 1 / τ, g = ω² / p
          btDesign(this.cr[k], P.C, tau / P.C, g * P.C, 2 / kBil(P.F[k], fs));
          this.wr[k] = k === 2 ? P.RDRV / P.R417 : 1;        // the drives
        }
        skHP(this.chp, 0, P.HC, P.HC, P.HR1, P.HR2, 1, kBil(229, fs));
        this.kn();
      }
      kn() {
        const M = this.M, P = RS9, u = clamp01(M.kv[K9.rsl]), r = P.VR * u + RW, fc = 1 / (TAU * r * P.CL);
        bil1(this.clv, 0, 0, 1, 1 / (TAU * fc), 1, kBil(Math.min(fc, 0.45 * M.fs), M.fs));
        this.gl = u;
      }
      fire(code) { this.et = vAcc9(code) - 1.2 + RS9.D; this.tN = this.nP; this.on = true; this.qn = 0; }
      run(mb, o, n) {
        const P = RS9, M = this.M, CH = M.CH, e = o + n, T = DSH, cx = this.cx, X0 = cx[0], X1 = cx[1], X2 = cx[2];
        const r0 = this.cr[0], r1 = this.cr[1], r2 = this.cr[2];
        const p0 = r0[0], p1 = r0[1], p2 = r0[2], p3 = r0[3], ph = r0[8], q0 = r1[0], q1 = r1[1], q2 = r1[2], q3 = r1[3], qh = r1[8];
        const t0 = r2[0], t1 = r2[1], t2 = r2[2], t3 = r2[3], th = r2[8];
        const KD = P.KD, w0 = this.wr[0] * KD, w1 = this.wr[1] * KD, w2 = this.wr[2] * KD, kc = this.kc, kv = this.kv, et = this.et;
        const C0 = this.chp[0], C1 = this.chp[1], C2 = this.chp[2], C3 = this.chp[3], C4 = this.chp[4], V0 = this.clv[0], V1 = this.clv[1], V2 = this.clv[2];
        const g = this.gl * P.G, w = MIX9.W[5];
        let sx = this.sx, a0 = this.a0, b0 = this.b0, a1 = this.a1, b1 = this.b1, a2 = this.a2, b2 = this.b2, ev = this.ev;
        let h1 = this.h1, h2 = this.h2, lv = this.lv, tN = this.tN, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          let pk = 0, pr = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let up = 0;
            if (tN > 0) { tN--; up = 15; if (ev < et) ev += (et - ev) * kc; } else ev *= kv;
            const u = X0 * up + sx; sx = X1 * up - X2 * u;  // the edges through C_X
            let q = b0 + ph * u, A = p0 * a0 + p1 * q, B = p2 * a0 + p3 * q; a0 = 2 * A - a0; b0 = 2 * B - b0; let s = w0 * (A + B);
            q = b1 + qh * u; A = q0 * a1 + q1 * q; B = q2 * a1 + q3 * q; a1 = 2 * A - a1; b1 = 2 * B - b1; s += w1 * (A + B);
            q = b2 + th * u; A = t0 * a2 + t1 * q; B = t2 * a2 + t3 * q; a2 = 2 * A - a2; b2 = 2 * B - b2; s += w2 * (A + B);
            const x = ev * dsh(T, -s);                     // the rings (V_o − u = −(A + B)) into the diodes, Q65
            const yh = C0 * x + h1; h1 = C1 * x - C3 * yh + h2; h2 = C2 * x - C4 * yh;   // 229 Hz
            const y = V0 * yh + lv; lv = V1 * yh - V2 * y;                               // LEVEL ∥ 220 p
            vo = g * y;
            mb[i] += w * vo;
            pk = Math.max(pk, Math.abs(vo));
            pr = Math.max(pr, Math.abs(s));
          }
          const act = Math.max(pk, ev * g * Math.min(pr, 1), tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.sx = sx; this.a0 = a0; this.b0 = b0; this.a1 = a1; this.b1 = b1; this.a2 = a2; this.b2 = b2; this.ev = ev;
        this.h1 = h1; this.h2 = h2; this.lv = lv; this.tN = tN; this.vo = vo;
      }
    }

    /* HAND CLAP (R9 §6): the noise → the 963 Hz band-pass → (the bursts) 181 Hz → the OTA on the burst timer's falls (onsets
     * 0 / 9.8 / 21.5 / 31.4 ms; each burst's height from the RS + HC DAC at its onset) → 1.94 kHz, and (the tail) 440 Hz →
     * Q37 on the two-pole swell; LEVEL the voice's. */
    class Hc9 extends Voice {
      constructor(M, Q) {
        super(M, 1); this.Q = Q;
        this.cbp = new Float64Array(5); this.ch1 = new Float64Array(3); this.ch2 = new Float64Array(3); this.cl = new Float64Array(3);
        this.on4 = new Float64Array(4); this.kb4 = new Float64Array(4);
        this.nP = 1; this.kc = 0; this.ka = 0; this.k1 = 0; this.kab = 0; this.gl = 0;
        this.zero();
      }
      zero() { this.n = -1; this.kb = 0; this.bk = 0; this.gb = 0; this.ea = 0; this.eb = 0; this.s1 = 0; this.s2 = 0; this.p1 = 0; this.p2 = 0; this.q = 0; this.tN = 0; this.vo = 0; }
      os() {
        const M = this.M, P = HC9, fs = M.fs, h = M.h, w = TAU * P.FBP;
        this.nP = Math.max(1, Math.round(2e-3 * fs)); this.kc = 1 - Math.exp(-h / 0.2e-3);
        for (let k = 0; k < 4; k++) { this.on4[k] = Math.round(P.ON[k] * fs); this.kb4[k] = Math.exp(-h / P.TB[k]); }
        bil2(this.cbp, 0, 0, 1 / (w * P.QBP), 0, 1 / (w * w), 1 / (w * P.QBP), 1, kBil(P.FBP, fs));
        bil1(this.ch1, 0, 1 / (TAU * P.FH1), 0, 1 / (TAU * P.FH1), 1, kBil(P.FH1, fs));
        bil1(this.ch2, 0, 1 / (TAU * P.FH2), 0, 1 / (TAU * P.FH2), 1, kBil(P.FH2, fs));
        bil1(this.cl, 0, 0, 1, 1 / (TAU * P.FL), 1, kBil(P.FL, fs));
        // the tail: ea (TT2) into eb (TT1), scaled so the swell peaks at 1
        this.ka = Math.exp(-h / P.TT2); this.k1 = Math.exp(-h / P.TT1);
        const tp = P.TT1 * P.TT2 / (P.TT1 - P.TT2) * Math.log(P.TT1 / P.TT2), pk = (Math.exp(-tp / P.TT1) - Math.exp(-tp / P.TT2)) * P.TT1 / (P.TT1 - P.TT2);
        this.kab = h / P.TT2 / pk;
        this.kn();
      }
      kn() { this.gl = clamp01(this.M.kv[K9.cpl]); }
      fire() { this.n = 0; this.bk = 0; this.tN = this.nP; this.on = true; this.qn = 0; }   // the burst timer restarts
      run(mb, o, n) {
        const P = HC9, M = this.M, CH = M.CH, e = o + n, nz = this.Q.nz, dac = this.Q.dac, on4 = this.on4, kb4 = this.kb4;
        const B0 = this.cbp[0], B1 = this.cbp[1], B2 = this.cbp[2], B3 = this.cbp[3], B4 = this.cbp[4];
        const A0 = this.ch1[0], A1 = this.ch1[1], A2 = this.ch1[2], C0 = this.ch2[0], C1 = this.ch2[1], C2 = this.ch2[2], L0 = this.cl[0], L1 = this.cl[1], L2 = this.cl[2];
        const kc = this.kc, ka = this.ka, k1 = this.k1, kab = this.kab, g = this.gl * P.G, gB = g * P.GB, gT = g * P.GT, w = MIX9.W[6];
        let cnt = this.n, kb = this.kb, bk = this.bk, gb = this.gb, ea = this.ea, eb = this.eb, s1 = this.s1, s2 = this.s2, p1 = this.p1, p2 = this.p2, ql = this.q;
        let tN = this.tN, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            if (cnt >= 0) {                                // the burst timer: an onset re-arms the OTA's ramp from the DAC's level
              if (bk < 4 && cnt === on4[bk]) { const x = vAcc9(dac[6]) - 1.2 + P.D; gb = x > 0 ? x : 0; kb = kb4[bk]; bk++; }
              cnt = bk < 4 ? cnt + 1 : -1;
            }
            if (tN > 0) { tN--; ea += (1 - ea) * kc; } else ea *= ka;
            eb = eb * k1 + ea * kab;
            const xn = nz[i], yb = B0 * xn + s1; s1 = B1 * xn - B3 * yb + s2; s2 = B2 * xn - B4 * yb;   // 963 Hz
            const y1 = A0 * yb + p1; p1 = A1 * yb - A2 * y1;                                             // 181 Hz
            const xo = y1 * gb, y2 = C0 * xo + p2; p2 = C1 * xo - C2 * y2;                               // the OTA, 1.94 kHz
            const yl = L0 * yb + ql; ql = L1 * yb - L2 * yl;                                             // 440 Hz
            gb *= kb;
            const y = gB * y2 + gT * eb * yl;
            vo = y;
            mb[i] += w * y;
            pk = Math.max(pk, Math.abs(y));
          }
          const act = Math.max(pk, (gb + eb) * g * 0.1, cnt >= 0 || tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.n = cnt; this.kb = kb; this.bk = bk; this.gb = gb; this.ea = ea; this.eb = eb; this.s1 = s1; this.s2 = s2; this.p1 = p1; this.p2 = p2;
        this.q = ql; this.tN = tN; this.vo = vo;
      }
    }

    /* THE ROM VOICES (R9 §9): the hats (one voice, two regions), the crash, the ride. The gated clock started at the trigger
     * (word 0 at the latch's chunk start; the word phase W accumulates per sample at the chunk's rate, so word k's time is
     * exact whatever splits the spans), the counter over its region stopping at its end (the latch holds the last word), the
     * DAC's staircase with each step at its fractional time (2-point polyBLEP, one OS sample late), the 10 µ coupling, the VCA
     * (the hats: C135 through the log / exp converter; the cymbals: the address staircase through the anti-log stage; both × the
     * DAC's accent), the two reconstruction Sallen-Keys, the output stage (LEVEL), the hats' late 723 Hz coupling. */
    class Rom9 extends Voice {
      constructor(M, Q, kind) {
        super(M, 1); this.Q = Q; this.kind = kind;
        this.r1 = new Float64Array(5); this.r2 = new Float64Array(5); this.co = new Float64Array(3);
        this.st = new Float64Array(64); const E = kind === 2 ? ENV9.rd : ENV9.cr; for (let k = 0; k < 64; k++) this.st[k] = E[k];
        this.img = null; this.a0 = 0; this.cnt = W9; this.closed = false; this.dw = 0; this.kHP = 0; this.kc = 0; this.kO = 1; this.kC = 1;
        this.gl = 0; this.nP = 1; this.hc = 32; this.actO = 0; this.actC = 0; this.tap = false;
        this.zero();
      }
      // (the latch's held word hc survives sleep: the coupling's and the BLEP's rest are that word, no step at the next hit)
      zero() {
        const h = this.hc - 32;
        this.W = 0; this.nx = 0; this.go = false; this.pend = h; this.q1 = h; this.q2 = h; this.m = h; this.v = 0; this.sg = 1;
        this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0; this.so = 0; this.tN = 0; this.vo = 0;
      }
      os() {
        const M = this.M, P = ROMC9, fs = M.fs, h = M.h, R = P.R;
        this.nP = Math.max(1, Math.round(2e-3 * fs));
        this.kHP = 1 - Math.exp(-h / (P.CC * P.RIN)); this.kc = 1 - Math.exp(-h / HH9.TCH);
        skLP9(this.r1, R, P.C1A, P.C2A, fs); skLP9(this.r2, R, P.C1B, P.C2B, fs);
        const tc = P.C134 * P.R134;
        bil1(this.co, 0, tc, 0, tc, 1, kBil(1 / (TAU * tc), fs));
        this.kn();
      }
      kn() {
        const M = this.M, P = ROMC9, kv = M.kv, h = M.h;
        if (this.kind === 0) {
          // the hats: the fixed clock; the decay paths (OH: R452 + VR23 1 M A; CLOSED: also R451 + VR21 100 k B)
          this.dw = P.KCK / (P.RH * P.C) / 2 / M.fs;
          const ro = HH9.R452 + HH9.VR23 * tapA9(clamp01(kv[K9.ohd])) + RW, rc = HH9.R451 + HH9.VR21 * clamp01(kv[K9.chd]) + RW;
          this.kO = Math.exp(-h / (HH9.C135 * ro)); this.kC = Math.exp(-h / (HH9.C135 * par(ro, rc)));
          this.gl = clamp01(kv[K9.hhl]);
        } else {
          // crash / ride: TUNE (10 k B, clockwise = less: faster) in the timing resistance
          const u = clamp01(kv[this.kind === 1 ? K9.cru : K9.rdu]);
          this.dw = P.KCK / ((P.RT0 + P.VRT * (1 - u) + RW) * P.C) * P.LATE / 2 / M.fs;
          this.gl = clamp01(kv[this.kind === 1 ? K9.crl : K9.rdl]);
        }
      }
      fire(closed) {
        // the counter to its region's start (a hat trigger selects OPEN / CLOSED), the clock from the latch's chunk start
        if (this.kind === 0) { this.closed = !!closed; this.a0 = closed ? OPEN9 : 0; this.cnt = closed ? W9 - OPEN9 : OPEN9; } else this.cnt = W9;
        this.W = -this.dw; this.nx = 0; this.go = true; this.sg = this.st[0]; this.tN = this.kind === 0 ? this.nP : 0; this.on = true; this.qn = 0;
      }
      run(mb, o, n) {
        const M = this.M, CH = M.CH, e = o + n, P = ROMC9, hats = this.kind === 0, img = this.img, a0 = this.a0, cnt = this.cnt, dw = this.dw, st = this.st;
        const R1 = this.r1, R2 = this.r2, CO = this.co, kHP = this.kHP, kc = this.kc, kd = this.closed ? this.kC : this.kO;
        const U0 = R1[0], U1 = R1[1], U2 = R1[2], U3 = R1[3], U4 = R1[4], V0 = R2[0], V1 = R2[1], V2 = R2[2], V3 = R2[3], V4 = R2[4];
        const O0 = CO[0], O1 = CO[1], O2 = CO[2], VHH = HH9.VHH, tap = this.tap;
        // the VCA's constant: the DAC's accent (KX), the LSB, the converter's gain, LEVEL into the output stage
        const dac = this.Q.dac[hats ? 5 : 7], ax = Math.exp(KX9 * (dac - ACC9.N0) * DAC9V);
        const gA = ax * DAC9V * (hats ? HH9.G / VHH : this.kind === 1 ? CY9.GC : CY9.GR) * P.VRL * this.gl / P.RO;
        const w = MIX9.W[7 + this.kind];
        let W = this.W, nx = this.nx, go = this.go, hc = this.hc, pend = this.pend, q1 = this.q1, q2 = this.q2, m = this.m, v = this.v, sg = this.sg;
        let s1 = this.s1, s2 = this.s2, s3 = this.s3, s4 = this.s4, so = this.so, tN = this.tN, vo = this.vo;
        for (let c = o; c < e; c += CH) {
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            let cP = 0, cC = 0;
            if (go) {                                      // the clock: the words whose time fell in (i − 1, i]
              W += dw;
              while (nx <= W) {
                const cd = img[a0 + nx], D = cd - hc;
                if (D !== 0) { const d = (W - nx) / dw, u = 1 - d; hc = cd; cP += 0.5 * D * d * d; cC -= 0.5 * D * u * u; }
                nx++;
                if (nx >= cnt) { go = false; break; }
              }
              if (!hats) sg = st[(nx - 1) >> 9];            // A9…A14 of the word on the latch
            }
            const x0 = pend + cP; pend = hc - 32 + cC;      // the staircase about mid-scale (LSB), one sample late
            // the 2-point kernel's in-band droop (its sinc², 0.3 dB at 20 kHz, OS 4) compensated: [−1, 14, −1] / 12, unity at DC
            // (one more sample late) — the aliasing alone is −65 dB and below (research-909-circuits.md §16)
            const xb = q1 + (2 * q1 - x0 - q2) * Q9E; q2 = q1; q1 = x0;
            if (tap) { mb[i] += xb * DAC9V; continue; }     // (opt.dacTap: the DAC alone, volts about mid-scale — the tests)
            const xc = xb - m; m += xc * kHP;               // C157 / C127 / C128 into the VCA
            let g;
            if (hats) { if (tN > 0) { tN--; v += (VHH - v) * kc; } else v *= kd; g = v; } else g = sg;
            const y = g * xc;
            const y1 = U0 * y + s1; s1 = U1 * y - U3 * y1 + s2; s2 = U2 * y - U4 * y1;
            const y2 = V0 * y1 + s3; s3 = V1 * y1 - V3 * y2 + s4; s4 = V2 * y1 - V4 * y2;
            let yo = gA * y2;
            if (hats) { const z = O0 * yo + so; so = O1 * yo - O2 * z; yo = z; }   // C134 into the mixer
            vo = yo;
            mb[i] += w * yo;
            pk = Math.max(pk, Math.abs(yo));
          }
          if (pk > (this.closed ? this.actC : this.actO)) { if (this.closed) this.actC = pk; else this.actO = pk; }
          // asleep when the VCA cannot bring the image back above the threshold (32 LSB of swing at its gain) and the output is quiet
          const act = Math.max(pk, go ? Math.abs((hats ? v : sg) * gA) * 32 : 0, tN > 0 ? 1 : 0);
          if (this.quiet(act)) return;
        }
        this.W = W; this.nx = nx; this.go = go; this.hc = hc; this.pend = pend; this.q1 = q1; this.q2 = q2; this.m = m; this.v = v; this.sg = sg;
        this.s1 = s1; this.s2 = s2; this.s3 = s3; this.s4 = s4; this.so = so; this.tN = tN; this.vo = vo;
      }
    }

    /* ------------------------------------------------------------------ the SDS-V (stage 7d + 8 lane V5, IMPL-8 §12) */
    // Our own reading of its voice cards (research-sdsv-circuits.md §2.3, RV): no legible schematic was reachable, so every
    // value below is ours [C], fitted to the behaviour the sources describe (RV §5) and listed in RV §6; the factory sounds
    // (memory 1) are our own. Five channels b s 1 2 3 (bass, snare, toms 1–3 — tom 1 the highest) on the 808's sound ids 0, 1,
    // 4, 3, 2; per channel the card's six (NOISE TONE BEND DECAY NOISE/TONE CLICK/DRUM) and the mixer's two (SENSITIVITY LEVEL).
    const VL = 10, VCMP = 0.2;                               // the trigger stage's soft limit, its comparator (V) [C, IMPL-8 §11.4]
    // pad volts from a velocity (v 1 → 5 mV, the input's floor; v 127 → 75 mV, a pad's peak) [C on R lon]; SENSITIVITY's gain
    // (× 20 … × 632); the peak detector's V_D behind the soft limiter — more sensitivity, less dynamic response [R mus83]
    const padV = v127 => 0.005 * Math.pow(15, (v127 - 1) / 126);
    const sensG = s => 20 * Math.pow(10, 1.5 * s);
    const vDyn = (vp, s) => VL * Math.tanh(sensG(s) * vp / VL);
    // the lowest velocity that fires at SENSITIVITY s (P-4: the original's soft-hit threshold, kept; 128: none) — the panel's tip
    function minVel(s) { for (let v = 1; v <= 127; v++) if (vDyn(padV(v), s) > VCMP) return v; return 128; }
    const t60V = d => 0.03 * Math.pow(167, d);               // DECAY → the time to −60 dB: 30 ms … 5 s [R: up to 5 s]
    // per card (RV §2.4): TONE (Hz at 0 / 10, exponential), NOISE's f_c (Hz at 0 / 10), BEND (octaves at 10), the noise's
    // dynamic sweep SW (octaves at V_D = VL with EG_N at its peak: bass and toms [R lon], the snare 0), the SSM2044's feedback
    // K (R27: the snare's resonance, below oscillation), the snare oscillator's modulation MOD (R26: a 31 Hz triangle, ± 2.5 %),
    // the toms' dynamic bend DB (BEND × (1 + DB · V_D / VL) [R lon: "the bend on toms"]), the filtered noise's scaling into its
    // VCAs NP, the card's output G (V at full bias, LEVEL 10) [fit: the cards' balance], its sound id; the RC² at 1.5 × F1
    const CV = Object.freeze([
      Object.freeze({ F0: 30, F1: 120, N0: 60, N1: 3000, BO: 1.5, SW: 1.5, K: 0, MOD: 0, DB: 0, NP: 4.5, G: 11, sid: 0 }),
      Object.freeze({ F0: 110, F1: 440, N0: 300, N1: 12000, BO: 1, SW: 0, K: 2.2, MOD: 0.025, DB: 0, NP: 3, G: 4.8, sid: 1 }),
      Object.freeze({ F0: 90, F1: 520, N0: 150, N1: 6000, BO: 2, SW: 2, K: 0, MOD: 0, DB: 0.25, NP: 3, G: 7.6, sid: 4 }),
      Object.freeze({ F0: 65, F1: 380, N0: 120, N1: 5000, BO: 2, SW: 2, K: 0, MOD: 0, DB: 0.25, NP: 3.2, G: 7.7, sid: 3 }),
      Object.freeze({ F0: 45, F1: 260, N0: 90, N1: 4000, BO: 2, SW: 2, K: 0, MOD: 0, DB: 0.25, NP: 3.6, G: 9.0, sid: 2 })]);
    const CH_OF_V = Object.freeze([0, 1, 4, 3, 2]);          // sound id → channel (and the channel's sid: CV[c].sid)
    // the trigger's monostables: the attack's gate TG (the envelopes charge toward V_D through TA), the click's TC, its release
    // TR; the noise into the SSM2044 (rms in 0–20 kHz, in its 2 V_T) NG; the feedback's saturation FBS; the VCAs' input: ± 30 mV
    // full scale over 2 V_T (an OTA's tanh) [C]
    const TG_V = 0.5e-3, TA_V = 0.1e-3, TC_V = 4e-3, TR_V = 1e-3, NG_V = 0.5, FBS_V = 0.25, KVCA = 0.03 / (2 * VT);
    // memory 1, the factory sounds (ours, never editable: the card's internal trimmers [R mus83, mx11]) — per channel n t b d m c:
    // a round kick with a short noise thump, a snare with a bright resonant noise body, three toms with the deep downward sweep
    const FACTV = Object.freeze([
      0.30, 0.42, 0.45, 0.42, 0.22, 0.25,
      0.62, 0.45, 0.25, 0.38, 0.62, 0.30,
      0.30, 0.42, 0.60, 0.60, 0.15, 0.25,
      0.30, 0.42, 0.60, 0.62, 0.15, 0.25,
      0.30, 0.42, 0.60, 0.65, 0.15, 0.25]);
    // memories 3 and 4 until a payload's trims arrive (the record's defaults, drum-core's: our own two settings per channel) —
    // per channel memory 3's six, memory 4's six: a deep long sweep and a short punch; a fat snare and a crack; electro toms and tight ones
    const TRIMV = Object.freeze([
      0.20, 0.25, 0.70, 0.65, 0.10, 0.15, 0.50, 0.50, 0.30, 0.25, 0.35, 0.50,
      0.45, 0.35, 0.40, 0.45, 0.40, 0.20, 0.80, 0.60, 0.15, 0.25, 0.75, 0.50,
      0.20, 0.35, 0.85, 0.70, 0.05, 0.15, 0.45, 0.55, 0.30, 0.30, 0.30, 0.40,
      0.20, 0.35, 0.85, 0.70, 0.05, 0.15, 0.45, 0.55, 0.30, 0.30, 0.30, 0.40,
      0.20, 0.35, 0.85, 0.72, 0.05, 0.15, 0.45, 0.55, 0.30, 0.32, 0.30, 0.40]);
    // the controls (models.js ids, IMPL-8 §11.2): 'x' + channel + field, channel by channel; the memory switches (index 0…3 =
    // memories 1…4; default 1: the knobs); the knobs' defaults = memory 1, SENSITIVITY 5, LEVEL 7
    const KV_IDS = Object.freeze(['b', 's', '1', '2', '3'].flatMap(c => ['n', 't', 'b', 'd', 'm', 'c', 's', 'l'].map(f => 'x' + c + f)));
    const KV_DEF = Object.freeze(KV_IDS.map((k, i) => ((i & 7) < 6 ? FACTV[6 * (i >> 3) + (i & 7)] : (i & 7) === 6 ? 0.5 : 0.7)));
    const KV_CIR = Object.freeze(KV_IDS.map((k, i) => 1 << (i >> 3)));   // knob → its card
    const SWV_IDS = Object.freeze(['xbp', 'xsp', 'x1p', 'x2p', 'x3p']), SWV_DEF = Object.freeze([1, 1, 1, 1, 1]);
    const SV = Object.freeze([0, 1, 2, 3, 4]), LANE_SV = Object.freeze([-1, 0, 1, 2, 3, 4, -1, -1, -1, -1, -1, -1]);
    // the mix output's coupling (Hz); its full-scale constant: §12.4's anchor — the bass drum's memory 1 at v 100, SENSITIVITY 5,
    // LEVEL 7 peaks at the 808's default BD (0.4286 FS, OS 4, 48 kHz) [fit], measured through the whole Track (lane E5,
    // engine-track: V5's 0.732 put it 1.2 dB over there, and the dvp groove's beat 4 — bass + tom 3 — at 0.906 FS before the
    // track limiter at 48 kHz × 2 / × 1): 0.67 → the bass +0.46 dB re the BD, the groove's RMS −0.36 dB re the 808's, ≥ 0.6 dB
    // under the limiter at every rate and OS; your own sounds (§12.5): 7a's law over V_D (its knee VK_V: V_D at v 100,
    // SENSITIVITY 5), a full-scale sample at LEVEL 10 ≈ the bass card's peak on the bus at LEVEL 10
    const HC_V = 3, OUT_KV = 0.67, VK_V = vDyn(padV(100), 0.5), SMP_LEVELV = 2.4;
    const triV = p => { const f = p - Math.floor(p); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; };   // a triangle of phase p (cycles)
    // hash32's bits as a signed int (no uint32 → double on the per-sample path: the cards' noise)
    const hashI = a => { a ^= a >>> 16; a = Math.imul(a, 0x7feb352d); a ^= a >>> 15; a = Math.imul(a, 0x846ca68b); return a ^ (a >>> 16); };

    // THE SSM2044 (RV §2.2–§2.3): four OTA stages dy_i = g tanh(y_{i−1} − y_i) (TPT integrators, g = tan(π f_c / fs)), the
    // input stage's x − k·y3 with the feedback through a saturating tanh (fbs); zero-delay, per sample — engine.js Ladder's OTA
    // method re-written in the machine's scope: the secant gains tanh(v)/v (Padé) at the prediction 2s − y, a second pass
    // blended in where the prediction alone drifts (resonant with g > 0.09, or g > 1); each stage's secant and its 1 / (1 + a)
    // in one division; with no feedback (bass, toms) the stages solved straight down. With feedback (the snare) its one pass is
    // kept off the loop's critical path (the cost, IMPL-8 §17): the secants at the sample before's prediction (−39 dB re the
    // output against the exact solve at the snare's levels, the fresh prediction −50), 1 / (1 + k Gt) and the feedback's
    // saturation secant from the sample before (both move slowly; k Gt ≤ 0.02 at OS ≥ 2), the loop closed after the open
    // loop's pass (y_i = z_i − k y3 (G0 … G_i)). Units: the OTA input's 2 V_T. Small-signal: 1 / ((1 + s/ω)⁴ + k). The cards
    // run this step written out in their loop (the same arithmetic, bit for bit — a test checks it)
    class Ota4 {
      constructor() { this.g = 0.05; this.k = 0; this.fbs = 0; this.zero(); }
      zero() { this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0; this.kf = this.k; this.ri = 1; this.h0 = 0; this.h1 = 0; this.h2 = 0; this.h3 = 0; }
      step(w) {
        const g = this.g, K = this.k, fbs = this.fbs, s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
        let y0 = this.y0, y1 = this.y1, y2 = this.y2, y3 = this.y3, kf = this.kf, ri = this.ri, h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3;
        const wb = g > 1 ? 1 : g > 0.09 && K > 2 ? (K < 3 ? K - 2 : 1) : 0;
        let e0 = 2 * s0 - y0, e1 = 2 * s1 - y1, e2 = 2 * s2 - y2, e3 = 2 * s3 - y3;
        const o0 = h0, o1 = h1, o2 = h2, o3 = h3; h0 = e0; h1 = e1; h2 = e2; h3 = e3;   // (the feedback's secants: the sample before's prediction)
        if (wb === 0) {
          // stage i at its input difference v: a = g tanh(v)/v (Padé n/m; past |v| = 3, 1/|v|); y_i = (a u + s_i) / (1 + a)
          let v, q, D, n, m;
          if (K === 0) {                                     // no feedback: straight down
            v = w - e0; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y0 = (g * n * w + m * s0) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y0 = (g * w + m * s0) * D; }
            v = e0 - e1; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y1 = (g * n * y0 + m * s1) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y1 = (g * y0 + m * s1) * D; }
            v = e1 - e2; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y2 = (g * n * y1 + m * s2) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y2 = (g * y1 + m * s2) * D; }
            v = e2 - e3; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y3 = (g * n * y2 + m * s3) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y3 = (g * y2 + m * s3) * D; }
          } else {
            // each stage's G = a / (1 + a), T = s / (1 + a); the open loop straight down (z), then the loop closed — y3 = z3 /
            // (1 + k Gt), y_i = z_i − k y3 (G0 … G_i) — with 1 / (1 + k Gt) and the feedback's secant from the sample before
            const k = kf;
            let G0, T0, G1, T1, G2, T2, G3, T3;
            v = w - k * o3 - o0; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G0 = g * n * D; T0 = m * s0 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G0 = g * D; T0 = m * s0 * D; }
            v = o0 - o1; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G1 = g * n * D; T1 = m * s1 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G1 = g * D; T1 = m * s1 * D; }
            v = o1 - o2; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G2 = g * n * D; T2 = m * s2 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G2 = g * D; T2 = m * s2 * D; }
            v = o2 - o3; q = v * v;
            if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G3 = g * n * D; T3 = m * s3 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G3 = g * D; T3 = m * s3 * D; }
            const z0 = G0 * w + T0, z1 = G1 * z0 + T1, z2 = G2 * z1 + T2;
            y3 = (G3 * z2 + T3) * ri;
            const ky = k * y3, P1 = G0 * G1, P2 = P1 * G2, kg = k * P2 * G3;
            y0 = z0 - ky * G0; y1 = z1 - ky * P1; y2 = z2 - ky * P2;
            ri = kg < 0.02 ? 1 - kg * (1 - kg * (1 - kg)) : 1 / (1 + kg);
            if (fbs !== 0) { const z = K * e3 * fbs, qz = z * z; kf = qz < 9 ? K * (27 + qz) / (27 + 9 * qz) : K / (z < 0 ? -z : z); }
          }
        } else for (let it = 0; it < 2; it++) {
          if (it === 1) { e0 = y0; e1 = y1; e2 = y2; e3 = y3; }
          let k = K;
          if (fbs !== 0) { const z = K * e3 * fbs, q = z * z; k = q < 9 ? K * (27 + q) / (27 + 9 * q) : K / (z < 0 ? -z : z); }
          // stage i at its input difference v: a = g tanh(v)/v; G = a / (1 + a), d = 1 / (1 + a)
          let v = w - k * e3 - e0, q = v * v, G0, d0, G1, d1, G2, d2, G3, d3, Dv;
          if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G0 = g * nu * Dv; d0 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G0 = g * Dv; d0 = av * Dv; }
          v = e0 - e1; q = v * v;
          if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G1 = g * nu * Dv; d1 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G1 = g * Dv; d1 = av * Dv; }
          v = e1 - e2; q = v * v;
          if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G2 = g * nu * Dv; d2 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G2 = g * Dv; d2 = av * Dv; }
          v = e2 - e3; q = v * v;
          if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G3 = g * nu * Dv; d3 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G3 = g * Dv; d3 = av * Dv; }
          const T0 = s0 * d0, T1 = s1 * d1, T2 = s2 * d2, T3 = s3 * d3, Gt = G0 * G1 * G2 * G3;
          const St = ((T0 * G1 + T1) * G2 + T2) * G3 + T3;
          let z3 = (Gt * w + St) / (1 + k * Gt);
          const u = w - k * z3;
          if (it === 1 && wb < 1) {                           // the blend zone: the two solutions mixed
            const v0 = G0 * u + T0, v1 = G1 * v0 + T1, v2 = G2 * v1 + T2;
            y0 = e0 + wb * (v0 - e0); y1 = e1 + wb * (v1 - e1); y2 = e2 + wb * (v2 - e2); z3 = e3 + wb * (z3 - e3);
          } else { y0 = G0 * u + T0; y1 = G1 * y0 + T1; y2 = G2 * y1 + T2; }
          y3 = z3;
          kf = k; ri = 1 / (1 + k * Gt);
        }
        this.y0 = y0; this.y1 = y1; this.y2 = y2; this.y3 = y3; this.kf = kf; this.ri = ri; this.h0 = h0; this.h1 = h1; this.h2 = h2; this.h3 = h3;
        this.s0 = 2 * y0 - s0; this.s1 = 2 * y1 - s1; this.s2 = 2 * y2 - s2; this.s3 = 2 * y3 - s3;
        return y3;
      }
    }

    /* ONE CARD (RV §2.2–§2.3, IMPL-8 §12.2): the trigger's gates (the attack's 0.5 ms, the click's 4 ms) charge the envelopes
     * toward V_D from the levels they are at (a peak detector: a retrigger never shortens a ringing decay); the triangle VCO —
     * reset to its lower peak at each hit, its corners reflected at their time and rounded by a 2-point polyBLAMP (one sample
     * late) — swept down from BEND by EG_P and, on the snare, moved by its 31 Hz triangle; two RC sections at 1.5 × the card's
     * top; the card's own hashed noise (a function of the absolute sample, salted) through a 20 kHz pole (the noise amplifier's,
     * above 60 kHz) into the SSM2044 (Ota4: NOISE's f_c raised by EG_N on bass and toms, clamped at 0.46 of the OS rate); three
     * OTA VCAs (EG_T on the tone, EG_N on the noise, EG_C on the click); NOISE / TONE and CLICK / DRUM equal-power, LEVEL an
     * audio taper. Chunk-rate: the pitch (interpolated within the chunk), the cutoff (held), the noise path on / off (on while it
     * can be heard; a wake settles the filter over the 12 ms before it from rest — a function of time only). */
    class CardV extends Voice {
      constructor(M, k) {
        super(M, 1); this.k = k; this.P = CV[k]; this.b = 8 * k;
        this.flt = new Ota4(); this.flt.k = this.P.K; this.flt.fbs = this.P.K > 0 ? FBS_V : 0;
        this.rc = new Float64Array(3); this.sm = new Float64Array(3);
        this.fT = 0; this.fN = 0; this.bo = 0; this.aT = 0; this.aN = 0; this.aC = 0; this.kT = 0; this.kN = 0; this.kPc = 0;
        this.kA = 0; this.kR = 0; this.nG = 1; this.nC = 1; this.nPre = 0; this.sig = 0; this.smOn = false; this.lfo = 0; this.seed = 0;
        this.tap = false; this.fTr = null;                   // (tests: the tone path alone on the bus, the VCO's frequency per sample)
        this.zero();
      }
      zero() {
        this.x = -1; this.d = 1; this.xp = 0; this.cp = 0; this.r1 = 0; this.r2 = 0; this.p1 = 0; this.eT = 0; this.eN = 0; this.eC = 0;
        this.eP = 0; this.vd = 0; this.tG = 0; this.tC = 0; this.nzOn = false; this.fq = 0; this.fqOk = false; this.vo = 0; this.flt.zero();
      }
      os() {
        const M = this.M, fs = M.fs, h = M.h, P = this.P;
        bil1(this.rc, 0, 0, 1, 1 / (TAU * 1.5 * P.F1), 1, kBil(1.5 * P.F1, fs));
        this.smOn = fs > 60000;
        if (this.smOn) bil1(this.sm, 0, 0, 1, 1 / (TAU * 20000), 1, kBil(20000, fs));
        // NG_V rms in 0–20 kHz (white8's density law; one hash a sample, Irwin–Hall of two 16-bit uniforms: σ 26 754.9 —
        // Gaussian behind the filters)
        this.sig = NG_V * Math.sqrt(fs / 40000) / 26754.9;
        this.kA = 1 - Math.exp(-h / TA_V); this.kR = Math.exp(-h / TR_V);
        this.nG = Math.max(1, Math.round(TG_V * fs)); this.nC = Math.max(1, Math.round(TC_V * fs));
        this.nPre = Math.ceil(0.012 * fs / M.CH) * M.CH;
        this.lfo = P.MOD > 0 ? 31 / fs : 0;
        this.kn();
      }
      // the six (the memory's, glided), SENSITIVITY (read at the hit) and LEVEL → the card's coefficients
      kn() {
        const M = this.M, kv = M.kv, b = this.b, P = this.P, h = M.h;
        const t = clamp01(kv[b + 1]), dd = clamp01(kv[b + 3]), m = clamp01(kv[b + 4]), c = clamp01(kv[b + 5]);
        this.fT = P.F0 * Math.pow(P.F1 / P.F0, t); this.fN = P.N0 * Math.pow(P.N1 / P.N0, clamp01(kv[b])); this.bo = P.BO * clamp01(kv[b + 2]);
        const tau = t60V(dd) / Math.log(1000);
        this.kT = Math.exp(-h / tau); this.kN = Math.exp(-h / (0.6 * tau)); this.kPc = Math.exp(-M.CH * h / Math.min(0.3 * tau, 0.4));
        const lv = tapA(clamp01(kv[b + 7])) * P.G / VL, gD = Math.sin((1 - c) * Math.PI / 2);
        this.aT = lv * gD * Math.sin((1 - m) * Math.PI / 2); this.aN = lv * gD * Math.sin(m * Math.PI / 2); this.aC = lv * Math.sin(c * Math.PI / 2);
        this.fqOk = false;
      }
      fire(vd) {
        this.vd = vd; this.tG = this.nG; this.tC = this.nC; this.eP = 1; this.x = -1; this.d = 1; this.fqOk = false;
        this.on = true; this.qn = 0;
      }
      // a waking noise path settles over the 12 ms before absolute OS sample a, from rest, at its cutoff now
      nzWake(a) {
        const M = this.M, CH = M.CH, F = this.flt, P = this.P, S0 = this.sm[0], S1 = this.sm[1], S2 = this.sm[2], smOn = this.smOn, sig = this.sig;
        const fc = this.fN * (P.SW > 0 ? Math.pow(2, P.SW / VL * this.eN) : 1), gMx = 0.46 * M.fs;
        F.zero(); F.g = Math.tan(Math.PI / M.fs * (fc < gMx ? fc : gMx));
        let p1 = 0;
        for (let s = a - this.nPre; s < a; s += CH) {
          const lo0 = s % 4294967296, sd = hashI((s - lo0) / 4294967296 ^ this.seed), l0 = lo0 | 0;
          for (let i = 0; i < CH; i++) {
            const ah = hashI(((l0 + i) | 0) ^ sd);
            let w = ((ah & 0xffff) + (ah >>> 16) - 65535) * sig;
            if (smOn) { const ws = S0 * w + p1; p1 = S1 * w - S2 * ws; w = ws; }
            F.step(w);
          }
        }
        this.p1 = p1;
      }
      run(mb, o, n) {
        const M = this.M, CH = M.CH, e = o + n, P = this.P, F = this.flt, thr = this.thr, tap = this.tap, fTr = this.fTr;
        const R0 = this.rc[0], R1 = this.rc[1], R2 = this.rc[2], S0 = this.sm[0], S1 = this.sm[1], S2 = this.sm[2], smOn = this.smOn;
        const kA = this.kA, kT = this.kT, kN = this.kN, kR = this.kR, kPc = this.kPc, aT = this.aT, aN = this.aN, aC = this.aC, sig = this.sig;
        const f4 = 4 * M.h, fT = this.fT, fN = this.fN, sw = P.SW / VL, mod = P.MOD, lfo = this.lfo, gMx = 0.46 * M.fs, iF = Math.PI / M.fs;
        const gN0 = Math.tan(iF * (fN < gMx ? fN : gMx)), K = F.k, fbs = F.fbs, np = P.NP;
        // the SSM2044's states in locals (Ota4.step written out below: the same arithmetic, bit for bit — a test checks it)
        let s0 = F.s0, s1 = F.s1, s2 = F.s2, s3 = F.s3, y0 = F.y0, y1 = F.y1, y2 = F.y2, y3 = F.y3, kf = F.kf, ri = F.ri, h0 = F.h0, h1 = F.h1, h2 = F.h2, h3 = F.h3, g = F.g, wb = 0;
        let x = this.x, d = this.d, xp = this.xp, cp = this.cp, r1 = this.r1, r2 = this.r2, p1 = this.p1, eT = this.eT, eN = this.eN, eC = this.eC;
        let eP = this.eP, tG = this.tG, tC = this.tC, nzOn = this.nzOn, vo = this.vo;
        const vd = this.vd, bo = this.bo * (1 + P.DB * vd / VL);
        for (let c = o; c < e; c += CH) {
          const a = M.n0 + c;
          // the noise path, on while it can be heard (a wake: its pre-roll)
          const need = (aN > 0 || aC > 0) && (tG > 0 || tC > 0 || eN * aN + eC * aC >= thr);
          if (need !== nzOn) {
            if (need) { this.eN = eN; this.nzWake(a); p1 = this.p1; } else { F.zero(); p1 = 0; }
            s0 = F.s0; s1 = F.s1; s2 = F.s2; s3 = F.s3; y0 = F.y0; y1 = F.y1; y2 = F.y2; y3 = F.y3; kf = F.kf; ri = F.ri; h0 = F.h0; h1 = F.h1; h2 = F.h2; h3 = F.h3; nzOn = need;
          }
          // the pitch over the chunk: EG_P (per chunk), the snare's 31 Hz triangle (of the absolute time); linear within it
          const fA = this.fqOk ? this.fq : fT * (bo * eP > 1e-9 ? Math.pow(2, bo * eP) : 1) * (mod > 0 ? 1 + mod * triV(a * lfo) : 1);
          eP *= kPc;
          const fB = fT * (bo * eP > 1e-9 ? Math.pow(2, bo * eP) : 1) * (mod > 0 ? 1 + mod * triV((a + CH) * lfo) : 1);
          this.fq = fB; this.fqOk = true;
          let sp = fA * f4;
          const ds = (fB - fA) * f4 / CH;
          // the cutoff over the chunk (held): NOISE raised by EG_N (bass, toms), clamped at 0.46 of the OS rate
          let l0 = 0, sd = 0;
          if (nzOn) {
            g = gN0;
            if (sw * eN > 1e-9) { const fc = fN * Math.pow(2, sw * eN); g = Math.tan(iF * (fc < gMx ? fc : gMx)); }
            F.g = g; wb = g > 1 ? 1 : g > 0.09 && K > 2 ? (K < 3 ? K - 2 : 1) : 0;
            const lo0 = a % 4294967296; sd = hashI((a - lo0) / 4294967296 ^ this.seed); l0 = (lo0 | 0) - c;
          }
          let pk = 0;
          for (let i = c, ie = c + CH; i < ie; i++) {
            // the envelopes: the gates charge toward V_D, then the falls (EG_T, EG_N; the click's release)
            if (tG > 0) { tG--; if (eT < vd) eT += (vd - eT) * kA; if (eN < vd) eN += (vd - eN) * kA; } else { eT *= kT; eN *= kN; }
            if (tC > 0) { tC--; if (eC < vd) eC += (vd - eC) * kA; } else eC *= kR;
            // the VCO: ± 1 at 4 f per period; a corner inside the sample reflected, its slope change −2s / +2s rounded over the
            // two samples around it (the 2-point polyBLAMP: u³/6 before, (1 − u)³/6 after, u the time past the corner)
            const s = sp; sp += ds;
            if (fTr !== null) fTr[a + i - c] = s / f4;
            x += d * s;
            let cc = 0;
            if (x > 1) { const u = (x - 1) / s, w = 1 - u; x = 2 - x; d = -1; cp -= s * u * u * u / 3; cc = -s * w * w * w / 3; }
            else if (x < -1) { const u = (-1 - x) / s, w = 1 - u; x = -2 - x; d = 1; cp += s * u * u * u / 3; cc = s * w * w * w / 3; }
            const tv = xp + cp; xp = x; cp = cc;
            const r = R0 * tv + r1; r1 = R1 * tv - R2 * r;     // the RC²
            const tn = R0 * r + r2; r2 = R1 * r - R2 * tn;
            if (tap) { mb[i] += tn; continue; }
            // VCA_T: tanh(K tn) / K by its series (|K tn| ≤ 0.58: within 3e-4; no division)
            const qt = KVCA * KVCA * tn * tn;
            let y = aT * eT * tn * (1 - qt * (0.3333333333333333 - qt * (0.13333333333333333 - qt * 0.05396825396825397)));
            if (nzOn) {                                        // the noise → its pole → the SSM2044 → VCA_N, VCA_C
              const ah = hashI(((l0 + i) | 0) ^ sd);
              let w = ((ah & 0xffff) + (ah >>> 16) - 65535) * sig;
              if (smOn) { const ws = S0 * w + p1; p1 = S1 * w - S2 * ws; w = ws; }
              // Ota4.step(w), written out
              let e0 = 2 * s0 - y0, e1 = 2 * s1 - y1, e2 = 2 * s2 - y2, e3 = 2 * s3 - y3;
              const o0 = h0, o1 = h1, o2 = h2, o3 = h3; h0 = e0; h1 = e1; h2 = e2; h3 = e3;   // (the feedback's secants: the sample before's prediction)
              if (wb === 0) {
                // stage i at its input difference v: a = g tanh(v)/v (Padé n/m; past |v| = 3, 1/|v|); y_i = (a u + s_i) / (1 + a)
                let v, q, D, n, m;
                if (K === 0) {                                     // no feedback: straight down
                  v = w - e0; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y0 = (g * n * w + m * s0) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y0 = (g * w + m * s0) * D; }
                  v = e0 - e1; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y1 = (g * n * y0 + m * s1) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y1 = (g * y0 + m * s1) * D; }
                  v = e1 - e2; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y2 = (g * n * y1 + m * s2) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y2 = (g * y1 + m * s2) * D; }
                  v = e2 - e3; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); y3 = (g * n * y2 + m * s3) * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); y3 = (g * y2 + m * s3) * D; }
                } else {
                  // each stage's G = a / (1 + a), T = s / (1 + a); the open loop straight down (z), then the loop closed — y3 = z3 /
                  // (1 + k Gt), y_i = z_i − k y3 (G0 … G_i) — with 1 / (1 + k Gt) and the feedback's secant from the sample before
                  const k = kf;
                  let G0, T0, G1, T1, G2, T2, G3, T3;
                  v = w - k * o3 - o0; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G0 = g * n * D; T0 = m * s0 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G0 = g * D; T0 = m * s0 * D; }
                  v = o0 - o1; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G1 = g * n * D; T1 = m * s1 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G1 = g * D; T1 = m * s1 * D; }
                  v = o1 - o2; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G2 = g * n * D; T2 = m * s2 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G2 = g * D; T2 = m * s2 * D; }
                  v = o2 - o3; q = v * v;
                  if (q < 9) { n = 27 + q; m = 27 + 9 * q; D = 1 / (m + g * n); G3 = g * n * D; T3 = m * s3 * D; } else { m = v < 0 ? -v : v; D = 1 / (m + g); G3 = g * D; T3 = m * s3 * D; }
                  const z0 = G0 * w + T0, z1 = G1 * z0 + T1, z2 = G2 * z1 + T2;
                  y3 = (G3 * z2 + T3) * ri;
                  const ky = k * y3, P1 = G0 * G1, P2 = P1 * G2, kg = k * P2 * G3;
                  y0 = z0 - ky * G0; y1 = z1 - ky * P1; y2 = z2 - ky * P2;
                  ri = kg < 0.02 ? 1 - kg * (1 - kg * (1 - kg)) : 1 / (1 + kg);
                  if (fbs !== 0) { const z = K * e3 * fbs, qz = z * z; kf = qz < 9 ? K * (27 + qz) / (27 + 9 * qz) : K / (z < 0 ? -z : z); }
                }
              } else for (let it = 0; it < 2; it++) {
                if (it === 1) { e0 = y0; e1 = y1; e2 = y2; e3 = y3; }
                let k = K;
                if (fbs !== 0) { const z = K * e3 * fbs, q = z * z; k = q < 9 ? K * (27 + q) / (27 + 9 * q) : K / (z < 0 ? -z : z); }
                // stage i at its input difference v: a = g tanh(v)/v; G = a / (1 + a), d = 1 / (1 + a)
                let v = w - k * e3 - e0, q = v * v, G0, d0, G1, d1, G2, d2, G3, d3, Dv;
                if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G0 = g * nu * Dv; d0 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G0 = g * Dv; d0 = av * Dv; }
                v = e0 - e1; q = v * v;
                if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G1 = g * nu * Dv; d1 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G1 = g * Dv; d1 = av * Dv; }
                v = e1 - e2; q = v * v;
                if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G2 = g * nu * Dv; d2 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G2 = g * Dv; d2 = av * Dv; }
                v = e2 - e3; q = v * v;
                if (q < 9) { const nu = 27 + q, de = 27 + 9 * q; Dv = 1 / (de + g * nu); G3 = g * nu * Dv; d3 = de * Dv; } else { const av = v < 0 ? -v : v; Dv = 1 / (av + g); G3 = g * Dv; d3 = av * Dv; }
                const T0 = s0 * d0, T1 = s1 * d1, T2 = s2 * d2, T3 = s3 * d3, Gt = G0 * G1 * G2 * G3;
                const St = ((T0 * G1 + T1) * G2 + T2) * G3 + T3;
                let z3 = (Gt * w + St) / (1 + k * Gt);
                const u = w - k * z3;
                if (it === 1 && wb < 1) {                           // the blend zone: the two solutions mixed
                  const v0 = G0 * u + T0, v1 = G1 * v0 + T1, v2 = G2 * v1 + T2;
                  y0 = e0 + wb * (v0 - e0); y1 = e1 + wb * (v1 - e1); y2 = e2 + wb * (v2 - e2); z3 = e3 + wb * (z3 - e3);
                } else { y0 = G0 * u + T0; y1 = G1 * y0 + T1; y2 = G2 * y1 + T2; }
                y3 = z3;
                kf = k; ri = 1 / (1 + k * Gt);
              }
              s0 = 2 * y0 - s0; s1 = 2 * y1 - s1; s2 = 2 * y2 - s2; s3 = 2 * y3 - s3;
              const yf = np * y3, qf = KVCA * KVCA * yf * yf;   // the filtered noise into VCA_N / VCA_C (× NP); tanh by its series while |K y| < 0.8
              y += (aN * eN + aC * eC) * (qf < 0.64 ? yf * (1 - qf * (0.3333333333333333 - qf * (0.13333333333333333 - qf * 0.05396825396825397)))
                : qf < 9 ? yf * (27 + qf) / (27 + 9 * qf) : (yf < 0 ? -1 : 1) / KVCA);
            }
            vo = y; mb[i] += y;
            const ay = y < 0 ? -y : y;
            if (ay > pk) pk = ay;
          }
          if (eC < 1e-30) eC = 0;                              // (the click's 1 ms release under a long ring: no subnormal)
          const ev = aT * eT + (nzOn ? aN * eN + aC * eC : 0);
          if (this.quiet(Math.max(pk, ev, tG > 0 || tC > 0 ? 1 : 0))) return;
        }
        this.x = x; this.d = d; this.xp = xp; this.cp = cp; this.r1 = r1; this.r2 = r2; this.p1 = p1; this.eT = eT; this.eN = eN; this.eC = eC;
        this.eP = eP; this.tG = tG; this.tC = tC; this.nzOn = nzOn; this.vo = vo;
        F.s0 = s0; F.s1 = s1; F.s2 = s2; F.s3 = s3; F.y0 = y0; F.y1 = y1; F.y2 = y2; F.y3 = y3; F.kf = kf; F.ri = ri; F.h0 = h0; F.h1 = h1; F.h2 = h2; F.h3 = h3;
      }
    }

    /* ------------------------------------------------------------------ the machines (IMPL-7b §2.1) */
    // One shell, a descriptor per machine: its knob table (ids, defaults, the circuits each retunes), the sounds it has (the
    // 808's sound ids, IMPL-7b §1.2) and its lane → sound map; create() builds the voices, the sources, the latches, the
    // output stage and the sample rules from it. MACH.tr808 is 7a's constants, moved, not changed (ref-7a checks the bytes).
    const MACH = Object.freeze({
      tr808: Object.freeze({ id: 'tr808', KNOB_IDS, KNOB_DEF, KNOB_CIR, NK, SOUNDS, sids: Object.freeze(SOUNDS.map((s, i) => i)), LANE_S }),
      tr606: Object.freeze({ id: 'tr606', KNOB_IDS: K6_IDS, KNOB_DEF: K6_DEF, KNOB_CIR: K6_CIR, NK: K6_IDS.length, SOUNDS, sids: S6, LANE_S: LANE_S6 }),
      tr909: Object.freeze({ id: 'tr909', KNOB_IDS: K9_IDS, KNOB_DEF: K9_DEF, KNOB_CIR: K9_CIR, NK: K9_IDS.length, SOUNDS: SOUNDS9, sids: S9, LANE_S }),
      // (the SDS-V: its 40 knobs glide as the five cards' effective values — each card's six from its memory, IMPL-8 §11.5)
      sdsv: Object.freeze({ id: 'sdsv', KNOB_IDS: KV_IDS, KNOB_DEF: KV_DEF, KNOB_CIR: KV_CIR, NK: KV_IDS.length, SOUNDS, sids: SV, LANE_S: LANE_SV,
        SW_IDS: SWV_IDS, SW_DEF: SWV_DEF }),
    });
    // the output stage's static gain at a panel (bus volts → full scale; the engine's tail units across a kind or machine
    // change: IMPL-7b §1.5): MASTER VOLUME / VOLUME (50 k A) into its amplifier, the full-scale constant — post at rest
    function gain(kind, d) {
      if (kind === 'sdsv') return OUT_KV;                    // (no master knob: the track's volume, IMPL-8 §12.1)
      const v = d && d.vol >= 0 ? (d.vol < 1 ? d.vol : 1) : 0.75, lv = tapA(v);
      if (kind === 'tr606') { const P = MIX6, rl = P.VR8 * lv, rw = rl * (P.VR8 - rl) / P.VR8; return lv * P.R190 / (P.R191 + rw) * OUT_K6; }
      if (kind === 'tr909') return MIX9.VR28 * v / MIX9.RM * OUT_K9;   // VR28 (50 k B) the summing amplifier's feedback
      const P = MIX, rl = P.VR1 * lv, rw = rl * (P.VR1 - rl) / P.VR1;
      return lv * P.R76 / (P.R77 + rw) * OUT_K;
    }

    /* ------------------------------------------------------------------ the machine */
    const SPAN = 1024;                                      // the largest span in OS samples (128 frames × OS ≤ 8)
    // the chip swap's conversion (§5; create's chip-swap block below): one function for every 909 (review 1 F3 — a closure
    // per machine paid each new machine's first conversion cold, ≈ 2–3 ms in node; shared, the warm-up's warms them all)
    function conv9(e, buf, a0, n, base) {
      const lv = e.levels[0], X = lv.L, Y = lv.R && lv.R !== lv.L ? lv.R : null, len = lv.len | 0, rate = e.rate > 0 ? e.rate : base;
      const kg = rate > 2 * RATE9 ? 1 - Math.exp(-TAU * RATE9 / 2 / rate) : 1, inc = rate / RATE9, nf = Math.round(0.002 * RATE9);
      const cut = (n - 1) * inc + 1 < len;
      let pk = 0;
      for (let pass = 0; pass < 2; pass++) {
        const gq = pass ? 28 / (pk > 1e-9 ? pk : 1) : 0;
        let j = 0, yf = (Y ? 0.5 * (X[0] + Y[0]) : X[0]) * kg, y0 = yf, y1;
        yf += ((len > 1 ? (Y ? 0.5 * (X[1] + Y[1]) : X[1]) : 0) - yf) * kg; y1 = yf;
        for (let k = 0; k < n; k++) {
          const p = k * inc, q = Math.floor(p);
          while (j < q) { j++; y0 = y1; const t = j + 1 < len ? (Y ? 0.5 * (X[j + 1] + Y[j + 1]) : X[j + 1]) : 0; yf += (t - yf) * kg; y1 = yf; }
          let v = q < len ? y0 + (y1 - y0) * (p - q) : 0;
          if (cut && k >= n - nf) v *= (n - 1 - k) / nf;
          if (k === n - 1) v = 0;
          if (pass === 0) { const a = v < 0 ? -v : v; if (a > pk) pk = a; } else { const c = 32 + Math.round(v * gq); buf[a0 + k] = c < 0 ? 0 : c > 63 ? 63 : c; }
        }
      }
    }
    function create(inst, kind, opt) {
      const X = kind === undefined || kind === 'tr808' ? MACH.tr808 : kind === 'tr606' ? MACH.tr606 : kind === 'tr909' ? MACH.tr909
        : kind === 'sdsv' ? MACH.sdsv : null;
      if (X === null) return null;
      const is6 = X === MACH.tr606, is9 = X === MACH.tr909, isV = X === MACH.sdsv, is8 = !is6 && !is9 && !isV, NKX = X.NK, KDEF = X.KNOB_DEF;
      const KCIR = X.KNOB_CIR, KIDS = X.KNOB_IDS, MTX = is6 ? MT6 : MT;
      const o = opt || {};
      const base = inst && inst.base > 0 ? inst.base : (typeof sampleRate === 'number' ? sampleRate : 48000);
      const M = {
        base, OS: 1, fs: base, h: 1 / base, CH: 4, nP: 48, kv: new Float64Array(NKX), kt: new Float64Array(NKX), mv: 0,
        drum: null, snap: true, salt: 0x2545F491,
        wn: new Float64Array(SPAN), pn: new Float64Array(SPAN), lo: new Float64Array(SPAN), hi: new Float64Array(SPAN),
        s5: new Float64Array(SPAN), s6: new Float64Array(SPAN), v63: new Float64Array(SPAN), wnPeak: 0.3,
        lat: new Float64Array(16), latN: 0, lit: 0,       // latches: per sound the highest pending volts (0 = none)
        noSleep: !!o.noSleep, bankOn: !!o.bankOn, vcaOn: !!o.vcaOn, count: 0,
        n0: 0, clock: null,                               // the span's absolute OS index; the 606's tempo clock (below)
      };
      M.kv.set(KDEF); M.kt.set(KDEF);
      if (is6) {
        // the tempo clock (the 606's open hat, IMPL-7b §2.1): the Inst's drClock(F) → { t, tpf } (song ticks at frame F,
        // ticks per frame), read at absolute chunk starts; a stand-in Inst without it: 120 BPM from frame 0 [C]
        const ck = { t: 0, tpf: 0 }, tpf = 2 * 960 / base, own = inst && typeof inst.drClock === 'function' ? inst : null;
        M.clock = F => { const c = own !== null ? own.drClock(F) : null; if (c) return c; ck.t = F * tpf; ck.tpf = tpf; return ck; };
      }
      // the noise: white (the 808: a 20 kHz smoothing low-pass above 60 kHz; the 606: IC10B's pole) and pink (the PN
      // low-pass of the same density)
      const nz = { c: new Float64Array(5), p: new Float64Array(5), w: new Float64Array(3), s1: 0, s2: 0, q1: 0, q2: 0, qp: 0, sig: 0, sigB: 0, won: false, pon: false };
      const TB = []; if (!is9 && !isV) for (let k = 0; k < 6; k++) TB.push({ lo: new Float64Array(TN + 1), hi: new Float64Array(TN + 1), sq: new Float64Array(TN + 1), f: MTX.F[k], inc: 0 });
      const bank = { lon: false, hon: false, pl: 0, ph: 0, p5: 0, p6: 0, lmax: 0, lmin: 0, hmax: 0, hmin: 0, dl: 0, dlH: 0, W: 0 };
      const bd = is8 ? new BassDrum(M) : null, sd = is8 ? new Snare(M) : null, tl = is8 ? new Tom(M, 0) : null, tmm = is8 ? new Tom(M, 1) : null;
      const th = is8 ? new Tom(M, 2) : null, rs = is8 ? new RimClaves(M) : null, cp = is8 ? new Clap(M) : null, cb = is8 ? new Cowbell(M) : null;
      const cy = is8 ? new Cymbal(M) : null, oh = is8 ? new Hat(M, true) : null, chh = is8 ? new Hat(M, false) : null, ma = is8 ? new Maracas(M) : null;
      // the 606: five circuits (the tom pair and the hat pair one each, IMPL-7b §1.2)
      const b6 = is6 ? new Bd6(M) : null, s6 = is6 ? new Sd6(M) : null, t6 = is6 ? new Toms6(M) : null, c6 = is6 ? new Cy6(M) : null, h6 = is6 ? new Hats6(M) : null;
      // the 909: seven analog circuits and three ROM voices (the hats one voice, IMPL-7c §1.2), their shared state — the eight
      // accent DACs (codes, power-up N0 [C]), the noise stream of the span, the images (the scope's decoded block; a test's
      // stand-ins: opt.rom) — and the chip swap's own buffers (§5)
      if (is9 && DSH === null) DSH = dshBuild();
      const RI9 = is9 ? (o.rom ? { hh: o.rom.hh || rom9().hh, cr: o.rom.cr || rom9().cr, rd: o.rom.rd || rom9().rd } : rom9()) : null;
      const Q9 = is9 ? { dac: new Float64Array(8).fill(ACC9.N0), nz: new Float64Array(SPAN), off: 0 } : null;
      const b9 = is9 ? new Bd9(M, Q9) : null, s9 = is9 ? new Sd9(M, Q9) : null, l9 = is9 ? new Tom9(M, Q9, 0) : null, m9 = is9 ? new Tom9(M, Q9, 1) : null;
      const t9 = is9 ? new Tom9(M, Q9, 2) : null, r9 = is9 ? new Rs9(M, Q9) : null, p9 = is9 ? new Hc9(M, Q9) : null;
      const hh9 = is9 ? new Rom9(M, Q9, 0) : null, cr9 = is9 ? new Rom9(M, Q9, 1) : null, rd9 = is9 ? new Rom9(M, Q9, 2) : null;
      const SW9 = is9 ? { hh: new Uint8Array(W9), cr: new Uint8Array(W9), rd: new Uint8Array(W9), id: ['', '', '', ''], pend: false, q: -1 } : null;
      if (is9) { hh9.img = RI9.hh; cr9.img = RI9.cr; rd9.img = RI9.rd; hh9.tap = cr9.tap = rd9.tap = !!o.dacTap; }
      // the SDS-V: five cards (channels b s 1 2 3), each its own noise; the trims (memories 3 and 4: the payload's, §11.5)
      const CARDS = isV ? [new CardV(M, 0), new CardV(M, 1), new CardV(M, 2), new CardV(M, 3), new CardV(M, 4)] : null;
      const TRV = isV ? Float64Array.from(TRIMV) : null;
      // render order: the closed hat before the open hat (its C63 trace drives the choke)
      const V = isV ? CARDS : is9 ? [b9, s9, l9, m9, t9, r9, p9, hh9, cr9, rd9] : is6 ? [b6, s6, t6, c6, h6] : [bd, sd, tl, tmm, th, rs, cp, cb, cy, chh, oh, ma];
      const CIRV = is8 ? [bd, sd, tl, tmm, th, rs, cp, cb, cy, oh, chh, ma] : null;   // circuit index → voice
      // the output stage (post): per channel the summing amplifier's and the output amplifier's 220 p low-passes, the
      // coupling into MASTER VOLUME / VOLUME, the coupling into the output amplifier
      const ost = { c1: new Float64Array(3), c2: new Float64Array(3), c3: new Float64Array(3), c4: new Float64Array(3), s: new Float64Array(8), g: 0, live: 0 };
      // the sample slots (§5)
      const SL = []; for (let s = 0; s < 16; s++) SL.push({ id: '', on: false, e: null, pos: -1, inc: 1, g: 0, dk: 0, dg: 1, fP: -1, fG: 0, fN: 0, fK: 0 });
      const smpL = new Float64Array(128), smpR = new Float64Array(128);
      let smpAny = false;
      const MON = { lit: 0, act: new Float32Array(NCIR) };

      function setRate(os) {
        M.OS = os; M.fs = base * os; M.h = 1 / M.fs; M.CH = 4 * os; M.nP = Math.max(1, Math.round(1e-3 * M.fs));
        if (isV) {                                           // the cards; the mix output's coupling
          for (const v of V) v.os();
          bil1(ost.c1, 0, 1 / (TAU * HC_V), 0, 1 / (TAU * HC_V), 1, kBil(HC_V, base));
          knobOut();
          return;
        }
        if (is9) {
          // the noise register's clock over the OS rate (reduced: exact integer positions), resynced at the next use; the voices;
          // the output stage (the DC coupling, the jack's 15.9 kHz pole at the base rate)
          let a = NZ9_F, b = M.fs; while (b) { const t = a % b; a = b; b = t; }
          nz9.a = NZ9_F / a; nz9.b = M.fs / a; nz9.kv = 15 / nz9.a; nz9.pos = -1;
          for (const v of V) v.os();
          bil1(ost.c1, 0, 1 / (TAU * MIX9.HC_F), 0, 1 / (TAU * MIX9.HC_F), 1, kBil(MIX9.HC_F, base));
          const fj = 1 / (TAU * MIX9.RJ * MIX9.CJ);                   // (prewarped mid-band: within 0.1 dB to 10 kHz)
          bil1(ost.c4, 0, 0, 1, 1 / (TAU * fj), 1, kBil(Math.min(fj, 0.2 * base), base));
          knobOut();
          return;
        }
        if (is6) {
          // white: the density that puts 130 mV rms through IC10B's pole (a noise bandwidth of π/2 · FC) at its test point
          const dn = NZ6.RMS / Math.sqrt(0.5 * Math.PI * NZ6.FC);
          nz.sig = dn * Math.sqrt(0.5 * M.fs) / 37837.6; nz.sigB = dn * Math.sqrt(0.5 * base) / 37837.6;
          bil1(nz.w, 0, 0, 1, 1 / (TAU * NZ6.FC), 1, kBil(NZ6.FC, M.fs));
        } else {
          // white: the density that puts 130 mV rms in 0–20 kHz
          nz.sig = 0.13 * Math.sqrt(M.fs / 40000) / 37837.6; nz.sigB = 0.13 * Math.sqrt(base / 40000) / 37837.6;
          if (M.fs > 60000) bil2(nz.c, 0, 0, 0, 1, 1 / ((TAU * 20000) * (TAU * 20000)), Math.SQRT2 / (TAU * 20000), 1, kBil(20000, M.fs));
        }
        // pink: the unity-gain Sallen-Key low-pass (22 k, 22 k, 0.039 µ feedback, 0.018 µ to ground: ≈ 273 Hz, Q 0.74) —
        // the 808's PN filter, the 606's tom rumble filter Q309 (the same values)
        const R = 22e3, C1 = 0.039e-6, C2 = 0.018e-6;
        bil2(nz.p, 0, 0, 0, 1, R * R * C1 * C2, 2 * R * C2, 1, kBil(273, base));
        nz.won = nz.pon = false;
        buildBank();
        for (const v of V) v.os();
        if (is6) {
          const P = MIX6;
          bil1(ost.c1, 0, P.VR8 * P.C87, 0, P.VR8 * P.C87, 1, kBil(1000, base));
          bil1(ost.c3, 0, 0, 1, P.R189 * P.C86, 1, kBil(Math.min(1 / (TAU * P.R189 * P.C86), 0.45 * base), base));
          bil1(ost.c4, 0, 0, 1, P.R190 * P.C88, 1, kBil(Math.min(1 / (TAU * P.R190 * P.C88), 0.45 * base), base));
        } else {
          const kb = kBil(1000, base);
          bil1(ost.c1, 0, MIX.VR1 * MIX.C19, 0, MIX.VR1 * MIX.C19, 1, kb);
          bil1(ost.c3, 0, 0, 1, MIX.R75 * MIX.C18, 1, kBil(Math.min(1 / (TAU * MIX.R75 * MIX.C18), 0.45 * base), base));
          bil1(ost.c4, 0, 0, 1, MIX.R76 * MIX.C22, 1, kBil(Math.min(1 / (TAU * MIX.R76 * MIX.C22), 0.45 * base), base));
        }
        knobOut();
      }
      function knobOut() {
        if (isV) { ost.g = 1; return; }                      // (no master knob)
        if (is9) { ost.g = MIX9.VR28 * clamp01(M.kv[K9.vol]) / MIX9.RM; return; }   // VOLUME (VR28 50 k B) over the mix resistors: gain(), at rest
        if (is6) {                                           // VOLUME (VR8 50 k A) → R191 → IC14B (R190): gain(), at rest
          const P = MIX6, lv = tapA(clamp01(M.kv[K6.vol])), rl = P.VR8 * lv, rw = rl * (P.VR8 - rl) / P.VR8;
          bil1(ost.c2, 0, (P.R191 + rw) * P.C83, 0, (P.R191 + rw) * P.C83, 1, kBil(1000, base));
          ost.g = lv * P.R190 / (P.R191 + rw);
          return;
        }
        const lv = tapA(clamp01(M.kv[K.vol])), rl = MIX.VR1 * lv, rw = rl * (MIX.VR1 - rl) / MIX.VR1;
        bil1(ost.c2, 0, (MIX.R77 + rw) * MIX.C23, 0, (MIX.R77 + rw) * MIX.C23, 1, kBil(1000, base));
        ost.g = lv * MIX.R76 / (MIX.R77 + rw);
      }
      // the bank's steady-state tables: per oscillator its band-limited square, its 3440 Hz and its 7100 Hz band output
      function buildBank() {
        const fs = M.fs, fc = Math.min(0.45 * fs, 40000), P = MTX, H = [0, 0];
        let lmax = 0, lmin = 0, hmax = 0, hmin = 0;
        for (let k = 0; k < 6; k++) {
          const tb = TB[k], f = tb.f, d = P.DUTY;
          tb.inc = f / fs;
          for (let pass = 0; pass < 3; pass++) {
            FRE.fill(0); FIM.fill(0);
            const hm = Math.min(TN / 2 - 1, Math.floor(fc / f));
            for (let hh = 1; hh <= hm; hh++) {
              // the square 0 / 5 V, high for phase < d: c_h = 5 (1 − e^{−j2πhd}) / (j2πh)
              const tt = TAU * hh * d, cr = P.VOH * Math.sin(tt) / (TAU * hh), ci = P.VOH * (Math.cos(tt) - 1) / (TAU * hh);
              let rr = cr, ri = ci;
              if (pass > 0) {
                // the passive summing node: each oscillator through RS (808 120 k, 606 150 k) into R53 / R210 ∥ the other
                // five ∥ both band inputs
                const w = TAU * hh * f;
                const y1d = 1 + (w * P.R52 * P.C10) ** 2, y1r = (w * P.R52 * P.C10) * (w * P.C10) / y1d, y1i = (w * P.C10) / y1d;
                const y2d = 1 + (w * P.R55 * P.C11) ** 2, y2r = (w * P.R55 * P.C11) * (w * P.C11) / y2d, y2i = (w * P.C11) / y2d;
                const yr = 1 / P.R53 + 6 / P.RS + y1r + y2r, yi = y1i + y2i, ym = yr * yr + yi * yi;
                const br = (cr * yr + ci * yi) / ym / P.RS, bi = (ci * yr - cr * yi) / ym / P.RS;
                if (pass === 1) bandH(hh * f, P.R52, P.C10, P.C13, P.C14, P.R56, P.R57, H);
                else bandH(hh * f, P.R55, P.C11, P.C15, P.C16, P.R58, P.R59, H);
                rr = br * H[0] - bi * H[1]; ri = br * H[1] + bi * H[0];
              }
              FRE[hh] = rr; FIM[hh] = ri; FRE[TN - hh] = rr; FIM[TN - hh] = -ri;
            }
            ifft();
            const T = pass === 0 ? tb.sq : pass === 1 ? tb.lo : tb.hi;
            for (let i = 0; i < TN; i++) T[i] = FRE[i];
            T[TN] = T[0];
            let mx = -1e9, mn = 1e9; for (let i = 0; i < TN; i++) { if (T[i] > mx) mx = T[i]; if (T[i] < mn) mn = T[i]; }
            if (pass === 1) { lmax += mx; lmin += mn; } else if (pass === 2) { hmax += mx; hmin += mn; }
            if (pass === 0) {
              // the cowbell's divider (≈ 1/16) into C32 / C33, relative to the top the base junction clamps (10 µ / 470 k:
              // the clamp level is the square's top)
              const kd = CB.R63 / (CB.R62 + CB.R63);
              for (let i = 0; i <= TN; i++) T[i] = (T[i] - mx) * kd;
            }
          }
        }
        bank.lmax = lmax; bank.lmin = lmin; bank.hmax = hmax; bank.hmin = hmin;
        // the coupled bases' leak (the 808: 22 n, 2 M from 15 V; the 606: the low band's 47 n / 1 M, the high band's 1 µ /
        // 1 M) and the window that bounds the peak tracker's memory: an older peak has leaked by more than the band's whole
        // range, so a tracker restarted that far back is the same bytes
        if (is6) {
          bank.dl = M.h * (B15 - VBE) / MT6.RL / MT6.CL; bank.dlH = M.h * (B15 - VBE) / MT6.RH / MT6.CH;
          bank.W = Math.ceil(Math.max((lmax - lmin) / bank.dl, (hmax - hmin) / bank.dlH)) + 4;
        } else {
          bank.dl = bank.dlH = M.h * (B15 - VBE) / MT.RB / MT.CC;
          bank.W = Math.ceil(Math.max(lmax - lmin, hmax - hmin) / bank.dl) + 4;
        }
        bank.lon = bank.hon = false;
      }
      // the bands for OS samples [i0, i0 + n) of a span starting at absolute index n0 (need: 1 low band, 2 high band):
      // the six oscillators' tables read in one pass; each phase anchored at every chunk from the absolute index (so the
      // same sample reads the same bytes whatever the span), stepped within it
      const tph = (k, a) => { const p = a * TB[k].inc; return (p - Math.floor(p)) * TN; };
      function band1(a0, i0, n, hb, out) {
        const T0 = hb ? TB[0].hi : TB[0].lo, T1 = hb ? TB[1].hi : TB[1].lo, T2 = hb ? TB[2].hi : TB[2].lo;
        const T3 = hb ? TB[3].hi : TB[3].lo, T4 = hb ? TB[4].hi : TB[4].lo, T5 = hb ? TB[5].hi : TB[5].lo;
        const d0 = TB[0].inc * TN, d1 = TB[1].inc * TN, d2 = TB[2].inc * TN, d3 = TB[3].inc * TN, d4 = TB[4].inc * TN, d5 = TB[5].inc * TN;
        for (let c = i0, ce = i0 + n, CH = M.CH; c < ce; c += CH) {
          const a = a0 + c - i0;
          let x0 = tph(0, a), x1 = tph(1, a), x2 = tph(2, a), x3 = tph(3, a), x4 = tph(4, a), x5 = tph(5, a);
          for (let i = c, e = c + CH; i < e; i++) {
            const j0 = x0 | 0, j1 = x1 | 0, j2 = x2 | 0, j3 = x3 | 0, j4 = x4 | 0, j5 = x5 | 0;
            const v0 = T0[j0] + (T0[j0 + 1] - T0[j0]) * (x0 - j0), v1 = T1[j1] + (T1[j1 + 1] - T1[j1]) * (x1 - j1);
            const v2 = T2[j2] + (T2[j2 + 1] - T2[j2]) * (x2 - j2), v3 = T3[j3] + (T3[j3 + 1] - T3[j3]) * (x3 - j3);
            const v4 = T4[j4] + (T4[j4 + 1] - T4[j4]) * (x4 - j4), v5 = T5[j5] + (T5[j5 + 1] - T5[j5]) * (x5 - j5);
            out[i] = ((v0 + v1) + (v2 + v3)) + (v4 + v5);
            x0 += d0; if (x0 >= TN) x0 -= TN; x1 += d1; if (x1 >= TN) x1 -= TN; x2 += d2; if (x2 >= TN) x2 -= TN;
            x3 += d3; if (x3 >= TN) x3 -= TN; x4 += d4; if (x4 >= TN) x4 -= TN; x5 += d5; if (x5 >= TN) x5 -= TN;
          }
        }
      }
      function bandRange(n0, i0, n, need, outLo, outHi) {
        if (need & 1) band1(n0 + i0, i0, n, false, outLo);
        if (need & 2) band1(n0 + i0, i0, n, true, outHi);
      }
      // the peak trackers of the coupled bases, restarted over 2W samples before n0 (exact: see buildBank)
      const pre = new Float64Array(SPAN), pre2 = new Float64Array(SPAN);
      function bandWake(n0, need) {
        const CH = M.CH, W = 2 * bank.W, dl = bank.dl, dlH = bank.dlH;
        let s = n0 - W; s -= ((s % CH) + CH) % CH;
        let pl = -1e9, ph = -1e9;
        while (s < n0) {
          const m = Math.min(SPAN, n0 - s);
          bandRange(s, 0, m, need, pre, pre2);
          if (need & 1) for (let i = 0; i < m; i++) pl = Math.max(pl - dl, pre[i]);
          if (need & 2) for (let i = 0; i < m; i++) ph = Math.max(ph - dlH, pre2[i]);
          s += m;
        }
        if (need & 1) { bank.pl = pl; bank.lon = true; }
        if (need & 2) { bank.ph = ph; bank.hon = true; }
      }
      function bands(n0, i0, n, need) {
        const wk = (need & 1 && !bank.lon ? 1 : 0) | (need & 2 && !bank.hon ? 2 : 0);
        if (wk) bandWake(n0 + i0, wk);
        bandRange(n0, i0, n, need, M.lo, M.hi);
        const dl = bank.dl, dlH = bank.dlH, lo = M.lo, hi = M.hi;
        if (need & 1) { let pl = bank.pl; for (let i = i0, e = i0 + n; i < e; i++) { pl = Math.max(pl - dl, lo[i]); lo[i] -= pl; } bank.pl = pl; }
        if (need & 2) { let ph = bank.ph; for (let i = i0, e = i0 + n; i < e; i++) { ph = Math.max(ph - dlH, hi[i]); hi[i] -= ph; } bank.ph = ph; }
      }
      function squares(n0, i0, n) {
        const S5 = TB[4].sq, S6 = TB[5].sq, o5 = M.s5, o6 = M.s6, d5 = TB[4].inc * TN, d6 = TB[5].inc * TN, CH = M.CH;
        for (let c = i0, ce = i0 + n; c < ce; c += CH) {
          let x5 = tph(4, n0 + c), x6 = tph(5, n0 + c);
          for (let i = c, e = c + CH; i < e; i++) {
            const j5 = x5 | 0, j6 = x6 | 0;
            o5[i] = S5[j5] + (S5[j5 + 1] - S5[j5]) * (x5 - j5); o6[i] = S6[j6] + (S6[j6 + 1] - S6[j6]) * (x6 - j6);
            x5 += d5; if (x5 >= TN) x5 -= TN; x6 += d6; if (x6 >= TN) x6 -= TN;
          }
        }
      }
      // white noise for samples [i0, i0 + n) of a span at absolute index n0: Irwin–Hall of four 16-bit uniforms from two
      // hashes of the index (chunk by chunk, so a span never straddles a 2^32 boundary of the index)
      function white8(n0, i0, n, wn) {
        const sig = nz.sig, c = nz.c, sm = M.fs > 60000, CH = M.CH;
        let s1 = nz.s1, s2 = nz.s2;
        for (let cs = i0, ce = i0 + n; cs < ce; cs += CH) {
          const a0 = n0 + cs, lo0 = a0 % 4294967296, sd = hash32(((a0 - lo0) / 4294967296 ^ M.salt) >>> 0);
          for (let i = cs, e = cs + CH; i < e; i++) {
            const a = hash32(((lo0 + i - cs) ^ sd) >>> 0), b = hash32((a ^ 0x9E3779B9) >>> 0);
            const v = ((a & 0xffff) + (a >>> 16) + (b & 0xffff) + (b >>> 16) - 131070) * sig;
            if (sm) { const y = c[0] * v + s1; s1 = c[1] * v - c[3] * y + s2; s2 = c[2] * v - c[4] * y; wn[i] = y; } else wn[i] = v;
          }
        }
        nz.s1 = s1; nz.s2 = s2;
      }
      // the 606's: the same hashed density through IC10B's pole (≈ 7.2 kHz, prewarped)
      function white6(n0, i0, n, wn) {
        const sig = nz.sig, w = nz.w, w0 = w[0], w1 = w[1], w2 = w[2], CH = M.CH;
        let s1 = nz.s1;
        for (let cs = i0, ce = i0 + n; cs < ce; cs += CH) {
          const a0 = n0 + cs, lo0 = a0 % 4294967296, sd = hash32(((a0 - lo0) / 4294967296 ^ M.salt) >>> 0);
          for (let i = cs, e = cs + CH; i < e; i++) {
            const a = hash32(((lo0 + i - cs) ^ sd) >>> 0), b = hash32((a ^ 0x9E3779B9) >>> 0);
            const v = ((a & 0xffff) + (a >>> 16) + (b & 0xffff) + (b >>> 16) - 131070) * sig;
            const y = w0 * v + s1; s1 = w1 * v - w2 * y; wn[i] = y;
          }
        }
        nz.s1 = s1;
      }
      const whiteRange = is6 ? white6 : white8;
      // pink noise (the 273 Hz low-pass of the same density) at the base rate, from its own hash of the absolute frame,
      // interpolated to the OS samples (it has no content near the base Nyquist)
      function pinkRange(n0, i0, n, pn) {
        const OS = M.OS, sig = nz.sigB, p = nz.p, P0 = p[0], P1 = p[1], P2 = p[2], P3 = p[3], P4 = p[4], iO = 1 / OS;
        let q1 = nz.q1, q2 = nz.q2, qp = nz.qp, i = i0;
        const f0 = (n0 + i0) / OS, salt = (M.salt ^ 0x5BD1E995) >>> 0;
        for (let f = f0, fe = f0 + n / OS; f < fe; f++) {
          const lo = f % 4294967296, a = hash32((lo ^ hash32(((f - lo) / 4294967296 ^ salt) >>> 0)) >>> 0), b = hash32((a ^ 0x9E3779B9) >>> 0);
          const v = ((a & 0xffff) + (a >>> 16) + (b & 0xffff) + (b >>> 16) - 131070) * sig;
          const y = P0 * v + q1; q1 = P1 * v - P3 * y + q2; q2 = P2 * v - P4 * y;
          for (let r = 1; r <= OS; r++) pn[i++] = qp + (y - qp) * r * iO;
          qp = y;
        }
        nz.q1 = q1; nz.q2 = q2; nz.qp = qp;
      }
      // a waking noise filter settles over the 12 ms before n0 from rest (a function of time only)
      function noiseWake(n0, white, pink) {
        const CH = M.CH;
        let s = n0 - Math.ceil(0.012 * M.fs); s -= ((s % CH) + CH) % CH;
        if (white) { nz.s1 = nz.s2 = 0; nz.won = true; }
        if (pink) { nz.q1 = nz.q2 = nz.qp = 0; nz.pon = true; }
        let pk = 0;
        for (let t = s; t < n0;) {
          const m = Math.min(SPAN, n0 - t);
          if (white) { whiteRange(t, 0, m, pre); for (let i = 0; i < m; i++) pk = Math.max(pk, pre[i]); }
          if (pink) pinkRange(t, 0, m, pre2);
          t += m;
        }
        if (white) M.wnPeak = pk;
      }
      function sources8(n0, i0, n) {
        const pink = (tl.on && tl.var === 0) || (tmm.on && tmm.var === 0) || (th.on && th.var === 0);
        const white = sd.on || cp.on || ma.on;
        if ((white && !nz.won) || (pink && !nz.pon)) noiseWake(n0 + i0, white && !nz.won, pink && !nz.pon);
        if (white) whiteRange(n0, i0, n, M.wn);
        if (pink) pinkRange(n0, i0, n, M.pn);
        const need = M.bankOn ? 3 : (cy.on ? 3 : 0) | (oh.on || chh.on ? 2 : 0);
        if (need) bands(n0, i0, n, need);
        if (cb.on) squares(n0, i0, n);
        M.v63.fill(0, i0, i0 + n);
      }
      // after the voices: a source with no live consumer left restarts from its pre-roll when one wakes
      function sourcesOff8() {
        if (!(sd.on || cp.on || ma.on)) nz.won = false;
        if (!((tl.on && tl.var === 0) || (tmm.on && tmm.var === 0) || (th.on && th.var === 0))) nz.pon = false;
        if (M.bankOn) return;
        if (!cy.on) bank.lon = false;
        if (!(cy.on || oh.on || chh.on)) bank.hon = false;
      }
      // the 606: the snare takes the white noise, the toms' rumble the pink, the cymbal both bands, the hats the high one
      function sources6(n0, i0, n) {
        const white = s6.on, pink = t6.on;
        if ((white && !nz.won) || (pink && !nz.pon)) noiseWake(n0 + i0, white && !nz.won, pink && !nz.pon);
        if (white) whiteRange(n0, i0, n, M.wn);
        if (pink) pinkRange(n0, i0, n, M.pn);
        const need = M.bankOn ? 3 : (c6.on ? 3 : 0) | (h6.on ? 2 : 0);
        if (need) bands(n0, i0, n, need);
        if (M.vcaOn) { M.lo.fill(0, i0, i0 + n); M.hi.fill(0, i0, i0 + n); }
      }
      function sourcesOff6() {
        if (!s6.on) nz.won = false;
        if (!t6.on) nz.pon = false;
        if (M.bankOn) return;
        if (!c6.on) bank.lon = false;
        if (!(c6.on || h6.on)) bank.hon = false;
      }
      // the 909's noise (R9 §7): the register's bits as a function of absolute time — OS sample i covers bit positions
      // [i·a / b, (i + 1)·a / b) (a / b = f_clk / fs reduced: integer arithmetic, no drift whatever splits the spans, review #24);
      // each sample takes the mean of the bits inside it (the box integral of the 0 / 15 V stream), less its 7.5 V mean; the
      // salt an offset into the sequence (hashed: two salts sit ≈ 2³⁰ bits apart, uncorrelated). It runs while a consumer listens (the BD's click, the snare's noise, a tom's band,
      // the clap); a start elsewhere than where it stopped (a wake, an OS change, a seek) jumps the register there.
      const nz9 = { a: 1, b: 1, kv: 0, w: 0, cur: 0, r: 1, pos: -1 };
      function noise9(n0, i0, n, out) {
        const a = nz9.a, b = nz9.b, kv = nz9.kv, s0 = n0 + i0;
        let w = nz9.w, cur = nz9.cur, r = nz9.r;
        if (nz9.pos !== s0) {
          const U = s0 * a, k = Math.floor(U / b);
          w = win9(31 + Q9.off + k); cur = ((w >>> 12) ^ (w >>> 30)) & 1; w = ((w << 1) | cur) & 0x7FFFFFFF; r = b - (U - k * b);
        }
        for (let i = i0, ie = i0 + n; i < ie; i++) {
          let need = a, sum = 0;
          while (need >= r) { sum += cur * r; need -= r; cur = ((w >>> 12) ^ (w >>> 30)) & 1; w = ((w << 1) | cur) & 0x7FFFFFFF; r = b; }
          sum += cur * need; r -= need;
          out[i] = sum * kv - 7.5;
        }
        nz9.w = w; nz9.cur = cur; nz9.r = r; nz9.pos = s0 + n;
      }
      function sources9(n0, i0, n) { if (b9.nzOn || s9.nzOn || l9.nzOn || m9.nzOn || t9.nzOn || p9.on) noise9(n0, i0, n, Q9.nz); }
      function sourcesOff9() {}
      function sourcesV() {}                                 // (the SDS-V: each card its own noise)
      const sources = isV ? sourcesV : is9 ? sources9 : is6 ? sources6 : sources8, sourcesOff = isV ? sourcesV : is9 ? sourcesOff9 : is6 ? sourcesOff6 : sourcesOff8;

      // the knob targets, read once per span (set() and the modulation adapter write p.drum between spans)
      const kd = x => { const t = +x; return t === t ? (t < 0 ? 0 : t > 1 ? 1 : t) : -1; };
      function readTargets() {
        const d = M.drum, kt = M.kt;
        if (isV) { readTargetsV(d, kt); return; }
        if (d && !is8) {
          for (let i = 0; i < NKX; i++) { const t = kd(d[KIDS[i]]); kt[i] = t < 0 ? KDEF[i] : t; }
        } else if (d) {
          kt[0] = kd(d.ac); kt[1] = kd(d.bdl); kt[2] = kd(d.bdt); kt[3] = kd(d.bdd); kt[4] = kd(d.sdl); kt[5] = kd(d.sdt);
          kt[6] = kd(d.sds); kt[7] = kd(d.ltl); kt[8] = kd(d.ltt); kt[9] = kd(d.mtl); kt[10] = kd(d.mtt); kt[11] = kd(d.htl);
          kt[12] = kd(d.htt); kt[13] = kd(d.rsl); kt[14] = kd(d.cpl); kt[15] = kd(d.cbl); kt[16] = kd(d.cyl); kt[17] = kd(d.cyt);
          kt[18] = kd(d.cyd); kt[19] = kd(d.ohl); kt[20] = kd(d.ohd); kt[21] = kd(d.chl); kt[22] = kd(d.vol);
          for (let i = 0; i < NK; i++) if (kt[i] < 0) kt[i] = KNOB_DEF[i];
        } else kt.set(KDEF);
        let mv = 0;
        for (let i = 0; i < NKX; i++) if (kt[i] !== M.kv[i]) { mv = 1; break; }
        M.mv = mv;
      }
      // the SDS-V's targets (IMPL-8 §11.5): per card its memory's six — 1 the factory sound (FACTV), 2 the knobs, 3 and 4 the
      // trims (the payload's) — and the mixer's SENSITIVITY and LEVEL (every memory); a memory switch glides like a knob
      const memV = s => { const t = typeof s === 'number' ? s : typeof s === 'string' && s !== '' ? +s : NaN; return t === 0 || t === 1 || t === 2 || t === 3 ? t : 1; };
      function readTargetsV(d, kt) {
        for (let c = 0; c < 5; c++) {
          const b = 8 * c, mem = d ? memV(d[SWV_IDS[c]]) : 1;
          for (let f = 0; f < 8; f++) {
            let t;
            if (f < 6 && mem !== 1) t = mem === 0 ? FACTV[6 * c + f] : TRV[12 * c + 6 * (mem - 2) + f];
            else { t = d ? kd(d[KIDS[b + f]]) : -1; if (t < 0) t = KDEF[b + f]; }
            kt[b + f] = t;
          }
        }
        let mv = 0;
        for (let i = 0; i < NKX; i++) if (kt[i] !== M.kv[i]) { mv = 1; break; }
        M.mv = mv;
      }
      // the payload's trims (5 channels × memories 3, 4 × the six, 0…1; a missing or foreign value: the default) — no allocation
      function trimV(t) {
        for (let c = 0; c < 5; c++) {
          const tc = t && typeof t === 'object' ? t[c] : null;
          for (let j = 0; j < 2; j++) {
            const r = tc && typeof tc === 'object' ? tc[j] : null;
            for (let f = 0; f < 6; f++) {
              const x = r && typeof r === 'object' ? +r[f] : NaN, o = 12 * c + 6 * j + f;
              TRV[o] = x === x ? (x < 0 ? 0 : x > 1 ? 1 : x) : TRIMV[o];
            }
          }
        }
      }
      // one chunk's glide (≈ 5 ms to the target; the first set() snaps); returns the circuits to retune
      const kS = 1 - Math.exp(-4 / (base * 0.005));
      function glide() {
        const kt = M.kt, kv = M.kv;
        let mask = 0, mv = 0;
        for (let i = 0; i < NKX; i++) {
          const t = kt[i], v = kv[i];
          if (v === t) continue;
          let nv = M.snap ? t : v + (t - v) * kS;
          if (Math.abs(t - nv) < 1e-6) nv = t; else mv = 1;
          kv[i] = nv; mask |= KCIR[i];
        }
        M.snap = false; M.mv = mv;
        return mask;
      }
      function retune(mask) {
        if (isV) { for (let c = 0; c < 5; c++) if (mask & (1 << c)) CARDS[c].kn(); return; }
        if (is9) {
          if (mask & 1) b9.kn(); if (mask & 2) s9.kn(); if (mask & 4) l9.kn(); if (mask & 8) m9.kn(); if (mask & 16) t9.kn();
          if (mask & 32) r9.kn(); if (mask & 64) p9.kn(); if (mask & 128) hh9.kn(); if (mask & 256) cr9.kn(); if (mask & 512) rd9.kn();
          if (mask & (1 << 30)) knobOut();
          return;
        }
        if (is6) {
          if (mask & 1) b6.kn(); if (mask & 2) s6.kn(); if (mask & 4) t6.kn(); if (mask & 8) c6.kn(); if (mask & 16) h6.kn();
          if (mask & (1 << 30)) knobOut();
          return;
        }
        if (mask & 1) bd.kn(); if (mask & 2) sd.kn(); if (mask & 4) tl.kn(); if (mask & 8) tmm.kn(); if (mask & 16) th.kn();
        if (mask & 32) rs.kn(); if (mask & 64) cp.kn(); if (mask & 128) cb.kn(); if (mask & 256) cy.kn();
        if (mask & 512) oh.kn(); if (mask & 1024) chh.kn(); if (mask & 2048) ma.kn(); if (mask & (1 << 30)) knobOut();
      }
      // the drum object's accent and switches now (hits and steps latch with the panel as it is at their frame)
      function acNow() { const d = M.drum, t = d ? +d.ac : NaN; return t === t ? (t < 0 ? 0 : t > 1 ? 1 : t) : KDEF[0]; }
      function swNow(i) { const d = M.drum, s = d ? d[SW_IDS[i]] : 0; return s === 1 || s === '1' || s === true ? 1 : 0; }
      function latch(s, Vv) { if (Vv > M.lat[s]) M.lat[s] = Vv; M.latN = 1; }
      // the latched hits, in lane (sound) order; per circuit the highest volts; a one-circuit pair: the switch's sound
      function apply8() {
        const lat = M.lat;
        for (let s = 0; s < 16; s++) {
          const Vv = lat[s];
          if (!(Vv > 0)) continue;
          const q = S_PAIR[s];
          if (q >= 0 && lat[q] > 0) {                        // both sounds of a one-circuit pair: the panel switch's
            const pick = swNow(S_SW[s]) === 1 ? (s >= 11 ? s : q) : (s >= 11 ? q : s);
            if (pick !== s) continue;
          }
          // the CH → OH choke whatever plays either (§5, review 1 F3): a CH hit cuts an OH sample; a CH sample still fires
          // the closed hat's circuit, muted — its C63 holds an OH circuit down as a sounding CH does (not needed while the
          // OH plays its own sample and its circuit is asleep: nothing reads C63 then)
          if (s === 10) smpCut(SL[9]);
          if (smpHit(s, Vv)) { if (s === 10 && (oh.on || !SL[9].on || SL[9].e === null)) { chh.mute = true; chh.fire(Vv); } continue; }
          if (s === 10) chh.mute = false;
          M.lit |= 1 << s;
          const v = CIRV[S_CIR[s]];
          if (v === tl || v === tmm || v === th || v === rs) v.fire(Vv, S_VAR[s]); else v.fire(Vv);
        }
        lat.fill(0); M.latN = 0;
      }
      // the 606's latched hits in lane order (BD SD LT HT CY OH CH: the CH's choke after the OH's trigger); the tom pair and
      // the hat pair are one circuit each, both of a pair fire (the circuit decides what "together" sounds like)
      function apply6() {
        const lat = M.lat;
        for (let k = 0; k < 7; k++) {
          const s = S6[k], Vv = lat[s];
          if (!(Vv > 0)) continue;
          // the CH → OH choke whatever plays either (7a review 1 F3): a CH sample fires the closed hat's side muted (its
          // C42 holds Q25 on, which drains C45) while an OH circuit can sound
          if (s === 10) smpCut(SL[9]);
          if (smpHit(s, Vv)) { if (s === 10 && (h6.on || !SL[9].on || SL[9].e === null)) h6.fire(Vv, true, true); continue; }
          M.lit |= 1 << s;
          if (s === 0) b6.fire(Vv); else if (s === 1) s6.fire(Vv); else if (s === 2 || s === 4) t6.fire(Vv, s === 4);
          else if (s === 8) c6.fire(Vv); else h6.fire(Vv, s === 10, false);
        }
        lat.fill(0); M.latN = 0;
      }
      // the 909's latched hits (codes + 1), in lane order: the DACs first — each written with the highest code latched on it
      // (7a's "highest volts wins"; a shared DAC: both voices read it) —, then the triggers; the hats one voice: an OH and a CH
      // in one chunk play the closed hat (its trigger last, IMPL-7c §1.2). An analog sound's sample slot plays instead of its
      // circuit (7a §5); a ROM sound's slot is its chip (the voice plays the swapped image, §5)
      function apply9() {
        const lat = M.lat, dac = Q9.dac;
        let wr = 0;
        for (let s = 0; s < 11; s++) {
          if (!(lat[s] > 0)) continue;
          const d = DAC_OF9[s], c = lat[s] - 1;
          if (!((wr >> d) & 1) || c > dac[d]) dac[d] = c;
          wr |= 1 << d;
        }
        for (let s = 0; s < 11; s++) {
          if (!(lat[s] > 0)) continue;
          const code = dac[DAC_OF9[s]];
          if (s < 7 && smpHit(s, code)) continue;
          M.lit |= 1 << s;
          if (s === 0) b9.fire(code); else if (s === 1) s9.fire(code); else if (s === 2) l9.fire(code); else if (s === 3) m9.fire(code);
          else if (s === 4) t9.fire(code); else if (s === 5) r9.fire(code); else if (s === 6) p9.fire(); else if (s === 7) rd9.fire();
          else if (s === 8) cr9.fire(); else if (s === 9) { if (!(lat[10] > 0)) hh9.fire(false); } else hh9.fire(true);
        }
        lat.fill(0); M.latN = 0;
      }
      // the SDS-V's latched hits (pad volts), in sound order: each channel's SENSITIVITY now → V_D; the comparator (a soft hit
      // at a low SENSITIVITY fires nothing, P-4); a slot plays instead of its card (§12.5)
      function applyV() {
        const lat = M.lat, kv = M.kv;
        for (let s = 0; s < 5; s++) {
          const vp = lat[s];
          if (!(vp > 0)) continue;
          const c = CH_OF_V[s], vd = vDyn(vp, clamp01(kv[8 * c + 6]));
          if (!(vd > VCMP)) continue;
          if (smpHit(s, vd)) continue;
          M.lit |= 1 << s;
          CARDS[c].fire(vd);
        }
        lat.fill(0); M.latN = 0;
      }
      const apply = isV ? applyV : is9 ? apply9 : is6 ? apply6 : apply8;
      function anyOn() { for (let k = 0; k < V.length; k++) if (V[k].on) return true; return false; }

      // ---- the sample slots (§5): stored entries read lazily (SxBase.getAsset), played at the base rate in post()
      const SMP_LEVEL = 1.75;                                // a full-scale sample ≈ the circuits' 3.5 Vp-p at full level
      function smpHit(s, Vv) {
        const sl = SL[s];
        if (!sl.on) return false;
        if (!sl.e) { const SB = globalThis.SxBase, e = SB && SB.getAsset ? SB.getAsset(sl.id) : null; sl.e = e && e.kind === 'smp' && e.levels && e.levels.length ? e : null; }
        if (!sl.e) return false;
        M.lit |= 1 << s;
        smpCut(sl);                                          // the old one fades over 2 ms
        sl.pos = 0; sl.dg = 1;
        // the hit's volts as gain: 7a's law with the machine's V_N and accent ceiling (the 606: V_A at ACCENT 10)
        // (the 909: Vv is the hit's DAC code — below N0 proportional, N0 → 1, both at full TOTAL ACCENT → +4 dB, IMPL-7c §5)
        // (the SDS-V: Vv is the hit's V_D — below VK_V proportional, then up to + 0.6 at the limit, IMPL-8 §12.5)
        const gv = isV ? (Vv <= VK_V ? Vv / VK_V : 1 + 0.6 * (Vv - VK_V) / (VL - VK_V)) * SMP_LEVELV
          : is9 ? (Vv <= ACC9.N0 ? Vv / ACC9.N0 : 1 + (SMP_ACC9 - 1) * (Vv - ACC9.N0) / (CBOTH9 - ACC9.N0)) * SMP_LEVEL9
          : is6 ? (Vv <= V_N6 ? Vv / V_N6 : 1 + 0.6 * (Vv - V_N6) / (V_X6 - V_N6)) * SMP_LEVEL6 : (Vv <= V_N ? Vv / V_N : 1 + 0.6 * (Vv - V_N) / (V_X - V_N)) * SMP_LEVEL;
        sl.g = gv / (sl.e.peak > 1e-6 ? sl.e.peak : 1);
        smpAny = true;
        return true;
      }
      // a slot's sounding sample handed to its 2 ms fade (a restart, the CH → OH choke)
      function smpCut(sl) { if (sl.pos >= 0) { sl.fP = sl.pos; sl.fG = sl.g * sl.dg; sl.fN = sl.fK = Math.max(1, Math.round(0.002 * base)); sl.pos = -1; } }
      function smpRender(n) {
        smpL.fill(0, 0, n); smpR.fill(0, 0, n);
        let any = false;
        const kv = M.kv;
        for (let s = 0; s < 16; s++) {
          const sl = SL[s], e = sl.e;
          if (!e || (sl.pos < 0 && sl.fN === 0)) continue;
          any = true;
          let lvl, tune = 0, dk;
          if (isV) {
            // the SDS-V (IMPL-8 §12.5): its channel's LEVEL (audio taper), TONE ± 1 octave at its centre, DECAY a fade only below 5
            // — the values the channel's memory gives
            const b = 8 * CH_OF_V[s], u = clamp01(kv[b + 3]);
            lvl = tapA(clamp01(kv[b + 7]));
            tune = (clamp01(kv[b + 1]) - 0.5) * 2;
            dk = u >= 0.5 ? 0 : 1 / Math.max(1, (0.03 + u * 3) * base);
          } else if (is9) {
            // the 909 (IMPL-7c §5): its LEVEL (the voice's 50 / 100 k B pot: linear, as the circuit's), TUNE ± 1 octave at 5 (BD, SD,
            // toms), DECAY a fade only below 5 (BD, toms: 0 = 30 ms; 5 and up the whole sound)
            const lk = S9_LEV[s], tk = S9_TUN[s], dk9 = S9_DEC[s];
            lvl = lk >= 0 ? clamp01(kv[lk]) : 0;
            if (tk >= 0) tune = (clamp01(kv[tk]) - 0.5) * 2;
            const u = dk9 >= 0 ? clamp01(kv[dk9]) : 1;
            dk = u >= 0.5 ? 0 : 1 / Math.max(1, (0.03 + u * 3) * base);
          } else if (is6) {
            // the 606 (IMPL-7b §5): its LEVEL (a 50 k B pot: the pair's shared one), TUNE ± 1 octave at 5, DECAY a fade only
            // below 5 (0 = 30 ms; 5 and up the whole sound)
            const lk = S6_LEV[s], tk = S6_TUN[s], dk6 = S6_DEC[s];
            lvl = lk >= 0 ? clamp01(kv[lk]) : 0;
            if (tk >= 0) tune = (clamp01(kv[tk]) - 0.5) * 2;
            const u = dk6 >= 0 ? clamp01(kv[dk6]) : 1;
            dk = u >= 0.5 ? 0 : 1 / Math.max(1, (0.03 + u * 3) * base);
          } else {
            const c = S_CIR[s];
            lvl = tapA(clamp01(kv[LEVEL_OF[c]])) * mixG(MIX.R75);   // its LEVEL and its bus share
            if (c >= 2 && c <= 4) tune = (clamp01(kv[c === 2 ? K.ltt : c === 3 ? K.mtt : K.htt]) - 0.5) * 2;
            const dkk = c === 0 ? kv[K.bdd] : c === 8 ? kv[K.cyd] : c === 9 ? kv[K.ohd] : 1;
            dk = dkk >= 1 ? 0 : 1 / Math.max(1, (0.03 + dkk * 1.5) * base);   // DECAY: a fade from 30 ms (0) to none (10)
          }
          const inc = e.rate / base * Math.pow(2, tune), lv = inc > 1.5 && e.levels.length > 1 ? 1 : 0, L = e.levels[lv];
          const Lb = L.L, Rb = L.R || L.L, len = L.len, sc = lv ? 0.5 : 1;
          for (let i = 0; i < n; i++) {
            if (sl.fN > 0) {                                   // the 2 ms fade of a restarted sound
              const x = sl.fP * sc, j = x | 0;
              if (j + 1 < len) { const f = x - j, k = sl.fG * lvl * sl.fN / sl.fK; smpL[i] += (Lb[j] + (Lb[j + 1] - Lb[j]) * f) * k; smpR[i] += (Rb[j] + (Rb[j + 1] - Rb[j]) * f) * k; }
              sl.fP += inc; sl.fN--;
            }
            if (sl.pos < 0) continue;
            const x = sl.pos * sc, j = x | 0;
            if (j + 1 >= len) { sl.pos = -1; continue; }
            const f = x - j, k = sl.g * sl.dg * lvl;
            smpL[i] += (Lb[j] + (Lb[j + 1] - Lb[j]) * f) * k; smpR[i] += (Rb[j] + (Rb[j + 1] - Rb[j]) * f) * k;
            if (dk > 0) { sl.dg -= dk; if (sl.dg <= 0) { sl.pos = -1; continue; } }
            sl.pos += inc;
          }
        }
        return any;
      }

      // the output stage: the summing amplifier's 220 p, the coupling into MASTER VOLUME, the output amplifier, its rails
      function post8(L, R, mono, n) {
        const st = smpAny ? (smpAny = smpRender(n)) : false;
        const c1 = ost.c1, c2 = ost.c2, c3 = ost.c3, c4 = ost.c4, s = ost.s, g = ost.g, rail2 = MIX.RAIL;
        let pk = 0;
        for (let ch = 0; ch < (st ? 2 : 1); ch++) {
          const out = ch === 0 ? L : R, sx = ch === 0 ? smpL : smpR, b = 4 * ch;
          let s0 = s[b], s1 = s[b + 1], s2 = s[b + 2], s3 = s[b + 3];
          for (let i = 0; i < n; i++) {
            const x0 = st ? mono[i] + sx[i] : mono[i];
            const y3 = c3[0] * x0 + s2; s2 = c3[1] * x0 - c3[2] * y3;        // IC4a's 220 p
            const y1 = c1[0] * y3 + s0; s0 = c1[1] * y3 - c1[2] * y1;        // C19 into VR1
            const y2 = c2[0] * y1 + s1; s1 = c2[1] * y1 - c2[2] * y2;        // C23 into R77
            const x = y2 * g;
            let v = c4[0] * x + s3; s3 = c4[1] * x - c4[2] * v;              // IC4b's 220 p
            const a = v < 0 ? -v : v;
            if (a > 9) { const e = a - 9, lim = rail2 - 9; v = (v < 0 ? -1 : 1) * (9 + lim * e / (lim + e)); }
            out[i] = v * OUT_K;
            if (a > pk) pk = a;
          }
          // (silent: no subnormal, as postV — the couplings stuck at ±2.65e-321, so a panel module behind never saw exact 0:
          // never idle, the Inst never skipped, MASTER's sweep held off; review-idle #1)
          s[b] = s0 > -1e-30 && s0 < 1e-30 ? 0 : s0; s[b + 1] = s1 > -1e-30 && s1 < 1e-30 ? 0 : s1;
          s[b + 2] = s2 > -1e-30 && s2 < 1e-30 ? 0 : s2; s[b + 3] = s3 > -1e-30 && s3 < 1e-30 ? 0 : s3;
        }
        if (!st) { for (let i = 0; i < n; i++) R[i] = L[i]; s[4] = s[0]; s[5] = s[1]; s[6] = s[2]; s[7] = s[3]; }
        ost.live = pk > 1e-5 ? 4 : ost.live > 0 ? ost.live - 1 : 0;
      }
      // the 606's (R6 §10): IC14A (R189 ∥ C86) on its 7.5 V bias — the bus carries its output inverted, so it clips at
      // +7.5 / −6 V here —, C87 into VOLUME, R191 into IC14B (R190 ∥ C88, inverting again: the output's own sign) on its
      // rails (+6 / −7.5 V about the bias); the clamp diodes after it are not reached inside the rails [C]
      function post6(L, R, mono, n) {
        const st = smpAny ? (smpAny = smpRender(n)) : false;
        const c1 = ost.c1, c2 = ost.c2, c3 = ost.c3, c4 = ost.c4, s = ost.s, g = ost.g, LO = MIX6.LO, HI = MIX6.HI;
        let pk = 0;
        for (let ch = 0; ch < (st ? 2 : 1); ch++) {
          const out = ch === 0 ? L : R, sx = ch === 0 ? smpL : smpR, b = 4 * ch;
          let s0 = s[b], s1 = s[b + 1], s2 = s[b + 2], s3 = s[b + 3];
          for (let i = 0; i < n; i++) {
            const x0 = st ? mono[i] + sx[i] : mono[i];
            let y3 = c3[0] * x0 + s2; s2 = c3[1] * x0 - c3[2] * y3;          // IC14A's 220 p
            if (y3 > LO - 1 || y3 < 1 - HI) y3 = rail6(y3, HI, LO);
            const y1 = c1[0] * y3 + s0; s0 = c1[1] * y3 - c1[2] * y1;        // C87 into VR8
            const y2 = c2[0] * y1 + s1; s1 = c2[1] * y1 - c2[2] * y2;        // C83 into R191
            const x = y2 * g;
            let v = c4[0] * x + s3; s3 = c4[1] * x - c4[2] * v;              // IC14B's 220 p
            if (v > HI - 1 || v < 1 - LO) v = rail6(v, LO, HI);
            out[i] = v * OUT_K6;
            const a = v < 0 ? -v : v;
            if (a > pk) pk = a;
          }
          s[b] = s0 > -1e-30 && s0 < 1e-30 ? 0 : s0; s[b + 1] = s1 > -1e-30 && s1 < 1e-30 ? 0 : s1;   // (silent: no subnormal, as postV)
          s[b + 2] = s2 > -1e-30 && s2 < 1e-30 ? 0 : s2; s[b + 3] = s3 > -1e-30 && s3 < 1e-30 ? 0 : s3;
        }
        if (!st) { for (let i = 0; i < n; i++) R[i] = L[i]; s[4] = s[0]; s[5] = s[1]; s[6] = s[2]; s[7] = s[3]; }
        ost.live = pk > 1e-5 ? 4 : ost.live > 0 ? ost.live - 1 : 0;
      }

      // the 909's (R9 §10): the MONO jack — the bus is the voices' mono shares at the summing amplifier's input —, its DC coupling,
      // MASTER VOLUME (VR28) the feedback, the rails (±13.5 V, the 808's knee), the jack's 0.01 µ behind 1 k
      function post9(L, R, mono, n) {
        const st = smpAny ? (smpAny = smpRender(n)) : false;
        const c1 = ost.c1, c4 = ost.c4, s = ost.s, g = ost.g;
        let pk = 0;
        for (let ch = 0; ch < (st ? 2 : 1); ch++) {
          const out = ch === 0 ? L : R, sx = ch === 0 ? smpL : smpR, b = 4 * ch;
          let s0 = s[b], s3 = s[b + 3];
          for (let i = 0; i < n; i++) {
            const x0 = st ? mono[i] + sx[i] : mono[i];
            const y1 = c1[0] * x0 + s0; s0 = c1[1] * x0 - c1[2] * y1;        // the DC coupling
            const v = rail(y1 * g), a = v < 0 ? -v : v;                       // IC66, VR28 its feedback
            const yj = c4[0] * v + s3; s3 = c4[1] * v - c4[2] * yj;           // the jack's 1 k / 0.01 µ
            out[i] = yj * OUT_K9;
            if (a > pk) pk = a;
          }
          s[b] = s0 > -1e-30 && s0 < 1e-30 ? 0 : s0; s[b + 3] = s3 > -1e-30 && s3 < 1e-30 ? 0 : s3;   // (silent: no subnormal, as postV)
        }
        if (!st) { for (let i = 0; i < n; i++) R[i] = L[i]; s[4] = s[0]; s[7] = s[3]; }
        ost.live = pk > 1e-5 ? 4 : ost.live > 0 ? ost.live - 1 : 0;
      }

      // the SDS-V's (IMPL-8 §12.4): the MONO mix — the cards' sum (each at its LEVEL; the stereo trimmer's pan not in it) —, the
      // output's coupling, the mix amplifier's rails (±13.5 V, the 808's knee)
      function postV(L, R, mono, n) {
        const st = smpAny ? (smpAny = smpRender(n)) : false;
        const c1 = ost.c1, s = ost.s;
        let pk = 0;
        for (let ch = 0; ch < (st ? 2 : 1); ch++) {
          const out = ch === 0 ? L : R, sx = ch === 0 ? smpL : smpR, b = 4 * ch;
          let s0 = s[b];
          for (let i = 0; i < n; i++) {
            const x0 = st ? mono[i] + sx[i] : mono[i];
            const y1 = c1[0] * x0 + s0; s0 = c1[1] * x0 - c1[2] * y1;        // the coupling
            const v = rail(y1), a = v < 0 ? -v : v;
            out[i] = v * OUT_KV;
            if (a > pk) pk = a;
          }
          s[b] = s0 > -1e-30 && s0 < 1e-30 ? 0 : s0;                         // (silent: no subnormal)
        }
        if (!st) { for (let i = 0; i < n; i++) R[i] = L[i]; s[4] = s[0]; }
        ost.live = pk > 1e-5 ? 4 : ost.live > 0 ? ost.live - 1 : 0;
      }

      // ---- the chip swap (§5): a ROM sound's slot (OH 9 and CH 10 the hat chip's two regions, CR 8, RD 7) becomes that voice's
      // image — the entry's level 0 (mono) through a one-pole guard at the image's Nyquist, resampled (linear) to 30 kHz, cut to
      // the region with a 2 ms fade, peak-normalised to ±28 codes (the tool's headroom; not pre-compensated: the staircase / RC
      // acts on it as on a swapped chip), ended at mid-scale, rounded to 6 bits — into the machine's own buffers; pending until
      // its entry exists (one look per span, at the span's start, never inside hit / trig); off: the built-in image again
      const SW9_S = Object.freeze([7, 8, 9, 10]);
      // the voices' images from the slots' state (the hats' buffer holds the built-in region a slot does not replace)
      function romImg9() {
        const id = SW9.id, h = SW9.hh, B = RI9.hh;
        cr9.img = id[1] ? SW9.cr : RI9.cr; rd9.img = id[0] ? SW9.rd : RI9.rd;
        if (id[2] || id[3]) {
          if (!id[2]) for (let k = 0; k < OPEN9; k++) h[k] = B[k];
          if (!id[3]) for (let k = OPEN9; k < W9; k++) h[k] = B[k];
          hh9.img = h;
        } else hh9.img = B;
      }
      function romSlots9() {
        let ch = false, pend = false;
        for (let j = 0; j < 4; j++) {
          const sl = SL[SW9_S[j]];
          // (off, or another id: the built-in image until the new one is converted)
          if (!sl.on || (SW9.id[j] && SW9.id[j] !== sl.id)) { if (SW9.id[j]) { SW9.id[j] = ''; ch = true; } }
          if (sl.on && SW9.id[j] !== sl.id) pend = true;
        }
        SW9.pend = pend;
        if (ch) romImg9();
      }
      // (review 1 F3) at most one conversion a quantum — the 128-frame block of the span's start, however the engine splits
      // it: four swaps at once (a project open, a power-on, an undone Replace) cost ≈ 2 quanta in one; the others wait, their
      // built-in images playing a quantum or three longer. F0 the span's (or the idle poll's) absolute frame
      function romPoll9(F0) {
        const q = Math.floor(F0 / 128);
        if (q === SW9.q) return;
        const SB = globalThis.SxBase;
        let pend = false, ch = false;
        for (let j = 0; j < 4; j++) {
          const sl = SL[SW9_S[j]];
          if (!sl.on || SW9.id[j] === sl.id) continue;
          if (ch) { pend = true; continue; }
          const e = SB && SB.getAsset ? SB.getAsset(sl.id) : null;
          if (!(e && e.kind === 'smp' && e.levels && e.levels.length && e.levels[0].L)) { pend = true; continue; }
          if (j === 0) conv9(e, SW9.rd, 0, W9, base); else if (j === 1) conv9(e, SW9.cr, 0, W9, base);
          else if (j === 2) conv9(e, SW9.hh, 0, OPEN9, base); else conv9(e, SW9.hh, OPEN9, W9 - OPEN9, base);
          SW9.id[j] = sl.id; ch = true; SW9.q = q;
        }
        SW9.pend = pend;
        if (ch) romImg9();
      }
      function trig9(m, acc) {
        if ((m & 0xffe) === 0) return;
        const T = (m & 1) ? Math.round(ACC9.TMAX * acNow()) : 0;
        for (let lane = 1; lane < 12; lane++) {
          if (!(m & (1 << lane))) continue;
          const s = lane - 1;
          latch(s, Math.min(63, ACC9.N0 + ((acc >> lane) & 1 && PV9[s] === 1 ? ACC9.L : 0) + T) + 1);
        }
      }

      const DM = {
        VER,
        set(drum) { M.drum = drum && typeof drum === 'object' ? drum : null; },
        setOS(os) { setRate(os > 0 ? os | 0 : 1); },
        hit(sound, v127) {
          const s = sound | 0;
          if (!(s >= 0 && s < 16) || sound !== sound) return;
          if (is6 && !HAS6[s]) return;                      // a sound the 606 lacks (a hostile payload's): nothing
          if (is9 && s > 10) return;                         // (the 909's: ids 11–15)
          if (isV && s > 4) return;                          // (the SDS-V's: ids 5–15)
          const v = +v127;
          if (!(v > 0)) return;
          if (isV) { latch(s, padV(v < 1 ? 1 : v > 127 ? 127 : v)); return; }   // the SDS-V latches the pad volts (§11.4)
          if (is9) { latch(s, vTrig9(v, s, acNow()) + 1); return; }   // the 909 latches the DAC code (+ 1), §1.3
          latch(s, is6 ? vTrig6(v, acNow()) : vTrig(v, acNow()));
        },
        // (the 909: acc the step's per-voice accents, its lanes & 0x83E; bit 0 of mask TOTAL ACCENT — §1.3, §3.5)
        trig(mask, acc) {
          const m = mask | 0;
          // (the SDS-V has no sequencer or accent: a step on lanes 1–5 — a sequencer into its TRIGGER INs — hits at v 100's volts)
          if (isV) { if ((m & 0x3e) === 0) return; const vp = padV(100); for (let s = 0; s < 5; s++) if (m & (2 << s)) latch(s, vp); return; }
          if (is9) { trig9(m, acc | 0); return; }
          if (is6) {
            if ((m & 0xe2e) === 0) return;
            const Vv = (m & 1) ? vAcc6(acNow()) : V_N6;
            for (let lane = 1; lane < 12; lane++) if ((m & (1 << lane)) && LANE_S6[lane] >= 0) latch(LANE_S6[lane], Vv);
            return;
          }
          if ((m & 0xffe) === 0) return;
          const Vv = (m & 1) ? V_N + acNow() * (V_X - V_N) : V_N;
          for (let lane = 1; lane < 12; lane++) {
            if (!(m & (1 << lane))) continue;
            const swi = LANE_SW[lane];
            latch(swi >= 0 && swNow(swi) === 1 ? LANE_ALT[lane] : LANE_S[lane], Vv);
          }
        },
        render(buf, N, F0) {
          const CH = M.CH, n0 = F0 * M.OS;
          M.n0 = n0;
          if (is9 && SW9.pend) romPoll9(F0);                 // a pending chip swap: its entry looked up once a span
          readTargets();
          // nothing sounding and nothing latched: no circuit code runs (a turned knob lands on its target)
          if (!M.latN && !anyOn() && !M.bankOn) { if (M.mv) { M.snap = true; const mk = glide(); if (mk) retune(mk); } return; }
          let g0 = false;                                    // the first chunk's glide step taken (before its hits)
          if (M.latN) { if (M.mv) { const mk = glide(); if (mk) retune(mk); g0 = true; } apply(); }
          if (!M.mv) {
            // a whole span per voice
            sources(n0, 0, N);
            for (let k = 0; k < V.length; k++) { const v = V[k]; if (v.on) { M.count++; v.run(buf, 0, N); } }
            sourcesOff();
          } else {
            // knobs gliding: chunk by chunk
            for (let c = 0; c < N; c += CH) {
              if (c > 0 || !g0) { const mk = glide(); if (mk) retune(mk); }
              sources(n0, c, CH);
              for (let k = 0; k < V.length; k++) { const v = V[k]; if (v.on) { M.count++; v.run(buf, c, CH); } }
              sourcesOff();
            }
          }
        },
        // (review 1 F3) the engine's idle skip renders nothing: a pending chip swap converts meanwhile (one a quantum); the
        // 808's / 606's nothing
        poll(F0) { if (is9 && SW9.pend) romPoll9(F0); },
        post: isV ? postV : is9 ? post9 : is6 ? post6 : post8,
        live() {
          if (M.latN || smpAny || ost.live > 0) return true;
          return anyOn();
        },
        reset() {
          for (const v of V) { v.on = false; v.qn = 0; v.zero(); v.act = 0; }
          if (cp !== null) cp.rest();                        // (the clap's bias capacitors too: a fresh machine)
          if (is6) { t6.actL = t6.actH = 0; h6.actO = h6.actC = 0; }
          if (is9) { Q9.dac.fill(ACC9.N0); nz9.pos = -1; SW9.q = -1; for (const v of [hh9, cr9, rd9]) { v.hc = 32; v.zero(); v.actO = v.actC = 0; } }
          M.lat.fill(0); M.latN = 0; M.lit = 0; nz.won = nz.pon = false; bank.lon = bank.hon = false;
          ost.s.fill(0); ost.live = 0; for (const sl of SL) { sl.pos = -1; sl.fN = 0; }
          smpAny = false; M.snap = true;
        },
        mon() {
          MON.lit = M.lit; M.lit = 0;
          if (isV) {                                         // the SDS-V's cards on their sounds' slots (0–4)
            const a = MON.act;
            for (let c = 0; c < 5; c++) { const v = CARDS[c]; a[v.P.sid] = v.act; v.act = 0; }
            return MON;
          }
          if (is9) {
            // the 909's circuits in the 808's slots by sound id (IMPL-7c §2.1: BD 0 … HC 6, ride 7, crash 8, OH 9, CH 10): the hats'
            // one voice on the slot of the region it plays
            const a = MON.act;
            a[0] = b9.act; a[1] = s9.act; a[2] = l9.act; a[3] = m9.act; a[4] = t9.act; a[5] = r9.act; a[6] = p9.act;
            a[7] = rd9.act; a[8] = cr9.act; a[9] = hh9.actO; a[10] = hh9.actC; a[11] = 0;
            for (const v of V) v.act = 0;
            hh9.actO = hh9.actC = cr9.actO = cr9.actC = rd9.actO = rd9.actC = 0;
            return MON;
          }
          if (is6) {
            // the 606's circuits in the 808's slots (BD 0, SD 1, LT 2, HT 4, CY 8, OH 9, CH 10; IMPL-7b §2.1): the tom pair's
            // resonators, the hat VCA's level on the slot of the supply that drives it
            const a = MON.act;
            a[0] = b6.act; a[1] = s6.act; a[2] = t6.actL; a[4] = t6.actH; a[8] = c6.act; a[9] = h6.actO; a[10] = h6.actC;
            b6.act = s6.act = t6.act = c6.act = h6.act = 0; t6.actL = t6.actH = h6.actO = h6.actC = 0;
            return MON;
          }
          for (let c = 0; c < NCIR; c++) { const v = CIRV[c]; MON.act[c] = v.act; v.act = 0; }
          return MON;
        },
        smp(slots) {
          for (let s = 0; s < 16; s++) {
            const x = slots && slots[s], id = x && typeof x.id === 'string' ? x.id : '', on = !!(x && x.on && id);
            const sl = SL[s];
            if (sl.id !== id) { sl.id = id; sl.e = null; sl.pos = -1; sl.fN = 0; }
            sl.on = on;
          }
          if (is9) romSlots9();
        },
        setSalt(s) {
          M.salt = (0x2545F491 ^ (s >>> 0)) >>> 0; nz.won = nz.pon = false;
          if (is9) { Q9.off = hash32((M.salt ^ 0x6A09E667) >>> 0) % 2147483647; nz9.pos = -1; }
          if (isV) for (const v of CARDS) v.seed = hash32((M.salt ^ Math.imul(v.k + 1, 0x9E3779B9)) >>> 0);   // (each card its own stream)
        },
        // test access (lanes V / V6's checks): the shared state, the circuits, the bank
        _M: M, _bank: bank, _TB: TB, _mach: X.id,
        _v: isV ? { bd: CARDS[0], sd: CARDS[1], lt: CARDS[4], mt: CARDS[3], ht: CARDS[2] }
          : is9 ? { bd: b9, sd: s9, lt: l9, mt: m9, ht: t9, rs: r9, cp: p9, hh: hh9, cr: cr9, rd: rd9 }
          : is6 ? { bd: b6, sd: s6, tm: t6, cy: c6, hh: h6 } : { bd, sd, tl, tm: tmm, th, rs, cp, ma, cb, cy, oh, ch: chh },
        // (the 909's: its DACs, the noise stream for OS samples [n0, n0 + n) into out, the chip swap's buffers)
        _Q: Q9, _nz: is9 ? (n0, n, out) => noise9(n0, 0, n, out) : null, _sw: SW9, _ost: ost,
      };
      // (the SDS-V's own: trim(t) — the payload's memories 3 and 4, IMPL-8 §12.1; the other machines have none: the engine's guard)
      if (isV) { DM.trim = trimV; DM._trv = TRV; DM._cards = CARDS; }
      DM.setSalt(inst && inst.seedSalt ? inst.seedSalt : 0);
      setRate(inst && inst.OS > 0 ? inst.OS | 0 : 1);
      return DM;
    }

    // what the engine and the tests read of a machine (IMPL-7b §2.1): SOUNDS the 16 by sound id, sids the ones it has
    // (the SDS-V's also its memory switches: SW_IDS, SW_DEF the indices 0…3 = memories 1…4)
    const mach = Object.freeze(Object.fromEntries(Object.values(MACH).map(X => [X.id, Object.freeze(Object.assign({ KNOB_IDS: X.KNOB_IDS,
      KNOB_DEF: X.KNOB_DEF, SOUNDS: X.SOUNDS, sids: X.sids }, X.SW_IDS ? { SW_IDS: X.SW_IDS, SW_DEF: X.SW_DEF } : {}))])));

    globalThis.Dr808 = Object.freeze({
      VER, SOUNDS, S_CIR, S_VAR, KNOB_IDS, KNOB_DEF, SW_IDS, V_N, V_X, OUT_K, vTrig, vMetal, create, gain, mach,
      _kpk(k) { KPK = k; },
      _cpTail(t0 = 2.0, t1 = 2.9) { CP_T0 = t0; CP_T1 = t1; },  // (the clap's fade, F4: tests only)
      // the analog prototypes, for the tests (RC §14 target (a); the 606's: R6 §14)
      proto: Object.freeze({ bandH, kBil, bil1, bil2, skHP, BD, SD, TOM, TM, RS, CP, CB, MT, CY, HH, MIX, tapA, tapC, vle, Lin, BT2, V38EQ,
        tr606: Object.freeze({ BD6, SD6, TM6, MT6, CY6, HH6, NZ6, MIX6, K6, V_N6, V_X6, OUT_K6, SMP_LEVEL6, BIAS9, BIAS4, OA_HI, vAcc6, vTrig6,
          btDesign, pot6, rail6, jTab, jIb, fUp, fDn }),
        // the 909's (IMPL-7c §11 interfaces): the accent law (drum-core copies vTrig9 with a test), ENV9 (lane R9's tool reads the
        // staircase), the decoder (rom9: the scope's images; dec9: a string → 32 768 codes), the component tables, the noise
        // register's maths, the shaper
        tr909: Object.freeze({ ACC9, ENV9, KX9, DAC9V, CBOTH9, vAcc9, vTrig9, codes9, tapA9, rom9, dec9, ROM909_A, W9, OPEN9, RATE9, BD9,
          SD9, TOM9, TM9, RS9, HC9, ROMC9, HH9, CY9, MIX9, K9, PV9, DAC_OF9, SMP_LEVEL9, OUT_K9,
          NZ9_F, pow9, win9, mul9, NZ9_E, dsh: v => dsh(DSH || (DSH = dshBuild()), v), btDesign, skLP9 }),
        // the SDS-V's (IMPL-8 §12.1, for the tests, drum-core and the panel's tips): the trigger's laws (padVolts, sens, vD, the
        // comparator VCMP, minVel(s) the lowest velocity that fires), the decay law, the factory sounds FACTV, the default trims
        // TRIMV (5 × memories 3, 4 × n t b d m c), the card tables, the ids, the SSM2044 (Ota4), the constants
        sdsv: Object.freeze({ VL, VCMP, padVolts: padV, sens: sensG, vD: vDyn, minVel, t60: t60V, CV, CH_OF_V, FACTV, TRIMV, KV_IDS, KV_DEF,
          SWV_IDS, SWV_DEF, TG_V, TA_V, TC_V, TR_V, NG_V, FBS_V, KVCA, HC_V, OUT_KV, VK_V, SMP_LEVELV, Ota4, triV }) }),
    });
  } catch (err) {
    globalThis.Dr808 = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('dr-808: load failed', err);
  }
})();
