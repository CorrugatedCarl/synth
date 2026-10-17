// sx-warp.js unit tests (owner D3; SPEC-serum2 §15.7, §11.7, §3.4, §6.6). Loads the script through tests/dsp-scope.mjs;
// the Phase-1 reference (tests/ref-p1/serum-dsp.js renderWarp) is the oracle for every Phase-1 formula mode.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../serum-core.js?v=10';
import * as fxc from '../fx-core.js?v=10';
import { dspScope, DSP_TABLE, noAlloc } from './dsp-scope.mjs';

const REF_DSP = readFileSync(new URL('ref-p1/serum-dsp.js', import.meta.url), 'utf8');
const arr = a => Array.from(a);
const load = (opts = {}) => {
  const S = dspScope({ files: ['sx-base.js', 'sx-warp.js'], ...opts });
  return { S, W: S.global('SxWarp'), B: S.global('SxBase') };
};
const refDSP = (() => { let R = null; return () => (R ||= dspScope({ files: ['serum-dsp.js'], overrides: { 'serum-dsp.js': REF_DSP } }).global('SerumDSP')); })();
const warns = S => S.logs.filter(m => m.level === 'warn').map(m => m.text);
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
// DFT magnitude of x at frequency f (Hz) at rate fs, normalised so a full-scale sine reads 1
const amp = (x, f, fs) => {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { const a = 2 * Math.PI * f * i / fs; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); }
  return 2 * Math.hypot(re, im) / x.length;
};
const dB = x => 20 * Math.log10(x);
// magnitude response of an impulse response h at f (Hz)
const H = (h, f, fs) => {
  let re = 0, im = 0;
  for (let i = 0; i < h.length; i++) { const a = 2 * Math.PI * f * i / fs; re += h[i] * Math.cos(a); im -= h[i] * Math.sin(a); }
  return Math.hypot(re, im);
};
// harmonic h amplitude of one cycle (length n)
const harm = (x, h) => amp(x, h, x.length);
const ids = core.WARPS2.map(e => e.id);
const at = id => { const i = ids.indexOf(id); assert.ok(i >= 0, id); return i; };
const P_MODES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 39, 40, 41, 42, 43, 44, 45];
const O_MODES = [9, 16, 17, 18, ...Array.from({ length: 14 }, (_, j) => 19 + j), ...Array.from({ length: 12 }, (_, j) => 46 + j)];
const F_MODES = [33, 34, 35, 36, 37, 38];
const S_MODES = Array.from({ length: 24 }, (_, j) => 58 + j);
// the neutral amount of a mode (null = never neutral)
const neutralW = m => (m === 0 ? 0 : [4, 8, 16, 78, 80].includes(m) ? 0.5 : [9, 10, 69, 70].includes(m) ? null : 0);
const SINE = new Float32Array(2048).map((_, j) => Math.sin(2 * Math.PI * j / 2048));
const RICH = (() => {                                    // every harmonic 1–40 with distinct amplitudes and phases
  const r = rng(5), f = new Float32Array(2048), H = Array.from({ length: 40 }, () => [0.2 + r(), 2 * Math.PI * r()]);
  for (let j = 0; j < 2048; j++) { let y = 0; for (let h = 1; h <= 40; h++) y += H[h - 1][0] / h * Math.sin(2 * Math.PI * h * j / 2048 + H[h - 1][1]); f[j] = 0.5 * y; }
  return f;
})();

/* ------------------------------------------------------------------ loading and shape (§0.3, §11.7) */

test('loads in a bare scope, publishes only the frozen SxWarp with the §11.7 API (names, arities)', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('sx-warp.js');
  assert.deepEqual([...names()].filter(k => !before.has(k)), ['SxWarp']);
  const W = S.global('SxWarp');
  assert.ok(W && Object.isFrozen(W));
  assert.deepEqual(Object.keys(W).sort(), ['DOM', 'FM', 'MAXUNI', 'META', 'MS', 'N', 'NT', 'SP', 'Slots', 'VER', 'chunk',
    'incBlock', 'outBlock', 'pdBlock', 'phaseBlock', 'renderSweep', 'renderWarp2', 'speed', 'incBlockA', 'phaseBlockA', 'outBlockA'].sort());
  assert.equal(W.VER, 1);
  assert.equal(W.N, 82);
  assert.equal(W.MAXUNI, 16);
  const fns = { speed: 3, chunk: 8, incBlock: 11, phaseBlock: 14, outBlock: 12, pdBlock: 9, renderWarp2: 3, renderSweep: 3, Slots: 0,
    incBlockA: 12, phaseBlockA: 15, outBlockA: 13 };
  for (const [k, n] of Object.entries(fns)) {
    assert.equal(typeof W[k], 'function', k);
    assert.equal(W[k].length, n, k + ' arity');
  }
  for (const k of ['DOM', 'SP', 'NT', 'MS', 'FM', 'META']) assert.ok(Object.isFrozen(W[k]), k + ' frozen');
  assert.ok(Object.isFrozen(W.META.ids));
  assert.equal(S.logs.length, 0, 'no console output on load');
});

test('reads no other script\'s global at load; re-evaluation works; a failure inside leaves SxWarp = null', () => {
  const S = dspScope({ files: [] });
  const others = DSP_TABLE.map(e => e[1]).filter(g => g !== 'SxWarp');
  S.run('(function (gs) { for (const g of gs) Object.defineProperty(globalThis, g, { configurable: true,'
    + ' get() { throw new Error("read " + g + " at load"); } }); })', 't.js')(others);
  S.reload('sx-warp.js');
  const W1 = S.global('SxWarp');
  assert.ok(W1 && W1.VER === 1, 'loaded without touching the other globals');
  assert.equal(S.logs.length, 0);
  S.reload('sx-warp.js');                                                    // idempotent re-evaluation
  const W2 = S.global('SxWarp');
  assert.ok(W2 && W2 !== W1 && Object.isFrozen(W2));
  // Slots resolves SxBase lazily (here it throws on read: the Slots must not be created on the render path anyway)
  S.run('(function () { Object.defineProperty(globalThis, "SxBase", { configurable: true, value: null }); })', 't.js')();
  const s = new W2.Slots(4);
  assert.equal(W1.chunk(s, 0, 2, new Float64Array(16).fill(0.5), 0, 0, new Float64Array(16), 48000), 2, 'old functions accept new Slots');
  const F = dspScope({ files: ['sx-warp.js'], overrides: { 'sx-warp.js': src => src.replace('const VER = 1,', 'const VER = (() => { throw new Error("boom"); })(),') } });
  assert.equal(F.global('SxWarp'), null);
  assert.ok(F.logs.some(m => m.level === 'error' && /sx-warp: load failed/.test(m.text)));
});

/* ------------------------------------------------------------------ META (§3.4.1) */

test('META equals serum-core WARPS2 and SxBase (ids, domains, availability); codes match SxBase / FM_TYPES', () => {
  const { W, B } = load();
  const M = W.META;
  assert.equal(core.WARPS2.length, 82);
  assert.deepEqual(arr(M.ids), core.WARPS2.map(e => e.id));
  const DOMC = { '': 0, F: 1, P: 2, O: 3, S: 4 };
  assert.deepEqual(arr(M.dom), core.WARPS2.map(e => DOMC[e.dom]));
  assert.deepEqual(arr(M.avail), core.WARPS2.map(e => (e.avail === 'all' ? 31 : 16)));
  for (const k of ['dom', 'avail', 'speed', 'neutral', 'msrc']) {
    assert.equal(M[k].constructor.name, 'Uint8Array', k);
    assert.equal(M[k].length, 82, k);
  }
  assert.equal(M.dist.constructor.name, 'Int8Array');
  assert.equal(M.dist.length, 82);
  assert.deepEqual(arr(M.ids), arr(B.WARP_IDS2));
  assert.deepEqual(arr(M.dom), arr(B.WARP_DOM));
  assert.deepEqual(arr(M.avail), arr(B.WARP_AVAIL));
  assert.deepEqual({ ...W.DOM }, { ...B.WDOM });
  for (const [k, t] of Object.entries(B.OTYPE)) {
    for (let m = 0; m < 82; m++) {
      const want = core.WARPS2[m].avail === 'all' || (core.WARPS2[m].avail === 'Sp' && k === 'SPEC');
      assert.equal(((M.avail[m] >> t) & 1) === 1, want, `${core.WARPS2[m].id} on ${k}`);
    }
  }
  assert.deepEqual(Object.keys(W.FM), ['TZ', 'EXP', 'LIN']);
  assert.deepEqual(Object.values(W.FM), [0, 1, 2]);
  assert.deepEqual(core.FM_TYPES, ['Thru-Zero', 'Exp', 'Linear']);
  // the kernels' domain lists (used below) follow META
  assert.deepEqual(P_MODES, arr(M.dom).flatMap((d, m) => (d === 2 ? [m] : [])));
  assert.deepEqual(O_MODES.slice().sort((a, b) => a - b), arr(M.dom).flatMap((d, m) => (d === 3 ? [m] : [])));
  assert.deepEqual(F_MODES, arr(M.dom).flatMap((d, m) => (d === 1 ? [m] : [])));
});

test('META speed / neutral / modulator / distortion columns follow the §3.4.1 table', () => {
  const { W } = load();
  const M = W.META, SP = W.SP, NT = W.NT, MS = W.MS;
  const sp = id => M.speed[at(id)];
  assert.equal(sp('off'), SP.ONE);
  assert.equal(sp('sync'), SP.SYNC);
  for (const id of ['bend_p', 'bend_n', 'bend_pn', 'pwm', 'asym_p', 'asym_n', 'asym_pn', 'mirror', 'remap1', 'remap2', 'remap3', 'remap4']) {
    assert.equal(sp(id), SP.P1, id);
  }
  for (const id of ['flip', 'quantize', 'oddeven', 'lpf', 'hpf']) assert.equal(sp(id), SP.ONE, id);
  for (let m = 19; m <= 32; m++) assert.equal(M.speed[m], SP.ONE, ids[m]);
  for (let m = 33; m <= 38; m++) assert.equal(M.speed[m], SP.FM, ids[m]);
  for (let m = 39; m <= 45; m++) assert.equal(M.speed[m], SP.PD, ids[m]);
  for (let m = 46; m <= 57; m++) assert.equal(M.speed[m], SP.ONE, ids[m]);
  for (let m = 58; m <= 81; m++) assert.equal(M.speed[m], SP.NONE, ids[m]);
  const NEU = { off: NT.ALWAYS, sync: NT.W0V0, bend_pn: NT.WHALF, asym_pn: NT.WHALF, oddeven: NT.WHALF, flip: NT.NEVER, mirror: NT.NEVER,
    s_shep: NT.NEVER, s_shepn: NT.NEVER, s_pshift: NT.WHALF, s_shift: NT.WHALF };
  for (let m = 0; m < 82; m++) assert.equal(M.neutral[m], NEU[ids[m]] ?? NT.W0, ids[m]);
  const SUF = { o1: MS.O1, o2: MS.O2, noise: MS.NOISE, sub: MS.SUB, f1: MS.F1, f2: MS.F2, self: MS.SELF };
  for (let m = 0; m < 82; m++) {
    const mod = /^(fm|pd|am|rm|s_voc|s_mask)_(o1|o2|noise|sub|f1|f2|self)$/.exec(ids[m]);
    assert.equal(M.msrc[m], mod ? SUF[mod[2]] : MS.NONE, ids[m]);
  }
  const D = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 13, 14, 15, 17];
  for (let m = 0; m < 82; m++) assert.equal(M.dist[m], m >= 19 && m <= 32 ? D[m - 19] : -1, ids[m]);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace('linear', 'lin').replace('sine', 'sin');
  for (let m = 19; m <= 32; m++) assert.equal(norm(fxc.DIST_MODES2[M.dist[m]]), norm(core.WARPS2[m].name), core.WARPS2[m].name);
  for (let m = 0; m < 82; m++) assert.equal(neutralW(m), M.neutral[m] === NT.NEVER ? null : M.neutral[m] === NT.WHALF ? 0.5 : 0, ids[m]);
});

/* ------------------------------------------------------------------ speed (§3.4.1) */

test('speed(mode, w, fm): the §3.4.1 speed column (Phase-1 warpSetup speeds for the P1 kind)', () => {
  const { W } = load();
  const s = W.speed, eq = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
  eq(s(0, 0.7, 0), 1, 'off');
  eq(s(1, 0.5, 0), 2 ** 2.2, 'sync');
  eq(s(1, 0, 0), 1, 'sync w 0');
  for (const m of [2, 3, 6, 7]) { eq(s(m, 0.4, 0), 2, 'bend/asym ±'); eq(s(m, 0, 0), 1, 'bend/asym neutral'); }
  for (const m of [4, 8]) { eq(s(m, 0.5, 0), 1, '+/- neutral'); eq(s(m, 1, 0), 2 ** 2.5, '+/- 1'); eq(s(m, 0, 0), 2 ** 2.5, '+/- 0'); }
  eq(s(5, 0.5, 0), 1 / (1 - 0.4975), 'pwm');
  eq(s(5, 0, 0), 1, 'pwm neutral');
  eq(s(9, 0.3, 0), 1, 'flip');
  eq(s(10, 0.5, 0), 2, 'mirror at 0.5 (never neutral)');
  eq(s(10, 1, 0), 2 * 2 ** 2.5, 'mirror 1');
  for (const m of [11, 12]) { eq(s(m, 0.3, 0), 2, 'remap 1/2'); eq(s(m, 0, 0), 1, 'remap neutral'); }
  eq(s(13, 0.5, 0), 1.45, 'remap 3');
  eq(s(14, 0.2, 0), 4, 'remap 4');
  eq(s(15, 0.9, 0), 1, 'quantize');
  for (const m of [16, 17, 18, 19, 32, 46, 57]) eq(s(m, 0.8, 0), 1, 'output domain ' + m);
  for (let m = 33; m <= 38; m++) {
    eq(s(m, 0.5, 0), 3, 'FM thru-zero'); eq(s(m, 0.5, 2), 3, 'FM linear'); eq(s(m, 0.5, 1), 4, 'FM exp'); eq(s(m, 0, 1), 1, 'FM 0');
  }
  for (const m of [39, 40, 41, 43, 44]) eq(s(m, 1, 0), 1 + 6.3 * 3, 'PD');
  eq(s(42, 1, 0), 1 + 6.3 * 4, 'PD sub');
  eq(s(45, 1, 0), 1 + 6.3 * 1.5, 'PD self');
  eq(s(39, 0.25, 0), 1 + 6.3 * 3 * 0.125, 'PD w^1.5');
  for (let m = 58; m < 82; m++) eq(s(m, 0.7, 0), 1, 'spectral');
  for (const m of [-1, 82, 2.5, NaN, '3', null]) eq(s(m, 0.5, 0), 1, 'invalid mode ' + m);
  eq(s(1, 2, 0), s(1, 1, 0), 'w clamped high');
  eq(s(1, -1, 0), 1, 'w clamped low');
  eq(s(1, NaN, 0), 1, 'w NaN');
});

/* ------------------------------------------------------------------ Slots, chunk (§11.7) */

test('Slots(maxUni): shapes, bytes, reset; an invalid maxUni falls back to 16 with one warning', () => {
  const { S, W } = load();
  const a = new W.Slots();
  assert.equal(a.maxUni, 16);
  const want = { mode: ['Uint8Array', 2], hw: ['Uint8Array', 2], em: ['Uint8Array', 32], sp: ['Float64Array', 32], pdI: ['Float64Array', 32],
    y1: ['Float64Array', 16] };
  for (const [k, [t, n]] of Object.entries(want)) {
    assert.equal(a[k].constructor.name, t, k);
    assert.equal(a[k].length, n, k);
  }
  assert.ok(arr(a.sp).every(x => x === 1));
  assert.ok(arr(a.em).every(x => x === 0) && arr(a.pdI).every(x => x === 0));
  const b = new W.Slots(4);
  assert.equal(b.maxUni, 4);
  assert.equal(b.em.length, 8); assert.equal(b.sp.length, 8); assert.equal(b.y1.length, 4);
  assert.ok(!('dz' in a), 'no Spectral integrator field (SxSpec keeps its own Δ state)');
  assert.ok(a.bytes > b.bytes && b.bytes > 0);
  const own = o => Object.values(o).filter(v => ArrayBuffer.isView(v)).reduce((n, v) => n + v.byteLength, 0);
  assert.equal(a.bytes, own(a));
  assert.equal(b.bytes, own(b));
  assert.ok(a.bytes < 8192, 'a few KB per oscillator per voice (' + a.bytes + ')');
  b.y1.fill(0.5); b.st.fill(-0.25);
  b.reset();
  assert.ok(arr(b.y1).every(x => x === 0) && arr(b.st).every(x => x === 0));
  for (const bad of [0, 17, 2.5, NaN, 'x', -3]) assert.equal(new W.Slots(bad).maxUni, 16, String(bad));
  assert.equal(warns(S).length, 1, 'one warning per kind per scope');
});

test('chunk: em / sp / hw / pdI per unison voice follow the neutral column and speed(); nu; returns the effective mode', () => {
  const { S, W } = load();
  const sl = new W.Slots(), fi = new Float64Array(16).fill(220);
  const w = new Float64Array(16);
  for (let m = 0; m < 82; m++) {
    for (const k of [0, 1]) {
      for (let i = 0; i < 16; i++) w[i] = [0, 0.5, 0.25, 1, 1e-7][i % 5];
      const v = (m + k) % 3 === 0 ? 0 : 0.4, fm = m % 3;
      const r = W.chunk(sl, k, m, w, v, fm, fi, 96000);
      assert.equal(sl.mode[k], m);
      let any = 0;
      for (let i = 0; i < 16; i++) {
        const wi = w[i], nw = neutralW(m);
        let neut = m === 0 || (nw !== null && wi === nw);
        if (m === 1) neut = wi === 0 && v === 0;                              // Sync: w = 0 and Var = 0
        if (m === 15) neut = wi < 1e-6;                                       // Quantize: Phase-1 rule
        const e = neut ? 0 : m;
        any |= e;
        assert.equal(sl.em[k * 16 + i], e, `mode ${m} slot ${k} voice ${i} (w ${wi})`);
        assert.equal(sl.sp[k * 16 + i], e ? W.speed(m, wi, fm) : 1);
        assert.equal(sl.pdI[k * 16 + i], e === 45 ? 1.5 * wi * Math.sqrt(wi) : 0);
      }
      assert.equal(r, any ? m : 0);
      assert.equal(sl.hw[k], m === 1 && v > 0 ? 1 : 0);
    }
  }
  // nu: voices ≥ nu are reported Off; shorter vectors are enough
  W.chunk(sl, 0, 2, new Float64Array(3).fill(0.5), 0, 0, new Float64Array(3).fill(100), 48000, 3);
  assert.deepEqual(arr(sl.em).slice(0, 16), [2, 2, 2, ...Array(13).fill(0)]);
  assert.deepEqual(arr(sl.sp).slice(3, 16), Array(13).fill(1));
  assert.equal(warns(S).length, 0, 'valid arguments: no warnings');
  // Off (mode 0) needs no vectors and costs O(1)
  assert.equal(W.chunk(sl, 1, 0, null, 0, 0, null, 0), 0);
  assert.ok(arr(sl.em).slice(16).every(x => x === 0) && arr(sl.sp).slice(16).every(x => x === 1));
  // invalid arguments: the slot acts as Off (mode recorded 0), one warning per kind
  const w7 = new Float64Array(16).fill(0.7);
  const cases = [
    () => W.chunk(sl, 0, 82, w7, 0, 0, fi, 48000), () => W.chunk(sl, 0, 2.5, w7, 0, 0, fi, 48000), () => W.chunk(sl, 0, NaN, w7, 0, 0, fi, 48000),
    () => W.chunk(sl, 0, 5, new Float64Array(8), 0, 0, fi, 48000), () => W.chunk(sl, 0, 5, w7, 0, 0, null, 48000),
    () => W.chunk(sl, 0, 5, w7, 0, 0, fi, 0), () => W.chunk(sl, 0, 5, w7, 0, 0, fi, NaN),
  ];
  for (const c of cases) { sl.mode[0] = 7; assert.equal(c(), 0); assert.equal(sl.mode[0], 0); assert.ok(arr(sl.em).slice(0, 16).every(x => x === 0)); }
  assert.equal(W.chunk({}, 0, 5, w7, 0, 0, fi, 48000), 0);
  assert.equal(W.chunk(sl, 2, 5, w7, 0, 0, fi, 48000), 0);
  assert.equal(W.chunk(null, 0, 5, w7, 0, 0, fi, 48000), 0);
  assert.equal(warns(S).length, 5, 'mode, vectors, fs, slots, k: one warning each');
  // Var clamped, FM type 0–2 (else 0)
  W.chunk(sl, 0, 1, w7, 3, 2, fi, 48000); assert.equal(sl.v[0], 1); assert.equal(sl.fm[0], 2);
  W.chunk(sl, 0, 1, w7, -1, 7, fi, 48000); assert.equal(sl.v[0], 0); assert.equal(sl.fm[0], 0);
  W.chunk(sl, 0, 1, w7, NaN, 1, fi, 48000); assert.equal(sl.v[0], 0); assert.equal(sl.fm[0], 1);
});

test('without SxBase the distortion warps act as Off (one warning); every other mode works', () => {
  const S = dspScope({ files: ['sx-warp.js'] });
  const W = S.global('SxWarp');
  assert.equal(S.global('SxBase'), undefined);
  const sl = new W.Slots(2), w = new Float64Array(2).fill(0.8), fi = new Float64Array(2).fill(200);
  for (let m = 19; m <= 32; m++) assert.equal(W.chunk(sl, 0, m, w, 0, 0, fi, 48000), 0, ids[m]);
  assert.equal(warns(S).length, 1);
  const x = new Float64Array(32).map((_, s) => Math.sin(s)), x0 = x.slice();
  assert.equal(W.outBlock(sl, 0, 0, 19, 0.8, 0, null, 0, x, null, null, 32), 0);
  assert.deepEqual(arr(x), arr(x0));
  assert.equal(W.chunk(sl, 0, 17, w, 0, 0, fi, 48000), 17);
  assert.equal(W.outBlock(sl, 0, 0, 17, 0.8, 0, null, 0, x, null, null, 32), 1);
  assert.notDeepEqual(arr(x), arr(x0));
});

/* ------------------------------------------------------------------ neutral amounts (§3.4.1 last column, §0.7) */

test('every WARPS2 mode at its neutral amount is bit-identical to Off (chunk, kernels and renderWarp2)', () => {
  const { W } = load();
  const r = rng(9), CH = 32, sl = new W.Slots(4);
  const fill = a => { for (let s = 0; s < a.length; s++) a[s] = 2 * r() - 1; return a; };
  const remap = new Float32Array(3 * 2049).map((_, j) => ((j % 2049) / 2048) ** 1.5), mod = fill(new Float64Array(4 * 32));
  const off = W.renderWarp2(RICH, [], { over: 2 });
  for (let m = 1; m < 82; m++) {
    const nw = neutralW(m);
    if (nw === null) continue;
    const w = new Float64Array(4).fill(nw);
    assert.equal(W.chunk(sl, 0, m, w, 0, m % 3, new Float64Array(4).fill(330), 96000), 0, ids[m]);
    for (let i = 0; i < 4; i++) {
      const inc = fill(new Float64Array(CH)), inc0 = inc.slice(), ph = new Float64Array(CH).map(() => r()), ph0 = ph.slice();
      const x = fill(new Float64Array(CH)), x0 = x.slice(), x2 = fill(new Float64Array(CH)), win = fill(new Float64Array(CH)), win0 = win.slice();
      assert.equal(W.incBlock(sl, 0, i, m, m % 3, nw, mod, 4, inc, inc, CH), 0);
      assert.equal(W.phaseBlock(sl, 0, i, m, nw, 0, remap, 2049, mod, 4, ph, ph, win, CH), 0);
      assert.equal(W.outBlock(sl, 0, i, m, nw, 0, mod, 4, x, x2, ph, CH), 0);
      assert.deepEqual(arr(inc), arr(inc0)); assert.deepEqual(arr(ph), arr(ph0)); assert.deepEqual(arr(x), arr(x0)); assert.deepEqual(arr(win), arr(win0));
    }
    if (m < 58) {
      const got = W.renderWarp2(RICH, [{ mode: m, w: nw, v: 0, fm: m % 3 }, { mode: m, w: nw }], { over: 2, remap: remap.subarray(0, 2049), mod: SINE });
      assert.deepEqual(arr(got), arr(off), 'renderWarp2 ' + ids[m]);
    }
  }
  // Sync is neutral only with Var 0
  const w0 = new Float64Array(4);
  assert.equal(W.chunk(sl, 0, 1, w0, 0.25, 0, w0, 48000), 1);
});

/* ------------------------------------------------------------------ Phase-1 formulas (§6.6.3, §15.7) */

test('Phase-1 formula modes equal the Phase-1 renderWarp bit for bit (Sync, Bend, PWM, Asym, Flip, Mirror, Remap, Quantize, PD, AM, RM)', () => {
  const { W } = load();
  const R = refDSP();
  const remap = new Float32Array(2049).map((_, j) => (j / 2048) ** 2), mod = new Float32Array(2048).map((_, j) => Math.sin(2 * Math.PI * 3 * j / 2048));
  // WARPS2 index → Phase-1 WARPS index (§6.6.3; PD = the Phase-1 FM law, AM/RM the Phase-1 formulas)
  const MAP = { 1: 1, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 9, 8: 10, 9: 11, 10: 12, 11: 13, 12: 14, 13: 15, 14: 16, 15: 17,
    39: 18, 40: 18, 41: 21, 43: 18, 44: 18, 42: 22, 46: 19, 47: 19, 48: 19, 49: 19, 50: 19, 51: 19, 52: 20, 53: 20, 54: 20, 55: 20, 56: 20, 57: 20 };
  for (const [m2, m1] of Object.entries(MAP)) {
    for (const w of [0, 0.13, 0.5, 0.77, 1]) {
      for (const over of [1, 2]) {
        const opts = { over, remap, mod };
        assert.deepEqual(arr(W.renderWarp2(RICH, [{ mode: +m2, w }], opts)), arr(R.renderWarp(RICH, m1, w, opts)), `${ids[m2]} w ${w} over ${over}`);
      }
    }
  }
  // without opts.mod: m = 0 with the mode active (Phase-1 §8.4.2 convention)
  for (const [m2, m1] of [[46, 19], [52, 20], [39, 18]]) {
    assert.deepEqual(arr(W.renderWarp2(RICH, [{ mode: m2, w: 0.6 }], {})), arr(R.renderWarp(RICH, m1, 0.6, {})), ids[m2] + ' no mod');
  }
  // the same transforms in slot 2 (slot 1 Off)
  assert.deepEqual(arr(W.renderWarp2(RICH, [null, { mode: 2, w: 0.4 }], { over: 2 })), arr(R.renderWarp(RICH, 4, 0.4, { over: 2 })));
});

test('Sync with Var: v = 0 equals Phase-1 Sync, v = 1 Phase-1 Sync Window, linear blend in between (§6.6.2)', () => {
  const { W } = load();
  const R = refDSP();
  for (const w of [0, 0.25, 0.6, 1]) {
    const hard = arr(R.renderWarp(RICH, 1, w, { over: 2 })), win = arr(R.renderWarp(RICH, 3, w, { over: 2 }));
    if (w > 0) assert.deepEqual(arr(W.renderWarp2(RICH, [{ mode: 1, w, v: 0 }], { over: 2 })), hard, 'v 0, w ' + w);
    assert.deepEqual(arr(W.renderWarp2(RICH, [{ mode: 1, w, v: 1 }], { over: 2 })), win, 'v 1, w ' + w);
    const mid = W.renderWarp2(RICH, [{ mode: 1, w, v: 0.35 }], { over: 2 });
    for (let j = 0; j < mid.length; j++) assert.ok(Math.abs(mid[j] - (0.65 * hard[j] + 0.35 * win[j])) < 1e-6, `blend w ${w} j ${j}`);
  }
  // both slots Sync with Var: the windows multiply
  const two = W.renderWarp2(SINE, [{ mode: 1, w: 0, v: 1 }, { mode: 1, w: 0, v: 1 }], {});
  const one = W.renderWarp2(SINE, [{ mode: 1, w: 0, v: 1 }], {});
  for (let j = 0; j < 2048; j += 97) {
    const s2 = Math.sin(Math.PI * j / 2048) ** 2;
    assert.ok(Math.abs(two[j] - one[j] * s2) < 1e-6, 'window² at ' + j);
  }
});

/* ------------------------------------------------------------------ Odd/Even (§3.4.1) */

test('Odd/Even: 0 keeps only odd harmonics, 1 only even harmonics (≤ −100 dB), 0.5 is the original', () => {
  const { W } = load();
  const n = 2048;
  const ref = W.renderWarp2(RICH, [], {});
  const odd = W.renderWarp2(RICH, [{ mode: 16, w: 0 }], {}), even = W.renderWarp2(RICH, [{ mode: 16, w: 1 }], {});
  const top = Math.max(...Array.from({ length: 40 }, (_, h) => harm(ref, h + 1)));
  for (let h = 1; h <= 40; h++) {
    const a = harm(ref, h), o = harm(odd, h), e = harm(even, h);
    if (h % 2) {
      assert.ok(Math.abs(o - a) < 1e-4 * top, `odd ${h} kept`);
      assert.ok(dB(e / top) < -100, `odd ${h} removed by Even (${dB(e / top).toFixed(1)} dB)`);
    } else {
      assert.ok(Math.abs(e - a) < 1e-4 * top, `even ${h} kept`);
      assert.ok(dB(o / top) < -100, `even ${h} removed by Odd (${dB(o / top).toFixed(1)} dB)`);
    }
  }
  assert.deepEqual(arr(W.renderWarp2(RICH, [{ mode: 16, w: 0.5 }], {})), arr(ref), 'neutral at 0.5');
  // in between: the odd part fades in / the even part fades
  const q = W.renderWarp2(RICH, [{ mode: 16, w: 0.25 }], {});
  assert.ok(Math.abs(harm(q, 2) - 0.5 * harm(ref, 2)) < 1e-4 && Math.abs(harm(q, 3) - harm(ref, 3)) < 1e-4);
  assert.equal(n, odd.length);
});

test('Odd/Even in slot 2 after an O-domain slot 1 still separates the harmonics of O₁(x) (≤ −100 dB): x2 runs through slot 1', () => {
  const { W } = load();
  // every O mode that is a function of the cycle (AM/RM with m = null are constant gains)
  const firsts = [[19, 1], [20, 0.4], [21, 0.03], [30, 0.5], [32, 0.7], [17, 0.5], [18, 0.4], [46, 1], [52, 0.6], [9, 0.3], [16, 0.3], [16, 0.8]];
  for (const [m1, w1] of firsts) {
    const ref = W.renderWarp2(RICH, [{ mode: m1, w: w1 }], {});
    const odd = W.renderWarp2(RICH, [{ mode: m1, w: w1 }, { mode: 16, w: 0 }], {});
    const even = W.renderWarp2(RICH, [{ mode: m1, w: w1 }, { mode: 16, w: 1 }], {});
    const top = Math.max(...Array.from({ length: 60 }, (_, h) => harm(ref, h + 1)));
    for (let h = 1; h <= 60; h++) {
      const a = harm(ref, h), o = harm(odd, h), e = harm(even, h);
      if (h % 2) {
        assert.ok(Math.abs(o - a) < 1e-6 * top + 1e-9, `${ids[m1]} → Odd: odd ${h} kept`);
        assert.ok(dB(e / top) < -100, `${ids[m1]} → Even: odd ${h} at ${dB(e / top).toFixed(1)} dB`);
      } else {
        assert.ok(Math.abs(e - a) < 1e-6 * top + 1e-9, `${ids[m1]} → Even: even ${h} kept`);
        assert.ok(dB(o / top) < -100, `${ids[m1]} → Odd: even ${h} at ${dB(o / top).toFixed(1)} dB`);
      }
    }
  }
  // the kernel contract: slot 0 processes x2 only when slot 1 of the voice is Odd/Even; slot 1 never touches x2
  const sl = new W.Slots(2), w = new Float64Array(2).fill(1), fi = new Float64Array(2).fill(100);
  W.chunk(sl, 0, 19, w, 0, 0, fi, 48000); W.chunk(sl, 1, 16, new Float64Array([0, 0.5]), 0, 0, fi, 48000);   // voice 1: Odd/Even neutral
  const x = new Float64Array(8).fill(0.5), x2 = new Float64Array(8).fill(0.5);
  W.outBlock(sl, 0, 0, 19, 1, 0, null, 0, x, x2, null, 8);
  assert.ok(x2.every((v, k) => v === x[k]) && x[0] !== 0.5, 'voice 0 (slot 2 Odd/Even): x2 shaped like x (shaper and DC blocker)');
  const y = new Float64Array(8).fill(0.5), y2 = new Float64Array(8).fill(0.5);
  W.outBlock(sl, 0, 1, 19, 1, 0, null, 0, y, y2, null, 8);
  assert.ok(y2.every(v => v === 0.5), 'voice 1 (slot 2 neutral): x2 untouched');
  W.chunk(sl, 0, 16, w, 0, 0, fi, 48000); W.chunk(sl, 1, 19, w, 0, 0, fi, 48000);
  const z = new Float64Array(8).fill(0.5), z2 = new Float64Array(8).fill(0.25);
  W.outBlock(sl, 1, 0, 19, 1, 0, null, 0, z, z2, null, 8);
  assert.ok(z2.every(v => v === 0.25), 'slot 1 never touches x2');
});

/* ------------------------------------------------------------------ FM (§3.4.1, §6.6.4) */

// voice-path FM: sine carrier at fc driven through incBlock (blocks of 32) by a sine modulator at fmod
function fmRender(W, fm, w, fc, fmod, fs, len) {
  const sl = new W.Slots(1), W1 = new Float64Array(1).fill(w), FI = new Float64Array(1).fill(fc);
  W.chunk(sl, 0, 33, W1, 0, fm, FI, fs);
  const out = new Float64Array(len), inc = new Float64Array(32), m = new Float64Array(32);
  let ph = 0, minInc = Infinity;
  for (let j0 = 0; j0 < len; j0 += 32) {
    const L = Math.min(32, len - j0);
    for (let s = 0; s < L; s++) { inc[s] = fc / fs; m[s] = Math.sin(2 * Math.PI * fmod * (j0 + s) / fs); }
    W.incBlock(sl, 0, 0, 33, fm, w, m, 1, inc, inc, L);
    for (let s = 0; s < L; s++) { out[j0 + s] = Math.sin(2 * Math.PI * ph); ph += inc[s]; ph -= Math.floor(ph); minInc = Math.min(minInc, inc[s]); }
  }
  return { out, minInc };
}
const bessel = (k, x) => { let s = 0, f = 1; for (let m = 0; m < 30; m++) { if (m > 0) f *= m; let g = 1; for (let j = 1; j <= m + k; j++) g *= j; s += (m % 2 ? -1 : 1) * (x / 2) ** (2 * m + k) / (f * g); } return s; };

test('FM Thru-Zero and Linear: sideband amplitudes J_k(β) within 0.5 dB at index 1 and 2; Exp: sidebands at f̄ ± k·fm', () => {
  const { W } = load();
  const fs = 48000, fc = 1000, fmod = 300, len = 48000;                    // 1 s: every component on an integer bin
  for (const fm of [0, 2]) {
    for (const beta of [1, 2]) {
      const w = Math.sqrt(beta * fmod / fc / 8);                            // β = 8w²·fc/fmod
      const { out } = fmRender(W, fm, w, fc, fmod, fs, len);
      for (let k = 0; k <= 3; k++) {
        const want = Math.abs(bessel(k, beta));
        for (const f of k ? [fc - k * fmod, fc + k * fmod] : [fc]) {
          const got = amp(out, f, fs);
          assert.ok(Math.abs(dB(got / want)) < 0.5, `fm ${fm} β ${beta} k ${k} at ${f} Hz: ${dB(got).toFixed(2)} vs ${dB(want).toFixed(2)} dB`);
        }
      }
    }
  }
  // Exp: the spectrum is a line spectrum at f̄ ± k·fmod, f̄ = fc·I0(b·ln 2) (mean of 2^(b·sin))
  const w = 0.3, b = 4 * w, { out } = fmRender(W, 1, w, fc, fmod, fs, len);
  let I0 = 0; for (let m = 0; m < 30; m++) { let f = 1; for (let j = 1; j <= m; j++) f *= j; I0 += ((b * Math.LN2 / 2) ** (2 * m)) / (f * f); }
  const fbar = fc * I0;
  let e = 0; for (const x of out) e += x * x; e /= out.length;
  let lines = 0;
  for (let k = -12; k <= 12; k++) { const f = Math.abs(fbar + k * fmod); lines += amp(out, f, fs) ** 2 / 2; }
  assert.ok(lines / e > 0.97, `Exp FM energy at f̄ ± k·fm: ${(100 * lines / e).toFixed(1)} % (f̄ ${fbar.toFixed(1)} Hz)`);
});

test('FM: Linear never runs backwards, Thru-Zero does; Exp g = 2^(4w·m); m null ⇒ identity', () => {
  const { W } = load();
  const tz = fmRender(W, 0, 1, 1000, 300, 48000, 4800), lin = fmRender(W, 2, 1, 1000, 300, 48000, 4800);
  assert.ok(tz.minInc < 0, 'thru-zero increments go negative');
  assert.ok(lin.minInc >= 0, 'linear clamps at 0');
  const sl = new W.Slots(2), w = new Float64Array(2).fill(0.4), fi = new Float64Array(2);
  W.chunk(sl, 1, 35, w, 0, 1, fi, 48000);
  const m = new Float64Array([0.5, -1, 0, 1]), inc = new Float64Array([1, 2, 3, 4]), out = new Float64Array(4);
  assert.equal(W.incBlock(sl, 1, 1, 35, 1, 0.4, m, 0, inc, out, 4), 1);
  for (let s = 0; s < 4; s++) assert.ok(Math.abs(out[s] / (inc[s] * 2 ** (1.6 * 0.5)) - 1) < 1e-8, 'mStride 0 reads m[0]');
  assert.equal(W.incBlock(sl, 1, 1, 35, 1, 0.4, null, 1, inc, out, 4), 1);
  assert.deepEqual(arr(out), [1, 2, 3, 4]);
});

/* ------------------------------------------------------------------ distortion and filter warps (§6.6.5) */

test('distortion warps equal the SxBase FX shapers at w = 1, blend min(1, 10w) below, then the 5 Hz DC blocker; Stomp Box keeps HP/LP state per voice (tanh curves: the rational tanh, ≤ 2.5e-4)', () => {
  const { W, B } = load();
  const r = rng(21), fs = 96000, sl = new W.Slots(3), fi = new Float64Array(3).fill(100);
  const x0 = new Float64Array(200).map(() => 1.5 * (2 * r() - 1));
  for (let m = 19; m <= 32; m++) {
    const dm = W.META.dist[m];
    for (const w of [1, 0.05, 0.3]) {
      W.chunk(sl, 0, m, new Float64Array(3).fill(w), 0, 0, fi, fs);
      sl.reset();
      const x = x0.slice();
      for (let o = 0; o < 200; o += 32) assert.equal(W.outBlock(sl, 0, 2, m, w, 0, null, 0, x.subarray(o, o + 32), null, null, Math.min(32, 200 - o)), 1);
      // reference: the FX shaper (Stomp Box: one-pole HP 720 Hz → shaper → one-pole LP 6 kHz at fs), the blend, then
      // the Phase-1 Distortion module's DC blocker y = x − x₁ + R·y₁, R = 1 − 2π·5/fs (RULINGS2 D3)
      const hpA = Math.exp(-2 * Math.PI * 720 / fs), lpK = 1 - Math.exp(-2 * Math.PI * 6000 / fs), bl = Math.min(1, 10 * w);
      const R = 1 - 2 * Math.PI * 5 / fs;
      let hx = 0, hy = 0, ly = 0, dx = 0, dy = 0;
      for (let s = 0; s < 200; s++) {
        const xs = x0[s];
        let d;
        if (dm === 14) { hy = hpA * (hy + xs - hx); hx = xs; ly += lpK * (B.shape(14, hy, w) - ly); d = ly; } else d = B.shape(dm, xs, w);
        const v = bl === 1 ? d : xs + (d - xs) * bl, want = v - dx + R * dy;
        dx = v; dy = want;
        // Tube, Asym, Stomp Box and Soft Sat. use the warp's clamped rational tanh (|error| ≤ 9.7e-5; the DC blocker at
        // most doubles it); every other curve is SxBase's own
        const tol = dm === 0 || dm === 9 || dm === 14 || dm === 16 ? 2.5e-4 : 1e-12;
        assert.ok(Math.abs(x[s] - want) < tol, `${ids[m]} w ${w} s ${s}: ${x[s]} vs ${want}`);
      }
    }
  }
  // Stomp Box state is per unison voice: voice 0 and voice 1 processed alternately equal voices processed alone
  W.chunk(sl, 1, 30, new Float64Array(3).fill(0.7), 0, 0, fi, fs);
  sl.reset();
  const a = x0.slice(0, 64), b = x0.slice(64, 128);
  const A = a.slice(), Bv = b.slice();
  W.outBlock(sl, 1, 0, 30, 0.7, 0, null, 0, A.subarray(0, 32), null, null, 32);
  W.outBlock(sl, 1, 1, 30, 0.7, 0, null, 0, Bv.subarray(0, 32), null, null, 32);
  W.outBlock(sl, 1, 0, 30, 0.7, 0, null, 0, A.subarray(32), null, null, 32);
  W.outBlock(sl, 1, 1, 30, 0.7, 0, null, 0, Bv.subarray(32), null, null, 32);
  sl.reset();
  const A2 = a.slice();
  W.outBlock(sl, 1, 0, 30, 0.7, 0, null, 0, A2, null, null, 64);
  assert.deepEqual(arr(A), arr(A2));
});

test('distortion warps leave no DC (RULINGS2 D3): the voice path settles to zero mean; renderWarp2 removes it exactly, also through two distortion slots', () => {
  const { W } = load();
  const hz = 220, n = 2048, fs = hz * n, sine = new Float32Array(2048).map((_, j) => Math.sin(2 * Math.PI * j / 2048));
  const mean = a => { let m = 0; for (const v of a) m += v; return m / a.length; };
  for (const [m, w] of [[28, 1], [19, 1], [30, 0.8], [27, 0.6]]) {               // Rectify, Tube, Stomp Box, Asym
    const raw = W.renderWarp2(sine, [{ mode: m, w }], { hz });
    assert.ok(Math.abs(mean(raw)) < 1e-6, `${ids[m]}: renderWarp2 mean ${mean(raw)}`);
    // the voice: 2 s at 220 Hz from a fresh note — the cycle mean decays with the 5 Hz pole (τ ≈ 32 ms)
    const sl = new W.Slots(1), x = new Float64Array(32), last = new Float64Array(n);
    W.chunk(sl, 0, m, new Float64Array([w]), 0, 0, new Float64Array([hz]), fs);
    sl.reset();
    let first = 0;
    const N = 2 * hz * n;
    for (let j0 = 0; j0 < N; j0 += 32) {
      for (let s = 0; s < 32; s++) x[s] = sine[(j0 + s) % 2048];
      W.outBlock(sl, 0, 0, m, w, 0, null, 0, x, null, null, 32);
      for (let s = 0; s < 32; s++) { const j = j0 + s; if (j < n) first += x[s] / n; if (j >= N - n) last[j - (N - n)] = x[s]; }
    }
    assert.ok(Math.abs(mean(last)) < 1e-5 && Math.abs(mean(last)) < 0.01 * Math.abs(first), `${ids[m]}: voice cycle mean ${first.toFixed(4)} → ${mean(last).toExponential(2)}`);
    // the settled voice ≈ renderWarp2: a 5 Hz one-pole high-pass differs from an ideal DC block by |5/(j·f + 5)| at a
    // harmonic f (2.3 % of the 220 Hz fundamental, less above) — bounded by 5 % of the peak here
    assert.ok(maxDiff(raw, last) < 0.05 * Math.max(...raw.map(Math.abs)), `${ids[m]}: settled voice vs renderWarp2 ${maxDiff(raw, last)}`);
  }
  const two = W.renderWarp2(sine, [{ mode: 28, w: 1 }, { mode: 19, w: 1 }], { hz });
  assert.ok(Math.abs(mean(two)) < 1e-6, 'Rectify → Tube: mean ' + mean(two));
  // no distortion slot: unchanged (one pass)
  assert.deepEqual(arr(W.renderWarp2(sine, [{ mode: 17, w: 0.5 }], { hz })), arr(W.renderWarp2(sine, [{ mode: 17, w: 0.5 }, null], { hz })));
});

test('LPF / HPF warps: TPT SVF, −3 dB at f·2^(10(1−w)) / f·2^(10w − 3) (±5 %), per-voice state; Off → on starts clean', () => {
  const { W } = load();
  const fs = 96000, f0 = 200, n = 32768;
  // (the impulse at sample 1: the LPF state starts from the DC steady state of the first input sample, here 0)
  const resp = (mode, w) => {
    const sl = new W.Slots(1);
    W.chunk(sl, 0, mode, new Float64Array(1).fill(w), 0, 0, new Float64Array(1).fill(f0), fs);
    const h = new Float64Array(n + 1); h[1] = 1;
    for (let o = 0; o <= n; o += 32) W.outBlock(sl, 0, 0, mode, w, 0, null, 0, h.subarray(o, Math.min(o + 32, n + 1)), null, null, Math.min(32, n + 1 - o));
    return h.subarray(1);
  };
  for (const [mode, w] of [[17, 0.4], [17, 0.75], [18, 0.5], [18, 0.6]]) {
    const fc = mode === 17 ? f0 * 2 ** (10 * (1 - w)) : f0 * 2 ** (10 * w - 3), h = resp(mode, w);
    // find the −3 dB point by bisection on log-frequency
    const g = f => dB(H(h, f, fs));
    let lo = fc / 2, hi = Math.min(2 * fc, 0.49 * fs);
    for (let it = 0; it < 30; it++) { const mid = Math.sqrt(lo * hi); if ((g(mid) > -3.0103) === (mode === 17)) lo = mid; else hi = mid; }
    assert.ok(Math.abs(lo / fc - 1) < 0.05, `${ids[mode]} w ${w}: −3 dB at ${lo.toFixed(1)} Hz, expected ${fc.toFixed(1)}`);
    const pass = mode === 17 ? fc / 16 : Math.min(16 * fc, 0.4 * fs), stop = mode === 17 ? Math.min(8 * fc, 0.45 * fs) : fc / 8;
    assert.ok(Math.abs(g(pass)) < 0.1, 'passband');
    assert.ok(g(stop) < -30, 'stopband 12 dB/oct');
  }
  // a voice switching Off → LPF restarts its state (nothing stale) from the DC steady state of its first input
  const sl = new W.Slots(1), FI = new Float64Array(1).fill(f0);
  W.chunk(sl, 0, 17, new Float64Array(1).fill(0.5), 0, 0, FI, fs);
  const x = new Float64Array(32).fill(1);
  W.outBlock(sl, 0, 0, 17, 0.5, 0, null, 0, x, null, null, 32);
  assert.ok(x.every(v => Math.abs(v - 1) < 1e-15), 'a constant input passes from the first sample (no step from the dry signal)');
  W.chunk(sl, 0, 17, new Float64Array(1).fill(0), 0, 0, FI, fs);             // neutral: skipped
  W.chunk(sl, 0, 17, new Float64Array(1).fill(0.5), 0, 0, FI, fs);
  const z = new Float64Array(32);
  W.outBlock(sl, 0, 0, 17, 0.5, 0, null, 0, z, null, null, 32);
  assert.ok(z.every(v => v === 0), 'no stale state after Off → on');
  // an amount touching 0 (a unipolar LFO): Off ↔ LPF toggles every 5 ms on a 220 Hz sine leave no transient (e17)
  const fsx = 96000, N = fsx, U = 1, sl2 = new W.Slots(U), y = new Float64Array(N), ref = new Float64Array(N), CHx = 8;
  const fi2 = new Float64Array(1).fill(220), sl3 = new W.Slots(U);
  for (let o = 0; o < N; o += CHx) {
    const on = Math.floor(o / 480) % 2 === 1, wv = on ? 0.02 : 0;
    const a = new Float64Array(CHx).map((_, s) => 0.8 * Math.sin(2 * Math.PI * 220 * (o + s) / fsx)), b = a.slice();
    if (W.chunk(sl2, 0, 17, new Float64Array(1).fill(wv), 0, 0, fi2, fsx) !== 0) W.outBlock(sl2, 0, 0, 17, wv, 0, null, 0, a, null, null, CHx);
    W.chunk(sl3, 0, 17, new Float64Array(1).fill(0.02), 0, 0, fi2, fsx); W.outBlock(sl3, 0, 0, 17, 0.02, 0, null, 0, b, null, null, CHx);
    y.set(a, o); ref.set(b, o);
  }
  let step = 0;
  for (let j = 1000; j < N; j++) step = Math.max(step, Math.abs(y[j] - y[j - 1]));
  let slope = 0;
  for (let j = 1000; j < N; j++) slope = Math.max(slope, Math.abs(ref[j] - ref[j - 1]));
  assert.ok(step < 1.5 * slope, `Off ↔ LPF: max step ${step} vs the signal's ${slope}`);   // a cleared state: ≈ 13× (−27 dB)
});

test('chunk() contract: a slot Off (mode 0) for 100 ms and back resumes without a step; skipping chunk() while Off resumes stale state', () => {
  // pins the contract for the callers (serum-dsp, SxSample, SxGran, SxSpec): chunk() runs every chunk for both slots,
  // also while the slot is Off (O(1)); it is the only clock of the per-voice LPF/HPF/Stomp states
  const { W } = load();
  const fs = 96000, CH = 8, N = fs / 2, f0 = 110, fi = new Float64Array(1).fill(f0), r0 = 0.15 * fs + 10032;
  const run = (mode, wv, skip) => {
    const sl = new W.Slots(1), w = new Float64Array(1).fill(wv), y = new Float64Array(N);
    const on = (o) => o < 0.15 * fs || o >= r0;                               // Off for 104.5 ms (not whole cycles)
    for (let o = 0; o < N; o += CH) {
      const a = new Float64Array(CH).map((_, s) => 0.8 * Math.sin(2 * Math.PI * f0 * (o + s) / fs));
      if (on(o)) { W.chunk(sl, 0, mode, w, 0, 0, fi, fs); W.outBlock(sl, 0, 0, mode, wv, 0, null, 0, a, null, null, CH); }
      else if (!skip) W.chunk(sl, 0, 0, w, 0, 0, fi, fs);                      // Off: mode 0, O(1)
      y.set(a, o);
    }
    let step = 0;
    for (let j = r0 - 16; j < r0 + 64; j++) step = Math.max(step, Math.abs(y[j] - y[j - 1]));
    return step;
  };
  const slope = 0.8 * 2 * Math.PI * f0 / fs;
  for (const [mode, wv] of [[17, 0.8], [17, 0.5], [18, 0.2]]) {
    const ok = run(mode, wv, false), stale = run(mode, wv, true);
    assert.ok(ok < 1.5 * slope, `${ids[mode]} w ${wv}: re-entry step ${ok.toFixed(4)} vs the signal slope ${slope.toFixed(4)}`);
    assert.ok(stale > 5 * ok, `${ids[mode]} w ${wv}: a caller that skips chunk() while Off resumes 100 ms old state (step ${stale.toFixed(4)})`);
  }
});

test('[+] modulator column mc: every kernel reads m[s·mStride + (mc mod mStride)] when given, else column i (Slots(1) per stream)', () => {
  const { W } = load();
  const CH = 16, N = 3, r = rng(71);
  const RAW = new Float64Array(CH * N).map(() => 2 * r() - 1), col = (u) => (s) => RAW[s * N + (u % N)];
  const sl = new W.Slots(1), w1 = new Float64Array(1).fill(0.6), fi = new Float64Array(1).fill(100);
  for (const u of [0, 1, 2, 4]) {
    for (const [mode, k] of [[46, 0], [52, 0], [39, 0], [33, 0]]) {
      W.chunk(sl, k, mode, w1, 0, 0, fi, 48000);
      const mv = col(u);
      if (mode === 33) {
        const inc = new Float64Array(CH).fill(0.01), out = new Float64Array(CH);
        W.incBlock(sl, 0, 0, 33, 0, 0.6, RAW, N, inc, out, CH, u);
        for (let s = 0; s < CH; s++) assert.ok(Math.abs(out[s] - 0.01 * (1 + 8 * 0.36 * mv(s))) < 1e-15, 'incBlock column ' + u);
      } else if (mode === 39) {
        const ph = new Float64Array(CH).map(() => r()), out = new Float64Array(CH), d = new Float64Array(CH);
        W.phaseBlock(sl, 0, 0, 39, 0.6, 0, null, 0, RAW, N, ph, out, null, CH, u);
        W.pdBlock(sl, 0, 0, 39, 0.6, RAW, N, d, CH, u);
        const I = 3 * 0.6 ** 1.5;
        for (let s = 0; s < CH; s++) {
          const v = ph[s] + I * mv(s);
          assert.ok(Math.abs(out[s] - (v - Math.floor(v))) < 1e-12 && Math.abs(d[s] - I * mv(s)) < 1e-12, 'PD column ' + u);
        }
      } else {
        const x = new Float64Array(CH).fill(1);
        W.outBlock(sl, 0, 0, mode, 0.6, 0, RAW, N, x, null, null, CH, u);
        for (let s = 0; s < CH; s++) {
          const want = mode === 46 ? 1 - 0.6 + 0.6 * (0.5 + 0.5 * mv(s)) : 1 - 0.6 + 0.6 * mv(s);
          assert.ok(Math.abs(x[s] - want) < 1e-12, ids[mode] + ' column ' + u);
        }
      }
    }
  }
  // absent / invalid mc ⇒ column i (the §11.7 call shape, arity unchanged)
  const sl8 = new W.Slots(8), w8 = new Float64Array(8).fill(0.6);
  W.chunk(sl8, 0, 46, w8, 0, 0, new Float64Array(8).fill(100), 48000);
  for (const mc of [undefined, -1, -5, 1.5, NaN, '2', null]) {
    const x = new Float64Array(CH).fill(1);
    W.outBlock(sl8, 0, 5, 46, 0.6, 0, RAW, N, x, null, null, CH, mc);
    for (let s = 0; s < CH; s++) assert.ok(Math.abs(x[s] - (0.4 + 0.6 * (0.5 + 0.5 * col(5)(s)))) < 1e-12, 'mc ' + String(mc) + ' → column i');
  }
  assert.equal(W.outBlock.length, 12); assert.equal(W.incBlock.length, 11); assert.equal(W.phaseBlock.length, 14); assert.equal(W.pdBlock.length, 9);
});

test('Odd/Even in slot 2 after an O slot 1: a caller that gives slot 1\'s outBlock no x2 gets one console.warn (its even harmonics leak)', () => {
  const { S, W } = load();
  const sl = new W.Slots(2), w = new Float64Array(2).fill(1), fi = new Float64Array(2).fill(100);
  W.chunk(sl, 0, 19, w, 0, 0, fi, 48000); W.chunk(sl, 1, 16, new Float64Array([0, 0.5]), 0, 0, fi, 48000);
  const x = new Float64Array(8).fill(0.5), x2 = new Float64Array(8).fill(0.5);
  W.outBlock(sl, 0, 0, 19, 1, 0, null, 0, x, x2, null, 8);
  W.outBlock(sl, 0, 1, 19, 1, 0, null, 0, x, null, null, 8);                 // voice 1: slot 2 neutral — no x2 needed
  assert.equal(warns(S).length, 0, 'x2 given, or slot 2 not Odd/Even: no warning');
  for (let k = 0; k < 3; k++) W.outBlock(sl, 0, 0, 19, 1, 0, null, 0, x, null, null, 8);
  assert.equal(warns(S).length, 1, 'one warning per scope');
  assert.match(warns(S)[0], /BOTH slots/);
});

/* ------------------------------------------------------------------ AM / RM / PD / Flip (§6.6.4) */

test('AM / RM / PD / Flip on the voice path: formulas against an independent per-sample reference (sample-major m, mStride)', () => {
  const { W } = load();
  const r = rng(33), CH = 32, N = 5, sl = new W.Slots(8);
  const RAW = new Float64Array(16 * CH).map(() => 2 * r() - 1);           // modulator: N unison voices, sample-major [s·N + u]
  const w = new Float64Array(8).map(() => 0.05 + 0.9 * r());
  for (const m of [39, 40, 41, 42, 43, 44, 46, 49, 52, 57, 9]) {
    W.chunk(sl, 0, m, w, 0, 0, new Float64Array(8).fill(100), 48000);
    for (let i = 0; i < 8; i++) {
      const ph = new Float64Array(CH).map(() => r()), x = new Float64Array(CH).map(() => 2 * r() - 1), x0 = x.slice(), out = new Float64Array(CH);
      const mv = s => RAW[s * N + (i % N)];
      if (W.META.dom[m] === 2) {
        assert.equal(W.phaseBlock(sl, 0, i, m, w[i], 0, null, 0, RAW, N, ph, out, null, CH), 1);
        const I = (m === 42 ? 4 : 3) * w[i] ** 1.5;
        for (let s = 0; s < CH; s++) { const v = ph[s] + I * mv(s); assert.ok(Math.abs(out[s] - (v - Math.floor(v))) < 1e-12, ids[m]); }
        // pdBlock: the same law unwrapped (offsets in periods, may exceed ±1); frac(φ + out) is phaseBlock's PD bit for bit
        const d = new Float64Array(CH);
        assert.equal(W.pdBlock(sl, 0, i, m, w[i], RAW, N, d, CH), 1);
        for (let s = 0; s < CH; s++) {
          assert.ok(Math.abs(d[s] - I * mv(s)) < 1e-12, 'pdBlock ' + ids[m]);
          const v = ph[s] + d[s]; assert.equal(v - Math.floor(v), out[s]);
        }
      } else {
        assert.equal(W.outBlock(sl, 0, i, m, w[i], 0, RAW, N, x, null, ph, CH), 1);
        for (let s = 0; s < CH; s++) {
          const wi = w[i], want = m === 9 ? (ph[s] < wi ? x0[s] : -x0[s]) : m <= 51 ? x0[s] * (1 - wi + wi * (0.5 + 0.5 * mv(s))) : x0[s] + wi * (x0[s] * mv(s) - x0[s]);
          assert.ok(Math.abs(x[s] - want) < 1e-12, `${ids[m]} voice ${i} s ${s}`);
        }
      }
    }
  }
  // PD (Self): never applied by a kernel (the caller's per-sample read loop does it): phaseBlock copies and returns 0
  // whatever y1 holds; chunk() exposes I = 1.5·w^1.5 in pdI
  W.chunk(sl, 1, 45, w, 0, 0, new Float64Array(8), 48000);
  const ph = new Float64Array(CH).map(() => r()), out = new Float64Array(CH);
  sl.y1[3] = -0.37;
  assert.equal(W.phaseBlock(sl, 1, 3, 45, w[3], 0, null, 0, RAW, N, ph, out, null, CH), 0);
  assert.deepEqual(arr(out), arr(ph), 'PD (Self) passes the phase through');
  const I = 1.5 * w[3] ** 1.5;
  assert.ok(Math.abs(sl.pdI[8 + 3] - I) < 1e-15);
  sl.reset();
  assert.equal(sl.y1[3], 0, 'reset clears y1');
  // a modulator array shorter than its layout reads 0 (one warning), never out of bounds
  W.chunk(sl, 0, 46, w, 0, 0, new Float64Array(8), 48000);
  const x = new Float64Array(CH).fill(1);
  W.outBlock(sl, 0, 7, 46, w[7], 0, new Float64Array(40), 3, x, null, null, CH);
  assert.ok(x.every(v => Math.abs(v - (1 - w[7] / 2)) < 1e-12));
});

test('PD (Self): renderWarp2 feeds back the previous read sample per sample (the wavetable realisation, after 8 settling cycles)', () => {
  const { W } = load();
  const w = 0.6, I = 1.5 * w ** 1.5, n = 2048;
  const herm = (b, p) => { const i = Math.floor(p), f = p - i, g = k => b[(k % 2048 + 2048) % 2048]; const xm = g(i - 1), x0 = g(i), x1 = g(i + 1), x2 = g(i + 2);
    return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0; };
  const ref = (Is, frame, post = x => x) => {
    let y1 = 0;
    const r = new Float64Array(n);
    for (let j = 0; j < 9 * n; j++) {
      let p = (j % n) / n + Is * y1; p -= Math.floor(p);
      y1 = herm(frame, p * 2048);
      if (j >= 8 * n) r[j - 8 * n] = post(y1, j % n);
    }
    return r;
  };
  const got = W.renderWarp2(SINE, [{ mode: 45, w }], {});
  assert.ok(maxDiff(got, ref(I, SINE)) < 1e-6, 'max diff ' + maxDiff(got, ref(I, SINE)));
  assert.ok(maxDiff(got, W.renderWarp2(SINE, [], {})) > 0.05, 'audible');
  assert.deepEqual(arr(W.renderWarp2(SINE, [null, { mode: 45, w }], {})), arr(got), 'slot 2');
  // both slots in mode 45: the indices add; an O slot acts on the read sample, the feedback stays the read (pre-O)
  const both = W.renderWarp2(SINE, [{ mode: 45, w }, { mode: 45, w: 0.3 }], {});
  assert.ok(maxDiff(both, ref(I + 1.5 * 0.3 ** 1.5, SINE)) < 1e-6, 'both slots');
  const am = W.renderWarp2(SINE, [{ mode: 45, w }, { mode: 46, w: 0.5 }], {});
  assert.ok(maxDiff(am, ref(I, SINE, y => y * (1 - 0.5 + 0.5 * 0.5))) < 1e-6, 'O slot after the self-fed read (m = null ⇒ 0)');
  // there is no block (held-y1) realisation: phaseBlock and pdBlock act as Off for mode 45, so a caller that passes
  // every P slot to phaseBlock cannot apply the shift twice
  const sl = new W.Slots(1), ph = new Float64Array(4).map((_, s) => s / 4), o = new Float64Array(4), d = new Float64Array(4).fill(9);
  W.chunk(sl, 0, 45, new Float64Array([w]), 0, 0, new Float64Array([220]), 48000);
  sl.y1[0] = 0.25;
  assert.equal(W.phaseBlock(sl, 0, 0, 45, w, 0, null, 0, null, 0, ph, o, null, 4), 0);
  assert.deepEqual(arr(o), arr(ph));
  assert.equal(W.pdBlock(sl, 0, 0, 45, w, new Float64Array([0.5]), 0, d, 4), 0);
  assert.ok(d.every(v => v === 0));
  // ⚑ order (IMPL, header): the self shift follows the other slot's P stage whichever slot holds PD (Self):
  // φ_r = frac(W(φ) + I·y₁); so (PD (Self), PWM) and (PWM, PD (Self)) render the same (PWM: an exact formula, so the
  // feedback orbit is reproducible; with an exp2-based warp the chaotic map amplifies 1e-10 differences)
  const pw = 0.5, K = 1 / (1 - 0.995 * pw), MAXPH = 1 - 2 ** -24;
  const want = (() => {
    let y1 = 0; const r = new Float64Array(n);
    for (let j = 0; j < 9 * n; j++) {
      const q = (j % n) / n * K; let p = (q < MAXPH ? q : MAXPH) + I * y1; p -= Math.floor(p);
      y1 = herm(RICH, p * 2048); if (j >= 8 * n) r[j - 8 * n] = y1;
    }
    return r;
  })();
  const ab = W.renderWarp2(RICH, [{ mode: 45, w }, { mode: 5, w: pw }], {}), ba = W.renderWarp2(RICH, [{ mode: 5, w: pw }, { mode: 45, w }], {});
  assert.deepEqual(arr(ab), arr(ba), 'swapping the slots changes nothing');
  assert.ok(maxDiff(ab, want) < 1e-6, 'self shift after the P stage: ' + maxDiff(ab, want));
});

/* ------------------------------------------------------------------ block kernels vs per-sample loops (B18) */

test('the block kernels equal a per-sample loop (n = 1 calls) bit for bit for every mode, in place or not', () => {
  const { W } = load();
  const r = rng(77), CH = 32, U = 6, fs = 96000;
  const remap = new Float32Array(3 * 2049).map((_, j) => Math.min(1, ((j % 2049) / 2048) ** 0.7 + 0.01 * Math.sin(j)));
  const RAW = new Float64Array(16 * CH).map(() => 2 * r() - 1), NM = 4;
  const w = new Float64Array(U).map(() => 0.05 + 0.9 * r()), fi = new Float64Array(U).map(() => 50 + 2000 * r());
  for (let m = 1; m < 82; m++) {
    const a = new W.Slots(U), b = new W.Slots(U), v = 0.3, fm = m % 3;
    for (const k of [0, 1]) { W.chunk(a, k, m, w, v, fm, fi, fs); W.chunk(b, k, m, w, v, fm, fi, fs); }
    for (let i = 0; i < U; i++) {
      for (const k of [0, 1]) {
        // F
        const inc = new Float64Array(CH).map(() => 0.01 + 0.02 * r()), o1 = new Float64Array(CH), o2 = new Float64Array(CH);
        const r1 = W.incBlock(a, k, i, m, fm, w[i], RAW, NM, inc, o1, CH);
        let r2 = 0;
        for (let s = 0; s < CH; s++) {
          const m1 = new Float64Array(NM); for (let u = 0; u < NM; u++) m1[u] = RAW[s * NM + u];
          const i1 = new Float64Array([inc[s]]), q = new Float64Array(1);
          r2 = W.incBlock(b, k, i, m, fm, w[i], m1, NM, i1, q, 1); o2[s] = q[0];
        }
        assert.equal(r1, r2); assert.deepEqual(arr(o1), arr(o2), `inc ${ids[m]}`);
        const ip = inc.slice(); W.incBlock(a, k, i, m, fm, w[i], RAW, NM, ip, ip, CH); assert.deepEqual(arr(ip), arr(o1), 'in place');
        // P (window included)
        const ph = new Float64Array(CH).map(() => r()), p1 = new Float64Array(CH), p2 = new Float64Array(CH);
        const wn1 = new Float64Array(CH).fill(0.5), wn2 = new Float64Array(CH).fill(0.5);
        const q1 = W.phaseBlock(a, k, i, m, w[i], v, remap, 2049, RAW, NM, ph, p1, wn1, CH);
        let q2 = 0;
        for (let s = 0; s < CH; s++) {
          const m1 = new Float64Array(NM); for (let u = 0; u < NM; u++) m1[u] = RAW[s * NM + u];
          const pi = new Float64Array([ph[s]]), po = new Float64Array(1), wn = new Float64Array([wn2[s]]);
          q2 = W.phaseBlock(b, k, i, m, w[i], v, remap, 2049, m1, NM, pi, po, wn, 1); p2[s] = po[0]; wn2[s] = wn[0];
        }
        assert.equal(q1, q2); assert.deepEqual(arr(p1), arr(p2), `phase ${ids[m]}`); assert.deepEqual(arr(wn1), arr(wn2), `window ${ids[m]}`);
        const pp = ph.slice(); W.phaseBlock(a, k, i, m, w[i], v, remap, 2049, RAW, NM, pp, pp, null, CH); assert.deepEqual(arr(pp), arr(p1), 'in place');
        // O (stateful modes: the block call and the per-sample calls run on separate Slots with the same history)
        // (both slots hold mode m: for Odd/Even, slot 0's call also processes x2 — compared too)
        const x = new Float64Array(CH).map(() => 2 * r() - 1), x2 = new Float64Array(CH).map(() => 2 * r() - 1), y1 = x.slice(), y2 = x.slice();
        const z1 = x2.slice(), z2 = x2.slice();
        const s1 = W.outBlock(a, k, i, m, w[i], v, RAW, NM, y1, z1, ph, CH);
        let s2 = 0;
        for (let s = 0; s < CH; s++) {
          const m1 = new Float64Array(NM); for (let u = 0; u < NM; u++) m1[u] = RAW[s * NM + u];
          const xi = new Float64Array([y2[s]]), xj = new Float64Array([z2[s]]);
          s2 = W.outBlock(b, k, i, m, w[i], v, m1, NM, xi, xj, new Float64Array([ph[s]]), 1); y2[s] = xi[0]; z2[s] = xj[0];
        }
        assert.equal(s1, s2); assert.deepEqual(arr(y1), arr(y2), `out ${ids[m]}`); assert.deepEqual(arr(z1), arr(z2), `x2 ${ids[m]}`);
        // pdBlock (PD 39–44 as unwrapped offsets)
        const d1 = new Float64Array(CH), d2 = new Float64Array(CH);
        const t1 = W.pdBlock(a, k, i, m, w[i], RAW, NM, d1, CH);
        let t2 = 0;
        for (let s = 0; s < CH; s++) {
          const m1 = new Float64Array(NM); for (let u = 0; u < NM; u++) m1[u] = RAW[s * NM + u];
          const q = new Float64Array(1); t2 = W.pdBlock(b, k, i, m, w[i], m1, NM, q, 1); d2[s] = q[0];
        }
        assert.equal(t1, t2); assert.deepEqual(arr(d1), arr(d2), `pd ${ids[m]}`);
        // domain: exactly one kernel applies a non-spectral mode (PD (Self) none: the caller's read loop applies it)
        const dom = W.META.dom[m], applied = [r1, q1, s1];
        if (dom === 4 || m === 45) assert.deepEqual(applied, [0, 0, 0], ids[m]);
        else assert.deepEqual(applied, [dom === 1 ? 1 : 0, dom === 2 ? 1 : 0, dom === 3 ? 1 : 0], ids[m]);
        assert.equal(t1, m >= 39 && m <= 44 ? 1 : 0, 'pdBlock ' + ids[m]);
      }
    }
  }
});

test('kernels act as Off for a voice / slot chunk() did not set up (mode mismatch, Off voice, bad slots, missing data)', () => {
  const { W } = load();
  const sl = new W.Slots(2), w = new Float64Array(2).fill(0.5), fi = new Float64Array(2).fill(100), CH = 8;
  W.chunk(sl, 0, 2, w, 0, 0, fi, 48000, 1);                                  // voice 1 beyond nu
  const ph = new Float64Array(CH).map((_, s) => s / CH), out = new Float64Array(CH);
  assert.equal(W.phaseBlock(sl, 0, 0, 3, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 0, 'mode ≠ chunk mode');
  assert.equal(W.phaseBlock(sl, 0, 1, 2, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 0, 'voice beyond nu');
  assert.equal(W.phaseBlock(sl, 1, 0, 2, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 0, 'slot 1 not set up');
  assert.equal(W.phaseBlock({}, 0, 0, 2, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 0, 'not a Slots');
  assert.equal(W.phaseBlock(sl, 0, 0.5, 2, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 0, 'non-integer voice');
  assert.deepEqual(arr(out), arr(ph));
  assert.equal(W.phaseBlock(sl, 0, 0, 2, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 1);
  W.chunk(sl, 0, 11, w, 0, 0, fi, 48000);
  assert.equal(W.phaseBlock(sl, 0, 0, 11, 0.5, 0, null, 0, null, 0, ph, out, null, CH), 0, 'remap without a table');
  assert.equal(W.phaseBlock(sl, 0, 0, 11, 0.5, 0, new Float32Array(2049), 1, null, 0, ph, out, null, CH), 0, 'row out of range');
  W.chunk(sl, 0, 16, w, 0, 0, fi, 48000);
  const x = new Float64Array(CH).fill(1);
  assert.equal(W.outBlock(sl, 0, 0, 16, 0.2, 0, null, 0, x, null, ph, CH), 0, 'Odd/Even without x2');
  W.chunk(sl, 0, 9, w, 0, 0, fi, 48000);
  assert.equal(W.outBlock(sl, 0, 0, 9, 0.2, 0, null, 0, x, null, null, CH), 0, 'Flip without ph');
  assert.ok(x.every(v => v === 1));
  // spectral modes: chunk reports em by neutrality, every kernel passes through
  W.chunk(sl, 0, 63, w, 0, 0, fi, 48000);
  assert.equal(sl.em[0], 63);
  const inc = new Float64Array(CH).fill(0.1);
  assert.equal(W.incBlock(sl, 0, 0, 63, 0, 0.5, null, 0, inc, inc, CH) + W.phaseBlock(sl, 0, 0, 63, 0.5, 0, null, 0, null, 0, ph, ph, null, CH)
    + W.outBlock(sl, 0, 0, 63, 0.5, 0, null, 0, x, null, ph, CH), 0);
});

/* ------------------------------------------------------------------ renderWarp2 = the voice path (§15.7) */

test('renderWarp2 equals the voice path: unison voice i of a 16-voice Slots, a sample-major oscillator modulator, both slots', () => {
  const { W } = load();
  const R = rng(4), n = 2048, CH = 32, NM = 3, i = 5, hz = 220, fs = hz * n;
  const remapRow = new Float32Array(2049).map((_, j) => (j / 2048) ** 1.3), REM = new Float32Array(3 * 2049);
  REM.set(remapRow, 2 * 2049);                                               // oscillator C's row
  const modCycle = new Float32Array(2048).map((_, j) => Math.sin(2 * Math.PI * 2 * j / 2048) * 0.8);
  const herm = (b, p) => { const k = Math.floor(p), f = p - k, g = q => b[q & 2047]; const xm = g(k - 1), x0 = g(k), x1 = g(k + 1), x2 = g(k + 2);
    return (((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0; };
  const pairs = [[{ mode: 33, w: 0.3, fm: 0 }, { mode: 2, w: 0.6 }], [{ mode: 12, w: 0.7 }, { mode: 23, w: 0.4 }], [{ mode: 1, w: 0.4, v: 0.5 }, { mode: 16, w: 0.2 }],
    [{ mode: 40, w: 0.5 }, { mode: 47, w: 0.8 }], [{ mode: 34, w: 0.2, fm: 1 }, { mode: 17, w: 0.6 }], [{ mode: 45, w: 0.3 }, { mode: 30, w: 0.5 }],
    [null, { mode: 9, w: 0.3 }], [{ mode: 1, w: 0.2, v: 1 }, { mode: 1, w: 0.1, v: 0.5 }], [{ mode: 2, w: 0.4 }, { mode: 45, w: 0.5 }],
    [{ mode: 45, w: 0.2 }, { mode: 16, w: 0.7 }]];
  for (const [a, b] of pairs) {
    const want = W.renderWarp2(RICH, [a, b], { remap: remapRow, mod: modCycle, hz });
    // the voice: 16 unison voices, ours is i; slot amounts per voice, the modulator = another oscillator with NM voices
    const sl = new W.Slots(16), wa = new Float64Array(16).map(() => R()), wb = new Float64Array(16).map(() => R()), fi = new Float64Array(16).fill(hz);
    const A = a || { mode: 0, w: 0 }, Bs = b || { mode: 0, w: 0 };
    wa[i] = A.w; wb[i] = Bs.w;
    W.chunk(sl, 0, A.mode, wa, A.v || 0, A.fm || 0, fi, fs);
    W.chunk(sl, 1, Bs.mode, wb, Bs.v || 0, Bs.fm || 0, fi, fs);
    sl.reset();
    assert.ok(!(W.META.dist[A.mode] >= 0), 'pairs: a distortion only in slot 2');
    sl.dcOn = 0;
    const RAW = new Float64Array(16 * CH), inc = new Float64Array(CH), PH = new Float64Array(CH), P2 = new Float64Array(CH), WIN = new Float64Array(CH);
    const X = new Float64Array(CH), X2 = new Float64Array(CH), out = new Float64Array(n);
    const fmAny = [A.mode, Bs.mode].some(m => W.META.dom[m] === 1);
    const st = [A.mode, Bs.mode].some(m => [17, 18, 30, 45].includes(m)) ? 8 : 0;
    let ph = 0;
    for (let j0 = 0; j0 < (st + 1) * n; j0 += CH) {
      for (let s = 0; s < CH; s++) { inc[s] = 1 / n; RAW[s * NM + (i % NM)] = herm(modCycle, (((j0 + s) % n) / n) * 2048); }
      W.incBlock(sl, 0, i, A.mode, A.fm || 0, A.w, RAW, NM, inc, inc, CH);
      W.incBlock(sl, 1, i, Bs.mode, Bs.fm || 0, Bs.w, RAW, NM, inc, inc, CH);
      for (let s = 0; s < CH; s++) { if (fmAny) { PH[s] = ph; ph += inc[s]; ph -= Math.floor(ph); } else PH[s] = ((j0 + s) % n) / n; }
      // PD (Self), the wavetable realisation: its slots skip phaseBlock; per-sample feedback of the read in the read loop
      const pa = A.mode === 45 ? 0 : A.mode, pb = Bs.mode === 45 ? 0 : Bs.mode;
      const I = (A.mode === 45 ? sl.pdI[i] : 0) + (Bs.mode === 45 ? sl.pdI[16 + i] : 0);
      W.phaseBlock(sl, 0, i, pa, A.w, A.v || 0, REM, 2 * 2049, RAW, NM, PH, P2, WIN, CH);
      W.phaseBlock(sl, 1, i, pb, Bs.w, Bs.v || 0, REM, 2 * 2049, RAW, NM, P2, P2, WIN, CH);
      for (let s = 0; s < CH; s++) {
        let p = P2[s];
        if (I !== 0) { p += I * sl.y1[i]; p -= Math.floor(p); }
        X[s] = herm(RICH, p * 2048); X2[s] = herm(RICH, (p + 0.5) * 2048);
        if (I !== 0) sl.y1[i] = X[s];
      }
      if (sl.hw[0] | sl.hw[1]) for (let s = 0; s < CH; s++) { X[s] *= WIN[s]; X2[s] *= WIN[s]; }
      W.outBlock(sl, 0, i, A.mode, A.w, A.v || 0, RAW, NM, X, X2, PH, CH);
      W.outBlock(sl, 1, i, Bs.mode, Bs.w, Bs.v || 0, RAW, NM, X, X2, PH, CH);
      for (let s = 0; s < CH; s++) { const j = j0 + s - st * n; if (j >= 0) out[j] = X[s]; }
    }
    // a distortion slot (last in these pairs): renderWarp2 removes its DC exactly instead of running the voice's 5 Hz
    // blocker (the voice path here runs without it, dcOn 0, and the cycle's mean is subtracted)
    if (W.META.dist[Bs.mode] >= 0) { let mu = 0; for (const v of out) mu += v; mu /= n; for (let j = 0; j < n; j++) out[j] -= mu; }
    assert.ok(maxDiff(want, out) < 1e-6, `${JSON.stringify([a, b])}: ${maxDiff(want, out)}`);
    assert.ok(want.every(Number.isFinite));
  }
});

test('renderWarp2: shapes, lenient values, TypeErrors for malformed structure', () => {
  const { W } = load();
  const R = refDSP();
  for (const over of [undefined, 1, 2, 4]) {
    const ref = R.renderWarp(RICH, 0, 0, over ? { over } : undefined);
    const got = W.renderWarp2(RICH, [], over ? { over } : undefined);
    assert.equal(got.constructor.name, 'Float32Array');
    assert.equal(got.length, 2048 * (over || 1));
    assert.deepEqual(arr(got), arr(ref), 'Off, over ' + over);
  }
  const ref2 = arr(R.renderWarp(RICH, 0, 0, { over: 2 }));
  assert.deepEqual(arr(W.renderWarp2(Array.from(RICH), null, { over: 2 })), ref2, 'plain arrays, null slots');
  assert.deepEqual(arr(W.renderWarp2(RICH, [null, { mode: 999, w: NaN }], { over: 2.7 })), ref2, 'lenient values (over floored)');
  for (let m = 58; m < 82; m++) assert.deepEqual(arr(W.renderWarp2(RICH, [{ mode: m, w: 0.7 }], { over: 2 })), ref2, 'spectral-only ' + ids[m]);
  assert.equal(W.renderWarp2(RICH, [], { over: 0 }).length, 2048);
  for (let m = 1; m < 58; m++) assert.ok(W.renderWarp2(RICH, [{ mode: m, w: 0.9, v: 0.5, fm: m % 3 }, { mode: (m * 7) % 58, w: 0.4 }], { mod: SINE }).every(Number.isFinite), ids[m]);
  const TE = f => assert.throws(f, e => e && e.name === 'TypeError');
  for (const fn of [W.renderWarp2, W.renderSweep]) {
    TE(() => fn(new Float32Array(100), [], {}));
    TE(() => fn(null, [], {}));
    TE(() => fn(RICH, { mode: 1 }, {}));
    TE(() => fn(RICH, [{}, {}, {}], {}));
    TE(() => fn(RICH, [3], {}));
    TE(() => fn(RICH, [], 5));
    TE(() => fn(RICH, [], { remap: new Float32Array(100) }));
    TE(() => fn(RICH, [], { mod: new Float32Array(100) }));
  }
});

test('Render OSC Warp (§13.3.1): renderSweep frame f = slot 1 at f/255 with slot 2 at base; slot 2 swept when slot 1 is Off', () => {
  const { W } = load();
  const s1 = { mode: 2, w: 0.9 }, s2 = { mode: 23, w: 0.3 };
  const sw = W.renderSweep(RICH, [s1, s2], {});
  assert.equal(sw.length, 256 * 2048);
  for (const f of [0, 1, 128, 255]) {
    assert.deepEqual(arr(sw.subarray(f * 2048, (f + 1) * 2048)), arr(W.renderWarp2(RICH, [{ mode: 2, w: f / 255 }, s2], {})), 'frame ' + f);
  }
  const sw2 = W.renderSweep(RICH, [null, s2], { frames: 4, over: 2 });
  assert.equal(sw2.length, 4 * 4096);
  for (let f = 0; f < 4; f++) assert.deepEqual(arr(sw2.subarray(f * 4096, (f + 1) * 4096)), arr(W.renderWarp2(RICH, [null, { mode: 23, w: f / 3 }], { over: 2 })));
  assert.equal(W.renderSweep(RICH, [null, { mode: 0 }], {}), null, 'both Off');
  assert.equal(W.renderSweep(RICH, [], {}), null);
});

/* ------------------------------------------------------------------ allocation-free (§0.3) */

test('allocation-free: chunk and the block kernels for every mode (incl. distortion, filters, Stomp Box)', () => {
  const { S, W } = load();
  const CH = 32, sl = new W.Slots(), w = new Float64Array(16).fill(0.3), fi = new Float64Array(16).fill(110);
  const inc = new Float64Array(CH).fill(0.01), ph = new Float64Array(CH).fill(0.25), win = new Float64Array(CH);
  const x = new Float64Array(CH).fill(0.5), x2 = new Float64Array(CH), mod = new Float64Array(16 * CH), remap = new Float32Array(3 * 2049);
  W.chunk(sl, 0, 82, w, 0, 0, fi, 48000); W.chunk(sl, 0, 5, null, 0, 0, fi, 48000); W.chunk(sl, 0, 5, w, 0, 0, fi, 0);
  W.outBlock(sl, 0, 0, 46, 0.3, 0, new Float64Array(3), 4, x, null, null, CH);   // warm the warning paths
  W.chunk(sl, 0, 11, w, 0, 0, fi, 48000); W.phaseBlock(sl, 0, 0, 11, 0.3, 0, null, 0, null, 0, ph, ph, null, CH);
  noAlloc(S, () => {
    for (let c = 0; c < 400; c++) {
      const m = c % 82;
      for (const k of [0, 1]) {
        W.chunk(sl, k, m, w, 0.5, c % 3, fi, 96000, 7);
        for (let i = 0; i < 7; i++) {
          W.incBlock(sl, k, i, m, c % 3, w[i], mod, 7, inc, inc, CH);
          W.phaseBlock(sl, k, i, m, w[i], 0.5, remap, 2049, mod, 7, ph, ph, win, CH);
          W.outBlock(sl, k, i, m, w[i], 0.5, mod, 7, x, x2, ph, CH);
          W.pdBlock(sl, k, i, m, w[i], mod, 7, win, CH);
        }
      }
      // slot 1 Odd/Even behind every O mode of slot 0 (x2 processed with its own state)
      W.chunk(sl, 0, m, w, 0.5, 0, fi, 96000, 7); W.chunk(sl, 1, 16, w, 0, 0, fi, 96000, 7);
      for (let i = 0; i < 7; i++) W.outBlock(sl, 0, i, m, w[i], 0.5, mod, 7, x, x2, ph, CH);
      W.speed(m, 0.4, c % 3);
      W.chunk(sl, 0, 200, w, 0, 0, fi, 48000);
      W.outBlock(sl, 0, 0, 46, 0.3, 0, null, 0, x, null, null, 0);
    }
    sl.reset();
  });
  assert.ok(arr(x).every(Number.isFinite) && arr(inc).every(Number.isFinite));
});
