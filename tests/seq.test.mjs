// Tests of seq-core.js and sx-seq.js (owner D6; SPEC-serum2 §15.4): constants (§3.15), schemas (§2.4), compileSeq and the
// seqT parts (§4.4), the pure helpers and clip actions of §11.3 / §7.5.6, and SxSeq (§7): tables, apply / merge, the
// keyboard stage, the arpeggiator, the clip player, MIDI OUT through the PROCS registry, transport / determinism,
// allocation-free operation. The sequencer is driven by an engine-like span loop (inputs, fire, next) on a fake processor.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../seq-core.js?v=8';
import * as core from '../serum-core.js?v=8';
import * as laws from '../laws.js?v=8';
import { dspScope, noAlloc, source, recorder } from './dsp-scope.mjs';
import * as CPU from './cpu-gate.mjs';

const clone = x => JSON.parse(JSON.stringify(x));
const arr = a => Array.from(a);
const range = n => Array.from({ length: n }, (_, i) => i);

/* ------------------------------------------------------------------ §3.15 constants */

test('§3.15 enumerations, ladders, scales: lengths, entries, frozen', () => {
  assert.deepEqual([Q.ARP_SHAPES, Q.RANGE_SHAPES, Q.ARP_PMODES, Q.STEP_MODES, Q.WRAP_MODES, Q.CLIP_MODES, Q.KB_SPAN, Q.CLIP_TRIG, Q.MIDI_OUT]
    .map(l => l.length), [18, 18, 8, 4, 3, 9, 4, 2, 3]);
  assert.deepEqual([Q.ARP_SHAPES[0], Q.ARP_SHAPES[1], Q.ARP_SHAPES[7], Q.ARP_SHAPES[17]], ['Played', 'Pattern', 'Up', 'Rand NoDup']);
  assert.deepEqual([Q.RANGE_SHAPES[8], Q.RANGE_SHAPES[13], Q.RANGE_SHAPES[17]], ['Pinky Up', 'Chord', 'Rnd.Once']);
  assert.deepEqual([Q.CLIP_MODES[8], Q.MIDI_OUT[1], Q.KB_SPAN[3]], ['Static', 'Clip Player', 'Offset']);
  // arp ladders: 9 / 17 / 17 / 25, slowest first, dot = × 1.5 '.', trip = × 2/3 'T' of the first 8 straight entries
  assert.deepEqual([[0, 0], [1, 0], [0, 1], [1, 1]].map(([d, t]) => Q.arpLadder(d, t).length), [9, 17, 17, 25]);
  assert.deepEqual(Q.arpLadder(0, 0).map(e => e.label), ['4 bar', '2 bar', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64']);
  for (const [d, t] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const L = Q.arpLadder(d, t);
    for (let i = 1; i < L.length; i++) assert.ok(L[i].beats < L[i - 1].beats, 'descending');
  }
  const T = Q.arpLadder(0, 1), D = Q.arpLadder(1, 0);
  assert.equal(T.find(e => e.label === '1/16T').beats, 1 / 6);
  assert.equal(D.find(e => e.label === '1/8.').beats, 0.75);
  assert.ok(!T.some(e => e.label === '1/64T') && !D.some(e => e.label === '1/64.'), 'the last straight entry has no variants');
  assert.deepEqual([[0, 0], [1, 0], [0, 1], [1, 1]].map(([d, t]) => Q.gridLadder(d, t).length), [11, 19, 19, 27]);
  assert.deepEqual(Q.gridLadder(0, 0).slice(-2), [{ label: '1/128', beats: 1 / 32 }, { label: '1/256', beats: 1 / 64 }]);
  assert.deepEqual(Q.GRID_LADDER.map(e => e.beats), [1, 0.5, 0.25, 0.125, 0.0625, 1 / 3, 1 / 6]);
  assert.deepEqual(Q.GRID_LADDER.map(e => e.label), ['1/4', '1/8', '1/16', '1/32', '1/64', '1/8T', '1/16T']);
  assert.deepEqual(Q.TIME_LADDER.map(e => e.beats), [0.25, 0.5, 1, 2, 4, 8, 16]);
  assert.deepEqual(Q.RRATE_LADDER.map(e => e.beats), [1, 2, 4, 8, 16, 32]);
  assert.deepEqual(Q.LAUNCH_QUANT.map(e => e.label), ['Off', '1/32', '1/16', '1/8', '1/4', '1/2', '1 bar', '2 bar', '4 bar']);
  assert.deepEqual(Q.LAUNCH_QUANT.map(e => e.beats), [0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16]);
  assert.deepEqual(Q.LEN_LADDER.map(e => e.beats), [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 128]);
  assert.equal(Q.LEN_LADDER[5].label, '1 bar');
  assert.deepEqual(Q.CLIP_RATES, ['×1/4', '×1/3', '×1/2', '×2/3', '×3/4', '×1', '×4/3', '×3/2', '×2', '×3', '×4']);
  assert.deepEqual(Q.CLIP_RATE_VALUES, [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4]);
  assert.deepEqual(Q.SWING_DIVS.map(e => e.beats), [0.5, 0.25, 0.125]);
  assert.equal(Q.arpRateHz(0.5), 5);
  // scales (§3.15.7)
  assert.equal(Q.SCALES.length, 42);
  assert.deepEqual(Q.SCALES[0], { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] });
  assert.deepEqual([Q.SCALES[14].name, Q.SCALES[14].id, Q.SCALES[14].steps], ['Diminished (W-H)', 'diminished-w-h', [0, 2, 3, 5, 6, 8, 9, 11]]);
  assert.deepEqual([Q.SCALES[17].name, Q.SCALES[17].steps], ['Chromatic', range(12)]);
  assert.deepEqual([Q.SCALES[37].name, Q.SCALES[37].steps], ['Spanish 8-Tone', [0, 1, 3, 4, 5, 6, 8, 10]]);
  assert.deepEqual([Q.SCALES[41].name, Q.SCALES[41].steps], ['Minor Hexatonic', [0, 2, 3, 5, 7, 10]]);
  assert.equal(new Set(Q.SCALES.map(s => s.id)).size, 42);
  for (const s of Q.SCALES) {
    assert.equal(s.steps[0], 0, s.name);
    for (let i = 1; i < s.steps.length; i++) assert.ok(s.steps[i] > s.steps[i - 1] && s.steps[i] < 12, s.name);
  }
  for (const c of [Q.ARP_SHAPES, Q.SCALES, Q.SCALES[3].steps, Q.ARP_LADDER, Q.arpLadder(1, 1), Q.LAUNCH_QUANT, Q.ARP_N, Q.N_GRID,
    Q.FACTORY_ARP_BANKS, Q.FALLBACK_CLIPS, Q.noteOps, Q.SEQT_PART_NAMES]) assert.ok(Object.isFrozen(c));
});

test('§3.11.2 / §3.15: virtual-destination defaults and grids equal the DESTS rows; ladders equal SxBase.LAD', () => {
  for (const [pre, defs] of [['arp.', Q.ARP_N], ['clip.', Q.CLIP_N]]) {
    for (const k of Object.keys(defs)) {
      const d = core.DESTS.find(r => r.id === pre + k);
      if (k === 'hz') { assert.equal(d, undefined); continue; }     // Hz-mode base of arp.rate (no destination of its own)
      assert.equal(defs[k], d.def, pre + k + ' default');
      assert.equal(Q.N_GRID[pre + k] || 0, laws.gridOf(d.law, d.lo, d.hi), pre + k + ' grid');
    }
  }
  const S = dspScope({ files: ['sx-base.js'] }), L = S.global('SxBase').LAD;
  for (let v = 0; v < 4; v++) {
    assert.deepEqual(arr(L.arp[v]), Q.arpLadder(v & 1, v >> 1).map(e => e.beats));
    assert.deepEqual(arr(L.grid[v]), Q.gridLadder(v & 1, v >> 1).map(e => e.beats));
  }
  assert.deepEqual(arr(L.len), Q.LEN_LADDER.map(e => e.beats));
  assert.deepEqual(arr(L.rrate), Q.RRATE_LADDER.map(e => e.beats));
  assert.deepEqual(arr(L.time), Q.TIME_LADDER.map(e => e.beats));
  assert.deepEqual(arr(L.launch), Q.LAUNCH_QUANT.map(e => e.beats));
  assert.deepEqual(arr(L.vcRates), Q.CLIP_RATE_VALUES, 'CLIP_RATES share the VC_RATES multipliers');
});

/* ------------------------------------------------------------------ §2.4 schemas */

test('§2.4 defaults: shapes and values', () => {
  const A = Q.defaultArp(), C = Q.defaultClip(), K = Q.defaultKbd();
  assert.deepEqual(Object.keys(A), ['bank', 'dirty', 'sel', 'quant', 'editAll', 'midiOut', 'outTrack', 'trigOct', 'slots']);
  assert.equal(A.slots.length, 12);
  assert.deepEqual(A.slots[0], Q.defaultArpSlot());
  assert.deepEqual([A.slots[0].shape, A.slots[0].n.rate, A.slots[0].n.gate, A.slots[0].pat.len, A.slots[0].pat.time], [7, 0.75, 0.375, 16, 4]);
  assert.notEqual(A.slots[0], A.slots[1]);
  assert.notEqual(A.slots[0].n, A.slots[1].n);
  assert.deepEqual(A.slots[0].pat.lanes, { vel: null, gate: null, chance: null, x: null });
  assert.equal(C.clips.length, 12);
  assert.deepEqual([C.clips[0].len, C.clips[0].kb, C.clips[0].quant, C.clips[0].retrig, C.preview, C.rec], [64, 1, 6, 1, -1, { mode: 0, metro: 1 }]);
  assert.deepEqual(Object.keys(C.clips[0].lanes), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  assert.deepEqual(K, { trans: 0, key: -1, scale: 0, swing: 0, div: 1, arpMap: { k: [0, 127], v: [1, 127], fold: 0 } });
  // the defaults are normalized and survive JSON
  assert.deepEqual(Q.normalizeArp(A), A);
  assert.deepEqual(Q.normalizeClip(C), C);
  assert.deepEqual(Q.normalizeKbd(K), K);
  assert.deepEqual(Q.normalizeArp(clone(A)), A);
  // serum-core's state uses the same schema
  const s = core.defaultSerum();
  assert.deepEqual([s.arp, s.clip, s.kbd], [A, C, K]);
});

test('§2.4 normalisation: bounds, grids, records, budgets, idempotence; equal to serum-core on its cases', () => {
  // the serum-core 9c case (bounds and grids)
  const a = core.defaultSerum();
  Object.assign(a.arp, { sel: 40, quant: -1, midiOut: 7, trigOct: 99 });
  a.arp.slots[3] = { shape: 99, n: { rate: 2, shift: 0.51, rrate: 0.33 },
    pat: { len: 8, ev: [[0, 1, 2, 300, 1], [9, 1, 1, 64, 0], [1, 0, 1, 64, 0], [2, 1, 0, 64, 0], [3.5, 0.5, -40, 1, 1]] } };
  a.clip.clips[0] = { len: 5000, start: 2000, off: 1, notes: [[4, 1, 200, 0, 1, 2, -1, 0.5], [1, 1, 60, 100]] };
  const na = Q.normalizeArp(a.arp), nc = Q.normalizeClip(a.clip);
  assert.deepEqual([na.sel, na.quant, na.midiOut, na.trigOct], [11, 0, 2, 11]);
  const sl = na.slots[3];
  assert.deepEqual([sl.shape, sl.n.rate, sl.n.shift, sl.n.rrate, sl.n.hz], [17, 1, 0.5, 0.4, 0.5]);
  assert.deepEqual(sl.pat.ev, [[0, 1, 2, 127, 1], [3.5, 0.5, -32, 1, 1]]);
  assert.deepEqual([nc.clips[0].len, nc.clips[0].start, nc.clips[0].off], [1024, 1023, 1023]);
  assert.deepEqual(nc.clips[0].notes, [[1, 1, 60, 100, 0, 0.5, 0.5, 0], [4, 1, 127, 1, 1, 1, 0, 0.5]]);
  const ns = core.normalizeSerum(a);
  assert.deepEqual([ns.arp, ns.clip], [na, nc], 'serum-core agrees');
  // more: grids of the stepped virtual destinations, lanes, kbd, map ordering, names, strum order
  const b = core.defaultSerum();
  b.arp.slots[0] = { name: 'x'.repeat(50), n: { range: 0.5, repeats: 0.52, trans: -3, wtrans: 0.49, wrange: 0.07, gate: 0.123456789, hz: 'q' },
    pat: { len: 300, mode: 9, time: -1, stepMode: 2.6, wrap: 1.4, grid: 7, strum: [[3, 0.5], [1, 2], [300, 1], ['a', 1]],
      lanes: { vel: [[0.5, 0.2]], gate: 'x', chance: [[0, 0, 0], [1, 1, 3], [0.2, 0.5, -0.5]], x: [] } } };
  b.clip.clips[2] = { n: { trans: 0.51, rate: 0.53, offset: 0.333333333 }, lanes: { m3: [[0, 0.5, 0], [1, 1, 0]] }, kb: 7, quant: 99, offQ: -2 };
  b.kbd = { trans: 30.4, key: 12, scale: 99, swing: -3, div: 9, arpMap: { k: [90, 10], v: [0, 200], fold: true } };
  const nb = core.normalizeSerum(b), s0 = Q.normalizeArpSlot(b.arp.slots[0]);
  assert.equal(s0.name.length, 32);
  assert.deepEqual(s0.n, Object.assign({}, Q.ARP_N, { range: 4 / 7, repeats: 8 / 16, trans: 0, wtrans: 12 / 24, wrange: 1 / 8, gate: 0.12346 }));
  assert.deepEqual([s0.pat.len, s0.pat.mode, s0.pat.time, s0.pat.stepMode, s0.pat.wrap, s0.pat.grid], [256, 7, 0, 3, 1, 6]);
  assert.deepEqual(s0.pat.strum, [[1, 1], [3, 0.5]], 'sorted by time, out-of-range and malformed entries dropped');
  assert.deepEqual(s0.pat.lanes, { vel: [[0, 0.2, 0], [1, 0.2, 0]], gate: null, chance: [[0, 0, 0], [0.2, 0.5, -0.5], [1, 1, 1]], x: null });
  const c2 = nb.clip.clips[2];
  assert.deepEqual(c2.n, { trans: 0.5, rate: 0.5, offset: 0.33333 });
  assert.deepEqual([c2.kb, c2.quant, c2.offQ, c2.lanes.m3, c2.lanes.m1], [3, 8, 0, [[0, 0.5, 0], [1, 1, 0]], null]);
  assert.deepEqual(Q.normalizeClip(b.clip), nb.clip);
  assert.deepEqual(Q.normalizeKbd(b.kbd), { trans: 24, key: 11, scale: 41, swing: -1, div: 2, arpMap: { k: [10, 90], v: [1, 127], fold: 1 } });
  assert.deepEqual(Q.normalizeKbd(b.kbd), nb.kbd);
  // records: zero-length notes (after rounding) dropped; per clip 1024; per bank 4096, earlier clips first; events ≤ 512
  const many = n => Array.from({ length: n }, (_, i) => [i / 8, 0.1, 60, 100]);
  const c = Q.normalizeClip({ clips: [{ notes: [[0, 1e-7, 60], [0, 1, 61]] }, { len: 1024, notes: many(1500) }, { len: 1024, notes: many(1000) },
    { len: 1024, notes: many(1000) }, { len: 1024, notes: many(1000) }, { len: 1024, notes: many(100) }] });
  assert.deepEqual(c.clips[0].notes, [[0, 1, 61, 100, 0, 0.5, 0.5, 0]]);
  assert.deepEqual(c.clips.map(x => x.notes.length), [1, 1024, 1000, 1000, 1000, 71, 0, 0, 0, 0, 0, 0]);
  const e = Q.normalizeArpSlot({ pat: { len: 256, ev: Array.from({ length: 600 }, (_, i) => [i % 256, 1, 1 + (i % 32), 100]) } });
  assert.equal(e.pat.ev.length, 512);
  for (let i = 1; i < 512; i++) assert.ok(e.pat.ev[i][0] >= e.pat.ev[i - 1][0]);
  // idempotent, JSON-stable, never throws on junk
  for (const x of [na, nc, nb.arp, nb.clip, c]) assert.deepEqual(clone(x), x);
  assert.deepEqual(Q.normalizeArp(na), na);
  assert.deepEqual(Q.normalizeClip(c), c);
  for (const junk of [undefined, null, 7, 'x', [], { slots: 5 }, { clips: [null, 'x', 3] }]) {
    assert.deepEqual(Q.normalizeArp(junk), Q.defaultArp());
    assert.deepEqual(Q.normalizeClip(junk), Q.defaultClip());
    assert.deepEqual(Q.normalizeKbd(junk), Q.defaultKbd());
  }
});

/* ------------------------------------------------------------------ §3.15.7 quantize, §7.2 swing */

// the §3.15.7 formula, literally: nearest member by circular distance, ties toward the lower pitch
function quantRef(note, key, scale) {
  if (key < 0) return note;
  const pc = (((note - key) % 12) + 12) % 12;
  let best = null;
  for (const m of Q.SCALES[scale].steps) {
    for (const w of [-12, 0, 12]) {
      const d = m - pc + w;
      if (best === null || Math.abs(d) < Math.abs(best) || (Math.abs(d) === Math.abs(best) && d < best)) best = d;
    }
  }
  return note + best;
}

test('§3.15.7 quantize for every scale and key (ties down), scaleMask', () => {
  for (let sc = 0; sc < 42; sc++) {
    for (let key = -1; key < 12; key++) {
      const mask = Q.scaleMask(key, sc);
      for (let n = 0; n < 128; n++) {
        const q = Q.quantize(n, key, sc);
        assert.equal(q, quantRef(n, key, sc), `scale ${sc} key ${key} note ${n}`);
        assert.ok((mask >> (((q % 12) + 12) % 12)) & 1, 'result in the scale');
      }
    }
  }
  assert.equal(Q.scaleMask(-1, 3), 0xFFF);
  assert.equal(Q.scaleMask(0, 0), 0b101010110101);
  assert.equal(Q.scaleMask(2, 0), [2, 4, 6, 7, 9, 11, 1].reduce((m, p) => m | (1 << p), 0), 'D major');
  // spot values: C major C# → C (tie down), F# → F; whole tone B → A# (tie down); A minor pentatonic in A
  assert.deepEqual([Q.quantize(61, 0, 0), Q.quantize(66, 0, 0), Q.quantize(71, 0, 13), Q.quantize(71, 9, 10)], [60, 65, 70, 72]);
  assert.equal(Q.quantize(61.4, -1, 0), 61.4, 'key off: unchanged');
});

test('§7.2 swing: identity at 0, offbeat at 0.875 / 0.125 of the pair, inverse, display', () => {
  for (const d of [0.5, 0.25, 0.125]) {
    for (let b = -1; b < 4; b += 0.03125) assert.equal(Q.swingTime(b, 0, d), b);
    assert.equal(Q.swingTime(d, 1, d), 2 * d * 0.875);
    assert.equal(Q.swingTime(d, -1, d), 2 * d * 0.125);
    assert.equal(Q.swingTime(5 * 2 * d + d, 1, d), 5 * 2 * d + 2 * d * 0.875, 'in every pair');
    for (const s of [-1, -0.4, 0.3, 1]) {
      let prev = -Infinity;
      for (let b = 0; b <= 4; b += d / 8) {
        const w = Q.swingTime(b, s, d);
        assert.ok(w > prev, 'monotone');
        prev = w;
        assert.ok(Math.abs(Q.swingInv(w, s, d) - b) < 1e-12, 'inverse');
        if (Math.abs(b / (2 * d) - Math.round(b / (2 * d))) < 1e-12) assert.ok(Math.abs(w - b) < 1e-12, 'pair boundaries fixed');
      }
    }
  }
  assert.deepEqual([Q.swingLabel(0), Q.swingLabel(1), Q.swingLabel(-1), Q.swingLabel(0.2), Q.swingLabel(5)], ['OFF', '87.5%', '12.5%', '57.5%', '87.5%']);
});

/* ------------------------------------------------------------------ §7.4.1–7.4.2 orders */

// hand-written passes for N (or R) = 1…6 as index strings
const ARP_TAB = {
  Up: ['0', '01', '012', '0123', '01234', '012345'],
  Down: ['0', '10', '210', '3210', '43210', '543210'],
  UpDown: ['0', '01', '0121', '012321', '01234321', '0123454321'],
  DownUp: ['0', '10', '2101', '321012', '43210123', '5432101234'],
  'Up&Down': ['00', '0110', '012210', '01233210', '0123443210', '012345543210'],
  'Down&Up': ['00', '1001', '210012', '32100123', '4321001234', '543210012345'],
  Converge: ['0', '01', '021', '0312', '04132', '051423'],
  Diverge: ['0', '10', '120', '2130', '23140', '324150'],
  'Conv&Div': ['0', '010', '02120', '0312130', '041323140', '05142324150'],
  'Thumb Up': ['0', '01', '0102', '010203', '01020304', '0102030405'],
  'Thumb UD': ['0', '01', '0102', '01020302', '010203040302', '0102030405040302'],
};
const RANGE_TAB = {
  Up: ['0', '01', '012', '0123'], Down: ['0', '10', '210', '3210'], 'Up/Down': ['0', '01', '0121', '012321'],
  'Down/Up': ['0', '10', '2101', '321012'], 'Up+Down': ['00', '0110', '012210', '01233210'], 'Down+Up': ['00', '1001', '210012', '32100123'],
  'Thumb Up': ['0', '01', '0102', '010203'], 'Thumb UD': ['0', '01', '0102', '01020302'], 'Pinky Up': ['0', '10', '2021', '303132'],
  'Pinky UD': ['0', '10', '2021', '30313231'], Converge: ['0', '01', '021', '0312'], Diverge: ['0', '10', '120', '2130'],
  'Con+Diverge': ['0', '010', '02120', '0312130'],
};
const digits = s => s.split('').map(Number);

test('§7.4.1 arpOrder: every shape for N = 1…6 against hand-written tables; random shapes; OFFSET', () => {
  for (const [name, rows] of Object.entries(ARP_TAB)) {
    const sh = Q.ARP_SHAPES.indexOf(name);
    rows.forEach((row, i) => {
      const N = i + 1, notes = range(N).map(k => 60 + 2 * k).reverse();       // given out of order: sorted ascending first
      assert.deepEqual(Q.arpOrder(sh, notes), digits(row).map(k => [60 + 2 * k]), `${name} N=${N}`);
    });
  }
  for (let N = 1; N <= 6; N++) {
    const notes = [67, 60, 64, 72, 62, 70].slice(0, N);
    assert.deepEqual(Q.arpOrder(0, notes), notes.map(n => [n]), 'Played: arrival order');
    assert.deepEqual(Q.arpOrder(2, notes), [notes.slice().sort((x, y) => x - y)], 'Chord: every note in one step');
    assert.deepEqual(Q.arpOrder(1, notes), [], 'Pattern: no note order');
    // random shapes: N steps, indices in range; NoDup never repeats (also across passes); Drift moves by ±1; Once repeats
    // a permutation; deterministic per seed
    const sorted = notes.slice().sort((x, y) => x - y), ix = steps => steps.map(s => sorted.indexOf(s[0]));
    for (const seed of [1, 2, 99, 0xdeadbeef]) {
      for (const sh of [14, 15, 16, 17]) {
        const st = { seed }, p1 = ix(Q.arpOrder(sh, notes, st)), p2 = ix(Q.arpOrder(sh, notes, st)), seqn = p1.concat(p2);
        assert.equal(p1.length, N);
        assert.ok(seqn.every(k => k >= 0 && k < N));
        assert.deepEqual(ix(Q.arpOrder(sh, notes, { seed })), p1, 'deterministic');
        if (sh === 17 && N > 1) for (let k = 1; k < seqn.length; k++) assert.notEqual(seqn[k], seqn[k - 1], 'NoDup');
        if (sh === 16) {
          assert.equal(p1[0], 0, 'Drift starts at the bottom');
          if (N > 1) for (let k = 1; k < seqn.length; k++) assert.equal(Math.abs(seqn[k] - seqn[k - 1]), 1, 'Drift ±1');
        }
        if (sh === 15) { assert.deepEqual(p1.slice().sort(), range(N), 'Once: a permutation'); assert.deepEqual(p2, p1, 'repeated'); }
      }
    }
  }
  assert.deepEqual(Q.arpOrder(7, [60, 62, 64, 65], { offset: 1 }), [[62], [64], [65], [60]], 'OFFSET rotates the pass');
  assert.deepEqual(Q.arpOrder(7, [60, 60, 64]), [[60], [64]], 'duplicates removed');
  assert.deepEqual(Q.arpOrder(7, []), []);
});

test('§7.4.2 rangeOrder: every range shape for R = 1…4', () => {
  for (const [name, rows] of Object.entries(RANGE_TAB)) {
    const sh = Q.RANGE_SHAPES.indexOf(name);
    rows.forEach((row, i) => assert.deepEqual(Q.rangeOrder(sh, i + 1), digits(row).map(k => [k]), `${name} R=${i + 1}`));
  }
  for (let R = 1; R <= 4; R++) {
    assert.deepEqual(Q.rangeOrder(13, R), [range(R)], 'Chord: all passes at once');
    for (const sh of [14, 15, 16, 17]) {
      const st = { seed: 7 + R }, p = Q.rangeOrder(sh, R, st).concat(Q.rangeOrder(sh, R, st)).map(s => s[0]);
      assert.equal(p.length, 2 * R);
      assert.ok(p.every(k => k >= 0 && k < R));
      if (sh === 15 && R > 1) for (let k = 1; k < p.length; k++) assert.notEqual(p[k], p[k - 1]);
      if (sh === 16 && R > 1) for (let k = 1; k < p.length; k++) assert.equal(Math.abs(p[k] - p[k - 1]), 1);
      if (sh === 17) assert.deepEqual(p.slice(R), p.slice(0, R));
    }
  }
});

/* ------------------------------------------------------------------ §4.4 compileSeq */

const ARP_ROW_DEFAULT = [7, 1, 0, 0, 0.75, 0.5, 0.75, 0, 0, 0, 0.375, 1, 0.4, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  16, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CLIP_ROW_DEFAULT = [64, 0, 0, 0.25, 1, 0, 4, 4, 1, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// a state using every table: events / strums / lanes in arp slot 2, notes and lanes in clips 1 and 5
function richState() {
  const s = core.defaultSerum();
  Object.assign(s.arp.slots[2], { shape: 1, bpm: 0, trip: 1, rshape: 4, latch: 1, vel: 1 });
  Object.assign(s.arp.slots[2].pat, { len: 12, mode: 2, time: 1, stepMode: 2, wrap: 1,
    ev: [[3, 1, -2, 90, 1], [0, 0.5, 1, 100, 0], [2.5, 2, 4, 127, 0]], strum: [[2, 0.25], [0, 0.5]],
    lanes: { vel: [[0, 0.2, 0], [1, 1, 0.5]], gate: null, chance: null, x: [[0, 1, 0], [0.5, 0, -1], [1, 0.5, 0]] } });
  Object.assign(s.clip.clips[1], { len: 32, start: 4, off: 8, offQ: 5, kb: 2, mode: 4, time: 2, quant: 3, retrig: 0, veloTrig: 1, noteGate: 1,
    n: { trans: 0.25, rate: 0.7, offset: 0.125 },
    notes: [[8, 2, 64, 90, 0, 0.1, 0.2, 0.3], [4, 1, 67, 100, 1, 0.5, 0.5, 0], [4, 1, 60, 80, 0, 0.5, 0.5, 0]],
    lanes: Object.assign({}, s.clip.clips[1].lanes, { m1: [[0, 0, 0], [1, 1, 0]], m3: [[0, 1, 0], [1, 0, 0.3]] }) });
  s.clip.clips[5].notes = [[0, 4, 48, 100, 0, 0.5, 0.5, 0]];
  s.clip.clips[5].lanes.m8 = [[0, 0.5, 0], [1, 0.5, 0]];
  return core.normalizeSerum(s);
}

test('§4.4 compileSeq: SQP fields, part shapes, assembled layout', () => {
  const { seq, seqT } = Q.compileSeq(core.defaultSerum());
  assert.deepEqual(Object.keys(seq), ['ver', 'key', 'active', 'kbd', 'arpG', 'clipG', 'outIds']);
  assert.deepEqual([seq.ver, seq.active, seq.key], [1, 0, seqT.key]);
  for (const k of ['kbd', 'arpG', 'clipG']) assert.ok(seq[k] instanceof Float64Array && seq[k].length === 8, k);
  assert.deepEqual(arr(seq.kbd), [0, -1, 0xFFF, 0, 0.25, 0, 127, 0]);
  assert.deepEqual(arr(seq.arpG), [1, 0, 1, 0, 0, -1, -1, 0]);
  assert.deepEqual(arr(seq.clipG), [0, 0, 1, 0, 0, -1, -1, 0]);
  assert.deepEqual(seq.outIds, []);
  assert.match(seqT.key, /^[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(seqT.parts), [...Q.SEQT_PART_NAMES]);
  assert.deepEqual(Q.SEQT_PART_NAMES.slice(0, 2).concat(Q.SEQT_PART_NAMES.slice(-1)), ['arp0', 'arp1', 'clip11']);
  for (let j = 0; j < 12; j++) {
    const a = seqT.parts['arp' + j], c = seqT.parts['clip' + j];
    assert.deepEqual([a.kind, a.j, c.kind, c.j], ['arp', j, 'clip', j]);
    assert.ok(a.row instanceof Float64Array && a.ev instanceof Float64Array && a.strum instanceof Float64Array && a.lane instanceof Float32Array);
    assert.ok(c.row instanceof Float64Array && c.notes instanceof Float64Array && c.lane instanceof Float32Array);
    assert.deepEqual(arr(a.row), ARP_ROW_DEFAULT, 'arp row ' + j);
    assert.deepEqual(arr(c.row), CLIP_ROW_DEFAULT, 'clip row ' + j);
    assert.deepEqual([a.ev.length, a.strum.length, a.lane.length, c.notes.length, c.lane.length], [0, 0, 0, 0, 0]);
    assert.match(a.key, /^[0-9a-f]{8}$/);
  }
  assert.notEqual(seqT.parts.arp0.key, seqT.parts.arp1.key, 'a key names its slot');
  const T = Q.assembleSeqT(seqT);
  assert.deepEqual([T.arp.length, T.clip.length, T.arpEv.length, T.clipNotes.length], [480, 288, 0, 0]);

  // a state with every kind of record
  const s = richState(), R = Q.compileSeq(s), P = R.seqT.parts, A = Q.assembleSeqT(R.seqT);
  const a2 = arr(P.arp2.row);
  assert.deepEqual(a2.slice(0, 4), [1, 0, 1, 0]);
  assert.deepEqual(a2.slice(18, 28), [4, 1, 0, 0, 1, 0, 0, 0, 1, 1]);
  assert.deepEqual(a2.slice(28, 40), [12, 2, 0.5, 2, 1, 0, 3, 0, 2, 1 | 8, 0, 0]);
  assert.deepEqual(arr(P.arp2.ev), [0, 0.5, 1, 100, 0, 2.5, 2, 4, 127, 0, 3, 1, -2, 90, 1], 'sorted by t16');
  assert.deepEqual(arr(P.arp2.strum), [0, 0.5, 2, 0.25]);
  assert.deepEqual(arr(P.arp2.lane), arr(laws.renderPts(s.arp.slots[2].pat.lanes.vel, 128)).concat(arr(laws.renderPts(s.arp.slots[2].pat.lanes.x, 128))));
  const c1 = arr(P.clip1.row);
  assert.deepEqual(c1, [32, 4, 8, 1 / 3, 2, 4, 1, 0.5, 0, 1, 1, 0.25, 0.7, 0.125, 0, 3, 1 | 4, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(arr(P.clip1.notes), [4, 1, 60, 80, 0, 0.5, 0.5, 0, 4, 1, 67, 100, 1, 0.5, 0.5, 0, 8, 2, 64, 90, 0, 0.1, 0.2, 0.3], 't16, then note');
  assert.deepEqual(arr(P.clip1.lane), arr(laws.renderPts([[0, 0, 0], [1, 1, 0]], 128)).concat(arr(laws.renderPts([[0, 1, 0], [1, 0, 0.3]], 128))));
  // assembled: offsets in records, packed in slot order
  assert.deepEqual([A.arp[2 * 40 + 33], A.arp[2 * 40 + 34], A.arp[2 * 40 + 35], A.arp[2 * 40 + 38], A.arp[3 * 40 + 33], A.arp[3 * 40 + 38]], [0, 3, 0, 0, 3, 2]);
  assert.deepEqual([A.arpEv.length, A.arpStrum.length, A.arpLane.length], [15, 4, 2 * 129]);
  assert.deepEqual([A.clip[1 * 24 + 14], A.clip[5 * 24 + 14], A.clip[5 * 24 + 15], A.clip[5 * 24 + 17], A.clip[6 * 24 + 14]], [0, 3, 1, 2, 4]);
  assert.deepEqual(arr(A.clipNotes.slice(24)), [0, 4, 48, 100, 0, 0.5, 0.5, 0]);
  assert.equal(A.clipLane.length, 3 * 129);
  assert.equal(A.key, R.seqT.key);
});

test('§4.4 compileSeq: seq.active, kbd, MIDI OUT targets', () => {
  const act = (f, ctx) => { const s = core.defaultSerum(); f(s); return Q.compileSeq(core.normalizeSerum(s), ctx).seq.active; };
  assert.equal(act(() => {}), 0);
  assert.equal(act(s => { s.p['arp.on'] = 1; }), 1);
  assert.equal(act(s => { s.p['clip.on'] = 0.5; }), 1);
  assert.equal(act(s => { s.matrix[3] = Object.assign(s.matrix[3], { src: 'lfo1', dst: 'clip.on', amt: 0.5 }); }), 1, 'targeted');
  assert.equal(act(s => { s.matrix[3] = Object.assign(s.matrix[3], { src: 'lfo1', dst: 'clip.on', amt: 0.5, byp: 1 }); }), 0, 'bypassed row');
  assert.equal(act(s => { s.kbd.trans = -1; }), 1);
  assert.equal(act(s => { s.kbd.key = 0; }), 1);
  assert.equal(act(s => { s.kbd.swing = 0.5; s.kbd.scale = 4; }), 0, 'swing / scale alone do not engage the sequencer');
  assert.equal(act(s => { s.osc[1].map.k = [10, 127]; }), 1);
  assert.equal(act(s => { s.sub.map.v = [1, 100]; }), 1);
  assert.equal(act(s => { s.kbd.arpMap.v = [20, 127]; }), 1);
  assert.equal(act(s => { s.osc[0].map.fold = 1; s.osc[0].map.warp = 1; }), 0, 'flags of a full-range map');
  assert.equal(act(() => {}, { possOn: id => id === 'arp.on' }), 1, 'ctx.possOn (the compiler’s rule) wins');
  assert.equal(act(s => { s.p['arp.on'] = 1; }, { possOn: () => false }), 0);
  // kbd row and the globals
  const s = core.defaultSerum();
  Object.assign(s.kbd, { trans: -7, key: 9, scale: 10, swing: -0.25, div: 2, arpMap: { k: [36, 84], v: [1, 127], fold: 1 } });
  Object.assign(s.arp, { quant: 6, midiOut: 2, outTrack: 't9', trigOct: 3, sel: 4 });
  Object.assign(s.clip, { midiOut: 1, outTrack: 't9', trigOct: 0, sel: 11, trig: 1, preview: 5 });
  let R = Q.compileSeq(core.normalizeSerum(s));
  assert.deepEqual(arr(R.seq.kbd), [-7, 9, Q.scaleMask(9, 10), -0.25, 0.125, 36, 84, 1]);
  assert.deepEqual(arr(R.seq.arpG), [4, 2, 3, 4, 0, -1, 0, 0]);
  assert.deepEqual(arr(R.seq.clipG), [0, 1, 0, 11, 1, 5, 0, 0]);
  assert.deepEqual(R.seq.outIds, ['t9'], 'deduplicated');
  s.clip.outTrack = 't2';
  R = Q.compileSeq(core.normalizeSerum(s));
  assert.deepEqual([R.seq.outIds, R.seq.arpG[6], R.seq.clipG[6]], [['t9', 't2'], 0, 1]);
});

test('§4.4 compileSeq: content keys, memoisation, UI-only fields, repair of non-normalized input, purity', () => {
  const s = richState(), A = Q.compileSeq(s), B = Q.compileSeq(clone(s));
  assert.equal(B.seqT, A.seqT, 'same content → the same seqT object');
  assert.notEqual(B.seq, A.seq);
  // UI-only fields change no key
  const u = clone(s);
  u.arp.slots[2].name = 'renamed'; u.arp.slots[2].pat.name = 'P'; u.arp.slots[2].pat.grid = 5; u.clip.clips[1].name = 'C'; u.arp.bank = 'B';
  u.arp.dirty = 1; u.arp.editAll = 1; u.clip.rec.mode = 1; u.clip.editAll = 1;
  assert.equal(Q.compileSeq(u).seqT.key, A.seqT.key);
  // one slot changed → its part only (other parts keep their objects)
  const v = clone(s);
  v.arp.slots[7].shape = 3; v.clip.clips[5].notes[0][3] = 64;
  const C = Q.compileSeq(v);
  assert.notEqual(C.seqT.key, A.seqT.key);
  assert.equal(C.seq.key, C.seqT.key);
  for (const n of Q.SEQT_PART_NAMES) {
    if (n === 'arp7' || n === 'clip5') assert.notEqual(C.seqT.parts[n].key, A.seqT.parts[n].key, n);
    else assert.equal(C.seqT.parts[n], A.seqT.parts[n], n);
  }
  // repairs: non-normalized parts are normalized first (never throws)
  const w = clone(s);
  w.arp.slots[2].pat.ev.reverse();
  assert.equal(Q.compileSeq(w).seqT.key, A.seqT.key, 'unsorted records are sorted');
  const junk = { arp: 7, clip: { clips: 'x' }, kbd: null, p: null, matrix: 5, osc: 3 };
  const J = Q.compileSeq(junk), D = Q.compileSeq(core.defaultSerum());
  assert.deepEqual([J.seqT.key, J.seq.active], [D.seqT.key, 0]);
  assert.doesNotThrow(() => Q.compileSeq(undefined));
  const bad = clone(s);
  bad.clip.clips[1].notes.push([1, NaN, 60]); bad.kbd.trans = 99; bad.arp.slots[0].n.gate = 7;
  assert.deepEqual(Q.compileSeq(bad).seq.kbd[0], 24);
  // a frozen input works and is not modified
  const f = richState(), snap = clone(f);
  const freeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  freeze(f);
  assert.equal(Q.compileSeq(f).seqT.key, A.seqT.key);
  assert.deepEqual(clone(f), snap);
  // worst case (4096 notes, every lane) compiles
  const big = core.defaultSerum();
  big.clip.clips.forEach((c, j) => { c.len = 1024; c.notes = Array.from({ length: j < 4 ? 1024 : 0 }, (_, i) => [i, 0.5, 40 + (i % 50), 100]);
    for (const k of Q.LANES_CLIP) c.lanes[k] = [[0, 0, 0], [1, 1, 0]]; });
  const G = Q.compileSeq(core.normalizeSerum(big)), GT = Q.assembleSeqT(G.seqT);
  assert.deepEqual([GT.clipNotes.length, GT.clipLane.length], [8 * 4096, 96 * 129]);
});

/* ------------------------------------------------------------------ SxSeq (§7.7, §11.9): tables, keyboard stage */

const seqScope = (opts = {}) => dspScope(Object.assign({ files: ['sx-base.js', 'sx-seq.js'] }, opts));
const act = sq => Object.assign({}, sq, { active: 1 });
const viewBytes = q => { let b = 0; for (const k in q) if (ArrayBuffer.isView(q[k])) b += q[k].byteLength; return b; };
function makeProc() {
  const calls = [];
  return { calls, sxNote(on, n, vel, ch, x, y, z, gen) { calls.push([on, n, vel, ch, gen]); } };
}
// the logical content of a Seq's tables per slot (offset fields excluded), comparable with assembleSeqT
function seqTables(q) {
  const out = { arp: [], clip: [] };
  for (let j = 0; j < 12; j++) {
    const row = arr(q.arp.slice(j * 40, j * 40 + 40)), evN = row[34], stN = row[36], mask = row[37];
    const lanes = [];
    for (let b = 0; b < 4; b++) if (mask & (1 << b)) lanes.push(...arr(q.arpLane.slice((j * 4 + b) * 129, (j * 4 + b + 1) * 129)));
    row[33] = row[35] = row[38] = 0;
    out.arp.push({ row, ev: arr(q.arpEv.slice(j * 512 * 5, j * 512 * 5 + 5 * evN)), strum: arr(q.arpStrum.slice(j * 1024, j * 1024 + 2 * stN)), lanes });
    const c = arr(q.clip.slice(j * 24, j * 24 + 24)), off = c[14], n = c[15], cm = c[16], cl = [];
    for (let b = 0; b < 8; b++) if (cm & (1 << b)) cl.push(...arr(q.clipLane.slice((j * 8 + b) * 129, (j * 8 + b + 1) * 129)));
    c[14] = c[17] = 0;
    out.clip.push({ row: c, notes: arr(q.clipNotes.slice(off * 8, (off + n) * 8)), lanes: cl });
  }
  return out;
}
function assembledTables(seqT) {
  const out = { arp: [], clip: [] };
  for (let j = 0; j < 12; j++) {
    const a = seqT.parts['arp' + j], c = seqT.parts['clip' + j];
    out.arp.push({ row: arr(a.row), ev: arr(a.ev), strum: arr(a.strum), lanes: arr(a.lane) });
    out.clip.push({ row: arr(c.row), notes: arr(c.notes), lanes: arr(c.lane) });
  }
  return out;
}

test('SxSeq: frozen global, final exports, environment-neutral load; constants equal seq-core', () => {
  const S = seqScope(), X = S.global('SxSeq');
  assert.ok(X && Object.isFrozen(X));
  assert.deepEqual(Object.keys(X), ['VER', 'N_SLOTS', 'MAX_EV', 'MAX_STRUM', 'MAX_NOTES', 'MAX_CLIP_NOTES', 'LANE_W', 'ARP_ROW', 'CLIP_ROW',
    'SCALE_REL', 'LAUNCH_BEATS', 'TIME_BEATS', 'GRID_BEATS', 'RRATE_BEATS', 'CLIP_RATE_MUL', 'SWING_DIV', 'ARP_LAD', 'scaleMask', 'quantize',
    'swingTime', 'Seq']);
  assert.deepEqual([X.VER, X.N_SLOTS, X.MAX_EV, X.MAX_STRUM, X.MAX_NOTES, X.MAX_CLIP_NOTES, X.LANE_W, X.ARP_ROW, X.CLIP_ROW],
    [Q.SQP_VER, Q.N_SLOTS, Q.MAX_EV, Q.MAX_STRUM, Q.MAX_BANK_NOTES, Q.MAX_CLIP_NOTES, Q.LANE_N + 1, Q.ARP_ROW, Q.CLIP_ROW]);
  for (const k of ['Seq']) assert.equal(typeof X[k], 'function');
  for (const m of ['apply', 'merge', 'next', 'fire', 'input', 'cmd', 'transport', 'panic', 'snapshot']) assert.equal(typeof X.Seq.prototype[m], 'function', m);
  assert.deepEqual(arr(X.SCALE_REL), Q.SCALES.map(sc => sc.steps.reduce((m, k) => m | (1 << k), 0)));
  assert.deepEqual(arr(X.LAUNCH_BEATS), Q.LAUNCH_QUANT.map(e => e.beats));
  assert.deepEqual(arr(X.TIME_BEATS), Q.TIME_LADDER.map(e => e.beats));
  assert.deepEqual(arr(X.GRID_BEATS), Q.GRID_LADDER.map(e => e.beats));
  assert.deepEqual(arr(X.RRATE_BEATS), Q.RRATE_LADDER.map(e => e.beats));
  assert.deepEqual(arr(X.CLIP_RATE_MUL), Q.CLIP_RATE_VALUES);
  assert.deepEqual(arr(X.SWING_DIV), Q.SWING_DIVS.map(e => e.beats));
  for (let v = 0; v < 4; v++) assert.deepEqual(arr(X.ARP_LAD[v]), Q.arpLadder(v & 1, v >> 1).map(e => e.beats));
  for (let key = -1; key < 12; key++) {
    for (let sc = 0; sc < 42; sc++) {
      const m = X.scaleMask(key, sc);
      assert.equal(m, Q.scaleMask(key, sc));
      for (let n = -12; n < 140; n++) assert.equal(X.quantize(n, key, m), Q.quantize(n, key, sc));
    }
  }
  for (const s of [0, -1, -0.3, 0.6, 1]) for (const d of [0.5, 0.25, 0.125]) for (let b = -1; b < 3; b += 0.0371) assert.equal(X.swingTime(b, s, d), Q.swingTime(b, s, d));
  // environment neutrality: loads without AudioWorklet globals; no console output; reads no other script's global
  const B = dspScope({ files: ['sx-seq.js'], bare: true });
  assert.ok(B.global('SxSeq'));
  assert.deepEqual(B.logs, []);
  assert.ok(!/\b(SxBase|SerumDSP|SxMod|FXDSP|sampleRate|currentFrame|window|document)\b/.test(source('sx-seq.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
});

test('SxSeq.Seq: apply / merge validate and copy; merge(part) ≡ full apply; pending clip parts; refusals', () => {
  const S = seqScope(), X = S.global('SxSeq');
  const s1 = richState(), R1 = Q.compileSeq(s1);
  const q = new X.Seq(makeProc());
  assert.equal(q.next(0), 1e9);
  // an inactive SQP: the parts are validated and kept by reference; an unused sequencer holds no pools (§14.2)
  assert.equal(q.apply(R1.seq, R1.seqT), true);
  assert.deepEqual([q.ok, q.active, q.key, q.tKey], [1, 0, R1.seq.key, R1.seqT.key]);
  assert.deepEqual(arr(q.kbd), arr(R1.seq.kbd));
  assert.ok(q.arpEv === null && q.clipNotes === null && viewBytes(q) < 32768, 'unused: ' + viewBytes(q) + ' bytes');
  // the first active apply allocates the pools and copies the kept parts
  assert.equal(q.apply(act(R1.seq)), true);
  assert.ok(viewBytes(q) > 600000);
  assert.deepEqual(seqTables(q), assembledTables(R1.seqT));
  assert.equal(q.cTotal, 4);
  // internal offsets: arp fixed regions, clip notes packed in slot order (= the assembled layout)
  const T1 = Q.assembleSeqT(R1.seqT);
  assert.deepEqual(arr(q.clipNotes.slice(0, T1.clipNotes.length)), arr(T1.clipNotes));
  for (let j = 0; j < 12; j++) {
    assert.deepEqual([q.arp[j * 40 + 33], q.arp[j * 40 + 35], q.arp[j * 40 + 38], q.clip[j * 24 + 17]], [j * 512, j * 512, j * 4, j * 8]);
    assert.equal(q.clip[j * 24 + 14], T1.clip[j * 24 + 14]);
  }
  // part-by-part in a shuffled order from another state ≡ a fresh full apply
  const s2 = clone(s1);
  s2.clip.clips[0].notes = Array.from({ length: 300 }, (_, i) => [i / 4, 0.25, 50 + (i % 20), 90]);
  s2.clip.clips[1].notes = [];
  s2.clip.clips[11].notes = [[0, 1, 72, 99]];
  s2.arp.slots[2].pat.ev = []; s2.arp.slots[9].pat.ev = [[1, 1, 3, 77, 0]]; s2.arp.slots[9].pat.lanes.chance = [[0, 1, 0], [1, 0, 0]];
  const R2 = Q.compileSeq(core.normalizeSerum(s2)), names = Q.SEQT_PART_NAMES.slice();
  for (let i = names.length - 1; i > 0; i--) { const k = (i * 7 + 3) % (i + 1), t = names[i]; names[i] = names[k]; names[k] = t; }
  for (const n of names) assert.equal(q.merge(R2.seqT.parts[n]), true, n);
  const fresh = new X.Seq(makeProc());
  fresh.apply(act(R2.seq), R2.seqT);
  assert.deepEqual(seqTables(q), seqTables(fresh));
  assert.deepEqual(seqTables(q), assembledTables(R2.seqT));
  assert.deepEqual(arr(q.clipNotes.slice(0, 8 * q.cTotal)), arr(Q.assembleSeqT(R2.seqT).clipNotes));
  // a clip that grows before another one shrinks waits until it fits
  const full = core.defaultSerum(), many = n => Array.from({ length: n }, (_, i) => [i, 0.5, 60, 100]);
  for (let j = 1; j <= 4; j++) { full.clip.clips[j].len = 1024; full.clip.clips[j].notes = many(1024); }
  const F1 = Q.compileSeq(core.normalizeSerum(full));
  const moved = clone(core.normalizeSerum(full));
  moved.clip.clips[0].len = 1024; moved.clip.clips[0].notes = many(1024); moved.clip.clips[1].notes = [];
  const F2 = Q.compileSeq(core.normalizeSerum(moved));
  const g = new X.Seq(makeProc());
  g.apply(act(F1.seq), F1.seqT);
  assert.equal(g.cTotal, 4096);
  assert.equal(g.merge(F2.seqT.parts.clip0), true);
  assert.ok(g.pend[0] !== null && g.cN[0] === 0, 'pending');
  assert.equal(g.merge(F2.seqT.parts.clip1), true);
  assert.ok(g.pend[0] === null && g.cN[0] === 1024 && g.cN[1] === 0 && g.cTotal === 4096, 'merged once the room exists');
  const gf = new X.Seq(makeProc());
  gf.apply(act(F2.seq), F2.seqT);
  assert.deepEqual(seqTables(g), seqTables(gf));
  // refusals leave the tables unchanged and warn once
  const logs = recorder(), S2 = seqScope({ console: logs }), r = new (S2.global('SxSeq').Seq)(makeProc());
  r.apply(act(R1.seq), R1.seqT);
  const before = seqTables(r), p = R1.seqT.parts;
  // value checks: everything used as a divisor, loop bound or index (pattern length 0 used to hang the audio thread)
  const rowed = (q0, f) => { const q1 = Object.assign({}, q0, { row: Float64Array.from(q0.row) }); f(q1.row, q1); return q1; };
  const bads = [null, 7, {}, { kind: 'arp', j: 12, row: p.arp0.row }, { kind: 'x', j: 0 }, Object.assign({}, p.arp2, { row: new Float64Array(39) }),
    Object.assign({}, p.arp2, { ev: new Float64Array(5) }), Object.assign({}, p.arp2, { lane: new Float32Array(129) }),
    Object.assign({}, p.clip1, { notes: new Float64Array(8) }), Object.assign({}, p.clip1, { row: Float64Array.from(p.clip1.row).fill(2000, 15, 16) }),
    Object.assign({}, p.clip1, { notes: Array.from(p.clip1.notes) }),
    rowed(p.arp2, r0 => { r0[28] = 0; }), rowed(p.arp2, r0 => { r0[28] = 2.5; }), rowed(p.arp2, r0 => { r0[29] = 8; }), rowed(p.arp2, r0 => { r0[30] = 0; }),
    rowed(p.arp2, r0 => { r0[0] = 18; }), rowed(p.arp2, r0 => { r0[32] = NaN; }), rowed(p.arp2, r0 => { r0[28] = 3; }),
    rowed(p.arp2, (r0, q1) => { q1.ev = Float64Array.from(q1.ev); q1.ev[10] = 1; }), rowed(p.arp2, (r0, q1) => { q1.ev = Float64Array.from(q1.ev); q1.ev[7] = 0; }),
    rowed(p.arp2, (r0, q1) => { q1.lane = Float32Array.from(q1.lane); q1.lane[3] = NaN; }),
    rowed(p.clip1, r0 => { r0[0] = 0; }), rowed(p.clip1, r0 => { r0[1] = 32; }), rowed(p.clip1, r0 => { r0[5] = 9; }), rowed(p.clip1, r0 => { r0[6] = -1; }),
    rowed(p.clip1, r0 => { r0[2] = 2; }), rowed(p.clip1, (r0, q1) => { q1.notes = Float64Array.from(q1.notes); q1.notes[8] = 100; }),
    rowed(p.clip1, (r0, q1) => { q1.notes = Float64Array.from(q1.notes); q1.notes[9] = Infinity; })];
  for (const b of bads) assert.equal(r.merge(b), false);
  for (const b of bads) assert.equal(new X.Seq(makeProc()).merge(b), false, 'refused before the pools exist as well');
  assert.deepEqual(seqTables(r), before);
  assert.equal(logs.msgs.filter(m => m.level === 'warn').length, 1);
  // invalid SQP: inert (and warns once)
  for (const bq of [null, {}, Object.assign({}, R1.seq, { ver: 2 }), Object.assign({}, R1.seq, { kbd: new Float64Array(7) }),
    Object.assign({}, R1.seq, { outIds: 'x' }), Object.assign({}, R1.seq, { kbd: Array.from(R1.seq.kbd) })]) {
    assert.equal(r.apply(bq), false);
    assert.equal(r.ok, 0);
  }
  assert.equal(logs.msgs.filter(m => m.level === 'warn').length, 2);
  assert.equal(r.apply(Object.assign({}, R1.seq, { ver: 1.1 })), true, 'minor versions accepted');
  assert.equal(r.apply(R1.seq, { parts: 5 }), true, 'a malformed seqT is ignored');
  assert.deepEqual(seqTables(r), before);
});

test('SxSeq.Seq: keyboard stage of input, commands, transport, snapshot (§7.1, §7.7, §7.10)', () => {
  const X = seqScope().global('SxSeq'), P = makeProc(), q = new X.Seq(P);
  const sqp = (f) => { const s = core.defaultSerum(); f(s); return Q.compileSeq(core.normalizeSerum(s)).seq; };
  // before any patch: notes pass unchanged (inert)
  q.input(1, 61, 0.8, 0, 0); q.input(0, 61, 0.5, 0, 10);
  assert.deepEqual(P.calls.splice(0), [[1, 61, 0.8, 0, 0], [0, 61, 0.5, 0, 0]]);
  // TRANSPOSE then KEY/SCALE: 61 + 2 = 63 → C major → 62 (tie down); the note-off releases 62 even after TRANSPOSE changes
  q.apply(sqp(s => { s.kbd.trans = 2; s.kbd.key = 0; s.kbd.scale = 0; }));
  q.input(1, 61, 0.9, 3, 0);
  q.apply(sqp(() => {}));
  q.input(0, 61, 0.2, 3, 5);
  assert.deepEqual(P.calls.splice(0), [[1, 62, 0.9, 3, 0], [0, 62, 0.2, 3, 0]]);
  // per channel; re-trigger of a held input note releases the previous output first; out-of-range results dropped with their off
  q.apply(sqp(s => { s.kbd.trans = 24; }));
  q.input(1, 60, 1, 0, 0); q.input(1, 60, 1, 1, 0); q.input(1, 60, 0.5, 0, 0); q.input(1, 110, 1, 0, 0);
  const snap = new Float64Array(16).fill(9);
  q.snapshot(snap);
  assert.equal(snap[3], 2, 'held input notes');
  q.input(0, 110, 0, 0, 0); q.input(0, 60, 0, 0, 0); q.input(0, 60, 0, 1, 0); q.input(0, 50, 0, 2, 0);
  assert.deepEqual(P.calls.splice(0), [[1, 84, 1, 0, 0], [1, 84, 1, 1, 0], [0, 84, 0, 0, 0], [1, 84, 0.5, 0, 0], [0, 84, 0, 0, 0], [0, 84, 0, 1, 0],
    [0, 50, 0, 2, 0]]);
  q.input(1, 128, 1, 0, 0); q.input(1, -1, 1, 0, 0); q.input(1, 60, 1, 99, 0); q.input(0, 60, 1, 0, 0);
  assert.deepEqual(P.calls.splice(0), [[1, 84, 1, 0, 0], [0, 84, 1, 0, 0]], 'invalid notes ignored; an invalid channel counts as 0');
  // commands, transport, panic, snapshot
  const logs = recorder(), q2 = new (seqScope({ console: logs }).global('SxSeq').Seq)(makeProc());
  for (const [c, a] of [['arpLaunch', 3], ['arpStop', 3], ['clipLaunch', 0], ['clipStop', 0], ['clipStopAll'], ['latch', 1]]) assert.equal(q2.cmd(c, a), true, c);
  assert.equal(q2.cmd('nope', 1), false);
  assert.equal(q2.cmd('nope2', 1), false);
  assert.equal(logs.msgs.length, 1);
  q2.transport(true);
  q2.input(1, 60, 1, 0, 0);
  q2.snapshot(snap);
  assert.deepEqual(arr(snap), [-1, 0, 0, 1, 0, -1, -1, -1, 0, 1, 1, 0, 0, 0, 0, 0]);
  q2.cmd('latch', 0); q2.transport(false); q2.panic();
  q2.snapshot(snap);
  assert.deepEqual([snap[3], snap[9], snap[10]], [0, 0, 0]);
  q2.snapshot(new Float64Array(4));            // too short: ignored
  assert.equal(q2.next(1234), 1e9);
  assert.equal(q2.fire(1234), undefined);
});

test('SxSeq.Seq: allocation-free after the first active apply (apply with parts, merge, input, commands, snapshot)', () => {
  const S = seqScope(), X = S.global('SxSeq'), P = makeProc(), q = new X.Seq(P);
  const R1 = Q.compileSeq(richState()), s2 = richState();
  s2.kbd.trans = 5; s2.kbd.key = 2; s2.clip.clips[3].notes = [[0, 1, 50, 100, 0, 0.5, 0.5, 0], [2, 1, 52, 100, 0, 0.5, 0.5, 0]];
  const R2 = Q.compileSeq(core.normalizeSerum(s2)), snap = new Float64Array(16);
  q.apply(R2.seq, R2.seqT);                                                  // the first active apply allocates the pools
  q.apply(R1.seq, R1.seqT);
  for (let k = 0; k < 4; k++) q.input(1, 60 + k, 1, 0, 0);                    // first calls (inline caches) before the check
  P.calls.length = 0;
  noAlloc(S, () => {
    for (let r = 0; r < 20; r++) {
      const R = r & 1 ? R2 : R1;
      q.apply(R.seq, R.seqT);
      for (const n of Q.SEQT_PART_NAMES) q.merge(R.seqT.parts[n]);
      for (let k = 0; k < 8; k++) { q.input(1, 40 + k, 0.7, k & 3, 0); q.input(0, 40 + k, 0, k & 3, 0); }
      q.cmd('arpLaunch', 2); q.cmd('latch', r & 1); q.transport(r & 1); q.next(r); q.fire(r); q.snapshot(snap);
    }
    q.panic();
  });
  assert.ok(P.calls.length > 0);
});

/* ------------------------------------------------------------------ SxSeq (§7): arpeggiator, clip player, keyboard, MIDI OUT */

// A Seq on a fake processor: CP and SQP from compileSerum (arp.on / clip.on bases, the ARP row velocity range); every sxNote
// call is logged as [frame, on, note, vel·127 (rounded), ch, gen, x, y, z]. o.procs = the PROCS registry (MIDI OUT).
function seqRig(mut, o = {}) {
  const S = o.scope || seqScope(), X = S.global('SxSeq'), s = core.defaultSerum();
  if (mut) mut(s);
  const patch = core.compileSerum(core.normalizeSerum(s), { bpm: 120 }), log = [];
  const P = {
    base: 48000, bpm: 120, F: 0, tp: { play: false, frame: 0, tick: 0, fpt: 25 }, p: { serum: patch.serum, seq: patch.seq },
    seqMacro: new Float64Array(8).fill(NaN), procs: o.procs,
    sxNote(on, n, vel, ch, x, y, z, gen) { log.push([this.F, on, n, Math.round(vel * 127), ch, gen, x, y, z]); },
  };
  const q = new X.Seq(P);
  q.apply(patch.seq, patch.seqT);
  return { S, X, q, P, log, patch };
}
// Engine-like span loop over [F0, F1): at each span start the inputs due (in order), then fire(F); the span ends at the
// next sequencer event (next(F)) or input, rounded up to g frames (the engine: 4), never crossing a 128-frame quantum.
function drive(R, F0, F1, inputs = [], g = 1) {
  const { q, P } = R, ev = inputs.slice().sort((a, b) => a[0] - b[0]);
  let F = F0;
  while (F < F1) {
    P.F = F;
    while (ev.length && ev[0][0] <= F) ev.shift()[1](F);
    q.fire(F);
    let d = q.next(F);
    if (ev.length && ev[0][0] - F < d) d = ev[0][0] - F;
    const end = Math.min(F1, (Math.floor(F / 128) + 1) * 128);
    F = Math.min(end, F + (g === 1 ? Math.max(1, Math.round(d)) : Math.max(g, Math.ceil(d / g) * g)));
  }
  P.F = F;
  return R.log;
}
const on = (R, F, n, v = 100, ch = 0) => [F, Fx => R.q.input(1, n, v / 127, ch, Fx)];
const off = (R, F, n, ch = 0) => [F, Fx => R.q.input(0, n, 0, ch, Fx)];
const at = (F, fn) => [F, fn];
const chord = (R, F, notes) => notes.map(n => on(R, F, n));
const ons = log => log.filter(e => e[1] === 1).map(e => [e[0], e[2]]);
const onv = log => log.filter(e => e[1] === 1).map(e => [e[0], e[2], e[3]]);
const ev4 = log => log.map(e => e.slice(0, 4));
// note-on pitches grouped by frame (chords sorted ascending)
const groups = log => {
  const out = [];
  let F = -1;
  for (const e of log) if (e[1] === 1) { if (e[0] !== F) { out.push([]); F = e[0]; } out[out.length - 1].push(e[2]); }
  return out.map(g => g.sort((a, b) => a - b));
};
// transport: play with seek at frame F from song tick `tick`; a loop wrap (position jump without a seek)
const play = (R, F, tick = 0) => at(F, () => { Object.assign(R.P.tp, { play: true, frame: F, tick }); R.q.transport(true); });
const jump = (R, F, tick) => at(F, () => { Object.assign(R.P.tp, { frame: F, tick }); });
const arpOn = (f) => s => { s.p['arp.on'] = 1; if (f) f(s, s.arp.slots[0]); };
const clipOn = (f) => s => { s.p['clip.on'] = 1; if (f) f(s, s.clip.clips[0]); };
const BAR4 = [[0, 1, 60, 100], [4, 1, 62, 90], [8, 1, 64, 80], [12, 1, 65, 70]];      // one note per beat, 1 bar

test('§7.4.4 arp timing: Up 1/16 at 120 BPM every 6000 frames ±0, gate 75 % → note-off at +4500; Hz rate; swing; grids', () => {
  let R = seqRig(arpOn());
  drive(R, 0, 60000, [...chord(R, 0, [60, 64, 67]), ...[60, 64, 67].map(n => off(R, 30000, n))]);
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 100], [4500, 0, 60, 0], [6000, 1, 64, 100], [10500, 0, 64, 0], [12000, 1, 67, 100], [16500, 0, 67, 0],
    [18000, 1, 60, 100], [22500, 0, 60, 0], [24000, 1, 64, 100], [28500, 0, 64, 0]], 'the keys released at a step boundary end the run');
  assert.ok(R.log.every(e => e[4] === 0 && e[5] === 1), 'generated notes: channel 0, gen 1');
  assert.deepEqual(R.log[0].slice(6), [0.5, 0.5, 0], 'neutral expression x, y, z');
  // the engine's span granularity (4 frames, 128-frame quanta) gives the same frames
  const R4 = seqRig(arpOn());
  drive(R4, 0, 60000, [...chord(R4, 0, [60, 64, 67]), ...[60, 64, 67].map(n => off(R4, 30000, n))], 4);
  assert.deepEqual(R4.log, R.log);
  // Hz mode (n.hz 0.5 → 5 Hz = 9600 frames), anchored at the first press (frames, no grid)
  R = seqRig(arpOn((s, a) => { a.bpm = 0; }));
  drive(R, 0, 30000, chord(R, 50, [60, 64]));
  assert.deepEqual(ev4(R.log), [[50, 1, 60, 100], [7250, 0, 60, 0], [9650, 1, 64, 100], [16850, 0, 64, 0], [19250, 1, 60, 100], [26450, 0, 60, 0],
    [28850, 1, 64, 100]]);
  // SWING (§7.2) moves the offbeat of each pair: s = 1, 1/16 → at 0.875 of the pair (0.4375 beat); s = −1, 1/8 → 0.125 of the pair
  R = seqRig(arpOn(s => { s.kbd.swing = 1; s.kbd.div = 1; }));
  drive(R, 0, 25000, chord(R, 0, [60, 64]));
  assert.deepEqual(ev4(R.log).slice(0, 6), [[0, 1, 60, 100], [7875, 0, 60, 0], [10500, 1, 64, 100], [11625, 0, 64, 0], [12000, 1, 60, 100], [19875, 0, 60, 0]]);
  R = seqRig(arpOn(s => { s.kbd.swing = -1; s.kbd.div = 0; }));
  drive(R, 0, 25000, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[0]), [0, 1500, 3000, 13500, 24000]);
  // stopped transport: the free clock restarts at beat 0 at the first press (idle → busy); a later key joins the running grid
  R = seqRig(arpOn());
  drive(R, 0, 25000, [on(R, 100, 60), on(R, 7000, 64)]);
  assert.deepEqual(ons(R.log), [[100, 60], [6100, 60], [12100, 60], [18100, 64], [24100, 60]]);
  // playing transport: the first step waits for the song's 1/16 grid (tick 970 → tick 1200 = frame 5750)
  R = seqRig(arpOn());
  drive(R, 0, 20000, [play(R, 0, 970), ...chord(R, 0, [60, 64])]);
  assert.deepEqual(ons(R.log), [[5750, 60], [11750, 64], [17750, 60]]);
  // RATE from the mono context (§7.3): eff arp.on from monoEff (a matrix row on arp.on makes the SQP active), the arp.rate
  // offset −0.125 (1/16 → 1/8) applied mid-run moves the next step onto the new RATE's grid (beat 1 = 24000, not 23000:
  // the arp stays on the song / free-clock grid), then steps of 12000 frames
  const mod = { monoOff: new Float64Array(429), monoEff: new Float64Array(429) };
  mod.monoEff[406] = 1;
  R = seqRig(s => { Object.assign(s.matrix[0], { src: 'lfo1', dst: 'arp.on', amt: 0.5 }); });
  R.P.sx = { mod };
  drive(R, 0, 40000, [...chord(R, 0, [60, 64, 67]), at(13000, () => { mod.monoOff[407] = -0.125; })]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, 67], [24000, 60], [36000, 64]]);
  mod.monoEff[406] = 0;
  drive(R, 40000, 60000);
  assert.deepEqual(ev4(R.log.slice(-1)), [[40000, 0, 64, 0]], 'eff arp.on off: the generated notes are released at once');
});

test('§7.4.1–7.4.2 the sequencer plays arpOrder / rangeOrder: every shape for N = 1…5, every RANGE shape for R = 1…4', () => {
  const H = [67, 60, 71, 64, 74];                    // arrival order (Played)
  for (let sh = 0; sh < 18; sh++) {
    if (sh === 1) continue;                          // Pattern: §7.4.3
    for (let N = 1; N <= 5; N++) {
      const notes = H.slice(0, N), R = seqRig(arpOn((s, a) => { a.shape = sh; }));
      drive(R, 0, 6000 * 20, chord(R, 0, notes));
      const got = groups(R.log), st = {}, want = [];
      while (want.length < got.length) want.push(...Q.arpOrder(sh, notes, st));     // random shapes: the same seed and draws
      assert.equal(got.length, 20, Q.ARP_SHAPES[sh] + ' N ' + N);
      assert.deepEqual(got, want.slice(0, 20).map(g => g.slice().sort((a, b) => a - b)), Q.ARP_SHAPES[sh] + ' N ' + N);
    }
  }
  for (let rs = 0; rs < 18; rs++) {
    for (let Rn = 1; Rn <= 4; Rn++) {
      const R = seqRig(arpOn((s, a) => { a.rshape = rs; a.n.range = (Rn - 1) / 7; }));
      drive(R, 0, 6000 * 16, [on(R, 0, 60)]);
      const got = groups(R.log), st = {}, want = [];
      while (want.length < got.length) want.push(...Q.rangeOrder(rs, Rn, st));
      assert.deepEqual(got, want.slice(0, 16).map(g => g.map(p => 60 + 12 * p)), Q.RANGE_SHAPES[rs] + ' R ' + Rn);
    }
  }
  // OFFSET rotates every deterministic order and Rand Once's drawn permutation (= arpOrder with state.offset)
  for (const sh of [7, 6, 8, 3, 12, 15]) {
    for (const off of [1, 2]) {
      const notes = [60, 62, 64, 65, 67], R = seqRig(arpOn((s, a) => { a.shape = sh; a.n.offset = off / 15; }));
      drive(R, 0, 6000 * 12, chord(R, 0, notes));
      const st = { offset: off }, want = [];
      while (want.length < 12) want.push(...Q.arpOrder(sh, notes, st));
      assert.deepEqual(groups(R.log), want.slice(0, 12), Q.ARP_SHAPES[sh] + ' offset ' + off);
    }
  }
  // SHIFT (n.shift → −24…+24 per pass), OFFSET rotates the order, ARP TRANSPOSE then KEY / SCALE on generated notes
  let R = seqRig(arpOn((s, a) => { a.n.range = 1 / 7; a.n.shift = 17 / 48; }));
  drive(R, 0, 6000 * 4, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 53, 57]);
  R = seqRig(arpOn((s, a) => { a.n.offset = 1 / 15; }));
  drive(R, 0, 6000 * 5, chord(R, 0, [60, 64, 67]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [64, 67, 60, 64, 67]);
  R = seqRig(arpOn((s, a) => { a.n.trans = 29 / 48; s.kbd.key = 0; s.kbd.scale = 0; }));
  drive(R, 0, 6000 * 2, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [65, 69], '+5 → F, A (C major)');
  R = seqRig(arpOn((s, a) => { a.n.trans = 27 / 48; s.kbd.key = 0; s.kbd.scale = 0; }));
  drive(R, 0, 6000 * 2, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [62, 67], '+3 → D# → D (tie down), G');
});

test('§7.4.4 CHANCE: the sequencer seed fixes the pattern; silent steps advance (default), Pre: they do not', () => {
  let x = 0x9E3779B9;
  const u = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const sound = Array.from({ length: 16 }, () => u() < 0.5), H = [60, 64, 67, 71];
  assert.ok(sound.some(Boolean) && !sound.every(Boolean));
  for (const pre of [0, 1]) {
    const R = seqRig(arpOn((s, a) => { a.n.chance = 0.5; a.chancePre = pre; }));
    drive(R, 0, 96000, chord(R, 0, H));
    const want = [];
    let pos = 0;
    sound.forEach((ok, k) => { if (ok) want.push([6000 * k, H[pos++ % 4]]); else if (!pre) pos++; });
    assert.deepEqual(ons(R.log), want, 'pre ' + pre);
  }
});

test('§7.4.5 LATCH (button and CC64 pedal), THRU, retrigger LAUNCH / RATE / NOTE / FIRST, REPEATS, VELOCITY', () => {
  // LATCH: released keys stay held; a key pressed while none is physically down replaces the set
  let R = seqRig(arpOn((s, a) => { a.latch = 1; }));
  drive(R, 0, 42000, [...chord(R, 0, [60, 64]), off(R, 1000, 60), off(R, 1000, 64), on(R, 25000, 72), off(R, 26000, 72)]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, 60], [18000, 64], [24000, 60], [30000, 72], [36000, 72]]);
  // pedal (cmd latch): down = latch on; up = back to the slot's LATCH (off): latched keys not physically held are released
  R = seqRig(arpOn());
  drive(R, 0, 50000, [at(0, () => R.q.cmd('latch', 1)), ...chord(R, 0, [60, 64]), off(R, 1000, 60), off(R, 1000, 64), on(R, 20000, 67),
    on(R, 21000, 71), off(R, 22000, 71), at(31000, () => R.q.cmd('latch', 0)), off(R, 40000, 67)]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, 60], [18000, 64], [24000, 67], [30000, 71], [36000, 67]]);
  const snap = new Float64Array(16);
  R.q.snapshot(snap);
  assert.deepEqual([snap[3], snap[10]], [0, 0]);
  // THRU: the input notes also pass unchanged (their channel, gen 0)
  R = seqRig(arpOn((s, a) => { a.thru = 1; }));
  drive(R, 0, 13000, [on(R, 0, 60, 100, 3), on(R, 0, 64, 90, 3), off(R, 7000, 60, 3)]);
  assert.deepEqual(R.log.filter(e => e[5] === 0).map(e => e.slice(0, 5)), [[0, 1, 60, 100, 3], [0, 1, 64, 90, 3], [7000, 0, 60, 0, 3]]);
  assert.deepEqual(ons(R.log.filter(e => e[5] === 1)), [[0, 60], [6000, 64], [12000, 64]]);
  // NOTE: any note-on restarts (the next step plays index 0)
  for (const [rn, w] of [[0, 67], [1, 60]]) {
    R = seqRig(arpOn((s, a) => { a.rNote = rn; }));
    drive(R, 0, 13000, [...chord(R, 0, [60, 64, 67, 71]), on(R, 7000, 74)]);
    assert.equal(ons(R.log)[2][1], w, 'rNote ' + rn);
  }
  // FIRST: a note-on while H was empty restarts; without it the position continues within a busy period (the re-press at
  // 9000 comes before the last note-off at 10500); a re-press from idle starts fresh either way (§7.2, render-last)
  for (const [rf, w] of [[0, [69, 62, 65]], [1, [62, 65, 69]]]) {
    R = seqRig(arpOn((s, a) => { a.rFirst = rf; }));
    drive(R, 0, 25000, [...chord(R, 0, [60, 64, 67]), ...[60, 64, 67].map(n => off(R, 7000, n)), ...chord(R, 9000, [62, 65, 69])]);
    assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, w[0]], [18000, w[1]], [24000, w[2]]], 'rFirst ' + rf);
    R = seqRig(arpOn((s, a) => { a.rFirst = rf; }));
    drive(R, 0, 33000, [...chord(R, 0, [60, 64, 67]), ...[60, 64, 67].map(n => off(R, 7000, n)), ...chord(R, 20000, [62, 65, 69])]);
    assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [20000, 62], [26000, 65], [32000, 69]], 'rFirst ' + rf + ' from idle');
  }
  // LAUNCH: a slot launch (quantised to LAUNCH QUANT 1/4 → beat 1) restarts only with rLaunch
  for (const [rl, w] of [[0, 64], [1, 60]]) {
    R = seqRig(arpOn((s, a) => { a.rLaunch = rl; }));
    drive(R, 0, 25000, [...chord(R, 0, [60, 64, 67]), at(7000, () => R.q.cmd('arpLaunch', 0))]);
    assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 67, 60, w], 'rLaunch ' + rl);
  }
  // RATE: restart every RRATE interval (n 0 → 1/4) on the grid; 1/8 steps over 3 notes
  R = seqRig(arpOn((s, a) => { a.rRate = 1; a.n.rrate = 0; a.n.rate = 5 / 8; }));
  drive(R, 0, 72000, chord(R, 0, [60, 64, 67]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 60, 64, 60, 64]);
  // REPEATS 2: two (shape × range) cycles, then silent until a fresh press after a full release
  R = seqRig(arpOn((s, a) => { a.n.repeats = 2 / 16; }));
  drive(R, 0, 100000, [...chord(R, 0, [60, 64]), off(R, 30000, 60), off(R, 30000, 64), ...chord(R, 50000, [62, 65])]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, 60], [18000, 64], [50000, 62], [56000, 65], [62000, 62], [68000, 65]]);
  // VELOCITY: v_run from the input velocity, v += (T − v)·0.5·|dec| (dec 1, target 0 → halves); VELOCITY RETRIG resets it at a restart
  R = seqRig(arpOn((s, a) => { a.vel = 1; a.n.vdecay = 1; a.n.vtarget = 0; }));
  drive(R, 0, 40000, [on(R, 0, 60, 120), on(R, 0, 64, 80)]);
  assert.deepEqual(onv(R.log).map(e => e[2]), [120, 60, 30, 15, 8, 4, 2]);
  for (const [vr, w] of [[0, [120, 60, 30, 15, 8, 4, 2]], [1, [120, 60, 30, 15, 70, 35, 18]]]) {
    R = seqRig(arpOn((s, a) => { Object.assign(a, { rNote: 1, vel: 1, vRetrig: vr }); a.n.vdecay = 1; a.n.vtarget = 0; }));
    drive(R, 0, 40000, [on(R, 0, 60, 120), on(R, 20000, 64, 70)]);
    assert.deepEqual(onv(R.log).map(e => e[2]), w, 'vRetrig ' + vr);
  }
  // negative decay: T = (1 − target)·127 (target 0 → rises to 127)
  R = seqRig(arpOn((s, a) => { a.vel = 1; a.n.vdecay = 0; a.n.vtarget = 0; }));
  drive(R, 0, 13000, [on(R, 0, 60, 27)]);
  assert.deepEqual(onv(R.log).map(e => e[2]), [27, 77, 102]);
});

test('§7.4.3 pattern: rows and WRAP, STEP MODE (Chord inversions, New Only), strum, accent, lengths, lanes, MODES', () => {
  const pat = (ev, P = {}, A = {}) => arpOn((s, a) => { Object.assign(a, { shape: 1 }, A); Object.assign(a.pat, { len: 4, ev }, P); });
  const ROWS = [[0, 1, 1, 100, 0], [1, 1, 2, 100, 0], [2, 1, 3, 100, 0], [3, 1, -3, 100, 0]];
  // rows 1, 2, 3, −3 over two held notes: Wrap (wrange 1, wtrans 12: ±12 per wrap), Phantom (silent), Clamp (highest / lowest)
  for (const [wrap, w] of [[0, [60, 64, 72, 52]], [1, [60, 64]], [2, [60, 64, 64, 60]]]) {
    const R = seqRig(pat(ROWS, { wrap }, { n: Object.assign({}, Q.ARP_N, { wrange: 1 / 8 }) }));
    drive(R, 0, 24000, chord(R, 0, [60, 64]));
    assert.deepEqual(ons(R.log).map(e => e[1]), w, 'wrap ' + wrap);
  }
  // wrange 0: no transposition (mod 1)
  let R = seqRig(pat(ROWS));
  drive(R, 0, 24000, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 60, 64]);
  // STEP MODE Chord: every event plays H, inversion row − 1 raises the lowest notes an octave (rows < 0 lower the highest)
  R = seqRig(pat([[0, 1, 1, 100, 0], [1, 1, 2, 100, 0], [2, 1, 3, 100, 0], [3, 1, -2, 100, 0]], { stepMode: 2 }));
  drive(R, 0, 24000, chord(R, 0, [60, 64, 67]));
  assert.deepEqual(groups(R.log), [[60, 64, 67], [64, 67, 72], [67, 72, 76], [55, 60, 64]]);
  // strum 0.5 at t = 0: note j of the ascending chord starts j·a·D/N later (D = 6000, N = 3 → 1000 frames apart)
  R = seqRig(pat([[0, 1, 1, 100, 0]], { stepMode: 2, strum: [[0, 0.5]] }));
  drive(R, 0, 6000, chord(R, 0, [67, 60, 64]));
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 100], [1000, 1, 64, 100], [2000, 1, 67, 100], [4500, 0, 60, 0], [5500, 0, 64, 0]]);
  // accent × 1.3 (≤ 127); length = len16 · GATE steps
  R = seqRig(pat([[0, 2, 1, 100, 1], [2, 0.5, 2, 50, 0]]));
  drive(R, 0, 24000, chord(R, 0, [60, 64]));
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 127], [9000, 0, 60, 0], [12000, 1, 64, 50], [14250, 0, 64, 0]]);
  // lanes: vel (y·127), gate (× gate), x (expression X of the generated notes)
  R = seqRig(pat([[0, 1, 1, 100, 0], [2, 1, 1, 100, 0]], { lanes: { vel: [[0, 0, 0], [1, 1, 0]], gate: [[0, 0.5, 0], [1, 0.5, 0]], chance: null,
    x: [[0, 0.25, 0], [1, 0.25, 0]] } }));
  drive(R, 0, 24000, [on(R, 0, 60)]);
  assert.deepEqual(R.log.map(e => e.slice(0, 4).concat(e[1] ? e.slice(6) : [])), [[0, 1, 60, 1, 0.25, 0.5, 0], [2250, 0, 60, 0],
    [12000, 1, 60, 64, 0.25, 0.5, 0], [14250, 0, 60, 0]]);
  // chance lane 0: silent
  R = seqRig(pat([[0, 1, 1, 100, 0]], { lanes: { vel: null, gate: null, chance: [[0, 0, 0], [1, 0, 0]], x: null } }));
  drive(R, 0, 24000, [on(R, 0, 60)]);
  assert.deepEqual(R.log, []);
  // New Only: an event plays only the notes that arrived since the previous event
  R = seqRig(pat([0, 1, 2, 3].map(t => [t, 1, 1, 100, 0]), { stepMode: 1 }));
  drive(R, 0, 48000, [on(R, 0, 60), on(R, 7000, 64), on(R, 25000, 55)]);
  assert.deepEqual(ons(R.log), [[0, 60], [12000, 64], [30000, 55]]);
  // MODES over rows 1…4 of four held notes
  const UP4 = [0, 1, 2, 3].map(t => [t, 1, t + 1, 100, 0]), H = [60, 62, 64, 65];
  const mode = (m, F1, P = {}) => { const X = seqRig(pat(UP4, Object.assign({ mode: m }, P))); drive(X, 0, F1, chord(X, 0, H)); return ons(X.log); };
  assert.deepEqual(mode(1, 48000).map(e => e[1]), [60, 65, 64, 62, 60, 65, 64, 62], 'Reverse');
  assert.deepEqual(mode(2, 54000), [[0, 60], [6000, 62], [12000, 64], [18000, 65], [30000, 65], [36000, 64], [42000, 62], [48000, 60]], 'Pendulum');
  assert.deepEqual(mode(6, 72000).map(e => e[1]), [60, 62, 64, 65], 'One Shot');
  assert.deepEqual(mode(3, 72000), mode(3, 72000), 'Random: seeded');
  assert.equal(mode(3, 72000, { time: 0 }).length, 12);
  // Rand Start: every loop of the pattern starts at a random sixteenth and plays a whole loop (rotations of 60 62 64 65)
  const rs = mode(4, 96000, { len: 4 }).map(e => e[1]);
  for (let k = 0; k < 16; k += 4) assert.ok([0, 1, 2, 3].some(r => [0, 1, 2, 3].every(i => rs[k + i] === H[(r + i) % 4])), 'Rand Start rotation');
  // Static: the events at position 0 at every (re)trigger, held for their length
  R = seqRig(pat([[0, 1, 1, 100, 0], [0, 1, 3, 100, 0], [1, 1, 2, 100, 0]], { mode: 7 }));
  drive(R, 0, 48000, chord(R, 0, H));
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 100], [0, 1, 64, 100], [4500, 0, 60, 0], [4500, 0, 64, 0]]);
  // RANGE passes advance once per pattern loop
  R = seqRig(pat([[0, 1, 1, 100, 0], [2, 1, 2, 100, 0]], {}, { n: Object.assign({}, Q.ARP_N, { range: 1 / 7 }) }));
  drive(R, 0, 6000 * 12, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 72, 76, 60, 64]);
});

test('§7.4.6 slots: trigger-octave launch quantised to LAUNCH QUANT, arpStop / arpLaunch, UI selection, Hz / BPM switch', () => {
  // note 1 of the trigger octave (trigOct 1 = notes 0–11) launches slot 1 (Down) at the next 1/4 (beat 1); the key is consumed
  let R = seqRig(arpOn(s => { s.arp.slots[1].shape = 6; }));
  drive(R, 0, 48000, [...chord(R, 0, [60, 64, 67]), on(R, 7000, 1), off(R, 7100, 1)]);
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 67, 60, 67, 64, 60, 67]);
  const snap = new Float64Array(16);
  R.q.snapshot(snap);
  assert.deepEqual([snap[0], snap[3]], [1, 3], 'playing slot 1, three held notes');
  // trigOct 0 (off): note 1 is an ordinary held note
  R = seqRig(arpOn(s => { s.arp.trigOct = 0; }));
  drive(R, 0, 12000, chord(R, 0, [1, 60]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [1, 60]);
  // arpStop silences the slot; arpLaunch of a stopped arp starts at the next RATE grid point (42000)
  R = seqRig(arpOn());
  drive(R, 0, 60000, [...chord(R, 0, [60, 64]), at(13000, () => R.q.cmd('arpStop', 0)), at(40000, () => R.q.cmd('arpLaunch', 0))]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, 60], [42000, 60], [48000, 64], [54000, 60]]);
  // a UI selection (seq.arpG[3]) never launches (§13.7: tap = select): the running arp keeps its slot; an idle arp plays
  // the selected slot at the next press; the play button (arpLaunch) switches at LAUNCH QUANT
  R = seqRig(arpOn(s => { s.arp.slots[2].shape = 6; }));
  drive(R, 0, 13000, chord(R, 0, [60, 64, 67]));
  const s2 = core.defaultSerum();
  s2.p['arp.on'] = 1; s2.arp.slots[2].shape = 6; s2.arp.sel = 2;
  const P2 = core.compileSerum(core.normalizeSerum(s2), { bpm: 120 });
  R.q.apply(P2.seq, P2.seqT);
  drive(R, 13000, 36000);
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 67, 60, 64, 67], 'selection while running: no launch');
  drive(R, 36000, 80000, [at(37000, () => R.q.cmd('arpLaunch', 2))]);
  assert.deepEqual(ons(R.log).slice(6).map(e => e[1]), [60, 64, 67, 64, 60, 67, 64, 60], 'the play button launches it at the next 1/4 (48000)');
  assert.deepEqual(ons(R.log)[8], [48000, 67]);
  R = seqRig(arpOn(s => { s.arp.slots[2].shape = 6; }));
  R.q.apply(P2.seq, P2.seqT);
  drive(R, 0, 13000, chord(R, 0, [60, 64, 67]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [67, 64, 60], 'idle: the selected slot plays');
  // preset / undo: a selection change applied while running launches nothing either (and the next idle press follows it)
  R = seqRig(arpOn(s => { s.arp.slots[2].shape = 6; }));
  drive(R, 0, 7000, chord(R, 0, [60, 64, 67]));
  R.q.apply(P2.seq, P2.seqT);
  R.q.apply(R.patch.seq, R.patch.seqT);
  drive(R, 7000, 13000);
  assert.deepEqual(ons(R.log).map(e => e[1]), [60, 64, 67]);
});

test('§7.5 clip player: launch quantised on the song grid, RETRIG on / off, MONO / POLY, modes, VELO TRIG, rate / transpose', () => {
  // transport from tick 0: a launch at beat 1.25 with LAUNCH QUANT 1 bar starts at beat 4; RETRIG off and 1/4: the clip plays
  // as if it had run since song zero (beat 2 → sixteenth 8 → E4), RETRIG on starts at the offset marker
  let R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, retrig: 0 })));
  drive(R, 0, 120000, [play(R, 0), at(30000, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ev4(R.log), [[96000, 1, 60, 100], [102000, 0, 60, 0]]);
  for (const [rt, w] of [[0, [64, 65, 60]], [1, [60, 62, 64]]]) {
    R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, retrig: rt, quant: 4 })));
    drive(R, 0, 100000, [play(R, 0), at(30000, () => R.q.cmd('clipLaunch', 0))]);
    assert.deepEqual(ons(R.log), [[48000, w[0]], [72000, w[1]], [96000, w[2]]], 'retrig ' + rt);
  }
  // RETRIG on: playhead = off + eff clip.offset·len (n.offset 0.25 → sixteenth 4)
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 0, n: { trans: 0.5, rate: 0.5, offset: 0.25 } })));
  drive(R, 0, 30000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ons(R.log), [[0, 62], [24000, 64]]);
  // stopped transport: the free clock restarts at the launch (beat 0), so a 1-bar quantised launch starts at once
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0 })));
  drive(R, 0, 100000, [at(1000, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ev4(R.log).slice(0, 3), [[1000, 1, 60, 100], [7000, 0, 60, 0], [25000, 1, 62, 90]]);
  // a note crossing the loop end is cut there; the loop region is [start, len)
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 8, start: 4, notes: [[0, 1, 50, 100], [4, 1, 60, 100], [6, 4, 64, 100]], kb: 0, quant: 0 })));
  drive(R, 0, 30000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 100], [6000, 0, 60, 0], [12000, 1, 64, 100], [24000, 0, 64, 0], [24000, 1, 60, 100]]);
  // MONO trigger: a launch stops the playing clip at the same quantised time; POLY: both play
  const two = (s, c) => { Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 4 }); Object.assign(s.clip.clips[1], { len: 16, notes: [[0, 1, 48, 100], [2, 1, 50, 100]], kb: 0, quant: 4 }); };
  for (const [trig, w] of [[0, [[0, 60], [24000, 62], [48000, 48], [60000, 50]]], [1, [[0, 60], [24000, 62], [48000, 64], [48000, 48], [60000, 50], [72000, 65]]]]) {
    R = seqRig(clipOn((s, c) => { s.clip.trig = trig; two(s, c); }));
    drive(R, 0, 90000, [at(0, () => R.q.cmd('clipLaunch', 0)), at(30000, () => R.q.cmd('clipLaunch', 1))]);
    assert.deepEqual(ons(R.log), w, 'trig ' + trig);
  }
  // clipStop / clipStopAll are quantised; clip.on off stops at once
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 4 })));
  drive(R, 0, 100000, [at(0, () => R.q.cmd('clipLaunch', 0)), at(30000, () => R.q.cmd('clipStopAll'))]);
  assert.deepEqual(ons(R.log), [[0, 60], [24000, 62]]);
  // modes: Reverse, Pendulum, One Shot, Static (the notes covering the start held until the stop), Rand.End, seeded randoms
  const mode = (m, F1, C = {}) => {
    const X = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 0, mode: m, time: 2 }, C)));
    drive(X, 0, F1, [at(0, () => X.q.cmd('clipLaunch', 0)), at(F1 - 1, () => X.q.cmd('clipStop', 0))]);
    return X.log;
  };
  assert.deepEqual(ons(mode(1, 200000)).map(e => e[1]), [60, 65, 64, 62, 60, 65, 64, 62, 60]);
  assert.deepEqual(ons(mode(2, 200000)), [[0, 60], [24000, 62], [48000, 64], [72000, 65], [120000, 65], [144000, 64], [168000, 62], [192000, 60]]);
  assert.deepEqual(ons(mode(3, 200000)).map(e => e[1]), [60, 62, 64, 65]);
  assert.deepEqual(ev4(mode(8, 40000, { notes: [[0, 6, 60, 100], [0, 1, 64, 100], [2, 1, 67, 100]] })), [[0, 1, 60, 100], [0, 1, 64, 100],
    [39999, 0, 60, 0], [39999, 0, 64, 0]]);
  for (const m of [4, 5, 6, 7]) {
    const a = ons(mode(m, 300000)), b = ons(mode(m, 300000));
    assert.deepEqual(a, b, 'mode ' + m + ' seeded');
    assert.ok(a.every(e => e[0] % 24000 === 0), 'mode ' + m + ': slices of 1/4 start on the beat');
  }
  const nd = ons(mode(5, 400000));                    // Rand.No Dup: a slice never repeats directly
  for (let k = 1; k < nd.length; k++) assert.notEqual(nd[k][1], nd[k - 1][1]);
  // VELO TRIG (× the trigger velocity), clip.trans (+5) and clip.rate (×2) bases
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, veloTrig: 1 })));
  drive(R, 0, 30000, [on(R, 0, 60, 64)]);
  assert.deepEqual(onv(R.log), [[0, 60, 50], [24000, 62, 45]]);
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, n: { trans: 29 / 48, rate: 0.8, offset: 0 } })));
  drive(R, 0, 30000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ev4(R.log), [[0, 1, 65, 100], [3000, 0, 65, 0], [12000, 1, 67, 90], [15000, 0, 67, 0], [24000, 1, 69, 80], [27000, 0, 69, 0]]);
  // note expression x / y / z goes with the note
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: [[0, 1, 60, 100, 0, 0.1, 0.2, 0.3]], kb: 0 })));
  drive(R, 0, 100, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(R.log[0].slice(5), [1, 0.1, 0.2, 0.3]);
});

test('§7.5.4 KB SPAN Mono / Poly / Offset, NOTE GATE, trigger-octave clips, clip → arp; §7.5.5 macro lanes; loop wraps', () => {
  // Mono: the first key launches (RETRIG), the latest held key transposes by k − 60; releasing it returns to the key below
  let R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4 })));
  drive(R, 0, 100000, [on(R, 500, 62), on(R, 30000, 67), off(R, 50000, 67)]);
  assert.deepEqual(ons(R.log), [[500, 62], [24500, 64], [48500, 71], [72500, 67], [96500, 62]]);
  // NOTE GATE: releasing all keys stops at once
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, noteGate: 1 })));
  drive(R, 0, 100000, [on(R, 500, 60), off(R, 30000, 60)]);
  assert.deepEqual(ev4(R.log), [[500, 1, 60, 100], [6500, 0, 60, 0], [24500, 1, 62, 90], [30000, 0, 62, 0]]);
  // Poly: a playhead copy per key; NOTE GATE stops a copy at its key's release
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 2, noteGate: 1 })));
  drive(R, 0, 80000, [on(R, 0, 60), on(R, 0, 67), off(R, 50000, 67)]);
  assert.deepEqual(ons(R.log), [[0, 60], [0, 67], [24000, 62], [24000, 69], [48000, 64], [48000, 71], [72000, 65]]);
  // Offset: key k starts at (k − 60)·offQ beats (offQ 1/4: key 61 → sixteenth 4)
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 3, offQ: 0 })));
  drive(R, 0, 50000, [on(R, 0, 61)]);
  assert.deepEqual(ons(R.log), [[0, 62], [24000, 64], [48000, 65]]);
  // KB SPAN Off: input notes pass; a trigger-octave key toggles its clip (the stop quantised to 1 bar), the key is consumed
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0 })));
  drive(R, 0, 100000, [on(R, 0, 0), off(R, 100, 0), on(R, 30000, 0), off(R, 30100, 0), on(R, 40000, 72), off(R, 41000, 72)]);
  assert.deepEqual(ons(R.log), [[0, 60], [24000, 62], [40000, 72], [48000, 64], [72000, 65]]);
  // trigger key + NOTE GATE: the key's release stops its clip
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, noteGate: 1 })));
  drive(R, 0, 100000, [on(R, 0, 0), off(R, 30000, 0)]);
  assert.deepEqual(ons(R.log), [[0, 60], [24000, 62]]);
  // clip → arp: the clip's notes are held by the arpeggiator
  R = seqRig(clipOn((s, c) => { s.p['arp.on'] = 1; Object.assign(c, { len: 16, notes: BAR4, kb: 0 }); }));
  drive(R, 0, 30000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ons(R.log), [[0, 60], [24000, 62]]);
  R = seqRig(clipOn((s, c) => { s.p['arp.on'] = 1; Object.assign(c, { len: 16, notes: [[0, 2, 60, 100], [0, 2, 64, 100]], kb: 0 }); }));
  drive(R, 0, 12000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64]]);
  // macro lanes: proc.seqMacro[k] = the lane value at the playhead while the clip plays, NaN otherwise
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 0, lanes: Object.assign({}, c.lanes, { m1: [[0, 0, 0], [1, 1, 0]], m4: [[0, 0.3, 0], [1, 0.3, 0]] }) })));
  drive(R, 0, 48000, [at(0, () => R.q.cmd('clipLaunch', 0)), at(48000, () => {})]);
  R.q.fire(48000);
  assert.ok(Math.abs(R.P.seqMacro[0] - 0.5) < 1e-6 && Math.abs(R.P.seqMacro[3] - 0.3) < 1e-6);
  assert.ok(Number.isNaN(R.P.seqMacro[1]));
  const snap = new Float64Array(16);
  R.q.snapshot(snap);
  assert.deepEqual([snap[4], snap[5], snap[6], snap[7], snap[8]], [1, 8, 0, 8, 2], 'clip mask, selected playhead, recent clip, beat');
  drive(R, 48000, 49000, [at(48000, () => R.q.cmd('clipStop', 0))]);
  assert.ok(Number.isNaN(R.P.seqMacro[0]));
  // a loop wrap (position jump without a seek): RETRIG-off clips resync to the song position, RETRIG-on clips continue
  for (const [rt, w] of [[0, [60, 62, 64, 65, 60, 62, 60, 62]], [1, [60, 62, 64, 65, 60, 62, 64, 65]]]) {
    R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 0, retrig: rt })));
    drive(R, 0, 192000, [play(R, 0), at(0, () => R.q.cmd('clipLaunch', 0)), jump(R, 144000, 0)]);
    assert.deepEqual(ons(R.log).map(e => e[1]), w, 'retrig ' + rt);
  }
});

test('§4.4 / §7.7 edits while playing (merge of a part): notes re-seek, new geometry continues, a pattern restarts', () => {
  const part = (mut, name) => { const s = core.defaultSerum(); mut(s); return Q.compileSeq(core.normalizeSerum(s)).seqT.parts[name]; };
  const clip0 = (C) => s => { s.p['clip.on'] = 1; Object.assign(s.clip.clips[0], { kb: 0, quant: 0 }, C); };
  // notes added behind (t 2) and ahead (t 8) of the playhead (sixteenth 5): the one ahead plays now, the one behind next loop
  let R = seqRig(clip0({ len: 16, notes: [[0, 1, 60, 100]] }));
  const add = part(clip0({ len: 16, notes: [[0, 1, 60, 100], [2, 1, 50, 100], [8, 1, 70, 100]] }), 'clip0');
  drive(R, 0, 120000, [at(0, () => R.q.cmd('clipLaunch', 0)), at(30000, () => assert.equal(R.q.merge(add), true))]);
  assert.deepEqual(ons(R.log), [[0, 60], [48000, 70], [96000, 60], [108000, 50]]);
  // the clip shrinks from 4 bars to 1 at sixteenth 5: the playhead goes on at 5 in the new region (next loop start at 96000)
  const N4 = [[0, 1, 60, 100], [16, 1, 62, 100], [32, 1, 64, 100], [48, 1, 65, 100]];
  R = seqRig(clip0({ len: 64, notes: N4 }));
  drive(R, 0, 200000, [at(0, () => R.q.cmd('clipLaunch', 0)), at(30000, () => R.q.merge(part(clip0({ len: 16, notes: N4 }), 'clip0')))]);
  assert.deepEqual(ons(R.log), [[0, 60], [96000, 60], [192000, 60]]);
  // to Static (the notes covering the playhead, held) and back (from the frozen position)
  const N3 = [[0, 6, 60, 100], [4, 4, 62, 100], [8, 1, 64, 100]];
  R = seqRig(clip0({ len: 16, notes: N3 }));
  drive(R, 0, 90000, [at(0, () => R.q.cmd('clipLaunch', 0)), at(30000, () => R.q.merge(part(clip0({ len: 16, notes: N3, mode: 8 }), 'clip0'))),
    at(60000, () => R.q.merge(part(clip0({ len: 16, notes: N3 }), 'clip0')))]);
  assert.deepEqual(R.log.map(e => e.slice(0, 3)), [[0, 1, 60], [24000, 1, 62], [30000, 0, 60], [30000, 0, 62], [30000, 1, 60], [30000, 1, 62],
    [60000, 0, 60], [60000, 0, 62], [78000, 1, 64], [84000, 0, 64]]);
  // pattern events added behind / ahead of the playhead; a new LENGTH restarts the pattern at the next step
  const arp0 = (P) => s => { s.p['arp.on'] = 1; s.arp.slots[0].shape = 1; Object.assign(s.arp.slots[0].pat, P); };
  R = seqRig(arp0({ len: 16, ev: [[0, 1, 1, 100, 0]] }));
  drive(R, 0, 120000, [on(R, 0, 60), on(R, 0, 64), at(33000, () => R.q.merge(part(arp0({ len: 16, ev: [[0, 1, 1, 100, 0], [2, 1, 2, 100, 0], [8, 1, 2, 100, 0]] }), 'arp0')))]);
  assert.deepEqual(ons(R.log), [[0, 60], [48000, 64], [96000, 60], [108000, 64]]);
  R = seqRig(arp0({ len: 16, ev: [[0, 1, 1, 100, 0], [12, 1, 2, 100, 0]] }));
  drive(R, 0, 120000, [on(R, 0, 60), on(R, 0, 64), at(33000, () => R.q.merge(part(arp0({ len: 8, ev: [[0, 1, 1, 100, 0], [4, 1, 2, 100, 0]] }), 'arp0')))]);
  assert.deepEqual(ons(R.log), [[0, 60], [36000, 60], [60000, 64], [84000, 60], [108000, 64]]);
});

test('§7.6 keyboard panel: transpose and KEY / SCALE once, ARP row of OSC MAPPING (key range, FOLD, velocity range)', () => {
  // clip notes: + clip transpose + keyboard transpose, then KEY / SCALE (D major: 60 + 1 → 61 = C#)
  let R = seqRig(clipOn((s, c) => { Object.assign(s.kbd, { trans: 1, key: 2, scale: 0 }); Object.assign(c, { len: 16, notes: BAR4, kb: 0 }); }));
  drive(R, 0, 30000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ons(R.log).map(e => e[1]), [61, 62], '61 C#; 63 D# → D (tie down)');
  // arp: input transposed once (60 + 2 → 62), generated notes quantised (shift +12 / pass)
  R = seqRig(arpOn((s, a) => { s.kbd.trans = 2; a.n.range = 1 / 7; }));
  drive(R, 0, 12000, [on(R, 0, 60)]);
  assert.deepEqual(ons(R.log).map(e => e[1]), [62, 74]);
  // key range 60…72: 50 passes; velocity range 1…100 (CP.mapVLo / mapVHi[5]): 66 at velocity 110 passes
  R = seqRig(arpOn(s => { s.kbd.arpMap = { k: [60, 72], v: [1, 100], fold: 0 }; }));
  drive(R, 0, 13000, [on(R, 0, 50), on(R, 0, 64), on(R, 0, 66, 110), off(R, 10000, 50), off(R, 10000, 66)]);
  assert.deepEqual(R.log.map(e => [e[0], e[1], e[2], e[5]]), [[0, 1, 50, 0], [0, 1, 66, 0], [0, 1, 64, 1], [4500, 0, 64, 1], [6000, 1, 64, 1],
    [10000, 0, 50, 0], [10000, 0, 66, 0], [10500, 0, 64, 1], [12000, 1, 64, 1]]);
  // FOLD: notes outside the range are folded in by octaves (50 → 62, 80 → 68)
  R = seqRig(arpOn(s => { s.kbd.arpMap = { k: [60, 72], v: [1, 127], fold: 1 }; }));
  drive(R, 0, 13000, chord(R, 0, [50, 64, 80]));
  assert.deepEqual(ons(R.log).map(e => e[1]), [62, 64, 68]);
});

test('§7.9 MIDI OUT inside the audio thread: taps, one quantum of latency, note-offs to the same target, no chains', () => {
  const target = () => { const L = []; return { L, extNote(F, o, n, v) { L.push([F, o, n, Math.round(v * 127)]); } }; };
  // On (arp pane): the final output, 128 frames later
  let T = target(), R = seqRig(arpOn(s => { s.arp.midiOut = 2; s.arp.outTrack = 't2'; }), { procs: new Map([['t2', T]]) });
  drive(R, 0, 13000, chord(R, 0, [60, 64]));
  assert.deepEqual(T.L, ev4(R.log).map(e => [e[0] + 128, e[1], e[2], e[3]]));
  assert.equal(T.L.length, 5);
  // Clip Player (clip pane): the clip output before the arpeggiator, with the clip notes' own lengths
  T = target();
  R = seqRig(clipOn((s, c) => { s.p['arp.on'] = 1; s.clip.midiOut = 1; s.clip.outTrack = 't2'; Object.assign(c, { len: 16, kb: 0, notes: [[0, 2, 60, 100], [4, 2, 62, 90]] }); }),
    { procs: new Map([['t2', T]]) });
  drive(R, 0, 40000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(T.L, [[128, 1, 60, 100], [12128, 0, 60, 0], [24128, 1, 62, 90], [36128, 0, 62, 0]]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 60], [24000, 62], [30000, 62]], 'the arp plays the clip locally');
  // notes delivered by another track's MIDI OUT (ext) are played but never forwarded again
  T = target();
  R = seqRig(s => { s.kbd.trans = 1; s.arp.midiOut = 2; s.arp.outTrack = 't2'; }, { procs: new Map([['t2', T]]) });
  drive(R, 0, 4000, [at(0, () => R.q.input(1, 60, 0.5, 0, 0, 1)), at(1000, () => R.q.input(0, 60, 0, 0, 1000, 1)), on(R, 2000, 62), off(R, 3000, 62)]);
  assert.deepEqual(ev4(R.log), [[0, 1, 61, 64], [1000, 0, 61, 0], [2000, 1, 63, 100], [3000, 0, 63, 0]]);
  assert.deepEqual(T.L, [[2128, 1, 63, 100], [3128, 0, 63, 0]]);
  // the note-off goes to the processor that received the note-on, even after the target changed; a missing target drops events
  T = target();
  const U = target(), reg = new Map([['t2', T], ['t3', U]]);
  R = seqRig(arpOn(s => { s.arp.midiOut = 2; s.arp.outTrack = 't2'; }), { procs: reg });
  drive(R, 0, 1000, [on(R, 0, 60)]);
  const s3 = core.defaultSerum();
  s3.p['arp.on'] = 1; s3.arp.midiOut = 2; s3.arp.outTrack = 't3';
  const P3 = core.compileSerum(core.normalizeSerum(s3), { bpm: 120 });
  R.q.apply(P3.seq, P3.seqT);
  drive(R, 1000, 7000);
  assert.deepEqual([T.L, U.L], [[[128, 1, 60, 100], [4628, 0, 60, 0]], [[6128, 1, 60, 100]]]);
  R = seqRig(arpOn(s => { s.arp.midiOut = 2; s.arp.outTrack = 'gone'; }), { procs: reg });
  assert.doesNotThrow(() => drive(R, 0, 7000, [on(R, 0, 60)]));
  // panic sends the pending note-offs to the targets
  R.q.panic();
  T = target();
  R = seqRig(arpOn(s => { s.arp.midiOut = 2; s.arp.outTrack = 't2'; }), { procs: new Map([['t2', T]]) });
  drive(R, 0, 1000, [on(R, 0, 60)]);
  R.q.fire(1000);
  R.q.panic();
  assert.deepEqual(T.L, [[128, 1, 60, 100], [1128, 0, 60, 0]]);
});

test('§7.8 transport and determinism: seek reseeds and re-anchors, stop releases, polling independence, sample accuracy', () => {
  const mut = s => {
    s.p['arp.on'] = 1; s.p['clip.on'] = 1; s.kbd.swing = 0.4;
    Object.assign(s.arp.slots[0], { shape: 14, rshape: 15, n: Object.assign({}, Q.ARP_N, { chance: 0.7, range: 2 / 7 }) });
    Object.assign(s.arp.slots[1], { shape: 1 });
    Object.assign(s.arp.slots[1].pat, { len: 8, mode: 3, time: 1, ev: [[0, 1, 1, 100, 0], [1.5, 1, 2, 90, 1], [3, 2, -1, 80, 0], [5, 1, 4, 70, 0]] });
    Object.assign(s.clip.clips[0], { len: 16, kb: 0, mode: 5, time: 1, quant: 2, notes: [[0, 2, 48, 100], [3, 1, 50, 90], [6, 3, 53, 80], [11, 1, 55, 70]] });
  };
  const script = (R, o) => [on(R, o, 60), on(R, o + 1000, 64), on(R, o + 3000, 67), at(o + 5000, () => R.q.cmd('clipLaunch', 0)), play(R, o + 40000, 333),
    on(R, o + 60000, 13), off(R, o + 61000, 13), off(R, o + 150000, 64), on(R, o + 170000, 72), jump(R, o + 200000, 0), off(R, o + 230000, 60)];
  const A = seqRig(mut);
  drive(A, 0, 300000, script(A, 0));
  assert.ok(A.log.length > 60);
  // extra next / fire polls at arbitrary frames change nothing
  const B = seqRig(mut), polls = [];
  for (let F = 7; F < 300000; F += 37 + (F % 11)) polls.push(at(F, () => {}));
  drive(B, 0, 300000, script(B, 0).concat(polls));
  assert.deepEqual(B.log, A.log);
  // the engine's quanta and 4-frame granularity at another absolute frame offset (a multiple of 4): the same events, shifted
  const C = seqRig(mut), o = 128 * 37 + 44;
  drive(C, o, o + 300000, script(C, o), 4);
  const E = seqRig(mut);
  drive(E, 0, 300000, script(E, 0), 4);
  assert.deepEqual(C.log.map(e => [e[0] - o].concat(e.slice(1))), E.log);
  // play with seek: the PRNG is reseeded and the arp restarts on the song grid, so a render from a tick repeats exactly
  const rnd = () => seqRig(arpOn((s, a) => { a.shape = 14; }));
  const R1 = rnd();
  drive(R1, 0, 60000, [...chord(R1, 0, [60, 62, 64, 65, 67]), play(R1, 0, 0)]);
  const R2 = rnd();
  drive(R2, 0, 160000, [...chord(R2, 0, [60, 62, 64, 65, 67]), play(R2, 100000, 0)]);
  assert.deepEqual(ons(R2.log).filter(e => e[0] >= 100000).map(e => [e[0] - 100000, e[1]]), ons(R1.log));
  // transport(false) releases the generated notes (§7.8); the arp and the clip go on with the free clock (transport stop is not a
  // §7.5.1 stop source): the clip's next loop (beat 4 → 96000) feeds the arp again
  const R3 = seqRig(clipOn((s, c) => { s.p['arp.on'] = 1; Object.assign(c, { len: 16, notes: [[0, 16, 48, 100]], kb: 0, quant: 0 }); s.arp.slots[0].n.gate = 1; }));
  drive(R3, 0, 100000, [play(R3, 0), at(0, () => R3.q.cmd('clipLaunch', 0)), on(R3, 0, 72), at(14000, () => { R3.P.tp.play = false; R3.q.transport(false); })]);
  const after = R3.log.filter(e => e[0] >= 14000).map(e => e.slice(0, 3));
  assert.deepEqual(after.slice(0, 5), [[14000, 0, 72], [14000, 0, 48], [18000, 1, 72], [24000, 0, 72], [24000, 1, 72]],
    'the arp’s notes (incl. the one from the clip) released; the arp goes on with the key');
  const snapS = new Float64Array(16);
  R3.q.snapshot(snapS);
  assert.deepEqual([snapS[4], snapS[9]], [1, 0], 'the clip still plays, the transport is stopped');
  assert.ok(R3.log.some(e => e[0] === 96000 && e[1] === 1 && e[2] === 48), 'the clip note at its next loop start');
});

test('§7.8 seeks and loop wraps: paused restarts (no skipped note replayed), anchors inside the span granule, live = offline', () => {
  const T405 = 40.5 * 960, quantBar = (s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 6 });
  // a forward seek off the quant grid (beat 2.5 → 40.5) while a RETRIG-on clip plays: nothing until the next bar (beat 44 =
  // 144000), then the clip from its offset; the paused playhead stays at sixteenth 10 (snapshot)
  let R = seqRig(clipOn(quantBar));
  const snap = new Float64Array(16);
  drive(R, 0, 200000, [play(R, 0), at(0, () => R.q.cmd('clipLaunch', 0)), play(R, 60000, T405), at(100000, () => R.q.snapshot(snap))]);
  assert.deepEqual(ons(R.log), [[0, 60], [24000, 62], [48000, 64], [144000, 60], [168000, 62], [192000, 64]]);
  assert.deepEqual([snap[4], snap[5]], [1, 10]);
  // the same for a clip launched while stopped and a song started at beat 40.5, a KB SPAN-held clip, a backward seek (to
  // beat 0.5: no stale notes of the old schedule until the restart at beat 4)
  for (const [name, ins] of [['stopped', R0 => [at(0, () => R0.q.cmd('clipLaunch', 0)), play(R0, 60000, T405)]],
    ['KB SPAN', R0 => [play(R0, 0), on(R0, 0, 60), play(R0, 60000, T405)]], ['backward', R0 => [play(R0, 0), at(0, () => R0.q.cmd('clipLaunch', 0)), play(R0, 60000, 480)]]]) {
    R = seqRig(clipOn((s, c) => { quantBar(s, c); if (name === 'KB SPAN') c.kb = 1; }));
    drive(R, 0, 200000, ins(R));
    assert.deepEqual(ons(R.log), [[0, 60], [24000, 62], [48000, 64], [144000, 60], [168000, 62], [192000, 64]], name);
  }
  // a running pattern arp is paused until its restart even when its part is merged or its SHAPE edited meanwhile
  const pat8 = row => arpOn((s, a) => { a.shape = 1; Object.assign(a.pat, { len: 16, ev: [0, 2, 4, 6, 8, 10, 12, 14].map(t => [t, 1, row, 100, 0]) }); s.arp.quant = 6; });
  const p2 = Q.compileSeq(core.normalizeSerum((() => { const s = core.defaultSerum(); pat8(2)(s); return s; })())).seqT.parts.arp0;
  R = seqRig(pat8(1));
  drive(R, 0, 200000, [...chord(R, 0, [60, 64]), play(R, 60000, T405), at(61000, () => R.q.merge(p2))]);
  assert.deepEqual(ons(R.log), [[0, 60], [12000, 60], [24000, 60], [36000, 60], [48000, 60], [144000, 64], [156000, 64], [168000, 64], [180000, 64], [192000, 64]]);
  const down = Q.compileSeq(core.normalizeSerum((() => { const s = core.defaultSerum(); s.p['arp.on'] = 1; s.arp.slots[0].shape = 6; return s; })())).seqT.parts.arp0;
  R = seqRig(arpOn(s => { s.arp.quant = 6; }));
  drive(R, 0, 160000, [...chord(R, 0, [60, 64, 67]), play(R, 60000, T405), at(61000, () => R.q.merge(down))]);
  assert.deepEqual(ons(R.log).filter(e => e[0] >= 60000), [[144000, 67], [150000, 64], [156000, 60]]);
  // LAUNCH QUANT Off: a seek restarts a running arp on its RATE grid (tick 1000 → the next 1/16 = beat 1.25 → 6000)
  R = seqRig(arpOn(s => { s.arp.quant = 0; }));
  drive(R, 0, 20000, [...chord(R, 0, [60, 64]), play(R, 1000, 1000)]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 60], [12000, 64], [18000, 60]]);
  // transport anchors 1–3 frames before the span that applies them (engine granularity 4): the events at the anchor are
  // due at once — the arp's first step on beat 0, a RETRIG-off clip's downbeat note, a RETRIG-on clip at bar 1 (not 2) —
  // and the render equals the offline one (anchor at frame 0) up to the granularity
  const mix = clipOn((s, c) => { s.p['arp.on'] = 1; s.arp.quant = 4; s.clip.trig = 1; Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 6, retrig: 0 });
    Object.assign(s.clip.clips[1], { len: 16, notes: [[0, 1, 48, 100], [8, 1, 50, 100]], kb: 0, quant: 6, retrig: 1 }); });
  const O = seqRig(mix);
  drive(O, 0, 108000, [play(O, 0, 0), at(0, () => O.q.cmd('clipLaunch', 0)), at(0, () => O.q.cmd('clipLaunch', 1))], 4);
  assert.deepEqual(ons(O.log), [[0, 48], [24000, 62], [48000, 50], [72000, 65], [96000, 48]]);
  for (const lag of [1, 2, 3]) {
    const A = 12004 - lag, L = seqRig(mix);
    drive(L, 0, 120000, [at(0, () => L.q.cmd('clipLaunch', 0)), at(0, () => L.q.cmd('clipLaunch', 1)), play(L, 12004, 0, A)], 4);
    const got = ons(L.log).filter(e => e[0] >= 12004);
    assert.deepEqual(got.map(e => e[1]), ons(O.log).map(e => e[1]), 'lag ' + lag);
    assert.ok(got.every((e, i) => e[0] - A - ons(O.log)[i][0] >= 0 && e[0] - A - ons(O.log)[i][0] < 4), 'lag ' + lag + ': ' + JSON.stringify(got));
  }
  // a loop wrap whose frame is not a multiple of 4 (1-bar loop at 133 BPM): a RETRIG-off clip keeps its loop-start note
  {
    const fpt = 48000 * 60 / 133 / 960, Lp = 3840 * fpt, W = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 0, retrig: 0 })));
    W.P.tp.fpt = fpt;
    const ins = [at(0, () => { Object.assign(W.P.tp, { play: true, frame: 0, tick: 0, fpt }); W.q.transport(true); }), at(0, () => W.q.cmd('clipLaunch', 0))];
    for (let k = 1; k <= 4; k++) { const Fb = k * Lp; ins.push(at(Math.ceil(Fb / 4) * 4, () => Object.assign(W.P.tp, { frame: Fb, tick: 0 }))); }
    drive(W, 0, Math.floor(4.99 * Lp), ins, 4);
    assert.ok(Lp % 4 !== 0);
    assert.deepEqual(ons(W.log).map(e => e[1]), [0, 1, 2, 3, 4].flatMap(() => [60, 62, 64, 65]));
  }
  // an input event 1–3 frames after a grid point (a song note delivered at the next 4-frame span) counts as on the point
  for (const [late, w] of [[3, 24003], [5, 30000]]) {
    R = seqRig(arpOn());
    drive(R, 0, 40000, [play(R, 0), on(R, 24000 + late, 60)]);
    assert.equal(ons(R.log)[0][0], w, 'arp kick ' + late + ' frames late');
    R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, quant: 6 })));
    drive(R, 0, 200000, [play(R, 0), on(R, 96000 + late, 60)]);
    assert.equal(ons(R.log)[0][0], late === 3 ? 96003 : 192000, 'KB SPAN launch ' + late + ' frames late');
  }
});

test('§7.4.5 RETRIGGER RATE: restarts after REPEATS / One Shot, a pattern restarts exactly on the RRATE grid; the stop button stays', () => {
  // REPEATS 1 + RATE 1/4: one cycle (60 64) per beat
  let R = seqRig(arpOn((s, a) => { a.n.repeats = 1 / 16; a.rRate = 1; a.n.rrate = 0; }));
  drive(R, 0, 100000, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [24000, 60], [30000, 64], [48000, 60], [54000, 64], [72000, 60], [78000, 64], [96000, 60]]);
  // a One Shot pattern + RATE 1 bar (the default RRATE): the pattern once per bar
  R = seqRig(arpOn((s, a) => { a.shape = 1; a.rRate = 1; Object.assign(a.pat, { len: 4, mode: 6, ev: [0, 1, 2, 3].map(t => [t, 1, (t % 2) + 1, 100, 0]) }); }));
  drive(R, 0, 200000, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log).map(e => e[0]), [0, 6000, 12000, 18000, 96000, 102000, 108000, 114000, 192000, 198000]);
  // sparse pattern events (0 and 3 of 16) with RATE 1/4: restarts every beat on the grid → steps 0, 3, 4, 7, 8, 11, 12
  R = seqRig(arpOn((s, a) => { a.shape = 1; a.rRate = 1; a.n.rrate = 0; Object.assign(a.pat, { len: 16, ev: [[0, 1, 1, 100, 0], [3, 1, 2, 100, 0]] }); }));
  drive(R, 0, 6000 * 13, chord(R, 0, [60, 64]));
  assert.deepEqual(ons(R.log), [[0, 60], [18000, 64], [24000, 60], [42000, 64], [48000, 60], [66000, 64], [72000, 60]]);
  // RATE switched on (a merged part) long after the run stopped: the stale boundary moves to the next one on the grid
  const on8 = Q.compileSeq(core.normalizeSerum((() => { const s = core.defaultSerum(); s.p['arp.on'] = 1; Object.assign(s.arp.slots[0], { rRate: 1 });
    s.arp.slots[0].n.repeats = 1 / 16; s.arp.slots[0].n.rrate = 0; return s; })())).seqT.parts.arp0;
  R = seqRig(arpOn((s, a) => { a.n.repeats = 1 / 16; a.n.rrate = 0; }));
  drive(R, 0, 80000, [...chord(R, 0, [60, 64]), at(50000, () => R.q.merge(on8))]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [72000, 60], [78000, 64]]);
  // the stop button is not undone by RATE
  R = seqRig(arpOn((s, a) => { a.rRate = 1; a.n.rrate = 0; }));
  drive(R, 0, 100000, [...chord(R, 0, [60, 64]), at(13000, () => R.q.cmd('arpStop', 0))]);
  assert.deepEqual(ons(R.log), [[0, 60], [6000, 64], [12000, 60]]);
});

test('§7.5 Static: a restart releases the previous snapshot (KB SPAN Mono relaunch, seek); §7.5.2 RETRIG off with the clip RATE', () => {
  // KB SPAN Mono, RETRIG on, NOTE GATE off: each first key relaunches; only the latest chord sounds
  let R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: [[0, 4, 60, 100], [0, 4, 64, 100], [0, 4, 67, 100]], mode: 8, quant: 0 })));
  drive(R, 0, 100000, [on(R, 0, 60), off(R, 10000, 60), on(R, 20000, 65), off(R, 30000, 65), on(R, 40000, 67), off(R, 50000, 67)]);
  const sounding = log => { const m = new Set(); for (const e of log) { if (e[1]) m.add(e[2]); else m.delete(e[2]); } return [...m].sort((a, b) => a - b); };
  assert.deepEqual(sounding(R.log), [67, 71, 74]);
  assert.deepEqual(R.log.filter(e => e[0] === 20000).map(e => e.slice(1, 3)), [[0, 60], [0, 64], [0, 67], [1, 65], [1, 69], [1, 72]]);
  // RETRIG off and two seeks: the snapshot at each new position replaces the previous one
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: [[0, 4, 60, 100], [4, 4, 62, 100], [8, 8, 64, 100]], kb: 0, mode: 8, quant: 0, retrig: 0 })));
  drive(R, 0, 200000, [play(R, 0), at(0, () => R.q.cmd('clipLaunch', 0)), play(R, 50000, 1440), play(R, 100000, 2400)]);
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 100], [50000, 0, 60, 0], [50000, 1, 62, 100], [100000, 0, 62, 0], [100000, 1, 64, 100]]);
  assert.deepEqual(sounding(R.log), [64]);
  // RETRIG off at RATE ×2 (n.rate 0.8): launched at beat 1.25, quantised to 1/4 → beat 2; playhead = 4·2·2 mod 16 = 0 (the
  // literal formula without the rate would give sixteenth 8, E4); a loop wrap (beat 6 → 0) continues seamlessly
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, retrig: 0, quant: 4, n: { trans: 0.5, rate: 0.8, offset: 0 } })));
  drive(R, 0, 100000, [play(R, 0), at(30000, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual(ons(R.log), [[48000, 60], [60000, 62], [72000, 64], [84000, 65], [96000, 60]]);
  R = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, retrig: 0, quant: 0, n: { trans: 0.5, rate: 0.8, offset: 0 } })));
  drive(R, 0, 200000, [play(R, 0), at(30000, () => R.q.cmd('clipLaunch', 0)), jump(R, 144000, 0)]);
  assert.deepEqual(ons(R.log).map(e => e[0]), [36000, 48000, 60000, 72000, 84000, 96000, 108000, 120000, 132000, 144000, 156000, 168000, 180000, 192000]);
  assert.deepEqual(ons(R.log).slice(8).map(e => e[1]), [65, 60, 62, 64, 65, 60]);
});

test('SxSeq.Seq: an inactive SQP releases everything at once (generated notes, players, macro lanes); idle phrases start fresh', () => {
  // an arp note (gate 200 %) fed by a clip with a macro lane: a default (inactive) patch stops it all inside apply()
  const R = seqRig(clipOn((s, c) => { s.p['arp.on'] = 1; s.arp.slots[0].n.gate = 1; Object.assign(c, { len: 16, notes: [[0, 8, 48, 100]], kb: 0, quant: 0,
    lanes: Object.assign({}, c.lanes, { m1: [[0, 0.8, 0], [1, 0.8, 0]] }) }); }));
  drive(R, 0, 3000, [at(0, () => R.q.cmd('clipLaunch', 0)), on(R, 0, 72), off(R, 1000, 72)]);
  assert.deepEqual([ev4(R.log), Math.round(R.P.seqMacro[0] * 100)], [[[0, 1, 48, 100]], 80]);
  const D = core.compileSerum(core.defaultSerum(), { bpm: 120 });
  R.P.p = { serum: D.serum, seq: D.seq };
  R.P.F = 3000;
  assert.equal(R.q.apply(D.seq, D.seqT), true);
  assert.deepEqual(ev4(R.log).slice(1), [[3000, 0, 48, 0]]);
  assert.deepEqual([R.q.nOff, R.q.nOn, R.q.aRun, R.q.heldN, Array.from(R.q.pSt).some(x => x), Number.isNaN(R.P.seqMacro[0])], [0, 0, 0, 0, false, true]);
  // an invalid SQP clears the macro lanes as well
  const R2 = seqRig(clipOn((s, c) => Object.assign(c, { len: 16, notes: BAR4, kb: 0, quant: 0, lanes: Object.assign({}, c.lanes, { m2: [[0, 0.3, 0], [1, 0.3, 0]] }) })));
  drive(R2, 0, 1000, [at(0, () => R2.q.cmd('clipLaunch', 0))]);
  assert.ok(Math.abs(R2.P.seqMacro[1] - 0.3) < 1e-6);
  R2.q.apply(null);
  assert.ok(Number.isNaN(R2.P.seqMacro[1]) && R2.log.length === 2 && R2.log[1][1] === 0);
  // a phrase started from idle equals a fresh processor's output (render-last replays the input group, §12.6): positions,
  // PRNG, velocity run (Up, Rand, Rand Drift with VELOCITY)
  for (const sh of [7, 14, 16]) {
    const mut = arpOn((s, a) => { a.shape = sh; a.vel = 1; a.n.vdecay = 0.8; });
    const L = seqRig(mut);
    drive(L, 0, 80000, [...chord(L, 0, [60, 64, 67]), ...[60, 64, 67].map(n => off(L, 13000, n)), ...chord(L, 40000, [60, 64, 67, 71])]);
    const N = seqRig(mut);
    drive(N, 0, 40000, chord(N, 0, [60, 64, 67, 71]));
    assert.deepEqual(L.log.filter(e => e[0] >= 40000).map(e => [e[0] - 40000].concat(e.slice(1))), N.log, Q.ARP_SHAPES[sh]);
  }
});

test('§7.4.3 / §7.9 a pitch twice in one group sounds once; MIDI OUT: one delivery per target when both panes tap', () => {
  // Chord inversion 2 over 60 + 72: 60 is raised to 72 → one 72 (not a zero-length note cut by its double)
  let R = seqRig(arpOn((s, a) => { a.shape = 1; Object.assign(a.pat, { len: 4, stepMode: 2, ev: [[0, 1, 2, 90, 0]] }); }));
  drive(R, 0, 6000, chord(R, 0, [60, 72]));
  assert.deepEqual(ev4(R.log), [[0, 1, 72, 90], [4500, 0, 72, 0]]);
  // RANGE 2 with SHIFT 0: both passes give 60 → one note per step
  R = seqRig(arpOn((s, a) => { a.n.range = 1 / 7; a.n.shift = 0.5; a.rshape = 13; }));
  drive(R, 0, 7000, [on(R, 0, 60)]);
  assert.deepEqual(ev4(R.log), [[0, 1, 60, 100], [4500, 0, 60, 0], [6000, 1, 60, 100]]);
  // CLIP pane Clip Player + ARP pane On to the same target: each clip note once (the On tap skips it); input notes still go out
  const tgt = () => ({ L: [], extNote(F, o, n) { this.L.push([F, o, n]); } }), T = tgt(), U = tgt();
  const mk = (arpOut) => seqRig(s => { s.p['clip.on'] = 1; s.clip.midiOut = 1; s.clip.outTrack = 't2'; s.arp.midiOut = 2; s.arp.outTrack = arpOut;
    s.kbd.key = 2; s.kbd.scale = 0; Object.assign(s.clip.clips[0], { len: 16, notes: [[0, 2, 60, 100]], kb: 0, quant: 0 }); }, { procs: new Map([['t2', T], ['t3', U]]) });
  R = mk('t2');
  drive(R, 0, 20000, [at(0, () => R.q.cmd('clipLaunch', 0)), on(R, 15000, 62), off(R, 16000, 62)]);
  assert.deepEqual(T.L, [[128, 1, 60], [12128, 0, 60], [15128, 1, 62], [16128, 0, 62]]);
  assert.deepEqual(ev4(R.log).slice(0, 2), [[0, 1, 59, 100], [12000, 0, 59, 0]], 'played locally after KEY (D major: 60 → 59)');
  T.L.length = 0;
  R = mk('t3');
  drive(R, 0, 20000, [at(0, () => R.q.cmd('clipLaunch', 0))]);
  assert.deepEqual([T.L, U.L], [[[128, 1, 60], [12128, 0, 60]], [[128, 1, 59], [12128, 0, 59]]], 'different targets: each tap delivers');
});

test('SxSeq.Seq: allocation-free while the arpeggiator, patterns, clips and MIDI OUT run', () => {
  const S = seqScope(), T = { n: 0, extNote() { this.n++; } };
  const R = seqRig(s => {
    s.p['arp.on'] = 1; s.p['clip.on'] = 1; s.kbd.swing = 0.3; s.kbd.key = 4; s.arp.midiOut = 2; s.arp.outTrack = 't'; s.clip.trig = 1;
    Object.assign(s.arp.slots[0], { shape: 1, latch: 1, vel: 1 });
    Object.assign(s.arp.slots[0].pat, { len: 8, mode: 2, stepMode: 2, ev: [[0, 1, 1, 100, 1], [2, 1, -2, 90, 0], [5, 2, 6, 80, 0]], strum: [[0, 0.4]],
      lanes: { vel: [[0, 0.2, 0], [1, 1, 0]], gate: null, chance: [[0, 1, 0], [1, 0.5, 0]], x: null } });
    Object.assign(s.arp.slots[3], { shape: 15, n: Object.assign({}, Q.ARP_N, { range: 3 / 7 }), rshape: 14 });
    Object.assign(s.clip.clips[0], { len: 16, kb: 2, mode: 4, time: 1, quant: 2, notes: [[0, 2, 48, 100], [3, 1, 50, 90], [6, 3, 53, 80]],
      lanes: Object.assign({}, s.clip.clips[0].lanes, { m2: [[0, 0, 0], [1, 1, 0]] }) });
    Object.assign(s.clip.clips[1], { len: 8, kb: 0, mode: 2, quant: 0, notes: [[1, 1, 70, 100], [5, 2, 72, 100]] });
  }, { scope: S, procs: new Map([['t', T]]) });
  // edits merged while playing (parts built outside the checked region): clip 1 shorter (new geometry), arp 0 / clip 0 notes
  const PT = R.patch.seqT.parts, mk = (p, f) => { const q = Object.assign({}, p, { row: Float64Array.from(p.row) }); f(q); return q; };
  const edits = { clip1: mk(PT.clip1, q => { q.row[0] = 6; }), arp0: mk(PT.arp0, q => { q.ev = Float64Array.from(q.ev); q.ev[5] = 1; }), clip0: PT.clip0 };
  for (const k in edits) assert.equal(new R.X.Seq({}).merge(edits[k]), true, k);
  const inputs = F => [...chord(R, F, [60, 64, 67]), on(R, F + 700, 62), off(R, F + 3000, 64), at(F + 9000, () => R.q.cmd('clipLaunch', 1)),
    at(F + 20000, () => R.q.cmd('arpLaunch', 3)), play(R, F + 30000, 100), at(F + 50000, () => R.q.cmd('latch', 1)), off(R, F + 52000, 60),
    at(F + 60000, () => R.q.cmd('latch', 0)), jump(R, F + 70000, 0), at(F + 75000, () => R.q.merge(edits.clip1)), at(F + 76000, () => R.q.merge(edits.arp0)),
    at(F + 77000, () => R.q.merge(edits.clip0)), at(F + 80000, () => R.q.cmd('clipStopAll')), at(F + 90000, () => R.q.cmd('arpLaunch', 0))];
  drive(R, 0, 100000, inputs(0));                       // warm-up: inline caches, first calls
  R.q.panic();
  const list = inputs(100000), n0 = R.log.length;
  T.n = 0;
  R.P.tp.play = false; R.q.transport(false);
  noAlloc(S, () => drive(R, 100000, 200000, list));
  if (process.env.SEQ_DEBUG) console.log(JSON.stringify(R.log.slice(n0).map(e => e.slice(0, 6))));
  assert.ok(R.log.length - n0 > 20 && T.n > 20, (R.log.length - n0) + ' / ' + T.n);
});

test('§14.1 row o: arp 1/32 at 180 BPM + 4 POLY clip playheads cost ≤ 1.5 × 0.003 of real time (engine-like spans)', async () => {
  const S = seqScope({ fast: true }), X = S.global('SxSeq'), s = core.defaultSerum();
  s.p['arp.on'] = 1; s.p['clip.on'] = 1; s.arp.slots[0].n.rate = 7 / 8; s.clip.trig = 1;
  for (let j = 0; j < 4; j++) Object.assign(s.clip.clips[j], { len: 16, kb: 0, quant: 0, notes: range(16).map(i => [i, 0.5, 48 + 5 * j + (i % 3), 100]) });
  const patch = core.compileSerum(core.normalizeSerum(s), { bpm: 180 });
  let notes = 0;
  const P = { base: 48000, bpm: 180, tp: { play: true, frame: 0, tick: 0, fpt: 48000 * 60 / 180 / 960 }, p: { serum: patch.serum, seq: patch.seq },
    seqMacro: new Float64Array(8).fill(NaN), sxNote() { notes++; } };
  const q = new X.Seq(P);
  q.apply(patch.seq, patch.seqT);
  q.transport(true);
  let F = 0;
  const second = () => {                               // 1 s of audio: 128-frame quanta split at sequencer events (4-frame grid)
    for (const end = F + 48000; F < end; F += 128) {
      for (let f = F; f < F + 128;) {
        q.fire(f);
        const d = q.next(f);
        f = Math.min(F + 128, f + (d < 128 ? Math.max(4, Math.ceil(d / 4) * 4) : 128));
      }
    }
  };
  for (const n of [60, 64, 67]) q.input(1, n, 0.8, 0, 0);
  for (let j = 0; j < 4; j++) q.cmd('clipLaunch', j);
  for (let i = 0; i < 3; i++) second();
  // tests/cpu-gate.mjs: calibrated pairs (row (b) through ref-p1), median per-pair ratio, retries (RULINGS2 Performance)
  const g = await CPU.gateLoad(second, 0.003);
  const snap = new Float64Array(16);
  q.snapshot(snap);
  assert.deepEqual([snap[0], snap[4]], [0, 15], 'the arp and four clips run');
  assert.ok(notes > 100);
  assert.ok(g.load <= 1.5 * 0.003, 'load ' + g.load.toFixed(5) + ' (raw ' + g.raw.toFixed(5) + ', attempt ' + g.attempt + ')');
});

/* ------------------------------------------------------------------ §7.5.6, §13.3.2 helpers */

test('§7.5.6 clip actions: slicesToNotes / withSlices, wrapAt / wrapClip, recExtend, clipTrackNotes, clipToSmf (hand-written SMF bytes)', () => {
  // 2 s at 120 BPM = 16 sixteenths; marks at ¼ and ½
  assert.deepEqual(Q.slicesToNotes([0.5, 0.25], 2, 120, 36), { len16: 16,
    notes: [[0, 4, 36, 100, 0, 0.5, 0.5, 0], [4, 4, 37, 100, 0, 0.5, 0.5, 0], [8, 8, 38, 100, 0, 0.5, 0.5, 0]] });
  assert.equal(Q.slicesToNotes([], 2.1, 120, 60).len16, 32, 'rounded up to whole bars');
  assert.deepEqual(Q.slicesToNotes([0.2, 0.6], 1, 120, 126).notes.map(n => n[2]), [126, 127], 'pitches above 127 dropped');
  assert.equal(Q.slicesToNotes([0.5], 300, 200, 36).len16, 1024);
  const N = (t, l, n) => [t, l, n, 100, 0, 0.5, 0.5, 0];
  // region [0, 8), offset 4: 0 → 4; 3 crosses 4 → [7, 1] + [0, 1]; 6 → 2; 7 (len 2, cut at 8) → 3 for 1
  assert.deepEqual(Q.wrapAt([N(0, 2, 60), N(3, 2, 62), N(6, 1, 64), N(7, 2, 65)], 0, 4, 8),
    [N(0, 1, 62), N(2, 1, 64), N(3, 1, 65), N(4, 2, 60), N(7, 1, 62)]);
  assert.deepEqual(Q.wrapAt([N(0, 1, 60), N(3, 1, 61), N(9, 1, 62)], 2, 5, 8), [N(0, 1, 60), N(6, 1, 61), N(9, 1, 62)], 'outside the region: kept');
  assert.deepEqual(Q.wrapAt([N(3, 1, 61)], 2, 2, 8), [N(3, 1, 61)], 'off = start: nothing to do');
  // Wrap Clip to Begin Here on a slot: rotated notes, off = start
  const w = Q.wrapClip(Object.assign(Q.defaultClipSlot(), { len: 8, start: 0, off: 4, notes: [N(0, 2, 60), N(3, 2, 62), N(6, 1, 64)] }));
  assert.deepEqual([w.off, w.notes], [0, [N(0, 1, 62), N(2, 1, 64), N(4, 2, 60), N(7, 1, 62)]]);
  // Send to Selected Clip on a slot: notes and length replaced; start / offset marker kept when they still fit, else 0
  const sl = Q.slicesToNotes([0.5], 1, 120, 36);
  let ws = Q.withSlices(Object.assign(Q.defaultClipSlot(), { len: 64, start: 20, off: 30, notes: [N(0, 1, 40)] }), sl);
  assert.deepEqual([ws.len, ws.start, ws.off, ws.notes], [16, 0, 0, [N(0, 4, 36), N(4, 4, 37)]]);
  ws = Q.withSlices(Object.assign(Q.defaultClipSlot(), { len: 64, start: 4, off: 6 }), sl);
  assert.deepEqual([ws.len, ws.start, ws.off], [16, 4, 6]);
  // Record EXTEND: whole bars while recording at or past the end, up to 1024
  assert.deepEqual([Q.recExtend(64, 70), Q.recExtend(64, 63.9), Q.recExtend(64, 64), Q.recExtend(16, 40), Q.recExtend(1020, 2000), Q.recExtend(16, NaN)],
    [80, 64, 80, 48, 1024, 16]);
  // Copy to Track: unmuted notes of [start, len) in song ticks from the playhead (lengths not cut)
  assert.deepEqual(Q.clipTrackNotes({ len: 16, start: 4, notes: [[4, 1, 60, 100, 0], [2, 1, 50, 100, 0], [8, 0.5, 62, 90, 1], [10, 8, 64, 80, 0],
    [16, 1, 70, 100, 0]] }, 960), [{ t: 960, d: 240, n: 60, v: 100 }, { t: 2400, d: 1920, n: 64, v: 80 }]);
  // SMF: 120 BPM, clip [2, 18): notes at 2 (C4, 1 beat), 6 (E4, 1 beat, vel 90), 10 (G4, 2 beats, vel 80); a muted note and one
  // before start are absent
  const smf = Q.clipToSmf({ len: 18, start: 2, notes: [[2, 4, 60, 100, 0], [6, 4, 64, 90, 0], [10, 8, 67, 80, 0], [4, 1, 50, 100, 1], [1, 1, 40, 100, 0]] }, 120);
  const want = [
    0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x03, 0xC0,                 // MThd, type 0, 1 track, 960 PPQ
    0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, 46,                                         // MTrk, 46 bytes
    0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20,                                    // tempo 500000 µs (120 BPM)
    0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,                              // 4/4
    0x00, 0x90, 60, 100, 0x87, 0x40, 0x80, 60, 0,                                // C4 on, +960 off
    0x00, 0x90, 64, 90, 0x87, 0x40, 0x80, 64, 0,                                 // E4
    0x00, 0x90, 67, 80, 0x8F, 0x00, 0x80, 67, 0,                                 // G4 for 1920 ticks (ends at the clip end)
    0x00, 0xFF, 0x2F, 0x00,                                                      // end of track at 240·16 = 3840
  ];
  assert.ok(smf instanceof Uint8Array);
  assert.deepEqual(arr(smf), want);
  // a note crossing the end is cut; end of track never precedes the last event; offs before ons at one tick
  const cut = arr(Q.clipToSmf({ len: 4, start: 0, notes: [[0, 2, 60, 100, 0], [2, 8, 62, 100, 0]] }, 60));
  assert.deepEqual(cut.slice(22, 29), [0x00, 0xFF, 0x51, 0x03, 0x0F, 0x42, 0x40]);   // 60 BPM: 1000000 µs
  assert.deepEqual(cut.slice(-22), [0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0x00, 0x90, 62, 100, 0x83, 0x60, 0x80, 62, 0,   // off before on at 480
    0x00, 0xFF, 0x2F, 0x00]);                                                                    // 62 cut at the end (960)
});

test('§13.3.2 snapGrid / snapTo; slotName', () => {
  assert.deepEqual(Q.snapGrid('beats', { bpm: 120, rate: 48000, S: 1000 }), { origin: 1000, step: 6000 });
  assert.deepEqual(Q.snapGrid(2, { bpm: 120, rate: 48000, S: 1000, E: 97000, lenBeats: 8 }), { origin: 1000, step: 3000 });
  assert.deepEqual(Q.snapGrid('loop', { S: 500, loop: 109.1 }), { origin: 500, step: 109.1 });
  for (const m of ['off', 'zero', 0, 1, 'x']) assert.equal(Q.snapGrid(m, { bpm: 120, rate: 48000 }), null);
  assert.equal(Q.snapGrid('beats', { bpm: 0, rate: 48000 }), null);
  const g = Q.snapGrid('beats', { bpm: 120, rate: 48000, S: 1000 });
  assert.deepEqual([Q.snapTo(g, 3900), Q.snapTo(g, 4100), Q.snapTo(null, 4100)], [1000, 7000, 4100]);
  assert.equal(Q.slotName(Q.defaultArpSlot()), 'Up (1/16)');
  assert.equal(Q.slotName(Object.assign(Q.defaultArpSlot(), { shape: 8, trip: 1, n: Object.assign({}, Q.ARP_N, { rate: 11 / 16 }) })), 'UpDown (1/8T)');
  assert.equal(Q.slotName(Object.assign(Q.defaultArpSlot(), { bpm: 0 })), 'Up (5.00 Hz)');
  assert.equal(Q.slotName(Object.assign(Q.defaultArpSlot(), { name: 'Mine' })), 'Mine');
  assert.equal(Q.slotName(Q.defaultClipSlot(), 2), 'Clip 3');
});

/* ------------------------------------------------------------------ piano-roll operations */

test('noteOps / evOps: pure, sorted, selection tracked', () => {
  const O = Q.noteOps, N = (t, l, n, m) => [t, l, n, 100, m || 0, 0.5, 0.5, 0];
  const L = [N(0, 1, 60), N(2, 1, 64), N(4, 2, 67)], L0 = clone(L);
  let r = O.add(L, [0], N(1, 1, 62));
  assert.deepEqual(r, { list: [N(0, 1, 60), N(1, 1, 62), N(2, 1, 64), N(4, 2, 67)], sel: [1] });
  assert.deepEqual(L, L0, 'input untouched');
  assert.deepEqual(O.remove(L, [1]), { list: [N(0, 1, 60), N(4, 2, 67)], sel: [] });
  // move: the group keeps its shape inside 0…127 and t ≥ 0
  assert.deepEqual(O.move(L, [0, 1], -3, 100), { list: [N(0, 1, 123), N(2, 1, 127), N(4, 2, 67)], sel: [0, 1] });
  assert.deepEqual(O.move(L, [2], 1.5, -2).list[2], N(5.5, 2, 65));
  assert.deepEqual(O.resize(L, [0, 2], -1.5).list.map(n => n[1]), [1 / 16, 1, 0.5]);
  r = O.chop(L, [2], 0.5);
  assert.deepEqual(r.list.slice(2).map(n => [n[0], n[1]]), [[4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 0.5]]);
  assert.deepEqual(r.sel, [2, 3, 4, 5]);
  assert.deepEqual(O.legato(L, [0, 1, 2]).list.map(n => n[1]), [2, 2, 2]);
  assert.deepEqual(O.quantize([N(0.3, 1, 60), N(1.8, 1, 61)], [0, 1], 1, 0.5).list.map(n => n[0]), [0.15, 1.9]);
  assert.deepEqual(O.reverse(L, [0, 1, 2]).list.map(n => [n[0], n[2]]), [[0, 67], [3, 64], [5, 60]]);
  assert.deepEqual(O.scaleTime(L, [1, 2], 2).list.map(n => [n[0], n[1]]), [[0, 1], [2, 2], [6, 4]]);
  r = O.duplicate(L, [0, 1]);
  assert.deepEqual([r.list.map(n => n[0]), r.sel], [[0, 2, 3, 4, 5], [2, 4]]);
  assert.deepEqual(O.selectRange(L, 1, 4.5, 60, 66), [1]);
  assert.deepEqual(O.selectRange(L, 1, 4.5, 70, 60), [1, 2], 'pitch bounds in any order; a note ending at t0 is outside');
  const cb = O.timeCopy(L, [0.5, 4.5]);
  assert.deepEqual(cb, { len: 4, list: [N(0, 0.5, 60), N(1.5, 1, 64), N(3.5, 0.5, 67)] });
  r = O.timePaste([N(0, 8, 50), N(9, 1, 51)], cb, 2);
  assert.deepEqual(r.list, [N(0, 2, 50), N(2, 0.5, 60), N(3.5, 1, 64), N(5.5, 0.5, 67), N(6, 2, 50), N(9, 1, 51)]);
  assert.deepEqual(r.sel, [1, 2, 3]);
  assert.deepEqual(O.mute(L, [0, 1]).list.map(n => n[4]), [1, 1, 0]);
  assert.deepEqual(O.mute([N(0, 1, 60, 1), N(1, 1, 60, 1)], [0, 1]).list.map(n => n[4]), [0, 0]);
  assert.deepEqual(O.conformToScale([N(0, 1, 61), N(1, 1, 66)], [0, 1], 0, 0).list.map(n => n[2]), [60, 65]);
  const clip = Object.assign(Q.defaultClipSlot(), { len: 12, start: 4, off: 6, notes: [N(0, 1, 40), N(4, 2, 60), N(10, 1, 62)] });
  const d = O.doubleClip(clip);
  assert.deepEqual([d.len, d.notes.map(n => n[0])], [20, [0, 4, 10, 12, 18]]);
  assert.equal(clip.len, 12);
  const sc = O.scaleClip(clip, 0.5);
  assert.deepEqual([sc.len, sc.off, sc.notes.map(n => [n[0], n[1]])], [8, 5, [[0, 1], [4, 1], [7, 0.5]]]);
  // pattern events: rows skip 0, ±32 bounds; accent toggle; double / scale a pattern
  const E = Q.evOps, ev = [[0, 1, 1, 100, 0], [1, 1, -1, 100, 0], [2, 1, 32, 100, 1]];
  assert.deepEqual(E.move(ev, [0], 0, -1).list.map(e => e[2]), [-1, -1, 32]);
  assert.deepEqual(E.move(ev, [1], 0, 1).list.map(e => e[2]), [1, 1, 32]);
  assert.deepEqual(E.move(ev, [2], 0, 5).list.map(e => e[2]), [1, -1, 32], 'clamped at +32');
  assert.deepEqual(E.accent(ev, [0, 2]).list.map(e => e[4]), [1, 0, 1]);
  assert.equal(E.mute, undefined);
  assert.equal(O.accent, undefined);
  const pat = Object.assign(Q.defaultPattern(), { len: 4, ev });
  assert.deepEqual([E.doubleClip(pat).len, E.doubleClip(pat).ev.length, E.scaleClip(pat, 2).len], [8, 6, 8]);
  assert.equal(E.doubleClip(Object.assign({}, pat, { len: 200 })).len, 200, 'beyond 256: unchanged');
});

/* ------------------------------------------------------------------ §10.6–10.7 content, storage helpers */

test('§10.6–10.7 factory content and generators: deterministic, normalized, in key', () => {
  const minor = (root, n) => [0, 2, 3, 5, 7, 8, 10].includes((((n - root) % 12) + 12) % 12);
  for (let k = 1; k <= 12; k++) {
    const b = Q.genBassline(k), m = Q.genMelody(k);
    assert.deepEqual(Q.genBassline(k), b);
    assert.deepEqual(Q.normalizeClipSlot(b), b);
    assert.deepEqual(Q.normalizeClipSlot(m), m);
    assert.ok([16, 32].includes(b.len) && b.notes.length > 4);
    assert.ok(b.notes.every(n => minor(k & 1 ? 0 : 9, n[2]) && n[2] >= 33 && n[2] <= 60), 'bass in C minor (odd) / A minor (even)');
    assert.ok(b.notes.some(n => n[0] === 0), 'starts on the downbeat');
    assert.equal(m.len, 32);
    assert.ok(m.notes.every(n => n[0] % 2 === 0), '8th-note grid');
    assert.deepEqual(m.lanes.m1, [[0, 0, 0], [1, 1, 0]]);
  }
  assert.notDeepEqual(Q.genBassline(1).notes, Q.genBassline(3).notes);
  assert.deepEqual(Q.FALLBACK_CLIPS.map(c => c.name), ['Chord', 'Bass', 'Lead']);
  assert.deepEqual(Q.FALLBACK_CLIPS[0].notes.map(n => [n[0], n[1], n[2]]), [[0, 8, 60], [0, 8, 64], [0, 8, 67], [0, 8, 71]]);
  for (const c of Q.FALLBACK_CLIPS) assert.deepEqual(Q.normalizeClipSlot(c), c);
  assert.deepEqual(Q.FACTORY_ARP_BANKS.map(b => b.name), ['Init', 'Basics', 'Range', 'Patterns']);
  for (const b of Q.FACTORY_ARP_BANKS) { assert.equal(b.type, 'synth.sx.arpbank'); assert.deepEqual(Q.normalizeArp({ slots: b.slots }).slots, b.slots); }
  assert.deepEqual(Q.FACTORY_ARP_BANKS[1].slots.map(s => Q.slotName(s)), ['Up (1/16)', 'Down (1/16)', 'UpDown (1/16)', 'Up&Down (1/8)', 'Played (1/16)',
    'Chord (1/8)', 'Converge (1/16)', 'Diverge (1/16)', 'Thumb Up (1/16)', 'Rand (1/16)', 'Rand Drift (1/16)', 'Up (1/16T)']);
  assert.equal(Q.FACTORY_ARP_BANKS[1].slots[5].n.gate, 0.25, 'gate 50 %');
  const rg = Q.FACTORY_ARP_BANKS[2].slots;
  assert.deepEqual([rg[0].n.range, rg[0].n.shift, rg[1].rshape, rg[4].n.shift, rg[11].dot], [1 / 7, 0.75, 2, (7 + 24) / 48, 1]);
  assert.deepEqual(Q.FACTORY_CLIP_BANKS.map(b => b.name), ['Init', 'Basslines', 'Chords', 'Slices', 'Melodies']);
  for (const b of Q.FACTORY_CLIP_BANKS) assert.deepEqual(Q.normalizeClip({ clips: b.clips }).clips, b.clips);
  // §10.6 Patterns (M3): twelve named patterns (after Init), each also a Pattern slot of the Patterns bank
  const PN = ['Pulse 8ths', 'Gallop', 'Octave Bounce', 'Trance Gate', 'Broken Chord', 'Strum Up', 'Accent 3+3+2', 'Random Steps', 'Pendulum Five',
    'Wrap Climb', 'Ghost 16ths', 'Euclid 5/16'];
  assert.deepEqual(Q.FACTORY_PATTERNS.map(p => p.name), ['Init'].concat(PN));
  const pb = Q.FACTORY_ARP_BANKS[3].slots;
  pb.forEach((sl, j) => {
    const fp = Q.FACTORY_PATTERNS[j + 1];
    assert.ok(fp.type === 'synth.sx.arppat' && sl.shape === Q.ARP_SHAPES.indexOf('Pattern') && sl.pat.name === PN[j], PN[j]);
    assert.deepEqual(sl.pat, fp.pat, PN[j] + ': the slot plays the factory pattern');
    assert.deepEqual(Q.normalizeArpSlot({ pat: fp.pat }).pat, fp.pat);
    assert.ok(fp.pat.ev.length > 0 && fp.pat.ev.every(e => e[0] < fp.pat.len), PN[j] + ': events inside the pattern');
  });
  const P = n => Q.FACTORY_PATTERNS.find(p => p.name === n).pat;
  assert.deepEqual(P('Euclid 5/16').ev.map(e => e[0]), [0, 3, 6, 9, 12], 'Euclidean 5 in 16');
  assert.deepEqual([P('Trance Gate').stepMode, P('Trance Gate').ev.map(e => e[0]).filter(t => [3, 7, 11, 14].includes(t))], [2, []], 'gate rests');
  assert.deepEqual([P('Pendulum Five').len, P('Pendulum Five').mode, P('Random Steps').mode, P('Random Steps').time], [5, 2, 3, 2]);
  assert.deepEqual(P('Octave Bounce').ev.slice(0, 4).map(e => e[2]), [1, -1, 1, -1]);
  assert.deepEqual(P('Strum Up').strum.map(e => e[1]), [0.4, 0.4, 0.4, 0.4]);
  assert.ok(P('Ghost 16ths').lanes.vel.length > 2 && P('Accent 3+3+2').ev.filter(e => e[4]).length === 6);
  assert.deepEqual([pb[9].n.wrange, pb[9].n.wtrans], [1 / 8, 0.5], 'Wrap Climb wraps an octave up');
  // §10.7 Chords: two bars of four-note chords (half a bar each) around C4; Slices: notes 36–51 (the Drum Loop slices)
  for (const c of Q.FACTORY_CLIP_BANKS[2].clips) {
    assert.ok(c.len === 32 && c.notes.length === 16, c.name);
    for (const t of [0, 8, 16, 24]) {
      const ch = c.notes.filter(n => n[0] === t).map(n => n[2]);
      assert.ok(ch.length === 4 && new Set(ch).size === 4 && ch.every(n => n >= 52 && n <= 77), c.name + ' @' + t + ': ' + ch);
    }
  }
  assert.deepEqual(Q.FACTORY_CLIP_BANKS[2].clips[1].notes.filter(n => n[0] === 0).map(n => n[2]), [60, 64, 67, 72], 'I–V–vi–IV starts on C');
  for (const c of Q.FACTORY_CLIP_BANKS[3].clips) assert.ok(c.len === 32 && c.notes.length >= 8 && c.notes.every(n => n[2] >= 36 && n[2] <= 51 && n[0] < 32), c.name);
  assert.deepEqual(Q.FACTORY_CLIP_BANKS[3].clips[0].notes.map(n => n[2]), Array.from({ length: 16 }, (_, j) => 36 + j), 'Straight plays the loop in order');
});

test('user banks: payloads, libraries, loading (pure storage helpers)', () => {
  assert.deepEqual(Q.STORE_KEYS, { arpBanks: 'synth.sx.arpbanks', clipBanks: 'synth.sx.clipbanks', arpPats: 'synth.sx.arppats', clips: 'synth.sx.clips' });
  const arp = Q.defaultArp();
  arp.slots[4].shape = 3;
  const p = Q.arpBankPayload(arp, '  My Bank ');
  assert.deepEqual([p.type, p.v, p.name, p.slots[4].shape, p.slots.length], ['synth.sx.arpbank', 1, 'My Bank', 3, 12]);
  let lib = Q.libPut([], p);
  lib = Q.libPut(lib, Q.arpBankPayload(Q.defaultArp(), 'Other'));
  lib = Q.libPut(lib, Q.arpBankPayload(arp, 'My Bank'));
  assert.deepEqual(lib.map(x => x.name), ['Other', 'My Bank']);
  const text = JSON.stringify(lib.concat([{ type: 'synth.sx.clipbank', name: 'wrong type' }, { type: 'synth.sx.arpbank', name: '' }, 7]));
  assert.deepEqual(Q.readLib(text, 'synth.sx.arpbank'), lib);
  assert.deepEqual(Q.readLib('not json', 'synth.sx.arpbank'), []);
  assert.deepEqual(Q.libDel(lib, 'Other').map(x => x.name), ['My Bank']);
  const cur = Object.assign(Q.defaultArp(), { sel: 5, quant: 7, dirty: 1, midiOut: 2 });
  const loaded = Q.loadArpBank(cur, p);
  assert.deepEqual([loaded.bank, loaded.dirty, loaded.sel, loaded.quant, loaded.midiOut, loaded.slots[4].shape], ['My Bank', 0, 5, 7, 2, 3]);
  assert.deepEqual(Q.loadArpBank(cur, { type: 'x' }), Q.normalizeArp(cur), 'invalid payload: unchanged');
  const cp = Q.clipBankPayload(Q.FACTORY_CLIP_BANKS[1].clips.length ? { clips: Q.FACTORY_CLIP_BANKS[1].clips } : {}, 'Bass');
  assert.equal(Q.loadClipBank(Q.defaultClip(), cp).clips[3].notes.length, Q.FACTORY_CLIP_BANKS[1].clips[3].notes.length);
  const pp = Q.patPayload({ len: 8, ev: [[0, 1, 1, 100, 0]] }, 'Pat');
  assert.deepEqual([pp.type, pp.name, pp.pat.name, pp.pat.len, pp.pat.ev.length], ['synth.sx.arppat', 'Pat', 'Pat', 8, 1]);
  const cl = Q.clipPayload({ len: 16, notes: [[0, 1, 60]] }, 'Clip A');
  assert.deepEqual([cl.type, cl.name, cl.clip.name, cl.clip.notes.length], ['synth.sx.clip', 'Clip A', 'Clip A', 1]);
  assert.deepEqual(Q.readLib([pp, cl], 'synth.sx.arppat'), [pp]);
  assert.deepEqual(Q.readLib([pp], 'nope'), []);
});

test('seq-core is a pure leaf module (no imports, no browser globals)', () => {
  const src = source('seq-core.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/^\s*import\b|\bimport\(/m.test(src), 'no imports');
  assert.ok(!/\b(window|document|navigator|localStorage|indexedDB|setTimeout|performance)\b/.test(src));
});
