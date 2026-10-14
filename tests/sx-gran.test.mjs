// sx-gran.js unit tests (owner D4; SPEC-serum2 §15.8). M1b: the §11.8 skeleton — exports and signatures, CP v2 shape
// validation in apply, grain caps, the grain state Float64Array(256·16) allocated on the first selecting apply, entry
// resolution by asset epoch, note bookkeeping, allocation-free hot paths, lazy references and failure isolation (§0.3).
// M2: the Granular oscillator (§6.9) — spawn rate in Free / BPM / Grains density, Jump Start, the per-oscillator and
// per-processor grain caps (the most recent voice still spawns), per-stream START / SPAN playheads and Manual X|Y,
// slicing off under X|Y, per-grain randomisation ranges and determinism, the ten windows, window amount and skew, reverse
// grains, Loop Grains, overlap gain, spawn patterns, the phase-domain warps per grain (≡ the wavetable path), Rand Warp,
// PD (Self) per grain — and the §14.1 CPU rows g, g′, g″ through the voice.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../serum-core.js?v=7';
import * as smp from '../smp.js?v=7';
import { dspScope, source, ALLOC_NAMES } from './dsp-scope.mjs';
import * as CPU from './cpu-gate.mjs';

const FILES = ['sx-base.js', 'sx-warp.js', 'sx-gran.js'];
const load = (opts = {}) => {
  const S = dspScope({ files: FILES, ...opts });
  return { S, B: S.global('SxBase'), W: S.global('SxWarp'), X: S.global('SxGran') };
};
const clone = o => JSON.parse(JSON.stringify(o));
const LET = ['A', 'B', 'C'];
// a compiled CP v2 with OSC C Granular (BPM density, 100 grains max, Exp spawn, X|Y on) and OSC A Sample
function cpWith(edit) {
  const s = core.defaultSerum();
  s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:a';
  s.osc[2].type = 'gran'; s.osc[2].smp = 'smp:g'; s.osc[2].uni.spawn = 2; s.osc[2].fm = [1, 2];
  Object.assign(s.osc[2].smpo, { loop: 1, loopGrains: 1, scanKey: 1, scanLock: 1, win: 4, rev: 0 });
  s.osc[2].smpo.dens = { mode: 1, trip: 1, dot: 0, jump: 0, max: 100 };
  s.osc[2].smpo.glen = { mode: 2, trip: 0, dot: 1 };
  s.osc[2].smpo.slice = { mode: 2, thr: 0.5, marks: [0.5], toEnd: 0, single: 1, root: 60, sync: 0 };
  s.osc[2].xy = { on: 1, y: 4, yMode: 1 };
  if (edit) edit(s);
  return core.compileSerum(core.normalizeSerum(s), {}).serum;
}
// OSC A Granular on 'smp:t' with destination values p (dens / glen n are Free-mode values unless edit changes the modes)
function cpG(p = {}, edit = null) {
  const s = core.defaultSerum();
  s.osc[0].type = 'gran'; s.osc[0].smp = 'smp:t';
  Object.assign(s.p, p);
  if (edit) edit(s);
  return core.compileSerum(core.normalizeSerum(s), {}).serum;
}
const nDens = hz => Math.log(hz / 0.1) / Math.log(8000);       // Free density n for a spawn rate (§6.9.2)
const nGlen = sec => Math.log10(sec / 0.001) / 4;              // Free grain length n (§6.9.3)
// a voice with the §6.2 second stream (xorshift32), counting its draws
const voice = (seed = 0x2545F491) => ({ r2: seed >>> 0 || 1, draws: 0,
  rnd2() { this.draws++; let x = this.r2; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.r2 = x || 1; return this.r2 / 4294967296; } });
function oscCtx(o, N = 4, CH = 8) {
  const f16 = () => new Float64Array(16), fch = () => new Float64Array(CH);
  return {
    o, N, f: f16().fill(440), gl: f16(), gr: f16(), dgl: f16(), dgr: f16(), pan: f16(), t: f16(), w1: f16(), w2: f16(),
    mode1: 0, mode2: 0, var1: 0, var2: 0, fm1: 0, fm2: 0, mod1: null, mod2: null, modStride1: 0, modStride2: 0,
    eff: new Float64Array(429), cp: null, sx: { grains: 0 }, gate: 1, fresh: 1, CH, fs: 96000, base: 48000, bpm: 120, keyRef: 60,
    rootShift: 0, wbuf: { inc: fch(), ph: fch(), ph2: fch(), win: fch(), x: fch(), x2: fch() },
  };
}
function ctxOf(cp, { o = 0, N = 1, CH = 32, fs = 48000, f = fRoot(60), gain = 1, key = 60, keyRef = key, bpm = 120, sx = null } = {}) {
  const F = () => new Float64Array(16);
  return { o, N, f: F().fill(f), gl: F().fill(gain), gr: F().fill(gain), dgl: F(), dgr: F(), pan: F(), t: F(), w1: F(), w2: F(),
    mode1: 0, mode2: 0, var1: 0, var2: 0, fm1: 0, fm2: 0, mod1: null, mod2: null, modStride1: 0, modStride2: 0,
    eff: Float64Array.from(cp.base), cp, sx: sx || { grains: 0 }, gate: 1, fresh: 1, CH, fs, base: 48000, bpm, keyRef, rootShift: 0, key, wbuf: {} };
}
const ef = (ctx, B, name, n, o = 0) => { const i = B.DIDX2[LET[o] + '_' + name]; assert.ok(i >= 0, name); ctx.eff[i] = n; };
const fRoot = root => 440 * Math.pow(2, (root - 69) / 12);
function entry(id, len, fn, { rate = 48000, root = 60, nLv = 1, R = null, peak = null } = {}) {
  const levels = [];
  for (let l = 0, n = len; l < nLv; l++) {
    if (l > 0) n = Math.floor(n / 2);
    const sc = 2 ** l;
    levels.push({ len: n, L: Float32Array.from({ length: n }, (_, j) => fn(j * sc)), R: R ? Float32Array.from({ length: n }, (_, j) => R(j * sc)) : null });
  }
  let pk = 0;
  for (const x of levels[0].L) pk = Math.max(pk, Math.abs(x));
  return { id, v: 1, kind: 'smp', bytes: 0, rate, ch: R ? 2 : 1, len, root, loop: null, peak: peak !== null ? peak : pk, levels };
}
const smpEntry = (id, len = 64) => entry(id, len, () => 0.5);
// typed arrays an instance owns (WT is a reference to SxBase's shared window tables, not the instance's)
const typedBytes = obj => Object.entries(obj).reduce((n, [k, v]) => n + (k !== 'WT' && v && ArrayBuffer.isView(v) ? v.byteLength : 0), 0);
const warns = S => S.logs.filter(m => m.level === 'warn' && /^sx-gran:/.test(m.text));
// fn() with the scope's allocating constructors replaced by throwing stubs (dsp-scope's list; Array.isArray and
// ArrayBuffer.isView stay usable — they allocate nothing)
function noAlloc(S, fn) {
  const ctx = S.ctx, own = Object.prototype.hasOwnProperty, saved = {};
  for (const k of ALLOC_NAMES) {
    const orig = S.run('globalThis.' + k, 'no-alloc.js');
    saved[k] = own.call(ctx, k) ? { v: ctx[k] } : null;
    const f = function () { throw new Error('allocation: ' + k); };
    if (k === 'Array') f.isArray = orig.isArray;
    if (k === 'ArrayBuffer') f.isView = orig.isView;
    ctx[k] = f;
  }
  try { return fn(); } finally { for (const k of ALLOC_NAMES) { if (saved[k]) ctx[k] = saved[k].v; else delete ctx[k]; } }
}
function play(osc, ctx, n, { raw = false, each = null } = {}) {
  const L = new Float64Array(n), R = new Float64Array(n), OL = new Float64Array(32), OR = new Float64Array(32);
  const RAW = raw ? new Float64Array(16 * 32) : null, rows = raw ? Array.from({ length: ctx.N }, () => new Float64Array(n)) : null;
  for (let s0 = 0, k = 0; s0 < n; s0 += ctx.CH, k++) {
    if (each) each(k, s0);
    osc.render(ctx, OL, OR, RAW);
    const c = Math.min(ctx.CH, n - s0);
    for (let s = 0; s < c; s++) { L[s0 + s] = OL[s]; R[s0 + s] = OR[s]; }
    if (raw) for (let i = 0; i < ctx.N; i++) for (let s = 0; s < c; s++) rows[i][s0 + s] = RAW[i * 32 + s];
  }
  return { L, R, rows };
}
const rms = (a, from = 0, to = a.length) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return Math.sqrt(e / Math.max(1, to - from)); };
// a started Granular oscillator on cp (entry e stored as 'smp:t' first when given)
function granOsc(t, cp, ctxOpts = {}, { e = null, v = voice(), ctxEdit = null, qr = null } = {}) {
  const { B, X } = t;
  if (e) assert.equal(B.storeAsset('smp:t', e), true);
  const g = new X.GranOsc(v, 0);
  assert.equal(g.apply(cp, 0, qr), true);
  const ctx = ctxOf(cp, ctxOpts);
  if (ctxEdit) ctxEdit(ctx);
  g.noteOn(ctx, true, false);
  return { g, ctx, v };
}
const GST = 16, G = { P: 0, PR: 1, AGE: 2, LEN: 3, GL: 5, GR: 6, WA: 7, SK: 8, U: 9, W1: 10, W2: 11 };

/* ------------------------------------------------------------------ loading and shape (§0.3, §11.8) */

test('loads in a bare scope and publishes only the frozen SxGran with the §11.8 API', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('sx-gran.js');
  assert.deepEqual([...names()].filter(k => !before.has(k)), ['SxGran']);
  const X = S.global('SxGran');
  assert.ok(X && Object.isFrozen(X) && Object.isFrozen(X.K));
  assert.deepEqual(Object.keys(X).sort(), ['GST', 'GranOsc', 'K', 'MAXCH', 'MAXGR', 'MAXUNI', 'NLADG', 'NSL', 'VER']);
  assert.deepEqual([X.VER, X.MAXCH, X.MAXUNI, X.MAXGR, X.GST, X.NSL, X.NLADG], [1, 32, 16, 256, 16, 258, 27]);
  const C = X.GranOsc;
  assert.equal(typeof C, 'function'); assert.equal(C.length, 2, 'constructor(voice, o)');
  const arity = { apply: 3, noteOn: 3, noteOff: 0, render: 4, kill: 0, active: 0, grains: 0 };
  for (const [m, n] of Object.entries(arity)) assert.equal(C.prototype[m].length, n, m);
  assert.equal(S.logs.length, 0, 'no console output on a clean load (SxBase / SxWarp are never read at load time)');
});

test('a throwing copy leaves SxGran null without throwing out of the script; re-evaluation gives a fresh object', () => {
  const S = dspScope({ files: ['sx-gran.js'], overrides: { 'sx-gran.js': src => src.replace('try {', 'try { throw new Error("boom");') } });
  assert.equal(S.global('SxGran'), null);
  assert.ok(S.logs.some(m => m.level === 'error' && /sx-gran: load failed/.test(m.text)));
  const { S: S2, X } = load();
  S2.reload('sx-gran.js');
  const X2 = S2.global('SxGran');
  assert.ok(X2 && X2 !== X && X2.VER === 1);
});

test('the source keeps the §0.3/§0.4 rules: one IIFE, environment neutral, no instanceof, no Math.random, lazy SxBase/SxWarp only', () => {
  const src = source('sx-gran.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code.trim(), /^\(function \(\) \{\n  'use strict';[\s\S]*\}\)\(\);$/);
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window', 'document',
    'self', 'instanceof', 'Math.random', 'SxSample', 'SxSpec', 'SerumDSP', 'SxMod', 'SxFilt2', 'SxSeq']) {
    assert.ok(!new RegExp('\\b' + w.replace('.', '\\.') + '\\b').test(code), w);
  }
  assert.deepEqual(code.match(/globalThis\.Sx\w+/g).sort(), ['globalThis.SxBase', 'globalThis.SxGran', 'globalThis.SxGran', 'globalThis.SxWarp']);
  assert.match(code, /function sxBase\(\) \{\n\s+const B = globalThis\.SxBase;/);
  assert.match(code, /function sxWarp\(\) \{\n\s+const W = globalThis\.SxWarp;/);
});

test('K: the O2 offsets match SxBase.DIDX2 and serum-core vi() for OSC A, B and C (and equal SxSample.K)', () => {
  const S = dspScope({ files: ['sx-base.js', 'sx-sample.js', 'sx-gran.js'] });
  const B = S.global('SxBase'), X = S.global('SxGran');
  assert.deepEqual({ ...X.K }, { ...S.global('SxSample').K });
  for (const P of ['a', 'b', 'c']) {
    const k0 = B.DIDX2[P.toUpperCase() + '_W1'];
    for (const [name, off] of Object.entries(X.K)) {
      const id = P + '.' + name.toLowerCase(), idx = core.DESTS.findIndex(d => d.id.toLowerCase() === id);
      assert.ok(idx >= 0, id);
      assert.equal(k0 + off, core.vi(idx), id);
    }
  }
});

/* ------------------------------------------------------------------ apply: shapes, selection, caps, allocation (§11.8, §4.1) */

test('apply: state is allocated only by the first apply that selects Granular (grain state Float64Array(256·16), ≤ 96 KB)', () => {
  const { X } = load();
  const def = core.compileSerum(core.defaultSerum(), {}).serum, cp = cpWith();
  const g = new X.GranOsc(voice(), 2);
  assert.equal(typedBytes(g), 0, 'no buffers in the constructor');
  assert.equal(g.apply(def, 2, null), true);
  assert.deepEqual([g.ok, g.sel, typedBytes(g)], [1, 0, 0]);
  assert.equal(g.apply(cp, 0, null), true);
  assert.deepEqual([g.sel, typedBytes(g)], [0, 0], 'OSC A is a Sample oscillator');
  assert.equal(g.apply(cp, 2, null), true);
  assert.equal(g.sel, 1);
  assert.equal(g.gs.length, 256 * 16); assert.equal(Object.prototype.toString.call(g.gs), '[object Float64Array]');
  const bytes = typedBytes(g) + g.ws.bytes + g.wsR.bytes + g.wg.bytes;
  assert.ok(bytes <= 96 * 1024, bytes + ' bytes ≤ 96 KB per Granular oscillator incl. its warp slots (§14.2)');
  const gs = g.gs;
  g.apply(def, 2, null); g.apply(cp, 2, null);
  assert.equal(g.gs, gs, 'reused, not reallocated');
});

test('apply copies the oscillator\'s options, ladders and the entry id', () => {
  const { X, B } = load();
  const cp = cpWith(), g = new X.GranOsc(voice(), 2);
  assert.equal(g.apply(cp, 2, null), true);
  assert.deepEqual([g.loop, g.loopGr, g.scanKey, g.scanLock, g.win, g.dens, g.densJump, g.glen, g.spawn, g.xyOn, g.xyY, g.xyMode],
    [1, 1, 1, 1, 4, 1, 0, 2, 2, 1, 4, 1]);
  assert.equal(g.slMode, 0, 'slicing compiled off while X|Y is on (§6.7.5)');
  assert.deepEqual([g.slOne, g.slRoot, g.slN, g.fm1, g.fm2, g.id, g.k0, g.kLen], [1, 60, 2, 1, 2, 'smp:g', B.DIDX2.C_W1, B.DIDX2.C_LENRATE]);
  assert.equal(g.densLadN, cp.sDensLadN[2]);
  assert.deepEqual(Array.from(g.densLad), Array.from(cp.sDensLad.subarray(54, 81)));
  assert.deepEqual(Array.from(g.glenLad), Array.from(cp.sGlenLad.subarray(54, 81)));
  assert.deepEqual(Array.from(g.sl), Array.from(cp.sSlPos.subarray(2 * 258, 3 * 258)));
  assert.deepEqual(Array.from(g.lad), Array.from(cp.lenLad));
  const dl = Array.from(g.densLad);
  cp.sDensLad.fill(7);
  assert.deepEqual(Array.from(g.densLad), dl, 'own copies');
});

test('caps: grMax = min(sMaxGr, qr grainsMax, 256), grProc = qr grainsProc; qr null ⇒ CP.qr', () => {
  const { X } = load();
  const g = new X.GranOsc(voice(), 2);
  const cp = cpWith();                                          // dens.max 100, CP.qr default [16, 256, 1, 32, 512]
  g.apply(cp, 2, null);
  assert.deepEqual([g.grMax, g.grProc], [100, 512]);
  g.apply(cp, 2, new Float64Array([16, 64, 1, 32, 256]));      // Q2-style reduction
  assert.deepEqual([g.grMax, g.grProc], [64, 256]);
  g.apply(cpWith(s => { s.osc[2].smpo.dens.max = 256; }), 2, [16, 128, 2, 16, 256]);
  assert.deepEqual([g.grMax, g.grProc], [128, 256]);
  g.apply(cpWith(s => { s.osc[2].smpo.dens.max = 256; }), 2, [16, 1000, 1, 32, 512]);
  assert.equal(g.grMax, 256, 'never above 256');
  g.apply(cpWith(s => { s.osc[2].smpo.dens.max = 1; }), 2, null);
  assert.equal(g.grMax, 1);
});

test('apply validates the CP shapes: any wrong field ⇒ false, silent, one console.warn per scope', () => {
  const { S, X } = load();
  const good = cpWith();
  const bad = [null, 5, { ...good, ver: 1 }, { ...good, base: undefined }, { ...good, oType: [0, 0, 3] },
    { ...good, sMaxGr: new Uint8Array(3) }, { ...good, sDensLad: new Float64Array(80) }, { ...good, sGlenLadN: undefined },
    { ...good, spawn: new Int8Array(3) }, { ...good, xyY: [0, 0, 0] }, { ...good, sSlPos: new Float64Array(774 - 1) },
    { ...good, smp: ['', '', 3] }, { ...good, smp: 'x' }, { ...good, qr: new Float32Array(5) }, { ...good, lenLad: new Float64Array(14) }];
  for (const cp of bad) {
    const g = new X.GranOsc(voice(), 2);
    assert.equal(g.apply(good, 2, null), true);
    assert.equal(g.apply(cp, 2, null), false);
    assert.deepEqual([g.ok, g.sel], [0, 0]);
    g.noteOn(oscCtx(2), true, false);
    assert.equal(g.active(), false, 'a rejected CP never plays');
  }
  for (const o of [-1, 3, NaN, undefined]) assert.equal(new X.GranOsc(voice(), 2).apply(good, o, null), false, 'o = ' + o);
  const g = new X.GranOsc(voice(), 2);
  assert.equal(g.apply(good, 2, [16, 256, 1, 32]), false);
  assert.equal(g.apply(good, 2, [16, 256, 1, Infinity, 512]), false);
  assert.equal(g.apply(good, 2, [16, 256, 1, 32, 512]), true);
  assert.equal(warns(S).length, 1, 'one warning per scope');
});

test('apply accepts CPs from another realm (typed arrays compared by tag, not instanceof)', () => {
  const { S, X } = load();
  const cp = cpWith(), g = new X.GranOsc(voice(), 2);
  const foreign = S.run('(function (cp) { const o = {}; for (const k of Object.keys(cp)) { const v = cp[k];'
    + ' o[k] = ArrayBuffer.isView(v) ? new globalThis[v.constructor.name](v) : Array.isArray(v) ? v.slice() : v; } return o; })', 'f.js')(cp);
  assert.equal(g.apply(foreign, 2, foreign.qr), true);
  assert.equal(g.sel, 1);
});

/* ------------------------------------------------------------------ note bookkeeping, silence, entries (§11.8, §4.5) */

test('noteOn / noteOff / kill / active / grains; a missing entry spawns nothing; kill returns the grains to sx.grains', () => {
  const t = load(), { X, B } = t;
  const g = new X.GranOsc(voice(), 2), ctx = oscCtx(2);
  g.noteOn(ctx, true, false);
  assert.equal(g.active(), false, 'never applied ⇒ silent');
  g.apply(cpWith(), 2, null);
  g.noteOn(ctx, true, false);
  assert.deepEqual([g.active(), g.gate, g.fresh, g.grains()], [true, 1, 1, 0]);
  g.noteOff();
  assert.deepEqual([g.active(), g.gate], [true, 0]);
  g.noteOn(ctx, false, true);
  assert.deepEqual([g.active(), g.gate], [true, 1]);
  const OL = new Float64Array(32), OR = new Float64Array(32);
  for (let k = 0; k < 10; k++) g.render(ctx, OL, OR, null);
  assert.equal(g.grains(), 0, 'no entry ⇒ no grain'); assert.equal(ctx.sx.grains, 0);
  g.kill();
  assert.deepEqual([g.active(), g.gate, g.grains()], [false, 0, 0]);
  g.apply(core.compileSerum(core.defaultSerum(), {}).serum, 2, null);
  g.noteOn(ctx, true, false);
  assert.equal(g.active(), false, 'type not selected ⇒ not playing');
  // with an entry: grains live, kill hands them back to the processor count
  const x = granOsc(t, cpG({ 'a.dens': nDens(100), 'a.glen': nGlen(0.2) }), {}, { e: entry('smp:t', 48000, () => 0.5) });
  play(x.g, x.ctx, 4800);
  assert.ok(x.g.grains() > 10 && x.ctx.sx.grains === x.g.grains());
  x.g.kill();
  assert.deepEqual([x.g.grains(), x.ctx.sx.grains, x.g.active()], [0, 0, false]);
  assert.ok(B.getAsset('smp:t'));
});

test('render overwrites ctx.CH samples of OL/OR (nothing beyond CH) and N raw stream rows at [u·32 + s]', () => {
  const { X } = load();
  const g = new X.GranOsc(voice(), 2);
  g.apply(cpWith(), 2, null);
  for (const [N, CH] of [[1, 4], [5, 8], [16, 32]]) {
    const ctx = oscCtx(2, N, CH);
    g.noteOn(ctx, true, false);
    const OL = new Float64Array(32).fill(9), OR = new Float64Array(32).fill(9), RAW = new Float64Array(16 * 32).fill(9);
    g.render(ctx, OL, OR, RAW);
    for (let s = 0; s < 32; s++) { assert.equal(OL[s], s < CH ? 0 : 9); assert.equal(OR[s], s < CH ? 0 : 9); }
    for (let u = 0; u < 16; u++) for (let s = 0; s < 32; s++) assert.equal(RAW[u * 32 + s], u < N && s < CH ? 0 : 9, `RAW[${u}·32 + ${s}]`);
    g.kill();
  }
});

test('entries: resolved by asset epoch while playing; missing ⇒ null until it arrives (within one chunk); wrong kind ignored', () => {
  const { B, X } = load();
  const g = new X.GranOsc(voice(), 2), ctx = oscCtx(2), OL = new Float64Array(32), OR = new Float64Array(32);
  g.apply(cpWith(), 2, null);
  g.noteOn(ctx, true, false);
  g.render(ctx, OL, OR, null);
  assert.equal(g.e, null);
  assert.equal(B.storeAsset('smp:g', smpEntry('smp:g')), true);
  g.render(ctx, OL, OR, null);
  assert.equal(g.e, B.getAsset('smp:g'));
  assert.ok(g.grains() > 0, 'grains in the chunk the entry arrived');
  B.dropAsset('smp:g');
  g.render(ctx, OL, OR, null);
  assert.equal(g.e, null); assert.equal(g.grains(), 0, 'grains of a dropped entry are released');
  assert.equal(ctx.sx.grains, 0);
  assert.equal(B.storeAsset('smp:g', { id: 'smp:g', v: 1, kind: 'multi', bytes: 0, zones: [] }), true);
  g.render(ctx, OL, OR, null);
  assert.equal(g.e, null, 'a multi entry is not a granular source');
  g.apply(cpWith(s => { s.osc[2].smp = ''; }), 2, null);
  assert.deepEqual([g.id, g.e], ['', null]);
});

/* ------------------------------------------------------------------ spawning (§6.9.2) */

test('spawn rate: grains spawned over 1 s ± 1 per stream in Free, BPM and Grains density; spawn patterns spread the streams', () => {
  const t = load();
  const e = entry('smp:t', 96000, () => 0.5);
  const count = (p, edit, { N = 1, secs = 1 } = {}) => {
    const cp = cpG({ 'a.glen': nGlen(0.005), ...p }, s => { s.osc[0].smpo.dens.jump = 0; s.osc[0].smpo.loop = 1; if (edit) edit(s); });
    const { g, ctx, v } = granOsc(t, cp, { N }, { e });
    const d0 = v.draws;
    play(g, ctx, 48000 * secs);
    return { spawns: (v.draws - d0) / 10, g, v, d0 };
  };
  const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got} (want ${want} ± ${tol})`);
  near(count({ 'a.dens': nDens(40) }).spawns, 40, 1, 'Free 40 Hz');
  near(count({ 'a.dens': nDens(7.5) }).spawns, 7.5, 1, 'Free 7.5 Hz');
  near(count({ 'a.dens': 0.5 }, s => { s.osc[0].smpo.dens.mode = 1; }).spawns, 4, 1, 'BPM: 1/8 at 120 BPM');
  near(count({ 'a.dens': 1 }, s => { s.osc[0].smpo.dens.mode = 1; }).spawns, 128, 1, 'BPM: 1/256 at 120 BPM');
  // Grains: K = round(1 + 63·dn) grains per grain length (50 ms here) ⇒ 20·K per second
  near(count({ 'a.dens': 15 / 63, 'a.glen': nGlen(0.05) }, s => { s.osc[0].smpo.dens.mode = 2; }).spawns, 320, 1, 'Grains: K 16 over 50 ms');
  // N streams: each spawns at the rate (Random draws one extra value per spawn)
  for (const spawn of [0, 1, 2]) near(count({ 'a.dens': nDens(40) }, s => { s.osc[0].uni.spawn = spawn; }, { N: 4 }).spawns, 160, 4, 'N 4 spawn ' + spawn);
  const r = count({ 'a.dens': nDens(40) }, s => { s.osc[0].uni.spawn = 3; }, { N: 4 });
  near(r.spawns * 10 / 11, 160, 4, 'Random');
  // the first scheduled spawn of stream u (clock units of T_s): Together 1, Even u/N, Exp 2^(u/N) − 1, Random 1 + U (§6.9.2)
  for (const [spawn, want] of [[0, [1, 1, 1, 1]], [1, [1, 0.25, 0.5, 0.75]], [2, [1, 2 ** 0.25 - 1, 2 ** 0.5 - 1, 2 ** 0.75 - 1]]]) {
    const cp = cpG({}, s => { s.osc[0].uni.spawn = spawn; });
    const { g } = granOsc(t, cp, { N: 4 });
    assert.deepEqual([0, 1, 2, 3].map(u => +g.ss[u * 16 + 4].toFixed(12)), want.map(x => +x.toFixed(12)), 'pattern ' + spawn);
  }
  const vr = voice(5), uu = voice(5);
  const { g } = granOsc(t, cpG({}, s => { s.osc[0].uni.spawn = 3; }), { N: 2 }, { v: vr });
  assert.deepEqual([g.ss[4], g.ss[20]], [1 + uu.rnd2(), 1 + uu.rnd2()], 'Random: 1 + U per stream');
});

test('Jump Start: ceil(L_g/T_s) grains per stream at note-on with ages j·T_s; off: one grain per stream', () => {
  const t = load();
  const e = entry('smp:t', 96000, () => 0.5);
  for (const [jump, N, want] of [[1, 1, 8], [1, 3, 24], [0, 1, 1], [0, 4, 4]]) {
    const cp = cpG({ 'a.dens': nDens(40), 'a.glen': nGlen(0.2) }, s => { s.osc[0].smpo.dens.jump = jump; });
    const { g, ctx } = granOsc(t, cp, { N }, { e });
    play(g, ctx, 32);
    assert.equal(g.grains(), want, `jump ${jump}, N ${N}`);
    if (jump && N === 1) {
      const ages = []; for (let i = 0; i < 8; i++) ages.push(g.gs[i * GST + G.AGE]);
      assert.deepEqual(ages.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7].map(j => j * 1200 + 32), 'ages j·T_s (+ the chunk)');
    }
  }
});

test('caps: per oscillator min(sMaxGr, grainsMax, 256) never exceeded; a spawn at a cap is skipped, never a running grain cut', () => {
  const t = load();
  const e = entry('smp:t', 96000, () => 0.5);
  const cp = cpG({ 'a.dens': nDens(400), 'a.glen': nGlen(0.5) }, s => { s.osc[0].smpo.dens.max = 10; s.osc[0].smpo.loop = 1; });
  const { g, ctx } = granOsc(t, cp, { N: 2 }, { e });
  let mx = 0, sum = 0, cnt = 0, mxU = 0;
  const ages = new Map();
  play(g, ctx, 24000, { each: k => {
    mx = Math.max(mx, g.grains()); mxU = Math.max(mxU, g.cU[0], g.cU[1]);
    if (k >= 375) { sum += g.grains(); cnt++; }
  } });
  assert.equal(mx, 10);
  assert.ok(sum / cnt >= 8.5, 'the cap stays filled: ' + (sum / cnt).toFixed(2));
  assert.equal(mxU, 5, 'the two streams share it: 5 each');
  for (let i = 0; i < g.grains(); i++) ages.set(i, g.gs[i * GST + G.AGE]);
  assert.ok([...ages.values()].every(a => a > 0), 'running grains keep running');
  const x = granOsc(t, cp, { N: 1 }, { e, qr: [16, 3, 1, 32, 512] });
  play(x.g, x.ctx, 4800);
  assert.equal(x.g.grains(), 3, 'qr grainsMax 3');
});

test('processor cap grainsProc: older voices spawn only below it; the most recent voice sounds at once (overshoot ≤ grainsProc/2) and its oscillators split the cap', () => {
  const t = load(), { X } = t;
  const e = entry('smp:t', 96000, () => 0.5);
  t.B.storeAsset('smp:t', e);
  const cp = cpG({ 'a.dens': nDens(200), 'a.glen': nGlen(0.4) }, s => { s.osc[0].smpo.loop = 1; });
  const sx = { grains: 0 }, qr = [16, 256, 1, 32, 64], P = 64;
  const vs = [], oscs = [], ctxs = [];
  for (let k = 0; k < 8; k++) {
    const v = Object.assign(voice(100 + k), { proc: { sx } });       // apply creates the registry sx.granQ (§6.9.2 shares)
    vs.push(v);
    for (let o = 0; o < 3; o++) {
      const g = new X.GranOsc(v, o);
      assert.equal(g.apply(cp, 0, qr), true);
      assert.equal(g.grProc, P);
      oscs.push(g); ctxs.push(ctxOf(cp, { sx }));
    }
  }
  const OL = new Float64Array(32), OR = new Float64Array(32);
  let mx = 0;
  const step = (chunks) => {
    for (let c = 0; c < chunks; c++) {
      for (let j = 0; j < oscs.length; j++) oscs[j].render(ctxs[j], OL, OR, null);
      mx = Math.max(mx, sx.grains);
      assert.equal(sx.grains, oscs.reduce((a, g) => a + g.grains(), 0), 'the processor count is the sum of live grains');
    }
  };
  const per = k => oscs.slice(3 * k, 3 * k + 3).map(g => g.grains());
  const voiceGrains = k => per(k).reduce((a, b) => a + b, 0);
  for (let k = 0; k < 8; k++) {
    for (let o = 0; o < 3; o++) oscs[3 * k + o].noteOn(ctxs[3 * k + o], true, false);
    step(1);
    // at once while the overshoot room lasts (voice 1 here, the cap being full of voice 0's grains; M2: no grain until
    // older grains ended); later notes 33 ms apart share what is left of it or wait for the first older grains to end
    if (k <= 1) assert.ok(per(k).every(n => n >= 10), `voice ${k} sounds at note-on: ${per(k)}`);
    step(49);
  }
  assert.ok(mx <= P + P / 2, 'never above 1.5 × grainsProc: ' + mx);
  assert.equal(sx.granLast, vs[7], 'the most recent granular voice');
  // the oldest voices thin out (spawns skipped below the cap only, their 0.4 s grains finish); the newest voice's three
  // oscillators share the cap (≈ 64/3 each), and the count is back at the cap
  step(650);
  const g7 = per(7);
  assert.ok(voiceGrains(7) >= P - 3 && g7.every(n => Math.abs(n - P / 3) <= 2), 'the most recent voice holds the cap, split fairly: ' + g7);
  assert.ok(sx.grains <= P + 1 && mx <= P + P / 2, 'back at the cap: ' + sx.grains);
  // a new note on voice 0 takes over in turn; no running grain is cut, it sounds at once
  for (let o = 0; o < 3; o++) { oscs[o].kill(); oscs[o].noteOn(ctxs[o], true, false); }
  assert.equal(sx.granLast, vs[0]);
  const n7 = voiceGrains(7);
  step(1);
  assert.ok(voiceGrains(7) >= n7 - 3, 'running grains are not cut');
  assert.ok(per(0).every(n => n >= 10), 'the new note sounds at once: ' + per(0));
  step(650);
  assert.ok(voiceGrains(0) >= P - 3 && mx <= P + P / 2, 'the newest voice gets the freed slots: ' + voiceGrains(0) + ' of ' + P);
  // one voice whose oscillators want more than the cap together: a fair split without overshoot (M2: 1/255/256)
  const sx2 = { grains: 0 }, v = Object.assign(voice(7), { proc: { sx: sx2 } }), cp2 = cpG({ 'a.dens': 1, 'a.glen': 0.75 }, s => { s.osc[0].smpo.loop = 1; });
  const three = [0, 1, 2].map(o => { const g = new X.GranOsc(v, o); g.apply(cp2, 0, [16, 256, 1, 32, 512]); return g; });
  const c3 = three.map(() => ctxOf(cp2, { sx: sx2, fs: 96000, CH: 8 }));
  three.forEach((g, i) => g.noteOn(c3[i], true, false));
  let mx2 = 0;
  for (let c = 0; c < 3000; c++) { three.forEach((g, i) => g.render(c3[i], OL, OR, null)); mx2 = Math.max(mx2, sx2.grains); }
  assert.ok(mx2 <= 512 && three.every(g => Math.abs(g.grains() - 512 / 3) <= 3), 'one voice: ' + three.map(g => g.grains()) + ', max ' + mx2);
});

/* ------------------------------------------------------------------ review round (M2 → M3) */

const dB = x => 20 * Math.log10(x);
const panLaw = (p, r) => (p === 0 ? 1 : Math.SQRT2 * (r ? Math.sin((p + 1) * Math.PI / 4) : Math.cos((p + 1) * Math.PI / 4)));

test('Jump Start: jump grains read where steady-state grains would (P + age·(inc − dps)) — the first L_g/2 is within 1 dB of the steady level', () => {
  const t = load();
  let a = 1;
  const rnd = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296 - 0.5; };
  const noise = Float32Array.from({ length: 48000 * 4 }, () => rnd());
  for (const [lbl, fn, hz, gl] of [['440 Hz sine', j => 0.5 * Math.sin(2 * Math.PI * 440 * j / 48000), 50, 0.2], ['white noise', j => noise[j], 100, 0.2]]) {
    const cp = cpG({ 'a.dens': nDens(hz), 'a.glen': nGlen(gl) }, s => { s.osc[0].smpo.loop = 1; });
    const { g, ctx } = granOsc(t, cp, { f: fRoot(60) }, { e: entry('smp:t', 48000 * 4, fn), v: voice(108) });
    const r = play(g, ctx, 96000).L, w = Math.round(gl * 48000 / 2);
    const d = dB(rms(r, 0, w) / rms(r, 48000, 96000));
    assert.ok(Math.abs(d) <= 1, `${lbl}: first L_g/2 at ${d.toFixed(2)} dB re steady state (M2: −34.6 / −9.2 dB)`);
  }
});

test('caps: the unison streams share the oscillator\'s cap (grMax/N each) — the stereo image holds at a cap', () => {
  const t = load(), N = 4;
  const e = entry('smp:t', 96000, j => 0.5 * Math.sin(2 * Math.PI * 220 * j / 48000), { root: 57 });
  for (const [p, max, qr, want] of [[{ 'a.dens': 0.7, 'a.glen': 0.6 }, 16, null, 4], [{ 'a.dens': 0.8, 'a.glen': 0.6 }, 256, [4, 64, 2, 8, 128], 16],
    [{ 'a.dens': 1, 'a.glen': 0.75 }, 256, null, 64]]) {
    const cp = cpG(p, s => { s.osc[0].smpo.loop = 1; s.osc[0].smpo.dens.max = max; });
    const { g, ctx } = granOsc(t, cp, { N, fs: 96000, CH: 8, f: fRoot(57) }, { e, qr, ctxEdit: c => {
      for (let u = 0; u < N; u++) { const pn = -1 + 2 * u / (N - 1), a = (pn + 1) * Math.PI / 4; c.gl[u] = Math.cos(a); c.gr[u] = Math.sin(a); c.pan[u] = pn; }
    } });
    const r = play(g, ctx, 192000);
    const per = new Array(N).fill(0);
    for (let i = 0; i < g.grains(); i++) per[g.gs[i * GST + G.U]]++;
    assert.ok(per.every(c => Math.abs(c - want) <= 1), `max ${max}: per stream ${per} (want ${want}; M2: 13/2/0/0 …)`);
    let eL = 0, eR = 0;
    for (let s = 96000; s < 192000; s++) { eL += r.L[s] * r.L[s]; eR += r.R[s] * r.R[s]; }
    assert.ok(Math.abs(10 * Math.log10(eL / eR)) < 0.5, 'L/R balance ' + (10 * Math.log10(eL / eR)).toFixed(2) + ' dB');
  }
});

test('grain pan (§6.9.3) with ctx.ownPan: one equal-power law at clamp(stream pan + rpan·(2u − 1)) — a hard-left stream reaches R; raw tap pre pan', () => {
  const t = load();
  const e = entry('smp:t', 96000, j => 0.5 * Math.sin(j / 20));
  const cp = cpG({ 'a.dens': nDens(100), 'a.glen': nGlen(0.1), 'a.rpan': 1 }, s => { s.osc[0].smpo.loop = 1; });
  for (const own of [1, 0]) {
    const { g, ctx } = granOsc(t, cp, { N: 2, f: fRoot(60) }, { e, v: voice(3), ctxEdit: c => {
      c.ownPan = own; c.pan[0] = -1; c.pan[1] = 1;
      c.gl[0] = own ? 1 : panLaw(-1, 0); c.gr[0] = own ? 1 : panLaw(-1, 1); c.gl[1] = 0; c.gr[1] = 0;   // stream 1 muted
    } });
    const r = play(g, ctx, 48000);
    let eL = 0, eR = 0;
    for (let s = 0; s < r.L.length; s++) { eL += r.L[s] * r.L[s]; eR += r.R[s] * r.R[s]; }
    if (own) {
      // half of the grains clamp at −1, the others spread over [−1, 0]: R/L energy ≈ 0.1
      assert.ok(eR > 0.03 * eL, `the grains of a hard-left stream spread toward the centre: R/L energy ${(eR / eL).toFixed(3)} (M2: 0)`);
      let n0 = 0;
      for (let i = 0; i < g.grains(); i++) {
        const b = i * GST, gL = g.gs[b + G.GL], gR = g.gs[b + G.GR];
        if (g.gs[b + G.U] !== 0) continue;
        n0++;
        assert.ok(gR <= gL + 1e-12, 'pan ≤ 0 (clamped at −1 + δ, δ ≤ 1)');
        assert.ok(Math.abs(gL * gL + gR * gR - 2 * g.ovl * g.ovl) < 1e-9, 'one equal-power law (Σ g² = 2·level²)');
      }
      assert.ok(n0 > 0);
    } else assert.equal(eR, 0, 'without ctx.ownPan the voice\'s gains carry the stream pan (legacy balance law)');
  }
  // raw tap: the stream's mono grain sum before pan (a hard-left stream without Rand Pan)
  const cp0 = cpG({ 'a.dens': nDens(100), 'a.glen': nGlen(0.1) }, s => { s.osc[0].smpo.loop = 1; });
  const { g, ctx } = granOsc(t, cp0, { N: 1, f: fRoot(60) }, { e, ctxEdit: c => { c.ownPan = 1; c.pan[0] = -1; } });
  const r = play(g, ctx, 9600, { raw: true });
  for (let s = 4800; s < 9600; s++) assert.ok(Math.abs(r.rows[0][s] - r.L[s] / Math.SQRT2) < 1e-9, 'raw = the unpanned sum');
});

test('grain reads stay in the region (reflected at its ends): material past E is never heard, a grain running off the sample end has no step', () => {
  const t = load();
  // a quiet sine before E = 0.5, a constant 1 after it (M2: 1.94 peak from the cut-off material)
  for (const loop of [0, 1]) {
    const e = entry('smp:t', 96000, j => (j < 48000 ? 0.1 * Math.sin(j / 20) : 1));
    const cp = cpG({ 'a.send': 0.5, 'a.dens': nDens(50), 'a.glen': nGlen(0.3), 'a.lstart': 0, 'a.lend': 0.5 }, s => { s.osc[0].smpo.loop = loop; });
    const { g, ctx } = granOsc(t, cp, { f: fRoot(60) }, { e, v: voice(3) });
    const r = play(g, ctx, 4000 * 32);
    let mx = 0;
    for (let s = 0; s < r.L.length; s++) mx = Math.max(mx, Math.abs(r.L[s]));
    assert.ok(mx < 0.5, `loop ${loop}: max |out| ${mx.toFixed(3)}`);
  }
  // one grain at a time (2 Hz, 0.4 s) from S + Position = 0.9 of a sine sample that ends mid-cycle: the reads reflect at
  // the last frame (M2: a step to silence, 20–66 × the slope)
  const A = 0.5, f0 = 220, len = 48077, slope = 2 * Math.PI * f0 / 48000 * A;
  const e = entry('smp:t', len, j => A * Math.sin(2 * Math.PI * f0 * j / 48000), { root: 57 });
  for (const p of [{}, { 'a.rpitch': 1 }, { 'a.rdir': 1 }]) {
    const cp = cpG({ 'a.dens': nDens(2), 'a.glen': nGlen(0.4), 'a.scan': 0.5, 'a.pos': 0.9, ...p });
    const { g, ctx } = granOsc(t, cp, { f: fRoot(57) }, { e, v: voice(5) });
    const r = play(g, ctx, 96000);
    let st = 0;
    for (let s = 1; s < r.L.length; s++) st = Math.max(st, Math.abs(r.L[s] - r.L[s - 1]));
    assert.ok(st <= 2 * slope, `${JSON.stringify(p)}: max step ${(st / slope).toFixed(2)} × the slope`);
  }
});

test('stream playheads: Fwd/Rwd landing exactly on LE reflects (no jump); a reverse-scanned Tailed stream runs the whole region first', () => {
  const t = load();
  const e = entry('smp:t', 24000, j => 0.5 * Math.sin(2 * Math.PI * 220 * j / 48000), { root: 57 });
  const cp = cpG({}, s => { s.osc[0].smpo.loop = 3; });
  const { g, ctx } = granOsc(t, cp, { f: fRoot(57), fs: 96000, CH: 32 }, { e });
  const pos = [];
  play(g, ctx, 96000 * 4, { each: () => pos.push(g.mPos) });
  for (let k = 1; k < pos.length; k++) assert.ok(Math.abs(pos[k] - pos[k - 1]) < 0.01, `chunk ${k}: ${pos[k - 1]} → ${pos[k]} (M2: 0.999 → 0)`);
  const cpT = cpG({ 'a.scanrev': 1 }, s => { s.osc[0].smpo.loop = 4; });
  const x = granOsc(t, cpT, { f: fRoot(57), fs: 48000, CH: 32 }, { e });
  const pT = [];
  play(x.g, x.ctx, 48000 * 2, { each: () => pT.push(x.g.mPos) });
  assert.ok(Math.abs(pT[1] - 1) < 0.002 && Math.min(...pT.slice(0, 760)) < 0.01, 'from E down to S first');
  assert.ok(pT.slice(800).every(p => p <= 0.5 + 1e-9), 'then the tail [S, M]');
});

test('Loop Grains: warped reads (Odd/Even, PD (Self)) wrap into the loop — material past LE is not read (interpolation seams excepted)', () => {
  const t = load(), T0 = 2048, ROOT0 = 69 + 12 * Math.log2(48000 / T0 / 440), L = 64 * T0, LE = 32 * T0;
  const sine = j => 0.8 * Math.sin(2 * Math.PI * j / T0), id = x => core.WARPS2.findIndex(w => w.id === x);
  const run = (fn, mode, w) => {
    const cp = cpG({ 'a.dens': nDens(3), 'a.glen': nGlen(0.3), 'a.lstart': 0, 'a.lend': 0.5, 'a.sstart': 0.4, 'a.scan': 0.5 },
      s => { s.osc[0].smpo.loop = 1; s.osc[0].smpo.loopGrains = 1; s.osc[0].smpo.dens.jump = 0; });
    const { g, ctx } = granOsc(t, cp, { f: 48000 / T0 }, { e: entry('smp:t', L, j => (j < LE ? sine(j) : fn(j)), { nLv: 8, root: ROOT0 }), v: voice(9),
      ctxEdit: c => { c.mode1 = mode; c.w1.fill(w); } });
    return play(g, ctx, 48000).L;
  };
  const a = run(sine, id('oddeven'), 0), b = run(() => 1, id('oddeven'), 0);
  let cnt = 0;
  for (let s = 0; s < a.length; s++) if (Math.abs(a[s] - b[s]) > 1e-6) cnt++;
  assert.ok(cnt <= 24, `Odd/Even: ${cnt} samples depend on the material past LE`);
  // PD (Self) feeds a seam difference back, so count the samples that play the 1.0 material (one grain at a time)
  const c = run(sine, id('pd_self'), 0.6), d = run(() => 1, id('pd_self'), 0.6);
  assert.ok(Math.max(...c.map(Math.abs)) < 0.85, 'the reference stays inside the sine');
  const over = d.filter(x => Math.abs(x) > 0.85).length;
  assert.ok(over <= 8, `PD (Self): ${over} samples play the material past LE`);
});

test('a non-legato retrigger fades the running grains out (≤ 5 ms) and the new note\'s Jump Start fills the cap right after', () => {
  const t = load();
  const e = entry('smp:t', 96000, j => 0.5 * Math.sin(2 * Math.PI * 220 * j / 48000), { root: 57 });
  const cp = cpG({ 'a.dens': 1, 'a.glen': 0.75 }, s => { s.osc[0].smpo.loop = 1; });
  const { g, ctx } = granOsc(t, cp, { fs: 96000, CH: 8, f: fRoot(57) }, { e });
  play(g, ctx, 48000);
  assert.equal(g.grains(), 256, 'saturated');
  g.noteOn(ctx, false, false);
  let n = 0;
  const r = play(g, ctx, 960, { each: () => { if (g.nFade === 0 && n === 0) n = g.grains(); } });
  assert.ok(g.nFade === 0 && g.grains() >= 250, `5 ms later: the old grains are gone, ${g.grains()} new ones (M2: 0 new after 100 ms)`);
  for (let i = 0; i < g.grains(); i++) assert.equal(g.gs[i * GST + 15], 0, 'no grain fading');
  let st = 0;                                                        // the fade-out itself (the Jump Start then starts at full
  for (let s = 1; s < 470; s++) st = Math.max(st, Math.abs(r.L[s] - r.L[s - 1]));   // density, as at any note-on)
  assert.ok(st < 0.05, 'the old grains fade without a click: ' + st);
});

/* ------------------------------------------------------------------ playheads, X|Y, slicing (§6.9.1) */

test('stream playheads: stream u starts at S + Δ_u and advances by σ (no pitch); Manual X|Y: pos·L + Δ_u, no scanning; v 0 freezes', () => {
  const t = load(), { B } = t;
  const L = 48000, e = entry('smp:t', L, j => j / L);
  const cp = cpG({ 'a.sstart': 0.1, 'a.uspan': 0, 'a.scan': 1 }, s => { s.osc[0].smpo.loop = 0; });
  const { g, ctx } = granOsc(t, cp, { N: 4, f: 3 * fRoot(60) }, { e, ctxEdit: c => ef(c, B, 'USPAN', 1) });
  const RL = 0.9 * L;
  assert.deepEqual([0, 1, 2, 3].map(u => Math.round(g.ss[u * 16])), [0, 1, 2, 3].map(u => Math.round(0.1 * L + u / 4 * RL)), 'S + SPAN·u/N');
  play(g, ctx, 3200);
  assert.ok(Math.abs(g.ss[0] - (0.1 * L + 3200 * 2)) < 1e-6, 'σ 2 (SCAN 100 % of ±200 %), ρ 3 ignored: ' + g.ss[0]);
  // Manual X|Y: the SCAN knob is X = k.pos; streams sit at pos·L + Δ_u
  const cx = cpG({ 'a.pos': 0.3, 'a.scan': 1 }, s => { s.osc[0].xy = { on: 1, y: 0, yMode: 0 }; });
  const x = granOsc(t, cx, { N: 2 }, { e, ctxEdit: c => ef(c, B, 'USPAN', 0.5) });
  play(x.g, x.ctx, 3200);
  assert.deepEqual([Math.round(x.g.ss[0]), Math.round(x.g.ss[16])], [0.3 * L, 0.3 * L + 0.25 * L], 'X|Y positions');
  // v 0 (SCAN n 0.5) freezes the playhead
  const z = granOsc(t, cpG({ 'a.scan': 0.5, 'a.sstart': 0.2 }), {}, { e });
  play(z.g, z.ctx, 3200);
  assert.equal(z.g.ss[0], 0.2 * L);
});

test('slicing: key → slice region for the streams; ignored while X|Y is on (the slicing state is kept)', () => {
  const t = load();
  const L = 48000, e = entry('smp:t', L, j => j / L);
  const sl = s => { s.osc[0].smpo.slice = { mode: 2, thr: 0.5, marks: [0.5], toEnd: 0, single: 0, root: 60, sync: 0 }; };
  const a = granOsc(t, cpG({}, sl), { key: 61 }, { e });
  assert.deepEqual([a.g.sliced, a.g.ss[0]], [1, 0.5 * L], 'key 61 → slice 1');
  const b = granOsc(t, cpG({}, sl), { key: 63 }, { e });
  play(b.g, b.ctx, 64);
  assert.deepEqual([b.g.grains(), b.g.active()], [0, false], 'outside the slices: silent');
  const cxy = cpG({ 'a.pos': 0.1 }, s => { sl(s); s.osc[0].xy = { on: 1, y: 0, yMode: 0 }; });
  assert.equal(cxy.sSlMode[0], 0, 'compiled off under X|Y');
  cxy.sSlMode[0] = 2;                                        // and the oscillator ignores slicing under X|Y by itself
  const c = granOsc(t, cxy, { key: 63 }, { e });
  play(c.g, c.ctx, 64);
  assert.deepEqual([c.g.sliced, Math.round(c.g.ss[0]), c.g.grains() > 0], [0, 0.1 * L, true]);
});

/* ------------------------------------------------------------------ per-grain values, windows (§6.9.3, §6.9.4) */

test('per-grain randomisation: length, direction, pitch, pan, level, window amount/skew within their ranges; deterministic per seed', () => {
  const t = load(), { B } = t;
  const e = entry('smp:t', 96000, p => 0.3 * Math.sin(p / 40));
  const p = { 'a.dens': nDens(300), 'a.glen': nGlen(0.1), 'a.rlen': 0.5, 'a.rpitch': 1, 'a.rdir': 0.5, 'a.rpan': 1, 'a.rlvl': 0.5,
    'a.rwamt': 0.5, 'a.rwskew': 0.5, 'a.roff': 1, 'a.wamt': 0.8 };
  const run = (seed) => {
    const { g, ctx } = granOsc(t, cpG(p, s => { s.osc[0].smpo.loop = 1; }), {}, { e, v: voice(seed) });
    const stats = { len: [], pr: [], gl: [], wa: [], sk: [] };
    const r = play(g, ctx, 9600, { each: (k) => {
      if (k % 40 !== 39) return;                             // the live grains every 40 chunks (spans of 26 ms < the grains)
      for (let i = 0; i < g.grains(); i++) {
        const b = i * GST;
        stats.len.push(g.gs[b + G.LEN]); stats.pr.push(g.gs[b + G.PR]); stats.gl.push([g.gs[b + G.GL], g.gs[b + G.GR]]);
        stats.wa.push(g.gs[b + G.WA]); stats.sk.push(g.gs[b + G.SK]);
      }
    } });
    return { stats, r, g };
  };
  const a = run(11), { stats } = a, Lg = 0.1 * 48000, ovl = 1 / Math.sqrt(0.1 * 300);
  assert.ok(stats.len.length > 20, 'grains seen: ' + stats.len.length);
  assert.ok(stats.len.every(l => l >= Math.floor(Lg / Math.SQRT2) && l <= Math.ceil(Lg * Math.SQRT2)), 'length × 2^±rlen');
  assert.ok(Math.max(...stats.len) > 1.3 * Lg && Math.min(...stats.len) < 0.75 * Lg, 'lengths spread');
  assert.ok(stats.pr.every(x => Math.abs(x) >= 0.5 - 1e-12 && Math.abs(x) <= 2 + 1e-12), 'pitch 2^(±12/12)');
  const rev = stats.pr.filter(x => x < 0).length / stats.pr.length;
  assert.ok(rev > 0.1 && rev < 0.45, 'Rand Dir 0.5 reverses about a quarter: ' + rev.toFixed(2));
  for (const [l, r] of stats.gl) {
    const lvl = Math.hypot(l, r) / Math.SQRT2;               // equal-power pan keeps l² + r² = 2·level²
    assert.ok(lvl >= 0.5 * ovl - 1e-9 && lvl <= ovl + 1e-9, 'level (1 − rlvl·u)·overlap');
  }
  assert.ok(stats.gl.some(([l, r]) => l > 1.2 * r) && stats.gl.some(([l, r]) => r > 1.2 * l), 'pans spread both ways');
  assert.ok(stats.wa.every(w => w >= 0.3 - 1e-12 && w <= 1), 'window amount wamt ± rwamt, clamped');
  assert.ok(stats.sk.every(s => s >= -0.5 - 1e-12 && s <= 0.5 + 1e-12) && stats.sk.some(s => s > 0.2) && stats.sk.some(s => s < -0.2), 'skew ± rwskew');
  // determinism: the same r2 seed renders the same audio; another seed differs
  const b = run(11), c = run(12);
  assert.deepEqual(Array.from(a.r.L), Array.from(b.r.L));
  assert.ok(a.r.L.some((x, i) => x !== c.r.L[i]));
  assert.ok(B.getAsset('smp:t'));
});

test('windows: a lone grain on a DC sample is its window W(t) for each of the 10 shapes; AMOUNT blends toward 1; SKEW moves the peak', () => {
  const t = load(), { B } = t;
  const e = entry('smp:t', 96000, () => 1);
  const sinc = x => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const Wf = [u => 0.5 - 0.5 * Math.cos(2 * Math.PI * u), u => 1 - (2 * u - 1) ** 2, u => Math.exp(-0.5 * ((u - 0.5) / 0.15) ** 2),
    u => 0.35875 - 0.48829 * Math.cos(2 * Math.PI * u) + 0.14128 * Math.cos(4 * Math.PI * u) - 0.01168 * Math.cos(6 * Math.PI * u),
    u => sinc(4 * (2 * u - 1)) * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)),
    u => (u < 0.25 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u / 0.5) : u > 0.75 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * (1 - u) / 0.5) : 1),
    u => 1 - Math.abs(2 * u - 1), u => Math.min(1, 4 * u, 4 * (1 - u)), u => Math.exp(-6 * u) * Math.min(1, 200 * u),
    u => Math.exp(-6 * (1 - u)) * Math.min(1, 200 * (1 - u))];
  const grain = (win, wamt = 1, skew = 0.5) => {
    const cp = cpG({ 'a.dens': 0, 'a.glen': nGlen(0.1), 'a.wamt': wamt, 'a.wskew': skew }, s => { s.osc[0].smpo.win = win; s.osc[0].smpo.dens.jump = 0; });
    const { g, ctx } = granOsc(t, cp, {}, { e });
    const r = play(g, ctx, 4832);
    assert.equal(g.grains(), 0, 'the grain ended');
    return r.L;
  };
  for (let w = 0; w < 10; w++) {
    const y = grain(w), tab = B.WIN_TAB, b = w * 1025;
    let eT = 0, eF = 0;
    for (let s = 0; s < 4800; s++) {
      const u = s / 4799, x = u * 1024, j = Math.min(1023, Math.floor(x));
      eT = Math.max(eT, Math.abs(y[s] - (tab[b + j] + (tab[b + j + 1] - tab[b + j]) * (x - j))));
      eF = Math.max(eF, Math.abs(y[s] - Wf[w](u)));
    }
    assert.ok(eT < 1e-9, `window ${w}: grain envelope = the table (${eT})`);
    assert.ok(eF < 0.03, `window ${w}: ≈ the §3.8 formula (${eF})`);
    assert.equal(y[4800], 0);
  }
  // AMOUNT a: 1 − a + a·W
  const h = grain(0, 0.25);
  assert.ok(Math.abs(h[0] - 0.75) < 1e-9 && Math.abs(h[2400] - 1) < 1e-6, 'amount 25 %');
  // SKEW s: t_s = t^(1/(1+3s)) (s > 0), 1 − (1 − t)^(1/(1+3|s|)) (s < 0): the Hann peak moves to 0.5^(1+3s); t_s is exact
  // at chunk ends and per sample in the two chunks at the steep end, linear in between (no per-sample pow): ≤ 0.01
  for (const [n, want] of [[0.75, 0.5 ** 2.5], [0.25, 1 - 0.5 ** 2.5], [1, 0.5 ** 4], [0, 1 - 0.5 ** 4]]) {
    const y = grain(0, 1, n), sk = 2 * n - 1;
    let k = 0, err = 0;
    for (let s = 1; s < 4800; s++) if (y[s] > y[k]) k = s;
    for (let s = 0; s < 4800; s++) {
      const u = s / 4799, ts = sk > 0 ? u ** (1 / (1 + 3 * sk)) : 1 - (1 - u) ** (1 / (1 - 3 * sk));
      err = Math.max(err, Math.abs(y[s] - Wf[0](ts)));
    }
    assert.ok(Math.abs(k / 4799 - want) < 0.005, `skew ${sk}: peak at ${(k / 4799).toFixed(3)} (want ${want.toFixed(3)})`);
    assert.ok(err < 0.01, `skew ${sk}: envelope ≈ W(t_s) (${err.toFixed(4)})`);
  }
});

test('reverse grains, grain pitch and Loop Grains: reads run backwards with REVERSE; ρ·2^(rpitch) per grain; Loop Grains wraps inside [LS, LE)', () => {
  const t = load(), { B } = t;
  const L = 48000, e = entry('smp:t', L, j => j / L);
  const one = (p, edit, ctxOpts = {}, ctxEdit = null) => {
    // the stream sits at S + Position = 0.5 (scan 0): grains read inside the region [0.25, 1) in both directions
    const cp = cpG({ 'a.dens': 0, 'a.glen': nGlen(0.5), 'a.wamt': 0, 'a.scan': 0.5, 'a.sstart': 0.25, 'a.pos': 0.25, ...p },
      s => { s.osc[0].smpo.dens.jump = 0; if (edit) edit(s); });
    const { g, ctx } = granOsc(t, cp, ctxOpts, { e, ctxEdit });
    return play(g, ctx, 9600).L;
  };
  let y = one({}, null, { f: 2 * fRoot(60) });
  assert.ok(Math.abs(y[0] - 0.5) < 1e-7 && Math.abs(y[1000] - (0.5 * L + 2000) / L) < 1e-7, 'forward at ρ 2 (time and pitch independent of σ 0)');
  y = one({ 'a.grev': 1 }, null, { f: fRoot(60) });
  assert.ok(Math.abs(y[1000] - (0.5 * L - 1000) / L) < 1e-7, 'REVERSE: backwards');
  y = one({ 'a.rdir': 1, 'a.grev': 1 }, null, { f: fRoot(60) }, null);
  // rdir 1: reversed when u < 0.5, XOR REVERSE — either direction, but a straight line at ρ
  assert.ok(Math.abs(Math.abs(y[1000] - y[0]) - 1000 / L) < 1e-7);
  // Loop Grains: a grain running past LE wraps back to LS (no crossfade at X-FADE 0)
  y = one({ 'a.lstart': 0.4, 'a.lend': 0.6, 'a.xfade': 0 }, s => { s.osc[0].smpo.loopGrains = 1; s.osc[0].smpo.loop = 1; }, { f: 2 * fRoot(60) });
  for (let s = 0; s < 9600; s++) assert.ok(y[s] >= 0.4 - 1e-7 && y[s] < 0.6, 'inside the loop at ' + s + ': ' + y[s]);
  assert.ok(Math.abs(y[4800 + 1] - y[4800] - 2 / L) < 1e-7);
  assert.ok(B.getAsset('smp:t'));
});

test('density Grains mode: K = round(1 + 63·dn) overlapping grains, overlap gain 1/√K; a grain at Percent length follows T_s', () => {
  const t = load();
  const e = entry('smp:t', 96000, () => 1);
  for (const K of [1, 4, 16, 64]) {
    const cp = cpG({ 'a.dens': (K - 1) / 63, 'a.glen': nGlen(0.05) }, s => { s.osc[0].smpo.dens.mode = 2; s.osc[0].smpo.loop = 1; });
    const { g, ctx } = granOsc(t, cp, {}, { e });
    play(g, ctx, 9600);
    assert.ok(Math.abs(g.ovl - 1 / Math.sqrt(K)) < 1e-12, 'overlap gain');
    assert.ok(Math.abs(g.grains() - K) <= 1, `K ${K}: ${g.grains()} live grains`);
  }
  // Percent: L_g = (800^ln/100)·T_s (ln 0.5 ⇒ ≈ 28.3 % of T_s)
  const cp = cpG({ 'a.dens': nDens(10), 'a.glen': Math.log(100) / Math.log(800) }, s => { s.osc[0].smpo.glen.mode = 2; });
  const { g, ctx } = granOsc(t, cp, {}, { e });
  play(g, ctx, 64);
  assert.ok(Math.abs(g.Lg - 0.1) < 1e-12 && Math.abs(g.gs[G.LEN] - 4800) <= 1, '100 % of T_s');
});

/* ------------------------------------------------------------------ warps per grain (§6.6.10, §6.9.3) */

// a sine recorded at its root with a 2048-frame period, frozen playhead (σ 0), one rectangular grain (window amount 0)
// at ρ 1: the grain reads like a Sample voice, so a phase-domain warp ≡ the wavetable warp (SxWarp.renderWarp2)
const T0 = 2048, ROOT0 = 69 + 12 * Math.log2(48000 / T0 / 440), sineP = p => 0.8 * Math.sin(2 * Math.PI * p / T0);
function grainWarp(t, slots, { mod = null, periods = 3, rw = 0, N = 1, fm = [0, 0], remap = null } = {}) {
  const { B } = t;
  const cp = cpG({ 'a.dens': 0, 'a.glen': 1, 'a.wamt': 0, 'a.scan': 0.5, 'a.rwarp': rw, 'a.rwarp2': rw },
    s => { s.osc[0].smpo.dens.jump = 0; s.osc[0].fm = fm; });
  const { g, ctx } = granOsc(t, cp, { f: 48000 / T0, N }, { e: B.getAsset('smp:t') ? null : entry('smp:t', 16 * T0, sineP, { nLv: 8, root: ROOT0 }) });
  const [a = {}, b = {}] = slots;
  ctx.mode1 = a.mode | 0; ctx.mode2 = b.mode | 0; ctx.w1.fill(a.w || 0); ctx.w2.fill(b.w || 0);
  ctx.var1 = a.v || 0; ctx.var2 = b.v || 0; ctx.fm1 = fm[0]; ctx.fm2 = fm[1];
  if (remap) { const R = new Float32Array(3 * 2049); for (let o = 0; o < 3; o++) R.set(remap, o * 2049); ctx.sx.remap = R; }
  const M = new Float64Array(32 * 16);
  if (mod) { ctx.mod1 = M; ctx.mod2 = M; ctx.modStride1 = N; ctx.modStride2 = N; }
  const r = play(g, ctx, periods * T0, { raw: true, each: (k, s0) => { if (mod) for (let s = 0; s < 32; s++) for (let u = 0; u < N; u++) M[s * N + u] = mod[(s0 + s) % T0]; } });
  return { r, g };
}
const errDb = (x, ref, from) => {
  let e = 0, p = 0;
  for (let j = 0; j < T0; j++) { const d = x[from + j] - ref[j]; e += d * d; p += ref[j] * ref[j]; }
  return 10 * Math.log10(e / p);
};

test('phase-domain warps act per grain on its read position (≡ the wavetable warp ≤ −60 dB): Sync, Bend, PWM, Mirror, Remap, Quantize, Odd/Even, FM, PD, PD (Self)', () => {
  const t = load(), { W } = t;
  const frame = Float32Array.from({ length: T0 }, (_, j) => sineP(j)), mod = Float64Array.from({ length: T0 }, (_, j) => Math.sin(4 * Math.PI * j / T0));
  const remap = Float32Array.from({ length: 2049 }, (_, j) => { const x = j / 2048; return x * x * (3 - 2 * x); });
  const id = (s) => core.WARPS2.findIndex(w => w.id === s);
  for (const [slots, opts, period] of [[[{ mode: id('sync'), w: 0.5, v: 0.4 }], {}, 2], [[{ mode: id('bend_p'), w: 0.6 }], {}, 2],
    [[{ mode: id('pwm'), w: 0.5 }], {}, 2], [[{ mode: id('mirror'), w: 0.3 }], {}, 2], [[{ mode: id('remap2'), w: 0.7 }], { remap }, 2],
    [[{ mode: id('quantize'), w: 0.7 }], {}, 2], [[{ mode: id('oddeven'), w: 0.15 }], {}, 2],
    [[{ mode: id('bend_n'), w: 0.4 }, { mode: id('oddeven'), w: 0.8 }], {}, 2], [[{ mode: id('fm_o1'), w: 0.4 }], { mod }, 1],
    [[{ mode: id('pd_o1'), w: 0.5 }], { mod }, 3], [[{ mode: id('pd_self'), w: 0.25 }], { periods: 9 }, 8]]) {
    const { r } = grainWarp(t, slots, { periods: Math.max(3, period + 1), ...opts });
    const ref = W.renderWarp2(frame, slots.map(s => ({ fm: 0, v: 0, ...s })), { over: 1, mod: opts.mod || null, remap: opts.remap || null });
    const e = errDb(r.L, ref, period * T0), name = slots.map(s => core.WARPS2[s.mode].id + ' ' + s.w).join(' + ');
    assert.ok(e <= -60, name + ': ' + e.toFixed(1) + ' dB');
  }
});

test('Rand Warp: F/P-domain slot amounts vary per grain (rwarp, rwarp2); output-domain warps are per stream and ignore it', () => {
  const t = load();
  const id = (s) => core.WARPS2.findIndex(w => w.id === s);
  const rowsDiffer = (rows) => { let m = 0; for (let i = 0; i < rows[0].length; i++) m = Math.max(m, Math.abs(rows[0][i] - rows[1][i])); return m; };
  // two streams, identical but for their grains' random draws
  let x = grainWarp(t, [{ mode: id('bend_p'), w: 0.5 }], { N: 2, rw: 0 });
  assert.ok(rowsDiffer(x.r.rows) < 1e-12, 'Rand Warp 0: the two streams are equal');
  x = grainWarp(t, [{ mode: id('bend_p'), w: 0.5 }], { N: 2, rw: 1 });
  assert.ok(rowsDiffer(x.r.rows) > 0.05, 'Rand Warp 1: per-grain amounts differ');
  x = grainWarp(t, [{ mode: 0 }, { mode: id('asym_p'), w: 0.5 }], { N: 2, rw: 1 });
  assert.ok(rowsDiffer(x.r.rows) > 0.05, 'Rand Warp 2 on slot 2');
  x = grainWarp(t, [{ mode: id('d_hard'), w: 0.7 }], { N: 2, rw: 1 });
  assert.ok(rowsDiffer(x.r.rows) < 1e-12, 'output-domain warps ignore Rand Warp (IMPL)');
  x = grainWarp(t, [{ mode: id('fm_o1'), w: 0.5 }], { N: 2, rw: 1, mod: Float64Array.from({ length: T0 }, (_, j) => Math.sin(2 * Math.PI * j / T0)) });
  assert.ok(rowsDiffer(x.r.rows) > 0.05, 'FM amount per grain');
});

/* ------------------------------------------------------------------ allocation-free, lazy references (§0.3) */

test('allocation-free: noteOn / render / noteOff / kill / active / grains with warps, Rand Warp, Loop Grains, X|Y and re-applies', () => {
  const { S, B, X } = load();
  const id = (s) => core.WARPS2.findIndex(w => w.id === s);
  const cp = cpWith(s => { s.p['c.rwarp'] = 0.5; s.p['c.dens'] = 0.9; s.osc[2].smpo.dens.mode = 0; s.osc[2].smpo.glen.mode = 0; });
  const cp2 = cpWith(s => { s.osc[2].smpo.win = 2; s.osc[2].smpo.dens.max = 32; s.osc[2].xy.on = 0; s.p['c.rlen'] = 0.5; s.p['c.wskew'] = 0.8; });
  B.storeAsset('smp:g', entry('smp:g', 4096, p => Math.sin(p / 30), { nLv: 3, R: p => Math.cos(p / 30) }));
  const sx = { grains: 0 };                                          // voice 1 has proc.sx: apply creates sx.granQ
  const gs = [new X.GranOsc(Object.assign(voice(1), { proc: { sx } }), 2), new X.GranOsc(voice(2), 2)];
  for (const g of gs) g.apply(cp, 2, null);
  const ctx = { ...ctxOf(cp, { o: 2, N: 7, CH: 8, sx }) }, OL = new Float64Array(32), OR = new Float64Array(32);
  const RAW = new Float64Array(512), M = new Float64Array(16 * 32).fill(0.3), qr = new Float64Array([16, 64, 1, 32, 256]);
  const modes = [[id('sync'), id('oddeven')], [id('pd_self'), id('lpf')], [id('fm_o1'), id('pd_o1')], [id('d_stomp'), id('flip')], [id('remap2'), 0]];
  assert.throws(() => noAlloc(S, () => new X.GranOsc(voice(), 2).apply(cp, 2, null)), /allocation/, 'positive control');
  noAlloc(S, () => {
    for (let k = 0; k < 400; k++) {
      if (k % 40 === 10) for (const g of gs) g.apply(k % 80 === 10 ? cp2 : cp, 2, k % 120 === 50 ? qr : null);
      if (k % 50 === 0) for (const g of gs) g.noteOn(ctx, true, false);
      if (k % 50 === 30) for (const g of gs) g.noteOff();
      if (k % 100 === 99) for (const g of gs) g.kill();
      if (k === 120) B.storeAsset('smp:x', smpEntry('smp:x'));
      const [m1, m2] = modes[(k >> 4) % modes.length];
      ctx.mode1 = m1; ctx.mode2 = m2; ctx.w1.fill(0.4); ctx.w2.fill(0.6); ctx.mod1 = M; ctx.mod2 = M; ctx.modStride1 = 7; ctx.modStride2 = 1;
      ctx.ownPan = (k >> 5) & 1;                                       // both grain pan laws (§6.9.3)
      for (const [i, g] of gs.entries()) { g.render(ctx, OL, OR, i ? null : RAW); g.active(); g.grains(); }
    }
  });
  assert.ok(OL.every(Number.isFinite) && sx.grains === gs[0].grains() + gs[1].grains());
  assert.ok(sx.granQ && sx.granQ.length === 12, 'the processor registry was created by apply');
});

test('failure isolation: SxBase missing ⇒ apply returns false and warns once; SxWarp missing ⇒ grains play with the slots Off, one warning', () => {
  {
    const { S, X } = load({ overrides: { 'sx-base.js': null } });
    assert.ok(X && Object.isFrozen(X));
    assert.equal(S.logs.length, 0, 'nothing read at load time');
    const cp = cpWith();
    for (let i = 0; i < 4; i++) {
      const g = new X.GranOsc(voice(), 2), ctx = oscCtx(2), OL = new Float64Array(32).fill(1), OR = new Float64Array(32);
      assert.equal(g.apply(cp, 2, null), false);
      g.noteOn(ctx, true, false);
      g.render(ctx, OL, OR, null);
      assert.deepEqual([g.active(), g.grains(), OL[0]], [false, 0, 0]);
    }
    assert.equal(warns(S).length, 1);
    assert.match(warns(S)[0].text, /SxBase is missing/);
  }
  {
    const t = load({ overrides: { 'sx-warp.js': null } }), { S } = t;
    const { g, ctx } = granOsc(t, cpG({ 'a.dens': nDens(50) }), {}, { e: entry('smp:t', 9600, () => 0.5) });
    ctx.mode1 = core.WARPS2.findIndex(w => w.id === 'bend_p'); ctx.w1.fill(1);
    const r = play(g, ctx, 1024);
    assert.ok(g.grains() > 0 && rms(r.L) > 0.05, 'plays');
    assert.equal(warns(S).length, 1);
    assert.match(warns(S)[0].text, /SxWarp is missing/);
  }
});

test('the whole §0.3 list with the engine loads; SxGran is a frozen object and logs nothing; v1 states never select it', () => {
  const S = dspScope({ engine: true });
  const X = S.global('SxGran');
  assert.ok(X && Object.isFrozen(X));
  assert.equal(S.logs.filter(m => /sx-gran/.test(m.text)).length, 0);
  for (const p of core.FACTORY_PRESETS_V1) {
    const cp = core.compileSerum(core.normalizeSerum(clone(p.v.s)), {}).serum;
    for (let o = 0; o < 3; o++) {
      const g = new X.GranOsc(voice(), o);
      assert.equal(g.apply(cp, o, null), true); assert.equal(g.sel, 0, p.name);
    }
  }
});

/* ------------------------------------------------------------------ CPU: §14.1 rows g, g′, g″ through the voice */

// §14.1 node gate through tests/cpu-gate.mjs (calibrated pairs, retries; RULINGS2 Performance): load ≤ 1.5 × target
const gateLoad = async (fn, target) => (await CPU.gateLoad(fn, target)).load;
const T_REF_CALIB = CPU.T_REF_CALIB;
function voiceBench(sc, s, n, assets) {
  const S = sc.global('SerumDSP'), B = sc.global('SxBase');
  for (const [id, e] of Object.entries(assets)) assert.equal(B.storeAsset(id, e), true, id);
  const P = core.compileSerum(core.normalizeSerum(s), {}), cp = P.serum;
  const proc = { base: 48000, OS: 2, fs: 96000, CH: 8, p: { serum: cp, fxr: null }, ct: P.serumT, bendRaw: 0, wheel: 0, at: 0,
    pat: new Float64Array(128), patSeen: false, bpm: 120, songBeat: () => null, held: [], voices: [], sx: null, mpe: new Float64Array(68), vcN: 0,
    offline: true };
  const vs = [];
  for (let i = 0; i < n; i++) vs.push(new S.SerumVoice(proc, i));
  proc.voices = vs;
  for (const v of vs) v.apply(proc.p);
  vs.forEach((v, i) => v.noteOn(48 + 3 * i, 0.8, false, 1));
  const N = 256, L = new Float64Array(N), R = new Float64Array(N);
  const go = () => { for (let k = 0; k < 375; k++) { S.begin(proc, N); for (const v of vs) v.render(L, R, N); S.fxMods(proc); } };
  go();
  return { go, vs, proc, L };
}

test('CPU rows g (8 voices Granular 40 Hz × 200 ms, Hann), g′ (one voice at 256 grains), g″ (8 voices × 3 oscillators at max density, cap 512) — §14.1 node gate', async () => {
  const sc = dspScope({ fast: true });
  const n = 96000, L = Float32Array.from({ length: n }, (_, j) => 0.4 * Math.sin(2 * Math.PI * 220 * j / 48000) + 0.1 * Math.sin(j * 0.37));
  const R = Float32Array.from({ length: n }, (_, j) => 0.4 * Math.sin(2 * Math.PI * 330 * j / 48000));
  const assets = { 'smp:g': { id: 'smp:g', v: 1, kind: 'smp', bytes: 0, rate: 48000, ch: 2, len: n, root: 57, loop: null, peak: 0.5,
    levels: smp.sampleLevels(L, R, n, 8).map(l => ({ len: l.len, L: Float32Array.from(l.L), R: Float32Array.from(l.R) })) } };
  const st = (oscs, p) => {
    const s = core.defaultSerum();
    Object.assign(s.p, { 'a.rand': 0, 'e1.att': 0, 'b.on': oscs > 1 ? 1 : 0, 'c.on': oscs > 2 ? 1 : 0 }, p);
    for (let o = 0; o < oscs; o++) { s.osc[o].type = 'gran'; s.osc[o].smp = 'smp:g'; s.osc[o].route = 1; s.osc[o].smpo.loop = 1; }
    return s;
  };
  const g = voiceBench(sc, st(1, { 'a.dens': nDens(40), 'a.glen': nGlen(0.2) }), 8, assets);
  // max density (800 Hz) × 0.4 s grains: 320 wanted per oscillator (≥ the 256 cap), few reads beyond the 2 s source
  const g1 = voiceBench(sc, st(1, { 'a.dens': 1, 'a.glen': nGlen(0.4) }), 1, {});
  const p3 = {};
  for (const k of ['a', 'b', 'c']) Object.assign(p3, { [k + '.dens']: 1, [k + '.glen']: nGlen(0.4) });
  const g3 = voiceBench(sc, st(3, p3), 8, {});
  const grains = b => b.proc.sx.grains;
  assert.ok(Math.abs(grains(g) - 64) <= 8, 'row g: ≈ 64 grains (' + grains(g) + ')');
  assert.ok(grains(g1) >= 250, 'row g′: 256 grains (' + grains(g1) + ')');
  assert.ok(grains(g3) >= 500 && grains(g3) <= 512, 'row g″: at the processor cap (' + grains(g3) + ')');
  const lg = await gateLoad(g.go, 0.3), lg1 = await gateLoad(g1.go, 0.35), lg3 = await gateLoad(g3.go, 2 * 0.35);
  console.log(`  CPU (g) ${lg.toFixed(3)} (target 0.3), (g′) ${lg1.toFixed(3)} (target 0.35), (g″) ${lg3.toFixed(3)} (target 2 × g′ = 0.7; ${(lg3 / lg1).toFixed(2)} × g′ here) — OS 2; ` +
    (T_REF_CALIB > 0 ? 'calibrated' : 'uncalibrated (no tests/bench.json)'));
  assert.ok(lg <= 1.5 * 0.3, '(g) ' + lg.toFixed(3));
  assert.ok(lg1 <= 1.5 * 0.35, '(g′) ' + lg1.toFixed(3));
  assert.ok(lg3 <= 1.5 * 0.7, '(g″) ' + lg3.toFixed(3));
  assert.ok(lg3 <= 1.5 * 2 * lg1, '(g″) ≤ 1.5 × 2 × the measured g′ (§6.9.2 budget: 2 × g′)');
});
