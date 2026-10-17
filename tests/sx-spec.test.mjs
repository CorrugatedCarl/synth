// sx-spec.js unit tests (owner D5; SPEC-serum2 §11.8, §6.10, §15.8). M1b: exports and signatures, CP shape validation
// against serum-core's compiled CP v2, the processor-level stream pool, specCap, silence without an entry, entry resolution
// by asset epoch, lazy warm-up, allocation-free hot paths. M2 (the Spectral oscillator, below the M1b block): identity
// resynthesis and the onset fade, pitch (incl. non-integer ratios without beating), time stretch, staggered synthesis,
// Lo/Hi limits and Smooth, the spectral filter and CUT, every spectral warp's defining property and neutral value, the
// Vocode/Mask modulator ring at base rate, the F/P-domain warps through the warp delay line (PD sidebands, D₀, the mode
// crossfade), O-domain warps per stream, Phase Lock, transients, loop modes and START/SPAN per stream, Manual X|Y, the
// entry root, failure isolation, allocation-free rendering with every feature, and the §14.1 CPU rows h, h′. Review
// round 2: F/P + stateful O slot pairs (one SxWarp.chunk per slot per chunk), F/P modes at note-on (no crossfade) and the
// Sync window on the Odd/Even read, per-slot Vocode/Mask modulators, legato after a played-out One-shot, loop crossfades
// toward the wrap the playhead travels to, held reads on covered frames and phases after edge frames, the sparse-pre-roll
// onset (no steps, 3 frames in the first hop, burst gate at unison 4 / OS 4), Draft and 44.1 kHz pitch ripple, lazy
// per-stream buffers and the §14.2 pool budget, X|Y Level/Warp left to the voice.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../serum-core.js?v=10';
import * as smp from '../smp.js?v=10';
import { dspScope, noAlloc, source } from './dsp-scope.mjs';
import * as CPU from './cpu-gate.mjs';

const scope = (opts = {}) => {
  const S = dspScope({ files: ['sx-base.js', 'sx-warp.js', 'sx-spec.js'], ...opts });
  return { S, B: S.global('SxBase'), W: S.global('SxWarp'), X: S.global('SxSpec') };
};
// a normalized v2 state whose oscillator o is Spectral on the sample `smp:voice`, with `edit(osc)` applied first
function specState(o = 0, edit = null) {
  const s = core.defaultSerum();
  s.osc[o].type = 'spec'; s.osc[o].smp = 'smp:voice';
  if (edit) edit(s.osc[o]);
  return core.normalizeSerum(s);
}
const cpOf = (s, ctx = {}) => core.compileSerum(s, ctx).serum;
const mkProc = ({ base = 48000, os = 2, offline = false } = {}) => ({ base, fs: base * os, CH: 16 * os, offline, sx: {} });
const mkCtx = (N = 1, CH = 16) => ({ o: 0, N, CH });
const frames = 4;
function specEntry(id, N = 2048) {                         // a valid `spec` analysis entry (§4.5)
  const nb = frames * (N / 2 + 1);
  return { id, v: 1, kind: 'spec', bytes: 8 * nb, rate: 48000, ch: 1, len: frames * N / 4, N, hop: N / 4, frames,
    mag: new Float32Array(nb), ph: new Float32Array(nb), trans: new Uint8Array(frames), peak: 0.5 };
}

/* ------------------------------------------------------------------ loading and shape (§0.3, §11.8) */

test('loads in a bare scope, publishes only the frozen SxSpec with the §11.8 API; reads no global at load', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('sx-spec.js');                                   // without SxBase: loads anyway (lazy references)
  assert.deepEqual([...names()].filter(k => !before.has(k)), ['SxSpec']);
  const X = S.global('SxSpec');
  assert.ok(X && Object.isFrozen(X) && Object.isFrozen(X.K));
  assert.deepEqual([X.VER, X.MAXCH, X.MAXUNI, X.NSL, X.MAXSTREAMS], [1, 32, 16, 258, 64]);
  for (const [k, n] of Object.entries({ specN: 1, hopOf: 3, poolOf: 1, capOf: 1 })) assert.equal(X[k].length, n, k);
  const o = new X.SpecOsc(null, 0);
  for (const [k, n] of Object.entries({ apply: 3, noteOn: 3, noteOff: 0, render: 4, kill: 0, active: 0, grains: 0 })) {
    assert.equal(typeof o[k], 'function', k); assert.equal(o[k].length, n, k + ' arity');
  }
  assert.equal(o.active(), false); assert.equal(o.grains(), 0);
  const P = new X.Pool();
  for (const k of ['setup', 'take', 'give', 'bytes']) assert.equal(typeof P[k], 'function', k);
  assert.equal(S.logs.length, 0, 'no console output on a clean load');
});

test('the source keeps the §0.3/§0.4 rules: one IIFE, environment neutral, no instanceof, no Math.random, lazy SxBase/SxWarp only', () => {
  const code = source('sx-spec.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code.trim(), /^\(function \(\) \{\n  'use strict';[\s\S]*\}\)\(\);$/);
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window', 'document',
    'self', 'instanceof', 'Math.random', 'SxSample', 'SxGran', 'SerumDSP', 'SxMod', 'SxFilt2', 'SxSeq', 'import', 'export']) {
    assert.ok(!new RegExp('\\b' + w.replace('.', '\\.') + '\\b').test(code), w);
  }
  assert.deepEqual(code.match(/globalThis\.Sx\w+/g).sort(), ['globalThis.SxBase', 'globalThis.SxSpec', 'globalThis.SxSpec', 'globalThis.SxWarp']);
  assert.match(code, /function sxBase\(\) \{\s*\n\s+const B = globalThis\.SxBase;/);
  assert.match(code, /function sxWarp\(\) \{\s*\n\s+const W = globalThis\.SxWarp;/);
});

test('a throwing copy leaves SxSpec null; without SxBase apply refuses (one warning per scope) and render is silent', () => {
  const T = dspScope({ files: ['sx-base.js', 'sx-spec.js'], overrides: { 'sx-spec.js': src => src.replace('try {', 'try { throw new Error("boom");') } });
  assert.equal(T.global('SxSpec'), null);
  assert.ok(T.logs.some(m => m.level === 'error' && /sx-spec: load failed/.test(m.text)));
  const { S, X } = scope({ overrides: { 'sx-base.js': null } });
  const cp = cpOf(specState()), proc = mkProc(), o = new X.SpecOsc({ proc }, 0), o2 = new X.SpecOsc({ proc }, 0);
  assert.equal(o.apply(cp, 0, null), false);
  assert.equal(o2.apply(cp, 0, null), false);
  assert.equal(S.logs.filter(m => m.level === 'warn' && /SxBase is missing/.test(m.text)).length, 1);
  assert.equal(o.ok, 0);
  o.noteOn(mkCtx(), true, false);
  assert.equal(o.active(), false);
  const L = new Float64Array(32).fill(9), R = new Float64Array(32).fill(9);
  o.render(mkCtx(), L, R, null);
  assert.ok(L.slice(0, 16).every(v => v === 0) && R.slice(0, 16).every(v => v === 0));
  assert.equal(proc.sx.specPool, undefined, 'no pool without SxBase');
});

test('K offsets match SxBase.DIDX2 for A, B, C; specN and hopOf (§3.9, §14.3)', () => {
  const { B, X } = scope();
  for (const P of ['A', 'B', 'C']) {
    const k0 = B.DIDX2[P + '_W1'];
    for (const [name, off] of Object.entries(X.K)) assert.equal(B.DIDX2[P + '_' + name], k0 + off, P + '_' + name);
  }
  assert.deepEqual([22050, 44100, 48000, 88200, 96000, 192000].map(X.specN), [2048, 2048, 2048, 4096, 4096, 4096]);
  assert.equal(X.hopOf(2048, 1, 1), 1024);                    // Draft N/2
  assert.equal(X.hopOf(2048, 2, 1), 512);                     // High N/4
  assert.equal(X.hopOf(2048, 4, 1), 256);                     // Ultra N/8
  assert.equal(X.hopOf(2048, 2, 2), 1024);                    // Q1: hop × 2
  assert.equal(X.hopOf(2048, 4, 4), 1024);
  assert.equal(X.hopOf(2048, 1, 2), 1024, 'clamped to N/2');
  assert.equal(X.hopOf(2048, 8, 1), 256, 'clamped to N/8');
  assert.equal(X.hopOf(4096, 2, 1), 1024);
  assert.equal(X.hopOf(2048, NaN, NaN), 1024);
});

/* ------------------------------------------------------------------ apply: CP v2 shapes (§4.1) */

test('apply accepts serum-core\'s compiled CP v2 and copies the oscillator options', () => {
  const { S, X } = scope();
  const s = specState(1, O => {
    O.smpo.loop = 3; O.smpo.phaseLock = 1; O.smpo.transients = 1; O.smpo.scanKey = 1; O.smpo.scanRange = 2;
    O.smpo.ops = { fade: 0, norm: 1, rev: 1, trim: null };
    O.spec.smooth = 1; O.spec.postWarp = 1; O.xy = { on: 1, y: 5, yMode: 2 };
  });
  const cp = cpOf(s, { qr: { specHopMul: 2, specStreams: 8 } });
  assert.equal(cp.oType[1], 4);
  const proc = mkProc(), o = new X.SpecOsc({ proc }, 1);
  assert.equal(o.apply(cp, 1, null), true);
  assert.deepEqual([o.ok, o.sel, o.o], [1, 1, 1]);
  assert.equal(o.id, cp.spec[1]);
  assert.match(o.id, /^spec:smp:voice/);
  assert.deepEqual([o.loop, o.phLock, o.trans, o.scanKey, o.scanR, o.norm, o.rev, o.smooth, o.postWarp, o.xyOn, o.xyY, o.xyMode],
    [3, 1, 1, 1, cp.sScanR[1], 1, 1, 1, 1, 1, 5, 2]);
  assert.equal(o.scanR, 8);
  assert.deepEqual([o.q, o.hopMul, o.nStreams, o.N, o.H], [cp.os, 2, 8, 2048, X.hopOf(2048, cp.os, 2)]);
  assert.deepEqual(Array.from(o.sl), Array.from(cp.sSlPos.subarray(258, 516)));
  assert.deepEqual(Array.from(o.lad), Array.from(cp.lenLad));
  // a wavetable oscillator of the same CP: accepted, not selected, no option arrays
  const w = new X.SpecOsc({ proc }, 0);
  assert.equal(w.apply(cp, 0, null), true);
  assert.deepEqual([w.ok, w.sel, w.sl], [1, 0, null]);
  // the explicit qr argument wins over CP.qr
  const q = new X.SpecOsc({ proc }, 1);
  q.apply(cp, 1, Float64Array.from([16, 256, 4, 3, 512]));
  assert.deepEqual([q.hopMul, q.nStreams], [4, 3]);
  assert.equal(S.logs.length, 0);
});

test('apply rejects malformed CPs (every checked field), bad qr and oscillator indices; one warning per scope', () => {
  const { S, X } = scope();
  const good = cpOf(specState());
  const variants = [['no CP', null], ['ver', { ...good, ver: 1 }], ['os', { ...good, os: 3 }], ['spec ids', { ...good, spec: ['', ''] }],
    ['spec types', { ...good, spec: ['', 3, ''] }], ['qr length', { ...good, qr: new Float64Array(4) }],
    ['qr NaN', { ...good, qr: Float64Array.from([16, 256, NaN, 32, 512]) }]];
  const fields = ['base', 'oType', 'bendTrack', 'fmType', 'sLoop', 'sRel', 'sLink', 'sExit', 'sScanKey', 'sScanLock', 'sLenOn', 'sSlMode',
    'sSlEnd', 'sSlOne', 'sSlRoot', 'sPhLock', 'sTrans', 'sSmooth', 'sPostWarp', 'sNorm', 'sRev', 'xyOn', 'xyY', 'xyMode', 'sSlN', 'sSlPos',
    'sScanR', 'lenLad'];
  for (const f of fields) {
    const a = good[f];
    variants.push([f + ' length', { ...good, [f]: new a.constructor(a.length + 1) }]);
    variants.push([f + ' type', { ...good, [f]: a.constructor === Float64Array ? new Float32Array(a.length) : new Float64Array(a.length) }]);
    variants.push([f + ' missing', { ...good, [f]: undefined }]);
  }
  const proc = mkProc();
  for (const [what, cp] of variants) {
    const o = new X.SpecOsc({ proc }, 0);
    assert.equal(o.apply(cp, 0, null), false, what);
    assert.deepEqual([o.ok, o.sel], [0, 0], what);
    o.noteOn(mkCtx(), true, false);
    assert.equal(o.active(), false, what + ': silent');
  }
  for (const bad of [3, -1, 1.5, NaN, undefined]) assert.equal(new X.SpecOsc({ proc }, 0).apply(good, bad, null), false, 'o ' + bad);
  assert.equal(new X.SpecOsc({ proc }, 0).apply(good, 0, new Float64Array(3)), false, 'qr argument');
  const warns = S.logs.filter(m => m.level === 'warn');
  assert.equal(warns.length, 1, 'one warning per scope');
  assert.match(warns[0].text, /^sx-spec: CP not understood/);
  assert.equal(proc.sx.specPool, undefined, 'refused CPs create no pool');
  const o = new X.SpecOsc({ proc }, 0);
  assert.equal(o.apply(good, 0, null), true, 'a good CP after bad ones');
});

/* ------------------------------------------------------------------ the stream pool (§6.10.1, §14.2) */

test('stream pool: created by the first apply selecting Spectral, qr.specStreams streams, lowest index first, specCap', () => {
  const { B, X } = scope();
  const proc = mkProc(), sx = proc.sx;
  const wt = cpOf(core.normalizeSerum(core.defaultSerum())), cp = cpOf(specState(), { qr: { specStreams: 4 } });
  const v = [0, 1, 2].map(() => new X.SpecOsc({ proc }, 0));
  v[0].apply(wt, 0, null);
  assert.equal(X.poolOf(sx), null, 'no pool while no oscillator is Spectral');
  assert.equal(X.capOf(sx), 0);
  for (const o of v) assert.equal(o.apply(cp, 0, null), true);
  const P = X.poolOf(sx);
  assert.ok(P && sx.specPool === P && v.every(o => o.pool === P), 'one pool per processor, owned by sx');
  assert.deepEqual([P.n, P.N, P.os, P.nFree], [4, 2048, 2, 4]);
  assert.equal(P.fft.n, 2048);
  assert.ok(P.st.every(s => s.ola.length === 3072 && s.ph.length === 1025 && s.up.os === 2), 'OLA ring N + N/2, phases N/2 + 1');
  for (const s of P.st) assert.ok(s.bytes <= 64 * 1024, 'stream ≤ 64 KB (§14.2): ' + s.bytes);
  v[0].noteOn(mkCtx(3), true, false);
  assert.deepEqual([v[0].nS, Array.from(v[0].si.subarray(0, 4)), v[0].capped], [3, [0, 1, 2, -1], 0]);
  v[1].noteOn(mkCtx(3), true, false);                         // only one stream left: capped
  assert.deepEqual([v[1].nS, v[1].si[0], v[1].capped, P.nCapped, X.capOf(sx)], [1, 3, 1, 1, 1]);
  assert.equal(v[1].active(), true, 'a capped oscillator still sounds with the streams it has');
  v[2].noteOn(mkCtx(2), true, false);
  assert.deepEqual([v[2].nS, v[2].capped, P.nCapped], [0, 1, 2]);
  v[0].kill();
  assert.deepEqual([v[0].nS, v[0].active(), P.nFree, X.capOf(sx)], [0, false, 3, 1]);
  v[1].kill(); v[2].kill();
  assert.deepEqual([P.nFree, P.nCapped, X.capOf(sx)], [4, 0, 0]);
  v[2].noteOn(mkCtx(2), true, false);
  assert.deepEqual(Array.from(v[2].si.subarray(0, 2)), [0, 1], 'lowest free indices first');
  // legato keeps the streams; a non-legato note returns and re-takes them
  v[2].noteOn(mkCtx(4), false, true);
  assert.deepEqual([v[2].nS, P.nFree], [2, 2]);
  v[1].noteOn(mkCtx(1), true, false);
  assert.equal(v[1].si[0], 2);
  v[2].noteOn(mkCtx(1), true, false);
  assert.deepEqual([v[2].nS, v[2].si[0], P.nFree], [1, 0, 2]);
  v[1].kill(); v[2].kill();
  // a CP that switches the oscillator to another type returns its streams
  v[0].noteOn(mkCtx(4), true, false);
  assert.equal(P.nFree, 0);
  v[0].apply(wt, 0, null);
  assert.deepEqual([v[0].sel, v[0].nS, P.nFree], [0, 0, 4]);
  // unison is capped at 16 streams; a voice without a processor plays without streams
  const big = cpOf(specState(), { qr: { specStreams: 64 } }), proc2 = mkProc(), u = new X.SpecOsc({ proc: proc2 }, 0);
  u.apply(big, 0, null);
  // (M4) a live processor builds 8 streams in the 'patch' message, a lazy job 4 per quantum up to the target
  const P2 = X.poolOf(proc2.sx);
  assert.deepEqual([P2.st.length, P2.n, P2.nT, P2.nFree], [8, 8, 64, 8]);
  let steps = 0;
  while (P2.st.length < 64 && steps < 100) { B.warmTick(proc2); steps++; }
  assert.deepEqual([P2.st.length, P2.n, P2.nFree, steps], [64, 64, 64, 14]);
  u.noteOn(mkCtx(40), true, false);
  assert.equal(u.nS, 16);
  const proc3 = mkProc({ offline: true }), w = new X.SpecOsc({ proc: proc3 }, 0);
  w.apply(big, 0, null);
  assert.deepEqual([X.poolOf(proc3.sx).st.length, X.poolOf(proc3.sx).n, proc3.sxWarm], [64, 64, undefined], 'offline: every stream at once');
  assert.notEqual(X.poolOf(proc2.sx), P, 'another processor, another pool');
  const lone = new X.SpecOsc(null, 0);
  assert.equal(lone.apply(cp, 0, null), true);
  lone.noteOn(mkCtx(2), true, false);
  assert.deepEqual([lone.active(), lone.nS], [true, 0]);
  assert.ok(B);
});

test('stream pool: qr.specStreams resizes in place (busy streams retire), a rate change rebuilds it (holders forget)', () => {
  const { X } = scope();
  const proc = mkProc(), sx = proc.sx;
  const cpN = n => cpOf(specState(), { qr: { specStreams: n } });
  const a = new X.SpecOsc({ proc }, 0), b = new X.SpecOsc({ proc }, 0);
  a.apply(cpN(4), 0, null); b.apply(cpN(4), 0, null);
  const P = X.poolOf(sx), gen = P.gen;
  a.noteOn(mkCtx(4), true, false);
  a.apply(cpN(2), 0, null);                                   // shrink while every stream is busy
  assert.deepEqual([P.n, P.nFree, P.st.length, a.nS], [2, 0, 4, 4]);
  a.kill();
  assert.equal(P.nFree, 2, 'streams 2 and 3 retired, not reusable');
  b.noteOn(mkCtx(4), true, false);
  assert.deepEqual([b.nS, b.capped, Array.from(b.si.subarray(0, 2))], [2, 1, [0, 1]]);
  b.kill();
  a.apply(cpN(6), 0, null);                                   // grow: new streams allocated
  assert.deepEqual([P.n, P.nFree, P.st.length, P.gen], [6, 6, 6, gen]);
  const bytes6 = P.bytes();
  a.noteOn(mkCtx(3), true, false);
  proc.base = 96000; proc.fs = 192000;                        // a rate change (setOS / new context)
  b.apply(cpN(6), 0, null);
  assert.deepEqual([P.N, P.os, P.gen, P.nFree], [4096, 2, gen + 1, 6]);
  assert.ok(P.bytes() > bytes6);
  const L = new Float64Array(32), R = new Float64Array(32);
  a.render(mkCtx(3), L, R, null);
  assert.equal(a.nS, 0, 'indices of the old generation are forgotten, never given back');
  a.kill();
  assert.equal(P.nFree, 6);
  proc.base = 48000; proc.fs = 192000;                        // OS 4
  a.apply(cpN(6), 0, null);
  assert.deepEqual([P.N, P.os], [2048, 4]);
  assert.ok(P.st.every(s => s.up.os === 4));
});

/* ------------------------------------------------------------------ render, entries, warm-up, allocation (§11.8, §11.10) */

test('render: silence on OL/OR and the RAW rows; the analysis entry is resolved by asset epoch (missing ⇒ silence)', () => {
  const { B, X } = scope();
  const proc = mkProc(), o = new X.SpecOsc({ proc }, 0), cp = cpOf(specState());
  o.apply(cp, 0, null);
  const L = new Float64Array(32).fill(7), R = new Float64Array(32).fill(7), RAW = new Float64Array(16 * 32).fill(7), ctx = mkCtx(3, 16);
  o.noteOn(ctx, true, false);
  o.render(ctx, L, R, RAW);
  assert.ok(L.slice(0, 16).every(v => v === 0) && R.slice(0, 16).every(v => v === 0), 'CH samples written');
  assert.ok(L.slice(16).every(v => v === 7), 'only CH samples');
  for (let i = 0; i < 16; i++) for (let s = 0; s < 32; s++) assert.equal(RAW[i * 32 + s], i < 3 && s < 16 ? 0 : 7, `RAW ${i} ${s}`);
  assert.equal(o.e, null, 'entry missing');
  const e = specEntry(cp.spec[0]);
  assert.equal(B.storeAsset(e.id, e), true);
  o.render(ctx, L, R, null);
  assert.equal(o.e, e, 'resolved within one chunk after it arrives');
  B.dropAsset(e.id);
  o.render(ctx, L, R, null);
  assert.equal(o.e, null);
  const wrongKind = { id: cp.spec[0], v: 1, kind: 'multi', bytes: 0, zones: [] };
  assert.equal(B.storeAsset(wrongKind.id, wrongKind), true);
  o.render(ctx, L, R, null);
  assert.equal(o.e, null, 'an entry of another kind is not used');
  o.noteOff();
  assert.deepEqual([o.gate, o.active()], [0, true]);
});

test('lazy warm-up: a live processor queues the FFT warm-up once, offline ones never; warmTick runs it in ≤ 1 ms steps', () => {
  const { B, X } = scope();
  const live = mkProc(), off = mkProc({ offline: true }), cp = cpOf(specState(), { qr: { specStreams: 8 } });   // (8: no growth job)
  const a = new X.SpecOsc({ proc: live }, 0), b = new X.SpecOsc({ proc: live }, 0), c = new X.SpecOsc({ proc: off }, 0);
  a.apply(cp, 0, null); b.apply(cp, 0, null); a.apply(cp, 0, null); c.apply(cp, 0, null);
  assert.equal(live.sxWarm.q.length, 1, 'queued once per processor');
  assert.equal(off.sxWarm, undefined, 'offline renders skip warm-ups');
  const job = live.sxWarm.q[0], left = [];
  for (let i = 0; i < 6; i++) left.push(B.warmTick(live));
  assert.deepEqual(left, [1, 1, 1, 0, 0, 0]);
  assert.equal(X.poolOf(live.sx).warm, 4);
  // one step's work (median of repeated steps, robust against a loaded test machine)
  const times = [];
  for (let i = 0; i < 41; i++) { const t0 = performance.now(); job(live); times.push(performance.now() - t0); }
  times.sort((x, y) => x - y);
  assert.ok(times[20] < 1, 'a step takes ≤ 1 ms: median ' + times[20].toFixed(3) + ' ms');
  // the warm-up touches only the pool's scratch, not the streams
  assert.ok(X.poolOf(live.sx).st.every(s => s.ola.every(v => v === 0)));
});

test('allocation-free: noteOn / render / noteOff / kill / legato and pool take/give after apply', () => {
  const { S, X } = scope();
  const proc = mkProc(), cp = cpOf(specState(), { qr: { specStreams: 6 } });
  const vs = [0, 1, 2].map(() => new X.SpecOsc({ proc }, 0));
  for (const o of vs) o.apply(cp, 0, null);
  const L = new Float64Array(32), R = new Float64Array(32), RAW = new Float64Array(16 * 32), ctx = mkCtx(4, 16);
  noAlloc(S, () => {
    for (let k = 0; k < 200; k++) {
      const o = vs[k % 3];
      if (k % 7 === 0) o.noteOn(ctx, true, false);
      if (k % 11 === 0) o.noteOn(ctx, false, true);
      o.render(ctx, L, R, k % 2 ? RAW : null);
      if (k % 13 === 0) o.noteOff();
      if (k % 17 === 0) o.kill();
    }
  });
  for (const o of vs) o.kill();
  assert.equal(X.poolOf(proc.sx).nFree, 6);
  assert.equal(X.capOf(proc.sx), 0);
});

/* ================================================================== M2: the Spectral oscillator (§6.10, §15.8) */

const SR = 48000, TAU = 2 * Math.PI;
const W2 = id => { const i = core.WARPS2.findIndex(w => w.id === id); assert.ok(i >= 0, id); return i; };
const nHz = f => Math.log(f / core.MIDI0) / Math.log(22050 / core.MIDI0);   // k.flo / k.fhi law (exp MIDI0…22050)
const nScan = sig => (sig / 2 + 1) / 2;                                     // k.scan n for σ at the ±200 % range
const fOf = note => 440 * Math.pow(2, (note - 69) / 12);
const dB = v => 20 * Math.log10(Math.max(Math.abs(v), 1e-15));
let NZ = 0x1234567;
const white = () => { NZ ^= NZ << 13; NZ >>>= 0; NZ ^= NZ >>> 17; NZ ^= NZ << 5; NZ >>>= 0; return NZ / 2147483648 - 1; };
const SIG = {
  sine: Float64Array.from({ length: 2 * SR }, (_, j) => Math.sin(TAU * 440 * j / SR)),
  short: Float64Array.from({ length: SR }, (_, j) => Math.sin(TAU * 440 * j / SR)),
  half: Float64Array.from({ length: 2 * SR }, (_, j) => (j < SR / 2 ? Math.sin(TAU * 440 * j / SR) : 0)),
  split: Float64Array.from({ length: SR }, (_, j) => Math.sin(TAU * (j < SR / 2 ? 440 : 880) * j / SR)),   // 1 s: 440 | 880 Hz
  clicks: Float64Array.from({ length: 2 * SR }, (_, j) => 0.05 * Math.sin(TAU * 330 * j / SR) + (j % 12000 < 24 ? 0.9 : 0)),
  harm: Float64Array.from({ length: 2 * SR }, (_, j) => { let v = 0; for (let h = 1; h <= 30; h++) v += Math.sin(TAU * 220 * h * j / SR + h) / h; return 0.3 * v; }),
  noise: (() => { NZ = 0x1234567; return Float64Array.from({ length: 2 * SR }, () => 0.3 * white()); })(),
  vib: (() => {                                                              // 220 Hz, 10 partials, ±40 cents at 5 Hz
    const y = new Float64Array(2 * SR), ph = new Float64Array(11);
    for (let j = 0; j < y.length; j++) {
      const f = 220 * Math.pow(2, 40 / 1200 * Math.sin(TAU * 5 * j / SR));
      let v = 0;
      for (let h = 1; h <= 10; h++) { ph[h] += TAU * f * h / SR; v += Math.sin(ph[h]) / h; }
      y[j] = 0.4 * v;
    }
    return y;
  })(),
};
const ANA = new Map();                                                        // analyses per signal (smp.specAnalyse, §9.4.6)
function analysis(id, sig, root = 69) {
  let a = ANA.get(sig);
  if (!a) { a = smp.specAnalyse(Float32Array.from(SIG[sig]), null, SR); ANA.set(sig, a); }
  const e = { id, v: 1, kind: 'spec', bytes: a.mag.byteLength + a.ph.byteLength + a.trans.byteLength, ch: 1, rate: a.rate, len: a.len,
    N: a.N, hop: a.hop, frames: a.frames, mag: a.mag, ph: a.ph, trans: a.trans, peak: a.peak };
  if (root !== null) e.root = root;
  return e;
}
function octx(cp, sx, { N = 1, os = 2, f = 440, gain = 1, keyRef = 69 } = {}) {
  const F = () => new Float64Array(16), CH = 4 * os;
  return { o: 0, N, f: F().fill(f), gl: F().fill(gain), gr: F().fill(gain), dgl: F(), dgr: F(), pan: F(), t: F(), w1: F(), w2: F(),
    mode1: 0, mode2: 0, var1: 0, var2: 0, fm1: 0, fm2: 0, mod1: null, mod2: null, modStride1: 0, modStride2: 0,
    eff: Float64Array.from(cp.base), cp, sx, gate: 1, fresh: 1, CH, fs: SR * os, base: SR, bpm: 120, keyRef, rootShift: 0, key: keyRef,
    vel: 1, wbuf: {} };
}
// a Spectral oscillator A on 'smp:t' (analysis of SIG[sig] with root), state edits, its OscCtx (ρ from f). The tests set
// ctx.mode1/mode2 directly, so by default the CP declares both warp-mode destinations modulated (any mode possible: the
// pool allocates every lazy stream buffer, §14.2); anyMode = false keeps the compiled CP as it is
function rig({ sig = 'sine', root = 69, p = {}, edit = null, os = 2, f = 440, N = 1, qr = null, t = null, seed = 0x2545F491, anyMode = true } = {}) {
  const T = t || scope();
  const e = analysis('spec:smp:t', sig, root);
  assert.equal(T.B.storeAsset(e.id, e), true);
  const s = core.defaultSerum();
  s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:t'; s.global.os = os;      // quality = the processor's OS here (§3.9 hop)
  Object.assign(s.p, p);
  if (edit) edit(s, s.osc[0]);
  const cp = core.compileSerum(core.normalizeSerum(s), qr ? { qr } : {}).serum;
  if (anyMode) { cp.modded[T.B.DIDX2.A_W1] = 1; cp.modded[T.B.DIDX2.A_W2] = 1; cp.use |= 4; }
  const proc = { base: SR, fs: SR * os, CH: 4 * os, offline: true, sx: {} };
  let r2 = seed >>> 0 || 1;
  const v = { proc, draws: 0, rnd2() { this.draws++; r2 ^= r2 << 13; r2 >>>= 0; r2 ^= r2 >>> 17; r2 ^= r2 << 5; r2 >>>= 0; r2 = r2 || 1; return r2 / 4294967296; } };
  const o = new T.X.SpecOsc(v, 0);
  assert.equal(o.apply(cp, 0, null), true);
  const ctx = octx(cp, proc.sx, { N, os, f });
  return { ...T, e, s, cp, proc, v, o, ctx, os, P: () => proc.sx.specPool };
}
// n base samples of OS-rate output (L), each(k, ctx) before chunk k; RAW rows when given
function play(R, nBase, { each = null, RAW = null, Rout = null } = {}) {
  const { o, ctx } = R, CH = ctx.CH, os = CH / 4, y = new Float64Array(nBase * os), L = new Float64Array(32), Rr = new Float64Array(32);
  for (let t = 0, k = 0; t < y.length; t += CH, k++) {
    if (each) each(k, ctx);
    o.render(ctx, L, Rr, RAW);
    for (let s = 0; s < CH; s++) { y[t + s] = L[s]; if (Rout) Rout[t + s] = Rr[s]; }
    ctx.fresh = 0;
  }
  return y;
}
const note = (R) => { R.o.noteOn(R.ctx, true, false); return R; };
// amplitude of the spectral line at f (Hann-windowed DFT over y[from … from + n)), sine amplitude units
function lineAmp(y, f, from, n, fs) {
  let re = 0, im = 0, sw = 0;
  const d = TAU * f / fs;
  for (let k = 0; k < n; k++) { const w = 0.5 - 0.5 * Math.cos(TAU * k / n), v = y[from + k] * w; sw += w; re += v * Math.cos(d * (from + k)); im -= v * Math.sin(d * (from + k)); }
  return 2 * Math.hypot(re, im) / sw;
}
// the frequency of the strongest line in [lo, hi] (coarse scan, then golden-section refinement)
function peakHz(y, from, n, fs, lo, hi) {
  const m = f => lineAmp(y, f, from, n, fs);
  let best = lo, bm = -1;
  for (let f = lo; f <= hi; f += fs / n / 2) { const v = m(f); if (v > bm) { bm = v; best = f; } }
  let a = best - fs / n, b = best + fs / n;
  for (let it = 0; it < 50; it++) { const c = a + (b - a) * 0.382, d = a + (b - a) * 0.618; if (m(c) < m(d)) a = c; else b = d; }
  return (a + b) / 2;
}
const cents = (f, ref) => 1200 * Math.log2(f / ref);
// per-period peak envelope over [from, to): min, max (linear)
function envMinMax(y, from, to, per) {
  let mn = Infinity, mx = 0;
  for (let s = from; s + per <= to; s += per) { let m = 0; for (let k = s; k < s + per; k++) m = Math.max(m, Math.abs(y[k])); mn = Math.min(mn, m); mx = Math.max(mx, m); }
  return [mn, mx];
}
const frameM = R => Float64Array.from(R.P().M);
const frameF = R => Float64Array.from(R.P().F);
const argmax = (M, lo = 1, hi = M.length - 1) => { let b = lo; for (let j = lo; j < hi; j++) if (M[j] > M[b]) b = j; return b; };

test('identity resynthesis: a 440 Hz sine (ρ = 1, σ = 1, no warps) is within −40 dB after the first hop at OS 1, 2, 4; the first hop fades in', () => {
  for (const os of [1, 2, 4]) {
    const R = note(rig({ os, edit: (s, O) => { O.smpo.loop = 1; } }));
    const y = play(R, 12000), H = R.o.H, d = new R.B.HBUp(os).delay;
    assert.equal(H, os === 1 ? 1024 : os === 2 ? 512 : 256, 'hop per quality (§3.9): Draft N/2, High N/4, Ultra N/8');
    let e = 0, p = 0;
    for (let s = H * os; s < y.length; s++) { const r = Math.sin(TAU * 440 * (s / os - d) / SR); e += (y[s] - r) ** 2; p += r * r; }
    const err = 10 * Math.log10(e / p);
    assert.ok(err <= -40, `OS ${os}: error ${err.toFixed(1)} dB`);
    // the onset: silent at note-on, below the steady level during the first hop (raised-cosine fade), steady after it
    const [, a0] = envMinMax(y, 0, 16 * os, 16 * os);
    const [lo1, hi1] = envMinMax(y, 2048 * os, y.length, 110 * os);
    assert.ok(a0 < 0.02, 'starts at 0: ' + a0);
    assert.ok(lo1 > 0.999 && hi1 < 1.001, `steady once the analysis window is inside the sample: ${lo1} … ${hi1}`);
    const [, hiH] = envMinMax(y, 0, (H >> 1) * os, (H >> 1) * os);
    assert.ok(hiH < 0.9, 'the first half hop is still fading in: ' + hiH);
  }
});

test('pitch (§6.10.3): ρ = f/f_root moves the spectrum — ×2 → 880 Hz, ×1.5 → 660 Hz without beating, ×8 and ×0.5 keep the level', () => {
  for (const [f, tolDb] of [[880, 0.3], [660, 0.3], [3520, 0.5], [220, 0.3], [1234.5, 0.3]]) {
    const R = note(rig({ f, edit: (s, O) => { O.smpo.loop = 1; } }));
    const y = play(R, 40000);
    const pk = peakHz(y, 16384, 32768, 2 * SR, f * 0.8, f * 1.25);
    assert.ok(Math.abs(cents(pk, f)) < 0.05, `ρ ${f / 440}: peak ${pk.toFixed(3)} Hz`);
    const [mn, mx] = envMinMax(y, 16384, 80000, Math.round(2 * SR / f) * 2);
    assert.ok(Math.abs(dB(mx)) < tolDb && Math.abs(dB(mn)) < tolDb, `ρ ${f / 440}: level ${dB(mn).toFixed(2)} … ${dB(mx).toFixed(2)} dB`);
    assert.ok(dB(mx / mn) < 0.2, `ρ ${f / 440}: envelope ripple ${dB(mx / mn).toFixed(3)} dB (moved sidelobes lock to their lobe)`);
  }
});

test('the analysis root: the entry\'s own root, else 60 — no other entry is consulted (ids are opaque, §4.5); latched per entry object', () => {
  const T = scope();
  const R = rig({ t: T, root: 57 });
  assert.equal(R.o.root, 60, 'before the first render the entry is unresolved (default root 60)');
  play(note(R), 64);
  assert.equal(R.o.root, 57);
  const e = analysis('spec:smp:u~r', 'sine', null);
  assert.equal(T.B.storeAsset(e.id, e), true, 'a spec entry without root is valid');
  const bad = { ...analysis('spec:smp:bad', 'sine', null), root: NaN };
  assert.equal(T.B.storeAsset(bad.id, bad), false, 'a non-finite root is refused');
  const play1 = { id: 'smp:u', v: 1, kind: 'smp', bytes: 0, rate: SR, ch: 1, len: 4, root: 62.5, loop: null, peak: 1, levels: [{ len: 4, L: new Float32Array(4), R: null }] };
  const s = core.defaultSerum();
  s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:u'; s.osc[0].smpo.ops = { fade: 0, norm: 0, rev: 1, trim: null };
  const cp = core.compileSerum(core.normalizeSerum(s), {}).serum;
  assert.equal(cp.spec[0], 'spec:smp:u~r');
  const o = new T.X.SpecOsc({ proc: R.proc, rnd2: () => 0.5 }, 0);
  o.apply(cp, 0, null);
  const ctx = octx(cp, R.proc.sx), L = new Float64Array(32), Rr = new Float64Array(32);
  o.noteOn(ctx, true, false); o.render(ctx, L, Rr, null);
  assert.equal(o.root, 60, 'no root on the entry: 60');
  // a playback entry stored (or dropped) later changes nothing: the pitch never depends on what else is in the store
  const cF = o.cFroot;
  assert.equal(T.B.storeAsset(play1.id, play1), true);
  o.render(ctx, L, Rr, null);
  assert.equal(o.root, 60, 'the playback entry is not consulted');
  assert.equal(o.cFroot, cF);
  T.B.dropAsset(play1.id);
  o.render(ctx, L, Rr, null);
  assert.deepEqual([o.root, o.cFroot], [60, cF], 'an unrelated drop does not retune the note');
  // a new entry object with a root restarts the streams at its pitch
  assert.equal(T.B.storeAsset(e.id, { ...analysis('spec:smp:u~r', 'sine', null), root: 64 }), true);
  o.render(ctx, L, Rr, null);
  assert.equal(o.root, 64);
});

test('time stretch (§6.10.2): σ = 0.5 doubles a one-shot\'s duration with the pitch unchanged (±2 cents); σ = 2 halves it', () => {
  const dur = sig => {
    const R = note(rig({ sig: 'short', p: { 'a.scan': nScan(sig) } }));
    const y = play(R, Math.ceil(1.3 / sig * SR));
    let last = 0;
    for (let s = 0; s < y.length; s++) if (Math.abs(y[s]) > 0.05) last = s;
    return { y, sec: last / (2 * SR), R };
  };
  const a = dur(1), b = dur(0.5), c = dur(2);
  const hop = 512 / SR;
  assert.ok(Math.abs(a.sec - 1) < hop, 'σ 1: ' + a.sec);
  assert.ok(Math.abs(b.sec - 2) < 2 * hop, 'σ 0.5: ' + b.sec);
  assert.ok(Math.abs(c.sec - 0.5) < hop, 'σ 2: ' + c.sec);
  for (const r of [b, c]) {
    const pk = peakHz(r.y, 8192, 32768, 2 * SR, 400, 480);
    assert.ok(Math.abs(cents(pk, 440)) < 2, 'pitch unchanged: ' + pk);
  }
  assert.equal(b.R.o.active(), false, 'a played-out One-shot is inactive and returns its streams');
  assert.equal(b.R.o.nS, 0);
  // σ of §6.9.1 / §6.7.2: Key Track × 2^((K − 60)/12), Lock Scan Rate × bpm/120, Sample Length to BPM (the region lasts
  // lenLad[round(14·n)] beats: 1 bar at 120 BPM = 2 s for the 1 s sample), Scan Reverse plays from the region end backwards
  const sigma = (edit, p = {}, keyRef = 60, bpm = 120) => {
    const R = rig({ sig: 'short', p, edit: (s, O) => edit(O) });
    R.ctx.keyRef = keyRef; R.ctx.bpm = bpm;
    note(R); play(R, 64);
    return R.o.cSig;
  };
  assert.ok(Math.abs(sigma(O => { O.smpo.scanKey = 1; }, {}, 72) - 2) < 1e-12, 'key track: an octave up scans ×2');
  assert.ok(Math.abs(sigma(O => { O.smpo.scanLock = 1; }, {}, 60, 90) - 0.75) < 1e-12, 'lock scan rate: × bpm/120');
  assert.ok(Math.abs(sigma(O => { O.smpo.lenBpm = 1; }, { 'a.lenrate': 5 / 14 }) - 0.5) < 1e-12, 'length to BPM: 1 bar = 2 s');
  assert.ok(Math.abs(sigma(O => { O.smpo.scanRange = 2; }, { 'a.scan': 0.75 }) - 4) < 1e-12, 'range ±800 %: v·8');
  assert.ok(sigma(() => {}, { 'a.scanrev': 1 }) === -1, 'Scan Reverse');
  const bar = note(rig({ sig: 'short', p: { 'a.lenrate': 5 / 14 }, edit: (s, O) => { O.smpo.lenBpm = 1; } }));
  const yb = play(bar, 2.4 * SR);
  let last = 0;
  for (let s = 0; s < yb.length; s++) if (Math.abs(yb[s]) > 0.05) last = s;
  assert.ok(Math.abs(last / (2 * SR) - 2) < 512 / SR, '1 bar at 120 BPM: ' + last / (2 * SR) + ' s');
  // sNorm: × 1/peak of the analysed data (raw and output)
  const nrm = note(rig({ edit: (s, O) => { O.smpo.loop = 1; O.smpo.ops = { fade: 0, norm: 1, rev: 0, trim: null }; } }));
  play(nrm, 64);
  assert.ok(Math.abs(nrm.o.cNorm - 1 / nrm.e.peak) < 1e-12);
  // X|Y Y → Level, Warp, Warp 2 belong to the voice (as for Granular: Y on the eff level before the gain ramp, on the base
  // amounts before the unison spread, §3.9): SxSpec renders exactly as without X|Y (same X position)
  const yRef = play(note(rig({ p: { 'a.level': 0.8, 'a.gy': 0.4, 'a.pos': 0.4 }, edit: (s, O) => { O.smpo.loop = 1; O.xy = { on: 1, y: 0, yMode: 1 }; } })), 4000);
  for (const y of [1, 2, 3]) {
    const R = note(rig({ p: { 'a.level': 0.8, 'a.gy': 0.4, 'a.pos': 0.4 }, edit: (s, O) => { O.smpo.loop = 1; O.xy = { on: 1, y, yMode: 1 }; } }));
    R.ctx.mode1 = W2('s_comb'); R.ctx.w1.fill(0.5); R.ctx.mode2 = W2('s_comb'); R.ctx.w2.fill(0.5);
    const ref = note(rig({ p: { 'a.level': 0.8, 'a.gy': 0.4, 'a.pos': 0.4 }, edit: (s, O) => { O.smpo.loop = 1; O.xy = { on: 1, y: 0, yMode: 1 }; } }));
    ref.ctx.mode1 = W2('s_comb'); ref.ctx.w1.fill(0.5); ref.ctx.mode2 = W2('s_comb'); ref.ctx.w2.fill(0.5);
    assert.deepEqual(Array.from(play(R, 4000)), Array.from(play(ref, 4000)), 'X|Y Y ' + y + ' is not applied by SxSpec');
  }
  assert.ok(yRef.some(v => Math.abs(v) > 0.1));
});

test('staggered synthesis (§6.10.1, sign-off 15): 8 streams started in one quantum spread their frames over the hop; pre-roll ≤ 1 frame per chunk', () => {
  const T = scope(), first = rig({ t: T, edit: (s, O) => { O.smpo.loop = 1; } });
  const oscs = [first];
  for (let i = 1; i < 8; i++) oscs.push(rig({ t: T, edit: (s, O) => { O.smpo.loop = 1; }, seed: 77 + i }));
  // one processor: every oscillator shares the first rig's pool
  for (const r of oscs.slice(1)) { r.o.v.proc = first.proc; r.o.pool = null; r.o.apply(r.cp, 0, null); r.ctx.sx = first.proc.sx; }
  for (const r of oscs.slice(1)) assert.equal(r.o.pool, first.P());
  for (const r of oscs) r.o.noteOn(r.ctx, true, false);
  const P = first.P(), H = first.o.H, CHb = 4, perHop = H / CHb, L = new Float64Array(32), R = new Float64Array(32), log = [];
  assert.deepEqual(oscs.map(r => r.o.si[0]), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (let c = 0; c < 6 * perHop; c++) {
    oscs.forEach((r, i) => {
      const f0 = P.frames;
      r.o.render(r.ctx, L, R, null);
      const d = P.frames - f0;
      assert.ok(d <= 1, `stream ${i} synthesised ${d} frames in chunk ${c}`);
      if (d) log.push([c, i]);
    });
  }
  const steady = log.filter(([c]) => c >= 2 * perHop);
  const at = new Set(steady.map(([c]) => c % perHop));
  assert.ok(at.size >= 4, 'distinct chunks of the hop: ' + at.size);
  const perQ = new Map();
  for (const [c] of steady) perQ.set(c >> 5, (perQ.get(c >> 5) || 0) + 1);
  assert.ok(Math.max(...perQ.values()) <= 3, 'frames per render quantum (steady): ' + [...perQ.values()]);
  // frame k of a stream is ready before its first sample is read: no stream ever reads an unsynthesised frame
  for (const r of oscs) { const st = P.st[r.o.si[0]]; assert.ok(st.k * H >= st.t, 'frames ahead of the read position'); }
  // the frames of one stream: 3 in the first hop (the onset frame kp centred at the note-on, frames 0 and 1; sparse
  // pre-roll, IMPL), then one per hop
  const s0 = log.filter(([, i]) => i === 0).map(([c]) => c);
  assert.equal(s0.filter(c => c < perHop).length, 3);
  assert.equal(s0.filter(c => c >= perHop && c < 2 * perHop).length, 1);
});

test('Lo/Hi (§6.10.4): hard limits are −∞ outside [flo, fhi] (audio ≤ −60 dB), Smooth slopes 24 dB/oct, Post Warp limits after the warps', () => {
  const flo = 500, fhi = 4000, binHz = SR / 2048;
  const lim = (sm, post = 0, extra = {}) => {
    const R = note(rig({ sig: 'noise', p: { 'a.flo': nHz(flo), 'a.fhi': nHz(fhi), ...extra }, edit: (s, O) => { O.smpo.loop = 1; O.spec.smooth = sm; O.spec.postWarp = post; } }));
    return R;
  };
  const ref = note(rig({ sig: 'noise', edit: (s, O) => { O.smpo.loop = 1; } }));
  play(ref, 6000);
  const M0 = frameM(ref);
  for (const sm of [0, 1]) {
    const R = lim(sm);
    play(R, 6000);
    const M = frameM(R), y = play(R, 24000);
    for (let j = 1; j < 900; j++) {
      const f = j * binHz, a = Math.pow(flo / f, 8), b = Math.pow(f / fhi, 8);
      const g = sm ? 1 / Math.sqrt((1 + a) * (1 + b)) : f >= flo && f <= fhi ? 1 : 0;
      assert.ok(Math.abs(M[j] - g * M0[j]) <= 1e-9 * (1 + M0[j]), `smooth ${sm} bin ${j}: ${M[j]} vs ${g * M0[j]}`);
    }
    if (sm) {
      const r = j => M[j] / M0[j];
      assert.ok(Math.abs(dB(r(Math.round(2 * fhi / binHz)) / r(Math.round(4 * fhi / binHz))) - 24) < 1.5, 'Smooth: 24 dB/oct above fhi');
    } else {
      // audio: power outside the band ≤ −60 dB relative to the passband (bands away from the edges by the lobe width)
      const n = 32768, from = 8192, fft = new R.B.FFT(n), x = new Float64Array(n), re = new Float64Array(n / 2 + 1), im = new Float64Array(n / 2 + 1);
      for (let k = 0; k < n; k++) x[k] = y[from + k] * (0.5 - 0.5 * Math.cos(TAU * k / n));
      fft.rfwd(x, re, im);
      const band = (a, b) => { let p = 0, c = 0; for (let k = Math.ceil(a / (2 * SR) * n); k <= b / (2 * SR) * n; k++) { p += re[k] * re[k] + im[k] * im[k]; c++; } return p / c; };
      const pass = band(1000, 3000);
      assert.ok(10 * Math.log10(band(50, flo - 150) / pass) <= -60, 'below flo: ' + 10 * Math.log10(band(50, flo - 150) / pass));
      assert.ok(10 * Math.log10(band(fhi + 150, 20000) / pass) <= -60, 'above fhi: ' + 10 * Math.log10(band(fhi + 150, 20000) / pass));
    }
  }
  // Post Warp: a Shift warp moves content above fhi — limited after the warp only with Post Warp
  const sh = W2('s_shift');
  const pre = lim(0, 0), post = lim(0, 1);
  for (const R of [pre, post]) { R.ctx.mode1 = sh; R.ctx.w1.fill(0.75); play(R, 6000); }
  const above = M => { let m = 0; for (let j = Math.ceil(fhi / binHz) + 1; j < 1024; j++) m = Math.max(m, M[j]); return m; };
  assert.ok(above(frameM(pre)) > 1e-3, 'without Post Warp the shifted band reaches above fhi');
  assert.equal(above(frameM(post)), 0, 'with Post Warp nothing is left above fhi');
});

test('spectral filter (§6.10.4 step 2, §6.10.6): M ×= 1 − mix + mix·curve(x − 0.5·cutV); CUT shifts the curve; X|Y Y can drive CUT', () => {
  const curve = new Float32Array(3 * 513).fill(1);
  for (let j = 0; j <= 512; j++) curve[j] = j / 512 <= 0.5 ? 1 : j / 512 >= 0.6 ? 0 : 1 - (j / 512 - 0.5) / 0.1;   // osc A: a low-pass
  const xOf = f => Math.log(f / 20) / Math.log(1000), binHz = SR / 2048;
  const at = (x) => { x = Math.min(1, Math.max(0, x)) * 512; const i = Math.min(511, Math.floor(x)), f = x - i; return curve[i] + (curve[i + 1] - curve[i]) * f; };
  const refOf = xy => {
    const r = note(rig({ sig: 'noise', p: { 'a.pos': 0.3 }, edit: (s, O) => { O.smpo.loop = 1; if (xy) O.xy = { on: 1, y: 0, yMode: 1 }; } }));
    play(r, 6000);
    return frameM(r);
  };
  const M0 = refOf(false), M0xy = refOf(true);
  for (const [cutN, mix, xy] of [[0.5, 1, null], [0.7, 1, null], [0.3, 0.5, null], [0.5, 1, 0.8]]) {
    const R = rig({ sig: 'noise', p: { 'a.cut': cutN, 'a.smix': mix, 'a.gy': xy === null ? 0.5 : xy, 'a.pos': 0.3 },
      edit: (s, O) => { O.smpo.loop = 1; if (xy !== null) O.xy = { on: 1, y: 4, yMode: 1 }; } });
    R.proc.sx.CT = { specFilt: curve };
    note(R); play(R, 6000);
    const M = frameM(R), cutV = 2 * (xy === null ? cutN : xy) - 1, ref = xy === null ? M0 : M0xy;
    for (let j = 1; j < 900; j++) {
      const g = 1 - mix + mix * at(xOf(j * binHz) - 0.5 * cutV);
      assert.ok(Math.abs(M[j] - g * ref[j]) <= 1e-6 * (1 + ref[j]), `cut ${cutN} mix ${mix} xy ${xy} bin ${j}`);
    }
  }
  // without a CT curve (flat) the filter is identity; MIX 0 skips it
  const flat = note(rig({ sig: 'noise', p: { 'a.cut': 0.9, 'a.pos': 0.3 }, edit: (s, O) => { O.smpo.loop = 1; } }));
  play(flat, 6000);
  assert.deepEqual(Array.from(frameM(flat)), Array.from(M0));
});

// the frame of a rig after n base samples with spectral warp slot 1 = mode at amount w (and slot 2 when given)
function warped(sig, mode, w, { root = 69, f = 440, n = 6000, mode2 = 0, w2 = 0, extra = {}, edit = null, t = null, each = null } = {}) {
  const R = rig({ sig, root, f, p: extra, t, edit: (s, O) => { O.smpo.loop = 1; if (edit) edit(s, O); } });
  R.ctx.mode1 = mode; R.ctx.w1.fill(w); R.ctx.mode2 = mode2; R.ctx.w2.fill(w2);
  note(R);
  const y = play(R, n, { each });
  return { R, y, M: frameM(R), F: frameF(R) };
}

test('spectral warps 58–81 (§6.10.5): at the neutral amount bit-identical to Off; Shepard always acts', () => {
  const base = warped('harm', 0, 0, { root: 57, f: 220, n: 4000 }).y;
  for (let m = 58; m <= 81; m++) {
    const neutral = m === 78 || m === 80 ? 0.5 : 0;
    const r = warped('harm', m, neutral, { root: 57, f: 220, n: 4000 });
    if (m === 69 || m === 70) { assert.notDeepEqual(Array.from(r.y), Array.from(base), core.WARPS2[m].id + ' (never neutral)'); continue; }
    assert.deepEqual(Array.from(r.y), Array.from(base), core.WARPS2[m].id + ' at its neutral amount ≡ Off');
    const r2 = warped('harm', 0, 0, { root: 57, f: 220, n: 4000, mode2: m, w2: neutral });
    assert.deepEqual(Array.from(r2.y), Array.from(base), core.WARPS2[m].id + ' in slot 2');
  }
});

test('spectral warps: each mode\'s defining property on the synthesis frame (§6.10.5)', () => {
  const binHz = SR / 2048, b440 = 440 / binHz, nb = 1025;
  const off = warped('sine', 0, 0), noise = warped('noise', 0, 0), harm = warped('harm', 0, 0, { root: 57, f: 220 });
  const pk = M => argmax(M);
  // the level of the lobe at f: √Σ M² over ±3 bins (independent of where the lobe sits between bins)
  const near = (M, f) => { const c = f / binHz; let e = 0; for (let j = Math.ceil(c - 3); j <= c + 3; j++) e += M[j] * M[j]; return Math.sqrt(e); };
  // Comb: M_j × (1 − d·(0.5 − 0.5·cos(2πj/P))), P = 2 + 62(1 − w), d = min(1, 2w)
  for (const w of [0.3, 0.8]) {
    const { M } = warped('noise', W2('s_comb'), w), P = 2 + 62 * (1 - w), d = Math.min(1, 2 * w);
    for (let j = 1; j < 1000; j++) assert.ok(Math.abs(M[j] - noise.M[j] * (1 - d * (0.5 - 0.5 * Math.cos(TAU * j / P)))) < 1e-9, 'comb ' + j);
  }
  // Gate: bins below w²·max are silenced, the rest kept
  {
    const w = 0.4, { M } = warped('harm', W2('s_gate'), w, { root: 57, f: 220 }), thr = w * w * Math.max(...harm.M);
    for (let j = 0; j < nb; j++) assert.equal(M[j], harm.M[j] < thr ? 0 : harm.M[j], 'gate ' + j);
  }
  // Add Harmonics / Subharmonics: copies at ×2 (0.5w), ×3 (0.33w) / ×½, ×⅓; the original stays
  {
    const w = 0.8, top = near(off.M, 440);
    const h = warped('sine', W2('s_harm'), w).M;
    assert.ok(Math.abs(near(h, 440) / top - 1) < 0.02 && Math.abs(near(h, 880) / top - 0.5 * w) < 0.03 && Math.abs(near(h, 1320) / top - 0.33 * w) < 0.03,
      `harmonics: ${near(h, 440) / top} ${near(h, 880) / top} ${near(h, 1320) / top}`);
    const s1 = warped('sine', 0, 0, { f: 1760 }).M, s = warped('sine', W2('s_subh'), w, { f: 1760 }).M, t1 = near(s1, 1760);  // copies ≥ 12 bins apart
    assert.ok(Math.abs(near(s, 1760) / t1 - 1) < 0.02 && Math.abs(near(s, 880) / t1 - 0.5 * w) < 0.03 && Math.abs(near(s, 1760 / 3) / t1 - 0.33 * w) < 0.03,
      `subharmonics: ${near(s, 1760) / t1} ${near(s, 880) / t1} ${near(s, 1760 / 3) / t1}`);
  }
  // Spread: partials move to f·(1 + 2w) (an inharmonic stretch), the frequencies with them
  {
    const w = 0.25, r = warped('harm', W2('s_spread'), w, { root: 57, f: 220 });
    for (const hz of [220, 440, 660]) {
      const j = Math.round(hz * (1 + 2 * w) / binHz), q = argmax(r.M, j - 3, j + 4);
      assert.ok(Math.abs(r.F[q] - hz * (1 + 2 * w) / binHz) < 0.05, `spread ${hz}: F ${r.F[q]}`);
      assert.ok(r.M[q] > 0.5 * near(harm.M, hz), 'spread keeps the level');
    }
  }
  // Smear: Z ← Z + (M − Z)·(1 − 0.97w) — after the source stops the peak decays by 0.97w per frame
  {
    const w = 0.9, R = rig({ sig: 'half' });
    R.ctx.mode1 = W2('s_smear'); R.ctx.w1.fill(w); note(R);
    const st = R.P().st[R.o.si[0]], pkAt = [];
    play(R, SR / 2 + 12 * 512, { each: (k) => { if (k % 128 === 127) pkAt.push(st.u0[Math.round(b440)]); } });
    const tail = pkAt.slice(-5);
    assert.ok(tail[0] > 1e-4, 'still decaying');
    for (let i = 1; i < tail.length; i++) assert.ok(Math.abs(tail[i] / tail[i - 1] - 0.97 * w) < 1e-6, 'smear decay ' + tail[i] / tail[i - 1]);
  }
  // Detune: each partial's frequency × 2^(w·r·50/1200) with r ∈ [−1, 1) per stream seed (r2), deterministic per seed
  {
    const w = 1, a = warped('harm', W2('s_detune'), w, { root: 57, f: 220 }), b = warped('harm', W2('s_detune'), w, { root: 57, f: 220 });
    assert.deepEqual(Array.from(a.F), Array.from(b.F), 'deterministic');
    let moved = 0;
    for (const hz of [220, 440, 660, 880]) {
      const q = argmax(a.M, Math.round(hz / binHz) - 3, Math.round(hz / binHz) + 4), c = cents(a.F[q] * binHz, hz);
      assert.ok(Math.abs(c) <= 50 * w + 0.5, `detune ${hz}: ${c} cents`);
      if (Math.abs(c) > 1) moved++;
    }
    assert.ok(moved >= 3, 'partials detuned');
  }
  // Peak Octave / Harm Up / Down: peaks above max·10^−2 get a copy at ×2, ×½, ×3, ×⅓ of level w·M_p
  {
    const w = 0.6, top = near(off.M, 440);
    for (const [id, k] of [['s_pkoctu', 2], ['s_pkoctd', 0.5], ['s_pkharmu', 3], ['s_pkharmd', 1 / 3]]) {
      const r = warped('sine', W2(id), w);
      assert.ok(Math.abs(near(r.M, 440 * k) / top - w) < 0.06, `${id}: ${near(r.M, 440 * k) / top}`);
      const q = argmax(r.M, Math.round(440 * k / binHz) - 2, Math.round(440 * k / binHz) + 3);
      assert.ok(Math.abs(r.F[q] - b440 * k) < 0.02, `${id} frequency`);
    }
  }
  // Shepard filter / narrow: M × g, g = 0.5 + 0.5·cos(2π(log2(f/20) − w)), narrow g⁶
  for (const [id, pw] of [['s_shep', 1], ['s_shepn', 6]]) {
    const w = 0.3, { M } = warped('noise', W2(id), w);
    for (let j = 1; j < 1000; j++) {
      const g = Math.pow(0.5 + 0.5 * Math.cos(TAU * (Math.log2(j * binHz / 20) - w)), pw);
      assert.ok(Math.abs(M[j] - g * noise.M[j]) < 1e-9, `${id} ${j}`);
    }
  }
  // Mirror: pivot q = round(N_b·(0.02 + 0.48w)); the peak p moves to 2q − p
  for (const w of [0.05, 0.1]) {
    const r = warped('sine', W2('s_mirror'), w), q = Math.round(nb * (0.02 + 0.48 * w));
    assert.equal(pk(r.M), 2 * q - pk(off.M), 'mirror ' + w);
  }
  // Pitch Shift: r = 2^((w − 0.5)·4) — peak and frequency × r
  for (const w of [0.75, 0.25, 0.6]) {
    const r = warped('sine', W2('s_pshift'), w), k = Math.pow(2, (w - 0.5) * 4), q = pk(r.M);
    assert.ok(Math.abs(q - b440 * k) <= 1 && Math.abs(r.F[q] - b440 * k) < 0.02, `pitch shift ×${k}: bin ${q}, F ${r.F[q]}`);
  }
  // Pitch Blend: (1 − w)·M + w·shift₊₁₂(M)
  {
    const w = 0.3, r = warped('sine', W2('s_pblend'), w), top = near(off.M, 440);
    assert.ok(Math.abs(near(r.M, 440) / top - (1 - w)) < 0.02 && Math.abs(near(r.M, 880) / top - w) < 0.03, 'pitch blend');
  }
  // Shift: Δ = (2w − 1)·N_b/4 bins; the peak moves by Δ (±1 bin), its frequency by Δ·base/N Hz
  for (const [w, f] of [[0.6, 440], [0.75, 440], [0.9, 440], [0.4, 3520]]) {
    const r = warped('sine', W2('s_shift'), w, { f }), d = (2 * w - 1) * nb / 4, q = pk(r.M), p0 = f / binHz;
    assert.ok(Math.abs(q - (p0 + d)) <= 1 && Math.abs(r.F[q] - (p0 + d)) < 0.02, `shift ${w}: bin ${q}, F ${r.F[q]} (expected ${p0 + d})`);
  }
  // Phase Twist: magnitudes untouched, the waveform changes (a per-frame phase offset w·32π·(j/N_b)²)
  {
    const r = warped('harm', W2('s_twist'), 0.7, { root: 57, f: 220 });
    assert.deepEqual(Array.from(r.M), Array.from(harm.M));
    let d = 0;
    for (let s = 4000; s < 8000; s++) d = Math.max(d, Math.abs(r.y[s] - harm.y[s]));
    assert.ok(d > 0.05, 'phase twist changes the waveform');
  }
});

test('Vocode / Mask (§6.10.5): the OS-rate modulator is decimated into a base-rate ring (images ≤ −90 dB); its band envelopes shape the spectrum', () => {
  const os = 2, fm = 2000;
  const feed = (R, w, mode) => {
    const mod = new Float64Array(32);
    let t = 0;
    R.ctx.mode1 = mode; R.ctx.w1.fill(w); R.ctx.mod1 = mod; R.ctx.modStride1 = 1;
    note(R);
    play(R, 8000, { each: (k, ctx) => { for (let s = 0; s < ctx.CH; s++, t++) mod[s] = 0.5 * Math.sin(TAU * fm * t / (SR * os)) + 0.5 * Math.sin(TAU * 30000 * t / (SR * os)); } });
    return R;
  };
  const voc = feed(rig({ sig: 'noise', edit: (s, O) => { O.smpo.loop = 1; } }), 1, W2('s_voc_o1'));
  // the ring: N base-rate samples (oldest at rw) — the 2 kHz component at full level, the 30 kHz one rejected (no 18 kHz alias)
  const st = voc.P().st[voc.o.si[0]], ring = new Float64Array(2048);
  for (let n = 0; n < 2048; n++) ring[n] = st.u0[(st.rw0 + n) % 2048];
  const a2k = lineAmp(ring, fm, 0, 2048, SR), a18k = lineAmp(ring, 48000 - 30000, 0, 2048, SR);
  assert.ok(Math.abs(dB(a2k / 0.5)) < 0.1, '2 kHz at base rate: ' + a2k);
  assert.ok(dB(a18k / 0.5) < -90, '30 kHz image: ' + dB(a18k / 0.5).toFixed(1) + ' dB');
  // Vocode: the band around the modulator's 2 kHz stands out of the flat carrier; Mask keeps only the modulator's bins
  const ref = note(rig({ sig: 'noise', edit: (s, O) => { O.smpo.loop = 1; } }));
  play(ref, 8000);
  const band = (M, f0, f1) => { let e = 0; for (let j = Math.round(f0 / (SR / 2048)); j <= Math.round(f1 / (SR / 2048)); j++) e += M[j] * M[j]; return e; };
  const contrast = M => 10 * Math.log10(band(M, 1900, 2100) / band(M, 400, 600));
  const c0 = contrast(frameM(ref)), cv = contrast(frameM(voc));
  assert.ok(cv - c0 > 20, `vocode contrast ${c0.toFixed(1)} → ${cv.toFixed(1)} dB`);
  const msk = feed(rig({ sig: 'noise', edit: (s, O) => { O.smpo.loop = 1; } }), 1, W2('s_mask_o1'));
  const cm = contrast(frameM(msk));
  assert.ok(cm - c0 > 40, `mask contrast ${c0.toFixed(1)} → ${cm.toFixed(1)} dB`);
  // without a Vocode/Mask slot no ring is fed (no modulator decimation cost)
  const plain = note(rig({ sig: 'noise' }));
  plain.ctx.mod1 = new Float64Array(32).fill(0.5); plain.ctx.modStride1 = 1;
  play(plain, 4000);
  assert.ok(plain.P().st[plain.o.si[0]].u0.every(v => v === 0));
});

test('F/P-domain warps through the warp delay line (§6.10.7): PD sidebands = the wavetable PD (Bessel) within 1 dB; D₀ = min(25 ms, 2·T₀); mode changes crossfade', () => {
  const FS = 2 * SR;
  // PD (B) on a 440 Hz stream with a 110 Hz modulator: y = sin(2π(f(t − D₀) + I·m)), I = 3·w^1.5 — sidebands J_n(2π·I·A)
  const J = (n, x) => { let s = 0, f = 1; for (let k = 0; k < 30; k++) { if (k > 0) f *= k; let g = 1; for (let i = 1; i <= k + n; i++) g *= i; s += (k % 2 ? -1 : 1) * Math.pow(x / 2, 2 * k + n) / (f * g); } return s; };
  for (const [w, A] of [[0.5, 0.1], [0.3, 0.25]]) {
    const R = rig({ edit: (s, O) => { O.smpo.loop = 1; } }), mod = new Float64Array(32);
    let t = 0;
    R.ctx.mode1 = W2('pd_o1'); R.ctx.w1.fill(w); R.ctx.mod1 = mod; R.ctx.modStride1 = 1;
    note(R);
    const y = play(R, 40000, { each: (k, ctx) => { for (let s = 0; s < ctx.CH; s++, t++) mod[s] = A * Math.sin(TAU * 110 * t / FS); } });
    const beta = TAU * 3 * Math.pow(w, 1.5) * A;
    for (let n = -3; n <= 3; n++) {
      const a = lineAmp(y, 440 + 110 * n, 8192, 65536, FS), b = Math.abs(J(Math.abs(n), beta));
      if (b > 1e-3) assert.ok(Math.abs(dB(a / b)) < 1, `w ${w}: sideband ${n}: ${a} vs ${b}`);
    }
  }
  // D₀: a selected P-domain slot at amount 0 delays the stream by D₀ (after the 10 ms crossfade), nothing else
  for (const f of [440, 100, 30]) {
    const root = 69 + 12 * Math.log2(f / 440);
    const a = note(rig({ root, f, edit: (s, O) => { O.smpo.loop = 1; } })), b = rig({ root, f, edit: (s, O) => { O.smpo.loop = 1; } });
    b.ctx.mode1 = W2('bend_p'); b.ctx.w1.fill(0); note(b);
    const ya = play(a, 20000), yb = play(b, 20000), D0 = Math.min(0.025, 2 / f) * FS;
    assert.ok(Math.abs(b.P().st[b.o.si[0]].d0 - D0) < 1e-9, `f ${f}: D₀ ${b.P().st[b.o.si[0]].d0} samples`);
    let e = 0, p = 0;
    for (let s = 20000; s < 38000; s++) { const i = s - D0, i0 = Math.floor(i), fr = i - i0, r = ya[i0] + (ya[i0 + 1] - ya[i0]) * fr; e += (yb[s] - r) ** 2; p += r * r; }
    assert.ok(10 * Math.log10(e / p) < -60, `f ${f}: delayed copy ${(10 * Math.log10(e / p)).toFixed(1)} dB`);
  }
  // selecting / clearing an F/P mode mid-note: a 10 ms crossfade, no step larger than twice the steady slope
  {
    const R = note(rig({ edit: (s, O) => { O.smpo.loop = 1; } }));
    const y = play(R, 30000, { each: (k, ctx) => { if (k === 2000) { ctx.mode1 = W2('bend_p'); ctx.w1.fill(0.3); } if (k === 5000) ctx.mode1 = 0; } });
    let steady = 0, worst = 0;
    for (let s = 8000; s < 15000; s++) steady = Math.max(steady, Math.abs(y[s] - y[s - 1]));
    for (let s = 15500; s < 18000; s++) worst = Math.max(worst, Math.abs(y[s] - y[s - 1]));
    for (let s = 39500; s < 42000; s++) worst = Math.max(worst, Math.abs(y[s] - y[s - 1]));
    assert.ok(worst <= 2 * steady, `crossfade: max step ${worst} vs steady ${steady}`);
    assert.equal(R.P().st[R.o.si[0]].dmix, 0, 'the line is faded out after the mode is cleared');
  }
  // FM (B), thru-zero: sidebands at f ± k·fm appear, the output stays bounded
  {
    const R = rig({ edit: (s, O) => { O.smpo.loop = 1; } }), mod = new Float64Array(32);
    let t = 0;
    R.ctx.mode1 = W2('fm_o1'); R.ctx.w1.fill(0.3); R.ctx.mod1 = mod; R.ctx.modStride1 = 1;
    note(R);
    const y = play(R, 30000, { each: (k, ctx) => { for (let s = 0; s < ctx.CH; s++, t++) mod[s] = Math.sin(TAU * 220 * t / FS); } });
    assert.ok(lineAmp(y, 660, 8192, 32768, FS) > 0.05 && lineAmp(y, 220, 8192, 32768, FS) > 0.05, 'FM sidebands');
    assert.ok(y.every(v => Math.abs(v) < 2), 'bounded');
  }
});

test('O-domain warps act per stream after resynthesis: distortion = the FX shaper (§3.4.1); AM reads each stream\'s own modulator column', () => {
  // Hard Clip at w = 1: raw = D(x) with D = SxBase.shape(2, x, 1) of the undistorted stream (the distortion warps' 5 Hz
  // DC blocker, RULINGS2 D3, switched off here: sx-warp.test.mjs covers it)
  const a = note(rig({ edit: (s, O) => { O.smpo.loop = 1; } })), b = rig({ edit: (s, O) => { O.smpo.loop = 1; } });
  b.ctx.mode1 = W2('d_hard'); b.ctx.w1.fill(1); note(b);
  const RA = new Float64Array(16 * 32), RB = new Float64Array(16 * 32);
  for (let k = 0; k < 600; k++) {
    for (const st of b.P().st) if (st && st.sl) st.sl.dcOn = 0;
    play(a, 4, { RAW: RA }); play(b, 4, { RAW: RB });
    if (k > 400) for (let s = 0; s < 8; s++) assert.ok(Math.abs(RB[s] - a.B.shape(2, RA[s], 1)) < 1e-12, 'hard clip');
  }
  // AM (B) with two unison streams and a two-column modulator: stream 0 × 1 (m = +1), stream 1 × 0 (m = −1)
  const R = rig({ N: 2, edit: (s, O) => { O.smpo.loop = 1; } }), mod = new Float64Array(64);
  for (let s = 0; s < 32; s++) { mod[2 * s] = 1; mod[2 * s + 1] = -1; }
  R.ctx.mode1 = W2('am_o1'); R.ctx.w1.fill(1); R.ctx.mod1 = mod; R.ctx.modStride1 = 2;
  note(R);
  const RAW = new Float64Array(16 * 32);
  let e0 = 0, e1 = 0;
  for (let k = 0; k < 600; k++) {
    play(R, 4, { RAW });
    if (k > 300) for (let s = 0; s < 8; s++) { e0 += RAW[s] ** 2; e1 += RAW[32 + s] ** 2; }
  }
  assert.ok(e0 > 100 && e1 === 0, `stream 0 energy ${e0}, stream 1 ${e1}`);
});

test('Phase Lock (§6.10.3) reduces the magnitude modulation of a sustained harmonic tone (vibrato, stretched ×4); Transients reset the phases on flagged frames', () => {
  const ripple = lock => {
    const R = note(rig({ sig: 'vib', root: 57, f: 220, p: { 'a.scan': nScan(0.25) }, edit: (s, O) => { O.smpo.loop = 1; O.smpo.phaseLock = lock; } }));
    const y = play(R, 40000), [mn, mx] = envMinMax(y, 8192, 80000, Math.round(2 * SR / 220));
    return dB(mx / mn);
  };
  const r0 = ripple(0), r1 = ripple(1);
  assert.ok(r1 < r0, `envelope ripple ${r0.toFixed(2)} dB → ${r1.toFixed(2)} dB with Phase Lock`);
  // transients: a click every 0.25 s over a quiet tone is flagged by the analysis (§9.4.6); with Transients the stream
  // resets its phases on those frames (once per flagged frame), without it never
  const run = tr => {
    const R = note(rig({ sig: 'clicks', edit: (s, O) => { O.smpo.loop = 1; O.smpo.transients = tr; } }));
    const st = R.P().st[R.o.si[0]], seen = new Set();
    play(R, SR, { each: () => { if (st.lastTr >= 0) seen.add(st.lastTr); } });
    return { seen, trans: R.e.trans };
  };
  const on = run(1), off = run(0);
  assert.ok(on.trans.some(v => v === 1), 'the analysis flags transients');
  assert.ok(on.seen.size >= 3 && [...on.seen].every(t => on.trans[t] === 1), 'resets on flagged frames: ' + [...on.seen]);
  assert.equal(off.seen.size, 0);
});

test('playheads per stream (§6.10.1, §6.7): loop modes, START/SPAN offsets, Manual X|Y, slices, Exit on Release, One-shot end', () => {
  const L = SR;                                                     // 'short': 1 s
  // the playhead q (region samples) of stream 0 after every frame
  const trace = (loop, p = {}, nBase = 4 * SR, edit = null) => {
    const R = note(rig({ sig: 'short', p: { 'a.lstart': 0.25, 'a.lend': 0.75, ...p }, edit: (s, O) => { O.smpo.loop = loop; if (edit) edit(O); } }));
    const st = R.P().st[R.o.si[0]], q = [];
    let fr = R.P().frames;
    play(R, nBase, { each: () => { if (R.P().frames !== fr) { fr = R.P().frames; q.push(st.q); } } });
    return { q, R };
  };
  const tail = (q, n = 120) => q.slice(-n);
  {
    const { q } = trace(1);                                         // Fwd: S → LE, then LS → LE
    assert.ok(tail(q).every(v => v >= 0.25 * L - 1e-6 && v <= 0.75 * L + 1e-6), 'Fwd stays in the loop');
    const d = tail(q).slice(1).map((v, i) => v - tail(q)[i]);
    assert.ok(d.every(x => Math.abs(x - 512) < 1e-6 || x < -0.4 * L), 'Fwd: forward steps and wraps');
  }
  {
    const { q } = trace(2), t = tail(q), d = t.slice(1).map((v, i) => v - t[i]);   // Rev: backwards in the loop
    assert.ok(t.every(v => v >= 0.25 * L - 1e-6 && v <= 0.75 * L + 1e-6) && d.every(x => Math.abs(x + 512) < 1e-6 || x > 0.4 * L), 'Rev');
  }
  {
    const { q } = trace(3), t = tail(q), d = t.slice(1).map((v, i) => v - t[i]);   // Fwd/Rwd: ping-pong
    assert.ok(t.every(v => v >= 0.25 * L - 1e-6 && v <= 0.75 * L + 1e-6), 'Fwd/Rwd in the loop');
    assert.ok(d.some(x => x > 0) && d.some(x => x < 0) && d.every(x => Math.abs(x) <= 512 + 1e-6), 'Fwd/Rwd turns');
  }
  {
    const { q } = trace(4);                                         // Tailed: S → E, then the tail [Lr/2, Lr]
    assert.ok(tail(q).every(v => v >= 0.5 * L - 1e-6 && v <= L + 1e-6), 'Tailed loops the tail');
  }
  {
    const { R } = trace(0, {}, 1.2 * SR);                           // One-shot: ends, inactive, streams returned
    assert.deepEqual([R.o.active(), R.o.nS, R.P().nFree], [false, 0, R.P().n]);
  }
  // a negative scan at note-on starts at the region end (as SxSample): One-shot plays E → S and ends; Rev turns at LS
  {
    const { q, R } = trace(0, { 'a.scanrev': 1 }, 1.3 * SR);
    assert.ok(q[0] > 0.97 * L && q.slice(1).every((v, i) => v <= q[i]), 'backwards from the end');   // (after the onset frame)
    assert.equal(R.o.active(), false, 'ends at S');
    const r = trace(2, { 'a.scanrev': 1 }).q, t = tail(r), d = t.slice(1).map((v, i) => v - t[i]);
    assert.ok(t.every(v => v >= 0.25 * L - 1e-6 && v <= 0.75 * L + 1e-6) && d.every(x => Math.abs(x - 512) < 1e-6 || x < -0.4 * L),
      'Rev started backwards loops forwards (the mirror)');
  }
  // loop crossfade (§6.7.4) on magnitudes, equal power: a steady tone keeps its level through the wraps
  {
    const R = note(rig({ sig: 'short', p: { 'a.lstart': 0.25, 'a.lend': 0.75, 'a.xfade': 1 }, edit: (s, O) => { O.smpo.loop = 1; } }));
    const y = play(R, 3 * SR), [mn, mx] = envMinMax(y, SR, 6 * SR, 2 * 218);
    assert.ok(dB(mx) < 0.5 && dB(mn) > -0.5, `level through the wraps ${dB(mn).toFixed(2)} … ${dB(mx).toFixed(2)} dB`);
  }
  // Exit on Release: after the gate closes the loop is left — the stream plays to the region end and stops
  {
    const R = note(rig({ sig: 'short', edit: (s, O) => { O.smpo.loop = 1; O.smpo.exitRel = 1; } }));
    play(R, 2 * SR);
    assert.equal(R.o.active(), true, 'loops while held');
    R.o.noteOff();
    play(R, 1.3 * SR);
    assert.equal(R.o.active(), false, 'exits after release');
  }
  // START/SPAN (§6.7.6): stream i starts at S + (ustart·u_i + uspan·i/N)·(E − S); u_i are the first N r2 draws
  {
    const R = rig({ sig: 'short', N: 4, p: { 'a.ustart': 0.5, 'a.uspan': 1, 'a.scan': nScan(0) }, seed: 99 });   // σ 0: q stays
    const u = [];
    let r = 99;
    for (let i = 0; i < 8; i++) { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; u.push(r / 4294967296); }
    note(R);
    assert.equal(R.v.draws, 8, '2·N r2 draws per note: START randoms, then the Detune seeds');
    play(R, 4);
    for (let i = 0; i < 4; i++) {
      const q = R.P().st[R.o.si[i]].q, want = ((0.5 * u[i] + i / 4) * L) % L;
      assert.ok(Math.abs(q - want) < 1e-6, `stream ${i}: ${q} vs ${want}`);
    }
  }
  // Manual X|Y: the streams read pos·L + Δ_i, no scanning (stream 0 stays at pos); slicing is ignored
  {
    const R = note(rig({ sig: 'short', p: { 'a.pos': 0.4 }, edit: (s, O) => { O.smpo.loop = 1; O.xy = { on: 1, y: 0, yMode: 0 };
      O.smpo.slice = { mode: 2, thr: 0.5, marks: [0.5], toEnd: 0, single: 0, root: 36, sync: 0 }; } }));
    for (let k = 0; k < 4; k++) { play(R, 2000); assert.ok(Math.abs(R.o.mPos - 0.4) < 1e-9, 'mPos ' + R.o.mPos); }
    assert.equal(R.cp.sSlMode[0], 0, 'slicing compiled off while X|Y is on');
  }
  // slices (§6.7.5): the played key − root picks the slice (also with pitch tracking off: keyRef 60); outside ⇒ silent;
  // Play Single Slice uses k.slice
  {
    const mk = (key, single = 0, slice = 0, keyRef = key) => {
      const R = rig({ sig: 'short', p: { 'a.slice': slice / 255 }, edit: (s, O) => {
        O.smpo.slice = { mode: 2, thr: 0.5, marks: [0.25, 0.5], toEnd: 0, single, root: 36, sync: 0 }; } });
      R.ctx.key = key; R.ctx.keyRef = keyRef; note(R); play(R, 64);
      return R.o;
    };
    assert.deepEqual([mk(36).slS, mk(36).slE], [0, 0.25]);
    assert.deepEqual([mk(38).slS, mk(38).slE], [0.5, 1]);
    assert.deepEqual([mk(37, 0, 0, 60).slS, mk(37, 0, 0, 60).slE], [0.25, 0.5], 'tracking off');
    assert.equal(mk(39).silentSl, 1);
    assert.deepEqual([mk(60, 1, 1).slS, mk(60, 1, 1).slE], [0.25, 0.5]);
  }
});

test('failure isolation: SxWarp missing ⇒ one warning, spectral warps still act, F/P/O-domain slots act as Off (§0.3, as on every type); analysis N above 2048 ⇒ silent', () => {
  const t = scope({ overrides: { 'sx-warp.js': null } });
  const ref = note(rig({ edit: (s, O) => { O.smpo.loop = 1; } }));
  const base = play(ref, 4000);
  const r = rig({ t, edit: (s, O) => { O.smpo.loop = 1; } });
  r.ctx.mode1 = W2('bend_p'); r.ctx.w1.fill(0.7); r.ctx.mode2 = W2('d_tube'); r.ctx.w2.fill(1);
  note(r);
  assert.deepEqual(Array.from(play(r, 4000)), Array.from(base), 'P and O slots act as Off');
  const rf = rig({ t, edit: (s, O) => { O.smpo.loop = 1; } }), mod = new Float64Array(32).fill(0.7);
  rf.ctx.mode1 = W2('fm_o1'); rf.ctx.w1.fill(0.6); rf.ctx.mode2 = W2('pd_o1'); rf.ctx.w2.fill(0.6);
  rf.ctx.mod1 = mod; rf.ctx.mod2 = mod; rf.ctx.modStride1 = 1; rf.ctx.modStride2 = 1;
  note(rf);
  assert.deepEqual(Array.from(play(rf, 4000)), Array.from(base), 'FM and PD act as Off too (their laws are SxWarp\'s)');
  assert.equal(rf.P().st[rf.o.si[0]].line, null, 'no warp line without SxWarp');
  const warns = t.S.logs.filter(m => m.level === 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0].text, /SxWarp is missing/);
  const r2 = rig({ t, edit: (s, O) => { O.smpo.loop = 1; } });
  r2.ctx.mode1 = W2('s_pshift'); r2.ctx.w1.fill(0.75); note(r2);
  const y = play(r2, 20000);
  assert.ok(Math.abs(cents(peakHz(y, 8192, 16384, 2 * SR, 700, 1100), 880)) < 1, 'spectral warps need no SxWarp');
  assert.equal(t.S.logs.filter(m => m.level === 'warn').length, 1, 'still one warning per scope');
  // an analysis larger than the pool's frame scratch (N_a > 2048, §9.4.6): silent, one warning
  const big = { id: 'spec:smp:big', v: 1, kind: 'spec', bytes: 0, rate: SR, ch: 1, len: 32768, N: 16384, hop: 4096, frames: 2,
    mag: new Float32Array(2 * 8193).fill(0.5), ph: new Float32Array(2 * 8193), trans: new Uint8Array(2), peak: 1 };
  const T2 = scope(), rb = rig({ t: T2 });
  assert.equal(T2.B.storeAsset(big.id, big), true);
  const s2 = core.defaultSerum();
  s2.osc[0].type = 'spec'; s2.osc[0].smp = 'smp:big';
  const cpb = core.compileSerum(core.normalizeSerum(s2), {}).serum, ob = new T2.X.SpecOsc(rb.v, 0), cb = octx(cpb, rb.proc.sx);
  ob.apply(cpb, 0, null); ob.noteOn(cb, true, false);
  const OL = new Float64Array(32), OR = new Float64Array(32);
  for (let k = 0; k < 300; k++) { ob.render(cb, OL, OR, null); assert.ok(OL.every(v => v === 0)); }
  assert.equal(T2.S.logs.filter(m => /analysis N above/.test(m.text)).length, 1);
});

test('allocation-free rendering with every feature: S/F/P/O warps (incl. line fades), Vocode, Phase Lock, Transients, X|Y, loops, retriggers', () => {
  const t = scope();
  const mods = [0, W2('s_comb'), W2('s_harm'), W2('s_spread'), W2('s_smear'), W2('s_detune'), W2('s_pkoctu'), W2('s_shep'), W2('s_voc_o1'),
    W2('s_mask_noise'), W2('s_mirror'), W2('s_pshift'), W2('s_pblend'), W2('s_shift'), W2('s_twist'), W2('sync'), W2('bend_p'), W2('remap1'),
    W2('pd_o1'), W2('pd_self'), W2('fm_o2'), W2('oddeven'), W2('flip'), W2('d_stomp'), W2('lpf'), W2('am_o1'), W2('rm_noise')];
  const rigs = [
    rig({ t, sig: 'harm', root: 57, f: 233, N: 3, edit: (s, O) => { O.smpo.loop = 3; O.smpo.phaseLock = 1; O.smpo.transients = 1; O.spec.smooth = 1; } }),
    rig({ t, sig: 'clicks', N: 2, p: { 'a.pos': 0.3, 'a.gy': 0.7 }, edit: (s, O) => { O.smpo.loop = 1; O.xy = { on: 1, y: 4, yMode: 0 }; O.spec.postWarp = 1; } }),
    rig({ t, sig: 'short', f: 500, edit: (s, O) => { O.smpo.loop = 0; O.smpo.exitRel = 1; } }),
  ];
  const mod = new Float64Array(16 * 32).fill(0.3), RAW = new Float64Array(16 * 32), OL = new Float64Array(32), OR = new Float64Array(32);
  for (const R of rigs) { R.ctx.mod1 = mod; R.ctx.mod2 = mod; R.ctx.modStride1 = 3; R.ctx.modStride2 = 1; R.ctx.w1.fill(0.4); R.ctx.w2.fill(0.6); note(R); }
  let sum = 0, peak = 0;
  noAlloc(t.S, () => {
    for (let k = 0; k < 3000; k++) {
      const R = rigs[k % 3], c = R.ctx;
      if (k % 97 === 0) { c.mode1 = mods[(k / 97 | 0) % mods.length]; c.mode2 = mods[(k / 97 * 7 | 0) % mods.length]; }
      if (k % 701 === 0) R.o.noteOn(c, true, false);
      if (k % 503 === 0) R.o.noteOn(c, false, true);
      if (k % 811 === 0) R.o.noteOff();
      if (k % 1499 === 0) { R.o.kill(); R.o.noteOn(c, true, false); }
      R.o.render(c, OL, OR, k % 2 ? RAW : null);
      for (let s = 0; s < c.CH; s++) { sum += OL[s] + OR[s]; const a = Math.abs(OL[s]); if (a > peak) peak = a; }
    }
  });
  assert.ok(Number.isFinite(sum) && peak > 0.01 && peak < 20, 'finite, audible output: peak ' + peak);
  for (const R of rigs) R.o.kill();
  assert.equal(rigs[0].P().nFree, rigs[0].P().n);
  assert.equal(t.S.logs.length, 0, t.S.logs.map(m => m.text).join('; '));
});

test('robustness: 80 seeded random configurations (sources, loops, quality, unison, pitches, both warp slots, modulators) stay finite', () => {
  const t = scope();
  let r = 0x9E3779B9;
  const u = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  const sigs = ['harm', 'noise', 'clicks', 'half'];
  for (let it = 0; it < 80; it++) {
    const os = [1, 2, 4][it % 3], N = 1 + Math.floor(u() * 4);
    const p = {};
    for (const k of ['scan', 'lstart', 'xfade', 'flo', 'cut', 'smix', 'ustart', 'uspan', 'sstart', 'pos', 'gy']) p['a.' + k] = u();
    p['a.lend'] = 0.5 + 0.5 * u(); p['a.fhi'] = 0.5 + 0.5 * u(); p['a.send'] = u();
    const R = rig({ t, sig: sigs[it % 4], os, N, p, seed: it + 1, edit: (s, O) => {
      O.smpo.loop = Math.floor(u() * 5); O.smpo.phaseLock = u() < 0.5 ? 1 : 0; O.smpo.transients = u() < 0.5 ? 1 : 0;
      O.spec.smooth = u() < 0.5 ? 1 : 0; O.spec.postWarp = u() < 0.5 ? 1 : 0; O.smpo.exitRel = u() < 0.3 ? 1 : 0;
      if (u() < 0.2) O.xy = { on: 1, y: Math.floor(u() * 8), yMode: Math.floor(u() * 3) };
    } });
    const c = R.ctx, mod = Float64Array.from({ length: 16 * 32 }, () => 2 * u() - 1);
    for (let i = 0; i < N; i++) { c.f[i] = 30 * Math.pow(2, 9 * u()); c.w1[i] = u(); c.w2[i] = u(); }
    c.mode1 = Math.floor(82 * u()); c.mode2 = Math.floor(82 * u()); c.var1 = u(); c.fm1 = Math.floor(3 * u()); c.fm2 = Math.floor(3 * u());
    c.mod1 = mod; c.mod2 = mod; c.modStride1 = 4; c.modStride2 = 1;
    note(R);
    const y = play(R, 2400, { each: (k) => { if (k === 300) { c.mode1 = Math.floor(82 * u()); c.f[0] *= 1.5; } if (k === 450) R.o.noteOff(); } });
    let m = 0;
    for (let s = 0; s < y.length; s++) { const a = Math.abs(y[s]); assert.ok(a < 1e3, `config ${it}: sample ${s} = ${y[s]}`); if (a > m) m = a; }
  }
  assert.equal(t.S.logs.length, 0);
  // the warp line read where the delay is one ulp above the write index: −ε + LL must not round onto LL (an index past the
  // line, NaN). D₀ = 2·fs/f is 63.00000000000039 samples here; the write index passes 63 every LL samples
  const R = rig({ t, f: 3047.6190476190286, root: 69 + 12 * Math.log2(3047.6190476190286 / 440), edit: (s, O) => { O.smpo.loop = 1; } });
  R.ctx.mode1 = W2('bend_p'); R.ctx.w1.fill(0); note(R);
  const y = play(R, 9000);
  assert.ok(R.P().st[R.o.si[0]].d0 > 63 && R.P().st[R.o.si[0]].d0 < 63 + 1e-12);
  assert.ok(y.every(v => Math.abs(v) < 2), 'finite through the line wraps');
});

/* ------------------------------------------------------------------ review round 2: warps, onset, rings, loops, memory */

test('F/P + O slots (§6.10.7, SxWarp.chunk once per slot per chunk): a P/F slot at amount 0 next to LPF, HPF or Stomp Box equals the O slot alone delayed by D₀, from the first sample (onset included)', () => {
  const mk = (m1, w1, m2, w2, f) => {
    const R = rig({ sig: 'harm', root: 57, f, edit: (s, O) => { O.smpo.loop = 1; } });
    R.ctx.mode1 = m1; R.ctx.w1.fill(w1); R.ctx.mode2 = m2; R.ctx.w2.fill(w2);
    return note(R);
  };
  // f 240 Hz: D₀ = 2·T₀ = 800 samples at 96 kHz; 55 Hz: D₀ = 25 ms = 2400 samples (integer delays: exact comparisons)
  for (const f of [240, 55]) {
    const D0 = Math.min(0.025, 2 / f) * 2 * SR;
    for (const [p, o, wo] of [['bend_p', 'lpf', 0.85], ['sync', 'hpf', 0.6], ['bend_p', 'd_stomp', 0.5], ['fm_o1', 'lpf', 0.7], ['pd_o1', 'd_stomp', 0.3]]) {
      for (const sw of [0, 1]) {
        const a = sw ? mk(0, 0, W2(o), wo, f) : mk(W2(o), wo, 0, 0, f);
        const b = sw ? mk(W2(p), 0, W2(o), wo, f) : mk(W2(o), wo, W2(p), 0, f);
        const ya = play(a, 12000), yb = play(b, 12000);
        assert.equal(b.P().st[b.o.si[0]].d0, D0);
        let e = 0, pw = 0;
        for (let s = 0; s < yb.length; s++) { const r = s >= D0 ? ya[s - D0] : 0; e += (yb[s] - r) ** 2; pw += r * r; }
        assert.ok(10 * Math.log10(e / pw) < -120, `${f} Hz, ${p} 0 in slot ${sw ? 1 : 2} + ${o}: ${(10 * Math.log10(e / pw)).toFixed(1)} dB`);
      }
    }
  }
  // the P mode is cleared mid-note while slot 2 holds HPF: the line fades out (10 ms) without restarting the filter — no
  // step above twice the steady slope, and the fundamental stays suppressed afterwards as with HPF alone
  const ref = mk(0, 0, W2('hpf'), 0.6, 240), R = mk(W2('bend_p'), 0.3, W2('hpf'), 0.6, 240);
  const yr = play(ref, 30000), y = play(R, 30000, { each: (k, ctx) => { if (k === 3000) ctx.mode1 = 0; } });
  let steady = 0, worst = 0;
  for (let s = 10000; s < 20000; s++) steady = Math.max(steady, Math.abs(y[s] - y[s - 1]));
  for (let s = 24000 - 50; s < 26000; s++) worst = Math.max(worst, Math.abs(y[s] - y[s - 1]));
  assert.ok(worst <= 2 * steady, `clear: max step ${worst} vs steady ${steady}`);
  assert.equal(R.P().st[R.o.si[0]].dmix, 0);
  const fr = lineAmp(yr, 240, 32768, 16384, 2 * SR), fy = lineAmp(y, 240, 32768, 16384, 2 * SR);
  assert.ok(Math.abs(dB(fy / fr)) < 0.5 && dB(fr) < -30, `fundamental after the clear ${dB(fy).toFixed(1)} dB vs HPF alone ${dB(fr).toFixed(1)} dB`);
});

test('F/P slot selected at note-on (§6.10.7): no crossfade — the onset is the unwarped onset delayed by D₀; Sync\'s window also multiplies the Odd/Even second read', () => {
  for (const [mode, f] of [['bend_p', 240], ['fm_o1', 240], ['pd_o1', 55], ['sync', 55]]) {
    const a = note(rig({ sig: 'harm', root: 57, f, edit: (s, O) => { O.smpo.loop = 1; } }));
    const b = rig({ sig: 'harm', root: 57, f, edit: (s, O) => { O.smpo.loop = 1; } });
    b.ctx.mode1 = W2(mode); b.ctx.w1.fill(0); note(b);
    const ya = play(a, 6000), yb = play(b, 6000), D0 = Math.min(0.025, 2 / f) * 2 * SR;
    let e = 0, pw = 0, pre = 0;
    for (let s = 0; s < yb.length; s++) {
      if (s < D0) pre = Math.max(pre, Math.abs(yb[s]));
      else { e += (yb[s] - ya[s - D0]) ** 2; pw += ya[s - D0] ** 2; }
    }
    assert.equal(pre, 0, mode + ': silent for D₀');
    assert.ok(10 * Math.log10(e / pw) < -120, `${mode}: onset = unwarped onset delayed by D₀ (${(10 * Math.log10(e / pw)).toFixed(1)} dB)`);
  }
  // Sync (Var 1) + Odd/Even at 0 on a sine stream: the second read is the sine half a period away under the same window,
  // so keeping the odd harmonics changes nothing (= Sync alone); either slot order
  for (const sw of [0, 1]) {
    const mk = (oe) => {
      const R = rig({ edit: (s, O) => { O.smpo.loop = 1; } });
      R.ctx.var1 = 1; R.ctx.var2 = 1;
      const [ks, ko] = sw ? ['2', '1'] : ['1', '2'];
      R.ctx['mode' + ks] = W2('sync'); R.ctx['w' + ks].fill(0.5);
      if (oe) { R.ctx['mode' + ko] = W2('oddeven'); R.ctx['w' + ko].fill(0); }
      return note(R);
    };
    const ya = play(mk(0), 20000), yb = play(mk(1), 20000);
    let e = 0, p = 0;
    for (let s = 8000; s < ya.length; s++) { e += (yb[s] - ya[s]) ** 2; p += ya[s] ** 2; }
    assert.ok(10 * Math.log10(e / p) < -80, `Sync + Odd/Even (slot order ${sw}): ${(10 * Math.log10(e / p)).toFixed(1)} dB`);
  }
});

test('Vocode / Mask per slot (§6.10.5): each slot reads its own modulator; a slot at amount 0 is bit-identical to Off; slots on the same modulator share one ring', () => {
  const os = 2, FS = SR * os;
  const run = (m1, w1, m2, w2, { same = false, copy = false } = {}) => {
    const R = rig({ sig: 'harm', root: 57, f: 220, edit: (s, O) => { O.smpo.loop = 1; } });
    const a = new Float64Array(32), b = same ? a : new Float64Array(32);
    let t = 0;
    R.ctx.mode1 = m1; R.ctx.w1.fill(w1); R.ctx.mode2 = m2; R.ctx.w2.fill(w2);
    R.ctx.mod1 = a; R.ctx.mod2 = b; R.ctx.modStride1 = 1; R.ctx.modStride2 = 1;
    note(R);
    const y = play(R, 20000, { each: (k, ctx) => {
      for (let s = 0; s < ctx.CH; s++, t++) { a[s] = 0.5 * Math.sin(TAU * 660 * t / FS); if (!same) b[s] = copy ? a[s] : 0.5 * Math.sin(TAU * 2200 * t / FS); }
    } });
    return { y, M: frameM(R) };
  };
  const off = 0, mB = W2('s_mask_o1'), mN = W2('s_mask_noise'), vB = W2('s_voc_o1');
  const s2 = run(off, 0, mN, 1);
  const a2200 = lineAmp(s2.y, 2200, 10000 * os, 16384, FS), a660 = lineAmp(s2.y, 660, 10000 * os, 16384, FS);
  assert.ok(dB(a2200 / a660) > 60, `slot 2 masks with its own modulator (2.2 kHz): ${dB(a2200).toFixed(1)} vs 660 Hz ${dB(a660).toFixed(1)} dB`);
  assert.deepEqual(Array.from(run(mB, 0, mN, 1).y), Array.from(s2.y), 'slot 1 Mask at amount 0 = Off');
  assert.deepEqual(Array.from(run(vB, 0, mN, 1).y), Array.from(s2.y), 'slot 1 Vocode at amount 0 = Off');
  // two active Mask slots on different modulators: the gains multiply per bin (M_both·M_none = M_1·M_2)
  const m0 = run(off, 0, off, 0).M, m1 = run(mB, 1, off, 0).M, m2 = run(off, 0, mN, 0.5).M, m12 = run(mB, 1, mN, 0.5).M;
  for (let j = 1; j < 1024; j++) assert.ok(Math.abs(m12[j] * m0[j] - m1[j] * m2[j]) <= 1e-9 * (1e-12 + m1[j] * m2[j]) + 1e-15, 'bin ' + j);
  // the same modulator array for both slots (one ring) = two identical arrays (two rings)
  assert.deepEqual(Array.from(run(mB, 1, vB, 0.7, { same: true }).y), Array.from(run(mB, 1, vB, 0.7, { copy: true }).y));
});

test('legato (§11.8): a legato note after a One-shot has played out restarts the oscillator; on a sounding one it keeps the streams', () => {
  const R = note(rig({ sig: 'short', edit: (s, O) => { O.smpo.loop = 0; } }));
  play(R, 1.2 * SR);
  assert.equal(R.o.active(), false, 'played out');
  R.o.noteOn(R.ctx, false, true);
  assert.equal(R.o.active(), true, 'the legato note restarts it');
  const y = play(R, 0.3 * SR);
  let e = 0;
  for (let s = 0.1 * SR * 2; s < y.length; s++) e += y[s] * y[s];
  assert.ok(Math.sqrt(e / (y.length - 0.2 * SR)) > 0.5, 'audible');
  const si = Array.from(R.o.si);
  R.o.noteOn(R.ctx, false, true);
  assert.deepEqual(Array.from(R.o.si), si, 'a legato note on a sounding oscillator keeps its streams');
});

test('loop crossfade (§6.7.4) toward the wrap the playhead travels to: Rev loops take the room after LE; reversed Fwd loops and reversed Tailed fade too', () => {
  const L = SR, b440 = Math.round(440 * 2048 / SR), b880 = Math.round(880 * 2048 / SR);
  // per synthesised frame of stream 0: its read position q (region coordinates) and the 440 / 880 Hz magnitudes
  const frames = (loop, p, sec = 3) => {
    const R = note(rig({ sig: 'split', p: { 'a.xfade': 1, ...p }, edit: (s, O) => { O.smpo.loop = loop; } }));
    const proto = Object.getPrototypeOf(R.o), rec = [];
    R.o.synth = function (st, i, ctx) { const q = st.q; proto.synth.call(this, st, i, ctx); const M = this.pool.M; rec.push([q, M[b440], Math.max(M[b880 - 1], M[b880], M[b880 + 1])]); };
    play(R, sec * SR);
    return rec.slice(8);
  };
  const share = r => r[2] / (r[1] + r[2] + 1e-30);              // 880 Hz share of a frame
  // Rev loop LS 0.25, LE 1 (the sample end): no room after LE ⇒ no crossfade; frames near LS hold only the 440 Hz half
  const r1 = frames(2, { 'a.lstart': 0.25, 'a.lend': 1 });
  const near1 = r1.filter(r => r[0] > 0.26 * L && r[0] < 0.45 * L);
  assert.ok(near1.length > 10 && near1.every(r => share(r) < 1e-3), 'Rev loop at the sample end: no blend toward a frozen edge frame');
  // Rev loop LS 0.25, LE 0.75: the room after LE allows the crossfade; frames approaching LS blend toward q + len (880 Hz)
  const r2 = frames(2, { 'a.lstart': 0.25, 'a.lend': 0.75 });
  assert.ok(r2.some(r => r[0] > 0.25 * L && r[0] < 0.4 * L && share(r) > 0.3), 'Rev loop: crossfade before the wrap at LS');
  // Fwd loop scanned backwards (Scan Reverse at note-on): it wraps at LS, and fades toward q + len there
  const r3 = frames(1, { 'a.lstart': 0.25, 'a.lend': 0.75, 'a.scanrev': 1 });
  assert.ok(r3.some(r => r[0] > 0.25 * L && r[0] < 0.4 * L && share(r) > 0.3), 'reversed Fwd loop: crossfade before the wrap at LS');
  // Tailed started backwards loops the tail [S, M] backwards: it fades toward q + Lr/2 before the wrap at S
  const r4 = frames(4, { 'a.scanrev': 1 });
  assert.ok(r4.some(r => r[0] < 0.1 * L && share(r) > 0.3), 'reversed Tailed: crossfade before the wrap at S');
  // and forwards (Fwd) still fades toward q − len before the wrap at LE (the 440 Hz half blends into the 880 Hz one)
  const r5 = frames(1, { 'a.lstart': 0.25, 'a.lend': 0.75 });
  assert.ok(r5.some(r => r[0] > 0.6 * L && r[0] < 0.75 * L && r[1] / (r[1] + r[2]) > 0.3), 'Fwd loop: crossfade before LE');
});

test('held reads stay on covered analysis frames (Manual X|Y at pos 0 / 1, σ = 0 at START 0): steady level, no beating; a fast scan from START 0 does not keep the edge frames\' phase relations', () => {
  const lvl = (os, p, xy) => {
    const R = note(rig({ sig: 'harm', root: 57, f: 220, os, p, edit: (s, O) => { O.smpo.loop = 1; if (xy) O.xy = { on: 1, y: 0, yMode: 0 }; } }));
    const y = play(R, 30000), fs = SR * os;
    const [mn, mx] = envMinMax(y, 8192 * os, y.length, Math.round(fs / 110));
    return [dB(mn), dB(mx), dB(lineAmp(y, 220, 8192 * os, 16384, fs))];
  };
  for (const os of [1, 2, 4]) {
    const [, , ref] = lvl(os, { 'a.pos': 0.5 }, true);
    for (const [p, xy] of [[{ 'a.pos': 0 }, true], [{ 'a.pos': 1 }, true], [{ 'a.scan': nScan(0), 'a.sstart': 0 }, false]]) {
      const [mn, mx, a] = lvl(os, p, xy);
      assert.ok(mx - mn < 0.3 && Math.abs(a - ref) < 0.3, `OS ${os} ${JSON.stringify(p)}: peaks ${mn.toFixed(2)}…${mx.toFixed(2)} dB, fundamental ${a.toFixed(2)} vs ${ref.toFixed(2)} dB`);
    }
  }
  // σ above the 2-frame mean-slope range at Draft (and at High with σ 4) from START 0: steady sine level
  for (const [os, sig] of [[1, 1.5], [2, 4]]) {
    const R = note(rig({ os, p: { 'a.scan': (sig / (os === 1 ? 2 : 4) + 1) / 2, 'a.sstart': 0 }, edit: (s, O) => { O.smpo.loop = 1; if (os === 2) O.smpo.scanRange = 1; } }));
    const y = play(R, 0.45 / sig * 2 * SR), [mn, mx] = envMinMax(y, 4096 * os, y.length, 2 * Math.round(SR * os / 440));   // before the loop wraps
    assert.ok(Math.abs(R.o.cSig - sig) < 1e-12, 'σ ' + R.o.cSig);
    assert.ok(dB(mn) > -0.3 && dB(mx) < 0.3, `OS ${os} σ ${sig}: ${dB(mn).toFixed(2)}…${dB(mx).toFixed(2)} dB`);
  }
});

test('onset (§6.10.1, IMPL sparse pre-roll): 3 frames in the first hop at every quality; no frame enters with a step (largest step ≤ the steady slope); full level after the first hop', () => {
  for (const os of [1, 2, 4]) {
    const R = note(rig({ sig: 'sine', root: 69 + 12 * Math.log2(110 / 440), f: 110, os, N: 3, edit: (s, O) => { O.smpo.loop = 1; } }));
    const H = R.o.H, st = [0, 1, 2].map(i => R.P().st[R.o.si[i]]), RAW = new Float64Array(16 * 32), raw = [[], [], []];
    let f0 = R.P().frames;
    const perHop = [];
    for (let c = 0, t = 0; t < 6 * H; c++, t += 4) {
      R.o.render(R.ctx, new Float64Array(32), new Float64Array(32), RAW);
      for (let i = 0; i < 3; i++) for (let s = 0; s < 4 * os; s++) raw[i].push(RAW[i * 32 + s]);
      if ((t + 4) % H === 0) { perHop.push(R.P().frames - f0); f0 = R.P().frames; }
    }
    assert.deepEqual(perHop.slice(0, 3), [9, 3, 3], `OS ${os}: frames per hop (3 streams)`);
    for (let i = 0; i < 3; i++) {
      const y = raw[i];
      let first = 0, steady = 0;
      for (let s = 1; s < H * os; s++) first = Math.max(first, Math.abs(y[s] - y[s - 1]));
      for (let s = 3 * H * os; s < y.length; s++) steady = Math.max(steady, Math.abs(y[s] - y[s - 1]));
      assert.ok(first <= 1.05 * steady, `OS ${os} stream ${i} (slot ${st[i].slot}): first-hop step ${first} vs steady ${steady}`);
      const [lo, hi] = envMinMax(y, H * os, y.length, Math.round(2 * SR * os / 110));
      assert.ok(dB(lo) > -0.1 && dB(hi) < 0.1, `OS ${os} stream ${i}: level after the first hop ${dB(lo).toFixed(3)}…${dB(hi).toFixed(3)} dB`);
    }
  }
});

test('pitch at Draft and at base 44.1 kHz (§6.10.3): moved lobes are re-rendered as Hann kernels — hop-rate ripple ≤ 0.2 dB, level within 0.15 dB', () => {
  for (const [os, f] of [[1, 660], [1, 880], [1, 3520], [1, 220], [1, 1234.5], [2, 660], [4, 3520]]) {
    const R = note(rig({ os, f, edit: (s, O) => { O.smpo.loop = 1; } }));
    const y = play(R, 40000), fs = SR * os, [mn, mx] = envMinMax(y, 16384 * os / 2, y.length, Math.round(fs / f) * 4);
    assert.ok(dB(mx / mn) < 0.2 && Math.abs(dB(mn)) < 0.15 && Math.abs(dB(mx)) < 0.15, `OS ${os} ρ ${f / 440}: ${dB(mn).toFixed(3)}…${dB(mx).toFixed(3)} dB`);
  }
  // base 44.1 kHz with a 48 kHz analysis (s = 1.088 at ρ = 1)
  for (const os of [1, 2]) {
    const T = scope(), e = analysis('spec:smp:t', 'sine', 69);
    assert.equal(T.B.storeAsset(e.id, e), true);
    const st = core.defaultSerum();
    st.osc[0].type = 'spec'; st.osc[0].smp = 'smp:t'; st.global.os = os; st.osc[0].smpo.loop = 1;
    const cp = core.compileSerum(core.normalizeSerum(st), {}).serum, B44 = 44100;
    const proc = { base: B44, fs: B44 * os, CH: 4 * os, offline: true, sx: {} }, o = new T.X.SpecOsc({ proc, rnd2: () => 0.5 }, 0);
    assert.equal(o.apply(cp, 0, null), true);
    const ctx = { ...octx(cp, proc.sx, { os }), fs: B44 * os, base: B44 }, L = new Float64Array(32), Rr = new Float64Array(32), y = [];
    o.noteOn(ctx, true, false);
    for (let k = 0; k < 40000 / 4; k++) { o.render(ctx, L, Rr, null); for (let s = 0; s < 4 * os; s++) y.push(L[s]); }
    const [mn, mx] = envMinMax(y, 8192 * os, y.length, Math.round(B44 * os / 440) * 4);
    assert.ok(dB(mx / mn) < 0.2 && Math.abs(dB(mn)) < 0.15 && Math.abs(dB(mx)) < 0.15, `base 44.1 kHz OS ${os}: ${dB(mn).toFixed(3)}…${dB(mx).toFixed(3)} dB`);
  }
});

test('stream memory (§14.2): per-stream buffers only for the warp modes the patch can reach; the pool stays within 64 KB per stream', () => {
  const { B, X } = scope();
  const K64 = 65536;
  const pool = (p = {}, edit = null, os = 2, n = 32) => {
    const s = core.defaultSerum();
    s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:t'; s.global.os = os;
    Object.assign(s.p, p);
    if (edit) edit(s);
    const cp = core.compileSerum(core.normalizeSerum(s), { qr: { specStreams: n } }).serum;
    const proc = { base: SR, fs: SR * os, CH: 4 * os, offline: true, sx: {} }, o = new X.SpecOsc({ proc }, 0);
    assert.equal(o.apply(cp, 0, null), true);
    return proc.sx.specPool;
  };
  const has = P => { const st = P.st[0]; return [st.line !== null, st.sl !== null, st.u0 !== null, st.u1 !== null, st.dn0 !== null, st.dn1 !== null].map(Number).join(''); };
  assert.equal(has(pool()), '000000', 'no warps: no line, no rings');
  assert.equal(has(pool({ 'a.w1': W2('bend_p') / 81 })), '110000', 'P mode: the warp line');
  assert.equal(has(pool({ 'a.w1': W2('d_tube') / 81 })), '110000', 'O mode: the line (Odd/Even history) and Slots');
  assert.equal(has(pool({ 'a.w1': W2('s_smear') / 81 })), '001000', 'Smear in slot 1: its state buffer');
  assert.equal(has(pool({ 'a.w2': W2('s_voc_o1') / 81, 'a.warp2': 0.5 })), '000101', 'Vocode in slot 2: its ring and decimator');
  assert.equal(has(pool({ 'a.w1': W2('s_comb') / 81 })), '000000', 'other spectral warps need nothing');
  const all = pool({}, s => { s.matrix[0] = { src: 'lfo1', amt: 1, dst: 'a.w1', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }; });
  assert.equal(has(all), '111010', 'a modulated slot-1 mode: every slot-1 buffer and the line (slot 2 Off)');
  // budgets: desktop 32 streams with every buffer, touch 16 streams with the largest unmodulated set (Vocode + a P warp)
  const every = pool({ 'a.w2': 0.1 }, s => {
    ['a.w1', 'a.w2'].forEach((d, r) => { s.matrix[r] = { src: 'lfo1', amt: 1, dst: d, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }; });
  });
  assert.equal(has(every), '111111');
  assert.ok(every.bytes() <= 32 * K64, `32 streams, every buffer: ${every.bytes()} B`);
  const touch = pool({ 'a.w1': W2('s_voc_o1') / 81, 'a.w2': W2('bend_p') / 81 }, null, 2, 16);
  assert.equal(has(touch), '111010');
  assert.ok(touch.bytes() <= 16 * K64, `16 streams, Vocode + Bend: ${touch.bytes()} B`);
  assert.ok(pool({}, null, 2, 16).bytes() <= 0.6 * 16 * K64, 'no warps: well under the touch budget');
  // Ultra (OS 4): the warp line runs at 192 kHz — a rate-dependent buffer (§14.2 "× 4 at 192 kHz"), counted at its 48 kHz size
  const u = pool({ 'a.w2': 0.1 }, s => {
    ['a.w1', 'a.w2'].forEach((d, r) => { s.matrix[r] = { src: 'lfo1', amt: 1, dst: d, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }; });
  }, 4, 32), st = u.st[0];
  assert.ok(u.bytes() - 32 * st.line.byteLength * 3 / 4 <= 32 * K64, `OS 4: ${u.bytes()} B`);
  // a patch change that first selects a P mode while a note sounds: apply adds the line to the busy stream, which fills
  // with 2·D₀ of history before the 10 ms fade-in — no dropout
  const R = rig({ edit: (s2, O) => { O.smpo.loop = 1; }, anyMode: false }), sB = core.defaultSerum();
  sB.osc[0].type = 'spec'; sB.osc[0].smp = 'smp:t'; sB.global.os = 2; sB.osc[0].smpo.loop = 1; sB.p['a.w1'] = W2('bend_p') / 81;
  const cpB = core.compileSerum(core.normalizeSerum(sB), {}).serum;
  note(R);
  assert.equal(R.P().st[R.o.si[0]].line, null);
  const y = play(R, 30000, { each: (k, ctx) => { if (k === 2000) { R.o.apply(cpB, 0, null); ctx.mode1 = W2('bend_p'); ctx.w1.fill(0.3); } } });
  assert.ok(R.P().st[R.o.si[0]].line !== null && R.P().st[R.o.si[0]].dmix === 1);
  const [mn] = envMinMax(y, 12000, 24000, Math.round(2 * SR / 440) + 1);
  assert.ok(dB(mn) > -0.5, 'no dropout when the line arrives mid-note: ' + dB(mn).toFixed(2) + ' dB');
});

/* ------------------------------------------------------------------ through the voice: §14.1 CPU rows h, h′ */

// §14.1 node gate through tests/cpu-gate.mjs (calibrated pairs, retries; RULINGS2 Performance): load ≤ 1.5 × target
const gateLoad = async (fn, target) => (await CPU.gateLoad(fn, target)).load;
const T_REF_CALIB = CPU.T_REF_CALIB;
// n SerumDSP voices (OS 2, chunk 8) playing state s; go() renders 1 s (375 quanta of 128 base samples), q() the per-quantum
// times (ms) of a fresh start of every voice in the same quantum
function voiceBench(sc, s, n, assets, os = 2) {
  const S = sc.global('SerumDSP'), B = sc.global('SxBase');
  for (const [id, e] of Object.entries(assets)) assert.equal(B.storeAsset(id, e), true, id);
  const P = core.compileSerum(core.normalizeSerum(s), {}), cp = P.serum;
  const proc = { base: SR, OS: os, fs: os * SR, CH: 4 * os, p: { serum: cp, fxr: null }, ct: P.serumT, bendRaw: 0, wheel: 0, at: 0,
    pat: new Float64Array(128), patSeen: false, bpm: 120, songBeat: () => null, held: [], voices: [], sx: null, mpe: new Float64Array(68), vcN: 0,
    offline: true };
  const vs = [];
  for (let i = 0; i < n; i++) vs.push(new S.SerumVoice(proc, i));
  proc.voices = vs;
  for (const v of vs) v.apply(proc.p);
  const N = 128 * os, L = new Float64Array(N), R = new Float64Array(N);
  const start = () => { for (const v of vs) v.kill(); vs.forEach((v, i) => v.noteOn(48 + 3 * i, 0.8, false, 1)); };
  const quantum = () => { S.begin(proc, N); for (const v of vs) v.render(L, R, N); S.fxMods(proc); };
  const go = () => { for (let k = 0; k < 375; k++) quantum(); };
  const q = () => { start(); const t = []; for (let k = 0; k < 375; k++) { const t0 = performance.now(); quantum(); t.push(performance.now() - t0); } return t; };
  start(); go();
  return { go, q, vs, proc, L, R };
}

test('CPU rows h (4 voices Spectral, N 2048, hop 512, one Smear warp) and h′ (8 voices; worst quantum ≤ 3 × the mean) — §14.1 node gate', async () => {
  const sc = dspScope({ fast: true });
  const n = 2 * SR, x = new Float32Array(n);
  for (let j = 0; j < n; j++) { let v = 0; for (let h = 1; h <= 20; h++) v += Math.sin(TAU * 220 * h * j / SR) / h; x[j] = 0.3 * v; }
  const a = smp.specAnalyse(x, null, SR);
  const e = { id: 'spec:smp:h', v: 1, kind: 'spec', bytes: 0, ch: 1, rate: a.rate, len: a.len, N: a.N, hop: a.hop, frames: a.frames,
    mag: a.mag, ph: a.ph, trans: a.trans, peak: a.peak, root: 57 };
  const s = core.defaultSerum();
  s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:h'; s.osc[0].route = 1; s.osc[0].smpo.loop = 1; s.global.os = 2; s.voicing.poly = 8;
  Object.assign(s.p, { 'a.rand': 0, 'e1.att': 0, 'a.w1': W2('s_smear') / 81, 'a.warp': 0.5 });
  const h = voiceBench(sc, s, 4, { [e.id]: e }), h2 = voiceBench(sc, s, 8, {});
  const P = h.proc.sx.specPool;
  assert.ok(P && h.vs.every(v => v.ox[0] && v.ox[0].nS === 1), 'one stream per voice from the processor pool');
  assert.equal(h.vs[0].ctx[0].mode1, W2('s_smear'));
  let e2 = 0;
  for (let i = 0; i < 256; i++) e2 += h2.L[i] * h2.L[i];
  assert.ok(e2 > 1, 'the voices sound');
  const lh = await gateLoad(h.go, 0.25), lh2 = await gateLoad(h2.go, 0.5);
  // worst render quantum of a fresh 8-voice start (median of 5 starts per quantum index) vs the mean; up to 3 attempts
  // (the lowest ratio counts) so a loaded test machine does not fail the gate
  const med = a2 => a2.slice().sort((p2, q2) => p2 - q2)[a2.length >> 1];
  let mean = 0, worst = Infinity;
  for (let attempt = 0; attempt < 3 && !(worst <= 3 * mean); attempt++) {
    const runs = [];
    for (let r = 0; r < 5; r++) runs.push(h2.q());
    const mq = runs[0].map((_, k) => med(runs.map(r => r[k]))), m = mq.reduce((p2, c) => p2 + c, 0) / mq.length, w = Math.max(...mq);
    if (!(w / m >= worst / mean)) { mean = m; worst = w; }
  }
  console.log(`  CPU (h) ${lh.toFixed(3)} (target 0.25), (h′) ${lh2.toFixed(3)} (target 0.5), worst quantum ${(worst / mean).toFixed(2)} × mean — OS 2; ` +
    (T_REF_CALIB > 0 ? 'calibrated' : 'uncalibrated (no tests/bench.json)'));
  assert.ok(lh <= 1.5 * 0.25, '(h) ' + lh.toFixed(3));
  assert.ok(lh2 <= 1.5 * 0.5, '(h′) ' + lh2.toFixed(3));
  assert.ok(worst <= 3 * mean, `(h′) worst quantum ${(worst / mean).toFixed(2)} × the mean`);
  // the onset burst bound (sparse pre-roll, 3 frames in the first hop at every quality): 8 voices × unison 4 at Ultra
  // (OS 4, hop N/8) — the whole default 32-stream pool starting in one quantum
  const su = core.defaultSerum();
  su.osc[0].type = 'spec'; su.osc[0].smp = 'smp:h'; su.osc[0].route = 1; su.osc[0].smpo.loop = 1; su.global.os = 4; su.voicing.poly = 8;
  Object.assign(su.p, { 'a.rand': 0, 'e1.att': 0, 'a.uni': 3 / 15, 'a.w1': W2('s_smear') / 81, 'a.warp': 0.5 });
  const u4 = voiceBench(sc, su, 8, {}, 4);
  assert.ok(u4.vs.every(v => v.ox[0] && v.ox[0].nS === 4), '4 streams per voice');
  let mU = 0, wU = Infinity;
  for (let attempt = 0; attempt < 3 && !(wU <= 3 * mU); attempt++) {
    const runs = [];
    for (let r = 0; r < 5; r++) runs.push(u4.q());
    const mq = runs[0].map((_, k) => med(runs.map(r => r[k]))), m = mq.reduce((p2, c) => p2 + c, 0) / mq.length, w = Math.max(...mq);
    if (!(w / m >= wU / mU)) { mU = m; wU = w; }
  }
  console.log(`  onset burst, 8 voices × unison 4 at OS 4: worst quantum ${(wU / mU).toFixed(2)} × mean`);
  assert.ok(wU <= 3 * mU, `8 × unison 4, OS 4: worst quantum ${(wU / mU).toFixed(2)} × the mean`);
});
