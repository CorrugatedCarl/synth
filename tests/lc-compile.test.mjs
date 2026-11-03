import './v8-guard.mjs';
// Stage LC lane E (docs/canvas/IMPL-LC.md §4, §18 P1-5; G1's compile half, G3's budgets): cv-graph compileMods with combiners — a
// combiner compiles with ≥ 1 input or OUT row; its value slot (one of the 16, k 8…23) and its inputs' LFO slots are taken AFTER every
// existing need (modules, pads, links), so no existing cable's slot moves; a GLOBAL track LFO / Serum-engine LFO shares its own slot
// (pay.slots['l1'] / ['i2/lfo1']), a PER NOTE / per-voice one takes a GLOBAL twin (one per source, shared by the combiners, mono 1 in
// the synthetic CP; pay.slots[module] → the twin when the module has no slot of its own); every input slot a keep-alive; the payload
// block pay.cmb [{ id, k, mode, in: [{ row, src, l, a }] }] (absent without combiners: D1), pay.slots[<comb>] { kind: 'comb', i, n },
// pay.left { id, why: 'slots' } for an input / OUT over budget; mode and the input rows in sigOf / the key, win and mark not.
// Pure modules, no DOM, no engine. Run alone: node --max-old-space-size=2048 --test tests/lc-compile.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../cv-graph.js?v=9';
import * as MO from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import * as C from '../serum-core.js?v=9';
import { RIG } from '../rig-core.js?v=9';
import { tracks as tracks2b } from './fixtures/mods-2b.mjs';

const P = { bpm: 120, perf: { wheel: null }, tracks: [], pads: [] };
const hzN = hz => Math.pow(hz / 100, 0.25);
const J = x => JSON.stringify(x);
const lfo = (mono, o = {}) => S.normModDev({ kind: 'lfo', lfo: Object.assign({ mono, mode: 'free', bpm: 0, anchor: 0 }, o), rate: hzN(2) });
// a Juno i2 into fx1 (a reverb 'rev') and a rig i1 (its LFO 1 GLOBAL, LFO 2 per voice) → OUT; l1 GLOBAL (cabled to the Juno's
// cutoff), l2 GLOBAL (nothing else), l3 PER NOTE, c1 a CC (cabled), a combiner x1 (Add) and x2 (Multiply)
function track() {
  const t = tracks2b()[0];
  t.id = 'trk_lc'; t.mods = []; t.mid = 1;
  delete t.dev.l1;
  t.dev.i1.vals.s.lfo[0].mono = 1;
  Object.assign(t.dev, { l1: lfo(1), l2: lfo(1), l3: lfo(0), c1: S.normModDev({ kind: 'cc', cc: 7, v: 0.4 }), x1: S.normModDev({ kind: 'comb' }), x2: S.normModDev({ kind: 'comb', mode: 'mul' }) });
  return t;
}
const add = (t, src, dst, o = {}) => { const r = MO.addMod(t, src, dst, Object.assign({ project: P }, o)); assert.ok(r.ok, src + ' → ' + dst + ': ' + r.why); return r.row; };
const pay = t => G.compileMods(t, P, {});
const slotOf = (p, id) => (p.slots[id] ? p.slots[id].i : -1);

test('D1: a track without a combiner compiles as before — no cmb key, the payload keys in their order; a combiner device with no row changes no byte of the payload (rows, key, slots)', () => {
  for (const t of tracks2b()) {
    const p = pay(t);
    assert.deepEqual(Object.keys(p), ['t', 'i', 'key', 'cp', 'ct', 'rows', 'xfer', 'ext', 'vals', 'keep', 'left', 'dashed', 'n', 'slots'], t.id);
    const u = tracks2b().find(x => x.id === t.id);
    u.dev.x1 = S.normModDev({ kind: 'comb', mode: 'mul', win: 4, mark: { t: 'trk_b1', n: 36 } });
    const q = pay(u);
    assert.equal(J(Object.assign({}, q, { cp: null, ct: null })), J(Object.assign({}, p, { cp: null, ct: null })), t.id + ': an unconnected combiner compiles nothing');
    assert.equal(q.cp.cpKey, p.cp.cpKey, t.id + ': the synthetic CP');
  }
});

test('§4.2 inputs: a GLOBAL LFO shares its own slot (pay.slots[l1], its cable unchanged); a GLOBAL LFO nothing else needs and every twin take theirs after every existing need; a PER NOTE LFO / a per-voice rig LFO a GLOBAL twin (mono 1 in the CP), one per source, shared by two combiners', () => {
  const t = track();
  add(t, 'l1.out', 'i2:cf', { amt: 0.4 }); add(t, 'c1.out', 'i2:rs');
  const p0 = pay(t);
  const r1 = add(t, 'l1.out', 'x1:in'), r2 = add(t, 'l2.out', 'x1:in', { amt: -0.5 }), r3 = add(t, 'l3.out', 'x1:in', { byp: 1 }), r4 = add(t, 'i1/lfo1.out', 'x1:in'), r5 = add(t, 'i1/lfo2.out', 'x1:in', { amt: 0.3 });
  const r6 = add(t, 'l3.out', 'x2:in'), r7 = add(t, 'l1.out', 'x2:in'), o1 = add(t, 'x1.out', 'i2:rs');
  const p = pay(t);
  assert.equal(J(p.rows.filter(r => r.id !== o1.id).map(r => [r.id, r.src, r.vi, r.slot])), J(p0.rows.map(r => [r.id, r.src, r.vi, r.slot])), 'no existing cable moved');
  assert.deepEqual([J(p.ext), J(p.vals)], [J(p0.ext), J(p0.vals)], 'the ext list and the value table as they were');
  for (const k of Object.keys(p0.slots)) assert.deepEqual(p.slots[k], p0.slots[k], 'slot of ' + k);
  assert.deepEqual([slotOf(p, 'l1'), slotOf(p, 'l2'), slotOf(p, 'l3'), slotOf(p, 'i1/lfo1'), slotOf(p, 'i1/lfo2'), p.n.lfo], [0, 1, 2, 3, 4, 5],
    'after the existing need, in input order; l3 and the rig LFO 2 only through their twins: slots → the twin (P3-9)');
  assert.equal(p.cmb.length, 2);
  const [a, b] = p.cmb, S5 = l => C.SRC_INDEX['lfo' + (l + 1)];
  assert.deepEqual(a, { id: 'x1', k: 9, mode: 0, in: [{ row: r1.id, src: S5(0), l: 0, a: 1 }, { row: r2.id, src: S5(1), l: 1, a: -0.5 }, { row: r3.id, src: S5(2), l: 2, a: 0 },
    { row: r4.id, src: S5(3), l: 3, a: 1 }, { row: r5.id, src: S5(4), l: 4, a: 0.3 }] }, 'x1: the value slot after c1 (k 8), its inputs in t.mods order, a muted one a: 0');
  assert.deepEqual(b, { id: 'x2', k: 10, mode: 1, in: [{ row: r6.id, src: S5(2), l: 2, a: 1 }, { row: r7.id, src: S5(0), l: 0, a: 1 }] }, 'x2 (no OUT: it still compiles): the l3 twin shared');
  assert.deepEqual([1, 2, 3, 4].map(l => p.cp.lfoMono[l]), [1, 1, 1, 1], 'the twins run GLOBAL');
  assert.deepEqual([p.slots.x1, p.slots.x2], [{ kind: 'comb', i: 0, n: 5 }, { kind: 'comb', i: 16, n: 2 }], 'the monitor block offsets: 1 + 3n each');
  for (const l of [1, 2, 3, 4]) assert.ok(p.keep.includes(S5(l)), 'input slot ' + l + ' kept alive');
  assert.ok(!p.keep.includes(S5(0)), 'l1: read by its live cable already (as before)');
  assert.deepEqual([p.n.vals, p.left], [3, []], 'two combiners, one CC: three value sources');
  const out = p.rows.find(r => r.id === o1.id);
  assert.deepEqual([out.src, out.dst], [G.S_EXT0 + 9 - 8, { kind: 'cls', inst: 'i2', slot: out.dst.slot }], 'the OUT row reads the value source (a CC\'s path)');
  assert.equal(p.cp.use & 32768, 32768, 'the CP reads ext sources (ctx.ext)');
});

test('§4.1 the value slot comes after the modules\' and the pads\' (no value source moves); an OUT onto a Serum-engine knob is an ext entry; over 16 the combiner is left out (its OUT and input rows left \'slots\'), every other value source in place', () => {
  const t = track();
  add(t, 'c1.out', 'i2:rs');
  t.mods.push({ id: 'p1', src: 'pd1.p0', dst: 'i2:cf', amt: 0.2, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }); // (a mod pad: after the modules)
  const o1 = add(t, 'x1.out', 'i1:f.cutoff'), i1 = add(t, 'l2.out', 'x1:in');
  const p = pay(t);
  assert.deepEqual(p.ext.map(e => [e.k, e.src, e.id]), [[1, G.S_EXT0 + 2, 'x1.out']], 'the Serum knob: ext1 carries the combiner\'s value source (k 10, after the CC and the pad)');
  assert.deepEqual(p.vals.map(v => [v.id, v.k]), [['c1.out', 8], ['pd1.p0', 9]], 'the value table: the CC, the pad (no host value for a combiner)');
  assert.equal(p.cmb[0].k, 10);
  // 16 CCs: the combiner has none left
  const u = track();
  for (let k = 2; k <= 16; k++) u.dev['c' + k] = S.normModDev({ kind: 'cc', cc: k });
  for (let k = 1; k <= 16; k++) u.mods.push({ id: 'q' + k, src: 'c' + k + '.out', dst: 'i2:rs', amt: 0.1, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  const q0 = pay(u);
  u.mods.push(Object.assign({}, u.mods[0], { id: 'o1', src: 'x1.out', dst: 'i2:cf' }), Object.assign({}, u.mods[0], { id: 'n1', src: 'l2.out', dst: 'x1:in', amt: 1 }));
  const q = pay(u);
  assert.deepEqual(['cmb' in q, q.left, q.n.vals, q.n.lfo], [false, [{ id: 'o1', why: 'slots' }, { id: 'n1', why: 'slots' }], 16, 0], 'no value slot: nothing runs, no LFO slot taken for it');
  assert.equal(J(q.vals), J(q0.vals), 'every CC in place');
  assert.ok(!('x1' in q.slots));
  void o1; void i1;
});

test('§4.2 budgets: an 11th LFO for an input, a twin past 10 → that input left \'slots\' and absent from in; every existing cable\'s slot unchanged (the order rule)', () => {
  const t = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }).tracks[0], i1 = Object.keys(t.dev).find(k => t.dev[k].kind === 'synth');
  for (let k = 1; k <= 12; k++) MO.addModDev(t, 'lfo');
  MO.addModDev(t, 'comb');
  MO.setModState(t, 'l12', { lfo: { mono: 0 } });
  for (let k = 1; k <= 9; k++) add(t, 'l' + k + '.out', i1 + ':cf');
  const r10 = add(t, 'l10.out', 'x1:in'), base = pay(t);
  assert.deepEqual([base.n.lfo, base.cmb[0].in.length, slotOf(base, 'l10')], [10, 1, 9]);
  // the rows written straight in (the drop's pre-check refuses them; a later edit can leave them so)
  const row = (id, src) => Object.assign({}, t.mods[0], { id, src, dst: 'x1:in', amt: 1 });
  t.mods.push(row('n11', 'l11.out'), row('n12', 'l12.out'));
  const p = pay(t);
  assert.deepEqual([p.left, p.cmb[0].in.map(x => x.row), p.n.lfo], [[{ id: 'n11', why: 'slots' }, { id: 'n12', why: 'slots' }], [r10.id], 10]);
  assert.equal(J(p.rows.map(r => [r.id, r.src])), J(base.rows.map(r => [r.id, r.src])), 'every cable keeps its slot');
  // a direct cable added later from a module before the combiner's input takes the slot first: the input goes left (a later edit's)
  add(t, 'l11.out', i1 + ':rs');
  const q = pay(t);
  assert.deepEqual([q.left.map(x => x.id), q.cmb[0].in.map(x => x.row), slotOf(q, 'l11')], [[r10.id, 'n12'], ['n11'], 9], 'the combiner\'s needs come last: the direct cable wins (l11 then shares its slot), the rest left in t.mods order');
});

test('§4.2 the key and the memo: mode, amounts and mutes are in sigOf and the key; win and mark are not (no recompile, the same payload object)', () => {
  const t = track();
  add(t, 'l2.out', 'x1:in'); add(t, 'x1.out', 'i2:cf');
  const p = pay(t);
  MO.setModState(t, 'x1', { win: 4, mark: { t: 'trk_x', n: 36 } });
  assert.equal(pay(t), p, 'a window / marks pick: a memo hit');
  MO.setModState(t, 'x1', { mode: 'mul' });
  const q = pay(t);
  assert.ok(q !== p && q.key !== p.key && q.cmb[0].mode === 1, 'mode: a new key');
  const r = t.mods.find(x => x.dst === 'x1:in');
  MO.setMod(t, r.id, { amt: 0.25 });
  const s = pay(t);
  assert.ok(s.key !== q.key && s.cmb[0].in[0].a === 0.25, 'an amount: a new key');
  MO.setMod(t, r.id, { byp: 1 });
  assert.ok(pay(t).key !== s.key && pay(t).cmb[0].in[0].a === 0, 'a mute: a new key, a 0');
});

test('§4.3 the master (MREC-shaped: dev mdev, fx rows on mfx): two LFOs into a combiner onto a Delay\'s mix — fx row from the value source; a combiner with only an OUT row compiles (in: [], y 0)', () => {
  const fx = C.defaultFx2(), dly = C.newInstance(fx, 'dly', { rack: 0 });
  const t = { id: 'master', dev: { mfx: { kind: 'panel', fx }, l1: lfo(1), l2: lfo(1, { bpm: 1, anchor: 1 }), x1: S.normModDev({ kind: 'comb' }) }, mods: [], mid: 1 };
  const R = (id, src, dst, amt) => ({ id, src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  t.mods.push(R('r1', 'x1.out', `mfx:fx.${dly}.mix`, 0.4));
  const p0 = pay(t);
  assert.deepEqual([p0.cmb, p0.rows.length, p0.n.vals], [[{ id: 'x1', k: 8, mode: 0, in: [] }], 1, 1]);
  t.mods.push(R('r2', 'l1.out', 'x1:in', 1), R('r3', 'l2.out', 'x1:in', -0.5));
  const p = pay(t);
  assert.deepEqual(p.cmb[0].in.map(x => [x.row, x.l, x.a]), [['r2', 0, 1], ['r3', 1, -0.5]]);
  assert.deepEqual([p.rows[0].src, p.rows[0].dst.kind, p.rows[0].dst.chain], [G.S_EXT0, 'fx', 'mfx']);
});
