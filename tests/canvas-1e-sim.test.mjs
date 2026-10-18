import './v8-guard.mjs';
// Stage 1e on the canvas (lane C2, docs/canvas/IMPL-1e.md §4.5) in the page simulation: several instruments on one track —
// a Sources drop on empty canvas adds one (the node gets {t: 'graph'} + {t: 'patch', i} + {t: 'chain'}, one undo step),
// a tap in replace mode replaces the current instrument only, cables connect / re-patch / disconnect through the view's
// API (track.wires, a new graph, the own-fx refusal and its "Make a shared panel" fix), ⏻ posts {t: 'power'} and dims
// the module, key zones compile into the graph, the Effects tray adds panels and effects, Make primary moves #inst, the
// last instrument cannot be deleted, the "not connected – silent" badge, the CPU of each device from stats.per, a Serum
// panel's monitor per device, Save as classic project lists what it loses; undo / redo of each.
// The world is canvas-sim's scripted one. One boot per file; strings, numbers and booleans only into assert (never a
// stub DOM node). Run alone: node --max-old-space-size=2048 --test tests/canvas-1e-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CG from '../cv-graph.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import { MODELS } from '../models.js?v=9';

const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), log: [], selected: null,
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem() {}, dragPointer() {},
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, W = cv.world();
await sim.power(); sim.raf(); await sim.settle(20); sim.raf();
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const hsteps = () => cv.hist.u.length;
const keys = () => [...V().modules.keys()].sort().join(',');
const ID = {}; // device ids made by one test, read by the next (ids are never reused: track.nid)
const insts = (t = T()) => CMOD.instIds(t).map(id => id + ':' + t.dev[id].model).join(',');
const posted = (t = T()) => sim.nodeOf(t.id).posted.length;
const sent = (t, from) => sim.nodeOf(t.id).posted.slice(from).map(x => x.m).filter(m => !['mon', 'smon', 'fxph', 'transport', 'song'].includes(m.t));
const tag = m => m.t + (m.i !== undefined ? ':' + m.i : '') + (m.c !== undefined ? ':' + m.c : '');
const tags = (t, from) => sent(t, from).map(tag);
const lastGraph = t => { const g = sent(t, 0).filter(m => m.t === 'graph'); return g[g.length - 1] || null; };
const note = () => sim.$('#notice').textContent;
const bodyOf = k => V().modules.get(k).body;

test('a Sources drop on empty canvas adds an instrument where it lands: auto-patched into the shared panel, the node gets graph + patch i + chain, its own body and ClassicPanel, the current one, one undo step and the notice', () => {
  const t = T(), n0 = hsteps(), k0 = posted(t);
  assert.deepEqual([insts(t), keys()], ['i1:minimoog', 'fx1,i1,out']);
  assert.equal(sh.srcDrag.drop('juno60', { over: 'canvas', x: 700, y: 1300 }), true, 'no top bar under it: an add');
  sim.raf();
  assert.deepEqual([insts(t), keys(), hsteps(), cv.hist.undoLabel], ['i1:minimoog,i2:juno60', 'fx1,i1,i2,out', n0 + 1, 'Add Juno-60']);
  assert.deepEqual(t.wires.map(w => w.a + '>' + w.b).sort(), ['fx1.out>out.in', 'i1.out>fx1.in', 'i2.out>fx1.in'], 'into the panel the instruments share');
  const at = W.toWorld(700, 1300);
  assert.deepEqual([t.lay.i2.x, t.lay.i2.y], [Math.round((at.x - 160) / 32) * 32, Math.round((at.y - 20) / 32) * 32], 'where it was dropped (its bar under the pointer, on the dots)');
  assert.deepEqual([t.lay.i1 && t.lay.i1.x, t.lay.fx1 && t.lay.fx1.x], [V().modules.get('i1').x, V().modules.get('fx1').x], 'the Tidy-placed modules pinned where they stood');
  const m = tags(t, k0);
  assert.deepEqual([m[0], m.includes('patch:i2'), m.includes('patch:i1'), m.includes('chain:fx1')], ['graph', true, true, true], m.join(' '));
  assert.deepEqual(lastGraph(t).insts.map(x => x.id + (x.on ? '' : ':off')), ['i1', 'i2']);
  assert.equal(api.nodes.get(t.id).graphed, true);
  assert.deepEqual([cv.parts.inst.parentNode === bodyOf('i1'), cv.bodyEl('i2').parentNode === bodyOf('i2'), cv.bodyEl('i2') === cv.parts.inst],
    [true, true, false], '#inst in the primary, its own element in the new one');
  const cp = cv.classicPanels.get(t.id + '/i2');
  assert.deepEqual([!!cp, cp && cp.model.id, cp && cp.root === cv.bodyEl('i2'), cp && cp.track.id], [true, 'juno60', true, t.id + '/i2'], 'a ClassicPanel of the Juno-60 in its body');
  assert.deepEqual([cv.cur(), cv.panel() === cp, sim.$('#trkChip .cv-cv').textContent], ['i2', true, '2 instruments'], 'the current instrument; the chip says how many');
  assert.equal(note(), 'Added Juno-60 · tap to undo');
  // undo / redo: the instrument and its module go and come back
  cv.undo(); sim.raf();
  assert.deepEqual([insts(), keys(), cv.classicPanels.has(t.id + '/i2'), cv.cur()], ['i1:minimoog', 'fx1,i1,out', false, 'i1']);
  cv.redo(); sim.raf();
  assert.deepEqual([insts(), keys(), cv.classicPanels.has(T().id + '/i2')], ['i1:minimoog,i2:juno60', 'fx1,i1,i2,out', true]);
  // the notice's tap: undone while it is the newest step
  cv.undo(); sim.raf(); cv.redo(); sim.raf();
  assert.equal(sh.srcDrag.drop('dx7', { over: 'canvas', x: 400, y: 1900 }), true); sim.raf();
  assert.match(insts(), /^i1:minimoog,i2:juno60,i\d+:dx7$/);
  sim.$('#notice').onclick(); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60', 'the tap undid the add');
});

test('a tap in replace mode replaces the current instrument only (its kept-FX rules); a drop on an instrument\'s top bar replaces that one', () => {
  const t = T(), n0 = hsteps();
  cv.setCur('i2');
  sh.srcPick('prophet5', 'replace'); sim.raf();
  assert.deepEqual([insts(), hsteps(), note()], ['i1:minimoog,i2:prophet5', n0 + 1, 'Replaced Juno-60 with Prophet-5 · tap to undo']);
  assert.equal(cv.classicPanels.get(t.id + '/i2').model.id, 'prophet5', 'its panel re-rendered');
  sim.$('#notice').onclick(); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60', 'the notice undoes it');
  // onto the primary's bar: the Minimoog is replaced, the Juno-60 stays
  assert.equal(sh.srcDrag.drop('obxa', { over: 'canvas', target: V().modules.get('i1').bar }), true); sim.raf();
  assert.deepEqual([insts(), T().model], ['i1:obxa,i2:juno60', 'obxa']);
  cv.undo(); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60');
});

test('cables: connect / re-patch / disconnect through the view API change track.wires and post a new graph, one History step each; refusals in #notice; the badge', () => {
  const t = T();
  const pid = cv.fx.addPanel({ x: 1600, y: 900 }, null); sim.raf();
  assert.deepEqual([t.dev[pid].kind, keys(), t.wires.some(w => w.a === pid + '.out' && w.b === 'out.in')], ['panel', ['fx1', pid, 'i1', 'i2', 'out'].sort().join(','), true], 'a new panel cabled to OUT');
  let n = hsteps(), k = posted(t);
  const wid = t.wires.find(w => w.a === 'i2.out').id;
  assert.deepEqual(cv.cable.can('i2.out', pid + '.in'), { ok: true, why: '' });
  assert.equal(cv.cable.repatch(wid, 'i2.out', pid + '.in'), true); sim.raf();
  assert.deepEqual([t.wires.find(w => w.a === 'i2.out').b, t.wires.find(w => w.a === 'i2.out').id, hsteps(), cv.hist.undoLabel], [pid + '.in', wid, n + 1, 'Re-patch Juno-60 → FX Panel ' + CG.devNum(pid)], 'the same cable, its end moved');
  assert.deepEqual(lastGraph(t).edges.filter(e => e[0] === 'i2'), [['i2', pid, 1]]);
  assert.ok(tags(t, k).includes('graph'));
  // disconnect: silent, the badge says so
  n = hsteps(); k = posted(t);
  assert.equal(cv.cable.disconnect(wid), true); sim.raf();
  assert.deepEqual([t.wires.some(w => w.a === 'i2.out'), hsteps(), cv.badge('i2'), V().modules.get('i2').badge], [false, n + 1, 'not connected – silent', 'not connected – silent']);
  assert.ok(tags(t, k).includes('graph'));
  assert.equal(V().modules.get('i1').badge, null, 'a cabled instrument: no badge');
  // connect it back
  assert.equal(cv.cable.connect('i2.out', 'fx1.in'), true); sim.raf();
  assert.deepEqual([t.wires.find(w => w.a === 'i2.out').b, V().modules.get('i2').badge], ['fx1.in', null]);
  // refused: panel → panel (a later stage), nothing recorded
  n = hsteps();
  assert.equal(cv.cable.connect('fx1.out', pid + '.in'), false);
  assert.deepEqual([hsteps(), /later stage/.test(note())], [n, true], note());
  // undo walks the cable edits back
  cv.undo(); sim.raf();
  assert.equal(T().wires.some(w => w.a === 'i2.out'), false, 'undo: disconnected again');
  cv.undo(); sim.raf();
  assert.equal(T().wires.find(w => w.a === 'i2.out').b, pid + '.in', 'undo: the re-patch');
  cv.undo(); sim.raf();
  assert.equal(T().wires.find(w => w.a === 'i2.out').b, 'fx1.in', 'undo: as before');
  cv.redo(); cv.redo(); cv.redo(); sim.raf();
  assert.equal(T().wires.find(w => w.a === 'i2.out').b, 'fx1.in', 'redo: connected back');
});

test('a Serum\'s own FX take only that Serum: the refusal offers "Make a shared panel" — one tap puts a panel after the Serum and cables both into it', () => {
  const t = T();
  const id = cv.add('serum', { x: 0, y: 2400 }); sim.raf();
  assert.deepEqual([T().dev[id].model, keys().includes(id + '/fx')], ['serum', true], 'a Serum with its own FX module');
  ID.sx = id;
  assert.equal(cv.cable.port(id + '/fx.in'), id + '.in', 'its own FX input stands for the Serum (the refusal and its fix)');
  const n = hsteps();
  assert.deepEqual(cv.cable.can('i2.out', id + '.in').ok, false);
  assert.equal(cv.cable.connect('i2.out', id + '.in'), false);
  assert.match(note(), /own FX take only that Serum · Make a shared panel/);
  assert.equal(hsteps(), n, 'refused: no step');
  sim.$('#notice').onclick(); sim.raf();
  const dst = t.wires.find(w => w.a === id + '.out').b.split('.')[0];
  assert.deepEqual([t.dev[dst] && t.dev[dst].kind, t.wires.find(w => w.a === 'i2.out').b, hsteps(), cv.hist.undoLabel], ['panel', dst + '.in', n + 1, 'Make a shared panel']);
  cv.undo(); sim.raf();
  assert.deepEqual([T().wires.find(w => w.a === id + '.out').b, T().wires.find(w => w.a === 'i2.out').b], ['fx1.in', 'fx1.in'], 'undo');
});

test('⏻: power off posts {t: power, i, on: false} after the graph and dims the module (its cables grey); on again; one step each; Solo in track', () => {
  const t = T(), m = () => V().modules.get('i2');
  let k = posted(t), n = hsteps();
  const pow = m().bar.children[0];
  pow.dispatchEvent({ type: 'click', target: pow, stopPropagation() {}, preventDefault() {} }); sim.raf();
  assert.deepEqual([t.dev.i2.on, m().el.hasAttribute('data-off'), m().on, hsteps(), cv.hist.undoLabel], [false, true, false, n + 1, 'Power off Juno-60']);
  const s = sent(t, k), p = s.find(x => x.t === 'power');
  assert.deepEqual([s.findIndex(x => x.t === 'graph') < s.findIndex(x => x.t === 'power'), p && p.i, p && p.on], [true, 'i2', false]);
  assert.equal(lastGraph(t).insts.find(x => x.id === 'i2').on, false);
  assert.equal(V().cables.list().filter(c => c.a === 'i2/fx.out' || c.a === 'i2.out').every(c => c.dim), true, 'its cable grey');
  k = posted(t);
  cv.undo(); sim.raf();
  assert.deepEqual([T().dev.i2.on, m().el.hasAttribute('data-off')], [undefined, false], 'undo: on');
  assert.ok(sent(T(), k).some(x => x.t === 'power' && x.i === 'i2' && x.on === true));
  cv.redo(); sim.raf();
  assert.equal(m().el.hasAttribute('data-off'), true, 'redo: off');
  cv.power('i2', true); sim.raf();
  assert.equal(m().el.hasAttribute('data-off'), false);
  // solo in track: only the soloed instrument sounds
  cv.solo('i1'); sim.raf();
  assert.deepEqual([T().dev.i1.solo, CG.powered(T()).join(','), lastGraph(T()).insts.filter(x => x.on).map(x => x.id).join(',')], [true, 'i1', 'i1']);
  cv.undo(); sim.raf();
  assert.equal(CG.powered(T()).length, 3);
});

test('key zones compile into the graph (low / high / transpose); quick edits of one zone are one step; undo', () => {
  const t = T(), n = hsteps(), k = posted(t);
  cv.zone('i2', { lo: 48, hi: 71, xp: 0 });
  cv.zone('i2', { lo: 48, hi: 72, xp: 12 }); sim.raf();
  assert.deepEqual([t.dev.i2.zone, hsteps(), cv.hist.undoLabel], [{ lo: 48, hi: 72, xp: 12 }, n + 1, 'Key zone of Juno-60']);
  assert.deepEqual(lastGraph(t).insts.find(x => x.id === 'i2').zone, { lo: 48, hi: 72, xp: 12 });
  assert.ok(tags(t, k).includes('graph'));
  assert.deepEqual(V().modules.get('i2').zone, { lo: 48, hi: 72, xp: 12 }, 'the pill');
  cv.undo(); sim.raf();
  assert.deepEqual([T().dev.i2.zone, V().modules.get('i2').zone], [undefined, { lo: 0, hi: 127, xp: 0 }]);
});

test('Effects tray: its tiles (the panel, the rack\'s effects and splitters, a cost each); the panel tile and an effect onto empty canvas make panels (one step), an effect onto a panel goes into its rack', () => {
  const t = T(), tiles = cv.fx.tiles().tiles();
  assert.deepEqual([tiles.length, tiles[0].getAttribute('data-fx'), cv.fx.items.length], [17, 'panel', 16]);
  assert.match(cv.fx.tiles().tile('rev').children.find(c => c.className === 'cv-tcost').textContent, /%$/, 'a load estimate');
  let n = hsteps();
  assert.equal(cv.fx.drag.drop('panel', { over: 'canvas', at: { x: 2048, y: 1600 } }), true); sim.raf();
  const p1 = Object.keys(T().dev).filter(k => T().dev[k].kind === 'panel').pop();
  assert.deepEqual([hsteps(), T().lay[p1].x, T().lay[p1].y, T().wires.some(w => w.a === p1 + '.out' && w.b === 'out.in'), V().modules.has(p1)],
    [n + 1, 2016, 1568, true, true], 'an empty panel at the point, cabled to OUT');
  // an effect onto that panel: into its rack (the rack's "+": an FX edit, no History step), the chain posted
  n = hsteps();
  const k = posted(t);
  assert.equal(cv.fx.over({ closest: q => (/#viewport/.test(q) ? {} : null), getAttribute: () => null, parentNode: null }), 'canvas');
  assert.equal(cv.fx.drag.drop('dly', { over: 'panel', key: p1 }), true); sim.raf();
  const mods = () => T().dev[p1].fx.racks[0].mods.map(x => x.type).join(',');
  assert.deepEqual([mods(), hsteps(), /Added Delay to FX Panel/.test(note())], ['dly', n, true]);
  assert.ok(tags(t, k).includes('chain:' + p1), 'its chain');
  // an effect onto empty canvas: a new panel holding it
  n = hsteps();
  assert.equal(cv.fx.drag.drop('rev', { over: 'canvas', at: { x: 2048, y: 2400 } }), true); sim.raf();
  const p2 = Object.keys(T().dev).filter(k => T().dev[k].kind === 'panel').pop();
  assert.deepEqual([p2 !== p1, T().dev[p2].fx.racks[0].mods.map(x => x.type).join(','), hsteps()], [true, 'rev', n + 1]);
  cv.undo(); cv.undo(); sim.raf();
  assert.deepEqual([T().dev[p2], T().dev[p1]], [undefined, undefined], 'undo: both panels go');
  // a tap: into the current instrument's panel
  cv.setCur('i1');
  cv.fx.pick('cho'); sim.raf();
  assert.equal(T().dev.fx1.fx.racks[0].mods.some(x => x.type === 'cho'), true);
});

test('Make primary: graph.insts[0], #inst moves to its body (the view rebuilt), one step; undo', () => {
  const t = T(), n = hsteps();
  cv.primary('i2'); sim.raf();
  assert.deepEqual([T().prim, T().model, hsteps(), cv.hist.undoLabel, V().devices()[0].key], ['i2', 'juno60', n + 1, 'Make Juno-60 primary', 'i2']);
  assert.deepEqual([cv.parts.inst.parentNode === bodyOf('i2'), cv.bodyEl('i1').parentNode === bodyOf('i1'), cv.classicPanels.get(t.id + '/i1').root === cv.bodyEl('i1')], [true, true, true]);
  assert.equal(lastGraph(t).insts[0].id, 'i2');
  assert.equal(cv.menu('i2').find(x => x.label === 'Primary instrument').checked, true);
  cv.undo(); sim.raf();
  assert.deepEqual([T().prim, cv.parts.inst.parentNode === bodyOf('i1')], ['i1', true]);
});

test('Delete: refused for the last instrument (the reason in #notice, no step); another one goes in one step, undo brings its sound back; Duplicate', () => {
  const t = T(), n = hsteps();
  const d = cv.dup('i2'); sim.raf();
  assert.deepEqual([T().dev[d].model, T().wires.find(w => w.a === d + '.out').b, hsteps()], ['juno60', 'fx1.in', n + 1], 'its cable where the original\'s goes');
  assert.equal(cv.del(d), true); sim.raf();
  assert.deepEqual([T().dev[d], hsteps(), keys().includes(d)], [undefined, n + 2, false]);
  cv.undo(); sim.raf();
  assert.deepEqual([T().dev[d] && T().dev[d].model, keys().includes(d)], ['juno60', true], 'undo: back with its sound');
  cv.undo(); sim.raf();
  // a one-instrument track
  const one = api.addTrack(MODELS.find(m => m.id === 'juno60')); sim.raf();
  const m = hsteps();
  assert.equal(cv.del('i1'), false);
  assert.deepEqual([CMOD.instIds(one).length, hsteps(), /at least one instrument/.test(note())], [1, m, true]);
  cv.undo(); sim.raf(); // (the add)
  api.selectTrack(t.id); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60,' + ID.sx + ':serum');
});

test('module CPU per device from stats.per (each instrument, each panel; OUT none); a Serum panel\'s monitor per device', async () => {
  const t = T(), cpu = key => { const m = V().modules.get(key); return m ? (m.bar.children.find(c => c.className === 'cv-cpu') || {}).textContent : null; };
  sim.run(Math.round(sim.ctx().sampleRate * 0.6));
  assert.deepEqual(['i1', 'i2', 'fx1'].map(k => /%$/.test(cpu(k))), [true, true, true], ['i1', 'i2', 'fx1', 'out'].map(cpu).join(' '));
  assert.equal(cpu('out'), '');
  // the Serum's panel (a stand-in: the SerumUI does not load here) and its monitor: that device's parts
  const sx = ID.sx, r = cv.serumPanels.get(t.id + '/' + sx);
  assert.ok(r, 'a record of its own');
  let snaps = 0;
  r.ui = { refresh() {}, destroy() {}, setSnapshot() { snaps++; }, confirmChange: () => true, snap: null }; r.trackId = t.id; r.vals = t.dev[sx].vals;
  const mons = () => sim.nodeOf(t.id).posted.filter(x => x.m && x.m.t === 'mon').map(x => x.m.ids.join(','));
  api.sxHost(t, sx).monitor(true);
  assert.ok(mons().slice(-1)[0].split(',').includes(sx), mons().slice(-1)[0]);
  sim.run(Math.round(sim.ctx().sampleRate * 0.3));
  assert.ok(snaps > 0, 'its snapshots reach its panel');
  api.sxHost(t, sx).monitor(false);
  assert.equal(mons().slice(-1)[0].split(',').includes(sx), false);
  r.ui = null; r.trackId = null;
});

test('per instrument: Hardware / Simple of one instrument (its lay key, its own panel), About of it; Tidy lays out every device (one step); an Effects tap for an instrument without a panel cables it through a new one', () => {
  const t = T(), n = hsteps();
  const it = cv.menu('i2').find(x => x.label === 'Simple layout');
  it.action(); sim.raf();
  assert.deepEqual([T().lay.i2.ui, cv.instUi(T(), 'i2'), cv.instUi(T(), 'i1'), hsteps(), cv.hist.undoLabel], ['flow', 'flow', 'hw', n + 1, 'Simple layout']);
  assert.deepEqual([V().modules.get('i2').w, cv.classicPanels.get(t.id + '/i2').layout], [864, null], 'the Juno-60 in its Simple width, its panel re-rendered');
  cv.undo(); sim.raf();
  assert.equal(cv.instUi(T(), 'i2'), 'hw');
  cv.menu('i2').find(x => /^About the /.test(x.label)).action();
  assert.deepEqual([cv.cur(), sim.$('#about-title').textContent], ['i2', 'Roland Juno-60 (1982)'], 'About: that instrument (now the current one)');
  // Tidy: instruments stacked left, panels in the middle, OUT right
  cv.tidy(); sim.raf();
  const L = T().lay, x = k => L[k].x;
  assert.deepEqual([x('i1'), x('i2'), x(ID.sx), x('fx1') > x('i1'), x('out') > x('fx1'), L.i2.y > L.i1.y, cv.hist.undoLabel], [0, 0, 0, true, true, true, 'Tidy']);
  cv.undo(); sim.raf();
  // a tap on an effect while the current instrument feeds OUT directly: a new panel it is cabled through
  const d = cv.dup('i1'); sim.raf();
  cv.cable.connect(d + '.out', 'out.in'); sim.raf();
  cv.setCur(d);
  const m = hsteps();
  cv.fx.pick('eq'); sim.raf();
  const p = T().wires.find(q => q.a === d + '.out').b.split('.')[0];
  assert.deepEqual([T().dev[p].kind, T().dev[p].fx.racks[0].mods.map(q => q.type).join(','), T().wires.find(q => q.a === p + '.out').b, hsteps()], ['panel', 'eq', 'out.in', m + 1]);
  cv.undo(); cv.undo(); cv.undo(); sim.raf();
  assert.equal(T().dev[d], undefined, 'undo: back to before the duplicate');
});

test('⚙ Measure this device: without a Worker here it fails with the reason in #notice and the button comes back; a stored factor scales the tray labels', async () => {
  const sh0 = sh.shell.measure;
  assert.equal(sh0.btn.textContent, 'Measure this device');
  await cv.measure(sh0.btn, sh0.st);
  assert.deepEqual([sh0.btn.textContent, note().length > 0], ['Measure this device', true], note());
  const tile = () => sh.shell.tiles.tiles().find(b => b.getAttribute('data-model') === 'serum').children.find(c => c.className === 'cv-tcost').textContent;
  const before = tile();
  api.store.set('synth.cv.devFactor', 4); cv.costLabels();
  assert.notEqual(tile(), before, 'a slower device: higher estimates (' + before + ' → ' + tile() + ')');
  assert.equal(cv.devFactor(), 4);
  api.store.set('synth.cv.devFactor', 0); cv.costLabels();
});

test('Save as classic project of a several-instrument track lists what the classic SYNTH cannot hold', async () => {
  const was = globalThis.confirm;
  let asked = '';
  globalThis.confirm = m => { asked = String(m); return true; };
  try {
    const n = P().tracks.length, txt = await cv.classicFile(), v1 = JSON.parse(txt);
    assert.match(asked, /^The classic SYNTH can’t hold everything in this project:\n• /);
    assert.ok(v1.tracks.length > n, 'one track per instrument');
    assert.deepEqual(v1.tracks.map(x => 'dev' in x), v1.tracks.map(() => false));
  } finally { globalThis.confirm = was; }
});

// UI fixes (stage 1e review, fixer U: findings U1–U17). Each test makes its own track (api.addTrack selects it)
const MOD = id => MODELS.find(m => m.id === id);
const fresh = (id = 'minimoog') => { const t = api.addTrack(MOD(id)); sim.raf(); return t; };
const at = k => { const m = V().modules.get(k); return m ? Math.round(m.x) + ',' + Math.round(m.y) : null; };

test('U1: a Serum primary next to a shared panel fx1 — i1/fx and fx1 keep places of their own (Tidy separates them; moving one never drops the other\'s entry)', () => {
  fresh('minimoog');
  cv.add('juno60', { x: 0, y: 2400 }); sim.raf();
  assert.deepEqual(T().wires.map(w => w.a + '>' + w.b).sort(), ['fx1.out>out.in', 'i1.out>fx1.in', 'i2.out>fx1.in'], 'the Juno-60 into the shared panel');
  cv.setCur('i1'); cv.setTrackModel(cv.view1e('i1'), 'serum'); sim.raf();
  assert.deepEqual([keys().includes('i1/fx'), keys().includes('fx1')], [true, true], keys());
  assert.notEqual(at('i1/fx'), at('fx1'), 'not on top of each other: ' + at('i1/fx') + ' / ' + at('fx1'));
  cv.tidy(); sim.raf();
  assert.notEqual(at('i1/fx'), at('fx1'), 'Tidy separates them');
  assert.deepEqual([!!T().lay['i1/fx'], !!T().lay.fx1], [true, true], 'both entries written: ' + Object.keys(T().lay).join(','));
  const was = at('i1/fx');
  V().modules.get('fx1').nudge(64, 0); sim.raf();
  assert.deepEqual([!!T().lay['i1/fx'], at('i1/fx')], [true, was], 'moving fx1 keeps i1/fx where it stands');
  V().modules.get('i1/fx').nudge(0, 64); sim.raf();
  assert.equal(!!T().lay.fx1, true, 'moving i1/fx keeps fx1\'s entry');
  assert.notEqual(at('i1/fx'), at('fx1'));
});
