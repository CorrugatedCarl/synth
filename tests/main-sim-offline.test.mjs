import './v8-guard.mjs';
// The page simulation's fake OfflineAudioContext (tests/main-sim.mjs; IMPL-AUTO §7.2, lane H2a): suspend(t) / resume() and the
// AudioParam timeline, pinned against what Chrome does (the §7.0 probe: suspend(t) resolves with currentTime exactly at the next
// 128-frame boundary >= round(t * sr); what is posted to a node before resume() reaches its processor before that quantum renders;
// resume() continues). Stub processors (opts.simProc, the fake's seam) keep the engine out: a DC source and a message log.
// Run alone: node --max-old-space-size=2048 --test tests/main-sim-offline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';

const sim = await bootMain({ ls: fakeStorage({}) });
const OAC = globalThis.OfflineAudioContext, AWN = globalThis.AudioWorkletNode, ACX = globalThis.AudioContext;
const SR = 48000, Q = 128;

// a stub processor: a constant `dc` on both channels (0: silence); log gets ['q', frame] per process() and ['m', message.t] per message
function stub(oc, log, dc = 1, nIn = 0) {
  const simProc = {
    process(inp, out) { log.push(['q', oc.frames]); out[0][0].fill(dc); out[0][1].fill(dc); return true; },
    msg(m) { log.push(['m', m.t, oc.frames]); },
  };
  return new AWN(oc, 'stub', { numberOfInputs: nIn, simProc });
}
const mk = (frames = Q * 20) => new OAC({ numberOfChannels: 2, length: frames, sampleRate: SR });
const name = async p => { try { await p; return 'resolved'; } catch (e) { return e.name; } };

test('a render with no suspend is as synchronous as ever (lastOffline set before the first await); no suspends recorded', () => {
  const oc = mk(), log = [], n = stub(oc, log); n.connect(oc.destination);
  sim.lastOffline = null;
  const p = oc.startRendering();
  assert.equal(sim.lastOffline && sim.lastOffline.ctx === oc, true);
  assert.deepEqual([oc.frames, (oc.suspends || []).length, log.length], [Q * 20, 0, 20]);
  return p;
});

test('suspend(t) resolves with currentTime exactly at the next 128-frame boundary >= round(t * sr); the render continues from there on resume()', async () => {
  const oc = mk(), log = [], n = stub(oc, log); n.connect(oc.destination);
  const a = oc.suspend(300 / SR), b = oc.suspend(Q * 10 / SR), c = oc.suspend((Q * 12 + 0.25) / SR); // 300 → 384; an exact boundary; +0.25 frame → 1536
  const done = oc.startRendering(), seen = [];
  for (const p of [a, b, c]) {
    await p;
    seen.push([oc.currentTime * SR, oc.frames, oc.state, log.length]);
    await oc.resume();
  }
  await done;
  assert.deepEqual(seen, [[384, 384, 'suspended', 3], [1280, 1280, 'suspended', 10], [1536, 1536, 'suspended', 12]], 'stops: time, frame, state, quanta rendered so far');
  assert.deepEqual(log.map(x => x[1]), Array.from({ length: 20 }, (_, i) => i * Q), 'every quantum once, in order');
  assert.equal(oc.state, 'running');
  assert.deepEqual(oc.suspends, [300 / SR, Q * 10 / SR, (Q * 12 + 0.25) / SR], 'ctx.suspends: the times asked for (s), in call order');
  assert.deepEqual(oc.suspendFrames, [384, 1280, 1536], 'ctx.suspendFrames: the frames stopped at, in order');
});

test('suspend scheduled in any order stops in time order; one scheduled while suspended (later than now) is honoured', async () => {
  const oc = mk(), log = []; stub(oc, log).connect(oc.destination);
  const late = oc.suspend(Q * 15 / SR), early = oc.suspend(Q * 3 / SR), order = [];
  late.then(() => order.push('late')); early.then(() => order.push('early'));
  const done = oc.startRendering();
  await early; assert.equal(oc.frames, Q * 3);
  const mid = oc.suspend(Q * 9 / SR);
  await oc.resume();
  await mid; assert.equal(oc.frames, Q * 9); await oc.resume();
  await late; assert.equal(oc.frames, Q * 15); await oc.resume();
  await done;
  assert.deepEqual(order, ['early', 'late']);
  assert.deepEqual(oc.suspendFrames, [Q * 3, Q * 9, Q * 15]);
});

test('suspend(0) stops before the first quantum', async () => {
  const oc = mk(), log = []; stub(oc, log).connect(oc.destination);
  const s = oc.suspend(0), done = oc.startRendering();
  await s;
  assert.deepEqual([oc.frames, log.length], [0, 0]);
  await oc.resume(); await done;
  assert.equal(log.length, 20);
});

test('messages posted to a node while suspended reach its processor before the next quantum renders (and not before the stop)', async () => {
  const oc = mk(), log = [], n = stub(oc, log); n.connect(oc.destination);
  const s = oc.suspend(Q * 4 / SR);
  n.port.postMessage({ t: 'early' }); // before the render: applied at its start
  const done = oc.startRendering();
  await s;
  n.port.postMessage({ t: 'one' }); n.port.postMessage({ t: 'two' });
  assert.equal(log.some(x => x[0] === 'm' && x[1] === 'one'), false, 'queued, not delivered at once');
  await oc.resume(); await done;
  const i = log.findIndex(x => x[0] === 'm' && x[1] === 'one');
  assert.deepEqual(log.slice(i - 1, i + 3).map(x => x.slice(0, 2)), [['q', Q * 3], ['m', 'one'], ['m', 'two'], ['q', Q * 4]], 'in post order, between quantum 3 and quantum 4');
  assert.deepEqual(log[0].slice(0, 2), ['m', 'early']);
  assert.equal(log[i][2], Q * 4, 'delivered at the stop frame');
});

test('suspend rejects as Chrome does: same quantum twice, the past, at / after the end, negative, after the render, non-finite', async () => {
  const oc = mk(), log = []; stub(oc, log).connect(oc.destination);
  const first = oc.suspend(300 / SR);
  assert.equal(await name(oc.suspend(350 / SR)), 'InvalidStateError', 'a second one in the same quantum (384)');
  assert.equal(await name(oc.suspend(-0.001)), 'InvalidStateError', 'negative');
  assert.equal(await name(oc.suspend(Q * 20 / SR)), 'InvalidStateError', 'at the render length');
  assert.equal(await name(oc.suspend(Q * 30 / SR)), 'InvalidStateError', 'after the end');
  assert.equal(await name(oc.suspend(NaN)), 'TypeError', 'not finite');
  const done = oc.startRendering();
  await first;
  assert.equal(await name(oc.suspend(Q * 2 / SR)), 'InvalidStateError', 'before the current frame (384)');
  await oc.resume(); await done;
  assert.equal(await name(oc.suspend(Q * 2 / SR)), 'InvalidStateError', 'after the render has finished');
  assert.deepEqual(oc.suspends, [300 / SR], 'rejected calls are not recorded');
});

test('resume(): rejects before startRendering and after the render; resolves while running; startRendering twice rejects', async () => {
  const oc = mk(), log = []; stub(oc, log).connect(oc.destination);
  assert.equal(await name(oc.resume()), 'InvalidStateError', 'not started');
  const s = oc.suspend(Q * 2 / SR), done = oc.startRendering();
  assert.equal(await name(oc.startRendering()), 'InvalidStateError', 'a second render');
  await s;
  const r1 = oc.resume(), r2 = oc.resume(); // (the render has not yet run on: the second finds it running)
  assert.equal(await name(r2), 'resolved', 'running: resolves'); await r1;
  await done;
  assert.equal(await name(oc.resume()), 'InvalidStateError', 'finished');
});

test('a statechange fires on a suspend and on a resume; the live context keeps its own suspend() (state, calls)', async () => {
  const oc = mk(), log = [], st = []; stub(oc, log).connect(oc.destination);
  oc.onstatechange = () => st.push(oc.state);
  const s = oc.suspend(Q * 2 / SR), done = oc.startRendering();
  await s; await sim.settle(1); await oc.resume(); await done; await sim.settle(1);
  assert.deepEqual(st, ['suspended', 'running']);
  const live = new ACX({ sampleRate: SR });
  await live.suspend();
  assert.deepEqual([live.state, live.calls], ['suspended', ['suspend']]);
});

/* ------------------------------------------------------------------------------------------ the AudioParam timeline */
// a DC source into a chain of nodes into the destination; returns the pieces
function chain(oc, dc, ...mid) {
  const log = [], n = stub(oc, log, dc);
  let last = n;
  for (const m of mid) { last.connect(m); last = m; }
  last.connect(oc.destination);
  return n;
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const q0 = (L, k) => L[k * Q];                       // the value at quantum k's first sample
const flat = (L, k) => L[k * Q] === L[k * Q + Q - 1]; // a gain is read once a quantum

test('a constant gain / pan renders as it always did: the product of the route\'s gains in route order, rounded once (bit for bit)', async () => {
  const oc = mk(), g = oc.createGain(), g2 = oc.createGain(), pn = oc.createStereoPanner();
  g.gain.value = 0.3; g2.gain.value = 0.7; pn.pan.value = 0.25;
  chain(oc, 0.1, g, g2, pn);
  const buf = await oc.startRendering(), x = Math.fround(0.1), gg = 0.3 * 0.7, p = 0.25, gl = Math.cos(p * Math.PI / 2), gr = Math.sin(p * Math.PI / 2);
  assert.equal(buf.getChannelData(0)[5], Math.fround(gg * (x * gl)), 'L');
  assert.equal(buf.getChannelData(1)[5], Math.fround(gg * (x + x * gr)), 'R');
  const oc2 = mk(), h = oc2.createGain(), h2 = oc2.createGain(); h.gain.value = 0.3; h2.gain.value = 0.7;
  chain(oc2, 0.1, h, h2);
  assert.equal((await oc2.startRendering()).getChannelData(0)[7], Math.fround(gg * x));
});

test('linearRampToValueAtTime: events [kind, value, time] in time order; the gain is read per quantum at its start (a ramp shows in the buffer)', async () => {
  const oc = mk(), g = oc.createGain();
  g.gain.linearRampToValueAtTime(1, 1280 / SR); // (out of order on purpose)
  g.gain.setValueAtTime(0, 0);
  assert.deepEqual(g.gain.events, [['set', 0, 0], ['ramp', 1, 1280 / SR]]);
  chain(oc, 1, g);
  const L = (await oc.startRendering()).getChannelData(0), bad = [];
  for (let k = 0; k < 20; k++) { if (!near(q0(L, k), Math.min(1, k * Q / 1280)) || !flat(L, k)) bad.push(k); }
  assert.deepEqual(bad, [], 'quantum k at k*128/1280 up to the ramp\'s end, 1 after; constant inside a quantum');
});

test('a ramp with no event before it starts from the current value at currentTime (Web Audio\'s implicit setValueAtTime); the implicit anchor is not in events', async () => {
  const oc = mk(), g = oc.createGain();
  g.gain.value = 0.8;
  g.gain.linearRampToValueAtTime(0, 1280 / SR);
  assert.deepEqual(g.gain.events, [['ramp', 0, 1280 / SR]]);
  chain(oc, 1, g);
  const L = (await oc.startRendering()).getChannelData(0);
  assert.equal(near(q0(L, 0), 0.8) && near(q0(L, 5), 0.4) && q0(L, 10) === 0 && q0(L, 15) === 0, true);
});

test('exponentialRampToValueAtTime (v0 * (v1 / v0)^frac; a zero target is a RangeError) and setTargetAtTime (v1 + (v0 - v1) * e^(-dt / tc)); a time constant of 0 is a step', async () => {
  const oc = mk(), g = oc.createGain(), h = oc.createGain();
  g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.25, 1280 / SR);
  h.gain.setValueAtTime(1, 0); h.gain.setTargetAtTime(0.2, 0, 0.004);
  assert.throws(() => g.gain.exponentialRampToValueAtTime(0, 1), { name: 'RangeError' });
  assert.deepEqual(g.gain.events, [['set', 1, 0], ['exp', 0.25, 1280 / SR]]);
  assert.deepEqual(h.gain.events, [['set', 1, 0], ['target', 0.2, 0, 0.004]], 'a target carries its time constant as a 4th member');
  chain(oc, 1, g); chain(oc, 1, h);
  const L = (await oc.startRendering()).getChannelData(0), bad = [];
  for (let k = 0; k < 20; k++) {
    const t = k * Q / SR, want = Math.pow(0.25, Math.min(1, k * Q / 1280)) + 0.2 + (1 - 0.2) * Math.exp(-t / 0.004);
    if (!near(q0(L, k), want, 1e-5)) bad.push(k);
  }
  assert.deepEqual(bad, [], 'both summed at the destination');
  const s = oc.createGain(); s.gain.setTargetAtTime(0.5, 0.01, 0);
  assert.deepEqual(s.gain.events, [['set', 0.5, 0.01]], 'tc 0 → a step');
});

test('a pan ramp is read per quantum (equal power on a stereo input)', async () => {
  const oc = mk(), pn = oc.createStereoPanner();
  pn.pan.setValueAtTime(-1, 0); pn.pan.linearRampToValueAtTime(1, 1280 / SR);
  chain(oc, 1, pn);
  const b = await oc.startRendering(), L = b.getChannelData(0), R = b.getChannelData(1);
  assert.equal(near(L[0], 2) && near(R[0], 0), true, 'hard left');
  assert.equal(near(L[5 * Q], 1) && near(R[5 * Q], 1), true, 'centre, halfway');
  assert.equal(near(L[10 * Q], 0, 1e-9) && near(R[10 * Q], 2), true, 'hard right at the end');
});

test('gains in series multiply per quantum (a ramped one with a constant one)', async () => {
  const oc = mk(), a = oc.createGain(), b = oc.createGain();
  a.gain.setValueAtTime(0, 0); a.gain.linearRampToValueAtTime(1, 1280 / SR); b.gain.value = 0.5;
  chain(oc, 1, a, b);
  const L = (await oc.startRendering()).getChannelData(0);
  assert.equal(near(q0(L, 4), 0.5 * 4 * Q / 1280) && near(q0(L, 12), 0.5), true);
});

test('value reads the timeline at currentTime (a stop in a suspend sees the ramp half way); a ramp / value set during a suspend starts there; cancelScheduledValues drops the events from t on', async () => {
  const oc = mk(), g = oc.createGain(), h = oc.createGain(), c = oc.createGain();
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 1280 / SR);
  h.gain.value = 1;
  c.gain.setValueAtTime(1, 0); c.gain.linearRampToValueAtTime(0, 1280 / SR);
  chain(oc, 1, g); chain(oc, 1, h); chain(oc, 1, c);
  assert.equal(g.gain.value, 0, 'before the render: the value at currentTime 0');
  const s = oc.suspend(640 / SR), done = oc.startRendering();
  await s;
  assert.equal(near(g.gain.value, 0.5), true, 'half way');
  h.gain.linearRampToValueAtTime(0, 1280 / SR); // 640 → 1280, from the current 1
  c.gain.cancelScheduledValues(0.0001); // (the ramp at 1280 goes; the set at 0 stays)
  assert.deepEqual(c.gain.events, [['set', 1, 0]]);
  assert.deepEqual(h.gain.events, [['ramp', 0, 1280 / SR]]);
  await oc.resume();
  const L = (await done).getChannelData(0);
  // g: 0.5 at quantum 5 → full at 10;  h: 1 → 0 over quanta 5..10;  c: held at 1 after the cancel
  assert.equal(near(q0(L, 7), 0.7 + 0.6 + 1), true, 'g (0.7) + h (0.6) + c (1) at quantum 7');
  assert.equal(near(q0(L, 15), 1 + 0 + 1), true);
});

test('events are sorted by time (a tie stays in call order); the live context keeps today\'s instant params and records no events', async () => {
  const oc = mk(), g = oc.createGain();
  g.gain.setValueAtTime(3, 2); g.gain.setValueAtTime(1, 1); g.gain.setValueAtTime(2, 1);
  assert.deepEqual(g.gain.events, [['set', 1, 1], ['set', 2, 1], ['set', 3, 2]]);
  assert.throws(() => g.gain.setValueAtTime(1, -1), { name: 'RangeError' });
  assert.throws(() => g.gain.setValueAtTime(NaN, 1), { name: 'TypeError' });
  const live = new ACX({ sampleRate: SR }), l = live.createGain();
  l.gain.setValueAtTime(0.3, 5);
  assert.equal(l.gain.value, 0.3);
  l.gain.linearRampToValueAtTime(0.9, 9); assert.equal(l.gain.value, 0.9);
  l.gain.setTargetAtTime(0.1, 0, 0.5); assert.equal(l.gain.value, 0.1);
  l.gain.value = 0.4; assert.deepEqual([l.gain.value, l.gain.events], [0.4, []]);
});
