/*
 * dr-808.js — the TR-808 voice circuits (classic script, no imports/exports; stage 7a lane V, IMPL-7a §2).
 *
 * Evaluated in the AudioWorkletGlobalScope (addModule), on the main thread and in node vm contexts (tests/dsp-scope.mjs
 * `run`). One IIFE publishes the frozen `globalThis.Dr808`; a failure inside leaves Dr808 = null without throwing.
 * Our own circuit-level model of the machine's voice board, written from the component values of the published
 * schematic (read for values only; the tables per voice are in docs/canvas/research-808-circuits.md §16) and the
 * published analyses cited there. No recording of any machine is used.
 *
 * Interface (IMPL-7a §11): Dr808.create(inst, 'tr808'[, opt]) → machine
 *   set(drum)           the flat p.drum (knob positions 0…1, switch indices; models.js ids, §2.3), read once per span
 *   setOS(os, fs)       the Inst's oversampling (fs = base · os); rebuilds every rate-dependent coefficient
 *   hit(sound, v127)    latches a hit of sound 0…15 (SOUNDS) for the next render; v127 → trigger volts (§1.3)
 *   trig(mask)          latches a sequencer step: 12-bit lane mask, bit 0 = accent (§1.2)
 *   render(buf, N, F0)  adds every live circuit into buf[0…N) (OS rate, N = n·OS); F0 = the span's absolute base frame
 *   post(L, R, mono, n) base rate: the sample lanes, MASTER VOLUME, the output stage → L / R (full scale)
 *   live() · reset() · mon() → { lit, act } · smp(slots) (§5: the drum payload's 16 slots { id, on } | null) · setSalt(s)
 *   opt (tests): { noSleep: no circuit ever sleeps, bankOn: the metal bank free-running (never asleep) }
 * Units are volts, ohms, farads and seconds; the mix bus carries the summing amplifier's output (IC4a) in volts.
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

    /* ------------------------------------------------------------------ the machine */
    const SPAN = 1024;                                      // the largest span in OS samples (128 frames × OS ≤ 8)
    function create(inst, kind, opt) {
      if (kind !== undefined && kind !== 'tr808') return null;
      const o = opt || {};
      const base = inst && inst.base > 0 ? inst.base : (typeof sampleRate === 'number' ? sampleRate : 48000);
      const M = {
        base, OS: 1, fs: base, h: 1 / base, CH: 4, nP: 48, kv: new Float64Array(NK), kt: new Float64Array(NK), mv: 0,
        drum: null, snap: true, salt: 0x2545F491,
        wn: new Float64Array(SPAN), pn: new Float64Array(SPAN), lo: new Float64Array(SPAN), hi: new Float64Array(SPAN),
        s5: new Float64Array(SPAN), s6: new Float64Array(SPAN), v63: new Float64Array(SPAN), wnPeak: 0.3,
        lat: new Float64Array(16), latN: 0, lit: 0,       // latches: per sound the highest pending volts (0 = none)
        noSleep: !!o.noSleep, bankOn: !!o.bankOn, count: 0,
      };
      M.kv.set(KNOB_DEF); M.kt.set(KNOB_DEF);
      // the noise: white (a 20 kHz smoothing low-pass above 60 kHz) and pink (the PN low-pass of the same white)
      const nz = { c: new Float64Array(5), p: new Float64Array(5), s1: 0, s2: 0, q1: 0, q2: 0, qp: 0, sig: 0, sigB: 0, won: false, pon: false };
      const TB = []; for (let k = 0; k < 6; k++) TB.push({ lo: new Float64Array(TN + 1), hi: new Float64Array(TN + 1), sq: new Float64Array(TN + 1), f: MT.F[k], inc: 0 });
      const bank = { lon: false, hon: false, pl: 0, ph: 0, p5: 0, p6: 0, lmax: 0, lmin: 0, hmax: 0, hmin: 0, dl: 0, W: 0 };
      const bd = new BassDrum(M), sd = new Snare(M), tl = new Tom(M, 0), tmm = new Tom(M, 1), th = new Tom(M, 2), rs = new RimClaves(M);
      const cp = new Clap(M), cb = new Cowbell(M), cy = new Cymbal(M), oh = new Hat(M, true), chh = new Hat(M, false), ma = new Maracas(M);
      // render order: the closed hat before the open hat (its C63 trace drives the choke)
      const V = [bd, sd, tl, tmm, th, rs, cp, cb, cy, chh, oh, ma];
      const CIRV = [bd, sd, tl, tmm, th, rs, cp, cb, cy, oh, chh, ma];   // circuit index → voice
      // the output stage (post): per channel the IC4a / IC4b 220 p low-passes, C19 into VR1, C23 into R77
      const ost = { c1: new Float64Array(3), c2: new Float64Array(3), c3: new Float64Array(3), c4: new Float64Array(3), s: new Float64Array(8), g: 0, live: 0 };
      // the sample slots (§5)
      const SL = []; for (let s = 0; s < 16; s++) SL.push({ id: '', on: false, e: null, pos: -1, inc: 1, g: 0, dk: 0, dg: 1, fP: -1, fG: 0, fN: 0, fK: 0 });
      const smpL = new Float64Array(128), smpR = new Float64Array(128);
      let smpAny = false;
      const MON = { lit: 0, act: new Float32Array(NCIR) };

      function setRate(os) {
        M.OS = os; M.fs = base * os; M.h = 1 / M.fs; M.CH = 4 * os; M.nP = Math.max(1, Math.round(1e-3 * M.fs));
        // white: the density that puts 130 mV rms in 0–20 kHz; pink: the unity-gain Sallen-Key low-pass (22 k, 22 k,
        // 0.039 µ feedback, 0.018 µ to ground: ≈ 273 Hz, Q 0.74)
        nz.sig = 0.13 * Math.sqrt(M.fs / 40000) / 37837.6; nz.sigB = 0.13 * Math.sqrt(base / 40000) / 37837.6;
        if (M.fs > 60000) bil2(nz.c, 0, 0, 0, 1, 1 / ((TAU * 20000) * (TAU * 20000)), Math.SQRT2 / (TAU * 20000), 1, kBil(20000, M.fs));
        const R = 22e3, C1 = 0.039e-6, C2 = 0.018e-6;
        bil2(nz.p, 0, 0, 0, 1, R * R * C1 * C2, 2 * R * C2, 1, kBil(273, base));
        nz.won = nz.pon = false;
        buildBank();
        for (const v of V) v.os();
        const kb = kBil(1000, base);
        bil1(ost.c1, 0, MIX.VR1 * MIX.C19, 0, MIX.VR1 * MIX.C19, 1, kb);
        bil1(ost.c3, 0, 0, 1, MIX.R75 * MIX.C18, 1, kBil(Math.min(1 / (TAU * MIX.R75 * MIX.C18), 0.45 * base), base));
        bil1(ost.c4, 0, 0, 1, MIX.R76 * MIX.C22, 1, kBil(Math.min(1 / (TAU * MIX.R76 * MIX.C22), 0.45 * base), base));
        knobOut();
      }
      function knobOut() {
        const lv = tapA(clamp01(M.kv[K.vol])), rl = MIX.VR1 * lv, rw = rl * (MIX.VR1 - rl) / MIX.VR1;
        bil1(ost.c2, 0, (MIX.R77 + rw) * MIX.C23, 0, (MIX.R77 + rw) * MIX.C23, 1, kBil(1000, base));
        ost.g = lv * MIX.R76 / (MIX.R77 + rw);
      }
      // the bank's steady-state tables: per oscillator its band-limited square, its 3440 Hz and its 7100 Hz band output
      function buildBank() {
        const fs = M.fs, fc = Math.min(0.45 * fs, 40000), P = MT, H = [0, 0];
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
                // the passive summing node: each oscillator through 120 k into R53 ∥ the other five ∥ both band inputs
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
        // the coupled bases' leak (22 n, 2 M from 15 V) and the window that bounds the peak tracker's memory: an older peak
        // has leaked by more than the band's whole range, so a tracker restarted that far back is the same bytes
        bank.dl = M.h * (B15 - VBE) / MT.RB / MT.CC;
        bank.W = Math.ceil(Math.max(lmax - lmin, hmax - hmin) / bank.dl) + 4;
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
        const CH = M.CH, W = 2 * bank.W, dl = bank.dl;
        let s = n0 - W; s -= ((s % CH) + CH) % CH;
        let pl = -1e9, ph = -1e9;
        while (s < n0) {
          const m = Math.min(SPAN, n0 - s);
          bandRange(s, 0, m, need, pre, pre2);
          if (need & 1) for (let i = 0; i < m; i++) pl = Math.max(pl - dl, pre[i]);
          if (need & 2) for (let i = 0; i < m; i++) ph = Math.max(ph - dl, pre2[i]);
          s += m;
        }
        if (need & 1) { bank.pl = pl; bank.lon = true; }
        if (need & 2) { bank.ph = ph; bank.hon = true; }
      }
      function bands(n0, i0, n, need) {
        const wk = (need & 1 && !bank.lon ? 1 : 0) | (need & 2 && !bank.hon ? 2 : 0);
        if (wk) bandWake(n0 + i0, wk);
        bandRange(n0, i0, n, need, M.lo, M.hi);
        const dl = bank.dl, lo = M.lo, hi = M.hi;
        if (need & 1) { let pl = bank.pl; for (let i = i0, e = i0 + n; i < e; i++) { pl = Math.max(pl - dl, lo[i]); lo[i] -= pl; } bank.pl = pl; }
        if (need & 2) { let ph = bank.ph; for (let i = i0, e = i0 + n; i < e; i++) { ph = Math.max(ph - dl, hi[i]); hi[i] -= ph; } bank.ph = ph; }
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
      function whiteRange(n0, i0, n, wn) {
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
      function sources(n0, i0, n) {
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
      function sourcesOff() {
        if (!(sd.on || cp.on || ma.on)) nz.won = false;
        if (!((tl.on && tl.var === 0) || (tmm.on && tmm.var === 0) || (th.on && th.var === 0))) nz.pon = false;
        if (M.bankOn) return;
        if (!cy.on) bank.lon = false;
        if (!(cy.on || oh.on || chh.on)) bank.hon = false;
      }

      // the knob targets, read once per span (set() and the modulation adapter write p.drum between spans)
      const kd = x => { const t = +x; return t === t ? (t < 0 ? 0 : t > 1 ? 1 : t) : -1; };
      function readTargets() {
        const d = M.drum, kt = M.kt;
        if (d) {
          kt[0] = kd(d.ac); kt[1] = kd(d.bdl); kt[2] = kd(d.bdt); kt[3] = kd(d.bdd); kt[4] = kd(d.sdl); kt[5] = kd(d.sdt);
          kt[6] = kd(d.sds); kt[7] = kd(d.ltl); kt[8] = kd(d.ltt); kt[9] = kd(d.mtl); kt[10] = kd(d.mtt); kt[11] = kd(d.htl);
          kt[12] = kd(d.htt); kt[13] = kd(d.rsl); kt[14] = kd(d.cpl); kt[15] = kd(d.cbl); kt[16] = kd(d.cyl); kt[17] = kd(d.cyt);
          kt[18] = kd(d.cyd); kt[19] = kd(d.ohl); kt[20] = kd(d.ohd); kt[21] = kd(d.chl); kt[22] = kd(d.vol);
          for (let i = 0; i < NK; i++) if (kt[i] < 0) kt[i] = KNOB_DEF[i];
        } else kt.set(KNOB_DEF);
        let mv = 0;
        for (let i = 0; i < NK; i++) if (kt[i] !== M.kv[i]) { mv = 1; break; }
        M.mv = mv;
      }
      // one chunk's glide (≈ 5 ms to the target; the first set() snaps); returns the circuits to retune
      const kS = 1 - Math.exp(-4 / (base * 0.005));
      function glide() {
        const kt = M.kt, kv = M.kv;
        let mask = 0, mv = 0;
        for (let i = 0; i < NK; i++) {
          const t = kt[i], v = kv[i];
          if (v === t) continue;
          let nv = M.snap ? t : v + (t - v) * kS;
          if (Math.abs(t - nv) < 1e-6) nv = t; else mv = 1;
          kv[i] = nv; mask |= KNOB_CIR[i];
        }
        M.snap = false; M.mv = mv;
        return mask;
      }
      function retune(mask) {
        if (mask & 1) bd.kn(); if (mask & 2) sd.kn(); if (mask & 4) tl.kn(); if (mask & 8) tmm.kn(); if (mask & 16) th.kn();
        if (mask & 32) rs.kn(); if (mask & 64) cp.kn(); if (mask & 128) cb.kn(); if (mask & 256) cy.kn();
        if (mask & 512) oh.kn(); if (mask & 1024) chh.kn(); if (mask & 2048) ma.kn(); if (mask & (1 << 30)) knobOut();
      }
      // the drum object's accent and switches now (hits and steps latch with the panel as it is at their frame)
      function acNow() { const d = M.drum, t = d ? +d.ac : NaN; return t === t ? (t < 0 ? 0 : t > 1 ? 1 : t) : KNOB_DEF[K.ac]; }
      function swNow(i) { const d = M.drum, s = d ? d[SW_IDS[i]] : 0; return s === 1 || s === '1' || s === true ? 1 : 0; }
      function latch(s, Vv) { if (Vv > M.lat[s]) M.lat[s] = Vv; M.latN = 1; }
      // the latched hits, in lane (sound) order; per circuit the highest volts; a one-circuit pair: the switch's sound
      function apply() {
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
        sl.g = (Vv <= V_N ? Vv / V_N : 1 + 0.6 * (Vv - V_N) / (V_X - V_N)) * SMP_LEVEL / (sl.e.peak > 1e-6 ? sl.e.peak : 1);
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
          const c = S_CIR[s], lvl = tapA(clamp01(kv[LEVEL_OF[c]])) * mixG(MIX.R75);   // its LEVEL and its bus share
          let tune = 0;
          if (c >= 2 && c <= 4) tune = (clamp01(kv[c === 2 ? K.ltt : c === 3 ? K.mtt : K.htt]) - 0.5) * 2;
          const inc = e.rate / base * Math.pow(2, tune), lv = inc > 1.5 && e.levels.length > 1 ? 1 : 0, L = e.levels[lv];
          const Lb = L.L, Rb = L.R || L.L, len = L.len, sc = lv ? 0.5 : 1;
          const dkk = c === 0 ? kv[K.bdd] : c === 8 ? kv[K.cyd] : c === 9 ? kv[K.ohd] : 1;
          const dk = dkk >= 1 ? 0 : 1 / Math.max(1, (0.03 + dkk * 1.5) * base);   // DECAY: a fade from 30 ms (0) to none (10)
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

      const DM = {
        VER,
        set(drum) { M.drum = drum && typeof drum === 'object' ? drum : null; },
        setOS(os) { setRate(os > 0 ? os | 0 : 1); },
        hit(sound, v127) {
          const s = sound | 0;
          if (!(s >= 0 && s < 16) || sound !== sound) return;
          const v = +v127;
          if (!(v > 0)) return;
          latch(s, vTrig(v, acNow()));
        },
        trig(mask) {
          const m = mask | 0;
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
        post(L, R, mono, n) {
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
            s[b] = s0; s[b + 1] = s1; s[b + 2] = s2; s[b + 3] = s3;
          }
          if (!st) { for (let i = 0; i < n; i++) R[i] = L[i]; s[4] = s[0]; s[5] = s[1]; s[6] = s[2]; s[7] = s[3]; }
          ost.live = pk > 1e-5 ? 4 : ost.live > 0 ? ost.live - 1 : 0;
        },
        live() {
          if (M.latN || smpAny || ost.live > 0) return true;
          return anyOn();
        },
        reset() {
          for (const v of V) { v.on = false; v.qn = 0; v.zero(); v.act = 0; }
          cp.rest();                                         // (the clap's bias capacitors too: a fresh machine)
          M.lat.fill(0); M.latN = 0; M.lit = 0; nz.won = nz.pon = false; bank.lon = bank.hon = false;
          ost.s.fill(0); ost.live = 0; for (const sl of SL) { sl.pos = -1; sl.fN = 0; }
          smpAny = false; M.snap = true;
        },
        mon() {
          MON.lit = M.lit; M.lit = 0;
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
        },
        setSalt(s) { M.salt = (0x2545F491 ^ (s >>> 0)) >>> 0; nz.won = nz.pon = false; },
        // test access (lane V's checks): the shared state, the circuits, the bank
        _M: M, _v: { bd, sd, tl, tm: tmm, th, rs, cp, ma, cb, cy, oh, ch: chh }, _bank: bank, _TB: TB,
      };
      DM.setSalt(inst && inst.seedSalt ? inst.seedSalt : 0);
      setRate(inst && inst.OS > 0 ? inst.OS | 0 : 1);
      return DM;
    }

    globalThis.Dr808 = Object.freeze({
      VER, SOUNDS, S_CIR, S_VAR, KNOB_IDS, KNOB_DEF, SW_IDS, V_N, V_X, OUT_K, vTrig, vMetal, create,
      _kpk(k) { KPK = k; },
      _cpTail(t0 = 2.0, t1 = 2.9) { CP_T0 = t0; CP_T1 = t1; },  // (the clap's fade, F4: tests only)
      // the analog prototypes, for the tests (RC §14 target (a))
      proto: Object.freeze({ bandH, kBil, bil1, bil2, skHP, BD, SD, TOM, TM, RS, CP, CB, MT, CY, HH, MIX, tapA, tapC, vle, Lin, BT2, V38EQ }),
    });
  } catch (err) {
    globalThis.Dr808 = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('dr-808: load failed', err);
  }
})();
