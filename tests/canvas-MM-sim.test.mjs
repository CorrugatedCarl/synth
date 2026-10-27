import './v8-guard.mjs';
// Stage MM lane H (docs/canvas/IMPL-MM.md §4, §7, §9 G5): modulators on the master canvas in the page simulation — the host side.
// An LFO tile tap / drop adds project.master.mdev.l1 (GLOBAL) in the modulator column left of the rack (a drop on the rack lands in
// the column), one step; the rack stays the detached default (no key, no chain) until a rack edit; a cable from l1.out onto a master
// Filter cutoff is project.master.mods[0], one step, and posts {t: 'mods', i: 'master', bpm} to MASTER (one fx row, chain 'mfx', the
// layout key) — never to a track; a macro knob posts {t: 'mval'} to MASTER; a master CC module learns and takes controllers whatever
// track is selected (omni; a channel set filters); a tap on MONO on the master's LFO / Chaos changes nothing; an effect removed prunes
// its cables (the notice), a module deleted drops its rows, an effect added under a cable reposts the mods with the chain (one go());
// the Mod list, the inspector, History (a track's undo leaves the master byte-identical; the rack kept across an older snapshot),
// keepMaster across Open / New; the bounce's o.master.mods and the offline MASTER's processorOptions.mods (none for an untouched
// master); mAlign; the 'mods' monitor id; the rack's live dots from mo; the row-id collision (MM4): the selected track and the master
// both hold l1 / m1 / c1 and rows r1…r3 — every master-canvas action leaves the track's JSON and its node's messages untouched;
// masterOff closes the inspector; the payload reaches MASTER's ModCore (lane E's engine, merged): fxv[mfx] and the rack's mdT move.
// Accessor-free like the other canvas sims; canvas-sim's scripted world; one boot; strings, numbers and booleans only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-MM-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as cvModule from '../cv-module.js?v=9';
import * as S from '../song.js?v=9';
import { MODELS } from '../models.js?v=9';

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

// the LFO / Macro / Chaos bodies are Serum's own panels (slot hosts): their modules first (canvas-2b-sim's rule)
await (await import('../cv-mods-ui.js?v=9')).ready();
const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std', synthTest: { cvWorld: root => scriptedWorld(root) } });
{ // (the panels' graph editors ask getClientRects: the stub DOM's elements answer one box)
  const ce = globalThis.document.createElement;
  globalThis.document.createElement = tag => { const e = ce(tag); e.getClientRects = () => [{}]; return e; };
  const cn = globalThis.document.createElementNS;
  globalThis.document.createElementNS = (ns, tag) => { const e = cn(ns, tag); e.getClientRects = () => [{}]; return e; };
}
const api = sim.api, cv = globalThis.__synthTest.cv, M = globalThis.__synthTest.master, MM = M.mod, U = globalThis.__synthTest.modUI, X = cv.mod;
// the FX racks' UI (in node the panel modules never finish loading): a stand-in recording what the host paints on it (canvas-3-sim's way)
class FXStub {
  constructor(box) { this.el = globalThis.document.createElement('div'); box.append(this.el); this.paints = []; this.lives = []; }
  refresh() {} destroy() {} paintMods(f) { this.paints.push(f); } setLive(f) { this.lives.push(f); }
}
globalThis.__synthTest.acc.uiLoad(Promise.resolve({ sx: await import('../serum-ui.js?v=9'), fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: await import('../sx-ui-mod.js?v=9') }));
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const MN = () => M.rec().node, mgot = t => MN().posted.map(x => x.m).filter(m => !t || m.t === t);
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const tracksJSON = () => P().tracks.map(t => JSON.stringify(t)).join('\n');
const masterJSON = () => JSON.stringify(P().master === undefined ? null : P().master);
const hsteps = () => cv.hist.u.length;
const note = () => sim.$('#notice').textContent;
const keys = () => [...V().modules.keys()].sort().join(',');
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const clsOf = c => String(c.className || (c.attrs && c.attrs.class) || '');
const ev = (type, o) => Object.assign({ type, preventDefault() {}, stopPropagation() {} }, o || {});
const badge = k => { const m = V().modules.get(k); return m ? (m.bar.children.find(c => /cv-badge/.test(c.className || '')) || {}).textContent || '' : null; };
const mono = key => walk(X.bodies.get(key).el, c => !!c.attrs && c.attrs['aria-label'] === 'MONO')[0];
const MOOG = MODELS.find(m => m.id === 'minimoog');
const R = MM.rec(), TID = {};
while (P().tracks.length < 2) api.addTrack(MOOG);
await settle(4);
api.selectTrack(P().tracks[0].id); await settle(4);
TID.a = P().tracks[0].id; TID.b = P().tracks[1].id;
const trkPosted = id => sim.nodeOf(id).posted.map(x => x.m);
const clearTrk = () => { for (const t of P().tracks) sim.nodeOf(t.id).posted.length = 0; };

test('the collision set-up (MM4): the selected track holds LFO 1, Macro 1 and CC 1 with rows r1…r3 on its Minimoog (as any track may)', async () => {
  const t = T();
  for (const k of ['lfo', 'macro', 'cc']) assert.equal(typeof X.add(k, null), 'string', k);
  await settle(2);
  X.opts.onMod('l1.out', 'i1:fc'); X.opts.onMod('m1.k1', 'i1:em'); X.opts.onMod('c1.out', 'i1:fa');
  await settle(2);
  assert.deepEqual([Object.keys(t.dev).filter(k => /^[lmc]\d$/.test(k)).sort().join(), (t.mods || []).map(r => r.id + ':' + r.src + '>' + r.dst).join()],
    ['c1,l1,m1', 'r1:l1.out>i1:fc,r2:m1.k1>i1:em,r3:c1.out>i1:fa']);
  assert.equal(api.buildMods(t).off, undefined, 'the track has a payload');
});

test('G5 (MM1) an untouched master: no {t: mods} reached MASTER, the bounce\'s offline MASTER has no mods key (its options as before)', async () => {
  assert.equal(mgot('mods').length + mgot('mval').length, 0, 'nothing for MASTER\'s ModCore');
  P().tracks[0].notes = [{ id: 'mm0', t: 0, d: 480, n: 57, v: 100 }];
  const st = await bounce(), mn = st.nodes.find(n => n.name === 'synth-master');
  assert.deepEqual([!!mn, mn && 'mods' in mn.po, mn && Object.keys(mn.po).sort().join()], [true, false, 'frames,offline,transport']);
});

test('G5 the master canvas takes LFO / Macro / CC / Chaos only: ENV, Velocity, Note, the wheel and Pads are refused with the reworded MASTER_SRC; the Sources tray says it', async () => {
  const before = tracksJSON(), n0 = hsteps();
  M.open(); await settle(3);
  assert.deepEqual([M.on(), MM.own() === R, MM.shown()], [true, true, 'master']);
  assert.equal(MM.src, 'The master takes effects (the rack’s +) and modulators (Sources ▸ Modulators)');
  const tiles = globalThis.__synthTest.shell.shell.tiles;
  assert.deepEqual([tiles.master(), sim.$('#srcTray').classList.contains('cv-mside')], [true, true], 'the tray in its master state (lane U\'s setMaster)');
  for (const k of ['env', 'velo', 'note', 'wheel', 'pads', 'at', 'bend']) {
    assert.equal(X.add(k, null), null, k + ': refused');
    assert.equal(note(), MM.src);
  }
  assert.deepEqual(S.MASTER_MOD_KINDS.slice(), ['lfo', 'macro', 'cc', 'chaos']);
  assert.deepEqual([hsteps(), tracksJSON() === before, 'master' in P() ? JSON.stringify(P().master.mdev || null) : 'none'], [n0, true, 'none'], 'nothing written');
});

test('G5 an LFO tile tap adds project.master.mdev.l1 (GLOBAL) in the column left of the rack, one step "Add LFO 1"; the rack stays the detached default (no key, no chain post), no {t: mods} (N1); undo removes it', async () => {
  const before = tracksJSON(), n0 = hsteps();
  MN().posted.length = 0; clearTrk();
  const key = X.add('lfo', null);
  await settle(2);
  const L = P().master.mdev.l1, lay = P().master.lay;
  assert.deepEqual([key, L.kind, L.lfo.mono, 'fx' in P().master, hsteps(), cv.hist.undoLabel, note()], ['l1', 'lfo', 1, false, n0 + 1, 'Add LFO 1', 'Added LFO 1 · tap to undo']);
  assert.ok(lay.l1.x + cvModule.modW('lfo') <= lay.mfx.x, 'the column left of the rack: ' + lay.l1.x + ' / ' + lay.mfx.x);
  assert.deepEqual([keys(), V().modules.get('l1').kind, !!X.bodies.get('l1'), mgot('chain').length, mgot('mods').length], ['l1,mfx,out', 'mod', true, 0, 0], 'no chain, no payload (no rows)');
  assert.deepEqual([V().modules.get('l1').title, badge('l1')], ['LFO 1', 'GLOBAL'], 'its title and the GLOBAL badge');
  assert.deepEqual([MM.pay().off, tracksJSON() === before, trkPosted(TID.a).filter(m => m.t !== 'mon').length], [true, true, 0]);
  cv.undo(); await settle(2);
  assert.deepEqual([keys(), 'l1' in R.dev, mgot('mods').length, tracksJSON() === before], ['mfx,out', false, 0, true]);
  cv.redo(); await settle(2);
  assert.equal(keys(), 'l1,mfx,out');
});

test('G5 a drop on the rack lands in the column (left of the rack, never on it); the module\'s ⋯ is cvMenu\'s mod branch; Delete takes it', async () => {
  const r = V().rects().mfx, n0 = hsteps();
  assert.equal(X.drag.drop('lfo', { over: 'canvas', x: 400, y: 300, at: { x: r.x + r.w / 2, y: r.y + 60 } }), true);
  await settle(2);
  const lay = P().master.lay.l2;
  assert.ok(lay && lay.x + cvModule.modW('lfo') <= r.x, 'left of the rack: ' + JSON.stringify(lay) + ' / ' + r.x);
  assert.deepEqual([hsteps(), cv.hist.undoLabel], [n0 + 1, 'Add LFO 2']);
  assert.deepEqual(cv.menu('l2').map(x => x.label || '—'), ['Delete', 'Modulation list…', '—', 'Fold', 'Bring to front', '—', 'Tidy the canvas']);
  cv.menu('l2')[0].action(); await settle(2);
  assert.deepEqual([keys(), cv.hist.undoLabel], ['l1,mfx,out', 'Delete LFO 2']);
  assert.deepEqual(cv.menu('mfx').map(x => x.label || '—'), ['Fold', 'Bring to front', '—', 'Tidy the canvas'], 'the rack\'s as before');
});

test('G5 a cable from l1.out onto a master Filter cutoff: project.master.mods[0], one step; {t: mods, i: master, bpm} to MASTER with one fx row (chain mfx, the layout key) — never to a track; the badge "mods 1"; the rack root data-dev="mfx"; the halo rows', async () => {
  const before = tracksJSON();
  const fil = cv.fx.addEffect('mfx', 'fil'); await settle(2);
  assert.equal(fil, 'fil');
  assert.equal(mgot('chain').length > 0, true, 'the rack edit posts the chain');
  MN().posted.length = 0; clearTrk();
  const n0 = hsteps(), dst = 'mfx:fx.fil.cutoff';
  assert.deepEqual([X.opts.canMod('l1.out', dst).ok, X.marks()('mfx', 'fx.fil.cutoff'), X.label(dst), X.label('l1.out')], [true, true, 'Filter Cutoff', 'LFO 1']);
  X.opts.onMod('l1.out', dst); await settle(2);
  const row = P().master.mods[0];
  assert.deepEqual([P().master.mods.length, row.id, row.src, row.dst, hsteps(), cv.hist.undoLabel], [1, 'r1', 'l1.out', dst, n0 + 1, 'Modulate Filter Cutoff with LFO 1']);
  const m = mgot('mods');
  assert.equal(m.length, 1, 'one payload');
  const p = m[0], r = p.rows[0];
  assert.deepEqual([p.t, p.i, p.bpm, p.off, p.rows.length, r.dst.kind, r.dst.chain, typeof r.dst.key, r.dst.fx >= 8, p.key.endsWith('@' + P().bpm)], ['mods', 'master', P().bpm, undefined, 1, 'fx', 'mfx', 'string', true, true]);
  assert.equal(JSON.stringify(MM.pay().rows) === JSON.stringify(p.rows), true, 'the payload posted is the master\'s');
  assert.deepEqual([P().tracks.map(t => trkPosted(t.id).filter(x => x.t === 'mods' || x.t === 'mval').length).join(), tracksJSON() === before], ['0,0', true], 'no track got it; every track byte-identical');
  assert.deepEqual([badge('mfx'), badge('l1')], ['mods 1', 'GLOBAL']);
  const ui = M.ui.ui;
  assert.equal(!!ui && !!ui.el && ui.el.getAttribute('data-dev'), 'mfx', 'the rack root: data-dev="mfx" (the cables\' knob ends, the mod layer)');
  assert.deepEqual(U.fxRows(R, 'mfx')('fx.fil.cutoff').map(x => x.id + ':' + x.src + ':' + x.label + ':' + x.pol).join(), 'r1:l1.out:LFO 1:uni', 'the halo rows of the master rack');
  const f = ui.paints[ui.paints.length - 1];
  assert.deepEqual([typeof f, typeof f === 'function' ? f('fx.fil.cutoff').length : -1, typeof f === 'function' ? f('fx.fil.res').length : -1], ['function', 1, 0], 'modHalos painted the master rack with the row');
  assert.deepEqual(V().cables.list().filter(c => c.kind === 'mod').map(c => c.id + ':' + c.a + '>' + c.b).join(), 'r1:l1.out>mfx:fx.fil.cutoff', 'the cable on the view');
  // the tempo is in the payload and its key: a tempo change reposts it with the chain's go()
  MN().posted.length = 0;
  const bpm0 = P().bpm;
  cv.setProjectBpm(bpm0 + 10); await settle(2);
  const m2 = mgot('mods');
  assert.deepEqual([m2.length, m2.length ? m2[0].bpm : 0], [1, bpm0 + 10], 'the new tempo reposted');
  cv.setProjectBpm(bpm0); await settle(2);
});

test('G5 [integration-time, lane E] the payload reaches MASTER\'s ModCore: mc made, fxv[mfx] after a span, the rack\'s mdT moves', async () => {
  sim.run(4096); await settle(1);
  const proc = MN().proc;
  assert.ok(proc && proc.mc, 'MASTER holds a ModCore');
  const v = proc.mc.fxv && proc.mc.fxv.mfx;
  assert.ok(v && v.some(x => x !== 0), 'fxv[mfx] non-zero after a span');
  assert.ok(proc.c.rack.U.some(u => u.mdT.some(x => x !== 0)), 'the rack\'s mdT moved');
  assert.equal(proc.c.mcOn, 1, 'the vector reached the rack');
});

test('G5 a macro knob\'s move posts {t: mval} to MASTER and no chain; its table index; the gesture\'s end one step', async () => {
  const rev = cv.fx.addEffect('mfx', 'rev'); await settle(2);
  assert.equal(rev, 'rev');
  assert.equal(X.add('macro', null), 'm1'); await settle(2);
  X.opts.onMod('m1.k1', 'mfx:fx.rev.mix'); await settle(2);
  assert.deepEqual(P().master.mods.map(r => r.id + ':' + r.src + '>' + r.dst).join(), 'r1:l1.out>mfx:fx.fil.cutoff,r2:m1.k1>mfx:fx.rev.mix');
  const pay = MM.pay();
  assert.deepEqual(pay.vals.map(v => v.id + ':' + v.k).join(), 'm1.k1:0');
  MN().posted.length = 0; clearTrk();
  const n1 = hsteps(), K = X.bodies.get('m1').knobs()[0];
  K.dispatchEvent(ev('keydown', { key: 'ArrowUp', target: K })); await settle(1);
  const mv = mgot('mval');
  assert.deepEqual([mv.length, mv[0].k, mv[0].v > 0, mgot('chain').length, hsteps(), cv.hist.undoLabel], [1, 0, true, 0, n1 + 1, 'Edit Macro 1'], 'mval to MASTER, no chain, one step');
  assert.ok(Math.abs(P().master.mdev.m1.v[0] - mv[0].v) < 1e-9, 'the master\'s state holds it');
  assert.equal(P().tracks.map(t => trkPosted(t.id).length).join(), '0,0', 'no track message');
});

test('G5 a master CC module learns (one step "Learn CC") and takes its controller whatever track is selected (omni); a channel set filters; the meter while the master canvas shows', async () => {
  assert.equal(X.add('cc', null), 'c1'); await settle(2);
  X.opts.onMod('c1.out', 'mfx:fx.fil.res'); await settle(2);
  const n0 = hsteps();
  U.learn('c1', true);
  assert.equal(X.bodies.get('c1').armed(), true);
  api.modCC(5, 21, 0.25); await settle(1);
  assert.deepEqual([P().master.mdev.c1.cc, X.bodies.get('c1').armed(), hsteps(), cv.hist.undoLabel], [21, false, n0 + 1, 'Learn CC']);
  const tc = T().dev.c1.cc;
  assert.notEqual(tc, 21, 'the track\'s c1 untouched');
  const k = MM.pay().vals.find(v => v.id === 'c1.out').k;
  MN().posted.length = 0; clearTrk();
  assert.equal(api.modCC(3, 21, 0.5) >= 1, true);
  assert.deepEqual([mgot('mval').map(m => m.k + ':' + m.v).join(), X.bodies.get('c1').value()], [k + ':0.5', 0.5], 'omni: any channel → MASTER, the meter');
  // another track selected (the master canvas left): still MASTER's
  api.selectTrack(TID.b); await settle(3);
  assert.deepEqual([M.on(), globalThis.__synthTest.shell.shell.tiles.master()], [false, false], 'the tray back to the chosen view (setMaster(false))');
  MN().posted.length = 0;
  api.modCC(9, 21, 0.75);
  assert.deepEqual(mgot('mval').map(m => m.k + ':' + m.v).join(), k + ':0.75', 'whatever track is selected');
  // a channel set filters
  M.open(); await settle(3);
  assert.equal(U.editState('c1', { ch: 2 }), true); await settle(1);
  assert.equal(P().master.mdev.c1.ch, 2);
  MN().posted.length = 0;
  api.modCC(3, 21, 0.1);
  assert.equal(mgot('mval').length, 0, 'channel 3: not this module\'s');
  api.modCC(2, 21, 0.3);
  assert.deepEqual(mgot('mval').map(m => m.k + ':' + m.v).join(), k + ':0.3');
  assert.equal(P().tracks.find(t => t.id === TID.a).dev.c1.cc, tc, 'the track\'s CC module untouched');
});

test('G5 a tap on MONO on the master\'s LFO and Chaos changes nothing: mono stays 1, no step, the switch lit again', async () => {
  assert.equal(X.add('chaos', null), 'h1'); await settle(2);
  for (const [key, f] of [['l1', () => P().master.mdev.l1.lfo.mono], ['h1', () => P().master.mdev.h1.chaos.mono]]) {
    const n0 = hsteps(), b = mono(key);
    assert.ok(b, key + ': its MONO switch');
    b.dispatchEvent(ev('click', { bubbles: true })); await settle(1);
    assert.deepEqual([f(), hsteps(), mono(key).getAttribute('aria-pressed')], [1, n0, 'true'], key);
  }
  // the hooks too: an edit asking PER NOTE is GLOBAL on the master
  const n1 = hsteps();
  assert.equal(U.editState('l1', { lfo: { mono: 0 } }), true);
  assert.deepEqual([P().master.mdev.l1.lfo.mono, hsteps()], [1, n1], 'no step');
});

test('G5 the Mod list lists the rows under "Master FX"; the inspector edits amount and bypass (one step each); the cable menu', async () => {
  X.list();
  const secs = walk(sim.$('#ov'), c => /\bcv-ml-dev\b/.test(clsOf(c))).map(c => c.attrs['data-dev']);
  assert.deepEqual(secs, ['mfx'], 'one device: the master rack');
  assert.deepEqual([walk(sim.$('#ov'), c => c.textContent === 'Master FX').length > 0, walk(sim.$('#ov'), c => c.textContent === 'Modulation · Master').length > 0], [true, true], 'its label "Master FX", the list\'s title "Modulation · Master"');
  X.layer().close();
  const H = X.host(), n0 = hsteps();
  assert.deepEqual(H.descs('mfx').filter(d => d.id === 'fx.fil.cutoff').map(d => d.label + ':' + d.group).join(), 'Cutoff:Filter', 'the parameter list: the master rack\'s knobs');
  assert.equal(H.budget('mfx').kind, 'panel');
  assert.deepEqual(H.rowsOf('mfx').map(r => r.id).join(), 'r1,r2,r3');
  const r = H.edit('r1', { amt: 0.4 }); H.step('Mod amount'); await settle(1);
  assert.deepEqual([r && r.amt, P().master.mods[0].amt, hsteps(), cv.hist.undoLabel], [0.4, 0.4, n0 + 1, 'Mod amount']);
  assert.deepEqual(X.cmenu('r1').map(x => x.label).join(), 'Edit…,Bypass');
  U.bypass('r1'); await settle(1);
  assert.deepEqual([P().master.mods[0].byp, hsteps(), cv.hist.undoLabel], [1, n0 + 2, 'Mod bypass']);
  cv.undo(); await settle(1);
  assert.equal(P().master.mods[0].byp, 0);
});

test('G5 deleting the effect prunes its rows (the notice); deleting a module drops its rows; an effect added under a running cable reposts the mods with the chain in one go()', async () => {
  const n = P().master.mods.length;
  // an effect added: the layout key moves — the chain then the payload, synchronously (one go())
  MN().posted.length = 0;
  const d = cv.fx.addEffect('mfx', 'dly');
  assert.equal(d, 'dly');
  const seq = MN().posted.map(x => x.m.t).filter(t => t === 'chain' || t === 'mods');
  assert.deepEqual(seq, ['chain', 'mods'], 'the chain, then the payload, before any frame');
  await settle(1);
  // the Filter removed (a rack edit): r1 (cutoff) and r3 (res) go with it
  M.edit(fx => { const L = fx.racks[0].mods, i = L.findIndex(I => I.id === 'fil'); L.splice(i, 1); }); await settle(2);
  assert.deepEqual([P().master.mods.map(r => r.id).join(), /2 modulation cables removed with the effect/.test(note())], ['r2', true], note());
  assert.equal(n, 3);
  // a module deleted: its rows go
  MN().posted.length = 0;
  X.del('m1'); await settle(2);
  assert.deepEqual([P().master.mods.length, 'm1' in R.dev, cv.hist.undoLabel], [0, false, 'Delete Macro 1']);
  assert.deepEqual(mgot('mods').map(m => !!m.off).join(), 'true', '{t: mods, off: true} once');
  MN().posted.length = 0;
  api.queuePatch(R); await settle(1);
  assert.equal(mgot('mods').length, 0, 'off is not repeated');
  cv.undo(); await settle(2);
  assert.deepEqual([P().master.mods.map(r => r.id).join(), mgot('mods').filter(m => !m.off).length], ['r2', 1], 'undo: the macro and its row, the payload again');
});

test('G5 History: an undo of a track edit leaves project.master byte-identical; a master knob turn is no step; an undo whose snapshot predates the rack\'s first edit keeps the rack and removes the cable', async () => {
  // a track edit (on the track canvas), undone
  api.selectTrack(TID.a); await settle(3);
  const m0 = masterJSON(), n0 = hsteps();
  X.add('env', null); await settle(2);
  assert.equal(hsteps(), n0 + 1);
  cv.undo(); await settle(2);
  assert.equal(masterJSON(), m0, 'the master byte-identical');
  // a master knob turn: no step
  M.open(); await settle(3);
  const n1 = hsteps();
  M.edit(fx => { const I = fx.racks[0].mods.find(x => x.id === 'rev'); I.p.mix = 0.33; }); await settle(1);
  assert.equal(hsteps(), n1, 'no step');
  // undo back past the first master edit: the rack (kept, the knob policy) stays, the cables / modules of that time come back (none)
  let guard = 0;
  while (P().master && (P().master.mods || P().master.mdev) && hsteps() && guard++ < 60) { cv.undo(); await settle(1); }
  assert.deepEqual([!!P().master && !!P().master.fx, (P().master.mods || []).length, Object.keys(P().master.mdev || {}).length], [true, 0, 0], 'the rack kept, no cable');
  assert.equal(P().master.fx.racks[0].mods.some(I => I.id === 'rev' && I.p.mix === 0.33), true, 'the rack as it is now (knobs kept)');
  // back to the end
  guard = 0;
  while (cv.hist.r.length && guard++ < 60) { cv.redo(); await settle(1); }
  assert.deepEqual([P().master.mods.map(r => r.id).join(), Object.keys(P().master.mdev).sort().join()], ['r2', 'c1,h1,l1,m1']);
});

test('G5 keepMaster across Open / New: New drops the master (MASTER told {t: mods, off: true} once); its undo brings the modulators and their cables back and reposts; an Open of a file with master cables posts the chain then the payload', async () => {
  const m0 = masterJSON(), live = MM.pay().key;
  assert.equal(MM.pay().off, undefined);
  const file = JSON.parse(await cv.projectFile()); delete file.uid; file.name = 'MM file';
  MN().posted.length = 0;
  sim.$('#fNew').onclick(); await settle(3);
  assert.deepEqual(['master' in P() ? masterJSON() : 'none', mgot('mods').map(m => !!m.off).join()], ['none', 'true'], 'New: off once');
  // an Open (from the empty project) of a file holding master modulators and cables: the chain, then the payload
  MN().posted.length = 0;
  await openFile(file);
  assert.equal(P().name, 'MM file');
  const seq = mgot().filter(m => m.t === 'chain' || m.t === 'mods').map(m => m.t + (m.off ? ':off' : ''));
  assert.deepEqual([seq.join(), JSON.stringify(P().master.mods) === JSON.stringify(JSON.parse(m0).mods), mgot('mods')[0].key], ['chain,mods', true, live], 'the chain, then the payload');
  cv.undo(); await settle(3); // (the undo of Open: the empty project — off again)
  assert.equal('master' in P(), false);
  MN().posted.length = 0;
  cv.undo(); await settle(3); // (the undo of New: the first project)
  assert.deepEqual([masterJSON() === m0, mgot('mods').filter(m => !m.off).map(m => m.key).join()], [true, live], 'the undo of New: the master whole, the payload again');
});

test('G5 a power cycle: the new MASTER gets the chain, then the master\'s payload (masterSync → the chain\'s go()); {t: modsErr} from MASTER clears its key — the next build reposts', async () => {
  const live = MM.pay();
  sim.$('#power').onclick(); await sim.settle(5);
  await sim.power(); sim.raf(); await settle(3);
  const seq = mgot().filter(m => m.t === 'chain' || m.t === 'mods').map(m => m.t);
  assert.deepEqual([seq.join(), mgot('mods')[0].key, mgot('mods')[0].bpm], ['chain,mods', live.key, P().bpm], 'its live options are {}: the payload follows the chain');
  MN().posted.length = 0;
  api.queuePatch(R); await settle(1);
  assert.equal(mgot('mods').length, 0, 'deduped by key');
  MN()._fromProc({ t: 'modsErr', i: 'master', key: live.key });
  assert.equal(MM.node(R).modsKey, undefined, 'the key cleared');
  api.queuePatch(R); await settle(1);
  assert.deepEqual(mgot('mods').map(m => m.key).join(), live.key, 'reposted');
});

test('G5 the bounce: o.master.mods is the live payload (+ bpm) and the offline MASTER\'s processorOptions.mods; mAlign on', async () => {
  const live = MM.pay();
  P().tracks[0].notes = [{ id: 'mm1', t: 0, d: 960, n: 57, v: 100 }];
  const st = await bounce();
  const mn = st.nodes.find(n => n.name === 'synth-master');
  assert.ok(mn, 'an offline MASTER');
  assert.deepEqual([!!mn.po.mods, mn.po.mods && mn.po.mods.bpm, mn.po.mods && mn.po.mods.key, mn.po.mods && JSON.stringify(mn.po.mods.rows) === JSON.stringify(live.rows)], [true, P().bpm, live.key, true]);
  assert.equal(globalThis.__synthTest.sc.mAlign(1000) % 128, 0, 'aligned anchors (the master holds effects)');
});

test('G5 the \'mods\' monitor id goes to MASTER while an LFO body is live on the master canvas and is dropped on leaving; MASTER\'s smon with mc moves the bodies (slots); the rack\'s smon mo lights its live dots', async () => {
  // a cable from the LFO so it has a ModCore slot (l1 → the reverb size)
  X.opts.onMod('l1.out', 'mfx:fx.rev.size'); await settle(2);
  assert.equal(M.on(), true);
  sim.run(256); await settle(1);
  assert.equal((cv.monitors.on.get('master') || '').split(',').includes('mods'), true, 'MASTER\'s monitor ids carry mods: ' + cv.monitors.on.get('master'));
  assert.equal(MM.mcMons.has('master'), true);
  const pay = MM.pay(), sl = pay.slots && pay.slots.l1;
  assert.ok(sl && sl.i >= 0, 'the LFO\'s ModCore slot');
  const B = X.bodies.get('l1'), mc = new Float32Array(16);
  mc[sl.i] = 0.62;
  MN()._fromProc({ t: 'smon', mc, mcx: { ph: new Float32Array(20), env: new Float32Array(8) } });
  assert.equal(+B.value().toFixed(2), 0.62, 'MASTER\'s mc moves the master\'s LFO body');
  // the rack's live dots: base + mo at the knob's FX-context index
  const rec = M.ui, was = rec.ui, lives = [], fxr = pay.rows.find(r => r.dst.kind === 'fx' && P().master.mods.find(x => x.id === r.id).dst === 'mfx:fx.rev.size');
  const mo = new Float32Array(fxr.dst.fx + 1); mo[fxr.dst.fx] = 0.25;
  const real = was.setLive;
  was.setLive = f => lives.push(f === null ? 'off' : String(f('fx.rev.size', 0.5)));
  try {
    MN()._fromProc({ t: 'smon', c: 'mfx', gr: null, mo });
    assert.deepEqual(lives, [String(0.5 + Math.fround(0.25))], 'base + mo');
  } finally { was.setLive = real; }
  // leaving: the id goes
  api.selectTrack(TID.a); await settle(3);
  assert.equal((cv.monitors.on.get('master') || '').split(',').includes('mods'), false, 'dropped on leaving');
  assert.equal(MM.mcMons.has('master'), false);
});

test('G5 the collision (MM4): the track and the master both hold l1 / m1 / c1 and rows r1…r3 — every master-canvas action (the cable menu\'s Bypass, the inspector\'s amount, a macro knob move, a CC, Remove All Destinations, the Delete key on a cable, Disconnect, a module delete) does its work on the master and leaves the track\'s JSON and its node\'s messages untouched', async () => {
  M.open(); await settle(3);
  if (!M.fx().racks[0].mods.some(I => I.id === 'fil')) { cv.fx.addEffect('mfx', 'fil'); await settle(2); }
  if (!('c1' in R.dev)) { X.add('cc', null); await settle(2); }
  R.mods = []; R.mid = 1; // (the master's rows from r1 again: the same ids as the track's — set-up, not under test)
  for (const [s, d] of [['l1.out', 'mfx:fx.fil.cutoff'], ['m1.k1', 'mfx:fx.rev.mix'], ['c1.out', 'mfx:fx.fil.res']]) { X.opts.onMod(s, d); await settle(1); }
  const ta = () => P().tracks.find(t => t.id === TID.a), row = id => (P().master.mods || []).find(r => r.id === id);
  const rowsOf = t => (t.mods || []).map(r => r.id + ':' + r.src).join();
  assert.deepEqual([rowsOf(P().master), rowsOf(ta()), ['l1', 'm1', 'c1'].every(k => k in R.dev && k in ta().dev)], ['r1:l1.out,r2:m1.k1,r3:c1.out', 'r1:l1.out,r2:m1.k1,r3:c1.out', true], 'the same module keys and row ids on both');
  const t0 = JSON.stringify(ta()), all0 = tracksJSON();
  const ck = async (what, fn, done) => {
    clearTrk(); MN().posted.length = 0; await settle(1);
    await fn(); await settle(2);
    assert.equal(done(), true, what + ': done on the master');
    assert.equal(JSON.stringify(ta()), t0, what + ': the track\'s JSON');
    assert.deepEqual(trkPosted(TID.a).filter(m => m.t !== 'mon').map(m => m.t), [], what + ': no message to its node');
  };
  await ck('Bypass', () => { cv.mod.cmenu('r1').find(x => x.label === 'Bypass').action(); }, () => row('r1').byp === 1);
  await ck('the inspector\'s amount', () => { X.host().edit('r1', { amt: 0.21 }); X.host().step('Mod amount'); }, () => row('r1').amt === 0.21);
  await ck('a macro knob move', () => { const K = X.bodies.get('m1').knobs()[0]; K.dispatchEvent(ev('keydown', { key: 'ArrowUp', target: K })); }, () => mgot('mval').length === 1);
  await ck('a CC', () => { const C1 = P().master.mdev.c1; api.modCC(C1.ch || 1, C1.cc, 0.6); }, () => mgot('mval').some(m => m.v === 0.6));
  const ra = X.bodies.get('l1').menuItems().find(x => x && x.label === 'Remove All Destinations');
  assert.equal(!!ra, true, 'the LFO panel\'s ⋯ Remove All Destinations (its slot host\'s rows: the body\'s owner)');
  await ck('Remove All Destinations (LFO 1)', () => { ra.action(); }, () => !row('r1'));
  await ck('the Delete key on a cable', () => { X.act('r3', 'disconnect'); }, () => !row('r3'));
  await ck('Disconnect', () => { X.act('r2', 'disconnect'); }, () => !row('r2') && mgot('mods').some(m => m.off));
  await ck('a module delete', () => { X.del('c1'); }, () => !('c1' in R.dev) && 'c1' in ta().dev);
  assert.equal(tracksJSON(), all0, 'every track byte-identical through all of it');
  assert.equal(api.buildMods(ta()).rows.length, 3, 'the track\'s payload as it was');
});

test('G5 masterOff closes an open inspector (P3-10); the canvas Delete key on the master takes a selected modulator (its ⋯ Delete), the rack and the OUT stay', async () => {
  M.open(); await settle(3);
  X.opts.onMod('l1.out', 'mfx:fx.rev.mix'); await settle(2);
  const id = P().master.mods[0].id;
  X.sel(id); await Promise.resolve(); await Promise.resolve();
  assert.equal(X.layer().isOpen(), true, 'the inspector on the master\'s row');
  api.selectTrack(TID.a); await settle(3);
  assert.equal(X.layer().isOpen(), false, 'closed with the master canvas');
  M.open(); await settle(3);
  const n0 = hsteps(), press = () => { sim.key('Delete', true, { key: 'Delete' }); sim.key('Delete', false, { key: 'Delete' }); };
  cv.world().select('mfx'); press(); await settle(2);
  assert.deepEqual([keys().includes('mfx'), hsteps(), note()], [true, n0, 'The master canvas’s modules can’t be deleted'], 'the rack stays');
  cv.world().select('h1'); press(); await settle(2);
  assert.deepEqual(['h1' in R.dev, hsteps(), cv.hist.undoLabel, keys().includes('h1')], [false, n0 + 1, 'Delete Chaos 1', false], 'a modulator goes, one step');
  cv.undo(); await settle(2);
  assert.equal('h1' in R.dev, true);
  M.off(); await settle(2);
});

// (the MM UI fixer, review MM-2 — the browser review's findings, failing first)
test('(MM UI fixer, review MM-2 P2-1) ↶ / ↷ repaint the master rack\'s halos: after a cable step, its undo, its redo, a Disconnect and its undo the rows painted on the rack\'s knobs are project.master.mods\'', async () => {
  M.open(); await settle(3);
  if (!M.fx().racks[0].mods.some(I => I.id === 'fil')) { cv.fx.addEffect('mfx', 'fil'); await settle(2); }
  const ids = ['fx.fil.cutoff', 'fx.fil.res', 'fx.rev.mix', 'fx.rev.size'];
  const painted = () => { const u = M.ui.ui, f = u && u.paints[u.paints.length - 1]; return ids.map(id => id + ':' + (typeof f === 'function' ? f(id).length : -1)).join(); };
  const want = () => ids.map(id => id + ':' + (P().master.mods || []).filter(r => r.dst === 'mfx:' + id).length).join();
  X.opts.onMod('l1.out', 'mfx:fx.fil.cutoff'); await settle(2);
  assert.match(want(), /fx\.fil\.cutoff:1/);
  assert.equal(painted(), want(), 'after the step');
  cv.undo(); await settle(2);
  assert.match(want(), /fx\.fil\.cutoff:0/);
  assert.equal(painted(), want(), 'after ↶ (no stale arc)');
  cv.redo(); await settle(2);
  assert.equal(painted(), want(), 'after ↷');
  const id = P().master.mods.find(r => r.dst === 'mfx:fx.fil.cutoff').id;
  X.act(id, 'disconnect'); await settle(2);
  assert.equal(painted(), want(), 'after Disconnect');
  cv.undo(); await settle(2);
  assert.match(want(), /fx\.fil\.cutoff:1/);
  assert.equal(painted(), want(), 'after its ↶ (the halo back)');
});

test('(MM UI fixer, review MM-2 P2-2) the master rack draws no "in" jack — nothing is ever patched into it, so a modulator\'s cable never reads as plugged into the master\'s input; its OUT → the OUT as before; a track\'s FX modules keep both', async () => {
  M.open(); await settle(3);
  const m = V().modules.get('mfx'), ports = V().ports();
  assert.deepEqual([m.jackIds().join(), ports.has('mfx.in'), ports.has('mfx.out'), ports.has('out.in')], ['out', false, true, true]);
  assert.equal(V().cables.list().filter(c => c.kind !== 'mod').map(c => c.a + '>' + c.b).join(), 'mfx.out>out.in');
  api.selectTrack(TID.a); await settle(3);
  const fx = [...V().modules.values()].filter(x => x.kind === 'fx');
  assert.ok(fx.length > 0 && fx.every(x => x.jackIds().join() === 'in,out'), 'a track\'s FX: in and out');
});

test('(MM UI fixer, review MM-2 P2-3) a modulator dropped on the rack lands in the column and the camera follows it there when that is off screen (as a tap does); a drop that lands where it was dropped moves no camera; a track\'s drop on its instrument the same', async () => {
  const W = cv.world(), seen = [], fi = W.focusItem;
  W.focusItem = k => { seen.push(k); };
  try {
    M.open(); await settle(3);
    W.setCamera({ tx: 0, ty: 0, k: 1 }); await settle(1);
    const r = V().rects().mfx, n0 = hsteps();
    const k1 = X.add('lfo', { x: r.x + 40, y: r.y + 40 }); await settle(2);
    const L1 = P().master.lay[k1];
    assert.ok(L1.x + cvModule.modW('lfo') <= r.x, 'moved into the column: ' + JSON.stringify(L1));
    assert.deepEqual(seen, [k1], 'the camera follows the moved drop');
    seen.length = 0;
    const R2 = Object.values(V().rects()).filter(Boolean), low = Math.ceil((Math.max(...R2.map(q => q.y + q.h)) + 320) / 64) * 64; // (on the dots: a drop lands snapped)
    const k2 = X.add('chaos', { x: r.x, y: low }); await settle(2);
    assert.deepEqual([P().master.lay[k2].x, P().master.lay[k2].y, seen], [r.x, low, []], 'where it was dropped: no camera move');
    while (hsteps() > n0) { cv.undo(); await settle(1); }
    // a track: a drop on its instrument moves left past it — followed too
    api.selectTrack(TID.a); await settle(3);
    W.setCamera({ tx: 0, ty: 0, k: 1 }); await settle(1);
    const i = V().rects().i1, n1 = hsteps();
    seen.length = 0;
    const k3 = X.add('lfo', { x: i.x + 80, y: i.y + 40 }); await settle(2);
    assert.ok(T().lay[k3].x + cvModule.modW('lfo') <= i.x, 'left of the instrument');
    assert.deepEqual(seen, [k3], 'the camera follows');
    while (hsteps() > n1) { cv.undo(); await settle(1); }
  } finally { W.focusItem = fi; }
});

test('(MM UI fixer, review MM-2 P3-1 / P3-2 / P3-3) the master names no envelopes in its budgets (the inspector header, the Mod list; a track keeps ENV); a tap on its locked MONO says why (a notice); its Sources tray says it once — no mode line above the tiles (the note under them), MASTER_SRC the refusal still, a track\'s line back on leaving', async () => {
  M.open(); await settle(3);
  const s = X.host().budget('mfx').slots;
  assert.deepEqual([!!s, !!s && 'env' in s, !!s && 'lfo' in s, !!s && 'ext' in s], [true, false, true, true], 'the master\'s slots: no ENV');
  if (!P().master.mods || !P().master.mods.length) { X.opts.onMod('l1.out', 'mfx:fx.rev.mix'); await settle(2); }
  X.sel(P().master.mods[0].id); await Promise.resolve(); await Promise.resolve();
  assert.equal(X.layer().isOpen(), true);
  const hb = walk(sim.$('#ov'), c => /\bcv-ml-b\b/.test(clsOf(c))).map(c => c.textContent).join(' | ');
  assert.ok(/LFO \d+\/\d+/.test(hb) && !/ENV/.test(hb), 'the header: ' + hb);
  X.layer().close();
  X.list();
  const lb = walk(sim.$('#ov'), c => /\bcv-ml-b\b/.test(clsOf(c))).map(c => c.textContent).join(' | ');
  assert.ok(/LFO \d+\/\d+/.test(lb) && !/ENV/.test(lb), 'the Mod list: ' + lb);
  X.layer().close();
  // MONO: a notice on a tap
  const tip = (await import('../sx-ui-mod.js?v=9')).MONO_LOCK_TIP, n0 = hsteps();
  mono('l1').dispatchEvent(ev('click', { bubbles: true })); await settle(1);
  assert.deepEqual([note(), P().master.mdev.l1.lfo.mono, hsteps()], [tip, 1, n0], 'the notice, nothing written');
  // the tray: no mode line on the master
  const p = sim.$('#srcMode');
  assert.deepEqual([p.hidden, p.children.length], [true, 0], 'no mode line');
  assert.equal(X.add('env', null), null);
  assert.equal(note(), MM.src, 'MASTER_SRC: the refusal');
  api.selectTrack(TID.a); await settle(3);
  assert.deepEqual([p.hidden, p.children.length > 0], [false, true], 'a track: its line');
  const t = X.host().budget('i1').slots;
  assert.equal(!!t && 'env' in t, true, 'a track\'s slots: ENV as before');
});

/* the bounce through the page's dialog (canvas-M-sim's helper): its fields set explicitly */
async function bounce(set = {}) {
  const st = Object.assign({ range: 'song', sr: '48000', bits: '32', os: '2', tail: '0', norm: 'off' }, set), blobs = [], real = URL.createObjectURL;
  URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
  try {
    sim.$('#fBounce').click();
    for (const [k, v] of [['#bRange', st.range], ['#bSr', st.sr], ['#bBits', st.bits], ['#bOs', st.os], ['#bTail', st.tail], ['#bNorm', st.norm]]) sim.$(k).value = v;
    sim.$('#bNorm').checked = false;
    sim.lastOffline = null;
    await sim.$('#bGo').onclick();
    for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
    return { nodes: sim.lastOffline ? sim.lastOffline.nodes : [] };
  } finally { URL.createObjectURL = real; sim.$('#bCancel').onclick(); }
}
// an Open through the page's file input (a project object as the file: canvas-M-sim's helper)
async function openFile(o) {
  const file = { name: 'm.synth.json', type: 'application/json', text: async () => JSON.stringify(o) };
  await sim.$('#fFile').onchange({ target: { files: [file], value: '' } });
  await sim.settle(10); sim.raf(); await settle(2);
}
