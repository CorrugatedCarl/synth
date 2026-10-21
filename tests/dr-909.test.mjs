// The TR-909 voice circuits (stage 7c lane V9; IMPL-7c §12.1): every sound alone through Dr808.create(…, 'tr909') (dr-808.js)
// — each block against its own analog prototype (target (a)), R9's measured numbers (target (b): research-909-circuits.md
// §2–§10), the per-circuit checks (the BD's sweep, click and DECAY; the SD's two tones, bend, TONE and SNAPPY; the toms'
// sweep and DECAY; the RS's rings and clip; the clap's bursts and tail), the 31-stage noise register (its sequence, its jump,
// its period on a reduced-length check, the box integral per OS sample, one stream for every consumer), the ROM path (the word
// clock from the trigger, the counter and its end, the DAC's levels, the staircase's alias gate against the exact
// band-limited staircase — review #4 —, the reconstruction, the envelopes, the hats as one voice, the shared accent DACs),
// the accent law (the lead's P-1: fixed velocities per state) and the machine's contracts (retrigger, accent, rates,
// determinism, span invariance, order-free latching, no allocation, idle, sleep, sample slots and the chip swap, the §2.6
// level). The ROM path runs on deterministic stand-in images (the test's own: never any machine's data, D4) and, when the
// block holds lane R9's images, on those too. CPU per circuit is reported; the patterns (the machine alone) within §2.7's rows.
// Measurements on the mix bus (the summing amplifier's input: each voice's mono share, volts) unless a state is the measure.
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
const SND = ['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'rd', 'cr', 'oh', 'ch'];
const SI = s => SND.indexOf(s);
const VKEY = { bd: 'bd', sd: 'sd', lt: 'lt', mt: 'mt', ht: 'ht', rs: 'rs', cp: 'cp', rd: 'rd', cr: 'cr', oh: 'hh', ch: 'hh' };
const LEV = { bd: 'bdl', sd: 'sdl', lt: 'ltl', mt: 'mtl', ht: 'htl', rs: 'rsl', cp: 'cpl', rd: 'rdl', cr: 'crl', oh: 'hhl', ch: 'hhl' };
const dB = x => 20 * Math.log10(Math.max(1e-30, x));
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const FS = 192000;

// the test's stand-in images (D4: ours, deterministic): a high-passed noise at ±28 codes about 32, ending at 32
function standIn(n, seed, f = 0.9) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const x = new Float64Array(n), o = new Uint8Array(n);
  let lp = 0, pk = 0;
  for (let i = 0; i < n; i++) { lp += (r() - lp) * (1 - f); x[i] = r() - lp; pk = Math.max(pk, Math.abs(x[i])); }
  for (let i = 0; i < n; i++) o[i] = 32 + Math.round(x[i] / pk * 28);
  o[n - 1] = 32;
  return o;
}
const ROM = (() => {
  const hh = new Uint8Array(32768);
  hh.set(standIn(24576, 3), 0); hh.set(standIn(8192, 5), 24576);
  return { hh, cr: standIn(32768, 7), rd: standIn(32768, 9, 0.7) };
})();

function drumOf(D, over = {}) {
  const X = D.mach.tr909;
  return Object.assign(Object.fromEntries(X.KNOB_IDS.map((k, i) => [k, X.KNOB_DEF[i]])), over);
}
function machine(D, { sr = 48000, os = 4, drum = {}, opt = { rom: ROM }, inst = {} } = {}) {
  const m = D.create(Object.assign({ base: sr, OS: os, seedSalt: 0 }, inst), 'tr909', opt);
  m.set(drumOf(D, drum));
  return m;
}
// one machine, hits [[frame, sound, v127] | [frame, fn(m)]] (frames multiples of 4), spans `span(F)` frames, cut at the hits
// as the engine cuts them; returns the bus at the OS rate and the base-rate output (post) when asked
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
function hit1(s, { v = 100, sr = 48000, os = 4, sec = 1, drum = {}, opt, post = false, D = lib(sr).D } = {}) {
  const m = machine(D, { sr, os, drum, opt });
  return Object.assign(render(m, { sr, os, sec, hits: [[0, SI(s), v]], post }), { m });
}
// a step on one lane (sound s): TOTAL ACCENT and / or its per-voice accent
const step = (s, tot, pv) => m => m.trig((1 << (SI(s) + 1)) | (tot ? 1 : 0), pv ? 1 << (SI(s) + 1) : 0);
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

/* ---------------------------------------------------------------- analysis (as tests/dr-606.test.mjs) */
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
// the time (s) after which the 1 ms peak envelope stays below the peak − db
function decay(y, fs, db = 20) {
  const e = env(y, fs);
  let pk = 0, ip = 0;
  for (let i = 0; i < e.length; i++) if (e[i] > pk) { pk = e[i]; ip = i; }
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
// a TDF-II section's response: first order c[0…2] (b0 b1 a1), second order c[0…4] (B0 B1 B2 A1 A2)
function hz1(c, f, fs) { const w = 2 * Math.PI * f / fs, zr = Math.cos(w), zi = -Math.sin(w); return Math.hypot(c[0] + c[1] * zr, c[1] * zi) / Math.hypot(1 + c[2] * zr, c[2] * zi); }
function hz2(c, f, fs) {
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  return Math.hypot(c[0] + c[1] * c1 + c[2] * c2, c[1] * s1 + c[2] * s2) / Math.hypot(1 + c[3] * c1 + c[4] * c2, c[3] * s1 + c[4] * s2);
}
const ha1 = (b1, b0, a1, a0, f) => { const w = 2 * Math.PI * f; return Math.hypot(b0, b1 * w) / Math.hypot(a0, a1 * w); };
const ha2 = (b2, b1, b0, a2, a1, a0, f) => { const w = 2 * Math.PI * f; return Math.hypot(b0 - b2 * w * w, b1 * w) / Math.hypot(a0 - a2 * w * w, a1 * w); };
const par = (a, b) => a * b / (a + b);
// the exponential time constant of a trace sampled every chunk (4 frames at 48 kHz): ln-fit over [i0, i1)
function tauOf(tr, i0, i1, floor = 0) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = i0; i < i1; i++) { const v = tr[i] - floor; if (!(v > 0)) continue; const x = i * 4 / 48000, yv = Math.log(v); sx += x; sy += yv; sxx += x * x; sxy += x * yv; n++; }
  return -1 / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
}

/* ---------------------------------------------------------------- the module, the ROM frame, the decoder */
test('Dr808 builds the 909 (create(…, \'tr909\')), Dr808.mach / gain / proto.tr909; the 808\'s and the 606\'s tables unchanged', () => {
  const D = D48(), T = D.proto.tr909;
  assert.ok(D && Object.isFrozen(D) && Object.isFrozen(D.mach) && Object.isFrozen(T) && Object.isFrozen(T.ENV9));
  const X = D.mach.tr909;
  assert.deepEqual([...X.sids], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the sounds it has (the 808\'s ids)');
  assert.deepEqual([...X.SOUNDS], [...SND, 'lc', 'mc', 'hc', 'cl', 'ma'], 'ids 7 / 8 the ride and the crash; 11–15 the 808\'s keys (inert)');
  assert.deepEqual([...X.KNOB_IDS], ['ac', 'bdu', 'bdl', 'bda', 'bdd', 'sdu', 'sdl', 'sdt', 'sds', 'ltu', 'ltl', 'ltd', 'mtu', 'mtl', 'mtd',
    'htu', 'htl', 'htd', 'rsl', 'cpl', 'hhl', 'chd', 'ohd', 'crl', 'rdl', 'cru', 'rdu', 'vol'], 'the 28 knobs, IMPL-7c §1.1');
  // (the default LEVELs, review 1 F1: the kick 9, snare and hats 4, clap 1.5, crash 3, ride 3.5, the toms and RS 7 = models.js)
  const lv = { bdl: 0.9, sdl: 0.4, ltl: 0.7, mtl: 0.7, htl: 0.7, rsl: 0.7, cpl: 0.15, hhl: 0.4, crl: 0.3, rdl: 0.35 };
  assert.deepEqual([...X.KNOB_DEF], [...X.KNOB_IDS].map(k => (k === 'vol' ? 0.75 : k in lv ? lv[k] : 0.5)), 'the default LEVELs, VOLUME 7.5, the rest 5');
  assert.deepEqual([...D.mach.tr606.sids], [0, 1, 2, 4, 8, 9, 10]);
  assert.equal(D.KNOB_IDS.length, 23, 'the top-level exports stay the 808\'s');
  assert.equal(D.create({ base: 48000, OS: 1 }, 'tr999'), null, 'another kind: no machine');
  const m = machine(D);
  for (const f of ['set', 'setOS', 'hit', 'trig', 'render', 'post', 'live', 'reset', 'mon', 'smp', 'setSalt']) assert.equal(typeof m[f], 'function', f);
  assert.equal(m._mach, 'tr909');
  assert.equal(m.live(), false, 'a fresh machine is silent');
  assert.deepEqual(Object.keys(m._v).sort(), ['bd', 'cp', 'cr', 'hh', 'ht', 'lt', 'mt', 'rd', 'rs', 'sd'], 'seven analog circuits, three ROM voices');
  // gain(): VR28 (50 k B) over the mix resistors, the full-scale constant
  assert.equal(D.gain('tr909', { vol: 1 }), T.MIX9.VR28 / T.MIX9.RM * T.OUT_K9);
  assert.equal(D.gain('tr909', { vol: 0 }), 0);
  assert.equal(D.gain('tr909', null), D.gain('tr909', { vol: 0.75 }));
  // ENV9 (lane R9's tool reads it): 64 positive gains per cymbal, falling (the anti-log of the address staircase)
  for (const k of ['cr', 'rd']) {
    const E = T.ENV9[k];
    assert.ok(E.length === 64 && E.every(x => typeof x === 'number' && x > 0 && x < Infinity), k);
    assert.ok(E.every((x, i) => i === 0 || x < E[i - 1]), k + ' falls');
  }
  assert.ok(near(dB(T.ENV9.cr[63] / T.ENV9.cr[0]) / dB(T.ENV9.rd[63] / T.ENV9.rd[0]), 470 / 270, 1e-9), 'the ride: RA11\'s map over R439 470 k');
});

test('the ROM frame and the decoder: one marker pair, lane R9\'s alphabet, rom9() three 32 768-word images decoded once a scope', () => {
  const D = D48(), T = D.proto.tr909, L = SRC.split('\n');
  const A = '/* ROM909 — generated by tools/rom909.mjs, do not edit */', B = '/* end ROM909 */';
  const ia = L.flatMap((l, i) => (l.trim() === A ? [i] : [])), ib = L.flatMap((l, i) => (l.trim() === B ? [i] : []));
  assert.ok(ia.length === 1 && ib.length === 1 && ib[0] > ia[0], 'the two markers, each alone on its line');
  assert.equal(T.ROM909_A, '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz');
  assert.ok([...T.ROM909_A].every((c, i, a) => i === 0 || c > a[i - 1]), 'ASCII order');
  assert.ok(!/[\\'"`${]/.test(T.ROM909_A), 'no character a string literal must escape');
  const R = T.rom9();
  assert.ok(R === T.rom9() && Object.isFrozen(R), 'decoded once: the scope\'s images are shared');
  for (const k of ['hh', 'cr', 'rd']) assert.ok(R[k].constructor.name === 'Uint8Array' && R[k].length === 32768 && R[k].every(c => c < 64), k);
  // a string → its codes (code = index), a short string padded with mid-scale, a foreign character as mid-scale
  const d = T.dec9(T.ROM909_A + 'z-\\');
  for (let i = 0; i < 64; i++) assert.equal(d[i], i);
  assert.deepEqual([d[64], d[65], d[66], d[67], d[32767]], [63, 0, 32, 32, 32]);
  assert.ok(T.dec9('').every(c => c === 32) && T.dec9(undefined).every(c => c === 32), 'the placeholder reads as silence');
  // the block's images (lane R9's, after its --write; the frame's placeholder until then): each region ends at mid-scale
  const filled = !R.cr.every(c => c === 32);
  if (filled) for (const [k, e] of [['hh', 24575], ['hh', 32767], ['cr', 32767], ['rd', 32767]]) assert.equal(R[k][e], 32, `${k} ends at mid-scale`);
  console.log(`# the block: ${filled ? 'lane R9\'s images' : 'the placeholder (empty images, mid-scale)'}`);
});

/* ---------------------------------------------------------------- the accent DACs and the velocity law (§1.3, P-1) */
test('the accent law (P-1): v 100 / 110 / 119 / 127 name normal / per-voice / total / both at every TOTAL ACCENT; codes between interpolated; ghosts; the buffer\'s clip', () => {
  const D = D48(), T = D.proto.tr909, A = T.ACC9, o = [0, 0, 0, 0], bad = [];
  assert.deepEqual([A.N0, A.L, A.TMAX], [21, 11, 22]);
  assert.equal(T.CBOTH9, 54, 'both at full TOTAL ACCENT: code 54, at the buffer\'s clip (MW3: 52–56)');
  for (let k = 0; k <= 20; k++) {
    const u = k / 20;
    for (let s = 0; s < 11; s++) {
      T.codes9(s, u, o);
      const v = [100, 110, 119, 127].map(x => T.vTrig9(x, s, u));
      if (v.join() !== o.join()) bad.push(`${SND[s]} u ${u}: ${v} vs ${o}`);
      if (!T.PV9[s] && o[1] !== o[0]) bad.push(`${SND[s]}: no per-voice accent`);
      if (o[2] !== A.N0 + Math.round(A.TMAX * u)) bad.push('total');
      // between two states: integers on the segment between the two codes
      for (let x = 100; x <= 127; x++) {
        const c = T.vTrig9(x, s, u), j = x <= 110 ? 0 : x <= 119 ? 1 : 2, lo = Math.min(o[j], o[j + 1]), hi = Math.max(o[j], o[j + 1]);
        if (!(Number.isInteger(c) && c >= lo && c <= hi)) bad.push(`${SND[s]} v ${x}: ${c}`);
      }
    }
  }
  for (let x = 1; x < 100; x++) if (T.vTrig9(x, 0, 0.5) !== Math.round(A.N0 * (0.6 + 0.4 * (x - 1) / 99))) bad.push('ghost ' + x);
  assert.equal(T.vTrig9(0, 0, 0.5), T.vTrig9(1, 0, 0.5)); assert.equal(T.vTrig9(200, 1, 1), 54);
  assert.deepEqual(bad, []);
  // the DAC's volts (code · 5/63 · 3.13) and the buffer's clip at 13.5 V
  assert.ok(near(T.vAcc9(21), 21 * 5 / 63 * (1 + 10 / 4.7), 1e-12));
  assert.ok(T.vAcc9(63) < 13.5 && T.vAcc9(56) > 13.0 && T.vAcc9(50) < 12.5, `the knee ${[50, 54, 56, 63].map(c => T.vAcc9(c).toFixed(2))}`);
});

test('the step and the hit agree (trig(mask, acc) = hit at the state\'s velocity); a shared DAC takes the higher code; a held level acts between hits', () => {
  const D = D48(), T = D.proto.tr909, bad = [];
  for (const s of SND) {
    for (const [tot, pv, v] of [[0, 0, 100], [0, 1, 110], [1, 0, 119], [1, 1, 127]]) {
      const a = render(machine(D), { sec: 0.12, hits: [[48, step(s, tot, pv)]] }).y, b = render(machine(D), { sec: 0.12, hits: [[48, SI(s), v]] }).y;
      if (!same(a, b) || absMax(a) === 0) bad.push(`${s} ${tot}${pv}`);
    }
  }
  assert.deepEqual(bad, [], 'a step\'s four states = the four velocities');
  // RS + HC on one DAC: both read the higher code
  const r1 = render(machine(D), { sec: 0.2, hits: [[0, SI('rs'), 127], [0, SI('cp'), 100]] }).y, r2 = render(machine(D), { sec: 0.2, hits: [[0, SI('rs'), 127], [0, SI('cp'), 127]] }).y;
  assert.ok(same(r1, r2), 'RS 127 + HC 100 = RS 127 + HC 127');
  // a ride hit (code 32) during a ringing crash (code 21): the crash's VCA × e^(KX · 11 · 5/63) from the ride's chunk on
  const both = render(machine(D), { sec: 0.5, hits: [[0, SI('cr'), 100], [12000, SI('rd'), 127]] }).y;
  const cr = render(machine(D), { sec: 0.5, hits: [[0, SI('cr'), 100]] }).y, rd = render(machine(D), { sec: 0.5, hits: [[12000, SI('rd'), 127]] }).y;
  const part = both.map((x, i) => x - rd[i]), k = Math.exp(T.KX9 * 11 * T.DAC9V);
  assert.ok(near(rmsW(part, FS, 0.3, 0.45) / rmsW(cr, FS, 0.3, 0.45), k, 0.01), `the crash × ${(rmsW(part, FS, 0.3, 0.45) / rmsW(cr, FS, 0.3, 0.45)).toFixed(4)} (${k.toFixed(4)})`);
  assert.ok(same(part.subarray(0, 12000 * 4), cr.subarray(0, 12000 * 4)), 'unchanged before the ride');
  // an RS hit (code 32) 5 ms into a clap (code 21): the clap's later bursts read it, its first burst and its tail do not
  const hc = render(machine(D), { sec: 0.3, hits: [[0, SI('cp'), 100]] }).y, rs = render(machine(D), { sec: 0.3, hits: [[240, SI('rs'), 127]] }).y;
  const hb = render(machine(D), { sec: 0.3, hits: [[0, SI('cp'), 100], [240, SI('rs'), 127]] }).y.map((x, i) => x - rs[i]);
  const P = T.HC9, kb = (T.vAcc9(32) - 1.2 + P.D) / (T.vAcc9(21) - 1.2 + P.D);
  assert.ok(maxAbsDiff(hb.subarray(0, Math.round(0.0095 * FS)), hc.subarray(0, Math.round(0.0095 * FS))) < 1e-12, 'the first burst unchanged');
  const g = absMax(hb.subarray(Math.round(0.0215 * FS), Math.round(0.026 * FS))) / absMax(hc.subarray(Math.round(0.0215 * FS), Math.round(0.026 * FS)));
  assert.ok(g > 1.1 && g < kb * 1.1, `the third burst × ${g.toFixed(3)} (≤ ${kb.toFixed(3)}: its tail's share unchanged)`);
});

/* ---------------------------------------------------------------- the noise: the 31-stage register (R9 §7) */
// a literal register: 31 stages filled with ones, the new bit stage 31 ⊕ stage 13 shifted in; the bits as they enter
function register(n) {
  const s = new Uint8Array(32).fill(1), e = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (k < 31) { e[k] = 1; continue; }
    const b = s[31] ^ s[13];
    for (let j = 31; j > 1; j--) s[j] = s[j - 1];
    s[1] = b; e[k] = b;
  }
  return e;
}
// the model's window at position n (bit t = e[n − 1 − t]) stepped on
function bitsFrom(T, n, count) {
  let w = T.win9(n);
  const e = new Uint8Array(count);
  for (let k = 0; k < count; k++) { const b = ((w >>> 12) ^ (w >>> 30)) & 1; w = ((w << 1) | b) & 0x7FFFFFFF; e[k] = b; }
  return e;
}
test('the noise register: taps 31 / 13 filled with ones (a literal register\'s bits), the jump to any position = stepping there, period 2³¹ − 1', () => {
  const D = D48(), T = D.proto.tr909, N = 400000, E = register(N);
  const M = bitsFrom(T, 31, N - 31);
  for (let k = 31; k < N; k++) if (M[k - 31] !== E[k]) assert.fail(`bit ${k}`);
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  for (let t = 0; t < 40; t++) {
    const n = 31 + rnd() % (N - 200);
    const w = T.win9(n);
    for (let j = 0; j < 31; j++) if (((w >>> j) & 1) !== E[n - 1 - j]) assert.fail(`window at ${n}`);
  }
  // GF(2): x^(a + b) = x^a · x^b, and the period: x^(2³¹ − 1) = 1 (2³¹ − 1 is prime and x ≠ 1: the order is exactly that)
  for (const [a, b] of [[5, 7], [123456, 7654321], [2 ** 40 + 3, 2 ** 33 + 17]]) assert.equal(T.pow9(a + b), T.mul9(T.pow9(a), T.pow9(b)));
  assert.equal(T.pow9(2 ** 31 - 1), 1);
  assert.equal(T.pow9(2 * (2 ** 31 - 1) + 5), T.pow9(5));
  assert.notEqual(T.pow9(1), 1);
  // a balanced m-sequence: ones over 2³¹ − 1 bits are 2³⁰; over 400 000 bits within 0.5 %
  let ones = 0; for (let k = 31; k < N; k++) ones += E[k];
  assert.ok(Math.abs(ones / (N - 31) - 0.5) < 0.005);
});

test('the noise stream: each OS sample the mean of the bits inside it (0 / 15 V, less 7.5) at its absolute time; continuation = a jump; the salt an offset', () => {
  const D = D48(), T = D.proto.tr909;
  for (const [sr, os] of [[48000, 4], [44100, 2], [48000, 1]]) {
    const m = machine(lib(sr).D, { sr, os }), fs = sr * os, n0 = 4 * 48000 * 3600 + 12345 * os, n = 3000;
    let a = T.NZ9_F, b = fs; { let x = a, y = b; while (y) { const t = x % y; x = y; y = t; } a /= x; b /= x; }
    const out = new Float64Array(n), want = new Float64Array(n);
    m._nz(n0, n, out);
    const k0 = Math.floor(n0 * a / b), P = 31 + m._Q.off + k0, bits = bitsFrom(lib(sr).D.proto.tr909, P, Math.ceil(n * a / b) + 4);
    for (let i = 0; i < n; i++) {
      // bit positions [U0, U1) in units of 1 / b bit, relative to k0
      const U0 = (n0 + i) * a - k0 * b, U1 = U0 + a;
      let s = 0;
      for (let k = Math.floor(U0 / b); k * b < U1; k++) s += bits[k] * (Math.min(U1, (k + 1) * b) - Math.max(U0, k * b));
      want[i] = s / a * 15 - 7.5;
    }
    assert.ok(maxAbsDiff(out, want) < 1e-9, `${sr} × ${os}: ${maxAbsDiff(out, want)}`);
    // continuation in pieces = one call; a fresh jump into the middle = the same samples
    const m2 = machine(lib(sr).D, { sr, os }), p1 = new Float64Array(1000), p2 = new Float64Array(2000);
    m2._nz(n0, 1000, p1); m2._nz(n0 + 1000, 2000, p2);
    const m3 = machine(lib(sr).D, { sr, os }), p3 = new Float64Array(2000);
    m3._nz(n0 + 1000, 2000, p3);
    assert.ok(same(p1, out.subarray(0, 1000)) && same(p2, out.subarray(1000)) && same(p3, p2), 'pieces / jump');
  }
  // the salt: another offset into the sequence (uncorrelated streams)
  const ma = machine(D), mb = machine(D, { inst: { seedSalt: 7 } }), xa = new Float64Array(20000), xb = new Float64Array(20000);
  ma._nz(0, 20000, xa); mb._nz(0, 20000, xb);
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < 20000; i++) { sab += xa[i] * xb[i]; saa += xa[i] * xa[i]; sbb += xb[i] * xb[i]; }
  assert.ok(Math.abs(sab / Math.sqrt(saa * sbb)) < 0.05 && !same(xa, xb));
  // the level: ± 7.5 V bits; the mean over T = 1.5625 bits (OS 4) has the variance 56.25 (1 / T − 1 / 3T²) ≈ 28.3
  const v = saa / 20000, T5 = 300000 / 192000, want = 56.25 * (1 / T5 - 1 / (3 * T5 * T5));
  assert.ok(near(v, want, 0.08), `variance ${v.toFixed(1)} (${want.toFixed(1)})`);
});

test('one noise stream for the snare, the clap, the toms and the BD\'s click: their noise correlated as the hardware\'s (the salt decorrelates)', () => {
  const D = D48();
  const band = (y, a, b) => { // 0.8–8 kHz over [a, b) s
    const i0 = Math.round(a * FS), L = Math.round((b - a) * FS); let n = 1; while (n < L) n <<= 1;
    const re = new Float64Array(n), im = new Float64Array(n); for (let i = 0; i < L; i++) re[i] = y[i0 + i];
    fft(re, im, false);
    for (let k = 0; k < n; k++) { const f = (k <= n / 2 ? k : n - k) * FS / n; if (f < 800 || f > 8000) re[k] = im[k] = 0; }
    fft(re, im, true); return re.subarray(0, L);
  };
  const xc = (x, y) => { let best = 0; for (let l = -100; l <= 100; l += 1) { let s = 0, a = 0, b = 0; for (let i = 100; i < x.length - 100; i++) { s += x[i] * y[i + l]; a += x[i] * x[i]; b += y[i + l] * y[i + l]; } best = Math.max(best, Math.abs(s / Math.sqrt(a * b))); } return best; };
  const sd = band(hit1('sd', { drum: { sds: 1, sdl: 1 } }).y, 0.012, 0.04), cp = band(hit1('cp').y, 0.012, 0.04);
  const cp7 = band(render(machine(D, { inst: { seedSalt: 7 } }), { sec: 1, hits: [[0, SI('cp'), 100]] }).y, 0.012, 0.04);
  const a = xc(sd, cp), b = xc(sd, cp7);
  console.log(`# SD × HC noise (0.8–8 kHz, best lag ≤ 0.5 ms): same stream ${a.toFixed(3)}, another salt ${b.toFixed(3)}`);
  assert.ok(a > 0.3 && b < 0.15 && a > 3 * b, `${a} / ${b}`);
});

/* ---------------------------------------------------------------- target (a): the analog prototypes */
// the bridged-T's resonant part (btDesign, the 606's trapezoid in s-form): analog g s / (s² + 2 p s + p g), p = 1 / (R1 C),
// g = G / C; digital: X = ((z + 1) I − 2 M⁻¹)⁻¹ (z + 1) M⁻¹ [0, c8], the ring −(X0 + X1)
function btRing(c, C, R1, G, f, fs, dig) {
  if (!dig) { const w = 2 * Math.PI * f, p = 1 / (R1 * C), g = G / C; return g * w / Math.hypot(p * g - w * w, 2 * p * w); }
  const w = 2 * Math.PI * f / fs, zr = Math.cos(w) + 1, zi = Math.sin(w);
  const m00r = zr - 2 * c[0], m00i = zi, m01r = -2 * c[1], m10r = -2 * c[2], m11r = zr - 2 * c[3], m11i = zi;
  const r0r = zr * c[1] * c[8], r0i = zi * c[1] * c[8], r1r = zr * c[3] * c[8], r1i = zi * c[3] * c[8];
  const detr = m00r * m11r - m00i * m11i - m01r * m10r, deti = m00r * m11i + m00i * m11r;
  const a0r = r0r * m11r - r0i * m11i - m01r * r1r, a0i = r0r * m11i + r0i * m11r - m01r * r1i;
  const a1r = m00r * r1r - m00i * r1i - m10r * r0r, a1i = m00r * r1i + m00i * r1r - m10r * r0i;
  const sr = a0r + a1r, si = a0i + a1i, dd = detr * detr + deti * deti;
  return Math.hypot((sr * detr + si * deti) / dd, (si * detr - sr * deti) / dd);
}
test('target (a): each fixed block against its analog prototype — centres ± 1 %, magnitude ± 0.2 dB to 5 kHz at OS 4; the reconstruction ± 0.5 dB to 0.4 · the word rate', () => {
  const D = D48(), T = D.proto.tr909, m = machine(D), V = m._v, fs = FS, bad = [];
  const FR = [20, 50, 100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 4000, 5000];
  const chk = (name, dig, ana, fr = FR, tol = 0.2) => { for (const f of fr) { const e = dB(dig(f) / ana(f)); if (!(Math.abs(e) <= tol)) { bad.push(`${name} ${f} Hz ${e.toFixed(3)} dB`); return; } } };
  const W = f0 => 2 * Math.PI * f0, hp1 = fc => f => ha1(1 / W(fc), 0, 1 / W(fc), 1, f), lp1 = fc => f => ha1(0, 1, 1 / W(fc), 1, f);
  const lp2 = (f0, q) => f => ha2(0, 0, 1, 1 / W(f0) ** 2, 1 / (W(f0) * q), 1, f), hp2 = (f0, q) => f => ha2(1 / W(f0) ** 2, 0, 0, 1 / W(f0) ** 2, 1 / (W(f0) * q), 1, f);
  const bp2 = (f0, q) => f => ha2(0, 1 / (W(f0) * q), 0, 1 / W(f0) ** 2, 1 / (W(f0) * q), 1, f);
  // the centre of a resonant digital section: its peak by golden-section search near f0
  const centre = (h, f0) => { let a = 0.8 * f0, b = 1.2 * f0; for (let i = 0; i < 80; i++) { const c1 = b - 0.618 * (b - a), c2 = a + 0.618 * (b - a); if (h(c1) > h(c2)) b = c2; else a = c1; } return (a + b) / 2; };
  const B = T.BD9, S = T.SD9, M9 = T.TM9, R = T.RS9, H = T.HC9, C9 = T.ROMC9;
  chk('BD click SK', f => hz2(V.bd.ck, f, fs), lp2(B.FCK, B.QCK));
  if (!near(centre(f => hz2(V.bd.ck, f, fs), B.FCK), B.FCK * Math.sqrt(1 - 1 / (2 * B.QCK ** 2)), 0.01)) bad.push('BD click SK centre');
  chk('BD C2 / R_D', f => hz1(V.bd.cd, f, fs), f => ha1(B.C2 * B.RD, 0, B.C2 * B.RD, 1, f));
  chk('BD noise HP', f => hz1(V.bd.cnh, f, fs), hp1(B.FN1)); chk('BD noise LP', f => hz1(V.bd.cnl, f, fs), lp1(B.FN2));
  chk('SD 48 Hz', f => hz1(V.sd.ch1, f, fs), hp1(S.FH1)); chk('SD SK LP', f => hz2(V.sd.cl, f, fs), lp2(S.FL, S.QL));
  chk('SD 1.52 kHz', f => hz1(V.sd.ch2, f, fs), hp1(S.FH2)); chk('SD SK HP', f => hz2(V.sd.ch3, f, fs), hp2(S.FH3, S.QH3));
  for (const k of ['lt', 'mt', 'ht']) { chk(k + ' band HP', f => hz1(V[k].cnh, f, fs), hp1(M9.FH)); chk(k + ' band LP', f => hz1(V[k].cnl, f, fs), lp1(M9.FL)); }
  for (let k = 0; k < 3; k++) {
    const tau = R.T[k], g = W(R.F[k]) ** 2 * tau, c = V.rs.cr[k];
    chk('RS ring ' + R.F[k], f => btRing(c, R.C, tau / R.C, g * R.C, f, fs, true), f => btRing(c, R.C, tau / R.C, g * R.C, f, fs, false));
    if (!near(centre(f => btRing(c, R.C, tau / R.C, g * R.C, f, fs, true), R.F[k]), R.F[k], 0.01)) bad.push('RS ring centre ' + R.F[k]);
  }
  chk('RS SK HP', f => hz2(V.rs.chp, f, fs), f => ha2(R.HR1 * R.HR2 * R.HC ** 2, 0, 0, R.HR1 * R.HR2 * R.HC ** 2, 2 * R.HR1 * R.HC, 1, f));
  const fsk = 1 / (2 * Math.PI * R.HC * Math.sqrt(R.HR1 * R.HR2)), qsk = Math.sqrt(R.HR2 / R.HR1) / 2;
  if (!near(fsk, 229, 0.01) || !near(qsk, 1.58, 0.01)) bad.push(`RS SK HP ${fsk.toFixed(1)} Hz Q ${qsk.toFixed(3)}`);
  const rl = R.VR * 0.7 + 50; chk('RS LEVEL ∥ 220 p', f => hz1(V.rs.clv, f, fs), lp1(1 / (2 * Math.PI * rl * R.CL)));
  chk('HC band-pass', f => hz2(V.cp.cbp, f, fs), bp2(H.FBP, H.QBP));
  if (!near(centre(f => hz2(V.cp.cbp, f, fs), H.FBP), H.FBP, 0.01)) bad.push('HC centre');
  chk('HC 181 Hz', f => hz1(V.cp.ch1, f, fs), hp1(H.FH1)); chk('HC 1.94 kHz', f => hz1(V.cp.ch2, f, fs), hp1(H.FH2)); chk('HC 440 Hz', f => hz1(V.cp.cl, f, fs), lp1(H.FL));
  // the reconstruction (5.6 k / 5.6 k, 1200 p / 1000 p: 25.9 kHz Q 0.548; 2700 p / 390 p: 27.7 kHz Q 1.316) to 12 kHz ± 0.5 dB
  const skA = (C1, C2) => f => ha2(0, 0, 1, C9.R ** 2 * C1 * C2, 2 * C9.R * C2, 1, f), FR12 = [...FR, 6000, 8000, 10000, 12000];
  const f1 = 1 / (2 * Math.PI * C9.R * Math.sqrt(C9.C1A * C9.C2A)), f2 = 1 / (2 * Math.PI * C9.R * Math.sqrt(C9.C1B * C9.C2B));
  if (!near(f1, 25900, 0.01) || !near(f2, 27700, 0.01) || !near(Math.sqrt(C9.C1A / C9.C2A) / 2, 0.548, 0.01) || !near(Math.sqrt(C9.C1B / C9.C2B) / 2, 1.316, 0.01)) bad.push('the reconstruction\'s values');
  for (const k of ['hh', 'cr', 'rd']) { chk(k + ' SK 1', f => hz2(V[k].r1, f, fs), skA(C9.C1A, C9.C2A), FR12, 0.5); chk(k + ' SK 2', f => hz2(V[k].r2, f, fs), skA(C9.C1B, C9.C2B), FR12, 0.5); }
  const t134 = C9.C134 * C9.R134;
  chk('hats C134', f => hz1(V.hh.co, f, fs), f => ha1(t134, 0, t134, 1, f));
  if (!near(1 / (2 * Math.PI * t134), 723, 0.01)) bad.push('C134 ≈ 723 Hz');
  // the output stage at the base rate: the DC coupling, the jack's 1 k / 0.01 µ (15.9 kHz)
  const X = T.MIX9, fj = 1 / (2 * Math.PI * X.RJ * X.CJ);
  chk('out DC', f => hz1(m._ost.c1, f, 48000), hp1(X.HC_F));
  chk('out jack', f => hz1(m._ost.c4, f, 48000), lp1(fj));
  if (!near(fj, 15900, 0.01)) bad.push('the jack\'s pole');
  assert.deepEqual(bad, []);
});

test('target (a): the envelopes\' and the pitch envelopes\' time constants ± 2 % against their RC (BD C9 / C8, SD ENV2–4 and the bend, the toms, RS, the clap\'s swell, the hats\' C135)', () => {
  const D = D48(), T = D.proto.tr909, bad = [], RW = 50, ta = T.tapA9;
  const chk = (name, got, want) => { if (!near(got, want, 0.02)) bad.push(`${name}: ${(got * 1e3).toFixed(2)} ms vs ${(want * 1e3).toFixed(2)}`); };
  const B = T.BD9;
  for (const u of [0, 0.5, 1]) {
    const m = machine(D, { drum: { bdu: u, bdd: u } });
    const v9 = trace(m, 0.5, mm => mm._v.bd.v9, [[0, 0, 100]]), e1 = trace(machine(D, { drum: { bdd: u } }), 0.8, mm => mm._v.bd.e1, [[0, 0, 100]]);
    chk(`BD C9 TUNE ${u}`, tauOf(v9, 30, 30 + 300 * (u + 0.2)), B.C9 * par(B.R57 + B.VR2 * ta(u) + RW, B.RP));
    const i0 = Math.ceil(B.HOLD * 12000) + 2;
    chk(`BD C8 DECAY ${u}`, tauOf(e1, i0, i0 + 400, 0), B.C8 * par(B.R58 + B.VR5 * ta(u) + RW, B.R54));
  }
  const S = T.SD9;
  { const m = machine(D), tr = trace(m, 0.3, mm => [mm._v.sd.e2, mm._v.sd.e3, mm._v.sd.vb], [[0, 1, 100]]);
    chk('SD ENV2', tauOf(tr.map(x => x[0]), 30, 400), S.TE2); chk('SD ENV3', tauOf(tr.map(x => x[1]), 30, 400), S.TE3); chk('SD bend', tauOf(tr.map(x => x[2]), 30, 200), S.TBD); }
  for (const u of [0, 1]) {
    const m = machine(D, { drum: { sdt: u } }), tr = trace(m, 0.3, mm => mm._v.sd.e4, [[0, 1, 100]]), rt = S.RT4 + S.VR7 * u + RW;
    const ve = m._v.sd.vEnd, i0 = Math.ceil(S.HOLD4 * 12000) + 2;
    chk(`SD ENV4 TONE ${u}`, tauOf(tr, i0, i0 + 200, ve), S.C4 * par(S.RF4, rt));
    if (!near(ve, -S.RHO * (T.vAcc9(21) - 1.2 + S.D) * S.RF4 / (S.RF4 + rt), 1e-9)) bad.push('SD V_end');
  }
  const P = T.TM9;
  for (let k = 0; k < 3; k++) {
    const nm = ['lt', 'mt', 'ht'][k], Q = T.TOM9[k];
    for (const u of [0, 1]) {
      const m = machine(D, { drum: { [nm + 'd']: u } }), tr = trace(m, 0.6, mm => { const v = mm._v[nm]; return [v.e1, v.e2, v.e3, v.pa, v.pb]; }, [[0, 2 + k, 100]]);
      if (u === 0) { chk(nm + ' ENV1', tauOf(tr.map(x => x[0]), 30, 1500), Q.T1); chk(nm + ' ENV3', tauOf(tr.map(x => x[2]), 30, 500), Q.T3); chk(nm + ' 22 ms', tauOf(tr.map(x => x[3]), 30, 500), P.TPA); chk(nm + ' 220 ms', tauOf(tr.map(x => x[4]), 30, 3000), P.TPB); }
      chk(`${nm} ENV2 DECAY ${u}`, tauOf(tr.map(x => x[1]), 30, 1000), Q.C2 * (P.RD2 + P.VRD * u + RW));
    }
  }
  { const tr = trace(machine(D), 0.1, mm => mm._v.rs.ev, [[0, 5, 100]]); chk('RS Q65', tauOf(tr, 30, 600), T.RS9.TV); }
  { const H = T.HC9, tr = trace(machine(D), 0.5, mm => mm._v.cp.eb, [[0, 6, 100]]), ip = tr.indexOf(Math.max(...tr)), tp = H.TT1 * H.TT2 / (H.TT1 - H.TT2) * Math.log(H.TT1 / H.TT2);
    if (Math.abs(ip * 4 / 48000 - tp - 0.001) > 0.002) bad.push(`HC swell peak ${(ip / 12).toFixed(1)} ms vs ${(tp * 1e3).toFixed(1)} (R9: 25–30 ms)`);
    if (!(tp > 0.025 && tp < 0.030)) bad.push('the swell\'s peak outside R9\'s 25–30 ms');
    chk('HC fall', tauOf(tr, 3000, 5000), H.TT1); }
  const Hh = T.HH9;
  for (const u of [0, 0.5, 1]) {
    const ro = Hh.R452 + Hh.VR23 * ta(u) + RW, rc = Hh.R451 + Hh.VR21 * u + RW;
    const to = trace(machine(D, { drum: { ohd: u } }), 0.6, mm => mm._v.hh.v, [[0, 9, 100]]), tc = trace(machine(D, { drum: { chd: u, ohd: u } }), 0.4, mm => mm._v.hh.v, [[0, 10, 100]]);
    chk(`OH C135 DECAY ${u}`, tauOf(to, 40, 2000), Hh.C135 * ro); chk(`CH C135 DECAY ${u}`, tauOf(tc, 40, 400), Hh.C135 * par(ro, rc));
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- target (b): R9's numbers, circuit by circuit */
// the Vp-p at LEVEL 5 of one hit on the multi-out (the bus over the voice's mono share): normal, and TOTAL ACCENT 0 → 10 (a step)
function vpp(D, s, { ac = 1, drum = {} } = {}) {
  const w = D.proto.tr909.MIX9.W[[0, 1, 2, 3, 4, 5, 6, 9, 8, 7, 7][SI(s)]], lv = { [LEV[s]]: 0.5 };
  const n = render(machine(D, { drum: Object.assign({ ac: 0 }, lv, drum) }), { sec: 1.2, hits: [[0, step(s, 0, 0)]] }).y;
  const a = render(machine(D, { drum: Object.assign({ ac }, lv, drum) }), { sec: 1.2, hits: [[0, step(s, 1, 0)]] }).y;
  return { n: pp(n) / w, a: pp(a) / w, yn: n, ya: a };
}
// the frequency of a sweep: upward crossings after t0 → (time, 1 / period) pairs, fitted f = Fb + dF e^(−t/τ)
function sweep(y, fs, t0, t1) {
  const xs = [];
  for (let i = Math.round(t0 * fs) + 1; i < t1 * fs; i++) if (y[i - 1] < 0 && y[i] >= 0) xs.push((i - 1 - y[i - 1] / (y[i] - y[i - 1])) / fs);
  const pts = []; for (let k = 1; k < xs.length; k++) pts.push([(xs[k] + xs[k - 1]) / 2, 1 / (xs[k] - xs[k - 1])]);
  let best = null;
  for (let tau = 0.002; tau < 0.08; tau += 0.0001) {
    let a = 0, b = 0, c = 0, d = 0; const n = pts.length;
    for (const [t, f] of pts) { const x = Math.exp(-t / tau); a += x; b += x * x; c += f; d += f * x; }
    const det = n * b - a * a, Fb = (c * b - a * d) / det, dF = (n * d - a * c) / det;
    let r = 0; for (const [t, f] of pts) r += (f - Fb - dF * Math.exp(-t / tau)) ** 2;
    if (!best || r < best.r) best = { r, tau, Fb, dF };
  }
  return best;
}
test('target (b) BD: 49.5 Hz, the sweep (≈ +230 Hz, τ 7.6 / 29 ms at TUNE 0 / 10), the shaper\'s harmonics, DECAY\'s −20 dB, the click, accent +6.2 dB, 0.61 Vp-p', () => {
  const D = D48(), bad = [], out = [];
  for (const u of [0, 0.5, 1]) {
    const y = render(machine(D, { drum: { bdu: u, bdd: 1, bda: 0 } }), { sec: 1, hits: [[0, 0, 100]] }).y;
    const f = zcF(y, FS, 0.4, 0.8), s = u === 0.5 ? null : sweep(y, FS, 0.0025, 0.3);
    if (!near(f, 49.5, 0.03)) bad.push(`TUNE ${u}: ${f.toFixed(2)} Hz`);
    if (s) {
      const d2 = s.dF * Math.exp(-0.002 / s.tau), tw = u === 0 ? 0.0076 : 0.0291;
      out.push(`TUNE ${u}: Δf ${d2.toFixed(0)} Hz at the pulse's end, τ ${(s.tau * 1e3).toFixed(1)} ms`);
      if (!(d2 > 216 * 0.97 && d2 < 247 * 1.03)) bad.push(`Δf ${d2}`);
      if (!near(s.tau, tw, 0.15)) bad.push(`τ ${s.tau} vs ${tw}`);
    }
  }
  const yh = render(machine(D, { drum: { bdu: 0, bdd: 1 } }), { sec: 1, hits: [[0, 0, 100]] }).y, f0 = zcF(yh, FS, 0.3, 0.7), H = harm(yh, FS, f0, 0.3, 0.7, [2, 3, 5]);
  out.push(`H2 / H3 / H5 ${H.map(x => x.toFixed(1)).join(' / ')} dB`);
  if (Math.abs(H[0] + 28) > 3 || Math.abs(H[1] + 25.7) > 3 || Math.abs(H[2] + 41) > 6) bad.push('harmonics ' + H);
  const t20 = [0, 0.5, 1].map(u => decay(render(machine(D, { drum: { bdd: u } }), { sec: 1, hits: [[0, 0, 100]] }).y, FS, 20));
  out.push(`−20 dB ${t20.map(t => (t * 1e3).toFixed(0)).join(' / ')} ms`);
  [0.096, 0.173, 0.2985].forEach((w, i) => { if (!near(t20[i], w, 0.15)) bad.push(`DECAY ${i * 5}: ${t20[i]}`); });
  // the click (a noise burst: its mean over 8 salts): its peak within the trigger (MW1: 1.5–1.6 ms), ≈ 7 dB under the hit's
  // peak (the body starts at the trigger's end); ATTACK raises its share, monotone
  let cdb = 0, ct = 0;
  for (let salt = 0; salt < 8; salt++) {
    const y5 = render(machine(D, { inst: { seedSalt: salt } }), { sec: 0.2, hits: [[0, 0, 100]] }).y, e = env(y5, FS, 0.0002);
    let cp = 0, t = 0; for (let i = 0; i < 10; i++) if (e[i] > cp) { cp = e[i]; t = (i + 0.5) * 0.2; }
    cdb += dB(cp / absMax(y5)) / 8; ct += t / 8;
  }
  out.push(`the click at ${ct.toFixed(2)} ms, ${cdb.toFixed(1)} dB re the hit (8 salts)`);
  if (!(ct > 1 && ct < 2) || Math.abs(cdb + 7) > 3) bad.push('the click');
  const share = [0, 0.25, 0.5, 0.75, 1].map(a => { const y = render(machine(D, { drum: { bda: a } }), { sec: 0.05, hits: [[0, 0, 100]] }).y; let p = 0, q = 0; for (let i = 0; i < 0.003 * FS; i++) p += y[i] * y[i]; for (let i = 0.003 * FS; i < 0.033 * FS; i++) q += y[i] * y[i]; return p / q; });
  if (!share.every((x, i) => i === 0 || x > share[i - 1])) bad.push('ATTACK ' + share);
  const L = vpp(D, 'bd');
  out.push(`${L.n.toFixed(3)} / ${L.a.toFixed(3)} Vp-p (+${dB(L.a / L.n).toFixed(2)} dB)`);
  if (Math.abs(dB(L.a / L.n) - 6.2) > 2 || Math.abs(dB(L.n / 0.61)) > 2) bad.push('level / accent');
  console.log('# BD:', out.join('; '));
  assert.deepEqual(bad, []);
});

test('target (b) SD: VCO-1 117–231 Hz over TUNE, VCO-2 × 1.500, the bend, TONE\'s −40 dB 99 / 295 ms, SNAPPY linear, accent +4.8 dB (a longer snappy), +3.6 dB re the BD', () => {
  const D = D48(), bad = [], out = [], T = D.proto.tr909;
  const want = [117.4, 144.7, 173.5, 200.9, 230.7];
  [0, 0.25, 0.5, 0.75, 1].forEach((u, i) => {
    const y = render(machine(D, { drum: { sdu: u, sds: 0 } }), { sec: 0.3, hits: [[0, 1, 100]] }).y;
    const f1 = peakF(y, FS, 0.85 * want[i], 1.15 * want[i], 0.04, 0.2), f2 = peakF(y, FS, 1.4 * want[i], 1.6 * want[i], 0.04, 0.2);
    out.push(`${f1.toFixed(1)} / ${f2.toFixed(1)}`);
    if (!near(f1, want[i], 0.03) || !near(f2 / f1, 1.5, 0.01)) bad.push(`TUNE ${u}`);
  });
  // the bend: VCO-1 at the trigger's end ≈ +216 Hz over TUNE, whatever TUNE and accent
  for (const [u, v] of [[0, 100], [1, 127]]) { const tr = trace(machine(D, { drum: { sdu: u } }), 0.003, mm => mm._v.sd.vb * T.SD9.BEND, [[0, 1, v]]); const b = Math.max(...tr); if (!near(b, 216, 0.03)) bad.push('bend ' + b); }
  // TONE: the noise part (the voice less its tone alone, SNAPPY 10) −40 dB at TONE 0 / 10; accented longer
  const nz = (drum, st) => { const a = render(machine(D, { drum: Object.assign({ sds: 1 }, drum) }), { sec: 0.6, hits: [[0, st]] }).y, b = render(machine(D, { drum: Object.assign({}, drum, { sds: 0 }) }), { sec: 0.6, hits: [[0, st]] }).y; return a.map((x, i) => x - b[i]); };
  const t40 = [0, 1].map(u => decay(nz({ sdt: u }, step('sd', 0, 0)), FS, 40)), t40a = decay(nz({ sdt: 0.5, ac: 1 }, step('sd', 1, 1)), FS, 40), t40n = decay(nz({ sdt: 0.5 }, step('sd', 0, 0)), FS, 40);
  out.push(`TONE −40 dB ${t40.map(t => (t * 1e3).toFixed(0)).join(' / ')} ms (accented at 5: ${(t40a * 1e3).toFixed(0)} vs ${(t40n * 1e3).toFixed(0)})`);
  if (!near(t40[0], 0.099, 0.15) || !near(t40[1], 0.295, 0.15) || !(t40a > t40n)) bad.push('TONE');
  const sn = [0.25, 0.5, 1].map(u => rmsW(nz({ sds: u }, step('sd', 0, 0)), FS, 0, 0.1));
  if (!near(sn[1] / sn[0], 2, 0.01) || !near(sn[2] / sn[0], 4, 0.01)) bad.push('SNAPPY ' + sn);
  const L = vpp(D, 'sd'), Lb = vpp(D, 'bd');
  out.push(`+${dB(L.a / L.n).toFixed(2)} dB accent, ${dB(L.n / Lb.n).toFixed(2)} dB re the BD`);
  if (Math.abs(dB(L.a / L.n) - 4.8) > 2 || Math.abs(dB(L.n / Lb.n) - 3.6) > 2) bad.push('level / accent');
  console.log('# SD: VCO-1 / VCO-2', out.join('; '));
  assert.deepEqual(bad, []);
});

test('target (b) toms: VCO-1 at TUNE 0 / 5 / 10, 25–38 % sharp at the start, DECAY\'s −20 dB, accent +7.3 / 7.7 / 7.4 dB, the levels re the BD', () => {
  const D = D48(), T = D.proto.tr909, bad = [], out = [], Lb = vpp(D, 'bd');
  const tg = { lt: [165, 213, 7.3, -0.6], mt: [103, 138, 7.7, 0.3], ht: [108, 160, 7.4, 0.4] };
  ['lt', 'mt', 'ht'].forEach((s, k) => {
    const F = T.TOM9[k].F, o = [];
    [0, 0.5, 1].forEach((u, i) => { const y = render(machine(D, { drum: { [s + 'u']: u, [s + 'd']: 1 } }), { sec: 1.2, hits: [[0, 2 + k, 100]] }).y; const f = peakF(y, FS, 0.85 * F[i], 1.15 * F[i], 0.6, 1.1); o.push(f.toFixed(1)); if (!near(f, F[i], 0.03)) bad.push(`${s} TUNE ${u}: ${f}`); });
    const tr = trace(machine(D), 0.004, mm => { const v = mm._v[s]; return v.pa * T.TM9.PA + v.pb * T.TM9.PB; }, [[0, 2 + k, 100]]), sh = Math.max(...tr);
    if (!(sh >= 0.25 && sh <= 0.38)) bad.push(`${s} sharp ${sh}`);
    const t20 = [0, 1].map(u => decay(render(machine(D, { drum: { [s + 'd']: u } }), { sec: 0.6, hits: [[0, 2 + k, 100]] }).y, FS, 20) * 1e3);
    if (!near(t20[0], tg[s][0], 0.15) || !near(t20[1], tg[s][1], 0.15)) bad.push(`${s} −20 dB ${t20}`);
    const L = vpp(D, s);
    if (Math.abs(dB(L.a / L.n) - tg[s][2]) > 2 || Math.abs(dB(L.n / Lb.n) - tg[s][3]) > 2) bad.push(`${s} level / accent`);
    out.push(`${s} ${o.join(' / ')} Hz, +${(sh * 100).toFixed(0)} %, −20 dB ${t20.map(t => t.toFixed(0)).join(' / ')} ms, accent +${dB(L.a / L.n).toFixed(2)} dB, ${dB(L.n / Lb.n).toFixed(2)} dB re BD`);
  });
  console.log('# toms:', out.join('; '));
  assert.deepEqual(bad, []);
});

test('target (b) RS and HC: three rings (220 / 488 / 1036 Hz, 9.6 / 4.6 / 2.9 ms) into ± 0.6 V diodes; the clap\'s bursts 0 / 9.8 / 21.5 / 31.4 ms and its swelling tail; accents +3.9 / +2.7 dB; levels', () => {
  const D = D48(), T = D.proto.tr909, R = T.RS9, bad = [], out = [], Lb = vpp(D, 'bd');
  // the rings: each resonator's poles (s² + 2ps + pg: ω_d, 1 / p) — the design's own; the clip
  for (let k = 0; k < 3; k++) { const p = 1 / R.T[k], g = (2 * Math.PI * R.F[k]) ** 2 * R.T[k], fd = Math.sqrt(p * g - p * p) / (2 * Math.PI); if (!near(fd, [220, 488, 1036][k], 0.03)) bad.push('ring ' + fd); }
  const clip = T.dsh(20);
  if (!(clip > 0.5 && clip < 0.65)) bad.push('clip ' + clip);
  const y = render(machine(D), { sec: 0.1, hits: [[0, 5, 100]] }).y;
  const fl = peakF(y, FS, 150, 300, 0, 0.04), fm = peakF(y, FS, 400, 600, 0, 0.04), fh = peakF(y, FS, 800, 1300, 0, 0.04);
  if (!near(fl, 220, 0.03) || !near(fm, 488, 0.03) || !near(fh, 1036, 0.03)) bad.push(`RS peaks ${fl} / ${fm} / ${fh}`);
  const Lr = vpp(D, 'rs'), kr = (T.vAcc9(43) - 1.2 + R.D) / (T.vAcc9(21) - 1.2 + R.D);
  if (!near(rmsW(Lr.ya, FS, 0, 0.1) / rmsW(Lr.yn, FS, 0, 0.1), kr, 0.02)) bad.push('RS: accent a level');
  if (Math.abs(dB(Lr.a / Lr.n) - 3.9) > 2 || Math.abs(dB(Lr.n / Lb.n) - 0.3) > 2) bad.push('RS level / accent');
  out.push(`RS ${fl.toFixed(0)} / ${fm.toFixed(0)} / ${fh.toFixed(0)} Hz, clip ± ${clip.toFixed(2)} V, accent +${dB(Lr.a / Lr.n).toFixed(2)} dB, ${dB(Lr.n / Lb.n).toFixed(2)} dB re BD`);
  // the clap: the bursts' peaks near their onsets (± 1.5 ms), the tail still sounding at 60–90 ms, accent on the bursts only
  const Lc = vpp(D, 'cp'), e = env(Lc.yn, FS, 0.0005), pk = [];
  for (const t of [0, 9.8, 21.5, 31.4]) { let best = 0, bt = 0; for (let i = Math.round(t / 0.5); i < Math.round((t + 4) / 0.5); i++) if (e[i] > best) { best = e[i]; bt = i * 0.5; } pk.push(bt); if (!(bt >= t && bt <= t + 3)) bad.push(`burst ${t}: ${bt}`); }
  const tail = rmsW(Lc.yn, FS, 0.06, 0.09) / absMax(Lc.yn);
  if (!(dB(tail) > -30)) bad.push('the tail ' + dB(tail));
  const sA = spec(Lc.ya, FS, 0.15), sN = spec(Lc.yn, FS, 0.15);
  if (!(corr(sA, sN) < 0.999)) bad.push('the clap\'s accent: a timbre (the bursts only)');
  if (Math.abs(dB(Lc.a / Lc.n) - 2.7) > 2 || Math.abs(dB(Lc.n / Lb.n) - 9.0) > 2 || Math.abs(dB(Lc.n / 2)) > 2) bad.push('HC level / accent');
  out.push(`HC bursts at ${pk.join(' / ')} ms, tail at 60–90 ms ${dB(tail).toFixed(1)} dB, accent +${dB(Lc.a / Lc.n).toFixed(2)} dB, ${Lc.n.toFixed(2)} Vp-p (${dB(Lc.n / Lb.n).toFixed(2)} dB re BD)`);
  console.log('#', out.join('; '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- the ROM path (§2.3) */
// the 2-point polyBLEP staircase (engine.js renderDac's method) computed independently: word k at k / dw OS samples after the
// trigger's sample, each step at its fractional time, one sample late; then the droop compensation [−1, 14, −1] / 12 (one
// more); the held word before the trigger `h0`
function blepRef(codes, dw, n, i0, h0 = 32) {
  const y = new Float64Array(n);
  let hold = h0, pend = h0 - 32, k = 0, q1 = h0 - 32, q2 = h0 - 32;
  for (let i = 0; i < n; i++) {
    let x = h0 - 32;
    if (i >= i0) {
      let cP = 0, cC = 0;
      const W = (i - i0) * dw;
      while (k < codes.length && k <= W) { const D = codes[k] - hold, d = (W - k) / dw, u = 1 - d; hold = codes[k]; cP += 0.5 * D * d * d; cC -= 0.5 * D * u * u; k++; }
      x = pend + cP; pend = hold - 32 + cC;
    }
    y[i] = q1 + (2 * q1 - x - q2) * (1 / 12); q2 = q1; q1 = x;
  }
  return y;
}
test('the ROM path: the word clock from the trigger (the hats 30 kHz, crash / ride TUNE × 2.46, monotone), each step at its fractional time, the DAC\'s levels exact, the region\'s end held and blocked', () => {
  const D = D48(), T = D.proto.tr909, C = T.ROMC9, bad = [], out = [];
  const rate = (s, drum) => { const m = machine(D, { drum }); render(m, { sec: 0.3, hits: [[0, SI(s), 100]] }); const v = m._v[VKEY[s]]; return { got: (v.nx - 1) / ((0.3 * FS - 1) / FS), want: v.dw * FS }; };
  const h = rate('oh', {});
  if (Math.abs(h.got / 30000 - 1) > 0.001 || h.want !== C.KCK / (C.RH * C.C) / 2) bad.push('hats ' + h.got);
  for (const s of ['cr', 'rd']) {
    const r = [0, 0.5, 1].map(u => rate(s, { [s === 'cr' ? 'cru' : 'rdu']: u }));
    r.forEach((x, i) => { const u = i / 2, w = C.KCK / ((C.RT0 + C.VRT * (1 - u) + 50) * C.C) * C.LATE / 2; if (Math.abs(x.got / w - 1) > 0.001) bad.push(`${s} ${u}: ${x.got} vs ${w}`); });
    if (!(r[0].got < r[1].got && r[1].got < r[2].got) || !near(r[2].got / r[0].got, 16.85 / 6.85, 0.01) || !near(r[1].got, 30000, 0.05)) bad.push(s + ' TUNE');
    out.push(`${s} ${r.map(x => (x.got / 1e3).toFixed(2)).join(' / ')} kHz`);
  }
  console.log(`# word clocks: hats ${(h.got / 1e3).toFixed(3)} kHz, ${out.join(', ')} (TUNE 0 / 5 / 10)`);
  // each step at its fractional time (the DAC alone): a hit at frame 4000, the bytes = the independent BLEP staircase
  for (const [s, k, img] of [['cr', 'cr', ROM.cr], ['oh', 'hh', ROM.hh], ['ch', 'hh', ROM.hh]]) {
    const m = machine(D, { opt: { rom: ROM, dacTap: true }, drum: { cru: 0.3 } });
    const y = render(m, { sec: 0.2, hits: [[4000, SI(s), 100]] }).y, a0 = s === 'ch' ? 24576 : 0;
    const ref = blepRef(img.subarray(a0, a0 + 9000), m._v[VKEY[s]].dw, y.length, 16000);
    for (let i = 0; i < y.length; i++) ref[i] *= T.DAC9V;
    if (!(maxAbsDiff(y, ref) < 1e-6)) bad.push(`${s}: the staircase ${maxAbsDiff(y, ref)}`);   // (W summed, not multiplied: ulps)
  }
  // the DAC's levels: blocks of one code → (code − 32) · 5 / 63 V, exactly; the end: the last word held (the DAC), blocked
  const blk = new Uint8Array(32768).fill(32), codes = [0, 63, 17, 48, 32, 5];
  codes.forEach((c, j) => blk.fill(c, j * 2000, (j + 1) * 2000));
  blk[32767] = 40;
  const md = machine(D, { opt: { rom: { hh: ROM.hh, cr: blk, rd: blk }, dacTap: true, noSleep: true } }), yd = render(md, { sec: 1.4, hits: [[0, SI('cr'), 100]] }).y;
  const dw = md._v.cr.dw;
  codes.forEach((c, j) => { const i = Math.round((j * 2000 + 1000) / dw); if (yd[i] !== (c - 32) * T.DAC9V) bad.push(`code ${c}: ${yd[i]}`); });
  if (yd[yd.length - 1] !== 8 * T.DAC9V || md._v.cr.go !== false || md._v.cr.nx !== 32768) bad.push('the end: the last word held');
  const mf = machine(D, { opt: { rom: { hh: ROM.hh, cr: blk, rd: blk } } }), yf = render(mf, { sec: 4, hits: [[0, SI('cr'), 100]] }).y;
  if (!(absMax(yf.subarray(Math.round(3.5 * FS))) < 1e-4)) bad.push('the held word blocked by the couplings ' + absMax(yf.subarray(Math.round(3.5 * FS))));
  assert.deepEqual(bad, []);
});

// (the 2-point kernel's own error is its in-band droop, sinc² — linear, not aliasing: compensated by a 3-tap correction, the
// error falls from −35…−43 dB to the aliasing alone, ≈ −63…−77 dB, so the gate is held at −50 dB, past review #4's −35)
test('the staircase\'s alias gate (review #4): against the exact band-limited staircase, the error in 0–20 kHz at OS 4 ≤ −50 dB re the signal and ≥ 15 dB below a naive hold (the mutation)', () => {
  const naive = SRC.replace('if (D !== 0) { const d = (W - nx) / dw, u = 1 - d; hc = cd; cP += 0.5 * D * d * d; cC -= 0.5 * D * u * u; }', 'if (D !== 0) { hc = cd; cP += D; }');
  assert.notEqual(naive, SRC, 'the mutation applies');
  const DB = D48(), DN = lib(48000, naive, 'naive').D, T = DB.proto.tr909;
  // the integrated Kaiser-windowed sinc (cut at fs / 2, half-length 48 samples): each step's exact band-limited form
  const HL = 48, TBN = 2048, Bt = new Float64Array(2 * HL * TBN + 2);
  { const I0 = x => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / 2) ** 2 / (k * k); s += t; } return s; };
    let acc = 0; for (let i = 0; i < Bt.length; i++) { const x = i / TBN - HL, r = x / HL, sn = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x), w = Math.abs(r) < 1 ? I0(9 * Math.sqrt(1 - r * r)) / I0(9) : 0; acc += sn * w / TBN; Bt[i] = acc; }
    for (let i = 0; i < Bt.length; i++) Bt[i] /= acc; }
  const Bx = x => { if (x <= -HL) return 0; if (x >= HL) return 1; const t = (x + HL) * TBN, i = t | 0; return Bt[i] + (Bt[i + 1] - Bt[i]) * (t - i); };
  function err(D, img, s, drum, dl) {
    const m = machine(D, { opt: { rom: { hh: img, cr: img, rd: img }, dacTap: true }, drum }), y = render(m, { sec: 0.4, hits: [[0, SI(s), 100]] }).y;
    const dw = m._v[VKEY[s]].dw, N = y.length, ref = new Float64Array(N), r0 = s === 'ch' ? 24576 : 0, cnt = s === 'ch' ? 8192 : s === 'oh' ? 24576 : 32768;
    let prev = 32;
    for (let k = 0; k < cnt; k++) {
      const t = k / dw; if (t > N + HL) break;
      const Dd = (img[r0 + k] - prev) * T.DAC9V; prev = img[r0 + k]; if (!Dd) continue;
      const a = Math.max(0, Math.floor(t + dl - HL)), b = Math.min(N, Math.ceil(t + dl + HL));
      for (let i = a; i < b; i++) ref[i] += Dd * Bx(i - t - dl);
      for (let i = b; i < N; i++) ref[i] += Dd;
    }
    const a0 = Math.round(0.01 * FS), n = 1 << Math.floor(Math.log2(N - a0)), re = new Float64Array(n), im = new Float64Array(n), rr = new Float64Array(n), ri = new Float64Array(n);
    for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); re[i] = (y[a0 + i] - ref[a0 + i]) * w; rr[i] = ref[a0 + i] * w; }
    fft(re, im, false); fft(rr, ri, false);
    let e = 0, sg = 0; for (let k = 1; k < 20000 * n / FS; k++) { e += re[k] ** 2 + im[k] ** 2; sg += rr[k] ** 2 + ri[k] ** 2; }
    return 10 * Math.log10(e / sg);
  }
  const R = T.rom9(), imgs = [['stand-in white', standIn(32768, 13, 0.98)], ['stand-in crash', ROM.cr], ['stand-in ride', ROM.rd]];
  const filled = !R.cr.every(c => c === 32);
  if (filled) imgs.push(['block hh', R.hh], ['block cr', R.cr], ['block rd', R.rd]);
  const bad = [], out = [];
  const OWN = { 'block hh': [['oh', {}], ['ch', {}]], 'block cr': [['cr', { cru: 0 }], ['cr', { cru: 0.5 }], ['cr', { cru: 1 }]], 'block rd': [['rd', { rdu: 0 }], ['rd', { rdu: 0.5 }], ['rd', { rdu: 1 }]] };
  for (const [name, img] of imgs) {
    for (const [s, drum] of OWN[name] || [['oh', {}], ['cr', { cru: 0 }], ['cr', { cru: 0.5 }], ['cr', { cru: 1 }]]) {
      const b = err(DB, img, s, drum, 2), nv = err(DN, img, s, drum, 1.5);
      const tu = drum.cru !== undefined ? drum.cru : drum.rdu;
      out.push(`${name} ${s}${tu !== undefined ? ' TUNE ' + tu * 10 : ''}: ${b.toFixed(1)} (naive ${nv.toFixed(1)})`);
      if (!(b <= -50 && nv - b >= 15)) bad.push(out[out.length - 1]);
    }
  }
  console.log('# the staircase\'s error re the signal, 0–20 kHz, dB:', out.join('; '));
  assert.deepEqual(bad, []);
});

test('the hats are one voice (a CH restarts the counter in the closed region and switches C135\'s path; OH + CH in one chunk = the closed hat); the cymbals\' staircase; accent on the ROM voices', () => {
  const D = D48(), T = D.proto.tr909, bad = [], out = [];
  // a CH 100 ms into a ringing OH: the counter in the closed region from the CH's chunk, C135 recharged from its level and on
  // the closed path; the open sound gone (the depth against the free OH recorded)
  const free = render(machine(D, { drum: { ohd: 1 } }), { sec: 0.5, hits: [[0, SI('oh'), 100]] }).y;
  const m = machine(D, { drum: { ohd: 1 } }), ck = render(m, { sec: 0.5, hits: [[0, SI('oh'), 100], [4800, SI('ch'), 100]] }).y;
  const hv = m._v.hh;
  if (!(hv.closed && hv.a0 === 24576 && hv.cnt === 8192)) bad.push('the closed region');
  const tr = trace(machine(D, { drum: { ohd: 1 } }), 0.2, mm => mm._v.hh.v, [[0, SI('oh'), 100], [4800, SI('ch'), 100]]);
  const vAt = tr[1199], vPk = Math.max(...tr.slice(1200, 1260));
  if (!(vPk > vAt * 0.999 && vPk <= T.HH9.VHH)) bad.push('C135 recharged from its level');
  const lone = render(machine(D, { drum: { ohd: 1 } }), { sec: 0.4, hits: [[0, SI('ch'), 100]] }).y;
  const depth = dB(rmsW(ck, FS, 0.2, 0.3) / rmsW(free, FS, 0.2, 0.3)), vsCH = dB(rmsW(ck, FS, 0.2, 0.3) / rmsW(lone, FS, 0.1, 0.2));
  if (!(depth < -12 && Math.abs(vsCH) < 1.5)) bad.push(`the open sound gone: ${depth} dB, ${vsCH} dB re a lone CH`);
  out.push(`a CH 100 ms into an OH (OH DECAY 10, CH DECAY 5): ${depth.toFixed(1)} dB re the free OH 100–200 ms after it, ${vsCH.toFixed(2)} dB re a lone CH`);
  // OH + CH latched in one chunk: the closed hat, byte for byte
  const both = render(machine(D), { sec: 0.4, hits: [[400, SI('oh'), 100], [400, SI('ch'), 100]] }).y, ch = render(machine(D), { sec: 0.4, hits: [[400, SI('ch'), 100]] }).y;
  if (!same(both, ch)) bad.push('OH + CH ≠ CH');
  // the cymbals' staircase: the VCA's gain the step of the word on the latch (A9…A14), stretched by TUNE
  for (const u of [0, 1]) {
    const mc = machine(D, { drum: { cru: u } }), st = trace(mc, 0.8, mm => [mm._v.cr.sg, mm._v.cr.nx], [[0, SI('cr'), 100]]);
    for (const [g, nx] of st) if (nx > 0 && g !== T.ENV9.cr[(nx - 1) >> 9]) { bad.push(`staircase at word ${nx}`); break; }
  }
  // accent on the hats and cymbals: the converters' e^(KX · ΔV) — the total accent (code 32) over the normal (21), level only
  for (const s of ['oh', 'ch', 'cr', 'rd']) {
    const n = render(machine(D), { sec: 0.3, hits: [[0, SI(s), 100]] }).y, a = render(machine(D), { sec: 0.3, hits: [[0, SI(s), 119]] }).y;
    const k = rmsW(a, FS, 0, 0.3) / rmsW(n, FS, 0, 0.3), w = Math.exp(T.KX9 * 11 * T.DAC9V);
    if (!near(k, w, 0.005)) bad.push(`${s} accent ${k}`);
  }
  const cn = render(machine(D), { sec: 0.3, hits: [[0, SI('ch'), 100]] }).y, ca = render(machine(D), { sec: 0.3, hits: [[0, SI('ch'), 110]] }).y;
  out.push(`the CH's per-voice accent +${dB(rmsW(ca, FS, 0, 0.3) / rmsW(cn, FS, 0, 0.3)).toFixed(2)} dB (R9 §8: ≈ +4.4)`);
  if (Math.abs(dB(rmsW(ca, FS, 0, 0.3) / rmsW(cn, FS, 0, 0.3)) - 4.4) > 0.1) bad.push('the CH\'s accent');
  console.log('#', out.join('; '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- the shared contracts (7a §12.1) */
const PATTERN = [];   // two bars: every lane, both accents, OH + CH on one step, the guide's second trigger, hits between the steps
for (let st = 0; st < 32; st++) {
  const f = st * 6000;
  let mask = 0, acc = 0;
  if (st % 4 === 0) { mask |= 2; if (st % 8 === 0) acc |= 2; }
  if (st % 8 === 4) mask |= 4 | (1 << 7);
  mask |= st % 4 === 2 ? 1 << 10 : 1 << 11; if (st % 3 === 0) acc |= 1 << 11;
  if (st % 16 === 6) mask |= 8 | 16; if (st % 16 === 14) mask |= 32 | 64; if (st === 0 || st === 16) mask |= 1 << 9;
  if (st % 2 === 1) mask |= 1 << 8;
  if (st % 4 === 0) mask |= 1;
  if (st === 9) mask |= (1 << 10) | (1 << 11);
  PATTERN.push([f, m => m.trig(mask, acc)]);
  if (st % 4 === 0) PATTERN.push([f, m => m.trig(1 << 6, 0)]);       // the guide's RS, a second trigger in the step's chunk
  if (st % 5 === 1) PATTERN.push([f + 1500, SI(['lt', 'oh', 'ht', 'cr', 'sd', 'ch', 'cp', 'rs'][st % 8]), 40 + st * 3]);
}
test('retrigger continues the state (the analog voices); a ROM voice restarts its counter (the hats\' C135 from its level)', () => {
  const D = D48(), bad = [];
  for (const s of SND) {
    const r = render(machine(D), { sec: 0.4, hits: [[0, SI(s), 100], [2400, SI(s), 100]] }).y.subarray(2400 * 4);
    const f = render(machine(D), { sec: 0.4, hits: [[2400, SI(s), 100]] }).y.subarray(2400 * 4);
    const m = machine(D), z = render(m, { sec: 0.4, hits: [[0, SI(s), 100], [2400, mm => { mm.reset(); mm.hit(SI(s), 100); }]] }).y.subarray(2400 * 4);
    if (same(r, f) && s !== 'cr' && s !== 'rd') bad.push(s + ' = a fresh hit');
    if (same(r, z) && s !== 'cr' && s !== 'rd') bad.push(s + ' = reset then hit');
    if (!same(z, f)) bad.push(s + ': reset then hit ≠ fresh');
  }
  // the clap: a retrigger while its tail rings restarts the burst timer (four bursts again)
  const cp2 = render(machine(D), { sec: 0.6, hits: [[0, SI('cp'), 100], [9600, SI('cp'), 100]] }).y, e2 = env(cp2, FS, 0.0005);
  [[200, 4], [209.8, 3], [221.5, 3], [231.4, 2]].forEach(([t, k]) => { let pk = 0; for (let i = Math.round(t / 0.5); i < Math.round((t + 3) / 0.5); i++) pk = Math.max(pk, e2[i]); if (!(pk > k * e2[Math.round(t / 0.5) - 2])) bad.push(`the retriggered clap's burst at ${t} ms`); });
  // the cymbals: a retrigger restarts the counter from word 0 (the couplings' and filters' states carry on)
  const m = machine(D);
  render(m, { sec: 0.3, hits: [[0, SI('cr'), 100], [4800, SI('cr'), 100]] });
  if (!(m._v.cr.nx < 0.21 * 31100 && m._v.cr.nx > 0.19 * 31100)) bad.push('the crash\'s counter ' + m._v.cr.nx);
  assert.deepEqual(bad, []);
});

// (the 909's accent is subtler than the 808's / 606's: one DAC level into each voice's envelopes; where a clamp or a second
// path sits, the accented hit is no scaled copy of the normal one — its residual after the best gain ≥ 1 %, where a level-only
// voice's is < 1e-4 — while the spectrum's correlation stays near 1, reported)
test('accent per R9 §8: a timbre where a clamp or a second path sits (BD, SD, HC: no scaled copy, residual ≥ 1 %), a level on the toms and RS (within 2 % of the envelopes\' ratio)', () => {
  const D = D48(), T = D.proto.tr909, bad = [], out = [];
  for (const s of ['bd', 'sd', 'cp']) {
    const n = render(machine(D, { drum: { ac: 1 } }), { sec: 0.4, hits: [[0, step(s, 0, 0)]] }).y, a = render(machine(D, { drum: { ac: 1 } }), { sec: 0.4, hits: [[0, step(s, 1, 1)]] }).y;
    let an = 0, nn = 0, aa = 0; for (let i = 0; i < n.length; i++) { an += a[i] * n[i]; nn += n[i] * n[i]; aa += a[i] * a[i]; }
    const k = an / nn, res = Math.sqrt(Math.max(0, aa - 2 * k * an + k * k * nn) / aa), c = corr(spec(n, FS, 0.3), spec(a, FS, 0.3));
    out.push(`${s} residual ${(res * 100).toFixed(1)} % (spectral correlation ${c.toFixed(4)})`);
    if (!(res >= 0.01)) bad.push(s + ' ' + res);
  }
  for (const s of ['lt', 'mt', 'ht', 'rs']) {
    const n = render(machine(D, { drum: { ac: 0.5 } }), { sec: 0.5, hits: [[0, step(s, 0, 0)]] }).y, a = render(machine(D, { drum: { ac: 0.5 } }), { sec: 0.5, hits: [[0, step(s, 1, 0)]] }).y;
    const k = rmsW(a, FS, 0, 0.5) / rmsW(n, FS, 0, 0.5), w = (T.vAcc9(32) - 1.2 + (s === 'rs' ? T.RS9.D : 0)) / (T.vAcc9(21) - 1.2 + (s === 'rs' ? T.RS9.D : 0));
    out.push(`${s} × ${k.toFixed(4)}`);
    if (!near(k, w, 0.02) || !(maxAbsDiff(a.map(x => x / w), n) < 2e-5)) bad.push(`${s} ${k} vs ${w}`);   // (to the sleep threshold)
  }
  console.log('# accent (TOTAL ACCENT; spectral correlation / level ratio):', out.join(', '));
  assert.deepEqual(bad, []);
});

test('44.1 kHz × 2 vs 48 kHz × 4: the circuits\' frequencies agree within 0.5 %; the word clocks exact at both', () => {
  const bad = [];
  for (const [s, band, t0, t1] of [['bd', [40, 60], 0.3, 0.8], ['sd', [150, 200], 0.03, 0.15], ['lt', [70, 100], 0.4, 0.9], ['ht', [110, 140], 0.4, 0.9], ['rs', [190, 250], 0, 0.04]]) {
    const a = hit1(s, { sec: 1 }), b = hit1(s, { sr: 44100, os: 2, sec: 1 });
    const fa = peakF(a.y, a.fs, ...band, t0, t1), fb = peakF(b.y, b.fs, ...band, t0, t1);
    if (!near(fa, fb, 0.005)) bad.push(`${s} ${fa} / ${fb}`);
  }
  for (const [sr, os] of [[44100, 2], [44100, 1], [96000, 2]]) {
    const m = machine(lib(sr).D, { sr, os }); render(m, { sr, os, sec: 0.2, hits: [[0, SI('oh'), 100]] });
    const dw = m._v.hh.dw * sr * os;
    if (!near(dw, 30000, 1e-12)) bad.push(`hats at ${sr} × ${os}: ${dw}`);
  }
  // an OS change mid-sound: the counters keep their words (the clock in word units), every circuit finite and ringing on
  const m = machine(D48()), b = new Float64Array(1024);
  render(m, { sec: 0.2, hits: [[0, m2 => m2.trig(0xffe, 0)]] });
  const n0 = m._v.cr.nx;
  m.setOS(2);
  for (let F = 9600; F < 19200; F += 128) { b.fill(0); m.render(b, 256, F); if (!b.subarray(0, 256).every(Number.isFinite)) { bad.push('not finite after setOS'); break; } }
  if (!near(m._v.cr.nx - n0, 0.2 * m._v.cr.dw * 96000, 0.002) || !m._v.cr.on) bad.push(`the crash's words across the OS change ${m._v.cr.nx - n0}`);
  assert.deepEqual(bad, []);
});

test('no NaN / Inf, no subnormal on the bus or in an asleep machine\'s states (every sound, both accents, every knob at 0 and at 10, OS 4 and 1)', () => {
  const D = D48(), bad = [];
  for (const kn of [0, 1]) {
    const dr = Object.fromEntries([...D.mach.tr909.KNOB_IDS].map(k => [k, kn]));
    for (const os of [4, 1]) {
      const m = machine(D, { os, drum: dr }), hits = [];
      SND.forEach((s, i) => { hits.push([i * 960, SI(s), 127]); hits.push([i * 960 + 480, SI(s), 60]); hits.push([i * 960 + 600, step(s, 1, 1)]); });
      const { y } = render(m, { os, sec: kn ? 8 : 6, hits });
      for (let i = 0; i < y.length; i++) { const v = y[i]; if (!Number.isFinite(v) || (v !== 0 && Math.abs(v) < 2.3e-308)) { bad.push(`knobs ${kn} OS ${os}: ${v} at ${i}`); break; } }
      for (const [k, v] of Object.entries(m._v)) {
        if (v.on) bad.push(`knobs ${kn} OS ${os}: ${k} still awake at the end`);
        for (const [f, x] of Object.entries(v)) if (typeof x === 'number' && x !== 0 && Math.abs(x) < 2.3e-308) bad.push(`${k}.${f} subnormal`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('determinism and span invariance: the same hits → identical bytes; spans of 4, 128 and random multiples of 4 frames (the word clocks, the staircases and the noise included); OS 1 at 44.1 kHz', () => {
  const D = D48();
  const a = render(machine(D), { sec: 4.5, hits: PATTERN, post: true }), b = render(machine(D), { sec: 4.5, hits: PATTERN, post: true });
  assert.ok(same(a.y, b.y) && same(a.L, b.L), 'determinism');
  assert.ok(absMax(a.L) > 0.1, 'the pattern sounds');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return 4 * (1 + (seed >>> 16) % 32); };
  for (const [name, span] of [['4', () => 4], ['random', rnd]]) {
    const r = render(machine(D), { sec: 4.5, hits: PATTERN, span, post: true });
    assert.ok(same(a.y, r.y), `bus, spans ${name}`);
  }
  const D44 = lib(44100).D;
  const c = render(machine(D44, { sr: 44100, os: 1 }), { sr: 44100, os: 1, sec: 3, hits: PATTERN.slice(0, 40) }), d = render(machine(D44, { sr: 44100, os: 1 }), { sr: 44100, os: 1, sec: 3, hits: PATTERN.slice(0, 40), span: () => 4 });
  assert.ok(same(c.y, d.y), 'OS 1');
});

test('order-free latching: hits at one frame in two orders, a step mask vs the same hits one by one, the guide\'s second trigger in one chunk; ids 11–15 nothing', () => {
  const D = D48();
  const at = (list, v) => list.map(s => [4800, s, v]);
  const S1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], S2 = S1.slice().reverse();
  assert.ok(same(render(machine(D), { sec: 0.6, hits: at(S1, 100) }).y, render(machine(D), { sec: 0.6, hits: at(S2, 100) }).y), 'two orders');
  const t = render(machine(D), { sec: 0.6, hits: [[4800, m => m.trig(0xffe)]] }).y, h = render(machine(D), { sec: 0.6, hits: at(S1, 100) }).y;
  assert.ok(same(t, h), 'a step mask = its hits');
  // the guide (a second trig(RS) in the step's chunk): the step's own RS at its code, the shared DAC the higher
  const g1 = render(machine(D), { sec: 0.3, hits: [[480, m => { m.trig(2 | 1 | 128, 0); m.trig(1 << 6, 0); }]] }).y;
  const g2 = render(machine(D), { sec: 0.3, hits: [[480, m => m.trig(2 | 1 | 128 | 64, 0)]] }).y;
  assert.ok(same(g1, g2), 'the guide\'s RS in the step\'s chunk = the step with RS (the higher code wins)');
  const m = machine(D);
  for (const s of [11, 12, 13, 14, 15, 16, -1]) m.hit(s, 127);
  m.trig(1 << 12, 0);
  assert.equal(m.live(), false, 'nothing latched');
});

test('no allocation over 200 spans: hits, steps with accents, knob glides (the clocks\' TUNE too), the noise, a chip swap\'s pending look and its conversion', () => {
  const { sc, D } = lib(48000), m = machine(D), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128);
  const len = 9600, X = new Float32Array(len); for (let i = 0; i < len; i++) X[i] = Math.sin(i * 0.37) * Math.exp(-i / 3000);
  const entry = { kind: 'smp', rate: 48000, ch: 1, len, root: 60, peak: 1, levels: [{ len, L: X, R: null }] };
  let ready = false;
  sc.ctx.SxBase = { getAsset: id => (ready && id === 'smp:ride' ? entry : null) };
  try {
    const drum = drumOf(D);
    m.set(drum);
    m.smp(Array.from({ length: 16 }, (_, i) => (i === 7 ? { id: 'smp:ride', on: true } : null)));
    noAlloc(sc, () => {
      for (let k = 0; k < 200; k++) {
        if (k % 7 === 0) m.trig(0xfff, 0x83e);
        if (k % 11 === 3) m.hit(k % 11, 30 + k % 97);
        if (k % 50 === 25) { drum.bdu = (drum.bdu + 0.3) % 1; drum.cru = (drum.cru + 0.2) % 1; drum.ohd = (drum.ohd + 0.2) % 1; }
        if (k === 120) ready = true;
        buf.fill(0); m.render(buf, 512, k * 128);
        for (let i = 0; i < 128; i++) mono[i] = buf[i * 4];
        m.post(L, R, mono, 128);
        m.live(); m.mon();
      }
    });
    assert.equal(m._sw.id[0], 'smp:ride', 'converted once found');
  } finally { delete sc.ctx.SxBase; }
});

test('idle and sleep: an asleep 909 runs no circuit code; every voice sleeps (1e-5 of its scale); mon() reports the 909\'s slots', () => {
  const D = D48(), m = machine(D), out = [];
  for (const s of SND) {
    const t = [100, 127].map(v => { const mm = machine(D, { drum: { ac: 1 } }); mm.hit(SI(s), v); const b = new Float64Array(512); for (let F = 0; F < 48000 * 6; F += 128) { b.fill(0); mm.render(b, 512, F); if (!mm._v[VKEY[s]].on) return F / 48000; } return Infinity; });
    out.push(`${s} ${(t[0] * 1e3).toFixed(0)} / ${(t[1] * 1e3).toFixed(0)}`);
    assert.ok(t[1] < 4, `${s} sleeps`);
  }
  console.log('# time to sleep after one hit (ms, normal / both at TOTAL ACCENT 10):', out.join(', '));
  m.hit(SI('bd'), 100); m.hit(SI('oh'), 127); m.hit(SI('lt'), 100); m.hit(SI('rd'), 100);
  const b = new Float64Array(512);
  m.render(b, 512, 0);
  const mo = m.mon();
  assert.equal(mo.lit, 1 | 4 | 128 | 512, 'lit: the sounds hit');
  assert.ok(mo.act[0] > 0 && mo.act[2] > 0 && mo.act[7] > 0 && mo.act[9] > 0 && mo.act[10] === 0 && mo.act[1] === 0 && mo.act[8] === 0, `act ${[...mo.act].map(x => x.toFixed(3))}`);
  render(m, { sec: 4, post: true });
  assert.equal(m.live(), false, 'everything asleep, the output settled');
  const c0 = m._M.count;
  render(m, { sec: 1 });
  assert.equal(m._M.count, c0, 'no circuit ran');
  assert.ok(Object.values(m._v).every(v => v.thr === 1e-5), 'the thresholds');
});

/* ---------------------------------------------------------------- your own sounds (§5) */
test('sample slots, the analog sounds (§5): a slot plays instead of the circuit — its LEVEL, the code as gain, TUNE ± 1 octave and DECAY neutral at 5, DECAY 0 a 30 ms fade', () => {
  const { sc, D } = lib(48000), T = D.proto.tr909;
  const len = 9600, L = new Float32Array(len); for (let i = 0; i < len; i++) L[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
  sc.ctx.SxBase = { getAsset: id => (id === 'smp:test' ? { kind: 'smp', rate: 48000, ch: 1, len, root: 60, peak: 1, levels: [{ len, L, R: L }] } : null) };
  try {
    const slots = s => Array.from({ length: 16 }, (_, i) => (i === s ? { id: 'smp:test', on: true } : null));
    const one = (s, drum = {}, hits = [[0, SI(s), 100]]) => { const m = machine(D, { drum }); m.smp(slots(SI(s))); return { r: render(m, { sec: 0.2, hits, post: true }), m }; };
    const z = a => { let n = 0; for (let i = 1; i < 4800; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };
    const a = one('sd');
    assert.equal(a.m._v.sd.on, false, 'the circuit stays asleep');
    // N0: gain 1 × SMP_LEVEL9 × its LEVEL (the B pot, linear), through the output stage at rest (gain())
    const want = T.SMP_LEVEL9 * drumOf(D).sdl * D.gain('tr909', { vol: 0.75 }), got = absMax(a.r.L.subarray(2400, 4800));
    assert.ok(near(got, want, 0.02), `the sample's level ${got} vs ${want}`);
    const b = one('sd', { ac: 1 }, [[0, step('sd', 1, 1)]]);
    assert.ok(near(absMax(b.r.L.subarray(2400, 4800)) / got, 10 ** (4 / 20), 0.02), 'both at full TOTAL ACCENT: +4 dB');
    for (const s of ['bd', 'sd', 'lt', 'mt', 'ht']) {
      const b0 = one(s), b1 = one(s, { [s.slice(0, 2) + 'u']: 1 });
      assert.ok(Math.abs(z(b1.r.L) / z(b0.r.L) - 2) < 0.05, `${s}: TUNE 10 = an octave up`);
      assert.ok(Math.abs(z(b0.r.L) - 2 * 440 * 0.1) <= 2, `${s}: TUNE 5 = its pitch`);
      if (s !== 'sd') {
        assert.ok(same(b0.r.L, one(s, { [s.slice(0, 2) + 'd']: 1 }).r.L), `${s}: DECAY 10 = DECAY 5`);
        const d0 = one(s, { [s.slice(0, 2) + 'd']: 0 });
        assert.ok(absMax(d0.r.L.subarray(48 * 40, 48 * 60)) < 0.01 * absMax(d0.r.L.subarray(0, 480)), `${s}: DECAY 0, a 30 ms fade`);
      }
    }
  } finally { delete sc.ctx.SxBase; }
});

test('the chip swap (§5, Q2): a ROM sound\'s slot becomes its voice\'s image — resampled to 30 kHz, ±28 codes, ended at mid-scale, the hats\' other region the built-in —, pending until its entry exists, off: the built-in again', () => {
  const { sc, D } = lib(48000);
  const len = 30000, X = new Float32Array(len), Y = new Float32Array(len);
  for (let i = 0; i < len; i++) { X[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000) * Math.exp(-i / 20000); Y[i] = X[i]; }
  const E = { 'smp:a': { kind: 'smp', rate: 48000, ch: 2, len, root: 60, peak: 0.5, levels: [{ len, L: X, R: Y }] } };
  let ready = new Set();
  sc.ctx.SxBase = { getAsset: id => (ready.has(id) ? E['smp:a'] : null) };
  try {
    const sl = o => Array.from({ length: 16 }, (_, i) => (o[i] ? { id: o[i], on: true } : null));
    const m = machine(D), b = new Float64Array(512);
    m.smp(sl({ 9: 'smp:oh' }));
    m.render(b, 512, 0);
    assert.ok(m._sw.pend && m._v.hh.img === ROM.hh, 'pending: the built-in image plays');
    ready.add('smp:oh');
    m.render(b, 512, 128);
    assert.ok(!m._sw.pend && m._sw.id[2] === 'smp:oh' && m._v.hh.img === m._sw.hh, 'converted at the span\'s start');
    const img = m._v.hh.img, op = img.subarray(0, 24576);
    let pk = 0; for (const c of op) pk = Math.max(pk, Math.abs(c - 32));
    assert.equal(pk, 28, 'peak-normalised to ±28 codes');
    assert.equal(op[24575], 32, 'the region ends at mid-scale');
    assert.ok(same(img.subarray(24576), ROM.hh.subarray(24576)), 'the closed region: the built-in');
    // 1 kHz at 48 kHz → 30 words a period at 30 kHz
    let zc = 0, sg = 0; for (let i = 0; i < 3000; i++) { const t = Math.sign(op[i] - 32); if (t && sg && t !== sg) zc++; if (t) sg = t; }
    assert.ok(Math.abs(zc / 2 / (3000 / 30000) - 1000) < 30, `resampled: ${zc / 2 / 0.1} Hz`);
    // the CH's slot fills the closed region; the crash's and the ride's their own buffers (one image a quantum: two quanta)
    ready.add('smp:ch'); ready.add('smp:cr');
    m.smp(sl({ 9: 'smp:oh', 10: 'smp:ch', 8: 'smp:cr' }));
    m.render(b, 512, 256); m.render(b, 512, 384);
    assert.ok(m._sw.id[3] === 'smp:ch' && !same(m._v.hh.img.subarray(24576), ROM.hh.subarray(24576)) && m._v.hh.img[32767] === 32, 'the closed region swapped');
    assert.ok(m._v.cr.img === m._sw.cr && m._v.rd.img === ROM.rd, 'the crash\'s chip, the ride\'s built-in');
    // off: the built-in again (the hats keep the other slot's region)
    m.smp(sl({ 10: 'smp:ch' }));
    assert.ok(m._v.cr.img === ROM.cr && m._sw.id[2] === '' && same(m._v.hh.img.subarray(0, 24576), ROM.hh.subarray(0, 24576)) && m._v.hh.img === m._sw.hh, 'OH and CR off');
    m.smp(sl({}));
    assert.ok(m._v.hh.img === ROM.hh, 'all off: the built-in hats');
    // a swapped chip plays through the circuit: its clock, its staircase, its accent
    const ms = machine(D); ms.smp(sl({ 8: 'smp:cr' }));
    const y = render(ms, { sec: 0.3, hits: [[4, SI('cr'), 100]] }).y;
    assert.ok(absMax(y) > 0.05 && ms._v.cr.img === ms._sw.cr, 'the crash plays the swapped chip');
  } finally { delete sc.ctx.SxBase; }
});

// review 1 F3: four chip swaps at once (a project open, a power-on, an undone Replace) cost ≈ 2 quanta of CPU in one — and
// on the first hit, since an idle machine never renders: at most one image a quantum (the 128-frame block of the span's
// start, however the engine splits it into spans), the others pending (the built-in images meanwhile); poll(F) — the
// engine's idle skip — converts as render does, so the swaps happen while the machine waits
test('the chip swap converts at most one image a quantum (review 1 F3): four slots — one a quantum whatever the spans, the built-in images meanwhile; poll() (the idle skip) converts too; the 808\'s / 606\'s poll does nothing', () => {
  const { sc, D } = lib(48000);
  const len = 9600, X = new Float32Array(len); for (let i = 0; i < len; i++) X[i] = Math.sin(i * 0.21) * Math.exp(-i / 4000);
  const E = { kind: 'smp', rate: 48000, ch: 1, len, root: 60, peak: 1, levels: [{ len, L: X, R: null }] };
  sc.ctx.SxBase = { getAsset: id => (/^smp:[a-z]+$/.test(id) ? E : null) };
  try {
    const sl = () => Array.from({ length: 16 }, (_, i) => ([7, 8, 9, 10].includes(i) ? { id: 'smp:' + ['rd', 'cr', 'oh', 'ch'][i - 7], on: true } : null));
    const n = m => m._sw.id.filter(Boolean).length, b = new Float64Array(512);
    const m = machine(D); m.smp(sl());
    const per = [];
    for (let q = 0; q < 6; q++) { const k = n(m); for (let s = 0; s < 4; s++) m.render(b, 128, q * 128 + s * 32); per.push(n(m) - k); }
    assert.deepEqual(per, [1, 1, 1, 1, 0, 0], 'one image a quantum (four spans each)');
    assert.ok(!m._sw.pend && m._v.rd.img === m._sw.rd && m._v.cr.img === m._sw.cr && m._v.hh.img === m._sw.hh, 'all four, in the end');
    const p = machine(D); p.smp(sl());
    assert.equal(typeof p.poll, 'function');
    const pp = [];
    for (let q = 0; q < 5; q++) { const k = n(p); p.poll(q * 128); p.poll(q * 128 + 64); pp.push(n(p) - k); }
    assert.deepEqual(pp, [1, 1, 1, 1, 0], 'poll: one a quantum, nothing rendered');
    assert.equal(p.live(), false, 'nothing sounds');
    for (const k of ['tr808', 'tr606']) { const o = D.create({ base: 48000, OS: 4, seedSalt: 0 }, k); assert.equal(o.poll(0), undefined, k); }
  } finally { delete sc.ctx.SxBase; }
});

// §2.6, review 1 F1: the loudness gate is the whole Track's (tests/engine-track.test.mjs '7c §2.6 level': the shipped images,
// the decimators, the limiter). Here the machine's own anchor, measured honestly — the shipped images (R9's block, not the
// stand-ins) and a band-limited decimation (a windowed sinc below 20 kHz, then every OS-th sample: picking samples alone folds
// the OS band — the 6-bit staircases' and the noise voices' images — into the base band): the BD alone at the default panel
// (its LEVEL 9) peaks at the 808's default BD within ± 1 dB; the default groove's RMS and every sound's peak reported
function decim(y, os) {
  const H = 95, c = 20000 / (48000 * os), h = new Float64Array(H);
  let s = 0;
  for (let k = 0; k < H; k++) { const x = k - (H - 1) / 2, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (H - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (H - 1)); h[k] = (x === 0 ? 2 * c : Math.sin(2 * Math.PI * c * x) / (Math.PI * x)) * w; s += h[k]; }
  const n = Math.floor(y.length / os), o = new Float64Array(n);
  for (let i = 0; i < n; i++) { let a = 0; const e = i * os + (H - 1) / 2; for (let k = 0; k < H; k++) { const j = e - k; if (j >= 0 && j < y.length) a += h[k] * y[j]; } o[i] = a / s; }
  return o;
}
test('§2.6 level (review 1 F1): the BD alone at the default panel (LEVEL 9) peaks at the 808\'s default BD within ± 1 dB — the shipped images, a band-limited decimation; the default groove and each sound reported (the gate: engine-track, through the whole Track)', () => {
  const D = D48(), S16 = 6000;   // a sixteenth at 120 BPM, 48 kHz
  const groove = (ids) => { const h = []; for (let k = 0; k < 16; k++) { if (k % 4 === 0) h.push([k * S16, ids.bd, 100]); if (k === 4 || k === 12) h.push([k * S16, ids.sd, 100], [k * S16, ids.cp, 100]); if (k % 2 === 0) h.push([k * S16, ids.ch, 100]); } return h; };
  const rms = y => { let a = 0; for (let i = 0; i < y.length; i++) a += y[i] * y[i]; return Math.sqrt(a / y.length); };
  const m8 = () => { const m = D.create({ base: 48000, OS: 4, seedSalt: 0 }, 'tr808'); m.set(Object.assign(Object.fromEntries(D.KNOB_IDS.map((k, i) => [k, D.KNOB_DEF[i]])), { lts: 0, mts: 0, hts: 0, rss: 0, cps: 0 })); return m; };
  // the bus (OS 4) band-limited and decimated, then the machine's own output stage (post)
  const out = (m, hits, sec) => {
    const y = decim(render(m, { sec, hits }).y, 4), L = new Float32Array(y.length), Lb = new Float32Array(128), Rb = new Float32Array(128), mono = new Float64Array(128);
    for (let F = 0; F < y.length; F += 128) { const n = Math.min(128, y.length - F); mono.set(y.subarray(F, F + n)); m.post(Lb, Rb, mono, n); L.set(Lb.subarray(0, n), F); }
    return L;
  };
  const shipped = () => machine(D, { opt: {} });
  const y9 = out(shipped(), groove({ bd: SI('bd'), sd: SI('sd'), cp: SI('cp'), ch: SI('ch') }), 2), y8 = out(m8(), groove({ bd: 0, sd: 1, cp: 6, ch: 10 }), 2);
  const b9 = absMax(out(shipped(), [[0, SI('bd'), 100]], 1)), b8 = absMax(out(m8(), [[0, 0, 100]], 1));
  const pk = SND.map(s => `${s} ${absMax(out(shipped(), [[0, SI(s), 100]], 1.5)).toFixed(3)}`);
  console.log(`# level (the machine, the shipped images): BD alone 909 ${b9.toFixed(4)}, 808 ${b8.toFixed(4)} (${dB(b9 / b8).toFixed(2)} dB); the groove's RMS 909 / 808 ${dB(rms(y9) / rms(y8)).toFixed(2)} dB (peaks ${absMax(y9).toFixed(3)} / ${absMax(y8).toFixed(3)}); each sound alone (FS, unaccented): ${pk.join(', ')}`);
  assert.ok(Math.abs(dB(b9 / b8)) <= 1, `the BD anchor ${dB(b9 / b8).toFixed(2)} dB`);
});

/* ---------------------------------------------------------------- CPU (§2.7) */
test('CPU per circuit (reported) and the d9p / d9x / d9m / idle patterns, the machine alone (node, OS 4, 48 kHz) within §2.7\'s rows', () => {
  const D = D48(), out = [];
  const load = (hits, sec, drum, every) => {
    const m = machine(D, { drum, opt: { rom: ROM } }), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128);
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
  for (const s of SND) { load(m => m.hit(SI(s), 127), 0.3, {}, 0.1); out.push(`${s} ${best(() => load(m => m.hit(SI(s), 127), 1.5, {}, 0.1)).toFixed(4)}`); }
  // the noise alone (the generator, a span of 512 OS samples at a time)
  { const m = machine(D), b = new Float64Array(512); const t0 = performance.now(); for (let k = 0; k < 375 * 4; k++) m._nz(k * 512, 512, b); out.push(`noise ${((performance.now() - t0) / 1000 / 4).toFixed(4)}`); }
  // d9p: the house pattern at 120 BPM (a 16th every 125 ms, SHUFFLE 3: the even 16ths 40 ticks late, a flam on the SD at 2 / 4)
  const d9p = (m, k) => {
    const s = k % 16; let mk = 0, ac = 0;
    if (s % 4 === 0) { mk |= 2 | 1; if (s === 0) ac |= 2; }
    mk |= s % 4 === 2 ? 1 << 10 : 1 << 11; if (s % 4 === 1) ac |= 1 << 11;
    if (s === 4 || s === 12) mk |= 4 | 128;
    if (s % 2 === 0) mk |= 1 << 8;
    if (s === 0) mk |= 1 << 9;
    if (s % 8 === 3) mk |= 8; if (s % 8 === 5) mk |= 16; if (s % 8 === 7) mk |= 32;
    m.trig(mk, ac);
  };
  // (the machine alone takes the shuffle and the flam as frames: the hits at their own frames)
  const pat = (sec, drum) => { const m = machine(D, { drum, opt: { rom: ROM } }), buf = new Float64Array(512), L = new Float32Array(128), R = new Float32Array(128), mono = new Float64Array(128), ev = [];
    for (let k = 0; k < sec * 8; k++) { const F = Math.round(k * 6000 + (k % 2 === 1 ? 40 * 25 : 0)); ev.push([F, mm => d9p(mm, k)]); if (k % 16 === 4 || k % 16 === 12) ev.push([F + 900, mm => mm.trig(4, 0)]); }
    ev.sort((a, b) => a[0] - b[0]);
    let e = 0; const t0 = performance.now();
    for (let F = 0; F < sec * 48000; F += 128) {
      while (e < ev.length && ev[e][0] < F + 128) ev[e++][1](m);
      buf.fill(0); m.render(buf, 512, F); for (let i = 0; i < 128; i++) mono[i] = buf[i * 4]; m.post(L, R, mono, 128);
    }
    return (performance.now() - t0) / 1000 / sec; };
  const DEC = { bdd: 1, sdt: 1, ltd: 1, mtd: 1, htd: 1, chd: 1, ohd: 1, cru: 0, rdu: 0 };
  const R = {
    d9p: best(() => pat(4, {})),
    d9x: best(() => load(m => { m.trig(0xfff, 0x83e); }, 3, DEC, 0.25)),
    d9m: best(() => load(m => { m.hit(SI('cr'), 100); m.hit(SI('rd'), 100); m.hit(SI('oh'), 100); }, 3, {}, 0.5)),
    idle: best(() => load(() => {}, 2, {}, 0)),
  };
  console.log('# CPU (s per s; circuits retriggered every 100 ms at v 127; patterns: the machine alone):', out.join(', '), '|', Object.entries(R).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', '));
  // (d9i proper is E9's: the Inst past its quiet window never calls the machine; a silent machine still runs its output stage)
  assert.ok(R.d9p <= 0.035 && R.d9x <= 0.08 && R.d9m <= 0.025 && R.idle <= 0.001, JSON.stringify(R));
});
/* END */
