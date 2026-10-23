import './v8-guard.mjs';
// Stage 9c fixes in the page simulation (docs/canvas/IMPL-9c.md §12 "Reviews and fixes", fixer U): a module tapped from the tray onto a
// shown System IIIc (its modifiers row has 64 px free, so patch-core's free slot falls to the line above the whole rack — behind the top
// bar at the default camera) is brought into view by the camera (main.js modShow's rule, review 2 F2); a drag-add never moves it; a 901B
// added when every 901A already drives three says so on a notice and on its bar (review 2 N1). Accessor-free guard build, canvas-9b-sim's
// scripted world (a recording stub for focusItem); one boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-9c-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as PT from '../patch-core.js?v=9';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
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
    focusItem() {}, dragPointer() {}, setDragging() {},
    ghost: g => (g ? { x: 0, y: 0, w: g.w, h: g.h } : null),
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
    cords: () => CORDS,
    setFitHook(fn) { W.fitHook = typeof fn === 'function' ? fn : null; return () => { if (W.fitHook === fn) W.fitHook = null; }; },
  };
  return W;
}

const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), I = (t, dev) => CMOD.instOf(t, dev);
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const dev = (t = T()) => CMOD.primId(t);
const rec = (t = T()) => cv.patchOf(t, dev(t));
const tap = b => b.dispatchEvent({ type: 'click', target: b, detail: 1, preventDefault() {}, stopPropagation() {} });
const W = () => cv.world();
const keyOf = mid => dev() + '/' + mid;
const posOf = k => { const m = cv.view().modules.get(k); return m ? { x: Math.round(m.x), y: Math.round(m.y) } : null; };
// is the module's whole rect inside the band at the camera it has (main.js modShow's test)?
const inBand = k => { const m = cv.view().modules.get(k), r = m.rect(), b = W().band(), a = W().toClient(r.x, r.y), z = W().toClient(r.x + r.w, r.y + r.h); return a.x >= b.left && a.y >= b.top && z.x <= b.right && z.y <= b.bottom; };
// the camera at zoom k with the controller's top-left at client (cx, cy)
const camAt = (k, cx, cy) => { const c0 = posOf(dev()); W().setCamera({ tx: cx - VP.left - c0.x * k, ty: cy - VP.top - c0.y * k, k }); };
const midsOf = type => Object.keys(rec().mods).filter(k => rec().mods[k].t === type).sort((a, b) => +a.slice(1) - +b.slice(1));
const foc = [];

test('setup: the System IIIc tile on the Minimoog track — a 900 Series of 36 modules (3 901As each driving three 901Bs); the camera at k 0.5 on the controller', async () => {
  const tiles = sh.shell.tiles;
  tiles.setView('moog');
  tap(tiles.setTile('s3c')); await settle();
  assert.equal(I(T(), dev()).model, 'm900');
  assert.equal(Object.keys(rec().mods).length, 36);
  assert.deepEqual(midsOf('901a').map(m => midsOf('901b').filter(b => rec().mods[b].drv === m).length), [3, 3, 3]);
  W().focusItem = (id, o) => foc.push(id + ' ' + JSON.stringify(o));
  camAt(0.5, 600, 900);
  foc.length = 0;
});

test('review 2 F2: a 984 tapped onto the shown IIIc lands on the line above the rack (world y −1888 from the controller: behind the top bar at k 0.5) — the camera brings it in (focusItem, no edit, at the zoom it has); a module that lands in view is left alone; a drag-add never moves the camera', async () => {
  const c0 = posOf(dev());
  const mid = cv.patch.add('984'); await settle();
  const k = keyOf(mid), p = posOf(k);
  assert.deepEqual([mid !== null, p.x - c0.x, p.y - c0.y], [true, 0, -1888], 'the free slot: the first line above the rack');
  assert.equal(inBand(k), false, 'out of the band at the default camera (that is the reported silence)');
  assert.deepEqual(foc, [k + ' {"k":0.5,"edit":false}'], 'brought in: one focusItem on the new module');
  // a module that lands in view: no move (a 901B at the end of the sources row, the camera showing it)
  foc.length = 0;
  camAt(0.5, 100, 900);
  const b = cv.patch.add('901b'); await settle();
  assert.equal(inBand(keyOf(b)), true, 'the 901B lands inside the band here');
  assert.deepEqual(foc, [], 'on screen already: the camera stays');
  // a drag-add: where it is dropped, no camera move even when that is out of view
  const d = cv.patch.add('991', { x: c0.x + 96, y: c0.y - 4000 }); await settle();
  assert.equal(inBand(keyOf(d)), false);
  assert.deepEqual(foc, [], 'a drop: unchanged');
});

test('review 2 N1: a 901B added when every 901A already drives three runs on its own — the notice says so and what to do, and its bar says "not driven" (a 901B with a driver free: no notice, "on 901A n"); the same for a duplicate', async () => {
  const t = T(), N1 = 'Every 901A already drives three — this 901B runs on its own; add a 901A to drive it';
  const driven = midsOf('901b').filter(m => rec().mods[m].drv);
  assert.deepEqual([driven.length, cv.patch.title(t, dev(t), driven[0]).sub, cv.patch.title(t, dev(t), driven[8]).sub], [9, 'on 901A 1', 'on 901A 3']);
  // a fresh add (the IIIc's nine are driven 3 / 3 / 3, so it has none) says it, long enough to read
  const mid = cv.patch.add('901b'); await settle();
  assert.deepEqual([rec().mods[mid].drv, cv.patch.title(t, dev(t), mid).sub, note()], [undefined, 'not driven', N1]);
  // a 901A makes room: the next 901B takes it (no notice), and the duplicate of a driven 901B whose driver is full says it again
  const a4 = cv.patch.add('901a'); await settle();
  sim.$('#notice').textContent = '';
  const n1 = cv.patch.add('901b'); await settle();
  assert.equal(rec().mods[n1].drv, a4, 'the 4th 901A drives it');
  assert.notEqual(note(), N1, 'a driver with room: no notice');
  assert.equal(cv.patch.title(t, dev(t), n1).sub, 'on 901A 4');
  cv.patch.add('901b'); cv.patch.add('901b'); await settle();    // (the 4th 901A's second and third)
  cv.patch.duplicate(driven[0]); await settle();
  assert.equal(note(), N1, 'a duplicate with no driver room too');
  assert.equal(JSON.stringify(PT.normPatch(JSON.parse(JSON.stringify(rec())), 'moog')), JSON.stringify(rec()), 'a record normPatch keeps whole');
});
