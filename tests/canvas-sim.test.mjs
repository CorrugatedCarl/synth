import './v8-guard.mjs';
// The stage-1b canvas in the page simulation (MODULES lane; docs/canvas/IMPL-1b.md §8.3; SPEC-canvas §11.3): modules
// mounted for the selected track with #inst / #fxrack / the scope in their bodies, Tidy without lay, a top-bar move =
// one History step (undo restores the position, knob values kept), the camera never in History and kept per project uid
// + track, track switch, monitors (smon) only while a module is on screen, Serum ↔ FX panel peer refresh, drop → replace
// + undo toast, lay through serialize / deserialize / History. Hardware panels (docs/canvas/IMPL-panels.md §7, §9.2):
// the Minimoog boots in its fixed Hardware layout; the ⋯ menu's Hardware / Simple toggle (one step, lay.i1.ui, values
// kept, round trips, undo / redo, reload, duplicate; nothing resizable: fixed sizes, Tidy never changes a width); makeRoom
// inside the toggle's step and on a load; the Sources tray's Hardware | Simple both ways, the tray never closing itself.
// One boot per file.
// The world is a scripted one (bootMain synthTest.cvWorld → main.js cvTestWorld), so these tests do not depend on the
// WORLD lane's camera; the real world is exercised by tests/cv-world.test.mjs. Never passes stub DOM nodes to assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as S from '../song.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import { MODELS } from '../models.js?v=9';
import * as cvPanel from '../cv-panel.js?v=9';
import * as cvModule from '../cv-module.js?v=9';

/* ---------------------------------------------------------------- a scripted world (cv-world's World surface) */
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 }; // (a 1408 px Minimoog fits at k 1)
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), log: [], selected: null,
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.log.push('cam ' + [c.tx, c.ty, c.k].join(',')); W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); W.log.push('clear'); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem(id, o) { W.log.push('focus ' + id + ' ' + JSON.stringify(o || {})); },
    dragPointer() {},
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

const ls = fakeStorage({});
const sim = await bootMain({ ls, synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, W = cv.world();
sim.raf(); await sim.settle(5);
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack);
const V = () => cv.view();
const nameOf = id => MODELS.find(m => m.id === id).name;
const hsteps = () => cv.hist.u.length;
// a pointer event for the stub DOM (its dispatchEvent calls the listeners of e.type)
let pid = 100;
const pe = (el, type, x, y, o) => el.dispatchEvent(Object.assign({ type, target: el, currentTarget: el, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: pid,
  pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
  preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, o || {}));
function drag(m, dx, dy) {
  pid++;
  pe(m.bar, 'pointerdown', 500, 70);
  pe(m.bar, 'pointermove', 500 + dx / 2, 70 + dy / 2);
  pe(m.bar, 'pointermove', 500 + dx, 70 + dy);
  pe(m.bar, 'pointerup', 500 + dx, 70 + dy);
}
// a drag by world px at the camera's zoom (a wide fixed-size instrument's reveal zooms the camera out)
const dragW = (m, dx, dy) => drag(m, dx * W.k, dy * W.k);

test('boot: the selected track\'s three modules hold #inst, #fxrack and the scope; #cvParts hidden; Tidy without lay', () => {
  assert.equal(W.items.size, 3);
  assert.deepEqual([...V().modules.keys()], ['i1', 'fx1', 'out']);
  assert.equal(V().trackId, T().id);
  assert.equal(cv.parts.home.hidden, true);
  assert.equal(cv.parts.inst.parentNode === V().modules.get('i1').body, true, '#inst in the instrument body');
  assert.equal(cv.parts.fx.parentNode === V().modules.get('fx1').body, true, '#fxrack in the FX body');
  assert.equal(cv.parts.scope.parentNode === V().modules.get('out').body, true, 'the scope in OUT');
  assert.equal('lay' in T(), false, 'no lay written by just looking');
  // the Minimoog's Hardware layout: a fixed 1408 × 512 module (cv-panel sizeOf), Tidy places the FX panel after it
  assert.equal(T().model, 'minimoog');
  assert.deepEqual([...V().modules.values()].map(m => [m.id, m.x, m.y]), [['i1', 0, 0], ['fx1', 1568, 0], ['out', 2496, 0]]);
  const ttl = nameOf(T().model);
  assert.deepEqual([...V().modules.values()].map(m => m.title), [ttl, 'FX Panel', 'OUT']);
  const menu = cv.menu('inst', 'i1').filter(x => !x.sep);
  assert.deepEqual(menu.map(x => x.label), ['About the ' + ttl + '…', 'Replace with…', 'Hardware layout', 'Simple layout', 'Save sound…', 'Delete saved sound', 'Init sound', 'Fold', 'Bring to front', 'Tidy the canvas'],
    'no Reset width (nothing is resizable)');
  assert.deepEqual(menu.slice(2, 4).map(x => x.checked), [true, false], 'Hardware layout checked');
  assert.equal(menu.find(x => x.label === 'Delete saved sound').disabled, true, 'no saved sound loaded');
  assert.deepEqual(cv.menu('out', 'out').map(x => x.label), ['Fold']);
});

test('the Hardware layout: #inst is the hardware panel; the module is fixed at cv-panel sizeOf (no grip, no measuring)', () => {
  const m = V().modules.get('i1'), mdl = MODELS.find(x => x.id === 'minimoog'), sz = cvPanel.sizeOf(cvPanel.layoutOf('minimoog'), mdl);
  assert.deepEqual(sz, { w: 1408, h: 512 });
  assert.deepEqual(m.fixed, sz);
  assert.deepEqual([m.rect().w, m.rect().h], [1408, 512], 'rect() = the fixed size');
  assert.equal(m.el.hasAttribute('data-cv-fixed'), true, 'the grip hides');
  assert.equal(cv.instUi(T()), 'hw');
  assert.ok(cv.hw() && cv.hw().w === 1408, 'cv-panel rendered #inst');
  assert.match(cv.parts.inst.className, /\binst hw\b/);
});

test('default camera: k = 1, the instrument 24 px inside the visible band (no saved camera)', () => {
  const m = V().modules.get('i1');
  assert.deepEqual(W.cam, { tx: BAND.left - VP.left + 24 - m.x, ty: BAND.top - VP.top + 24 - m.y, k: 1 });
});

test('a top-bar move: track.lay written, one History step; undo restores the place and keeps the knob values; redo', () => {
  const t0 = T(), m = V().modules.get('fx1'), n0 = hsteps();
  drag(m, 160, 96);
  assert.equal(hsteps(), n0 + 1, 'exactly one History step');
  assert.equal(cv.hist.undoLabel, 'Move FX Panel');
  assert.deepEqual(T().lay.fx1, { x: 1728, y: 96, z: 2 });
  assert.deepEqual([m.x, m.y], [1728, 96]);
  assert.equal(V().cables.list().length, 2);
  const port = V().ports().get('fx1.in');
  assert.deepEqual([port.x, port.y], [1728, 96 + 68], 'the cable follows');
  // a knob tweak after the move: undo keeps it (knob undo = today's policy)
  const k = Object.keys(T().vals).find(x => typeof T().vals[x] === 'number');
  T().vals[k] = 0.123;
  cv.undo();
  assert.equal(T() !== t0, true, 'History brings new track objects');
  assert.equal(T().vals[k], 0.123, 'knob value kept');
  assert.deepEqual(T().lay.fx1, { x: 1568, y: 0, z: 2 }, 'lay back to before the move (bring-to-front is not a step)');
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('fx1').y], [1568, 0], 'the module went back');
  cv.redo();
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('fx1').y], [1728, 96]);
  assert.equal(V().modules.get('fx1').body === cv.parts.fx.parentNode, true, 'no remount through undo / redo');
});

test('fold and Tidy: one History step each; Tidy keeps widths and folds', () => {
  const n0 = hsteps();
  V().toggleFold('out');
  assert.equal(hsteps(), n0 + 1);
  assert.equal(cv.hist.undoLabel, 'Fold OUT');
  assert.equal(T().lay.out.fold, 1);
  cv.tidy();
  assert.equal(hsteps(), n0 + 2);
  assert.equal(cv.hist.undoLabel, 'Tidy');
  assert.deepEqual([T().lay.fx1.x, T().lay.fx1.y, T().lay.out.x, T().lay.out.fold], [1568, 0, 2496, 1]);
  cv.undo(); cv.undo();
  assert.equal(V().modules.get('out').fold, false);
});

test('the camera never enters History; it is saved under CM.camKey(project uid, track id) and survives a reload (prefs)', async () => {
  const n0 = hsteps(), can0 = cv.hist.canUndoFrom(P()), json0 = S.serialize(P());
  W.cam = { tx: 300, ty: -50, k: 0.75 }; W.k = 0.75;
  W.emit('cameraend', { cam: W.cam, zoomed: true });
  cv.camFlush();
  assert.equal(hsteps(), n0);
  assert.equal(cv.hist.canUndoFrom(P()), can0);
  assert.equal(S.serialize(P()), json0, 'the project is untouched');
  const rec = api.store.get('synth.cam', null);
  assert.equal(rec.v, 1);
  assert.deepEqual(rec.e.at(-1), [CM.camKey(P().uid, T().id), 300, -50, 0.75]);
  if (api.store.flush) await api.store.flush();
  await sim.settle(5);
  const stored = ls.m.get('synthc.cam');
  assert.ok(stored && JSON.parse(stored).e.some(e => e[0] === CM.camKey(P().uid, T().id)), 'written to the device store (synthc.cam): a reload finds it');
  assert.equal(ls.m.has('synth.cam'), false, 'never under main\'s key');
});

test('track switch: the view is rebuilt for the new track (cards first: world cleared), its own camera; back restores the first', () => {
  const first = T().id, before = V();
  W.cam = { tx: 300, ty: -50, k: 0.75 }; W.k = 0.75;
  W.emit('cameraend', { cam: W.cam, zoomed: true });
  const t2 = api.addTrack();
  sim.raf();
  assert.equal(T().id, t2.id);
  assert.notEqual(V(), before);
  assert.equal(V().trackId, t2.id);
  assert.ok(W.log.includes('clear'));
  assert.deepEqual(W.cam, { tx: 68, ty: 24, k: 1 }, 'a new track: the default camera');
  assert.equal(cv.parts.inst.parentNode === V().modules.get('i1').body, true, 'the parts moved to the new view');
  cv.camFlush();
  assert.ok(!api.store.get('synth.cam', null).e.some(e => e[0] === CM.camKey(P().uid, t2.id)), 'an untouched default camera is not stored');
  W.cam = { tx: 10, ty: 20, k: 1.5 }; W.k = 1.5;
  W.emit('cameraend', { cam: W.cam, zoomed: true });
  api.selectTrack(first);
  assert.equal(V().trackId, first);
  assert.deepEqual(W.cam, { tx: 300, ty: -50, k: 0.75 }, 'its camera back');
  const rec = api.store.get('synth.cam', null);
  assert.deepEqual(rec.e.find(e => e[0] === CM.camKey(P().uid, t2.id)), [CM.camKey(P().uid, t2.id), 10, 20, 1.5], 'the second track\'s camera saved on the switch');
  const n = rec.e.length;
  W.emit('cameraend', { cam: { tx: 300, ty: -50, k: 0.75 }, zoomed: false }); // the restore's own cameraend
  cv.camFlush();
  assert.equal(api.store.get('synth.cam', null).e.length, n, 'an unchanged camera writes nothing');
});

test('cvReveal: selects the track, focuses the module (k 1 below READ_K); cvModuleSize: the hardware size in Hardware layout', () => {
  const other = P().tracks.find(t => t.id !== T().id);
  cv.reveal(other.id);
  assert.equal(T().id, other.id);
  assert.equal(W.log.at(-1), 'focus i1 {"k":' + W.k + ',"edit":false}', 'at or above READ_K: the zoom stays');
  W.k = 0.3;
  cv.reveal(other.id);
  assert.equal(W.log.at(-1), 'focus i1 {"k":1,"edit":false}', 'below READ_K: 100 %');
  W.k = 0.8;
  cv.reveal(other.id, 'out');
  assert.equal(W.log.at(-1), 'focus out {"k":0.8,"edit":false}');
  assert.deepEqual(cv.size('serum'), { w: 1200, h: 840 }, 'unseen: the default outline');
  const s = cv.size(T().model);
  assert.equal(s.w, V().modules.get('i1').w);
  assert.deepEqual(cv.size('minimoog'), { w: 1408, h: 512 }, 'a model with a hardware panel: its fixed size (the Hardware layout)');
});

test('monitors ({t: mon, ids}) follow the module: on while the Serum module is on screen, off in ROLL, folded or off screen', async () => {
  await sim.power(); sim.raf(); await sim.settle(5);
  const t = api.addTrack(undefined); // a classic track; switched to a Serum below
  api.setTrackModel(t, 'serum'); sim.raf(); await sim.settle(5);
  assert.equal(T().model, 'serum');
  assert.deepEqual([...V().modules.keys()].sort(), ['i1', 'i1/fx', 'out']);
  // the SerumUI does not load in the simulation: a stand-in panel for this track
  const refresh = { sx: 0, fx: 0 };
  cv.sxPanel.ui = { refresh() { refresh.sx++; }, destroy() {}, setSnapshot() {}, confirmChange: () => true, snap: null };
  cv.sxPanel.trackId = t.id; cv.sxPanel.vals = T().vals;
  const mons = () => api.nodes.get(t.id).node.posted.filter(x => x.m && x.m.t === 'mon').map(x => x.m.ids);
  const smon = () => mons().map(ids => ids.length > 0); // (on: any part subscribed)
  api.sxHost(T()).monitor(true);
  assert.deepEqual(smon().slice(-1), [true], 'shown: on');
  assert.deepEqual(mons().slice(-1), [['c0', 'i0']], 'the Serum module: its snapshot (Inst i0) and its FX page\'s meters (Chain c0)');
  assert.equal(api.nodes.get(t.id).node.posted.filter(x => x.m && x.m.t === 'smon').length, 0, 'the legacy smon is not sent');
  cv.openTab('roll');
  assert.deepEqual(smon().slice(-1), [false], 'ROLL: off');
  cv.openTab('canvas');
  assert.deepEqual(smon().slice(-1), [true], 'back: on');
  V().toggleFold('i1');
  assert.deepEqual(smon().slice(-1), [false], 'folded: off');
  V().toggleFold('i1');
  assert.deepEqual(smon().slice(-1), [true]);
  V().modules.get('i1').onScreen(false); // (cv-world's plan: the module left the viewport + its margin)
  assert.deepEqual([smon().slice(-1), V().modules.get('i1').el.hasAttribute('data-cv-off')], [[false], true], 'off screen: off (nothing visible changes)');
  V().modules.get('i1').onScreen(true);
  assert.deepEqual([smon().slice(-1), V().modules.get('i1').el.hasAttribute('data-cv-off')], [[true], false]);
  // undo / redo of a fold (applyRestore → cvRender → cvView.sync → host.shown) moves the subscription too
  V().toggleFold('i1/fx'); V().toggleFold('i1');
  assert.deepEqual(smon().slice(-1), [false], 'both folded: off');
  cv.undo();
  assert.deepEqual([smon().slice(-1), !!cv.monitors.on.get(t.id), V().live('i1')], [[true], true, true], 'undo unfolds the Serum: on again');
  cv.redo();
  assert.deepEqual([smon().slice(-1), !!cv.monitors.on.get(t.id)], [[false], false], 'redo folds it: off');
  cv.undo(); cv.undo();
  assert.deepEqual([smon().slice(-1), V().live('i1'), V().live('i1/fx')], [[true], true, true], 'both unfolded');
  // peer refresh: a Serum edit refreshes the FX module, an FX edit the Serum panel — never the editor itself
  cv.fxTab.ui = { refresh() { refresh.fx++; }, destroy() {} }; cv.fxTab.trackId = t.id; cv.fxTab.fx = T().fx; cv.fxTab.sx = true;
  sim.raf(); await sim.settle(5); sim.raf(); // (an outside refresh still queued: sxRefresh)
  refresh.sx = 0; refresh.fx = 0;
  api.sxHost(T()).edit(s => { s.p['a.level'] = 0.5; }, { label: 'x' });
  api.sxHost(T()).edit(s => { s.p['a.level'] = 0.6; }, { label: 'x' });
  sim.raf();
  assert.deepEqual([refresh.sx, refresh.fx], [0, 1], 'two Serum edits: one FX module refresh on the next frame');
  api.fxHost(T()).editFx(fx => { fx.ui.expand = 1; }, { ui: true });
  sim.raf();
  assert.deepEqual([refresh.sx, refresh.fx], [1, 1], 'an FX edit: the Serum panel');
  api.sxHost(T()).edit(s => { s.ui = s.ui || {}; }, { ui: true });
  sim.raf();
  assert.deepEqual([refresh.sx, refresh.fx], [1, 1], 'a UI-only Serum edit: no FX refresh');
  // a hidden peer is refreshed when it shows again
  V().toggleFold('i1/fx');
  api.sxHost(T()).edit(s => { s.p['a.level'] = 0.7; }, { label: 'x' });
  sim.raf();
  assert.equal(refresh.fx, 1, 'folded FX module: not refreshed now');
  V().toggleFold('i1/fx');
  sim.raf();
  assert.equal(refresh.fx, 2, 'refreshed once it shows');
  cv.sxPanel.ui = null; cv.sxPanel.trackId = null; cv.fxTab.ui = null; cv.fxTab.trackId = null;
});

test('drop / replace: the instrument is replaced in place (one History step), the notice action undoes it', () => {
  const t = T(), id = t.id, n0 = hsteps(), x0 = V().modules.get('i1').x;
  const to = t.model === 'juno60' ? 'prophet5' : 'juno60', from = t.model;
  assert.equal(cv.drop(from, null), false, 'the same model: nothing');
  assert.equal(cv.drop(to, { x: 900, y: 900, w: 1080, h: 500 }), true);
  assert.equal(T().model, to);
  assert.equal(hsteps(), n0 + 1);
  assert.equal(V().modules.get('i1').x, x0, 'in place');
  assert.equal(V().modules.get('i1').title, nameOf(to), 're-titled');
  assert.ok(V().modules.has('fx1') && !V().modules.has('i1/fx'), 'a classic model: the FX Panel');
  const note = sim.$('#notice');
  assert.match(note.textContent, /^Replaced .+ with .+ · tap to undo$/);
  note.onclick();
  assert.equal(P().tracks.find(x => x.id === id).model, from, 'undone');
});

test('the instrument chip (a classic track\'s preset select) follows a preset load and a knob tweak (renderHeads → cvChipSync)', () => {
  if (MODELS.find(m => m.id === T().model).custom) api.setTrackModel(T(), 'juno60');
  const chip = V().modules.get('i1').bar.children.find(c => c.className === 'cv-chip');
  const sel = () => chip.children[chip.children.length - 1].children[1]; // (the stub's textContent = '' keeps old children: the last is the chip: ◀ select ▶)
  const first = () => sel().children[0].textContent;
  const opt = sel().children.find(c => c.tagName === 'OPTGROUP').children[0]; // the first preset of the first group
  sel().value = opt.value; sel().onchange();
  assert.equal(T().preset, opt.textContent);
  assert.equal(first(), opt.textContent, 'the chip names the loaded preset');
  T().preset = null; cv.heads(); // (what a knob tweak does: main.js setVal)
  assert.equal(first(), 'Custom', 'a knob tweak: Custom');
});

test('lay through serialize / deserialize, History and duplicateTrack', () => {
  drag(V().modules.get('i1'), 64, 32);
  const lay = JSON.parse(JSON.stringify(T().lay));
  assert.ok(lay.i1 && lay.i1.x === 64);
  const back = S.deserialize(S.serialize(P()));
  assert.deepEqual(back.tracks.find(x => x.id === T().id).lay, lay);
  const n = P().tracks.length;
  cv.duplicateTrack(T());
  const c = P().tracks[P().tracks.indexOf(T()) + 1];
  assert.equal(P().tracks.length, n + 1);
  assert.deepEqual(c.lay, lay);
  assert.equal(c.lay !== T().lay, true, 'a copy');
});

test('About: the model text and the DX7 diagram in a sheet; they go back when it closes', () => {
  cv.about();
  assert.equal(cv.parts.about.parentNode === cv.parts.home, false, 'in the sheet');
  const ov = sim.$('#ov'), wrap = ov.children.at(-1);
  if (wrap && wrap.className === 'cv-lite') { // (the fallback until the SHELL lane's sheet is in)
    wrap.children[0].children[0].onclick();
    assert.equal(cv.parts.about.parentNode === cv.parts.home, true);
  }
});

test('a classic → Serum → classic change keeps the FX module where the user last put it: track.lay holds one FX entry (cvLay, Tidy)', () => {
  api.addTrack(undefined); sim.raf();
  if (MODELS.find(m => m.id === T().model).custom) { api.setTrackModel(T(), 'juno60'); sim.raf(); }
  const x1 = V().modules.get('fx1').x + 320;
  dragW(V().modules.get('fx1'), 320, 0);
  assert.deepEqual([T().lay.fx1.x, T().lay.fx1.y], [x1, 0]);
  api.setTrackModel(T(), 'serum'); sim.raf();
  const sf = V().modules.get('i1/fx');
  assert.deepEqual([sf.x, sf.y], [x1, 0], 'the Serum FX takes its place');
  dragW(sf, -296, 200);
  const x2 = Math.round((x1 - 296) / 32) * 32;
  assert.deepEqual([T().lay['i1/fx'].x, T().lay['i1/fx'].y, 'fx1' in T().lay], [x2, 192, false], 'one FX entry');
  api.setTrackModel(T(), 'juno60'); sim.raf();
  const f = V().modules.get('fx1');
  assert.deepEqual([f.x, f.y], [x2, 192], 'back to a classic: where the user last put it');
  cv.tidy();
  assert.deepEqual(['fx1' in T().lay, 'i1/fx' in T().lay], [true, false], 'Tidy keeps one FX entry too');
  cv.undo();
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('fx1').y], [x2, 192], 'undo of the Tidy');
});

test('the ⋯ toggle Hardware ↔ Simple (the user\'s report: "i switched to the simple one and i cant switch back"): each switch one History step from the module menu, the panel re-rendered in that layout at its fixed size, the check mark on it, values and the preset kept — several round trips, undo / redo both ways, a move, Tidy, reload and duplicate', () => {
  const t0 = api.addTrack(MODELS.find(m => m.id === 'minimoog')); sim.raf();
  assert.equal(T().model, 'minimoog');
  assert.equal(cv.instUi(T()), 'hw');
  api.selectTrack(t0.id); sim.raf();
  T().vals.fc = 7.25; T().vals.r1 = 1; T().preset = 'Fat Bass';
  const vals = JSON.stringify(T().vals), n0 = hsteps(), m = () => V().modules.get('i1'), FW = cvModule.FLOW_W.minimoog;
  assert.ok(m().fixed && !('lay' in T() && T().lay.i1), 'fixed, no lay yet');
  const ids = () => [...cv.panel().ui.keys()].filter(k => k[0] !== '@').sort().join(','), ids0 = ids();
  const pick = label => { const it = cv.menu('inst', 'i1').find(x => x.label === label); assert.ok(it && !it.disabled, label + ': in the menu, enabled'); it.action(); sim.raf(); };
  const checks = () => cv.menu('inst', 'i1').filter(x => x.checked != null).map(x => x.label + ':' + x.checked).join(' ');
  const flowState = () => [cv.instUi(T()), cv.hw(), m().w, m().fixed && m().fixed.w, m().fixed && m().fixed.h, m().el.hasAttribute('data-cv-fixed')];
  const hwState = () => [cv.instUi(T()), !!cv.hw(), m().w, m().fixed && m().fixed.w, m().fixed && m().fixed.h];
  for (let i = 0; i < 3; i++) { // round trips from the menu (Simple → Hardware → Simple …)
    pick('Simple layout');
    assert.deepEqual(flowState(), ['flow', null, FW, FW, 0, true], 'Simple: today\'s flowing panel at the Minimoog\'s fixed width (the height measured)');
    assert.deepEqual([hsteps(), cv.hist.undoLabel, checks()], [n0 + 2 * i + 1, 'Simple layout', 'Hardware layout:false Simple layout:true'], 'one step; the check mark');
    assert.deepEqual([JSON.stringify(T().vals), T().preset, ids()], [vals, 'Fat Bass', ids0], 'values, the preset name and every control kept');
    if (!i) { assert.deepEqual([T().lay.i1.x, T().lay.i1.y], [m().x, m().y], 'lay.i1 created from the module\'s place'); assert.ok(T().lay.fx1 && T().lay.out, 'the Tidy-placed modules pinned where they stand'); }
    pick('Hardware layout');
    assert.deepEqual(hwState(), ['hw', true, 1408, 1408, 512], 'Hardware: the hardware panel at its size, back from Simple');
    assert.deepEqual([hsteps(), cv.hist.undoLabel, checks(), 'ui' in T().lay.i1, 'w' in T().lay.i1], [n0 + 2 * i + 2, 'Hardware layout', 'Hardware layout:true Simple layout:false', false, false]);
    assert.deepEqual([JSON.stringify(T().vals), T().preset, ids()], [vals, 'Fat Bass', ids0]);
    const fx = V().modules.get('fx1');
    assert.ok(fx.x >= m().x + m().w + cvModule.GAP - 1 || fx.y >= m().y + m().rect().h, 'never overlapped: room made for the wider panel');
    assert.deepEqual(V().ports().get('i1.out'), { x: m().x + m().w, y: m().y + cvModule.BAR_H + cvModule.JACK_Y }, 'the out jack (and its cable) at the new edge');
  }
  // undo / redo walk the switches back and forth
  cv.undo(); sim.raf();
  assert.deepEqual(flowState(), ['flow', null, FW, FW, 0, true], 'undo: Simple');
  cv.undo(); sim.raf();
  assert.deepEqual(hwState(), ['hw', true, 1408, 1408, 512], 'undo: Hardware');
  cv.redo(); sim.raf();
  assert.deepEqual(flowState(), ['flow', null, FW, FW, 0, true], 'redo: Simple');
  assert.equal(checks(), 'Hardware layout:false Simple layout:true');
  pick('Hardware layout');
  assert.deepEqual(hwState(), ['hw', true, 1408, 1408, 512], 'from the menu after an undo / redo: Hardware again');
  cv.undo(); sim.raf();
  assert.deepEqual([JSON.stringify(T().vals), T().preset, ids()], [vals, 'Fat Bass', ids0], 'values still kept');
  // in Simple: a move keeps the choice and writes no width; Tidy moves modules only (never a width, never the layout)
  drag(m(), 64, 0);
  assert.deepEqual([T().lay.i1.ui, 'w' in T().lay.i1], ['flow', false]);
  cv.tidy(); sim.raf();
  assert.deepEqual([cv.instUi(T()), m().w, T().lay.i1.ui, cv.hw()], ['flow', FW, 'flow', null], 'Tidy: still Simple at its width');
  // reload (serialize / deserialize) and duplicate keep the choice
  const back = S.deserialize(S.serialize(P()));
  assert.equal(back.tracks.find(x => x.id === T().id).lay.i1.ui, 'flow');
  cv.duplicateTrack(T());
  const c = P().tracks[P().tracks.indexOf(T()) + 1];
  assert.equal(c.lay.i1.ui, 'flow');
  // a menu toggle to the current layout: nothing
  const n1 = hsteps();
  cv.setLayout('flow');
  assert.equal(hsteps(), n1);
});

test('Hardware ↔ Simple round trips on several models (Minimoog, TB-303, Juno-60, DX7, ARP 2600): the fixed size of each layout, the same controls each time, the TB-303 pattern kept; a stored width never wins', () => {
  for (const id of ['minimoog', 'tb303', 'juno60', 'dx7', 'arp2600']) {
    const mdl = MODELS.find(x => x.id === id), t = api.addTrack(mdl); sim.raf();
    api.selectTrack(t.id); sim.raf();
    const m = () => V().modules.get('i1'), hw = cvPanel.sizeOf(cvPanel.layoutOf(id), mdl), seq = JSON.stringify(T().seq || null);
    const ids = () => [...cv.panel().ui.keys()].filter(k => k[0] !== '@').sort().join(',');
    const hwIds = ids();
    cv.setLayout('flow'); sim.raf();
    const flowIds = ids();
    for (let i = 0; i < 2; i++) {
      cv.setLayout('hw'); sim.raf();
      assert.deepEqual([cv.instUi(T()), !!cv.hw(), m().w, m().fixed.h, ids()], ['hw', true, hw.w, hw.h, hwIds], id + ': Hardware');
      T().lay.i1.w = 480; // (a width stored before the no-resizing rule: ignored)
      cv.setLayout('flow'); sim.raf();
      assert.deepEqual([cv.instUi(T()), cv.hw(), m().w, ids()], ['flow', null, cvModule.FLOW_W[id], flowIds], id + ': Simple');
    }
    cv.undo(); sim.raf();
    assert.deepEqual([cv.instUi(T()), m().w], ['hw', hw.w], id + ': undo');
    cv.redo(); sim.raf();
    assert.deepEqual([cv.instUi(T()), m().w], ['flow', cvModule.FLOW_W[id]], id + ': redo');
    assert.equal(JSON.stringify(T().seq || null), seq, id + ': the pattern kept');
  }
});

test('makeRoom: a fixed instrument pushes overlapping FX / OUT right — inside the toggle\'s step (undo takes it back), and on a load (a stage-1b layout) without a step', () => {
  const t = api.addTrack(MODELS.find(m => m.id === 'minimoog')); sim.raf();
  // a stage-1b layout: the FX panel and OUT where a 1080 px panel ended; Resizable for now
  T().lay = { i1: { x: 0, y: 0, ui: 'flow' }, fx1: { x: 1248, y: 0 }, out: { x: 2176, y: 0 } };
  cv.render(); sim.raf();
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('out').x], [1248, 2176]);
  const n0 = hsteps();
  cv.setLayout('hw');
  assert.equal(hsteps(), n0 + 1, 'one step: the toggle (the room is inside it)');
  assert.deepEqual([T().lay.fx1.x, T().lay.out.x, V().modules.get('fx1').x, V().modules.get('out').x], [1568, 2496, 1568, 2496], 'moved right together');
  cv.undo();
  assert.deepEqual([cv.instUi(T()), T().lay.fx1.x, T().lay.out.x], ['flow', 1248, 2176], 'undo: both back');
  // a load: the track's view is built for a stage-1b layout in the Hardware layout → room made, no step
  T().lay = { i1: { x: 0, y: 0 }, fx1: { x: 1248, y: 64 }, out: { x: 2176, y: 0 } };
  const other = P().tracks.find(x => x.id !== t.id);
  api.selectTrack(other.id); sim.raf();
  const n1 = hsteps(), can = cv.hist.canUndoFrom(P());
  api.selectTrack(t.id); sim.raf();
  assert.deepEqual([T().lay.fx1.x, T().lay.fx1.y, T().lay.out.x], [1568, 64, 2496], 'room made on the build');
  assert.deepEqual([hsteps(), cv.hist.canUndoFrom(P())], [n1, can], 'no History step');
  // already clear: nothing moves
  api.selectTrack(other.id); sim.raf(); api.selectTrack(t.id); sim.raf();
  assert.deepEqual([T().lay.fx1.x, T().lay.out.x], [1568, 2496]);
});

/* ---------------------------------------------------------------- stage 1c */
test('track switch (1c): the frames and the camera at once, the bodies over the next frames (nearest first), the world hidden until done', async () => {
  // (the Serum / FX rack UIs never finish loading in the simulation — wk.loadDSP waits for script loads — so a switch shows
  // after CV_MOUNT_MAX, 0.5 s, as a browser would when a first load is slow: never a long blank canvas)
  const vp = sim.$('#viewport'), done = async () => { for (let i = 0; i < 60 && vp.hasAttribute('data-cv-mounting'); i++) { await sim.settle(40); sim.raf(); } };
  { // a slow first load: hidden for at most CV_MOUNT_MAX (500 ms), then shown (the bodies' own "Loading…")
    const t0 = performance.now();
    api.addTrack(MODELS.find(m => m.id === 'serum')); sim.raf();
    await done();
    const ms = performance.now() - t0;
    assert.ok(!vp.hasAttribute('data-cv-mounting') && ms < 1100, 'shown after the cap, not 1.5 s: ' + Math.round(ms) + ' ms');
    cv.undo(); sim.raf(); await done();
  }
  const a = T(), b = api.addTrack(MODELS.find(m => m.id === 'juno60')); sim.raf();
  await done();
  assert.equal(vp.hasAttribute('data-cv-mounting'), false);
  api.selectTrack(a.id);
  assert.deepEqual([V().trackId, vp.hasAttribute('data-cv-mounting')], [a.id, true], 'the new frames now, hidden');
  assert.notEqual(cv.panel() && cv.panel().track, a, 'its panel not built yet (the next frame)');
  sim.raf();
  if (a.model !== 'serum') assert.equal(cv.panel().track, a, 'the first frame: the nearest body (the instrument) built');
  await done();
  assert.equal(vp.hasAttribute('data-cv-mounting'), false, 'shown once every body is in');
  if (a.model !== 'serum') assert.equal(cv.panel().track, a, 'the panel is the new track\'s');
  // an edit while mounting completes the switch at once
  api.selectTrack(b.id);
  assert.equal(vp.hasAttribute('data-cv-mounting'), true);
  api.setTrackModel(b, 'prophet5');
  assert.deepEqual([vp.hasAttribute('data-cv-mounting'), cv.panel().track === T(), T().model], [false, true, 'prophet5']);
});

test('project v2 (1c): every track adopted after loads, undo / redo, add and duplicate; the canonical compile; Save as classic project', async () => {
  const MO = await import('../cv-model.js?v=9'), G = await import('../cv-graph.js?v=9');
  const all = () => P().tracks.every(t => MO.isAdopted(t) && t.prim === 'i1' && typeof t.model === 'string');
  assert.ok(all(), 'boot');
  const t = api.addTrack(MODELS.find(m => m.id === 'dx7')); sim.raf();
  assert.ok(all(), 'add');
  cv.duplicateTrack(t); sim.raf();
  assert.ok(all(), 'duplicate');
  api.setTrackModel(T(), 'serum'); sim.raf();
  assert.deepEqual([Object.keys(T().dev).sort(), G.compileTrack(T()).shape], [['i1', 'out'], 'serum']);
  cv.undo(); sim.raf();
  assert.ok(all(), 'undo');
  assert.deepEqual([T().model, Object.keys(T().dev).sort(), G.compileTrack(T()).shape], ['dx7', ['fx1', 'i1', 'out'], 'classic']);
  cv.redo(); sim.raf();
  assert.ok(all() && T().model === 'serum', 'redo');
  for (const x of P().tracks) assert.equal(G.compileTrack(x).canonical, true, x.name);
  const json = JSON.parse(JSON.stringify(P()));
  assert.ok(json.tracks.every(x => !('model' in x) && x.dev), 'the autosave / History form: v2 only');
  // the file main opens
  const txt = await cv.classicFile();
  const v1 = JSON.parse(txt);
  assert.equal('schema' in v1, false);
  assert.deepEqual(v1.tracks.map(x => [x.id, x.model, !!x.fx, 'dev' in x]), P().tracks.map(x => [x.id, x.model, true, false]));
  const back = S.deserialize(v1);
  assert.deepEqual(back.tracks.map(x => x.model), P().tracks.map(x => x.model), 'main\'s song.js reads each track\'s instrument');
});

test('Sources "Hardware | Simple" (1c, the user\'s request): Simple adds / replaces a classic synth in its Simple layout inside that one step; Hardware brings it back (a tap on the current model\'s tile switches its layout both ways); Serum ignores it; the choice persists; the tray never closes itself', async () => {
  const sh = globalThis.__synthTest.shell, tiles = sh.shell.tiles;
  assert.deepEqual([tiles.layout(), tiles.view()], ['hw', 'hw'], 'Hardware by default');
  // (2026-10-19) the switch is a dropdown: #srcView opens #srcViewMenu, its Simple item picks (was: the segmented pair's
  // Simple button, aria-pressed; now the item's aria-checked and the button's label)
  const vb = sim.$('#srcView'), vm = sim.$('#srcViewMenu'), simple = vm.children[1], serum = vm.children[2];
  const tap = t => t.dispatchEvent({ type: 'click', target: t, detail: 1, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual([vb.children[0].textContent, vm.children.map(b => b.children[0].textContent), simple.getAttribute('aria-checked')], ['Hardware', ['Hardware', 'Simple', 'Serum'], 'false']);
  tap(vb);
  assert.deepEqual([tiles.viewOpen(), vb.getAttribute('aria-expanded')], [true, 'true']);
  tap(simple); // (a pick closes it)
  assert.deepEqual([tiles.layout(), simple.getAttribute('aria-checked'), vb.children[0].textContent, tiles.viewOpen(), api.store.get('synth.cv.trayLayout', null)], ['flow', 'true', 'Simple', false, 'flow'], 'remembered');
  // a tap in track mode: a new track, its instrument Simple, one step
  let n = hsteps();
  const nT = P().tracks.length;
  sh.srcPick('juno60', 'track'); sim.raf();
  assert.deepEqual([T().model, T().lay && T().lay.i1 && T().lay.i1.ui, cv.instUi(T()), hsteps()], ['juno60', 'flow', 'flow', n + 1]);
  cv.undo(); sim.raf();
  assert.equal(P().tracks.length, nT, 'one undo takes the add away');
  // a replace (tap in replace mode / a canvas drop): the same, in the replace's step
  n = hsteps();
  sh.srcPick('prophet5', 'replace'); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T()), hsteps()], ['prophet5', 'flow', n + 1]);
  n = hsteps();
  assert.equal(sh.srcDrag.drop('obxa', { over: 'canvas' }), true); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T()), hsteps()], ['obxa', 'flow', n + 1]);
  // (2026-10-19) the Serum view: the Serum tile and the Modulators only (remembered); the classics' layout stays Simple
  tap(vb); tap(serum);
  const shownIds = () => tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'));
  assert.deepEqual([tiles.view(), tiles.layout(), api.store.get('synth.cv.trayLayout', null), shownIds(), sim.$('#srcModSec').hidden, tiles.modTiles().length],
    ['serum', 'flow', 'serum', ['serum'], false, 4]);
  // Serum: no hardware panel — the view's layout does nothing to it; in track mode its tile adds a Serum track
  sh.cvOpenSources('track'); sim.raf();
  assert.deepEqual([tiles.mode(), tiles.view()], ['track', 'serum'], '+ Track opens the view last used');
  sh.srcPick('serum', 'track'); sim.raf();
  assert.deepEqual([T().model, !!(T().lay && T().lay.i1 && T().lay.i1.ui), tiles.mode()], ['serum', false, 'replace']);
  // Escape: the dropdown first, the tray stays open
  tap(vb);
  assert.deepEqual([sh.cvShellEscape(), tiles.viewOpen(), sh.shell.src.isOpen()], [true, false, true]);
  tiles.setLayout('flow');
  assert.deepEqual([shownIds().length, sim.$('#srcModSec').hidden], [12, true], 'Simple: the classics, no Modulators');
  // Hardware: a new track as before (no ui written)
  tiles.setLayout('hw');
  sh.srcDrag.drop('dx7', { over: 'tracks' }); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T()), !!(T().lay && T().lay.i1 && T().lay.i1.ui)], ['dx7', 'hw', false]);
  // the user's report ("i switched to the simple one and i cant switch back"): Simple, a tap on the current model's tile …
  tiles.setLayout('flow');
  n = hsteps();
  sh.srcPick('dx7', 'replace'); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T()), cv.hw(), hsteps(), cv.hist.undoLabel], ['dx7', 'flow', null, n + 1, 'Simple layout'], 'Simple: its own step');
  // … then Hardware and the same tile: back to the hardware panel, one step
  tiles.setLayout('hw');
  sh.srcPick('dx7', 'replace'); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T()), !!cv.hw(), hsteps(), cv.hist.undoLabel], ['dx7', 'hw', true, n + 2, 'Hardware layout'], 'Hardware again');
  // a replace in Hardware on a Simple track: the new synth in Hardware (the tray's switch decides), in the replace's step
  cv.setLayout('flow'); sim.raf();
  n = hsteps();
  sh.srcPick('juno60', 'replace'); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T()), !!cv.hw(), hsteps()], ['juno60', 'hw', true, n + 1]);
  cv.undo(); sim.raf();
  assert.deepEqual([T().model, cv.instUi(T())], ['dx7', 'flow'], 'one undo: the DX7 in Simple again');
  // the tray stays open through picks and drops (only its rail, its ✕ or Escape close it)
  sh.shell.src.open(); sim.raf();
  sh.srcPick('prophet5', 'replace'); sim.raf();
  sh.srcPick('obxa', 'track'); sim.raf();
  assert.equal(sh.srcDrag.drop('juno60', { over: 'canvas' }), true); sim.raf();
  assert.equal(sh.srcDrag.drop('dx7', { over: 'tracks' }), true); sim.raf();
  assert.deepEqual([sh.shell.src.isOpen(), tiles.mode()], [true, 'replace'], 'open; back to replacing after a new track');
});

test('module CPU (1d): the engine\'s stats per Inst / Chain reach the shown track\'s instrument and FX modules (OUT has none)', async () => {
  await sim.power(); sim.raf(); await sim.settle(5);
  const t = T(), cpu = key => { const m = V().modules.get(key); return m ? (m.bar.children.find(c => c.className === 'cv-cpu') || {}).textContent : null; };
  sim.run(Math.round(sim.ctx().sampleRate * 0.6));
  assert.match(cpu(cvModule.ID.inst), /%$/, 'the instrument module: Inst i0');
  assert.match(cpu(cvModule.fxKey(t.model)), /%$/, 'the FX module: Chain c0');
  assert.equal(cpu(cvModule.ID.out), '', 'OUT: no engine part');
});

test('OUT scope (1d review): drawn only while the OUT module is live — not off screen, not folded', async () => {
  await sim.power(); sim.raf(); await sim.settle(5);
  const sc = sim.$('#scope'), m = () => V().modules.get(cvModule.ID.out), gc = sc.getContext, g = new Proxy({}, { get: () => () => {} });
  let n = 0;
  sc.offsetParent = {}; sc.getContext = () => { n++; return g; }; // (laid out; each draw fetches its context once)
  try {
    sim.raf(); assert.ok(n > 0, 'on screen: drawn');
    m().onScreen(false); n = 0; sim.raf(); assert.equal(n, 0, 'off screen: not drawn (nothing visible changes)');
    m().onScreen(true); sim.raf(); assert.ok(n > 0, 'back on screen: drawn');
    V().toggleFold(cvModule.ID.out); n = 0; sim.raf(); assert.equal(n, 0, 'folded: not drawn');
    V().toggleFold(cvModule.ID.out); sim.raf(); assert.ok(n > 0, 'unfolded: drawn');
  } finally { sc.offsetParent = null; sc.getContext = gc; }
});
