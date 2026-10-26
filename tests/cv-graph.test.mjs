// cv-graph.js tests (SPEC-canvas §5.1, §5.5, §6.7, §10 stage 1a skeleton): v1 tracks and the canonical v2 shapes present
// today's v1 view (patchFor of it equals the track's own, every factory preset); validation codes; topological order.
// Stage 1e (IMPL-1e §3.1, §5): the graph form (tests/fixtures/graph-1e.mjs), compileGraph = today's patch for canonical
// tracks (instPatch + chainPatch), the new validation codes, the structure key.
// Run: node --max-old-space-size=2048 --test tests/cv-graph.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../cv-graph.js?v=9';
import { MODELS, patchFor, isSerumModel } from '../models.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as F2 from './fixtures/mods-2a.mjs';

const clone = x => JSON.parse(JSON.stringify(x));
const OPTS = { sr: 48000, bpm: 120 };
// every factory sound as a v1 track (classic: the default panel + preset over it, a reverb in the Main rack of every
// other one; Serum: the preset's own FX)
function v1Tracks() {
  const out = [];
  for (const m of MODELS) {
    if (m.custom) { // ((WC) the Serum's 86 once: the rig (custom too) holds the same presets — its compile is G2's, tests/rig-sound)
      if (isSerumModel(m)) for (const p of C.FACTORY_PRESETS) {
        const s = C.normalizeSerum(clone(p.v.s));
        out.push({ id: 'trk_' + out.length, model: 'serum', vals: { s }, preset: p.name, fx: p.fx ? C.normalizeFx(clone(p.fx), s) : C.defaultFx2() });
      }
      continue;
    }
    const def = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
    for (const [i, p] of [{ name: 'Init', v: {} }, ...m.presets].entries()) {
      const fx = C.defaultFx2();
      if (i % 2) C.newInstance(fx, 'rev', { rack: 0 });
      out.push({ id: 'trk_' + out.length, model: m.id, vals: Object.assign({}, def, p.v), preset: p.name, seq: m.id === 'tb303' ? { pat: [] } : undefined, fx });
    }
  }
  return out;
}
// the v2 form of a v1 track (§5.1; stage 1c's toV2 owns the real conversion): classic → i1 → fx1 (its Main rack) → out;
// Serum (its own FX inside) → out
function v2Of(t, o = {}) {
  const i1 = { kind: 'synth', model: t.model, vals: t.vals, preset: t.preset, seq: t.seq || null, on: true, solo: false, zone: { lo: 0, hi: 127, xp: 0 } };
  if (t.model === 'serum') return { id: t.id, prim: 'i1', dev: { i1: Object.assign(i1, { fx: t.fx }), out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in', g: 1 }], mods: [] };
  const r = t.fx.racks[0];
  return { id: t.id, prim: 'i1', dev: { i1, fx1: { kind: 'panel', rack: { mods: r.mods, byp: r.byp, lock: r.lock, ui: t.fx.ui }, name: 'FX Panel A' }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in', g: 1 }, { id: 'w2', a: 'fx1.out', b: 'out.in', g: 1 }], mods: [], ...o };
}

test('v1 tracks are canonical: their v1 view is the track (patchFor equal for every factory sound)', () => {
  const T = v1Tracks();
  assert.ok(T.length > 140, T.length);
  for (const t of T) {
    const r = G.compileTrack(t);
    assert.equal(r.canonical, true);
    assert.equal(r.shape, t.model === 'serum' ? 'serum' : 'classic');
    assert.deepEqual(patchFor(r.v1.model, r.v1.vals, r.v1.fx, OPTS), patchFor(t.model, t.vals, t.fx, OPTS), t.model + ' ' + t.preset);
  }
});

test('the canonical v2 shapes (§5.5) present the same v1 view: today\'s patch, every factory sound', () => {
  for (const t of v1Tracks()) {
    const v2 = v2Of(t), r = G.compileTrack(v2);
    assert.equal(G.validate(v2).ok, true, t.preset);
    assert.deepEqual([r.canonical, r.inst], [true, 'i1'], t.preset);
    assert.deepEqual(patchFor(r.v1.model, r.v1.vals, r.v1.fx, OPTS), patchFor(t.model, t.vals, t.fx, OPTS), t.model + ' ' + t.preset);
    assert.equal(r.v1.preset, t.preset);
  }
  // a classic instrument straight into OUT: today's empty rack
  const t = v1Tracks().find(x => x.model === 'juno60' && !x.fx.racks[0].mods.length);
  const direct = { prim: 'i1', dev: { i1: v2Of(t).dev.i1, out: { kind: 'out' } }, wires: [{ a: 'i1.out', b: 'out.in' }] };
  const r = G.compileTrack(direct);
  assert.deepEqual([r.canonical, r.shape], [true, 'classic']);
  assert.deepEqual(r.v1.fx, C.defaultFx2());
});

test('shapes that are not today\'s are not canonical (the graph protocol, stage 1e)', () => {
  const T = v1Tracks(), juno = T.find(x => x.model === 'juno60'), moog = T.find(x => x.model === 'minimoog'), sx = T.find(x => x.model === 'serum');
  const two = v2Of(juno);
  two.dev.i2 = Object.assign(clone(v2Of(moog).dev.i1), { on: true });
  two.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in', g: 1 });
  assert.equal(G.validate(two).ok, true);
  assert.deepEqual([G.compileTrack(two).canonical, G.compileTrack(two).why], [false, 'several']);
  two.dev.i2.on = false; // powered off: today's shape again (it sounds nothing)
  assert.equal(G.compileTrack(two).canonical, true);
  two.dev.i2.on = true; two.dev.i2.solo = true; // solo in track: only i2 sounds
  assert.deepEqual([G.compileTrack(two).canonical, G.compileTrack(two).inst, G.compileTrack(two).v1.model], [true, 'i2', 'minimoog']);
  const off = v2Of(juno); off.dev.i1.on = false;
  assert.equal(G.compileTrack(off).why, 'none');
  const lvl = v2Of(juno); lvl.wires[1].g = 0.5; // a level on the way
  assert.equal(G.compileTrack(lvl).why, 'shape');
  const sxp = v2Of(sx); // Serum → a shared panel → OUT
  sxp.dev.fx1 = { kind: 'panel', rack: { mods: [], byp: 0, lock: 0 } };
  sxp.wires = [{ a: 'i1.out', b: 'fx1.in' }, { a: 'fx1.out', b: 'out.in' }];
  assert.deepEqual([G.validate(sxp).ok, G.compileTrack(sxp).why], [true, 'shape']);
  const silent = v2Of(juno); silent.wires = [];
  assert.equal(G.compileTrack(silent).why, 'shape');
  const bad = v2Of(juno); delete bad.dev.out;
  assert.equal(G.compileTrack(bad).why, 'invalid');
});

test('validate: every refusal code', () => {
  const t = v2Of(v1Tracks().find(x => x.model === 'prophet5')), codes = x => G.validate(x).errors.map(e => e.code);
  assert.deepEqual(codes(t), []);
  const w = (...wires) => Object.assign(clone(t), { wires });
  assert.deepEqual(codes(w({ a: 'i1.out', b: 'nope.in' })), ['end']);
  assert.deepEqual(codes(w({ a: 'i1.out', b: 'fx1.side' })), ['end']);
  assert.deepEqual(codes(w({ a: 'fx1.in', b: 'out.in' })), ['dir']);
  assert.deepEqual(codes(w({ a: 'i1.out', b: 'fx1.in' }, { a: 'i1.out', b: 'fx1.in' })), ['dup']);
  assert.deepEqual(codes(w({ a: 'i1.out', b: 'fx1.in' }, { a: 'i1.out', b: 'out.in' })), ['fan-out']);
  const ch = w({ a: 'i1.out', b: 'fx1.in' }, { a: 'fx1.out', b: 'fx2.in' }, { a: 'fx2.out', b: 'out.in' });
  ch.dev.fx2 = { kind: 'panel', rack: { mods: [] } };
  assert.deepEqual(codes(ch), ['chain']);
  const loop = w({ a: 'fx1.out', b: 'fx1.in' });
  assert.ok(codes(loop).includes('cycle'));
  assert.equal(G.order(loop), null);
  const sx = v2Of(v1Tracks().find(x => x.model === 'serum')), into = Object.assign(clone(sx), { dev: Object.assign(clone(sx.dev), { i2: clone(t.dev.i1) }) });
  into.wires.push({ a: 'i2.out', b: 'i1.in' });
  assert.deepEqual(codes(into), ['own-fx']);
  const outs = clone(t); outs.dev.out2 = { kind: 'out' };
  assert.deepEqual(codes(outs), ['out']);
  const many = clone(t);
  for (let i = 2; i <= 9; i++) many.dev['i' + i] = clone(t.dev.i1);
  for (let i = 2; i <= 17; i++) many.dev['fx' + i] = { kind: 'panel', rack: { mods: [] } };
  many.dev.fx1.rack = { mods: Array.from({ length: 47 }, (_, i) => ({ id: 'e' + i, type: 'eq' })).concat([{ id: 's', type: 'split3', br: [[{ id: 'x' }], [{ id: 'y' }], []] }]) };
  assert.deepEqual(codes(many).sort(), ['fx', 'inst', 'panels']);
  assert.deepEqual([G.LIMITS.inst, G.LIMITS.panels, G.LIMITS.fxPerPanel], [8, 16, 48]);
  assert.equal(G.effectCount(many.dev.fx1.rack), 50);
  const prim = clone(t); prim.prim = 'fx1';
  assert.deepEqual(codes(prim), ['prim']);
  // modulation rows (§7.8): a classic knob of class struct / none cannot take one
  const mods = clone(t); mods.mods = [{ id: 'r1', src: 'l1.out', dst: 'i1:fc' }, { id: 'r2', src: 'l1.out', dst: 'i1:un' }, { id: 'r3', src: 'l1.out', dst: 'zz:fc' }];
  assert.deepEqual(G.validate(mods).errors.map(e => [e.code, e.at]), [['nomod', 'r2'], ['end', 'r3']]);
  assert.deepEqual(G.validate({ model: 'juno60', vals: {} }), { ok: true, errors: [] }, 'a v1 track: today\'s shape');
});

test('order: sources before what they feed (stable), powered, ports and kinds', () => {
  const t = { dev: { out: { kind: 'out' }, fx1: { kind: 'panel', rack: {} }, i2: { kind: 'synth', model: 'dx7', on: false }, l1: { kind: 'lfo' }, i1: { kind: 'synth', model: 'juno60' } },
    wires: [{ a: 'fx1.out', b: 'out.in' }, { a: 'i1.out', b: 'fx1.in' }, { a: 'i2.out', b: 'out.in' }] };
  assert.deepEqual(G.order(t), ['i2', 'l1', 'i1', 'fx1', 'out']); // (ready devices in dev key order)
  assert.deepEqual(G.powered(t), ['i1']);
  assert.deepEqual([G.port('i2/oscA.out'), G.port('fx1.in'), G.port('x'), G.port(3)], [{ dev: 'i2/oscA', port: 'out' }, { dev: 'fx1', port: 'in' }, null, null]);
  assert.deepEqual(['synth', 'panel', 'out', 'lfo', 'macro', 'nope'].map(kind => G.kindOf({ kind })), ['inst', 'panel', 'out', 'mod', 'mod', null]);
  assert.deepEqual([G.isV2(t), G.isV2({ model: 'x' }), G.order({ model: 'x' })], [true, false, null]);
});

/* ---------------------------------------------------------------- stage 1e: the graph form (IMPL-1e §3.1, §5) */
const F = await import('./fixtures/graph-1e.mjs?v=9');
const keyless = g => { const o = Object.assign({}, g); delete o.key; delete o.t; return o; };

test('1e: the fixture tracks compile to the graph form (not canonical): graph, patches, chains, salts as written out', () => {
  const T = F.tracks();
  for (const [k, why] of [['a', 'several'], ['b', 'shape'], ['c', 'several']]) {
    const t = T[k], r = G.compileTrack(t);
    assert.deepEqual([r.canonical, r.why, G.validate(t).ok], [false, why, true], k);
    assert.deepEqual(keyless(r.graph), F.GRAPH[k], k);
    assert.deepEqual(Object.keys(r.patches), r.graph.insts.map(x => x.id), k);
    assert.deepEqual(Object.keys(r.chains), r.graph.chains.map(x => x.id), k);
    for (const id of Object.keys(r.patches)) {
      const d = t.dev[id], p = r.patches[id];
      assert.equal(p.vals === d.vals && p.model === d.model && p.preset === d.preset, true, k + id + ': the device\'s own objects');
      assert.equal(p.fx === (d.model === 'serum' ? d.fx : undefined), true, k + id + ': fx a Serum\'s own');
    }
    for (const id of Object.keys(r.chains)) assert.equal(r.chains[id] === t.dev[id].fx, true, k + id + ': the panel\'s state');
    assert.deepEqual(r.powered, k === 'b' ? ['i1'] : ['i1', 'i2']);
    assert.equal(typeof r.graph.key, 'string');
    assert.deepEqual(G.compileGraph(t).graph, r.graph, 'compileGraph = compileTrack for a graph shape');
  }
  assert.deepEqual([G.saltOf('i1', 'i1'), G.saltOf('i2', 'i1'), G.saltOf('i1', 'i2'), G.saltOf('i7', 'i1')],
    [0, (2 * 0x9E3779B9) >>> 0, 0x9E3779B9, (7 * 0x9E3779B9) >>> 0]);
  assert.deepEqual([G.devNum('fx12'), G.devNum('out'), G.devNum('i3')], [12, 0, 3]);
});

test('1e: the fixture messages are compileGraph + instPatch + chainPatch at the host\'s options (graph, patch i, chain c)', () => {
  const T = F.tracks();
  for (const k of ['a', 'b', 'c', 'a2']) {
    const M = F.MSGS[k], t = T[k], g = G.compileGraph(t);
    assert.deepEqual(M.map(m => m.t + ':' + (m.i || m.c || '')), ['graph:', ...g.graph.insts.map(x => 'patch:' + x.id), ...g.graph.chains.map(x => 'chain:' + x.id)], k);
    assert.deepEqual(keyless(M[0]), F.GRAPH[k], k);
    assert.equal(M[0].key, g.graph.key);
    for (const m of M.filter(x => x.t === 'patch')) assert.equal(t.dev[m.i].model === 'serum' ? 'fxr' in m.p && m.p.osCap === 8 : !('fxr' in m.p) && !('fxrT' in m.p), true, k + m.i);
  }
  // (a2) canonical: the Inst's patch + its chain's rack = today's patch of that track (the legacy {t:'patch', p})
  const t = T.a2, d = t.dev.i1, M = F.MSGS.a2, legacy = patchFor(d.model, d.vals, t.dev.fx1.fx, F.OPTS);
  assert.equal(G.compileTrack(t).canonical, true);
  assert.deepEqual(Object.assign({}, M[1].p, { fxr: M[2].fxr, fxrT: M[2].fxrT }), legacy);
});

test('1e: compileGraph of every canonical factory sound = today\'s patch (instPatch + chainPatch; a Serum its own FX)', () => {
  for (const t of v1Tracks()) {
    for (const x of [t, v2Of(t)]) {
      const g = G.compileGraph(x), legacy = patchFor(t.model, t.vals, t.fx, OPTS);
      assert.deepEqual([g.canonical, g.graph.insts.map(i => [i.id, i.on, i.salt]), g.graph.out], [true, [['i1', true, 0]], 'out'], t.preset);
      const P = g.patches.i1, ip = G.instPatch({ model: P.model, vals: P.vals, fx: P.fx }, OPTS);
      if (t.model === 'serum') {
        assert.deepEqual([g.graph.chains, g.graph.edges], [[], [['i1', 'out', 1]]]);
        assert.deepEqual(ip, legacy, t.preset);
      } else {
        assert.deepEqual([g.graph.chains, g.graph.edges], [[{ id: 'fx1' }], [['i1', 'fx1', 1], ['fx1', 'out', 1]]]);
        assert.deepEqual(patchFor(P.model, P.vals, g.chains.fx1, OPTS), legacy, t.preset);
        const both = Object.assign({}, ip, G.chainPatch(g.chains.fx1, OPTS)), L = Object.assign({}, legacy);
        assert.deepEqual([...(both.needs || [])].sort(), [...(L.needs || [])].sort(), t.preset);
        delete both.needs; delete L.needs;
        assert.deepEqual(both, L, t.preset + ': the Inst\'s patch + its chain = today\'s');
      }
    }
  }
});

test('1e: validate — fan-in allowed, levels, zones, power / solo flags; an invalid track compiles its usable cables', () => {
  const T = F.tracks(), codes = x => G.validate(x).errors.map(e => e.code);
  assert.deepEqual(codes(T.a), [], 'two instruments into one panel (fan-in)');
  const into = clone(T.c); into.wires.push({ id: 'w9', a: 'fx2.out', b: 'out.in' }); // (dup of w4's jacks)
  assert.deepEqual(codes(into), ['dup']);
  const lv = clone(T.c);
  for (const g of [-1, NaN, Infinity, '1']) { lv.wires[3].g = g; assert.deepEqual(codes(lv), ['g'], String(g)); }
  lv.wires[3].g = 0; assert.deepEqual(codes(lv), [], 'level 0 is a level');
  const z = clone(T.a);
  for (const zone of [{ lo: 0, hi: 128 }, { lo: 60, hi: 59 }, { lo: 1.5, hi: 9 }, { lo: 0, hi: 127, xp: 49 }, { lo: 0, hi: 127, xp: -49 }, 'all']) {
    z.dev.i2.zone = zone; assert.deepEqual(codes(z), ['zone'], JSON.stringify(zone));
  }
  z.dev.i2.zone = { lo: 48, hi: 72, xp: -12 }; assert.deepEqual(codes(z), []);
  assert.deepEqual(G.compileTrack(z).graph.insts[1].zone, { lo: 48, hi: 72, xp: -12 });
  const f = clone(T.a); f.dev.i2.on = 1; assert.deepEqual(codes(f), ['flag']);
  f.dev.i2.on = false; f.dev.i2.solo = 'yes'; assert.deepEqual(codes(f), ['flag']);
  assert.deepEqual(G.zoneOf({}), { lo: 0, hi: 127, xp: 0 });
  assert.deepEqual(G.zoneOf({ zone: { lo: 90, hi: 30, xp: 99 } }), { lo: 30, hi: 90, xp: 48 });
  // fan-out and panel → panel refused; the compile keeps the first cable of an output and no chain
  const bad = clone(T.c);
  bad.wires.push({ id: 'w5', a: 'i1.out', b: 'fx2.in' }, { id: 'w6', a: 'fx1.out', b: 'fx2.in' });
  assert.deepEqual(codes(bad).sort(), ['chain', 'fan-out', 'fan-out']);
  const r = G.compileTrack(bad);
  assert.deepEqual([r.canonical, r.why], [false, 'invalid']);
  assert.deepEqual(r.graph.edges, F.GRAPH.c.edges);
});

test('1e: the graph key follows the structure (power, solo, zone, level, cables, primary), not the sound', () => {
  const t = F.tracks().a, k0 = G.compileGraph(t).graph.key, key = () => G.compileGraph(t).graph.key;
  t.dev.i1.vals.vcf = 7; t.dev.fx1.fx.racks[0].mods.length = 0;
  assert.equal(key(), k0, 'knobs and racks are patches, not structure');
  for (const [edit, undo] of [
    [() => { t.dev.i2.on = false; }, () => { delete t.dev.i2.on; }],
    [() => { t.dev.i2.solo = true; }, () => { delete t.dev.i2.solo; }],
    [() => { t.dev.i2.zone = { lo: 0, hi: 59, xp: 0 }; }, () => { delete t.dev.i2.zone; }],
    [() => { t.wires[2].g = 0.25; }, () => { delete t.wires[2].g; }],
    [() => { t.prim = 'i2'; }, () => { t.prim = 'i1'; }],
  ]) { edit(); assert.notEqual(key(), k0); undo(); assert.equal(key(), k0); }
  t.prim = 'i2';
  assert.deepEqual(G.compileGraph(t).graph.insts.map(x => [x.id, x.salt]), [['i2', 0], ['i1', 0x9E3779B9]], 'the primary first, salt 0');
});

/* host fixes (the stage-1e review round) */
test('H3: a key zone or transpose on the sounding instrument is not today\'s shape (the graph carries it); the full zone is', () => {
  const T = v1Tracks(), juno = v2Of(T.find(x => x.model === 'juno60')), sx = v2Of(T.find(x => x.model === 'serum'));
  assert.deepEqual([G.compileTrack(juno).canonical, G.compileTrack(sx).canonical], [true, true], '(zone 0…127, 0 written out)');
  for (const [t, z] of [[juno, { lo: 60, hi: 127, xp: 0 }], [juno, { lo: 0, hi: 127, xp: 12 }], [sx, { lo: 0, hi: 72, xp: -12 }]]) {
    t.dev.i1.zone = z;
    const c = G.compileTrack(t);
    assert.deepEqual([c.canonical, c.why, c.graph.insts[0].zone], [false, 'shape', z], JSON.stringify(z));
  }
  delete juno.dev.i1.zone;
  assert.equal(G.compileTrack(juno).canonical, true);
  // an instrument that does not sound keeps its zone without changing the shape (it plays nothing)
  juno.dev.i2 = { kind: 'synth', model: 'minimoog', vals: {}, preset: null, on: false, zone: { lo: 0, hi: 59, xp: 0 } };
  juno.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' });
  assert.equal(G.compileTrack(juno).canonical, true);
});

/* ------------------------------------------------------------------ stage 2a: canvas mod rows (IMPL-2a §2.1) */
test('2a fixture (tests/fixtures/mods-2a.mjs): merged matrices, placed / left, the budget and the compiled matrix fields', () => {
  const T = F2.tracks(), OPT = { sr: 48000, bpm: 120 };
  const Z = { why: {}, max: 64, slots: { lfo: [0, 10], env: [0, 4], chaos: [0, 2], macro: [0, 8], vals: [0, 16], ext: [0, 16] } }; // (2b: the ModCore budgets, nothing used)
  const budgets = [{ preset: 0, canvas: 2, left: [], ...Z }, { preset: 1, canvas: 1, left: [], ...Z }, { preset: 64, canvas: 0, left: ['r1'], why: { r1: 'full' }, max: 64, slots: Z.slots }];
  for (const [i, t] of T.entries()) {
    const d = t.dev.i1, s = d.vals.s, rows = G.modRowsFor(t, 'i1'), inj = G.injectMods(d, rows), E = F2.MERGED[i];
    assert.deepEqual(rows, t.mods, 'every row ends on i1');
    assert.deepEqual([inj.placed, inj.left], [E.placed, E.left], t.id);
    for (let k = 0; k < 64; k++) {
      if (E.rows[k]) assert.deepEqual(inj.s.matrix[k], E.rows[k], t.id + ' slot ' + k);
      if (!E.placed.some(x => x.slot === k)) assert.equal(inj.s.matrix[k], s.matrix[k], 'the preset\'s rows by identity');
    }
    if (!E.placed.length) assert.equal(inj.s, s);
    assert.deepEqual(G.modBudget(t, 'i1'), budgets[i], t.id);
    const p = G.instPatch(d, OPT, rows);
    assert.deepEqual(F2.cpOf(p), F2.CP[i], t.id + ': the posted matrix fields');
    // the same rows written into s.matrix (as the Serum's own tiles would) compile identically
    const o = clone(s);
    for (const k of Object.keys(E.rows)) o.matrix[k] = clone(E.rows[k]);
    assert.deepEqual(p, patchFor('serum', { s: o }, d.fx, OPT), t.id);
    assert.deepEqual(G.validate(t), { ok: true, errors: [] });
    assert.equal(G.compileTrack(t).canonical, true, 'modulator devices and rows keep the canonical shape');
    assert.deepEqual(G.compileGraph(t).graph.insts.map(x => x.id), ['i1'], 'modulators are not instruments');
  }
});

test('2a modRowsFor / nativeRow: rows by device (not by prefix), the native row, refusals', () => {
  const t = { mods: [{ id: 'r1', src: 'wheel', dst: 'i1:f.cutoff' }, { id: 'r2', src: 'wheel', dst: 'i10:f.cutoff' }, null, { id: 'r3', src: 'bd.out', dst: 'i1:' }, { id: 'r4', src: 'at.out', dst: 'i1:a.level' }] };
  assert.deepEqual(G.modRowsFor(t, 'i1').map(r => r.id), ['r1', 'r4']);
  assert.deepEqual(G.modRowsFor(t, 'i10').map(r => r.id), ['r2']);
  assert.deepEqual([G.modRowsFor({}, 'i1'), G.modRowsFor(null, 'i1')], [[], []]);
  const n = G.nativeRow({ id: 'r9', src: 've.out', dst: 'i2:fx.d1.mix', amt: 3, bi: true, curve: -2, out: 0.5, rise: 0.4, fall: 0.9, slink: 1, crv: [[0.5, 2], [0, 0]] });
  assert.deepEqual(n, { src: 'velo', amt: 1, dst: 'fx.d1.mix', bi: 1, curve: -1, aux: '', inv: 0, byp: 0, out: 0.5, acurve: 0, crv: [[0, 0, 0], [1, 1, 0]], rise: 0.4, fall: 0.4, slink: 1 });
  assert.equal(G.nativeRow({ src: 'wheel', dst: 'i1:a.level', aux: 'lfo3' }).aux, 'lfo3');
  for (const r of [{ src: 'lfo1', dst: 'i1:f.cutoff' }, { src: 'wheel', dst: 'f.cutoff' }, { src: 'wheel', dst: 'i1:nope' }, { src: 'wheel', dst: 'i1:a.level', aux: 'nope' }, null])
    assert.equal(G.nativeRow(r), null, JSON.stringify(r));
});

// host fixes (2a review H5)
test('2a review H5: a placed row keeps its slot while that slot stays free — an earlier row removed; a native row in its slot moves that one alone', () => {
  const t = F2.tracks()[0], d = t.dev.i1, at = () => G.injectMods(d, G.modRowsFor(t, 'i1')).placed.map(x => x.id + '@' + x.slot).join(' ');
  assert.equal(at(), 'r1@0 r2@1');
  t.mods = t.mods.filter(r => r.id !== 'r1');
  assert.equal(at(), 'r2@1', 'r2 stays in slot 1');
  assert.deepEqual([G.modBudget(t, 'i1').preset, G.modBudget(t, 'i1').canvas, G.modBudget(t, 'i1').left], [0, 1, []]);
  t.mods.push(Object.assign({}, F2.tracks()[0].mods[0], { id: 'r3' }));
  assert.equal(at(), 'r2@1 r3@0', 'a new row: the first free slot');
  const M = d.vals.s.matrix.slice(); M[0] = C.normRow({ src: 'lfo1', amt: 0.2, dst: 'f.res' }); d.vals.s.matrix = M; // (the Serum's own tile: its first empty slot)
  assert.equal(at(), 'r2@1 r3@2', 'r3 moves, r2 stays');
  d.vals.s = Object.assign({}, d.vals.s, { matrix: d.vals.s.matrix.slice() }); // (a preset load: a new s in the same vals)
  assert.equal(at(), 'r2@1 r3@2');
  assert.deepEqual(F2.cpOf(G.instPatch(d, { sr: 48000, bpm: 120 }, G.modRowsFor(t, 'i1'))).mSlot, [0, 1, 2], 'the compile');
  const u = F2.tracks()[0];
  assert.equal(G.injectMods(u.dev.i1, u.mods).placed.map(x => x.id + '@' + x.slot).join(' '), 'r1@0 r2@1', 'another device: its own slots');
});

/* ------------------------------------------------------------------ stage 2b: compileMods, ext rows, slot injection (IMPL-2b §3.1, §3.3) */
import * as F3 from './fixtures/mods-2b.mjs';
import { fxLayout, fxDest } from '../fx-core.js?v=9';
import { normModDev } from '../song.js?v=9';
const PRJ = { bpm: 120, perf: { wheel: { v: 1 } } };
const cm = (t, o) => G.compileMods(t, PRJ, Object.assign({ xferOf: F3.XFER, targetsOf: F3.TARGETS }, o));
const sans = p => { const o = Object.assign({}, p); delete o.cp; delete o.ct; delete o.key; delete o.t; delete o.i; return o; };
const cpOf = cp => ({ mN: cp.mN, mSlot: [...cp.mSlot.slice(0, cp.mN)], mSrc: [...cp.mSrc.slice(0, cp.mN)], mDst: [...cp.mDst.slice(0, cp.mN)], mAmt: [...cp.mAmt.slice(0, cp.mN)], mBi: [...cp.mBi.slice(0, cp.mN)],
  mCtx: [...cp.mCtx.slice(0, cp.mN)], lfoMono: [...cp.lfoMono], lfoMode: [...cp.lfoMode], aOn: cp.base[C.vi('a.on')], poly: cp.poly });
const PO = Object.assign({}, OPTS, { prefs: {} });

test('2b the three-row track (fixture 0): the payload as written — an ext row for the Serum, a cls row with its transfer, an fx row; the synthetic CP', () => {
  const t = F3.tracks()[0], pay = cm(t), E = clone(F3.PAY1);
  E.rows[1].dst.key = fxLayout(t.dev.fx1.fx).key;
  assert.deepEqual([pay.t, pay.i], ['mods', 'trk_b1']);
  assert.deepEqual(sans(pay), E);
  assert.deepEqual(cpOf(pay.cp), F3.CP1, 'the synthetic CP: the module in lfo1 (GLOBAL: mono), the other slots parked FREE + MONO, no oscillator, one voice');
  assert.equal(pay.ct.key, pay.cp.ctKey, 'ct: the synthetic state\'s CT parts');
  assert.ok(/^[0-9a-f]{8}$/.test(pay.key));
  assert.deepEqual([pay.rows[0].vi, pay.rows[1].vi], [C.vi(G.SCRATCH[0]), C.vi(G.SCRATCH[1])], 'vi: each row its own scratch destination');
  assert.equal([...pay.cp.srcUsed].filter(x => x).length, 1, 'one source evaluated');
  assert.equal(pay.cp.mDst[0], C.vi(G.SCRATCH[0]));
  assert.deepEqual(G.instPatch(t.dev.i1, PO, [], pay.ext, t).needs, patchFor('serum', t.dev.i1.vals, t.dev.i1.fx, PO).needs, 'the Serum\'s own needs as before');
  // the Serum: the ext row injected (src 'ext1'), compiled with the ext flag
  const d = t.dev.i1, inj = G.injectMods(d, G.modRowsFor(t, 'i1'), pay.ext, t);
  assert.deepEqual([inj.placed, inj.left, inj.dashed, inj.inj], [[{ id: 'r1', slot: 0, src: 'ext1' }], [], [], []]);
  assert.deepEqual(inj.s.matrix[0], Object.assign(C.normRow({ src: 'wheel', amt: 0.5, dst: 'f.cutoff' }), { src: 'ext1' }));
  assert.equal(inj.s.p, d.vals.s.p, 'no slot injected: p shared');
  const P = G.instPatch(d, PO, G.modRowsFor(t, 'i1'), pay.ext, t);
  assert.deepEqual(P, patchFor('serum', { s: inj.s }, d.fx, Object.assign({}, PO, { ext: true })), 'instPatch: the merged state with opts.ext');
  assert.deepEqual(G.modBudget(t, 'i1', PRJ), { preset: 0, canvas: 1, left: [], why: {}, max: 64, slots: { lfo: [1, 10], env: [0, 4], chaos: [0, 2], macro: [0, 8], vals: [0, 16], ext: [1, 16] } });
  assert.deepEqual(G.modBudget(t, 'i2', PRJ), { preset: 0, canvas: 1, left: [], why: {}, max: 64, slots: { lfo: [1, 10], env: [0, 4], chaos: [0, 2], macro: [0, 8], vals: [0, 16], ext: [1, 16] } });
  assert.deepEqual(G.modBudget(t, 'fx1', PRJ).canvas, 1);
});

test('2b every source kind (fixture 1): ext / slot injection / value source / cls / set (one row per target) / fx / linked / note / wheel / chaos / own-LFO native', () => {
  const t = F3.tracks()[1], pay = cm(t), d = t.dev.i1;
  assert.deepEqual(pay.n, { lfo: 2, env: 1, chaos: 1, macro: 1, vals: 1, ext: 2, rows: 7 }, '(rows: distinct cables — the two-target knob counts once, C6)');
  assert.deepEqual(pay.ext, [{ k: 1, src: C.SRC_INDEX.lfo1, id: 'l1.out' }, { k: 2, src: G.S_EXT0, id: 'c1.out' }], 'ext: the GLOBAL LFO (lfo1 of the synthetic CP) and the CC (value source ext1 = index 62)');
  assert.deepEqual(pay.vals, [{ k: 2, src: C.SRC_INDEX.macro3, v: 0.25, id: 'm1.k3' }, { k: 8, src: G.S_EXT0, v: 0.5, id: 'c1.out' }], 'the value table: the macro knob at 2 (its value), the CC at 8');
  const sv = k => C.vi(G.SCRATCH[k]);
  assert.deepEqual(pay.rows.map(r => [r.id, r.src, r.dst.kind, r.dst.slot !== undefined ? r.dst.slot : r.dst.field !== undefined ? r.dst.field : r.dst.fx, r.perNote, r.vi, r.tgt]), [
    ['r3', C.SRC_INDEX.lfo1, 'cls', 0, false, sv(0), 0], ['r4', C.SRC_INDEX.env2, 'set', 'fenv.a', true, sv(1), 0], ['r4', C.SRC_INDEX.env2, 'set', 'aenv.a', true, sv(1), 1], ['r5', C.SRC_INDEX.macro3, 'fx', 8 + fxDest('fx.rev.mix', t.dev.fx1.fx).flat, false, sv(2), 0],
    ['r6', C.SRC_INDEX.lfo2, 'cls', 3, true, sv(3), 0], ['r8', C.SRC_INDEX.note, 'cls', 11, true, sv(4), 0], ['r9', C.SRC_INDEX.wheel, 'cls', 0, false, sv(5), 0], ['r10', C.SRC_INDEX.chaos1, 'cls', 0, false, sv(6), 0]],
    'the Juno Env A knob: two payload rows (fenv.a, aenv.a) on one synthetic row');
  assert.deepEqual(pay.dashed, ['r4', 'r6', 'r8'], 'per-note sources on non-Serum destinations');
  assert.deepEqual(pay.left, []);
  assert.deepEqual(pay.xfer.map(x => x && x.of), ['juno60.cf:0', 'juno60.a:fenv.a', 'juno60.a:aenv.a', null, 'juno60.rs:3', 'juno60.lv:11', 'juno60.cf:0', 'juno60.cf:0']);
  assert.ok(pay.xfer.every(x => x === null || x.x0 === 0.5), 'x0 travels with each transfer');
  assert.deepEqual(pay.keep, [C.SRC_INDEX.lfo1], 'the ext-listed LFO keeps alive regardless (C1); the ENV, the chaos and the linked LFO are read by live synthetic rows');
  assert.deepEqual(pay.slots, { l1: { kind: 'lfo', i: 0 }, 'i1/lfo2': { kind: 'lfo', i: 1 }, e1: { kind: 'env', i: 10 }, h1: { kind: 'chaos', i: 14 } }, 'pay.slots: each evaluated module → its ModCore slot in the live-meter order');
  // the synthetic CP: lfo1 = l1 (GLOBAL, rate 0.3), lfo2 = the Serum's own LFO 2 copied (poly), env2 = e1, chaos1 = h1, macro3 = m1.k3
  const cp = pay.cp;
  assert.deepEqual([[...cp.lfoMono].slice(0, 3), cp.base[C.vi('l1.rate')], cp.base[C.vi('e2.att')], cp.base[C.vi('e2.dec')], cp.base[C.vi('e2.ca')], cp.base[C.vi('e2.cd')], cp.base[C.vi('c1.rate')], cp.macro[2]], [[1, 0, 1], 0.3, 0.2, 0.4, 0.4, 0.666, 0.4, 0.25]);
  assert.equal(cp.mN, 8, 'seven synthetic rows (the two-target knob shares one) and l1\'s keep-alive');
  // the Serum: r1 → ext1, r2 → lfo2 injected (l2's state: ENVELOPE mode, its points, mono 0 — the Serum's own LFO 1 is what r11
  // reads, so the module takes the next free slot), r7 → ext2, r11 its own lfo1 as it is
  const inj = G.injectMods(d, G.modRowsFor(t, 'i1'), pay.ext, t);
  assert.deepEqual(inj.placed, [{ id: 'r1', slot: 0, src: 'ext1' }, { id: 'r2', slot: 1, src: 'lfo2' }, { id: 'r7', slot: 2, src: 'ext2' }, { id: 'r11', slot: 3, src: 'lfo1' }]);
  assert.deepEqual([inj.left, inj.dashed, inj.inj], [[], [], [{ id: 'r2', kind: 'lfo', k: 1, src: 'l2.out' }]]);
  assert.deepEqual(inj.s.lfo[1], C.normLfo(t.dev.l2.lfo), 'the slot holds the module\'s LFO');
  assert.deepEqual([inj.s.lfo[1].mono, inj.s.lfo[1].mode, inj.s.p['l2.rate']], [0, 'env', t.dev.l2.rate]);
  assert.equal(inj.s.lfo[0], d.vals.s.lfo[0], 'the other slots by identity (LFO 1: what r11 reads)');
  assert.notEqual(inj.s.p, d.vals.s.p);
  assert.deepEqual(d.vals.s.lfo[1], C.normLfo({}), 'vals.s never mutated');
  const P = G.instPatch(d, PO, G.modRowsFor(t, 'i1'), pay.ext, t);
  const used = [...P.serum.mSrc.slice(0, P.serum.mN)];
  assert.ok(used.includes(C.SRC_INDEX.lfo2) && P.serum.lfoMono[1] === 0, 'the Serum evaluates the injected slot per voice');
  assert.notDeepEqual(P.serumT.parts.lfo1, patchFor('serum', d.vals, d.fx, OPTS).serumT.parts.lfo1, 'the CT part of the injected LFO');
  assert.deepEqual(G.modBudget(t, 'i1', PRJ).slots, { lfo: [2, 10], env: [1, 4], chaos: [1, 2], macro: [1, 8], vals: [1, 16], ext: [2, 16] });
});

test('2b budgets and left reasons (fixture 2): the 11th LFO module \'slots\', the 17th ext source \'ext\'; a 49th synthetic row \'full\'', () => {
  const t = F3.tracks()[2], pay = cm(t);
  assert.deepEqual([pay.n.lfo, pay.n.macro, pay.n.vals, pay.n.ext, pay.n.rows], [10, 8, 8, 16, 10], '(macro: the knobs in use)');
  assert.deepEqual(pay.left, [{ id: 'r11', why: 'slots' }, { id: 'r28', why: 'ext' }]);
  assert.deepEqual(pay.ext.map(e => e.id), [...Array.from({ length: 8 }, (_, k) => 'm1.k' + (k + 1)), ...Array.from({ length: 8 }, (_, k) => 'c' + (k + 1) + '.out')]);
  assert.deepEqual(pay.vals.map(v => [v.k, v.v]), [...Array.from({ length: 8 }, (_, k) => [k, (k + 1) / 10]), ...Array.from({ length: 8 }, (_, k) => [8 + k, 0])]);
  assert.deepEqual(G.modBudget(t, 'i2', PRJ).left, ['r11']);
  assert.deepEqual(G.modBudget(t, 'i1', PRJ).left, ['r28']);
  assert.deepEqual(G.modBudget(t, 'i1', PRJ).why, { r28: 'ext' });
  assert.equal(G.injectMods(t.dev.i1, G.modRowsFor(t, 'i1'), pay.ext, t).placed.length, 16);
  // the synthetic rows: SYN_MAX (48) per track, the rest 'full' (the keep-alives always fit after them)
  const u = F3.tracks()[0];
  u.mods = Array.from({ length: 50 }, (_, k) => Object.assign({}, u.mods[1], { id: 'r' + (k + 1) }));
  const q = cm(u);
  assert.deepEqual([q.rows.length, q.left.map(x => x.id + ':' + x.why)], [48, ['r49:full', 'r50:full']]);
  assert.equal(G.SYN_MAX, 48);
});

test('2b slot injection falls back to ext when the Serum has no free slot (fixture 3): dashed, why; an ENV goes into env2; keep-alive rows', () => {
  const t = F3.tracks()[3], d = t.dev.i1, pay = cm(t);
  assert.deepEqual(pay.ext, [{ k: 1, src: C.SRC_INDEX.lfo1, id: 'l1.out' }], 'the PER NOTE LFO takes a ModCore slot (the pseudo-voice evaluates it) and an ext slot');
  assert.deepEqual([pay.n.lfo, pay.n.env, pay.dashed, pay.left], [1, 0, ['r1'], []]);
  assert.deepEqual(pay.keep, [C.SRC_INDEX.lfo1], 'no synthetic row reads it: a keep-alive row');
  assert.deepEqual([pay.cp.mN, pay.cp.mSrc[0], pay.cp.mDst[0], pay.cp.mAmt[0], pay.cp.lfoMono[0]], [1, C.SRC_INDEX.lfo1, C.vi(G.KEEP_ID), 1, 0]);
  const inj = G.injectMods(d, G.modRowsFor(t, 'i1'), pay.ext, t);
  assert.deepEqual(inj.placed, [{ id: 'r1', slot: 10, src: 'ext1' }, { id: 'r2', slot: 11, src: 'env2' }]);
  assert.deepEqual([inj.dashed, inj.inj], [['r1'], [{ id: 'r2', kind: 'env', k: 1, src: 'e1.out' }]]);
  assert.deepEqual([inj.s.p['e2.att'], inj.s.env[1]], [0.3, { bpm: 0, legInv: 0, stealRe: 0 }]);
  assert.deepEqual(G.modBudget(t, 'i1', PRJ).slots.ext, [1, 16]);
  // a slot freed (a preset row removed) → the next compile injects instead; the hint keeps a slot while free
  d.vals.s.matrix[4] = C.normRow(null);
  const q = cm(t), j = G.injectMods(d, G.modRowsFor(t, 'i1'), q.ext, t);
  assert.deepEqual([q.ext, q.dashed, q.n.lfo, j.placed.map(x => x.src), j.inj.map(x => x.k)], [[], [], 0, ['lfo5', 'env2'], [4, 1]]);
  assert.equal(j.s.lfo[4].mono, 0);
  d.vals.s.matrix[2] = C.normRow(null);
  assert.deepEqual(G.injectMods(d, G.modRowsFor(t, 'i1'), q.ext, t).inj.map(x => x.k), [4, 1], 'the hint: slot 5 stays');
  // the ENV slot is not free when its knobs moved or a row reads it
  d.vals.s.p['e2.dec'] = 0.1;
  assert.deepEqual(G.injectMods(d, G.modRowsFor(t, 'i1'), q.ext, t).inj.map(x => [x.kind, x.k]), [['lfo', 4], ['env', 2]]);
  // a GLOBAL LFO only on Serum knobs: a ModCore slot, ext, a keep-alive row; the rest parked
  t.dev.l1.lfo.mono = 1;
  const g = cm(t);
  assert.deepEqual([g.n.lfo, g.ext.length, g.keep, g.dashed, g.cp.lfoMono[0], g.cp.lfoMode[0], [...g.cp.lfoMode].slice(1)], [1, 1, [C.SRC_INDEX.lfo1], [], 1, 0, [2, 2, 2, 2, 2, 2, 2, 2, 2]]);
});

test('2b linked Serum modulators: copied into a ModCore slot once per source; a Serum\'s own LFO on its own knob is native; the key follows the linked state', () => {
  const t = F3.tracks()[1], d = t.dev.i1;
  t.mods.push({ id: 'r12', src: 'i1/lfo2.out', dst: 'i2:lv', amt: 0.1, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  const pay = cm(t);
  assert.deepEqual([pay.n.lfo, pay.rows.filter(r => r.src === C.SRC_INDEX.lfo2).map(r => r.id)], [2, ['r6', 'r12']], 'one slot for both rows');
  d.vals.s.lfo[1] = Object.assign(C.normLfo({}), { mono: 1 });
  const q = cm(t);
  assert.notEqual(q.key, pay.key);
  assert.deepEqual([q.cp.lfoMono[1], q.dashed.includes('r6')], [1, false], 'a MONO Serum LFO is a global');
  assert.ok(G.injectMods(d, G.modRowsFor(t, 'i1'), q.ext, t).placed.some(x => x.id === 'r11' && x.src === 'lfo1'));
  // a linked LFO on another Serum's knob: a poly one is injected into that Serum, a mono one travels through ext
  const u = F3.tracks()[0];
  u.dev.i3 = { kind: 'synth', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) }, preset: null, fx: C.defaultFx2() };
  u.wires.push({ id: 'w4', a: 'i3.out', b: 'out.in' });
  u.mods = [{ id: 'r1', src: 'i1/lfo3.out', dst: 'i3:f.cutoff', amt: 0.3, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }];
  let p = cm(u), j = G.injectMods(u.dev.i3, G.modRowsFor(u, 'i3'), p.ext, u);
  assert.deepEqual([p.ext, j.placed[0].src, j.inj[0].kind], [[], 'lfo1', 'lfo']);
  u.dev.i1.vals.s.lfo[2].mono = 1;
  p = cm(u); j = G.injectMods(u.dev.i3, G.modRowsFor(u, 'i3'), p.ext, u);
  assert.deepEqual([p.ext.map(e => e.id), j.placed[0].src, p.cp.lfoMono[0]], [['i1/lfo3.out'], 'ext1', 1]);
});

test('2b the content key: stable across Serum / uncabled knob turns, changes with a cabled classic knob (its transfer), a module edit or a row', () => {
  const t = F3.tracks()[1], pay = cm(t);
  assert.equal(cm(t), pay, 'memoised');
  t.dev.i1.vals.s.p['f.res'] = 0.7;
  assert.equal(cm(t).key, pay.key, 'a Serum knob');
  t.dev.fx1.fx.racks[0].mods[0].p.mix = 0.9;
  assert.equal(cm(t).key, pay.key, 'a panel knob');
  t.dev.i2.vals.rs = 7;
  const k1 = cm(t).key;
  assert.notEqual(k1, pay.key, 'a cabled classic knob: xfer recomputed');
  t.dev.l1.rate = 0.9;
  const k2 = cm(t).key;
  assert.notEqual(k2, k1, 'a module edit');
  t.mods[0].amt = 0.1;
  assert.equal(cm(t).key, k2, 'a Serum row\'s amount: the Serum\'s patch changes, the payload (its ext list) does not');
  t.mods[2].amt = 0.1;
  assert.notEqual(cm(t).key, k2, 'a ModCore row\'s amount');
  assert.deepEqual(cm(t).ext, pay.ext);
});

test('2b null / empty / identity: no modules and no rows → null; a 2a track (native rows only) → a payload with nothing to evaluate; the 2a fixture compiles as before', () => {
  const T = F2.tracks();
  assert.equal(G.compileMods({ id: 'x', dev: { i1: { kind: 'synth', model: 'serum', vals: {} } }, mods: [] }, PRJ), null);
  assert.equal(G.compileMods(null, PRJ), null);
  for (const t of T) {
    const pay = cm(t);
    assert.ok(pay && !pay.rows.length && !pay.ext.length && !pay.vals.length && !pay.keep.length, t.id + ': nothing for ModCore');
    const d = t.dev.i1, rows = G.modRowsFor(t, 'i1');
    assert.deepEqual(G.instPatch(d, OPTS, rows, pay.ext, t), G.instPatch(d, OPTS, rows), t.id + ': the same patch');
    assert.deepEqual([G.injectMods(d, rows, pay.ext, t).placed, G.injectMods(d, rows).placed], [F2.MERGED[T.indexOf(t)].placed, F2.MERGED[T.indexOf(t)].placed]);
  }
  assert.deepEqual(G.chainPatch(C.defaultFx2(), OPTS), G.chainPatch(C.defaultFx2(), OPTS));
  // a deleted module: its rows went with it → null (the host posts { t: 'mods', off: true })
  const t = F3.tracks()[0];
  delete t.dev.l1; t.mods = [];
  assert.equal(cm(t), null);
});

test('2b the scratch destinations: V-scope rows of silent modules, never note-on / LFO / ENV / chaos / porta / voice-control ones; S_EXT0 / EXT_N', () => {
  assert.ok(G.SCRATCH.length > G.SYN_MAX, G.SCRATCH.length);
  const NO = new Set(C.NOTE_ON_DESTS);
  for (const id of G.SCRATCH) {
    const d = C.DESTS[C.DEST_INDEX[id]];
    assert.ok(d && d.scope === 'V' && C.vi(id) >= 0 && !NO.has(id) && !/^(l\d+|e\d|c\d|g|vc|m\d)\./.test(id) && !/\.(on|w2|fbal|bus\d)$/.test(id), id);
  }
  assert.equal(new Set(G.SCRATCH).size, G.SCRATCH.length);
  assert.equal(G.KEEP_ID, G.SCRATCH[G.SCRATCH.length - 1]);
  assert.deepEqual([G.S_EXT0, G.EXT_N, G.VAL_N], [62, 16, 16]);
  assert.ok(G.MOD_KINDS.has('chaos') && G.kindOf({ kind: 'chaos' }) === 'mod');
});

/* ------------------------------------------------------------- stage 2b review fixes (fixer B; findings-2b C1…C13, U4, U8) */
const byp = (t, id, f) => Object.assign(t.mods.find(r => r.id === id), f);
test('C1: a bypassed / amt-0 / out-0 synthetic row does not starve its source — `used` from live rows only, and an ext-listed source keeps alive regardless', () => {
  for (const f of [{ byp: 1 }, { amt: 0 }, { out: 0 }]) {
    const t = F3.tracks()[0];
    byp(t, 'r2', f); byp(t, 'r3', f);
    const pay = cm(t);
    assert.deepEqual([pay.keep, pay.ext.length, pay.cp.srcUsed[C.SRC_INDEX.lfo1]], [[C.SRC_INDEX.lfo1], 1, 1], JSON.stringify(f) + ': the Serum\'s ext1 source is evaluated');
    assert.equal(pay.cp.mSrc[pay.cp.mN - 1], C.SRC_INDEX.lfo1, 'the keep-alive row is the last CP row');
    assert.equal(pay.cp.mDst[pay.cp.mN - 1], C.vi(G.KEEP_ID));
  }
  // no ext at all: the LFO feeds a bypassed Juno row only → still evaluated (the row may be un-bypassed by the next edit; nothing else reads it)
  const u = F3.tracks()[0];
  u.mods = [byp(u, 'r2', { byp: 1 })];
  const q = cm(u);
  assert.deepEqual([q.keep, q.rows.length, q.cp.srcUsed[C.SRC_INDEX.lfo1]], [[C.SRC_INDEX.lfo1], 1, 1]);
  // a live row and no ext: no keep-alive (as before)
  const w = F3.tracks()[0];
  w.mods = [w.mods[1]];
  assert.deepEqual(cm(w).keep, []);
});

test('C2: the memo signature carries the instrument\'s model — a model change with the same vals JSON rebuilds (new targets, new transfer)', () => {
  const t = F3.tracks()[0], pay = cm(t);
  t.dev.i2.model = 'obxa';
  const q = cm(t);
  assert.notEqual(q, pay);
  assert.deepEqual([q.xfer[0].of, q.rows[0].dst.inst], ['obxa.cf:0', 'i2']);
  assert.notEqual(q.key, pay.key);
});

test('C3 / P1: the hit / miss rule — an uncabled knob of a cabled instrument is a memo HIT; a cabled knob or one of its transfer\'s neighbours a MISS; module values (macro / CC v) never miss; timings (loose)', () => {
  const t = F3.tracks()[2]; // (28 rows: 11 LFOs → Juno cf, 8 macro knobs + 8 CCs → the Serum, l1 → the Serum)
  t.dev.i3 = { kind: 'synth', model: 'minimoog', vals: { v2: 5, m2: 1 }, preset: null };
  t.wires.push({ id: 'w4', a: 'i3.out', b: 'out.in' });
  t.mods.push(Object.assign({}, t.mods[0], { id: 'r90', dst: 'i3:v2' }));
  const o = { smooth: 1 }, run = () => G.compileMods(t, PRJ, o); // (the real transfers)
  const p0 = run();
  assert.equal(run(), p0, 'hit');
  t.dev.i2.vals.rs = 7; t.dev.i2.vals.ch = 2; t.dev.i3.vals.fc = 3; t.dev.i1.vals.s.p['f.res'] = 0.9;
  assert.equal(run(), p0, 'uncabled knobs of the cabled Juno / Minimoog, a Serum knob: HIT');
  t.dev.i2.vals.cf = 2;
  const p1 = run();
  assert.notEqual(p1, p0, 'the cabled Juno cutoff: MISS');
  assert.notEqual(p1.key, p0.key, 'its transfer (x0) is in the key');
  t.dev.i3.vals.m2 = 0;
  const p2 = run();
  assert.notEqual(p2, p1, 'the Minimoog mixer switch — a neighbour the level knob\'s transfer depends on: MISS');
  const xm = p2.xfer[p2.rows.findIndex(r => r.id === 'r90')];
  assert.deepEqual([xm.a, xm.b], [0, 0], 'the switch off: an inert transfer (b 0), the cable kept');
  assert.equal(run(), p2);
  assert.equal(p2.rows.filter(r => r.id === 'r90').length, 1, 'the row stays compiled while the switch is off');
  t.dev.m1.v[0] = 0.77; t.dev.c1.v = 0.33;
  assert.equal(run(), p2, 'macro / CC values: HIT (C5) …');
  assert.deepEqual([p2.vals.find(v => v.id === 'm1.k1').v, p2.vals.find(v => v.id === 'c1.out').v], [0.77, 0.33], '… and the payload\'s vals carry the latest value');
  t.dev.m1.names[0] = 'Cut';
  assert.notEqual(run(), p2, 'a macro name: MISS (the synthetic CP names it)');
  t.mods[0].byp = 1;
  const p3 = run();
  assert.notEqual(p3, p2, 'a row edit: MISS');
  // timings: the hit path is a hash of what the compile reads; the miss recompiles with the transfers cached (loose bounds: ≤ 8 × the targets)
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const hits = [], misses = [];
  for (let k = 0; k < 40; k++) { const t0 = performance.now(); run(); hits.push(performance.now() - t0); }
  for (let k = 0; k < 12; k++) { t.dev.i2.vals.cf = 1 + (k % 9); const t0 = performance.now(); run(); misses.push(performance.now() - t0); }
  console.log(`    compileMods (29 rows): hit ${med(hits).toFixed(3)} ms, miss (a cabled knob) ${med(misses).toFixed(2)} ms`);
  assert.ok(med(hits) < 0.4, 'hit ' + med(hits));
  assert.ok(med(misses) < 24, 'miss ' + med(misses));
});

test('C5: the content key excludes macro / CC values (k, src, id stay): no repost at a macro gesture end', () => {
  const t = F3.tracks()[1], pay = cm(t);
  t.dev.m1.v[2] = 0.9; t.dev.c1.v = 0.1;
  const q = cm(t);
  assert.equal(q.key, pay.key);
  assert.deepEqual(q.vals.map(v => [v.k, v.id, v.v]), [[2, 'm1.k3', 0.9], [8, 'c1.out', 0.1]]);
  t.dev.m1.v[0] = 0.5; // (an uncabled knob of the macro)
  assert.equal(cm(t).key, pay.key);
});

test('C6 / U9: n.rows and modBudget.canvas count distinct cables, not payload rows (a knob that moves two things)', () => {
  const t = F3.tracks()[1], pay = cm(t);
  assert.equal(pay.rows.length, 8);
  assert.equal(pay.n.rows, 7);
  assert.deepEqual([G.modBudget(t, 'i2', PRJ).canvas, G.modBudget(t, 'fx1', PRJ).canvas, G.modBudget(t, 'i1', PRJ).canvas], [6, 1, 4]);
});

test('C9: a preset that fills the Serum\'s matrix is seen by the memo — left / why \'full\' never stale', () => {
  const t = F3.tracks()[0], pay = cm(t);
  assert.deepEqual(pay.left, []);
  for (let k = 0; k < C.N_MATRIX; k++) t.dev.i1.vals.s.matrix[k] = C.normRow({ src: 'lfo2', amt: 0.1, dst: 'a.wt' });
  const q = cm(t);
  assert.notEqual(q, pay);
  assert.deepEqual([q.left, G.modBudget(t, 'i1', PRJ).why], [[{ id: 'r1', why: 'full' }], { r1: 'full' }]);
  t.dev.i1.vals.s.matrix[63] = C.normRow(null);
  assert.deepEqual(cm(t).left, []);
});

test('U4: modBudget prefers the payload\'s reason — the 11th GLOBAL LFO on a Serum knob is \'slots\', not \'ext\'', () => {
  const t = F3.tracks()[2];
  t.mods.push(Object.assign({}, t.mods[0], { id: 'r99', src: 'l11.out', dst: 'i1:f.res' }));
  const pay = cm(t), b = G.modBudget(t, 'i1', PRJ);
  assert.deepEqual(pay.left.find(x => x.id === 'r99'), { id: 'r99', why: 'slots' });
  assert.deepEqual([b.why.r99, b.why.r28, b.left.includes('r99')], ['slots', 'ext', true]);
});

test('pay.slots: lfo slots 0…9, ENV 2 3 4 1 → 10…13, chaos 14…15; only evaluated modules (an injected PER NOTE LFO has none)', () => {
  const t = F3.tracks()[0];
  for (const k of [1, 2, 3, 4]) t.dev['e' + k] = normModDev({ kind: 'env' });
  t.dev.h1 = normModDev({ kind: 'chaos' }); t.dev.h2 = normModDev({ kind: 'chaos' }); t.dev.l2 = normModDev({ kind: 'lfo', lfo: { mono: 0 } });
  let n = 10;
  for (const id of ['e1', 'e2', 'e3', 'e4', 'h1', 'h2']) t.mods.push(Object.assign({}, t.mods[1], { id: 'r' + n++, src: id + '.out' }));
  t.mods.push(Object.assign({}, t.mods[0], { id: 'r' + n++, src: 'l2.out' })); // (PER NOTE → the Serum: injected, no ModCore slot)
  const pay = cm(t);
  assert.deepEqual(pay.slots, { l1: { kind: 'lfo', i: 0 }, e1: { kind: 'env', i: 10 }, e2: { kind: 'env', i: 11 }, e3: { kind: 'env', i: 12 }, e4: { kind: 'env', i: 13 }, h1: { kind: 'chaos', i: 14 }, h2: { kind: 'chaos', i: 15 } });
  assert.deepEqual(pay.n.env, 4);
});

/* ------------------------------------------------------------------ PER NOTE injection never takes a slot a row reads or targets (stage 2b, bug: "a canvas LFO on LFO 1 Rate") */
// a Serum (default state) with a canvas LFO module l1 (PER NOTE) and a Serum track around it, rows added by hand
function slotTrack(rows, mono = 0) {
  const s = C.normalizeSerum(C.defaultSerum());
  const t = { id: 'trk_s', name: 'S', notes: [], cc: [], prim: 'i1', nid: 4, dev: { i1: { kind: 'synth', model: 'serum', vals: { s }, preset: null, fx: C.defaultFx2() }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [] };
  t.dev.l1 = normModDev({ kind: 'lfo', lfo: { mono, mode: 'retrig' }, rate: 0.3 });
  t.dev.e1 = normModDev({ kind: 'env' });
  const R = (id, src, dst, x = {}) => ({ id, src, dst, amt: 0.5, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0, ...x });
  t.mods = rows.map(([id, src, dst, x]) => R(id, src, dst, x));
  return t;
}
const injOf = t => { const pay = G.compileMods(t, PRJ, {}); return G.injectMods(t.dev.i1, G.modRowsFor(t, 'i1'), pay.ext, t); };

test('slot injection never takes the LFO a row targets: a PER NOTE LFO on LFO 1 Rate goes to LFO 2, never into LFO 1 itself (LFO 1 would modulate its own rate); an ENV on ENV 2 Attack not into ENV 2', () => {
  const a = injOf(slotTrack([['r1', 'l1.out', 'i1:l1.rate']]));
  assert.deepEqual([a.placed, a.inj.map(x => [x.kind, x.k])], [[{ id: 'r1', slot: 0, src: 'lfo2' }], [['lfo', 1]]], 'LFO 2 carries the module; the row reads lfo2, not lfo1');
  assert.deepEqual(a.s.lfo[0], C.normLfo({}), 'LFO 1 is the Serum\'s own, untouched');
  const b = injOf(slotTrack([['r1', 'l1.out', 'i1:l2.rate'], ['r2', 'l1.out', 'i1:l1.smooth']]));
  assert.deepEqual(b.placed.map(x => x.src), ['lfo3', 'lfo3'], 'both LFOs targeted (1 and 2): the module is in LFO 3, one slot per source');
  const c = injOf(slotTrack([['r1', 'e1.out', 'i1:e2.att']]));
  assert.deepEqual([c.placed, c.inj.map(x => [x.kind, x.k])], [[{ id: 'r1', slot: 0, src: 'env3' }], [['env', 2]]], 'ENV 3 carries the module, not ENV 2 whose attack the row moves');
  // a native Serum matrix row aimed at a slot's parameter keeps that slot too
  const t = slotTrack([['r1', 'l1.out', 'i1:f.cutoff']]);
  t.dev.i1.vals.s.matrix[0] = C.normRow({ src: 'macro1', dst: 'l1.rate', amt: 0.3 });
  const d = injOf(t);
  assert.deepEqual(d.placed.find(x => x.id === 'r1').src, 'lfo2', 'the preset row macro1 → l1.rate keeps LFO 1 the Serum\'s own');
});

test('slot injection never takes an LFO / ENV a canvas row reads: the Serum\'s own LFO 1 cabled to its pan (link row) or an aux LFO 2 keeps its slot; the PER NOTE module goes to the next free one', () => {
  const a = injOf(slotTrack([['r1', 'i1/lfo1.out', 'i1:a.pan'], ['r2', 'l1.out', 'i1:l1.rate']]));
  assert.deepEqual(a.placed, [{ id: 'r1', slot: 0, src: 'lfo1' }, { id: 'r2', slot: 1, src: 'lfo2' }], 'r1 reads the Serum\'s own LFO 1; r2 the module in LFO 2');
  assert.deepEqual(a.s.lfo[0], C.normLfo({}), 'LFO 1 untouched (what r1 reads)');
  assert.equal(a.s.lfo[1].mono, 0);
  const b = injOf(slotTrack([['r1', 'l1.out', 'i1:f.cutoff', { aux: 'lfo1' }]]));
  assert.equal(b.placed[0].src, 'lfo2', 'a row\'s aux source lfo1 is a read of the Serum\'s LFO 1');
  const c = injOf(slotTrack([['r1', 'i1/lfo2.out', 'i1:a.pan'], ['r2', 'i1/lfo1.out', 'i1:a.level'], ['r3', 'l1.out', 'i1:f.cutoff']]));
  assert.deepEqual(c.placed.map(x => x.src), ['lfo2', 'lfo1', 'lfo3'], 'LFO 1 and 2 read: the module in LFO 3');
});

test('slot injection with nothing in the way is as before: the first free LFO (LFO 1) / ENV 2', () => {
  const a = injOf(slotTrack([['r1', 'l1.out', 'i1:f.cutoff'], ['r2', 'e1.out', 'i1:a.pan']]));
  assert.deepEqual(a.placed.map(x => x.src), ['lfo1', 'env2']);
});

/* ------------------------------------------------------------------ IMPL-8 §5.3 (lane Q): a mod pad compiled into a value slot */
import * as PC from '../pads-core.js?v=9';
const fnvH = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const payH = pay => { const p = Object.assign({}, pay); delete p.cp; delete p.ct; return [pay.key, fnvH(JSON.stringify(p)), fnvH(JSON.stringify([pay.cp.cpKey, pay.ct.key]))]; };
// D5: the 2a / 2b fixtures' compile taken at 20854b7 (cv-graph = 8815b14's) BEFORE any pad change (memoSig, payH, as here):
// [memo signature (real transfer: no stub function, whose memo id depends on test order), key, a hash of the payload sans
// cp / ct (vals' v included), a hash of the cp / ct keys]
const PIN_B_STUB = [['20a235e9', '1835650c', '30a2b80e'], ['1a587787', 'f8ae8970', '591e125a'], ['514539e3', 'a9aee286', 'f70abb4a'], ['fc329eee', '62156853', '33338b9e']];
const PIN_B_REAL = [['b04833836c1dd58', '88f0b88b', 'ee5bc141', '30a2b80e'], ['a8892c22154454ff', '3c24fdf1', '1525b9b3', '591e125a'], ['46e2e33c56e5359f', 'fe4e19a9', 'fb354a3d', 'f70abb4a'], ['1a64146ebfba7321', 'fc329eee', '62156853', '33338b9e']];
const PIN_A = [['878c61125508bcd', '18b441d4', '913007d3', 'd413b878'], ['700ca6ce11e6593e', '18b441d4', '448e9f88', 'd413b878'], ['7a83f0049b5f3425', '0ed3c71d', '6882a017', 'd413b878']];
const REAL = { smooth: 1, qr: null, ultra: 0 };
const padMod = (id, slots, o) => { const pads = new Array(64).fill(null); for (const [i, m] of Object.entries(slots)) pads[i] = { mod: m }; return Object.assign({ id, pads }, o); };
// a project with Pads modules and another track holding pad rows (D5: a track without pad rows compiles as if none existed)
const padPrj = () => ({ bpm: 120, perf: { wheel: { v: 1 } }, pads: PC.normPads([padMod('pd1', { 0: {}, 3: { lo: 0.1 }, 12: { lo: 0.25 } }), padMod('pd3', { 63: { m: 'gate' } })]),
  tracks: [{ id: 'trk_x', dev: {}, mods: [{ id: 'r1', src: 'pd1.p0', dst: 'i1:f.cutoff' }] }] });
test('IMPL-8 D5: a track without pad rows compiles byte-identically to 8815b14 — memo signature, content key, payload — with or without Pads modules (and pad rows elsewhere) in the project', () => {
  for (const P of [PRJ, padPrj()]) {
    const run = (t, o) => { const sig = G.memoSig(t, P, o), pay = G.compileMods(t, P, o); return [sig, ...payH(pay)]; };
    F3.tracks().forEach((t, i) => assert.deepEqual(payH(G.compileMods(t, P, { xferOf: F3.XFER, targetsOf: F3.TARGETS })), PIN_B_STUB[i], 'b' + i + ' stub'));
    F3.tracks().forEach((t, i) => assert.deepEqual(run(t, REAL), PIN_B_REAL[i], 'b' + i));
    F2.tracks().forEach((t, i) => assert.deepEqual(run(t, REAL), PIN_A[i], 'a' + i));
    F3.tracks().forEach((t, i) => assert.deepEqual(run(t, Object.assign({ padVal: () => 0.5 }, REAL)), PIN_B_REAL[i], 'b' + i + ': padVal changes nothing'));
  }
});
// the three-row track (l1 → the Serum's cutoff, the Juno's cutoff, the reverb's mix) + a CC module and pad rows to every kind
function padTrack() {
  const t = F3.tracks()[0], row = (id, src, dst) => Object.assign({}, t.mods[0], { id, src, dst, amt: 0.25 });
  t.dev.c1 = normModDev({ kind: 'cc', cc: 74, v: 0.5 });
  t.mods.push(row('r4', 'pd1.p12', 'i2:cf'), row('r5', 'pd1.p3', 'i1:f.res'), row('r6', 'pd2.p0', 'fx1:fx.rev.mix'), row('r7', 'c1.out', 'i2:rs'), row('r8', 'pd1.p3', 'i2:rs'));
  return t;
}
test('IMPL-8 §5.3 a mod pad takes a value slot after the track\'s modules (pads sorted: module, then slot — numerically); vals[].v from padVal, else the pad\'s lo (0 without its module); a Serum row from a pad an ext slot', () => {
  const t = padTrack(), P = padPrj(), pv = id => ({ 'pd1.p3': 0.7 })[id];
  const pay = G.compileMods(t, P, { xferOf: F3.XFER, targetsOf: F3.TARGETS, padVal: pv });
  assert.deepEqual(pay.vals, [{ k: 8, src: G.S_EXT0, v: 0.5, id: 'c1.out' }, { k: 9, src: G.S_EXT0 + 1, v: 0.7, id: 'pd1.p3' }, { k: 10, src: G.S_EXT0 + 2, v: 0.25, id: 'pd1.p12' }, { k: 11, src: G.S_EXT0 + 3, v: 0, id: 'pd2.p0' }],
    'c1 first (a module), then pd1.p3 < pd1.p12 < pd2.p0; pd1.p12 at its lo, pd2.p0 has no module (H prunes such rows at load: 0 here)');
  assert.deepEqual(pay.ext.map(e => [e.k, e.id, e.src]), [[1, 'l1.out', C.SRC_INDEX.lfo1], [2, 'pd1.p3', G.S_EXT0 + 1]], 'the Serum\'s pad row: an ext slot fed by the value source');
  assert.deepEqual([pay.n.vals, pay.n.ext, pay.left, pay.dashed], [4, 2, [], []]);
  assert.deepEqual(pay.rows.filter(r => /^r[4-8]$/.test(r.id)).map(r => [r.id, r.src, r.dst.kind, r.perNote]), [['r4', G.S_EXT0 + 2, 'cls', false], ['r6', G.S_EXT0 + 3, 'fx', false], ['r7', G.S_EXT0, 'cls', false], ['r8', G.S_EXT0 + 1, 'cls', false]],
    'one slot per source (r5 and r8 share pd1.p3\'s); GLOBAL, never dashed');
  const inj = G.injectMods(t.dev.i1, G.modRowsFor(t, 'i1'), pay.ext, t);
  assert.deepEqual(inj.placed, [{ id: 'r1', slot: 0, src: 'ext1' }, { id: 'r5', slot: 1, src: 'ext2' }]);
  assert.deepEqual(G.compileMods(padTrack(), P, { xferOf: F3.XFER, targetsOf: F3.TARGETS }).vals.map(v => v.v), [0.5, 0.1, 0.25, 0], 'no padVal: each pad\'s lo');
  assert.deepEqual(G.compileMods(padTrack(), { bpm: 120 }, { xferOf: F3.XFER, targetsOf: F3.TARGETS }).vals.map(v => v.v), [0.5, 0, 0, 0], 'no p.pads: 0');
  assert.deepEqual(G.compileMods(padTrack(), P, { xferOf: F3.XFER, targetsOf: F3.TARGETS, padVal: () => 7 }).vals.map(v => v.v), [0.5, 1, 1, 1], 'a host value clamped to 0…1');
  assert.deepEqual(G.modBudget(t, 'i2', P).slots.vals, [4, 16]);
});
test('IMPL-8 §5.3 the 17th value source is left, why \'slots\' (16 per track, shared with CC modules and further macro knobs) — a Serum row too (\'slots\', not \'ext\'); modBudget says 16/16', () => {
  const t = F3.tracks()[0], row = (id, src, dst) => Object.assign({}, t.mods[0], { id, src, dst, amt: 0.25 });
  t.mods = [];
  for (let k = 1; k <= 8; k++) { t.dev['c' + k] = normModDev({ kind: 'cc', cc: k }); t.mods.push(row('r' + k, 'c' + k + '.out', 'i2:cf')); }
  for (let i = 8; i >= 0; i--) t.mods.push(row('r' + (17 - i), 'pd1.p' + i, 'i2:rs')); // (rows in reverse: the slots follow the sorted ids)
  t.mods.push(row('r18', 'pd2.p0', 'i1:f.cutoff'));
  const pay = cm(t);
  assert.deepEqual([pay.n.vals, pay.left], [16, [{ id: 'r9', why: 'slots' }, { id: 'r18', why: 'slots' }]], 'pd1.p8 (sorted 17th) and pd2.p0');
  assert.deepEqual(pay.vals.map(v => v.id).slice(8), ['pd1.p0', 'pd1.p1', 'pd1.p2', 'pd1.p3', 'pd1.p4', 'pd1.p5', 'pd1.p6', 'pd1.p7']);
  assert.deepEqual([pay.vals[8].k, pay.vals[15].k], [16, 23]);
  assert.deepEqual([G.modBudget(t, 'i2', PRJ).slots.vals, G.modBudget(t, 'i2', PRJ).left, G.modBudget(t, 'i1', PRJ).left, G.modBudget(t, 'i1', PRJ).why], [[16, 16], ['r9'], ['r18'], { r18: 'slots' }]);
  t.mods = t.mods.filter(r => r.id !== 'r1');
  assert.deepEqual(cm(t).left, [{ id: 'r18', why: 'slots' }], 'a CC row gone: pd1.p8 takes the freed slot');
});
test('IMPL-8 §5.3 a press never reposts: the memo signature and the key ignore the pad\'s value (and its mode / range: the host\'s) — a memo hit refreshes vals[].v; removing the pad rows compiles the pad-free track again (its pins)', () => {
  const t = padTrack(), P = padPrj(), o = v => ({ smooth: 1, qr: null, ultra: 0, padVal: id => (id === 'pd1.p3' ? v : undefined) });
  const a = G.compileMods(t, P, o(0.3)), key = a.key, sig = G.memoSig(t, P, o(0.3));
  assert.equal(a.vals.find(v => v.id === 'pd1.p3').v, 0.3);
  const b = G.compileMods(t, P, o(0.9));
  assert.deepEqual([b === a, b.key, G.memoSig(t, P, o(0.9)), b.vals.find(v => v.id === 'pd1.p3').v], [true, key, sig, 0.9], 'a hit: the same payload, the value refreshed');
  P.pads[0].pads[12].mod = { m: 'tog', lo: 0.6, hi: 0.2 };
  const c = G.compileMods(t, P, o(undefined));
  assert.deepEqual([c === a, c.key, c.vals.map(v => v.v)], [true, key, [0.5, 0.1, 0.6, 0]], 'a mode / range edit: a hit, the rest values follow lo');
  t.mods = t.mods.filter(r => !/^(pd|c1)/.test(r.src)); delete t.dev.c1;
  assert.deepEqual([G.memoSig(t, P, REAL), ...payH(G.compileMods(t, P, REAL))], PIN_B_REAL[0], 'the pad rows (and the CC) gone: the fixture\'s pins again');
});
