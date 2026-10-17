import './v8-guard.mjs';
// The stage-1b canvas in the page simulation (MODULES lane; docs/canvas/IMPL-1b.md §8.3; SPEC-canvas §11.3): modules
// mounted for the selected track with #inst / #fxrack / the scope in their bodies, Tidy without lay, a top-bar move =
// one History step (undo restores the position, knob values kept), the camera never in History and kept per project uid
// + track, track switch, monitors (smon) only while a body shows, Serum ↔ FX panel peer refresh, drop → replace + undo
// toast, lay through serialize / deserialize / History. One boot per file (tests/main-sim.mjs).
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

/* ---------------------------------------------------------------- a scripted world (cv-world's World surface) */
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1400, bottom: 700 };
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

test('boot: the selected track\'s three modules hold #inst, #fxrack and the scope; #cvParts hidden; Tidy without lay', () => {
  assert.equal(W.items.size, 3);
  assert.deepEqual([...V().modules.keys()], ['i1', 'fx1', 'out']);
  assert.equal(V().trackId, T().id);
  assert.equal(cv.parts.home.hidden, true);
  assert.equal(cv.parts.inst.parentNode === V().modules.get('i1').body, true, '#inst in the instrument body');
  assert.equal(cv.parts.fx.parentNode === V().modules.get('fx1').body, true, '#fxrack in the FX body');
  assert.equal(cv.parts.scope.parentNode === V().modules.get('out').body, true, 'the scope in OUT');
  assert.equal('lay' in T(), false, 'no lay written by just looking');
  assert.deepEqual([...V().modules.values()].map(m => [m.id, m.x, m.y]), [['i1', 0, 0], ['fx1', 1248, 0], ['out', 2176, 0]]);
  const ttl = nameOf(T().model);
  assert.deepEqual([...V().modules.values()].map(m => m.title), [ttl, 'FX Panel', 'OUT']);
  assert.deepEqual(cv.menu('inst', 'i1').filter(x => !x.sep).map(x => x.label), ['About the ' + ttl + '…', 'Replace with…', 'Reset width', 'Fold', 'Bring to front', 'Tidy the canvas']);
  assert.deepEqual(cv.menu('out', 'out').map(x => x.label), ['Fold']);
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
  assert.deepEqual(T().lay.fx1, { x: 1408, y: 96, z: 2 });
  assert.deepEqual([m.x, m.y], [1408, 96]);
  assert.equal(V().cables.list().length, 2);
  const port = V().ports().get('fx1.in');
  assert.deepEqual([port.x, port.y], [1408, 96 + 68], 'the cable follows');
  // a knob tweak after the move: undo keeps it (knob undo = today's policy)
  const k = Object.keys(T().vals).find(x => typeof T().vals[x] === 'number');
  T().vals[k] = 0.123;
  cv.undo();
  assert.equal(T() !== t0, true, 'History brings new track objects');
  assert.equal(T().vals[k], 0.123, 'knob value kept');
  assert.deepEqual(T().lay.fx1, { x: 1248, y: 0, z: 2 }, 'lay back to before the move (bring-to-front is not a step)');
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('fx1').y], [1248, 0], 'the module went back');
  cv.redo();
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('fx1').y], [1408, 96]);
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
  assert.deepEqual([T().lay.fx1.x, T().lay.fx1.y, T().lay.out.x, T().lay.out.fold], [1248, 0, 2176, 1]);
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

test('cvReveal: selects the track, focuses the module (k 1 below CARD_K); cvModuleSize: measured for the current model', () => {
  const other = P().tracks.find(t => t.id !== T().id);
  cv.reveal(other.id);
  assert.equal(T().id, other.id);
  assert.equal(W.log.at(-1), 'focus i1 {"k":' + W.k + ',"edit":false}', 'at or above CARD_K: the zoom stays');
  W.k = 0.3;
  cv.reveal(other.id);
  assert.equal(W.log.at(-1), 'focus i1 {"k":1,"edit":false}', 'below CARD_K: 100 %');
  W.k = 0.8;
  cv.reveal(other.id, 'out');
  assert.equal(W.log.at(-1), 'focus out {"k":0.8,"edit":false}');
  assert.deepEqual(cv.size('serum'), { w: 1200, h: 840 }, 'unseen: the default outline');
  const s = cv.size(T().model);
  assert.equal(s.w, V().modules.get('i1').w);
});

test('monitors (smon) follow the module: on while the Serum body shows, off in ROLL, folded or as a card', async () => {
  await sim.power(); sim.raf(); await sim.settle(5);
  const t = api.addTrack(undefined); // a classic track; switched to a Serum below
  api.setTrackModel(t, 'serum'); sim.raf(); await sim.settle(5);
  assert.equal(T().model, 'serum');
  assert.deepEqual([...V().modules.keys()].sort(), ['i1', 'i1/fx', 'out']);
  // the SerumUI does not load in the simulation: a stand-in panel for this track
  const refresh = { sx: 0, fx: 0 };
  cv.sxPanel.ui = { refresh() { refresh.sx++; }, destroy() {}, setSnapshot() {}, confirmChange: () => true, snap: null };
  cv.sxPanel.trackId = t.id; cv.sxPanel.vals = T().vals;
  const smon = () => api.nodes.get(t.id).node.posted.filter(x => x.m && x.m.t === 'smon').map(x => x.m.on);
  api.sxHost(T()).monitor(true);
  assert.deepEqual(smon().slice(-1), [true], 'shown: on');
  cv.openTab('roll');
  assert.deepEqual(smon().slice(-1), [false], 'ROLL: off');
  cv.openTab('canvas');
  assert.deepEqual(smon().slice(-1), [true], 'back: on');
  V().toggleFold('i1');
  assert.deepEqual(smon().slice(-1), [false], 'folded: off');
  V().toggleFold('i1');
  assert.deepEqual(smon().slice(-1), [true]);
  V().modules.get('i1').view('card', 'zoom');
  assert.deepEqual(smon().slice(-1), [false], 'a card: off');
  V().modules.get('i1').view('body');
  assert.deepEqual(smon().slice(-1), [true]);
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
  const chip = V().modules.get('i1').bar.children.find(c => c.className === 'cv-chip'), sel = () => chip.children[chip.children.length - 1]; // (the stub's textContent = '' keeps old children: the last is the chip)
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
  drag(V().modules.get('fx1'), 320, 0);
  assert.deepEqual([T().lay.fx1.x, T().lay.fx1.y], [1568, 0]);
  api.setTrackModel(T(), 'serum'); sim.raf();
  const sf = V().modules.get('i1/fx');
  assert.deepEqual([sf.x, sf.y], [1568, 0], 'the Serum FX takes its place');
  drag(sf, -296, 200);
  assert.deepEqual([T().lay['i1/fx'].x, T().lay['i1/fx'].y, 'fx1' in T().lay], [1280, 192, false], 'one FX entry');
  api.setTrackModel(T(), 'juno60'); sim.raf();
  const f = V().modules.get('fx1');
  assert.deepEqual([f.x, f.y], [1280, 192], 'back to a classic: where the user last put it');
  cv.tidy();
  assert.deepEqual(['fx1' in T().lay, 'i1/fx' in T().lay], [true, false], 'Tidy keeps one FX entry too');
  cv.undo();
  assert.deepEqual([V().modules.get('fx1').x, V().modules.get('fx1').y], [1280, 192], 'undo of the Tidy');
});
