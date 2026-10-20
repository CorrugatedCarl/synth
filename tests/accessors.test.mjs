import './v8-guard.mjs';
// The accessor retirement's characterisation tests (milestone 3, IMPL-3 §4.3 R0 → R7, §4.2, §7 Accessors N5): what the
// services that read a track's v1 fields (the 1e transition accessors) do for the primary instrument, written against
// the behaviour before any of them moved — preset save / delete, Serum preset current / rename / save (its FX phase
// capture), program change, Mod wheel → WT Pos, the FX rack host, Resample's and render-last's patches (the primary
// renders through buildPatch: its bytes), the FX phase read-back, the per-model value memory synth.v.<model>, the project
// file's mirror, MIDI import, add / duplicate track, the track list, the instrument menu, the multisample zone — and,
// as the steps make each primary-only path per device (§4.2), the same service on a non-primary device in the data
// (the UI holds one instrument per track since 1f; the hook __synthTest.cv.add adds a second).
// Every track is read through its devices here (P(t) = cv-model instOf), never through a track's v1 fields.
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
  const want = PJ().tracks.map(t => MOD(P(t).model).name + ' · ' + (acc.voiceShown.get(t.id) || acc.trackVoice(P(t)).label));
  assert.deepEqual(txt, want);
  const items = sh.instItems(sxT), it = items.find(x => x.value === 'serum');
  assert.equal(it.label, 'Serum · ' + (acc.voiceShown.get(sxT.id) || acc.trackVoice(P(sxT)).label));
});

test('R0 the multisample zone: zoneWarm reads the shown Serum\'s multisample records, zoneOf gives the recent voice\'s zone sample', async () => {
  api.selectTrack(sxT.id); sim.raf();
  const d = P(sxT), prim = CMOD.primId(sxT), r = acc.sxRecOf(sxT.id, prim);
  d.vals.s.osc[0].type = 'multi'; d.vals.s.osc[0].multi = 'smp:accms';
  acc.msRecs.set('smp:accms', { zones: [{ smp: 'smp:z0' }, { smp: 'smp:z1' }] });
  const was = { ui: r.ui, trackId: r.trackId };
  r.ui = { refresh() {}, destroy() {}, setSnapshot() {}, confirmChange: () => true, snap: { zone: [1, -1, -1] } }; r.trackId = sxT.id;
  try {
    assert.deepEqual([acc.zoneOf(0), acc.zoneOf(1)], ['smp:z1', null]);
    acc.msRecs.delete('smp:accms');
    acc.zoneWarm(sxT.id, { zone: [0, -1, -1] });
    assert.equal(acc.msRecs.has('smp:accms'), true, 'zoneWarm: the record asked for (once)');
    await sim.settle(5);
  } finally { r.ui = was.ui; r.trackId = was.trackId; d.vals.s.osc[0].type = 'wt'; d.vals.s.osc[0].multi = ''; acc.msRecs.delete('smp:accms'); }
});
