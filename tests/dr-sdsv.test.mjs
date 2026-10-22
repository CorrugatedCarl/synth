// The SDS-V voice cards (stage 7d + 8 lane V5; IMPL-8 §12, §15.1): every channel alone through Dr808.create(…, 'sdsv')
// (dr-808.js) at 48 kHz × 4 and 44.1 kHz × 2 — each block against its own analog prototype (target (a): the RC², the noise's
// pole, the output's coupling, the SSM2044, the VCO and its alias gate, the envelopes, the trigger's threshold), the described
// behaviour (target (b), research-sdsv-circuits.md §5: the downward bend, the dynamic noise pitch and tom bend, SENSITIVITY's
// compression, the balances' silent ends, the four memories, the trims, a memory switch gliding) and the machine's contracts
// (retrigger, rates, no NaN / subnormal, determinism, span invariance, order-free latching, no allocation, idle and sleep, the
// sample slots, the §12.4 level). CPU per card is reported; the patterns (the machine alone) within §12.7's rows. Measurements
// on the mix bus (the cards' sum, volts) unless a state or the tone path (a card's tap: its RC² out) is the measure.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';

const SRC = source('dr-808.js');
const LIBS = new Map();
function lib(sr = 48000, src = SRC, key = '') {
  const k = sr + key;
  if (!LIBS.has(k)) {
    const sc = dspScope({ files: [], fast: true, sampleRate: sr });
    sc.run(src, 'dr-808.js');
    LIBS.set(k, { sc, D: sc.global('Dr808') });
  }
  return LIBS.get(k);
}
const D48 = () => lib(48000).D;
const CH = ['b', 's', '1', '2', '3'];                       // the channels: bass, snare, toms 1–3 (tom 1 the highest)
const SID = [0, 1, 4, 3, 2];                                // channel → sound id (bd sd ht mt lt)
const NAME = ['bass', 'snare', 'tom 1', 'tom 2', 'tom 3'];
const kid = (c, f) => 'x' + CH[c] + f;
const dB = x => 20 * Math.log10(Math.max(1e-300, x));
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const absMax = a => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const maxAbsDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
const same = (a, b) => a.length === b.length && maxAbsDiff(a, b) === 0;
const rmsW = (y, fs, a, b) => { let s = 0, n = 0; for (let i = Math.round(a * fs); i < Math.min(y.length, Math.round(b * fs)); i++) { s += y[i] * y[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
// hash32 (dr-808.js's lowbias32), for the noise's reference
function hash32(a) { a ^= a >>> 16; a = Math.imul(a, 0x7feb352d); a ^= a >>> 15; a = Math.imul(a, 0x846ca68b); a ^= a >>> 16; return a >>> 0; }

function drumOf(D, over = {}) {
  const X = D.mach.sdsv, d = Object.fromEntries(X.KNOB_IDS.map((k, i) => [k, X.KNOB_DEF[i]]));
  X.SW_IDS.forEach((k, i) => { d[k] = X.SW_DEF[i]; });
  return Object.assign(d, over);
}
// a machine; m.d the drum object it reads (a test edits it between spans: a knob turned, a memory key pressed)
function machine(D, { sr = 48000, os = 4, drum = {}, opt } = {}) {
  const m = D.create({ base: sr, OS: os, seedSalt: 0 }, 'sdsv', opt);
  m.d = drumOf(D, drum); m.set(m.d);
  return m;
}
// one machine, hits [[frame, sound, v127] | [frame, fn(m)]] (frames multiples of 4), spans `span(F)` frames, cut at the hits
// as the engine cuts them; the bus at the OS rate and, when asked, the base-rate output (post: a sample-picking decimation)
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
function hit1(c, { v = 100, sr = 48000, os = 4, sec = 1, drum = {}, opt, post = false, D = lib(sr).D } = {}) {
  const m = machine(D, { sr, os, drum, opt });
  return Object.assign(render(m, { sr, os, sec, hits: [[0, SID[c], v]], post }), { m, card: m._cards[c] });
}
// a card's tone path alone (its tap: the RC² out on the bus) and the VCO's frequency per OS sample (fTr)
function tap(c, { v = 100, sr = 48000, os = 4, sec = 0.5, drum = {}, D = lib(sr).D, hits } = {}) {
  const m = machine(D, { sr, os, drum }), card = m._cards[c], N = Math.round(sec * sr / 4) * 4 * os;
  card.tap = true; card.fTr = new Float64Array(N + 4 * os);
  const r = render(m, { sr, os, sec, hits: hits || [[0, SID[c], v]] });
  return Object.assign(r, { m, card, f: card.fTr });
}
// a state of the machine sampled every chunk (4 frames) for `sec`, after `hits`
function trace(m, sec, get, hits = []) {
  const b = new Float64Array(64), out = [];
  let h = 0;
  for (let F = 0; F < sec * 48000; F += 4) {
    while (h < hits.length && hits[h][0] <= F) { const e = hits[h++]; if (typeof e[1] === 'function') e[1](m); else m.hit(e[1], e[2]); }
    b.fill(0); m.render(b, 4 * m._M.OS, F); out.push(get(m));
  }
  return out;
}
// the exponential time constant of a trace sampled every chunk (4 frames at 48 kHz): ln-fit over [i0, i1)
function tauOf(tr, i0, i1) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = i0; i < i1; i++) { const v = tr[i]; if (!(v > 0)) continue; const x = i * 4 / 48000, yv = Math.log(v); sx += x; sy += yv; sxx += x * x; sxy += x * yv; n++; }
  return -1 / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
}

/* ---------------------------------------------------------------- analysis */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const xr = re[i + j + h] * cr - im[i + j + h] * ci, xi = re[i + j + h] * ci + im[i + j + h] * cr;
        re[i + j + h] = re[i + j] - xr; im[i + j + h] = im[i + j] - xi; re[i + j] += xr; im[i + j] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// the 1 ms peak envelope; the time (s) after which it stays below the peak − db
function env(y, fs, w = 0.001) {
  const n = Math.max(1, Math.round(w * fs)), e = [];
  for (let i = 0; i + n <= y.length; i += n) { let p = 0; for (let j = 0; j < n; j++) p = Math.max(p, Math.abs(y[i + j])); e.push(p); }
  return e;
}
function decay(y, fs, db = 20) {
  const e = env(y, fs);
  let pk = 0, ip = 0;
  for (let i = 0; i < e.length; i++) if (e[i] > pk) { pk = e[i]; ip = i; }
  let last = ip;
  for (let i = ip; i < e.length; i++) if (e[i] >= pk * 10 ** (-db / 20)) last = i;
  return { t: (last + 1) * 0.001, tp: ip * 0.001 };
}
// upward zero crossings (interpolated) in [t0, t1) → the mean frequency
function zcF(y, fs, t0, t1) {
  const xs = [];
  for (let i = Math.round(t0 * fs) + 1; i < Math.round(t1 * fs); i++) if (y[i - 1] < 0 && y[i] >= 0) xs.push(i - 1 - y[i - 1] / (y[i] - y[i - 1]));
  return (xs.length - 1) / ((xs[xs.length - 1] - xs[0]) / fs);
}
// the harmonics' levels (dB re H1) over [t0, t1) at fundamental f
function harm(y, fs, f, t0, t1, hs) {
  const a = Math.round(t0 * fs), L = Math.round(t1 * fs) - a;
  const m = h => { let re = 0, im = 0; for (let i = 0; i < L; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / L), p = 2 * Math.PI * h * f * i / fs; re += y[a + i] * w * Math.cos(p); im += y[a + i] * w * Math.sin(p); } return Math.hypot(re, im); };
  const h1 = m(1);
  return hs.map(h => dB(m(h) / h1));
}
// the spectral centroid (Hz) of y over [t0, t1) below 20 kHz
function centroid(y, fs, t0, t1) {
  const a = Math.round(t0 * fs), L = Math.round(t1 * fs) - a;
  let n = 1; while (n < L) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < L; i++) re[i] = y[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L));
  fft(re, im);
  let s = 0, w = 0;
  for (let k = 1; k * fs / n < 20000; k++) { const p = re[k] * re[k] + im[k] * im[k]; s += p; w += p * k * fs / n; }
  return w / s;
}
// a TDF-II first-order section's response (c[0…2] = b0 b1 a1)
function hz1(c, f, fs) { const w = 2 * Math.PI * f / fs, zr = Math.cos(w), zi = -Math.sin(w); return Math.hypot(c[0] + c[1] * zr, c[1] * zi) / Math.hypot(1 + c[2] * zr, c[2] * zi); }
// a band-limited decimation (a windowed sinc below 20 kHz, then every OS-th sample), as tests/dr-909.test.mjs's
function decim(y, os) {
  const H = 95, c = 20000 / (48000 * os), h = new Float64Array(H);
  let s = 0;
  for (let k = 0; k < H; k++) { const x = k - (H - 1) / 2, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (H - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (H - 1)); h[k] = (x === 0 ? 2 * c : Math.sin(2 * Math.PI * c * x) / (Math.PI * x)) * w; s += h[k]; }
  const n = Math.floor(y.length / os), o = new Float64Array(n);
  for (let i = 0; i < n; i++) { let a = 0; const e = i * os + (H - 1) / 2; for (let k = 0; k < H; k++) { const j = e - k; if (j >= 0 && j < y.length) a += h[k] * y[j]; } o[i] = a / s; }
  return o;
}
// the bus band-limited and decimated, then the machine's own output stage (post): full scale
function out(m, hits, sec, os = 4) {
  const y = decim(render(m, { sec, hits, os }).y, os), L = new Float32Array(y.length), Lb = new Float32Array(128), Rb = new Float32Array(128), mono = new Float64Array(128);
  for (let F = 0; F < y.length; F += 128) { const n = Math.min(128, y.length - F); mono.set(y.subarray(F, F + n)); m.post(Lb, Rb, mono, n); L.set(Lb.subarray(0, n), F); }
  return L;
}

/* ---------------------------------------------------------------- the module */
test('Dr808 builds the SDS-V (create(…, \'sdsv\')): mach / gain / proto.sdsv, the controls of §11.2, the machine interface + trim; the 808\'s, 606\'s and 909\'s tables and machines unchanged', () => {
  const D = D48(), T = D.proto.sdsv, X = D.mach.sdsv;
  assert.ok(Object.isFrozen(T) && Object.isFrozen(X) && Object.isFrozen(T.CV) && T.CV.every(Object.isFrozen) && Object.isFrozen(T.FACTV) && Object.isFrozen(T.TRIMV));
  assert.deepEqual([...X.sids], [0, 1, 2, 3, 4], 'bass, snare, toms 3 / 2 / 1 on the 808\'s bd sd lt mt ht');
  assert.deepEqual([...X.SOUNDS], [...D.SOUNDS], 'the 808\'s sound keys (5–15 inert)');
  assert.deepEqual([...X.KNOB_IDS], CH.flatMap(c => ['n', 't', 'b', 'd', 'm', 'c', 's', 'l'].map(f => 'x' + c + f)), 'x + channel + field, channel by channel');
  assert.deepEqual([...X.SW_IDS], ['xbp', 'xsp', 'x1p', 'x2p', 'x3p']);
  assert.deepEqual([...X.SW_DEF], [1, 1, 1, 1, 1], 'the memory keys default to 2 (the knobs)');
  assert.deepEqual([...T.CH_OF_V], [0, 1, 4, 3, 2]);
  assert.deepEqual(Array.from(T.CV, p => p.sid), SID);
  X.KNOB_IDS.forEach((k, i) => { const c = i >> 3, f = i & 7; assert.equal(X.KNOB_DEF[i], f < 6 ? T.FACTV[6 * c + f] : f === 6 ? 0.5 : 0.7, k); });
  assert.ok(T.FACTV.length === 30 && T.TRIMV.length === 60 && [...T.FACTV, ...T.TRIMV].every(x => x >= 0 && x <= 1));
  // the card tables: RV §2.4's ranges (TONE, NOISE, BEND, the sweep, the snare's resonance and modulation, the toms' dynamic bend)
  const R = [[30, 120, 60, 3000, 1.5, 1.5, 0, 0, 0], [110, 440, 300, 12000, 1, 0, 2.2, 0.025, 0], [90, 520, 150, 6000, 2, 2, 0, 0, 0.25],
    [65, 380, 120, 5000, 2, 2, 0, 0, 0.25], [45, 260, 90, 4000, 2, 2, 0, 0, 0.25]];
  T.CV.forEach((p, c) => assert.deepEqual([p.F0, p.F1, p.N0, p.N1, p.BO, p.SW, p.K, p.MOD, p.DB], R[c], NAME[c]));
  assert.equal(D.gain('sdsv', null), T.OUT_KV);
  assert.equal(D.gain('sdsv', { vol: 0 }), T.OUT_KV, 'no master knob (the track\'s volume)');
  for (const k of ['tr808', 'tr606', 'tr909']) assert.deepEqual(Object.keys(D.mach[k]), ['KNOB_IDS', 'KNOB_DEF', 'SOUNDS', 'sids'], k);
  assert.equal(D.KNOB_IDS.length, 23, 'the top-level exports stay the 808\'s');
  assert.equal(D.create({ base: 48000, OS: 1 }, 'sds5'), null, 'another kind: no machine');
  const m = machine(D);
  for (const f of ['set', 'setOS', 'hit', 'trig', 'render', 'post', 'poll', 'live', 'reset', 'mon', 'smp', 'setSalt', 'trim']) assert.equal(typeof m[f], 'function', f);
  assert.equal(m._mach, 'sdsv');
  assert.equal(m.live(), false, 'a fresh machine is silent');
  assert.deepEqual(Object.keys(m._v).sort(), ['bd', 'ht', 'lt', 'mt', 'sd'], 'five cards');
  assert.ok(m._v.lt === m._cards[4] && m._v.ht === m._cards[2], 'tom 3 the low tom, tom 1 the high');
  for (const k of ['tr808', 'tr606', 'tr909']) assert.equal(D.create({ base: 48000, OS: 4, seedSalt: 0 }, k).trim, undefined, `${k}: no trim (the engine's guard)`);
});

/* ---------------------------------------------------------------- the trigger (§11.4, P-4) */
test('the trigger (§11.4): pad volts 5…75 mV, SENSITIVITY × 20…632 and its soft limit (RV §5\'s V_D ratios), the comparator\'s soft-hit threshold — no hit at SENS 0 v 33 / SENS 1 v 17 / SENS 2 v 1, a hit at v 34 / 18 / 2, on every card', () => {
  const D = D48(), T = D.proto.sdsv;
  assert.ok(near(T.padVolts(1), 0.005, 1e-12) && near(T.padVolts(127), 0.075, 1e-12));
  assert.ok(near(T.sens(0), 20, 1e-12) && near(T.sens(1), 20 * 10 ** 1.5, 1e-12));
  const ratio = s => T.vD(T.padVolts(127), s) / T.vD(T.padVolts(40), s);
  for (const [s, want] of [[0.2, 6.30], [0.8, 2.80], [0.5, 5.3], [1, 1.6]]) assert.ok(Math.abs(ratio(s) - want) < 0.06, `V_D(127) / V_D(40) at SENS ${s * 10}: ${ratio(s)}`);
  assert.ok(T.vD(T.padVolts(127), 1) <= T.VL && T.vD(T.padVolts(127), 1) > 0.99 * T.VL, 'the soft limit');
  assert.deepEqual([0, 0.1, 0.2, 0.21, 0.5, 1].map(T.minVel), [34, 18, 2, 1, 1, 1], 'the lowest velocity that fires (the panel\'s tip)');
  const bad = [], b = new Float64Array(512);
  for (let c = 0; c < 5; c++) {
    for (const [s, vNo, vYes] of [[0, 33, 34], [0.1, 17, 18], [0.2, 1, 2]]) {
      const m = machine(D, { drum: { [kid(c, 's')]: s } });
      m.hit(SID[c], vNo); b.fill(0); m.render(b, 512, 0);
      const lo = m.mon().lit;
      if (m.live() || absMax(b) !== 0 || lo !== 0) bad.push(`${NAME[c]} SENS ${s * 10} v ${vNo} fired`);
      m.hit(SID[c], vYes); b.fill(0); m.render(b, 512, 128);
      if (!m._cards[c].on || m.mon().lit !== 1 << SID[c] || !(absMax(b) > 0)) bad.push(`${NAME[c]} SENS ${s * 10} v ${vYes} silent`);
    }
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- target (a): the fixed networks */
test('target (a): the RC² (two sections at 1.5 × the card\'s top), the noise\'s 20 kHz pole and the mix output\'s coupling against their analog prototypes (± 0.2 dB to 5 kHz, OS 4); the RC²\'s near-sine — the triangle\'s 3rd harmonic −30 dB at TONE 10, −20 … −21 dB at TONE 0 (± 0.5, RV §2.3)', () => {
  const D = D48(), T = D.proto.sdsv, m = machine(D), fs = 192000, bad = [];
  for (let c = 0; c < 5; c++) {
    const card = m._cards[c], fc = 1.5 * T.CV[c].F1;
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000]) {
      const a = dB(hz1(card.rc, f, fs) ** 2), p = dB(1 / (1 + (f / fc) ** 2));
      if (Math.abs(a - p) > 0.2) bad.push(`${NAME[c]} RC² at ${f} Hz: ${a.toFixed(3)} vs ${p.toFixed(3)}`);
      const s = dB(hz1(card.sm, f, fs)), q = dB(1 / Math.sqrt(1 + (f / 20000) ** 2));
      if (Math.abs(s - q) > 0.2) bad.push(`${NAME[c]} 20 kHz pole at ${f} Hz: ${s} vs ${q}`);
    }
  }
  for (const f of [1, 3, 10, 30, 100, 1000, 5000]) {
    const a = dB(hz1(m._ost.c1, f, 48000)), p = dB((f / T.HC_V) / Math.sqrt(1 + (f / T.HC_V) ** 2));
    if (Math.abs(a - p) > 0.2) bad.push(`the coupling at ${f} Hz: ${a} vs ${p}`);
  }
  // the tone path's 3rd harmonic (no bend; the snare's 31 Hz modulation smears it: the bass and the toms)
  const out3 = [];
  for (const c of [0, 2, 3, 4]) for (const t of [0, 1]) {
    const r = tap(c, { sec: 0.4, drum: { [kid(c, 't')]: t, [kid(c, 'b')]: 0 } }), f = T.CV[c].F0 * (T.CV[c].F1 / T.CV[c].F0) ** t;
    const [h3] = harm(r.y, r.fs, f, 0.1, 0.1 + Math.round(0.25 * f) / f, [3]);
    out3.push(`${NAME[c]} TONE ${t * 10} ${h3.toFixed(1)}`);
    if (t === 1 ? Math.abs(h3 + 30) > 1 : !(h3 <= -19.5 && h3 >= -21.5)) bad.push(`${NAME[c]} TONE ${t * 10}: H3 ${h3.toFixed(2)} dB`);
  }
  console.log('# the tone path\'s 3rd harmonic (dB re H1):', out3.join(', '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- target (a): the SSM2044 */
const FS4 = 192000;
function ota(T, fc, k, fbs, fs = FS4) { const F = new T.Ota4(); F.k = k; F.fbs = fbs; F.zero(); F.g = Math.tan(Math.PI * Math.min(fc, 0.46 * fs) / fs); return F; }
// the steady-state gain of a fresh Ota4 at f (a small sine: the linear region)
function gainAt(T, fc, k, fbs, f, a = 0.01) {
  const F = ota(T, fc, k, fbs), w = 2 * Math.PI * f / FS4, settle = Math.round(FS4 * Math.max(0.03, 15 / f)), N = Math.round(FS4 * Math.max(0.03, 30 / f));
  for (let i = 0; i < settle; i++) F.step(a * Math.sin(w * i));
  let re = 0, im = 0;
  for (let i = settle; i < settle + N; i++) { const y = F.step(a * Math.sin(w * i)); re += y * Math.sin(w * i); im += y * Math.cos(w * i); }
  return Math.hypot(re, im) * 2 / N / a;
}
// the prototype 1 / ((1 + s/ω)⁴ + k) at the bilinear's warped frequency
function protoOta(fc, k, f, fs = FS4) {
  const x = Math.tan(Math.PI * f / fs) / Math.tan(Math.PI * fc / fs);
  let re = 1, im = 0; for (let i = 0; i < 4; i++) { const r = re - im * x, m = re * x + im; re = r; im = m; }
  return 1 / Math.hypot(re + k, im);
}
test('target (a): the SSM2044 (Ota4) — small-signal 1 / ((1 + s/ω)⁴ + k) within 0.2 dB to 5 kHz, the 4-pole slope over two octaves above f_c (± 1 dB / octave), the snare\'s peak (± 1 dB), no self-oscillation at its k, f_c = NOISE\'s law ± 2 %, clamped at 0.46 · the OS rate (finite at OS 1, 44.1 kHz)', () => {
  const D = D48(), T = D.proto.sdsv, bad = [], K = T.CV[1].K;
  for (const [k, fbs] of [[0, 0], [K, T.FBS_V]]) {
    const fc = 1000;
    for (const f of [100, 300, 700, 1000, 1500, 2000, 3000, 5000]) { const a = dB(gainAt(T, fc, k, fbs, f)), p = dB(protoOta(fc, k, f)); if (Math.abs(a - p) > 0.2) bad.push(`k ${k} at ${f}: ${a.toFixed(2)} vs ${p.toFixed(2)}`); }
    const sl = (f1, f2, fn) => fn(f2) - fn(f1);
    for (const [f1, f2] of [[fc, 2 * fc], [2 * fc, 4 * fc]]) {
      const a = sl(f1, f2, f => dB(gainAt(T, fc, k, fbs, f))), p = sl(f1, f2, f => dB(protoOta(fc, k, f)));
      if (Math.abs(a - p) > 1) bad.push(`k ${k} slope ${f1}–${f2}: ${a.toFixed(2)} vs ${p.toFixed(2)} dB / octave`);
    }
  }
  // the snare's resonance (k 2.2: ≈ 9 dB over its passband) at three cutoffs; no self-oscillation (an impulse rings down)
  for (const fc of [500, 3000, 12000]) {
    let ma = 0, mp = 0;
    for (let f = 0.6 * fc; f < 1.2 * fc; f *= 1.01) { ma = Math.max(ma, gainAt(T, fc, K, T.FBS_V, f)); mp = Math.max(mp, protoOta(fc, K, f)); }
    if (Math.abs(dB(ma) - dB(mp)) > 1) bad.push(`the snare's peak at f_c ${fc}: ${dB(ma).toFixed(2)} vs ${dB(mp).toFixed(2)}`);
    const F = ota(T, fc, K, T.FBS_V);
    F.step(1);
    let tail = 0; for (let i = 1; i < FS4 * 0.3; i++) { const y = F.step(0); if (i > FS4 * 0.2) tail = Math.max(tail, Math.abs(y)); }
    if (!(tail < 1e-9)) bad.push(`f_c ${fc}: the impulse still rings at 0.2 s (${tail})`);
  }
  // f_c from NOISE (the cards with no feedback): the card's cutoff at rest (the hit's first chunk: EG_N 0) is tan(π f_N / fs), f_N
  // = N0 (N1/N0)^NOISE; the measured −12.04 dB point (the 4-pole's corner) within 2 %
  for (const c of [0, 2, 3, 4]) for (const n of [0, 0.5, 1]) {
    const m = machine(D, { drum: { [kid(c, 'n')]: n } }), card = m._cards[c], P = T.CV[c], fN = P.N0 * (P.N1 / P.N0) ** n;
    m.hit(SID[c], 100); m.render(new Float64Array(16), 16, 0);
    if (Math.abs(card.flt.g - Math.tan(Math.PI * fN / FS4)) > 1e-12) bad.push(`${NAME[c]} NOISE ${n * 10}: g ${card.flt.g}`);
    let lo = fN / 2, hi = fN * 2;
    for (let i = 0; i < 30; i++) { const mid = Math.sqrt(lo * hi); if (dB(gainAt(T, fN, 0, 0, mid)) > -12.0412) lo = mid; else hi = mid; }
    if (!near(Math.sqrt(lo * hi), fN, 0.02)) bad.push(`${NAME[c]} NOISE ${n * 10}: corner ${Math.sqrt(lo * hi)} vs ${fN}`);
  }
  // the clamp: tom 1 at NOISE 10 swept by v 127, SENS 10 — 6 kHz × 2² = 24 kHz: at OS 4 reached, at OS 1 (44.1 kHz) held at 0.46 fs
  for (const [sr, os] of [[48000, 4], [44100, 1]]) {
    const m = machine(lib(sr).D, { sr, os, drum: { x1n: 1, x1s: 1, x1m: 0.8 } }), card = m._cards[2], fs = sr * os;
    let gx = 0, fin = true;
    const tr = trace(m, 0.05, mm => { gx = Math.max(gx, card.flt.g); return 0; }, [[0, 4, 127]]);
    const r = render(machine(lib(sr).D, { sr, os, drum: { x1n: 1, x1s: 1, x1m: 0.8 } }), { sr, os, sec: 0.3, hits: [[0, 4, 127]] });
    for (const v of r.y) if (!Number.isFinite(v)) { fin = false; break; }
    // (at OS 4 EG_N's peak is the attack's ≈ 99 % of V_D: the sweep's top within 0.2 octave of 24 kHz)
    const want = Math.tan(Math.PI * Math.min(0.46 * fs, 6000 * 2 ** (2 * T.vD(T.padVolts(127), 1) / T.VL)) / fs);
    if (!(tr.length && fin && (os === 1 ? Math.abs(gx - want) < 1e-9 * want : gx <= want && gx > Math.tan(Math.PI * 0.87 * 24000 / fs)))) bad.push(`clamp at ${sr} × ${os}: g max ${gx} vs ${want}, finite ${fin}`);
  }
  assert.deepEqual(bad, []);
});

test('the noise path: each card\'s noise a function of the absolute sample (its own salted stream: hash32 of the index, two 16-bit uniforms) through its 20 kHz pole; the SSM2044 written out in the card = Ota4.step bit for bit, the wake\'s 12 ms pre-roll included', () => {
  const D = D48(), T = D.proto.sdsv, bad = [];
  for (const c of [0, 1]) {                                // the bass (the sweep, no feedback) and the snare (the feedback)
    const m = machine(D, { drum: { [kid(c, 'm')]: 1, [kid(c, 'c')]: 0 } }), card = m._cards[c], F = card.flt, CHK = 16, F0 = 480;
    const R = new T.Ota4(); R.k = F.k; R.fbs = F.fbs; R.zero();
    const sd = hash32(card.seed >>> 0), sm = card.sm, sig = card.sig;
    let p1 = 0;
    const w = a => { const h = hash32(((a ^ sd) >>> 0)); let x = ((h & 0xffff) + (h >>> 16) - 65535) * sig; const y = sm[0] * x + p1; p1 = sm[1] * x - sm[2] * y; return y; };
    // the wake: from rest over the 12 ms before the hit, at the cutoff then (EG_N 0: NOISE's f_c)
    const a0 = F0 * 4;
    R.g = Math.tan(Math.PI * Math.min(card.fN, 0.46 * FS4) / FS4);
    for (let a = a0 - card.nPre; a < a0; a++) R.step(w(a));
    const b = new Float64Array(CHK);
    m.render(new Float64Array(F0 * 4), F0 * 4, 0);
    m.hit(SID[c], 110);
    for (let k = 0; k < 200; k++) {
      b.fill(0); m.render(b, CHK, F0 + 4 * k);
      R.g = F.g;                                             // the chunk's cutoff (held over it)
      for (let i = 0; i < CHK; i++) R.step(w(a0 + CHK * k + i));
      for (const f of ['s0', 's1', 's2', 's3', 'y0', 'y1', 'y2', 'y3', 'kf', 'ri', 'h0', 'h1', 'h2', 'h3']) if (R[f] !== F[f]) { bad.push(`${NAME[c]} chunk ${k}: ${f} ${F[f]} vs ${R[f]}`); break; }
      if (bad.length) break;
    }
    if (!card.nzOn) bad.push(`${NAME[c]}: the noise path stopped`);
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- target (a): the VCO */
test('target (a): the VCO against TONE (± 1 %, no bend; the snare\'s mean over its 31 Hz modulation), 44.1 × 2 = 48 × 4 within 0.5 %; reset to its lower peak at each hit — the first period identical after any hit from rest, and a retrigger restarts it', () => {
  const T = D48().proto.sdsv, bad = [], rep = [];
  for (let c = 0; c < 5; c++) for (const t of [0, 0.5, 1]) {
    const P = T.CV[c], f = P.F0 * (P.F1 / P.F0) ** t, drum = { [kid(c, 't')]: t, [kid(c, 'b')]: 0, [kid(c, 'd')]: 0.8 };
    const a = tap(c, { sec: 0.45, drum }), b = tap(c, { sec: 0.45, drum, sr: 44100, os: 2 });
    const fa = zcF(a.y, a.fs, 0.05, 0.05 + 0.3870), fb = zcF(b.y, b.fs, 0.05, 0.05 + 0.3870);
    if (t === 0.5) rep.push(`${NAME[c]} ${fa.toFixed(2)}`);
    if (!near(fa, f, 0.01)) bad.push(`${NAME[c]} TONE ${t * 10}: ${fa} vs ${f}`);
    if (!near(fb, fa, 0.005)) bad.push(`${NAME[c]} TONE ${t * 10}: 44.1 × 2 ${fb} vs ${fa}`);
  }
  console.log('# the VCO at TONE 5 (Hz):', rep.join(', '));
  // reset: the bass and the toms (the snare's modulation runs on absolute time), from rest at two frames: the same first period
  for (const c of [0, 2, 4]) {
    const r = tap(c, { sec: 0.4, hits: [[0, SID[c], 100]] }), r2 = tap(c, { sec: 0.6, hits: [[9600, SID[c], 100]] });
    const P = Math.ceil(192000 / T.CV[c].F0) + 64;
    if (!same(r.y.subarray(0, P), r2.y.subarray(9600 * 4, 9600 * 4 + P))) bad.push(`${NAME[c]}: the first period differs with the hit's frame`);
    // a retrigger mid-ring: the VCO back at its lower peak, rising, as after a fresh hit
    const m = machine(D48()), card = m._cards[c], buf = new Float64Array(16);
    m.hit(SID[c], 100); m.render(buf, 16, 0); const x1 = card.x, d1 = card.d;
    for (let F = 4; F < 2401; F += 4) m.render(buf, 16, F);
    if (!(card.on)) bad.push(`${NAME[c]} asleep at 50 ms`);
    m.hit(SID[c], 100); m.render(buf, 16, 2404);
    if (card.x !== x1 || card.d !== d1) bad.push(`${NAME[c]}: a retrigger leaves the VCO at ${card.x} (${card.d}), not ${x1} (${d1})`);
  }
  assert.deepEqual(bad, []);
});

// the alias gate (review #12): tom 1 at TONE 10, BEND 10, v 127, SENS 10 — the pitch at the hit 2.5 octaves up (≈ 2.94 kHz) — the
// first 20 ms of the tone path (RC² out) against the exact band-limited triangle on the model's own phase (its frequency per
// sample), each harmonic weighted by the 2-point kernel's sinc² (the polyBLAMP's in-band response: what is left is aliasing)
function aliasGate(D, os, c = 2) {
  const T = D.proto.sdsv, P = D.proto, fs = 48000 * os, N = Math.round(0.02 * fs) + 8;
  const r = tap(c, { D, os, sec: 0.03, v: 127, drum: { [kid(c, 't')]: 1, [kid(c, 'b')]: 1, [kid(c, 's')]: 1 } }), f = r.f, y = r.y;
  const ref = new Float64Array(N);
  let ph = 0;
  for (let n = 0; n + 1 < N; n++) {
    ph += f[n] / fs;
    let s = 0;
    for (let k = 1; k * f[n] < fs / 2; k += 2) { const x = k * f[n] / fs, sc = Math.sin(Math.PI * x) / (Math.PI * x); s += Math.cos(2 * Math.PI * k * ph) / (k * k) * sc * sc; }
    ref[n + 1] = -8 / (Math.PI * Math.PI) * s;             // (the model's sample n + 1 is its corrected sample n)
  }
  const rc = new Float64Array(3); P.bil1(rc, 0, 0, 1, 1 / (2 * Math.PI * 1.5 * T.CV[c].F1), 1, P.kBil(1.5 * T.CV[c].F1, fs));
  let r1 = 0, r2 = 0;
  const rr = new Float64Array(N), e = new Float64Array(N);
  for (let n = 0; n < N; n++) { const tv = ref[n], a = rc[0] * tv + r1; r1 = rc[1] * tv - rc[2] * a; const t2 = rc[0] * a + r2; r2 = rc[1] * a - rc[2] * t2; rr[n] = t2; e[n] = y[n] - t2; }
  const L = N - 1; let nf = 1; while (nf < 4 * L) nf <<= 1;
  const spec = arr => { const re = new Float64Array(nf), im = new Float64Array(nf); for (let i = 0; i < L; i++) re[i] = arr[i + 1] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L)); fft(re, im); return [re, im]; };
  const [tr, ti] = spec(rr), [er, ei] = spec(e), kx = Math.floor(20000 * nf / fs);
  let mt = 0, me = 0;
  for (let k = 1; k <= kx; k++) { mt = Math.max(mt, Math.hypot(tr[k], ti[k])); me = Math.max(me, Math.hypot(er[k], ei[k])); }
  return { db: dB(me / mt), f0: f[1] };
}
test('the VCO\'s alias gate (§15.1, review #12): the bent worst case (tom 1, TONE 10, BEND 10, v 127, SENS 10; the first 20 ms) — every alias below 20 kHz ≤ −60 dB re the tone at OS 4, and ≥ 20 dB below the uncorrected corners (the mutation)', () => {
  const g4 = aliasGate(D48(), 4), g2 = aliasGate(D48(), 2);
  const naive = SRC.split('cp -= s * u * u * u / 3; cc = -s * w * w * w / 3;').join('').split('cp += s * u * u * u / 3; cc = s * w * w * w / 3;').join('');
  assert.notEqual(naive, SRC, 'the mutation found the polyBLAMP');
  const gn = aliasGate(lib(48000, naive, 'naive').D, 4);
  console.log(`# aliases re the tone (dB): OS 4 ${g4.db.toFixed(1)}, OS 2 ${g2.db.toFixed(1)}; the corners uncorrected (OS 4) ${gn.db.toFixed(1)}; the pitch at the hit ${g4.f0.toFixed(0)} Hz`);
  assert.ok(near(g4.f0, 520 * 2 ** (2 * (1 + 0.25 * D48().proto.sdsv.vD(0.075, 1) / 10)), 0.01), `the bent pitch ${g4.f0}`);
  assert.ok(g4.db <= -60, `OS 4: ${g4.db}`);
  assert.ok(g4.db <= gn.db - 20, `the polyBLAMP's gain: ${g4.db} vs ${gn.db}`);
});

/* ---------------------------------------------------------------- target (a): the envelopes */
test('target (a): the envelopes — the attack to V_D within the 0.5 ms gate; EG_T\'s τ = T60 / ln 1000, EG_N 0.6 τ_T, EG_P 0.3 τ_T (its 0.4 s cap never binds), the click\'s 1 ms release, each ± 2 % (DECAY 0 / 5 / 10); T60 at DECAY 10 = 5 s ± 15 % on the sound [R]', () => {
  const D = D48(), T = D.proto.sdsv, bad = [], rep = [];
  for (const c of [0, 1, 3]) for (const d of [0, 0.5, 1]) {
    const m = machine(D, { drum: { [kid(c, 'd')]: d } }), card = m._cards[c], tauT = T.t60(d) / Math.log(1000), vd = T.vD(T.padVolts(100), 0.5);
    const sec = Math.min(1.2, 8 * tauT + 0.01), tr = trace(m, sec, () => [card.eT, card.eN, card.eP, card.eC], [[0, SID[c], 100]]);
    const i0 = Math.ceil(0.0006 * 12000), i1 = Math.max(i0 + 8, Math.floor(Math.min(sec, 3 * tauT) * 12000));
    const g = tr[Math.round(0.0005 * 12000) - 1][0];        // (the chunk that ends with the gate)
    if (!(g > 0.99 * vd && g <= vd)) bad.push(`${NAME[c]} DECAY ${d * 10}: EG_T at 0.5 ms ${g} of ${vd}`);
    const tT = tauOf(tr.map(r => r[0]), i0, i1), tN = tauOf(tr.map(r => r[1]), i0, i1), tP = tauOf(tr.map(r => r[2]), i0, i1);
    if (!near(tT, tauT, 0.02)) bad.push(`${NAME[c]} DECAY ${d * 10}: τ_T ${tT} vs ${tauT}`);
    if (!near(tN, 0.6 * tauT, 0.02)) bad.push(`${NAME[c]} DECAY ${d * 10}: τ_N ${tN} vs ${0.6 * tauT}`);
    if (!near(tP, Math.min(0.3 * tauT, 0.4), 0.02)) bad.push(`${NAME[c]} DECAY ${d * 10}: τ_P ${tP} vs ${0.3 * tauT}`);
    // the click: 4 ms at V_D, then its 1 ms release
    const c0 = Math.ceil(0.0041 * 12000), tC = tauOf(tr.map(r => r[3]), c0, c0 + 36);
    if (!near(tC, 1e-3, 0.02) || !(tr[Math.round(0.003 * 12000)][3] > 0.99 * vd)) bad.push(`${NAME[c]}: the click's release ${tC}`);
    if (d === 1) rep.push(`${NAME[c]} τ_T ${(tT * 1e3).toFixed(1)} ms`);
  }
  assert.ok(0.3 * T.t60(1) / Math.log(1000) < 0.4, 'the cap never binds');
  // T60 on the sound: DECAY 10, no bend, tone only, no click
  for (const c of [0, 3]) {
    const r = hit1(c, { sec: 6.5, drum: { [kid(c, 'd')]: 1, [kid(c, 'b')]: 0, [kid(c, 'm')]: 0, [kid(c, 'c')]: 0 } });
    const t60 = decay(r.y, r.fs, 60);
    rep.push(`${NAME[c]} T60 ${(t60.t - t60.tp).toFixed(2)} s`);
    if (!near(t60.t - t60.tp, 5, 0.15)) bad.push(`${NAME[c]}: T60 ${t60.t - t60.tp}`);
  }
  console.log('# envelopes:', rep.join(', '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- target (b) */
test('target (b): the bend — downward (the 5 ms pitch above the 200 ms pitch), monotone in BEND, none at 0; harder hits deepen the toms\' bend only', () => {
  const T = D48().proto.sdsv, bad = [], rep = [];
  const pitch = (r, t) => { let i = Math.round(t * r.fs); return r.f[i]; };
  for (let c = 0; c < 5; c++) {
    const at5 = [];
    for (const b of [0, 0.3, 0.6, 1]) {
      const r = tap(c, { sec: 0.25, drum: { [kid(c, 'b')]: b, [kid(c, 'd')]: 0.8 } });
      const p5 = pitch(r, 0.005), p200 = pitch(r, 0.2), base = T.CV[c].F0 * (T.CV[c].F1 / T.CV[c].F0) ** T.FACTV[6 * c + 1];
      at5.push(p5);
      if (b === 0 && (!near(p5, p200, 0.03) || !near(p200, base, 0.03))) bad.push(`${NAME[c]} BEND 0: ${p5} / ${p200} (${base})`);
      if (b > 0 && !(p5 > p200 * 1.05)) bad.push(`${NAME[c]} BEND ${b * 10}: ${p5} at 5 ms vs ${p200} at 200 ms`);
    }
    if (!at5.every((p, i) => i === 0 || p > at5[i - 1])) bad.push(`${NAME[c]}: not monotone in BEND ${at5}`);
    // the hit's strength: the toms' bend deepens (× (1 + 0.25 V_D / 10)), the bass's and the snare's does not
    const hard = tap(c, { v: 127, sec: 0.02, drum: { [kid(c, 'b')]: 1 } }), soft = tap(c, { v: 40, sec: 0.02, drum: { [kid(c, 'b')]: 1 } });
    const ph = pitch(hard, 0.002), ps = pitch(soft, 0.002);
    rep.push(`${NAME[c]} ${ps.toFixed(0)} → ${ph.toFixed(0)} Hz`);
    if (c >= 2 ? !(ph > ps * 1.05) : !near(ph, ps, 1e-9) && !(c === 1 && near(ph, ps, 0.002))) bad.push(`${NAME[c]}: the bend at v 40 / 127 ${ps} / ${ph}`);
  }
  console.log('# the pitch at 2 ms, BEND 10, v 40 → 127:', rep.join(', '));
  assert.deepEqual(bad, []);
});

test('target (b): harder hits raise the noise\'s spectral centroid on the bass and the toms, not on the snare (its sweep 0); SENSITIVITY compresses (the level ratio v 127 / v 40 at SENS 2 ≥ 1.8 × at SENS 8); the balances\' silent ends', () => {
  const D = D48(), bad = [], rep = [];
  for (let c = 0; c < 5; c++) {
    const drum = { [kid(c, 'm')]: 1, [kid(c, 'c')]: 0, [kid(c, 'd')]: 0.8, [kid(c, 'n')]: 0.4 };
    const cs = [40, 127].map(v => centroid(hit1(c, { v, sec: 0.1, drum }).y, 192000, 0.002, 0.042));
    rep.push(`${NAME[c]} ${cs[0].toFixed(0)} → ${cs[1].toFixed(0)}`);
    if (c === 1 ? !near(cs[1], cs[0], 0.05) : !(cs[1] > 1.15 * cs[0])) bad.push(`${NAME[c]}: the noise's centroid v 40 / 127 ${cs}`);
  }
  console.log('# the noise\'s centroid (Hz) v 40 → 127:', rep.join(', '));
  for (let c = 0; c < 5; c++) {
    const lv = (v, s) => absMax(hit1(c, { v, sec: 0.15, drum: { [kid(c, 's')]: s } }).y);
    const r2 = lv(127, 0.2) / lv(40, 0.2), r8 = lv(127, 0.8) / lv(40, 0.8);
    if (!(r2 >= 1.8 * r8)) bad.push(`${NAME[c]}: v 127 / v 40 at SENS 2 ${r2.toFixed(2)}, at SENS 8 ${r8.toFixed(2)}`);
  }
  // the ends: NOISE / TONE 0 — no noise (nor, with CLICK / DRUM 0, a click: the noise path never runs); NOISE / TONE 10 — no tone;
  // CLICK / DRUM 0 — no click; CLICK / DRUM 10 — the click alone (silent once its gate and release are past)
  for (let c = 0; c < 5; c++) {
    const m0 = machine(D, { drum: { [kid(c, 'm')]: 0, [kid(c, 'c')]: 0 } }), card = m0._cards[c];
    let ran = false;
    trace(m0, 0.2, () => { ran = ran || card.nzOn; return 0; }, [[0, SID[c], 127]]);
    if (ran || card.aN !== 0 || card.aC !== 0) bad.push(`${NAME[c]}: noise at NOISE / TONE 0, CLICK 0`);
    const m1 = machine(D, { drum: { [kid(c, 'm')]: 1 } });
    m1.render(new Float64Array(16), 16, 0);                // (the knobs read at the first span)
    if (m1._cards[c].aT !== 0) bad.push(`${NAME[c]}: tone at NOISE / TONE 10`);
    const r = hit1(c, { v: 127, sec: 0.1, drum: { [kid(c, 'c')]: 1 } });
    if (r.card.aT !== 0 || r.card.aN !== 0 || !(absMax(r.y.subarray(0, 0.004 * 192000)) > 0) || absMax(r.y.subarray(0.03 * 192000)) > 1e-4 * absMax(r.y)) bad.push(`${NAME[c]}: CLICK / DRUM 10 is not the click alone`);
  }
  assert.deepEqual(bad, []);
});

test('the four memories (§11.5): 1 factory, 2 the knobs, 3 / 4 the trims — distinct; the knobs act on memory 2 only, the trims on 3 / 4 only, SENSITIVITY and LEVEL on every memory; trim() takes the payload\'s 5 × 2 × 6 (clamped, a foreign value its default)', () => {
  const D = D48(), T = D.proto.sdsv, bad = [];
  const run = (c, mem, drum = {}, tr = null) => { const m = machine(D, { drum: Object.assign({ [kid(c, 'p')]: mem }, drum) }); if (tr) m.trim(tr); return render(m, { sec: 0.3, hits: [[0, SID[c], 100]] }).y; };
  const trims = Array.from({ length: 5 }, (_, c) => [0, 1].map(j => Array.from({ length: 6 }, (_, f) => T.TRIMV[12 * c + 6 * j + f])));
  for (let c = 0; c < 5; c++) {
    const y = [0, 1, 2, 3].map(mem => run(c, mem));
    if (!same(y[0], y[1])) bad.push(`${NAME[c]}: memory 2 at the default knobs ≠ memory 1`);
    for (const [a, b] of [[0, 2], [0, 3], [2, 3]]) if (same(y[a], y[b])) bad.push(`${NAME[c]}: memories ${a + 1} and ${b + 1} the same`);
    // the knobs: memory 2 moves, 1 / 3 / 4 do not
    const knob = { [kid(c, 't')]: 0.9, [kid(c, 'd')]: 0.2 };
    if (same(run(c, 1, knob), y[1])) bad.push(`${NAME[c]}: the knobs do not reach memory 2`);
    for (const mem of [0, 2, 3]) if (!same(run(c, mem, knob), y[mem])) bad.push(`${NAME[c]}: the knobs reach memory ${mem + 1}`);
    // the trims: memory 3 / 4 move with theirs, the others do not; the defaults = TRIMV
    if (!same(run(c, 2, {}, trims), y[2]) || !same(run(c, 2, {}, null), y[2])) bad.push(`${NAME[c]}: the default trims`);
    const t2 = trims.map(r => r.map(x => x.slice())); t2[c][0][1] = 0.95; t2[c][1][3] = 0.05;
    if (same(run(c, 2, {}, t2), y[2]) || same(run(c, 3, {}, t2), y[3])) bad.push(`${NAME[c]}: a trim does not reach its memory`);
    for (const mem of [0, 1]) if (!same(run(c, mem, {}, t2), y[mem])) bad.push(`${NAME[c]}: a trim reaches memory ${mem + 1}`);
    // SENSITIVITY and LEVEL on every memory
    for (const mem of [0, 2, 3]) {
      if (same(run(c, mem, { [kid(c, 's')]: 0.9 }), y[mem])) bad.push(`${NAME[c]} memory ${mem + 1}: SENSITIVITY ignored`);
      const yl = run(c, mem, { [kid(c, 'l')]: 1 });
      if (!near(absMax(yl) / absMax(y[mem]), 1 / ((10 ** 1.4 - 1) / 99), 0.01)) bad.push(`${NAME[c]} memory ${mem + 1}: LEVEL 10 / 7 ${absMax(yl) / absMax(y[mem])}`);
    }
  }
  // trim(): clamped, a foreign value its default, null all defaults
  const m = machine(D), tv = m._trv;
  const t = trims.map(r => r.map(x => x.slice())); t[0][0][0] = 2; t[1][1][5] = -1; t[2][0][2] = 'x'; t[3] = null;
  m.trim(t);
  assert.equal(tv[0], 1); assert.equal(tv[12 + 6 + 5], 0); assert.equal(tv[24 + 2], T.TRIMV[24 + 2]);
  for (let f = 0; f < 12; f++) assert.equal(tv[36 + f], T.TRIMV[36 + f]);
  m.trim(null);
  assert.ok([...tv].every((x, i) => x === T.TRIMV[i]));
  assert.deepEqual(bad, []);
});

test('a memory key pressed mid-ring glides its six in over the 5 ms knob glide: no step > −40 dB of the hit\'s peak', () => {
  const D = D48(), bad = [];
  for (let c = 0; c < 5; c++) {
    const m = machine(D, { drum: { [kid(c, 'd')]: 0.8 } }), os = 4;
    const r = render(m, { sec: 0.25, hits: [[0, SID[c], 110], [4800, mm => { mm.d[kid(c, 'p')] = 3; }]] });
    // the 2nd difference at the OS rate (a step's signature) after the switch vs its level in the ring before it
    const d2 = (a, b) => { let x = 0; for (let i = a + 2; i < b; i++) x = Math.max(x, Math.abs(r.y[i] - 2 * r.y[i - 1] + r.y[i - 2])); return x; };
    const s = 4800 * os, before = d2(s - 960 * os, s), after = d2(s, s + 480 * os), pk = absMax(r.y);
    if (!(after <= before + 0.01 * pk)) bad.push(`${NAME[c]}: ${after.toExponential(2)} after the switch vs ${before.toExponential(2)} before (peak ${pk.toFixed(3)})`);
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- the machine's contracts */
const GROOVE = (() => {                                      // §12.7's dvp at 120 BPM: a sixteenth = 6000 frames
  const h = [];
  for (let k = 0; k < 48; k++) {
    const b = k % 16, F = k * 6000;
    if (b % 4 === 0) h.push([F, 0, 100]);
    if (b === 4 || b === 12) h.push([F, 1, 110]);
    if (b === 12) h.push([F, 2, 70]); if (b === 13) h.push([F, 2, 90]); if (b === 14) h.push([F, 3, 110]); if (b === 15) h.push([F, 4, 127]);
  }
  return h;
})();
test('retrigger continues the state (≠ a fresh hit, ≠ reset then hit); the hits\' order in a chunk free; trig(mask) = lanes 1–5 at v 100; ids 5–15 nothing', () => {
  const D = D48();
  for (let c = 0; c < 5; c++) {
    const two = render(machine(D), { sec: 0.4, hits: [[0, SID[c], 100], [2400, SID[c], 100]] }).y;
    const one = render(machine(D), { sec: 0.4, hits: [[2400, SID[c], 100]] }).y;
    const rs = render(machine(D), { sec: 0.4, hits: [[0, SID[c], 100], [2400, mm => mm.reset()], [2400, SID[c], 100]] }).y;
    const s = 2400 * 4;
    assert.ok(!same(two.subarray(s), one.subarray(s)) && same(rs.subarray(s), one.subarray(s)), NAME[c]);
  }
  const at = (list, v) => list.map(s => [4800, s, v]);
  assert.ok(same(render(machine(D), { sec: 0.5, hits: at([0, 1, 2, 3, 4], 100) }).y, render(machine(D), { sec: 0.5, hits: at([4, 3, 2, 1, 0], 100) }).y), 'two orders');
  assert.ok(same(render(machine(D), { sec: 0.5, hits: [[4800, m => m.trig(0x3f)]] }).y, render(machine(D), { sec: 0.5, hits: at([0, 1, 2, 3, 4], 100) }).y), 'a step mask = its hits at v 100');
  const m = machine(D);
  for (const s of [5, 6, 10, 15, 16, -1, NaN]) m.hit(s, 127);
  m.hit(0, 0); m.trig(1 << 6 | 1 << 11);
  assert.equal(m.live(), false, 'nothing latched');
});

test('no NaN / Inf, no subnormal on the bus or in an asleep machine\'s states (every knob at 0 and at 10, every memory, OS 4 and 1); everything asleep at the end', () => {
  const D = D48(), D44 = lib(44100).D, bad = [];
  // every knob at 0 and at 10; and two that ring (every knob at 10 but the balances at 5; at 0 but LEVEL and SENSITIVITY at 10)
  const ring = (kn, f) => (kn === 2 ? (f === 'm' || f === 'c' ? 0.5 : 1) : kn === 3 ? (f === 'l' || f === 's' ? 1 : 0) : kn);
  for (const kn of [0, 1, 2, 3]) for (const mem of [0, 1, 2, 3]) for (const [DD, sr, os] of [[D, 48000, 4], [D44, 44100, 1]]) {
    if (mem !== 1 && (os === 1 || kn !== 2)) continue;   // (the knobs act on memory 2; the others once, ringing, at OS 4)
    const drum = Object.fromEntries([...DD.mach.sdsv.KNOB_IDS].map(k => [k, ring(kn, k[2])]));
    for (const k of DD.mach.sdsv.SW_IDS) drum[k] = mem;
    const m = machine(DD, { sr, os, drum }), hits = [];
    for (let c = 0; c < 5; c++) { hits.push([c * 960, SID[c], 127], [c * 960 + 480, SID[c], 60], [c * 960 + 720, SID[c], 1]); }
    const { y } = render(m, { sr, os, sec: kn === 2 ? 11.5 : 6, hits });
    for (let i = 0; i < y.length; i++) { const v = y[i]; if (!Number.isFinite(v) || (v !== 0 && Math.abs(v) < 2.3e-308)) { bad.push(`knobs ${kn} memory ${mem + 1} OS ${os}: ${v} at ${i}`); break; } }
    for (const [k, v] of Object.entries(m._v)) {
      if (v.on) bad.push(`knobs ${kn} memory ${mem + 1} OS ${os}: ${k} still awake`);
      for (const o of [v, v.flt]) for (const [f, x] of Object.entries(o)) if (typeof x === 'number' && (!Number.isFinite(x) || (x !== 0 && Math.abs(x) < 2.3e-308))) bad.push(`${k}.${f} = ${x}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('determinism and span invariance: the same hits → identical bytes; spans of 4, 128 and random multiples of 4 frames (the noise, its wakes, the pitch and cutoff per chunk, a memory switch and a knob glide included); OS 1 at 44.1 kHz', () => {
  const D = D48(), hits = GROOVE.slice(0, 40).concat([[30000, m => { m.d.xsp = 2; m.d.x1t = 0.9; }]]).sort((a, b) => a[0] - b[0]);
  const a = render(machine(D), { sec: 3, hits, post: true }), b = render(machine(D), { sec: 3, hits, post: true });
  assert.ok(same(a.y, b.y) && same(a.L, b.L), 'determinism');
  assert.ok(absMax(a.L) > 0.1, 'the groove sounds');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return 4 * (1 + (seed >>> 16) % 32); };
  for (const [name, span] of [['4', () => 4], ['random', rnd]]) assert.ok(same(a.y, render(machine(D), { sec: 3, hits, span }).y), `spans ${name}`);
  const D44 = lib(44100).D;
  const c = render(machine(D44, { sr: 44100, os: 1 }), { sr: 44100, os: 1, sec: 2, hits }), d = render(machine(D44, { sr: 44100, os: 1 }), { sr: 44100, os: 1, sec: 2, hits, span: () => 4 });
  assert.ok(same(c.y, d.y), 'OS 1');
  // a salt moves the noise, not the tone
  const m2 = machine(D); m2.setSalt(12345);
  const e = render(m2, { sec: 0.3, hits: [[0, 1, 100]] }).y, f = render(machine(D), { sec: 0.3, hits: [[0, 1, 100]] }).y;
  assert.ok(!same(e, f), 'the salt');
});

test('no allocation over 200 spans: hits, knob glides, memory switches, trim(), the noise\'s wakes, the sample slots\' look', () => {
  const { sc, D } = lib(48000), m = machine(D), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128);
  const T = D.proto.sdsv, tr = Array.from({ length: 5 }, (_, c) => [0, 1].map(j => Array.from({ length: 6 }, (_, f) => T.TRIMV[12 * c + 6 * j + f])));
  m.smp(Array.from({ length: 16 }, (_, i) => (i === 3 ? { id: 'smp:none', on: true } : null)));
  noAlloc(sc, () => {
    for (let k = 0; k < 200; k++) {
      if (k % 7 === 0) m.trig(0x3e);
      if (k % 11 === 3) m.hit(k % 5, 20 + k % 107);
      if (k % 50 === 25) { m.d.xbt = (m.d.xbt + 0.3) % 1; m.d.x2p = (m.d.x2p + 1) % 4; m.d.x1n = (m.d.x1n + 0.2) % 1; }
      if (k % 60 === 30) { tr[1][0][2] = (k % 120) / 120; m.trim(tr); }
      buf.fill(0); m.render(buf, 512, k * 128);
      for (let i = 0; i < 128; i++) mono[i] = buf[i * 4];
      m.post(L, R, mono, 128);
      m.live(); m.mon();
    }
  });
});

test('idle and sleep: an asleep SDS-V runs no card code; each card sleeps (1e-5 V); mon() — lit by sound id, act in slots 0–4', () => {
  const D = D48(), m = machine(D), rep = [];
  for (let c = 0; c < 5; c++) {
    const t = [100, 127].map(v => { const mm = machine(D, { drum: { [kid(c, 's')]: 1 } }); mm.hit(SID[c], v); const b = new Float64Array(512); for (let F = 0; F < 48000 * 6; F += 128) { b.fill(0); mm.render(b, 512, F); if (!mm._cards[c].on) return F / 48000; } return Infinity; });
    rep.push(`${NAME[c]} ${(t[0] * 1e3).toFixed(0)} / ${(t[1] * 1e3).toFixed(0)}`);
    assert.ok(t[1] < 4, `${NAME[c]} sleeps`);
  }
  console.log('# time to sleep after one hit (ms, v 100 / 127 at SENS 10):', rep.join(', '));
  m.hit(0, 100); m.hit(2, 100); m.hit(4, 127);
  const b = new Float64Array(512);
  m.render(b, 512, 0);
  const mo = m.mon();
  assert.equal(mo.lit, 1 | 4 | 16, 'lit: the sounds hit');
  assert.ok(mo.act[0] > 0 && mo.act[2] > 0 && mo.act[4] > 0 && mo.act[1] === 0 && mo.act[3] === 0 && mo.act[5] === 0, `act ${[...mo.act].map(x => x.toFixed(3))}`);
  render(m, { sec: 4, post: true });
  assert.equal(m.live(), false, 'everything asleep, the output settled');
  const c0 = m._M.count;
  render(m, { sec: 1 });
  assert.equal(m._M.count, c0, 'no card ran');
  assert.ok(Object.values(m._v).every(v => v.thr === 1e-5), 'the thresholds');
});

/* ---------------------------------------------------------------- your own sounds (§12.5) */
test('sample slots (§12.5): a slot plays instead of its card — its LEVEL (audio taper), V_D as gain (7a\'s law: the knee at v 100, SENS 5), TONE ± 1 octave at its centre, DECAY a fade only below 5; below the threshold nothing', () => {
  const { sc, D } = lib(48000), T = D.proto.sdsv;
  const len = 9600, Lx = new Float32Array(len); for (let i = 0; i < len; i++) Lx[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
  sc.ctx.SxBase = { getAsset: id => (id === 'smp:test' ? { kind: 'smp', rate: 48000, ch: 1, len, root: 60, peak: 1, levels: [{ len, L: Lx, R: Lx }] } : null) };
  try {
    const slots = s => Array.from({ length: 16 }, (_, i) => (i === s ? { id: 'smp:test', on: true } : null));
    const one = (c, drum = {}, v = 100) => { const m = machine(D, { drum }); m.smp(slots(SID[c])); return { r: render(m, { sec: 0.2, hits: [[0, SID[c], v]], post: true }), m }; };
    const z = a => { let n = 0; for (let i = 1; i < 4800; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };
    const tapA = k => (10 ** (2 * k) - 1) / 99;
    for (let c = 0; c < 5; c++) {
      const a = one(c, { [kid(c, 't')]: 0.5, [kid(c, 'd')]: 0.5 });   // (TONE and DECAY at their neutral 5)
      assert.equal(a.m._cards[c].on, false, `${NAME[c]}: the card stays asleep`);
      const want = T.SMP_LEVELV * tapA(0.7) * T.OUT_KV, got = absMax(a.r.L.subarray(2400, 4800));
      assert.ok(near(got, want, 0.02), `${NAME[c]}: the sample's level ${got} vs ${want}`);
      const hard = one(c, { [kid(c, 's')]: 1, [kid(c, 't')]: 0.5, [kid(c, 'd')]: 0.5 }, 127), g = 1 + 0.6 * (T.vD(0.075, 1) - T.VK_V) / (T.VL - T.VK_V);
      assert.ok(near(absMax(hard.r.L.subarray(2400, 4800)) / got, g, 0.02), `${NAME[c]}: the hard hit's gain`);
      const soft = one(c, { [kid(c, 't')]: 0.5, [kid(c, 'd')]: 0.5 }, 40), gs = T.vD(T.padVolts(40), 0.5) / T.VK_V;
      assert.ok(near(absMax(soft.r.L.subarray(2400, 4800)) / got, gs, 0.02), `${NAME[c]}: proportional below the knee`);
      const t0 = one(c, { [kid(c, 't')]: 0.5, [kid(c, 'd')]: 0.5 }), t1 = one(c, { [kid(c, 't')]: 1, [kid(c, 'd')]: 0.5 });
      assert.ok(Math.abs(z(t0.r.L) - 2 * 440 * 0.1) <= 2 && Math.abs(z(t1.r.L) / z(t0.r.L) - 2) < 0.05, `${NAME[c]}: TONE 5 its pitch, 10 an octave up`);
      assert.ok(same(one(c, { [kid(c, 'd')]: 0.5 }).r.L, one(c, { [kid(c, 'd')]: 1 }).r.L), `${NAME[c]}: DECAY 5 = 10`);
      const d0 = one(c, { [kid(c, 'd')]: 0 });
      assert.ok(absMax(d0.r.L.subarray(48 * 40, 48 * 60)) < 0.01 * absMax(d0.r.L.subarray(0, 480)), `${NAME[c]}: DECAY 0, a 30 ms fade`);
      const none = one(c, { [kid(c, 's')]: 0 }, 20);
      assert.equal(absMax(none.r.L), 0, `${NAME[c]}: a hit under the threshold plays nothing`);
    }
  } finally { delete sc.ctx.SxBase; }
});

/* ---------------------------------------------------------------- §12.4 level, CPU */
test('§12.4 level: the bass\'s memory 1 at v 100, SENS 5, LEVEL 7 peaks at the 808\'s default BD within ± 1 dB (band-limited decimation, the output stage); the dvp groove\'s RMS within ± 1 dB of the 808\'s default groove, its peak under the track limiter\'s −1 dBFS (the gate through the Track: engine-track, E5)', () => {
  const D = D48(), S16 = 6000;
  const rms = y => { let a = 0; for (let i = 0; i < y.length; i++) a += y[i] * y[i]; return Math.sqrt(a / y.length); };
  const m8 = () => { const m = D.create({ base: 48000, OS: 4, seedSalt: 0 }, 'tr808'); m.set(Object.assign(Object.fromEntries(D.KNOB_IDS.map((k, i) => [k, D.KNOB_DEF[i]])), { lts: 0, mts: 0, hts: 0, rss: 0, cps: 0 })); return m; };
  const g8 = []; for (let k = 0; k < 48; k++) { if (k % 4 === 0) g8.push([k * S16, 0, 100]); if (k % 16 === 4 || k % 16 === 12) g8.push([k * S16, 1, 100], [k * S16, 6, 100]); if (k % 2 === 0) g8.push([k * S16, 10, 100]); }
  const bV = absMax(out(machine(D), [[0, 0, 100]], 1)), b8 = absMax(out(m8(), [[0, 0, 100]], 1));
  const yV = out(machine(D), GROOVE, 6), y8 = out(m8(), g8, 6);
  const pk = [0, 1, 2, 3, 4].map(c => `${NAME[c]} ${absMax(out(machine(D), [[0, SID[c], 100]], 1.5)).toFixed(3)}`);
  console.log(`# level: the bass ${bV.toFixed(4)} vs the 808's BD ${b8.toFixed(4)} (${dB(bV / b8).toFixed(2)} dB); the dvp groove's RMS ${dB(rms(yV) / rms(y8)).toFixed(2)} dB re the 808's default groove, peaks ${absMax(yV).toFixed(3)} / ${absMax(y8).toFixed(3)}; each card alone (FS, v 100): ${pk.join(', ')}`);
  assert.ok(Math.abs(dB(bV / b8)) <= 1, `the anchor ${dB(bV / b8)}`);
  assert.ok(Math.abs(dB(rms(yV) / rms(y8))) <= 1 && absMax(yV) < 10 ** (-1 / 20), 'the groove');
});

test('CPU per card (reported; each ≤ 0.004 at OS 4 — the gate here 0.008 against a loaded machine) and the dvp / dvx patterns, the machine alone (node, OS 4, 48 kHz), within §12.7\'s rows; a silent powered machine ≤ 0.0005', () => {
  const D = lib(48000, SRC, 'cpu').D, rep = [];             // (a scope of its own: the others' taps reshape the cards' fields)
  const load = (hits, sec, drum, every) => {
    const m = machine(D, { drum }), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128);
    let F = 0, nx = 0, k = 0;
    const t0 = performance.now();
    while (F < sec * 48000) {
      if (every && F >= nx) { hits(m, k++); nx += every * 48000; }
      buf.fill(0); m.render(buf, 512, F);
      for (let i = 0; i < 128; i++) mono[i] = buf[i * 4];
      m.post(L, R, mono, 128); F += 128;
    }
    return (performance.now() - t0) / 1000 / sec;
  };
  const best = f => Math.min(f(), f(), f());
  const per = [];
  for (let c = 0; c < 5; c++) { load(m => m.hit(SID[c], 127), 0.3, {}, 0.1); const t = best(() => load(m => m.hit(SID[c], 127), 1.5, {}, 0.1)); per.push(t); rep.push(`${NAME[c]} ${t.toFixed(4)}`); }
  const groove = sec => { const ev = []; for (let r = 0; r * 2 < sec; r++) for (const [F, s, v] of GROOVE.slice(0, GROOVE.findIndex(e => e[0] >= 96000))) ev.push([F + r * 96000, s, v]); return ev; };   // (a bar: 2 s)
  const pat = sec => {
    const m = machine(D), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128), ev = groove(sec);
    let e = 0; const t0 = performance.now();
    for (let F = 0; F < sec * 48000; F += 128) {
      while (e < ev.length && ev[e][0] < F + 128) { m.hit(ev[e][1], ev[e][2]); e++; }
      buf.fill(0); m.render(buf, 512, F); for (let i = 0; i < 128; i++) mono[i] = buf[i * 4]; m.post(L, R, mono, 128);
    }
    return (performance.now() - t0) / 1000 / sec;
  };
  const DEC = Object.fromEntries(CH.flatMap(c => [['x' + c + 'd', 1], ['x' + c + 's', 1]]));
  const Rw = { dvp: best(() => pat(4)), dvx: best(() => load(m => { for (const s of SID) m.hit(s, 127); }, 3, DEC, 0.125)), idle: best(() => load(() => {}, 2, {}, 0)) };
  console.log('# CPU (s per s; a card retriggered every 100 ms at v 127; the patterns: the machine alone):', rep.join(', '), '|', Object.entries(Rw).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', '));
  assert.ok(per.every(t => t <= 0.008), JSON.stringify(per));
  assert.ok(Rw.dvp <= 0.03 && Rw.dvx <= 0.05 && Rw.idle <= 0.0005, JSON.stringify(Rw));
});
/* END */
