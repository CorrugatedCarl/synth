// main.js's host side of stage 1e (IMPL-1e §3.3) in the page simulation (tests/main-sim.mjs): a track of a graph shape
// is driven by the graph protocol — {t: 'graph'}, {t: 'patch', i, p} per instrument, {t: 'chain', c, fxr, fxrT} per
// shared panel — built from processorOptions when its node is made (the protocol fixture's messages, tests/fixtures/
// graph-1e.mjs) or posted when an edit gives a live track that shape (its legacy i0 / c0 adopted); a canonical track
// posts no graph message (tests/canonical-stream.test.mjs: today's stream); a bounce builds the live node's graph;
// monitors, module CPU, the safeguard, the sequencer and MIDI messages name their device on graphed nodes only.
// Run: node --max-old-space-size=2048 --test tests/graph-host.test.mjs (one file at a time). Only strings / numbers /
// plain data reach assert (never a fake-DOM node).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CG from '../cv-graph.js?v=9';
import { MODELS } from '../models.js?v=9';
import * as F from './fixtures/graph-1e.mjs?v=9';

const vals = id => Object.fromEntries(MODELS.find(m => m.id === id).controls.map(c => [c.id, c.def]));
const clone = x => JSON.parse(JSON.stringify(x));
const keyless = g => { const o = Object.assign({}, g); delete o.t; return o; };
let sim = null;
async function page() {
  if (!sim) { sim = await bootMain({ hash: '#juno60' }); await sim.power(); await sim.settle(30); sim.raf(); }
  return sim;
}
const P = () => sim.api.project();
const N = t => sim.api.nodes.get(t.id);
const sent = (t, from = 0) => sim.nodeOf(t.id).posted.slice(from).map(x => x.m).filter(m => !['mon', 'smon', 'fxph', 'transport', 'song'].includes(m.t));
const tag = m => m.t + (m.i !== undefined ? ':' + m.i : '') + (m.c !== undefined ? ':' + m.c : '');
// a fresh track added through the app (addTrack: v1 → adopt), its node made
function addJuno() {
  const before = new Set(P().tracks.map(t => t.id));
  sim.api.addTrack(MODELS.find(m => m.id === 'juno60'));
  sim.raf();
  return P().tracks.find(t => !before.has(t.id));
}

test('a canonical track posts no graph message: today\'s options and stream (no i / c), its node never graphed', async () => {
  await page();
  const t = P().tracks[0], node = sim.nodeOf(t.id);
  assert.equal(t.model, 'juno60');
  assert.equal(CG.compileTrack(t).canonical, true);
  assert.deepEqual(['graph', 'patches', 'chains', 'seqs'].map(k => k in node.po), [false, false, false, false]);
  assert.equal(typeof node.po.patch, 'object');
  const n0 = node.posted.length;
  t.vals.lr = 7; sim.api.sendPatch(t);
  const m = sent(t, n0);
  assert.deepEqual(m.map(tag), ['patch'], 'today\'s {t: patch, p}');
  assert.equal(!!N(t).graphed, false);
  // (review H2) a powered-off second instrument: the compile is canonical (one sounds), but the node must name devices —
  // the graph protocol (the legacy stream is for one-instrument tracks only); on another track: this one stays legacy
  const u = addJuno(), nu = sim.nodeOf(u.id);
  const i2 = CMOD.addInst(u, 'minimoog', { vals: vals('minimoog') });
  CMOD.setPower(u, i2, false);
  assert.equal(CG.compileTrack(u).canonical, true);
  const n1 = nu.posted.length;
  u.vals.lr = 8; sim.api.sendPatch(u);
  const m1 = sent(u, n1);
  assert.deepEqual([m1[0].t, m1[0].insts.map(x => x.id + ':' + x.on), m1.some(x => x.t === 'patch' && x.i === undefined), N(u).graphed],
    ['graph', ['i1:true', i2 + ':false'], false, true]);
});

test('a live track given two instruments: graph (i0 / c0 adopted), patch i per Inst, the chain on its first change; sticky graphed', async () => {
  await page();
  const t = addJuno(), node = sim.nodeOf(t.id);
  assert.equal(!!N(t).graphed, false);
  const n0 = node.posted.length;
  const i2 = CMOD.addInst(t, 'minimoog', { vals: vals('minimoog') });
  sim.api.sendPatch(t);
  const m = sent(t, n0), g = CG.compileGraph(t).graph;
  // (c0 is adopted as fx1 with its rack: the chain goes again only because its first rack re-seeded the LFO phases —
  // a legacy node's next patch does the same — and without its tables, which the node has)
  assert.deepEqual(m.map(tag), ['graph', 'patch:i1', 'patch:' + i2, 'chain:fx1']);
  assert.deepEqual([m[3].fxr.seed, 'fxrT' in m[3]], [0, false]);
  assert.deepEqual(keyless(m[0]), g);
  assert.deepEqual([m[0].insts.map(x => [x.id, x.on, x.salt]), m[0].chains, m[0].edges, m[0].out],
    [[['i1', true, 0], [i2, true, CG.saltOf(i2, 'i1')]], [{ id: 'fx1' }], [['i1', 'fx1', 1], ['fx1', 'out', 1], [i2, 'fx1', 1]], 'out']);
  for (const x of m.slice(1, 3)) assert.equal('fxr' in x.p || 'fxrT' in x.p, false, 'a classic Inst carries no rack (its panel is a chain)');
  assert.deepEqual(m[1].p, sim.api.buildInstPatch(t, 'i1'), 'the primary\'s Inst patch');
  assert.equal(N(t).graphed, true);
  // a knob of one instrument: its patch alone; a level and power: the graph (+ power), no patches
  let k = node.posted.length;
  const c0 = MODELS.find(x => x.id === 'minimoog').controls.find(c => typeof c.def === 'number').id;
  t.dev[i2].vals[c0] += 1; sim.api.sendPatch(t);
  assert.deepEqual(sent(t, k).map(tag), ['patch:' + i2]);
  k = node.posted.length;
  t.wires.find(w => w.a === i2 + '.out').g = 0.5; CMOD.setPower(t, i2, false); sim.api.sendPatch(t);
  const pw = sent(t, k);
  assert.deepEqual(pw.map(tag), ['graph', 'power:' + i2]);
  assert.deepEqual([pw[0].edges[2], pw[0].insts[1].on, pw[1].on], [[i2, 'fx1', 0.5], false, false]);
  // the panel's rack: {t: chain, c} with its tables, then only what changed
  k = node.posted.length;
  const core = await import('../serum-core.js?v=9');
  core.newInstance(t.fx, 'cho', { rack: 0 }); sim.api.sendPatch(t);
  const ch = sent(t, k), want = sim.api.graphParts(t).chains.fx1;
  assert.deepEqual(ch.map(tag), ['chain:fx1']);
  assert.deepEqual(ch[0].fxr, want.fxr, 'the panel compiled as a classic track\'s rack (cv-graph chainPatch)');
  assert.equal(!('fxrT' in ch[0]) || ch[0].fxrT.key === want.fxrT.key, true);
  k = node.posted.length; sim.api.sendPatch(t);
  assert.deepEqual(sent(t, k).map(tag), [], 'nothing changed: nothing posted');
  // canonical again (the second instrument removed): still the graph protocol on this node
  CMOD.removeInst(t, i2);
  assert.equal(CG.compileTrack(t).canonical, true);
  k = node.posted.length; sim.api.sendPatch(t);
  const back = sent(t, k);
  assert.deepEqual([back[0].t, back[0].insts.map(x => x.id), back.some(x => x.t === 'patch' && x.i === undefined)], ['graph', ['i1'], false]);
});

test('a graph-shaped track\'s node is built from processorOptions = the protocol fixture\'s messages; edits post per part', async () => {
  await page();
  const p = clone(P()), fx = F.tracks();
  p.tracks.push(fx.a, fx.b, fx.c);
  sim.api.applyRestore(p); sim.raf(); await sim.settle(5);
  for (const k of ['a', 'b', 'c']) {
    const t = P().tracks.find(x => x.id === fx[k].id), node = sim.nodeOf(t.id), po = node.po;
    const M = F.messages(t, Object.assign({}, F.OPTS, { seed: true })); // (a loaded project re-seeds its racks' LFO phases)
    assert.equal(N(t).graphed, true, k);
    assert.deepEqual([po.patch, po.seq], [null, null], k);
    assert.deepEqual(Object.assign({ t: 'graph' }, po.graph), M[0], k + ': graph');
    for (const x of M.filter(y => y.t === 'patch')) assert.deepEqual(po.patches[x.i], x.p, k + ': patch ' + x.i);
    for (const x of M.filter(y => y.t === 'chain')) assert.deepEqual(po.chains[x.c], { fxr: x.fxr, fxrT: x.fxrT }, k + ': chain ' + x.c);
    assert.deepEqual(Object.keys(po.patches), M[0].insts.map(x => x.id));
    assert.deepEqual(po.seqs, {});
    // after the options only what the first post's re-seed changed goes again (a chain, a Serum's own FX), no tables
    const again = sent(t).filter(x => ['graph', 'patch', 'chain'].includes(x.t));
    assert.deepEqual(again.filter(x => x.t === 'graph' || (x.t === 'patch' && t.dev[x.i].model !== 'serum')).map(tag), [], k);
    assert.deepEqual(again.map(x => [(x.fxr || x.p.fxr).seed, 'fxrT' in x || 'fxrT' in (x.p || {})]), again.map(() => [0, false]), k);
  }
  const t = P().tracks.find(x => x.id === 'trk_c'), node = sim.nodeOf(t.id);
  let k = node.posted.length;
  t.dev.fx2.fx.racks[0].mods[0].p.on = 0; sim.api.sendPatch(t);
  assert.deepEqual(sent(t, k).map(tag), ['chain:fx2'], 'one panel edited: its chain only (tables unchanged: no fxrT)');
  assert.equal('fxrT' in sent(t, k)[0], false);
  k = node.posted.length;
  CMOD.setZone(t, 'i2', { lo: 60, hi: 127, xp: -12 }); sim.api.sendPatch(t);
  const z = sent(t, k);
  assert.deepEqual([z.map(tag), z[0].insts[1].zone], [['graph'], { lo: 60, hi: 127, xp: -12 }]);
  sim.run(2048); // (the engine of this branch takes the messages without error)
});

test('offline = live: a bounce of a graph-shaped track builds its node with the live node\'s graph and parts', async () => {
  await page();
  const t = P().tracks.find(x => x.id === 'trk_a'), live = sim.nodeOf(t.id).po;
  t.notes.push({ id: 'n1', t: 0, d: 480, n: 60, v: 100 });
  for (const x of P().tracks) x.mute = x !== t;
  P().bars = 1;
  Object.assign(sim.$('#bRange'), { value: 'song' }); Object.assign(sim.$('#bSr'), { value: String(sim.ctx().sampleRate) }); Object.assign(sim.$('#bBits'), { value: '32' });
  Object.assign(sim.$('#bTail'), { value: '0' }); Object.assign(sim.$('#bNorm'), { checked: false }); Object.assign(sim.$('#bOs'), { value: '4' });
  const before = sim.lastOffline;
  await sim.$('#bGo').onclick();
  for (let i = 0; i < 400 && sim.lastOffline === before; i++) await sim.settle(10);
  assert.notEqual(sim.lastOffline, before, 'rendered');
  const off = sim.lastOffline.nodes.map(n => n.po).find(po => po.trackId === t.id);
  assert.ok(off, 'the track\'s offline node');
  assert.deepEqual([off.offline, off.patch, off.graph], [true, null, live.graph], 'the same graph (ids, edges, zones, salts, key)');
  assert.deepEqual([Object.keys(off.patches), Object.keys(off.chains)], [Object.keys(live.patches), Object.keys(live.chains)]);
  const o = sim.api.offParts(t, sim.ctx().sampleRate);
  assert.deepEqual(off.patches.i2, o.patches.i2, 'offline parts: buildInstPatch offline (no caps)');
  assert.deepEqual(off.chains.fx1.fxr, o.chains.fx1.fxr);
  for (const x of P().tracks) x.mute = false;
  t.notes.length = 0;
});

test('monitors per device: part ids resolved per node (legacy i0 / c0, graphed device ids), smon routed by i / c', async () => {
  await page();
  const M = sim.api.monitors, a = P().tracks.find(x => x.id === 'trk_a'), b = P().tracks.find(x => x.id === 'trk_b'), leg = P().tracks[0];
  const got = [], mon = t => sim.nodeOf(t.id).posted.map(x => x.m).filter(m => m.t === 'mon').pop();
  const offs = [
    M.sub(a.id, 'i2', { role: 'inst', live: () => true, deliver: d => got.push('a.i2:' + tag(d)) }),
    M.sub(a.id, 'fx1', { role: 'fx', live: () => true, deliver: d => got.push('a.fx1:' + tag(d)) }),
    M.sub(b.id, 'i1', { role: 'both', live: () => true, deliver: d => got.push('b.i1:' + tag(d)) }),
    M.sub(b.id, 'i1', { role: 'fx', live: () => true, deliver: d => got.push('b.i1fx:' + tag(d)) }),
    M.sub(leg.id, 'i1', { role: 'both', live: () => true, deliver: d => got.push('leg:' + tag(d)) }),
  ];
  assert.deepEqual([mon(a).ids, mon(b).ids, mon(leg).ids], [['fx1', 'i2'], ['i1'], ['c0', 'i0']], '(a Serum: its Inst part alone, review H5)');
  got.length = 0; // (the engine's own snapshots so far)
  assert.deepEqual([sim.api.partsOf(a, N(a), 'i1', 'both'), sim.api.partsOf(a, N(a), 'fx1', 'inst'), sim.api.partsOf(leg, N(leg), 'i1', 'fx')], [['i1', 'fx1'], [], ['c0']]);
  for (const [t, d] of [[a, { t: 'smon', i: 'i2', s: {} }], [a, { t: 'smon', c: 'fx1', gr: [1] }], [a, { t: 'smon', i: 'i1', s: {} }],
    [b, { t: 'smon', i: 'i1', s: {}, gr: [2] }], [b, { t: 'smon', c: 'i1/fx', gr: [2] }], [leg, { t: 'smon', s: {} }]]) sim.nodeOf(t.id)._fromProc(d);
  // (a stray {c: 'i1/fx'} — never asked for now — reaches nobody: the Serum's subscriptions get its {i} message once each)
  assert.deepEqual(got, ['a.i2:smon:i2', 'a.fx1:smon:fx1', 'b.i1:smon:i1', 'b.i1fx:smon:i1', 'leg:smon']);
  assert.deepEqual([M.fx(a.id, 'fx1'), M.fx(b.id), M.fx(leg.id)], [true, true, true]);
  for (const off of offs) off();
  assert.deepEqual([mon(a).ids, mon(leg).ids], [[], []]);
});

test('module CPU: legacy i0 / c0 → the primary and its FX module keys, graphed part ids are the keys; the safeguard lowers the heaviest Inst', async () => {
  await page();
  const a = P().tracks.find(x => x.id === 'trk_a'), b = P().tracks.find(x => x.id === 'trk_b'), leg = P().tracks[0];
  sim.nodeOf(leg.id)._fromProc({ t: 'stats', load: 0.01, voices: 0, per: [{ id: 'i0', load: 0.004 }, { id: 'c0', load: 0.001 }] });
  sim.nodeOf(a.id)._fromProc({ t: 'stats', load: 0.9, voices: 2, per: [{ id: 'i1', load: 0.2 }, { id: 'i2', load: 0.6 }, { id: 'fx1', load: 0.1 }] });
  sim.nodeOf(b.id)._fromProc({ t: 'stats', load: 0.01, voices: 0, per: [{ id: 'i1', load: 0.005 }, { id: 'i1/fx', load: 0.001 }, { id: 'i2', load: 0 }, { id: 'fx1', load: 0.002 }] });
  assert.deepEqual([Object.keys(N(leg).cpu), Object.keys(N(a).cpu), Object.keys(N(b).cpu)], [['i1', 'fx1'], ['i1', 'i2', 'fx1'], ['i1', 'i1/fx', 'i2', 'fx1']]);
  const cpuKeyOfSerum = (() => { const s = { dev: { i1: { kind: 'synth', model: 'serum' }, out: { kind: 'out' } }, prim: 'i1', wires: [] }; return CMOD.fxDevOf(s).own ? 'i1/fx' : null; })();
  assert.equal(cpuKeyOfSerum, 'i1/fx');
  // the safeguard: the busiest track is graphed → its heaviest classic Inst alone, {t: 'os', i, v}, session only
  const os0 = sim.api.settings().os, k = sim.nodeOf(a.id).posted.length;
  assert.equal(sim.api.capsOf(a, 'i2'), null);
  sim.api.lowerOS();
  const m = sim.nodeOf(a.id).posted.slice(k).map(x => x.m).filter(x => x.t === 'os');
  assert.deepEqual(m, [{ t: 'os', v: os0 / 2, i: 'i2' }]);
  assert.deepEqual([sim.api.settings().os, sim.api.capsOf(a, 'i2'), sim.api.capsOf(a, 'i1')], [os0, `OS ${os0}→${os0 / 2}`, null]);
  const k2 = sim.nodeOf(a.id).posted.length;
  sim.api.liftCaps(); // (a quality choice lifts every step: the Inst goes back up)
  assert.deepEqual(sim.nodeOf(a.id).posted.slice(k2).map(x => x.m).filter(x => x.t === 'os'), [{ t: 'os', v: os0, i: 'i2' }]);
  assert.equal(sim.api.capsOf(a, 'i2'), null);
});

test('messages name their device on graphed nodes only: postTo, the 303 per device, audition, FX taps, MIDI learn per Serum', async () => {
  await page();
  const a = P().tracks.find(x => x.id === 'trk_a'), b = P().tracks.find(x => x.id === 'trk_b'), leg = P().tracks[0];
  const last = t => sim.nodeOf(t.id).posted[sim.nodeOf(t.id).posted.length - 1].m;
  sim.api.postTo(leg, { t: 'seqcmd', cmd: 'x' }, 'i1'); assert.deepEqual(last(leg), { t: 'seqcmd', cmd: 'x' }, 'legacy: never i / c');
  sim.api.postTo(a, { t: 'seqcmd', cmd: 'x' }, 'i2'); assert.deepEqual(last(a), { t: 'seqcmd', cmd: 'x', i: 'i2' });
  sim.api.postTo(a, { t: 'fxtap', id: 'e1' }, 'fx1'); assert.deepEqual(last(a), { t: 'fxtap', id: 'e1', c: 'fx1' });
  sim.api.postTo(b, { t: 'fxtap', id: 'e1' }, 'i1/fx'); assert.deepEqual(last(b), { t: 'fxtap', id: 'e1', i: 'i1' });
  sim.api.postTo(a, { t: 'on', n: 60, v: 1 }, 'i2', true); assert.deepEqual(last(a), { t: 'on', n: 60, v: 1, i: 'i2', aud: 1 });
  const H = sim.api.sxHost(b, 'i1');
  H.audition.on(62, 0.5); assert.deepEqual(last(b), { t: 'on', n: 62, v: 0.5, i: 'i1', aud: 1 });
  H.audition.off(62);
  H.seqCmd('stop'); assert.deepEqual(last(b), { t: 'seqcmd', cmd: 'stop', arg: undefined, i: 'i1' });
  assert.equal(H.dev, 'i1');
  // a TB-303 beside the Juno: its own pattern, sequencer message and run state
  const i3 = CMOD.addInst(a, 'tb303', { vals: vals('tb303') }), k3 = sim.nodeOf(a.id).posted.length;
  sim.api.sendPatch(a);
  const add = sim.nodeOf(a.id).posted.slice(k3).map(x => x.m);
  assert.deepEqual(add.map(tag), ['graph', 'patch:' + i3, 'seq:' + i3], 'a new 303 Inst: graph, its patch, its pattern');
  assert.equal(add[2].s.pat.length, 16);
  const q = sim.api.seqOf(a, i3);
  assert.equal(q === a.dev[i3].seq && q !== sim.api.seqOf(a), true, 'per device (the primary: its own)');
  sim.api.seqSend(a, i3, { run: true });
  assert.deepEqual([last(a).t, last(a).i, last(a).s.run], ['seq', i3, true]);
  sim.api.seqRun.add(a.id + '/' + i3);
  assert.deepEqual([sim.api.seqRun.has(a.id + '/' + i3), sim.api.seqRun.has(a.id)], [true, false], 'a bare track id: its primary');
  sim.api.seqRun.delete(a.id);
  assert.equal(sim.api.seqRun.has(a.id + '/' + i3), false, 'delete(trackId): every 303 of the track');
  // MIDI learn per Serum instrument: the map lives in that instrument's state
  const t = P().tracks.find(x => x.id === 'trk_b'), s = t.dev.i1.vals.s;
  t.arm = true; // (a learned controller reaches the tracks the channel targets)
  const done = sim.api.midi.learn(t.id, 'i1', 'a.wt');
  sim.api.midi.message(Uint8Array.from([0xb0, 21, 64]), 0);
  assert.equal(await done, 21);
  assert.equal(s.midi['21'], 'a.wt');
  sim.api.midi.message(Uint8Array.from([0xb0, 21, 127]), 0);
  assert.equal(s.p['a.wt'] > 0.99, true, 'the learned controller writes that state');
  t.arm = false;
});

test('render-last of one Serum instrument of a track (o.dev): rendered alone through its own FX (buildInstPatch offline)', async () => {
  await page();
  const core = await import('../serum-core.js?v=9');
  const a = P().tracks.find(x => x.id === 'trk_a'), api = sim.api;
  const sx = CMOD.addInst(a, 'serum', { vals: { s: core.normalizeSerum(core.defaultSerum()) } });
  api.sendPatch(a); api.selectTrack(a.id);
  const T0 = 2e6;
  api.noteOn(60, 100 / 127, 0, T0); api.noteOff(60, 0, T0 + 250);
  await assert.rejects(api.renderLast(a, { dev: 'i1' }), /Serum/, 'a classic instrument');
  const r = await api.renderLast(a, { dev: sx });
  assert.match(r.name, / C4\.wav$/);
  const po = sim.lastOffline.nodes[0].po, sr = sim.lastOffline.ctx.sampleRate;
  assert.deepEqual([po.offline, 'graph' in po, po.trackId], [true, false, a.id]);
  assert.deepEqual(po.patch, api.buildInstPatch(a, sx, sr, true), 'that Serum and its own FX, offline');
  CMOD.removeInst(a, sx); api.sendPatch(a);
});

/* ---------------------------------------------------- host fixes (the stage-1e review round: findings H1–H13) */
const devs = t => Object.keys(t.dev).sort().join(','), cables = t => t.wires.map(w => w.a + '>' + w.b).sort().join(' ');
const byId = id => P().tracks.find(x => x.id === id);
const lastGraph = t => sent(t).filter(m => m.t === 'graph').pop() || null;

test('H4: a classic primary cabled straight to OUT has no rack — a patch, t.fx read / written, a save, undo / redo insert no panel', async () => {
  await page();
  const core = await import('../serum-core.js?v=9');
  const t = addJuno(), S0 = clone(P());
  assert.equal(CMOD.removePanel(t, 'fx1').ok, true);
  assert.deepEqual([devs(t), cables(t)], ['i1,out', 'i1.out>out.in']);
  sim.api.sendPatch(t); sim.api.buildPatch(t);
  assert.deepEqual([devs(t), cables(t)], ['i1,out', 'i1.out>out.in'], 'a patch (buildPatch fxOf)');
  assert.equal(t.fx, undefined);
  t.fx = core.defaultFx2();
  assert.deepEqual([devs(t), cables(t)], ['i1,out', 'i1.out>out.in'], 't.fx = … without an FX device: nothing');
  const was = globalThis.confirm; globalThis.confirm = () => true;
  try { await globalThis.__synthTest.cv.classicFile(); } finally { globalThis.confirm = was; }
  assert.deepEqual([devs(byId(t.id)), cables(byId(t.id))], ['i1,out', 'i1.out>out.in'], 'a save (projectFile)');
  const S1 = clone(P());
  sim.api.applyRestore(S0, true); // (undo of the Delete panel)
  assert.deepEqual([devs(byId(t.id)), cables(byId(t.id))], ['fx1,i1,out', 'fx1.out>out.in i1.out>fx1.in']);
  sim.api.applyRestore(S1, true); // (its redo)
  const r = byId(t.id);
  assert.deepEqual([devs(r), cables(r)], ['i1,out', 'i1.out>out.in'], 'redo: no panel re-inserted');
});

test('H1: undo / redo keep the sound per device id — a re-patch, Make primary, Delete of a primary never copy one device\'s state into another', async () => {
  await page();
  const core = await import('../serum-core.js?v=9');
  // Juno → fx1 (chorus); fx2 (delay) → OUT; the primary re-patched into fx2, undone
  let t = addJuno();
  core.newInstance(t.dev.fx1.fx, 'cho', { rack: 0 });
  const fx2 = CMOD.addPanel(t, {}); core.newInstance(t.dev[fx2].fx, 'dly', { rack: 0 });
  CMOD.connect(t, fx2 + '.out', 'out.in'); sim.api.sendPatch(t);
  const types = x => ['fx1', fx2].map(k => x.dev[k].fx.racks[0].mods.map(m => m.type).join(',')).join(' | ');
  let snap = clone(P());
  assert.equal(CMOD.connect(t, 'i1.out', fx2 + '.in').ok, true); sim.api.sendPatch(t);
  sim.api.applyRestore(snap, true);
  t = byId(t.id);
  assert.deepEqual([types(t), t.dev.fx1.fx === t.dev[fx2].fx, CMOD.destOf(t, 'i1')], ['cho | dly', false, 'fx1'], 're-patch undone');
  // two Junos: Make primary i2, undone — i1 keeps its own values
  const i2 = CMOD.addInst(t, 'juno60', { vals: Object.assign(vals('juno60'), { lr: 8 }) });
  t.dev.i1.vals.lr = 5; sim.api.sendPatch(t);
  snap = clone(P());
  CMOD.makePrimary(t, i2); sim.api.sendPatch(t);
  sim.api.applyRestore(snap, true);
  t = byId(t.id);
  assert.deepEqual([t.prim, t.dev.i1.vals.lr, t.dev[i2].vals.lr, t.dev.i1.vals === t.dev[i2].vals], ['i1', 5, 8, false], 'Make primary undone');
  // Delete of the primary (the other Juno becomes primary), undone
  snap = clone(P());
  assert.equal(CMOD.removeInst(t, 'i1').ok, true); sim.api.sendPatch(t);
  t.dev[i2].vals.lr = 9; // (a knob tweak after the delete: kept by the undo)
  sim.api.applyRestore(snap, true);
  t = byId(t.id);
  assert.deepEqual([t.prim, t.dev.i1.vals.lr, t.dev[i2].vals.lr], ['i1', 5, 9], 'Delete of a primary undone');
  // (regression) a one-instrument track's rack across a model change is still kept (stage 1c: classic → Serum moves it into
  // the Serum, an effect added there, the undo brings it back to the panel; the redo to the Serum)
  let u = addJuno();
  core.newInstance(u.fx, 'cho', { rack: 0 });
  const s0 = clone(P());
  CMOD.setModel(u, 'i1', 'serum', { vals: { s: core.normalizeSerum(core.defaultSerum()) } }); sim.api.sendPatch(u);
  assert.deepEqual([devs(u), CMOD.fxDevOf(u).own], ['i1,out', true]);
  core.newInstance(u.fx, 'eq', { rack: 0 });
  const s1 = clone(P());
  sim.api.applyRestore(s0, true);
  u = byId(u.id);
  assert.deepEqual([devs(u), u.fx.racks[0].mods.map(m => m.type).join(',')], ['fx1,i1,out', 'cho,eq'], 'undo: the panel holds the rack as edited');
  sim.api.applyRestore(s1, true);
  u = byId(u.id);
  assert.deepEqual([devs(u), u.fx.racks[0].mods.map(m => m.type).join(',')], ['i1,out', 'cho,eq']);
});

const rec = (id, o) => Object.assign({ id, name: id, color: '#e8a23a', ch: 0, mute: false, solo: false, arm: false, vol: 0.8, pan: 0, notes: [], cc: [] }, o);
const pat = n => ({ pat: Array.from({ length: 16 }, () => ({ n, o: 0, a: 0, s: 0, g: 1 })), bpm: 120, swing: 0, sync: false });
test('H2: the legacy stream is for one-instrument tracks only — a second instrument off, the primary off, a panel of its own: a graphed node, device messages name their device', async () => {
  await page();
  const core = await import('../serum-core.js?v=9'), p = clone(P());
  p.tracks.push(rec('trk_h2a', { prim: 'i1', nid: 3, dev: { // two TB-303s, the second off with its own pattern
    i1: { kind: 'synth', model: 'tb303', vals: vals('tb303'), preset: null, seq: pat(0) },
    i2: { kind: 'synth', model: 'tb303', vals: vals('tb303'), preset: null, on: false, seq: pat(5) },
    fx1: { kind: 'panel', fx: core.defaultFx2() }, out: { kind: 'out' } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }, { id: 'w3', a: 'i2.out', b: 'fx1.in' }] }));
  p.tracks.push(rec('trk_h2b', { prim: 'i1', nid: 3, dev: { // the primary off, a Serum sounding
    i1: { kind: 'synth', model: 'juno60', vals: vals('juno60'), preset: null, on: false },
    i2: { kind: 'synth', model: 'serum', vals: { s: core.normalizeSerum(core.defaultSerum()) }, preset: null, fx: core.defaultFx2() },
    out: { kind: 'out' } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }, { id: 'w2', a: 'i2.out', b: 'out.in' }] }));
  sim.api.applyRestore(p); sim.raf(); await sim.settle(5);
  const x = byId('trk_h2a'), y = byId('trk_h2b'), last = t => sim.nodeOf(t.id).posted[sim.nodeOf(t.id).posted.length - 1].m;
  assert.deepEqual([CG.compileTrack(x).canonical, CG.compileTrack(y).canonical, CG.compileTrack(y).inst], [true, true, 'i2'], '(one instrument sounds)');
  for (const t of [x, y]) assert.deepEqual([N(t).graphed, sim.nodeOf(t.id).po.patch, 'graph' in sim.nodeOf(t.id).po], [true, null, true], t.id + ': built graphed');
  sim.api.seqSend(x, 'i2', { run: true });
  assert.deepEqual([last(x).t, last(x).i, last(x).s.pat[0].n], ['seq', 'i2', 5], 'the 303 that is off: its own pattern, to it');
  sim.api.sxHost(y, 'i2').audition.on(60, 0.5);
  assert.deepEqual([last(y).t, last(y).i, last(y).aud], ['on', 'i2', 1]);
  sim.api.sxHost(y, 'i2').audition.off(60);
  // a one-instrument track with an unconnected panel beside its own (the Effects tray's new panel): graphed on its next post
  const z = addJuno(), k = sim.nodeOf(z.id).posted.length;
  const fx2 = CMOD.addPanel(z, {}); sim.api.sendPatch(z);
  assert.deepEqual([N(z).graphed, tag(sent(z, k)[0]), lastGraph(z).chains.map(c => c.id).sort()], [true, 'graph', ['fx1', fx2]]);
});

test('H3: a key zone on a one-instrument track reaches the engine — the graph protocol live and offline', async () => {
  await page();
  const t = addJuno(), k = sim.nodeOf(t.id).posted.length;
  CMOD.setZone(t, 'i1', { lo: 48, hi: 72, xp: 12 }); sim.api.sendPatch(t);
  const m = sent(t, k);
  assert.deepEqual([m.length > 0 && m[0].t, N(t).graphed, lastGraph(t) && lastGraph(t).insts[0].zone], ['graph', true, { lo: 48, hi: 72, xp: 12 }]);
  const o = sim.api.offParts(t, sim.ctx().sampleRate);
  assert.deepEqual([o.patch, o.graph && o.graph.insts[0].zone], [null, { lo: 48, hi: 72, xp: 12 }], 'a bounce: the same graph');
});

test('H5: a Serum\'s monitor is its Inst part alone (its message carries its own FX meters) — every message a Serum panel gets has its snapshot', async () => {
  await page();
  const b = P().tracks.find(x => x.id === 'trk_b'), M = sim.api.monitors, got = [];
  assert.deepEqual([sim.api.partsOf(b, N(b), 'i1', 'both'), sim.api.partsOf(b, N(b), 'i1', 'fx'), sim.api.partsOf(b, N(b), 'i1', 'inst')], [['i1'], ['i1'], ['i1']]);
  const off = M.sub(b.id, 'i1', { role: 'both', live: () => true, deliver: d => got.push(d) });
  const mon = sim.nodeOf(b.id).posted.map(x => x.m).filter(m => m.t === 'mon').pop();
  assert.deepEqual(mon.ids, ['i1']);
  sim.run(8192);
  off();
  assert.equal(got.length > 0, true, 'snapshots arrive');
  assert.deepEqual(got.map(d => (d.s ? 's' : 'none') + ':' + d.i + ':' + ('gr' in d)), got.map(() => 's:i1:true'), 'never a message without the snapshot; its FX meters in it');
});

test('H6: Duplicate track copies every device, cable and per-instrument field — a canonical track with an instrument off, a named primary, no panel', async () => {
  await page();
  const dup = t => { const n = P().tracks.length; globalThis.__synthTest.cv.duplicateTrack(t); sim.raf(); assert.equal(P().tracks.length, n + 1); return P().tracks[P().tracks.indexOf(byId(t.id)) + 1]; };
  const t = addJuno(), i2 = CMOD.addInst(t, 'tb303', { vals: vals('tb303') });
  CMOD.setPower(t, i2, false); t.dev.i1.name = 'Lead'; t.dev[i2].seq = pat(7); sim.api.sendPatch(t);
  assert.equal(CG.compileTrack(t).canonical, true, '(canonical: one instrument sounds)');
  const c = dup(t);
  assert.deepEqual([devs(c), cables(c), c.prim, c.dev.i1.name, c.dev[i2].on, c.dev[i2].seq.pat[0].n, c.nid], [devs(t), cables(t), 'i1', 'Lead', false, 7, t.nid]);
  assert.equal(c.dev.i1.vals !== t.dev.i1.vals && c.dev.fx1.fx !== t.dev.fx1.fx, true, 'copies, not shared objects');
  // a classic primary cabled straight to OUT: the copy has no panel either
  const u = addJuno(); CMOD.removePanel(u, 'fx1'); sim.api.sendPatch(u);
  const cu = dup(u);
  assert.deepEqual([devs(cu), cables(cu), devs(u)], ['i1,out', 'i1.out>out.in', 'i1,out']);
});
