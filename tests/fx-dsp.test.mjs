// fx-dsp.js unit tests (owner F1; Phase 1: E4). Run: node --test tests/fx-dsp.test.mjs
// Covers SPEC-serum.md §10.5 items 1–17 (cited as §10.5.N) plus the §8.5 contract details: exports and arities, script
// shape, constants vs tests/fixtures/dests.json, lazy SerumDSP use, versioning, set(null)/reset/warmUp semantics,
// helpers (distCurve, eqResponse, delayFilterResponse, MODFX_HZ, filterImpulse), direct bus, order, power buttons,
// 22.05–192 kHz operation, transport/bounce equivalence (§10.7f at rack level), Hyper/Dimension character, CPU and
// bypass cost, memory budgets (incl. the FX filter's family pool), and the review-round-2 behaviour: reset / Panic /
// stop semantics, ducked re-seeds, compressor mode changes and multiband MIX, Distortion power glide, reverb type
// changes, warm-up coverage.
// SPEC-serum2 (M1a step 3, FXP v2 with S1 variants): the Phase-1 tests run on FXP v2 racks built by fx-core's compileFx
// from the same v1 descriptions (fxp() below), plus §15.10 items for the instance graph: S1-instance racks bit-identical
// to the frozen Phase-1 rack (tests/ref-p1/fx-dsp.js) for v1 states read as all ten S1 instances and for migrateFx1
// states, with modulation in the FX-context layout; instance add / remove / reorder / type change; several instances of
// a type; buses, routing, rack bypass, direct and bus levels (neutral 0 dB skipped); setMods layout key; phases() / gr()
// per FXP instance; S2 variants pass audio; without SxBase (dsp-scope override) S1 racks render bit-identically.
// SPEC-serum2 M2 (§8.2–§8.5, §15.10), racks in a scope with the full §0.3 list: S2 variants at their S1-equivalent
// settings ≡ the S1 instances (bit-exact; Compressor within its crossover rounding), every changed module's S2 behaviour
// (Distortion Overdrive / Soft Sat. and Key Track, Phaser poles / DEPTH 2, Chorus HPF, Delay HQ, Compressor crossovers /
// BELOW / band gains, EQ level, Filter types 96–107 / Key Track / Clean), Reverb S2 (Plate RT60 law, Hall decay and
// pre-delay, LOW / HIGH CUT, type changes), splitters with branch chains, Bode and Convolve in the rack (phases, RETRIG,
// missing IR, arrival), §0.3 failure isolation, allocation-free process with every module, idle(), §8.5 memory (S2 Delay
// Float32 ≤ 4 MB at 192 kHz, the 32 MB per-track cap), SxBase.shape ≡ the Phase-1 shapers, CPU rows j–m (informative).
// Fixtures (F1): fxp-default.json / fxt-default.json (compileFx(defaultFx()) / compileFxT: the ten S1 instances in v1
// module order, FXP v2 / FXT v2) and dests.json.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadFixture } from './fixtures/load.mjs';
import { dspScope, noAlloc } from './dsp-scope.mjs';
import { lawNorm } from '../laws.js?v=9';
import * as C from '../fx-core.js?v=9';
import * as CPU from './cpu-gate.mjs';

const SERUM_SRC = readFileSync(new URL('../serum-dsp.js', import.meta.url), 'utf8');
const FX_SRC = readFileSync(new URL('../fx-dsp.js', import.meta.url), 'utf8');
const DESTS = JSON.parse(readFileSync(new URL('./fixtures/dests.json', import.meta.url), 'utf8')).DESTS;
const FXP0 = loadFixture('fxp-default.json');                    // the ten S1 instances in v1 module order (= MODS)
const FXT0 = loadFixture('fxt-default.json');
const FXD = DESTS.slice(148);                                   // FX segment, fx idx order
const FI = Object.fromEntries(FXD.map((d, k) => [d.id, k]));
const LAWS = ['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio', 'npitch'];
const MODS = ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'];
const ON = MODS.map((m) => FI['fx.' + m + '.on']);
const FS = 48000;
const NFX0 = FXP0.NFX;
// FX-context index (SPEC-serum2 §4.2) of v1 fx idx k in FXP0-shaped racks: 0 master, 1 bypass, 8 + off + p
const AT = Int32Array.from(FXD, (d, k) => {
  if (k === 0) return 0;
  if (k === 86) return 1;
  const m = d.id.split('.')[1] === 'dim' ? 'hyper' : d.id.split('.')[1];
  return 8 + FXP0.iOff[MODS.indexOf(m)] + C.FX_S1_IDX[m].indexOf(k);
});
const PHI = [0, 2, 3, 4];                                        // FXP0 instance index of Hyper, Flanger, Phaser, Chorus
const ph4 = (r) => PHI.map((i) => r.phases()[i]);
const grc = (r) => r.gr().subarray(24, 28);                      // GR meter of the compressor (FXP0 instance 6)
const mod = (r, id) => r.byId.get(id).mod;                       // the module object of instance `id`

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

// compiled FXP v2 of a v1 rack description: the default v1 rack (fx-core defaultFxV1) with overrides { v1 destId: n }
// (g.master / g.bypass go to the compile context) and Phase-1 FXP extras mapped onto the state / instance arrays (order,
// byp, revType, choMono, phase, alloc, filTypeAll); other extras (seed, bpm, smooth, silence, ver …) are written into the
// FXP as they are. iAlloc follows the enables (compileFx) unless `alloc` is given.
function fxp(over = {}, extra = {}) {
  const fx = C.defaultFxV1(), ctx = {}, x = { ...extra };
  for (const [id, n] of Object.entries(over)) {
    if (!(id in FI)) throw new Error('unknown FX dest ' + id);
    if (id === 'g.master') ctx.master = n; else if (id === 'g.bypass') ctx.bypass = n; else fx.p[id] = n;
  }
  if (x.order) { fx.order = Array.from(x.order, (m) => MODS[m]); delete x.order; }
  if (x.byp) { MODS.forEach((m, i) => { fx.byp[m] = x.byp[i] ? 1 : 0; }); delete x.byp; }
  if ('revType' in x) { fx.rev.type = x.revType; delete x.revType; }
  if ('choMono' in x) { fx.cho.mono = x.choMono; delete x.choMono; }
  if (x.phase) { fx.phase = Array.from(x.phase); delete x.phase; }
  const p = C.compileFx(fx, ctx), at = (m) => p.iId.indexOf(m);
  if (x.alloc) { MODS.forEach((m, i) => { p.iAlloc[at(m)] = x.alloc[i] ? 1 : 0; }); delete x.alloc; }
  if ('filTypeAll' in x) { p.filTypeAll[at('fil')] = x.filTypeAll ? 1 : 0; delete x.filTypeAll; }
  return Object.assign(p, x);
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
  assert.equal(F.VER, 2);
  const fns = { FXRack: 1, distCurve: 4, eqResponse: 5, delayFilterResponse: 4, MODFX_HZ: 3, filterImpulse: 7 };
  for (const [k, n] of Object.entries(fns)) { assert.equal(typeof F[k], 'function', k); assert.equal(F[k].length, n, k + ' arity'); }
  const rp = { set: 2, setMods: 2, setNote: 1, process: 9, trigger: 0, reset: 1, idle: 0, gr: 0, phases: 0, transport: 0, warmUp: 0, bytes: 0 };
  for (const [k, n] of Object.entries(rp)) assert.equal(F.FXRack.prototype[k].length, n, 'FXRack.' + k);
  const r = new F.FXRack(48000);
  assert.equal(r.latency, 0);
  const tag = (x) => Object.prototype.toString.call(x);
  assert.ok(tag(r.gr()) === '[object Float32Array]' && r.gr().length === 4 * 48);
  assert.ok(tag(r.phases()) === '[object Float64Array]' && r.phases().length === 48 && r.phases().every(Number.isNaN));
  assert.equal(r.gr(), r.gr(), 'reused arrays (no allocation when the engine polls them)');
  assert.equal(r.idle(), true);
  assert.deepEqual([r.note, r.keyF], [60, 1]);
  r.setNote(72); assert.deepEqual([r.note, r.keyF], [72, 2]);
  r.setNote(NaN); assert.deepEqual([r.note, r.keyF], [60, 1], 'no pitch: 60');
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
  // compiled-default fixture is what the rack is built for (FXP v2: 8 FX-context globals + the ten S1 tables)
  assert.equal(FXP0.ver, FX.VER);
  assert.equal(FXP0.base.length, 8 + 98);
  assert.deepEqual(Array.from(FXP0.iId), MODS);
  // S1 tables: the v1 rows of each module in fx idx order (fx-core FX_S1_IDX), FXP iType = fx-core FXTYPES index
  assert.ok(Object.isFrozen(FX.TYPES) && Object.isFrozen(FX.S1_IDX));
  assert.deepEqual(Array.from(FX.TYPES), C.FXTYPES.map((t) => t.id));
  for (const m of MODS) assert.deepEqual(Array.from(FX.S1_IDX[m]), Array.from(C.FX_S1_IDX[m]), m);
  assert.deepEqual(Object.keys(FX.S1_IDX).sort(), [...MODS].sort());
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
      // other argument forms: (fxp, instance, effN): a Serum snapshot eff (NSV 429 + MAXFX 1160, FX context from 429)
      // and an FX-context vector; the instance index picks the EQ (another index falls back to the first EQ)
      const eS = new Float32Array(429 + 1160), eC = Float64Array.from(p.base), ie = p.iId.indexOf('eq');
      for (let k = 0; k < p.NFX; k++) eS[429 + k] = p.base[k];
      const a = FX.eqResponse(p, ie, eS, fr, FS), b = FX.eqResponse(p, ie, eC, fr, FS), c2 = FX.eqResponse(p, 0, null, fr, FS);
      for (let i = 0; i < fr.length; i++) {
        assert.ok(Math.abs(a[i] - want[i]) < 1e-3); assert.ok(Math.abs(b[i] - want[i]) < 1e-9); assert.equal(c2[i], want[i]);
      }
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
  assert.ok(Math.abs(grc(r)[0] - 9) < 0.6, 'GR meter ' + grc(r)[0]);
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
  assert.ok(grc(r)[0] > 0);
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
  assert.deepEqual(Array.from(grc(r)), [0, 0, 0, 0]);
  assert.ok(r.gr().every((v, i) => v === 0 || (i >= 24 && i < 28)), 'only the compressor instance meters');
  // OTT behaviour (ratio 4): quiet material is lifted, loud material is pushed down, per band meters move
  r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.mb': 1 }));
  const q = noise(FS, 31, 0.003), qo = q.slice();
  run(r, qo, qo.slice());
  assert.ok(rms(qo, FS / 2) > 2 * rms(q, FS / 2), 'quiet lifted ' + dB(rms(qo, FS / 2) / rms(q, FS / 2)));
  assert.ok(grc(r)[1] < 0 && grc(r)[2] < 0 && grc(r)[3] < 0, 'upward gain shows as negative GR');
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
  const sf = mod(r, 'fil').sf, calls = [];
  const orig = sf.set.bind(sf);
  sf.set = (a, b, c, d, e) => { calls.push(a); return orig(a, b, c, d, e); };
  const L = noise(512, 1), R = noise(512, 2);
  r.process(L.subarray(0, 128), R.subarray(0, 128), 128);
  assert.equal(calls.length, 0, 'static: no coefficient updates');
  const mods = new Float64Array(NFX0);
  mods[AT[FX.FIDX.FIL_CUTOFF]] = 0.4;
  r.setMods(mods);
  mods[AT[FX.FIDX.FIL_CUTOFF]] = 0;                               // copied: later edits of the array do not leak in
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
  mods[AT[FX.FIDX.FIL_CUTOFF]] = 5;
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
    if (retrig) { r.trigger(); assert.ok(Math.abs(ph4(r)[0] - 0.3) < 1e-12, 'voice 0 restarts at phase[0]'); }
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
  assert.ok(near(ph4(r), P), 'phases() = P before processing');
  run(r, noise(FS / 2, 1), noise(FS / 2, 2));
  assert.ok(near(ph4(r), P), 'rate 0 holds');
  // ladder index 0 (Off) holds too
  r.set(fxp({ ...hold, 'fx.flg.bpm': 1, 'fx.flg.rate': 0 }, { phase: Float64Array.from(P) }));
  run(r, noise(4800, 3), noise(4800, 4));
  assert.ok(Math.abs(ph4(r)[1] - P[1]) < 1e-12);
  // running
  r.set(fxp({ ...on, 'fx.hyper.rate': 0.5, 'fx.flg.rate': 0.5, 'fx.phs.rate': 0.5, 'fx.cho.rate': 0.5 }, { phase: Float64Array.from(P) }));
  run(r, noise(FS / 4, 5), noise(FS / 4, 6));
  const moved = ph4(r);
  assert.ok(moved.every((v, i) => Math.abs(v - P[i]) > 1e-3), 'running');
  // seed 0 with a different phase: no re-seed (expected advance of 1/4 s at the flanger rate: 20·0.5⁴ = 1.25 Hz)
  r.set(fxp({ ...on, 'fx.hyper.rate': 0.5, 'fx.flg.rate': 0.5, 'fx.phs.rate': 0.5, 'fx.cho.rate': 0.5 }, { phase: Float64Array.from(Q), seed: 0 }));
  assert.ok(near(ph4(r), moved), 'unchanged by set() with seed 0');
  run(r, new Float64Array(128), new Float64Array(128));
  assert.ok(Math.abs(((ph4(r)[1] - moved[1] + 1) % 1) - 1.25 * 128 / FS) < 1e-9);
  r.transport();
  assert.ok(near(ph4(r), Q), 'transport() re-seeds from the last phase');
  // seed 1 re-seeds immediately
  r.set(fxp({ ...hold }, { phase: Float64Array.from(P), seed: 1 }));
  assert.ok(near(ph4(r), P));
  // Flanger R = L + PHASE: with PHASE 180° the two delays are mirror images (L at max when R at min)
});

/* ------------------------------------------------------------------ §10.5.14 distCurve */

test('§10.5.14 distCurve equals the module\'s static response (slow ramp, mix 1, filter OFF, level 0.5)', () => {
  const N = 96000, LAT = 15;
  const xa = new Float32Array(1025), xb = new Float32Array(1025);
  for (let j = 0; j <= 1024; j++) { const x = j / 1024; xa[j] = x * x; xb[j] = Math.sqrt(x); }
  const fxt = { key: 'test', xs: [{ id: 'dist', xsA: xa, xsB: xb }] };   // FXT v2: tables per Distortion instance id
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
  p.iAlloc[5] = 0;
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
  const S = 128, L = new Float64Array(S), R = new Float64Array(S), dL = new Float64Array(S), dR = new Float64Array(S), mods = new Float64Array(NFX0);
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
      mods[AT[F.FIDX.DLY_MODE]] = (s % 3) / 2; mods[AT[F.FIDX.DIST_MODE]] = (s % 16) / 15; mods[AT[F.FIDX.FIL_TYPE]] = (s % 96) / 95;
      mods[AT[F.FIDX.CMP_MB]] = (s >> 4) & 1 ? 0.6 : 0; mods[AT[F.FIDX.CMP_RATIO]] = (s >> 5) & 1 ? 0.3 : 0;
      mods[AT[F.FIDX.EQ_TYPEL]] = (s % 3) / 2; mods[AT[F.FIDX.FLG_BPM]] = s & 1; mods[AT[F.FIDX.FIL_CUTOFF]] = Math.sin(s / 10) * 0.3;
      mods[AT[F.FIDX.REV_SIZE]] = Math.sin(s / 7) * 0.3; mods[AT[F.FIDX.HYPER_UNISON]] = ((s >> 3) % 8) / 7 - 4 / 7;
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
  assert.equal(mod(r, 'rev').type, 0, 'the reverb topology changed inside the guarded region');
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
  // a corrupt v1 order is repaired by the compiler (normalizeFxV1: first occurrences, then the missing modules), so the
  // FXP instance list is always a valid order: here dist moves to the end, after eq
  assert.ok(sameBits(chain([0, 0, 2, 3, 4, 5, 6, 7, 8, 9]), ed));
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
  const bad = fxp({ 'fx.dist.on': 1 }, { ver: 1 });
  const r = rack(bad, FXT0, FS, F);
  const L = noise(1024, 1), R = noise(1024, 2), L0 = L.slice();
  run(r, L, R);
  assert.ok(sameBits(L, L0));
  r.set(bad);
  r.set(fxp({ 'fx.dist.on': 1 }, { ver: 3 }));
  assert.equal(con.msgs.filter((m) => m.level === 'warn').length, 1);
  // malformed instance arrays (missing, short): bypassed, one warning of its own
  for (const broken of [{ iOff: undefined }, { iType: new Uint8Array(2) }, { nI: 49 }, { nI: 1.5 }, { rRoute: null }]) {
    const q = rack(Object.assign(fxp({ 'fx.dist.on': 1 }), broken), FXT0, FS, F), a = noise(512, 3), a0 = a.slice();
    run(q, a, noise(512, 4));
    assert.ok(sameBits(a, a0), JSON.stringify(Object.keys(broken)));
  }
  assert.equal(con.msgs.filter((m) => m.level === 'warn').length, 2);
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
  const r3 = rack(FXP0), mods = new Float64Array(NFX0);
  mods[AT[0]] = NaN; mods[AT[5]] = Infinity;
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
    if (!soft) assert.ok(Math.abs(ph4(r)[1] - 0.25) < 1e-12, 'Panic re-seeds (cleared state)');
    run(r, sine(FS / 4, 220, 0.5), sine(FS / 4, 220, 0.5));
    const before = ph4(r)[1];
    assert.ok(Math.abs(before - 0.25) > 1e-3, 'running after the reset');
    r.set(fxp({ ...fl, 'fx.flg.mix': 0.8 }, { phase: Float64Array.from([0, 0.9, 0, 0]), seed: 0 }));
    assert.equal(ph4(r)[1], before, 'no re-seed on an ordinary edit after reset(' + soft + ')');
    run(r, new Float64Array(128), new Float64Array(128));
    assert.ok(Math.abs(ph4(r)[1] - before - FX.MODFX_HZ(0.6, false, 120) * 128 / FS) < 1e-12, 'and it keeps running');
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
        if (!over['fx.rev.on']) assert.equal(ph4(r)[over['fx.hyper.on'] ? 0 : over['fx.flg.on'] ? 1 : over['fx.phs.on'] ? 2 : 3], how === 'transport' ? 0.7 : 0.1);
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
  const hz = FX.MODFX_HZ(0.6, false, 120), ph = ph4(r)[1];
  assert.ok(ph > 0.3 && ph - 0.3 <= hz * 160 / FS + 1e-12, 'phase after the duck ' + ph);
});

test('Compressor: mode changes (RATIO ↔ Limit, MULTIBAND) are click-free; Limit plays current audio after a mode change', () => {
  const N = FS / 2, at = 94 * 128, f = 220, A = 0.5, slope = A * 2 * Math.PI * f / FS;
  // thr 0 dB: transparent in every mode, so any step comes from the switch itself
  const cases = [['SB→Limit', 0.75, 53, 0.3], ['Limit→SB', 1, 53, -0.3], ['SB→MB', 0.75, 96, 1], ['MB→SB', 0.75, 96, -1], ['MB(Limit)→Limit', 1, 96, -1]];
  for (const [name, ratio, idx, off] of cases) {
    const over = { 'fx.cmp.on': 1, 'fx.cmp.thr': 0, 'fx.cmp.ratio': ratio, 'fx.cmp.att': 0.6 };
    if (off < 0 && idx === 96) over['fx.cmp.mb'] = 1;
    const r = rack(fxp(over)), L = sine(N, f, A), R = L.slice(), mods = new Float64Array(NFX0);
    run(r, L, R, { before: (o) => { if (o === at) { mods[AT[idx]] = off; r.setMods(mods); } } });
    const steady = Math.max(maxStep(L, N / 4, at), maxStep(L, N - 4800, N));
    const st = maxStep(L, at - 64, at + 0.03 * FS);
    assert.ok(st <= 2 * Math.max(slope, steady), name + ': step ' + st.toFixed(5) + ' vs ' + Math.max(slope, steady).toFixed(5));
    let zeros = 0;
    for (let i = at; i < at + 960; i++) if (L[i] === 0) zeros++;
    assert.ok(zeros <= 2, name + ': ' + zeros + ' exact zeros after the switch');
  }
  // Limit on a loud 1 kHz tone, single band on a quiet 200 Hz tone for 1 s, Limit again: no replay of the old tone
  const r = rack(fxp({ 'fx.cmp.on': 1, 'fx.cmp.ratio': 1, 'fx.cmp.att': 1 })), mods = new Float64Array(NFX0);
  run(r, sine(FS / 2, 1000, 0.9), sine(FS / 2, 1000, 0.9));
  mods[AT[53]] = -0.3; r.setMods(mods);
  run(r, sine(FS, 200, 0.1), sine(FS, 200, 0.1));
  mods[AT[53]] = 0; r.setMods(mods);
  const L = sine(FS / 20, 200, 0.1, FS, 2 * Math.PI * 200 * 1.5), R = L.slice();
  run(r, L, R);
  assert.ok(peak(L) <= 0.1 + 1e-9, 'first 50 ms after returning to Limit: peak ' + peak(L));
  assert.equal(r.latency, 480);
  // enabling the compressor in Limit mode during a sine: no run of zeros from the empty look-ahead line
  const off = fxp({ 'fx.cmp.ratio': 1, 'fx.cmp.att': 1 }); off.iAlloc[6] = 1;
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
    const off = fxp({ 'fx.dist.mix': mix }); off.iAlloc[1] = 1;
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
  off.iAlloc[1] = 1;
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
  assert.equal(mod(r, 'rev').type, 0);
  // a silent rack switches at once
  const q = rack(p(1));
  run(q, new Float64Array(FS), new Float64Array(FS));
  q.set(p(0));
  assert.equal(mod(q, 'rev').type, 0);
});

test('warmUp() runs every compressor mode and a mode crossfade (no first-use compile on the audio thread)', () => {
  const r = new FX.FXRack(FS), proto = Object.getPrototypeOf(mod(rack(FXP0), 'cmp')), orig = proto.run, seen = new Set();
  proto.run = function (R, L, Rc, o, m) { seen.add(this.mode); if (this.cx < 1) seen.add('fade'); return orig.call(this, R, L, Rc, o, m); };
  try { r.warmUp(); } finally { proto.run = orig; }
  assert.deepEqual([...seen].map(String).sort(), ['0', '1', '2', 'fade']);
});

test('CPU (informative; fails only beyond 3×): all ten modules 1 s at 48 kHz ≤ 0.1 s; bypassed rack ≈ free', async () => {
  const all = {};
  for (const m of MODS) all['fx.' + m + '.on'] = 1;
  all['fx.dim.mix'] = 0.5;
  const cases = [['all modules, Hall, single-band comp', fxp(all)], ['all modules, Plate, multiband comp', fxp({ ...all, 'fx.cmp.mb': 1 }, { revType: 0 })],
    ['Serum-style rack with setMods every span', fxp({ 'fx.dly.on': 1, 'fx.rev.on': 1, 'fx.fil.on': 1 })]];
  for (const [name, p] of cases) {
    const r = rack(p);
    const S = 128, L = new Float64Array(S), R = new Float64Array(S), g = rng(1), mods = new Float64Array(NFX0);
    const go = (n) => { for (let s = 0; s < n; s++) { for (let i = 0; i < S; i++) { L[i] = 2 * g() - 1; R[i] = L[i]; } mods[AT[79]] = 0.1 * Math.sin(s / 20); r.setMods(mods); r.process(L, R, S); } };
    go(200);
    // tests/cpu-gate.mjs: calibrated pairs, median per-pair ratio, retries (RULINGS2 Performance); the 3× bound kept
    const t = (await CPU.gateLoad(() => go(FS / S), 0.1, { limit: 3, runs: 3 })).load;
    console.log('  fx-dsp CPU: ' + name + ': 1 s of audio in ' + (t * 1000).toFixed(1) + ' ms (calibrated)');
    assert.ok(t < 0.3, name + ' took ' + t + ' s');
  }
  // bypass cost: no module enabled, master 1 → O(1) per call, L/R untouched
  const r = rack(FXP0), S = 128, L = noise(S, 1), R = noise(S, 2), L0 = L.slice();
  for (let s = 0; s < 1000; s++) r.process(L, R, S);
  const t = 10 * 1000 * (await CPU.gateLoad(() => { for (let s = 0; s < FS / S; s++) r.process(L, R, S); }, 0.0015, { limit: 1, runs: 3 })).load;
  console.log('  fx-dsp CPU: bypassed rack, 10 s of audio in ' + t.toFixed(2) + ' ms (calibrated)');
  assert.ok(sameBits(L, L0));
  assert.ok(t < 15, 'bypass cost ' + t + ' ms per 10 s');
});

/* ------------------------------------------------------------------ SPEC-serum2 §8.1 / §15.10: FXP v2, instance graph (M1a) */

// a v2 FX state: racks = [[inst…] × 3], inst = [type, {pid: n}, id?, v = 1]; route / byp per rack
function st2(racks, { route = [0, 0, 0], byp = [0, 0, 0] } = {}) {
  return C.normalizeFx2({ v: 2, racks: racks.map((mods, k) => ({ mods: mods.map(([type, p, id, v = 1]) => ({ id, type, v, p })), route: route[k], byp: byp[k] })) });
}
const fxp2 = (st, ctx = {}) => C.compileFx(st, Object.assign({ buses: 1 }, ctx));   // a track with buses (Serum)
// process whole buffers in spans with the bus inputs (b1, b2: [L, R] or null) and the direct pair
function run2(r, L, R, { span = 128, d = null, b1 = null, b2 = null, before } = {}) {
  const sub = (a, o, m) => (a ? a.subarray(o, o + m) : undefined);
  for (let o = 0; o < L.length; o += span) {
    const m = Math.min(span, L.length - o);
    if (before) before(o, m);
    r.process(sub(L, o, m), sub(R, o, m), m, d && sub(d[0], o, m), d && sub(d[1], o, m), b1 && sub(b1[0], o, m), b1 && sub(b1[1], o, m),
      b2 && sub(b2[0], o, m), b2 && sub(b2[1], o, m));
  }
}
const nT = (ms) => nPow4('fx.dly.timeL', ms);
const DLY = (ms, o = {}) => ({ on: 1, feed: 0, mix: 1, q: 1, bpm: 0, link: 1, timeL: nT(ms), ...o });   // echo only, flat

test('§8.1 bit-exactness: v1 racks (all ten S1 instances, and migrateFx1 with refs) with FX-context modulation ≡ the Phase-1 rack', async () => {
  const P1 = await import('./ref-p1/serum-core.js');
  const ref = vm.createContext({ console: mkConsole() });
  vm.runInContext(readFileSync(new URL('./ref-p1/serum-dsp.js', import.meta.url), 'utf8'), ref);
  vm.runInContext(readFileSync(new URL('./ref-p1/fx-dsp.js', import.meta.url), 'utf8'), ref);
  const N = 0.75 * FS;
  let audible = 0;
  for (let t = 0; t < 24; t++) {
    const g = rng(1000 + t), fx = P1.defaultFx(), order = MODS.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(g() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    if (g() < 0.7) fx.order = order;
    const on = new Set(order.slice(0, 1 + Math.floor(g() * 5)));
    for (const id of Object.keys(fx.p)) {
      const m = id.split('.')[1] === 'dim' ? 'hyper' : id.split('.')[1];
      if (!on.has(m)) continue;
      if (id === 'fx.' + m + '.on') fx.p[id] = 1; else if (g() < 0.6) fx.p[id] = g();
    }
    fx.rev.type = g() < 0.5 ? 0 : 1; fx.cho.mono = g() < 0.3 ? 1 : 0; fx.phase = [g(), g(), g(), g()];
    fx.dist.xa = [[0, 0, 0], [0.3 + 0.4 * g(), g(), 0.5 - g()], [1, 1, 0]];
    const v1 = P1.normalizeFx(fx);
    // modulation: a few random v1 FX destinations (one may enable a pristine module: it must be kept as a reference)
    const ids = FXD.map((d) => d.id).filter((id) => id !== 'g.bypass'), md1 = new Uint8Array(100), tg = [];
    for (let k = 0; k < 4; k++) { const id = ids[Math.floor(g() * ids.length)]; tg.push(id); md1[FI[id]] = 1; }
    if (g() < 0.5) { const m = MODS[Math.floor(g() * 10)]; tg.push('fx.' + m + '.on'); md1[FI['fx.' + m + '.on']] = 1; }
    const s = { matrix: tg.map((id) => ({ src: 'lfo1', dst: C.RENAME1[id] || id, amt: 1 })) };
    const ctx = { bpm: 120, master: 0.5 + 0.3 * g(), modded: md1, seed: 1, smooth: 1, silence: 1 };
    const A = new ref.FXDSP.FXRack(FS), sides = [];
    A.set(P1.compileFx(v1, ctx), P1.compileFxT(v1));
    for (const fxs of [v1, C.migrateFx1(v1, s)]) {
      const p = C.compileFx(fxs, ctx), B = new FX.FXRack(FS);
      B.set(p, C.compileFxT(fxs));
      // FX-context index of every v1 fx idx in this FXP (−1: the instance was dropped by the migration)
      const at = Int32Array.from(FXD, (d, k) => {
        if (k === 0) return 0;
        if (k === 86) return 1;
        const e = C.fxDest(d.id, fxs);
        return e ? 8 + e.flat : -1;
      });
      sides.push({ B, at, md: new Float64Array(p.NFX) });
    }
    assert.ok(sides[1].B.U.length <= sides[0].B.U.length);
    const L = noise(N, 2 * t + 1, 0.6), R = noise(N, 2 * t + 2, 0.6);
    for (let i = 0.4 * FS; i < N; i++) { L[i] = 0; R[i] = 0; }
    const outs = [A, sides[0].B, sides[1].B].map(() => [L.slice(), R.slice()]);
    const m1 = new Float64Array(100);
    for (let o = 0, s0 = 0; o < N; o += 128, s0++) {
      for (const id of tg) m1[FI[id]] = 0.4 * Math.sin(s0 / 9 + FI[id]);
      A.setMods(m1);
      for (const S of sides) { S.md.fill(0); for (let k = 0; k < 100; k++) if (S.at[k] >= 0) S.md[S.at[k]] = m1[k]; S.B.setMods(S.md); }
      if (s0 === 60) { A.trigger(); for (const S of sides) S.B.trigger(); }
      if (s0 === 150) { A.transport(); for (const S of sides) S.B.transport(); }
      [A, sides[0].B, sides[1].B].forEach((x, j) => x.process(outs[j][0].subarray(o, o + 128), outs[j][1].subarray(o, o + 128), 128));
    }
    for (const j of [1, 2]) {
      assert.ok(sameBits(outs[j][0], outs[0][0]) && sameBits(outs[j][1], outs[0][1]), 'state ' + t + (j === 1 ? ' (all S1 instances)' : ' (migrateFx1)'));
    }
    if (peak(outs[0][0]) > 1e-3) audible++;
    const B0 = sides[0].B;                                          // Phase-1 phases() = [hyper, flg, phs, cho]; v2: by instance
    assert.deepEqual(Array.from(A.phases()), ['hyper', 'flg', 'phs', 'cho'].map((id) => B0.phases()[B0.byId.get(id).idx]), 'phases by instance');
  }
  assert.ok(audible >= 18, audible + ' audible racks');
});

test('§0.3 / §15.10: with SxBase replaced by null (dsp-scope override) S1-variant racks render bit-identically', () => {
  const files = ['sx-base.js', 'serum-dsp.js', 'fx-dsp.js'];
  const a = dspScope({ files }), b = dspScope({ files, overrides: { 'sx-base.js': null } });
  assert.equal(b.global('SxBase'), null);
  const all = {};
  for (const m of MODS) all['fx.' + m + '.on'] = 1;
  const p = fxp({ ...all, 'fx.dim.mix': 0.4, 'fx.fil.type': 7 / 95 }, { filTypeAll: 1 }), outs = [];
  for (const S of [a, b]) {
    const r = new (S.global('FXDSP').FXRack)(FS);
    r.set(p, FXT0);
    const L = noise(FS / 2, 3), R = noise(FS / 2, 4);
    run(r, L, R);
    outs.push([L, R]);
  }
  assert.ok(sameBits(outs[0][0], outs[1][0]) && sameBits(outs[0][1], outs[1][1]));
  assert.ok(peak(outs[0][0]) > 0.01);
});

test('§8.1 instance graph: units kept by id (insert / reorder: no change), removal fades out in 5 ms, type change, revival', () => {
  const dl = ['dly', DLY(50, { feed: 0.6, mix: 0.5 })], eqOff = ['eq', { on: 0 }], rv = ['rev', { on: 1, mix: 0.6, t: 0.4 }];
  const SA = st2([[dl, rv], [], []]), SB = st2([[eqOff, dl, rv], [], []]), SC = st2([[dl, eqOff, rv], [], []]);
  const x = noise(FS, 5, 0.5);
  const go = (edits) => {
    const r = new FX.FXRack(FS), L = x.slice(), R = x.slice();
    r.set(fxp2(SA), null);
    run(r, L, R, { before: (o) => { if (edits[o]) r.set(fxp2(edits[o]), null); } });
    return { r, L, R };
  };
  const ref = go({}), ins = go({ [100 * 128]: SB }), reo = go({ [100 * 128]: SB, [200 * 128]: SC });
  assert.ok(sameBits(ins.L, ref.L) && sameBits(ins.R, ref.R), 'a disabled instance inserted before: the kept units continue unchanged');
  assert.ok(sameBits(reo.L, ref.L) && sameBits(reo.R, ref.R), 'reordering around a disabled instance');
  assert.equal(reo.r.byId.get('dly'), reo.r.U.find((u) => u.id === 'dly'));
  assert.deepEqual(Array.from(reo.r.C0, (u) => u.id), ['dly', 'eq', 'rev'], 'disabled S1 instances are units too, chain = FXP order');
  // removal of the sounding reverb: 5 ms fade at its place, then exactly the remaining chain, and the unit is dropped
  const at = 150 * 128, SD1 = st2([[dl], [], []]);
  const rm = go({ [at]: SD1 }), solo = new FX.FXRack(FS), A = x.slice(), B = x.slice();
  solo.set(fxp2(SA), null);
  run(solo, A.subarray(0, at), B.subarray(0, at));
  assert.ok(sameBits(rm.L.subarray(0, at), A.subarray(0, at)));
  const fade = Math.ceil(0.005 * FS) + 16;
  assert.ok(maxStep(rm.L, at - 16, at + fade + 64) < 2 * maxStep(ref.L, at - 2000, at), 'no step at the removal');
  assert.equal(rm.r.U.length, 1, 'the faded reverb unit is dropped');
  const only = new FX.FXRack(FS);
  only.set(fxp2(SA), null);
  const C2 = x.slice(), D2 = x.slice();
  run(only, C2.subarray(0, at), D2.subarray(0, at));
  only.set(fxp2(SD1), null);
  run(only, C2.subarray(at), D2.subarray(at));
  assert.ok(sameBits(C2, rm.L), 'deterministic');
  // after the fade the output equals the delay alone continuing (its state kept): compare with a rack whose reverb was
  // disabled from the start of the fade (st 2 → 0 is the same 5 ms crossfade)
  const off = go({ [at]: st2([[dl, ['rev', { on: 0, mix: 0.6, t: 0.4 }]], [], []]) });
  assert.ok(sameBits(rm.L, off.L) && sameBits(rm.R, off.R), 'removal = disable fade, then drop');
  // same id, another type: the delay fades out, a chorus (new unit) fades in
  const tc = go({ [at]: st2([[['cho', { on: 1, mix: 1 }, 'dly'], rv], [], []]) });
  assert.ok(tc.L.every(Number.isFinite) && maxStep(tc.L, at - 16, at + fade + 64) < 2 * maxStep(ref.L, at - 2000, at), 'no step at the type change');
  assert.equal(tc.r.byId.get('dly').k, 4, 'id dly is a chorus now');
  const r3 = new FX.FXRack(FS), y = x.slice(), y2 = x.slice();
  r3.set(fxp2(SA), null);
  run(r3, y.subarray(0, at), y2.subarray(0, at));
  const oldD = r3.byId.get('dly');
  r3.set(fxp2(st2([[['cho', { on: 1, mix: 1 }, 'dly'], rv], [], []])), null);
  assert.deepEqual(Array.from(r3.C0, (u) => u.id + (u === oldD ? '(old)' : '')), ['dly(old)', 'dly', 'rev'], 'the old delay fades at its old place (no kept predecessor: the head)');
  run(r3, y.subarray(at, at + 512), y2.subarray(at, at + 512));
  assert.ok(!r3.U.includes(oldD) && r3.U.length === 2, 'dropped after the fade');
  assert.deepEqual(Array.from(tc.r.C0, (u) => u.id), ['dly', 'rev']);
  // revival: removed and re-added within the fade → the same unit continues (fades back in)
  const rvv = go({ [at]: SD1, [at + 128]: SA });
  assert.equal(rvv.r.U.length, 2);
  assert.ok(maxStep(rvv.L, at - 16, at + 1024) < 2 * maxStep(ref.L, at - 2000, at), 'no step around the revival');
});

test('§8.1 several instances of one type run as independent units (two delays in series: echo at the sum)', () => {
  const r = new FX.FXRack(FS);
  r.set(fxp2(st2([[['dly', DLY(100)], ['dly', DLY(250)]], [], []])), null);
  assert.deepEqual(Array.from(r.C0, (u) => u.id), ['dly', 'dly2']);
  const L = imp(FS), R = imp(FS);
  run(r, L, R);
  const k = L.indexOf(peak(L));
  assert.ok(Math.abs(k - 0.35 * FS) <= 2 && peak(L) > 0.99, 'echo at ' + k);
  assert.ok(peak(L, 0, 0.34 * FS) < 1e-9 && peak(L, 0.36 * FS) < 1e-9, 'nothing else');
});

test('§1 buses: Bus → Main / Direct / other Bus in dependency order, bus and direct levels, rack bypass; neutral levels skipped', () => {
  const N = 0.5 * FS, z = () => new Float64Array(N);
  // Bus 1 → Main through a delay on Bus 1 (main input silent)
  let r = new FX.FXRack(FS), L = z(), R = z();
  r.set(fxp2(st2([[], [['dly', DLY(100)]], []])), null);
  run2(r, L, R, { b1: [imp(N), imp(N)] });
  assert.ok(peak(L, 4798, 4803) > 0.99 && peak(L, 0, 4790) < 1e-12 && peak(R, 4798, 4803) > 0.99, 'bus 1 delay into main');
  // empty bus rack, n 0.5 level: exactly main + bus (no multiply)
  r = new FX.FXRack(FS);
  r.set(fxp2(st2([[], [], []])), null);
  const m = noise(N, 1), b = noise(N, 2), L2 = m.slice(), R2 = m.slice();
  run2(r, L2, R2, { b1: [b, b] });
  assert.ok(L2.every((v, i) => v === m[i] + b[i]), 'neutral bus level: plain sum');
  // Bus 1 → Direct: skips the main rack (a 100 ms wet-only delay there), × g.direct (n 0.25 = ×0.25)
  r = new FX.FXRack(FS);
  r.set(fxp2(st2([[['dly', DLY(100)]], [], []], { route: [0, 1, 0] }), { direct: 0.25 }), null);
  L = z(); R = z();
  run2(r, L, R, { b1: [imp(N), imp(N)] });
  assert.ok(L[0] === 0.25 && peak(L, 1) < 1e-12, 'bus 1 → direct at 0, ×0.25: ' + L[0]);
  // the engine's direct pair takes the same level
  r = new FX.FXRack(FS);
  r.set(fxp2(st2([[], [], []]), { direct: 0.75 }), null);
  L = z(); R = z();
  run2(r, L, R, { d: [imp(N), imp(N)] });
  assert.equal(L[0], 2.25);
  // Bus 1 → Bus 2 → Main: levels multiply (n 0.25 → ×0.25, n 0.75 → ×2.25); Bus 2's own input joins it
  for (const order of [[2, 0], [0, 2]]) {
    r = new FX.FXRack(FS);
    const route = order[0] === 2 ? [0, 2, 0] : [0, 0, 2];
    r.set(fxp2(st2([[], [], []], { route }), { bus1v: 0.25, bus2v: 0.75 }), null);
    L = z(); R = z();
    run2(r, L, R, { b1: [imp(N), imp(N)], b2: [imp(N, 10), imp(N, 10)] });
    if (route[1] === 2) assert.deepEqual([L[0], L[10]], [0.25 * 2.25, 2.25], 'bus 1 → bus 2 → main');
    else assert.deepEqual([L[0], L[10]], [0.25, 2.25 * 0.25], 'bus 2 → bus 1 → main');
  }
  // both buses into each other: normalised to BUS 2 → Main
  assert.deepEqual(Array.from(fxp2(st2([[], [], []], { route: [0, 2, 2] })).rRoute), [0, 2, 0]);
  // rack bypass: a bypassed bus (or main) rack passes its input, its units frozen
  for (const k of [0, 1]) {
    r = new FX.FXRack(FS);
    const racks = [[], [], []], byp = [0, 0, 0];
    racks[k] = [['dly', DLY(100)]]; byp[k] = 1;
    r.set(fxp2(st2(racks, { byp })), null);
    L = k === 0 ? imp(N) : z(); R = L.slice();
    run2(r, L, R, k ? { b1: [imp(N), imp(N)] } : {});
    assert.ok(L[0] === 1 && peak(L, 1) === 0, 'rack ' + k + ' bypassed');
  }
  // rack bypass during audio: 5 ms crossfade, then the input exactly
  r = new FX.FXRack(FS);
  const filt = [['fil', { on: 1, cutoff: 0.4 }]];
  r.set(fxp2(st2([filt, [], []])), null);
  const x = sine(N, 300, 0.5), y = x.slice(), y2 = x.slice(), at = 64 * 128;
  run2(r, y, y2, { before: (o) => { if (o === at) r.set(fxp2(st2([filt, [], []], { byp: [1, 0, 0] })), null); } });
  assert.ok(maxStep(y, at - 64, at + 512) < 3 * 0.5 * 2 * Math.PI * 300 / FS, 'click-free');
  assert.ok(y.subarray(at + 256).every((v, i) => v === x[at + 256 + i]), 'input after the fade');
  // a bus level is a modulation destination: FX-context [3]
  r = new FX.FXRack(FS);
  const p = fxp2(st2([[], [], []]));
  r.set(p, null);
  const off = new Float64Array(p.NFX);
  off[3] = -0.25;
  r.setMods(off, p.key);
  L = z(); R = z();
  run2(r, L, R, { b1: [new Float64Array(N).fill(1), new Float64Array(N).fill(1)] });
  assert.equal(L[N - 1], 0.25, 'eff n 0.25 → ×0.25');
});

test('§4.2 setMods: FX-context layout; a stale layout key or a short vector means no modulation', () => {
  const S = st2([[['fil', { on: 1, cutoff: 0.3 }]], [], []]), p = fxp2(S), r = new FX.FXRack(FS);
  r.set(p, null);
  const sf = mod(r, 'fil').sf, calls = [];
  const orig = sf.set.bind(sf);
  sf.set = (a, ...x) => { calls.push(a); return orig(a, ...x); };
  const off = new Float64Array(p.NFX), k = 8 + C.fxDest('fx.fil.cutoff', S).flat;
  off[k] = 0.4;
  const step = () => { calls.length = 0; r.process(new Float64Array(128), new Float64Array(128), 128); return calls.length ? nExp('fx.fil.cutoff', calls[calls.length - 1]) : null; };
  r.setMods(off, 'other');
  assert.equal(step(), null, 'stale key ignored');
  r.setMods(off.subarray(0, p.NFX - 1));
  assert.equal(step(), null, 'short vector ignored');
  r.setMods(off, p.key);
  assert.ok(Math.abs(step() - 0.7) < 1e-12, 'matching key');
  r.setMods(null);
  assert.ok(Math.abs(step() - 0.3) < 1e-12);
  r.setMods(off);
  assert.ok(Math.abs(step() - 0.7) < 1e-12, 'no key: accepted');
  assert.equal(p.key, C.fxLayout(S).key);
});

test('§8.1 phases() and gr() are indexed by FXP instance (fxLayout order), NaN without an LFO; S2 variants pass audio without SxBase', () => {
  const S = st2([[['dist', { on: 1, mix: 0 }], ['cmp', { on: 1, thr: 0.9 }], ['flg', { on: 1, rate: 0 }, 'f1']], [['cho', { on: 1, rate: 0 }]], []]);
  S.racks[0].mods[2].ph = 0.3; S.racks[1].mods[0].ph = 0.6;
  const r = new FX.FXRack(FS);
  r.set(fxp2(S), null);
  const ph = r.phases();
  assert.ok(Number.isNaN(ph[0]) && Number.isNaN(ph[1]) && ph[2] === 0.3 && ph[3] === 0.6 && ph.slice(4).every(Number.isNaN));
  run(r, sine(FS / 4, 200, 0.9), sine(FS / 4, 200, 0.9));
  const gr = r.gr();
  assert.ok(gr[4] > 1 && gr.every((v, i) => v === 0 || (i >= 4 && i < 8)), 'compressor (instance 1) at [4…7]: ' + gr[4]);
  // storePhases writes them back by instance
  const S2 = JSON.parse(JSON.stringify(S));
  C.storePhases(S2, ph);
  assert.deepEqual([S2.racks[0].mods[2].ph, S2.racks[1].mods[0].ph, S2.racks[0].mods[0].ph], [0.3, 0.6, 0]);
  // §0.3 failure column: without SxBase / FXMods2 in the scope (this file's loadDSP evaluates serum-dsp and fx-dsp only),
  // S2 variants, the new types and splitters (with their branch instances) are not run: the input passes
  const V = st2([[['dly', { on: 1, mix: 1 }, 'd2', 2], ['bode', { on: 1 }, 'b', 2], ['util', { on: 1, width: 0 }, 'u', 2]], [], []]);
  V.racks[0].mods.push({ id: 'sp', type: 'split2', v: 2, p: { on: 1 }, br: [[{ id: 'e', type: 'eq', v: 1, p: { on: 1, gainL: 1 } }], []], bb: [0, 0] });
  const V2 = C.normalizeFx2(V), q = new FX.FXRack(FS), pv = fxp2(V2);
  assert.equal(pv.nI, 5);
  q.set(pv, null);
  assert.equal(q.U.length, 0, 'no units without SxBase: S2 variants, new types, splitters and their branch instances pass');
  const L = noise(4096, 9), R = noise(4096, 10), L0 = L.slice();
  run(q, L, R);
  assert.ok(sameBits(L, L0));
});

test('§10.5.17 v2: process() does not allocate with buses, several instances, routing and rack bypass fades', () => {
  const { ctx, FXDSP: F } = loadDSP();
  const S = st2([[['dist', { on: 1 }], ['dly', DLY(30, { feed: 0.5 })], ['rev', { on: 1 }]], [['cho', { on: 1 }], ['cmp', { on: 1, ratio: 1 }]],
    [['phs', { on: 1 }], ['hyper', { on: 1, dmix: 0.5 }]]], { route: [0, 2, 1] });
  const p = fxp2(S, { direct: 0.3, bus1v: 0.6, bus2v: 0.4 }), r = new F.FXRack(FS);
  r.set(p, C.compileFxT(S));
  const B = st2(S.racks.map((R) => R.mods.map((I) => [I.type, I.p, I.id])), { route: [0, 2, 1], byp: [0, 1, 0] }), pb = fxp2(B);
  const n = 128, a = () => new Float64Array(n), [L, R, dL, dR, b1L, b1R, b2L, b2R] = [a(), a(), a(), a(), a(), a(), a(), a()], md = new Float64Array(p.NFX);
  const g = rng(4);
  const fill = () => { for (const x of [L, R, dL, dR, b1L, b1R, b2L, b2R]) for (let i = 0; i < n; i++) x[i] = 0.5 * (2 * g() - 1); };
  fill(); r.process(L, R, n, dL, dR, b1L, b1R, b2L, b2R);
  r.set(pb, null);                                                  // Bus 1 bypass fade runs below
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Object', 'Set'];
  const saved = {};
  for (const k of names) { saved[k] = ctx[k]; ctx[k] = function () { throw new Error('allocation: ' + k); }; }
  try {
    for (let s = 0; s < 400; s++) {
      fill();
      md[3] = 0.2 * Math.sin(s / 7); md[2] = -0.1; md[8 + 3] = 0.1 * Math.sin(s / 5);
      r.setMods(md, p.key);
      if (s === 100) r.transport();
      if (s === 200) r.trigger();
      r.setNote(48 + (s % 37));
      r.process(L, R, n, s & 1 ? dL : undefined, s & 1 ? dR : undefined, b1L, b1R, s & 2 ? b2L : undefined, s & 2 ? b2R : undefined);
      for (let i = 0; i < n; i++) if (!Number.isFinite(L[i])) throw new Error('non-finite');
      r.gr(); r.phases(); r.idle();
    }
  } finally {
    for (const k of names) { if (saved[k] === undefined) delete ctx[k]; else ctx[k] = saved[k]; }
  }
});

/* ------------------------------------------------------------------ SPEC-serum2 M1b: final §11.11 helper signatures */

test('§11.11 splitResponse: LR4 bands (−6.02 dB at the crossover, magnitudes sum to 1), L/M/H, M/S flat; distCurve(…, stages) 16 / 17', () => {
  assert.equal(typeof FX.splitResponse, 'function');
  assert.equal(FX.splitResponse.length, 5, 'splitResponse(type, f1, f2, freqs, fs)');
  assert.equal(FX.distCurve.length, 4, 'distCurve(mode, drive, xsA, xsB, n = 257, stages = 4)');
  const fr = Float64Array.from({ length: 241 }, (_, i) => 20 * Math.pow(1000, i / 240));   // 20 Hz … 20 kHz
  const amp = (db) => Math.pow(10, db / 20);
  for (const fs of [44100, FS, 192000]) {
    const two = FX.splitResponse(13, 300, 0, fr, fs);
    assert.equal(two.length, 2);
    for (let i = 0; i < fr.length; i++) assert.ok(Math.abs(amp(two[0][i]) + amp(two[1][i]) - 1) < 1e-12, 'L/H sum ' + fr[i]);
    const x = FX.splitResponse('split2', 300, 0, [300, 30, 3000], fs);
    assert.ok(Math.abs(x[0][0] + 6.0206) < 1e-3 && Math.abs(x[1][0] + 6.0206) < 1e-3, '−6.02 dB at the crossover');
    assert.ok(x[0][1] > -0.01 && x[1][1] < -75, 'decade below: low band flat, high band ≈ −80 dB (24 dB/oct)');
    assert.ok(x[1][2] > -0.01 && x[0][2] < -75, 'decade above');
    const three = FX.splitResponse(14, 200, 2000, fr, fs);
    assert.equal(three.length, 3);
    for (let i = 0; i < fr.length; i++) {
      assert.ok(Math.abs(amp(three[0][i]) + amp(three[1][i]) + amp(three[2][i]) - 1) < 1e-12, 'L/M/H sum ' + fr[i]);
    }
    const y = FX.splitResponse(14, 200, 2000, [200, 2000, 630], fs);
    assert.ok(Math.abs(y[0][0] + 6.0206) < 1e-3 && Math.abs(y[2][1] + 6.0206) < 0.05, 'band edges');
    assert.ok(y[1][2] > -0.5, 'mid band passes between the crossovers');
  }
  // f2 < 1.2·f1 is raised to 1.2·f1 (the module's runtime rule); f1 / f2 clamped to [10, 0.45·fs]
  const bands = (...a) => Array.from(FX.splitResponse(...a), b => Array.from(b));
  assert.deepEqual(bands(14, 1000, 500, fr, FS), bands(14, 1000, 1200, fr, FS));
  assert.deepEqual(bands(13, 1e6, 0, fr, FS), bands(13, 0.45 * FS, 0, fr, FS));
  // M/S: two flat branches; f = 0 and f ≥ fs/2 finite (floor −300 dB); other types: null; no freqs: empty bands
  const ms = FX.splitResponse(15, 100, 100, fr, FS);
  assert.ok(ms.length === 2 && ms.every(a => a.length === fr.length && a.every(v => v === 0)));
  const edge = FX.splitResponse(13, 300, 0, [0, FS / 2, FS, -5, NaN], FS);
  assert.ok(edge.every(a => a.every(Number.isFinite) && a.every(v => v >= -300.0001)));
  for (const t of [0, 6, 10, 'bode', 'x', 16, NaN]) assert.equal(FX.splitResponse(t, 300, 0, fr, FS), null, String(t));
  assert.deepEqual(Array.from(FX.splitResponse('split3', 200, 2000, [], FS), a => a.length), [0, 0, 0]);
  assert.deepEqual(Array.from(FX.splitResponse(13, 300, 0, null), a => a.length), [0, 0]);
  // distCurve: the S2 modes 16 Overdrive (static chain of `stages`, default 4) and 17 Soft Sat. (§8.2), here without SxBase
  // (the §8.2 formulas); modes 0–15 unchanged (§10.5.14 above)
  const G = (d) => 0.5 * Math.pow(10, d), K = 1 / Math.tanh(1.8), od1 = (x, d) => 0.9 * Math.tanh(1.8 * G(d) * x) * K;
  const c16 = FX.distCurve(16, 0.5, null, null, 5, 1), c16b = FX.distCurve(16, 0.5, null, null, 5, 3), c16d = FX.distCurve(16, 0.5, null, null, 5);
  for (let i = 0; i < 5; i++) {
    const x = -1 + i / 2, w1 = od1(x, 0.5), w3 = od1(od1(w1, Math.log10(2 / 0.9)), Math.log10(2 / 0.9));
    assert.ok(Math.abs(c16[i] - w1) < 1e-12 && Math.abs(c16b[i] - w3) < 1e-12, 'Overdrive x ' + x);
    assert.ok(Math.abs(c16d[i] - od1(w3, Math.log10(2 / 0.9))) < 1e-12, 'default 4 stages');
  }
  const c17 = FX.distCurve(17, 0.3, null, null, 9), g17 = 0.5 * Math.pow(10, 0.18);
  for (let i = 0; i < 9; i++) { const u = g17 * (-1 + i / 4); assert.ok(Math.abs(c17[i] - (Math.abs(u) < 1 ? 1.5 * u - 0.5 * u * u * u : Math.sign(u))) < 1e-12); }
  assert.equal(FX.distCurve(15, 0.5, null, null, 33, 8).length, 33);
});

/* ------------------------------------------------------------------ SPEC-serum2 M2: S2 variants and the new modules in the rack */

const FULL = dspScope();                                          // the §0.3 list (SxBase, SxFilt2, SerumDSP, FXMods2 …)
const FX2 = FULL.global('FXDSP');
// a v2 state: racks = [[inst…] × 3], inst = [type, {pid: n}, id?, v = 2] or an instance object (splitters with br)
function s2(racks, o = {}) {
  return C.normalizeFx2({ v: 2, racks: racks.map((mods, k) => ({ mods: mods.map((m) => (Array.isArray(m) ? { type: m[0], p: m[1], id: m[2], v: m[3] || 2 } : m)),
    route: (o.route || [])[k], byp: (o.byp || [])[k] })) });
}
function rack2(state, { fs = FS, ctx = {}, F = FX2, fxt } = {}) {
  const r = new F.FXRack(fs);
  r.set(C.compileFx(state, Object.assign({ rate: fs, buses: 1 }, ctx)), fxt === undefined ? C.compileFxT(state) : fxt);
  return r;
}
// n of an engine value for a row of FXP_TAB[type][v]
const nOf = (type, pid, val, v = 2) => { const r = C.FXP_TAB[type][v].find((x) => x.pid === pid); return lawNorm(r.law, r.lo, r.hi, val, r.def); };
const render2 = (state, x, y, o = {}) => { const L = x.slice(), R = (y || x).slice(), r = rack2(state, o); run(r, L, R, o); return { L, R, r }; };
const tone = (r, f, i0, i1) => { let re = 0, im = 0; for (let i = i0; i < i1; i++) { const w = 2 * Math.PI * f * i / FS; re += r[i] * Math.cos(w); im += r[i] * Math.sin(w); } return 2 * Math.hypot(re, im) / (i1 - i0); };
// Schroeder energy decay: T60 extrapolated from the −5 … −25 dB range of the backward-integrated energy
function edcT60(y, fs = FS) {
  const N = y.length, e = new Float64Array(N);
  let acc = 0;
  for (let i = N - 1; i >= 0; i--) { acc += y[i] * y[i]; e[i] = acc; }
  const db = (i) => 10 * Math.log10(e[i] / e[0]);
  let a = 0, b = 0;
  while (a < N && db(a) > -5) a++;
  while (b < N && db(b) > -25) b++;
  return 3 * (b - a) / fs;
}
async function irStore(B, id, L, R, rate = FS) {
  const SMP = await import('../smp.js?v=9');
  assert.equal(B.storeAsset(id, Object.assign({ id, v: 1, kind: 'ir', bytes: 0 }, SMP.irPartition(L, R, rate))), true);
}

test('M2 §0.7 / §8.2: S2 variants at their S1-equivalent settings ≡ the S1 instances (bit-exact; Compressor ≈ crossover rounding)', () => {
  const x = noise(FS / 4, 21, 0.8), y = noise(FS / 4, 22, 0.8);
  const same = (a, b, msg) => assert.ok(sameBits(a.L, b.L) && sameBits(a.R, b.R), msg);
  for (const fs of [FS, 192000]) {
    const cases = [
      ['phs', { on: 1, rate: 0.3, depth: 0.7, feed: 0.6, mix: 0.8 }, { poles: 5 / 17, depth2: 0 }],
      ['cho', { on: 1, mix: 0.5, feed: 0.4 }, { hp: 0 }],
      ['eq', { on: 1, gainL: 0.8, gainH: 0.2, typeH: 0.5 }, { level: 0.5 }],
      ['dly', { on: 1, mix: 0.5, feed: 0.6, bpm: 0, timeL: 0.4 }, { hq: 0 }],
      ['fil', { on: 1, cutoff: 0.4, res: 0.5, drive: 0.3, type: 30 / 95 }, { type: 30 / 107, kt: 0, clean: 0 }],
    ];
    for (const [type, p, extra] of cases) {
      const a = render2(s2([[[type, p, 'x', 1]], [], []]), x, y, { fs });
      const up = C.upgradeInstance(s2([[[type, p, 'x', 1]], [], []]).racks[0].mods[0]);
      Object.assign(up.p, extra);
      same(a, render2(s2([[up], [], []]), x, y, { fs }), `${type} S2 ≡ S1 at ${fs} Hz`);
    }
    for (let mode = 0; mode < 16; mode++) {
      const a = render2(s2([[['dist', { on: 1, drive: 0.6, mode: mode / 15, mix: 0.9, filt: (mode % 3) / 2 }, 'x', 1]], [], []]), x.subarray(0, 4800), y.subarray(0, 4800), { fs });
      const b = render2(s2([[['dist', { on: 1, drive: 0.6, mode: mode / 17, mix: 0.9, filt: (mode % 3) / 2, kt: 0 }, 'x', 2]], [], []]), x.subarray(0, 4800), y.subarray(0, 4800), { fs });
      same(a, b, `Distortion mode ${mode} S2 ≡ S1 at ${fs} Hz`);
    }
  }
  // Compressor upgraded (BELOW = RATIO, band gains 0 dB): the S2 crossovers 128.3 Hz / 2500.2 Hz vs Phase-1 128.3 / 2500
  const p = { on: 1, mb: 1, ratio: 0.8, thr: 0.4 };
  const a = render2(s2([[['cmp', p, 'x', 1]], [], []]), x, y), b = render2(s2([[C.upgradeInstance(s2([[['cmp', p, 'x', 1]], [], []]).racks[0].mods[0])], [], []]), x, y);
  let e = 0;
  for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(a.L[i] - b.L[i]), Math.abs(a.R[i] - b.R[i]));
  assert.ok(e < 1e-3, 'Compressor S2 ≈ S1: ' + e);
});

test('M2 §8.2 Distortion S2: Overdrive / Soft Sat. static curves = distCurve; STAGES; Key Track (FREQ × setNote factor)', () => {
  const N = 96000, LAT = 15;
  for (const [mode, drive, stages] of [[16, 0.3, 4], [16, 0.6, 1], [16, 0.2, 8], [17, 0.25, 4], [17, 0.8, 4]]) {
    const st = s2([[['dist', { on: 1, mode: mode / 17, drive, stages: (stages - 1) / 15, mix: 1, filt: 0 }, 'd']], [], []]);
    const ramp = Float64Array.from({ length: N }, (_, i) => -1 + 2 * i / (N - 1));
    const L = new Float64Array(N + LAT), R = new Float64Array(N + LAT);
    L.set(ramp); R.set(ramp);
    for (let i = N; i < N + LAT; i++) { L[i] = 1; R[i] = 1; }
    run(rack2(st), L, R);
    const want = FX2.distCurve(mode, drive, null, null, N, stages);
    // Overdrive: each stage's 9 kHz one-pole (at 2×) delays a slow ramp by (1 − a)/(2a) base samples (its DC group delay)
    const a9 = 1 - Math.exp(-2 * Math.PI * 9000 / (2 * FS)), lag = mode === 16 ? stages * (1 - a9) / (2 * a9) : 0;
    const at = (q) => { const k = Math.floor(q), f = q - k; return want[k] + f * (want[k + 1] - want[k]); };
    let worst = 0;
    for (let i = 64; i < N - 1; i++) {
      let steep = false;                                          // skip the half-band smear where the curve is steep
      for (let k = Math.max(1, i - 24); k < Math.min(N, i + 24); k++) if (Math.abs(want[k] - want[k - 1]) > 0.002) { steep = true; break; }
      if (!steep) worst = Math.max(worst, Math.abs(L[i + LAT] - at(i - lag)));
    }
    assert.ok(worst < 1e-3, `mode ${mode} drive ${drive} stages ${stages}: ${worst}`);
  }
  // Key Track: the FREQ of the Distortion filter × 2^((pitch − 60)/12) from setNote (pre filter, band-pass)
  const f0 = 500, base = { on: 1, mode: 0, drive: 0, mix: 1, filt: 0.5, lbh: 0.5, freq: nOf('dist', 'freq', f0), q: nOf('dist', 'q', 4) };
  const x = noise(FS / 2, 3, 0.1);
  const kt = rack2(s2([[['dist', { ...base, kt: 1 }, 'd']], [], []]));
  kt.setNote(72);
  const A = x.slice(), B = x.slice();
  run(kt, A, B);
  const ref = render2(s2([[['dist', { ...base, kt: 0, freq: nOf('dist', 'freq', 2 * f0) }, 'd']], [], []]), x);
  let e = 0;
  for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(A[i] - ref.L[i]));
  assert.ok(e < 1e-6, 'key tracked FREQ at note 72 = FREQ × 2: ' + e);
  const off = render2(s2([[['dist', { ...base, kt: 0 }, 'd']], [], []]), x);
  kt.setNote(60);
  assert.ok(maxStep(off.L) > 0 && !sameBits(off.L, A), 'Key Track changes the sound');
});

test('M2 §8.2 Phaser S2 (POLES: P/2 notches, DEPTH 2 spreads the corners), Chorus HPF, EQ level, Delay HQ', () => {
  const notches = (P, d2 = 0) => {
    const N = 8192, L = imp(N), R = imp(N);
    run(rack2(s2([[['phs', { on: 1, rate: 0, depth: 0, freq: nOf('phs', 'freq', 1000), feed: 0, mix: 1, poles: (P - 1) / 17, depth2: d2 }, 'p']], [], []])), L, R);
    const fr = logFreqs(20, 20000, 600), m = fr.map((f) => dB(mag(L.subarray(0, 4096), f) + 1e-12));
    let c = 0;
    for (let i = 1; i < m.length - 1; i++) if (m[i] < m[i - 1] && m[i] <= m[i + 1] && m[i] < -20) c++;
    return { c, m };
  };
  for (const P of [1, 2, 4, 6, 12, 18]) assert.equal(notches(P).c, P >> 1, P + ' poles');
  const a = notches(12, 0), b = notches(12, 0.8);
  assert.ok(a.m.some((v, i) => Math.abs(v - b.m[i]) > 3), 'DEPTH 2 moves the notches');
  // Chorus HPF: the wet 2-pole filter becomes a high-pass at the LPF frequency
  const lo = (hp) => { const r = render2(s2([[['cho', { on: 1, mix: 1, lpf: nOf('cho', 'lpf', 2000), feed: 0, hp }, 'c']], [], []]), sine(FS / 2, 100, 0.5)); return tone(r.L, 100, 4800, FS / 2); };
  assert.ok(dB(lo(1) / lo(0)) < -30, `Chorus HPF: 100 Hz wet ${dB(lo(1) / lo(0)).toFixed(1)} dB`);
  // EQ level: (2n)² after the bands; eqResponse includes it
  const e = s2([[['eq', { on: 1, gainL: 0.75, level: 1 }, 'e']], [], []]), fxp = C.compileFx(e);
  const r = render2(e, sine(FS / 2, 5000, 0.1));
  assert.ok(Math.abs(dB(tone(r.L, 5000, 9600, FS / 2) / 0.1) - 20 * Math.log10(4)) < 0.1, 'level n 1 = +12 dB');
  const resp = FX2.eqResponse(fxp, 0, fxp.base, [5000], FS);
  assert.ok(Math.abs(resp[0] - 20 * Math.log10(4)) < 0.1, 'eqResponse with level');
  // Delay HQ at 192 kHz: full-rate lines (the echo exactly at the time), off = the Phase-1 half-rate lines (+30 samples)
  for (const [hq, extra] of [[1, 0], [0, 30]]) {
    const n = 0.2 * 192000, L = imp(n), R = imp(n);
    const rr = rack2(s2([[['dly', { ...DLY(100), hq }, 'd']], [], []]), { fs: 192000 });
    run(rr, L, R);
    let k = 0;
    for (let i = 1; i < n; i++) if (Math.abs(L[i]) > Math.abs(L[k])) k = i;
    assert.ok(Math.abs(k - (19200 + extra)) <= 1, `HQ ${hq}: echo at ${k}`);
    assert.ok(rr.bytes() <= 4 * 1024 * 1024, 'S2 Delay ≤ 4 MB at 192 kHz: ' + rr.bytes());
  }
  const d2 = rack2(s2([[['dly', { ...DLY(100), hq: 1 }, 'd']], [], []]), { fs: 192000 });
  assert.equal(d2.byId.get('d').mod.lL.constructor.name, 'Float32Array', 'S2 Delay lines are Float32');
  // with the parameters moving (coefficients re-evaluated every block) the lines keep their content at 192 kHz in both
  // HQ states, and an HQ change while the echo is in flight is a ducked topology change (no click), not a reset per block
  for (const hq of [1, 0]) {
    const st = s2([[['dly', { ...DLY(100), hq }, 'd']], [], []]), fxp = C.compileFx(st, { rate: 192000 }), n = 0.2 * 192000;
    const echo = (moving) => {
      const rr = new FX2.FXRack(192000), L = imp(n), R = imp(n), md = new Float64Array(fxp.NFX);
      rr.set(fxp, null);
      run(rr, L, R, { before: (o) => { if (moving) { md[8 + 1] = 1e-6 * ((o >> 7) & 1); rr.setMods(md, fxp.key); } } });
      let k = 0;
      for (let i = 1; i < n; i++) if (Math.abs(L[i]) > Math.abs(L[k])) k = i;
      return [k, L[k]];
    };
    const [k0, a0] = echo(false), [k1, a1] = echo(true);
    assert.ok(Math.abs(k0 - (19200 + (hq ? 0 : 30))) <= 1 && k1 === k0 && Math.abs(a1 / a0 - 1) < 1e-4 && Math.abs(a0) > 0.4,
      `HQ ${hq} with moving parameters: echo at ${k1} (${a1}) vs ${k0} (${a0})`);
  }
});

test('M2 §8.2 Compressor S2: 1:1 transparent (±0.5 dB), band output gains, BELOW (upward) ratio, X-LOW / X-HIGH crossovers', () => {
  const lvl = (p, f, a = 0.25) => { const r = render2(s2([[['cmp', { on: 1, mb: 1, att: 0.1, rel: 0.3, ...p }, 'c']], [], []]), sine(FS, f, a)); return dB(tone(r.L, f, 24000, FS) / a); };
  const flat = { ratio: 0, below: 0 };
  for (const f of [60, 1000, 8000]) assert.ok(Math.abs(lvl(flat, f)) < 0.5, `1:1 at ${f}: ${lvl(flat, f).toFixed(2)} dB`);
  const g = (db) => (db + 24) / 48;
  assert.ok(Math.abs(lvl({ ...flat, gL: g(12) }, 60) - 12) < 0.5 && Math.abs(lvl({ ...flat, gL: g(12) }, 1000)) < 0.5, 'Low Gain +12 dB');
  assert.ok(Math.abs(lvl({ ...flat, gH: g(-12) }, 8000) + 12) < 0.5 && Math.abs(lvl({ ...flat, gH: g(-12) }, 1000)) < 0.5, 'High Gain −12 dB');
  assert.ok(Math.abs(lvl({ ...flat, gM: g(6) }, 1000) - 6) < 0.5, 'Mid Gain +6 dB');
  // BELOW 4:1 with threshold −20 dB: a −60 dBFS tone (below T − 24 dB) is raised by (−44 + 60)·0.75 = 12 dB; 1:1 below: 0 dB
  const thr = nOf('cmp', 'thr', Math.pow(10, -20 / 20)), quiet = 0.001;
  const up = lvl({ ratio: 0, below: nOf('cmp', 'below', 4), thr }, 1000, quiet), none = lvl({ ratio: 0, below: 0, thr }, 1000, quiet);
  assert.ok(Math.abs(up - 12) < 1.5 && Math.abs(none) < 0.5, `BELOW 4:1: ${up.toFixed(2)} dB (1:1: ${none.toFixed(2)})`);
  // X-LOW at 1 kHz: a 400 Hz tone is in the low band (Low Gain applies); at the default 128 Hz it is in the mid band
  assert.ok(Math.abs(lvl({ ...flat, gL: g(12), xlo: nOf('cmp', 'xlo', 1000) }, 400) - 12) < 0.6 && Math.abs(lvl({ ...flat, gL: g(12) }, 400)) < 0.6);
  assert.ok(Math.abs(lvl({ ...flat, gH: g(12), xhi: nOf('cmp', 'xhi', 600) }, 1500) - 12) < 0.6, 'X-HIGH at 600 Hz');
});

test('M2 §8.2 Filter S2: types 96–107 run, Key Track (CUTOFF × setNote factor), Clean Mode (−24 dB into the family, +24 dB out)', () => {
  const x = noise(FS / 4, 8, 0.5);
  for (let t = 96; t < 108; t++) {
    const r = render2(s2([[['fil', { on: 1, type: t / 107, cutoff: 0.3, res: 0.3, mix: 1 }, 'f']], [], []]), x);
    assert.ok(r.L.every(Number.isFinite) && !sameBits(r.L, x) && peak(r.L) < 20, 'type ' + t);
  }
  const base = { on: 1, type: 5 / 107, cutoff: nOf('fil', 'cutoff', 300), res: 0.2, mix: 1 };
  const kt = rack2(s2([[['fil', { ...base, kt: 1 }, 'f']], [], []]));
  kt.setNote(84);
  const A = x.slice(), B = x.slice();
  run(kt, A, B);
  const ref = render2(s2([[['fil', { ...base, cutoff: nOf('fil', 'cutoff', 1200) }, 'f']], [], []]), x);
  let e = 0;
  for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(A[i] - ref.L[i]));
  assert.ok(e < 1e-6, 'Key Track at note 84 = CUTOFF × 4: ' + e);
  // Clean Mode: a linear family is level-identical; with DRIVE the driven family saturates less (closer to linear)
  const lin = render2(s2([[['fil', { ...base, clean: 1 }, 'f']], [], []]), x), plain = render2(s2([[['fil', base, 'f']], [], []]), x);
  let d = 0;
  for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(lin.L[i] - plain.L[i]));
  assert.ok(d < 1e-3, 'Clean Mode transparent for a linear filter: ' + d);
  const hot = noise(FS / 4, 9, 1), drv = { ...base, type: 1 / 107, drive: 1, res: 0.6 };
  const dc = render2(s2([[['fil', { ...drv, clean: 1 }, 'f']], [], []]), hot), dn = render2(s2([[['fil', drv, 'f']], [], []]), hot);
  assert.ok(!sameBits(dc.L, dn.L) && dc.L.every(Number.isFinite), 'Clean Mode changes a driven filter');
});

test('M2 §8.3 Reverb S2: Plate RT60(size) law ±25 %, Hall T60 and pre-delay, LOW / HIGH CUT, WIDTH, types switch without clicks', () => {
  for (const size of [0.05, 0.2, 0.4]) {
    const law = size < 0.1 ? 0.2 + 2 * size : 0.4 * Math.pow(30, Math.min(1, (size - 0.1) / 0.55));
    const n = Math.ceil((1.6 * law + 0.5) * FS), L = imp(n), R = imp(n);
    run(rack2(s2([[['rev', { on: 1, type: 0, size, mix: 1, hicut: 0, damp: 0 }, 'r']], [], []])), L, R);
    const t = edcT60(L.map((v, i) => v + R[i]));
    assert.ok(Math.abs(t / law - 1) < 0.25, `Plate size ${size}: RT60 ${t.toFixed(2)} s vs ${law.toFixed(2)} s`);
  }
  const t60 = 0.8 + 11.2 * 0.1, n = Math.ceil(2.5 * t60 * FS), L = imp(n), R = imp(n);
  run(rack2(s2([[['rev', { on: 1, type: 0.25, decay: 0.1, mix: 1, hicut: 0 }, 'r']], [], []])), L, R);
  const th = edcT60(L.map((v, i) => v + R[i]));
  assert.ok(Math.abs(th / t60 - 1) < 0.25, `Hall T60 ${th.toFixed(2)} vs ${t60.toFixed(2)}`);
  const onset = (pre, type) => { const A = imp(FS), B = imp(FS); run(rack2(s2([[['rev', { on: 1, type, pre: nOf('rev', 'pre', pre), mix: 1 }, 'r']], [], []])), A, B); let k = 0; while (k < FS && Math.abs(A[k]) < 1e-6) k++; return k; };
  for (const type of [0, 0.25, 0.5, 0.75, 1]) assert.ok(Math.abs(onset(100, type) - onset(0, type) - 4800) <= 2, 'pre-delay 100 ms, type ' + 4 * type);
  // HIGH CUT 100 %: LP at 20000·0.05 = 1 kHz → the 8 kHz content of the tail falls; LOW CUT 100 %: HP at 1 kHz
  const band = (p, f) => { const r = render2(s2([[['rev', { on: 1, type: 0.5, mix: 1, ...p }, 'r']], [], []]), noise(FS, 4, 0.5)); return tone(r.L, f, 12000, FS); };
  assert.ok(dB(band({ hicut: 1 }, 8000) / band({ hicut: 0 }, 8000)) < -20, 'HIGH CUT');
  assert.ok(dB(band({ locut: 1 }, 100) / band({ locut: 0 }, 100)) < -15, 'LOW CUT');
  // Plate WIDTH 0: mono wet
  const w = render2(s2([[['rev', { on: 1, type: 0, width: 0, mix: 1 }, 'r']], [], []]), noise(FS / 2, 5), noise(FS / 2, 6));
  let side = 0;
  for (let i = 0; i < w.L.length; i++) side = Math.max(side, Math.abs(w.L[i] - w.R[i]));
  assert.ok(side < 1e-9, 'Plate WIDTH 0 = mono: ' + side);
  // type changes while the reverb sounds: ducked (2.5 ms) and the new type fades in — no step larger than the signal's own
  const st = (t) => s2([[['rev', { on: 1, type: t / 4, mix: 0.6, size: 0.6 }, 'r']], [], []]);
  const r = new FX2.FXRack(FS), x = noise(2 * FS, 7, 0.5), Y = x.slice(), Z = x.slice();
  r.set(C.compileFx(st(0), { rate: FS, modded: (() => { const m = new Uint8Array(8 + C.fxLayout(st(0)).NP); m[8 + 1] = 1; return m; })() }), null);
  run(r, Y, Z, { before: (o) => { const k = Math.floor(o / 19200); if (o % 19200 === 0 && k > 0 && k < 5) r.set(C.compileFx(st(k), { rate: FS }), null); } });
  assert.ok(Y.every(Number.isFinite));
  for (let k = 1; k < 5; k++) assert.ok(maxStep(Y, k * 19200 - 64, k * 19200 + 960) < 3 * maxStep(Y, k * 19200 - 4000, k * 19200 - 64), 'type ' + k + ': no click');
});

test('M2 §8.4 splitters in the rack: empty branches reconstruct the input, branch chains act on their band, branch bypass, LEVEL, power', () => {
  const freqs = [30, 100, 300, 1000, 3000, 10000, 18000];
  for (const type of ['split2', 'split3']) {
    const N = 16384, L = imp(N), R = imp(N);
    run(rack2(s2([[[type, {}, 's']], [], []])), L, R);
    for (const f of freqs) assert.ok(Math.abs(dB(mag(L, f))) < 0.05, `${type} empty at ${f}: ${dB(mag(L, f))}`);
  }
  const x = noise(FS / 4, 3), y = noise(FS / 4, 4), ms = render2(s2([[['splitms', {}, 's']], [], []]), x, y);
  for (let i = 0; i < x.length; i++) if (Math.abs(ms.L[i] - x[i]) > 1e-15 || Math.abs(ms.R[i] - y[i]) > 1e-15) assert.fail('M/S at ' + i);
  // L/H at 300 Hz with an EQ in the high branch (+12 dB at 3 kHz): only the high band changes
  const eqHi = { id: 'e', type: 'eq', v: 2, p: { on: 1, typeL: 0.5, freqL: nOf('eq', 'freqL', 3000), qL: 0.3, gainL: 0.75 } };
  const sp = (o = {}) => s2([[Object.assign({ id: 's', type: 'split2', v: 2, p: { on: 1, freq: nOf('split2', 'freq', 300) }, br: [[], [eqHi]], bb: [0, 0] }, o)], [], []]);
  const lv = (st, f) => { const r = render2(st, sine(FS / 2, f, 0.2)); return dB(tone(r.L, f, 9600, FS / 2) / 0.2); };
  assert.ok(Math.abs(lv(sp(), 3000) - 12) < 0.6 && Math.abs(lv(sp(), 40)) < 0.1, `branch chain: ${lv(sp(), 3000).toFixed(2)} / ${lv(sp(), 40).toFixed(3)}`);
  assert.ok(Math.abs(lv(sp({ bb: [0, 1] }), 3000)) < 0.1, 'branch bypass passes its band');
  const lvl2 = s2([[{ id: 's', type: 'split2', v: 2, p: { on: 1, level: 0.25 }, br: [[], []], bb: [0, 0] }], [], []]);
  assert.ok(Math.abs(lv(lvl2, 1000) - 20 * Math.log10(0.25)) < 0.05, 'LEVEL (2n)²');
  const off = s2([[{ id: 's', type: 'split2', v: 2, p: { on: 0, level: 0 }, br: [[], [eqHi]], bb: [0, 0] }], [], []]);
  const o = render2(off, x, y);
  assert.ok(sameBits(o.L, x) && sameBits(o.R, y), 'splitter off: input passes (branches not run)');
  // M/S with a Utility (WIDTH 0 → its branch input is (s, −s): mono = 0) on the side branch: the output is mono
  const msu = s2([[{ id: 's', type: 'splitms', v: 2, p: { on: 1 }, br: [[], [{ id: 'u', type: 'util', v: 2, p: { on: 1, width: 0 } }]], bb: [0, 0] }], [], []]);
  const m = render2(msu, x, y);
  let side = 0;
  for (let i = 2000; i < x.length; i++) side = Math.max(side, Math.abs(m.L[i] - m.R[i]));
  assert.ok(side < 1e-12, 'side removed: ' + side);
  // phases() / gr() slots of branch instances follow fxLayout order
  const g = s2([[{ id: 's', type: 'split3', v: 2, p: { on: 1 }, br: [[{ id: 'c1', type: 'cmp', v: 2, p: { on: 1, thr: nOf('cmp', 'thr', 0.05) } }], [], [{ id: 'ch', type: 'cho', v: 2, p: { on: 1 }, ph: 0.4 }]], bb: [0, 0, 0] }], [], []]);
  const rg = rack2(g), A = sine(FS / 4, 50, 0.9), B = A.slice();
  assert.equal(rg.phases()[2], 0.4);
  run(rg, A, B);
  assert.ok(rg.gr()[4] > 0, 'compressor in branch 0 = FXP instance 1');
});

test('M2 §8.4 Bode and Convolve in the rack: shift, phases() / RETRIG, a missing IR passes the input, an arriving IR wakes the rack', async () => {
  const st = s2([[['bode', { on: 1, shift: nOf('bode', 'shift', 0.75), range: nOf('bode', 'range', 400), mix: 1, retrig: 1 }, 'b']], [], []]);
  st.racks[0].mods[0].ph = 0.3;
  const r = rack2(st), L = sine(FS / 2, 1000, 0.5), R = L.slice();
  assert.equal(r.phases()[0], 0.3);
  run(r, L, R);
  assert.ok(Math.abs(tone(L, 1300, 9600, FS / 2) - 0.5) < 0.01 && tone(L, 700, 9600, FS / 2) < 0.005, 'Bode +300 Hz in the rack');
  assert.ok(Math.abs(r.phases()[0] - ((0.3 + 300 * (FS / 2) / FS) % 1)) < 1e-6, 'phases() = shifter θ/2π');
  r.trigger();
  assert.equal(r.phases()[0], 0.3, 'RETRIG: θ ← 2π·ph');
  // Convolve: no entry yet → the instance passes its input (the rack stays bit-transparent); the entry arrives → audible
  const S = dspScope(), B = S.global('SxBase'), F = S.global('FXDSP');
  const cv = s2([[['conv', { on: 1, mix: 1, irgain: nOf('conv', 'irgain', 0) }, 'c']], [], []]);
  cv.racks[0].mods[0].sub = { ir: 'ir:test' };
  const fxp = C.compileFx(cv, { rate: FS }), id = fxp.iIr[0];
  assert.match(id, /^ir:test@48000~[0-9a-f]{8}$/);
  const rc = new F.FXRack(FS);
  rc.set(fxp, null);
  const x = noise(FS / 2, 1, 0.5), X = x.slice(), Y = x.slice();
  run(rc, X.subarray(0, 12800), Y.subarray(0, 12800));
  assert.ok(sameBits(X.subarray(0, 12800), x.subarray(0, 12800)), 'missing IR: input passes');
  const h = new Float32Array(1000);
  h[0] = 0.5; h[999] = 0.25;
  await irStore(B, id, h, h);
  run(rc, X.subarray(12800), Y.subarray(12800));
  for (let i = 12800 + 128 + 240 + 1000; i < x.length; i++) {
    const want = 0.5 * x[i] + 0.25 * x[i - 999];
    if (Math.abs(X[i] - want) > 1e-6) assert.fail(`convolved at ${i}: ${X[i]} vs ${want}`);
  }
  assert.ok(maxStep(X, 12700, 13400) < 2.5 * maxStep(x, 12700, 13400), 'the instance fades in');
});

test('M2 §0.3 failure isolation: FXMods2 = null ⇒ the new types pass their input; SxBase = null ⇒ S2 variants too; S1 instances unaffected', () => {
  const mods = [['dly', DLY(30, { feed: 0.3, mix: 0.4 }), 'd1', 1], ['bode', { on: 1, shift: 0.7 }, 'b'], ['util', { on: 1, width: 0 }, 'u'],
    ['rev', { on: 1, type: 0.5 }, 'r'], ['phs', { on: 1, mix: 0.6 }, 'p']];
  const st = s2([mods, [], []]), x = noise(FS / 4, 2), y = noise(FS / 4, 3);
  const go = (ov) => { const S = dspScope({ overrides: ov }), r = new (S.global('FXDSP').FXRack)(FS), L = x.slice(), R = y.slice(); r.set(C.compileFx(st), C.compileFxT(st)); run(r, L, R); return { L, R, r }; };
  const full = go({}), noM2 = go({ 'fx-mods2.js': null }), noB = go({ 'sx-base.js': null });
  assert.deepEqual(Array.from(full.r.C0, (u) => u.id), ['d1', 'b', 'u', 'r', 'p']);
  assert.deepEqual(Array.from(noM2.r.C0, (u) => u.id), ['d1', 'r', 'p'], 'without FXMods2: no Bode / Utility units');
  assert.equal(noM2.r.byId.get('r').st, 0, 'the S2 Reverb unit exists (Plate / Hall run in fx-dsp) but its Vintage tank does not: never enabled');
  assert.deepEqual(Array.from(noB.r.C0, (u) => u.id), ['d1'], 'without SxBase: only the S1 instance');
  const only = (keep) => go.call(null, {}) && s2([mods.filter((m) => keep.includes(m[2])), [], []]);
  const ref = (keep) => { const s = only(keep), S = dspScope(), r = new (S.global('FXDSP').FXRack)(FS), L = x.slice(), R = y.slice(); r.set(C.compileFx(s), null); run(r, L, R); return { L, R }; };
  const a = ref(['d1', 'p']), b = ref(['d1']);
  assert.ok(sameBits(noM2.L, a.L) && sameBits(noM2.R, a.R), 'FXMods2 missing = those instances bypassed');
  assert.ok(sameBits(noB.L, b.L) && sameBits(noB.R, b.R), 'SxBase missing = S2 instances bypassed');
});

test('M2 §10.5.17: process() allocates nothing with every S2 variant and new module (splitter branches, buses, Convolve adoption, modulation)', async () => {
  const S = dspScope(), B = S.global('SxBase'), F = S.global('FXDSP');
  const sp = { id: 'sp', type: 'split3', v: 2, p: { on: 1 }, br: [[{ id: 'u2', type: 'util', v: 2, p: { on: 1, mbass: 1, width: 0.2 } }], [{ id: 'e2', type: 'eq', v: 2, p: { on: 1, level: 0.6 } }], [{ id: 'od', type: 'dist', v: 2, p: { on: 1, mode: 16 / 17 } }]], bb: [0, 0, 0] };
  const st = s2([[['dist', { on: 1, mode: 17 / 17, kt: 1 }, 'd'], ['phs', { on: 1, poles: 1, depth2: 0.4 }, 'p'], ['cho', { on: 1, hp: 1 }, 'c'], ['dly', { on: 1, hq: 1, mix: 0.4 }, 'dl'],
    ['cmp', { on: 1, mb: 1, below: 0.6, gL: 0.7 }, 'cm'], ['rev', { on: 1, type: 0.75 }, 'rv'], ['eq', { on: 1, level: 0.7 }, 'e'], ['fil', { on: 1, type: 100 / 107, kt: 1, clean: 1 }, 'f'],
    ['bode', { on: 1, delay: 0.2, feed: 0.5, blur: 0.4, retrig: 1 }, 'b'], ['conv', { on: 1 }, 'cv'], sp],
  [['rev', { on: 1, type: 0.5 }, 'rv2'], ['splitms', {}, 'ms']], [['util', { on: 1, invL: 1, hpf: 0.4, lpf: 0.6 }, 'ut'], ['rev', { on: 1, type: 0 }, 'rv3']]], { route: [0, 2, 1] });
  st.racks[0].mods[9].sub = { ir: 'ir:alloc' };
  const L0 = C.fxLayout(st), md = new Uint8Array(8 + L0.NP);
  const tp = (id, pid) => { const d = C.fxDest('fx.' + id + '.' + pid, st); return 8 + d.flat; };
  md[tp('rv', 'type')] = 1; md[tp('f', 'type')] = 1;
  const fxp = C.compileFx(st, { rate: FS, modded: md, bus1v: 0.4, bus2v: 0.6 }), r = new F.FXRack(FS);
  r.set(fxp, C.compileFxT(st));
  const h = noise(20000, 5, 0.05), e = (await import('../smp.js?v=9')).irPartition(h, h, FS);
  const n = 128, a = () => new Float64Array(n), [L, R, dL, dR, b1L, b1R, b2L, b2R] = [a(), a(), a(), a(), a(), a(), a(), a()], mods = new Float64Array(fxp.NFX);
  const g = rng(4);
  const fill = () => { for (const q of [L, R, dL, dR, b1L, b1R, b2L, b2R]) for (let i = 0; i < n; i++) q[i] = 0.4 * (2 * g() - 1); };
  for (let s = 0; s < 40; s++) { fill(); r.process(L, R, n, dL, dR, b1L, b1R, b2L, b2R); }
  const irId = fxp.iIr[fxp.iId.indexOf('cv')], entry = Object.assign({ id: irId, v: 1, kind: 'ir', bytes: 0 }, e);
  assert.match(irId, /^ir:alloc@48000~/);
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Object', 'Set'];
  const saved = {};
  assert.equal(B.storeAsset(irId, entry), true);                     // stored before the ban; adopted by poll() inside it
  // constructing (new or call) throws; static members (Array.isArray — the IR validation in poll()) stay reachable
  const ban = (k) => { throw new Error('allocation: ' + k); };
  for (const k of names) { saved[k] = Object.getOwnPropertyDescriptor(S.ctx, k); S.ctx[k] = new Proxy(S.run(k, 'builtin.js'), { construct: () => ban(k), apply: () => ban(k) }); }
  try {
    for (let s = 0; s < 500; s++) {
      fill();
      mods[tp('rv', 'type')] = 0.25 * Math.round(2 * Math.sin(s / 50));
      mods[tp('f', 'type')] = 0.1 * Math.sin(s / 13); mods[tp('b', 'shift')] = 0.2 * Math.sin(s / 9); mods[tp('cm', 'xlo')] = 0.3 * Math.sin(s / 7);
      mods[tp('p', 'poles')] = 0.3 * Math.sin(s / 11); mods[tp('ut', 'width')] = 0.1 * Math.sin(s / 5); mods[tp('sp', 'freq1')] = 0.2 * Math.sin(s / 17);
      r.setMods(mods, fxp.key);
      if (s === 100) r.transport();
      if (s % 37 === 0) r.trigger();
      r.setNote(48 + (s % 37));
      r.process(L, R, n, s & 1 ? dL : undefined, s & 1 ? dR : undefined, b1L, b1R, s & 2 ? b2L : undefined, s & 2 ? b2R : undefined);
      for (let i = 0; i < n; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) throw new Error('non-finite at ' + s);
      r.gr(); r.phases(); r.idle();
    }
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(S.ctx, k, saved[k]); else delete S.ctx[k]; }
  }
  assert.equal(r.byId.get('cv').mod.ready, 1, 'the IR was adopted inside the banned section');
});

test('M2 idle(): each new module and S2 reverb type goes idle after its tail (and not while it sounds)', async () => {
  const S = dspScope(), B = S.global('SxBase'), F = S.global('FXDSP');
  const cv = s2([[['conv', { on: 1, mix: 1 }, 'c']], [], []]);
  cv.racks[0].mods[0].sub = { ir: 'ir:idle' };
  const fxpc = C.compileFx(cv, { rate: FS });
  const h = new Float32Array(FS);
  for (let i = 0; i < FS; i++) h[i] = Math.exp(-6 * i / FS) * (i % 7 === 0 ? 0.3 : -0.1);
  await irStore(B, fxpc.iIr[0], h, h);
  const cases = [
    ['bode', s2([[['bode', { on: 1, delay: nOf('bode', 'delay', 300), feed: 0.2 }, 'b']], [], []]), 3],
    ['util', s2([[['util', { on: 1, width: 0.5 }, 'u']], [], []]), 0.3],
    ['split + delay', s2([[{ id: 's', type: 'split2', v: 2, p: { on: 1 }, br: [[], [{ id: 'd', type: 'dly', v: 2, p: DLY(200, { feed: 0.3 }) }]], bb: [0, 0] }], [], []]), 2],
    ...[0, 1, 2, 3, 4].map((t) => ['rev type ' + t, s2([[['rev', { on: 1, type: t / 4, size: 0.2, decay: 0.1, feed: 0.4 }, 'r']], [], []]), 4]),
  ];
  for (const [name, st, tail] of cases) {
    const r = new F.FXRack(FS);
    r.set(C.compileFx(st, { rate: FS }), null);
    const t = idleTimes(r, 0.1 * FS, Math.round((tail + 2.5) * FS));
    assert.ok(t.idle > 0 && t.idle - t.quiet <= 1.2 * FS + 2 * 128 + 0.4 * FS, `${name}: idle ${t.idle / FS} s, quiet ${t.quiet / FS} s`);
  }
  const rc = new F.FXRack(FS);
  rc.set(fxpc, null);
  const t = idleTimes(rc, 0.1 * FS, 4 * FS);
  assert.ok(t.idle > 0 && t.idle >= 1.0 * FS, 'Convolve: not idle before its 1 s IR has played: ' + t.idle / FS);
});

test('M2 §8.5 memory: S2 Delay ≤ 4 MB at 192 kHz; the 32 MB per-track cap leaves the instance over it unallocated and bypassed', () => {
  const fs = 192000, dl = (k) => ['dly', { ...DLY(500, { feed: 0.2, mix: 0.5 }), hq: 1 }, 'd' + k];
  const b0 = rack2(s2([[], [], []]), { fs }).bytes(), MB = 1024 * 1024;
  const one = rack2(s2([[dl(0)], [], []]), { fs });
  const b1 = one.bytes();
  assert.ok(b1 <= 4 * MB, 'one S2 Delay at 192 kHz: ' + b1);
  // S2 reverbs ≤ 2 MB per instance at 192 kHz (each type, and the pool prepared for every type when TYPE is modulated);
  // Bode ≤ 1 MB (§8.5)
  for (let t = 0; t < 5; t++) assert.ok(rack2(s2([[['rev', { on: 1, type: t / 4 }, 'r']], [], []]), { fs }).bytes() - b0 <= 2 * MB, 'reverb type ' + t);
  const rv = s2([[['rev', { on: 1 }, 'r']], [], []]), md = new Uint8Array(8 + C.fxLayout(rv).NP);
  md[8 + 1] = 1;
  const all = new FX2.FXRack(fs), pall = C.compileFx(rv, { rate: fs, modded: md });
  assert.equal(pall.filTypeAll[0], 1, 'a modulated TYPE prepares every tank');
  all.set(pall, null);
  const pool = all.byId.get('r').mod;
  for (let t = 0; t < 5; t++) assert.ok(pool.ok(t), 'pool ready for type ' + t);
  assert.ok(all.bytes() - b0 <= 2 * MB, 'reverb pool for every type: ' + (all.bytes() - b0));
  assert.ok(rack2(s2([[['bode', { on: 1 }, 'b']], [], []]), { fs }).bytes() - b0 <= MB, 'Bode');
  const n = Math.ceil(32 * 1024 * 1024 / b1) + 1, st = s2([Array.from({ length: n }, (_, k) => dl(k)), [], []]);
  const r = rack2(st, { fs });
  assert.ok(r.bytes() <= 32 * 1024 * 1024 + 256 * 1024, 'rack ' + r.bytes());
  assert.ok(r.over.length >= 1 && r.over.every((id) => /^d\d+$/.test(id)), 'over the cap: ' + r.over.join(','));
  const k = r.over[0], u = r.byId.get(k);
  assert.deepEqual([u.has, u.over], [0, 1]);
  // the bypassed instance passes its input: the rack equals the same rack without it
  const x = noise(fs / 4, 3), A = x.slice(), B = x.slice();
  run(r, A, B);
  const rest = rack2(s2([Array.from({ length: n }, (_, j) => dl(j)).filter((m) => !r.over.includes(m[2])), [], []]), { fs });
  const C2 = x.slice(), D2 = x.slice();
  run(rest, C2, D2);
  assert.ok(sameBits(A, C2) && sameBits(B, D2), 'instances over the cap are bypassed');
  // removing two delays frees room: the next set() allocates the waiting one
  const fewer = s2([Array.from({ length: n }, (_, j) => dl(j)).filter((m, j) => j !== 0 && j !== 1), [], []]);
  r.set(C.compileFx(fewer, { rate: fs }), null);
  run(r, x.slice(0, 2048), x.slice(0, 2048));
  r.set(C.compileFx(fewer, { rate: fs }), null);
  assert.equal(r.byId.get(k).has, 1, k + ' allocated once there is room');
});

test('M2 §0.3: SxBase.shape(mode, x, d) ≡ the Phase-1 shapers of fx-dsp (modes 0–15, Downsample the identity) bit for bit', () => {
  const B = FULL.global('SxBase');
  for (let mode = 0; mode < 16; mode++) {
    for (const d of [0, 0.13, 0.5, 0.77, 1]) {
      const c = FX2.distCurve(mode, d, null, null, 129);
      for (let i = 0; i < 129; i++) {
        const x = -1 + 2 * i / 128, want = mode === 8 ? x : c[i];
        if (!Object.is(B.shape(mode, x, d), want)) assert.fail(`mode ${mode} d ${d} x ${x}: ${B.shape(mode, x, d)} vs ${want}`);
      }
    }
  }
});

test('M2 CPU (informative; fails only beyond 3 × the §14.1 node targets): j Convolve 4 s IR, k S2 reverbs, l Bode, m Splitter L/M/H + 3 EQs', async () => {
  const S = dspScope({ fast: true }), B = S.global('SxBase'), F = S.global('FXDSP');
  const h = noise(4 * FS, 1, 0.05).map((v, i) => v * Math.exp(-3 * i / (4 * FS)));
  const cv = s2([[['conv', { on: 1, mix: 0.5 }, 'c']], [], []]);
  cv.racks[0].mods[0].sub = { ir: 'ir:cpu' };
  await irStore(B, C.compileFx(cv, { rate: FS }).iIr[0], Float32Array.from(h), Float32Array.from(h));
  const eqs = [0, 1, 2].map((b) => [{ id: 'e' + b, type: 'eq', v: 2, p: { on: 1, gainL: 0.7 } }]);
  const rows = [['j Convolve 4 s stereo IR', cv, 0.08],
    ...[0, 1, 2, 3, 4].map((t) => ['k Reverb ' + C.REV_TYPES2[t], s2([[['rev', { on: 1, type: t / 4 }, 'r']], [], []]), 0.05]),
    ['l Bode + BLUR + feedback', s2([[['bode', { on: 1, delay: 0.3, feed: 0.6, blur: 0.5 }, 'b']], [], []]), 0.03],
    ['m Splitter L/M/H + 3 EQs', s2([[{ id: 's', type: 'split3', v: 2, p: { on: 1 }, br: eqs, bb: [0, 0, 0] }], [], []]), 0.04]];
  for (const [name, st, target] of rows) {
    const r = new F.FXRack(FS);
    r.set(C.compileFx(st, { rate: FS }), null);
    const L = new Float64Array(128), R = new Float64Array(128), g = rng(2);
    const go = (k) => { for (let s = 0; s < k; s++) { for (let i = 0; i < 128; i++) { L[i] = 2 * g() - 1; R[i] = L[i]; } r.process(L, R, 128); } };
    go(400);
    const t = (await CPU.gateLoad(() => go(FS / 128), target, { limit: 3, runs: 3 })).load;   // calibrated pairs, retries
    console.log(`  fx-dsp CPU M2: ${name}: load ${t.toFixed(4)} (target ${target}, calibrated)`);
    assert.ok(t < 3 * target, name + ' load ' + t);
  }
});

test('M2 §3.16 / §0.4: FXDSP.TAB (every type and variant) equals fx-core FXP_TAB (pid, law, range, default) and fxLayout sizes', () => {
  assert.deepEqual(Object.keys(FX2.TAB), C.FXTYPES.map((t) => t.id));
  for (const T of C.FXTYPES) {
    assert.deepEqual(Object.keys(FX2.TAB[T.id]).map(Number), T.variants, T.id);
    for (const v of T.variants) {
      const want = C.FXP_TAB[T.id][v].map((r) => ({ pid: r.pid, law: r.law, lo: r.lo, hi: r.hi, def: r.def }));
      assert.deepEqual(Array.from(FX2.TAB[T.id][v], (r) => ({ ...r })), want, T.id + ' v' + v);
    }
  }
});

/* ------------------------------------------------------------------ review round (F1): rack-level fixes */

test('§8.5 Convolve FDL: nothing reserved for a missing IR; growth checked against the 32 MB cap; assets() sizes an arrived IR', async () => {
  const S = dspScope({ fast: true }), B = S.global('SxBase'), F = S.global('FXDSP'), fs = 192000, MB = 1024 * 1024;
  // a new Convolve whose IR is not built yet takes its fixed buffers only: the S2 Reverb and Delay beside it fit
  const st = s2([[['conv', { on: 1, mix: 0.5 }, 'cv'], ['rev', { on: 1 }, 'r'], ['dly', { on: 1, hq: 1 }, 'd']], [], []]);
  st.racks[0].mods[0].sub = { ir: 'ir:grow' };
  const r = rack2(st, { fs, F });
  assert.deepEqual(Array.from(r.over), [], 'nothing over the cap');
  assert.ok(r.byId.get('cv').mem < 3 * MB && r.byId.get('cv').mod.Qc === 0, 'no placeholder FDL: ' + r.byId.get('cv').mem);
  // the IR arrives after the patch: process() adopts it without allocating (tail shortened), the host's assets() call
  // sizes the FDL under the cap at once
  const id = C.compileFx(st, { rate: fs }).iIr[0], n = Math.round(1.5 * fs), h = new Float32Array(n);
  h[0] = 0.5; h[n - 1] = 0.25;
  await irStore(B, id, h, h, fs);
  run(r, new Float64Array(4096), new Float64Array(4096));
  const cv = r.byId.get('cv');
  assert.deepEqual([cv.mod.ready, cv.mod.short, cv.mod.Qc], [1, 1, 0], 'adopted, tail waiting for its lines');
  r.assets();
  const want = Math.ceil((n - 8192) / 4096);
  assert.deepEqual([cv.mod.Qc, cv.mod.short, Array.from(r.over)], [want, 0, []], 'assets(): sized to the stored IR');
  assert.equal(cv.mem, cv.mod.bytes(), 'u.mem follows the growth');
  // growth that would cross the cap: the instance keeps its FDL, is bypassed and listed in `over` — and a later set()
  // with room sizes it
  const many = (k) => s2([[['conv', { on: 1, mix: 0.5 }, 'cv'], ...Array.from({ length: k }, (_, j) => ['dly', { on: 1, hq: 1 }, 'd' + j])], [], []]);
  const big = many(8);
  big.racks[0].mods[0].sub = { ir: 'ir:big' };
  const r2 = new F.FXRack(fs), P0 = C.compileFx(big, { rate: fs, buses: 1 });
  r2.set(P0, null);
  const id2 = P0.iIr[0], n2 = 9 * fs, h2 = new Float32Array(n2);
  h2[0] = 1;
  await irStore(B, id2, h2, null, fs);
  r2.set(P0, null);
  assert.deepEqual([Array.from(r2.over), r2.byId.get('cv').mod.capped], [['cv'], 1], 'the 9 s FDL does not fit beside 8 Delays');
  assert.ok(r2.bytes() <= 32 * MB, 'rack ' + r2.bytes());
  const x = noise(fs / 8, 3, 0.5), A = x.slice(), A2 = x.slice();
  run(r2, A, A2);
  const ref = new F.FXRack(fs), small = many(8);
  small.racks[0].mods.shift();
  ref.set(C.compileFx(small, { rate: fs, buses: 1 }), null);
  const Z = x.slice(), Z2 = x.slice();
  run(ref, Z, Z2);
  assert.ok(sameBits(A, Z), 'the capped Convolve is bypassed');
  const fewer = many(0), Pf = C.compileFx(fewer, { rate: fs, buses: 1 });
  fewer.racks[0].mods[0].sub = { ir: 'ir:big' };
  r2.set(C.compileFx(fewer, { rate: fs, buses: 1 }), null);
  run(r2, new Float64Array(4096), new Float64Array(4096));          // the removed Delays fade out (still counted until then)
  r2.set(C.compileFx(fewer, { rate: fs, buses: 1 }), null);
  assert.ok(Pf.nI === 1);
  assert.deepEqual([Array.from(r2.over), r2.byId.get('cv').mod.capped, r2.byId.get('cv').mod.Qc], [[], 0, Math.ceil((n2 - 8192) / 4096)], 'room again: sized');
});

test('§8.5 an instance refused by the cap is not allocated again by every set() (no allocate-measure-discard per knob step)', () => {
  const S = dspScope({ fast: true }), F = S.global('FXDSP'), fs = 192000, dl = (k) => ['dly', { ...DLY(500, { feed: 0.2, mix: 0.5 }), hq: 1 }, 'd' + k];
  const st = s2([Array.from({ length: 12 }, (_, k) => dl(k)), [], []]), r = new F.FXRack(fs), P = C.compileFx(st, { rate: fs, buses: 1 });
  r.set(P, null);
  assert.ok(r.over.length >= 1);
  const ctx = S.ctx, orig = Object.getOwnPropertyDescriptor(ctx, 'Float32Array'), F32 = S.run('Float32Array', 'builtin.js');
  let made = 0;
  ctx.Float32Array = new Proxy(F32, { construct: (T, a) => { made++; return Reflect.construct(T, a); } });
  try {
    for (let k = 0; k < 10; k++) { P.base[8 + 7] = 0.3 + 0.01 * k; r.set(P, null); }
  } finally { if (orig) Object.defineProperty(ctx, 'Float32Array', orig); else delete ctx.Float32Array; }
  assert.equal(made, 0, 'no line allocated for the refused instances');
  assert.ok(r.over.length >= 1 && r.over.every((id) => r.byId.get(id).has === 0));
});

test('§9.9 a dropped IR (SxBase.dropAsset) bypasses its Convolve with the 5 ms fade, then the slots let go of it', async () => {
  const S = dspScope({ fast: true }), B = S.global('SxBase'), F = S.global('FXDSP');
  const st = s2([[['conv', { on: 1, mix: 1, irgain: nOf('conv', 'irgain', 0) }, 'cv']], [], []]);
  st.racks[0].mods[0].sub = { ir: 'ir:user1' };
  const P = C.compileFx(st, { rate: FS }), id = P.iIr[0], h = new Float32Array(3000);
  h[100] = 1;
  await irStore(B, id, h, h);
  const r = new F.FXRack(FS);
  r.set(P, null);
  const x = sine(FS / 2, 220, 0.5), L = x.slice(), R = x.slice(), at = 64 * 128;
  run(r, L, R, { before: (o) => { if (o === at) B.dropAsset(id); } });
  assert.ok(maxStep(L, at - 64, at + 480) < 3 * 0.5 * 2 * Math.PI * 220 / FS, 'faded');
  assert.ok(L.subarray(at + 512).every((v, i) => v === x[at + 512 + i]), 'then the input passes');
  const m = r.byId.get('cv').mod;
  assert.deepEqual([m.ready, m.cur, m.S[0].e, m.S[1].e], [0, -1, null, null], 'released');
  r.set(P, null);
  assert.equal(m.ready, 0, 'set() with the same id keeps it bypassed');
  await irStore(B, id, h, h);
  r.assets();
  assert.equal(m.ready, 1, 'relinked (stored again): plays');
});

test('§8.4 splitters: latency-aligned branches (Distortion at MIX 0 / a Limit compressor in one branch keep the sum flat); branch bypass fades', () => {
  const freqs = [300, 1000, 1500, 2000, 2500, 3000, 6000];
  const flat = (br, f2) => {
    const sp = { id: 's', type: f2 ? 'split3' : 'split2', v: 2, p: { on: 1, ...(f2 ? { freq1: nOf('split3', 'freq1', 400), freq2: nOf('split3', 'freq2', 2000) } : { freq: nOf('split2', 'freq', 2000) }) }, br, bb: br.map(() => 0) };
    const N = 16384, A = imp(N), B2 = imp(N), r = rack2(s2([[sp], [], []]));
    run(r, A, B2);
    return { r, db: freqs.map((f) => dB(mag(A.subarray(2048), f) / mag(imp(N - 2048, 0), f))) };
  };
  // impulse after the units settled: render a second impulse 2048 samples in (the first one primes the glides)
  const prime = (br, f2) => {
    const sp = { id: 's', type: f2 ? 'split3' : 'split2', v: 2, p: { on: 1, ...(f2 ? { freq1: nOf('split3', 'freq1', 400), freq2: nOf('split3', 'freq2', 2000) } : { freq: nOf('split2', 'freq', 2000) }) }, br, bb: br.map(() => 0) };
    const N = 32768, A = new Float64Array(N), B2 = new Float64Array(N), r = rack2(s2([[sp], [], []]));
    A[12000] = 1; B2[12000] = 1;
    run(r, A, B2);
    return { r, db: freqs.map((f) => dB(Math.max(mag(A.subarray(8000), f), 1e-12) / mag(imp(N - 8000, 4000), f))) };
  };
  const dist0 = { id: 'd', type: 'dist', v: 2, p: { on: 1, mix: 0 } };
  for (const [name, br, f2] of [['L/H, Distortion MIX 0 in HIGHS', [[], [dist0]], 0], ['L/H, Distortion S1 MIX 0 in LOWS', [[{ ...dist0, v: 1 }], []], 0],
    ['L/M/H, Distortion in MID', [[], [dist0], []], 1]]) {
    const { db } = prime(br, f2);
    for (let i = 0; i < freqs.length; i++) assert.ok(Math.abs(db[i]) < 0.1, `${name}: ${freqs[i]} Hz ${db[i].toFixed(2)} dB`);
  }
  const lim = { id: 'c', type: 'cmp', v: 2, p: { on: 1, ratio: 1, mix: 1, att: nOf('cmp', 'att', 2) } };
  const { db: dl, r: rl } = prime([[lim], []], 0);
  for (let i = 0; i < freqs.length; i++) assert.ok(Math.abs(dl[i]) < 0.1, `Limit compressor in LOWS: ${freqs[i]} Hz ${dl[i].toFixed(2)} dB`);
  // §8.1 latency: a Limit-mode compressor in a MAIN splitter branch counts; on a bus it does not
  assert.equal(rl.latency, rl.byId.get('c').mod.La);
  assert.ok(rl.latency > 0);
  const bus = rack2(s2([[], [{ id: 's', type: 'split2', v: 2, p: { on: 1 }, br: [[lim], []], bb: [0, 0] }], []]));
  run2(bus, new Float64Array(256), new Float64Array(256), { b1: [noise(256, 1, 0.1), noise(256, 2, 0.1)] });
  assert.equal(bus.latency, 0);
  // branch bypass: 5 ms crossfade (no step beyond the signal's), then exactly the band (no latency left in the others)
  const hard = { id: 'd', type: 'dist', v: 2, p: { on: 1, mode: 2 / 17, drive: 0.9, mix: 1 } };
  const st = (bb) => s2([[{ id: 's', type: 'split2', v: 2, p: { on: 1, freq: nOf('split2', 'freq', 300) }, br: [[], [hard]], bb }], [], []]);
  const r = rack2(st([0, 0])), x = sine(FS / 2, 2000, 0.3), L = x.slice(), R = x.slice(), at = 48 * 128;
  run(r, L, R, { before: (o) => { if (o === at) r.set(C.compileFx(st([0, 1]), { rate: FS, buses: 1 }), null); } });
  const steady = maxStep(L, 2000, at - 16);
  assert.ok(maxStep(L, at - 16, at + 600) <= 1.2 * steady, `bypass on: ${maxStep(L, at - 16, at + 600).toFixed(3)} vs ${steady.toFixed(3)}`);
  const ref = render2(s2([[{ id: 's', type: 'split2', v: 2, p: { on: 1, freq: nOf('split2', 'freq', 300) }, br: [[], []], bb: [0, 0] }], [], []]), x.slice(FS / 4), x.slice(FS / 4));
  let d = 0;
  for (let i = 8000; i < FS / 4; i++) d = Math.max(d, Math.abs(L[FS / 4 + i] - ref.L[i]));
  assert.ok(d < 1e-6, 'after the fade (and the alignment glide) the bypassed branch passes its band: ' + d);
});

test('§8.3 Reverb S2: TYPE leaving and returning before the duck completes leaves the running type; Nitrous MODE is a ducked topology change', () => {
  const st = (t, nm = 0) => s2([[['rev', { on: 1, type: t / 4, nmode: nm / 4, mix: 0.6 }, 'r']], [], []]);
  const md = (S2) => { const m = new Uint8Array(8 + C.fxLayout(S2).NP); m[8 + 1] = 1; m[8 + 20] = 1; return m; };
  const r = new FX2.FXRack(FS), P = C.compileFx(st(0), { rate: FS, modded: md(st(0)), buses: 1 }), off = new Float64Array(P.NFX);
  r.set(P, null);
  const x = noise(FS, 4, 0.4), L = x.slice(), R = x.slice(), u = r.byId.get('r');
  run(r, L, R, { span: 16, before: (o) => {
    off[8 + 1] = o >= 4800 && o < 4832 ? 0.25 : 0;                // Hall for two 16-sample calls, then Plate again
    r.setMods(off, P.key);
  } });
  assert.deepEqual([u.mod.type, u.mod.topo, u.pend], [0, 0, 0], 'Plate keeps running (no stale request)');
  // Nitrous: a MODE change is applied at the bottom of a duck (the tank cleared), no click, the new mode installed
  const q = new FX2.FXRack(FS), Q = C.compileFx(st(3, 0), { rate: FS, buses: 1 }), y = sine(FS, 300, 0.4), Y = y.slice(), Y2 = y.slice(), at = 150 * 128;
  q.set(Q, null);
  run(q, Y, Y2, { before: (o) => { if (o === at) q.set(C.compileFx(st(3, 4), { rate: FS, buses: 1 }), null); } });
  const tk = q.byId.get('r').mod.tk[3];
  assert.deepEqual([tk.nmode, q.byId.get('r').mod.type], [4, 3]);
  const before = maxStep(Y, at - 4000, at - 16);
  assert.ok(maxStep(Y, at - 16, at + 2000) < 2.5 * before, `MODE 0 → 4: ${maxStep(Y, at - 16, at + 2000).toFixed(4)} vs ${before.toFixed(4)}`);
});

test('§8.3 Reverb S2: every type\'s default wet level lies within ± 3 dB of the Hall\'s (Plate: the Phase-1 topology × 2, above)', () => {
  const x = noise(3 * FS, 5, 0.5), y = noise(3 * FS, 6, 0.5), lv = {};
  for (let t = 0; t < 5; t++) {
    const w = render2(s2([[['rev', { on: 1, mix: 1, type: t / 4 }, 'r']], [], []]), x, y);
    lv[t] = dB(rms(w.L, FS, 3 * FS) / rms(x, FS, 3 * FS));
  }
  for (const t of [2, 3, 4]) assert.ok(Math.abs(lv[t] - lv[1]) < 3, `${C.REV_TYPES2[t]} ${lv[t].toFixed(1)} dB vs Hall ${lv[1].toFixed(1)} dB`);
  assert.ok(lv[0] > lv[1], 'Plate louder (wet × 2)');
});

test('§2.5 non-Serum tracks process only racks[0]: bus instances compiled without the Serum gains never run (the bypass stays O(1))', () => {
  const st = s2([[], [['rev', { on: 1, mix: 1 }, 'b1']], [['dly', { on: 1 }, 'b2']]]);
  const r = new FX2.FXRack(FS);
  r.set(C.compileFx(st, { rate: FS }), null);
  const L = noise(4096, 3), R = noise(4096, 4), L0 = L.slice();
  run(r, L, R);
  assert.ok(sameBits(L, L0), 'input untouched');
  assert.deepEqual([r.byId.get('b1').has, r.byId.get('b2').has, r.calm, r.nAct], [0, 0, 1, 0]);
  const s = new FX2.FXRack(FS);
  s.set(C.compileFx(st, { rate: FS, master: 1 }), null);
  run2(s, new Float64Array(4096), new Float64Array(4096), { b1: [noise(4096, 5, 0.3), noise(4096, 6, 0.3)] });
  assert.deepEqual([s.byId.get('b1').has, s.byId.get('b1').st], [1, 1], 'Serum track (gains given): the bus runs');
});

// §13.5 Delay: the filter display's realtime spectrum overlay reads a monitor tap of the rack (IMPL: the post-module mono
// signal of one instance) — FXRack.setTap(id) / tapOut()
test('§13.5 monitor tap: setTap(id) keeps the last 1024 frames of that instance\'s output as (L + R)/2; off → null; it follows set()', () => {
  const st = s2([[['dly', { ...DLY(80, { feed: 0.3, mix: 0.5 }), hq: 1 }, 'dl']], [], []]);
  const r = rack2(st);
  assert.equal(r.tapOut(), null, 'off by default');
  r.setTap('dl');
  const x = noise(4096, 9, 0.4), L = x.slice(), R = noise(4096, 10, 0.4);
  run(r, L, R);
  const t = r.tapOut();
  assert.ok(t && t.length === 1024 && Object.prototype.toString.call(t) === '[object Float32Array]');
  // the Delay is the rack's only instance: its output is the rack's (neutral output stage)
  let e = 0;
  for (let j = 0; j < 1024; j++) e = Math.max(e, Math.abs(t[j] - Math.fround(0.5 * (L[3072 + j] + R[3072 + j]))));
  assert.ok(e < 1e-6, 'oldest first: ' + e);
  assert.ok(peak(t) > 0.05, 'audible');
  // another set() keeps the tap on the instance; removing it leaves the tap silent
  r.set(C.compileFx(st, { rate: FS, buses: 1 }), C.compileFxT(st));
  assert.ok(r.tapU && r.tapU === r.byId.get('dl'));
  const empty = s2([[], [], []]);
  r.set(C.compileFx(empty, { rate: FS, buses: 1 }), C.compileFxT(empty));
  run(r, new Float64Array(8192), new Float64Array(8192));
  assert.equal(r.tapU, null);
  r.setTap('');
  assert.equal(r.tapOut(), null);
  // allocation-free while tapping
  const r2 = rack2(st);
  r2.setTap('dl');
  const A = noise(512, 3), B = noise(512, 4);
  noAlloc(FULL, () => { run(r2, A, B); r2.tapOut(); });
});

test('stage M review R1-1: a Bode with BLUR after a silent history renders bit-identically to a fresh rack (§10.7f) — its blur LFO phases restart at the quiet re-seed (never heard audio; a stop with silence tails; tails decayed to nothing)', () => {
  const BS = C.FACTORY_FX_PRESETS.bode.find((P) => P.name === 'Blurred Spiral').p, SH = C.FACTORY_RACKS.find((R) => R.name === 'Shimmer Hall').rack.mods[1].p;
  assert.ok(BS.blur > 0 && BS.feed > 0 && BS.delay > 0 && SH.blur > 0, 'blur in the feedback path');
  const prog = (n, s) => { const a = noise(n, s, 0.3); for (let i = 0; i < n; i++) a[i] *= Math.min(1, i / 2400); return a; };
  const A = prog(FS, 21), B = prog(FS, 22), Z = (s) => new Float64Array(Math.round(s * FS));
  const cases = [                                                 // [name, Bode params, what the live rack heard before transport()]
    ['Blurred Spiral, never heard audio, 3 s of zeros', BS, (r) => { const z = Z(3); run(r, z, z.slice()); }],
    ['Shimmer Hall\'s Bode, never heard audio, 0.5 s of zeros', SH, (r) => { const z = Z(0.5); run(r, z, z.slice()); }],
    ['Blurred Spiral, 1 s of audio, a stop with silence tails (reset(true)), 0.5 s of zeros', BS, (r) => { run(r, A.slice(), B.slice()); r.reset(true); const z = Z(0.5); run(r, z, z.slice()); }],
    ['Blurred Spiral, 1 s of audio, 40 s of zeros (the feedback line decays below the flush)', BS, (r) => { run(r, A.slice(), B.slice()); const z = Z(40); run(r, z, z.slice()); }],
  ];
  const bad = [];
  for (const [name, p, history] of cases) {
    const st = s2([[['bode', Object.assign({}, p, { on: 1 }), 'b']], [], []]), live = rack2(st), fresh = rack2(st);
    history(live);
    assert.ok(live.quietT >= 0.25 * FS, name + ': quiet before the start');
    live.transport(); fresh.transport();
    const L1 = A.slice(), R1 = B.slice(), L2 = A.slice(), R2 = B.slice();
    run(live, L1, R1); run(fresh, L2, R2);
    assert.ok(peak(L2) > 0.05 && !sameBits(L2, A), name + ': the Bode sounds');
    let k = 0;
    while (k < L1.length && Object.is(L1[k], L2[k]) && Object.is(R1[k], R2[k])) k++;
    if (k < L1.length) bad.push(`${name}: differs from sample ${k} (max ${peak(L1.map((v, i) => v - L2[i])).toExponential(2)})`);
  }
  assert.deepEqual(bad, []);
});
