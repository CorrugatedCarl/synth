import './v8-guard.mjs';
// lc-view.js (stage LC lane F; docs/canvas/IMPL-LC.md §6, §7.2, §9; G4's node half, G6's redraw rules): the Combiner's whole-bar view.
// The window (½ / 1 / 2 / 4 bars on the signature), the timeline (playing: the heard line; stopped: ▶ at the cursor, Q4), one input's
// curve from the DSP's own functions (a stub P here: tests/lc-stub.mjs — lane E's ModCore.preview at integration), its value its chunk's,
// SMOOTH by the chunk-rate recurrence, the sum by ModCore.combine (Add clipped flat: Q1). G4 with the stub: the view's curve at every
// quantum end ≡ a worklet model's output (≤ 1e-6) — 120 / 140 BPM, BPM ¼ anchored, Hz 0.7 FREE from the anchors, a square under SMOOTH
// 0.3, Add and Multiply, a 2-bar loop wrapping, stopped from the cursor vs the render after ▶ there. The previews shared per CP (an
// amount / mute / mode never rebuilds one). §6.6: what recomputes, what only re-combines, what repaints per frame (nothing unchanged).
// The dot: the ring at the heard frame, guarded. lc-view is loaded on demand (no static import on the site).
// Never passes fake-DOM nodes to assert.* (numbers and strings only).
// Run alone: node --max-old-space-size=2048 --test tests/lc-view.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fresh } from './wk-dom.mjs';
import * as LV from '../lc-view.js?v=9';
import * as ST from './lc-stub.mjs';

const PPQ = 960, SR = 48000;
const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= eps)) assert.fail((msg || '') + ': ' + a + ' vs ' + b + ' (Δ ' + Math.abs(a - b) + ')'); };

/* ---------------------------------------------------------------- the window and the timeline */
test('(§6.1) the window: W = win · 4·num/den beats, [⌊b / W⌋·W, + W) around b — ½ bar half bars; 6/8 bars of 3 quarter notes', () => {
  assert.deepEqual([LV.barBeatsOf([4, 4]), LV.barBeatsOf([6, 8]), LV.barBeatsOf([3, 4]), LV.barBeatsOf({ num: 7, den: 8 }), LV.barBeatsOf(null)], [4, 3, 3, 3.5, 4]);
  assert.deepEqual(LV.windowOf(5.5, 1, 4), [4, 4]);
  assert.deepEqual(LV.windowOf(5.5, 0.5, 4), [4, 2]);
  assert.deepEqual(LV.windowOf(6.5, 0.5, 4), [6, 2]);
  assert.deepEqual(LV.windowOf(5.5, 4, 4), [0, 16]);
  assert.deepEqual(LV.windowOf(17, 2, 3), [12, 6]);
  assert.deepEqual(LV.windowOf(8, 1, 4), [8, 4], 'a bar line starts its window');
  assert.deepEqual([LV.W_PTS, LV.CHUNK, LV.WARM, LV.SCR_W, LV.SCR_H], [512, 4, 14, 384, 128]);
});

test('(§6.2) the timeline: playing on the heard line (frame Fh at the heard tick), stopped ▶ at the cursor (chunk 0 there); the first played frame: ▶\'s chunk in pass 0, none known otherwise', () => {
  const st = { bpm: 120, sig: [4, 4], playing: true, tick: 6 * PPQ, cursor: 2 * PPQ, loop: { on: true, start: 0, end: 8 * PPQ }, start: 2 * PPQ, pass: 0 };
  const T = LV.timeline(st, 1e6, SR);
  assert.deepEqual([T.playing, T.bh, T.b0, T.fpb, T.Fh, T.lon, T.ls, T.le, T.pass, T.dtC], [true, 6, 2, 24000, 1e6, true, 0, 8, 0, 4 / SR]);
  assert.equal(LV.frameOf(T, 7), 1e6 + 24000);
  assert.equal(T.F0, LV.chunkOf(1e6 - 4 * 24000) + 0, '▶ four beats before the heard one');
  assert.equal(LV.timeline(Object.assign({}, st, { pass: 1 }), 1e6, SR).F0, -Infinity, 'a later pass: the smoother ran on');
  const S = LV.timeline(Object.assign({}, st, { playing: false }), 1e6, SR);
  assert.deepEqual([S.playing, S.bh, S.b0, S.F0, LV.frameOf(S, 3)], [false, 2, 2, 0, 24000]);
  assert.equal(LV.timeline(st, NaN, SR).playing, false, 'no heard frame: as stopped');
  assert.deepEqual([LV.chunkOf(7.9999999), LV.chunkOf(8), LV.chunkOf(11.99), LV.chunkOf(-1)], [8, 8, 8, -4]);
});

/* ---------------------------------------------------------------- one input */
// (a CP's key is its content's: the stub's laws in it)
const PAY = (lfos, extra) => Object.assign({ t: 'mods', key: 'k1', bpm: 120, cp: ST.cpOf(lfos, 'cp:' + JSON.stringify(lfos)), ct: { key: 'ct1' } }, extra);
test('(§6.2) inputCurve: a point\'s value is its chunk\'s — \'song\' the closed form at the chunk\'s song beat, \'time\' the newest anchor\'s line (x + (F − (F_a − 4))·r), stopped P.playX from the cursor; \'rand\' its v flat; a time-locked or random input with no anchor is not drawn', () => {
  const lfos = [{ lock: 'song', beats: 1, start: 0.1, shape: 'sine', sm: 0 }, { lock: 'time', hz: 0.7, start: 0.25, shape: 'tri', sm: 0 }, { lock: 'rand', hz: 3, start: 0, shape: 'saw', sm: 0 }];
  const P = ST.preview(PAY(lfos), SR), st = { bpm: 120, sig: [4, 4], playing: true, tick: 4.5 * PPQ, cursor: 0, loop: { on: false, start: 0, end: 0 } };
  const T = LV.timeline(st, 500000.5, SR), beats = Float64Array.from([4, 4.25, 4.5, 6.001, 7.9]), out = new Float64Array(15);
  assert.equal(LV.inputCurve(P, 0, 'song', T, null, beats, 5, out, 3, 0), 1);
  for (let i = 0; i < 5; i++) {
    const Fc = LV.chunkOf(500000.5 + (beats[i] - 4.5) * 24000), bc = 4.5 + (Fc - 500000.5) / 24000;
    close(out[i * 3], ST.SHAPES.sine(((0.1 + bc) % 1 + 1) % 1), 1e-12, 'song ' + i);
  }
  const A = { F: 500096, x: 3.375, r: 0.7 / SR, v: 0.5 };
  assert.equal(LV.inputCurve(P, 1, 'time', T, A, beats, 5, out, 3, 1), 1);
  for (let i = 0; i < 5; i++) { const Fc = LV.chunkOf(500000.5 + (beats[i] - 4.5) * 24000), x = 3.375 + (Fc - (500096 - 4)) * 0.7 / SR; close(out[i * 3 + 1], ST.SHAPES.tri(x - Math.floor(x)), 1e-12, 'time ' + i); }
  assert.equal(LV.inputCurve(P, 1, 'time', T, { F: NaN }, beats, 5, out, 3, 1), 0, 'no anchor yet: not drawn');
  assert.ok(Number.isNaN(out[1]) && Number.isNaN(out[13]));
  assert.equal(LV.inputCurve(P, 2, 'rand', T, { F: 1, x: 0, r: 0, v: 0.62 }, beats, 5, out, 3, 2), 1);
  assert.deepEqual([out[2], out[5], out[14]], [0.62, 0.62, 0.62], 'rand: its current value, flat');
  // stopped: every steady input from ▶ at the cursor (chunk 0 on the cursor's beat)
  const S = LV.timeline(Object.assign({}, st, { playing: false, cursor: 4 * PPQ }), NaN, SR);
  LV.inputCurve(P, 1, 'time', S, A, beats, 5, out, 3, 1);
  for (let i = 0; i < 5; i++) { const k = Math.floor((beats[i] - 4) * 24000 / 4 + 1e-7), x = 0.25 + k * 4 * 0.7 / SR; close(out[i * 3 + 1], ST.SHAPES.tri(x - Math.floor(x)), 1e-12, 'stopped ' + i); }
});

test('(§6.2, P2-1) SMOOTH: offLfo\'s recurrence at the chunk rate — from ▶\'s chunk (s = y there: oInit) it is the worklet\'s exactly; from a warm-up of 14 τ before, ≤ 1e-6 (a square at SMOOTH 0.3); points far apart restart their warm-up', () => {
  const lfos = [{ lock: 'song', beats: 0.5, start: 0, shape: 'square', sm: 0.3 }], P = ST.preview(PAY(lfos), SR);
  const S = ST.sim({ sr: SR, bpm: 120, lfos, ins: [{ l: 0, a: 1 }], Fp: 0, b0: 0, frames: 4 * 24000 }); // (y = x: one input at +100 %)
  // stopped at beat 0: the curve from ▶ there ≡ the render from frame 0
  const st = { bpm: 120, sig: [4, 4], playing: false, tick: 0, cursor: 0, loop: { on: false, start: 0, end: 0 } }, T = LV.timeline(st, NaN, SR);
  const qs = []; for (let q = 3; q < S.qF.length; q += 37) qs.push(q);
  const beats = Float64Array.from(qs.map(q => (S.qF[q] - 4) / 24000)), out = new Float64Array(beats.length);
  LV.inputCurve(P, 0, 'song', T, null, beats, beats.length, out, 1, 0);
  qs.forEach((q, i) => close(out[i], S.qy[q], 1e-12, 'from ▶, quantum ' + q));
  // playing, the start unknown: a warm-up of 14 τ before each point (≤ 1e-6)
  const Tp = LV.timeline(Object.assign({}, st, { playing: true, tick: 2 * PPQ }), 48000, SR);
  const late = qs.filter(q => S.qF[q] > 14 * 0.5 * 0.027 * SR + 512), bl = Float64Array.from(late.map(q => (S.qF[q] - 4) / 24000)), o2 = new Float64Array(bl.length);
  LV.inputCurve(P, 0, 'song', Tp, null, bl, bl.length, o2, 1, 0);
  late.forEach((q, i) => close(o2[i], S.qy[q], 1e-6, 'warmed, quantum ' + q));
  assert.ok(late.length > 8, late.length + ' points');
  // the value without the recurrence is not it (the gate is not empty): at a square's edge the smoothed value lags
  const raw = late.map(q => ST.SHAPES.square((((S.qF[q] - 4) / 24000) / 0.5) % 1)), dev = late.map((q, i) => Math.abs(raw[i] - S.qy[q]));
  assert.ok(Math.max(...dev) > 0.05, 'SMOOTH moves the curve (' + Math.max(...dev) + ')');
});

/* ---------------------------------------------------------------- G4 with the stub: the view ≡ the worklet model */
function scene(o) {
  const d = fresh(), S = { pay: o.pay, inputs: o.inputs, dev: o.dev, song: o.song, Fh: o.Fh }, cvC = d.createElement('canvas'), cvO = d.createElement('canvas');
  const V = LV.createView({ curves: cvC, overlay: cvO, devKey: 'x1', mc: () => ST.MC, payload: () => S.pay, inputs: () => S.inputs,
    dev: () => S.dev, song: () => S.song, heardFrame: () => S.Fh, sampleRate: () => SR, marks: o.marks });
  return { V, S, d, cvC, cvO };
}
const cmbOf = (ins, mode) => [{ id: 'x1', k: 8, mode, in: ins.map((x, j) => ({ row: 'r' + j, src: 2 + x.l, l: x.l, a: x.a })) }];
const inputsOf = ins => ins.map((x, j) => ({ row: 'r' + j, color: '#ff7f5a', amt: x.a, byp: 0 }));
function g4(o) {
  const lfos = o.lfos, ins = o.ins, bpm = o.bpm, fpb = 60 * SR / bpm, Fp = 128 * 40;
  const S = ST.sim({ sr: SR, bpm, lfos, ins, mode: o.mode, Fp, b0: o.b0, loop: o.loop, frames: Math.round(o.secs * SR) });
  const pay = PAY(lfos, { bpm, cmb: cmbOf(ins, o.mode) });
  const sc = scene({ pay, inputs: inputsOf(ins), dev: { mode: o.mode ? 'mul' : 'add', win: o.win || 1, mark: null }, Fh: 0,
    song: { bpm, sig: [4, 4], playing: true, tick: 0, cursor: o.b0 * PPQ, loop: o.loop ? { on: true, start: o.loop.ls * PPQ, end: o.loop.le * PPQ } : { on: false, start: 0, end: 0 }, start: o.b0 * PPQ, pass: 0 } });
  let pi = 0, n = 0, worst = 0, steps = 0;
  const lead = Math.round(0.08 * SR); // (the posts lead the heard frame by the output delay)
  for (let Fh = Fp + 0.3 * SR; Fh < Fp + (o.secs - 0.5) * SR; Fh += Math.round(0.37 * SR)) {
    while (pi < S.posts.length && S.posts[pi].F <= Fh + lead) { sc.V.push(S.posts[pi].F, S.posts[pi].cb, 0); pi++; }
    sc.S.Fh = Fh; sc.S.song.tick = S.beatAt(Fh) * PPQ; sc.S.song.pass = S.passAt(Fh);
    const T = LV.timeline(sc.S.song, Fh, SR), [w0, W] = LV.windowOf(T.bh, o.win || 1, 4);
    // the quantum ends inside this window and this pass (played): from the pass's start (▶ or the wrap) to the loop's end
    const pass = S.passAt(Fh), Fs = pass === 0 ? Fp : Fp + (o.loop.le - o.b0) * fpb + (pass - 1) * (o.loop.le - o.loop.ls) * fpb;
    const qs = [];
    for (let q = 0; q < S.qF.length; q++) {
      const Fc = S.qF[q] - 4;
      if (Fc < Fs || S.passAt(Fc) !== pass) continue;
      const b = T.bh + (Fc - Fh) / fpb;
      if (b >= w0 && b < w0 + W) qs.push(q);
    }
    const bs = Float64Array.from(qs.map(q => T.bh + (S.qF[q] - 4 - Fh) / fpb)), y = sc.V.curveAt(bs);
    qs.forEach((q, i) => { const dd = Math.abs(y[i] - S.qy[q]); if (!(dd <= worst)) worst = dd; n++; });
    steps++;
  }
  sc.V.destroy();
  return { worst, n, steps };
}
const LFO3 = [{ lock: 'song', beats: 1, start: 0, shape: 'sine', sm: 0 }, { lock: 'time', hz: 0.7, start: 0.25, shape: 'tri', sm: 0 }, { lock: 'song', beats: 0.5, start: 0.1, shape: 'square', sm: 0.3 }];
test('(G4, the stub) the view\'s curve at every quantum end ≡ the worklet model: Add +100 / −50 / +30 (clipped flat), BPM ¼ anchored + Hz 0.7 FREE from the anchors + a square under SMOOTH 0.3 — 120 and 140 BPM, ≤ 1e-6', () => {
  for (const bpm of [120, 140]) {
    const r = g4({ lfos: LFO3, ins: [{ l: 0, a: 1 }, { l: 1, a: -0.5 }, { l: 2, a: 0.3 }], mode: 0, bpm, b0: 0, secs: 8 });
    assert.ok(r.n > 400 && r.steps > 15, bpm + ': ' + r.n + ' points over ' + r.steps + ' frames');
    assert.ok(r.worst <= 1e-6, bpm + ' BPM: |Δ| ' + r.worst);
  }
});
test('(G4, the stub) Multiply, a 2-bar loop wrapping (the warm-up before a wrap reads the loop\'s end), a 2-bar window, the start mid-bar: ≤ 1e-6', () => {
  const r = g4({ lfos: LFO3, ins: [{ l: 0, a: 0.8 }, { l: 1, a: 1 }, { l: 2, a: -0.6 }], mode: 1, bpm: 120, b0: 1.5, loop: { ls: 0, le: 8 }, win: 2, secs: 11 });
  assert.ok(r.n > 400, r.n + ' points');
  assert.ok(r.worst <= 1e-6, 'loop, Multiply: |Δ| ' + r.worst);
});
test('(G4, Q4) stopped: the curve from the cursor ≡ the render after ▶ from it (SMOOTH included), ≤ 1e-6', () => {
  const ins = [{ l: 0, a: 1 }, { l: 1, a: -0.5 }, { l: 2, a: 0.3 }], S = ST.sim({ sr: SR, bpm: 120, lfos: LFO3, ins, Fp: 0, b0: 5, frames: 3 * 24000 });
  const sc = scene({ pay: PAY(LFO3, { cmb: cmbOf(ins, 0) }), inputs: inputsOf(ins), dev: { mode: 'add', win: 1, mark: null }, Fh: 1234,
    song: { bpm: 120, sig: [4, 4], playing: false, tick: 0, cursor: 5 * PPQ, loop: { on: false, start: 0, end: 0 } } });
  const qs = []; for (let q = 0; q < S.qF.length && 5 + (S.qF[q] - 4) / 24000 < 8; q++) qs.push(q);
  const y = sc.V.curveAt(Float64Array.from(qs.map(q => 5 + (S.qF[q] - 4) / 24000)));
  let w = 0; qs.forEach((q, i) => { w = Math.max(w, Math.abs(y[i] - S.qy[q])); });
  assert.ok(qs.length > 300 && w <= 1e-6, qs.length + ' quanta, |Δ| ' + w);
  sc.V.destroy();
});

test('(R1-1) a hard-edged input under SMOOTH 0.3 from a run start (▶, a seek) is exact: the smoother starts at ▶\'s chunk from the clock\'s definition there (\'song\' P.playX at b0 itself, \'time\' its start) — never a clock rebuilt from later data (± 1e-13: the wrong side of the edge)', () => {
  // a step whose edge is at its phase 0 (and ½): ▶ on an edge, song-locked (b0 on a half beat) and time-locked (its start 0)
  const lfos = [{ lock: 'song', beats: 0.5, start: 0, shape: 'step', sm: 0.3 }, { lock: 'time', hz: 2.9, start: 0, shape: 'step', sm: 0.3 }]; // (2.9 Hz: no later edge on a chunk boundary — R1-4's, recorded)
  let worst = 0, n = 0;
  // (tempi with no later song edge on a chunk boundary: R1-4's, recorded)
  for (const bpm of [97, 133, 151]) for (const b0 of [0, 1.5, 3, 4.5]) for (const ins of [[{ l: 0, a: 1 }], [{ l: 1, a: 1 }]]) {
    const r = g4({ lfos, ins, mode: 0, bpm, b0, secs: 1.6 });
    if (!(r.worst <= worst)) worst = r.worst;
    n += r.n;
  }
  assert.ok(n > 200, n + ' points');
  assert.ok(worst <= 1e-6, 'from ▶: |Δ| ' + worst);
});

/* ---------------------------------------------------------------- the previews */
test('(§5.4, P2-6) one preview per CP (cpKey + CT key + bpm + rate), shared by every view of it; another payload key on the same CP keeps it (an amount / mute / mode); a new CP takes a new one; the last release destroys it', () => {
  const lfos = [{ lock: 'song', beats: 1, start: 0.125, shape: 'sine', sm: 0 }], m0 = ST.preview.made, h0 = LV.previews();
  const a = LV.preview(ST.MC, PAY(lfos), SR), b = LV.preview(ST.MC, PAY(lfos, { key: 'another' }), SR);
  assert.deepEqual([ST.preview.made - m0, a.P === b.P, a.key === b.key, LV.previews() - h0], [1, true, true, 1]);
  const c = LV.preview(ST.MC, PAY(lfos, { bpm: 128 }), SR), e = LV.preview(ST.MC, PAY(lfos, { cp: ST.cpOf(lfos, 'cpB') }), SR);
  assert.deepEqual([ST.preview.made - m0, c.P === a.P, e.P === a.P, LV.previews() - h0], [3, false, false, 3]);
  LV.release(a);
  assert.equal(a.P.destroyed, 0, 'still held');
  LV.release(b); LV.release(c); LV.release(e);
  assert.deepEqual([a.P.destroyed, c.P.destroyed, e.P.destroyed, LV.previews() - h0], [1, 1, 1, 0]);
  // (review 1 R1-7) the host in the key: the master's preview reads its LFOs noteless (RETRIG 'time'), a track's per note — never shared
  const tk = LV.preview(ST.MC, PAY(lfos, { i: 'trk_1' }), SR), ms = LV.preview(ST.MC, PAY(lfos, { i: 'master' }), SR), t2 = LV.preview(ST.MC, PAY(lfos, { i: 'trk_2' }), SR);
  assert.deepEqual([tk.P === ms.P, tk.key === ms.key, tk.P === t2.P], [false, false, true], 'the master apart; two tracks share');
  LV.release(tk); LV.release(ms); LV.release(t2);
  assert.equal(LV.preview({ combine() {} }, PAY(lfos), SR), null, 'no ModCore.preview yet (lane E): none');
  assert.equal(LV.preview(ST.MC, { cp: null }, SR), null);
  // a view without a preview (the DSP not there yet) binds once — not every frame — and draws its grid; the DSP's arrival binds again
  let mc = { combine: ST.combine };
  const d = fresh(), pay = PAY(lfos, { cmb: cmbOf([{ l: 0, a: 1 }], 0) }), song = { bpm: 120, sig: [4, 4], playing: false, cursor: 0, loop: { on: false } };
  const V = LV.createView({ curves: d.createElement('canvas'), overlay: d.createElement('canvas'), devKey: 'x1', mc: () => mc, payload: () => pay, inputs: () => inputsOf([{ l: 0, a: 1 }]),
    dev: () => ({ mode: 'add', win: 1 }), song: () => song, heardFrame: () => NaN, sampleRate: () => SR });
  V.frame(); V.frame(); V.frame();
  assert.deepEqual([V.state().recomputes, V.state().preview, V.state().drawn], [1, null, [0]]);
  mc = ST.MC; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().preview !== null, V.state().drawn], [2, true, [1]], 'the DSP came: drawn');
  V.destroy();
});

/* ---------------------------------------------------------------- §6.6: when to redraw */
const calls = cv => (cv._ctx ? cv._ctx.calls.length : 0);
function live() {
  const lfos = [{ lock: 'song', beats: 1, start: 0, shape: 'sine', sm: 0 }, { lock: 'time', hz: 0.7, start: 0, shape: 'tri', sm: 0 }, { lock: 'note', hz: 2, start: 0, shape: 'saw', sm: 0 }];
  const ins = [{ l: 0, a: 1 }, { l: 1, a: 0.5 }, { l: 2, a: 0.25 }], pay = PAY(lfos, { cmb: cmbOf(ins, 0) });
  const sc = scene({ pay, inputs: inputsOf(ins), dev: { mode: 'add', win: 1, mark: null }, Fh: 480000, song: { bpm: 120, sig: [4, 4], playing: true, tick: 20 * PPQ, cursor: 0, loop: { on: false, start: 0, end: 0 }, start: 0, pass: 0 } });
  const cb = new Float64Array(10);
  const post = (F, x1, x2, y = 0.5) => { cb[0] = y; cb[1] = 0; cb[2] = 1 / 24000; cb[3] = 0.5; cb[4] = x1; cb[5] = 0.7 / SR; cb[6] = 0.3; cb[7] = x2; cb[8] = 2 / SR; cb[9] = 0.1; sc.V.push(F, cb, 0); };
  return Object.assign(sc, { post, pay });
}
test('(§6.6) the curves recompute on a window move, ▶ / ■, a seek (the heard line moved), the tempo, the window pick, a new payload — never per frame; an amount / mute / mode only re-runs the combine; the overlay alone repaints per frame, and only when it moved', () => {
  const L = live(), V = L.V;
  L.post(480512, 7.25, 3.5);
  V.frame();
  const s0 = V.state();
  assert.deepEqual([s0.n, s0.drawn, s0.locks, s0.dash, s0.w0, s0.W, s0.recomputes, s0.combines], [3, [1, 1, 1], ['song', 'time', 'note'], [false, false, true], 20, 4, 1, 1]);
  // the heard frame moves on the line: nothing recomputes
  for (let i = 1; i <= 5; i++) { L.S.Fh = 480000 + i * 1200; L.S.song.tick = (20 + i * 0.05) * PPQ; V.frame(); }
  assert.deepEqual([V.state().recomputes, V.state().combines], [1, 1], 'frames on the line: no recompute');
  // a new anchor on the line (the extrapolation holds, modulo 1): nothing; one off it (a restart): a recompute
  L.post(480512 + 1536, 7.25 + 1536 * 0.7 / SR + 3, 3.5 + 1536 * 2 / SR); V.frame();
  assert.equal(V.state().recomputes, 1, 'an anchor on the line');
  L.post(480512 + 3072, 7.25 + 0.4, 3.5 + 3072 * 2 / SR); V.frame();
  assert.equal(V.state().recomputes, 2, 'a time-locked input restarted');
  // an amount, a mute, the mode: the combine only
  L.S.inputs[1].amt = -0.75; V.dirty(1); V.frame();
  L.S.inputs[2].byp = 1; V.dirty(1); V.frame();
  L.S.dev.mode = 'mul'; V.dirty(1); V.frame();
  const s1 = V.state();
  assert.deepEqual([s1.recomputes, s1.combines, s1.amts, s1.mode], [2, 5, [1, -0.75, 0], 1]);
  // a seek inside the window (the heard line jumps): a recompute; the window moving on: one; ■: one; the tempo: one; the window pick: one
  L.S.Fh += 1200; L.S.song.tick = 22.5 * PPQ; V.frame();
  assert.equal(V.state().recomputes, 3, 'a seek');
  L.S.Fh += 3 * 24000; L.S.song.tick = 25.5 * PPQ; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().w0], [4, 24], 'the next window');
  L.S.song.playing = false; L.S.song.cursor = 25 * PPQ; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().playing], [5, false], '■');
  V.frame(); V.frame();
  assert.equal(V.state().recomputes, 5, 'stopped, unchanged: nothing');
  L.S.song.bpm = 128; V.frame();
  L.S.dev.win = 2; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().W], [7, 8], 'the tempo, the window pick');
  // a repost on the same CP and inputs (an amount's): no new preview, no recompute — the combine only; another input set: the curves
  const p0 = V.state().preview, c0 = V.state().combines;
  L.S.pay = Object.assign({}, L.pay, { key: 'k2' }); V.frame();
  assert.deepEqual([V.state().preview === p0, V.state().recomputes, V.state().combines], [true, 7, c0 + 1]);
  L.S.pay = Object.assign({}, L.pay, { key: 'k3', cmb: cmbOf([{ l: 0, a: 1 }, { l: 1, a: 0.5 }], 0) }); V.frame();
  assert.deepEqual([V.state().n, V.state().recomputes], [2, 8], 'an input unplugged: the curves');
  V.destroy();
});

test('(R2-1) a power cycle: a new AudioContext counts frames from 0 — a block below the stored anchors is a new context (posts arrive in order from one thread): every anchor reset and this one taken, the curves recomputed on it', () => {
  const L = live(), V = L.V, S = L.S;
  S.Fh = 5e6; L.post(5e6 + 512, 7.25, 3.5); V.frame();
  const r0 = V.state().recomputes;
  // the old context's last anchor stands; the new one's first block comes at F 2000 (its heard line a little before)
  S.Fh = 1500; S.song.tick = 20.5 * PPQ; L.post(2000, 0.1, 0.6); V.frame();
  const s = V.state();
  assert.ok(s.recomputes > r0, 'recomputed');
  // the time-locked input (k = 1, tri at 0.7 Hz) on the new anchor: x(F) = 0.1 + (F − (2000 − 4))·r at each point's chunk
  let w = 0;
  for (let i = 0; i < s.N; i += 13) {
    const b = s.w0 + s.W * i / (s.N - 1), Fc = LV.chunkOf(1500 + (b - 20.5) * 24000), x = 0.1 + (Fc - 1996) * 0.7 / SR;
    w = Math.max(w, Math.abs(s.vals[i * s.n + 1] - ST.SHAPES.tri(x - Math.floor(x))));
  }
  assert.ok(w <= 1e-12, 'the curve stands on the new context\'s anchor: |Δ| ' + w);
  // the next block of the new context: on the line, nothing more
  const r1 = V.state().recomputes;
  L.post(2000 + 1536, 0.1 + 1536 * 0.7 / SR, 0.6 + 1536 * 2 / SR); V.frame();
  assert.equal(V.state().recomputes, r1, 'the new line holds');
  V.destroy();
});

test('(§6.6, G6) per frame unchanged: the curves canvas is not touched; the overlay repaints only when the playhead or the dot moved (a quarter px), clearing its last boxes only', () => {
  const L = live(), V2 = L.V, S = L.S, cvC = L.cvC, cvO = L.cvO;
  L.post(480512, 7.25, 3.5);
  V2.frame();
  const c0 = calls(cvC), o0 = calls(cvO);
  assert.ok(c0 > 20 && o0 > 3, 'painted once: ' + c0 + ' / ' + o0);
  V2.frame(); V2.frame();
  assert.deepEqual([calls(cvC), calls(cvO)], [c0, o0], 'unchanged: nothing painted');
  V2.restyle(); V2.frame();
  assert.deepEqual([calls(cvC), calls(cvO), V2.state().recomputes], [c0, o0, 1], 'a host\'s sync in the same skin: nothing (a new skin repaints, never recomputes)');
  S.Fh += 480; S.song.tick += 0.02 * PPQ; V2.frame();
  const o1 = calls(cvO);
  assert.equal(calls(cvC), c0, 'the playhead moved: the curves untouched');
  assert.ok(o1 > o0, 'the overlay repainted');
  const cl = cvO._ctx.calls.slice(o0).filter(c => c[0] === 'clearRect');
  assert.ok(cl.length === 1 && cl[0][3] < 20, 'its last boxes cleared only: ' + JSON.stringify(cl));
  V2.destroy();
});

test('(G6, E) an amount / mute / mode change composites cached layers: the ground + grid and each input\'s curve are bitmaps drawn at their alpha (one drawImage each), only the sum\'s path is stroked again; a mute repaints that input\'s layer alone; a recompute draws the inputs straight on (their layers stale), the ground again only when the window\'s length moves; no element added to the face', () => {
  const L = live(), V = L.V, S = L.S, cvC = L.cvC;
  L.post(480512, 7.25, 3.5);
  V.frame();
  const ops = from => cvC._ctx.calls.slice(from).map(c => c[0]);
  const lays = from => cvC._ctx.calls.slice(from).filter(c => c[0] === 'drawImage').map(c => c[1]);
  const nOf = c => (c && c._ctx ? c._ctx.calls.length : 0);
  assert.deepEqual([lays(0).length, ops(0).filter(x => x === 'stroke').length], [1, 3 + 1], 'a recompute: the ground composited, the three inputs and the sum stroked on');
  const G = lays(0)[0], g0 = nOf(G);
  // the first amount: the input layers built once, then composited
  let c0 = cvC._ctx.calls.length;
  S.inputs[1].amt = -0.75; V.dirty(1); V.frame();
  const Ls = lays(c0);
  assert.deepEqual([Ls.length, Ls[0] === G, nOf(G) === g0, ops(c0).filter(x => x === 'stroke').length], [4, true, true, 1], 'the ground kept; one stroke (the sum\'s): ' + ops(c0).join(','));
  assert.ok(Ls.every(c => !c.parentNode), 'offscreen: never in the face');
  const n0 = Ls.map(nOf);
  // the next amount: the composite only
  c0 = cvC._ctx.calls.length;
  S.inputs[0].amt = 0.4; V.dirty(1); V.frame();
  assert.deepEqual([lays(c0).every((c, i) => c === Ls[i]), ops(c0).filter(x => x === 'stroke').length, Ls.map(nOf).join()], [true, 1, n0.join()], 'no layer drawn again');
  // a mute: that input's layer again (dotted), the others not
  S.inputs[2].byp = 1; V.dirty(1); V.frame();
  assert.deepEqual(Ls.map((c, i) => nOf(c) > n0[i]), [false, false, false, true], 'a mute: its layer alone');
  // a recompute (the window's length): the ground again, the inputs straight on; the next amount builds their layers again
  const n1 = Ls.map(nOf);
  S.dev.win = 2; V.frame();
  assert.deepEqual(Ls.map((c, i) => nOf(c) > n1[i]), [true, false, false, false], 'a recompute: the ground (W moved), the input layers stale');
  const n2 = Ls.map(nOf);
  S.inputs[1].amt = 0.3; V.dirty(1); V.frame();
  assert.deepEqual(Ls.map((c, i) => nOf(c) > n2[i]), [false, true, true, true], 'then their layers again');
  V.destroy();
  assert.deepEqual(Ls.map(c => c.width), [0, 0, 0, 0], 'destroy: their memory back');
});

test('(G6) a window edit there and back takes the curves the keys before drew (one deep) — the same values, no input recomputed — while the line and every anchor are still theirs; a restart, a forced recompute (dirty 2) or another window recompute', () => {
  const L = live(), V = L.V, S = L.S;
  L.post(480512, 7.25, 3.5); V.frame();
  const s0 = V.state(), v1 = s0.vals.join();
  S.dev.win = 2; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().memos, V.state().W], [s0.recomputes + 1, 0, 8], 'there: computed');
  S.dev.win = 1; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().memos, V.state().W, V.state().vals.join() === v1], [s0.recomputes + 1, 1, 4, true], 'back: the memo, the same curves');
  L.post(480512 + 1536, 7.25 + 1536 * 0.7 / SR, 3.5 + 1536 * 2 / SR); V.frame(); // (a newer anchor on the line: still theirs)
  S.dev.win = 2; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().memos], [s0.recomputes + 1, 2], 'there again, on the line: the memo');
  L.post(480512 + 3072, 7.25 + 0.4, 3.5 + 3072 * 2 / SR); V.frame();             // (a restart: off the line — recomputed, forced)
  const r1 = V.state().recomputes;
  S.dev.win = 1; V.frame();
  assert.deepEqual([V.state().recomputes, V.state().memos], [r1 + 1, 2], 'after a restart: computed');
  V.dirty(2); V.frame();
  assert.deepEqual([V.state().recomputes, V.state().memos], [r1 + 2, 2], 'dirty 2: computed');
  V.destroy();
});

test('(G6, F) SMOOTH past the chunk budget (SM_MAX): a 2-bar window at 120 BPM draws the SMOOTHed input by the display-step recurrence, dashed, and the sum dashed with it — never claimed exact; 1 bar at 120 BPM stays exact; curveAt (G4) is the exact law at any window (≤ 1e-6 against the worklet model)', () => {
  const lfos = [{ lock: 'song', beats: 1, start: 0, shape: 'sine', sm: 0 }, { lock: 'song', beats: 0.5, start: 0.1, shape: 'square', sm: 0.3 }];
  const ins = [{ l: 0, a: 0.5 }, { l: 1, a: 0.5 }], Sm = ST.sim({ sr: SR, bpm: 120, lfos, ins, Fp: 0, b0: 0, frames: 12 * 24000 });
  const st = { bpm: 120, sig: [4, 4], playing: false, tick: 0, cursor: 0, loop: { on: false, start: 0, end: 0 } }, T = LV.timeline(st, NaN, SR);
  const P = ST.preview(PAY(lfos), SR), N = 384, b1 = Float64Array.from({ length: N }, (_, i) => 4 * i / (N - 1)), b2 = Float64Array.from({ length: N }, (_, i) => 8 * i / (N - 1)), o = new Float64Array(N);
  assert.equal(LV.SM_MAX, 28000);
  assert.equal(LV.inputCurve(P, 1, 'song', T, null, b1, N, o, 1, 0, LV.SM_MAX), 1, '1 bar at 120: exact');
  assert.equal(LV.inputCurve(P, 1, 'song', T, null, b2, N, o, 1, 0, LV.SM_MAX), 2, '2 bars at 120: past the budget — the display-step recurrence');
  assert.equal(LV.inputCurve(P, 1, 'song', T, null, b2, N, o, 1, 0), 1, 'no budget (curveAt): exact');
  // the view: 2 bars → that input dashed, the sum dashed; 1 bar → solid
  const sc = scene({ pay: PAY(lfos, { cmb: cmbOf(ins, 0) }), inputs: inputsOf(ins), dev: { mode: 'add', win: 2, mark: null }, Fh: NaN, song: st });
  sc.V.frame();
  assert.deepEqual([sc.V.state().drawn, sc.V.state().dash], [[1, 2], [false, true]]);
  const ds = sc.cvC._ctx.calls.filter(c => c[0] === 'setLineDash').map(c => c[1].join('/'));
  assert.ok(ds.includes('5/3'), 'the sum dashed: ' + ds.join(' '));
  const qs = []; for (let q = 0; q < Sm.qF.length && (Sm.qF[q] - 4) / 24000 < 8; q++) qs.push(q);
  let w = 0;
  const y = sc.V.curveAt(Float64Array.from(qs.map(q => (Sm.qF[q] - 4) / 24000)));
  qs.forEach((q, i) => { w = Math.max(w, Math.abs(y[i] - Sm.qy[q])); });
  assert.ok(w <= 1e-6, 'curveAt exact at 2 bars: |Δ| ' + w);
  sc.S.dev.win = 1; sc.V.frame();
  assert.deepEqual([sc.V.state().drawn, sc.V.state().dash], [[1, 1], [false, false]], '1 bar: exact, solid');
  sc.V.destroy();
});

test('(§6.4) the live dot: the worklet\'s y read at the heard frame from the ring (bracketed anchors interpolate), guarded by R.live (stale: none); stopped it is a level mark at the left edge, the playhead dashed at the cursor', () => {
  const d = fresh(), cvO = d.createElement('canvas'), S = { Fh: 10000, song: { bpm: 120, sig: [4, 4], playing: true, tick: 10 * PPQ, cursor: 0, loop: { on: false } } };
  const V = LV.createView({ curves: d.createElement('canvas'), overlay: cvO, devKey: 'x1', mc: () => ST.MC, payload: () => null, inputs: () => [], dev: () => ({ mode: 'add', win: 1 }), song: () => S.song, heardFrame: () => S.Fh, sampleRate: () => SR });
  V.push(9000, new Float64Array([0.2]), 0); V.push(11000, new Float64Array([0.6]), 0);
  V.frame();
  close(V.value(), 0.4, 1e-12, 'bracketed');
  S.Fh = 11000 + 0.6 * SR; V.frame();
  assert.ok(Number.isNaN(V.value()), 'stale: no dot');
  S.Fh = 11500; S.song.playing = false; S.song.cursor = 9 * PPQ; V.push(11600, new Float64Array([0.9]), 0); V.frame();
  const g = cvO._ctx.calls, i = g.map(c => c[0]).lastIndexOf('fillRect'), dash = g.filter(c => c[0] === 'setLineDash').at(-2);
  assert.deepEqual([g[i][1], g[i][3]], [0, 8], 'a level mark at the left edge (8 px)');
  assert.deepEqual(dash[1], [3, 3], 'the cursor dashed');
  V.destroy();
});

test('(§6.3, §6.5) the sum is ModCore.combine over the cached inputs at the payload\'s inputs\' order with the list\'s live amounts (muted 0): Add clipped flat at 1 — its tops flat where the knob\'s are; a dashed input dashes the sum; an input with no anchor yet leaves the sum undrawn', () => {
  const lfos = [{ lock: 'song', beats: 1, start: 0, shape: 'sine', sm: 0 }, { lock: 'song', beats: 2, start: 0, shape: 'saw', sm: 0 }];
  const ins = [{ l: 0, a: 1 }, { l: 1, a: 1 }], S = { pay: PAY(lfos, { cmb: cmbOf(ins, 0) }), inputs: inputsOf(ins), dev: { mode: 'add', win: 1 }, Fh: 1e5, song: { bpm: 120, sig: [4, 4], playing: true, tick: 2 * PPQ, loop: { on: false } } };
  const d = fresh(), V = LV.createView({ curves: d.createElement('canvas'), overlay: d.createElement('canvas'), devKey: 'x1', mc: () => ST.MC, payload: () => S.pay, inputs: () => S.inputs, dev: () => S.dev, song: () => S.song, heardFrame: () => S.Fh, sampleRate: () => SR });
  V.frame();
  const s = V.state(), flat = s.sum.filter(v => v === 1).length, over = s.vals.filter((v, i) => i % 2 === 0).map((v, i) => v + s.vals[2 * i + 1]).filter(v => v > 1).length;
  assert.ok(flat > 50 && flat === over, 'clipped flat at 1 exactly where the plain sum passes it: ' + flat + ' / ' + over);
  for (let i = 0; i < s.N; i++) close(s.sum[i], Math.min(1, s.vals[2 * i] + s.vals[2 * i + 1]), 1e-15, 'Add ' + i);
  S.inputs[0].byp = 1; V.dirty(1); V.frame();
  for (let i = 0; i < s.N; i += 17) close(V.state().sum[i], V.state().vals[2 * i + 1], 1e-15, 'muted: the other alone');
  assert.deepEqual(V.state().dash, [false, false]);
  V.destroy();
});

test('(§6.7) the marks: off (mark null) asks nothing; a pick asks the host for the window\'s hits (ticks) — once per window, not per frame', () => {
  const asks = [], lfos = [{ lock: 'song', beats: 1, start: 0, shape: 'sine', sm: 0 }], ins = [{ l: 0, a: 1 }];
  const S = { pay: PAY(lfos, { cmb: cmbOf(ins, 0) }), inputs: inputsOf(ins), dev: { mode: 'add', win: 1, mark: null }, Fh: 1e5, song: { bpm: 120, sig: [4, 4], playing: true, tick: 2 * PPQ, loop: { on: false } } };
  const d = fresh(), V = LV.createView({ curves: d.createElement('canvas'), overlay: d.createElement('canvas'), devKey: 'x1', mc: () => ST.MC, payload: () => S.pay, inputs: () => S.inputs, dev: () => S.dev, song: () => S.song,
    heardFrame: () => S.Fh, sampleRate: () => SR, marks: (t0, t1) => { asks.push([t0, t1]); return [0, 960, 1920, 2880]; } });
  V.frame(); V.frame();
  assert.deepEqual(asks, [], 'Off: nothing (Q3)');
  S.dev = { mode: 'add', win: 1, mark: { t: 'trk_2', n: 36 } }; V.frame(); V.frame();
  assert.deepEqual([asks, V.state().marks], [[[0, 3840]], [0, 960, 1920, 2880]]);
  V.destroy();
});

test('(§7.2) lc-view is loaded on demand: no site file imports it statically; cv-mods-ui names it in a literal import() (precached); the module touches no DOM at its top level', () => {
  const site = readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.js') && f !== 'sw.js');
  const stat = [], dyn = [];
  for (const f of site) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    if (/\b(?:import|export)\s[^;()]*?from\s*['"]\.\/lc-view\.js/.test(src)) stat.push(f);
    if (/\bimport\(\s*['"]\.\/lc-view\.js\?v=9['"]\s*\)/.test(src)) dyn.push(f);
  }
  assert.deepEqual([stat, dyn], [[], ['cv-mods-ui.js']]);
  assert.ok(readFileSync(new URL('../sw.js', import.meta.url), 'utf8').includes('lc-view.js'), 'in the precache list (tools/precache.mjs --write)');
});
