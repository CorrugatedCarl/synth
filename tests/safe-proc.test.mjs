import './v8-guard.mjs';
// The safety limiter 'synth-safe' (engine.js, beside 'synth-master'): the last stage before the browser's output — the engine's own
// Limiter (−1 dBFS, 1 ms look-ahead, 120 ms release) then a clamp at its threshold. In a node:vm worklet scope with the whole DSP list
// and engine.js (ports that record what they post; processors captured by name). Below −1 dBFS its gain is exactly 1: the output is
// the input delayed by lat = L − 1 frames, bit for bit, at every device rate (L·(1/L) = 1 there); above, no sample passes −1 dBFS and
// the copy is exact again once the release has settled; while it reduces gain it posts {t: 'safe', gr} (dB over −1 dBFS of the
// window's loudest sample) every ≥ 0.1 s of audio; off ({on: false} / {t: 'on', v: false}) it is the input itself, no delay — the
// limiter keeps running, a 5 ms crossfade at each change; no allocation per quantum; bye.
// Run: node --max-old-space-size=2048 --test tests/safe-proc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';

const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
const Q = 128, THR = Math.pow(10, -1 / 20), THR32 = Math.fround(THR);
const RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
const latOf = sr => Math.max(4, Math.round(sr * 0.001)) - 1;

// one worklet scope (the rate is the scope's `sampleRate`, set before each construction); every registration recorded in order
function scope() {
  const D = dspScope({ fast: true, console: quiet });
  D.run('(function () { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { this.port = { msgs: [], postMessage(m) { this.msgs.push(m); }, onmessage: null }; } };'
    + ' globalThis.__reg = []; globalThis.registerProcessor = function registerProcessor(n, c) { globalThis.__reg.push([n, c]); }; })()', 'safe-worklet.js');
  D.run(source('engine.js'), 'engine.js');
  const reg = D.run('globalThis.__reg', 'reg.js'), by = {};
  for (const [n, c] of reg) by[n] = c;
  return { D, ctx: D.ctx, names: reg.map(e => e[0]), Safe: by['synth-safe'] };
}
const S = scope();
const mk = (sr, po) => { S.ctx.sampleRate = sr; S.ctx.currentFrame = 0; return new S.Safe(po === undefined ? {} : { processorOptions: po }); };
const msgs = (p, t) => Array.from(p.port.msgs).filter(m => !t || m.t === t).map(m => JSON.parse(JSON.stringify(m)));

// a deterministic stereo program of N frames whose loudest sample is `peak` (Float32): tones, noise bursts, exact zeros and −0
function program(N, sr, peak, seed = 'safe') {
  const r = mulberry32(fnv1a32(seed)), L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr, k = Math.floor(t / 0.05);
    if (k % 9 === 4) { L[i] = 0; R[i] = i & 1 ? -0 : 0; continue; } // (exact zeros, −0)
    const x = Math.sin(2 * Math.PI * 110 * t) * 0.5 + Math.sin(2 * Math.PI * 277.2 * t + 1) * 0.3 + (2 * r() - 1) * 0.2;
    L[i] = x; R[i] = 0.8 * x - 0.2 * Math.sin(2 * Math.PI * 1661 * t);
  }
  let m = 0;
  for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < N; i++) { L[i] = Math.fround(L[i] * peak / m); R[i] = Math.fround(R[i] * peak / m); }
  return { L, R };
}
// the quantum inputs of a signal: o → [[L, R]] from frame o (zeros past its end); mode(k) per quantum k: 's' stereo, 'm' mono
// [[L]], 'e' [[]] (nothing connected), 'n' [] — and the signal the processor sees (mono: R = L, none: zeros)
function feed(sig, mode = () => 's') {
  const a = new Float32Array(Q), b = new Float32Array(Q), N = sig.L.length, eL = new Float32Array(N + 8192), eR = new Float32Array(N + 8192);
  const input = o => {
    const m = mode(o / Q);
    for (let i = 0; i < Q; i++) { const k = o + i; a[i] = k < N ? sig.L[k] : 0; b[i] = k < N ? sig.R[k] : 0; }
    for (let i = 0; i < Q && o + i < eL.length; i++) { eL[o + i] = m === 's' || m === 'm' ? a[i] : 0; eR[o + i] = m === 's' ? b[i] : m === 'm' ? a[i] : 0; }
    return m === 's' ? [[a, b]] : m === 'm' ? [[a]] : m === 'e' ? [[]] : [];
  };
  return { input, eL, eR };
}
// N frames through p: input(o) → the quantum's inputs, before(o) posts messages; → { L, R }
function render(p, N, input, before) {
  const L = new Float32Array(N), R = new Float32Array(N), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
  for (let o = 0; o < N; o += Q) {
    if (before) before(o);
    assert.equal(p.process(input ? input(o) : [], out), true);
    L.set(oL.subarray(0, Math.min(Q, N - o)), o); R.set(oR.subarray(0, Math.min(Q, N - o)), o);
    S.ctx.currentFrame += Q;
  }
  return { L, R };
}
const ceilQ = n => Math.ceil(n / Q) * Q;
// the first frame (≥ from) where out differs from the signal delayed by d, or −1
function firstDiff(out, eL, eR, d, from, to) {
  for (let i = from; i < to; i++) {
    const x = i - d >= 0 ? eL[i - d] : 0, y = i - d >= 0 ? eR[i - d] : 0;
    if (!Object.is(out.L[i], x) || !Object.is(out.R[i], y)) return i;
  }
  return -1;
}
const peakOf = (a, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };

test('engine.js registers synth-safe beside synth-master: the Track stays the last registration (the harnesses\' Proc); dsp-scope captures it by name', () => {
  assert.deepEqual([...S.names], ['synth-master', 'synth-safe', 'synth-engine']);
  const D = dspScope({ engine: true, fast: true, console: quiet });
  assert.equal(D.Proc, D.procs['synth-engine']);
  assert.equal(typeof D.procs['synth-safe'], 'function');
  assert.equal(D.procs['synth-safe'] !== D.procs['synth-master'] && D.procs['synth-safe'] !== D.Proc, true);
});

test('below −1 dBFS the gain is exactly 1: the output is the input delayed by L − 1 frames, bit for bit, at every device rate — stereo, mono, nothing connected, exact zeros and −0; no report', () => {
  for (const sr of RATES) {
    const p = mk(sr), lat = latOf(sr), N = ceilQ(Math.round(0.3 * sr));
    assert.equal(p.lat, lat, sr + ': lat = L − 1 (' + lat + ')');
    assert.equal(p.lim.L * (1 / p.lim.L), 1, sr + ': L·(1/L) = 1');
    const sig = program(N, sr, Math.fround(THR * 0.999999), 'u' + sr);
    assert.ok(peakOf(sig.L) < THR && peakOf(sig.R) < THR);
    const F = feed(sig, k => (k % 11 === 3 ? 'm' : k % 11 === 7 ? 'e' : k % 13 === 9 ? 'n' : 's')), M = N + ceilQ(lat);
    const out = render(p, M, F.input);
    assert.equal(firstDiff(out, F.eL, F.eR, lat, 0, M), -1, sr + ': an exact copy, ' + lat + ' frames late');
    assert.equal(peakOf(out.L) > 0.5, true, sr + ': it sounds');
    assert.deepEqual(msgs(p, 'safe'), [], sr + ': nothing reported');
  }
});

test('above −1 dBFS: no output sample over −1 dBFS (+8 dBFS in, every rate); the copy is exact again once the release has settled (2.5 s after the last over)', () => {
  for (const sr of [44100, 48000, 96000]) {
    const p = mk(sr), lat = latOf(sr), loud = ceilQ(sr), N = ceilQ(Math.round(3.6 * sr));
    const a = program(loud, sr, 2.5, 'l' + sr), b = program(N - loud, sr, 0.6, 'q' + sr), sig = { L: new Float32Array(N), R: new Float32Array(N) };
    sig.L.set(a.L); sig.R.set(a.R); sig.L.set(b.L, loud); sig.R.set(b.R, loud);
    const F = feed(sig), out = render(p, N, F.input);
    assert.ok(peakOf(out.L) <= THR32 && peakOf(out.R) <= THR32, sr + ': ≤ −1 dBFS: ' + peakOf(out.L) + ' / ' + peakOf(out.R));
    assert.ok(peakOf(out.L, 0, loud) > 0.85, sr + ': limited, not silenced: ' + peakOf(out.L, 0, loud));
    const from = loud + Math.round(2.5 * sr);
    assert.equal(firstDiff(out, F.eL, F.eR, lat, from, N), -1, sr + ': an exact copy again from 2.5 s after the last over');
  }
});

test('the report: {t: safe, gr} every ≥ 0.1 s of audio while it reduces — gr the dB over −1 dBFS of the window\'s loudest sample; nothing while the mix is below, nothing while off', () => {
  const sr = 48000, p = mk(sr), N = ceilQ(sr), W = Math.ceil(0.1 * sr / Q);
  const sig = program(N, sr, 1.6, 'rep');
  for (let i = 0; i < N; i++) if (Math.floor(i / Q / W) % 3 === 2) { sig.L[i] = Math.fround(sig.L[i] * 0.4); sig.R[i] = Math.fround(sig.R[i] * 0.4); } // (every third window under −1 dBFS)
  render(p, N, feed(sig).input);
  const want = [];
  for (let w = 0; (w + 1) * W * Q <= N; w++) {
    const pk = Math.max(peakOf(sig.L, w * W * Q, (w + 1) * W * Q), peakOf(sig.R, w * W * Q, (w + 1) * W * Q));
    if (pk > THR) want.push(20 * Math.log10(pk / THR));
  }
  const got = msgs(p, 'safe');
  assert.ok(want.length >= 5);
  assert.equal(got.length, want.length, 'one per window that went over');
  for (let k = 0; k < want.length; k++) assert.ok(Math.abs(got[k].gr - want[k]) < 1e-9, k + ': ' + got[k].gr + ' vs ' + want[k]);
  assert.deepEqual(Object.keys(got[0]).sort(), ['gr', 't']);
  const q = mk(sr, { on: false });
  render(q, N, feed(sig).input);
  assert.deepEqual(msgs(q, 'safe'), [], 'off: nothing');
});

test('off: the input itself — no delay, no limiting (a mix over 0 dBFS passes: today\'s output); on ↔ off crossfade over 5 ms, the limiter running throughout (back on = an always-on limiter\'s output, sample for sample)', () => {
  const sr = 48000, lat = latOf(sr), N = ceilQ(2 * sr), sig = program(N, sr, 2.2, 'off');
  const F = feed(sig), p = mk(sr, { on: false }), ref = mk(sr, { on: true }), X = Math.ceil(0.005 * sr);
  const F1 = 40 * Q, F2 = 400 * Q;
  const out = render(p, N, F.input, o => { if (o === F1) p.port.onmessage({ data: { t: 'on', v: true } }); if (o === F2) p.port.onmessage({ data: { t: 'on', v: false } }); });
  S.ctx.currentFrame = 0;
  const r = render(ref, N, F.input);
  assert.equal(firstDiff(out, F.eL, F.eR, 0, 0, F1), -1, 'off from the start: the input itself');
  assert.ok(peakOf(out.L, 0, F1) > 1.5, 'over 0 dBFS, as today');
  let d = -1;
  for (let i = F1 + X; i < F2; i++) if (!Object.is(out.L[i], r.L[i]) || !Object.is(out.R[i], r.R[i])) { d = i; break; }
  assert.equal(d, -1, 'on from F1 + 5 ms: the always-on limiter\'s output exactly');
  assert.ok(peakOf(out.L, F1 + X, F2) <= THR32 && peakOf(out.R, F1 + X, F2) <= THR32);
  assert.equal(firstDiff(out, F.eL, F.eR, 0, F2 + X, N), -1, 'off again from F2 + 5 ms: the input itself');
  // the crossfade: x steps 1 / (5 ms · sr) a sample — out = in + x (limited − in)
  for (const j of [1, X >> 1, X - 1]) {
    const i = F1 + j - 1, x = j / X, inL = F.eL[i], lim = r.L[i], want = inL + x * (lim - inL);
    assert.ok(Math.abs(out.L[i] - want) < 1e-6, 'mid-fade ' + j + ': ' + out.L[i] + ' vs ' + want);
  }
  assert.equal(lat > 0, true);
});

test('constructed: on by default ({} and no options); lat posted nowhere (the host computes it); bye silences it and ends it; process allocates nothing', () => {
  const sr = 48000, a = mk(sr), b = mk(sr, {}), c = mk(sr, { on: true }), d = mk(sr, { on: false });
  assert.deepEqual([a.on, b.on, c.on, d.on], [1, 1, 1, 0]);
  assert.deepEqual(msgs(a), []);
  const sig = program(ceilQ(sr / 2), sr, 3, 'na'), F = feed(sig), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
  for (let o = 0; o < 4 * Q; o += Q) a.process(F.input(o), out); // (first quanta outside: a lazily built field would show below)
  noAlloc(S, () => { for (let o = 4 * Q; o < sig.L.length; o += Q) a.process(F.input(o), out); });
  assert.ok(msgs(a, 'safe').length >= 2, 'it reported while measured');
  a.port.onmessage({ data: { t: 'bye' } });
  oL.fill(1); oR.fill(1);
  assert.equal(a.process(F.input(0), out), false);
  assert.equal(peakOf(oL) + peakOf(oR), 0);
});
