// Tests of drum-core.js (lane S; IMPL-7a §12.3): normDrum (§6), the panel's state machine press — one test per row of the
// §3.3 table and per input of its "not covered" list —, compilePlan (§3.4: every mode × variation × fill × pre-scale × parts,
// the AB ? 2N : N cycle, the TAP fill, mute / solo, the content key), toNotes (§4.3), vTrig (§1.3), DEFAULT_MAP (§4.1), the
// payload (§3.5), the LEDs, and the constants dr-seq.js embeds.
// 7b (IMPL-7b §12.3, lane S6; after the 41 tests of 7a, unchanged): the 808 pinned to a digest taken before the 606 went in
// (records, sessions, payloads, plans, pk, notes, press); the TR-606's personality — its record, the dispatch on `m`, one
// test per row of 7b §3.3, its plans, LEDs, map, tempo law, SYNC 303s' swing.
// 7c (IMPL-7c §12.3, lane S9; after the 79 tests of 7b — :254's bound the 808's own literal, :1001's unknown machine 'tr999'):
// the 606 pinned to a digest taken before the 909 went in; the TR-909's personality — its tables in PERS, its record, the
// three-way dispatch, the velocity law (P-1), its tempo law, its plans (every mode, the arrays, the flam clamp), the payload and
// the { k: 'bpm' } send, one test per row of 7c §3.3, the LEDs and the display, → Piano roll (rollPlan / rollOpts / toNotes).
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
  assert.equal(big.n, 768); assert.equal(big.st.length, 768 * 32); assert.equal(big.mT[768], 768 * 32 * 120);
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
  for (const m of [undefined, 'tr808', 'tr999', 606, null, { toString: () => 'tr606' }]) {
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

/* ================================================================== 7c: the 606 pinned; the TR-909 (IMPL-7c §12.3) */

// the 606's outputs as one digest, taken at b8e97ee (= 7b297e5's drum-core.js) before any 7c change (D1, §12.3): records
// (`tr606` with and without its `m`, a hostile one), sessions, payloads at every `at`, plans (with sessions), notes, the
// tables, and press × 66 on 6 random records with their LEDs and grid
function pin606(M) {
  const ser = v => JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? [x.constructor.name, Array.from(x)] : x));
  const parts = [], add = (name, v) => parts.push(name + ' ' + ser(v));
  let a = 0x6060606 >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const DF = M.normDrum(undefined, 'tr606');
  add('def', DF); add('defM', M.normDrum({ m: 'tr606' })); add('init', M.initState('tr606'));
  const junk = { v: 7, m: 'tr606', junk: 1, keys: [{ sc: 9, l1: 0 }, 'bad', { sc: 2.5, l1: 40 }], st: [[0x1FFF, -1, 3.5, 0xFFF]], rt: [16, -2, 7.7], tg: [3, 'x'],
    dc: [900, 63, 5], sg: [-7, 70], ui: { mode: 9, tempo: 999, sel: 14, cl: 3, grp: 2 }, x: { sync: 'yes', swing: 99.6, mute: 0x1001 }, map: { bd: [36, 36, 200], cb: [56], zz: [1] },
    smp: { bd: { id: 'smp:0123456789abcdef', name: 'n', on: true }, cb: { id: 'smp:0123456789abcdef', name: 'c', on: true } } };
  add('junk', M.normDrum(junk)); add('junk606', M.normDrum(junk, 'tr606')); add('junkNoM', M.normDrum({ ...junk, m: undefined }, 'tr606'));
  const recs = [];
  for (let i = 0; i < 6; i++) {
    const d = clone(DF);
    for (let p = 0; p < 32; p++) { d.keys[p] = { sc: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16) }; for (let s = 0; s < 16; s++) d.st[p][s] = r() < 0.4 ? Math.floor(r() * 4096) : 0; }
    for (let t = 0; t < 8; t++) {
      const n = Math.floor(r() * 70), s0 = t < 7 ? t * 64 : 448;
      for (let j = 0; j < n; j++) d.rt[s0 + j] = r() < 0.1 ? -1 : Math.floor(r() * 16);
      d.tg[t] = r() < 0.5 ? 1 : 0; d.dc[t] = r() < 0.3 ? s0 + Math.floor(r() * 60) : -1; d.sg[t] = r() < 0.3 ? s0 + Math.floor(r() * 30) : -1;
    }
    const sel = Math.floor(r() * 16);
    d.ui = { mode: i % 4, inst: Math.floor(r() * 8), grp: Math.floor(r() * 2), sel, cl: Math.floor(r() * (4 - (sel & 3))), sc: 1 + Math.floor(r() * 4), tempo: 40 + Math.round(r() * 26000) / 100 };
    d.x = { sync: r() < 0.5, swing: 50 + Math.floor(r() * 26), mute: Math.floor(r() * 4096), solo: r() < 0.3 ? Math.floor(r() * 4096) : 0, rec: r() < 0.5 };
    d.map = { ...d.map, sd: [40, 38], lt: [41, 45], ht: [47, 48] };
    if (i & 1) d.smp = { sd: { id: 'smp:00000000000000aa', name: 's', on: true }, cy: { id: 'smp:00000000000000bb', name: 'c', on: false } };
    const D = M.normDrum(d, 'tr606'); recs.push(D);
    add('rec' + i, D); add('recNoModel' + i, M.normDrum(d)); add('rec808' + i, M.normDrum(d, 'tr808'));
    const t = D.ui.inst, s0 = t < 7 ? t * 64 : 448;
    const sess = [M.initState('tr606'), { ...M.initState('tr606'), run: true, bar: s0 + 3, twSel: { sel: 4, cl: 1 }, ds: 1, rst: 2, rstF: 4096 }, { ...M.initState('tr606'), play: true, bar: s0 + 1, ds: 2 }];
    sess.forEach((S, j) => { add('plan' + i + '.' + j, M.compilePlan(D, D.ui, D.x, S)); for (const w of ['now', 'bar', 'beat2']) add('pl' + i + '.' + j + w, M.payload(D, S, w)); });
    const plan = M.compilePlan(D, D.ui, D.x);
    add('plan' + i, plan);
    add('notes' + i, M.toNotes(plan, { t0: Math.floor(r() * 9000), t1: 30000, swing: D.x.swing, prim: M.primaries(D.map, 'tr606') }));
    add('tabs' + i, [M.mapTable(D.map, 'tr606'), M.primaries(D.map, 'tr606'), M.drumRows(D.map, 'tr606'), M.mapTable(D.map), M.primaries(D.map), M.drumRows(D.map), M.audible(D.x),
      M.soundMute(D.x), M.planTicks(plan), M.demoFree(D), M.gridPat(M.initState('tr606'), D), M.leds(M.initState('tr606'), D), M.stepLen(D, { k: 1, s: 3 }), M.stepLen(D, { k: 30, s: 15 }),
      Array.from({ length: 8 }, (_, u) => M.track606(D, u)), M.freeBpm(D), M.withTempo(D, 97.25), M.withTempo(D, D.ui.tempo) === D]);
  }
  add('laws', [[0, 0.25, 0.5, 1, NaN].map(M.tempo606), [40, 120, 300, 'x'].map(M.tempo606Pos), [50, 58, 75].map(M.swing303)]);
  const kd = (n, o) => ({ k: 'key', n, down: true, ...o });
  const inputs = [{ k: 'start' }, kd(3), { k: 'key', n: 3, down: false }, kd(6, { shift: true }), { k: 'fn', down: true }, kd(11), kd(5), { k: 'fn', down: false }, { k: 'clr', down: true },
    kd(2), { k: 'clr', down: false }, { k: 'tap', f: 0.7 }, { k: 'tap', f: 0.2, F: 1000 }, { k: 'grp' }, { k: 'mode', v: 3 }, { k: 'inst', v: 5 }, { k: 'sc', v: 2 }, { k: 'tempo', v: 133.33 },
    { k: 'sync', v: false }, { k: 'swing', v: 61 }, { k: 'mute', lane: 9 }, { k: 'solo', lane: 2 }, { k: 'rec', v: true }, { k: 'grid', lane: 11, s: 5 },
    { k: 'pad', sound: 9, f: 0.6, v: 1 }, { k: 'map', sound: 'oh', notes: [46, 42] }, { k: 'mapReset' }, { k: 'smp', sound: 'cy', slot: { id: 'smp:0000000000000001', name: 'R', on: true } },
    { k: 'demo' }, { k: 'undo' }, { k: 'heard', post: { s: 4, m: 0, k: 1, v: 0, p: 0, o: 960, M: 2, f: 0 } }, { k: 'transport', play: true }, { k: 'release' }, { k: 'link303' },
    { k: 'transport', play: false }, { k: 'bpm', v: 133 }, { k: 'panic' }];
  for (let i = 0; i < recs.length; i++) {
    let S = i & 1 ? { ...M.initState('tr606'), play: true } : M.initState('tr606'), D = recs[i];
    for (let j = 0; j < 66; j++) {
      const q = M.press(S, D, inputs[(j * 7 + i) % inputs.length]);
      add('press' + i + '.' + j, [q.state, q.mem === D ? 'same' : q.mem, q.cmds, M.leds(q.state, q.mem), M.gridPat(q.state, q.mem)]);
      S = q.state; D = q.mem;
    }
  }
  add('demo', M.DEMO606); add('pers', M.PERS.tr606); add('map', M.MAP606);
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

test('7c pins (§12.3, D1): the 606\'s records, sessions, payloads (plan, pk), plans, notes, tables and press byte-identical to b8e97ee\'s (= 7b297e5)', () => {
  assert.equal(pin606(C), '76c68a684e88102aace09b9db4e2bfcd9d38ef39b15d01bf22c941de057d92df', 'the digest taken before the change');
});

// the 909's helpers: its defaults; a record with ui / x replaced; sessions (stopped, synced and playing, free and running);
// a lane bit by its code; a pattern's rows from code strings ('x' a hit, 'X' accented, 'f' a flam, 'F' both) and its keys; a
// track's measures; held keys and taps; the commands' sends; the record's pattern rows as strings of one lane
const D9 = C.normDrum(undefined, 'tr909');
const mk9 = (ui = {}, x = {}, base = D9) => C.normDrum({ ...clone(base), ui: { ...base.ui, ...ui }, x: { ...base.x, ...x } }, 'tr909');
const S9 = (o = {}) => ({ ...C.initState('tr909'), ...o });
const play9 = (o = {}) => S9({ play: true, ...o });
const free9 = (o = {}) => S9({ run: true, ...o });
const b9 = code => 1 << C.LANES909[C.CODES909.indexOf(code)];
function pat9(D, p, o, key) {
  const d = clone(D), st = new Array(16).fill(0), ac = st.slice(), fm = st.slice();
  for (const [code, r] of Object.entries(o)) for (let s = 0; s < r.length; s++) {
    const c = r[s], b = b9(code.toUpperCase());
    if (c === '.') continue;
    st[s] |= b; if (c === 'X' || c === 'F') ac[s] |= b; if (c === 'f' || c === 'F') fm[s] |= b;
  }
  d.st[p] = st; d.ac[p] = ac; d.fm[p] = fm;
  if (key) d.keys[p] = { ...d.keys[p], ...key };
  return C.normDrum(d, 'tr909');
}
function tk9(D, t, ms, o = {}) { const d = clone(D); d.tk[t] = ms; if (o.tt != null) d.tt[t] = o.tt; return C.normDrum(d, 'tr909'); }
const run9 = run6;
const hd = b => ({ k: 'hold', b, down: true }), hu = b => ({ k: 'hold', b, down: false }), tp = (b, n) => ({ k: 'tap', b, n });
const sends = r => (r.all || r.cmds).filter(c => c.c === 'send').map(c => c.at);
const lane9 = (D, p, code) => { const b = b9(code); return D.st[p].map((m, s) => (m & b ? (D.fm[p][s] & b ? (D.ac[p][s] & b ? 'F' : 'f') : D.ac[p][s] & b ? 'X' : 'x') : '.')).join(''); };
const ks9 = p => arr(p.mKey);

test('7c PERS.tr909 (§1.2, §4): the 808\'s lane bits and sound ids — ids 7 / 8 its ride / crash, 11–15 the 808\'s keys kept inert; the name tables in PERS (the 808\'s and 606\'s = today\'s globals); its map = the GM numbers; MAP… / roll rows by its names', () => {
  const T = C.PERS.tr909;
  assert.ok(Object.isFrozen(T) && Object.isFrozen(T.lanes) && Object.isFrozen(T.sounds));
  assert.deepEqual(arr(T.lanes), [0, 1, 2, 3, 4, 5, 6, 7, 11, 10, 9, 8]);
  assert.deepEqual(arr(T.codes), ['AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'HC', 'CH', 'OH', 'CR', 'RD']);
  assert.deepEqual(T.lanes.slice(1).map(l => C.LANE_SOUND[l][0]), [0, 1, 2, 3, 4, 5, 6, 10, 9, 8, 7], 'a lane\'s sound (the 808\'s ids)');
  assert.deepEqual(arr(T.sids), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([T.mask, T.acLanes, T.flLanes], [0xFFF, 0x83E, 0x03E]);
  assert.deepEqual(['bd', 'sd', 'lt', 'mt', 'ht', 'ch'].map(s => b9(s.toUpperCase())).reduce((a, b) => a | b), 0x83E, 'per-voice accent: BD SD LT MT HT CH');
  assert.deepEqual(['BD', 'SD', 'LT', 'MT', 'HT'].map(b9).reduce((a, b) => a | b), 0x03E, 'flam: BD … HT');
  assert.equal(T.sounds.length, 16); assert.equal(T.names.length, 16);
  assert.deepEqual([T.sounds[7], T.sounds[8], T.names[7], T.names[8]], ['rd', 'cr', 'Ride', 'Crash']);
  assert.deepEqual(T.sounds.slice(11), C.SOUNDS.slice(11), 'ids 11–15: the 808\'s keys (no empty key in a record)');
  assert.deepEqual(T.sounds.filter((s, i) => i !== 7 && i !== 8), C.SOUNDS.filter((s, i) => i !== 7 && i !== 8));
  // the name tables moved into PERS: the 808's and the 606's are today's globals
  for (const m of ['tr808', 'tr606']) { assert.equal(C.PERS[m].sounds, C.SOUNDS); assert.equal(C.PERS[m].names, C.SOUND_NAMES); }
  assert.deepEqual([T.banks, T.groups, T.patterns, T.steps, T.tracks, T.bankMeas], [2, 3, 96, 16, 8, 896]);
  assert.deepEqual(T.cleared, { sc: 1, l1: 16, sh: 1, fl: 9, ch: 0 }); assert.deepEqual(T.tempo, { lo: 37, hi: 290 }); assert.deepEqual(arr(T.vel), [100, 110, 119, 127]);
  // its map: the 909's receive notes = GM (+ crash 2 57, ride 2 59)
  const M = C.MAP909, prim = C.primaries(M, 'tr909'), tab = C.mapTable(M, 'tr909');
  assert.deepEqual(M, { bd: [36, 35], sd: [38, 40], lt: [41, 43], mt: [45, 47], ht: [48, 50], rs: [37], cp: [39], rd: [51, 59], cr: [49, 57], oh: [46], ch: [42, 44] });
  assert.deepEqual(arr(prim), [36, 38, 41, 45, 48, 37, 39, 51, 49, 46, 42, -1, -1, -1, -1, -1]);
  assert.deepEqual([36, 35, 37, 38, 39, 41, 42, 45, 46, 48, 49, 51, 57, 59, 56, 64, 75].map(n => tab[n]), [0, 0, 5, 1, 6, 2, 10, 3, 9, 4, 8, 7, 8, 7, -1, -1, -1]);
  assert.deepEqual(C.drumRows(M, 'tr909').map(e => [e.n, e.s, e.name]), [[36, 0, 'Kick'], [38, 1, 'Snare'], [41, 2, 'Low tom'], [45, 3, 'Mid tom'], [48, 4, 'Hi tom'],
    [37, 5, 'Rim shot'], [39, 6, 'Hand clap'], [51, 7, 'Ride'], [49, 8, 'Crash'], [46, 9, 'Open hat'], [42, 10, 'Closed hat']]);
  assert.deepEqual(Object.keys(D9.map), [...T.sounds], 'the record\'s map by its own keys, all 16');
  assert.deepEqual([D9.map.lc, D9.map.ma], [[], []]);
  // before a payload the Inst plays DrSeq's default map (the 808's): 56 the ride id, 51 nothing (§1.4)
  assert.deepEqual([DRSEQ.DEF_MAP[56], DRSEQ.DEF_MAP[51], DRSEQ.DEF_MAP[49]], [7, -1, 8]);
  // the 808's and 606's tables unchanged by the model argument's new reading
  assert.deepEqual(C.drumRows(C.DEFAULT_MAP).map(e => e.name), [...C.SOUND_NAMES]);
  assert.deepEqual(arr(C.primaries(C.MAP606, 'tr606')), arr(C.primaries(C.MAP606, 'tr606')));
  assert.deepEqual(arr(DRSEQ.VEL9), arr(C.VEL9)); assert.deepEqual([DRSEQ.AC9, DRSEQ.FL9], [C.AC909, C.FL909], 'DrSeq\'s copies');
});

test('7c normDrum(·, \'tr909\') (§3.1): the defaults; every bound; ac / fm & 0x83E / 0x03E and & their step (review #22); a chain never leaves its group; each bank\'s tracks cut to 896 in order; tt 0 | 37–290; idempotent, JSON-stable; hostile input never throws', () => {
  assert.deepEqual(Object.keys(D9), ['v', 'm', 'keys', 'st', 'ac', 'fm', 'tk', 'tt', 'ui', 'x', 'map', 'smp']);
  assert.deepEqual([D9.v, D9.m, D9.keys.length, D9.st.length, D9.ac.length, D9.fm.length, D9.tk.length, D9.tt.length], [1, 'tr909', 96, 96, 96, 96, 8, 8]);
  assert.ok(D9.keys.every(k => k.sc === 1 && k.l1 === 16 && k.sh === 1 && k.fl === 9 && k.ch === 0));
  assert.ok([D9.st, D9.ac, D9.fm].every(R => R.every(r => r.length === 16 && r.every(m => m === 0))));
  assert.deepEqual([D9.tk, D9.tt], [new Array(8).fill([]), new Array(8).fill(0)]);
  assert.deepEqual(D9.ui, { mode: 0, wm: 0, bank: 0, grp: 0, sel: 0, bl: 0, inst: 1, fw: false, trk: 0, cyc: true, guide: false, tempo: 120 });
  assert.deepEqual(D9.x, { sync: true, mute: 0, solo: 0, rec: false }, 'no swing: SHUFFLE is per pattern');
  assert.deepEqual(D9.smp, {});
  const big = new Array(900).fill(5);
  const d = { v: 3, m: 'tr909', junk: 1, keys: [{ sc: 9, l1: 0, sh: 0, fl: 20, ch: 1 }, { sc: 2.6, l1: 12.4, sh: 7.4, fl: 9.5, ch: 0.7, pre: 3 }, 'bad'],
    st: [[0x1FFF, -1, 3.5, 0xFFF, b9('BD') | b9('CH')]], ac: [[0xFFF, 0xFFF, 0, 0xFFF, 0xFFF]], fm: [[0xFFF, 0xFFF, 0xFFF, b9('BD') | b9('CH'), 0xFFF]],
    tk: [big, [1, 2], [3], 'x', [47, 48, -1, 7.6, 'q'], null, big, big], tt: [36, 37, 290, 291, -5, 'x', 120.4, 0.3],
    ui: { mode: 7, wm: 2, bank: 3, grp: 5, sel: 13, bl: 9, inst: 11, fw: true, trk: 9, cyc: 0, guide: 'yes', tempo: 300.7, swing: 60 },
    x: { sync: 0, swing: 60, mute: 0x1FFF, solo: 3, rec: 1 }, map: { bd: [36], rd: [51, 51, 200], cb: [56], cy: [49] },
    smp: { rd: { id: 'smp:0123456789abcdef', name: 'r', on: true }, cb: { id: 'smp:0123456789abcdef', name: 'c', on: true }, lc: { id: 'smp:0123456789abcdef', name: 'l', on: true } } };
  d.keys[15] = { ch: 1 }; d.keys[16] = { ch: 1 }; d.keys[47] = { ch: 1 };
  const n = C.normDrum(d, 'tr909');
  assert.deepEqual(n.keys.slice(0, 3), [{ sc: 4, l1: 1, sh: 1, fl: 16, ch: 1 }, { sc: 3, l1: 12, sh: 7, fl: 10, ch: 1 }, { sc: 1, l1: 16, sh: 1, fl: 9, ch: 0 }]);
  assert.deepEqual([n.keys[15].ch, n.keys[16].ch, n.keys[47].ch], [0, 1, 0], 'key 16 of a group never chains into the next group');
  assert.deepEqual(n.st[0].slice(0, 6), [0xFFF, 0xFFF, 0, 0xFFF, b9('BD') | b9('CH'), 0], 'masks to 12 bits (as the 808\'s)');
  assert.deepEqual(n.ac[0].slice(0, 6), [0x83E, 0x83E, 0, 0x83E, b9('BD') | b9('CH'), 0], 'per-voice accents & 0x83E & the step');
  assert.deepEqual(n.fm[0].slice(0, 6), [0x03E, 0x03E, 0, b9('BD'), b9('BD'), 0], 'flams & 0x03E & the step (a hostile flam without its step: none)');
  assert.deepEqual(n.tk.map(L => L.length), [896, 0, 0, 0, 5, 0, 891, 0], 'bank I: track 1 takes the 896, the later ones cut; bank II: 5 + 891');
  assert.deepEqual(n.tk[4], [47, 47, 0, 8, 0]);
  assert.deepEqual(n.tt, [37, 37, 290, 290, 0, 0, 120, 0]);
  assert.deepEqual(n.ui, { mode: 3, wm: 1, bank: 1, grp: 2, sel: 13, bl: 2, inst: 11, fw: false, trk: 3, cyc: true, guide: false, tempo: 290 }, 'flam write only on BD … HT');
  assert.equal(C.normDrum({ ...clone(D9), ui: { inst: 3, fw: true } }, 'tr909').ui.fw, true);
  assert.deepEqual(n.x, { sync: true, mute: 0xFFF, solo: 3, rec: false });
  assert.deepEqual([n.map.bd, n.map.rd, n.map.cr, n.map.oh, 'cb' in n.map, 'cy' in n.map], [[36], [51], [49, 57], [46], false, false]);
  assert.deepEqual(n.smp, { rd: { id: 'smp:0123456789abcdef', name: 'r', on: true } }, 'its eleven slots by its own keys');
  assert.ok(!('junk' in n) && !('swing' in n.x) && !('swing' in n.ui) && !('pre' in n.keys[1]));
  assert.deepEqual(C.normDrum(n), n, 'idempotent (by its own m)'); assert.deepEqual(C.normDrum(clone(n), 'tr909'), n, 'JSON round trip');
  const cyc = []; cyc.push(cyc);
  const evil = { m: 'tr909', get keys() { throw new Error('boom'); } };
  for (const q of [null, 5, 'x', [], { keys: 'x', st: {}, ac: 5, fm: [cyc], tk: 'x', tt: {}, ui: [], x: 3, map: 2, smp: [] }, { st: [cyc], tk: [cyc], map: { bd: cyc } }, evil,
    { st: new Array(500).fill(new Array(1e5).fill(0x7FF)), tk: new Array(1e5).fill(new Array(1e5).fill(3)) }, { ui: { tempo: Infinity, sel: NaN, bl: -Infinity } }]) {
    const r = C.normDrum(q, 'tr909');
    assert.deepEqual([r.m, r.st.length, r.keys.length, r.tk.length], ['tr909', 96, 96, 8]);
    assert.ok(r.tk[0].length + r.tk[1].length + r.tk[2].length + r.tk[3].length <= 896 && r.tk[4].length + r.tk[5].length + r.tk[6].length + r.tk[7].length <= 896);
    assert.ok(JSON.stringify(r).length < 60000);
    assert.deepEqual(C.normDrum(r), r);
  }
  assert.deepEqual(C.normDrum(evil), D9, 'a throwing getter: the defaults');
});

test('7c the machine of a record (§3.1): three-way, \'tr909\' only for the exact string; the model wins over m (808 ↔ 606 ↔ 909); normDrum(d) keeps a 909 record a 909\'s; a foreign session becomes the 909\'s (and a 909 session under an 808 record the 808\'s)', () => {
  const d = tk9(pat9(mk9({ mode: 2, sel: 4, tempo: 133 }), 4, { bd: 'X..x' }), 0, [4, 4, 5]);
  assert.deepEqual(C.normDrum(d), d); assert.deepEqual(C.normDrum(clone(d)), d);
  for (const m of ['TR909', 'tr909 ', 909, { toString: () => 'tr909' }]) assert.ok(!('m' in C.normDrum({ ...clone(DEF), m })), 'not the 909: ' + String(m));
  assert.equal(C.normDrum({ m: 'tr909' }).m, 'tr909');
  assert.ok(!('m' in C.normDrum(d, 'tr808')) && C.normDrum(d, 'tr808').rt.length === 768, 'the model wins');
  assert.equal(C.normDrum(d, 'tr606').m, 'tr606'); assert.equal(C.normDrum(D6, 'tr909').m, 'tr909'); assert.equal(C.normDrum(DEF, 'tr909').m, 'tr909');
  const x8 = C.normDrum(DEF, 'tr909');
  assert.deepEqual([x8.m, x8.keys.length, x8.st[0].length, x8.tk.length], ['tr909', 96, 16, 8], 'an 808 record read as a 909\'s: its shape');
  assert.deepEqual(C.normDrum(x8), x8);
  assert.deepEqual(Object.keys(C.initState('tr909')), ['m', 'run', 'play', 'pos', 'undo', 'bpm', 'hold', 'keys', 'dig', 'ptr', 'loc', 'pend', 'disp', 'erase', 'op', 'pg', 'tw', 'hits', 'cont', 'from', 'end']); // (review 1 F4 / F5: cont, from, end)
  assert.deepEqual(C.initState('tr909').hold, { shift: false, isel: false, clear: false, last: false, shuf: false, tkey: false, avail: false });
  const r = C.press({ ...C.initState(), play: true, bpm: 99 }, mk9(), kd(5));     // (an 808 session under a 909 record: the 909's, its transport kept)
  assert.deepEqual([r.state.m, r.state.keys, r.state.play, r.state.bpm, r.mem.ui.sel], ['tr909', [5], true, 99, 4]);
  const r6 = C.press(S6({ play: true, held: [3] }), mk9(), kd(2));
  assert.deepEqual([r6.state.m, r6.state.keys, r6.state.play], ['tr909', [2], true]);
  const r8 = C.press(play9({ bpm: 97 }), mk({ mode: 3 }), { k: 'tap' });           // (…and a 909 session under an 808 record: the 808's)
  assert.deepEqual([r8.state.tap, r8.state.play, r8.state.bpm, 'm' in r8.state, 'hold' in r8.state], [1, true, 97, false, false]);
  const q6 = C.press(play9(), mk6(), kd(3));                                         // (a 909 session under a 606 record: the 606's)
  assert.deepEqual([q6.state.held, q6.state.play, 'm' in q6.state], [[3], true, false]);
});

test('7c vel9 / vTrig9 (§1.3, the lead\'s P-1): fixed velocities per state — 100 / 110 / 119 / 127, a voice without per-voice accent 100 / 127 — at every TOTAL ACCENT; the inverse gives each state\'s code exactly at 21 knob positions, linear between, ghosts below 100; the copies agree with dr-808.js\'s when V9\'s machine is present', t => {
  const { N0, L, TMAX } = C.ACC9;
  const with9 = [0, 1, 2, 3, 4, 10], without = [5, 6, 7, 8, 9];
  for (let k = 0; k <= 20; k++) {
    const u = k / 20, T = Math.round(TMAX * u);
    for (const s of with9) {
      assert.deepEqual([0, 1, 2, 3].map(q => C.vel9(s, q, u)), [100, 110, 119, 127], 'never ranked by the knob');
      assert.deepEqual([100, 110, 119, 127].map(v => C.vTrig9(v, s, u)), [N0, N0 + L, N0 + T, Math.min(63, N0 + L + T)], 'u ' + u);
      for (let v = 100; v < 110; v++) assert.ok(C.vTrig9(v + 1, s, u) >= C.vTrig9(v, s, u), 'monotone 100 → 110');
      for (let v = 119; v < 127; v++) assert.ok(C.vTrig9(v + 1, s, u) >= C.vTrig9(v, s, u), 'monotone 119 → 127');
      for (let v = 110; v <= 119; v++) assert.equal(C.vTrig9(v, s, u), Math.round(N0 + L + (T - L) * (v - 110) / 9), 'linear 110 → 119 (non-monotone while T < L)');
    }
    for (const s of without) {
      assert.deepEqual([0, 1, 2, 3].map(q => C.vel9(s, q, u)), [100, 100, 127, 127], 'no per-voice accent: normal / total');
      assert.deepEqual([100, 127].map(v => C.vTrig9(v, s, u)), [N0, N0 + T]);
      for (let v = 100; v < 127; v++) assert.ok(C.vTrig9(v + 1, s, u) >= C.vTrig9(v, s, u));
    }
  }
  for (const v of [1, 50, 99]) assert.equal(C.vTrig9(v, 0, 0.5), Math.round(N0 * (0.6 + 0.4 * (v - 1) / 99)), 'ghosts');
  assert.deepEqual([C.vTrig9(NaN, 0, 0.5), C.vTrig9(500, 0, 0.5), C.vTrig9(100, 0, NaN)], [N0, Math.min(63, N0 + L + Math.round(TMAX / 2)), N0]);
  assert.ok(N0 + L + TMAX <= 63 + L, 'both at full TOTAL ACCENT within the DAC');
  // the machine's copy (V9's dr-808.js: Dr808.proto.tr909) — present after the phase-0 merge
  const S = dspScope({ files: [] }); S.run(source('dr-808.js'), 'dr-808.js');
  const P9 = S.global('Dr808') && S.global('Dr808').proto && S.global('Dr808').proto.tr909;
  if (!P9) { t.diagnostic('dr-808.js has no tr909 yet (V9 merges in phase 0): the copies compared after the merge'); return; }
  if (P9.ACC9) assert.deepEqual({ N0: P9.ACC9.N0, L: P9.ACC9.L, TMAX: P9.ACC9.TMAX }, { N0, L, TMAX }, 'the accent DAC\'s constants equal dr-808.js\'s');
  if (typeof P9.vTrig9 === 'function') for (let k = 0; k <= 20; k++) for (let s = 0; s < 11; s++) for (const v of [1, 64, 99, 100, 105, 110, 114, 119, 123, 127]) assert.equal(P9.vTrig9(v, s, k / 20), C.vTrig9(v, s, k / 20));
});

test('7c TEMPO (§3.1): whole BPM 37–290 on the knob\'s log law tempo909(u) = round(37 · (290 / 37)^u); tempo909Pos inverts; withTempo / freeBpm read its TEMPO', () => {
  assert.deepEqual([0, 0.5, 1, -1, 2, NaN].map(C.tempo909), [37, 104, 290, 37, 290, 120]);
  for (let b = 37; b <= 290; b++) assert.equal(C.tempo909(C.tempo909Pos(b)), b);
  assert.deepEqual([C.tempo909Pos(37), C.tempo909Pos(290), C.tempo909Pos('x')], [0, 1, C.tempo909Pos(120)]);
  const D = mk9({ tempo: 133 });
  assert.equal(C.freeBpm(D), 133);
  assert.equal(C.withTempo(D, 133.2), D); assert.equal(C.withTempo(D, 'x'), D);
  assert.deepEqual([C.withTempo(D, 97.6).ui.tempo, C.withTempo(D, 300).ui.tempo, C.withTempo(D, 10).ui.tempo], [98, 290, 37]);
});

test('7c compilePlan, every mode (§3.4): PATTERN PLAY the selection — a pattern, its chain (a key inside one selects it from its first), a block walking its keys each chain once (review #18); PATTERN WRITE the edited pattern alone; TRACK PLAY the track (bank-relative measures; free, a located start a pre-roll); TRACK WRITE pend, else the pointer\'s measure; SCALE → the step codes, LAST STEP; plans DrSeq accepts', () => {
  let D = mk9();
  for (const [sc, code, T] of [[1, 3, 240], [2, 4, 120], [3, 1, 320], [4, 2, 160]]) {
    const p = C.compilePlan(pat9(mk9({ sel: 5 }), 5, { bd: 'x' }, { sc, l1: 11 }));
    assert.deepEqual([p.n, ks9(p), arr(p.mPre), arr(p.mL1), arr(p.mOff), arr(p.mT), p.loopFrom, p.fill, arr(p.mVar)], [1, [5], [code], [11], [0, 11], [0, 11 * T], 0, null, [0]], 'SCALE ' + sc);
  }
  // chains: 3 → 4 → 5 in group I-1, 9 → 10; a key inside a chain selects it from its first
  const d = clone(D9); for (const k of [3, 4, 9]) d.keys[k].ch = 1;
  D = C.normDrum(d, 'tr909');
  assert.deepEqual(ks9(C.compilePlan(mk9({ sel: 4 }, {}, D))), [3, 4, 5], 'a key inside a chain: the chain from its first');
  assert.deepEqual(ks9(C.compilePlan(mk9({ sel: 0 }, {}, D))), [0]);
  assert.deepEqual(ks9(C.compilePlan(mk9({ sel: 1, bl: 9 }, {}, D))), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'a block: its keys in order, each chain once');
  assert.deepEqual(ks9(C.compilePlan(mk9({ sel: 4, bl: 5 }, {}, D))), [3, 4, 5, 6, 7, 8, 9, 10], 'a block starting inside a chain takes it whole; the last key\'s chain runs past it');
  assert.deepEqual(ks9(C.compilePlan(mk9({ grp: 2, bank: 1, sel: 15 }, {}, D))), [95]);
  assert.deepEqual(ks9(C.compilePlan(mk9({ mode: 1, sel: 4 }, {}, D))), [4], 'PATTERN WRITE: the edited pattern alone');
  assert.deepEqual(ks9(C.compilePlan(mk9({ mode: 1, sel: 2, grp: 1, bank: 1 }, {}, D))), [66]);
  // TRACK PLAY: the track of its bank, bank-relative measures; free with a located start, a pre-roll; synced from measure 1; once by CYCLE
  const T = tk9(tk9(D, 1, [0, 17, 33, 47, 2]), 5, [1, 47]);
  let p = C.compilePlan(mk9({ mode: 2, trk: 1 }, {}, T));
  assert.deepEqual([ks9(p), p.loopFrom, p.once, p.intro], [[0, 17, 33, 47, 2], 0, 0, 0]);
  assert.deepEqual(ks9(C.compilePlan(mk9({ mode: 2, trk: 1, bank: 1 }, {}, T))), [49, 95], 'bank II: + 48');
  p = C.compilePlan(mk9({ mode: 2, trk: 1 }, { sync: false }, T), undefined, undefined, S9({ loc: 3 }));
  assert.deepEqual([ks9(p), p.loopFrom, p.intro], [[47, 2, 0, 17, 33, 47, 2], 2, 1], 'a free located start: a pre-roll, then the cycle');
  assert.deepEqual(ks9(C.compilePlan(mk9({ mode: 2, trk: 1 }, {}, T), undefined, undefined, S9({ loc: 3 }))), [0, 17, 33, 47, 2], 'synced: from measure 1');
  assert.deepEqual(ks9(C.compilePlan(mk9({ mode: 2, trk: 1 }, { sync: false }, T), undefined, undefined, S9({ loc: 9 }))), [0, 17, 33, 47, 2], 'a located start past the end: measure 1');
  p = C.compilePlan(mk9({ mode: 2, trk: 1, cyc: false }, {}, T));
  assert.deepEqual([p.once, p.loopFrom], [1, 0], 'CYCLE off: once');
  assert.equal(C.compilePlan(mk9({ mode: 2, trk: 2 }, {}, T)).n, 0, 'an empty track: nothing');
  // TRACK WRITE: pend (a key, its chain, a range), else the pointer's measure (appending: nothing)
  const W = mk9({ mode: 3, trk: 1 }, {}, T);
  assert.deepEqual(ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 1 }))), [17]);
  assert.deepEqual(ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 5 }))), [], 'appending: nothing to hear');
  assert.deepEqual(ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 1, pend: { g: 0, sel: 4, bl: 0 } }))), [3, 4, 5], 'pend: its chain whole');
  assert.deepEqual(ks9(C.compilePlan(W, undefined, undefined, S9({ pend: { g: 2, sel: 0, bl: 2 } }))), [32, 33, 34], 'a range');
  assert.deepEqual(ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 1, pend: { g: 3, sel: 0, bl: 0 } }))), [17], 'a hostile pend: none');
  for (const [Q, msg] of [[C.compilePlan(D), 'PP'], [C.compilePlan(mk9({ mode: 2, trk: 1 }, { sync: false }, T), undefined, undefined, S9({ loc: 3 })), 'TP'], [C.compilePlan(W, undefined, undefined, S9({ pend: { g: 0, sel: 4, bl: 0 } })), 'TW']]) assert.ok(DRSEQ.valid(Q), msg);
});

test('7c compilePlan, the 909\'s arrays (§3.4): ac / fl & the step (mute / solo mask them alike), mSh per measure — 16ths 20 · (sh − 1), 32nds 20 · ⌊(sh − 1) / 2⌋, triplets 0 —, mFl the spacing 10 + 4 · (fl − 9) ms in whole ticks at the flam tempo, the flags once / guide; the key stable and sensitive, the shape timing + the shuffle; the 808\'s / 606\'s plans carry none', () => {
  const R = { ac: 'x.......', bd: 'X.x.F.f.', sd: '....x...', ch: 'xX......', oh: '..x.....', rd: 'x.......' };
  const D = pat9(mk9({ sel: 0 }), 0, R, { sh: 3, fl: 12 });
  let p = C.compilePlan(D);
  assert.deepEqual(arr(p.st).slice(0, 5), [b9('AC') | b9('BD') | b9('CH') | b9('RD'), b9('CH'), b9('BD') | b9('OH'), 0, b9('BD') | b9('SD')]);
  assert.deepEqual(arr(p.ac).slice(0, 5), [b9('BD'), b9('CH'), 0, 0, b9('BD')]);
  assert.deepEqual(arr(p.fl).slice(0, 7), [0, 0, 0, 0, b9('BD'), 0, b9('BD')]);
  assert.deepEqual([arr(p.mSh), arr(p.mFl), p.once, p.guide], [[40], [Math.round(22 * 120 * 960 / 60000)], 0, 0]);
  assert.ok(p.ac instanceof Uint16Array && p.fl instanceof Uint16Array && p.mSh instanceof Uint8Array && p.mFl instanceof Uint16Array);
  // mute / solo: st, ac and fl alike (AC by its own mute)
  const pm = C.compilePlan(mk9({}, { mute: b9('BD') }, D));
  assert.deepEqual([pm.st[0], pm.ac[0], pm.fl[4]], [b9('AC') | b9('CH') | b9('RD'), 0, 0]);
  const ps = C.compilePlan(mk9({}, { solo: b9('BD') }, D));
  assert.deepEqual([ps.st[0], ps.ac[0], ps.fl[4], ps.st[1]], [b9('AC') | b9('BD'), b9('BD'), b9('BD'), 0]);
  // the shuffle by SCALE
  for (const [sc, sh, w] of [[1, 1, 0], [1, 2, 20], [1, 7, 120], [2, 1, 0], [2, 2, 0], [2, 3, 20], [2, 4, 20], [2, 7, 60], [3, 7, 0], [4, 5, 0]]) assert.deepEqual(arr(C.compilePlan(pat9(D, 0, { bd: 'x' }, { sc, sh })).mSh), [w], `SCALE ${sc} SHUFFLE ${sh}`);
  // the flam spacing: whole ticks at the flam tempo — free its TEMPO, synced the session's project tempo
  for (const fl of [9, 10, 13, 16]) for (const bpm of [37, 97, 120, 290]) {
    const ms = 10 + 4 * (fl - 9), want = Math.min(Math.round(ms * bpm * 960 / 60000), 240 - 1);
    assert.deepEqual(arr(C.compilePlan(mk9({ tempo: bpm }, { sync: false }, pat9(D, 0, { bd: 'f' }, { fl, sh: 1 }))).mFl), [want], `free ${fl} ${bpm}`);
    assert.deepEqual(arr(C.compilePlan(mk9({ tempo: 200 }, {}, pat9(D, 0, { bd: 'f' }, { fl, sh: 1 })), undefined, undefined, S9({ bpm })).mFl), [want], `synced ${fl} ${bpm}`);
  }
  assert.equal(C.compilePlan(D).mFl[0], C.compilePlan(D, undefined, undefined, S9({ bpm: 120 })).mFl[0], 'no session: 120 BPM');
  // the flags
  assert.equal(C.compilePlan(mk9({ mode: 1, wm: 1, guide: true }, {}, D)).guide, 1);
  assert.deepEqual([C.compilePlan(mk9({ mode: 1, wm: 0, guide: true }, {}, D)).guide, C.compilePlan(mk9({ mode: 0, wm: 1, guide: true }, {}, D)).guide], [0, 0], 'TAP write only');
  // the key and the shape
  p = C.compilePlan(D);
  const k = q => [q.key, q.shape];
  assert.deepEqual(k(C.compilePlan(C.normDrum(clone(D)))), k(p), 'deterministic, memo-independent');
  const acc = C.compilePlan(pat9(D, 0, { ...R, bd: 'x.x.F.f.' }));
  assert.ok(acc.key !== p.key && acc.shape === p.shape, 'a per-voice accent: the key, not the shape');
  const flm = C.compilePlan(pat9(D, 0, { ...R, bd: 'X.x.X.x.' }));
  assert.ok(flm.key !== p.key && flm.shape === p.shape, 'a flam: the key');
  const spc = C.compilePlan(pat9(D, 0, R, { fl: 13 }));
  assert.ok(spc.key !== p.key && spc.shape === p.shape, 'the flam spacing: the key');
  const shf = C.compilePlan(pat9(D, 0, R, { sh: 4 }));
  assert.ok(shf.key !== p.key && shf.shape !== p.shape, 'the shuffle: the shape (DrSeq swaps it at the boundary)');
  assert.ok(C.compilePlan(mk9({ tempo: 121 }, { sync: false }, D)).key !== C.compilePlan(mk9({ tempo: 120 }, { sync: false }, D)).key, 'the free tempo moves the flams\' ticks: the key');
  assert.equal(C.compilePlan(mk9({ tempo: 121 }, { sync: false }, mk9())).key, C.compilePlan(mk9({ tempo: 120 }, { sync: false }, mk9())).key, 'no flam: the tempo leaves the plan alone');
  const T = tk9(D, 0, [0, 0]);
  const once = C.compilePlan(mk9({ mode: 2, cyc: false }, {}, T)), cyc = C.compilePlan(mk9({ mode: 2 }, {}, T));
  assert.ok(once.key !== cyc.key && once.shape === cyc.shape, 'CYCLE: the key (sent at once: in place)');
  // the memo signature (review #8): every session input the plan reads
  const W = mk9({ mode: 3 }, {}, tk9(D, 0, [0, 1, 2]));
  assert.deepEqual([ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 0 }))), ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 2 }))), ks9(C.compilePlan(W, undefined, undefined, S9({ ptr: 2, pend: { g: 0, sel: 7, bl: 0 } })))], [[0], [2], [7]]);
  const TP = mk9({ mode: 2 }, { sync: false }, tk9(D, 0, [0, 1, 2]));
  assert.deepEqual([ks9(C.compilePlan(TP, undefined, undefined, S9({ loc: 1 }))), ks9(C.compilePlan(TP, undefined, undefined, S9({ loc: 0 })))], [[1, 2, 0, 1, 2], [0, 1, 2]]);
  // the 808's and the 606's plans: none of the 909's keys
  for (const q of [C.compilePlan(DEF), C.compilePlan(D6)]) assert.ok(!['ac', 'fl', 'mSh', 'mFl', 'once', 'guide'].some(f => f in q));
});

test('7c the flam spacing clamped (§3.4, review #2): mFl ≤ the measure\'s smallest step gap − 1 — STEP_T − mSh on a shuffled scale, else STEP_T — so a flam\'s second hit always lands before the lane\'s next step (38 ms at 120 BPM vs 32nds at SHUFFLE 7: 59; at 300 BPM vs 16ths at SHUFFLE 7: 119)', () => {
  const D = pat9(mk9(), 0, { bd: 'ffffffffffffffff' });
  const fm = (key, bpm) => C.compilePlan(pat9(D, 0, { bd: 'ffffffffffffffff' }, key), undefined, undefined, S9({ bpm })).mFl[0];
  assert.equal(fm({ sc: 2, sh: 7, fl: 16 }, 120), 59, '73 ticks clamped to 120 − 60 − 1');
  assert.equal(fm({ sc: 1, sh: 7, fl: 16 }, 300), 119, '182 ticks clamped to 240 − 120 − 1');
  assert.equal(fm({ sc: 2, sh: 1, fl: 16 }, 300), 119, '32nds unshuffled: 120 − 1');
  assert.equal(fm({ sc: 1, sh: 7, fl: 16, l1: 1 }, 300), 182, 'one step: no gap but the measure\'s end (240)');
  assert.equal(fm({ sc: 1, sh: 1, fl: 16 }, 120), 73, 'unclamped');
  for (let sc = 1; sc <= 4; sc++) for (let sh = 1; sh <= 7; sh++) for (const bpm of [37, 120, 300]) {
    const p = C.compilePlan(pat9(D, 0, { bd: 'ffffffffffffffff' }, { sc, sh, fl: 16, l1: sc > 2 ? 12 : 16 }), undefined, undefined, S9({ bpm }));
    const T = C.STEP_T[p.mPre[0]], w = p.mSh[0];
    for (let s = 0; s + 1 < p.mL1[0]; s++) assert.ok(s * T + (s & 1 ? w : 0) + p.mFl[0] < (s + 1) * T + ((s + 1) & 1 ? w : 0), `${sc}/${sh}/${bpm} step ${s}`);
    const L = p.mL1[0] - 1;
    assert.ok(L * T + (L & 1 ? w : 0) + p.mFl[0] < p.mL1[0] * T, 'the last step\'s second hit inside its measure');
    assert.ok(DRSEQ.valid(p));
  }
});

test('7c payload (§3.1): 7b\'s shape — m \'tr909\', rst 0, rstF −1, tap 0 —, bpm its TEMPO, swing 50 (inert: the plan carries the shuffle), its map / primaries / slots by its own keys; pk follows m (never an 808\'s or a 606\'s) and every field but `at`', () => {
  const D = pat9(mk9({ tempo: 133 }, { sync: false }), 0, { bd: 'X.f.' }, { sh: 4 });
  const s = C.payload(D, free9(), 'bar');
  assert.deepEqual(Object.keys(s), ['plan', 'sync', 'run', 'bpm', 'swing', 'at', 'tap', 'map', 'prim', 'mute', 'smp', 'm', 'rst', 'rstF', 'pk']);
  assert.deepEqual([s.sync, s.run, s.bpm, s.swing, s.at, s.tap, s.m, s.rst, s.rstF, s.smp], [false, true, 133, 50, 'bar', 0, 'tr909', 0, -1, null]);
  assert.equal(s.plan, C.compilePlan(D, D.ui, D.x, free9()));
  assert.deepEqual(arr(s.prim), arr(C.primaries(C.MAP909, 'tr909'))); assert.deepEqual(arr(s.map), arr(C.mapTable(D.map, 'tr909')));
  assert.equal(C.payload(D, free9(), 'now').pk, s.pk, 'not `at`');
  const r = run9(S9(), D, { k: 'smp', sound: 'rd', slot: { id: 'smp:00000000000000d1', name: 'Ride', on: true } });
  assert.deepEqual(C.payload(r.mem, S9()).smp[7], { id: 'smp:00000000000000d1', on: true }, 'its ride slot by sound id (7)');
  const pks = new Set([s.pk, C.payload(D, S9(), 'now').pk, C.payload(mk9({ tempo: 134 }, {}, D), free9()).pk, C.payload(mk9({}, { mute: 2 }, D), free9()).pk,
    C.payload(pat9(D, 0, { bd: 'x.f.' }, { sh: 4 }), free9()).pk, C.payload(r.mem, free9()).pk]);
  assert.equal(pks.size, 6, 'pk follows the run, the tempo, the mute, the accents, the slots');
  // never an 808's or a 606's pk, even with equal plans and tables
  const e8 = C.payload(DEF, C.initState()), e6 = C.payload(D6, C.initState('tr606')), e9 = C.payload(D9, C.initState('tr909'));
  assert.ok(e9.pk !== e8.pk && e9.pk !== e6.pk);
  // the synced payload's flams at the session's project tempo (the offline payload: a session with bpm, review #1)
  const F = pat9(mk9(), 0, { sd: 'f' }, { fl: 16 });
  assert.equal(C.payload(F, S9({ bpm: 100 })).plan.mFl[0], Math.round(38 * 100 * 960 / 60000));
  assert.equal(C.payload(F, Object.assign(C.initState('tr909'), { bpm: 97 })).plan.mFl[0], Math.round(38 * 97 * 960 / 60000));
});

test('7c { k: \'bpm\' } (§3.4, review #1): the session takes the project tempo; a synced 909 whose flams\' ticks move sends \'now\' — none without a flam, at an equal tick count, or free (its TEMPO is its own)', () => {
  const F = pat9(mk9(), 0, { sd: '....f' }, { fl: 16 });
  let r = run9(play9({ bpm: 120 }), F, { k: 'bpm', v: 100 });
  assert.deepEqual([r.state.bpm, sends(r)], [100, ['now']]);
  assert.equal(C.payload(r.mem, r.state).plan.mFl[0], 61);
  assert.deepEqual(sends(run9(play9({ bpm: 120 }), mk9(), { k: 'bpm', v: 100 })), [], 'no flam: the plan unchanged');
  assert.deepEqual(sends(run9(play9({ bpm: 120 }), F, { k: 'bpm', v: 120.01 })), [], 'the same whole ticks');
  r = run9(S9({ bpm: 120 }), mk9({}, { sync: false }, F), { k: 'bpm', v: 90 });
  assert.deepEqual([r.state.bpm, sends(r)], [90, []], 'free: its own TEMPO');
  assert.deepEqual([run9(S9(), F, { k: 'bpm', v: 'x' }).state.bpm, run9(S9(), F, { k: 'bpm', v: -5 }).state.bpm], [120, 120]);
  assert.equal(run9(S9(), F, { k: 'bpm', v: 77 }).mem, F, 'the record unchanged');
});

test('7c §3.3 START: synced the project\'s ▶ (stopped; running nothing); free runs from the top — pattern modes the selection\'s first, TRACK PLAY measure 1 (a located measure forgotten); an empty track nothing', () => {
  assert.deepEqual(run9(S9(), D9, tp('start')).all, [{ c: 'play' }]);
  assert.deepEqual(run9(play9(), D9, tp('start')).all, [], 'running: nothing');
  const F = mk9({}, { sync: false });
  let r = run9(S9({ pos: { s: 3 } }), F, tp('start'));
  assert.deepEqual([r.state.run, r.state.pos, sends(r), C.payload(r.mem, r.state).run], [true, null, ['now'], true]);
  assert.deepEqual(run9(free9(), F, tp('start')).all, [], 'running: nothing');
  const T = mk9({ mode: 2 }, { sync: false }, tk9(D9, 0, [3, 4, 5]));
  r = run9(S9({ loc: 2 }), T, tp('start'));
  assert.deepEqual([r.state.run, r.state.loc, ks9(C.payload(r.mem, r.state).plan)], [true, 0, [3, 4, 5]], 'TRACK PLAY: from measure 1');
  assert.deepEqual(run9(S9(), mk9({ mode: 2, trk: 1 }, { sync: false }, T), tp('start')).all, [], 'an empty track: nothing to play');
  assert.deepEqual(run9(S9(), mk9({ mode: 2, trk: 1 }, {}, T), tp('start')).all, []);
});

test('7c §3.3 STOP/CONT: running stops (synced the project\'s ■); stopped continues — synced the project\'s ▶ from the song position, free its own: a pattern mode from the selection, TRACK PLAY at the measure it stopped in, or the located one (loc)', () => {
  assert.deepEqual(run9(play9(), D9, tp('stop')).all, [{ c: 'stop' }]);
  assert.deepEqual(run9(S9(), D9, tp('stop')).all, [{ c: 'play' }]);
  const F = mk9({}, { sync: false });
  let r = run9(free9(), F, tp('stop'));
  assert.deepEqual([r.state.run, sends(r)], [false, ['now']]);
  r = run9(r.state, r.mem, tp('stop'));
  assert.deepEqual([r.state.run, sends(r)], [true, ['now']]);
  const T = mk9({ mode: 2 }, { sync: false }, tk9(D9, 0, [3, 4, 5, 6]));
  const S = heard(free9(), T, { k: 5, m: 2, s: 7 });
  r = run9(S, T, tp('stop'));
  assert.deepEqual([r.state.run, r.state.loc], [false, 2], 'the measure it stopped in');
  r = run9(r.state, r.mem, tp('stop'));
  assert.deepEqual([r.state.run, ks9(C.payload(r.mem, r.state).plan), C.payload(r.mem, r.state).plan.loopFrom], [true, [5, 6, 3, 4, 5, 6], 2], 'continued there (a pre-roll, then the cycle)');
  // a pre-roll heard: the track's measure through it
  r = run9(heard(r.state, r.mem, { k: 3, m: 2, s: 0 }), r.mem, tp('stop'));
  assert.equal(r.state.loc, 0, 'plan measure 2 = the cycle\'s first');
  r = run9(S9({ loc: 3 }), T, tp('stop'));
  assert.deepEqual([r.state.run, ks9(C.payload(r.mem, r.state).plan)], [true, [6, 3, 4, 5, 6]], 'a located measure: started there');
  assert.deepEqual(run9(S9(), mk9({ trk: 2 }, {}, T), tp('stop')).all, [], 'an empty track: nothing');
});

// review 1 F4: §3.3's [R] row restored — a free STOP/CONT continues where it stopped: the session keeps the running plan's
// structure (cont) and, at CONT, the step after the last one heard (the posts heard after the press count: the output latency)
// is the payload's `from`; the plan changed meanwhile (another selection, a mode, a relocated track): from the top / the
// located measure's step 1
test('7c review 1 F4: free STOP/CONT continues where it stopped — the pattern modes at the step after the last heard (a block\'s third pattern too), TRACK PLAY at its measure and step; posts heard after the press count; START, another selection or a relocation: from the top', () => {
  const F = mk9({ mode: 0, sel: 0, bl: 2 }, { sync: false });
  let r = run9(heard(free9(), F, { k: 2, m: 2, s: 7, o: 1680 }), F, tp('stop'));
  assert.deepEqual([r.state.run, C.payload(r.mem, r.state).from], [false, undefined]);
  r = run9(heard(r.state, r.mem, { k: 2, m: 2, s: 8, o: 1920 }), r.mem, tp('stop')); // (a step heard after the press)
  const pl = C.payload(r.mem, r.state);
  assert.deepEqual([r.state.run, pl.run, pl.from], [true, true, pl.plan.mT[2] + 1921], 'CONT: from the step after the last heard (I-1-3, step 10)');
  assert.equal(C.payload(r.mem, heard(r.state, r.mem, { k: 2, m: 2, s: 9, o: 2160 })).from, undefined, 'played: later payloads carry none');
  r = run9(heard(free9(), F, { k: 1, m: 1, s: 3, o: 720 }), F, tp('stop'));
  const st = run9(r.state, r.mem, tp('start'));
  assert.deepEqual([st.state.run, C.payload(st.mem, st.state).from], [true, undefined], 'START: from the top');
  const sel = run9(r.state, r.mem, kd(5), ku(5), tp('stop'));
  assert.deepEqual([sel.mem.ui.sel, sel.state.run, C.payload(sel.mem, sel.state).from], [4, true, undefined], 'another pattern: from its start');
  // TRACK PLAY: its measure (a pre-roll from it) and step; the drained posts crossing a measure: loc follows; BACK: relocated
  const T = mk9({ mode: 2 }, { sync: false }, tk9(D9, 0, [3, 4, 5, 6]));
  r = run9(heard(free9(), T, { k: 5, m: 2, s: 7, o: 1680 }), T, tp('stop'));
  r = run9(heard(r.state, r.mem, { k: 5, m: 2, s: 9, o: 2160 }), r.mem, tp('stop'));
  const pt = C.payload(r.mem, r.state);
  assert.deepEqual([r.state.loc, ks9(pt.plan), pt.from], [2, [5, 6, 3, 4, 5, 6], 2161], 'its measure, step 11');
  r = run9(heard(free9(), T, { k: 5, m: 2, s: 15, o: 3600 }), T, tp('stop'));
  r = run9(heard(r.state, r.mem, { k: 6, m: 3, s: 1, o: 240 }), r.mem, tp('stop'));
  assert.deepEqual([r.state.loc, C.payload(r.mem, r.state).from], [3, 241], 'the next measure heard after the press');
  r = run9(heard(free9(), T, { k: 5, m: 2, s: 7, o: 1680 }), T, tp('stop'), tp('back'), tp('stop'));
  assert.deepEqual([r.state.loc, C.payload(r.mem, r.state).from], [1, undefined], 'relocated: from its step 1');
  assert.equal(C.payload(D9, run9(S9(), D9, tp('stop')).state).from, undefined, 'synced: the project\'s ▶');
});

// review 1 F5: a synced CYCLE-off TRACK PLAY past its end is silent while the song plays — the panel showed it running (the
// chase frozen on its last step, the display on its last measure); now the last step heard marks the session ended until
// CYCLE on, a transport press or a step heard again
test('7c review 1 F5: a synced CYCLE-off TRACK PLAY past its end shows the machine stopped — no chase, the located measure — until CYCLE on, a transport press or a step heard again', () => {
  const T = mk9({ mode: 2, cyc: false }, { sync: true }, tk9(D9, 0, [3, 4]));
  let S = heard(play9(), T, { k: 4, m: 1, s: 14, o: 3360 });
  assert.deepEqual([C.leds(S, T).step[14], C.leds(S, T).disp], [1, '  2'], 'playing: the chase, measure 2');
  S = heard(S, T, { k: 4, m: 1, s: 15, o: 3600 });                       // (the plan's last step)
  let L = C.leds(S, T);
  assert.deepEqual([L.step[15], L.disp, S.end], [0, '  1', true], 'ended: no chase, the located measure');
  assert.equal(L.step[3], 2, 'the measure\'s key flashing, as stopped');
  let r = run9(S, T, tp('cyc'));
  assert.deepEqual([r.mem.ui.cyc, r.state.end, sends(r)], [true, false, ['now']], 'CYCLE on: running again');
  assert.equal(P(S, T, { k: 'transport', play: true }).state.end, false, 'a transport press');
  assert.equal(heard(S, T, { k: 3, m: 0, s: 0, o: 0 }).end, false, 'a step heard again (a re-anchor)');
  const Tc = mk9({ mode: 2, cyc: true }, { sync: true }, tk9(D9, 0, [3, 4]));
  assert.equal(heard(play9(), Tc, { k: 4, m: 1, s: 15, o: 3600 }).end, false, 'CYCLE on: never ended');
});

test('7c §3.3 PATTERN n, no SHIFT: PATTERN PLAY, group n — stopped at once (the selection\'s key kept); running PATTERN PLAY the next key picks its pattern there; from another mode the mode too; TRACK WRITE: the group of its next key', () => {
  let r = run9(S9(), mk9({ mode: 1, sel: 4 }), tp('pat', 3));
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.grp, r.mem.ui.sel, sends(r)], [0, 2, 4, ['now']]);
  assert.deepEqual(ks9(C.compilePlan(r.mem)), [36]);
  r = run9(S9(), mk9({ sel: 4 }), tp('pat', 2));
  assert.deepEqual([r.mem.ui.grp, sends(r)], [1, ['now']]);
  assert.deepEqual(run9(S9(), mk9({ grp: 1 }), tp('pat', 2)).all, []);
  r = run9(play9(), mk9({ sel: 4 }), tp('pat', 2));
  assert.deepEqual([r.mem.ui.grp, r.state.pg, r.all], [0, 1, []], 'running: nothing heard changes yet');
  r = run9(r.state, r.mem, kd(7));
  assert.deepEqual([r.mem.ui.grp, r.mem.ui.sel, r.state.pg, sends(r)], [1, 6, -1, ['bar']], 'the next key: its pattern in group 2, at the bar');
  r = run9(play9(), mk9({ mode: 2 }), tp('pat', 1));
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.grp, sends(r)], [0, 0, ['bar']]);
  r = run9(S9(), mk9({ mode: 3 }), tp('pat', 3));
  assert.deepEqual([r.mem.ui.mode, r.state.pg, r.all], [3, 2, []], 'TRACK WRITE: the next key\'s group');
  for (const n of [0, 4, undefined, 'x']) assert.deepEqual(run9(S9(), D9, tp('pat', n)).all, []);
});

test('7c §3.3 SHIFT + PATTERN n: PATTERN WRITE, group n; the sub-mode as left (STEP by default)', () => {
  let r = run9(S9(), mk9({ sel: 3 }), hd('shift'), tp('pat', 2), hu('shift'));
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.grp, r.mem.ui.wm, sends(r)], [1, 1, 0, ['now']]);
  assert.deepEqual(ks9(C.compilePlan(r.mem)), [19]);
  r = run9(play9(), mk9({ wm: 1 }), hd('shift'), tp('pat', 1));
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.wm, sends(r)], [1, 1, ['bar']], 'TAP stays TAP');
  assert.deepEqual(run9(S9(), mk9({ mode: 1, grp: 1 }), hd('shift'), tp('pat', 2)).all, [], 'already there');
});

test('7c §3.3 SHIFT + TEMPO (STEP) / SHIFT + BACK (TAP): the write sub-mode (PATTERN WRITE re-sends: the guide is TAP write\'s)', () => {
  let r = run9(S9(), mk9({ mode: 1 }), hd('shift'), tp('back'));
  assert.deepEqual([r.mem.ui.wm, sends(r), r.state.hold.shift], [1, ['now'], true]);
  r = run9(r.state, r.mem, hd('tkey'));
  assert.deepEqual([r.mem.ui.wm, r.state.hold.tkey, sends(r)], [0, false, ['now']], 'SHIFT + TEMPO: STEP, the TEMPO key not held');
  r = run9(S9(), mk9({ mode: 0 }), hd('shift'), tp('back'));
  assert.deepEqual([r.mem.ui.wm, r.all], [1, []], 'set in any mode, nothing to send');
  assert.deepEqual(run9(S9(), mk9({ mode: 2 }, {}, tk9(D9, 0, [1, 2])), tp('back')).mem.ui.wm, 0, 'BACK alone: the pointer');
});

test('7c §3.3 TRACK n, no SHIFT: TRACK PLAY, track n of the bank from its measure 1; TEMPO held: its stored tempo too (free its TEMPO, synced the project\'s — one tempo edit)', () => {
  const T = tk9(tk9(D9, 2, [1, 2], { tt: 97 }), 6, [4], { tt: 140 });
  let r = run9(S9({ loc: 3 }), T, tp('trk', 3));
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.trk, r.state.loc, sends(r), ks9(C.compilePlan(r.mem))], [2, 2, 0, ['now'], [1, 2]]);
  r = run9(S9(), mk9({ bank: 1 }, {}, T), tp('trk', 3));
  assert.deepEqual(ks9(C.compilePlan(r.mem)), [52], 'bank II\'s track 3');
  r = run9(S9(), mk9({}, { sync: false }, T), hd('tkey'), tp('trk', 3), hu('tkey'));
  assert.deepEqual([r.mem.ui.tempo, r.mem.ui.trk], [97, 2], 'free: its TEMPO');
  r = run9(play9(), T, hd('tkey'), tp('trk', 3));
  assert.deepEqual([r.mem.ui.tempo, r.all.filter(c => c.c === 'bpm')], [120, [{ c: 'bpm', v: 97 }]], 'synced: the project\'s');
  assert.deepEqual(run9(S9(), T, hd('tkey'), tp('trk', 2)).all.filter(c => c.c === 'bpm'), [], 'no stored tempo: none');
  assert.deepEqual(run9(S9(), mk9({ mode: 2, trk: 2 }, {}, T), tp('trk', 3)).all, [], 'already there');
});

test('7c §3.3 SHIFT + TRACK n: TRACK WRITE, track n, the pointer at its measure 1', () => {
  const T = tk9(D9, 1, [1, 2, 3]);
  const r = run9(S9({ ptr: 2 }), T, hd('shift'), tp('trk', 2), hu('shift'));
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.trk, r.state.ptr, r.state.pend, sends(r)], [3, 1, 0, null, ['now']]);
  assert.deepEqual(ks9(C.compilePlan(r.mem, undefined, undefined, r.state)), [1], 'the pointer\'s measure heard');
});

test('7c §3.3 SHIFT + FWD / SHIFT + AVAILABLE MEAS: bank I / II, from a track mode only (the pointer back to measure 1)', () => {
  const T = tk9(tk9(mk9({ mode: 2 }), 0, [1]), 4, [2]);
  let r = run9(S9({ loc: 0 }), T, hd('shift'), hd('avail'), hu('avail'), hu('shift'));
  assert.deepEqual([r.mem.ui.bank, sends(r), ks9(C.compilePlan(r.mem)), r.state.hold.avail], [1, ['now'], [50], false]);
  r = run9(S9({ ptr: 1 }), mk9({ mode: 3 }, {}, r.mem), hd('shift'), tp('fwd'));
  assert.deepEqual([r.mem.ui.bank, r.state.ptr, sends(r)], [0, 0, ['now']]);
  for (const mode of [0, 1]) {
    assert.deepEqual(run9(S9(), mk9({ mode }), hd('shift'), hd('avail')).mem.ui.bank, 0, 'a pattern mode: nothing');
    assert.deepEqual(run9(S9(), mk9({ mode, bank: 1 }), hd('shift'), tp('fwd')).all, []);
  }
});

test('7c §3.3 key, PATTERN PLAY: selects pattern bank · 48 + group · 16 + n − 1 (running: queued to the end of the measure); a second key down while the first is held: block play, in order, looping (Shift-click: with the selection); a chain counts as one pattern', () => {
  let r = run9(S9(), mk9({ bank: 1, grp: 2 }), kd(5));
  assert.deepEqual([r.mem.ui.sel, r.mem.ui.bl, sends(r), ks9(C.compilePlan(r.mem))], [4, 0, ['now'], [84]]);
  r = run9(play9(), D9, kd(9));
  assert.deepEqual([r.mem.ui.sel, sends(r)], [8, ['bar']], 'running: at the bar');
  r = run9(S9(), D9, kd(9), kd(3));
  assert.deepEqual([r.mem.ui.sel, r.mem.ui.bl, ks9(C.compilePlan(r.mem))], [2, 6, [2, 3, 4, 5, 6, 7, 8]], 'any two keys of the group: the range in order');
  r = run9(r.state, r.mem, ku(9), ku(3), kd(12));
  assert.deepEqual([r.mem.ui.sel, r.mem.ui.bl], [11, 0], 'released: a single key again');
  r = run9(S9(), mk9({ sel: 3 }), kd(6, { shift: true }));
  assert.deepEqual([r.mem.ui.sel, r.mem.ui.bl], [3, 2], 'Shift-click: a block from the selection');
  const d = clone(D9); d.keys[6].ch = 1; const Ch = C.normDrum(d, 'tr909');
  assert.deepEqual(ks9(C.compilePlan(run9(S9(), Ch, kd(8)).mem)), [6, 7], 'a key inside a chain: the chain from its first');
  assert.deepEqual(ks9(C.compilePlan(run9(S9(), Ch, kd(6), kd(9)).mem)), [5, 6, 7, 8], 'a block: each chain once');
  assert.deepEqual(run9(S9(), D9, kd(1)).all, [], 'the selection already');
});

test('7c §3.3 key, PATTERN WRITE / STEP, stopped: selects the pattern to edit (a second key while one is held selects nothing: a chain\'s range)', () => {
  let r = run9(S9(), mk9({ mode: 1, grp: 1 }), kd(7));
  assert.deepEqual([r.mem.ui.sel, sends(r), ks9(C.compilePlan(r.mem))], [6, ['now'], [22]]);
  r = run9(r.state, r.mem, kd(9));
  assert.deepEqual([r.mem.ui.sel, r.all, r.state.keys], [6, [], [7, 9]]);
});

test('7c §3.3 key, PATTERN WRITE / STEP, running: the selected instrument\'s step n — off → normal → accented → off (BD SD LT MT HT CH), off ↔ on (the others, TOTAL ACCENT); flam write off ↔ flam (replacing a plain one and back); past LAST STEP nothing', () => {
  const W = (inst, fw, o) => mk9({ mode: 1, sel: 2, inst, fw }, {}, o || D9);
  let r = run9(play9(), W(1, false), kd(5));
  assert.deepEqual([lane9(r.mem, 2, 'BD').slice(0, 6), sends(r)], ['....x.', ['now']]);
  r = run9(r.state, r.mem, ku(5), kd(5)); assert.equal(lane9(r.mem, 2, 'BD').slice(0, 6), '....X.');
  r = run9(r.state, r.mem, ku(5), kd(5)); assert.equal(lane9(r.mem, 2, 'BD').slice(0, 6), '......', 'accented → off');
  for (const code of ['SD', 'LT', 'MT', 'HT', 'CH']) {
    const l = C.LANES909[C.CODES909.indexOf(code)];
    const q = run9(play9(), W(l, false), kd(1), ku(1), kd(1));
    assert.equal(lane9(q.mem, 2, code)[0], 'X', code);
  }
  for (const code of ['RS', 'HC', 'OH', 'CR', 'RD', 'AC']) {
    const l = C.LANES909[C.CODES909.indexOf(code)];
    let q = run9(play9(), W(l, false), kd(16));
    assert.equal(lane9(q.mem, 2, code)[15], 'x', code + ' on');
    q = run9(q.state, q.mem, ku(16), kd(16));
    assert.equal(lane9(q.mem, 2, code)[15], '.', code + ' off');
  }
  // flam write: off ↔ flam; a flam replaces a plain one (its accent kept), a plain write replaces a flam
  r = run9(play9(), W(2, true, pat9(D9, 2, { sd: 'x.X.' })), kd(1), ku(1), kd(3), ku(3), kd(5));
  assert.equal(lane9(r.mem, 2, 'SD').slice(0, 6), 'f.F.f.');
  r = run9(r.state, r.mem, ku(5), kd(5));
  assert.equal(lane9(r.mem, 2, 'SD').slice(0, 6), 'f.F...', 'flam → off');
  r = run9(r.state, mk9({ fw: false }, {}, r.mem), kd(1), ku(1), kd(3));
  assert.equal(lane9(r.mem, 2, 'SD').slice(0, 6), 'X.....', 'a plain write: normal flam → accented, accented flam → off');
  // past LAST STEP: nothing
  assert.deepEqual(run9(play9(), W(1, false, pat9(D9, 2, {}, { l1: 12 })), kd(13)).all, []);
  // the payload follows at once (the same shape)
  assert.equal(C.payload(r.mem, r.state).plan.shape, C.payload(W(2, false), r.state).plan.shape);
});

test('7c §3.3 INSTRUMENT SELECT held + key(s): keys 1 / 2 BD … 9 / 10 HT, 11 RS, 12 HC, 13 / 14 CH, 15 CRASH, 16 RIDE; both keys of a pair flam write (BD … HT), 13 + 14 the open hat; + ENTER TOTAL ACCENT; one key of the flam pair again leaves flam write; nothing sent', () => {
  const want = ['BD', 'BD', 'SD', 'SD', 'LT', 'LT', 'MT', 'MT', 'HT', 'HT', 'RS', 'HC', 'CH', 'CH', 'CR', 'RD'];
  for (let n = 1; n <= 16; n++) {
    const r = run9(S9(), mk9({ inst: 0 }), hd('isel'), kd(n), ku(n), hu('isel'));
    assert.deepEqual([C.CODES909[C.LANES909.indexOf(r.mem.ui.inst)], r.mem.ui.fw, r.all], [want[n - 1], false, []], 'key ' + n);
  }
  let r = run9(S9(), D9, hd('isel'), kd(3), kd(4));
  assert.deepEqual([r.mem.ui.inst, r.mem.ui.fw], [2, true], 'SD flam write');
  r = run9(r.state, r.mem, ku(3), ku(4), kd(4));
  assert.deepEqual([r.mem.ui.inst, r.mem.ui.fw], [2, false], 'one key again: flam write left');
  r = run9(S9(), D9, hd('isel'), kd(14), kd(13));
  assert.deepEqual([r.mem.ui.inst, r.mem.ui.fw], [10, false], '13 + 14: OH');
  r = run9(S9(), D9, hd('isel'), kd(10, { shift: true }));
  assert.deepEqual([r.mem.ui.inst, r.mem.ui.fw], [5, true], 'Shift-click: the pair');
  r = run9(S9(), D9, hd('isel'), kd(1), kd(5));
  assert.deepEqual([r.mem.ui.inst, r.mem.ui.fw], [3, false], 'two keys of different pairs: the last');
  r = run9(S9(), mk9({ inst: 3, fw: true }), hd('isel'), tp('enter'), hu('isel'));
  assert.deepEqual([r.mem.ui.inst, r.mem.ui.fw, r.all], [0, false, []], '+ ENTER: TOTAL ACCENT');
});

test('7c §3.3 key, PATTERN WRITE / TAP: a drum pad — its voice at its state\'s velocity (the left key of a pair accented 110, the right normal 100) through { c: \'hit\' }, its up an off; running also written at the nearest step of the edited pattern; 13 + 14 the open hat, the closed hat the first wrote taken back (review #19)', () => {
  const W = mk9({ mode: 1, wm: 1, sel: 0 });
  let r = run9(S9(), W, kd(1));
  assert.deepEqual(r.all, [{ c: 'hit', sound: 0, v: 110 }], 'stopped: played, not written');
  assert.equal(r.mem, W);
  r = run9(r.state, r.mem, ku(1));
  assert.deepEqual(r.all, [{ c: 'hit', sound: 0, off: true }]);
  const vs = [];
  for (let n = 1; n <= 16; n++) { const q = run9(S9(), W, kd(n)).all[0]; vs.push([q.sound, q.v]); }
  assert.deepEqual(vs, [[0, 110], [0, 100], [1, 110], [1, 100], [2, 110], [2, 100], [3, 110], [3, 100], [4, 110], [4, 100], [5, 100], [6, 100], [10, 110], [10, 100], [8, 100], [7, 100]]);
  // running: written at the nearest step (more than half the step passed: the next), accented by the left key
  let S = heard(play9(), W, { k: 0, m: 0, s: 4 });
  r = run9(S, W, kd(3, { f: 0.2 }), ku(3), kd(6, { f: 0.7 }), ku(6), kd(16, { f: 0.1 }));
  assert.deepEqual([lane9(r.mem, 0, 'SD').slice(0, 8), lane9(r.mem, 0, 'LT').slice(0, 8), lane9(r.mem, 0, 'RD').slice(0, 8)], ['....X...', '.....x..', '....x...']);
  assert.deepEqual(sends(r), ['now', 'now', 'now']);
  r = run9(heard(play9(), W, { k: 0, m: 0, s: 15 }), W, kd(2, { f: 0.9 }));
  assert.equal(lane9(r.mem, 0, 'BD')[0], 'x', 'the last step\'s second half: the next measure\'s step 1');
  assert.deepEqual(run9(heard(play9(), W, { k: 7, m: 0, s: 2 }), W, kd(1, { f: 0 })).all.filter(c => c.c === 'send'), [], 'another pattern heard: played only');
  // 13 then 14: an accented CH written and heard, then the OH replaces it on that step
  S = heard(play9(), pat9(W, 0, { ch: '..x.' }), { k: 0, m: 0, s: 2 });
  r = run9(S, pat9(W, 0, { ch: '..x.' }), kd(13, { f: 0.1 }));
  assert.deepEqual([lane9(r.mem, 0, 'CH').slice(0, 4), r.all[0]], ['..X.', { c: 'hit', sound: 10, v: 110 }]);
  r = run9(r.state, r.mem, kd(14, { f: 0.9 }));
  assert.deepEqual([lane9(r.mem, 0, 'CH').slice(0, 4), lane9(r.mem, 0, 'OH').slice(0, 4), r.all[0]], ['..x.', '..x.', { c: 'hit', sound: 9, v: 100 }], 'the CH back as it was, the OH on its step');
  r = run9(r.state, r.mem, ku(13), ku(14));
  assert.deepEqual(r.all, [{ c: 'hit', sound: 10, off: true }, { c: 'hit', sound: 9, off: true }]);
  r = run9(S9(), W, kd(14), kd(13));
  assert.deepEqual(r.all.map(c => c.sound), [10, 9], 'stopped: the CH, then the OH');
});

test('7c §3.3 CLEAR + a voice key, TAP write, running: that voice\'s steps erased as they pass while both are held (at the heard post); nothing played', () => {
  const W = pat9(mk9({ mode: 1, wm: 1 }), 0, { bd: 'x.X.F.x.', sd: 'xxxx', ch: 'x.x.', oh: '.x.x' });
  let r = run9(play9(), W, hd('clear'), kd(1));
  assert.deepEqual([r.all, r.state.erase], [[], b9('BD')]);
  let S = r.state, D = r.mem;
  for (const s of [0, 1, 2, 3]) { const q = P(S, D, { k: 'heard', post: { s, m: 0, k: 0, o: s * 240, M: 0 } }); S = q.state; D = q.mem; }
  assert.deepEqual([lane9(D, 0, 'BD').slice(0, 8), lane9(D, 0, 'SD').slice(0, 4)], ['....F.x.', 'xxxx'], 'BD gone where heard, SD kept');
  r = run9(S, D, ku(1));
  assert.equal(r.state.erase, 0, 'the key let go: no more');
  r = run9(r.state, r.mem, kd(13), kd(14));
  assert.equal(r.state.erase, b9('CH') | b9('OH'), '13 + 14: the hats');
  r = run9(r.state, r.mem, hu('clear'));
  assert.equal(r.state.erase, 0);
  assert.equal(run9(S9(), W, hd('clear'), kd(1)).state.erase, 0, 'stopped: nothing');
});

test('7c §3.3 CLEAR + key, PATTERN WRITE, stopped: that pattern cleared — steps, accents, flams, SCALE / LAST STEP / SHUFFLE / FLAM, out of its chain; "Pattern I-2-5 cleared · tap to undo" (one level); either order', () => {
  const d = clone(pat9(mk9({ mode: 1, grp: 1 }), 20, { bd: 'X.f', sd: 'x' }, { sc: 2, l1: 9, sh: 5, fl: 14, ch: 1 })); d.keys[19].ch = 1;
  const D = C.normDrum(d, 'tr909');
  let r = run9(S9(), D, hd('clear'), kd(5), ku(5), hu('clear'));
  assert.deepEqual([r.mem.st[20], r.mem.ac[20], r.mem.fm[20]], [new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)]);
  assert.deepEqual([r.mem.keys[20], r.mem.keys[19].ch], [{ sc: 1, l1: 16, sh: 1, fl: 9, ch: 0 }, 0], 'out of its chain');
  assert.deepEqual(r.all, [{ c: 'send', at: 'now' }, { c: 'notice', text: 'Pattern I-2-5 cleared · tap to undo', undo: true }]);
  const u = run9(r.state, r.mem, { k: 'undo' });
  assert.deepEqual([u.mem.st[20], u.mem.keys[20], u.mem.keys[19], sends(u)], [D.st[20], D.keys[20], D.keys[19], ['now']]);
  r = run9(S9(), D, kd(5), kd(6), hd('clear'));
  assert.deepEqual([r.all.at(-1).text, r.mem.keys[20].ch], ['Patterns I-2-5 and I-2-6 cleared · tap to undo', 0], 'the keys held first, then CLEAR');
  assert.deepEqual(run9(play9(), mk9({ mode: 1, wm: 0 }, {}, D), hd('clear'), kd(5)).all, [], 'running STEP write: nothing');
  assert.deepEqual(run9(S9(), mk9({ mode: 0 }, {}, D), hd('clear'), kd(5)).mem.st[20], D.st[20], 'PATTERN PLAY: no clear');
});

test('7c §3.3 LAST STEP + key (PATTERN WRITE): the edited pattern\'s LAST STEP — \'bar\' when it shortens the bar under the playhead, else \'now\'', () => {
  let r = run9(play9(), mk9({ mode: 1, sel: 2 }), hd('last'), kd(12), hu('last'));
  assert.deepEqual([r.mem.keys[2].l1, sends(r)], [12, ['bar']]);
  r = run9(r.state, r.mem, hd('last'), kd(14));
  assert.deepEqual([r.mem.keys[2].l1, sends(r)], [14, ['now']]);
  r = run9(S9(), mk9({ mode: 1, sel: 2 }), hd('last'), kd(7));
  assert.deepEqual([r.mem.keys[2].l1, sends(r)], [7, ['now']], 'stopped');
  assert.deepEqual(run9(S9(), mk9({ mode: 0 }), hd('last'), kd(7)).mem.keys[0].l1, 16, 'PATTERN PLAY: nothing');
  assert.deepEqual(run9(S9(), mk9({ mode: 1 }), hd('last'), kd(16)).all, [], 'the same: nothing');
});

test('7c §3.3 SCALE (PATTERN WRITE, running): the edited pattern\'s next scale 16 → 32 → 8T → 16T → 16, LAST STEP 16 / 16 / 12 / 12; elsewhere nothing', () => {
  let r = run9(play9(), mk9({ mode: 1, sel: 1 }), tp('scale'));
  const seq = [[r.mem.keys[1].sc, r.mem.keys[1].l1]];
  for (let j = 0; j < 4; j++) { r = run9(r.state, r.mem, tp('scale')); seq.push([r.mem.keys[1].sc, r.mem.keys[1].l1]); }
  assert.deepEqual(seq, [[2, 16], [3, 12], [4, 12], [1, 16], [2, 16]]);
  assert.deepEqual(sends(r), ['bar']);
  assert.deepEqual(run9(S9(), mk9({ mode: 1 }), tp('scale')).all, [], 'stopped');
  assert.deepEqual(run9(play9(), mk9({ mode: 0 }), tp('scale')).all, [], 'PATTERN PLAY');
});

test('7c §3.3 SHUFFLE/FLAM + key 1–7 / 9–16 (PATTERN WRITE, running): the edited pattern\'s SHUFFLE / FLAM spacing; key 8 nothing; stopped nothing (held alone: the LEDs, below)', () => {
  let r = run9(play9(), mk9({ mode: 1, sel: 3 }), hd('shuf'), kd(5), ku(5), kd(14), hu('shuf'));
  assert.deepEqual([r.mem.keys[3].sh, r.mem.keys[3].fl, sends(r)], [5, 14, ['now', 'now']]);
  assert.deepEqual(run9(r.state, r.mem, hd('shuf'), kd(8)).all, []);
  assert.deepEqual(run9(r.state, r.mem, hd('shuf'), kd(5)).all, [], 'the same: nothing');
  assert.deepEqual(run9(S9(), mk9({ mode: 1 }), hd('shuf'), kd(5)).all, [], 'stopped');
  assert.equal(C.payload(r.mem, r.state).plan.mSh[0], 80);
});

test('7c §3.3 chain (PATTERN WRITE, stopped): two keys + ENTER chain the range (ch on each but the last; a chain into its first broken); a key held + ENTER takes it out of its chain', () => {
  let r = run9(S9(), mk9({ mode: 1, grp: 1 }), kd(3), kd(6));
  r = run9(r.state, r.mem, tp('enter'), ku(3), ku(6));
  assert.deepEqual(r.mem.keys.slice(16, 24).map(k => k.ch), [0, 0, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(sends(r), ['now']);
  assert.deepEqual(ks9(C.compilePlan(mk9({ mode: 0, grp: 1, sel: 4 }, {}, r.mem))), [18, 19, 20, 21], 'a chain plays as one pattern');
  r = run9(S9(), r.mem, kd(5), tp('enter'));
  assert.deepEqual(r.mem.keys.slice(16, 24).map(k => k.ch), [0, 0, 1, 0, 0, 0, 0, 0], 'out of its chain: 3–4 and 6 left');
  assert.deepEqual(run9(S9(), r.mem, kd(1), tp('enter')).mem.keys, r.mem.keys, 'not in a chain: nothing');
  assert.deepEqual(run9(play9(), mk9({ mode: 1 }), kd(3), kd(6), tp('enter')).mem.keys[2].ch, 0, 'running: no chain');
});

test('7c §3.3 TRACK WRITE: a group key + a key → pend (heard from the next measure while running); ENTER writes pend (or the pointer\'s own pattern) at the pointer and advances — a chain as consecutive measures; at the bank\'s 896 the display shows 0, nothing written', () => {
  const d = clone(mk9({ mode: 3, trk: 1 })); d.keys[20].ch = 1; d.keys[21].ch = 1;
  let D = C.normDrum(d, 'tr909');
  let r = run9(play9(), D, tp('pat', 2), kd(5));
  assert.deepEqual([r.state.pend, sends(r), ks9(C.compilePlan(r.mem, undefined, undefined, r.state))], [{ g: 1, sel: 4, bl: 0 }, ['bar'], [20, 21, 22]]);
  r = run9(r.state, r.mem, tp('enter'));
  assert.deepEqual([r.mem.tk[1], r.state.ptr, sends(r)], [[20, 21, 22], 3, ['bar']], 'its chain, three measures');
  r = run9(r.state, r.mem, ku(5), kd(1), tp('enter'));
  assert.deepEqual([r.mem.tk[1], r.state.ptr], [[20, 21, 22, 16], 4], 'the group kept for the next key');
  r = run9(S9({ ptr: 1 }), r.mem, tp('enter'));
  assert.deepEqual([r.mem.tk[1], r.state.ptr], [[20, 21, 22, 16], 2], 'no pend: the pointer\'s own pattern, advancing');
  r = run9(S9(), r.mem, kd(2), kd(4), tp('enter'));
  assert.deepEqual([r.mem.tk[1], r.state.ptr], [[1, 2, 3, 16], 3], 'a range of keys: overwritten');
  assert.deepEqual(run9(S9({ ptr: 4 }), r.mem, tp('enter')).all, [], 'appending without a key: nothing');
  // bank I full: the 896 shared by its four tracks
  D = tk9(D, 0, new Array(895).fill(0));
  r = run9(S9(), D, kd(1), tp('enter'));
  assert.deepEqual([r.mem.tk[1], C.leds(r.state, r.mem).disp], [[0], '  2'], 'the last measure the bank had');
  r = run9(r.state, r.mem, tp('enter'));
  assert.deepEqual([r.mem.tk[1], r.state.disp, C.leds(r.state, r.mem).disp, sends(r)], [[0], 'full', '  0', []], 'full: nothing, 0 shown');
  r = run9(r.state, r.mem, tp('back'));
  assert.equal(C.leds(r.state, r.mem).disp, '  1', 'until the next press');
  r = run9(S9({ ptr: 0 }), r.mem, kd(3), tp('enter'));
  assert.deepEqual(r.mem.tk[1], [2], 'overwriting needs no room');
});

test('7c §3.3 BACK / FWD (track modes): TRACK WRITE\'s pointer −1 / +1 (0 … the track\'s length: appending), TRACK PLAY\'s located measure (stopped)', () => {
  const T = tk9(mk9({ mode: 3 }), 0, [4, 5, 6]);
  let r = run9(S9(), T, tp('fwd'), tp('fwd'), tp('fwd'), tp('fwd'));
  assert.equal(r.state.ptr, 3, 'up to appending');
  assert.deepEqual(ks9(C.compilePlan(r.mem, undefined, undefined, r.state)), []);
  r = run9(r.state, r.mem, tp('back'));
  assert.deepEqual([r.state.ptr, ks9(C.compilePlan(r.mem, undefined, undefined, r.state)), sends(r)], [2, [6], ['now']]);
  assert.deepEqual(run9(S9({ ptr: 0 }), T, tp('back')).all, [], 'at measure 1: nothing');
  assert.deepEqual(sends(run9(play9({ ptr: 1 }), T, tp('fwd'))), ['bar'], 'running: heard from the next measure');
  assert.deepEqual(run9(play9({ ptr: 1, pend: { g: 0, sel: 0, bl: 0 } }), T, tp('fwd')).all, [], 'pend heard: nothing to send');
  const TP = mk9({ mode: 2 }, { sync: false }, T);
  r = run9(S9(), TP, tp('fwd'), tp('fwd'), tp('fwd'));
  assert.deepEqual([r.state.loc, sends(r)], [2, ['now', 'now']], 'to the last measure');
  r = run9(r.state, r.mem, tp('stop'));
  assert.deepEqual(ks9(C.compilePlan(r.mem, undefined, undefined, r.state)), [6, 4, 5, 6], 'STOP/CONT starts there');
  assert.deepEqual(run9(free9({ loc: 1 }), TP, tp('fwd')).state.loc, 1, 'running: the plan never moves under it');
  assert.deepEqual(run9(S9(), mk9({ mode: 0 }, {}, T), tp('fwd'), tp('back')).all, [], 'a pattern mode: nothing');
});

test('7c §3.3 SHIFT + digits + ENTER (track modes): locate measure n — the keypad 1–9, 10 = 0, the last three digits; TRACK PLAY: loc, started by STOP/CONT; TRACK WRITE: the pointer', () => {
  const T = tk9(mk9({ mode: 3 }), 0, new Array(130).fill(2));
  let r = run9(S9(), T, hd('shift'), kd(1), kd(2), kd(10), hu('shift'));
  assert.deepEqual([r.state.dig, C.leds(r.state, r.mem).disp], ['120', '120'], 'as typed');
  r = run9(r.state, r.mem, tp('enter'));
  assert.deepEqual([r.state.ptr, r.state.dig, C.leds(r.state, r.mem).disp], [119, null, '120']);
  r = run9(S9(), T, hd('shift'), kd(9), kd(9), kd(9), kd(1), tp('enter'));
  assert.deepEqual([r.state.ptr], [130], 'past the end: appending');
  const TP = mk9({ mode: 2 }, { sync: false }, T);
  r = run9(S9(), TP, hd('shift'), kd(1), kd(5), tp('enter'), hu('shift'));
  assert.deepEqual([r.state.loc, sends(r), C.leds(r.state, r.mem).disp], [14, ['now'], ' 15']);
  r = run9(r.state, r.mem, tp('stop'));
  assert.deepEqual([r.state.run, C.compilePlan(r.mem, undefined, undefined, r.state).loopFrom], [true, 116]);
  assert.deepEqual(run9(S9(), mk9({ mode: 0 }), hd('shift'), kd(1), tp('enter')).state.dig, null, 'a pattern mode: no keypad');
});

test('7c §3.3 SHIFT + DEL / INS / COPY + … + ENTER (TRACK WRITE, stopped): delete measures ptr … n (LAST MEAS: to the end), insert pend (a key, its chain, a range) at ptr, copy measures a … b to ptr — later measures shift; each with the undo notice', () => {
  const T = tk9(mk9({ mode: 3 }), 0, [0, 1, 2, 3, 4, 5]);
  // DEL: ptr … n
  let r = run9(S9({ ptr: 1 }), T, hd('shift'), kd(13), kd(3), hu('shift'), tp('enter'));
  assert.deepEqual([r.mem.tk[0], r.state.ptr, r.state.op], [[0, 3, 4, 5], 1, null]);
  assert.deepEqual(r.all.slice(-2), [{ c: 'send', at: 'now' }, { c: 'notice', text: 'Measures 2–3 deleted · tap to undo', undo: true }]);
  assert.deepEqual(run9(r.state, r.mem, { k: 'undo' }).mem.tk[0], [0, 1, 2, 3, 4, 5]);
  r = run9(S9({ ptr: 4 }), T, hd('shift'), kd(13), tp('enter'));
  assert.deepEqual([r.mem.tk[0], r.all[1].text], [[0, 1, 2, 3, 5], 'Measure 5 deleted · tap to undo'], 'no number: the pointer\'s');
  r = run9(S9({ ptr: 2 }), T, hd('shift'), kd(13), tp('cyc'), tp('enter'));
  assert.deepEqual(r.mem.tk[0], [0, 1], 'LAST MEAS: to the end');
  // INS: pend at ptr
  const d = clone(T); d.keys[7].ch = 1; const Tc = C.normDrum(d, 'tr909');
  r = run9(S9({ ptr: 2 }), Tc, hd('shift'), kd(12), hu('shift'), tp('pat', 2), kd(8), tp('enter'));
  assert.deepEqual([r.mem.tk[0], r.all.at(-1).text], [[0, 1, 23, 2, 3, 4, 5], 'A measure inserted at 3 · tap to undo']);
  r = run9(S9({ ptr: 0 }), Tc, hd('shift'), kd(12), hu('shift'), kd(8), tp('enter'));
  assert.deepEqual([r.mem.tk[0], r.all.at(-1).text], [[7, 8, 0, 1, 2, 3, 4, 5], '2 measures inserted at 1 · tap to undo'], 'a chain whole');
  assert.deepEqual(run9(S9(), Tc, hd('shift'), kd(12), tp('enter')).mem.tk[0], Tc.tk[0], 'no key yet: nothing');
  // COPY: a, ENTER, b, ENTER → measures a … b copied to ptr
  r = run9(S9({ ptr: 6 }), T, hd('shift'), kd(11), kd(2), tp('enter'), kd(4), tp('enter'));
  assert.deepEqual([r.mem.tk[0], r.all.at(-1).text], [[0, 1, 2, 3, 4, 5, 1, 2, 3], 'Measures 2–4 copied to 7 · tap to undo']);
  r = run9(S9({ ptr: 0 }), T, hd('shift'), kd(11), kd(6), tp('enter'), tp('enter'));
  assert.deepEqual(r.mem.tk[0], [5, 0, 1, 2, 3, 4, 5], 'b none: a alone');
  // the bank's room
  const F = tk9(tk9(mk9({ mode: 3 }), 0, [0, 1]), 1, new Array(894).fill(0));
  r = run9(S9(), F, hd('shift'), kd(11), kd(1), tp('enter'), kd(2), tp('enter'));
  assert.deepEqual([r.mem.tk[0], C.leds(r.state, r.mem).disp], [[0, 1], '  0'], 'no room: nothing, 0 shown');
  // running, or in another mode: no track edits
  assert.deepEqual(run9(play9(), T, hd('shift'), kd(13)).state.op, null);
  assert.deepEqual(run9(S9(), mk9({ mode: 2 }, {}, T), hd('shift'), kd(13)).state.op, null);
});

test('7c §3.3 SHIFT + COPY + bank + group + key + ENTER (PATTERN WRITE, stopped): that pattern copied onto the edited one (steps, accents, flams, SCALE, LAST STEP, SHUFFLE, FLAM; its chain kept); the undo notice', () => {
  const Src = pat9(mk9({ mode: 1, bank: 0, grp: 0, sel: 2 }), 48 + 16 + 4, { bd: 'X.f', ch: 'xx' }, { sc: 2, l1: 9, sh: 4, fl: 15 });
  let r = run9(S9(), Src, hd('shift'), kd(11), hu('shift'), hd('avail'), tp('pat', 2), kd(5), tp('enter'));
  assert.deepEqual([lane9(r.mem, 2, 'BD').slice(0, 4), lane9(r.mem, 2, 'CH').slice(0, 4), r.mem.keys[2]], ['X.f.', 'xx..', { sc: 2, l1: 9, sh: 4, fl: 15, ch: 0 }]);
  assert.deepEqual(r.all.at(-1), { c: 'notice', text: 'Pattern II-2-5 copied to I-1-3 · tap to undo', undo: true });
  assert.equal(run9(r.state, r.mem, { k: 'undo' }).mem.st[2].every(m => !m), true);
  r = run9(S9(), Src, hd('shift'), kd(11), tp('fwd'), tp('pat', 1), kd(3), tp('enter'));
  assert.deepEqual([r.mem, r.state.op], [Src, null], 'onto itself: nothing');
  assert.deepEqual(run9(S9(), Src, hd('shift'), kd(11), tp('enter')).mem, Src, 'no key: nothing');
  assert.equal(run9(play9(), Src, hd('shift'), kd(11)).state.op, null, 'running: no copy');
});

test('7c §3.3 SHIFT + LAST MEAS + ENTER (TRACK WRITE): the pointer to the end (appending)', () => {
  const T = tk9(mk9({ mode: 3 }), 0, [0, 1, 2]);
  let r = run9(S9(), T, hd('shift'), tp('cyc'), hu('shift'));
  assert.deepEqual([r.state.op, r.state.ptr], [{ k: 'last' }, 0]);
  r = run9(r.state, r.mem, tp('enter'));
  assert.deepEqual([r.state.ptr, r.state.op, C.leds(r.state, r.mem).disp], [3, null, '  4']);
  assert.deepEqual(run9(S9(), mk9({ mode: 2 }, {}, T), hd('shift'), tp('cyc')).state.op, null, 'TRACK PLAY: nothing');
});

test('7c §3.3 CYCLE/GUIDE: TRACK PLAY CYCLE on / off (the plan\'s once, sent \'now\'); TAP write the guide click on / off; elsewhere nothing', () => {
  const T = tk9(mk9({ mode: 2 }), 0, [0, 1]);
  let r = run9(play9(), T, tp('cyc'));
  assert.deepEqual([r.mem.ui.cyc, sends(r), C.payload(r.mem, r.state).plan.once], [false, ['now'], 1]);
  r = run9(r.state, r.mem, tp('cyc'));
  assert.deepEqual([r.mem.ui.cyc, C.payload(r.mem, r.state).plan.once], [true, 0]);
  r = run9(play9(), mk9({ mode: 1, wm: 1 }), tp('cyc'));
  assert.deepEqual([r.mem.ui.guide, sends(r), C.payload(r.mem, r.state).plan.guide], [true, ['now'], 1]);
  for (const ui of [{ mode: 1, wm: 0 }, { mode: 0 }, { mode: 3 }]) assert.deepEqual(run9(play9(), mk9(ui), tp('cyc')).all, [], JSON.stringify(ui));
  // free, CYCLE off: at the heard last step the session stops (the RUN state, the LEDs); a located start's pre-roll ends there too
  const F = mk9({ mode: 2, cyc: false }, { sync: false }, tk9(pat9(D9, 1, {}, { l1: 12 }), 0, [0, 1]));
  let q = run9(heard(free9(), F, { k: 1, m: 1, s: 10 }), F, { k: 'heard', post: { k: 1, m: 1, s: 11, o: 2640, M: 1 } });
  assert.deepEqual([q.state.run, sends(q), C.payload(q.mem, q.state).run], [false, ['now'], false]);
  q = run9(free9(), F, { k: 'heard', post: { k: 0, m: 0, s: 15, M: 0 } });
  assert.deepEqual([q.state.run, q.all], [true, []], 'not the last measure');
  q = run9(free9({ loc: 1 }), F, { k: 'heard', post: { k: 1, m: 0, s: 11, M: 0 } });
  assert.equal(q.state.run, false, 'from a located measure: the track\'s end is the pre-roll\'s');
  assert.deepEqual(run9(play9(), mk9({}, { sync: true }, F), { k: 'heard', post: { k: 1, m: 1, s: 11, M: 1 } }).all, [], 'synced: the song plays on, the machine silent (DrSeq)');
});

test('7c §3.3 TEMPO key: held the display shows the tempo; + ENTER stores it into the track; the knob at its minimum while held erases it', () => {
  const T = mk9({ mode: 2, trk: 1, tempo: 133 }, { sync: false });
  let r = run9(S9(), T, hd('tkey'));
  assert.deepEqual([C.leds(r.state, r.mem).disp, C.leds(r.state, r.mem).tkey], ['133', 1]);
  r = run9(r.state, r.mem, tp('enter'));
  assert.deepEqual([r.mem.tt[1], r.all], [133, []]);
  r = run9(r.state, r.mem, { k: 'tempo', v: 37 });
  assert.deepEqual([r.mem.tt[1], r.mem.ui.tempo], [0, 133], 'erased; the tempo not moved');
  r = run9(play9({ bpm: 141.4 }), mk9({ mode: 2, trk: 2 }), hd('tkey'), tp('enter'));
  assert.equal(r.mem.tt[2], 141, 'synced: the project\'s, whole');
  r = run9(S9(), T, hd('tkey'), { k: 'tempo', v: 90 });
  assert.deepEqual([r.mem.ui.tempo, r.mem.tt[1]], [90, 0], 'not at the minimum: the tempo');
  assert.equal(C.leds(run9(r.state, r.mem, hu('tkey')).state, r.mem).disp, '  0', 'released: the measure (an empty track)');
});

test('7c §3.3 AVAILABLE MEAS held: the display shows the bank\'s free measures', () => {
  const T = tk9(tk9(tk9(mk9({ mode: 3 }), 0, new Array(100).fill(0)), 3, [1, 2]), 4, [5]);
  assert.equal(C.leds(run9(S9(), T, hd('avail')).state, T).disp, '794');
  const r2 = run9(S9(), mk9({ bank: 1 }, {}, T), hd('avail'));
  assert.equal(C.leds(r2.state, r2.mem).disp, '895');
  assert.equal(C.leds(run9(S9(), T, hd('avail'), hu('avail')).state, T).disp, '  1');
});

test('7c §3.3 TEMPO knob: free the machine\'s tempo (whole BPM 37–290; the flams follow at once); synced the project\'s (a bpm command, the record unchanged)', () => {
  let r = run9(S9(), mk9({}, { sync: false }), { k: 'tempo', v: 97.6 });
  assert.deepEqual([r.mem.ui.tempo, sends(r), C.payload(r.mem, r.state).bpm], [98, ['now'], 98]);
  assert.deepEqual(run9(S9(), r.mem, { k: 'tempo', v: 98.2 }).all, [], 'the same whole BPM');
  assert.equal(run9(S9(), r.mem, { k: 'tempo', v: 900 }).mem.ui.tempo, 290);
  r = run9(S9(), D9, { k: 'tempo', v: 140.4 });
  assert.deepEqual([r.mem, r.all], [D9, [{ c: 'bpm', v: 140 }]]);
  assert.deepEqual(run9(S9(), D9, { k: 'tempo', v: 'x' }).all, []);
});

test('7c §3.3 EXT INST, TAPE SYNC (TEMPO MODE), CARTRIDGE, the MIDI channel keys: not emulated — nothing', () => {
  for (const i of [tp('ext'), tp('tape'), tp('cart'), tp('midi', 3), hd('ext'), { k: 'ext' }, { k: 'cartridge' }, { k: 'midi', n: 10 }, { k: 'link303' }]) {
    const r = P(play9(), D9, i);
    assert.deepEqual([r.mem === D9, r.cmds], [true, []], JSON.stringify(i));
  }
});

test('7c §3.3 extras: SYNC (a free run ends), mute / solo (12 lanes), REC pads (the state their velocity names), the grid (12 rows × 16, cycling as a step key; a long press the flam), MAP… / reset / SOUNDS… (its eleven), DEMO (ours, block-played, the undo; demoFree)', () => {
  let r = run9(free9(), mk9({}, { sync: false }), { k: 'sync', v: true });
  assert.deepEqual([r.mem.x.sync, r.state.run, sends(r)], [true, false, ['now']]);
  r = run9(play9(), D9, { k: 'mute', lane: 11 }, { k: 'solo', lane: 1 }, { k: 'mute', lane: 12 });
  assert.deepEqual([r.mem.x.mute, r.mem.x.solo, sends(r)], [b9('CH'), b9('BD'), ['now', 'now']]);
  assert.deepEqual(C.payload(r.mem, r.state).mute & (1 << 10), 1 << 10, 'the payload mutes the closed hat\'s sound (id 10)');
  // REC pads (PATTERN WRITE running): v → the state (≥ 110 per-voice, ≥ 119 total, 127 both)
  const W = mk9({ mode: 1, sel: 0 }, { rec: true }), S = heard(play9(), W, { k: 0, m: 0, s: 3 });
  const pad = (sound, v) => P(S, W, { k: 'pad', sound, f: 0.1, v }).mem;
  assert.deepEqual([lane9(pad(0, 100 / 127), 0, 'BD')[3], lane9(pad(0, 110 / 127), 0, 'BD')[3], lane9(pad(0, 1), 0, 'BD')[3], lane9(pad(0, 1), 0, 'AC')[3], lane9(pad(0, 120 / 127), 0, 'AC')[3]], ['x', 'X', 'X', 'x', 'x']);
  assert.deepEqual([lane9(pad(7, 1), 0, 'RD')[3], lane9(pad(8, 0.5), 0, 'CR')[3], lane9(pad(8, 110 / 127), 0, 'CR')[3]], ['x', 'x', 'x']);
  assert.deepEqual(P(S, W, { k: 'pad', sound: 11, f: 0, v: 1 }).cmds, [], 'a sound it lacks');
  assert.deepEqual(P(S, mk9({}, { rec: false }, W), { k: 'pad', sound: 0, f: 0, v: 1 }).cmds, []);
  // the grid: a cell cycles as its step key would; flam a long press (BD … HT)
  r = run9(S9(), mk9({ sel: 5, grp: 1 }), { k: 'grid', lane: 2, s: 15 }, { k: 'grid', lane: 2, s: 15 }, { k: 'grid', lane: 8, s: 0 }, { k: 'grid', lane: 3, s: 1, flam: true });
  assert.deepEqual([lane9(r.mem, 21, 'SD')[15], lane9(r.mem, 21, 'RD')[0], lane9(r.mem, 21, 'LT')[1]], ['X', 'x', 'f']);
  assert.deepEqual(run9(S9(), D9, { k: 'grid', lane: 6, s: 0, flam: true }).all, [], 'RS: no flam');
  assert.deepEqual(run9(S9(), D9, { k: 'grid', lane: 1, s: 16 }).all, [], '16 steps');
  assert.equal(C.gridPat(heard(play9(), D9, { k: 40 }), D9), 40);
  assert.equal(C.gridPat(S9({ ptr: 1 }), tk9(mk9({ mode: 3, bank: 1 }), 4, [3, 9])), 57);
  // MAP… / reset / SOUNDS…
  r = run9(S9(), D9, { k: 'map', sound: 'rd', notes: [59, 51, 49] });
  assert.deepEqual([r.mem.map.rd, r.mem.map.cr], [[59, 51, 49], [57]]);
  assert.deepEqual(run9(S9(), D9, { k: 'map', sound: 'cb', notes: [56] }).all, [], 'not its sound');
  assert.deepEqual(run9(S9(), D9, { k: 'map', sound: 'lc', notes: [64] }).all, []);
  assert.deepEqual(run9(S9(), r.mem, { k: 'mapReset' }).mem.map, D9.map);
  r = run9(S9(), D9, { k: 'smp', sound: 'cr', slot: { id: 'smp:00000000000000c1', name: 'Crash', on: true } });
  assert.deepEqual(r.mem.smp, { cr: { id: 'smp:00000000000000c1', name: 'Crash', on: true } });
  assert.deepEqual(run9(S9(), r.mem, { k: 'smp', sound: 'cr', slot: null }).mem.smp, {});
  assert.deepEqual(run9(S9(), D9, { k: 'smp', sound: 'cy', slot: { id: 'smp:00000000000000c1', name: 'x', on: true } }).all, []);
  // DEMO
  assert.equal(C.demoFree(D9), true);
  r = run9(S9(), mk9({ mode: 2, inst: 3, bank: 1 }), { k: 'demo' });
  assert.deepEqual([r.mem.ui.mode, r.mem.ui.bank, r.mem.ui.grp, r.mem.ui.sel, r.mem.ui.bl, ks9(C.compilePlan(r.mem)), C.demoFree(r.mem)], [0, 0, 0, 0, 1, [0, 1], false]);
  assert.deepEqual(r.all[1], { c: 'notice', text: 'Demo loaded into patterns I-1-1 and I-1-2 · tap to undo', undo: true });
  assert.deepEqual([r.mem.keys[0], r.mem.keys[1]], [{ sc: 1, l1: 16, sh: 3, fl: 11, ch: 0 }, { sc: 1, l1: 16, sh: 3, fl: 11, ch: 0 }]);
  assert.equal(lane9(r.mem, 1, 'SD')[12], 'f', 'a snare flam in the second'); assert.equal(lane9(r.mem, 0, 'CR')[0], 'x', 'a crash on step 1');
  assert.ok(r.mem.st[0].some(m => m & 1) && r.mem.ac[0].some(m => m) && r.mem.st[1].some(m => m & b9('RD')), 'total and per-voice accents, the ride');
  const u = run9(r.state, r.mem, { k: 'undo' });
  assert.deepEqual([C.demoFree(u.mem), u.mem.ui.mode, u.mem.ui.bank, u.mem.ui.inst], [true, 2, 1, 3]);
  assert.equal(C.demoFree(pat9(D9, 1, { rs: 'x' })), false);
});

test('7c §3.3 not covered: nothing (keys in TRACK PLAY, ups, junk, a hold twice, a tap unknown); release lets every hold go and does nothing (a cancelled hold)', () => {
  const T = tk9(mk9({ mode: 2 }), 0, [1]);
  const cases = [[play9(), T, kd(3)], [S9(), T, kd(3)], [S9(), D9, ku(4)], [S9(), D9, hu('shift')], [S9(), D9, hd('nope')], [S9(), D9, tp('nope')], [play9(), D9, { k: 'nope' }], [play9(), D9, null],
    [play9(), D9, kd(17)], [play9(), D9, kd(0)], [S9(), D9, { k: 'release' }], [S9(), D9, { k: 'transport', play: false }], [S9(), mk9({ mode: 3 }), tp('enter')]];
  for (const [S, D, i] of cases) { const r = P(S, D, i); assert.equal(r.mem, D, JSON.stringify(i)); assert.deepEqual(r.cmds, [], JSON.stringify(i)); }
  let r = run9(S9(), mk9({ mode: 3 }, {}, T), hd('shift'), kd(13), kd(4), hd('isel'), hd('clear'), kd(2), { k: 'release' });
  assert.deepEqual([r.state.hold, r.state.keys, r.state.dig, r.state.op, r.state.erase, r.all], [C.initState('tr909').hold, [], null, null, 0, []], 'a cancelled hold: nothing done');
  r = run9(S9(), D9, hd('shift'), hd('shift'));
  assert.deepEqual(r.state.hold.shift, true);
  assert.deepEqual(run9(play9(), D9, { k: 'panic' }).state.keys, []);
  assert.deepEqual(run9(free9(), mk9({}, { sync: false }), { k: 'panic' }).state.run, false);
});

test('7c press is pure: inputs never mutated; an unchanged record comes back as the same reference', () => {
  const D = pat9(tk9(mk9({ mode: 1 }), 0, [1, 2]), 0, { bd: 'X.f' }), S = play9(), Dj = JSON.stringify(D), Sj = JSON.stringify(S);
  for (const i of [kd(1), tp('scale'), hd('shuf'), tp('enter'), { k: 'grid', lane: 1, s: 0 }, { k: 'demo' }, tp('pat', 2)]) C.press(S, D, i);
  assert.equal(JSON.stringify(D), Dj); assert.equal(JSON.stringify(S), Sj);
  assert.equal(C.press(S, D, hd('isel')).mem, D);
});

test('7c §3.6 LEDs: STEP write running the voice\'s steps (dim 5 normal, bright accented; flam write the flams bright; the others bright), the playhead inverted (3 / 4); PATTERN / TRACK PLAY running the chase; stopped the selection flashing (a block\'s others, PATTERN WRITE\'s chain steady); SHUFFLE/FLAM held its values; INSTRUMENT SELECT held the voice\'s keys; TAP write the keys held', () => {
  const D = pat9(mk9({ mode: 1, sel: 1, inst: 1 }), 1, { bd: 'x.X.f.F.x', rs: 'x...x', ch: 'xX' }, { l1: 8, sh: 3, fl: 12 });
  let S = heard(play9(), D, { k: 1, m: 0, s: 2 });
  assert.deepEqual(lit(C.leds(S, D)), [[1, 5], [3, 4], [5, 5], [7, 1]], 'BD: dim normal, bright accented, the playhead on 3 (set: dark); past LAST STEP off');
  assert.deepEqual(lit(C.leds(heard(play9(), D, { k: 1, m: 0, s: 1 }), D)), [[1, 5], [2, 3], [3, 1], [5, 5], [7, 1]], 'the playhead on 2 (unset: lit)');
  const Fw = mk9({ inst: 1, fw: true }, {}, D);
  assert.deepEqual(lit(C.leds(S, Fw)), [[1, 5], [3, 4], [5, 1], [7, 1]], 'flam write: the flams bright, the plain steps dim');
  assert.deepEqual(lit(C.leds(S, mk9({ inst: 6 }, {}, D))), [[1, 1], [3, 3], [5, 1]], 'RS: on bright');
  assert.deepEqual(lit(C.leds(S, mk9({ inst: 11 }, {}, D))), [[1, 5], [2, 1], [3, 3]], 'CH: per-voice accent');
  assert.deepEqual(lit(C.leds(heard(play9(), D, { k: 1, m: 0, s: 2 }), mk9({ inst: 0 }, {}, D))), [[3, 3]], 'TOTAL ACCENT: none set');
  // the chase
  const PP = mk9({ mode: 0, sel: 1 }, {}, D);
  assert.deepEqual(lit(C.leds(heard(play9(), PP, { k: 1, m: 0, s: 6 }), PP)), [[7, 1]]);
  const TP = mk9({ mode: 2 }, {}, tk9(D, 0, [1, 1]));
  assert.deepEqual(lit(C.leds(heard(play9(), TP, { k: 1, m: 1, s: 0 }), TP)), [[1, 1]]);
  // stopped: the selection
  assert.deepEqual(lit(C.leds(S9(), mk9({ mode: 0, sel: 4, bl: 2 }, {}, D))), [[5, 2], [6, 1], [7, 1]]);
  const dc = clone(D); dc.keys[1].ch = 1; dc.keys[2].ch = 1;
  assert.deepEqual(lit(C.leds(S9(), C.normDrum(dc, 'tr909'))), [[2, 2], [3, 1], [4, 1]], 'PATTERN WRITE: the edited pattern\'s chain steady');
  assert.deepEqual(lit(C.leds(S9(), mk9({ mode: 3 }, {}, tk9(D, 0, [7, 9])))), [[8, 2]], 'a track stopped: the pointer\'s measure\'s key');
  assert.deepEqual(lit(C.leds(S9({ loc: 1 }), mk9({ mode: 2 }, {}, tk9(D, 0, [7, 9])))), [[10, 2]]);
  // SHUFFLE/FLAM held: its values' keys (SHUFFLE 3, FLAM 12)
  assert.deepEqual(lit(C.leds(run9(S, D, hd('shuf')).state, D)), [[3, 1], [12, 1]]);
  // INSTRUMENT SELECT held: the voice's keys (flam write and the open hat flashing)
  assert.deepEqual(lit(C.leds(run9(S, D, hd('isel')).state, D)), [[1, 1], [2, 1]]);
  assert.deepEqual(lit(C.leds(run9(S, Fw, hd('isel')).state, Fw)), [[1, 2], [2, 2]]);
  assert.deepEqual(lit(C.leds(run9(S, mk9({ inst: 10 }, {}, D), hd('isel')).state, D)), [[1, 1], [2, 1]], '(the record\'s inst read)');
  const OH = mk9({ inst: 10 }, {}, D);
  assert.deepEqual(lit(C.leds(run9(S, OH, hd('isel')).state, OH)), [[13, 2], [14, 2]]);
  const RD = mk9({ inst: 8 }, {}, D);
  assert.deepEqual(lit(C.leds(run9(S, RD, hd('isel')).state, RD)), [[16, 1]]);
  // TAP write: the chase and the keys held
  const T = mk9({ wm: 1 }, {}, D);
  assert.deepEqual(lit(C.leds(run9(heard(play9(), T, { k: 1, m: 0, s: 4 }), T, kd(9), kd(11)).state, T)), [[5, 1], [9, 1], [11, 1]]);
});

test('7c §3.6 the other LEDs: the scale rows (the pattern edited / heard / selected), TRACK 1–4 / PATTERN 1–3 (the mode\'s key, flashing in a write mode; a pending group flashing), TEMPO / BACK (the write sub-mode), FWD / AVAILABLE MEAS (the bank, track modes), CYCLE (TRACK PLAY) / GUIDE (TAP write), ENTER (TOTAL ACCENT selected; an ENTER awaited flashing)', () => {
  const D = pat9(pat9(mk9({ mode: 1, sel: 1, grp: 0 }), 1, { bd: 'x' }, { sc: 3 }), 5, { bd: 'x' }, { sc: 2 });
  let L = C.leds(S9(), D);
  assert.deepEqual([L.scl, L.pat, L.trk, L.tkey, L.back, L.fwd, L.avail, L.cyc, L.enter], [[0, 0, 1, 0], [2, 0, 0], [0, 0, 0, 0], 1, 0, 0, 0, 0, 0]);
  L = C.leds(heard(play9(), mk9({ mode: 0 }, {}, D), { k: 5, s: 0 }), mk9({ mode: 0 }, {}, D));
  assert.deepEqual([L.scl, L.pat, L.tkey], [[0, 1, 0, 0], [1, 0, 0], 0], 'PATTERN PLAY running: the heard pattern\'s scale');
  L = C.leds(S9({ pg: 2 }), mk9({ mode: 0 }, {}, D));
  assert.deepEqual(L.pat, [1, 0, 2], 'a pending group flashing');
  L = C.leds(S9(), mk9({ wm: 1, guide: true, inst: 0 }, {}, D));
  assert.deepEqual([L.tkey, L.back, L.cyc, L.enter], [0, 1, 1, 1]);
  const T = tk9(mk9({ mode: 2, trk: 2, cyc: true, bank: 1 }, {}, pat9(D, 53, { bd: 'x' }, { sc: 4 })), 6, [5]);
  L = C.leds(S9(), T);
  assert.deepEqual([L.trk, L.pat, L.fwd, L.avail, L.cyc, L.scl], [[0, 0, 1, 0], [0, 0, 0], 0, 1, 1, [0, 0, 0, 1]], 'TRACK PLAY, bank II: its measure\'s (II-1-6) scale');
  L = C.leds(S9(), mk9({ mode: 3, bank: 0, cyc: false }, {}, T));
  assert.deepEqual([L.trk, L.fwd, L.avail, L.cyc], [[0, 0, 2, 0], 1, 0, 0]);
  assert.equal(C.leds(S9({ pend: { g: 0, sel: 1, bl: 0 } }), mk9({ mode: 3 }, {}, T)).enter, 2, 'TRACK WRITE with a key chosen: ENTER awaited');
  assert.equal(C.leds(S9({ op: { k: 'last' } }), mk9({ mode: 3 }, {}, T)).enter, 2);
  assert.equal(C.leds(S9({ dig: '1' }), T).enter, 2);
  assert.equal(C.leds(run9(S9(), D, hd('avail')).state, D).avail, 1, 'held');
});

test('7c §3.6 the display (three characters): pattern modes the tempo (free its TEMPO, synced the project\'s rounded); track modes the measure (running TRACK PLAY the one heard — through a free pre-roll —, stopped the located / the pointer\'s); TEMPO held the tempo; AVAILABLE MEAS the free measures; SHIFT digits as typed; an empty TRACK PLAY track 0', () => {
  assert.equal(C.leds(S9(), mk9({ tempo: 97 }, { sync: false })).disp, ' 97');
  assert.equal(C.leds(S9({ bpm: 133.6 }), D9).disp, '134');
  assert.equal(C.leds(S9(), mk9({ mode: 2 })).disp, '  0', 'an empty track');
  const T = mk9({ mode: 2 }, { sync: false }, tk9(D9, 0, new Array(150).fill(3)));
  assert.equal(C.leds(S9({ loc: 120 }), T).disp, '121');
  assert.equal(C.leds(heard(free9({ loc: 120 }), T, { k: 3, m: 5, s: 0 }), T).disp, '126', 'the pre-roll: measure 121 + 5');
  assert.equal(C.leds(heard(free9({ loc: 120 }), T, { k: 3, m: 31, s: 0 }), T).disp, '  2', 'past the pre-roll: the cycle\'s measure 2');
  assert.equal(C.leds(heard(play9(), mk9({}, { sync: true }, T), { k: 3, m: 41, s: 0 }), mk9({}, { sync: true }, T)).disp, ' 42');
  assert.equal(C.leds(S9({ ptr: 9 }), mk9({ mode: 3 }, {}, T)).disp, ' 10');
  assert.equal(C.leds(run9(S9(), T, hd('tkey')).state, T).disp, '120');
  assert.equal(C.leds(run9(S9(), T, hd('avail')).state, T).disp, '746');
  assert.equal(C.leds(run9(S9(), T, hd('shift'), kd(4), kd(10)).state, T).disp, ' 40');
  assert.equal(C.leds(run9(S9(), T, hd('shift'), kd(4), kd(10), kd(10), kd(2)).state, T).disp, '002', 'the last three typed');
});

test('7c rollPlan / rollOpts → toNotes (§4, §10): the 808\'s and 606\'s exactly today\'s call (compilePlan(D, D.ui, D.x); { swing, sw, prim }); the 909\'s synced plan at the project\'s tempo — each hit at its shuffled whole tick, a flam\'s two notes (the first ending where the second starts), the velocity of its state (100 / 110 / 119 / 127)', () => {
  // the 808 / 606: byte-identical to the call main.js makes today
  for (const [D, dev] of [[mk({ mode: 4, inst: 0 }, { swing: 62 }, withPat(DEF, 0, 0, row({ ac: 'x...x', bd: 'x.x.x', lt: '..x', cp: 'x' }))), { model: 'tr808', vals: { lts: 1, cps: 0 } }],
    [pat6(mk6({ sel: 0 }, { swing: 58 }), 0, { bd: 'x.x.x', ac: 'x', ht: '...x' }), { model: 'tr606', vals: {} }]]) {
    const today = C.toNotes(C.compilePlan(D, D.ui, D.x), { t0: 960, t1: 30000, swing: D.x.swing, sw: dev.vals, prim: C.primaries(D.map, dev.model) });
    assert.deepEqual(C.toNotes(C.rollPlan(D, 97), { t0: 960, t1: 30000, ...C.rollOpts(D, dev) }), today);
    assert.equal(C.rollPlan(D, 97), C.compilePlan(D, D.ui, D.x));
    assert.deepEqual(Object.keys(C.rollOpts(D, dev)), ['swing', 'sw', 'prim']);
  }
  // the 909: SHUFFLE 4 (60 ticks on the even-numbered 16ths), a flam on SD at 120 BPM (22 ms → 42 ticks), the four states
  const D = pat9(mk9({ sel: 0 }, { sync: false }), 0, { ac: '..x.x', bd: 'X.x.X.....', sd: '...f', ch: 'x.xX', rd: '..x.x' }, { sh: 4, fl: 12 });
  const p = C.rollPlan(D, 120), o = C.rollOpts(D, { model: 'tr909', vals: { ac: 0.3 } });
  assert.deepEqual(Object.keys(o), ['prim']);
  assert.equal(p.mFl[0], 42); assert.equal(p.mSh[0], 60);
  const N = C.toNotes(p, { t0: 0, t1: 3840, ...o });
  assert.deepEqual(N.map(x => [x.t, x.n, x.v, x.d]), [
    [0, 36, 110, 120], [0, 42, 100, 120],                                       // step 1: BD per-voice, CH normal
    [480, 36, 119, 120], [480, 42, 119, 120], [480, 51, 127, 120],             // step 3 total: BD total, CH total, the ride (no per-voice: 127)
    [780, 38, 100, 42], [780, 42, 110, 120], [822, 38, 100, 78],               // step 4 (+60): SD flam's two notes (the second ending with the step's others, 900), CH per-voice
    [960, 36, 127, 120], [960, 51, 127, 120],                                  // step 5 total: BD both (127), the ride
    [3840 - 3840, 36, 110, 120]].slice(0, 10));
  assert.ok(N.every(x => x.t < 3840));
  // the project's tempo moves the flams' ticks (synced: the sequencer's), the plan synced whatever the record says
  assert.equal(C.rollPlan(D, 97).mFl[0], Math.round(22 * 97 * 960 / 60000));
  assert.equal(C.rollPlan(mk9({ mode: 2 }, { sync: false }, tk9(D, 0, [0, 0])), 120).loopFrom, 0, 'no free pre-roll');
});

// review 1 F2: a synced TRACK WRITE plays the session's pointer / chosen key (the 909's ptr / pend, the 606's bar / twSel) and a
// 606's TRACK PLAY its D.S. — the bounce's offline session and → Piano roll took a fresh one (the track's first measure)
test('7c review 1 F2: planSess(D, S) — the session fields a synced plan reads (the 909: ptr, pend; the 606: TRACK WRITE\'s bar, twSel, ds; the 808: none) — into rollPlan(D, bpm, S) and an offline session: the measure heard, not the track\'s first; the 808\'s byte-identical', () => {
  // the 909: track 1 = [I-1-1 (a kick), I-1-2 (a snare)], TRACK WRITE synced
  const D = tk9(pat9(pat9(mk9({ mode: 3 }, { sync: true }), 0, { bd: 'x' }), 1, { sd: 'x' }), 0, [0, 1]), o = C.rollOpts(D);
  for (const [S, k, n] of [[S9({ ptr: 1 }), 1, 38], [S9({ ptr: 0, pend: { g: 0, sel: 1, bl: 0 } }), 1, 38], [S9({ ptr: 0 }), 0, 36]]) {
    const live = C.payload(D, S, 'now');
    assert.deepEqual(arr(live.plan.mKey), [k]);
    const off = C.payload(D, Object.assign(C.initState('tr909'), { bpm: 120 }, C.planSess(D, S)), 'now');
    assert.deepEqual([off.plan.key, off.pk], [live.plan.key, live.pk], 'the offline payload = the live one');
    assert.deepEqual(C.toNotes(C.rollPlan(D, 120, S), { t0: 0, t1: 3840, ...o }).map(x => x.n), [n], '→ Piano roll: the measure heard');
  }
  assert.deepEqual(Object.keys(C.planSess(D, S9({ ptr: 1, loc: 3, run: true, pend: null }))).sort(), ['pend', 'ptr'], 'never run or loc (a free run is not bounced)');
  assert.equal(C.planSess(D, null), null);
  // the 606: TRACK WRITE — the bar pointer, the key / chain heard; TRACK PLAY — its D.S. (synced: never a located pre-roll)
  let D6t = pat6(pat6(D6, 18, { bd: 'x' }), 21, { sd: 'x' }, { l1: 8 });
  D6t = trk6(mk6({ mode: 1, inst: 2 }, {}, D6t), 2, [2, 5, -1, 2, 5, 5], { tg: 1 });
  const W = mk6({ mode: 0 }, {}, D6t);
  assert.deepEqual(keysOf(C.rollPlan(W, 120, S6({ bar: 129 }))), [21]);
  assert.deepEqual(keysOf(C.rollPlan(W, 120, S6({ bar: 129, twSel: { sel: 4, cl: 3 } }))), [20, 21, 22, 23]);
  assert.deepEqual(keysOf(C.rollPlan(W, 120)), [18], 'no session: bar 1, as before');
  const Sw = S6({ bar: 129, twSel: { sel: 4, cl: 3 } }), lw = C.payload(W, Sw, 'now'), ow = C.payload(W, Object.assign(C.initState('tr606'), { bpm: 120 }, C.planSess(W, Sw)), 'now');
  assert.deepEqual([ow.plan.key, ow.pk], [lw.plan.key, lw.pk], 'the 606\'s offline payload = the live one');
  assert.equal(C.rollPlan(D6t, 120, S6({ ds: 1 })).key, C.compilePlan(D6t, D6t.ui, D6t.x, S6({ ds: 1 })).key, 'D.S.: the rotated cycle');
  const F = mk6({ mode: 1, inst: 2 }, { sync: false }, D6t);
  assert.equal(C.rollPlan(F, 120, S6({ bar: 130 })).loopFrom, 0, 'TRACK PLAY: no located pre-roll (the synced sequencer\'s)');
  // the 808: no session field — rollPlan with a session is today's call
  const D8 = mk({ mode: 4, inst: 0 }, { swing: 62 }, withPat(DEF, 0, 0, row({ bd: 'x.x.x' })));
  assert.equal(C.planSess(D8, C.initState()), null);
  assert.equal(C.rollPlan(D8, 97, { ...C.initState(), tap: 3, run: true }), C.compilePlan(D8, D8.ui, D8.x));
});

test('7c toNotes of a 909 plan (§4, review #17): each hit filtered by its own tick — a flam whose step lies before t0 keeps its second note (across a measure\'s end too); a once plan never wrapped past its end; the guide never written', () => {
  const D = pat9(pat9(mk9({ mode: 2, cyc: false }), 0, { sd: '...............f', bd: 'x' }, { fl: 16 }), 1, { sd: 'f', ht: 'x' }, { fl: 16 });
  const T = tk9(D, 0, [0, 1]), p = C.rollPlan(T, 120), o = C.rollOpts(T);
  assert.deepEqual([p.once, p.mFl[0]], [1, 73]);
  const all = C.toNotes(p, { t0: 0, t1: 99999, ...o });
  assert.deepEqual(all.map(x => [x.t, x.n]), [[0, 36], [3600, 38], [3673, 38], [3840, 38], [3840, 48], [3913, 38]], 'played once: nothing after 7680');
  assert.deepEqual(C.toNotes(p, { t0: 3601, t1: 3900, ...o }).map(x => [x.t, x.n, x.d]), [[3673, 38, 47], [3840, 38, 73], [3840, 48, 120]], 'the second note of a step before t0');
  // every note-off on the steps' grid: a flam's second note ends where its step's other notes end (+ 120; + 240 when the spacing reaches 120)
  const HD = pat9(mk9(), 0, { bd: 'f.f', ch: 'x' }, { fl: 16 }), H = C.rollPlan(HD, 290), hN = C.toNotes(H, { t0: 0, t1: 3840, ...C.rollOpts(HD) });
  assert.equal(H.mFl[0], 176);
  assert.deepEqual(hN.map(x => [x.t, x.n, x.d, x.t + x.d]), [[0, 36, 176, 176], [0, 42, 120, 120], [176, 36, 64, 240], [480, 36, 176, 656], [656, 36, 64, 720]]);
  assert.deepEqual(C.toNotes(p, { t0: 3841, t1: 99999, ...o }).map(x => x.t), [3913]);
  assert.deepEqual(C.toNotes(p, { t0: 7680, t1: 99999, ...o }), [], 'at or past the end: nothing (never wrapped)');
  const cyc = C.rollPlan(mk9({ cyc: true }, {}, T), 120);
  assert.deepEqual(C.toNotes(cyc, { t0: 7681, t1: 7680 + 3840, ...o }).map(x => x.t), [7680 + 3600, 7680 + 3673], 'CYCLE on: the next cycle, its first step\'s second hit before t0 kept');
  assert.deepEqual(C.toNotes(cyc, { t0: 7680, t1: 7681, ...o }).map(x => x.t), [7680], 'the cycle\'s first step');
  // a looping pattern: the window in its second cycle, its step 16's second hit after t0 (the clamp keeps every second hit inside its measure)
  const loop = C.rollPlan(mk9({ mode: 0, sel: 0 }, {}, T), 120);
  assert.deepEqual(C.toNotes(loop, { t0: 3840 + 3601, t1: 3840 + 3800, ...o }).map(x => x.t), [3840 + 3673]);
  assert.deepEqual(C.toNotes(loop, { t0: 3841, t1: 3900, ...o }), [], 'the cycle\'s last flam ended before its end');
  // the guide: never in st
  const G = pat9(mk9({ mode: 1, wm: 1, guide: true }), 0, { bd: 'x' });
  assert.deepEqual(C.toNotes(C.rollPlan(G, 120), { t0: 0, t1: 3840, ...C.rollOpts(G) }).map(x => x.n), [36]);
});

test('7c property: compilePlan for random 909 records in every mode — the measures by the rules, offsets / ticks by SCALE and LAST STEP, st / ac / fl & audible & their lanes, mSh / mFl in range, ≤ 1 793 measures, a plan DrSeq accepts; deterministic', () => {
  const r = rng(29);
  for (let round = 0; round < 60; round++) {
    const d = clone(D9);
    for (let p = 0; p < 96; p++) {
      d.keys[p] = { sc: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16), sh: 1 + Math.floor(r() * 7), fl: 9 + Math.floor(r() * 8), ch: r() < 0.2 ? 1 : 0 };
      for (let s = 0; s < 16; s++) { d.st[p][s] = r() < 0.4 ? Math.floor(r() * 4096) : 0; d.ac[p][s] = Math.floor(r() * 4096); d.fm[p][s] = r() < 0.3 ? Math.floor(r() * 4096) : 0; }
    }
    for (let t = 0; t < 8; t++) d.tk[t] = Array.from({ length: Math.floor(r() * (round % 7 ? 30 : 600)) }, () => Math.floor(r() * 48));
    const sel = Math.floor(r() * 16);
    d.ui = { ...d.ui, mode: round % 4, bank: Math.floor(r() * 2), grp: Math.floor(r() * 3), sel, bl: Math.floor(r() * (16 - sel)), trk: Math.floor(r() * 4), cyc: r() < 0.6, wm: Math.floor(r() * 2), guide: r() < 0.5, tempo: 37 + Math.floor(r() * 254) };
    d.x = { ...d.x, sync: r() < 0.5, mute: r() < 0.3 ? Math.floor(r() * 4096) : 0, solo: r() < 0.2 ? Math.floor(r() * 4096) : 0 };
    const D = C.normDrum(d, 'tr909'), A = C.audible(D.x), t = D.ui.bank * 4 + D.ui.trk;
    const S = S9({ bpm: 37 + r() * 260, loc: Math.floor(r() * 40), ptr: Math.floor(r() * 40), pend: r() < 0.5 ? { g: Math.floor(r() * 3), sel: 2, bl: Math.floor(r() * 3) } : null });
    const p = C.compilePlan(D, D.ui, D.x, S);
    assert.ok(DRSEQ.valid(p), 'round ' + round); assert.equal(p.fill, null); assert.ok(p.n <= C.MAX_MEAS && p.st.length <= C.MAX_STEPS);
    for (let i = 0; i < p.n; i++) {
      const K = D.keys[p.mKey[i]], c = C.SC_CODE[K.sc], T = C.STEP_T[c];
      assert.equal(p.mOff[i + 1] - p.mOff[i], K.l1); assert.equal(p.mT[i + 1] - p.mT[i], K.l1 * T);
      assert.deepEqual([p.mPre[i], p.mL1[i], p.mVar[i]], [c, K.l1, 0]);
      assert.ok(p.mSh[i] < T && p.mFl[i] < T - p.mSh[i]);
      if (D.ui.mode >= 2) assert.equal(p.mKey[i] >= D.ui.bank * 48 && p.mKey[i] < D.ui.bank * 48 + 48, true, 'the track\'s bank');
      for (let s = 0, o = p.mOff[i]; s < K.l1; s++, o++) {
        assert.equal(p.st[o], D.st[p.mKey[i]][s] & A);
        assert.equal(p.ac[o], D.ac[p.mKey[i]][s] & p.st[o] & 0x83E); assert.equal(p.fl[o], D.fm[p.mKey[i]][s] & p.st[o] & 0x03E);
      }
    }
    if (D.ui.mode === 2) assert.ok(p.n === D.tk[t].length || p.n === D.tk[t].length + p.loopFrom);
    if (D.ui.mode === 0) assert.ok(p.n >= D.ui.bl + 1 || p.n >= 1);
    const q = C.compilePlan(C.normDrum(clone(D)), D.ui, D.x, clone(S));
    assert.deepEqual([q.key, q.shape], [p.key, p.shape]);
  }
});

test('7c property: toNotes of a 909 plan round trip — exactly its hits at the sequencer\'s whole-tick shuffled positions (every SCALE / SHUFFLE), flams\' second hits at + mFl, each at its primary with its state\'s velocity, mapped back through its map', () => {
  const r = rng(31);
  for (let round = 0; round < 40; round++) {
    const d = clone(D9);
    for (let p = 0; p < 16; p++) {
      d.keys[p] = { sc: 1 + Math.floor(r() * 4), l1: 1 + Math.floor(r() * 16), sh: 1 + Math.floor(r() * 7), fl: 9 + Math.floor(r() * 8), ch: r() < 0.2 ? 1 : 0 };
      for (let s = 0; s < 16; s++) { d.st[p][s] = r() < 0.5 ? Math.floor(r() * 4096) : 0; d.ac[p][s] = Math.floor(r() * 4096); d.fm[p][s] = r() < 0.4 ? Math.floor(r() * 4096) : 0; }
    }
    const sel = Math.floor(r() * 16);
    d.ui = { ...d.ui, mode: 0, sel, bl: Math.floor(r() * (16 - sel)) };
    if (round & 1) d.map = { ...C.MAP909, rd: [59, 51], ch: [44, 42] };
    const D = C.normDrum(d, 'tr909'), bpm = 60 + Math.floor(r() * 200), pl = C.rollPlan(D, bpm), o = C.rollOpts(D), tab = C.mapTable(D.map, 'tr909');
    const t0 = Math.floor(r() * 20000), t1 = t0 + Math.floor(r() * 30000);
    const got = C.toNotes(pl, { t0, t1, ...o }).map(x => [x.t, tab[x.n], x.v]);
    const want = [];
    let m = 0, start = 0;
    while (start < t1) {
      const T = C.STEP_T[pl.mPre[m]];
      for (let s = 0, k = pl.mOff[m]; k < pl.mOff[m + 1]; s++, k++) {
        const t = start + s * T + (s & 1 ? pl.mSh[m] : 0), mask = pl.st[k];
        for (let l = 1; l < 12; l++) {
          if (!(mask & (1 << l))) continue;
          const sd = C.LANE_SOUND[l][0], acc = (0x83E >> l) & 1, st = (mask & 1 ? 2 : 0) | ((pl.ac[k] >> l) & 1), v = [100, 110, 119, 127][acc ? st : st & 2 ? 3 : 0];
          if (t >= t0 && t < t1) want.push([t, sd, v]);
          if ((pl.fl[k] >> l) & 1 && t + pl.mFl[m] >= t0 && t + pl.mFl[m] < t1) want.push([t + pl.mFl[m], sd, v]);
        }
      }
      start += pl.mT[m + 1] - pl.mT[m]; m = m + 1 < pl.n ? m + 1 : pl.loopFrom;
    }
    const prim = C.primaries(D.map, 'tr909');
    want.sort((a, b) => a[0] - b[0] || prim[a[1]] - prim[b[1]]);
    assert.deepEqual(got, want, 'round ' + round);
  }
});
