import './v8-guard.mjs';
// Stage 1e on the canvas (docs/canvas/IMPL-1e.md §4.5) and stage 1f (IMPL-1e §8.5: one instrument per track in the UI
// again) in the page simulation. The UI: a Sources drop anywhere on the canvas replaces the instrument (one undo step, the
// notice), the module bar has no ⏻ nor key-zone pill, the ⋯ menu no device items, every cable read-only, the Effects tray
// has no panel tile and puts an effect into the track's panel (a Serum's own FX) wherever it is dropped, a project whose
// track holds several instruments opens as one track per instrument. Underneath, the host and the engine protocol of
// several instruments per track stay (the hooks __synthTest.cv add / power / zone: graph + patch i + chain, power, zones,
// module CPU and monitors per device, Save as classic project, the review fixes U1 U2 U6 U7 U8 U9 U14 U16 U17).
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
const clone = x => JSON.parse(JSON.stringify(x));
const labels = k => cv.menu(k).filter(x => !x.sep).map(x => x.label);
const fxMods = k => (T().dev[k].fx.racks[0].mods || []).map(x => x.type).join(',');
const panels = (t = T()) => Object.keys(t.dev).filter(k => t.dev[k].kind === 'panel').sort().join(',');

test('1f: a Sources drop anywhere on the canvas replaces the instrument — empty canvas or its bar; one History step, the notice undoes it; a tap replaces too', () => {
  const t = T(), n0 = hsteps();
  assert.deepEqual([insts(t), keys()], ['i1:minimoog', 'fx1,i1,out']);
  assert.equal(sh.srcDrag.drop('juno60', { over: 'canvas', x: 700, y: 1300 }), true, 'empty canvas');
  sim.raf();
  assert.deepEqual([insts(), keys(), hsteps(), note()], ['i1:juno60', 'fx1,i1,out', n0 + 1, 'Replaced Minimoog with Juno-60 · tap to undo'], 'replaced, nothing added');
  assert.equal(!!api.nodes.get(t.id).graphed, false, 'a canonical track: today\'s stream');
  sim.$('#notice').onclick(); sim.raf();
  assert.deepEqual([insts(), hsteps()], ['i1:minimoog', n0], 'the notice undid it');
  assert.equal(sh.srcDrag.drop('dx7', { over: 'canvas', target: V().modules.get('fx1').bar }), true); sim.raf();
  assert.deepEqual([insts(), hsteps()], ['i1:dx7', n0 + 1], 'over another module too');
  cv.undo(); sim.raf();
  sh.srcPick('prophet5', 'replace'); sim.raf();
  assert.deepEqual([insts(), hsteps(), note()], ['i1:prophet5', n0 + 1, 'Replaced Minimoog with Prophet-5 · tap to undo']);
  cv.undo(); sim.raf();
  assert.equal(insts(), 'i1:minimoog');
});

test('the add hook (cv.add, host only since 1f): an instrument added where asked, auto-patched into the shared panel; the node gets graph + patch i + chain, its own body and ClassicPanel, one undo step and the notice; the current instrument stays the primary', () => {
  const t = T(), n0 = hsteps(), k0 = posted(t);
  assert.equal(cv.add('juno60', { x: 640, y: 1280 }), 'i2'); sim.raf();
  assert.deepEqual([insts(t), keys(), hsteps(), cv.hist.undoLabel], ['i1:minimoog,i2:juno60', 'fx1,i1,i2,out', n0 + 1, 'Add Juno-60']);
  assert.deepEqual(t.wires.map(w => w.a + '>' + w.b).sort(), ['fx1.out>out.in', 'i1.out>fx1.in', 'i2.out>fx1.in'], 'into the panel the instruments share');
  assert.deepEqual([t.lay.i2.x, t.lay.i2.y], [640, 1280]);
  assert.deepEqual([t.lay.i1 && t.lay.i1.x, t.lay.fx1 && t.lay.fx1.x], [V().modules.get('i1').x, V().modules.get('fx1').x], 'the Tidy-placed modules pinned where they stood');
  const m = tags(t, k0);
  assert.deepEqual([m[0], m.includes('patch:i2'), m.includes('patch:i1'), m.includes('chain:fx1')], ['graph', true, true, true], m.join(' '));
  assert.deepEqual(lastGraph(t).insts.map(x => x.id + (x.on ? '' : ':off')), ['i1', 'i2']);
  assert.equal(api.nodes.get(t.id).graphed, true);
  assert.deepEqual([cv.parts.inst.parentNode === bodyOf('i1'), cv.bodyEl('i2').parentNode === bodyOf('i2'), cv.bodyEl('i2') === cv.parts.inst],
    [true, true, false], '#inst in the primary, its own element in the new one');
  const cp = cv.classicPanels.get(t.id + '/i2');
  assert.deepEqual([!!cp, cp && cp.model.id, cp && cp.root === cv.bodyEl('i2'), cp && cp.track.id], [true, 'juno60', true, t.id + '/i2'], 'a ClassicPanel of the Juno-60 in its body');
  assert.deepEqual([cv.cur(), cv.panel() === cp, sim.$('#trkChip .cv-cv').textContent], ['i1', false, '2 instruments'], 'the primary stays the current one; the chip says how many');
  assert.equal(note(), 'Added Juno-60 · tap to undo');
  cv.undo(); sim.raf();
  assert.deepEqual([insts(), keys(), cv.classicPanels.has(t.id + '/i2')], ['i1:minimoog', 'fx1,i1,out', false]);
  cv.redo(); sim.raf();
  assert.deepEqual([insts(), keys(), cv.classicPanels.has(T().id + '/i2')], ['i1:minimoog,i2:juno60', 'fx1,i1,i2,out', true]);
  cv.add('dx7', null); sim.raf();
  assert.match(insts(), /^i1:minimoog,i2:juno60,i\d+:dx7$/);
  sim.$('#notice').onclick(); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60', 'the tap undid the add');
});

test('1f: the current instrument is always the primary — setCur changes nothing; a tap and a canvas drop (even over the second instrument\'s bar) replace the primary', () => {
  const n = hsteps();
  cv.setCur('i2');
  assert.equal(cv.cur(), 'i1');
  sh.srcPick('prophet5', 'replace'); sim.raf();
  assert.deepEqual([insts(), hsteps(), note()], ['i1:prophet5,i2:juno60', n + 1, 'Replaced Minimoog with Prophet-5 · tap to undo']);
  sim.$('#notice').onclick(); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60', 'the notice undoes it');
  assert.equal(sh.srcDrag.drop('obxa', { over: 'canvas', target: V().modules.get('i2').bar }), true); sim.raf();
  assert.deepEqual([insts(), T().model], ['i1:obxa,i2:juno60', 'obxa']);
  cv.undo(); sim.raf();
  assert.equal(insts(), 'i1:minimoog,i2:juno60');
});

test('1f: no ⏻ and no key-zone pill on the bars, the ⋯ menus without device items (Power, Key zone…, Solo, Primary, Duplicate, Delete, Delete panel), every cable and jack read-only', () => {
  ID.sx = cv.add('serum', { x: 0, y: 2400 }); sim.raf();
  assert.equal(keys().includes(ID.sx + '/fx'), true, 'a Serum with its own FX module');
  for (const [k, m] of V().modules) {
    const pw = m.bar.children.filter(c => /\bcv-pow\b/.test(c.className || ''));
    assert.deepEqual([pw.length, pw.every(c => c.hidden === true), m.el.children.some(c => /\bcv-zone\b/.test(c.className || '')), m.zoneW], [1, true, false, 0], k + ': the ⏻ slot hidden, no pill');
  }
  const L = ['About the Minimoog…', 'Replace with…', 'Hardware layout', 'Simple layout', 'Save sound…', 'Delete saved sound', 'Init sound', 'Fold', 'Bring to front', 'Tidy the canvas'];
  assert.deepEqual(labels('i1'), L);
  assert.deepEqual(labels('i2'), L.map(x => x.replace('Minimoog', 'Juno-60')));
  // (stage 2a, IMPL-2a §5: a Serum's ⋯ opens its Mod list — "Modulation list…", lane D's choice for the mod list's entry)
  assert.deepEqual(labels(ID.sx), ['About the Serum…', 'Replace with…', 'Modulation list…', 'Fold', 'Bring to front', 'Tidy the canvas']);
  assert.deepEqual([labels('fx1'), labels(ID.sx + '/fx'), labels('out')], [['Fold', 'Bring to front', 'Tidy the canvas'], ['Fold', 'Bring to front', 'Tidy the canvas'], ['Fold']]);
  const C = V().cables.list();
  assert.ok(C.length >= 4, C.length + ' cables');
  assert.deepEqual(C.map(c => !!c.readonly), C.map(() => true), 'every cable read-only');
  const J = V().jacks();
  assert.deepEqual(J.map(j => j.el.hasAttribute('data-ro') && j.el.getAttribute('role') !== 'button'), J.map(() => true), 'every jack read-only: ' + J.map(j => j.id).join(' '));
  V().cables.select(C.find(c => c.id === T().wires[0].id).id);
  assert.equal(V().cables.selected(), null, 'never selected (no × Disconnect)');
});

test('power and key zones (hooks cv.power / cv.zone: host and engine protocol): {t: power, i} after the graph, the module dims, its cables grey; zones compile into the graph; one step each; undo', () => {
  const t = T(), m = () => V().modules.get('i2');
  let k = posted(t), n = hsteps();
  cv.power('i2', false); sim.raf();
  assert.deepEqual([t.dev.i2.on, m().el.hasAttribute('data-off'), m().on, hsteps(), cv.hist.undoLabel], [false, true, false, n + 1, 'Power off Juno-60']);
  const s = sent(t, k), p = s.find(x => x.t === 'power');
  assert.deepEqual([s.findIndex(x => x.t === 'graph') < s.findIndex(x => x.t === 'power'), p && p.i, p && p.on], [true, 'i2', false]);
  assert.equal(lastGraph(t).insts.find(x => x.id === 'i2').on, false);
  assert.equal(V().cables.list().filter(c => c.a === 'i2.out').every(c => c.dim), true, 'its cable grey');
  k = posted(t);
  cv.undo(); sim.raf();
  assert.deepEqual([T().dev.i2.on, m().el.hasAttribute('data-off')], [undefined, false], 'undo: on');
  assert.ok(sent(T(), k).some(x => x.t === 'power' && x.i === 'i2' && x.on === true));
  cv.redo(); sim.raf();
  assert.equal(m().el.hasAttribute('data-off'), true, 'redo: off');
  cv.power('i2', true); sim.raf();
  assert.equal(m().el.hasAttribute('data-off'), false);
  // zones: quick edits of one zone are one step
  n = hsteps(); k = posted(T());
  cv.zone('i2', { lo: 48, hi: 71, xp: 0 });
  cv.zone('i2', { lo: 48, hi: 72, xp: 12 }); sim.raf();
  assert.deepEqual([T().dev.i2.zone, hsteps(), cv.hist.undoLabel], [{ lo: 48, hi: 72, xp: 12 }, n + 1, 'Key zone of Juno-60']);
  assert.deepEqual(lastGraph(T()).insts.find(x => x.id === 'i2').zone, { lo: 48, hi: 72, xp: 12 });
  assert.ok(tags(T(), k).includes('graph'));
  cv.undo(); sim.raf();
  assert.equal(T().dev.i2.zone, undefined);
});

test('1f Effects tray: no panel tile (the effects and splitters, a cost each); a drop on empty canvas, on the panel, on an instrument and a tap all go into the track\'s FX — never a new panel, no History step, one notice each; the outline sits on the module it goes into', () => {
  const t = T(), tiles = cv.fx.tiles().tiles();
  assert.deepEqual([tiles.length, cv.fx.items.length, tiles.some(b => b.getAttribute('data-fx') === 'panel')], [16, 16, false]);
  assert.match(cv.fx.tiles().tile('rev').children.find(c => c.className === 'cv-tcost').textContent, /%$/, 'a load estimate');
  const n = hsteps(), p0 = panels(), k = posted(t);
  assert.equal(cv.fx.over({ closest: q => (/#viewport/.test(q) ? {} : null), getAttribute: () => null, parentNode: null }), 'canvas');
  assert.equal(cv.fx.drag.drop('dly', { over: 'canvas', at: { x: 4000, y: 3000 } }), true); sim.raf();
  assert.deepEqual([fxMods('fx1'), panels(), hsteps(), /^Added Delay to FX Panel/.test(note())], ['dly', p0, n, true], 'empty canvas: the track\'s panel');
  assert.ok(tags(t, k).includes('chain:fx1'), 'its chain');
  assert.equal(cv.fx.drag.drop('eq', { over: 'panel', key: 'fx1' }), true); sim.raf();
  assert.equal(cv.fx.drag.drop('cho', { over: 'inst', key: 'i2' }), true); sim.raf();
  cv.fx.pick('dist'); sim.raf();
  assert.deepEqual([fxMods('fx1'), panels(), hsteps()], ['dly,eq,cho,dist', p0, n], 'the panel, an instrument, a tap: all into fx1');
  assert.equal(cv.fx.drag.drop('rev', { over: 'inst', key: ID.sx }), true); sim.raf();
  assert.match(JSON.stringify(T().dev[ID.sx].fx), /"rev"/, 'over a Serum: its own FX');
  assert.equal(cv.fx.drag.drop('rev', { over: null }), false, 'off the canvas: nothing');
  // the outline: the module the effect goes into (empty canvas: the track's panel), none elsewhere
  const G = [];
  W.ghost = g => { G.push(g ? (g.label || '') + '|' + g.w : null); return g ? { x: 0, y: 0, w: g.w, h: g.h } : null; };
  try {
    cv.fx.drag.begin('rev', { over: 'canvas', x: 900, y: 600, left: true, pointerType: 'mouse' });
    cv.fx.drag.move('rev', { over: 'inst', key: 'i2', x: 900, y: 600, left: true, pointerType: 'mouse' });
    cv.fx.drag.move('rev', { over: null, x: 900, y: 600, left: true, pointerType: 'mouse' });
    cv.fx.drag.cancel('rev', {});
  } finally { delete W.ghost; }
  const rv = cv.fx.items.find(x => x.type === 'rev').label;
  assert.deepEqual(G, [rv + ' → FX Panel|' + V().modules.get('fx1').w, rv + ' → Juno-60|' + V().modules.get('i2').w, null, null]);
  assert.equal(hsteps(), n);
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

test('per instrument: Hardware / Simple of a second instrument (its lay key, its own panel); Tidy lays out every device (one step)', () => {
  const t = T(), n = hsteps();
  cv.menu('i2').find(x => x.label === 'Simple layout').action(); sim.raf();
  assert.deepEqual([T().lay.i2.ui, cv.instUi(T(), 'i2'), cv.instUi(T(), 'i1'), hsteps(), cv.hist.undoLabel], ['flow', 'flow', 'hw', n + 1, 'Simple layout']);
  assert.deepEqual([V().modules.get('i2').w, cv.classicPanels.get(t.id + '/i2').layout], [864, null], 'the Juno-60 in its Simple width, its panel re-rendered');
  cv.undo(); sim.raf();
  assert.equal(cv.instUi(T(), 'i2'), 'hw');
  cv.tidy(); sim.raf();
  const L = T().lay, x = k => L[k].x;
  assert.deepEqual([x('i1'), x('i2'), x(ID.sx), x('fx1') > x('i1'), x('out') > x('fx1'), L.i2.y > L.i1.y, cv.hist.undoLabel], [0, 0, 0, true, true, true, 'Tidy']);
  cv.undo(); sim.raf();
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

// UI fixes (stage 1e review, fixer U: findings U1–U17) still meaningful under 1f. Each test makes its own track (api.addTrack selects it)
const MOD = id => MODELS.find(m => m.id === id);
const fresh = (id = 'minimoog') => { const t = api.addTrack(MOD(id)); sim.raf(); cv.renderViews(); sim.raf(); return t; }; // (the switch's mounting completed at once)
const at = k => { const m = V().modules.get(k); return m ? Math.round(m.x) + ',' + Math.round(m.y) : null; };

test('1f Effects tray on single-instrument tracks: a Serum\'s canvas drop goes into its own FX; a classic always has its panel (the split gives one straight into OUT an empty one) — a hook-made shape without one takes nothing, never a free panel', () => {
  fresh('serum');
  const n = hsteps();
  assert.equal(cv.fx.drag.drop('dly', { over: 'canvas', at: { x: 3000, y: 3000 } }), true); sim.raf();
  assert.deepEqual([keys(), JSON.stringify(T().dev.i1.fx.racks[0].mods.map(x => x.type)), hsteps()], ['i1,i1/fx,out', '["dly"]', n]);
  const t = fresh('dx7');
  CMOD.removePanel(t, 'fx1'); api.sendPatch(t); cv.render(); sim.raf(); // (cv-model directly: no 1f UI does this)
  const m = hsteps();
  cv.fx.pick('eq'); sim.raf();
  assert.deepEqual([keys(), panels(), hsteps()], ['i1,out', '', m]);
});

test('U1: a Serum primary next to a shared panel fx1 — i1/fx and fx1 keep places of their own (Tidy separates them; moving one never drops the other\'s entry)', () => {
  fresh('minimoog');
  cv.add('juno60', { x: 0, y: 2400 }); sim.raf();
  assert.deepEqual(T().wires.map(w => w.a + '>' + w.b).sort(), ['fx1.out>out.in', 'i1.out>fx1.in', 'i2.out>fx1.in'], 'the Juno-60 into the shared panel');
  cv.setTrackModel(cv.view1e('i1'), 'serum'); sim.raf();
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

// the default camera of track t again (a switch away and back: none stored while it stays the default); o: world overrides
function camAgain(t, o = {}) {
  const was = {};
  for (const k of Object.keys(o)) { was[k] = W[k]; W[k] = o[k]; }
  try { const other = P().tracks.find(x => x.id !== t.id); api.selectTrack(other.id); sim.raf(3); api.selectTrack(t.id); sim.raf(3); }
  finally { for (const k of Object.keys(o)) { if (was[k] === undefined) delete W[k]; else W[k] = was[k]; } }
}
// the screen box of module k's top bar (40 world px) under the scripted camera
const barBox = k => { const m = V().modules.get(k), zw = m.zoneW || 0, a = W.toClient(m.x - zw, m.y), b = W.toClient(m.x + m.w, m.y + (zw ? 74 : 40)); return { left: a.x, top: a.y, right: b.x, bottom: b.y }; };
const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('U14: the default camera of a two-instrument track keeps every top bar clear of the toolbar + minimap box (world.reserved), never below READ_K', () => {
  const t = fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  camAgain(t);
  const bar2 = barBox('i2'), k0 = W.k;
  assert.ok(k0 > 0.9, 'an editable k without a reserved box: ' + k0);
  const box = { left: 56, top: Math.round(bar2.top) - 20, right: 536, bottom: Math.round(bar2.top) + 148 };
  camAgain(t, { band: () => ({ left: 44, top: 48, right: 1520, bottom: box.top - 8 }), reserved: () => [box] });
  const hit = [...V().modules.keys()].filter(k => meets(barBox(k), box));
  assert.deepEqual(hit, [], 'no bar under the box (k ' + W.k + ')');
  assert.ok(W.k >= 0.5 && W.k < k0, 'a lower k lifts the stacked bar above it: ' + W.k);
  assert.ok(barBox('i1').left >= 44 && barBox('i1').top >= 48, 'the primary still at the band\'s top-left');
});

test('U14: an untouched default camera follows a later resize of the canvas (the keyboard tray sized after boot, a rotation): bars stay clear of the box; a camera the user moved stays', () => {
  const t = fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  camAgain(t);
  const bar2 = barBox('i2'), k0 = W.k, box = { left: 56, top: Math.round(bar2.top) - 20, right: 536, bottom: Math.round(bar2.top) + 148 };
  const was = { band: W.band };
  W.band = () => ({ left: 44, top: 48, right: 1520, bottom: box.top - 8 }); W.reserved = () => [box];
  try {
    W.emit('resize', {});
    assert.deepEqual([[...V().modules.keys()].filter(k => meets(barBox(k), box)), W.k < k0], [[], true], 'derived again: k ' + W.k);
    const moved = { tx: W.cam.tx - 300, ty: W.cam.ty, k: W.k };
    W.setCamera(moved); // (the user's pan: cameraend → queued, then stored)
    cv.camFlush();
    W.band = () => ({ left: 44, top: 48, right: 1520, bottom: 700 }); W.reserved = () => [];
    W.emit('resize', {});
    assert.deepEqual(W.cam, moved, 'a camera the user moved is theirs');
  } finally { W.band = was.band; delete W.reserved; }
});

test('1g: a moved top edge (the top tray\'s grip: "dragging the track tray down should not move the canvas") never re-derives the default camera; the untouched default stays untouched for a later rotation', () => {
  const t = fresh('minimoog');
  camAgain(t);
  const c0 = Object.assign({}, W.cam), k0 = W.k;
  W.cam = { tx: c0.tx, ty: c0.ty - 80, k: c0.k }; // (cv-world kept the world still on the screen: its camera followed the edge)
  W.emit('resize', { w: 1520, h: 572, dw: 0, dh: -80, dx: 0, dy: 80 });
  assert.deepEqual(W.cam, { tx: c0.tx, ty: c0.ty - 80, k: c0.k }, 'the grip drag moved nothing');
  W.emit('resize', { w: 1520, h: 492, dw: 0, dh: -80, dx: 0, dy: 0 }); // (the keyboard tray: the top edge kept, the camera still the default)
  const c1 = Object.assign({}, W.cam);
  const was = W.band;
  W.band = () => ({ left: 44, top: 48, right: 1100, bottom: 700 });
  try {
    W.emit('resize', { w: 1100, h: 652, dw: -420, dh: 160, dx: 0, dy: 0 }); // a rotation: the width changed
    assert.ok(W.k < k0 && JSON.stringify(W.cam) !== JSON.stringify(c1), 'the untouched default is derived again: k ' + W.k);
  } finally { W.band = was; }
});

test('U2: a piano-roll audition reaches every powered instrument whose key zone holds the note (its transpose too); the note-off goes exactly where the note-on went', () => {
  const t = fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  cv.zone('i2', { lo: 60, hi: 72, xp: 12 }); sim.raf();
  const R = api.roll().host, aud = (from, f) => { const k = posted(t); f(); return sent(t, k).filter(m => m.aud).map(m => m.t + ':' + (m.i || '-') + ':' + m.n).join(' '); };
  assert.equal(api.nodes.get(t.id).graphed, true);
  assert.equal(aud(0, () => R.audition(64, 100)), 'on:i1:64 on:i2:76', 'both: the Juno-60 transposed');
  assert.equal(aud(0, () => R.audition(50, 100)), 'on:i1:50', 'below the Juno-60\'s zone: the Minimoog alone');
  cv.power('i1', false); sim.raf();
  assert.equal(aud(0, () => R.auditionOff(64)), 'off:i1:64 off:i2:76', 'the offs where the ons went (the Minimoog off since)');
  assert.equal(aud(0, () => R.audition(66, 100)), 'on:i2:78', 'the primary off: the Juno-60 still previews');
  assert.equal(aud(0, () => { R.auditionOff(50); R.auditionOff(66); }), 'off:i1:50 off:i2:78');
  cv.undo(); sim.raf();
});

test('U16: with the toolbar\'s Snap off, a new instrument (cv.add) lands where it was put (not on the dots); on, on the dots', () => {
  fresh('minimoog');
  W.snapOn = () => false;
  try {
    const id = cv.add('juno60', { x: 1001, y: 2003 }); sim.raf();
    assert.deepEqual([T().lay[id].x, T().lay[id].y], [1001, 2003]);
  } finally { delete W.snapOn; }
  const id2 = cv.add('dx7', { x: 1001, y: 4003 }); sim.raf();
  assert.deepEqual([T().lay[id2].x, T().lay[id2].y], [992, 4000], 'Snap on: the dots');
});

test('U10 / 1f: the bar badge is the CPU safeguard\'s cap on its instrument and nothing else — no "not connected" badges (even for a hook-made silent route)', () => {
  const t = fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  const B = k => V().modules.get(k).badge;
  assert.deepEqual(['i1', 'i2', 'fx1', 'out'].map(B), [null, null, null, null], 'all cabled');
  CMOD.disconnect(T(), T().wires.find(w => w.a === 'fx1.out').id); cv.render(); sim.raf();
  assert.deepEqual(['i1', 'i2', 'fx1'].map(B), [null, null, null], 'a silent route: no badge');
  const N = api.nodes.get(t.id), was = N.osI;
  N.osI = new Map([['i2', 1]]);
  try { cv.render(); assert.match(String(B('i2')), /^OS \d→1$/); assert.equal(B('i1'), null); }
  finally { N.osI = was; cv.render(); }
});

test('U9: the soft caps on a touch device (page sim, through the add hook: no UI reaches them since 1f) — the 4th instrument warns in the notice, a second heavy Serum asks first', () => {
  fresh('minimoog');
  const was = globalThis.confirm, asked = [];
  globalThis.confirm = m => { asked.push(String(m)); return false; };
  cv.touch(true);
  try {
    cv.add('juno60', null); sim.raf(); cv.add('dx7', null); sim.raf();
    assert.doesNotMatch(note(), /instruments \(about/, 'three: no warning');
    const four = cv.add('prophet5', null); sim.raf();
    assert.match(note(), /^This track now has 4 instruments \(about [^)]+\)\. More can cause dropouts here/, 'the 4th warns');
    cv.undo(); sim.raf();
    assert.equal(T().dev[four], undefined);
    api.notice('', 0);
    api.store.set('synth.cv.devFactor', 50);
    const s1 = cv.add('serum', null); sim.raf();
    assert.deepEqual([T().dev[s1].model, asked.length], ['serum', 0], 'the first heavy Serum: no question');
    assert.equal(cv.add('serum', null), null, 'a second: asked, declined');
    assert.match(asked.at(-1), /already has a heavy Serum/);
  } finally { globalThis.confirm = was; cv.touch(null); api.store.set('synth.cv.devFactor', 0); }
});

test('U6: two Serums on one track keep their own live-input subscriptions (clip recording, key lights): a played note reaches both; one leaving keeps the other', () => {
  const t = fresh('serum');
  const s2 = cv.add('serum', null); sim.raf();
  const got = [];
  api.sxHost(t, 'i1').onInput((on, n) => got.push('i1:' + on + ':' + n));
  api.sxHost(t, s2).onInput((on, n) => got.push(s2 + ':' + on + ':' + n));
  api.noteOn(60, 0.8); api.noteOff(60);
  assert.deepEqual(got.sort(), ['i1:0:60', 'i1:1:60', s2 + ':0:60', s2 + ':1:60'].sort());
  api.sxHost(t, 'i1').onInput(null);
  got.length = 0;
  api.noteOn(62, 0.8); api.noteOff(62);
  assert.deepEqual(got, [s2 + ':1:62', s2 + ':0:62'], 'the other one stays subscribed');
  api.sxHost(t, s2).onInput(null);
});

test('U7: Mod wheel → WT Pos scrubs the Serum whose WT editor is open (not the primary)', () => {
  const t = fresh('serum');
  const s2 = cv.add('serum', null); sim.raf();
  const pr = api.prefs(), was = pr.wheelWt, wt = id => T().dev[id].vals.s.p['a.wt'];
  const w1 = wt('i1');
  pr.wheelWt = true;
  try {
    api.sxHost(t, s2).editorOpen(0);
    cv.wheelToWt(0.7);
    assert.deepEqual([wt(s2), wt('i1')], [0.7, w1], 'its own oscillator A');
    api.sxHost(t, s2).editorOpen(null);
    cv.wheelToWt(0.2);
    assert.equal(wt(s2), 0.7, 'closed: nothing');
  } finally { pr.wheelWt = was; }
});

test('U8: the chord / voice-mode notice stays quiet on a several-instrument track (it judged the primary alone and its tap replaced it); a one-instrument track still gets it', () => {
  const chord = () => [60, 64, 67].map(n => ({ t: 0, n, d: 480, v: 100 }));
  fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  T().notes = chord();
  api.notice('', 0);
  cv.chordCheck(T());
  assert.equal(note(), '', 'a Juno-60 beside the monophonic Minimoog: no notice');
  fresh('minimoog');
  T().notes = chord();
  cv.chordCheck(T());
  assert.match(note(), /is monophonic — its chords play one note/, 'alone: the notice');
  api.notice('', 0);
});

test('U17: a track switch mounts several device bodies one job per body, a slice per frame (the world hidden until the last), then every panel of the new track is up', () => {
  const a = fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  const d3 = cv.add('dx7', null); sim.raf();
  const b = fresh('juno60'), vp = sim.$('#viewport');
  const REAL = globalThis.performance;
  let ms = 1e6;
  globalThis.performance = { now: () => (ms += 20), timeOrigin: REAL.timeOrigin }; // (every read 20 ms later: a 12 ms slice holds one job)
  try {
    api.selectTrack(a.id);
    const J = cv.mount();
    assert.ok(J, 'mounting');
    assert.deepEqual([J.jobs.slice().sort().join(','), vp.hasAttribute('data-cv-mounting')], [['fx1', 'i1', 'i2', d3].sort().join(','), true], 'one job per body, the world hidden');
    const left = [];
    for (let i = 0; i < 4; i++) { sim.raf(); const M = cv.mount(); left.push(M ? M.jobs.length : -1); }
    assert.deepEqual(left, [3, 2, 1, 0], 'one body a frame');
    for (let i = 0; i < 60 && cv.mount(); i++) sim.raf();
    assert.deepEqual([cv.mount(), vp.hasAttribute('data-cv-mounting')], [null, false], 'shown once done');
    assert.deepEqual(['i1', 'i2', d3].map(k => { const P = cv.classicPanels.get(a.id + '/' + k); return !!P && !P.dead; }), [true, true, true], 'every instrument\'s panel');
  } finally { globalThis.performance = REAL; }
  void b;
});

test('1f: a saved project whose track holds two instruments opens as two tracks ("Track “X” held 2 instruments: now 2 tracks"); a one-instrument track beside it is untouched; undo of the Open brings the previous project back', async () => {
  const multi = fresh('minimoog');
  cv.add('juno60', null); sim.raf();
  const one = fresh('dx7');
  const o = clone(P());
  o.tracks = [clone(P().tracks.find(x => x.id === multi.id)), clone(P().tracks.find(x => x.id === one.id))];
  o.tracks[0].name = 'Duo';
  o.selTrack = multi.id;
  const before = JSON.stringify(P().tracks.map(x => x.id)), oneDev = JSON.stringify(o.tracks[1].dev), oneWires = JSON.stringify(o.tracks[1].wires);
  const file = { name: 'duo.synth.json', type: 'application/json', text: async () => JSON.stringify(o) };
  await sim.$('#fFile').onchange({ target: { files: [file], value: '' } });
  await sim.settle(10); sim.raf();
  const tr = P().tracks;
  assert.deepEqual(tr.map(x => x.name + ':' + insts(x)), ['Duo:i1:minimoog', 'Duo · Juno-60:i1:juno60', one.name + ':i1:dx7']);
  assert.deepEqual([tr[0].id, tr[2].id, P().selTrack], [multi.id, one.id, multi.id], 'the primary keeps the track');
  assert.equal(note(), 'Track “Duo” held 2 instruments: now 2 tracks');
  assert.deepEqual([JSON.stringify(tr[2].dev), JSON.stringify(tr[2].wires)], [oneDev, oneWires], 'the one-instrument track as it was');
  assert.deepEqual(tr.map(x => CG.compileTrack(x).canonical), [true, true, true]);
  assert.deepEqual(tr.map(x => x.notes.length), [o.tracks[0].notes.length, o.tracks[0].notes.length, o.tracks[1].notes.length]);
  assert.deepEqual([keys(), sim.$('#trkChip .cv-cv').textContent.includes('instruments')], ['fx1,i1,out', false], 'one instrument on the canvas');
  cv.undo(); sim.raf();
  assert.equal(JSON.stringify(P().tracks.map(x => x.id)), before, 'undo: the project before the Open');
});
