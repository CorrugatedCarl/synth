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

// band-limited analog oscillator core
function wave(t, dt, sa, pu, tri, si, pw, bow) {
  let y = 0;
  if (sa !== 0) y += sa * (2 * (t + bow * t * (1 - t)) - 1 - blep(t, dt));
  if (pu !== 0) {
    let t2 = t - pw; if (t2 < 0) t2 += 1;
    y += pu * ((t < pw ? 1 : -1) + blep(t, dt) - blep(t2, dt));
  }
  if (tri !== 0) {
    let t2 = t + 0.5; if (t2 >= 1) t2 -= 1;
    y += tri * ((t < 0.5 ? 4 * t - 1 : 3 - 4 * t) + 4 * dt * (blamp(t, dt) - blamp(t2, dt)));
  }
  if (si !== 0) y += si * sin1(t);
  return y;
}

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
// 4-pole cascade, zero-delay feedback, per-sample secant linearisation.
//  ota=false: transistor ladder  dy_i = g(tanh(y_{i-1}) - tanh(y_i))
//  ota=true : OTA cascade        dy_i = g tanh(y_{i-1} - y_i)
class Ladder {
  constructor(ota) {
    this.ota = ota; this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0;
    this.g = 0.05; this.k = 0; this.comp = 0; this.fbSat = 0; this.tap2 = false; this.gScale = 1;
  }
  setRes(r) { this.k = 4.15 * r; }
  process(x) {
    const g = this.g, s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
    let k = this.k;
    if (this.fbSat !== 0) k *= tr(k * s3 * this.fbSat);
    const xin = x * (1 + this.comp * this.k);
    let G0, G1, G2, G3, d0, d1, d2, d3;
    if (!this.ota) {
      const t0 = tr(s0), t1 = tr(s1), t2 = tr(s2), t3 = tr(s3), tx = tr(xin - k * s3);
      d0 = 1 / (1 + g * t0); d1 = 1 / (1 + g * t1); d2 = 1 / (1 + g * t2); d3 = 1 / (1 + g * t3);
      G0 = g * tx * d0; G1 = g * t0 * d1; G2 = g * t1 * d2; G3 = g * t2 * d3;
    } else {
      const a0 = g * tr(xin - k * s3 - s0), a1 = g * tr(s0 - s1), a2 = g * tr(s1 - s2), a3 = g * tr(s2 - s3);
      d0 = 1 / (1 + a0); d1 = 1 / (1 + a1); d2 = 1 / (1 + a2); d3 = 1 / (1 + a3);
      G0 = a0 * d0; G1 = a1 * d1; G2 = a2 * d2; G3 = a3 * d3;
    }
    const S0 = s0 * d0, S1 = s1 * d1, S2 = s2 * d2, S3 = s3 * d3;
    const Gt = G0 * G1 * G2 * G3;
    const St = ((S0 * G1 + S1) * G2 + S2) * G3 + S3;
    const y3 = (Gt * xin + St) / (1 + k * Gt);
    const u = xin - k * y3;
    const y0 = G0 * u + S0, y1 = G1 * y0 + S1, y2 = G2 * y1 + S2;
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
  constructor() { this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0; this.xp = 0; this.g = 0.05; this.k = 0; this.gScale = 1 / DIODE.w; }
  setRes(r) { this.k = DIODE.k * 1.04 * r; }
  process(x) {
    const g = this.g, K = this.k, c0 = DIODE_C[0], c1 = DIODE_C[1], c2 = DIODE_C[2], c3 = DIODE_C[3];
    let y0 = this.y0, y1 = this.y1, y2 = this.y2, y3 = this.y3;
    const xe = x - K * y3;
    const g01 = tr(xe - y0), g12 = tr(y0 - y1), g23 = tr(y1 - y2), g34 = tr(y2 - y3), g4 = tr(y3);
    const Kf = K * tr(0.25 * K * y3);
    const a00 = -c0 * (g01 + g12), a01 = c0 * g12, a03 = -c0 * g01 * Kf, b0 = c0 * g01;
    const a10 = c1 * g12, a11 = -c1 * (g12 + g23), a12 = c1 * g23;
    const a21 = c2 * g23, a22 = -c2 * (g23 + g34), a23 = c2 * g34;
    const a32 = c3 * g34, a33 = -c3 * (g34 + g4);
    const xs = x + this.xp; this.xp = x;
    const r0 = y0 + g * (a00 * y0 + a01 * y1 + a03 * y3 + b0 * xs);
    let r1 = y1 + g * (a10 * y0 + a11 * y1 + a12 * y2);
    let r2 = y2 + g * (a21 * y1 + a22 * y2 + a23 * y3);
    let r3 = y3 + g * (a32 * y2 + a33 * y3);
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
    this.y0 = y0; this.y1 = y1; this.y2 = y2; this.y3 = y3;
    // passband make-up gain (the bare ladder has 1/(5+K) DC gain); partial, so bass still thins with resonance
    return y3 * (5 + 0.55 * K);
  }
}

// Sallen-Key low-pass with diode-clipped positive feedback (Korg 35 / MS-20)
class SKLow {
  constructor() { this.u = 0; this.b = 0; this.xp = 0; this.g = 0.05; this.K = 0; this.clip = 1.6; this.gScale = 1; }
  setRes(r) { this.K = 3.55 * r; }
  process(x) {
    const g = this.g, u = this.u, b = this.b;
    x = x * tr(x * 0.7);
    const Kt = this.K * tr(this.K * b / this.clip);
    const xs = x + this.xp; this.xp = x;
    const r0 = u + g * (-2 * u + (1 - 2 * Kt) * b + xs);
    const r1 = b + g * (u + (Kt - 1) * b);
    const m00 = 1 + 2 * g, m01 = -g * (1 - 2 * Kt), m10 = -g, m11 = 1 - g * (Kt - 1);
    const det = m00 * m11 - m01 * m10;
    this.u = (r0 * m11 - m01 * r1) / det;
    this.b = (m00 * r1 - m10 * r0) / det;
    return this.b;
  }
}
// Sallen-Key high-pass, same feedback topology
class SKHigh {
  constructor() { this.v1 = 0; this.v2 = 0; this.xp = 0; this.g = 0.01; this.K = 0; this.clip = 1.6; this.gScale = 1; }
  setRes(r) { this.K = 3.55 * r; }
  process(x) {
    const g = this.g, v1 = this.v1, v2 = this.v2;
    const be = x - v1 - v2;
    const Kt = this.K * tr(this.K * be / this.clip);
    const xs = x + this.xp; this.xp = x;
    const r0 = v1 + g * ((Kt - 2) * v1 + (Kt - 1) * v2 + (2 - Kt) * xs);
    const r1 = v2 + g * (-v1 - v2 + xs);
    const m00 = 1 - g * (Kt - 2), m01 = -g * (Kt - 1), m10 = g, m11 = 1 + g;
    const det = m00 * m11 - m01 * m10;
    this.v1 = (r0 * m11 - m01 * r1) / det;
    this.v2 = (m00 * r1 - m10 * r0) / det;
    return x - this.v1 - this.v2;
  }
}

// State-variable filter with saturating band-pass integrator
class SVF {
  constructor() { this.s1 = 0; this.s2 = 0; this.g = 0.05; this.R = 1; this.mode = 0; this.morph = 0; this.sat = 0.5; this.gScale = 1; }
  setRes(r) { this.R = 1 - 0.985 * Math.min(1, Math.max(0, r)); }
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
  constructor() { this.s = 0; this.g = 0.001; this.gScale = 1; }
  setRes() {}
  process(x) {
    const G = this.g / (1 + this.g);
    const v = (x - this.s) * G, lp = v + this.s;
    this.s = lp + v;
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
    case 'sk': return new SKHigh();
    case 'svf': { const f = new SVF(); f.mode = 1; return f; }
    default: return null;
  }
}

/* ------------------------------------------------------- analog voice */
class AVoice {
  constructor(e, i) {
    this.e = e; this.i = i;
    this.r = ((0x9E3779B9 * (i + 7)) >>> 0) || 1;
    this.ph0 = this.rnd01(); this.ph1 = this.rnd01(); this.ph2 = this.rnd01();
    this.sub = 1; this.y1p = 0; this.fbp = 0; this.mlp = 0; this.mlp2 = 0;
    this.pk0 = 0; this.pk1 = 0; this.pk2 = 0;
    this.note = -1; this.pitch = 60; this.target = 60; this.vel = 0.8;
    this.gate = false; this.active = false; this.stamp = 0; this.sus = false; this.glc = 1;
    this.acc = 0; this.accS = 0; this.lfoT = 0;
    this.tol0 = this.rnd(); this.tol1 = this.rnd(); this.tol2 = this.rnd(); this.tolC = this.rnd(); this.tolE = this.rnd();
    this.d0 = 0; this.d1 = 0; this.d2 = 0;
    this.fenv = new Env(); this.aenv = new Env();
    this.g = 0.01; this.gh = 0.001; this.g2 = 0.01; this.gh2 = 0.001;
    this.f = null; this.h = null; this.f2 = null; this.h2 = null;
    this.ft = ''; this.ht = ''; this.ft2 = ''; this.ht2 = '';
  }
  rnd() { let x = this.r; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.r = x >>> 0; return this.r / 2147483648 - 1; }
  rnd01() { return (this.rnd() + 1) * 0.5; }
  cfgLP(f, c) {
    f.setRes(c.res);
    if (f instanceof Ladder) { f.comp = c.comp || 0; f.fbSat = c.fbSat || 0; f.tap2 = c.poles === 2; }
    if (f instanceof SVF) { f.mode = c.mode === undefined ? 0 : c.mode; f.morph = c.morph || 0; f.sat = c.sat || 0.5; }
    if (f instanceof SKLow) f.clip = c.clip || 1.6;
  }
  apply(p) {
    const e = this.e;
    if (this.ft !== p.vcf.type) { this.f = makeLP(p.vcf.type); this.ft = p.vcf.type; }
    this.cfgLP(this.f, p.vcf);
    if (this.ht !== p.hpf.type) { this.h = makeHP(p.hpf.type); this.ht = p.hpf.type; }
    if (this.h) { this.h.setRes(p.hpf.res || 0); if (this.h instanceof SKHigh) this.h.clip = p.hpf.clip || 1.6; }
    if (p.dual) {
      const d = p.dual;
      if (this.ft2 !== p.vcf.type) { this.f2 = makeLP(p.vcf.type); this.ft2 = p.vcf.type; }
      this.cfgLP(this.f2, Object.assign({}, p.vcf, { res: d.res }));
      if (this.ht2 !== p.hpf.type) { this.h2 = makeHP(p.hpf.type); this.ht2 = p.hpf.type; }
      if (this.h2) this.h2.setRes(d.hres || 0);
    }
    const tf = 1 + 0.07 * this.tolE * p.drift;
    const A = p.aenv, F = p.fenv;
    this.aenv.set(A.a * tf, A.d * tf, A.s, A.r * tf, e.fs, p.envOv);
    this.fenv.set(F.a * tf, F.d * tf, F.s, F.r * tf, e.fs / e.CH, p.envOv);
  }
  noteOn(n, v, legato, glc) {
    const p = this.e.p;
    this.note = n; this.target = n + (this.det || 0); this.vel = v; this.glc = glc;
    if (glc >= 1) this.pitch = this.target;
    if (p.tb) {
      this.acc = (p.tb.latch || v > 0.79) ? 1 : 0;
      this.fenv.setDecay(this.acc ? 0.2 : p.fenv.d, this.e.fs / this.e.CH);
    }
    if (!legato || !this.gate) {
      this.fenv.on(); this.aenv.on(); this.lfoT = 0;
      if (p.tb) this.fenv.v = 0; // 303 MEG discharges on each new gate
    } else if (p.tb && this.acc) { this.fenv.on(); }
    this.gate = true; this.active = true; this.sus = false;
  }
  noteOff() { this.gate = false; this.fenv.off(); this.aenv.off(); }
  render(buf, N) {
    const e = this.e, p = e.p, CH = e.CH, fs = e.fs, ifs = 1 / fs;
    const O0 = p.osc[0], O1 = p.osc[1], O2 = p.osc[2];
    const vcf = p.vcf, hpf = p.hpf, L = p.lfo, tb = p.tb, m3 = p.mod3, dual = p.dual;
    const f = this.f, h = this.h, f2 = this.f2, h2 = this.h2;
    const drift = p.drift, bow = p.sawBow, bwc = e.bwc;
    const on0 = O0.on, on1 = O1.on, on2 = O2.on || (m3 ? 1 : 0);
    const sa0 = O0.saw, pu0 = O0.pulse, tri0 = O0.tri, si0 = O0.sine, lev0 = O0.lev;
    const sa1 = O1.saw, pu1 = O1.pulse, tri1 = O1.tri, si1 = O1.sine, lev1 = O1.lev;
    const sa2 = O2.saw, pu2 = O2.pulse, tri2 = O2.tri, si2 = O2.sine, lev2 = O2.lev;
    const subL = p.sub, nzL = p.noise, pink = p.pink, ringL = p.ring, extL = p.ext;
    const fm01 = p.fm01, fm10 = p.fm10, sync = p.sync, pOscPw = p.polyOscPw, pOscF = p.polyOscFilt;
    const needNoise = nzL !== 0 || (m3 && m3.mix > 0);
    const drv = vcf.drive || 1, odrv = 1 / Math.sqrt(drv);
    const gMax = Math.tan(Math.PI * 0.46);
    const nCh = N / CH;
    let ph0 = this.ph0, ph1 = this.ph1, ph2 = this.ph2, sub = this.sub, y1p = this.y1p;
    let mlp = this.mlp, mlp2 = this.mlp2, fbp = this.fbp, pk0 = this.pk0, pk1 = this.pk1, pk2 = this.pk2;
    let g = this.g, gh = this.gh, g2 = this.g2, gh2 = this.gh2;
    const ae = this.aenv;
    let idx = 0;
    for (let c = 0; c < nCh; c++) {
      /* ---- control rate ---- */
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
        this.d0 += (this.rnd() - this.d0) * e.ouB;
        this.d1 += (this.rnd() - this.d1) * e.ouB;
        this.d2 += (this.rnd() - this.d2) * e.ouB;
      }
      const dn = drift * e.ouN;
      const base = this.pitch + e.bend + e.gdrift * drift + lfo * (L.pitch + e.wheel * L.wheelPitch) + e.at * (p.atPitch || 0);
      const bnk = 60 + e.bend;
      let s0 = (O0.kbd ? base : bnk) + O0.oct + O0.fine * 0.01 + drift * 0.03 * this.tol0 + 0.04 * this.d0 * dn + O0.envPitch * fe + O0.lfoPitch * lfo;
      let s1 = (O1.kbd ? base : bnk) + O1.oct + O1.fine * 0.01 + drift * 0.03 * this.tol1 + 0.04 * this.d1 * dn + O1.envPitch * fe + O1.lfoPitch * lfo;
      let s2 = (O2.kbd ? base : bnk) + O2.oct + O2.fine * 0.01 + drift * 0.03 * this.tol2 + 0.04 * this.d2 * dn + O2.envPitch * fe + O2.lfoPitch * lfo;
      let dt0 = 440 * Math.pow(2, (s0 - 69) / 12) * ifs; if (dt0 > 0.45) dt0 = 0.45;
      let dt1 = 440 * Math.pow(2, (s1 - 69) / 12) * ifs; if (dt1 > 0.45) dt1 = 0.45;
      let dt2 = 440 * Math.pow(2, (s2 - 69) / 12) * ifs; if (dt2 > 0.45) dt2 = 0.45;
      let pw0 = O0.pw + O0.pwLfo * lfo + O0.pwEnv * fe; pw0 = pw0 < 0.02 ? 0.02 : pw0 > 0.98 ? 0.98 : pw0;
      const pw1b = O1.pw + O1.pwLfo * lfo + O1.pwEnv * fe;
      let pw2 = O2.pw + O2.pwLfo * lfo; pw2 = pw2 < 0.02 ? 0.02 : pw2 > 0.98 ? 0.98 : pw2;
      // filter cutoff (octaves above 1 Hz)
      const fmod = vcf.envOff + vcf.env * fe + vcf.kbd * (this.pitch - 60) / 12 +
        lfo * (vcf.lfo + e.wheel * L.wheelFilter) + vcf.vel * (this.vel - 0.75) + 0.05 * this.tolC * drift + e.at * (vcf.at || 0);
      let co = vcf.oct + fmod;
      let amp = p.level * (1 - p.velAmp * (1 - this.vel)) * (1 + L.amp * lfo);
      if (tb) {
        const tgt = this.acc ? tb.accent * fe : 0;
        this.accS += (tgt - this.accS) * (tgt > this.accS ? tb.chg : tb.dis);
        co += this.accS * 2.2;
        amp *= 1 + this.acc * tb.accent * 0.9;
      }
      let fc = Math.pow(2, co); if (fc < 5) fc = 5; if (fc > e.fcMax) fc = e.fcMax;
      const gT = Math.tan(Math.PI * fc * ifs) * f.gScale;
      const gInc = (gT - g) / CH;
      let ghInc = 0, g2Inc = 0, gh2Inc = 0;
      if (h) {
        let fh = Math.pow(2, hpf.oct + (hpf.env || 0) * fe + (hpf.kbd || 0) * (this.pitch - 60) / 12 + lfo * (hpf.lfo || 0));
        if (fh < 5) fh = 5; if (fh > e.fcMax) fh = e.fcMax;
        ghInc = (Math.tan(Math.PI * fh * ifs) - gh) / CH;
      }
      if (dual) {
        let fc2 = Math.pow(2, dual.oct + fmod); if (fc2 < 5) fc2 = 5; if (fc2 > e.fcMax) fc2 = e.fcMax;
        g2Inc = (Math.tan(Math.PI * fc2 * ifs) * f2.gScale - g2) / CH;
        if (h2) {
          let fh2 = Math.pow(2, dual.hoct); if (fh2 > e.fcMax) fh2 = e.fcMax;
          gh2Inc = (Math.tan(Math.PI * fh2 * ifs) - gh2) / CH;
        }
      }
      const wm = e.wheel;
      /* ---- audio rate ---- */
      for (let j = 0; j < CH; j++, idx++) {
        const a = ae.tick();
        let nz = 0;
        if (needNoise) {
          nz = this.rnd();
          if (pink) { // Kellet economy pink
            pk0 = 0.99765 * pk0 + nz * 0.0990460; pk1 = 0.96300 * pk1 + nz * 0.2965164; pk2 = 0.57000 * pk2 + nz * 1.0526913;
            nz = (pk0 + pk1 + pk2 + nz * 0.1848) * 0.22;
          }
        }
        let w2 = 0;
        if (on2) { ph2 += dt2; if (ph2 >= 1) ph2 -= 1; w2 = wave(ph2, dt2, sa2, pu2, tri2, si2, pw2, bow); }
        let d0 = dt0, d1 = dt1, m = 0;
        if (m3) {
          m = (1 - m3.mix) * w2 + m3.mix * nz;
          if (m3.osc) { const k = exp2(m * wm * 0.7); d0 *= k; d1 *= k; }
        }
        if (fm10 !== 0) d0 *= exp2(fm10 * y1p);
        if (d0 > 0.45) d0 = 0.45;
        let w0 = 0, wrap = false;
        if (on0) {
          ph0 += d0;
          if (ph0 >= 1) { ph0 -= 1; wrap = true; sub = -sub; }
          w0 = wave(ph0, d0, sa0, pu0, tri0, si0, pw0, bow);
        }
        let w1 = 0;
        if (on1) {
          if (fm01 !== 0) { d1 *= exp2(fm01 * w0); if (d1 > 0.45) d1 = 0.45; }
          ph1 += d1;
          if (sync && wrap) ph1 = ph0 * d1 / d0;
          if (ph1 >= 1) ph1 -= Math.floor(ph1);
          let pw1 = pw1b + pOscPw * w0; pw1 = pw1 < 0.02 ? 0.02 : pw1 > 0.98 ? 0.98 : pw1;
          w1 = wave(ph1, d1, sa1, pu1, tri1, si1, pw1, bow);
          y1p = w1;
        }
        let y;
        if (!dual) {
          let mix = w0 * lev0 + w1 * lev1 + w2 * lev2;
          if (subL !== 0) mix += subL * (sub + (ph0 < 0.5 ? sub : -sub) * blep(ph0, d0));
          if (nzL !== 0) mix += nzL * nz;
          if (ringL !== 0) mix += ringL * w0 * w1;
          if (extL !== 0) mix += extL * fbp;
          mlp += (mix - mlp) * bwc;
          let x = mlp;
          if (h) { gh += ghInc; h.g = gh; x = h.process(x); }
          g += gInc;
          let gg = g;
          if (m3 && m3.filt) gg *= exp2(m * wm * 2.5);
          if (pOscF !== 0) gg *= exp2(pOscF * w0);
          f.g = gg > gMax ? gMax : gg;
          y = f.process(x * drv + this.rnd() * 1e-6) * odrv;
          fbp = y;
        } else {
          const n2 = nzL * nz * 0.5;
          mlp += (w0 * lev0 + n2 + ringL * w0 * w1 - mlp) * bwc;
          mlp2 += (w1 * lev1 + n2 - mlp2) * bwc;
          let xa = mlp, xb = mlp2;
          if (h) { gh += ghInc; h.g = gh; xa = h.process(xa); }
          if (h2) { gh2 += gh2Inc; h2.g = gh2; xb = h2.process(xb); }
          g += gInc; g2 += g2Inc;
          f.g = g > gMax ? gMax : g; f2.g = g2 > gMax ? gMax : g2;
          y = (f.process(xa * drv + this.rnd() * 1e-6) + f2.process(xb * drv + this.rnd() * 1e-6)) * odrv;
        }
        buf[idx] += y * a * amp;
      }
    }
    this.ph0 = ph0; this.ph1 = ph1; this.ph2 = ph2; this.sub = sub; this.y1p = y1p;
    this.mlp = mlp; this.mlp2 = mlp2; this.fbp = fbp; this.pk0 = pk0; this.pk1 = pk1; this.pk2 = pk2;
    this.g = g; this.gh = gh; this.g2 = g2; this.gh2 = gh2;
    if (!this.gate && ae.st === 0) this.active = false;
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
  render(buf, N) {
    const e = this.e, p = e.p, CH = e.CH, fs = e.fs, ct = CH / fs, nCh = N / CH;
    const alg = ALGS[p.alg - 1], mods = alg.mods, isCar = alg.isCar, fbSrc = alg.fbSrc, fbDst = alg.fbDst;
    const fbAmt = p.fb > 0 ? 0.24 * Math.pow(2, p.fb - 7) : 0;
    const norm = p.level / Math.sqrt(alg.nCar);
    const ph = this.ph, lv = this.lv, st = this.st, amp = this.amp, ainc = this.ainc, dt = this.dt, out = this.out;
    const m0 = mods[0], m1 = mods[1], m2 = mods[2], m3 = mods[3], m4 = mods[4], m5 = mods[5];
    const M = [m0, m1, m2, m3, m4, m5];
    let fbA = this.fbA, fbB = this.fbB, idx = 0, alive = false;
    for (let c = 0; c < nCh; c++) {
      this.pitch += (this.target - this.pitch) * this.glc;
      const vib = e.lfoBuf[c] * (p.lfo.pitch + e.wheel * p.lfo.wheelPitch);
      const hz = 440 * Math.pow(2, (this.pitch + (p.transpose || 0) + e.bend + vib - 69) / 12);
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
        ainc[k] = (A - amp[k]) / CH;
        if (isCar[k] && (A > 1e-5 || s < 3)) alive = true;
        dt[k] = (op.fixed ? op.hz : hz * op.ratio) * op.det / fs;
      }
      for (let j = 0; j < CH; j++, idx++) {
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
  allOff() { this.gate.fill(0); }
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
    const bend = Math.pow(2, e.bend / 12);
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
      buf[i] += y * p.level;
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
// Roland Juno BBD chorus: two MN3009 lines with opposite triangle LFO
class Chorus {
  constructor(fs) {
    this.fs = fs; let sz = 1; while (sz < fs * 0.03) sz <<= 1;
    this.buf = new Float64Array(sz); this.mask = sz - 1; this.w = 0; this.ph = 0; this.mode = 0; this.hiss = 0;
    this.pre = new Biquad2(); this.pl = new Biquad2(); this.pr = new Biquad2();
    this.pre.set(9500, fs); this.pl.set(9000, fs); this.pr.set(9000, fs);
    this.r = 22222;
  }
  process(x, L, R, n) {
    const mode = this.mode;
    if (!mode) { for (let i = 0; i < n; i++) L[i] = R[i] = x[i]; return; }
    const P = CHORUS_MODES[mode];
    const fs = this.fs, rate = P[0] / fs, ctr = (P[1] + P[2]) * 0.5 * fs, dep = (P[2] - P[1]) * 0.5 * fs;
    const buf = this.buf, mask = this.mask, hs = this.hiss * 2e-4;
    let w = this.w, ph = this.ph;
    for (let i = 0; i < n; i++) {
      const v = this.pre.process(x[i]);
      buf[w & mask] = v * tr(v * 0.3);
      ph += rate; if (ph >= 1) ph -= 1;
      const tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      let nz = 0;
      if (hs) { let r = this.r; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; this.r = r >>> 0; nz = (this.r / 2147483648 - 1) * hs; }
      const a = hermite(buf, mask, w - ctr - dep * tri), b = hermite(buf, mask, w - ctr + dep * tri);
      L[i] = (x[i] + this.pl.process(a + nz)) * 0.72;
      R[i] = (x[i] + this.pr.process(b - nz)) * 0.72;
      w++;
    }
    this.w = w & mask; this.ph = ph;
  }
}

// Solina-style 3-phase string ensemble
class Ensemble {
  constructor(fs) {
    this.fs = fs; let sz = 1; while (sz < fs * 0.04) sz <<= 1;
    this.buf = new Float64Array(sz); this.mask = sz - 1; this.w = 0; this.ps = 0; this.pf = 0; this.on = 0;
    this.pre = new Biquad2(); this.pl = new Biquad2(); this.pr = new Biquad2();
    this.pre.set(8000, fs); this.pl.set(7500, fs); this.pr.set(7500, fs);
  }
  process(x, L, R, n) {
    if (!this.on) { for (let i = 0; i < n; i++) L[i] = R[i] = x[i]; return; }
    const fs = this.fs, rs = 0.63 / fs, rf = 6.3 / fs, buf = this.buf, mask = this.mask;
    let w = this.w, ps = this.ps, pf = this.pf;
    const third = 1 / 3;
    for (let i = 0; i < n; i++) {
      const v = this.pre.process(x[i]);
      buf[w & mask] = v;
      ps += rs; if (ps >= 1) ps -= 1; pf += rf; if (pf >= 1) pf -= 1;
      const t0 = hermite(buf, mask, w - (6.0e-3 + 1.9e-3 * sin1(ps) + 0.32e-3 * sin1(pf + 0.1)) * fs);
      const t1 = hermite(buf, mask, w - (6.0e-3 + 1.9e-3 * sin1(ps + third) + 0.32e-3 * sin1(pf + third + 0.1)) * fs);
      const t2 = hermite(buf, mask, w - (6.0e-3 + 1.9e-3 * sin1(ps + 2 * third) + 0.32e-3 * sin1(pf + 2 * third + 0.1)) * fs);
      L[i] = this.pl.process(t0 + 0.6 * t1) * 0.85 + x[i] * 0.15;
      R[i] = this.pr.process(t2 + 0.6 * t1) * 0.85 + x[i] * 0.15;
      w++;
    }
    this.w = w & mask; this.ps = ps; this.pf = pf;
  }
}

/* -------------------------------------------------------------- engine */
const DEFAULT_PATCH = {
  engine: 'analog', mode: 'poly', poly: 8, prio: 'last', legato: true, glide: 0, glideLegato: false,
  unison: 1, unisonDetune: 0, bendRange: 2, drift: 0.5, envOv: 1.3, sawBow: 0, bw: 24000, level: 0.4,
  osc: [0, 1, 2].map(i => ({ on: i === 0 ? 1 : 0, lev: 1, oct: 0, fine: 0, saw: 1, pulse: 0, tri: 0, sine: 0, pw: 0.5, pwLfo: 0, pwEnv: 0, kbd: 1, envPitch: 0, lfoPitch: 0 })),
  sub: 0, noise: 0, pink: 0, ring: 0, ext: 0, sync: 0, fm01: 0, fm10: 0, polyOscPw: 0, polyOscFilt: 0,
  hpf: { type: 'none', oct: 4.3, res: 0 }, vcf: { type: 'moog', oct: 11, res: 0.2, env: 2, envOff: 0, kbd: 0.5, lfo: 0, vel: 0, drive: 1 },
  dual: null, mod3: null, tb: null, velAmp: 0,
  fenv: { a: 0.01, d: 0.4, s: 0.4, r: 0.3 }, aenv: { a: 0.005, d: 0.3, s: 1, r: 0.3 },
  lfo: { rate: 5, wave: 0, delay: 0, pitch: 0, amp: 0, wheelPitch: 0.6, wheelFilter: 0 },
  fx: { chorus: 0, ensemble: 0, hiss: 0 }, dac: 0,
};

class SynthProcessor extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    this.base = sampleRate;
    this.p = DEFAULT_PATCH;
    this.bend = 0; this.bendRaw = 0; this.wheel = 0; this.at = 0; this.sustain = false;
    this.held = []; this.stamp = 0; this.monoGate = false;
    this.lfoPh = 0; this.lfoSH = 0; this.gdrift = 0; this.r = 987654321;
    this.load = 0; this.loadT = 0; this.statN = 0;
    this.setOS((opt && opt.processorOptions && opt.processorOptions.os) || 4);
    this.chorus = new Chorus(this.base); this.ens = new Ensemble(this.base);
    this.dcx = [0, 0]; this.dcy = [0, 0];
    this.monoBuf = new Float64Array(128); this.Lb = new Float64Array(128); this.Rb = new Float64Array(128); this.act = 0;
    this.dacHold = 0; this.dacT = 0;
    this.kind = '';
    this.setPatch(DEFAULT_PATCH);
    this.port.onmessage = (ev) => this.msg(ev.data);
  }
  rnd() { let x = this.r; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.r = x >>> 0; return this.r / 2147483648 - 1; }
  setOS(os) {
    this.OS = os; this.fs = this.base * os; this.CH = 4 * os;
    this.buf = new Float64Array(128 * os);
    this.tmp = [new Float64Array(64 * os), new Float64Array(32 * os), new Float64Array(16 * os)];
    this.dec = [];
    let s = os;
    while (s > 1) { this.dec.push(s === 2 ? new Halfband(127, 10) : new Halfband(35, 9)); s >>= 1; }
    this.lfoBuf = new Float64Array(32);
    this.fcMax = Math.min(40000, this.fs * 0.45);
    const cr = this.fs / this.CH;
    this.ouB = 1 - Math.exp(-TAU * 0.35 / cr);
    this.ouN = 1 / Math.sqrt(this.ouB / 6);
    this.gouB = 1 - Math.exp(-TAU * 0.05 / (this.base / 128));
    if (this.voices) { this.recalc(); for (const v of this.voices) v.apply(this.p); }
  }
  recalc() {
    const p = this.p;
    this.bwc = 1 - Math.exp(-TAU * Math.min(p.bw || 24000, this.fs * 0.45) / this.fs);
  }
  setPatch(p) {
    const old = this.p;
    this.p = p;
    const kind = p.engine;
    const nv = kind === 'divide' ? 0 : p.mode === 'poly' ? p.poly : Math.max(1, p.unison || 1);
    if (kind !== this.kind || !this.voices || this.voices.length !== nv || old.mode !== p.mode) {
      this.allOff(true);
      this.kind = kind;
      this.voices = [];
      for (let i = 0; i < nv; i++) this.voices.push(kind === 'fm' ? new FVoice(this, i) : new AVoice(this, i));
      if (kind === 'divide' && !this.div) this.div = new Divide(this);
      this.held = []; this.monoGate = false;
    }
    const n = this.voices.length;
    for (let i = 0; i < n; i++) this.voices[i].det = p.mode === 'unison' && n > 1 ? (i / (n - 1) - 0.5) * 2 * p.unisonDetune / 100 : 0;
    this.recalc();
    for (const v of this.voices) v.apply(p);
    this.chorus.mode = p.fx.chorus | 0; this.chorus.hiss = p.fx.hiss || 0;
    this.ens.on = p.fx.ensemble | 0;
    this.bend = this.bendRaw * (p.bendRange || 2);
  }
  allOff(hard) {
    if (this.voices) for (const v of this.voices) { v.noteOff(); v.sus = false; if (hard) { v.active = false; v.gate = false; } }
    if (this.div) this.div.allOff();
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
      case 'off': this.noteOff(d.n); break;
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
      case 'os': this.setOS(d.v); break;
      case 'panic': this.allOff(true); if (this.sq) this.sq.run = false; break;
      case 'seq': this.seqMsg(d.s); break;
    }
  }
  noteOn(n, v) {
    const p = this.p;
    if (this.kind === 'divide') { this.div.noteOn(n); return; }
    if (p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i >= 0) this.held.splice(i, 1);
      this.held.push(n);
      this.monoPlay(v, true);
      return;
    }
    let vc = null;
    for (const x of this.voices) if (x.active && x.note === n) { vc = x; break; }
    if (!vc) {
      let best = null;
      for (const x of this.voices) if (!x.active && (!best || x.stamp < best.stamp)) best = x;
      if (!best) for (const x of this.voices) if (!x.gate && (!best || x.stamp < best.stamp)) best = x;
      if (!best) for (const x of this.voices) if (!best || x.stamp < best.stamp) best = x;
      vc = best;
    }
    vc.stamp = ++this.stamp;
    vc.noteOn(n, v, false, this.glc(false));
  }
  monoPlay(v, fresh) {
    const p = this.p, h = this.held;
    let n;
    if (p.prio === 'low') n = Math.min.apply(null, h);
    else if (p.prio === 'high') n = Math.max.apply(null, h);
    else n = h[h.length - 1];
    const legato = this.monoGate && p.legato;
    const g = this.glc(this.monoGate);
    for (const x of this.voices) x.noteOn(n, fresh ? v : x.vel, legato, g);
    this.monoGate = true;
  }
  noteOff(n) {
    const p = this.p;
    if (this.kind === 'divide') { this.div.gate[n] = this.sustain && this.div.gate[n] ? 2 : 0; return; }
    if (p.mode !== 'poly') {
      const i = this.held.indexOf(n); if (i < 0) return;
      const wasTop = this.voices[0] && this.voices[0].note === n;
      this.held.splice(i, 1);
      if (this.held.length) { if (wasTop) this.monoPlay(this.voices[0].vel, false); }
      else if (!this.sustain) { this.monoGate = false; for (const x of this.voices) x.noteOff(); }
      return;
    }
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
    this.lfoPh = ph;
  }
  /* ---- TB-303 style step sequencer, clocked in the audio thread ---- */
  seqMsg(s) {
    const q = this.sq || (this.sq = { run: false, pat: [], len: 16, bpm: 120, root: 36, step: -1, pos: 0, fired: true, offed: true, tie: false, cur: -1, swing: 0 });
    const wasRun = q.run;
    Object.assign(q, s);
    q.spb = this.base * 60 / Math.max(20, q.bpm) / 4;
    if (q.run && !wasRun) { q.step = -1; q.stepLen = q.spb; q.pos = q.spb; q.tie = false; q.cur = -1; }
    if (!q.run && wasRun) this.seqRelease();
  }
  seqRelease() {
    const q = this.sq;
    if (q && q.cur >= 0 && this.voices) for (const v of this.voices) if (v.gate) v.noteOff();
    if (q) { q.cur = -1; q.tie = false; }
    this.monoGate = false;
  }
  seqEvents() { // returns frames until the next sequencer event
    const q = this.sq, p = this.p;
    if (!q || !q.run || !this.voices || !this.voices.length || this.kind !== 'analog') return 1e9;
    if (q.pos >= q.stepLen) {
      q.pos -= q.stepLen;
      q.step = (q.step + 1) % q.len;
      q.fired = false; q.offed = false;
      // swing lengthens the on-beat sixteenth and shortens the off-beat one
      q.stepLen = q.spb * (q.step % 2 ? 1 - q.swing : 1 + q.swing);
    }
    const sl = q.stepLen;
    if (!q.fired) {
      q.fired = true;
      const s = q.pat[q.step];
      if (s && s.g) {
        const n = q.root + s.n + 12 * s.o;
        const vel = s.a ? 1 : 0.62;
        const legato = q.tie && q.cur >= 0;
        for (const v of this.voices) v.noteOn(n, vel, legato, legato ? this.glc(true) : 1);
        this.monoGate = true;
        q.cur = n; q.tie = !!s.s;
      } else {
        if (q.cur >= 0) for (const v of this.voices) v.noteOff();
        q.cur = -1; q.tie = false;
      }
      this.port.postMessage({ t: 'step', s: q.step });
    }
    const gateAt = sl * 0.5;
    if (!q.offed && q.pos >= gateAt) {
      q.offed = true;
      if (q.cur >= 0 && !q.tie) { for (const v of this.voices) v.noteOff(); q.cur = -1; this.monoGate = false; }
    }
    return (q.offed ? sl : gateAt) - q.pos;
  }
  process(inputs, outputs) {
    const t0 = Date.now();
    const out = outputs[0], Lo = out[0], Ro = out[1] || out[0];
    const n = Lo.length;
    let off = 0;
    while (off < n) {
      let len = n - off;
      const q = this.sq;
      if (q && q.run) {
        const d = this.seqEvents();
        const dd = Math.max(4, Math.ceil(d / 4) * 4);
        if (dd < len) len = dd;
        len = Math.min(len, n - off);
        if (len % 4 && off + len < n) len -= len % 4;
        if (len <= 0) len = Math.min(4, n - off);
      }
      this.renderSpan(Lo, Ro, off, len);
      if (q && q.run) q.pos += len;
      off += len;
    }
    this.loadT += Date.now() - t0;
    this.statN += n;
    if (this.statN >= this.base * 0.25) {
      this.port.postMessage({ t: 'stats', load: this.loadT / (this.statN / this.base * 1000), voices: this.act });
      this.loadT = 0; this.statN = 0;
    }
    return true;
  }
  renderSpan(Lo, Ro, off, n) {
    const OS = this.OS, N = n * OS, buf = this.buf, p = this.p;
    buf.fill(0, 0, N);
    const nCh = Math.max(1, Math.round(N / this.CH));
    if (this.lfoBuf.length < nCh) this.lfoBuf = new Float64Array(nCh);
    this.runLFO(nCh);
    this.gdrift += (this.rnd() * 3.5 - this.gdrift) * this.gouB * 0.02 * (n / 128);
    let act = 0;
    if (this.kind === 'divide') { if (this.div.list.length) this.div.render(buf, N); act = this.div.list.length; }
    else for (const v of this.voices) if (v.active) { v.render(buf, N); act++; }
    this.act = act;
    if (p.dac) { // DX7: 12-bit floating DAC at 49.096 kHz with zero-order hold
      const per = this.fs / 49096;
      let t = this.dacT, hold = this.dacHold;
      for (let i = 0; i < N; i++) {
        if (t <= 0) {
          const x = buf[i] * 0.5, ax = Math.abs(x);
          const q = ax > 1e-9 ? Math.pow(2, Math.ceil(Math.log2(ax)) - 11) : 1e-9;
          hold = Math.round(x / q) * q * 2; t += per;
        }
        t -= 1; buf[i] = hold;
      }
      this.dacT = t; this.dacHold = hold;
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
    if (p.fx.ensemble) this.ens.process(mono, Lb, Rb, n);
    else this.chorus.process(mono, Lb, Rb, n);
    // output stage: DC block + soft knee limiter
    const Rdc = 1 - TAU * 4 / this.base;
    let x0 = this.dcx[0], y0 = this.dcy[0], x1 = this.dcx[1], y1 = this.dcy[1];
    for (let i = 0; i < n; i++) {
      let a = Lb[i], b = Rb[i];
      y0 = a - x0 + Rdc * y0; x0 = a; y1 = b - x1 + Rdc * y1; x1 = b;
      a = y0; b = y1;
      const aa = Math.abs(a), ab = Math.abs(b);
      if (aa > 0.8) a = Math.sign(a) * (0.8 + 0.2 * Math.tanh((aa - 0.8) / 0.2));
      if (ab > 0.8) b = Math.sign(b) * (0.8 + 0.2 * Math.tanh((ab - 0.8) / 0.2));
      Lo[off + i] = a; if (Ro !== Lo) Ro[off + i] = b;
    }
    this.dcx[0] = x0; this.dcy[0] = y0; this.dcx[1] = x1; this.dcy[1] = y1;
  }
}

registerProcessor('synth-engine', SynthProcessor);
