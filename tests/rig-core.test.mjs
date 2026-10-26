import './v8-guard.mjs';
// Stage WC lane K (docs/canvas/IMPL-WC.md §2.3, §3.4, §4.2, §11.1; gate G4 "edges ↔ state (W3)" + G13's wording table): rig-core's
// rules over sx-edges' ends — edges() ≡ serumEdges over jackrules' enumerated states but the one documented difference (a source into
// a Filter whose input switch is off is a "dry" cord, not a stub) and the amp-slot cord; the 86 factory presets (the 19 dry and the 30
// into-an-off-filter cases, I1'); plug / pull / repatch ≡ setEdge / cutEdge field for field; the ENV slot moves (envToAmp / envFromAmp:
// the round trip within 1 ulp of e<k>.sus, rows re-sourced and re-targeted both ways, flags, lay keys, the ordinal, `held` / `shown`,
// the refusals); can pure; 1 000 random edit sequences never leave normalizeSerum(s) ≠ s and every `f` undoes exactly; partKeys;
// names; pruneRig; lines mode (cv-cables' internal records ≡ edges()); WORDS without a Serum word; sx-edges' additions.
// Run alone: node --max-old-space-size=2048 --test tests/rig-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../rig-core.js?v=9';
import * as E from '../sx-edges.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as CB from '../cv-cables.js?v=9';
import { PALETTE } from '../cv-cords.js?v=9';

const J = x => JSON.stringify(x), clone = x => JSON.parse(J(x));
const fresh = () => C.normalizeSerum(C.defaultSerum());
const SRC = [['oscA', 'A', 'a', s => s.osc[0]], ['oscB', 'B', 'b', s => s.osc[1]], ['oscC', 'C', 'c', s => s.osc[2]], ['sub', 'S', 's', s => s.sub], ['noise', 'N', 'n', s => s.noise]];
const TARGETS = ['filter.in', 'filter2.in', 'voice.main', 'voice.direct'];
const presets = () => C.FACTORY_PRESETS.map(p => ({ name: p.name, s: C.normalizeSerum(clone(p.v.s)) }));
const topo = L => L.map(e => [e.a, e.b, e.kind, !!e.fork].join('|')).sort();
const eid = r => r.id.replace(/^x:[a-z0-9]+:/, '');
const norm = s => assert.deepEqual(C.normalizeSerum(clone(s)), s, 'normalised');
// jackrules' enumerated states of one source: route × balance × the two switches × power (the rest default)
function* srcStates() {
  for (const [part, ch, p, obj] of SRC) for (const route of [0, 1, 2, 3]) for (const fb of [0, 0.25, 0.5, 0.75, 1]) for (const s1 of [0, 1]) for (const s2 of [0, 1]) for (const on of [0, 1]) {
    const s = fresh();
    obj(s).route = route; s.p[p + '.fbal'] = fb; s.p['f.route' + ch] = s1; s.p['f2.route' + ch] = s2; s.p[p + '.on'] = on;
    yield { s, part, ch, p, obj, route, fb, s1, s2, on };
  }
}
// an ENV 3 worth moving: shaped, flagged, read by two rows (src and aux), its decay modulated by a macro, a MIDI map and locks on it;
// ENV 2 in use so slot 3 is the first free on the way back
function envState() {
  const s = R.rigInit();
  s.p['e3.att'] = 0.3; s.p['e3.sus'] = 0.49; s.p['e3.rel'] = 0.4; s.p['e3.cd'] = 0.2; s.env[2] = { bpm: 1, legInv: 1, stealRe: 1 };
  Object.assign(s.matrix[0], { src: 'env3', dst: 'a.wt', amt: 0.5 });
  Object.assign(s.matrix[1], { src: 'macro1', dst: 'e3.dec', amt: 0.3 });
  Object.assign(s.matrix[2], { src: 'env2', dst: 'f.cutoff', amt: 0.2 });
  Object.assign(s.matrix[3], { src: 'velo', aux: 'env3', dst: 'a.level', amt: 0.2 });
  Object.assign(s.matrix[4], { src: 'lfo1', dst: 'e3.att', amt: 0.1 });
  s.midi['74'] = 'e3.dec'; s.midi['75'] = 'a.level'; s.locks.p = ['e3.att', 'a.level']; s.locks.unp = ['e3.rel']; s.locks.mod = ['oscA', 'env3'];
  const S = C.normalizeSerum(s);
  assert.deepEqual(S, s, 'the fixture is normalised');
  return S;
}
const rnd = (() => { let seed = 12345; return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; })();
const pick = a => a[Math.floor(rnd() * a.length)];

test('WORDS (G13): every rig-facing text through RIG.NAME — no "Serum", "VOICE" or "Xfer" in any string or function output; every sx-edges WHY key has a rig wording; the texts of §3.4 / §4.2 verbatim', () => {
  const W = R.WORDS, vals = [];
  for (const [k, v] of Object.entries(W)) {
    if (typeof v === 'function') { vals.push([k, v('Envelope 2', 3)], [k, v(2, 'START and END')], [k, v('osc')], [k, v('env')], [k, v('lfo')], [k, v('sub')], [k, v('noise')], [k, v('macros')], [k, v('arp')], [k, v('clip')], [k, v('filter')], [k, v('Juno-60', 'Oscillator')], [k, v(64, 64)]); continue; }
    assert.equal(typeof v, 'string', k);
    vals.push([k, v]);
  }
  for (const [k, v] of vals) assert.ok(!/serum|voice|xfer/i.test(v), k + ': ' + v);
  for (const k of Object.keys(E.WHY)) assert.equal(typeof W[k], 'string', 'WHY.' + k + ' re-worded');
  assert.ok(Object.isFrozen(W));
  assert.deepEqual([W.lfoLevel, W.ampHeld(1), W.envFull, W.envHeld, W.twoFilters, W.input, W.dir, W.voice, W.filter], ['An Envelope shapes the level — an LFO goes on a knob', 'Envelope 1 already shapes the level — pull it first',
    'Envelopes 2–4 are all in use — remove one first', 'Envelopes 2–4 are all in use — held by canvas modulators', 'Two filters at most', 'That is an input', 'Two outputs — connect an output to an input', 'An oscillator feeds a Filter or the Amplifier', 'A Filter feeds the other Filter or the Amplifier']);
  assert.deepEqual([W.other, W.ownMacro, W.bad, W.heavy], [`A ${R.RIG.NAME} plugs into its own modules`, `A ${R.RIG.NAME}’s macros modulate that ${R.RIG.NAME} · use a Macro module`, `Not a cord of this ${R.RIG.NAME}`, `This many ${R.RIG.NAME} modules may stutter when zooming on this device.`]);
  assert.deepEqual([W.full('osc'), W.full('filter'), W.full('env'), W.full('lfo'), W.unplugged(2), W.takesOver(3)], [`This ${R.RIG.NAME} already has 3 oscillators`, `This ${R.RIG.NAME} already has 2 filters`, `This ${R.RIG.NAME}’s Envelopes 2–4 are all in use`, `This ${R.RIG.NAME}’s 10 LFOs are all in use`, 'Envelope 2 unplugged · the keys gate the level again', 'Envelope 3 shapes the level']);
  assert.equal(W.ampHeld(2), 'Envelope 2 already shapes the level — pull it first', '(pre-deploy [amp-held]) the amp slot\'s module by its fixed name, as takesOver / unplugged');
  assert.ok(W.gateTip.includes(R.RIG.GATE_MS + ' ms'));
});

test('LOOK / cordColor (§4.5; review 2 P3-6 moved Noise from Black 7 to Cream 4): Oscillator 1 Blue 2 · 2 Green 3 · 3 Yellow 1 · Sub Violet 6 · Noise Cream 4 · Filter 1 Orange 5 · Filter 2 Red 0 · note cords Violet · the amp-slot cord and Envelope rows Yellow · LFO rows Orange · Macro rows Blue · warp Orange; a user\'s pick (dev.rig.cc by the source end) wins; alphas 1 / 0.85 / 0.45 / 0.3', () => {
  assert.deepEqual(['oscA.out', 'oscB.out', 'oscC.out', 'sub.out', 'noise.out', 'filter.out', 'filter2.out', 'arp.out', 'clip.out', 'env1.out', 'env3.out', 'lfo3.out#2', 'macros.k2'].map(a => R.cordColor(a, null)), [2, 3, 1, 6, 4, 5, 0, 6, 6, 1, 1, 5, 2]);
  assert.equal(R.cordColor('oscA.out', null, 'warp'), 5, 'a warp cord is Orange whatever its source');
  assert.deepEqual([R.cordColor('oscA.out', { cc: { 'oscA.out': 7 } }), R.cordColor('oscA.out', { cc: { 'oscA.out': 8 } }), R.cordColor('oscA.out', { cc: { 'oscA.out': 2.5 } }), R.cordColor('oscB.out', { cc: { 'oscA.out': 7 } })], [7, 2, 2, 3]);
  assert.deepEqual(R.LOOK.o, { on: 1, row: 0.85, off: 0.45, fade: 0.3 });
  assert.equal(PALETTE.length, 8, 'eight palette entries (cv-cords)');
  for (const c of Object.values(R.LOOK.c)) assert.ok(Number.isInteger(c) && c >= 0 && c < PALETTE.length);
});

test('G4 edges ≡ serumEdges over the enumerated states (ids, ends, kinds) except the documented difference: a source into a Filter with its switch off is a dry cord (sx-edges: no cord, or a stub); the fx edge dropped; the amp-slot cord iff !isGate ∨ read; records shaped for cv-cables (x:<dev>:<edge id>, jack keys, c / o / s)', () => {
  let n = 0, dry = 0, stubs = 0;
  for (const { s, part, route, fb, s1, s2, on, p } of srcStates()) {
    n++;
    const L = R.edges(s, null, 'i1'), X = E.serumEdges(s, null);
    const bal = C.lawValue(p + '.fbal', fb), share = k => (k ? (1 + bal) / 2 : (1 - bal) / 2); // (the balance law: n 0 = all to Filter 1)
    assert.ok(!L.some(e => e.kind === 'fx' || e.int === 'fx'), 'no fx record');
    // (a default Serum's ENV 1 is an envelope (0.5 ms / 14.7 ms), so the amp cord is there: compare without it; the fork flag apart —
    // the rig forks on two shares, sx-edges on two lit switches — a wet + dry pair is a fork with a BAL badge)
    const rig = L.filter(e => e.kind !== 'mod' && !e.dry).map(e => ({ a: e.edge.a, b: e.edge.b, kind: e.kind }));
    const sx = X.filter(e => e.kind !== 'fx' && !e.stub).map(e => ({ a: e.a, b: e.b, kind: e.kind }));
    assert.equal(L.some(e => e.fork && e.edge.a === part + '.out'), route === 0 && share(0) > 0 && share(1) > 0, 'the rig forks on two shares');
    assert.equal(X.some(e => e.fork && e.a === part + '.out'), route === 0 && share(0) > 0 && share(1) > 0 && !!s1 && !!s2, 'sx-edges on two lit switches');
    assert.deepEqual(topo(rig), topo(sx), part + ' route ' + route + ' fb ' + fb + ' sw ' + s1 + s2 + ' on ' + on);
    // the dry cords: exactly (route 0, a share above 0, the switch off) — a stub in sx-edges ⇔ no wet cord but a dry one
    const D = L.filter(e => e.dry && e.edge.a === part + '.out');
    const want = route !== 0 ? [] : [[0, s1], [1, s2]].filter(([k, sw]) => share(k) > 0 && !sw).map(([k]) => (k ? 'filter2.in' : 'filter.in'));
    assert.deepEqual(D.map(e => e.edge.b).sort(), want.sort(), 'dry: ' + part + ' route ' + route + ' fb ' + fb + ' sw ' + s1 + s2);
    dry += D.length;
    if (X.some(e => e.stub && e.a === part + '.out')) { stubs++; assert.ok(D.length > 0 && !L.some(e => !e.dry && e.edge.a === part + '.out' && /^filter2?\.in$/.test(e.edge.b)), 'a stub is a dry cord here'); }
    for (const e of D) { assert.equal(e.tag, R.WORDS.dry); assert.equal(e.kind, 'audio'); assert.equal(e.share, share(e.edge.b === 'filter.in' ? 0 : 1)); }
    // the shape
    for (const e of L) {
      assert.equal(e.id, 'x:i1:' + e.edge.a + '>' + (e.edge.b || '') + (e.field ? '#' + e.field : ''));
      assert.equal(e.dev, 'i1'); assert.deepEqual(e.src, ['i1']);
      assert.equal(e.a, E.jackOf('i1', e.edge.a)); if (e.edge.b) assert.equal(e.b, E.jackOf('i1', e.edge.b));
      assert.equal(e.int, e.kind === 'mod' ? 'level' : e.kind);
      assert.ok(Number.isInteger(e.c) && e.c >= 0 && e.c <= 7); assert.equal(e.s, 0);
      assert.equal(e.o, e.dim || e.kind === 'warp' ? 0.45 : 1);
      if (e.edge.a === part + '.out') assert.equal(!!e.dim, !on, 'dimmed while the source is off');
      if (e.fork) { assert.equal(e.badge, 'BAL'); assert.ok(e.share > 0 && e.share < 1); }
    }
    assert.ok(L.filter(e => e.fork && e.edge.a === part + '.out').length !== 1, 'a fork has two cords');
  }
  assert.equal(n, 800);
  assert.ok(dry > 100 && stubs >= 50, 'dry ' + dry + ' stubs ' + stubs);
  // the filters and the note tools: sx-edges' (the loop rule included), the fx edge gone
  for (const r0 of [0, 1, 2, 3]) for (const r1 of [0, 1, 2, 3]) for (const arp of [0, 1]) for (const clip of [0, 1]) {
    const s = fresh();
    s.filter[0].route = r0; s.filter[1].route = r1; s.p['arp.on'] = arp; s.p['clip.on'] = clip;
    const L = R.edges(s, null, 'i1').filter(e => e.kind !== 'mod'), X = E.serumEdges(s, null).filter(e => e.kind !== 'fx' && !e.stub);
    assert.deepEqual(topo(L.map(e => ({ a: e.edge.a, b: e.edge.b, kind: e.kind, fork: e.fork }))), topo(X.map(e => ({ a: e.a, b: e.b, kind: e.kind, fork: e.fork }))));
    assert.equal(L.filter(e => e.kind === 'note').length, arp + clip);
  }
  // the warp cords: read-only, Orange at 0.45, a tap opens the menu (cv-cables' tap: 'open'), the field in the id
  const w = id => C.WARPS2.findIndex(x => x.id === id) / 81, t = fresh();
  t.global.s1 = 0; t.p['b.w1'] = w('fm_o1'); t.osc[2].pitch = { mode: 'ratio', src: 'B' };
  const W = R.edges(t, null, 'i1').filter(e => e.kind === 'warp');
  assert.deepEqual(W.map(e => [e.id, e.ro, e.c, e.o, e.tap, e.field]), [['x:i1:oscA.out>oscB.warp#b.w1', true, 5, 0.45, 'open', 'b.w1'], ['x:i1:oscB.out>oscC.warp#pitch', true, 5, 0.45, 'open', 'pitch']]);
  // the amp-slot cord: iff !isGate ∨ something reads ENV 1 (a matrix row, a link row in `used`)
  const g = R.rigInit(), amp = L => L.filter(e => e.kind === 'mod');
  assert.deepEqual(amp(R.edges(g, null, 'i1')), []);
  assert.deepEqual(amp(R.edges(g, null, 'i1', null, ['i1/lfo2.out'])), []);
  const A = amp(R.edges(g, null, 'i1', null, ['i1/env1.out']));
  assert.deepEqual(A.map(e => [e.id, e.a, e.b, e.int, e.c, e.o, e.s, !!e.ro]), [['x:i1:env1.out>voice.level', 'i1/env1.out', 'i1.level', 'level', 1, 1, 0, false]], 'a link row reads it: Envelope 1 stands plugged into LEVEL');
  const h = clone(g); Object.assign(h.matrix[5], { src: 'velo', aux: 'env1', dst: 'a.level', amt: 0.3 });
  assert.equal(amp(R.edges(h, null, 'i1')).length, 1, 'an aux reads it');
  assert.equal(amp(R.edges(R.rigStarter().s, null, 'i1')).length, 1, 'the starter: Envelope 1 on LEVEL');
  assert.equal(amp(R.edges(R.rigStarter().s, null, 'i1', { cc: { 'env1.out': 6 } }))[0].c, 6, 'its colour from the pick');
  assert.deepEqual(R.edges(null, null, 'i1'), []);
  // no dev: the ends themselves as a / b, bare edge ids
  const bare = R.edges(g, null);
  assert.deepEqual(bare.filter(e => e.edge.a === 'oscA.out').map(e => [e.id, e.a, e.b, e.dev, e.src]), [['oscA.out>voice.main', 'oscA.out', 'voice.main', null, []]]);
});

test('G4 the 86 factory presets: 19 with a powered source into a Filter whose input switch is off (dry cords), 30 with a powered source routed into an off Filter (I1\': the Filter module exists ⏻ off); every cord of a powered source lands on a module that exists; adopt unplugs nothing', () => {
  let dryN = 0, offN = 0;
  for (const { name, s } of presets()) {
    const L = R.edges(s, null, 'i1'), K = R.partKeys(s, {}, 'i1');
    const live = L.filter(e => e.kind === 'audio' && !e.dim && /^(osc[ABC]|sub|noise)\.out$/.test(e.edge.a));
    if (live.some(e => e.dry)) dryN++;
    if (live.some(e => e.off)) offN++;
    for (const e of live) {
      const tgt = e.edge.b.split('.')[0];
      assert.ok(tgt === 'voice' || K.includes(tgt), name + ': ' + e.id + ' lands on a module (I1\')');
      if (e.off) assert.ok(!E.partOn(s, e.off) && K.includes(e.off), name + ': the off Filter stands ⏻ off');
      if (e.dry) assert.equal(s.p[(e.edge.b === 'filter2.in' ? 'f2.route' : 'f.route') + { oscA: 'A', oscB: 'B', oscC: 'C', sub: 'S', noise: 'N' }[e.edge.a.split('.')[0]]] >= 0.5, false);
    }
    const a = R.adopt(s);
    assert.deepEqual(R.edges(a.s, null, 'i1').map(e => e.id), L.map(e => e.id), name + ': adopt moves no cord');
    assert.equal(L.filter(e => e.kind === 'mod').length, 1, name + ': a preset\'s ENV 1 is an Envelope on LEVEL');
    assert.equal(R.isGate(s), false);
  }
  assert.deepEqual([dryN, offN], [19, 30], 'the skeptic\'s counts');
  // the default Serum: OSC A into Filter 1 which is off → a Filter 1 module ⏻ off (G6's "Make it a <NAME> on a default Serum")
  const d = fresh();
  assert.deepEqual(R.partKeys(d, {}, 'i1'), ['oscA', 'filter', 'env1']);
  assert.deepEqual(R.edges(d, null, 'i1').filter(e => e.edge.a === 'oscA.out').map(e => [e.edge.b, e.off, !!e.dry]), [['filter.in', 'filter', false]]);
});

test('G4 plug / pull ≡ setEdge / cutEdge field for field over the enumerated states (every target; the fork\'s other switch left alone is the one rig rule beyond setEdge); can is pure and agrees with plug; the states stay normalised', () => {
  let plugs = 0, pulls = 0, forks = 0;
  for (const { s, part, ch, p, route, s1, s2, fb } of srcStates()) {
    const before = J(s);
    for (const tg of TARGETS) {
      const c = R.can(s, null, part + '.out', tg), r = R.plug(s, null, part + '.out', tg);
      assert.equal(J(s), before, 'can / plug touch nothing');
      assert.equal(c.ok, !r.why, tg + ': can agrees with plug');
      const sx = E.setEdge(s, null, part + '.out', tg), fk = tg === 'filter.in' ? 0 : tg === 'filter2.in' ? 1 : -1;
      if (!c.ok) { assert.equal(c.why, R.WORDS.same); assert.deepEqual(r, { f: [], why: R.WORDS.same, notes: [] }); continue; }
      plugs++;
      const T = R.apply(clone(s), r.f);
      assert.ok(R.edges(T, null, 'i1').some(e => e.edge.a === part + '.out' && e.edge.b === tg && !e.dry), 'the cord is there, wet');
      norm(T);
      const bal = C.lawValue(p + '.fbal', fb), other = fk >= 0 ? (fk ? (1 - bal) / 2 : (1 + bal) / 2) : 0, fork = fk >= 0 && route === 0 && other > 0;
      if (fork) {
        forks++;
        assert.deepEqual(r.f.map(x => x[0].join('.')).sort(), ['p.' + p + '.fbal', 'p.' + (fk ? 'f2.route' : 'f.route') + ch].filter(id => r.f.some(x => x[0].join('.') === id)).sort());
        assert.equal(T.p[p + '.fbal'], 0.5);
        assert.equal(T.p[(fk ? 'f2.route' : 'f.route') + ch], 1);
        assert.equal(T.p[(fk ? 'f.route' : 'f2.route') + ch], fk ? s1 : s2, 'the other cord\'s switch as it was');
        if ((fk ? s1 : s2) === 1) { assert.ok(sx.edit, 'setEdge forks too'); assert.deepEqual(r.f.slice().sort(), sx.f.slice().sort(), 'the same writes when the other switch is on'); }
      } else {
        assert.ok(sx.edit, 'setEdge edits too: ' + sx.why);
        assert.deepEqual(r.f.slice().sort(), sx.f.slice().sort(), part + ' → ' + tg + ': plug ≡ setEdge');
      }
      // the undo: the before-values restore the state exactly
      assert.deepEqual(R.apply(clone(T), r.f.map(([pa, b, a]) => [pa, a, b])), s);
    }
    // pull every cord of the source: a fork's branch → the balance all to the other filter (≡ cutEdge), one cord → route None
    for (const e of R.edges(s, null, 'i1').filter(x => x.edge.a === part + '.out')) {
      const r = R.pull(s, null, e.id);
      assert.equal(J(s), before);
      assert.ok(!r.why && r.f.length, 'pull edits: ' + r.why);
      pulls++;
      const T = R.apply(clone(s), r.f);
      norm(T);
      assert.ok(!R.edges(T, null, 'i1').some(x => x.edge.a === e.edge.a && x.edge.b === e.edge.b), 'gone: ' + e.id);
      // (≡ cutEdge unless the source's other cord is dry: sx-edges sees one cord and cuts the route, the rig keeps the dry one)
      if (!e.dry && !R.edges(s, null, 'i1').some(x => x.dry && x.edge.a === e.edge.a)) { const cx = E.cutEdge(s, null, e.edge.a, e.edge.b); assert.ok(cx.edit); assert.deepEqual(r.f.slice().sort(), cx.f.slice().sort(), 'pull ≡ cutEdge: ' + e.id); }
      if (e.fork) assert.equal(T.p[p + '.fbal'], e.edge.b === 'filter.in' ? 1 : 0); else assert.equal(SRC.find(q => q[0] === part)[3](T).route, 3);
      assert.deepEqual(R.apply(clone(T), r.f.map(([pa, b, a]) => [pa, a, b])), s, 'undo exact');
    }
    assert.equal(R.pull(s, null, 'x:i1:nothing>here').why, R.WORDS.none);
  }
  assert.ok(plugs > 2000 && pulls > 500 && forks > 50, [plugs, pulls, forks].join(' '));
  // the filters and the note tools go through setEdge / cutEdge as they are
  const s = fresh();
  s.filter[0].route = 1; s.filter[1].route = 1; s.p['f.on'] = 1; s.p['f2.on'] = 1;
  for (const [a, b] of [['filter.out', 'filter2.in'], ['filter2.out', 'voice.direct'], ['arp.out', 'voice.note'], ['clip.out', 'voice.note']]) {
    const r = R.plug(s, null, a, b), x = E.setEdge(s, null, a, b);
    assert.deepEqual(r.f, x.f, a + ' → ' + b);
    const T = R.apply(clone(s), r.f), id = 'x:i1:' + a + '>' + b;
    assert.ok(R.edges(T, null, 'i1').some(e => e.id === id));
    assert.deepEqual(R.pull(T, null, id).f, E.cutEdge(T, null, a, b).f);
  }
  assert.equal(R.plug(s, null, 'filter.out', 'filter2.in').why, '');
  const T = R.apply(clone(s), R.plug(s, null, 'filter.out', 'filter2.in').f);
  assert.equal(R.plug(T, null, 'filter2.out', 'filter.in').why, '', 'the most recent wins: the other goes to Main');
  const U = R.apply(clone(T), R.plug(T, null, 'filter2.out', 'filter.in').f);
  assert.deepEqual([U.filter[0].route, U.filter[1].route], [1, 0]);
});

test('G4 can: every refusal of §4.2 with its text (WORDS), the amp slot\'s rules, the read-only cords, another kind of jack; pure', () => {
  const s = R.rigInit(), W = R.WORDS;
  s.p['f.on'] = 1;
  const before = J(s);
  const why = (a, b) => { const c = R.can(s, null, a, b); assert.equal(c.ok, false, a + ' → ' + b); assert.deepEqual([c.a, c.b], [a, b]); return c.why; };
  assert.equal(why('oscA.out', 'fx.in'), W.voice);
  assert.equal(why('oscA.out', 'fx1.in'), W.voice, 'a panel / OUT: not an end of this rig');
  assert.equal(why('oscA.out', null), W.voice);
  assert.equal(why('filter.out', 'fx.in'), W.filter);
  assert.equal(why('filter.out', 'filter.in'), W.self);
  assert.equal(why('oscA.out', 'voice.note'), W.note);
  assert.equal(why('arp.out', 'voice.main'), W.notes);
  assert.equal(why('arp.out', 'filter.in'), W.notes);
  assert.equal(why('filter.in', 'voice.main'), W.input);
  assert.equal(why('voice.main', 'oscA.out'), W.input);
  assert.equal(why('oscA.out', 'oscB.out'), W.dir);
  assert.equal(why('oscA.out', 'voice.out'), W.dir);
  assert.equal(why('oscA.out', 'oscB.warp'), W.ro);
  assert.equal(why('voice.out', 'fx.in'), W.fx);
  assert.equal(why('voice.out', 'filter.in'), W.fx);
  assert.equal(why('nothing.out', 'filter.in'), W.bad);
  assert.equal(why('oscA.out', 'voice.main'), W.same, 'Init: Oscillator 1 → Amplifier IN already');
  assert.equal(why('lfo3.out', 'voice.level'), W.lfoLevel);
  assert.equal(why('oscA.out', 'voice.level'), W.level);
  assert.equal(why('filter.out', 'voice.level'), W.level);
  assert.equal(why('macros.k2', 'voice.level'), W.level);
  assert.equal(why('lfo3.out', 'filter.in'), W.mod);
  assert.equal(why('env2.out', 'voice.main'), W.mod);
  assert.equal(why('env1.out', 'filter.in'), W.mod);
  assert.equal(why('macros.k1', 'voice.main'), W.mod);
  assert.equal(why('lfo3.out', null), W.mod);
  assert.deepEqual(R.can(s, null, 'env1.out', 'voice.level'), { ok: true, why: '', a: 'env1.out', b: 'voice.level' }, 'the gate: Envelope 1 may take the level over');
  assert.deepEqual(R.can(s, null, 'env3.out', 'voice.level').ok, true, 'Envelope 3 into LEVEL while the gate');
  assert.equal(J(s), before, 'pure');
  const t = R.rigStarter().s;
  assert.equal(R.can(t, null, 'env1.out', 'voice.level').why, W.same, 'Envelope 1 is on LEVEL already');
  assert.equal(R.can(t, null, 'env2.out', 'voice.level').why, W.ampHeld(1));
  assert.equal(R.can(t, null, 'lfo1.out', 'voice.level').why, W.lfoLevel);
  assert.equal(R.can(null, null, 'oscA.out', 'filter.in').why, W.bad);
  assert.equal(R.can(t, null, 'oscA.out', 'filter.in').why, W.same, 'the starter: Oscillator 1 feeds Filter 1');
  assert.deepEqual(R.can(t, null, 'oscA.out', 'filter2.in').ok, true, 'a second filter: a fork');
  assert.deepEqual(R.can(t, null, 'oscA.out', 'voice.direct').ok, true);
  // a dry cord is a cord: plugging onto it is "Already connected"; the switch is the Filter face's
  const d = clone(t); d.p['f.routeA'] = 0;
  assert.equal(R.edges(d, null, 'i1').find(e => e.edge.a === 'oscA.out').dry, true);
  assert.equal(R.can(d, null, 'oscA.out', 'filter.in').why, W.same);
  // the pull of a dry fork branch and of a dry single cord
  const f = R.apply(clone(d), R.plug(d, null, 'oscA.out', 'filter2.in').f);
  assert.deepEqual(R.edges(f, null, 'i1').filter(e => e.edge.a === 'oscA.out').map(e => [e.edge.b, !!e.dry, e.fork]), [['filter.in', true, true], ['filter2.in', false, true]], 'the fork keeps the dry cord dry');
  const g = R.apply(clone(f), R.pull(f, null, 'x:i1:oscA.out>filter.in').f);
  assert.deepEqual(R.edges(g, null, 'i1').filter(e => e.edge.a === 'oscA.out').map(e => [e.edge.b, !!e.dry]), [['filter2.in', false]]);
  assert.equal(g.p['a.fbal'], 1);
  const h = R.apply(clone(d), R.pull(d, null, 'x:i1:oscA.out>filter.in').f);
  assert.equal(h.osc[0].route, 3, 'a dry single cord pulled: route None');
  norm(g); norm(h);
  // read-only cords refuse to be pulled
  const w = id => C.WARPS2.findIndex(x => x.id === id) / 81, u = fresh();
  u.global.s1 = 0; u.p['b.w1'] = w('fm_o1');
  assert.equal(R.pull(u, null, 'x:i1:oscA.out>oscB.warp#b.w1').why, W.ro);
  assert.equal(R.repatch(u, null, 'x:i1:oscA.out>oscB.warp#b.w1', 'b', 'filter.in').why, W.ro);
});

test('G4 the amp slot (§3.4): envToAmp(k) then envFromAmp with the same free slot returns the same state — e<k>.sus within 1 ulp (√x² is not exact), START / END dropped and listed, every other field identical; rows re-sourced (src and aux) and re-targeted both ways (macro1 → e3.dec follows into e1.dec and back; the canvas-row id map says so), s.midi / s.locks follow, the flags travel, lay keys and link-row ends swapped, the ordinal kept, the gate back; normalised throughout; the undo exact', () => {
  const S = envState(), rig = { v: 1, cc: {}, n: { env3: 7 } };
  assert.equal(R.isGate(S), true);
  assert.deepEqual(R.partKeys(S, {}, 'i1'), ['oscA', 'env2', 'env3', 'lfo1', 'macros']);
  const r1 = R.envToAmp(S, 3, { rig });
  assert.equal(r1.why, '');
  assert.deepEqual(r1.notes, ['Envelope 7 shapes the level']);
  assert.deepEqual(r1.lay, [['env3', 'env1']]);
  assert.deepEqual(r1.links, [['env3.out', 'env1.out'], ['env1.out', 'env3.out']]);
  const ids = new Map(r1.ids);
  assert.deepEqual([ids.get('e3.dec'), ids.get('e3.att'), ids.get('e3.start'), ids.get('e3.end'), ids.get('e1.dec'), ids.get('e1.sus')], ['e1.dec', 'e1.att', null, null, 'e3.dec', 'e3.sus'], 'the host\'s canvas rows iN:e3.* → iN:e1.* (START / END dropped)');
  const T = R.apply(clone(S), r1.f);
  norm(T);
  assert.equal(R.isGate(T), false, 'Envelope 3 shapes the level');
  assert.deepEqual([T.p['e1.att'], T.p['e1.rel'], T.p['e1.cd']], [0.3, 0.4, 0.2], 'the fields moved');
  assert.ok(Math.abs(T.p['e1.sus'] - Math.sqrt(0.49)) < 1e-12 && Math.abs(C.lawValue('e1.sus', T.p['e1.sus']) - C.lawValue('e3.sus', 0.49)) < 1e-12, 'the sustain re-lawed: the same level (pow2 vs lin)');
  assert.deepEqual(T.env[0], { bpm: 1, legInv: 1, stealRe: 1 }, 'the flags travel');
  assert.deepEqual(T.env[2], { bpm: 0, legInv: 0, stealRe: 0 });
  for (const id of C.MODULE_FIELDS.env3.p) assert.equal(T.p[id], C.DESTS[C.DEST_INDEX[id]].def, id + ': slot 3 back at Serum\'s defaults (read by nothing: its module goes)');
  assert.deepEqual(T.matrix.slice(0, 5).map(r => [r.src, r.aux, r.dst]), [['env1', '', 'a.wt'], ['macro1', '', 'e1.dec'], ['env2', '', 'f.cutoff'], ['velo', 'env1', 'a.level'], ['lfo1', '', 'e1.att']], 'rows re-sourced and re-targeted');
  assert.deepEqual([T.midi, T.locks.p, T.locks.unp, T.locks.mod], [{ 74: 'e1.dec', 75: 'a.level' }, ['e1.att', 'a.level'], ['e1.rel'], ['oscA', 'env1']]);
  assert.deepEqual(R.partKeys(T, {}, 'i1'), ['oscA', 'env1', 'env2', 'lfo1', 'macros'], 'Envelope 3\'s module is Envelope 1\'s slot now');
  assert.equal(R.labelOf('env1', { n: { env1: 7 } }), 'Envelope 7', 'the host moves the ordinal with the lay key: the bar still reads Envelope 7');
  assert.deepEqual(R.edges(T, null, 'i1').filter(e => e.kind === 'mod').map(e => e.id), ['x:i1:env1.out>voice.level']);
  // undo: the before-values restore S exactly
  assert.deepEqual(R.apply(clone(T), r1.f.map(([p, b, a]) => [p, a, b])), S);
  // and back: ENV 2 in use → slot 3 is the first free
  const r2 = R.envFromAmp(T, { rig: { n: { env1: 7 } } });
  assert.equal(r2.why, '');
  assert.deepEqual([r2.notes, r2.lay, r2.links], [['Envelope 7 unplugged · the keys gate the level again'], [['env1', 'env3']], [['env1.out', 'env3.out']]]);
  assert.deepEqual(new Map(r2.ids).get('e1.dec'), 'e3.dec');
  const U = R.apply(clone(T), r2.f);
  norm(U);
  assert.equal(R.isGate(U), true, 'the gate is back the moment the plug leaves');
  const d = R.diff(S, U);
  assert.deepEqual(d.map(x => x[0].join('.')), ['p.e3.sus'], 'every other field identical');
  assert.ok(Math.abs(U.p['e3.sus'] - 0.49) <= Number.EPSILON, 'e3.sus within 1 ulp');
  assert.deepEqual(U.matrix.slice(0, 5).map(r => [r.src, r.aux, r.dst]), S.matrix.slice(0, 5).map(r => [r.src, r.aux, r.dst]));
  assert.deepEqual([U.midi, U.locks], [S.midi, S.locks]);
  assert.deepEqual(U.env, S.env);
  assert.deepEqual(R.apply(clone(U), r2.f.map(([p, b, a]) => [p, a, b])), T, 'undo exact');
  // START / END: dropped into ENV 1, listed, back as 0
  const se = clone(S); se.p['e3.start'] = 0.2; se.p['e3.end'] = 0.3;
  const r3 = R.envToAmp(se, 'env3', { rig });
  assert.deepEqual(r3.notes, ['Envelope 7 shapes the level', 'Envelope 7’s START and END dropped — Envelope 1 has none']);
  const V = R.apply(clone(se), r3.f);
  assert.deepEqual([V.p['e3.start'], V.p['e3.end']], [0, 0]);
  const Wb = R.apply(clone(V), R.envFromAmp(V).f);
  assert.deepEqual([Wb.p['e3.start'], Wb.p['e3.end']], [0, 0], 'back as 0 (serum-core\'s swapModules rule)');
  // the kit's own moves with ENV 1 as a party = envToAmp's fields: serum-core swapModules moves the fields, the flags and the rows'
  // destinations the same way; envToAmp adds the sources, s.midi / s.locks, the slot's reset and the lay
  const K = clone(S); C.swapModules(K, 'env1', 'env3');
  for (const id of C.MODULE_FIELDS.env1.p) assert.equal(K.p[id], T.p[id], id + ': the kit\'s Swap moves ENV 1 as envToAmp does');
  assert.deepEqual(K.env[0], T.env[0]);
  assert.deepEqual(K.matrix.map(r => r.dst), T.matrix.map(r => r.dst), 'the destinations likewise');
  assert.notDeepEqual(K.matrix.map(r => r.src), T.matrix.map(r => r.src), 'the sources are the rig\'s rule (swapModules leaves them)');
  // Paste ENV 3 onto ENV 1 (copyModule) moves the fields and the flags the same way
  const P = clone(S); C.copyModule(P, clone(S), 'env1', 'env3');
  for (const id of C.MODULE_FIELDS.env1.p) assert.equal(P.p[id], T.p[id], id + ': Paste = the same fields');
  assert.deepEqual(P.env[0], T.env[0]);
});

test('G4 the amp slot: refusals and `held` / `shown` — envToAmp refused while a non-gate envelope holds the slot and for a bad k; envFromAmp refused while the gate; the first free slot skips slots in use (rows, link rows), laid on the canvas (`shown`) and held by canvas-modulator injections (`held` as names or cv-graph\'s { kind, k }) with the two texts; a read ENV 1 keeps its module when Envelope k takes the level (lay both ways)', () => {
  const W = R.WORDS, S = envState();
  assert.equal(R.envToAmp(S, 1).why, W.badEnv);
  assert.equal(R.envToAmp(S, 5).why, W.badEnv);
  assert.equal(R.envToAmp(S, 'lfo3').why, W.badEnv);
  assert.equal(R.envToAmp(null, 3).why, W.badEnv);
  assert.equal(R.envFromAmp(S).why, W.gate);
  const T = R.apply(clone(S), R.envToAmp(S, 3).f);
  assert.equal(R.envToAmp(T, 2).why, W.ampHeld(1));
  assert.equal(R.envToAmp(T, 4).why, W.ampHeld(1));
  // T: ENV 2 read by a row, ENV 3 free (defaults), ENV 4 free
  assert.deepEqual(R.envFromAmp(T).lay, [['env1', 'env3']]);
  assert.deepEqual(R.envFromAmp(T, { shown: ['env3'] }).lay, [['env1', 'env4']], 'a laid Envelope keeps its slot');
  assert.deepEqual(R.envFromAmp(T, { held: ['env3'] }).lay, [['env1', 'env4']], 'an injected slot is skipped');
  assert.deepEqual(R.envFromAmp(T, [{ kind: 'env', k: 2 }]).lay, [['env1', 'env4']], 'cv-graph\'s inj record (k 0-based) as the `held` list');
  assert.deepEqual(R.envFromAmp(T, { used: ['i1/env3.out'] }).lay, [['env1', 'env4']], 'a link row reads ENV 3');
  assert.equal(R.envFromAmp(T, { shown: ['env3', 'env4'] }).why, W.envFull);
  assert.equal(R.envFromAmp(T, { shown: ['env3'], held: ['env4'] }).why, W.envHeld);
  assert.equal(R.envFromAmp(T, { held: [{ kind: 'env', k: 2 }, { kind: 'env', k: 3 }, { kind: 'lfo', k: 1 }] }).why, W.envHeld);
  assert.equal(R.envFromAmp(T, { used: ['i1/env3.out', 'env4'] }).why, W.envFull);
  const U = clone(T); Object.assign(U.matrix[6], { src: 'env3', dst: 'b.wt', amt: 0.1 }); Object.assign(U.matrix[7], { src: 'lfo2', aux: 'env4', dst: 'c.wt', amt: 0.1 });
  assert.equal(R.envFromAmp(U).why, W.envFull, 'every slot read by a row');
  assert.equal(R.envFromAmp(U, { held: ['env2'] }).why, W.envFull, 'a held slot that is in use anyway: "remove one first"');
  // ENV 1 the gate AND read (a link row): Envelope 1 stands plugged into LEVEL; Envelope 3 takes the level → the module that was
  // Envelope 1 moves to slot 3 with the gate's values, read there (lay both ways), nothing reset
  const G = R.rigInit(); Object.assign(G.matrix[0], { src: 'env3', dst: 'a.wt', amt: 0.5 }); G.p['e3.att'] = 0.3;
  const rd = R.envToAmp(G, 3, { used: ['i1/env1.out'] });
  assert.deepEqual(rd.lay, [['env3', 'env1'], ['env1', 'env3']]);
  const H = R.apply(clone(G), rd.f);
  assert.deepEqual([H.p['e1.att'], H.p['e3.att'], H.p['e3.rel'], H.p['e3.sus']], [0.3, R.GATE.p['e1.att'], R.GATE.p['e1.rel'], 1], 'slot 3 holds the gate\'s values for its reader');
  assert.deepEqual(R.partKeys(H, {}, 'i1', ['i1/env3.out']), ['oscA', 'env1', 'env3']);
  assert.deepEqual(R.partKeys(H, {}, 'i1'), ['oscA', 'env1'], 'without the (renamed) link row slot 3 is shaped but unread: no module (sx-edges\' rule); the row env1 → a.wt reads ENV 1 on LEVEL');
});

// (WC pre-deploy [amp-held]) the refusal on an occupied LEVEL always said "Envelope 1", even with the module named "Envelope 2" in the amp
// slot (names are fixed per module, §3.4 / §12 item 4: plugging Envelope 2 into LEVEL keeps it Envelope 2, dev.rig.n.env1 = 2)
test('(WC pre-deploy [amp-held]) an occupied LEVEL refuses by the name of the module in the amp slot (dev.rig.n through ordinalOf): can, plug and envToAmp — the drag chip, the drop and the kit\'s swap', () => {
  const W = R.WORDS, S = envState(), T = R.apply(clone(S), R.envToAmp(S, 3).f);
  const rig = { v: 1, cc: {}, n: { env1: 2, env3: 1 } }; // (Envelope 2 shapes the level from slot 1; the module named Envelope 1 sits at slot 3)
  const held = 'Envelope 2 already shapes the level — pull it first';
  assert.deepEqual([R.can(T, null, 'env3.out', 'voice.level', { rig }).why, R.plug(T, null, 'env3.out', 'voice.level', { rig }).why, R.envToAmp(T, 3, { rig }).why, R.envToAmp(T, 4, { rig }).why],
    [held, held, held, held], 'Envelope 2 named, never Envelope 1');
  assert.equal(R.can(T, null, 'env1.out', 'voice.level', { rig }).why, W.same, 'the amp slot\'s own: already connected');
  assert.deepEqual([R.can(T, null, 'env3.out', 'voice.level').why, R.envToAmp(T, 3).why], [W.ampHeld(1), W.ampHeld(1)], 'no names recorded: the slot\'s ordinal');
});

test('G4 repatch: one step = pull then plug (the combined writes, the notes, the lay renames in order); a source cord\'s target moved between the Filters and to the Amplifier; the amp-slot cord\'s source moved to another Envelope (Envelope 1 to a free slot, the other onto LEVEL); refusals; the undo exact', () => {
  const s = R.rigStarter().s; // Oscillator 1 → Filter 1 → Amplifier, Envelope 1 on LEVEL
  s.p['f2.on'] = 1;
  const r = R.repatch(s, null, 'x:i1:oscA.out>filter.in', 'b', 'filter2.in');
  assert.equal(r.why, '');
  const T = R.apply(clone(s), r.f);
  norm(T);
  assert.deepEqual(R.edges(T, null, 'i1').filter(e => e.edge.a === 'oscA.out').map(e => [e.edge.b, !!e.dry, !!e.fork]), [['filter2.in', false, false]]);
  assert.equal(T.p['a.fbal'], 1);
  const two = R.apply(clone(s), R.pull(s, null, 'x:i1:oscA.out>filter.in').f);
  assert.deepEqual(T, R.apply(two, R.plug(two, null, 'oscA.out', 'filter2.in').f), 'pull then plug');
  assert.deepEqual(R.apply(clone(T), r.f.map(([p, b, a]) => [p, a, b])), s, 'undo exact');
  const m = R.repatch(s, null, 'x:i1:oscA.out>filter.in', 'b', 'voice.direct');
  assert.deepEqual(R.edges(R.apply(clone(s), m.f), null, 'i1').filter(e => e.edge.a === 'oscA.out').map(e => e.edge.b), ['voice.direct']);
  assert.equal(R.repatch(s, null, 'x:i1:oscA.out>filter.in', 'b', 'filter.in').why, R.WORDS.same);
  assert.equal(R.repatch(s, null, 'x:i1:oscA.out>filter.in', 'b', 'voice.note').why, R.WORDS.note);
  assert.equal(R.repatch(s, null, 'x:i1:oscA.out>filter.in', 'a', 'filter2.out').why, '', 'the source end moved: Filter 2 feeds Filter 1 instead');
  assert.equal(R.repatch(s, null, 'x:i1:none', 'b', 'filter2.in').why, R.WORDS.none);
  // the amp cord: Envelope 1 (shaped) on LEVEL, Envelope 3 (shaped, read) free; its source end moved to env3.out
  const a = clone(s); a.p['e1.att'] = 0.4; a.p['e3.att'] = 0.3; Object.assign(a.matrix[0], { src: 'env3', dst: 'a.wt', amt: 0.5 });
  const A = C.normalizeSerum(a), rig = { n: { env1: 1, env3: 3 } };
  const q = R.repatch(A, null, 'x:i1:env1.out>voice.level', 'a', 'env3.out', { rig, shown: ['env3'] });
  assert.equal(q.why, '');
  assert.deepEqual(q.lay, [['env1', 'env2'], ['env3', 'env1']], 'Envelope 1 to the first free slot (2), Envelope 3 onto LEVEL');
  assert.deepEqual(q.notes, ['Envelope 1 unplugged · the keys gate the level again', 'Envelope 3 shapes the level']);
  const B = R.apply(clone(A), q.f);
  norm(B);
  assert.deepEqual([B.p['e1.att'], B.p['e2.att'], B.p['e3.att'], R.isGate(B)], [0.3, 0.4, C.DESTS[C.DEST_INDEX['e3.att']].def, false]);
  assert.deepEqual(B.matrix[0].src, 'env1', 'the row follows Envelope 3 into slot 1');
  assert.deepEqual(R.apply(clone(B), q.f.map(([p, b, a2]) => [p, a2, b])), A, 'undo exact');
  assert.equal(R.repatch(A, null, 'x:i1:env1.out>voice.level', 'b', 'filter.in').why, R.WORDS.mod, 'LEVEL\'s cord goes nowhere else');
  // the id without its device prefix (dev given in o)
  assert.deepEqual(R.pull(A, null, 'env1.out>voice.level', { dev: 'i1' }).lay, [['env1', 'env2']]);
});

test('G4 1 000 random edit sequences over random states (plug / pull / repatch / the slot moves): never a throw, every state normalised (normalizeSerum(s) = s), every `f` undoes exactly, can agrees with plug, edges never throws; can / plug / pull leave their inputs untouched', () => {
  const ENDS_OUT = ['oscA.out', 'oscB.out', 'oscC.out', 'sub.out', 'noise.out', 'filter.out', 'filter2.out', 'arp.out', 'clip.out', 'env1.out', 'env2.out', 'env3.out', 'env4.out', 'lfo3.out', 'macros.k1', 'voice.out', 'filter.in', 'nothing'];
  const ENDS_IN = ['filter.in', 'filter2.in', 'voice.main', 'voice.direct', 'voice.note', 'voice.level', 'oscB.warp', 'fx.in', 'oscA.out', null, 'x'];
  let edits = 0, refusals = 0, moves = 0;
  const base = presets();
  for (let i = 0; i < 1000; i++) {
    let s = i % 3 === 0 ? R.rigInit() : i % 3 === 1 ? R.rigBlank() : clone(pick(base).s);
    if (i % 5 === 0) for (const k of ['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on']) s.p[k] = rnd() < 0.5 ? 1 : 0;
    if (i % 7 === 0) Object.assign(s.matrix[0], { src: pick(['env2', 'env3', 'env4', 'lfo1', 'macro1', 'env1']), dst: pick(['a.wt', 'e3.dec', 'f.cutoff', 'e2.att']), amt: 0.5 });
    s = C.normalizeSerum(s);
    const steps = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < steps; k++) {
      const before = J(s), o = { held: rnd() < 0.3 ? ['env' + (2 + Math.floor(rnd() * 3))] : [], shown: rnd() < 0.3 ? ['env' + (2 + Math.floor(rnd() * 3))] : [] };
      let r;
      const op = rnd();
      if (op < 0.45) {
        const a = pick(ENDS_OUT), b = pick(ENDS_IN), c = R.can(s, null, a, b);
        r = R.plug(s, null, a, b, o);
        assert.equal(c.ok, !r.why, a + ' → ' + b + ': ' + c.why + ' / ' + r.why);
        if (!c.ok) assert.equal(r.why, c.why);
      } else if (op < 0.75) {
        const L = R.edges(s, null, 'i1'), e = L.length ? pick(L) : null;
        r = e ? R.pull(s, null, e.id, o) : R.pull(s, null, 'x:i1:none', o);
      } else if (op < 0.9) {
        const L = R.edges(s, null, 'i1'), e = L.length ? pick(L) : null;
        r = e ? R.repatch(s, null, e.id, rnd() < 0.7 ? 'b' : 'a', pick(rnd() < 0.7 ? ENDS_IN : ENDS_OUT), o) : R.repatch(s, null, 'none', 'b', 'filter.in', o);
      } else r = rnd() < 0.5 ? R.envToAmp(s, 2 + Math.floor(rnd() * 3), o) : R.envFromAmp(s, o);
      assert.equal(J(s), before, 'the input is untouched');
      assert.deepEqual(Object.keys(r).slice(0, 3), ['f', 'why', 'notes']);
      assert.ok(Array.isArray(r.f) && typeof r.why === 'string' && Array.isArray(r.notes));
      if (r.why) { refusals++; assert.deepEqual(r.f, [], 'a refusal writes nothing'); continue; }
      edits++;
      if (r.lay) moves++;
      assert.ok(r.f.length, 'an edit has writes');
      const T = R.apply(clone(s), r.f);
      assert.deepEqual(C.normalizeSerum(clone(T)), T, 'normalised after ' + r.f.map(x => x[0].join('.')).join(','));
      assert.deepEqual(R.apply(clone(T), r.f.map(([p, b, a]) => [p, a, b])), s, 'the undo is exact');
      R.edges(T, null, 'i1'); R.partKeys(T, {}, 'i1');
      s = T;
    }
  }
  assert.ok(edits > 1000 && refusals > 1000 && moves > 100, [edits, refusals, moves].join(' '));
});

test('partKeys (§3.4 I1 / I2 / I1\', the amp slot): sx-edges\' parts + env1 iff !isGate ∨ read (a row\'s src / aux, a link row) + a Filter fed by a powered source with a share above 0 even when ⏻ off; a laid part stays; PARTS order; the pins of jackrules hold through sx-edges unchanged', () => {
  const s = R.rigInit();
  assert.deepEqual(R.partKeys(s, {}, 'i1'), ['oscA']);
  assert.deepEqual(R.partKeys(s, {}, 'i1', ['i1/env1.out']), ['oscA', 'env1']);
  assert.deepEqual(R.partKeys(s, {}, 'i1', ['i1/lfo4.out', 'env4']), ['oscA', 'env4', 'lfo4']);
  assert.deepEqual(R.partKeys(s, { 'i1/env1': { x: 0, y: 0 } }, 'i1'), ['oscA'], 'a stale lay entry of the gate: no module (the legend shows)');
  assert.deepEqual(R.partKeys(s, { 'i1/lfo9': { x: 0, y: 0 }, 'i2/lfo8': { x: 0, y: 0 } }, 'i1'), ['oscA', 'lfo9']);
  const t = clone(s); Object.assign(t.matrix[0], { src: 'velo', aux: 'env1', dst: 'a.level', amt: 0.3 });
  assert.deepEqual(R.partKeys(t, {}, 'i1'), ['oscA', 'env1'], 'an aux reads ENV 1');
  assert.deepEqual(R.partKeys(R.rigStarter().s, {}, 'i1'), ['oscA', 'filter', 'env1']);
  // I1': route 0 into an off Filter with a share above 0; a share of 0 for the other
  const u = clone(s); u.osc[0].route = 0; u.p['a.fbal'] = 0;
  assert.deepEqual(R.partKeys(u, {}, 'i1'), ['oscA', 'filter']);
  u.p['a.fbal'] = 1; assert.deepEqual(R.partKeys(u, {}, 'i1'), ['oscA', 'filter2']);
  u.p['a.fbal'] = 0.5; assert.deepEqual(R.partKeys(u, {}, 'i1'), ['oscA', 'filter', 'filter2']);
  u.p['f.routeA'] = 0; assert.deepEqual(R.partKeys(u, {}, 'i1'), ['oscA', 'filter', 'filter2'], 'the switch does not matter: a dry cord lands there');
  u.p['a.on'] = 0; assert.deepEqual(R.partKeys(u, {}, 'i1'), [], 'an off source feeds nothing');
  assert.deepEqual(R.partKeys(null, {}, 'i1'), []);
  // sx-edges: PARTS has env1 (before env2), splitKey knows it, kindOf('env1') is 'env', firstFree never gives it, slotsUsed counts it only when asked, partKeys never lists it
  assert.deepEqual(E.PARTS.slice(5, 11), ['filter', 'filter2', 'env1', 'env2', 'env3', 'env4']);
  assert.deepEqual([E.splitKey('i1/env1'), E.kindOf('env1'), E.partLabel('env1'), E.firstFree(R.rigBlank(), 'env')], [{ dev: 'i1', part: 'env1' }, 'env', 'ENV 1', 'env2']);
  assert.deepEqual([[...E.slotsUsed(t)].sort(), [...E.slotsUsed(t, null, true)].sort(), [...E.slotsUsed(s, ['i1/env1.out'])], [...E.slotsUsed(s, ['i1/env1.out'], true)]], [[], ['env1'], [], ['env1']]);
  assert.deepEqual(E.partKeys(t, { 'i1/env1': { x: 0, y: 0 } }, 'i1'), ['oscA'], 'sx-edges lists no env1 (VOICE\'s)');
  assert.deepEqual([E.jackOf('i1', 'voice.level'), E.endOf('i1', 'i1.level'), E.jackOf('i1', 'env1.out'), E.endOf('i1', 'i1/env1.out'), E.jackOf('i2', 'lfo3.out')], ['i1.level', 'voice.level', 'i1/env1.out', 'env1.out', null]);
  assert.deepEqual([E.setEdge(s, null, 'oscA.out', 'voice.level').why, E.setEdge(s, null, 'env1.out', 'filter.in').why, E.setEdge(s, null, 'env1.out', 'voice.level').why, E.cutEdge(s, null, 'env1.out', 'voice.level').why], [E.WHY.level, E.WHY.env, E.WHY.level, E.WHY.level], 'the amp slot is rig-core\'s: never a setEdge write');
});

test('names (§3.4 fixed ordinals): labelOf / nameOf read dev.rig.n, else the engine slot; the Amplifier and the effects; nextOrdinal the lowest unused; ordinalOf bounds', () => {
  const rig = { v: 1, cc: {}, n: { env2: 5, lfo3: 1 } };
  assert.deepEqual(['oscA', 'oscC', 'sub', 'noise', 'filter', 'filter2', 'env1', 'env2', 'env4', 'lfo3', 'lfo10', 'macros', 'arp', 'clip', 'voice', null, 'fx', 'zzz'].map(p => R.labelOf(p, rig)),
    ['Oscillator 1', 'Oscillator 3', 'Sub oscillator', 'Noise', 'Filter 1', 'Filter 2', 'Envelope 1', 'Envelope 5', 'Envelope 4', 'LFO 1', 'LFO 10', 'Macros', 'Arpeggiator', 'Clip sequencer', 'Amplifier', 'Amplifier', 'Effects', 'zzz']);
  assert.deepEqual(['i1/env2', 'i1/oscB', 'i1', 'i1/fx', 'i7/lfo3', 'bogus'].map(k => R.nameOf(rig, k)), ['Envelope 5', 'Oscillator 2', 'Amplifier', 'Effects', 'LFO 1', 'Amplifier']);
  assert.deepEqual([R.ordinalOf(rig, 'env2'), R.ordinalOf(rig, 'env3'), R.ordinalOf(null, 'env3'), R.ordinalOf({ n: { env3: 0 } }, 'env3'), R.ordinalOf({ n: { env3: 100 } }, 'env3'), R.ordinalOf({ n: { env3: 2.5 } }, 'env3')], [5, 3, 3, 3, 3, 3]);
  assert.deepEqual([R.nextOrdinal(rig, 'env', ['env2']), R.nextOrdinal(rig, 'env', ['env2', 'env1']), R.nextOrdinal({ n: { env2: 1, env3: 2, env4: 3 } }, 'env', ['env2', 'env3', 'env4']), R.nextOrdinal(null, 'lfo', ['lfo1', 'lfo2', 'lfo5']), R.nextOrdinal(null, 'osc', [])], [1, 2, 4, 3, 1]);
  assert.deepEqual(R.labelOf('env2', null), 'Envelope 2');
});

test('pruneRig (§2.1): a GC — cc entries whose source part is no module (and env1.out without the amp cord) and n entries of no module go, everything else stays; the bounds of normRig first; never throws on garbage; a non-state leaves the record alone', () => {
  const s = R.rigStarter().s, rig = { v: 1, cc: { 'oscA.out': 2, 'oscB.out': 3, 'filter.out': 5, 'filter2.out': 1, 'env1.out': 6, 'lfo3.out#2': 4, 'voice.main': 1, bad: 9 }, n: { env1: 4, env2: 1, oscA: 7, lfo3: 2 } };
  assert.deepEqual(R.pruneRig(rig, s, {}, 'i1'), { v: 1, cc: { 'oscA.out': 2, 'filter.out': 5, 'env1.out': 6, 'voice.main': 1 }, n: { env1: 4, oscA: 7 } });
  assert.deepEqual(R.pruneRig(rig, s, { 'i1/lfo3': { x: 0, y: 0 }, 'i1/oscB': { x: 0, y: 0 } }, 'i1').cc, { 'oscA.out': 2, 'oscB.out': 3, 'filter.out': 5, 'env1.out': 6, 'lfo3.out#2': 4, 'voice.main': 1 }, 'laid parts are modules');
  assert.deepEqual(R.pruneRig(rig, R.rigInit(), {}, 'i1'), { v: 1, cc: { 'oscA.out': 2, 'voice.main': 1 }, n: { oscA: 7 } }, 'the gate: no env1.out');
  assert.equal(R.pruneRig(rig, {}, {}, 'i1'), rig, 'not a state: the identity');
  assert.equal(R.pruneRig(rig, null, {}, 'i1'), rig);
  for (const bad of [null, 1, 'x', [], { cc: 5 }, { cc: { __proto__: null } }, Object.create(null)]) assert.doesNotThrow(() => R.pruneRig(bad, s, {}, 'i1'));
  assert.deepEqual(R.pruneRig(null, s, {}, 'i1'), { v: 1, cc: {}, n: {} });
  const big = { cc: {}, n: {} };
  for (let i = 0; i < 600; i++) big.cc['oscA.out#' + i] = i % 8;
  assert.ok(Object.keys(R.pruneRig(big, s, {}, 'i1').cc).length <= 512);
  for (let i = 0; i < 50; i++) { // fuzz: random records, random states — never a throw, always bounded
    const r = { cc: {}, n: {} };
    for (let k = 0; k < 20; k++) { r.cc[pick(['oscA.out', 'lfo' + (1 + k % 10) + '.out#' + k, 'env1.out', 'x'])] = Math.floor(rnd() * 10) - 1; r.n[pick(['env2', 'lfo5', 'oscC', 'q'])] = Math.floor(rnd() * 120) - 10; }
    const o = R.pruneRig(r, pick(presets()).s, {}, 'i1');
    assert.ok(Object.keys(o.cc).every(k => /^[a-z]/.test(k) && o.cc[k] >= 0 && o.cc[k] <= 7) && Object.values(o.n).every(v => v >= 1 && v <= 99));
  }
});

test('lines mode (§4.7, G4): on a rig track cv-cables\' internal records (its lines renderer) equal edges() in ids and ends for every audio / note / warp cord (the amp-slot cord is the rig\'s own, dry cords the documented difference)', () => {
  for (const { name, s } of presets().filter((_, i) => i % 4 === 0).concat([{ name: 'starter', s: R.rigStarter().s }, { name: 'init', s: R.rigInit() }])) {
    const lay = {};
    for (const p of R.partKeys(s, {}, 'i1')) lay['i1/' + p] = { x: 0, y: 0 };
    const t = { id: 't', color: '#fff', lay, dev: { i1: { kind: 'synth', model: 'rig', vals: { s }, fx: C.defaultFx2() }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [] };
    const lines = CB.cablesOf(t, { parts: () => true }).filter(r => r.int && !r.stub), cords = R.edges(s, t.dev.i1.fx, 'i1').filter(e => e.kind !== 'mod' && !e.dry);
    assert.deepEqual(lines.map(r => [r.id, r.a, r.b]).sort(), cords.map(e => [e.id, e.a, e.b]).sort(), name);
    for (const r of lines) { const e = cords.find(x => x.id === r.id); assert.equal(e.kind, r.int, name + ' ' + r.id); assert.deepEqual(e.edge, r.edge); }
  }
});

test('review 1 (fixer A): I1\' — a Filter stands while the other Filter routes into it, powered or ⏻ off but fed by a powered source (serum-dsp passes it through: nothing audible without a cord); can — Envelope 1 standing as the gate (read) is "Already connected" on LEVEL; repatch of the amp cord\'s source end — the two slot moves composed (each key once; the second reads the first\'s renames: used / shown / rig), equal fields still a move (the lay, no write); applyPrefs keeps MPE off for a rig (midi.js routes MPE to a Serum only in WC-1, §13)', () => {
  // I1': Oscillator 1 → Filter 2 → Filter 1 (⏻ off) → Main
  const s = R.rigInit();
  s.osc[0].route = 0; s.p['a.fbal'] = 1; s.p['f2.routeA'] = 1; s.p['f2.on'] = 1; s.filter[1].route = 0; s.filter[0].route = 1; s.p['f.on'] = 0;
  const S0 = C.normalizeSerum(s);
  assert.deepEqual([S0.filter[1].route, S0.filter[0].route, S0.p['f.on'], S0.p['f2.on']], [0, 1, 0, 1], 'the fixture as written');
  assert.deepEqual(R.partKeys(S0, {}, 'i1'), ['oscA', 'filter', 'filter2'], 'Filter 1 (⏻ off) fed by the powered Filter 2 stands');
  assert.ok(R.edges(S0, null, 'i1').some(e => e.edge.a === 'filter2.out' && e.edge.b === 'filter.in' && e.off === 'filter'), 'its cord drawn (into an off Filter)');
  const t2 = clone(S0); t2.p['f2.on'] = 0;
  assert.deepEqual(R.partKeys(t2, {}, 'i1'), ['oscA', 'filter', 'filter2'], 'both ⏻ off: Filter 2 fed by the oscillator (I1\'), it passes into Filter 1');
  const t3 = clone(t2); t3.p['a.on'] = 0;
  assert.deepEqual(R.partKeys(t3, {}, 'i1'), [], 'nothing powered feeds either: neither stands');
  const t4 = clone(S0); t4.osc[0].route = 1;
  assert.deepEqual(R.partKeys(t4, {}, 'i1'), ['oscA', 'filter', 'filter2'], 'a powered Filter 2 routed into Filter 1 keeps it (its cord has both ends)');
  // can: the gate read by a row (or a link row) — Envelope 1 stands with its derived cord on LEVEL
  const g = R.rigInit(); Object.assign(g.matrix[0], { src: 'env1', dst: 'a.level', amt: 0.3 });
  const G = C.normalizeSerum(g);
  assert.ok(R.edges(G, null, 'i1').some(e => e.edge.a === 'env1.out' && e.edge.b === 'voice.level'), 'the derived cord');
  assert.equal(R.can(G, null, 'env1.out', 'voice.level').why, R.WORDS.same, 'read: Envelope 1 stands on LEVEL already');
  assert.deepEqual([R.plug(G, null, 'env1.out', 'voice.level').why, R.plug(G, null, 'env1.out', 'voice.level').f.length], [R.WORDS.same, 0], 'nothing rewritten');
  assert.equal(R.can(R.rigInit(), null, 'env1.out', 'voice.level', { used: ['i1/env1.out'] }).why, R.WORDS.same, 'a link row reads it');
  assert.equal(R.can(R.rigInit(), null, 'env1.out', 'voice.level').ok, true, 'unread: Envelope 1 may take the level over');
  assert.equal(R.can(G, null, 'env3.out', 'voice.level').ok, true, 'another Envelope still may (the read one moves aside)');
  // repatch: Envelope 1 (att 0.4, read by a link row) on LEVEL → its source end moved to Envelope 3 (att 0.3)
  const st = R.rigStarter().s, a = clone(st);
  a.p['e1.att'] = 0.4; a.p['e3.att'] = 0.3;
  const A = C.normalizeSerum(a), O = { rig: { n: { env1: 1, env3: 2 } }, shown: ['oscA', 'filter', 'env1', 'env3'], used: ['i1/env1.out'] };
  const q = R.repatch(A, null, 'x:i1:env1.out>voice.level', 'a', 'env3.out', O);
  assert.equal(q.why, '');
  assert.deepEqual(q.lay, [['env1', 'env2'], ['env3', 'env1']], 'Envelope 1 to slot 2, Envelope 3 onto LEVEL');
  assert.deepEqual(q.links, [['env1.out', 'env2.out'], ['env3.out', 'env1.out']], 'each link-row end once (no Map collapse can pick the wrong one)');
  const idm = new Map(q.ids);
  assert.equal(idm.size, q.ids.length, 'each id once');
  assert.deepEqual([idm.get('e1.att'), idm.get('e3.att'), idm.get('e3.start'), idm.has('e2.att')], ['e2.att', 'e1.att', null, false], 'a canvas row on Envelope 1\'s ATTACK follows it to slot 2');
  const B = R.apply(clone(A), q.f);
  norm(B);
  assert.deepEqual([B.p['e2.att'], B.p['e1.att'], B.p['e3.att']], [0.4, 0.3, C.DESTS[C.DEST_INDEX['e3.att']].def], 'the link row moved with Envelope 1: the gate left behind is read by nothing — slot 3 back to the defaults');
  assert.deepEqual(q.notes, ['Envelope 1 unplugged · the keys gate the level again', 'Envelope 2 shapes the level']);
  assert.deepEqual(R.apply(clone(B), q.f.map(([p, b, a2]) => [p, a2, b])), A, 'undo exact');
  const E2 = R.repatch(st, null, 'x:i1:env1.out>voice.level', 'a', 'env3.out', { rig: { n: { env1: 1, env3: 2 } }, shown: ['env3'] });
  assert.deepEqual([E2.why, E2.f.length, E2.lay], ['', 0, [['env1', 'env2'], ['env3', 'env1']]], 'equal fields: no write, the modules still move');
  // applyPrefs: the Serum's MPE preference stays the Serum's
  const P = { defOs: 4, mpeDefault: 1 };
  assert.deepEqual([R.applyPrefs(C.defaultSerum(), P).global.mpe.on, R.applyPrefs(R.rigInit(), P, true).global.mpe.on, R.rigStarter(P).s.global.mpe.on, R.rigStarter(P).s.global.os], [1, 0, 0, 4]);
});

/* ---------------------------------------------------------------- review 2 (fixer B1) */
test('review 2 (fixer B1) P2-5 targetsOf — Tidy\'s targets (the user\'s rule: every modulator over what it drives): Envelope 1 → the Amplifier first (the amp slot), each matrix row → the module holding its knob (a / b / c the Oscillators, s Sub, n Noise, f / f2 the Filters, e<k> / l<k> that Envelope / LFO, m<k> Macros, fx the Effects, any other id of the instrument the Amplifier), a knob whose module is not standing → the Amplifier (its end parks on it); row order, each once; the modulators standing only; pure', () => {
  const s = R.rigStarter().s;
  const rows = [['lfo1', 'f.cutoff'], ['lfo1', 'a.wt'], ['lfo1', 'f.res'], ['env2', 'f2.cutoff'], ['macro3', 'g.amp'], ['lfo2', 'e2.att'], ['lfo2', 'm1'], ['lfo3', 'fx.dist.drive'], ['macro1', 'b.level'], ['env1', 'a.level'], ['lfo4', 'c1.rate'], ['env4', 'n.level']];
  rows.forEach(([src, dst], i) => Object.assign(s.matrix[i], { src, dst, amt: 0.25 }));
  const S = C.normalizeSerum(s), before = J(S);
  const parts = ['oscA', 'filter', 'env1', 'env2', 'lfo1', 'lfo2', 'lfo3', 'macros', 'lfo4'];
  const T = R.targetsOf(S, parts);
  assert.deepEqual(T, { env1: ['voice', 'oscA'], env2: ['voice'], lfo1: ['filter', 'oscA'], lfo2: ['env2', 'macros'], lfo3: ['fx'], macros: ['voice'], lfo4: ['voice'] },
    'f2 / b not standing: the Amplifier; env4 not standing: not listed');
  assert.equal(J(S), before, 'pure');
  assert.deepEqual(R.targetsOf(R.rigInit(), ['oscA']), {}, 'no modulator, nothing');
  assert.deepEqual(R.targetsOf(R.rigStarter().s, ['oscA', 'filter', 'env1']), { env1: ['voice'] }, 'the starter: Envelope 1 drives the Amplifier\'s LEVEL');
  assert.deepEqual(R.targetsOf(null, ['env1']), {}, 'not a state: nothing');
});

test('review 2 (fixer B1) P3-6: every cord colour of the rule reads on the charcoal skin (≥ 3 : 1 against its case and face, WCAG\'s non-text contrast) — the Noise cord is Cream (white noise), no longer the palette\'s Black', () => {
  const lum = h => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const n = parseInt(h.slice(1), 16); return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const [part, c] of Object.entries(R.LOOK.c)) for (const bg of ['#17181a', '#1f2023']) assert.ok(ratio(PALETTE[c], bg) >= 3, part + ' (' + PALETTE[c] + ') on ' + bg + ': ' + ratio(PALETTE[c], bg).toFixed(2));
  assert.equal(R.LOOK.c.noise, 4, 'Noise: Cream');
  assert.equal(R.cordColor('noise.out', null), 4);
});

test('review 2 (fixer B1) P3-2: barOf — a module bar\'s title: the full name where it fits ("Envelope 2" by its ordinal, "Noise", "Amplifier"), "Sub osc" on the Sub oscillator\'s 3-column bar; every other text keeps labelOf\'s full name', () => {
  assert.deepEqual(['sub', 'noise', 'oscB', 'env3', 'lfo2', 'macros', 'voice', 'fx'].map(p => R.barOf(p, { n: { env3: 2 } })), ['Sub osc', 'Noise', 'Oscillator 2', 'Envelope 2', 'LFO 2', 'Macros', 'Amplifier', 'Effects']);
  assert.equal(R.labelOf('sub'), 'Sub oscillator');
  assert.ok(!/Serum|VOICE|Xfer/.test(R.MODULES.sub.bar));
});
