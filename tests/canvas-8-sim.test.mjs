import './v8-guard.mjs';
// Stage 7d + 8 lane H (docs/canvas/IMPL-8.md §4, §5.3, §6.2, §8, §10, §14.1, §15.10): the Pads module and the SDS-V in the page
// simulation with the real engine — main.js wires cv-pads' host (PADS: the held state, the counts per (track, note), the
// lights, the hardware echo) into its note path (noteOn's explicit targets, `pd<k>` keys the host alone ends), the value
// table (modVal per holding track), the drum host (DRUM.rec, the lit subscriptions, drumMonitor's live), recording (Q5:
// a pad's target records, armed or not; T.padRec in replace mode and the aftertouch lane), the canvas (cvDevices, the
// fixed size, the title, the ⋯ items, Tidy, add / delete in one step), the project (schema 11, normPads, the pruned rows)
// and Web MIDI (padIn / ports / the light-back bytes). First the lead's fixture check (§14.3 phase 2). Accessor-free: the
// app runs as a guard build (a track's v1 keys throw) — instruments read as devices (cv-model instOf), the panels through
// their device views and the __synthTest hooks. canvas-sim's scripted world; one boot; strings, numbers and booleans only
// into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-8-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as PC from '../pads-core.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as CVM from '../cv-module.js?v=9';
import { drumRowsOf } from '../roll.js?v=9';
import { MODELS } from '../models.js?v=9';
import { wavFile } from './smp-files.mjs';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
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
  };
  return W;
}

// (a Chromium audio clock with 200 ms of output latency — what is heard trails what is rendered)
const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std', outLat: 0.2, synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, acc = globalThis.__synthTest.acc;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), I = (t, dev) => CMOD.instOf(t, dev);
const byId = id => P().tracks.find(t => t.id === id);
const node = t => sim.nodeOf(t.id);
const sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const MODEL = id => MODELS.find(m => m.id === id);
const H = () => cv.pads; // (main's PADS)
const mod = id => (P().pads || []).find(M => M.id === id) || null;
// a pointer on a pad of a mounted body's grid: the fake DOM's grid rect is 100 px wide at (0, 0), so s = 100 / the grid's
// world width — the client point of slot i's centre (f: the height in the pad, 0.9 near the front: loud)
function ptr(id, type, i, pid, o = {}) {
  const B = cv.padsBody(id), M = mod(id), G = PC.gridOf(M.rows, M.cols, M.size), r = PC.padRect(G, i), s = 100 / G.w;
  const f = o.f == null ? 0.9 : o.f;
  B.grid.dispatchEvent(Object.assign({ type, target: B.grid, currentTarget: B.grid, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: pid, pointerType: 'touch',
    clientX: (r.x + r.w / 2) * s, clientY: (r.y + r.h * f) * s, timeStamp: performance.now(), pressure: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    preventDefault() {}, stopPropagation() {} }, o));
}
const view = (t, dev = CMOD.primId(t)) => acc.instView(t, dev); // (the device view a panel is built for: 'trackId/dev')
const DR = t => cv.drum.api(view(t));
const D = t => cv.drumOf(t, CMOD.primId(t));
const onsOf = (t, n0) => sent(t, 'on').slice(n0).map(m => m.n);
const pdKeys = () => [...api.held.keys()].filter(k => /^pd/.test(k));
const peak = A => { let p = 0; for (const x of A) p = Math.max(p, Math.abs(x)); return p; };
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const attr = (n, k) => (n && n.attrs ? n.attrs[k] : undefined);
// a mapping edit through the host (the inspector's / Grid…'s own path: one History step)
const edit = async (label, f) => { H().edit(label, ps => { f(ps.find(m => m.id === 'pd1')); return ps; }, { id: 'pd1' }); sim.raf(); await settle(); };
const pad = (t, c = 12) => ({ c, l: '', t, mod: null, v: null, latch: 0, hw: null });
const ID = {};

test('the lead\'s fixture check (§14.3 phase 2): a Pads module on track 2 plays an 808 on track 1 while track 2 is selected — the 808\'s node gets {t:\'on\'}, track 2\'s none; an SDS-V from the Drums view plays its five rows', async () => {
  // track 1: an 808 from the Drums view; a Pads module from the Controllers view follows it (its pad order, the kick bottom-left)
  sh.shell.tiles.setView('drums'); sh.srcPick('tr808', 'replace'); sim.raf(); await settle();
  const t1 = T();
  assert.equal(I(t1).model, 'tr808');
  sh.shell.tiles.setView('ctl');
  assert.deepEqual(sh.shell.tiles.ctlTiles().map(b => b.getAttribute('data-ctl')), ['pads'], 'the Controllers view lists Pads');
  sh.shell.tiles.ctlTile('pads').dispatchEvent({ type: 'click' }); sim.raf(); await settle();
  const M = mod('pd1');
  assert.equal(!!M, true, 'a tap placed pd1');
  assert.deepEqual([M.rows, M.cols, M.pads[0].t[0].k, M.pads[0].t[0].tr, M.pads[0].t[0].s], [4, 4, 'drum', t1.id, 'bd'], 'pad 1 the 808\'s kick');
  assert.equal(!!t1.lay.pd1, true, 'its place on the track it was added on');
  // track 2: a Juno, selected — the module shows there too (Tidy-placed), pad 1 pressed on its canvas
  const t2 = api.addTrack(MODEL('juno60')); sim.raf(); await settle();
  assert.equal(T().id, t2.id);
  assert.equal(cv.view().modules.has('pd1') && !!cv.padsBody('pd1'), true, 'the module on every track\'s canvas');
  assert.equal(!(t2.lay && t2.lay.pd1), true, 'Tidy-placed there (no lay entry until moved)');
  const n1 = sent(t1, 'on').length, n2 = sent(t2, 'on').length;
  ptr('pd1', 'pointerdown', 0, 11);
  const on1 = sent(t1, 'on').slice(n1);
  assert.deepEqual([on1.length, on1[0] && on1[0].n, sent(t2, 'on').length - n2], [1, 36, 0], 'the 808 plays the kick; the selected Juno nothing');
  ptr('pd1', 'pointerup', 0, 11);
  assert.deepEqual([sent(t1, 'off').filter(m => m.n === 36).length > 0, [...api.held.keys()].filter(k => /^pd/.test(k)).length], [true, 0], 'its note-off; nothing held');
  ID.t1 = t1.id; ID.t2 = t2.id;
  // an SDS-V from the Drums view (a third track): the roll's five named rows, each played by its note
  api.addTrack(MODEL('minimoog')); sim.raf(); await settle();
  sh.shell.tiles.setView('drums');
  assert.deepEqual(sh.shell.tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), ['tr808', 'tr606', 'tr909', 'sdsv']);
  sh.srcPick('sdsv', 'replace'); sim.raf(); await settle();
  const t3 = T(), rows = drumRowsOf(I(t3));
  assert.deepEqual(rows.map(r => r.n + ' ' + r.name), ['36 Bass drum', '38 Snare drum', '41 Tom 3 (low)', '45 Tom 2 (mid)', '48 Tom 1 (high)'], 'the roll\'s five named rows');
  const sr = sim.ctx().sampleRate;
  for (const r of rows) {
    sim.run(Math.round(0.4 * sr)); // (the last drum rings out)
    api.noteOn(r.n, 1, 0); await sim.settle(2);
    const out = sim.run(Math.round(0.1 * sr)).get(node(t3));
    api.noteOff(r.n, 0);
    let pk = 0;
    for (const x of out.L) pk = Math.max(pk, Math.abs(x));
    assert.equal(pk > 1e-3, true, `${r.name} sounds (peak ${pk.toExponential(2)})`);
  }
  ID.t3 = t3.id;
});

test('placement (§1.2–§1.4): the module on every track, its fixed size the footprint; a drop places a second one where released (one step "Add Pads 2", one undo takes it back); Grid… 4 × 4 → 8 × 4 → 4 × 4 keeps the mapping, one step each, the size following; the Controllers tile greys at the project\'s 8th — never before —, a 9th refused; ⋯ lists the body\'s items and Delete', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const V = () => cv.view(), size = id => { const r = V().modules.get(id).rect(); return [r.w, r.h]; };
  assert.deepEqual(size('pd1'), [352, 416], '4 × 4 M: 352 × 416 (pads-core footprint)');
  const items = cv.menu('pd1').map(x => x.label).filter(Boolean);
  for (const l of ['Edit pads', 'Grid…', 'Velocity…', 'Fill from…', 'Clear pads', 'Rename…', 'Fold', 'Delete']) assert.equal(items.includes(l), true, '⋯ ' + l);
  // a drop on the canvas of track 2: where released, at the footprint (a Juno's: chromatic from C3, 4 × 4)
  const n0 = cv.hist.u.length;
  cv.mod.drag.drop('pads', { over: 'canvas', at: { x: -1200, y: 900 } }); sim.raf(); await settle();
  const M2 = mod('pd2'), e = T().lay.pd2;
  assert.deepEqual([cv.hist.u.length - n0, cv.hist.undoLabel, M2.pads[0].t[0].k, M2.pads[0].t[0].n, M2.pads[PC.slotOf(3, 3)].t[0].n], [1, 'Add Pads 2', 'note', 48, 63], 'one step; pad 1 C3 … pad 16 on the Juno');
  assert.equal(Math.abs(e.x - (-1200 - 176)) <= 16 && Math.abs(e.y - (900 - 208)) <= 16, true, `centred where released (${e.x}, ${e.y})`);
  assert.equal(V().modules.has('pd2'), true);
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([mod('pd2'), !!(T().lay && T().lay.pd2), V().modules.has('pd2')], [null, false, false], 'one undo: the module and its place gone');
  // Grid…: rows / columns a setting, the module's fixed size following (§1.3); the 8 × 8 space keeps every pad
  const pads0 = JSON.stringify(mod('pd1').pads);
  let n1 = cv.hist.u.length;
  await edit('Pads 1: 8 × 4', M => { M.rows = 8; });
  assert.deepEqual([cv.hist.u.length - n1, size('pd1'), JSON.stringify(mod('pd1').pads) === pads0], [1, [352, 736], true], '8 × 4: one step, 352 × 736, the mapping kept');
  n1 = cv.hist.u.length;
  await edit('Pads 1: 4 × 4', M => { M.rows = 4; });
  assert.deepEqual([cv.hist.u.length - n1, size('pd1'), JSON.stringify(mod('pd1').pads) === pads0], [1, [352, 416], true], 'back to 4 × 4');
  // the limit (IMPL-P: 64 Pads modules; was 8): the tile greys only at the last; one more refused with the reason
  const tiles = sh.shell.tiles, hn = cv.hist.u.length;
  for (let k = 2; k <= PC.MAX_MODS; k++) {
    assert.equal(tiles.placed('pads'), null, `${k - 1} modules: the tile live`);
    cv.mod.add('pads', null); sim.raf(); await settle();
  }
  assert.deepEqual([P().pads.length, tiles.placed('pads')], [64, '64 Pads modules in this project'], 'greyed at the 64th');
  assert.equal(cv.mod.add('pads', null), null, 'a 65th refused');
  assert.match(sim.$('#notice').textContent, /64 Pads modules in this project/);
  while (cv.hist.u.length > hn) cv.undo();
  sim.raf(); await settle();
  assert.deepEqual([P().pads.map(M => M.id).join(), tiles.placed('pads')], ['pd1', null]);
});

test('a pad on the 808 (track 1) pressed while track 2 (a Juno) is selected: {t:\'on\', n: 36} on the 808 only; every press a hit — a second finger on the held pad a second {t:\'on\'}, one off at the last lift (D9, review #2); the pad lights from the 808\'s own synced pattern at the heard time, track 2 still selected (drumMonitor\'s live through PADS.wants)', async () => {
  const t1 = byId(ID.t1), t2 = T(), o1 = sent(t1, 'on').length, o2 = sent(t2, 'on').length, f1 = sent(t1, 'off').length;
  assert.equal(t2.id, ID.t2);
  ptr('pd1', 'pointerdown', 0, 21);
  ptr('pd1', 'pointerdown', 0, 22);
  assert.deepEqual([onsOf(t1, o1).join(), sent(t2, 'on').length - o2], ['36,36', 0], 'two fingers on the kick: two hits on the 808, none on the Juno');
  assert.equal(sent(t1, 'off').length - f1, 1, 'the re-strike: main\'s held retrigger ends the first before the second (one off per on)');
  ptr('pd1', 'pointerup', 0, 21);
  assert.equal(sent(t1, 'off').length - f1, 1, 'the first lift ends nothing');
  ptr('pd1', 'pointerup', 0, 22);
  assert.deepEqual([sent(t1, 'off').length - f1, pdKeys().length], [2, 0], 'the last lift ends it');
  // the lights: the module (shown on track 2) follows the 808's monitor — the machine's own synced pattern, at the heard time
  assert.equal(H().wants(t1.id), true, 'a shown Pads module wants the 808\'s lights');
  const mon = sent(t1, 'mon').at(-1);
  assert.equal(!!mon && Array.isArray(mon.ids) && mon.ids.length > 0, true, 'the 808\'s monitor on while track 2 is selected');
  DR(t1).demo(); await settle();
  P().metronome.countIn = 0; api.transport().pos = 0;
  const lit = () => [0, 1, 2, 3].reduce((a, i) => a + H().light('pd1', i).f, 0), L0 = lit(), k0 = H().light('pd1', 0).f;
  DR(t1).press({ k: 'start' }); await sim.settle(5);
  assert.equal(api.transport().playing, true);
  const sr = sim.ctx().sampleRate;
  sim.run(Math.round(0.1 * sr)); sim.raf(); await sim.settle(2); sim.raf();
  assert.equal(lit(), L0, 'rendered, not heard yet (200 ms of output latency): nothing lit');
  for (let i = 0; i < 12; i++) { sim.run(Math.round(0.1 * sr)); sim.raf(); }
  await sim.settle(2); sim.raf();
  assert.equal(H().light('pd1', 0).f > k0, true, 'heard: the kick pad flashed from the 808\'s pattern');
  assert.equal(T().id, ID.t2, 'track 2 still selected');
  DR(t1).press({ k: 'start' }); await sim.settle(5); // (stop)
  assert.equal(api.transport().playing, false);
});

test('a chord pad on the Juno: three {t:\'on\'} at a press, one {t:\'off\'} each at the release — the 808 nothing', async () => {
  const t1 = byId(ID.t1), t2 = T();
  await edit('Edit pad 2', M => { M.pads[1] = pad([{ k: 'chord', tr: t2.id, root: 60, q: 'maj', inv: 0, oct: 0, spread: 'close' }], 12); });
  const o1 = sent(t1, 'on').length, o2 = sent(t2, 'on').length, f2 = sent(t2, 'off').length;
  ptr('pd1', 'pointerdown', 1, 31);
  assert.deepEqual([onsOf(t2, o2).join(), sent(t1, 'on').length - o1], ['60,64,67', 0]);
  ptr('pd1', 'pointerup', 1, 31);
  assert.deepEqual(sent(t2, 'off').slice(f2).map(m => m.n).sort((a, b) => a - b).join(), '60,64,67');
});

test('recording (Q5, §4.3, §4.4): a pad\'s target records its hits whenever recording runs, armed or not — the unarmed 808 gets the kick and the cowbell while the Juno is the armed track; in replace mode the take also wipes what the playhead passes on the pad\'s target after its first hit (review #8); drum REC writes the 808\'s cowbell lane at the nearest step (PATTERN WRITE) beside the roll note', async () => {
  const t1 = byId(ID.t1), sr = sim.ctx().sampleRate, mode0 = P().rec.mode;
  await edit('Edit pad 4', M => { M.pads[3] = pad([{ k: 'drum', tr: t1.id, s: 'cb' }], 6); }); // (pad 4: the 808's cowbell — not in the demo's pattern)
  DR(t1).press({ k: 'mode', v: DC.M_W1 }); DR(t1).press({ k: 'rec', v: true }); await settle();
  assert.deepEqual([D(t1).ui.mode, D(t1).x.rec], [DC.M_W1, true]);
  P().rec.mode = 'replace';
  t1.notes.push({ id: 'old_a', t: 120, d: 60, n: 50, v: 100 }, { id: 'old_b', t: 3000, d: 60, n: 50, v: 100 }); // (one before the first hit, one the take passes after it)
  for (const t of P().tracks) t.arm = false;
  P().metronome.countIn = 0; api.transport().pos = 0;
  const st0 = JSON.stringify(D(t1).st);
  sim.$('#tRec').onclick(); await sim.settle(5);
  assert.deepEqual([api.transport().playing, api.transport().rec, byId(ID.t2).arm, byId(ID.t1).arm], [true, true, true, false], 'recording; the Juno (selected) armed, the 808 not');
  for (let i = 0; i < 6; i++) { sim.run(Math.round(0.1 * sr)); sim.raf(); }
  await sim.settle(2);
  ptr('pd1', 'pointerdown', 0, 41); ptr('pd1', 'pointerdown', 3, 42);
  sim.run(Math.round(0.1 * sr)); sim.raf();
  ptr('pd1', 'pointerup', 0, 41); ptr('pd1', 'pointerup', 3, 42);
  assert.equal([...api.transport().padRec].join(), t1.id, 'the 808 joins the take\'s pad-recorded tracks');
  for (let i = 0; i < 18; i++) { sim.run(Math.round(0.1 * sr)); sim.raf(); }
  await sim.settle(2);
  sim.$('#tPlay').onclick(); await sim.settle(3); // (stop)
  const t1b = byId(ID.t1), take = api.transport().take, cb = D(t1b).map.cb[0];
  const add = t1b.notes.filter(x => x.take === take).map(x => x.n).sort((a, b) => a - b);
  assert.deepEqual(add, [36, cb].sort((a, b) => a - b), 'the kick and the cowbell in the 808\'s roll');
  assert.deepEqual([t1b.notes.some(x => x.id === 'old_a'), t1b.notes.some(x => x.id === 'old_b')], [true, false], 'replace mode: the note passed after the first hit wiped, the one before kept');
  assert.equal(byId(ID.t2).notes.some(x => x.take === take), false, 'the armed Juno heard nothing of it');
  assert.notEqual(JSON.stringify(D(t1b).st), st0, 'REC wrote the cowbell\'s lane');
  P().rec.mode = mode0;
  DR(t1b).press({ k: 'rec', v: false }); DR(t1b).press({ k: 'mode', v: DC.M_MAN });
  cv.undo(); sim.raf(); await settle(); // (the take)
  for (const t of P().tracks) t.arm = false;
});

test('a mod pad (§5): pad 3 a gate source — its inline jack in the module\'s set; cabled to the Juno\'s cutoff (the row on the Juno\'s track, a value slot); {t:\'mval\', k} at the press (hi) and the release (lo), no {t:\'mods\'} repost per press; cabled on a second track as well, a press reaches both', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  await edit('Edit pad 3', M => { M.pads[2] = Object.assign({}, M.pads[2], { mod: { m: 'gate', lo: 0, hi: 1 } }); });
  const ent = cv.view().devices().find(d => d.key === 'pd1');
  assert.deepEqual(ent.jacks.map(j => j.id), ['p2', 'notes'], 'the mod pad\'s inline jack and the notes jack');
  const rid = cv.mod.connect('pd1.p2', 'i1:cf'); sim.raf(); await settle();
  const t2 = T();
  assert.equal(!!rid && t2.mods.some(r => r.src === 'pd1.p2' && r.dst === 'i1:cf'), true, 'the row on the Juno\'s track');
  const e2 = api.buildMods(t2).vals.find(v => v.id === 'pd1.p2');
  assert.equal(Number.isInteger(e2 && e2.k), true, 'a value slot');
  const mv = (t, k) => sent(t, 'mval').filter(m => m.k === k).map(m => m.v);
  const m0 = sent(t2, 'mods').length, v0 = mv(t2, e2.k).length;
  ptr('pd1', 'pointerdown', 2, 51);
  assert.deepEqual(mv(t2, e2.k).slice(v0), [1], 'the press: hi at once');
  ptr('pd1', 'pointerup', 2, 51);
  assert.deepEqual([mv(t2, e2.k).slice(v0).join(), sent(t2, 'mods').length - m0], ['1,0', 0], 'the release: lo; the payload never reposted');
  sim.raf(); await settle();
  assert.equal(sent(t2, 'mods').length - m0, 0, 'nor a frame later');
  // a second track holding a row of the same pad
  api.addTrack(MODEL('prophet5')); sim.raf(); await settle();
  cv.mod.connect('pd1.p2', 'i1:cf'); sim.raf(); await settle();
  const t4 = T(), k4 = api.buildMods(t4).vals.find(v => v.id === 'pd1.p2').k;
  ID.t4 = t4.id;
  const a2 = mv(byId(ID.t2), e2.k).length, a4 = mv(t4, k4).length;
  ptr('pd1', 'pointerdown', 2, 52);
  assert.deepEqual([mv(byId(ID.t2), e2.k).slice(a2).join(), mv(t4, k4).slice(a4).join()], ['1', '1'], 'both tracks get the value');
  ptr('pd1', 'pointerup', 2, 52);
});

test('the Pencil (§2.4): a pen on the chord pad (the Juno\'s) — its pressure as {t:\'at\'} to the Juno alone (the selected Prophet and the 808 nothing), ≤ once a frame, 0 at the lift', async () => {
  const t1 = byId(ID.t1), t2 = byId(ID.t2), t4 = T(), at = t => sent(t, 'at').map(m => Math.round(m.v * 1000) / 1000);
  const a1 = at(t1).length, a2 = at(t2).length, a4 = at(t4).length;
  ptr('pd1', 'pointerdown', 1, 61, { pointerType: 'pen', pressure: 0.8 });
  ptr('pd1', 'pointermove', 1, 61, { pointerType: 'pen', pressure: 0.9 });
  sim.raf(); sim.raf();
  ptr('pd1', 'pointermove', 1, 61, { pointerType: 'pen', pressure: 1 });
  sim.raf(); sim.raf();
  ptr('pd1', 'pointerup', 1, 61, { pointerType: 'pen', pressure: 0 });
  sim.raf(); sim.raf();
  assert.deepEqual(at(t2).slice(a2), [0.882, 1, 0], 'the frame\'s last value, then the next, then 0 at the lift');
  assert.deepEqual([at(t1).length - a1, at(t4).length - a4], [0, 0], 'nowhere else');
});

// a fake Web MIDI access: one input and one output named "Pad Box" (navigator.requestMIDIAccess, read lazily by midi.js)
function fakeMidi() {
  const inp = { name: 'Pad Box', state: 'connected', onmidimessage: null };
  const out = { name: 'Pad Box', state: 'connected', sent: [], send(b) { this.sent.push(Array.from(b)); } };
  const A = { inputs: new Map([['in1', inp]]), outputs: new Map([['out1', out]]), onstatechange: null };
  return { inp, out, A, msg: b => inp.onmidimessage({ data: Uint8Array.from(b), timeStamp: performance.now() }),
    unplug() { inp.state = 'disconnected'; A.inputs.delete('in1'); if (A.onstatechange) A.onstatechange({ port: inp }); } };
}

test('a hardware pad (§8; M\'s padIn / ports / send): learn pad 3 from a fake Web MIDI input (one step "Learn pad 3"); its note-on plays pad 3\'s targets and reaches no track by its channel, its note-off ends them; the generic light-back bytes on the output of its name; a hardware-held note survives a track switch, a canvas-held one ends; the input unplugged mid-hold ends its notes', async () => {
  const F = fakeMidi();
  globalThis.navigator.requestMIDIAccess = async () => F.A;
  await api.midi.enable(); await sim.settle(2);
  assert.deepEqual([api.midi.inputs().join(), api.midi.outputs().join()], ['Pad Box', 'Pad Box']);
  const i3 = PC.slotOfNo(mod('pd1'), 3), n0 = cv.hist.u.length;
  const learnt = H().learn('pd1', i3);
  F.msg([0x99, 100, 90]);
  const b = await learnt; await settle();
  assert.deepEqual([b && b.port, b && b.ch, b && b.n, cv.hist.u.length - n0, cv.hist.undoLabel, JSON.stringify(mod('pd1').pads[i3].hw)],
    ['Pad Box', 10, 100, 1, 'Learn pad 3', '{"port":"Pad Box","ch":10,"n":100,"cc":0}'], 'one step; the binding stored');
  await edit('Pads 1: hardware lights', M => { M.out = { prof: 'gen', port: '' }; });
  const t1 = byId(ID.t1), dn = PC.resolve(mod('pd1').pads[i3], P(), cv.drumOf).hits[0].ns[0];
  const any100 = () => P().tracks.some(t => node(t) && sent(t, 'on').some(m => m.n === 100));
  const o1 = sent(t1, 'on').length, f1 = sent(t1, 'off').length;
  F.msg([0x99, 100, 100]);
  assert.deepEqual([onsOf(t1, o1).join(), any100()], [String(dn), false], 'pad 3\'s drum on the 808; no track hears note 100 by channel 10');
  sim.raf();
  assert.deepEqual(F.out.sent.at(-1), [0x99, 100, 127], 'lit back: note-on velocity 127 on its channel and note');
  F.msg([0x89, 100, 0]);
  assert.equal(sent(t1, 'off').slice(f1).some(m => m.n === dn), true, 'its note-off ends it');
  sim.run(Math.round(0.2 * sim.ctx().sampleRate)); sim.raf(); sim.raf();
  assert.deepEqual(F.out.sent.at(-1), [0x99, 100, 0], 'the flash over: idle, velocity 0');
  // a track switch: the hardware note survives, the canvas one ends
  const g1 = sent(t1, 'off').length;
  F.msg([0x99, 100, 100]); ptr('pd1', 'pointerdown', 0, 71);
  api.selectTrack(ID.t3); sim.raf(); await settle();
  const offs = () => sent(byId(ID.t1), 'off').slice(g1).map(m => m.n);
  assert.deepEqual([offs().includes(36), offs().includes(dn)], [true, false], 'the canvas kick ended with the old view; the hardware pad still sounds');
  F.msg([0x89, 100, 0]);
  assert.equal(offs().includes(dn), true, 'its own note-off ends it');
  // unplugged mid-hold
  const g2 = sent(t1, 'off').length;
  F.msg([0x99, 100, 100]);
  F.unplug(); await sim.settle(2);
  assert.deepEqual([sent(t1, 'off').slice(g2).some(m => m.n === dn), H().holdKeys().filter(k => k.startsWith('h:')).length, pdKeys().length], [true, 0, 0], 'the port gone: its notes end');
  delete globalThis.navigator.requestMIDIAccess;
});

test('nothing left sounding (D9, review #7): Undo, the pad cleared / the module deleted / the target track deleted while held, a panic (no pd key left in held, the counts reset: the next hit sounds), a hidden page, power off; a tray key\'s light does not stick while a pad on another track holds its note — a pad on the selected track lights it', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const kick = () => sent(byId(ID.t1), 'off').filter(m => m.n === 36).length, offN = N => N.posted.map(x => x.m).filter(m => m.t === 'off').map(m => m.n);
  let k = kick();
  ptr('pd1', 'pointerdown', 0, 81);
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([kick() - k, pdKeys().length, H().held().length], [1, 0, 0], 'Undo');
  cv.redo(); sim.raf(); await settle();
  // the pad's mapping cleared while held
  k = kick(); ptr('pd1', 'pointerdown', 0, 82);
  await edit('Clear pad 1', M => { M.pads[0] = null; });
  assert.deepEqual([kick() - k, pdKeys().length], [1, 0], 'the pad cleared');
  ptr('pd1', 'pointerup', 0, 82);
  cv.undo(); sim.raf(); await settle();
  assert.equal(mod('pd1').pads[0].t[0].s, 'bd');
  // the module deleted while held: its notes, then its rows and places on every track — one undo brings all back
  k = kick(); ptr('pd1', 'pointerdown', 0, 83);
  const nd = cv.hist.u.length;
  cv.mod.del('pd1'); sim.raf(); await settle();
  assert.deepEqual([kick() - k, pdKeys().length, mod('pd1'), cv.hist.u.length - nd, cv.hist.undoLabel], [1, 0, null, 1, 'Delete Pads 1'], 'the module deleted: one step');
  assert.deepEqual([byId(ID.t2).mods.some(r => /^pd1\./.test(r.src)), byId(ID.t4).mods.some(r => /^pd1\./.test(r.src)), !!byId(ID.t1).lay.pd1], [false, false, false], 'its rows and places on every track');
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([!!mod('pd1'), byId(ID.t2).mods.some(r => r.src === 'pd1.p2'), byId(ID.t4).mods.some(r => r.src === 'pd1.p2'), !!byId(ID.t1).lay.pd1], [true, true, true, true], 'one undo: the module, its rows, its places');
  // the target track deleted while held (the chord on the Juno, another track selected)
  api.selectTrack(ID.t3); sim.raf(); await settle();
  const N2 = node(byId(ID.t2)), f2 = offN(N2).length;
  ptr('pd1', 'pointerdown', 1, 84);
  api.deleteTrack(byId(ID.t2)); sim.raf(); await settle();
  assert.deepEqual([offN(N2).slice(f2).sort((a, b) => a - b).join(), pdKeys().length, !!byId(ID.t2)], ['60,64,67', 0, false], 'its notes ended before it went');
  ptr('pd1', 'pointerup', 1, 84);
  cv.undo(); sim.raf(); await settle();
  assert.equal(!!byId(ID.t2), true);
  // a panic: the host's keys first, none left; the counts reset — the next hit of that note sounds
  k = kick();
  const o = sent(byId(ID.t1), 'on').length;
  ptr('pd1', 'pointerdown', 0, 85);
  cv.panic();
  assert.deepEqual([kick() - k, pdKeys().length, H().held().length], [1, 0, 0], 'a panic');
  ptr('pd1', 'pointerup', 0, 85);
  ptr('pd1', 'pointerdown', 0, 86);
  assert.equal(onsOf(byId(ID.t1), o).join(), '36,36', 'the next hit sounds');
  ptr('pd1', 'pointerup', 0, 86);
  // a hidden page
  k = kick(); ptr('pd1', 'pointerdown', 0, 87);
  globalThis.document.hidden = true; for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  globalThis.document.hidden = false; for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  assert.deepEqual([kick() - k, pdKeys().length], [1, 0], 'a hidden page');
  // power off with a pad held: nothing left in held or the host; back on, a hit sounds
  ptr('pd1', 'pointerdown', 0, 88);
  sim.$('#power').onclick(); await sim.settle(5);
  assert.deepEqual([api.ctx(), pdKeys().length, H().held().length, [...api.held.keys()].length], [null, 0, 0, 0], 'power off');
  await sim.power(); sim.raf(); await settle();
  const o2 = sent(byId(ID.t1), 'on').length;
  ptr('pd1', 'pointerdown', 0, 89); ptr('pd1', 'pointerup', 0, 89);
  assert.equal(onsOf(byId(ID.t1), o2).join(), '36', 'back on: a hit sounds');
  // the tray key's light (review #7): a pad's note on another track never keeps it lit; on the selected track it lights it
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const s5 = PC.slotOf(1, 0);
  await edit('Edit pad 5', M => { M.pads[s5] = pad([{ k: 'note', tr: ID.t3, n: 60 }], 11); });
  const keyEl = n => walk(sim.$('#keys'), x => x.dataset && +x.dataset.n === n)[0], down = n => keyEl(n).classList.contains('down');
  api.noteOn(60, 1, 0);
  ptr('pd1', 'pointerdown', s5, 90);
  assert.equal(down(60), true, 'the tray\'s key held: lit');
  api.noteOff(60, 0);
  assert.equal(down(60), false, 'the tray key let go: unlit, though the pad holds 60 on the SDS-V');
  ptr('pd1', 'pointerup', s5, 90);
  await edit('Edit pad 5', M => { M.pads[s5] = pad([{ k: 'note', tr: ID.t2, n: 62 }], 11); });
  ptr('pd1', 'pointerdown', s5, 91);
  assert.equal(down(62), true, 'a pad on the selected track lights the tray key');
  ptr('pd1', 'pointerup', s5, 91);
  assert.equal(down(62), false);
});

test('the project (§10, schema 11 → 12 at stage 9): a save reloads identical — project.pads, its places, its rows on every track; a row of a missing module and its place dropped at load (review #28); a schema-17 file opens read-only (WC: schema 16; SC: 15; M: 14; P: 13); a track without pad rows compiles byte-identically with or without the project\'s Pads modules (D5)', async () => {
  const json = JSON.stringify(P()), p2 = cv.loadProject(json);
  assert.deepEqual([p2.schema, CM.SCHEMA, JSON.stringify(p2.pads) === JSON.stringify(P().pads)], [16, 16, true], 'project.pads through the file');
  const padRows = t => JSON.stringify((t.mods || []).filter(r => /^pd/.test(r.src)));
  for (const t of P().tracks) {
    const u = p2.tracks.find(x => x.id === t.id);
    assert.deepEqual([padRows(u), JSON.stringify((u.lay || {}).pd1 || null)], [padRows(t), JSON.stringify((t.lay || {}).pd1 || null)], t.name);
  }
  const o = JSON.parse(json), tj = o.tracks.find(x => x.id === ID.t2);
  tj.mods.push(Object.assign({}, tj.mods.find(r => r.src === 'pd1.p2'), { id: 'mx1', src: 'pd5.p0' }));
  tj.lay = Object.assign({}, tj.lay, { pd5: { x: 0, y: 0 } });
  const u3 = cv.loadProject(JSON.stringify(o)).tracks.find(x => x.id === ID.t2);
  assert.deepEqual([u3.mods.some(r => r.src === 'pd5.p0'), !!u3.lay.pd5, u3.mods.some(r => r.src === 'pd1.p2')], [false, false, true], 'pruned: pd5 is not in the file');
  const n = JSON.parse(json);
  n.schema = 17;
  assert.equal(cv.loadProject(JSON.stringify(n), { file: true }).newerSchema, 17, 'a schema-17 file: read-only');
  const opts = { smooth: api.prefs().smooth, qr: null, ultra: 0 };
  for (const id of [ID.t1, ID.t3]) {
    const t = byId(id);
    assert.equal(JSON.stringify(api.compileMods(t, P(), Object.assign({ padVal: x => H().value(x) }, opts))), JSON.stringify(api.compileMods(t, Object.assign({}, P(), { pads: [] }), opts)), t.name + ': D5');
  }
});

test('the SDS-V in the page (§11–§13): its face with api.drum (five live hexagonal pads); a memory key is the patch\'s switch (no History step; an undo leaves it); TRIM… writes the record and posts a payload with the new trim (no step); the hexagonal pads play the five drums; MIDI 36 on channel 10 plays the bass drum; MAP… moves the snare; a sample in a slot; a Pads module added on its track follows it (1 × 5: bass drum, snare, toms 1 · 2 · 3) and plays it from another track', async () => {
  api.selectTrack(ID.t3); sim.raf(); await settle();
  const t3 = T(), root = cv.panel().root, sr = sim.ctx().sampleRate;
  assert.equal(!!cv.hw(), true, 'its Hardware panel');
  const hex = walk(root, x => /\bdr-hex\b/.test(x.className || ''));
  assert.deepEqual([hex.map(p => attr(p, 'data-sound')).join(), hex.filter(p => attr(p, 'aria-disabled') === 'true').length], ['bd,sd,ht,mt,lt', 0], 'five live hexagonal pads (the panel\'s order: bass, snare, tom 1 · 2 · 3)');
  // a memory key: the panel's switch write (no History step); the patch carries it; an undo keeps it (keepDevs: knob tweaks stay)
  const n0 = cv.hist.u.length;
  cv.panel().set('xbp', 2); sim.raf(); await settle();
  assert.deepEqual([cv.hist.u.length - n0, I(T()).vals.xbp, sent(T(), 'patch').at(-1).p.drum.xbp], [0, 2, 2], 'memory 3 on the bass drum');
  cv.undo(); sim.raf(); await settle();
  assert.equal(I(byId(ID.t3)).vals.xbp, 2, 'an undo leaves it');
  cv.redo(); sim.raf(); await settle();
  // TRIM…: a record write and a payload, no step
  const s0 = sent(T(), 'seq').length, n1 = cv.hist.u.length;
  DR(T()).press({ k: 'trim', ch: 1, mem: 3, f: 1, v: 0.9 }); await settle();
  const q = sent(T(), 'seq').slice(s0);
  assert.deepEqual([cv.hist.u.length - n1, D(T()).trim[1][0][1], q.length > 0 && q.at(-1).s.trim[1][0][1]], [0, 0.9, 0.9], 'the snare\'s memory 3 TONE trimmer');
  // the hexagonal pads by the keyboard (Enter: 100 / 127), then MIDI 36 on channel 10
  const kit = hex[0].parentNode, o = sent(T(), 'on').length;
  for (const p of hex) {
    kit.dispatchEvent({ type: 'keydown', key: 'Enter', target: p, repeat: false, timeStamp: performance.now(), preventDefault() {}, stopPropagation() {} });
    kit.dispatchEvent({ type: 'keyup', key: 'Enter', target: p, timeStamp: performance.now(), preventDefault() {}, stopPropagation() {} });
  }
  assert.equal(onsOf(T(), o).join(), '36,38,48,45,41', 'the five drums (the kit\'s order: bass, snare, tom 1 · 2 · 3)');
  const o2 = sent(T(), 'on').length;
  api.midi.message([0x99, 36, 100], performance.now(), '');
  api.midi.message([0x89, 36, 0], performance.now(), '');
  assert.equal(onsOf(T(), o2).join(), '36', 'MIDI 36 (channel 10) → the bass drum');
  // MAP…: the snare on 40 alone — note 40 sounds it, 38 nothing
  DR(T()).press({ k: 'map', sound: 'sd', notes: [40] }); await settle();
  assert.deepEqual(D(T()).map.sd, [40]);
  const play = async n => { sim.run(Math.round(1.5 * sr)); api.noteOn(n, 1, 0); await sim.settle(2); const A = sim.run(Math.round(0.1 * sr)).get(node(T())).L; api.noteOff(n, 0); return peak(A); };
  const pk38 = await play(38), pk40 = await play(40); // (38 first: a ringing snare's tail would read as a hit)
  assert.deepEqual([pk40 > 1e-3, pk38 < pk40 * 0.01], [true, true], `the snare on 40, nothing on 38 (${pk40.toExponential(2)} / ${pk38.toExponential(2)})`);
  DR(T()).press({ k: 'mapReset' }); await settle();
  // a sample in the snare's slot: its id in the payload and the track's needs
  const L = new Float32Array(4800);
  for (let i = 0; i < L.length; i++) L[i] = Math.sin(2 * Math.PI * 900 * i / sr) * Math.exp(-i / 960) * 0.9;
  const r = await cv.drumLoad(view(T()), 'sd', [{ name: 'snare.wav', data: wavFile({ ch: [L], rate: sr }) }]);
  assert.equal(!!(r && r.id), true, 'loaded');
  DR(T()).press({ k: 'smp', sound: 'sd', slot: { id: r.id, name: 'snare', on: true } }); await settle();
  assert.deepEqual([sent(T(), 'seq').at(-1).s.smp[1].id, cv.drumNeeds(T()).includes(r.id)], [r.id, true], 'the payload names it; the track needs it');
  DR(T()).press({ k: 'smp', sound: 'sd', slot: null }); await settle();
  // a Pads module added on the SDS-V's track: its five on the bottom row; played from the Juno's canvas
  cv.mod.add('pads', null); sim.raf(); await settle();
  const M2 = mod('pd2');
  assert.deepEqual([M2.rows, M2.cols, [0, 1, 2, 3, 4].map(i => M2.pads[i].t[0].s).join()], [1, 5, 'bd,sd,ht,mt,lt'], '1 × 5: bass drum, snare, tom 1 · 2 · 3 (the panel\'s order)');
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const o3 = sent(byId(ID.t3), 'on').length;
  ptr('pd2', 'pointerdown', 2, 95); ptr('pd2', 'pointerup', 2, 95);
  assert.equal(onsOf(byId(ID.t3), o3).join(), '48', 'tom 1 (the third pad) from the Juno\'s canvas');
  cv.undo(); sim.raf(); await settle(); // (the module)
  assert.equal(mod('pd2'), null);
});

const NAME = { tr808: 'TR-808', tr909: 'TR-909', sdsv: 'SDS-V' };
const sessM = S => (S && (S.m === 'tr909' || S.m === 'sdsv') ? S.m : S && Array.isArray(S.held) ? 'tr606' : 'tr808');
test('808 ↔ SDS-V ↔ 909 Replace (§15.10): Minimoog → 808 → SDS-V → 909 and ↶ ↶ ↷ ↷ twice — plain and as a graphed node\'s second instrument: each time the device, its record, the panel\'s session and the node\'s machine are that machine\'s, and a note reaches the machine; a bounce carries the SDS-V\'s trims (= the live payload)', async () => {
  for (const how of ['plain', 'graphed']) {
    api.addTrack(MODEL('minimoog')); sim.raf(); await settle();
    let id = null;
    const dev = () => (id == null ? CMOD.primId(T()) : id), v = () => view(T(), dev()), A = () => cv.drum.api(v());
    const nodeInst = () => { const pr = node(T()).proc; return id == null ? pr.i0 : pr.insts.find(x => x.id === id); };
    const hits = async () => { // (a note through the drum map reaches the machine: its hit() calls counted)
      const dm = nodeInst().dm, h0 = dm.hit;
      let n = 0;
      dm.hit = function () { n++; return h0.apply(this, arguments); };
      try { api.noteOn(36, 1, 0); await sim.settle(2); sim.run(256); api.noteOff(36, 0); } finally { dm.hit = h0; }
      return n;
    };
    const state = async () => [I(T(), dev()).model, cv.drumOf(T(), dev()).m || 'tr808', sessM(A().state().S), nodeInst().dm._mach, (await hits()) > 0];
    let prev = 'Minimoog';
    for (const m of ['tr808', 'sdsv', 'tr909']) {
      if (how === 'plain') { sh.shell.tiles.setView('drums'); sh.srcPick(m, 'replace'); } else if (id == null) id = cv.add(m, { x: 0, y: 1400 }); else cv.setTrackModel(v(), m);
      sim.raf(); await settle();
      if (how === 'plain') assert.equal(sim.$('#notice').textContent, `Replaced ${prev} with ${NAME[m]} · tap to undo`);
      prev = NAME[m];
      assert.deepEqual(await state(), [m, m, m, m, true], `${how}: the ${m} arrives and plays`);
    }
    for (const k of [1, 2]) {
      for (const [dir, want] of [['undo', 'sdsv'], ['undo', 'tr808'], ['redo', 'sdsv'], ['redo', 'tr909']]) {
        if (dir === 'undo') cv.undo(); else cv.redo();
        sim.raf(); await settle();
        assert.deepEqual(await state(), [want, want, want, want, true], `${how} ${dir} ${k} → ${want}`);
      }
    }
    api.deleteTrack(T()); sim.raf(); await settle();
  }
  // a bounce of the SDS-V track: its payload in processorOptions carries the record's trims (the snare's memory 3 TONE 0.9)
  api.selectTrack(ID.t3); sim.raf(); await settle();
  Object.assign(P().loop, { start: 0, end: 3840, on: true });
  T().notes.push({ id: 'bv1', t: 0, d: 240, n: 38, v: 100 }); // (a roll note in the range: the track is in the bounce)
  for (const [k, x] of [['#bRange', 'loop'], ['#bSr', '48000'], ['#bBits', '24'], ['#bTail', '0'], ['#bOs', '4']]) sim.$(k).value = x;
  sim.$('#bNorm').checked = false;
  sim.lastOffline = null;
  await sim.$('#bGo').onclick();
  for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
  const off = sim.lastOffline && sim.lastOffline.nodes.find(n => n.po && n.po.trackId === ID.t3), live = sent(T(), 'seq').at(-1).s;
  assert.equal(!!off && !!off.po.seq, true, 'the SDS-V\'s node in the bounce, with its payload');
  assert.deepEqual([off.po.seq.trim[1][0][1], JSON.stringify(off.po.seq.trim) === JSON.stringify(D(T()).trim), off.po.seq.pk === live.pk], [0.9, true, true], 'its trims: the record\'s, the live payload\'s');
  // a Replace under a Pads module's drum pads (track 1: 808 → 909, from track 2): the lights subscribed to the new machine,
  // the cowbell pad warns (no cowbell on a 909); its undo: the 808 again, lit, no warning
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const subbed = () => { const e = cv.padLit.get(ID.t1), m = sent(byId(ID.t1), 'mon').at(-1); return [!!e && typeof e.off === 'function', H().wants(ID.t1), !!m && m.ids.length > 0]; };
  assert.deepEqual(subbed(), [true, true, true], 'lit from the 808');
  cv.setTrackModel(view(byId(ID.t1)), 'tr909'); sim.raf(); await settle();
  assert.deepEqual([I(byId(ID.t1)).model, ...subbed(), /no Cowbell/i.test(H().warnOf('pd1', 3))], ['tr909', true, true, true, true], 'the 909: subscribed again; "no Cowbell" on pad 4');
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([I(byId(ID.t1)).model, ...subbed(), H().warnOf('pd1', 3)], ['tr808', true, true, true, ''], 'undone');
});

// ---- the stage-8 review's host findings (fixer B): R1-C, R1-D, R1-G, R2-F6, R2-F9 — each failing first
test('R1-C: on the ROLL tab a hidden Pads module wants no lights — the 808 on another track\'s monitor goes off (PADS.wants follows the visible modules), and is on again back on CANVAS', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const t1 = byId(ID.t1), mon = () => sent(t1, 'mon').at(-1);
  assert.deepEqual([H().wants(ID.t1), !!mon() && mon().ids.length > 0], [true, true], 'CANVAS: the shown module wants the 808\'s lights, its monitor on');
  cv.openTab('roll'); await settle();
  assert.deepEqual([H().wants(ID.t1), mon().ids.length], [false, 0], 'ROLL: nothing wanted, the monitor off');
  cv.openTab('canvas'); await settle();
  assert.deepEqual([H().wants(ID.t1), mon().ids.length > 0], [true, true], 'back on CANVAS: wanted again');
});

test('R1-D: power off with a keyboard note held ends it for the pads following the track — the pad is idle after, and a later tap of that note lights and clears it again', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const s = PC.slotOf(2, 0);
  await edit('Edit pad 9', M => { M.pads[s] = pad([{ k: 'note', tr: ID.t2, n: 64 }], 4); });
  const lit = () => H().light('pd1', s).l;
  assert.equal(lit(), 'idle', 'a following pad at rest');
  api.noteOn(64, 1, 0); sim.raf(); await settle();
  assert.equal(lit(), 'lit', 'the keyboard\'s E4 held: the pad lit');
  sim.$('#power').onclick(); await sim.settle(5); sim.raf(); await settle();
  assert.deepEqual([api.ctx(), [...api.held.keys()].length, lit()], [null, 0, 'idle'], 'power off: the key\'s off reached the pads');
  await sim.power(); sim.raf(); await settle();
  api.noteOn(64, 1, 0); sim.raf(); await settle();
  assert.equal(lit(), 'lit', 'back on, one more E4');
  api.noteOff(64, 0); sim.raf(); await settle();
  assert.equal(lit(), 'idle', 'its off clears the pad (the count did not stick)');
});

test('R1-G: a pad hold that survives a track switch (a latch) re-evaluates the tray key at the switch — lit once it holds a note of the selected track, unlit once it does not; the release clears it', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const s = PC.slotOf(2, 1);
  await edit('Edit pad 10', M => { M.pads[s] = Object.assign(pad([{ k: 'note', tr: ID.t2, n: 64 }], 4), { latch: 1 }); });
  const keyEl = n => walk(sim.$('#keys'), x => x.dataset && +x.dataset.n === n)[0], down = n => { const k = keyEl(n); return !!k && k.classList.contains('down'); };
  const tap = pid => { ptr('pd1', 'pointerdown', s, pid); ptr('pd1', 'pointerup', s, pid); };
  tap(201); // (latched: E4 held on the Juno)
  assert.deepEqual([pdKeys().length, down(64)], [1, true], 'latched on the Juno\'s canvas: its key lit');
  api.selectTrack(ID.t1); sim.raf(); await settle();
  assert.deepEqual([pdKeys().length, down(64)], [1, false], 'the 808 selected: the latch still holds E4 on the Juno — not this track\'s key');
  api.selectTrack(ID.t2); sim.raf(); await settle();
  assert.equal(down(64), true, 'back on the Juno: lit');
  tap(202); // (the next tap releases)
  assert.deepEqual([pdKeys().length, down(64)], [0, false], 'released');
  // the other way round: latched from the 808\'s canvas, then arrive on the Juno
  api.selectTrack(ID.t1); sim.raf(); await settle();
  tap(203);
  assert.deepEqual([pdKeys().length, down(64)], [1, false], 'latched from the 808\'s canvas: no key lit there');
  api.selectTrack(ID.t2); sim.raf(); await settle();
  assert.equal(down(64), true, 'arriving on the Juno: the hold reached it, its key lit');
  tap(204);
  assert.deepEqual([pdKeys().length, down(64)], [0, false], 'released');
});

test('R2-F6: the Sources tray\'s intro in the Controllers view is its own — a tap adds a Pads module (never replaces an instrument, never adds a track), in replace and in + Track mode; the instrument views keep theirs', async () => {
  api.selectTrack(ID.t2); sim.raf(); await settle();
  const TL = sh.shell.tiles, vb = sim.$('#srcView'), vm = sim.$('#srcViewMenu');
  const tap = t => t.dispatchEvent({ type: 'click', target: t, detail: 1, preventDefault() {}, stopPropagation() {} });
  const pick = v => { tap(vb); tap(vm.children.find(c => attr(c, 'data-view') === v)); };
  const intro = () => sim.$('#srcMode').children.map(c => c.textContent || '').join('');
  TL.setView('hw'); sh.cvOpenSources('replace');
  assert.match(intro(), /Juno/, 'the Hardware view: the instrument\'s intro (replace)');
  pick('ctl');
  assert.deepEqual([TL.view(), TL.mode()], ['ctl', 'replace']);
  assert.match(intro(), /^Tap Pads to add a pad grid/, 'Controllers (replace mode)');
  assert.doesNotMatch(intro(), /Juno|in place of|track list|new track/, 'nothing of an instrument\'s or a track\'s');
  sh.cvOpenSources('track');
  assert.equal(TL.mode(), 'track');
  assert.match(intro(), /^Tap Pads to add a pad grid/, 'Controllers (+ Track mode)');
  assert.doesNotMatch(intro(), /Juno|in place of|track list|new track/);
  pick('hw');
  assert.match(intro(), /a new track/, 'back on Hardware in + Track mode: the instrument views\' intro');
  sh.cvOpenSources('replace'); sh.shell.src.close();
});

test('R2-F9: Grid… growing a Pads module on one track keeps its place in the modulator column on the other tracks (a pin Tidy\'s column wrote) clear of their instrument; a place the user moved, and the track where it is resized (top-left fixed, §1.3), stay; one undo restores all, a redo takes them again', async () => {
  const col = w => -CVM.roundW(w + CVM.MOD_GAP), x4 = col(352), x8 = col(672); // (the Tidy column's x for the 4 × 4 M and the 8 × 8 M)
  const pinned = async () => { const t = api.addTrack(MODEL('juno60')); sim.raf(); await settle(); cv.setLayout('flow'); sim.raf(); await settle(); return t.id; }; // (a layout write pins the modules Tidy places)
  const ta = await pinned(), tb = await pinned();
  byId(tb).lay.pd1 = { x: -1200, y: 300 }; // (moved by the user on this one)
  const lay = id => JSON.stringify(byId(id).lay.pd1);
  assert.equal(byId(ta).lay.pd1.x, x4, 'pinned in the column at the 4 × 4\'s x');
  const was = { ta: lay(ta), tb: lay(tb), t1: lay(ID.t1) };
  api.selectTrack(ID.t1); sim.raf(); await settle();
  const n0 = cv.hist.u.length;
  await edit('Pads 1: 8 × 8', M => { M.rows = 8; M.cols = 8; });
  assert.deepEqual([cv.hist.u.length - n0, mod('pd1').rows], [1, 8], 'one step');
  assert.deepEqual([byId(ta).lay.pd1.x, byId(ta).lay.pd1.y, lay(tb) === was.tb, lay(ID.t1) === was.t1], [x8, JSON.parse(was.ta).y, true, true], 'the pinned place follows the column; the moved one and this track\'s stay');
  api.selectTrack(ta); sim.raf(); await settle();
  const rect = k => cv.view().modules.get(k).rect(), pd = rect('pd1'), ins = rect('i1');
  assert.deepEqual([pd.w, pd.x + pd.w + CVM.MOD_GAP <= ins.x + 16, pd.x + pd.w <= ins.x], [672, true, true], `the 8 × 8 ends left of the instrument (${pd.x}…${pd.x + pd.w}, i1 at ${ins.x})`);
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([mod('pd1').rows, lay(ta) === was.ta, lay(tb) === was.tb, lay(ID.t1) === was.t1], [4, true, true, true], 'one undo: the size and every place');
  cv.redo(); sim.raf(); await settle();
  assert.deepEqual([mod('pd1').rows, byId(ta).lay.pd1.x, lay(tb) === was.tb], [8, x8, true], 'redo');
  cv.undo(); sim.raf(); await settle();
  for (const id of [ta, tb]) { api.deleteTrack(byId(id)); sim.raf(); await settle(); }
});
