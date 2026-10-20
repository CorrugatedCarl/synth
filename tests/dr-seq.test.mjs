// Tests of dr-seq.js (lane S; IMPL-7a §12.4): DrSeq clocking compiled plans in a fake Inst / Track whose span loop and
// transport handling are engine.js's (Track.process, songEvents, transportMsg: 4-frame spans in 128-frame quanta, the
// pending transport, loop wraps, the end, the song notes for the D5 comparison). Sync (start at bar 1 / bar 9 / mid-measure,
// seek, loop wrap, tempo change, stop), free (START, pos, tempo), live plan changes ('now', 'bar', 'beat2', pending rules),
// TAP fills, swing on whole ticks, every pre-scale, the step posts, the #34 hook, offline = live, no allocation, and the
// sequencer against toNotes through the song path (D5's frames).
// 7b (IMPL-7b §12.4, lane S6; after the 18 tests of 7a, unchanged): STEP RESET (`rst`: the next even step, synced and free,
// swing 50 / 62, the re-anchors, a pending swap, with a TAP fill), the TR-606's plans (SCALE 1–4, a chain of four lengths,
// track 8's 256 bars, a free pre-roll, the D.S. swap) and the tempo clock `clock(F)` (free at any frame, the song's ticks
// bit-identical to tickAt, stopped at the panel's tempo — synced the Inst's bpm, never tp.fpt), no allocation.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../drum-core.js?v=9';
import { dspScope, noAlloc, source } from './dsp-scope.mjs';

const clone = x => JSON.parse(JSON.stringify(x));
const SCOPE = dspScope({ files: [] });
SCOPE.run(source('dr-seq.js'), 'dr-seq.js');
const DrSeq = SCOPE.global('DrSeq');
const lane = id => C.LANES.indexOf(id), bit = id => 1 << lane(id);
function row(o) { const r = new Array(32).fill(0); for (const [l, s] of Object.entries(o)) for (let i = 0; i < s.length; i++) if (s[i] === 'x') r[i] |= bit(l); return r; }
function drum(ui = {}, x = {}, pats = {}, keys = {}) {
  const d = clone(C.normDrum(undefined));
  Object.assign(d.ui, ui); Object.assign(d.x, x);
  for (const [p, r] of Object.entries(pats)) d.st[+p] = r;
  for (const [k, o] of Object.entries(keys)) d.keys[+k] = { ...d.keys[+k], ...o };
  return C.normDrum(d);
}
const plan = (...a) => C.compilePlan(drum(...a));
// every step of the 16 marked (so every step fires a trigger) — lane BD, plus a pattern-specific lane
const every = l => 'x'.repeat(32);

/* ------------------------------------------------------------------ the fake Track (engine.js's span loop) */

// (7b: pbpm the patch's bpm — the Inst's `bpm` getter, engine.js's: the transport's while it plays, else the patch's — and
// T.onSpan(F, len), called where the Track renders the span: after the events, before pos += len)
function rig({ base = 48000, sw = {}, pbpm = 120 } = {}) {
  const tp = { play: false, frame: 0, tick: 0, fpt: 1, loop: false, ls: 0, le: 0, wrap: false, pend: null, end: null };
  const T = { base, tp, fresh: false, anch: false, reseek: false, graphed: 0, frames: 0, spanF: 0, lastT: NaN, sn: [], ni: 0, on: [],
    posts: [], trigs: [], notes: [], steps: [], spans: [], onSpan: null };
  const inst = { T, tp, base, id: 'i7', on: 1, p: { drum: { lts: 0, mts: 0, hts: 0, rss: 0, cps: 0, ...sw } },
    port: { postMessage: m => T.posts.push({ ...m }) }, dm: { trig: mask => T.trigs.push([T.spanF, mask]) },
    drStep: (n, v) => T.steps.push([T.spanF, n, v]),
    get bpm() { return tp.play ? 60 * base / (tp.fpt * 960) : pbpm; } };
  const q = DrSeq.create(inst);
  T.inst = inst; T.q = q;
  T.tickAt = F => tp.tick + (F - tp.frame) / tp.fpt;
  T.fptOf = bpm => base * 60 / (bpm * 960);
  // transportMsg
  T.transport = d => {
    if (!d.play) { tp.pend = null; T.lastT = NaN; if (tp.play) { tp.play = false; T.release(); q.transport(false); } return; }
    tp.pend = { frame: d.frame, tick: d.tick, fpt: d.fpt, loop: !!d.loop, ls: d.ls || 0, le: d.le || 0, seek: d.seek !== false, end: d.end == null ? null : d.end, fresh: !!d.fresh };
  };
  T.play = (frame, tick, bpm, o = {}) => T.transport({ play: true, frame, tick, fpt: T.fptOf(bpm), fresh: true, ...o });
  T.release = () => { for (let i = 0; i < T.on.length; i += 2) T.notes.push([T.spanF, -1, T.on[i]]); T.on = []; };
  T.songEvents = F => { // = engine.js Track.songEvents (transport, wrap, end, notes)
    let dist = 1e9;
    if (tp.pend) {
      const P = tp.pend;
      if (F >= P.frame - 0.5) {
        tp.pend = null;
        const start = P.seek || !tp.play;
        if (start) T.release();
        tp.play = true; tp.frame = P.frame; tp.tick = P.tick; tp.fpt = P.fpt; tp.loop = P.loop; tp.ls = P.ls; tp.le = P.le; tp.end = P.end;
        tp.wrap = P.loop && P.le > P.ls && P.tick < P.le;
        T.reseek = true; T.anch = start; T.fresh = start && P.fresh;
        if (start) { T.lastT = NaN; q.transport(true); }
      } else dist = P.frame - F;
    }
    if (!tp.play) return dist;
    let t = T.tickAt(F);
    if (tp.wrap && t >= tp.le) {
      const L = tp.le - tp.ls;
      let Fb = tp.frame + (tp.le - tp.tick) * tp.fpt;
      while (F - Fb >= L * tp.fpt) Fb += L * tp.fpt;
      tp.frame = Fb; tp.tick = tp.ls; t = T.tickAt(F);
      T.release(); T.reseek = true; T.anch = true; T.fresh = false; T.lastT = NaN;
    }
    if (tp.end != null && t >= tp.end) { tp.play = false; T.release(); q.transport(false); return dist; }
    const sn = T.sn;
    if (T.reseek) {
      let t0 = t, aft = false;
      if (T.anch) { if (tp.tick < t && (tp.frame >= F - 4 - 1e-6 || (T.fresh && F - tp.frame <= 0.25 * base))) t0 = tp.tick; }
      else if (t >= T.lastT - 0.5) { t0 = T.lastT; aft = true; }
      let lo = 0, hi = sn.length / 4;
      if (aft) while (lo < hi) { const m = (lo + hi) >> 1; if (sn[m * 4] <= t0) lo = m + 1; else hi = m; }
      else while (lo < hi) { const m = (lo + hi) >> 1; if (sn[m * 4] < t0) lo = m + 1; else hi = m; }
      T.ni = lo; T.reseek = false; T.anch = false; T.fresh = false;
    }
    const on = T.on;
    for (let i = on.length - 2; i >= 0; i -= 2) if (on[i + 1] <= t) { T.notes.push([F, -1, on[i]]); on.splice(i, 2); }
    while (T.ni * 4 < sn.length && sn[T.ni * 4] <= t) {
      const j = T.ni * 4, st = sn[j], n = sn[j + 2];
      T.ni++;
      if (tp.wrap && st >= tp.le) continue;
      for (let i = on.length - 2; i >= 0; i -= 2) if (on[i] === n) on.splice(i, 2);
      T.notes.push([F, n, sn[j + 3]]);
      let end = st + sn[j + 1]; if (tp.wrap && end > tp.le) end = tp.le;
      on.push(n, end);
    }
    T.lastT = t;
    let nt = 1e18;
    if (T.ni * 4 < sn.length) nt = sn[T.ni * 4];
    for (let i = 1; i < on.length; i += 2) if (on[i] < nt) nt = on[i];
    if (tp.wrap && tp.le < nt) nt = tp.le;
    if (tp.end != null && tp.end < nt) nt = tp.end;
    if (nt < 1e17) { const df = (nt - t) * tp.fpt; if (df < dist) dist = df; }
    return dist < 1 ? 1 : dist;
  };
  T.process = (n = 128) => { // = engine.js Track.process's span loop (one Inst)
    const F0 = T.frames; T.frames = F0 + n;
    let off = 0;
    while (off < n) {
      let len = n - off;
      const F = F0 + off;
      T.spanF = F;
      let d = T.songEvents(F);
      if (inst.on === 1 && (q.run || q.sync)) { const d2 = q.events(F); assert.ok(d2 >= 1, 'events(F) ≥ 1'); if (d2 < d) d = d2; }
      if (d < len) { len = Math.max(4, Math.ceil(d / 4) * 4); if (len > n - off) len = n - off; }
      T.spans.push([F, len]);
      if (T.onSpan) T.onSpan(F, len);
      if (inst.on === 1 && q.run && !q.sync) q.pos += len;
      off += len;
    }
  };
  T.run = frames => { const end = T.frames + frames; while (T.frames < end) T.process(128); };
  T.until = F => { while (T.frames < F) T.process(128); };
  T.setNotes = notes => { T.sn = notes.flatMap(x => [x.t, x.d, x.n, x.v]); T.reseek = true; };
  T.stepPosts = () => T.posts.filter(p => p.t === 'step');
  return T;
}
const ceil4 = x => Math.ceil(x / 4 - 1e-9) * 4 + 0;
// the engine's timing (songEvents' expressions, = DrSeq's): an event fires at the first span start whose tickAt reaches its
// tick — the first 4-frame grid point at or after its exact frame, or the next one when the float distance rounds a hair up
const near4 = (F, exact, msg) => { const c = ceil4(exact); assert.ok(F === c || F === c + 4, `${msg || ''} F ${F} vs exact ${exact}`); };
// the reference: every step tick of a plan anchored at tick 0 (independent of DrSeq) — [tick, m, s, mask, M]
function refSteps(p, tEnd, pct = 50) {
  const out = [];
  let m = 0, start = 0, M = 0;
  while (start < tEnd && p.n) {
    const pre = p.mPre[m], T = C.STEP_T[pre], w = C.SWUNG[pre] ? Math.round((2 * pct - 100) * T / 100) : 0;
    for (let s = 0; s < p.mOff[m + 1] - p.mOff[m]; s++) out.push([start + s * T + (s & 1 ? w : 0), m, s, p.st[p.mOff[m] + s], M]);
    start += p.mT[m + 1] - p.mT[m]; M++;
    m = m + 1 < p.n ? m + 1 : p.loopFrom;
  }
  return out.filter(e => e[0] < tEnd);
}
const PAT = { 0: row({ ac: 'x...x...x...x...', bd: 'x...x...x...x...', ch: 'xxxxxxxxxxxxxxxx', sd: '....x.......x...' }) };

/* ------------------------------------------------------------------ sync */

test('sync: a start at bar 1 plays every step at the first span start at or after its tick\'s frame (several tempos, 48 / 44.1 kHz)', () => {
  const p = plan({}, {}, PAT);
  for (const [base, bpm] of [[48000, 120], [48000, 97], [44100, 133], [48000, 300], [44100, 40]]) {
    const T = rig({ base });
    T.q.set({ plan: p, sync: true, swing: 50, at: 'now' });
    T.play(0, 0, bpm);
    const fpt = T.fptOf(bpm), ref = refSteps(p, 3840 * 3);
    T.until(Math.ceil(3840 * 3 * fpt) + 128);
    const posts = T.stepPosts().slice(0, ref.length);
    assert.equal(posts.length, ref.length, `${base}/${bpm}: every step posted`);
    posts.forEach((q, j) => {
      const [tick, m, s, , M] = ref[j], exact = tick * fpt, c = ceil4(exact);
      assert.deepEqual([q.s, q.m, q.k, q.v, q.p, q.M, q.f, q.o], [s, m, 0, 0, 0, M, 0, tick - M * 3840]);
      near4(q.F, exact, `${base}/${bpm} step ${j}`);
      assert.ok(q.F >= exact - 1e-6, 'never early');
    });
    assert.deepEqual(T.trigs.slice(0, ref.length).map(e => e[0]), posts.map(q => q.F), 'the triggers fire at the posts\' frames');
    assert.deepEqual(T.trigs.slice(0, ref.length).map(e => e[1]), ref.map(e => e[3]));
  }
});

test('sync: a start at bar 9 and mid-measure lands where the machine would be had it started at bar 1', () => {
  const D = drum({ bvar: 1, fill: 4 }, {}, { ...PAT, 1: row({ bd: 'x.x.x.x.x.x.x.x.' }), 24: row({ sd: 'xxxxxxxxxxxxxxxx' }) });
  const p = C.compilePlan(D), ref = refSteps(p, 3840 * 20);
  for (const t0 of [3840 * 8, 3840 * 8 + 600, 3840 * 13 + 1]) {
    const T = rig(), fpt = T.fptOf(120), F0 = 1280;
    T.q.set({ plan: p, sync: true, swing: 50 });
    T.run(1280);
    T.play(F0, t0, 120);
    T.until(F0 + 3840 * 3 * fpt);
    const posts = T.stepPosts(), want = ref.filter(e => e[0] >= t0 && (e[0] - t0) * fpt + F0 < T.frames - 4);
    assert.ok(posts.length > 40);
    assert.deepEqual(posts.map(q => [q.m, q.s, q.M]), want.slice(0, posts.length).map(e => [e[1], e[2], e[4]]), 'tick ' + t0);
    posts.forEach((q, j) => near4(q.F, F0 + (want[j][0] - t0) * fpt));
  }
  // the cycle A B A F B A B F from bar 1 is the one heard from bar 9 (measure 8 = A, the 4th of the second half F)
  const T = rig(); T.q.set({ plan: p, sync: true }); T.play(0, 3840 * 8, 120); T.run(25 * 3840 * 8 + 128);
  const ms = T.stepPosts().filter(q => q.s === 0).map(q => (q.k >= 12 ? 'F' : 'AB'[q.v]));
  assert.deepEqual(ms.slice(0, 8), ['A', 'B', 'A', 'F', 'B', 'A', 'B', 'F']);
});

test('sync: a seek and a loop wrap (no transportHook) re-anchor at tick 0; a tempo change mid-measure keeps the ticks; stop is silent and a new play re-anchors', () => {
  const p = plan({}, {}, PAT), fpt = 25;
  // a loop over ticks [960, 2880): after the wrap the steps at 960 … play again (step 4 …), the positions the song says
  const T = rig();
  T.q.set({ plan: p, sync: true });
  T.play(0, 0, 120, { loop: true, ls: 960, le: 2880 });
  T.run(2880 * fpt + 960 * fpt + 64);
  const s = T.stepPosts().map(q => q.s);
  assert.deepEqual(s.slice(0, 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(s.slice(12, 16), [4, 5, 6, 7], 'the wrap went back to tick 960 = step 5');
  const wrapF = T.stepPosts()[12].F;
  assert.equal(wrapF, 2880 * fpt, 'the loop start\'s step fires at the wrap');
  // a seek while playing (a play with seek): re-anchored
  const T2 = rig(); T2.q.set({ plan: p, sync: true }); T2.play(0, 0, 120); T2.run(1000 * fpt);
  const Fp = T2.frames + 128;
  T2.play(Fp, 3840 * 5 + 480, 120); T2.run(1200 * fpt);
  const after = T2.stepPosts().filter(q => q.F >= Fp);
  assert.deepEqual([after[0].s, after[0].M, after[0].F], [2, 5, Fp]);
  // a tempo change mid-measure (seek false: the song position continues): the steps keep their ticks at the new rate
  const T3 = rig(); T3.q.set({ plan: p, sync: true }); T3.play(0, 0, 120); T3.run(128 * 47);
  const F1 = T3.frames, t1 = T3.tickAt(F1);
  T3.play(F1, t1, 90, { seek: false, fresh: false });
  T3.run(3840 * 2 * T3.fptOf(90));
  const ps = T3.stepPosts();
  const k = ps.findIndex(q => q.F >= F1);
  assert.deepEqual(ps.map(q => q.s).slice(0, 20), Array.from({ length: 20 }, (_, i) => i % 16), 'no step skipped or repeated');
  for (let j = k; j < ps.length; j++) {
    const tick = ps[j].M * 3840 + ps[j].o, c = ceil4(F1 + (tick - t1) * T3.fptOf(90));
    assert.ok(ps[j].F === c || ps[j].F === c + 4, 'at the new rate');
  }
  // stop: silent; play again: re-anchored at the new position
  const n0 = T3.stepPosts().length;
  T3.transport({ play: false }); T3.run(48000);
  assert.equal(T3.stepPosts().length, n0, 'stopped: no step');
  assert.deepEqual(T3.steps.at(-1).slice(1), [-1, 0], 'the gate off at the stop (#34)');
  T3.play(T3.frames, 0, 120); T3.run(256);
  assert.deepEqual([T3.stepPosts()[n0].s, T3.stepPosts()[n0].M], [0, 0]);
  // the end of the song (tp.end): stops like a stop
  const T4 = rig(); T4.q.set({ plan: p, sync: true }); T4.play(0, 0, 120, { end: 1200 }); T4.run(48000);
  assert.deepEqual(T4.stepPosts().map(q => q.s), [0, 1, 2, 3, 4]);
});

test('sync: a fresh start arriving late plays the anchor tick\'s step late (as songEvents does a note); an old anchor (a node created mid-song) replays nothing; power on re-anchors', () => {
  const p = plan({}, {}, PAT);
  const T = rig(); T.q.set({ plan: p, sync: true }); T.run(12800);
  T.play(12800 - 2000, 0, 120); T.run(256); // 2000 frames late, fresh
  assert.deepEqual(T.stepPosts().map(q => [q.s, q.F]), [[0, 12800]], 'tick 0 late: one step, not the skipped one between');
  const T2 = rig(); T2.q.set({ plan: p, sync: true }); T2.run(12800);
  T2.play(0, 0, 120, { fresh: false }); T2.run(256);
  assert.deepEqual(T2.stepPosts().map(q => q.s), [], 'an old anchor: the next step only (tick 512 → step 4 at 720)');
  T2.run(6000);
  assert.equal(T2.stepPosts()[0].s, 3); near4(T2.stepPosts()[0].F, 720 * 25);
  // power on: the Track writes syncStep = null — the position re-derived from the song (nothing replayed)
  const n = T2.stepPosts().length;
  T2.inst.on = 0; T2.run(9000); T2.inst.on = 1; T2.q.syncStep = null;
  const Fon = T2.frames, next = Math.ceil(Fon / 25 / 240) * 240;
  T2.run(6000 + 128);
  const nx = T2.stepPosts().slice(n);
  assert.equal(nx[0].M * 3840 + nx[0].o, next, 'the next step after power on, none replayed'); near4(nx[0].F, next * 25);
});

/* ------------------------------------------------------------------ free */

test('free: START plays step 1 at once and then runs at its tempo (pos advanced by the Track); a tempo change rebases; STOP stops; the transport does nothing', () => {
  const p = plan({}, {}, PAT);
  for (const bpm of [120, 97.3, 300]) {
    const T = rig(), fpt = T.fptOf(bpm);
    T.q.set({ plan: p, sync: false, run: false, bpm });
    T.run(256);
    T.q.set({ run: true });
    const F0 = T.frames;
    T.run(Math.ceil(3840 * 2 * fpt));
    const ref = refSteps(p, 3840 * 2), ps = T.stepPosts();
    assert.equal(ps[0].F, F0, 'step 1 at the START\'s quantum');
    ps.forEach((q, j) => { if (j < ref.length) { assert.deepEqual([q.s, q.M], [ref[j][2], ref[j][4]]); near4(q.F, F0 + ref[j][0] * fpt); } });
    assert.ok(T.q.pos >= 3840 * 2 * fpt - 128 && T.q.pos <= 3840 * 2 * fpt + 128, 'pos = frames since START');
  }
  const T = rig();
  T.q.set({ plan: p, sync: false, run: true, bpm: 120 });
  T.run(128 * 140);                                     // three steps at 120 (0, 6000, 12000), tick 716.8
  const Fc = T.frames;
  T.q.set({ bpm: 60 });
  T.run(240 * 50 * 3);
  const ps = T.stepPosts();
  assert.deepEqual(ps.map(q => q.s).slice(0, 6), [0, 1, 2, 3, 4, 5]);
  near4(ps[3].F, Fc + (720 - Fc / 25) * 50, 'step 4 (tick 720) from the position reached: no jump');
  near4(ps[4].F, Fc + (960 - Fc / 25) * 50, 'then at 60 BPM');
  // the transport does not touch a free machine
  const n = ps.length;
  T.play(T.frames, 0, 200); T.run(128); T.transport({ play: false }); T.run(240 * 50);
  assert.ok(T.stepPosts().length > n);
  // STOP; START again from step 1
  T.q.set({ run: false }); const n2 = T.stepPosts().length; T.run(48000);
  assert.equal(T.stepPosts().length, n2);
  T.q.set({ run: true }); T.run(128);
  assert.deepEqual([T.stepPosts()[n2].s, T.stepPosts()[n2].M], [0, 0]);
  // the Track's own stop (panic: run = false) and a START after it
  T.q.run = false; T.run(48000); const n3 = T.stepPosts().length; T.run(4800); assert.equal(T.stepPosts().length, n3);
  T.q.set({ run: true }); T.run(128); assert.equal(T.stepPosts()[n3].s, 0);
});

test('every pre-scale\'s step length (320 / 160 / 240 / 120 ticks), the measure ticks with both parts, the part in the posts', () => {
  for (let pre = 1; pre <= 4; pre++) {
    const p = plan({}, {}, { 0: row({ bd: every() }) }, { 0: { pre, l1: 5, l2: 3 } });
    const T = rig(), stT = C.STEP_T[pre];
    T.q.set({ plan: p, sync: true }); T.play(0, 0, 120); T.run(8 * stT * 25 * 2 + 64);
    const ps = T.stepPosts();
    ps.slice(0, 16).forEach((q, j) => { assert.equal(q.M * 8 * stT + q.o, j * stT, 'pre ' + pre); near4(q.F, j * stT * 25); });
    assert.deepEqual(ps.slice(0, 9).map(q => q.p), [0, 0, 0, 0, 0, 1, 1, 1, 0]);
    assert.deepEqual(ps.slice(0, 9).map(q => q.s), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
  }
});

/* ------------------------------------------------------------------ swing */

test('swing on whole ticks (§3.5): 50 % none (bit-identical), 62 % +58 ticks on 16ths, 75 % half a step; 32nds per 32nd pair; triplets unswung', () => {
  const run = (pre, pct, l1 = 8) => {
    const p = plan({}, {}, { 0: row({ bd: every() }) }, { 0: { pre, l1 } });
    const T = rig(); T.q.set({ plan: p, sync: true, swing: pct }); T.play(0, 0, 120); T.run(l1 * C.STEP_T[pre] * 25 + 64);
    const ps = T.stepPosts().slice(0, l1);
    ps.forEach(q => near4(q.F, q.o * 25));
    return ps.map(q => q.o);
  };
  assert.deepEqual(run(3, 50), [0, 240, 480, 720, 960, 1200, 1440, 1680]);
  assert.deepEqual(run(3, 62), [0, 298, 480, 778, 960, 1258, 1440, 1738], '57.6 → 58 ticks');
  assert.deepEqual(run(3, 75), [0, 360, 480, 840, 960, 1320, 1440, 1560 + 240]);
  assert.deepEqual(run(4, 62), [0, 149, 240, 389, 480, 629, 720, 869], '28.8 → 29 ticks');
  assert.deepEqual(run(1, 75, 6), [0, 320, 640, 960, 1280, 1600]);
  assert.deepEqual(run(2, 75, 6), [0, 160, 320, 480, 640, 800]);
  // the posts' o carries the swung offset; a swing change mid-measure moves the steps not yet played
  const p = plan({}, {}, { 0: row({ bd: every() }) });
  const T = rig(); T.q.set({ plan: p, sync: true, swing: 50 }); T.play(0, 0, 120); T.run(500 * 25);
  T.q.set({ swing: 75 }); T.run(1500 * 25);
  assert.deepEqual(T.stepPosts().slice(0, 6).map(q => q.o), [0, 240, 480, 840, 960, 1320]);
});

/* ------------------------------------------------------------------ live plan changes */

test('at \'now\' with the same shape replaces the steps in place (position kept); another shape waits for the boundary', () => {
  const D = drum({ mode: 1 }, {}, PAT);
  const T = rig(); T.q.set({ plan: C.compilePlan(D), sync: true }); T.play(0, 0, 120); T.run(1000 * 25);
  const D2 = C.press({ ...C.initState(), play: true }, D, { k: 'step', n: 12 }).mem; // BD on step 12 (mode 1, inst BD)
  T.q.set({ plan: C.compilePlan(D2), at: 'now' }); T.run(3000 * 25);
  const ps = T.stepPosts();
  assert.deepEqual(ps.map(q => q.s), Array.from({ length: ps.length }, (_, j) => j % 16), 'the position kept');
  assert.equal(T.trigs[11][1] & bit('bd'), bit('bd'), 'the new step plays in this very measure');
  const D3 = C.press({ ...C.initState(), play: true }, D2, { k: 'clear+step', n: 12 }).mem;
  T.q.set({ plan: C.compilePlan(D3), at: 'now' }); T.run(8000 * 25);
  const s0 = T.stepPosts().filter(q => q.s === 0).map(q => q.F / 25);
  assert.deepEqual(s0.slice(0, 4), [0, 3840, 7680, 7680 + 2880], 'a new length: at the next boundary');
});

test('at \'bar\' swaps at the next boundary, from the new plan\'s loopFrom (no intro), the measure count continuing; the AB phase restarts on A; a plan equal to the playing one cancels; a \'now\' replaces a pending one', () => {
  const pats = { ...PAT, 1: row({ sd: every() }), 4: row({ cp: every() }), 5: row({ cb: every() }), 24: row({ cy: every() }) };
  const D = drum({ bvar: 1, intro: true }, {}, pats);
  const T = rig(); T.q.set({ plan: C.compilePlan(D), sync: true }); T.play(0, 0, 120); T.run(3840 * 25 * 2 + 600 * 25);
  // measures so far: intro (F), A — now in B (measure 2); a new key at 'bar' → after B, key 3 from A
  const D2 = C.press({ ...C.initState(), play: true }, D, { k: 'step', n: 3 }).mem;
  T.q.set({ plan: C.compilePlan(D2), at: 'bar' }); T.run(3840 * 25 * 4);
  const ms = T.stepPosts().filter(q => q.s === 0).map(q => [q.k, q.v, q.M]);
  assert.deepEqual(ms.slice(0, 6), [[12, 0, 0], [0, 0, 1], [0, 1, 2], [2, 0, 3], [2, 1, 4], [2, 0, 5]], 'intro, A, B, then key 3 A B A …');
  // a pending swap cancelled by the playing plan, and a 'now' plan replacing the pending one
  const T2 = rig(); T2.q.set({ plan: C.compilePlan(D2), sync: true }); T2.play(0, 0, 120); T2.run(1000 * 25);
  T2.q.set({ plan: C.compilePlan(drum({ bvar: 1, sel: 5 }, {}, pats)), at: 'bar' });
  T2.q.set({ plan: C.compilePlan(D2), at: 'bar' }); T2.run(3840 * 25 * 3);
  assert.deepEqual(T2.stepPosts().filter(q => q.s === 0).map(q => q.k).slice(0, 4), [12, 2, 2, 2], 'cancelled');
  const T3 = rig(); T3.q.set({ plan: C.compilePlan(D2), sync: true }); T3.play(0, 0, 120); T3.run(1000 * 25);
  const pats4 = { ...pats, 8: row({ bd: every(), sd: every() }) };
  T3.q.set({ plan: C.compilePlan(drum({ bvar: 0, sel: 4, intro: true }, {}, pats4)), at: 'bar' });
  T3.q.set({ plan: C.compilePlan(drum({ bvar: 0, sel: 4, intro: true }, { mute: bit('sd') }, pats4)), at: 'now' });
  T3.run(3840 * 25 * 2);
  const after = T3.stepPosts().filter(q => q.F >= 3840 * 25);
  assert.deepEqual([after[0].k, after[0].M], [4, 1], 'the pending (now muted) plan at the boundary, without its intro');
  const late = T3.trigs.filter(e => e[0] >= 3840 * 25);
  assert.ok(late.length > 10 && late.every(e => (e[1] & bit('bd')) && !(e[1] & bit('sd'))));
  // stopped: a plan is taken at once
  const T4 = rig(); T4.q.set({ plan: C.compilePlan(D), sync: true }); T4.q.set({ plan: C.compilePlan(D2), at: 'bar' });
  T4.play(0, 0, 120); T4.run(256);
  assert.equal(T4.stepPosts()[0].k, 12, 'the new plan from its start (intro)');
});

test('at \'beat2\' (MANUAL PLAY\'s quirk): swapped at the current measure\'s beat 2, the new measure entered at its own beat-2 step; late, or into a measure of a beat: at the boundary', () => {
  const pats = { 0: row({ bd: every() }), 6: row({ sd: every() }), 2: row({ cp: every() }) };
  const D = drum({}, {}, pats, { 3: { pre: 1, l1: 12 }, 1: { l1: 3 } });
  const T = rig(); T.q.set({ plan: C.compilePlan(D), sync: true }); T.play(0, 0, 120); T.run(3840 * 25 + 300 * 25);
  // in measure 2's beat 1: key 4 (pre 1, 8th triplets) from beat 2 = its step 4 (index 3)
  T.q.set({ plan: C.compilePlan(drum({ sel: 3 }, {}, pats, { 3: { pre: 1, l1: 12 } })), at: 'beat2' });
  T.run(3840 * 25 * 2);
  const ps = T.stepPosts().filter(q => q.F >= 3840 * 25);
  assert.deepEqual(ps.slice(0, 6).map(q => [q.k, q.s, q.o]), [[0, 0, 0], [0, 1, 240], [0, 2, 480], [0, 3, 720], [3, 3, 960], [3, 4, 1280]]);
  near4(ps[4].F, (3840 + 960) * 25);
  assert.ok(T.trigs.find(e => e[0] === ps[4].F)[1] & bit('sd'), 'the new pattern sounds from beat 2');
  const nextM = ps.find(q => q.s === 0 && q.F > 3840 * 25);
  assert.deepEqual([nextM.k, nextM.M], [3, 2]); near4(nextM.F, (3840 + 3840) * 25, 'its measure ends where its own length says');
  // arriving after beat 2: at the boundary
  const T2 = rig(); T2.q.set({ plan: C.compilePlan(D), sync: true }); T2.play(0, 0, 120); T2.run(1500 * 25);
  T2.q.set({ plan: C.compilePlan(drum({ sel: 3 }, {}, pats, { 3: { pre: 1, l1: 12 } })), at: 'beat2' }); T2.run(3840 * 25);
  assert.deepEqual(T2.stepPosts().filter(q => q.s === 0).map(q => [q.k, q.M * 3840 + q.o]).slice(0, 2), [[0, 0], [3, 3840]]);
  // a new measure of a beat or less (key 2: 3 steps of 16ths): at the boundary
  const T3 = rig(); T3.q.set({ plan: C.compilePlan(D), sync: true }); T3.play(0, 0, 120); T3.run(300 * 25);
  T3.q.set({ plan: C.compilePlan(drum({ sel: 1 }, {}, pats, { 1: { l1: 3 } })), at: 'beat2' }); T3.run(3840 * 25 + 2000 * 25);
  assert.deepEqual(T3.stepPosts().filter(q => q.s === 0).map(q => [q.k, q.M]).slice(0, 3), [[0, 0], [1, 1], [1, 2]]);
  near4(T3.stepPosts().filter(q => q.s === 0)[2].F, (3840 + 720) * 25);
});

/* ------------------------------------------------------------------ TAP fills, intro, PLAY loop */

test('TAP (§3.4, #8): one fill per increment at the next boundary instead of the cycle\'s next measure, the cycle resuming where it was (AB phase kept); none while stopped', () => {
  const pats = { 0: row({ bd: every() }), 1: row({ sd: every() }), 24: row({ cp: 'xxxxxxxx' }) };
  const D = drum({ bvar: 1 }, {}, pats, { 12: { l1: 8 } });
  const T = rig(); T.q.set({ plan: C.compilePlan(D), sync: true, tap: 0 }); T.play(0, 0, 120); T.run(1000 * 25);
  T.q.set({ tap: 1 }); T.run(3840 * 25 * 4);
  const ms = T.stepPosts().filter(q => q.s === 0).map(q => (q.f ? 'F' + q.m : 'AB'[q.v]) + q.M);
  assert.deepEqual(ms.slice(0, 5), ['A0', 'F-11', 'B2', 'A3', 'B4'], 'A, the fill, then B: the cycle did not advance');
  const fillPost = T.stepPosts().find(q => q.f);
  assert.deepEqual([fillPost.k, fillPost.v], [12, 0]); near4(fillPost.F, 3840 * 25);
  assert.equal(T.stepPosts().filter(q => q.f).length, 8, 'the fill\'s own length (8 steps)');
  near4(T.stepPosts().find(q => q.M === 2).F, (3840 + 1920) * 25, 'B right after the fill');
  // the first payload's counter is not a request; an unchanged counter none; a stopped machine none
  const T2 = rig(); T2.q.set({ plan: C.compilePlan(D), sync: true, tap: 5 }); T2.q.set({ tap: 5 }); T2.play(0, 0, 120); T2.run(3840 * 25 * 2);
  assert.ok(!T2.stepPosts().some(q => q.f));
  T2.transport({ play: false }); T2.q.set({ tap: 6 }); T2.play(T2.frames, 0, 120); T2.run(3840 * 25 * 2);
  assert.ok(!T2.stepPosts().some(q => q.f));
  // no fill in the plan (write modes): a request does nothing
  const T3 = rig(); T3.q.set({ plan: C.compilePlan(drum({ mode: 1 }, {}, pats)), sync: true, tap: 0 }); T3.play(0, 0, 120); T3.run(1000);
  T3.q.set({ tap: 1 }); T3.run(3840 * 25 * 2);
  assert.ok(!T3.stepPosts().some(q => q.f));
});

test('TAP in the loop\'s last bar (review 2 #1): the request survives the loop wrap and the fill is the first measure after it, the cycle resuming where it was; a seek still drops it, a fill cut by the wrap is not replayed', () => {
  const pats = { 0: row({ bd: every() }), 1: row({ sd: every() }), 24: row({ cp: 'xxxxxxxx' }) };
  const D = drum({ bvar: 1 }, {}, pats, { 12: { l1: 8 } }), fpt = 25, BAR = 3840;
  const ms = T => T.stepPosts().filter(q => q.s === 0).map(q => (q.f ? 'F' : 'AB'[q.v]) + q.M);
  // the loop is bars 1–4; TAP in bar 4 before its last step (the request is taken at bar 4's end = the wrap) and after it
  for (const at of [BAR * 3 + 1000, BAR * 4 - 100]) {
    const T = rig(); T.q.set({ plan: C.compilePlan(D), sync: true, tap: 0 }); T.play(0, 0, 120, { loop: true, ls: 0, le: BAR * 4 });
    T.run(at * fpt); T.q.set({ tap: 1 }); T.run((BAR * 4 - at) * fpt + BAR * 4 * fpt + 64);
    assert.deepEqual(ms(T).slice(0, 10), ['A0', 'B1', 'A2', 'B3', 'F0', 'A1', 'B2', 'A3', 'B4', 'A0'], 'tap at ' + at + ': the fill (half a bar) at the loop start, then A B A B; the next pass from A');
    const fill = T.stepPosts().filter(q => q.f);
    assert.equal(fill.length, 8, 'the fill\'s own 8 steps');
    assert.equal(fill[0].F, BAR * 4 * fpt, 'at the wrap\'s frame');
  }
  // a loop starting mid-measure: the request waits for the first boundary after the wrap
  const T2 = rig(); T2.q.set({ plan: C.compilePlan(D), sync: true, tap: 0 }); T2.play(0, 0, 120, { loop: true, ls: BAR / 2, le: BAR * 2 });
  T2.run((BAR * 2 - 400) * fpt); T2.q.set({ tap: 1 }); T2.run(BAR * 2 * fpt);
  const p2 = T2.stepPosts(), w = p2.findIndex((q, j) => j && q.F >= BAR * 2 * fpt);
  assert.deepEqual([p2[w].s, p2[w].f], [8, 0], 'the wrap lands on step 9 of measure 1: no fill yet');
  const f2 = p2.find(q => q.f);
  assert.ok(f2 && f2.s === 0 && f2.F === (BAR * 2 + BAR / 2) * fpt, 'the fill at measure 2 after the wrap');
  // a seek (the transport re-anchors) still drops a request taken at a boundary
  const T3 = rig(); T3.q.set({ plan: C.compilePlan(D), sync: true, tap: 0 }); T3.play(0, 0, 120);
  T3.run(3500 * fpt); T3.q.set({ tap: 1 }); T3.run(200 * fpt); // (bar 1's last step fired: the request is taken at its boundary)
  T3.play(T3.frames + 128, 0, 120); T3.run(BAR * 2 * fpt);
  assert.ok(!T3.stepPosts().some(q => q.f), 'a seek drops it');
  // a fill already playing when the loop wraps (the loop ends mid-fill) is not restarted after the wrap
  const T4 = rig(); T4.q.set({ plan: C.compilePlan(D), sync: true, tap: 0 }); T4.play(0, 0, 120, { loop: true, ls: 0, le: BAR + BAR / 4 });
  T4.run(1000 * fpt); T4.q.set({ tap: 1 }); T4.run(BAR * 2 * fpt);
  assert.deepEqual(T4.stepPosts().filter(q => q.f).map(q => q.s), [0, 1, 2, 3], 'the fill\'s first quarter, cut by the wrap; none after it');
});

test('intro → A → B with AB, auto fills every 2 after it; PLAY loops its track; an empty track plays nothing', () => {
  const pats = { 0: row({ bd: every() }), 1: row({ sd: every() }), 24: row({ cp: every() }) };
  const T = rig(); T.q.set({ plan: C.compilePlan(drum({ bvar: 1, intro: true, fill: 5 }, {}, pats)), sync: true }); T.play(0, 0, 120); T.run(3840 * 25 * 7);
  assert.deepEqual(T.stepPosts().filter(q => q.s === 0).map(q => (q.k >= 12 ? 'F' : 'AB'[q.v])).slice(0, 7), ['F', 'A', 'F', 'B', 'F', 'A', 'F']);
  const d = clone(drum({ mode: 4, inst: 3 }, {}, pats)); d.rt[192] = 0; d.rt[193] = 5; d.rtEnd[3] = 193;
  const T2 = rig(); T2.q.set({ plan: C.compilePlan(C.normDrum(d)), sync: true }); T2.play(0, 0, 120); T2.run(3840 * 25 * 5);
  assert.deepEqual(T2.stepPosts().filter(q => q.s === 0).map(q => [q.k, q.M]).slice(0, 5), [[0, 0], [5, 1], [0, 2], [5, 3], [0, 4]]);
  const T3 = rig(); T3.q.set({ plan: C.compilePlan(drum({ mode: 4, inst: 4 })), sync: true }); T3.play(0, 0, 120); T3.run(48000);
  assert.deepEqual(T3.stepPosts(), []);
  T3.q.set({ plan: C.compilePlan(C.normDrum(d)), at: 'bar' }); T3.run(3840 * 25);
  assert.ok(T3.stepPosts().length > 0, 'a plan arriving at an idle machine is taken at once');
});

/* ------------------------------------------------------------------ the posts, the #34 hook, the tables */

test('posts carry the frame (graphed: the Inst id); the #34 hook gets the lowest primary of the step\'s sounds (the switches), v 1 accented / 100⁄127; the tables kept for the Inst', () => {
  const p = plan({}, {}, { 0: row({ ac: 'x', lt: 'xx', ch: 'xx', cp: '..x' }) });
  const T = rig({ sw: { lts: 1 } }); T.graphed = 1;
  T.q.set({ plan: p, sync: true, map: C.mapTable(C.DEFAULT_MAP), prim: C.primaries(C.DEFAULT_MAP) }); T.play(0, 0, 120); T.run(800 * 25);
  const ps = T.stepPosts();
  assert.equal(ps[0].i, 'i7'); assert.equal(ps[0].F, 0);
  assert.deepEqual(T.steps.slice(0, 3).map(e => e.slice(1)), [[42, 1], [42, 100 / 127], [39, 100 / 127]], 'CH 42 under LC 64; CP 39');
  const T2 = rig({ sw: { cps: 1 } }); T2.q.set({ plan: p, sync: true }); T2.play(0, 0, 120); T2.run(800 * 25);
  assert.deepEqual(T2.steps.slice(0, 3).map(e => e.slice(1)), [[41, 1], [41, 100 / 127], [70, 100 / 127]], 'LT 41; MA 70 (the switch); the default primaries');
  // an AC-only or empty step: no trigger, no hook
  const T3 = rig(); T3.q.set({ plan: C.compilePlan(drum({}, {}, { 0: row({ ac: 'x' }) })), sync: true }); T3.play(0, 0, 120); T3.run(3840 * 25 * 2);
  assert.deepEqual([T3.trigs.length, T3.steps.length], [0, 0]); assert.ok(T3.stepPosts().length > 16);
  // the tables: DEF_MAP until a map arrives; a map, prim, mute, smp kept
  const q = DrSeq.create({ base: 48000 });
  assert.deepEqual(Array.from(q.map), Array.from(C.mapTable(C.DEFAULT_MAP)));
  const m2 = C.mapTable({ ...C.DEFAULT_MAP, sd: [40] });
  q.set({ map: m2, mute: 0x8001, smp: [null], prim: C.primaries({ ...C.DEFAULT_MAP, sd: [40] }) });
  assert.deepEqual([q.map[40], q.map[38], q.mute, q.prim[1], q.smp.length], [1, -1, 0x8001, 40, 1]);
});

test('hostile payloads never throw: an invalid plan is ignored with one warning, the playing one kept', () => {
  const S = dspScope({ files: [] }); S.run(source('dr-seq.js'), 'dr-seq.js');
  const D = S.global('DrSeq'), logs = S.logs;
  const good = plan({}, {}, PAT), q = D.create({ base: 48000, tp: { play: false } });
  q.set({ plan: good });
  const bad = [null, 5, {}, { ...good, key: 3 }, { ...good, n: 2 }, { ...good, loopFrom: 1 }, { ...good, mT: new Int32Array([0, 999]) },
    { ...good, mPre: new Uint8Array([7]) }, { ...good, st: new Uint16Array(3) }, { ...good, mOff: new Int32Array([0, 40]) },
    { ...good, fill: { pre: 9, l1: 1, l2: 0, st: [] } }, { ...good, n: 1e6 }];
  for (const b of bad) q.set({ plan: b, at: 'now' });
  q.set(null); q.set('x'); q.set({ swing: NaN, bpm: 'x', map: [1], prim: null, tap: Infinity });
  assert.equal(q.pl, good);
  assert.equal(logs.filter(l => l.level === 'warn').length, 1, 'one warning');
  assert.ok(D.valid(good) && D.valid(D.simplePlan([1, 2, 3], 4)) && D.valid(C.compilePlan(drum({ mode: 4 }))));
  assert.ok(D.valid(C.compilePlan(drum({ bvar: 1, fill: 1, intro: true }))));
});

/* ------------------------------------------------------------------ offline = live, allocation, D5 */

test('offline = live: the same transport messages give the same frames and posts, whatever quantum the payload arrived in', () => {
  const D = drum({ bvar: 1, fill: 4, intro: true }, { swing: 62 }, { ...PAT, 1: row({ sd: every() }), 24: row({ cp: every() }) });
  const go = pre => {
    const T = rig(); T.run(pre);
    const s = C.payload(D, C.initState(), 'now');
    T.q.set(s); T.play(4096, 3840 * 3, 133, { fresh: false }); T.until(4096 + 3840 * 6 * T.fptOf(133));
    return T.stepPosts().map(q => [q.F, q.s, q.m, q.k, q.v, q.M, q.f]);
  };
  const a = go(0), b = go(1024), c = go(3968);
  assert.ok(a.length > 80); assert.deepEqual(b, a); assert.deepEqual(c, a);
});

test('no allocation in events() (the vm\'s constructors stubbed) over many spans with steps, swaps and fills', () => {
  const pats = { ...PAT, 1: row({ sd: every() }), 24: row({ cp: every() }) };
  const T = rig(); T.q.set({ plan: C.compilePlan(drum({ bvar: 1, fill: 5 }, { swing: 70 }, pats)), sync: true, tap: 0 }); T.play(0, 0, 160);
  T.run(256);
  const p2 = C.compilePlan(drum({ sel: 2, bvar: 2, fill: 4 }, {}, pats));
  noAlloc(SCOPE, () => {
    T.run(48000 * 2);
    T.q.set({ tap: 1, swing: 55 }); T.q.set({ plan: p2, at: 'bar' }); T.q.set({ bpm: 100 });
    T.run(48000 * 2);
    T.play(T.frames + 64, 3840 * 7 + 11, 140); T.run(48000);
  });
  assert.ok(T.stepPosts().length > 40);
});

test('D5 (the sequencer vs → Piano roll through the song path): the same hits on the same frames at 120 BPM / 48 kHz (swing 50 and 62), on the same 4-frame grid point or the next at 97 BPM', () => {
  const pats = { ...PAT, 1: row({ bd: 'x..x..x...x.x...', lt: '..x', rs: '.....x', ch: 'x.x.x.x.x.x.x.xx' }), 24: row({ sd: 'xxxxxxxx', cp: '....x' }), 25: row({ cy: 'x' }) };
  const D = drum({ bvar: 1, fill: 4, intro: true }, {}, pats, { 12: { pre: 4 } });
  const sw = { lts: 1, rss: 0 }, tab = C.mapTable(D.map);
  const hits = (list, F2s) => list.map(([F, mask]) => F2s(F, mask)).flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [bpm, pct, exact] of [[120, 50, true], [120, 62, true], [97, 50, false], [97, 62, false]]) {
    const p = C.compilePlan(D), bars = 8, t1 = 3840 * bars, Fend = Math.floor((t1 * (48000 * 60 / (bpm * 960))) / 128 - 1) * 128;
    // the sequencer, synced from tick 0
    const A = rig({ sw }); A.q.set({ plan: p, sync: true, swing: pct }); A.play(0, 0, bpm); A.until(Fend);
    const seqHits = hits(A.trigs, (F, mask) => { const o = []; for (let l = 1; l < 12; l++) if (mask & (1 << l)) o.push([F, C.LANE_SOUND[l][sw[C.LANE_SW[l]] ? 1 : 0], mask & 1]); return o; });
    // the same window written to the roll and played as notes
    const notes = C.toNotes(p, { t0: 0, t1, swing: pct, sw, map: D.map });
    const B = rig({ sw }); B.setNotes(notes); B.play(0, 0, bpm); B.until(Fend);
    const noteHits = B.notes.filter(e => e[1] >= 0).map(e => [e[0], tab[e[1]], e[2] === 127 ? 1 : 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.ok(seqHits.length > 150, 'a busy pattern');
    assert.equal(noteHits.length, seqHits.length, `${bpm}/${pct}: the same number of hits`);
    if (exact) assert.deepEqual(noteHits, seqHits, `${bpm}/${pct}: bit-identical frames`);
    else noteHits.forEach((h, j) => { const s = seqHits[j]; assert.deepEqual([h[1], h[2]], [s[1], s[2]]); assert.ok(Math.abs(h[0] - s[0]) <= 4 && h[0] % 4 === 0 && s[0] % 4 === 0, `${bpm}/${pct} hit ${j}: ${h[0]} vs ${s[0]}`); });
  }
});

/* ================================================================== 7b: STEP RESET, the TR-606's plans, the tempo clock (IMPL-7b §12.4) */

// a TR-606 record (drum-core's second personality): ui / x replaced, patterns (rows cut to its 16 steps) and keys { sc, l1 }
function drum6(ui = {}, x = {}, pats = {}, keys = {}) {
  const d = clone(C.normDrum(undefined, 'tr606'));
  Object.assign(d.ui, ui); Object.assign(d.x, x);
  for (const [p, r] of Object.entries(pats)) d.st[+p] = r.slice(0, 16);
  for (const [k, o] of Object.entries(keys)) d.keys[+k] = { ...d.keys[+k], ...o };
  return C.normDrum(d, 'tr606');
}
const S6 = o => ({ ...C.initState('tr606'), ...o });
const P6 = { 0: row({ ac: 'x...x...x...x...', bd: 'x...x...x...x...', ch: every() }) };
// the posts expected of steps s0 … s1 − 1 of a measure starting at tick c0 (count M; 16ths, the odd ones w late): [s, M, o, tick]
const seg = (c0, M, s0, s1, w) => Array.from({ length: s1 - s0 }, (_, j) => { const s = s0 + j, o = s * 240 + (s & 1 ? w : 0); return [s, M, o, c0 + o]; });
// the first posts as [s, M, o], each on the 4-frame grid point (or the next) of its expected tick (from frame F0 at fpt)
function got(T, F0, fpt, want, msg) {
  const ps = T.stepPosts().slice(0, want.length);
  assert.equal(ps.length, want.length, msg + ': every post');
  ps.forEach((q, j) => near4(q.F, F0 + want[j][3] * fpt, `${msg} post ${j}`));
  return ps.map(q => [q.s, q.M, q.o]);
}

test('7b rst (STEP RESET, §3.5): an increment while running restarts the playing measure at the cursor\'s next EVEN step — on the straight grid, so every step after it keeps its swung place (50 / 62 %); the measure count continuing; synced and free; at a measure\'s step 1 nothing', () => {
  const p = C.compilePlan(drum6({}, {}, P6));
  assert.ok(DrSeq.valid(p));
  for (const pct of [50, 62]) {
    const w = C.swingTicks(pct, 240);
    // the request before the odd step 5 (1200 + w) or after it: both restart at step 6 (tick 1440 → its step 0)
    for (const free of [false, true]) for (const tq of [1100, 1300]) {
      const T = rig(), msg = `${pct} % ${free ? 'free' : 'synced'} at ${tq}`;
      let F0 = 0;
      if (free) { T.q.set({ plan: p, sync: false, run: false, bpm: 120, swing: pct, rst: 0 }); T.run(256); T.q.set({ run: true }); F0 = T.frames; }
      else { T.q.set({ plan: p, sync: true, swing: pct, rst: 0 }); T.play(0, 0, 120); }
      T.until(F0 + tq * 25); T.q.set({ rst: 1 }); T.until(F0 + 6000 * 25);
      const want = [...seg(0, 0, 0, 6, w), ...seg(1440, 0, 0, 16, w), ...seg(5280, 1, 0, 3, w)];
      assert.deepEqual(got(T, F0, 25, want, msg), want.map(e => e.slice(0, 3)), msg);
      const tr = T.trigs.find(e => e[0] === T.stepPosts()[6].F);
      assert.equal(tr[1], p.st[0], msg + ': the pattern\'s step 1 plays there (AC BD CH, not step 7\'s CH)');
    }
    // the request past the measure's last step: its next step is the next measure's step 1 — nothing moves, nothing later
    const T = rig(); T.q.set({ plan: p, sync: true, swing: pct, rst: 0 }); T.play(0, 0, 120);
    T.until(3700 * 25); T.q.set({ rst: 1 }); T.until(3840 * 3 * 25);
    const ref = refSteps(p, 3840 * 3 - 300, pct);
    assert.deepEqual(T.stepPosts().slice(0, ref.length).map(q => [q.s, q.M, q.o]), ref.map(e => [e[2], e[4], e[0] - e[4] * 3840]));
  }
});

test('7b rst: synced the shift holds until a re-anchor — a seek returns to the plan anchored at tick 0; a loop wrap keeps a pending request (the restart at the first even step after it), a seek drops it; a pending plan swap waits for the restarted measure\'s end; stopped, unchanged or the first payload\'s counter: none; hostile values ignored', () => {
  const p = C.compilePlan(drum6({}, {}, P6)), p2 = C.compilePlan(drum6({ sel: 1 }, {}, { 1: row({ sd: every() }) }));
  // restarted at 1440, then a seek to bar 3 + 720: anchored at tick 0 again (step 3 of measure 2, at the seek's frame)
  let T = rig(); T.q.set({ plan: p, sync: true, rst: 0 }); T.play(0, 0, 120);
  T.until(1100 * 25); T.q.set({ rst: 1 }); T.until(2000 * 25);
  assert.deepEqual(T.stepPosts().slice(-3).map(q => [q.s, q.o]), [[0, 0], [1, 240], [2, 480]]);
  const Fp = T.frames + 128; T.play(Fp, 3840 * 2 + 720, 120); T.until(Fp + 1000 * 25);
  const after = T.stepPosts().filter(q => q.F >= Fp);
  assert.deepEqual(after.slice(0, 3).map(q => [q.s, q.M, q.o]), [[3, 2, 720], [4, 2, 960], [5, 2, 1200]]);
  assert.equal(after[0].F, Fp);
  // a loop [1300, 5140): the request at 5100 is pending at the wrap; the wrap lands before step 6 (1440), the restart is there
  T = rig(); T.q.set({ plan: p, sync: true, rst: 0 }); T.play(0, 0, 120, { loop: true, ls: 1300, le: 5140 });
  T.until(5100 * 25); let n = T.stepPosts().length; T.q.set({ rst: 1 }); T.until(5140 * 25 + 900 * 25);
  const w1 = T.stepPosts().slice(n);
  assert.deepEqual(w1.slice(0, 4).map(q => [q.s, q.M, q.o]), [[0, 0, 0], [1, 0, 240], [2, 0, 480], [3, 0, 720]], 'kept across the wrap');
  near4(w1[0].F, (5140 + 140) * 25);
  // …a seek drops it (the same position by a seek: step 6 plays as step 6)
  T = rig(); T.q.set({ plan: p, sync: true, rst: 0 }); T.play(0, 0, 120);
  T.until(1100 * 25); T.q.set({ rst: 1 }); const Fs = T.frames + 128; T.play(Fs, 1300, 120); T.until(Fs + 600 * 25);
  assert.deepEqual(T.stepPosts().filter(q => q.F >= Fs).slice(0, 2).map(q => [q.s, q.M]), [[6, 0], [7, 0]], 'a seek drops it');
  // a key queued ('bar'), then TAP (the same new plan at 'now' + rst): the swap at the restarted measure's end (5280, not 3840)
  T = rig(); T.q.set({ plan: p, sync: true, rst: 0 }); T.play(0, 0, 120);
  T.until(1100 * 25); T.q.set({ plan: p2, at: 'bar' }); T.q.set({ plan: p2, at: 'now', rst: 1 }); T.until(6000 * 25);
  const m0 = T.stepPosts().filter(q => q.s === 0);
  assert.deepEqual(m0.slice(0, 3).map(q => [q.k, q.M]), [[0, 0], [0, 0], [1, 1]]);
  near4(m0[1].F, 1440 * 25); near4(m0[2].F, 5280 * 25, 'the swap at the restarted measure\'s end');
  // none: the first payload's counter and an unchanged one; an increment while stopped (synced, free); a free STOP / START
  // drops a pending one; hostile values — each run plays the plain grid from tick 0
  const R = refSteps(p, 3840 * 2).slice(0, 20).map(e => [e[2], e[4], e[0] - e[4] * 3840]), so = ps => ps.slice(0, 20).map(q => [q.s, q.M, q.o]);
  T = rig(); T.q.set({ plan: p, sync: true, rst: 4 }); T.q.set({ rst: 4 }); T.play(0, 0, 120); T.until(3840 * 2 * 25);
  assert.deepEqual(so(T.stepPosts()), R, 'the first counter, an unchanged one: none');
  T.transport({ play: false }); T.q.set({ rst: 5 }); T.run(4096); n = T.stepPosts().length;
  const Fq = T.frames + 128; T.play(Fq, 0, 120); T.until(Fq + 3840 * 2 * 25);
  assert.deepEqual(so(T.stepPosts().slice(n)), R, 'an increment while stopped: none');
  T = rig(); T.q.set({ plan: p, sync: false, run: false, bpm: 120, rst: 0 }); T.q.set({ rst: 1 }); T.q.set({ run: true }); T.until(3840 * 2 * 25);
  assert.deepEqual(so(T.stepPosts()), R, 'free, stopped: none');
  T = rig(); T.q.set({ plan: p, sync: false, run: true, bpm: 120, rst: 0 }); T.until(1100 * 25);
  T.q.set({ rst: 1 }); T.q.set({ run: false }); T.q.set({ run: true }); n = T.stepPosts().length; T.until(T.frames + 3840 * 2 * 25);
  assert.deepEqual([n, so(T.stepPosts().slice(n))], [5, R], 'a free STOP / START drops a pending one');
  const q = DrSeq.create({ base: 48000, tp: { play: true, frame: 0, tick: 0, fpt: 25 } });
  q.set({ plan: p, sync: true, rst: 0 }); for (const v of [NaN, 'x', Infinity, null, {}]) q.set({ rst: v });
  assert.equal(q.rstReq, 0, 'hostile: ignored');
});

test('7b review 2 #3 (the lead\'s decision): rstF, the press\'s heard frame — a STEP RESET heard before a measure start the cursor has passed is dropped (the pattern already restarted there: never twice); heard after it, or none (−1, hostile), restarts at the next even step as before; synced and free', () => {
  const p = C.compilePlan(drum6({}, {}, P6));
  for (const free of [false, true]) {
    // the payload arrives at tick 4270 (+200 ms of latency: the cursor past the bar line at 3840, steps 1 and 2 fired, step 3 next)
    const run = rstF => {
      const T = rig();
      let F0 = 0;
      if (free) { T.q.set({ plan: p, sync: false, run: false, bpm: 120, rst: 0, rstF: -1 }); T.run(256); T.q.set({ run: true }); F0 = T.frames; }
      else { T.q.set({ plan: p, sync: true, rst: 0, rstF: -1 }); T.play(0, 0, 120); }
      T.until(F0 + 4270 * 25); T.q.set({ rst: 1, rstF: typeof rstF === 'number' && rstF >= 0 ? F0 + rstF * 25 : rstF });
      T.until(F0 + 3840 * 3 * 25);
      return { T, F0, ps: T.stepPosts() };
    };
    const msg = free ? 'free' : 'synced', ref = refSteps(p, 3840 * 3 - 300);
    // heard at step 16 of measure 1 (tick 3700): the bar line it heard next already restarted the pattern — the plain grid
    let r = run(3700);
    assert.deepEqual(r.ps.slice(0, ref.length).map(q => [q.s, q.M, q.o]), ref.map(e => [e[2], e[4], e[0] - e[4] * 3840]), msg + ': dropped');
    r.ps.slice(0, ref.length).forEach((q, j) => near4(q.F, r.F0 + ref[j][0] * 25, msg + ' dropped, post ' + j));
    // heard at step 1 of measure 2 (tick 3900), none (−1), hostile: the restart at the cursor's next even step (tick 4320)
    for (const f of [3900, -1, NaN, 'x', Infinity, undefined]) {
      r = run(f);
      const want = [...seg(0, 0, 0, 16, 0), ...seg(3840, 1, 0, 2, 0), ...seg(4320, 1, 0, 16, 0), ...seg(8160, 2, 0, 3, 0)];
      assert.deepEqual(got(r.T, r.F0, 25, want, msg + ' ' + String(f)), want.map(e => e.slice(0, 3)), msg + ' restarted: ' + String(f));
    }
  }
  // a second press heard before the first one's restart was heard: that restart is its own — not a third
  const T = rig(); T.q.set({ plan: p, sync: true, rst: 0, rstF: -1 }); T.play(0, 0, 120);
  T.until(1100 * 25); T.q.set({ rst: 1, rstF: 900 * 25 }); T.until(1500 * 25); T.q.set({ rst: 2, rstF: 1000 * 25 }); T.until(5280 * 25 + 600 * 25);
  const want = [...seg(0, 0, 0, 6, 0), ...seg(1440, 0, 0, 16, 0), ...seg(5280, 1, 0, 3, 0)];
  assert.deepEqual(got(T, 0, 25, want, 'twice'), want.map(e => e.slice(0, 3)));
});

test('7b rst with a TAP fill (the 808\'s plan; the 606 has none): both requests at once — the restart at the next even step, the fill at the restarted measure\'s end, then the cycle; an rst inside the fill restarts the fill', () => {
  const D = drum({}, {}, { 0: row({ bd: every() }), 24: row({ cp: 'xxxxxxxx' }) }, { 12: { l1: 8 } });
  const T = rig(); T.q.set({ plan: C.compilePlan(D), sync: true, tap: 0, rst: 0 }); T.play(0, 0, 120);
  T.until(1100 * 25); T.q.set({ tap: 1, rst: 1 }); T.until(5580 * 25); T.q.set({ rst: 2 }); T.until(8000 * 25);
  const want = [...seg(0, 0, 0, 6, 0), ...seg(1440, 0, 0, 16, 0), ...seg(5280, 1, 0, 2, 0), ...seg(5760, 1, 0, 8, 0), ...seg(7680, 2, 0, 2, 0)];
  const fl = [0, 0, 0, 0, 0, 0, ...new Array(16).fill(0), 1, 1, ...new Array(8).fill(1), 0, 0];
  assert.deepEqual(got(T, 0, 25, want, 'tap + rst'), want.map(e => e.slice(0, 3)));
  assert.deepEqual(T.stepPosts().slice(0, want.length).map(q => q.f), fl);
  assert.deepEqual(T.stepPosts().slice(0, want.length).map(q => q.k), fl.map(f => (f ? 12 : 0)));
});

test('7b a TR-606 plan through the fake Track: SCALE 1–4 (16ths, 32nds, 8th / 16th triplets), a chain of four lengths, swing on the 16ths and 32nds only — synced at 120 / 97 BPM, and free', () => {
  const pats = { 0: row({ ch: every() }), 1: row({ sd: every() }), 2: row({ bd: every() }), 3: row({ cy: every(), ac: 'x' }) };
  const D = drum6({ sel: 0, cl: 3 }, {}, pats, { 0: { sc: 1, l1: 16 }, 1: { sc: 2, l1: 12 }, 2: { sc: 3, l1: 9 }, 3: { sc: 4, l1: 7 } });
  const p = C.compilePlan(D), cyc = 3840 + 1440 + 2880 + 1120;
  assert.deepEqual([Array.from(p.mKey), Array.from(p.mPre), Array.from(p.mL1), p.mT[4]], [[0, 1, 2, 3], [3, 4, 1, 2], [16, 12, 9, 7], cyc]);
  assert.ok(DrSeq.valid(p));
  for (const [bpm, pct, free] of [[120, 50, false], [120, 62, false], [97, 62, false], [120, 62, true]]) {
    const T = rig(), fpt = T.fptOf(bpm), ref = refSteps(p, cyc * 2, pct), msg = `${bpm}/${pct}${free ? ' free' : ''}`;
    let F0 = 0;
    if (free) { T.q.set({ plan: p, sync: false, run: false, bpm, swing: pct }); T.run(256); T.q.set({ run: true }); F0 = T.frames; }
    else { T.q.set({ plan: p, sync: true, swing: pct }); T.play(0, 0, bpm); }
    T.until(F0 + Math.ceil(cyc * 2 * fpt) + 128);
    const ps = T.stepPosts().slice(0, ref.length);
    assert.equal(ps.length, ref.length, msg);
    ps.forEach((q, j) => { const [tick, m, s, , M] = ref[j]; assert.deepEqual([q.s, q.m, q.k, q.M], [s, m, m, M], msg); near4(q.F, F0 + tick * fpt, `${msg} step ${j}`); });
    assert.deepEqual(T.trigs.slice(0, ref.length).map(e => e[1]), ref.map(e => e[3]), msg + ': the masks');
    if (pct === 62) assert.deepEqual(ref.slice(16, 20).map(e => e[0] - 3840), [0, 149, 240, 389], '32nds swung by 29 ticks');
  }
});

test('7b a TR-606 track through the fake Track: track 8\'s 256 bars synced (a start at bar 254 runs into the cycle\'s bar 1), a free located start\'s pre-roll then the cycle (loopFrom 2), the D.S. swaps to the rotated cycle at the bar\'s end', () => {
  const d = clone(C.normDrum(undefined, 'tr606'));
  for (let k = 0; k < 16; k++) d.st[k][0] = bit('bd');
  for (let j = 0; j < 256; j++) d.rt[448 + j] = j % 16;
  Object.assign(d.ui, { mode: 1, inst: 7 });
  const p = C.compilePlan(C.normDrum(d, 'tr606'));
  assert.deepEqual([p.n, p.loopFrom, p.mKey[253], p.st.length], [256, 0, 13, 4096]); assert.ok(DrSeq.valid(p));
  const T = rig(), fpt = T.fptOf(300);
  T.q.set({ plan: p, sync: true }); T.play(0, 3840 * 253, 300); T.until(3840 * 5 * fpt);
  const b0 = T.stepPosts().filter(q => q.s === 0);
  assert.deepEqual(b0.slice(0, 5).map(q => [q.m, q.k, q.M]), [[253, 13, 253], [254, 14, 254], [255, 15, 255], [0, 0, 256], [1, 1, 257]]);
  b0.slice(0, 5).forEach((q, j) => near4(q.F, j * 3840 * fpt));
  // free, located at bar 3 of a 4-bar track: bars 3 4 (the pre-roll), then 1 2 3 4 1 …
  const d2 = clone(C.normDrum(undefined, 'tr606'));
  for (let k = 0; k < 4; k++) { d2.st[k][0] = bit('bd'); d2.rt[k] = k; }
  Object.assign(d2.ui, { mode: 1, inst: 0 }); d2.x.sync = false;
  const D2 = C.normDrum(d2, 'tr606'), pr = C.compilePlan(D2, D2.ui, D2.x, S6({ bar: 2 }));
  assert.deepEqual([Array.from(pr.mKey), pr.loopFrom, pr.intro], [[2, 3, 0, 1, 2, 3], 2, 1]);
  const T2 = rig(); T2.q.set({ plan: pr, sync: false, run: true, bpm: 120 }); T2.until(3840 * 9 * 25);
  assert.deepEqual(T2.stepPosts().filter(q => q.s === 0).slice(0, 9).map(q => [q.m, q.k, q.M]),
    [[0, 2, 0], [1, 3, 1], [2, 0, 2], [3, 1, 3], [4, 2, 4], [5, 3, 5], [2, 0, 6], [3, 1, 7], [4, 2, 8]]);
  // synced with its segno on bar 3: a D.S. in bar 1 → bars 3 4 1 2 from bar 2; a second D.S. (a new key) in bar 5 → 3 again
  const d3 = clone(D2); d3.x.sync = true; d3.sg[0] = 2;
  const D3 = C.normDrum(d3, 'tr606'), plain = C.compilePlan(D3), ds1 = C.compilePlan(D3, D3.ui, D3.x, S6({ ds: 1 })), ds2 = C.compilePlan(D3, D3.ui, D3.x, S6({ ds: 2 }));
  assert.deepEqual([Array.from(plain.mKey), Array.from(ds1.mKey), ds1.loopFrom, ds1.key !== ds2.key], [[0, 1, 2, 3], [2, 3, 0, 1], 0, true]);
  const T3 = rig(); T3.q.set({ plan: plain, sync: true }); T3.play(0, 0, 120);
  T3.until(1000 * 25); T3.q.set({ plan: ds1, at: 'bar' }); T3.until((3840 * 4 + 1000) * 25); T3.q.set({ plan: ds2, at: 'bar' }); T3.until(3840 * 8 * 25);
  assert.deepEqual(T3.stepPosts().filter(q => q.s === 0).slice(0, 8).map(q => [q.k, q.M]), [[0, 0], [2, 1], [3, 2], [0, 3], [1, 4], [2, 5], [3, 6], [0, 7]]);
});

test('7b clock(F), free (§3.5): running, the machine\'s own ticks at any frame — every 4-frame chunk of a span and 3 ms ahead of it (pos + F − sF) — rebased without a jump at a tempo change; stopped, F at its TEMPO; a START again from tick 0; no allocation, one preallocated reply', () => {
  const T = rig(), q = T.q, p = C.compilePlan(drum6({}, { sync: false }, P6)), reads = [];
  T.onSpan = (F, len) => {
    for (let o = 0; o < len; o += 4) { const c = q.clock(F + o); reads.push([F, F + o, c.t, c.tpf]); }
    const c = q.clock(F + len + 144); reads.push([F, F + len + 144, c.t, c.tpf]);
  };
  const f97 = T.fptOf(97), f133 = T.fptOf(133);
  let F0, Fc, Fs, F1;
  noAlloc(SCOPE, () => {
    q.set({ plan: p, sync: false, run: false, bpm: 97, rst: 0 }); T.run(1024);
    q.set({ run: true }); F0 = T.frames; T.run(48000 * 2);
    q.set({ bpm: 133 }); Fc = T.frames; T.run(48000);
    q.set({ rst: 1 }); T.run(24000);                                   // (a STEP RESET moves the steps, never the clock)
    q.set({ run: false }); Fs = T.frames; T.run(4096);
    q.set({ run: true }); F1 = T.frames; T.run(9600);
  });
  const ref = (S, F) => (S < F0 ? [F / f97, 1 / f97] : S < Fc ? [(F - F0) / f97, 1 / f97] : S < Fs ? [(Fc - F0) / f97 + (F - Fc) / f133, 1 / f133]
    : S < F1 ? [F / f133, 1 / f133] : [(F - F1) / f133, 1 / f133]);
  let worst = 0;
  for (const [S, F, t, tpf] of reads) { const [rt, rf] = ref(S, F); worst = Math.max(worst, Math.abs(t - rt) / Math.max(1, rt)); assert.equal(tpf, rf, 'tpf at ' + F); }
  assert.ok(worst < 1e-12, 'every reading the reference (worst ' + worst + ')');
  // the readings of one span: 4 · tpf a chunk; START at tick 0 exactly; the chunk at the tempo change = the old rate's value there
  for (let j = 1; j < reads.length; j++) if (reads[j][0] === reads[j - 1][0] && reads[j][1] - reads[j - 1][1] === 4) assert.ok(Math.abs(reads[j][2] - reads[j - 1][2] - 4 * reads[j][3]) < 1e-9);
  assert.deepEqual([F0, F1].map(F => reads.find(r => r[1] === F && r[0] === F)[2]), [0, 0]);
  assert.equal(reads.find(r => r[0] === Fc && r[1] === Fc)[2], (Fc - F0) / f97);
  assert.ok(T.stepPosts().length > 25, 'the steps played meanwhile');
  // the stopped clock of a fresh machine (no payload): 120 BPM; the reply is one preallocated object
  const q0 = DrSeq.create({ base: 48000 }), c0 = q0.clock(4800);
  assert.deepEqual([c0.t, c0.tpf], [192, 1 / 25]);
  assert.equal(q0.clock(9600), c0); assert.equal(c0.t, 384);
});

test('7b clock(F), synced (§3.5, D5): playing, the song\'s ticks — tickAt(F)\'s own expression, bit-identical at every chunk and ahead, across a tempo change and a loop wrap; stopped, before any transport (tp.fpt 1) and after one, F at the Inst\'s bpm (the project\'s), never tp.fpt; a free machine stopped while the song plays: the song\'s ticks', () => {
  const T = rig({ pbpm: 97 }), q = T.q, reads = [];
  T.onSpan = (F, len) => {
    for (let o = 0; o <= len; o += 4) { const Fx = o === len ? F + len + 144 : F + o, c = q.clock(Fx); reads.push([F, Fx, c.t, c.tpf, T.tp.play, T.tickAt(Fx), 1 / T.tp.fpt]); }
  };
  let Fp, Fs, Fq;
  noAlloc(SCOPE, () => {
    q.set({ plan: C.compilePlan(drum6({}, {}, P6)), sync: true, swing: 62 });
    T.run(2048);                                                       // (no transport yet: tp.fpt is 1)
    Fp = T.frames + 128; T.play(Fp, 0, 120, { loop: true, ls: 960, le: 3840 }); T.run(3840 * 25 * 2);
    const F1 = T.frames; T.play(F1, T.tickAt(F1), 90, { seek: false, fresh: false, loop: true, ls: 960, le: 3840 }); T.run(3840 * 33 * 2);
    T.transport({ play: false }); Fs = T.frames; T.run(4096);
    Fq = T.frames + 64; T.play(Fq, 3840 * 2, 133); T.run(9600);
  });
  const f97 = T.fptOf(97);
  let nPlay = 0, nStop = 0;
  for (const [, F, t, tpf, play, tick, tpfSong] of reads) {
    if (play) { nPlay++; if (t !== tick || tpf !== tpfSong) assert.fail(`the song's ticks at ${F}: ${t} vs ${tick}`); }
    else { nStop++; if (!(Math.abs(t - F / f97) <= 1e-12 * F / f97 && tpf === 1 / f97)) assert.fail(`stopped at ${F}: ${t} vs ${F / f97}`); }
  }
  assert.ok(nPlay > 1000 && nStop > 500, `${nPlay} / ${nStop}`);
  assert.ok(reads.some(r => r[4] && r[1] > Fp + 3840 * 25 + 256 && r[2] < 1500), 'the loop wrapped (the ticks back to 960)');
  const atSpan = F => reads.find(r => r[0] === F && r[1] === F)[2];
  assert.equal(atSpan(Fp), 0, 'the start: tick 0 at its frame');
  assert.equal(atSpan(Fs), Fs / f97, 'the stop: the project\'s tempo at once (not the transport\'s 90)');
  assert.equal(atSpan(Fq), 3840 * 2, 'a start at bar 3');
  // a free machine, stopped, while the song plays: the song's ticks; stopped, its own TEMPO
  const T2 = rig({ pbpm: 97 }), r2 = [];
  T2.q.set({ plan: C.compilePlan(drum6({}, { sync: false }, P6)), sync: false, run: false, bpm: 150 });
  T2.onSpan = F => { const c = T2.q.clock(F); r2.push([c.t, T2.tp.play ? T2.tickAt(F) : F / T2.fptOf(150)]); };
  T2.run(1024); T2.play(T2.frames, 3840, 120); T2.run(48000); T2.transport({ play: false }); T2.run(1024);
  assert.ok(r2.every(([a, b]) => Math.abs(a - b) <= 1e-12 * Math.max(1, b)) && r2.length > 300);
  // synced with no bpm on the Inst (a stand-in): 120
  const q3 = DrSeq.create({ base: 48000, tp: { play: false, frame: 0, tick: 0, fpt: 1 } }); q3.set({ sync: true });
  assert.deepEqual([q3.clock(4800).t, q3.clock(4800).tpf], [192, 1 / 25]);
});
