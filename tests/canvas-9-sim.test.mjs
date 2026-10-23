import './v8-guard.mjs';
// Stage 9 lane H9 (docs/canvas/IMPL-9.md §6, §8.7): the 900 Series in the page simulation with the real engine — main.js wires
// patch-core's record (dev.patch; knobs in vals, vals.p the modules'), cv-patch's host (PATCH: the plug drag, the menus, the
// modules' faces), the graph payload ({t: 'seq', s: {pg, pk}}: posted when its content changes), P-1 (a muted / soloed-out
// patch powered off: a patch track is graphed), ptBack (a knob-writing step's knobs back on undo), the Moog modules view, Tidy's
// rack, the project (schema 12, pruneVals at load) and the bounce (a Drone without notes). First the lead's fixture check
// (§7.2 phase 2). Accessor-free: the app runs as a guard build (a track's v1 keys throw) — instruments read as devices (cv-model
// instOf), the hosts through the __synthTest hooks. canvas-sim's scripted world with a recording cord layer (world.cords(): the
// stand-in for cv-cords, lane C9); one boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-9-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as PT from '../patch-core.js?v=9';
import * as MG from '../moog-core.js?v=9';
import * as cvPatch from '../cv-patch.js?v=9';
import { MODELS } from '../models.js?v=9';
import * as cvWorld from '../cv-world.js?v=9';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
// the cord layer's stand-in (§7.4's interface): every call recorded, the last set / anchors kept
const CORDS = { calls: [], list: null, anchors: null, on: null };
for (const k of ['live', 'grab', 'move', 'drop', 'sel', 'resize', 'step', 'draw', 'destroy', 'dim']) CORDS[k] = (...a) => { CORDS.calls.push([k, a.length ? JSON.parse(JSON.stringify(a[0] === undefined ? null : a[0])) : null]); };
CORDS.set = L => { CORDS.calls.push(['set', L.length]); CORDS.list = JSON.parse(JSON.stringify(L)); };
CORDS.anchors = M => { CORDS.calls.push(['anchors', M.size]); CORDS.at = M; };
CORDS.alloc = on => { CORDS.calls.push(['alloc', !!on]); CORDS.on = !!on; };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, mode: 'always',
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem() {}, dragPointer() {}, ghost: g => (g ? { x: 0, y: 0, w: g.w, h: g.h } : null), setDragging() {},
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
    cords: () => CORDS,
    // (9, review 2 F2) the host's fit: cv-world's own fitCam over what the hook names (every item without one), the band as the box
    setFitHook(fn) { W.fitHook = typeof fn === 'function' ? fn : null; return () => { if (W.fitHook === fn) W.fitHook = null; }; },
    fit() {
      const h = W.fitHook ? W.fitHook() : null, b = W.band(), ids = h && Array.isArray(h.ids) ? h.ids.filter(id => W.items.has(id)) : [...W.items.keys()];
      const c = cvWorld.fitCam(ids.map(id => W.items.get(id).rect()), b.right - b.left, b.bottom - b.top, { pad: 48, kMin: h && h.kMin, foot: !!(h && h.foot) });
      W.setCamera({ tx: c.tx + b.left - VP.left, ty: c.ty + b.top - VP.top, k: c.k });
    },
  };
  return W;
}

const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), I = (t, dev) => CMOD.instOf(t, dev);
const byId = id => P().tracks.find(t => t.id === id);
const node = t => sim.nodeOf(t.id);
const sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const dev = (t = T()) => CMOD.primId(t);
const rec = (t = T()) => cv.patchOf(t, dev(t));
const vals = (t = T()) => I(t, dev(t)).vals;
const midOf = (type, n = 1, r = rec()) => Object.keys(r.mods).filter(k => r.mods[k].t === type).sort((a, b) => +a.slice(1) - +b.slice(1))[n - 1];
const cordJack = end => { const k = cvPatch.jackKey(dev(), end), J = cv.view().jacks().find(j => j.id === k); return J ? J.el : null; };
// a plug drag on a cord jack through the cable drag (cv-cables → o.cordPress → cv-patch), the finger released at (x, y)
function drag(end, x, y) {
  const el = cordJack(end), D = cv.mod.cableDrag(), id = 7 + drag.n++;
  const p = cv.world().toClient(cv.view().ports().get(cvPatch.jackKey(dev(), end)).x, cv.view().ports().get(cvPatch.jackKey(dev(), end)).y);
  const ev = (type, cx, cy) => ({ type, pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: cx, clientY: cy, target: el, preventDefault() {}, stopPropagation() {} });
  const r = D.press(ev('pointerdown', p.x, p.y), el);
  if (!r) return false;
  fire(ev('pointermove', p.x + 12, p.y + 12));
  fire(ev('pointermove', x, y));
  fire(ev('pointerup', x, y));
  return true;
}
// a document event to its listeners (the stub keeps them in dom.docL; its removeEventListener is a no-op: a finished drag's
// handlers stay, and ignore a pointer that is not theirs)
function fire(e) { for (const f of (sim.dom.docL[e.type] || []).slice()) f(e); }
drag.n = 0;
const ID = {};

test('the lead\'s fixture check (§7.2 phase 2): the Model 15 tile on track 1 → a 900 Series whose node gets the patch and its graph payload; a note → {t: on}, it sounds; a cord pulled → a new pk posted, one History step; undo → the cord back, the knobs kept', async () => {
  const tiles = sh.shell.tiles;
  tiles.setView('moog');
  assert.deepEqual(tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), ['m900'], 'the Moog modules view: the Model 15 tile');
  assert.deepEqual(tiles.setTiles().filter(b => !b.hidden).map(b => b.getAttribute('data-set')), ['s35', 's55'], '(9b) the set tiles System 35 / System 55 beside it');
  assert.equal(MG.ORDER.length, 25, '(9b) stage 9\'s nine module types and the sixteen of the System 35 / 55');
  assert.deepEqual(tiles.moogTiles().filter(b => !b.hidden).map(b => b.getAttribute('data-moog')), [...MG.ORDER], 'then the module tiles');
  sh.srcPick('m900', 'replace'); await settle();
  const t = T(), d = I(t, dev(t));
  assert.equal(d.model, 'm900');
  assert.match(note(), /^Replaced Minimoog with 900 Series · tap to undo$/);
  const ref = MG.model15({ p: {} });
  assert.equal(JSON.stringify(rec()), JSON.stringify(ref.rec), 'the Model 15 set patched as Classic bass');
  assert.equal(JSON.stringify(vals().p), JSON.stringify(ref.vals.p), 'its knobs');
  assert.equal(rec().name, 'Classic bass');
  // the node: the patch (kind 'patch', its knobs), the graph payload with its content key
  const pt = sent(t, 'patch').filter(m => m.i === dev(t)).at(-1), sq = sent(t, 'seq').filter(m => m.i === dev(t) && m.s && m.s.pg).at(-1);
  assert.equal(pt.p.engine, 'patch', '{t: patch}: the patch kind');
  assert.equal(pt.p.pv.m7 && pt.p.pv.m7._t, '904a', 'its pv: the modules\' knobs by number');
  assert.equal(JSON.stringify(sq.s), JSON.stringify(PT.payload(rec(), 'moog')), '{t: seq}: the graph payload');
  ID.pk0 = sq.s.pk;
  // a note: {t: on} — the patch sounds
  node(t).posted.length = 0;
  api.noteOn(48, 100, 0);
  assert.equal(sent(t, 'on').some(m => m.n === 48), true, '{t: on}');
  const out = sim.run(12000).get(node(t));
  api.noteOff(48, 0); await settle();
  assert.ok(peak(out.L) > 1e-3, 'the patch sounds (' + peak(out.L).toFixed(4) + ')');
  // a 904A knob turned (the knob policy: no step), then a cord pulled out by its plug (one step, a new pk)
  const m7 = midOf('904a');
  assert.equal(m7, 'm7');
  const n0 = cv.hist.u.length;
  cv.patch.knobSet(t, dev(t), m7, 'fc', 2.5); await settle();
  assert.deepEqual([cv.hist.u.length - n0, vals().p.m7.fc], [0, 2.5], 'a knob: no History step');
  const c1 = rec().cords.find(c => c.a === 'c.kp1');
  node(t).posted.length = 0;
  assert.equal(drag('c.kp1', 4000, 3000), true, 'the plug pressed');
  await settle();
  assert.equal(rec().cords.some(c => c.id === c1.id), false, 'the cord came out');
  assert.equal(cv.hist.u.length - n0, 1, 'one History step');
  assert.equal(cv.hist.u.at(-1).label, 'Pull cord');
  assert.match(note(), /^Cord pulled · tap to undo$/);
  const pk1 = sent(t, 'seq').filter(m => m.s && m.s.pg).map(m => m.s.pk);
  assert.deepEqual(pk1, [PT.payload(rec(), 'moog').pk], 'one payload, the new pk');
  assert.notEqual(pk1[0], ID.pk0);
  // undo: the cord back, the knob as turned, the old pk posted again
  node(t).posted.length = 0;
  cv.undo(); await settle();
  assert.equal(rec().cords.some(c => c.id === c1.id && c.a === 'c.kp1' && c.b === c1.b), true, 'the cord back');
  assert.equal(vals().p.m7.fc, 2.5, 'the knob kept (keepDevs)');
  assert.deepEqual(sent(T(), 'seq').filter(m => m.s && m.s.pg).map(m => m.s.pk), [ID.pk0], 'the old graph again');
  ID.t1 = t.id;
});

const posOf = k => { const m = cv.view().modules.get(k); return m ? { x: Math.round(m.x), y: Math.round(m.y) } : null; };
const pmKeys = (t = T()) => Object.keys(rec(t).mods).map(mid => dev(t) + '/' + mid);
const sizeOf = k => { const r = cv.view().modules.get(k).rect(); return [r.w, r.h]; };
// the rack as Tidy places it (patch-core rackLayout over the controller's top-left), world px
const rackAt = (t = T()) => { const c = posOf(dev(t)), R = PT.rackLayout(rec(t), 'moog'), o = {}; for (const mid of Object.keys(R)) o[dev(t) + '/' + mid] = { x: c.x + R[mid].x, y: c.y + R[mid].y }; return o; };
const seqPk = t => sent(t, 'seq').filter(m => m.s && m.s.pg).map(m => m.s.pk);
const MODEL = id => MODELS.find(m => m.id === id);

test('§4.1 / §4.5: the rack laid out — the controller (the instrument\'s module: the console, its face jacks) and the twelve modules (their MU sizes, a face jack per jack, faces mounted) in Tidy\'s rows above it; the default camera frames them; the cords to the cord layer (jack keys, colours, S plugs) with every anchor', async () => {
  const t = T(), V = cv.view();
  assert.deepEqual(sizeOf(dev(t)), [864, 352], 'the controller: the console face');
  assert.equal(V.modules.get(dev(t)).jackIds().filter(j => j.startsWith(cvPatch.JACK_PRE)).length, 27, 'its 27 patch jacks');
  for (const k of pmKeys(t)) {
    const ty = rec(t).mods[k.split('/')[1]].t, T0 = MG.TYPES[ty];
    assert.deepEqual(sizeOf(k), [T0.w, T0.h], k + ': its MU size');
    assert.equal(V.modules.get(k).jackIds().length, T0.jacks.length, k + ': a face jack per jack');
    assert.equal(cv.pmBodies.has(k), true, k + ': its face mounted');
  }
  const R = rackAt(t);
  for (const k of Object.keys(R)) assert.deepEqual(posOf(k), R[k], k + ': Tidy\'s place');
  assert.equal(Object.keys(R).every(k => R[k].y < posOf(dev(t)).y), true, 'every module above the controller');
  assert.deepEqual([V.modules.get(dev(t) + '/m3').title, V.modules.get(dev(t) + '/m4').title], ['921B 1', '921B 2'], 'titled by type and ordinal');
  const W = cv.world();
  assert.equal(W.k >= 0.5 && W.k <= 1, true, 'the camera: never below READ_K (' + W.k + ')');
  const top = W.toClient(posOf(dev(t)).x, Math.min(...Object.values(R).map(p => p.y)));
  assert.equal(top.y >= BAND.top && top.y < BAND.top + 40, true, 'the rack\'s top framed at the band\'s');
  // the cord layer: the record's cords as jack keys, every anchor, its buffer on
  assert.equal(CORDS.on, true, 'the buffer while a 900 Series is shown');
  assert.equal(JSON.stringify(CORDS.list), JSON.stringify(cvPatch.cordList(dev(t), rec(t))), 'set: the cords');
  assert.equal(CORDS.list.filter(c => c.s).map(c => c.id).join(), 'c12,c14', 'the S-trigger cords: Cinch-Jones plugs');
  for (const c of CORDS.list) assert.equal(CORDS.at.has(c.a) && CORDS.at.has(c.b), true, c.id + ': its anchors');
});

test('§1.4: a module tile on another track → a 900 Series with the controller and that module, nothing patched (a Replace, tap to undo); on a 900 Series track → added (one step, "Add 911", the Tidy-placed modules pinned); + Track → a new 900 Series with it; a drop where it lands', async () => {
  api.addTrack(MODEL('juno60')); await settle();
  const t2 = T();
  assert.equal(I(t2, dev(t2)).model, 'juno60');
  cv.moogPick('904a', 'replace'); await settle();
  assert.equal(I(T(), dev()).model, 'm900');
  assert.match(note(), /^Replaced Juno-60 with 900 Series · tap to undo$/);
  assert.deepEqual([JSON.stringify(rec().mods), rec().cords.length], ['{"m1":{"t":"904a"}}', 0], 'the controller and the 904A, nothing patched');
  const n0 = cv.hist.u.length;
  cv.moogPick('911', 'replace'); await settle();
  assert.deepEqual([cv.hist.u.length - n0, cv.hist.u.at(-1).label, JSON.stringify(rec().mods)], [1, 'Add 911', '{"m1":{"t":"904a"},"m2":{"t":"911"}}'], 'one step');
  const lay = T().lay;
  assert.equal(!!lay[dev() + '/m2'] && !!lay[dev() + '/m1'], true, 'the new module placed, the other pinned in the same step');
  assert.equal(cv.view().modules.has(dev() + '/m2'), true);
  cv.undo(); await settle();
  assert.deepEqual([JSON.stringify(rec().mods), !!(T().lay || {})[dev() + '/m1']], ['{"m1":{"t":"904a"}}', false], 'undone: the add and its pins');
  cv.redo(); await settle();
  ID.t2 = t2.id;
  const nT = P().tracks.length;
  cv.moogPick('921', 'track'); await settle();
  assert.equal(P().tracks.length, nT + 1, '+ Track');
  assert.deepEqual([I(T(), dev()).model, JSON.stringify(rec().mods)], ['m900', '{"m1":{"t":"921"}}'], 'a new 900 Series with the 921');
  ID.t3 = T().id;
  // a tile dropped on the canvas of a 900 Series: where it lands (the ghost's place, on the dots)
  cv.moogDrag.begin('902', { over: 'canvas', x: 500, y: 300 });
  cv.moogDrag.drop('902', { over: 'canvas', x: 500, y: 300, at: { x: -301, y: -700 } });
  await settle();
  assert.deepEqual([rec().mods.m2 && rec().mods.m2.t, cv.hist.u.at(-1).label, JSON.stringify(T().lay[dev() + '/m2'])], ['902', 'Add 902', JSON.stringify({ x: 0, y: 0 })], 'dropped: at the ghost\'s place (the scripted world\'s ghost sits at 0, 0)');
});

test('§1.5: a cord plugged, re-patched and recoloured — one History step each; a topology change posts a new pk, a colour none (an unchanged pk is not reposted)', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), k0 = cv.hist.u.length;
  node(t).posted.length = 0;
  const to = cv.view().ports().get(cvPatch.jackKey(dev(), 'c.m4')), c = cv.world().toClient(to.x, to.y);
  assert.equal(drag('m1.tri', c.x + 3, c.y - 2), true);
  await settle();
  const cd = rec().cords.find(x => x.a === 'm1.tri');
  assert.deepEqual([!!cd && cd.b, cv.hist.u.length - k0, cv.hist.u.at(-1).label], ['c.m4', 1, 'Patch cord'], 'plugged: one step');
  assert.deepEqual(seqPk(t), [PT.payload(rec(), 'moog').pk], 'its graph posted');
  assert.equal(CORDS.list.some(x => x.id === cd.id), true, 'the cord layer has it');
  // re-patch: its plug pulled from c.m4 to the second 902's upper input
  node(t).posted.length = 0;
  const q = cv.view().ports().get(cvPatch.jackKey(dev(), 'm12.i1')), qc = cv.world().toClient(q.x, q.y);
  assert.equal(drag('c.m4', qc.x, qc.y), true);
  await settle();
  assert.deepEqual([rec().cords.find(x => x.id === cd.id).b, cv.hist.u.length - k0, cv.hist.u.at(-1).label], ['m12.i1', 2, 'Re-patch cord'], 're-patched: one step');
  assert.equal(seqPk(t).length, 1, 'one payload');
  // its colour from the cord menu (a tap on the plug): one step, no payload (pk unchanged)
  node(t).posted.length = 0;
  const M = cv.patch.menu(cvPatch.jackKey(dev(), 'm12.i1')), sw = M.el.children[1].children;
  assert.equal(sw.length, 8, 'eight swatches');
  sw[5].dispatchEvent({ type: 'click', stopPropagation() {} });
  await settle();
  assert.deepEqual([rec().cords.find(x => x.id === cd.id).c, cv.hist.u.length - k0, cv.hist.u.at(-1).label], [5, 3, 'Cord colour'], 'recoloured: one step');
  assert.deepEqual(seqPk(t), [], 'no payload: the graph is unchanged');
  assert.equal(CORDS.list.find(x => x.id === cd.id).c, 5, 'the cord layer recoloured');
  // the plug dropped back on its own jack: no step
  assert.equal(drag('m12.i1', qc.x, qc.y), true);
  await settle();
  assert.equal(cv.hist.u.length - k0, 3, 'nothing changed: no step');
  cv.undo(); cv.undo(); cv.undo(); await settle();
  assert.equal(rec().cords.some(x => x.id === cd.id), false);
  assert.equal(seqPk(t).at(-1), ID.pk0, 'the Classic bass graph again');
});

test('§1.5 Q4: delete a module with its cords — one step ("Deleted 904A 1 and 4 cords · tap to undo"); its tap brings the module, its cords, its place and its knobs back', async () => {
  const t = T(), before = JSON.stringify(rec()), lay0 = JSON.stringify(T().lay || {});
  cv.patch.knobSet(t, dev(t), 'm7', 're', 6.5); await settle();
  const n0 = cv.hist.u.length;
  assert.equal(cv.patch.remove('m7'), true);
  await settle();
  assert.deepEqual([!!rec().mods.m7, rec().cords.filter(c => /^m7\./.test(c.a) || /^m7\./.test(c.b)).length, cv.hist.u.length - n0], [false, 0, 1], 'gone with its cords');
  assert.match(note(), /^Deleted 904A 1 and 4 cords · tap to undo$/);
  assert.equal(cv.view().modules.has(dev() + '/m7'), false);
  assert.equal(vals().p.m7.re, 6.5, 'its knobs kept as an orphan (§1.2)');
  sim.$('#notice').onclick(); await settle(); // (the notice's tap: its step is the newest)
  assert.equal(JSON.stringify(rec()), before, 'module and cords back');
  assert.equal(JSON.stringify(T().lay || {}), lay0, 'its place as it was');
  assert.equal(cv.view().modules.has(dev() + '/m7'), true);
  assert.equal(vals().p.m7.re, 6.5, 'its knobs');
  cv.patch.knobSet(T(), dev(), 'm7', 're', 3); await settle();
});

test('§1.5 review #2: add a 904A, turn it, undo, add a 911 — the 911 gets its own number (never the orphan\'s) and its defaults', async () => {
  const n = rec().nid;
  const a = cv.patch.add('904a'); await settle();
  assert.equal(a, 'm' + n);
  cv.patch.knobSet(T(), dev(), a, 'fc', -4); await settle();
  cv.undo(); await settle();
  assert.deepEqual([!!rec().mods[a], vals().p[a].fc, rec().nid], [false, -4, n], 'undone: the record\'s nid back, the orphan\'s knobs live on');
  const b = cv.patch.add('911'); await settle();
  assert.equal(b, 'm' + (n + 1), 'its own number');
  for (const c of MG.TYPES['911'].params) assert.equal(cv.patch.knobGet(T(), dev(), b, c.id), c.def, 'its default: ' + c.id);
  cv.undo(); await settle();
});

test('§2.5 / §1.5: a preset (⋯ → Patches) is one step with "tap to undo" — its knobs posted, then its graph; the topology and every knob it wrote come back (ptBack); a knob turned after the load: the undo says so and leaves the knobs as they are', async () => {
  const t = T(), r0 = JSON.stringify(rec()), v0 = JSON.stringify(vals());
  const items = cv.menu(dev(t)), pat = items.find(x => x.label === 'Patches');
  assert.deepEqual(pat.sub.filter(x => !x.sep).map(x => x.label), [...PT.presetNames('moog'), 'Init patch'], 'the controller\'s ⋯ → Patches');
  assert.equal(items.some(x => /sound|layout|Fold/i.test(x.label || '')), false, 'no classic sound / layout items, no fold');
  node(t).posted.length = 0;
  pat.sub.find(x => x.label === 'Drone').action(); await settle();
  assert.deepEqual([rec().name, cv.hist.u.at(-1).label, cv.hist.u.at(-1).meta.pt], ['Drone', 'Load Drone', 1]);
  assert.match(note(), /^Loaded Drone · tap to undo$/);
  const pts = node(t).posted.map(x => x.m).filter(m => (m.t === 'patch' || m.t === 'seq') && m.i === dev(t)).map(m => m.t);
  assert.deepEqual(pts.slice(0, 2), ['patch', 'seq'], 'the knobs it wrote, then its graph');
  const drone = JSON.stringify(vals());
  assert.notEqual(drone, v0);
  sim.$('#notice').onclick(); await settle();
  assert.equal(JSON.stringify(rec()), r0, 'the topology back');
  assert.equal(JSON.stringify(vals()), v0, 'every knob it wrote back');
  cv.redo(); await settle();
  assert.equal(JSON.stringify(vals()), drone, 'redo: its knobs again');
  // a knob the preset wrote, turned since: the undo restores the topology and leaves every knob as it is, saying so
  const m902 = midOf('902');
  cv.patch.knobSet(T(), dev(), m902, 'fc', 1.25); await settle();
  cv.undo(); await settle();
  assert.equal(JSON.stringify(rec()), r0, 'the topology back');
  assert.match(note(), /^900 Series changed since: its knobs left as they are$/);
  assert.equal(vals().p[m902].fc, 1.25, 'left as it is');
  cv.patch.knobSet(T(), dev(), m902, 'fc', JSON.parse(v0).p[m902].fc); await settle();
});

test('§1.4 review #2: the Model 15 tile on a 900 Series track is Classic bass loaded as a preset (the missing modules added), never a same-model Replace', async () => {
  cv.patch.remove('m8'); await settle(); // (the 907A)
  const n0 = cv.hist.u.length, d0 = I(T(), dev());
  sh.srcPick('m900', 'replace'); await settle();
  assert.deepEqual([cv.hist.u.length - n0, cv.hist.u.at(-1).label, I(T(), dev()) === d0], [1, 'Load Classic bass', true], 'one preset step, the device kept');
  assert.match(note(), /^Loaded Classic bass · tap to undo$/);
  assert.equal(Object.values(rec().mods).filter(m => m.t === '907a').length, 1, 'the 907A added back');
  cv.undo(); cv.undo(); await settle();
  assert.equal(!!rec().mods.m8, true);
});

test('§4.5: Tidy (⋯ → Tidy patch, and the canvas\') puts every module back in its row above the controller', async () => {
  const t = T(), n0 = cv.hist.u.length;
  const d = cv.patch.duplicate('m9'); await settle(); // (a second copy of the first 911, beside it: off the rows' order)
  const k = dev() + '/' + d;
  assert.notDeepEqual(posOf(k), rackAt()[k], 'the duplicate off its rack place');
  cv.menu(dev(t)).find(x => x.label === 'Tidy patch').action(); await settle();
  assert.equal(cv.hist.u.at(-1).label, 'Tidy patch');
  const R = rackAt();
  for (const key of Object.keys(R)) assert.deepEqual(posOf(key), R[key], key);
  cv.patch.knobSet(T(), dev(), d, 't1', 2); await settle();
  cv.tidy(); await settle();
  for (const key of Object.keys(R)) assert.deepEqual(posOf(key), R[key], key + ' (the canvas\' Tidy)');
  while (cv.hist.u.length > n0) cv.undo();
  await settle();
  assert.equal(!!rec().mods[d], false);
});

test('§6: a track switch, a panic or an undo mid-drag cancels it (a new cord vanishes, no step); the cord layer follows the shown track ([] and no buffer without a 900 Series)', async () => {
  const p = cv.view().ports().get(cvPatch.jackKey(dev(), 'm1.tri')), c = cv.world().toClient(p.x, p.y), el = cordJack('m1.tri');
  const start = id => {
    const ev = (type, x, y) => ({ type, pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: y, target: el, preventDefault() {}, stopPropagation() {} });
    cv.mod.cableDrag().press(ev('pointerdown', c.x, c.y), el); fire(ev('pointermove', c.x + 40, c.y + 40));
  };
  const n0 = cv.hist.u.length;
  start(101);
  assert.equal(cv.patch.stats().drag, 'new');
  CORDS.calls.length = 0;
  api.selectTrack(ID.t2); await settle();
  assert.deepEqual([cv.patch.stats().drag, cv.hist.u.length - n0], [null, 0], 'a track switch cancels it');
  assert.equal(CORDS.calls.some(x => x[0] === 'live' && x[1] === null), true, 'the live cord went');
  assert.deepEqual([JSON.stringify(CORDS.list), CORDS.on], ['[]', true], 'the other 900 Series (no cords yet): its buffer');
  api.addTrack(MODEL('minimoog')); await settle();
  assert.deepEqual([JSON.stringify(CORDS.list), CORDS.on], ['[]', false], 'no 900 Series shown: no cords, no buffer');
  ID.t4 = T().id;
  api.selectTrack(ID.t1); await settle();
  assert.equal(CORDS.on, true);
  start(102);
  cv.panic(); await settle();
  assert.equal(cv.patch.stats().drag, null, 'panic cancels it');
  start(103);
  cv.undo(); await settle();
  assert.equal(cv.patch.stats().drag, null, 'an undo cancels it first');
  cv.redo(); await settle();
});

test('§3.6 P-1 (the lead\'s decision): a muted or soloed-out 900 Series is powered off on its node ({t: power, on: false}: a patch track is graphed — legacy nodes take no power) and costs nothing; heard again it is powered on (fresh, held keys restruck); never in a bounce', async () => {
  const t = byId(ID.t1), d = dev(t);
  assert.equal(api.nodes.get(t.id).graphed, true, 'a graphed node');
  node(t).posted.length = 0;
  t.mute = true; cv.mix(); await settle();
  const pw = sent(t, 'power'), gr = sent(t, 'graph').at(-1);
  assert.deepEqual(pw.map(m => [m.i, m.on]), [[d, false]], 'powered off');
  assert.equal(gr.insts.find(x => x.id === d).on, false, 'the graph says so');
  sim.run(1024);
  assert.equal(sim.nodeOf(t.id).proc.insts.find(x => x.id === d).on, 0, 'the Inst off');
  node(t).posted.length = 0;
  t.mute = false; cv.mix(); await settle();
  assert.deepEqual(sent(t, 'power').map(m => [m.i, m.on]), [[d, true]], 'on again');
  // soloed out: another track soloed
  const t4 = byId(ID.t4);
  node(t).posted.length = 0;
  t4.solo = true; cv.mix(); await settle();
  assert.deepEqual(sent(t, 'power').map(m => [m.i, m.on]), [[d, false]], 'soloed out: off');
  assert.equal(sent(t4, 'power').length, 0, 'the soloed Minimoog\'s node: nothing');
  assert.equal(api.offParts(t, 48000).graph.insts.find(x => x.id === d).on, true, 'offline: as it is');
  t4.solo = false; cv.mix(); await settle();
  assert.deepEqual(sent(t, 'power').map(m => [m.i, m.on]), [[d, false], [d, true]]);
  // a key held while it was off is restruck when it comes back (the engine's power): it sounds
  t.mute = true; cv.mix(); await settle();
  api.selectTrack(ID.t1); await settle();
  api.noteOn(43, 100, 0);
  t.mute = false; cv.mix(); await settle();
  const out = sim.run(9600).get(node(t));
  api.noteOff(43, 0); await settle();
  assert.ok(peak(out.L) > 1e-3, 'restruck: it sounds');
});

test('Replace: a Juno on a 900 Series track and back with undo — the patch, its knobs and its modules\' places go with the device and come back; the graph is posted again (the engine\'s kept machine starts empty)', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), r0 = JSON.stringify(rec()), v0 = JSON.stringify(vals());
  sh.srcPick('juno60', 'replace'); await settle();
  const d = I(T(), dev());
  assert.deepEqual([d.model, d.patch === undefined, d.vals.p === undefined], ['juno60', true, true], 'the record and vals.p went with it');
  assert.equal(Object.keys(T().lay || {}).some(k => k.startsWith(dev() + '/')), false, 'its modules\' places too');
  assert.equal(cv.view().modules.has(dev() + '/m1'), false);
  assert.match(note(), /^Replaced 900 Series with Juno-60 · tap to undo$/);
  assert.equal(JSON.stringify(CORDS.list), '[]', 'no cords');
  node(t).posted.length = 0;
  sim.$('#notice').onclick(); await settle();
  assert.deepEqual([I(T(), dev()).model, JSON.stringify(rec()), JSON.stringify(vals())], ['m900', r0, v0], 'back: the patch and its knobs');
  assert.deepEqual(seqPk(T()), [PT.payload(rec(), 'moog').pk], 'its graph posted again');
  assert.equal(cv.view().modules.has(dev() + '/m1'), true);
  assert.equal(CORDS.list.length, rec().cords.length, 'its cords');
});

test('§1.4 review #25: every other way to a 900 Series gives the Model 15 set as Classic bass — the track chip\'s instrument menu, #m900, New project', async () => {
  api.selectTrack(ID.t4); await settle();
  assert.equal(sh.instItems(T()).some(x => x.value === 'm900' && /^900 Series · Mono$/.test(x.label)), true, 'the instrument menu lists it');
  cv.drop('m900', null); await settle();
  const ref = JSON.stringify(MG.model15({ p: {} }).rec);
  assert.deepEqual([I(T(), dev()).model, JSON.stringify(rec())], ['m900', ref], 'from the menu (cvDropInstrument)');
  cv.undo(); await settle();
  assert.equal(I(T(), dev()).model, 'minimoog');
  globalThis.location.hash = '#m900';
  sim.win('hashchange'); await settle();
  assert.deepEqual([I(T(), dev()).model, JSON.stringify(rec())], ['m900', ref], '#m900');
  cv.undo(); await settle();
  globalThis.location.hash = '';
  api.selectTrack(ID.t1); await settle();
  sim.$('#fNew').onclick(); await settle();
  assert.equal(P().tracks.length, 1);
  assert.deepEqual([I(T(), dev()).model, JSON.stringify(rec()), JSON.stringify(vals().p)], ['m900', ref, JSON.stringify(MG.model15({ p: {} }).vals.p)], 'New project (the current model): the Model 15 set');
  cv.undo(); await settle();
  assert.equal(P().tracks.length > 1, true);
  api.selectTrack(ID.t1); await settle();
});

test('§1.6: Save / reload identical (schema 14 since stage M, 13 since P; the orphan knobs pruned at load, never by History); a schema-15 file opens read-only; Save as classic names the patch it loses', async () => {
  const json = JSON.stringify(P()), p2 = cv.loadProject(json);
  assert.deepEqual([p2.schema, CM.SCHEMA], [14, 14]);
  for (const t of P().tracks) {
    const u = p2.tracks.find(x => x.id === t.id), k = CMOD.primId(t);
    if (!cv.isPatchDev(t, k)) continue;
    assert.equal(JSON.stringify(u.dev[k].patch), JSON.stringify(rec(t)), t.name + ': its record');
    assert.equal(JSON.stringify(u.dev[k].vals), JSON.stringify(PT.pruneVals(vals(t), rec(t))), t.name + ': its knobs (orphans pruned)');
    assert.equal(JSON.stringify(u.lay || {}), JSON.stringify(t.lay || {}), t.name + ': its places');
  }
  assert.equal(Object.keys(vals(byId(ID.t1)).p).some(k => !rec(byId(ID.t1)).mods[k]), true, 'the session still holds its orphans (§1.5)');
  const n = JSON.parse(json);
  n.schema = 15;
  assert.equal(cv.loadProject(JSON.stringify(n), { file: true }).newerSchema, 15, 'a schema-15 file: read-only');
  const was = globalThis.confirm;
  let asked = '';
  globalThis.confirm = m => { asked = m; return false; };
  try { await cv.classicFile(); } finally { globalThis.confirm = was; }
  assert.match(asked, /“[^”]+”: the 900 Series patch \(12 modules, 15 cords\) — the live site has no patchable modular; its piano-roll notes are kept/, 'toV1\'s line');
});

test('§6 review #7: a bounce takes a powered 900 Series whose MAIN OUT is patched without notes (a Drone renders), and its offline node carries the live graph and knobs; one with MAIN OUT unpatched and no notes is not bounced', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), keep = P().tracks.map(x => [x, x.mute]);
  for (const x of P().tracks) if (x !== t) x.mute = true;
  t.notes = [];
  cv.patch.preset('Drone'); await settle();
  const set = () => cv.bounceSet(48000).map(x => x.tr.id);
  assert.deepEqual(set(), [t.id], 'the Drone is bounced with no notes');
  const it = cv.bounceSet(48000)[0], d = dev(t);
  assert.equal(it.seqs[d].pk, PT.payload(rec(t), 'moog').pk, 'the live graph');
  assert.equal(JSON.stringify(it.patches[d].pv), JSON.stringify(sent(t, 'patch').filter(m => m.i === d).at(-1).p.pv), 'the live knobs');
  P().bars = 1;
  const before = sim.lastOffline;
  Object.assign(sim.$('#bRange'), { value: 'song' }); Object.assign(sim.$('#bSr'), { value: '48000' }); Object.assign(sim.$('#bBits'), { value: '32' });
  Object.assign(sim.$('#bTail'), { value: '0' }); Object.assign(sim.$('#bNorm'), { checked: false }); Object.assign(sim.$('#bOs'), { value: '2' });
  await sim.$('#bGo').onclick();
  for (let k = 0; k < 400 && sim.lastOffline === before; k++) await sim.settle(10);
  const B = sim.lastOffline;
  assert.ok(B !== before && peak(B.L) > 1e-3, 'the Drone sounds in the bounce (' + (B ? peak(B.L).toFixed(4) : '-') + ')');
  // MAIN OUT pulled: no notes, nothing to bounce
  const out = rec(t).cords.find(c => c.b === 'c.out');
  const q = cv.view().ports().get(cvPatch.jackKey(dev(), out.b)), qc = cv.world().toClient(q.x, q.y);
  drag(out.b, qc.x + 4000, qc.y + 4000); await settle();
  assert.equal(PT.live(rec(t)), false);
  assert.deepEqual(set(), [], 'MAIN OUT unpatched, no notes: not bounced');
  for (const [x, m] of keep) x.mute = m;
  cv.undo(); cv.undo(); await settle();
});

test('§6: {t: ptErr} — the patch scripts missing: one notice a session; any other why a console line only; a project\'s other tracks keep today\'s messages (a Minimoog\'s node legacy: no graph, no patch payload)', async () => {
  const t = T(), N = node(t), warn = console.warn, lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    N.port.onmessage({ data: { t: 'ptErr', why: 'cord', i: dev(t) } });
    assert.doesNotMatch(note(), /patch engine/, 'a dropped item: no notice');
    N.port.onmessage({ data: { t: 'ptErr', why: 'load', i: dev(t) } });
    assert.match(note(), /^The patch engine did not load: this 900 Series is silent$/);
    api.notice('', 0);
    N.port.onmessage({ data: { t: 'ptErr', why: 'load', i: dev(t) } });
    assert.equal(note(), '', 'once a session');
  } finally { console.warn = warn; }
  assert.equal(lines.filter(l => /900 Series: the patch engine/.test(l)).length, 3, 'a console line each');
  const t4 = byId(ID.t4), n4 = node(t4);
  assert.deepEqual([api.nodes.get(t4.id).graphed === true, sent(t4, 'graph').length, sent(t4, 'seq').filter(m => m.s && m.s.pg).length, !!n4.po.patch], [false, 0, 0, true], 'the Minimoog track: a legacy node, no patch payload');
});

test('§4.6: the Moog tiles greyed at a patch\'s 512 modules ("A patch holds at most 512 modules" — IMPL-P; was 48); a module knob\'s drag posts its knobs at most every 66 ms, its lift at once — no History step', async () => {
  api.selectTrack(ID.t3); await settle();
  // (a 511-module patch opened as a project — one sync, not 500 taps — then the 512th by the tap, and a 513th refused with its reason)
  const snap = JSON.stringify(P()), big = JSON.parse(snap), bd = big.tracks.find(x => x.id === ID.t3).dev[dev()];
  let br = bd.patch;
  for (let i = Object.keys(br.mods).length; i < PT.MAX_MODS - 1; i++) br = PT.addModule(br, bd.vals, '995').rec;
  bd.patch = br;
  api.applyRestore(cv.loadProject(JSON.stringify(big))); await settle();
  assert.equal(Object.keys(rec().mods).length, PT.MAX_MODS - 1);
  cv.patch.add('995'); await settle();
  const tile = sh.shell.tiles.moogTile('911');
  assert.deepEqual([Object.keys(rec().mods).length, tile.getAttribute('aria-disabled')], [512, 'true'], 'full: every tile greyed');
  assert.match(tile.title, / — A patch holds at most 512 modules$/);
  const nS = cv.hist.u.length;
  cv.patch.add('995'); await settle();
  assert.deepEqual([Object.keys(rec().mods).length, cv.hist.u.length, note()], [512, nS, 'A patch holds at most 512 modules'], 'a 513th refused with its reason, no step');
  api.applyRestore(cv.loadProject(snap)); await settle();
  assert.equal(cv.hist.u.length, nS, '(the restore records nothing)');
  assert.equal(tile.getAttribute('aria-disabled'), null, 'available again');
  // the knob throttle
  const t = T(), m = 'm1';
  node(t).posted.length = 0;
  const n1 = cv.hist.u.length;
  for (let i = 0; i < 5; i++) { cv.patch.knobSet(t, dev(t), m, 'fq', i * 0.5); sim.raf(); }
  const mid = sent(t, 'patch').length;
  cv.patch.knobSet(t, dev(t), m, 'fq', 2.25, 'end'); sim.raf(); await sim.settle(2);
  assert.equal(mid <= 2, true, 'a drag\'s frames: throttled (' + mid + ' posts for 5 moves)');
  assert.equal(sent(t, 'patch').at(-1).p.pv[m].fq, 2.25, 'the lift: its value posted');
  assert.equal(cv.hist.u.length, n1, 'no step');
});

test('§4.7: the CPU safeguard lowering a 900 Series alone ({t: os, i}: a graphed node) says what that does to cords into audio inputs', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), N = api.nodes.get(t.id), d = dev(t);
  for (const x of P().tracks) { const M = api.nodes.get(x.id); if (M) { M.load = 0; M.cpu = null; } }
  N.load = 0.9; N.cpu = { [d]: 0.9 };
  node(t).posted.length = 0;
  api.lowerOS();
  assert.deepEqual(sent(t, 'os').map(m => [m.i, m.v]), [[d, 2]], 'its Inst alone');
  assert.match(note(), /lowered to 2× to avoid dropouts \(cords into audio inputs may sound different at lower oversampling\)$/);
  api.liftCaps();
  assert.deepEqual(sent(t, 'os').map(m => [m.i, m.v]).at(-1), [d, 4], 'lifted');
});

// review 2 F2 (the lead's decision): a rack taller than the band at READ_K opens — and Fit frames it — with its TOP in view (the
// oscillator row: what one patches first), the user scrolling down to the controller; whole when it fits at READ_K (the foot, the
// controller, used to stay framed and row 1 went above the band: the iPad's landscape first look was the controller and half of row 2)
test('§4.5 / review 2 F2: a rack taller than the band at READ_K (the iPad landscape band under the keyboard tray: 432 px; a desktop window) opens at READ_K with its top row in view — the oscillators whole — and the toolbar\'s Fit does the same (the hook: the controller and the rack at ≥ READ_K, no foot); one that fits is shown whole; a Minimoog track\'s Fit is every item, as before', async () => {
  const keep = Object.assign({}, BAND), K = cvWorld.READ_K;
  const rows = t => { const R = rackAt(t), top = Math.min(...Object.values(R).map(p => p.y)); return { R, top, r1: Object.keys(R).filter(k => R[k].y === top) }; };
  const inBand = (W, t, why) => {
    const { R, top, r1 } = rows(t), y0 = W.toClient(0, top).y, y1 = W.toClient(0, top + 512).y;
    assert.equal(W.k, K, why + ': READ_K');
    assert.equal(y0 >= BAND.top && y0 < BAND.top + 56, true, why + ': the rack\'s top at the band\'s (' + y0 + ')');
    assert.equal(y1 <= BAND.bottom, true, why + ': row 1 whole inside the band');
    assert.equal(r1.length >= 5 && r1.some(k => cv.view().modules.get(k).title === '921 1'), true, why + ': row 1 is the sources (the 921 among them)');
    for (const k of r1) { const x = W.toClient(R[k].x, 0).x; assert.equal(x >= BAND.left && x < BAND.right, true, why + ': ' + k + ' across the band'); }
    assert.equal(W.toClient(0, posOf(dev(t)).y + 352).y > BAND.bottom, true, why + ': the controller below the fold (scroll down to it)');
  };
  try {
    Object.assign(BAND, { left: 44, top: 161, right: 1366, bottom: 593 });
    sh.srcPick('m900', 'track'); await settle();
    const t = T(), W = cv.world();
    inBand(W, t, 'default camera, 1366 × 1024 band');
    // the toolbar's Fit (and the 0 key, the empty-canvas double-tap: cv-world asks the same hook): the same frame, from anywhere
    const hk = W.fitHook(), ids = [dev(t), ...pmKeys(t)];
    assert.deepEqual([[...hk.ids].sort(), hk.kMin, 'foot' in hk, 'kMax' in hk], [[...ids].sort(), K, false, false], 'the hook: the controller and the rack, from READ_K, no foot');
    W.setCamera({ tx: -3000, ty: 900, k: 0.2 });
    W.fit();
    inBand(W, t, 'Fit');
    // the whole rack fits at ≥ READ_K: shown whole (default camera and Fit alike)
    Object.assign(BAND, { left: 44, top: 48, right: 1500, bottom: 1300 });
    sh.srcPick('m900', 'track'); await settle(); // (a new track: a camera stored for the first one's id would win)
    const t2 = T(), W2 = cv.world(), { top } = rows(t2), c = posOf(dev(t2));
    const whole = () => {
      assert.equal(W2.k > K && W2.k <= 1, true, 'k ' + W2.k);
      assert.equal(W2.toClient(0, top).y >= BAND.top && W2.toClient(0, c.y + 352).y <= BAND.bottom, true, 'from the rack\'s top to the controller\'s foot inside the band');
    };
    whole();
    W2.setCamera({ tx: -3000, ty: 900, k: 0.2 }); W2.fit();
    whole();
    // a Minimoog track: the hook names nothing (Fit frames every item, today's)
    api.addTrack(MODEL('minimoog')); await settle();
    assert.equal(W2.fitHook(), null, 'no 900 Series shown: null');
    api.deleteTrack(T()); await settle();
    api.deleteTrack(t2); await settle();
    api.deleteTrack(t); await settle();
  } finally { Object.assign(BAND, keep); }
});

// review 2 F2: the cords of a 900 Series that is off — its track muted or soloed out, or its own ⏻ — are drawn at 0.45 alpha (cv-cords dim)
test('review 2 F2: the cord layer dims while the shown 900 Series is off (track muted, soloed out, ⏻) and back when it is heard; a track switch carries the state of the track shown', async () => {
  api.selectTrack(ID.t1); await settle();
  const d = dev(byId(ID.t1)), dims = () => CORDS.calls.filter(x => x[0] === 'dim').map(x => x[1]), last = () => dims().slice(-1);
  const t1 = () => byId(ID.t1), t4 = () => byId(ID.t4); // (an undo makes new track objects: fetched again each time)
  const t4solo = t4().solo, t4mute = t4().mute;
  CORDS.calls.length = 0;
  t1().mute = true; cv.mix(); await settle();
  assert.deepEqual(last(), [true], 'muted: dimmed');
  t1().mute = false; cv.mix(); await settle();
  assert.deepEqual(last(), [false], 'heard: full');
  t4().solo = true; cv.mix(); await settle();
  assert.deepEqual(last(), [true], 'soloed out: dimmed');
  t4().solo = t4solo; cv.mix(); await settle();
  assert.deepEqual(last(), [false], 'back');
  cv.power(d, false); await settle();
  assert.deepEqual(last(), [true], 'its ⏻ off');
  cv.undo(); await settle();
  assert.deepEqual(last(), [false], 'undone: on again');
  // the state of the track shown: another track muted while this one is shown changes nothing; a switch brings its own
  api.selectTrack(ID.t4); await settle();
  assert.deepEqual(last(), [false], 'no 900 Series shown: not dimmed');
  t1().mute = true; cv.mix(); await settle();
  assert.deepEqual(last(), [false], 'another track muted: still not');
  api.selectTrack(ID.t1); await settle();
  assert.deepEqual(last(), [true], 'switched to the muted 900 Series: dimmed');
  t1().mute = false; t4().mute = t4mute; cv.mix(); await settle();
  assert.deepEqual(last(), [false]);
});

// review 2 F4: the Moog modules view's own intro — what a tap really does (a module tile on a 900 Series adds it, the Model 15 tile
// loads Classic bass; on another instrument a tile replaces it with a 900 Series), never the classic views' "in place of the 900 Series"
test('review 2 F4: the Moog modules view\'s intro — on a 900 Series: a module is added, Model 15 loads Classic bass (tap to undo); on another instrument: the tile replaces it with a 900 Series (Model 15: the whole set, patched); + Track: a new track; the other views keep theirs', async () => {
  const TL = sh.shell.tiles, vb = sim.$('#srcView'), vm = sim.$('#srcViewMenu');
  const tap = t => t.dispatchEvent({ type: 'click', target: t, detail: 1, preventDefault() {}, stopPropagation() {} });
  const pick = v => { tap(vb); tap(vm.children.find(c => c.attrs && c.attrs['data-view'] === v)); };
  const intro = () => sim.$('#srcMode').children.map(c => c.textContent || '').join(''); // (the stub's append keeps nodes only: the classic views' string pieces are not seen)
  api.selectTrack(ID.t1); await settle();
  sh.cvOpenSources('replace');
  pick('hw');
  assert.match(intro(), /^900 Series“/, 'Hardware: the classic words (the model and the track in bold)');
  pick('moog');
  assert.equal(TL.view(), 'moog');
  assert.equal(intro(), 'Tap a module to add it to “' + T().name + '”, or drag it where you want it. Model 15 loads Classic bass over the patch; System 35 and System 55 bring their whole set, patched and laid out (tap to undo). Drag a tile onto the track list for a new track.', 'on a 900 Series ((9b) the set tiles named)');
  assert.doesNotMatch(intro(), /in place of/);
  api.selectTrack(ID.t4); await settle();
  assert.equal(I(T(), dev()).model, 'minimoog');
  assert.equal(intro(), 'Tap a module to replace the Minimoog on “' + T().name + '” with a 900 Series holding it — Model 15, System 35 or System 55 for a whole set, patched — or drag one onto the canvas. Drag it onto the track list for a new track.', 'on a Minimoog ((9b) the set tiles named)');
  sh.cvOpenSources('track');
  assert.equal(intro(), 'a new track', '+ Track: the track words');
  sh.cvOpenSources('replace');
  pick('hw');
  assert.match(intro(), /^Minimoog“/, 'the classic views as before');
  pick('moog');
  api.selectTrack(ID.t1); await settle();
  assert.match(intro(), /^Tap a module to add it to “/, 'the track switch follows');
  pick('hw'); sh.shell.src.close();
});

// review 1 F3: while a post waits on assets (a Convolve IR variant rebuilding: tables.ready false) sendGraph defers its whole post — the
// patches (knobs) with it — and a knob-writing step's graph payload used to go at once, before its knobs: the new modules were built
// with the machine's old pv and glided to the preset's when the knobs landed. patchSend now holds the graph behind the waiting post
test('review 1 F3: a preset while the track\'s Convolve IR is rebuilding (assets not ready) — nothing posted, then {t: patch} (its knobs) before {t: seq} (its graph) when the assets arrive', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), tb = api.tables, ens = tb.ensure, rdy = tb.ready, N = api.nodes.get(t.id);
  let ok = false; const free = [];
  tb.ready = () => ok; tb.ensure = () => new Promise(r => { free.push(r); });
  const arrive = async () => { ok = true; for (const f of free.splice(0)) f(); await settle(); ok = false; };
  try {
    // a Convolve on the track's panel (a factory IR: the graph's needs), its post let through
    const pid = Object.keys(t.dev).find(k => t.dev[k].kind === 'panel'), iid = cv.fx.addEffect(pid, 'conv');
    t.dev[pid].fx.racks[0].mods.find(m => m.id === iid).sub = { ir: 'fir:Short/Small Room' };
    api.queuePatch(t); await settle(); await arrive();
    assert.equal(N.waitP, null, 'the post went through');
    const name = rec().name === 'Drone' ? 'Wind' : 'Drone', pk0 = PT.payload(rec(), 'moog').pk;
    node(t).posted.length = 0;
    cv.patch.preset(name); await settle();
    const pk1 = PT.payload(rec(), 'moog').pk;
    assert.notEqual(pk1, pk0, 'a new graph');
    assert.equal(typeof N.waitP, 'function', 'the graph post waits on the IR');
    assert.deepEqual(node(t).posted.map(x => x.m).filter(m => (m.t === 'patch' || m.t === 'seq') && m.i === d).map(m => m.t), [], 'neither its knobs nor its graph yet — the graph never alone');
    await arrive();
    const got = node(t).posted.map(x => x.m).filter(m => (m.t === 'patch' || m.t === 'seq') && m.i === d);
    assert.deepEqual(got.map(m => m.t), ['patch', 'seq'], 'its knobs, then its graph');
    assert.equal(got[1].s.pk, pk1, 'the new graph');
    assert.equal(N.ptLate, null, 'nothing left held');
    // a knob-less edit while a post still waits (a module deleted after the preset): its graph waits too — one payload, the current one, after the knobs
    node(t).posted.length = 0;
    cv.patch.preset(name === 'Drone' ? 'Wind' : 'Drone'); await settle();
    cv.patch.remove(Object.keys(rec().mods)[0]); await settle();
    assert.equal(node(t).posted.map(x => x.m).filter(m => (m.t === 'patch' || m.t === 'seq') && m.i === d).length, 0, 'still waiting: nothing posted');
    await arrive();
    const got2 = node(t).posted.map(x => x.m).filter(m => (m.t === 'patch' || m.t === 'seq') && m.i === d);
    assert.deepEqual(got2.map(m => m.t), ['patch', 'seq'], 'knobs, then one graph');
    assert.equal(got2[1].s.pk, PT.payload(rec(), 'moog').pk, 'the newest record\'s');
  } finally { tb.ensure = ens; tb.ready = rdy; }
});
