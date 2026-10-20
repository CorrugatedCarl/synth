// Tests of drum-core.js (lane S; IMPL-7a §12.3): normDrum (§6), the panel's state machine press — one test per row of the
// §3.3 table and per input of its "not covered" list —, compilePlan (§3.4: every mode × variation × fill × pre-scale × parts,
// the AB ? 2N : N cycle, the TAP fill, mute / solo, the content key), toNotes (§4.3), vTrig (§1.3), DEFAULT_MAP (§4.1), the
// payload (§3.5), the LEDs, and the constants dr-seq.js embeds.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
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
