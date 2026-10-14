// sx-base.js unit tests (owner D5; SPEC-serum2 §15.5: constants, math, PRNG, asset store, FFT, half-band chains,
// distortion shapers, lazy warm-up) and the shared loader tests/dsp-scope.mjs. Constants are compared with serum-core v2
// (DESTS/SOURCES/WARPS2/FILTERS/ladders), the C1 fixtures dests2.json / sources2.json, and the frozen Phase-1 SerumDSP
// (tests/ref-p1) for the v1 prefix; the shapers with the frozen Phase-1 fx-dsp (tests/ref-p1), the FFT with wt.js.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import * as core from '../serum-core.js?v=7';
import { mulberry32, fnv1a32, fft as wtFft, rfft as wtRfft } from '../wt.js?v=7';
import { dspScope, DSP_FILES, DSP_GLOBALS, DSP_TABLE, source, recorder, noAlloc, ALLOC_NAMES } from './dsp-scope.mjs';

const fixture = name => JSON.parse(readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8'));
const REF_DSP = readFileSync(new URL('ref-p1/serum-dsp.js', import.meta.url), 'utf8');
const REF_FX = readFileSync(new URL('ref-p1/fx-dsp.js', import.meta.url), 'utf8');
const arr = a => Array.from(a);                       // vm-realm arrays / typed arrays → plain arrays of this realm
const plain = o => ({ ...o });
const base = (opts = {}) => {
  const S = dspScope({ files: ['sx-base.js'], ...opts });
  return { S, B: S.global('SxBase') };
};

/* ------------------------------------------------------------------ loading and shape (§0.3, §11.5) */

test('loads in a bare scope, publishes only the frozen SxBase with the §11.5 API', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('sx-base.js');
  const added = [...names()].filter(k => !before.has(k));
  assert.deepEqual(added, ['SxBase']);
  const B = S.global('SxBase');
  assert.ok(B && Object.isFrozen(B));
  assert.equal(B.VER, 1);
  assert.equal(typeof B.epoch, 'number');
  assert.ok(B.assets instanceof S.run('Map', 't.js'));
  const fns = { exp2: 1, log2: 1, tanh: 1, sin1: 1, xorshift: 1, r2Seed: 1, storeAsset: 2, dropAsset: 1, getAsset: 1, assetBytes: 0,
    shape: 3, shapeS: 2, shapeBlock: 4, warmAdd: 3, warmTick: 1 };
  for (const [k, n] of Object.entries(fns)) {
    assert.equal(typeof B[k], 'function', k);
    assert.equal(B[k].length, n, k + ' arity');
  }
  for (const [k, n] of Object.entries({ FFT: 1, HBUp: 1, HBDown: 1, Shaper: 0 })) {
    assert.equal(typeof B[k], 'function', k);
    assert.equal(B[k].length, n, k + ' arity');
    assert.throws(() => B[k](2), /without 'new'/, k + ' is a class');
  }
  const F = new B.FFT(8);
  for (const [k, n] of Object.entries({ fwd: 2, inv: 2, rfwd: 3, rinv: 3 })) assert.equal(F[k].length, n, 'FFT.' + k);
  for (const C of [B.HBUp, B.HBDown]) { const h = new C(2); assert.equal(h.process.length, 3); assert.equal(typeof h.reset, 'function'); }
  assert.equal(B.HB_TAPS, 63); assert.equal(B.HB_BETA, 9.5); assert.equal(B.NXS, 1025);
  for (const k of ['DIDX2', 'DIDS2', 'IDX_OF_VI', 'LAW_TAB2', 'SIDX2', 'SRC_IDS2', 'SRC_POL2', 'GIDX', 'OTYPE', 'WDOM', 'WARP_IDS2',
    'WARP_DOM', 'WARP_AVAIL', 'FILTER_FAMILY2', 'FILTER_FAM2', 'WIN_TAB', 'LAD']) assert.ok(B[k], k);
  for (const k of ['DIDX2', 'DIDS2', 'LAW_TAB2', 'SIDX2', 'SRC_IDS2', 'GIDX', 'OTYPE', 'WDOM', 'WARP_IDS2', 'FILTER_FAMILY2', 'LAD']) {
    assert.ok(Object.isFrozen(B[k]), k + ' frozen');
  }
  assert.equal(S.logs.length, 0, 'no console output on a clean load');
});

test('a throwing copy leaves SxBase null without throwing out of the script; re-evaluation keeps the assets', () => {
  const S = dspScope({ files: ['sx-base.js'], overrides: { 'sx-base.js': src => src.replace('try {', 'try { throw new Error("boom");') } });
  assert.equal(S.global('SxBase'), null);
  assert.ok(S.logs.some(m => m.level === 'error' && /sx-base: load failed/.test(m.text)));

  const { S: S2, B } = base();
  const e = smp('x', 1, 300);
  assert.equal(B.storeAsset('x', e), true);
  const ep = B.epoch, map = B.assets;
  S2.reload('sx-base.js');
  const B2 = S2.global('SxBase');
  assert.notEqual(B2, B);
  assert.equal(B2.assets, map, 'the same Map object');
  assert.equal(B2.getAsset('x'), e);
  assert.equal(B2.epoch, ep + 1, 're-evaluation advances the epoch');
  S2.reload('sx-base.js');
  assert.equal(S2.global('SxBase').epoch, ep + 2);
});

/* ------------------------------------------------------------------ constants vs serum-core (§3.10, §3.11, §15.13) */

test('destinations by vi: DIDX2, DIDS2, IDX_OF_VI and LAW_TAB2 equal serum-core v2 and dests2.json', () => {
  const { B } = base();
  for (const k of ['NS', 'NV1', 'NF1', 'ND', 'NSV', 'NSRC']) assert.equal(B[k], core[k], k);
  assert.equal(B.ND, 529); assert.equal(B.NSV, 429); assert.equal(B.NSRC, 62);
  assert.equal(B.MAXCH, 32);
  assert.equal(B.MAXFX, 8 + 48 * 24);
  assert.equal(B.MIDI0, core.MIDI0);
  assert.deepEqual(plain(B.GIDX), plain(core.GIDX));
  assert.deepEqual(plain(B.DIDX2), plain(core.DIDX));
  const fx = fixture('dests2.json');
  assert.equal(fx.DESTS.length, B.ND);
  const T = B.LAW_TAB2;
  for (const k of ['law', 'lo', 'hi', 'cont']) assert.equal(T[k].length, B.NSV, k);
  for (let v = 0; v < B.NSV; v++) {
    const idx = core.idxOfVi(v);
    assert.equal(B.IDX_OF_VI[v], idx, 'IDX_OF_VI ' + v);
    if (idx < 0) {
      assert.equal(B.DIDS2[v], '', 'unused slot ' + v);
      assert.deepEqual([T.law[v], T.lo[v], T.hi[v], T.cont[v]], [0, 0, 0, 0], 'unused slot ' + v);
      continue;
    }
    const d = core.DESTS[idx], f = fx.DESTS[idx];
    assert.equal(B.DIDS2[v], d.id);
    assert.equal(f.id, d.id);
    const law = core.LAWS.indexOf(d.law);
    assert.equal(T.law[v], law, d.id + ' law');
    assert.ok(Object.is(T.lo[v], d.lo) && T.lo[v] === f.lo, d.id + ' lo');
    assert.ok(Object.is(T.hi[v], d.hi) && T.hi[v] === f.hi, d.id + ' hi');
    assert.equal(T.cont[v], d.law === 'int' || d.law === 'enum' || d.law === 'bool' ? 0 : 1, d.id + ' cont');
    assert.equal(B.DIDX2[d.id.toUpperCase().replace(/\./g, '_')], v);
  }
  for (let idx = 0; idx < B.ND; idx++) {
    const v = core.vi(idx);
    if (v >= 0) assert.equal(B.IDX_OF_VI[v], idx);
    else assert.ok(!arr(B.IDX_OF_VI).includes(idx), 'idx ' + idx + ' has no voice slot');
  }
  assert.deepEqual([403, 404, 405].map(v => B.IDX_OF_VI[v]), [-1, -1, -1]);
  assert.equal(B.DIDX2.C_LEVEL, 148); assert.equal(B.DIDX2.A_W1, 167); assert.equal(B.DIDX2.F2_ON, 339);   // §3.11.1 examples
  assert.equal(B.DIDX2.G_DIRECT, undefined);
});

test('v1 prefix: LAW_TAB2 0–147, DIDX2, SIDX2 and SRC_POL2 extend the Phase-1 SerumDSP tables (tests/ref-p1)', () => {
  const ctx = vm.createContext({ console: recorder() });
  vm.runInContext(REF_DSP, ctx, { filename: 'ref-p1/serum-dsp.js' });
  const R = ctx.SerumDSP;
  const { B } = base();
  for (const k of ['law', 'lo', 'hi', 'cont']) assert.deepEqual(arr(B.LAW_TAB2[k]).slice(0, 148), arr(R.LAW_TAB[k]).slice(0, 148), k);
  for (const [k, v] of Object.entries(R.DIDX)) assert.equal(B.DIDX2[k], v, k);
  for (const [k, v] of Object.entries(R.SIDX)) assert.equal(B.SIDX2[k], v, k);
  assert.deepEqual(arr(B.SRC_POL2).slice(0, 34), arr(R.SRC_POL));
  assert.deepEqual(arr(R.FILTER_FAM_OF), arr(B.FILTER_FAM2).slice(0, 96));
  assert.deepEqual(arr(R.FILTER_FAMILY), arr(B.FILTER_FAMILY2).slice(0, 19));
});

test('sources: SRC_IDS2, SIDX2 and SRC_POL2 equal serum-core SOURCES / SIDX and sources2.json', () => {
  const { B } = base();
  const fx = fixture('sources2.json');
  assert.deepEqual(arr(B.SRC_IDS2), core.SOURCES.map(s => s.id));
  assert.deepEqual(arr(B.SRC_IDS2), fx.SOURCES.map(s => s.id));
  assert.deepEqual(plain(B.SIDX2), plain(core.SIDX));
  assert.deepEqual(arr(B.SRC_POL2), core.SOURCES.map(s => (s.pol === 'bi' ? 1 : 0)));
  assert.deepEqual(arr(B.SRC_POL2), fx.SOURCES.map(s => (s.pol === 'bi' ? 1 : 0)));
});

test('warps, oscillator types and filter families equal serum-core (WARPS2, WARP_AVAIL, OSC_TYPES, FILTERS)', () => {
  const { B } = base();
  assert.deepEqual(arr(B.WARP_IDS2), core.WARPS2.map(w => w.id));
  const DOM = { '': B.WDOM.NONE, F: B.WDOM.F, P: B.WDOM.P, O: B.WDOM.O, S: B.WDOM.S };
  assert.deepEqual(arr(B.WARP_DOM), core.WARPS2.map(w => DOM[w.dom]));
  assert.deepEqual(plain(B.OTYPE), Object.fromEntries(core.OSC_TYPES.map((t, i) => [t.id === 'wt' ? 'WT' : t.id.toUpperCase(), i])));
  for (let m = 0; m < 82; m++) {
    for (let t = 0; t < 5; t++) {
      const want = core.WARP_AVAIL[m] === 'all' || (core.WARP_AVAIL[m] === 'Sp' && core.OSC_TYPES[t].id === 'spec');
      assert.equal(((B.WARP_AVAIL[m] >> t) & 1) === 1, want, `mode ${m} on type ${t}`);
    }
  }
  assert.deepEqual([B.WARP_IDS2[33], B.WARP_IDS2[39], B.WARP_IDS2[46], B.WARP_IDS2[52], B.WARP_IDS2[58]], ['fm_o1', 'pd_o1', 'am_o1', 'rm_o1', 's_comb']);
  assert.deepEqual(arr(B.FILTER_FAMILY2), arr(core.FILTER_FAMILY));
  assert.equal(B.FILTER_FAM2.length, 108);
  assert.deepEqual(arr(B.FILTER_FAM2), core.FILTERS.map(f => core.FILTER_FAMILY.indexOf(f.family)));
});

test('ladders equal serum-core lfoLadder / ENV_LADDER / VC_RATES and the §3.15 tables', () => {
  const { B } = base();
  const L = B.LAD;
  for (let v = 0; v < 4; v++) assert.deepEqual(arr(L.lfo[v]), core.lfoLadder(v & 1, v >> 1).map(e => e.beats), 'lfo ' + v);
  assert.deepEqual(arr(L.env), core.ENV_LADDER.map(e => e.beats));
  assert.deepEqual(arr(L.env), [0, 1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64, 128]);
  assert.deepEqual(arr(L.vcRates), arr(core.VC_RATES));
  // independent construction of §3.15.4: straight entries, dot (× 1.5) and trip (× 2/3) of the first 8, slowest first
  const lad = (straight, v) => {
    const out = straight.slice();
    if (v & 1) for (let i = 0; i < 8; i++) out.push(straight[i] * 1.5);
    if (v >> 1) for (let i = 0; i < 8; i++) out.push(straight[i] * 2 / 3);
    return out.sort((a, b) => b - a);
  };
  const ARP = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625], GRID = ARP.concat([1 / 32, 1 / 64]);
  for (let v = 0; v < 4; v++) {
    assert.deepEqual(arr(L.arp[v]), lad(ARP, v), 'arp ' + v);
    assert.deepEqual(arr(L.grid[v]), lad(GRID, v), 'grid ' + v);
  }
  assert.deepEqual(arr(L.arp).map(x => x.length), [9, 17, 17, 25]);
  assert.deepEqual(arr(L.grid).map(x => x.length), [11, 19, 19, 27]);
  assert.deepEqual(arr(L.lfo).map(x => x.length), [15, 29, 29, 43]);
  assert.deepEqual(arr(L.len), [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 128]);
  assert.deepEqual(arr(L.rrate), [1, 2, 4, 8, 16, 32]);
  assert.deepEqual(arr(L.time), [0.25, 0.5, 1, 2, 4, 8, 16]);
  assert.deepEqual(arr(L.launch), [0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16]);
});

test('granular window tables equal the §3.8 formulas (1e-12)', () => {
  const { B } = base();
  const N = B.WIN_N, W = B.WIN_TAB;
  assert.equal(N, 1024);
  assert.equal(W.length, 10 * (N + 1));
  const sinc = t => (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t));
  const hann = u => 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
  const F = [
    hann,
    u => 1 - (2 * u - 1) ** 2,
    u => Math.exp(-0.5 * ((u - 0.5) / 0.15) ** 2),
    u => 0.35875 - 0.48829 * Math.cos(2 * Math.PI * u) + 0.14128 * Math.cos(4 * Math.PI * u) - 0.01168 * Math.cos(6 * Math.PI * u),
    u => sinc(4 * (2 * u - 1)) * hann(u),
    u => (u < 0.25 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u / 0.5) : u > 0.75 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * (1 - u) / 0.5) : 1),
    u => 1 - Math.abs(2 * u - 1),
    u => Math.min(1, 4 * u, 4 * (1 - u)),
    u => Math.exp(-6 * u) * Math.min(1, 200 * u),
    u => Math.exp(-6 * (1 - u)) * Math.min(1, 200 * (1 - u)),
  ];
  assert.equal(core.GRAIN_WINDOWS.length, F.length);
  for (let k = 0; k < F.length; k++) {
    let err = 0;
    for (let j = 0; j <= N; j++) err = Math.max(err, Math.abs(W[k * (N + 1) + j] - F[k](j / N)));
    assert.ok(err <= 1e-12, `${core.GRAIN_WINDOWS[k].id}: max error ${err}`);
  }
  assert.equal(W[0], 0); assert.equal(W[512], 1);                 // Hann: 0 at the edge, 1 at the centre
  assert.equal(W[8 * (N + 1)], 0); assert.equal(W[9 * (N + 1) + N], 0);   // ExpDec click guards
});

/* ------------------------------------------------------------------ math and PRNG (Phase-1 code, §6.2) */

// The Phase-1 fast-math block and xorshift, taken verbatim from the frozen serum-dsp.js
function refMath() {
  const a = REF_DSP.indexOf('/* ------------------------------------------------------------ fast math');
  const b = REF_DSP.indexOf('// equal-power pan gains', a);
  const x = /function xorshift\(s\) \{[^\n]*\}/.exec(REF_DSP);
  assert.ok(a > 0 && b > a && x, 'Phase-1 fast-math block found');
  const body = REF_DSP.slice(a, b) + '\n' + x[0] + '\nreturn { th, exp2, log2, sin1, xorshift };';
  return new Function('pow', 'floor', 'mlog2', 'sin', 'PI', body)(Math.pow, Math.floor, Math.log2, Math.sin, Math.PI);
}

test('exp2, log2, tanh, sin1 are bit-identical to Phase-1 serum-dsp and within its tolerances', () => {
  const { B } = base();
  const R = refMath();
  const rnd = mulberry32(7);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 180, y = Math.exp((rnd() - 0.5) * 80), t = (rnd() - 0.5) * 20, p = (rnd() - 0.5) * 9;
    assert.ok(Object.is(B.exp2(x), R.exp2(x)), 'exp2 ' + x);
    assert.ok(Object.is(B.log2(y), R.log2(y)), 'log2 ' + y);
    assert.ok(Object.is(B.tanh(t), R.th(t)), 'tanh ' + t);
    assert.ok(Object.is(B.sin1(p), R.sin1(p)), 'sin1 ' + p);
    if (x > -79 && x < 79) assert.ok(Math.abs(B.exp2(x) / 2 ** x - 1) < 1e-9);
    assert.ok(Math.abs(B.log2(y) - Math.log2(y)) < 1e-10);
    assert.ok(Math.abs(B.tanh(t) - Math.tanh(t)) < 1e-4 && Math.abs(B.tanh(t)) <= 1);
    assert.ok(Math.abs(B.sin1(p) - Math.sin(2 * Math.PI * p)) < 3e-7);
  }
  assert.equal(B.exp2(0), 1); assert.equal(B.exp2(-100), 0);
});

test('PRNG: xorshift is the Phase-1 step; r2Seed salts with R2_SALT and never yields 0 (§6.2)', () => {
  const { B } = base();
  const R = refMath();
  assert.equal(B.R2_SALT, 0x85EBCA6B);
  for (const s0 of [1, 12345, 0x9E3779B9, -1640531527, 0x7FFFFFFF, -5, 0x51ED27 ^ 99]) {
    let a = s0, b = s0;
    for (let i = 0; i < 1000; i++) { a = B.xorshift(a); b = R.xorshift(b); assert.equal(a, b); assert.ok(a >= 0 && a <= 0xFFFFFFFF); }
  }
  const rnd = mulberry32(3);
  for (let i = 0; i < 2000; i++) {
    const rng = (rnd() * 4294967296) >>> 0, vi = i & 31;
    const seed = rng ^ (0x9E3779B9 * (vi + 1));                 // the value Phase 1 passes to xorshift for the voice stream r
    const r2 = B.r2Seed(seed);
    assert.equal(r2, R.xorshift((seed ^ 0x85EBCA6B) >>> 0) || 1);
    assert.notEqual(r2, R.xorshift(seed) || 1, 'r2 differs from r');
    assert.notEqual(r2, R.xorshift(rng) || 1, 'r2 differs from the processor stream');
  }
  assert.equal(B.r2Seed(0x85EBCA6B), 1, 'xorshift(0) = 0 is replaced by 1');
});

/* ------------------------------------------------------------------ asset store (§4.5, §9.5) */

function levelsOf(len, ch, n, ceil = true) {
  const out = [];
  for (let l = 0, m = len; l < n; l++, m = ceil ? Math.ceil(m / 2) : Math.floor(m / 2)) {
    const L = new Float32Array(m).map((_, i) => Math.sin(i / 7));
    out.push({ len: m, L, R: ch === 2 ? L.slice() : null });
  }
  return out;
}
function smp(id, ch = 1, len = 1000, nLev = 4, extra = {}) {
  return { id, v: 1, kind: 'smp', bytes: 0, rate: 44100, ch, len, root: 60.25, loop: { start: Math.floor(len / 10), end: len - Math.floor(len / 10) }, peak: 0.99,
    levels: levelsOf(len, ch, nLev), ...extra };
}
function spec(id, N = 2048, frames = 10, extra = {}) {
  const B = frames * (N / 2 + 1);
  return { id, v: 1, kind: 'spec', bytes: 0, rate: 48000, len: frames * N / 4, N, hop: N / 4, frames, ch: 1,
    mag: new Float32Array(B), ph: new Float32Array(B), trans: new Uint8Array(frames), peak: 0.5, ...extra };
}
function zone(extra = {}) {
  return { lo: 36, hi: 48, vlo: 0, vhi: 127, root: 42, tune: -3, gain: -1.5, pan: 0.25, smp: 'fsmp:x', mode: 'sustain', ls: 10, le: 900,
    off: 0, env: [0, 0.01, 0, 0.2, 0.7, 0.3], rr: [1, 1], vt: 1, ...extra };
}
function multi(id, zones = [zone(), zone({ lo: 49, hi: 60, mode: 'oneshot', ls: 0, le: 0, env: null, rr: [2, 2] })], extra = {}) {
  return { id, v: 1, kind: 'multi', bytes: 0, zones, ...extra };
}
function parts(n, B) { return { n, re: new Float32Array(n * B), im: new Float32Array(n * B) }; }
function ir(id, ch = 2, len = 20000, extra = {}) {
  const hpN = Math.max(0, Math.ceil((Math.min(len, 8192) - 128) / 128)), tpN = Math.max(0, Math.ceil((len - 8192) / 4096));
  const per = () => ({ head: new Float32Array(128), hp: parts(hpN, 129), tp: parts(tpN, 4097) });
  const C = Array.from({ length: ch }, per);
  return { id, v: 1, kind: 'ir', bytes: 0, rate: 48000, ch, len, peak: 1, head: C.map(c => c.head), hp: C.map(c => c.hp), tp: C.map(c => c.tp),
    ...extra };
}
const typedBytes = e => {
  let n = 0;
  const walk = x => { if (ArrayBuffer.isView(x)) n += x.byteLength; else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k]); };
  walk(e);
  return n;
};

test('asset store: every valid kind is adopted as is; epoch, getAsset, dropAsset, assetBytes', () => {
  const { S, B } = base();
  const wtR = 2;                                                  // wavetable-as-sample entry (§9.4.8)
  const wtsmp = smp('wtsmp:factory:Default', 1, wtR * 2048, 6, { rate: 48000, root: 69 + 12 * Math.log2(48000 / (2048 * 440)),
    loop: { start: 0, end: wtR * 2048 } });
  const entries = [
    smp('smp:a', 1, 1000), smp('smp:b~0a1b2c3d', 2, 999, 8), { ...smp('fsmp:c', 1, 1001, 3), levels: levelsOf(1001, 1, 3, false), loop: null },
    { ...smp('fsmp:d', 1, 64, 1), loop: undefined }, wtsmp, spec('spec:smp:a'), spec('spec:wtsmp:x~r', 4096, 3), spec('spec:smp:root', 2048, 2, { root: 57.5 }),
    spec('spec:smp:rnull', 2048, 2, { root: null }), multi('fmsmp:Keys'),
    multi('msmp:empty', []), ir('fir:Rooms/A@48000~00ff00ff', 2, 20000), ir('ir:u@44100~1', 1, 100), ir('ir:v@48000~2', 1, 8192),
    { ...ir('ir:w@48000~3', 1, 9000), hp: [parts(63, 256)], tp: [parts(1, 8192)] },
  ];
  let ep = B.epoch, bytes = 0;
  assert.equal(B.assetBytes(), 0);
  for (const e of entries) {
    assert.equal(B.storeAsset(e.id, e), true, e.id);
    assert.equal(B.epoch, ++ep, 'epoch +1 on ' + e.id);
    assert.equal(B.getAsset(e.id), e, 'adopted, not copied');
    bytes += typedBytes(e);
    assert.equal(B.assetBytes(), bytes, 'assetBytes after ' + e.id);
  }
  assert.equal(B.assets.size, entries.length);
  assert.equal(S.logs.length, 0, 'no warnings for valid entries');
  assert.equal(B.getAsset('nope'), null);
  assert.equal(B.dropAsset('nope'), false);
  assert.equal(B.epoch, ep, 'dropping an unknown id keeps the epoch');
  assert.equal(B.dropAsset('smp:a'), true);
  assert.equal(B.epoch, ++ep);
  assert.equal(B.getAsset('smp:a'), null);
  assert.equal(B.assetBytes(), bytes - typedBytes(entries[0]));
  const rep = smp('smp:b~0a1b2c3d', 1, 10, 1);                    // storing under an existing id replaces the entry
  assert.equal(B.storeAsset(rep.id, rep), true);
  assert.equal(B.getAsset(rep.id), rep);
  assert.equal(B.epoch, ++ep);
});

test('asset store: invalid entries are refused with one warning per id, nothing stored, epoch unchanged', () => {
  const { S, B } = base();
  const bad = [
    ['common: v', smp('a1', 1, 100, 1, { v: 2 })],
    ['common: kind', smp('a2', 1, 100, 1, { kind: 'wt' })],
    ['common: id mismatch', smp('other', 1, 100, 1)],
    ['common: bytes', smp('a4', 1, 100, 1, { bytes: -1 })],
    ['common: bytes missing', smp('a5', 1, 100, 1, { bytes: undefined })],
    ['smp: rate > 48 kHz', smp('s1', 1, 100, 1, { rate: 96000 })],
    ['smp: ch 3', smp('s2', 1, 100, 1, { ch: 3 })],
    ['smp: len ≠ level 0', smp('s3', 1, 100, 1, { len: 101 })],
    ['smp: level halving', { ...smp('s4', 1, 100, 2), levels: [levelsOf(100, 1, 1)[0], levelsOf(40, 1, 1)[0]] }],
    ['smp: L type', { ...smp('s5', 1, 100, 1), levels: [{ len: 100, L: new Float64Array(100), R: null }] }],
    ['smp: L length', { ...smp('s6', 1, 100, 1), levels: [{ len: 100, L: new Float32Array(99), R: null }] }],
    ['smp: R on ch 1', { ...smp('s7', 1, 100, 1), levels: levelsOf(100, 2, 1) }],
    ['smp: R missing on ch 2', { ...smp('s8', 2, 100, 1), levels: levelsOf(100, 1, 1) }],
    ['smp: loop end > len', smp('s9', 1, 100, 1, { loop: { start: 0, end: 101 } })],
    ['smp: loop start = end', smp('s10', 1, 100, 1, { loop: { start: 50, end: 50 } })],
    ['smp: peak', smp('s11', 1, 100, 1, { peak: NaN })],
    ['smp: root', smp('s12', 1, 100, 1, { root: Infinity })],
    ['smp: 9 levels', smp('s13', 1, 4096, 9)],
    ['smp: no levels', smp('s14', 1, 100, 1, { levels: [] })],
    ['spec: mag length', spec('p1', 2048, 4, { mag: new Float32Array(4 * 1024) })],
    ['spec: N', spec('p2', 2048, 4, { N: 2000 })],
    ['spec: hop > N', spec('p3', 2048, 4, { hop: 4096 })],
    ['spec: trans type', spec('p4', 2048, 4, { trans: new Float32Array(4) })],
    ['spec: ch 2', spec('p5', 2048, 4, { ch: 2 })],
    ['spec: rate', spec('p6', 2048, 4, { rate: 96000 })],
    ['spec: root NaN', spec('p7', 2048, 4, { root: NaN })],
    ['spec: root string', spec('p8', 2048, 4, { root: '60' })],
    ['multi: lo > hi', multi('m1', [zone({ lo: 50, hi: 40 })])],
    ['multi: vhi 128', multi('m2', [zone({ vhi: 128 })])],
    ['multi: pan', multi('m3', [zone({ pan: 2 })])],
    ['multi: mode', multi('m4', [zone({ mode: 'loop_continuous' })])],
    ['multi: rr', multi('m5', [zone({ rr: [2, 3] })])],
    ['multi: vt', multi('m6', [zone({ vt: 1.5 })])],
    ['multi: env length', multi('m7', [zone({ env: [0, 0, 0, 0, 1] })])],
    ['multi: env sustain', multi('m8', [zone({ env: [0, 0, 0, 0, 1.5, 0] })])],
    ['multi: smp id', multi('m9', [zone({ smp: '' })])],
    ['multi: loop ls = le', multi('m10', [zone({ mode: 'loop', ls: 5, le: 5 })])],
    ['multi: 513 zones', multi('m11', Array.from({ length: 513 }, () => zone()))],
    ['multi: zones missing', { ...multi('m12'), zones: undefined }],
    ['ir: head length', { ...ir('i1', 1, 1000), head: [new Float32Array(127)] }],
    ['ir: hp n > 63', { ...ir('i2', 1, 1000), hp: [parts(64, 129)] }],
    ['ir: hp re/im', { ...ir('i3', 1, 1000), hp: [{ n: 8, re: new Float32Array(8 * 129), im: new Float32Array(8 * 128) }] }],
    ['ir: hp coverage', { ...ir('i4', 1, 4096), hp: [parts(10, 129)] }],
    ['ir: tp coverage', { ...ir('i5', 1, 20000), tp: [parts(2, 4097)] }],
    ['ir: second channel', { ...ir('i6', 2, 1000), head: [new Float32Array(128)] }],
    ['ir: bin count', { ...ir('i7', 1, 1000), hp: [parts(7, 130)] }],
  ];
  const ep = B.epoch;
  for (const [what, e] of bad) {
    const id = what === 'common: id mismatch' ? 'a3' : e.id;
    const n = S.logs.length;
    assert.equal(B.storeAsset(id, e), false, what);
    assert.equal(B.getAsset(id), null, what);
    assert.equal(S.logs.length, n + 1, what + ': one warning');
    assert.equal(S.logs[n].level, 'warn');
    assert.ok(S.logs[n].text.startsWith('sx-base: invalid asset entry ' + id + ' - '), S.logs[n].text);
    assert.equal(B.storeAsset(id, e), false, what);
    assert.equal(S.logs.length, n + 1, what + ': warned once per id');
  }
  for (const [id, e] of [['', smp('', 1, 100, 1)], [7, smp('x', 1, 100, 1)], ['n', null], ['n2', [1, 2]]]) {
    assert.equal(B.storeAsset(id, e), false);
  }
  assert.equal(B.epoch, ep, 'epoch unchanged by refused entries');
  assert.equal(B.assets.size, 0);
  assert.equal(B.assetBytes(), 0);
});

/* ------------------------------------------------------------------ tests/dsp-scope.mjs (§15) */

test('dsp-scope: the §0.3 list in table order, null/false/string/function overrides, missing files, Math.random, engine', () => {
  assert.deepEqual(DSP_FILES, ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js',
    'sx-seq.js', 'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js']);
  assert.deepEqual(DSP_TABLE.map(e => e[1]), ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP',
    'FXMods2', 'FXDSP']);
  // order: replacement scripts record their evaluation; `files` given in reverse is still loaded in table order
  const rec = f => `globalThis.__order = (globalThis.__order || []).concat(${JSON.stringify(f)}); globalThis.${DSP_GLOBALS[f]} = 1;`;
  const S = dspScope({ files: DSP_FILES.slice().reverse(), overrides: Object.fromEntries(DSP_FILES.map(f => [f, rec(f)])) });
  assert.deepEqual(arr(S.global('__order')), DSP_FILES);
  assert.deepEqual(S.loaded, DSP_FILES);
  // null → global null, not evaluated; false → undefined; a function transforms the real source
  const S2 = dspScope({
    files: ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js'],
    overrides: { 'sx-filt2.js': null, 'sx-warp.js': false, 'sx-mod.js': '/* stub */ globalThis.SxMod = { stub: 1 };',
      'sx-base.js': src => src.replace('const VER = 1;', 'const VER = 77;') },
  });
  assert.equal(S2.global('SxBase').VER, 77);
  assert.equal(S2.global('SxFilt2'), null);
  assert.equal(S2.global('SxWarp'), undefined);
  assert.equal(S2.global('SxMod').stub, 1);
  assert.deepEqual(S2.loaded, ['sx-base.js', 'sx-mod.js']);
  assert.throws(() => dspScope({ files: ['engine.js'] }), /not in the §0.3 list/);
  // listed files that do not exist yet: global null (default) or undefined ('skip')
  const S3 = dspScope({ files: DSP_FILES, overrides: Object.fromEntries(DSP_FILES.filter(f => source(f) !== null).map(f => [f, false])) });
  for (const f of S3.missing) {
    assert.ok(!existsSync(new URL('../' + f, import.meta.url)), f);
    assert.equal(S3.global(DSP_GLOBALS[f]), null, f);
  }
  assert.deepEqual(S3.missing, DSP_FILES.filter(f => source(f) === null));
  const S4 = dspScope({ files: S3.missing, missing: 'skip' });
  for (const f of S3.missing) assert.equal(S4.global(DSP_GLOBALS[f]), undefined, f);
  // Math.random = mulberry32(fnv1a32(id)), reseeded by seed(id); no helper global leaks
  const S5 = dspScope({ files: [], seed: 'render-1' });
  const r1 = mulberry32(fnv1a32('render-1'));
  assert.deepEqual([0, 1, 2].map(() => S5.run('Math.random()', 't.js')), [r1(), r1(), r1()]);
  S5.seed('render-2');
  const r2 = mulberry32(fnv1a32('render-2'));
  assert.equal(S5.run('Math.random()', 't.js'), r2());
  assert.deepEqual(arr(S5.run('Object.getOwnPropertyNames(globalThis).filter(k => /^(__|AudioWorkletProcessor|registerProcessor|sampleRate|currentFrame)/.test(k)).sort()', 't.js')),
    ['AudioWorkletProcessor', 'currentFrame', 'registerProcessor', 'sampleRate']);
  assert.equal(S5.run('sampleRate', 't.js'), 48000);
  // engine.js last: the registered processor class is returned
  const S6 = dspScope({ files: ['sx-base.js'], engine: true, sampleRate: 44100 });
  assert.equal(typeof S6.Proc, 'function');
  assert.throws(() => dspScope({ files: [], bare: true, engine: true }), /AudioWorklet globals/);
});

test('dsp-scope noAlloc: throwing constructors inside, built-ins restored afterwards (contextified and fast scopes)', () => {
  for (const fast of [false, true]) {
    const S = dspScope({ files: ['sx-base.js'], fast });
    assert.throws(() => noAlloc(S, () => S.run('new Float64Array(4)', 't.js')), /allocation: Float64Array/);
    assert.throws(() => noAlloc(S, () => S.run('new Map()', 't.js')), /allocation: Map/);
    assert.equal(noAlloc(S, () => 7), 7, 'returns fn\'s result');
    for (const k of ALLOC_NAMES) assert.equal(S.run('typeof ' + k, 't.js'), 'function', k + ' restored');
    assert.equal(S.run('new Float64Array(3).length', 't.js'), 3);
    assert.equal(new (S.global('SxBase').FFT)(16).n, 16, 'the scope still allocates after noAlloc');
  }
});

/* ------------------------------------------------------------------ FFT (§11.5, §15.5) */

const maxAbs = a => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };

test('FFT: complex and real round trips < 1e-12 for n = 2…65536; rfwd equals fwd of the real signal', () => {
  const { B } = base();
  const rnd = mulberry32(0xFF7);
  for (let n = 2; n <= 65536; n *= 2) {
    const F = new B.FFT(n), x = new Float64Array(n), y = new Float64Array(n), re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = re[i] = 2 * rnd() - 1; y[i] = im[i] = 2 * rnd() - 1; }
    F.fwd(re, im); F.inv(re, im);
    let e = 0;
    for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(re[i] - x[i]), Math.abs(im[i] - y[i]));
    assert.ok(e < 1e-12, `complex n ${n}: ${e}`);
    const h = n / 2, R = new Float64Array(h + 1), I = new Float64Array(h + 1), z = new Float64Array(n), x0 = x.slice();
    F.rfwd(x, R, I);
    F.rinv(R, I, z);
    e = 0;
    for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(z[i] - x[i]));
    assert.ok(e < 1e-12, `real n ${n}: ${e}`);
    assert.deepEqual(x, x0, 'rfwd leaves its input');
    assert.equal(I[0], 0); assert.equal(I[h], 0);
    const cr = x.slice(), ci = new Float64Array(n);
    F.fwd(cr, ci);
    e = 0;
    for (let k = 0; k <= h; k++) e = Math.max(e, Math.abs(cr[k] - R[k]), Math.abs(ci[k] - I[k]));
    assert.ok(e < 1e-12 * n, `rfwd vs fwd n ${n}: ${e}`);
  }
});

test('FFT: conventions (naive DFT, wt.js fft/rfft), cosine at bin 5, rinv ignores im[0]/im[n/2], shared tables, sizes', () => {
  const { S, B } = base();
  const rnd = mulberry32(5);
  for (let n = 2; n <= 64; n *= 2) {                        // forward e^{−2πijk/n}, unscaled; inverse e^{+…}/n
    const F = new B.FFT(n), xr = Array.from({ length: n }, () => rnd() - 0.5), xi = Array.from({ length: n }, () => rnd() - 0.5);
    const re = Float64Array.from(xr), im = Float64Array.from(xi);
    F.fwd(re, im);
    let e = 0;
    for (let k = 0; k < n; k++) {
      let sr = 0, si = 0;
      for (let j = 0; j < n; j++) { const a = -2 * Math.PI * j * k / n; sr += xr[j] * Math.cos(a) - xi[j] * Math.sin(a); si += xr[j] * Math.sin(a) + xi[j] * Math.cos(a); }
      e = Math.max(e, Math.abs(sr - re[k]), Math.abs(si - im[k]));
    }
    assert.ok(e < 1e-12, `naive DFT n ${n}: ${e}`);
  }
  for (const n of [2048, 4096]) {                            // the main thread's convention (smp.js analyses with wt.js)
    const F = new B.FFT(n), x = Float64Array.from({ length: n }, () => rnd() - 0.5);
    const a = x.slice(), ai = new Float64Array(n), b = x.slice(), bi = new Float64Array(n);
    F.fwd(a, ai); wtFft(b, bi, false);
    assert.ok(Math.max(maxAbs(a.map((v, i) => v - b[i])), maxAbs(ai.map((v, i) => v - bi[i]))) < 1e-10, 'fwd = wt.fft');
    F.inv(a, ai); wtFft(b, bi, true);
    assert.ok(maxAbs(a.map((v, i) => v - b[i])) < 1e-12, 'inv = wt.fft inverse');
    const R = new Float64Array(n / 2 + 1), I = new Float64Array(n / 2 + 1), W = wtRfft(x);
    F.rfwd(x, R, I);
    assert.ok(Math.max(maxAbs(R.map((v, k) => v - W.re[k])), maxAbs(I.map((v, k) => v - W.im[k]))) < 1e-10, 'rfwd = wt.rfft');
  }
  const n = 1024, F = new B.FFT(n), x = Float32Array.from({ length: n }, (_, i) => Math.cos(2 * Math.PI * 5 * i / n));
  const R = new Float64Array(n / 2 + 1), I = new Float64Array(n / 2 + 1);
  F.rfwd(x, R, I);                                           // any array type as the real input
  assert.ok(Math.abs(R[5] - n / 2) < 1e-4);
  for (let k = 0; k <= n / 2; k++) if (k !== 5) assert.ok(Math.hypot(R[k], I[k]) < 1e-3, 'bin ' + k);
  const z1 = new Float64Array(n), z2 = new Float64Array(n);
  F.rinv(R, I, z1);
  const R0 = R.slice(), I0 = I.slice();
  I[0] = 123; I[n / 2] = -9;                                 // the Hermitian extension ignores them
  F.rinv(R, I, z2);
  assert.deepEqual(z1, z2);
  I[0] = I0[0]; I[n / 2] = I0[n / 2];
  assert.deepEqual([R, I], [R0, I0], 'rinv leaves its input');
  assert.ok(maxAbs(z1.map((v, i) => v - x[i])) < 1e-12);
  assert.equal(new B.FFT(2048).T, new B.FFT(2048).T, 'tables shared per size');
  for (const bad of [0, 1, 3, 100, 131072, 2.5, '1024', NaN, undefined]) assert.throws(() => new B.FFT(bad), S.run('RangeError', 't.js'), String(bad));
});

test('FFT: fwd / inv / rfwd / rinv allocate nothing', () => {
  const { S, B } = base();
  const F = new B.FFT(4096), re = new Float64Array(4096), im = new Float64Array(4096), R = new Float64Array(2049), I = new Float64Array(2049);
  re[3] = 1;
  noAlloc(S, () => { F.fwd(re, im); F.inv(re, im); F.rfwd(re, R, I); F.rinv(R, I, re); });
  assert.ok(Math.abs(re[3] - 1) < 1e-12);
});

/* ------------------------------------------------------------------ half-band resamplers (§11.5, §15.5) */

// least-squares fit a·sin(w·i) + b·cos(w·i) over [s0, s0 + L): amplitude and residual power relative to the fit (dB)
function sineFit(y, s0, L, w) {
  let ss = 0, cc = 0, sc = 0, ys = 0, yc = 0;
  for (let i = s0; i < s0 + L; i++) { const s = Math.sin(w * i), c = Math.cos(w * i); ss += s * s; cc += c * c; sc += s * c; ys += y[i] * s; yc += y[i] * c; }
  const det = ss * cc - sc * sc, a = (ys * cc - yc * sc) / det, b = (yc * ss - ys * sc) / det;
  let res = 0;
  for (let i = s0; i < s0 + L; i++) { const r = y[i] - a * Math.sin(w * i) - b * Math.cos(w * i); res += r * r; }
  return { amp: Math.hypot(a, b), ph: Math.atan2(b, a), resDb: 10 * Math.log10(res / L / (0.5 * (a * a + b * b))) };
}
const sine = (n, f, fs, ph = 0) => Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i / fs + ph));

test('half-band chains: passband ±0.05 dB to 0.4·fs, images and aliases ≤ −90 dB (HBUp / HBDown, os 2, 4, 8)', () => {
  const { B } = base();
  const fb = 48000, N = 3072, T = 512;
  const PASS = [20, 440, 3000, 9000, 14000, 17000, 18500, 19200];          // ≤ 0.4·fs (19.2 kHz)
  for (const os of [2, 4, 8]) {
    const up = new B.HBUp(os), dn = new B.HBDown(os);
    for (const f of PASS) {
      const y = new Float64Array(N * os);
      up.reset(); up.process(sine(N, f, fb), y, N);
      const r = sineFit(y, T * os, (N - T) * os, 2 * Math.PI * f / (fb * os));
      assert.ok(Math.abs(20 * Math.log10(r.amp)) <= 0.05, `up ×${os} ${f} Hz gain ${20 * Math.log10(r.amp)} dB`);
      assert.ok(r.resDb <= -90, `up ×${os} ${f} Hz images ${r.resDb} dB`);
      const z = new Float64Array(N);
      dn.reset(); dn.process(sine(N * os, f, fb * os), z, N);
      const q = sineFit(z, T, N - T, 2 * Math.PI * f / fb);
      assert.ok(Math.abs(20 * Math.log10(q.amp)) <= 0.05, `down ×${os} ${f} Hz gain ${20 * Math.log10(q.amp)} dB`);
      assert.ok(q.resDb <= -90, `down ×${os} ${f} Hz residual ${q.resDb} dB`);
    }
    // aliases: every input from 0.6·fs up to the OS Nyquist leaves ≤ −90 dB at the base rate
    for (let f = 0.6 * fb; f < os * fb / 2; f += os * fb / 2 / 41.7) {
      const z = new Float64Array(N);
      dn.reset(); dn.process(sine(N * os, f, fb * os), z, N);
      let e = 0;
      for (let i = T; i < N; i++) e += z[i] * z[i];
      const db = 10 * Math.log10(e / (N - T) / 0.5);
      assert.ok(db <= -90, `down ×${os} alias of ${f.toFixed(0)} Hz: ${db} dB`);
    }
  }
});

test('half-band chains: linear phase at the stated delay, input samples pass the interpolator unchanged, os 1 copies', () => {
  const { B } = base();
  const fb = 48000, N = 4096, rnd = mulberry32(31);
  for (const os of [2, 4, 8, 16]) {
    const up = new B.HBUp(os), dn = new B.HBDown(os);
    assert.equal(up.K, Math.log2(os)); assert.equal(dn.K, Math.log2(os));
    assert.equal(up.delay, 31 * (os - 1) / os); assert.equal(dn.delay, 30 * (os - 1) / os);
    assert.ok(up.bytes > 0 && dn.bytes > 0);
    // y[os·m + 31·(os − 1)] = x[m] exactly
    const x = Float64Array.from({ length: 512 }, () => 2 * rnd() - 1), y = new Float64Array(512 * os);
    up.process(x, y, 512);
    for (let m = 0; m + 31 * (os - 1) / os < 512; m++) assert.equal(y[os * m + 31 * (os - 1)], x[m], `×${os} sample ${m}`);
    // phase delay = group delay = `delay` base samples at every passband frequency (symmetric FIRs)
    for (const f of [700, 5100, 15000]) {
      const yu = new Float64Array(N * os);
      up.reset(); up.process(sine(N, f, fb), yu, N);
      const r = sineFit(yu, 512 * os, (N - 512) * os, 2 * Math.PI * f / (fb * os));
      const want = -2 * Math.PI * f * up.delay / fb, d = Math.atan2(Math.sin(r.ph - want), Math.cos(r.ph - want));
      assert.ok(Math.abs(d) < 1e-6, `up ×${os} ${f} Hz phase error ${d}`);
      const z = new Float64Array(N);
      dn.reset(); dn.process(sine(N * os, f, fb * os), z, N);
      const q = sineFit(z, 512, N - 512, 2 * Math.PI * f / fb);
      const want2 = -2 * Math.PI * f * dn.delay / fb, d2 = Math.atan2(Math.sin(q.ph - want2), Math.cos(q.ph - want2));
      assert.ok(Math.abs(d2) < 1e-6, `down ×${os} ${f} Hz phase error ${d2}`);
    }
    // DC passes with gain 1 once the rings are full
    const one = new Float64Array(256).fill(1), yd = new Float64Array(256 * os), zd = new Float64Array(256);
    up.reset(); up.process(one, yd, 256);
    dn.reset(); dn.process(yd, zd, 256);
    for (let i = yd.length - os; i < yd.length; i++) assert.ok(Math.abs(yd[i] - 1) < 1e-13, 'up: DC 1 at every phase');
    assert.ok(Math.abs(zd[255] - 1) < 1e-13, 'down: DC 1');
  }
  for (const C of [B.HBUp, B.HBDown]) {
    const h = new C(1), x = Float32Array.from([1, -2, 3.5]), y = new Float64Array(3);
    h.process(x, y, 3);
    assert.deepEqual(Array.from(y), [1, -2, 3.5]);
    assert.equal(h.delay, 0); assert.equal(h.K, 0);
    for (const bad of [0, 3, 32, 1.5, -2, '2', NaN]) assert.throws(() => new C(bad), /osFactor/, String(bad));
  }
});

test('half-band chains: streaming in any block sizes equals one block (bit-identical); reset; allocation-free process', () => {
  const { S, B } = base();
  const rnd = mulberry32(77), N = 1000;
  for (const os of [2, 4, 8]) {
    const x = Float64Array.from({ length: N * os }, () => 2 * rnd() - 1);
    const a = new B.HBUp(os), ya = new Float64Array(N * os);
    a.process(x, ya, N);
    const b = new B.HBUp(os), yb = new Float64Array(N * os);
    for (let o = 0; o < N;) {
      const m = Math.min(N - o, 1 + Math.floor(rnd() * 150)), xs = x.subarray(o, o + m), ys = new Float64Array(m * os);
      noAlloc(S, () => b.process(xs, ys, m));
      yb.set(ys, o * os); o += m;
    }
    assert.deepEqual(yb, ya, `HBUp ×${os} blocks`);
    const c = new B.HBDown(os), za = new Float64Array(N);
    c.process(x, za, N);
    const d = new B.HBDown(os), zb = new Float64Array(N);
    for (let o = 0; o < N;) {
      const m = Math.min(N - o, 1 + Math.floor(rnd() * 150)), xs = x.subarray(o * os, (o + m) * os), zs = new Float64Array(m);
      noAlloc(S, () => d.process(xs, zs, m));
      zb.set(zs, o); o += m;
    }
    assert.deepEqual(zb, za, `HBDown ×${os} blocks`);
    // reset = a fresh instance
    a.reset(); c.reset();
    const y2 = new Float64Array(N * os), z2 = new Float64Array(N);
    a.process(x, y2, N); c.process(x, z2, N);
    assert.deepEqual(y2, ya); assert.deepEqual(z2, za);
  }
});

/* ------------------------------------------------------------------ distortion shapers (§0.3, §8.2, §15.5) */

// The Phase-1 shaper block, taken verbatim from the frozen fx-dsp.js
function refShapers() {
  const a = REF_FX.indexOf('/* ------------------------------------------------------------ Distortion shapers (§8.5.4) */');
  const b = REF_FX.indexOf('// 31-tap half-band', a);
  assert.ok(a > 0 && b > a, 'Phase-1 shaper block found');
  const body = REF_FX.slice(a, b) + '\nreturn { Shaper, shape, LINXS };';
  const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
  return new Function('NXS', 'round', 'clamp01', 'pow', 'tanh', 'exp', 'sin', 'floor', 'sqrt', 'HPI', body)(
    1025, Math.round, clamp01, Math.pow, Math.tanh, Math.exp, Math.sin, Math.floor, Math.sqrt, 0.5 * Math.PI);
}

test('shape: modes 0–15 bit-identical to the Phase-1 fx-dsp shapers (incl. X-Shaper tables, odd drives and modes)', () => {
  const { B } = base();
  const R = refShapers(), rnd = mulberry32(0x5A9E);
  const xsA = Float32Array.from({ length: 1025 }, (_, j) => Math.sin(j / 300) * 0.9), xsB = Float32Array.from({ length: 1025 }, () => rnd() * 2 - 1);
  const drives = [0, 1, 0.5, 1e-9, 0.999, NaN, -0.3, 1.7, 0.25];
  for (let mode = 0; mode <= 15; mode++) {
    const a = new R.Shaper(), b = new B.Shaper(), at = new R.Shaper(), bt = new B.Shaper();
    at.xa = xsA; at.xb = xsB; bt.xa = xsA; bt.xb = xsB;
    for (let k = 0; k < 40; k++) {
      const d = k < drives.length ? drives[k] : rnd();
      a.set(mode, d); b.set(mode, d); at.set(mode, d); bt.set(mode, d);
      for (const f of ['mode', 'G', 'a', 'b', 'd']) assert.ok(Object.is(a[f], b[f]), `mode ${mode} d ${d} ${f}`);
      for (let i = 0; i < 200; i++) {
        const x = i < 5 ? [0, -0, 1, -1, 4][i] : (rnd() - 0.5) * 6;
        const y = R.shape(a, x);
        assert.ok(Object.is(B.shapeS(b, x), y), `shapeS mode ${mode} d ${d} x ${x}`);
        assert.ok(Object.is(B.shape(mode, x, d), y), `shape mode ${mode} d ${d} x ${x}`);
        assert.ok(Object.is(B.shapeS(bt, x), R.shape(at, x)), `X-Shaper tables mode ${mode}`);
      }
    }
  }
  for (const m of [3.4, 7.5, 14.6, -2, NaN]) {             // Phase-1 rounding of non-integer modes below 15.5
    const a = new R.Shaper(), b = new B.Shaper();
    a.set(m, 0.4); b.set(m, 0.4);
    assert.equal(b.mode, a.mode, 'mode ' + m);
    assert.ok(Object.is(B.shape(m, 0.37, 0.4), R.shape(a, 0.37)));
  }
  assert.deepEqual(Array.from(B.LINXS), Array.from(R.LINXS));
});

test('shape: Overdrive (16) and Soft Sat. (17) follow §8.2; clamping; shapeBlock ≡ shapeS; the (mode, d) cache', () => {
  const { S, B } = base();
  const rnd = mulberry32(17);
  for (let k = 0; k < 50; k++) {
    const d = k === 0 ? 0 : k === 1 ? 1 : rnd();
    for (let i = 0; i < 100; i++) {
      const x = (rnd() - 0.5) * 8;
      const G16 = 0.5 * 10 ** d, y16 = 0.9 * Math.tanh(1.8 * G16 * x) / Math.tanh(1.8);
      assert.ok(Math.abs(B.shape(16, x, d) - y16) <= 1e-12, `16 d ${d} x ${x}`);
      const u = 0.5 * 10 ** (0.6 * d) * x, y17 = Math.abs(u) < 1 ? 1.5 * u - 0.5 * u ** 3 : Math.sign(u);
      assert.ok(Math.abs(B.shape(17, x, d) - y17) <= 1e-12, `17 d ${d} x ${x}`);
    }
  }
  assert.equal(B.shape(16, 1e6, 1), 0.9 * Math.tanh(1.8 * 5e6) / Math.tanh(1.8));    // Overdrive tops out at 0.9/tanh(1.8)
  assert.equal(B.shape(17, 3, 0.5), 1); assert.equal(B.shape(17, -3, 0.5), -1); assert.equal(B.shape(17, 0, 0.5), 0);
  const s = new B.Shaper();
  s.set(23, 0.5); assert.equal(s.mode, 17);
  s.set(16.4, 2); assert.equal(s.mode, 16); assert.equal(s.d, 1);
  assert.equal(B.shape(40, 0.3, 0.2), B.shape(17, 0.3, 0.2));
  assert.equal(B.shape(-1, 0.3, 0.2), B.shape(0, 0.3, 0.2));
  // block form: bit-identical, in place on the range only, allocation-free
  const xs = Float32Array.from({ length: 1025 }, () => rnd()), sh = new B.Shaper();
  sh.xa = xs;
  for (let mode = 0; mode <= 17; mode++) {
    sh.set(mode, rnd());
    const x = Float64Array.from({ length: 300 }, () => (rnd() - 0.5) * 5), y = x.slice();
    noAlloc(S, () => B.shapeBlock(sh, y, 10, 280));
    for (let i = 0; i < 300; i++) {
      const want = i >= 10 && i < 290 ? B.shapeS(sh, x[i]) : x[i];
      assert.ok(Object.is(y[i], want), `shapeBlock mode ${mode} i ${i}`);
    }
  }
  // interleaved (mode, d) pairs: the cache never returns a stale curve
  const fresh = (m, x, d) => { const t = new B.Shaper(); t.set(m, d); return B.shapeS(t, x); };
  for (let i = 0; i < 500; i++) {
    const m = Math.floor(rnd() * 18), d = Math.floor(rnd() * 4) / 3, x = (rnd() - 0.5) * 3;
    assert.ok(Object.is(B.shape(m, x, d), fresh(m, x, d)), `cache ${m} ${d}`);
  }
  noAlloc(S, () => { for (let i = 0; i < 100; i++) B.shape(i % 18, 0.1 * i, (i % 7) / 6); });
});

/* ------------------------------------------------------------------ lazy warm-ups (§11.10, §15.5) */

test('warmAdd / warmTick: one job step per call, once per key, never offline, FIFO, failures dropped, ≤ 1 ms', () => {
  const { S, B } = base();
  const log = [];
  const proc = {};
  assert.equal(B.warmTick(proc), 0, 'nothing queued');
  assert.equal(B.warmTick(null), 0);
  let steps = 0;
  assert.equal(B.warmAdd(proc, 'a', () => { log.push('a' + steps); return ++steps < 3; }), true);
  assert.equal(B.warmAdd(proc, 'a', () => { log.push('dup'); return false; }), false, 'one job per key and processor');
  assert.equal(B.warmAdd(proc, 'b', () => { log.push('b'); return false; }), true);
  assert.equal(B.warmAdd(proc, 'c', () => { throw new Error('boom'); }), true);
  assert.equal(B.warmAdd(proc, 'd', () => { log.push('d'); return 0; }), true);
  assert.equal(B.warmAdd(proc, 'e', 'not a function'), false);
  assert.equal(B.warmAdd({ offline: true }, 'a', () => true), false, 'offline processors skip warm-ups');
  assert.equal(B.warmAdd(null, 'a', () => true), false);
  const left = [];
  for (let i = 0; i < 8; i++) left.push(B.warmTick(proc));
  assert.deepEqual(log, ['a0', 'a1', 'a2', 'b', 'd'], 'one step per call, in queue order');
  assert.deepEqual(left, [4, 4, 3, 2, 1, 0, 0, 0], 'jobs left after each call');
  assert.equal(S.logs.filter(m => m.level === 'warn' && /warm-up job failed/.test(m.text)).length, 1);
  assert.equal(B.warmAdd(proc, 'a', () => false), false, 'a finished key stays done');
  assert.equal(B.warmAdd(proc, 'f', () => { log.push('f'); return false; }), true, 'new keys queue after the queue drained');
  assert.equal(B.warmTick(proc), 0);
  assert.deepEqual(log.slice(-1), ['f']);
  // the tick itself: allocation-free and far below 1 ms (a step of a real job: an FFT-2048 round trip)
  const F = new B.FFT(2048), re = new Float64Array(2048), im = new Float64Array(2048);
  let n = 0;
  B.warmAdd(proc, 'fft', () => { F.fwd(re, im); F.inv(re, im); return ++n < 400; });
  const times = [];
  noAlloc(S, () => {
    for (let i = 0; i < 400; i++) { const t0 = performance.now(); B.warmTick(proc); times.push(performance.now() - t0); }
  });
  times.sort((a, b) => a - b);
  assert.equal(n, 400);
  assert.ok(times[200] < 1, 'median tick ' + times[200] + ' ms');
});
