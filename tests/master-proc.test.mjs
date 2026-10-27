// The master processor 'synth-master' (IMPL-M §1, §3, §6 G1 (node part) / G2 / G4; lane D) in a node:vm worklet scope with
// the whole DSP list and engine.js (ports that record what they post; processors captured by name). Registration before
// 'synth-engine' (six harnesses take the last registration as the Track); M1 (G1): an empty / all-off rack copies its input
// bit for bit over 30 s of random float32 stereo with exact zeros, −0, silence, `inputs = []` / `[[]]` / mono, with and
// without monitors, across transport / chain / tempo / bypass (Q3's match) / panic / mreset / fxtap / fxph messages; M2 (G2):
// a recorded input stream live (messages at main.js's anchors after ≥ 0.25 s of exact zeros) ≡ offline (options) — (a) a
// start on a quantum boundary exact, (b) unaligned starts (F mod 128 = 4 / 60 / 124) measured and gated at −80 dB, (c) the
// rack compiled with qr null both ways exact with a Convolve (a quality step would change the FXP), (d) pathLat() per unit
// type and mode = an impulse's delay; the start split; the A/B (time-aligned 5 ms crossfade, Q3's frozen match); M4 (the
// meters change no sample); the offline mlat / mfinal window; the store messages and ALL; no allocation per quantum; G4 node
// gates (bench rows master-empty / master-meters / master-rack5) and the warm-up's first quanta. MASTER's outputs for a fixed
// input + rack set are frozen at acceptance: GOLDEN_FREEZE_M=1 writes tests/ref-M/master-out.json.
// Run: node --max-old-space-size=2048 --test tests/master-proc.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';
import * as C from '../fx-core.js?v=9';
import * as CG from '../cv-graph.js?v=9';
import { irEntry } from '../smpwork.js?v=9';
import { convShapeOf } from '../assets.js?v=9';
import * as CPU from './cpu-gate.mjs';
import { scenarios, masterInput, measure } from './bench-scenarios.mjs';

const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
const ENGINE = source('engine.js');
const SR = 48000, Q = 128;
const dB = x => 20 * Math.log10(x);
const OUT = {};                                                    // sha256 of MASTER's outputs, frozen at acceptance (ref-M)

// a worklet scope: the DSP list (master-dsp.js null when meters is false), engine.js; every registration recorded in order
function scope({ sr = SR, meters = true } = {}) {
  const D = dspScope({ fast: true, sampleRate: sr, console: quiet, overrides: meters ? {} : { 'master-dsp.js': null } });
  D.run('(function () { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { this.port = { msgs: [], postMessage(m) { this.msgs.push(m); }, onmessage: null }; } };'
    + ' globalThis.__reg = []; globalThis.registerProcessor = function registerProcessor(n, c) { globalThis.__reg.push([n, c]); }; })()', 'master-worklet.js');
  D.run(ENGINE, 'engine.js');
  const reg = D.run('globalThis.__reg', 'reg.js'), by = {};
  for (const [n, c] of reg) by[n] = c;
  return { D, ctx: D.ctx, names: reg.map(e => e[0]), Master: by['synth-master'], Track: by['synth-engine'], sr };
}
const SC = scope();
const mk = (S, po = {}) => { S.ctx.currentFrame = 0; return new S.Master({ processorOptions: po }); };
const J = x => JSON.parse(JSON.stringify(x));                     // (the scope's objects and arrays: another realm)
const posted = (p, t) => Array.from(p.port.msgs).filter(m => m.t === t);

// FX v2 states: instances [type, {pid: n}, branches?, variant?] on MAIN (a splitter's branches: lists of [type, {pid: n}])
function rack(list, o = {}) {
  const inst = ([type, p, br, vv], k) => {
    const T = C.FXP_TAB[type], v = vv || (T[2] ? 2 : 1), rows = T[v];
    for (const pid of Object.keys(p)) if (!rows.some(r => r.pid === pid)) throw new Error(type + ': no ' + pid);
    const I = { id: type + k, type, v, p: Object.assign({ on: 1 }, p) };
    if (br) { I.br = br.map((b, j) => b.map((x, q) => inst(x, 10 * k + 3 * j + q + 1))); I.bb = br.map(() => 0); }
    return I;
  };
  return C.normalizeFx2({ v: 2, racks: [{ mods: list.map(inst), byp: o.byp || 0 }, { mods: [] }, { mods: [] }] });
}
const chain = (fx, o = {}) => CG.chainPatch(fx, { sr: o.sr || SR, bpm: o.bpm || 120, prefs: {}, seed: false, qr: o.qr === undefined ? null : o.qr });
// G2's rack: a synced Delay, a Chorus, a Flanger, a Limit compressor, a Reverb, a Distortion
const RACK6 = rack([['dist', { drive: 0.35, mix: 0.6 }], ['flg', { mix: 0.4 }], ['cho', { mix: 0.4 }], ['dly', { bpm: 1, mix: 0.3 }],
  ['cmp', { ratio: 1, att: 0.4 }], ['rev', { mix: 0.25 }]]);
// every type, every instance off (the splitter's branch instances too)
const ALLOFF = rack(['dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil', 'hyper', 'bode', 'util'].map(t => [t, { on: 0 }])
  .concat([['split2', { on: 0 }, [[['dist', { on: 0 }]], [['cmp', { on: 0, ratio: 1 }]]]]]));

// a deterministic program (stereo, ≈ −14 dBFS): three tones under slow envelopes, a noise burst every 0.5 s
function program(N, sr = SR, seed = 'prog') {
  const r = mulberry32(fnv1a32(seed)), L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr, e = Math.min(1, t * 8) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    const x = 0.12 * Math.sin(2 * Math.PI * 110 * t) + 0.08 * Math.sin(2 * Math.PI * 277.2 * t + 1) + 0.05 * Math.sin(2 * Math.PI * 1661 * t);
    const b = (t % 0.5) < 0.03 ? 0.2 * (2 * r() - 1) : 0;
    L[i] = e * x + b; R[i] = e * (0.9 * x - 0.03 * Math.sin(2 * Math.PI * 3300 * t)) - 0.7 * b;
  }
  return { L, R };
}
// renders N frames through p from frame S.ctx.currentFrame on: input(o) → the quantum's inputs (default: silence []),
// before(o) posts messages; → { L, R }
function render(S, p, N, input, before) {
  const L = new Float32Array(N), R = new Float32Array(N), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
  for (let o = 0; o < N; o += Q) {
    if (before) before(o);
    p.process(input ? input(o) : [], out);
    L.set(oL.subarray(0, Math.min(Q, N - o)), o); R.set(oR.subarray(0, Math.min(Q, N - o)), o);
    S.ctx.currentFrame += Q;
  }
  return { L, R };
}
// the input of a signal { L, R } starting at frame F (zeros before and after)
function feedAt(sig, F) {
  const a = new Float32Array(Q), b = new Float32Array(Q);
  return o => {
    for (let i = 0; i < Q; i++) { const k = o + i - F; a[i] = k >= 0 && k < sig.L.length ? sig.L[k] : 0; b[i] = k >= 0 && k < sig.R.length ? sig.R[k] : 0; }
    return [[a, b]];
  };
}
const sha = ({ L, R }) => createHash('sha256').update(Buffer.from(L.buffer, L.byteOffset, L.byteLength)).update(Buffer.from(R.buffer, R.byteOffset, R.byteLength)).digest('hex');
function sameBits(a, b, off = 0) { for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[off + i])) return i; return -1; }
const peak = a => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };

test('engine.js registers synth-master before synth-engine: the last registration (six harnesses\' Proc) stays the Track; dsp-scope captures both by name', () => {
  assert.deepEqual([...SC.names], ['synth-master', 'synth-safe', 'synth-engine']); // (the safety limiter beside MASTER: tests/safe-proc)
  const D = dspScope({ engine: true, fast: true, console: quiet });
  assert.equal(D.Proc, D.procs['synth-engine']);
  assert.ok(D.procs['synth-master'] && D.procs['synth-master'] !== D.Proc);
  assert.equal(typeof new D.Proc({ processorOptions: { offline: true } }).i0, 'object', 'Proc is the Track');
});

test('construction: live posts ready (after its warm-up: meters reset, nothing left from it), offline posts mlat (no ready, no warm-up); without master-dsp.js MASTER passes audio and posts no mmon', () => {
  const p = mk(SC);
  assert.deepEqual(J(p.port.msgs.map(m => m.t)), ['ready']);
  assert.equal(p.frames, 0); assert.equal(p.ab, 0); assert.equal(p.abx, 0); assert.equal(p.abG, 1); assert.equal(p.wf, 0);
  const s = p.M.summary();
  assert.equal(s.m, -Infinity); assert.equal(s.i, -Infinity); assert.equal(s.tpMax, -Infinity); assert.equal(p.Mi.short(), -Infinity);
  assert.equal(p.c.rack.fresh, 1, 'the rack untouched by the warm-up (fresh: the first chain snaps as offline)');
  const q = mk(SC, { offline: true });
  assert.deepEqual(J(q.port.msgs.map(m => [m.t, m.lat])), [['mlat', 0]]);
  assert.equal(q.Mi, null);
  const S0 = scope({ meters: false }), N = mk(S0);
  assert.equal(N.M, null);
  N.msg({ t: 'mon', ids: ['meters'] });
  const sig = program(4 * Q), out = render(S0, N, 4 * Q, feedAt(sig, 0));
  assert.equal(sameBits(sig.L, out.L), -1); assert.equal(sameBits(sig.R, out.R), -1);
  assert.equal(posted(N, 'mmon').length, 0);
});

// G1 (node part): 30 s, the message schedule by quantum; expected = the input (0 for none, L for a mono input's R)
function g1(S, fx, { mon = true } = {}) {
  const p = mk(S), r = mulberry32(fnv1a32('g1')), a = new Float32Array(Q), b = new Float32Array(Q), m1 = new Float32Array(Q);
  const oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]], K = Math.round(30 * SR / Q);
  const send = bpm => { if (fx) p.msg(Object.assign({ t: 'chain' }, chain(fx, { bpm }))); };
  const tp = (k, o) => p.msg(Object.assign({ t: 'transport', play: true, seek: true, frame: S.ctx.currentFrame + k, tick: 0, fpt: SR * 60 / (120 * 960), loop: false }, o));
  let bad = 0, first = -1;
  for (let k = 0; k < K; k++) {
    switch (k) {
      case 0: send(120); break;
      case 40: if (mon) p.msg({ t: 'mon', ids: ['meters', 'mfx'] }); break;
      case 100: tp(1003, { fresh: true }); break;
      case 375: case 2600: case 5000: p.msg({ t: 'bypass', on: true, g: true }); break;
      case 600: case 2800: case 6000: p.msg({ t: 'bypass', on: false, g: true }); break;
      case 700: send(90); break;
      case 800: tp(517, { seek: false }); break;
      case 1000: p.msg({ t: 'transport', play: false }); break;
      case 1100: p.msg({ t: 'panic' }); break;
      case 1200: tp(1085, { fresh: true }); break;
      case 1500: p.msg({ t: 'mreset' }); p.msg({ t: 'fxtap', id: fx && fx.racks[0].mods.length ? fx.racks[0].mods[0].id : '' }); p.msg({ t: 'fxph' }); break;
      case 2000: if (mon) p.msg({ t: 'mon', ids: [] }); break;
      case 2700: case 5500: send(133); break;
      case 7000: p.msg({ t: 'transport', play: false }); tp(64, { fresh: true }); break;
      default: if (k % 997 === 0) send(120 + (k % 7));
    }
    // the input: random float32 (exact zeros and −0 sprinkled), silence 3000–3750, none 4000–4100 ([]), 4100–4200 ([[]]), mono 4200–4300
    let inp, mode = 0;
    if (k >= 4000 && k < 4100) { inp = []; mode = 1; } else if (k >= 4100 && k < 4200) { inp = [[]]; mode = 1; } else {
      for (let i = 0; i < Q; i++) {
        const silent = k >= 3000 && k < 3750, u = r(), v = r();
        a[i] = silent ? 0 : u < 0.01 ? 0 : u < 0.02 ? -0 : 2 * v - 1;
        b[i] = silent ? (i & 1 ? -0 : 0) : 1.5 * (r() - 0.5);
        m1[i] = a[i];
      }
      if (k >= 4200 && k < 4300) { inp = [[m1]]; mode = 2; } else inp = [[a, b]];
    }
    p.process(inp, out);
    S.ctx.currentFrame += Q;
    for (let i = 0; i < Q; i++) {
      const eL = mode === 1 ? 0 : a[i], eR = mode === 1 ? 0 : mode === 2 ? m1[i] : b[i];
      if (!Object.is(oL[i], eL) || !Object.is(oR[i], eR)) { bad++; if (first < 0) first = k * Q + i; }
    }
  }
  return { p, bad, first };
}

test('G1 / M1: an empty or all-off rack (or none) copies input → output bit for bit (float32, −0 kept, silence, [] / [[]] → +0, mono → both) over 30 s, with and without monitors, across transport / chain / tempo / bypass (Q3\'s match) / panic / mreset / fxtap / fxph', () => {
  for (const [name, fx] of [['no chain', null], ['empty', C.defaultFx2()], ['all off', ALLOFF]]) {
    for (const mon of [true, false]) {
      const r = g1(SC, fx, { mon });
      assert.equal(r.bad, 0, `${name}${mon ? ' + monitors' : ''}: ${r.bad} samples differ (first at frame ${r.first})`);
      const ab = posted(r.p, 'ab');
      assert.ok(ab.length === 6 && ab.every(m => m.g === 0), name + ': the A/B match on an empty rack is 0 dB exactly');
      if (mon) {
        assert.ok(posted(r.p, 'mmon').length > 100 && posted(r.p, 'smon').length > 100, name + ': monitors posted');
        assert.ok(posted(r.p, 'fxph').length >= 1);
      } else assert.equal(posted(r.p, 'mmon').length, 0);
      r.p.port.msgs.length = 0;
    }
  }
  assert.equal(ALLOFF.racks[0].mods.length, 13);
});

test('M4: the meters change no sample — the 6-unit rack rendered with and without monitors (and a mreset / bypass-free schedule) is bit-identical', () => {
  const sig = program(Math.round(1.5 * SR)), outs = [];
  for (const mon of [false, true]) {
    const p = mk(SC);
    p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
    if (mon) p.msg({ t: 'mon', ids: ['meters', 'mfx'] });
    outs.push(render(SC, p, 2 * SR, feedAt(sig, 0), o => { if (o === 24960) p.msg({ t: 'mreset' }); }));
  }
  assert.equal(sameBits(outs[0].L, outs[1].L), -1); assert.equal(sameBits(outs[0].R, outs[1].R), -1);
});

// G2: offline (options; transport at frame 0) vs live (warm-up, chain, zeros, the transport posted 1024 frames ahead at F);
// heard (s): the live MASTER first plays another program from frame 0 and stops (■: the stop's silence tails; stop false:
// it plays on through the zeros) at that quantum-aligned time — F then lies ≥ 0.5 s after it
// (sig: the song's input { L, R } instead of `sec` s of program)
function g2(fx, F, { sec = 2.5, tail = 1.5, qr = null, prep, heard = 0, stop = true, sig: S = null } = {}) {
  const sig = S || program(Math.round(sec * SR)), T = Math.ceil(((S ? S.L.length / SR : sec) + tail) * SR / Q) * Q, fpt = SR * 60 / (120 * 960);
  const cO = chain(fx, { qr: null }), cL = chain(fx, { qr });
  if (prep) prep(cO);
  const off = mk(SC, { offline: true, fxr: cO.fxr, fxrT: cO.fxrT, transport: { play: true, frame: 0, tick: 0, fpt, loop: false }, frames: T });
  const A = render(SC, off, T, feedAt(sig, 0));
  const live = mk(SC);
  live.msg(Object.assign({ t: 'chain' }, cL));
  const H = Math.round(heard * SR / Q) * Q, hs = H > 0 ? program(H, SR, 'heard') : null, fd = feedAt(sig, F);
  const inp = !hs ? fd : o => { const x = fd(o); if (o < H) { x[0][0].set(hs.L.subarray(o, o + Q)); x[0][1].set(hs.R.subarray(o, o + Q)); } return x; };
  const at = Math.max(0, Math.floor((F - 1024) / Q) * Q), B = render(SC, live, F + T + Q, inp, o => {
    if (H > 0 && o === 0) live.msg({ t: 'transport', play: true, seek: true, fresh: true, frame: 0, tick: 0, fpt, loop: false });
    if (H > 0 && o === H && stop) live.msg({ t: 'transport', play: false });
    if (o === at) live.msg({ t: 'transport', play: true, seek: true, fresh: true, frame: F, tick: 0, fpt, loop: false, ls: 0, le: 0, wrap: false });
  });
  let d = 0;
  for (let i = 0; i < T; i++) d = Math.max(d, Math.abs(A.L[i] - B.L[F + i]), Math.abs(A.R[i] - B.R[F + i]));
  return { A, B, T, F, d, ref: Math.max(peak(A.L), peak(A.R)), exact: sameBits(A.L, B.L, F) === -1 && sameBits(A.R, B.R, F) === -1, off, live };
}

test('G2 (a) export = playback: the 6-unit rack (synced Delay, Chorus, Flanger, Limit compressor, Reverb, Distortion) live from a quantum-aligned start after 0.5 s of exact zeros ≡ offline bit for bit', (t) => {
  for (const F of [187 * Q, 250 * Q]) {
    const r = g2(RACK6, F);
    assert.ok(r.ref > 0.05, 'audible');
    assert.ok(r.exact, `F ${F}: max |live − offline| ${r.d} (${dB(r.d / r.ref).toFixed(1)} dB)`);
    if (F === 187 * Q) OUT.rack6 = sha(r.A);
  }
  t.diagnostic('aligned starts: exact');
});

test('G2 (b) unaligned starts (F mod 128 = 4 / 60 / 124): the rack\'s per-call partition differs — the largest difference measured, ≤ −80 dB of the peak (the integration.test precedent)', (t) => {
  const rec = {};
  for (const m of [4, 60, 124]) {
    const r = g2(RACK6, 187 * Q + m), v = dB(r.d / r.ref);
    rec[m] = +v.toFixed(1);
    assert.ok(r.d === 0 || v <= -80, `F mod 128 = ${m}: ${v.toFixed(1)} dB`);
  }
  t.diagnostic('G2 (b) max |live − offline| re peak (dB): ' + JSON.stringify(rec));
});

test('G2 (c) qr null both ways: a rack with a Convolve compiled live and offline by chainPatch(…, {qr: null}) is the same FXP and renders bit for bit (the start at frame 0); a safeguard quality step (qr {convMax: 1}) would change it; after 0.5 s of zeros the Convolve\'s own partition clock (not restarted by the quiet re-seed) leaves a float32-rounding difference — measured, ≤ −80 dB', async (t) => {
  const fx = rack([['cho', { mix: 0.3 }], ['conv', { mix: 0.4 }], ['cmp', { ratio: 1 }]]);
  const P = chain(fx), Pq = chain(fx, { qr: { convMax: 1 } });
  assert.notEqual(P.fxr.convMax, Pq.fxr.convMax, 'a quality step changes the compiled rack');
  assert.deepEqual(chain(fx).fxr, P.fxr);
  const id = P.fxr.needs[0], n = Math.round(0.3 * SR), r = mulberry32(fnv1a32('ir')), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const e = Math.exp(-i / (0.06 * SR)); L[i] = (2 * r() - 1) * e; R[i] = (2 * r() - 1) * e; }
  const SB = SC.D.global('SxBase');
  assert.ok(SB.storeAsset(id, irEntry(id, { rate: SR, ch: 2, len: n, L, R, hash: 'g2c' }, SR, convShapeOf(fx.racks[0].mods[1].p))));
  const g = g2(fx, 0, { sec: 1.5, tail: 1 });
  assert.ok(g.exact, `Convolve rack, the start at frame 0: ${dB(g.d / g.ref).toFixed(1)} dB`);
  assert.ok(g.off.c.rack.U.some(u => u.k === 19 && u.st === 1) && g.live.c.rack.U.some(u => u.k === 19 && u.st === 1), 'the Convolve ran');
  OUT.conv = sha(g.A);
  const h = g2(fx, 187 * Q, { sec: 1.5, tail: 1 }), v = dB(h.d / h.ref);
  t.diagnostic(`the Convolve rack after 0.5 s of zeros (aligned start): ${h.exact ? 'exact' : v.toFixed(1) + ' dB'} (its block clock n runs through the silence)`);
  assert.ok(h.exact || v <= -80, v);
  SB.dropAsset(id);
});

// (the Windows idle-DSP review #4: the rack's denormal sweep runs in a silence ≥ 1 s once idle(); its schedule must restart with
// each silence — a live MASTER's silent history before ▶ differs from the offline pre-roll's, so a carried-over schedule swept
// other quanta of the gap: ~10⁵ samples differed at ≈ −600 dBFS)
test('G2 (e) a 30 s silence inside the song: a Reverb alone and the 6-unit rack, live after a silent history ≡ offline bit for bit through the gap and after it (the denormal sweep\'s schedule restarts with each silence)', () => {
  const N1 = SR, NG = 30 * SR, N2 = SR / 2, a = program(N1, SR, 'gap a'), b = program(N2, SR, 'gap b');
  const sig = { L: new Float32Array(N1 + NG + N2), R: new Float32Array(N1 + NG + N2) };
  sig.L.set(a.L, 0); sig.R.set(a.R, 0); sig.L.set(b.L, N1 + NG); sig.R.set(b.R, N1 + NG);
  for (const [name, fx] of [['the Reverb', rack([['rev', { mix: 0.25, size: 0.3, decay: 0.3 }]])], ['RACK6', RACK6]]) for (const F of [187 * Q, 250 * Q]) {
    const r = g2(fx, F, { sig, tail: 2 });
    assert.ok(r.ref > 0.05, 'audible');
    let n = 0, first = -1;
    for (let i = 0; i < r.T; i++) if (!Object.is(r.A.L[i], r.B.L[F + i]) || !Object.is(r.A.R[i], r.B.R[F + i])) { n++; if (first < 0) first = i; }
    assert.equal(n, 0, `${name}, F ${F}: ${n} samples differ, the first at ${(first / SR).toFixed(3)} s (max |live − offline| ${r.d})`);
  }
});

test('G2 (d) pathLat() per unit type and mode = the delay of an impulse (dry at MIX 0: an exact delayed copy; wet: its peak) — Distortion S1 / S2 15, Limit compressors La (S1 / S2, two attacks), in series the sum, a splitter its longest branch, every other type 0; a fully bypassed rack 0', (t) => {
  const imp = (fx, amp = 0.01) => {
    const p = mk(SC, { offline: true, fxr: chain(fx).fxr, fxrT: chain(fx).fxrT }), x = new Float32Array(1024);
    x[256] = amp;
    const o = render(SC, p, 1024, feedAt({ L: x, R: x }, 0));
    let k = 0;
    for (let i = 0; i < 1024; i++) if (Math.abs(o.L[i]) > Math.abs(o.L[k])) k = i;
    return { lat: posted(p, 'mlat')[0].lat, rack: p.c.rack.pathLat(), at: k - 256, o, x };
  };
  const La = att => Math.round(10 * att * att * SR / 1000);
  const rec = {};
  const cases = [
    ['Distortion S2, MIX 0', [['dist', { mix: 0 }]], 15, true], ['Distortion S2, wet', [['dist', { mix: 1, drive: 0.1 }]], 15, false],
    ['Distortion S1, MIX 0', [['dist', { mix: 0 }, null, 1]], 15, true],
    ['Limit compressor S2, attack n 0.3', [['cmp', { ratio: 1, att: 0.3, mix: 1 }]], La(0.3), true],
    ['Limit compressor S2, attack n 0.7', [['cmp', { ratio: 1, att: 0.7, mix: 0 }]], La(0.7), true],
    ['Limit compressor S1', [['cmp', { ratio: 1, att: 0.5 }, null, 1]], La(0.5), true],
    ['compressor 4:1 (no look-ahead)', [['cmp', { ratio: 0.75, mix: 0 }]], 0, true],
    ['compressor multiband (Limit ratio)', [['cmp', { ratio: 1, mb: 1, mix: 0 }]], 0, false],
    ['Distortion → Limit → Distortion', [['dist', { mix: 0 }], ['cmp', { ratio: 1, att: 0.3 }], ['dist', { mix: 0 }]], 30 + La(0.3), true],
    ['split2: Distortion | Limit', [['split2', {}, [[['dist', { mix: 0 }]], [['cmp', { ratio: 1, att: 0.4 }]]]]], Math.max(15, La(0.4)), false],
    ['split3: Distortion + Distortion | — | Limit', [['split3', {}, [[['dist', { mix: 0 }], ['dist', { mix: 0 }]], [], [['cmp', { ratio: 1, att: 0.2 }]]]]], Math.max(30, La(0.2)), false],
    ['splitms: empty', [['splitms', {}, [[], []]]], 0, false],
  ];
  for (const [name, list, want, exact] of cases) {
    const fx = rack(list);
    assert.equal(fx.racks[0].mods[0].v, list[0][3] || 2, name + ': the variant');
    const r = imp(fx);
    rec[name] = [r.lat, r.at];
    assert.equal(r.lat, want, name + ': mlat');
    assert.equal(r.rack, want, name + ': pathLat()');
    assert.equal(r.at, want, name + ': the impulse\'s peak');
    if (exact) assert.equal(sameBits(r.x.subarray(0, 1024 - want), r.o.L, want), -1, name + ': an exact delayed copy');
  }
  for (const type of ['flg', 'phs', 'cho', 'dly', 'rev', 'eq', 'fil', 'hyper', 'bode', 'conv', 'util']) {
    const T = C.FXP_TAB[type][2] || C.FXP_TAB[type][1], p = T.some(x => x.pid === 'mix') ? { mix: 0 } : {};
    const r = imp(rack([[type, p]]));
    rec[type] = [r.lat, r.at];
    assert.equal(r.lat, 0, type); assert.equal(r.at, 0, type + ': its impulse at 0');
  }
  const byp = imp(rack([['dist', { mix: 0 }], ['cmp', { ratio: 1 }]], { byp: 1 }));
  assert.equal(byp.lat, 0); assert.equal(byp.at, 0, 'a fully bypassed rack passes its input');
  t.diagnostic('[mlat, impulse delay] ' + JSON.stringify(rec));
});

test('the start split: a start inside a quantum is applied at the first 4-frame point ≥ its frame − 0.5 (the Track\'s rule) — two rack calls, rack.transport() between; a stop clears a pending start; a re-anchor without seek re-seeds nothing; from a stop the meters restart there', () => {
  const p = mk(SC);
  p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
  const r = p.c.rack, calls = [];
  const pr = r.process.bind(r), tr = r.transport.bind(r), rs = p.M.restart.bind(p.M);
  r.process = (L, R, n) => { calls.push(['p', n]); return pr(L, R, n); };
  r.transport = () => { calls.push(['t']); return tr(); };
  p.M.restart = () => { calls.push(['m']); return rs(); };
  const sig = program(8 * Q), run = k => render(SC, p, k * Q, feedAt(sig, 0));
  run(2);
  for (const [dt, want] of [[61, 64], [64.4, 64], [3, 4], [4.4, 4], [0.4, 0], [-500, 0], [125, 128]]) {
    const frame = SC.ctx.currentFrame + dt;
    calls.length = 0;
    p.msg({ t: 'transport', play: false });
    p.msg({ t: 'transport', play: true, seek: true, frame, tick: 0, fpt: 25, loop: false });
    run(want === 128 ? 2 : 1);
    const exp = want === 0 ? [['t'], ['m'], ['p', 128]] : want === 128 ? [['p', 128], ['t'], ['m'], ['p', 128]] : [['p', want], ['t'], ['m'], ['p', 128 - want]];
    assert.deepEqual(calls, exp, 'start at ' + frame);
  }
  calls.length = 0;
  p.msg({ t: 'transport', play: true, seek: false, frame: SC.ctx.currentFrame + 20, tick: 0, fpt: 25 });
  run(1);
  assert.deepEqual(calls, [['p', 20], ['p', 108]], 're-anchor without seek: split, nothing re-seeded');
  calls.length = 0;
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame + 40, tick: 0, fpt: 25 });
  p.msg({ t: 'transport', play: false });
  run(1);
  assert.deepEqual(calls, [['p', 128]], 'a stop clears the pending start');
  calls.length = 0;
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame + 8, tick: 0, fpt: 25 });
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame + 12, tick: 0, fpt: 25 });
  run(1);
  assert.deepEqual(calls, [['p', 12], ['t'], ['m'], ['p', 116]], 'one pending slot: the later start replaces it');
  calls.length = 0;
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame + 8, tick: 0, fpt: 25 });
  run(1);
  assert.deepEqual(calls, [['p', 8], ['t'], ['p', 120]], 'a seek while playing re-seeds; the meters keep their integrated value');
});

test('stop: rack.reset(true) when the FXP says silence (the preference), not otherwise; panic: rack.reset(false) at once', () => {
  for (const silence of [1, 0]) {
    const p = mk(SC), c = chain(RACK6);
    c.fxr.silence = silence;
    p.msg(Object.assign({ t: 'chain' }, c));
    const r = p.c.rack, got = [];
    const rs = r.reset.bind(r);
    r.reset = soft => { got.push(soft); return rs(soft); };
    p.msg({ t: 'transport', play: false });
    assert.deepEqual(got, [], 'stopped already: nothing');
    p.msg({ t: 'transport', play: true, seek: true, frame: 0, tick: 0, fpt: 25 });
    render(SC, p, Q, feedAt(program(Q), 0));
    p.msg({ t: 'transport', play: false });
    p.msg({ t: 'panic' });
    assert.deepEqual(got, silence ? [true, false] : [false]);
  }
});

test('monitors: {t: mon, ids ⊆ [meters, mfx, mods]} — meters → mmon every ≥ 33 ms of audio ({m, s, i, lra, tp, tpMax, pk, pkMax, corr, lat}); mfx → smon {c: mfx, gr, fxph, ftap}; fxph → {v, c: mfx}; fxtap → the rack\'s tap; stats every 0.25 s {load, lat, per: [{id: mfx}]} (mods: tests/master-mods and the MM1 case below)', () => {
  const p = mk(SC);
  p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
  p.msg({ t: 'mon', ids: ['meters'] });
  assert.equal(posted(p, 'mmon').length, 1, 'at once');
  render(SC, p, SR, feedAt(program(SR), 0));
  const mm = posted(p, 'mmon');
  assert.ok(mm.length >= 28 && mm.length <= 31, mm.length + ' per second');
  assert.deepEqual(Object.keys(mm[5]).sort(), ['corr', 'i', 'lat', 'lra', 'm', 'pk', 'pkMax', 's', 't', 'tp', 'tpMax']);
  assert.ok(mm.at(-1).m > -40 && mm.at(-1).lat === p.c.rack.pathLat() && mm.at(-1).lat > 15);
  assert.equal(posted(p, 'smon').length, 0);
  p.msg({ t: 'mon', ids: ['mfx'] });
  p.msg({ t: 'fxtap', id: 'dly3' });
  assert.equal(p.c.rack.tapId, 'dly3');
  render(SC, p, SR / 4, feedAt(program(SR / 4), 0));
  const sm = posted(p, 'smon').at(-1);
  assert.equal(sm.c, 'mfx'); assert.ok(sm.gr && sm.fxph && sm.ftap && sm.ftap.length === 1024);
  p.msg({ t: 'fxph' });
  const ph = posted(p, 'fxph').at(-1);
  assert.equal(ph.c, 'mfx'); assert.ok(ph.v.length === 48 && Number.isFinite(ph.v[1]), 'the Flanger\'s phase');
  const st = posted(p, 'stats');
  assert.ok(st.length >= 4);
  const s = st.at(-1);
  assert.ok(Number.isFinite(s.load) && s.lat === p.lat && s.per.length === 1 && s.per[0].id === 'mfx' && Number.isFinite(s.per[0].load));
  p.msg({ t: 'mon', ids: [] });
  const n = p.port.msgs.length;
  render(SC, p, SR / 8, feedAt(program(SR / 8), 0));
  assert.equal(p.port.msgs.filter((m, i) => i >= n && (m.t === 'mmon' || m.t === 'smon')).length, 0, 'off: nothing');
});

test('fxover: the rack\'s 32 MB cap list posted once per change ({t: fxover, ids}); the store messages land in the scope\'s stores and every processor\'s rack hears of them (ALL): an IR arriving after the chain wakes MASTER\'s Convolve; bye leaves ALL and goes silent', () => {
  const p = mk(SC);
  p.c.rack.over = ['big1']; p.over(); p.over();
  assert.deepEqual(J(posted(p, 'fxover').map(m => m.ids)), [['big1']]);
  p.c.rack.over = []; p.over();
  const fx = rack([['conv', { mix: 1 }]]), P = chain(fx), id = P.fxr.needs[0];
  const q = mk(SC);
  q.msg(Object.assign({ t: 'chain' }, P));
  const sig = program(SR / 2), a = render(SC, q, Q * 8, feedAt(sig, 0));
  assert.equal(sameBits(sig.L.subarray(0, Q * 8), a.L), -1, 'no IR: the Convolve passes its input');
  const n = Math.round(0.2 * SR), r = mulberry32(fnv1a32('ir2')), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (2 * r() - 1) * Math.exp(-i / (0.03 * SR));
  const track = new SC.Track({ processorOptions: { offline: true } });
  let heard = 0;
  const as = track.assets.bind(track);
  track.assets = () => { heard++; return as(); };
  q.msg(Object.assign({ t: 'smp' }, irEntry(id, { rate: SR, ch: 1, len: n, L, R: null, hash: 'smp' }, SR, convShapeOf(fx.racks[0].mods[0].p))));
  assert.ok(SC.D.global('SxBase').assets.has(id), 'stored');
  assert.equal(heard, 1, 'every processor of the scope hears of it');
  const b = render(SC, q, SR / 4, feedAt(sig, 0));
  assert.notEqual(sameBits(sig.L.subarray(0, SR / 4), b.L), -1, 'the IR adopted: the Convolve sounds');
  q.msg({ t: 'smpdel', id });
  assert.ok(!SC.D.global('SxBase').assets.has(id));
  q.msg({ t: 'bye' });
  heard = 0;
  const qa = q.assets.bind(q);
  let qh = 0;
  q.assets = () => { qh++; return qa(); };
  p.msg({ t: 'smpdel', id: 'nothing' });
  assert.equal(qh, 0, 'out of ALL'); assert.equal(heard, 1);
  const oL = new Float32Array(Q).fill(1), oR = new Float32Array(Q).fill(1);
  assert.equal(q.process([[sig.L.subarray(0, Q), sig.R.subarray(0, Q)]], [[oL, oR]]), false);
  assert.ok(oL.every(x => x === 0) && oR.every(x => x === 0));
  track.msg({ t: 'bye' });
});

test('A/B: {t: bypass} crossfades in 5 ms to the input delayed by pathLat() (time-aligned: then an exact delayed copy at 0 dB), the rack running throughout; back the same way; answered {t: ab, on, g}', () => {
  const fx = rack([['dist', { mix: 0.7, drive: 0.6 }], ['cmp', { ratio: 1, att: 0.3 }], ['cho', { mix: 0.5 }]]);
  const p = mk(SC), sig = program(SR);
  p.msg(Object.assign({ t: 'chain' }, chain(fx)));
  const at = 100 * Q, fade = Math.ceil(0.005 * SR) + 2;
  const o = render(SC, p, SR, feedAt(sig, 0), k => { if (k === at) p.msg({ t: 'bypass', on: true, g: 0 }); });
  const lat = p.lat;
  assert.equal(lat, 15 + Math.round(10 * 0.09 * SR / 1000));
  assert.deepEqual(J(posted(p, 'ab').map(m => [m.on, m.g])), [[true, 0]]);
  assert.equal(sameBits(sig.L.subarray(at + fade - lat, SR - lat), o.L.subarray(at + fade), 0), -1, 'after the fade: the input delayed by ' + lat);
  assert.notEqual(sameBits(sig.L.subarray(at - 512 - lat, at - lat), o.L.subarray(at - 512, at)), -1, 'before: the rack');
  let mid = 0;
  for (let j = 1; j < fade; j++) mid = Math.max(mid, Math.abs(o.L[at + j] - o.L[at + j - 1]));
  assert.ok(mid < 0.2, 'no step in the fade: ' + mid);
  assert.ok(p.c.rack.nAct > 0, 'the rack kept running');
  p.msg({ t: 'bypass', on: false, g: 0 });
  assert.deepEqual(J(posted(p, 'ab').at(-1)), { t: 'ab', on: false, g: 0, lim: false });
  render(SC, p, 2 * fade, feedAt(sig, 0));
  assert.equal(p.abx, 0);
});

test('Q3: the level match — at the tap the gain S_out − S_in (short-term, the moment of the tap) is frozen on the bypassed signal (the bypass then reads the processed level); below −70 LUFS pending at 0 dB (R1-4, below); ±24 dB; a number is taken as given', () => {
  const fx = rack([['util', { level: 0.75 }]]);                      // × 2.25: +7.04 dB
  const p = mk(SC), sig = program(8 * SR);
  p.msg(Object.assign({ t: 'chain' }, chain(fx)));
  p.msg({ t: 'transport', play: true, seek: true, frame: 0, tick: 0, fpt: 25 });
  render(SC, p, 4 * SR, feedAt(sig, 0));
  const before = p.M.short();
  p.msg({ t: 'bypass', on: true, g: true });
  const g = posted(p, 'ab').at(-1).g;
  assert.ok(Math.abs(g - 20 * Math.log10(2.25)) < 0.05, 'matched gain ' + g);
  assert.ok(Math.abs(p.abG - Math.pow(10, g / 20)) < 1e-12);
  render(SC, p, 4 * SR, feedAt(sig, -4 * SR));
  assert.ok(Math.abs(p.M.short() - before) < 0.6, `bypassed at the processed level: ${p.M.short()} vs ${before}`);
  p.msg({ t: 'bypass', on: true, g: true });
  assert.equal(posted(p, 'ab').at(-1).g, g, 'a repeated on keeps the frozen gain');
  p.msg({ t: 'bypass', on: false, g: true });
  const q = mk(SC);
  q.msg(Object.assign({ t: 'chain' }, chain(fx)));
  render(SC, q, SR, () => []);
  q.msg({ t: 'bypass', on: true, g: true });
  assert.equal(posted(q, 'ab').at(-1).g, null, 'silence: pending (R1-4)');
  assert.equal(q.abG, 1, 'pending: 0 dB meanwhile');
  q.msg({ t: 'bypass', on: false }); q.msg({ t: 'bypass', on: true, g: 40 });
  assert.equal(posted(q, 'ab').at(-1).g, 24);
  q.msg({ t: 'bypass', on: false }); q.msg({ t: 'bypass', on: true, g: -3 });
  assert.equal(posted(q, 'ab').at(-1).g, -3);
  q.msg({ t: 'bypass', on: false }); q.msg({ t: 'bypass', on: true });
  assert.equal(posted(q, 'ab').at(-1).g, 0, 'plain');
});

test('offline: mlat from the constructor (pathLat after the options\' set), mfinal once output frame lat + frames is reached — the meters over [lat, lat + frames) only', () => {
  const fx = rack([['cmp', { ratio: 1, att: 0.5 }], ['dist', { mix: 0.5, drive: 0.5 }]]), P = chain(fx), sig = program(2 * SR);
  const frames = 2 * SR - 1000;
  const p = mk(SC, { offline: true, fxr: P.fxr, fxrT: P.fxrT, transport: { play: true, frame: 0, tick: 0, fpt: 25, loop: false }, frames });
  const lat = posted(p, 'mlat')[0].lat;
  assert.equal(lat, 15 + Math.round(10 * 0.25 * SR / 1000));
  const o = render(SC, p, 2 * SR + Q * 4, feedAt(sig, 0));
  const fin = posted(p, 'mfinal');
  assert.equal(fin.length, 1);
  const M = new (SC.D.global('MASTERDSP').Meters)(SR);
  M.push(o.L, o.R, frames, lat);
  const s = M.summary();
  assert.deepEqual([fin[0].i, fin[0].tpMax, fin[0].pk, fin[0].lra], [s.i, s.tpMax, s.pkMax, s.lra]);
  assert.ok(fin[0].i > -30 && fin[0].i < -5);
  OUT.offline = sha(o);
});

test('no allocation per quantum: an empty rack with the meters, the 6-unit rack, an A/B crossfade, a split start (monitors off, between two stats posts)', () => {
  const p = mk(SC), sig = program(SR), inp = feedAt(sig, 0), out = [[new Float32Array(Q), new Float32Array(Q)]];
  const go = (k, f) => { for (let i = 0; i < k; i++) { if (f) f(i); p.process(inp(i * Q), out); SC.ctx.currentFrame += Q; } };
  go(10);
  p.statN = 0;
  noAlloc(SC.D, () => go(80));
  p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
  go(10);
  p.statN = 0;
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame + 300, tick: 0, fpt: 25 });
  p.ab = 1;
  noAlloc(SC.D, () => go(80, i => { if (i === 40) p.ab = 0; }));
  assert.equal(p.play, true);
});

test('G4: the warm-up\'s first 32 quanta after construction (live, the app\'s order: MASTER, then a track — its warm-up warms the rack\'s classes —, an empty rack, then a first non-empty chain) each well within a quantum (jsc: tests/bench.json "master")', (t) => {
  const S = scope(), Q_MS = Q / SR * 1000, sig = program(64 * Q), inp = feedAt(sig, 0), out = [[new Float32Array(Q), new Float32Array(Q)]];
  const p = mk(S), times = [];
  new S.Track({ processorOptions: { os: 4, hostOS: 4, trackId: 't1' } });
  const step = k => { const t0 = performance.now(); p.process(inp(k * Q), out); times.push(performance.now() - t0); S.ctx.currentFrame += Q; };
  for (let k = 0; k < 32; k++) step(k);
  p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
  for (let k = 32; k < 64; k++) step(k);
  const w1 = Math.max(...times.slice(0, 32)), w2 = Math.max(...times.slice(32));
  t.diagnostic(`node: first 32 quanta worst ${w1.toFixed(3)} ms, after the first chain worst ${w2.toFixed(3)} ms (a quantum ${Q_MS.toFixed(2)} ms)`);
  assert.ok(w1 < Q_MS && w2 < Q_MS);
});

// IMPL-MM §6.2 (MM1): no master modulator = today — the messages that build no ModCore leave the audio path byte for byte; a 'mods'
// monitor id without a ModCore posts nothing (no mc message, no mo on the rack's smon, the shape unchanged); FXRack.modsJump() on a
// rack without mods is a no-op bit for bit (golden-fx proves no Track calls it)
test('MM1 (IMPL-MM §6.2): {t: mods, off: true}, an empty payload, a payload with no rows and a stray mval build no ModCore — mc stays null and the output ≡ the no-message run bit for bit; {t: mon, ids: [mods]} without a ModCore posts nothing; beside mfx the rack\'s smon keeps its shape (no mo); FXRack.modsJump() on a rack without mods is a no-op bit for bit', () => {
  const sig = program(SR), runs = [];
  for (const mode of ['none', 'msgs', 'jump']) {
    const p = mk(SC);
    p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
    if (mode === 'msgs') p.msg({ t: 'mon', ids: ['mods'] });
    const n0 = p.port.msgs.length;
    const out = render(SC, p, SR, feedAt(sig, 0), o => {
      if (mode === 'msgs') {
        if (o === 10 * Q) p.msg({ t: 'mods', i: 'master', off: true });
        if (o === 20 * Q) p.msg({ t: 'mods', i: 'master' });
        if (o === 30 * Q) p.msg({ t: 'mods', i: 'master', key: 'k0', cp: { ver: 2 }, rows: [], ext: [], vals: [] });
        if (o === 40 * Q) p.msg({ t: 'mval', k: 0, v: 1 });
      }
      if (mode === 'jump') p.c.rack.modsJump();
    });
    assert.equal(p.mc, null, mode + ': no ModCore'); assert.equal(p.c.mcOn, 0); assert.equal(p.snap, 0);
    if (mode === 'msgs') assert.equal(p.port.msgs.slice(n0).filter(m => m.t === 'smon' || m.t === 'modsErr').length, 0, 'no mc post, no modsErr');
    runs.push(out);
  }
  assert.ok(peak(runs[0].L) > 0.05);
  for (const k of [1, 2]) { assert.equal(sameBits(runs[0].L, runs[k].L), -1, k + ' L'); assert.equal(sameBits(runs[0].R, runs[k].R), -1, k + ' R'); }
  const p = mk(SC);
  p.msg(Object.assign({ t: 'chain' }, chain(RACK6)));
  p.msg({ t: 'mon', ids: ['mfx', 'mods'] });
  render(SC, p, SR / 4, feedAt(program(SR / 4), 0));
  const sm = posted(p, 'smon');
  assert.ok(sm.length >= 6 && sm.length <= 9, sm.length + ' smon per quarter second');
  for (const m of sm) assert.deepEqual(Object.keys(m).sort(), ['c', 'ftap', 'fxph', 'gr', 't']);
});

test('G4 node gates: the bench rows master-empty, master-meters, master-rack5, master-mods ≤ 1.5 × their targets (calibrated); master-mods-d — the ModCore\'s cost on MASTER, rack5 + mods minus rack5 interleaved per block in one process (IMPL-MM §6.3 (b)) — ≤ 1.5 × its target', async (t) => {
  const rows = scenarios().filter(s => s.kind === 'master');
  assert.deepEqual(rows.map(s => s.id), ['master-empty', 'master-meters', 'master-rack5', 'master-mods', 'master-mods-d']);
  let k = 1;
  for (const s of rows) {
    const target = CPU.BENCH.targets[s.id];
    assert.ok(target && target.node === s.node && target.jsc === s.jsc && target.ipad === s.ipad, s.id + ': bench.json targets');
    if (s.base) continue;                                          // (the delta row: below)
    const S = scope({ meters: s.meters !== false }), B = s.build(), p = mk(S);
    if (B.fxp) p.msg({ t: 'chain', fxr: B.fxp, fxrT: B.fxt });
    if (B.mods) p.msg(B.mods);
    assert.equal(p.c.rack.U.length, s.id === 'master-rack5' || s.id === 'master-mods' ? 5 : 0, s.id + ': its rack');
    assert.equal(p.mc !== null, s.id === 'master-mods', s.id + ': its ModCore');
    if (p.mc !== null) assert.deepEqual([p.mc.rows.length, p.mc.shim.bpm, p.mc.fxKey.mfx === p.c.rack.key], [8, 140, true], 'the payload: 8 fx rows at 140 BPM on the rack\'s layout key');
    const out = [[new Float32Array(Q), new Float32Array(Q)]], inp = masterInput();
    const sec = () => { for (let q = 0; q < SR / Q; q++) { p.process(inp(), out); S.ctx.currentFrame += Q; } };
    const best = await CPU.gateLoad(sec, s.node);
    if (s.id === 'master-rack5') k = best.k;
    t.diagnostic(`${s.id}: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt}) — target ${s.node}`);
    assert.ok(best.load <= 1.5 * s.node, `${s.id}: ${best.load} > 1.5 × ${s.node}`);
  }
  // the delta: bench-scenarios' measure() alternates the row and its base per 1 s block in one process (the median of the per-pair
  // differences — P3-5: a difference of two separately measured rows cannot resolve 0.004), calibrated by rack5's k
  const d = rows.find(s => s.id === 'master-mods-d'), S = scope();
  const env = { mk: po => new S.Track({ processorOptions: po }), advance: n => { S.ctx.currentFrame += n; }, FXDSP: S.D.global('FXDSP'), SxBase: S.D.global('SxBase'), mkMaster: po => mk(S, po) };
  let best = null;
  for (let a = 1; a <= 3; a++) {
    const r = measure(d, env, { runs: 9 }), load = r.load * k;
    if (!best || load < best.load) best = { load, raw: r.load, attempt: a };
    if (best.load <= 1.5 * d.node) break;
  }
  t.diagnostic(`master-mods-d: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, k ${k.toFixed(3)}, attempt ${best.attempt}) — target ${d.node}`);
  assert.ok(best.load <= 1.5 * d.node, `master-mods-d: ${best.load} > 1.5 × ${d.node}`);
});

/* ------------------------------------------------------------------ stage M review 1 (R1-1, R1-2, R1-4) */
const factory = name => {                                          // a factory rack on MAIN
  const fx = C.defaultFx2();
  fx.racks[0] = Object.assign({}, fx.racks[0], J(C.FACTORY_RACKS.find(R => R.name === name).rack));
  return C.normalizeFx2(fx);
};

test('R1-1 (M2): a Bode with BLUR on the master (factory Shimmer Hall) — live after a silent history ≡ offline bit for bit: never heard audio (0.5 s of zeros), and after playing, a stop (silence tails) and 0.6 s of zeros', () => {
  const fx = factory('Shimmer Hall'), bad = [];
  assert.ok(fx.racks[0].mods.some(I => I.type === 'bode' && I.p.blur > 0 && I.p.feed > 0));
  for (const [F, heard] of [[187 * Q, 0], [Math.round(3.6 * SR / Q) * Q, 3]]) {
    const r = g2(fx, F, { heard });
    assert.ok(r.ref > 0.05, 'audible');
    if (!r.exact) bad.push(`heard ${heard} s, F ${F}: max |live − offline| ${dB(r.d / r.ref).toFixed(1)} dB re peak`);
  }
  assert.deepEqual(bad, []);
});

test('R1-2 (M2): fresh-rack transients (a splitter\'s band-alignment glide from 0, a RATIO compressor\'s attack-free first block) are over before frame 0 — the offline MASTER plays its pre-roll of exact zeros first; live after a silent history (never heard audio · played, then ■ with silence tails) ≡ offline bit for bit; played on into 0.6 s of zeros (no ■) measured', (t) => {
  const P1 = { thr: 0.631, ratio: 0.578, att: 0.404, rel: 0.918, gain: 0.745, mix: 0.944 };   // −26 dBFS, 2.37:1, 163 ms, 843 ms
  const cases = [
    ['split3 [—, Limit compressor, —]', rack([['split3', {}, [[], [['cmp', { ratio: 1, att: 0.4 }]], []]]])],
    ['split2 [—, Distortion]', rack([['split2', {}, [[], [['dist', { drive: 0.3 }]]]]])],
    ['compressor S2, RATIO', rack([['cmp', P1]])],
    ['compressor S1, RATIO', rack([['cmp', P1, null, 1]])],
    ['factory Band Split Drive', factory('Band Split Drive')],
    ['factory Parallel Crush', factory('Parallel Crush')],
  ];
  const Fh = Math.round(3.6 * SR / Q) * Q, bad = [], rec = {};
  for (const [name, fx] of cases) {
    for (const [F, heard, stop] of [[187 * Q, 0, true], [Fh, 3, true], [Fh, 3, false]]) {
      const r = g2(fx, F, { heard, stop });
      assert.ok(r.ref > 0.05, name + ': audible');
      if (!stop) { rec[name] = r.exact ? 'exact' : +dB(r.d / r.ref).toFixed(1); continue; }   // (not a silent history: measured)
      if (!r.exact) {
        let k = 0;
        while (Object.is(r.A.L[k], r.B.L[F + k]) && Object.is(r.A.R[k], r.B.R[F + k])) k++;
        bad.push(`${name}, heard ${heard} s: from frame ${k}, max ${dB(r.d / r.ref).toFixed(1)} dB re peak`);
      }
    }
  }
  assert.deepEqual(bad, []);
  // played on into the zeros (no ■, e.g. silence tails off): the states that really decay are still decaying — a
  // compressor's release (843 ms here: still compressing 0.6 s later), crossover residues far below 1e-6
  t.diagnostic('played on, 0.6 s of zeros, then a seek (dB re peak): ' + JSON.stringify(rec));
});

test('R1-2: the pre-roll\'s length — rack.settleN(): ≥ 0.3 s, ≥ the slowest splitter alignment glide + 10 ms, whole Convolve periods (12288 frames); the offline MASTER\'s splitters stand aligned at frame 0 (192 kHz: two Limit compressors in a branch, 1.28 s); live MASTERs and offline ones without a rack play none', () => {
  const lim2 = rack([['split3', {}, [[], [['cmp', { ratio: 1, att: 1 }], ['cmp', { ratio: 1, att: 1 }]], []]]]);
  const got = [];
  for (const [sr, fx] of [[SR, RACK6], [SR, C.defaultFx2()], [44100, RACK6], [96000, RACK6], [192000, RACK6], [192000, lim2]]) {
    const S = sr === SR ? SC : scope({ sr }), P = chain(fx, { sr }), p = mk(S, { offline: true, fxr: P.fxr, fxrT: P.fxrT, frames: 128 });
    const r = p.c.rack, N = r.settleN();
    got.push(N);
    assert.ok(N % 12288 === 0 && N >= 0.3 * sr, sr + ': ' + N);
    for (const u of r.U) if (u.k === 21) {
      assert.ok(N >= u.mod.lcap / u.mod.gr + 0.01 * sr, 'the glide fits');
      assert.deepEqual(J(Array.from(u.mod.dd)), J(Array.from(u.mod.dt)), sr + ': aligned before frame 0');
      assert.ok(Math.max(...u.mod.dt) >= 0.02 * sr, 'a long alignment (two 10 ms look-aheads)');
    }
  }
  assert.deepEqual(got, [24576, 24576, 24576, 36864, 61440, 258048]);
  const live = mk(SC);
  live.msg(Object.assign({ t: 'chain' }, chain(rack([['split2', {}, [[], [['cmp', { ratio: 1, att: 1 }]]]]]))));
  assert.deepEqual(J(Array.from(live.c.rack.U[0].mod.dd)), [0, 0, 0], 'live: no pre-roll (its rack hears real time)');
  assert.equal(mk(SC, { offline: true, frames: 128 }).c.rack.fresh, 1, 'offline without a rack (a project with no master): untouched');
});

test('R1-4 (Q3): an A/B tapped while nothing plays (or restored at power-on) is pending — {t: ab, on, g: null}, 0 dB — until the rack\'s output and the input (measured from the tap on) have both read above −70 LUFS for 3 s, then the match freezes (S_out − S_in, ±24 dB), is answered {t: ab, on: true, g} and glides in over 5 ms; a repeated on keeps it pending; off clears it; an empty rack\'s match is exactly 0 dB (and its output the input)', () => {
  const fx = rack([['util', { level: 1 }]]), G = 20 * Math.log10(4);   // × 4: +12.04 dB
  const raw = program(5 * SR), sig = { L: raw.L.map(v => v / 8), R: raw.R.map(v => v / 8) }, lastAb = p => J(posted(p, 'ab').at(-1));
  assert.ok(4 * Math.max(peak(sig.L), peak(sig.R)) < Math.pow(10, -1 / 20), '+12 dB stays under −1 dBFS (F1\'s cap does not bind)');
  // a fresh MASTER (power-on restore) and one stopped after silence
  for (const pre of [0, SR / 2]) {
    const p = mk(SC);
    p.msg(Object.assign({ t: 'chain' }, chain(fx)));
    if (pre) render(SC, p, pre, () => []);
    p.msg({ t: 'bypass', on: true, g: true });
    assert.deepEqual(lastAb(p), { t: 'ab', on: true, g: null, lim: false }, 'pending');
    p.msg({ t: 'bypass', on: true, g: true });
    assert.deepEqual(lastAb(p), { t: 'ab', on: true, g: null, lim: false }, 'a repeated on: still pending');
    render(SC, p, SR / 4, () => []);
    assert.equal(posted(p, 'ab').length, 2, 'silence: nothing frozen');
    p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame, tick: 0, fpt: 25 });
    let fr = -1;
    const o = render(SC, p, 4 * SR, feedAt(sig, 0), k => { if (fr < 0 && posted(p, 'ab').length === 3) fr = k; });
    const ab = posted(p, 'ab');
    assert.equal(ab.length, 3, 'frozen once');
    assert.ok(ab[2].on === true && Math.abs(ab[2].g - G) < 1e-9 && p.abDb === ab[2].g, 'matched: ' + ab[2].g);
    assert.ok(fr > 3 * SR && fr <= 3.2 * SR, 'after 3 s of valid short-term values: ' + fr);
    // before the freeze the bypassed signal (the input: the Utility has no delay) at 0 dB; after the 5 ms glide × the gain
    const g = Math.pow(10, ab[2].g / 20), f0 = fr - Q;
    assert.equal(sameBits(sig.L.subarray(0, f0), o.L), -1, 'pending: 0 dB');
    for (let i = fr + 241; i < 4 * SR; i += 97) assert.equal(o.L[i], Math.fround(sig.L[i] * g), 'matched at ' + i);
    let st = 0;
    for (let i = f0 + 1; i < fr + 241; i++) st = Math.max(st, Math.abs(o.L[i] / (sig.L[i] || 1) - o.L[i - 1] / (sig.L[i - 1] || 1)) * (Math.abs(sig.L[i]) > 1e-3 && Math.abs(sig.L[i - 1]) > 1e-3 ? 1 : 0));
    assert.ok(st < 0.05, 'the gain glides (largest step of the ratio ' + st + ')');
    p.msg({ t: 'bypass', on: false, g: true });
    assert.deepEqual(lastAb(p), { t: 'ab', on: false, g: ab[2].g, lim: false });
  }
  // off clears a pending match: nothing frozen afterwards
  const q = mk(SC);
  q.msg(Object.assign({ t: 'chain' }, chain(fx)));
  q.msg({ t: 'bypass', on: true, g: true });
  q.msg({ t: 'bypass', on: false, g: true });
  assert.deepEqual(lastAb(q), { t: 'ab', on: false, g: null, lim: false });
  render(SC, q, SR, feedAt(sig, 0));
  assert.equal(posted(q, 'ab').length, 2);
  // an empty rack (none, or the default empty FX state): pending at silence, then exactly 0 dB; the output stays the input
  for (const fx0 of [null, C.defaultFx2()]) {
    const e = mk(SC);
    if (fx0) e.msg(Object.assign({ t: 'chain' }, chain(fx0)));
    render(SC, e, SR / 4, () => []);
    e.msg({ t: 'bypass', on: true, g: true });
    assert.equal(lastAb(e).g, null);
    const out = render(SC, e, 4 * SR, feedAt(sig, 0));
    assert.ok(Object.is(lastAb(e).g, 0) && posted(e, 'ab').length === 2, 'exactly 0 dB');
    assert.equal(sameBits(sig.L.subarray(0, 4 * SR), out.L), -1); assert.equal(sameBits(sig.R.subarray(0, 4 * SR), out.R), -1);
  }
  // no allocation while pending (the Po / Pi pair) and while the gain glides
  const z = mk(SC), inp = feedAt(sig, 0), o1 = [[new Float32Array(Q), new Float32Array(Q)]];
  z.msg(Object.assign({ t: 'chain' }, chain(fx)));
  z.msg({ t: 'bypass', on: true, g: true });
  for (let k = 0; k < 10; k++) { z.process(inp(k * Q), o1); SC.ctx.currentFrame += Q; }
  z.statN = 0; z.abG0 = 0.5; z.aby = 0;
  noAlloc(SC.D, () => { for (let k = 10; k < 80; k++) { z.process(inp(k * Q), o1); SC.ctx.currentFrame += Q; } });
  assert.ok(z.abP === 1 && z.aby === 1);
});

test('review 2 F1 (Q3): the level match never boosts the bypassed signal past −1 dBFS — a boost is capped by the input\'s sample peak over the last 3 s (answered lim: true; at the tap and when a pending match freezes); cuts are never capped; an empty rack stays exactly 0 dB', () => {
  const raw = program(12 * SR, SR, 'f1'), k = Math.pow(10, -1 / 20) / Math.max(peak(raw.L), peak(raw.R));
  const sig = { L: raw.L.map(v => v * k), R: raw.R.map(v => v * k) };   // input peak −1 dBFS
  const LIM = rack([['cmp', { ratio: 1, thr: 0.2, gain: 0.154, att: 0.5 }]]), CUT = rack([['util', { level: 0.25 }]]);
  const res = {};
  for (const [name, fx, pre] of [['limiter, at the tap', LIM, 0], ['limiter, pending', LIM, 1], ['cut', CUT, 0], ['empty', C.defaultFx2(), 0]]) {
    const p = mk(SC);
    p.msg(Object.assign({ t: 'chain' }, chain(fx)));
    p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame, tick: 0, fpt: 25 });
    if (pre) p.msg({ t: 'bypass', on: true, g: true });
    const a = render(SC, p, 4 * SR, feedAt(sig, 0));
    const so = p.M.short(), si = p.Mi.short();
    if (!pre) p.msg({ t: 'bypass', on: true, g: true });
    const b = render(SC, p, 4 * SR, feedAt(sig, -4 * SR)), ab = J(posted(p, 'ab').at(-1));
    res[name] = { match: +(so - si).toFixed(2), g: +ab.g.toFixed(2), lim: ab.lim, A: +dB(Math.max(peak(a.L.subarray(SR)), peak(a.R.subarray(SR)))).toFixed(2), B: +dB(Math.max(peak(b.L.subarray(SR)), peak(b.R.subarray(SR)))).toFixed(2) };
  }
  const L1 = res['limiter, at the tap'], L2 = res['limiter, pending'];
  assert.ok(L1.match >= 3 && L1.A <= 0, 'the rack makes it louder (≥ 3 LU), A unclipped: ' + JSON.stringify(L1));
  for (const r of [L1, L2]) {                                       // (pending: MASTER's output meter read B — L1's match)
    assert.ok(r.lim === true && r.g < L1.match - 0.5, 'capped: ' + JSON.stringify(r));
    assert.ok(r.B <= 0, 'B never over full scale: ' + JSON.stringify(r));
  }
  assert.ok(res.cut.lim === false && Math.abs(res.cut.g + 12.04) < 0.01, 'a cut is never capped: ' + JSON.stringify(res.cut));
  assert.ok(res.empty.lim === false && Object.is(res.empty.g, 0), 'an empty rack: exactly 0 dB');
});

test('review 2 F4: the integrated loudness and LRA accumulate only while the transport plays — ■ freezes them (a decaying tail after it changes neither); M / S / TP / correlation stay live; ▶ from the stop restarts them; with no transport since the last reset (jamming: power-on, the OUT\'s reset tap) they integrate as before', () => {
  // 1 kHz stereo: −23 dBFS for 2.5 s, −18 for 2.5 s; after ■ a tail from −18 dBFS falling 20 dB/s
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
  const tone =(lv, F0) => { const a = new Float32Array(Q); return o => { for (let i = 0; i < Q; i++) { const k = F0 + o + i; a[i] = Math.pow(10, lv(k / SR) / 20) * Math.sin(2 * Math.PI * 1000 * k / SR); } return [[a, a]]; }; };
  const p = mk(SC);
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame, tick: 0, fpt: 25 });
  render(SC, p, 5 * SR, tone(t => (t < 2.5 ? -23 : -18), 0));
  const I0 = p.M.integrated(), R0 = p.M.lra(), S0 = p.M.short();
  assert.ok(I0 > -22 && I0 < -19 && R0 > 1 && R0 < 6, `a programme: I ${I0}, LRA ${R0}`);
  p.msg({ t: 'transport', play: false });
  render(SC, p, 2 * SR, tone(t => -18 - 20 * t, 0));
  p.M.summary();
  render(SC, p, 2 * SR, tone(t => -58 - 20 * t, 2 * SR));
  const I1 = p.M.integrated(), R1 = p.M.lra(), S1 = p.M.short();
  assert.ok(Object.is(I1, I0) && Object.is(R1, R0), `■ freezes I / LRA: I ${I0} → ${I1}, LRA ${R0} → ${R1}`);
  assert.ok(S1 < S0 - 20, 'S stays live: ' + S1);
  const s = p.M.summary();
  assert.ok(s.tpMax > -19 && s.tp[0] < -55 && s.tp[0] > -60 && s.corr > 0.99, 'TP / correlation live: ' + JSON.stringify(J(s)));
  // ▶ from the stop: restarted, integrating again
  p.msg({ t: 'transport', play: true, seek: true, frame: SC.ctx.currentFrame, tick: 0, fpt: 25 });
  render(SC, p, 2 * SR, tone(() => -30, 0));
  near(p.M.integrated(), -30, 0.1, '▶: I restarted');
  // ■, the OUT's reset tap, then a keyboard jam (no transport): integrated as before; so is a fresh MASTER's
  p.msg({ t: 'transport', play: false });
  p.msg({ t: 'mreset' });
  render(SC, p, 2 * SR, tone(() => -26, 0));
  near(p.M.integrated(), -26, 0.1, 'reset tap, then a jam');
  const q = mk(SC);
  render(SC, q, 2 * SR, tone(() => -26, 0));
  near(q.M.integrated(), -26, 0.1, 'power-on, a jam');
});

test('ref-M: MASTER\'s outputs for a fixed input + rack set (frozen at acceptance; GOLDEN_FREEZE_M=1 writes them)', (t) => {
  const REF = new URL('./ref-M/', import.meta.url), file = new URL('master-out.json', REF);
  assert.deepEqual(Object.keys(OUT).sort(), ['conv', 'offline', 'rack6']);
  if (process.env.GOLDEN_FREEZE_M === '1') {
    mkdirSync(REF, { recursive: true });
    let commit = '';
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
    writeFileSync(file, JSON.stringify({ note: 'Frozen master sound (IMPL-M §7): sha256 of MASTER\'s float32 L / R for tests/master-proc.test.mjs\'s program through the 6-unit rack (G2), the Convolve rack (G2 c) and the offline window case, at the stage M acceptance commit. Never edit: the test compares them exactly.', commit, out: OUT }, null, 1) + '\n');
  }
  if (!existsSync(file)) { t.diagnostic('tests/ref-M/master-out.json missing: NOT FROZEN YET (the lead freezes at acceptance: GOLDEN_FREEZE_M=1)'); return; }
  assert.deepEqual(OUT, JSON.parse(readFileSync(file, 'utf8')).out);
});
