import './v8-guard.mjs';
// The accessor retirement's characterisation tests (milestone 3, IMPL-3 §4.3 R0 → R7, §4.2, §7 Accessors N5): what the
// services that read a track's v1 fields (the 1e transition accessors) do for the primary instrument, written against
// the behaviour before any of them moved — preset save / delete, Serum preset current / rename / save (its FX phase
// capture), program change, Mod wheel → WT Pos, the FX rack host, Resample's and render-last's patches (the primary
// renders through buildPatch: its bytes), the FX phase read-back, the per-model value memory synth.v.<model>, the project
// file's mirror, MIDI import, add / duplicate track, the track list, the instrument menu, the multisample zone — and,
// as the steps make each primary-only path per device (§4.2), the same service on a non-primary device in the data
// (the UI holds one instrument per track since 1f; the hook __synthTest.cv.add adds a second).
// Every track is read through its devices here (P(t) = cv-model instOf), never through a track's v1 fields. Since R7 the
// accessors are gone: the page simulation is a guard build (__synthTest set), its tracks hold throwing guard accessors —
// a stray track.model read or write anywhere in the page fails the test that reaches it.
// One boot (the page simulation, canvas-sim's scripted world); strings, numbers, booleans and plain data into assert —
// never a stub DOM node. Run alone: node --max-old-space-size=2048 --test tests/accessors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as S from '../song.js?v=9';
import * as core from '../serum-core.js?v=9';
import { MODELS } from '../models.js?v=9';

function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null,
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => ({ left: 44, top: 48, right: 1520, bottom: 700 }),
    toClient: (wx, wy) => ({ x: wx * W.k + W.cam.tx, y: 48 + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - W.cam.tx) / W.k, y: (y - 48 - W.cam.ty) / W.k }),
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
const sim = await bootMain({ ls: fakeStorage({}), hash: '#serum', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, sh = globalThis.__synthTest.shell;
await sim.power(); sim.raf(); await sim.settle(20); sim.raf();
const PJ = () => api.project(), T = () => PJ().tracks.find(t => t.id === PJ().selTrack);
const P = (t, dev) => CMOD.instOf(t, dev); // (a track's instrument device: the primary by default)
const MOD = id => MODELS.find(m => m.id === id);
const clone = x => JSON.parse(JSON.stringify(x));
// a structured clone's canonical text, hashed (tests/canonical-stream.test.mjs's canon: key order, typed arrays, -0, NaN)
function canon(x) {
  if (x === null) return 'null';
  switch (typeof x) {
    case 'undefined': return 'u';
    case 'number': return Object.is(x, -0) ? '-0' : String(x);
    case 'string': return JSON.stringify(x);
    case 'boolean': case 'bigint': return String(x);
    default: break;
  }
  if (ArrayBuffer.isView(x)) { let s = x.constructor.name + '('; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + canon(x[i]); return s + ')'; }
  if (Array.isArray(x)) { let s = '['; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + (i in x ? canon(x[i]) : '_'); return s + ']'; }
  return '{' + Object.keys(x).map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
const sha = m => createHash('sha1').update(canon(structuredClone(m))).digest('hex').slice(0, 16);
const fresh = id => { const t = api.addTrack(MOD(id)); sim.raf(); cv.renderViews(); sim.raf(); return t; }; // (selected; its switch mounted)
const menuAct = (key, label) => { const it = cv.menu(key).find(x => x.label === label); assert.ok(it, 'menu item ' + label); it.action(); };
const sxT = PJ().tracks.find(t => P(t).model === 'serum'); // the boot's Serum track (#serum)
const lfoFx = fx => { const id = core.newInstance(fx, 'cho', { rack: 0 }); const I = fx.racks[0].mods.find(x => x.id === id); I.p.on = 1; return id; };
const choPh = fx => { const I = fx.racks[0].mods.find(x => x.type === 'cho'); return I ? I.ph : undefined; };
const fxOfK = (t, k) => t.dev[k].fx; // (a rack by its key: a Serum's own FX, a panel's)
const VK = (t, dev = CMOD.primId(t)) => t.id + '/' + dev; // (R4: every session map's key — trackId/dev, the primary's too)

test('R0 presets (classic, the module ⋯ menu): Save sound… stores the values under the model and names the preset; Delete saved sound removes it', () => {
  const t = fresh('juno60'), d = P(t), prim = CMOD.primId(t);
  d.vals.cf = 3.25;
  const was = globalThis.prompt;
  globalThis.prompt = () => 'Acc sound';
  try { menuAct(prim, 'Save sound…'); } finally { globalThis.prompt = was; }
  const up = api.store.get('synth.user.juno60', []), e = up.find(x => x.name === 'Acc sound');
  assert.deepEqual([!!e, e && e.v.cf, d.preset], [true, 3.25, 'Acc sound']);
  const cur = acc.presetCur(acc.instView(t, prim));
  assert.deepEqual([cur && cur.name, cur && /^u\d+$/.test(cur.key)], ['Acc sound', true], 'the current entry: the saved sound');
  menuAct(prim, 'Delete saved sound');
  assert.deepEqual([api.store.get('synth.user.juno60', []).some(x => x.name === 'Acc sound'), d.preset], [false, null]);
  menuAct(prim, 'Init sound');
  assert.deepEqual([d.preset, d.vals.cf], [null, MOD('juno60').controls.find(c => c.id === 'cf').def], 'Init: the defaults');
});

test('R0 Serum presets: host save → current → rename follows the track; the stored entry is the Serum state and its own FX', () => {
  api.selectTrack(sxT.id); sim.raf();
  const H = api.sxHost(sxT), d = P(sxT);
  assert.equal(H.presets.save({ name: 'Acc A', cat: 'Test' }), 'u:Acc A');
  assert.deepEqual([H.presets.current(), d.preset], ['u:Acc A', 'Acc A']);
  const e = api.store.get('synth.user.serum', []).find(x => x.name === 'Acc A');
  assert.deepEqual([JSON.stringify(e.v.s) === JSON.stringify(d.vals.s), JSON.stringify(e.fx) === JSON.stringify(d.fx), e.cat], [true, true, 'Test']);
  assert.equal(H.presets.rename('u:Acc A', 'Acc B'), 'u:Acc B');
  assert.deepEqual([H.presets.current(), d.preset], ['u:Acc B', 'Acc B'], 'rename: the track that loaded it follows');
  assert.equal(acc.sxCurrent(acc.instView(sxT, CMOD.primId(sxT))), 'u:Acc B');
});

test('R0 program change: each Serum target loads the n-th preset of the browser\'s list; a classic target is skipped', async () => {
  const SU = await import('../serum-ui.js?v=9');
  const H = api.sxHost(sxT), c = fresh('minimoog'), want = SU.browserList(H.presets.list(), api.store.get(SU.BROWSER_KEY, null))[2];
  const cv0 = JSON.stringify(P(c).vals), was = acc.uiLoad(Promise.resolve({ sx: SU })); // (the panel modules: in node they never finish loading)
  try {
    acc.sxDirty.clear();
    acc.programChange([sxT, c], 2);
    for (let k = 0; k < 50 && H.presets.current() !== want.key; k++) await sim.settle(2);
  } finally { acc.uiLoad(was); }
  assert.deepEqual([H.presets.current(), P(sxT).preset, JSON.stringify(P(c).vals) === cv0], [want.key, want.name, true]);
});

test('R0 Mod wheel → WT Pos: the open WT editor\'s oscillator of the primary Serum follows the wheel', () => {
  api.selectTrack(sxT.id); sim.raf();
  const pr = api.prefs(), was = pr.wheelWt, H = api.sxHost(sxT);
  pr.wheelWt = true;
  try {
    H.editorOpen(1);
    cv.wheelToWt(0.625);
    assert.equal(P(sxT).vals.s.p['b.wt'], 0.625);
    H.editorOpen(null);
    cv.wheelToWt(0.1);
    assert.equal(P(sxT).vals.s.p['b.wt'], 0.625, 'closed: nothing');
  } finally { pr.wheelWt = was; }
});

test('R0 FX rack host (the primary\'s FX): a classic\'s panel (one rack, no Serum state), a Serum\'s own (three racks, its state and locks)', () => {
  const t = fresh('prophet5'), F = api.fxHost(t), pid = CMOD.destOf(t, CMOD.primId(t));
  assert.deepEqual([F.fx() === t.dev[pid].fx, F.racks(), F.state()], [true, 1, null]);
  const G = api.fxHost(sxT), d = P(sxT);
  d.vals.s.locks.p = ['g.master'];
  assert.deepEqual([G.fx() === d.fx, G.racks(), G.state() === d.vals.s, G.locked('g.master'), G.locked('f.cutoff')], [true, 3, true, true, false]);
  d.vals.s.locks.p = [];
});

test('R0 Resample to: the primary Serum renders through buildPatch (its offline bytes), at its own render quality', async () => {
  api.selectTrack(sxT.id); sim.raf();
  const want = sha(api.buildPatch(sxT, 44100, true)), os = api.sxOSFor(P(sxT), 44100, true);
  await api.resampleTo(sxT, 'C');
  const n = sim.lastOffline.nodes[0];
  assert.deepEqual([sha(n.po.patch), n.po.os, n.po.offline, sim.lastOffline.ctx.sampleRate], [want, os, true, 44100]);
  assert.match(P(sxT).vals.s.osc[2].wt, /^user:/, 'imported into oscillator C');
});

test('R0 render-last (a canonical track, the legacy path): the primary through buildPatch at the live rate; dev = the primary is the same render', async () => {
  api.selectTrack(sxT.id); sim.raf();
  const T0 = 2e6;
  api.noteOn(62, 0.8, 0, T0); api.noteOff(62, 0, T0 + 200);
  const sr = sim.ctx().sampleRate, want = sha(api.buildPatch(sxT, sr, true));
  await api.renderLast(sxT, {});
  const a = sim.lastOffline.nodes[0];
  assert.deepEqual([sha(a.po.patch), a.po.os, a.po.trackId], [want, api.sxOSFor(P(sxT), sr, true), sxT.id]);
  await api.renderLast(sxT, { dev: CMOD.primId(sxT) });
  assert.equal(sha(sim.lastOffline.nodes[0].po.patch), want);
});

test('R0 FX phases: syncPhases asks a track\'s rack whose monitor is off and stores the phases its node answers (setPhases)', async () => {
  const t = fresh('juno60'), pid = CMOD.destOf(t, CMOD.primId(t));
  lfoFx(t.dev[pid].fx); api.sendPatch(t); sim.raf();
  api.selectTrack(sxT.id); sim.raf(); // (t's FX module not shown: no monitor, the phases are asked)
  const node = sim.nodeOf(t.id), n0 = node.posted.length;
  await acc.syncPhases();
  const asked = node.posted.slice(n0).map(x => x.m).filter(m => m.t === 'fxph');
  assert.deepEqual(asked.map(m => JSON.stringify(m)), ['{"t":"fxph"}'], 'a legacy node: the one rack, no part named');
  const ph = choPh(t.dev[pid].fx);
  assert.equal(typeof ph === 'number' && ph >= 0 && ph < 1, true, 'stored: ' + ph);
});

test('R0 Serum preset save: the primary\'s FX phase memory (its node\'s last phases) goes into the stored preset, then the rack\'s answer', () => {
  api.selectTrack(sxT.id); sim.raf();
  const d = P(sxT), N = api.nodes.get(sxT.id), node = N.node;
  if (!choPh(d.fx) && choPh(d.fx) !== 0) lfoFx(d.fx);
  api.sendPatch(sxT); sim.raf();
  const L = core.fxLayout(d.fx).inst.length, ph = new Array(L).fill(NaN), at = core.fxLayout(d.fx).inst.findIndex(e => e.type === 'cho');
  ph[at] = 0.375;
  node.port.onmessage({ data: { t: 'smon', fxph: ph } }); // (a legacy node's snapshot: the primary's rack)
  const post = node.port.postMessage, held = [], mon = api.monitors.fx(sxT.id);
  node.port.postMessage = (m, tr) => { if (m && m.t === 'fxph') held.push(m); else post.call(node.port, m, tr); }; // (its answer later)
  try { api.sxSave(acc.instView(sxT, CMOD.primId(sxT)), 'Acc Ph'); } finally { node.port.postMessage = post; }
  const got = () => choPh(api.store.get('synth.user.serum', []).find(x => x.name === 'Acc Ph').fx);
  assert.equal(got(), 0.375, 'the node\'s last phases');
  assert.deepEqual(held.map(m => JSON.stringify(m)), mon ? [] : ['{"t":"fxph"}'], 'monitor off: the rack asked (a legacy node: no part)');
  if (held.length) {
    const v = ph.slice(); v[at] = 0.625;
    node.port.onmessage({ data: { t: 'fxph', v } });
    assert.equal(got(), 0.625, 'the answer completes the stored preset');
  }
});

test('R0 the per-model value memory: save() writes the current classic instrument\'s values under its model; a new track of it starts there; a model change flushes the outgoing one', () => {
  const t = fresh('juno60'), d = P(t);
  d.vals.cf = 4.25;
  api.save();
  assert.equal(api.store.get('synth.v.juno60', {}).cf, 4.25);
  api.selectTrack(sxT.id); sim.raf();
  api.save();
  assert.deepEqual([api.store.get('synth.v.juno60', {}).cf, api.store.get('synth.v.serum', null)], [4.25, null], 'a Serum writes none');
  const u = fresh('juno60');
  assert.equal(P(u).vals.cf, 4.25, 'loadVals: the memory');
  P(u).vals.cf = 5.5;
  api.setTrackModel(u, 'prophet5'); sim.raf();
  assert.deepEqual([api.store.get('synth.v.juno60', {}).cf, P(u).model], [5.5, 'prophet5'], 'flushed before the change');
});

test('R0 the project file: every track\'s v2 devices, mirrored at track level as its primary\'s v1 fields (main opens it)', async () => {
  const o = JSON.parse(await acc.projectFile());
  for (const r of o.tracks) {
    const t = PJ().tracks.find(x => x.id === r.id), v = CM.primV1(t);
    assert.deepEqual([r.model, JSON.stringify(r.vals) === JSON.stringify(v.vals), JSON.stringify(r.fx) === JSON.stringify(v.fx), r.preset === v.preset, !!r.dev], [v.model, true, true, true, true], r.id);
  }
});

test('R0 MIDI import: new tracks of the current instrument\'s model, each with its FX device (a v2 rack), adopted', () => {
  api.selectTrack(sxT.id); sim.raf();
  const src = S.newProject({ model: 'minimoog', vals: {} });
  src.tracks[0].notes = [{ id: 'n1', t: 0, d: 480, n: 60, v: 100 }, { id: 'n2', t: 480, d: 480, n: 64, v: 90 }];
  sxT.notes.push({ id: 'acc1', t: 0, d: 240, n: 50, v: 90 }); // (a project with notes: the import appends)
  const n0 = PJ().tracks.length;
  acc.importMidiFile(S.exportMIDI(src), 'acc.mid'); sim.raf();
  const add = PJ().tracks.slice(n0);
  assert.equal(add.length, 1);
  const t = add[0], f = CMOD.fxDevOf(t);
  assert.deepEqual([P(t).model, !!t.dev, !!f, f && f.dev.fx.v, t.notes.length, CMOD.isAdopted(t)], ['serum', true, true, 2, 2, true]);
});

test('R0 add / duplicate track: a v2 track of the model (its rack, the tray\'s Simple layout); the copy\'s devices equal and its own', () => {
  const t = api.addTrack(MOD('dx7'), null, { ui: 'flow' }); sim.raf();
  const f = CMOD.fxDevOf(t);
  assert.deepEqual([P(t).model, f && f.own, f && f.dev.fx.v, t.lay && t.lay.i1 && t.lay.i1.ui, PJ().selTrack], ['dx7', false, 2, 'flow', t.id]);
  P(t).vals.alg = 7;
  cv.duplicateTrack(t); sim.raf();
  const c = PJ().tracks[PJ().tracks.indexOf(t) + 1];
  assert.deepEqual([c.name, JSON.stringify(c.dev) === JSON.stringify(t.dev), c.dev.i1 === t.dev.i1, CMOD.fxDevOf(c).dev.fx === f.dev.fx, P(c).vals.alg], [t.name + ' copy', true, false, false, 7]);
});

test('R0 the track list and the instrument menu name each track\'s instrument model and its voice mode', () => {
  acc.trkListUI();
  const pop = sim.$('#trkPop'), txt = [];
  for (const b of pop.children) { const tx = b.children && b.children[2]; if (tx && tx.children && tx.children[1]) txt.push(tx.children[1].textContent); }
  const want = PJ().tracks.map(t => MOD(P(t).model).name + ' · ' + (acc.voiceShown.get(VK(t)) || acc.trackVoice(P(t)).label));
  assert.deepEqual(txt, want);
  const items = sh.instItems(sxT), it = items.find(x => x.value === 'serum');
  assert.equal(it.label, 'Serum · ' + (acc.voiceShown.get(VK(sxT)) || acc.trackVoice(P(sxT)).label));
});

test('R0 the multisample zone: zoneWarm reads the shown Serum\'s multisample records, zoneOf gives the recent voice\'s zone sample', async () => {
  api.selectTrack(sxT.id); sim.raf();
  const d = P(sxT), prim = CMOD.primId(sxT), r = acc.sxRec(sxT, prim); // (its panel record: R6, one per Serum)
  d.vals.s.osc[0].type = 'multi'; d.vals.s.osc[0].multi = 'smp:accms';
  acc.msRecs.set('smp:accms', { zones: [{ smp: 'smp:z0' }, { smp: 'smp:z1' }] });
  const was = { ui: r.ui, trackId: r.trackId };
  r.ui = { refresh() {}, destroy() {}, setSnapshot() {}, confirmChange: () => true, snap: { zone: [1, -1, -1] } }; r.trackId = sxT.id;
  try {
    assert.deepEqual([acc.zoneOf(0), acc.zoneOf(1)], ['smp:z1', null]);
    acc.msRecs.delete('smp:accms');
    acc.zoneWarm(sxT.id, prim, { zone: [0, -1, -1] }); // (R2: per Serum device)
    assert.equal(acc.msRecs.has('smp:accms'), true, 'zoneWarm: the record asked for (once)');
    await sim.settle(5);
  } finally { r.ui = was.ui; r.trackId = was.trackId; d.vals.s.osc[0].type = 'wt'; d.vals.s.osc[0].multi = ''; acc.msRecs.delete('smp:accms'); }
});

/* ------------------------------------------------------------ the primary-only paths, with a second instrument (§4.2) */
// (the UI holds one instrument per track since 1f: the hook __synthTest.cv.add puts a second one into the data)
const duo = (prim, other) => { const t = fresh(prim), id = cv.add(other, null); sim.raf(); return { t, id }; };

test('R2 MPE detection: any Serum of the track with MPE on (not only the primary); the MIDI routes follow', async () => {
  const M = await import('../midi.js?v=9');
  const { t, id } = duo('juno60', 'serum');
  assert.equal(M.isMpe(t), false);
  t.dev[id].vals.s.global.mpe.on = 1;
  t.ch = 3;
  assert.deepEqual([M.isMpe(t), M.noteCh(t, 5), M.targets(PJ().tracks, PJ().selTrack, 7).includes(t)], [true, 5, true], 'the second Serum\'s MPE');
  t.dev[id].vals.s.global.mpe.on = 0;
  assert.equal(M.isMpe(t), false);
});

test('R2 MIDI file export: a track\'s instrument name is its primary\'s model (a second instrument is not it)', () => {
  const { t } = duo('dx7', 'serum');
  const bytes = S.exportMIDI({ name: 'x', bpm: 120, sig: [4, 4], bars: 1, tracks: [t] }, {}), txt = new TextDecoder('latin1').decode(bytes);
  assert.deepEqual([txt.includes('dx7'), txt.includes('serum')], [true, false]);
});

test('R2 program change: the primary, named — a Serum that is not the primary keeps its preset', async () => {
  const SU = await import('../serum-ui.js?v=9');
  const { t, id } = duo('minimoog', 'serum'), H = api.sxHost(t, id), was = acc.uiLoad(Promise.resolve({ sx: SU }));
  const before = H.presets.current(), pre = t.dev[id].preset;
  try { acc.programChange([t], 4); for (let k = 0; k < 10; k++) await sim.settle(2); } finally { acc.uiLoad(was); }
  assert.deepEqual([H.presets.current(), t.dev[id].preset], [before, pre]);
});

test('R2 the rate line names every Serum\'s oversampling (a second Serum\'s too); the multisample zone records of any Serum', () => {
  const { t, id } = duo('juno60', 'serum');
  const all = () => PJ().tracks.flatMap(x => CMOD.instIds(x).filter(k => x.dev[k].model === 'serum').map(k => x.dev[k]));
  for (const d of all()) d.vals.s.global.os = 1;
  t.dev[id].vals.s.global.os = 4;
  acc.rateText();
  const sr = sim.ctx().sampleRate, kHz = x => (x / 1000).toFixed(1).replace(/\.0$/, ''), txt = sim.$('#rate').textContent;
  for (const d of all()) d.vals.s.global.os = 2;
  assert.equal(txt.includes('Serum ' + kHz(sr) + '/' + kHz(sr * 4) + ' kHz'), true, txt);
  t.dev[id].vals.s.osc[1].type = 'multi'; t.dev[id].vals.s.osc[1].multi = 'smp:accms2';
  acc.zoneWarm(t.id, id, { zone: [-1, 0, -1] });
  assert.equal(acc.msRecs.has('smp:accms2'), true);
  acc.msRecs.delete('smp:accms2'); t.dev[id].vals.s.osc[1].type = 'wt'; t.dev[id].vals.s.osc[1].multi = '';
});

test('R3 the FX phase memory per rack: syncPhases asks each rack of a graphed track by part and stores each one\'s answer; a Serum\'s preset save takes its own rack\'s', async () => {
  const { t, id } = duo('juno60', 'serum'), pid = CMOD.destOf(t, CMOD.primId(t));
  lfoFx(t.dev[pid].fx); lfoFx(t.dev[id].fx); api.sendPatch(t); sim.raf();
  api.selectTrack(sxT.id); sim.raf(); // (t not shown: its racks are asked)
  const N = api.nodes.get(t.id), node = N.node, n0 = node.posted.length;
  assert.equal(N.graphed, true);
  await acc.syncPhases();
  const asked = node.posted.slice(n0).map(x => x.m).filter(m => m.t === 'fxph').map(m => JSON.stringify(m)).sort();
  assert.deepEqual(asked, [JSON.stringify({ t: 'fxph', c: pid }), JSON.stringify({ t: 'fxph', i: id })].sort(), 'each rack by its part');
  for (const k of [pid, id]) { const ph = choPh(fxOfK(t, k)); assert.equal(typeof ph === 'number' && ph >= 0 && ph < 1, true, k + ': ' + ph); }
  // a snapshot of the Serum's part carries its own rack's phases: its preset save takes them (not the panel's)
  const L = core.fxLayout(t.dev[id].fx).inst.length, at = core.fxLayout(t.dev[id].fx).inst.findIndex(e => e.type === 'cho'), ph = new Array(L).fill(NaN);
  ph[at] = 0.8125;
  node.port.onmessage({ data: { t: 'smon', i: id, fxph: ph } });
  node.port.onmessage({ data: { t: 'smon', c: pid, fxph: [0.25] } });
  const post = node.port.postMessage, held = [];
  node.port.postMessage = (m, tr) => { if (m && m.t === 'fxph') held.push(m); else post.call(node.port, m, tr); };
  try { api.sxSave(acc.instView(t, id), 'Acc Ph2'); } finally { node.port.postMessage = post; }
  assert.equal(choPh(api.store.get('synth.user.serum', []).find(x => x.name === 'Acc Ph2').fx), 0.8125);
  assert.deepEqual(held.map(m => JSON.stringify(m)), [JSON.stringify({ t: 'fxph', i: id })], 'its own rack asked, by its part');
  node.port.onmessage({ data: { t: 'fxph', c: pid, v: [0.5] } }); // (another rack's answer completes nothing here)
  assert.equal(choPh(api.store.get('synth.user.serum', []).find(x => x.name === 'Acc Ph2').fx), 0.8125);
  const v = ph.slice(); v[at] = 0.0625;
  node.port.onmessage({ data: { t: 'fxph', i: id, v } });
  assert.equal(choPh(api.store.get('synth.user.serum', []).find(x => x.name === 'Acc Ph2').fx), 0.0625);
});

test('R5 a load normalises every device, the primary and its FX too: a classic\'s values over its model\'s defaults, a v1 rack migrated, a Serum\'s state', () => {
  const juno = MOD('juno60'), cf = juno.controls.find(c => c.id === 'cf');
  const raw = { name: 'R5', schema: CM.SCHEMA, uid: 'p_r5test0001', tracks: [
    { id: 'trk_r1', name: 'J', prim: 'i1', nid: 3, dev: { i1: { kind: 'synth', model: 'juno60', vals: { cf: cf.def + 1 }, preset: null }, fx1: { kind: 'panel', fx: { p: { 'fx.cho.on': 1 } } }, out: { kind: 'out' } },
      wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] },
    { id: 'trk_r2', name: 'S', prim: 'i1', nid: 2, dev: { i1: { kind: 'synth', model: 'serum', vals: {}, preset: null }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }] },
  ] };
  const p = acc.loadProject(JSON.stringify(raw)), [a, b] = p.tracks;
  assert.deepEqual(Object.keys(a.dev.i1.vals).sort(), juno.controls.map(c => c.id).sort(), 'every control of the model');
  assert.equal(a.dev.i1.vals.cf, cf.def + 1, 'its own value kept');
  assert.deepEqual([a.dev.fx1.fx.v, b.dev.i1.fx.v, typeof b.dev.i1.vals.s.global], [2, 2, 'object'], 'the v1 rack migrated; the Serum normalised with its own rack');
  assert.deepEqual(p.tracks.map(t => Object.keys(t).filter(k => CM.V1_KEYS.includes(k))), [[], []], 'no own v1 field on a track');
});

test('R4 the session maps are keyed trackId/dev, the primary\'s too: two Serums keep their own preset key, dirty mark and current preset; a rename follows the one that loaded it', () => {
  const { t, id } = duo('serum', 'serum'), prim = CMOD.primId(t), H1 = api.sxHost(t, prim), H2 = api.sxHost(t, id);
  acc.sxDirty.clear();
  assert.equal(H2.presets.save({ name: 'Acc Two' }), 'u:Acc Two');
  assert.deepEqual([acc.sxKeys.get(VK(t, id)), acc.sxKeys.has(VK(t)), acc.sxKeys.has(t.id)], ['u:Acc Two', false, false], 'the second Serum\'s key only');
  assert.deepEqual([H2.presets.current(), H1.presets.current() === 'u:Acc Two'], ['u:Acc Two', false]);
  H1.edit(s => { s.p['f.cutoff'] = 0.3; });
  assert.deepEqual([acc.sxDirty.has(VK(t)), acc.sxDirty.has(VK(t, id)), acc.sxDirty.has(t.id)], [true, false, false], 'the edited Serum alone is dirty');
  assert.equal(H2.presets.rename('u:Acc Two', 'Acc Deux'), 'u:Acc Deux');
  assert.deepEqual([t.dev[id].preset, t.dev[prim].preset === 'Acc Deux'], ['Acc Deux', false]);
  H1.presets.save({ name: 'Acc One' });
  assert.deepEqual([acc.sxKeys.get(VK(t)), acc.sxKeys.get(VK(t, id))], ['u:Acc One', 'u:Acc Deux']);
});

test('R4 a classic\'s preset key and its hardware state (DX7 select-and-set, TB-303 step entry) are per instrument; the primary\'s key is trackId/dev', () => {
  const { t, id } = duo('dx7', 'dx7'), prim = CMOD.primId(t), a = acc.instView(t, prim), b = acc.instView(t, id);
  assert.deepEqual([a.id, b.id], [VK(t), VK(t, id)]);
  acc.hwDx(a).state.op = 3;
  assert.deepEqual([acc.hwDx(b).state.op, acc.hwDx(a).state.op, acc.dxHw.has(t.id)], [1, 3, false]);
  const was = globalThis.prompt;
  globalThis.prompt = () => 'Acc DX';
  try { acc.presetSave(b); } finally { globalThis.prompt = was; }
  assert.deepEqual([acc.presetKeys.has(VK(t, id)), acc.presetKeys.has(VK(t)), t.dev[id].preset, t.dev[prim].preset === 'Acc DX'], [true, false, 'Acc DX', false]);
  assert.equal(acc.presetCur(b).name, 'Acc DX');
  acc.presetDelete(b);
});

test('R4 the asset manager reads every Serum and panel (states()): a sample a second Serum plays is in use; a relink edits that Serum', async () => {
  const { t, id } = duo('juno60', 'serum');
  t.dev[id].vals.s.osc[0].type = 'sample'; t.dev[id].vals.s.osc[0].smp = 'smp:accuser1';
  const S0 = api.tables.host.smp;
  assert.deepEqual(S0.users('smp:accuser1'), [t.name], 'in use (named by its track)');
  await api.tables.relink('smp:accuser1', 'smp:accuser2');
  assert.equal(t.dev[id].vals.s.osc[0].smp, 'smp:accuser2', 'relinked in the second Serum');
  assert.equal(acc.sxDirty.has(VK(t, id)), true, 'through its own edit (sxEdit on its view)');
  t.dev[id].vals.s.osc[0].type = 'wt'; t.dev[id].vals.s.osc[0].smp = '';
});

test('R6 the per-model value memory is the current instrument\'s view (no globals): a second instrument\'s values are not written', () => {
  const { t, id } = duo('juno60', 'dx7'), dx0 = JSON.stringify(api.store.get('synth.v.dx7', null));
  P(t).vals.cf = 3.75; t.dev[id].vals.alg = 9;
  api.save();
  assert.deepEqual([api.store.get('synth.v.juno60', {}).cf, JSON.stringify(api.store.get('synth.v.dx7', null)) === dx0], [3.75, true]);
  assert.equal(acc.curModel().id, 'juno60', 'the current instrument: the primary (1f)');
  api.setTrackModel(acc.instView(t, id), 'prophet5'); sim.raf(); // (the second one replaced: the memory stays the current one's)
  assert.equal(JSON.stringify(api.store.get('synth.v.dx7', null)) === dx0, true);
});

test('R6 homes and singletons: every instrument\'s body and panel record its own, the primary\'s too; zoneOf reads the asked Serum\'s record', () => {
  const { t, id } = duo('serum', 'serum'), prim = CMOD.primId(t);
  assert.deepEqual([cv.bodyEl(prim) === cv.bodyEl(id), 'inst' in cv.parts, 'fx' in cv.parts, cv.sxRec(t, prim) === cv.sxRec(t, id)], [false, false, false, false]);
  assert.equal(cv.fxRec(t, prim + '/fx') === cv.fxRec(t, id + '/fx'), false);
  const recs = [acc.sxRec(t, prim), acc.sxRec(t, id)], was = recs.map(r => ({ ui: r.ui, trackId: r.trackId }));
  for (const [k, dev] of [[0, prim], [1, id]]) { const d = t.dev[dev]; d.vals.s.osc[0].type = 'multi'; d.vals.s.osc[0].multi = 'smp:accz' + k; acc.msRecs.set('smp:accz' + k, { zones: [{ smp: 'smp:z' + k + 'a' }, { smp: 'smp:z' + k + 'b' }] }); }
  recs[0].ui = { refresh() {}, destroy() {}, snap: { zone: [0, -1, -1] } }; recs[1].ui = { refresh() {}, destroy() {}, snap: { zone: [1, -1, -1] } };
  recs[0].trackId = recs[1].trackId = t.id;
  try {
    assert.deepEqual([acc.zoneOf(0), acc.zoneOf(0, prim), acc.zoneOf(0, id)], ['smp:z0a', 'smp:z0a', 'smp:z1b'], 'default: the current Serum\'s');
  } finally {
    recs.forEach((r, k) => Object.assign(r, was[k]));
    for (const [k, dev] of [[0, prim], [1, id]]) { t.dev[dev].vals.s.osc[0].type = 'wt'; t.dev[dev].vals.s.osc[0].multi = ''; acc.msRecs.delete('smp:accz' + k); }
  }
});

test('R7 the accessors are gone: after a load, undo / redo, add / duplicate track and MIDI import no track has an own v1 field; the sim (a guard build) holds throwing guard accessors; production adopt installs nothing', async () => {
  const V1 = CM.V1_KEYS, check = what => {
    for (const t of PJ().tracks) {
      assert.deepEqual(Object.keys(t).filter(k => V1.includes(k)), [], what + ': ' + t.id + ' has no own v1 field');
      const ds = Object.getOwnPropertyDescriptor(t, 'model');
      assert.deepEqual([!!ds && typeof ds.get, !!ds && ds.enumerable], ['function', false], what + ': the guard descriptor');
      assert.throws(() => t.vals, /has no v1 fields/, what);
      assert.throws(() => { t.fx = {}; }, /has no v1 fields/, what);
    }
  };
  check('boot');
  const t = fresh('juno60'); check('add track');
  cv.duplicateTrack(t); sim.raf(); check('duplicate');
  cv.undo(); sim.raf(); check('undo');
  cv.redo(); sim.raf(); check('redo');
  sxT.notes.push({ id: 'acc7', t: 0, d: 240, n: 52, v: 90 });
  const src = S.newProject({ model: 'minimoog', vals: {} });
  src.tracks[0].notes = [{ id: 'n1', t: 0, d: 480, n: 60, v: 100 }];
  acc.importMidiFile(S.exportMIDI(src), 'acc7.mid'); sim.raf(); check('MIDI import');
  const p = acc.loadProject(JSON.stringify(JSON.parse(await acc.projectFile())));
  assert.deepEqual(p.tracks.map(x => Object.keys(x).filter(k => V1.includes(k))), p.tracks.map(() => []), 'a file (its v1 mirror at track level) loads without it');
  const prod = CMOD.adopt(JSON.parse(JSON.stringify({ tracks: PJ().tracks })));
  assert.deepEqual(prod.tracks.map(x => V1.some(k => k in x)), prod.tracks.map(() => false), 'production adopt: \'model\' in t === false');
});

test('R2 Resample to on a second Serum: rendered alone through its own patch (buildInstPatch), into its own oscillator', async () => {
  const { t, id } = duo('juno60', 'serum');
  const iv = acc.instView(t, id), want = sha(api.buildInstPatch(t, id, 44100, true)), prim = JSON.stringify(P(t).vals);
  await api.resampleTo(iv, 'A');
  assert.deepEqual([sha(sim.lastOffline.nodes[0].po.patch), /^user:/.test(t.dev[id].vals.s.osc[0].wt), JSON.stringify(P(t).vals) === prim], [want, true, true]);
});
