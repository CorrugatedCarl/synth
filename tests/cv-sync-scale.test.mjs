import './v8-guard.mjs';
// (P R2-F2) the track view's sync on a big rack: ONE world update per sync, not one per module. Every edit of a 900 Series rack
// (an add, an undo, a re-patch, a move restored) re-syncs the view; V.sync called world.update(k) for each module and each call
// ran FACES.recheck (the overlap rule: every face × every world item) plus a stores pass — n modules × O(n²) = O(n³), 3.1 s at 511
// modules on an M4. The real cv-world (a fake GL: the GL path, FACES attached), the real cv-module createTrackView on the fake DOM
// with n patch modules ('pm', each a hardware face registered with cv-face), counted: world.update calls and FACES.recheck runs (it
// reads world.ids() once per run) per sync, at 64 and 256 modules — the same, one, whatever the size (counts, never wall-clock);
// and the batch equals the per-item path on a mixed edit (moved onto each other, added, removed, folded): every cached rect, face
// mode, on-screen flag, port. Never hand a fake-DOM node to assert (strings, numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-sync-scale.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as W from '../cv-world.js?v=9';
import * as M from '../cv-module.js?v=9';
import * as FACES from '../cv-face.js?v=9';

const { place } = dom;
let T = 1000;
const timers = [];
const setT = (f, ms) => { timers.push({ f, at: T + (+ms || 0), live: true }); return timers.length; };
const clearT = id => { if (id && timers[id - 1]) timers[id - 1].live = false; };
function fakeGL() {
  return (vp, o) => {
    const cv = o.doc.createElement('canvas'); cv.className = 'cv-gl'; vp.insertBefore(cv, o.world);
    const st = { frames: 0, ms: 0, max: 0, bytes: 0, texes: 0, lost: 0, w: 0, h: 0, d: 1 };
    let alive = true;
    return { canvas: cv, hooks: o, test: !!o.test,
      resize(vw, vh, d) { const w = Math.round(vw * d), h = Math.round(vh * d); if (w === st.w && h === st.h && d === st.d) return false; st.w = w; st.h = h; st.d = d; return true; },
      draw() { if (!alive) return false; st.frames++; return true; }, upload() { return null; }, free() {}, stats() { return Object.assign({}, st); },
      destroy() { alive = false; cv.remove(); }, get alive() { return alive; } };
  };
}
class Img { constructor() { this.onload = null; } set src(u) { this._src = u; } get src() { return this._src; } }

// a 900 Series view: the controller 'i1', a panel 'fx1' (it folds), OUT, and n patch modules 'i1/m<k>' (128 × 512, a face each);
// per: the legacy path — a list handed to world.update is replayed one id at a time (the old per-module calls)
function scene(n, o = {}) {
  const d = dom.fresh(), win = d.defaultView, rq = [];
  win.document = d; d.querySelectorAll = () => [];
  const vp = d.createElement('div'), w = d.createElement('div');
  vp.id = 'viewport'; vp.tabIndex = 0; w.id = 'world'; w.setAttribute('data-cv-world', ''); vp.append(w); d.body.append(vp); place(vp, 0, 0, 1440, 900);
  T = 1000; timers.length = 0;
  const world = W.createWorld(vp, { world: w, env: { win, doc: d, now: () => T, raf: f => { rq.push(f); return rq.length; }, caf: () => {}, setTimeout: setT, clearTimeout: clearT }, createGL: fakeGL() });
  const frame = (k = 1) => { for (let i = 0; i < k; i++) { const q = rq.splice(0); for (const f of q) f(T); T += 16; } };
  const cnt = { update: 0, ids: 0 };
  const upd = world.update, ids0 = world.ids;
  world.update = id => { cnt.update++; if (o.per && Array.isArray(id)) { for (const k of id) upd(k); return; } upd(id); };
  world.ids = () => { cnt.ids++; return ids0(); };
  const t = { id: 'trk', name: 'P', color: '#c0a060', prim: 'i1', nid: 2, dev: { i1: { kind: 'synth', model: 'm900', vals: {} }, fx1: { kind: 'panel' }, out: { kind: 'out' } }, wires: [] };
  const S = { n, gone: new Set() };
  const pms = () => {
    const a = [];
    for (let i = 1; i <= S.n; i++) if (!S.gone.has(i)) a.push({ key: 'i1/m' + i, kind: 'pm', dev: 'i1', mid: 'm' + i, type: '921a', title: 'M' + i, sub: '', fixed: { w: 128, h: 512 },
      jacks: [{ id: 'j-a', side: 'face', x: 40, y: 120, kind: 'cord', sig: 'v', dir: 'out', label: 'a', hit: 38 }] });
    return a;
  };
  const faces = new Map();
  const host = { doc: d, root: w, patch: false,
    devices: x => M.devicesOf(x).concat(pms()),
    size: k => (k === 'i1' ? { fixed: { w: 864, h: 352 } } : null),
    title: k => ({ title: k.toUpperCase() }),
    bodies: {
      mount: (k, b) => {
        if (!/\/m\d+$/.test(k)) return;
        const root = d.createElement('div'), deco = d.createElement('div'), svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
        root.className = 'inst hw'; deco.className = 'hw-decor'; deco.append(svg); root.append(deco); b.append(root);
        faces.set(k, FACES.register(deco, { markup: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="400"></svg>', w: 128, h: 400, offset: () => ({ x: 0, y: 40 }),
          env: { win, doc: d, Image: Img, Blob: class { constructor() {} }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} } } }));
      },
      unmount: k => { const f = faces.get(k); if (f) { f.destroy(); faces.delete(k); } },
    },
    lay: () => {},
  };
  const V = M.createTrackView(world, t, host);
  const snap = () => JSON.stringify({
    mods: [...V.modules].map(([k, m]) => [k, m.x, m.y, m.w, m.fold, m.z]),
    world: [...V.modules.keys()].map(k => [k, world.rectOf(k), world.onScreen(k)]),
    faces: [...faces].map(([k, f]) => [k, f.mode]),
    gl: (s => [s.faces, s.gl, s.dom])(FACES.stats()),
    ports: [...V.ports()].map(([k, p]) => [k, p.x, p.y]),
  });
  const done = () => { V.destroy(); world.destroy(); };
  return { world, V, t, S, cnt, frame, faces, snap, done, sync: () => V.sync(t) };
}

test('(P R2-F2) one edit on a big rack: V.sync makes ONE world.update and ONE overlap pass (FACES.recheck) at 64 and at 256 modules — an add, its undo, a move restored: the same counts at either size (it was one per module: O(n³))', () => {
  const warn = console.warn; console.warn = () => {}; // (cv-world's soft DOM budget warning at 256 modules)
  try {
    const rows = [];
    for (const n of [64, 256]) {
      const R = scene(n);
      R.frame(3);
      assert.equal(FACES.stats().faces, n, 'every module has its face registered');
      const row = [];
      const run = (what, edit) => { edit(); R.cnt.update = 0; R.cnt.ids = 0; R.sync(); row.push(what, R.cnt.update, R.cnt.ids); R.frame(2); };
      run('add', () => { R.S.n = n + 1; });
      run('undo', () => { R.S.n = n; });
      run('move', () => { R.t.lay = { 'i1/m3': { x: 4096, y: -2048 } }; });
      run('restore', () => { delete R.t.lay; });
      run('fold', () => { R.t.lay = { fx1: { x: 3000, y: 0, fold: 1 } }; });
      rows.push(row);
      R.done();
    }
    assert.deepEqual(rows[0], ['add', 1, 1, 'undo', 1, 1, 'move', 1, 1, 'restore', 1, 1, 'fold', 1, 1], 'n = 64: one update, one overlap pass per sync');
    assert.deepEqual(rows[1], rows[0], 'n = 256: the same counts — not one per module');
  } finally { console.warn = warn; }
});

test('(P R2-F2) the batched sync equals the per-item path on a mixed edit (moved onto each other, added, removed, folded): every module\'s place, the world\'s cached rects, items on / off screen, every face\'s mode, the ports — and a full world.update() after it changes nothing (nothing left stale)', () => {
  // (one scene at a time: cv-face's registry is the module's — a second world would see the first one's faces)
  const go = per => {
    const R = scene(40, { per });
    R.frame(3);
    const was = R.snap();
    R.S.n += 2; R.S.gone.add(10); R.S.gone.add(11); // two added, two removed
    R.t.lay = { 'i1/m5': { x: 650, y: -500 }, 'i1/m3': { x: 9000, y: -3000 }, 'i1/m7': { x: 128 * 8, y: 64 }, fx1: { x: 4000, y: 0, fold: 1 } }; // m5 onto m6 (their faces overlap), m3 far off screen, m7 moved, the panel folded
    R.cnt.update = 0; R.cnt.ids = 0;
    R.sync();
    const ids = R.cnt.ids; // (before the frame: its 'screen' event runs the overlap rule too)
    R.frame(3);
    const o = { was, snap: R.snap(), ids, kept: R.V.modules.size - 2 }; // (the two added ones were made, not updated)
    R.world.update(); R.frame(2); // a full update after: nothing may change
    o.settled = R.snap();
    R.done();
    return o;
  };
  const A = go(false), B = go(true);
  assert.equal(A.was, B.was, '(the same scene before the edit)');
  assert.equal(A.ids, 1, 'the batch: one overlap pass');
  assert.equal(B.ids, B.kept, 'the per-item replay: one per kept module');
  assert.equal(A.snap, B.snap, 'the same end state');
  assert.notEqual(A.snap, A.was, '(the edit changed something)');
  const snap = JSON.parse(A.snap);
  assert.deepEqual(snap.faces.filter(([, m]) => m === 'dom').map(([k]) => k).sort(), ['i1/m5', 'i1/m6'], 'the overlap rule ran: the two overlapped faces on the DOM tier');
  assert.equal(snap.mods.find(m => m[0] === 'fx1')[4], true, 'the panel folded');
  assert.equal(snap.world.find(r => r[0] === 'i1/m3')[2], false, 'the far one off screen');
  assert.equal(A.settled, A.snap, 'nothing stale: a full update changes nothing');
  assert.equal(B.settled, B.snap);
});
