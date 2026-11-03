// Our drum machine's voices (stage DM lane V; IMPL-DM §2, §9.2, G2 / G3): kit-dsp.js's DrKit alone through the dsp-scope harness
// — every law of §2.2 measured against kit-core's KIT.TYPES (the one source: DrKit.TYPES is its copy, compared here) at 48 kHz ×
// OS 1 / 2 / 4 and 44.1 kHz × 1: the pitches (zero crossings: the end value after 10 τ within 1 %, the first period within 5 % of
// the law's own integral; the Snare's two modes and the Perc's two resonances by their spectral peaks, 1 % / 2 %), the decays
// (a log-envelope fit between −10 and −40 dB within 5 %: the bodies on their period peaks, the noise paths on a 16-salt mean
// square), the noise paths' corners (a Welch spectrum of the held noise against its prototype: the Snare COLOR and the Clap TONE
// at their law, the Hi-hat's summed pair at its prototype's −3 dB point, within 10 %), the Clap's bursts (their maxima at
// i·s + the 0.2 ms rise, ± 0.1 ms), the band-limiting (48 kHz × 1, held: the energy off the squares' / the driven sine's
// harmonics against the energy on them), brightness by velocity; and the machine (§9.2): the interface, the hat ratios against
// every oscillator table of dr-808.js (D7), steps ≡ hits, chokes, retriggers, click bounds, span / sleep / idle-skip invariance,
// denormals, hostile values, mon, _v, smp, setSalt, an OS change while ringing, no allocation; the cost per sounding instance
// (§2.3: informational, reported). Levels, DC and loudness through the whole Track: tests/engine-track.test.mjs.
// Run: node --max-old-space-size=2048 --test tests/kit-dsp.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';
import { KIT, lawVal } from '../kit-core.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = source('kit-dsp.js');
const LIBS = new Map();
function lib(sr = 48000) {
  if (!LIBS.has(sr)) { const sc = dspScope({ files: [], fast: true, sampleRate: sr }); sc.run(SRC, 'kit-dsp.js'); LIBS.set(sr, { sc, K: sc.global('DrKit') }); }
  return LIBS.get(sr);
}
const K48 = () => lib(48000).K;
const RATES = [[48000, 1], [48000, 2], [48000, 4], [44100, 1]];
const T = KIT.TYPES, NAMES = ['', 'Kick', 'Snare', 'Hi-hat', 'Clap', 'Tom', 'Perc'];
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const pct = (a, b) => ((a / b - 1) * 100).toFixed(2) + ' %';
const absMax = (a, i0 = 0, i1 = a.length) => { let m = 0; for (let i = i0; i < i1; i++) { const x = a[i] < 0 ? -a[i] : a[i]; if (x > m) m = x; } return m; };
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/* ---------------------------------------------------------------- the panel */
// a voice: { t, u, d, l, c, k: [4] } in knob positions (TYPE / CHOKE as values); def(t, o) a type at its defaults with o over it
const def = (t, o = {}) => ({ t, u: o.u ?? T[t].u.def, d: o.d ?? T[t].d.def, l: o.l ?? 0.7, c: o.c ?? 0, k: T[t].k.map((q, i) => (o.k && o.k[i] != null ? o.k[i] : q.def)) });
// the engine's KitP shape ({ v: Float64Array(144) in KIT.IDS order }) of up to 16 voices (null: an empty slot)
function kitP(list) {
  const v = new Float64Array(KIT.IDS.length);
  for (let j = 0; j < 16; j++) {
    const e = list[j], o = 9 * j;
    v[o] = e ? e.t : 0; v[o + 1] = e ? e.u : 0.5; v[o + 2] = e ? e.d : 0.5; v[o + 3] = e ? e.l : 0.7; v[o + 4] = e ? e.c : 0;
    for (let i = 0; i < 4; i++) v[o + 5 + i] = e ? e.k[i] : 0.5;
  }
  return { v };
}
// the same as a plain object keyed by the control ids (models.js map's shape)
const plain = P => Object.fromEntries(KIT.IDS.map((id, i) => [id, P.v[i]]));
const STARTER = () => KIT.STARTER.map(e => ({ t: e.t, u: e.u, d: e.d, l: e.l, c: e.c, k: e.k.slice() }));

function machine({ sr = 48000, os = 4, list = [], drum = null, opt, K = lib(sr).K, salt = 0 } = {}) {
  const m = K.create({ base: sr, OS: os, seedSalt: salt }, 'kit', opt);
  m.d = drum || kitP(list); m.set(m.d);
  return m;
}
// renders a machine: hits [[frame, slot, v127] | [frame, fn(m)]] (frames multiples of 4), spans span(F) frames cut at the hits
// as the engine cuts them; skip(F) true: an idle skip (the engine renders nothing while the machine is not live) → the bus
function render(m, { sr = 48000, os = 4, sec = 1, hits = [], span = () => 128, skip = null } = {}) {
  const N = Math.round(sec * sr / 4) * 4, y = new Float64Array(N * os), buf = new Float64Array(128 * os);
  let h = 0, F = 0;
  while (F < N) {
    while (h < hits.length && hits[h][0] <= F) { const e = hits[h++]; if (typeof e[1] === 'function') e[1](m); else m.hit(e[1], e[2]); }
    let n = Math.min(128, span(F), N - F);
    if (h < hits.length) n = Math.min(n, hits[h][0] - F);
    n = Math.max(4, n - (n % 4));
    if (skip && skip(F) && !m.live()) { m.poll(F); F += n; continue; }
    buf.fill(0, 0, n * os);
    m.render(buf, n * os, F);
    y.set(buf.subarray(0, n * os), F * os);
    F += n;
  }
  return { y, fs: sr * os };
}
const one = (t, o, { v = 100, sr = 48000, os = 4, sec = 1, opt, salt = 0 } = {}) => render(machine({ sr, os, list: [def(t, o)], opt, salt }), { sr, os, sec, hits: [[0, 0, v]] });

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
// a 4-term Blackman–Harris window (sidelobes −92 dB): the band-limiting gate's lines stay inside ± 6 bins
const bh = (i, n) => { const x = 2 * Math.PI * i / (n - 1); return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x); };
// the power spectrum of y[i0, i0 + n) (n a power of two) under window w
function power(y, i0, n, w = (i, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (y[i0 + i] || 0) * w(i, n);
  fft(re, im);
  const p = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}
// Welch: the mean of half-overlapped Hann segments of n
function welch(y, i0, i1, n) {
  const acc = new Float64Array(n / 2);
  let k = 0;
  for (let a = i0; a + n <= i1; a += n / 2, k++) { const p = power(y, a, n); for (let i = 0; i < n / 2; i++) acc[i] += p[i]; }
  for (let i = 0; i < n / 2; i++) acc[i] /= k;
  return acc;
}
// the strongest peak of p in [f0, f1] Hz, parabolically interpolated → Hz
function peakHz(p, fs, n, f0, f1) {
  let b = -1, m = -1;
  for (let i = Math.max(1, Math.floor(f0 * n / fs)); i <= Math.min(p.length - 2, Math.ceil(f1 * n / fs)); i++) if (p[i] > m) { m = p[i]; b = i; }
  const a = Math.log(p[b - 1] + 1e-300), c = Math.log(p[b] + 1e-300), d = Math.log(p[b + 1] + 1e-300), q = 0.5 * (a - d) / (a - 2 * c + d);
  return (b + q) * fs / n;
}
// upward zero crossings (linearly interpolated, seconds) of y after sample i0
function ups(y, fs, i0 = 1, i1 = y.length) {
  const t = [];
  for (let i = Math.max(1, i0); i < i1; i++) if (y[i - 1] < 0 && y[i] >= 0) t.push((i - 1 + -y[i - 1] / (y[i] - y[i - 1])) / fs);
  return t;
}
// the mean frequency over ≥ 3 periods from time t0
function freqAt(y, fs, t0, periods = 6) {
  const z = ups(y, fs, Math.round(t0 * fs));
  const k = Math.min(periods, z.length - 1);
  assert.ok(k >= 3, 'three periods to measure');
  return k / (z[k] - z[0]);
}
// the first period of a sine that starts at rest (phase 0 at t = 0): the first upward crossing after its negative half
function firstPeriod(y, fs) {
  let i = 1;
  while (i < y.length && !(y[i] < 0)) i++;
  const z = ups(y, fs, i);
  return z[0];
}
// the law's first period: the T where ∫0^T f(t) dt = 1 (f(t) the law's instantaneous frequency, integrated finely)
function lawPeriod(f) { let ph = 0, t = 0; const dt = 1e-7; while (ph < 1) { ph += f(t + dt / 2) * dt; t += dt; } return t; }
// T60 of a log envelope fitted between −10 and −40 dB below its maximum: env [t, value] pairs
function t60(env) {
  let mx = 0, im = 0;
  env.forEach(([, v], i) => { if (v > mx) { mx = v; im = i; } });
  const pts = env.slice(im).filter(([, v]) => v > 0 && v <= mx * Math.pow(10, -10 / 20) && v >= mx * Math.pow(10, -40 / 20)).map(([t, v]) => [t, 20 * Math.log10(v)]);
  assert.ok(pts.length >= 8, 'points to fit: ' + pts.length);
  const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  return -60 / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
}
// a body's envelope: the peak of each window of w s
const peakEnv = (y, fs, w) => { const n = Math.max(1, Math.round(w * fs)), e = []; for (let i = 0; i + n <= y.length; i += n) e.push([(i + n / 2) / fs, absMax(y, i, i + n)]); return e; };
// a noise path's envelope: the RMS of 2 ms windows of the mean square over renders
function msEnv(ys, fs, w = 0.002) {
  const n = Math.round(w * fs), e = [];
  for (let i = 0; i + n <= ys[0].length; i += n) { let s = 0; for (const y of ys) for (let j = i; j < i + n; j++) s += y[j] * y[j]; e.push([(i + n / 2) / fs, Math.sqrt(s / (n * ys.length))]); }
  return e;
}
const salts = (k, f) => Array.from({ length: k }, (_, i) => f(0x51ED + 977 * i));

// analog prototypes evaluated at the bilinear's warped frequency (a TPT filter prewarped at its own corner fc): |H(f)|
const warp = (f, fc, fs) => fc * Math.tan(Math.PI * f / fs) / Math.tan(Math.PI * fc / fs);
const cx = (re, im) => ({ re, im });
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const hp2 = (f, fc, fs) => { const w = warp(f, fc, fs) / fc; return cdiv(cx(-w * w, 0), cx(1 - w * w, Math.SQRT2 * w)); };
const bp2 = (f, fc, q, fs) => { const w = warp(f, fc, fs) / fc; return cdiv(cx(0, w / q), cx(1 - w * w, w / q)); };
const lp1 = (f, fc, fs) => { const w = warp(f, fc, fs) / fc; return cdiv(cx(1, 0), cx(1, w)); };
const mag2 = z => z.re * z.re + z.im * z.im;
// a measured noise path's −3 dB point: the PSD over its prototype's shape far from the corner sets the plateau P0; the response
// R(f) = the PSD's mean over a bw-octave band at f (1/12; a 1-pole's shallow corner 1/4), over P0, walked from the plateau toward
// the corner in 1/96-octave steps ('hp': down, 'lp': up) to its first crossing of ½, interpolated in log f
function corner(p, fs, n, proto, band, side, bw = 1 / 12) {
  let s = 0, k = 0;
  for (let i = Math.ceil(band[0] * n / fs); i <= Math.floor(band[1] * n / fs); i++) { s += p[i] / proto(i * fs / n); k++; }
  const P0 = s / k, R = f => { let a = 0, c = 0; for (let i = Math.max(1, Math.round(f * Math.pow(2, -bw / 2) * n / fs)); i <= Math.min(p.length - 1, Math.round(f * Math.pow(2, bw / 2) * n / fs)); i++) { a += p[i]; c++; } return a / c / P0; };
  const st = Math.pow(2, side === 'hp' ? -1 / 96 : 1 / 96);
  let f = side === 'hp' ? band[0] : band[1], r = R(f);
  for (let i = 0; i < 960; i++) {
    const g = f * st, q = R(g);
    if (q < 0.5) return Math.exp(Math.log(f) + (Math.log(g) - Math.log(f)) * (r - 0.5) / (r - q));
    f = g; r = q;
  }
  return NaN;
}

/* ================================================================ the interface, the copies, D7 */
test('§9.2: DrKit is frozen with VER, create, gain, TYPES, LAW, CHOKE_MS; create(…, \'kit\') builds the family\'s machine interface; another kind → null', () => {
  const K = K48();
  assert.ok(K && Object.isFrozen(K) && K.VER >= 1, 'a frozen global');
  for (const f of ['create', 'gain']) assert.equal(typeof K[f], 'function', f);
  assert.equal(K.gain(), 1, 'no output stage of its own: a tail crossing an 808 ↔ kit switch keeps its level');
  assert.equal(K.create({ base: 48000, OS: 4 }, 'tr808'), null);
  const m = machine();
  for (const f of ['set', 'setOS', 'hit', 'trig', 'render', 'post', 'poll', 'live', 'reset', 'mon', 'smp', 'setSalt']) assert.equal(typeof m[f], 'function', f);
  assert.ok(Array.isArray(m._v) && m._v.length === 32 && m._v.every(v => v.on === false), '_v: two instances a slot, each with .on (the engine\'s CPU count)');
  const mo = m.mon();
  assert.ok(typeof mo.lit === 'number' && Object.prototype.toString.call(mo.act) === '[object Float32Array]' && mo.act.length === 16, 'mon → { lit: 16 bits, act: Float32Array(16) }');
});

test('the one source of a law: DrKit.TYPES / LAW / CHOKE_MS are kit-core\'s KIT.TYPES / LAW / CHOKE_MS byte for byte; DrKit.lawVal = kit-core lawVal', () => {
  const K = K48();
  assert.equal(JSON.stringify(K.TYPES), JSON.stringify(KIT.TYPES), 'TYPES');
  assert.equal(JSON.stringify(K.LAW), JSON.stringify(KIT.LAW), 'LAW');
  assert.equal(K.CHOKE_MS, KIT.CHOKE_MS);
  const bad = [];
  for (const t of T.slice(1)) for (const L of [t.u, t.d, ...t.k]) for (const x of [0, 0.123, 0.5, 0.77, 1, -1, 2, NaN, Infinity]) if (!Object.is(K.lawVal(L, x), lawVal(L, x))) bad.push(`${t.id}.${L.id}(${x})`);
  assert.deepEqual(bad, []);
});

test('D7: the Hi-hat\'s ratio set is ours — it differs from every oscillator table of dr-808.js (the 808\'s and the 606\'s metal banks) by > 2 % in some ratio', () => {
  const sc = dspScope({ files: [], fast: true }); sc.run(source('dr-808.js'), 'dr-808.js');
  const P = sc.global('Dr808').proto, tabs = [P.MT.F, P.tr606.MT6.F];
  const ours = T[3].blk.ratios, norm = a => { const s = a.slice().sort((x, y) => x - y); return s.map(x => x / s[0]); };
  for (const F of tabs) {
    const r = norm(F), d = Math.max(...ours.map((x, i) => Math.abs(x / r[i] - 1)));
    assert.ok(d > 0.02, `the ratios ${r.map(x => x.toFixed(4)).join(' ')} vs ours: max ${(100 * d).toFixed(1)} %`);
  }
  assert.equal(ours.length, 6);
});

/* ================================================================ G2: the laws */
test('G2 Kick: the swept sine — the end pitch after 10 τ within 1 % of TUNE, the first period within 5 % of the law\'s, T60 within 5 % of DECAY — every rate', (t) => {
  const bad = [], rep = [];
  for (const [sr, os] of RATES) for (const o of [{}, { u: 0, d: 1, k: [1, 0] }, { u: 1, d: 0.6, k: [0.25, 0.8] }]) {
    const p = def(1, Object.assign({}, o, { k: [o.k ? o.k[0] : T[1].k[0].def, o.k ? o.k[1] : T[1].k[1].def, 0, 0] }));
    const f = lawVal(T[1].u, p.u), T60 = lawVal(T[1].d, p.d), r = lawVal(T[1].k[0], p.k[0]), tau = lawVal(T[1].k[1], p.k[1]);
    const { y, fs } = one(1, p, { sr, os, sec: Math.max(10 * tau + 0.2, 0.75 * T60 + 0.05) });
    const fe = freqAt(y, fs, 10 * tau), T1 = firstPeriod(y, fs), L1 = lawPeriod(x => f * (1 + (r - 1) * Math.exp(-x / tau)));
    const e = t60(peakEnv(y, fs, Math.max(0.002, 1.2 / f)));
    rep.push(`${sr / 1000}k×${os} f ${f.toFixed(1)}: end ${pct(fe, f)}, 1st period ${pct(T1, L1)}, T60 ${pct(e, T60)}`);
    if (!near(fe, f, 0.01)) bad.push(`${sr}×${os} ${JSON.stringify(o)}: end pitch ${fe} vs ${f}`);
    if (!near(T1, L1, 0.05)) bad.push(`${sr}×${os} ${JSON.stringify(o)}: first period ${T1} vs ${L1}`);
    if (!near(e, T60, 0.05)) bad.push(`${sr}×${os} ${JSON.stringify(o)}: T60 ${e} vs ${T60}`);
  }
  t.diagnostic(rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('G2 Tom: the bending sine — the end pitch within 1 % of TUNE, the first period within 5 % of f·2^(b/12)\'s law, T60 within 5 % — every rate', (t) => {
  const bad = [], rep = [];
  for (const [sr, os] of RATES) for (const o of [{}, { u: 0, d: 0.8, k: [1, 0.2] }, { u: 1, d: 0.8, k: [0.5, 0.7] }]) {
    const p = def(5, Object.assign({}, o, { k: [o.k ? o.k[0] : T[5].k[0].def, o.k ? o.k[1] : T[5].k[1].def, 0, 0] }));
    const f = lawVal(T[5].u, p.u), T60 = lawVal(T[5].d, p.d), b = lawVal(T[5].k[0], p.k[0]), tau = lawVal(T[5].k[1], p.k[1]);
    const { y, fs } = one(5, p, { sr, os, sec: Math.max(10 * tau + 0.15, 0.75 * T60 + 0.05) });
    const fe = freqAt(y, fs, 10 * tau), T1 = firstPeriod(y, fs), L1 = lawPeriod(x => f * Math.pow(2, (b / 12) * Math.exp(-x / tau)));
    const e = t60(peakEnv(y, fs, Math.max(0.002, 1.2 / f)));
    rep.push(`${sr / 1000}k×${os} f ${f.toFixed(1)}: end ${pct(fe, f)}, 1st ${pct(T1, L1)}, T60 ${pct(e, T60)}`);
    if (!near(fe, f, 0.01)) bad.push(`${sr}×${os} ${JSON.stringify(o)}: end pitch ${fe} vs ${f}`);
    if (!near(T1, L1, 0.05)) bad.push(`${sr}×${os} ${JSON.stringify(o)}: first period ${T1} vs ${L1}`);
    if (!near(e, T60, 0.05)) bad.push(`${sr}×${os} ${JSON.stringify(o)}: T60 ${e} vs ${T60}`);
  }
  t.diagnostic(rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('G2 Snare: the two modes at f and 1.594·f within 1 % (after the 12 % drop), the body T60 within 5 %, the noise T60 (SNAP) within 5 %, COLOR\'s −3 dB within 10 % — every rate', (t) => {
  const bad = [], rep = [], B = T[2].blk;
  for (const [sr, os] of RATES) {
    for (const u of [0, 0.5, 1]) { // modes: body only (TONE 0), BODY 1, a long body
      const f = lawVal(T[2].u, u), { y, fs } = one(2, { u, d: 1, k: [0, 0.5, 0.45, 1] }, { sr, os, sec: 0.6 }), n = 8192 * os;
      const p = power(y, Math.round(0.1 * fs), n), f1 = peakHz(p, fs, n, 0.8 * f, 1.2 * f), f2 = peakHz(p, fs, n, 0.85 * B.ratio * f, 1.15 * B.ratio * f);
      rep.push(`${sr / 1000}k×${os} modes ${pct(f1, f)} / ${pct(f2, B.ratio * f)}`);
      if (!near(f1, f, 0.01) || !near(f2, B.ratio * f, 0.01)) bad.push(`${sr}×${os} u ${u}: modes ${f1} ${f2} vs ${f} ${B.ratio * f}`);
    }
    { // the body's T60: one mode (BODY 0), TONE 0
      const d = 0.4, T60 = lawVal(T[2].d, d), { y, fs } = one(2, { d, k: [0, 0.5, 0.45, 0] }, { sr, os, sec: 0.75 * T60 + 0.05 }), f = lawVal(T[2].u, 0.5);
      const e = t60(peakEnv(y, fs, 1.2 / f));
      rep.push(`body T60 ${pct(e, T60)}`);
      if (!near(e, T60, 0.05)) bad.push(`${sr}×${os}: body T60 ${e} vs ${T60}`);
    }
    { // the noise's T60: TONE 1 (noise only), 16 salts
      const s = 0.45, T60 = lawVal(T[2].k[2], s), ys = salts(16, z => one(2, { k: [1, 0.5, s, 0.5] }, { sr, os, sec: 0.75 * T60 + 0.05, salt: z }).y);
      const e = t60(msEnv(ys, sr * os));
      rep.push(`noise T60 ${pct(e, T60)}`);
      if (!near(e, T60, 0.05)) bad.push(`${sr}×${os}: noise T60 ${e} vs ${T60}`);
    }
    for (const c of [0, 0.5, 1]) { // COLOR: the held noise path's high-pass corner
      const fc = lawVal(T[2].k[1], c), fs = sr * os, { y } = one(2, { k: [1, c, 0.45, 0.5] }, { sr, os, sec: 4, opt: { hold: true } }), n = 4096 * os;
      const p = welch(y, Math.round(0.01 * fs), y.length, n), f3 = corner(p, fs, n, f => mag2(hp2(f, fc, fs)), [1.6 * fc, Math.min(3 * fc, 0.42 * sr)], 'hp');
      rep.push(`COLOR ${pct(f3, fc)}`);
      if (!near(f3, fc, 0.1)) bad.push(`${sr}×${os} COLOR ${c}: −3 dB at ${f3} vs ${fc}`);
    }
  }
  t.diagnostic(rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('G2 Hi-hat: T60 within 5 % (16 salts); the noise path\'s corner within 10 % of its prototype\'s (the high-pass at TONE + the band-pass at 1.5 × TONE, Q = RING) — every rate', (t) => {
  const bad = [], rep = [];
  for (const [sr, os] of RATES) {
    for (const d of [0.3, 0.8]) {
      const T60 = lawVal(T[3].d, d), ys = salts(16, z => one(3, { d }, { sr, os, sec: 0.75 * T60 + 0.03, salt: z }).y);
      const e = t60(msEnv(ys, sr * os, T60 < 0.1 ? 0.001 : 0.002));
      rep.push(`${sr / 1000}k×${os} T60 ${pct(e, T60)}`);
      if (!near(e, T60, 0.05)) bad.push(`${sr}×${os} d ${d}: T60 ${e} vs ${T60}`);
    }
    for (const [tn, rg] of [[0, 0.3], [0.5, 0.3], [0.5, 0], [0.9, 0.6]]) {
      const fc = lawVal(T[3].k[0], tn), q = lawVal(T[3].k[2], rg), fs = sr * os, fb = Math.min(1.5 * fc, 0.45 * fs);
      if (fb > 0.4 * sr) continue; // (the band-pass above the audio band at this rate: its corner is the prototype's beyond 0.4 fs)
      const proto = f => mag2((z => z)(((a, b) => cx(a.re + b.re, a.im + b.im))(hp2(f, fc, fs), bp2(f, fb, q, fs))));
      let f3p = NaN; for (let f = 0.2 * fc; f < 1.5 * fc; f += 0.5) if (proto(f) >= 0.5) { f3p = f; break; }
      const { y } = one(3, { k: [tn, 0, rg, 0.5] }, { sr, os, sec: 4, opt: { hold: true } }), n = 4096 * os;
      const p = welch(y, Math.round(0.01 * fs), y.length, n);
      // plateau: the PSD over the prototype well above both corners (or over 1.6–2.2 × TONE capped below 0.42 fs)
      const f3 = corner(p, fs, n, proto, [Math.min(1.7 * fc, 0.38 * sr), Math.min(2.4 * fc, 0.42 * sr)], 'hp');
      rep.push(`TONE ${tn} RING ${rg}: ${pct(f3, f3p)} (prototype ${f3p.toFixed(0)} Hz)`);
      if (!near(f3, f3p, 0.1)) bad.push(`${sr}×${os} TONE ${tn} RING ${rg}: −3 dB at ${f3} vs the prototype's ${f3p}`);
    }
  }
  t.diagnostic(rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('G2 Clap: n bursts with their maxima at i·s + 0.2 ms (± 0.1 ms), the tail T60 within 5 % (16 salts), TONE\'s low-pass −3 dB within 10 % — every rate', (t) => {
  const bad = [], rep = [], B = T[4].blk;
  for (const [sr, os] of RATES) {
    const fs = sr * os;
    for (const [sp, ct] of [[0.5, 0.5], [0, 1], [1, 0]]) {
      const s = lawVal(T[4].k[0], sp), n = lawVal(T[4].k[1], ct), N = Math.round(0.12 * fs);
      const m = machine({ sr, os, list: [def(4, { k: [sp, ct, 0.6, 0.6] })], opt: { trace: N } });
      render(m, { sr, os, sec: 0.12, hits: [[0, 0, 100]] });
      const tr = m._v[0].etr, mx = [];
      for (let i = 1; i < N - 1 && i < Math.round((n * s + 0.002) * fs); i++) if (tr[i] > tr[i - 1] && tr[i] >= tr[i + 1] && tr[i] > 0.5 * absMax(tr)) mx.push(i / fs);
      const want = Array.from({ length: n }, (_, i) => i * s + B.upS);
      rep.push(`${sr / 1000}k×${os} n ${n} s ${(1e3 * s).toFixed(1)} ms: maxima ${mx.map(x => (1e3 * x).toFixed(2)).join(' ')}`);
      if (mx.length !== n || mx.some((x, i) => Math.abs(x - want[i]) > 1e-4)) bad.push(`${sr}×${os} s ${s} n ${n}: maxima ${mx} vs ${want}`);
    }
    { // the tail: COUNT 2, a short spread, the tail at 1
      const d = 0.6, T60 = lawVal(T[4].d, d), ys = salts(16, z => one(4, { d, k: [0, 0, 0.6, 1] }, { sr, os, sec: 0.75 * T60 + 0.05, salt: z }).y);
      const e = t60(msEnv(ys, fs).filter(([x]) => x > 0.03));
      rep.push(`tail T60 ${pct(e, T60)}`);
      if (!near(e, T60, 0.05)) bad.push(`${sr}×${os}: tail T60 ${e} vs ${T60}`);
    }
    for (const tn of [0, 0.4, 0.6]) { // TONE: the held noise over its band-pass prototype — the low-pass corner
      const fc = lawVal(T[4].k[2], tn), fb = lawVal(T[4].u, 0.5), n = 4096 * os;
      if (fc > 0.4 * sr) continue;
      const { y } = one(4, { k: [0.5, 0.5, tn, 1] }, { sr, os, sec: 12, opt: { hold: true } }), p = welch(y, Math.round(0.02 * fs), y.length, n);
      // (the measured PSD over the band-pass alone: the low-pass's own −3 dB, read where the ratio halves)
      const r = new Float64Array(p.length); for (let i = 1; i < p.length; i++) r[i] = p[i] / mag2(bp2(i * fs / n, fb, B.q, fs));
      const g = corner(r, fs, n, f => mag2(lp1(f, fc, fs)), [0.25 * fc, 0.5 * fc], 'lp', 1 / 4);
      rep.push(`TONE ${tn}: ${pct(g, fc)}`);
      if (!near(g, fc, 0.1)) bad.push(`${sr}×${os} TONE ${tn}: −3 dB at ${g} vs ${fc}`);
    }
  }
  t.diagnostic(rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('G2 Perc: the two resonances at f and f·RATIO within 2 %, T60 within 5 % of DECAY (one mode), the bend\'s end pitch within 2 % — every rate', (t) => {
  const bad = [], rep = [];
  for (const [sr, os] of RATES) {
    const fs = sr * os;
    for (const [u, r] of [[0.6, 0.4], [0.3, 1], [0.8, 0]]) {
      const f = lawVal(T[6].u, u), R = lawVal(T[6].k[0], r), n = 8192 * os;
      if (f * R > 0.4 * sr) continue;
      const { y } = one(6, { u, d: 1, k: [r, 1, 0, 0] }, { sr, os, sec: 0.5 }), p = power(y, Math.round(0.02 * fs), n);
      const f1 = peakHz(p, fs, n, 0.9 * f, 1.1 * f), f2 = R > 1.05 ? peakHz(p, fs, n, 0.95 * f * R, 1.05 * f * R) : f * R;
      rep.push(`${sr / 1000}k×${os} ${pct(f1, f)} / ${pct(f2, f * R)}`);
      if (!near(f1, f, 0.02) || !near(f2, f * R, 0.02)) bad.push(`${sr}×${os} u ${u} r ${r}: ${f1} ${f2} vs ${f} ${f * R}`);
    }
    for (const d of [0.3, 0.7]) {
      const T60 = lawVal(T[6].d, d), f = lawVal(T[6].u, 0.6), { y } = one(6, { d, k: [0.4, 0, 0, 0] }, { sr, os, sec: 0.75 * T60 + 0.02 });
      const e = t60(peakEnv(y, fs, Math.max(4 / fs, 1.2 / f)));
      rep.push(`T60 ${pct(e, T60)}`);
      if (!near(e, T60, 0.05)) bad.push(`${sr}×${os} d ${d}: T60 ${e} vs ${T60}`);
    }
    { // BEND 1 (7 st over 15 ms): after 10 × 15 ms the pitch is f
      const f = lawVal(T[6].u, 0.4), { y } = one(6, { u: 0.4, d: 0.9, k: [0.4, 0, 0, 1] }, { sr, os, sec: 0.3 });
      const fe = freqAt(y, fs, 0.15, 12);
      rep.push(`bend end ${pct(fe, f)}`);
      if (!near(fe, f, 0.02)) bad.push(`${sr}×${os}: bend end ${fe} vs ${f}`);
    }
  }
  t.diagnostic(rep.join(' · '));
  assert.deepEqual(bad, []);
});

// (the Perc's 1 ms noise burst into the resonators' low-pass taps (DC gain 1) once left its own mean as a step's area: 1.6e-3 at v 127 —
// the strike's noise now has its Hann-weighted mean removed; engine-track's "alone" gate measures the same through the Track, whose
// output stage holds a 1-pole DC block at 4 Hz (engine.js outStage: y = x − x₋₁ + (1 − 2π·4 / fs)·y₋₁) — the bodies' own DC, the
// Kick's swept sine 1.1e-3 raw, is the block's to remove over their long T60s; the Perc's 25 ms is too short for it)
test('G2 DC: each type alone at its defaults (LEVEL 0.7), v 32 / 64 / 100 / 127, 8 salts — |the mean over its first T60| ≤ 1e-3 after the output stage\'s 4 Hz DC block, every rate', (t) => {
  const bad = [], rep = [];
  for (const [sr, os] of RATES) for (let ty = 1; ty <= 6; ty++) {
    const T60 = lawVal(T[ty].d, T[ty].d.def);
    let w = 0;
    for (const v of [32, 64, 100, 127]) for (const z of salts(8, z => z)) {
      const { y, fs } = one(ty, {}, { v, sr, os, sec: T60 + 0.01, salt: z }), n = Math.max(128 * os, Math.round(T60 * fs)), R = 1 - 2 * Math.PI * 4 / fs;
      let s = 0, x0 = 0, y0 = 0; for (let i = 0; i < n; i++) { y0 = y[i] - x0 + R * y0; x0 = y[i]; s += y0; }
      const dc = s / n;
      if (Math.abs(dc) > Math.abs(w)) w = dc;
      if (!(Math.abs(dc) <= 1e-3)) bad.push(`${sr}×${os} ${NAMES[ty]} v ${v} salt ${z}: DC ${dc.toExponential(2)}`);
    }
    if (sr === 48000 && os !== 2) rep.push(`${sr / 1000}k×${os} ${NAMES[ty]} ${w.toExponential(1)}`);
  }
  t.diagnostic('the worst DC: ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('G2 band-limiting at 48 kHz × 1 (held, steady): the Hi-hat\'s squares — the energy off their harmonics ≥ 40 dB below the energy on them in 0–15 kHz; the Kick\'s drive at 1 on a 61.3 Hz sine — ≥ 50 dB', (t) => {
  const sr = 48000, n = 1 << 16, rep = [];
  const ratio = (y, lines) => {
    const p = power(y, Math.round(0.1 * sr), n, bh), on = new Uint8Array(p.length);
    for (const f of lines) { const b = Math.round(f * n / sr); for (let i = Math.max(0, b - 6); i <= Math.min(p.length - 1, b + 6); i++) on[i] = 1; }
    let a = 0, o = 0;
    for (let i = Math.round(20 * n / sr); i < Math.round(15000 * n / sr); i++) { if (on[i]) a += p[i]; else o += p[i]; }
    return 10 * Math.log10(a / o);
  };
  { // the hat: METAL 1 (squares only), the defaults' TONE / RING / SPREAD
    const p = def(3, { k: [0.5, 1, 0.3, 0.5] }), f = lawVal(T[3].u, p.u), sp = lawVal(T[3].k[3], p.k[3]);
    const fi = T[3].blk.ratios.map(r => f * (1 + (r - 1) * sp)), lines = [];
    for (const x of fi) for (let h = 1; h * x < 24000; h++) lines.push(h * x);
    const { y } = one(3, p, { sr, os: 1, sec: 0.1 + n / sr + 0.01, opt: { hold: true } }), d = ratio(y, lines);
    rep.push(`hat ${d.toFixed(1)} dB`);
    assert.ok(d >= 40, `the hat's aliases ${d.toFixed(1)} dB below its harmonics`);
  }
  { // the drive: PUNCH 0 (no sweep), CLICK 0, DRIVE 1
    const f = 61.3, u = Math.log(f / 30) / Math.log(4), lines = [];
    for (let h = 1; h * f < 24000; h++) lines.push(h * f);
    const { y } = one(1, { u, k: [0, 0.4, 0, 1] }, { sr, os: 1, sec: 0.1 + n / sr + 0.01, opt: { hold: true } }), d = ratio(y, lines);
    rep.push(`drive ${d.toFixed(1)} dB`);
    assert.ok(d >= 50, `the drive's aliases ${d.toFixed(1)} dB below its harmonics`);
  }
  t.diagnostic(rep.join(' · '));
});

// §2.1's velocity brightness: the bright knob offset by vBright · (v − 100) / 127 positions — read back exactly from the instance at
// v 32 / 64 / 100 / 127 for every type — and the spectral centroid of the attack (its first 5.3 ms, where the bright knobs act: the
// Kick's click lasts 4 ms; 8 salts summed) at v 127 against v 100. (§2.3's ≥ 1.05 × holds for the Kick; §2.1's own offset (0.0425
// positions at v 127) moves the noise types' corners by 6–9 %, which moves their centroids 1–3 %, and the Snare's COLOR thins its
// noise under the body — IMPL-DM §13 lane V's note: gated here as brighter (the Snare on its noise path), the law exact)
test('G2 brightness: the bright knob\'s offset exact at v 32 / 64 / 100 / 127 (every type); the attack\'s centroid at v 127 ≥ 1.05 × v 100\'s (Kick), brighter (Hi-hat, Clap, the Snare\'s noise path); the gain law (v / 127)²', (t) => {
  const sr = 48000, os = 4, fs = sr * os, rep = [], n = 1024, bad = [];
  for (let ty = 1; ty <= 6; ty++) for (const v of [32, 64, 100, 127]) {
    const m = machine({ list: [def(ty)] }); render(m, { sec: 0.01, hits: [[0, 0, v]] });
    const L = T[ty].k[T[ty].bright], want = lawVal(L, Math.min(1, Math.max(0, L.def + KIT.LAW.vBright * (v - 100) / 127))), got = m._v[0]['q' + (T[ty].bright + 1)];
    if (!near(got, want, 1e-12) && !(want === 0 && got === 0)) bad.push(`${NAMES[ty]} v ${v}: ${got} vs ${want}`);
  }
  assert.deepEqual(bad, [], 'the bright offset');
  const cen = (ty, v, o = {}) => {
    const acc = new Float64Array(n / 2);
    for (const y of salts(8, z => one(ty, o, { sr, os, v, sec: n / fs + 0.01, salt: z }).y)) { const p = power(y, 0, n, () => 1); for (let i = 0; i < n / 2; i++) acc[i] += p[i]; }
    let a = 0, b = 0;
    for (let i = 1; i < Math.round(20000 * n / fs); i++) { a += i * acc[i]; b += acc[i]; }
    return a / b * fs / n;
  };
  for (const [ty, o, min, lab] of [[1, {}, 1.05, 'Kick'], [3, {}, 1.01, 'Hi-hat'], [4, {}, 1.005, 'Clap'], [2, { k: [1, 0.5, 0.45, 0.5] }, 1.005, 'Snare (noise path)'], [2, {}, 0, 'Snare']]) {
    const lo = cen(ty, 100, o), hi = cen(ty, 127, o);
    rep.push(`${lab} ${lo.toFixed(0)} → ${hi.toFixed(0)} Hz (× ${(hi / lo).toFixed(3)})`);
    assert.ok(hi >= min * lo, `${lab}: ${lo} → ${hi} (× ${(hi / lo).toFixed(3)} < ${min})`);
  }
  // the gain law with the bright knob out of play: the Tom at NOISE 0 below v 100 (its offset clamps at 0) — the peak ∝ v²
  const pk = v => absMax(one(5, { k: [0.3, 0.4, 0, 0] }, { sr, os, v, sec: 0.2 }).y);
  for (const v of [32, 64]) assert.ok(near(pk(v) / pk(100), (v / 100) ** 2, 1e-9), 'v ' + v);
  t.diagnostic(rep.join(' · '));
});

/* ================================================================ G3: the machine */
test('G3 steps ≡ hits: trig(mask, vl, o) renders the bytes of the same hit() calls in the same chunk (lane j = slot j, vl[o + j] its velocity; slot 0 and slots 12–15 too); a bad vl plays v 100; v 0 plays nothing', () => {
  const list = STARTER().concat([def(6), def(1, { u: 0.2 }), def(3, { d: 0.9 }), def(4), def(5, { u: 0.8 }), def(2, { u: 0.1 }), def(6, { u: 0.9 }), def(3, { u: 1 })]);
  const vl = new Uint8Array(64); for (let j = 0; j < 16; j++) vl[32 + j] = 30 + 6 * j;
  const mask = 0xF00F | (1 << 7);
  const a = render(machine({ list }), { sec: 0.4, hits: [[64, m => m.trig(mask, vl, 32)]] }).y;
  const b = render(machine({ list }), { sec: 0.4, hits: [[64, m => { for (let j = 0; j < 16; j++) if (mask >> j & 1) m.hit(j, vl[32 + j]); }]] }).y;
  assert.ok(absMax(a) > 0.05 && same(a, b), 'a step = its hits, bit for bit');
  const c = render(machine({ list }), { sec: 0.2, hits: [[0, m => m.trig(1, null, 0)]] }).y, d = render(machine({ list }), { sec: 0.2, hits: [[0, 0, 100]] }).y;
  assert.ok(same(c, d), 'no vl: v 100');
  const z = new Uint8Array(16); assert.equal(absMax(render(machine({ list }), { sec: 0.1, hits: [[0, m => m.trig(0xFFFF, z, 0)]] }).y), 0, 'v 0: nothing');
  const sh = render(machine({ list }), { sec: 0.2, hits: [[0, m => m.trig(1, new Uint8Array(4), 0)]] }).y;
  assert.ok(same(sh, d), 'a vl shorter than o + 16: v 100 (the family\'s normal step)');
});

test('G3 chokes: a hit fades every sounding instance of its group\'s other voices by the 3 ms raised cosine; two voices of one group in the same chunk both sound; another group or none untouched', () => {
  const sr = 48000, os = 4, fs = sr * os, oh = def(3, { d: 0.9, c: 1 }), ch = def(3, { d: 0.2, c: 1 }), free = def(3, { d: 0.9, c: 2 });
  const ring = (hits, list = [oh, ch, free]) => render(machine({ list }), { sec: 0.3, hits }).y;
  const alone = ring([[0, 0, 100]], [oh, null, free]), cut = ring([[0, 0, 100], [4800, 1, 100]], [oh, ch, free]), chOnly = ring([[4800, 1, 100]], [null, ch, free]);
  const F0 = 4800 * os, M = Math.round(KIT.CHOKE_MS / 1000 * fs);
  // after the fade the open hat is gone: what is left is the closed hat alone
  let d = 0; for (let i = F0 + M + 8; i < cut.length; i++) d = Math.max(d, Math.abs(cut[i] - chOnly[i]));
  assert.ok(d < 1e-12, 'the open hat faded out within 3 ms: ' + d);
  // before the hit: untouched
  assert.ok(same(cut.subarray(0, F0), alone.subarray(0, F0)));
  // same chunk: both sound (the choke cuts only instances started before its chunk)
  const both = ring([[0, 0, 100], [0, 1, 100]]), m = machine({ list: [oh, ch, free] });
  render(m, { sec: 0.01, hits: [[0, 0, 100], [0, 1, 100]] });
  assert.ok(m._v[0].on && m._v[2].on && absMax(both) > 0.01, 'both of one chunk sound');
  // group 2 untouched by group 1's hit
  const fr = ring([[0, 2, 100], [4800, 1, 100]]), frA = ring([[0, 2, 100], [4800, 1, 100]], [null, ch, free]);
  assert.ok(same(fr, frA), 'another group: untouched');
});

// the click bound (IMPL-WC G3's) at an event inside a ringing voice: x = the old sound (faded) + the new one, so its steps are bound
// by the two sounds' own (each rendered alone on the same frames: the same noise) and the fade's ramp — max |x[n] − x[n−1]| over the
// event's 6 ms ≤ 1.05 × (old's own max step + new's own max step + peak / (0.003·fs)); an idle slot's hit (it rang and slept) = the
// same hit on a fresh machine, bit for bit
test('G3 clicks: a retrigger and a choke inside a ringing voice within the click bound (the two sounds\' own steps + the ramp), every type at 48 × 4 and 44.1 × 1; an idle slot\'s hit = a fresh one', () => {
  const bad = [];
  for (const [sr, os] of [[48000, 4], [44100, 1]]) {
    const fs = sr * os;
    for (let ty = 1; ty <= 6; ty++) {
      const p = def(ty, { d: 0.8 }), q = def(ty, { d: 0.8, c: 1 }), F1 = 6000, i1 = F1 * os, W = Math.round(0.006 * fs), sec = 0.3;
      const step = (y, a, b) => { let m = 0; for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1])); return m; };
      const R = (list, hits) => render(machine({ sr, os, list }), { sr, os, sec, hits }).y;
      for (const [what, list, hits, ha, hb] of [['retrigger', [p], [[0, 0, 127], [F1, 0, 127]], [[0, 0, 127]], [[F1, 0, 127]]],
        ['choke', [q, q], [[0, 0, 127], [F1, 1, 127]], [[0, 0, 127]], [[F1, 1, 127]]]]) {
        const x = R(list, hits), a = R(list, ha), b = R(list, hb);
        const bound = 1.05 * (step(a, i1 - 4, i1 + W) + step(b, i1 - 4, i1 + W) + absMax(a) / (0.003 * fs)), got = step(x, i1 - 4, i1 + W);
        if (!(got <= bound)) bad.push(`${sr}×${os} ${NAMES[ty]} ${what}: ${got} > ${bound}`);
      }
      const F2 = 3 * sr, i2 = F2 * os;
      const id = render(machine({ sr, os, list: [p] }), { sr, os, sec: 3.1, hits: [[0, 0, 127], [F2, 0, 127]] }).y, fr = render(machine({ sr, os, list: [p] }), { sr, os, sec: 3.1, hits: [[F2, 0, 127]] }).y;
      if (!same(id.subarray(i2), fr.subarray(i2))) bad.push(`${sr}×${os} ${NAMES[ty]}: the slept slot's hit ≠ a fresh one`);
    }
  }
  assert.deepEqual(bad, []);
});

test('G3 retrigger: two instances a slot — a hit fades the sounding one by the raised cosine and starts the new one at rest; never a pile-up (a hit a chunk: ≤ 2 instances on)', () => {
  const m = machine({ list: [def(1, { d: 1 })] });
  const hits = Array.from({ length: 40 }, (_, i) => [4 * i, 0, 100]);
  render(m, { sec: 0.05, hits, span: () => 4 });
  assert.ok(m._v.filter(v => v.on).length <= 2 && m._v.slice(2).every(v => !v.on), 'slot 0\'s two at most');
  const q = machine({ list: [def(1, { d: 1 })] }), y = render(q, { sec: 0.5, hits: [[0, 0, 100], [9600, 0, 100]] }).y;
  assert.ok(Number.isFinite(absMax(y)) && q._v[0].on !== q._v[1].on, 'one instance after the 3 ms fade');
});

test('G3 invariance: any span split, a sleep / wake and a 2 s idle skip render the same bytes as one uninterrupted render (every type, a choke pair, retriggers)', () => {
  const list = STARTER().concat([def(6, { k: [0.6, 0.7, 0.8, 0.5] }), def(5, { k: [0.6, 0.3, 0.4, 0.6] }), def(1, { k: [0.7, 0.2, 0.5, 0.4] })]);
  const hits = [[0, 0, 100], [0, 3, 64], [2400, 4, 127], [4800, 3, 90], [6000, 1, 100], [6004, 2, 110], [9600, 5, 70], [9600, 6, 127], [12000, 7, 100],
    [12800, 8, 100], [13200, 9, 100], [13600, 10, 127], [14400, 0, 30], [14404, 0, 127]];
  const late = hits.map(([f, s, v]) => [f + 3 * 48000, s, v]);
  for (const os of [1, 4]) {
    const a = render(machine({ os, list }), { os, sec: 1, hits }).y;
    let k = 0;
    const R = [7, 1, 64, 33, 128, 5, 12, 100, 2, 57];
    const b = render(machine({ os, list }), { os, sec: 1, hits, span: () => 4 * R[k++ % R.length] }).y;
    assert.ok(absMax(a) > 0.1 && same(a, b), `OS ${os}: span splits`);
    // a sleep and a wake: the same hits 3 s later (the machine asleep in between) = the same bytes; an idle skip in between too
    const c = render(machine({ os, list }), { os, sec: 4, hits: hits.concat(late) }).y, d = render(machine({ os, list }), { os, sec: 4, hits: hits.concat(late), skip: F => F > 1.2 * 48000 && F < 2.9 * 48000 }).y;
    const L = a.length, off = 3 * 48000 * os;
    // (the noise is a hash of the absolute index: the late copy differs from the early one; the skip leaves it unchanged)
    assert.ok(same(c, d), `OS ${os}: a 2 s idle skip`);
    assert.ok(absMax(c, off, off + L) > 0.1, 'the late hits sound');
    const m = machine({ os, list }); render(m, { os, sec: 1.4, hits });
    assert.ok(!m.live() && m._v.every(v => !v.on), 'asleep after the hits');
  }
});

test('G3 denormals and hostile values: 10 s of silence then a hit leaves no subnormal state; NaN / ±Inf / out-of-range panel values and hits play the default or nothing, never NaN', () => {
  const m = machine({ os: 2, list: STARTER() });
  render(m, { os: 2, sec: 10, hits: [[0, 0, 100], [0, 3, 100]] });
  render(m, { os: 2, sec: 0.5, hits: [[0, 2, 127]] });
  const sub = x => x !== 0 && Math.abs(x) < 2.2250738585072014e-308, bad = [];
  const scan = (o, p) => { for (const [k, v] of Object.entries(o)) { if (typeof v === 'number' && sub(v)) bad.push(p + k); else if (ArrayBuffer.isView(v) && Array.prototype.some.call(v, sub)) bad.push(p + k + '[]'); } };
  m._v.forEach((v, i) => scan(v, 'v' + i + '.')); scan(m._M, 'M.');
  assert.deepEqual(bad, []);
  const H = kitP([def(1), def(2), def(3), def(4), def(5), def(6)]);
  for (let i = 0; i < H.v.length; i++) H.v[i] = [NaN, Infinity, -Infinity, 1e9, -3, 0.5][i % 6];
  for (const j of [0, 1, 2, 3, 4, 5]) H.v[9 * j] = j + 1;
  const h = machine({ drum: H }), y = render(h, { sec: 0.5, hits: [[0, m => { for (let j = 0; j < 16; j++) m.hit(j, 127); m.hit(NaN, 100); m.hit(99, 100); m.hit(-1, 100); m.hit(2, NaN); m.hit(3, Infinity); m.trig(NaN, 'x', NaN); }]] }).y;
  assert.ok(y.every(Number.isFinite) && absMax(y) > 0.01 && absMax(y) < 10, 'finite, sounding (the LEVELs clamped at their +6.2 dB)');
  const n = machine({ drum: null }); n.set(null); assert.ok(render(n, { sec: 0.1, hits: [[0, 0, 100]] }).y.every(x => x === 0), 'no panel: every slot empty');
  const pl = machine({ drum: plain(kitP(STARTER())) }), kp = machine({ list: STARTER() });
  assert.ok(same(render(pl, { sec: 0.3, hits: [[0, 0, 100], [0, 3, 80]] }).y, render(kp, { sec: 0.3, hits: [[0, 0, 100], [0, 3, 80]] }).y), 'a plain object of ids reads as the KitP');
});

test('mon / live / reset / smp / setSalt / poll: lit bits and act per slot since the last mon; live while a hit is latched or an instance sounds; reset silences; smp stored inert; setSalt changes the noise only', () => {
  const m = machine({ list: STARTER() });
  m.hit(2, 100); m.hit(5, 64);
  assert.ok(m.live(), 'a latched hit is live');
  render(m, { sec: 0.02 });
  const a = m.mon();
  assert.equal(a.lit, (1 << 2) | (1 << 5));
  assert.ok(a.act[2] > 0 && a.act[5] > 0 && a.act[0] === 0, 'act by slot');
  assert.equal(m.mon().lit, 0, 'lit clears');
  assert.equal(m._v.filter(v => v.on).length, 2, '_v: the two sounding');
  m.reset();
  assert.ok(!m.live() && m._v.every(v => !v.on));
  const x = render(machine({ list: STARTER() }), { sec: 0.2, hits: [[0, 1, 100]] }).y;
  const s = machine({ list: STARTER() }); s.smp([{ id: 'smp:0123456789abcdef', on: true }, null]);
  assert.ok(same(render(s, { sec: 0.2, hits: [[0, 1, 100]] }).y, x), 'smp: inert in cut 1');
  assert.equal(s._smp[0].id, 'smp:0123456789abcdef');
  const z = machine({ list: STARTER(), salt: 7 }), zy = render(z, { sec: 0.2, hits: [[0, 1, 100]] }).y;
  assert.ok(!same(zy, x) && same(render(machine({ list: STARTER(), salt: 7 }), { sec: 0.2, hits: [[0, 1, 100]] }).y, zy), 'another salt: other noise, deterministic');
  const k0 = render(machine({ list: STARTER() }), { sec: 0.2, hits: [[0, 0, 100]] }).y, k7 = render(machine({ list: [def(1, { k: [0.5, 0.4, 0, 0] })], salt: 7 }), { sec: 0.2, hits: [[0, 0, 100]] }).y;
  assert.ok(same(k7, render(machine({ list: [def(1, { k: [0.5, 0.4, 0, 0] })] }), { sec: 0.2, hits: [[0, 0, 100]] }).y) && absMax(k0) > 0, 'no noise in the voice: the salt changes nothing');
  m.poll(0);
});

test('an OS change while ringing: the instances carry on at the new rate (finite, sounding, their pitch kept)', () => {
  const m = machine({ os: 4, list: [def(5, { d: 1, k: [0, 0.4, 0, 0] })] }), f = lawVal(T[5].u, T[5].u.def);
  render(m, { os: 4, sec: 0.2, hits: [[0, 0, 100]] });
  m.setOS(2);
  const { y, fs } = render(m, { os: 2, sec: 0.3 });
  assert.ok(y.every(Number.isFinite) && absMax(y) > 0.01, 'rings on');
  assert.ok(near(freqAt(y, fs, 0.05), f, 0.01), 'its pitch');
});

test('no allocation: hits, steps, render (every type sounding, fades, chokes), post, mon, smp, setSalt, setOS, reset', () => {
  const { sc } = lib(48000), m = machine({ list: STARTER().concat([def(6), def(1, { k: [0.5, 0.4, 0.5, 0.7] }), def(5, { k: [0.5, 0.4, 0.3, 0.6] })]) });
  const buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128), vl = new Uint8Array(16).fill(100), sl = [{ id: 'smp:0123456789abcdef', on: true }];
  for (let k = 0; k < 3; k++) { m.trig(0x7FF, vl, 0); m.render(buf, 512, 128 * k); }
  noAlloc(sc, () => {
    for (let k = 0; k < 400; k++) {
      if (k % 7 === 0) m.trig(0x7FF, vl, 0);
      if (k % 11 === 3) m.hit(4, 127);
      buf.fill(0); m.render(buf, 512, 128 * (k + 3));
      for (let i = 0; i < 128; i++) mono[i] = buf[4 * i];
      m.post(L, R, mono, 128);
      m.mon(); m.live();
      if (k === 200) { m.smp(sl); m.setSalt(3); }
    }
    m.setOS(2); m.render(buf, 256, 99999 * 128); m.setOS(4); m.reset();
  });
});

test('§2.3 cost (informational, recorded in IMPL-DM §13): per sounding instance at OS 4, 48 kHz — Kick / Tom ≤ 0.0008, Snare / Clap / Perc ≤ 0.0015, Hi-hat ≤ 0.003 (the drive on: reported)', (t) => {
  const sr = 48000, os = 4, rep = [], N = 1024 * 375 / 4;
  for (const [ty, o, lab] of [[1, {}, 'Kick'], [1, { k: [0.5, 0.4, 0.3, 0.6] }, 'Kick+drive'], [2, {}, 'Snare'], [3, {}, 'Hi-hat'], [4, {}, 'Clap'], [5, {}, 'Tom'], [5, { k: [0.3, 0.4, 0.2, 0.6] }, 'Tom+drive'], [6, {}, 'Perc']]) {
    const m = machine({ os, list: [def(ty, Object.assign({ d: 1 }, o))], opt: { hold: true } }), buf = new Float64Array(512);
    m.hit(0, 100); m.render(buf, 512, 0);
    const best = [];
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let k = 0; k < 375; k++) m.render(buf, 512, 128 * (k + 1 + 375 * r)); best.push((performance.now() - t0) / 1000); }
    best.sort((a, b) => a - b);
    rep.push(`${lab} ${best[2].toFixed(5)}`);
    assert.ok(m._v[0].on, lab + ' sounding throughout (held)');
  }
  t.diagnostic('load per instance (1 s of audio, median of 5): ' + rep.join(' · ') + ` (${N})`);
});

// IMPL-DM §14.3 P2 (6): the offline render worker (smprender.js, its DSP list carries kit-dsp.js since phase 0) renders a kit — a
// node:vm "worker" whose importScripts reads the repository files (tests/smpgen.test.mjs's farm)
test('P2-6: smprender.js\'s worker renders a kit (the Starter\'s kick through DrSeq\'s default map: no payload) — not silent, finite, deterministic', () => {
  const V = '?v=9', read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8'), logs = [];
  const g = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) }, location: { search: V } });
  g.self = g; g.postMessage = () => {};
  g.importScripts = (...urls) => { for (const u of urls) vm.runInContext(read(u.slice(0, -V.length)), g, { filename: 'farm/' + u }); };
  vm.runInContext(read('smprender.js'), g, { filename: 'smprender.js' });
  const F = g.__smprender, m = MODELS.find(x => x.id === 'kit');
  assert.ok(F.DSP.includes('kit-dsp.js') && F.ready() && logs.length === 0, 'the worker loads kit-dsp.js');
  const patch = patchFor(m, Object.fromEntries(m.controls.map(c => [c.id, c.def])), null, { sr: 48000, bpm: 120, drift: 0, hiss: 0 });
  const req = { q: 'k', id: 'kit-farm', patch, events: [[0, 1, 36, 100], [12000, 1, 36, 64]], frames: 48000, os: 2 };
  const a = F.render(req), b = F.render(Object.assign({}, req));
  assert.ok(absMax(a.L) > 0.05 && a.L.every(Number.isFinite) && same(a.L, b.L), 'audible, finite, deterministic');
});
