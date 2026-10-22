// cv-cost.js (lane D of stage 1e; SPEC-canvas §9.1, §9.2; IMPL-1e §4.6): the cost table covers every model and effect
// type; estimates are positive, monotone in voices / unison / oscillators / effects, linear in the device factor, and
// match the bench.json node rows (Serum d–h') and the iPad c-rows; labels; the soft-cap table; the device factor from
// the reference rows; measureDevice behind a stub runner; the Worker runner's message protocol with a fake Worker; the
// Worker body itself in a node:vm "worker" (importScripts reads the repository files, as smpgen's render farm test);
// the measured rows are the bench rows (tests/bench-scenarios.mjs, bench.html c1).
// Run: node --max-old-space-size=2048 --test tests/cv-cost.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as C from '../cv-cost.js?v=9';
import { MODELS, patchFor } from '../models.js?v=9';
import * as core from '../serum-core.js?v=9';
import { FXTYPES } from '../fx-core.js?v=9';
import { scenarios } from './bench-scenarios.mjs';

const ROOT = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const BENCH = JSON.parse(read('tests/bench.json'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a / b - 1) <= tol, `${what}: ${a.toFixed(4)} vs ${b} (±${tol * 100} %)`);
const sx = edit => { const s = core.defaultSerum(); if (edit) edit(s); return { kind: 'synth', model: 'serum', vals: { s: core.normalizeSerum(s) } }; };
const syn = (model, vals, o) => Object.assign({ kind: 'synth', model, vals: vals || null }, o);
const fxWith = (types, o = {}) => {
  const fx = core.defaultFx2();
  for (const t of types) core.newInstance(fx, t, { rack: 0 });
  if (o.byp) fx.racks[0].mods[0].byp = 1;
  return fx;
};

test('COST covers every model of models.js and every effect type of fx-core; every estimate is positive', () => {
  const ids = MODELS.map(m => m.id);
  assert.deepEqual(ids.filter(id => !C.COST.synth[id]), []);
  assert.deepEqual(FXTYPES.map(t => t.id).filter(id => !(id in C.COST.fx)), []);
  assert.deepEqual(core.FXTYPES.map(t => t.id), FXTYPES.map(t => t.id));
  assert.equal(C.COST.rev.length, core.REV_TYPES2.length);
  for (const id of ids.concat(FXTYPES.map(t => t.id), ['panel'])) assert.ok(C.estimate(id) > 0 && C.estimate(id) < 1, id + ' ' + C.estimate(id));
  for (const m of MODELS) {
    const v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
    const d = m.id === 'serum' ? sx() : syn(m.id, v);
    assert.ok(C.estimate(d) > 0, m.id + ' device');
    assert.equal(C.estimate(syn(m.id, null, { on: false })), C.COST.off, m.id + ' powered off');
  }
  assert.equal(C.estimate('nope'), 0); assert.equal(C.estimate({ kind: 'out' }), 0); assert.equal(C.estimate(null), 0);
});

test('IMPL-7a §2.6: the TR-808 is costed by its bench row d8p (base + one hit), as a mono instrument — the same at any chord, near the row\'s node target', () => {
  const c = C.COST.synth.tr808, e = C.estimate('tr808');
  assert.deepEqual([c.row, c.family, c.poly], ['d8p', 'drums', 1]);
  near(e, BENCH.targets.d8p.node, 0.1, 'tr808 vs d8p');
  assert.equal(C.estimate('tr808', 1, { notes: 8 }), e);
  assert.equal(C.estimate(syn('tr808', {}), 2), 2 * e);
  assert.equal(C.label(e), '~2 %');
});

// (d6p's target 0.025 is a ceiling — review #8: CY once a bar never sleeps —, the row measures 0.0173 calibrated: the
// estimate is the measurement, between 0.6 × and 1 × the target)
test('IMPL-7b §2.6: the TR-606 is costed by its bench row d6p the same way — mono, its measured row under the node target, a little under the 808', () => {
  const c = C.COST.synth.tr606, e = C.estimate('tr606');
  assert.deepEqual([c.row, c.family, c.poly], ['d6p', 'drums', 1]);
  assert.ok(e >= 0.6 * BENCH.targets.d6p.node && e <= BENCH.targets.d6p.node, 'tr606 ' + e + ' vs d6p ' + BENCH.targets.d6p.node);
  near(e, 0.0173, 0.02, 'tr606 vs the measured d6p');
  assert.ok(e < C.estimate('tr808'), 'five circuits cost less than twelve');
  assert.equal(C.estimate('tr606', 1, { notes: 8 }), e);
  assert.equal(C.estimate(syn('tr606', {}), 2), 2 * e);
  assert.equal(C.label(e), '~2 %');
});

// (d9p's target 0.035 is a ceiling — review #9: its house pattern keeps nearly every circuit awake —, the row measures
// 0.0171–0.0173 calibrated: the estimate is the measurement, between 0.4 × and 1 × the target)
test('IMPL-7c §2.7: the TR-909 is costed by its bench row d9p the same way — mono, its measured row under the node target, under the 808', () => {
  const c = C.COST.synth.tr909, e = C.estimate('tr909');
  assert.deepEqual([c.row, c.family, c.poly], ['d9p', 'drums', 1]);
  assert.ok(e >= 0.4 * BENCH.targets.d9p.node && e <= BENCH.targets.d9p.node, 'tr909 ' + e + ' vs d9p ' + BENCH.targets.d9p.node);
  near(e, 0.0172, 0.02, 'tr909 vs the measured d9p');
  assert.ok(e < C.estimate('tr808'), 'd9p under d8p (measured)');
  assert.equal(C.estimate('tr909', 1, { notes: 8 }), e);
  assert.equal(C.estimate(syn('tr909', {}), 2), 2 * e);
  assert.equal(C.label(e), '~2 %');
});

// (dvp's target 0.03 is a ceiling — review #6 / P-1: the groove keeps all five cards awake —, the row measures 0.0131
// calibrated: the estimate is the measurement, between 0.4 × and 1 × the target)
test('IMPL-8 §12.7: the SDS-V is costed by its bench row dvp the same way — mono, its measured row under the node target, under the 808', () => {
  const c = C.COST.synth.sdsv, e = C.estimate('sdsv');
  assert.deepEqual([c.row, c.family, c.poly], ['dvp', 'drums', 1]);
  assert.deepEqual([BENCH.targets.dvp, BENCH.targets.dvx, BENCH.targets.dvm, BENCH.targets.dvi], [{ node: 0.03, ipad: 0.035 }, { node: 0.05, ipad: 0.06 }, { node: 0.03, ipad: 0.035 }, { node: 0.0005, ipad: 0.001 }]);
  assert.ok(e >= 0.4 * BENCH.targets.dvp.node && e <= BENCH.targets.dvp.node, 'sdsv ' + e + ' vs dvp ' + BENCH.targets.dvp.node);
  near(e, 0.0131, 0.02, 'sdsv vs the measured dvp');
  assert.ok(e < C.estimate('tr808'), 'five cards under the 808');
  assert.equal(C.estimate('sdsv', 1, { notes: 8 }), e);
  assert.equal(C.estimate(syn('sdsv', {}), 2), 2 * e);
  assert.equal(C.label(e), '~1 %');
});

// IMPL-9 §3.8: no voices — the patch itself: base (the Inst's decimators + the Track, spike (a)) + every module with a cord at lane
// V9b's measured cost (a section's where it splits: the 995, the controller); MAIN OUT unpatched → idle; no record → Classic bass
test('IMPL-9 §3.8: the 900 Series is costed by its patch — base + each module (or section) with a cord at V9b\'s costs, MAIN OUT unpatched idle, no record = Classic bass under its row m9p; mono, linear in the factor', async () => {
  const MG = await import('../moog-core.js?v=9'), PT = await import('../patch-core.js?v=9');
  const c = C.COST.synth.m900, e = C.estimate('m900'), K = C.COST.patch;
  assert.deepEqual([c.row, c.family, c.poly, c.voice], ['m9p', 'patch', 1, 0]);
  assert.deepEqual(Object.keys(K).sort(), [...MG.ORDER_ALL].sort(), 'a cost per type');
  // (IMPL-9b §3.7: the 993, the 994 and the CP8A cost nothing — no slots, never scheduled; a sectioned type by its sections)
  const Z = ['993', '994', 'cp8a'], sum = t => (Array.isArray(K[t]) ? K[t].reduce((a, x) => a + x, 0) : K[t]);
  for (const t of MG.ORDER_ALL) assert.ok((Array.isArray(K[t]) ? K[t].length === MG.TYPES[t].secs.length && K[t].every(x => x >= 0 && x < 0.01) : K[t] >= 0 && K[t] < 0.01) && (Z.includes(t) ? sum(t) === 0 : sum(t) > 0), t);
  // Classic bass by hand: the controller's keyboard and mixer (the multiple and MAIN OUT: the evaluator's), the 921A, two 921Bs, the
  // 921, the 995's first attenuator, the 904A, two 911s, one 902 (the 923, the 907A and the other 902 unpatched)
  const hand = c.base + K.ctl[0] + K.ctl[1] + K['921a'] + 2 * K['921b'] + K[921] + K[995][0] + K['904a'] + 2 * K[911] + K[902];
  near(e, hand, 1e-9, 'Classic bass: base + its patched modules and sections');
  const { rec, vals } = MG.model15();
  near(C.estimate(syn('m900', vals, { patch: rec })), e, 1e-9, 'a device holding the record = the tile');
  near(C.estimate(syn('m900', vals)), e, 1e-9, 'no record: the Model 15 set');
  assert.ok(e > 0.4 * BENCH.targets.m9p.node && e < BENCH.targets.m9p.node, `m900 ${e} vs m9p ${BENCH.targets.m9p.node}`);
  // MAIN OUT unpatched: idle (the 2 s skip); the 907A patched in: + its cost; the 995's second attenuator: + one section; off
  const off = PT.pull(rec, rec.cords.find(x => x.b === 'c.out').id).rec;
  assert.equal(C.estimate(syn('m900', vals, { patch: off })), C.COST.off);
  assert.equal(C.estimate(syn('m900', vals, { patch: PT.fresh('moog') })), C.COST.off);
  const id = t => Object.keys(rec.mods).find(m => rec.mods[m].t === t), more = PT.plug(rec, id('907a') + '.out', 'c.m4').rec;
  near(C.estimate(syn('m900', vals, { patch: more })), e + K['907a'], 1e-9, 'the 907A patched');
  near(C.estimate(syn('m900', vals, { patch: PT.plug(rec, id('995') + '.o2', 'c.m4').rec })), e + K[995][1], 1e-9, 'a second attenuator');
  assert.equal(C.estimate(syn('m900', vals, { patch: rec, on: false })), C.COST.off);
  assert.equal(C.estimate('m900', 1, { notes: 8 }), C.estimate('m900', 1, { notes: 1 }));
  assert.equal(C.estimate(syn('m900', vals, { patch: rec }), 2), 2 * e);
  assert.equal(C.label(e), '~2 %');
});

// review 1 F5 (r1/idle.mjs): the engine runs MAIN OUT's ancestors only, and a loop step's members cost per sample beyond the table's
// block figures — an idle island must cost nothing, m9x's loop must show (the rows' measures: the calibrated node gate, E9 §12)
test('IMPL-9 §3.8 (review 1 F5): the patch estimate charges the live nodes only and adds the loop steps — Classic bass + a 30-module idle island = Classic bass; m9x (measured 0.0372) within 15 %, the starting patches near their rows', async (t) => {
  const MG = await import('../moog-core.js?v=9'), PT = await import('../patch-core.js?v=9'), { m9xPatch, presetSet } = await import('./bench-scenarios.mjs');
  const e0 = C.estimate('m900'), base = MG.model15();
  let rec = base.rec;
  const isl = [];
  for (let k = 0; k < 10; k++) for (const t of ['921', '904a', '907a']) { const x = PT.addModule(rec, base.vals, t); rec = x.rec; isl.push(x.mid); }
  for (let k = 0; k < 10; k++) { // each 921's saw → its 904A → its 907A → the next 921's f1: patched among themselves, no path to MAIN OUT
    const [o, f, b] = [isl[3 * k], isl[3 * k + 1], isl[3 * k + 2]], n = isl[(3 * k + 3) % 30];
    for (const [a, z] of [[o + '.saw', f + '.in'], [f + '.out', b + '.in'], [b + '.out', n + '.f1']]) { const r = PT.plug(rec, a, z); assert.ok(r.id, a + ' → ' + z + ': ' + r.why); rec = r.rec; }
  }
  assert.ok(Object.keys(rec.mods).length >= 42 && rec.cords.length > 40);
  near(C.estimate({ kind: 'synth', model: 'm900', vals: base.vals, patch: rec }), e0, 1e-9, 'Classic bass + an idle island');
  // a loop: the same modules patched into a cycle cost the loop members' per-sample step on top (COST.loop per member)
  const L = C.COST.loop, mk = pairs => { let r = PT.fresh('moog'), v = {}; for (const t of ['902', '902']) { const x = PT.addModule(r, v, t); r = x.rec; } for (const [a, z] of pairs) r = PT.plug(r, a, z).rec; return C.estimate({ kind: 'synth', model: 'm900', vals: v, patch: r }); };
  assert.ok(L > 0.0008 && L < 0.002, 'about 6-9 ns a sample a member at OS 4, 48 kHz: ' + L);
  near(mk([['m1.o1', 'm2.i1'], ['m2.o2', 'c.out'], ['m2.o1', 'm1.i1']]) - mk([['m1.o1', 'm2.i1'], ['m2.o2', 'c.out']]), 2 * L, 1e-9, 'two loop members');
  // against the rows (the calibrated node gate: m9p 0.0185 / m9x 0.0372 / m9d 0.0186)
  const rows = { m9p: ['Classic bass', 0.0185], m9d: ['Drone', 0.0186] }, rep = [];
  const x9 = C.estimate({ kind: 'synth', model: 'm900', vals: m9xPatch().vals, patch: m9xPatch().rec });
  rep.push('m9x ' + x9.toFixed(4) + ' vs 0.0372 (' + ((x9 / 0.0372 - 1) * 100).toFixed(1) + ' %)');
  near(x9, 0.0372, 0.15, 'm9x');
  for (const [row, [name, meas]] of Object.entries(rows)) {
    const p = presetSet(name), e = C.estimate({ kind: 'synth', model: 'm900', vals: p.vals, patch: p.rec });
    rep.push(row + ' ' + e.toFixed(4) + ' vs ' + meas + ' (' + ((e / meas - 1) * 100).toFixed(1) + ' %)');
    near(e, meas, 0.2, row);
  }
  t.diagnostic(rep.join(' · '));
});

// IMPL-9b §3.7, §8.3: the routing switches' bus rows make nodes live — the estimate reads the device's vals (patchLoad over
// liveNodes(rec, f, vals)): a 993-routed envelope into a 902's third control input costs its 911 (the 993 itself nothing); without
// the vals, or with the switch off, it does not
test('IMPL-9b §3.7: the patch estimate counts the bus rows (vals) — a 993-routed 911 is live and costed, the 993 free; switched off or without vals it is not', async () => {
  const MG = await import('../moog-core.js?v=9'), PT = await import('../patch-core.js?v=9'), K = C.COST.patch;
  let rec = PT.fresh('moog'), vals = {};
  const add = t => { const x = PT.addModule(rec, vals, t); rec = x.rec; return x.mid; };
  const o = add('921'), e = add('911'), a = add('902'), r = add('993');
  for (const [x, y] of [[o + '.saw', a + '.i1'], [a + '.o2', 'c.out'], ['c.ks1', e + '.trg']]) rec = PT.plug(rec, x, y).rec;
  const est = v => C.estimate(syn('m900', v, { patch: rec }));
  const off = est(vals), lit = PT.setKnob(vals, rec, r, 'e1', 1);
  assert.ok(PT.busRows(rec, 'moog', lit).length === 1, 'the row resolves');
  near(est(lit) - off, K[911] + K.ctl[0], 1e-9, 'the routed 911 is live: its cost and the keyboard section triggering it');
  near(C.estimate(syn('m900', undefined, { patch: rec })), off, 1e-9, 'no vals: no rows');
  near(est(PT.setKnob(lit, rec, r, 'e1', 0)), off, 1e-9, 'switched off');
  assert.equal(K[993], 0);
  // the System 55 rows (engine-track's calibrated node gate, E9b: m9q 0.0232, m9s 0.0443): within 15 %
  const { m9qPatch, m9sPatch } = await import('./bench-scenarios.mjs');
  for (const [row, f, meas] of [['m9q', m9qPatch, 0.0232], ['m9s', m9sPatch, 0.0443]]) { const x = f(); near(C.estimate(syn('m900', x.vals, { patch: x.rec })), meas, 0.15, row); }
});

test('estimates are monotone in voices, unison, oscillators, filters and effect count, and linear in the factor', () => {
  for (const m of MODELS.filter(x => x.id !== 'serum')) {
    let last = 0;
    for (let n = 1; n <= 8; n++) { const e = C.estimate(m.id, 1, { notes: n }); assert.ok(e >= last, m.id + ' notes ' + n); last = e; }
    const poly = C.COST.synth[m.id].poly;
    if (poly > 1) assert.ok(C.estimate(m.id, 1, { notes: 2 }) > C.estimate(m.id, 1, { notes: 1 }), m.id + ' 2 voices > 1');
    else assert.equal(C.estimate(m.id, 1, { notes: 8 }), C.estimate(m.id, 1, { notes: 1 }), m.id + ' mono');
  }
  // classic voicing from vals: unison keeps every voice busy, the Jupiter-8's Solo is mono
  assert.ok(C.estimate(syn('prophet5', { un: 1 }), 1, { notes: 1 }) > C.estimate(syn('prophet5', { un: 0 }), 1, { notes: 1 }));
  assert.ok(C.estimate(syn('jupiter8', { as: 2 })) < C.estimate(syn('jupiter8', { as: 0 })));
  assert.ok(C.estimate(syn('jupiter8', { poly: 4 })) < C.estimate(syn('jupiter8', {})));
  // Serum: voices, unison, oscillators, filters, warps, matrix rows, quality
  const chain = [
    [1, 2, 4, 8].map(v => sx(s => { s.voicing.poly = v; })),
    [0, 3, 7, 15].map(u => sx(s => { s.p['a.uni'] = u / 15; })),
    [[], ['b'], ['b', 'c']].map(L => sx(s => { for (const k of L) s.p[k + '.on'] = 1; })),
    [[], ['f'], ['f', 'f2']].map(L => sx(s => { for (const k of L) s.p[k + '.on'] = 1; })),
    [0, 1, 2].map(n => sx(s => { if (n > 0) s.p['a.w1'] = 0.2; if (n > 1) s.p['a.w2'] = 0.4; })),
    [0, 1, 8].map(n => sx(s => { for (let r = 0; r < n; r++) s.matrix[r] = Object.assign({}, s.matrix[r], { src: 'lfo1', dst: 'a.wt', amt: 0.5 }); })),
    [1, 2, 4].map(o => sx(s => { s.global.os = o; })),
  ];
  for (const L of chain) for (let i = 1; i < L.length; i++) assert.ok(C.estimate(L[i]) > C.estimate(L[i - 1]), 'serum chain step ' + i);
  assert.equal(C.estimate(sx(s => { s.voicing.mono = 1; s.voicing.poly = 8; })), C.estimate(sx(s => { s.voicing.poly = 1; })), 'mono = 1 voice');
  assert.ok(C.estimate('serum') > 0.02 && C.estimate('serum') < 0.05, 'the default Serum (8 notes)');
  near(C.estimate(sx()), C.estimate('serum'), 1e-9, 'id = default device');
  // a Serum's own FX count
  const own = sx(); own.fx = fxWith(['rev', 'dly']);
  assert.ok(C.estimate(own) > C.estimate(sx()));
  // panels: effects add, bypassed / disabled ones and an empty panel cost (almost) nothing; splitter branches count;
  // both panel forms ({fx} and {rack})
  let last = C.estimate({ kind: 'panel', fx: fxWith([]) });
  assert.equal(last, C.COST.panel);
  for (let n = 1; n <= 4; n++) { const e = C.estimate({ kind: 'panel', fx: fxWith(['eq', 'cho', 'dly', 'rev'].slice(0, n)) }); assert.ok(e > last, 'panel ' + n); last = e; }
  assert.equal(C.estimate({ kind: 'panel', fx: fxWith(['dist'], { byp: 1 }) }), C.COST.panel, 'bypassed');
  const off = fxWith(['dist']); off.racks[0].mods[0].p.on = 0;
  assert.equal(C.estimate({ kind: 'panel', fx: off }), C.COST.panel, 'disabled');
  const sp = core.defaultFx2(), spid = core.newInstance(sp, 'split3', { rack: 0 });
  const e0 = C.estimate({ kind: 'panel', fx: sp });
  core.newInstance(sp, 'eq', { splitter: spid, branch: 1 });
  assert.ok(C.estimate({ kind: 'panel', fx: sp }) > e0, 'splitter branch counted');
  const f3 = fxWith(['eq', 'cho', 'rev']);
  near(C.estimate({ kind: 'panel', rack: { mods: f3.racks[0].mods } }), C.estimate({ kind: 'panel', fx: f3 }), 1e-9, 'single-rack form');
  // reverb by type (rows k0–k4)
  const revOf = t => { const fx = fxWith(['rev']); fx.racks[0].mods[0].p.type = t / 4; return C.estimate({ kind: 'panel', fx }) - C.COST.panel; };
  for (let t = 0; t < 5; t++) near(revOf(t), C.COST.rev[t], 1e-9, 'reverb type ' + t);
  // the factor
  for (const x of ['prophet5', 'serum', 'conv', sx(), { kind: 'panel', fx: f3 }]) {
    near(C.estimate(x, 1.7), 1.7 * C.estimate(x), 1e-12, 'factor');
    assert.equal(C.estimate(x, 0), C.estimate(x), 'a bad factor is 1'); assert.equal(C.estimate(x, NaN), C.estimate(x));
  }
});

test('estimates match the bench: Serum rows d–h\' (node, ±15 %), the iPad c-rows (≈ 0.75–1.0 × node), REF.c1', () => {
  for (const s of scenarios()) if (s.kind === 'voice' && !s.base) {
    const b = s.build();
    near(C.estimate({ kind: 'synth', model: 'serum', vals: { s: b.state } }, 1, { notes: b.notes.length }), BENCH.node.rows[s.id], 0.15, 'row ' + s.id);
  }
  const CL = { c1: 'prophet5', c2: 'juno60', c3: 'minimoog', c4: 'dx7', c5: 'solina', c6: 'jupiter8' };
  for (const [row, model] of Object.entries(CL)) {
    assert.equal(C.COST.synth[model].row, row);
    const r = BENCH.ipad1d.rows[row] / C.estimate(model, 1, { notes: 8 });
    assert.ok(r > 0.7 && r < 1.05, `${row} ${model}: iPad / node estimate ${r.toFixed(2)}`);
  }
  near(C.estimate('prophet5'), C.REF.c1, 0.01, 'c1 reference = the Prophet-5 estimate');
  assert.equal(C.REF.j, BENCH.node.rows.j); assert.equal(C.REF.e, BENCH.node.rows.e);
  near(C.COST.fx.conv, BENCH.node.rows.j, 1e-9, 'Convolve = row j'); near(C.COST.fx.bode, BENCH.node.rows.l, 1e-9, 'Bode = row l');
  for (let t = 0; t < 5; t++) near(C.COST.rev[t], BENCH.node.rows['k' + t], 1e-9, 'k' + t);
  // the §9.2 worked example: Prophet-5 + Juno-60 + default Serum + one 3-effect panel ≈ 0.10 (Mac)
  const ex = C.estimate('prophet5') + C.estimate('juno60') + C.estimate('serum') + C.estimate({ kind: 'panel', fx: fxWith(['eq', 'cho', 'dly']) });
  assert.ok(ex > 0.1 && ex < 0.15, 'worked example ' + ex);
});

test('label: "~N %", "<1 %" under 0.5 %', () => {
  const T = [[0, '<1 %'], [0.0049, '<1 %'], [0.005, '~1 %'], [0.0149, '~1 %'], [0.03, '~3 %'], [0.126, '~13 %'], [1.2, '~120 %'], [NaN, '<1 %'], [-1, '<1 %']];
  for (const [x, s] of T) assert.equal(C.label(x), s, String(x));
});

test('estimateTrack: v2 devices (instruments + panels), v1 tracks', () => {
  const t = { dev: { i1: syn('juno60', {}), i2: sx(), i3: syn('minimoog', {}, { on: false }), fx1: { kind: 'panel', fx: fxWith(['eq']) }, out: { kind: 'out' } } };
  near(C.estimateTrack(t), C.estimate('juno60') + C.estimate('serum') + C.COST.off + C.COST.panel + C.COST.fx.eq, 1e-9, 'v2');
  near(C.estimateTrack(t, 2), 2 * C.estimateTrack(t), 1e-9, 'factor');
  near(C.estimateTrack({ model: 'prophet5', vals: {}, fx: fxWith(['rev']) }), C.estimate('prophet5') + C.COST.panel + C.COST.rev[0], 1e-9, 'v1 classic');
  near(C.estimateTrack({ model: 'serum', vals: { s: null }, fx: fxWith(['rev']) }), C.estimate('serum') + C.COST.rev[0], 1e-9, 'v1 Serum');
  assert.equal(C.estimateTrack(null), 0); assert.equal(C.estimateTrack({}), 0);
});

test('softCap (§9.2): touch only; a 4th instrument warns; a second heavy Serum confirms', () => {
  const heavy = sx(s => { for (const k of ['a', 'b', 'c']) { s.p[k + '.on'] = 1; s.p[k + '.uni'] = 6 / 15; s.p[k + '.w1'] = 0.1; s.p[k + '.w2'] = 0.2; } s.p['f.on'] = 1; s.p['f2.on'] = 1; });
  const mid = sx(s => { s.p['a.uni'] = 7 / 15; s.p['f.on'] = 1; });
  assert.ok(C.estimate(heavy) > C.HEAVY && C.estimate(mid) < C.HEAVY && C.estimate(mid, 2) > C.HEAVY && C.estimate('serum', 3) < C.HEAVY);
  const tr = (...ds) => ({ dev: Object.assign(Object.fromEntries(ds.map((d, i) => ['i' + (i + 1), d])), { fx1: { kind: 'panel', fx: fxWith([]) }, out: { kind: 'out' } }) });
  const J = syn('juno60', {}), T = { touch: true };
  const rows = [
    // [track, adding, opts, warn?, confirm?]
    [tr(J, J, J), 'juno60', {}, false, false],                       // not a touch device
    [tr(J, J), 'juno60', T, false, false],                           // a 3rd
    [tr(J, J, J), 'juno60', T, true, false],                         // the 4th
    [tr(J, J, J, J), syn('dx7', {}), T, true, false],                // a 5th
    [tr(J, J, J), { kind: 'panel', fx: fxWith([]) }, T, false, false], // a panel is no instrument
    [tr(heavy), heavy, T, false, true],                              // a second heavy Serum
    [tr(heavy, J, J), heavy, T, true, true],                         // both
    [tr(heavy), heavy, { touch: false }, false, false],
    [tr(sx()), heavy, T, false, false],                              // the first heavy one
    [tr(heavy), 'serum', T, false, false],                           // the default Serum is light
    [tr(heavy), sx(), T, false, false],
    [tr(Object.assign({}, heavy, { on: false })), heavy, T, false, false], // a powered-off one does not count
    [tr(mid), mid, T, false, false],                                 // medium on a reference-class device
    [tr(mid), mid, { touch: true, factor: 2 }, false, true],         // … heavy on a device twice as slow
    [{ model: 'serum', vals: heavy.vals, fx: fxWith([]) }, heavy, T, false, true], // a v1 Serum track
    [{ model: 'juno60', vals: {} }, 'juno60', T, false, false],
  ];
  rows.forEach(([t, a, o, w, c], i) => {
    const r = C.softCap(t, a, o);
    assert.deepEqual([typeof r.warn === 'string', typeof r.confirm === 'string', r.warn === null || w, r.confirm === null || c], [w, c, true, true], 'row ' + i);
  });
  const r = C.softCap(tr(J, J, J), 'juno60', T);
  assert.match(r.warn, /4 instruments/); assert.match(r.warn, /~\d+ %/);
  assert.match(C.softCap(tr(heavy), heavy, T).confirm, /heavy.*~\d+ %.*anyway\?/s);
  assert.deepEqual(C.softCap(null, null, T), { warn: null, confirm: null });
});

test('factorOf: median of load / REF over the rows, rounded, clamped; no usable row throws', () => {
  const at = k => Object.fromEntries(Object.entries(C.REF).map(([id, v]) => [id, v * k]));
  assert.equal(C.factorOf(at(1)).factor, 1);
  assert.equal(C.factorOf(at(0.82)).factor, 0.82);
  assert.equal(C.factorOf({ c1: C.REF.c1 * 0.9, j: C.REF.j * 0.7, e: C.REF.e * 1.3 }).factor, 0.9);
  assert.equal(C.factorOf({ c1: C.REF.c1 * 2, j: C.REF.j * 3, e: NaN }).factor, 2.5);
  assert.deepEqual(Object.keys(C.factorOf({ c1: C.REF.c1, x: 1 }).ratios), ['c1']);
  assert.equal(C.factorOf(at(100)).factor, 20); assert.equal(C.factorOf(at(0.001)).factor, 0.05);
  assert.throws(() => C.factorOf({}), /no usable result/); assert.throws(() => C.factorOf({ c1: 0 }), /no usable result/);
});

test('measureDevice: the request, the factor, progress, abort, errors (stub runner); no Worker / AudioWorklet → a clear Error', async () => {
  let req = null;
  const prog = [];
  const runner = async (r, o) => { req = r; o.progress(0.5); o.progress(1); return { c1: C.REF.c1 * 1.5, j: C.REF.j * 1.4, e: C.REF.e * 1.6 }; };
  assert.equal(await C.measureDevice({ runner, progress: x => prog.push(x) }), 1.5);
  assert.deepEqual([req.t, req.rows.map(r => r.id), req.runs, req.seconds, req.sfx, req.base.endsWith('/')], ['run', ['c1', 'j', 'e'], 3, 1, '?v=9', true]);
  assert.ok(req.base.startsWith('file:') && new URL('engine.js', req.base).href === new URL('engine.js', ROOT).href, 'the DSP scripts sit next to cv-cost.js');
  assert.deepEqual(prog, [0, 0.1, 0.55, 1, 1]);
  assert.equal(await C.measureDevice({ runner: async () => ({ c1: C.REF.c1 }), rows: [], runs: 1, seconds: 0.1 }), 1);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(C.measureDevice({ runner, rows: [], signal: ac.signal }), e => e.name === 'AbortError');
  await assert.rejects(C.measureDevice({ runner: async () => { throw new Error('Measuring failed: x'); }, rows: [] }), /Measuring failed: x/);
  await assert.rejects(C.measureDevice({ runner: async () => ({}), rows: [] }), /no usable result/);
  if (typeof globalThis.Worker !== 'function') await assert.rejects(C.measureDevice({ rows: [] }), /needs Web Workers/);
  const W = function () {}, AW = function () {};
  const u = { createObjectURL() {} };
  assert.match(C.supported({}), /Web Workers/);
  assert.match(C.supported({ Worker: W, Blob: W, URL: u }), /AudioWorklet/);
  assert.equal(C.supported({ Worker: W, Blob: W, URL: u, AudioWorkletNode: AW }), null);
  const OAC = function () {}; OAC.prototype.audioWorklet = {};
  assert.equal(C.supported({ Worker: W, Blob: W, URL: u, OfflineAudioContext: OAC }), null);
});

// a fake Worker / Blob / URL global for workerRunner
function fakeGlobal() {
  const G = { made: [], revoked: [], blobs: [] };
  G.Blob = class { constructor(parts, o) { this.text = parts.join(''); this.type = o && o.type; G.blobs.push(this); } };
  G.URL = { createObjectURL: b => { const u = 'blob:fake/' + G.blobs.indexOf(b); return u; }, revokeObjectURL: u => G.revoked.push(u) };
  G.Worker = class { constructor(url) { this.url = url; this.sent = []; this.terminated = 0; G.made.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated++; } };
  return G;
}
test('workerRunner: the message protocol with a fake Worker (progress, done, error, onerror, abort)', async () => {
  const G = fakeGlobal(), run = C.workerRunner({ global: G }), prog = [];
  const p = run({ t: 'run', rows: [] }, { progress: x => prog.push(x) });
  const w = G.made[0];
  assert.deepEqual([w.url, w.sent.length, w.sent[0].t, G.blobs[0].type], ['blob:fake/0', 1, 'run', 'text/javascript']);
  assert.ok(G.blobs[0].text.startsWith('(function workerMain(G)') && G.blobs[0].text.endsWith(')(self);'), 'the blob is workerMain called on self');
  w.onmessage({ data: { t: 'progress', done: 1, total: 4 } });
  w.onmessage({ data: { t: 'progress', done: 4, total: 4 } });
  w.onmessage({ data: { t: 'done', loads: { c1: 0.03 } } });
  assert.deepEqual(await p, { c1: 0.03 });
  assert.deepEqual([prog, w.terminated, G.revoked], [[0.25, 1], 1, ['blob:fake/0']]);
  w.onmessage({ data: { t: 'error', err: 'late' } }); // (after the end: ignored)
  const p2 = run({ t: 'run' });
  G.made[1].onmessage({ data: { t: 'error', err: 'row c1 rendered silence' } });
  await assert.rejects(p2, /Measuring failed: row c1 rendered silence/);
  const p3 = run({ t: 'run' });
  let prevented = 0;
  G.made[2].onerror({ message: 'importScripts failed', preventDefault() { prevented++; } });
  await assert.rejects(p3, /did not load in a Worker \(importScripts failed\)/);
  assert.equal(prevented, 1);
  const ac = new AbortController(), p4 = run({ t: 'run' }, { signal: ac.signal });
  ac.abort();
  await assert.rejects(p4, e => e.name === 'AbortError');
  assert.equal(G.made[3].terminated, 1);
  const ac2 = new AbortController(); ac2.abort();
  await assert.rejects(run({ t: 'run' }, { signal: ac2.signal }), e => e.name === 'AbortError');
  assert.equal(G.made.length, 4, 'an aborted signal starts no Worker');
  const bad = Object.assign(fakeGlobal(), { Worker: class { constructor() { throw new Error('blocked'); } } });
  await assert.rejects(C.workerRunner({ global: bad })({ t: 'run' }), /could not start a Worker: blocked/);
});

test('the measured rows are the bench rows: c1 = bench.html CLASSIC c1, e and j = bench-scenarios', () => {
  const R = C.deviceRows(), by = Object.fromEntries(R.map(r => [r.id, r]));
  assert.deepEqual(R.map(r => r.id), ['c1', 'j', 'e']);
  // c1 (bench.html classic('prophet5', null, 8) at OS 4)
  const m = MODELS.find(x => x.id === 'prophet5'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const p1 = patchFor(m, v, core.defaultFx2(), { sr: 48000, bpm: 120, drift: 0.5, hiss: 1 });
  assert.equal(JSON.stringify(by.c1.patch), JSON.stringify(p1));
  assert.deepEqual([by.c1.kind, by.c1.os, JSON.stringify(by.c1.notes)], ['voice', 4, JSON.stringify(Array.from({ length: 8 }, (_, i) => [48 + 3 * i, 0.8]))]);
  const S = Object.fromEntries(scenarios().map(s => [s.id, s]));
  const e = S.e.build();
  assert.equal(JSON.stringify(by.e.patch), JSON.stringify(e.patch));
  assert.equal(JSON.stringify(by.e.notes), JSON.stringify(e.notes));
  assert.deepEqual([by.e.kind, by.e.os], ['voice', 2]);
  // (bench-scenarios hands every row all its synthetic assets: row e plays the multisample and its 16 zones)
  assert.deepEqual(Object.keys(by.e.assets).sort(), ['msmp:bench'].concat(Array.from({ length: 16 }, (_, i) => `smp:benchz${i >> 1}${i & 1}`)));
  for (const id of Object.keys(by.e.assets)) {
    const a = by.e.assets[id], b = e.assets[id];
    if (b.kind === 'multi') assert.equal(JSON.stringify(a), JSON.stringify(b), id);
    else assert.deepEqual([a.kind, a.len, a.root, a.levels.length, a.levels[0].L.length, a.levels[0].L[1000]], [b.kind, b.len, b.root, b.levels.length, b.levels[0].L.length, b.levels[0].L[1000]], id);
  }
  assert.deepEqual(by.e.tables.map(t => [t.t, t.id]), (e.patch.needs || []).filter(id => !/^(smp|msmp|spec|wtsmp|fsmp|fmsmp):/.test(id)).map(id => ['wt', id]));
  const j = S.j.build();
  assert.equal(JSON.stringify(by.j.fxp), JSON.stringify(j.fxp)); assert.equal(JSON.stringify(by.j.fxt), JSON.stringify(j.fxt));
  const [ja] = Object.keys(j.assets);
  assert.deepEqual(Object.keys(by.j.assets), [ja]);
  assert.deepEqual([by.j.assets[ja].len, by.j.assets[ja].ch, by.j.assets[ja].peak], [j.assets[ja].len, j.assets[ja].ch, j.assets[ja].peak]);
  structuredClone(R); // (postMessage-able)
});

// the Worker body in a node:vm "worker": importScripts reads the repository files (URLs = base + file + sfx)
function vmWorker() {
  const posted = [], urls = [], BASE = 'https://synth.test/app/', SFX = '?v=9';
  const g = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} }, performance });
  g.self = g;
  g.importScripts = (...us) => {
    for (const u of us) {
      urls.push(u);
      assert.ok(u.startsWith(BASE) && u.endsWith(SFX), 'absolute, versioned: ' + u);
      const f = u.slice(BASE.length, -SFX.length);
      vm.runInContext(read(f), g, { filename: 'worker/' + f });
    }
  };
  g.postMessage = m => posted.push(m);
  vm.runInContext('(' + String(C.workerMain) + ')(self);', g, { filename: 'cv-cost-worker.js' });
  return { g, posted, urls, send: d => g.onmessage({ data: Object.assign({ base: BASE, sfx: SFX }, d) }) };
}
test('the Worker body renders the rows (vm worker): DSP scripts + engine.js loaded once, progress, loads; silence is an error', () => {
  const W = vmWorker();
  W.send({ t: 'run', rows: C.deviceRows(), runs: 2, seconds: 0.05 });
  const last = W.posted[W.posted.length - 1];
  assert.equal(last.t, 'done', JSON.stringify(last));
  assert.deepEqual(W.posted.slice(0, -1).map(m => [m.t, m.done, m.total]), [1, 2, 3, 4, 5, 6].map(k => ['progress', k, 6]));
  assert.deepEqual(Object.keys(last.loads), ['c1', 'j', 'e']);
  for (const [id, x] of Object.entries(last.loads)) assert.ok(Number.isFinite(x) && x > 0 && x < 5, id + ' ' + x);
  const files = W.urls.map(u => u.slice('https://synth.test/app/'.length, -4));
  assert.deepEqual(files, ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js', 'sx-seq.js',
    'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js', 'dr-808.js', 'dr-seq.js', 'mod-core.js', 'engine.js']);
  assert.equal(W.g.SxBase.getAsset('msmp:bench'), null, 'the row assets are dropped after the row');
  // a second run in the same worker loads nothing again; a silent row (no notes) is an error, not a load
  const c1 = C.deviceRows()[0];
  W.send({ t: 'run', rows: [Object.assign({}, c1, { notes: [] })], runs: 1, seconds: 0.02 });
  assert.equal(W.urls.length, 15);
  assert.equal(JSON.stringify(W.posted[W.posted.length - 1]), JSON.stringify({ t: 'error', err: 'row c1 rendered silence' }));
  const n = W.posted.length;
  W.g.onmessage({ data: { t: 'other' } });
  assert.equal(W.posted.length, n, 'other messages are ignored');
});
