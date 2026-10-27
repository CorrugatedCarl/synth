import './v8-guard.mjs';
// Stage 9b lane H9b (docs/canvas/IMPL-9b.md §6, §8.6): the System 35 / System 55 sets in the page simulation with the real engine —
// main.js wires the set tiles (cv-tray SET_TILES: setPick / setDrag, greyed by setFull at the cap), patchNew's set (moog-core
// makeSet), the payload with the routing panels' rows (patch-core payload(rec, f, vals): a bus switch posts the graph at once, no
// History step), the momentary events ({t: 'seq', s: {pe: [n, k]}}), the lamps' monitor (smon.pt → cv-patch's frame queue, dark
// while the patch is not heard), the set's one-time notice and the Song clock's transport. First the lead's fixture check (§7.2
// phase 2). Accessor-free: the app runs as a guard build (a track's v1 keys throw) — instruments read as devices (cv-model
// instOf), the hosts through the __synthTest hooks. canvas-9-sim's scripted world with a recording cord layer; one boot; strings,
// numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-9b-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as PT from '../patch-core.js?v=9';
import * as MG from '../moog-core.js?v=9';
import * as cvPatch from '../cv-patch.js?v=9';
import * as cvTray from '../cv-tray.js?v=9';
import * as COSTM from '../cv-cost.js?v=9';
import { MODELS } from '../models.js?v=9';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
// the cord layer's stand-in (IMPL-9 §7.4's interface): every call recorded, the last set / anchors kept
const CORDS = { calls: [], list: null, anchors: null, on: null };
for (const k of ['live', 'grab', 'move', 'drop', 'sel', 'resize', 'step', 'draw', 'destroy', 'dim']) CORDS[k] = (...a) => { CORDS.calls.push([k, a.length ? JSON.parse(JSON.stringify(a[0] === undefined ? null : a[0])) : null]); };
CORDS.set = L => { CORDS.calls.push(['set', L.length]); CORDS.list = JSON.parse(JSON.stringify(L)); };
CORDS.anchors = M => { CORDS.calls.push(['anchors', M.size]); CORDS.at = M; };
CORDS.alloc = on => { CORDS.calls.push(['alloc', !!on]); CORDS.on = !!on; };
const GHOSTS = [];
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
    ghost: g => { GHOSTS.push(g ? JSON.parse(JSON.stringify(g)) : null); return g ? { x: 0, y: 0, w: g.w, h: g.h } : null; },
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
const byId = id => P().tracks.find(t => t.id === id);
const node = t => sim.nodeOf(t.id);
const sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);
const got = (t, k) => node(t).got.filter(m => m.t === k);
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const dev = (t = T()) => CMOD.primId(t);
const rec = (t = T()) => cv.patchOf(t, dev(t));
const vals = (t = T()) => I(t, dev(t)).vals;
const midOf = (type, n = 1, r = rec()) => Object.keys(r.mods).filter(k => r.mods[k].t === type).sort((a, b) => +a.slice(1) - +b.slice(1))[n - 1];
const pgs = t => sent(t, 'seq').filter(m => m.s && m.s.pg);
const tap = b => b.dispatchEvent({ type: 'click', target: b, detail: 1, preventDefault() {}, stopPropagation() {} });
const MODEL = id => MODELS.find(m => m.id === id);
const sr = () => sim.ctx().sampleRate;
// the 960's stage from its lamp bits (bit k − 1 = stage k, bit 9 its OSC lamp): 0 when none is lit
const stageOf = b => { for (let k = 0; k < 9; k++) if ((b >> k) & 1) return k + 1; return 0; };
// the lamp posts the node sent for the 960 of the shown patch: [F, bits] in order
const lampPosts = (t, n) => got(t, 'smon').filter(m => m.pt).map(m => { const l = m.pt.l; for (let i = 0; i + 1 < l.length; i += 2) if (l[i] === n) return [m.pt.F, l[i + 1]]; return null; }).filter(Boolean);
// the fundamental's period (frames) of x[a, b) by normalised autocorrelation: the first lag past the zero-lag lobe whose
// correlation reaches 0.85 of the best (the octave below never wins)
function period(x, a, b) {
  const n = b - a, lo = 20, hi = Math.min(2400, n >> 1), r = new Float64Array(hi + 1);
  let e0 = 0;
  for (let i = a; i < b; i++) e0 += x[i] * x[i];
  for (let L = lo; L <= hi; L++) { let s = 0, e1 = 0; for (let i = a; i + L < b; i++) { s += x[i] * x[i + L]; e1 += x[i + L] * x[i + L]; } r[L] = s / Math.sqrt(e0 * e1 + 1e-30); }
  let best = 0;
  for (let L = lo; L <= hi; L++) if (r[L] > best) best = r[L];
  let L0 = lo;
  while (L0 < hi && r[L0] > 0.3) L0++; // (past the zero-lag lobe)
  for (let L = L0; L <= hi; L++) if (r[L] >= 0.85 * best && r[L] >= r[L - 1] && r[L] >= (r[L + 1] || 0)) return L;
  return 0;
}
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const attr = (n, k) => (n && n.attrs ? n.attrs[k] : undefined);
const posOf = k => { const m = cv.view().modules.get(k); return m ? { x: Math.round(m.x), y: Math.round(m.y) } : null; };
const keyOf = (mid, t = T()) => dev(t) + '/' + mid;
// the rack as Tidy places it (patch-core rackLayout over the controller's top-left), world px; the modules elsewhere
const rackAt = (t = T()) => { const c = posOf(dev(t)), R = PT.rackLayout(rec(t), 'moog'), o = {}; for (const mid of Object.keys(R)) o[keyOf(mid, t)] = { x: c.x + R[mid].x, y: c.y + R[mid].y }; return o; };
const misplaced = (t = T()) => { const R = rackAt(t); return Object.keys(R).filter(k => JSON.stringify(posOf(k)) !== JSON.stringify(R[k])); };
const isConsole = mid => MG.CONSOLE.includes(rec().mods[mid].t);
// a plug drag on a cord jack through the cable drag (cv-cables → o.cordPress → cv-patch), the finger released at (x, y) — canvas-9-sim's
const cordJack = end => { const k = cvPatch.jackKey(dev(), end), J = cv.view().jacks().find(j => j.id === k); return J ? J.el : null; };
function fire(e) { for (const f of (sim.dom.docL[e.type] || []).slice()) f(e); }
function drag(end, x, y) {
  const el = cordJack(end), D = cv.mod.cableDrag(), id = 7 + drag.n++;
  const q = cv.view().ports().get(cvPatch.jackKey(dev(), end)), p = cv.world().toClient(q.x, q.y);
  const ev = (type, cx, cy) => ({ type, pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: cx, clientY: cy, target: el, preventDefault() {}, stopPropagation() {} });
  const r = D.press(ev('pointerdown', p.x, p.y), el);
  if (!r) return false;
  fire(ev('pointermove', p.x + 12, p.y + 12));
  fire(ev('pointermove', x, y));
  fire(ev('pointerup', x, y));
  return true;
}
drag.n = 0;
const ID = {};

test('review 2 N2: the set\'s one-time "The sequence starts when you press ▶" is not said while the song is playing (the sequence is already running in step with it) — and not spent: the next load with the transport stopped says it', async () => {
  const tiles = sh.shell.tiles;
  tiles.setView('moog');
  sim.$('#tPlay').onclick(); await settle();
  assert.equal(api.transport().playing, true, '▶');
  const t0 = T();
  assert.equal(I(t0, dev(t0)).model, 'minimoog');
  tap(tiles.setTile('s55')); await settle();
  assert.equal(I(T(), dev()).model, 'm900');
  assert.equal(note(), 'Replaced Minimoog with 900 Series (System 55) · tap to undo', 'playing: the Replace names the set, no ▶ tail');
  sim.$('#tPlay').onclick(); await settle();
  assert.equal(api.transport().playing, false, '■');
  cv.undo(); await settle();
  assert.equal(I(T(), dev()).model, 'minimoog', 'undone: the Minimoog back (the next test taps the tile again, stopped: the note is still to say)');
});

test('review 2 N3: the set tiles carry the load estimate the Model 15 tile shows — cv-cost over the set\'s own record and knobs (makeSet: what a tap makes), on this device\'s speed; costLabels (the measured factor) re-reads them', async () => {
  const tiles = sh.shell.tiles, txt = b => (b.children.find(c => c.className === 'cv-tcost') || {}).textContent;
  const want = (id, f) => { const r = MG.makeSet(id, {}); return COSTM.label(COSTM.estimate({ kind: 'synth', model: 'm900', patch: r.rec, vals: r.vals }, f)); };
  tiles.setView('moog');
  assert.deepEqual(tiles.setTiles().map(txt), [want('s35', 1), want('s55', 1), want('s3c', 1)], 'the set tiles (9c: the System IIIc\'s too)');
  assert.equal(/^(~\d+|<1) %$/.test(txt(tiles.setTile('s55'))), true, txt(tiles.setTile('s55')));
  assert.equal(txt(tiles.tiles().find(b => b.getAttribute('data-model') === 'm900')), COSTM.label(COSTM.estimate('m900', 1)), 'beside the Model 15 tile\'s');
  api.store.set('synth.cv.devFactor', 10); cv.costLabels();
  assert.deepEqual(tiles.setTiles().map(txt), [want('s35', 10), want('s55', 10), want('s3c', 10)], 'a slower device: ×10');
  assert.notEqual(txt(tiles.setTile('s55')), want('s55', 1));
  api.store.set('synth.cv.devFactor', 0); cv.costLabels();
  assert.deepEqual(tiles.setTiles().map(txt), [want('s35', 1), want('s55', 1), want('s3c', 1)], 'back');
});

test('the lead\'s fixture check (§7.2 phase 2): the System 55 tile on track 1 → a 900 Series of 37 modules; the payload with the routing rows of none (every switch off: the CP2\'s always-on two); a note transposes; ▶ starts the sequence ({t: seq, s: {pg}} then the song); a 993 switch → a new pk posted, no History step', async () => {
  const tiles = sh.shell.tiles;
  tiles.setView('moog');
  assert.deepEqual(tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), ['m900'], 'the Moog modules view: the Model 15 tile');
  assert.deepEqual(tiles.setTiles().filter(b => !b.hidden).map(b => b.getAttribute('data-set')), ['s35', 's55', 's3c'], 'then the set tiles System 35 / System 55 / System IIIc');
  const t0 = T();
  assert.equal(I(t0, dev(t0)).model, 'minimoog');
  node(t0).posted.length = 0;
  tap(tiles.setTile('s55')); await settle();
  const t = T(), d = dev(t);
  assert.equal(t.id, t0.id, 'track 1, replaced');
  assert.equal(I(t, d).model, 'm900');
  const ref = MG.makeSet('s55', { p: {} });
  assert.equal(JSON.stringify(rec()), JSON.stringify(ref.rec), 'the System 55 set patched as Sequence');
  assert.equal(Object.keys(rec().mods).length, 37, '37 modules');
  assert.equal(JSON.stringify(vals().p), JSON.stringify(ref.vals.p), 'its knobs');
  assert.match(note(), /^Replaced Minimoog with 900 Series \(System 55\) — The sequence starts when you press ▶ · tap to undo$/);
  // the payload: the cords and the routing rows of none — every routing switch off, the CP2's two always-on rows
  const sq = pgs(t).filter(m => m.i === d).at(-1);
  assert.equal(JSON.stringify(sq.s), JSON.stringify(PT.payload(rec(), 'moog', vals())), '{t: seq}: the graph payload with the rows');
  const rows = PT.busRows(rec(), 'moog', vals());
  assert.deepEqual(rows.map(r => [r.panel, r.sw.length, r.a, r.b].join(' ')), [midOf('cp2') + ' 0 c.kp1 ' + midOf('cp2') + '.kpr', midOf('cp2') + ' 0 c.ks1 ' + midOf('cp2') + '.ksr'], 'the rows: none switched');
  assert.equal(sq.s.pg.cords.length, rec().cords.length + 2, 'the cords and the two rows');
  ID.pk0 = sq.s.pk;
  // ▶: the graph first, then the song; the sequence steps (the 960's lamps through the monitor) — stopped, it held stage 1
  const m960 = midOf('960'), n960 = +m960.slice(1);
  sim.run(Math.round(0.3 * sr())); sim.raf(); await settle(2);
  const held = lampPosts(t, n960);
  assert.equal(held.length > 0, true, 'the 960\'s lamps heard (its face mounted, the monitor on)');
  assert.deepEqual([...new Set(held.map(x => stageOf(x[1])))], [1], 'stopped: stage 1, the clock off');
  node(t).posted.length = 0; node(t).got.length = 0;
  sim.$('#tPlay').onclick(); await settle(2);
  const ord = node(t).posted.map(x => x.m).filter(m => (m.t === 'seq' && m.s && m.s.pg) || m.t === 'transport').map(m => m.t);
  assert.deepEqual(ord.slice(-1), ['transport'], 'the song after the graph');
  assert.equal(sent(t, 'transport').at(-1).play, true);
  sim.run(Math.round(0.6 * sr())); sim.raf(); await settle(2);
  const st = lampPosts(t, n960).map(x => stageOf(x[1]));
  assert.equal(st[0] <= 2, true, 'the sequence from its start');
  assert.equal(Math.max(...st) >= 4, true, 'and stepping: 1/16 at 120 BPM (stages ' + [...new Set(st)].join(' ') + ')');
  assert.equal(cv.patch.lampBits(t, d, m960) > 0, true, 'the face\'s lamps lit from the queue');
  // a note transposes: the riff's first steps (C, C) with no key, then with C5 held (pressed once ▶'s anchor has played: Play
  // from a stop starts the patch fresh, P-2) — an octave up; let go, as written
  sim.$('#tPlay').onclick(); await settle();
  const take = async key => {
    sim.$('#tPlay').onclick(); await settle();
    sim.run(Math.round(0.07 * sr()) + 512);
    if (key) api.noteOn(key, 100, 0);
    const o = sim.run(Math.round(0.25 * sr())).get(node(t));
    if (key) api.noteOff(key, 0);
    sim.$('#tPlay').onclick(); await settle();
    return period(o.L, Math.round(0.02 * sr()), Math.round(0.24 * sr()));
  };
  const p0 = await take(0), p1 = await take(72), p2 = await take(0);
  assert.equal(p0 > 0 && p1 > 0, true, 'pitched (' + p0 + ', ' + p1 + ')');
  assert.equal(Math.abs(p0 / p1 - 2) < 0.06, true, 'C5 held: an octave up (' + p0 + ' / ' + p1 + ' frames)');
  assert.equal(p2, p0, 'let go: as written');
  // a 993 switch (the knob policy): a new pk posted at once, no History step
  const m993 = midOf('993'), n0 = cv.hist.u.length;
  node(t).posted.length = 0;
  cv.patch.knobSet(t, d, m993, 'f1', 1);
  const pk1 = pgs(t).map(m => m.s.pk);
  assert.deepEqual(pk1, [PT.payload(rec(), 'moog', vals()).pk], 'one payload, the new pk, at once');
  assert.notEqual(pk1[0], ID.pk0);
  await settle();
  assert.equal(cv.hist.u.length, n0, 'no History step');
  assert.equal(vals().p[m993].f1, 1);
  cv.patch.knobSet(t, d, m993, 'f1', 0); await settle();
  assert.equal(pgs(t).at(-1).s.pk, ID.pk0, 'off: the old graph again');
  assert.equal(api.transport().playing, false, '(stopped)');
  ID.t1 = t.id;
});

test('§1.2 / §8.6: the System 35 tile on another track — a Replace naming the set (no one-time note for it), the rack laid out (the console row flush above the controller, the two cabinet rows over it, one line each); its tap undoes; + Track and a drop on the track list make a new 900 Series with the set', async () => {
  api.addTrack(MODEL('juno60')); await settle();
  const t2 = T();
  cv.setPick('s35', 'replace'); await settle();
  assert.equal(T().id, t2.id);
  assert.equal(I(T(), dev()).model, 'm900');
  assert.match(note(), /^Replaced Juno-60 with 900 Series \(System 35\) · tap to undo$/);
  const ref = MG.makeSet('s35', { p: {} });
  assert.deepEqual([JSON.stringify(rec()) === JSON.stringify(ref.rec), rec().name, Object.keys(rec().mods).length], [true, 'Swept band', 22], 'the System 35 set patched as Swept band');
  assert.deepEqual(misplaced(), [], 'every module at Tidy\'s place');
  const c = posOf(dev()), mids = Object.keys(rec().mods), con = mids.filter(isConsole), cab = mids.filter(m => !isConsole(m)), H = m => MG.TYPES[rec().mods[m].t].h;
  assert.equal(con.length, 5, 'five console panels');
  assert.equal(con.every(m => posOf(keyOf(m)).y + H(m) === c.y), true, 'the console row flush above the controller');
  assert.equal(new Set(cab.map(m => posOf(keyOf(m)).y)).size, 2, 'two cabinet rows, one line each');
  assert.equal(cab.every(m => posOf(keyOf(m)).y + H(m) <= Math.min(...con.map(k => posOf(keyOf(k)).y))), true, 'over the console row');
  assert.equal(Math.max(...mids.map(m => posOf(keyOf(m)).x + MG.TYPES[rec().mods[m].t].w)) - c.x <= MG.FAMILY.rackWide, true, 'within the cabinet width');
  assert.deepEqual([pgs(T()).at(-1).s.pk === PT.payload(rec(), 'moog', vals()).pk, PT.busRows(rec(), 'moog', vals()).length], [true, 0], 'its payload: no routing row lit');
  sim.$('#notice').onclick(); await settle();
  assert.equal(I(T(), dev()).model, 'juno60', 'tapped: the Juno back');
  // + Track: a new 900 Series track holding the set (the System 55's one-time note was said: not again)
  const nT = P().tracks.length;
  api.notice('', 0);
  cv.setPick('s55', 'track'); await settle();
  assert.deepEqual([P().tracks.length, I(T(), dev()).model, Object.keys(rec().mods).length, rec().name], [nT + 1, 'm900', 37, 'Sequence'], '+ Track: a new track with the System 55');
  assert.equal(note(), '', 'its note: once a session');
  assert.deepEqual(misplaced(), [], 'laid out');
  // a drop on the track list: another (the System 35)
  cv.setDrag.begin('s35', { over: 'tracks', x: 300, y: 20 });
  assert.equal(cv.setDrag.drop('s35', { over: 'tracks', x: 300, y: 20 }), true);
  await settle();
  assert.deepEqual([P().tracks.length, Object.keys(rec().mods).length, rec().name], [nT + 2, 22, 'Swept band'], 'dropped on the track list: a new track with the System 35');
  api.deleteTrack(T()); await settle();
  api.deleteTrack(T()); await settle();
  assert.equal(P().tracks.length, nT);
  ID.t2 = t2.id;
});

test('§4.3: a set tile dragged over the canvas outlines its whole rack — pinned with the controller on the instrument\'s module (a Replace in place) —, its drop replaces; on a 900 Series the outline from its own controller, its drop loads the set', async () => {
  api.selectTrack(ID.t2); await settle();
  assert.equal(I(T(), dev()).model, 'juno60');
  const b = cv.setBox('s55'), m = cv.view().modules.get(dev()).rect(), W = cv.world();
  assert.deepEqual([b.x, b.y, b.w, b.h], [0, -1376, 2624, 1376 + 352], 'the System 55\'s outline: two cabinet rows and the console row over the controller');
  GHOSTS.length = 0;
  cv.setDrag.begin('s55', { over: 'canvas', x: 600, y: 400, left: true });
  const g = GHOSTS.at(-1), at = W.toClient(m.x + b.x, m.y + b.y);
  assert.deepEqual([g.x, g.y, g.w, g.h, g.snap, g.label], [at.x, at.y, b.w, b.h, false, '+ System 55 · replaces Juno-60'], 'pinned: the controller where the Juno is');
  cv.setDrag.drop('s55', { over: 'canvas', x: 600, y: 400 }); await settle();
  assert.deepEqual([I(T(), dev()).model, Object.keys(rec().mods).length], ['m900', 37], 'dropped: a 900 Series with the System 55');
  assert.match(note(), /^Replaced Juno-60 with 900 Series \(System 55\) · tap to undo$/, 'its note was said: once a session');
  GHOSTS.length = 0;
  cv.setDrag.move('s35', { over: 'canvas', x: 600, y: 400, left: true });
  assert.equal(GHOSTS.at(-1).label, '+ System 35', 'on a 900 Series: no Replace');
  const n0 = cv.hist.u.length;
  cv.setDrag.drop('s35', { over: 'canvas', x: 600, y: 400 }); await settle();
  assert.deepEqual([cv.hist.u.length - n0, cv.hist.u.at(-1).label, rec().name], [1, 'Load System 35', 'Swept band'], 'dropped on a 900 Series: the set loaded over it');
  cv.undo(); cv.undo(); await settle();
  assert.equal(I(T(), dev()).model, 'juno60');
});

test('§1.2 / §8.6: a System 55 tile on a Model 15 900 Series — one step "Load System 55": the missing modules added, Sequence loaded, every module laid out from the controller in the same step; undo gives the topology, the knobs and the places back; a set tile greyed when the patch cannot hold its set', async () => {
  api.selectTrack(ID.t2); await settle();
  sh.srcPick('m900', 'replace'); await settle(); // (the Model 15 set as Classic bass)
  assert.deepEqual([I(T(), dev()).model, Object.keys(rec().mods).length, rec().name], ['m900', 12, 'Classic bass']);
  // a Model 15 module moved by hand: the set tile lays it out again
  const k1 = keyOf('m1'), c = posOf(dev());
  T().lay = Object.assign({}, T().lay, { [k1]: { x: c.x - 4000, y: c.y - 4000 } }); cv.render(); await settle();
  assert.deepEqual(misplaced(), [k1]);
  const r0 = JSON.stringify(rec()), v0 = JSON.stringify(vals()), l0 = JSON.stringify(T().lay), n0 = cv.hist.u.length;
  node(T()).posted.length = 0;
  cv.setPick('s55', 'replace'); await settle();
  assert.deepEqual([cv.hist.u.length - n0, cv.hist.u.at(-1).label, cv.hist.u.at(-1).meta.pt], [1, 'Load System 55', 1], 'one preset step');
  assert.deepEqual([Object.keys(rec().mods).length, rec().name], [12 + 27, 'Sequence'], 'the 27 missing modules added, Sequence loaded');
  assert.match(note(), /^Loaded System 55 · tap to undo$/, 'the set\'s note: said once a session');
  assert.deepEqual(misplaced(), [], 'every module at Tidy\'s place — the hand-moved 921 too');
  assert.equal(Object.keys(rec().mods).every(m => !!T().lay[keyOf(m)]), true, 'their places written in the step');
  const pts = node(T()).posted.map(x => x.m).filter(m => (m.t === 'patch' || m.t === 'seq') && m.i === dev()).map(m => m.t);
  assert.deepEqual(pts.slice(0, 2), ['patch', 'seq'], 'the knobs it wrote, then its graph');
  assert.equal(pgs(T()).at(-1).s.pk, PT.payload(rec(), 'moog', vals()).pk);
  cv.undo(); await settle();
  assert.deepEqual([JSON.stringify(rec()) === r0, JSON.stringify(vals()) === v0, JSON.stringify(T().lay) === l0], [true, true, true], 'undo: the topology, the knobs and the places back');
  assert.deepEqual(misplaced(), [k1]);
  cv.redo(); await settle();
  assert.equal(Object.keys(rec().mods).length, 39, 'redo');
  cv.undo(); await settle();
  // the bound (IMPL-P: 512 modules; was 48): a Model 15 + 474 more 995s (486 modules; the System 55 has one 995, the Model 15 already holds it) cannot take the
  // System 55's 27 more; the System 35's fit
  // (opened as a project — one sync, not 474 taps: the add path at the bound is canvas-9-sim's)
  const snap = JSON.stringify(P()), big = JSON.parse(snap), bd = big.tracks.find(x => x.id === T().id).dev[dev()];
  let br = bd.patch;
  for (let i = 0; i < PT.MAX_MODS - 38; i++) br = PT.addModule(br, bd.vals, '995').rec;
  bd.patch = br;
  const n1 = cv.hist.u.length;
  api.applyRestore(cv.loadProject(JSON.stringify(big))); await settle();
  assert.deepEqual([Object.keys(rec().mods).length, PT.setNeeds(rec(), 's55')], [PT.MAX_MODS - 26, 27]);
  const S55 = sh.shell.tiles.setTile('s55'), S35 = sh.shell.tiles.setTile('s35');
  assert.deepEqual([attr(S55, 'aria-disabled'), sh.shell.tiles.setPlacedOf('s55')], ['true', 'This set needs 1 more module than the patch can hold'], 'the System 55 greyed with its reason');
  assert.deepEqual([attr(S35, 'aria-disabled'), sh.shell.tiles.setPlacedOf('s35')], [undefined, null], 'the System 35 fits');
  const n2 = cv.hist.u.length;
  tap(S55); await settle();
  assert.equal(cv.hist.u.length, n2, 'a greyed tile does nothing');
  assert.equal(cv.hist.u.length, n1);
  api.applyRestore(cv.loadProject(snap)); await settle();
  assert.equal(sh.shell.tiles.setPlacedOf('s55'), null, 'available again');
});

test('§1.4 / §6: a routing switch posts its graph at once, no step; a cord pulled and undone keeps the switch (keepDevs) and re-posts the graph with its row; a preset whose knobs include routing switches (Routed): its undo puts them back off and re-posts the graph (applyRestore\'s loop); the 993 selected outlines what its lit rows reach', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), m993 = midOf('993'), k993 = keyOf(m993), pk0 = PT.payload(rec(), 'moog', vals()).pk;
  assert.equal(pgs(t).at(-1).s.pk, pk0);
  const n0 = cv.hist.u.length;
  cv.patch.knobSet(t, d, m993, 'e1', 1); await settle();
  const pkE = PT.payload(rec(), 'moog', vals()).pk;
  assert.deepEqual([pgs(t).at(-1).s.pk === pkE, pkE !== pk0, cv.hist.u.length - n0], [true, true, 0], 'ENVELOPE 1 (911 1 into 902 1): posted, no step');
  // a cord pulled (one step) and undone: the cord back, the switch as it is, the graph with its row
  const c1 = rec().cords.find(c => c.a === 'c.kp1');
  assert.equal(drag('c.kp1', 4000, 3000), true, 'the plug pressed'); await settle();
  assert.deepEqual([rec().cords.some(c => c.id === c1.id), cv.hist.u.at(-1).label, pgs(t).at(-1).s.pk === PT.payload(rec(), 'moog', vals()).pk], [false, 'Pull cord', true]);
  node(t).posted.length = 0;
  cv.undo(); await settle();
  assert.deepEqual([rec().cords.some(c => c.id === c1.id), vals().p[m993].e1], [true, 1], 'undo: the cord back, the switch kept');
  assert.deepEqual(pgs(T()).map(m => m.s.pk), [pkE], 'the graph with its row again');
  // selecting the 993 outlines the modules its lit rows reach (ENVELOPE 1: 911 1, 902 1)
  const mem = () => [...cv.view().modules].filter(([, m]) => m.el.hasAttribute('data-cv-member')).map(([k]) => k).sort();
  cv.world().select(k993);
  assert.deepEqual(mem(), [keyOf(midOf('911')), keyOf(midOf('902'))].sort(), 'the 993 selected: 911 1 and 902 1 outlined');
  cv.patch.knobSet(T(), d, m993, 'f1', 1); cv.patch.knobSet(T(), d, m993, 't1', 1); await settle();
  assert.deepEqual(mem(), [d, keyOf(midOf('911')), keyOf(midOf('911a')), keyOf(midOf('902'))].sort(), 'FROM 1 + TRIGGER 1: the controller and the 911A too');
  cv.world().select(null);
  assert.deepEqual(mem(), []);
  for (const s of ['e1', 'f1', 't1']) cv.patch.knobSet(T(), d, m993, s, 0);
  await settle();
  assert.equal(pgs(T()).at(-1).s.pk, pk0, 'all off: the first graph');
  // Routed (⋯ → Patches): its knobs light the CP3A 1 / 993 switches — its graph with their rows; undo: off again, the graph re-posted
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(j => [j, x[j]])) : x)); // (ptBack writes a field back in place: the same values, another key order)
  const v0 = canon(vals()), r0 = JSON.stringify(rec());
  cv.patch.preset('Routed'); await settle();
  const rows = PT.busRows(rec(), 'moog', vals());
  assert.deepEqual([rec().name, rows.filter(r => r.sw.length).length], ['Routed', 5], 'Routed: five lit rows (CP3A 1 KEYBOARD, the 993\'s four)');
  assert.equal(pgs(T()).at(-1).s.pk, PT.payload(rec(), 'moog', vals()).pk);
  node(T()).posted.length = 0;
  cv.undo(); await settle();
  assert.deepEqual([JSON.stringify(rec()) === r0, canon(vals()) === v0], [true, true], 'undo: the topology and the switches back');
  assert.deepEqual(pgs(T()).map(m => m.s.pk), [pk0], 'the graph re-posted without the rows');
});

test('§1.5 / §1.6: a SET tap (Enter on the 960\'s SET 3) → {t: seq, s: {pe: [n, k]}} — the 960 on stage 3, its lamps from the monitor\'s queue on the face; ptEv refuses what is no event; a track switch takes the lamps\' monitor off and back', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), m960 = midOf('960'), n960 = +m960.slice(1), B = cv.pmBodies.get(keyOf(m960));
  assert.equal(!!B, true, 'the 960\'s face mounted');
  assert.deepEqual([...cv.ptLamps().keys()], [t.id + '/' + d], 'one monitor for the instrument');
  assert.deepEqual(cv.ptLamps().get(t.id + '/' + d).sort(), [keyOf(m960), keyOf(midOf('962')), keyOf(midOf('clk'))].sort(), 'its faces with lamps: the 960, the 962, the Song clock');
  const b3 = walk(B.el, n => attr(n, 'data-ev') === 'e3')[0];
  assert.equal(attr(b3, 'aria-label'), '960 1 · SET 3');
  node(t).posted.length = 0;
  b3.dispatchEvent({ type: 'keydown', key: 'Enter', repeat: false, target: b3, preventDefault() {}, stopPropagation() {} });
  const pe = sent(t, 'seq').filter(m => m.s && m.s.pe);
  assert.deepEqual(pe.map(m => [m.i, m.s.pe.join()]), [[d, n960 + ',5']], 'SET 3: its event, k = 5 in the 960\'s row (OSC ON, OSC OFF, SHIFT, SET 1 …)');
  assert.equal(cv.hist.u.length > 0 && cv.hist.u.at(-1).label !== 'SET 3', true, 'no History step');
  node(t).got.length = 0;
  sim.run(Math.round(0.15 * sr())); sim.raf(); await settle(2);
  const st = lampPosts(t, n960).map(x => stageOf(x[1]));
  assert.equal(st.length > 0 && st.at(-1), 3, 'the 960 on stage 3 (' + st.join() + ')');
  const lit = walk(B.el, n => attr(n, 'data-lamp') && attr(n, 'data-on') !== undefined).map(n => attr(n, 'data-lamp'));
  assert.deepEqual(lit, ['l3'], 'its face: lamp 3 lit, the OSC lamp dark (stopped)');
  // ptEv: an id its type does not have, the controller, a type without events → nothing posted
  node(t).posted.length = 0;
  assert.deepEqual([cv.ptEv(t, d, m960, 'zz'), cv.ptEv(t, d, 'c', 'e1'), cv.ptEv(t, d, midOf('904a'), 'e1'), cv.ptEv(t, d, m960, 'e1')], [false, false, false, true]);
  assert.equal(sent(t, 'seq').filter(m => m.s && m.s.pe).length, 1);
  // a track switch: the monitor's part off ({t: mon} without it), back on with the track
  api.selectTrack(ID.t2); await settle();
  assert.equal((sent(t, 'mon').at(-1) || { ids: [] }).ids.includes(d), false, 'another track shown: the lamps\' monitor off');
  api.selectTrack(ID.t1); await settle();
  assert.equal(sent(t, 'mon').at(-1).ids.includes(d), true, 'back: on');
});

test('§3.4 / §3.6: ▶ steps the sequence, ■ holds it; muted (P-1) the patch is off and its lamps dark — posts dropped while it is not heard —, unmuted it is back at stage 1; ⏻ the same', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), m960 = midOf('960'), n960 = +m960.slice(1);
  node(t).got.length = 0;
  sim.$('#tPlay').onclick(); await settle();
  sim.run(Math.round(0.6 * sr())); sim.raf(); await settle(2);
  const a = lampPosts(t, n960).map(x => stageOf(x[1]));
  assert.equal(new Set(a).size >= 3, true, '▶: stepping (' + a.join() + ')');
  sim.$('#tPlay').onclick(); await settle(); // ■
  sim.run(Math.round(0.05 * sr())); sim.raf(); await settle();
  node(t).got.length = 0;
  sim.run(Math.round(0.5 * sr())); sim.raf(); await settle(2);
  const b = lampPosts(t, n960).map(x => stageOf(x[1]));
  assert.equal(b.length > 0 && new Set(b).size, 1, '■: held (' + b.join() + ')');
  assert.equal(cv.patch.lampBits(t, d, m960) > 0, true);
  // muted: off, dark, nothing delivered
  const posts0 = cv.patch.stats().lamps.posts;
  t.mute = true; cv.mix(); await settle();
  assert.equal(cv.patch.lampBits(t, d, m960), 0, 'muted: its lamps dark');
  sim.run(Math.round(0.3 * sr())); sim.raf(); await settle(2);
  assert.deepEqual([cv.patch.lampBits(t, d, m960), cv.patch.stats().lamps.posts - posts0], [0, 0], 'nothing delivered while it is not heard');
  assert.equal(walk(cv.pmBodies.get(keyOf(m960)).el, n => attr(n, 'data-on') !== undefined && attr(n, 'data-lamp')).length, 0, 'the face dark');
  t.mute = false; cv.mix(); await settle();
  node(t).got.length = 0;
  sim.run(Math.round(0.3 * sr())); sim.raf(); await settle(2);
  const c = lampPosts(t, n960).map(x => stageOf(x[1]));
  assert.deepEqual([...new Set(c)], [1], 'heard again: fresh, stage 1 (' + c.join() + ')');
  assert.equal(stageOf(cv.patch.lampBits(t, d, m960)), 1);
  // ⏻ off: dark; on: back
  cv.power(d, false); await settle();
  assert.equal(cv.patch.lampBits(t, d, m960), 0, '⏻ off: dark');
  sim.run(Math.round(0.2 * sr())); sim.raf(); await settle(2);
  assert.equal(cv.patch.lampBits(T(), d, m960), 0);
  cv.undo(); await settle();
  sim.run(Math.round(0.2 * sr())); sim.raf(); await settle(2);
  assert.equal(stageOf(cv.patch.lampBits(T(), d, m960)), 1, '⏻ on (undo): lit again');
});

test('§1.1 / §6: Save / reload identical (schema 16 since stage WC, 15 at SC, 14 at M: the records, the knobs with their routing switches, the places); a bounce of Sequence takes it (its rows in the payload) and the clocked sequence sounds in it', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), m993 = midOf('993');
  cv.patch.knobSet(t, d, m993, 'e1', 1); await settle();
  const json = JSON.stringify(P()), p2 = cv.loadProject(json);
  assert.equal(p2.schema, 17); // ((MM) 17 since the master's modulators)
  for (const x of P().tracks) {
    const u = p2.tracks.find(y => y.id === x.id), k = CMOD.primId(x);
    if (!cv.isPatchDev(x, k)) continue;
    assert.equal(JSON.stringify(u.dev[k].patch), JSON.stringify(rec(x)), x.name + ': its record');
    assert.equal(JSON.stringify(u.dev[k].vals), JSON.stringify(PT.pruneVals(vals(x), rec(x))), x.name + ': its knobs');
    assert.equal(JSON.stringify(u.lay || {}), JSON.stringify(x.lay || {}), x.name + ': its places');
  }
  assert.equal(p2.tracks.find(y => y.id === t.id).dev[d].vals.p[m993].e1, 1, 'the routing switch kept');
  // the bounce: the set's track alone, no notes — the payload with its rows; the sequence clocked by the bounce's song
  const keep = P().tracks.map(x => [x, x.mute]);
  for (const x of P().tracks) if (x !== t) x.mute = true;
  t.notes = [];
  const it = cv.bounceSet(48000);
  assert.deepEqual(it.map(x => x.tr.id), [t.id], 'bounced without notes: MAIN OUT patched');
  assert.equal(it[0].seqs[d].pk, PT.payload(rec(t), 'moog', vals(t)).pk, 'the live graph, its rows');
  P().bars = 1;
  const before = sim.lastOffline;
  Object.assign(sim.$('#bRange'), { value: 'song' }); Object.assign(sim.$('#bSr'), { value: '48000' }); Object.assign(sim.$('#bBits'), { value: '32' });
  Object.assign(sim.$('#bTail'), { value: '0' }); Object.assign(sim.$('#bNorm'), { checked: false }); Object.assign(sim.$('#bOs'), { value: '2' });
  await sim.$('#bGo').onclick();
  for (let k = 0; k < 600 && sim.lastOffline === before; k++) await sim.settle(10);
  const B = sim.lastOffline, pk = x => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  assert.ok(B !== before, 'rendered');
  const h = Math.round(0.125 * 48000), seg = k => pk(B.L.subarray(k * h, (k + 1) * h));
  assert.ok([0, 1, 2, 3].every(k => seg(k) > 1e-3), 'the sequence sounds on every step (' + [0, 1, 2, 3].map(k => seg(k).toFixed(3)).join(' ') + ')');
  for (const [x, m] of keep) x.mute = m;
  cv.patch.knobSet(t, d, m993, 'e1', 0); await settle();
});

test('review 2 F1: a preset / a set loaded over a 900 Series puts each 960 it binds in the clock state its CLOCK AT START says — an OSC ON / OSC OFF event after the step\'s graph (the machine takes `os` only when it is built or reset); its undo and redo too; a preset with no 960 posts none; Step bass over a System 55 sounds on a held key with no transport, Sequence over it holds still', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), m960 = midOf('960'), n960 = +m960.slice(1);
  const seqs = () => node(t).posted.map(x => x.m).filter(m => m.t === 'seq').map(m => (m.s.pg ? 'pg' : m.s.pe ? 'pe ' + m.s.pe.join() : '?'));
  const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  const held = k => { api.noteOn(k, 100, 0); const o = sim.run(Math.round(0.25 * sr())).get(node(t)); api.noteOff(k, 0); return peak(o.L); };
  const stages = () => { node(t).got.length = 0; sim.run(Math.round(0.6 * sr())); sim.raf(); return [...new Set(lampPosts(t, n960).map(x => stageOf(x[1])))]; };
  const osc = () => { node(t).got.length = 0; sim.run(Math.round(0.2 * sr())); sim.raf(); const L = lampPosts(t, n960); return L.length ? (L.at(-1)[1] >> 9) & 1 : -1; }; // (the 960's OSC lamp, bit 9: the flip-flop)
  assert.equal(rec().name, 'Sequence');
  assert.equal(vals().p[m960].os, 0, 'Sequence: the clock stopped at start');
  // Step bass (os 1): the 960 is the oscillator — OSC ON after the graph, one step; a held key sounds with the song stopped
  node(t).posted.length = 0;
  const n0 = cv.hist.u.length;
  cv.patch.preset('Step bass'); await settle();
  assert.deepEqual([cv.hist.u.length - n0, vals().p[m960].os], [1, 1]);
  assert.deepEqual(seqs(), ['pg', 'pe ' + n960 + ',0'], 'the graph, then OSC ON (k 0)');
  assert.equal(osc(), 1, 'Step bass: the 960\'s clock running with no transport (its OSC lamp lit)');
  const loud = held(48);
  assert.equal(loud > 0.01, true, 'a held C3 sounds with no transport (peak ' + loud.toFixed(4) + ')');
  // Sequence over it (os 0): OSC OFF — the 960 holds, nothing free-runs before ▶
  node(t).posted.length = 0;
  cv.patch.preset('Sequence'); await settle();
  assert.deepEqual(seqs(), ['pg', 'pe ' + n960 + ',1'], 'OSC OFF (k 1) after the graph');
  assert.deepEqual([osc(), stages().length], [0, 1], 'stopped song: the clock off (the OSC lamp dark), the 960 holds one stage');
  // undo → Step bass's knobs back: OSC ON again; redo → OSC OFF
  node(t).posted.length = 0;
  cv.undo(); await settle();
  assert.deepEqual([rec().name, seqs()], ['Step bass', ['pg', 'pe ' + n960 + ',0']], 'undo: the clock as Step bass had it');
  assert.equal(osc(), 1, 'undo: running again');
  assert.equal(held(48) > 0.01, true, 'sounding again after the undo');
  node(t).posted.length = 0;
  cv.redo(); await settle();
  assert.deepEqual([rec().name, seqs(), osc()], ['Sequence', ['pg', 'pe ' + n960 + ',1'], 0], 'redo: stopped again');
  // a preset that binds no 960 posts none (the 960 stays as it is: unbound, unpatched)
  node(t).posted.length = 0;
  cv.patch.preset('Classic bass', { ensure: MG.SETS.m15.set }); await settle();
  assert.deepEqual(seqs().filter(x => x.startsWith('pe')), [], 'Classic bass: no 960 bound');
  cv.undo(); await settle();
  assert.equal(seqs().filter(x => x.startsWith('pe')).length, 0, 'its undo: none');
  // a set tile on a Model 15: the 960 it adds is started per Sequence's os, after the graph that holds it
  api.addTrack(MODEL('m900')); await settle();
  const t3 = T();
  assert.deepEqual([Object.keys(rec(t3)).length > 0, Object.keys(rec(t3).mods).length], [true, 12], 'a Model 15 900 Series');
  node(t3).posted.length = 0;
  cv.setPick('s55', 'replace'); await settle();
  const m3 = midOf('960', 1, rec(t3)), o3 = node(t3).posted.map(x => x.m).filter(m => m.t === 'seq').map(m => (m.s.pg ? 'pg' : m.s.pe ? 'pe ' + m.s.pe.join() : '?'));
  assert.deepEqual(o3, ['pg', 'pe ' + (+m3.slice(1)) + ',1'], 'System 55 over a Model 15: the new 960 stopped, after the graph that holds it');
  cv.undo(); await settle();
  api.deleteTrack(T()); await settle();
  api.selectTrack(ID.t1); await settle();
});

test('review 2 N1: a set tile dragged over the canvas keeps its own ghost with the finger (its art, "+ System 55") beside the rack outline pinned to the instrument — the outline can be mostly off screen, so the tile ghost is never hidden over the canvas', async () => {
  api.addTrack(MODEL('juno60')); await settle();
  const t = T(), tile = sh.shell.tiles.setTile('s55'), doc = sim.dom.document, ov = sim.$('#ov');
  sh.shell.tiles.setView('moog');
  doc.elementFromPoint = () => ({ closest: sel => (sel === '#viewport' ? {} : null) }); // (the point is over the canvas)
  const E = (type, x, y) => ({ type, pointerId: 5, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, timeStamp: 0, target: tile, preventDefault() {}, stopPropagation() {}, isPrimary: true });
  try {
    GHOSTS.length = 0;
    tile.dispatchEvent(E('pointerdown', 100, 300));
    tile.dispatchEvent(E('pointermove', 112, 302));
    tile.dispatchEvent(E('pointermove', 600, 330));
    const gh = ov.children.find(c => c.className.split(' ').includes('cv-tghost')), lab = gh && gh.children.find(c => c.className === 'cv-glabel');
    assert.equal(!!gh, true, 'the tile\'s ghost in #ov');
    assert.deepEqual([gh.classList.contains('off'), gh.classList.contains('drop'), lab.textContent], [false, true, '+ System 55'], 'shown over the canvas');
    assert.equal(GHOSTS.at(-1).label, '+ System 55 · replaces Juno-60', 'and the rack outline pinned to the instrument');
    tile.dispatchEvent(E('pointercancel', 600, 330));
    assert.equal(I(T(), dev()).model, 'juno60', 'cancelled: nothing replaced');
  } finally { delete doc.elementFromPoint; }
  api.deleteTrack(t); await settle();
  api.selectTrack(ID.t1); await settle();
});

test('review 2 F6: the heavy-scene line counts what is PAINTED — a GL face\'s hidden SVG is a texture and is not counted (the System 55 alone, 1 575 live elements in headless Chrome, and a few modules over it stay quiet), a face on the SVG path ("dom" — ?nogl\'s tier —, "svg") counts its SVG (the System 55 on it warns), a 48-module rack of GL faces warns; the line is 1.3 × the System 55\'s live layer', async () => {
  assert.equal(cv.ptHeavy().PT_HEAVY, 2048, '1.3 × 1 575 (the System 55\'s live layer, headless Chrome 155)');
  api.selectTrack(ID.t1); await settle();
  const WAIT = (cv.parts.HEAVY_MS || 600) + 300, HEAVY = 'This many modules may stutter when zooming on this device.';
  // the modules' elements as a real GL System 55 has them, per module: 43 live boxed elements (1 575 / 37) + the face's SVG 85 boxed (3 135 / 37)
  const LIVE = 43, SVG = 85;
  const box = (kids = [], o = {}) => ({ tagName: 'DIV', children: kids, parentNode: null, style: o.style || {}, getClientRects: () => [{}], getAttribute: k => (o.attrs && k in o.attrs ? o.attrs[k] : null), classList: { contains: c => !!o.cls && o.cls.includes(c) } });
  const leaves = n => Array.from({ length: n }, () => box());
  const own = (n, o) => { const x = box(leaves(n - 1), o); for (const c of x.children) c.parentNode = x; return x; };
  const stub = (mode, hidden) => { // root (1) + body (1) + .hw-decor (1) + LIVE - 3 leaves; the decor's svg: 1 + (SVG - 1) boxed
    const svg = own(SVG, { style: { visibility: hidden ? 'hidden' : '' } }), deco = box([svg], { cls: ['hw-decor'] }), body = box([deco, ...leaves(LIVE - 3)]), root = box([body], { attrs: { 'data-cv-face': mode } });
    svg.parentNode = deco; deco.parentNode = body; body.parentNode = root;
    return root;
  };
  const run = async (mode, hidden) => { // every module of the shown track's view stubbed; the notice, once, after the rest wait
    const V = cv.view(), keep = [...V.modules].map(([k, m]) => [m, m.el]);
    cv.touch(true); api.notice('', 0); cv.parts.heavyReset();
    cv.render(); await settle();
    for (const [m] of keep) m.el = stub(mode, hidden);
    const n = V.modules.size, live = cv.parts.painted(true), old = cv.parts.painted();
    await sim.settle(WAIT);
    const said = note() === HEAVY;
    for (const [m, el] of keep) m.el = el;
    cv.touch(null); api.notice('', 0);
    return { n, live, old, said };
  };
  // the System 55 (37 modules + the controller, FX and OUT): GL faces → the live layer 40 × 43 only
  let r = await run('gl', true);
  assert.deepEqual([r.n, r.live, r.old, r.said], [40, 40 * LIVE, 40 * (LIVE + SVG), false], 'GL: 1 720 painted (5 120 with the hidden SVGs): no notice');
  // the faces on the SVG path: the tier's bitmap under ?nogl ("dom": its SVG hidden below 100 %) and the pending base ("svg", visible)
  r = await run('dom', true);
  assert.deepEqual([r.live, r.said], [40 * (LIVE + SVG), true], '?nogl: the SVGs count — the notice');
  r = await run('svg', false);
  assert.deepEqual([r.live, r.said], [40 * (LIVE + SVG), true], 'SVG path: the notice');
  // a GL face whose SVG is visible (the overlap's tier holding it, cv-face F2) is painted: counted
  r = await run('gl', false);
  assert.deepEqual([r.live, r.said], [40 * (LIVE + SVG), true], 'a "gl" face with its SVG showing: counted');
  // a few modules over the System 55 (GL): quiet; a 48-module rack (11 more): the notice
  for (let i = 0; i < 2; i++) cv.patch.add('902');
  await settle();
  r = await run('gl', true);
  assert.deepEqual([r.n, r.live, r.said], [42, 42 * LIVE, false], '+ two modules: 1 806 — still quiet');
  for (let i = 0; i < 9; i++) cv.patch.add('902');
  await settle();
  r = await run('gl', true);
  assert.deepEqual([r.n, Object.keys(rec().mods).length, r.live, r.said], [51, 48, 51 * LIVE, true], 'a 48-module rack: 2 193 — the notice');
  for (let i = 0; i < 11; i++) cv.undo();
  await settle();
  assert.equal(Object.keys(rec().mods).length, 37);
  assert.equal(cv.ptHeavy().done, true, 'once a session');
});

test('§4.6 / §6: a Replace away takes the lamps\' monitor and their queue, its undo brings them back', async () => {
  api.selectTrack(ID.t1); await settle();
  const t = T(), d = dev(t), m960 = midOf('960'), k = t.id + '/' + d;
  sim.run(Math.round(0.1 * sr())); sim.raf(); await settle(2);
  assert.equal(cv.ptLamps().has(k) && cv.patch.lampBits(t, d, m960) > 0, true, 'monitored, lit');
  cv.setTrackModel(cv.view1e(d), 'juno60'); await settle();
  assert.deepEqual([I(T(), d).model, cv.ptLamps().has(k), cv.patch.lampBits(T(), d, m960)], ['juno60', false, 0], 'replaced: no monitor, the queue gone');
  cv.undo(); await settle();
  sim.run(Math.round(0.1 * sr())); sim.raf(); await settle(2);
  assert.deepEqual([I(T(), d).model, cv.ptLamps().has(k), cv.patch.lampBits(T(), d, m960) > 0], ['m900', true, true], 'undone: monitored and lit again');
});
