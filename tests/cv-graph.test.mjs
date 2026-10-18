// cv-graph.js tests (SPEC-canvas §5.1, §5.5, §6.7, §10 stage 1a skeleton): v1 tracks and the canonical v2 shapes present
// today's v1 view (patchFor of it equals the track's own, every factory preset); validation codes; topological order.
// Stage 1e (IMPL-1e §3.1, §5): the graph form (tests/fixtures/graph-1e.mjs), compileGraph = today's patch for canonical
// tracks (instPatch + chainPatch), the new validation codes, the structure key.
// Run: node --max-old-space-size=2048 --test tests/cv-graph.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../cv-graph.js?v=9';
import { MODELS, patchFor } from '../models.js?v=9';
import * as C from '../serum-core.js?v=9';

const clone = x => JSON.parse(JSON.stringify(x));
const OPTS = { sr: 48000, bpm: 120 };
// every factory sound as a v1 track (classic: the default panel + preset over it, a reverb in the Main rack of every
// other one; Serum: the preset's own FX)
function v1Tracks() {
  const out = [];
  for (const m of MODELS) {
    if (m.custom) {
      for (const p of C.FACTORY_PRESETS) {
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
