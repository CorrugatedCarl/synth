// The TR-606 voice circuits (stage 7b lane V6; IMPL-7b §12.1): every circuit alone through Dr808.create(…, 'tr606')
// (dr-808.js) — each block against its own analog prototype (target (a)), the research's calc numbers and the spec's output
// levels (target (b): R6 §14), the per-circuit checks (the snare's pitch kick, the toms bending each other and their shared
// rumble, the cymbal's two bands, the hat pair's choke, open + closed and the tempo-linked cut) and the machine's contracts
// (retrigger, accent, rates, determinism, span invariance, order-free latching, no allocation, idle, sleep, sample slots,
// the extras neutral at 5, the §2.5 level). The tempo clock is a stand-in Inst's drClock (E6's interface, IMPL-7b §2.1).
// CPU per circuit is reported; the patterns (the machine alone) are gated against §2.6's rows. Measurements on the mix bus
// (IC14A's output, volts) unless a circuit's own state is the measure.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';

const SRC = source('dr-808.js');
const LIBS = new Map();
function lib(sr = 48000) {
  if (!LIBS.has(sr)) {
    const sc = dspScope({ files: [], fast: true, sampleRate: sr });
    sc.run(SRC, 'dr-808.js');
    LIBS.set(sr, { sc, D: sc.global('Dr808') });
  }
  return LIBS.get(sr);
}
const D48 = () => lib(48000).D;
const SND = ['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch', 'lc', 'mc', 'hc', 'cl', 'ma'];
const SI = s => SND.indexOf(s);
const S6 = ['bd', 'sd', 'lt', 'ht', 'cy', 'oh', 'ch'];
const VKEY = { bd: 'bd', sd: 'sd', lt: 'tm', ht: 'tm', cy: 'cy', oh: 'hh', ch: 'hh' };
const dB = x => 20 * Math.log10(Math.max(1e-30, x));
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

// a stand-in Inst's tempo clock (drClock(F) → { t, tpf }, preallocated): bpm from frame 0, t0 ticks ahead (a song playing)
function clock(bpm, sr = 48000, t0 = 0, calls = null) {
  const tpf = bpm / 60 * 960 / sr, c = { t: 0, tpf };
  return { drClock(F) { if (calls) calls.n++; c.t = t0 + F * tpf; return c; } };
}
const NOCLOCK = { drClock() { return NOCLOCK.c; }, c: { t: 0, tpf: 0 } };   // no pulses: the natural decays
function drumOf(D, over = {}) {
  const X = D.mach.tr606;
  return Object.assign(Object.fromEntries(X.KNOB_IDS.map((k, i) => [k, X.KNOB_DEF[i]])), over);
}
function machine(D, { sr = 48000, os = 4, drum = {}, opt, inst = {} } = {}) {
  const m = D.create(Object.assign({ base: sr, OS: os, seedSalt: 0 }, inst), 'tr606', opt);
  m.set(drumOf(D, drum));
  return m;
}
// one machine, hits [[frame, sound, v127] | [frame, fn(m)]] (frames multiples of 4), spans `span(F)` frames (multiple of 4),
// cut at the hits as the engine cuts them; returns the mix bus at the OS rate and the base-rate output (post) when asked
function render(m, { sr = 48000, os = 4, sec = 1, hits = [], span = () => 128, post = false } = {}) {
  const N = Math.round(sec * sr / 4) * 4, y = new Float64Array(N * os), buf = new Float64Array(128 * os);
  const L = post ? new Float32Array(N) : null, Lb = new Float32Array(128), Rb = new Float32Array(128), mono = new Float64Array(128);
  let h = 0, F = 0;
  while (F < N) {
    while (h < hits.length && hits[h][0] <= F) { const e = hits[h++]; if (typeof e[1] === 'function') e[1](m); else m.hit(e[1], e[2]); }
    let n = Math.min(128, span(F), N - F);
    if (h < hits.length) n = Math.min(n, hits[h][0] - F);
    n = Math.max(4, n - (n % 4));
    buf.fill(0, 0, n * os);
    m.render(buf, n * os, F);
    y.set(buf.subarray(0, n * os), F * os);
    if (post) {
      for (let i = 0; i < n; i++) mono[i] = buf[i * os];
      m.post(Lb, Rb, mono, n);
      L.set(Lb.subarray(0, n), F);
    }
    F += n;
  }
  return { y, fs: sr * os, L };
}
function hit1(s, { v = 100, sr = 48000, os = 4, sec = 1, drum = {}, opt, inst = {}, post = false } = {}) {
  const D = lib(sr).D, m = machine(D, { sr, os, drum, opt, inst });
  const r = render(m, { sr, os, sec, hits: [[0, SI(s), v]], post });
  return Object.assign(r, { m });
}
// a state of a circuit sampled every chunk (4 frames) for `sec`, after `hits` (frame 0)
function trace(m, sec, get, hits = [], step = 4) {
  const b = new Float64Array(step * 8), out = [];
  let h = 0;
  for (let F = 0; F < sec * 48000; F += step) {
    while (h < hits.length && hits[h][0] <= F) { const e = hits[h++]; if (typeof e[1] === 'function') e[1](m); else m.hit(e[1], e[2]); }
    b.fill(0); m.render(b, step * m._M.OS, F); out.push(get(m));
  }
  return out;
}

/* ---------------------------------------------------------------- analysis (as tests/dr-808.test.mjs) */
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const xr = re[i + j + h] * cr - im[i + j + h] * ci, xi = re[i + j + h] * ci + im[i + j + h] * cr;
        re[i + j + h] = re[i + j] - xr; im[i + j + h] = im[i + j] - xi; re[i + j] += xr; im[i + j] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function env(y, fs, w = 0.001) {
  const n = Math.max(1, Math.round(w * fs)), e = [];
  for (let i = 0; i + n <= y.length; i += n) { let p = 0; for (let j = 0; j < n; j++) p = Math.max(p, Math.abs(y[i + j])); e.push(p); }
  return e;
}
// the time (s) after which the 1 ms peak envelope stays below the peak − db (the peak found after `skip`)
function decay(y, fs, db = 20, skip = 0.002) {
  const e = env(y, fs), k0 = Math.round(skip / 0.001);
  let pk = 0, ip = k0;
  for (let i = k0; i < e.length; i++) if (e[i] > pk) { pk = e[i]; ip = i; }
  let last = ip;
  for (let i = ip; i < e.length; i++) if (e[i] >= pk * 10 ** (-db / 20)) last = i;
  return (last + 1) * 0.001;
}
function peakF(y, fs, f1, f2, t0 = 0, t1 = null) {
  const a = Math.round(t0 * fs), b = Math.min(y.length, t1 ? Math.round(t1 * fs) : y.length), L = b - a;
  let n = 1; while (n < 8 * L) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < L; i++) re[i] = y[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L));
  fft(re, im, false);
  const mag = k => Math.hypot(re[k], im[k]);
  let best = -1, bk = 0;
  for (let k = Math.max(1, Math.floor(f1 * n / fs)); k <= Math.ceil(f2 * n / fs); k++) { const m = mag(k); if (m > best) { best = m; bk = k; } }
  const l = Math.log(mag(bk - 1) + 1e-300), c = Math.log(best + 1e-300), r = Math.log(mag(bk + 1) + 1e-300), d = l - 2 * c + r;
  return (bk + (d !== 0 ? 0.5 * (l - r) / d : 0)) * fs / n;
}
function instFreq(y, fs, dec, f1, f2) {
  const m = Math.floor(y.length / dec), x = new Float64Array(m);
  for (let i = 0; i < m; i++) x[i] = y[i * dec];
  const f = fs / dec;
  let n = 1; while (n < m) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  fft(re, im, false);
  for (let k = 0; k < n; k++) { const fk = (k <= n / 2 ? k : k - n) * f / n, g = fk > 0 && fk >= f1 && fk <= f2 ? 2 : 0; re[k] *= g; im[k] *= g; }
  fft(re, im, true);
  const fr = new Float64Array(m);
  for (let i = 1; i < m; i++) { let d = Math.atan2(im[i], re[i]) - Math.atan2(im[i - 1], re[i - 1]); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; fr[i] = d * f / (2 * Math.PI); }
  return { fr, f };
}
const meanF = ({ fr, f }, t0, t1) => { let s = 0, c = 0; for (let i = Math.round(t0 * f); i < Math.round(t1 * f); i++) { s += fr[i]; c++; } return s / c; };
function spec(y, fs, sec = 0.2) {
  const L = Math.min(y.length, Math.round(sec * fs));
  let n = 1; while (n < L) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < L; i++) re[i] = y[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L));
  fft(re, im, false);
  const kx = Math.floor(16000 * n / fs), m = new Float64Array(kx);
  let s = 0;
  for (let k = 1; k < kx; k++) { m[k] = Math.hypot(re[k], im[k]); s += m[k] * m[k]; }
  s = Math.sqrt(s); for (let k = 0; k < kx; k++) m[k] /= s;
  return m;
}
const corr = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
const maxAbsDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
const same = (a, b) => a.length === b.length && maxAbsDiff(a, b) === 0;
const absMax = a => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const rmsW = (y, fs, a, b) => { let s = 0, n = 0; for (let i = Math.round(a * fs); i < Math.min(y.length, Math.round(b * fs)); i++) { s += y[i] * y[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
const pp = a => { let mx = -Infinity, mn = Infinity; for (const x of a) { if (x > mx) mx = x; if (x < mn) mn = x; } return mx - mn; };

/* ---------------------------------------------------------------- the module */
test('Dr808 builds the 606 (create(…, \'tr606\')), Dr808.mach / gain; the 808\'s exports unchanged', () => {
  const D = D48(), P = D.proto, T = P.tr606;
  assert.ok(D && Object.isFrozen(D) && Object.isFrozen(D.mach) && Object.isFrozen(T));
  assert.deepEqual([...D.mach.tr606.sids], [0, 1, 2, 4, 8, 9, 10], 'the sounds it has, by the 808\'s ids');
  assert.deepEqual([...D.mach.tr606.SOUNDS], SND, 'SOUNDS: the 16 by sound id');
  assert.deepEqual([...D.mach.tr606.KNOB_IDS], ['ac', 'bdl', 'sdl', 'tml', 'cyl', 'hhl', 'vol', 'bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'cyd', 'ohd', 'chd']);
  assert.deepEqual([...D.mach.tr606.KNOB_DEF], [0.5, 0.7, 0.7, 0.7, 0.7, 0.7, 0.75, ...Array(11).fill(0.5)]);
  assert.deepEqual([...D.mach.tr808.KNOB_IDS], [...D.KNOB_IDS], 'the 808\'s table');
  assert.equal(D.mach.tr808.sids.length, 16);
  assert.equal(D.KNOB_IDS.length, 23, 'the top-level exports stay the 808\'s');
  assert.equal(D.create({ base: 48000, OS: 1 }, 'tb303'), null, 'another kind: no machine');
  const m = machine(D);
  for (const f of ['set', 'setOS', 'hit', 'trig', 'render', 'post', 'live', 'reset', 'mon', 'smp', 'setSalt']) assert.equal(typeof m[f], 'function', f);
  assert.equal(m._mach, 'tr606');
  assert.equal(m.live(), false, 'a fresh machine is silent');
  assert.deepEqual(Object.keys(m._v).sort(), ['bd', 'cy', 'hh', 'sd', 'tm'], 'five circuits: the tom pair and the hat pair one each');
  // the trigger law (§1.3): V_N, the rheostat ACCENT, velocity → volts
  assert.equal(T.vTrig6(100, 0.5), T.V_N6);
  assert.equal(T.vTrig6(127, 1), T.V_X6);
  assert.ok(near(T.V_X6, 14.19, 0.002) && near(T.vAcc6(0.5), 6.58, 0.003) && T.vAcc6(0) === T.V_N6, `V_A ${T.V_X6} / ${T.vAcc6(0.5)} / ${T.vAcc6(0)}`);
  // gain(kind, drum): the output stage's static gain (the engine's drGain); the 808's arithmetic as engine.js had it
  const M = P.MIX, d8 = { vol: 0.6 }, lv = P.tapA(0.6), rl = M.VR1 * lv, rw = rl * (M.VR1 - rl) / M.VR1;
  assert.equal(D.gain('tr808', d8), lv * M.R76 / (M.R77 + rw) * D.OUT_K);
  assert.equal(D.gain(undefined, d8), D.gain('tr808', d8));
  assert.equal(D.gain('tr606', { vol: 1 }), 1.5 * T.OUT_K6, 'VOLUME 10: IC14B\'s −1.5');
  assert.ok(D.gain('tr606', null) > 0 && D.gain('tr606', { vol: 0 }) === 0);
});

/* ---------------------------------------------------------------- target (a): the analog prototypes */
// the 606's bridged-T in its non-inverting loop (btDesign): Vo/U = 1 + g s / (s² + 2 p s + p g), p = 1/(R1 C), g = G/C;
// the trapezoid in s-form: X = ((z + 1) I − 2 M⁻¹)⁻¹ (z + 1) M⁻¹ hb U, Vo = U − X0 − X1
function btResp(c, C, R1, G, f, fs, dig) {
  if (!dig) {
    const w = 2 * Math.PI * f, p = 1 / (R1 * C), g = G / C;
    const dr = p * g - w * w, di = 2 * p * w, nr = 0, ni = g * w, dd = dr * dr + di * di;
    const hr = 1 + (nr * dr + ni * di) / dd, hi = (ni * dr - nr * di) / dd;
    return Math.hypot(hr, hi);
  }
  const w = 2 * Math.PI * f / fs, zr = Math.cos(w) + 1, zi = Math.sin(w);   // z + 1
  // A = (z + 1) I − 2 Mi; rhs = (z + 1) Mi [0, c8]
  const m00r = zr - 2 * c[0], m00i = zi, m01r = -2 * c[1], m10r = -2 * c[2], m11r = zr - 2 * c[3], m11i = zi;
  const r0r = zr * c[1] * c[8], r0i = zi * c[1] * c[8], r1r = zr * c[3] * c[8], r1i = zi * c[3] * c[8];
  const detr = m00r * m11r - m00i * m11i - m01r * m10r, deti = m00r * m11i + m00i * m11r;
  // x0 = (r0 m11 − m01 r1) / det, x1 = (m00 r1 − m10 r0) / det
  const a0r = r0r * m11r - r0i * m11i - m01r * r1r, a0i = r0r * m11i + r0i * m11r - m01r * r1i;
  const a1r = m00r * r1r - m00i * r1i - m10r * r0r, a1i = m00r * r1i + m00i * r1r - m10r * r0i;
  const sr = a0r + a1r, si = a0i + a1i, dd = detr * detr + deti * deti;
  const xr = (sr * detr + si * deti) / dd, xi = (si * detr - sr * deti) / dd;
  return Math.hypot(1 - xr, -xi);
}
// a Lin network's response at input k: analog C (jωI − A)⁻¹ B_k + D_k, digital C (zI − Ad)⁻¹ Bd_k (z + 1) + D_k
function linResp(L, k, f, fs, dig) {
  const n = L.n, m = L.m, re = new Float64Array(n * (n + 1)), im = new Float64Array(n * (n + 1)), W = n + 1;
  const w = dig ? 2 * Math.PI * f / fs : 2 * Math.PI * f, zr = dig ? Math.cos(w) : 0, zi = dig ? Math.sin(w) : w;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { re[i * W + j] = (i === j ? zr : 0) - (dig ? L.Ad[i * n + j] : L.A[i * n + j]); im[i * W + j] = i === j ? zi : 0; }
    const b = dig ? L.Bd[i * m + k] : L.B[i * m + k];
    re[i * W + n] = dig ? b * (zr + 1) : b; im[i * W + n] = dig ? b * zi : 0;
  }
  for (let c = 0; c < n; c++) {                              // complex Gauss–Jordan (no pivoting needed: diagonal dominant)
    const pr = re[c * W + c], pi = im[c * W + c], pd = pr * pr + pi * pi;
    for (let j = c; j <= n; j++) { const a = re[c * W + j], b = im[c * W + j]; re[c * W + j] = (a * pr + b * pi) / pd; im[c * W + j] = (b * pr - a * pi) / pd; }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const qr = re[r * W + c], qi = im[r * W + c];
      for (let j = c; j <= n; j++) { re[r * W + j] -= qr * re[c * W + j] - qi * im[c * W + j]; im[r * W + j] -= qr * im[c * W + j] + qi * re[c * W + j]; }
    }
  }
  let hr = L.D[k], hi = 0;
  for (let i = 0; i < n; i++) { hr += L.C[i] * re[i * W + n]; hi += L.C[i] * im[i * W + n]; }
  return Math.hypot(hr, hi);
}
function hz2(c, f, fs) {
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  return Math.hypot(c[0] + c[1] * c1 + c[2] * c2, c[1] * s1 + c[2] * s2) / Math.hypot(1 + c[3] * c1 + c[4] * c2, c[3] * s1 + c[4] * s2);
}
function hz1(c, f, fs) { const w = 2 * Math.PI * f / fs, zr = Math.cos(w), zi = -Math.sin(w); return Math.hypot(c[0] + c[1] * zr, c[1] * zi) / Math.hypot(1 + c[2] * zr, c[2] * zi); }
const ha2 = (b2, b1, b0, a2, a1, a0, f) => { const w = 2 * Math.PI * f; return Math.hypot(b0 - b2 * w * w, b1 * w) / Math.hypot(a0 - a2 * w * w, a1 * w); };
const par = (a, b) => a * b / (a + b);
test('target (a): each fixed block against its analog prototype — centres ± 1 %, magnitude ± 0.2 dB to 5 kHz at OS 4', () => {
  const D = D48(), P = D.proto, T = P.tr606, fs = 192000, bad = [];
  const FQ = []; for (let f = 20; f <= 5000; f *= 1.02) FQ.push(f);
  const check = (name, dig, ana, f0, fmax = 5000) => {
    let worst = 0, aref = 0;
    for (const f of FQ) aref = Math.max(aref, ana(f));
    for (const f of FQ) { if (f > fmax) break; const a = ana(f); if (a > 1e-4 * aref) worst = Math.max(worst, Math.abs(dB(dig(f)) - dB(a))); }
    if (!(worst <= 0.2)) bad.push(`${name}: ${worst.toFixed(3)} dB`);
    if (f0) {
      let fa = 0, fd = 0, ma = 0, md = 0;
      for (let f = f0 * 0.7; f <= f0 * 1.3; f *= 1.0002) { const a = ana(f), d = dig(f); if (a > ma) { ma = a; fa = f; } if (d > md) { md = d; fd = f; } }
      if (!near(fd, fa, 0.01)) bad.push(`${name}: peak ${fd.toFixed(2)} vs ${fa.toFixed(2)} Hz`);
    }
  };
  // the five bridged-T resonators at rest, prewarped at their own frequency (as the voices design them)
  const B = T.BD6, S = T.SD6, M = T.TM6;
  for (const [name, C, R1, R2] of [['BD IC5A', B.C19, B.R59, B.R58], ['BD IC5B', B.C23, B.R61, B.R66], ['SD IC10A', S.C32, S.R112, S.R107 + S.R115],
    ['LT IC9A', M.C304, M.R1L, M.R323 + M.R318], ['HT IC9B', M.C310, M.R1H, M.R334 + M.R333]]) {
    const f0 = 1 / (2 * Math.PI * C * Math.sqrt(R1 * R2)), c = new Float64Array(9);
    T.btDesign(c, C, R1, 1 / R2, 2 / P.kBil(f0, fs));
    check(name, f => btResp(c, C, R1, 1 / R2, f, fs, true), f => btResp(null, C, R1, 1 / R2, f, fs, false), f0);
  }
  // the Sallen-Key high-passes by skHP (SD Q32, CY Q40), prewarped at their corners
  const Y = T.CY6;
  for (const [name, C1, C2, R1, R2, f0] of [['SD Q32', S.C52, S.C58, S.R153, par(S.R155, S.R152), 2670], ['CY Q40', Y.C59, Y.C60, Y.R159, par(Y.R195, Y.R196), 2180]]) {
    const c = new Float64Array(5); P.skHP(c, 0, C1, C2, R1, R2, 1, P.kBil(f0, fs));
    const a2 = R1 * R2 * C1 * C2, a1 = R1 * (C1 + C2);
    check(name, f => hz2(c, f, fs), f => ha2(a2, 0, 0, a2, a1, 1, f), 0);
  }
  // the networks the voices solve by the trapezoidal rule (Lin): IC12B and IC12A (gain-2 Sallen-Keys behind their
  // couplings), the rumble's band, the voices' sums into their level pots
  const m = machine(D, { os: 4 }), V = m._v;
  for (const [name, L, k] of [['CY IC12B', V.cy.hi, 0], ['hats IC12A', V.hh.net, 0], ['rumble C316–C317', V.tm.rum, 0], ['BD sum (IC5A)', V.bd.net, 0],
    ['BD sum (IC5B)', V.bd.net, 1], ['SD sum (tone)', V.sd.net, 0], ['SD sum (noise)', V.sd.net, 1], ['CY sum (low)', V.cy.net, 0], ['CY sum (high)', V.cy.net, 1]]) {
    check(name, f => linResp(L, k, f, fs, true), f => linResp(L, k, f, fs, false), 0);
  }
  // the noise's pole (IC10B: R116 ∥ C36) and the toms' rumble low-pass (Q309 = the 808's PN filter, at the base rate)
  const N = T.NZ6, c1 = new Float64Array(3); P.bil1(c1, 0, 0, 1, 1 / (2 * Math.PI * N.FC), 1, P.kBil(N.FC, fs));
  check('noise pole', f => hz1(c1, f, fs), f => 1 / Math.hypot(1, f / N.FC), 0);
  if (!near(N.FC, 7234, 0.01)) bad.push(`noise pole ${N.FC.toFixed(0)} Hz`);
  const R = 22e3, Ca = 0.039e-6, Cb = 0.018e-6, cp = new Float64Array(5);
  P.bil2(cp, 0, 0, 0, 1, R * R * Ca * Cb, 2 * R * Cb, 1, P.kBil(273, 48000));
  check('rumble LP (48 kHz, to 2 kHz)', f => hz2(cp, f, 48000), f => ha2(0, 0, 1, R * R * Ca * Cb, 2 * R * Cb, 1, f), 0, 2000);
  assert.deepEqual(bad, []);
});
test('target (a): the envelopes\' time constants ± 2 % — OH natural (C45 · R167 at DECAY 0 / 5 / 10), E1 (C49 · R163 + R164 at DECAY 0 / 5 / 10), the choke drain (R137), CH (C42 · R134, its VCA held on)', () => {
  const D = D48(), T = D.proto.tr606, H = T.HH6, Y = T.CY6, bad = [];
  const tauOf = (tr, a, b, dt = 4 / 48000, v0 = 0) => { const i = tr.findIndex(v => v <= a), j = tr.findIndex(v => v <= b); return (j - i) * dt / Math.log((a - v0) / (b - v0)); };
  for (const d of [0, 0.5, 1]) {
    const f = Math.pow(4, 2 * (d - 0.5));
    // below Q36's / Q35's turn-on the capacitor sees only its bleed (no clock pulses: NOCLOCK)
    let m = machine(D, { drum: { ohd: d, ac: 1 }, opt: { noSleep: true }, inst: NOCLOCK });
    let tr = trace(m, 2 + 6 * f, x => x._v.hh.v45, [[0, SI('oh'), 127]]);
    let tau = tauOf(tr, 0.5, 0.2), want = H.R167 * f * H.C45;
    if (!near(tau, want, 0.02)) bad.push(`OH C45 at DECAY ${d * 10}: ${tau.toFixed(3)} vs ${want.toFixed(3)} s`);
    m = machine(D, { drum: { cyd: d, ac: 1 }, opt: { noSleep: true } });
    tr = trace(m, 2 + 12 * f, x => x._v.cy.v49, [[0, SI('cy'), 127]], 16);
    tau = tauOf(tr, 0.5, 0.2, 16 / 48000); want = (Y.R163 + Y.R164) * f * Y.C49;
    if (!near(tau, want, 0.02)) bad.push(`CY E1 at DECAY ${d * 10}: ${tau.toFixed(3)} vs ${want.toFixed(3)} s`);
  }
  // the choke: a CH holds Q25 on, C45 drains through R137 (∥ R167 ∥ Q36's input) towards V_sat
  {
    const m = machine(D, { drum: { ac: 1 }, inst: NOCLOCK }), tr = trace(m, 0.5, x => x._v.hh.v45, [[0, SI('oh'), 127], [14400, SI('ch'), 100]]);
    const g = 1 / H.R137 + 1 / H.R167 + 1 / ((300 + 1) * H.R169), vinf = 0.1 / H.R137 / g, k0 = 14400 / 4 + 120, k1 = k0 + 1200;
    const tau = (k1 - k0) * 4 / 48000 / Math.log((tr[k0] - vinf) / (tr[k1] - vinf)), want = H.C45 / g;
    console.log(`# the choke's drain: τ ${(tau * 1e3).toFixed(1)} ms (R137 ∥ R167 ∥ Q36: ${(want * 1e3).toFixed(1)} ms)`);
    if (!near(tau, want, 0.02)) bad.push(`choke drain ${tau.toFixed(4)} vs ${want.toFixed(4)} s`);
  }
  // CH: C42 through R134 into Q37 held on (its base at the band's peak), towards the VCA's lower edge — against the same
  // network integrated finely (V_D, the lower edge's fit, Q25's base through R135)
  {
    const m = machine(D, { opt: { vcaOn: true, noSleep: true } }), tr = trace(m, 0.03, x => x._v.hh.v42, [[0, SI('ch'), 100]]);
    const k0 = Math.round(0.002 * 12000), k1 = Math.round(0.012 * 12000), Tb = T.jTab(H.R135), vle = D.proto.vle;
    let v = tr[k0];
    const n = (k1 - k0) * 64, dt = (k1 - k0) * 4 / 48000 / n;
    for (let i = 0; i < n; i++) { const vs = Math.max(v - 0.6, 0), sw = Math.max(vs - vle(vs), 0); v -= (sw / H.R134 + T.jIb(Tb, v)) * dt / H.C42; }
    const tau = (k1 - k0) * 4 / 48000 / Math.log(tr[k0] / tr[k1]), want = (k1 - k0) * 4 / 48000 / Math.log(tr[k0] / v);
    console.log(`# CH C42 (VCA on): τ ${(tau * 1e3).toFixed(2)} ms vs ${(want * 1e3).toFixed(2)} ms (C42 · R134 = ${(H.C42 * H.R134 * 1e3).toFixed(1)} ms)`);
    if (!near(tau, want, 0.02)) bad.push(`CH C42 ${tau} vs ${want}`);
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- target (b): R6's calc numbers, the spec */
test('target (b): frequencies ± 2 % (BD 60.0 / 129.4, SD 204.8 at rest, LT 131.8, HT 206.1) and ring τ ± 10 % (38 / 8.4, 22, 54, 36 ms)', () => {
  const bad = [], out = [];
  // each resonator's own state (its capacitors' voltages), sampled per chunk (12 kHz): its ring frequency and envelope,
  // apart from the rest of the voice (the BD's other loop, the snare's noise, the toms' rumble and kicks)
  for (const [s, f, tau, get, [t0, t1]] of [
    ['bd', 60.0, 0.0381, m => m._v.bd.sa, [0.02, 0.15]], ['bd', 129.4, 0.0084, m => m._v.bd.ta, [0.003, 0.03]],
    ['sd', 204.8, 0.0221, m => m._v.sd.sa, [0.04, 0.12]], ['lt', 131.8, 0.054, m => m._v.tm.saL, [0.15, 0.4]],
    ['ht', 206.1, 0.0367, m => m._v.tm.saH, [0.02, 0.15]]]) {
    const tr = Float64Array.from(trace(machine(D48(), { opt: { noSleep: true } }), t1 + 0.01, get, [[0, SI(s), 100]]));
    const fm = peakF(tr, 12000, f * 0.7, f * 1.3, t0, t1);
    const pk = k => { let p = 0; const w = Math.ceil(12000 / f) + 1; for (let i = k; i < k + w; i++) p = Math.max(p, Math.abs(tr[i])); return p; };
    const k0 = Math.round(t0 * 12000), k1 = Math.round((t0 + Math.min(3 * tau, t1 - t0 - 0.01)) * 12000);
    const tm = (k1 - k0) / 12000 / Math.log(pk(k0) / pk(k1));
    out.push(`${s} ${fm.toFixed(2)} Hz (${f}), τ ${(tm * 1e3).toFixed(1)} ms (${(tau * 1e3).toFixed(1)})`);
    if (!near(fm, f, 0.02)) bad.push(`${s}: ${fm.toFixed(2)} vs ${f} Hz`);
    if (!near(tm, tau, 0.1)) bad.push(`${s} ${f}: ring τ ${(tm * 1e3).toFixed(1)} vs ${(tau * 1e3).toFixed(1)} ms`);
  }
  // and on the bus: the bass drum's body, the snare at rest, the high tom
  for (const [s, f, band, t0, t1] of [['bd', 60.0, [40, 90], 0.03, 0.3], ['sd', 204.8, [150, 260], 0.04, 0.2], ['ht', 206.1, [170, 240], 0.03, 0.2]]) {
    const r = hit1(s, { sec: t1 + 0.05 }), fm = peakF(r.y, r.fs, ...band, t0, t1);
    if (!near(fm, f, 0.02)) bad.push(`${s} on the bus: ${fm.toFixed(2)} vs ${f} Hz`);
  }
  console.log('# frequencies / rings:', out.join('; '));
  assert.deepEqual(bad, []);
});
test('target (b): the metal bank — periods within 0.1 % of 2.07 / RC, duty 47.98 % ± 0.1, the band-passes the 808\'s (3454 / 7117 Hz)', () => {
  const D = D48(), P = D.proto, T = P.tr606, MT = T.MT6, bad = [];
  const RC = [[330e3, 15e-9], [470e3, 10e-9], [330e3, 10e-9], [560e3, 15e-9], [560e3, 12e-9], [470e3, 12e-9]];
  for (const os of [4, 2, 1]) {
    const m = machine(D, { os }), TB = m._TB, fs = 48000 * os;
    TB.forEach((tb, k) => {
      const want = 2.07 / (RC[k][0] * RC[k][1]);
      if (!(Math.abs(tb.inc * fs - want) <= 1e-3 * want)) bad.push(`osc ${k}: ${(tb.inc * fs).toFixed(2)} vs ${want.toFixed(2)} Hz`);
      const sq = tb.sq, N = sq.length - 1;
      let mx = -1e9, mn = 1e9; for (let i = 0; i < N; i++) { mx = Math.max(mx, sq[i]); mn = Math.min(mn, sq[i]); }
      let hiN = 0; for (let i = 0; i < N; i++) if (sq[i] > (mx + mn) / 2) hiN++;
      if (os === 4 && !(Math.abs(hiN / N - 0.4798) <= 0.001)) bad.push(`osc ${k} duty ${(hiN / N * 100).toFixed(2)} %`);
    });
  }
  if (!near(MT.F[0], 418, 0.01)) bad.push(`oscillator A ${MT.F[0].toFixed(1)} Hz (R226 330 k: the earlier metal, §13 Q3)`);
  if (!near(2.0698 / (MT.R226L * 15e-9), 203, 0.01)) bad.push('the later R226 (680 k) recorded');
  const H = [0, 0];
  for (const [name, args, want] of [['IC15B', [MT.R52, MT.C10, MT.C13, MT.C14, MT.R56, MT.R57], 3454], ['IC15A', [MT.R55, MT.C11, MT.C15, MT.C16, MT.R58, MT.R59], 7117]]) {
    let fb = 0, mb = 0;
    for (let f = 1000; f < 20000; f *= 1.0005) { P.bandH(f, ...args, H); const v = Math.hypot(H[0], H[1]); if (v > mb) { mb = v; fb = f; } }
    if (!near(fb, want, 0.02)) bad.push(`band ${name}: centre ${fb.toFixed(0)} Hz`);
  }
  // the Sallen-Key corners from their components (R6 §5, §8, §9)
  const S = T.SD6, Y = T.CY6, HH = T.HH6, f0 = (C1, C2, R1, R2) => 1 / (2 * Math.PI * Math.sqrt(R1 * R2 * C1 * C2));
  for (const [name, f, want] of [['SD Q32', f0(S.C52, S.C58, S.R153, par(S.R155, S.R152)), 2670], ['CY Q40', f0(Y.C59, Y.C60, Y.R159, par(Y.R195, Y.R196)), 2180],
    ['CY IC12B', f0(Y.C63, Y.C73, Y.R203, par(Y.R207, Y.R208)), 8500], ['hats IC12A', f0(HH.C69, HH.C70, HH.R174, par(HH.R175, HH.R176)), 8500]]) {
    if (!near(f, want, 0.02)) bad.push(`${name}: ${f.toFixed(0)} Hz`);
  }
  assert.deepEqual(bad, []);
});
test('metal bank: asleep with no metal voice live; a hit after the bank slept equals a free-running bank, byte for byte', () => {
  const D = D48(), F2 = 48000 * 3 + 64;
  for (const s of ['oh', 'cy']) {
    const a = machine(D, { inst: NOCLOCK }), b = machine(D, { inst: NOCLOCK, opt: { bankOn: true } });
    const ra = render(a, { sec: 3.4, hits: [[0, SI('ch'), 100], [F2, SI(s), 100]] });
    const rb = render(b, { sec: 3.4, hits: [[0, SI('ch'), 100], [F2, SI(s), 100]] });
    const m = machine(D);
    render(m, { sec: 1, hits: [[0, SI('ch'), 100]] });
    assert.equal(m._v.hh.on || m._bank.hon || m._bank.lon, false, 'the hats and the bank asleep');
    assert.ok(same(ra.y.subarray(F2 * 4), rb.y.subarray(F2 * 4)), `${s}: the woken bank equals the free-running one`);
    assert.ok(absMax(ra.y.subarray(F2 * 4, F2 * 4 + 4800)) > 0.01, 'and it sounds');
  }
});
test('target (b): the output at VOLUME 10, the levels centred — the seven sounds\' median within ± 3 dB of 2 Vp-p (ACCENT 0) and 6 Vp-p (ACCENT 10); the pattern reported', () => {
  const D = D48(), K = D.proto.tr606.OUT_K6, panel = ac => ({ ac, vol: 1, bdl: 0.5, sdl: 0.5, tml: 0.5, cyl: 0.5, hhl: 0.5 });
  const row = {}, med = [];
  for (const [ac, v] of [[0, 100], [1, 127]]) {
    const ps = S6.map(s => pp(hit1(s, { v, sec: 1.5, drum: panel(ac), post: true, inst: NOCLOCK }).L) / K);
    row[ac] = ps.map((x, i) => `${S6[i]} ${x.toFixed(2)}`).join(', ');
    med.push(ps.slice().sort((a, b) => a - b)[3]);
  }
  // the d6p pattern (BD quarters, SD 2 / 4, CH / OH sixteenths, LT / HT, CY once a bar, accent every 4th): coinciding hits add
  const step = 6000, pat = [];
  for (let st = 0; st < 32; st++) { const s = st % 16; let k = 0; if (s % 4 === 0) k |= 3; if (s === 4 || s === 12) k |= 4; k |= s % 4 === 2 ? 1 << 10 : 1 << 11; if (s === 10) k |= 8; if (s === 14) k |= 32; if (s === 0) k |= 1 << 9; pat.push([st * step, m => m.trig(k)]); }
  const pat0 = pp(render(machine(D, { drum: panel(0) }), { sec: 4.1, hits: pat, post: true }).L) / K;
  const pat1 = pp(render(machine(D, { drum: panel(1) }), { sec: 4.1, hits: pat, post: true }).L) / K;
  console.log(`# output Vp-p, VOLUME 10, levels 5 — ACCENT 0: ${row[0]} (median ${med[0].toFixed(2)}); ACCENT 10: ${row[1]} (median ${med[1].toFixed(2)}); the pattern ${pat0.toFixed(2)} / ${pat1.toFixed(2)}`);
  assert.ok(Math.abs(dB(med[0] / 2)) <= 3, `ACCENT 0: ${med[0].toFixed(2)} Vp-p`);
  assert.ok(Math.abs(dB(med[1] / 6)) <= 3, `ACCENT 10: ${med[1].toFixed(2)} Vp-p`);
  assert.ok(med[1] / med[0] > 2, 'the accent range');
});

/* ---------------------------------------------------------------- per circuit */
test('SD: the pitch kick — towards 358 Hz in the first 5 ms, back at 205 Hz by 40 ms, longer accented', () => {
  const r0 = hit1('sd', { v: 100, sec: 0.12 }), r1 = hit1('sd', { v: 127, sec: 0.12, drum: { ac: 1 } });
  const f0 = instFreq(r0.y, r0.fs, 16, 120, 600), f1 = instFreq(r1.y, r1.fs, 16, 120, 600);
  const a = meanF(f0, 0.001, 0.005), b = meanF(f0, 0.04, 0.08), k0 = meanF(f0, 0.005, 0.02), k1 = meanF(f1, 0.005, 0.02);
  console.log(`# SD kick: ${a.toFixed(0)} Hz in 1–5 ms, ${b.toFixed(1)} at 40–80 ms; 5–20 ms ${k0.toFixed(0)} (V_N) / ${k1.toFixed(0)} Hz (V_A 10)`);
  assert.ok(a > 1.3 * 204.8 && a < 1.05 * 358.3, `kick ${a.toFixed(0)} Hz`);
  assert.ok(near(b, 204.8, 0.02), `rest ${b.toFixed(1)} Hz`);
  assert.ok(k1 > k0, 'deeper accented');
});
test('toms: a hit on one bends the other while it rings; the shared rumble on both, gated by the shared envelope, whatever the accent', () => {
  const D = D48(), bad = [];
  // the LT ringing, its own kick over (150 ms); an HT hit re-kicks its pitch (the HT's and the rumble's outputs muted)
  const lt = withHt => {
    const m = machine(D); render(m, { sec: 0.004 }); m._v.tm.kH = 0; m._v.tm.kR = 0;
    const r = render(m, { sec: 0.25, hits: [[4, SI('lt'), 100], ...(withHt ? [[7200, SI('ht'), 100]] : [])] });
    return meanF(instFreq(r.y, r.fs, 16, 80, 400), 0.152, 0.17);
  };
  const a = lt(false), b = lt(true);
  console.log(`# the LT at 152–170 ms: ${a.toFixed(1)} Hz alone, ${b.toFixed(1)} Hz with an HT hit at 150 ms`);
  if (!(b > a + 10)) bad.push(`the HT hit did not bend the LT: ${a.toFixed(1)} → ${b.toFixed(1)}`);
  // the rumble alone (the toms' outputs muted): noise (the salt changes it), the same for either tom and any accent
  const rum = (s, v, salt = 0, ac = 0.5) => {
    const m = machine(D, { drum: { ac } }); if (salt) m.setSalt(salt); render(m, { sec: 0.004 }); m._v.tm.kL = 0; m._v.tm.kH = 0;
    return render(m, { sec: 0.6, hits: [[4, SI(s), v]] });
  };
  const r1 = rum('lt', 100), r2 = rum('ht', 127, 0, 1), r3 = rum('lt', 100, 777);
  if (!same(r1.y, r2.y)) bad.push('the rumble differs between an LT hit and an accented HT hit');
  if (same(r1.y, r3.y)) bad.push('no noise in the rumble');
  const e1 = rmsW(r1.y, r1.fs, 0.06, 0.2), e2 = rmsW(r1.y, r1.fs, 0.45, 0.55);
  console.log(`# rumble: rms ${e1.toFixed(4)} V at 60–200 ms, ${dB(e2 / e1).toFixed(1)} dB at 450–550 ms`);
  if (!(e1 > 1e-3 && e2 < e1 * 0.1)) bad.push(`rumble envelope ${e1} → ${e2}`);
  assert.deepEqual(bad, []);
});
test('CY: two bands — the high band\'s supply charged by the gate, the low band\'s arriving ≈ 70 ms late (C61); both in the output', () => {
  const D = D48(), m = machine(D), tr = trace(m, 0.4, x => [x._v.cy.v47, x._v.cy.v61], [[0, SI('cy'), 100]]);
  const am = k => { let j = 0; for (let i = 0; i < tr.length; i++) if (tr[i][k] > tr[j][k]) j = i; return j * 4 / 48; };
  const t47 = am(0), t61 = am(1), r63 = tr.findIndex(x => x[1] >= 0.632 * tr[am(1) * 12][1]) * 4 / 48;
  console.log(`# CY: C47 peaks at ${t47.toFixed(1)} ms, C61 at ${t61.toFixed(1)} ms (63 % at ${r63.toFixed(1)} ms)`);
  assert.ok(t47 <= 1.5, 'the high band at the gate');
  assert.ok(r63 >= 25 && r63 <= 120 && t61 > 60, 'the low band late');
  const r = hit1('cy', { sec: 0.5 });
  const lo = rmsW(r.y, r.fs, 0, 0.5);
  assert.ok(lo > 0.01 && peakF(r.y, r.fs, 2000, 12000, 0.05, 0.4) > 5000, 'the high band dominates');
});
test('the hat pair: CH chokes a sounding OH (depth recorded); OH + CH on one step peaks above CH alone', () => {
  const D = D48(), fs = 192000;
  const free = render(machine(D, { inst: NOCLOCK }), { sec: 0.8, hits: [[0, SI('oh'), 100]] }).y;
  const ch = render(machine(D, { inst: NOCLOCK }), { sec: 0.8, hits: [[0, SI('oh'), 100], [4800, SI('ch'), 100]] }).y;
  const rows = [0.05, 0.1, 0.3].map(dt => dB(rmsW(ch, fs, 0.1 + dt, 0.15 + dt) / rmsW(free, fs, 0.1 + dt, 0.15 + dt)));
  // an OH 300 ms after a CH: Q25 may still drain C45 (C42 held by its base)
  const late = render(machine(D, { inst: NOCLOCK }), { sec: 0.8, hits: [[0, SI('ch'), 100], [14400, SI('oh'), 100]] }).y;
  const f2 = render(machine(D, { inst: NOCLOCK }), { sec: 0.8, hits: [[14400, SI('oh'), 100]] }).y;
  const lateDb = dB(rmsW(late, fs, 0.35, 0.5) / rmsW(f2, fs, 0.35, 0.5));
  console.log(`# choke: a sounding OH ${rows.map((x, i) => `${x.toFixed(1)} dB ${[50, 100, 300][i]} ms`).join(', ')} after a CH; an OH 300 ms after a CH ${lateDb.toFixed(1)} dB`);
  assert.ok(rows[2] < -6, 'an OH 300 ms after a CH is quieter than a free OH');
  const c = render(machine(D), { sec: 0.3, hits: [[0, SI('ch'), 100]] }).y, b = render(machine(D), { sec: 0.3, hits: [[0, SI('oh'), 100], [0, SI('ch'), 100]] }).y;
  console.log(`# OH + CH on one step: ${dB(absMax(b) / absMax(c)).toFixed(2)} dB over CH alone`);
  assert.ok(absMax(b) > 1.4 * absMax(c), 'the "accented" closed hat');
  assert.ok(decay(b, fs, 30) < 0.15, 'and it is a closed hat (the open one choked)');
});
test('the open hat\'s tempo-linked cut: the −30 dB time non-increasing 60 → 120 → 240 BPM, strictly shorter at 240 than 60; independent of the transport; C41 emptied by each OH hit', () => {
  const D = D48(), fs = 192000, out = [];
  const oh = (inst, hits = [[0, SI('oh'), 127]], sec = 3.5) => render(machine(D, { drum: { ac: 1 }, inst }), { sec, hits });
  const T = {}, onset = {};
  for (const bpm of [60, 120, 240]) {
    T[bpm] = decay(oh(clock(bpm)).y, fs, 30);
    const m = machine(D, { drum: { ac: 1 }, inst: clock(bpm) }), tr = trace(m, 3.5, x => x._v.hh.v41, [[0, SI('oh'), 127]], 16);
    const k = tr.findIndex(v => v >= 0.5); onset[bpm] = k < 0 ? Infinity : k * 16 / 48000;
  }
  const nat = decay(oh(NOCLOCK).y, fs, 30);
  console.log(`# OH −30 dB (v 127, ACCENT 10): ${[60, 120, 240].map(b => `${b} BPM ${T[b].toFixed(3)} s (C41 at 0.5 V after ${onset[b].toFixed(2)} s = ${(onset[b] * b / 60).toFixed(1)} beats)`).join('; ')}; no clock ${nat.toFixed(3)} s`);
  assert.ok(T[60] >= T[120] && T[120] >= T[240], 'non-increasing');
  assert.ok(T[240] < T[60] - 0.05, 'strictly shorter at 240 than 60');
  assert.ok(T[60] <= nat, 'the cut only shortens');
  // the transport: the same tempo with the song playing (ticks offset) — the same cut within one clock pulse
  const p = decay(oh(clock(240, 48000, 123457.3)).y, fs, 30);
  assert.ok(Math.abs(p - T[240]) <= 60 / 240 / 24 + 0.002, `playing ${p} vs stopped ${T[240]} s`);
  // C41 emptied by each OH hit: a second OH 1 s in at 240 BPM cuts as the first did
  const m = machine(D, { drum: { ac: 1 }, inst: clock(240) });
  const tr = trace(m, 1.01, x => x._v.hh.v41, [[0, SI('oh'), 127], [48000, SI('oh'), 127]], 16);
  assert.ok(tr[2990] > 0.3 && tr[tr.length - 1] < 0.05, `C41 ${tr[2990].toFixed(3)} V before the second hit, ${tr[tr.length - 1].toFixed(4)} after`);
  const two = oh(clock(240), [[0, SI('oh'), 127], [48000, SI('oh'), 127]], 3.5).y;
  const t2 = decay(two.subarray(48000 * 4), fs, 30);
  assert.ok(Math.abs(t2 - T[240]) <= 0.02, `the second hit's cut ${t2} vs ${T[240]} s`);
});

/* ---------------------------------------------------------------- the shared contracts */
test('every circuit: a retrigger continues the state (≠ a fresh hit, ≠ reset-then-hit)', () => {
  const D = D48(), bad = [];
  for (const s of S6) {
    const f = 1440;
    const a = render(machine(D, { inst: NOCLOCK }), { sec: 0.12, hits: [[0, SI(s), 100], [f, SI(s), 100]] }).y.subarray(f * 4);
    const b = render(machine(D, { inst: NOCLOCK }), { sec: 0.12, hits: [[f, SI(s), 100]] }).y.subarray(f * 4);
    const m = machine(D, { inst: NOCLOCK });
    const c = render(m, { sec: 0.12, hits: [[0, SI(s), 100], [f, mm => mm.reset()], [f, SI(s), 100]] }).y.subarray(f * 4);
    if (same(a, b)) bad.push(`${s}: retrigger = fresh hit`);
    if (!same(b, c)) bad.push(`${s}: reset did not restart the circuit`);
  }
  assert.deepEqual(bad, []);
});
test('accent: timbre on SD, CY, OH, CH (spectral correlation < 0.99); level only on BD, LT, HT within the rails (ACCENT 5: within 2 % of V_A / V_N)', () => {
  const D = D48(), T = D.proto.tr606, bad = [], out = [];
  for (const s of ['sd', 'cy', 'oh', 'ch']) {
    const a = hit1(s, { v: 100, drum: { ac: 1 }, sec: 0.3, inst: NOCLOCK }), b = hit1(s, { v: 127, drum: { ac: 1 }, sec: 0.3, inst: NOCLOCK });
    const c = corr(spec(a.y, a.fs), spec(b.y, b.fs));
    out.push(`${s} ${c.toFixed(3)}`);
    if (!(c < 0.99)) bad.push(`${s}: ${c.toFixed(4)}`);
  }
  const want = T.vAcc6(0.5) / T.V_N6;
  for (const s of ['bd', 'lt', 'ht']) {
    const pk = v => { const m = machine(D, { drum: { ac: 0.5 } }); render(m, { sec: 0.004 }); m._v.tm.kR = 0; return absMax(render(m, { sec: 0.5, hits: [[4, SI(s), v]] }).y); };
    const r = pk(127) / pk(100);
    out.push(`${s} ×${r.toFixed(4)}`);
    if (!near(r, want, 0.02)) bad.push(`${s}: ×${r.toFixed(4)} vs ${want.toFixed(4)}`);
  }
  console.log(`# accent (V_A ${T.V_X6.toFixed(2)} V at 10, ${T.vAcc6(0.5).toFixed(2)} at 5):`, out.join(', '));
  assert.deepEqual(bad, []);
});
test('44.1 vs 48 kHz (× 2 vs × 4): the circuits\' frequencies agree within 0.5 %', () => {
  const bad = [];
  // the resonators from their own states (per chunk: 12 / 11.025 kHz; the noise differs at each rate), the metal on the bus
  const st = (sr, os, s, get, sec) => {
    const m = machine(lib(sr).D, { sr, os, inst: NOCLOCK }), b = new Float64Array(64), out = [];
    m.hit(SI(s), 100);
    for (let F = 0; F < sec * sr; F += 4) { b.fill(0); m.render(b, 4 * os, F); out.push(get(m)); }
    return Float64Array.from(out);
  };
  for (const [s, get, band, t0, t1] of [['bd', m => m._v.bd.sa, [40, 90], 0.02, 0.15], ['sd', m => m._v.sd.sa, [150, 260], 0.04, 0.12],
    ['lt', m => m._v.tm.saL, [100, 170], 0.12, 0.35], ['ht', m => m._v.tm.saH, [170, 240], 0.02, 0.15]]) {
    const fa = peakF(st(48000, 4, s, get, t1), 12000, ...band, t0, t1), fb = peakF(st(44100, 2, s, get, t1), 11025, ...band, t0, t1);
    if (!near(fb, fa, 0.005)) bad.push(`${s}: ${fa.toFixed(2)} vs ${fb.toFixed(2)} Hz`);
  }
  for (const s of ['cy', 'oh', 'ch']) {
    const a = hit1(s, { sec: 0.25, inst: NOCLOCK }), b = hit1(s, { sec: 0.25, sr: 44100, os: 2, inst: NOCLOCK });
    const fa = peakF(a.y, a.fs, 5000, 9000, 0.01, 0.2), fb = peakF(b.y, b.fs, 5000, 9000, 0.01, 0.2);
    if (!near(fb, fa, 0.005)) bad.push(`${s}: ${fa.toFixed(2)} vs ${fb.toFixed(2)} Hz`);
  }
  assert.deepEqual(bad, []);
});
test('no NaN / Inf, no subnormal on the bus or in an asleep machine\'s states (every sound, accent, every knob at 0 and at 10)', () => {
  const D = D48(), bad = [];
  for (const kn of [0, 1]) {
    const dr = Object.fromEntries(D.mach.tr606.KNOB_IDS.map(k => [k, kn]));
    for (const os of [4, 1]) {
      const m = machine(D, { os, drum: dr, inst: clock(240) }), hits = [];
      S6.forEach((s, i) => { hits.push([i * 960, SI(s), 127]); hits.push([i * 960 + 480, SI(s), 60]); });
      const { y } = render(m, { os, sec: kn ? 30 : 9, hits });
      for (let i = 0; i < y.length; i++) { const v = y[i]; if (!Number.isFinite(v) || (v !== 0 && Math.abs(v) < 2.3e-308)) { bad.push(`knobs ${kn} OS ${os}: ${v} at ${i}`); break; } }
      for (const [k, v] of Object.entries(m._v)) {
        if (v.on) bad.push(`knobs ${kn} OS ${os}: ${k} still awake at the end`);
        for (const [f, x] of Object.entries(v)) if (typeof x === 'number' && x !== 0 && Math.abs(x) < 2.3e-308) bad.push(`${k}.${f} subnormal`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
const PATTERN = [];   // two bars of every lane, accents, the hats' pair on one step, a few hits between the steps
for (let st = 0; st < 32; st++) {
  const f = st * 6000;
  let mask = 0;
  if (st % 4 === 0) mask |= 2 | 1;
  if (st % 8 === 4) mask |= 4;
  mask |= st % 4 === 2 ? 1 << 10 : 1 << 11;
  if (st % 16 === 6) mask |= 8; if (st % 16 === 14) mask |= 32; if (st % 16 === 0) mask |= 1 << 9;
  if (st === 9) mask |= (1 << 10) | (1 << 11);
  PATTERN.push([f, m => m.trig(mask)]);
  if (st % 5 === 1) PATTERN.push([f + 1500, SI(['lt', 'oh', 'ht', 'cy', 'sd', 'ch'][st % 6]), 40 + st * 3]);
}
PATTERN.push([150000, SI('oh'), 127]);   // an OH left ringing past the cut's onset at 240 BPM (the clock in the bytes)
test('determinism: two machines, the same hits → identical bytes (bus and output)', () => {
  const D = D48();
  const a = render(machine(D, { inst: clock(240) }), { sec: 6, hits: PATTERN, post: true }), b = render(machine(D, { inst: clock(240) }), { sec: 6, hits: PATTERN, post: true });
  assert.ok(same(a.y, b.y) && same(a.L, b.L));
  assert.ok(absMax(a.L) > 0.05, 'the pattern sounds');
});
test('span invariance: spans of 4, 128 and random multiples of 4 frames → identical bytes (the tempo clock\'s pulses included)', () => {
  const D = D48();
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return 4 * (1 + (seed >>> 16) % 32); };
  const ref = render(machine(D, { inst: clock(240) }), { sec: 6, hits: PATTERN, post: true });
  for (const [name, span] of [['4', () => 4], ['random', rnd]]) {
    const r = render(machine(D, { inst: clock(240) }), { sec: 6, hits: PATTERN, span, post: true });
    assert.ok(same(ref.y, r.y), `bus, spans ${name}`);
  }
  const a = render(machine(D, { sr: 44100, os: 1, inst: clock(97, 44100) }), { sr: 44100, os: 1, sec: 3, hits: PATTERN.slice(0, 30) });
  const b = render(machine(D, { sr: 44100, os: 1, inst: clock(97, 44100) }), { sr: 44100, os: 1, sec: 3, hits: PATTERN.slice(0, 30), span: () => 4 });
  assert.ok(same(a.y, b.y), 'OS 1');
});
test('order-free latching: hits at one frame in two orders, a step mask vs the same hits one by one; LT + HT and OH + CH both fire', () => {
  const D = D48();
  const S1 = [0, 1, 2, 4, 8, 9, 10], S2 = S1.slice().reverse();
  const at = (list, v) => list.map(s => [4800, s, v]);
  const a = render(machine(D), { sec: 0.6, hits: at(S1, 100) }).y, b = render(machine(D), { sec: 0.6, hits: at(S2, 100) }).y;
  assert.ok(same(a, b), 'two orders');
  for (const acc of [0, 1]) {
    const mask = 2 | 4 | 8 | 32 | (1 << 9) | (1 << 10) | (1 << 11) | acc;
    const t = render(machine(D), { sec: 0.6, hits: [[4800, m => m.trig(mask)]] }).y;
    const h = render(machine(D), { sec: 0.6, hits: at(S1, acc ? 127 : 100) }).y;
    assert.ok(same(t, h), `step mask ${acc ? 'accented' : ''} = hits`);
  }
  // the 808's lanes the 606 lacks (MT, RS, CP, CB) and a hostile hit on a sound it lacks: nothing
  const m = machine(D);
  m.trig(16 | 64 | 128 | 256 | 1); m.hit(3, 127); m.hit(6, 100); m.hit(15, 100);
  assert.equal(m.live(), false, 'nothing latched');
  const lt = render(machine(D), { sec: 0.3, hits: [[4, SI('lt'), 100]] }).y, both = render(machine(D), { sec: 0.3, hits: [[4, SI('lt'), 100], [4, SI('ht'), 100]] }).y;
  assert.ok(!same(lt, both) && rmsW(both, 192000, 0, 0.3) > rmsW(lt, 192000, 0, 0.3), 'LT + HT ring together');
});
test('no allocation over 200 spans with hits, steps, knob glides and the tempo clock', () => {
  const { sc, D } = lib(48000), m = machine(D, { inst: clock(180) }), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128);
  const drum = drumOf(D);
  m.set(drum);
  noAlloc(sc, () => {
    for (let k = 0; k < 200; k++) {
      if (k % 7 === 0) m.trig(0xe2f);
      if (k % 11 === 3) m.hit([0, 1, 2, 4, 8, 9, 10][k % 7], 30 + k % 97);
      if (k % 50 === 25) { drum.bdu = (drum.bdu + 0.3) % 1; drum.ohd = (drum.ohd + 0.2) % 1; }
      buf.fill(0); m.render(buf, 512, k * 128);
      for (let i = 0; i < 128; i++) mono[i] = buf[i * 4];
      m.post(L, R, mono, 128);
      m.live(); m.mon();
    }
  });
});
test('idle and sleep: an asleep 606 runs no circuit code and reads no clock; every circuit sleeps (1e-5 of V_N); mon() reports the 606\'s slots', () => {
  const D = D48(), T = D.proto.tr606, calls = { n: 0 }, m = machine(D, { inst: clock(120, 48000, 0, calls) }), out = [];
  // the time to sleep after one hit (V_N / accented)
  for (const s of S6) {
    const t = [100, 127].map(v => { const mm = machine(D, { drum: { ac: 1 } }); mm.hit(SI(s), v); const b = new Float64Array(512); for (let F = 0; F < 48000 * 8; F += 128) { b.fill(0); mm.render(b, 512, F); if (!mm._v[VKEY[s]].on) return F / 48000; } return Infinity; });
    out.push(`${s} ${(t[0] * 1e3).toFixed(0)} / ${(t[1] * 1e3).toFixed(0)}`);
    assert.ok(t[1] < 4, `${s} sleeps`);
  }
  console.log('# time to sleep after one hit (ms, V_N / V_A 10):', out.join(', '));
  m.hit(SI('bd'), 100); m.hit(SI('oh'), 127); m.hit(SI('lt'), 100);
  const b = new Float64Array(512);
  m.render(b, 512, 0);
  const mo = m.mon();
  assert.equal(mo.lit, 1 | 4 | 512, 'lit: the sounds hit');
  assert.ok(mo.act[0] > 0 && mo.act[2] > 0 && mo.act[9] > 0 && mo.act[4] === 0 && mo.act[3] === 0, `act ${[...mo.act].map(x => x.toFixed(2))}`);
  render(m, { sec: 6, post: true });
  assert.equal(m.live(), false, 'everything asleep, the output settled');
  const c0 = m._M.count, k0 = calls.n;
  render(m, { sec: 1 });
  assert.equal(m._M.count, c0, 'no circuit ran');
  assert.equal(calls.n, k0, 'the clock was not read');
  assert.ok(Object.values(m._v).every(v => Math.abs(v.thr - 1e-5 * T.V_N6) < 1e-12), 'the thresholds');
});
test('sample slots (§5, the 606\'s seven): a slot plays instead of the circuit; TUNE ± 1 octave and DECAY neutral at 5; the CH → OH choke; a slot the 606 lacks plays nothing', () => {
  const { sc, D } = lib(48000), T = D.proto.tr606;
  const len = 9600, L = new Float32Array(len); for (let i = 0; i < len; i++) L[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
  sc.ctx.SxBase = { getAsset: id => (id === 'smp:test' ? { kind: 'smp', rate: 48000, ch: 1, len, root: 60, peak: 1, levels: [{ len, L, R: L }] } : null) };
  try {
    const slots = s => Array.from({ length: 16 }, (_, i) => (i === s ? { id: 'smp:test', on: true } : null));
    const one = (s, drum = {}, hits = [[0, SI(s), 100]]) => { const m = machine(D, { drum }); m.smp(slots(SI(s))); const r = render(m, { sec: 0.2, hits, post: true }); return { r, m }; };
    const z = a => { let n = 0; for (let i = 1; i < 4800; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };
    const a = one('sd');
    assert.equal(a.m._v.sd.on, false, 'the circuit stays asleep');
    // V_N: gain 1 × SMP_LEVEL6 × its LEVEL (a linear pot), through the output stage at rest (gain())
    const want = T.SMP_LEVEL6 * 0.7 * D.gain('tr606', { vol: 0.75 }), got = absMax(a.r.L.subarray(2400, 4800));
    assert.ok(near(got, want, 0.02), `the sample's level ${got} vs ${want}`);
    for (const s of ['bd', 'sd', 'lt', 'ht']) {
      const b0 = one(s), b1 = one(s, { [{ bd: 'bdu', sd: 'sdu', lt: 'ltu', ht: 'htu' }[s]]: 1 }), b2 = one(s, { [{ bd: 'bdd', sd: 'sdd', lt: 'ltd', ht: 'htd' }[s]]: 1 });
      assert.ok(Math.abs(z(b1.r.L) / z(b0.r.L) - 2) < 0.05, `${s}: TUNE 10 = an octave up`);
      assert.ok(same(b0.r.L, b2.r.L), `${s}: DECAY 10 = DECAY 5`);
      assert.ok(Math.abs(z(b0.r.L) - 2 * 440 * 0.1) <= 2, `${s}: TUNE 5 = its pitch`);
    }
    const d0 = one('cy', { cyd: 0 });
    assert.ok(absMax(d0.r.L.subarray(48 * 40, 48 * 60)) < 0.01 * absMax(d0.r.L.subarray(0, 480)), 'DECAY 0: a 30 ms fade (the couplings\' tail)');
    // a CH hit (circuit) cuts an OH sample; a CH sample fires the closed side muted, which chokes an OH circuit
    const m = machine(D); m.smp(slots(SI('oh')));
    const r = render(m, { sec: 0.2, hits: [[0, SI('oh'), 100], [4800, SI('ch'), 100]], post: true });
    assert.ok(absMax(r.L.subarray(4800 + 200, 4800 + 1200)) < 0.5 * absMax(r.L.subarray(1000, 4000)), 'the OH sample cut');
    const free = render(machine(D, { inst: NOCLOCK }), { sec: 0.6, hits: [[0, SI('oh'), 100]] }).y;
    const m2 = machine(D, { inst: NOCLOCK }); m2.smp(slots(SI('ch')));
    const ck = render(m2, { sec: 0.6, hits: [[0, SI('oh'), 100], [4800, SI('ch'), 100]] }).y;
    assert.ok(rmsW(ck, 192000, 0.3, 0.4) < 0.5 * rmsW(free, 192000, 0.3, 0.4), 'a CH sample chokes the OH circuit');
    // a slot on a sound the 606 lacks: a hit never reaches it
    const m3 = machine(D); m3.smp(slots(SI('cp'))); m3.hit(SI('cp'), 127);
    assert.equal(m3.live(), false, 'the clap\'s slot is not played');
  } finally { delete sc.ctx.SxBase; }
});
test('the extras (§2.3): at 5 the stock circuit, byte for byte (the coefficients are the components\'); monotone over 0 → 10', () => {
  const D = D48(), P = D.proto, T = P.tr606, bad = [];
  // a panel without the extras' keys renders the same bytes as every extra at 5 (5 → 4 ** 0 = 1 exactly)
  const noX = drumOf(D); for (const k of ['bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'cyd', 'ohd', 'chd']) delete noX[k];
  const m0 = D.create({ base: 48000, OS: 4, seedSalt: 0 }, 'tr606'); m0.set(noX);
  const a = render(m0, { sec: 2, hits: PATTERN.slice(0, 20) }).y, b = render(machine(D), { sec: 2, hits: PATTERN.slice(0, 20) }).y;
  if (!same(a, b)) bad.push('extras absent ≠ extras at 5');
  // the BD's two resonators and the SD's at 5: exactly the stock components' designs
  const m = machine(D), fs = 192000, B = T.BD6, S = T.SD6;
  const c = new Float64Array(9);
  T.btDesign(c, B.C19, B.R59, 1 / B.R58, 2 / P.kBil(1 / (2 * Math.PI * B.C19 * Math.sqrt(B.R59 * B.R58)), fs));
  if (!same(c, m._v.bd.ca)) bad.push('BD IC5A coefficients');
  T.btDesign(c, S.C32, S.R112, 1 / (S.R107 + S.R115), 2 / P.kBil(1 / (2 * Math.PI * S.C32 * Math.sqrt(S.R112 * (S.R107 + S.R115))), fs));
  if (!same(c, m._v.sd.cr)) bad.push('SD IC10A coefficients at rest');
  if (m._v.hh.r167 !== T.HH6.R167 || m._v.hh.r134 !== T.HH6.R134 || m._v.cy.r49 !== T.CY6.R163 + T.CY6.R164) bad.push('the envelopes\' resistors');
  // monotone: TUNE raises the pitch, DECAY lengthens the ring, over 0 / 2.5 / 5 / 7.5 / 10
  const U = [0, 0.25, 0.5, 0.75, 1];
  const tone = (s, drum, sec) => { const mm = machine(D, { drum, inst: NOCLOCK }); render(mm, { sec: 0.004 }); mm._v.tm.kR = 0; return render(mm, { sec, hits: [[4, SI(s), 100]] }).y; };
  for (const [s, k, band] of [['bd', 'bdu', [20, 260]], ['sd', 'sdu', [80, 500]], ['lt', 'ltu', [50, 300]], ['ht', 'htu', [90, 450]]]) {
    const f = U.map(u => peakF(tone(s, { [k]: u }, 0.5), 192000, ...band, 0.1, 0.45));
    if (!f.every((x, i) => i === 0 || x > f[i - 1] * 1.1)) bad.push(`${k}: ${f.map(x => x.toFixed(1))}`);
    if (!near(f[4] / f[2], 2, 0.03) || !near(f[2] / f[0], 2, 0.03)) bad.push(`${k}: not ± 1 octave (${f.map(x => x.toFixed(1))})`);
  }
  for (const [s, k] of [['bd', 'bdd'], ['sd', 'sdd'], ['lt', 'ltd'], ['ht', 'htd'], ['cy', 'cyd'], ['oh', 'ohd'], ['ch', 'chd']]) {
    const t = U.map(u => decay(tone(s, { [k]: u }, s === 'cy' || s === 'oh' ? 6 : 2), 192000, 30));
    if (!t.every((x, i) => i === 0 || x > t[i - 1])) bad.push(`${k}: ${t.map(x => x.toFixed(3))}`);
  }
  assert.deepEqual(bad, []);
});
test('§2.5 level: the BD at the default panel, unaccented, peaks at the 808\'s default BD (± 1 dB)', () => {
  const D = D48();
  const b6 = absMax(hit1('bd', { sec: 1, post: true }).L);
  const m8 = D.create({ base: 48000, OS: 4, seedSalt: 0 }, 'tr808');
  m8.set(Object.assign(Object.fromEntries(D.KNOB_IDS.map((k, i) => [k, D.KNOB_DEF[i]])), { lts: 0, mts: 0, hts: 0, rss: 0, cps: 0 }));
  const b8 = absMax(render(m8, { sec: 1, hits: [[0, 0, 100]], post: true }).L);
  console.log(`# level: the 606's BD ${b6.toFixed(4)} (${dB(b6).toFixed(2)} dBFS), the 808's ${b8.toFixed(4)}`);
  assert.ok(Math.abs(dB(b6 / b8)) <= 1, `${dB(b6 / b8).toFixed(2)} dB`);
});

/* ---------------------------------------------------------------- CPU (§2.6) */
test('CPU per circuit (reported) and the d6p / d6x / d6m / idle patterns, the machine alone (node, OS 4, 48 kHz) within §2.6\'s rows', () => {
  const D = D48(), out = [], X = D.mach.tr606.KNOB_IDS;
  const load = (hits, sec, drum, every, inst = clock(120)) => {
    const m = machine(D, { drum, inst }), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128);
    let F = 0, nx = 0;
    const t0 = performance.now();
    while (F < sec * 48000) {
      if (every && F >= nx) { hits(m); nx += every * 48000; }
      buf.fill(0); m.render(buf, 512, F);
      for (let i = 0; i < 128; i++) mono[i] = buf[i * 4];
      m.post(L, R, mono, 128); F += 128;
    }
    return (performance.now() - t0) / 1000 / sec;
  };
  for (const s of S6) { load(m => m.hit(SI(s), 127), 0.3, {}, 0.1); out.push(`${s} ${load(m => m.hit(SI(s), 127), 1.5, {}, 0.1).toFixed(4)}`); }
  let st = 0;
  const d6p = m => { const s = st++ % 16; let k = 0; if (s % 4 === 0) k |= 3; if (s === 4 || s === 12) k |= 4; k |= s % 4 === 2 ? 1 << 10 : 1 << 11; if (s === 10) k |= 8; if (s === 14) k |= 32; if (s === 0) k |= 1 << 9; m.trig(k); };
  const best = f => Math.min(f(), f(), f());
  const R = {
    d6p: best(() => load(d6p, 4, {}, 0.125)),
    d6x: best(() => load(m => m.trig(0xe2f), 3, Object.fromEntries(X.filter(k => /d$/.test(k) && k.length === 3).map(k => [k, 1])), 0.25)),
    d6m: best(() => load(m => m.trig(1 << 9 | 1 << 10), 3, {}, 0.5)),
    idle: best(() => load(() => {}, 2, {}, 0)),
  };
  console.log('# CPU (s per s, retriggered every 100 ms; patterns: the machine alone):', out.join(', '), '|', Object.entries(R).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', '));
  // (d6i is the Inst past its quiet window, which never calls the machine — E6's row p method; here a silent machine still
  // runs its output stage every span: ≈ 0.0003–0.0004, held under the iPad's d6i)
  assert.ok(R.d6p <= 0.025 && R.d6x <= 0.06 && R.d6m <= 0.025 && R.idle <= 0.001, JSON.stringify(R));
});
