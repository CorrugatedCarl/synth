// Tests of drum-core.js (lane S; IMPL-7a §12.3): normDrum (§6), the panel's state machine press — one test per row of the
// §3.3 table and per input of its "not covered" list —, compilePlan (§3.4: every mode × variation × fill × pre-scale × parts,
// the AB ? 2N : N cycle, the TAP fill, mute / solo, the content key), toNotes (§4.3), vTrig (§1.3), DEFAULT_MAP (§4.1), the
// payload (§3.5), the LEDs, and the constants dr-seq.js embeds.
// 7b (IMPL-7b §12.3, lane S6; after the 41 tests of 7a, unchanged): the 808 pinned to a digest taken before the 606 went in
// (records, sessions, payloads, plans, pk, notes, press); the TR-606's personality — its record, the dispatch on `m`, one
// test per row of 7b §3.3, its plans, LEDs, map, tempo law, SYNC 303s' swing.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as C from '../drum-core.js?v=9';
import { dspScope, source } from './dsp-scope.mjs';

const arr = a => Array.from(a);
const clone = x => JSON.parse(JSON.stringify(x));
const DEF = C.normDrum(undefined);
// a drum record with ui / x fields replaced
const mk = (ui = {}, x = {}, base = DEF) => C.normDrum({ ...clone(base), ui: { ...base.ui, ...ui }, x: { ...base.x, ...x } });
// press with a fresh session by default; the session of a running machine: synced and playing, or free and running
const P = (S, D, input) => C.press(S, D, input);
const playing = () => ({ ...C.initState(), play: true });
const freeRun = () => ({ ...C.initState(), run: true });
const heard = (S, D, post) => P(S, D, { k: 'heard', post: { s: 0, m: 0, k: 0, v: 0, p: 0, o: 0, M: 0, f: 0, ...post } }).state;
const at = r => r.cmds.filter(c => c.c === 'send').map(c => c.at);
const lane = id => C.LANES.indexOf(id);
const bit = id => 1 << lane(id);
// a pattern row from lane strings ('x' = hit)
function row(o) { const r = new Array(32).fill(0); for (const [l, s] of Object.entries(o)) for (let i = 0; i < s.length; i++) if (s[i] === 'x') r[i] |= bit(l); return r; }
function withPat(D, key, v, r, len) {
  const d = clone(D); d.st[key * 2 + v] = r; if (len) d.keys[key] = { ...d.keys[key], ...len }; return C.normDrum(d);
}

/* ------------------------------------------------------------------ constants, map, velocity */

test('constants: 12 lanes AC…CH, 16 sounds, the pairs and their switches, pre-scale ticks / steps per beat, fills, modes', () => {
  assert.deepEqual(arr(C.LANES), ['ac', 'bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch']);
  assert.deepEqual(arr(C.SOUNDS), ['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch', 'lc', 'mc', 'hc', 'cl', 'ma']);
  for (let l = 1; l < 12; l++) for (const k of [0, 1]) assert.equal(C.SOUND_LANE[C.LANE_SOUND[l][k]], l, 'sound → lane inverts lane → sound');
  assert.deepEqual([3, 4, 5, 6, 7].map(l => C.SOUNDS[C.LANE_SOUND[l][1]]), ['lc', 'mc', 'hc', 'cl', 'ma']);
  assert.deepEqual([3, 4, 5, 6, 7].map(l => C.LANE_SW[l]), ['lts', 'mts', 'hts', 'rss', 'cps']);
  // PRE-SCALE 1 → 3 a beat (8th triplets), 2 → 6, 3 → 4, 4 → 8: 320 / 160 / 240 / 120 ticks, every scale 960 a beat
  assert.deepEqual(arr(C.STEP_T), [0, 320, 160, 240, 120]);
  assert.deepEqual(arr(C.SPB), [0, 3, 6, 4, 8]);
  for (let p = 1; p <= 4; p++) assert.equal(C.STEP_T[p] * C.SPB[p], 960);
  assert.deepEqual(arr(C.SWUNG), [0, 0, 0, 1, 1]);
  assert.deepEqual(arr(C.FILLS), [0, 16, 12, 8, 4, 2]);
  assert.equal(C.MODES.length, 6);
  const T = C.PERS.tr808;
  assert.ok(Object.isFrozen(T) && Object.isFrozen(T.stepT));
  assert.equal(T.keys, 16); assert.equal(T.basic, 12); assert.equal(T.tracks, 12); assert.equal(T.trackLen, 64);
  assert.deepEqual(T.tempo, { lo: 40, hi: 300, clicks: 40 });
});

test('constants equal dr-seq.js\'s embedded copies (STEP_T, SPB, SWUNG, BEAT, LANE_SOUND, LANE_SW, bounds, swingTicks, the default map)', () => {
  const S = dspScope({ files: [] });
  S.run(source('dr-seq.js'), 'dr-seq.js');
  const D = S.global('DrSeq');
  assert.ok(D, 'DrSeq loaded');
  assert.deepEqual(arr(D.STEP_T), arr(C.STEP_T));
  assert.deepEqual(arr(D.SPB), arr(C.SPB));
  assert.deepEqual(arr(D.SWUNG), arr(C.SWUNG));
  assert.equal(D.BEAT, C.BEAT);
  assert.deepEqual(Array.from(D.LANE_SOUND, arr), C.LANE_SOUND.map(arr));
  assert.deepEqual(arr(D.LANE_SW), arr(C.LANE_SW));
  assert.equal(D.MAX_MEAS, C.MAX_MEAS); assert.equal(D.MAX_STEPS, C.MAX_STEPS);
  for (let pct = 50; pct <= 75; pct++) for (const T of [120, 160, 240, 320]) assert.equal(D.swingTicks(pct, T), C.swingTicks(pct, T));
  assert.deepEqual(arr(D.DEF_MAP), arr(C.mapTable(C.DEFAULT_MAP)));
  assert.deepEqual(arr(D.DEF_PRIM), arr(C.primaries(C.DEFAULT_MAP)));
  assert.equal(D.VER, 1);
});

test('DEFAULT_MAP (§4.1): GM numbers — bd 36 (+35), rs 37, sd 38 (+40), cp 39, lt 41 (+43), ch 42 (+44), mt 45 (+47), oh 46, ht 48 (+50), cy 49 (+57), cb 56, hc 62, mc 63, lc 64, ma 70, cl 75; unique', () => {
  const M = C.DEFAULT_MAP;
  assert.deepEqual(Object.keys(M).sort(), [...C.SOUNDS].sort());
  const prim = { bd: 36, rs: 37, sd: 38, cp: 39, lt: 41, ch: 42, mt: 45, oh: 46, ht: 48, cy: 49, cb: 56, hc: 62, mc: 63, lc: 64, ma: 70, cl: 75 };
  for (const [s, n] of Object.entries(prim)) assert.equal(M[s][0], n, s);
  assert.deepEqual([M.bd[1], M.sd[1], M.lt[1], M.ch[1], M.mt[1], M.ht[1], M.cy[1]], [35, 40, 43, 44, 47, 50, 57]);
  const all = Object.values(M).flat();
  assert.equal(new Set(all).size, all.length, 'every note maps to one sound');
  const t = C.mapTable(M);
  assert.equal(t[36], 0); assert.equal(t[42], 10); assert.equal(t[64], 11); assert.equal(t[60], -1);
  assert.deepEqual(C.drumRows(M).slice(0, 3), [{ n: 36, s: 0, name: 'Kick' }, { n: 38, s: 1, name: 'Snare' }, { n: 41, s: 2, name: 'Low tom' }]);
  assert.equal(C.drumRows(M).length, 16);
});

test('vTrig (§1.3): 100 = V_N, 127 = V_A at the ACCENT knob, between linear; ghosts below 100 down to 0.6 · V_N', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, a + ' ≈ ' + b);
  for (const acc of [0, 0.5, 1]) {
    const VA = 4 + acc * 10;
    near(C.vTrig(1, acc), 2.4);
    near(C.vTrig(50, acc), 4 * (0.6 + 0.4 * 49 / 99));
    near(C.vTrig(99, acc), 4 * (0.6 + 0.4 * 98 / 99));
    assert.equal(C.vTrig(100, acc), 4);
    near(C.vTrig(113, acc), 4 + (13 / 27) * (VA - 4));
    assert.equal(C.vTrig(127, acc), VA, 'exact at the top');
  }
  assert.equal(C.vTrig(127, 0), 4); assert.equal(C.vTrig(127, 1), 14); assert.equal(C.vTrig(127, 0.5), 9);
  assert.equal(C.vTrig(0, 0.5), 2.4); assert.equal(C.vTrig(200, 1), 14); assert.equal(C.vTrig(NaN, 0.5), 4);
  for (let v = 1; v < 127; v++) assert.ok(C.vTrig(v + 1, 0.7) > C.vTrig(v, 0.7), 'monotonic');
});

test('TEMPO (§3.2): 40 clicks on a log scale 40–300 BPM (≈ 5.3 % a click), FINE ± half a click; 120 BPM by default; bpmTempo inverts', () => {
  assert.equal(C.tempoBpm(0, 0), 40); assert.equal(C.tempoBpm(39, 0), 300);
  assert.ok(Math.abs(C.tempoBpm(1, 0) / 40 - 1.053) < 1e-3);
  assert.equal(C.tempoBpm(DEF.ui.tempo, DEF.ui.fine), 120);
  for (const b of [40, 57.5, 97, 120, 133.33, 300]) { const k = C.bpmTempo(b); assert.ok(Math.abs(C.tempoBpm(k.tempo, k.fine) - b) < 0.02, b); }
  assert.equal(C.tempoBpm(39, 0.5), 300); assert.equal(C.tempoBpm(0, -0.5), 40);
});

/* ------------------------------------------------------------------ normDrum (§6) */

test('normDrum: the defaults — exact lengths, cleared keys 16 / 0 / pre 3, empty memory, neutral extras, SYNC on, the GM map', () => {
  assert.equal(DEF.v, 1);
  assert.equal(DEF.keys.length, 16); assert.deepEqual(DEF.keys[5], { pre: 3, l1: 16, l2: 0 });
  assert.equal(DEF.st.length, 32); assert.ok(DEF.st.every(r => r.length === 32 && r.every(m => m === 0)));
  assert.equal(DEF.rt.length, 768); assert.ok(DEF.rt.every(k => k === -1));
  assert.deepEqual(DEF.rtEnd, new Array(12).fill(-1));
  assert.deepEqual(DEF.x, { sync: true, swing: 50, mute: 0, solo: 0, rec: false, part: 0 });
  assert.deepEqual({ ...DEF.ui, fine: 0, tempo: 0 }, { mode: 3, inst: 1, fill: 0, bvar: 0, ifv: 0, pre: 3, sel: 0, ifk: 0, edf: 0, intro: false, tempo: 0, fine: 0 });
  assert.deepEqual(DEF.map, clone(C.DEFAULT_MAP));
  assert.deepEqual(DEF.smp, {});
  assert.deepEqual(Object.keys(DEF), ['v', 'keys', 'st', 'rt', 'rtEnd', 'ui', 'x', 'map', 'smp']);
});

test('normDrum: every bound clamped, masks to 12 bits, unknown fields dropped, idempotent (also through JSON)', () => {
  const d = {
    v: 7, junk: 1, keys: [{ pre: 9, l1: 0, l2: 40, x: 1 }, { pre: 2.6, l1: 12.4, l2: -3 }, 'bad'],
    st: [[0x1FFF, -1, 3.5, '4', 0xFFF, NaN]], rt: [16, -2, 7.7, null, 3], rtEnd: [70, 63, 128, -5, 900, 300],
    ui: { mode: 9, inst: -2, fill: 6, bvar: 1.4, ifv: 3, pre: 0, sel: 14, ifk: 7, edf: 2, intro: 1, tempo: 99, fine: 3, more: 1 },
    x: { sync: 'yes', swing: 99.6, mute: 0x1001, solo: -1, rec: 1, part: 4 },
    map: { bd: [36, 36, 200, 35.5, 37], rs: [37, 38], zz: [1] }, smp: { bd: { id: 'smp:0123456789abcdef', name: 'n'.repeat(99), on: true, z: 1 }, sd: { id: 'smp:XYZ' }, zz: {} },
  };
  const n = C.normDrum(d);
  assert.deepEqual(n.keys[0], { pre: 4, l1: 1, l2: 16 });
  assert.deepEqual(n.keys[1], { pre: 3, l1: 12, l2: 0 });
  assert.deepEqual(n.keys[2], { pre: 3, l1: 16, l2: 0 });
  assert.deepEqual(n.st[0].slice(0, 7), [0xFFF, 0xFFF, 0, 0, 0xFFF, 0, 0]);
  assert.deepEqual(n.rt.slice(0, 6), [15, -1, 8, -1, 3, -1]);
  assert.deepEqual(n.rtEnd.slice(0, 6), [70, -1, 128, -1, 767, -1], 'rtEnd ≥ its track\'s start (64 · t) or −1');
  assert.equal(C.normDrum({ rtEnd: [-1, 10] }).rtEnd[1], -1, 'track 2 cannot end before its start (64)');
  assert.deepEqual({ ...n.ui, fine: 0 }, { mode: 5, inst: 0, fill: 5, bvar: 1, ifv: 1, pre: 1, sel: 11, ifk: 3, edf: 1, intro: DEF.ui.intro, tempo: 39, fine: 0 });
  assert.equal(n.ui.fine, 0.5);
  assert.deepEqual(n.x, { sync: true, swing: 75, mute: 1, solo: 0xFFF, rec: false, part: 1 });
  assert.deepEqual(n.map.bd, [36, 37], 'duplicates / out of range / fractions dropped');
  assert.deepEqual(n.map.sd, [38, 40], 'a missing sound: its default notes');
  assert.deepEqual(n.map.rs, [], 'a note maps to one sound: bd (earlier) keeps 37, sd 38 — rs unmapped');
  assert.equal(n.map.zz, undefined);
  assert.deepEqual(n.smp, { bd: { id: 'smp:0123456789abcdef', name: 'n'.repeat(64), on: true } });
  assert.ok(!('junk' in n) && n.v === 1);
  assert.deepEqual(C.normDrum(n), n, 'idempotent');
  assert.deepEqual(C.normDrum(clone(n)), n, 'JSON round trip');
  assert.deepEqual(clone(C.normDrum(clone(n))), clone(n));
});

test('normDrum: hostile input never throws (non-objects, sparse / huge / cyclic arrays, throwing getters) and stays size-bounded', () => {
  const big = new Array(1e5).fill(0x7FF);
  const cyc = []; cyc.push(cyc);
  const evil = { get keys() { throw new Error('boom'); } };
  const inputs = [null, undefined, 0, 'drum', [], true, { keys: 'x', st: {}, rt: 5, ui: [], x: 'no', map: 3, smp: [] },
    { st: new Array(500).fill(big), rt: big, rtEnd: big, keys: new Array(500).fill({ pre: 2 }) }, { st: [cyc], rt: cyc, map: { bd: cyc } }, evil,
    { ui: { tempo: Infinity, fine: -Infinity, mode: NaN }, x: { swing: -Infinity, mute: 1e300 } }];
  for (const d of inputs) {
    const n = C.normDrum(d);
    assert.equal(n.st.length, 32); assert.equal(n.rt.length, 768); assert.equal(n.keys.length, 16);
    assert.ok(JSON.stringify(n).length < 12000, 'about 10 KB as JSON');
    assert.deepEqual(C.normDrum(n), n);
  }
  assert.deepEqual(C.normDrum(evil), DEF);
});

/* ------------------------------------------------------------------ compilePlan (§3.4) */

test('compilePlan: write modes play the edited key — A, B or A + B (AB), an I/F key at the I/F VARIATION; the whole measure (1st then 2nd part)', () => {
  let D = withPat(DEF, 2, 0, row({ bd: 'x...' }), { l1: 12, l2: 4, pre: 4 });
  D = withPat(D, 2, 1, row({ sd: 'x...' }));
  for (const mode of [0, 1, 2]) {
    const pA = C.compilePlan(mk({ mode, sel: 2, bvar: 0 }, {}, D));
    assert.equal(pA.n, 1); assert.deepEqual([pA.mKey[0], pA.mVar[0], pA.mPre[0], pA.mL1[0]], [2, 0, 4, 12]);
    assert.deepEqual(arr(pA.mOff), [0, 16]); assert.deepEqual(arr(pA.mT), [0, 16 * 120]);
    assert.equal(pA.st[0], bit('bd')); assert.equal(pA.fill, null); assert.equal(pA.intro, 0);
    const pB = C.compilePlan(mk({ mode, sel: 2, bvar: 2 }, {}, D));
    assert.deepEqual([pB.n, pB.mVar[0], pB.st[0]], [1, 1, bit('sd')]);
    const pAB = C.compilePlan(mk({ mode, sel: 2, bvar: 1 }, {}, D));
    assert.deepEqual([pAB.n, arr(pAB.mVar), arr(pAB.mOff)], [2, [0, 1], [0, 16, 32]]);
  }
  // 2nd PART with l2 = 0 plays the 1st part only (until CLEAR + N gives the 2nd part a length)
  const p0 = C.compilePlan(mk({ mode: 2, sel: 0 }));
  assert.deepEqual(arr(p0.mOff), [0, 16]);
  // an I/F key (edf): at ifv, AB does not apply
  const D2 = withPat(DEF, 13, 1, row({ cp: 'x' }), { l1: 8 });
  const pf = C.compilePlan(mk({ mode: 1, edf: 1, ifk: 1, ifv: 1, bvar: 1 }, {}, D2));
  assert.deepEqual([pf.n, pf.mKey[0], pf.mVar[0], pf.mL1[0], pf.st[0]], [1, 13, 1, 8, bit('cp')]);
});

test('compilePlan: MANUAL PLAY / COMPOSE — [intro] + one cycle of AB ? 2N : N measures; AB with fills every 4 = A B A F B A B F; fills never in the intro count', () => {
  const D = withPat(withPat(DEF, 12, 0, row({ sd: 'xxxx' }), { l1: 12, pre: 1 }), 0, 1, row({ bd: 'x' }));
  const seq = p => arr(p.mKey).map((k, i) => (k >= 12 ? 'F' : 'AB'[p.mVar[i]]));
  for (const mode of [3, 5]) {
    assert.deepEqual(seq(C.compilePlan(mk({ mode, bvar: 0, fill: 0 }, {}, D))), ['A']);
    assert.deepEqual(seq(C.compilePlan(mk({ mode, bvar: 2, fill: 0 }, {}, D))), ['B']);
    assert.deepEqual(seq(C.compilePlan(mk({ mode, bvar: 1, fill: 0 }, {}, D))), ['A', 'B']);
    assert.deepEqual(seq(C.compilePlan(mk({ mode, bvar: 1, fill: 4 }, {}, D))), ['A', 'B', 'A', 'F', 'B', 'A', 'B', 'F'], 'the review\'s #7');
    assert.deepEqual(seq(C.compilePlan(mk({ mode, bvar: 0, fill: 4 }, {}, D))), ['A', 'A', 'A', 'F']);
    assert.deepEqual(seq(C.compilePlan(mk({ mode, bvar: 1, fill: 5 }, {}, D))), ['A', 'F', 'B', 'F'], 'every 2nd');
    for (const [f, N] of [[1, 16], [2, 12], [3, 8]]) {
      const p = C.compilePlan(mk({ mode, bvar: 1, fill: f }, {}, D));
      assert.equal(p.n, 2 * N); assert.equal(seq(p).filter(c => c === 'F').length, 2);
      assert.deepEqual(seq(p).filter(c => c !== 'F'), Array.from({ length: 2 * N - 2 }, (_, i) => 'AB'[i & 1]), 'AB counts basic measures only');
    }
    const pi = C.compilePlan(mk({ mode, bvar: 1, fill: 4, intro: true }, {}, D));
    assert.deepEqual(seq(pi), ['F', 'A', 'B', 'A', 'F', 'B', 'A', 'B', 'F'], 'intro, then A (the 4th measure after the intro is the fill)');
    assert.deepEqual([pi.intro, pi.loopFrom, pi.mPre[0], pi.mL1[0]], [1, 1, 1, 12]);
    assert.ok(pi.n <= 33);
    // the TAP fill: the selected I/F key at the I/F VARIATION
    const p = C.compilePlan(mk({ mode, ifk: 0, ifv: 0 }, {}, D));
    assert.deepEqual([p.fill.k, p.fill.v, p.fill.pre, p.fill.l1, p.fill.l2, arr(p.fill.st).slice(0, 5)], [12, 0, 1, 12, 0, [bit('sd'), bit('sd'), bit('sd'), bit('sd'), 0]]);
    assert.equal(p.fill.st.length, 12);
  }
  // the measure lengths of each pre-scale and both parts
  for (let pre = 1; pre <= 4; pre++) for (const [l1, l2] of [[16, 0], [12, 0], [16, 16], [5, 3]]) {
    const p = C.compilePlan(mk({ mode: 3, sel: 4 }, {}, withPat(DEF, 4, 0, row({}), { pre, l1, l2 })));
    assert.deepEqual([arr(p.mOff), arr(p.mT), p.mPre[0], p.mL1[0]], [[0, l1 + l2], [0, (l1 + l2) * C.STEP_T[pre]], pre, l1]);
    assert.equal(p.st.length, l1 + l2);
  }
});

test('compilePlan: PLAY — the track\'s measures from its measure 1 (overflowing tracks too), AB counting its basic measures, I/F at ifv, holes silent, empty track empty', () => {
  const d = clone(mk({ mode: 4, inst: 2, bvar: 1, ifv: 1 }));
  const s0 = 128, keys = [0, 3, 12, 3, 3, -1, 5];
  keys.forEach((k, i) => { d.rt[s0 + i] = k; });
  d.rtEnd[2] = s0 + keys.length - 1;
  d.keys[3] = { pre: 2, l1: 6, l2: 6 };
  const D = C.normDrum(d), p = C.compilePlan(D);
  assert.equal(p.n, 7); assert.equal(p.loopFrom, 0); assert.equal(p.intro, 0);
  assert.deepEqual(arr(p.mKey), keys);
  assert.deepEqual(arr(p.mVar), [0, 1, 1, 0, 1, 0, 0], 'AB over the basic measures of the track (1st A), the fill at ifv B, the hole silent');
  assert.deepEqual(arr(p.mOff), [0, 16, 28, 44, 56, 68, 84, 100]);
  assert.ok(p.st.subarray(68, 84).every(m => m === 0));
  assert.ok(p.fill && p.fill.k === 12 && p.fill.v === 1, 'TAP in PLAY: the selected fill');
  // AB in PLAY ignores key changes (a track changing key every measure still plays B)
  const d2 = clone(D); [0, 1, 2, 3].forEach((k, i) => { d2.rt[s0 + i] = k; }); d2.rtEnd[2] = s0 + 3;
  assert.deepEqual(arr(C.compilePlan(C.normDrum(d2)).mVar), [0, 1, 0, 1]);
  // AUTO FILL IN in PLAY: ignored (the plan is the same)
  assert.equal(C.compilePlan(mk({ fill: 4 }, {}, D)).key, p.key);
  // an overflowing composition plays to its end; an empty track: nothing
  const d3 = clone(D); for (let j = 0; j < 70; j++) d3.rt[s0 + j] = 1; d3.rtEnd[2] = s0 + 69;
  assert.equal(C.compilePlan(C.normDrum(d3)).n, 70);
  const e = C.compilePlan(mk({ inst: 7 }, {}, D));
  assert.deepEqual([e.n, e.st.length, arr(e.mOff)], [0, 0, [0]]);
  // the longest plan: one track over the whole store, 32 steps a measure
  const d4 = clone(mk({ mode: 4, inst: 0 })); d4.rt.fill(0); d4.rtEnd[0] = 767; d4.keys[0] = { pre: 4, l1: 16, l2: 16 };
  const big = C.compilePlan(C.normDrum(d4));
  assert.equal(big.n, 768); assert.equal(big.st.length, C.MAX_STEPS); assert.equal(big.mT[768], 768 * 32 * 120);
});

test('compilePlan: mute / solo applied to the steps and the fill (AC by its own mute); pure, deterministic; the key stable and content-sensitive, the shape timing-only', () => {
  const r = row({ ac: 'x', bd: 'x', sd: 'x', ch: 'x' });
  const D = withPat(withPat(DEF, 0, 0, r), 12, 0, r);
  const st0 = p => [p.st[0], p.fill.st[0]];
  const all = bit('ac') | bit('bd') | bit('sd') | bit('ch');
  assert.deepEqual(st0(C.compilePlan(D)), [all, all]);
  assert.deepEqual(st0(C.compilePlan(mk({}, { mute: bit('sd') }, D))), [all & ~bit('sd'), all & ~bit('sd')]);
  assert.deepEqual(st0(C.compilePlan(mk({}, { solo: bit('bd') }, D))), [bit('ac') | bit('bd'), bit('ac') | bit('bd')], 'solo keeps AC');
  assert.deepEqual(st0(C.compilePlan(mk({}, { solo: bit('bd'), mute: bit('ac') }, D))), [bit('bd'), bit('bd')]);
  assert.deepEqual(st0(C.compilePlan(mk({}, { solo: bit('ac') }, D))), [all, all], 'a solo of AC alone changes nothing');
  // deterministic and memo-independent: a fresh copy compiles to equal arrays and the same key
  const a = C.compilePlan(mk({ bvar: 1, fill: 4 }, {}, D)), b = C.compilePlan(C.normDrum(clone(mk({ bvar: 1, fill: 4 }, {}, D))));
  assert.notEqual(a, b);
  assert.equal(a.key, b.key); assert.equal(a.shape, b.shape);
  for (const f of ['mKey', 'mVar', 'mPre', 'mL1', 'mOff', 'mT', 'st']) assert.deepEqual(arr(a[f]), arr(b[f]), f);
  assert.match(a.key, /^[0-9a-f]{8}$/);
  const m1 = mk({ bvar: 1, fill: 4 }, {}, D);
  assert.equal(C.compilePlan(m1), C.compilePlan(m1), 'memoised: the same record compiles to the same plan object');
  // sensitive: a step, a mute, a variation, the fill's content; the shape only by timing
  const k = x => C.compilePlan(x);
  const one = withPat(D, 0, 0, row({ ac: 'x', bd: 'x', sd: 'x', ch: 'x.x' }));
  assert.notEqual(k(one).key, k(D).key); assert.equal(k(one).shape, k(D).shape);
  assert.notEqual(k(mk({}, { mute: bit('ch') }, D)).key, k(D).key);
  assert.notEqual(k(withPat(D, 12, 0, row({ cy: 'x' }))).key, k(D).key, 'the fill is in the key');
  assert.equal(k(withPat(D, 12, 0, row({ cy: 'x' }))).shape, k(D).shape);
  assert.notEqual(k(withPat(D, 0, 0, r, { l1: 12 })).shape, k(D).shape);
  assert.notEqual(k(withPat(D, 0, 0, r, { pre: 4 })).shape, k(D).shape);
  assert.notEqual(k(mk({ bvar: 1 }, {}, D)).shape, k(D).shape);
  assert.equal(k(mk({}, { swing: 62 }, D)).key, k(D).key, 'swing rides the payload, not the plan');
});

test('planTicks: intro, one cycle, total', () => {
  const D = withPat(DEF, 12, 0, row({}), { l1: 12, pre: 1 });
  assert.deepEqual(C.planTicks(C.compilePlan(mk({ intro: true, bvar: 1 }, {}, D))), { intro: 3840, cycle: 7680, total: 11520 });
  assert.deepEqual(C.planTicks(C.compilePlan(mk({ mode: 4, inst: 0 }))), { intro: 0, cycle: 0, total: 0 });
});

/* ------------------------------------------------------------------ toNotes (§4.3) */

test('toNotes: the synced positions (anchored at tick 0, swing on whole ticks), primary notes, the switch picks the sound, v 100 / 127, the window', () => {
  let D = withPat(DEF, 0, 0, row({ ac: 'x...x', bd: 'x...x', lt: '.x', rs: '..x', cp: '...x', ch: 'xxxx' }));
  D = withPat(D, 0, 1, row({ sd: 'x' }));
  const p = C.compilePlan(mk({ bvar: 1 }, {}, D)); // A B A B …, 3840 ticks a measure
  const notes = C.toNotes(p, { t0: 0, t1: 3840 * 2, swing: 62, map: D.map, sw: { lts: 1, rss: 0, cps: 1 } });
  const w = Math.round((2 * 62 - 100) * 240 / 100);
  assert.equal(w, 58, '57.6 ticks → 58');
  assert.deepEqual(notes.filter(x => x.t < 3840), [
    { t: 0, d: 120, n: 36, v: 127 }, { t: 0, d: 120, n: 42, v: 127 },
    { t: 240 + w, d: 120, n: 42, v: 100 }, { t: 240 + w, d: 120, n: 64, v: 100 }, // LT with the switch on CONGA: low conga 64
    { t: 480, d: 120, n: 37, v: 100 }, { t: 480, d: 120, n: 42, v: 100 },
    { t: 720 + w, d: 120, n: 42, v: 100 }, { t: 720 + w, d: 120, n: 70, v: 100 }, // CP / MA on MA: maracas 70
    { t: 960, d: 120, n: 36, v: 127 },
  ]);
  assert.deepEqual(notes.filter(x => x.t >= 3840), [{ t: 3840, d: 120, n: 38, v: 100 }], 'B in the 2nd measure');
  // a window from bar 9 lands where the synced machine is (no rounding: whole ticks)
  const late = C.toNotes(p, { t0: 3840 * 8, t1: 3840 * 9, swing: 50, map: D.map });
  assert.deepEqual(late.map(x => x.t - 3840 * 8), [0, 0, 240, 240, 480, 480, 720, 720, 960]);
  assert.ok(late.every(x => Number.isInteger(x.t)));
  // sorted by t then note; an unmapped sound skipped; an AC-only step none; prim instead of the map
  const map = { ...clone(C.DEFAULT_MAP), ch: [] };
  assert.ok(!C.toNotes(p, { t0: 0, t1: 3840, map }).some(x => x.n === 42));
  assert.deepEqual(C.toNotes(C.compilePlan(withPat(DEF, 0, 0, row({ ac: 'x' }))), { t0: 0, t1: 3840 }), []);
  const prim = new Int8Array(16).fill(-1); prim[0] = 60;
  assert.deepEqual(C.toNotes(p, { t0: 0, t1: 1, prim }), [{ t: 0, d: 120, n: 60, v: 127 }]);
  assert.deepEqual(C.toNotes(C.compilePlan(mk({ mode: 4, inst: 0 })), { t0: 0, t1: 1e6 }), []);
});

test('toNotes: triplet scales unswung, 32nds swung per 32nd pair, an intro then the cycle', () => {
  const D = withPat(withPat(DEF, 0, 0, row({ bd: 'xxxx' }), { pre: 1 }), 12, 0, row({ sd: 'xx' }), { pre: 4, l1: 2 });
  const p1 = C.compilePlan(mk({ intro: true }, {}, D));
  const ts = C.toNotes(p1, { t0: 0, t1: 1300, swing: 70, map: D.map }).map(x => [x.t, x.n]);
  const w4 = Math.round((2 * 70 - 100) * 120 / 100);
  assert.deepEqual(ts, [[0, 38], [120 + w4, 38], [240, 36], [560, 36], [880, 36], [1200, 36]], 'intro of two 32nds (swung), then 8th triplets (not swung)');
});

/* ------------------------------------------------------------------ the payload (§3.5) */

test('payload: plan, clock, the tables the Inst reads; pk follows every field but `at`', () => {
  const S = C.initState(), D = mk({ tempo: 30, fine: 0 }, { sync: false, swing: 60, mute: bit('sd') });
  const s = C.payload(D, { ...S, run: true, tap: 3 }, 'bar');
  assert.equal(s.plan, C.compilePlan(D));
  assert.deepEqual([s.sync, s.run, s.bpm, s.swing, s.at, s.tap], [false, true, C.tempoBpm(30, 0), 60, 'bar', 3]);
  assert.deepEqual(arr(s.map), arr(C.mapTable(D.map))); assert.deepEqual(arr(s.prim), arr(C.primaries(D.map)));
  assert.equal(s.mute, 1 << 1, 'snare muted (sound bit 1)');
  assert.equal(s.smp, null);
  const s2 = C.payload(C.normDrum({ ...clone(D), smp: { sd: { id: 'smp:00000000000000aa', name: 'x', on: true } } }), S);
  assert.deepEqual(s2.smp[1], { id: 'smp:00000000000000aa', on: true }); assert.equal(s2.smp[0], null);
  assert.equal(C.payload(D, S, 'now').pk, C.payload(D, S, 'bar').pk);
  const pks = new Set([C.payload(D, S).pk, C.payload(D, { ...S, tap: 1 }).pk, C.payload(D, { ...S, run: true }).pk, s2.pk,
    C.payload(mk({}, { swing: 61 }, D), S).pk, C.payload(mk({ tempo: 31 }, {}, D), S).pk, C.payload(mk({}, { mute: 0 }, D), S).pk]);
  assert.equal(pks.size, 7);
  // synced: run is never sent (the transport runs it)
  assert.equal(C.payload(mk({}, { sync: true }, D), { ...S, run: true }).run, false);
  // the mute mask covers both sounds of a pair
  assert.equal(C.payload(mk({}, { mute: bit('lt') }, D), S).mute, (1 << 2) | (1 << 11));
});

/* ------------------------------------------------------------------ press: the §3.3 table, row by row */

test('§3.3 START/STOP: synced = the project\'s play / stop (one clock); free toggles the machine (step 1 from START); nothing in PATTERN CLEAR; at stop the selected key flashes', () => {
  const D = mk({ mode: 3, sel: 4 });
  let r = P(C.initState(), D, { k: 'start' });
  assert.deepEqual(r.cmds, [{ c: 'play' }]); assert.equal(r.mem, D); assert.equal(r.state.play, false, 'the host reports the transport');
  r = P(playing(), D, { k: 'start' });
  assert.deepEqual(r.cmds, [{ c: 'stop' }]);
  const F = mk({ mode: 3, sel: 4 }, { sync: false });
  r = P(C.initState(), F, { k: 'start' });
  assert.equal(r.state.run, true); assert.deepEqual(at(r), ['now']);
  assert.equal(C.payload(F, r.state).run, true);
  r = P(r.state, F, { k: 'start' });
  assert.equal(r.state.run, false); assert.equal(C.payload(F, r.state).run, false);
  for (const S of [C.initState(), playing()]) assert.deepEqual(P(S, mk({ mode: 0 }), { k: 'start' }).cmds, []);
  assert.deepEqual(P(freeRun(), mk({ mode: 0 }, { sync: false }), { k: 'start' }).cmds, []);
  // LEDs: stopped → the selected key flashing; running → the playing key steady
  assert.deepEqual(C.leds(C.initState(), D).step.map((v, i) => [i, v]).filter(e => e[1]), [[4, 2]]);
  const S1 = heard(playing(), D, { k: 4 });
  assert.deepEqual(C.leds(S1, D).step.map((v, i) => [i, v]).filter(e => e[1]), [[4, 1]]);
  assert.deepEqual(C.leds({ ...S1, play: false }, D).step.map((v, i) => [i, v]).filter(e => e[1]), [[4, 2]], 'at stop: back to flashing');
});

test('§3.3 step key, MANUAL PLAY: 1–12 the basic rhythm, 13–16 the I/F key; running → the next measure, during beat 1 → beat 2 of this one; one pending (the last)', () => {
  const D = mk({ mode: 3, sel: 0 });
  let r = P(C.initState(), D, { k: 'step', n: 5 });
  assert.equal(r.mem.ui.sel, 4); assert.deepEqual(at(r), ['now']);
  r = P(C.initState(), D, { k: 'step', n: 14 });
  assert.deepEqual([r.mem.ui.ifk, r.mem.ui.sel, r.mem.ui.edf], [1, 0, 1]); assert.deepEqual(at(r), ['now']);
  // running: heard in beat 2 → the next measure; in beat 1 (o < 960) → beat 2 (the quirk)
  const S2 = heard(playing(), D, { s: 5, o: 1200 });
  r = P(S2, D, { k: 'step', n: 3 });
  assert.equal(r.mem.ui.sel, 2); assert.deepEqual(at(r), ['bar']);
  const S1 = heard(playing(), D, { s: 2, o: 480 });
  assert.deepEqual(at(P(S1, D, { k: 'step', n: 3 })), ['beat2']);
  // one pending: the last pressed wins (the plan sent names it)
  const r1 = P(S2, D, { k: 'step', n: 3 }), r2 = P(S2, r1.mem, { k: 'step', n: 7 });
  assert.equal(r2.mem.ui.sel, 6);
  assert.deepEqual(arr(C.payload(r2.mem, S2, 'bar').plan.mKey), [6]);
  // the pending key flashes, the playing one is steady
  const L = C.leds(heard(playing(), r2.mem, { k: 0, s: 3 }), r2.mem).step;
  assert.deepEqual([L[0], L[6]], [1, 2]);
  // free and running: the same rules
  const F = mk({ mode: 3 }, { sync: false });
  assert.deepEqual(at(P(heard(freeRun(), F, { o: 0 }), F, { k: 'step', n: 2 })), ['beat2']);
});

test('§3.3 step key, PATTERN WRITE 1st / 2nd: stopped selects the key (basic or I/F, flashing); running toggles the instrument at that step of the part (key 16 in the 2nd part = step 32)', () => {
  for (const mode of [1, 2]) {
    let r = P(C.initState(), mk({ mode }), { k: 'step', n: 9 });
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.edf], [8, 0]);
    assert.equal(C.leds(C.initState(), r.mem).step[8], 2);
    r = P(C.initState(), r.mem, { k: 'step', n: 16 });
    assert.deepEqual([r.mem.ui.ifk, r.mem.ui.edf], [3, 1]);
    assert.equal(C.leds(C.initState(), r.mem).step[15], 2);
    assert.deepEqual(arr(C.compilePlan(r.mem).mKey), [15], 'the plan plays the key being written');
  }
  const D = mk({ mode: 1, sel: 2, inst: lane('sd') });
  let r = P(playing(), D, { k: 'step', n: 5 });
  assert.equal(r.mem.st[4][4], bit('sd')); assert.deepEqual(at(r), ['now']);
  r = P(playing(), r.mem, { k: 'step', n: 5 });
  assert.equal(r.mem.st[4][4], 0, 'a lit key again cancels');
  const D2 = mk({ mode: 2, sel: 2, inst: lane('ch') });
  r = P(playing(), D2, { k: 'step', n: 16 });
  assert.equal(r.mem.st[4][31], bit('ch'), '2nd part, key 16 = step 32');
  r = P(playing(), mk({ mode: 1, edf: 1, ifk: 0, ifv: 1, inst: 0 }), { k: 'step', n: 1 });
  assert.equal(r.mem.st[25][0], 1, 'an I/F key at the I/F VARIATION, AC included');
  // AB: the variation heard
  const D3 = mk({ mode: 1, sel: 0, bvar: 1, inst: 1 });
  assert.equal(P(heard(playing(), D3, { k: 0, v: 1 }), D3, { k: 'step', n: 1 }).mem.st[1][0], bit('bd'));
  assert.equal(P(heard(playing(), D3, { k: 0, v: 0 }), D3, { k: 'step', n: 1 }).mem.st[0][0], bit('bd'));
  // LEDs while running: the instrument's steps of the MODE's part, the playhead inverted
  const W = withPat(DEF, 0, 0, row({ bd: 'x.x' }), { l1: 12 });
  const D4 = mk({ mode: 1, sel: 0, inst: 1 }, {}, W);
  const L = C.leds(heard(playing(), D4, { k: 0, s: 2, p: 0 }), D4);
  assert.deepEqual(L.step.slice(0, 4), [1, 0, 4, 0]);
  assert.deepEqual(C.leds(heard(playing(), D4, { k: 0, s: 1 }), D4).step.slice(0, 3), [1, 3, 1]);
  assert.deepEqual(L.part, [1, 0]);
  assert.ok(L.step.slice(12).every(v => v === 0), 'beyond the length: off');
});

test('§3.3 TAP, write modes, running: the selected instrument (AC included) at the nearest step of the heard time, one sound a tap', () => {
  const D = mk({ mode: 1, sel: 1, inst: lane('oh') });
  const S = heard(playing(), D, { k: 1, s: 6, m: 0 });
  let r = P(S, D, { k: 'tap', f: 0.3 });
  assert.equal(r.mem.st[2][6], bit('oh')); assert.deepEqual(at(r), ['now']);
  r = P(S, D, { k: 'tap', f: 0.7 });
  assert.equal(r.mem.st[2][7], bit('oh'), 'more than half the step gone: the next');
  r = P(r.state, r.mem, { k: 'tap', f: 0.7 });
  assert.equal(r.mem.st[2][7], bit('oh'), 'writes, never toggles off');
  // the last step's next is the next measure's first (AB: its variation)
  const DA = mk({ mode: 1, sel: 1, bvar: 1, inst: 0 });
  r = P(heard(playing(), DA, { k: 1, v: 0, m: 0, s: 15 }), DA, { k: 'tap', f: 0.9 });
  assert.equal(r.mem.st[3][0], 1, 'B\'s step 1, AC');
  // the host's fraction: the heard step's length to the next step (swing: even steps long, odd short; the last to the bar)
  const Dw = mk({}, { swing: 62 }, D);
  assert.deepEqual([0, 1, 14, 15].map(s => C.stepLen(Dw, { k: 1, s })), [298, 182, 298, 182]);
  assert.equal(C.stepLen(mk({}, { swing: 62 }, withPat(D, 1, 0, row({}), { l1: 15 })), { k: 1, s: 14 }), 240, 'an odd count: the last (even) step to the bar');
  assert.equal(C.stepLen(withPat(D, 1, 0, row({}), { pre: 1 }), { k: 1, s: 3 }), 320);
  // stopped, or no heard step: nothing
  assert.deepEqual(P(C.initState(), D, { k: 'tap', f: 0 }).cmds, []);
  assert.deepEqual(P(playing(), D, { k: 'tap', f: 0 }).cmds, []);
});

test('§3.3 TAP, MANUAL PLAY: stopped toggles the intro (the I/F key flashes; START plays it first); running requests one fill at the next measure (the payload\'s tap counter)', () => {
  const D = mk({ mode: 3, ifk: 2 });
  let r = P(C.initState(), D, { k: 'tap' });
  assert.equal(r.mem.ui.intro, true); assert.deepEqual(at(r), ['now']);
  assert.equal(C.leds(C.initState(), r.mem).step[14], 2);
  assert.equal(C.compilePlan(r.mem).intro, 1);
  r = P(C.initState(), r.mem, { k: 'tap' });
  assert.equal(r.mem.ui.intro, false);
  r = P(playing(), D, { k: 'tap' });
  assert.equal(r.state.tap, 1); assert.equal(r.mem, D); assert.deepEqual(at(r), ['now']);
  r = P(r.state, mk({ fill: 4 }, {}, D), { k: 'tap' });
  assert.equal(r.state.tap, 2, 'on top of auto fill');
  assert.equal(C.payload(D, r.state).tap, 2);
});

test('§3.3 CLEAR, PATTERN CLEAR: the selected key per BASIC VARIATION (A, B or both), lengths 16 / 0, pre-scale 3; the notice\'s undo restores', () => {
  let D = withPat(withPat(DEF, 2, 0, row({ bd: 'x' }), { l1: 12, l2: 8, pre: 1 }), 2, 1, row({ sd: 'x' }));
  D = mk({ mode: 0 }, {}, D);
  let r = P(C.initState(), D, { k: 'step', n: 3 });
  assert.equal(r.mem.ui.sel, 2, 'the key to clear is selected in PATTERN CLEAR (RC §13\'s workflow)');
  D = r.mem;
  r = P(C.initState(), D, { k: 'clear' });
  assert.deepEqual([r.mem.st[4][0], r.mem.st[5][0], r.mem.keys[2]], [0, bit('sd'), { pre: 3, l1: 16, l2: 0 }]);
  assert.deepEqual(r.cmds, [{ c: 'send', at: 'now' }, { c: 'notice', text: 'Pattern 3 A cleared · tap to undo', undo: true }]);
  const u = P(r.state, r.mem, { k: 'undo' });
  assert.deepEqual([u.mem.st[4][0], u.mem.keys[2]], [bit('bd'), { pre: 1, l1: 12, l2: 8 }]);
  assert.equal(u.state.undo, null, 'one level');
  assert.deepEqual(P(u.state, u.mem, { k: 'undo' }).cmds, []);
  r = P(C.initState(), mk({ bvar: 2 }, {}, D), { k: 'clear' });
  assert.deepEqual([r.mem.st[4][0], r.mem.st[5][0]], [bit('bd'), 0]);
  assert.match(r.cmds[1].text, /^Pattern 3 B cleared/);
  r = P(C.initState(), mk({ bvar: 1 }, {}, D), { k: 'clear' });
  assert.deepEqual([r.mem.st[4][0], r.mem.st[5][0]], [0, 0]);
  assert.match(r.cmds[1].text, /^Pattern 3 A \+ B cleared/);
  r = P(C.initState(), mk({ edf: 1, ifk: 3, ifv: 1 }, {}, withPat(D, 15, 1, row({ cy: 'x' }))), { k: 'clear' });
  assert.equal(r.mem.st[31][0], 0); assert.match(r.cmds[1].text, /^Fill 4 B cleared/);
  // while synced and playing: the swap waits for the measure
  assert.deepEqual(at(P(playing(), D, { k: 'clear' })), ['bar']);
});

test('§3.3 CLEAR, write modes, running: PRE-SCALE latched for the key; CLEAR + N sets the MODE\'s part\'s last step (2nd: 16 → 32), the 1st leaves l2; stopped: nothing', () => {
  const D = mk({ mode: 1, sel: 6, pre: 4 });
  let r = P(playing(), D, { k: 'clear' });
  assert.equal(r.mem.keys[6].pre, 4); assert.deepEqual(at(r), ['bar']);
  assert.equal(C.compilePlan(r.mem).mPre[0], 4);
  r = P(playing(), withPat(D, 6, 0, row({}), { l2: 10 }), { k: 'clear+step', n: 4 });
  assert.deepEqual(r.mem.keys[6], { pre: 3, l1: 4, l2: 10 }, 'the 1st part does not touch l2');
  assert.deepEqual(at(r), ['bar']);
  r = P(playing(), mk({ mode: 2 }, {}, D), { k: 'clear+step', n: 16 });
  assert.deepEqual(r.mem.keys[6], { pre: 3, l1: 16, l2: 16 });
  assert.deepEqual(arr(C.compilePlan(r.mem).mOff), [0, 32], 'the measure runs to step 32');
  for (const S of [C.initState()]) {
    assert.deepEqual(P(S, D, { k: 'clear' }).cmds, []);
    assert.deepEqual(P(S, D, { k: 'clear+step', n: 4 }).cmds, []);
  }
  // A and B share the lengths and the scale
  const p = C.compilePlan(mk({ bvar: 1 }, {}, r.mem));
  assert.deepEqual([arr(p.mOff), arr(p.mPre)], [[0, 32, 64], [3, 3]]);
});

test('§3.3 CLEAR, COMPOSE, stopped: TRACK CLEAR of the selected track (its overflow too), with the undo notice', () => {
  const d = clone(mk({ mode: 5, inst: 1 }));
  for (let j = 64; j < 64 + 70; j++) d.rt[j] = 4;
  d.rtEnd[1] = 64 + 69; d.rt[0] = 2; d.rtEnd[0] = 0;
  const D = C.normDrum(d);
  const r = P(C.initState(), D, { k: 'clear' });
  assert.ok(r.mem.rt.slice(64, 134).every(k => k === -1)); assert.equal(r.mem.rtEnd[1], -1);
  assert.deepEqual([r.mem.rt[0], r.mem.rtEnd[0]], [2, 0], 'other tracks untouched');
  assert.equal(r.cmds[1].text, 'Track 2 cleared · tap to undo');
  const u = P(r.state, r.mem, { k: 'undo' });
  assert.deepEqual([u.mem.rtEnd[1], u.mem.rt[100]], [133, 4]);
  assert.deepEqual(P(playing(), D, { k: 'clear' }).cmds, [], 'running: nothing');
});

test('§3.3 COMPOSE, running: each measure\'s key recorded at its first step from the track\'s start; keys take effect at the next measure; STOP marks the last; an edit keeps the length; I/F keys write a fill; overflow into the next track', () => {
  const D0 = mk({ mode: 5, inst: 2, sel: 0 }, { sync: false });
  let r = P(C.initState(), D0, { k: 'start' }), S = r.state, D = r.mem;
  assert.ok(S.cmp && S.cmp.nw, 'an empty track: a new composition');
  const post = (M, k, s = 0) => { const q = P(S, D, { k: 'heard', post: { s, m: 0, k, v: 0, p: 0, o: s * 240, M, f: 0 } }); S = q.state; D = q.mem; };
  post(0, 0); post(0, 0, 5); post(1, 0);
  r = P(S, D, { k: 'step', n: 4 }); D = r.mem; S = r.state;
  assert.deepEqual(at(r), ['bar'], 'a key takes effect at the next measure (no beat-2 quirk in COMPOSE)');
  post(2, 3); post(3, 3);
  r = P(S, D, { k: 'step', n: 14 }); D = r.mem; S = r.state;
  assert.equal(S.tap, 1, 'an I/F key writes one fill into the next measure');
  post(4, 13, 0); post(4, 13, 7);
  assert.deepEqual(D.rt.slice(128, 134), [0, 0, 3, 3, 13, -1]);
  assert.equal(D.rtEnd[2], 132, 'STOP lands in measure 5: the last');
  r = P(S, D, { k: 'start' }); S = r.state; D = r.mem;
  assert.equal(S.cmp, null);
  // replay in COMPOSE: an edit (the track is not empty) replaces measures, the length unchanged
  r = P(S, D, { k: 'start' }); S = r.state; D = r.mem;
  assert.ok(S.cmp && !S.cmp.nw);
  post(0, 5); post(4, 6); post(5, 6); post(9, 6);
  assert.deepEqual(D.rt.slice(128, 134), [5, 0, 3, 3, 6, -1]); assert.equal(D.rtEnd[2], 132);
  // TAP in COMPOSE: one fill (recorded through the heard posts like any measure)
  assert.equal(P(S, D, { k: 'tap' }).state.tap, S.tap + 1);
  // overflow: a new composition past its 64 measures continues into the next track's region, which ends
  const d2 = clone(mk({ mode: 5, inst: 0 }, { sync: false })); d2.rt[64] = 9; d2.rtEnd[1] = 64;
  r = P(C.initState(), C.normDrum(d2), { k: 'start' }); S = r.state; D = r.mem;
  for (let M = 0; M < 66; M++) post(M, 1);
  assert.equal(D.rtEnd[0], 65); assert.deepEqual([D.rt[63], D.rt[64], D.rt[65]], [1, 1, 1]); assert.equal(D.rtEnd[1], -1);
  // the store's end bounds it
  const d3 = clone(mk({ mode: 5, inst: 11 }, { sync: false }));
  r = P(C.initState(), C.normDrum(d3), { k: 'start' }); S = r.state; D = r.mem;
  post(63, 2); post(64, 2);
  assert.equal(D.rtEnd[11], 767); assert.equal(D.rt[767], 2);
});

test('§3.3 COMPOSE synced: the measure index is the song\'s — from the song\'s start measure 1, a play from later records from there and leaves the earlier measures', () => {
  const D0 = mk({ mode: 5, inst: 0 });
  let r = P(C.initState(), D0, { k: 'transport', play: true }), S = r.state, D = r.mem;
  assert.ok(S.cmp && S.cmp.nw && S.cmp.m0 === 0);
  for (const M of [8, 9, 10]) { r = P(S, D, { k: 'heard', post: { s: 0, k: 2, M } }); S = r.state; D = r.mem; }
  assert.deepEqual(D.rt.slice(0, 12), [-1, -1, -1, -1, -1, -1, -1, -1, 2, 2, 2, -1]);
  assert.equal(D.rtEnd[0], 10);
  r = P(S, D, { k: 'transport', play: false });
  assert.equal(r.state.cmp, null);
  // posts not at a measure's first step, a silent hole, MANUAL PLAY: nothing recorded
  r = P(heard(playing(), D0, {}), mk({ mode: 3 }, {}, D0), { k: 'heard', post: { s: 0, k: 1, M: 0 } });
  assert.deepEqual(r.mem.rt.slice(0, 2), [-1, -1]);
});

test('§3.3 PLAY: the selected track from measure 1 with the variation switches, looping (the plan is the cycle); step keys and AUTO FILL IN do nothing there', () => {
  const d = clone(mk({ mode: 4, inst: 0 })); d.rt[0] = 1; d.rt[1] = 2; d.rtEnd[0] = 1;
  const D = C.normDrum(d), p = C.compilePlan(D);
  assert.deepEqual([p.n, p.loopFrom, arr(p.mKey)], [2, 0, [1, 2]]);
  assert.deepEqual(P(playing(), D, { k: 'step', n: 4 }).cmds, []);
  assert.deepEqual(P(C.initState(), D, { k: 'step', n: 4 }).cmds, []);
  const r = P(playing(), D, { k: 'fill', v: 4 });
  assert.equal(r.mem.ui.fill, 4); assert.deepEqual(r.cmds, [], 'AUTO FILL IN in PLAY: ignored');
  assert.deepEqual(at(P(playing(), D, { k: 'tap' })), ['now'], 'TAP in PLAY: one fill at the next measure');
});

test('§3.3 BASIC VARIATION: A / B / AB; a change applies at the next measure (running) — and re-anchors the AB phase there (DrSeq)', () => {
  const D = mk({ mode: 3 });
  let r = P(playing(), D, { k: 'bvar', v: 1 });
  assert.equal(r.mem.ui.bvar, 1); assert.deepEqual(at(r), ['bar']);
  assert.deepEqual(at(P(C.initState(), D, { k: 'bvar', v: 2 })), ['now']);
  assert.deepEqual(P(playing(), D, { k: 'bvar', v: 0 }).cmds, [], 'no change: nothing');
  // the variation LEDs: running, the one heard; stopped, the one first
  assert.deepEqual(C.leds(heard(playing(), D, { v: 1 }), D).vari, [0, 1]);
  assert.deepEqual(C.leds(C.initState(), mk({ bvar: 2 }, {}, D)).vari, [0, 1]);
  assert.deepEqual(C.leds(C.initState(), mk({ bvar: 1 }, {}, D)).vari, [1, 0], 'AB: A first');
});

test('§3.3 AUTO FILL IN: MANUAL = TAP only; N = every N-th measure the fill; back to MANUAL cancels; running → at the next measure', () => {
  const D = mk({ mode: 3 });
  let r = P(playing(), D, { k: 'fill', v: 4 });
  assert.equal(r.mem.ui.fill, 4); assert.deepEqual(at(r), ['bar']);
  assert.equal(C.compilePlan(r.mem).n, 4);
  r = P(playing(), r.mem, { k: 'fill', v: 0 });
  assert.equal(C.compilePlan(r.mem).n, 1, 'MANUAL: no fill in the cycle');
  assert.deepEqual(at(P(C.initState(), D, { k: 'fill', v: 2 })), ['now']);
});

test('§3.3 INSTRUMENT / TRACK: the instrument step keys and TAP write; the track for PLAY / COMPOSE (running: the next track from its measure 1, at the next measure)', () => {
  const W = mk({ mode: 1, sel: 0 });
  let r = P(playing(), W, { k: 'inst', v: 9 });
  assert.equal(r.mem.ui.inst, 9); assert.deepEqual(r.cmds, [], 'writing: no plan change');
  assert.equal(P(playing(), r.mem, { k: 'step', n: 1 }).mem.st[0][0], bit('cy'));
  r = P(playing(), mk({ mode: 4 }), { k: 'inst', v: 3 });
  assert.deepEqual(at(r), ['bar']);
  // COMPOSE running: recording moves to the new track from its measure 1 at the next measure
  const D = mk({ mode: 5, inst: 0 }, { sync: false });
  let q = P(C.initState(), D, { k: 'start' });
  let S = heard(q.state, q.mem, { s: 3, k: 0, M: 6 });
  q = P(S, q.mem, { k: 'inst', v: 4 });
  assert.deepEqual([q.state.cmp.tr, q.state.cmp.m0, q.state.cmp.nw], [4, 7, true]);
  q = P(q.state, q.mem, { k: 'heard', post: { s: 0, k: 1, M: 7 } });
  assert.deepEqual([q.mem.rt[256], q.mem.rtEnd[4]], [1, 256]);
});

test('§3.3 PRE-SCALE: only the switch — the next CLEAR latches it for the edited key (patterns keep their own)', () => {
  const D = mk({ mode: 1, sel: 0 });
  const r = P(playing(), D, { k: 'pre', v: 2 });
  assert.equal(r.mem.ui.pre, 2); assert.deepEqual(r.cmds, []);
  assert.equal(C.compilePlan(r.mem).mPre[0], 3);
  assert.equal(C.compilePlan(P(playing(), r.mem, { k: 'clear' }).mem).mPre[0], 2);
  assert.equal(P(playing(), r.mem, { k: 'clear' }).mem.keys[1].pre, 3, 'other keys keep theirs');
});

test('§3.3 TEMPO / FINE: free = the machine\'s tempo (the payload\'s bpm); synced = the project tempo (a bpm command), the knobs showing it', () => {
  const F = mk({}, { sync: false });
  let r = P(C.initState(), F, { k: 'tempo', v: 30 });
  assert.equal(r.mem.ui.tempo, 30); assert.deepEqual(at(r), ['now']);
  assert.equal(C.payload(r.mem, r.state).bpm, C.tempoBpm(30, F.ui.fine));
  r = P(r.state, r.mem, { k: 'fine', v: -0.25 });
  assert.equal(r.mem.ui.fine, -0.25); assert.equal(C.payload(r.mem, r.state).bpm, C.tempoBpm(30, -0.25));
  const S = P(C.initState(), DEF, { k: 'bpm', v: 120 }).state;
  r = P(S, DEF, { k: 'tempo', v: 22 });
  assert.equal(r.mem, DEF, 'synced: the device keeps its own tempo');
  const k = C.bpmTempo(120);
  assert.deepEqual(r.cmds, [{ c: 'bpm', v: C.tempoBpm(22, k.fine) }]);
  assert.deepEqual(P(S, DEF, { k: 'fine', v: 0 }).cmds, [{ c: 'bpm', v: C.tempoBpm(k.tempo, 0) }]);
});

/* ------------------------------------------------------------------ press: the inputs the table did not cover (§3.3) */

test('§3.3 not covered: MODE while running swaps at the next measure; WRITE 1st ↔ 2nd PART keeps the pattern running (the same plan)', () => {
  const D = mk({ mode: 3, sel: 0 });
  let r = P(playing(), D, { k: 'mode', v: 1 });
  assert.equal(r.mem.ui.mode, 1); assert.deepEqual(at(r), ['bar']);
  const k1 = C.compilePlan(r.mem).key;
  r = P(playing(), r.mem, { k: 'mode', v: 2 });
  assert.equal(C.compilePlan(r.mem).key, k1, '1st ↔ 2nd PART: the same plan (no swap)');
  assert.deepEqual(at(P(C.initState(), D, { k: 'mode', v: 4 })), ['now']);
  assert.deepEqual(P(playing(), D, { k: 'mode', v: 3 }).cmds, []);
});

test('§3.3 not covered: CLEAR + N only sets the length (the widget sends no plain CLEAR then); a plain CLEAR\'s release latches PRE-SCALE', () => {
  const D = mk({ mode: 1, sel: 0, pre: 1 });
  const r = P(playing(), D, { k: 'clear+step', n: 8 });
  assert.deepEqual(r.mem.keys[0], { pre: 3, l1: 8, l2: 0 }, 'the pre-scale untouched');
  assert.deepEqual(P(playing(), D, { k: 'clear' }).mem.keys[0], { pre: 1, l1: 16, l2: 0 });
});

test('§3.3 not covered: everything else does nothing (START in PATTERN CLEAR, step keys in PLAY, TAP in PATTERN CLEAR / PLAY stopped, CLEAR in MANUAL PLAY / PLAY, CLEAR + N stopped or outside the write modes, junk)', () => {
  const cases = [
    [C.initState(), mk({ mode: 0 }), { k: 'start' }],
    [playing(), mk({ mode: 4 }), { k: 'step', n: 2 }],
    [playing(), mk({ mode: 0 }), { k: 'tap', f: 0 }],
    [C.initState(), mk({ mode: 0 }), { k: 'tap' }],
    [C.initState(), mk({ mode: 4 }), { k: 'tap' }],
    [C.initState(), mk({ mode: 5 }), { k: 'tap' }],
    [playing(), mk({ mode: 3 }), { k: 'clear' }],
    [C.initState(), mk({ mode: 3 }), { k: 'clear' }],
    [playing(), mk({ mode: 4 }), { k: 'clear' }],
    [playing(), mk({ mode: 3 }), { k: 'clear+step', n: 4 }],
    [playing(), mk({ mode: 0 }), { k: 'clear+step', n: 4 }],
    [C.initState(), mk({ mode: 1 }), { k: 'clear+step', n: 4 }],
    [playing(), mk({ mode: 1 }), { k: 'step', n: 0 }],
    [playing(), mk({ mode: 3 }), { k: 'nope' }],
    [playing(), mk({ mode: 3 }), null],
    [playing(), mk({ mode: 3 }), { k: 'mute', lane: 12 }],
    [playing(), mk({ mode: 3 }), { k: 'grid', lane: 1, s: 40 }],
  ];
  for (const [S, D, i] of cases) {
    const r = P(S, D, i);
    assert.equal(r.mem, D, JSON.stringify(i)); assert.deepEqual(r.cmds, [], JSON.stringify(i));
  }
});

test('§3.3 not covered: the extras — SYNC (a free run ends), SWING, mute / solo (re-compile, at once), REC pads, the grid (any mode), the part shown', () => {
  let r = P(freeRun(), mk({}, { sync: false }), { k: 'sync', v: true });
  assert.deepEqual([r.mem.x.sync, r.state.run], [true, false]); assert.deepEqual(at(r), ['now']);
  r = P(C.initState(), DEF, { k: 'swing', v: 62.4 });
  assert.equal(r.mem.x.swing, 62); assert.equal(C.payload(r.mem, r.state).swing, 62);
  assert.equal(P(C.initState(), DEF, { k: 'swing', v: 99 }).mem.x.swing, 75);
  r = P(playing(), DEF, { k: 'mute', lane: 2 });
  assert.equal(r.mem.x.mute, 4); assert.deepEqual(at(r), ['now']);
  r = P(playing(), r.mem, { k: 'solo', lane: 1 });
  assert.equal(r.mem.x.solo, 2);
  // REC: a pad writes its lane (both sounds of a pair share it) at the nearest step while a write mode runs; off: nothing
  const W = mk({ mode: 1, sel: 0, inst: 1 }, { rec: true });
  const S = heard(playing(), W, { k: 0, s: 4 });
  r = P(S, W, { k: 'pad', sound: C.SOUNDS.indexOf('lc'), f: 0.1 });
  assert.equal(r.mem.st[0][4], bit('lt'));
  assert.deepEqual(P(S, mk({}, { rec: false }, W), { k: 'pad', sound: 0, f: 0 }).cmds, []);
  assert.deepEqual(P(S, mk({ mode: 3 }, {}, W), { k: 'pad', sound: 0, f: 0 }).cmds, []);
  // the grid: toggles the pattern shown — edited (write), heard (running), selected (stopped)
  r = P(C.initState(), mk({ mode: 3, sel: 5, bvar: 2 }), { k: 'grid', lane: 11, s: 3 });
  assert.equal(r.mem.st[11][3], bit('ch')); assert.deepEqual(at(r), ['now']);
  r = P(heard(playing(), DEF, { k: 7, v: 1 }), DEF, { k: 'grid', lane: 0, s: 31 });
  assert.equal(r.mem.st[15][31], 1);
  assert.equal(C.gridPat(C.initState(), mk({ mode: 2, edf: 1, ifk: 2, ifv: 1 })), 29);
  assert.equal(P(C.initState(), DEF, { k: 'part', v: 1 }).mem.x.part, 1);
  assert.equal(P(C.initState(), DEF, { k: 'rec', v: true }).mem.x.rec, true);
});

test('§3.3 not covered: MAP… (a note leaves its old sound; reset), SOUNDS… slots, DEMO (ours, with the undo notice; demoFree)', () => {
  let r = P(C.initState(), DEF, { k: 'map', sound: 'sd', notes: [40, 38, 38, 300] });
  assert.deepEqual(r.mem.map.sd, [40, 38]);
  assert.equal(C.mapTable(r.mem.map)[40], 1); assert.equal(C.primaries(r.mem.map)[1], 40);
  r = P(C.initState(), r.mem, { k: 'map', sound: 'cp', notes: [40] });
  assert.deepEqual([r.mem.map.cp, r.mem.map.sd], [[40], [38]], 'a note maps to one sound: the edited one');
  r = P(C.initState(), r.mem, { k: 'mapReset' });
  assert.deepEqual(r.mem.map, clone(C.DEFAULT_MAP));
  assert.deepEqual(P(C.initState(), DEF, { k: 'map', sound: 'zz', notes: [1] }).cmds, []);
  r = P(C.initState(), DEF, { k: 'smp', sound: 'bd', slot: { id: 'smp:0000000000000001', name: 'Kick', on: true } });
  assert.deepEqual(r.mem.smp.bd, { id: 'smp:0000000000000001', name: 'Kick', on: true }); assert.deepEqual(at(r), ['now']);
  assert.deepEqual(P(C.initState(), r.mem, { k: 'smp', sound: 'bd', slot: null }).mem.smp, {});
  assert.deepEqual(P(C.initState(), DEF, { k: 'smp', sound: 'bd', slot: { id: 'nope' } }).cmds, []);
  assert.equal(C.demoFree(DEF), true);
  r = P(C.initState(), DEF, { k: 'demo' });
  assert.ok(r.mem.st[0].some(m => m) && r.mem.st[1].some(m => m) && r.mem.st[24].some(m => m));
  assert.equal(C.demoFree(r.mem), false);
  assert.match(r.cmds[1].text, /^Demo loaded .* · tap to undo$/);
  assert.equal(C.demoFree(P(r.state, r.mem, { k: 'undo' }).mem), true);
});

test('press is pure: inputs are never mutated; an unchanged record comes back as the same reference', () => {
  const D = mk({ mode: 1, sel: 0 }), snap = clone(D), S = heard(playing(), D, { s: 3 }), sSnap = clone(S);
  for (const i of [{ k: 'step', n: 1 }, { k: 'clear' }, { k: 'clear+step', n: 5 }, { k: 'tap', f: 0.2 }, { k: 'mode', v: 3 }, { k: 'grid', lane: 2, s: 2 },
    { k: 'mute', lane: 3 }, { k: 'demo' }, { k: 'map', sound: 'bd', notes: [30] }, { k: 'heard', post: { s: 0, k: 1, M: 2 } }]) P(S, D, i);
  assert.deepEqual(clone(D), snap); assert.deepEqual(clone(S), sSnap);
  assert.equal(P(S, D, { k: 'pre', v: D.ui.pre }).mem.ui.pre, D.ui.pre);
  assert.equal(P(S, D, { k: 'bvar', v: D.ui.bvar }).mem, D);
});

/* ------------------------------------------------------------------ properties */

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DRSEQ = (() => { const S = dspScope({ files: [] }); S.run(source('dr-seq.js'), 'dr-seq.js'); return S.global('DrSeq'); })();

test('property: compilePlan for every mode × variation × fill × pre-scale × parts — the measure list by the rules, consistent offsets / ticks, a plan DrSeq accepts', () => {
  const r = rng(7);
  const base = clone(DEF);
  for (let p = 0; p < 32; p++) for (let s = 0; s < 32; s++) base.st[p][s] = Math.floor(r() * 4096);
  for (let t = 0; t < 12; t++) { const n = Math.floor(r() * 5); for (let j = 0; j < n; j++) base.rt[t * 64 + j] = Math.floor(r() * 16); base.rtEnd[t] = n ? t * 64 + n - 1 : -1; }
  let count = 0;
  for (let mode = 0; mode < 6; mode++) for (let bvar = 0; bvar < 3; bvar++) for (let fill = 0; fill < 6; fill++) for (let pre = 1; pre <= 4; pre++)
    for (const [l1, l2] of [[16, 0], [7, 0], [16, 16], [3, 9]]) for (const intro of [false, true]) {
      const d = clone(base);
      for (let k = 0; k < 16; k++) d.keys[k] = { pre: k % 2 ? pre : 5 - pre, l1, l2 };
      const D = C.normDrum({ ...d, ui: { ...d.ui, mode, bvar, fill, intro, sel: 3, ifk: 1, inst: 2, ifv: 1 } });
      const P = C.compilePlan(D), N = C.FILLS[fill] || 1, AB = bvar === 1;
      count++;
      assert.ok(DRSEQ.valid(P), 'DrSeq accepts it');
      assert.equal(P.mOff[0], 0); assert.equal(P.mT[0], 0); assert.equal(P.st.length, P.mOff[P.n]);
      for (let i = 0; i < P.n; i++) {
        const k = P.mKey[i], K = k < 0 ? C.CLEARED : D.keys[k];
        assert.equal(P.mOff[i + 1] - P.mOff[i], K.l1 + K.l2);
        assert.equal(P.mT[i + 1] - P.mT[i], (K.l1 + K.l2) * C.STEP_T[K.pre]);
        assert.equal(P.mPre[i], K.pre); assert.equal(P.mL1[i], K.l1);
        if (k >= 0) for (let s = 0; s < K.l1 + K.l2; s++) assert.equal(P.st[P.mOff[i] + s], D.st[k * 2 + P.mVar[i]][s]);
      }
      if (mode <= 2) assert.deepEqual([P.n, P.intro, P.fill], [AB ? 2 : 1, 0, null]);
      else if (mode === 4) assert.equal(P.n, Math.max(0, D.rtEnd[2] - 128 + 1));
      else {
        const it = intro ? 1 : 0;
        assert.equal(P.n, it + (AB ? 2 * N : N)); assert.equal(P.loopFrom, it);
        const cyc = Array.from(P.mKey).slice(it), fills = cyc.filter(k => k >= 12).length;
        assert.equal(fills, N > 1 ? (AB ? 2 : 1) : 0);
        cyc.forEach((k, i) => assert.equal(k >= 12, N > 1 && (i + 1) % N === 0));
        const vs = Array.from(P.mVar).slice(it).filter((_, i) => cyc[i] < 12);
        vs.forEach((v, i) => assert.equal(v, AB ? i & 1 : bvar === 2 ? 1 : 0));
        assert.ok(P.fill && P.fill.k === 13 && P.fill.v === 1);
      }
    }
  assert.equal(count, 6 * 3 * 6 * 4 * 4 * 2);
});

test('property: toNotes round trip — random patterns, swing, switches and windows: the notes are exactly the plan\'s hits at the sequencer\'s whole-tick positions (mapped back through mapTable)', () => {
  const r = rng(11);
  for (let round = 0; round < 40; round++) {
    const d = clone(DEF);
    for (let p = 0; p < 32; p++) for (let s = 0; s < 32; s++) d.st[p][s] = r() < 0.4 ? Math.floor(r() * 4096) : 0;
    for (let k = 0; k < 16; k++) d.keys[k] = { pre: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16), l2: r() < 0.3 ? Math.floor(r() * 17) : 0 };
    d.ui = { ...d.ui, mode: 3, sel: Math.floor(r() * 12), ifk: Math.floor(r() * 4), bvar: Math.floor(r() * 3), fill: Math.floor(r() * 6), intro: r() < 0.5 };
    const D = C.normDrum(d), P = C.compilePlan(D), pct = 50 + Math.floor(r() * 26), tab = C.mapTable(D.map), prim = C.primaries(D.map);
    const sw = { lts: r() < 0.5 ? 1 : 0, mts: r() < 0.5 ? 1 : 0, hts: r() < 0.5 ? 1 : 0, rss: r() < 0.5 ? 1 : 0, cps: r() < 0.5 ? 1 : 0 };
    const t0 = Math.floor(r() * 40000), t1 = t0 + Math.floor(r() * 40000);
    const got = C.toNotes(P, { t0, t1, swing: pct, sw, map: D.map }).map(x => [x.t, tab[x.n], x.v, x.d]);
    // the reference: walk the plan from tick 0 (intro, then the cycle) — independent of toNotes' measure search
    const want = [];
    let m = 0, start = 0;
    while (start < t1) {
      const pre = P.mPre[m], T = C.STEP_T[pre], w = C.SWUNG[pre] ? C.swingTicks(pct, T) : 0;
      for (let s = 0; s < P.mOff[m + 1] - P.mOff[m]; s++) {
        const t = start + s * T + (s % 2 ? w : 0), mask = P.st[P.mOff[m] + s];
        if (t < t0 || t >= t1) continue;
        for (let l = 1; l < 12; l++) if (mask & (1 << l)) {
          const snd = C.LANE_SOUND[l][sw[C.LANE_SW[l]] ? 1 : 0];
          if (prim[snd] >= 0) want.push([t, snd, mask & 1 ? 127 : 100, 120]);
        }
      }
      start += P.mT[m + 1] - P.mT[m]; m = m + 1 < P.n ? m + 1 : P.loopFrom;
    }
    want.sort((a, b) => a[0] - b[0] || prim[a[1]] - prim[b[1]]);
    assert.deepEqual(got, want, 'round ' + round);
  }
});

test('property: normDrum on random junk never throws, is idempotent and JSON-stable', () => {
  const r = rng(3);
  const junk = depth => {
    const k = Math.floor(r() * 9);
    if (depth > 3 || k === 0) return [null, undefined, NaN, Infinity, -1, 0.5, 1e9, 'x', true][Math.floor(r() * 9)];
    if (k < 4) return Array.from({ length: Math.floor(r() * 40) }, () => junk(depth + 1));
    if (k < 6) { const o = {}; for (const f of ['keys', 'st', 'rt', 'rtEnd', 'ui', 'x', 'map', 'smp', 'mode', 'sync', 'bd', 'id', 'pre', 'l1']) if (r() < 0.4) o[f] = junk(depth + 1); return o; }
    return Math.floor(r() * 5000) - 100;
  };
  for (let i = 0; i < 300; i++) {
    const n = C.normDrum(junk(0));
    assert.deepEqual(C.normDrum(n), n);
    assert.deepEqual(C.normDrum(clone(n)), n);
    assert.ok(C.compilePlan(n).n >= 0);
  }
});

/* ================================================================== 7b: the 808 pinned; the TR-606 (IMPL-7b §12.3) */

// the 808's outputs as one digest, taken at 0a05a11 (= 452f731's drum-core.js) before any 7b change: records (no model,
// 'tr808', a hostile `m`), sessions, payloads (plan, map, prim, smp, pk) at every `at`, plans, notes, the tables, and press
// over a long input sequence with its LEDs and grid — golden-drums builds its payloads from this module (review, D1)
function pin808(M) {
  const ser = v => JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? [x.constructor.name, Array.from(x)] : x));
  const parts = [], add = (name, v) => parts.push(name + ' ' + ser(v));
  let a = 0x9e3779b9 >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const DF = M.normDrum(undefined);
  add('def', DF); add('def808', M.normDrum(undefined, 'tr808')); add('init', M.initState()); add('init808', M.initState('tr808'));
  const junk = { v: 7, m: 'evil', junk: 1, keys: [{ pre: 9, l1: 0, l2: 40 }, 'bad'], st: [[0x1FFF, -1, 3.5]], rt: [16, -2, 7.7], rtEnd: [70, 63, 900],
    ui: { mode: 9, tempo: 99, fine: 3 }, x: { sync: 'yes', swing: 99.6, mute: 0x1001 }, map: { bd: [36, 36, 200], zz: [1] }, smp: { bd: { id: 'smp:0123456789abcdef', name: 'n', on: true } } };
  add('junk', M.normDrum(junk)); add('junk808', M.normDrum(junk, 'tr808'));
  const recs = [];
  for (let i = 0; i < 6; i++) {
    const d = clone(DF);
    for (let p = 0; p < 32; p++) for (let s = 0; s < 32; s++) d.st[p][s] = r() < 0.35 ? Math.floor(r() * 4096) : 0;
    for (let k = 0; k < 16; k++) d.keys[k] = { pre: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16), l2: r() < 0.3 ? Math.floor(r() * 17) : 0 };
    for (let t = 0; t < 12; t++) { const n = Math.floor(r() * 6); for (let j = 0; j < n; j++) d.rt[t * 64 + j] = Math.floor(r() * 17) - 1; d.rtEnd[t] = n ? t * 64 + n - 1 : -1; }
    d.ui = { ...d.ui, mode: i % 6, inst: Math.floor(r() * 12), fill: Math.floor(r() * 6), bvar: Math.floor(r() * 3), ifv: Math.floor(r() * 2), pre: 1 + Math.floor(r() * 4),
      sel: Math.floor(r() * 12), ifk: Math.floor(r() * 4), edf: r() < 0.3 ? 1 : 0, intro: r() < 0.5, tempo: Math.floor(r() * 40), fine: Math.round((r() - 0.5) * 100) / 100 };
    d.x = { sync: r() < 0.5, swing: 50 + Math.floor(r() * 26), mute: Math.floor(r() * 4096), solo: r() < 0.3 ? Math.floor(r() * 4096) : 0, rec: r() < 0.5, part: Math.floor(r() * 2) };
    d.map = { ...d.map, sd: [40, 38], cp: [], ma: [70, 71] };
    if (i & 1) d.smp = { sd: { id: 'smp:00000000000000aa', name: 's', on: true }, cy: { id: 'smp:00000000000000bb', name: 'c', on: false } };
    const D = M.normDrum(d); recs.push(D);
    add('rec' + i, D); add('rec808' + i, M.normDrum(d, 'tr808'));
    const plan = M.compilePlan(D, D.ui, D.x); add('plan' + i, plan);
    for (const S of [M.initState(), { ...M.initState(), run: true, tap: 3 }, { ...M.initState(), play: true, tap: 1 }]) for (const w of ['now', 'bar', 'beat2']) add('pl' + i + w, M.payload(D, S, w));
    add('notes' + i, M.toNotes(plan, { t0: Math.floor(r() * 9000), t1: 30000, swing: D.x.swing, sw: { lts: 1, rss: 1 }, map: D.map }));
    add('tabs' + i, [M.mapTable(D.map), M.primaries(D.map), M.drumRows(D.map), M.audible(D.x), M.soundMute(D.x), M.planTicks(plan), M.demoFree(D),
      M.gridPat(M.initState(), D), M.leds(M.initState(), D), M.stepLen(D, { k: 1, s: 3 })]);
  }
  const inputs = [{ k: 'start' }, { k: 'step', n: 3 }, { k: 'step', n: 14 }, { k: 'clear' }, { k: 'clear+step', n: 7 }, { k: 'tap', f: 0.7 }, { k: 'tap', f: 0.2 },
    { k: 'mode', v: 1 }, { k: 'inst', v: 9 }, { k: 'fill', v: 4 }, { k: 'bvar', v: 1 }, { k: 'ifv', v: 1 }, { k: 'pre', v: 2 }, { k: 'tempo', v: 30 }, { k: 'fine', v: 0.25 },
    { k: 'sync', v: false }, { k: 'swing', v: 61 }, { k: 'mute', lane: 4 }, { k: 'solo', lane: 2 }, { k: 'rec', v: true }, { k: 'part', v: 1 }, { k: 'grid', lane: 3, s: 5 },
    { k: 'pad', sound: 3, f: 0.6 }, { k: 'map', sound: 'cb', notes: [40, 41] }, { k: 'mapReset' }, { k: 'smp', sound: 'rs', slot: { id: 'smp:0000000000000001', name: 'R', on: true } },
    { k: 'demo' }, { k: 'undo' }, { k: 'heard', post: { s: 0, m: 0, k: 0, v: 1, p: 0, o: 0, M: 2, f: 0 } }, { k: 'transport', play: true }, { k: 'transport', play: false },
    { k: 'bpm', v: 133 }, { k: 'panic' }];
  for (let i = 0; i < recs.length; i++) {
    let S = i & 1 ? { ...M.initState(), play: true } : M.initState(), D = recs[i];
    for (let j = 0; j < inputs.length * 2; j++) {
      const q = M.press(S, D, inputs[(j * 7 + i) % inputs.length]);
      add('press' + i + '.' + j, [q.state, q.mem === D ? 'same' : q.mem, q.cmds, M.leds(q.state, q.mem), M.gridPat(q.state, q.mem)]);
      S = q.state; D = q.mem;
    }
  }
  add('demo', M.DEMO);
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

test('7b pins (§12.3, D1): the 808\'s records, sessions, payloads (plan, pk), plans, notes and press byte-identical to 452f731\'s; its payload gains no key', () => {
  assert.equal(pin808(C), '04ba14f690f40ffb96ff591581a2152b59c43da42404c7c8da4c161e0c812a34', 'the digest taken before the change');
  assert.deepEqual(C.initState(), { run: false, play: false, tap: 0, undo: null, pos: null, cmp: null, bpm: 120 });
  assert.deepEqual(C.initState('tr808'), C.initState());
  const s = C.payload(DEF, C.initState());
  assert.deepEqual(Object.keys(s), ['plan', 'sync', 'run', 'bpm', 'swing', 'at', 'tap', 'map', 'prim', 'mute', 'smp', 'pk'], 'no m, no rst (review #3)');
  assert.ok(!('m' in DEF));
  assert.deepEqual(C.normDrum(clone(DEF), 'tr808'), DEF);
});

// the 606's helpers: its defaults; a record with ui / x replaced; sessions (stopped, synced and playing); a 16-step row
// from lane strings; a pattern (and its key) replaced; track t's bars from its first (−1 a hole) with its group / D.C. /
// segno; a run of inputs (the last result, every command); held-state inputs; the lit LEDs as [key, code]
const D6 = C.normDrum(undefined, 'tr606');
const mk6 = (ui = {}, x = {}, base = D6) => C.normDrum({ ...clone(base), ui: { ...base.ui, ...ui }, x: { ...base.x, ...x } }, 'tr606');
const S6 = (o = {}) => ({ ...C.initState('tr606'), ...o });
const play6 = (o = {}) => S6({ play: true, ...o });
function row6(o) { const r = new Array(16).fill(0); for (const [l, s] of Object.entries(o)) for (let i = 0; i < s.length; i++) if (s[i] === 'x') r[i] |= bit(l); return r; }
function pat6(D, p, o, key) { const d = clone(D); d.st[p] = row6(o); if (key) d.keys[p] = { ...d.keys[p], ...key }; return C.normDrum(d, 'tr606'); }
const T6 = t => (t < 7 ? t * 64 : 448);
function trk6(D, t, keys, o = {}) {
  const d = clone(D);
  keys.forEach((k, j) => { d.rt[T6(t) + j] = k; });
  for (const f of ['tg', 'dc', 'sg']) if (o[f] != null) d[f][t] = o[f];
  return C.normDrum(d, 'tr606');
}
function run6(S, D, ...inputs) { let r = { state: S, mem: D, cmds: [] }; const all = []; for (const i of inputs) { r = C.press(r.state, r.mem, i); all.push(...r.cmds); } return { ...r, all }; }
const kd = (n, o) => ({ k: 'key', n, down: true, ...o }), ku = n => ({ k: 'key', n, down: false });
const FD = { k: 'fn', down: true }, FU = { k: 'fn', down: false }, CD = { k: 'clr', down: true }, CU = { k: 'clr', down: false };
const lit = L => L.step.map((v, i) => [i + 1, v]).filter(e => e[1]);
const keysOf = p => arr(p.mKey);

test('7b PERS.tr606 (§1.2, §4): the 808\'s lane bits and sound ids (& 0xE2F, every list 16 by sound id); SCALE → the 808\'s step codes; its map — seven sounds, GM numbers, the 808\'s primaries; DrSeq\'s default map plays them', () => {
  const T = C.PERS.tr606;
  assert.ok(Object.isFrozen(T) && Object.isFrozen(T.lanes) && Object.isFrozen(T.dials));
  assert.deepEqual(arr(T.lanes), [0, 1, 2, 3, 5, 9, 10, 11]);
  assert.deepEqual(T.lanes.map(l => C.LANES[l]), ['ac', 'bd', 'sd', 'lt', 'ht', 'cy', 'oh', 'ch']);
  assert.deepEqual(arr(T.codes), ['AC', 'BD', 'SD', 'LT', 'HT', 'CY', 'OH', 'CH']);
  assert.equal(T.mask, T.lanes.reduce((m, l) => m | (1 << l), 0)); assert.equal(T.mask, 0xE2F);
  assert.deepEqual(arr(T.sids), [0, 1, 2, 4, 8, 9, 10]);
  assert.deepEqual(T.lanes.slice(1).map(l => C.LANE_SOUND[l][0]), arr(T.sids), 'a lane\'s sound is the sound id');
  assert.equal(T.sounds.length, 16, 'sound lists stay 16 by sound id (review #17)');
  assert.deepEqual(T.dials, { mode: 4, inst: 8, sc: 4 }); assert.deepEqual(arr(T.modes), ['TRACK WRITE', 'TRACK PLAY', 'PATTERN PLAY', 'PATTERN WRITE']);
  assert.deepEqual([C.PERS.tr808.sids.length, C.PERS.tr808.mask], [16, 0xFFF]);
  // SCALE 1 16ths, 2 32nds, 3 8th triplets, 4 16th triplets → codes 3 / 4 / 1 / 2: 240 / 120 / 320 / 160 ticks, 4 / 8 / 3 / 6 a beat
  assert.deepEqual(arr(C.SC_CODE).slice(1).map(c => [c, C.STEP_T[c], C.SPB[c], C.SWUNG[c]]), [[3, 240, 4, 1], [4, 120, 8, 1], [1, 320, 3, 0], [2, 160, 6, 0]]);
  const M = C.MAP606, prim = C.primaries(M, 'tr606'), tab = C.mapTable(M, 'tr606');
  assert.deepEqual(M, { bd: [36, 35], sd: [38, 40], lt: [41, 43, 45], ht: [48, 50, 47], cy: [49, 57], oh: [46], ch: [42, 44] });
  for (const s of T.sids) assert.equal(prim[s], C.primaries(C.DEFAULT_MAP)[s], 'the 808\'s primary for ' + C.SOUNDS[s]);
  assert.equal(arr(prim).filter(n => n >= 0).length, 7);
  assert.deepEqual([43, 45, 47, 50, 37, 39, 56, 64].map(n => tab[n]), [2, 2, 4, 4, -1, -1, -1, -1], 'the GM toms fold onto its two; the 808\'s other sounds: none');
  assert.deepEqual(C.drumRows(M, 'tr606').map(e => [e.n, e.s, e.name]), [[36, 0, 'Kick'], [38, 1, 'Snare'], [41, 2, 'Low tom'], [48, 4, 'Hi tom'], [49, 8, 'Cymbal'], [46, 9, 'Open hat'], [42, 10, 'Closed hat']]);
  assert.deepEqual([36, 38, 41, 48, 49, 46, 42].map(n => DRSEQ.DEF_MAP[n]), [0, 1, 2, 4, 8, 9, 10], 'before a payload the Inst plays the 606\'s primaries (§1.4)');
  // the record's map: every sound present, the absent ones empty (a reader without the model fills nothing in)
  assert.deepEqual(Object.keys(D6.map), [...C.SOUNDS]);
  assert.deepEqual(arr(C.primaries(D6.map)), arr(prim)); assert.deepEqual(C.drumRows(D6.map).length, 7);
});

test('7b normDrum(·, \'tr606\') (§3.1): the defaults (32 cleared patterns of SCALE 1 / LAST STEP 16, PATTERN PLAY, BD, 120 BPM, SYNC on, its map); every bound; D.C. / segno inside their track\'s reach; idempotent, JSON-stable; hostile input never throws', () => {
  assert.deepEqual(Object.keys(D6), ['v', 'm', 'keys', 'st', 'rt', 'tg', 'dc', 'sg', 'ui', 'x', 'map', 'smp']);
  assert.deepEqual([D6.v, D6.m, D6.keys.length, D6.st.length, D6.rt.length], [1, 'tr606', 32, 32, 704]);
  assert.ok(D6.keys.every(k => k.sc === 1 && k.l1 === 16) && D6.st.every(r => r.length === 16 && r.every(m => m === 0)) && D6.rt.every(k => k === -1));
  assert.deepEqual([D6.tg, D6.dc, D6.sg], [new Array(8).fill(0), new Array(8).fill(-1), new Array(8).fill(-1)]);
  assert.deepEqual(D6.ui, { mode: 2, inst: 1, grp: 0, sel: 0, cl: 0, sc: 1, tempo: 120 });
  assert.deepEqual(D6.x, { sync: true, swing: 50, mute: 0, solo: 0, rec: false });
  assert.deepEqual(D6.smp, {});
  const d = { v: 3, m: 'tr606', junk: 1, keys: [{ sc: 9, l1: 0, pre: 2 }, { sc: 2.6, l1: 12.4 }, 'bad'], st: [[0xFFF, -1, 3.5, 0x1E2F, bit('mt') | bit('bd')]],
    rt: [16, -2, 7.7, null, 3], tg: [2, -1, 0.6, 'x'], dc: [100, 63, 300, 191, 0, 0, 639, 703], sg: [255, 256, 128, 127, -5, 320, 640, 448],
    ui: { mode: 7, inst: 9, grp: 3, sel: 13, cl: 3, sc: 0, tempo: 137.456, fine: 1 }, x: { sync: 0, swing: 99, mute: 0xFFF, solo: bit('mt'), rec: 1, part: 1 },
    map: { bd: [36], mt: [45], cp: [39], ht: [47, 47, 200] }, smp: { bd: { id: 'smp:0123456789abcdef', name: 'k', on: true }, cp: { id: 'smp:0123456789abcdef', name: 'c', on: true } } };
  const n = C.normDrum(d, 'tr606');
  assert.deepEqual(n.keys.slice(0, 3), [{ sc: 4, l1: 1 }, { sc: 3, l1: 12 }, { sc: 1, l1: 16 }]);
  assert.deepEqual(n.st[0].slice(0, 6), [0xE2F, 0xE2F, 0, 0xE2F, bit('bd'), 0], 'masks & 0xE2F: the lanes it lacks dropped');
  assert.deepEqual(n.rt.slice(0, 6), [15, -1, 8, -1, 3, -1]);
  assert.deepEqual(n.tg, [1, 0, 1, 0, 0, 0, 0, 0]);
  // the reach (§3.1): tracks 1–7 from 64 · t, track 8 from 448; ≤ 256 bars and the store's end (track 7: 384–639, 8: 448–703)
  assert.deepEqual(n.dc, [100, -1, 300, -1, -1, -1, 639, 703]);
  assert.deepEqual(n.sg, [255, 256, 128, -1, -1, 320, -1, 448]);
  assert.deepEqual(n.ui, { mode: 3, inst: 7, grp: 1, sel: 13, cl: 2, sc: 1, tempo: 137.46 }, 'a chain inside its block of four; 0.01 BPM');
  assert.deepEqual(n.x, { sync: true, swing: 75, mute: 0xE2F, solo: 0, rec: false });
  assert.deepEqual([n.map.bd, n.map.mt, n.map.cp, n.map.ht, n.map.lt], [[36], [], [], [47], [41, 43, 45]]);
  assert.deepEqual(n.smp, { bd: { id: 'smp:0123456789abcdef', name: 'k', on: true } }, 'its seven slots only');
  assert.ok(!('junk' in n) && !('fine' in n.ui) && !('part' in n.x));
  assert.deepEqual(C.normDrum(n), n, 'idempotent (by its own m)'); assert.deepEqual(C.normDrum(clone(n), 'tr606'), n, 'JSON round trip');
  assert.deepEqual(clone(C.normDrum(clone(n))), clone(n));
  const cyc = []; cyc.push(cyc);
  const evil = { m: 'tr606', get keys() { throw new Error('boom'); } };
  for (const x of [null, 5, 'x', [], { keys: 'x', st: {}, rt: 5, tg: 'x', dc: {}, sg: null, ui: [], x: 3, map: 2, smp: [] }, { st: [cyc], rt: cyc, map: { bd: cyc } }, evil,
    { st: new Array(500).fill(new Array(1e5).fill(0x7FF)), rt: new Array(1e5).fill(3), dc: new Array(1e5).fill(5) }, { ui: { tempo: Infinity, sel: NaN, cl: -Infinity } }]) {
    const r = C.normDrum(x, 'tr606');
    assert.deepEqual([r.m, r.rt.length, r.st.length, r.keys.length, r.tg.length], ['tr606', 704, 32, 32, 8]);
    assert.ok(JSON.stringify(r).length < 16000);
    assert.deepEqual(C.normDrum(r), r);
  }
  assert.deepEqual(C.normDrum(evil), D6, 'a throwing getter: the defaults');
});

test('7b the machine of a record (§3.1, review #4): normDrum(d) without a model keeps a 606\'s record a 606\'s; absent, unknown or hostile m → exactly the 808\'s; the model wins; a foreign session becomes the record\'s', () => {
  const d = trk6(mk6({ mode: 1, sel: 13, cl: 2, tempo: 137.5 }), 0, [3, 4]);
  assert.deepEqual(C.normDrum(d), d); assert.deepEqual(C.normDrum(clone(d)), d);
  for (const m of [undefined, 'tr808', 'tr909', 606, null, { toString: () => 'tr606' }]) {
    const r = C.normDrum({ ...clone(DEF), m });
    assert.deepEqual(r, DEF, 'm = ' + String(m)); assert.ok(!('m' in r));
  }
  assert.deepEqual(C.normDrum({ ...clone(DEF), get m() { throw new Error('no'); } }), DEF);
  const as808 = C.normDrum(d, 'tr808');
  assert.ok(!('m' in as808) && as808.rt.length === 768, 'the model wins over the record\'s m');
  assert.equal(C.normDrum(DEF, 'tr606').m, 'tr606');
  assert.deepEqual(Object.keys(C.initState('tr606')), ['run', 'play', 'pos', 'undo', 'bpm', 'bar', 'loc', 'fn', 'clr', 'held', 'wipe', 'twSel', 'dcArm', 'sgArm', 'rst', 'rstF', 'ds', 'show', 'gfl']); // (rstF: review 2 #3)
  const r = C.press({ ...C.initState(), play: true }, mk6(), kd(5));   // (an 808 session under a 606 record: the 606's session, its transport kept)
  assert.deepEqual([r.state.held, r.state.play, r.mem.ui.sel], [[5], true, 4]);
  assert.equal(C.payload(mk6(), C.initState()).rst, 0);
  const r8 = C.press(S6({ play: true, bpm: 99 }), mk({ mode: 3 }), { k: 'tap' }); // (…and a 606 session under an 808 record: the 808's)
  assert.deepEqual([r8.state.tap, r8.state.play, r8.state.bpm, 'held' in r8.state, r8.cmds], [1, true, 99, false, [{ c: 'send', at: 'now' }]]);
});

test('7b compilePlan / payload of a 606 never pass the 808\'s guards (review #20): keys 13–16 of group II, 137.5 BPM kept; the payload\'s m, rst, bpm (its TEMPO itself); pk changes with rst alone (review #3)', () => {
  const D = mk6({ sel: 12, cl: 3, grp: 1, tempo: 137.5 }, { sync: false, swing: 62 });
  const p = C.compilePlan(D);
  assert.deepEqual(keysOf(p), [28, 29, 30, 31]);
  const s = C.payload(D, C.initState('tr606'), 'bar');
  assert.equal(s.plan, p);
  assert.deepEqual(Object.keys(s), ['plan', 'sync', 'run', 'bpm', 'swing', 'at', 'tap', 'map', 'prim', 'mute', 'smp', 'm', 'rst', 'rstF', 'pk']);
  assert.deepEqual([s.sync, s.run, s.bpm, s.swing, s.at, s.tap, s.m, s.rst, s.rstF, s.smp], [false, false, 137.5, 62, 'bar', 0, 'tr606', 0, -1, null]);
  assert.deepEqual(arr(s.prim), arr(C.primaries(C.MAP606, 'tr606'))); assert.deepEqual(arr(s.map), arr(C.mapTable(D.map, 'tr606')));
  assert.equal(C.payload(D, C.initState('tr606'), 'now').pk, s.pk, 'not `at`');
  const r1 = C.payload(D, S6({ rst: 1 }));
  assert.equal(r1.plan.key, s.plan.key); assert.notEqual(r1.pk, s.pk); assert.equal(r1.rst, 1);
  const pks = new Set([s.pk, r1.pk, C.payload(D, S6({ run: true })).pk, C.payload(mk6({ tempo: 137.51 }, {}, D), S6()).pk, C.payload(mk6({}, { swing: 61 }, D), S6()).pk,
    C.payload(mk6({}, { mute: bit('sd') }, D), S6()).pk, C.payload(mk6({ sel: 13, cl: 2 }, {}, D), S6()).pk]);
  assert.equal(pks.size, 7);
  assert.equal(C.payload(D, S6({ run: true })).run, true);
  assert.equal(C.payload(mk6({}, { sync: true }, D), S6({ run: true })).run, false, 'synced: never run');
});

test('7b primaries(map, \'tr606\') (review #5): HT on 45 or 47 keeps HT\'s primary — the 808\'s normMap fills MT (45, 47) first; MAP… moves the note; → Piano roll writes HT\'s hits there', () => {
  for (const n of [45, 47]) {
    const map = { bd: [36], sd: [38], lt: [41], ht: [n], cy: [49], oh: [46], ch: [42] };     // (seven sounds, as a 606 map read without its model)
    assert.equal(C.primaries(map, 'tr606')[4], n);
    assert.equal(C.primaries(map)[4], -1, 'the 808\'s: MT takes ' + n + ', HT unmapped (the bug)');
    const D = run6(S6(), mk6(), { k: 'map', sound: 'ht', notes: [n] }).mem;
    assert.deepEqual(D.map.ht, [n]); assert.equal(C.mapTable(D.map, 'tr606')[n], 4); assert.equal(C.primaries(D.map, 'tr606')[4], n);
    assert.deepEqual(D.map.lt, n === 45 ? [41, 43] : [41, 43, 45], 'the note leaves the low tom');
    const p = C.compilePlan(pat6(D, 0, { ht: 'x...x' }));
    assert.deepEqual(C.toNotes(p, { t0: 0, t1: 3840, prim: C.primaries(D.map, 'tr606') }).map(x => [x.t, x.n]), [[0, n], [960, n]]);
  }
});

test('7b compilePlan, pattern modes (§3.4): the selection — one pattern or the chain sel … sel + cl of the group — looping; each measure its SCALE\'s code and its LAST STEP (a chain of mixed lengths); mute / solo; the key stable and sensitive, the shape timing-only; PATTERN PLAY = WRITE', () => {
  let D = pat6(D6, 20, { bd: 'x...x...x...', ch: 'xxxxxxxxxxxx' }, { sc: 2, l1: 12 });
  D = pat6(pat6(D, 21, { sd: 'x.x' }, { sc: 3, l1: 6 }), 22, { cy: 'x', ac: 'x' }, { sc: 4 });
  const p = C.compilePlan(mk6({ grp: 1, sel: 4, cl: 2 }, {}, D));
  assert.deepEqual([p.n, p.intro, p.loopFrom, p.fill], [3, 0, 0, null]);
  assert.deepEqual([keysOf(p), arr(p.mVar), arr(p.mPre), arr(p.mL1)], [[20, 21, 22], [0, 0, 0], [4, 1, 2], [12, 6, 16]], 'SCALE 2 → 32nds, 3 → 8th triplets, 4 → 16th triplets');
  assert.deepEqual([arr(p.mOff), arr(p.mT)], [[0, 12, 18, 34], [0, 1440, 1440 + 1920, 1440 + 1920 + 2560]]);
  assert.deepEqual([...p.st.subarray(0, 5)], [bit('bd') | bit('ch'), bit('ch'), bit('ch'), bit('ch'), bit('bd') | bit('ch')]);
  assert.deepEqual([p.st[12], p.st[13], p.st[14], p.st[18]], [bit('sd'), 0, bit('sd'), bit('cy') | 1]);
  assert.ok(DRSEQ.valid(p));
  assert.equal(C.compilePlan(mk6({ mode: 3, grp: 1, sel: 4, cl: 2 }, {}, D)).key, p.key, 'PATTERN WRITE plays the same plan');
  assert.deepEqual(arr(C.compilePlan(D6).mPre), [3], 'SCALE 1: sixteenths');
  // mute / solo (AC by its own mute only)
  assert.deepEqual([...C.compilePlan(mk6({ grp: 1, sel: 4 }, { mute: bit('ch') }, D)).st.subarray(0, 2)], [bit('bd'), 0]);
  assert.deepEqual([...C.compilePlan(mk6({ grp: 1, sel: 6 }, { solo: bit('sd') }, D)).st.subarray(0, 1)], [1], 'a solo keeps AC');
  assert.deepEqual([...C.compilePlan(mk6({ grp: 1, sel: 6 }, { mute: 1 }, D)).st.subarray(0, 1)], [bit('cy')]);
  // deterministic, memoised; the key sensitive, the shape timing-only; swing / tempo / the SCALE switch not in the plan
  const base = mk6({ grp: 1, sel: 4, cl: 2 }, {}, D), k = x => C.compilePlan(x);
  const b = k(C.normDrum(clone(base)));
  assert.notEqual(b, p); assert.equal(b.key, p.key); for (const f of ['mKey', 'mVar', 'mPre', 'mL1', 'mOff', 'mT', 'st']) assert.deepEqual(arr(b[f]), arr(p[f]), f);
  assert.equal(k(base), k(base));
  const step = pat6(base, 21, { sd: 'xxx' }, { sc: 3, l1: 6 });
  assert.notEqual(k(step).key, p.key); assert.equal(k(step).shape, p.shape);
  assert.notEqual(k(pat6(base, 21, { sd: 'x.x' }, { sc: 3, l1: 5 })).shape, p.shape);
  assert.notEqual(k(pat6(base, 21, { sd: 'x.x' }, { sc: 1, l1: 6 })).shape, p.shape);
  assert.notEqual(k(mk6({ cl: 1 }, {}, base)).key, p.key);
  for (const o of [[{}, { swing: 70 }], [{ tempo: 99 }, {}], [{ sc: 4 }, {}], [{ inst: 6 }, {}]]) assert.equal(k(mk6(o[0], o[1], base)).key, p.key, JSON.stringify(o));
});

test('7b compilePlan, track modes (§3.3, §3.4): TRACK PLAY first … the D.C. bar (none: the last written, an implicit D.C.), looping; a hole a silent bar of 16 sixteenths; an empty track nothing; a continued track its own group; free a located start a pre-roll, synced from bar 1; D.S. the rotated cycle; TRACK WRITE the key heard, else the bar\'s own', () => {
  let D = pat6(pat6(D6, 18, { bd: 'x' }), 21, { sd: 'x' }, { l1: 8 });
  D = trk6(mk6({ mode: 1, inst: 2 }, {}, D), 2, [2, 5, -1, 2, 5, 5], { tg: 1 });
  let p = C.compilePlan(D);
  assert.deepEqual([keysOf(p), p.loopFrom, p.intro], [[18, 21, -1, 18, 21, 21], 0, 0], 'no D.C.: to the last written bar, looping from bar 1');
  assert.deepEqual([arr(p.mL1), p.mPre[2]], [[16, 8, 16, 16, 8, 8], 3]);
  assert.ok(p.st.subarray(24, 40).every(m => m === 0), 'the hole');
  const Dd = trk6(D, 2, [], { dc: 131 });
  assert.deepEqual(keysOf(C.compilePlan(Dd)), [18, 21, -1, 18], 'the D.C. bar ends it');
  assert.equal(C.compilePlan(mk6({ inst: 5 }, {}, D)).n, 0, 'an empty track: nothing');
  // free: a located start (bar 3) is a pre-roll, then the cycle; synced (the same session): from bar 1 (anchored at tick 0)
  const S = S6({ bar: 130 }), F = mk6({}, { sync: false }, Dd);
  p = C.compilePlan(F, F.ui, F.x, S);
  assert.deepEqual([keysOf(p), p.loopFrom, p.intro], [[-1, 18, 18, 21, -1, 18], 2, 1]);
  assert.ok(DRSEQ.valid(p));
  assert.deepEqual(keysOf(C.compilePlan(Dd, Dd.ui, Dd.x, S)), [18, 21, -1, 18]);
  assert.deepEqual(keysOf(C.compilePlan(F, F.ui, F.x, S6({ bar: 128 }))), [18, 21, -1, 18], 'BAR RESET: no pre-roll');
  // D.S.: the cycle entered at the segno (loopFrom 0); each D.S. a new key over the same arrays; no segno: the plain track
  const Ds = trk6(Dd, 2, [], { sg: 129 });
  const r1 = C.compilePlan(Ds, Ds.ui, Ds.x, S6({ ds: 1 })), r2 = C.compilePlan(Ds, Ds.ui, Ds.x, S6({ ds: 2 })), plain = C.compilePlan(Ds);
  assert.deepEqual([keysOf(r1), r1.loopFrom, r1.intro], [[21, -1, 18, 18], 0, 0]);
  assert.equal(r1.shape, r2.shape); assert.notEqual(r1.key, r2.key); assert.notEqual(r1.key, plain.key);
  assert.equal(C.compilePlan(Dd, Dd.ui, Dd.x, S6({ ds: 3 })).key, C.compilePlan(Dd).key);
  assert.equal(C.compilePlan(mk6({ mode: 2 }, {}, Ds), undefined, undefined, S6({ ds: 3 })).key, C.compilePlan(mk6({ mode: 2 }, {}, Ds)).key, 'D.S. is TRACK PLAY\'s');
  // a continued track (its region full, the next track unused) plays on in the next region with its own group (review #15)
  const full = trk6(mk6({ inst: 0 }, {}, D), 0, [...new Array(64).fill(2), 5, 5], { tg: 1 });
  const pc = C.compilePlan(full);
  assert.equal(pc.n, 66); assert.deepEqual(keysOf(pc).slice(62), [18, 18, 21, 21], 'bars 65–66 in track 2\'s region: track 1\'s group II');
  const owned = C.normDrum({ ...clone(full), dc: [-1, 70, -1, -1, -1, -1, -1, -1] }, 'tr606');
  assert.equal(C.compilePlan(owned).n, 64, 'track 2 has its own D.C.: track 1 ends with its region');
  assert.deepEqual(C.track606(owned, 0), { start: 0, cap: 63, max: 255, end: 63 });
  assert.deepEqual(C.track606(full, 0), { start: 0, cap: 127, max: 255, end: 65 });
  assert.deepEqual([C.track606(D6, 6).max, C.track606(D6, 7).start, C.track606(D6, 7).max, C.track606(D6, 7).end], [639, 448, 703, -1]);
  // TRACK WRITE: the key / chain heard looping, else the bar's own pattern (a silent bar where none); no session: bar 1
  const W = mk6({ mode: 0 }, {}, D);
  assert.deepEqual(keysOf(C.compilePlan(W, W.ui, W.x, S6({ bar: 129 }))), [21]);
  assert.deepEqual(keysOf(C.compilePlan(W, W.ui, W.x, S6({ bar: 130 }))), [-1]);
  assert.deepEqual(keysOf(C.compilePlan(W, W.ui, W.x, S6({ bar: 129, twSel: { sel: 4, cl: 3 } }))), [20, 21, 22, 23]);
  assert.deepEqual(keysOf(C.compilePlan(W)), [18]);
  // the bounds: track 8's 256 bars with a 255-bar pre-roll ≤ 512 measures, ≤ 8192 steps
  const big = trk6(mk6({ mode: 1, inst: 7 }, { sync: false }), 7, new Array(256).fill(0));
  const pb = C.compilePlan(big, big.ui, big.x, S6({ bar: 449 }));
  assert.deepEqual([pb.n, pb.loopFrom, pb.st.length], [511, 255, 511 * 16]); assert.ok(DRSEQ.valid(pb));
});

test('7b §3.3 RUN/STOP: synced the project\'s ▶ / ■; free runs / stops the machine at its TEMPO — pattern modes from the selection\'s first, track modes at `bar`; nothing to play (an empty TRACK PLAY): START does nothing, STOP always stops', () => {
  const D = mk6({ sel: 5, cl: 2 });
  let r = P(S6(), D, { k: 'start' });
  assert.deepEqual(r.cmds, [{ c: 'play' }]); assert.equal(r.mem, D); assert.equal(r.state.play, false, 'the host reports the transport');
  assert.deepEqual(P(play6(), D, { k: 'start' }).cmds, [{ c: 'stop' }]);
  const F = mk6({ sel: 5, cl: 2 }, { sync: false });
  r = P(S6(), F, { k: 'start' });
  assert.equal(r.state.run, true); assert.deepEqual(at(r), ['now']);
  assert.deepEqual([C.payload(F, r.state).run, C.payload(F, r.state).plan.mKey[0]], [true, 5]);
  r = P(r.state, F, { k: 'start' });
  assert.equal(r.state.run, false); assert.deepEqual(at(r), ['now']); assert.equal(C.payload(F, r.state).run, false);
  const T = trk6(mk6({ mode: 1, inst: 0 }, { sync: false }), 0, [1, 2, 3]);
  r = P(S6({ bar: 1 }), T, { k: 'start' });
  assert.deepEqual(keysOf(C.payload(T, r.state).plan), [2, 3, 1, 2, 3], 'a track mode from `bar` (bar 2)');
  const E = mk6({ mode: 1, inst: 3 });
  assert.deepEqual(P(S6(), E, { k: 'start' }).cmds, []);
  assert.deepEqual(P(S6(), mk6({}, { sync: false }, E), { k: 'start' }).cmds, []);
  assert.deepEqual(P(play6(), E, { k: 'start' }).cmds, [{ c: 'stop' }]);
  assert.equal(P(S6({ run: true }), mk6({}, { sync: false }, E), { k: 'start' }).state.run, false);
  assert.deepEqual([C.leds(S6(), D).run, C.leds(play6(), D).run, C.leds(S6({ run: true }), F).run], [0, 1, 1], 'the RUN LED');
});

test('7b §3.3 key, stopped, PATTERN PLAY / WRITE: selects pattern grp · 16 + n − 1 (flashing); a second key down while the first is held, in its block of four, chains first … last (the first flashing, the rest steady), never across blocks; Shift + a key chains with the mouse', () => {
  for (const mode of [2, 3]) {
    const D = mk6({ mode });
    let r = run6(S6(), D, kd(5));
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl, r.all.map(c => c.at)], [4, 0, ['now']]);
    assert.deepEqual(lit(C.leds(r.state, r.mem)), [[5, 2]]);
    r = run6(r.state, r.mem, kd(7));
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl], [4, 2]);
    assert.deepEqual(lit(C.leds(r.state, r.mem)), [[5, 2], [6, 1], [7, 1]]);
    assert.deepEqual(keysOf(C.compilePlan(r.mem)), [4, 5, 6]);
    r = run6(r.state, r.mem, ku(5), ku(7));
    assert.deepEqual([r.state.held, r.mem.ui.sel, r.mem.ui.cl], [[], 4, 2], 'releasing keeps the chain');
    r = run6(S6(), D, kd(8), kd(6), ku(8), ku(6));
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl], [5, 2], 'either order');
    r = run6(S6(), D, kd(4), kd(5));
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl], [4, 0], 'key 5 is the next block: the second alone');
    r = run6(S6(), mk6({ mode, sel: 12 }), kd(16, { shift: true }), ku(16));
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl], [12, 3]);
    r = run6(S6(), mk6({ mode, sel: 12 }), kd(11, { shift: true }));
    assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl], [10, 0]);
    assert.deepEqual(keysOf(C.compilePlan(run6(S6(), mk6({ mode, grp: 1 }), kd(3)).mem)), [18]);
  }
  assert.deepEqual(P(S6(), mk6({ sel: 2 }), kd(3)).cmds, [], 'the same selection: nothing sent');
});

test('7b §3.3 key, running, PATTERN PLAY: queues that pattern / chain — it starts when the current pattern ends (at \'bar\')', () => {
  let r = run6(play6(), mk6(), kd(3));
  assert.equal(r.mem.ui.sel, 2); assert.deepEqual(at(r), ['bar']);
  r = run6(r.state, r.mem, kd(4));
  assert.deepEqual([r.mem.ui.sel, r.mem.ui.cl, at(r)], [2, 1, ['bar']]);
  assert.deepEqual(keysOf(C.payload(r.mem, r.state, 'bar').plan), [2, 3]);
  assert.deepEqual(at(run6(S6({ run: true }), mk6({}, { sync: false }), kd(9))), ['bar'], 'free too');
});

test('7b §3.3 key, running, PATTERN WRITE: toggles the instrument (AC included) at step n of the pattern edited — in a chain the one heard; keys past its LAST STEP nothing; PATTERN PLAY ↔ WRITE live', () => {
  const D = pat6(mk6({ mode: 3, sel: 0, cl: 1, inst: 2 }), 0, {}, { l1: 12 });
  let r = run6(play6(), D, kd(5));
  assert.equal(r.mem.st[0][4], bit('sd')); assert.deepEqual(at(r), ['now']);
  r = run6(r.state, r.mem, ku(5), kd(5));
  assert.equal(r.mem.st[0][4], 0, 'again: off');
  r = run6(play6(), D, kd(13));
  assert.equal(r.mem, D); assert.deepEqual(r.cmds, [], 'past LAST STEP 12');
  assert.equal(run6(heard(play6(), D, { k: 1, m: 1, s: 3 }), D, kd(16)).mem.st[1][15], bit('sd'), 'the chain\'s second, heard');
  assert.equal(run6(play6(), mk6({ inst: 0 }, {}, D), kd(1)).mem.st[0][0], 1, 'AC');
  const w = run6(play6(), D, { k: 'mode', v: 2 });
  assert.deepEqual(at(w), ['bar']); assert.equal(C.compilePlan(w.mem).key, C.compilePlan(D).key, 'the swap finds the same plan: it runs on');
  assert.ok(run6(S6(), D, kd(5)).mem.st[0].every(m => m === 0), 'stopped: a selection, no step');
});

test('7b §3.3 FUNCTION + key, running, PATTERN WRITE: LAST STEP = n of the pattern edited (\'bar\' when it shortens it, else \'now\'); in a chain the one heard', () => {
  const D = mk6({ mode: 3, sel: 0, cl: 1 });
  let r = run6(play6(), D, FD, kd(7), ku(7), FU);
  assert.equal(r.mem.keys[0].l1, 7); assert.deepEqual(r.all.map(c => c.at), ['bar']);
  assert.deepEqual(arr(C.compilePlan(r.mem).mOff), [0, 7, 23]);
  assert.ok(!r.mem.st[0].some(m => m), 'no step toggled');
  r = run6(r.state, r.mem, FD, kd(12), FU);
  assert.deepEqual([r.mem.keys[0].l1, r.all.map(c => c.at)], [12, ['now']]);
  r = run6(heard(play6(), D, { k: 1, m: 1 }), D, FD, kd(4));
  assert.deepEqual([r.mem.keys[0].l1, r.mem.keys[1].l1], [16, 4]);
  assert.deepEqual(run6(play6(), D, FD, kd(16)).all, [], 'the same length: nothing');
  assert.equal(run6(S6(), D, FD, kd(7)).mem.keys[0].l1, 16, 'stopped: nothing');
});

test('7b §3.3 FUNCTION down, running, PATTERN WRITE: latches the SCALE switch into the pattern edited at the press (also when it starts a FUNCTION + key); stopped nothing; SCALE alone sets ui.sc only', () => {
  let D = mk6({ mode: 3, sel: 2 });
  let r = run6(S6(), D, { k: 'sc', v: 3 });
  assert.deepEqual([r.mem.ui.sc, r.cmds, r.mem.keys[2].sc], [3, [], 1]);
  D = r.mem;
  r = run6(play6(), D, FD);
  assert.deepEqual([r.mem.keys[2].sc, at(r)], [3, ['bar']]);
  assert.deepEqual(arr(C.compilePlan(r.mem).mPre), [1], 'SCALE 3: eighth triplets');
  assert.deepEqual(run6(play6(), D, FD, kd(12), ku(12), FU).mem.keys[2], { sc: 3, l1: 12 });
  assert.equal(run6(S6(), D, FD, FU).mem, D, 'stopped: nothing');
  assert.equal(run6(S6(), D, { k: 'sc', v: 3 }).mem, D, 'the same position: the same record');
});

test('7b §3.3 / §3.6 FUNCTION held: running PATTERN WRITE the beat markers at the pattern\'s scale; a track mode the bar number (hundreds and tens steady, the units flashing, a repeated digit alternating with the beat); stopped, FUNCTION + CLEAR the D.C. bar, FUNCTION + PATTERN GROUP the segno bar — nothing else (review #14)', () => {
  for (const [sc, want] of [[1, [1, 5, 9, 13]], [2, [1, 9]], [3, [1, 4, 7, 10, 13, 16]], [4, [1, 7, 13]]]) {
    const D = pat6(mk6({ mode: 3, sc }), 0, { bd: 'xxxxxxxxxxxxxxxx' }, { sc });
    assert.deepEqual(lit(C.leds(run6(play6(), D, FD).state, D)), want.map(k => [k, 1]), 'scale ' + sc);
  }
  const T = trk6(mk6({ mode: 1, inst: 0 }), 0, new Array(120).fill(1), { dc: 114, sg: 32 });
  let S = run6(heard(play6(), T, { k: 1, m: 114, s: 2, o: 480 }), T, FD).state;
  assert.deepEqual(lit(C.leds(S, T)), [[1, 1], [5, 2], [11, 1]], 'bar 115 heard: 100 (key 11), 1 steady, 5 flashing');
  S = run6(heard(play6(), T, { k: 1, m: 32, o: 480 }), T, FD).state;
  assert.deepEqual(lit(C.leds(S, T)), [[3, 1]], 'bar 33 on an even beat: the 3 steady');
  S = run6(heard(play6(), T, { k: 1, m: 32, o: 1200 }), T, FD).state;
  assert.deepEqual(lit(C.leds(S, T)), [[3, 2]], '…on an odd beat: flashing');
  assert.deepEqual(lit(C.leds(run6(S6({ bar: 9 }), T, FD).state, T)), [[1, 1], [10, 2]], 'stopped: the pointer, bar 10 (0 = key 10)');
  let r = run6(S6({ bar: 9 }), T, FD, CD);
  assert.deepEqual(lit(C.leds(r.state, r.mem)), [[1, 1], [5, 2], [11, 1]], 'FUNCTION + CLEAR: the D.C. bar, 115');
  assert.deepEqual([r.mem === T, r.all, r.state.bar], [true, [], 9], 'no BAR RESET');
  r = run6(S6({ bar: 9 }), T, FD, { k: 'grp' });
  assert.deepEqual(lit(C.leds(r.state, r.mem)), [[3, 2]], 'FUNCTION + PATTERN GROUP: the segno bar, 33 (stopped: no beat)');
  assert.deepEqual([r.mem === T, r.all], [true, []], 'no group toggle');
  const T8 = trk6(mk6({ mode: 1, inst: 7 }), 7, [0]);
  assert.deepEqual(lit(C.leds(run6(S6({ bar: 448 + 204 }), T8, FD).state, T8)), [[5, 2], [10, 1], [12, 1]], 'bar 205: 200 (key 12), 0 (key 10), 5');
  assert.deepEqual(lit(C.leds(S6({ bar: 448 + 204 }), T8)), [], 'FUNCTION up: a stopped track shows its bar\'s key (none here)');
});

test('7b §3.3 FUNCTION + keys, stopped, TRACK WRITE / PLAY: the bar keypad (1–9, 10 = 0, 11 = 100, 12 = 200; FUNCTION\'s release locates, clamped to the reach; 13–14 nothing); DEL / INS in TRACK WRITE, D.C. and segno following their bars, the undo notice', () => {
  const T = trk6(mk6({ mode: 0, inst: 0 }), 0, [0, 1, 2, 3, 4, 5], { dc: 5, sg: 3 });
  let r = run6(S6(), T, FD, kd(11), ku(11), kd(1), ku(1), kd(5), ku(5));
  assert.deepEqual(lit(C.leds(r.state, r.mem)), [[1, 1], [5, 2], [11, 1]], 'typing 115');
  assert.equal(r.state.bar, -1, 'not yet: at the release');
  r = run6(r.state, r.mem, FU);
  assert.deepEqual([r.state.bar, at(r)], [114, ['now']]);
  assert.equal(run6(S6(), T, FD, kd(12), kd(9), kd(9), FU).state.bar, 255, '299: clamped to the 256th bar');
  assert.equal(run6(S6(), T, FD, kd(10), FU).state.bar, 0, 'bar 0: the first');
  assert.equal(run6(S6(), mk6({ inst: 3 }, {}, T), FD, kd(2), kd(10), FU).state.bar, 192 + 19, 'track 4: from its region');
  const q = run6(S6({ bar: 3 }), T, FD, kd(13), kd(14), FU);
  assert.deepEqual([q.state.bar, q.all, q.mem === T], [3, [], true], '13 / 14: nothing');
  assert.equal(run6(S6(), mk6({ mode: 1 }, {}, T), FD, kd(4), FU).state.bar, 3, 'TRACK PLAY locates too');
  // DEL bar 3 (pointer 2): the rest shift left; the D.C. (bar 6 → 5) and the segno (bar 4 → 3) follow; undo
  r = run6(S6({ bar: 2 }), T, FD, kd(15));
  assert.deepEqual([r.mem.rt.slice(0, 7), r.mem.dc[0], r.mem.sg[0]], [[0, 1, 3, 4, 5, -1, -1], 4, 2]);
  assert.deepEqual(r.all, [{ c: 'send', at: 'now' }, { c: 'notice', text: 'Bar 3 deleted · tap to undo', undo: true }]);
  const u = run6(r.state, r.mem, FU, { k: 'undo' });
  assert.deepEqual([u.mem.rt.slice(0, 7), u.mem.dc[0], u.mem.sg[0]], [[0, 1, 2, 3, 4, 5, -1], 5, 3]);
  r = run6(S6({ bar: 5 }), T, FD, kd(15));
  assert.deepEqual([r.mem.rt.slice(0, 6), r.mem.dc[0], r.mem.sg[0]], [[0, 1, 2, 3, 4, -1], 4, 3], 'the D.C. bar deleted: the D.C. on the bar before');
  r = run6(S6({ bar: 3 }), T, FD, kd(15));
  assert.deepEqual([r.mem.rt.slice(0, 6), r.mem.dc[0], r.mem.sg[0]], [[0, 1, 2, 4, 5, -1], 4, 3], 'the segno bar deleted: the next bar takes its place');
  // INS bar 3: duplicated, the rest shift right (D.C. 6 → 7, segno 4 → 5)
  r = run6(S6({ bar: 2 }), T, FD, kd(16));
  assert.deepEqual([r.mem.rt.slice(0, 8), r.mem.dc[0], r.mem.sg[0]], [[0, 1, 2, 2, 3, 4, 5, -1], 6, 4]);
  assert.equal(r.all[1].text, 'Bar 3 duplicated · tap to undo');
  assert.deepEqual(run6(S6(), T, FD, kd(2), kd(15)).mem.rt.slice(0, 6), [0, 2, 3, 4, 5, -1], 'a locate typed, then DEL in one hold: that bar');
  // a full track (its region full; track 2 written with its D.C.): INS drops the last bar, track 2 untouched
  const full = C.normDrum({ ...clone(trk6(T, 0, Array.from({ length: 64 }, (_, j) => j & 15))), dc: [-1, 70, -1, -1, -1, -1, -1, -1], sg: new Array(8).fill(-1) }, 'tr606');
  r = run6(S6({ bar: 0 }), full, FD, kd(16));
  assert.deepEqual([r.mem.rt.slice(0, 3), r.mem.rt[63], r.mem.rt[64], r.mem.dc[1]], [[0, 0, 1], 14, -1, 70]);
  assert.equal(run6(S6({ bar: 2 }), mk6({ mode: 1 }, {}, T), FD, kd(15)).mem.rt[2], 2, 'TRACK PLAY: no DEL / INS');
  assert.deepEqual(run6(play6(), T, FD, kd(15), kd(3), FU).all, [], 'running: nothing');
  assert.deepEqual(run6(S6({ bar: 9 }), T, FD, kd(15)).all, [], 'past the track\'s end: nothing');
});

test('7b §3.3 CLEAR down + a held key, stopped, PATTERN WRITE: PATTERN CLEAR of that pattern (two held: both) — steps only, SCALE and LAST STEP kept; the group LED flashes once; the undo notice', () => {
  const D = pat6(pat6(mk6({ mode: 3, grp: 1 }), 18, { bd: 'x.x' }, { sc: 2, l1: 12 }), 19, { sd: 'x' });
  let r = run6(S6(), D, kd(3), CD);
  assert.ok(r.mem.st[18].every(m => !m)); assert.deepEqual(r.mem.keys[18], { sc: 2, l1: 12 }); assert.equal(r.mem.st[19][0], bit('sd'));
  assert.deepEqual(r.cmds, [{ c: 'send', at: 'now' }, { c: 'notice', text: 'Pattern II-3 cleared · tap to undo', undo: true }]);
  assert.deepEqual(C.leds(r.state, r.mem).grp, [0, 2], 'group II flashes');
  const L = run6(r.state, r.mem, CU, ku(3));
  assert.deepEqual(C.leds(L.state, L.mem).grp, [0, 2], 'the releases keep it');
  assert.deepEqual(C.leds(run6(L.state, L.mem, kd(9)).state, L.mem).grp, [0, 1], 'the next press ends it');
  assert.deepEqual(run6(L.state, L.mem, { k: 'undo' }).mem.st[18].slice(0, 3), [bit('bd'), 0, bit('bd')]);
  r = run6(S6(), D, kd(3), kd(4), CD);
  assert.ok(r.mem.st[18].every(m => !m) && r.mem.st[19].every(m => !m));
  assert.equal(r.cmds[1].text, 'Patterns II-3 and II-4 cleared · tap to undo');
  r = run6(S6(), D, CD, kd(4));
  assert.deepEqual([r.mem.st[19][0], r.mem.st[18][0]], [0, bit('bd')], 'CLEAR held first, then the key');
  assert.deepEqual(run6(S6(), D, CD).all, [], 'no key held: nothing');
  assert.equal(run6(S6(), mk6({ mode: 2 }, {}, D), kd(3), CD).mem.st[18][0], bit('bd'), 'PATTERN PLAY: no PATTERN CLEAR');
});

test('7b §3.3 CLEAR held, running, PATTERN WRITE: the wipe — the instrument\'s step goes at each step heard while CLEAR is held', () => {
  const D = pat6(mk6({ mode: 3, inst: 2 }), 0, { sd: 'x...x...x...x...', bd: 'x...x' });
  let r = run6(play6(), D, CD);
  assert.deepEqual([r.state.wipe, r.cmds], [true, []]);
  const post = (q, s) => P(q.state, q.mem, { k: 'heard', post: { s, m: 0, k: 0, v: 0, p: 0, o: s * 240, M: 0, f: 0 } });
  r = post(r, 4);
  assert.deepEqual([r.mem.st[0][4], at(r)], [bit('bd'), ['now']], 'SD goes, BD stays');
  r = post(r, 5); assert.deepEqual(r.cmds, []);
  r = post(r, 8); assert.equal(r.mem.st[0][8], 0);
  r = P(r.state, r.mem, CU); assert.equal(r.state.wipe, false);
  r = post(r, 12); assert.equal(r.mem.st[0][12], bit('sd'), 'released: kept');
  assert.equal(r.mem.st[0][0], bit('sd') | bit('bd'), 'a step not heard while held: kept');
  assert.equal(run6(S6(), D, CD).state.wipe, false, 'stopped: no wipe');
});

test('7b §3.3 CLEAR, stopped, TRACK WRITE / PLAY: BAR RESET — the pointer to the track\'s first bar', () => {
  for (const mode of [0, 1]) {
    const r = run6(S6({ bar: 130, twSel: { sel: 3, cl: 0 } }), trk6(mk6({ mode, inst: 2 }), 2, [1, 2, 3]), CD);
    assert.deepEqual([r.state.bar, r.state.twSel, at(r)], [128, null, ['now']]);
  }
});

test('7b §3.3 CLEAR, running, TRACK WRITE: arms D.C. — the next TAP writes the pattern heard as the D.C. bar, an older D.C. replaced', () => {
  const T = trk6(mk6({ mode: 0, inst: 0 }), 0, [], { dc: 30 });
  let r = run6(play6(), T, kd(2), ku(2), CD, CU);
  assert.deepEqual([r.state.dcArm, r.mem.dc[0]], [true, 30]);
  r = run6(r.state, r.mem, { k: 'tap', f: 0.1 });
  assert.deepEqual([r.mem.rt[0], r.mem.dc[0], r.state.dcArm, r.state.bar], [1, 0, false, 1]);
  assert.deepEqual(keysOf(C.compilePlan(mk6({ mode: 1 }, {}, r.mem))), [1], 'TRACK PLAY: the track ends at its D.C.');
});

test('7b §3.3 CLEAR, running, TRACK PLAY / PATTERN PLAY: nothing', () => {
  for (const D of [trk6(mk6({ mode: 1 }), 1, [1]), mk6()]) {
    const r = run6(play6({ bar: 65 }), D, CD, CU);
    assert.deepEqual([r.mem === D, r.all, r.state.bar, r.state.dcArm, r.state.wipe], [true, [], 65, false, false]);
  }
});

test('7b §3.3 TAP, running, PATTERN WRITE: the instrument (AC included) at the nearest step of the pattern heard (7a\'s TR-08 rule); stepLen gives the host its fraction', () => {
  const D = mk6({ mode: 3, sel: 0, cl: 1, inst: 7 });
  const S = heard(play6(), D, { k: 0, m: 0, s: 6 });
  let r = P(S, D, { k: 'tap', f: 0.3 });
  assert.deepEqual([r.mem.st[0][6], at(r)], [bit('ch'), ['now']]);
  assert.equal(P(S, D, { k: 'tap', f: 0.7 }).mem.st[0][7], bit('ch'), 'past half the step: the next');
  r = P(heard(play6(), D, { k: 0, m: 0, s: 15 }), D, { k: 'tap', f: 0.8 });
  assert.equal(r.mem.st[1][0], bit('ch'), 'the last step\'s next: the chain\'s next pattern, step 1');
  assert.equal(P(heard(play6(), mk6({ inst: 0 }, {}, D), { k: 0, m: 0, s: 2 }), mk6({ inst: 0 }, {}, D), { k: 'tap', f: 0 }).mem.st[0][2], 1, 'AC');
  assert.deepEqual(P(S6(), D, { k: 'tap', f: 0 }).cmds, []); assert.deepEqual(P(play6(), D, { k: 'tap', f: 0 }).cmds, [], 'nothing heard');
  const W = mk6({}, { swing: 62 }, D);
  assert.deepEqual([0, 1, 14, 15].map(s => C.stepLen(W, { k: 0, s })), [298, 182, 298, 182]);
  assert.equal(C.stepLen(pat6(W, 0, {}, { sc: 3 }), { k: 0, s: 3 }), 320, 'triplets unswung');
  assert.equal(C.stepLen(pat6(W, 0, {}, { l1: 15 }), { k: 0, s: 14 }), 240, 'LAST STEP 15: the last (even) step to the bar');
  assert.equal(C.stepLen(pat6(W, 0, {}, { sc: 2 }), { k: 0, s: 0 }), 149, '32nds: 120 + 29');
  assert.equal(C.stepLen(W, { k: -1, s: 3 }), 182, 'a silent bar: sixteenths');
});

test('7b §3.3 TAP, running, PATTERN PLAY: STEP RESET — the payload\'s rst counter + 1 (DrSeq restarts the pattern at its next even step); stopped nothing', () => {
  const D = mk6({ sel: 0, cl: 1 });
  let r = P(play6(), D, { k: 'tap', f: 0.4 });
  assert.deepEqual([r.state.rst, r.mem === D, at(r)], [1, true, ['now']]);
  const a = C.payload(D, play6()), b = C.payload(D, r.state);
  assert.deepEqual([a.rst, b.rst, a.plan.key === b.plan.key, a.pk === b.pk], [0, 1, true, false], 'drumSend sends it (review #3)');
  assert.equal(P(r.state, D, { k: 'tap' }).state.rst, 2);
  assert.deepEqual(P(S6(), D, { k: 'tap' }).cmds, []);
  assert.equal(P(S6({ run: true }), mk6({}, { sync: false }, D), { k: 'tap' }).state.rst, 1, 'free too');
  // review 2 #3 (the lead's decision): the press's heard frame F rides with the counter (rstF; none / hostile → −1), not in pk
  r = P(play6(), D, { k: 'tap', f: 0.4, F: 96000 });
  const c = C.payload(D, r.state), d = C.payload(D, { ...r.state, rstF: 12 });
  assert.deepEqual([r.state.rstF, c.rst, c.rstF, c.pk === d.pk], [96000, 1, 96000, true]);
  for (const F of [undefined, NaN, 'x', Infinity]) assert.equal(P(play6(), D, { k: 'tap', F }).state.rstF, -1, String(F));
  assert.equal(C.payload(D, play6()).rstF, -1);
  assert.equal('rstF' in C.payload(DEF, { ...C.initState(), play: true, rstF: 5 }), false, 'never on the 808\'s');
});

test('7b review 1 #4 (the lead\'s decision): withTempo(D, bpm) — the machine\'s own TEMPO (the 808: TEMPO + FINE) showing the project tempo for "→ Piano roll"; the same record when it already does; clamped to 40–300; the payload\'s bpm follows', () => {
  const a = C.withTempo(D6, 100);
  assert.deepEqual([a.ui.tempo, a.m, C.payload(a, S6()).bpm, a.x === D6.x, a.st === D6.st], [100, 'tr606', 100, true, true]);
  assert.equal(C.withTempo(D6, 120), D6, 'already 120: the same record');
  assert.deepEqual([C.withTempo(D6, 20).ui.tempo, C.withTempo(D6, 400).ui.tempo, C.withTempo(D6, 97.456).ui.tempo, C.withTempo(D6, NaN)], [40, 300, 97.46, D6]);
  for (const b of [100, 97.5, 133.33, 40, 300, 61.25]) {
    const e = C.withTempo(DEF, b), k = C.bpmTempo(b);
    assert.deepEqual([e.ui.tempo, e.ui.fine, 'm' in e], [k.tempo, k.fine, false], String(b));
    assert.ok(Math.abs(C.payload(e, C.initState()).bpm - b) < 0.01, b + ' → ' + C.payload(e, C.initState()).bpm);
  }
  assert.equal(C.withTempo(DEF, 120), DEF, 'the 808 at 120: the same record');
  assert.deepEqual(C.normDrum(clone(C.withTempo(DEF, 100))), C.withTempo(DEF, 100), 'a normal record');
});

test('7b review 1 #5: REC with the AC pad held — a pad hit at v 1 writes its sound and AC at the nearest step; below 1 its sound only; the 808\'s REC unchanged', () => {
  const W = mk6({ mode: 3, sel: 0 }, { rec: true }), S = heard(play6(), W, { k: 0, s: 4 });
  let r = P(S, W, { k: 'pad', sound: 1, f: 0.1, v: 1 });
  assert.deepEqual([r.mem.st[0][4], r.cmds], [bit('sd') | bit('ac'), [{ c: 'send', at: 'now' }]]);
  r = P(S, W, { k: 'pad', sound: 1, f: 0.1, v: 0.99 });
  assert.equal(r.mem.st[0][4], bit('sd'));
  r = P(S, W, { k: 'pad', sound: 0, f: 0.1 });
  assert.equal(r.mem.st[0][4], bit('bd'), 'no velocity: its sound only');
  assert.deepEqual(P(S, mk6({}, { rec: false }, W), { k: 'pad', sound: 0, f: 0, v: 1 }).cmds, [], 'REC off: nothing');
  const W8 = mk({ mode: C.M_W1 }, { rec: true });
  const S8 = { ...C.initState(), play: true, pos: { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, f: 0 } };
  assert.equal(P(S8, W8, { k: 'pad', sound: 1, f: 0.1, v: 1 }).mem.st[0][3], bit('sd'), 'the 808: its sound only (as 7a)');
});

test('7b §3.3 TAP, running, TRACK WRITE: the key (or chain: a bar each) heard, written into the track from `bar`, which advances; the track\'s group its own; segno armed (PATTERN GROUP): `bar` marked instead; into a later track\'s region (that track ends: D.C. / segno go); the reach bounds it', () => {
  const T = trk6(mk6({ mode: 0, inst: 0 }), 0, [], { tg: 1 });
  let r = run6(play6(), T, kd(3), ku(3));
  assert.deepEqual([r.state.twSel, r.all.map(c => c.at), r.mem.rt[0]], [{ sel: 2, cl: 0 }, ['bar'], -1], 'heard from the next bar, not yet written');
  r = run6(r.state, r.mem, { k: 'tap' }, { k: 'tap' });
  assert.deepEqual([r.mem.rt.slice(0, 3), r.state.bar, r.all.map(c => c.at)], [[2, 2, -1], 2, ['bar', 'bar']]);
  r = run6(r.state, r.mem, kd(5), kd(6), ku(5), ku(6), { k: 'grp' }, { k: 'tap' });
  assert.deepEqual([r.mem.sg[0], r.state.bar, r.mem.rt[2], r.state.sgArm], [2, 2, -1, false], 'the segno marked, nothing written');
  r = run6(r.state, r.mem, { k: 'tap' });
  assert.deepEqual([r.mem.rt.slice(0, 5), r.state.bar], [[2, 2, 4, 5, -1], 4], 'a chain: a bar each');
  assert.deepEqual(keysOf(C.compilePlan(mk6({ mode: 1 }, {}, r.mem))), [18, 18, 20, 21], 'group II');
  assert.deepEqual(lit(C.leds(heard(r.state, r.mem, { k: 20, m: 0 }), r.mem)), [[5, 1], [6, 2]], 'LEDs: the key heard steady, the chain to write flashing');
  const own = run6(play6({ bar: 1 }), r.mem, { k: 'tap' });
  assert.deepEqual([own.mem.rt[1], own.state.bar], [2, 2], 'no key pressed: the bar\'s own pattern kept, the pointer on');
  assert.deepEqual(run6(play6({ bar: 9 }), r.mem, { k: 'tap' }).all, [], 'nothing heard: nothing');
  const two = C.normDrum({ ...clone(T), dc: [-1, 80, -1, -1, -1, -1, -1, -1], sg: [-1, 70, -1, -1, -1, -1, -1, -1] }, 'tr606');
  r = run6(play6({ bar: 63 }), two, kd(1), kd(2), { k: 'tap' });
  assert.deepEqual([r.mem.rt[63], r.mem.rt[64], r.mem.dc[1], r.mem.sg[1], r.state.bar], [0, 1, -1, -1, 65], 'automatic track selection: track 2 ends');
  r = run6(play6({ bar: 703 }), mk6({ inst: 7 }, {}, T), kd(1), kd(2), { k: 'tap' });
  assert.deepEqual([r.mem.rt[703], r.state.bar], [0, 704], 'track 8: the store\'s end');
  assert.deepEqual(run6(r.state, r.mem, { k: 'tap' }).all, [], 'full: nothing');
  r = run6(play6({ bar: 639 }), mk6({ inst: 6 }, {}, T), kd(1), kd(2), { k: 'tap' });
  assert.deepEqual([r.mem.rt[639], r.mem.rt[640], r.state.bar], [0, -1, 640], 'track 7: 256 bars');
});

test('7b §3.3 TAP, stopped, TRACK WRITE: the next bar (stepping through the track to check: its key flashing)', () => {
  const T = trk6(mk6({ mode: 0, inst: 1 }), 1, [4, 7]);
  const r = run6(S6(), T, { k: 'tap' });
  assert.deepEqual([r.state.bar, at(r)], [65, ['now']]);
  assert.deepEqual([lit(C.leds(r.state, r.mem)), lit(C.leds(S6(), T))], [[[8, 2]], [[5, 2]]]);
  assert.deepEqual(keysOf(C.compilePlan(T, T.ui, T.x, r.state)), [7]);
  assert.deepEqual(run6(S6({ bar: 64 + 255 }), T, { k: 'tap' }).all, [], 'the reach\'s last bar');
  assert.deepEqual(run6(S6(), mk6({ mode: 1 }, {}, T), { k: 'tap' }).all, [], 'TRACK PLAY stopped: nothing');
});

test('7b §3.3 TAP, running, TRACK PLAY: D.S. — from the next bar the track continues at its segno (the rotated cycle, at \'bar\'), again on each TAP; no segno nothing; a stop / start / seek of the song or the machine: the plain track again (sent)', () => {
  const T = trk6(mk6({ mode: 1, inst: 0 }), 0, [0, 1, 2, 3], { sg: 2 });
  let r = run6(play6(), T, { k: 'tap' });
  assert.deepEqual([r.state.ds, at(r)], [1, ['bar']]);
  const p1 = C.payload(T, r.state, 'bar').plan;
  assert.deepEqual([keysOf(p1), p1.loopFrom], [[2, 3, 0, 1], 0]);
  r = run6(r.state, T, { k: 'tap' });
  assert.notEqual(C.payload(T, r.state, 'bar').plan.key, p1.key, 'a second D.S.: a new key, DrSeq swaps again');
  assert.deepEqual(run6(play6(), trk6(T, 0, [], { sg: -1 }), { k: 'tap' }).all, []);
  r = run6(r.state, T, { k: 'transport', play: false });
  assert.deepEqual([r.state.ds, at(r)], [0, ['now']]);
  assert.equal(C.payload(T, r.state).plan.key, C.compilePlan(T).key);
  assert.deepEqual(run6(play6({ ds: 1 }), T, { k: 'transport', play: true }).all.map(c => c.at), ['now'], 'a seek / start');
  assert.deepEqual(run6(play6(), T, { k: 'transport', play: true }).all, [], 'nothing to end: nothing sent');
  assert.equal(run6(S6({ run: true }), mk6({}, { sync: false }, T), { k: 'tap' }, { k: 'start' }).state.ds, 0, 'free: STOP ends it');
});

test('7b §3.3 PATTERN GROUP: stopped toggles the group (pattern modes the panel\'s, TRACK WRITE the track\'s); running TRACK WRITE arms the segno; running otherwise, TRACK PLAY stopped: nothing', () => {
  let r = run6(S6(), mk6({ sel: 3 }), { k: 'grp' });
  assert.deepEqual([r.mem.ui.grp, at(r), keysOf(C.compilePlan(r.mem)), C.leds(r.state, r.mem).grp], [1, ['now'], [19], [0, 1]]);
  assert.equal(run6(r.state, r.mem, { k: 'grp' }).mem.ui.grp, 0);
  const T = mk6({ mode: 0, inst: 4 });
  r = run6(S6(), T, { k: 'grp' });
  assert.deepEqual([r.mem.tg[4], r.mem.ui.grp, C.leds(r.state, r.mem).grp], [1, 0, [0, 1]], 'a track mode shows its track\'s group');
  assert.deepEqual(run6(S6(), mk6({ mode: 1 }, {}, T), { k: 'grp' }).all, []);
  for (const mode of [1, 2, 3]) assert.deepEqual(run6(play6(), mk6({ mode }, {}, T), { k: 'grp' }).all, []);
  assert.equal(run6(play6(), T, { k: 'grp' }).state.sgArm, true);
});

test('7b §3.3 MODE: the rules change at once, the plan at the next measure (\'bar\'; stopped \'now\'); PATTERN PLAY ↔ WRITE the same plan; the heard key, the D.S. and the arms end', () => {
  const D = trk6(mk6({ sel: 1 }), 1, [5]);
  let r = run6(play6(), D, { k: 'mode', v: 3 });
  assert.deepEqual([r.mem.ui.mode, at(r)], [3, ['bar']]); assert.equal(C.compilePlan(r.mem).key, C.compilePlan(D).key);
  assert.deepEqual(at(run6(S6(), D, { k: 'mode', v: 0 })), ['now']);
  assert.deepEqual(run6(play6(), D, { k: 'mode', v: 2 }).all, [], 'the same mode: nothing');
  r = run6(play6({ twSel: { sel: 1, cl: 0 }, ds: 2, dcArm: true, sgArm: true }), mk6({ mode: 0 }, {}, D), { k: 'mode', v: 1 });
  assert.deepEqual([r.state.twSel, r.state.ds, r.state.dcArm, r.state.sgArm], [null, 0, false, false]);
  assert.equal(run6(S6(), D, { k: 'mode', v: 9 }).mem.ui.mode, 3, 'clamped');
});

test('7b §3.3 INSTRUMENT / TRACK: pattern modes the instrument written (no plan change); track modes the track, from its first bar — running in TRACK PLAY at the next bar', () => {
  let r = run6(play6(), mk6({ mode: 3 }), { k: 'inst', v: 5 });
  assert.deepEqual([r.mem.ui.inst, r.cmds], [5, []]);
  assert.equal(run6(r.state, r.mem, kd(1)).mem.st[0][0], bit('cy'));
  const D = trk6(trk6(mk6({ mode: 1, inst: 0 }), 0, [1]), 3, [2, 3]);
  r = run6(play6({ bar: 3 }), D, { k: 'inst', v: 3 });
  assert.deepEqual([r.mem.ui.inst, r.state.bar, at(r)], [3, 192, ['bar']]);
  assert.deepEqual(keysOf(C.payload(r.mem, r.state, 'bar').plan), [2, 3]);
  assert.deepEqual(at(run6(S6(), D, { k: 'inst', v: 3 })), ['now']);
  assert.deepEqual(run6(S6(), D, { k: 'inst', v: 0 }).all, []);
});

test('7b §3.3 TEMPO: BPM 40–300, continuous (0.01) on the knob\'s log law tempo606(u) = 40 · 7.5^u; free the machine\'s (the payload\'s bpm), synced the project\'s (a bpm command, the record unchanged)', () => {
  assert.deepEqual([C.tempo606(0), C.tempo606(1), C.tempo606(0.5), C.tempo606(-1), C.tempo606(2), C.tempo606(NaN)], [40, 300, 109.54, 40, 300, 120]);
  for (const b of [40, 57.31, 97, 120, 137.5, 300]) assert.ok(Math.abs(C.tempo606(C.tempo606Pos(b)) - b) < 0.006, String(b));
  for (let u = 0; u < 0.99; u += 0.01) assert.ok(C.tempo606(u + 0.01) > C.tempo606(u), 'monotone');
  const F = mk6({}, { sync: false });
  let r = run6(S6(), F, { k: 'tempo', v: 137.456 });
  assert.deepEqual([r.mem.ui.tempo, at(r), C.payload(r.mem, r.state).bpm, C.freeBpm(r.mem), C.freeBpm(DEF)], [137.46, ['now'], 137.46, 137.46, 120]);
  assert.equal(run6(S6(), F, { k: 'tempo', v: 400 }).mem.ui.tempo, 300);
  assert.deepEqual(run6(S6(), F, { k: 'tempo', v: 'x' }).all, []);
  r = run6(S6(), D6, { k: 'tempo', v: 97.5 });
  assert.deepEqual([r.mem === D6, r.cmds], [true, [{ c: 'bpm', v: 97.5 }]]);
});

test('7b §3.3 extras: SYNC (a free run ends), SWING, mute / solo on its lanes only, REC pads (its sounds), the grid (its rows, 16 steps), MAP… / reset / SOUNDS… (its seven), DEMO (ours, chained, the undo), SYNC 303s', () => {
  let r = run6(S6({ run: true }), mk6({}, { sync: false }), { k: 'sync', v: true });
  assert.deepEqual([r.mem.x.sync, r.state.run, at(r)], [true, false, ['now']]);
  r = run6(S6(), D6, { k: 'swing', v: 62.4 }); assert.deepEqual([r.mem.x.swing, C.payload(r.mem, r.state).swing], [62, 62]);
  r = run6(play6(), D6, { k: 'mute', lane: 9 }, { k: 'solo', lane: 1 });
  assert.deepEqual([r.mem.x.mute, r.mem.x.solo], [bit('cy'), bit('bd')]);
  for (const lane of [4, 6, 7, 8, 12, -1]) assert.deepEqual(run6(play6(), D6, { k: 'mute', lane }).all, [], 'not its lane: ' + lane);
  const W = mk6({ mode: 3, sel: 0 }, { rec: true }), S = heard(play6(), W, { k: 0, s: 4 });
  assert.equal(P(S, W, { k: 'pad', sound: 4, f: 0.1 }).mem.st[0][4], bit('ht'));
  assert.deepEqual(P(S, W, { k: 'pad', sound: 3, f: 0.1 }).cmds, [], 'MT: not the 606\'s');
  assert.deepEqual(P(S, mk6({}, { rec: false }, W), { k: 'pad', sound: 0, f: 0 }).cmds, []);
  r = run6(S6(), mk6({ sel: 5, grp: 1 }), { k: 'grid', lane: 11, s: 15 });
  assert.deepEqual([r.mem.st[21][15], at(r)], [bit('ch'), ['now']]);
  assert.deepEqual(run6(S6(), D6, { k: 'grid', lane: 4, s: 0 }).all, [], 'MT: no row');
  assert.deepEqual(run6(S6(), D6, { k: 'grid', lane: 1, s: 16 }).all, [], '16 steps');
  assert.equal(C.gridPat(heard(play6(), D6, { k: 7 }), D6), 7);
  assert.equal(C.gridPat(S6({ bar: 65 }), trk6(mk6({ mode: 0, inst: 1 }), 1, [-1, 9], { tg: 1 })), 25);
  assert.equal(C.gridPat(heard(play6(), mk6({ mode: 3, sel: 2, cl: 1 }), { k: 3 }), mk6({ mode: 3, sel: 2, cl: 1 })), 3);
  r = run6(S6(), D6, { k: 'map', sound: 'oh', notes: [42, 46] });
  assert.deepEqual([r.mem.map.oh, r.mem.map.ch], [[42, 46], [44]]);
  assert.deepEqual(run6(S6(), D6, { k: 'map', sound: 'cb', notes: [56] }).all, []);
  assert.deepEqual(run6(S6(), r.mem, { k: 'mapReset' }).mem.map, D6.map);
  r = run6(S6(), D6, { k: 'smp', sound: 'cy', slot: { id: 'smp:00000000000000c1', name: 'Ride', on: true } });
  assert.deepEqual(r.mem.smp, { cy: { id: 'smp:00000000000000c1', name: 'Ride', on: true } });
  assert.deepEqual(C.payload(r.mem, S6()).smp[8], { id: 'smp:00000000000000c1', on: true }, 'its slot by sound id (8)');
  assert.deepEqual(run6(S6(), D6, { k: 'smp', sound: 'cp', slot: { id: 'smp:00000000000000c1', name: 'x', on: true } }).all, []);
  assert.equal(C.demoFree(D6), true);
  r = run6(S6(), mk6({ mode: 0, inst: 3 }), { k: 'demo' });
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.grp, r.mem.ui.sel, r.mem.ui.cl, keysOf(C.compilePlan(r.mem)), C.demoFree(r.mem)], [2, 0, 0, 1, [0, 1], false]);
  assert.deepEqual(r.cmds[1], { c: 'notice', text: 'Demo loaded into patterns I-1 and I-2 · tap to undo', undo: true });
  assert.ok(r.mem.st[1].some(m => m & bit('lt')) && r.mem.st[1].some(m => m & bit('ht')), 'the toms in I-2');
  assert.ok([...C.DEMO606.a, ...C.DEMO606.b].every(m => (m & ~0xE2F) === 0) && C.DEMO606.a.length === 16, 'its lanes, 16 steps');
  const u = run6(r.state, r.mem, { k: 'undo' });
  assert.deepEqual([C.demoFree(u.mem), u.mem.ui.mode, u.mem.ui.inst], [true, 0, 3]);
  assert.deepEqual(run6(S6(), mk6({}, { swing: 58 }), { k: 'link303' }).cmds, [{ c: 'link303', s: 32 }]);
});

test('7b SYNC 303s (§3.8): swing303(P) = 4 · (P − 50), whole, clamped at the TB-303\'s 50 (62.5 %)', () => {
  assert.deepEqual([50, 51, 55, 58, 62, 62.4, 63, 75, 40, NaN].map(C.swing303), [0, 4, 20, 32, 48, 48, 50, 50, 0, 0]);
  for (let P = 50; P <= 62; P++) assert.ok(Math.abs(1.2 * C.swing303(P) - (2 * P - 100) * 240 / 100) < 1e-9, 'equal before rounding: ' + P);
});

test('7b §3.3 not covered: nothing (keys in TRACK PLAY without FUNCTION, keys stopped in TRACK WRITE, TAP stopped elsewhere, FUNCTION alone, ups, junk); release lets every hold go and does nothing; FUNCTION held wins (review #14)', () => {
  const T = trk6(mk6({ mode: 1 }), 1, [1]);
  const cases = [[play6(), T, kd(3)], [S6(), T, kd(3)], [S6(), mk6({ mode: 0 }, {}, T), kd(3)], [S6(), D6, { k: 'tap' }], [S6(), mk6({ mode: 3 }), { k: 'tap' }],
    [S6(), T, { k: 'tap' }], [S6(), D6, FD], [play6(), D6, { k: 'nope' }], [play6(), D6, null], [play6(), D6, kd(17)], [play6(), D6, kd(0)],
    [S6(), D6, ku(4)], [S6(), D6, FU], [S6(), D6, CU], [S6(), D6, { k: 'sc', v: 1 }], [S6(), D6, { k: 'release' }]];
  for (const [S, D, i] of cases) { const r = P(S, D, i); assert.equal(r.mem, D, JSON.stringify(i)); assert.deepEqual(r.cmds, [], JSON.stringify(i)); }
  const r = run6(S6(), mk6({ mode: 0 }, {}, T), kd(3), FD, kd(5), { k: 'release' });
  assert.deepEqual([r.state.held, r.state.fn, r.state.clr, r.state.loc, r.state.bar, r.all], [[], false, false, null, -1, []], 'a cancelled hold: no locate');
  const q = run6(S6({ bar: 66 }), mk6({ mode: 0 }, {}, T), FD, CD, { k: 'grp' }, CU, FU);
  assert.deepEqual([q.state.bar, q.mem.tg[1], q.all], [66, 0, []]);
});

test('7b §3.6 LEDs: stopped the selection (first flashing, a chain steady); running PATTERN PLAY / TRACK PLAY the chase; PATTERN WRITE the instrument\'s steps with the playhead inverted (codes 3 / 4); TRACK WRITE the key heard; the group LEDs and the RUN LED', () => {
  const D = pat6(mk6({ sel: 4, cl: 2 }), 5, { sd: 'x...x' }, { l1: 12 });
  assert.deepEqual(lit(C.leds(S6(), D)), [[5, 2], [6, 1], [7, 1]]);
  assert.deepEqual([C.leds(S6(), D).run, C.leds(S6(), D).grp], [0, [1, 0]]);
  const S = heard(play6(), D, { k: 5, m: 1, s: 6 });
  assert.deepEqual([lit(C.leds(S, D)), C.leds(S, D).run], [[[7, 1]], 1], 'the chase');
  const W = mk6({ mode: 3, inst: 2 }, {}, D);
  assert.deepEqual(lit(C.leds(heard(play6(), W, { k: 5, m: 1, s: 4 }), W)), [[1, 1], [5, 4]], 'SD on 1 and 5, the playhead on 5 (set: dark)');
  assert.deepEqual(lit(C.leds(heard(play6(), W, { k: 5, m: 1, s: 2 }), W)), [[1, 1], [3, 3], [5, 1]], 'the playhead on 3 (unset: lit)');
  assert.deepEqual(lit(C.leds(heard(play6(), W, { k: 4, m: 0, s: 2 }), W)), [[3, 3]], 'the chain\'s first heard: its steps (none)');
  const T = trk6(mk6({ mode: 0, inst: 0 }), 0, [6]);
  assert.deepEqual(lit(C.leds(heard(play6({ twSel: { sel: 8, cl: 1 } }), T, { k: 6, m: 0, s: 0 }), T)), [[7, 1], [9, 2], [10, 2]]);
  const TP = mk6({ mode: 1 }, {}, T);
  assert.deepEqual(lit(C.leds(heard(play6(), TP, { k: 6, m: 0, s: 9 }), TP)), [[10, 1]], 'TRACK PLAY: the chase');
});

test('7b property: compilePlan for random 606 records in every mode — the measures by the rules, offsets / ticks by SCALE and LAST STEP, steps & audible, ≤ 512 measures, a plan DrSeq accepts; deterministic', () => {
  const r = rng(17);
  for (let round = 0; round < 80; round++) {
    const d = clone(D6);
    for (let p = 0; p < 32; p++) { d.keys[p] = { sc: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16) }; for (let s = 0; s < 16; s++) d.st[p][s] = r() < 0.4 ? Math.floor(r() * 4096) : 0; }
    for (let t = 0; t < 8; t++) {
      const n = Math.floor(r() * 90);
      for (let j = 0; j < n; j++) d.rt[T6(t) + j] = r() < 0.1 ? -1 : Math.floor(r() * 16);
      d.tg[t] = r() < 0.5 ? 1 : 0; d.dc[t] = r() < 0.3 ? T6(t) + Math.floor(r() * 80) : -1; d.sg[t] = r() < 0.3 ? T6(t) + Math.floor(r() * 40) : -1;
    }
    const sel = Math.floor(r() * 16);
    d.ui = { ...d.ui, mode: round % 4, inst: Math.floor(r() * 8), grp: Math.floor(r() * 2), sel, cl: Math.floor(r() * (4 - (sel & 3))) };
    d.x = { ...d.x, sync: r() < 0.5, mute: Math.floor(r() * 4096), solo: r() < 0.2 ? Math.floor(r() * 4096) : 0 };
    const D = C.normDrum(d, 'tr606'), t = D.ui.inst, A = C.audible(D.x);
    const S = S6({ bar: T6(t) + Math.floor(r() * 30), ds: r() < 0.3 ? 1 : 0, twSel: r() < 0.5 ? { sel: 4, cl: 1 } : null });
    const p = C.compilePlan(D, D.ui, D.x, S);
    assert.ok(DRSEQ.valid(p), 'round ' + round); assert.equal(p.fill, null); assert.ok(p.n <= 512 && p.st.length <= 8192);
    for (let i = 0; i < p.n; i++) {
      const k = p.mKey[i], K = k < 0 ? C.CLEARED6 : D.keys[k];
      assert.equal(p.mOff[i + 1] - p.mOff[i], K.l1); assert.equal(p.mT[i + 1] - p.mT[i], K.l1 * C.STEP_T[C.SC_CODE[K.sc]]);
      assert.deepEqual([p.mPre[i], p.mL1[i], p.mVar[i]], [C.SC_CODE[K.sc], K.l1, 0]);
      for (let s = 0; s < K.l1; s++) assert.equal(p.st[p.mOff[i] + s], k < 0 ? 0 : D.st[k][s] & A);
    }
    if (D.ui.mode >= 2) assert.deepEqual(keysOf(p), Array.from({ length: D.ui.cl + 1 }, (_, j) => D.ui.grp * 16 + D.ui.sel + j));
    if (D.ui.mode === 1) {
      const T = C.track606(D, t), len = T.end < 0 ? 0 : T.end - T.start + 1;
      assert.ok(p.n === len || p.n === len + p.loopFrom, 'round ' + round);
      for (let i = p.loopFrom; i < p.n; i++) assert.ok(p.mKey[i] < 0 || (p.mKey[i] >> 4) === D.tg[t], 'the track\'s group');
    }
    const q = C.compilePlan(C.normDrum(clone(D)), D.ui, D.x, clone(S));
    assert.equal(q.key, p.key); assert.equal(q.shape, p.shape);
  }
});

test('7b property: toNotes of a 606 plan (→ Piano roll, §4) — exactly its hits at the sequencer\'s whole-tick swung positions (every SCALE), each at the 606\'s primary, mapped back through its map', () => {
  const r = rng(23);
  for (let round = 0; round < 40; round++) {
    const d = clone(D6);
    for (let p = 0; p < 32; p++) { d.keys[p] = { sc: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16) }; for (let s = 0; s < 16; s++) d.st[p][s] = r() < 0.5 ? Math.floor(r() * 4096) : 0; }
    const sel = Math.floor(r() * 16);
    d.ui = { ...d.ui, mode: 2, grp: Math.floor(r() * 2), sel, cl: Math.floor(r() * (4 - (sel & 3))) };
    if (round & 1) d.map = { ...C.MAP606, ht: [47, 48], lt: [41, 45] };
    const D = C.normDrum(d, 'tr606'), pl = C.compilePlan(D), pct = 50 + Math.floor(r() * 26), prim = C.primaries(D.map, 'tr606'), tab = C.mapTable(D.map, 'tr606');
    const t0 = Math.floor(r() * 20000), t1 = t0 + Math.floor(r() * 30000);
    const got = C.toNotes(pl, { t0, t1, swing: pct, prim }).map(x => [x.t, tab[x.n], x.v]);
    const want = [];
    let m = 0, start = 0;
    while (start < t1) {
      const c = pl.mPre[m], T = C.STEP_T[c], w = C.SWUNG[c] ? C.swingTicks(pct, T) : 0;
      for (let s = 0; s < pl.mOff[m + 1] - pl.mOff[m]; s++) {
        const t = start + s * T + (s & 1 ? w : 0), mask = pl.st[pl.mOff[m] + s];
        if (t < t0 || t >= t1) continue;
        for (const l of C.LANES606.slice(1)) if (mask & (1 << l)) want.push([t, C.LANE_SOUND[l][0], mask & 1 ? 127 : 100]);
      }
      start += pl.mT[m + 1] - pl.mT[m]; m = m + 1 < pl.n ? m + 1 : pl.loopFrom;
    }
    want.sort((a, b) => a[0] - b[0] || prim[a[1]] - prim[b[1]]);
    assert.deepEqual(got, want, 'round ' + round);
    assert.ok(got.every(e => C.SIDS606.includes(e[1])));
  }
});
