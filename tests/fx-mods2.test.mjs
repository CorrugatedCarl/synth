// fx-mods2.js unit tests (owner F1; SPEC-serum2 §15.10). Run: node --test tests/fx-mods2.test.mjs
// Script shape and lazy cross-script references (§0.3), source rules (§0.4), the exact export list and every signature
// (§11.11), the embedded parameter tables equal fx-core FXP_TAB (§3.16, §0.4), the module protocol, and the M2 recipes of
// §8.2–§8.4 module by module: Bode (shift direction and image rejection, DIR / WIDTH / MONO INPUT rules, delay, feedback,
// BLUR, RETRIG phase), Convolve (zero latency for spans of 4 / 17 / 128, head / middle / tail seams against a direct
// convolution, pre-delay, IR GAIN, 20 ms crossfade on a shape-key change, adoption without FFT or allocation, tail work
// spread), Utility (polarity, filters and their off states, MONO BASS, WIDTH, PAN), the S2 reverb tanks (finite, decaying,
// decorrelated, Nitrous modes, Basin infinite), the splitter band builders (= FXDSP.splitResponse, allpass-flat sums,
// M/S exact), Overdrive staging (static curve = FXDSP.distCurve, the 9 kHz stage low-pass), budgets (§8.5) and
// allocation-free hot paths. IMPL-SC G3 (lane D): the Ducker — a trigger's sample exactness, shift invariance (att / smooth 0 and
// the defaults, across call phases), identical hits, the tempo-synced length, a retrigger, the NOTE filter, velocity ignored, depth 0,
// the gr slots, no allocation, no registry / stamp / source → identity × LEVEL, the curve table from the FXT. Rack-level behaviour (FXRack with these modules) is in tests/fx-dsp.test.mjs.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';
import { lawValue, lawNorm, renderPts } from '../laws.js?v=9';
import * as C from '../fx-core.js?v=9';
import * as SMP from '../smp.js?v=9';

const FS = 48000;
const arr = a => Array.from(a);                         // vm-realm arrays → plain arrays of this realm
const plain = o => ({ ...o });
const scope = (opts = {}) => {
  const S = dspScope({ files: ['sx-base.js', 'fx-mods2.js'], ...opts });
  return { S, M: S.global('FXMods2'), B: S.global('SxBase') };
};
const MODULES = ['Bode', 'Convolve', 'Utility', 'RevVintage', 'RevNitrous', 'RevBasin', 'Duck']; // (Duck: IMPL-SC §4.2, lane D)
const TYPE_OF = { Bode: 'bode', Convolve: 'conv', Utility: 'util', RevVintage: 'rev', RevNitrous: 'rev', RevBasin: 'rev', Duck: 'duck' };
const RUN_HERE = ['rev', 'bode', 'conv', 'util', 'split2', 'split3', 'splitms', 'duck']; // ('duck': its table here from IMPL-SC phase 0; lane D's Duck runs it)
// a Unit as FXRack passes it (§11.11 module protocol): table defaults, `set` = engine values by pid (en follows the law)
function unit(M, type, set = {}, extra = {}) {
  const T = M.TAB[type], n = T.length;
  const en = Float64Array.from(T, r => r.def), ev = Float64Array.from(T, r => lawValue(r.law, r.lo, r.hi, r.def));
  for (const [pid, v] of Object.entries(set)) {
    const p = M.PIDX[type][pid];
    if (p === undefined) throw new Error(type + ' has no ' + pid);
    ev[p] = v; en[p] = lawNorm(T[p].law, T[p].lo, T[p].hi, v, T[p].def);
  }
  return { n, en, ev, bpm: 120, keyF: 1, seedPh: 0, ...extra };
}
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const noise = (n, seed, amp = 0.8) => { const r = rng(seed); return Float64Array.from({ length: n }, () => (2 * r() - 1) * amp); };
const sine = (n, f, amp = 1, fs = FS) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / fs));
const dB = x => 20 * Math.log10(x);
// amplitude of the f Hz component of x[i0, i1) (single-bin DFT)
function amp(x, f, i0, i1, fs = FS) {
  let re = 0, im = 0;
  for (let i = i0; i < i1; i++) { const w = 2 * Math.PI * f * i / fs; re += x[i] * Math.cos(w); im += x[i] * Math.sin(w); }
  return 2 * Math.hypot(re, im) / (i1 - i0);
}
function mag(h, f, fs = FS) { // |DTFT| of h at f Hz
  let re = 0, im = 0;
  const w = -2 * Math.PI * f / fs;
  for (let n = 0; n < h.length; n++) { re += h[n] * Math.cos(w * n); im += h[n] * Math.sin(w * n); }
  return Math.hypot(re, im);
}
const maxAbs = (a, i0 = 0, i1 = a.length) => { let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const maxStep = (a, i0 = 1, i1 = a.length) => { let m = 0; for (let i = Math.max(1, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
const energy = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return s; };
// drives a module like the rack does: upd once per 16-sample block, run in blocks of ≤ 16 inside spans of `span` frames
function drive(o, R, L, Rc, { span = 128, poll = false, before } = {}) {
  for (let s = 0; s < L.length; s += span) {
    const e = Math.min(L.length, s + span);
    if (poll) o.poll(1);
    if (before) before(s);
    for (let b = s; b < e; b += 16) { o.upd(R); o.run(R, L, Rc, b, Math.min(16, e - b)); }
    o.flush();
  }
}
const fresh = (M, k, R, fs = FS) => { const o = new M[k](fs); assert.equal(o.set(R), true); o.alloc(); o.upd(R); o.snap(); return o; };
// shaped-IR entry (§4.5) of PCM through the S1 producer (smp.irPartition), as SxBase.storeAsset receives it
function irEntry(id, L, R, rate = FS) { return Object.assign({ id, v: 1, kind: 'ir', bytes: 0 }, SMP.irPartition(L, R, rate)); }
// direct convolution reference (Float64 FFT of the Float32 IR samples), first n samples
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, h = len >> 1;
    for (let k = 0; k < h; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k);
      for (let i = k; i < n; i += len) {
        const r = re[i + h] * wr - im[i + h] * wi, s = re[i + h] * wi + im[i + h] * wr;
        re[i + h] = re[i] - r; im[i + h] = im[i] - s; re[i] += r; im[i] += s;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function convolve(x, h, n) {
  let N = 1;
  while (N < x.length + h.length) N <<= 1;
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(x); for (let i = 0; i < h.length; i++) br[i] = h[i];
  fft(ar, ai); fft(br, bi);
  for (let k = 0; k < N; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
  fft(ar, ai, true);
  return ar.slice(0, n);
}

/* ------------------------------------------------------------------ loading and shape (§0.3) */

test('loads in a bare scope and publishes only the frozen FXMods2; re-evaluation; a throwing copy leaves it null', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('fx-mods2.js');
  assert.deepEqual([...names()].filter(k => !before.has(k)), ['FXMods2'], 'nothing but FXMods2 leaks into the global scope');
  const M = S.global('FXMods2');
  assert.ok(M && Object.isFrozen(M));
  assert.equal(M.VER, 2);
  assert.doesNotThrow(() => S.reload('fx-mods2.js'));
  const M2 = S.global('FXMods2');
  assert.ok(M2 && M2 !== M && Object.isFrozen(M2), 're-evaluation publishes a fresh FXMods2');
  // a failure inside the IIFE: FXMods2 = null, console.error, nothing thrown out of the script
  const F = dspScope({ files: ['fx-mods2.js'], overrides: { 'fx-mods2.js': src => src.replace('const VER = 2;', "const VER = 2; throw new Error('boom');") } });
  assert.equal(F.global('FXMods2'), null);
  assert.ok(F.logs.some(l => l.level === 'error' && /fx-mods2: load failed/.test(l.text)));
  // the full §0.3 list (as the engine loads it): FXMods2 is a frozen object
  const A = dspScope();
  assert.ok(Object.isFrozen(A.global('FXMods2')) && A.global('FXMods2').VER === 2);
});

test('§0.3 lazy references: nothing is read from another script at load time; SxBase is resolved in set() / constructors', () => {
  const S = dspScope({ files: [] });
  const reads = [];
  S.run('(function (rec) { for (const g of ["SxBase", "SxFilt2", "SxWarp", "SxMod", "SxSample", "SxGran", "SxSpec", "SxSeq",'
    + ' "SerumDSP", "FXDSP"]) Object.defineProperty(globalThis, g, { get() { rec(g); return null; }, configurable: true }); })',
  'spy.js')(g => reads.push(g));
  S.reload('fx-mods2.js');
  assert.deepEqual(reads, [], 'no global read while the script loads');
  const M = S.global('FXMods2');
  for (const k of MODULES) new M[k](FS);
  new M.XoverLH(FS); new M.XoverLMH(FS); new M.MS(FS);
  assert.deepEqual(reads, [], 'the module constructors read nothing (Overdrive and Convolve.set do)');
  const c = new M.Convolve(FS);
  assert.equal(c.set(unit(M, 'conv', {}, { irId: 'fir:Medium/Chamber@48000~00000000' })), true);
  assert.deepEqual(reads, ['SxBase']);
  assert.equal(c.ready, 0, 'no SxBase: never ready (the rack passes the input)');
  new M.Overdrive(2 * FS);
  assert.deepEqual(reads, ['SxBase', 'SxBase']);
  assert.equal(S.logs.filter(l => l.level === 'warn').length, 1, 'one warning per scope for the missing SxBase');
  c.set(unit(M, 'conv', {}, { irId: 'x@48000~1' })); new M.Overdrive(2 * FS).set(0.5, 4);
  assert.equal(S.logs.filter(l => l.level === 'warn').length, 1);
});

test('source follows the DSP script rules (one IIFE, environment neutrality, SxBase only inside functions)', () => {
  const code = source('fx-mods2.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = code.trim();
  assert.ok(body.startsWith('(function () {') && body.endsWith('})();'), 'file is one IIFE');
  assert.match(body, /^\(function \(\) \{\s*'use strict';/);
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window',
    'document', 'self', 'eval', 'instanceof', 'import', 'export', 'with', 'SharedArrayBuffer', 'Atomics']) {
    assert.doesNotMatch(code, new RegExp('\\b' + w + '\\b'), w);
  }
  assert.doesNotMatch(code, /new\s+Function/);
  assert.doesNotMatch(code, /Math\.random/);
  const globals = code.split('\n').filter(l => /globalThis\.\w+/.test(l));
  for (const l of globals) {
    if (/globalThis\.FXMods2 = /.test(l)) continue;
    assert.match(l, /^\s{6,}\S.*globalThis\.SxBase\b/, 'only SxBase is read, inside functions: ' + l.trim());
  }
  for (const g of ['SerumDSP', 'FXDSP', 'SxMod', 'SxWarp', 'SxFilt2']) assert.doesNotMatch(code, new RegExp('\\b' + g + '\\b'), g);
});

/* ------------------------------------------------------------------ exports, signatures, tables (§11.11, §3.16) */

test('§11.11 exports: the exact list, the module protocol and every class signature', () => {
  const { M } = scope();
  assert.deepEqual(Object.keys(M), ['VER', 'TYPES', 'TAB', 'PIDX', 'Bode', 'Convolve', 'Utility', 'RevVintage', 'RevNitrous',
    'RevBasin', 'XoverLH', 'XoverLMH', 'MS', 'Overdrive', 'Duck']);
  const proto = { set: 1, alloc: 0, reset: 0, upd: 1, snap: 0, seed: 1, run: 5, flush: 0, tail: 0, bytes: 0 };
  for (const k of MODULES) {
    assert.equal(typeof M[k], 'function', k);
    assert.equal(M[k].length, 1, k + '(fs)');
    for (const [f, n] of Object.entries(proto)) assert.equal(M[k].prototype[f].length, n, k + '.' + f);
    const o = new M[k](FS);
    assert.deepEqual([o.has, o.ir, o.latency], [0, 1, 0], k + ' fields');
    assert.equal(Number.isNaN(o.ph), k !== 'Bode', k + '.ph');
  }
  for (const k of ['RevVintage', 'RevNitrous', 'RevBasin']) {
    assert.equal(M[k].prototype.need.length, 0);
    assert.equal(M[k].prototype.bind.length, 1);
  }
  assert.equal(M.Convolve.prototype.poll.length, 0);
  assert.equal(M.Convolve.prototype.adopt.length, 1);
  // Convolve's set-time sizing protocol (the rack checks the growth against its cap): want() → partitions, fdlDelta() →
  // bytes, size(); release() after a dropped entry; fields qWant / Qc / short / capped
  for (const f of ['want', 'fdlDelta', 'size', 'release']) assert.equal(M.Convolve.prototype[f].length, 0, 'Convolve.' + f);
  const cv = new M.Convolve(FS);
  assert.deepEqual([cv.qWant, cv.Qc, cv.short, cv.capped], [0, 0, 0, 0]);
  const sp = { XoverLH: [1, 8], XoverLMH: [2, 10], MS: [0, 8] };
  for (const [k, [ns, nsp]] of Object.entries(sp)) {
    assert.equal(M[k].length, 1, k + '(fs)');
    assert.equal(M[k].prototype.set.length, ns, k + '.set');
    assert.equal(M[k].prototype.split.length, nsp, k + '.split');
    assert.equal(M[k].prototype.reset.length, 0);
    assert.equal(M[k].prototype.flush.length, 0);
    assert.equal(M[k].prototype.bytes.length, 0);
  }
  const od = { set: 2, reset: 0, tick: 2, run: 4, flush: 0, bytes: 0 };
  assert.equal(M.Overdrive.length, 1, 'Overdrive(fs2)');
  for (const [f, n] of Object.entries(od)) assert.equal(M.Overdrive.prototype[f].length, n, 'Overdrive.' + f);
});

test('§3.16 / §0.4: TYPES and the embedded tables equal fx-core (FXTYPES, FXP_TAB[type][2]); PIDX', () => {
  const { M, S } = scope();
  assert.deepEqual(arr(M.TYPES), C.FXTYPES.map(t => t.id));
  const A = dspScope({ files: ['fx-dsp.js'] });
  assert.deepEqual(arr(M.TYPES), arr(A.global('FXDSP').TYPES), 'the same list as FXDSP.TYPES');
  assert.ok(Object.isFrozen(M.TYPES) && Object.isFrozen(M.TAB) && Object.isFrozen(M.PIDX));
  assert.deepEqual(Object.keys(M.TAB), RUN_HERE);
  for (const t of RUN_HERE) {
    const want = C.FXP_TAB[t][2].map(r => {
      const o = { pid: r.pid, law: r.law, lo: r.lo, hi: r.hi, def: r.def };
      if (r.nomod) o.nomod = true;
      return o;
    });
    assert.deepEqual(arr(M.TAB[t]).map(plain), want, t);
    assert.ok(Object.isFrozen(M.TAB[t]) && arr(M.TAB[t]).every(r => Object.isFrozen(r)), t + ' frozen');
    assert.deepEqual(plain(M.PIDX[t]), Object.fromEntries(want.map((r, i) => [r.pid, i])), t + ' PIDX');
  }
  assert.deepEqual(arr(M.TAB.conv).filter(r => r.nomod).map(r => r.pid), ['size', 'tone', 'minph', 'att', 'dec', 'damp']);
  assert.equal(S.logs.length, 0);
});

test('module protocol: set(R) validates the unit shape; run() touches [o, o + m) only; reset() makes renders repeatable', () => {
  const { M, B, S } = scope();
  const id = 'ir:proto@48000~00000001';
  B.storeAsset(id, irEntry(id, noise(3000, 1, 0.1), noise(3000, 2, 0.1)));
  for (const k of MODULES) {
    const t = TYPE_OF[k], o = new M[k](FS), R = unit(M, t, k === 'Bode' ? { delay: 30, feed: 0.4 } : {}, { irId: id });
    assert.equal(o.set(R), true, k + ' valid unit');
    const n = R.n;
    for (const bad of [null, 7, {}, { ...R, n: n - 1 }, { ...R, n: n + 1 }, { ...R, ev: new Float64Array(n - 1) },
      { ...R, en: Array.from(R.en) }, { ...R, ev: undefined }]) {
      assert.equal(o.set(bad), false, k + ' rejects ' + (bad && typeof bad === 'object' ? JSON.stringify(Object.keys(bad)) : String(bad)));
    }
    assert.equal(new M[k](FS).set(unit(M, t === 'rev' ? 'bode' : 'rev')), false, k + ' rejects another type\'s table');
    o.set(R); o.alloc();
    assert.equal(o.has, 1);
    o.upd(R); o.snap(); o.seed(0.25);
    if (k === 'Bode') assert.equal(o.ph, 0.25, 'Bode seed → ph');
    assert.ok(o.tail() >= 0 && Number.isInteger(o.bytes()) && o.bytes() > 0, k + ' tail / bytes');
    const L = noise(64, 3), Rc = noise(64, 4), L0 = L.slice(), R0 = Rc.slice();
    o.run(R, L, Rc, 16, 16);
    for (let i = 0; i < 64; i++) {
      if (i >= 16 && i < 32) { assert.ok(Number.isFinite(L[i]) && Number.isFinite(Rc[i]), k + ' finite'); continue; }
      assert.equal(L[i], L0[i], k + ' L[' + i + '] outside the block');
      assert.equal(Rc[i], R0[i], k + ' R[' + i + '] outside the block');
    }
    // reset() → the next render equals a fresh module's render
    const go = (m) => { const X = noise(4096, 5), Y = noise(4096, 6); drive(m, R, X, Y, { poll: k === 'Convolve' }); return [X, Y]; };
    go(o); o.reset(); o.seed(0); o.snap();
    const a = go(o), f = fresh(M, k, R); f.seed(0); f.snap();
    const b = go(f);
    assert.deepEqual([arr(a[0]), arr(a[1])], [arr(b[0]), arr(b[1])], k + ' reset ≡ fresh');
  }
  assert.equal(S.logs.filter(l => l.level !== 'log').length, 0);
});

/* ------------------------------------------------------------------ Bode (§8.4) */

test('Bode: +100 Hz moves 1 kHz to 1100 Hz (image ≤ −40 dB, carrier gone); negative shifts; 30 Hz–15 kHz quadrature', () => {
  const { M } = scope();
  const N = FS, i0 = 4800;
  for (const [f0, shift, range] of [[1000, 1, 100], [1000, -1, 100], [100, 0.3, 100], [50, 0.2, 50], [5000, 0.5, 1000], [15000, -1, 1000], [440, 0.25, 40]]) {
    const R = unit(M, 'bode', { shift, range, mix: 1 }), b = fresh(M, 'Bode', R);
    const L = sine(N, f0), Rc = sine(N, f0);
    drive(b, R, L, Rc);
    const f1 = f0 + shift * range, im = f0 - shift * range;
    const a = amp(L, f1, i0, N), ai = amp(L, im, i0, N), ac = amp(L, f0, i0, N);
    assert.ok(Math.abs(a - 1) < 0.01, `${f0} → ${f1}: amplitude ${a}`);
    assert.ok(dB(ai / a) < -40, `${f0} ${shift * range}: image ${dB(ai / a).toFixed(1)} dB`);
    assert.ok(dB(ac / a) < -40, `${f0} ${shift * range}: carrier ${dB(ac / a).toFixed(1)} dB`);
    assert.ok(Math.abs(amp(Rc, f1, i0, N) - a) < 1e-9, 'DIR 100 %: both channels shift up');
  }
  // spectrum check: the strongest bin of the output is the shifted frequency
  const R = unit(M, 'bode', { shift: 1, range: 100 }), b = fresh(M, 'Bode', R), L = sine(N, 1000), Rc = sine(N, 1000);
  drive(b, R, L, Rc);
  let best = 0, bf = 0;
  for (let f = 800; f <= 1300; f += 10) { const a = amp(L, f, i0, N); if (a > best) { best = a; bf = f; } }
  assert.equal(bf, 1100);
});

test('Bode: the Hilbert pair is designed per rate (48 kHz: the listed set exactly; image ≤ −42 dB from 40 Hz to 18 kHz at 44.1–192 kHz)', () => {
  const { M } = scope({ fast: true });
  const b48 = new M.Bode(FS), A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737], B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278];
  assert.deepEqual([b48.ns, arr(b48.ca.subarray(0, 4)), arr(b48.cb.subarray(0, 4))], [4, A.map((a) => a * a), B.map((a) => a * a)]);
  assert.deepEqual([new M.Bode(44100).ns, new M.Bode(96000).ns, new M.Bode(192000).ns], [4, 5, 5]);
  for (const fs of [44100, 96000, 192000]) {
    for (const f0 of [40, 200, 1000, 10000, 18000]) {
      const R = unit(M, 'bode', { shift: 0.5, range: 100, mix: 1 }), b = fresh(M, 'Bode', R, fs), N = Math.round(fs * 1.2);
      const L = sine(N, f0, 1, fs), Rc = L.slice();
      drive(b, R, L, Rc);
      const i0 = Math.round(0.4 * fs), a = amp(L, f0 + 50, i0, N, fs), im = amp(L, f0 - 50, i0, N, fs);
      assert.ok(Math.abs(a - 1) < 0.02 && dB(im / a) < -42, `${fs} Hz, ${f0} Hz +50: ${a.toFixed(4)}, image ${dB(im / a).toFixed(1)} dB`);
    }
  }
});

test('Bode: FEEDBACK 100 % for 60 s of noise stays under a fixed ceiling (loop gain 0.995, the line write bounded like the Phase-1 Delay)', () => {
  const { M } = scope({ fast: true });
  for (const [shift, bal, blur] of [[0.2, 1, 0], [-0.03, -1, 0.5], [0.005, 1, 0]]) {
    const R = unit(M, 'bode', { shift, range: 100, delay: 100, feed: 1, bal, blur, mix: 1 }), b = fresh(M, 'Bode', R);
    const N = 60 * FS, X = noise(N, 9, 0.1), Y = noise(N, 10, 0.1);
    drive(b, R, X, Y);
    const p20 = maxAbs(X, 20 * FS, 40 * FS), p60 = maxAbs(X, 40 * FS, N);
    assert.ok(X.every(Number.isFinite) && maxAbs(X) < 8 && p60 < 1.25 * p20 + 0.5, `shift ${shift}: peaks ${p20.toFixed(2)} → ${p60.toFixed(2)} (max ${maxAbs(X).toFixed(2)})`);
  }
  // FEEDBACK 0.98: a spiral that decays (the echoes of a burst fall away)
  const R = unit(M, 'bode', { shift: 0.2, range: 100, delay: 100, feed: 0.98, bal: 1, mix: 1 }), b = fresh(M, 'Bode', R);
  const N = 30 * FS, X = new Float64Array(N), Y = new Float64Array(N);
  X.set(noise(FS / 10, 3, 0.5)); Y.set(noise(FS / 10, 4, 0.5));
  drive(b, R, X, Y);
  assert.ok(maxAbs(X, 25 * FS, N) < 0.5 * maxAbs(X, FS, 5 * FS), 'decays');
});

test('Bode: DIR / WIDTH channel rules, MONO INPUT, MIX-independent wet; the shifter phase and RETRIG seed', () => {
  const { M } = scope();
  const N = FS / 2, i0 = 4800, f0 = 1000, up = 1100, dn = 900;
  const run = (set, l = sine(N, f0), r = sine(N, f0)) => { const R = unit(M, 'bode', Object.assign({ shift: 1, range: 100 }, set)), b = fresh(M, 'Bode', R); drive(b, R, l, r); return [l, r]; };
  const lvl = (x, f) => amp(x, f, i0, N);
  // DIR d: L = d ≥ 0 ? up : (1 + d)·up − d·down, R = d ≤ 0 ? down : (1 − d)·down + d·up
  for (const [d, Lu, Ld, Ru, Rd] of [[1, 1, 0, 1, 0], [-1, 0, 1, 0, 1], [0, 1, 0, 0, 1], [0.5, 1, 0, 0.5, 0.5], [-0.5, 0.5, 0.5, 0, 1]]) {
    const [L, R] = run({ dir: d });
    const e = (x, w) => Math.abs(x - w) < 0.01;
    assert.ok(e(lvl(L, up), Lu) && e(lvl(L, dn), Ld) && e(lvl(R, up), Ru) && e(lvl(R, dn), Rd),
      `DIR ${d}: L ${lvl(L, up).toFixed(3)}/${lvl(L, dn).toFixed(3)} R ${lvl(R, up).toFixed(3)}/${lvl(R, dn).toFixed(3)}`);
  }
  // WIDTH w: L' = L·(1+w)/2 + R·(1−w)/2 — at DIR 0 and WIDTH 0 both channels carry half of each sideband
  const [L0, R0] = run({ dir: 0, width: 0 });
  for (const x of [L0, R0]) assert.ok(Math.abs(lvl(x, up) - 0.5) < 0.01 && Math.abs(lvl(x, dn) - 0.5) < 0.01);
  for (let i = 0; i < N; i++) if (Math.abs(L0[i] - R0[i]) > 1e-12) assert.fail('WIDTH 0 is mono at ' + i);
  // MONO INPUT: both shifters get (L + R)/2 — opposite-polarity input cancels; without it each channel shifts its own
  const neg = sine(N, f0, -1);
  const [Lm] = run({ mono: 1 }, sine(N, f0), neg.slice());
  assert.ok(maxAbs(Lm, i0) < 1e-9, 'mono sum of L and −L is silence');
  const [Ls, Rs] = run({ mono: 0 }, sine(N, f0), neg.slice());
  assert.ok(Math.abs(lvl(Ls, up) - 1) < 0.01 && Math.abs(lvl(Rs, up) - 1) < 0.01);
  // phase: θ advances by shift·range/fs per sample; seed(p) sets θ = 2π·p (RETRIG at note-on, §8.1 trigger)
  const R = unit(M, 'bode', { shift: 0.5, range: 100 }), b = fresh(M, 'Bode', R);
  b.seed(0.25);
  const X = new Float64Array(480), Y = new Float64Array(480);
  drive(b, R, X, Y);
  assert.ok(Math.abs(b.ph - (0.25 + 50 * 480 / FS)) < 1e-12, 'ph after 10 ms at 50 Hz: ' + b.ph);
  // shift 0: the output is the input phase-shifted by θ (up = I cos θ − Q sin θ = sin(ωt + φ + θ) for I = sin, Q = −cos);
  // at DC both allpass paths pass the input (I = Q = x): up = cos θ − sin θ
  const c = fresh(M, 'Bode', unit(M, 'bode', { shift: 0, range: 100 })), ph = (x) => { let re = 0, im = 0; for (let i = 4800; i < 9600; i++) { const w = 2 * Math.PI * 1000 * i / FS; re += x[i] * Math.cos(w); im += x[i] * Math.sin(w); } return Math.atan2(re, im); };
  const ref = sine(9600, 1000);
  c.reset(); c.seed(0);
  drive(c, unit(M, 'bode', { shift: 0, range: 100 }), ref, sine(9600, 1000));
  for (const p of [0.1, 0.25, 0.5]) {
    c.reset(); c.seed(p);
    const X = sine(9600, 1000);
    drive(c, unit(M, 'bode', { shift: 0, range: 100 }), X, sine(9600, 1000));
    let d = ph(X) - ph(ref) - 2 * Math.PI * p;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    assert.ok(Math.abs(d) < 0.01, `seed ${p}: phase error ${d}`);                  // the pair's ±0.7° quadrature
    c.reset(); c.seed(p);
    const D = new Float64Array(8000).fill(1), E = new Float64Array(8000).fill(1);
    drive(c, unit(M, 'bode', { shift: 0, range: 100 }), D, E);
    assert.ok(Math.abs(D[7999] - (Math.cos(2 * Math.PI * p) - Math.sin(2 * Math.PI * p))) < 1e-3, `seed ${p} at DC: ${D[7999]}`);
  }
});

test('Bode: delay line (ms and BPM ladder), BALANCE of the sidebands into it, feedback spirals and stays bounded, BLUR', () => {
  const { M } = scope();
  // shift 0: the shifter passes the input (up = down = x); the delay adds the echo after `delay` ms
  const R = unit(M, 'bode', { shift: 0, delay: 100, mix: 1 }), b = fresh(M, 'Bode', R);
  const N = 12000, L = new Float64Array(N), Rc = new Float64Array(N);
  L[0] = 1; Rc[0] = 1;
  drive(b, R, L, Rc);
  let pk = 0, at = 0;
  for (let i = 1000; i < N; i++) if (Math.abs(L[i]) > pk) { pk = Math.abs(L[i]); at = i; }
  assert.ok(Math.abs(at - 4800) <= 2 && pk > 0.3, `echo at ${at} (${pk.toFixed(3)})`);
  // BPM ladder: 1/4 at 120 BPM = 0.5 s (decimated line rate at 192 kHz: within 2 base samples)
  for (const fs of [FS, 192000]) {
    const Q = unit(M, 'bode', { shift: 0, delay: 0, bpm: 1, dlad: 7, mix: 1 }), q = fresh(M, 'Bode', Q, fs);
    const n = Math.ceil(0.6 * fs), X = new Float64Array(n), Y = new Float64Array(n);
    X[0] = 1; Y[0] = 1;
    drive(q, Q, X, Y);
    let p = 0, w = 0;
    for (let i = 100; i < n; i++) if (Math.abs(X[i]) > p) { p = Math.abs(X[i]); w = i; }
    assert.ok(Math.abs(w - 0.5 * fs) <= 8, fs + ': echo at ' + w);
    assert.ok(q.bytes() <= 1 << 20, fs + ' Hz: Bode ≤ 1 MB (' + q.bytes() + ')');
  }
  // BALANCE: −1 feeds only the down sideband to the delay, +1 only the up one
  for (const [bal, f] of [[-1, 900], [1, 1100]]) {
    const Q = unit(M, 'bode', { shift: 1, range: 100, delay: 200, bal, mix: 1, dir: 0 }), q = fresh(M, 'Bode', Q);
    const n = FS, X = sine(n, 1000), Y = sine(n, 1000);
    drive(q, Q, X, Y, { before: (s) => { if (s >= 4800) { X.fill(0, s); Y.fill(0, s); } } });
    const late = 9600 + 1000;                                 // inside the echo of the tone [9600, 14400), the dry tone stopped
    const a = amp(X, f, late, late + 2400), o = amp(X, f === 900 ? 1100 : 900, late, late + 2400);
    assert.ok(a > 0.3 && dB(o / a) < -30, `BALANCE ${bal}: ${a.toFixed(3)} / other ${dB(o / a).toFixed(1)} dB`);
  }
  // FEEDBACK 100 % with BLUR, 10 s of full-scale noise: finite and bounded; the echoes spiral (each pass shifted again)
  for (const blur of [0, 0.8]) {
    const Q = unit(M, 'bode', { shift: 0.3, range: 100, delay: 40, feed: 1, blur, mix: 1 }), q = fresh(M, 'Bode', Q);
    const X = noise(10 * FS, 9, 1), Y = noise(10 * FS, 10, 1);
    drive(q, Q, X, Y);
    assert.ok(maxAbs(X) < 40 && X.every(Number.isFinite), 'blur ' + blur + ' peak ' + maxAbs(X));
  }
  // spiral: BALANCE +1 (up sideband into the delay), 1 kHz burst [0, 2400): echo 1 = 1050 Hz, echo 2 = 0.7 × 1100 Hz, and
  // the shifter output of the fed-back echo 2 = 0.49 × 1150 Hz
  const Q = unit(M, 'bode', { shift: 1, range: 50, delay: 100, feed: 0.7, bal: 1, mix: 1 }), q = fresh(M, 'Bode', Q);
  const X = sine(FS / 2, 1000), Y = sine(FS / 2, 1000);
  drive(q, Q, X, Y, { before: (s) => { if (s >= 2304) { X.fill(0, s); Y.fill(0, s); } } });
  const e1 = amp(X, 1050, 5000, 6900), e2 = amp(X, 1100, 9800, 11700), e3 = amp(X, 1150, 9800, 11700);
  assert.ok(Math.abs(e1 - 1) < 0.05 && Math.abs(e2 - 0.7) < 0.05 && Math.abs(e3 - 0.49) < 0.05, `spiral ${e1.toFixed(3)} ${e2.toFixed(3)} ${e3.toFixed(3)}`);
  // BLUR modulates the allpass delays: the feedback echo of a click is smeared (more non-zero spread) than without
  const spread = (blur) => {
    const P = unit(M, 'bode', { shift: 0, delay: 50, feed: 0.8, blur, mix: 1 }), z = fresh(M, 'Bode', P);
    const A = new Float64Array(FS / 2), Z = new Float64Array(FS / 2);
    A[0] = 1; Z[0] = 1;
    drive(z, P, A, Z);
    let c = 0;
    for (let i = 4800; i < 7200; i++) if (Math.abs(A[i]) > 1e-3) c++;
    return c;
  };
  assert.ok(spread(1) > spread(0) + 20, `BLUR smears the echo (${spread(1)} vs ${spread(0)})`);
});

/* ------------------------------------------------------------------ Convolve (§8.4, §4.5) */

test('Convolve: a unit-impulse IR reproduces the input with zero latency for spans of 4, 17 and 128 frames; mono IR on both channels', () => {
  const { M, B } = scope();
  for (const [span, ch] of [[4, 2], [17, 2], [128, 1], [128, 2]]) {
    const id = `ir:unit${span}${ch}@48000~00000000`;
    B.storeAsset(id, irEntry(id, Float32Array.of(1), ch === 2 ? Float32Array.of(1) : null));
    const R = unit(M, 'conv', { irgain: 0 }, { irId: id }), c = fresh(M, 'Convolve', R);
    assert.equal(c.ready, 1);
    const x = noise(9000, span), y = noise(9000, span + 1), L = x.slice(), Rc = y.slice();
    drive(c, R, L, Rc, { span, poll: true });
    for (let i = 0; i < x.length; i++) {
      if (Math.abs(L[i] - x[i]) > 1e-6 || Math.abs(Rc[i] - y[i]) > 1e-6) assert.fail(`span ${span} ch ${ch}: sample ${i} differs`);
    }
  }
});

test('Convolve: head / middle / tail seams of a 4 s stereo IR equal a direct convolution (≤ −100 dB error)', () => {
  const { M, B } = scope({ fast: true });
  const n = 4 * FS, r = rng(7), hL = new Float32Array(n), hR = new Float32Array(n);
  for (let i = 0; i < n; i++) { const g = Math.exp(-3 * i / n); hL[i] = (2 * r() - 1) * g * 0.05; hR[i] = (2 * r() - 1) * g * 0.05; }
  const id = 'ir:long@48000~00000001';
  B.storeAsset(id, irEntry(id, hL, hR));
  const R = unit(M, 'conv', { irgain: 0 }, { irId: id, convMax: 10 }), c = fresh(M, 'Convolve', R);
  const N = 5 * FS, x = noise(N, 11, 1), y = noise(N, 12, 1), L = x.slice(), Rc = y.slice();
  drive(c, R, L, Rc, { span: 128, poll: true });
  const rl = convolve(x, hL, N), rr = convolve(y, hR, N);
  let e = 0, p = 0;
  for (let i = 0; i < N; i++) { e += (L[i] - rl[i]) ** 2 + (Rc[i] - rr[i]) ** 2; p += rl[i] ** 2 + rr[i] ** 2; }
  assert.ok(10 * Math.log10(e / p) < -100, 'error ' + (10 * Math.log10(e / p)).toFixed(1) + ' dB');
  // the seams themselves (IR offsets 128 and 8192, every tail partition start) carry no larger local error
  for (const s of [128, 8192, 8192 + 4096, 8192 + 5 * 4096]) {
    let le = 0, lp = 0;
    for (let i = s - 64; i < s + 64; i++) { le += (L[i] - rl[i]) ** 2; lp += rl[i] ** 2; }
    assert.ok(10 * Math.log10(le / lp) < -90, 'seam ' + s + ': ' + (10 * Math.log10(le / lp)).toFixed(1) + ' dB');
  }
  // the IR's partition spectra are assets (§14.2, excluded from bytes()); the instance owns its input spectra (the tail
  // frequency-domain delay line, Float32, as long as the IR: ≈ 8 B per IR frame and channel) plus < 1.5 MB of fixed buffers
  const own = c.bytes(), fdl = c.tXr.byteLength + c.tXi.byteLength, ent = B.getAsset(id);
  const spec = [0, 1].reduce((a, k) => a + ent.tp[k].re.byteLength + ent.tp[k].im.byteLength, 0);
  assert.equal(fdl, spec, 'input FDL = the size of the IR tail spectra');
  assert.ok(own - fdl < 1.5 * (1 << 20), `own ${own} B, FDL ${fdl} B`);
});

test('Convolve: pre-delay (ms, BPM), IR GAIN live; tail work spread over the 4096-frame period (max quantum ≤ 3 × mean)', () => {
  const { M, B } = scope({ fast: true });
  const id = 'ir:one@48000~00000002';
  B.storeAsset(id, irEntry(id, Float32Array.of(1), null));
  for (const [set, at] of [[{ pre: 10 }, 480], [{ pre: 0, prebpm: 1, prelad: 5 }, 6000]]) {   // 1/16 at 120 BPM = 125 ms
    const R = unit(M, 'conv', Object.assign({ irgain: -6 }, set), { irId: id }), c = fresh(M, 'Convolve', R);
    const L = new Float64Array(at + 500), Rc = new Float64Array(at + 500);
    L[0] = 1; Rc[0] = 1;
    drive(c, R, L, Rc, { poll: true });
    let k = 0;
    for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > Math.abs(L[k])) k = i;
    assert.equal(k, at);
    assert.ok(Math.abs(L[k] - Math.pow(10, -6 / 20)) < 1e-6, 'IR GAIN −6 dB: ' + L[k]);
  }
  // tail spread: per 128-frame quantum timing, median over periods per slot; worst slot ≤ 3 × mean (§14.1 row j)
  const n = 4 * FS, r = rng(3), h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = (2 * r() - 1) * Math.exp(-2 * i / n) * 0.05;
  const id2 = 'ir:spread@48000~00000003';
  B.storeAsset(id2, irEntry(id2, h, h));
  const R = unit(M, 'conv', {}, { irId: id2 }), c = fresh(M, 'Convolve', R);
  const P = 24, slots = Array.from({ length: 32 }, () => []), X = noise(128, 4), Y = noise(128, 5);
  for (let q = 0; q < 32 * (P + 4); q++) {
    const t0 = process.hrtime.bigint();
    for (let b = 0; b < 128; b += 16) { c.upd(R); c.run(R, X, Y, b, 16); }
    const t = Number(process.hrtime.bigint() - t0);
    if (q >= 32 * 4) slots[q % 32].push(t);
  }
  const med = slots.map(a => a.sort((x, y) => x - y)[a.length >> 1]), mean = med.reduce((a, b) => a + b, 0) / 32;
  assert.ok(Math.max(...med) <= 3 * mean, `worst slot ${Math.max(...med)} ns vs mean ${mean.toFixed(0)} ns`);
});

test('Convolve: adoption by reference without FFT of the IR; a new shape key crossfades over 20 ms (no click); missing IR', () => {
  const { S, M, B } = scope();
  const warns = () => S.logs.filter(l => l.level === 'warn').map(l => l.text);
  const mk = (id, g, len) => { const h = new Float32Array(len); h[0] = g; for (let i = 1; i < len; i++) h[i] = 0.3 * g * Math.exp(-i / 2000) * Math.cos(i / 7); B.storeAsset(id, irEntry(id, h, h)); return h; };
  const a = 'fir:Long/Concert Hall@48000~aaaaaaaa', b = 'fir:Long/Concert Hall@48000~bbbbbbbb';
  const hA = mk(a, 1, 20000), hB = mk(b, -0.5, 20000);
  const R = unit(M, 'conv', { irgain: 0 }, { irId: a }), c = fresh(M, 'Convolve', R);
  assert.equal(c.ent, B.getAsset(a), 'the stored entry itself (buffers adopted, not copied)');
  // set() adopts an entry stored before it (configuration time, the rack sizes the FDL right after): no truncation warning
  const c2 = new M.Convolve(FS);
  c2.set(R);
  assert.deepEqual([c2.ready, c2.short, c2.Qc], [1, 1, 0]);
  c2.want(); c2.size();
  assert.deepEqual([c2.short, c2.Qc > 0], [0, true]);
  assert.equal(warns().length, 0, 'no warning on the ordinary path (IR stored before set())');
  // count FFT calls: the adoption of an arriving entry runs none
  let calls = 0;
  for (const F of [c.F1, c.F2]) for (const f of ['rfwd', 'rinv', 'fwd', 'inv']) { const o = F[f].bind(F); F[f] = (...x) => { calls++; return o(...x); }; }
  const N = FS, x = sine(N, 220, 0.5), L = x.slice(), Rc = x.slice();
  const sw = 24064;                                            // a span boundary (188 × 128)
  drive(c, R, L, Rc, { poll: true, before: (s) => { if (s === sw) { const k = calls; R.irId = b; c.set(R); assert.equal(calls, k, 'set / adopt: no FFT'); } } });
  // before the switch: A; well after (≤ one tail period + 20 ms): B; in between: no click
  const ra = convolve(x, hA, N), rb = convolve(x, hB, N);
  let ea = 0;
  for (let i = 0; i < sw; i++) ea = Math.max(ea, Math.abs(L[i] - ra[i]));
  let eb = 0;
  const done = sw + 4096 + 960 + 128;
  for (let i = done + 4096; i < N; i++) eb = Math.max(eb, Math.abs(L[i] - rb[i]));
  assert.ok(ea < 1e-5 && eb < 1e-5, `A before ${ea}, B after ${eb}`);
  const steady = Math.max(maxStep(ra, 1000, sw), maxStep(rb, done, N));
  assert.ok(maxStep(L, sw - 10, done + 4096) <= 1.2 * steady, `no click: ${maxStep(L, sw - 10, done + 4096)} vs ${steady}`);
  // the fade lasts 20 ms: count samples between the IRs
  let mid = 0;
  for (let i = sw; i < N; i++) if (Math.abs(L[i] - ra[i]) > 1e-4 && Math.abs(L[i] - rb[i]) > 1e-4) mid++;
  assert.ok(Math.abs(mid - 960) <= 140, 'crossfade samples ' + mid);
  // a missing entry: not ready (the rack passes the input), adopted at the next epoch after it arrives
  const id = 'ir:late@48000~cccccccc', d = new M.Convolve(FS), Q = unit(M, 'conv', {}, { irId: id });
  d.set(Q); d.alloc();
  assert.deepEqual([d.ready, d.poll()], [0, false]);
  mk(id, 1, 300);
  assert.equal(d.poll(), true);
  // the tail FDL (§8.5): nothing is reserved while the entry is missing; an entry arriving after set() is adopted at once
  // (no allocation: its tail plays up to the FDL — `short`), and the next set-time sizing (the rack's set() / assets():
  // want() + size()) gives it its whole tail; from one IR length after the resize the output is the convolution again
  const zid = 'ir:size@48000~dddddddd', z = new M.Convolve(FS), Z = unit(M, 'conv', { irgain: 0 }, { irId: zid, convMax: 10 });
  z.set(Z); z.alloc(); z.upd(Z); z.snap();
  assert.deepEqual([z.Qc, z.qWant, z.fdlDelta()], [0, 0, 0], 'a missing entry reserves no tail FDL');
  assert.ok(z.bytes() < 1.5 * (1 << 20), 'fixed buffers only: ' + z.bytes());
  let hz = null, at = 0;
  const xz = noise(2 * FS, 31, 0.5), Lz = xz.slice(), Rz = xz.slice(), QZ = Math.ceil((30000 - 8192) / 4096);
  drive(z, Z, Lz, Rz, { poll: true, before: (s0) => {
    if (s0 === 6400) hz = mk(zid, 1, 30000);
    if (s0 === 12800) {
      assert.deepEqual([z.ready, z.short, z.Qc, z.S[z.cur].nT], [1, 1, 0, 0], 'adopted without its tail');
      assert.equal(warns().length, 1, 'adopted from process() and longer than the FDL: one warning (per scope)');
      assert.match(warns()[0], /Convolve IR arrived after set\(\)/);
      assert.equal(z.want(), QZ);
      assert.equal(z.fdlDelta(), 16 * QZ * 4097);
      z.size(); at = s0;
      assert.deepEqual([z.Qc, z.short, z.S[z.cur].nTe], [QZ, 0, QZ]);
    }
  } });
  assert.equal(z.S[z.cur].nT, QZ, 'the slot plays every tail partition from the next period on');
  const rz = convolve(xz, hz, 2 * FS);
  let ez = 0;
  for (let i = at + 30000 + 2 * 4096; i < 2 * FS; i++) ez = Math.max(ez, Math.abs(Lz[i] - rz[i]));
  assert.ok(ez < 1e-5, 'convolution after the resize: ' + ez);
  // the FDL follows what the stored entry and the slots need: another (short) IR and its crossfade → 0 partitions
  const sid = 'ir:size@48000~eeeeeeee';
  mk(sid, 1, 3000);
  Z.irId = sid; z.set(Z);
  const tz = noise(FS / 2, 32, 0.5);
  drive(z, Z, tz, tz.slice(), { poll: true });
  assert.equal(z.want(), 0);
  z.size();
  assert.equal(z.Qc, 0);
  // entries for another rate, non-IR entries and '' are never adopted
  const o = new M.Convolve(44100);
  o.set(unit(M, 'conv', {}, { irId: a }));
  assert.equal(o.ready, 0, 'rate mismatch');
  o.set(unit(M, 'conv', {}, { irId: '' }));
  assert.deepEqual([o.ready, o.ent], [0, null]);
});

test('Convolve: FXP.convMax caps the tail at once (§14.3 Q3); a dropped entry bypasses (§9.9), a superseded one chosen again keeps playing', () => {
  const { M, B } = scope({ fast: true });
  const n = 4 * FS, h = new Float32Array(n);
  h[0] = 0.5; h[Math.round(3.5 * FS)] = 1;                   // an echo at 3.5 s
  const id = 'ir:cap@48000~00000010';
  B.storeAsset(id, irEntry(id, h, h));
  const echo = (cm, later) => {
    const R = unit(M, 'conv', { irgain: 0 }, { irId: id, convMax: later ? 10 : cm }), c = fresh(M, 'Convolve', R);
    const N = 4 * FS, L = new Float64Array(N), Rc = new Float64Array(N);
    L[0] = 1; Rc[0] = 1;
    drive(c, R, L, Rc, { poll: true, before: (s0) => { if (later && s0 === FS) { R.convMax = cm; c.set(R); } } });
    return [maxAbs(L, 3.5 * FS - 2, 3.5 * FS + 3), maxAbs(L, 0, 4), c];
  };
  const [e10, d10, c10] = echo(10), [e2, d2, c2] = echo(2), [e2l] = echo(2, true);
  assert.ok(Math.abs(e10 - 1) < 1e-6 && Math.abs(d10 - 0.5) < 1e-6, 'convMax 10: the echo at 3.5 s ' + e10);
  assert.ok(e2 < 1e-9 && Math.abs(d2 - 0.5) < 1e-6, 'convMax 2: the tail ends by 2 s (+ one partition) ' + e2);
  assert.ok(e2l < 1e-9, 'a convMax change on a running instance applies at once (no rebuild needed) ' + e2l);
  assert.ok(c2.Qc <= Math.ceil((2 * FS - 8192) / 4096) && c2.Qc < c10.Qc / 1.5, `FDL sized for the cap: ${c2.Qc} vs ${c10.Qc}`);
  // §9.9: the adopted entry of the current id is dropped → not ready (the rack bypasses), the slots kept until release()
  const did = 'ir:del@48000~00000011', g = new Float32Array(2000);
  g[0] = 1;
  B.storeAsset(did, irEntry(did, g, g));
  const R = unit(M, 'conv', { irgain: 0 }, { irId: did }), c = fresh(M, 'Convolve', R);
  assert.equal(c.poll(), true);
  B.dropAsset(did);
  assert.deepEqual([c.poll(), c.ready, c.cur >= 0], [false, 0, true]);
  c.set(R);
  assert.equal(c.ready, 0, 'still not ready after another set()');
  c.release();
  assert.deepEqual([c.cur, c.ent, c.S[0].e, c.S[1].e], [-1, null, null, null], 'release() lets go of the dropped buffers');
  B.storeAsset(did, irEntry(did, g, g));
  assert.equal(c.poll(), true, 'stored again (relink): adopted');
  // a superseded shape variant (dropped by the host after the patch that replaced it) chosen again while it is rebuilt:
  // the instance keeps playing what it holds
  const a = 'ir:var@48000~0000000a', b = 'ir:var@48000~0000000b';
  B.storeAsset(a, irEntry(a, g, g));
  const V = unit(M, 'conv', {}, { irId: a }), v = fresh(M, 'Convolve', V);
  V.irId = b; v.set(V); B.dropAsset(a);
  assert.deepEqual([v.poll(), v.ent !== null], [true, true], 'the old entry plays while the new one is missing');
  V.irId = a; v.set(V);
  assert.deepEqual([v.poll(), v.held], [true, 1], 'back to the superseded id: still playing (held), not a deletion');
  B.storeAsset(a, irEntry(a, g, g));
  assert.deepEqual([v.poll(), v.held, v.ent], [true, 0, B.getAsset(a)]);
});

test('Convolve: the tail input line stays current while no IR has a tail (a long IR adopted later hears no old input)', () => {
  const { M, B } = scope({ fast: true });
  const ir = (seed, sec) => { const n = Math.round(sec * FS), r = rng(seed), h = new Float32Array(n); for (let i = 0; i < n; i++) h[i] = (2 * r() - 1) * Math.exp(-3 * i / n) * 0.05; return h; };
  const ids = ['ir:one@48000~00000021', 'ir:short@48000~00000022', 'ir:three@48000~00000023'];
  [ir(11, 1), ir(12, 0.1), ir(13, 1)].forEach((h, k) => B.storeAsset(ids[k], irEntry(ids[k], h, h)));
  const R = unit(M, 'conv', { irgain: 0 }, { irId: ids[0] }), c = fresh(M, 'Convolve', R);
  const N = 5 * FS, L = new Float64Array(N), Rc = new Float64Array(N), x = noise(FS / 2, 99, 0.5);
  L.set(x); Rc.set(x);                                        // 0.5 s of noise, then silence
  drive(c, R, L, Rc, { poll: true, before: (s0) => {
    if (s0 === 24064) { R.irId = ids[1]; c.set(R); }            // a short IR (no tail) at 0.5 s
    if (s0 === 144000) { R.irId = ids[2]; c.set(R); }           // a long one at 3 s, on silent input
  } });
  assert.ok(maxAbs(L, 1.5 * FS, 3 * FS) < 1e-9, 'silent after the short IR');
  assert.ok(maxAbs(L, 3 * FS, N) < 1e-9, 'no old input through the new tail: ' + maxAbs(L, 3 * FS, N));
});

/* ------------------------------------------------------------------ Utility (§8.4) */

test('Utility: neutral = identity (bit-exact), polarity, WIDTH (0 = mono, side × w), PAN law, MONO BASS, LPF / HPF and their off states', () => {
  const { M } = scope();
  const N = FS / 2, x = noise(N, 1), y = noise(N, 2);
  const run = (set, l = x.slice(), r = y.slice()) => { const R = unit(M, 'util', set), u = fresh(M, 'Utility', R); drive(u, R, l, r); return [l, r]; };
  const [a, b] = run({});
  assert.deepEqual([arr(a), arr(b)], [arr(x), arr(y)], 'defaults: identity');
  const [c, d] = run({ lpf: 20000, hpf: 1, width: 1, pan: 0 });
  assert.deepEqual([arr(c), arr(d)], [arr(x), arr(y)], 'LPF 20 kHz / HPF 1 Hz are off (bit-identical)');
  const [e, f] = run({ invL: 1 });
  assert.ok(e.every((v, i) => v === -x[i]) && f.every((v, i) => v === y[i]), 'INVERT L');
  const [g, h] = run({ invR: 1 });
  assert.ok(g.every((v, i) => v === x[i]) && h.every((v, i) => v === -y[i]), 'INVERT R');
  const [m0, m1] = run({ width: 0 });
  for (let i = 0; i < N; i++) if (Math.abs(m0[i] - m1[i]) > 1e-15 || Math.abs(m0[i] - 0.5 * (x[i] + y[i])) > 1e-15) assert.fail('WIDTH 0 = mono at ' + i);
  const [w0, w1] = run({ width: 2 });
  for (let i = 32; i < N; i++) if (Math.abs((w0[i] - w1[i]) - 2 * (x[i] - y[i])) > 1e-12 || Math.abs((w0[i] + w1[i]) - (x[i] + y[i])) > 1e-12) assert.fail('WIDTH 200 % at ' + i);
  // PAN: Phase-1 equal-power balance √2·cos / sin((p + 1)π/4)
  for (const p of [-1, -0.5, 0.5, 1]) {
    const [l, r] = run({ pan: p }), A = (p + 1) * Math.PI / 4;
    assert.ok(Math.abs(l[N - 1] - Math.SQRT2 * Math.cos(A) * x[N - 1]) < 1e-12 && Math.abs(r[N - 1] - Math.SQRT2 * Math.sin(A) * y[N - 1]) < 1e-12, 'PAN ' + p);
  }
  // MONO BASS: side below FREQ removed, side above kept; mid untouched in level
  const side = (f) => { const l = sine(N, f, 0.5), r = sine(N, f, -0.5); const [L, R] = run({ mbass: 1, mfreq: 120 }, l, r); return amp(L.map((v, i) => v - R[i]), f, 4800, N) / 1; };
  assert.ok(dB(side(30)) < -20, 'side at 30 Hz: ' + dB(side(30)).toFixed(1));
  assert.ok(Math.abs(dB(side(2000))) < 0.1, 'side at 2 kHz: ' + dB(side(2000)).toFixed(2));
  const [mm] = run({ mbass: 1, mfreq: 120 }, sine(N, 30, 0.5), sine(N, 30, 0.5));
  assert.ok(Math.abs(amp(mm, 30, 4800, N) - 0.5) < 0.005, 'mid at 30 Hz kept (LR4 low + high = allpass)');
  // LPF / HPF: 2-pole Butterworth, −3 dB at the corner
  const resp = (set, f) => { const [l] = run(set, sine(N, f), sine(N, f)); return dB(amp(l, f, 9600, N)); };
  assert.ok(Math.abs(resp({ lpf: 1000 }, 1000) + 3.01) < 0.2 && resp({ lpf: 1000 }, 8000) < -30 && Math.abs(resp({ lpf: 1000 }, 100)) < 0.1);
  assert.ok(Math.abs(resp({ hpf: 100 }, 100) + 3.01) < 0.2 && resp({ hpf: 100 }, 20) < -25 && Math.abs(resp({ hpf: 100 }, 2000)) < 0.1);
});

test('Utility: an LPF / HPF / MONO BASS stage switching on or off crossfades over 5 ms (no step beyond the signal\'s own)', () => {
  const { M } = scope();
  const N = FS / 2, sw = 12000;
  // [initial set, switched set, sine Hz, L = −R]
  const cases = [[{ mbass: 1, mfreq: 90 }, { mbass: 0, mfreq: 90 }, 90, 0], [{ mbass: 1, mfreq: 90 }, { mbass: 0, mfreq: 90 }, 90, 1],
    [{ mbass: 0, mfreq: 90 }, { mbass: 1, mfreq: 90 }, 90, 0], [{ lpf: 20000 }, { lpf: 19000 }, 100, 0], [{ lpf: 20000 }, { lpf: 19000 }, 1000, 0],
    [{ lpf: 19000 }, { lpf: 20000 }, 10000, 0], [{ lpf: 20000 }, { lpf: 300 }, 1000, 0], [{ hpf: 1 }, { hpf: 200 }, 100, 0], [{ hpf: 200 }, { hpf: 1 }, 100, 0]];
  for (const [a, b, f, inv] of cases) {
    const R = unit(M, 'util', a), u = fresh(M, 'Utility', R), L = sine(N, f, 0.5), Rc = sine(N, f, inv ? -0.5 : 0.5);
    const steady = maxStep(L, 100, sw);
    drive(u, R, L, Rc, { before: (s0) => { if (s0 === sw) { const Q = unit(M, 'util', b); R.ev.set(Q.ev); R.en.set(Q.en); } } });
    const step = Math.max(maxStep(L, sw - 8, sw + 960), maxStep(Rc, sw - 8, sw + 960)), ref = Math.max(steady, 0.5 * 2 * Math.PI * f / FS);
    assert.ok(step < 1.3 * ref, `${JSON.stringify(a)} → ${JSON.stringify(b)} at ${f} Hz${inv ? ' (L = −R)' : ''}: step ${step.toFixed(4)} vs ${ref.toFixed(4)}`);
  }
  // after the fade the switched-off stage is skipped (bit-exact identity again)
  const R = unit(M, 'util', { lpf: 1000 }), u = fresh(M, 'Utility', R), x = noise(N, 3), L = x.slice(), Rc = x.slice();
  drive(u, R, L, Rc, { before: (s0) => { if (s0 === 1280) { R.ev[M.PIDX.util.lpf] = 20000; R.en[M.PIDX.util.lpf] = 1; } } });
  assert.ok(L.subarray(4096).every((v, i) => v === x[4096 + i]), 'off after the fade: identity');
});

/* ------------------------------------------------------------------ S2 reverb tanks (§8.3) */

test('reverb tanks Vintage / Nitrous / Basin: finite, decaying (loop gain < 1), decorrelated (< 0.5), Nitrous modes differ, Basin infinite stays bounded; budgets', () => {
  const { M } = scope({ fast: true });
  const tail = (k, set, secs = 4) => {
    const R = unit(M, 'rev', set), t = fresh(M, k, R);
    const N = secs * FS, L = new Float64Array(N), Rc = new Float64Array(N);
    const n0 = noise(4800, 3, 1);
    L.set(n0); Rc.set(n0);
    drive(t, R, L, Rc);
    return [L, Rc, t];
  };
  for (const k of ['RevVintage', 'RevNitrous', 'RevBasin']) {
    const [L, R] = tail(k, { size: 0.5 });
    assert.ok(L.every(Number.isFinite) && R.every(Number.isFinite), k + ' finite');
    const w = Array.from({ length: 7 }, (_, j) => energy(L, 9600 + j * 24000, 33600 + j * 24000) + energy(R, 9600 + j * 24000, 33600 + j * 24000));
    for (let j = 1; j < w.length; j++) assert.ok(w[j] < w[j - 1] || w[j] < 1e-20, `${k}: decaying (${w.map(v => dB(Math.sqrt(v)).toFixed(0)).join(' ')})`);
    let sl = 0, sr = 0, slr = 0;
    for (let i = 9600; i < 48000; i++) { sl += L[i] * L[i]; sr += R[i] * R[i]; slr += L[i] * R[i]; }
    assert.ok(Math.abs(slr / Math.sqrt(sl * sr)) < 0.5, k + ' L/R correlation ' + (slr / Math.sqrt(sl * sr)).toFixed(3));
    // budget: one pool for the largest SIZE ≤ 2 MB at 192 kHz (Float32)
    const big = new M[k](192000);
    assert.ok(4 * big.need() <= 2 << 20, k + ' pool ' + 4 * big.need() + ' B at 192 kHz');
  }
  // Vintage DECAY: longer T60 with a larger decay
  const t60 = (k, set) => { const [L] = tail(k, set, 3); return energy(L, 96000, 144000) / energy(L, 4800, 52800); };
  assert.ok(t60('RevVintage', { decay: 0.8 }) > 10 * t60('RevVintage', { decay: 0.2 }));
  assert.ok(t60('RevNitrous', { feed: 0.9 }) > 10 * t60('RevNitrous', { feed: 0.4 }));
  // Nitrous modes: different delay sets ⇒ different tails
  const outs = [0, 1, 2, 3, 4].map(m => tail('RevNitrous', { nmode: m }, 1)[0]);
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    let d = 0;
    for (let i = 4800; i < 48000; i++) d += Math.abs(outs[a][i] - outs[b][i]);
    assert.ok(d > 1, `modes ${a} / ${b} differ`);
  }
  // Basin feedback ≥ 0.999: infinite (no decay) but bounded by the in-loop 1.5·tanh(x/1.5)
  const [L, R] = tail('RevBasin', { feed: 1 }, 8);
  const late = energy(L, 7 * FS, 8 * FS), early = energy(L, FS, 2 * FS);
  assert.ok(late > 0.05 * early && maxAbs(L) < 20 && maxAbs(R) < 20, `Basin infinite: ${dB(Math.sqrt(late / early)).toFixed(1)} dB, peak ${maxAbs(L).toFixed(2)}`);
  // Vintage ER SIZE 0: the taps keep their spacing (floored, IMPL), no zero-delay copy of the input, the wet level stays
  const erw = (ersize) => {
    const R = unit(M, 'rev', { ersize }), t = fresh(M, 'RevVintage', R), N = FS, L = new Float64Array(N), Rc = new Float64Array(N);
    L[0] = 1; Rc[0] = 1;
    drive(t, R, L, Rc);
    const X = noise(FS, 5, 0.5), Y = X.slice(), T = fresh(M, 'RevVintage', R);
    drive(T, R, X, Y);
    return [maxAbs(L, 0, 4), Math.sqrt(energy(X, FS / 4, FS))];
  };
  const [h0, w0] = erw(0), [, w5] = erw(0.5);
  assert.ok(h0 === 0 && Math.abs(dB(w0 / w5)) < 1, `ER SIZE 0: h[0..3] ${h0}, level ${dB(w0 / w5).toFixed(2)} dB re ER SIZE 50 %`);
  // the line capacities are computed once (constructor): bind() and need() build no array (a TYPE change installs a
  // tank inside process())
  for (const k of ['RevVintage', 'RevNitrous', 'RevBasin']) {
    const t = new M[k](FS), P = Object.getPrototypeOf(t), caps = P.caps;
    P.caps = () => { throw new Error(k + '.caps() after the constructor'); };
    try { assert.equal(t.bind(new Float32Array(t.need())), true); } finally { P.caps = caps; }
  }
  // bind(): a shared pool of ≥ need() floats is adopted (no own allocation counted), a short one is refused
  const v = new M.RevVintage(FS), pool = new Float32Array(v.need() + 10);
  assert.equal(v.bind(new Float32Array(v.need() - 1)), false);
  assert.equal(v.bind(pool), true);
  assert.equal(v.buf, pool);
  assert.ok(v.bytes() < 1024, 'a bound pool belongs to the unit');
});

/* ------------------------------------------------------------------ splitters (§8.4) */

test('splitter bands equal FXDSP.splitResponse; empty branches reconstruct the input (allpass-flat ±0.05 dB, M/S exact)', () => {
  const S = dspScope({ files: ['sx-base.js', 'fx-mods2.js', 'fx-dsp.js'] }), M = S.global('FXMods2'), F = S.global('FXDSP');
  const N = 16384, freqs = [20, 60, 150, 300, 700, 1500, 3000, 6000, 12000, 20000];
  for (const [k, t, f1, f2, nb] of [['XoverLH', 13, 300, 0, 2], ['XoverLMH', 14, 200, 2000, 3], ['XoverLMH', 14, 1000, 1100, 3]]) {
    const x = new M[k](FS);
    if (nb === 2) x.set(f1); else x.set(f1, f2);
    const L = new Float64Array(N), R = new Float64Array(N);
    L[0] = 1; R[0] = 1;
    const bands = Array.from({ length: 6 }, () => new Float64Array(N));
    for (let o = 0; o < N; o += 16) {
      const B = Array.from({ length: 6 }, () => new Float64Array(16));
      x.split(L, R, o, 16, ...B.slice(0, 2 * nb));
      for (let b = 0; b < 2 * nb; b++) bands[b].set(B[b], o);
    }
    const want = F.splitResponse(t, f1, f2, freqs, FS);
    for (let b = 0; b < nb; b++) {
      freqs.forEach((f, i) => {
        const got = dB(Math.max(mag(bands[2 * b], f), 1e-15));
        if (want[b][i] > -60) assert.ok(Math.abs(got - want[b][i]) < 0.01, `${k} band ${b} at ${f}: ${got.toFixed(3)} vs ${want[b][i].toFixed(3)}`);
        else assert.ok(got < -55, `${k} band ${b} at ${f} stopband ${got.toFixed(1)}`);
      });
      assert.deepEqual(arr(bands[2 * b]), arr(bands[2 * b + 1]), 'L and R bands identical for identical input');
    }
    const sum = new Float64Array(N);
    for (let b = 0; b < nb; b++) for (let i = 0; i < N; i++) sum[i] += bands[2 * b][i];
    for (const f of freqs) assert.ok(Math.abs(dB(mag(sum, f))) < 0.05, `${k} sum at ${f}: ${dB(mag(sum, f))}`);
  }
  // L/M/H keeps f2 ≥ 1.2·f1 and clamps to [10 Hz, 0.45·fs]
  const lmh = new M.XoverLMH(FS);
  lmh.set(1000, 500); assert.deepEqual([lmh.f1, lmh.f2], [1000, 1200]);
  lmh.set(NaN, 1e9); assert.deepEqual([lmh.f1, lmh.f2], [10, 0.45 * FS]);
  // M/S: branch 0 (m, m), branch 1 (s, −s); m₀ + s₀ / m₁ + s₁ give the input back exactly (rounding of halves only)
  const ms = new M.MS(FS), L = noise(64, 1), R = noise(64, 2), B = Array.from({ length: 4 }, () => new Float64Array(64));
  ms.split(L, R, 0, 64, ...B);
  for (let i = 0; i < 64; i++) {
    assert.equal(B[0][i], B[1][i]); assert.equal(B[2][i], -B[3][i]);
    assert.ok(Math.abs(B[0][i] + B[2][i] - L[i]) < 1e-15 && Math.abs(B[1][i] + B[3][i] - R[i]) < 1e-15);
  }
});

/* ------------------------------------------------------------------ Overdrive staging (§8.2 mode 16) */

test('Overdrive: the static chain equals FXDSP.distCurve(16, d, …, stages) and SxBase.shape(16) at one stage; 9 kHz per-stage low-pass', () => {
  const S = dspScope({ files: ['sx-base.js', 'fx-mods2.js', 'fx-dsp.js'] }), M = S.global('FXMods2'), F = S.global('FXDSP'), B = S.global('SxBase');
  for (const [d, st] of [[0, 1], [0.3, 4], [0.7, 4], [1, 16], [0.5, 2]]) {
    const curve = F.distCurve(16, d, null, null, 33, st);
    const od = new M.Overdrive(2 * FS);
    od.set(d, st);
    for (let i = 0; i < 33; i++) {
      const x = -1 + 2 * i / 32;
      od.reset();
      let y = 0;
      for (let k = 0; k < 4000; k++) y = od.tick(0, x);                    // DC: every low-pass settles
      assert.ok(Math.abs(y - curve[i]) < 1e-9, `d ${d} stages ${st} x ${x}: ${y} vs ${curve[i]}`);
      if (st === 1) assert.ok(Math.abs(y - B.shape(16, x, d)) < 1e-9);
    }
  }
  // the per-stage one-pole at 9 kHz (2× rate): small-signal gain at 20 kHz re 200 Hz = |H₉ₖ(20 kHz)|^stages
  const gain = (st, f) => {
    const od = new M.Overdrive(2 * FS);
    od.set(0, st);
    const X = sine(19200, f, 1e-4, 2 * FS);
    od.run(0, X, 0, 19200);
    return amp(X, f, 9600, 19200, 2 * FS);
  };
  const a9 = 1 - Math.exp(-2 * Math.PI * 9000 / (2 * FS)), w = 2 * Math.PI * 20000 / (2 * FS);
  const h9 = a9 / Math.hypot(1 - (1 - a9) * Math.cos(w), (1 - a9) * Math.sin(w));
  for (const st of [1, 2, 4]) {
    const r = gain(st, 20000) / gain(st, 200);
    assert.ok(Math.abs(r / Math.pow(h9, st) - 1) < 0.02, `stages ${st}: ${r.toFixed(4)} vs ${Math.pow(h9, st).toFixed(4)}`);
  }
  // channels are independent (state per channel); run(c, X, o, n) = tick per sample
  const a = new M.Overdrive(2 * FS), b = new M.Overdrive(2 * FS);
  a.set(0.6, 5); b.set(0.6, 5);
  const X = noise(256, 4), Y = X.slice();
  a.run(1, X, 0, 256);
  for (let i = 0; i < 256; i++) assert.equal(X[i], b.tick(1, Y[i]));
  // without SxBase the stage is the identity (the instance passes audio)
  const N = dspScope({ files: ['fx-mods2.js'] }).global('FXMods2'), z = new N.Overdrive(2 * FS);
  z.set(0.9, 8);
  assert.equal(z.tick(0, 0.37), 0.37);
});

/* ------------------------------------------------------------------ allocation-free hot paths (§0.3, Phase-1 §0.2) */

test('run / split / tick / poll and the adoption of an arriving IR allocate nothing (constructors banned in the scope)', () => {
  const { M, S, B } = scope();
  const id = 'ir:z@48000~22222222', e = irEntry(id, noise(20000, 1, 0.1), noise(20000, 2, 0.1));   // stored mid-run (below)
  const mods = MODULES.map(k => {
    const o = new M[k](FS), R = unit(M, TYPE_OF[k], k === 'Bode' ? { delay: 50, feed: 0.5, blur: 0.5 } : {}, { irId: k === 'Convolve' ? id : '' });
    o.set(R); o.alloc(); o.upd(R); return [o, R];
  });
  const cv = mods[MODULES.indexOf('Convolve')][0];
  assert.equal(cv.ready, 0);
  const xs = [new M.XoverLH(FS), new M.XoverLMH(FS), new M.MS(FS)], od = new M.Overdrive(2 * FS);
  od.set(0.4, 5);
  const L = noise(128, 1), R = noise(128, 2), bands = Array.from({ length: 6 }, () => new Float64Array(16));
  const ctx = S.ctx, names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Object', 'Set'];
  const saved = {};
  // constructing (new or call) throws; static members (Array.isArray, Float64Array.from) stay reachable
  const ban = k => { throw new Error('allocation: ' + k); };
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(ctx, k);       // (the sandbox normally has none: the builtin shows through)
    ctx[k] = new Proxy(S.run(k, 'builtin.js'), { construct: () => ban(k), apply: () => ban(k) });
  }
  try {
    for (let s = 0; s < 120; s++) {
      if (s === 10) B.storeAsset(id, e);                          // the entry arrives: the next poll() adopts it
      for (const [o, U] of mods) {
        if (o.poll) o.poll();
        U.ev[0] = 1;
        if (o instanceof M.Bode) U.ev[M.PIDX.bode.shift] = Math.sin(s / 9);
        for (let b = 0; b < 128; b += 16) { o.upd(U); o.run(U, L, R, b, 16); }
        o.flush();
        for (let i = 0; i < 128; i++) if (!Number.isFinite(L[i])) throw new Error('non-finite');
      }
      xs[0].set(100 + s); xs[0].split(L, R, 0, 16, ...bands.slice(0, 4));
      xs[1].set(200 + s, 2000); xs[1].split(L, R, 16, 16, ...bands);
      xs[2].split(L, R, 32, 16, ...bands.slice(0, 4));
      od.set(0.4 + 0.001 * s, 5); od.run(0, L, 0, 128); od.tick(1, 0.5);
      for (let i = 0; i < 128; i++) { L[i] *= 0.5; R[i] *= 0.5; }
    }
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(ctx, k, saved[k]); else delete ctx[k]; }
  }
  for (const k of names) assert.doesNotThrow(() => S.run('new ' + k + '()', 'after.js'), k + ' restored');
  assert.equal(cv.ready, 1, 'adopted without allocating');
});

/* ------------------------------------------------------------------ the Ducker (IMPL-SC §4.2; G3, lane D) */
// a sidechain context as the rack writes it (IMPL-SC §1.2): one ring for source `src`; duckDrive() fills the ring per quantum with
// the hits of [F0, F0 + 128) and stamps it (q = F0), writes sc.q / sc.F per call and sc.b per block, like Track.process + FXRack.span
const TAB_CLASSIC = renderPts(C.DUCK_DEFAULT, 1024), TAB_LIN = renderPts([[0, 0, 0], [1, 1, 0]], 1024);
function duckCtx(hits, src = 'k') {
  const ring = { q: -1, n: 0, f: new Float64Array(64), note: new Uint8Array(64), vel: new Float32Array(64) };
  return { ring, hits, sc: { q: 0, F: 0, b: 0, reg: new Map([[src, ring]]), kL: null, kR: null } };
}
// the Ducker over L / Rc (frame f0 + i at index i) in `span`-frame calls; o.upd per block, o.flush per call; stamp = false leaves the
// ring's q behind (a reader before its writer, §2.0)
function duckDrive(o, R, ctx, L, Rc, { f0 = 0, span = 128, stamp = true, before } = {}) {
  const { ring, sc, hits } = ctx;
  for (let s = 0; s < L.length; s += span) {
    const F0 = f0 + s, e = Math.min(L.length, s + span);
    let n = 0;
    for (const h of hits) if (h[0] >= F0 && h[0] < F0 + (e - s)) { ring.f[n] = h[0]; ring.note[n] = h[1]; ring.vel[n] = h[2]; n++; }
    ring.n = n; if (stamp) ring.q = F0; sc.q = F0; sc.F = F0;
    if (before) before(F0);
    for (let b = s; b < e; b += 16) { sc.b = b - s; o.upd(R); o.run(R, L, Rc, b, Math.min(16, e - b)); }
    o.flush();
  }
}
// a Ducker unit (values by pid) with its sidechain fields; `tab` installed through setTab (the FXT cv path)
function duck(M, set, ctx, { tab = TAB_CLASSIC, src = 'k', bpm = 120 } = {}) {
  const R = unit(M, 'duck', Object.assign({ bpm: 0, len: 100, att: 0, smooth: 0 }, set), { sc: ctx.sc, src, bpm });
  const o = fresh(M, 'Duck', R);
  if (tab) o.setTab(tab);
  return { o, R };
}
const ones = n => new Float64Array(n).fill(1);
const tabAt = (tab, x) => { const i = x | 0; return tab[i] + (tab[i + 1] - tab[i]) * (x - i); };
const LEN100 = Math.round(0.1 * FS);                        // LENGTH 100 ms in samples

test('IMPL-SC G3 Ducker: a trigger at frame f (att 0, smooth 0) — g leaves 1 at sample f exactly and follows 1 − depth·(1 − tab(pos)) per sample; the table from the FXT, all 1 before one', () => {
  const { M } = scope(), N = 4 * 128 * 20;
  for (const [f, depth, tab] of [[1000, 1, TAB_CLASSIC], [1003, 0.6, TAB_LIN], [2557, 1, TAB_LIN]]) {
    const ctx = duckCtx([[f, 36, 1]]), { o, R } = duck(M, { depth }, ctx, { tab }), L = ones(N), Rc = ones(N);
    duckDrive(o, R, ctx, L, Rc);
    for (let i = 0; i < f; i++) assert.equal(L[i], 1, 'untouched before the hit: ' + i);
    for (let k = 0; k < LEN100; k++) {
      const want = 1 - depth * (1 - tabAt(tab, 1024 * k / LEN100));
      assert.ok(Math.abs(L[f + k] - want) <= 1e-6 && L[f + k] === Rc[f + k], `sample ${k} of the dip: ${L[f + k]} vs ${want}`);
    }
    assert.ok(L[f] < 1 - 0.5 * depth, 'the dip starts at the hit\'s own sample');
    for (let i = f + LEN100; i < N; i++) assert.equal(L[i], 1, 'recovered exactly after LENGTH: ' + i);
  }
  // no table yet (a unit before its FXT): no dip at all; a table of ones the same
  const ctx = duckCtx([[1000, 36, 1]]), { o, R } = duck(M, {}, ctx, { tab: null }), L = ones(N), Rc = ones(N);
  duckDrive(o, R, ctx, L, Rc);
  assert.ok(L.every(v => v === 1) && Rc.every(v => v === 1), 'all 1 until a curve arrives');
});

test('IMPL-SC G3 Ducker: shift invariance — a hit at f and at f + 1000 (other call phases) render shifted-identical, 0 samples differ; with att 0 / smooth 0 and with the defaults (att 1 ms, smooth 2 ms)', () => {
  const { M } = scope(), N = 128 * 200;
  for (const set of [{ att: 0, smooth: 0 }, { att: 1, smooth: 2 }, { att: 5, smooth: 20, depth: 0.8 }]) {
    const f = 1037, d = 1000;
    const a = duckCtx([[f, 36, 1]]), A = duck(M, set, a), LA = ones(N), RA = ones(N);
    const b = duckCtx([[f + d, 36, 1]]), B = duck(M, set, b), LB = ones(N), RB = ones(N);
    duckDrive(A.o, A.R, a, LA, RA); duckDrive(B.o, B.R, b, LB, RB);
    // (an ATTACK ramp's first target is the current gain: with att > 0 the gain leaves 1 at the sample after the hit, §4.2)
    assert.ok(LA[f - 1] === 1 && LB[f + d - 1] === 1 && LA[f + 1] < 1 && LB[f + d + 1] < 1 && (set.att > 0 || (LA[f] < 1 && LB[f + d] < 1)), 'both dip at their own sample');
    let diff = 0, dips = 0;
    for (let i = f; i + d < N; i++) { if (!Object.is(LA[i], LB[i + d]) || !Object.is(RA[i], RB[i + d])) diff++; if (LA[i] < 1) dips++; }
    assert.equal(diff, 0, JSON.stringify(set) + ': shifted-identical');
    assert.ok(dips >= LEN100, 'a dip was rendered');
    assert.ok(LA.slice(f).some(v => v === 1), 'the recovery ends exactly at 1 (the per-sample snap)');
  }
});

test('IMPL-SC G3 Ducker: 16 hits ≥ LENGTH apart are identical; velocity is ignored (v 0.1 ≡ v 1.0); depth 0 is the identity; a retrigger mid-dip restarts from the current gain', () => {
  const { M } = scope(), gap = 8000, N = 17 * gap;
  const hits = Array.from({ length: 16 }, (_, k) => [500 + k * gap, 36, k & 1 ? 0.1 : 1]);
  const ctx = duckCtx(hits), { o, R } = duck(M, { att: 1, smooth: 2 }, ctx), L = ones(N), Rc = ones(N);
  duckDrive(o, R, ctx, L, Rc);
  const first = L.slice(500, 500 + gap);
  for (let k = 1; k < 16; k++) {
    const seg = L.slice(500 + k * gap, 500 + (k + 1) * gap);
    assert.ok(seg.every((v, i) => Object.is(v, first[i])), 'hit ' + k + ' (v ' + hits[k][2] + ') ≡ hit 0');
  }
  assert.ok(first.some(v => v < 0.1) && first[gap - 1] === 1, 'a full dip, recovered before the next');
  // depth 0: identity (bit for bit) even with hits
  const z = duckCtx(hits), Z = duck(M, { depth: 0 }, z), X = noise(N, 7), Y = noise(N, 8), X0 = X.slice(), Y0 = Y.slice();
  duckDrive(Z.o, Z.R, z, X, Y);
  assert.ok(X.every((v, i) => Object.is(v, X0[i])) && Y.every((v, i) => Object.is(v, Y0[i])), 'depth 0 = identity');
  // a retrigger mid-dip (att 0): the gain jumps back to the curve's start value; with smooth 0 and a hit at the dip's half
  const r = duckCtx([[1000, 36, 1], [1000 + (LEN100 >> 1), 36, 1]]), Rr = duck(M, {}, r), LR = ones(N), RR = ones(N);
  duckDrive(Rr.o, Rr.R, r, LR, RR);
  const c0 = 1 - (1 - TAB_CLASSIC[0]), h = 1000 + (LEN100 >> 1);
  assert.ok(LR[h - 1] > 0.3 && Math.abs(LR[h] - c0) <= 1e-6, `restart at the second hit: ${LR[h - 1]} → ${LR[h]} (c0 ${c0})`);
  assert.equal(LR[h + LEN100], 1, 'recovered LENGTH after the second hit');
});

test('IMPL-SC G3 Ducker: tempo sync — \'1/8\' at 90 / 124 / 174 bpm = 0.5 beats · 60 / bpm · fs ± 1 sample; LENGTH is captured at the trigger; the NOTE filter (37 → note 36 passes, 38 dropped; Any)', () => {
  const { M } = scope(), N = 128 * 200;
  for (const bpm of [90, 124, 174]) {
    const ctx = duckCtx([[600, 36, 1]]), { o, R } = duck(M, { bpm: 1, lad: 6 }, ctx, { tab: TAB_LIN, bpm }), L = ones(N), Rc = ones(N);
    duckDrive(o, R, ctx, L, Rc);
    let n = 0;
    for (let i = 0; i < N; i++) if (L[i] < 1) n++;
    const want = 0.5 * 60 / bpm * FS;
    assert.ok(Math.abs(n - want) <= 1, `1/8 at ${bpm} bpm: ${n} samples (want ${want})`);
    assert.ok(L[599] === 1 && L[600] < 1, 'from the hit');
  }
  // the length is read at the trigger: a tempo change during a dip changes the next dip only
  {
    const N2 = 128 * 320, ctx = duckCtx([[600, 36, 1], [14000, 36, 1]]), { o, R } = duck(M, { bpm: 1, lad: 6 }, ctx, { tab: TAB_LIN, bpm: 120 }), L = ones(N2), Rc = ones(N2);
    duckDrive(o, R, ctx, L, Rc, { before: F0 => { R.bpm = F0 >= 3000 ? 60 : 120; } });
    const dipLen = (from) => { let n = 0; for (let i = from; i < N2 && L[i] < 1; i++) n++; return n; };
    assert.deepEqual([dipLen(600), dipLen(14000)], [Math.round(0.25 * FS), Math.round(0.5 * FS)], 'the first dip at 120 bpm, the second at 60');
  }
  // NOTE: the filter names a MIDI note (enum k → note k − 1); hits of other notes are dropped; 0 = any
  for (const [note, pass] of [[37, true], [39, false], [0, true]]) {
    const ctx = duckCtx([[1000, 36, 1], [9000, 38, 1]]), { o, R } = duck(M, { note }, ctx), L = ones(N), Rc = ones(N);
    duckDrive(o, R, ctx, L, Rc);
    assert.equal(L[1000] < 1, pass, 'NOTE ' + note + ': the note-36 hit');
    assert.equal(L[9000] < 1, note === 0 || note === 39, 'NOTE ' + note + ': the note-38 hit');
  }
});

test('IMPL-SC G3 Ducker: the gr slots [reduction dB, position | −1, 0, 0]; no registry / no source / a ring not stamped for this quantum → the input × LEVEL (× 1: bit-identical); no allocation per quantum', () => {
  const { M, S } = scope(), N = 128 * 40, gr = new Float32Array(8);
  const ctx = duckCtx([[1000, 36, 1]]), { o, R } = duck(M, {}, ctx), L = ones(N), Rc = ones(N);
  o.meter(gr, 4);
  assert.deepEqual(Array.from(gr), [0, 0, 0, 0, 0, -1, 0, 0], 'idle: no reduction, playhead −1');
  duckDrive(o, R, ctx, L.subarray(0, 1024), Rc.subarray(0, 1024));
  o.meter(gr, 0);
  assert.ok(gr[0] > 6 && gr[1] > 0 && gr[1] < 1 && gr[2] === 0 && gr[3] === 0, 'mid-dip: ' + Array.from(gr.subarray(0, 4)));
  assert.ok(Math.abs(gr[0] + 20 * Math.log10(o.g)) < 1e-4 && Math.abs(gr[1] - o.k / o.len) < 1e-6, 'reduction of the gain, position k / len');
  // identity × LEVEL: (a) sc.reg null (a preview / resample node), (b) src '', (c) the ring's q is not this quantum's
  const X = noise(N, 11), Y = noise(N, 12);
  const same = (set, ctx2, opts, msg, lvl = 1) => {
    const { o: u, R: U } = duck(M, set, ctx2, Object.assign({}, opts)), A = X.slice(), B = Y.slice();
    duckDrive(u, U, ctx2, A, B, opts);
    assert.ok(A.every((v, i) => Object.is(v, X[i] * lvl)) && B.every((v, i) => Object.is(v, Y[i] * lvl)), msg);
  };
  const noReg = duckCtx([[1000, 36, 1]]); noReg.sc.reg = null;
  same({}, noReg, {}, 'reg null: identity');
  same({}, duckCtx([[1000, 36, 1]]), { src: '' }, 'no source: identity');
  same({}, duckCtx([[1000, 36, 1]]), { stamp: false }, 'unstamped ring: identity');
  same({ level: 0.25 }, noReg, {}, 'reg null, LEVEL 0.25: the input × 0.25', 0.25);
  // a live Ducker allocates nothing in upd / run / flush / meter (constructors banned in the scope)
  const live = duckCtx([[3000, 36, 1], [3100, 38, 0.5]]), { o: w, R: W } = duck(M, { att: 1, smooth: 2 }, live), LW = ones(128 * 40), RW = ones(128 * 40);
  noAlloc(S, () => { duckDrive(w, W, live, LW, RW); w.meter(gr, 0); });
  assert.ok(LW[3001] < 1, 'it ducked');
});
