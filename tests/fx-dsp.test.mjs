// fx-dsp.js unit tests (owner E4). Run: node --test tests/fx-dsp.test.mjs
// Covers SPEC-serum.md §10.5 items 1–17 (cited as §10.5.N) plus the §8.5 contract details: exports and arities, script
// shape, constants vs tests/fixtures/dests.json, lazy SerumDSP use, versioning, set(null)/reset/warmUp semantics,
// helpers (distCurve, eqResponse, delayFilterResponse, MODFX_HZ, filterImpulse), direct bus, order, power buttons,
// 22.05–192 kHz operation, transport/bounce equivalence (§10.7f at rack level), Hyper/Dimension character, CPU and
// bypass cost, memory budgets (incl. the FX filter's family pool), and the review-round-2 behaviour: reset / Panic /
// stop semantics, ducked re-seeds, compressor mode changes and multiband MIX, Distortion power glide, reverb type
// changes, warm-up coverage.
// Fixtures (E1, M1): fxp-default.json / fxt-default.json (compileFx(defaultFx()) / compileFxT) and dests.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadFixture } from './fixtures/load.mjs';

const SERUM_SRC = readFileSync(new URL('../serum-dsp.js', import.meta.url), 'utf8');
const FX_SRC = readFileSync(new URL('../fx-dsp.js', import.meta.url), 'utf8');
const DESTS = JSON.parse(readFileSync(new URL('./fixtures/dests.json', import.meta.url), 'utf8')).DESTS;
const FXP0 = loadFixture('fxp-default.json');
const FXT0 = loadFixture('fxt-default.json');
const FXD = DESTS.slice(148);                                   // FX segment, fx idx order
const FI = Object.fromEntries(FXD.map((d, k) => [d.id, k]));
const LAWS = ['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio', 'npitch'];
const MODS = ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'];
const ON = MODS.map((m) => FI['fx.' + m + '.on']);
const FS = 48000;

/* ------------------------------------------------------------------ helpers */
function mkConsole() {
  const msgs = [];
  const rec = (level) => (...a) => msgs.push({ level, text: a.map(String).join(' ') });
  return { log: rec('log'), info: rec('info'), warn: rec('warn'), error: rec('error'), msgs };
}
function loadDSP({ serum = true, ctx = vm.createContext({ console: mkConsole() }) } = {}) {
  if (serum) vm.runInContext(SERUM_SRC, ctx, { filename: 'serum-dsp.js' });
  vm.runInContext(FX_SRC, ctx, { filename: 'fx-dsp.js' });
  return { ctx, SerumDSP: ctx.SerumDSP, FXDSP: ctx.FXDSP };
}
const { FXDSP: FX, SerumDSP: SD } = loadDSP();

// compiled default FXP with overrides { destId: n } (+ extra top-level fields); alloc follows the enables (compileFx)
function fxp(over = {}, extra = {}) {
  const p = structuredClone(FXP0);
  for (const [id, n] of Object.entries(over)) {
    if (!(id in FI)) throw new Error('unknown FX dest ' + id);
    p.base[FI[id]] = n;
  }
  for (let m = 0; m < 10; m++) p.alloc[m] = p.base[ON[m]] >= 0.5 ? 1 : 0;
  return Object.assign(p, extra);
}
const LO = (id) => FXD[FI[id]].lo, HI = (id) => FXD[FI[id]].hi;
const nLin = (id, v) => (v - LO(id)) / (HI(id) - LO(id));
const nExp = (id, v) => Math.log(v / LO(id)) / Math.log(HI(id) / LO(id));
const vExp = (id, n) => LO(id) * Math.pow(HI(id) / LO(id), n);
const nPow4 = (id, v) => Math.pow((v - LO(id)) / (HI(id) - LO(id)), 0.25);

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function noise(n, seed = 1, amp = 1) { const r = rng(seed), a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = (2 * r() - 1) * amp; return a; }
function sine(n, f, amp = 1, fs = FS, ph = 0) { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * f * i / fs + ph); return a; }
function imp(n, at = 0, v = 1) { const a = new Float64Array(n); a[at] = v; return a; }
// process whole buffers in spans of `span` frames
function run(rack, L, R, { span = 128, dL, dR, before } = {}) {
  for (let o = 0; o < L.length; o += span) {
    const m = Math.min(span, L.length - o);
    if (before) before(o, m);
    rack.process(L.subarray(o, o + m), R.subarray(o, o + m), m, dL && dL.subarray(o, o + m), dR && dR.subarray(o, o + m));
  }
}
function rack(p = null, t = FXT0, fs = FS, ns = FX) { const r = new ns.FXRack(fs); r.set(p, t); return r; }
const dB = (x) => 20 * Math.log10(x);
const peak = (a, i0 = 0, i1 = a.length) => { let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const rms = (a, i0 = 0, i1 = a.length) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / (i1 - i0)); };
const maxStep = (a, i0 = 1, i1 = a.length) => { let m = 0; for (let i = Math.max(1, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
function sameBits(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false; return true; }
function mag(h, f, fs = FS) { // |DTFT| at f Hz
  let re = 0, im = 0;
  const w = -2 * Math.PI * f / fs;
  for (let n = 0; n < h.length; n++) { re += h[n] * Math.cos(w * n); im += h[n] * Math.sin(w * n); }
  return Math.hypot(re, im);
}
function fftMag(x, N) { // magnitude spectrum of x[0..N) (N power of two), bins 0..N/2
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N && i < x.length; i++) re[i] = x[i];
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}
const logFreqs = (f0, f1, n) => Array.from({ length: n }, (_, i) => f0 * Math.pow(f1 / f0, i / (n - 1)));
function corr(a, b, i0 = 0, i1 = a.length) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = i0; i < i1; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb);
}

/* ------------------------------------------------------------------ loading, shape, constants */

test('§10.5.1 loads in vm after serum-dsp (twice → no throw) and exports the §8.5.1 API', () => {
  const con = mkConsole(), ctx = vm.createContext({ console: con });
  vm.runInContext(SERUM_SRC, ctx);
  const before = new Set(Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)));
  vm.runInContext(FX_SRC, ctx, { filename: 'fx-dsp.js' });
  const F = ctx.FXDSP;
  assert.ok(F && Object.isFrozen(F));
  const added = Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)).filter((k) => !before.has(k));
  assert.deepEqual(added, ['FXDSP'], 'nothing but FXDSP leaks into the global scope');
  assert.doesNotThrow(() => vm.runInContext(FX_SRC, ctx));
  assert.doesNotThrow(() => vm.runInContext(SERUM_SRC, ctx));
  assert.doesNotThrow(() => vm.runInContext(FX_SRC, ctx));
  assert.ok(ctx.FXDSP && ctx.FXDSP !== F, 're-evaluation publishes a fresh FXDSP');
  assert.equal(F.VER, 1);
  const fns = { FXRack: 1, distCurve: 4, eqResponse: 4, delayFilterResponse: 4, MODFX_HZ: 3, filterImpulse: 7 };
  for (const [k, n] of Object.entries(fns)) { assert.equal(typeof F[k], 'function', k); assert.equal(F[k].length, n, k + ' arity'); }
  const rp = { set: 2, setMods: 1, process: 5, trigger: 0, reset: 1, idle: 0, gr: 0, phases: 0, transport: 0, warmUp: 0, bytes: 0 };
  for (const [k, n] of Object.entries(rp)) assert.equal(F.FXRack.prototype[k].length, n, 'FXRack.' + k);
  const r = new F.FXRack(48000);
  assert.equal(r.latency, 0);
  const tag = (x) => Object.prototype.toString.call(x);
  assert.ok(tag(r.gr()) === '[object Float32Array]' && r.gr().length === 4);
  assert.ok(tag(r.phases()) === '[object Float64Array]' && r.phases().length === 4);
  assert.equal(r.gr(), r.gr(), 'reused arrays (no allocation when the engine polls them)');
  assert.equal(r.idle(), true);
  assert.equal(con.msgs.filter((m) => m.level === 'error').length, 0);
  // a copy that throws inside its body leaves FXDSP = null and does not throw out of runInContext
  const broken = FX_SRC.replace('try {', 'try {\n    throw new Error(\'boom\');');
  assert.notEqual(broken, FX_SRC);
  assert.doesNotThrow(() => vm.runInContext(broken, ctx));
  assert.equal(ctx.FXDSP, null);
  assert.ok(con.msgs.some((m) => m.level === 'error' && m.text.includes('fx-dsp: load failed')));
});

test('source follows the DSP script rules (IIFE, environment neutrality, no eval/instanceof/Math.random)', () => {
  const code = FX_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = code.trim();
  assert.ok(body.startsWith('(function () {') && body.endsWith('})();'), 'file is one IIFE');
  assert.match(body, /^\(function \(\) \{\s*'use strict';/);
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window',
    'document', 'self', 'eval', 'instanceof', 'import', 'export', 'with']) {
    assert.doesNotMatch(code, new RegExp('\\b' + w + '\\b'), w);
  }
  assert.doesNotMatch(code, /new\s+Function/);
  assert.doesNotMatch(code, /Math\.random/);
  // SerumDSP is only read inside functions (Filt.alloc, filterImpulse)
  const uses = code.split('\n').filter((l) => l.includes('SerumDSP'));
  assert.equal(uses.length, 2);
  for (const l of uses) assert.match(l, /^\s{6,}const S = globalThis\.SerumDSP;/);
});

test('loads without SerumDSP: the Filter module never enables, filterImpulse → null; SerumDSP is resolved lazily', () => {
  const ctx = vm.createContext({ console: mkConsole() });
  vm.runInContext(FX_SRC, ctx);
  const F = ctx.FXDSP;
  assert.ok(F);
  assert.equal(F.filterImpulse(1, 1000, 0, 0, 0, 48000, 64), null);
  const p = fxp({ 'fx.fil.on': 1, 'fx.fil.cutoff': 0.2 });
  const r = rack(p, null, FS, F);
  const L = noise(2048, 3), R = noise(2048, 4), L0 = L.slice(), R0 = R.slice();
  run(r, L, R);
  assert.ok(sameBits(L, L0) && sameBits(R, R0), 'no SFilter → module stays off, audio untouched');
  // SerumDSP arriving later: the next allocation picks it up
  vm.runInContext(SERUM_SRC, ctx);
  assert.equal(F.filterImpulse(1, 1000, 0, 0, 0, 48000, 64).length, 64);
  const r2 = rack(p, null, FS, F);
  const L2 = noise(2048, 3), R2 = noise(2048, 4);
  run(r2, L2, R2);
  assert.ok(rms(L2) < 0.5 * rms(L0), 'filter active once SerumDSP exists');
});

test('FIDX / LAW_TAB_FX equal the FX segment of tests/fixtures/dests.json (§3.13)', () => {
  const F = FX.FIDX, T = FX.LAW_TAB_FX;
  assert.ok(Object.isFrozen(F) && Object.isFrozen(T));
  assert.equal(Object.keys(F).length, 100);
  const name = (id) => id.replace(/^fx\./, '').toUpperCase().replace(/\./g, '_');
  FXD.forEach((d, k) => {
    assert.equal(F[name(d.id)], k, d.id);
    assert.equal(LAWS[T.law[k]], d.law, d.id + ' law');
    assert.ok(Math.abs(T.lo[k] - d.lo) <= 1e-12 * Math.max(1, Math.abs(d.lo)), d.id + ' lo');
    assert.ok(Math.abs(T.hi[k] - d.hi) <= 1e-12 * Math.max(1, Math.abs(d.hi)), d.id + ' hi');
    assert.equal(T.cont[k], ['int', 'enum', 'bool'].includes(d.law) ? 0 : 1, d.id + ' cont');
  });
  const spot = { G_MASTER: 0, HYPER_ON: 1, DIST_DRIVE: 11, DLY_TIMEL: 43, CMP_ATT: 54, FIL_CUTOFF: 79, G_BYPASS: 86,
    HYPER_RETRIG: 87, DIST_MODE: 88, DLY_MODE: 95, FIL_TYPE: 99 };
  for (const [k, v] of Object.entries(spot)) assert.equal(F[k], v, k);
  assert.equal(T.law.length, 100);
  // compiled-default fixture is what the rack is built for
  assert.equal(FXP0.ver, FX.VER);
  assert.equal(FXP0.base.length, 100);
});

/* ------------------------------------------------------------------ §10.5.1 output stage */

test('§10.5.1 set(defaultFXP) / set(null) leave L/R bit-identical; master 0.7 → ×0.343; g.bypass gate', () => {
  for (const p of [FXP0, null]) {
    const r = rack(p);
    const L = noise(9600, 1), R = noise(9600, 2), L0 = L.slice(), R0 = R.slice();
    run(r, L, R);
    assert.ok(sameBits(L, L0) && sameBits(R, R0), 'bit-identical for ' + (p ? 'defaultFXP' : 'null'));
    r.set(null);
    run(r, L, R);
    assert.ok(sameBits(L, L0) && sameBits(R, R0));
    assert.equal(r.idle(), true);
  }
  // master: first set snaps
  const pm = fxp({}); pm.base[0] = 0.7;
  let r = rack(pm);
  let L = new Float64Array(4800).fill(0.5), R = new Float64Array(4800).fill(-0.25);
  run(r, L, R);
  assert.ok(Math.abs(L[0] / 0.5 - 0.343) < 1e-6 && Math.abs(L[4799] / 0.5 - 0.343) < 1e-6);
  assert.ok(Math.abs(R[4799] / -0.25 - 0.343) < 1e-6);
  // master change while running: smoothed (no step), reaches 0.343 after the ramp
  r = rack(FXP0);
  L = new Float64Array(48000).fill(0.5); R = L.slice();
  r.set(pm);
  run(r, L, R);
  assert.ok(maxStep(L) < 0.01, 'master ramps');
  assert.ok(Math.abs(L[47999] / 0.5 - 0.343) < 1e-6, 'gain after the ramp ' + L[47999] / 0.5);
  // bypass gate: 5 ms fade to 0 (+1 sample), back after it is off
  r = rack(FXP0);
  const pb = fxp({ 'g.bypass': 1 }), N = 4800;
  L = new Float64Array(N).fill(0.5); R = L.slice();
  run(r, L.subarray(0, 128), R.subarray(0, 128));
  r.set(pb);
  run(r, L.subarray(128), R.subarray(128));
  const fade = Array.from(L.subarray(128));
  const z = fade.findIndex((v) => v === 0);
  assert.ok(z > 200 && z <= 241, 'reaches 0 within 5 ms + 1 sample (' + z + ')');
  assert.ok(fade.slice(z).every((v) => v === 0), 'stays at 0');
  for (let i = 1; i < z; i++) assert.ok(fade[i] <= fade[i - 1] + 1e-15, 'monotone fade');
  L = new Float64Array(N).fill(0.5); R = L.slice();
  r.set(fxp({}));
  run(r, L, R);
  assert.equal(L[0] > 0 && L[0] < 0.01, true);
  assert.ok(L.slice(241).every((v) => v === 0.5), 'returns to unity after the 5 ms fade');
  assert.equal(r.idle(), true);
});

/* ------------------------------------------------------------------ §10.5.2–3 Delay */

test('§10.5.2 MIX law and LEVEL trim (Delay, feed 0, mix 0.5, Q n 1)', () => {
  const base = { 'fx.dly.on': 1, 'fx.dly.feed': 0, 'fx.dly.mix': 0.5, 'fx.dly.q': 1 };
  for (const [lv, g] of [[0.5, 1], [1, 4]]) {
    const r = rack(fxp({ ...base, 'fx.dly.level': lv }));
    const L = imp(30000), R = imp(30000);
    run(r, L, R);
    assert.ok(Math.abs(L[0] - 0.75 * g) < 1e-3 * g, 'dry tap ' + L[0]);
    assert.ok(Math.abs(L[24000] - 0.5 * g) < 1e-3 * g, 'echo ' + L[24000]);
    assert.ok(Math.abs(R[24000] - 0.5 * g) < 1e-3 * g);
    let other = 0;
    for (let i = 1; i < 30000; i++) if (i !== 24000) other = Math.max(other, Math.abs(L[i]));
    assert.ok(other < 1e-9, 'nothing else ' + other);
    if (g === 4) assert.ok(Math.abs(dB(L[24000] / 0.5) - 12.04) < 0.01, '+12.04 dB at LEVEL n 1');
  }
});

test('§10.5.3 Delay sync (500 ms, ×1.5), Ping-Pong, Tap->Delay, band filter response', () => {
  const flat = { 'fx.dly.on': 1, 'fx.dly.feed': 0, 'fx.dly.mix': 1, 'fx.dly.q': 1 };
  const echoAt = (L, from = 10) => { let k = from; for (let i = from; i < L.length; i++) if (Math.abs(L[i]) > Math.abs(L[k])) k = i; return k; };
  // 120 BPM, BPM on (default), n 0.625 → 1/4 = 500 ms
  let r = rack(fxp(flat, { bpm: 120 }));
  let L = imp(40000), R = imp(40000);
  run(r, L, R);
  assert.ok(Math.abs(echoAt(L) - 24000) <= 1 && Math.abs(echoAt(R) - 24000) <= 1, 'echo at 500 ms');
  // offset ×1.5 → 750 ms (both channels; RIGHT follows LEFT with LINK)
  r = rack(fxp({ ...flat, 'fx.dly.offL': 1, 'fx.dly.link': 1 }));
  L = imp(40000); R = imp(40000);
  run(r, L, R);
  assert.ok(Math.abs(echoAt(L) - 36000) <= 1 && Math.abs(echoAt(R) - 36000) <= 1, 'echo at 750 ms');
  // 90 BPM: 1/4 = 666.7 ms
  r = rack(fxp(flat, { bpm: 90 }));
  L = imp(40000); R = imp(40000);
  run(r, L, R);
  assert.ok(Math.abs(echoAt(L) - 32000) <= 1);
  // Ping-Pong: mono sum into L; L feeds R, R feeds L
  r = rack(fxp({ ...flat, 'fx.dly.mode': 0.5, 'fx.dly.feed': 0.5 }));
  L = imp(80000); R = new Float64Array(80000);
  run(r, L, R);
  assert.ok(Math.abs(L[24000] - 0.5) < 1e-3 && Math.abs(R[24000]) < 1e-6, 'first echo left');
  assert.ok(Math.abs(R[48000] - 0.25) < 1e-3 && Math.abs(L[48000]) < 1e-6, 'second echo right');
  assert.ok(Math.abs(L[72000] - 0.125) < 1e-3 && Math.abs(R[72000]) < 1e-6, 'third echo left');
  // Tap->Delay: L time 100 ms once (no feedback), then repeats at R time 300 ms; both outputs to both channels
  const nT = (ms) => nPow4('fx.dly.timeL', ms);
  r = rack(fxp({ ...flat, 'fx.dly.mode': 1, 'fx.dly.bpm': 0, 'fx.dly.feed': 0.5, 'fx.dly.timeL': nT(100), 'fx.dly.timeR': nT(300) }));
  L = imp(60000); R = imp(60000);
  run(r, L, R);
  const at = (i) => peak(L, i - 2, i + 3);
  assert.ok(Math.abs(at(4800) - 1) < 1e-3, 'tap at L time');
  assert.ok(at(9600) < 1e-6 && at(14400) < 1e-6, 'L line fires once, nothing at the bare R time');
  assert.ok(Math.abs(at(19200) - 1) < 1e-3 && Math.abs(at(33600) - 0.5) < 1e-3 && Math.abs(at(48000) - 0.25) < 1e-3, 'R repeats');
  assert.ok(sameBits(L, R), 'mono output');
  // band filter at the default Q (6.8 oct) and F (848.5 Hz): measured echo spectrum = delayFilterResponse (0.1 dB)
  r = rack(fxp({ 'fx.dly.on': 1, 'fx.dly.feed': 0, 'fx.dly.mix': 1 }));
  L = imp(24000 + 32768); R = imp(24000 + 32768);
  run(r, L, R);
  const h = L.subarray(24000), fr = logFreqs(20, 20000, 40);
  const want = FX.delayFilterResponse(vExp('fx.dly.freq', 0.5), 6.8, Float64Array.from(fr), FS);
  fr.forEach((f, i) => assert.ok(Math.abs(dB(mag(h, f)) - want[i]) < 0.1, f.toFixed(0) + ' Hz: ' + dB(mag(h, f)) + ' vs ' + want[i]));
  assert.ok(want[0] < -20 && want[39] < -6 && Math.abs(want[15]) < 1, 'band shape (HP ≈ 80 Hz, LP ≈ 8.9 kHz)');
  assert.ok(FX.delayFilterResponse(850, 8.2, Float64Array.from(fr), FS).every((v) => v === 0), 'flat when bypassed');
});

test('Delay time changes slew (≤ 1 sample per sample) and feed 1 stays bounded', () => {
  const base = { 'fx.dly.on': 1, 'fx.dly.mix': 1, 'fx.dly.q': 1, 'fx.dly.bpm': 0, 'fx.dly.feed': 0 };
  const r = rack(fxp({ ...base, 'fx.dly.timeL': nPow4('fx.dly.timeL', 200), 'fx.dly.link': 1 }));
  const L = sine(48000, 220, 0.5), R = L.slice();
  run(r, L.subarray(0, 24000), R.subarray(0, 24000));
  r.set(fxp({ ...base, 'fx.dly.timeL': nPow4('fx.dly.timeL', 50), 'fx.dly.link': 1 }));
  run(r, L.subarray(24000), R.subarray(24000));
  // read position glides: no discontinuity larger than the sine's slope at double speed
  assert.ok(maxStep(L, 24000, 48000) < 2.2 * 0.5 * 2 * Math.PI * 220 / FS + 1e-6, 'glide ' + maxStep(L, 24000, 48000));
  // feed 1, filter bypassed, full-scale noise for 10 s: bounded by the soft safety limit
  const r2 = rack(fxp({ ...base, 'fx.dly.feed': 1, 'fx.dly.timeL': 0, 'fx.dly.offL': 0, 'fx.dly.link': 1 }));
  const N = 10 * FS, A = noise(N, 7), B = noise(N, 8);
  run(r2, A, B);
  assert.ok(A.every(Number.isFinite) && peak(A) < 6 && peak(B) < 6, 'bounded ' + peak(A));
});

/* ------------------------------------------------------------------ §10.5.4 EQ */

test('§10.5.4 EQ: Peak +12 dB at 1 kHz; eqResponse equals the module (0.1 dB, 20 Hz–20 kHz) for every band type', () => {
  const fr = Float64Array.from(logFreqs(20, 20000, 48));
  const cases = [
    { typeL: 0.5, freqL: nExp('fx.eq.freqL', 1000), qL: 0.6, gainL: nLin('fx.eq.gainL', 12), typeH: 0, gainH: 0.5 },
    { typeL: 0, freqL: 0.333, qL: 0.3, gainL: nLin('fx.eq.gainL', -9), typeH: 0, freqH: 0.666, qH: 0.8, gainH: nLin('fx.eq.gainH', 7) },
    { typeL: 1, freqL: 0.2, qL: 0.7, typeH: 1, freqH: 0.8, qH: 0.2 },
    { typeL: 0.5, freqL: 0.5, qL: 1, gainL: 0.1, typeH: 0.5, freqH: 0.75, qH: 0.4, gainH: 0.95 },
  ];
  for (const c of cases) {
    const over = { 'fx.eq.on': 1 };
    for (const [k, v] of Object.entries(c)) over['fx.eq.' + k] = v;
    const p = fxp(over), r = rack(p);
    const L = imp(65536), R = imp(65536);
    run(r, L, R);
    const want = FX.eqResponse(p, null, fr, FS);
    fr.forEach((f, i) => {
      if (want[i] < -60) return;
      const got = dB(mag(L, f));
      assert.ok(Math.abs(got - want[i]) < 0.1, JSON.stringify(c) + ' ' + f.toFixed(0) + ' Hz: ' + got + ' vs ' + want[i]);
    });
    if (c === cases[0]) {
      const g1k = dB(mag(L, 1000));
      assert.ok(Math.abs(g1k - 12) < 0.3, 'peak +12 dB at 1 kHz: ' + g1k);
      // other argument forms: snapshot eff (248, FX at 148+) and a 100-entry n vector
      const e248 = new Float32Array(248), e100 = new Float64Array(100);
      for (let k = 0; k < 100; k++) { e248[148 + k] = p.base[k]; e100[k] = p.base[k]; }
      const a = FX.eqResponse(null, e248, fr, FS), b = FX.eqResponse(null, e100, fr, FS);
      for (let i = 0; i < fr.length; i++) { assert.ok(Math.abs(a[i] - want[i]) < 1e-3); assert.ok(Math.abs(b[i] - want[i]) < 1e-9); }
    }
  }
  // defaults (flat shelves at 0 dB) → 0 dB everywhere
  assert.ok(FX.eqResponse(null, null, fr, FS).every((v) => Math.abs(v) < 1e-9));
});

/* ------------------------------------------------------------------ §10.5.5 Compressor */

test('§10.5.5 Compressor: 4:1 steady level, Limit look-ahead (latency 43) and ceiling, multiband 1:1 transparent', () => {
  // −6 dBFS 1 kHz sine, thr −18.06 dB, ratio 4, attack/release default, mix 1, gain 0
  let r = rack(fxp({ 'fx.cmp.on': 1 }));
  let L = sine(2 * FS, 1000, 0.5), R = L.slice();
  run(r, L, R);
  const out = dB(peak(L, 1.5 * FS, 2 * FS));
  assert.ok(Math.abs(out + 15.05) < 0.5, 'steady output ' + out.toFixed(2) + ' dBFS');
  assert.ok(Math.abs(r.gr()[0] - 9) < 0.6, 'GR meter ' + r.gr()[0]);
  assert.equal(r.latency, 0);
  // Limit: ratio n 1, attack n 0.3 → look-ahead 0.9 ms = 43 samples at 48 kHz
  const pl = fxp({ 'fx.cmp.on': 1, 'fx.cmp.ratio': 1 });
  r = rack(pl);
  assert.equal(r.latency, 43);
  L = imp(256, 10, 0.01); R = imp(256, 10, 0.01);
  run(r, L, R);
  assert.ok(Math.abs(L[53] - 0.01) < 1e-12 && peak(L, 0, 53) === 0, 'below threshold: the signal is delayed by the look-ahead');
  L = noise(FS, 11); R = noise(FS, 12);
  for (let i = 0; i < FS; i += 4000) { L[i] = 1; R[i + 7] = -1; }  // isolated full-scale spikes
  run(r, L, R);
  const thr = 0.125;
  assert.ok(peak(L, 43) <= thr * Math.pow(10, 0.1 / 20) && peak(R, 43) <= thr * Math.pow(10, 0.1 / 20), 'ceiling ' + dB(peak(L, 43)));
  assert.ok(r.gr()[0] > 0);
  r.set(fxp({ 'fx.cmp.on': 1, 'fx.cmp.ratio': 1, 'fx.cmp.att': 0.5 }));   // look-ahead glides with the knob
  run(r, new Float64Array(256), new Float64Array(256));
  assert.ok(r.latency > 43 && r.latency < 120, 'gliding ' + r.latency);
  run(r, new Float64Array(FS / 4), new Float64Array(FS / 4));
  assert.equal(r.latency, Math.round(10 * 0.25 * 48));
  r.set(fxp({}));
  run(r, new Float64Array(512), new Float64Array(512));
  assert.equal(r.latency, 0, 'latency 0 once the compressor is off');
  // Multiband, ratio 1:1 (n 0): band-averaged magnitude spectra of in and out agree within ±0.5 dB
  r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.mb': 1, 'fx.cmp.ratio': 0 }));
  const N = 65536, X = noise(N, 21, 0.5), Y = X.slice();
  run(r, Y, Y.slice());
  const SX = fftMag(X, N), SY = fftMag(Y, N);
  for (let f = 40; f < 16000; f *= Math.pow(2, 1 / 3)) {
    const k0 = Math.round(f / FS * N), k1 = Math.round(f * Math.pow(2, 1 / 3) / FS * N);
    let a = 0, b = 0;
    for (let k = k0; k < k1; k++) { a += SX[k] * SX[k]; b += SY[k] * SY[k]; }
    assert.ok(Math.abs(10 * Math.log10(b / a)) < 0.5, f.toFixed(0) + ' Hz band ' + 10 * Math.log10(b / a));
  }
  assert.deepEqual(Array.from(r.gr()), [0, 0, 0, 0]);
  // OTT behaviour (ratio 4): quiet material is lifted, loud material is pushed down, per band meters move
  r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.mb': 1 }));
  const q = noise(FS, 31, 0.003), qo = q.slice();
  run(r, qo, qo.slice());
  assert.ok(rms(qo, FS / 2) > 2 * rms(q, FS / 2), 'quiet lifted ' + dB(rms(qo, FS / 2) / rms(q, FS / 2)));
  assert.ok(r.gr()[1] < 0 && r.gr()[2] < 0 && r.gr()[3] < 0, 'upward gain shows as negative GR');
  r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.mb': 1 }));
  const ld = noise(FS, 32, 0.9), lo = ld.slice();
  run(r, lo, lo.slice());
  assert.ok(rms(lo, FS / 2) < 0.5 * rms(ld, FS / 2), 'loud reduced ' + dB(rms(lo, FS / 2) / rms(ld, FS / 2)));
});

/* ------------------------------------------------------------------ §10.5.6 Reverb */

function rt60(L, R, fs, from = -10, to = -40) {
  const n = L.length, e = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += L[i] * L[i] + R[i] * R[i]; e[i] = acc; }
  const t = [], y = [];
  for (let i = 0; i < n; i += 16) {
    const d = 10 * Math.log10(e[i] / e[0]);
    if (d <= from && d >= to) { t.push(i / fs); y.push(d); }
  }
  const mt = t.reduce((a, b) => a + b) / t.length, my = y.reduce((a, b) => a + b) / y.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < t.length; i++) { sxy += (t[i] - mt) * (y[i] - my); sxx += (t[i] - mt) ** 2; }
  return -60 / (sxy / sxx);
}

test('§10.5.6 Reverb: Hall RT60 (t 0.1, 0.3 at size 1) ±25 %, decorrelated tails; Plate decays monotonically; idle()', () => {
  for (const t of [0.1, 0.3]) {
    const target = 0.8 + 11.2 * t, N = Math.round((target * 1.4 + 0.5) * FS);
    const r = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.size': 1, 'fx.rev.t': t, 'fx.rev.mix': 1 }));
    const L = imp(N), R = imp(N);
    run(r, L, R);
    const T = rt60(L, R, FS);
    assert.ok(Math.abs(T / target - 1) < 0.25, 'RT60 ' + T.toFixed(2) + ' s vs ' + target.toFixed(2));
    const c = corr(L, R, 0.05 * FS, N);
    assert.ok(Math.abs(c) < 0.5, 'L/R correlation ' + c);
  }
  // Plate: windowed tail energy decreases monotonically
  const r = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.mix': 1 }, { revType: 0 }));
  const N = 3 * FS, L = imp(N), R = imp(N);
  run(r, L, R);
  const W = 0.1 * FS;
  let prev = Infinity, n = 0;
  for (let i = 0.15 * FS; i + W <= N; i += W) {
    const e = rms(L, i, i + W) + rms(R, i, i + W);
    if (e < 1e-5 * rms(L, 0, W)) break;
    assert.ok(e < prev, 'window ' + n + ': ' + e + ' ≥ ' + prev);
    prev = e; n++;
  }
  assert.ok(n >= 5, 'tail long enough to check (' + n + ' windows)');
  const rw = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.mix': 1, 'fx.rev.w': 1 }, { revType: 0 }));
  const Lw = imp(N), Rw = imp(N);
  run(rw, Lw, Rw);
  assert.ok(peak(Lw) > 0.01 && Math.abs(corr(Lw, Rw, 0.05 * FS, N)) < 0.5, 'stereo plate tail at WIDTH 100 %: ' + corr(Lw, Rw, 0.05 * FS, N));
  assert.ok(corr(L, R, 0.05 * FS, N) > corr(Lw, Rw, 0.05 * FS, N), 'WIDTH scales the side');
  // idle(): t 0, input silent → true within 1.2 s after the tail fell below −120 dB
  const ri = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.t': 0 }));
  const tq = idleTimes(ri, 0.1 * FS, 6 * FS);
  assert.ok(tq.quiet > 0 && tq.idle > 0, JSON.stringify(tq));
  assert.ok(tq.idle - tq.quiet <= 1.2 * FS, 'idle ' + ((tq.idle - tq.quiet) / FS).toFixed(3) + ' s after −120 dB');
  assert.ok(tq.quiet < 3 * FS, 'tail at default size with t 0 is short (' + (tq.quiet / FS).toFixed(2) + ' s)');
});

// feed `burst` samples of noise then silence; return the sample where the output stays < 1e-6 and where idle() turned true
function idleTimes(r, burst, total) {
  const S = 128, L = new Float64Array(S), R = new Float64Array(S), g = rng(5);
  let quiet = -1, idle = -1;
  for (let o = 0; o < total; o += S) {
    for (let i = 0; i < S; i++) { const on = o + i < burst; L[i] = on ? 2 * g() - 1 : 0; R[i] = on ? 2 * g() - 1 : 0; }
    r.process(L, R, S);
    const p = peak(L) + peak(R);
    if (o >= burst) { if (p >= 1e-6) quiet = -1; else if (quiet < 0) quiet = o; }
    if (o >= burst && idle < 0 && r.idle()) idle = o + S;
    if (o < burst) assert.equal(r.idle(), false, 'not idle while sounding');
  }
  return { quiet, idle };
}

/* ------------------------------------------------------------------ §10.5.7–8 Filter module */

test('§10.5.7 Filter module equals a standalone SFilter (≤ 1e-12), MG Low 6', () => {
  const over = { 'fx.fil.on': 1, 'fx.fil.type': 0, 'fx.fil.cutoff': 0.62, 'fx.fil.res': 0.35, 'fx.fil.drive': 0.2, 'fx.fil.var': 0.15 };
  const r = rack(fxp(over));
  const N = 8192, L = noise(N, 41, 0.8), R = noise(N, 42, 0.8), A = L.slice(), B = R.slice();
  run(r, L, R);
  const f = new SD.SFilter(FS), fc = vExp('fx.fil.cutoff', 0.62);
  f.setType(0);
  f.set(fc, fc, 0.35, 0.2, 0.15);
  f.process(A, B, 0, N);
  let d = 0;
  for (let i = 0; i < N; i++) d = Math.max(d, Math.abs(L[i] - A[i]), Math.abs(R[i] - B[i]));
  assert.ok(d <= 1e-12, 'max |Δ| ' + d);
  assert.ok(rms(L) > 0.05);
  // PAN splits the cutoffs (§6.11): left of centre raises L
  const r2 = rack(fxp({ ...over, 'fx.fil.res': 0, 'fx.fil.pan': 0.25 }));
  const X = noise(N, 43), Y = X.slice();
  run(r2, X, Y);
  assert.ok(rms(X) > rms(Y) * 1.2, 'pan < 0.5 → brighter left');
});

test('§10.5.8 setMods on fx.fil.cutoff: linear across the next process(), target reached at its end; null returns', () => {
  const r = rack(fxp({ 'fx.fil.on': 1, 'fx.fil.cutoff': 0.3 }));
  const sf = r.mFi.sf, calls = [];
  const orig = sf.set.bind(sf);
  sf.set = (a, b, c, d, e) => { calls.push(a); return orig(a, b, c, d, e); };
  const L = noise(512, 1), R = noise(512, 2);
  r.process(L.subarray(0, 128), R.subarray(0, 128), 128);
  assert.equal(calls.length, 0, 'static: no coefficient updates');
  const mods = new Float64Array(100);
  mods[FX.FIDX.FIL_CUTOFF] = 0.4;
  r.setMods(mods);
  mods[FX.FIDX.FIL_CUTOFF] = 0;                                   // copied: later edits of the array do not leak in
  r.process(L.subarray(128, 256), R.subarray(128, 256), 128);
  const ns = calls.map((f) => nExp('fx.fil.cutoff', f));
  assert.equal(ns.length, 8, 'one update per 16-sample block');
  ns.forEach((n, b) => assert.ok(Math.abs(n - (0.3 + 0.4 * (b + 1) / 8)) < 1e-9, 'block ' + b + ': ' + n));
  assert.ok(Math.abs(ns[7] - 0.7) < 1e-12, 'target reached at the end of the call');
  // a second call holds the value
  calls.length = 0;
  r.process(L.subarray(256, 384), R.subarray(256, 384), 128);
  assert.equal(calls.length, 0);
  r.setMods(null);
  r.process(L.subarray(384, 512), R.subarray(384, 512), 128);
  const back = calls.map((f) => nExp('fx.fil.cutoff', f));
  back.forEach((n, b) => assert.ok(Math.abs(n - (0.7 - 0.4 * (b + 1) / 8)) < 1e-9));
  // offsets clamp in knob space
  mods[FX.FIDX.FIL_CUTOFF] = 5;
  r.setMods(mods);
  calls.length = 0;
  r.process(new Float64Array(128), new Float64Array(128), 128);
  assert.ok(Math.abs(calls[calls.length - 1] - 22050) < 1e-6, 'clamped at n = 1');
  assert.ok(calls.length < 8, 'no updates once the clamped value stops moving');
});

/* ------------------------------------------------------------------ §10.5.9–10 robustness, enable fades */

test('§10.5.9 robustness: every module and distortion mode, extreme params, 10 s of full-scale noise; reset()', () => {
  const r0 = rng(99);
  const knobs = FXD.map((d, k) => k).filter((k) => {
    const id = FXD[k].id;
    return k !== 0 && k !== 86 && !id.endsWith('.on') && !id.endsWith('.level') && id !== 'fx.cmp.gain' && !id.startsWith('fx.eq.gain');
  });
  const r = new FX.FXRack(FS);
  const S = 128, L = new Float64Array(S), R = new Float64Array(S), g = rng(3);
  let worst = 0;
  for (let seg = 0; seg < 40; seg++) {                          // 40 × 0.25 s with a new extreme setting each time
    const over = {};
    for (const m of MODS) over['fx.' + m + '.on'] = 1;
    for (const k of knobs) over[FXD[k].id] = seg % 3 === 0 ? 1 : seg % 3 === 1 ? 0 : (r0() < 0.5 ? 0 : 1);
    over['fx.dist.mode'] = (seg % 16) / 15;
    over['fx.fil.type'] = Math.round(r0() * 95) / 95;
    // EQ: extreme types/frequencies, but gains ≤ +12 dB and Q ≤ 1.6 (a +24 dB, Q 10 band is legitimate gain, not instability)
    over['fx.eq.gainL'] = 0.75 * r0(); over['fx.eq.gainH'] = 0.75 * r0();
    over['fx.eq.qL'] = r0() < 0.5 ? 0 : 0.5; over['fx.eq.qH'] = r0() < 0.5 ? 0 : 0.5;
    r.set(fxp(over, { revType: seg & 1, filTypeAll: 1, seed: seg % 5 === 0 ? 1 : 0 }), FXT0);
    for (let o = 0; o < FS / 4; o += S) {
      for (let i = 0; i < S; i++) { L[i] = 2 * g() - 1; R[i] = 2 * g() - 1; }
      r.process(L, R, S);
      for (let i = 0; i < S; i++) {
        if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) assert.fail('non-finite output at segment ' + seg);
        worst = Math.max(worst, Math.abs(L[i]), Math.abs(R[i]));
      }
    }
  }
  assert.ok(worst < 32, 'max |y| ' + worst);
  // reset() then zero input → exact zeros
  r.reset();
  const Z = new Float64Array(FS), Z2 = new Float64Array(FS);
  run(r, Z, Z2);
  assert.ok(Z.every((v) => v === 0) && Z2.every((v) => v === 0), 'exact zeros after reset()');
  // reset(true): the output fades to 0 over 5 ms, then everything is cleared (silent input stays exactly silent)
  const rv = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.t': 0.6, 'fx.dly.on': 1, 'fx.dly.feed': 0.8 }));
  const A = noise(FS / 2, 5), B = noise(FS / 2, 6);
  run(rv, A, B);
  rv.reset(true);
  const T = new Float64Array(FS), U = new Float64Array(FS);
  run(rv, T, U);
  const z = T.findIndex((v, i) => i > 0 && v === 0 && T.subarray(i).every((x) => x === 0));
  assert.ok(z > 200 && z <= 241, 'faded and cleared after 5 ms (' + z + ')');
  assert.ok(peak(T, 0, 40) > 1e-3, 'tail present at the start of the fade');
  for (let i = 0; i < 240; i++) assert.ok(Math.abs(T[i]) <= peak(T, 0, 240) * (1 - i / 240) + 0.05, 'fade envelope at ' + i);
});

test('§10.5.10 enabling / disabling a module during a sine is click-free (5 ms crossfade), 440 Hz and 50 Hz', () => {
  for (const f of [440, 50]) testToggle(f);
});
function testToggle(f) {
  const N = 0.6 * FS, A = 0.5, slope = A * 2 * Math.PI * f / FS;
  for (const m of MODS) {
    const on = fxp({ ['fx.' + m + '.on']: 1, 'fx.dim.mix': 0.5 }), off = fxp({ 'fx.dim.mix': 0.5 });
    const r = rack(off);
    const L = sine(N, f, A), R = sine(N, f, A, FS, 0.3);
    const t1 = 0.2 * FS, t2 = 0.4 * FS;
    run(r, L, R, { before: (o) => { if (o === t1) r.set(on); if (o === t2) r.set(off); } });
    // steady references: the module's own output slope (it may add harmonics or gain)
    const steadyOn = Math.max(maxStep(L, t2 - 0.08 * FS, t2), maxStep(R, t2 - 0.08 * FS, t2));
    const lim = 2 * Math.max(slope, steadyOn);
    for (const t of [t1, t2]) {
      const s = Math.max(maxStep(L, t - 64, t + 0.03 * FS), maxStep(R, t - 64, t + 0.03 * FS));
      assert.ok(s <= lim, m + ' ' + f + ' Hz toggle at ' + t + ': step ' + s.toFixed(4) + ' > ' + lim.toFixed(4));
    }
    assert.ok(Math.abs(L[N - 1] - A * Math.sin(2 * Math.PI * f * (N - 1) / FS)) < 1e-9, m + ': fully bypassed again');
  }
}

/* ------------------------------------------------------------------ §10.5.11–13 RETRIG, idle, phases */

test('§10.5.11 Hyper RETRIG: trigger() restarts the voices (two renders after trigger are identical)', () => {
  const over = { 'fx.hyper.on': 1, 'fx.hyper.mix': 1, 'fx.hyper.unison': 5 / 7, 'fx.hyper.detune': 0.8, 'fx.hyper.rate': 0.7 };
  const burst = () => { const L = sine(0.1 * FS, 330, 0.5); return [L, L.slice()]; };
  const silence = (r) => run(r, new Float64Array(0.1 * FS), new Float64Array(0.1 * FS));
  for (const retrig of [1, 0]) {
    const r = rack(fxp({ ...over, 'fx.hyper.retrig': retrig }, { phase: Float64Array.from([0.3, 0, 0, 0]), seed: 1 }));
    const [L1, R1] = burst(), [L2, R2] = burst();
    silence(r); r.trigger(); run(r, L1, R1);
    silence(r); r.trigger(); run(r, L2, R2);
    assert.equal(sameBits(L1, L2) && sameBits(R1, R2), retrig === 1, 'retrig ' + retrig);
    if (retrig) { r.trigger(); assert.ok(Math.abs(r.phases()[0] - 0.3) < 1e-12, 'voice 0 restarts at phase[0]'); }
  }
});

test('§10.5.12 idle() for every module alone: true within 1.2 s after its tail (defaults, reverb t 0)', () => {
  const tail = { dly: 9, rev: 2.5 };                               // seconds, other modules ≤ 0.3 s
  for (const m of MODS) {
    const over = { ['fx.' + m + '.on']: 1 };
    if (m === 'rev') over['fx.rev.t'] = 0;
    const r = rack(fxp(over));
    const T = (tail[m] || 0.3) + 1.2;
    const t = idleTimes(r, 0.1 * FS, Math.round((T + 0.5) * FS));
    assert.ok(t.idle > 0 && t.idle <= (0.1 + T) * FS, m + ': idle at ' + (t.idle / FS).toFixed(2) + ' s, quiet at ' + (t.quiet / FS).toFixed(2));
    // the delay waits one more line length (default 1/4 at 120 BPM = 0.5 s): an echo can still be in flight
    const lag = 1.2 * FS + 128 + (m === 'dly' ? 0.5 * FS : 0);
    assert.ok(t.idle - t.quiet <= lag, m + ': idle ' + ((t.idle - t.quiet) / FS).toFixed(3) + ' s after quiet');
  }
  // echoes 2 s apart (1 bar at 120 BPM) and 1.5 s apart (1/2 × 1.5): idle() stays false until the last echo has played
  for (const over of [{ 'fx.dly.timeL': 9 / 11, 'fx.dly.link': 1 }, { 'fx.dly.timeL': 8 / 11, 'fx.dly.offL': 1, 'fx.dly.link': 1 }]) {
    const rd = rack(fxp({ 'fx.dly.on': 1, 'fx.dly.feed': 0.1, 'fx.dly.q': 1, ...over }));
    const S = 128, A = new Float64Array(S), B = new Float64Array(S);
    let lastEcho = 0, idleBefore = 0, firstIdle = -1;
    for (let o = 0; o < 20 * FS; o += S) {
      A.fill(0); B.fill(0);
      if (o === 0) { A[0] = 1; B[0] = 1; }
      const was = rd.idle();
      rd.process(A, B, S);
      if (o > 0 && peak(A) > 1e-6) { lastEcho = o; if (was) idleBefore++; }
      if (o > 0 && was && firstIdle < 0) firstIdle = o;
    }
    assert.equal(idleBefore, 0, 'idle() was true before an echo');
    assert.ok(lastEcho >= 7 * FS && firstIdle > lastEcho && firstIdle - lastEcho <= 3.3 * FS, 'idle after the last echo: ' + firstIdle / FS + ' vs ' + lastEcho / FS);
  }
  // an infinite Hall never goes idle while ringing
  const r = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.t': 1 }));
  const t = idleTimes(r, 0.1 * FS, 4 * FS);
  assert.equal(t.idle, -1);
});

test('§10.5.13 phases: seed from fxp.phase, rate 0 holds, seed 0 leaves them running, transport() re-seeds', () => {
  const on = { 'fx.hyper.on': 1, 'fx.flg.on': 1, 'fx.phs.on': 1, 'fx.cho.on': 1 };
  const P = [0.11, 0.37, 0.59, 0.83], Q = [0.5, 0.25, 0.75, 0.05];
  const hold = { ...on, 'fx.hyper.rate': 0, 'fx.flg.rate': 0, 'fx.phs.rate': 0, 'fx.cho.rate': 0 };
  const r = new FX.FXRack(FS);
  r.set(fxp(hold, { phase: Float64Array.from(P), seed: 1 }), FXT0);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  assert.ok(near(Array.from(r.phases()), P), 'phases() = P before processing');
  run(r, noise(FS / 2, 1), noise(FS / 2, 2));
  assert.ok(near(Array.from(r.phases()), P), 'rate 0 holds');
  // ladder index 0 (Off) holds too
  r.set(fxp({ ...hold, 'fx.flg.bpm': 1, 'fx.flg.rate': 0 }, { phase: Float64Array.from(P) }));
  run(r, noise(4800, 3), noise(4800, 4));
  assert.ok(Math.abs(r.phases()[1] - P[1]) < 1e-12);
  // running
  r.set(fxp({ ...on, 'fx.hyper.rate': 0.5, 'fx.flg.rate': 0.5, 'fx.phs.rate': 0.5, 'fx.cho.rate': 0.5 }, { phase: Float64Array.from(P) }));
  run(r, noise(FS / 4, 5), noise(FS / 4, 6));
  const moved = Array.from(r.phases());
  assert.ok(moved.every((v, i) => Math.abs(v - P[i]) > 1e-3), 'running');
  // seed 0 with a different phase: no re-seed (expected advance of 1/4 s at the flanger rate: 20·0.5⁴ = 1.25 Hz)
  r.set(fxp({ ...on, 'fx.hyper.rate': 0.5, 'fx.flg.rate': 0.5, 'fx.phs.rate': 0.5, 'fx.cho.rate': 0.5 }, { phase: Float64Array.from(Q), seed: 0 }));
  assert.ok(near(Array.from(r.phases()), moved), 'unchanged by set() with seed 0');
  run(r, new Float64Array(128), new Float64Array(128));
  assert.ok(Math.abs(((r.phases()[1] - moved[1] + 1) % 1) - 1.25 * 128 / FS) < 1e-9);
  r.transport();
  assert.ok(near(Array.from(r.phases()), Q), 'transport() re-seeds from the last phase');
  // seed 1 re-seeds immediately
  r.set(fxp({ ...hold }, { phase: Float64Array.from(P), seed: 1 }));
  assert.ok(near(Array.from(r.phases()), P));
  // Flanger R = L + PHASE: with PHASE 180° the two delays are mirror images (L at max when R at min)
});

/* ------------------------------------------------------------------ §10.5.14 distCurve */

test('§10.5.14 distCurve equals the module\'s static response (slow ramp, mix 1, filter OFF, level 0.5)', () => {
  const N = 96000, LAT = 15;
  const xa = new Float32Array(1025), xb = new Float32Array(1025);
  for (let j = 0; j <= 1024; j++) { const x = j / 1024; xa[j] = x * x; xb[j] = Math.sqrt(x); }
  const fxt = { key: 'test', xsA: xa, xsB: xb };
  for (const mode of [1, 2, 4, 5, 6, 7, 11, 12, 13, 15]) {
    for (const drive of [0.25, 0.7]) {
      const r = rack(fxp({ 'fx.dist.on': 1, 'fx.dist.mode': mode / 15, 'fx.dist.drive': drive }), fxt);
      const ramp = Float64Array.from({ length: N }, (_, i) => -1 + 2 * i / (N - 1));
      const L = new Float64Array(N + LAT), R = new Float64Array(N + LAT);
      L.set(ramp); R.set(ramp);
      for (let i = N; i < N + LAT; i++) { L[i] = 1; R[i] = 1; }
      run(r, L, R);
      let want = FX.distCurve(mode, drive, xa, xb, N);
      if (mode === 12) {                                         // DC blocker after X-Shaper (Asym), §8.5.3
        const Rc = 1 - 2 * Math.PI * 5 / FS, b = new Float64Array(N);
        let x1 = 0, y1 = 0;
        for (let i = 0; i < N; i++) { const y = want[i] - x1 + Rc * y1; x1 = want[i]; y1 = y; b[i] = y; }
        want = b;
      }
      let worst = 0, at = -1;
      for (let i = mode === 12 ? 4800 : 64; i < N; i++) {          // mode 12: let the DC blockers' start transients die
        let jump = false;                                         // skip the half-band smear around jump discontinuities
        for (let k = Math.max(1, i - 24); k < Math.min(N, i + 24); k++) if (Math.abs(want[k] - want[k - 1]) > 0.002) { jump = true; break; }
        if (jump) continue;
        const e = Math.abs(L[i + LAT] - want[i]);
        if (e > worst) { worst = e; at = i; }
      }
      assert.ok(worst < 1e-3, 'mode ' + mode + ' drive ' + drive + ': max error ' + worst + ' at x = ' + ramp[at]);
    }
  }
  // curve properties
  assert.deepEqual(Array.from(FX.distCurve(8, 0.9, null, null, 5)), [-0.5, -0.25, 0, 0.25, 0.5], 'Downsample → 0.5x');
  const lin = FX.distCurve(11, 0.3, null, null, 3);
  assert.ok(Math.abs(lin[0] + 0.5) < 1e-7 && lin[1] === 0 && Math.abs(lin[2] - 0.5) < 1e-7, 'default X-Shaper = −6 dB pad');
  assert.equal(FX.distCurve(0, 0.25).length, 257);
  for (let m = 0; m < 16; m++) {
    const c = FX.distCurve(m, 1, xa, xb, 101);
    assert.ok(c.every(Number.isFinite) && peak(c) <= 1.25, 'mode ' + m + ' bounded');
    if (m !== 12) assert.ok(Math.abs(c[50]) < 1e-12, 'mode ' + m + ' passes through 0');   // Asym X-Shaper: y(0) = 2·curve(½) − 1
  }
  const tube = FX.distCurve(0, 1, null, null, 3);
  assert.ok(Math.abs(tube[2] - (Math.tanh(0.5 * Math.pow(10, 1.2) + 0.2) - Math.tanh(0.2))) < 1e-12, 'Tube formula');
});

/* ------------------------------------------------------------------ §10.5.15 sanity */

test('§10.5.15 sanity: chorus, flanger, phaser, Hyper → Dimension', () => {
  // chorus (wet only): decorrelated from the dry signal, L ≠ R
  let r = rack(fxp({ 'fx.cho.on': 1, 'fx.cho.mix': 1, 'fx.cho.rate': 0.5 }));
  const X = noise(FS, 51), L = X.slice(), R = X.slice();
  run(r, L, R);
  assert.ok(Math.abs(corr(L, X, 4800)) < 0.99 && !sameBits(L, R) && Math.abs(corr(L, R, 4800)) < 0.99, 'chorus');
  // flanger: comb delay (notch spacing) moves over time — impulses probe the delay at two moments
  r = rack(fxp({ 'fx.flg.on': 1, 'fx.flg.feed': 0, 'fx.flg.rate': nPow4('fx.flg.rate', 1) }));
  const Lf = new Float64Array(FS), Rf = new Float64Array(FS);
  Lf[1000] = 1; Lf[13000] = 1;
  run(r, Lf, Rf);
  const echo = (i0) => { let k = i0 + 5; for (let i = i0 + 5; i < i0 + 1000; i++) if (Math.abs(Lf[i]) > Math.abs(Lf[k])) k = i; return k - i0; };
  const d1 = echo(1000), d2 = echo(13000);
  assert.ok(Math.abs(Lf[1000] - 0.5) < 1e-9, 'wet = (in + delayed)/2');
  assert.ok(Math.abs(d1 - d2) > 20, 'flanger delay moves: ' + d1 + ' vs ' + d2 + ' samples');
  // phaser: notch at the corner sweeps ±2 octaves at depth 1 (LFO held at φ 0 and φ 0.5)
  const notch = (ph) => {
    const p = rack(fxp({ 'fx.phs.on': 1, 'fx.phs.feed': 0, 'fx.phs.depth': 1, 'fx.phs.rate': 0, 'fx.phs.mix': 1 }, { phase: Float64Array.from([0, 0, ph, 0]), seed: 1 }));
    const h = imp(16384), h2 = imp(16384);
    run(p, h, h2);
    const fr = logFreqs(20, 20000, 600);
    const m = fr.map((f) => mag(h, f));
    const mins = [];
    for (let i = 1; i < m.length - 1; i++) if (m[i] < m[i - 1] && m[i] <= m[i + 1] && m[i] < 0.1) mins.push(fr[i]);
    return mins;
  };
  const lo = notch(0), hi = notch(0.5);
  assert.equal(lo.length, 3); assert.equal(hi.length, 3);
  const ratio = hi[1] / lo[1];
  assert.ok(Math.abs(Math.log2(ratio) - 4) < 0.1, 'middle notch moves 4 octaves (±2): ×' + ratio.toFixed(2));
  assert.ok(Math.abs(lo[1] / 150 - 1) < 0.05, 'notch at the corner freq·2^−2 = 150 Hz: ' + lo[1]);
  // Hyper → Dimension: Dimension adds side only (mid unchanged within 0.1 dB)
  const hyp = { 'fx.hyper.on': 1, 'fx.hyper.mix': 0.6 }, saw = new Float64Array(FS);
  for (let i = 0; i < FS; i++) saw[i] = 0.4 * (2 * ((i * 110 / FS) % 1) - 1);
  const go = (dim) => { const q = rack(fxp({ ...hyp, 'fx.dim.mix': dim })), a = saw.slice(), b = saw.slice(); run(q, a, b); return [a, b]; };
  const [a0, b0] = go(0), [a1, b1] = go(1);
  const mid = (a, b) => a.map((v, i) => 0.5 * (v + b[i])), side = (a, b) => a.map((v, i) => 0.5 * (v - b[i]));
  assert.ok(Math.abs(dB(rms(mid(a1, b1)) / rms(mid(a0, b0)))) < 0.1, 'mid unchanged');
  assert.ok(rms(side(a1, b1)) > 1.5 * rms(side(a0, b0)), 'side added');
  // Hyper level at mix 1 (measured target +2.5 dB ± 1.5 dB total, side ≈ −4.5 dB): averaged over saws 55–880 Hz, since
  // the fixed voice spacing colours single pitches
  const tot = [], sd = [];
  for (const f0 of [55, 110, 165, 220, 330, 440, 880]) {
    const s0 = new Float64Array(FS / 2);
    for (let i = 0; i < s0.length; i++) s0[i] = 0.4 * (2 * ((i * f0 / FS) % 1) - 1);
    const q = rack(fxp({ 'fx.hyper.on': 1, 'fx.hyper.mix': 1 })), h1 = s0.slice(), h2 = s0.slice();
    run(q, h1, h2);
    tot.push(dB(Math.hypot(rms(h1, 4800), rms(h2, 4800)) / (Math.SQRT2 * rms(s0, 4800))));
    sd.push(dB(rms(side(h1, h2), 4800) / rms(s0, 4800)));
  }
  const avg = (a) => a.reduce((x, y) => x + y) / a.length;
  assert.ok(Math.abs(avg(tot) - 2.5) <= 1.5, 'Hyper mix 1 total ' + avg(tot).toFixed(2) + ' dB (' + tot.map((v) => v.toFixed(1)) + ')');
  assert.ok(Math.abs(avg(sd) + 4.5) <= 2, 'Hyper side ' + avg(sd).toFixed(2) + ' dB (' + sd.map((v) => v.toFixed(1)) + ')');
});

/* ------------------------------------------------------------------ §10.5.16 allocation, memory */

test('§10.5.16 lazy allocation and memory budgets (idle ≤ 64 KB, all modules ≤ 4 MB at 192 kHz)', () => {
  const r = rack(FXP0);
  const b0 = r.bytes();
  assert.ok(b0 <= 64 * 1024, 'idle rack ' + b0 + ' bytes');
  // a module enabled in the base but without alloc never runs (buffers missing)
  const p = fxp({ 'fx.dly.on': 1 });
  p.alloc[5] = 0;
  r.set(p);
  const L = imp(30000), R = imp(30000);
  run(r, L, R);
  assert.equal(peak(L, 1), 0, 'no echo without buffers');
  assert.equal(r.bytes(), b0);
  // alloc[5] = 1 allocates the delay (2 × 2 s Float32)
  r.set(fxp({ 'fx.dly.on': 1, 'fx.dly.q': 1 }));
  assert.ok(r.bytes() - b0 >= 2 * 2 * FS * 4, 'delay allocated: ' + (r.bytes() - b0));
  const L2 = imp(30000, 1000), R2 = imp(30000, 1000);                // after the 5 ms enable fade
  run(r, L2, R2);
  assert.ok(peak(L2, 24990, 25010) > 0.1, 'delay runs once allocated');
  // allocation follows modded enables (alloc set while the base enable is off): no processing until enabled
  const r2 = rack(fxp({}, { alloc: Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0]) }));
  assert.ok(r2.bytes() > b0 && r2.idle());
  // budgets at 192 kHz with everything allocated (Hall and Plate)
  const all = {};
  for (const m of MODS) all['fx.' + m + '.on'] = 1;
  // (with the FX filter's SFilter pool for every family, filTypeAll, and for a static bank type: the largest family)
  for (const revType of [1, 0]) {
    for (const extra of [{}, { filTypeAll: 1 }, { bank: 1 }]) {
      const p = fxp(extra.bank ? { ...all, 'fx.fil.type': 80 / 95 } : all, { revType, filTypeAll: extra.filTypeAll || 0 });
      const big = rack(p, FXT0, 192000);
      assert.ok(big.bytes() <= 4e6, (revType ? 'Hall' : 'Plate') + ' at 192 kHz ' + JSON.stringify(extra) + ': ' + big.bytes() + ' bytes');
      const a = noise(256, 1), b = noise(256, 2);
      run(big, a, b);
      assert.ok(a.every(Number.isFinite));
    }
  }
  // warmUp leaves the allocation unchanged
  const before = r.bytes();
  r.warmUp();
  assert.equal(r.bytes(), before);
});

/* ------------------------------------------------------------------ §10.5.17 allocation-free process */

test('§10.5.17 process() does not allocate (every module, switch destinations moving, filTypeAll, ducks, resets)', () => {
  const { ctx, FXDSP: F } = loadDSP();
  const all = {};
  for (const m of MODS) all['fx.' + m + '.on'] = 1;
  all['fx.dim.mix'] = 0.5;
  const p = fxp(all, { filTypeAll: 1 });
  const r = new F.FXRack(FS);
  r.set(p, FXT0);
  const S = 128, L = new Float64Array(S), R = new Float64Array(S), dL = new Float64Array(S), dR = new Float64Array(S), mods = new Float64Array(100);
  const g = rng(8);
  const fill = () => { for (let i = 0; i < S; i++) { L[i] = 2 * g() - 1; R[i] = 2 * g() - 1; dL[i] = 0.1 * L[i]; dR[i] = dL[i]; } };
  fill(); r.process(L, R, S);
  fill(); r.process(L, R, S);
  r.set(fxp(all, { filTypeAll: 1, revType: 0 }), FXT0);   // Hall → Plate while sounding: the pool grows here, the duck runs below
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Object', 'Set'];
  const saved = {};
  for (const k of names) { saved[k] = ctx[k]; ctx[k] = function () { throw new Error('allocation: ' + k); }; }
  try {
    for (let s = 0; s < FS / S; s++) {
      fill();
      mods[F.FIDX.DLY_MODE] = (s % 3) / 2; mods[F.FIDX.DIST_MODE] = (s % 16) / 15; mods[F.FIDX.FIL_TYPE] = (s % 96) / 95;
      mods[F.FIDX.CMP_MB] = (s >> 4) & 1 ? 0.6 : 0; mods[F.FIDX.CMP_RATIO] = (s >> 5) & 1 ? 0.3 : 0;
      mods[F.FIDX.EQ_TYPEL] = (s % 3) / 2; mods[F.FIDX.FLG_BPM] = s & 1; mods[F.FIDX.FIL_CUTOFF] = Math.sin(s / 10) * 0.3;
      mods[F.FIDX.REV_SIZE] = Math.sin(s / 7) * 0.3; mods[F.FIDX.HYPER_UNISON] = ((s >> 3) % 8) / 7 - 4 / 7;
      r.setMods(mods);
      if (s % 50 === 0) r.trigger();
      if (s === 120 || s === 300) r.transport();                // re-seed ducks (engine message handlers run on the audio thread)
      if (s === 200) r.reset(true);
      if (s === 250) r.reset(false);
      r.process(L, R, S, s & 1 ? dL : undefined, s & 1 ? dR : undefined);
      for (let i = 0; i < S; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) throw new Error('non-finite');
      r.gr(); r.phases(); r.idle();
    }
    r.setMods(null);
    r.process(L, R, S);
    r.reset(true);
    r.process(L, R, S); r.process(L, R, S);
  } finally {
    for (const k of names) { if (saved[k] === undefined) delete ctx[k]; else ctx[k] = saved[k]; }
  }
  assert.ok(new F.FXRack(FS).bytes() > 0, 'context usable again');
  assert.equal(r.mRv.type, 0, 'the reverb topology changed inside the guarded region');
});

/* ------------------------------------------------------------------ rates, transport, character */

test('every module runs from 22.05 to 192 kHz with rate-independent timing and level', () => {
  const sig = (fs, n) => Float64Array.from({ length: n }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 220 * i / fs) + 0.2 * Math.sin(2 * Math.PI * 3100 * i / fs));
  const level = (fs, over, extra) => {
    const r = rack(fxp(over, extra), FXT0, fs), x = sig(fs, fs), L = x.slice(), R = x.slice();
    run(r, L, R);
    assert.ok(L.every(Number.isFinite) && R.every(Number.isFinite), fs + ' ' + JSON.stringify(over));
    return dB(rms(L, fs / 2) / rms(x, fs / 2));
  };
  for (const m of MODS) {
    for (const revType of m === 'rev' ? [1, 0] : [1]) {
      const over = { ['fx.' + m + '.on']: 1, 'fx.dim.mix': 0.5, 'fx.rev.mix': 1, 'fx.dly.mix': 1, 'fx.phs.rate': 0 };
      const ref = level(48000, over, { revType });
      for (const fs of [22050, 44100, 96000, 192000]) {
        const l = level(fs, over, { revType });
        assert.ok(Math.abs(l - ref) < 4, m + (m === 'rev' ? revType : '') + ' at ' + fs + ': ' + l.toFixed(2) + ' vs ' + ref.toFixed(2) + ' dB');
      }
    }
  }
  for (const fs of [22050, 96000]) {
    const r = rack(fxp({ 'fx.dly.on': 1, 'fx.dly.feed': 0, 'fx.dly.mix': 1, 'fx.dly.q': 1 }), FXT0, fs);
    const L = imp(fs), R = imp(fs);
    run(r, L, R);
    assert.equal(peak(L, 1) > 0.99 && L.indexOf(peak(L, 1)), fs / 2, 'echo at 500 ms (' + fs + ')');
  }
  // above 96 kHz the lines run at half rate: the echo (unit area, both input phases) is centred 30 samples later
  for (const at of [0, 1]) {
    const fs = 192000, r = rack(fxp({ 'fx.dly.on': 1, 'fx.dly.feed': 0, 'fx.dly.mix': 1, 'fx.dly.q': 1 }), FXT0, fs);
    const L = imp(fs, at), R = imp(fs, at);
    run(r, L, R);
    let a = 0, c = 0;
    for (let i = fs / 2 - 64; i < fs / 2 + 128; i++) { a += L[i]; c += i * L[i]; }
    assert.ok(Math.abs(a - 1) < 1e-6 && Math.abs(c / a - (fs / 2 + at + 30)) < 1e-3, 'half-rate echo: area ' + a + ', centre ' + c / a);
    assert.ok(peak(L, 1, fs / 2 - 64) < 1e-12 && peak(L, fs / 2 + 128) < 1e-12, 'nothing else');
  }
  const fr = Float64Array.from([100, 1000, 10000, 20000]);
  const ref = FX.delayFilterResponse(850, 6.8, fr, 96000), got = FX.delayFilterResponse(850, 6.8, fr, 192000);
  assert.ok(got.every((v, i) => v === ref[i]), 'delayFilterResponse follows the half-rate band filter');
  // the half-rate Plate (> 96 kHz) still decays smoothly and keeps its stereo image
  const r = rack(fxp({ 'fx.rev.on': 1, 'fx.rev.mix': 1, 'fx.rev.w': 1 }, { revType: 0 }), FXT0, 192000);
  const N = 2 * 192000, L = imp(N), R = imp(N);
  run(r, L, R);
  const W = 19200;
  let prev = Infinity;
  for (let i = 0.15 * 192000; i + W <= N && prev > 1e-7; i += W) { const e = rms(L, i, i + W) + rms(R, i, i + W); assert.ok(e < prev); prev = e; }
  assert.ok(Math.abs(corr(L, R, 9600, N)) < 0.5);
});

test('transport(): a rack with a silent history renders bit-identically to a fresh one (bounce equivalence, §10.7f)', () => {
  const all = {};
  for (const m of MODS) all['fx.' + m + '.on'] = 1;
  for (const [fs, revType] of [[48000, 1], [48000, 0], [192000, 0]]) {
    const p = fxp({ ...all, 'fx.dim.mix': 0.4, 'fx.hyper.rate': 0.8, 'fx.cho.rate': 0.6 }, { revType, phase: Float64Array.from([0.2, 0.4, 0.6, 0.8]) });
    const live = rack(p, FXT0, fs), bounce = rack(p, FXT0, fs);
    run(live, new Float64Array(fs + 77), new Float64Array(fs + 77));   // 1 s of silent pre-roll (odd length)
    live.transport(); bounce.transport();
    const A = noise(fs / 2, 9), B = noise(fs / 2, 10), C = A.slice(), D = B.slice();
    run(live, A, B); run(bounce, C, D);
    assert.ok(sameBits(A, C) && sameBits(B, D), 'live == bounce at ' + fs + ' Hz, revType ' + revType);
  }
});

test('Dimension character: side only, about −10 dB at MIX 50 % and −4 dB at 100 % (inv A20.4.1)', () => {
  const N = FS, x = noise(N, 77, 0.5);
  for (const [mix, want] of [[0.5, -10], [1, -4]]) {
    const r = rack(fxp({ 'fx.hyper.on': 1, 'fx.hyper.unison': 0, 'fx.dim.mix': mix })), L = x.slice(), R = x.slice();
    run(r, L, R);
    const side = L.map((v, i) => 0.5 * (v - R[i])), mid = L.map((v, i) => 0.5 * (v + R[i]));
    const s = dB(rms(side, 4800) / rms(x, 4800));
    assert.ok(Math.abs(s - want) < 3, 'side ' + s.toFixed(2) + ' dB at mix ' + mix);
    assert.ok(mid.every((v, i) => Math.abs(v - x[i]) < 1e-12), 'mid untouched (unison 0)');
  }
});

/* ------------------------------------------------------------------ contract details */

test('order: modules run in fxp.order; power button (byp) disables a module', () => {
  const two = { 'fx.dist.on': 1, 'fx.dist.drive': 0.8, 'fx.dist.mode': 2 / 15, 'fx.eq.on': 1, 'fx.eq.typeL': 0.5, 'fx.eq.gainL': 1, 'fx.eq.freqL': 0.5 };
  const X = noise(4096, 61, 0.7);
  const chain = (order) => { const r = rack(fxp(two, { order: Uint8Array.from(order) })), a = X.slice(), b = X.slice(); run(r, a, b); return a; };
  const single = (over, input) => { const r = rack(fxp(over)), a = input.slice(), b = input.slice(); run(r, a, b); return a; };
  const dOnly = { 'fx.dist.on': 1, 'fx.dist.drive': 0.8, 'fx.dist.mode': 2 / 15 };
  const eOnly = { 'fx.eq.on': 1, 'fx.eq.typeL': 0.5, 'fx.eq.gainL': 1, 'fx.eq.freqL': 0.5 };
  const de = chain([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), ed = chain([8, 1, 2, 3, 4, 5, 6, 7, 0, 9]);
  assert.ok(sameBits(de, single(eOnly, single(dOnly, X))), 'dist → eq');
  assert.ok(sameBits(ed, single(dOnly, single(eOnly, X))), 'eq → dist');
  assert.ok(!sameBits(de, ed));
  // corrupt order falls back to the default order
  assert.ok(sameBits(chain([0, 0, 2, 3, 4, 5, 6, 7, 8, 9]), de));
  // byp[m] = 1: module off even though its enable is on
  const r = rack(fxp(dOnly, { byp: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]) }));
  const a = X.slice(), b = X.slice();
  run(r, a, b);
  assert.ok(sameBits(a, X));
});

test('direct-out bus is added after the modules and before master / bypass', () => {
  const p = fxp({ 'fx.fil.on': 1, 'fx.fil.cutoff': 0.2 });
  p.base[0] = 0.8;
  const r = rack(p);
  const N = 2048, L = noise(N, 1), R = noise(N, 2), dL = noise(N, 3), dR = noise(N, 4);
  const ref = rack(p), L0 = L.slice(), R0 = R.slice();
  run(ref, L0, R0);
  run(r, L, R, { dL, dR });
  const g = 0.8 ** 3;
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(L[i] - (L0[i] + g * dL[i])) < 1e-12 && Math.abs(R[i] - (R0[i] + g * dR[i])) < 1e-12);
  }
  // with nothing enabled the direct bus is still added (the cheap path is not taken)
  const r2 = rack(FXP0), A = new Float64Array(256), B = new Float64Array(256), dA = noise(256, 5), dB2 = noise(256, 6);
  run(r2, A, B, { dL: dA, dR: dB2 });
  assert.ok(sameBits(A, dA) && sameBits(B, dB2));
});

test('versioning, set(null) and reset(): unknown FXP major → rack bypassed with one warning; fresh-state semantics', () => {
  const con = mkConsole(), ctx = vm.createContext({ console: con });
  const { FXDSP: F } = loadDSP({ ctx });
  const bad = fxp({ 'fx.dist.on': 1 }, { ver: 2 });
  const r = rack(bad, FXT0, FS, F);
  const L = noise(1024, 1), R = noise(1024, 2), L0 = L.slice();
  run(r, L, R);
  assert.ok(sameBits(L, L0));
  r.set(bad);
  assert.equal(con.msgs.filter((m) => m.level === 'warn').length, 1);
  // a rack that saw set(null) first snaps on its first real FXP exactly like a fresh rack (engine restore path)
  const p = fxp({ 'fx.dly.on': 1, 'fx.cho.on': 1, 'fx.rev.on': 1 }, { phase: Float64Array.from([0, 0, 0, 0.4]) });
  const render = (rk) => { const a = noise(9600, 7), b = noise(9600, 8); run(rk, a, b); return a; };
  const fresh = rack(p);
  const viaNull = new FX.FXRack(FS); viaNull.set(null); viaNull.set(p, FXT0);
  assert.ok(sameBits(render(fresh), render(viaNull)));
  // after reset() the next set() snaps again; warmUp() leaves the rack equivalent to a fresh one
  const used = rack(fxp({ 'fx.dist.on': 1 }));
  render(used); used.reset(); used.set(null); used.set(p, FXT0);
  const warmed = new FX.FXRack(FS); warmed.set(null); warmed.warmUp(); warmed.reset(); warmed.set(null); warmed.set(p, FXT0);
  const ref = render(rack(p));
  assert.ok(sameBits(render(used), ref), 'reset → fresh');
  assert.ok(sameBits(render(warmed), ref), 'warmUp → fresh');
  assert.ok(warmed.bytes() <= rack(p).bytes());
});

test('helpers: MODFX_HZ, filterImpulse re-export, smoothing of knob moves, setMods sanitising', () => {
  assert.equal(FX.MODFX_HZ(0.25, false, 120), 0.078125);
  assert.equal(FX.MODFX_HZ(21 / 30, true, 120), 2);                 // 1/4 at 120 BPM
  assert.equal(FX.MODFX_HZ(0, true, 120), 0);                       // Off
  assert.equal(FX.MODFX_HZ(0, false, 120), 0);
  assert.ok(Math.abs(FX.MODFX_HZ(1, true, 90) - 90 / 60 / 0.125) < 1e-12);
  assert.equal(FX.MODFX_HZ(2, false), 20);
  const a = FX.filterImpulse(1, 800, 0.2, 0, 0, 48000, 256), b = SD.filterImpulse(1, 800, 0.2, 0, 0, 48000, 256);
  assert.ok(sameBits(a, b));
  assert.equal(FX.filterImpulse(1, 800, 0.2, 0, 0, 48000).length, 4096);
  // a knob move glides (τ = 10 ms): a level change produces no step
  const r = rack(fxp({ 'fx.dly.on': 1, 'fx.dly.mix': 0 }));
  const L = new Float64Array(9600).fill(0.5), R = L.slice();
  run(r, L.subarray(0, 4800), R.subarray(0, 4800));
  r.set(fxp({ 'fx.dly.on': 1, 'fx.dly.mix': 0, 'fx.dly.level': 1 }));
  run(r, L.subarray(4800), R.subarray(4800));
  assert.ok(maxStep(L, 4800) < 0.02 && Math.abs(L[9599] - 2) < 1e-3, 'level glides to ×4');
  // smooth = 0: no one-pole, the change is reached linearly within the next process() call
  const r2 = rack(fxp({ 'fx.dly.on': 1, 'fx.dly.mix': 0 }, { smooth: 0 }));
  const A = new Float64Array(256).fill(0.5), B = A.slice();
  r2.set(fxp({ 'fx.dly.on': 1, 'fx.dly.mix': 0, 'fx.dly.level': 1 }, { smooth: 0 }));
  run(r2, A, B);
  assert.ok(A[15] > 0.5 && A[15] < 2 && Math.abs(A[127] - 2) < 1e-12 && Math.abs(A[255] - 2) < 1e-12, 'one-call ramp with smooth 0');
  // setMods ignores NaN and clamps huge offsets; null clears
  const r3 = rack(FXP0), mods = new Float64Array(100);
  mods[0] = NaN; mods[5] = Infinity;
  r3.setMods(mods);
  const X = noise(256, 1), Y = X.slice();
  run(r3, X, Y);
  assert.ok(X.every(Number.isFinite));
});

/* ------------------------------------------------------------------ reset / re-seed / mode-change behaviour (review round 2) */

test('reset(): after a stop or Panic followed by audio, edits glide and LFO phases keep running; idle racks clear at once', () => {
  const pm = (n) => { const p = fxp({}); p.base[0] = n; return p; };
  // no module enabled, master 0.7, constant 0.5: reset (stop / Panic), audio, then a master edit 0.7 → 0.4 glides
  for (const soft of [true, false]) {
    const r = rack(pm(0.7)), L = new Float64Array(256).fill(0.5), R = L.slice();
    run(r, L.subarray(0, 128), R.subarray(0, 128));
    r.reset(soft);
    run(r, L.subarray(128), R.subarray(128));
    const A = new Float64Array(256).fill(0.5), B = A.slice();
    r.set(pm(0.4));
    run(r, A, B);
    assert.ok(Math.abs(A[0] - 0.5 * 0.343) < 0.002 && maxStep(A) < 0.005 && A[255] < A[0], 'master glides after reset(' + soft + '): ' + A[0]);
  }
  // the restore path (reset, no audio, set) still snaps like a first call: covered by the versioning test below
  // Flanger running: Panic / stop, audio, an ordinary edit (seed 0, another stored phase) → the phase is not re-seeded
  const fl = { 'fx.flg.on': 1, 'fx.flg.rate': 0.6 };
  for (const soft of [false, true]) {
    const r = rack(fxp(fl, { phase: Float64Array.from([0, 0.25, 0, 0]), seed: 1 }));
    run(r, sine(FS / 2, 220, 0.5), sine(FS / 2, 220, 0.5));
    r.reset(soft);
    if (!soft) assert.ok(Math.abs(r.phases()[1] - 0.25) < 1e-12, 'Panic re-seeds (cleared state)');
    run(r, sine(FS / 4, 220, 0.5), sine(FS / 4, 220, 0.5));
    const before = r.phases()[1];
    assert.ok(Math.abs(before - 0.25) > 1e-3, 'running after the reset');
    r.set(fxp({ ...fl, 'fx.flg.mix': 0.8 }, { phase: Float64Array.from([0, 0.9, 0, 0]), seed: 0 }));
    assert.equal(r.phases()[1], before, 'no re-seed on an ordinary edit after reset(' + soft + ')');
    run(r, new Float64Array(128), new Float64Array(128));
    assert.ok(Math.abs(r.phases()[1] - before - FX.MODFX_HZ(0.6, false, 120) * 128 / FS) < 1e-12, 'and it keeps running');
  }
  // reset(true) of an idle rack (tail long gone, the engine skips it): cleared at once, the next note is not faded
  const rv = fxp({ 'fx.rev.on': 1, 'fx.rev.t': 0 });
  const a = rack(rv), b = rack(rv);
  for (const q of [a, b]) { run(q, noise(4800, 1), noise(4800, 2)); run(q, new Float64Array(4 * FS), new Float64Array(4 * FS)); }
  assert.ok(a.idle());
  a.reset(true);
  assert.ok(a.idle(), 'nothing pending after a soft reset of an idle rack');
  const X = sine(4800, 330, 0.5), Y = X.slice(), X2 = X.slice(), Y2 = X.slice();
  run(a, X, Y); run(b, X2, Y2);
  for (let i = 0; i < X.length; i++) assert.ok(Math.abs(X[i] - X2[i]) < 1e-3, 'first note after the stop not ducked (' + i + ')');
  // with an audible tail the fade is rendered first: idle() is false until it has run
  const c = rack(rv);
  run(c, noise(4800, 3), noise(4800, 4));
  c.reset(true);
  assert.equal(c.idle(), false);
  run(c, new Float64Array(FS / 2), new Float64Array(FS / 2));
  assert.ok(c.idle(), 'cleared rack is idle once the fade has run');
});

test('transport(): free-running counters restart too (Downsample hold, FX filter S&H / ring phases, Limit), §10.7f', () => {
  const cases = [
    { 'fx.dist.on': 1, 'fx.dist.mode': 8 / 15, 'fx.dist.drive': 0.3 },
    { 'fx.fil.on': 1, 'fx.fil.type': 78 / 95, 'fx.fil.cutoff': 0.3 },
    { 'fx.fil.on': 1, 'fx.fil.type': 76 / 95, 'fx.fil.cutoff': 0.4 },
    { 'fx.cmp.on': 1, 'fx.cmp.ratio': 1, 'fx.cmp.att': 0.6 },
    { 'fx.dly.on': 1, 'fx.dly.feed': 0.6 },
  ];
  for (const fs of [48000, 192000]) {
    for (const over of cases) {
      const p = fxp(over), live = rack(p, FXT0, fs), bounce = rack(p, FXT0, fs);
      run(live, new Float64Array(377 * 128 + 3), new Float64Array(377 * 128 + 3));
      live.transport(); bounce.transport();
      const A = noise(fs / 4, 9), B = noise(fs / 4, 10), C = A.slice(), D = B.slice();
      run(live, A, B); run(bounce, C, D);
      assert.ok(sameBits(A, C) && sameBits(B, D), fs + ' ' + JSON.stringify(over));
    }
  }
});

test('re-seed while tails sound (transport(), fxp.seed): the module ducks around the jump; phases() reports the new phase', () => {
  const N = FS, at = 187 * 128, x = sine(N, 330, 0.5), slope = 0.5 * 2 * Math.PI * 330 / FS;
  const cases = [{ 'fx.flg.on': 1, 'fx.flg.rate': 0.6 }, { 'fx.cho.on': 1, 'fx.cho.mix': 1, 'fx.cho.rate': 0.6 }, { 'fx.phs.on': 1, 'fx.phs.rate': 0.6 },
    { 'fx.hyper.on': 1, 'fx.hyper.mix': 1, 'fx.hyper.detune': 1, 'fx.hyper.rate': 0.8 },
    { 'fx.rev.on': 1, 'fx.rev.mix': 1, 'fx.rev.w': 1, 'fx.rev.c': 1, 'fx.rev.t': 0.5 }];
  for (const over of cases) {
    for (const how of ['transport', 'seed']) {
      const p = fxp(over, { phase: Float64Array.from([0.7, 0.7, 0.7, 0.7]) });
      const r = rack(p), L = x.slice(), R = x.slice();
      run(r, L, R, { before: (o) => {
        if (o !== at) return;
        if (how === 'transport') r.transport(); else r.set(fxp(over, { phase: Float64Array.from([0.1, 0.1, 0.1, 0.1]), seed: 1 }));
        if (!over['fx.rev.on']) assert.equal(r.phases()[over['fx.hyper.on'] ? 0 : over['fx.flg.on'] ? 1 : over['fx.phs.on'] ? 2 : 3], how === 'transport' ? 0.7 : 0.1);
      } });
      const ref = rack(p), A = x.slice(), B = x.slice();
      run(ref, A, B);
      const lim = 2 * Math.max(slope, maxStep(A, N / 4, at), maxStep(B, N / 4, at));
      const st = Math.max(maxStep(L, at - 64, at + 0.03 * FS), maxStep(R, at - 64, at + 0.03 * FS));
      // LFO modules re-seed (ducked); the reverb's internal modulation is left running while its tail sounds
      assert.equal(sameBits(L, A), !!over['fx.rev.on'], JSON.stringify(over) + ' ' + how + ': re-seeded');
      assert.ok(st <= lim, JSON.stringify(over) + ' ' + how + ': step ' + st.toFixed(4) + ' > ' + lim.toFixed(4));
    }
  }
  // the new phase is applied within the duck (≤ 2.5 ms + one block) and then runs on
  const r = rack(fxp({ 'fx.flg.on': 1, 'fx.flg.rate': 0.6 }, { phase: Float64Array.from([0, 0.3, 0, 0]) }));
  run(r, sine(FS / 4, 330, 0.5), sine(FS / 4, 330, 0.5));
  r.transport();
  run(r, sine(160, 330, 0.5), sine(160, 330, 0.5));
  const hz = FX.MODFX_HZ(0.6, false, 120), ph = r.phases()[1];
  assert.ok(ph > 0.3 && ph - 0.3 <= hz * 160 / FS + 1e-12, 'phase after the duck ' + ph);
});

test('Compressor: mode changes (RATIO ↔ Limit, MULTIBAND) are click-free; Limit plays current audio after a mode change', () => {
  const N = FS / 2, at = 94 * 128, f = 220, A = 0.5, slope = A * 2 * Math.PI * f / FS;
  // thr 0 dB: transparent in every mode, so any step comes from the switch itself
  const cases = [['SB→Limit', 0.75, 53, 0.3], ['Limit→SB', 1, 53, -0.3], ['SB→MB', 0.75, 96, 1], ['MB→SB', 0.75, 96, -1], ['MB(Limit)→Limit', 1, 96, -1]];
  for (const [name, ratio, idx, off] of cases) {
    const over = { 'fx.cmp.on': 1, 'fx.cmp.thr': 0, 'fx.cmp.ratio': ratio, 'fx.cmp.att': 0.6 };
    if (off < 0 && idx === 96) over['fx.cmp.mb'] = 1;
    const r = rack(fxp(over)), L = sine(N, f, A), R = L.slice(), mods = new Float64Array(100);
    run(r, L, R, { before: (o) => { if (o === at) { mods[idx] = off; r.setMods(mods); } } });
    const steady = Math.max(maxStep(L, N / 4, at), maxStep(L, N - 4800, N));
    const st = maxStep(L, at - 64, at + 0.03 * FS);
    assert.ok(st <= 2 * Math.max(slope, steady), name + ': step ' + st.toFixed(5) + ' vs ' + Math.max(slope, steady).toFixed(5));
    let zeros = 0;
    for (let i = at; i < at + 960; i++) if (L[i] === 0) zeros++;
    assert.ok(zeros <= 2, name + ': ' + zeros + ' exact zeros after the switch');
  }
  // Limit on a loud 1 kHz tone, single band on a quiet 200 Hz tone for 1 s, Limit again: no replay of the old tone
  const r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.ratio': 1, 'fx.cmp.att': 1 })), mods = new Float64Array(100);
  run(r, sine(FS / 2, 1000, 0.9), sine(FS / 2, 1000, 0.9));
  mods[53] = -0.3; r.setMods(mods);
  run(r, sine(FS, 200, 0.1), sine(FS, 200, 0.1));
  mods[53] = 0; r.setMods(mods);
  const L = sine(FS / 20, 200, 0.1, FS, 2 * Math.PI * 200 * 1.5), R = L.slice();
  run(r, L, R);
  assert.ok(peak(L) <= 0.1 + 1e-9, 'first 50 ms after returning to Limit: peak ' + peak(L));
  assert.equal(r.latency, 480);
  // enabling the compressor in Limit mode during a sine: no run of zeros from the empty look-ahead line
  const off = fxp({ 'fx.cmp.ratio': 1, 'fx.cmp.att': 1 }); off.alloc[6] = 1;
  const r2 = rack(off), y = sine(N, f, A), y2 = y.slice();
  run(r2, y, y2, { before: (o) => { if (o === at) r2.set(fxp({ 'fx.cmp.on': 1, 'fx.cmp.ratio': 1, 'fx.cmp.att': 1 })); } });
  assert.ok(maxStep(y, at - 64, at + 0.03 * FS) <= 2 * slope, 'enable in Limit mode: ' + maxStep(y, at - 64, at + 0.03 * FS));
  assert.equal(r2.latency, 480, 'enabled');
});

test('Compressor multiband: MIX < 100 % stays flat at 1:1; a hit after a quiet bed does not overshoot (OTT defaults)', () => {
  for (const mix of [0.5, 0.3]) {
    const r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.mb': 1, 'fx.cmp.ratio': 0, 'fx.cmp.mix': mix }));
    const h = imp(1 << 15, 0, 0.01), h2 = h.slice();
    run(r, h, h2);
    const s2 = Math.sin(Math.PI * mix / 2) ** 2, want = dB(1 - mix * mix + s2);
    for (const f of [50, 100, 128.3, 160, 300, 1000, 2000, 2500, 3200, 8000, 16000]) {
      const got = dB(mag(h, f) / 0.01);
      assert.ok(Math.abs(got - want) < 0.5, 'mix ' + mix + ' at ' + f + ' Hz: ' + got.toFixed(2) + ' dB vs ' + want.toFixed(2));
    }
  }
  for (const bed of [-75, -60, -50]) {
    const r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.mb': 1 }));
    const T = 2 * FS, x = noise(T, 3, Math.pow(10, bed / 20));
    for (let i = FS; i < T; i++) x[i] = Math.sin(2 * Math.PI * 1000 * i / FS);
    const L = x.slice(), R = x.slice();
    run(r, L, R);
    assert.ok(dB(peak(L, FS, FS + 2400)) <= 4, 'bed ' + bed + ' dBFS: hit peaks at ' + dB(peak(L, FS, FS + 2400)).toFixed(1) + ' dBFS');
    assert.ok(rms(L, FS / 2, FS) > 2 * rms(x, FS / 2, FS), 'the bed is still lifted');
  }
});

test('Distortion power: no step at 50 Hz and no comb dip mid-fade (the bypass glides to the 15-sample latency first)', () => {
  const x = sine(FS, 50, 0.9), slope = 0.9 * 2 * Math.PI * 50 / FS;
  for (const mix of [0, 0.5, 1]) {
    const off = fxp({ 'fx.dist.mix': mix }); off.alloc[1] = 1;
    const on = fxp({ 'fx.dist.on': 1, 'fx.dist.mix': mix });
    const r = rack(off), y = x.slice(), y2 = x.slice();
    run(r, y, y2, { before: (o) => { if (o === 4736) r.set(on); if (o === 4736 + 9600) r.set(off); } });
    const z = x.slice();
    run(rack(on), z, z.slice());
    const lim = 2 * Math.max(slope, maxStep(z, 9600));
    const st = maxStep(y, 4600, 4736 + 9600 + 2400);
    assert.ok(st <= lim, 'mix ' + mix + ': step ' + st.toFixed(4) + ' > ' + lim.toFixed(4));
    assert.ok(Math.abs(y[FS - 1] - x[FS - 1]) < 1e-12, 'undelayed bypass after the disable');
  }
  // MIX 0 = the delayed input: on a 1.6 kHz sine (latency = half a period) the level holds through on and off
  const s = sine(FS / 2, 1600, 0.5), off = fxp({ 'fx.dist.mix': 0 });
  off.alloc[1] = 1;
  const r = rack(off), y = s.slice(), y2 = s.slice();
  run(r, y, y2, { before: (o) => { if (o === 4864) r.set(fxp({ 'fx.dist.on': 1, 'fx.dist.mix': 0 })); if (o === 9728) r.set(off); } });
  assert.ok(Math.abs(y[FS / 2 - 1] - s[FS / 2 - 1]) < 1e-12, 'undelayed bypass again');
  for (let i = 4000; i < 9728 + 2400; i += 15) assert.ok(peak(y, i, i + 30) > 0.49, 'level at ' + i + ': ' + peak(y, i, i + 30));
});

test('Plate ↔ Hall while the reverb sounds: the old tail ducks out over 2.5 ms and the new topology fades in (no cut)', () => {
  const p = (revType) => fxp({ 'fx.rev.on': 1, 'fx.rev.mix': 0.6, 'fx.rev.t': 0.5 }, { revType });
  const N = FS, at = 187 * 128;
  const r = rack(p(1)), L = sine(N, 440, 0.4), R = sine(N, 440, 0.4, FS, 0.5);
  run(r, L, R, { before: (o) => { if (o === at) r.set(p(0)); } });
  const steady = maxStep(L, at - 4800, at), st = maxStep(L, at, at + 0.02 * FS);
  assert.ok(st <= 1.5 * steady, 'step at the switch ' + st.toFixed(4) + ' vs steady ' + steady.toFixed(4));
  assert.ok(peak(L, at, at + 64) > 0.5 * peak(L, at - 960, at), 'not cut at the switch');
  assert.equal(r.mRv.type, 0);
  // a silent rack switches at once
  const q = rack(p(1));
  run(q, new Float64Array(FS), new Float64Array(FS));
  q.set(p(0));
  assert.equal(q.mRv.type, 0);
});

test('warmUp() runs every compressor mode and a mode crossfade (no first-use compile on the audio thread)', () => {
  const r = new FX.FXRack(FS), proto = Object.getPrototypeOf(r.mCp), orig = proto.run, seen = new Set();
  proto.run = function (R, L, Rc, o, m) { seen.add(this.mode); if (this.cx < 1) seen.add('fade'); return orig.call(this, R, L, Rc, o, m); };
  try { r.warmUp(); } finally { proto.run = orig; }
  assert.deepEqual([...seen].map(String).sort(), ['0', '1', '2', 'fade']);
});

test('CPU (informative; fails only beyond 3×): all ten modules 1 s at 48 kHz ≤ 0.1 s; bypassed rack ≈ free', () => {
  const all = {};
  for (const m of MODS) all['fx.' + m + '.on'] = 1;
  all['fx.dim.mix'] = 0.5;
  const cases = [['all modules, Hall, single-band comp', fxp(all)], ['all modules, Plate, multiband comp', fxp({ ...all, 'fx.cmp.mb': 1 }, { revType: 0 })],
    ['Serum-style rack with setMods every span', fxp({ 'fx.dly.on': 1, 'fx.rev.on': 1, 'fx.fil.on': 1 })]];
  for (const [name, p] of cases) {
    const r = rack(p);
    const S = 128, L = new Float64Array(S), R = new Float64Array(S), g = rng(1), mods = new Float64Array(100);
    const go = (n) => { for (let s = 0; s < n; s++) { for (let i = 0; i < S; i++) { L[i] = 2 * g() - 1; R[i] = L[i]; } mods[79] = 0.1 * Math.sin(s / 20); r.setMods(mods); r.process(L, R, S); } };
    go(200);
    const t0 = performance.now();
    go(FS / S);
    const t = (performance.now() - t0) / 1000;
    console.log('  fx-dsp CPU: ' + name + ': 1 s of audio in ' + (t * 1000).toFixed(1) + ' ms');
    assert.ok(t < 0.3, name + ' took ' + t + ' s');
  }
  // bypass cost: no module enabled, master 1 → O(1) per call, L/R untouched
  const r = rack(FXP0), S = 128, L = noise(S, 1), R = noise(S, 2), L0 = L.slice();
  for (let s = 0; s < 1000; s++) r.process(L, R, S);
  const t0 = performance.now();
  for (let s = 0; s < 10 * FS / S; s++) r.process(L, R, S);
  const t = performance.now() - t0;
  console.log('  fx-dsp CPU: bypassed rack, 10 s of audio in ' + t.toFixed(2) + ' ms');
  assert.ok(sameBits(L, L0));
  assert.ok(t < 15, 'bypass cost ' + t + ' ms per 10 s');
});
