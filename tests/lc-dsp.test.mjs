import './v8-guard.mjs';
// Stage LC lane E (docs/canvas/IMPL-LC.md §3, §5.1, §5.2, §5.4; G3, the E half of G4): the combiner in ModCore.
//   the law   ModCore.combine(mode, n, a, x, ax, xx) against a double reference over 2 000 random states (n 0…12, amounts ±, mutes,
//             both modes): Add = clamp01(Σ c), Multiply = clamp01(Π (1 − |a| + c)), c = a·x (a ≥ 0) | −a·(1 − x); no input / every
//             input muted → 0; the clip flat at 1 (Q1); one input at +100 % (the rest muted) = x bit for bit in both modes
//   the span  setRows' cmb (validated before anything is written, E6); per chunk the value source's g row = combine over the
//             inputs' g rows, not glided; the monitor block MC.cb [y, then per input x (the clock the next chunk reads, at the
//             post's frame), r (cycles per base frame), v (its g value at the last chunk)] only while monitored; no allocation; no
//             cmb → combine never called (a spy)
//   preview   ModCore.preview(pay, sr) — lock / playX / read / rate / tau on the payload's own CP — against the worklet's ModCore
//             (the same payload): every chunk of 8 s, ▶ from a cursor, a loop wrap, a seek, 128 BPM — 'song' inputs (BPM ¼ / dotted /
//             triplet anchored, Hz 0.7 + ANCHOR, PHASE, ping-pong) from the closed form, 'time' ones (Hz 0.7 / BPM ⅛ free, a Path
//             LFO) from ▶ and across the wrap from the monitor's anchor: |Δ| ≤ 1e-6; SMOOTH 0.3 by the chunk-rate recurrence
// Numbers and strings only into assert. Run alone: node --max-old-space-size=2048 --test tests/lc-dsp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, noAlloc, source } from './dsp-scope.mjs';
import * as G from '../cv-graph.js?v=9';
import * as MO from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import * as C from '../serum-core.js?v=9';
import { tracks as tracks2b } from './fixtures/mods-2b.mjs';

const SR = 48000, BPM = 128, P = { bpm: BPM, perf: { wheel: null }, tracks: [], pads: [] };
const hzN = hz => Math.pow(hz / 100, 0.25);
const ladN = label => C.LFO_LADDER.findIndex(x => x.label === label) / (C.LFO_LADDER.length - 1);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const LSRC = [5, 6, 7, 8, 9, 10, 11, 12, 35, 36];
const D = dspScope({ fast: true }), M = D.global('ModCore');

// the double reference: the sum from 0, the product from 1, in input order
function ref(mode, A, X) {
  if (!A.some(a => a !== 0)) return 0;
  let s = mode === 1 ? 1 : 0;
  for (let k = 0; k < A.length; k++) {
    const a = A[k], c = a >= 0 ? a * X[k] : -a * (1 - X[k]);
    if (mode === 1) s *= 1 - Math.abs(a) + c; else s += c;
  }
  return clamp01(s);
}
function rnd(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

test('G3 the law: combine ≡ the double reference over 2 000 random states (n 0…12, ± amounts, mutes, Add / Multiply, offsets); empty / all muted → 0; Add clips flat at 1; one input at +100 % = x exactly; no allocation', () => {
  assert.equal(typeof M.combine, 'function');
  const r = rnd(0x1c), A = new Float64Array(16), X = new Float64Array(16);
  let n0 = 0, clip = 0;
  for (let i = 0; i < 2000; i++) {
    const n = (r() * 13) | 0, mode = i & 1, ax = (r() * 3) | 0, xx = (r() * 3) | 0, a = [], x = [];
    for (let k = 0; k < n; k++) { const m = r() < 0.15; a.push(m ? 0 : (r() < 0.2 ? 1 : 2 * r() - 1)); x.push(r() < 0.1 ? (r() < 0.5 ? 0 : 1) : r()); }
    A.fill(NaN); X.fill(NaN); A.set(a, ax); X.set(x, xx);
    const y = M.combine(mode, n, A, X, ax, xx), w = ref(mode, a, x);
    assert.ok(Object.is(y, w), `state ${i} (mode ${mode}, n ${n}): ${y} vs ${w}`);
    if (n === 0 || a.every(v => v === 0)) { n0++; assert.equal(y, 0); }
    if (mode === 0 && a.reduce((s, v, k) => s + (v >= 0 ? v * x[k] : -v * (1 - x[k])), 0) > 1) { clip++; assert.equal(y, 1, 'clipped flat'); }
  }
  assert.ok(n0 > 50 && clip > 50, 'empty / muted ' + n0 + ', clipped ' + clip);
  for (let i = 0; i < 500; i++) {
    const n = 1 + ((r() * 8) | 0), j = (r() * n) | 0, x = Float64Array.from({ length: n }, () => r()), a = new Float64Array(n);
    a[j] = 1;
    assert.ok(Object.is(M.combine(0, n, a, x, 0, 0), x[j]) && Object.is(M.combine(1, n, a, x, 0, 0), x[j]), 'identity at input ' + j);
  }
  assert.deepEqual([M.combine(0, 2, [1, 1], [0.8, 0.7], 0, 0), M.combine(0, 2, [1, -1], [0.8, 0.7], 0, 0), M.combine(1, 2, [0, 0], [0.8, 0.7], 0, 0), M.combine(1, 0, [], [], 0, 0)], [1, clamp01(0.8 + 0.3), 0, 0]);
  const a2 = new Float64Array([0.5, -0.5, 1]), x2 = new Float64Array([0.2, 0.9, 0.4]);
  noAlloc(D, () => { for (let k = 0; k < 1000; k++) { M.combine(0, 3, a2, x2, 0, 0); M.combine(1, 3, a2, x2, 0, 0); } });
});

// a Juno i2 (+ the fixture's rig i1 and panel) with GLOBAL LFOs l1…l5 and a PER NOTE l6; x1 (Add) and x2 (Multiply)
const lfo = (lf, o = {}) => S.normModDev(Object.assign({ kind: 'lfo', lfo: Object.assign({ mono: 1, mode: 'free', bpm: 0, anchor: 0 }, lf), rate: hzN(0.7) }, o));
function track(lfos) {
  const t = tracks2b()[0];
  t.id = 'trk_lcd'; t.mods = []; t.mid = 1; delete t.dev.l1;
  lfos.forEach((d, k) => { t.dev['l' + (k + 1)] = d; });
  t.dev.x1 = S.normModDev({ kind: 'comb' }); t.dev.x2 = S.normModDev({ kind: 'comb', mode: 'mul' });
  return t;
}
const add = (t, src, dst, o = {}) => { const r = MO.addMod(t, src, dst, Object.assign({ project: P }, o)); assert.ok(r.ok, src + ' → ' + dst + ': ' + r.why); return r.row; };
const payOf = t => Object.assign({}, G.compileMods(t, P, {}), { bpm: BPM });
// a ModCore on a stub host: the song clock (beat at the span's first frame while playing), ▶ / a seek (transport) and a wrap (a jump)
function driver(pay, MM = M) {
  const st = { F: 0, play: false, F0: 0, b0: 0 };
  const T = { trackId: 'trk_lcd', offline: false, wheel: 0, at: 0, bendRaw: 0, songBeat() { return st.play ? st.b0 + (st.F - st.F0) * BPM / (60 * SR) : null; } };
  const MC = MM.create(T, SR);
  MC.setRows(pay);
  return {
    MC, st, g: MC.sx.mod.g,
    span(n = 128) { MC.span(st.F, n, n >> 2); st.F += n; },
    play(b0) { st.play = true; st.F0 = st.F; st.b0 = b0; MC.transport(true); },
    jump(b) { st.F0 = st.F; st.b0 = b; },
    beat(F) { return st.b0 + (F - st.F0) * BPM / (60 * SR); },
  };
}
function twoComb() {
  const t = track([lfo({}), lfo({ bpm: 1, anchor: 1 }, { rate: ladN('1/4') }), lfo({ type: 'path' }, { rate: hzN(1.3) }), lfo({}, { rate: hzN(3), smooth: 0.3 }), lfo({ dir: 'pp' }, { rate: hzN(2) }), lfo({ mono: 0 })]);
  add(t, 'l1.out', 'x1:in'); add(t, 'l2.out', 'x1:in', { amt: -0.5 }); add(t, 'l3.out', 'x1:in', { amt: 0.3 }); add(t, 'l4.out', 'x1:in', { byp: 1 });
  add(t, 'l5.out', 'x2:in', { amt: 0.7 }); add(t, 'l6.out', 'x2:in'); add(t, 'l1.out', 'x2:in', { amt: -1 });
  add(t, 'x1.out', 'i2:cf', { amt: 0.5 }); add(t, 'x2.out', 'i2:rs', { amt: 0.5 });
  return t;
}

test('G3 the span: per chunk g[(62 + k − 8)·32 + c] = combine over the inputs\' g rows (the payload\'s amounts, a muted one 0), not glided (MC.ctl on k has no effect); a later chunk / span never reads a stale row', () => {
  const pay = payOf(twoComb()), W = driver(pay), MC = W.MC;
  assert.equal(MC.cmbN, 2);
  W.span(); MC.ctl(pay.cmb[0].k, 0.9);
  let n = 0;
  for (let s = 0; s < 400; s++) {
    if (s === 37) W.play(3); if (s === 211) W.jump(1); if (s === 300) W.span(64);
    W.span();
    for (const c of pay.cmb) {
      const o = (G.S_EXT0 + c.k - 8) * 32, A = c.in.map(x => x.a);
      for (let ch = 0; ch < 32; ch++) {
        const X = c.in.map(x => W.g[x.src * 32 + ch]), y = W.g[o + ch];
        if (!Object.is(y, ref(c.mode, A, X))) assert.fail(`span ${s} ${c.id} chunk ${ch}: ${y} vs ${ref(c.mode, A, X)}`);
        n++;
      }
    }
  }
  assert.ok(n > 25000);
  assert.ok(Object.is(MC.vUse[pay.cmb[0].k], 0), 'the combiner\'s value slot is not a glided value source');
});

test('G3 the monitor block (§5.2): MC.cb = Float64Array(Σ 1 + 3n) [y, x, r, v …] written only while monitored (watch on: at once); x the clock of the last chunk (a time-locked input: x + 128·r one span later, mod 1; ≡ playX at that chunk\'s beat), r cycles per base frame, v the g value of the last chunk', () => {
  const pay = payOf(twoComb()), W = driver(pay), MC = W.MC, cb = MC.cb, PVm = M.preview(pay, SR);
  assert.ok(cb instanceof D.ctx.Float64Array && cb.length === pay.cmb.reduce((s, c) => s + 1 + 3 * c.in.length, 0));
  W.span(); cb.fill(NaN); W.span();
  assert.ok(Array.from(cb).every(x => Number.isNaN(x)), 'not monitored: nothing written');
  MC.watch(1);
  assert.ok(Array.from(cb).every(x => Number.isFinite(x)), 'watch on: written at once');
  W.play(0);
  let prev = null;
  for (let s = 0; s < 60; s++) {
    W.span();
    const sl = pay.slots, c = pay.cmb[0], i = sl.x1.i;
    assert.ok(Object.is(cb[i], W.g[(G.S_EXT0 + c.k - 8) * 32 + 31]), 'y');
    for (let q = 0; q < c.in.length; q++) assert.ok(Object.is(cb[i + 1 + 3 * q + 2], W.g[c.in[q].src * 32 + 31]), 'v of input ' + q);
    const x = cb[i + 1], r = cb[i + 2];
    assert.ok(Math.abs(r - Math.pow(hzN(0.7), 4) * 100 / SR) < 1e-15, 'r of l1 (0.7 Hz)');
    if (prev !== null) { const d = x - (prev + 128 * r); assert.ok(Math.abs(d - Math.round(d)) < 1e-9, 'l1 time-locked: ' + d); }
    { const e = x - PVm.playX(c.in[0].l, W.beat(W.st.F - 4), 0); assert.ok(Math.abs(e - Math.round(e)) < 1e-9, 'x = the last chunk\'s clock: ' + e); }
    prev = x;
  }
  MC.watch(0); cb.fill(NaN); W.span();
  assert.ok(Number.isNaN(cb[0]), 'off again: nothing written');
  MC.watch(1);
  noAlloc(D, () => { for (let s = 0; s < 100; s++) W.span(); });
  MC.watch(0);
  noAlloc(D, () => { for (let s = 0; s < 100; s++) W.span(); });
});

test('E6: a malformed cmb (not an array, k out of 8…23 or twice, mode not 0 / 1, in not an array, an input\'s src / l out of range, a non-finite amount) is refused before anything is written — the previous rows, combiners and block kept', () => {
  const pay = payOf(twoComb()), W = driver(pay), MC = W.MC, cb = MC.cb, cp = MC.cp;
  const c0 = pay.cmb[0], bad = [{}, 3, [null], [Object.assign({}, c0, { k: 7 })], [Object.assign({}, c0, { k: 24 })], [c0, Object.assign({}, pay.cmb[1], { k: c0.k })], [Object.assign({}, c0, { mode: 2 })],
    [Object.assign({}, c0, { in: null })], [Object.assign({}, c0, { in: [{ row: 'r1', src: 0, l: 0, a: 1 }] })], [Object.assign({}, c0, { in: [{ row: 'r1', src: 5, l: 10, a: 1 }] })],
    [Object.assign({}, c0, { in: [{ row: 'r1', src: 5, l: 0, a: NaN }] })]];
  for (const cmb of bad) {
    assert.throws(() => MC.setRows(Object.assign({}, pay, { cmb, cp: Object.assign({}, pay.cp) })), /cmb/, JSON.stringify(cmb).slice(0, 80));
    assert.ok(MC.cb === cb && MC.cmbN === 2 && MC.cp === cp, 'kept');
  }
  MC.setRows(Object.assign({}, pay, { cmb: undefined }));
  assert.deepEqual([MC.cmbN, MC.cb.length], [0, 0], 'a payload without cmb: no combiner');
});

test('G3 / D1: without cmb ModCore.combine is never called (a spy in the script) — 300 spans of a payload with rows and ext; with cmb it is, per chunk per combiner', () => {
  const src = source('mod-core.js'), hook = 'function combine(mode, n, a, x, ax, xx) {';
  assert.ok(src.includes(hook), 'the law is one function');
  const DS = dspScope({ fast: true, overrides: { 'mod-core.js': s => s.replace(hook, hook + ' globalThis.__lcCalls = (globalThis.__lcCalls | 0) + 1;') } }), MS = DS.global('ModCore');
  const t = track([lfo({}), lfo({ bpm: 1, anchor: 1 }, { rate: ladN('1/4') })]);
  add(t, 'l1.out', 'i2:cf'); add(t, 'l2.out', 'i1:f.cutoff');
  const W = driver(payOf(t), MS);
  for (let s = 0; s < 300; s++) { if (s === 20) W.play(0); W.span(); }
  assert.equal(DS.ctx.__lcCalls | 0, 0, 'never called');
  const W2 = driver(payOf(twoComb()), MS);
  for (let s = 0; s < 10; s++) W2.span();
  assert.equal(DS.ctx.__lcCalls, 10 * 32 * 2);
});

// the preview's curve against the worklet: every chunk of every span
function g4(t, { lockOk, seconds = 8, b0 = 2.5, smooth = false } = {}) {
  const pay = payOf(t), W = driver(pay), PV = M.preview(pay, SR), c = pay.cmb[0], dB = 4 * BPM / (60 * SR);
  assert.ok(PV && typeof PV.read === 'function' && typeof PV.playX === 'function');
  for (const x of c.in) assert.equal(PV.lock(x.l), lockOk[x.l], 'lock of slot ' + x.l);
  W.MC.watch(1);
  for (let s = 0; s < 20; s++) W.span();
  W.play(b0);
  const N = Math.round(seconds * SR / 128), wrapAt = Math.round(N * 0.6), anch = new Map();
  let worst = 0, cnt = 0, pass = 0;
  const lo = c.in.map(() => Infinity), hi = c.in.map(() => -Infinity);
  for (let s = 0; s < N; s++) {
    if (s === wrapAt) { W.jump(b0 + 1); pass = 1; }
    const F = W.st.F, sb = W.beat(F);
    W.span();
    c.in.forEach((x, q) => {
      const lk = PV.lock(x.l);
      for (let ch = 0; ch < 32; ch++) {
        const b = sb + ch * dB;
        let X;
        if (lk === 'song') X = PV.playX(x.l, b, b0);
        else if (pass === 0) X = PV.playX(x.l, b, b0);
        else { const a = anch.get(q); if (!a) continue; X = a.x + (F + 4 * ch - a.F) * a.r; }
        const y = W.g[x.src * 32 + ch], d = Math.abs(y - PV.read(x.l, X));
        if (d > worst) worst = d;
        if (y < lo[q]) lo[q] = y; if (y > hi[q]) hi[q] = y;
        cnt++;
      }
      if (s === wrapAt - 1) { const i = pay.slots.x1.i + 1 + 3 * q; anch.set(q, { F: W.st.F - 4, x: W.MC.cb[i], r: W.MC.cb[i + 1] }); } // (x: the last chunk's, starting 4 frames before the span's end)
    });
  }
  PV.destroy();
  return { worst, cnt, range: Math.min(...c.in.map((x, q) => hi[q] - lo[q])) };
}

test('G4 (E half): the preview\'s read of the playX / anchor clock ≡ the worklet\'s g rows at every chunk of 8 s at 128 BPM — BPM ¼ / dotted / triplet anchored, Hz 0.7 + ANCHOR, PHASE, ping-pong (song); Hz 0.7, BPM ⅛ free and a Path LFO (time, across the wrap from the monitor\'s anchor): |Δ| ≤ 1e-6', () => {
  const t = track([lfo({ bpm: 1, anchor: 1 }, { rate: ladN('1/4') }), lfo({ bpm: 1, anchor: 1, dot: 1 }, { rate: ladN('1/8') }), lfo({ bpm: 1, anchor: 1, trip: 1 }, { rate: ladN('1/4') }),
    lfo({ anchor: 1 }), lfo({ bpm: 1, anchor: 1, dir: 'pp' }, { rate: ladN('1/2'), phase: 0.3 }), lfo({}), lfo({ bpm: 1 }, { rate: ladN('1/8') }), lfo({ type: 'path' }, { rate: hzN(1.1) })]);
  for (let k = 1; k <= 8; k++) add(t, 'l' + k + '.out', 'x1:in', { amt: k & 1 ? 0.5 : -0.4 });
  add(t, 'x1.out', 'i2:cf');
  const L = ['song', 'song', 'song', 'song', 'song', 'time', 'time', 'time'];
  const r = g4(t, { lockOk: L });
  assert.ok(r.cnt > 8 * 90000 && r.worst <= 1e-6 && r.range > 0.5, `worst ${r.worst} over ${r.cnt}, every input moving (${r.range})`);
});

test('G4 (E half): SMOOTH 0.3 — the DSP\'s own recurrence at the chunk rate (k = 1 − exp(−dtC / P.tau)) from a monitor anchor (its v, its clock) over the next 2 s ≡ the worklet\'s g rows: a song-locked and a time-locked input, a hard-edged shape: |Δ| ≤ 1e-6', () => {
  const SQ = [[0, 1, 0], [0.5, 1, 0], [0.5, 0, 0], [1, 0, 0]];
  const t = track([lfo({ bpm: 1, anchor: 1, pts: SQ }, { rate: ladN('1/4'), smooth: 0.3 }), lfo({ pts: SQ }, { rate: hzN(3), smooth: 0.3 }), lfo({}, { rate: hzN(1.7), smooth: 0.15 })]);
  for (let k = 1; k <= 3; k++) add(t, 'l' + k + '.out', 'x1:in', { amt: 0.5 });
  add(t, 'x1.out', 'i2:cf');
  const pay = payOf(t), W = driver(pay), PV = M.preview(pay, SR), c = pay.cmb[0], dB = 4 * BPM / (60 * SR), b0 = 1;
  W.MC.watch(1);
  W.play(b0);
  for (let s = 0; s < 200; s++) W.span();
  const i0 = pay.slots.x1.i, A = c.in.map((x, q) => ({ x: W.MC.cb[i0 + 1 + 3 * q], r: W.MC.cb[i0 + 2 + 3 * q], sm: W.MC.cb[i0 + 3 + 3 * q], F: W.st.F - 4, k: 1 - Math.exp(-(4 / SR) / PV.tau(x.l)) }));
  let worst = 0, edge = 0;
  for (let s = 0; s < Math.round(2 * SR / 128); s++) {
    const F = W.st.F, sb = W.beat(F);
    W.span();
    c.in.forEach((x, q) => {
      const a = A[q];
      for (let ch = 0; ch < 32; ch++) {
        const X = PV.lock(x.l) === 'song' ? PV.playX(x.l, sb + ch * dB, b0) : a.x + (F + 4 * ch - a.F) * a.r, raw = PV.read(x.l, X);
        if (q < 2 && Math.abs(raw - a.sm) > 0.5) edge++;
        a.sm += (raw - a.sm) * a.k;
        worst = Math.max(worst, Math.abs(W.g[x.src * 32 + ch] - a.sm));
      }
    });
  }
  PV.destroy();
  assert.ok(worst <= 1e-6 && edge > 20, `worst ${worst}, edges crossed ${edge}`);
});

test('§5.4 preview: lock — FREE + ANCHOR song, FREE time, RETRIG / ENV GLOBAL note (time on the master), S&H / chaos rand; rate (cycles per base frame at the payload\'s tempo), tau (SMOOTH 0.5·s³ s, 0 none); keyed by the CP (a rebuild per CP, never per amount)', () => {
  const t = track([lfo({ bpm: 1, anchor: 1 }, { rate: ladN('1/4') }), lfo({}, { smooth: 0.3 }), lfo({ mode: 'retrig' }), lfo({ mode: 'env' }), lfo({ type: 'sh' }), lfo({ type: 'lorenz' }), lfo({ dir: 'pp', pts: [[0, 0, 0], [1, 1, 0]] }, { phase: 0.1 })]);
  for (let k = 1; k <= 7; k++) add(t, 'l' + k + '.out', 'x1:in');
  add(t, 'x1.out', 'i2:cf');
  const pay = payOf(t), PV = M.preview(pay, SR);
  assert.deepEqual(pay.cmb[0].in.map(x => PV.lock(x.l)), ['song', 'time', 'note', 'note', 'rand', 'rand', 'time']);
  const pp = pay.cmb[0].in[6].l, rd = x => PV.read(pp, x);
  assert.ok([-2.3, -1.3, -0.3, 0.7, 1.7].every(x => Math.abs(rd(x) - rd(x + 2)) < 1e-12) && Math.abs(rd(-0.3) - rd(0.7)) > 0.5 && Math.abs(rd(-1.3) - rd(0.7)) < 1e-12, 'read: any unwrapped x, negative too — the ping-pong parity kept');
  assert.ok(Math.abs(PV.rate(1) - 100 * Math.pow(hzN(0.7), 4) / SR) < 1e-15 && Math.abs(PV.rate(0) - BPM / 60 / 1 / SR) < 1e-15, 'rates');
  assert.deepEqual([PV.tau(1), PV.tau(0)], [0.5 * 0.3 * 0.3 * 0.3, 0]);
  const PM = M.preview(Object.assign({}, pay, { i: 'master' }), SR);
  assert.deepEqual([PM.lock(2), PM.lock(3)], ['time', 'time'], 'the master plays no notes: RETRIG / ENV run from ▶');
  PV.destroy(); PM.destroy();
});
