import './v8-guard.mjs';
// motion.js — the heard-time anchor ring (FR Cut B phase 0, docs/canvas/IMPL-FR-B.md §3; the skeptic's P2-9): every kind bracketed
// and exact (LIN, PH with its wrap and its step rule, HOLD, TIME with its group and forward-only rule, POS forward-only, PEAK drained
// once), past the newest (LIN / POS for ≤ 2 intervals and clamped, PH by the last pair's step, TIME at 1 s / s, the 0.25 s bound,
// HELD), BEFORE / NONE, a flush on a backward F, a replace on an equal F, the ring's overflow, age / live, a 1e8-frame axis, the
// layouts (SXF, SLOT, MASTER, grKinds) and no allocation after construction. Pure (no DOM): numbers only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/motion.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { noAlloc } from './dsp-scope.mjs';
import * as M from '../motion.js?v=9';

const { K, ST, ring } = M;
const SR = 48000;
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const r6 = x => Math.round(x * 1e6) / 1e6;
const one = (kind, o) => ring(1, [kind], o);
const out1 = new Float64Array(1);
const read = (R, Fh) => { out1[0] = -999; const st = R.at(Fh, out1, SR); return [st, out1[0]]; };

test('the layouts: SXF (70 fixed floats: kinds, TIME groups, ranges), SLOT_K / SLOT_G, MASTER_K and its ranges', () => {
  const S = M.SXF;
  assert.deepEqual([S.mix, S.wtPos, S.smpPos, S.noisePos, S.notes, S.lfoPh, S.lfoOut, S.lfoY, S.env, S.envStage, S.envT, S.N], [0, 11, 14, 26, 27, 28, 38, 48, 58, 62, 66, 70]);
  const k = M.SXF_K, cnt = (a, b, v) => { let n = 0; for (let j = a; j < b; j++) if (k[j] === v) n++; return n; };
  assert.equal(k.length, 70);
  assert.deepEqual([cnt(0, 11, K.PEAK), cnt(11, 14, K.LIN), cnt(28, 38, K.PH), cnt(38, 58, K.LIN), cnt(58, 62, K.LIN), cnt(62, 66, K.HOLD), cnt(66, 70, K.TIME)], [11, 3, 10, 20, 4, 4, 4]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(j => k[14 + j]), [K.POS, K.HOLD, K.HOLD, K.HOLD, K.POS, K.HOLD, K.HOLD, K.HOLD, K.POS, K.HOLD, K.HOLD, K.HOLD], 'smpPos: the position POS, the markers HOLD');
  assert.deepEqual([k[26], k[27]], [K.PH, K.HOLD], 'noisePos PH, notes HOLD');
  assert.deepEqual([66, 67, 68, 69].map(j => M.SXF_G[j]), [62, 63, 64, 65], 'envT grouped with envStage');
  assert.equal(M.SXF_G.filter(g => g >= 0).length, 4);
  for (let j = 0; j < 70; j++) {
    const lin = k[j] === K.LIN || k[j] === K.POS;
    assert.deepEqual([M.SXF_LO[j], M.SXF_HI[j]], lin ? [0, 1] : [-Infinity, Infinity], 'the range of field ' + j);
  }
  assert.deepEqual([[...M.SLOT_K.lfo], [...M.SLOT_K.env], [...M.SLOT_K.chaos], [...M.SLOT_G.env]], [[K.LIN, K.PH, K.LIN, K.LIN], [K.LIN, K.HOLD, K.TIME], [K.LIN], [-1, -1, 1]]);
  assert.deepEqual([...M.MASTER_K], [K.PEAK, K.PEAK, K.PEAK, K.PEAK, K.LIN, K.LIN, K.LIN]);
  assert.deepEqual([M.MASTER_LO[4], M.MASTER_HI[4]], [-1, 1], 'the correlation clamp');
  assert.deepEqual([M.RING_N, M.EXTRA_S, M.EXTRA_N, M.STALE_S, M.PH_STEP], [128, 0.25, 2, 0.5, 0.25], '(review 1, R1-C) RING_N 128: 1.07 s at 120 Hz, a Bluetooth output delay inside it');
});

test('grKinds: a rack\'s GR block 4·(the highest index + 1) long, LIN, a Ducker\'s position POS; an out of that length reused', () => {
  const g = M.grKinds([{ idx: 0, type: 'cmp' }, { idx: 2, type: 'duck' }]);
  assert.equal(g.length, 12);
  assert.deepEqual([...g], [0, 0, 0, 0, 0, 0, 0, 0, 0, K.POS, 0, 0]);
  const out = new Uint8Array(12).fill(9), g2 = M.grKinds([{ idx: 1, type: 'duck' }, { idx: 2, type: 'cmp' }], out);
  assert.deepEqual([g2 === out, [...g2].join()], [true, '0,0,0,0,0,5,0,0,0,0,0,0']);
  assert.equal(M.grKinds([]).length, 0);
});

test('LIN: linear between the bracketing anchors, EXACT on an anchor, a non-finite end holds the older', () => {
  const R = one(K.LIN);
  R.push(1000, [0.2]); R.push(1400, [0.6]);
  assert.deepEqual(read(R, 1100).map(r6), [ST.BRACKET, 0.3]);
  assert.deepEqual(read(R, 1000), [ST.EXACT, 0.2]);
  assert.deepEqual(read(R, 1400), [ST.EXACT, 0.6]);
  const Q = one(K.LIN);
  Q.push(0, [-Infinity]); Q.push(400, [-10]);
  assert.deepEqual(read(Q, 200), [ST.BRACKET, -Infinity], 'silence → a level: no NaN');
  Q.push(800, [NaN]);
  assert.deepEqual(read(Q, 600), [ST.BRACKET, -10]);
});

test('PH: the shortest way round, wrapped to [0, 1); a step over a quarter cycle holds the older (a fast LFO, a retrigger)', () => {
  const R = one(K.PH);
  R.push(0, [0.9]); R.push(400, [0.1]);
  assert.deepEqual(read(R, 200).map(r6), [ST.BRACKET, 0], 'through the wrap');
  assert.deepEqual(read(R, 300).map(r6), [ST.BRACKET, 0.05]);
  const Q = one(K.PH);
  Q.push(0, [0.1]); Q.push(400, [0.5]);                     // (0.4 a step: above PH_STEP)
  assert.deepEqual(read(Q, 200), [ST.BRACKET, 0.1]);
  const T = one(K.PH);
  T.push(0, [0.6]); T.push(400, [0.05]);                    // (a retrigger: −0.55 → +0.45 the short way, held)
  assert.deepEqual(read(T, 399), [ST.BRACKET, 0.6]);
  assert.deepEqual(read(T, 400), [ST.EXACT, 0.05], 'the jump shows at its anchor');
  const B = one(K.PH);
  B.push(0, [0.3]); B.push(400, [0.2]);                     // (backwards, a small step: followed)
  assert.deepEqual(read(B, 200).map(r6), [ST.BRACKET, 0.25]);
});

test('HOLD: the anchor at F0 until the next one', () => {
  const R = one(K.HOLD);
  R.push(0, [3]); R.push(400, [5]);
  assert.deepEqual([read(R, 399)[1], read(R, 400)[1]], [3, 5]);
});

test('TIME: linear inside one stage going forward; a stage change between the anchors, or a time going back, holds the older', () => {
  const R = ring(2, [K.HOLD, K.TIME], { groups: [-1, 0] }), o = new Float64Array(2);
  R.push(0, [1, 0.10]); R.push(480, [1, 0.11]); R.push(960, [3, 0.002]); R.push(1440, [3, 0.001]);
  R.at(240, o, SR); assert.deepEqual([o[0], r6(o[1])], [1, 0.105], 'the same stage: linear');
  R.at(720, o, SR); assert.deepEqual([o[0], o[1]], [1, 0.11], 'the stage changes before the next anchor: held');
  R.at(1200, o, SR); assert.deepEqual([o[0], o[1]], [3, 0.002], 'the time went back: held');
  const U = one(K.TIME);
  U.push(0, [0.5]); U.push(480, [0.51]);
  assert.deepEqual(read(U, 240).map(r6), [ST.BRACKET, 0.505], 'no group: forward-only linear');
});

test('POS: linear only when 0 ≤ p0 ≤ p1, else HOLD (a Ducker\'s −1, a dip restarting, a loop wrapping back)', () => {
  const R = one(K.POS);
  R.push(0, [0.2]); R.push(400, [0.6]); R.push(800, [-1]); R.push(1200, [0.1]); R.push(1600, [0.9]); R.push(2000, [0.05]);
  assert.deepEqual([read(R, 200), read(R, 600), read(R, 1000), read(R, 1400), read(R, 1800)].map(x => r6(x[1])), [0.4, 0.6, -1, 0.5, 0.9]);
});

test('PEAK: the max of the anchors heard since the last read, each drained once; a read with nothing new returns the previous result (drained false)', () => {
  const R = one(K.PEAK);
  R.push(100, [-10]); R.push(200, [-3]); R.push(300, [-20]);
  assert.deepEqual([read(R, 250), R.drained], [[ST.BRACKET, -3], true]);
  assert.deepEqual([read(R, 250), R.drained], [[ST.BRACKET, -3], false], 'the same Fh again: the same value, nothing new');
  assert.deepEqual([read(R, 300), R.drained], [[ST.EXACT, -20], true], 'the anchor at 300 alone');
  assert.deepEqual([read(R, 310), R.drained], [[ST.EXTRA, -20], false]);
  R.push(400, [-6]); R.push(500, [-8]);
  assert.deepEqual([read(R, 1000), R.drained], [[ST.EXTRA, -6], true], 'two anchors in one read: their max');
  assert.deepEqual(read(R, 50), [ST.BEFORE, -999], 'before the oldest: nothing read');
});

test('past the newest: LIN / POS by the last pair\'s slope for ≤ 2 intervals, clamped, then the newest; PH by the last pair while its step ≤ 0.25; TIME at 1 s / s; HELD past 0.25 s', () => {
  const L = one(K.LIN, { lo: [0], hi: [1] });
  L.push(0, [0.1]); L.push(400, [0.2]);
  assert.deepEqual([read(L, 600), read(L, 1200), read(L, 1201)].map(x => [x[0], r6(x[1])]), [[ST.EXTRA, 0.25], [ST.EXTRA, 0.4], [ST.EXTRA, 0.2]], 'two intervals, then the newest');
  const C = one(K.LIN, { lo: [0], hi: [1] });
  C.push(0, [0.9]); C.push(400, [0.98]);
  assert.deepEqual(read(C, 800).map(r6), [ST.EXTRA, 1], 'clamped to the field\'s range');
  const solo = one(K.LIN);
  solo.push(400, [0.7]);
  assert.deepEqual(read(solo, 500), [ST.EXTRA, 0.7], 'one anchor: the newest');
  const P = one(K.POS);
  P.push(0, [0.2]); P.push(400, [0.3]); P.push(800, [0.1]);
  assert.deepEqual(read(P, 900), [ST.EXTRA, 0.1], 'POS: the last pair went back — the newest');
  const P2 = one(K.POS, { hi: [1] });
  P2.push(0, [0.2]); P2.push(400, [0.3]);
  assert.deepEqual(read(P2, 600).map(r6), [ST.EXTRA, 0.35]);
  const H = one(K.PH);
  H.push(0, [0.1]); H.push(400, [0.2]);
  assert.deepEqual(read(H, 1000).map(r6), [ST.EXTRA, 0.35], 'PH: beyond 2 intervals too, by the slope');
  assert.deepEqual(read(H, 400 + 0.25 * SR).map(r6), [ST.EXTRA, r6((0.2 + 0.1 / 400 * 0.25 * SR) % 1)], 'PH: up to 0.25 s');
  assert.deepEqual(read(H, 401 + 0.25 * SR), [ST.HELD, 0.2], 'past 0.25 s: HELD, the newest');
  const H2 = one(K.PH);
  H2.push(0, [0.1]); H2.push(400, [0.45]);
  assert.deepEqual(read(H2, 500), [ST.EXTRA, 0.45], 'PH: the last pair stepped over a quarter cycle — the newest');
  const T = one(K.TIME);
  T.push(0, [0.04]); T.push(400, [0.05]);
  assert.deepEqual(read(T, 1360).map(r6), [ST.EXTRA, r6(0.05 + 960 / SR)], 'TIME: the stage runs on');
  const Ho = one(K.HOLD);
  Ho.push(0, [1]); Ho.push(400, [2]);
  assert.deepEqual(read(Ho, 900), [ST.EXTRA, 2]);
});

test('BEFORE / NONE; a backward F flushes, an equal F replaces; the ring keeps its n newest; age and live', () => {
  const R = one(K.LIN, { n: 4 });
  assert.deepEqual([read(R, 0), R.size, R.newest(), R.oldest(), R.age(0, SR), R.live(0, SR)], [[ST.NONE, -999], 0, NaN, NaN, Infinity, false]);
  R.push(NaN, [1]); R.push(Infinity, [1]);
  assert.equal(R.size, 0, 'a non-finite F is ignored');
  R.push(1000, [0.5]);
  assert.deepEqual([read(R, NaN), read(R, 999)], [[ST.NONE, -999], [ST.BEFORE, -999]]);
  R.push(10, [0.1]);
  assert.deepEqual([R.size, R.oldest()], [1, 10], 'a backward F: a new axis');
  R.push(10, [0.3]);
  assert.deepEqual([R.size, read(R, 10)], [1, [ST.EXACT, 0.3]], 'an equal F replaces');
  for (let k = 1; k <= 5; k++) R.push(10 + 400 * k, [k]);
  assert.deepEqual([R.size, R.oldest(), R.newest()], [4, 810, 2010], 'the four newest');
  assert.deepEqual([r6(R.age(2010 + 0.4 * SR, SR)), R.live(2010 + 0.4 * SR, SR), R.live(2010 + 0.6 * SR, SR), R.age(1000, SR) < 0, R.live(1000, SR)], [0.4, true, false, true, true]);
  R.flush();
  assert.deepEqual([R.size, R.live(2010, SR)], [0, false]);
});

test('a 1e8-frame axis (35 min at 48 kHz): exact interpolation; a 70-float SXF ring with its groups and ranges', () => {
  const R = one(K.LIN);
  R.push(1e8, [0]); R.push(1e8 + 400, [1]);
  assert.deepEqual(read(R, 1e8 + 100), [ST.BRACKET, 0.25]);
  const S = ring(70, M.SXF_K, { groups: M.SXF_G, lo: M.SXF_LO, hi: M.SXF_HI }), a = new Float64Array(70), b = new Float64Array(70), o = new Float64Array(70);
  a[M.SXF.mix] = -12; b[M.SXF.mix] = -6; a[M.SXF.lfoPh] = 0.95; b[M.SXF.lfoPh] = 0.05; a[M.SXF.lfoOut] = 0.2; b[M.SXF.lfoOut] = 0.4;
  a[M.SXF.envStage] = 1; b[M.SXF.envStage] = 1; a[M.SXF.envT] = 0.01; b[M.SXF.envT] = 0.02; a[M.SXF.notes] = 1; b[M.SXF.notes] = 2;
  S.push(48000, a); S.push(48400, b);
  assert.equal(S.at(48200, o, SR), ST.BRACKET);
  assert.deepEqual([o[M.SXF.mix], r6(o[M.SXF.lfoPh]), r6(o[M.SXF.lfoOut]), r6(o[M.SXF.envT]), o[M.SXF.notes]], [-12, 0, 0.3, 0.015, 1], 'PEAK the anchors heard, PH through the wrap, LIN, TIME, HOLD');
  assert.equal(S.at(48400 + 800, o, SR), ST.EXTRA);
  assert.deepEqual([r6(o[M.SXF.lfoOut]), o[M.SXF.mix]], [0.8, -6], 'two intervals past the newest');
});

test('no allocation after construction: pushes and reads of every kind, bracketed, extrapolated, held, before', () => {
  const R = ring(70, M.SXF_K, { groups: M.SXF_G, lo: M.SXF_LO, hi: M.SXF_HI }), src = new Float32Array(70), o = new Float64Array(70);
  const G = ring(12, M.grKinds([{ idx: 2, type: 'duck' }])), g = new Float32Array(12), go = new Float64Array(12);
  noAlloc(globalThis, () => {
    for (let k = 0; k < 2000; k++) {
      for (let j = 0; j < 70; j++) src[j] = (k * 0.013 + j * 0.01) % 1;
      R.push(400 * k, src); G.push(400 * k, g);
      R.at(400 * k - 150, o, SR); R.at(400 * k + 700, o, SR); R.at(400 * k + 20000, o, SR); R.at(-1, o, SR); G.at(400 * k - 10, go, SR);
      R.age(400 * k, SR); R.live(400 * k, SR); R.newest(); R.oldest();
    }
  });
  assert.equal(R.size, M.RING_N);
});

test('(review 1, R1-B) push(F, src, off, sr): a post more than EXTRA_S past the newest starts the ring afresh — a part that left the fast ids and came back never brackets across the gap (the frames before it is heard: BEFORE, the caller\'s values); within EXTRA_S, or without sr, the ring extends as before', () => {
  const R = one(K.LIN), F3 = 1400 + M.EXTRA_S * SR + 1;
  R.push(1000, [0.1], 0, SR); R.push(1400, [0.1], 0, SR); R.push(F3, [0.9], 0, SR); R.push(F3 + 400, [0.9], 0, SR);
  assert.deepEqual([R.size, R.oldest(), read(R, F3 - 100), read(R, F3 + 200)], [2, F3, [ST.BEFORE, -999], [ST.BRACKET, 0.9]], 'afresh at the gap');
  const Q = one(K.LIN), F4 = 1000 + M.EXTRA_S * SR;
  Q.push(1000, [0.1], 0, SR); Q.push(F4, [0.9], 0, SR);
  assert.deepEqual([Q.size, read(Q, (1000 + F4) / 2).map(r6)], [2, [ST.BRACKET, 0.5]], 'exactly EXTRA_S: extended');
  const P = one(K.LIN);
  P.push(1000, [0.1]); P.push(F3, [0.9]);
  assert.deepEqual([P.size, read(P, F3 - 100)[0]], [2, ST.BRACKET], 'no sr: no gap rule');
  const B = one(K.LIN);
  B.push(5000, [0.5], 0, SR); B.push(10, [0.2], 0, SR);
  assert.deepEqual([B.size, B.oldest()], [1, 10], 'a backward F still flushes');
});
