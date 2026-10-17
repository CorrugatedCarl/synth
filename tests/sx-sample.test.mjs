// sx-sample.js unit tests (owner D4; SPEC-serum2 §15.8). M1b: the §11.8 skeleton — exports and signatures, CP v2 shape
// validation in apply, per-voice state allocated on the first selecting apply, entry resolution by asset epoch, note
// bookkeeping, allocation-free hot paths, lazy references and failure isolation (§0.3). M2: the Sample (§6.7) and
// Multisample (§6.8) behaviour — pitch, scan, Length to BPM, loop modes and their timing, loop crossfade, Relative / Link
// loop, Exit on Release, start/end reversal, slices, unison START / SPAN, sRev / sNorm, level selection and aliasing,
// wavetables as samples, the intra-period warps of §6.6.10 against the wavetable path (SxWarp.renderWarp2) incl. FM / PD /
// PD (Self), zones / velocity layers / TIMBRE / round robin / zone loops / envelopes / velocity tracking — and the §14.1
// CPU rows e, f, f′ through the voice.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../serum-core.js?v=9';
import * as smp from '../smp.js?v=9';
import { dspScope, source, ALLOC_NAMES } from './dsp-scope.mjs';
import * as CPU from './cpu-gate.mjs';

const FILES = ['sx-base.js', 'sx-warp.js', 'sx-sample.js'];
const load = (opts = {}) => {
  const S = dspScope({ files: FILES, ...opts });
  return { S, B: S.global('SxBase'), W: S.global('SxWarp'), X: S.global('SxSample') };
};
const clone = o => JSON.parse(JSON.stringify(o));
const LET = ['A', 'B', 'C'];
// a compiled CP v2 with OSC A Sample, OSC B Multisample, OSC C Wavetable (edit(s) may change the state first)
function cpWith(edit) {
  const s = core.defaultSerum();
  s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:a';
  s.osc[0].smpo.loop = 3; s.osc[0].smpo.lenBpm = 1; s.osc[0].smpo.scanRange = 2; s.osc[0].smpo.exitRel = 1;
  s.osc[0].smpo.slice = { mode: 2, thr: 0.5, marks: [0.25, 0.5], toEnd: 1, single: 0, root: 48, sync: 0 };
  s.osc[0].fm = [2, 1];
  s.osc[1].type = 'multi'; s.osc[1].multi = 'msmp:m'; s.osc[1].msmo.override = 1; s.osc[1].msmo.dlyBpm = 1;
  if (edit) edit(s);
  return core.compileSerum(core.normalizeSerum(s), {}).serum;
}
// OSC A of type `type` on asset `id` ('smp:t' / 'msmp:t'), destination values p, then edit(s)
function cpA(p = {}, edit = null, type = 'sample') {
  const s = core.defaultSerum();
  s.osc[0].type = type;
  if (type === 'multi') s.osc[0].multi = 'msmp:t'; else s.osc[0].smp = 'smp:t';
  Object.assign(s.p, p);
  if (edit) edit(s);
  return core.compileSerum(core.normalizeSerum(s), {}).serum;
}
// a voice with the §6.2 second stream (xorshift32), as SerumVoice.rnd2
const voice = (seed = 0x2545F491) => ({ r2: seed >>> 0 || 1,
  rnd2() { let x = this.r2; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.r2 = x || 1; return this.r2 / 4294967296; } });
// the skeleton's context (gains 0)
function oscCtx(o, N = 4, CH = 8) {
  const f16 = () => new Float64Array(16), fch = () => new Float64Array(CH);
  return {
    o, N, f: f16().fill(440), gl: f16(), gr: f16(), dgl: f16(), dgr: f16(), pan: f16(), t: f16(), w1: f16(), w2: f16(),
    mode1: 0, mode2: 0, var1: 0, var2: 0, fm1: 0, fm2: 0, mod1: null, mod2: null, modStride1: 0, modStride2: 0,
    eff: new Float64Array(429), cp: null, sx: {}, gate: 1, fresh: 1, CH, fs: 96000, base: 48000, bpm: 120, keyRef: 60, rootShift: 0,
    wbuf: { inc: fch(), ph: fch(), ph2: fch(), win: fch(), x: fch(), x2: fch() },
  };
}
// a playing context: unit unison gains, eff = the CP base (edit with ef), f Hz for every unison voice
function ctxOf(cp, { o = 0, N = 1, CH = 32, fs = 48000, f = 440, gain = 1, key = 60, keyRef = key, vel = 1, bpm = 120 } = {}) {
  const F = () => new Float64Array(16);
  return { o, N, f: F().fill(f), gl: F().fill(gain), gr: F().fill(gain), dgl: F(), dgr: F(), pan: F(), t: F(), w1: F(), w2: F(),
    mode1: 0, mode2: 0, var1: 0, var2: 0, fm1: 0, fm2: 0, mod1: null, mod2: null, modStride1: 0, modStride2: 0,
    eff: Float64Array.from(cp.base), cp, sx: {}, gate: 1, fresh: 1, CH, fs, base: 48000, bpm, keyRef, rootShift: 0, key, vel, wbuf: {} };
}
const ef = (ctx, B, name, n, o = 0) => { const i = B.DIDX2[LET[o] + '_' + name]; assert.ok(i >= 0, name); ctx.eff[i] = n; };
const fRoot = root => 440 * Math.pow(2, (root - 69) / 12);
// a playback entry (§4.5) whose level ℓ holds fn at the level-0 positions j·2^ℓ (exact levels); R: a second function (stereo)
function entry(id, len, fn, { rate = 48000, root = 60, nLv = 1, R = null, peak = null, loop = null } = {}) {
  const levels = [];
  for (let l = 0, n = len; l < nLv; l++) {
    if (l > 0) n = Math.floor(n / 2);
    const sc = 2 ** l;
    levels.push({ len: n, L: Float32Array.from({ length: n }, (_, j) => fn(j * sc)), R: R ? Float32Array.from({ length: n }, (_, j) => R(j * sc)) : null });
  }
  let pk = 0;
  for (const x of levels[0].L) pk = Math.max(pk, Math.abs(x));
  if (R) for (const x of levels[0].R) pk = Math.max(pk, Math.abs(x));
  return { id, v: 1, kind: 'smp', bytes: 0, rate, ch: R ? 2 : 1, len, root, loop, peak: peak !== null ? peak : pk, levels };
}
const smpEntry = (id, len = 64) => entry(id, len, () => 0.5);
const multiEntry = id => ({ id, v: 1, kind: 'multi', bytes: 0, zones: [{ lo: 0, hi: 127, vlo: 1, vhi: 127, root: 60, tune: 0, gain: 0,
  pan: 0, smp: 'smp:z', mode: 'oneshot', ls: 0, le: 0, off: 0, env: null, rr: [1, 1], vt: 1 }] });
const zone = (z) => ({ lo: 0, hi: 127, vlo: 1, vhi: 127, root: 60, tune: 0, gain: 0, pan: 0, smp: 'smp:z', mode: 'oneshot', ls: 0, le: 0,
  off: 0, env: null, rr: [1, 1], vt: 1, ...z });
// fn() with the scope's allocating constructors replaced by throwing stubs (§15; dsp-scope's list) — the static helpers
// Array.isArray / ArrayBuffer.isView stay usable (they allocate nothing; apply validates shapes with them)
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
const typedBytes = obj => Object.values(obj).reduce((n, v) => n + (v && ArrayBuffer.isView(v) ? v.byteLength : 0), 0);
const warns = S => S.logs.filter(m => m.level === 'warn' && /^sx-sample:/.test(m.text));
// render n samples in chunks of ctx.CH: {L, R, rows (RAW rows of the N unison voices when raw)}; each(k, s0) before chunk k
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
const maxAbs = (a, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const rms = (a, from = 0, to = a.length) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return Math.sqrt(e / Math.max(1, to - from)); };
const dB = x => 20 * Math.log10(x);
// a started Sample oscillator on cp with entry e stored as 'smp:t'
function sampleOsc(ctxOpts, cp, e, { v = voice(), B, X, ctxEdit = null } = {}) {
  if (e) assert.equal(B.storeAsset('smp:t', e), true);
  const osc = new X.SampleOsc(v, 0);
  assert.equal(osc.apply(cp, 0, null), true);
  const ctx = ctxOf(cp, ctxOpts);
  if (ctxEdit) ctxEdit(ctx);
  osc.noteOn(ctx, true, false);
  return { osc, ctx };
}

/* ------------------------------------------------------------------ loading and shape (§0.3, §11.8) */

test('loads in a bare scope and publishes only the frozen SxSample with the §11.8 API', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('sx-sample.js');
  assert.deepEqual([...names()].filter(k => !before.has(k)), ['SxSample']);
  const X = S.global('SxSample');
  assert.ok(X && Object.isFrozen(X) && Object.isFrozen(X.K));
  assert.deepEqual(Object.keys(X).sort(), ['K', 'MAXCH', 'MAXLAYER', 'MAXUNI', 'MultiOsc', 'NSL', 'SampleOsc', 'VER']);
  assert.equal(X.VER, 1); assert.equal(X.MAXCH, 32); assert.equal(X.MAXUNI, 16); assert.equal(X.MAXLAYER, 8); assert.equal(X.NSL, 258);
  const arity = { apply: 3, noteOn: 3, noteOff: 0, render: 4, kill: 0, active: 0, grains: 0 };
  for (const C of [X.SampleOsc, X.MultiOsc]) {
    assert.equal(typeof C, 'function'); assert.equal(C.length, 2, C.name + ' constructor(voice, o)');
    for (const [m, n] of Object.entries(arity)) assert.equal(C.prototype[m].length, n, C.name + '.' + m);
  }
  assert.equal(S.logs.length, 0, 'no console output on a clean load (SxBase / SxWarp are never read at load time)');
});

test('a throwing copy leaves SxSample null without throwing out of the script; re-evaluation gives a fresh object', () => {
  const S = dspScope({ files: ['sx-sample.js'], overrides: { 'sx-sample.js': src => src.replace('try {', 'try { throw new Error("boom");') } });
  assert.equal(S.global('SxSample'), null);
  assert.ok(S.logs.some(m => m.level === 'error' && /sx-sample: load failed/.test(m.text)));
  const { S: S2, X } = load();
  S2.reload('sx-sample.js');
  const X2 = S2.global('SxSample');
  assert.ok(X2 && X2 !== X && X2.VER === 1);
});

test('the source keeps the §0.3/§0.4 rules: one IIFE, environment neutral, no instanceof, no Math.random, lazy SxBase/SxWarp only', () => {
  const src = source('sx-sample.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code.trim(), /^\(function \(\) \{\n  'use strict';[\s\S]*\}\)\(\);$/);
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window', 'document',
    'self', 'instanceof', 'Math.random', 'SxGran', 'SxSpec', 'SerumDSP', 'SxMod', 'SxFilt2', 'SxSeq']) {
    assert.ok(!new RegExp('\\b' + w.replace('.', '\\.') + '\\b').test(code), w);
  }
  // the two lazy references (§0.3, §11.7) are read only inside the resolver functions, never at load time
  assert.deepEqual(code.match(/globalThis\.Sx\w+/g).sort(), ['globalThis.SxBase', 'globalThis.SxSample', 'globalThis.SxSample', 'globalThis.SxWarp']);
  assert.match(code, /function sxBase\(\) \{\n\s+const B = globalThis\.SxBase;/);
  assert.match(code, /function sxWarp\(\) \{\n\s+const W = globalThis\.SxWarp;/);
});

test('K: the O2 offsets match SxBase.DIDX2 and serum-core vi() for OSC A, B and C', () => {
  const { B, X } = load();
  assert.equal(Object.keys(X.K).length, 51);
  for (const [i, P] of ['a', 'b', 'c'].entries()) {
    const k0 = B.DIDX2[P.toUpperCase() + '_W1'];
    for (const [name, off] of Object.entries(X.K)) {
      const id = P + '.' + name.toLowerCase(), idx = core.DESTS.findIndex(d => d.id.toLowerCase() === id);
      assert.ok(idx >= 0, id);
      assert.equal(k0 + off, core.vi(idx), id + ' (osc ' + i + ')');
      assert.equal(B.DIDX2[P.toUpperCase() + '_' + name], k0 + off, id);
    }
  }
});

/* ------------------------------------------------------------------ apply: shapes, selection, allocation (§11.8, §4.1) */

test('apply: a valid CP is accepted; state is allocated only by the first apply that selects the type (≤ 64 KB, §14.2)', () => {
  const { X } = load();
  const def = core.compileSerum(core.defaultSerum(), {}).serum, cp = cpWith();
  for (const [C, o, other] of [[X.SampleOsc, 0, 1], [X.MultiOsc, 1, 0]]) {
    const osc = new C(voice(), o);
    assert.equal(typedBytes(osc), 0, C.name + ': no buffers in the constructor');
    assert.equal(osc.apply(def, o, null), true);
    assert.equal(osc.ok, 1); assert.equal(osc.sel, 0, 'default CP: the oscillator is a wavetable');
    assert.equal(typedBytes(osc), 0, 'not selected ⇒ nothing allocated');
    assert.equal(osc.apply(cp, other, null), true);
    assert.equal(osc.sel, 0, 'another type for this o');
    assert.equal(typedBytes(osc), 0);
    assert.equal(osc.apply(cp, o, null), true);
    assert.equal(osc.sel, 1); assert.equal(osc.o, o);
    const bytes = typedBytes(osc) + osc.ws.bytes + osc.wsR.bytes;
    assert.ok(bytes > 0 && bytes <= 64 * 1024, C.name + ': ' + bytes + ' bytes ≤ 64 KB per oscillator incl. its warp slots (§14.2)');
    const st = osc.st, ws = osc.ws;
    assert.equal(osc.apply(def, o, null), true);
    assert.equal(osc.sel, 0);
    assert.equal(osc.apply(cp, o, null), true);
    assert.equal(osc.st, st, 'state reused, not reallocated'); assert.equal(osc.ws, ws);
  }
});

test('apply copies the oscillator\'s options and the entry id', () => {
  const { X, B } = load();
  const cp = cpWith(), s = new X.SampleOsc(voice(), 0), m = new X.MultiOsc(voice(), 1);
  assert.equal(s.apply(cp, 0, null), true);
  assert.deepEqual([s.loop, s.exit, s.lenOn, s.slMode, s.slEnd, s.slOne, s.slRoot, s.slN, s.scanR, s.fm1, s.fm2, s.id],
    [3, 1, 1, 2, 1, 0, 48, 3, 8, 2, 1, 'smp:a']);
  assert.deepEqual(Array.from(s.sl.subarray(0, 5)), [0, 0.25, 0.5, 1, 0]);
  assert.deepEqual(Array.from(s.lad), Array.from(cp.lenLad));
  assert.equal(s.k0, B.DIDX2.A_W1); assert.equal(s.kLen, B.DIDX2.A_LENRATE);
  assert.equal(m.apply(cp, 1, null), true);
  assert.deepEqual([m.over, m.dlyBpm, m.id, m.k0, m.kLen], [1, 1, 'msmp:m', B.DIDX2.B_W1, B.DIDX2.B_LENRATE]);
  assert.deepEqual(Array.from(m.envLad), Array.from(cp.envLad));
  // the CP may be replaced or recycled after apply: the instance keeps its own copies
  const sl = Array.from(s.sl);
  cp.sSlPos.fill(7); cp.lenLad.fill(7);
  assert.deepEqual(Array.from(s.sl), sl);
  // the same o re-targeted by apply(cp, o): OSC C slot (wavetable here) ⇒ idle
  assert.equal(s.apply(cpWith(), 2, null), true); assert.equal(s.o, 2); assert.equal(s.sel, 0);
});

test('apply validates the CP shapes: any wrong field ⇒ false, silent, one console.warn per scope', () => {
  const { S, X } = load();
  const good = cpWith();
  // [CP, rejected by SampleOsc, rejected by MultiOsc] — each class checks the fields it reads (§4.1)
  const bad = [
    [null, 1, 1], [5, 1, 1], [{ ...good, ver: 1 }, 1, 1], [{ ...good, base: undefined }, 1, 1],
    [{ ...good, oType: [2, 1, 0] }, 1, 1], [{ ...good, fmType: new Uint8Array(3) }, 1, 1], [{ ...good, qr: new Float64Array(4) }, 1, 1],
    [{ ...good, sSlPos: new Float64Array(10) }, 1, 0], [{ ...good, sLoop: new Int8Array(3) }, 1, 0],
    [{ ...good, smp: ['', ''] }, 1, 0], [{ ...good, smp: [1, '', ''] }, 1, 0], [{ ...good, lenLad: Array.from(good.lenLad) }, 1, 0],
    [{ ...good, multi: 'x' }, 0, 1], [{ ...good, envLad: new Float32Array(16) }, 0, 1], [{ ...good, msOver: undefined }, 0, 1],
  ];
  for (const [cp, rs, rm] of bad) {
    for (const [C, o, rej] of [[X.SampleOsc, 0, rs], [X.MultiOsc, 1, rm]]) {
      const osc = new C(voice(), o);
      assert.equal(osc.apply(good, o, null), true);
      const r = osc.apply(cp, o, null);
      assert.equal(r, !rej, C.name + ' ' + JSON.stringify(cp && cp.ver));
      if (r) continue;
      assert.equal(osc.ok, 0); assert.equal(osc.sel, 0);
      osc.noteOn(oscCtx(o), true, false);
      assert.equal(osc.active(), false, 'a rejected CP never plays');
    }
  }
  for (const o of [-1, 3, NaN, undefined]) assert.equal(new X.SampleOsc(voice(), 0).apply(good, o, null), false, 'o = ' + o);
  assert.equal(warns(S).length, 1, 'one warning per scope');
  // qr: null ⇒ CP.qr; an explicit array of 5 finite numbers is accepted; anything else rejected
  const s = new X.SampleOsc(voice(), 0);
  assert.equal(s.apply(good, 0, new Float64Array([4, 64, 2, 8, 128])), true);
  assert.equal(s.apply(good, 0, [16, 256, 1, 32, 512]), true);
  assert.equal(s.apply(good, 0, [16, 256, 1, 32]), false);
  assert.equal(s.apply(good, 0, [16, 256, NaN, 32, 512]), false);
});

test('apply accepts CPs and qr arrays from another realm (typed arrays compared by tag, not instanceof)', () => {
  const { S, X } = load();
  const cp = cpWith(), osc = new X.SampleOsc(voice(), 0);
  const foreign = S.run('(function (cp) { const o = {}; for (const k of Object.keys(cp)) { const v = cp[k];'
    + ' o[k] = ArrayBuffer.isView(v) ? new globalThis[v.constructor.name](v) : Array.isArray(v) ? v.slice() : v; } return o; })', 'f.js')(cp);
  assert.notEqual(Object.getPrototypeOf(foreign.base), Float64Array.prototype);
  assert.equal(osc.apply(foreign, 0, foreign.qr), true);
  assert.equal(osc.apply(cp, 0, null), true);
});

/* ------------------------------------------------------------------ note bookkeeping, silence, entries (§11.8, §4.5) */

test('noteOn / noteOff / kill / active / grains', () => {
  const { X } = load();
  const cp = cpWith();
  for (const [C, o] of [[X.SampleOsc, 0], [X.MultiOsc, 1]]) {
    const osc = new C(voice(), o), ctx = oscCtx(o);
    assert.equal(osc.active(), false, 'before apply');
    osc.noteOn(ctx, true, false);
    assert.equal(osc.active(), false, 'never applied ⇒ silent');
    osc.apply(cp, o, null);
    assert.equal(osc.active(), false);
    osc.noteOn(ctx, true, false);
    assert.equal(osc.active(), true, 'playing (its entry pending)'); assert.equal(osc.gate, 1); assert.equal(osc.fresh, 1);
    osc.noteOff();
    assert.equal(osc.gate, 0); assert.equal(osc.active(), true, 'release: still playing');
    osc.noteOn(ctx, false, true);
    assert.equal(osc.active(), true); assert.equal(osc.gate, 1);
    osc.kill();
    assert.equal(osc.active(), false); assert.equal(osc.gate, 0);
    assert.equal(osc.grains(), 0);
    osc.apply(core.compileSerum(core.defaultSerum(), {}).serum, o, null);
    osc.noteOn(ctx, true, false);
    assert.equal(osc.active(), false, 'type not selected ⇒ not playing');
    if (C === X.MultiOsc) assert.equal(osc.zone, -1);
  }
});

test('render overwrites ctx.CH samples of OL/OR (nothing beyond CH) and N raw rows at [i·32 + s]; a missing entry is silence', () => {
  const { X } = load();
  const cp = cpWith();
  for (const [C, o] of [[X.SampleOsc, 0], [X.MultiOsc, 1]]) {
    const osc = new C(voice(), o);
    osc.apply(cp, o, null);
    for (const [N, CH] of [[1, 4], [7, 8], [16, 32]]) {
      const ctx = oscCtx(o, N, CH);
      osc.noteOn(ctx, true, false);
      const OL = new Float64Array(32).fill(9), OR = new Float64Array(32).fill(9), RAW = new Float64Array(16 * 32).fill(9);
      osc.render(ctx, OL, OR, RAW);
      for (let s = 0; s < 32; s++) { assert.equal(OL[s], s < CH ? 0 : 9); assert.equal(OR[s], s < CH ? 0 : 9); }
      for (let i = 0; i < 16; i++) for (let s = 0; s < 32; s++) assert.equal(RAW[i * 32 + s], i < N && s < CH ? 0 : 9, `RAW[${i}·32 + ${s}]`);
      OL.fill(9);
      osc.render(ctx, OL, OR, null);
      assert.equal(OL[0], 0);
      osc.kill();
      OL.fill(9); osc.render(ctx, OL, OR, null);
      assert.equal(OL[CH - 1], 0, 'silent after kill as well');
    }
  }
});

test('entries: resolved by asset epoch while playing; missing ⇒ silent until it arrives, then audible from the note-on values within one chunk', () => {
  const { B, X } = load();
  const cp = cpWith(st => { st.osc[0].smpo.slice.mode = 0; st.osc[0].smpo.lenBpm = 0; st.osc[0].smpo.loop = 1; });
  const s = new X.SampleOsc(voice(), 0), m = new X.MultiOsc(voice(), 1);
  const ctx = ctxOf(cp, { o: 0, CH: 8 }), ctxM = ctxOf(cp, { o: 1, CH: 8 }), OL = new Float64Array(32), OR = new Float64Array(32);
  s.apply(cp, 0, null); m.apply(cp, 1, null);
  s.noteOn(ctx, true, false); m.noteOn(ctxM, true, false);
  s.render(ctx, OL, OR, null); assert.equal(OL[0], 0); m.render(ctxM, OL, OR, null);
  assert.equal(s.e, null); assert.equal(m.e, null);
  assert.equal(B.storeAsset('smp:a', smpEntry('smp:a')), true);
  assert.equal(B.storeAsset('msmp:m', multiEntry('msmp:m')), true);
  assert.equal(B.storeAsset('smp:z', smpEntry('smp:z')), true);
  s.render(ctx, OL, OR, null);
  assert.equal(s.e, B.getAsset('smp:a'));
  assert.ok(Math.abs(OL[0] - 0.5) < 1e-12, 'audible in the chunk the entry arrived: ' + OL[0]);
  m.render(ctxM, OL, OR, null);
  assert.equal(m.e, B.getAsset('msmp:m')); assert.equal(m.lE[0], B.getAsset('smp:z'));
  assert.ok(OL[7] > 0, 'multisample layer audible');
  // a replacement entry under the same id is picked up; a dropped one is released
  assert.equal(B.storeAsset('smp:a', smpEntry('smp:a', 128)), true);
  s.render(ctx, OL, OR, null);
  assert.equal(s.e.len, 128);
  B.dropAsset('smp:a');
  s.render(ctx, OL, OR, null);
  assert.equal(s.e, null); assert.equal(OL[0], 0);
  // a multi entry under a Sample id (or the reverse) is not played
  assert.equal(B.storeAsset('smp:a', multiEntry('smp:a')), true);
  s.render(ctx, OL, OR, null);
  assert.equal(s.e, null);
  // a new id from apply drops the resolved entry; '' resolves to null
  m.apply(cpWith(st => { st.osc[1].multi = ''; }), 1, null);
  assert.equal(m.e, null); assert.equal(m.id, '');
  m.render(ctxM, OL, OR, null);
  assert.equal(m.e, null);
});

/* ------------------------------------------------------------------ Sample: pitch, scan, Length to BPM (§6.3.3, §6.7.2) */

test('pitch: root 60 at note 72 plays ×2 (±0.05 cents, playhead and measured frequency); a4 shifts samples like oscillators', () => {
  const { B, X } = load();
  const f60 = fRoot(60), cp = cpA();
  const { osc, ctx } = sampleOsc({ fs: 96000, f: fRoot(72), key: 72 }, cp,
    entry('smp:t', 96000, p => 0.5 * Math.sin(2 * Math.PI * p * f60 / 48000), { nLv: 3 }), { B, X });
  const n = 24000, r = play(osc, ctx, n);
  const cents = (x) => 1200 * Math.log2(x);
  assert.ok(Math.abs(cents(osc.st[0] / (n * 0.5 * 2))) < 0.05, 'playhead: ' + osc.st[0]);
  // frequency from the first and last rising zero crossings (linear interpolation)
  const ups = [];
  for (let i = 1; i < n; i++) if (r.L[i - 1] < 0 && r.L[i] >= 0) ups.push(i - 1 + r.L[i - 1] / (r.L[i - 1] - r.L[i]));
  const hz = (ups.length - 1) / ((ups[ups.length - 1] - ups[0]) / 96000);
  assert.ok(Math.abs(cents(hz / (2 * f60))) < 0.05, 'measured ' + hz.toFixed(4) + ' Hz');
  assert.ok(Math.abs(maxAbs(r.L, 100) - 0.5) < 1e-3 && maxAbs(r.R, 100) > 0.49, 'mono entries feed both channels');
  // a4 = 432: the voice's f carries a4, the sample's root frequency is referenced to 440 (§6.3.3)
  const cp2 = cpA({}, s => { s.global.a4 = 432; });
  assert.equal(cp2.a4, 432);
  const o2 = sampleOsc({ fs: 96000, f: 432 * 2 ** (3 / 12), key: 72 }, cp2, null, { B, X });
  play(o2.osc, o2.ctx, n);
  assert.ok(Math.abs(o2.osc.st[0] / (n * 432 / 440) - 1) < 1e-9, 'a4 432: ' + o2.osc.st[0]);
});

test('scan: σ = (scanrev ? −1 : 1)·v·R; v 0 holds; a negative σ at note-on starts at the region end; Lock Scan Rate × bpm/120', () => {
  const { B, X } = load();
  const L = 48000, n = 3200;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 4 }));
  // [scan n, scanRange, scanrev, lock, bpm, start, expected travel per sample]
  for (const [sn, range, rev, lock, bpm, P0, dr] of [[0.75, 0, 0, 0, 120, 12000, 1], [1, 0, 0, 0, 120, 12000, 2], [1, 2, 0, 0, 120, 12000, 8],
    [0.5, 0, 0, 0, 120, 12000, 0], [0.25, 0, 0, 0, 120, L, -1], [0.75, 0, 1, 0, 120, L, -1], [0.75, 1, 0, 1, 60, 12000, 0.5],
    [0.75, 0, 0, 1, 240, 12000, 2]]) {
    const cp = cpA({ 'a.scan': sn, 'a.scanrev': rev, 'a.sstart': 0.25 }, s => { s.osc[0].smpo.scanRange = range; s.osc[0].smpo.scanLock = lock; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60), bpm }, cp, null, { B, X });
    const r = play(osc, ctx, n), tag = `scan ${sn} R ${range} rev ${rev} lock ${lock} @${bpm}`;
    for (const s of [0, 1, 777, n - 1]) {
      const P = P0 + s * dr * (range === 1 ? 2 : 1), q = Math.min(Math.max(P, 0), L - 1);
      assert.ok(Math.abs(r.L[s] - q / L) < 1e-7, `${tag}: sample ${s} reads ${r.L[s] * L} (want ${q})`);
    }
  }
});

test('Length to BPM: 1 bar at 120 BPM lasts 2 s ± 1 frame; RATE steps the LEN_LADDER; the key is excluded, pitch knobs varispeed', () => {
  const { B, X } = load();
  B.storeAsset('smp:t', entry('smp:t', 48000, () => 0.5, { nLv: 3 }));
  const dur = (lenN, { key = 60, knobs = 0, bpm = 120, scan = 0.75 } = {}) => {
    const cp = cpA({ 'a.lenrate': lenN, 'a.scan': scan }, s => { s.osc[0].smpo.lenBpm = 1; });
    const { osc, ctx } = sampleOsc({ f: 440 * 2 ** ((key + knobs - 69) / 12), key, bpm }, cp, null, { B, X });
    const r = play(osc, ctx, 48000 * 9);
    let last = -1;
    for (let i = 0; i < r.L.length; i++) if (r.L[i] !== 0) last = i;
    assert.equal(osc.active(), false, 'One-shot: ended');
    return last + 1;
  };
  const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 1, `${what}: ${got} samples (want ${want} ± 1)`);
  near(dur(5 / 14), 96000, '1 bar @ 120');
  near(dur(4 / 14), 72000, '3/4 @ 120');
  near(dur(4.4 / 14), 72000, 'RATE between steps rounds to the ladder');
  near(dur(4.6 / 14), 96000, 'next step');
  near(dur(0), 6000, '1/16 @ 120');
  near(dur(5 / 14, { key: 72 }), 96000, 'another key: same duration (the key term is excluded)');
  near(dur(5 / 14, { knobs: 12 }), 48000, 'pitch knobs +12: varispeed ×2');
  near(dur(5 / 14, { scan: 1 }), 96000, 'SCAN is ignored while Length to BPM is on');
  near(dur(5 / 14, { bpm: 60 }), 192000, '1 bar @ 60');
});

/* ------------------------------------------------------------------ Sample: loop modes, crossfade, markers (§6.7.1, §6.7.3, §6.7.4) */

// reference playhead of §6.7.3 for a forward region (S < E) and loop (LS < LE): positions before each step (NaN = ended)
function refHead(mode, S, E, LS, LE, dr, n) {
  const pos = new Float64Array(n), LL = LE - LS, M = 0.5 * (S + E), TL = E - M;
  let P = S, ph = 0, dir = 1;
  for (let s = 0; s < n; s++) {
    pos[s] = ph === 3 ? NaN : P;
    if (ph === 3) continue;
    if (ph === 0) {
      P += dr;
      if (mode === 0) { if (P >= E) ph = 3; } else if (mode === 4) { if (P >= E) { ph = 1; P = M + ((P - M) % TL); } } else if (P >= LE) {
        ph = 1;
        if (mode === 1) P = LS + ((P - LS) % LL); else { P = 2 * LE - P; dir = -1; }
      }
    } else if (mode === 1) { P += dr; if (P >= LE) P -= LL; } else if (mode === 4) { P += dr; if (P >= E) P -= TL; } else if (mode === 2) {
      P -= dr; if (P < LS) P += LL;
    } else { P += dir * dr; if (P >= LE) { P = 2 * LE - P; dir = -1; } else if (P < LS) { P = 2 * LS - P; dir = 1; } }
  }
  return pos;
}

test('loop modes: One-shot, Fwd, Rev, Fwd/Rwd and Tailed playhead positions after many periods match the §6.7.3 reference', () => {
  const { B, X } = load();
  const L = 10000, n = 9000, dr = 3.7, S = 1000, E = 9000, LS = 3000, LE = 7000;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 3 }));         // a ramp: the output is the read position / L
  for (const mode of [0, 1, 2, 3, 4]) {
    const cp = cpA({ 'a.sstart': 0.1, 'a.send': 0.9, 'a.lstart': 0.3, 'a.lend': 0.7, 'a.xfade': 0 }, s => { s.osc[0].smpo.loop = mode; });
    const { osc, ctx } = sampleOsc({ f: dr * fRoot(60) }, cp, null, { B, X });
    const r = play(osc, ctx, n), ref = refHead(mode, S, E, LS, LE, dr, n);
    const M = 5000, TL = 4000, Lx = 480;                                   // Tailed: equal-power fade of max(xfade, 10 ms) = 480 frames
    let checked = 0;
    for (let s = 0; s < n; s++) {
      const P = ref[s];
      let want = Number.isNaN(P) ? 0 : P / L;
      if (mode === 4 && !Number.isNaN(P) && P - M > TL - Lx) {
        const u = (P - M - (TL - Lx)) / Lx;
        want = Math.cos(0.5 * Math.PI * u) * P / L + Math.sin(0.5 * Math.PI * u) * (P - TL) / L;
      }
      assert.ok(Math.abs(r.L[s] - want) < 2e-6, `mode ${mode} sample ${s}: ${r.L[s] * L} vs ${want * L}`);
      checked++;
    }
    assert.equal(checked, n);
    assert.equal(osc.active(), mode !== 0, 'only One-shot ends');
    if (mode === 0) assert.ok(r.L.slice(2200).every(x => x === 0), 'One-shot: silence after E');
  }
});

test('loop crossfade: equal-power X-fade removes the seam (no step > 2 × the steady slope), forward and reverse loops; 0 % keeps the jump', () => {
  const { B, X } = load();
  const L = 48000, hz = 100, amp = 0.5;
  B.storeAsset('smp:t', entry('smp:t', L, p => amp * Math.sin(2 * Math.PI * hz * p / 48000), { nLv: 2 }));
  const slope = amp * 2 * Math.PI * hz / 48000;
  for (const mode of [1, 2]) {
    for (const xf of [0, 0.5, 1]) {
      // loop of 40.25 periods: the wrap jumps from the crest (LE) to a zero crossing (LS)
      const cp = cpA({ 'a.lstart': 0.3, 'a.lend': 0.7025, 'a.xfade': xf }, s => { s.osc[0].smpo.loop = mode; });
      const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X });
      const r = play(osc, ctx, 96000);
      let step = 0;
      for (let i = 20000; i < r.L.length; i++) step = Math.max(step, Math.abs(r.L[i] - r.L[i - 1]));
      if (xf === 0) assert.ok(step > 0.3, `mode ${mode} 0 %: the seam jumps (${(step / slope).toFixed(1)} × slope)`);
      else assert.ok(step <= 2 * slope, `mode ${mode} X-fade ${xf}: max step ${(step / slope).toFixed(3)} × the steady slope`);
    }
  }
  // the fade length auto-scales inside the sample (§6.7.4): no room before LS ⇒ no fade (LS at 0)
  const cp = cpA({ 'a.lstart': 0, 'a.lend': 0.5, 'a.xfade': 1 }, s => { s.osc[0].smpo.loop = 1; });
  const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X });
  play(osc, ctx, 64);
  assert.equal(osc.LxF, 0, 'no frames before LS');
});

test('markers: E < S plays backwards; Relative Loop follows the note-on start; Link Loop Length keeps the base length; loop clamped into the region', () => {
  const { B, X } = load();
  const L = 48000;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 2 }));
  // start/end reversal (One-shot): from S = 0.8 back to E = 0.2
  {
    const cp = cpA({ 'a.sstart': 0.8, 'a.send': 0.2 });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X });
    const r = play(osc, ctx, 30000);
    for (const s of [0, 1, 1000, 28799]) assert.ok(Math.abs(r.L[s] - (0.8 * L - s) / L) < 1e-7, 'backwards at ' + s);
    assert.equal(r.L[28800], 0); assert.equal(osc.active(), false);
  }
  // Relative Loop: LS/LE move with S − S_base (note-on k.sstart 0.2 over a base 0.1)
  {
    const cp = cpA({ 'a.sstart': 0.1, 'a.lstart': 0.3, 'a.lend': 0.6 }, s => { s.osc[0].smpo.loop = 1; s.osc[0].smpo.rel = 1; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X, ctxEdit: c => ef(c, B, 'SSTART', 0.2) });
    play(osc, ctx, 64);
    assert.deepEqual([osc.mS, osc.mLS, osc.mLE].map(x => +x.toFixed(9)), [0.2, 0.4, 0.7]);
  }
  // Link Loop Length: LE = LS + (lend_base − lstart_base)·L while LOOP START is modulated; clamped into [S, E]
  {
    const cp = cpA({ 'a.lstart': 0.3, 'a.lend': 0.7 }, s => { s.osc[0].smpo.loop = 1; s.osc[0].smpo.link = 1; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X, ctxEdit: c => ef(c, B, 'LSTART', 0.45) });
    play(osc, ctx, 64);
    assert.deepEqual([osc.mLS, osc.mLE].map(x => +x.toFixed(9)), [0.45, 0.85]);
    ef(ctx, B, 'LSTART', 0.8);
    play(osc, ctx, 64);
    assert.deepEqual([osc.mLS, osc.mLE].map(x => +x.toFixed(9)), [0.8, 1], 'LE clamped to E');
  }
  // without Link: LE < LS runs the loop backwards (ld = −1); markers outside the region are clamped
  {
    const cp = cpA({ 'a.sstart': 0.2, 'a.lstart': 0.1, 'a.lend': 0.05 }, s => { s.osc[0].smpo.loop = 1; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X });
    play(osc, ctx, 64);
    assert.deepEqual([osc.mLS, osc.mLE, osc.ld].map(x => +x.toFixed(9)), [0.2, 0.2, 1], 'both clamped to S');
  }
});

test('Exit Loop on Release: the loop is left at note-off, playback runs on to the region end and stops; without it the loop continues', () => {
  const { B, X } = load();
  const L = 10000;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L));
  for (const exit of [0, 1]) {
    const cp = cpA({ 'a.lstart': 0.3, 'a.lend': 0.6 }, s => { s.osc[0].smpo.loop = 1; s.osc[0].smpo.exitRel = exit; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X });
    const off = 9600;
    const r = play(osc, ctx, 20000, { each: (k, s0) => { if (s0 === off) osc.noteOff(); } });
    for (let s = 3000; s < off; s++) assert.ok(r.L[s] >= 0.3 - 1e-9 && r.L[s] < 0.6, 'looping before the release');
    if (exit) {
      let s = off;
      while (s < r.L.length - 1 && r.L[s + 1] > r.L[s]) s++;
      assert.ok(Math.abs(r.L[s] - (L - 1) / L) < 1e-7 && r.L[s + 1] === 0, 'ran on to the end, then silence: ' + r.L[s] * L);
      assert.ok(r.L.slice(s + 1).every(x => x === 0) && osc.active() === false, 'stopped');
    } else {
      for (let s = off; s < r.L.length; s++) assert.ok(r.L[s] >= 0.3 - 1e-9 && r.L[s] < 0.6, 'still looping after note-off');
      assert.equal(osc.active(), true);
    }
  }
});

// review round (M2 → M3): the playhead edge cases below were reported against the M2 code
const steps = (a, from, to, lim) => { const out = []; for (let i = Math.max(1, from); i < to; i++) if (Math.abs(a[i] - a[i - 1]) > lim) out.push(i); return out; };
const tri = j => { const t = j / 48000; return 0.3 * Math.sin(2 * Math.PI * 211 * t) + 0.3 * Math.sin(2 * Math.PI * 337.3 * t + 1) + 0.3 * Math.sin(2 * Math.PI * 523.7 * t + 2); };
const triSlope = 2 * Math.PI * (211 + 337.3 + 523.7) / 48000 * 0.3;   // an upper bound of |x'| per frame

test('Fwd/Rwd: a playhead landing exactly on LE reflects (no jump to LS) — increments 0.5 and 1 with the default markers', () => {
  const { B, X } = load();
  const L = 24000;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L));                    // ramp: the output is the read position / L
  for (const [fs, key] of [[96000, 60], [48000, 60], [96000, 72]]) {
    const cp = cpA({}, s => { s.osc[0].smpo.loop = 3; });
    const { osc, ctx } = sampleOsc({ f: fRoot(key), key, fs }, cp, null, { B, X });
    const dr = (48000 / fs) * Math.pow(2, (key - 60) / 12), n = Math.round(5 * 2 * L / dr);   // five round trips
    const r = play(osc, ctx, n);
    for (let s = 0; s < n; s++) {                                         // the triangle wave of the reference ping-pong
      const u = (s * dr) % (2 * L), want = u <= L ? u : 2 * L - u;
      if (want >= 1 && want <= L - 3) assert.ok(Math.abs(r.L[s] * L - want) < 1e-2, `fs ${fs} key ${key} sample ${s}: ${r.L[s] * L} vs ${want}`);
    }
    assert.deepEqual(steps(r.L, 1, n, 2 * dr / L + 1e-9), [], 'no jumps');
  }
  // Length to BPM at 1 bar (2 s at 120 BPM) with Fwd/Rwd: an exact rational rate, still no jump
  const cp = cpA({ 'a.lenrate': 5 / 14 }, s => { s.osc[0].smpo.loop = 3; s.osc[0].smpo.lenBpm = 1; });
  const { osc, ctx } = sampleOsc({ f: fRoot(53), key: 53, fs: 96000 }, cp, null, { B, X });
  const r = play(osc, ctx, 96000 * 9);
  assert.deepEqual(steps(r.L, 1, r.L.length, 1e-3), [], 'Length to BPM: no jump');
});

test('Thru-Zero FM: a One-shot (and a Multisample loop zone) whose playhead is pushed back before its start keeps sounding', () => {
  const t = load(), { B, X } = t;
  const L = 64 * T0, id = core.WARPS2.findIndex(w => w.id === 'fm_o1');
  B.storeAsset('smp:t', entry('smp:t', L, j => 0.8 * Math.sin(2 * Math.PI * j / T0), { nLv: 8, root: ROOT0 }));
  B.storeAsset('smp:z', entry('smp:z', 96000, j => 0.5 * Math.sin(j / 30)));
  B.storeAsset('msmp:t', { id: 'msmp:t', v: 1, kind: 'multi', bytes: 0, zones: [zone({ mode: 'loop', ls: 1000, le: 90000 })] });
  for (const type of ['sample', 'multi']) for (const ph of [0, 0.5]) {     // modulator positive / negative at note-on
    const cp = cpA({ 'a.sstart': 0.1 }, s => { s.osc[0].fm = [0, 0]; }, type);
    const osc = type === 'sample' ? new X.SampleOsc(voice(), 0) : new X.MultiOsc(voice(), 0);
    assert.equal(osc.apply(cp, 0, null), true);
    const ctx = ctxOf(cp, { f: type === 'sample' ? 48000 / T0 : fRoot(60) });
    ctx.mode1 = id; ctx.w1.fill(0.5); ctx.fm1 = 0;                        // Thru-Zero (the default FM type)
    const M = new Float64Array(32); ctx.mod1 = M; ctx.modStride1 = 1;
    osc.noteOn(ctx, true, false);
    const n = 8 * T0;
    const r = play(osc, ctx, n, { each: (k, s0) => { for (let s = 0; s < 32; s++) M[s] = Math.sin(2 * Math.PI * ((s0 + s) / 300 + ph)); } });
    let last = 0;
    for (let s = 0; s < n; s++) if (r.L[s] !== 0) last = s;
    assert.ok(last > n - 64 && osc.active(), `${type}, modulator phase ${ph}: sounds to the end (last ${last} of ${n})`);
  }
});

test('Exit Loop on Release with X-fade: no step > 2× the steady slope — released before the first wrap and inside a fade zone', () => {
  const { B, X } = load();
  B.storeAsset('smp:t', entry('smp:t', 96000, tri));
  for (const rel of [32000, 40000, 46016, 80000, 94016]) {                 // the fade zone of the wrap at LE = 48000 is 36000–48000
    const cp = cpA({ 'a.xfade': 1, 'a.lstart': 0.25, 'a.lend': 0.5 }, s => { s.osc[0].smpo.loop = 1; s.osc[0].smpo.exitRel = 1; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, null, { B, X });
    const r = play(osc, ctx, 200000, { each: (k, s0) => { if (s0 === rel - (rel % 32)) osc.noteOff(); } });
    let end = 0;
    for (let i = r.L.length - 1; i > 0; i--) if (r.L[i] !== 0) { end = i; break; }
    assert.ok(end > 96000 - 2 && end < 96000 + 48000 && !osc.active(), 'ran on to the region end and stopped at ' + end);
    assert.deepEqual(steps(r.L, 1, end, 2 * triSlope), [], 'release at ' + rel);
  }
});

test('reverse scan: Tailed plays the whole region backwards, then loops [S, M]; Rev turns at LS; X-fade seams stay below 2× the slope', () => {
  const { B, X } = load();
  B.storeAsset('smp:t', entry('smp:t', 96000, tri));
  for (const mode of [4, 2, 1]) {
    const cp = cpA({ 'a.xfade': 0.5, 'a.lstart': 0.25, 'a.lend': 0.5, 'a.scanrev': 1 }, s => { s.osc[0].smpo.loop = mode; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60) * 0.999 }, cp, null, { B, X });
    const pos = [];
    const r = play(osc, ctx, 400000, { each: () => pos.push(osc.mPos) });
    assert.deepEqual(steps(r.L, 2, r.L.length, 2 * triSlope), [], 'mode ' + mode);
    assert.ok(Math.abs(pos[0] - 1) < 1e-9, 'starts at E');
    if (mode === 4) {
      assert.ok(Math.min(...pos.slice(0, 3000)) < 0.01, 'the approach reaches S');
      assert.ok(pos.slice(3200).every(p => p <= 0.5 + 1e-9), 'then loops the tail [S, M]');
    }
    if (mode === 2) assert.ok(Math.min(...pos) < 0.2501 && pos.slice(2500).every(p => p >= 0.25 - 1e-9 && p <= 0.5 + 1e-9), 'Rev: down to LS, then inside the loop');
  }
});

test('§6.6.10 bounds for Odd/Even and PD (Self): material past LE / E never reaches the warped reads (interpolation seams excepted)', () => {
  const t = load(), { B, X } = t;
  const L = 64 * T0, id = (x) => core.WARPS2.findIndex(w => w.id === x), sine = j => 0.8 * Math.sin(2 * Math.PI * j / T0);
  const run = (fn, loop, p, m1, w1, m2 = 0, LE = 32 * T0) => {
    B.storeAsset('smp:t', entry('smp:t', L, j => j < LE ? sine(j) : fn(j), { nLv: 8, root: ROOT0 }));
    const cp = cpA(p, s => { s.osc[0].smpo.loop = loop; });
    const { osc, ctx } = sampleOsc({ f: 48000 / T0 }, cp, null, { B, X, ctxEdit: c => { c.mode1 = m1; c.w1.fill(w1); c.mode2 = m2; c.w2.fill(0.3); } });
    return play(osc, ctx, 40 * T0).L;
  };
  for (const [loop, p, end] of [[1, { 'a.lstart': 0, 'a.lend': 0.5 }, 40 * T0], [0, { 'a.send': 0.5 }, 32 * T0 - 1]]) {
    for (const [m1, w1, m2, lim] of [[id('oddeven'), 0, 0, 4], [id('oddeven'), 1, 0, 4], [id('bend_p'), 0.3, id('oddeven'), 48]]) {
      const a = run(sine, loop, p, m1, w1, m2), b = run(() => 1, loop, p, m1, w1, m2);
      let cnt = 0;
      for (let s = 0; s < end; s++) if (Math.abs(a[s] - b[s]) > 1e-6) cnt++;
      assert.ok(cnt <= lim, `loop ${loop} modes ${m1}/${m2}: ${cnt} samples depend on the material past the bound`);
    }
  }
  // PD (Self) inside a loop: the fed-back read offsets wrap into the loop (only reads near the LE seam can differ)
  const LE = 32.25 * T0, p = { 'a.lstart': 0, 'a.lend': 32.25 / 64 };
  const a = run(sine, 1, p, id('pd_self'), 0.6, 0, LE), b = run(() => 1, 1, p, id('pd_self'), 0.6, 0, LE);
  assert.ok(Math.max(...a) < 0.85, 'the reference stays inside the sine');
  const over = b.filter(x => x > 0.85).length;                          // M2: 1140 (the fed-back offsets ran past LE)
  assert.ok(over <= 8, `PD (Self) plays the material past LE only at the interpolation seam (${over} samples)`);
});

/* ------------------------------------------------------------------ Sample: slices, START/SPAN, sRev/sNorm (§6.7.5–§6.7.7) */

test('slices: key → slice j = n − root (pitch knobs only), out of range silent, Play Slice to End, Play Single Slice (k.slice, key relative to 60)', () => {
  const { B, X } = load();
  const L = 48000;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 2 }));
  const cpSl = (sl) => cpA({}, s => { s.osc[0].smpo.slice = { mode: 2, thr: 0.5, marks: [0.25, 0.5, 0.75], toEnd: 0, single: 0, root: 48, sync: 0, ...sl }; });
  const run = (cp, key, { knobs = 0, slice = null, n = 30000 } = {}) => {
    const { osc, ctx } = sampleOsc({ f: 440 * 2 ** ((key + knobs - 69) / 12), key }, cp, null, { B, X, ctxEdit: c => { if (slice !== null) ef(c, B, 'SLICE', slice); } });
    const r = play(osc, ctx, n);
    let len = 0;
    for (let i = 0; i < n; i++) if (r.L[i] !== 0) len = i + 1;
    return { r, len, osc };
  };
  const cp = cpSl({});
  assert.equal(cp.sSlN[0], 4); assert.deepEqual(Array.from(cp.sSlPos.subarray(0, 6)), [0, 0.25, 0.5, 0.75, 1, 0]);
  let x = run(cp, 50);
  assert.ok(Math.abs(x.r.L[0] - 0.5) < 1e-7 && Math.abs(x.len - 12000) <= 1, `key 50 → slice 2 from 0.5 for a quarter (${x.len})`);
  x = run(cp, 48, { knobs: 12 });
  assert.ok(x.r.L[0] === 0 && Math.abs(x.r.L[100] - 200 / L) < 1e-7 && Math.abs(x.len - 6000) <= 1, 'knobs +12: twice the speed ' + x.len);
  for (const k of [47, 52]) { x = run(cp, k); assert.equal(x.len, 0, 'key ' + k + ' is outside the slices'); assert.equal(x.osc.active(), false); }
  x = run(cpSl({ toEnd: 1 }), 49, { n: 40000 });
  assert.ok(Math.abs(x.r.L[0] - 0.25) < 1e-7 && Math.abs(x.len - 36000) <= 1, 'Play Slice to End: to Sample End (' + x.len + ')');
  const one = cpSl({ single: 1 });
  x = run(one, 72, { slice: 1 / 255 });
  assert.ok(Math.abs(x.r.L[0] - 0.25) < 1e-7 && Math.abs(x.r.L[10] - (12000 + 20) / L) < 1e-7 && Math.abs(x.len - 6000) <= 1,
    'single slice 1 at key 72: ρ 2 relative to MIDI 60');
  x = run(one, 30, { slice: 200 / 255 });
  assert.ok(Math.abs(x.r.L[0] - 0.75) < 1e-7, 'k.slice clamped to the last slice, every key plays');
});

test('unison START / SPAN: Δ_i = (ustart·u_i + uspan·i/N)·(E − S) with r2 draws only when START ≠ 0; past E: loop wrap or silence', () => {
  const { B, X } = load();
  const L = 48000;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 2 }));
  const run = (p, loop, us, usp, seed = 77) => {
    const v = voice(seed), cp = cpA(p, s => { s.osc[0].smpo.loop = loop; });
    const { osc, ctx } = sampleOsc({ f: fRoot(60), N: 4 }, cp, null, { B, X, v, ctxEdit: c => { ef(c, B, 'USTART', us); ef(c, B, 'USPAN', usp); } });
    const r = play(osc, ctx, 64, { raw: true });
    return { first: r.rows.map(row => row[0] * L), v };
  };
  // neutral (§0.7): START 0 and SPAN 0 ⇒ every unison voice starts exactly at S — bit-identical rows, no draw
  {
    const v = voice(5), cp = cpA({ 'a.sstart': 0.1 }, s => { s.osc[0].smpo.loop = 1; });
    const { osc, ctx } = sampleOsc({ f: 0.83 * fRoot(60), N: 4 }, cp, null, { B, X, v });
    const r = play(osc, ctx, 640, { raw: true });
    for (let i = 1; i < 4; i++) assert.deepEqual(Array.from(r.rows[i]), Array.from(r.rows[0]), 'unison ' + i);
    const one = sampleOsc({ f: 0.83 * fRoot(60), N: 1 }, cp, null, { B, X });
    assert.deepEqual(Array.from(play(one.osc, one.ctx, 640, { raw: true }).rows[0]), Array.from(r.rows[0]));
    assert.equal(v.r2, 5);
  }
  let x = run({ 'a.sstart': 0.1, 'a.send': 0.9 }, 0, 0, 1);
  assert.deepEqual(x.first.map(p => Math.round(p)), [4800, 14400, 24000, 33600], 'SPAN: i/N of the region');
  assert.equal(x.v.r2, 77, 'START 0 ⇒ no r2 draw (§0.7)');
  const u = voice(77), d = [u.rnd2(), u.rnd2(), u.rnd2(), u.rnd2()];
  x = run({}, 0, 0.5, 0);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(x.first[i] - 0.5 * d[i] * L) < 0.01, 'START draw ' + i + ': ' + x.first[i] + ' vs ' + 0.5 * d[i] * L);
  // past the region end: a looping mode wraps into the loop, One-shot is silent
  x = run({ 'a.lstart': 0.3, 'a.lend': 0.7 }, 1, 0, 1);
  assert.deepEqual(x.first.map(p => Math.round(p)), [0, 12000, 24000, 16800], 'unison 3 at 0.75 wraps to 0.35');
  x = run({}, 0, 1, 1);
  for (let i = 0; i < 4; i++) {
    const r = d[i] + i / 4;
    if (r > 1) assert.equal(x.first[i], 0, 'One-shot: silent past E');
    else assert.ok(Math.abs(x.first[i] - Math.min(r * L, L - 1)) < 0.01);
  }
});

test('sRev / sNorm: a reversed entry plays as the entry reversed (markers in processed coordinates); Normalise × 1/peak', () => {
  const { B, X } = load();
  const L = 4801, sig = p => 0.3 * Math.sin(0.013 * p) + 0.1 * Math.sin(0.071 * p + 1);
  const a = entry('smp:t', L, sig, { peak: 0.4 }), b = entry('smp:r', L, p => sig(L - 1 - p), { peak: 0.4 });
  assert.equal(B.storeAsset('smp:r', b), true);
  const ops = (o) => s => { s.osc[0].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: null, ...o }; s.osc[0].smpo.loop = 3; };
  const p = { 'a.sstart': 0.1, 'a.lstart': 0.2, 'a.lend': 0.8 };
  const cpRev = cpA(p, ops({ rev: 1 })), cpRef = cpA(p, ops({}), 'sample'), cpN = cpA(p, ops({ rev: 1, norm: 1 }));
  assert.equal(cpRev.sRev[0], 1); assert.equal(cpN.sNorm[0], 1);
  const x = sampleOsc({ f: 0.77 * fRoot(60) }, cpRev, a, { B, X });
  const rx = play(x.osc, x.ctx, 12000);
  const cpRefR = { ...cpRef, smp: ['smp:r', '', ''] };
  const y = sampleOsc({ f: 0.77 * fRoot(60) }, cpRefR, null, { B, X });
  const ry = play(y.osc, y.ctx, 12000);
  let m = 0;
  for (let i = 0; i < rx.L.length; i++) m = Math.max(m, Math.abs(rx.L[i] - ry.L[i]));
  assert.ok(m < 1e-9 && maxAbs(rx.L) > 0.2, 'reversed read ≡ reversed entry: ' + m);
  const z = sampleOsc({ f: 0.77 * fRoot(60) }, cpN, null, { B, X });
  const rz = play(z.osc, z.ctx, 12000);
  for (let i = 0; i < rz.L.length; i += 97) assert.ok(Math.abs(rz.L[i] - rx.L[i] / 0.4) < 1e-12, 'normalised × 1/peak');
});

/* ------------------------------------------------------------------ Sample: reading, levels, aliasing (§6.7.7, §9.4.3) */

test('level selection: the smallest ℓ with |dp|/2^ℓ ≤ 1 (incl. slot speeds), capped at the entry\'s levels; one-chunk crossfade on a change', () => {
  const { B, X } = load();
  B.storeAsset('smp:t', entry('smp:t', 1 << 16, p => Math.sin(p / 300), { nLv: 5 }));
  for (const [rho, want] of [[0.5, 0], [1, 0], [1.01, 1], [2, 1], [3, 2], [4, 2], [8, 3], [16, 4], [64, 4]]) {
    const { osc, ctx } = sampleOsc({ f: rho * fRoot(60) }, cpA({}, s => { s.osc[0].smpo.loop = 1; }), null, { B, X });
    play(osc, ctx, 64);
    assert.equal(osc.st[3], want, 'ρ ' + rho);
  }
  // a level change mid-note crossfades over one chunk (exact levels ⇒ the same signal: no step)
  const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cpA({}, s => { s.osc[0].smpo.loop = 1; }), null, { B, X });
  const r = play(osc, ctx, 4096, { each: (k) => { if (k === 64) ctx.f.fill(2.5 * fRoot(60)); } });
  assert.equal(osc.st[3], 2);
  let step = 0;
  for (let i = 1; i < r.L.length; i++) step = Math.max(step, Math.abs(r.L[i] - r.L[i - 1]));
  assert.ok(step < 2.5 / 300 * 1.01, 'continuous through the level change');
});

test('aliasing: white noise played 2 octaves up at 48 kHz reads level 2 — alias ≤ −50 dBc (levels from smp.sampleLevels)', () => {
  const { B, X } = load();
  const n = 1 << 16, rnd = (() => { let a = 12345; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  // band-limited noise (random-phase unit bins in [k0, k1)) through the inverse FFT
  const band = (f0, f1) => {
    const re = new Float64Array(n), im = new Float64Array(n), k0 = Math.ceil(f0 / 48000 * n), k1 = Math.floor(f1 / 48000 * n);
    for (let k = Math.max(1, k0); k < Math.min(k1, n / 2); k++) { const ph = 2 * Math.PI * rnd(); re[k] = Math.cos(ph); im[k] = Math.sin(ph); re[n - k] = re[k]; im[n - k] = -im[k]; }
    smp.fft(re, im, n, true);
    let pk = 0; for (const x of re) pk = Math.max(pk, Math.abs(x));
    return Float32Array.from(re, x => 0.5 * x / pk);
  };
  const out = (data, nLv) => {
    const levels = smp.sampleLevels(data, null, n, nLv).map(l => ({ len: l.len, L: Float32Array.from(l.L), R: null }));
    B.storeAsset('smp:t', { id: 'smp:t', v: 1, kind: 'smp', bytes: 0, rate: 48000, ch: 1, len: n, root: 60, loop: null, peak: 0.5, levels });
    const { osc, ctx } = sampleOsc({ f: 4 * fRoot(60) }, cpA(), null, { B, X });
    const r = play(osc, ctx, 12000);
    assert.equal(osc.st[3], Math.min(2, nLv - 1), 'level');
    return rms(r.L, 1000, 12000);
  };
  const carrier = band(20, 4500), alias = band(7500, 24000);
  // the alias source is scaled to the carrier's bin amplitude (both peak-normalised: compare per-bin power)
  const pc = out(carrier, 8), pa = out(alias, 8);
  const binsC = 4480 / 48000 * n, binsA = 16500 / 48000 * n, ampC = rms(carrier) / Math.sqrt(binsC), ampA = rms(alias) / Math.sqrt(binsA);
  const dbc = dB((pa / ampA) / (pc / ampC) * Math.sqrt(binsC / binsA));
  assert.ok(dbc <= -50, 'alias ' + dbc.toFixed(1) + ' dBc');
  const pa0 = out(alias, 1);                                     // a single level (no decimated copies): everything folds
  assert.ok(dB((pa0 / ampA) / (pc / ampC) * Math.sqrt(binsC / binsA)) > -10, 'control: reading level 0 aliases');
});

test('wavetables as samples (§9.4.8): root 18.232, whole-table loop, one cycle per 2048-frame frame at the root', () => {
  const { B, X } = load();
  const frames = [0, 1, 2].map(f => Float32Array.from({ length: 2048 }, (_, j) => Math.sin(2 * Math.PI * j / 2048 * (f + 1)) * 0.5));
  const rec = smp.wtAsSample(frames);
  assert.ok(Math.abs(rec.root - 18.232) < 1e-3 && rec.len === 6144 && rec.loop.end === 6144, 'root ' + rec.root);
  const levels = smp.sampleLevels(rec.L, null, rec.len, 8).map(l => ({ len: l.len, L: Float32Array.from(l.L), R: null }));
  const e = { id: 'smp:t', v: 1, kind: 'smp', bytes: 0, rate: rec.rate, ch: 1, len: rec.len, root: rec.root, loop: rec.loop, peak: 0.5, levels };
  assert.ok(Math.abs(fRoot(rec.root) - 48000 / 2048) < 1e-9, 'the root frequency is one frame per 2048 frames');
  const cp = cpA({}, s => { s.osc[0].smpo.loop = 1; });
  for (const fs of [48000, 96000]) {
    const { osc, ctx } = sampleOsc({ f: fRoot(rec.root), fs }, cp, e, { B, X });
    const k = fs / 48000, r = play(osc, ctx, 2 * 6144 * k + 64);
    for (let j = 0; j < 2 * 6144; j += 61) assert.ok(Math.abs(r.L[j * k] - rec.L[j % 6144]) < 1e-6, `fs ${fs}: frame data at ${j}`);
  }
});

/* ------------------------------------------------------------------ Sample: warps on the intra-period phase (§6.6.10) */

// a sine sample recorded at its root with a period of exactly 2048 frames (8 exact levels), played at ρ = 1, fs = rate:
// period k of the output must equal the same warp on a 1-frame sine wavetable (SxWarp.renderWarp2)
const T0 = 2048, ROOT0 = 69 + 12 * Math.log2(48000 / T0 / 440);
const sineP = p => 0.8 * Math.sin(2 * Math.PI * p / T0);
// dcOff: the distortion warps' 5 Hz DC blocker off (RULINGS2 D3; at this 23 Hz root it is far from an ideal DC block,
// which renderWarp2 realises instead: the caller compares the AC part)
function warpRun({ B, X, W }, slots, { mod = null, remap = null, periods = 3, fm = [0, 0], dcOff = false } = {}) {
  const cp = cpA({}, s => { s.osc[0].fm = fm; });
  const { osc, ctx } = sampleOsc({ f: 48000 / T0, CH: 32 }, cp, null, { B, X });
  if (dcOff) for (const S of [osc.ws, osc.wsR]) if (S) S.dcOn = 0;
  const [a = {}, b = {}] = slots;
  ctx.mode1 = a.mode | 0; ctx.mode2 = b.mode | 0; ctx.w1.fill(a.w || 0); ctx.w2.fill(b.w || 0);
  ctx.var1 = a.v || 0; ctx.var2 = b.v || 0; ctx.fm1 = fm[0]; ctx.fm2 = fm[1];
  if (remap) { const R = new Float32Array(3 * 2049); for (let o = 0; o < 3; o++) R.set(remap, o * 2049); ctx.sx.remap = R; }
  const M = new Float64Array(32);
  if (mod) { ctx.mod1 = M; ctx.mod2 = M; ctx.modStride1 = 1; ctx.modStride2 = 1; }
  const r = play(osc, ctx, periods * T0, { each: (k, s0) => { if (mod) for (let s = 0; s < 32; s++) M[s] = mod[(s0 + s) % T0]; } });
  return r.L;
}
const errDb = (x, ref, from) => {
  let e = 0, p = 0;
  for (let j = 0; j < T0; j++) { const d = x[from + j] - ref[j]; e += d * d; p += ref[j] * ref[j]; }
  return 10 * Math.log10(e / p);
};

test('intra-period warps: Sync, Bend+, PWM, Mirror, Remap, Quantize, Flip, Odd/Even (and pairs) on a sine at its root ≡ the wavetable warp (≤ −60 dB)', () => {
  const t = load(), { B, W } = t;
  B.storeAsset('smp:t', entry('smp:t', 8 * T0, sineP, { nLv: 8, root: ROOT0 }));
  const frame = Float32Array.from({ length: T0 }, (_, j) => sineP(j));
  const remap = Float32Array.from({ length: 2049 }, (_, j) => { const x = j / 2048; return x * x * (3 - 2 * x); });
  const id = (s) => core.WARPS2.findIndex(w => w.id === s);
  const cases = [
    [[{ mode: id('sync'), w: 0.5 }]], [[{ mode: id('sync'), w: 0.7, v: 0.6 }]], [[{ mode: id('bend_p'), w: 0.6 }]], [[{ mode: id('pwm'), w: 0.5 }]],
    [[{ mode: id('mirror'), w: 0.3 }]], [[{ mode: id('remap1'), w: 0.8 }]], [[{ mode: id('remap4'), w: 0.6 }]], [[{ mode: id('quantize'), w: 0.7 }]],
    [[{ mode: id('flip'), w: 0.4 }]], [[{ mode: id('oddeven'), w: 0.2 }]], [[{ mode: id('oddeven'), w: 0.9 }]],
    [[{ mode: id('bend_p'), w: 0.5 }, { mode: id('oddeven'), w: 0.1 }]], [[{ mode: id('sync'), w: 0.4 }, { mode: id('flip'), w: 0.6 }]],
    [[{ mode: id('pwm'), w: 0.3 }, { mode: id('bend_n'), w: 0.4 }]], [[{ mode: id('d_tube'), w: 0.5 }, { mode: id('oddeven'), w: 0.2 }]],
  ];
  for (const [slots] of cases) {
    const dist = slots.some(s => W.META.dist[s.mode] >= 0), x = warpRun(t, slots, { remap, dcOff: dist });
    if (dist) {                                    // renderWarp2 removes a distortion slot's DC: compare the AC part
      let mu = 0;
      for (let j = 0; j < T0; j++) mu += x[2 * T0 + j] / T0;
      for (let j = 0; j < x.length; j++) x[j] -= mu;
    }
    const ref = W.renderWarp2(frame, slots.map(s => ({ fm: 0, v: 0, ...s })), { over: 1, remap });
    const e = errDb(x, ref, 2 * T0), name = slots.map(s => core.WARPS2[s.mode].id + ' ' + s.w).join(' + ');
    assert.ok(e <= -60, name + ': ' + e.toFixed(1) + ' dB');
  }
});

test('FM / PD / PD (Self) on a sample: playhead increments × g(m), read offsets I·m·T₀ (unwrapped) and per-sample self feedback ≡ the wavetable path', () => {
  const t = load(), { B, W } = t;
  B.storeAsset('smp:t', entry('smp:t', 24 * T0, sineP, { nLv: 8, root: ROOT0 }));
  const frame = Float32Array.from({ length: T0 }, (_, j) => sineP(j)), mod = Float64Array.from({ length: T0 }, (_, j) => Math.sin(2 * Math.PI * 2 * j / T0));
  const id = (s) => core.WARPS2.findIndex(w => w.id === s);
  // [slots, FM types, compared period]: Thru-Zero FM and PD may read before the sample start in the first periods (clamped
  // there, a wavetable wraps; PD offsets reach 4 periods): periods 1 / 3; Exp / Linear FM drift in phase (mean g ≠ 1): period 0; PD (Self): the 9th period, as renderWarp2,
  // at amounts whose feedback loop gain I·2π·0.8 stays below 1 (above it the per-sample map is chaotic: the decimated reads'
  // 1e-9 interpolation differences grow)
  for (const [slots, fm, warm] of [[[{ mode: id('fm_o1'), w: 0.4 }], [0, 0], 1], [[{ mode: id('fm_o1'), w: 0.3 }], [1, 0], 0],
    [[{ mode: id('fm_o1'), w: 0.5 }], [2, 0], 0], [[{ mode: id('pd_o1'), w: 0.5 }], [0, 0], 3], [[{ mode: id('pd_sub'), w: 0.8 }], [0, 0], 3],
    [[{ mode: id('pd_o1'), w: 0.4 }, { mode: id('bend_p'), w: 0.3 }], [0, 0], 3], [[{ mode: id('pd_self'), w: 0.25 }], [0, 0], 8],
    [[{ mode: id('pd_self'), w: 0.2 }, { mode: id('oddeven'), w: 0.3 }], [0, 0], 8]]) {
    const x = warpRun(t, slots, { mod, periods: warm + 1, fm });
    const ref = W.renderWarp2(frame, slots.map((s, k) => ({ fm: fm[k], v: 0, ...s })), { over: 1, mod });
    const e = errDb(x, ref, warm * T0), name = slots.map(s => core.WARPS2[s.mode].id + ' ' + s.w).join(' + ') + ' fm ' + fm[0];
    assert.ok(e <= -60, name + ': ' + e.toFixed(1) + ' dB');
  }
  // PD offsets several periods long are kept (unwrapped): a non-periodic ramp shows the offset I·m·T₀ itself
  const L = 64 * T0;
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 8, root: ROOT0 }));
  const one = new Float64Array(T0).fill(1);
  const x = warpRun(t, [{ mode: id('pd_o1'), w: 1 }], { mod: one, periods: 1 });
  assert.ok(Math.abs(x[100] - (100 + 3 * T0) / L) < 1e-9, 'offset 3·T₀ (I = 3 at w = 1): ' + (x[100] * L - 100) / T0);
});

test('warped reads wrap or clamp as the playhead does (§6.6.10): inside a loop they wrap into [LS, LE), elsewhere they stay in the region', () => {
  const t = load(), { B } = t;
  const L = 64 * T0, id = (x) => core.WARPS2.findIndex(w => w.id === x), wI1 = Math.pow(1 / 3, 2 / 3);   // PD index I = 1 ⇒ +1·T₀
  B.storeAsset('smp:t', entry('smp:t', L, j => j / L, { nLv: 8, root: ROOT0 }));
  const one = new Float64Array(T0).fill(1);
  for (const [loop, p] of [[1, { 'a.lstart': 0.25, 'a.lend': 0.5 }], [3, { 'a.lstart': 0.25, 'a.lend': 0.5 }], [0, { 'a.send': 0.5 }]]) {
    const cp = cpA(p, s => { s.osc[0].smpo.loop = loop; });
    const { osc, ctx } = sampleOsc({ f: 48000 / T0 }, cp, null, { B, X: t.X });
    ctx.mode1 = id('pd_o1'); ctx.w1.fill(wI1); ctx.mod1 = one; ctx.modStride1 = 0;
    const r = play(osc, ctx, 40 * T0);
    if (loop) {
      for (let s = 20 * T0; s < r.L.length; s++) assert.ok(r.L[s] >= 0.25 - 1e-7 && r.L[s] < 0.5, `loop ${loop}: read ${r.L[s] * L} stays in the loop`);
      assert.ok(Math.abs(r.L[17 * T0] - (17 * T0 + T0) / L) < 1e-7, 'approach: +T₀');
    } else {
      // clamped inside [S, E): 2^ℓ level-0 frames in from E (ℓ = the read level), so no read interpolates across E
      const q = r.L[31 * T0 + 5] * L, k = Math.log2(L / 2 - q);
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6 && k >= 0 && k <= 7, `One-shot: clamped to E − 2^ℓ within the last period (${q})`);
      assert.ok(Math.abs(r.L[32 * T0 - 1] * L - q) < 1e-6, 'held there to the end');
      assert.ok(r.L[33 * T0] === 0, 'then silent');
    }
  }
});

/* ------------------------------------------------------------------ Multisample (§6.8) */

function multiOsc(t, zones, cpEdit = null, ctxOpts = {}, { v = voice(), ctxEdit = null, dc = null } = {}) {
  const { B, X } = t;
  const vals = dc || { 'smp:a': 0.1, 'smp:b': 0.2, 'smp:c': 0.3, 'smp:d': 0.4, 'smp:z': 0.5 };
  for (const [id, val] of Object.entries(vals)) if (!B.getAsset(id)) B.storeAsset(id, entry(id, 4 * 48000, () => val));
  B.storeAsset('msmp:t', { id: 'msmp:t', v: 1, kind: 'multi', bytes: 0, zones });
  const cp = cpA({}, cpEdit, 'multi');
  const osc = new X.MultiOsc(v, 0);
  assert.equal(osc.apply(cp, 0, null), true);
  const ctx = ctxOf(cp, { f: fRoot(60), ...ctxOpts });
  if (ctxEdit) ctxEdit(ctx);
  osc.noteOn(ctx, true, false);
  return { osc, ctx, cp };
}

test('multisample zones: key / velocity / TIMBRE choose the layers (≤ 8, entry order); velocity layers stack', () => {
  const t = load(), { B } = t;
  const zones = [zone({ hi: 59, vhi: 63, smp: 'smp:a' }), zone({ hi: 59, vlo: 64, smp: 'smp:b' }), zone({ lo: 60, smp: 'smp:c' }),
    zone({ lo: 60, vlo: 100, smp: 'smp:d' })];
  const at = (key, vel, tim = 0) => {
    const { osc, ctx } = multiOsc(t, zones, null, { key, vel }, { ctxEdit: c => { ef(c, B, 'MVEL', 0); ef(c, B, 'TIMBRE', (tim + 64) / 128); } });
    const r = play(osc, ctx, 128);
    return { y: +r.L[100].toFixed(6), nL: osc.nL, zone: osc.zone };
  };
  assert.deepEqual(at(50, 0.3), { y: 0.1, nL: 1, zone: 0 });
  assert.deepEqual(at(50, 0.8), { y: 0.2, nL: 1, zone: 1 });
  assert.deepEqual(at(70, 0.5), { y: 0.3, nL: 1, zone: 2 });
  assert.deepEqual(at(70, 1), { y: 0.7, nL: 2, zone: 2 }, 'two velocity layers');
  assert.deepEqual(at(70, 0.3, 12), { y: 0.1, nL: 1, zone: 0 }, 'TIMBRE +12: zones mapped 12 keys lower');
  assert.deepEqual(at(55, 0.3, -10), { y: 0.3, nL: 1, zone: 2 }, 'TIMBRE −10');
  const none = multiOsc(t, [zone({ lo: 80, smp: 'smp:a' })], null, { key: 60 });
  assert.equal(none.osc.active(), false, 'no zone ⇒ silent');
  const nine = multiOsc(t, Array.from({ length: 9 }, () => zone({ smp: 'smp:a' })), null, { key: 60 });
  assert.equal(nine.osc.nL, 8, '≤ 8 layers');
});

test('multisample pitch and start: ρ = 2^((P − (root + tune/100))/12) from the played key; RAND start off + mrand·u·min(len/4, 2·rate); pan', () => {
  const t = load(), { B } = t;
  B.storeAsset('smp:r', entry('smp:r', 48000, j => j / 48000));
  const z = zone({ smp: 'smp:r', root: 60, tune: 50, off: 1000, pan: 0.5 });
  const v = voice(9), { osc, ctx } = multiOsc(t, [z], null, { f: fRoot(60.5), fs: 48000, key: 60 }, { v, ctxEdit: c => ef(c, B, 'MRAND', 0.5) });
  const u = voice(9).rnd2();
  const r = play(osc, ctx, 2048);
  const p0 = 1000 + 0.5 * u * Math.min(12000, 96000);
  const gL = Math.SQRT2 * Math.cos(1.5 * Math.PI / 4), gR = Math.SQRT2 * Math.sin(1.5 * Math.PI / 4);
  assert.ok(Math.abs(r.L[1000] / gL - (p0 + 1000) / 48000) < 1e-9, 'playhead at ρ 1: ' + r.L[1000] / gL * 48000);
  assert.ok(Math.abs(r.R[1000] / r.L[1000] - gR / gL) < 1e-9, 'equal-power pan');
});

test('round robin: zones sharing ranges play in rr order per note-on; the counter is per processor and oscillator (sx.msRR)', () => {
  const t = load();
  const zones = [zone({ smp: 'smp:a', rr: [3, 1] }), zone({ smp: 'smp:b', rr: [3, 2] }), zone({ smp: 'smp:c', rr: [3, 3] }), zone({ smp: 'smp:d', lo: 100 })];
  const sx = { msRR: new Uint32Array(3 * 512) };
  const seq = [];
  for (let k = 0; k < 7; k++) {
    const { osc, ctx } = multiOsc(t, zones, null, { key: 60 }, { ctxEdit: c => { c.sx = sx; } });
    seq.push(+play(osc, ctx, 64).L[40].toFixed(6));
  }
  assert.deepEqual(seq, [0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1]);
  // a voice whose processor holds the counters makes apply create sx.msRR (once)
  const { X } = t, proc = { sx: {} }, o = new X.MultiOsc({ ...voice(), proc }, 0);
  o.apply(cpA({}, null, 'multi'), 0, null);
  assert.ok(Object.prototype.toString.call(proc.sx.msRR) === '[object Uint32Array]' && proc.sx.msRR.length === 1536);
});

test('another multisample selected while a note holds: the note restarts on the new entry (its zone, root and pitch)', () => {
  const { B, X } = load();
  const sine = f => j => 0.5 * Math.sin(2 * Math.PI * f * j / 48000);
  B.storeAsset('smp:a0', entry('smp:a0', 48000, sine(fRoot(60)), { root: 60 }));
  B.storeAsset('smp:b0', entry('smp:b0', 48000, sine(fRoot(72)), { root: 72 }));
  B.storeAsset('smp:b1', entry('smp:b1', 4800, sine(fRoot(36)), { root: 36 }));
  B.storeAsset('msmp:A', { id: 'msmp:A', v: 1, kind: 'multi', bytes: 0, zones: [zone({ smp: 'smp:a0', mode: 'loop', ls: 1000, le: 40000 })] });
  B.storeAsset('msmp:B', { id: 'msmp:B', v: 1, kind: 'multi', bytes: 0, zones: [zone({ smp: 'smp:b1', hi: 47, root: 36 }),
    zone({ smp: 'smp:b0', lo: 48, root: 72 })] });
  const mk = id => { const s = core.defaultSerum(); s.osc[0].type = 'multi'; s.osc[0].multi = id; return core.compileSerum(core.normalizeSerum(s), {}).serum; };
  const cpA_ = mk('msmp:A'), cpB = mk('msmp:B');
  const freq = (a, from, to) => { let z = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) z++; return z * 48000 / (to - from); };
  const osc = new X.MultiOsc(voice(), 0);
  osc.apply(cpA_, 0, null);
  const ctx = ctxOf(cpA_, { f: fRoot(60), key: 60 });
  osc.noteOn(ctx, true, false);
  play(osc, ctx, 4800);
  assert.equal(osc.zone, 0);
  osc.apply(cpB, 0, null); ctx.cp = cpB; ctx.eff = Float64Array.from(cpB.base);
  const r = play(osc, ctx, 9600);
  assert.equal(osc.zone, 1, 'the zone of key 60 in the new entry (M2: zone 0 of B with A\'s root)');
  assert.ok(Math.abs(freq(r.L, 0, 9600) - fRoot(60)) < 6 && osc.active(), 'plays at the note\'s pitch: ' + freq(r.L, 0, 9600));
  // a zone sample arriving later only resolves its layer (no restart)
  B.storeAsset('smp:zz', entry('smp:zz', 100, () => 0));
  const z0 = osc.zone, nL = osc.nL, p0 = osc.st[0];
  play(osc, ctx, 32);
  assert.ok(osc.zone === z0 && osc.nL === nL && osc.st[0] > p0, 'an unrelated asset epoch keeps the note running');
});

test('zone loops: loop repeats [ls, le); sustain loops while the gate is on, then plays to the end; one-shot plays to the end', () => {
  const t = load(), { B } = t;
  B.storeAsset('smp:r', entry('smp:r', 4800, j => j / 4800));
  for (const mode of ['loop', 'sustain', 'oneshot']) {
    // a 10 s release keeps the layer sounding after note-off; the playhead is read from the layer state per chunk
    const { osc, ctx } = multiOsc(t, [zone({ smp: 'smp:r', mode, ls: 1000, le: 2000, env: [0, 0, 0, 0, 1, 10] })], null, { key: 60 });
    const pos = [];
    const r = play(osc, ctx, 9600, { each: (k, s0) => { if (s0 === 4800) osc.noteOff(); pos.push(osc.st[0]); } });
    if (mode === 'oneshot') { assert.ok(r.L[4799] > 0.99 && r.L[4800] === 0 && !osc.active(), 'one-shot: to the end'); continue; }
    for (let k = 80; k < 150; k++) assert.ok(pos[k] >= 1000 && pos[k] < 2000, mode + ' looping before the release: ' + pos[k]);
    if (mode === 'loop') {
      for (let k = 150; k < 300; k++) assert.ok(pos[k] >= 1000 && pos[k] < 2000, 'loop after note-off: ' + pos[k]);
      assert.ok(osc.active());
    } else {
      const k = pos.findIndex((p, j) => j > 150 && p >= 2000);
      assert.ok(k > 150 && k < 190 && r.L[9599] === 0 && !osc.active(), 'sustain: on to the end after the release (' + k + ')');
    }
  }
});

test('layer envelopes: OVERRIDE DAHDSR from k.m* (delay in beats with DELAY BPM), the zone\'s SFZ envelope, none ⇒ gain 1 with a 1 ms release', () => {
  const t = load(), { B } = t;
  const pow5n = s => Math.pow(s / 32, 0.2);
  const at = (res, sec) => res.L[Math.round(sec * 48000)];
  // override: attack 0.1 s, hold 0, decay 0.2 s to sustain 0.5, release 0.3 s; delay 1 beat (0.5 s at 120 BPM) with DELAY BPM
  {
    const { osc, ctx } = multiOsc(t, [zone({ smp: 'smp:z' })], s => { s.osc[0].msmo.override = 1; s.osc[0].msmo.dlyBpm = 1; }, { key: 60 },
      { ctxEdit: c => { ef(c, B, 'MDLY', 8 / 15); ef(c, B, 'MATT', pow5n(0.1)); ef(c, B, 'MHOLD', 0); ef(c, B, 'MDEC', pow5n(0.2)); ef(c, B, 'MSUS', 0.5); ef(c, B, 'MREL', pow5n(0.3)); } });
    const r = play(osc, ctx, 48000 * 2, { each: (k, s0) => { if (s0 === 48000) osc.noteOff(); } });
    assert.ok(at(r, 0.4) === 0, 'delay');
    assert.ok(Math.abs(at(r, 0.55) - 0.5 * 0.5) < 0.01, 'attack half way: ' + at(r, 0.55));
    assert.ok(Math.abs(at(r, 0.7) - 0.5 * 0.75) < 0.01, 'decay half way: ' + at(r, 0.7));
    assert.ok(Math.abs(at(r, 0.95) - 0.25) < 1e-6, 'sustain');
    assert.ok(Math.abs(at(r, 1.15) - 0.25 * 0.5) < 0.01, 'release half way: ' + at(r, 1.15));
    assert.ok(at(r, 1.4) === 0 && !osc.active(), 'released');
  }
  // the zone envelope [delay, a, h, d, s, r] in seconds
  {
    const { osc, ctx } = multiOsc(t, [zone({ smp: 'smp:z', env: [0.1, 0.1, 0.1, 0.1, 0.4, 0.2] })], null, { key: 60 });
    const r = play(osc, ctx, 48000, { each: (k, s0) => { if (s0 === 24000) osc.noteOff(); } });
    assert.equal(at(r, 0.05), 0);
    assert.ok(Math.abs(at(r, 0.15) - 0.25) < 0.01 && Math.abs(at(r, 0.25) - 0.5) < 1e-6 && Math.abs(at(r, 0.35) - 0.35) < 0.01, 'attack, hold, decay');
    assert.ok(Math.abs(at(r, 0.45) - 0.2) < 1e-6 && Math.abs(at(r, 0.6) - 0.1) < 0.01 && at(r, 0.75) === 0, 'sustain, release');
  }
  // no envelope: gain 1, 1 ms release
  {
    const { osc, ctx } = multiOsc(t, [zone({ smp: 'smp:z' })], null, { key: 60 });
    const r = play(osc, ctx, 4800, { each: (k, s0) => { if (s0 === 2400) osc.noteOff(); } });
    assert.ok(Math.abs(r.L[2000] - 0.5) < 1e-12 && r.L[2400 + 48 + 32] === 0 && !osc.active(), 'gain 1, then a 1 ms release');
  }
});

test('velocity tracking: layer gain 10^(gain/20)·(1 − vt·k_mvel·(1 − (v/127)²))', () => {
  const t = load(), { B } = t;
  for (const [gain, vt, mv, vel] of [[0, 1, 1, 1], [0, 1, 1, 0.5], [-6, 1, 1, 0.5], [3, 0.5, 0.5, 0.2], [0, 0, 1, 0.1], [0, 1, 0, 0.1]]) {
    const { osc, ctx } = multiOsc(t, [zone({ smp: 'smp:z', gain, vt })], null, { key: 60, vel }, { ctxEdit: c => ef(c, B, 'MVEL', mv) });
    const v = Math.round(127 * vel) / 127, want = 0.5 * 10 ** (gain / 20) * (1 - vt * mv * (1 - v * v));
    assert.ok(Math.abs(play(osc, ctx, 64).L[40] - want) < 1e-9, `gain ${gain} vt ${vt} mvel ${mv} vel ${vel}`);
  }
});

/* ------------------------------------------------------------------ allocation-free, lazy references (§0.3) */

test('allocation-free: noteOn / render / noteOff / kill / active / grains with warps, loops and re-applies of a selected type', () => {
  const { S, B, X } = load();
  const id = (s) => core.WARPS2.findIndex(w => w.id === s);
  const cp = cpWith(st => { st.osc[0].smpo.lenBpm = 0; st.osc[0].smpo.slice.mode = 0; st.p['a.xfade'] = 0.4; st.osc[0].smpo.ops.rev = 1; });
  const cp2 = cpWith(st => { st.osc[0].smpo.loop = 1; st.osc[1].msmo.override = 0; });
  B.storeAsset('smp:a', entry('smp:a', 4096, p => Math.sin(p / 30), { nLv: 3, R: p => Math.cos(p / 30) }));
  B.storeAsset('msmp:m', multiEntry('msmp:m')); B.storeAsset('smp:z', entry('smp:z', 2048, p => Math.sin(p / 20), { nLv: 2 }));
  const oscs = [new X.SampleOsc(voice(1), 0), new X.MultiOsc(voice(2), 1)];
  for (const [i, osc] of oscs.entries()) osc.apply(cp, i, null);
  const ctxs = [ctxOf(cp, { o: 0, N: 7, CH: 8 }), ctxOf(cp, { o: 1, N: 3, CH: 8 })], OL = new Float64Array(32), OR = new Float64Array(32);
  const RAW = new Float64Array(512), M = new Float64Array(16 * 32).fill(0.3);
  const modes = [[id('sync'), id('oddeven')], [id('pd_self'), id('lpf')], [id('fm_o1'), id('pd_o1')], [id('d_stomp'), id('flip')], [id('remap2'), 0]];
  // positive control: a first selecting apply allocates, so the instrumentation would catch it
  assert.throws(() => noAlloc(S, () => new X.SampleOsc(voice(), 0).apply(cp, 0, null)), /allocation/);
  noAlloc(S, () => {
    for (let k = 0; k < 400; k++) {
      if (k % 40 === 10) for (const [i, osc] of oscs.entries()) osc.apply(k % 80 === 10 ? cp2 : cp, i, null);
      if (k % 50 === 0) for (const [i, osc] of oscs.entries()) osc.noteOn(ctxs[i], true, false);
      if (k % 50 === 30) for (const osc of oscs) osc.noteOff();
      if (k % 100 === 99) for (const osc of oscs) osc.kill();
      if (k === 120) B.storeAsset('smp:b', smpEntry('smp:b'));    // epoch change mid-note: re-resolution allocates nothing
      const [m1, m2] = modes[(k >> 4) % modes.length];
      for (const c of ctxs) { c.mode1 = m1; c.mode2 = m2; c.w1.fill(0.4); c.w2.fill(0.6); c.mod1 = M; c.mod2 = M; c.modStride1 = 7; c.modStride2 = 1; }
      for (const [i, osc] of oscs.entries()) { osc.render(ctxs[i], OL, OR, i ? null : RAW); osc.active(); osc.grains(); }
    }
  });
  assert.ok(OL.every(Number.isFinite));
});

test('failure isolation: SxBase missing ⇒ apply returns false and warns once; SxWarp missing ⇒ plays with the slots Off, one warning', () => {
  {
    const { S, X } = load({ overrides: { 'sx-base.js': null } });
    assert.ok(X && Object.isFrozen(X));
    assert.equal(S.logs.length, 0, 'nothing read at load time');
    const cp = cpWith();
    for (let i = 0; i < 4; i++) {
      for (const [C, o] of [[X.SampleOsc, 0], [X.MultiOsc, 1]]) {
        const osc = new C(voice(), o), ctx = oscCtx(o), OL = new Float64Array(32).fill(1), OR = new Float64Array(32);
        assert.equal(osc.apply(cp, o, null), false);
        osc.noteOn(ctx, true, false);
        osc.render(ctx, OL, OR, null);
        assert.equal(osc.active(), false); assert.equal(OL[0], 0);
      }
    }
    assert.equal(warns(S).length, 1);
    assert.match(warns(S)[0].text, /SxBase is missing/);
  }
  {
    const { S, B, X } = load({ overrides: { 'sx-warp.js': null } });
    const cp = cpA();
    const { osc, ctx } = sampleOsc({ f: fRoot(60) }, cp, entry('smp:t', 4800, () => 0.5), { B, X });
    ctx.mode1 = core.WARPS2.findIndex(w => w.id === 'flip'); ctx.w1.fill(1);
    const r = play(osc, ctx, 256);
    assert.ok(Math.abs(r.L[100] - 0.5) < 1e-12, 'plays, warp slot acts as Off');
    assert.equal(warns(S).length, 1);
    assert.match(warns(S)[0].text, /SxWarp is missing/);
  }
});

test('the whole §0.3 list with the engine loads; SxSample is a frozen object and logs nothing; v1 states never select it', () => {
  const S = dspScope({ engine: true });
  const X = S.global('SxSample');
  assert.ok(X && Object.isFrozen(X));
  assert.equal(S.logs.filter(m => /sx-sample/.test(m.text)).length, 0);
  // every Phase-1 factory preset migrates to wavetable oscillators: the Sample types stay idle on v1 states (§0.7)
  for (const p of core.FACTORY_PRESETS_V1) {
    const s = core.normalizeSerum(clone(p.v.s));
    assert.equal(s.global.s1, 1, p.name + ' migrates in S1 mode');
    const cp = core.compileSerum(s, {}).serum;
    assert.deepEqual(Array.from(cp.oType), [0, 0, 0]);
    const osc = new X.SampleOsc(voice(), 0);
    assert.equal(osc.apply(cp, 0, null), true); assert.equal(osc.sel, 0);
  }
});

/* ------------------------------------------------------------------ CPU: §14.1 rows e, f, f′ through the voice */

// §14.1 node gate through tests/cpu-gate.mjs (calibrated pairs, retries; RULINGS2 Performance): load ≤ 1.5 × target
const gateLoad = async (fn, target) => (await CPU.gateLoad(fn, target)).load;
const T_REF_CALIB = CPU.T_REF_CALIB;
// n voices of a v2 state through SerumVoice (fast scope), 1 s of audio per call of the returned function
function voiceBench(sc, s, n, assets) {
  const S = sc.global('SerumDSP'), B = sc.global('SxBase');
  for (const [id, e] of Object.entries(assets)) assert.equal(B.storeAsset(id, e), true, id);
  const P = core.compileSerum(core.normalizeSerum(s), {}), cp = P.serum;
  const proc = { base: 48000, OS: 2, fs: 96000, CH: 8, p: { serum: cp, fxr: null }, ct: P.serumT, bendRaw: 0, wheel: 0, at: 0,
    pat: new Float64Array(128), patSeen: false, bpm: 120, songBeat: () => null, held: [], voices: [], sx: null, mpe: new Float64Array(68), vcN: 0 };
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

test('CPU rows e (16 voices Multisample), f (16 voices stereo Sample, unison 4, Fwd loop with X-fade), f′ (8 voices, unison 4, Sync + Bend+) — §14.1 node gate', async () => {
  const sc = dspScope({ fast: true });
  const n = 96000, wav = (hz, ph) => Float32Array.from({ length: n }, (_, j) => 0.4 * Math.sin(2 * Math.PI * hz * j / 48000 + ph) + 0.1 * Math.sin(2 * Math.PI * 3.01 * hz * j / 48000));
  const mk = (id, L, R, root) => ({ id, v: 1, kind: 'smp', bytes: 0, rate: 48000, ch: R ? 2 : 1, len: n, root, loop: null, peak: 0.5,
    levels: smp.sampleLevels(L, R, n, 8).map(l => ({ len: l.len, L: Float32Array.from(l.L), R: l.R ? Float32Array.from(l.R) : null })) });
  const assets = { 'smp:st': mk('smp:st', wav(220, 0), wav(220, 1), 57) };
  // a piano-like multisample: 16 zones (8 key ranges × 2 velocity layers), sustain loops
  const zs = [];
  for (let k = 0; k < 8; k++) for (let v = 0; v < 2; v++) {
    const id = `smp:z${k}${v}`, root = 24 + 12 * k;
    assets[id] = mk(id, wav(fRoot(root), v), null, root);
    zs.push(zone({ lo: k ? root - 6 : 0, hi: k < 7 ? root + 5 : 127, vlo: v ? 80 : 1, vhi: v ? 127 : 79, root, smp: id, mode: 'sustain', ls: 24000, le: 72000, env: [0, 0.002, 0, 2, 0.3, 0.4] }));
  }
  assets['msmp:p'] = { id: 'msmp:p', v: 1, kind: 'multi', bytes: 0, zones: zs };
  const st = (edit) => { const s = core.defaultSerum(); Object.assign(s.p, { 'a.rand': 0, 'e1.att': 0 }); s.osc[0].route = 1; edit(s); return s; };
  const W2 = (x) => core.WARPS2.findIndex(w => w.id === x) / 81;
  const e = voiceBench(sc, st(s => { s.osc[0].type = 'multi'; s.osc[0].multi = 'msmp:p'; s.voicing.poly = 16; }), 16, assets);
  const f = voiceBench(sc, st(s => { s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:st'; s.osc[0].smpo.loop = 1; s.voicing.poly = 16;
    Object.assign(s.p, { 'a.uni': 3 / 15, 'a.det': 0.3, 'a.lstart': 0.2, 'a.lend': 0.8, 'a.xfade': 0.5 }); }), 16, {});
  const f2 = voiceBench(sc, st(s => { s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:st'; s.osc[0].smpo.loop = 1;
    Object.assign(s.p, { 'a.uni': 3 / 15, 'a.det': 0.3, 'a.w1': W2('sync'), 'a.warp': 0.5, 'a.w2': W2('bend_p'), 'a.warp2': 0.5 }); }), 8, {});
  for (const [b, nv] of [[e, 16], [f, 16], [f2, 8]]) {
    assert.equal(b.vs.filter(v => v.active).length, nv);
    assert.ok(rms(b.L) > 1e-3, 'audible');
  }
  assert.equal(e.vs[0].ox[0].nL, 1); assert.equal(f2.vs[0].ox[0].m0, core.WARPS2.findIndex(w => w.id === 'sync'));
  const le = await gateLoad(e.go, 0.12), lf = await gateLoad(f.go, 0.35), lf2 = await gateLoad(f2.go, 0.35);
  console.log(`  CPU (e) ${le.toFixed(3)} (target 0.12), (f) ${lf.toFixed(3)} (target 0.35), (f′) ${lf2.toFixed(3)} (target 0.35) — OS 2; ` +
    (T_REF_CALIB > 0 ? 'calibrated' : 'uncalibrated (no tests/bench.json)'));
  assert.ok(le <= 1.5 * 0.12, '(e) ' + le.toFixed(3));
  assert.ok(lf <= 1.5 * 0.35, '(f) ' + lf.toFixed(3));
  assert.ok(lf2 <= 1.5 * 0.35, '(f′) ' + lf2.toFixed(3));
});
