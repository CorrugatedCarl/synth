import './v8-guard.mjs';
// Stage 2b on the canvas (docs/canvas/IMPL-2b.md §6.3, lane D) in the page simulation: an LFO tile drop adds l1 with Serum's
// default LFO state (GLOBAL; its badge toggles PER NOTE, one step); a drag from l1.out to a Serum knob posts a patch whose
// matrix holds an ext1 row and a {t: 'mods'} with ext [{k: 1, src}]; the same drag to a Juno cutoff a cls row with its
// transfer, to a panel knob an fx row; a PER NOTE LFO on a Serum knob is injected into s.lfo[k]; a macro knob turn posts
// {t: 'mval'} and no patch; a CC module takes controllers (and learns one); deleting the module drops its rows and posts
// {t: 'mods', off: true}; undo / redo; the inspector's ModCore budgets; refusals (chunk → stage 5, nomod); the classic
// halo DOM appears and follows an eff snapshot; the Mod list over every device; the badges. The world is canvas-sim's
// scripted one. One boot per file; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-2b-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CG from '../cv-graph.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as CM from '../cv-mods.js?v=9';
import { MODELS } from '../models.js?v=9';

const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), log: [], selected: null, mode: 'always',
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem() {}, dragPointer() {},
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

const sim = await bootMain({ ls: fakeStorage({}), hash: '#serum', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, M = cv.mod, U = globalThis.__synthTest.modUI;
await sim.power(); sim.raf(); await sim.settle(20); sim.raf();
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const hsteps = () => cv.hist.u.length;
const keys = () => [...V().modules.keys()].sort().join(',');
const note = () => sim.$('#notice').textContent;
const tiles = () => sh.shell.tiles;
const MOD = id => MODELS.find(m => m.id === id);
const fresh = (id = 'serum') => { const t = api.addTrack(MOD(id)); sim.raf(); cv.renderViews(); sim.raf(); return t; };
const posted = (t, kind) => sim.nodeOf(t.id).posted.map(x => x.m).filter(m => !kind || m.t === kind);
const clearPosted = t => { sim.nodeOf(t.id).posted.length = 0; };
const lastPatch = (t, i) => { const L = posted(t, 'patch').filter(m => !i || m.i === i); return L.length ? L[L.length - 1].p : null; };
const lastMods = t => { const L = posted(t, 'mods'); return L.length ? L[L.length - 1] : null; };
const rows = (t = T()) => (t.mods || []).map(r => r.id + ':' + r.src + '>' + r.dst).join(',');
const badge = k => { const m = V().modules.get(k); return m ? (m.bar.children.find(c => /cv-badge/.test(c.className || '')) || {}).textContent || '' : null; };
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const clsOf = c => String(c.className || (c.attrs && c.attrs.class) || '');
const pop = () => walk(sim.$('#ov'), c => /\bcv-ml-pop\b/.test(clsOf(c))).pop() || null;
const inPop = f => { const p = pop(); return p ? walk(p, f) : []; };
const ev = (type, o) => Object.assign({ type, preventDefault() {}, stopPropagation() {} }, o || {});
const drop = (kind, at) => { assert.equal(M.drag.drop(kind, { over: 'canvas', x: 200, y: 400, at: at || { x: -600, y: 300 } }), true); sim.raf(); };
const ID = {};

test('an LFO tile drop adds l1 with Serum\'s default LFO state (GLOBAL, one step "Add LFO 1", the notice undoes it); its tile never greys; a second drop adds l2; the badge toggles PER NOTE (one step)', () => {
  const t = T(), n0 = hsteps();
  ID.a = t.id;
  tiles().setView('serum');
  assert.deepEqual([keys(), tiles().modTiles().length, tiles().modTile('lfo').hasAttribute('data-multi')], ['i1,i1/fx,out', 10, true]);
  drop('lfo');
  assert.deepEqual([keys(), hsteps(), cv.hist.undoLabel, note()], ['i1,i1/fx,l1,out', n0 + 1, 'Add LFO 1', 'Added LFO 1 · tap to undo']);
  const d = t.dev.l1, L0 = C.normLfo({ mono: 1 });
  assert.deepEqual([d.kind, d.lfo.mono, d.lfo.mode, typeof d.rate], ['lfo', 1, L0.mode, 'number'], 'Serum\'s default LFO, GLOBAL');
  assert.deepEqual([tiles().placed('lfo'), V().modules.get('l1').kind, !!M.bodies.get('l1')], [null, 'mod', true]);
  assert.equal(!!api.nodes.get(t.id).graphed, false, 'no rows: the node stays canonical (N1: no payload)');
  assert.equal(api.buildMods(t).off, true);
  drop('lfo', { x: -600, y: 600 });
  assert.deepEqual([keys(), cv.hist.undoLabel], ['i1,i1/fx,l1,l2,out', 'Add LFO 2']);
  cv.undo(); sim.raf();
  assert.equal(keys(), 'i1,i1/fx,l1,out');
  // the badge: GLOBAL ↔ PER NOTE through the body's edit → setModState, one step
  const B = M.bodies.get('l1'), bad = walk(B.el, c => /\bcv-mbadge2\b/.test(clsOf(c)))[0];
  assert.equal(bad.textContent, 'GLOBAL');
  bad.dispatchEvent(ev('click')); sim.raf();
  assert.deepEqual([T().dev.l1.lfo.mono, hsteps(), cv.hist.undoLabel, bad.textContent], [0, n0 + 2, 'Edit LFO 1', 'PER NOTE']); // (T(): the undo above restored a snapshot)
  cv.undo(); sim.raf();
  assert.deepEqual([T().dev.l1.lfo.mono, bad.textContent], [1, 'GLOBAL'], 'undo: the body re-reads its state (sync)');
});

test('a drag from l1.out to a Serum knob: canMod / marks, one step, a row; the node is graphed and gets a patch whose matrix reads ext1 and a {t: \'mods\'} with ext [{k: 1, src: lfo1}]; the badge "mods 1/64"; the Serum\'s halo rows name the ext source', () => {
  const t = T(), n0 = hsteps();
  assert.deepEqual([M.opts.canMod('l1.out', 'i1:f.cutoff').ok, M.marks()('i1', 'f.cutoff'), M.label('l1.out')], [true, true, 'LFO 1']);
  clearPosted(t);
  M.opts.onMod('l1.out', 'i1:f.cutoff'); sim.raf();
  assert.deepEqual([rows(), hsteps(), cv.hist.undoLabel], ['r1:l1.out>i1:f.cutoff', n0 + 1, 'Modulate Filter Cutoff with LFO 1']);
  assert.ok(api.nodes.get(t.id).graphed, 'graphed: the payload names device ids');
  const kinds = posted(t).map(m => m.t);
  assert.deepEqual([kinds.includes('graph'), kinds.includes('patch'), kinds.includes('mods'), kinds.indexOf('mods') > kinds.indexOf('patch')], [true, true, true, true], 'graph, the parts, then the payload');
  const cp = lastPatch(t, 'i1').serum, m = lastMods(t);
  assert.ok(Array.from(cp.mSrc).slice(0, cp.mN).includes(CG.S_EXT0), 'the Serum\'s matrix reads ext1 (source 62)');
  assert.equal(cp.use & 32768, 32768, 'compiled with the ext flag');
  assert.deepEqual([m.off, m.ext, m.rows.length, m.n.lfo], [undefined, [{ k: 1, src: C.SRC_INDEX.lfo1, id: 'l1.out' }], 0, 1]);
  assert.equal(badge('i1'), 'mods 1/64');
  assert.deepEqual(api.sxExtra(t, 'i1', 'f.cutoff').map(r => r.id + ':' + r.src), ['r1:ext1'], 'the halo row names the ext source');
  // a knob turn on the Serum never reposts the payload (content key); the same payload again is not posted
  clearPosted(t);
  api.sxHost(t).edit(s => { s.p['f.res'] = 0.4; }); sim.raf();
  assert.deepEqual([posted(t, 'patch').length >= 1 || posted(t, 'ct').length >= 1, posted(t, 'mods').length], [true, 0], 'a Serum knob: no repost');
  assert.deepEqual(V().cables.list().filter(c => c.kind === 'mod').map(c => c.id + ':' + c.a + '>' + c.b + ':' + c.dashed), ['r1:l1.out>i1:f.cutoff:false']);
});

test('a PER NOTE LFO on a Serum knob is injected into a free s.lfo[k] (the row reads lfo<k>, the slot mono 0); back to GLOBAL it reads ext1 again', () => {
  const t = T();
  clearPosted(t);
  U.editState('l1', { lfo: Object.assign({}, t.dev.l1.lfo, { mono: 0 }) }); sim.raf();
  const cp = lastPatch(t, 'i1').serum, srcs = Array.from(cp.mSrc).slice(0, cp.mN);
  assert.deepEqual([srcs.includes(CG.S_EXT0), srcs.includes(C.SRC_INDEX.lfo1), cp.lfoMono[0], lastMods(t).off, lastMods(t).ext], [false, true, 0, true, undefined], 'injected into LFO 1 (nothing left for ModCore: off)');
  assert.deepEqual(api.sxExtra(t, 'i1', 'f.cutoff').map(r => r.src), ['lfo1']);
  cv.undo(); sim.raf();
  const cp2 = lastPatch(t, 'i1').serum;
  assert.deepEqual([Array.from(cp2.mSrc).slice(0, cp2.mN).includes(CG.S_EXT0), lastMods(t).ext.length], [true, 1], 'GLOBAL again: ext');
});

test('the same drag to a Juno cutoff: a cls row with its transfer in the payload; a cabled knob\'s turn reposts (its transfer), the classic halo DOM appears; the badge "mods 1"; dashed from a PER NOTE source', () => {
  const j = fresh('juno60'), n0 = hsteps();
  ID.j = j.id;
  drop('lfo');
  assert.deepEqual([keys(), rows()], ['fx1,i1,l1,out', '']);
  assert.deepEqual([M.opts.canMod('l1.out', 'i1:cf').ok, M.marks()('i1', 'cf'), M.opts.canMod('l1.out', 'i1:ld').why, M.opts.canMod('l1.out', 'i1:fl').why], [true, true, 'LFO 1 → Delay: this knob can be modulated from stage 5', 'LFO 1 → LFO: this knob can be modulated from stage 5'], 'sm opens; chunk knobs: stage 5');
  clearPosted(j);
  M.opts.onMod('l1.out', 'i1:cf'); sim.raf();
  assert.deepEqual([rows(), hsteps(), cv.hist.undoLabel], ['r1:l1.out>i1:cf', n0 + 2, 'Modulate Freq with LFO 1'], '(+1: the LFO)');
  const m = lastMods(j);
  assert.deepEqual([m.rows.map(r => [r.id, r.dst.kind, r.dst.inst, r.dst.slot]), m.xfer.length, typeof m.xfer[0].x0, m.ext, m.n.rows], [[['r1', 'cls', 'i1', CM.SM_SLOT['vcf.oct']]], 1, 'number', [], 1]);
  assert.ok(m.xfer[0].tab || typeof m.xfer[0].b === 'number', 'a table or a linear transfer');
  assert.equal(badge('i1'), 'mods 1');
  // the cabled knob's turn: a new transfer → a repost; another knob's turn: none
  const key0 = m.key;
  clearPosted(j);
  cv.classicPanels.get(j.id + '/i1').set('cf', 3); sim.raf();
  assert.deepEqual([posted(j, 'mods').length, lastMods(j).key !== key0], [1, true], 'the cabled knob reposts (x0 changed)');
  clearPosted(j);
  cv.classicPanels.get(j.id + '/i1').set('rs', 2); sim.raf();
  assert.equal(posted(j, 'mods').length, 0, 'an uncabled knob: no repost');
  // the halo DOM on the cutoff (a slider in the hardware layout: range bars; a knob: an arc ring), a subscription
  const Pn = cv.classicPanels.get(j.id + '/i1'), ctl = Pn.els.get('cf');
  assert.ok(Pn.halos.has('cf'), 'the panel holds the rows on cf');
  const nodes = walk(ctl, c => /\bcp-(range|halo|arc)\b/.test(clsOf(c)));
  assert.ok(nodes.length >= 1, 'halo nodes in the control');
  assert.deepEqual([U.mons.has(j.id + '/i1'), U.rows(j, 'i1').cf.map(r => r.kind + ':' + r.label)], [true, ['lfo:LFO 1']]);
  // dashed: a PER NOTE source on a classic knob follows the most recent note
  U.editState('l1', { lfo: Object.assign({}, j.dev.l1.lfo, { mono: 0 }) }); sim.raf();
  assert.deepEqual([V().cables.list().find(c => c.id === 'r1').dashed, lastMods(j).dashed, lastMods(j).rows[0].perNote], [true, ['r1'], true]);
  cv.undo(); sim.raf();
  assert.equal(V().cables.list().find(c => c.id === 'r1').dashed, false);
});

test('the classic halo follows an eff snapshot: the engine\'s slot value (engine units) → knob units through the inverse transfer → the panel\'s live mark', () => {
  const j = T(), k = j.id + '/i1', Pn = cv.classicPanels.get(k), m = lastMods(j), xf = m.xfer[0];
  assert.equal(j.id, ID.j);
  const T_ = x => (xf.tab ? xf.tab[Math.round(x * 128)] : xf.a + xf.b * x);
  const x = Math.min(1, xf.x0 + 0.1), eff = Float32Array.of(T_(x));
  cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: { eff } });
  const live = U.live.get(k), c = MOD('juno60').controls.find(q => q.id === 'cf');
  assert.ok(live && typeof live.cf === 'number', 'a live value in knob units');
  assert.ok(Math.abs(live.cf - (c.min + (c.max - c.min) * x)) < 0.02 * (c.max - c.min), 'cf ≈ x0 + 0.1 of the range: ' + live.cf);
  const marks = walk(Pn.els.get('cf'), q => /\bcp-(livemk|live)\b/.test(clsOf(q)));
  assert.ok(marks.length === 1, 'the live mark');
  const mk = marks[0], shown = mk.attrs && 'display' in mk.attrs ? mk.attrs.display !== 'none' : !mk.hidden;
  assert.equal(shown, true, 'shown: the live value differs from the base');
  // the snapshot at the base: the mark hides
  cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: { eff: Float32Array.of(T_(xf.x0)) } });
  const mk2 = walk(Pn.els.get('cf'), q => /\bcp-(livemk|live)\b/.test(clsOf(q)))[0];
  assert.equal(mk2.attrs && 'display' in mk2.attrs ? mk2.attrs.display === 'none' : !!mk2.hidden, true, 'hidden at the base');
});

test('the inspector on a classic row shows the ModCore budgets "LFO 1/10 · ENV 0/4 · ext 0/16", no Save with preset; the parameter list groups the Juno by its sections with chunk knobs greyed "stage 5"; the Mod list lists the Juno and its panel', async () => {
  const j = T();
  M.sel('r1'); await Promise.resolve();
  assert.equal(M.layer().isOpen(), true);
  const b = inPop(c => /\bcv-ml-b\b/.test(clsOf(c)))[0];
  assert.equal(b.textContent, 'LFO 1/10 · ENV 0/4 · ext 0/16');
  const save = inPop(c => c.attrs && c.attrs['data-act'] === 'save')[0];
  assert.equal(save.hidden, true, 'no preset to save into');
  assert.ok(inPop(c => c.attrs && c.attrs['data-act'] === 'curve').length === 1, 'Curve: Custom…');
  M.layer().close();
  const D = M.descs('i1'), groups = [...new Set(D.map(x => x.group))];
  assert.ok(groups.length > 2 && D.some(x => x.id === 'cf' && !x.nomod && !x.stage) && D.some(x => x.id === 'ld' && x.stage === '5'), 'sections, cf open, ld stage 5: ' + groups.join('|'));
  const pid = Object.keys(j.dev).find(k => j.dev[k].kind === 'panel');
  M.layer().openDestList('l1.out', 'i1', 10, 10);
  const items = inPop(c => c.attrs && c.attrs['data-group']);
  assert.ok(items.length === groups.length, 'one group button per section');
  M.layer().close();
  M.list();
  const secs = walk(sim.$('#ov'), c => /\bcv-ml-dev\b/.test(clsOf(c))).map(c => c.attrs['data-dev']).sort();
  assert.deepEqual(secs, ['i1', pid].sort(), 'the Juno and its panel');
  M.layer().close();
});

test('a panel knob: an fx row in the payload (the chain, the FX-context index, the layout key); the badge "mods 1" on the panel', () => {
  const j = T(), pid = Object.keys(j.dev).find(k => j.dev[k].kind === 'panel'), iid = cv.fx.addEffect(pid, 'rev');
  sim.raf();
  assert.ok(iid, 'a reverb on the panel');
  const dst = pid + ':fx.' + iid + '.mix';
  assert.deepEqual([M.opts.canMod('l1.out', dst).ok, M.marks()(pid, 'fx.' + iid + '.mix'), M.label(dst)], [true, true, 'Reverb Mix']);
  M.opts.onMod('l1.out', dst); sim.raf();
  const m = lastMods(j), r = m.rows.find(x => x.dst.kind === 'fx');
  assert.ok(r, 'an fx row');
  assert.deepEqual([r.dst.chain, r.dst.fx >= 8, typeof r.dst.key, m.n.rows], [pid, true, 'string', 2]);
  assert.equal(badge(pid), 'mods 1');
});

test('a macro module: its knob\'s move posts {t: \'mval\'} (the table index of that knob) and no patch; the gesture\'s end is one step; a CC module takes matching controllers (modCC) and learns one', () => {
  const j = T(), n0 = hsteps();
  drop('macro', { x: -600, y: 900 });
  drop('cc', { x: -600, y: 1300 });
  assert.deepEqual([keys(), cv.hist.undoLabel], ['c1,fx1,i1,l1,m1,out', 'Add CC 1']);
  M.opts.onMod('m1.k1', 'i1:rs'); sim.raf();
  M.opts.onMod('c1.out', 'i1:lv'); sim.raf();
  const m = lastMods(j);
  assert.deepEqual(m.vals.map(v => v.id + ':' + v.k), ['m1.k1:0', 'c1.out:8'], 'the table: macro 1 at 0, the CC a value source at 8');
  const n1 = hsteps();
  clearPosted(j);
  const K = M.bodies.get('m1').knobs()[0];
  K.dispatchEvent(ev('keydown', { key: 'ArrowUp', target: K })); sim.raf();
  const mv = posted(j, 'mval');
  assert.deepEqual([mv.length, mv[0].k, mv[0].v > 0, posted(j, 'patch').length, hsteps(), cv.hist.undoLabel], [1, 0, true, 0, n1 + 1, 'Edit Macro 1'], 'mval, no patch, one step');
  assert.ok(Math.abs(j.dev.m1.v[0] - mv[0].v) < 1e-9, 'the state holds the value');
  // a controller: routed to the CC module of the channel's targets (cc 1, omni) → mval k 8 and the meter
  clearPosted(j);
  assert.equal(api.modCC(1, 1, 0.5), 1);
  assert.deepEqual(posted(j, 'mval').map(x => [x.k, x.v]), [[8, 0.5]]);
  assert.equal(M.bodies.get('c1').value(), 0.5, 'the meter');
  assert.equal(api.modCC(1, 7, 0.5), 0, 'another controller: nothing');
  // learn: the next controller becomes the module's (one step)
  const n2 = hsteps();
  U.learn('c1', true);
  assert.equal(M.bodies.get('c1').armed(), true);
  api.modCC(2, 74, 0.25);
  assert.deepEqual([j.dev.c1.cc, M.bodies.get('c1').armed(), hsteps(), cv.hist.undoLabel], [74, false, n2 + 1, 'Learn CC']);
  assert.deepEqual([api.modCC(1, 74, 0.75), M.bodies.get('c1').value()], [1, 0.75]);
});

test('a refused row by the ModCore budgets goes again (eleven GLOBAL LFOs: the eleventh "slots"), no step; a Serum\'s own LFO is a source in the picker (linkSources)', () => {
  const j = T(), n0 = hsteps();
  for (let k = 2; k <= 11; k++) { drop('lfo', { x: -600, y: 1600 + k * 300 }); M.opts.onMod('l' + k + '.out', 'i1:cf'); sim.raf(); }
  const L = rows().split(',').length;
  assert.deepEqual([keys().split(',').filter(k => /^l\d+$/.test(k)).length, L, hsteps(), /^ModCore slots full: LFO 10\/10/.test(note())], [11, 13, n0 + 10 + 9, true], 'the 11th cable refused: ' + note());
  assert.equal(api.modBudget(j, 'i1').slots.lfo.join('/'), '10/10');
  assert.ok(U.srcList(j).some(s => s.kind === 'link' && /ENV 2$/.test(s.label)) === false, 'a Juno track: no Serum to link from');
  const a = P().tracks.find(x => x.id === ID.a);
  assert.ok(CM.linkSources(a).some(s => s.id === 'i1/lfo2.out' && s.label === 'Serum LFO 2'), 'the Serum track lists its own LFOs');
  for (let k = 0; k < 19; k++) cv.undo();
  sim.raf();
  assert.deepEqual([keys(), hsteps()], ['c1,fx1,i1,l1,m1,out', n0]);
});

test('deleting the module drops its rows and posts {t: \'mods\', off: true} once nothing is left; undo brings the module, its rows and the payload back; redo posts off again; the classic halo goes', () => {
  const j = T(), n0 = hsteps();
  M.del('c1'); sim.raf(); M.del('m1'); sim.raf();
  assert.deepEqual([keys(), rows().split(',').length, lastMods(j).off], ['fx1,i1,l1,out', 2, undefined]);
  clearPosted(j);
  M.del('l1'); sim.raf();
  assert.deepEqual([keys(), rows(), hsteps(), cv.hist.undoLabel], ['fx1,i1,out', '', n0 + 3, 'Delete LFO 1']);
  assert.deepEqual(posted(j, 'mods').map(m => m.off), [true], 'off once');
  assert.deepEqual([badge('i1') === 'mods 1', cv.classicPanels.get(j.id + '/i1').halos.size, U.mons.has(j.id + '/i1')], [false, 0, false], 'no badge, no halo, no subscription');
  clearPosted(j);
  cv.undo(); sim.raf();
  assert.deepEqual([keys(), rows().split(',').length, lastMods(j).off, lastMods(j).n.rows], ['fx1,i1,l1,out', 2, undefined, 2], 'the payload again');
  assert.deepEqual([cv.classicPanels.get(j.id + '/i1').halos.has('cf'), U.mons.has(j.id + '/i1')], [true, true]);
  clearPosted(j);
  cv.redo(); sim.raf();
  assert.deepEqual([keys(), posted(j, 'mods').map(m => m.off)], ['fx1,i1,out', [true]]);
  clearPosted(j);
  api.queuePatch(j); sim.raf();
  assert.equal(posted(j, 'mods').length, 0, 'off is not repeated');
});

test('offline renders carry the payload: bounceSet / render-last items and processorOptions.mods; a track without one carries none', async () => {
  cv.undo(); sim.raf(); // (the LFO and its rows back on the Juno)
  const a = P().tracks.find(x => x.id === ID.a), j = T();
  assert.equal(rows(j).split(',').length, 2);
  j.notes.push({ id: 1, t: 0, d: 480, n: 60, v: 100 });
  const items = api.bounceSet(48000), it = items.find(x => x.tr === j);
  assert.ok(it && it.graph, 'a graph-shaped item');
  const mods = api.modsFor(j);
  assert.deepEqual([mods && mods.t, mods.rows.length, api.modsFor(P().tracks.find(x => x.id !== ID.a && x.id !== ID.j) || { id: 'x' })], ['mods', 2, null]);
  api.selectTrack(a.id); sim.raf(); cv.renderViews(); sim.raf();
  assert.equal(api.modsFor(a).ext.length, 1, 'the Serum track: its ext slot');
});

/* ---- (2b fixer C) the review's host / UI findings */
const selectT = id => { api.selectTrack(id); sim.raf(); cv.renderViews(); sim.raf(); return T(); };
const dropNew = (kind, at) => { const before = keys().split(','); drop(kind, at); return keys().split(',').find(k => !before.includes(k)); }; // (ids are never reused: the new module's key)
const undoN = n => { for (let i = 0; i < n; i++) { cv.undo(); sim.raf(); } }; // (counted, not by hsteps: the History's size cap trims old steps under the sim's many snapshots)

test('(U6) the Serum\'s hooks label a canvas row by its source module: sxExtra rows carry label "LFO 1" (the knob menu says "Canvas cable: LFO 1"); extraMatrix lists every row compiled into the Serum with its slot tag ("ext 1"; an injected PER NOTE LFO "LFO 1"); (U7) module titles are numbered', () => {
  const a = T();
  assert.equal(a.id, ID.a);
  assert.deepEqual(api.sxExtra(a, 'i1', 'f.cutoff').map(r => [r.id, r.src, r.label, r.pol]), [['r1', 'ext1', 'LFO 1', 'uni']]);
  const X = api.sxHost(a).extraMatrix();
  assert.deepEqual(X.map(r => [r.id, r.src, r.dst, r.tag, r.label, r.amt]), [['r1', 'ext1', 'f.cutoff', 'ext 1', 'LFO 1', a.mods[0].amt]]);
  U.editState('l1', { lfo: Object.assign({}, a.dev.l1.lfo, { mono: 0 }) }); sim.raf();
  assert.deepEqual(api.sxHost(a).extraMatrix().map(r => [r.src, r.tag]), [['lfo1', 'LFO 1']], 'the injected slot');
  cv.undo(); sim.raf();
  assert.deepEqual([V().modules.get('l1').title, V().modules.get('i1').title], ['LFO 1', 'Serum']);
  drop('lfo', { x: -600, y: 700 }); drop('velo', { x: -600, y: 1100 });
  assert.deepEqual([V().modules.get('l2').title, V().modules.get('ve').title], ['LFO 2', 'Velocity']);
  cv.undo(); cv.undo(); sim.raf();
  assert.equal(keys(), 'i1,i1/fx,l1,out');
});

test('(U5) a Serum\'s OWN FX knob with a canvas cable: the FX module\'s rack is painted with the rows (fx-ui paintMods through modHalos, and when the rack is built) and its host\'s extraRows names them for the rack\'s control menu', () => {
  const a = T(), calls = [];
  const iid = cv.fx.addEffect('i1/fx', 'rev'); sim.raf();
  assert.equal(iid, 'rev');
  M.opts.onMod('l1.out', 'i1:fx.rev.mix'); sim.raf();
  assert.deepEqual(rows(a), 'r1:l1.out>i1:f.cutoff,r2:l1.out>i1:fx.rev.mix');
  const rec = cv.fxRec(a, 'i1/fx'), was = { ui: rec.ui, trackId: rec.trackId, dev: rec.dev, key: rec.key, sx: rec.sx }; // (R6: its FX module's record)
  Object.assign(rec, { ui: { paintMods: f => calls.push(f('fx.rev.mix').map(r => r.id + ':' + r.src + ':' + r.label).join('|') + ' / ' + f('fx.rev.size').length), refresh() {}, destroy() {} }, trackId: a.id, dev: 'i1', key: 'i1/fx', sx: true });
  try {
    U.modHalos(a);
    assert.deepEqual(calls, ['r2:ext1:LFO 1 / 0'], 'the rack painted with the cable\'s row (its ext source, its label)');
    assert.deepEqual(api.fxHost(a, rec).extraRows('fx.rev.mix').map(r => r.label + ':' + r.src), ['LFO 1:ext1'], 'the rack\'s menu rows');
    assert.deepEqual(api.fxHost(a, rec).extraRows('fx.rev.size'), []);
    calls.length = 0;
    U.editState('l1', { rate: 0.7 }); sim.raf(); // (an edit → modHalos → painted again)
    assert.equal(calls.length, 1);
  } finally { Object.assign(rec, was); }
  undoN(2); // (the cable, the rate edit; addEffect is no step)
  assert.equal(rows(T()), 'r1:l1.out>i1:f.cutoff');
});

test('(U2 / P4) a cabled classic knob\'s drag reposts the payload at most every 66 ms and once at the gesture\'s end (15 moves → ≤ 3 {t: \'mods\'}, the last with the final transfer); keys coalesce per frame; (C4) a cables refresh builds the payload once, not per cable', () => {
  const j = selectT(ID.j), Pn = cv.classicPanels.get(j.id + '/i1'), N = api.nodes.get(j.id);
  assert.deepEqual([/^r1:l1\.out>i1:cf,r2:l1\.out>fx\d+:fx\.rev\.mix$/.test(rows(j)), N.modsKey === api.buildMods(j).key], [true, true], rows(j));
  const c = MOD('juno60').controls.find(x => x.id === 'cf');
  clearPosted(j);
  const spin = ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* (real time: the throttle window) */ } };
  for (let i = 1; i <= 15; i++) { Pn.set('cf', +(c.min + (c.max - c.min) * (0.2 + 0.04 * i)).toFixed(3), 'move'); if (i === 8) spin(70); sim.raf(); } // (the build is fast: without the spin the whole drag fits one window)
  const mid = posted(j, 'mods').length;
  assert.ok(mid >= 1 && mid <= 2, 'held while dragging: ' + mid);
  assert.equal(posted(j, 'patch').length >= 15, true, 'the knob\'s own value went with every frame');
  Pn.gestureEnd('cf'); sim.raf();
  const L = posted(j, 'mods');
  assert.ok(L.length <= 3 && L.length > mid, 'the end posts: ' + L.length);
  assert.equal(L[L.length - 1].key, api.buildMods(j).key, 'the final transfer');
  assert.equal(N.modsHold, false);
  // keys: five writes in one frame → one repost
  clearPosted(j);
  for (let i = 0; i < 5; i++) Pn.set('cf', +(c.min + (c.max - c.min) * (0.5 + 0.02 * i)).toFixed(3));
  sim.raf();
  assert.equal(posted(j, 'mods').length, 1);
  Pn.set('cf', c.def); sim.raf();
  // (C4) a cables refresh builds the payload a fixed number of times, not once per cable: four cables, then six
  const e = dropNew('env', { x: -600, y: 1500 }); M.opts.onMod(e + '.out', 'i1:rs'); sim.raf();
  const m = dropNew('macro', { x: -600, y: 1900 }); M.opts.onMod(m + '.k1', 'i1:lv'); sim.raf();
  assert.equal(V().cables.list().filter(x => x.kind === 'mod').length, 4);
  const n0 = U.built(); cv.render(); sim.raf(); const b4 = U.built() - n0;
  M.opts.onMod(m + '.k2', 'i1:lr'); sim.raf(); M.opts.onMod(e + '.out', 'i1:cf'); sim.raf();
  assert.equal(V().cables.list().filter(x => x.kind === 'mod').length, 6, rows(T()));
  const n1 = U.built(); cv.render(); sim.raf(); const b6 = U.built() - n1;
  assert.ok(b6 <= b4 && b4 <= 4, 'builds per refresh do not grow with the cables: ' + b4 + ' → ' + b6);
  undoN(6); // (two drops, four cables)
  assert.equal(rows(T()).split(',').length, 2, rows(T()));
});

test('(U1) a right-click / long-press on a cable\'s amount badge over a Juno slider: the contextmenu is handed to the control beneath (its own menu opens), the cable menu never', () => {
  const j = T(), Pn = cv.classicPanels.get(j.id + '/i1'), ctl = Pn.els.get('cf'), got = [];
  const badge = walk(sim.$('#world'), x => /\bcv-mbadge\b/.test(clsOf(x)) && x.attrs && x.attrs['data-cable'] === 'r1').pop(); // (the live one: the sim DOM's remove() is a no-op)
  assert.ok(badge && ctl, 'the badge of r1 and the cutoff slider');
  const doc = sim.dom.document, had = doc.elementsFromPoint;
  let asked = 0;
  doc.elementsFromPoint = () => { asked++; return [badge, ctl]; };
  ctl.listeners.contextmenu = []; // (the panel's own menu: wk.contextMenu cannot build in the sim DOM — the unit test and the browser cover it; here the hand-off alone)
  ctl.addEventListener('contextmenu', e => { got.push((e.isTrusted ? 'trusted' : 'synthetic') + '@' + e.clientX + ',' + e.clientY); e.preventDefault(); });
  try {
    badge.dispatchEvent(ev('contextmenu', { clientX: 12, clientY: 34, isTrusted: true, button: 2 }));
    const menus = walk(sim.$('#ov') || sim.dom.document.body, x => /\bwk-ctx\b/.test(clsOf(x)));
    const labels = menus.flatMap(m => walk(m, x => clsOf(x) === 'wk-cl').map(x => x.textContent));
    assert.deepEqual([got, asked, labels.includes('Disconnect')], [['synthetic@12,34'], 1, false], 'the control got it; no cable menu: ' + labels.join('|'));
  } finally { if (had) doc.elementsFromPoint = had; else delete doc.elementsFromPoint; }
});

test('(U3) an eff value outside the transfer\'s range gives no live value (the dot hides) instead of pinning at an end; inside, as before', () => {
  const j = T(), k = j.id + '/i1', m = api.buildMods(j), xf = m.xfer[0], Pn = cv.classicPanels.get(k);
  const T_ = x => (xf.tab ? xf.tab[Math.round(x * 128)] : xf.a + xf.b * x), hi = xf.tab ? Math.max(...xf.tab) : Math.max(xf.a, xf.a + xf.b);
  cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: { eff: Float32Array.of(T_(Math.min(1, xf.x0 + 0.1))) } });
  assert.equal(typeof U.live.get(k).cf, 'number');
  cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: { eff: Float32Array.of(hi + 10) } });
  assert.equal(U.live.get(k).cf, undefined, 'out of range: none');
  const mk = walk(Pn.els.get('cf'), q => /\bcp-(livemk|live)\b/.test(clsOf(q)))[0];
  assert.equal(mk.attrs && 'display' in mk.attrs ? mk.attrs.display === 'none' : !!mk.hidden, true, 'hidden');
});

test('(live meters) a mounted LFO / ENV / chaos body subscribes the track\'s monitor; a smon with mc and a payload with slots moves the bodies; without slots nothing; the subscription goes with the last such body', () => {
  const j = T();
  assert.deepEqual([U.mcMons.has(j.id), [...cv.monitors.subs].some(s => s.trackId === j.id && s.dev === 'i1' && s.role === 'inst')], [true, true]);
  assert.equal((cv.monitors.on.get(j.id) || '').split(',').includes('mods'), true, "the node's monitor ids carry 'mods' (the Track posts {t: 'smon', mc} on it)");
  const e = dropNew('env', { x: -600, y: 1500 });
  const B = M.bodies.get('l1'), E = M.bodies.get(e);
  const mc = new Float32Array(16); mc[0] = 0.62; mc[10] = 0.31;
  const v0 = B.value(), pay = api.buildMods(j), real = pay.slots;
  assert.deepEqual([real && real.l1 && real.l1.i, real && real[e]], [0, undefined], 'the compile maps the cabled LFO to slot 0; an uncabled ENV is not evaluated (no slot)');
  delete pay.slots;
  cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: {}, mc });
  assert.equal(Object.is(B.value(), v0), true, 'no slots: nothing moves');
  pay.slots = { l1: { kind: 'lfo', i: 0 }, [e]: { kind: 'env', i: 10 } };
  try {
    cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: {}, mc });
    assert.deepEqual([+B.value().toFixed(2), +E.value().toFixed(2)], [0.62, 0.31]);
    mc[0] = 0.1;
    cv.monitors.deliver(j.id, { t: 'smon', i: 'i1', s: {}, mc });
    assert.equal(+B.value().toFixed(2), 0.1);
  } finally { pay.slots = real; }
  M.del(e); sim.raf();
  assert.equal(U.mcMons.has(j.id), true, 'the LFO still mounted');
  M.del('l1'); sim.raf();
  assert.equal(U.mcMons.has(j.id), false);
  undoN(3); // (the two deletions, the drop)
  assert.deepEqual([keys().includes('l1'), keys().includes(e), U.mcMons.has(j.id), rows(T()).split(',').length], [true, false, true, 2]);
});

test('(U9) the classic badge and the Mod list count cables, not payload rows (an ENV on the Juno\'s VCA mode selector compiles into several rows); (E6) {t: \'modsErr\'} from the node clears its key so the next build reposts', () => {
  const j = T(), pid = Object.keys(j.dev).find(k => j.dev[k].kind === 'panel');
  const e = dropNew('env', { x: -600, y: 1500 }); M.opts.onMod(e + '.out', 'i1:vm'); sim.raf();
  assert.equal(rows(T()).split(',').length, 3, rows(T()));
  const m = api.buildMods(j), mine = m.rows.filter(r => r.dst.inst === 'i1');
  assert.ok(mine.length > 2, 'several payload rows for two cables: ' + mine.length);
  assert.deepEqual([badge('i1'), badge(pid)], ['mods 2', 'mods 1']);
  M.list();
  const line = walk(sim.$('#ov'), c => /\bcv-ml-dev\b/.test(clsOf(c))).filter(c => c.attrs['data-dev'] === 'i1').pop(); // (the current list: the sim DOM keeps old ones)
  assert.equal(walk(line, c => /\bcv-ml-b\b/.test(clsOf(c)))[0].textContent.split(' · ')[0], '2 cables');
  M.layer().close();
  undoN(2);
  assert.equal(rows(T()).split(',').length, 2);
  // E6 (T(): the undo restored a snapshot — the track object is new)
  const N = api.nodes.get(j.id), key = N.modsKey;
  assert.ok(key && key !== 'off');
  sim.nodeOf(j.id)._fromProc({ t: 'modsErr', i: j.id, key });
  assert.equal(N.modsKey, undefined);
  clearPosted(j);
  api.queuePatch(T()); sim.raf();
  assert.deepEqual([posted(j, 'mods').length, N.modsKey], [1, key], 'reposted as is');
});

test('(U10, U11) setTrackModel names the device being replaced and drops the halo subscription with the rows (no monitor without rows); undo brings both back', () => {
  const j = T(), k = j.id + '/i1';
  assert.deepEqual([rows(j).split(',').length, U.mons.has(k)], [2, true]);
  const why = cv.setTrackModel(j, 'minimoog'); sim.raf();
  assert.equal(why, '1 modulation cable to the Juno-60 removed: the new model has no such knobs');
  assert.deepEqual([T().model, rows(T()).split(',').length, U.mons.has(k)], ['minimoog', 1, false]);
  cv.undo(); sim.raf();
  for (let i = 0; i < 40 && cv.mount && cv.mount(); i++) sim.raf();
  assert.deepEqual([T().model, rows(T()).split(',').length], ['juno60', 2]);
  U.halos(T());
  assert.equal(U.mons.has(k), true);
});

test('(canvas 2b) the Serum filter\'s routing switches S A B C N take no cable: canMod refuses, the drag marks nothing on them, a programmatic connect adds no row, the parameter list greys them; the sources\' filter-balance destinations stay open; a row that already points at one keeps compiling', () => {
  const a = fresh('serum');
  drop('lfo');
  const SW = ['f.routeS', 'f.routeA', 'f.routeC', 'f2.routeN', 'f2.routeB'], BAL = ['a.fbal', 'b.fbal', 'c.fbal', 's.fbal', 'n.fbal'];
  assert.deepEqual(SW.map(id => M.opts.canMod('l1.out', 'i1:' + id).ok), SW.map(() => false));
  assert.deepEqual(SW.map(id => M.marks()('i1', id)), SW.map(() => false));
  assert.deepEqual(BAL.map(id => [M.opts.canMod('l1.out', 'i1:' + id).ok, M.marks()('i1', id)]), BAL.map(() => [true, true]));
  const n0 = hsteps();
  M.opts.onMod('l1.out', 'i1:f.routeS'); sim.raf();
  assert.deepEqual([rows(a), hsteps()], ['', n0], 'refused: no row, no step');
  const D = M.descs('i1');
  assert.deepEqual([D.filter(x => /^f2?\.route[A-Z]$/.test(x.id)).length > 0, D.filter(x => /^f2?\.route[A-Z]$/.test(x.id)).every(x => x.nomod), D.filter(x => /\.fbal$/.test(x.id)).length, D.filter(x => /\.fbal$/.test(x.id)).some(x => x.nomod)], [true, true, 5, false]);
  // a row that exists already (a saved project): compiled as ever
  a.mods = [{ id: 'r1', src: 'l1.out', dst: 'i1:f.routeS', amt: -1, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }];
  a.mid = 2;
  const pay = api.buildMods(a), cp = lastPatch(a, 'i1') || null;
  assert.equal(pay.off || pay.rows.length === 0, true, 'the Serum row goes through ext (no ModCore row)');
  assert.equal(pay.ext.length, 1, 'ext1 feeds the Serum\'s f.routeS');
  void cp;
});

test('(2b halos) a shared panel\'s knob with a canvas cable: modHalos paints the panel\'s rack (fx-ui paintMods) with the row — its source label and polarity — and clears it with the row; the rack\'s monitor message carrying the ModCore offsets moves the live dot (base + mo), none without; a Serum\'s own FX rack takes its dot from the snapshot\'s eff at the knob\'s FX-context index', () => {
  const j = fresh('juno60');
  drop('lfo');
  const pid = Object.keys(j.dev).find(k => j.dev[k].kind === 'panel'), iid = cv.fx.addEffect(pid, 'rev'), dst = pid + ':fx.' + iid + '.mix';
  sim.raf();
  M.opts.onMod('l1.out', dst); sim.raf();
  const rec = cv.fxRec(j, pid), was = { ui: rec.ui, trackId: rec.trackId, dev: rec.dev, key: rec.key, sx: rec.sx }; // (R6: the panel module's record)
  const calls = [], lives = [];
  const showRows = f => ['fx.' + iid + '.mix', 'fx.' + iid + '.size'].map(id => f(id).map(r => [r.id, r.src, r.label, r.pol, r.amt].join(':')).join('|')).join(' / ');
  Object.assign(rec, { ui: { paintMods: f => calls.push(showRows(f)), setLive: f => lives.push(f === null ? 'off' : f('fx.' + iid + '.mix', 0.5) + '/' + f('fx.' + iid + '.size', 0.5)), refresh() {}, destroy() {} }, trackId: j.id, dev: pid, key: pid, sx: false });
  try {
    U.modHalos(j);
    assert.deepEqual(calls, ['r1:l1.out:LFO 1:uni:' + j.mods[0].amt + ' / '], 'the panel\'s rack painted with the cable\'s row');
    // the ModCore offsets of the rack's monitor message → the live dot: base + mo[fx index], none for a knob without a cable
    const fxr = lastMods(j).rows.find(r => r.dst.kind === 'fx'), mo = new Float32Array(fxr.dst.fx + 1);
    mo[fxr.dst.fx] = 0.2;
    U.fxLive(j.id, pid, rec, { t: 'smon', c: pid, mo });
    assert.deepEqual(lives, [0.5 + Math.fround(0.2) + '/null'], 'base 0.5 + 0.2 (float32); the other knob has no cable');
    lives.length = 0;
    U.fxLive(j.id, pid, rec, { t: 'smon', c: pid });
    assert.deepEqual(lives, ['off'], 'no offsets (no ModCore): the dots off');
    // an edit of the row (bypass): the rack is painted again with it (fx-ui draws no arc for a bypassed row)
    calls.length = 0;
    U.bypass('r1'); sim.raf();
    assert.deepEqual(calls, ['r1:l1.out:LFO 1:uni:' + j.mods[0].amt + ' / '], 'repainted by the row edit');
    assert.equal(T().mods[0].byp, 1);
    // fxHalos paints one rack on demand (when the rack is built, or refreshed after an undo)
    U.fxHalos(T(), pid);
    assert.equal(calls.length, 2);
    U.fxHalos(T(), 'nope');
    assert.equal(calls.length, 2, 'no such rack: nothing');
  } finally { Object.assign(rec, was); }
  // a Serum's own FX: the dot from the Serum snapshot's eff
  const a = fresh('serum');
  drop('lfo');
  assert.equal(cv.fx.addEffect('i1/fx', 'rev'), 'rev'); sim.raf();
  M.opts.onMod('l1.out', 'i1:fx.rev.mix'); sim.raf();
  const rec2 = { ui: { setLive: f => lives.push(f === null ? 'off' : f('fx.rev.mix', 0.5)), paintMods() {}, refresh() {}, destroy() {} }, trackId: a.id, dev: 'i1', key: 'i1/fx', sx: true };
  const fxs = a.dev.i1.fx || a.fx, flat = C.fxDest('fx.rev.mix', fxs).flat, eff = new Float32Array(C.NSV + 8 + flat + 1);
  eff[C.NSV + 8 + flat] = 0.8;
  lives.length = 0;
  U.fxLive(a.id, 'i1/fx', rec2, { t: 'smon', i: 'i1', s: { eff } });
  assert.deepEqual(lives, [Math.fround(0.8)], 'eff at NSV + 8 + flat');
});

test('(bug 2) a PER NOTE LFO cabled to the Serum\'s LFO 1 Rate is injected into LFO 2 — never into LFO 1, the LFO the row moves (it would modulate its own rate); a GLOBAL one reads ext1', () => {
  const a = fresh('serum');
  drop('lfo');
  M.opts.onMod('l1.out', 'i1:l1.rate'); sim.raf();
  let cp = lastPatch(a, 'i1').serum;
  assert.deepEqual([Array.from(cp.mSrc).slice(0, cp.mN), Array.from(cp.mDst).slice(0, cp.mN), lastMods(a).ext.length], [[C.S_EXT0], [C.vi('l1.rate')], 1], 'GLOBAL: ext1 → LFO 1 Rate');
  U.editState('l1', { lfo: Object.assign({}, a.dev.l1.lfo, { mono: 0 }) }); sim.raf();
  cp = lastPatch(a, 'i1').serum;
  assert.deepEqual([Array.from(cp.mSrc).slice(0, cp.mN), Array.from(cp.mDst).slice(0, cp.mN)], [[C.SRC_INDEX.lfo2], [C.vi('l1.rate')]], 'PER NOTE: LFO 2 → LFO 1 Rate');
  assert.deepEqual(api.sxExtra(a, 'i1', 'l1.rate').map(r => [r.id, r.src]), [['r1', 'lfo2']], 'the Serum\'s halo / knob menu name the slot');
  assert.deepEqual(api.sxHost(a).extraMatrix().map(r => [r.src, r.tag, r.dst]), [['lfo2', 'LFO 2', 'l1.rate']]);
});
