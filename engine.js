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
    // seed: the hiss PRNG's start (22222; an Inst XORs its salt in, §6.2.1 — a double field from the start, V8)
    this.seed = 0.5; this.seed = 22222; this.r = 22222; this.g = 0; this.P = CHORUS_MODES[1]; this.ctr = 0; this.dep = 0;
    this.gk = 1 - Math.exp(-1 / (0.015 * fs)); this.sk = 1 - Math.exp(-1 / (0.03 * fs));
  }
  reset() {
    this.buf.fill(0); this.w = 0; this.ph = 0; this.g = 0; this.ctr = 0; this.dep = 0; this.r = this.seed;
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
    this.seq = o.seq || null; this.seqT = o.seqT || null; // Serum's sequencer patch (SPEC-serum2 §4.4; read by SxSeq, M2)
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

// Serum (serum-dsp.js and its helper scripts) and the FX rack (fx-dsp.js) are separate classic scripts loaded before
// this one (SPEC-serum2 §0.3: sx-base, sx-filt2, sx-warp, sx-mod, sx-sample, sx-gran, sx-spec, sx-seq, serum-dsp,
// fx-mods2, fx-dsp, then engine.js); any may be missing (failed load, or an M1a stub that defines its global as null):
// a Serum track is then silent, a missing rack is bypassed. Every global is looked up at use, never at load.
// Formats read here (§4.1, §4.3): CP v2 (patch.serum: oneNote, os, outMask bit 2 = the direct-out pair, fxKey), CT v2
// as parts (patch.serumT = {key, parts}; SerumDSP merges them), FXP v2 (patch.fxr: FX-context base [0] g.master,
// [1] g.bypass, …; FXRack). The engine itself never indexes a destination table.
const SXV = 32;                                                              // Serum voices at most (built as POLY needs them, §11.3)
// MIDI OUT (SPEC-serum2 §7.9): the processors of one AudioWorkletGlobalScope share this registry (track id → processor).
// A processor registers under processorOptions.trackId (preview / render-farm nodes pass none) and unregisters on
// {t: 'bye'}; a sequencer delivers a tapped event to another track with PROCS.get(id).extNote(F + 128, on, n, vel).
const PROCS = new Map();
const EXT_N = 256;                                                           // MIDI OUT ring entries per target processor
// every processor of this scope (until its {t: 'bye'}): an asset stored or dropped through any node is announced to every
// rack (FXRack.assets(): Convolve adopts an IR that arrived after its patch and sizes its delay lines, §9.5)
const ALL = new Set();
function assetsChanged() { for (const q of ALL) q.assets(); }
const osCapOf = base => Math.max(1, 2 ** Math.floor(Math.log2(384000 / base + 1e-9))); // internal rate ≤ 384 kHz
function decChain(os) { // cascaded half-band decimators for one channel: os → 1
  const d = [];
  let s = os;
  while (s > 1) { d.push(s === 2 ? new Halfband(127, 10) : new Halfband(35, 9)); s >>= 1; }
  return d;
}

// SPEC-canvas §6.2: a track is one Track (the AudioWorkletProcessor 'synth-engine', below) holding Insts (instruments)
// and Chains (FX panels). Stage 1d: every track is canonical — one Inst (i0) and one Chain (c0, the track's FX rack:
// a classic Inst feeds it as a shared panel, a Serum Inst holds it as its own FX) — driven by today's messages.
// Inst: an instrument — voices, smoothing, LFO, tails, decimators, chorus / ensemble, the TB-303 sequencer, a Serum's
// sequencer and own FX: every field the voice and DSP scripts read by name (`e.*`, `proc.*`). The method bodies were
// moved from the single-class processor unchanged (§6.2 verbatim-move rule; the few lifted lines are marked §6.2). The
// Track's `tp` is shared by reference; `songBeat()`, `nowF()`, `songHas()` forward to it. One class for every path (live,
// preview, offline, render farm, golden harness): only Inst objects reach AVoice / FVoice / Divide / SerumVoice /
// SerumDSP / SxMod / SxSeq as their host, so their property loads stay monomorphic.
class Inst {
  constructor(T, os, fxc) {
    this.T = T; this.id = 'i0'; this.port = T.port; this.tp = T.tp; this.fxc = fxc; // fxc: its private Chain (a Serum's own FX)
    this.hostOS = T.hostOS; // the app's oversampling (a Serum track runs at its own, §11.4)
    this.offline = T.offline;
    // stage 1e (IMPL-1e §2.1): power; key zone (lo, hi) and transpose; the seed salt (§6.2.1; seedSalt: the name the DSP
    // scripts read — doubles from the start, V8: a salt above 2^30 must not change the map); sharedRack: rack is a shared
    // panel's (its single source: patches never set it, {t: 'chain'} does); feed: the Chain it feeds, nOut: its consumers
    // (aliasing needs exactly one); live: rendered this span; t: ms of its spans since the last stats; slot: its bit in the
    // Track's held-note record; nOn: stamp of its last note-on (a shared panel's key tracking); overK: fxover's last list
    this.on = 1; this.zlo = 0; this.zhi = 127; this.zxp = 0; this.salt = 0.5; this.salt = 0; this.seedSalt = 0.5; this.seedSalt = 0;
    this.sharedRack = 0; this.feed = null; this.nOut = 0; this.live = 0; this.t = 0; this.slot = 0; this.nOn = 0; this.overK = '';
    this.init(os, fxc.rack);
  }
  // §6.2.1: a new salt (graph); the PRNG states move by old ^ new (a fresh Inst: exactly the salted seeds); a Serum's
  // own streams take it at its next attach / reset (serum-dsp, sx-mod, sx-seq read proc.seedSalt)
  setSalt(s) {
    s = s >>> 0;
    const d = (this.salt ^ s) >>> 0;
    if (d === 0) return;
    this.salt = s; this.seedSalt = s;
    this.r = ((this.r ^ d) >>> 0) || 1;
    this.chorus.seed = (22222 ^ s) >>> 0; this.chorus.r = ((this.chorus.r ^ d) >>> 0) || 1;
    if (this.voices && this.kind !== 'serum') for (const v of this.voices) if (typeof v.r === 'number') v.r = ((v.r ^ d) >>> 0) || 1;
  }
  // back to the freshly built state after the warm-up, resetting in place (fields that never change in normal use
  // are not reassigned, so the code compiled during the warm-up stays valid)
  restore(os) {
    this.setSalt(0); this.on = 1; this.zlo = 0; this.zhi = 127; this.zxp = 0; this.live = 0; this.t = 0; this.nOn = 0; this.overK = '';
    this.kind = ''; this.voices = null; this.div = null;
    this.bend = this.bendRaw = this.wheel = this.at = 0; this.sustain = false; this.clrHeld(); this.stamp = 0;
    this.lfoPh = this.lfoSH = this.lfoLast = this.gdrift = 0; this.r = (987654321 ^ this.salt) >>> 0; this.ctl = 0; this.act = 0;
    this.chorus.reset(); this.ens.reset();
    const SD = globalThis.SerumDSP;
    if (SD && this.sx) SD.reset(this);
    if (this.rack) this.rack.reset();
    this.ct = null; this.pat.fill(0); this.patSeen = false; this.mon = false;
    this.nfG = 1; this.nfT = 1; this.sxW = 0; this.sxWK = ''; this.sxWarm = null;
    this.lastNote = 60; this.mpe.fill(0); this.vOwn.fill(0); this.audK.fill(0);
    this.sqOff(); this.sxSeq = null; this.vcN = 0; this.rr.fill(0); this.mixPk.fill(0); this.monoCh = 0; this.monoEx = null;
    this.sxMask = 1; this.sxBusOn = 0; this.sxReal = 1; this.sxRel = 0; this.sxRelN = 0; this.sxRelT = 0;
    this.setOS(os);
    this.dacHold = this.dacT = this.dacPend = 0; this.osPend = 0; this.osR = 1; this.osHold = 0; this.quietF = 0;
    this.setPatch(DEFAULT_PATCH);
  }
  init(os, rack) {
    this.voices = null; this.div = null; this.sq = null;
    this.base = sampleRate;
    this.p = DEFAULT_PATCH;
    this.bend = 0; this.bendRaw = 0; this.wheel = 0; this.at = 0; this.sustain = false;
    this.held = []; this.heldC = []; this.heldE = []; this.stamp = 0; this.monoGate = false;
    this.lfoPh = 0; this.lfoSH = 0; this.lfoLast = 0; this.gdrift = 0; this.r = 987654321;
    this.ctl = 0;
    this.smT = new Float64Array(S_N); this.smS = new Float64Array(S_N); this.smA = new Float64Array(S_N);
    this.smB = new Float64Array(S_N); this.smD = new Float64Array(S_N); this.smMv = false;
    // Serum host fields (§8.4.1, §11.2): sx belongs to SerumDSP (attach), ct = last curve tables, pat = poly pressure
    this.sx = null; this.ct = null; this.pat = new Float64Array(128); this.patSeen = false;
    // sxW: the hidden-voice warm-up runs (SerumDSP.warmStart); sxWK: the patch shape it last warmed (SerumDSP.warmKey);
    // sxWarm: SxBase's lazy warm-up queue of this processor (declared here: created by warmAdd, §11.10)
    this.sxUse = 1; this.sxOne = 1; this.sxDir = 0; this.sxDirOn = 0; this.sxW = 0; this.sxWK = ''; this.sxWarm = null;
    this.mon = false; // this Inst's snapshot is subscribed (smon / mon: SerumDSP's sx.mon follows it)
    this.nfG = 1; this.nfT = 1; // Serum without the FX rack: master × bypass gain (now, target)
    // the last note-on of any model (the FX rack's key tracking, §12.5); MPE expressions per channel 0–16 [bend, y, z, x]
    // (§12.4, read by SxMod) (lastNote: a double field from the start, as SerumVoice.note — a boxed note number must not
    // change the processor's map at the first note, V8)
    this.lastNote = 60.5; this.lastNote = 60; this.mpe = new Float64Array(17 * 4);
    // Serum v2 processor fields (SPEC-serum2 §12.2): the sequencer (SxSeq.Seq, made on the first Serum patch with an
    // SQP; sqOn = the patch's sequencer is active and applied), clip-lane macro bases (NaN = none, written by SxSeq),
    // the Voice Control step counter (SxMod), multisample round-robin counters, the engine's MIDI OUT registry (read by
    // SxSeq: an AudioWorklet evaluates engine.js as a module, so PROCS is handed over as a field), per-voice expression
    // arrays of generated notes, the transposition record of notes played without SxSeq (§7.1: kbd.trans applied here),
    // the mono voice's channel / expression, the snapshot's Bus 1 / Bus 2 / Main / Direct peaks (§6.20 mix[7…10])
    this.sxSeq = null; this.sqOn = 0; this.sqTr = 0; this.seqMacro = new Float64Array(8).fill(NaN); this.vcN = 0;
    this.rr = new Uint16Array(512); this.procs = null;
    this.sxExA = []; for (let i = 0; i < SXV; i++) this.sxExA.push(new Float64Array(3));
    this.sxTr = new Int16Array(17 * 128).fill(-1); this.monoCh = 0; this.monoEx = null;
    // R7 B5: who owns each poly voice (by voice index: 0 the song / the keys, 1 a preview — the Piano Roll's audition,
    // {t: 'on', aud: 1}) and the Solina keys a preview started; a preview never takes or releases a voice it does not own.
    // Serum: audK[n] is the route of the preview of n (channel 0) — 1 through the sequencer (its key there), 2 not sent
    // (the sequencer already held the key for the song / the keys), 3 straight to the allocator (owner 1), 4 = 1 and the
    // song / the keys struck the key since (it is down until both let go)
    this.vOwn = new Uint8Array(SXV); this.audK = new Uint8Array(128);
    this.mixPk = new Float64Array(4);
    // CP.outMask of the current patch (sxMask: the pairs rendered, incl. bus pairs still draining after their last send was
    // switched off; sxReal: the patch's own mask; sxRel / sxRelN: the draining bus bits and their frames left); bus pairs
    // rendered in the last span (bits 4, 8)
    this.sxMask = 1; this.sxBusOn = 0; this.sxReal = 1; this.sxRel = 0; this.sxRelN = 0; this.sxRelT = 0;
    this.b1Lb = new Float64Array(128); this.b1Rb = new Float64Array(128); this.b2Lb = new Float64Array(128); this.b2Rb = new Float64Array(128);
    this.setOS(os);
    this.chorus = new Chorus(this.base); this.ens = new Ensemble(this.base);
    this.monoBuf = new Float64Array(128); this.Lb = new Float64Array(128); this.Rb = new Float64Array(128); this.act = 0;
    this.dLb = new Float64Array(128); this.dRb = new Float64Array(128); this.osG = new Float64Array(128);
    // the FX rack of this track (any model): after the built-in chorus / ensemble, before the limiter (§1, §11.5) — the
    // Chain's (a classic Inst feeds it as the track's shared panel, a Serum Inst holds it as its own FX, §6.2)
    this.rack = rack;
    this.dacHold = 0; this.dacT = 0; this.dacPend = 0;
    this.osPend = 0; this.osR = 1; this.osHold = 0; // pending oversampling change: fade ramp, frames held at zero
    this.kind = '';
    this.setPatch(DEFAULT_PATCH);
    this.quietF = 0; // frames since anything last sounded (the idle skip, §6.4: per Inst)
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
    // SPEC-serum2 §12.2: the voices' OS-rate outputs sxOut = {L, R, dL, dR, b1L, b1R, b2L, b2R} (L/R/dL/dR are the
    // Phase-1 buffers); the bus pairs' decimator chains are built when CP.outMask first needs them (sxChains)
    this.bufB1L = new Float64Array(128 * os); this.bufB1R = new Float64Array(128 * os);
    this.bufB2L = new Float64Array(128 * os); this.bufB2R = new Float64Array(128 * os);
    this.sxOut = { L: this.buf, R: this.bufR, dL: this.bufDL, dR: this.bufDR, b1L: this.bufB1L, b1R: this.bufB1R, b2L: this.bufB2L, b2R: this.bufB2R };
    this.decB1L = this.decB1R = this.decB2L = this.decB2R = null;
    this.sxChains();
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
    this.tailB1L = new Float64Array(this.fadeN); this.tailB1R = new Float64Array(this.fadeN); // … and their bus pairs (§12.2: tails ×8)
    this.tailB2L = new Float64Array(this.fadeN); this.tailB2R = new Float64Array(this.fadeN); this.tailBus = 0;
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
      const salt = this.salt; // §6.2.1: an Inst other than the primary draws its own streams
      if (salt !== 0) for (const v of this.voices) if (typeof v.r === 'number') v.r = ((v.r ^ salt) >>> 0) || 1;
      if (kind === 'divide' && !this.div) this.div = new Divide(this);
      this.clrHeld();
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
    if (this.rack && this.sharedRack === 0) { this.rack.set(p.fxr || null, p.fxrT); this.fxOver(); } // (a shared panel: {t: 'chain'})
    if (was === 'serum') { // left Serum: no FX modulation, no curve tables, no sequencer, back to the app's oversampling
      if (this.sxW) { const SD = globalThis.SerumDSP; if (SD) SD.warmEnd(this); this.sxW = 0; }
      this.sxWK = '';
      if (this.rack) this.rack.setMods(null);
      this.ct = null;
      this.sqOff();
      this.sxMask = 1; this.sxReal = 1; this.sxRel = 0; this.sxRelN = 0;
      this.reqOS(this.hostOS);
    }
    if (keep) for (const [kn, kv] of keep) this.noteOn(kn, kv);
  }
  // Serum patch (§11.3): 32 voices built once on the kind change and never rebuilt (POLY and mono / poly changes
  // only change which voices are addressed); the processor runs at Serum's own oversampling (§11.4)
  setSerum(p, old) {
    const SD = globalThis.SerumDSP, was = this.kind === 'serum' && !!this.voices;
    // CP v2 outMask: 1 main · 2 direct · 4 bus 1 · 8 bus 2 (§4.1). A bus pair whose last send was switched off while voices
    // sound is released, not cut: this patch keeps its bit (and the send stage, CP.use 64) so every voice ramps its send
    // to 0 over one chunk as for any send change, and the pair drains through its decimators for 256 frames before it is
    // dropped (sxRel). Only the engine's copy of the CP carries the bits.
    const real = p.serum && p.serum.outMask >= 0 ? (p.serum.outMask | 0) & 15 : 1;
    let rel = 0;
    if (was && p.serum && typeof p.serum === 'object' && this.anyActive()) rel = ((this.sxReal & 12) | (this.sxRelN > 0 ? this.sxRel : 0)) & ~real & 12;
    this.sxReal = real;
    if (rel !== 0) {
      const cq = Object.assign({}, p.serum);
      cq.outMask = real | rel; cq.use = (cq.use | 0) | 64;
      p = Object.assign({}, p); p.serum = cq;
      if ((this.sxRel & rel) !== rel || this.sxRelN <= 0) { this.sxRelN = 256; this.sxRelT = this.base; }
      this.sxRel = rel;
    } else { this.sxRel = 0; this.sxRelN = 0; }
    const cp = p.serum;
    let keep = null;
    if (!was) {
      this.allOff(true); // fades out with the old patch before anything is torn down
      this.p = p;
      this.kind = 'serum';
      this.voices = [];
      if (SD) { // per-processor Serum state (idempotent); the voices follow below; no SerumDSP: a silent track
        SD.attach(this);
        this.sx.mon = this.mon ? 1 : 0;
      }
      this.clrHeld();
      this.chorus.mode = 0; this.ens.on = 0;
    } else {
      if ((old.mode === 'poly') !== (p.mode === 'poly')) { // mono <-> poly: the notes still gated are re-struck
        keep = this.sxKeep(old.mode !== 'poly');
        this.allOff(false);
      }
      this.p = p;
    }
    const vs = this.voices, nUse = p.mode === 'poly' ? Math.max(1, Math.min(SXV, Math.round(p.poly) || 1)) : 1;
    if (nUse < this.sxUse) for (let i = nUse; i < vs.length; i++) if (vs[i].gate) { vs[i].sus = false; vs[i].noteOff(); }
    this.sxUse = nUse;
    this.sxOne = cp && cp.oneNote ? 1 : 0;
    // the pairs in use are rendered, decimated and handed to the rack separately, the others are never touched (§14.1
    // cheap bypass)
    this.sxMask = real | rel;
    this.sxDir = (this.sxMask & 2) ? 1 : 0;
    this.sxChains();
    // voices are built up to the highest POLY so far (at most SXV) and never rebuilt; building all 32 at once cost up
    // to 1.5 ms of the shared audio thread. Voices above POLY are spare: never addressed, no filter delay lines.
    if (SD) while (vs.length < nUse) vs.push(new SD.SerumVoice(this, vs.length));
    for (let i = 0; i < vs.length; i++) { vs[i].spare = i >= nUse ? 1 : 0; vs[i].apply(p); }
    this.sqApply(p);
    if (this.rack && this.sharedRack === 0) { this.rack.set(p.fxr || null, p.fxrT); this.fxOver(); }
    // master volume (g.master, pow3 law) and Bypass belong to the rack's output stage (deviation 3); without fx-dsp the
    // engine applies their base values itself, read at FX-context [0] / [1] of the FXP v2 base (SPEC-serum2 §4.2, §12.5)
    const fb = p.fxr && p.fxr.ver >= 2 && p.fxr.base, ok = !!fb && fb.length >= 8, mn = ok ? +fb[0] : 1, by = ok ? +fb[1] : 0;
    this.nfT = by >= 0.5 ? 0 : mn > 0 ? (mn < 1 ? mn * mn * mn : 1) : 0;
    if (!this.tailN && !this.tailSN && !this.tailDN && !this.anyActive()) this.nfG = this.nfT; // silent: no ramp needed
    this.bend = this.bendRaw * (p.bendRange || 2);
    this.smTargets();
    const os = this.sxOS(p);
    if (os !== this.OS || this.osPend) this.reqOS(os);
    if (keep) this.sxRestrike(keep);
    this.sxArm();
  }
  // §11.10: hidden voices warm the code up on the patch while the track is silent — the first patch of the processor and
  // every later one whose shape (SerumDSP.warmKey: oscillator types, warp modes, filter types) differs from the one last
  // warmed here (a preset change: its first chord would meet JIT-cold code); a warm-up of an older shape restarts. While
  // voices sound the patch's code runs anyway (the shape counts as warmed). Never offline.
  sxArm() {
    const SD = globalThis.SerumDSP;
    if (!SD || !SD.warmStart || !SD.warmKey || this.offline || !this.sx) return;
    const k = SD.warmKey(this);
    if (k === '' || k === this.sxWK) return;
    this.sxWK = k;
    if (this.anyActive()) { if (this.sxW) { SD.warmEnd(this); this.sxW = 0; } return; }
    if (this.sxW) SD.warmEnd(this);
    SD.warmStart(this); this.sxW = 1;
  }
  // lazy warm-up jobs still queued on this processor (SxBase.warmAdd: Granular, Spectral FFT, §11.10)
  sxLazy() { const W = this.sxWarm; return W && W.q ? W.q.length - W.h : 0; }
  // mono <-> poly while notes sound (§12.3): the notes reaching the allocator that are still gated, in the order they were
  // struck, as [note, velocity, channel, gen, x, y, z] … — the allocator's own view (after the sequencer and the keyboard
  // transpose), so the re-strike below must not pass through either again
  sxKeep(fromMono) {
    const out = [];
    if (fromMono) {
      const v0 = this.voices[0], vel = v0 ? v0.vel : 0.8, h = this.held, hc = this.heldC, he = this.heldE;
      for (let i = 0; i < h.length; i++) {
        const g = i < hc.length;
        out.push(h[i], vel, g ? hc[i] : 0, g ? he[4 * i] : 0, g ? he[4 * i + 1] : 0, g ? he[4 * i + 2] : 0, g ? he[4 * i + 3] : 0);
      }
      return out;
    }
    const vs = this.voices.filter(x => x.gate && !x.sus).sort((x, y) => x.stamp - y.stamp);
    for (const x of vs) {
      const e = x.ex;
      out.push(x.note, x.vel, x.ch | 0, e ? 1 : 0, e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
    }
    return out;
  }
  // re-strikes them straight into the allocator with their channel and expression: the sequencer's and the input's
  // records (held keys, transpositions) stay as they are, so their note-offs still find these voices
  sxRestrike(k) {
    for (let i = 0; i + 6 < k.length; i += 7) this.sxNote(1, k[i], k[i + 1], k[i + 2], k[i + 4], k[i + 5], k[i + 6], k[i + 3]);
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
  // the bus pairs' decimator chains for the pairs CP.outMask uses: built once per oversampling (allocation in setPatch /
  // setOS only) and kept while unused, so switching a send on and off never allocates on the render path
  sxChains() {
    const m = this.sxMask | 0, os = this.OS;
    if ((m & 4) !== 0 && this.decB1L === null) { this.decB1L = decChain(os); this.decB1R = decChain(os); }
    if ((m & 8) !== 0 && this.decB2L === null) { this.decB2L = decChain(os); this.decB2R = decChain(os); }
  }
  // the sequencer of a Serum patch (§7.7, §12.3): SxSeq.Seq made once per processor, applied with every patch (the
  // seqT parts the host sent with it are merged). Without SxSeq (load failure, §0.3) notes are played directly and the
  // engine applies the keyboard transpose itself.
  sqApply(p) {
    const q = p.seq, SQ = globalThis.SxSeq;
    if (!q || typeof q !== 'object') { this.sqOff(); return; }
    if (this.sxSeq === null && SQ) { try { this.sxSeq = new SQ.Seq(this); } catch (err) { this.sxSeq = null; } }
    if (this.sxSeq !== null) {
      let ok = false;
      try { ok = this.sxSeq.apply(q, p.seqT || null); } catch (err) { ok = false; }
      this.sqOn = ok && q.active ? 1 : 0; this.sqTr = 0;
    } else {
      const k = q.kbd, t = q.active && k && k.length > 0 ? Math.round(+k[0]) : 0;
      this.sqOn = 0; this.sqTr = t >= -48 && t <= 48 ? t : 0;
    }
  }
  // no sequencer any more (model switch, panic of a patch without SQP): everything it generated stops, clip lanes release
  sqOff() {
    if (this.sxSeq !== null) { try { this.sxSeq.panic(); } catch (err) { /* a failed sequencer only loses its notes */ } }
    this.sqOn = 0; this.sqTr = 0; this.seqMacro.fill(NaN); this.sxTr.fill(-1);
  }
  // §8.5: instances the rack left unallocated and bypassed by its 32 MB cap — the host names them in a notice (posted when
  // the list changes)
  fxOver() {
    const o = this.rack && Array.isArray(this.rack.over) ? this.rack.over : null, k = o && o.length ? o.join(',') : '';
    if (k === this.overK) return;
    this.overK = k;
    if (k) this.port.postMessage(this.T.graphed === 1 ? { t: 'fxover', ids: o.slice(), i: this.id } : { t: 'fxover', ids: o.slice() });
  }
  // the frame an event handled now belongs to: the current span inside process(), else the next render quantum
  nowF() { return this.T.nowF(); } // (§6.2: the Track's)
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
  // SPEC-serum2 §12.2: every output pair of CP.outMask has its own tail (×8); bus tails of a pair no longer in use when
  // they are mixed are folded into the main pair (as the Phase-1 direct tail).
  fadeSerum(list) {
    let any = false;
    for (const v of list) if (v.active) { any = true; break; }
    if (!any) return;
    const M = this.fadeN, PC = 128 * this.OS, m = this.sxMask, dir = (m & 2) !== 0, b1 = (m & 4) !== 0, b2 = (m & 8) !== 0, O = this.sxOut;
    const L = this.buf, R = this.bufR, DL = this.bufDL, DR = this.bufDR;
    const B1L = this.bufB1L, B1R = this.bufB1R, B2L = this.bufB2L, B2R = this.bufB2R;
    const tL = this.tailL, tR = this.tailR, tDL = this.tailDL, tDR = this.tailDR;
    const t1L = this.tailB1L, t1R = this.tailB1R, t2L = this.tailB2L, t2R = this.tailB2R;
    if (!this.tailSN) { // a spent tail leaves its samples behind
      tL.fill(0); tR.fill(0); tDL.fill(0); tDR.fill(0);
      if (this.tailBus) { t1L.fill(0); t1R.fill(0); t2L.fill(0); t2R.fill(0); this.tailBus = 0; }
    } else if (this.tailSP) {
      const P = this.tailSP, E = P + this.tailSN;
      tL.copyWithin(0, P, E); tR.copyWithin(0, P, E); tDL.copyWithin(0, P, E); tDR.copyWithin(0, P, E);
      tL.fill(0, this.tailSN); tR.fill(0, this.tailSN); tDL.fill(0, this.tailSN); tDR.fill(0, this.tailSN);
      if (this.tailBus) {
        t1L.copyWithin(0, P, E); t1R.copyWithin(0, P, E); t2L.copyWithin(0, P, E); t2R.copyWithin(0, P, E);
        t1L.fill(0, this.tailSN); t1R.fill(0, this.tailSN); t2L.fill(0, this.tailSN); t2R.fill(0, this.tailSN);
      }
      this.tailSP = 0;
    }
    if ((b1 || b2) && !this.tailBus) { t1L.fill(0); t1R.fill(0); t2L.fill(0); t2R.fill(0); this.tailBus = 1; }
    for (let o = 0; o < M; o += PC) {
      const n = Math.min(PC, M - o);
      L.fill(0, 0, n); R.fill(0, 0, n);
      if (dir) { DL.fill(0, 0, n); DR.fill(0, 0, n); }
      if (b1) { B1L.fill(0, 0, n); B1R.fill(0, 0, n); }
      if (b2) { B2L.fill(0, 0, n); B2R.fill(0, 0, n); }
      for (const v of list) if (v.active) v.render(O, n);
      for (let i = 0; i < n; i++) {
        const w = 0.5 + 0.5 * Math.cos(Math.PI * (o + i) / M);
        tL[o + i] += L[i] * w; tR[o + i] += R[i] * w;
        if (dir) { tDL[o + i] += DL[i] * w; tDR[o + i] += DR[i] * w; }
        if (b1) { t1L[o + i] += B1L[i] * w; t1R[o + i] += B1R[i] * w; }
        if (b2) { t2L[o + i] += B2L[i] * w; t2R[o + i] += B2R[i] * w; }
      }
    }
    if (this.tailSN < M) this.tailSN = M;
  }
  allOff(hard) {
    if (hard) this.fadeOut(null);
    if (this.voices) for (const v of this.voices) { v.noteOff(); v.sus = false; if (hard) v.kill(); }
    if (this.div) this.div.allOff(hard);
    this.audK.fill(0);
    this.clrHeld();
  }
  // the mono held-key list; for Serum each entry also keeps its MIDI channel (heldC) and [gen, x, y, z] (heldE): the
  // voice returning to a still-held note takes that note's channel and expression (§6.17)
  clrHeld() { this.held = []; this.heldC.length = 0; this.heldE.length = 0; this.monoGate = false; }
  glc(legato) {
    const p = this.p;
    if (p.glide > 0 && (!p.glideLegato || legato)) return 1 - Math.exp(-1 / (p.glide * 0.3 * this.fs / this.CH));
    return 1;
  }
  // the messages that address an instrument (Track.msg routes them, §6.8: controller state to every Inst, the rest to
  // Inst 0 — on a graph node the Inst they name, IMPL-1e §2.5); the case bodies as they were
  msg(d) {
    switch (d.t) {
      case 'patch': this.setPatch(d.p); break;
      // the panel's arp / clip launch and stop buttons (§7.7 commands, §12.4)
      case 'seqcmd': if (this.sxSeq !== null && this.kind === 'serum' && typeof d.cmd === 'string') this.sxSeq.cmd(d.cmd, d.arg); break;
      // seqT parts without a patch (§4.4, §12.4): {t: 'sqt', part} or {t: 'sqt', parts: {name: part}}
      case 'sqt':
        if (this.sxSeq !== null && this.kind === 'serum') {
          if (d.part && typeof d.part === 'object') this.sxSeq.merge(d.part);
          else if (d.parts && typeof d.parts === 'object') for (const k in d.parts) this.sxSeq.merge(d.parts[k]);
        }
        break;
      case 'pat': if (d.n >= 0 && d.n < 128) { this.pat[d.n | 0] = +d.v || 0; this.patSeen = true; } break; // poly pressure
      // CT v2 parts without a patch (§4.1, §12.4): {t: 'ct', key, parts} — any subset of the parts, merged by SerumDSP —
      // or one part {t: 'ct', key, name, part}
      case 'ct':
        if (this.kind === 'serum') {
          let parts = null;
          if (d.parts && typeof d.parts === 'object') parts = d.parts;
          else if (typeof d.name === 'string' && d.part && typeof d.part === 'object') { parts = {}; parts[d.name] = d.part; }
          if (parts !== null) {
            this.ct = { key: typeof d.key === 'string' ? d.key : this.ct && typeof this.ct.key === 'string' ? this.ct.key : '', parts };
            // the patch stays: its CP names the CT it was compiled with, which these parts replace
            const cp = this.p && this.p.serum;
            if (cp && typeof cp === 'object' && typeof d.key === 'string') cp.ctKey = d.key;
          }
        }
        break;
      // MPE expression of a member channel (§6.17, §12.4): k 'b' bend −1…1, 'y' CC74, 'z' pressure, 'x' CC10 −1…1
      case 'mpe': {
        const c = d.ch, k = d.k === 'b' ? 0 : d.k === 'y' ? 1 : d.k === 'z' ? 2 : d.k === 'x' ? 3 : -1, v = +d.v;
        if (k >= 0 && c >= 0 && c <= 16 && c === Math.floor(c)) this.mpe[c * 4 + k] = v === v ? v : 0;
        break;
      }
      // the rack's monitor tap (§13.5 Delay spectrum overlay): instance id, '' = off; sent with the monitor message
      case 'fxtap': if (this.rack && typeof this.rack.setTap === 'function') this.rack.setTap(typeof d.id === 'string' ? d.id : ''); break;
      case 'bend': this.bendRaw = d.v; this.bend = d.v * (this.p.bendRange || 2); break;
      case 'wheel': this.wheel = d.v; break;
      case 'at': this.at = d.v; break;
      case 'sus':
        // while the arpeggiator is on, CC64 latches it instead of holding voices (§7.4.5, §12.3); a pedal release
        // always reaches the sequencer (its pedal latch may date from before the arp was switched off)
        if (this.sxSeq !== null && this.kind === 'serum') {
          const sq = this.sxSeq;
          if (d.v && this.sqOn === 1 && sq.arpOn === 1) { sq.cmd('latch', 1); break; }
          if (!d.v) sq.cmd('latch', 0);
        }
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
      case 'seq': this.seqMsg(d.s); break;
    }
  }
  // the Inst's part of a panic after its notes stopped (Track.panic): sequencer notes, Serum state
  panicSx() {
    if (this.sxSeq !== null) { this.sxSeq.panic(); this.sxTr.fill(-1); } // held / latched / generated notes cleared (§7.8)
    const SD = globalThis.SerumDSP;
    if (SD && this.sx) SD.reset(this);
  }
  // nothing of this Inst can sound: no de-click tail, quiet for 2 s, its FX idle (Track.panic)
  isQuiet() { return !this.tailN && !this.tailDN && !this.tailSN && this.quietF > this.base * 2 && (!this.rack || this.rack.idle()); }
  panicClear() { // (Track.panicClear: after the output fade)
    this.tailN = this.tailP = this.tailSN = this.tailSP = this.tailDN = this.tailDP = 0; this.tailBus = 0;
    this.dacHold = this.dacPend = 0; this.dacLive = false;
    this.chorus.reset(); this.chorus.snap(); this.ens.reset(); this.ens.snap();
    if (this.rack) this.rack.reset(false);
  }
  // ch: MIDI channel of an MPE note (0 = none); ext: a note delivered by another track's MIDI OUT (§7.9, never forwarded);
  // aud: a preview (R7 B5). Poly: a preview reuses / takes only its own voices or free / released ones (none left: it is
  // not heard), the song and the keys never reuse a preview's voice and steal one before their own; mono models as before
  noteOn(n, v, ch, ext, aud) {
    const p = this.p, a = aud ? 1 : 0;
    this.lastNote = n; this.nOn = ++this.T.nOnK;
    if (this.kind === 'serum') { // §12.3: through the sequencer while it is active, else to the allocator
      const c = ch > 0 && ch <= 16 ? ch | 0 : 0, q = c === 0 && n >= 0 && n <= 127 && n === Math.floor(n) ? n : -1;
      if (this.sqOn === 1) {
        // R7 B5: the sequencer keeps one record per key — a preview of a key it already holds is not sent (the key is
        // down once: the song's note keeps sounding); the song / the keys striking a key a preview holds share it
        const sq = this.sxSeq, held = q >= 0 && sq.rF !== undefined && (sq.rF[q] & 1) !== 0; // (rF & 1: R_REC)
        if (a && q >= 0) { if (held) { this.audK[q] = 2; return; } this.audK[q] = 1; }
        else if (!a && q >= 0 && this.audK[q] === 1) this.audK[q] = held ? 4 : 2; // (2: the preview's record is gone)
        sq.input(1, n, v, c, this.nowF(), ext ? 1 : 0);
      } else { if (a && q >= 0) this.audK[q] = 3; this.sxIn(1, n, v, c, a); }
      return;
    }
    if (this.rack) this.rack.trigger(); // Hyper RETRIG
    if (!this.anyActive()) { this.smTargets(); this.smSnap(); } // nothing sounding: start at the panel values
    if (this.kind === 'divide') { if (a) this.audK[n] = 1; this.div.noteOn(n); return; } // (a key: up when both let go)
    if (p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i >= 0) this.held.splice(i, 1);
      this.held.push(n);
      this.monoPlay(v, true);
      return;
    }
    const own = this.vOwn;
    let vc = null;
    if (this.kind !== 'fm') { for (const x of this.voices) if (x.active && x.note === n && own[x.i] === a) { vc = x; break; } }
    else for (const x of this.voices) if (x.gate && !x.sus && x.note === n && own[x.i] === a) x.noteOff(); // DX7: a repeated key gets a voice of its own
    if (!vc) {
      let best = null;
      for (const x of this.voices) if (!x.active && (!best || x.stamp < best.stamp)) best = x;
      if (!best) for (const x of this.voices) if (!x.gate && (!best || x.stamp < best.stamp)) best = x;
      if (!best && a) { for (const x of this.voices) if (own[x.i] === 1 && (!best || x.stamp < best.stamp)) best = x; if (!best) return; }
      if (!best) for (const x of this.voices) if (x.sus && (!best || x.stamp < best.stamp)) best = x; // pedal-held before key-held
      if (!best) for (const x of this.voices) if (own[x.i] === 1 && (!best || x.stamp < best.stamp)) best = x; // previews first
      if (!best) for (const x of this.voices) if (!best || x.stamp < best.stamp) best = x;
      vc = best;
      if (vc.active && this.kind === 'fm') { this.fadeOut([vc]); vc.kill(); } // operator key sync would cut a sounding voice
    }
    vc.stamp = ++this.stamp; own[vc.i] = a;
    vc.noteOn(n, v, false, this.glc(false));
  }
  // R7 B5: the song holds note n (its note-off is still due)
  songHas(n) { return this.T.songHas(n); } // (§6.2: the Track's)
  // A Serum note that bypasses the sequencer (inactive, or SxSeq missing: then the keyboard transpose kbd.trans is
  // applied here, §7.1, and the note-off releases the note its note-on started); a: the preview owner (noteOn / noteOff)
  sxIn(on, n, v, ch, a) {
    const k = n >= 0 && n <= 127 && n === Math.floor(n) ? ch * 128 + n : -1;
    if (on) {
      const m = n + this.sqTr;
      if (this.sqTr !== 0 && !(m >= 0 && m <= 127)) { if (k >= 0) this.sxTr[k] = -2; return; } // out of range: dropped
      if (k >= 0) this.sxTr[k] = this.sqTr !== 0 ? m : -1;
      this.sxNote(1, m, v, ch, 0, 0, 0, 0, a);
      return;
    }
    let m = n;
    if (k >= 0) { const r = this.sxTr[k]; this.sxTr[k] = -1; if (r === -2) return; if (r >= 0) m = r; }
    this.sxNote(0, m, v, ch, 0, 0, 0, 0, a);
  }
  // The Serum voice allocator (§12.3) — every note reaching the voices goes through here: input notes and the notes the
  // sequencer generates (gen 1, with expression x, y, z ∈ [0, 1] used by a voice without an MPE channel). Poly:
  // SerumDSP.allocate over voices[0 … POLY−1] (same-note reuse with "one of any note number", then inactive, not gated,
  // sustain-held, then the Voice Steal Priority); mono plays voices[0] (the voice does portamento, legato and unison
  // itself). The rack's RETRIG modules restart at every voice note-on (§8.1). a: a preview (R7 B5, poly): its own voice
  // (sxAud), never one the allocator would take from the song or the keys; its note-off (a 1 / 2, noteOff) as sxOff
  sxNote(on, n, vel, ch, x, y, z, gen, a) {
    const vs = this.voices;
    if (!on) { this.sxOff(n, vel, ch, a); return; }
    if (this.rack) this.rack.trigger();
    if (!vs || !vs.length) return; // SerumDSP missing: a silent track
    if (this.sxW) { const SD = globalThis.SerumDSP; if (SD) SD.warmEnd(this); this.sxW = 0; } // real notes now
    const c = ch > 0 && ch <= 16 ? ch | 0 : 0;
    if (this.p.mode !== 'poly') { // a held entry per (note, channel), with its expression (monoPlay sounds it)
      const h = this.held, hc = this.heldC, he = this.heldE, i = this.heldAt(n, c);
      if (i >= 0) { h.splice(i, 1); hc.splice(i, 1); he.splice(4 * i, 4); }
      h.push(n); hc.push(c);
      if (gen) he.push(1, x, y, z); else he.push(0, 0, 0, 0);
      this.monoPlay(vel, true);
      return;
    }
    const SD = globalThis.SerumDSP, nUse = this.sxUse < vs.length ? this.sxUse : vs.length;
    let vc = null;
    if (a) { if (!SD || !SD.allocate || SD.allocate(this, n, c, nUse)) vc = this.sxAud(n, c, nUse); } // (allocate: an unmapped key)
    else if (SD && SD.allocate) vc = SD.allocate(this, n, c, nUse);
    else { // (a SerumDSP without allocate: the Phase-1 rule)
      if (this.sxOne) for (let i = 0; i < nUse; i++) { const w = vs[i]; if (w.active && w.note === n) { vc = w; break; } }
      if (!vc) {
        let best = null;
        for (let i = 0; i < nUse; i++) { const w = vs[i]; if (!w.active && (!best || w.stamp < best.stamp)) best = w; }
        if (!best) for (let i = 0; i < nUse; i++) { const w = vs[i]; if (!w.gate && (!best || w.stamp < best.stamp)) best = w; }
        if (!best) for (let i = 0; i < nUse; i++) { const w = vs[i]; if (w.sus && (!best || w.stamp < best.stamp)) best = w; }
        if (!best) for (let i = 0; i < nUse; i++) { const w = vs[i]; if (!best || w.stamp < best.stamp) best = w; }
        vc = best;
      }
    }
    if (!vc) return; // a key the tuning leaves unmapped (§6.18); a preview without a voice of its own
    vc.stamp = ++this.stamp; this.vOwn[vc.i] = a ? 1 : 0;
    let ex = null;
    if (gen) { ex = this.sxExA[vc.i >= 0 && vc.i < SXV ? vc.i : 0]; ex[0] = x; ex[1] = y; ex[2] = z; }
    if (c === 0 && ex === null) vc.noteOn(n, vel, false, 1);
    else vc.noteOn(n, vel, false, 1, c, ex);
  }
  // Serum note-off (rv = release velocity): mono as Phase 1; poly releases the gated voices of (note, channel) its owner
  // holds (a as noteOff: 0 the song / keys, 1 a preview, 2 a preview whose note the song does not hold)
  sxOff(n, rv, ch, a) {
    const p = this.p, c = ch > 0 && ch <= 16 ? ch | 0 : 0;
    if (p.mode !== 'poly') {
      const i = this.heldAt(n, c); if (i < 0) return;
      const v0 = this.voices[0], wasTop = v0 && v0.note === n && (v0.ch | 0) === c;
      this.held.splice(i, 1); this.heldC.splice(i, 1); this.heldE.splice(4 * i, 4);
      if (this.held.length) { if (wasTop) this.monoPlay(this.voices[0].vel, false); }
      else if (!this.sustain) {
        this.monoGate = false;
        if (this.voices.length) this.voices[0].noteOff(rv);
      }
      return;
    }
    const own = this.vOwn, o = a ? 1 : 0;
    let k = 0;
    for (const x of this.voices) if (x.gate && x.note === n && (x.ch | 0) === c && own[x.i] === o) { if (this.sustain) x.sus = true; else x.noteOff(rv); k++; }
    if (k === 0 && a === 2) for (const x of this.voices) if (x.gate && x.note === n && (x.ch | 0) === c) { if (this.sustain) x.sus = true; else x.noteOff(rv); }
  }
  // R7 B5: a Serum preview's voice among voices[0 … U−1] — its own of (n, c) with "one of any note number", else free (lowest
  // stamp), released, then its own oldest; null when every other voice is held by the song or the keys
  sxAud(n, c, U) {
    const vs = this.voices, own = this.vOwn;
    let best = null;
    if (this.sxOne) for (let i = 0; i < U; i++) { const w = vs[i]; if (w.active && w.note === n && (w.ch | 0) === c && own[w.i] === 1) return w; }
    for (let i = 0; i < U; i++) { const w = vs[i]; if (!w.active && (!best || w.stamp < best.stamp)) best = w; }
    if (!best) for (let i = 0; i < U; i++) { const w = vs[i]; if (!w.gate && (!best || w.stamp < best.stamp)) best = w; }
    if (!best) for (let i = 0; i < U; i++) { const w = vs[i]; if (own[w.i] === 1 && (!best || w.stamp < best.stamp)) best = w; }
    return best;
  }
  // Serum's held entry of (note n, channel c), the most recent one; −1 when none
  heldAt(n, c) {
    const h = this.held, hc = this.heldC;
    for (let i = h.length - 1; i >= 0; i--) if (h[i] === n && (i < hc.length ? hc[i] : 0) === c) return i;
    return -1;
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
    if (this.kind === 'serum') {
      // the entry sounded (the most recent one of note n): its channel and expression, not the last note-on's (§6.17)
      const i = p.prio === 'low' || p.prio === 'high' ? h.lastIndexOf(n) : h.length - 1, hc = this.heldC, he = this.heldE;
      if (i >= 0 && i < hc.length) {
        this.monoCh = hc[i];
        if (he[4 * i] === 1) { const e = this.sxExA[0]; e[0] = he[4 * i + 1]; e[1] = he[4 * i + 2]; e[2] = he[4 * i + 3]; this.monoEx = e; } else this.monoEx = null;
      } else { this.monoCh = 0; this.monoEx = null; }
      const x = this.voices[0];
      if (x) { if (this.monoCh === 0 && this.monoEx === null) x.noteOn(n, fresh ? v : x.vel, legato, g); else x.noteOn(n, fresh ? v : x.vel, legato, g, this.monoCh, this.monoEx); }
    }
    else for (const x of this.voices) x.noteOn(n, fresh ? v : x.vel, legato, g);
    this.monoGate = true;
  }
  // rv: release velocity (MIDI note-off, 0–1), passed to the Serum voices it releases (§11.3); ch, ext as noteOn. A
  // Serum note-off goes to the sequencer while it is active or still holds input keys (they were transposed / held by it).
  // aud (R7 B5): a preview's note-off releases the preview's poly voices of n; when it has none (never heard, or re-struck
  // by a patch change) any voice of n unless the song holds n — the song's and the keys' note-offs never release a preview
  noteOff(n, rv, ch, ext, aud) {
    const p = this.p, a = aud ? (this.songHas(n) ? 1 : 2) : 0;
    if (this.kind === 'divide') { // the key stays down while the other owner (preview / song) still holds it
      if (a) { if (!this.audK[n]) return; this.audK[n] = 0; if (a === 1) return; } else if (this.audK[n]) return;
      this.div.gate[n] = this.sustain && this.div.gate[n] ? 2 : 0; return;
    }
    if (this.kind === 'serum') {
      // a preview's note-off goes where its note-on went (audK); the song's / the keys' leave a key a preview still holds
      // down, and skip the sequencer when its record of the key is the preview's (their note-on went to the allocator)
      const c = ch > 0 && ch <= 16 ? ch | 0 : 0, sq = this.sxSeq, q = c === 0 && n >= 0 && n <= 127 && n === Math.floor(n) ? n : -1;
      const k = q >= 0 ? this.audK[q] : 0;
      if (a) { // (k 0: no route kept — a mono / poly switch cleared it — the rule below)
        if (q >= 0) this.audK[q] = 0;
        if (k === 2 || k === 4) return; // the sequencer's key is the song's / the keys'
        if (k === 3 || sq === null || (k === 0 && this.sqOn !== 1 && sq.heldN <= 0)) this.sxIn(0, n, rv, c, a);
        else sq.input(0, n, rv, c, this.nowF(), ext ? 1 : 0);
        return;
      }
      if (k === 4) { this.audK[q] = 1; return; } // the preview still holds the key
      if (k === 1) { this.sxIn(0, n, rv, c, 0); return; }
      if (sq !== null && (this.sqOn === 1 || sq.heldN > 0)) sq.input(0, n, rv, c, this.nowF(), ext ? 1 : 0);
      else this.sxIn(0, n, rv, c, a);
      return;
    }
    if (p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i < 0) return;
      const wasTop = this.voices[0] && this.voices[0].note === n;
      this.held.splice(i, 1);
      if (this.held.length) { if (wasTop) this.monoPlay(this.voices[0].vel, false); }
      else if (!this.sustain) {
        this.monoGate = false;
        for (const x of this.voices) x.noteOff();
      }
      return;
    }
    const own = this.vOwn, o = a ? 1 : 0;
    let k = 0;
    for (const x of this.voices) if (x.gate && x.note === n && own[x.i] === o) { if (this.sustain) x.sus = true; else x.noteOff(); k++; }
    if (k === 0 && a === 2) for (const x of this.voices) if (x.gate && x.note === n) { if (this.sustain) x.sus = true; else x.noteOff(); }
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
  /* ---- song playback: the Track's (below); the Inst's song position and transport hook ---- */
  tickAt(F) { const tp = this.tp; return tp.tick + (F - tp.frame) / tp.fpt; }
  // Serum host fields (§8.4.1): the song tempo while the transport plays, else the patch's; the song position in
  // beats at the start of the current span, or null when stopped
  get bpm() { const tp = this.tp; return tp && tp.play ? 60 * this.base / (tp.fpt * 960) : this.p && this.p.bpm > 0 ? this.p.bpm : 120; }
  songBeat() { return this.T.songBeat(); } // (§6.2: the Track's)
  // play with seek (playing) / stop: Serum's host-synced state and the rack's LFO phases restart, so a song rendered
  // from a given tick is identical live and offline (§6.16, §8.5.2)
  transportHook(playing) {
    const SD = globalThis.SerumDSP;
    if (SD && this.kind === 'serum' && this.sx) SD.transport(this, playing);
    if (this.sxSeq !== null && this.kind === 'serum') this.sxSeq.transport(playing); // §7.8
    if (playing && this.rack) this.rack.transport();
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
    this.port.postMessage(this.T.graphed === 1 ? { t: 'step', s: step, i: this.id } : { t: 'step', s: step });
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
  sxVoices() { // oscillator voices sounding (Serum's voice counter)
    const SD = globalThis.SerumDSP, s = SD && this.sx ? SD.snapshot(this) : null;
    return s ? s.oscVoices : 0;
  }
  // An oversampling change rebuilds the decimators (empty history) and shifts the group delay, so it is made at
  // silence: the voice mix fades out (~4 ms raised cosine), the switch happens at zero, the output stays muted
  // while the new decimators fill (~1.7 ms), then fades back in. Applied before the chorus / ensemble, so their
  // delay lines never hold the gap.
  osFade(n, a, b, c, d, e, f, k, l) { // channels b … l optional (Serum: L, R, the direct-out and bus pairs share one ramp)
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
    if (e) for (let i = 0; i < n; i++) { e[i] *= g[i]; f[i] *= g[i]; }
    if (k) for (let i = 0; i < n; i++) { k[i] *= g[i]; l[i] *= g[i]; }
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
  // one span of this Inst (§6.3): → 1 rendered into Lb / Rb (a Serum: through its own FX; a classic Inst: up to its
  // panel, which Track.renderSpan processes), 0 idle: skipped (§6.4, the Track then skips the output stage)
  renderSpan(n) {
    if (this.osPend && this.osR === 0) { this.setOS(this.osPend); this.osPend = 0; this.osHold = Math.ceil(this.base * 0.0017); }
    const OS = this.OS, N = n * OS, buf = this.buf, p = this.p;
    this.ctl += n / 4; // control ticks (rate independent), also counted while skipping: idle voices' EGs keep time
    // silent instrument: once every voice and effect tail has died away, skip the DSP entirely
    const any = this.tailN > 0 || this.tailDN > 0 || this.tailSN > 0 || this.T.pnN > 0 || this.sxW > 0 || this.anyActive() ||
      (this.kind === 'serum' && this.sxLazy() > 0);
    // (powered off, IMPL-1e §2.2: skipped as soon as its fade has ended)
    if (any) this.quietF = 0;
    else if (((this.quietF += n) > this.base * 2 || this.on === 0) && (!this.rack || this.rack.idle())) {
      this.act = 0;
      if (this.kind === 'serum') { const SD = globalThis.SerumDSP; if (SD && this.sx) SD.idle(this, n); } // LFOs, clocks, smoothers keep time
      return 0;
    }
    if (this.kind === 'serum') { this.renderSerum(n); return 1; }
    buf.fill(0, 0, N);
    if (this.tailN) { // de-click fade of voices that were stopped hard
      const k = Math.min(N, this.tailN), tl = this.tail, P = this.tailP;
      for (let i = 0; i < k; i++) buf[i] += tl[P + i];
      this.tailP += k; this.tailN -= k; if (!this.tailN) this.tailP = 0;
    }
    if (this.tailSN) { // Serum voices stopped hard by a model switch: their stereo fade, folded to mono
      const k = Math.min(N, this.tailSN), P = this.tailSP, tL = this.tailL, tR = this.tailR, tDL = this.tailDL, tDR = this.tailDR;
      for (let i = 0; i < k; i++) buf[i] += 0.5 * (tL[P + i] + tR[P + i] + tDL[P + i] + tDR[P + i]);
      if (this.tailBus) {
        const t1L = this.tailB1L, t1R = this.tailB1R, t2L = this.tailB2L, t2R = this.tailB2R;
        for (let i = 0; i < k; i++) buf[i] += 0.5 * (t1L[P + i] + t1R[P + i] + t2L[P + i] + t2R[P + i]);
      }
      this.tailSP += k; this.tailSN -= k; if (!this.tailSN) { this.tailSP = 0; this.tailBus = 0; }
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
    if (this.rack) this.rack.setNote(this.lastNote); // the track's FX rack (bypass-cheap when every module is off): its process, Track.renderSpan (§6.2)
    return 1;
  }
  // Serum span (§11.2; SPEC-serum2 §12.5): voices at the OS rate into sxOut (main pair, + the direct and bus pairs of
  // CP.outMask) → FX modulation → decimation of each used channel → oversampling fade → FX rack (buses, direct,
  // master, bypass) → DC block / limiter. Unused pairs are never touched (§14.1 cheap bypass).
  renderSerum(n) {
    const SD = globalThis.SerumDSP, N = n * this.OS, m = this.sxMask, dir = (m & 2) !== 0;
    const b1 = (m & 4) !== 0 && this.decB1L !== null, b2 = (m & 8) !== 0 && this.decB2L !== null;
    const L = this.buf, R = this.bufR, DL = this.bufDL, DR = this.bufDR;
    const B1L = this.bufB1L, B1R = this.bufB1R, B2L = this.bufB2L, B2R = this.bufB2R;
    L.fill(0, 0, N); R.fill(0, 0, N);
    if (dir) {
      DL.fill(0, 0, N); DR.fill(0, 0, N);
      if (!this.sxDirOn) { for (const c of [this.decDL, this.decDR]) for (const h of c) h.buf.fill(0); } // no stale history
    }
    this.sxDirOn = dir ? 1 : 0;
    if (b1) {
      B1L.fill(0, 0, N); B1R.fill(0, 0, N);
      if ((this.sxBusOn & 4) === 0) { for (const h of this.decB1L) h.buf.fill(0); for (const h of this.decB1R) h.buf.fill(0); }
    }
    if (b2) {
      B2L.fill(0, 0, N); B2R.fill(0, 0, N);
      if ((this.sxBusOn & 8) === 0) { for (const h of this.decB2L) h.buf.fill(0); for (const h of this.decB2R) h.buf.fill(0); }
    }
    this.sxBusOn = (b1 ? 4 : 0) | (b2 ? 8 : 0);
    if (this.tailN) { // the previous model's voices stopped hard (model switch)
      const k = Math.min(N, this.tailN), tl = this.tail, P = this.tailP;
      for (let i = 0; i < k; i++) { L[i] += tl[P + i]; R[i] += tl[P + i]; }
      this.tailP += k; this.tailN -= k; if (!this.tailN) this.tailP = 0;
    }
    if (this.tailSN) { // de-click fade of Serum voices that were stopped hard
      const k = Math.min(N, this.tailSN), P = this.tailSP, tL = this.tailL, tR = this.tailR, tDL = this.tailDL, tDR = this.tailDR;
      if (dir) for (let i = 0; i < k; i++) { L[i] += tL[P + i]; R[i] += tR[P + i]; DL[i] += tDL[P + i]; DR[i] += tDR[P + i]; }
      else for (let i = 0; i < k; i++) { L[i] += tL[P + i] + tDL[P + i]; R[i] += tR[P + i] + tDR[P + i]; }
      if (this.tailBus) { // bus tails: into their pair while it is in use, else folded into the main pair
        const t1L = this.tailB1L, t1R = this.tailB1R, t2L = this.tailB2L, t2R = this.tailB2R;
        const o1L = b1 ? B1L : L, o1R = b1 ? B1R : R, o2L = b2 ? B2L : L, o2R = b2 ? B2R : R;
        for (let i = 0; i < k; i++) { o1L[i] += t1L[P + i]; o1R[i] += t1R[P + i]; o2L[i] += t2L[P + i]; o2R[i] += t2R[P + i]; }
      }
      this.tailSP += k; this.tailSN -= k; if (!this.tailSN) { this.tailSP = 0; this.tailBus = 0; }
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
      const O = this.sxOut;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v.active) continue;
        v.render(O, N);
        act++;
      }
      // the hidden-voice warm-up and the lazy jobs of every patch (one step per quantum; a Granular job drops itself while
      // a voice sounds, the others are bounded steps, §11.10, §14.1 row q)
      // (one path whether or not the hidden voices still run: a branch first taken after a real note — the lazy jobs
      // left once warmEnd ended the hidden voices — deoptimised this whole function, V8)
      if (this.sxW !== 0 || this.sxLazy() > 0) { const left = SD.warmTick(this, N); if (left === 0) this.sxW = 0; }
      if (this.rack) {
        // FX-context offsets (§4.2) for the layout the matrix was compiled against (CP.fxKey; '' = compiled without an
        // FX state: no instance rows, the globals [0…4] apply to any layout); the recent pitch for key tracking (§12.5)
        const cp = this.p.serum, key = cp && typeof cp.fxKey === 'string' && cp.fxKey !== '' ? cp.fxKey : undefined;
        this.rack.setMods(SD.fxMods(this), key);
        this.rack.setNote(SD.recentPitch(this));
      }
    }
    this.act = act;
    const Lb = this.Lb, Rb = this.Rb, dLb = this.dLb, dRb = this.dRb;
    const b1Lb = this.b1Lb, b1Rb = this.b1Rb, b2Lb = this.b2Lb, b2Rb = this.b2Rb;
    this.decim(this.dec, L, Lb, n); this.decim(this.decR, R, Rb, n);
    if (dir) { this.decim(this.decDL, DL, dLb, n); this.decim(this.decDR, DR, dRb, n); }
    if (b1) { this.decim(this.decB1L, B1L, b1Lb, n); this.decim(this.decB1R, B1R, b1Rb, n); }
    if (b2) { this.decim(this.decB2L, B2L, b2Lb, n); this.decim(this.decB2R, B2R, b2Rb, n); }
    if (this.osPend || this.osR < 1) {
      this.osFade(n, Lb, Rb, dir ? dLb : null, dir ? dRb : null, b1 ? b1Lb : null, b1Rb, b2 ? b2Lb : null, b2Rb);
    }
    // snapshot meters (§6.20 mix[7…10]: Bus 1, Bus 2, Main, Direct). "The rack adds bus/main/direct": a rack with the
    // FXRack.mixPeaks(pk) hook reports them where it produces them (buses after their racks and faders, Main without the
    // Direct pair, Direct after its fader); without it (fx-dsp before the hook, or no rack) the engine's taps stand in:
    // the bus inputs and the direct pair before the rack, the whole output after it
    const mixHook = this.mon && this.rack !== null && typeof this.rack.mixPeaks === 'function';
    if (this.mon && !mixHook) {
      const pk = this.mixPk;
      if (b1) pk[0] = this.peak2(b1Lb, b1Rb, n, pk[0]);
      if (b2) pk[1] = this.peak2(b2Lb, b2Rb, n, pk[1]);
      if (dir) pk[3] = this.peak2(dLb, dRb, n, pk[3]);
    }
    if (this.rack) {
      const tf = Date.now(); // (its share of the load: the FX module's CPU, §6.8 stats.per)
      if (b1 || b2) this.rack.process(Lb, Rb, n, dir ? dLb : undefined, dir ? dRb : undefined, b1 ? b1Lb : undefined, b1 ? b1Rb : undefined,
        b2 ? b2Lb : undefined, b2 ? b2Rb : undefined);
      else this.rack.process(Lb, Rb, n, dir ? dLb : undefined, dir ? dRb : undefined);
      this.fxc.t += Date.now() - tf;
    } else { // no fx-dsp: the direct pair, master and Bypass (base values, ramped across the span); buses are dropped
      if (dir) for (let i = 0; i < n; i++) { Lb[i] += dLb[i]; Rb[i] += dRb[i]; }
      const g0 = this.nfG, dg = (this.nfT - g0) / n;
      for (let i = 0; i < n; i++) { const g = g0 + dg * (i + 1); Lb[i] *= g; Rb[i] *= g; }
      this.nfG = this.nfT;
    }
    if (mixHook) this.rack.mixPeaks(this.mixPk);
    else if (this.mon) this.mixPk[2] = this.peak2(Lb, Rb, n, this.mixPk[2]); // the main output (after the rack)
    // a released bus pair (setSerum): rendered until the voices have written nothing into it for 256 frames (their sends
    // glide to exactly 0 and then skip the pair; no send can rise again without a new patch) and its decimators have
    // drained, at most 1 s
    if (this.sxRel !== 0) {
      const r = this.sxRel;
      let z = true;
      if ((r & 4) !== 0) for (let i = 0; i < N && z; i++) if (B1L[i] !== 0 || B1R[i] !== 0) z = false;
      if ((r & 8) !== 0) for (let i = 0; i < N && z; i++) if (B2L[i] !== 0 || B2R[i] !== 0) z = false;
      if (!z) this.sxRelN = 256; else this.sxRelN -= n;
      if ((this.sxRelT -= n) <= 0) this.sxRelN = 0;
      if (this.sxRelN <= 0) { this.sxRelN = 0; this.sxMask &= ~r; this.sxRel = 0; }
    }
  }
  peak2(a, b, n, p) {
    for (let i = 0; i < n; i++) { const x = a[i] < 0 ? -a[i] : a[i], y = b[i] < 0 ? -b[i] : b[i]; if (x > p) p = x; if (y > p) p = y; }
    return p;
  }
}

// A shared FX panel of a track (§6.2, §6.5), or an Inst's private chain (its own FX when it is a Serum): one FXRack.
// Legacy structure (no graph yet): the track's one rack (c0), shared by reference with Inst 0 (inst.rack), which feeds it
// (classic) or holds it as its own FX (Serum): identity = the panel, so a model change never rebuilds it (tails survive).
// IMPL-1e §2.1: srcs / g / ns its sources (Insts or Chains, render order) and their gains; alias: a single source (its
// buffers processed in place when it is live at gain 1); ownBy: the Inst whose private chain this is (null: a shared
// panel); drive: the Track keys and triggers its rack (no single source holds it as its rack); from: a removed panel's
// single source (the reshape hand-over, Track.handOver); oL / oR its own buffers, Lb / Rb what it processed last (its own
// or its source's); nOut: its consumers; live: processed this span; fxr: its last {t: 'chain'} FXP (transport-stop
// silence); used: processed since it was built; nOn: 0 (read beside the Insts' when keying)
class Chain {
  constructor(base) {
    this.id = 'c0'; this.mon = false; this.t = 0; // its meters are subscribed (mon); ms of its processing since the last stats
    const FX = globalThis.FXDSP;
    this.rack = null;
    if (FX) { try { this.rack = new FX.FXRack(base); } catch (err) { this.rack = null; } }
    this.srcs = []; this.g = new Float64Array(CH_SRC); this.ns = 0; this.alias = 0; this.ownBy = null; this.drive = 0; this.from = null;
    this.oL = new Float64Array(128); this.oR = new Float64Array(128); this.Lb = this.oL; this.Rb = this.oR;
    this.nOut = 0; this.live = 0; this.fxr = null; this.overK = ''; this.used = 0; this.nOn = 0;
  }
}
const MAX_I = 8, MAX_C = 16, CH_SRC = MAX_I + MAX_C, OUT_SRC = 2 * CH_SRC, NK = 17 * 128; // limits (§2.6); held keys (ch × note)
// the shared mix (§2.2): copy-first sum of a part's buffers into L / R (g 1: a plain copy / add — no multiply)
function mixIn(L, R, s, g, first, n) {
  const a = s.Lb, b = s.Rb;
  if (first) { if (g === 1) for (let i = 0; i < n; i++) { L[i] = a[i]; R[i] = b[i]; } else for (let i = 0; i < n; i++) { L[i] = a[i] * g; R[i] = b[i] * g; } }
  else if (g === 1) for (let i = 0; i < n; i++) { L[i] += a[i]; R[i] += b[i]; } else for (let i = 0; i < n; i++) { L[i] += a[i] * g; R[i] += b[i] * g; }
}

// The compatibility facade (§6.2): every field and method of Inst 0 the Track does not have itself is an accessor of
// Facade.prototype (between Track and AudioWorkletProcessor), so callers that reach into "the processor" — the tests,
// the bench, the golden harness — keep working unchanged; a method read returns Inst 0's own override when one was set
// through the facade, else its prototype method bound to it; `rack` is the first Chain's. Installed once, from the first
// Track's Inst, before anything renders; the Track's own code never goes through it (it holds i0 / c0).
class Facade extends AudioWorkletProcessor {}
let FACADE = false;
function facade(T) {
  FACADE = true;
  const P = Facade.prototype, own = Object.prototype.hasOwnProperty;
  const def = (k, d) => { if (!(k in T)) Object.defineProperty(P, k, Object.assign({ configurable: true }, d)); };
  def('rack', { get() { return this.c0.rack; }, set(v) { this.c0.rack = v; this.i0.rack = v; } });
  for (const k of Object.keys(T.i0)) def(k, { get() { return this.i0[k]; }, set(v) { this.i0[k] = v; } });
  for (const k of Object.getOwnPropertyNames(Inst.prototype)) {
    const d = Object.getOwnPropertyDescriptor(Inst.prototype, k);
    if (k === 'constructor') continue;
    if (d.get || d.set) def(k, { get() { return this.i0[k]; }, set(v) { this.i0[k] = v; } });
    else def(k, { get() { const I = this.i0; return own.call(I, k) ? I[k] : (...a) => d.value.apply(I, a); }, set(v) { this.i0[k] = v; } });
  }
}

// The track: the AudioWorkletProcessor 'synth-engine' (§6.2). It owns the events (song, MIDI OUT ring, the Insts'
// sequencers → spans on the 4-frame grid), the transport, message dispatch, panic / end, the monitors and stats, and the
// output stage (panicFade → DC block, limiter, clip); its Insts and Chains render each span. Until its first {t: 'graph'}
// a node holds the legacy structure (1d: Inst i0 into Chain c0, today's messages); a graph names the parts by device id
// and may hold several Insts into shared Chains (IMPL-1e §2: zones, power, salts, copy-first sums, dying parts).
class Track extends Facade {
  constructor(opt) {
    super();
    const po = (opt && opt.processorOptions) || {};
    this.hostOS = po.hostOS || po.os || 4; // the app's oversampling (a Serum track runs at its own, §11.4)
    this.offline = !!po.offline;           // a bounce / resample: no deadline, so no JIT warm-ups
    this.base = sampleRate;
    // song playback / transport (scheduled against currentFrame so every track node stays in sync)
    // anch: the next re-seek follows a transport start / seek or a loop wrap, whose anchor (tp.frame, tp.tick) may lie up to
    // one 4-frame span before the frame it is handled at (RULINGS2 bug fix 1); fresh: that start / seek came from play() /
    // a seek (accepted late, R7 B1); lastT: the song position of the last span whose events fired (NaN: none since the
    // start / stop; R7 B2 / B3)
    this.sn = []; this.sc = []; this.ni = 0; this.ci = 0; this.seqOn = []; this.reseek = true; this.anch = false; this.frames = 0;
    this.fresh = false; this.lastT = NaN; this.songCtl = false;
    this.tp = { play: false, frame: 0, tick: 0, fpt: 1, loop: false, ls: 0, le: 0, wrap: false, pend: null };
    this.inSpan = 0; this.spanF = 0; this.ending = 0;
    // MIDI OUT ring (§7.9): [frame, on, note, velocity] × EXT_N, extN entries in arrival order
    this.ext = new Float64Array(EXT_N * 4); this.extN = 0;
    this.pnN = 0; this.pnM = Math.max(1, Math.round(this.base * 0.005)); // panic: frames left of the output fade, its length
    this.mon = false; this.monF = 0; // a snapshot / FX monitor subscription is on (smon / mon); frames since the last one
    this.loadT = 0; this.statN = 0;
    this.lim = new Limiter(this.base);
    this.dcx = new Float64Array(2); this.dcy = new Float64Array(2); // (typed: the field keeps one type in every processor)
    this.trackId = ''; this.procs = null;
    // the graph (§6.2, IMPL-1e §2.1). graphed: a {t: 'graph'} arrived (part ids are device ids from then on); simple: the
    // structure is the alias shape — one Inst into its panel, or one Serum into OUT — and renderSpan runs 1d's statements
    // (§6.3 in-place aliasing: today's operations in today's order); outSrc / outG / outN: the parts cabled into OUT; dyI /
    // dyC: removed parts, rendered until silent; oL / oR: the OUT sum's own buffers; held keys (ch · 128 + note, §2.3):
    // holdR the receiving Insts (bits by slot), holdP their pitches, holdV the velocity (restrike); slots: Inst by slot;
    // nOnK: the note-on stamps; wI / wC: the legacy parts while the warm-up runs its graphs (restore puts them back)
    this.graphed = 0; this.simple = 1; this.nOnK = 0;
    this.outSrc = []; this.outG = new Float64Array(OUT_SRC); this.outN = 0; this.dyI = []; this.dyC = [];
    this.oL = new Float64Array(128); this.oR = new Float64Array(128);
    this.holdR = new Uint8Array(NK); this.holdP = new Int16Array(MAX_I * NK); this.holdV = new Float64Array(NK);
    this.slots = [null, null, null, null, null, null, null, null]; this.wI = null; this.wC = null;
    this.c0 = new Chain(this.base); this.chains = [this.c0];
    this.i0 = new Inst(this, po.os || 4, this.c0); this.insts = [this.i0];
    this.legacy(this.i0, this.c0);
    if (!FACADE) facade(this);
    // the first processor in this global scope warms the JIT up before anything is heard (once, never again)
    if (!warmed && !this.offline) { warmed = true; try { this.warmUp(); } catch (err) { /* a failed warm-up only costs speed */ } this.restore(po.os || 4); }
    // MIDI OUT target registry (§7.9): track nodes only. A processor without a track id (preset preview, resample, render
    // farm) has no registry either: its sequencer's MIDI OUT events are dropped (§7.9 "has no target")
    this.trackId = typeof po.trackId === 'string' && po.trackId ? po.trackId : '';
    if (this.trackId) { PROCS.set(this.trackId, this); this.procs = PROCS; this.i0.procs = PROCS; }
    ALL.add(this);
    // wavetables / sample assets of an offline render (bounce, resample): given to the first node of the context only,
    // the stores are shared by every processor of the global scope (§7.5; SPEC-serum2 §9.6)
    const SD = globalThis.SerumDSP, SB = globalThis.SxBase;
    if (SD && Array.isArray(po.wts)) for (const e of po.wts) if (e && e.id) SD.storeWT(e.id, e);
    if (SB && Array.isArray(po.smps)) for (const e of po.smps) if (e && e.id) SB.storeAsset(e.id, e);
    if (po.patch) this.i0.setPatch(po.patch);
    if (po.seq) this.i0.seqMsg(po.seq);
    // IMPL-1e §2.5: a graph track's parts, in the order the live messages build them (offline bounce = live)
    if (po.graph && typeof po.graph === 'object') this.graphMsg(po.graph);
    if (this.graphed === 1) {
      const P = po.patches, C = po.chains, Q = po.seqs;
      if (P && typeof P === 'object') for (const id in P) { const x = this.instOf(id); if (x !== null && P[id]) this.patchI(x, P[id]); }
      if (C && typeof C === 'object') for (const id in C) { const e = C[id]; if (e) this.chainMsg({ t: 'chain', c: id, fxr: e.fxr, fxrT: e.fxrT }); }
      if (Q && typeof Q === 'object') for (const id in Q) { const x = this.instOf(id); if (x !== null && Q[id]) x.seqMsg(Q[id]); }
    }
    if (po.song) this.songMsg(po.song);
    if (po.transport) this.transportMsg(po.transport);
    this.port.onmessage = (ev) => this.msg(ev.data);
    // built (the first processor of the scope: warmed up) — main.js resumes a context it held suspended meanwhile (WebKit)
    if (!this.offline) this.port.postMessage({ t: 'ready' });
  }
  // the legacy structure (IMPL-1e §2.1; 1d's object graph): Inst I ('i0') into Chain C ('c0'), C into OUT, the output
  // stage on I's buffers
  legacy(I, C) {
    I.id = 'i0'; C.id = 'c0'; I.fxc = C; I.rack = C.rack; I.sharedRack = 0; I.feed = C; I.nOut = 1; I.slot = 0;
    C.ownBy = I; C.srcs.length = 0; C.srcs.push(I); C.g[0] = 1; C.ns = 1; C.alias = 1; C.drive = 0; C.from = null; C.nOut = 1;
    this.i0 = I; this.c0 = C; this.insts = [I]; this.chains = [C];
    this.outSrc.length = 0; this.outSrc.push(C); this.outG[0] = 1; this.outN = 1; this.dyI.length = 0; this.dyC.length = 0;
    this.slots.fill(null); this.slots[0] = I;
    this.graphed = 0; this.simple = 1; this.Lb = I.Lb; this.Rb = I.Rb;
  }
  // Renders every engine path through attack, sustain and release, so a model's first notes do not run in the
  // interpreter while the JIT catches up (single quanta used to reach 1.5-2x the budget). Two rounds: the first
  // collects type feedback for every branch, the second leaves code optimised with all of it. Through the Track's own
  // paths (process, span splitting, the shared Chain, the output stage) and Inst 0; then the graph paths (warmGraph).
  warmUp() {
    const I = this.i0, io = [[new Float32Array(128), new Float32Array(128)]], run = (k) => { for (let b = 0; b < k; b++) { this.process(null, io); this.statN = 0; } };
    for (let round = 0; round < 2; round++) {
      for (const w of WARM) {
        I.setPatch(w);
        this.noteOn(48, 0.9); this.noteOn(67, 0.6);
        run(30);
        if (round === 0) I.reqOS(I.OS === 4 ? 2 : 4);
        this.noteOff(48); this.noteOff(67);
        run(10);
        I.osPend = 0; I.osR = 1; I.osHold = 0;
      }
    }
    // Serum voices (every warp / filter family / LFO mode, §8.4.2) and every FX rack module and mode (§8.5.2)
    const SD = globalThis.SerumDSP;
    if (SD) SD.warmUp(I);
    if (I.rack) I.rack.warmUp();
    this.warmGraph(run);
  }
  // IMPL-1e §2.6: the graph paths once — two classic Insts (analog WARM patches only, never a Solina: Math.random is the
  // harness's) into one shared Chain at a gain, a Serum Inst through its own FX into a second one, zones and salts (the
  // Serum's above 2^30 in every seeded state: their fields hold doubles from here on, V8), a power-off with held keys and
  // the power-on restrike, a removal (dying parts); restore() returns to the legacy structure
  warmGraph(run) {
    this.wI = this.i0; this.wC = this.c0;
    const z = { lo: 0, hi: 127, xp: 0 }, e1 = [['w1', 'wa', 1], ['wa', 'out', 1]];
    this.graphMsg({ t: 'graph', insts: [{ id: 'w1', on: true, zone: z, salt: 0 }, { id: 'w2', on: true, zone: { lo: 40, hi: 100, xp: 12 }, salt: 0x3C6EF372 },
      { id: 'w3', on: true, zone: z, salt: 0x9E3779B9 }], chains: [{ id: 'wa' }, { id: 'wb' }],
    edges: e1.concat([['w2', 'wa', 0.71], ['w3', 'wb', 1], ['wb', 'out', 0.83]]), out: 'out' });
    const x1 = this.instOf('w1'), x2 = this.instOf('w2'), x3 = this.instOf('w3');
    this.patchI(x1, WARM[1]); this.patchI(x2, WARM[4]); this.patchI(x3, { engine: 'serum', mode: 'poly', poly: 2, level: 0.31 });
    this.noteOn(48, 0.9); this.noteOn(55, 0.7); this.noteOn(31, 0.5);
    run(20);
    this.power(x2, 0); run(4); this.power(x2, 1); run(10);
    this.noteOff(48); this.noteOff(55); this.noteOff(31); run(4);
    this.graphMsg({ t: 'graph', insts: [{ id: 'w1', on: true, zone: z, salt: 0 }], chains: [{ id: 'wa' }], edges: e1, out: 'out' });
    run(6);
  }
  // back to the freshly built state after the warm-up (Inst.restore: in place), in the legacy structure
  restore(os) {
    if (this.wI !== null) { this.legacy(this.wI, this.wC); this.wI = null; this.wC = null; }
    this.loadT = 0; this.statN = 0; this.c0.t = 0; this.c0.mon = false;
    this.lim.reset(); this.dcx.fill(0); this.dcy.fill(0);
    this.mon = false; this.monF = 0; this.spanF = 0; this.pnN = 0; this.extN = 0; this.inSpan = 0; this.frames = 0;
    this.nOnK = 0; this.holdR.fill(0); this.holdV.fill(0);
    this.i0.restore(os);
  }
  msg(d) {
    if (this.ending === 1) return; // after {t: 'bye'} the node only fades out (end)
    switch (d.t) {
      // ch: the MIDI channel of a note of an MPE track (§12.4, §6.17); absent for every other note. aud: a preview (R7 B5);
      // i: the Inst a preview plays (graph nodes, IMPL-1e §2.5)
      case 'on': this.noteOn(d.n, d.v, d.ch, 0, d.aud ? 1 : 0, d.i); break;
      case 'off': this.noteOff(d.n, d.rv, d.ch, 0, d.aud ? 1 : 0, d.i); break;
      case 'wt': { const SD = globalThis.SerumDSP; if (SD) SD.storeWT(d.id, d); break; }
      case 'wtf': { const SD = globalThis.SerumDSP; if (SD) SD.storeWTFrame(d.id, d.frame, d.levels); break; }
      case 'wtdel': { const SD = globalThis.SerumDSP; if (SD) SD.dropWT(d.id); break; }
      // sample-like assets (SPEC-serum2 §4.5, §9.5): {t: 'smp', …entry} / {t: 'smpdel', id} into SxBase's shared store
      // (RULINGS2 F1: every processor's rack hears of every store / drop — FXRack.assets() decides what concerns it)
      case 'smp': { const SB = globalThis.SxBase; if (SB && typeof d.id === 'string' && SB.storeAsset(d.id, d)) assetsChanged(); break; }
      case 'smpdel': { const SB = globalThis.SxBase; if (SB && typeof d.id === 'string') { SB.dropAsset(d.id); assetsChanged(); } break; }
      case 'bye': this.end(); break; // the node is about to be disconnected (§7.9)
      // the host's snapshot / FX meter subscriptions, posted every ~33 ms of audio while any is on: smon every part
      // (legacy), mon the Insts / Chains by id (SPEC-canvas §6.8: the modules on screen)
      case 'smon': this.watch(!!d.on, null); break;
      case 'mon': this.watch(false, d.ids); break;
      case 'fxph': this.fxph(d); break;
      case 'panic': this.panic(); break;
      case 'song': this.songMsg(d); break;
      case 'transport': this.transportMsg(d); break;
      // IMPL-1e §2.5: the structure, a shared panel's FXP, an Inst's power (graph nodes)
      case 'graph': this.graphMsg(d); break;
      case 'chain': this.chainMsg(d); break;
      case 'power': if (this.graphed === 1) { const I = this.instOf(d.i); if (I !== null) this.power(I, d.on ? 1 : 0); } break;
      // controller state reaches every Inst, powered or not (§6.6); {t: 'os', i, v}: one Inst (the safeguard, graph nodes)
      case 'bend': case 'wheel': case 'at': case 'sus': case 'pat': case 'mpe': case 'os': {
        if (d.t === 'os') {
          if (d.i !== undefined && this.graphed === 1) { const I = this.instOf(d.i); if (I !== null) I.msg(d); break; }
          this.hostOS = d.v; // (the oversampling a new Inst starts at)
        }
        const I = this.insts;
        for (let i = 0; i < I.length; i++) I[i].msg(d);
        break;
      }
      // the rest (patch, seq, seqcmd, sqt, ct, fxtap): Inst 0 — on a graph node the Inst / Chain the message names
      default: if (this.graphed === 0) this.i0.msg(d); else this.partMsg(d);
    }
  }
  // a graph node's Inst / part message (IMPL-1e §2.5): `i` the Inst (absent: insts[0]); fxtap: `c` a shared panel, `i` a
  // Serum's own FX (absent: c0)
  partMsg(d) {
    if (d.t === 'fxtap') { const r = this.rackFor(d); if (r !== null && typeof r.setTap === 'function') r.setTap(typeof d.id === 'string' ? d.id : ''); return; }
    const I = this.instOf(d.i);
    if (I === null) return;
    if (d.t === 'patch') this.patchI(I, d.p); else I.msg(d);
  }
  rackFor(d) {
    if (d.c !== undefined) { const c = this.chainOf(d.c); return c !== null ? c.rack : null; }
    if (d.i !== undefined) { const I = this.instOf(d.i); return I !== null ? I.fxc.rack : null; }
    return this.c0.rack;
  }
  // the rack's LFO phases (§13.5): legacy {t: 'fxph', v}; a graph node names the part ({i} a Serum's own FX, {c} a panel)
  fxph(d) {
    if (this.graphed === 0) { const r = this.c0.rack; this.port.postMessage({ t: 'fxph', v: r ? r.phases() : null }); return; }
    const r = this.rackFor(d), v = r ? r.phases() : null;
    if (d.c === undefined && d.i !== undefined) this.port.postMessage({ t: 'fxph', v, i: d.i });
    else this.port.postMessage({ t: 'fxph', v, c: d.c !== undefined ? d.c : this.c0.id });
  }
  // all: every part (smon); else the parts whose id is in ids (mon) — legacy i0 / c0, a graph node's device ids (an Inst,
  // 'iN/fx' a Serum's own FX, a panel)
  watch(all, ids) {
    const has = id => all || (Array.isArray(ids) && ids.indexOf(id) >= 0);
    if (this.graphed === 0) {
      const I = this.i0, c = this.c0;
      I.mon = has(I.id); c.mon = has(c.id);
      this.mon = I.mon || c.mon; this.monF = 0;
      if (I.sx) I.sx.mon = I.mon ? 1 : 0;
      if (this.mon) this.postMon();
      return;
    }
    let m = false;
    for (const I of this.insts) {
      I.mon = has(I.id); I.fxc.mon = I.kind === 'serum' && has(I.fxc.id);
      if (I.sx) I.sx.mon = I.mon ? 1 : 0;
      if (I.mon || I.fxc.mon) m = true;
    }
    for (const c of this.chains) { c.mon = has(c.id); if (c.mon) m = true; }
    this.mon = m; this.monF = 0;
    if (this.mon) this.postMon();
  }
  // RULINGS2 F1: every processor's rack hears of every asset stored / dropped (FXRack.assets() decides what concerns it)
  assets() {
    if (this.graphed === 0) { const r = this.c0.rack; if (r) { try { r.assets(); this.i0.fxOver(); } catch (err) { /* a failed rack keeps its old IR */ } } return; }
    for (const I of this.insts) if (I.kind === 'serum' && I.rack) { try { I.rack.assets(); I.fxOver(); } catch (err) { /* (as above) */ } }
    for (const c of this.chains) if (c.rack) { try { c.rack.assets(); this.chainOver(c); } catch (err) { /* (as above) */ } }
  }
  // §8.5 on a shared panel: the instances its 32 MB cap left unallocated, posted when the list changes ({t: 'fxover', ids, c})
  chainOver(c) {
    const o = c.rack && Array.isArray(c.rack.over) ? c.rack.over : null, k = o && o.length ? o.join(',') : '';
    if (k === c.overK) return;
    c.overK = k;
    if (k) this.port.postMessage({ t: 'fxover', ids: o.slice(), c: c.id });
  }

  /* ---- the graph (IMPL-1e §2.1, §2.5; allocation in these messages only) ---- */
  instOf(id) { // the Inst a message names (absent: insts[0]); null: none
    const I = this.insts;
    if (id === undefined || id === null) return I[0];
    for (let k = 0; k < I.length; k++) if (I[k].id === id) return I[k];
    return null;
  }
  chainOf(id) { // a shared panel or a Serum's own FX ('iN/fx') by id (absent: c0); null: none
    if (id === undefined || id === null) return this.c0;
    for (const c of this.chains) if (c.id === id) return c;
    for (const I of this.insts) if (I.fxc.id === id) return I.fxc;
    return null;
  }
  // {t: 'graph', insts: [{id, on, zone: {lo, hi, xp}, salt}], chains: [{id}], edges: [[src, dst, g]], out, key}: the
  // first one adopts the legacy parts (i0 → insts[0], the primary; c0 → the panel a classic primary feeds, else it stays
  // the primary's private chain '<id>/fx': c0 = chains[0] || i0.fxc, IMPL-1e §2.1); later ones match by id — unknown Insts / Chains are built, missing ones move to dying
  // (their fade / tail goes to OUT, then they are dropped). A malformed graph (no Inst, > 8 Insts, > 16 panels, a repeated
  // id) is ignored
  graphMsg(d) {
    const gi = Array.isArray(d.insts) ? d.insts : null, gc = Array.isArray(d.chains) ? d.chains : [], ge = Array.isArray(d.edges) ? d.edges : [];
    if (gi === null || gi.length < 1 || gi.length > MAX_I || gc.length > MAX_C) return;
    const iid = gi.map(e => String(e && e.id)), cid = gc.map(e => String(e && e.id)), all = iid.concat(cid), out = typeof d.out === 'string' ? d.out : 'out';
    if (new Set(all).size !== all.length || all.indexOf(out) >= 0) return;
    if (this.graphed === 0) { // (c0 → the panel the primary feeds: chains[0] in every graph main.js builds)
      let pc = '';
      for (const e of ge) if (Array.isArray(e) && String(e[0]) === iid[0] && cid.indexOf(e[1]) >= 0) pc = e[1];
      this.adopt(iid[0], pc);
    }
    const oldI = this.insts, oldC = this.chains, I = [], C = [], pw = [];
    for (const x of oldI) if (iid.indexOf(x.id) < 0) this.retire(x);   // (first: their slots are free for the new ones)
    for (const c of oldC) if (cid.indexOf(c.id) < 0) this.retireC(c);
    for (let k = 0; k < gi.length; k++) {
      const e = gi[k] || {}, id = iid[k], on = e.on === false || e.on === 0 ? 0 : 1, z = e.zone && typeof e.zone === 'object' ? e.zone : {};
      let x = null;
      for (const y of oldI) if (y.id === id) x = y;
      if (x === null) {
        x = new Inst(this, this.hostOS, new Chain(this.base));
        x.id = id; x.fxc.id = id + '/fx'; x.fxc.ownBy = x; x.procs = this.procs; x.on = on;
        x.slot = this.slots.indexOf(null); this.slots[x.slot] = x;
      } else if (x.on !== on) pw.push(x);
      const lo = z.lo, hi = z.hi, xp = z.xp, ok = v => typeof v === 'number' && v === Math.floor(v);
      x.zlo = ok(lo) && lo >= 0 && lo <= 127 ? lo : 0; x.zhi = ok(hi) && hi >= 0 && hi <= 127 ? hi : 127; x.zxp = ok(xp) && xp >= -48 && xp <= 48 ? xp : 0;
      x.setSalt(typeof e.salt === 'number' && e.salt >= 0 && e.salt < 4294967296 ? e.salt : 0);
      I.push(x);
    }
    for (const id of cid) {
      let c = null;
      for (const y of oldC) if (y.id === id) c = y;
      if (c === null) { c = new Chain(this.base); c.id = id; }
      c.ownBy = null;
      C.push(c);
    }
    this.insts = I; this.chains = C;
    this.wire(ge, out);
    this.resolve();
    for (const x of pw) this.power(x, x.on === 1 ? 0 : 1); // (zones and wiring in place: a power-on restrikes in zone)
  }
  // the first graph: the legacy parts take their device ids (state, tails and racks kept: no re-patch needed)
  adopt(id, cid) {
    const I = this.i0, c = this.c0;
    I.id = id;
    if (I.kind !== 'serum' && cid !== '') { // c0 becomes the shared panel; the Inst gets a private chain of its own
      c.id = cid; c.ownBy = null;
      const f = new Chain(this.base); f.id = id + '/fx'; f.ownBy = I; I.fxc = f;
      this.chains = [c];
    } else { c.id = id + '/fx'; this.chains = []; }
    this.graphed = 1;
  }
  // edges [[src, dst, g]]: src an Inst / Chain id ('iN/fx': the Serum iN — its out jack is after its own FX), dst a Chain
  // id or `out`; g ≥ 0 (absent / invalid: 1)
  wire(ge, out) {
    const I = this.insts, C = this.chains, S = this.outSrc;
    for (const x of I) { x.feed = null; x.nOut = 0; }
    for (const c of C) { c.srcs.length = 0; c.ns = 0; c.nOut = 0; }
    S.length = 0; this.outN = 0;
    for (const e of ge) {
      if (!Array.isArray(e) || e.length < 2) continue;
      const s = this.partIn(String(e[0])), g = typeof e[2] === 'number' && e[2] >= 0 && e[2] < 1e6 ? e[2] : 1;
      if (s === null) continue;
      if (e[1] === out) { if (this.outN < OUT_SRC) { S.push(s); this.outG[this.outN++] = g; s.nOut++; } continue; }
      let c = null;
      for (const y of C) if (y.id === e[1]) c = y;
      if (c === null || c === s || c.ns >= CH_SRC) continue;
      c.srcs.push(s); c.g[c.ns++] = g; s.nOut++;
      if (s instanceof Inst) s.feed = c;
    }
  }
  partIn(id) {
    for (const x of this.insts) if (x.id === id || x.fxc.id === id) return x;
    for (const c of this.chains) if (c.id === id) return c;
    return null;
  }
  // after a graph or a patch that changed an Inst's kind: racks (rackOf), each panel's alias / drive, i0 / c0, simple
  resolve() {
    const I = this.insts, C = this.chains;
    for (const x of I) this.rackOf(x, x.kind === 'serum');
    for (const c of C) {
      const s = c.ns === 1 ? c.srcs[0] : null;
      c.alias = c.ns === 1 ? 1 : 0;
      c.drive = s instanceof Inst && c.rack !== null && s.rack === c.rack ? 0 : 1;
    }
    this.i0 = I[0]; this.c0 = C.length ? C[0] : I[0].fxc;
    this.resolveSimple();
  }
  resolveSimple() { // (also from the render path when the last dying part is dropped: no allocation)
    const I = this.insts, x = I[0];
    if (this.graphed === 0) { this.simple = 1; this.Lb = x.Lb; this.Rb = x.Rb; return; }
    const C = this.chains, S = this.outSrc;
    let s = I.length === 1 && this.dyI.length === 0 && this.dyC.length === 0 && this.outN === 1 && this.outG[0] === 1 && x.nOut === 1 ? 1 : 0;
    if (s === 1) {
      if (x.kind === 'serum') s = C.length === 0 && S[0] === x ? 1 : 0;
      else {
        const c = C.length === 1 ? C[0] : null;
        s = c !== null && S[0] === c && c.ns === 1 && c.srcs[0] === x && c.g[0] === 1 && c.nOut === 1 && c.rack !== null && x.rack === c.rack ? 1 : 0;
      }
    }
    this.simple = s;
    if (s === 1) { this.Lb = x.Lb; this.Rb = x.Rb; }
  }
  // an Inst's rack (§2.1): a Serum its own FX; a classic Inst the rack of the panel it feeds as that panel's only source
  // (sharedRack: patches leave it to {t: 'chain'}), else none
  rackOf(x, sx) {
    if (sx) { x.rack = x.fxc.rack; x.sharedRack = 0; return; }
    const c = x.feed;
    if (c !== null && c.ns === 1 && x.nOut === 1) { x.rack = c.rack; x.sharedRack = 1; } else { x.rack = null; x.sharedRack = 0; }
  }
  // an Inst leaves the graph: its notes stop (3 ms fade), its sequencers end, its keys are forgotten; it renders into OUT
  // until silent (a Serum's own FX tail included)
  retire(x) {
    x.on = 0; x.allOff(true); x.seqRelease(); if (x.sq !== null) x.sq.run = false; x.sqOff();
    x.mon = false; x.fxc.mon = false; if (x.sx) x.sx.mon = 0;
    const b = ~(1 << x.slot), H = this.holdR;
    for (let k = 0; k < NK; k++) H[k] &= b;
    if (this.slots[x.slot] === x) this.slots[x.slot] = null;
    if (x.sharedRack === 1) { x.rack = null; x.sharedRack = 0; }
    x.feed = null; x.nOut = 1;
    this.dyI.push(x);
  }
  // a panel leaves the graph: its tail goes to OUT until its rack is idle; `from` its single source (the hand-over)
  retireC(c) {
    const s = c.ns === 1 ? c.srcs[0] : null;
    c.from = s instanceof Inst ? s : null;
    c.srcs.length = 0; c.ns = 0; c.alias = 0; c.drive = 1; c.nOut = 1; c.mon = false;
    this.dyC.push(c);
  }
  // {t: 'patch', i, p} on a graph node: the Inst's rack follows its kind (resolved before the patch, so setSerum sets its
  // own FX and a classic patch leaves a shared panel to {t: 'chain'}); a kind change re-resolves the graph
  patchI(x, p) {
    const sx = !!p && p.engine === 'serum', was = x.kind === 'serum';
    if (sx !== was) this.handOver(x, sx);
    this.rackOf(x, sx);
    x.setPatch(p);
    if (sx !== was || (x.kind === 'serum') !== sx) this.resolve();
  }
  // the reshape (IMPL-1e §3.2 setModel) keeps the rack, as a legacy model change does (tails survive, bit for bit): classic
  // → Serum takes the panel the last graph removed while it was its only source as its own FX; Serum → classic hands its
  // own FX to the new panel (not yet processed) it alone feeds now
  handOver(x, sx) {
    const f = x.fxc;
    if (sx) {
      for (const c of this.dyC) if (c.from === x) { const r = c.rack; c.rack = f.rack; f.rack = r; x.overK = c.overK; c.from = null; return; }
      return;
    }
    const c = x.feed;
    if (c !== null && c.ns === 1 && c.used === 0) { const r = c.rack; c.rack = f.rack; f.rack = r; c.overK = x.overK; }
  }
  // {t: 'chain', c, fxr, fxrT}: one shared panel's FXP (absent c: the first panel)
  chainMsg(d) {
    if (this.graphed === 0) return;
    let c = null;
    if (d.c === undefined) c = this.chains.length ? this.chains[0] : null;
    else for (const y of this.chains) if (y.id === d.c) c = y;
    if (c === null || c.rack === null) return;
    c.fxr = d.fxr || null;
    c.rack.set(c.fxr, d.fxrT);
    this.chainOver(c);
  }
  // {t: 'power', i, on} (§2.3): off — notes stop with the 3 ms fade, its sequencers stop (a TB-303 releases, a Serum's
  // generated / held notes clear), its keys are forgotten; it keeps every setting and its controller state. On — the keys
  // held now (in zone) are restruck, its sequencer re-anchors to the song
  power(x, on) {
    if (on === x.on) return;
    const H = this.holdR, b = 1 << x.slot;
    if (on === 0) {
      x.on = 0; x.allOff(true); x.seqRelease();
      if (x.sxSeq !== null) { x.sxSeq.panic(); x.sxTr.fill(-1); }
      for (let k = 0; k < NK; k++) H[k] &= ~b;
      return;
    }
    x.on = 1;
    const V = this.holdV, P = this.holdP, o = x.slot * NK;
    for (let k = 0; k < NK; k++) {
      if (!(V[k] > 0)) continue;
      const n = k & 127, m = n + x.zxp;
      if (n < x.zlo || n > x.zhi || m < 0 || m > 127) continue;
      x.noteOn(m, V[k], k >> 7, 0, 0); H[k] |= b; P[o + k] = m;
    }
    if (x.sq !== null) x.sq.syncStep = null;
    if (x.sxSeq !== null) x.sxSeq.transport(this.tp.play);
  }

  /* ---- notes (§2.3) ---- */
  // notes reach the powered Insts whose zone admits them, transposed (legacy node: Inst 0, today's call) — through these
  // methods, so a caller that wraps the processor's noteOn / noteOff (the golden harness's transport log) sees every song /
  // ext / live note. The receivers and their pitches are kept per held key: a note-off reaches exactly them, whatever the
  // zones are now. aud (a preview) targets one Inst: i, else insts[0]
  noteOn(n, v, ch, ext, aud, i) {
    const k = n >= 0 && n <= 127 && n === Math.floor(n) ? (ch > 0 && ch <= 16 ? ch | 0 : 0) * 128 + n : -1;
    if (this.graphed === 0) { this.i0.noteOn(n, v, ch, ext, aud); if (k >= 0 && !aud) { this.holdR[k] = 1; this.holdP[k] = n; this.holdV[k] = v > 0 ? v : 0; } return; }
    if (aud) { const x = this.instOf(i); if (x !== null && x.on === 1) x.noteOn(n, v, ch, ext, aud); return; }
    const X = this.insts;
    if (k < 0) { if (X[0].on === 1) X[0].noteOn(n, v, ch, ext, 0); return; } // (not a MIDI key: insts[0], as before)
    const P = this.holdP;
    let bits = this.holdR[k];
    for (let j = 0; j < X.length; j++) {
      const x = X[j], m = n + x.zxp;
      if (x.on !== 1 || n < x.zlo || n > x.zhi || m < 0 || m > 127) continue;
      x.noteOn(m, v, ch, ext, 0);
      bits |= 1 << x.slot; P[x.slot * NK + k] = m;
      const c = x.feed;
      if (c !== null && c.drive === 1 && c.rack !== null) c.rack.trigger(); // (Hyper RETRIG of a panel no Inst holds)
    }
    this.holdR[k] = bits; this.holdV[k] = v > 0 ? v : 0;
  }
  noteOff(n, rv, ch, ext, aud, i) {
    const k = n >= 0 && n <= 127 && n === Math.floor(n) ? (ch > 0 && ch <= 16 ? ch | 0 : 0) * 128 + n : -1;
    if (this.graphed === 0) { this.i0.noteOff(n, rv, ch, ext, aud); if (k >= 0 && !aud) { this.holdR[k] = 0; this.holdV[k] = 0; } return; }
    if (aud) { const x = this.instOf(i); if (x !== null) x.noteOff(n, rv, ch, ext, aud); return; }
    const X = this.insts;
    if (k < 0) { X[0].noteOff(n, rv, ch, ext, 0); return; }
    const bits = this.holdR[k], P = this.holdP, rec = bits !== 0 || this.holdV[k] > 0; // (recorded: its receivers, maybe none)
    this.holdR[k] = 0; this.holdV[k] = 0;
    for (let j = 0; j < X.length; j++) {
      const x = X[j];
      if (rec) { if ((bits & (1 << x.slot)) !== 0) x.noteOff(P[x.slot * NK + k], rv, ch, ext, 0); continue; }
      const m = n + x.zxp; // (a key with no record — struck before the graph took its note-on: the zones as they are now)
      if (x.on === 1 && n >= x.zlo && n <= x.zhi && m >= 0 && m <= 127) x.noteOff(m, rv, ch, ext, 0);
    }
  }
  // R7 B5: the song holds note n (its note-off is still due)
  songHas(n) { const on = this.seqOn; for (let i = 0; i < on.length; i += 2) if (on[i] === n) return true; return false; }
  // the frame an event handled now belongs to: the current span inside process(), else the next render quantum
  nowF() { return this.inSpan === 1 ? this.spanF : typeof currentFrame === 'number' ? currentFrame : this.frames; }
  panic() {
    const I = this.insts, D = this.dyI;
    for (let k = 0; k < I.length; k++) { const x = I[k]; x.allOff(true); if (x.sq) x.sq.run = false; }
    for (let k = 0; k < D.length; k++) D[k].allOff(true);
    this.seqOn = []; this.extN = 0; this.holdR.fill(0); this.holdV.fill(0);
    let quiet = D.length === 0 && this.dyC.length === 0;
    for (let k = 0; k < I.length; k++) { const x = I[k]; x.panicSx(); if (!x.isQuiet()) quiet = false; }
    for (const c of this.chains) if (c.drive === 1 && c.rack !== null && !c.rack.idle()) quiet = false;
    // the de-click fades just rendered would re-excite effects cleared now: the output (fades, chorus / ensemble,
    // FX rack) fades out over 5 ms instead, then everything is cleared (at once when nothing can sound)
    if (quiet) this.panicClear(); else this.pnN = this.pnM;
  }
  // {t: 'bye'}: the node is about to be disconnected. It leaves the MIDI OUT registry and the scope's processor set (§7.9),
  // drops its own registry (nothing it still generates is forwarded), stops its song and transport, panics (a panic
  // already fading keeps its fade) and ignores every later message; process() returns false once the output fade has
  // ended, so the node and everything it holds can be collected (Web Audio lifetime rules)
  end() {
    if (this.ending === 1) return;
    if (this.trackId && PROCS.get(this.trackId) === this) PROCS.delete(this.trackId);
    const I = this.insts;
    this.trackId = ''; this.procs = null;
    for (const x of I) x.procs = null;
    for (const x of this.dyI) x.procs = null;
    ALL.delete(this);
    const tp = this.tp;
    tp.play = false; tp.pend = null; this.sn = []; this.sc = []; this.reseek = true;
    this.mon = false;
    for (const x of I) { x.mon = false; x.fxc.mon = false; if (x.sx) x.sx.mon = 0; }
    for (const c of this.chains) c.mon = false;
    if (this.pnN === 0) this.panic();
    else {
      this.seqOn = []; this.extN = 0;
      for (const x of I) { if (x.sq) x.sq.run = false; if (x.sxSeq !== null) { x.sxSeq.panic(); x.sxTr.fill(-1); } }
    }
    this.ending = 1;
  }
  panicClear() { // (from panicFade too: no allocation)
    this.pnN = 0;
    const I = this.insts, C = this.chains;
    for (let k = 0; k < I.length; k++) I[k].panicClear();
    for (let k = 0; k < C.length; k++) { const c = C[k]; if (c.drive === 1 && c.rack !== null) c.rack.reset(false); }
    if (this.dyI.length !== 0 || this.dyC.length !== 0) { this.dyI.length = 0; this.dyC.length = 0; this.resolveSimple(); }
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
  /* ---- song playback ------------------------------------------------ */
  // notes: flat [t, d, n, v(1..127)] sorted by t; cc: flat [t, k, v] (k: 0 bend, 1 wheel, 2 sus, 3 aftertouch)
  songMsg(d) {
    this.sn = d.notes || []; this.sc = d.cc || [];
    this.reseek = true;
  }
  transportMsg(d) {
    const tp = this.tp;
    if (!d.play) {
      tp.pend = null; this.lastT = NaN;
      if (tp.play) {
        tp.play = false; this.releaseSong(true); this.transportHook(false);
        // preference "silence effect tails when transport stops" (§11.5): the rack's tails fade out over 5 ms (a graph
        // node: every Serum's own FX and every shared panel, by their own FXP)
        if (this.graphed === 0) { const I = this.i0; if (I.rack && I.p.fxr && I.p.fxr.silence) I.rack.reset(true); }
        else {
          for (const I of this.insts) if (I.kind === 'serum' && I.rack && I.p.fxr && I.p.fxr.silence) I.rack.reset(true);
          for (const c of this.chains) if (c.rack && c.fxr && c.fxr.silence) c.rack.reset(true);
        }
      }
      return;
    }
    tp.pend = { frame: d.frame, tick: d.tick, fpt: d.fpt, loop: !!d.loop, ls: d.ls || 0, le: d.le || 0, seek: d.seek !== false, end: d.end == null ? null : d.end, fresh: !!d.fresh };
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
  // the song position in beats at the start of the current span, or null when stopped (Serum's host field, §8.4.1)
  songBeat() { const tp = this.tp; return tp && tp.play ? this.tickAt(this.spanF) / 960 : null; }
  transportHook(playing) { const I = this.insts; for (let i = 0; i < I.length; i++) I[i].transportHook(playing); }
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
        this.reseek = true; this.anch = start; this.fresh = start && P.fresh;
        if (start) { this.lastT = NaN; this.transportHook(true); }
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
      this.reseek = true; this.anch = true; this.fresh = false; this.lastT = NaN;
    }
    if (tp.end != null && t >= tp.end) {
      tp.play = false; this.releaseSong(true); this.transportHook(false);
      const I = this.insts;
      for (let i = 0; i < I.length; i++) if (I[i].sq && I[i].sq.sync) I[i].seqRelease();
      return dist;
    }
    const sn = this.sn, sc = this.sc;
    if (this.reseek) {
      // RULINGS2 bug fix 1: a start / seek / loop wrap is handled at the first 4-frame span boundary at or after its frame
      // — a wrap whose frame (a float) rounds a hair past a boundary, or whose tick position at that boundary rounds a
      // hair short of the loop end, one span later —, so t can lie past the anchor tick by up to 4 frames: the events at
      // or after the anchor are still due and play now (Phase 1 searched from t and dropped the notes exactly at the play
      // / seek tick when the frame was not a multiple of 4, and loop-start notes at such wraps). An older anchor (a node
      // created mid-song, a panic's re-send) keeps the search from t: nothing from the past is replayed. R7 B1: a start /
      // seek marked fresh (play(), a seek) that arrives late — its frame up to 0.25 s past — plays the anchor tick's notes
      // now, late, instead of dropping them. R7 B2 / B3: a re-seek without an anchor (a song update, a tempo / loop / time
      // signature change) searches the events after lastT, the position of the last span handled — the notes due since
      // (≤ 4 frames before t) still play, and none at lastT twice (t a hair behind it: float rounding of the new anchor);
      // from t only when the position really went back
      let t0 = t, aft = false;
      if (this.anch) { if (tp.tick < t && (tp.frame >= F - 4 - 1e-6 || (this.fresh && F - tp.frame <= 0.25 * this.base))) t0 = tp.tick; }
      else if (t >= this.lastT - 0.5) { t0 = this.lastT; aft = true; } // (NaN: none since the start)
      let lo = 0, hi = sn.length / 4;
      if (aft) while (lo < hi) { const m = (lo + hi) >> 1; if (sn[m * 4] <= t0) lo = m + 1; else hi = m; }
      else while (lo < hi) { const m = (lo + hi) >> 1; if (sn[m * 4] < t0) lo = m + 1; else hi = m; }
      this.ni = lo;
      lo = 0; hi = sc.length / 3;
      if (aft) while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m * 3] <= t0) lo = m + 1; else hi = m; }
      else while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m * 3] < t0) lo = m + 1; else hi = m; }
      this.ci = lo;
      this.reseek = false; this.anch = false; this.fresh = false;
    }
    // note-offs first
    const on = this.seqOn;
    for (let i = on.length - 2; i >= 0; i -= 2) if (on[i + 1] <= t) { this.noteOff(on[i]); on.splice(i, 2); }
    // controllers
    while (this.ci * 3 < sc.length && sc[this.ci * 3] <= t) {
      const k = sc[this.ci * 3 + 1], v = sc[this.ci * 3 + 2];
      this.songCtl = true;
      if (k === 0) this.msg({ t: 'bend', v });
      else if (k === 1) { const I = this.insts; for (let i = 0; i < I.length; i++) I[i].wheel = v; } // (every Inst, §6.6)
      else if (k === 2) this.msg({ t: 'sus', v: v >= 0.5 });
      else { const I = this.insts; for (let i = 0; i < I.length; i++) I[i].at = v; }
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
    this.lastT = t; // every event at or before t has been handled
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

  /* ---- MIDI OUT target (SPEC-serum2 §7.9) ----------------------------- */
  // Called by another processor of this scope (its sequencer's tapped events) with F = the event's frame + 128: the
  // event lands in this processor's future whichever node the context processes first. The ring keeps arrival order;
  // when full, the oldest note-on is dropped (the new event when it is itself the oldest note-on), never a note-off.
  extNote(F, on, n, vel) {
    F = +F; n = +n; vel = +vel;
    if (!(F - F === 0 && n >= 0 && n <= 127)) return; // a finite frame, a MIDI note
    const e = this.ext, o = on ? 1 : 0;
    let k = this.extN;
    if (k >= EXT_N) {
      let m = -1;
      for (let i = 0; i < k; i++) if (e[4 * i + 1] === 1 && (m < 0 || e[4 * i] < e[4 * m])) m = i;
      if (m < 0 || (o === 1 && F < e[4 * m])) return;
      e.copyWithin(4 * m, 4 * m + 4, 4 * k); k--;
    }
    e[4 * k] = F; e[4 * k + 1] = o; e[4 * k + 2] = Math.round(n); e[4 * k + 3] = vel === vel ? vel : 0;
    this.extN = k + 1;
  }
  // fires the ring entries due at frame F like song events (note-offs first, then note-ons, each in arrival order) and
  // returns the frames to the next one (span splitting in process)
  extEvents(F) {
    const e = this.ext;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.extN;) {
        const j = 4 * i;
        if (e[j] <= F && e[j + 1] === pass) {
          const nt = e[j + 2], v = e[j + 3];
          e.copyWithin(j, j + 4, 4 * this.extN); this.extN--;
          if (pass === 0) this.noteOff(nt, undefined, 0, 1); else this.noteOn(nt, v, 0, 1); // ext: never forwarded again
        } else i++;
      }
    }
    let dist = 1e9;
    for (let i = 0; i < this.extN; i++) { const df = e[4 * i] - F; if (df < dist) dist = df; }
    return dist < 1 ? 1 : dist;
  }
  process(inputs, outputs) {
    const t0 = Date.now();
    const out = outputs[0], Lo = out[0], Ro = out[1] || out[0];
    const n = Lo.length;
    if (this.ending === 1 && this.pnN === 0) { // ended ({t: 'bye'}) and faded out: silent, and no longer an active source
      Lo.fill(0); if (Ro !== Lo) Ro.fill(0);
      return false;
    }
    const F0 = typeof currentFrame === 'number' ? currentFrame : this.frames;
    this.frames = F0 + n;
    const I = this.insts;
    let off = 0;
    this.inSpan = 1;
    while (off < n) {
      let len = n - off;
      const F = F0 + off;
      this.spanF = F; // songBeat() of this span (and of a transport applied at F)
      let d = this.songEvents(F);
      if (this.extN) { const d3 = this.extEvents(F); if (d3 < d) d = d3; }
      // the sequencers of the powered Insts (IMPL-1e §2.2; a powered-off one neither fires nor splits spans). Serum's
      // (§12.5): the inputs due at F went in above; its events due at F fire now, the span ends at its next one (4-frame
      // granularity, as song events); the TB-303's
      for (let k = 0; k < I.length; k++) {
        const x = I[k];
        if (x.on !== 1) continue;
        if (x.sqOn === 1) { const sxq = x.sxSeq; sxq.fire(F); const d4 = sxq.next(F); if (d4 < d) d = d4; }
        const q = x.sq;
        if (q && (q.run || q.sync)) { const d2 = x.seqEvents(F); if (d2 < d) d = d2; }
      }
      if (d < len) { len = Math.max(4, Math.ceil(d / 4) * 4); if (len > n - off) len = n - off; }
      this.renderSpan(Lo, Ro, off, len);
      for (let k = 0; k < I.length; k++) { const x = I[k], q = x.sq; if (x.on === 1 && q && q.run && !q.sync) q.pos += len; }
      off += len;
    }
    this.inSpan = 0;
    if (this.mon && (this.monF += n) >= this.base * 0.033) { this.monF = 0; this.postMon(); }
    this.loadT += Date.now() - t0;
    this.statN += n;
    if (this.statN >= this.base * 0.25) this.stats();
    return true;
  }
  // one span (§6.3). The alias shape (simple: the legacy structure, or one Inst into its panel / one Serum into OUT): the
  // Inst renders (a Serum through its own FX), the panel processes a classic Inst's output in place, then panicFade →
  // outStage — 1d's statements. The track skips the span — zero output, no panicFade, no output stage — when the Inst skips
  // (§6.4: only once quiet for 2 s with its FX idle, so the DC block and limiter state freeze during silence)
  renderSpan(Lo, Ro, off, n) {
    if (this.simple !== 1) { this.spanG(Lo, Ro, off, n); return; }
    const I = this.i0;
    if (I.renderSpan(n) === 0) { for (let i = 0; i < n; i++) { Lo[off + i] = 0; if (Ro !== Lo) Ro[off + i] = 0; } return; }
    if (I.kind !== 'serum') { const c = this.c0, r = c.rack; if (r !== null) { const tf = Date.now(); r.process(this.Lb, this.Rb, n); c.t += Date.now() - tf; } }
    if (this.pnN) this.panicFade(n);
    this.outStage(Lo, Ro, off, n);
  }
  // any other graph (IMPL-1e §2.2): every Inst (then the dying ones), every panel in render order (then the dying ones),
  // OUT = the single live source's own buffers at gain 1, else a copy-first sum; skipped when nothing feeding OUT is live
  spanG(Lo, Ro, off, n) {
    const I = this.insts, C = this.chains, DI = this.dyI, DC = this.dyC;
    for (let k = 0; k < I.length; k++) { const x = I[k], tf = Date.now(); x.live = x.renderSpan(n); x.t += Date.now() - tf; }
    for (let k = 0; k < DI.length; k++) { const x = DI[k]; x.live = x.renderSpan(n); }
    for (let k = 0; k < C.length; k++) this.chainSpan(C[k], n);
    for (let k = 0; k < DC.length; k++) this.chainSpan(DC[k], n);
    const S = this.outSrc, G = this.outG, m = this.outN;
    let nl = 0, one = null, g1 = 1;
    for (let k = 0; k < m; k++) if (S[k].live === 1) { nl++; one = S[k]; g1 = G[k]; }
    for (let k = 0; k < DI.length; k++) if (DI[k].live === 1) { nl++; one = DI[k]; g1 = 1; }
    for (let k = 0; k < DC.length; k++) if (DC[k].live === 1) { nl++; one = DC[k]; g1 = 1; }
    if (nl === 0) { // the Track-level skip (§6.4); a panic fade still runs out
      for (let i = 0; i < n; i++) { Lo[off + i] = 0; if (Ro !== Lo) Ro[off + i] = 0; }
      if (this.pnN) { this.pnN = this.pnN > n ? this.pnN - n : 0; if (this.pnN === 0) this.panicClear(); }
      this.bury();
      return;
    }
    if (nl === 1 && g1 === 1 && one.nOut === 1) { this.Lb = one.Lb; this.Rb = one.Rb; }
    else {
      const L = this.oL, R = this.oR;
      let first = true;
      for (let k = 0; k < m; k++) { const s = S[k]; if (s.live === 1) { mixIn(L, R, s, G[k], first, n); first = false; } }
      for (let k = 0; k < DI.length; k++) { const s = DI[k]; if (s.live === 1) { mixIn(L, R, s, 1, first, n); first = false; } }
      for (let k = 0; k < DC.length; k++) { const s = DC[k]; if (s.live === 1) { mixIn(L, R, s, 1, first, n); first = false; } }
      this.Lb = L; this.Rb = R;
    }
    if (this.pnN) this.panicFade(n);
    this.outStage(Lo, Ro, off, n);
    this.bury();
  }
  // one panel's span: its live sources (the single one at gain 1 in place, else copy-first into its own buffers; none: zero
  // input while its rack still has a tail), keyed by its most recent source when no Inst holds its rack, then processed
  chainSpan(c, n) {
    const own = c.ownBy;
    if (own !== null && own.kind === 'serum') { c.live = own.live; return; } // (a Serum's own FX ran inside renderSerum)
    const S = c.srcs, g = c.g, ns = c.ns, r = c.rack;
    let nl = 0, one = null, g1 = 1;
    for (let j = 0; j < ns; j++) if (S[j].live === 1) { nl++; one = S[j]; g1 = g[j]; }
    if (nl === 0) {
      if (r === null || r.idle()) { c.live = 0; return; }
      c.Lb = c.oL; c.Rb = c.oR; c.oL.fill(0, 0, n); c.oR.fill(0, 0, n);
    } else if (nl === 1 && g1 === 1 && one.nOut === 1) { c.Lb = one.Lb; c.Rb = one.Rb; }
    else {
      const L = c.oL, R = c.oR;
      let first = true;
      for (let j = 0; j < ns; j++) { const s = S[j]; if (s.live === 1) { mixIn(L, R, s, g[j], first, n); first = false; } }
      c.Lb = L; c.Rb = R;
    }
    if (r !== null) {
      if (c.drive === 1) { // key tracking: the most recent note-on among its sources
        let b = null;
        for (let j = 0; j < ns; j++) { const s = S[j]; if (s.nOn > 0 && (b === null || s.nOn > b.nOn)) b = s; }
        if (b !== null) r.setNote(b.lastNote);
      }
      const tf = Date.now(); r.process(c.Lb, c.Rb, n); c.t += Date.now() - tf;
    }
    c.live = 1; c.used = 1;
  }
  // drops the dying parts that have gone silent (in place: no allocation)
  bury() {
    const DI = this.dyI, DC = this.dyC;
    if (DI.length === 0 && DC.length === 0) return;
    let w = 0;
    for (let k = 0; k < DI.length; k++) { const x = DI[k]; if (x.live === 1) DI[w++] = x; else x.procs = null; }
    DI.length = w; w = 0;
    for (let k = 0; k < DC.length; k++) { const c = DC[k]; if (c.live === 1) DC[w++] = c; else c.from = null; }
    DC.length = w;
    if (DI.length === 0 && DC.length === 0) this.resolveSimple();
  }
  // stats (every 0.25 s of audio): the track's load, voices and oversampling (of insts[0]), and per part (§6.8 per — the
  // modules' CPU on the canvas). Legacy / simple: the Chain its own processing time, the Inst the rest of the track's;
  // otherwise every Inst its own spans (a Serum's own FX excluded), every panel and every Serum's own FX their processing
  stats() {
    const X = this.insts, I = X[0], c = this.c0, ms = this.statN / this.base * 1000, load = this.loadT / ms;
    const voices = I.kind === 'serum' ? I.sxVoices() : I.act;
    if (this.simple === 1) {
      const fl = c.t / ms;
      this.port.postMessage({ t: 'stats', load, voices, os: I.OS, per: [{ id: I.id, load: Math.max(0, load - fl), voices, os: I.OS }, { id: c.id, load: fl }] });
      this.loadT = 0; this.statN = 0; c.t = 0; I.t = 0; I.fxc.t = 0;
      return;
    }
    const per = [];
    for (let k = 0; k < X.length; k++) {
      const x = X[k], sx = x.kind === 'serum', own = sx ? x.fxc.t : 0;
      per.push({ id: x.id, load: Math.max(0, (x.t - own) / ms), voices: k === 0 ? voices : sx ? x.sxVoices() : x.act, os: x.OS });
    }
    for (const C of this.chains) { per.push({ id: C.id, load: C.t / ms }); C.t = 0; }
    for (const x of X) { if (x.kind === 'serum') per.push({ id: x.fxc.id, load: x.fxc.t / ms }); x.t = 0; x.fxc.t = 0; }
    this.port.postMessage({ t: 'stats', load, voices, os: I.OS, per });
    this.loadT = 0; this.statN = 0;
  }
  // monitor message (§8.4.4, §11.6): Serum's snapshot (null for other models), the rack's gain reduction and phases — each
  // while its part is subscribed (smon: every part; mon: the Inst / Chain ids on screen, SPEC-canvas §6.8)
  // SPEC-serum2 §6.20 / §12.4: snapshot v2; its mix meters 7…10 (Bus 1, Bus 2, Main, Direct) are the engine's peaks since
  // the previous message, in dBFS (−120 = silence). A graph node posts one message per subscribed part (IMPL-1e §2.5): an
  // Inst {i, s, gr, fxph, ftap} (its snapshot and its own FX's meters), a panel or a Serum's own FX {c, gr, fxph, ftap}
  postMon() {
    const SD = globalThis.SerumDSP;
    if (this.graphed === 0) {
      const I = this.i0, c = this.c0, r = c.mon ? c.rack : null, s = I.mon && SD && I.kind === 'serum' && I.sx ? SD.snapshot(I) : null;
      if (s && s.mix && s.mix.length >= 11) {
        const pk = I.mixPk;
        for (let k = 0; k < 4; k++) s.mix[7 + k] = pk[k] > 1e-6 ? 20 * Math.log10(pk[k]) : -120;
      }
      I.mixPk.fill(0);
      const ftap = r && typeof r.tapOut === 'function' ? r.tapOut() : null;
      this.port.postMessage({ t: 'smon', s, gr: r ? r.gr() : null, fxph: r ? r.phases() : null, ftap });
      return;
    }
    for (const I of this.insts) {
      const sx = I.kind === 'serum', r = sx ? I.rack : null;
      if (I.mon) {
        const s = SD && sx && I.sx ? SD.snapshot(I) : null;
        if (s && s.mix && s.mix.length >= 11) {
          const pk = I.mixPk;
          for (let k = 0; k < 4; k++) s.mix[7 + k] = pk[k] > 1e-6 ? 20 * Math.log10(pk[k]) : -120;
        }
        const ftap = r && typeof r.tapOut === 'function' ? r.tapOut() : null;
        this.port.postMessage({ t: 'smon', i: I.id, s, gr: r ? r.gr() : null, fxph: r ? r.phases() : null, ftap });
      }
      if (sx && I.fxc.mon) {
        const ftap = r && typeof r.tapOut === 'function' ? r.tapOut() : null;
        this.port.postMessage({ t: 'smon', c: I.fxc.id, gr: r ? r.gr() : null, fxph: r ? r.phases() : null, ftap });
      }
      I.mixPk.fill(0);
    }
    for (const c of this.chains) if (c.mon) {
      const r = c.rack, ftap = r && typeof r.tapOut === 'function' ? r.tapOut() : null;
      this.port.postMessage({ t: 'smon', c: c.id, gr: r ? r.gr() : null, fxph: r ? r.phases() : null, ftap });
    }
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

registerProcessor('synth-engine', Track);
