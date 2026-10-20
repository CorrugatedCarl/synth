// jackrules — milestone 3 lane C (IMPL-3 §2.5, §7 "jackrules"): a Serum's internal cables (sx-edges.js) are views of its state.
// Every cable ↔ field mapping both ways; state → edges → state over the enumerated states; agreement with serum-core
// filterFeeds / toggleFilterRoute / the normaliser's F1-F2 loop rule and sx-ui-mix's routes (channelStrips); fork, stub,
// refusals; the S A B C N switches as cables only (never modulation destinations); partKeys (I1 / I2, shaped-but-unread slots
// excluded). Pure: no DOM.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../sx-edges.js?v=9';
import * as core from '../serum-core.js?v=9';
import { channelStrips } from '../sx-ui-mix.js?v=9';
import * as CV from '../cv-mods.js?v=9';
import * as CB from '../cv-cables.js?v=9';

const fresh = () => core.normalizeSerum(core.defaultSerum());
const clone = x => JSON.parse(JSON.stringify(x));
const SRC = [['oscA', 'A', 'a', s => s.osc[0], 'a'], ['oscB', 'B', 'b', s => s.osc[1], 'b'], ['oscC', 'C', 'c', s => s.osc[2], 'c'],
  ['sub', 'S', 's', s => s.sub, 'sub'], ['noise', 'N', 'n', s => s.noise, 'noise']];
const TARGETS = ['filter.in', 'filter2.in', 'voice.main', 'voice.direct'];
const topo = L => L.filter(e => e.kind !== 'fx').map(e => [e.a, e.b, e.kind, !!e.fork, !!e.stub].join('|')).sort();
const from = (L, part) => L.filter(e => e.kind === 'audio' && e.src === part);
const apply = (s, r) => { const t = clone(s); assert.ok(r.edit, 'an edit: ' + r.why); assert.equal(r.edit(t), true); return t; };
// every enumerated state of one source: route × balance × the two switches × power (the rest default)
function* srcStates() {
  for (const [part, ch, p, obj] of SRC) for (const route of [0, 1, 2, 3]) for (const fb of [0, 0.25, 0.5, 0.75, 1]) for (const s1 of [0, 1]) for (const s2 of [0, 1]) for (const on of [0, 1]) {
    const s = fresh();
    obj(s).route = route;
    s.p[p + '.fbal'] = fb; s.p['f.route' + ch] = s1; s.p['f2.route' + ch] = s2; s.p[p + '.on'] = on;
    yield { s, part, ch, p, obj, route, fb, on };
  }
}
// the neutral state: nothing cabled (every source and filter to None, the note tools off)
function neutral(s) {
  const t = clone(s);
  for (const [, , , obj] of SRC) obj(t).route = 3;
  t.filter[0].route = 3; t.filter[1].route = 3;
  t.p['arp.on'] = 0; t.p['clip.on'] = 0;
  return t;
}
function rebuild(s) { // state → edges → state: every editable edge made again from nothing, in order
  let t = neutral(s);
  for (const e of E.serumEdges(s)) {
    if (e.ro || e.stub) continue;
    const r = E.setEdge(t, null, e.a, e.b);
    if (r.edit) { r.edit(t); t = clone(t); }
  }
  return t;
}

test('sources: an edge ⇔ the field (filterFeeds for the filter switches, sx-ui-mix channelStrips for the route); stub ⇔ Filter lit nowhere; fork ⇔ both lit', () => {
  let n = 0, forks = 0, stubs = 0;
  for (const { s, part, ch, route, on, obj } of srcStates()) {
    n++;
    const L = from(E.serumEdges(s), part), f1 = core.filterFeeds(s, 0, ch), f2 = core.filterFeeds(s, 1, ch);
    const strip = channelStrips(s, null).find(x => x.key === SRC.find(q => q[0] === part)[4]);
    assert.equal(strip.route, route, 'the MIX page reads the same route');
    assert.equal(L.some(e => e.b === 'filter.in'), f1, part + ' → Filter 1 lit');
    assert.equal(L.some(e => e.b === 'filter2.in'), f2, part + ' → Filter 2 lit');
    assert.equal(L.some(e => e.stub), route === 0 && !f1 && !f2, 'the stub');
    assert.equal(L.some(e => e.fork), f1 && f2, 'the fork');
    assert.equal(L.some(e => e.b === 'voice.main'), strip.route === 1);
    assert.equal(L.some(e => e.b === 'voice.direct'), strip.route === 2);
    if (route === 3) assert.equal(L.length, 0, 'None: no cable');
    for (const e of L) assert.equal(!!e.dim, !on, 'dimmed while the source is off');
    for (const e of L.filter(x => x.b === 'voice.main' || x.b === 'voice.direct')) assert.equal(e.env, obj(s).env ? 1 : 0, 'AMP ENV at the VOICE end');
    if (f1 && f2) { forks++; const sh = L.map(e => e.share); assert.ok(Math.abs(sh[0] + sh[1] - 1) < 1e-9 && sh.every(x => x > 0)); }
    if (L.some(e => e.stub)) { stubs++; assert.equal(L.find(e => e.stub).label, E.STUB_LABEL); assert.equal(L.find(e => e.stub).b, null); }
  }
  assert.equal(n, 5 * 4 * 5 * 4 * 2);
  assert.ok(forks >= 30 && stubs >= 50, 'forks ' + forks + ', stubs ' + stubs);
});

test('setEdge: cable → fields (one output per source; a second filter cable forks at ½; already-connected is no edit); toggleFilterRoute agrees off-route; only the table\'s fields move', () => {
  let made = 0;
  for (const { s, part, ch, p, route } of srcStates()) {
    const before = E.serumEdges(s);
    for (const tg of TARGETS) {
      const r = E.setEdge(s, null, part + '.out', tg), had = from(before, part).some(e => e.b === tg);
      if (had) { assert.equal(r.edit, null); assert.equal(r.why, E.WHY.same); continue; }
      const t = apply(s, r);
      made++;
      const L = from(E.serumEdges(t), part);
      assert.ok(L.some(e => e.b === tg), part + ' → ' + tg + ' after setEdge');
      const fk = tg === 'filter.in' ? 0 : tg === 'filter2.in' ? 1 : -1;
      const fed = [0, 1].filter(k => core.filterFeeds(s, k, ch));
      if (fk >= 0 && route === 0 && fed.length === 1) { // (a second filter cable: the fork)
        assert.equal(L.length, 2); assert.ok(L.every(e => e.fork)); assert.equal(t.p[p + '.fbal'], 0.5);
      } else assert.equal(L.length, 1, 'one output per source: the old cable is replaced');
      // the paths are the table's: route, the balance, the switches; the before-values are the state's
      for (const [path, b4, after] of r.f) {
        const id = path.join('.');
        assert.ok(/^(osc\.\d|sub|noise)\.route$/.test(id) || id === 'p.' + p + '.fbal' || id === 'p.f.route' + ch || id === 'p.f2.route' + ch, id);
        assert.notEqual(b4, after);
      }
      if (fk >= 0 && route !== 0) { // toggleFilterRoute's off-route branch is the same edit
        const u = clone(s);
        assert.equal(core.toggleFilterRoute(u, fk, ch), true);
        assert.deepEqual(t, u, 'setEdge = toggleFilterRoute off-route');
      }
      // the other sources' cables never move
      assert.deepEqual(topo(E.serumEdges(t).filter(e => e.src !== part)), topo(before.filter(e => e.src !== part)));
    }
  }
  assert.ok(made > 2000, 'edits ' + made);
});

test('toggleFilterRoute anywhere: the cables follow the switches (filterFeeds) — a switch tap in the panel is a cable on the canvas', () => {
  for (const { s, part, ch } of srcStates()) {
    for (const k of [0, 1]) {
      const t = clone(s);
      const lit = core.toggleFilterRoute(t, k, ch);
      const L = from(E.serumEdges(t), part);
      assert.equal(L.some(e => e.b === (k ? 'filter2.in' : 'filter.in')), lit);
      assert.equal(L.some(e => e.b === (k ? 'filter.in' : 'filter2.in')), core.filterFeeds(t, 1 - k, ch));
    }
  }
});

test('cutEdge: Disconnect → route None; a fork\'s branch → the balance all to the other filter; a stub → None; a missing cable is no edit', () => {
  for (const { s, part, ch, p } of srcStates()) {
    const L = from(E.serumEdges(s), part);
    for (const e of L) {
      const r = E.cutEdge(s, null, e.a, e.b), t = apply(s, r), M = from(E.serumEdges(t), part);
      assert.ok(!M.some(x => x.b === e.b && !!x.stub === !!e.stub), 'cut ' + e.id);
      if (e.fork) {
        const k = e.b === 'filter.in' ? 0 : 1;
        assert.equal(t.p[p + '.fbal'], 1 - k);
        assert.equal(M.length, 1); assert.equal(M[0].b, k ? 'filter.in' : 'filter2.in'); assert.ok(!M[0].fork);
        assert.ok(core.filterFeeds(t, 1 - k, ch));
      } else { assert.equal(M.length, 0); assert.equal(SRC.find(q => q[0] === part)[3](t).route, 3); }
    }
    for (const tg of TARGETS) if (!L.some(e => e.b === tg)) assert.equal(E.cutEdge(s, null, part + '.out', tg).why, E.WHY.none);
  }
});

test('state → edges → state: every enumerated state rebuilt from nothing by setEdge has the same cables (stubs aside: no cable makes one)', () => {
  let n = 0;
  for (const { s } of srcStates()) {
    const t = rebuild(s), A = topo(E.serumEdges(s)).filter(x => !x.endsWith('|true')), B = topo(E.serumEdges(t));
    assert.deepEqual(B, A);
    n++;
  }
  // filters and note tools too
  for (const r0 of [0, 1, 2, 3]) for (const r1 of [0, 1, 2, 3]) for (const arp of [0, 1]) for (const clip of [0, 1]) {
    const s = fresh();
    s.filter[0].route = r0; s.filter[1].route = r1; s.p['arp.on'] = arp; s.p['clip.on'] = clip;
    const S = core.normalizeSerum(s);
    assert.deepEqual(topo(E.serumEdges(rebuild(S))), topo(E.serumEdges(S)).filter(x => !x.endsWith('|true')));
    n++;
  }
  assert.equal(n, 800 + 64);
});

test('filters: route ⇔ the cable (sx-ui-mix channelStrips); the F1-F2 loop rule (the normaliser\'s): raw both-to-the-other draws F1 → F2 and F2 → Main; setEdge never leaves a loop', () => {
  for (const r0 of [0, 1, 2, 3]) for (const r1 of [0, 1, 2, 3]) for (const on of [0, 1]) {
    const s = fresh();
    s.filter[0].route = r0; s.filter[1].route = r1; s.p['f.on'] = on;
    const L = E.serumEdges(s).filter(e => e.src === 'filter' || e.src === 'filter2'), N = core.normalizeSerum(clone(s));
    const eff = [r0, r0 === 0 && r1 === 0 ? 1 : r1];
    ['filter', 'filter2'].forEach((part, k) => {
      const want = eff[k] === 0 ? (k ? 'filter.in' : 'filter2.in') : eff[k] === 1 ? 'voice.main' : eff[k] === 2 ? 'voice.direct' : null;
      const M = L.filter(e => e.src === part);
      assert.deepEqual(M.map(e => e.b), want ? [want] : [], part + ' ' + r0 + '/' + r1);
      assert.equal(N.filter[k].route, eff[k], 'the normaliser agrees');
      assert.equal(channelStrips(N, null).find(x => x.key === (k ? 'f2' : 'f1')).route, eff[k]);
      if (!k) for (const e of M) assert.equal(!!e.dim, !on);
    });
    assert.deepEqual(topo(E.serumEdges(N)), topo(E.serumEdges(s)), 'raw and normalised draw the same');
    for (const [a, b] of [['filter.out', 'filter2.in'], ['filter2.out', 'filter.in'], ['filter.out', 'voice.main'], ['filter2.out', 'voice.direct']]) {
      const r = E.setEdge(N, null, a, b);
      if (!r.edit) { assert.equal(r.why, E.WHY.same); continue; }
      const t = apply(N, r);
      assert.ok(!(t.filter[0].route === 0 && t.filter[1].route === 0), 'no F1 ↔ F2 loop');
      assert.deepEqual(core.normalizeSerum(clone(t)).filter.map(f => f.route), t.filter.map(f => f.route), 'the loop rule never fires on an edge edit');
      assert.ok(E.serumEdges(t).some(e => e.a === a && e.b === b));
      if (a === 'filter.out' && b === 'filter2.in' && N.filter[1].route === 0) assert.equal(t.filter[1].route, 1, 'the most recent wins: the other goes to Main');
    }
    for (const e of L) { const t = apply(N, E.cutEdge(N, null, e.a, e.b)); assert.equal(t.filter[e.src === 'filter' ? 0 : 1].route, 3); }
  }
});

test('ARP / CLIP → VOICE note: the cable is the power field (arp.on / clip.on), both ways', () => {
  for (const part of ['arp', 'clip']) {
    const s = fresh();
    assert.ok(!E.serumEdges(s).some(e => e.src === part));
    const r = E.setEdge(s, null, part + '.out', 'voice.note');
    assert.deepEqual(r.f, [[['p', part + '.on'], 0, 1]]);
    const t = apply(s, r);
    assert.deepEqual(E.serumEdges(t).filter(e => e.src === part).map(e => [e.b, e.kind]), [['voice.note', 'note']]);
    assert.equal(E.setEdge(t, null, part + '.out', 'voice.note').why, E.WHY.same);
    const u = apply(t, E.cutEdge(t, null, part + '.out', 'voice.note'));
    assert.equal(u.p[part + '.on'], 0);
    assert.equal(E.setEdge(s, null, part + '.out', 'filter.in').why, E.WHY.notes);
  }
});

test('read-only cables: VOICE → own FX (the route label, as cv-cables drew it), the warp / FM / RM / pitch sources (dotted, warp menu); refused for editing', () => {
  const s = fresh(), fxE = E.serumEdges(s, null).find(e => e.kind === 'fx');
  assert.deepEqual([fxE.a, fxE.b, fxE.ro], ['voice.out', 'fx.in', true]);
  assert.equal(CB.routeLabel, E.routeLabel, 'one route label (cv-cables re-exports it)');
  s.osc[1].route = 2; s.p['b.on'] = 1;
  assert.equal(E.serumEdges(s, null).find(e => e.kind === 'fx').label, 'Direct');
  const w = id => core.WARPS2.findIndex(x => x.id === id) / 81;
  const t = fresh();
  t.global.s1 = 0;
  t.p['b.w1'] = w('fm_o1'); t.p['a.w2'] = w('rm_o2'); t.p['c.w1'] = w('am_noise'); t.p['a.w1'] = w('sync');
  t.osc[2].pitch = { mode: 'ratio', src: 'B' };
  const W = E.serumEdges(t, null).filter(e => e.kind === 'warp').map(e => [e.a, e.b, e.field, e.ro]);
  assert.deepEqual(W, [['oscC.out', 'oscA.warp', 'a.w2', true], ['oscA.out', 'oscB.warp', 'b.w1', true], ['noise.out', 'oscC.warp', 'c.w1', true], ['oscB.out', 'oscC.warp', 'pitch', true]]);
  for (const e of E.serumEdges(t, null).filter(x => x.ro)) { assert.equal(E.setEdge(t, null, e.a, e.b).edit, null); assert.equal(E.cutEdge(t, null, e.a, e.b).edit, null); }
  assert.equal(E.setEdge(t, null, 'oscA.out', 'oscB.warp').why, E.WHY.ro);
  assert.equal(E.setEdge(t, null, 'voice.out', 'fx.in').why, E.WHY.fx);
  // a spectral warp counts only on a spectral oscillator; S1 mode reads slot 1 of A / B from the v1 field
  const u = fresh();
  u.global.s1 = 0; u.p['a.w1'] = w('s_voc_o1');
  assert.equal(E.serumEdges(u).filter(e => e.kind === 'warp').length, 0);
  u.osc[0].type = 'spec';
  assert.deepEqual(E.serumEdges(u).filter(e => e.kind === 'warp').map(e => e.a), ['oscB.out']);
  const v = fresh();
  v.global.s1 = 1; v.p['a.warpMode'] = 19 / 22;
  assert.deepEqual(E.serumEdges(v).filter(e => e.kind === 'warp').map(e => [e.a, e.b, e.field]), [['oscB.out', 'oscA.warp', 'a.warpMode']]);
});

test('refusals: sources play through their VOICE; a filter never feeds itself; notes only from ARP / CLIP; inputs are not outputs', () => {
  const s = fresh();
  const R = (a, b) => E.setEdge(s, null, a, b).why;
  assert.equal(R('oscA.out', 'fx.in'), E.WHY.voice);
  assert.equal(R('oscB.out', 'fx1.in'), E.WHY.voice, 'a panel / OUT (not a Serum end)');
  assert.equal(R('noise.out', 'out.in'), E.WHY.voice);
  assert.equal(R('filter.out', 'fx.in'), E.WHY.voice);
  assert.equal(R('filter.out', 'filter.in'), E.WHY.self);
  assert.equal(R('oscA.out', 'voice.note'), E.WHY.note);
  assert.equal(R('arp.out', 'voice.main'), E.WHY.notes);
  assert.equal(R('filter.in', 'voice.main'), E.WHY.dir);
  assert.equal(R('oscA.out', 'oscB.out'), E.WHY.dir);
  assert.equal(R('oscA.out', 'voice.env1'), E.WHY.dir);
  assert.equal(R('lfo3.out', 'filter.in'), E.WHY.bad);
  assert.equal(E.setEdge(null, null, 'oscA.out', 'filter.in').why, E.WHY.bad);
});

test('the S A B C N switches are cables only: never modulation destinations (cv-mods destOk), only setEdge writes them, no edge is a modulation', () => {
  const ids = core.DESTS.map(d => d.id).filter(CV.plainSwitch).sort();
  assert.deepEqual(ids, [...E.SWITCHES].sort());
  assert.equal(ids.length, 10);
  const dev = { kind: 'synth', model: 'serum', vals: { s: fresh() } };
  for (const id of E.SWITCHES) {
    assert.equal(CV.destOk(dev, id).ok, false, id + ' refused as a modulation target');
    assert.equal(CV.destOk(dev, id, true).ok, true, 'an existing row still compiles');
  }
  for (const { s, part } of srcStates()) for (const e of E.serumEdges(s)) assert.ok(['audio', 'note', 'fx', 'warp'].includes(e.kind), e.kind);
  // a switch moves only through a cable edit or the panel's own switch (toggleFilterRoute): the setEdge writes name it
  const s = fresh();
  s.osc[1].route = 1;
  const r = E.setEdge(s, null, 'oscB.out', 'filter2.in');
  assert.deepEqual(r.f.map(x => x[0].join('.')), ['osc.1.route', 'p.b.fbal', 'p.f2.routeB'].filter(x => r.f.some(y => y[0].join('.') === x)));
  assert.ok(r.f.some(x => x[0].join('.') === 'p.f2.routeB') || s.p['f2.routeB'] === 1);
});

test('partKeys: I1 (a power field on), I2 (a slot read by a row — src or aux, LFO Y — or a link row), MACROS with a macro row, a laid-out part stays; shaped-but-unread slots get none', () => {
  const s = fresh();
  s.p['a.on'] = 1; s.p['b.on'] = 0; s.p['c.on'] = 0; s.p['s.on'] = 0; s.p['n.on'] = 0; s.p['f.on'] = 1; s.p['f2.on'] = 0; s.p['arp.on'] = 0; s.p['clip.on'] = 0;
  for (const r of s.matrix) Object.assign(r, { src: '', aux: '', dst: '' });
  assert.deepEqual(E.partKeys(s, {}, 'i1'), ['oscA', 'filter']);
  s.p['b.on'] = 1; s.p['arp.on'] = 1;
  s.matrix[0] = Object.assign(s.matrix[0], { src: 'lfo3', dst: 'a.wt', amt: 0.5 });
  s.matrix[1] = Object.assign(s.matrix[1], { src: 'velo', aux: 'env2', dst: 'a.level', amt: 0.5 });
  s.matrix[2] = Object.assign(s.matrix[2], { src: 'lfo4y', dst: 'b.wt', amt: 0.5, byp: 1 });
  s.matrix[3] = Object.assign(s.matrix[3], { src: 'macro2', dst: 'f.cutoff', amt: 0.5 });
  s.matrix[4] = Object.assign(s.matrix[4], { src: 'env1', dst: 'f.res', amt: 0.5 });
  s.lfo[5].pts = [[0, 1, 0], [0.5, 0, 0], [1, 1, 0]]; // (LFO 6 shaped, read by nothing)
  const lay = { 'i1/lfo9': { x: 0, y: 0 }, 'i1/oscC': { x: 10, y: 0 }, 'i2/lfo8': { x: 0, y: 0 }, i1: { x: 0, y: 0, ui: 'parts' } };
  const K = E.partKeys(s, lay, 'i1', ['i1/lfo7.out', 'env4']);
  assert.deepEqual(K, ['oscA', 'oscB', 'oscC', 'filter', 'env2', 'env4', 'lfo3', 'lfo4', 'lfo7', 'lfo9', 'macros', 'arp']);
  assert.ok(!K.includes('lfo6'), 'shaped but unread: no module');
  assert.ok(!K.includes('lfo8'), 'another Serum\'s lay entry');
  assert.deepEqual([...E.slotsUsed(s)].sort(), ['env2', 'lfo3', 'lfo4', 'macros']);
  // order and keys are the PARTS list
  assert.deepEqual(E.PARTS.filter(p => K.includes(p)), K);
});

test('firstFree: the lowest free slot of a kind (power off for sources / filters, not in use for ENV / LFO), skip respected, null when full', () => {
  const s = fresh();
  s.p['a.on'] = 1; s.p['b.on'] = 0; s.p['c.on'] = 0; s.p['f.on'] = 1; s.p['f2.on'] = 0; s.p['s.on'] = 1;
  for (const r of s.matrix) Object.assign(r, { src: '', aux: '', dst: '' });
  s.matrix[0] = Object.assign(s.matrix[0], { src: 'env2', dst: 'a.wt', amt: 0.3 });
  assert.equal(E.firstFree(s, 'osc'), 'oscB');
  assert.equal(E.firstFree(s, 'oscC'), 'oscB', 'a part names its kind');
  assert.equal(E.firstFree(s, 'osc', ['oscB']), 'oscC');
  s.p['b.on'] = 1; s.p['c.on'] = 1;
  assert.equal(E.firstFree(s, 'osc'), null, 'three oscillators');
  assert.equal(E.firstFree(s, 'sub'), null);
  assert.equal(E.firstFree(s, 'filter'), 'filter2');
  assert.equal(E.firstFree(s, 'env'), 'env3');
  assert.equal(E.firstFree(s, 'lfo', ['lfo1']), 'lfo2');
  assert.equal(E.firstFree(s, 'macros'), 'macros');
  assert.equal(E.firstFree(s, 'macros', ['macros']), null);
  assert.equal(E.firstFree(s, 'nope'), null);
  assert.deepEqual(['oscB', 'filter2', 'lfo7', 'env3', 'macros', 'arp', 'x'].map(E.kindOf), ['osc', 'filter', 'lfo', 'env', 'macros', 'arp', null]);
});

test('ends ↔ canvas jacks; part keys; labels and power fields', () => {
  const J = [['voice.main', 'i2.main'], ['voice.note', 'i2.note'], ['voice.out', 'i2.out'], ['voice.env1', 'i2.env1'], ['fx.in', 'i2/fx.in'],
    ['oscB.out', 'i2/oscB.out'], ['filter2.in', 'i2/filter2.in'], ['oscA.warp', 'i2/oscA.warp'], ['arp.out', 'i2/arp.out']];
  for (const [e, j] of J) { assert.equal(E.jackOf('i2', e), j); assert.equal(E.endOf('i2', j), e); }
  assert.equal(E.jackOf('i2', 'lfo3.out'), null);
  assert.equal(E.endOf('i2', 'i1/oscA.out'), null);
  assert.equal(E.endOf('i2', 'i2/fx.out'), null);
  assert.deepEqual(E.splitKey('i2/oscB'), { dev: 'i2', part: 'oscB' });
  assert.deepEqual(E.splitKey('i10/lfo10'), { dev: 'i10', part: 'lfo10' });
  assert.equal(E.splitKey('i2/fx'), null);
  assert.equal(E.splitKey('i2'), null);
  assert.deepEqual(['oscB', 'filter2', 'lfo10', 'env3', 'macros', 'voice'].map(E.partLabel), ['OSC B', 'FILTER 2', 'LFO 10', 'ENV 3', 'MACROS', 'VOICE']);
  assert.deepEqual(['oscC', 'noise', 'filter', 'arp', 'lfo2'].map(E.powerOf), ['c.on', 'n.on', 'f.on', 'arp.on', null]);
  for (const id of Object.values(E.POWER)) assert.ok(core.DEST_INDEX[id] !== undefined, id + ' is a destination (the bar ⏻ is a cable end)');
});
