// The audible clock (audioclock.js, R5): the frame heard at a performance.now() time for the two engine personalities —
// Chromium / Firefox stamp getOutputTimestamp at the speaker, WebKit (Safari, every iPad browser) at render — the user's
// Output latency offset, iPadOS before 18.4 (no outputLatency), a contextTime reset (GPU-process reconnect), the stale-
// stamp cap, the unstamped fallback (WebKit: + ring + stalls), the hold before an anchor, the stall meter (catch-ups only:
// not suspensions, clock drift or the IO sawtooth) and a WebKit device model with Bluetooth latency and render stalls.
// Run: node --test tests/audioclock.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as AC from '../audioclock.js?v=9';

const SR = 48000, Q = 128 / SR;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
// a context: currentTime, a stamp [contextTime, performanceTime] (none: no getOutputTimestamp), outputLatency (undefined:
// not reported), baseLatency, state
function ctxOf({ cur = 10, stamp = null, out, base = Q, state = 'running', sr = SR } = {}) {
  const c = { sampleRate: sr, currentTime: cur, baseLatency: base, state };
  if (out !== undefined) c.outputLatency = out;
  if (stamp) c.getOutputTimestamp = () => ({ contextTime: stamp[0], performanceTime: stamp[1] });
  return c;
}
const sec = (C, c, ts, now = ts) => AC.outFrame(C, c, ts, now) / c.sampleRate;

test('Chromium personality: the speaker-stamped timestamp is the heard time — nothing subtracted but the user offset', () => {
  const C = AC.createClock(false), c = ctxOf({ cur: 10, stamp: [9.95, 5000], out: 0.03 });
  near(sec(C, c, 5004), 9.954, 1e-9, 'stamp + 4 ms');
  near(sec(C, c, 4990), 9.94, 1e-9, 'an event 10 ms before the stamp');
  C.user = 200;
  near(sec(C, c, 5004), 9.754, 1e-9, '+200 ms offset: 200 ms earlier');
  C.user = -30;
  near(sec(C, c, 5004), 9.984, 1e-9, '−30 ms');
  // unstamped (before the first render): the Phase-1 fallback, currentTime − outputLatency − baseLatency
  const u = ctxOf({ cur: 2, out: 0.03 }); C.user = 0;
  near(sec(C, u, 7000, 7000), 2 - 0.03 - Q, 1e-9, 'fallback');
  near(sec(C, u, 6990, 7000), 2 - 0.03 - Q - 0.01, 1e-9, 'fallback, an event 10 ms ago');
});

test('WebKit personality: the render-stamped timestamp less outputLatency + the ring estimate + stalls + the user offset', () => {
  const C = AC.createClock(true), c = ctxOf({ cur: 10.003, stamp: [10, 5000], out: 0.18 });
  const ring = AC.RING / SR;
  near(sec(C, c, 5004), 10.004 - 0.18 - ring, 1e-9, 'Bluetooth (outputLatency 180 ms)');
  C.stall = 0.05;
  near(sec(C, c, 5004), 10.004 - 0.18 - ring - 0.05, 1e-9, '+ a 50 ms stall');
  C.user = 20;
  near(sec(C, c, 5004), 10.004 - 0.18 - ring - 0.05 - 0.02, 1e-9, '+ the user offset');
  // the same context read as Chromium would be 180 ms + ring + stall + offset ahead
  const ch = AC.createClock(false);
  near(sec(ch, c, 5004) - sec(C, c, 5004), 0.18 + ring + 0.05 + 0.02, 1e-9, 'the WebKit correction');
  // the fallback (no stamp yet) subtracts the same path from currentTime, + baseLatency
  const u = ctxOf({ cur: 3, out: 0.18 });
  near(sec(C, u, 8000), 3 - (0.18 + Q + ring + 0.05 + 0.02), 1e-9, 'WebKit fallback: ring + stall too');
});

test('iPadOS before 18.4 (no outputLatency): ring + stalls + the user offset; the readout says "not reported"', () => {
  const C = AC.createClock(true, 200), c = ctxOf({ cur: 10, stamp: [10, 5000] });
  near(sec(C, c, 5000), 10 - AC.RING / SR - 0.2, 1e-9, 'Bluetooth preset without outputLatency');
  const I = AC.clockInfo(C, c, 5000);
  assert.equal(I.out, null);
  assert.equal(I.webkit, true);
  near(I.total, AC.RING / SR + 0.2, 1e-9, 'total');
  near(I.user, 0.2, 1e-12, 'user');
  near(I.auto, AC.RING / SR, 1e-9, 'auto');
  near(I.stamp, 0, 1e-12, 'currentTime − contextTime');
});

test('outputLatency: a slow average of running reads (every 250 ms); 0 reads while suspended are ignored', () => {
  const C = AC.createClock(true), c = ctxOf({ cur: 10, stamp: [10, 5000], out: 0.16 });
  AC.outDelay(C, c, true, 0);
  near(C.outLat, 0.16, 1e-12, 'the first read is taken as it is');
  c.outputLatency = 0.26;
  AC.outDelay(C, c, true, 100);
  near(C.outLat, 0.16, 1e-12, 'not before 250 ms');
  AC.outDelay(C, c, true, 300);
  near(C.outLat, 0.18, 1e-12, '20 % of the way');
  for (let t = 600; t < 6000; t += 300) AC.outDelay(C, c, true, t);
  near(C.outLat, 0.26, 0.002, 'settles');
  c.state = 'suspended'; c.outputLatency = 0;
  AC.outDelay(C, c, true, 7000);
  near(C.outLat, 0.26, 0.002, 'suspended: kept');
});

test('a contextTime reset (WebKit GPU-process reconnect) or a 0 stamp falls back to currentTime — no negative ticks', () => {
  const C = AC.createClock(true), ring = AC.RING / SR;
  const r = ctxOf({ cur: 100, stamp: [0.5, 9000], out: 0.012 });
  assert.equal(AC.renderTime(r, 9000, 9000)[1], false, 'a stamp more than 1 s off currentTime is ignored');
  near(sec(C, r, 9000), 100 - (0.012 + Q + ring), 1e-9, 'from currentTime');
  const z = ctxOf({ cur: 0.02, stamp: [0, 0], out: 0.012 });
  assert.equal(AC.renderTime(z, 10, 10)[1], false, 'a zero stamp');
  const a = { frame: 0.06 * SR, tick: 0, fpt: 25, wrap: false };
  assert.equal(AC.heardTick(AC.outFrame(C, z, 10, 10), [a]), 0, 'right after Play: the start tick, not before it');
});

test('a stale stamp (suspended, interrupted) is extrapolated 100 ms at most', () => {
  const C = AC.createClock(false), c = ctxOf({ cur: 10.003, stamp: [10, 5000], out: 0 });
  near(sec(C, c, 5080), 10.08, 1e-9, '80 ms: extrapolated');
  near(sec(C, c, 5500, 5500), 10.1, 1e-9, '500 ms: capped at 100');
  near(sec(C, c, 6000, 6000), 10.1, 1e-9, '1 s: capped');
});

test('hold before the anchor: a start shows its own tick until it is heard; a seek / tempo change the anchor before it; a burst of re-anchors is followed exactly', () => {
  const a0 = { frame: 48000, tick: 960, fpt: 25, wrap: false };
  assert.equal(AC.heardTick(40000, [a0]), 960, 'before a start: the start tick');
  assert.equal(AC.heardTick(48000 + 2500, [a0]), 1060, 'after it: the anchor');
  const a1 = { frame: 96000, tick: 0, fpt: 25, wrap: false }; // a seek back to 0 at frame 96000
  assert.equal(AC.heardTick(90000, [a0, a1]), 960 + 42000 / 25, 'the old position still sounds: no jump back early');
  assert.equal(AC.heardTick(96000 + 250, [a0, a1]), 10, 'then the seek target');
  assert.equal(AC.heardTick(30000, [a0, a1]), 960, 'before even the previous anchor: its tick');
  // re-anchors 20 ms apart on one line (a loop drag, a held BPM spinner: the tempo kept), none heard yet: the heard tick
  // follows the line — no freeze at an unheard anchor's tick, no lead
  const A = (f, t) => ({ frame: f, tick: t, fpt: 25, wrap: false }), on = f => 960 + (f - 48000) / 25;
  const as = [a0, A(150000, on(150000)), A(150960, on(150960)), A(151920, on(151920))];
  for (const F of [140000, 149000, 150500, 151000, 152000]) assert.equal(AC.heardTick(F, as), on(F), 'on the line at ' + F);
  // two seeks in a row: each target once it is heard, the old position before
  const s1 = A(200000, 0), s2 = A(204800, 4800);
  assert.equal(AC.heardTick(199000, [a0, s1, s2]), on(199000), 'the old position');
  assert.equal(AC.heardTick(202400, [a0, s1, s2]), 96, 'the first seek');
  assert.equal(AC.heardTick(205000, [a0, s1, s2]), 4808, 'the second');
  // a loop wraps through tickAt
  const L = { frame: 0, tick: 0, fpt: 10, wrap: true, ls: 960, le: 1920 };
  assert.equal(AC.tickAt(19200, L), 960, 'loop end → loop start');
  assert.equal(AC.tickAt(19200 + 1000, L), 1060);
});

// the meter fed a steady IO sawtooth: currentTime moves in steps of P (s), sampled every I (s) from wall time w0 for d s
function sawtooth(C, { w0 = 0, d = 2, P = Q, I = 1 / 60, lag = 0.005, ctxAt = null } = {}) {
  let ups = 0;
  for (let w = w0; w < w0 + d; w += I) {
    const ct = ctxAt ? ctxAt(w) : Math.floor((w - lag) / P) * P;
    if (AC.meterSample(C, w, ct, true)) ups++;
  }
  return ups;
}

test('stall meter: the IO sawtooth, a suspension, clock drift and a slow start are not stalls; a catch-up is', () => {
  for (const [P, I] of [[Q, 1 / 60], [Q, 0.005], [1024 / SR, 0.005], [1024 / SR, 1 / 30]]) {
    const C = AC.createClock(true);
    sawtooth(C, { P, I, d: 4 });
    assert.equal(C.stall, 0, `steady sawtooth P ${(P * 1000).toFixed(1)} ms, sampled every ${(I * 1000).toFixed(1)} ms`);
  }
  // ±100 ppm drift between the audio clock and performance.now() over 10 minutes
  for (const ppm of [100, -100]) {
    const C = AC.createClock(true);
    sawtooth(C, { d: 600, I: 0.05, ctxAt: w => Math.floor((w * (1 + ppm * 1e-6) - 0.005) / Q) * Q });
    assert.equal(C.stall, 0, ppm + ' ppm drift');
  }
  // a suspension while 'running' is still reported (context time stops, no catch-up), then the context runs on
  {
    const C = AC.createClock(true);
    sawtooth(C, { d: 1 });
    sawtooth(C, { w0: 1, d: 0.5, ctxAt: () => 0.995 });              // stopped for 0.5 s
    sawtooth(C, { w0: 1.5, d: 2, lag: 0.505 });                       // runs again, 0.5 s behind for good
    assert.equal(C.stall, 0, 'a suspension is not a stall');
  }
  // not running: the next sample starts afresh (a resumed context's time is behind, not stalled)
  {
    const C = AC.createClock(true);
    sawtooth(C, { d: 1 });
    AC.meterSample(C, 1.2, 0.99, false);
    sawtooth(C, { w0: 2, d: 1, lag: 1.005 });
    assert.equal(C.stall, 0, 'suspended, resumed');
  }
  // a 200 ms render stall and its catch-up (WebKit renders the missed frames at once)
  {
    const C = AC.createClock(true);
    sawtooth(C, { d: 1, I: 0.005 });
    const ups = sawtooth(C, { w0: 1, d: 0.2, I: 0.005, ctxAt: () => 0.995 }) + sawtooth(C, { w0: 1.2, d: 1, I: 0.005 });
    assert.ok(ups >= 1);
    assert.ok(C.stall > 0.185 && C.stall <= 0.2, "measured " + C.stall);
    // a smaller stall later adds nothing (the ring already holds it); a larger one raises it
    sawtooth(C, { w0: 2.2, d: 0.1, I: 0.005, ctxAt: () => 2.195 }); sawtooth(C, { w0: 2.3, d: 1, I: 0.005 });
    assert.ok(C.stall > 0.19 && C.stall <= 0.2, 'a 100 ms stall after a 200 ms one');
    sawtooth(C, { w0: 3.3, d: 0.3, I: 0.005, ctxAt: () => 3.295 }); sawtooth(C, { w0: 3.6, d: 1, I: 0.005 });
    assert.ok(C.stall > 0.29 && C.stall <= 0.3, 'a 300 ms stall: ' + C.stall);
  }
  // a stall at the very start (before the jitter is known) is counted once it is
  {
    const C = AC.createClock(true);
    sawtooth(C, { d: 0.02, I: 0.005 });
    sawtooth(C, { w0: 0.02, d: 0.26, I: 0.005, ctxAt: () => 0.015 }); sawtooth(C, { w0: 0.28, d: 2, I: 0.005 });
    assert.ok(C.stall > 0.245 && C.stall <= 0.26, 'the warm-up stall: ' + C.stall);
  }
});

test('drift notice: due on WebKit once the stalls grew DRIFT past the settled baseline, then DRIFT further on', () => {
  const C = AC.createClock(true);
  C.stall = 0.1;
  assert.equal(AC.driftDue(C), false, 'not before settle (the power-on is the baseline)');
  AC.settle(C);
  C.stall = 0.15;
  assert.equal(AC.driftDue(C), false);
  C.stall = 0.17;
  assert.equal(AC.driftDue(C), true, '+70 ms');
  assert.equal(AC.driftDue(C), false, 'once');
  C.stall = 0.24;
  assert.equal(AC.driftDue(C), true, 'another 60 ms');
  const ch = AC.createClock(false);
  AC.settle(ch); ch.stall = 1;
  assert.equal(AC.driftDue(ch), false, 'never on Chromium (it drops stalls)');
  AC.resetClock(C);
  assert.deepEqual([C.stall, C.settled, C.outLat], [0, false, 0], 'a new context starts afresh');
});

// A WebKit device (GPU-process path): every IO period P the device takes P frames from the ring when the web process has
// rendered them (else an underrun: silence, its read position stays — the first callback always is one), heard hw later;
// the web process — unless stalled — then renders every frame asked for since it last ran (the catch-up), stamping
// contextTime (the rendered frame) and performanceTime at render: the steady lead is two IO buffers (RING). The app
// samples the meter every I and reads its clock.
function webkitRun({ P = 128, hw = 0.012, I = 1 / 60, stalls = [], seconds = 8, user = 0, outRep = hw }) {
  const C = AC.createClock(true, user), dt = 1e-4;
  const c = { sampleRate: SR, currentTime: 0, baseLatency: Q, state: 'running', getOutputTimestamp: () => ({ ...stamp }) };
  if (outRep !== null) c.outputLatency = outRep;
  let stamp = { contextTime: 0, performanceTime: 0 }, rendered = 0, read = 0, total = 0, nextCb = 0, nextS = 0.003;
  const blocks = [], errs = [];
  for (let w = 0; w < seconds; w += dt) {
    if (w >= nextCb) {
      const ok = rendered >= read + P;
      blocks.push([nextCb, ok ? read : -1]);
      if (ok) read += P;
      total += P; nextCb += P / SR;
      if (!stalls.some(([at, ms]) => w >= at && w < at + ms / 1000)) {
        rendered = total;
        c.currentTime = rendered / SR; stamp = { contextTime: rendered / SR, performanceTime: (w + 2e-4) * 1000 };
      }
    }
    if (w >= nextS) {
      nextS += I;
      AC.meterSample(C, w, c.currentTime, true);
      // the frame heard now: the block that started hw ago
      let h = null;
      for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k][0] <= w - hw) { if (blocks[k][1] >= 0) h = blocks[k][1] + (w - hw - blocks[k][0]) * SR; break; }
      if (h != null && w > 0.5) errs.push([w, (AC.outFrame(C, c, w * 1000, w * 1000) - h) / SR * 1000]);
    }
  }
  const at = (a, b) => { const e = errs.filter(([w]) => w >= a && w < b).map(x => x[1]); return [Math.min(...e), Math.max(...e)]; };
  return { C, at };
}

test('WebKit device model: speaker, Bluetooth, pre-18.4 with the Bluetooth preset, and render stalls — the playhead tracks the heard audio', () => {
  const ok = ([lo, hi], a, b, msg) => assert.ok(lo >= a && hi <= b, `${msg}: error ${lo.toFixed(2)} … ${hi.toFixed(2)} ms, want ${a} … ${b}`);
  ok(webkitRun({}).at(1, 8), -3, 3, 'built-in speaker (12 ms)');
  ok(webkitRun({ hw: 0.18 }).at(1, 8), -3, 3, 'Bluetooth (outputLatency 180 ms)');
  ok(webkitRun({ hw: 0.2, outRep: null, user: 200 }).at(1, 8), -3, 3, 'iPadOS < 18.4: no outputLatency, the Bluetooth preset');
  // stalls of 40 / 120 / 60 ms: the error after each is at most the sampling interval + the jitter allowance (playhead early)
  for (const I of [0.005, 1 / 60]) {
    const r = webkitRun({ hw: 0.18, I, stalls: [[2, 40], [4, 120], [6, 60]] });
    const late = (I + 0.007) * 1000;
    ok(r.at(1, 2), -3, 3, 'before the stalls');
    ok(r.at(2.5, 4), -3, late, 'after 40 ms (I ' + (I * 1000).toFixed(1) + ' ms)');
    ok(r.at(4.5, 8), -3, late, 'after 120 ms, then a smaller 60 ms one');
    assert.ok(r.C.stall > 0.1 && r.C.stall < 0.125, 'measured ' + r.C.stall);
  }
});

test('WebKit device model: the Bluetooth preset tops up what outputLatency already allows (main.js btLat: 200 − the reported ms; a flat +200 counted Bluetooth twice on iPadOS 18.4+)', () => {
  const ok = ([lo, hi], a, b, msg) => assert.ok(lo >= a && hi <= b, `${msg}: error ${lo.toFixed(2)} … ${hi.toFixed(2)} ms, want ${a} … ${b}`);
  const bt = rep => Math.max(0, 200 - Math.round(rep * 1000));
  ok(webkitRun({ hw: 0.22, outRep: 0.16, user: bt(0.16) }).at(1, 8), -25, 25, 'AirPods reporting 160 of 220 ms: +40');
  ok(webkitRun({ hw: 0.18, user: bt(0.18) }).at(1, 8), -25, 25, 'reported right (180 ms): +20');
  ok(webkitRun({ hw: 0.2, outRep: 512 / SR, user: bt(512 / SR) }).at(1, 8), -5, 5, 'a Private tab (a fixed 512 / sr): +189');
  const [lo] = webkitRun({ hw: 0.22, outRep: 0.16, user: 200 }).at(1, 8);
  assert.ok(lo < -100, 'the flat +200 trailed the sound by ' + lo.toFixed(0) + ' ms');
});
