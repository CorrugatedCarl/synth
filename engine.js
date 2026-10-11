/*
 * SYNTH — analog modelling engine (AudioWorklet)
 *
 * All DSP runs in 64-bit floating point at an oversampled internal rate
 * (device rate × 1/2/4/8), then is band-limited back down with cascaded
 * Kaiser-windowed half-band FIR decimators (~100 dB stopband).
 *
 * Circuit models:
 *   - Transistor ladder (Moog 904A / Minimoog / ARP 4072) — tanh per stage,
 *     zero-delay-feedback solved with per-sample linearisation.
 *   - OTA cascade (Roland IR3109, Curtis CEM3320, SSM2040) — tanh of the
 *     differential input of every stage, saturating resonance path.
 *   - Diode ladder (TB-303) — coupled 4-node implicit solve, resonance limit
 *     derived numerically from the circuit's linear response.
 *   - Sallen-Key with diode-clipped feedback (Korg 35 / MS-20) LP + HP.
 *   - State-variable (Oberheim SEM / Yamaha CS-80) with saturating integrator.
 *   - Analog oscillators: polyBLEP/polyBLAMP band-limited cores, capacitor
 *     ramp curvature, free-running phase, component tolerance, thermal drift.
 *   - RC envelope generators with analog attack overshoot target.
 *   - BBD chorus (Juno) and 3-phase string ensemble (Solina).
 *   - 6-operator phase-modulation (DX7) with all 32 algorithms.
 *   - Divide-down top-octave generator (Solina) with real MK50240 divisors.
 */
'use strict';

const TAU = 2 * Math.PI;

/* ---------------------------------------------------------------- math */
const SIN_N = 4096;
const SIN_T = new Float64Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_T[i] = Math.sin(TAU * i / SIN_N);
function sin1(p) { // p in cycles
  p -= Math.floor(p);
  const x = p * SIN_N, i = x | 0;
  return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (x - i);
}

const P2 = new Float64Array(161);
for (let i = 0; i < 161; i++) P2[i] = Math.pow(2, i - 80);
function exp2(x) {
  if (x < -79) return 0;
  if (x > 79) x = 79;
  const i = Math.floor(x), f = x - i;
  return P2[i + 80] * (1 + f * (0.6931471805599453 + f * (0.2402265069591007 + f * (0.05550410866482158 +
    f * (0.009618129107628477 + f * (0.0013333558146428443 + f * (1.5403530393381606e-4 + f * 1.525273380405984e-5)))))));
}

// secant gain of tanh: tanh(x)/x (Padé, exact limit at |x|>=3)
function tr(x) {
  const x2 = x * x;
  if (x2 > 9) return 1 / Math.abs(x);
  return (27 + x2) / (27 + 9 * x2);
}

// polyBLEP residual for a step of height 2
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// polyBLAMP residual (scaled to match blep)
function blamp(t, dt) {
  if (t < dt) { t = t / dt - 1; return -t * t * t / 3; }
  if (t > 1 - dt) { t = (t - 1) / dt + 1; return t * t * t / 3; }
  return 0;
}

// The band-limited analog oscillator core (polyBLEP saw / pulse, polyBLAMP triangle, sine) is written out at its
// three call sites in AVoice.render: as a call it was too big to inline, and every call boxed its arguments.

// naive waveforms (osc 2's band-limited sync / PWM path builds on these)
const nvSaw = (x, bow) => 2 * (x + bow * x * (1 - x)) - 1;
const nvTri = (x) => (x < 0.5 ? 4 * x - 1 : 3 - 4 * x);
const clampPw = (w) => (w < 0.02 ? 0.02 : w > 0.98 ? 0.98 : w);

/* ------------------------------------------------------------ envelope */
class Env {
  constructor() { this.v = 0; this.st = 0; this.ca = 0.01; this.cd = 0.001; this.cr = 0.001; this.s = 1; this.ov = 1.3; }
  set(a, d, s, r, rate, ov) {
    this.ov = ov || 1.3;
    const ta = Math.max(a, 0.0002) / Math.log(this.ov / (this.ov - 1));
    this.ca = 1 - Math.exp(-1 / (ta * rate));
    this.cd = 1 - Math.exp(-1 / (Math.max(d, 0.0005) * 0.25 * rate));
    this.cr = 1 - Math.exp(-1 / (Math.max(r, 0.0005) * 0.25 * rate));
    this.s = s;
  }
  setDecay(d, rate) { this.cd = 1 - Math.exp(-1 / (Math.max(d, 0.0005) * 0.25 * rate)); }
  on() { this.st = 1; }
  off() { if (this.st) this.st = 3; }
  tick() {
    switch (this.st) {
      case 1: this.v += (this.ov - this.v) * this.ca; if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v += (this.s - this.v) * this.cd; break;
      case 3: this.v -= this.v * this.cr; if (this.v < 1e-5) { this.v = 0; this.st = 0; } break;
    }
    return this.v;
  }
}

/* ------------------------------------------------------------- filters */
const oscOff = (k) => (k > 4 ? -109 * (k - 4) / (1 + 0.6 * (k - 4)) : 0);
// 4-pole cascade, zero-delay feedback, per-sample secant linearisation.
//  ota=false: transistor ladder  dy_i = g(tanh(y_{i-1}) - tanh(y_i))
//  ota=true : OTA cascade        dy_i = g tanh(y_{i-1} - y_i)
// The secant gains are taken at a prediction of this sample's solution (2s - y of the previous sample) rather than
// at the stale state and, where it matters (resonant, and fc/fs high enough for the prediction alone to drift past
// ~1 cent: g > 0.09; and always above fs/4), taken again at the first solution for a second pass, blended in over
// k = 2..3. The nonlinear part is then a true trapezoid: self-oscillation pitch and level hold at any fc/fs and
// oversampling.
class Ladder {
  constructor(ota) {
    this.ota = ota; this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0;
    this.g = 0.05; this.k = 0; this.kc = 0; this.comp = 0; this.fbSat = 0; this.tap2 = false; this.gScale = 1; this.sub = 1;
  }
  // Transistor ladder: the loop gain crosses the threshold (k = 4) at r ≈ 0.92, leaving real headroom at the top
  // of the knob as on the hardware (k ≈ 5.4 at r = 1), so it whistles at a healthy level. The extra compression
  // would pull the whistle flat, so the cutoff is trimmed to keep the pitch the previous curve gave (oscOff: fitted
  // self-oscillation offset in cents). OTA cascades keep the plain curve (their fbSat already sets a healthy level).
  // The input make-up keeps following the plain curve.
  setRes(r) {
    this.kc = 4.15 * r;
    if (this.ota || r <= 0.9) { this.k = this.kc; this.gScale = 1; return; }
    this.k = 3.735 + (r - 0.9) * 17;
    this.gScale = Math.pow(2, (oscOff(this.kc) - oscOff(this.k)) / 1200);
  }
  setRate() {}
  // a filter that has never run (fresh voice): start it from a small oscillation, as a free-running one would be
  seed(a) { this.s0 = a; this.s1 = 0.7 * a; this.s2 = 0.5 * a; this.s3 = 0.3 * a; }
  process(x) {
    const g = this.g, s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3, K = this.k, fbs = this.fbSat, ota = this.ota;
    const xin = x * (1 + this.comp * this.kc);
    let e0 = 2 * s0 - this.y0, e1 = 2 * s1 - this.y1, e2 = 2 * s2 - this.y2, e3 = 2 * s3 - this.y3, y0 = 0, y1 = 0, y2 = 0, y3 = 0;
    const w = g > 1 ? 1 : g > 0.09 && K > 2 ? (K < 3 ? K - 2 : 1) : 0; // g > 1 (fc > fs/4): the prediction alone is rough
    for (let it = 0; it < 2; it++) {
      if (it === 1) { if (w === 0) break; e0 = y0; e1 = y1; e2 = y2; e3 = y3; }
      const k = fbs !== 0 ? K * tr(K * e3 * fbs) : K;
      let G0, G1, G2, G3, d0, d1, d2, d3;
      if (!ota) {
        const t0 = tr(e0), t1 = tr(e1), t2 = tr(e2), t3 = tr(e3), tx = tr(xin - k * e3);
        d0 = 1 / (1 + g * t0); d1 = 1 / (1 + g * t1); d2 = 1 / (1 + g * t2); d3 = 1 / (1 + g * t3);
        G0 = g * tx * d0; G1 = g * t0 * d1; G2 = g * t1 * d2; G3 = g * t2 * d3;
      } else {
        const a0 = g * tr(xin - k * e3 - e0), a1 = g * tr(e0 - e1), a2 = g * tr(e1 - e2), a3 = g * tr(e2 - e3);
        d0 = 1 / (1 + a0); d1 = 1 / (1 + a1); d2 = 1 / (1 + a2); d3 = 1 / (1 + a3);
        G0 = a0 * d0; G1 = a1 * d1; G2 = a2 * d2; G3 = a3 * d3;
      }
      const S0 = s0 * d0, S1 = s1 * d1, S2 = s2 * d2, S3 = s3 * d3;
      const Gt = G0 * G1 * G2 * G3;
      const St = ((S0 * G1 + S1) * G2 + S2) * G3 + S3;
      y3 = (Gt * xin + St) / (1 + k * Gt);
      const u = xin - k * y3;
      if (it === 1 && w < 1) { // blend zone: mix the two solutions
        const v0 = G0 * u + S0, v1 = G1 * v0 + S1, v2 = G2 * v1 + S2;
        y0 = e0 + w * (v0 - e0); y1 = e1 + w * (v1 - e1); y2 = e2 + w * (v2 - e2); y3 = e3 + w * (y3 - e3);
      } else { y0 = G0 * u + S0; y1 = G1 * y0 + S1; y2 = G2 * y1 + S2; }
    }
    this.y0 = y0; this.y1 = y1; this.y2 = y2; this.y3 = y3;
    this.s0 = 2 * y0 - s0; this.s1 = 2 * y1 - s1; this.s2 = 2 * y2 - s2; this.s3 = 2 * y3 - s3;
    return this.tap2 ? y1 : y3;
  }
}

// Linear diode-ladder response, used once to find the resonance frequency and
// the loop gain at which the real circuit begins to self-oscillate.
const DIODE_C = [1, 1, 1, 1];
const DIODE = (() => {
  const c = DIODE_C;
  function H(w) {
    const bRe = [2 * c[0], 2 * c[1], 2 * c[2], 2 * c[3]], bIm = [w, w, w, w];
    const sub = [0, -c[1], -c[2], -c[3]], sup = [-c[0], -c[1], -c[2], 0];
    const dRe = [c[0], 0, 0, 0], dIm = [0, 0, 0, 0];
    for (let i = 1; i < 4; i++) {
      const den = bRe[i - 1] * bRe[i - 1] + bIm[i - 1] * bIm[i - 1];
      const mRe = sub[i] * bRe[i - 1] / den, mIm = -sub[i] * bIm[i - 1] / den;
      bRe[i] -= mRe * sup[i - 1]; bIm[i] -= mIm * sup[i - 1];
      const r = dRe[i - 1], im = dIm[i - 1];
      dRe[i] -= mRe * r - mIm * im; dIm[i] -= mRe * im + mIm * r;
    }
    const den = bRe[3] * bRe[3] + bIm[3] * bIm[3];
    return [(dRe[3] * bRe[3] + dIm[3] * bIm[3]) / den, (dIm[3] * bRe[3] - dRe[3] * bIm[3]) / den];
  }
  let prev = 0, unwrap = 0, pw = 0.001, pm = 1;
  for (let i = 0; i <= 4000; i++) {
    const w = 0.001 * Math.pow(10, i / 1000);
    const h = H(w);
    let ph = Math.atan2(h[1], h[0]);
    if (i > 0) { while (ph + unwrap - prev > Math.PI) unwrap -= TAU; while (ph + unwrap - prev < -Math.PI) unwrap += TAU; }
    const p = ph + unwrap;
    if (i > 0 && p <= -Math.PI && prev > -Math.PI) {
      const f = (-Math.PI - prev) / (p - prev);
      const wc = pw + (w - pw) * f;
      const hc = H(wc);
      return { w: wc, k: 1 / Math.hypot(hc[0], hc[1]) };
    }
    prev = p; pw = w; pm = Math.hypot(h[0], h[1]);
  }
  return { w: 1, k: 1 / pm };
})();

class DiodeLadder {
  constructor() { this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0; this.xp = 0; this.g = 0.05; this.k = 0; this.gScale = 1 / DIODE.w; this.sub = 1; }
  setRes(r) { this.k = DIODE.k * 1.04 * r; }
  setRate() {}
  // trapezoidal step: the old-point derivative uses the old secants, the implicit part is solved twice with the
  // secants refined at the new point (keeps the resonance on pitch as fc/fs rises)
  process(x) {
    const g = this.g, K = this.k, c0 = DIODE_C[0], c1 = DIODE_C[1], c2 = DIODE_C[2], c3 = DIODE_C[3];
    const o0 = this.y0, o1 = this.y1, o2 = this.y2, o3 = this.y3, xp = this.xp; this.xp = x;
    let g12 = tr(o0 - o1), g23 = tr(o1 - o2), g34 = tr(o2 - o3), g4 = tr(o3), Kf = K * tr(0.25 * K * o3), g01 = tr(xp - K * o3 - o0);
    const f0 = c0 * (g01 * (xp - Kf * o3 - o0) - g12 * (o0 - o1)), f1 = c1 * (g12 * (o0 - o1) - g23 * (o1 - o2));
    const f2 = c2 * (g23 * (o1 - o2) - g34 * (o2 - o3)), f3 = c3 * (g34 * (o2 - o3) - g4 * o3);
    g01 = tr(x - K * o3 - o0);
    let y0 = o0, y1 = o1, y2 = o2, y3 = o3;
    for (let it = 0; it < 2; it++) {
      if (it) { g01 = tr(x - K * y3 - y0); g12 = tr(y0 - y1); g23 = tr(y1 - y2); g34 = tr(y2 - y3); g4 = tr(y3); Kf = K * tr(0.25 * K * y3); }
      const a00 = -c0 * (g01 + g12), a01 = c0 * g12, a03 = -c0 * g01 * Kf, b0 = c0 * g01;
      const a10 = c1 * g12, a11 = -c1 * (g12 + g23), a12 = c1 * g23;
      const a21 = c2 * g23, a22 = -c2 * (g23 + g34), a23 = c2 * g34;
      const a32 = c3 * g34, a33 = -c3 * (g34 + g4);
      const r0 = o0 + g * (f0 + b0 * x);
      let r1 = o1 + g * f1, r2 = o2 + g * f2, r3 = o3 + g * f3;
      const m00 = 1 - g * a00, m01 = -g * a01, m03 = -g * a03;
      const m10 = -g * a10; let m11 = 1 - g * a11; const m12 = -g * a12;
      const m21 = -g * a21; let m22 = 1 - g * a22; let m23 = -g * a23;
      const m32 = -g * a32; let m33 = 1 - g * a33;
      let f = m10 / m00;
      m11 -= f * m01; const m13 = -f * m03; r1 -= f * r0;
      f = m21 / m11; m22 -= f * m12; m23 -= f * m13; r2 -= f * r1;
      f = m32 / m22; m33 -= f * m23; r3 -= f * r2;
      y3 = r3 / m33;
      y2 = (r2 - m23 * y3) / m22;
      y1 = (r1 - m12 * y2 - m13 * y3) / m11;
      y0 = (r0 - m01 * y1 - m03 * y3) / m00;
    }
    this.y0 = y0; this.y1 = y1; this.y2 = y2; this.y3 = y3;
    // passband make-up gain (the bare ladder has 1/(5+K) DC gain); partial, so bass still thins with resonance
    return y3 * (5 + 0.55 * K);
  }
}

// Sallen-Key low-pass with diode-clipped positive feedback (Korg 35 / MS-20).
// Trapezoidal step: the clipped-feedback secant at the old state goes into the old-state terms, the one at the
// new state (refined twice) into the implicit part. Below ~176 kHz the filter sub-steps (g is then computed for
// fs * sub), so the scream keeps its pitch at every oversampling setting and cannot lock to fs/4 at 1x.
const skSub = (fs) => (fs < 72000 ? 4 : fs < 144000 ? 2 : 1);
class SKLow {
  constructor() { this.u = 0; this.b = 0; this.xp = 0; this.g = 0.05; this.K = 0; this.clip = 1.6; this.gScale = 1; this.sub = 1; }
  setRes(r) { this.K = 3.55 * r; }
  setRate(fs) { this.sub = skSub(fs); }
  process(x) {
    x = x * tr(x * 0.7);
    const xp = this.xp, M = this.sub; this.xp = x;
    if (M === 1) this.step(xp + x);
    else { const d = (x - xp) / M; let xa = xp; for (let k = 1; k <= M; k++) { const xb = k === M ? x : xp + d * k; this.step(xa + xb); xa = xb; } }
    return this.b;
  }
  step(xs) {
    const g = this.g, u = this.u, b = this.b, K = this.K, kc = K / this.clip;
    const Ko = K * tr(kc * b);
    const r0 = u + g * (-2 * u + (1 - 2 * Ko) * b + xs), r1 = b + g * (u + (Ko - 1) * b);
    const m00 = 1 + 2 * g, m10 = -g;
    let nu = u, nb = b;
    for (let it = 0; it < 2; it++) {
      const Kn = K * tr(kc * nb), m01 = -g * (1 - 2 * Kn), m11 = 1 - g * (Kn - 1), det = m00 * m11 - m01 * m10;
      nu = (r0 * m11 - m01 * r1) / det; nb = (m00 * r1 - m10 * r0) / det;
    }
    this.u = nu; this.b = nb;
  }
}
// Sallen-Key high-pass, same feedback topology and scheme
class SKHigh {
  constructor() { this.v1 = 0; this.v2 = 0; this.xp = 0; this.g = 0.01; this.K = 0; this.clip = 1.6; this.gScale = 1; this.sub = 1; }
  setRes(r) { this.K = 3.55 * r; }
  setRate(fs) { this.sub = skSub(fs); }
  process(x) {
    const xp = this.xp, M = this.sub; this.xp = x;
    if (M === 1) this.step(xp, x);
    else { const d = (x - xp) / M; let xa = xp; for (let k = 1; k <= M; k++) { const xb = k === M ? x : xp + d * k; this.step(xa, xb); xa = xb; } }
    return x - this.v1 - this.v2;
  }
  step(xa, x) {
    const g = this.g, v1 = this.v1, v2 = this.v2, K = this.K, kc = K / this.clip;
    const Ko = K * tr(kc * (xa - v1 - v2));
    const r0 = v1 + g * ((Ko - 2) * v1 + (Ko - 1) * v2 + (2 - Ko) * xa), r1 = v2 + g * (-v1 - v2 + xa + x);
    const m10 = g, m11 = 1 + g;
    let n1 = v1, n2 = v2;
    for (let it = 0; it < 2; it++) {
      const Kn = K * tr(kc * (x - n1 - n2)), R0 = r0 + g * (2 - Kn) * x;
      const m00 = 1 - g * (Kn - 2), m01 = -g * (Kn - 1), det = m00 * m11 - m01 * m10;
      n1 = (R0 * m11 - m01 * r1) / det; n2 = (m00 * r1 - m10 * R0) / det;
    }
    this.v1 = n1; this.v2 = n2;
  }
}

// State-variable filter with saturating band-pass integrator
class SVF {
  constructor() { this.s1 = 0; this.s2 = 0; this.g = 0.05; this.R = 1; this.mode = 0; this.morph = 0; this.sat = 0.5; this.gScale = 1; this.sub = 1; }
  setRes(r) { this.R = 1 - 0.985 * Math.min(1, Math.max(0, r)); }
  setRate() {}
  process(x) {
    const g = this.g, R = this.R, s1 = this.s1, s2 = this.s2;
    const t = tr(s1 * this.sat);
    const bp = (g * (x - s2) + s1) / (1 + 2 * g * R * t + g * g * t);
    const lp = g * t * bp + s2;
    const hp = x - 2 * R * t * bp - lp;
    this.s1 = 2 * bp - s1; this.s2 = 2 * lp - s2;
    switch (this.mode) {
      case 0: return lp;
      case 1: return hp;
      case 3: return bp * 2 * R;
      default: { const m = this.morph; return (lp * (1 - m) + hp * m) * (1 + 0.8 * (1 - Math.abs(2 * m - 1))); }
    }
  }
}

class OnePoleHP {
  constructor() { this.s = 0; this.g = 0.001; this.gScale = 1; this.sub = 1; }
  setRes() {}
  setRate() {}
  process(x) {
    const G = this.g / (1 + this.g);
    const v = (x - this.s) * G, lp = v + this.s;
    this.s = lp + v;
    return x - lp;
  }
}

// four cascaded one-pole high-passes: 24 dB/oct, no resonance (Moog 904B)
class HP4 {
  constructor() { this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0; this.g = 0.001; this.gScale = 1; this.sub = 1; }
  setRes() {}
  setRate() {}
  process(x) {
    const G = this.g / (1 + this.g);
    let v = (x - this.s0) * G, lp = v + this.s0; this.s0 = lp + v; x -= lp;
    v = (x - this.s1) * G; lp = v + this.s1; this.s1 = lp + v; x -= lp;
    v = (x - this.s2) * G; lp = v + this.s2; this.s2 = lp + v; x -= lp;
    v = (x - this.s3) * G; lp = v + this.s3; this.s3 = lp + v;
    return x - lp;
  }
}

function makeLP(type) {
  switch (type) {
    case 'ota': return new Ladder(true);
    case 'diode': return new DiodeLadder();
    case 'sk': return new SKLow();
    case 'svf': return new SVF();
    default: return new Ladder(false);
  }
}
function makeHP(type) {
  switch (type) {
    case '1p': return new OnePoleHP();
    case '4p': return new HP4();
    case 'sk': return new SKHigh();
    case 'svf': { const f = new SVF(); f.mode = 1; return f; }
    default: return null;
  }
}

/* -------------------------------------------------- parameter smoothing */
// Panel moves arrive as whole patches (~60 Hz). Continuous parameters are slewed in the engine
// (two cascaded one-poles, advanced once per span) and interpolated per control chunk by the voices.
const S_VO = 0, S_VE = 1, S_VN = 2, S_VR = 3, S_DRV = 4, S_HO = 5, S_HR = 6, S_DO = 7, S_DR = 8, S_DH = 9, S_DHR = 10,
  S_LEV = 11, S_OL = 12, S_PW = 15, S_TU = 18, S_SUB = 21, S_NZ = 22, S_RING = 23, S_EXT = 24, S_RM = 25,
  S_BEND = 26, S_WHEEL = 27, S_AT = 28, S_N = 29;
function smv(e, i, cf) { return e.smA[i] + e.smD[i] * cf; }
// Kellet economy pink filter as designed at 44.1 kHz: pole corners (Hz), poles, input gains
const PINK_F = [16.51, 264.6, 3945], PINK_P = [0.99765, 0.963, 0.57], PINK_B = [0.0990460, 0.2965164, 1.0526913];

/* ------------------------------------------------------- analog voice */
class AVoice {
  constructor(e, i) {
    this.e = e; this.i = i;
    this.r = ((0x9E3779B9 * (i + 7)) >>> 0) || 1;
    this.ph0 = this.rnd01(); this.ph1 = this.rnd01(); this.ph2 = this.rnd01();
    this.sub = 1; this.y1p = 0; this.fbp = 0; this.fbH = 0; this.mlp = 0; this.mlp2 = 0;
    this.pk0 = 0; this.pk1 = 0; this.pk2 = 0; this.nzA = 0; this.nzM = 0;
    this.note = -1; this.pitch = 60; this.target = 60; this.vel = 0.8;
    this.gate = false; this.active = false; this.stamp = 0; this.sus = false; this.glc = 1;
    this.acc = 0; this.accS = 0; this.lfoT = 0;
    this.tol0 = this.rnd(); this.tol1 = this.rnd(); this.tol2 = this.rnd(); this.tolC = this.rnd(); this.tolE = this.rnd();
    this.d0 = 0; this.d1 = 0; this.d2 = 0;
    this.fenv = new Env(); this.aenv = new Env();
    this.g = 0.01; this.gh = 0.001; this.g2 = 0.01; this.gh2 = 0.001;
    this.f = null; this.h = null; this.f2 = null; this.h2 = null;
    this.ft = ''; this.ht = ''; this.ft2 = ''; this.ht2 = '';
    this.ampS = 0; this.vg = 0; this.ampSnap = true; this.offT = 0;     // slewed VCA gain, ramped gain, idle stamp
    this.rmPh = (i * 0.6180339887) % 1; this.rmHz = 0;                  // ring modulator (free-running)
    this.ilv = 0; this.ilSt = 0; this.il0 = 0; this.ilQ = 0;            // IL/AL filter envelope (CS-80)
    // band-limited slave (osc 2 under hard sync or audio-rate PWM): pending output, corrections for the current /
    // previous sample, comparator state, PW CV at the last sample, phase; per-span copies of the waveform mix
    this.sAct = false; this.sPend = 0; this.sC = 0; this.sP = 0; this.sQ = 0; this.sPw = 0.5; this.sPh = 0;
    this.xSa = 0; this.xPu = 0; this.xTri = 0; this.xSi = 0; this.xBow = 0; this.xPk = 0; this.xPb = 0.5; this.xSync = false;
    this.mSa = 0; this.mPu = 0; this.mTri = 0; this.mSi = 0; this.mPw = 0.5;
  }
  rnd() { let x = this.r; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.r = x >>> 0; return this.r / 2147483648 - 1; }
  rnd01() { return (this.rnd() + 1) * 0.5; }
  cfgLP(f, c, res) {
    f.setRes(res);
    if (f instanceof Ladder) { f.comp = c.comp || 0; f.fbSat = c.fbSat || 0; f.tap2 = c.poles === 2; }
    if (f instanceof SVF) { f.mode = c.mode === undefined ? 0 : c.mode; f.morph = c.morph || 0; f.sat = c.sat || 0.5; }
    if (f instanceof SKLow) f.clip = c.clip || 1.6;
  }
  apply(p) {
    const e = this.e;
    if (this.ft !== p.vcf.type) { this.f = makeLP(p.vcf.type); this.ft = p.vcf.type; }
    this.cfgLP(this.f, p.vcf, p.vcf.res); this.f.setRate(e.fs);
    if (this.ht !== p.hpf.type) { this.h = makeHP(p.hpf.type); this.ht = p.hpf.type; }
    if (this.h) { this.h.setRes(p.hpf.res || 0); this.h.setRate(e.fs); if (this.h instanceof SKHigh) this.h.clip = p.hpf.clip || 1.6; }
    if (p.dual) {
      const d = p.dual;
      if (this.ft2 !== p.vcf.type) { this.f2 = makeLP(p.vcf.type); this.ft2 = p.vcf.type; }
      this.cfgLP(this.f2, p.vcf, d.res); this.f2.setRate(e.fs);
      if (this.ht2 !== p.hpf.type) { this.h2 = makeHP(p.hpf.type); this.ht2 = p.hpf.type; }
      if (this.h2) { this.h2.setRes(d.hres || 0); this.h2.setRate(e.fs); }
    }
    const tf = 1 + 0.07 * this.tolE * p.drift;
    const A = p.aenv, F = p.fenv;
    this.aenv.set(A.a * tf, A.d * tf, A.s, A.r * tf, e.fs, p.envOv);
    this.fenv.set(F.a * tf, F.d * tf, F.s, F.r * tf, e.fs / e.CH, p.envOv);
    if (p.tb) this.fenv.setDecay(this.acc ? 0.2 : F.d * tf, e.fs / e.CH); // a patch refresh keeps the accent decay
  }
  // a voice that went idle: let its filter EG carry on discharging for the time it was not rendered
  wake() {
    const e = this.e, fe = this.fenv, dt = e.ctl - this.offT;
    if (dt > 0 && fe.st === 3) { fe.v *= Math.pow(1 - fe.cr, dt); if (fe.v < 1e-5) { fe.v = 0; fe.st = 0; } }
    this.aenv.v = 0; this.aenv.st = 0;
  }
  // hard stop (panic / voice rebuild): clear every state so the next note starts from silence
  kill() {
    this.active = false; this.gate = false; this.sus = false;
    this.aenv.v = this.fenv.v = 0; this.aenv.st = this.fenv.st = 0; this.accS = 0; this.ilSt = 0;
    this.ampSnap = true; this.offT = this.e.ctl;
    this.mlp = this.mlp2 = this.fbp = this.fbH = this.y1p = 0;
    this.ft = this.ht = this.ft2 = this.ht2 = ''; this.apply(this.e.p); // fresh filter state
  }
  noteOn(n, v, legato, glc) {
    const p = this.e.p;
    if (!this.active) {
      this.wake();
      const f = this.f; // a self-oscillating ladder that has never run speaks at once, like a free-running one
      if (f instanceof Ladder && f.k > 4 && Math.abs(f.s0) + Math.abs(f.s1) + Math.abs(f.s2) + Math.abs(f.s3) < 1e-4) f.seed(this.rnd() > 0 ? 0.08 : -0.08);
    }
    this.note = n; this.target = n + (this.det || 0); this.vel = v; this.glc = glc;
    if (glc >= 1) this.pitch = this.target;
    if (p.tb) {
      this.acc = (p.tb.latch || v > 0.79) ? 1 : 0;
      this.fenv.setDecay(this.acc ? 0.2 : p.fenv.d * (1 + 0.07 * this.tolE * p.drift), this.e.fs / this.e.CH);
    }
    if (!legato || !this.gate) {
      if (this.aenv.v < 0.02) this.ampSnap = true; // new gate from (near) silence: full attack punch, no gain glide
      this.fenv.on(); this.aenv.on(); this.lfoT = 0;
      if (p.tb) this.fenv.v = 0; // 303 MEG discharges on each new gate
      if (p.fenvIL) { this.ilv = this.il0 = p.fenvIL.il; this.ilQ = 0; this.ilSt = 1; } // every new gate starts at IL
    } else if (p.tb && this.acc) { this.fenv.on(); }
    this.gate = true; this.active = true; this.sus = false;
  }
  noteOff() { this.gate = false; this.fenv.off(); this.aenv.off(); if (this.ilSt) this.ilSt = 3; }
  /* ---- band-limited slave oscillator (osc 2) for hard sync and audio-rate PWM ----
   * The naive waveform plus explicit 2-point polyBLEP / polyBLAMP corrections placed at the exact time of every
   * event inside the sample (slave wraps, sync resets, pulse-comparator flips, triangle corners), output one
   * sample late so both halves of each correction land. Positions u run from 0 (previous sample) to 1 (this one). */
  ev(u, D, M) { // step D and slope change M (per sample) at u
    const t = 1 - u;
    this.sC += u * u * (u * M / 6 - 0.5 * D);
    this.sP += t * t * (0.5 * D + t * M / 6);
  }
  // osc 1's naive value (the PW CV source); hi: the high side exactly at its pulse edge
  nv0(x, hi) { return this.mSa * nvSaw(x, this.xBow) + this.mPu * (x < this.mPw || hi ? 1 : -1) + this.mTri * nvTri(x) + this.mSi * sin1(x); }
  // a stretch without a phase jump (phase pa → pb, PW CV ca → cb): triangle corner, comparator crossing
  run(u0, u1, pa, pb, ca, cb, d1, pu, tri) {
    if (tri !== 0 && pa < 0.5 && pb >= 0.5) this.ev(u0 + (0.5 - pa) / d1, 0, -8 * tri * d1);
    if (pu !== 0) {
      const ea = pa - ca, eb = pb - cb, q = eb < 0 ? 1 : -1;
      if (q !== this.sQ) { let x = ea !== eb ? ea / (ea - eb) : 1; x = x < 0 ? 0 : x > 1 ? 1 : x; this.ev(u0 + (u1 - u0) * x, pu * (q - this.sQ), 0); this.sQ = q; }
    }
  }
  // the slave phase runs from ph over [u0, u1] (at most one wrap); returns the phase at u1
  piece(u0, u1, ph, c0, c1, d1, sa, pu, tri, bow) {
    let pe = ph + d1 * (u1 - u0);
    if (pe < 1) { this.run(u0, u1, ph, pe, c0, c1, d1, pu, tri); return pe; }
    const uw = u0 + (1 - ph) / d1, cw = u1 > u0 ? c0 + (c1 - c0) * (uw - u0) / (u1 - u0) : c0;
    this.run(u0, uw, ph, 1, c0, cw, d1, pu, tri);
    this.ev(uw, -2 * sa, (4 * sa * bow + 8 * tri) * d1);
    if (pu !== 0 && this.sQ !== 1) { this.ev(uw, pu * (1 - this.sQ), 0); this.sQ = 1; }
    pe -= 1;
    this.run(uw, u1, 0, pe, cw, c1, d1, pu, tri);
    return pe;
  }
  slave(ph0, d0, wrap, ph1, d1) {
    const sa = this.xSa, pu = this.xPu, tri = this.xTri, si = this.xSi, bow = this.xBow, pk = this.xPk, pb = this.xPb;
    const cvE = clampPw(pk !== 0 ? pb + pk * this.nv0(ph0, false) : pb);
    if (!wrap && this.sQ !== 0) { // most samples: no event at all (no wrap, edge, corner or comparator flip)
      const pe = ph1 + d1, mp = this.mPw;
      if (pe < 1 && (tri === 0 || pe < 0.5 || ph1 >= 0.5) && (pu === 0 || (pe < cvE ? 1 : -1) === this.sQ) &&
        (pk === 0 || this.mPu === 0 || ph0 < mp || ph0 - d0 >= mp)) {
        const out = this.sPend;
        this.sPw = cvE; this.sPh = pe;
        this.sPend = sa * nvSaw(pe, bow) + pu * this.sQ + tri * nvTri(pe) + si * sin1(pe);
        return out;
      }
    }
    this.sC = 0; this.sP = 0;
    let cv = this.sPw, ph = ph1, u = 0;
    if (this.sQ === 0) this.sQ = ph < cv ? 1 : -1;
    // master events inside this sample, in time order: its wrap (the sync reset, and a jump of the PW CV) and,
    // when it drives the PW, its own pulse edge
    let uA = 2, uB = 2, rA = false, rB = false, a0 = 0, a1 = 0, b0 = 0, b1 = 0;
    if (wrap) {
      uA = 1 - ph0 / d0; rA = this.xSync;
      if (pk !== 0) { a0 = clampPw(pb + pk * this.nv0(1, false)); a1 = clampPw(pb + pk * this.nv0(0, false)); } else a0 = a1 = cvE;
    }
    if (pk !== 0 && this.mPu !== 0) {
      const pw = this.mPw, pp = ph0 - d0 + (wrap ? 1 : 0);
      let ue = 2;
      if (pp < pw && (wrap || ph0 >= pw)) ue = (pw - pp) / d0; else if (wrap && ph0 >= pw) ue = uA + pw / d0;
      if (ue <= 1) {
        const x0 = clampPw(pb + pk * this.nv0(pw, true)), x1 = clampPw(pb + pk * this.nv0(pw, false));
        if (ue < uA) { uB = uA; rB = rA; b0 = a0; b1 = a1; uA = ue; rA = false; a0 = x0; a1 = x1; } else { uB = ue; b0 = x0; b1 = x1; }
      }
    }
    for (let k = 0; k < 3; k++) {
      const ue = k === 0 ? uA : k === 1 ? uB : 1;
      if (ue > 1) continue;
      const cb = k === 0 ? a0 : k === 1 ? b0 : cvE;
      ph = this.piece(u, ue, ph, cv, cb, d1, sa, pu, tri, bow);
      if (k === 2) break;
      if (k === 0 ? rA : rB) { // sync reset: value and slope steps from the slave's phase to 0
        const D = -sa * (1 + nvSaw(ph, bow)) - tri * (1 + nvTri(ph)) - si * sin1(ph);
        const M = (4 * sa * bow * ph + (ph < 0.5 ? 0 : 8 * tri) + si * TAU * (1 - sin1(ph + 0.25))) * d1;
        this.ev(ue, D, M); ph = 0;
      }
      cv = k === 0 ? a1 : b1;
      if (pu !== 0) { const q = ph < cv ? 1 : -1; if (q !== this.sQ) { this.ev(ue, pu * (q - this.sQ), 0); this.sQ = q; } }
      u = ue;
    }
    this.sPw = cvE; this.sPh = ph;
    const out = this.sPend + this.sP;
    this.sPend = sa * nvSaw(ph, bow) + pu * this.sQ + tri * nvTri(ph) + si * sin1(ph) + this.sC;
    return out;
  }
  // CS-80 IL/AL filter EG (octaves): IL → AL over attack, AL → 0 over decay (held), back to IL over release
  ilTick(IL) {
    const fe = this.fenv;
    switch (this.ilSt) {
      case 1: this.ilQ += (fe.ov - this.ilQ) * fe.ca; if (this.ilQ >= 1) { this.ilQ = 1; this.ilSt = 2; } this.ilv = this.il0 + (IL.al - this.il0) * this.ilQ; break;
      case 2: this.ilv -= this.ilv * fe.cd; break;
      case 3: this.ilv += (IL.il - this.ilv) * fe.cr; if (Math.abs(IL.il - this.ilv) < 1e-5) { this.ilv = IL.il; this.ilSt = 0; } break;
      default: this.ilv = IL.il;
    }
    return this.ilv;
  }
  render(buf, N) {
    const e = this.e, p = e.p, CH = e.CH, fs = e.fs, ifs = 1 / fs;
    const O0 = p.osc[0], O1 = p.osc[1], O2 = p.osc[2];
    const vcf = p.vcf, hpf = p.hpf, L = p.lfo, tb = p.tb, m3 = p.mod3, dual = p.dual, IL = p.fenvIL, rm = p.rm;
    const f = this.f, h = this.h, f2 = this.f2, h2 = this.h2;
    const drift = p.drift, bow = p.sawBow, bwc = e.bwc, mv = e.smMv, SA = e.smA, SD = e.smD, SB = e.smB;
    const sa0 = O0.saw, pu0 = O0.pulse, tri0 = O0.tri, si0 = O0.sine;
    const sa1 = O1.saw, pu1 = O1.pulse, tri1 = O1.tri, si1 = O1.sine;
    const sa2 = O2.saw, pu2 = O2.pulse, tri2 = O2.tri, si2 = O2.sine;
    const pink = p.pink, nzW = pink ? 1 : e.nzW, fbK = e.fbHPc, aK = e.ampK;
    const fm01 = p.fm01, fm10 = p.fm10, sync = p.sync, pOscPw = p.polyOscPw, pOscF = p.polyOscFilt;
    const cx = sync !== 0 || (pOscPw !== 0 && pu1 !== 0); // osc 2 through the band-limited sync / PWM path
    if (cx) {
      if (!this.sAct) { // entering the path: start from the oscillator's current naive value (no one-sample gap)
        const x = this.ph1, w = clampPw(SB[S_PW + 1]); this.sQ = x < w ? 1 : -1; this.sPw = w;
        this.sPend = sa1 * nvSaw(x, bow) + pu1 * this.sQ + tri1 * nvTri(x) + si1 * sin1(x);
      }
      this.xSa = sa1; this.xPu = pu1; this.xTri = tri1; this.xSi = si1; this.xBow = bow; this.xPk = pOscPw; this.xSync = sync !== 0;
      this.mSa = sa0; this.mPu = pu0; this.mTri = tri0; this.mSi = si0;
    }
    this.sAct = cx;
    const needNoise = p.noise !== 0 || SB[S_NZ] !== 0 || (m3 && m3.mix > 0);
    const pkP0 = e.pkP[0], pkP1 = e.pkP[1], pkP2 = e.pkP[2], pkB0 = e.pkB[0], pkB1 = e.pkB[1], pkB2 = e.pkB[2], pkS = e.pkS;
    const nzMR = pink ? 1 : e.nzMR, nzMW = pink ? 1 : e.nzMW; // white noise as a modulation source (see setOS)
    if (rm) this.rmHz = rm.rate;
    const rmInc = this.rmHz * ifs;
    const gMax = Math.tan(Math.PI * 0.46);
    const nCh = N / CH, iN = 1 / nCh;
    // State-variable paths run inline, state in locals (no per-sample calls; the CS-80's two HP → LP chains are
    // interleaved so their recursions overlap): dsv = dual SVF chain, ssv = single SVF low-pass without HP
    const dsv = dual !== null && f instanceof SVF && f2 instanceof SVF && h instanceof SVF && h2 instanceof SVF &&
      f.mode === 0 && f2.mode === 0 && h.mode === 1 && h2.mode === 1;
    const ssv = dual === null && h === null && f instanceof SVF && f.mode === 0;
    let fa1 = 0, fa2 = 0, fb1 = 0, fb2 = 0, ha1 = 0, ha2 = 0, hb1 = 0, hb2 = 0, faS = 0, fbS = 0, haS = 0, hbS = 0;
    if (dsv || ssv) { fa1 = f.s1; fa2 = f.s2; faS = f.sat; }
    if (dsv) { fb1 = f2.s1; fb2 = f2.s2; fbS = f2.sat; ha1 = h.s1; ha2 = h.s2; haS = h.sat; hb1 = h2.s1; hb2 = h2.s2; hbS = h2.sat; }
    let ph0 = this.ph0, ph1 = this.ph1, ph2 = this.ph2, sub = this.sub, y1p = this.y1p;
    let mlp = this.mlp, mlp2 = this.mlp2, fbp = this.fbp, fbH = this.fbH, pk0 = this.pk0, pk1 = this.pk1, pk2 = this.pk2, nzA = this.nzA, nzM = this.nzM;
    let g = this.g, gh = this.gh, g2 = this.g2, gh2 = this.gh2, as = this.ampS, vg = this.vg, rmPh = this.rmPh;
    // slewed panel values: constant for this span unless something is moving (then interpolated per chunk)
    let bnd = SB[S_BEND], wm = SB[S_WHEEL], at = SB[S_AT], lev0 = SB[S_OL], lev1 = SB[S_OL + 1], lev2 = SB[S_OL + 2];
    let subL = SB[S_SUB], nzL = SB[S_NZ], ringL = SB[S_RING], extS = SB[S_EXT], rmD = SB[S_RM], lev = SB[S_LEV];
    let tu0 = SB[S_TU], tu1 = SB[S_TU + 1], tu2 = SB[S_TU + 2], pb0 = SB[S_PW], pb1 = SB[S_PW + 1], pb2 = SB[S_PW + 2];
    let vo = SB[S_VO], ve = SB[S_VE], vn = SB[S_VN], ho = SB[S_HO], dO = SB[S_DO], dH = SB[S_DH], drv = SB[S_DRV], odrv = 1 / Math.sqrt(drv);
    // The per-sample helpers are written out (PRNG = rnd(), amp EG = Env.tick(), tr(), blep(), blamp()): with every
    // engine path warm, render's inlining budget runs out long before these, and each real call boxes its numbers.
    const ae = this.aenv, aca = ae.ca, acd = ae.cd, acr = ae.cr, aS = ae.s, aov = ae.ov;
    let av = ae.v, ast = ae.st, rs = this.r, q = 0; // q: scratch of the written-out polyBLEP / polyBLAMP
    let idx = 0;
    for (let c = 0; c < nCh; c++) {
      /* ---- control rate ---- */
      if (mv) {
        const cf = (c + 1) * iN;
        bnd = SA[S_BEND] + SD[S_BEND] * cf; wm = SA[S_WHEEL] + SD[S_WHEEL] * cf; at = SA[S_AT] + SD[S_AT] * cf;
        lev0 = SA[S_OL] + SD[S_OL] * cf; lev1 = SA[S_OL + 1] + SD[S_OL + 1] * cf; lev2 = SA[S_OL + 2] + SD[S_OL + 2] * cf;
        subL = SA[S_SUB] + SD[S_SUB] * cf; nzL = SA[S_NZ] + SD[S_NZ] * cf; ringL = SA[S_RING] + SD[S_RING] * cf;
        extS = SA[S_EXT] + SD[S_EXT] * cf; rmD = SA[S_RM] + SD[S_RM] * cf; lev = SA[S_LEV] + SD[S_LEV] * cf;
        tu0 = SA[S_TU] + SD[S_TU] * cf; tu1 = SA[S_TU + 1] + SD[S_TU + 1] * cf; tu2 = SA[S_TU + 2] + SD[S_TU + 2] * cf;
        pb0 = SA[S_PW] + SD[S_PW] * cf; pb1 = SA[S_PW + 1] + SD[S_PW + 1] * cf; pb2 = SA[S_PW + 2] + SD[S_PW + 2] * cf;
        vo = SA[S_VO] + SD[S_VO] * cf; ve = SA[S_VE] + SD[S_VE] * cf; vn = SA[S_VN] + SD[S_VN] * cf;
        ho = SA[S_HO] + SD[S_HO] * cf; dO = SA[S_DO] + SD[S_DO] * cf; dH = SA[S_DH] + SD[S_DH] * cf;
        drv = SA[S_DRV] + SD[S_DRV] * cf; odrv = 1 / Math.sqrt(drv);
        // resonance moves with the knob, not in 60 Hz steps
        f.setRes(SA[S_VR] + SD[S_VR] * cf); if (h) h.setRes(SA[S_HR] + SD[S_HR] * cf);
        if (dual) { f2.setRes(SA[S_DR] + SD[S_DR] * cf); if (h2) h2.setRes(SA[S_DHR] + SD[S_DHR] * cf); }
      }
      this.pitch += (this.target - this.pitch) * this.glc;
      const fe = this.fenv.tick();
      let ld = 1;
      if (L.delay > 0) {
        this.lfoT += CH * ifs;
        ld = (this.lfoT - L.delay * 0.5) / (L.delay * 0.5);
        ld = ld < 0 ? 0 : ld > 1 ? 1 : ld;
      }
      const lfo = e.lfoBuf[c] * ld;
      if (drift > 0) {
        this.d0 += ((rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) - this.d0) * e.ouB;
        this.d1 += ((rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) - this.d1) * e.ouB;
        this.d2 += ((rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) - this.d2) * e.ouB;
      }
      const dn = drift * e.ouN;
      const base = this.pitch + bnd + e.gdrift * drift + lfo * (L.pitch + wm * L.wheelPitch) + at * (p.atPitch || 0);
      const bnk = 60 + bnd;
      const on0 = O0.on || lev0 > 1e-6, on1 = O1.on || lev1 > 1e-6, on2 = O2.on || lev2 > 1e-6 || m3; // fade out when switched off
      let s0 = (O0.kbd ? base : bnk) + tu0 + drift * 0.03 * this.tol0 + 0.04 * this.d0 * dn + O0.envPitch * fe + (O0.lfoPitch + wm * O0.wheelPitch) * lfo;
      let s1 = (O1.kbd ? base : bnk) + tu1 + drift * 0.03 * this.tol1 + 0.04 * this.d1 * dn + O1.envPitch * fe + (O1.lfoPitch + wm * O1.wheelPitch) * lfo;
      let s2 = (O2.kbd ? base : bnk) + tu2 + drift * 0.03 * this.tol2 + 0.04 * this.d2 * dn + O2.envPitch * fe + (O2.lfoPitch + wm * O2.wheelPitch) * lfo;
      let dt0 = 440 * Math.pow(2, (s0 - 69) / 12) * ifs; if (dt0 > 0.45) dt0 = 0.45;
      let dt1 = 440 * Math.pow(2, (s1 - 69) / 12) * ifs; if (dt1 > 0.45) dt1 = 0.45;
      let dt2 = 440 * Math.pow(2, (s2 - 69) / 12) * ifs; if (dt2 > 0.45) dt2 = 0.45;
      let pw0 = pb0 + (O0.pwLfo + wm * O0.wheelPw) * lfo + O0.pwEnv * fe; pw0 = pw0 < 0.02 ? 0.02 : pw0 > 0.98 ? 0.98 : pw0;
      const pw1b = pb1 + (O1.pwLfo + wm * O1.wheelPw) * lfo + O1.pwEnv * fe;
      if (cx) { this.mPw = pw0; this.xPb = pw1b; }
      let pw2 = pb2 + (O2.pwLfo + wm * O2.wheelPw) * lfo; pw2 = pw2 < 0.02 ? 0.02 : pw2 > 0.98 ? 0.98 : pw2;
      // filter cutoff (octaves above 1 Hz)
      const fmod = (IL ? this.ilTick(IL) : ve + vn * fe) + vcf.kbd * (this.pitch - 60) / 12 +
        lfo * (vcf.lfo + wm * L.wheelFilter) + vcf.vel * (this.vel - 0.75) + 0.05 * this.tolC * drift + at * (vcf.at || 0);
      let co = vo + fmod;
      let amp = lev * (1 - p.velAmp * (1 - this.vel));
      if (tb) {
        const tgt = this.acc ? tb.accent * fe : 0;
        this.accS += (tgt - this.accS) * (tgt > this.accS ? tb.chg : tb.dis);
        co += this.accS * 2.2;
        amp *= 1 + this.acc * tb.accent * 0.9;
      }
      // VCA gain: slewed (~2 ms) and ramped across the chunk, so accent / level / velocity changes on a
      // sounding note never step; a gate from silence snaps to the target for the full attack
      const lfT = 1 + L.amp * lfo;
      if (this.ampSnap) { as = amp; vg = amp * lfT; this.ampSnap = false; }
      as += (amp - as) * aK;
      const vgInc = (as * lfT - vg) / CH;
      // external input: AC-coupled post-VCA feedback, loop gain held below unity so it cannot latch or motorboat
      let extL = extS;
      if (extL > 0) {
        const lad = f instanceof Ladder, fk = lad ? f.k : 0, cap = 0.9 * (1 + fk) / (Math.sqrt(drv) * (1 + (f.comp || 0) * (lad ? f.kc : 0)));
        if (extL > cap) extL = cap;
      }
      const rmOn = rmD > 1e-6;
      let fc = Math.pow(2, co); if (fc < 5) fc = 5; if (fc > e.fcMax) fc = e.fcMax;
      const gT = Math.tan(Math.PI * fc * ifs / f.sub) * f.gScale;
      const gInc = (gT - g) / CH;
      let ghInc = 0, g2Inc = 0, gh2Inc = 0;
      if (h) {
        let fh = Math.pow(2, ho + (hpf.env || 0) * fe + (hpf.kbd || 0) * (this.pitch - 60) / 12 + lfo * (hpf.lfo || 0));
        if (fh < 5) fh = 5; if (fh > e.fcMax) fh = e.fcMax;
        ghInc = (Math.tan(Math.PI * fh * ifs / h.sub) - gh) / CH;
      }
      if (dual) {
        let fc2 = Math.pow(2, dO + fmod); if (fc2 < 5) fc2 = 5; if (fc2 > e.fcMax) fc2 = e.fcMax;
        g2Inc = (Math.tan(Math.PI * fc2 * ifs / f2.sub) * f2.gScale - g2) / CH;
        if (h2) {
          let fh2 = Math.pow(2, dH); if (fh2 > e.fcMax) fh2 = e.fcMax;
          gh2Inc = (Math.tan(Math.PI * fh2 * ifs / h2.sub) - gh2) / CH;
        }
      }
      const faR = f.R, fbR = dsv ? f2.R : 0, haR = dsv ? h.R : 0, hbR = dsv ? h2.R : 0;
      /* ---- audio rate ---- */
      for (let j = 0; j < CH; j++, idx++) {
        if (ast === 1) { av += (aov - av) * aca; if (av >= 1) { av = 1; ast = 2; } }
        else if (ast === 2) av += (aS - av) * acd;
        else if (ast === 3) { av -= av * acr; if (av < 1e-5) { av = 0; ast = 0; } }
        const a = av;
        let nz = 0;
        if (needNoise) {
          nz = (rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1);
          if (pink) { // Kellet economy pink, poles at fixed frequencies so the spectrum does not move with the rate
            const np = nz * pkS;
            pk0 = pkP0 * pk0 + np * pkB0; pk1 = pkP1 * pk1 + np * pkB1; pk2 = pkP2 * pk2 + np * pkB2;
            nz = (pk0 + pk1 + pk2 + np * 0.1848) * 0.22;
          }
        }
        let w2 = 0;
        if (on2) {
          ph2 += dt2; if (ph2 >= 1) ph2 -= 1;
          w2 = 0; // band-limited core: polyBLEP saw / pulse, polyBLAMP triangle, sine
          const bl2 = ph2 < dt2 ? (q = ph2 / dt2, q + q - q * q - 1) : ph2 > 1 - dt2 ? (q = (ph2 - 1) / dt2, q * q + q + q + 1) : 0;
          if (sa2 !== 0) w2 += sa2 * (2 * (ph2 + bow * ph2 * (1 - ph2)) - 1 - bl2);
          if (pu2 !== 0) {
            let t2 = ph2 - pw2; if (t2 < 0) t2 += 1;
            w2 += pu2 * ((ph2 < pw2 ? 1 : -1) + bl2 - (t2 < dt2 ? (q = t2 / dt2, q + q - q * q - 1) : t2 > 1 - dt2 ? (q = (t2 - 1) / dt2, q * q + q + q + 1) : 0));
          }
          if (tri2 !== 0) {
            let t2 = ph2 + 0.5; if (t2 >= 1) t2 -= 1;
            const a1 = ph2 < dt2 ? (q = ph2 / dt2 - 1, -q * q * q / 3) : ph2 > 1 - dt2 ? (q = (ph2 - 1) / dt2 + 1, q * q * q / 3) : 0;
            const a2 = t2 < dt2 ? (q = t2 / dt2 - 1, -q * q * q / 3) : t2 > 1 - dt2 ? (q = (t2 - 1) / dt2 + 1, q * q * q / 3) : 0;
            w2 += tri2 * ((ph2 < 0.5 ? 4 * ph2 - 1 : 3 - 4 * ph2) + 4 * dt2 * (a1 - a2));
          }
          if (si2 !== 0) w2 += si2 * sin1(ph2);
        }
        let d0 = dt0, d1 = dt1, m = 0;
        if (m3) {
          if ((nzA += nzMR) >= 1) { nzA -= 1; nzM = nz * nzMW; }
          m = (1 - m3.mix) * w2 + m3.mix * nzM;
          if (m3.osc) { const k = exp2(m * wm * 0.7); d0 *= k; d1 *= k; }
        }
        if (fm10 !== 0) d0 *= exp2(fm10 * y1p);
        if (d0 > 0.45) d0 = 0.45;
        let w0 = 0, wrap = false;
        if (on0) {
          ph0 += d0;
          if (ph0 >= 1) { ph0 -= 1; wrap = true; sub = -sub; }
          w0 = 0; // band-limited core: polyBLEP saw / pulse, polyBLAMP triangle, sine
          const bl0 = ph0 < d0 ? (q = ph0 / d0, q + q - q * q - 1) : ph0 > 1 - d0 ? (q = (ph0 - 1) / d0, q * q + q + q + 1) : 0;
          if (sa0 !== 0) w0 += sa0 * (2 * (ph0 + bow * ph0 * (1 - ph0)) - 1 - bl0);
          if (pu0 !== 0) {
            let t2 = ph0 - pw0; if (t2 < 0) t2 += 1;
            w0 += pu0 * ((ph0 < pw0 ? 1 : -1) + bl0 - (t2 < d0 ? (q = t2 / d0, q + q - q * q - 1) : t2 > 1 - d0 ? (q = (t2 - 1) / d0, q * q + q + q + 1) : 0));
          }
          if (tri0 !== 0) {
            let t2 = ph0 + 0.5; if (t2 >= 1) t2 -= 1;
            const a1 = ph0 < d0 ? (q = ph0 / d0 - 1, -q * q * q / 3) : ph0 > 1 - d0 ? (q = (ph0 - 1) / d0 + 1, q * q * q / 3) : 0;
            const a2 = t2 < d0 ? (q = t2 / d0 - 1, -q * q * q / 3) : t2 > 1 - d0 ? (q = (t2 - 1) / d0 + 1, q * q * q / 3) : 0;
            w0 += tri0 * ((ph0 < 0.5 ? 4 * ph0 - 1 : 3 - 4 * ph0) + 4 * d0 * (a1 - a2));
          }
          if (si0 !== 0) w0 += si0 * sin1(ph0);
        }
        let w1 = 0;
        if (on1) {
          if (fm01 !== 0) { d1 *= exp2(fm01 * w0); if (d1 > 0.45) d1 = 0.45; }
          if (cx) { w1 = this.slave(ph0, d0, wrap, ph1, d1); ph1 = this.sPh; }
          else {
            ph1 += d1;
            if (ph1 >= 1) ph1 -= Math.floor(ph1);
            let pw1 = pw1b + pOscPw * w0; pw1 = pw1 < 0.02 ? 0.02 : pw1 > 0.98 ? 0.98 : pw1;
            w1 = 0; // band-limited core: polyBLEP saw / pulse, polyBLAMP triangle, sine
            const bl1 = ph1 < d1 ? (q = ph1 / d1, q + q - q * q - 1) : ph1 > 1 - d1 ? (q = (ph1 - 1) / d1, q * q + q + q + 1) : 0;
            if (sa1 !== 0) w1 += sa1 * (2 * (ph1 + bow * ph1 * (1 - ph1)) - 1 - bl1);
            if (pu1 !== 0) {
              let t2 = ph1 - pw1; if (t2 < 0) t2 += 1;
              w1 += pu1 * ((ph1 < pw1 ? 1 : -1) + bl1 - (t2 < d1 ? (q = t2 / d1, q + q - q * q - 1) : t2 > 1 - d1 ? (q = (t2 - 1) / d1, q * q + q + q + 1) : 0));
            }
            if (tri1 !== 0) {
              let t2 = ph1 + 0.5; if (t2 >= 1) t2 -= 1;
              const a1 = ph1 < d1 ? (q = ph1 / d1 - 1, -q * q * q / 3) : ph1 > 1 - d1 ? (q = (ph1 - 1) / d1 + 1, q * q * q / 3) : 0;
              const a2 = t2 < d1 ? (q = t2 / d1 - 1, -q * q * q / 3) : t2 > 1 - d1 ? (q = (t2 - 1) / d1 + 1, q * q * q / 3) : 0;
              w1 += tri1 * ((ph1 < 0.5 ? 4 * ph1 - 1 : 3 - 4 * ph1) + 4 * d1 * (a1 - a2));
            }
            if (si1 !== 0) w1 += si1 * sin1(ph1);
          }
          y1p = w1;
        }
        let y;
        if (dsv) {
          const n2 = nzL * nz * nzW * 0.5;
          mlp += (w0 * lev0 + n2 + ringL * w0 * w1 - mlp) * bwc;
          mlp2 += (w1 * lev1 + n2 - mlp2) * bwc;
          gh += ghInc; gh2 += gh2Inc; g += gInc; g2 += g2Inc;
          let ta = ha1 * haS, tb = hb1 * hbS; ta *= ta; tb *= tb; // tr() of both, inline
          ta = ta > 9 ? 1 / Math.abs(ha1 * haS) : (27 + ta) / (27 + 9 * ta); tb = tb > 9 ? 1 / Math.abs(hb1 * hbS) : (27 + tb) / (27 + 9 * tb);
          const pa = (gh * (mlp - ha2) + ha1) / (1 + 2 * gh * haR * ta + gh * gh * ta);
          const pb = (gh2 * (mlp2 - hb2) + hb1) / (1 + 2 * gh2 * hbR * tb + gh2 * gh2 * tb);
          const la = gh * ta * pa + ha2, lb = gh2 * tb * pb + hb2;
          const xa = mlp - 2 * haR * ta * pa - la, xb = mlp2 - 2 * hbR * tb * pb - lb;
          ha1 = 2 * pa - ha1; ha2 = 2 * la - ha2; hb1 = 2 * pb - hb1; hb2 = 2 * lb - hb2;
          const ga = g > gMax ? gMax : g, gb = g2 > gMax ? gMax : g2;
          const ua = xa * drv + (rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) * 1e-6;
          const ub = xb * drv + (rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) * 1e-6;
          let sa = fa1 * faS, sb = fb1 * fbS; sa *= sa; sb *= sb;
          sa = sa > 9 ? 1 / Math.abs(fa1 * faS) : (27 + sa) / (27 + 9 * sa); sb = sb > 9 ? 1 / Math.abs(fb1 * fbS) : (27 + sb) / (27 + 9 * sb);
          const qa = (ga * (ua - fa2) + fa1) / (1 + 2 * ga * faR * sa + ga * ga * sa);
          const qb = (gb * (ub - fb2) + fb1) / (1 + 2 * gb * fbR * sb + gb * gb * sb);
          const oa = ga * sa * qa + fa2, ob = gb * sb * qb + fb2;
          fa1 = 2 * qa - fa1; fa2 = 2 * oa - fa2; fb1 = 2 * qb - fb1; fb2 = 2 * ob - fb2;
          y = (oa + ob) * odrv;
        } else if (!dual) {
          let mix = w0 * lev0 + w1 * lev1 + w2 * lev2;
          if (subL !== 0) {
            const b = ph0 < d0 ? (q = ph0 / d0, q + q - q * q - 1) : ph0 > 1 - d0 ? (q = (ph0 - 1) / d0, q * q + q + q + 1) : 0;
            mix += subL * (sub + (ph0 < 0.5 ? sub : -sub) * b);
          }
          if (nzL !== 0) mix += nzL * nz * nzW;
          if (ringL !== 0) mix += ringL * w0 * w1;
          if (extL !== 0) { fbH += (fbp - fbH) * fbK; mix += extL * (fbp - fbH); }
          mlp += (mix - mlp) * bwc;
          let x = mlp;
          if (h) { gh += ghInc; h.g = gh; x = h.process(x); }
          g += gInc;
          let gg = g;
          if (m3 && m3.filt) gg *= exp2(m * wm * 2.5);
          if (pOscF !== 0) gg *= exp2(pOscF * w0);
          gg = gg > gMax ? gMax : gg;
          const xf = x * drv + (rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) * 1e-6;
          if (ssv) {
            let t = fa1 * faS; t *= t; t = t > 9 ? 1 / Math.abs(fa1 * faS) : (27 + t) / (27 + 9 * t);
            const bp = (gg * (xf - fa2) + fa1) / (1 + 2 * gg * faR * t + gg * gg * t), lp = gg * t * bp + fa2;
            fa1 = 2 * bp - fa1; fa2 = 2 * lp - fa2;
            y = lp * odrv;
          } else { f.g = gg; y = f.process(xf) * odrv; }
          fbp = y * a; // the output patched back in comes after the VCA (Loudness Contour)
        } else {
          const n2 = nzL * nz * nzW * 0.5;
          mlp += (w0 * lev0 + n2 + ringL * w0 * w1 - mlp) * bwc;
          mlp2 += (w1 * lev1 + n2 - mlp2) * bwc;
          let xa = mlp, xb = mlp2;
          if (h) { gh += ghInc; h.g = gh; xa = h.process(xa); }
          if (h2) { gh2 += gh2Inc; h2.g = gh2; xb = h2.process(xb); }
          g += gInc; g2 += g2Inc;
          f.g = g > gMax ? gMax : g; f2.g = g2 > gMax ? gMax : g2;
          const ua = xa * drv + (rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) * 1e-6;
          y = (f.process(ua) + f2.process(xb * drv + (rs ^= rs << 13, rs ^= rs >>> 17, rs ^= rs << 5, rs >>>= 0, rs / 2147483648 - 1) * 1e-6)) * odrv;
        }
        if (rmOn) { // ring modulator on the voice output, before the VCA
          rmPh += rmInc; if (rmPh >= 1) rmPh -= 1;
          y *= 1 - rmD + rmD * sin1(rmPh);
        }
        vg += vgInc;
        buf[idx] += y * a * vg;
      }
    }
    if (dsv || ssv) { f.s1 = fa1; f.s2 = fa2; f.g = g > gMax ? gMax : g; }
    if (dsv) { f2.s1 = fb1; f2.s2 = fb2; f2.g = g2 > gMax ? gMax : g2; h.s1 = ha1; h.s2 = ha2; h.g = gh; h2.s1 = hb1; h2.s2 = hb2; h2.g = gh2; }
    this.ph0 = ph0; this.ph1 = ph1; this.ph2 = ph2; this.sub = sub; this.y1p = y1p;
    this.mlp = mlp; this.mlp2 = mlp2; this.fbp = fbp; this.fbH = fbH; this.pk0 = pk0; this.pk1 = pk1; this.pk2 = pk2; this.nzA = nzA; this.nzM = nzM;
    this.g = g; this.gh = gh; this.g2 = g2; this.gh2 = gh2; this.ampS = as; this.vg = vg; this.rmPh = rmPh;
    ae.v = av; ae.st = ast; this.r = rs;
    if (!this.gate && ae.st === 0) { this.active = false; this.offT = e.ctl; }
  }
}

/* ------------------------------------------------------------ FM (DX7) */
// [edges [from,to]], carriers, feedback [from, to]   (operator numbers 1..6)
const ALG_SRC = [
  [[[2, 1], [6, 5], [5, 4], [4, 3]], [1, 3], [6, 6]],
  [[[2, 1], [6, 5], [5, 4], [4, 3]], [1, 3], [2, 2]],
  [[[3, 2], [2, 1], [6, 5], [5, 4]], [1, 4], [6, 6]],
  [[[3, 2], [2, 1], [6, 5], [5, 4]], [1, 4], [4, 6]],
  [[[2, 1], [4, 3], [6, 5]], [1, 3, 5], [6, 6]],
  [[[2, 1], [4, 3], [6, 5]], [1, 3, 5], [5, 6]],
  [[[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [6, 6]],
  [[[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [4, 4]],
  [[[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [2, 2]],
  [[[3, 2], [2, 1], [5, 4], [6, 4]], [1, 4], [3, 3]],
  [[[3, 2], [2, 1], [5, 4], [6, 4]], [1, 4], [6, 6]],
  [[[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], [2, 2]],
  [[[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], [6, 6]],
  [[[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], [6, 6]],
  [[[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], [2, 2]],
  [[[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], [6, 6]],
  [[[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], [2, 2]],
  [[[2, 1], [3, 1], [4, 1], [5, 4], [6, 5]], [1], [3, 3]],
  [[[3, 2], [2, 1], [6, 4], [6, 5]], [1, 4, 5], [6, 6]],
  [[[3, 1], [3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]],
  [[[3, 1], [3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [3, 3]],
  [[[2, 1], [6, 3], [6, 4], [6, 5]], [1, 3, 4, 5], [6, 6]],
  [[[3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [6, 6]],
  [[[6, 3], [6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]],
  [[[6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]],
  [[[3, 2], [5, 4], [6, 4]], [1, 2, 4], [6, 6]],
  [[[3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]],
  [[[2, 1], [4, 3], [5, 4]], [1, 3, 6], [5, 5]],
  [[[4, 3], [6, 5]], [1, 2, 3, 5], [6, 6]],
  [[[4, 3], [5, 4]], [1, 2, 3, 6], [5, 5]],
  [[[6, 5]], [1, 2, 3, 4, 5], [6, 6]],
  [[], [1, 2, 3, 4, 5, 6], [6, 6]],
];
const ALGS = ALG_SRC.map(([edges, car, fb]) => {
  const mods = [[], [], [], [], [], []];
  for (const [a, b] of edges) mods[b - 1].push(a - 1);
  const isCar = [0, 0, 0, 0, 0, 0];
  for (const c of car) isCar[c - 1] = 1;
  return { mods, isCar, nCar: car.length, fbSrc: fb[0] - 1, fbDst: fb[1] - 1 };
});

function egSpeed(r) { return 2.5 * Math.pow(2, 0.148 * r); } // level units / s

class FVoice {
  constructor(e, i) {
    this.e = e; this.i = i;
    this.ph = new Float64Array(6); this.lv = new Float64Array(6); this.st = new Int8Array(6);
    this.amp = new Float64Array(6); this.ainc = new Float64Array(6); this.dt = new Float64Array(6);
    this.out = new Float64Array(6); this.vatt = new Float64Array(6); this.rs = new Float64Array(6);
    this.fbA = 0; this.fbB = 0;
    this.note = -1; this.pitch = 60; this.target = 60; this.vel = 0.8; this.glc = 1;
    this.gate = false; this.active = false; this.stamp = 0; this.sus = false; this.det = 0;
  }
  apply() {}
  noteOn(n, v, legato, glc) {
    const p = this.e.p;
    this.note = n; this.target = n + this.det; this.vel = v; this.glc = glc;
    if (glc >= 1) this.pitch = this.target;
    if (!legato || !this.gate) {
      for (let k = 0; k < 6; k++) {
        const op = p.ops[k];
        this.st[k] = 0;
        if (!this.active) this.lv[k] = op.L[3];
        this.vatt[k] = op.vel * (1 - v) * 4.2;            // dB
        this.rs[k] = op.rs * Math.max(0, n - 36) / 12 * 1.4; // rate scaling
        this.ph[k] = 0;                                  // oscillator key sync
      }
      this.fbA = this.fbB = 0;
    }
    this.gate = true; this.active = true; this.sus = false;
  }
  noteOff() { this.gate = false; for (let k = 0; k < 6; k++) this.st[k] = 3; }
  kill() { this.active = false; this.gate = false; this.sus = false; this.amp.fill(0); this.out.fill(0); this.fbA = this.fbB = 0; }
  // cnt / rate (Vintage DAC): control chunk c renders cnt[c] samples at the DAC rate instead of CH grid samples
  render(buf, N, cnt, rate) {
    const e = this.e, p = e.p, CH = e.CH, fs = e.fs, ct = CH / fs, nCh = N / CH, iN = 1 / nCh, rt = rate || fs;
    const alg = ALGS[p.alg - 1], mods = alg.mods, isCar = alg.isCar, fbSrc = alg.fbSrc, fbDst = alg.fbDst;
    const fbAmt = p.fb > 0 ? 0.24 * Math.pow(2, p.fb - 7) : 0;
    const inc = 1 / Math.sqrt(alg.nCar);
    const ph = this.ph, lv = this.lv, st = this.st, amp = this.amp, ainc = this.ainc, dt = this.dt, out = this.out;
    const m0 = mods[0], m1 = mods[1], m2 = mods[2], m3 = mods[3], m4 = mods[4], m5 = mods[5];
    const M = [m0, m1, m2, m3, m4, m5];
    let fbA = this.fbA, fbB = this.fbB, idx = 0, alive = false;
    for (let c = 0; c < nCh; c++) {
      const cf = (c + 1) * iN, norm = smv(e, S_LEV, cf) * inc, ns = cnt ? cnt[c] : CH;
      this.pitch += (this.target - this.pitch) * this.glc;
      const vib = e.lfoBuf[c] * (p.lfo.pitch + smv(e, S_WHEEL, cf) * p.lfo.wheelPitch);
      const hz = 440 * Math.pow(2, (this.pitch + (p.transpose || 0) + smv(e, S_BEND, cf) + vib - 69) / 12);
      for (let k = 0; k < 6; k++) {
        const op = p.ops[k];
        let Lc = lv[k], s = st[k];
        const tgt = op.L[s];
        let r = op.R[s] + this.rs[k]; if (r > 99) r = 99;
        const step = egSpeed(r) * ct * (tgt > Lc ? 1.6 : 1);
        if (Lc < tgt) { Lc += step; if (Lc >= tgt) { Lc = tgt; if (s < 2) s++; } }
        else if (Lc > tgt) { Lc -= step; if (Lc <= tgt) { Lc = tgt; if (s < 2) s++; } }
        else if (s < 2) s++;
        lv[k] = Lc; st[k] = s;
        let A = 0;
        if (Lc > 0 && op.out > 0) {
          const att = (99 - Lc) * 0.75 + (99 - op.out) * 0.75 + this.vatt[k];
          A = att > 110 ? 0 : Math.pow(2, -att / 6.0206);
        }
        if (ns > 0) ainc[k] = (A - amp[k]) / ns; else amp[k] = A;
        if (isCar[k] && (A > 1e-5 || s < 3)) alive = true;
        dt[k] = (op.fixed ? op.hz : hz * op.ratio) * op.det / rt;
      }
      for (let j = 0; j < ns; j++, idx++) {
        let y = 0;
        for (let k = 5; k >= 0; k--) {
          const a = (amp[k] += ainc[k]);
          const mk = M[k];
          let m = 0;
          for (let q = 0; q < mk.length; q++) m += out[mk[q]];
          if (k === fbDst) m += fbAmt * (fbA + fbB);
          const o = a * sin1(ph[k] + m);
          out[k] = o;
          let pk = ph[k] + dt[k]; if (pk >= 1) pk -= 1; ph[k] = pk;
          if (isCar[k]) y += o;
        }
        fbB = fbA; fbA = out[fbSrc] * 0.5;
        buf[idx] += y * norm;
      }
    }
    this.fbA = fbA; this.fbB = fbB;
    if (!this.gate && !alive) this.active = false;
  }
}

// DX7 DAC: 12-bit mantissa floating-point quantiser
function dacQ(v) {
  const x = v * 0.5, ax = Math.abs(x);
  const q = ax > 1e-9 ? Math.pow(2, Math.ceil(Math.log2(ax)) - 11) : 1e-9;
  return Math.round(x / q) * q * 2;
}

/* ----------------------------------------------- divide-down (Solina) */
const TOG_CLOCK = 2000240;
const TOG_DIV = [478, 451, 426, 402, 379, 358, 338, 319, 301, 284, 268, 253]; // MK50240, C8..B8
class Divide {
  constructor(e) {
    this.e = e;
    this.top = TOG_DIV.map(d => TOG_CLOCK / d);
    this.cyc = new Float64Array(12);
    for (let i = 0; i < 12; i++) this.cyc[i] = Math.random() * 4096;
    this.dTop = new Float64Array(12);
    this.env = new Float64Array(128); this.gate = new Uint8Array(128); this.list = [];
    this.fB = new SVF(); this.fM = new SVF(); this.fL = new SVF(); this.hB = new OnePoleHP();
    this.fB.setRes(0.35); this.fM.setRes(0.2); this.fL.setRes(0.1);
  }
  noteOn(n) { this.gate[n] = 1; if (this.list.indexOf(n) < 0) this.list.push(n); }
  noteOff(n) { this.gate[n] = 0; }
  allOff(hard) {
    this.gate.fill(0);
    if (hard) { // nothing frozen survives a panic / model switch (no ghost chord on return)
      this.env.fill(0); this.list.length = 0;
      for (const f of [this.fB, this.fM, this.fL]) f.s1 = f.s2 = 0;
      this.hB.s = 0;
    }
  }
  render(buf, N) {
    const e = this.e, p = e.p, fs = e.fs, ifs = 1 / fs, R = p.reg;
    const ca = 1 - Math.exp(-1 / (Math.max(0.003, p.attack) * 0.3 * fs));
    const cr = 1 - Math.exp(-1 / (Math.max(0.01, p.release) * 0.25 * fs));
    const tone = p.tone;
    const tg = (fc) => Math.tan(Math.PI * Math.min(fc, e.fcMax) * ifs);
    this.fB.g = tg(2600 * Math.pow(2, tone * 2)); this.fM.g = tg(1500 * Math.pow(2, tone * 1.5)); this.fL.g = tg(900 * Math.pow(2, tone));
    this.hB.g = tg(180);
    const top = this.top, cyc = this.cyc, env = this.env, gate = this.gate;
    const dTop = this.dTop;
    for (let i = 0; i < 12; i++) dTop[i] = top[i] * ifs;
    const list = this.list;
    const vB = R.violin, vT = R.trumpet, vV = R.viola, vH = R.horn, vC = R.cello, vCB = R.bass;
    const bend = Math.pow(2, e.smB[S_BEND] / 12);
    let lev = e.smA[S_LEV];
    const levInc = e.smD[S_LEV] / N;
    for (let i = 0; i < N; i++) {
      for (let q = 0; q < 12; q++) cyc[q] += dTop[q] * bend;
      let b = 0, m = 0, l = 0;
      for (let z = 0; z < list.length; z++) {
        const n = list[z];
        let ev = env[n];
        if (gate[n]) ev += (1 - ev) * ca; else ev -= ev * cr;
        env[n] = ev;
        const pc = n % 12;
        let sh = 9 - ((n / 12) | 0); if (sh < 1) sh = 1;
        const c = cyc[pc], dt = dTop[pc] * bend;
        const k8 = P2[80 - sh], k16 = P2[79 - sh], k4 = P2[81 - sh];
        let p8 = c * k8; p8 -= Math.floor(p8);
        let p16 = c * k16; p16 -= Math.floor(p16);
        let p4 = c * k4; p4 -= Math.floor(p4);
        const d8 = dt * k8, d16 = dt * k16, d4 = dt * k4;
        const s8 = 2 * p8 - 1 - blep(p8, d8);
        const s16 = 2 * p16 - 1 - blep(p16, d16);
        const s4 = d4 < 0.45 ? 2 * p4 - 1 - blep(p4, d4) : 0;
        let p8h = p8 + 0.5; if (p8h >= 1) p8h -= 1;
        const q8 = (p8 < 0.5 ? 1 : -1) + blep(p8, d8) - blep(p8h, d8);
        b += ev * (vB * (s8 + 0.55 * s4) + vT * (0.6 * q8 + 0.5 * s8));
        m += ev * (vV * (s8 + 0.25 * s4) + vH * q8);
        l += ev * (vC * (s16 + 0.6 * s8) + (n < 60 ? vCB * s16 * 1.3 : 0));
      }
      const y = this.fB.process(this.hB.process(b)) * 0.9 + this.fM.process(m) + this.fL.process(l) * 1.1;
      lev += levInc;
      buf[i] += y * lev;
    }
    for (let q = 0; q < 12; q++) if (cyc[q] > 1073741824) cyc[q] -= 1073741824;
    for (let z = list.length - 1; z >= 0; z--) { const n = list[z]; if (!gate[n] && env[n] < 1e-5) { env[n] = 0; list.splice(z, 1); } }
  }
  active() { return this.list.length; }
}

/* --------------------------------------------------------- decimation */
function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-17 * s) break; } return s; }
class Halfband {
  constructor(N, beta) {
    this.N = N; const c = (N - 1) / 2;
    const taps = [], idx = [];
    for (let n = 0; n < N; n++) {
      const k = n - c;
      if (k !== 0 && (k % 2 === 0)) continue;
      const sinc = k === 0 ? 0.5 : Math.sin(Math.PI * k / 2) / (Math.PI * k);
      const r = (n - c) / c;
      const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
      taps.push(sinc * w); idx.push(n);
    }
    let s = 0; for (const t of taps) s += t;
    this.h = Float64Array.from(taps.map(t => t / s)); this.ix = Int32Array.from(idx);
    this.buf = new Float64Array(2 * N); this.pos = 0;
  }
  process(inp, out, nOut) {
    const N = this.N, b = this.buf, h = this.h, ix = this.ix, nt = h.length;
    let pos = this.pos;
    for (let i = 0; i < nOut; i++) {
      pos = pos + 1 === N ? 0 : pos + 1; b[pos] = b[pos + N] = inp[2 * i];
      pos = pos + 1 === N ? 0 : pos + 1; b[pos] = b[pos + N] = inp[2 * i + 1];
      const o = pos + 1;
      let y = 0;
      for (let t = 0; t < nt; t++) y += h[t] * b[o + ix[t]];
      out[i] = y;
    }
    this.pos = pos;
  }
}

/* ------------------------------------------------------------------ FX */
class Biquad2 { // simple TPT 2-pole lowpass (Butterworth)
  constructor() { this.f = new SVF(); this.f.R = Math.SQRT1_2; this.f.sat = 0; }
  set(fc, fs) { this.f.g = Math.tan(Math.PI * Math.min(fc, fs * 0.45) / fs); }
  process(x) { return this.f.process(x); }
}

function hermite(buf, mask, pos) {
  const i = Math.floor(pos), f = pos - i;
  const xm = buf[(i - 1) & mask], x0 = buf[i & mask], x1 = buf[(i + 1) & mask], x2 = buf[(i + 2) & mask];
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

const CHORUS_MODES = [null, [0.513, 1.66e-3, 5.35e-3], [0.863, 1.66e-3, 5.35e-3], [9.75, 3.22e-3, 3.56e-3]];
// Both effects are always fed (a real BBD is always clocked), so switching one on never replays stale
// audio; the wet path fades in/out over ~15 ms and adds onto L/R, which hold the dry signal.
function resetSVF(b) { b.f.s1 = b.f.s2 = 0; }

// Roland Juno BBD chorus: two MN3009 lines with opposite triangle LFO, each with its own hiss
class Chorus {
  constructor(fs) {
    this.fs = fs; let sz = 1; while (sz < fs * 0.03) sz <<= 1;
    this.buf = new Float64Array(sz); this.mask = sz - 1; this.w = 0; this.ph = 0; this.mode = 0; this.hiss = 0;
    this.pre = new Biquad2(); this.pl = new Biquad2(); this.pr = new Biquad2();
    this.pre.set(9500, fs); this.pl.set(9000, fs); this.pr.set(9000, fs);
    this.r = 22222; this.g = 0; this.P = CHORUS_MODES[1]; this.ctr = 0; this.dep = 0;
    this.gk = 1 - Math.exp(-1 / (0.015 * fs)); this.sk = 1 - Math.exp(-1 / (0.03 * fs));
  }
  reset() {
    this.buf.fill(0); this.w = 0; this.ph = 0; this.g = 0; this.ctr = 0; this.dep = 0; this.r = 22222;
    resetSVF(this.pre); resetSVF(this.pl); resetSVF(this.pr);
  }
  snap() { // nothing sounding: take the new setting at once (no fade-in on the next note)
    if (this.mode) this.P = CHORUS_MODES[this.mode];
    if (this.mode && this.g === 0) { resetSVF(this.pl); resetSVF(this.pr); }
    this.g = this.mode ? 1 : 0; this.ctr = (this.P[1] + this.P[2]) * 0.5 * this.fs; this.dep = (this.P[2] - this.P[1]) * 0.5 * this.fs;
  }
  process(x, L, R, n) {
    const fs = this.fs, buf = this.buf, mask = this.mask, mode = this.mode, gt = mode ? 1 : 0;
    if (mode) this.P = CHORUS_MODES[mode];
    const P = this.P, rate = P[0] / fs, ctrT = (P[1] + P[2]) * 0.5 * fs, depT = (P[2] - P[1]) * 0.5 * fs;
    let w = this.w, ph = this.ph, g = this.g;
    if (g === 0 && !gt) { // bypassed: keep the line fed
      for (let i = 0; i < n; i++) { const v = this.pre.process(x[i]); buf[w & mask] = v * tr(v * 0.3); w++; }
      this.w = w & mask; return;
    }
    if (g === 0) { resetSVF(this.pl); resetSVF(this.pr); this.ctr = ctrT; this.dep = depT; }
    const hs = this.hiss * 2e-4, gk = this.gk, sk = this.sk;
    let ctr = this.ctr, dep = this.dep, r = this.r;
    for (let i = 0; i < n; i++) {
      const xi = x[i], v = this.pre.process(xi);
      buf[w & mask] = v * tr(v * 0.3);
      ph += rate; if (ph >= 1) ph -= 1;
      const tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      g += (gt - g) * gk; ctr += (ctrT - ctr) * sk; dep += (depT - dep) * sk; // mode changes slew the delay
      let nl = 0, nr = 0;
      if (hs) {
        r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0; nl = (r / 2147483648 - 1) * hs;
        r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0; nr = (r / 2147483648 - 1) * hs;
      }
      const a = hermite(buf, mask, w - ctr - dep * tri), b = hermite(buf, mask, w - ctr + dep * tri);
      L[i] += g * (0.72 * this.pl.process(a + nl) - 0.28 * xi);
      R[i] += g * (0.72 * this.pr.process(b + nr) - 0.28 * xi);
      w++;
    }
    if (!gt && g < 1e-5) g = 0;
    this.w = w & mask; this.ph = ph; this.g = g; this.ctr = ctr; this.dep = dep; this.r = r;
  }
}

// Solina-style 3-phase string ensemble
class Ensemble {
  constructor(fs) {
    this.fs = fs; let sz = 1; while (sz < fs * 0.04) sz <<= 1;
    this.buf = new Float64Array(sz); this.mask = sz - 1; this.w = 0; this.ps = 0; this.pf = 0; this.on = 0;
    this.pre = new Biquad2(); this.pl = new Biquad2(); this.pr = new Biquad2();
    this.pre.set(8000, fs); this.pl.set(7500, fs); this.pr.set(7500, fs);
    this.g = 0; this.gk = 1 - Math.exp(-1 / (0.015 * fs));
  }
  reset() { this.buf.fill(0); this.w = 0; this.ps = 0; this.pf = 0; this.g = 0; resetSVF(this.pre); resetSVF(this.pl); resetSVF(this.pr); }
  snap() { if (this.on && this.g === 0) { resetSVF(this.pl); resetSVF(this.pr); } this.g = this.on ? 1 : 0; }
  process(x, L, R, n) {
    const fs = this.fs, rs = 0.63 / fs, rf = 6.3 / fs, buf = this.buf, mask = this.mask, gt = this.on ? 1 : 0, gk = this.gk;
    let w = this.w, ps = this.ps, pf = this.pf, g = this.g;
    if (g === 0 && !gt) { // bypassed: keep the line fed
      for (let i = 0; i < n; i++) { buf[w & mask] = this.pre.process(x[i]); w++; }
      this.w = w & mask; return;
    }
    if (g === 0) { resetSVF(this.pl); resetSVF(this.pr); }
    const third = 1 / 3;
    for (let i = 0; i < n; i++) {
      const xi = x[i], v = this.pre.process(xi);
      buf[w & mask] = v;
      ps += rs; if (ps >= 1) ps -= 1; pf += rf; if (pf >= 1) pf -= 1;
      g += (gt - g) * gk;
      const t0 = hermite(buf, mask, w - (6.0e-3 + 1.9e-3 * sin1(ps) + 0.32e-3 * sin1(pf + 0.1)) * fs);
      const t1 = hermite(buf, mask, w - (6.0e-3 + 1.9e-3 * sin1(ps + third) + 0.32e-3 * sin1(pf + third + 0.1)) * fs);
      const t2 = hermite(buf, mask, w - (6.0e-3 + 1.9e-3 * sin1(ps + 2 * third) + 0.32e-3 * sin1(pf + 2 * third + 0.1)) * fs);
      L[i] += g * 0.85 * (this.pl.process(t0 + 0.6 * t1) - xi);
      R[i] += g * 0.85 * (this.pr.process(t2 + 0.6 * t1) - xi);
      w++;
    }
    if (!gt && g < 1e-5) g = 0;
    this.w = w & mask; this.ps = ps; this.pf = pf; this.g = g;
  }
}

// Stereo-linked look-ahead peak limiter: unity gain below the threshold (-1 dBFS), ~1 ms attack
// (min-hold + box-filtered gain, so the delayed peak is always caught), ~120 ms release.
class Limiter {
  constructor(fs) {
    const L = Math.max(4, Math.round(fs * 0.001));
    let sz = 1; while (sz < L + 2) sz <<= 1;
    this.L = L; this.mask = sz - 1; this.j = 0;
    this.xl = new Float64Array(sz); this.xr = new Float64Array(sz); this.gd = new Float64Array(sz).fill(1);
    this.ev = new Float64Array(sz).fill(1); this.q = new Int32Array(sz); this.qh = 0; this.qt = 0;
    this.env = 1; this.sum = L; this.thr = Math.pow(10, -1 / 20); this.rel = 1 - Math.exp(-1 / (0.12 * fs));
  }
  reset() { this.xl.fill(0); this.xr.fill(0); this.gd.fill(1); this.ev.fill(1); this.q.fill(0); this.qh = this.qt = this.j = 0; this.env = 1; this.sum = this.L; }
  process(A, B, n) {
    const L = this.L, m = this.mask, xl = this.xl, xr = this.xr, gd = this.gd, ev = this.ev, q = this.q, thr = this.thr, rel = this.rel, iL = 1 / L;
    let j = this.j, qh = this.qh, qt = this.qt, env = this.env, sum = this.sum;
    for (let i = 0; i < n; i++) {
      const a = A[i], b = B[i], aa = a < 0 ? -a : a, ab = b < 0 ? -b : b, pk = aa > ab ? aa : ab;
      const g = pk > thr ? thr / pk : 1;
      xl[j] = a; xr[j] = b; gd[j] = g;
      while (qt !== qh && gd[q[(qt - 1) & m]] >= g) qt = (qt - 1) & m; // monotonic queue: running minimum over L samples
      q[qt] = j; qt = (qt + 1) & m;
      while (((j - q[qh]) & m) >= L) qh = (qh + 1) & m;
      const wmin = gd[q[qh]];
      env += (1 - env) * rel; if (env > wmin) env = wmin;
      sum += env - ev[(j - L) & m]; ev[j] = env;
      const gs = sum * iL, o = (j - L + 1) & m;
      A[i] = xl[o] * gs; B[i] = xr[o] * gs;
      j = (j + 1) & m;
      if (j === 0) { sum = 0; for (let k = 1; k <= L; k++) sum += ev[(j - k) & m]; } // keep the running sum exact
    }
    this.j = j; this.qh = qh; this.qt = qt; this.env = env; this.sum = sum;
  }
}

/* ------------------------------------------------- patch normalisation */
// Patches arrive as structured clones whose numbers flip between small-integer and double representations
// from preset to preset; V8 then deprecates their hidden classes and the hot render paths can fall into a
// deopt loop. Every patch is copied into fixed-shape objects instead: every field always present (absent
// numbers 0, absent optional sections null), numeric fields stored as doubles from the first write.
const nz = (v) => (v === undefined || v === null ? 0 : +v);
const WARNED = Object.create(null);
function extra(dst, src, path) { // keys this table does not know are kept as they are (and reported once)
  for (const k in src) if (!(k in dst)) { dst[k] = src[k]; if (!WARNED[path + k]) { WARNED[path + k] = 1; console.warn('engine: unknown patch key ' + path + k); } }
  return dst;
}
class OscP {
  constructor(o) {
    this.on = this.lev = this.oct = this.fine = this.saw = this.pulse = this.tri = this.sine = 0.5;
    this.pw = this.pwLfo = this.pwEnv = this.kbd = this.envPitch = this.lfoPitch = this.wheelPitch = this.wheelPw = 0.5;
    this.on = nz(o.on); this.lev = nz(o.lev); this.oct = nz(o.oct); this.fine = nz(o.fine); this.saw = nz(o.saw); this.pulse = nz(o.pulse);
    this.tri = nz(o.tri); this.sine = nz(o.sine); this.pw = nz(o.pw); this.pwLfo = nz(o.pwLfo); this.pwEnv = nz(o.pwEnv); this.kbd = nz(o.kbd);
    this.envPitch = nz(o.envPitch); this.lfoPitch = nz(o.lfoPitch); this.wheelPitch = nz(o.wheelPitch); this.wheelPw = nz(o.wheelPw);
    extra(this, o, 'osc.');
  }
}
class HpfP {
  constructor(o) {
    this.type = o.type === undefined ? 'none' : String(o.type);
    this.oct = this.res = this.env = this.kbd = this.lfo = this.clip = 0.5;
    this.oct = nz(o.oct); this.res = nz(o.res); this.env = nz(o.env); this.kbd = nz(o.kbd); this.lfo = nz(o.lfo); this.clip = nz(o.clip);
    extra(this, o, 'hpf.');
  }
}
class VcfP {
  constructor(o) {
    this.type = o.type === undefined ? 'moog' : String(o.type);
    this.oct = this.res = this.env = this.envOff = this.kbd = this.lfo = this.vel = this.drive = 0.5;
    this.comp = this.fbSat = this.poles = this.mode = this.at = this.sat = this.clip = this.morph = 0.5;
    this.oct = nz(o.oct); this.res = nz(o.res); this.env = nz(o.env); this.envOff = nz(o.envOff); this.kbd = nz(o.kbd); this.lfo = nz(o.lfo);
    this.vel = nz(o.vel); this.drive = nz(o.drive); this.comp = nz(o.comp); this.fbSat = nz(o.fbSat); this.poles = nz(o.poles); this.mode = nz(o.mode);
    this.at = nz(o.at); this.sat = nz(o.sat); this.clip = nz(o.clip); this.morph = nz(o.morph);
    extra(this, o, 'vcf.');
  }
}
class EnvP {
  constructor(o) {
    this.a = this.d = this.s = this.r = 0.5;
    this.a = nz(o.a); this.d = nz(o.d); this.s = nz(o.s); this.r = nz(o.r); extra(this, o, 'env.');
  }
}
class LfoP {
  constructor(o) {
    this.rate = this.wave = this.delay = this.pitch = this.amp = this.wheelPitch = this.wheelFilter = 0.5;
    this.rate = nz(o.rate); this.wave = nz(o.wave); this.delay = nz(o.delay); this.pitch = nz(o.pitch); this.amp = nz(o.amp);
    this.wheelPitch = nz(o.wheelPitch); this.wheelFilter = nz(o.wheelFilter);
    extra(this, o, 'lfo.');
  }
}
class FxP {
  constructor(o) {
    this.chorus = this.ensemble = this.hiss = 0.5;
    this.chorus = nz(o.chorus); this.ensemble = nz(o.ensemble); this.hiss = nz(o.hiss); extra(this, o, 'fx.');
  }
}
class DualP {
  constructor(o) {
    this.oct = this.res = this.hoct = this.hres = 0.5;
    this.oct = nz(o.oct); this.res = nz(o.res); this.hoct = nz(o.hoct); this.hres = nz(o.hres); extra(this, o, 'dual.');
  }
}
class Mod3P {
  constructor(o) {
    this.mix = this.osc = this.filt = 0.5;
    this.mix = nz(o.mix); this.osc = nz(o.osc); this.filt = nz(o.filt); extra(this, o, 'mod3.');
  }
}
class TbP {
  constructor(o) {
    this.accent = this.latch = this.chg = this.dis = 0.5;
    this.accent = nz(o.accent); this.latch = nz(o.latch); this.chg = nz(o.chg); this.dis = nz(o.dis); extra(this, o, 'tb.');
  }
}
class RmP {
  constructor(o) {
    this.rate = this.depth = 0.5;
    this.rate = nz(o.rate); this.depth = nz(o.depth); extra(this, o, 'rm.');
  }
}
class IlP {
  constructor(o) {
    this.il = this.al = 0.5;
    this.il = nz(o.il); this.al = nz(o.al); extra(this, o, 'fenvIL.');
  }
}
class RegP {
  constructor(o) {
    this.bass = this.cello = this.viola = this.violin = this.trumpet = this.horn = 0.5;
    this.bass = nz(o.bass); this.cello = nz(o.cello); this.viola = nz(o.viola); this.violin = nz(o.violin); this.trumpet = nz(o.trumpet); this.horn = nz(o.horn);
    extra(this, o, 'reg.');
  }
}
const f64 = (a, n) => { const r = new Float64Array(n); if (a) for (let i = 0; i < n && i < a.length; i++) r[i] = nz(a[i]); return r; };
class OpP {
  constructor(o) {
    this.ratio = this.det = this.fixed = this.hz = this.out = this.vel = this.rs = 0.5;
    this.ratio = nz(o.ratio); this.det = nz(o.det); this.fixed = nz(o.fixed); this.hz = nz(o.hz); this.out = nz(o.out); this.vel = nz(o.vel); this.rs = nz(o.rs);
    this.R = f64(o.R, 4); this.L = f64(o.L, 4);
    extra(this, o, 'ops.');
  }
}
const EMPTY = {};
class PatchP {
  constructor(o) {
    this.engine = o.engine === undefined ? 'analog' : String(o.engine); this.mode = o.mode === undefined ? 'poly' : String(o.mode);
    this.prio = o.prio === undefined ? 'last' : String(o.prio); this.legato = !!o.legato; this.glideLegato = !!o.glideLegato;
    this.poly = this.glide = this.unison = this.unisonDetune = this.bendRange = this.drift = this.envOv = this.sawBow = this.bw = this.level = 0.5;
    this.sub = this.noise = this.pink = this.ring = this.ext = this.sync = this.fm01 = this.fm10 = this.polyOscPw = this.polyOscFilt = 0.5;
    this.velAmp = this.atPitch = this.dac = this.attack = this.release = this.tone = this.alg = this.fb = this.transpose = 0.5;
    this.poly = nz(o.poly); this.glide = nz(o.glide); this.unison = nz(o.unison); this.unisonDetune = nz(o.unisonDetune); this.bendRange = nz(o.bendRange);
    this.drift = nz(o.drift); this.envOv = nz(o.envOv); this.sawBow = nz(o.sawBow); this.bw = nz(o.bw); this.level = nz(o.level);
    this.sub = nz(o.sub); this.noise = nz(o.noise); this.pink = nz(o.pink); this.ring = nz(o.ring); this.ext = nz(o.ext); this.sync = nz(o.sync);
    this.fm01 = nz(o.fm01); this.fm10 = nz(o.fm10); this.polyOscPw = nz(o.polyOscPw); this.polyOscFilt = nz(o.polyOscFilt);
    this.velAmp = nz(o.velAmp); this.atPitch = nz(o.atPitch); this.dac = nz(o.dac); this.attack = nz(o.attack); this.release = nz(o.release);
    this.tone = nz(o.tone); this.alg = nz(o.alg); this.fb = nz(o.fb); this.transpose = nz(o.transpose);
    // Serum voices and the FX rack (every model): consumed only through SerumVoice.apply / FXRack.set, which copy the
    // scalars into fixed-shape fields. serumT / fxrT are absent from live patches whose curve tables did not change.
    this.bpm = this.osCap = 0.5;
    this.bpm = nz(o.bpm); this.osCap = nz(o.osCap);
    this.serum = o.serum || null; this.serumT = o.serumT || null; this.fxr = o.fxr || null; this.fxrT = o.fxrT || null;
    this.needs = o.needs || null;
    const os = o.osc || [];
    this.osc = [new OscP(os[0] || EMPTY), new OscP(os[1] || EMPTY), new OscP(os[2] || EMPTY)];
    this.hpf = new HpfP(o.hpf || EMPTY); this.vcf = new VcfP(o.vcf || EMPTY);
    this.fenv = new EnvP(o.fenv || EMPTY); this.aenv = new EnvP(o.aenv || EMPTY); this.lfo = new LfoP(o.lfo || EMPTY); this.fx = new FxP(o.fx || EMPTY);
    this.reg = new RegP(o.reg || EMPTY);
    this.dual = o.dual ? new DualP(o.dual) : null; this.mod3 = o.mod3 ? new Mod3P(o.mod3) : null; this.tb = o.tb ? new TbP(o.tb) : null;
    this.rm = o.rm ? new RmP(o.rm) : null; this.fenvIL = o.fenvIL ? new IlP(o.fenvIL) : null;
    this.ops = o.ops ? o.ops.map(x => new OpP(x || EMPTY)) : null;
    extra(this, o, '');
  }
}
const normPatch = (o) => (o instanceof PatchP ? o : new PatchP(o || EMPTY));

/* -------------------------------------------------------------- engine */
const DEFAULT_PATCH = normPatch({
  engine: 'analog', mode: 'poly', poly: 8, prio: 'last', legato: true, glide: 0, glideLegato: false,
  unison: 1, unisonDetune: 0, bendRange: 2, drift: 0.5, envOv: 1.3, sawBow: 0, bw: 24000, level: 0.4,
  osc: [0, 1, 2].map(i => ({ on: i === 0 ? 1 : 0, lev: 1, oct: 0, fine: 0, saw: 1, pulse: 0, tri: 0, sine: 0, pw: 0.5, pwLfo: 0, pwEnv: 0, kbd: 1, envPitch: 0, lfoPitch: 0 })),
  sub: 0, noise: 0, pink: 0, ring: 0, ext: 0, sync: 0, fm01: 0, fm10: 0, polyOscPw: 0, polyOscFilt: 0,
  hpf: { type: 'none', oct: 4.3, res: 0 }, vcf: { type: 'moog', oct: 11, res: 0.2, env: 2, envOff: 0, kbd: 0.5, lfo: 0, vel: 0, drive: 1 },
  dual: null, mod3: null, tb: null, velAmp: 0,
  fenv: { a: 0.01, d: 0.4, s: 0.4, r: 0.3 }, aenv: { a: 0.005, d: 0.3, s: 1, r: 0.3 },
  lfo: { rate: 5, wave: 0, delay: 0, pitch: 0, amp: 0, wheelPitch: 0.6, wheelFilter: 0 },
  fx: { chorus: 0, ensemble: 0, hiss: 0 }, dac: 0,
});

// JIT warm-up material: one patch per engine path (voice kind, filter / HP type, sync + audio-rate PWM, FM with and
// without the DAC, divide-down, chorus / ensemble), rendered once per AudioWorkletGlobalScope (see warmUp). Values
// are deliberately non-integer: integer-valued doubles would leave small-integer type feedback behind.
const WO = (o) => Object.assign({ on: 1, lev: 0.83, saw: 1, pw: 0.47, kbd: 1, fine: 3.3 }, o), WOFF = { on: 0, lev: 0, saw: 0 };
const WENV = { a: 0.0031, d: 0.21, s: 0.63, r: 0.047 };
const WARM = [
  { mode: 'unison', unison: 2, unisonDetune: 7.3, glide: 0.051, osc: [WO({}), WO({ saw: 0, tri: 1, oct: 7.03 }), WO({ pulse: 1, pw: 0.31, lev: 0.53 })],
    noise: 0.31, pink: 1, sub: 0.33, ext: 0.53, mod3: { mix: 0.33, osc: 1, filt: 1 }, vcf: { type: 'moog', oct: 11.13, res: 0.97, env: 3.1, kbd: 0.97, drive: 0.81 },
    hpf: { type: '4p', oct: 6.17 } },
  { osc: [WO({ pulse: 1 }), WO({ pulse: 1, tri: 0.5, sine: 0.5, fine: 703 }), WO(WOFF)], sync: 1, polyOscPw: 0.31, polyOscFilt: 1.1,
    fm01: 0.53, fm10: 0.21, ring: 0.31,
    vcf: { type: 'ota', oct: 12.1, res: 0.83, env: 3.1, comp: 0.25, fbSat: 0.35, vel: 0.7 }, hpf: { type: '1p', oct: 7.13 }, fx: { chorus: 2, hiss: 1 } },
  { osc: [WO({ tri: 1, sine: 1 }), WO({ saw: 0, pulse: 1, envPitch: 2.1, pwEnv: 0.13 }), WO({ saw: 0, tri: 1, sine: 1, lev: 0.4 })], polyOscPw: 0.23, glide: 0.031,
    vcf: { type: 'ota', oct: 11.3, res: 0.53, comp: 0.15, fbSat: 0.5, poles: 2, lfo: 0.7 }, hpf: { type: '1p', oct: 6.3 } },
  { mode: 'mono', osc: [WO({}), WO(WOFF), WO(WOFF)], vcf: { type: 'diode', oct: 10.3, res: 0.93, env: 4.1, drive: 1.2 }, tb: { accent: 0.8, chg: 0.1, dis: 0.01 } },
  { osc: [WO({}), WO({ saw: 0, pulse: 1 }), WO(WOFF)], ring: 0.31, vcf: { type: 'sk', oct: 11.3, res: 0.93, env: 3.1, kbd: 0.3, clip: 1.4 },
    hpf: { type: 'sk', oct: 7.3, res: 0.53, env: 1.1, clip: 1.4 } },
  { osc: [WO({}), WO({ saw: 0, pulse: 1, sine: 0.5 }), WO(WOFF)], vcf: { type: 'svf', mode: 0, sat: 0.7, oct: 11.3, res: 0.53, kbd: 0.5, drive: 0.8, at: 0.3 },
    hpf: { type: 'svf', oct: 7.3, res: 0.31 }, dual: { oct: 11.53, res: 0.43, hoct: 7.1, hres: 0.21 }, fenvIL: { il: 1.1, al: 2.1 },
    rm: { rate: 301.3, depth: 0.53 }, fx: { ensemble: 1 } },
  { osc: [WO({}), WO({ fine: 5.3 }), WO(WOFF)], vcf: { type: 'svf', mode: 0, sat: 0.9, oct: 11.3, res: 0.63 } },
  { osc: [WO({}), WO({ fine: 5.3 }), WO(WOFF)], vcf: { type: 'svf', mode: 2, morph: 0.53, oct: 11.3, res: 0.63 }, hpf: { type: 'none' } },
].map(o => Object.assign({ engine: 'analog', mode: 'poly', poly: 4, level: 0.31, drift: 0.53, sawBow: 0.03, velAmp: 0.3, fenv: WENV, aenv: WENV,
  lfo: { rate: 5.3, wave: 1, pitch: 0.11, amp: 0.11, wheelPitch: 0.53, delay: 0.21 } }, o)).concat([1, 0].map(dac => ({
  engine: 'fm', mode: 'poly', poly: 4, level: 0.31, alg: dac ? 5 : 32, fb: 6, dac, transpose: 0.5, lfo: { rate: 5.3, pitch: 0.053, wheelPitch: 0.53 },
  ops: [1, 2, 3, 4, 5, 6].map(k => ({ ratio: k + 0.01, det: 1.001, out: 90, R: [90, 60, 50, 60], L: [99, 85, 70, 0], vel: 2.1, rs: 2.1 })) })), [{
  engine: 'divide', level: 0.31, attack: 0.011, release: 0.051, tone: 0.53, fx: { ensemble: 1 },
  reg: { bass: 1, cello: 0.9, viola: 0.8, violin: 1, trumpet: 0.7, horn: 0.6 } }]);
let warmed = false;
let sxHot = false; // a Serum processor of this scope has rendered its real patch (no first-use warm-up needed any more)

// Serum (serum-dsp.js) and the FX rack (fx-dsp.js) are separate classic scripts loaded before this one; either may be
// missing (failed load): a Serum track is then silent, a missing rack is bypassed. Both are looked up at use.
const SXV = 32;                                                              // Serum voices at most (built as POLY needs them, §11.3)
const osCapOf = base => Math.max(1, 2 ** Math.floor(Math.log2(384000 / base + 1e-9))); // internal rate ≤ 384 kHz
function decChain(os) { // cascaded half-band decimators for one channel: os → 1
  const d = [];
  let s = os;
  while (s > 1) { d.push(s === 2 ? new Halfband(127, 10) : new Halfband(35, 9)); s >>= 1; }
  return d;
}

class SynthProcessor extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const po = (opt && opt.processorOptions) || {};
    this.hostOS = po.hostOS || po.os || 4; // the app's oversampling (a Serum track runs at its own, §11.4)
    this.offline = !!po.offline;           // a bounce / resample: no deadline, so no JIT warm-ups
    this.init(po.os || 4);
    // the first processor in this global scope warms the JIT up before anything is heard (once, never again)
    if (!warmed && !this.offline) { warmed = true; try { this.warmUp(); } catch (err) { /* a failed warm-up only costs speed */ } this.restore(po.os || 4); }
    // wavetables of an offline render (bounce, resample): given to the first node of the context only, the table
    // store is shared by every processor of the global scope (§7.5)
    const SD = globalThis.SerumDSP;
    if (SD && Array.isArray(po.wts)) for (const e of po.wts) if (e && e.id) SD.storeWT(e.id, e);
    if (po.patch) this.setPatch(po.patch);
    if (po.seq) this.seqMsg(po.seq);
    if (po.song) this.songMsg(po.song);
    if (po.transport) this.transportMsg(po.transport);
    this.port.onmessage = (ev) => this.msg(ev.data);
  }
  // Renders every engine path through attack, sustain and release, so a model's first notes do not run in the
  // interpreter while the JIT catches up (single quanta used to reach 1.5-2x the budget). Two rounds: the first
  // collects type feedback for every branch, the second leaves code optimised with all of it.
  warmUp() {
    const io = [[new Float32Array(128), new Float32Array(128)]], run = (k) => { for (let b = 0; b < k; b++) { this.process(null, io); this.statN = 0; } };
    for (let round = 0; round < 2; round++) {
      for (const w of WARM) {
        this.setPatch(w);
        this.noteOn(48, 0.9); this.noteOn(67, 0.6);
        run(30);
        if (round === 0) this.reqOS(this.OS === 4 ? 2 : 4);
        this.noteOff(48); this.noteOff(67);
        run(10);
        this.osPend = 0; this.osR = 1; this.osHold = 0;
      }
    }
    // Serum voices (every warp / filter family / LFO mode, §8.4.2) and every FX rack module and mode (§8.5.2)
    const SD = globalThis.SerumDSP;
    if (SD) SD.warmUp(this);
    if (this.rack) this.rack.warmUp();
  }
  // back to the freshly built state after the warm-up, resetting in place (fields that never change in normal use
  // are not reassigned, so the code compiled during the warm-up stays valid)
  restore(os) {
    this.kind = ''; this.voices = null; this.div = null;
    this.bend = this.bendRaw = this.wheel = this.at = 0; this.sustain = false; this.held = []; this.stamp = 0; this.monoGate = false;
    this.lfoPh = this.lfoSH = this.lfoLast = this.gdrift = 0; this.r = 987654321; this.loadT = 0; this.statN = 0; this.ctl = 0; this.act = 0;
    this.chorus.reset(); this.ens.reset(); this.lim.reset(); this.dcx.fill(0); this.dcy.fill(0);
    const SD = globalThis.SerumDSP;
    if (SD && this.sx) SD.reset(this);
    if (this.rack) this.rack.reset();
    this.ct = null; this.pat.fill(0); this.patSeen = false; this.mon = false; this.monF = 0; this.spanF = 0;
    this.pnN = 0; this.nfG = 1; this.nfT = 1; this.sxW = 0;
    this.setOS(os);
    this.dacHold = this.dacT = this.dacPend = 0; this.osPend = 0; this.osR = 1; this.osHold = 0; this.quietF = 0; this.frames = 0;
    this.setPatch(DEFAULT_PATCH);
  }
  init(os) {
    this.voices = null; this.div = null; this.sq = null; this.songCtl = false;
    this.base = sampleRate;
    this.p = DEFAULT_PATCH;
    this.bend = 0; this.bendRaw = 0; this.wheel = 0; this.at = 0; this.sustain = false;
    this.held = []; this.stamp = 0; this.monoGate = false;
    this.lfoPh = 0; this.lfoSH = 0; this.lfoLast = 0; this.gdrift = 0; this.r = 987654321;
    this.load = 0; this.loadT = 0; this.statN = 0; this.ctl = 0;
    this.smT = new Float64Array(S_N); this.smS = new Float64Array(S_N); this.smA = new Float64Array(S_N);
    this.smB = new Float64Array(S_N); this.smD = new Float64Array(S_N); this.smMv = false;
    // Serum host fields (§8.4.1, §11.2): sx belongs to SerumDSP (attach), ct = last curve tables, pat = poly pressure
    this.sx = null; this.ct = null; this.pat = new Float64Array(128); this.patSeen = false; this.spanF = 0;
    this.sxUse = 1; this.sxOne = 1; this.sxDir = 0; this.sxDirOn = 0; this.sxW = 0;
    this.mon = false; this.monF = 0; // snapshot / FX monitor subscription (smon)
    this.pnN = 0; this.pnM = Math.max(1, Math.round(this.base * 0.005)); // panic: frames left of the output fade, its length
    this.nfG = 1; this.nfT = 1; // Serum without the FX rack: master × bypass gain (now, target)
    this.setOS(os);
    this.chorus = new Chorus(this.base); this.ens = new Ensemble(this.base); this.lim = new Limiter(this.base);
    this.dcx = new Float64Array(2); this.dcy = new Float64Array(2); // (typed: the field keeps one type in every processor)
    this.monoBuf = new Float64Array(128); this.Lb = new Float64Array(128); this.Rb = new Float64Array(128); this.act = 0;
    this.dLb = new Float64Array(128); this.dRb = new Float64Array(128); this.osG = new Float64Array(128);
    // the FX rack of this track (any model): after the built-in chorus / ensemble, before the limiter (§1, §11.5)
    const FX = globalThis.FXDSP;
    this.rack = null;
    if (FX) { try { this.rack = new FX.FXRack(this.base); } catch (err) { this.rack = null; } }
    this.dacHold = 0; this.dacT = 0; this.dacPend = 0;
    this.osPend = 0; this.osR = 1; this.osHold = 0; // pending oversampling change: fade ramp, frames held at zero
    this.kind = '';
    this.setPatch(DEFAULT_PATCH);
    // song playback / transport (scheduled against currentFrame so every track node stays in sync)
    this.sn = []; this.sc = []; this.ni = 0; this.ci = 0; this.seqOn = []; this.reseek = true; this.frames = 0; this.quietF = 0;
    this.tp = { play: false, frame: 0, tick: 0, fpt: 1, loop: false, ls: 0, le: 0, wrap: false, pend: null };
  }
  rnd() { let x = this.r; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.r = x >>> 0; return this.r / 2147483648 - 1; }
  setOS(os) {
    this.OS = os; this.fs = this.base * os; this.CH = 4 * os;
    this.buf = new Float64Array(128 * os);
    this.tmp = [new Float64Array(64 * os), new Float64Array(32 * os), new Float64Array(16 * os)];
    this.dec = decChain(os);
    // Serum: stereo main bus (buf = L) and the direct-out pair, each decimated by its own chain (§0.3-2, §11.2)
    this.bufR = new Float64Array(128 * os); this.bufDL = new Float64Array(128 * os); this.bufDR = new Float64Array(128 * os);
    this.decR = decChain(os); this.decDL = decChain(os); this.decDR = decChain(os);
    this.bufM = new Float64Array(128 * os); // mono scratch (a DX7 Vintage-DAC fade draining under a Serum patch)
    this.lfoBuf = new Float64Array(32);
    this.fcMax = Math.min(40000, this.fs * 0.45);
    const cr = this.fs / this.CH;
    this.ouB = 1 - Math.exp(-TAU * 0.35 / cr);
    this.ouN = 1 / Math.sqrt(this.ouB / 6);
    this.gouB = 1 - Math.exp(-TAU * 0.05 / (this.base / 128));
    this.ampK = 1 - Math.exp(-this.CH / (0.002 * this.fs)); // VCA gain slew (2 ms, per control chunk)
    this.fbHPc = 1 - Math.exp(-TAU * 10 / this.fs);          // AC coupling of the external-input feedback
    // noise: constant in-band density at any rate (white voiced at 48 kHz x4); pink poles at fixed corners
    this.nzW = Math.sqrt(this.fs / 192000); this.pkS = Math.sqrt(this.fs / 44100);
    // white noise as a modulation source (exponential, so its spread matters as well as its density): above the
    // 192 kHz reference it is clocked at that rate (same spread and spectrum), below it keeps the in-band density
    this.nzMR = Math.min(1, 192000 / this.fs); this.nzMW = Math.min(1, this.nzW);
    this.pkP = PINK_F.map(f => Math.exp(-TAU * f / this.fs));
    this.pkB = this.pkP.map((q, i) => PINK_B[i] * (1 - q) / (1 - PINK_P[i]));
    // de-click fade (~3 ms) rendered ahead when voices are stopped hard
    this.fadeN = Math.max(1, Math.round(this.base * 0.003 / 4)) * 4 * os;
    this.tail = new Float64Array(this.fadeN); this.fadeTmp = new Float64Array(this.fadeN); this.tailN = 0; this.tailP = 0;
    // Serum voices stopped hard fade out in stereo (plus their direct-out pair)
    this.tailL = new Float64Array(this.fadeN); this.tailR = new Float64Array(this.fadeN);
    this.tailDL = new Float64Array(this.fadeN); this.tailDR = new Float64Array(this.fadeN); this.tailSN = 0; this.tailSP = 0;
    // DX7 Vintage DAC: instants and samples of the 49.096 kHz stream inside one span, per-chunk counts; the fade of
    // voices stopped hard on that path is kept per DAC instant (tailD) and goes out through the stream
    const dM = Math.ceil(128 * os / 1.5) + 8, fM = Math.ceil(this.fadeN / 1.5) + 8;
    this.dacTau = new Float64Array(dM); this.dacBuf = new Float64Array(dM); this.dacCnt = new Int32Array(33);
    this.tailD = new Float64Array(fM); this.fadeTau = new Float64Array(fM); this.fadeCnt = new Int32Array(this.fadeN / this.CH + 1);
    this.tailDN = 0; this.tailDP = 0; this.dacT = 0; this.dacHold = 0; this.dacPend = 0; this.dacLive = false;
    if (this.voices) { this.recalc(); for (const v of this.voices) v.apply(this.p); }
  }
  recalc() {
    const p = this.p;
    this.bwc = 1 - Math.exp(-TAU * Math.min(p.bw || 24000, this.fs * 0.45) / this.fs);
  }
  /* ---- parameter smoothing ---- */
  smTargets() {
    const p = this.p, t = this.smT;
    t[S_LEV] = p.level || 0; t[S_BEND] = this.bend; t[S_WHEEL] = this.wheel; t[S_AT] = this.at;
    if (p.engine !== 'analog') return;
    const v = p.vcf, h = p.hpf, d = p.dual;
    t[S_VO] = v.oct; t[S_VE] = v.envOff || 0; t[S_VN] = v.env || 0; t[S_VR] = v.res || 0; t[S_DRV] = v.drive || 1;
    t[S_HO] = h.oct; t[S_HR] = h.res || 0;
    if (d) { t[S_DO] = d.oct; t[S_DR] = d.res || 0; t[S_DH] = d.hoct || 0; t[S_DHR] = d.hres || 0; }
    for (let k = 0; k < 3; k++) {
      const o = p.osc[k], tu = (o.oct || 0) + (o.fine || 0) * 0.01, i = S_TU + k;
      t[S_OL + k] = o.on ? o.lev || 0 : 0; t[S_PW + k] = o.pw || 0.5; t[i] = tu;
      if (Math.abs(tu - this.smB[i]) >= 5) this.smS[i] = this.smB[i] = tu; // range / footage switches step, knobs glide
    }
    t[S_SUB] = p.sub || 0; t[S_NZ] = p.noise || 0; t[S_RING] = p.ring || 0; t[S_EXT] = p.ext || 0; t[S_RM] = p.rm ? p.rm.depth : 0;
  }
  smSnap() {
    const t = this.smT;
    this.smS.set(t); this.smA.set(t); this.smB.set(t); this.smD.fill(0); this.smMv = false;
  }
  smStep(n) { // two cascaded one-poles: ~6 ms each for panel values, ~1.5 ms for bend / wheel / aftertouch
    const t = this.smT, s = this.smS, a = this.smA, b = this.smB, d = this.smD;
    t[S_BEND] = this.bend; t[S_WHEEL] = this.wheel; t[S_AT] = this.at;
    const kS = 1 - Math.exp(-n / (this.base * 0.006)), kF = 1 - Math.exp(-n / (this.base * 0.0015));
    let mv = false;
    for (let i = 0; i < S_N; i++) {
      a[i] = b[i];
      const ti = t[i];
      if (b[i] === ti && s[i] === ti) { d[i] = 0; continue; }
      const k = i >= S_BEND ? kF : kS;
      s[i] += (ti - s[i]) * k; b[i] += (s[i] - b[i]) * k;
      if (Math.abs(ti - b[i]) < 1e-6 * (1 + Math.abs(ti))) s[i] = b[i] = ti;
      d[i] = b[i] - a[i];
      if (d[i] !== 0) mv = true;
    }
    this.smMv = mv;
  }
  anyActive() {
    if (this.kind === 'divide') return !!(this.div && this.div.list.length);
    for (const v of this.voices) if (v.active) return true;
    return false;
  }
  setPatch(p) {
    p = normPatch(p);
    const old = this.p, kind = p.engine, was = this.kind;
    if (p.serumT) this.ct = p.serumT; // a live patch without serumT keeps the stored curve tables (§4.1)
    if (kind === 'serum') { this.setSerum(p, old); return; }
    const nv = kind === 'divide' ? 0 : p.mode === 'poly' ? p.poly : Math.max(1, p.unison || 1);
    const rebuild = kind !== this.kind || !this.voices || this.voices.length !== nv || old.mode !== p.mode;
    let keep = null;
    if (rebuild) {
      // keys still physically held survive a voice-assignment change (poly <-> unison / mono)
      if (this.voices && kind === this.kind) {
        if (old.mode !== 'poly') { const v0 = this.voices[0]; keep = this.held.map(n => [n, v0 ? v0.vel : 0.8]); }
        else keep = this.voices.filter(x => x.gate && !x.sus).sort((x, y) => x.stamp - y.stamp).map(x => [x.note, x.vel]);
      }
      this.allOff(true); // fades out with the old patch before anything is torn down
      this.p = p;
      this.kind = kind;
      this.voices = [];
      for (let i = 0; i < nv; i++) this.voices.push(kind === 'fm' ? new FVoice(this, i) : new AVoice(this, i));
      if (kind === 'divide' && !this.div) this.div = new Divide(this);
      this.held = []; this.monoGate = false;
    } else this.p = p;
    const n = this.voices.length;
    for (let i = 0; i < n; i++) this.voices[i].det = p.mode === 'unison' && n > 1 ? (i / (n - 1) - 0.5) * 2 * p.unisonDetune / 100 : 0;
    // a new unison spread reaches notes that are already sounding (pitch and target move together: no glide)
    for (const v of this.voices) if (v.note >= 0) { const nt = v.note + (v.det || 0); v.pitch += nt - v.target; v.target = nt; }
    this.recalc();
    for (const v of this.voices) v.apply(p);
    // back from Serum, which does not feed the chorus / ensemble lines: they hold the model played before it, so they
    // start empty instead of replaying that audio
    if (was === 'serum') { this.chorus.reset(); this.ens.reset(); }
    this.chorus.mode = p.fx.ensemble ? 0 : p.fx.chorus | 0; this.chorus.hiss = p.fx.hiss || 0;
    this.ens.on = p.fx.ensemble | 0;
    this.bend = this.bendRaw * (p.bendRange || 2);
    this.smTargets();
    if (rebuild || !this.anyActive()) this.smSnap();
    if (!this.tailN && !this.tailDN && !this.anyActive()) { this.chorus.snap(); this.ens.snap(); }
    if (this.rack) this.rack.set(p.fxr || null, p.fxrT);
    if (was === 'serum') { // left Serum: no FX modulation, no curve tables, back to the app's oversampling
      if (this.sxW) { const SD = globalThis.SerumDSP; if (SD) SD.warmEnd(this); this.sxW = 0; }
      if (this.rack) this.rack.setMods(null);
      this.ct = null;
      this.reqOS(this.hostOS);
    }
    if (keep) for (const [kn, kv] of keep) this.noteOn(kn, kv);
  }
  // Serum patch (§11.3): 32 voices built once on the kind change and never rebuilt (POLY and mono / poly changes
  // only change which voices are addressed); the processor runs at Serum's own oversampling (§11.4)
  setSerum(p, old) {
    const SD = globalThis.SerumDSP, cp = p.serum;
    let keep = null;
    if (this.kind !== 'serum' || !this.voices) {
      this.allOff(true); // fades out with the old patch before anything is torn down
      this.p = p;
      this.kind = 'serum';
      this.voices = [];
      if (SD) { // per-processor Serum state (idempotent); the voices follow below; no SerumDSP: a silent track
        SD.attach(this);
        this.sx.mon = this.mon ? 1 : 0;
        // the first Serum patch of this scope: hidden voices warm the code up on it while the track is silent
        if (!sxHot && !this.offline && SD.warmStart) { SD.warmStart(this); this.sxW = 1; }
      }
      this.held = []; this.monoGate = false;
      this.chorus.mode = 0; this.ens.on = 0;
    } else {
      if ((old.mode === 'poly') !== (p.mode === 'poly')) { // mono <-> poly: keys still physically held are re-struck
        if (old.mode !== 'poly') { const v0 = this.voices[0]; keep = this.held.map(n => [n, v0 ? v0.vel : 0.8]); }
        else keep = this.voices.filter(x => x.gate && !x.sus).sort((x, y) => x.stamp - y.stamp).map(x => [x.note, x.vel]);
        this.allOff(false);
        this.held = []; this.monoGate = false;
      }
      this.p = p;
    }
    const vs = this.voices, nUse = p.mode === 'poly' ? Math.max(1, Math.min(SXV, Math.round(p.poly) || 1)) : 1;
    if (nUse < this.sxUse) for (let i = nUse; i < vs.length; i++) if (vs[i].gate) { vs[i].sus = false; vs[i].noteOff(); }
    this.sxUse = nUse;
    this.sxOne = cp && cp.oneNote ? 1 : 0;
    this.sxDir = cp && cp.direct ? 1 : 0;
    // voices are built up to the highest POLY so far (at most SXV) and never rebuilt; building all 32 at once cost up
    // to 1.5 ms of the shared audio thread. Voices above POLY are spare: never addressed, no filter delay lines.
    if (SD) while (vs.length < nUse) vs.push(new SD.SerumVoice(this, vs.length));
    for (let i = 0; i < vs.length; i++) { vs[i].spare = i >= nUse ? 1 : 0; vs[i].apply(p); }
    if (this.rack) this.rack.set(p.fxr || null, p.fxrT);
    // master volume (g.master, pow3 law) and Bypass belong to the rack's output stage (deviation 3); without fx-dsp the
    // engine applies their base values itself
    const fb = p.fxr && p.fxr.base, mn = fb && fb.length > 86 ? +fb[0] : 1, by = fb && fb.length > 86 ? +fb[86] : 0;
    this.nfT = by >= 0.5 ? 0 : mn > 0 ? (mn < 1 ? mn * mn * mn : 1) : 0;
    if (!this.tailN && !this.tailSN && !this.tailDN && !this.anyActive()) this.nfG = this.nfT; // silent: no ramp needed
    this.bend = this.bendRaw * (p.bendRange || 2);
    this.smTargets();
    const os = this.sxOS(p);
    if (os !== this.OS || this.osPend) this.reqOS(os);
    if (keep) for (const [kn, kv] of keep) this.noteOn(kn, kv);
  }
  // Serum's processor oversampling (lead sign-off on deviation 9): min(Global quality, 384 kHz cap, the app's CPU cap)
  sxOS(p) {
    const cp = p.serum;
    let os = cp && cp.os >= 1 ? +cp.os : 2;
    const cap = osCapOf(this.base);
    if (os > cap) os = cap;
    if (p.osCap >= 1 && os > p.osCap) os = p.osCap;
    return 2 ** Math.floor(Math.log2(os) + 1e-9);
  }
  reqOS(v) { // while anything sounds the change waits behind a short fade (see osFade)
    if (v === this.OS) this.osPend = 0;
    else if (this.tailN || this.tailDN || this.tailSN || this.anyActive()) this.osPend = v;
    else { this.osPend = 0; this.setOS(v); }
  }
  // render what is still sounding ~3 ms ahead with a raised-cosine fade; it is mixed into the next spans
  fadeOut(vs) {
    const list = vs || this.voices || [];
    if (this.kind === 'serum') { this.fadeSerum(list); return; }
    let any = false;
    for (const v of list) if (v.active) { any = true; break; }
    const dv = !vs && this.kind === 'divide' && this.div && this.div.list.length > 0;
    if (!any && !dv) return;
    const M = this.fadeN, CH = this.CH, nCh = M / CH, tmp = this.fadeTmp, per = this.fs / 49096;
    if (this.lfoBuf.length < nCh) this.lfoBuf = new Float64Array(nCh);
    this.lfoBuf.fill(this.lfoLast, 0, nCh);
    this.smA.set(this.smB); this.smD.fill(0);
    if (this.p.dac !== 0 && this.kind === 'fm' && per >= 1.5) {
      // Vintage DAC at the DAC rate: the held sample still carries these voices, so their fade is rendered at the
      // coming DAC instants and goes out through the stream (quantiser and hold included) instead of beside it
      const cnt = this.fadeCnt, tau = this.fadeTau, td = this.tailD;
      let t = this.dacT, K = 0;
      for (let c = 0; c < nCh; c++) { const lim = (c + 1) * CH - 1; let k = 0; while (t <= lim) { tau[K++] = t; t += per; k++; } cnt[c] = k; }
      tmp.fill(0, 0, K);
      for (const v of list) if (v.active) v.render(tmp, M, cnt, 49096);
      if (!this.tailDN) td.fill(0);
      else if (this.tailDP) { td.copyWithin(0, this.tailDP, this.tailDP + this.tailDN); td.fill(0, this.tailDN); this.tailDP = 0; }
      for (let j = 0; j < K; j++) td[j] += tmp[j] * (0.5 + 0.5 * Math.cos(Math.PI * Math.max(0, tau[j]) / M));
      if (this.tailDN < K) this.tailDN = K;
      return;
    }
    const tl = this.tail;
    tmp.fill(0);
    for (const v of list) if (v.active) v.render(tmp, M);
    if (dv) this.div.render(tmp, M);
    if (!this.tailN) tl.fill(0); // a spent tail leaves its samples behind
    else if (this.tailP) { tl.copyWithin(0, this.tailP, this.tailP + this.tailN); tl.fill(0, this.tailN); this.tailP = 0; }
    for (let i = 0; i < M; i++) tl[i] += tmp[i] * (0.5 + 0.5 * Math.cos(Math.PI * i / M));
    if (this.tailN < M) this.tailN = M;
  }
  // Serum: the voices render the fade in stereo (and their direct-out pair) in pieces of at most one span; for the
  // voices these are extra renders without a begin (§8.4.3). Uses the span buffers: only called between spans.
  fadeSerum(list) {
    let any = false;
    for (const v of list) if (v.active) { any = true; break; }
    if (!any) return;
    const M = this.fadeN, PC = 128 * this.OS, dir = this.sxDir === 1;
    const L = this.buf, R = this.bufR, DL = this.bufDL, DR = this.bufDR;
    const tL = this.tailL, tR = this.tailR, tDL = this.tailDL, tDR = this.tailDR;
    if (!this.tailSN) { tL.fill(0); tR.fill(0); tDL.fill(0); tDR.fill(0); } // a spent tail leaves its samples behind
    else if (this.tailSP) {
      const P = this.tailSP, E = P + this.tailSN;
      tL.copyWithin(0, P, E); tR.copyWithin(0, P, E); tDL.copyWithin(0, P, E); tDR.copyWithin(0, P, E);
      tL.fill(0, this.tailSN); tR.fill(0, this.tailSN); tDL.fill(0, this.tailSN); tDR.fill(0, this.tailSN);
      this.tailSP = 0;
    }
    for (let o = 0; o < M; o += PC) {
      const n = Math.min(PC, M - o);
      L.fill(0, 0, n); R.fill(0, 0, n);
      if (dir) { DL.fill(0, 0, n); DR.fill(0, 0, n); }
      for (const v of list) if (v.active) { if (dir) v.render(L, R, n, DL, DR); else v.render(L, R, n); }
      for (let i = 0; i < n; i++) {
        const w = 0.5 + 0.5 * Math.cos(Math.PI * (o + i) / M);
        tL[o + i] += L[i] * w; tR[o + i] += R[i] * w;
        if (dir) { tDL[o + i] += DL[i] * w; tDR[o + i] += DR[i] * w; }
      }
    }
    if (this.tailSN < M) this.tailSN = M;
  }
  allOff(hard) {
    if (hard) this.fadeOut(null);
    if (this.voices) for (const v of this.voices) { v.noteOff(); v.sus = false; if (hard) v.kill(); }
    if (this.div) this.div.allOff(hard);
    this.held = []; this.monoGate = false;
  }
  glc(legato) {
    const p = this.p;
    if (p.glide > 0 && (!p.glideLegato || legato)) return 1 - Math.exp(-1 / (p.glide * 0.3 * this.fs / this.CH));
    return 1;
  }
  msg(d) {
    switch (d.t) {
      case 'patch': this.setPatch(d.p); break;
      case 'on': this.noteOn(d.n, d.v); break;
      case 'off': this.noteOff(d.n, d.rv); break;
      case 'pat': if (d.n >= 0 && d.n < 128) { this.pat[d.n | 0] = +d.v || 0; this.patSeen = true; } break; // poly pressure
      case 'wt': { const SD = globalThis.SerumDSP; if (SD) SD.storeWT(d.id, d); break; }
      case 'wtf': { const SD = globalThis.SerumDSP; if (SD) SD.storeWTFrame(d.id, d.frame, d.levels); break; }
      case 'wtdel': { const SD = globalThis.SerumDSP; if (SD) SD.dropWT(d.id); break; }
      case 'smon': // the host's snapshot / FX meter subscription: posted every ~33 ms of audio while on
        this.mon = !!d.on; this.monF = 0;
        if (this.sx) this.sx.mon = d.on ? 1 : 0;
        if (this.mon) this.postMon();
        break;
      case 'fxph': this.port.postMessage({ t: 'fxph', v: this.rack ? this.rack.phases() : null }); break;
      case 'bend': this.bendRaw = d.v; this.bend = d.v * (this.p.bendRange || 2); break;
      case 'wheel': this.wheel = d.v; break;
      case 'at': this.at = d.v; break;
      case 'sus':
        this.sustain = d.v;
        if (!d.v) {
          for (const v of this.voices) if (v.sus) { v.sus = false; v.noteOff(); }
          if (this.p.mode !== 'poly' && this.held.length === 0 && this.monoGate) { this.monoGate = false; for (const v of this.voices) v.noteOff(); }
          if (this.div) for (let n = 0; n < 128; n++) if (this.div.gate[n] === 2) this.div.gate[n] = 0;
        }
        break;
      case 'os': // the app's oversampling; a Serum track keeps its own (§11.4)
        this.hostOS = d.v;
        if (this.kind !== 'serum') this.reqOS(d.v);
        break;
      case 'panic': {
        this.allOff(true); if (this.sq) this.sq.run = false; this.seqOn = [];
        const SD = globalThis.SerumDSP;
        if (SD && this.sx) SD.reset(this);
        // the de-click fades just rendered would re-excite effects cleared now: the output (fades, chorus / ensemble,
        // FX rack) fades out over 5 ms instead, then everything is cleared (at once when nothing can sound)
        const quiet = !this.tailN && !this.tailDN && !this.tailSN && this.quietF > this.base * 2 && (!this.rack || this.rack.idle());
        if (quiet) this.panicClear(); else this.pnN = this.pnM;
        break;
      }
      case 'seq': this.seqMsg(d.s); break;
      case 'song': this.songMsg(d); break;
      case 'transport': this.transportMsg(d); break;
    }
  }
  panicClear() {
    this.pnN = 0;
    this.tailN = this.tailP = this.tailSN = this.tailSP = this.tailDN = this.tailDP = 0;
    this.dacHold = this.dacPend = 0; this.dacLive = false;
    this.chorus.reset(); this.chorus.snap(); this.ens.reset(); this.ens.snap();
    if (this.rack) this.rack.reset(false);
  }
  panicFade(n) { // raised-cosine fade of the whole output, then panicClear
    const Lb = this.Lb, Rb = this.Rb, M = this.pnM;
    let k = this.pnN;
    for (let i = 0; i < n; i++) {
      const g = k > 0 ? 0.5 - 0.5 * Math.cos(Math.PI * k / M) : 0;
      Lb[i] *= g; Rb[i] *= g;
      if (k > 0) k--;
    }
    this.pnN = k;
    if (k === 0) this.panicClear();
  }
  noteOn(n, v) {
    const p = this.p;
    if (this.rack) this.rack.trigger(); // Hyper RETRIG
    if (this.kind === 'serum') { this.sxNoteOn(n, v); return; }
    if (!this.anyActive()) { this.smTargets(); this.smSnap(); } // nothing sounding: start at the panel values
    if (this.kind === 'divide') { this.div.noteOn(n); return; }
    if (p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i >= 0) this.held.splice(i, 1);
      this.held.push(n);
      this.monoPlay(v, true);
      return;
    }
    let vc = null;
    if (this.kind !== 'fm') { for (const x of this.voices) if (x.active && x.note === n) { vc = x; break; } }
    else for (const x of this.voices) if (x.gate && !x.sus && x.note === n) x.noteOff(); // DX7: a repeated key gets a voice of its own
    if (!vc) {
      let best = null;
      for (const x of this.voices) if (!x.active && (!best || x.stamp < best.stamp)) best = x;
      if (!best) for (const x of this.voices) if (!x.gate && (!best || x.stamp < best.stamp)) best = x;
      if (!best) for (const x of this.voices) if (x.sus && (!best || x.stamp < best.stamp)) best = x; // pedal-held before key-held
      if (!best) for (const x of this.voices) if (!best || x.stamp < best.stamp) best = x;
      vc = best;
      if (vc.active && this.kind === 'fm') { this.fadeOut([vc]); vc.kill(); } // operator key sync would cut a sounding voice
    }
    vc.stamp = ++this.stamp;
    vc.noteOn(n, v, false, this.glc(false));
  }
  // Serum (§11.3): poly allocation over voices[0 … POLY−1]; a repeated note reuses its voice only with "one of any
  // note number" on; mono plays voices[0] (the voice does portamento, legato and unison itself)
  sxNoteOn(n, v) {
    const vs = this.voices;
    if (!vs.length) return; // SerumDSP missing: a silent track
    if (this.sxW) { const SD = globalThis.SerumDSP; if (SD) SD.warmEnd(this); this.sxW = 0; sxHot = true; } // real notes now
    if (this.p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i >= 0) this.held.splice(i, 1);
      this.held.push(n);
      this.monoPlay(v, true);
      return;
    }
    const nUse = this.sxUse < vs.length ? this.sxUse : vs.length;
    let vc = null;
    if (this.sxOne) for (let i = 0; i < nUse; i++) { const x = vs[i]; if (x.active && x.note === n) { vc = x; break; } }
    if (!vc) {
      let best = null;
      for (let i = 0; i < nUse; i++) { const x = vs[i]; if (!x.active && (!best || x.stamp < best.stamp)) best = x; }
      if (!best) for (let i = 0; i < nUse; i++) { const x = vs[i]; if (!x.gate && (!best || x.stamp < best.stamp)) best = x; }
      if (!best) for (let i = 0; i < nUse; i++) { const x = vs[i]; if (x.sus && (!best || x.stamp < best.stamp)) best = x; }
      if (!best) for (let i = 0; i < nUse; i++) { const x = vs[i]; if (!best || x.stamp < best.stamp) best = x; }
      vc = best;
    }
    vc.stamp = ++this.stamp;
    vc.noteOn(n, v, false, 1);
  }
  monoPlay(v, fresh) {
    const p = this.p, h = this.held;
    let n;
    if (p.prio === 'low') n = Math.min.apply(null, h);
    else if (p.prio === 'high') n = Math.max.apply(null, h);
    else n = h[h.length - 1];
    // legato only while another key is physically down: under Hold a detached key re-strikes
    const gated = this.monoGate && (!fresh || h.length > 1);
    const legato = gated && p.legato;
    const g = this.glc(gated);
    if (this.kind === 'serum') { const x = this.voices[0]; if (x) x.noteOn(n, fresh ? v : x.vel, legato, g); }
    else for (const x of this.voices) x.noteOn(n, fresh ? v : x.vel, legato, g);
    this.monoGate = true;
  }
  // rv: release velocity (MIDI note-off, 0–1), passed to the Serum voices it releases (§11.3)
  noteOff(n, rv) {
    const p = this.p;
    if (this.kind === 'divide') { this.div.gate[n] = this.sustain && this.div.gate[n] ? 2 : 0; return; }
    const sx = this.kind === 'serum';
    if (p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i < 0) return;
      const wasTop = this.voices[0] && this.voices[0].note === n;
      this.held.splice(i, 1);
      if (this.held.length) { if (wasTop) this.monoPlay(this.voices[0].vel, false); }
      else if (!this.sustain) {
        this.monoGate = false;
        if (sx) { if (this.voices.length) this.voices[0].noteOff(rv); } else for (const x of this.voices) x.noteOff();
      }
      return;
    }
    if (sx) { for (const x of this.voices) if (x.gate && x.note === n) { if (this.sustain) x.sus = true; else x.noteOff(rv); } return; }
    for (const x of this.voices) if (x.gate && x.note === n) { if (this.sustain) x.sus = true; else x.noteOff(); }
  }
  runLFO(nCh) {
    const L = this.p.lfo, inc = L.rate * this.CH / this.fs;
    let ph = this.lfoPh;
    for (let c = 0; c < nCh; c++) {
      ph += inc;
      if (ph >= 1) { ph -= Math.floor(ph); this.lfoSH = this.rnd(); }
      let v;
      switch (L.wave) {
        case 1: v = sin1(ph); break;
        case 2: v = 2 * ph - 1; break;
        case 3: v = 1 - 2 * ph; break;
        case 4: v = ph < 0.5 ? 1 : -1; break;
        case 5: v = this.lfoSH; break;
        default: v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      }
      this.lfoBuf[c] = v;
    }
    if (nCh) this.lfoLast = this.lfoBuf[nCh - 1];
    this.lfoPh = ph;
  }
  // FM voices at the DX7's 49.096 kHz: control chunk c owns the DAC instants in (c*CH - 1, (c+1)*CH - 1] (grid
  // samples). After the 12-bit quantiser the held value is laid onto the grid with every step at its true
  // fractional time (2-point polyBLEP, output one grid sample late): no grid jitter, and the cost no longer grows
  // with the oversampling
  // (vox false: no voice on this path any more, only the fade of the ones stopped hard drains out)
  renderDac(buf, N, per, vox) {
    const CH = this.CH, nCh = N / CH, cnt = this.dacCnt, tau = this.dacTau, db = this.dacBuf;
    let t = this.dacT, M = 0;
    for (let c = 0; c < nCh; c++) { const lim = (c + 1) * CH - 1; let k = 0; while (t <= lim) { tau[M++] = t; t += per; k++; } cnt[c] = k; }
    this.dacT = t - N;
    db.fill(0, 0, M);
    let act = 0;
    if (vox) for (const v of this.voices) if (v.active) { v.render(db, N, cnt, 49096); act++; }
    if (this.tailDN) {
      const k = Math.min(M, this.tailDN), td = this.tailD, P = this.tailDP;
      for (let j = 0; j < k; j++) db[j] += td[P + j];
      this.tailDP += k; this.tailDN -= k; if (!this.tailDN) this.tailDP = 0;
    }
    let hold = this.dacHold, pend = this.dacPend, j = 0, tj = M > 0 ? tau[0] : 1e9;
    if (!this.dacLive && M > 0) hold = pend = dacQ(db[0]); // switched in under sounding voices: no step from zero
    this.dacLive = true;
    for (let i = 0; i < N; i++) {
      let cP = 0, cC = 0;
      while (tj <= i) {
        const nv = dacQ(db[j]), D = nv - hold, d = i - tj, u = 1 - d; hold = nv;
        cP += 0.5 * D * d * d; cC -= 0.5 * D * u * u;
        j++; tj = j < M ? tau[j] : 1e9;
      }
      buf[i] += pend + cP;
      pend = hold + cC;
    }
    this.dacHold = hold; this.dacPend = pend;
    return act;
  }
  /* ---- song playback ------------------------------------------------ */
  // notes: flat [t, d, n, v(1..127)] sorted by t; cc: flat [t, k, v] (k: 0 bend, 1 wheel, 2 sus, 3 aftertouch)
  songMsg(d) {
    this.sn = d.notes || []; this.sc = d.cc || [];
    this.reseek = true;
  }
  transportMsg(d) {
    const tp = this.tp;
    if (!d.play) {
      tp.pend = null;
      if (tp.play) {
        tp.play = false; this.releaseSong(true); this.transportHook(false);
        // preference "silence effect tails when transport stops" (§11.5): the rack's tails fade out over 5 ms
        if (this.rack && this.p.fxr && this.p.fxr.silence) this.rack.reset(true);
      }
      return;
    }
    tp.pend = { frame: d.frame, tick: d.tick, fpt: d.fpt, loop: !!d.loop, ls: d.ls || 0, le: d.le || 0, seek: d.seek !== false, end: d.end == null ? null : d.end };
  }
  releaseSong(stop) {
    const on = this.seqOn;
    for (let i = 0; i < on.length; i += 2) this.noteOff(on[i]);
    this.seqOn = [];
    if (stop && this.songCtl) {
      this.songCtl = false;
      this.msg({ t: 'sus', v: false }); this.msg({ t: 'bend', v: 0 });
    }
  }
  tickAt(F) { const tp = this.tp; return tp.tick + (F - tp.frame) / tp.fpt; }
  // Serum host fields (§8.4.1): the song tempo while the transport plays, else the patch's; the song position in
  // beats at the start of the current span, or null when stopped
  get bpm() { const tp = this.tp; return tp && tp.play ? 60 * this.base / (tp.fpt * 960) : this.p && this.p.bpm > 0 ? this.p.bpm : 120; }
  songBeat() { const tp = this.tp; return tp && tp.play ? this.tickAt(this.spanF) / 960 : null; }
  // play with seek (playing) / stop: Serum's host-synced state and the rack's LFO phases restart, so a song rendered
  // from a given tick is identical live and offline (§6.16, §8.5.2)
  transportHook(playing) {
    const SD = globalThis.SerumDSP;
    if (SD && this.kind === 'serum' && this.sx) SD.transport(this, playing);
    if (playing && this.rack) this.rack.transport();
  }
  songEvents(F) { // handles transport + song events due at frame F; returns frames to the next event
    const tp = this.tp;
    let dist = 1e9;
    if (tp.pend) {
      const P = tp.pend;
      if (F >= P.frame - 0.5) {
        tp.pend = null;
        const start = P.seek || !tp.play;
        if (start) this.releaseSong(false);
        tp.play = true; tp.frame = P.frame; tp.tick = P.tick; tp.fpt = P.fpt; tp.loop = P.loop; tp.ls = P.ls; tp.le = P.le; tp.end = P.end;
        tp.wrap = P.loop && P.le > P.ls && P.tick < P.le;
        this.reseek = true;
        if (start) this.transportHook(true);
      } else dist = P.frame - F;
    }
    if (!tp.play) return dist;
    let t = this.tickAt(F);
    if (tp.wrap && t >= tp.le) {
      const L = tp.le - tp.ls;
      let Fb = tp.frame + (tp.le - tp.tick) * tp.fpt;
      while (F - Fb >= L * tp.fpt) Fb += L * tp.fpt;
      tp.frame = Fb; tp.tick = tp.ls;
      t = this.tickAt(F);
      this.releaseSong(false);
      this.reseek = true;
    }
    if (tp.end != null && t >= tp.end) { tp.play = false; this.releaseSong(true); this.transportHook(false); if (this.sq && this.sq.sync) this.seqRelease(); return dist; }
    const sn = this.sn, sc = this.sc;
    if (this.reseek) {
      let lo = 0, hi = sn.length / 4;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sn[m * 4] < t) lo = m + 1; else hi = m; }
      this.ni = lo;
      lo = 0; hi = sc.length / 3;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m * 3] < t) lo = m + 1; else hi = m; }
      this.ci = lo;
      this.reseek = false;
    }
    // note-offs first
    const on = this.seqOn;
    for (let i = on.length - 2; i >= 0; i -= 2) if (on[i + 1] <= t) { this.noteOff(on[i]); on.splice(i, 2); }
    // controllers
    while (this.ci * 3 < sc.length && sc[this.ci * 3] <= t) {
      const k = sc[this.ci * 3 + 1], v = sc[this.ci * 3 + 2];
      this.songCtl = true;
      if (k === 0) this.msg({ t: 'bend', v });
      else if (k === 1) this.wheel = v;
      else if (k === 2) this.msg({ t: 'sus', v: v >= 0.5 });
      else this.at = v;
      this.ci++;
    }
    // note-ons
    while (this.ni * 4 < sn.length && sn[this.ni * 4] <= t) {
      const j = this.ni * 4, st = sn[j], n = sn[j + 2];
      this.ni++;
      if (tp.wrap && st >= tp.le) continue;
      for (let i = on.length - 2; i >= 0; i -= 2) if (on[i] === n) on.splice(i, 2); // overlapping same pitch: the new note owns it
      this.noteOn(n, sn[j + 3] / 127);
      let end = st + sn[j + 1];
      if (tp.wrap && end > tp.le) end = tp.le;
      on.push(n, end);
    }
    // distance to the next event
    let nt = 1e18;
    if (this.ni * 4 < sn.length) nt = sn[this.ni * 4];
    if (this.ci * 3 < sc.length && sc[this.ci * 3] < nt) nt = sc[this.ci * 3];
    for (let i = 1; i < on.length; i += 2) if (on[i] < nt) nt = on[i];
    if (tp.wrap && tp.le < nt) nt = tp.le;
    if (tp.end != null && tp.end < nt) nt = tp.end;
    if (nt < 1e17) { const df = (nt - t) * tp.fpt; if (df < dist) dist = df; }
    return dist < 1 ? 1 : dist;
  }

  /* ---- TB-303 style step sequencer, clocked in the audio thread ---- */
  seqMsg(s) {
    const q = this.sq || (this.sq = { run: false, sync: false, pat: [], len: 16, bpm: 120, root: 36, step: -1, pos: 0, fired: true, offed: true, tie: false, cur: -1, swing: 0, syncStep: null });
    const wasRun = q.run, wasSync = q.sync;
    Object.assign(q, s);
    q.spb = this.base * 60 / Math.max(20, q.bpm) / 4;
    if (q.run && !wasRun) { q.step = -1; q.stepLen = q.spb; q.pos = q.spb; q.tie = false; q.cur = -1; }
    if ((!q.run && wasRun) || (!q.sync && wasSync)) this.seqRelease();
    if (q.sync && !wasSync) q.syncStep = null;
  }
  seqRelease() {
    const q = this.sq;
    if (q && q.cur >= 0 && this.voices) this.noteOff(q.cur);
    if (q) { q.cur = -1; q.tie = false; q.syncStep = null; }
  }
  seqFire(step) {
    const q = this.sq;
    const s = q.pat[step];
    if (s && s.g) {
      const n = q.root + s.n + 12 * s.o;
      const vel = s.a ? 1 : 0.62;
      const legato = q.tie && q.cur >= 0;
      if (legato) { for (const v of this.voices) v.noteOn(n, vel, true, this.glc(true)); this.held = [n]; }
      else { if (q.cur >= 0) this.noteOff(q.cur); this.noteOn(n, vel); }
      q.cur = n; q.tie = !!s.s;
    } else {
      if (q.cur >= 0) this.noteOff(q.cur);
      q.cur = -1; q.tie = false;
    }
    this.port.postMessage({ t: 'step', s: step });
  }
  seqGateOff() {
    const q = this.sq;
    if (q.cur >= 0 && !q.tie) { this.noteOff(q.cur); q.cur = -1; }
  }
  seqEvents(F) { // returns frames until the next sequencer event
    const q = this.sq;
    if (!q || !this.voices || !this.voices.length || this.kind !== 'analog') return 1e9;
    if (q.sync) { // locked to the song transport: one step per sixteenth
      const tp = this.tp;
      if (!tp.play) { if (q.syncStep !== null) this.seqRelease(); return 1e9; }
      const t = this.tickAt(F);
      if (t < 0) return -t * tp.fpt;
      const S = 240, sw = q.swing * S;
      let k = Math.floor(t / S), start = k * S + (k % 2 ? sw : 0);
      if (t < start) { k--; start = k * S + (k % 2 ? sw : 0); }
      const len = k % 2 ? S - sw : S + sw;
      if (k !== q.syncStep) { q.syncStep = k; q.offed = false; this.seqFire(((k % q.len) + q.len) % q.len); }
      if (!q.offed && t >= start + len * 0.5) { q.offed = true; this.seqGateOff(); }
      const nt = q.offed ? start + len : start + len * 0.5;
      return Math.max(1, (nt - t) * tp.fpt);
    }
    if (!q.run) return 1e9;
    if (q.pos >= q.stepLen) {
      q.pos -= q.stepLen;
      q.step = (q.step + 1) % q.len;
      q.fired = false; q.offed = false;
      // swing lengthens the on-beat sixteenth and shortens the off-beat one
      q.stepLen = q.spb * (q.step % 2 ? 1 - q.swing : 1 + q.swing);
    }
    const sl = q.stepLen;
    if (!q.fired) { q.fired = true; this.seqFire(q.step); }
    const gateAt = sl * 0.5;
    if (!q.offed && q.pos >= gateAt) { q.offed = true; this.seqGateOff(); }
    return (q.offed ? sl : gateAt) - q.pos;
  }
  process(inputs, outputs) {
    const t0 = Date.now();
    const out = outputs[0], Lo = out[0], Ro = out[1] || out[0];
    const n = Lo.length;
    const F0 = typeof currentFrame === 'number' ? currentFrame : this.frames;
    this.frames = F0 + n;
    const q = this.sq;
    let off = 0;
    while (off < n) {
      let len = n - off;
      const F = F0 + off;
      this.spanF = F; // songBeat() of this span (and of a transport applied at F)
      let d = this.songEvents(F);
      if (q && (q.run || q.sync)) { const d2 = this.seqEvents(F); if (d2 < d) d = d2; }
      if (d < len) { len = Math.max(4, Math.ceil(d / 4) * 4); if (len > n - off) len = n - off; }
      this.renderSpan(Lo, Ro, off, len);
      if (q && q.run && !q.sync) q.pos += len;
      off += len;
    }
    if (this.mon && (this.monF += n) >= this.base * 0.033) { this.monF = 0; this.postMon(); }
    this.loadT += Date.now() - t0;
    this.statN += n;
    if (this.statN >= this.base * 0.25) {
      this.port.postMessage({ t: 'stats', load: this.loadT / (this.statN / this.base * 1000), voices: this.kind === 'serum' ? this.sxVoices() : this.act, os: this.OS });
      this.loadT = 0; this.statN = 0;
    }
    return true;
  }
  // monitor message (§8.4.4, §11.6): Serum's snapshot (null for other models), the rack's gain reduction and phases
  postMon() {
    const SD = globalThis.SerumDSP, r = this.rack;
    this.port.postMessage({ t: 'smon', s: SD && this.kind === 'serum' && this.sx ? SD.snapshot(this) : null, gr: r ? r.gr() : null, fxph: r ? r.phases() : null });
  }
  sxVoices() { // oscillator voices sounding (Serum's voice counter)
    const SD = globalThis.SerumDSP, s = SD && this.sx ? SD.snapshot(this) : null;
    return s ? s.oscVoices : 0;
  }
  // An oversampling change rebuilds the decimators (empty history) and shifts the group delay, so it is made at
  // silence: the voice mix fades out (~4 ms raised cosine), the switch happens at zero, the output stays muted
  // while the new decimators fill (~1.7 ms), then fades back in. Applied before the chorus / ensemble, so their
  // delay lines never hold the gap.
  osFade(n, a, b, c, d) { // channels b, c, d optional (Serum: L, R and the direct-out pair share one ramp)
    const st = 1 / (this.base * 0.004), g = this.osG;
    let r = this.osR, h = this.osHold;
    for (let i = 0; i < n; i++) {
      if (this.osPend) { r -= st; if (r < 0) r = 0; }
      else if (h > 0) { h--; r = 0; }
      else { r += st; if (r > 1) r = 1; }
      g[i] = r * r * (3 - 2 * r);
    }
    this.osR = r; this.osHold = h;
    for (let i = 0; i < n; i++) a[i] *= g[i];
    if (b) for (let i = 0; i < n; i++) b[i] *= g[i];
    if (c) for (let i = 0; i < n; i++) c[i] *= g[i];
    if (d) for (let i = 0; i < n; i++) d[i] *= g[i];
  }
  decim(dec, src, dst, n) { // OS-rate channel → base rate through its own half-band chain
    let s = src, len = n * this.OS;
    for (let k = 0; k < dec.length; k++) {
      const d = k === dec.length - 1 ? dst : this.tmp[k];
      dec[k].process(s, d, len >> 1);
      s = d; len >>= 1;
    }
    if (dec.length === 0) for (let i = 0; i < n; i++) dst[i] = src[i];
  }
  renderSpan(Lo, Ro, off, n) {
    if (this.osPend && this.osR === 0) { this.setOS(this.osPend); this.osPend = 0; this.osHold = Math.ceil(this.base * 0.0017); }
    const OS = this.OS, N = n * OS, buf = this.buf, p = this.p;
    this.ctl += n / 4; // control ticks (rate independent), also counted while skipping: idle voices' EGs keep time
    // silent instrument: once every voice and effect tail has died away, skip the DSP entirely
    const any = this.tailN > 0 || this.tailDN > 0 || this.tailSN > 0 || this.pnN > 0 || this.sxW > 0 || this.anyActive();
    if (any) this.quietF = 0;
    else if ((this.quietF += n) > this.base * 2 && (!this.rack || this.rack.idle())) {
      for (let i = 0; i < n; i++) { Lo[off + i] = 0; if (Ro !== Lo) Ro[off + i] = 0; }
      this.act = 0;
      if (this.kind === 'serum') { const SD = globalThis.SerumDSP; if (SD && this.sx) SD.idle(this, n); } // LFOs, clocks, smoothers keep time
      return;
    }
    if (this.kind === 'serum') { this.renderSerum(Lo, Ro, off, n); return; }
    buf.fill(0, 0, N);
    if (this.tailN) { // de-click fade of voices that were stopped hard
      const k = Math.min(N, this.tailN), tl = this.tail, P = this.tailP;
      for (let i = 0; i < k; i++) buf[i] += tl[P + i];
      this.tailP += k; this.tailN -= k; if (!this.tailN) this.tailP = 0;
    }
    if (this.tailSN) { // Serum voices stopped hard by a model switch: their stereo fade, folded to mono
      const k = Math.min(N, this.tailSN), P = this.tailSP, tL = this.tailL, tR = this.tailR, tDL = this.tailDL, tDR = this.tailDR;
      for (let i = 0; i < k; i++) buf[i] += 0.5 * (tL[P + i] + tR[P + i] + tDL[P + i] + tDR[P + i]);
      this.tailSP += k; this.tailSN -= k; if (!this.tailSN) this.tailSP = 0;
    }
    const nCh = Math.max(1, Math.round(N / this.CH));
    if (this.lfoBuf.length < nCh) this.lfoBuf = new Float64Array(nCh);
    this.runLFO(nCh);
    this.smStep(n);
    this.gdrift += (this.rnd() * 3.5 - this.gdrift) * this.gouB * 0.02 * (n / 128);
    let act = 0;
    // DX7 Vintage DAC: once the grid is well above 49.096 kHz the operators run at the DAC rate itself (as on the
    // DX7) and the held samples are laid onto the grid at their exact instants
    const per = this.fs / 49096, dacR = p.dac !== 0 && this.kind === 'fm' && per >= 1.5;
    if (this.kind === 'divide') { if (this.div.list.length) this.div.render(buf, N); act = this.div.list.length; }
    else if (dacR) act = this.renderDac(buf, N, per, true);
    else for (const v of this.voices) if (v.active) { v.render(buf, N); act++; }
    this.act = act;
    if (!dacR) {
      if (this.tailDN) this.renderDac(buf, N, per, false); // DX7 left mid-fade (model switch): the stream drains
      else if (p.dac !== 0) { // grid at or near the DAC rate (1x): 12-bit floating quantiser with zero-order hold
        let t = this.dacT, hold = this.dacHold;
        for (let i = 0; i < N; i++) {
          if (t <= 0) { hold = dacQ(buf[i]); t += per; if (t < 0) t = 0; }
          t -= 1; buf[i] = hold;
        }
        this.dacT = t; this.dacHold = hold;
      } else this.dacHold = this.dacPend = 0; // DAC out of the path: nothing held over for its return
      if (!this.tailDN) this.dacLive = false;
    }
    // decimate
    let src = buf, len = N;
    for (let s = 0; s < this.dec.length; s++) {
      const dst = s === this.dec.length - 1 ? this.monoBuf : this.tmp[s];
      this.dec[s].process(src, dst, len >> 1);
      src = dst; len >>= 1;
    }
    if (this.dec.length === 0) for (let i = 0; i < n; i++) this.monoBuf[i] = buf[i];
    const mono = this.monoBuf, Lb = this.Lb, Rb = this.Rb;
    if (this.osPend || this.osR < 1) this.osFade(n, mono);
    for (let i = 0; i < n; i++) Lb[i] = Rb[i] = mono[i];
    this.chorus.process(mono, Lb, Rb, n);
    this.ens.process(mono, Lb, Rb, n);
    if (this.rack) this.rack.process(Lb, Rb, n); // the track's FX rack (bypass-cheap when every module is off)
    if (this.pnN) this.panicFade(n);
    this.outStage(Lo, Ro, off, n);
  }
  // Serum span (§11.2): voices in stereo at the OS rate (+ the direct-out pair) → FX modulation → decimation of each
  // channel → oversampling fade → FX rack (adds the direct pair, master, bypass) → DC block / limiter
  renderSerum(Lo, Ro, off, n) {
    const SD = globalThis.SerumDSP, N = n * this.OS, dir = this.sxDir === 1;
    const L = this.buf, R = this.bufR, DL = this.bufDL, DR = this.bufDR;
    L.fill(0, 0, N); R.fill(0, 0, N);
    if (dir) {
      DL.fill(0, 0, N); DR.fill(0, 0, N);
      if (!this.sxDirOn) { for (const c of [this.decDL, this.decDR]) for (const h of c) h.buf.fill(0); } // no stale history
    }
    this.sxDirOn = dir ? 1 : 0;
    if (this.tailN) { // the previous model's voices stopped hard (model switch)
      const k = Math.min(N, this.tailN), tl = this.tail, P = this.tailP;
      for (let i = 0; i < k; i++) { L[i] += tl[P + i]; R[i] += tl[P + i]; }
      this.tailP += k; this.tailN -= k; if (!this.tailN) this.tailP = 0;
    }
    if (this.tailSN) { // de-click fade of Serum voices that were stopped hard
      const k = Math.min(N, this.tailSN), P = this.tailSP, tL = this.tailL, tR = this.tailR, tDL = this.tailDL, tDR = this.tailDR;
      if (dir) for (let i = 0; i < k; i++) { L[i] += tL[P + i]; R[i] += tR[P + i]; DL[i] += tDL[P + i]; DR[i] += tDR[P + i]; }
      else for (let i = 0; i < k; i++) { L[i] += tL[P + i] + tDL[P + i]; R[i] += tR[P + i] + tDR[P + i]; }
      this.tailSP += k; this.tailSN -= k; if (!this.tailSN) this.tailSP = 0;
    }
    if (this.tailDN) { // a DX7 left mid-fade with its Vintage DAC on (model switch): the stream drains as in renderSpan
      const M = this.bufM;
      M.fill(0, 0, N);
      this.renderDac(M, N, this.fs / 49096, false);
      for (let i = 0; i < N; i++) { L[i] += M[i]; R[i] += M[i]; }
      if (!this.tailDN) this.dacLive = false;
    }
    let act = 0;
    const vs = this.voices;
    if (SD && vs.length) {
      SD.begin(this, N);
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v.active) continue;
        if (dir) v.render(L, R, N, DL, DR); else v.render(L, R, N);
        act++;
      }
      if (this.sxW && SD.warmTick(this, N) === 0) { this.sxW = 0; sxHot = true; }
      if (this.rack) this.rack.setMods(SD.fxMods(this));
    }
    this.act = act;
    const Lb = this.Lb, Rb = this.Rb, dLb = this.dLb, dRb = this.dRb;
    this.decim(this.dec, L, Lb, n); this.decim(this.decR, R, Rb, n);
    if (dir) { this.decim(this.decDL, DL, dLb, n); this.decim(this.decDR, DR, dRb, n); }
    if (this.osPend || this.osR < 1) this.osFade(n, Lb, Rb, dir ? dLb : null, dir ? dRb : null);
    if (this.rack) this.rack.process(Lb, Rb, n, dir ? dLb : undefined, dir ? dRb : undefined);
    else { // no fx-dsp: the direct pair, master and Bypass (base values, ramped across the span)
      if (dir) for (let i = 0; i < n; i++) { Lb[i] += dLb[i]; Rb[i] += dRb[i]; }
      const g0 = this.nfG, dg = (this.nfT - g0) / n;
      for (let i = 0; i < n; i++) { const g = g0 + dg * (i + 1); Lb[i] *= g; Rb[i] *= g; }
      this.nfG = this.nfT;
    }
    if (this.pnN) this.panicFade(n);
    this.outStage(Lo, Ro, off, n);
  }
  // output stage: DC block, stereo-linked peak limiter, final safety clip
  outStage(Lo, Ro, off, n) {
    const Lb = this.Lb, Rb = this.Rb;
    const Rdc = 1 - TAU * 4 / this.base;
    let x0 = this.dcx[0], y0 = this.dcy[0], x1 = this.dcx[1], y1 = this.dcy[1];
    for (let i = 0; i < n; i++) {
      const a = Lb[i], b = Rb[i];
      y0 = a - x0 + Rdc * y0; x0 = a; y1 = b - x1 + Rdc * y1; x1 = b;
      Lb[i] = y0; Rb[i] = y1;
    }
    this.dcx[0] = x0; this.dcy[0] = y0; this.dcx[1] = x1; this.dcy[1] = y1;
    this.lim.process(Lb, Rb, n);
    for (let i = 0; i < n; i++) {
      const a = Lb[i], b = Rb[i];
      Lo[off + i] = a > 1 ? 1 : a < -1 ? -1 : a; if (Ro !== Lo) Ro[off + i] = b > 1 ? 1 : b < -1 ? -1 : b;
    }
  }
}

registerProcessor('synth-engine', SynthProcessor);
